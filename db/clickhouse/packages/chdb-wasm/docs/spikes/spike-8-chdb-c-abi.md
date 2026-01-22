# Spike 8: Use chdb C ABI Directly (Bypass Python Layer)

## Goal

Investigate using the clean C ABI from chdb directly, bypassing any Python wrapper overhead, to enable full ClickHouse functionality in WASM.

## Executive Summary

The chdb project provides a clean C ABI (`vendor/chdb/programs/local/chdb.h`) that exposes ClickHouse's query execution capabilities. Currently, the `chdb-wasm` package uses a **custom reimplemented executor** (`wasm/executor_bindings.cpp`) that only supports a subset of SQL. Using the real chdb C ABI would provide complete ClickHouse compatibility but requires compiling the full ClickHouse codebase to WASM.

**Key Finding**: The current approach is a pragmatic workaround for WASM size constraints. The real chdb C ABI is well-designed and would be the ideal target, but the full chdb binary is ~100MB+ which exceeds Cloudflare Workers' limits.

---

## 1. chdb C API Documentation

### Location
`/Users/nathanclevenger/projects/clickhouse/vendor/chdb/programs/local/chdb.h`

### Core Types

```c
// Return state enumeration
typedef enum chdb_state {
    CHDBSuccess = 0,
    CHDBError = 1
} chdb_state;

// Opaque handle for query results
typedef struct chdb_result_ {
    void * internal_data;
} chdb_result;

// Connection handle wrapping database session state
typedef struct chdb_connection_ {
    void * internal_data;
} * chdb_connection;

// Arrow integration handles
typedef struct chdb_arrow_stream_ { void * internal_data; } * chdb_arrow_stream;
typedef struct chdb_arrow_schema_ { void * internal_data; } * chdb_arrow_schema;
typedef struct chdb_arrow_array_ { void * internal_data; } * chdb_arrow_array;
```

### Connection Management

```c
// Create a new connection (only one active connection per process)
// Default path is ":memory:" if not specified
CHDB_EXPORT chdb_connection * chdb_connect(int argc, char ** argv);

// Close connection and clean up resources
CHDB_EXPORT void chdb_close_conn(chdb_connection * conn);
```

### Query Execution

```c
// Execute query with string parameters
CHDB_EXPORT chdb_result * chdb_query(
    chdb_connection conn,
    const char * query,
    const char * format
);

// Execute query with explicit length parameters (binary-safe)
CHDB_EXPORT chdb_result * chdb_query_n(
    chdb_connection conn,
    const char * query,
    size_t query_len,
    const char * format,
    size_t format_len
);

// Execute query with command-line interface
CHDB_EXPORT chdb_result * chdb_query_cmdline(int argc, char ** argv);
```

### Streaming Query API

```c
// Initialize streaming query
CHDB_EXPORT chdb_result * chdb_stream_query(
    chdb_connection conn,
    const char * query,
    const char * format
);

// Binary-safe streaming query
CHDB_EXPORT chdb_result * chdb_stream_query_n(
    chdb_connection conn,
    const char * query,
    size_t query_len,
    const char * format,
    size_t format_len
);

// Fetch next chunk of streaming results
CHDB_EXPORT chdb_result * chdb_stream_fetch_result(
    chdb_connection conn,
    chdb_result * result
);

// Cancel streaming query
CHDB_EXPORT void chdb_stream_cancel_query(
    chdb_connection conn,
    chdb_result * result
);
```

### Result Accessors

```c
// Get result data buffer
CHDB_EXPORT char * chdb_result_buffer(chdb_result * result);

// Get result data length
CHDB_EXPORT size_t chdb_result_length(chdb_result * result);

// Get query execution time (seconds)
CHDB_EXPORT double chdb_result_elapsed(chdb_result * result);

// Get rows in result set
CHDB_EXPORT uint64_t chdb_result_rows_read(chdb_result * result);

// Get bytes in result set (internal binary format)
CHDB_EXPORT uint64_t chdb_result_bytes_read(chdb_result * result);

// Get rows read from storage engine
CHDB_EXPORT uint64_t chdb_result_storage_rows_read(chdb_result * result);

// Get bytes read from storage engine
CHDB_EXPORT uint64_t chdb_result_storage_bytes_read(chdb_result * result);

// Get error message (NULL if no error)
CHDB_EXPORT const char * chdb_result_error(chdb_result * result);

// Destroy result and free resources
CHDB_EXPORT void chdb_destroy_query_result(chdb_result * result);
```

### Arrow Integration

```c
// Register Arrow stream as table function
CHDB_EXPORT chdb_state chdb_arrow_scan(
    chdb_connection conn,
    const char * table_name,
    chdb_arrow_stream arrow_stream
);

// Register Arrow array as table function
CHDB_EXPORT chdb_state chdb_arrow_array_scan(
    chdb_connection conn,
    const char * table_name,
    chdb_arrow_schema arrow_schema,
    chdb_arrow_array arrow_array
);

// Unregister Arrow table
CHDB_EXPORT chdb_state chdb_arrow_unregister_table(
    chdb_connection conn,
    const char * table_name
);
```

### Deprecated API (Still Available)

```c
// Legacy result structures with direct member access
struct local_result_v2 {
    char * buf;
    size_t len;
    void * _vec;           // for internal freeing
    double elapsed;
    uint64_t rows_read;
    uint64_t bytes_read;
    char * error_message;
};

// Legacy functions
CHDB_EXPORT struct local_result_v2 * query_stable_v2(int argc, char ** argv);
CHDB_EXPORT void free_result_v2(struct local_result_v2 * result);

// Legacy connection API
CHDB_EXPORT struct chdb_conn ** connect_chdb(int argc, char ** argv);
CHDB_EXPORT void close_conn(struct chdb_conn ** conn);
CHDB_EXPORT struct local_result_v2 * query_conn(
    struct chdb_conn * conn,
    const char * query,
    const char * format
);
```

---

## 2. Current Approach Analysis

### executor_bindings.cpp

The current implementation (`/Users/nathanclevenger/projects/clickhouse/packages/chdb-wasm/wasm/executor_bindings.cpp`) is a **completely reimplemented SQL executor** written specifically for WASM.

**What it implements:**
- Custom lexer (TokenKind enum, Lexer class)
- Custom parser (SelectStmtPtr, Parser class)
- Custom expression evaluator
- Custom aggregate functions (COUNT, SUM, AVG, MIN, MAX)
- Custom table functions (numbers())
- Custom formatters (CSV, TSV, JSON)

**Exported C API:**

```c
void* executor_create();
void executor_destroy(void* ctx);
int executor_query(void* ctx, const char* query, size_t query_len, const char* format);
const char* executor_get_result(void* ctx);
size_t executor_get_result_len(void* ctx);
const char* executor_get_error(void* ctx);
const char* executor_version();
int executor_test();
```

**Supported SQL (subset):**
- `SELECT <literal> [AS <alias>]`
- `SELECT <expr> [AS <alias>]` (arithmetic: +, -, *, /, %)
- Multiple columns: `SELECT 1, 2, 3`
- Aggregates: `COUNT(*)`, `SUM(x)`, `AVG(x)`, `MIN(x)`, `MAX(x)`
- `UNION ALL`
- Subqueries: `SELECT * FROM (SELECT 1, 2)`
- Table functions: `SELECT * FROM numbers(100)`
- `GROUP BY`

**Not Supported:**
- JOINs
- Window functions
- Full ClickHouse functions library (2000+ functions)
- Complex data types (Arrays, Maps, Tuples, Nested)
- MergeTree engine
- External data sources
- Views, materialized views
- User-defined functions

### Why a Custom Executor?

| Concern | Real chdb | Custom Executor |
|---------|-----------|-----------------|
| Binary size | ~100-150MB | ~132KB |
| Cloudflare limit | Exceeds 25MB bundled limit | Within limits |
| Compilation | Complex, many dependencies | Simple, standalone |
| SQL coverage | Complete ClickHouse SQL | Subset only |
| Performance | Optimized | Basic |

---

## 3. chdb-backend.ts Analysis

The TypeScript backend (`/Users/nathanclevenger/projects/clickhouse/packages/chdb-wasm/src/chdb-backend.ts`) is designed to work with the **real chdb WASM** if it could be compiled:

```typescript
// Expected exports from real chdb WASM
interface WasmExports {
  // Connection-based API
  chdb_connect?: (argc: number, argv: number) => number;
  chdb_query?: (conn: number, query: number, format: number) => number;
  chdb_result_buffer?: (result: number) => number;
  chdb_result_length?: (result: number) => number;
  chdb_result_error?: (result: number) => number;
  chdb_result_elapsed?: (result: number) => number;
  chdb_result_rows_read?: (result: number) => number;
  chdb_result_bytes_read?: (result: number) => number;
  chdb_destroy_query_result?: (result: number) => void;
  chdb_close_conn?: (conn: number) => void;

  // Legacy cmdline API
  query_stable_v2?: (argc: number, argv: number) => number;
  free_result_v2?: (result: number) => void;
}
```

This shows the team anticipated using the real C ABI and built infrastructure for it.

---

## 4. TypeScript Bindings Design for Direct C ABI

Here's how TypeScript bindings would look for the real chdb C ABI:

### Connection Manager

```typescript
/**
 * ChdbConnection - Wrapper for chdb_connection handle
 */
export class ChdbConnection {
  private handle: number;  // Pointer to chdb_connection
  private wasm: ChdbWasmModule;

  private constructor(handle: number, wasm: ChdbWasmModule) {
    this.handle = handle;
    this.wasm = wasm;
  }

  /**
   * Create a new connection
   * @param wasm - Loaded WASM module
   * @param path - Database path (default: ":memory:")
   */
  static async connect(
    wasm: ChdbWasmModule,
    path: string = ":memory:"
  ): Promise<ChdbConnection> {
    const { malloc, free, chdb_connect } = wasm.exports;

    // Build argv: ["clickhouse", "--path=<path>"]
    const args = ["clickhouse", `--path=${path}`];
    const argvPtrs: number[] = [];

    for (const arg of args) {
      const ptr = allocateString(wasm, arg);
      argvPtrs.push(ptr);
    }

    // Create argv array
    const argvPtr = malloc((args.length + 1) * 4);
    const heap = new DataView(wasm.memory.buffer);

    for (let i = 0; i < argvPtrs.length; i++) {
      heap.setUint32(argvPtr + i * 4, argvPtrs[i], true);
    }
    heap.setUint32(argvPtr + argvPtrs.length * 4, 0, true); // null terminator

    const connPtr = chdb_connect(args.length, argvPtr);

    // Cleanup argv
    free(argvPtr);
    for (const ptr of argvPtrs) free(ptr);

    if (connPtr === 0) {
      throw new Error("Failed to create chdb connection");
    }

    return new ChdbConnection(connPtr, wasm);
  }

  /**
   * Execute a query
   */
  async query(sql: string, format: string = "JSON"): Promise<ChdbResult> {
    const { chdb_query, chdb_result_error } = this.wasm.exports;

    const sqlPtr = allocateString(this.wasm, sql);
    const formatPtr = allocateString(this.wasm, format);

    try {
      const resultPtr = chdb_query(this.handle, sqlPtr, formatPtr);

      if (resultPtr === 0) {
        throw new Error("Query returned null result");
      }

      // Check for error
      const errorPtr = chdb_result_error(resultPtr);
      if (errorPtr !== 0) {
        const error = readString(this.wasm, errorPtr);
        throw new Error(error);
      }

      return new ChdbResult(resultPtr, this.wasm);
    } finally {
      this.wasm.exports.free(sqlPtr);
      this.wasm.exports.free(formatPtr);
    }
  }

  /**
   * Close the connection
   */
  close(): void {
    if (this.handle) {
      this.wasm.exports.chdb_close_conn(this.handle);
      this.handle = 0;
    }
  }
}
```

### Result Wrapper

```typescript
/**
 * ChdbResult - Wrapper for chdb_result handle
 */
export class ChdbResult {
  private handle: number;
  private wasm: ChdbWasmModule;
  private freed = false;

  constructor(handle: number, wasm: ChdbWasmModule) {
    this.handle = handle;
    this.wasm = wasm;
  }

  /**
   * Get result data as string
   */
  getData(): string {
    const { chdb_result_buffer, chdb_result_length } = this.wasm.exports;

    const bufPtr = chdb_result_buffer(this.handle);
    const length = chdb_result_length(this.handle);

    return readStringWithLength(this.wasm, bufPtr, length);
  }

  /**
   * Get result data as Uint8Array (for binary formats)
   */
  getBytes(): Uint8Array {
    const { chdb_result_buffer, chdb_result_length } = this.wasm.exports;

    const bufPtr = chdb_result_buffer(this.handle);
    const length = chdb_result_length(this.handle);
    const heap = new Uint8Array(this.wasm.memory.buffer);

    return heap.slice(bufPtr, bufPtr + length);
  }

  /**
   * Get query statistics
   */
  getStatistics(): QueryStatistics {
    const {
      chdb_result_elapsed,
      chdb_result_rows_read,
      chdb_result_bytes_read,
      chdb_result_storage_rows_read,
      chdb_result_storage_bytes_read
    } = this.wasm.exports;

    return {
      elapsed: chdb_result_elapsed(this.handle),
      rowsRead: Number(chdb_result_rows_read(this.handle)),
      bytesRead: Number(chdb_result_bytes_read(this.handle)),
      storageRowsRead: Number(chdb_result_storage_rows_read(this.handle)),
      storageBytesRead: Number(chdb_result_storage_bytes_read(this.handle)),
    };
  }

  /**
   * Free result resources
   */
  free(): void {
    if (!this.freed && this.handle) {
      this.wasm.exports.chdb_destroy_query_result(this.handle);
      this.freed = true;
    }
  }
}
```

### Streaming Query Support

```typescript
/**
 * ChdbStreamResult - Iterator for streaming queries
 */
export class ChdbStreamResult implements AsyncIterable<Uint8Array> {
  private connection: ChdbConnection;
  private handle: number;
  private wasm: ChdbWasmModule;

  async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    const { chdb_stream_fetch_result, chdb_result_buffer, chdb_result_length } =
      this.wasm.exports;

    while (true) {
      const chunkPtr = chdb_stream_fetch_result(
        this.connection.handle,
        this.handle
      );

      if (chunkPtr === 0) break;

      const bufPtr = chdb_result_buffer(chunkPtr);
      const length = chdb_result_length(chunkPtr);

      if (length === 0) break;

      const heap = new Uint8Array(this.wasm.memory.buffer);
      yield heap.slice(bufPtr, bufPtr + length);

      this.wasm.exports.chdb_destroy_query_result(chunkPtr);
    }
  }

  cancel(): void {
    this.wasm.exports.chdb_stream_cancel_query(
      this.connection.handle,
      this.handle
    );
  }
}
```

### Memory Helpers

```typescript
function allocateString(wasm: ChdbWasmModule, str: string): number {
  const bytes = new TextEncoder().encode(str);
  const ptr = wasm.exports.malloc(bytes.length + 1);
  const heap = new Uint8Array(wasm.memory.buffer);
  heap.set(bytes, ptr);
  heap[ptr + bytes.length] = 0;  // null terminator
  return ptr;
}

function readString(wasm: ChdbWasmModule, ptr: number): string {
  const heap = new Uint8Array(wasm.memory.buffer);
  let end = ptr;
  while (heap[end] !== 0) end++;
  return new TextDecoder().decode(heap.slice(ptr, end));
}

function readStringWithLength(
  wasm: ChdbWasmModule,
  ptr: number,
  length: number
): string {
  const heap = new Uint8Array(wasm.memory.buffer);
  return new TextDecoder().decode(heap.slice(ptr, ptr + length));
}
```

---

## 5. Data Flow Comparison

### Current Custom Executor Flow

```
TypeScript (Worker)
    |
    v
executor.wasm (132KB)
    |-- Custom Lexer
    |-- Custom Parser
    |-- Custom Evaluator
    |-- Custom Aggregates
    |-- Custom Formatters
    |
    v
Result (CSV/JSON/TSV)
```

### Ideal chdb C ABI Flow

```
TypeScript (Worker)
    |
    v
ChdbConnection.query(sql, format)
    |
    v
chdb.wasm (~100MB+)
    |-- Real ClickHouse Lexer
    |-- Real ClickHouse Parser
    |-- Real ClickHouse Interpreter
    |-- Real ClickHouse Functions (2000+)
    |-- Real ClickHouse Formatters
    |
    v
chdb_result
    |
    v
ChdbResult.getData() / ChdbResult.getBytes()
```

---

## 6. Memory Management in WASM

### Cloudflare Workers Constraints

| Limit | Value |
|-------|-------|
| Bundle size | 25MB (compressed) |
| Worker memory | 128MB |
| CPU time | 30s (Workers for Platforms) |
| WASM memory pages | Starts at 256 pages (16MB), grows to max |

### chdb Memory Model

The C ABI uses opaque handles with internal allocation:

1. **Connection** - Created via `chdb_connect()`, freed via `chdb_close_conn()`
2. **Results** - Created by query functions, freed via `chdb_destroy_query_result()`
3. **Strings** - Caller allocates (malloc), passes pointers

For WASM:
- Use `WebAssembly.Memory` with `maximum: 2048` pages (128MB max)
- Track memory growth with `emscripten_notify_memory_growth`
- Update heap views after each memory growth

### WASI Support

The chdb-backend already implements WASI stubs for:
- `fd_write`, `fd_read`, `fd_close`, `fd_seek`
- `environ_get`, `environ_sizes_get`
- `clock_time_get`
- `proc_exit`
- `random_get`
- `path_open`, `path_filestat_get`
- `args_get`, `args_sizes_get`

---

## 7. Recommendations

### Option A: Continue Custom Executor (Current Path)

**Pros:**
- Fits within Cloudflare constraints
- Already working
- Fast iteration

**Cons:**
- Limited SQL subset
- Reimplementing ClickHouse is endless work
- No access to ClickHouse functions

**Best for:** Simple SQL workloads, prototypes

### Option B: Minimal chdb Core

Compile a stripped-down chdb with only:
- SQL parsing
- Expression evaluation
- Basic functions
- JSON/CSV output

**Estimate:** 5-15MB WASM

**Approach:**
1. Use CMake with aggressive `ENABLE_*=OFF` flags
2. Create a "micro" ClickHouse build profile
3. Strip debug symbols, LTO optimize
4. Compress with wasm-opt

### Option C: R2 Dynamic Loading

Load the full chdb WASM from R2 at runtime:

```typescript
const wasmObject = await env.WASM_BUCKET.get('chdb.wasm');
const wasmBytes = await wasmObject.arrayBuffer();
const module = await WebAssembly.compile(wasmBytes);
const instance = await WebAssembly.instantiate(module, imports);
```

**Pros:**
- Full ClickHouse power
- No bundle size constraint (R2 is separate)

**Cons:**
- Cold start latency (download ~100MB)
- Memory pressure
- May exceed 128MB memory limit

**Mitigation:**
- Pre-warm workers
- Use streaming compilation
- Load WASM incrementally with `WebAssembly.compileStreaming`

### Option D: Hybrid Architecture

1. **Simple queries** -> Custom executor (fast, small)
2. **Complex queries** -> Lazy-load chdb WASM from R2

```typescript
async function executeQuery(sql: string): Promise<Result> {
  if (canHandleSimply(sql)) {
    return simpleExecutor.execute(sql);
  }

  // Lazy load full chdb
  if (!chdbLoaded) {
    await loadChdbFromR2();
  }

  return chdbExecutor.execute(sql);
}
```

---

## 8. Proof of Concept Code

### Minimal TypeScript Interface

```typescript
// chdb-direct.ts - Direct C ABI bindings

export interface ChdbWasmExports {
  memory: WebAssembly.Memory;
  malloc: (size: number) => number;
  free: (ptr: number) => void;
  chdb_connect: (argc: number, argv: number) => number;
  chdb_close_conn: (conn: number) => void;
  chdb_query: (conn: number, query: number, format: number) => number;
  chdb_result_buffer: (result: number) => number;
  chdb_result_length: (result: number) => number;
  chdb_result_error: (result: number) => number;
  chdb_destroy_query_result: (result: number) => void;
}

export class ChdbDirect {
  private exports: ChdbWasmExports;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private connection: number = 0;

  constructor(exports: ChdbWasmExports) {
    this.exports = exports;
  }

  connect(): void {
    const argv = this.buildArgv(["clickhouse"]);
    this.connection = this.exports.chdb_connect(1, argv);
    this.freeArgv(argv, 1);

    if (this.connection === 0) {
      throw new Error("Failed to connect to chdb");
    }
  }

  query(sql: string, format = "JSON"): string {
    const sqlPtr = this.allocString(sql);
    const fmtPtr = this.allocString(format);

    try {
      const result = this.exports.chdb_query(this.connection, sqlPtr, fmtPtr);

      if (result === 0) {
        throw new Error("Query returned null");
      }

      const errorPtr = this.exports.chdb_result_error(result);
      if (errorPtr !== 0) {
        const error = this.readString(errorPtr);
        this.exports.chdb_destroy_query_result(result);
        throw new Error(error);
      }

      const bufPtr = this.exports.chdb_result_buffer(result);
      const length = this.exports.chdb_result_length(result);
      const data = this.readStringLen(bufPtr, length);

      this.exports.chdb_destroy_query_result(result);
      return data;
    } finally {
      this.exports.free(sqlPtr);
      this.exports.free(fmtPtr);
    }
  }

  close(): void {
    if (this.connection) {
      this.exports.chdb_close_conn(this.connection);
      this.connection = 0;
    }
  }

  private allocString(str: string): number {
    const bytes = this.encoder.encode(str);
    const ptr = this.exports.malloc(bytes.length + 1);
    const heap = new Uint8Array(this.exports.memory.buffer);
    heap.set(bytes, ptr);
    heap[ptr + bytes.length] = 0;
    return ptr;
  }

  private readString(ptr: number): string {
    const heap = new Uint8Array(this.exports.memory.buffer);
    let end = ptr;
    while (heap[end] !== 0) end++;
    return this.decoder.decode(heap.subarray(ptr, end));
  }

  private readStringLen(ptr: number, len: number): string {
    const heap = new Uint8Array(this.exports.memory.buffer);
    return this.decoder.decode(heap.subarray(ptr, ptr + len));
  }

  private buildArgv(args: string[]): number {
    const ptrs: number[] = args.map(a => this.allocString(a));
    const argv = this.exports.malloc((args.length + 1) * 4);
    const view = new DataView(this.exports.memory.buffer);

    ptrs.forEach((ptr, i) => view.setUint32(argv + i * 4, ptr, true));
    view.setUint32(argv + args.length * 4, 0, true);

    // Store ptrs for cleanup
    (this as any)._lastArgPtrs = ptrs;
    return argv;
  }

  private freeArgv(argv: number, argc: number): void {
    const ptrs = (this as any)._lastArgPtrs || [];
    ptrs.forEach((ptr: number) => this.exports.free(ptr));
    this.exports.free(argv);
  }
}

// Usage example:
async function example(wasmModule: WebAssembly.Module) {
  const imports = createWasmImports();
  const instance = await WebAssembly.instantiate(wasmModule, imports);
  const exports = instance.exports as unknown as ChdbWasmExports;

  const chdb = new ChdbDirect(exports);
  chdb.connect();

  try {
    const result = chdb.query("SELECT 1 + 1 AS answer");
    console.log(result);
    // {"data":[{"answer":2}],"meta":[{"name":"answer","type":"UInt8"}],...}
  } finally {
    chdb.close();
  }
}
```

---

## 9. Next Steps

1. **Investigate minimal chdb build** - Work with chdb maintainers on a "micro" build profile
2. **Benchmark R2 loading** - Measure cold start with full WASM from R2
3. **Prototype hybrid approach** - Route simple queries to custom executor, complex to lazy-loaded chdb
4. **Consider streaming compilation** - Use `compileStreaming` with chunked R2 delivery
5. **Track chdb WASM efforts** - Monitor upstream progress on official WASM target

---

## 10. Conclusion

The chdb C ABI is well-designed and would be ideal for WASM integration. The main blockers are:

1. **Binary size** - Full ClickHouse is too large for bundling
2. **Memory limits** - 128MB may not be enough for complex queries
3. **Cold start** - Loading from R2 adds latency

The current custom executor approach is pragmatic but limiting. A hybrid approach that lazy-loads full chdb for complex queries could provide the best of both worlds.

**Recommendation:** Continue extending the custom executor for common cases while prototyping R2-based lazy loading of full chdb WASM for advanced queries.
