/**
 * TypeScript Bindings for chdb C ABI
 *
 * This module provides TypeScript bindings for the chdb C API, enabling
 * direct interaction with ClickHouse's query execution capabilities via WebAssembly.
 *
 * The bindings map to the C ABI defined in vendor/chdb/programs/local/chdb.h
 *
 * @module chdb-bindings
 */

// =============================================================================
// Core Types and Interfaces
// =============================================================================

/**
 * Return state enumeration for chDB API functions.
 * Maps to the chdb_state enum in C.
 */
export enum ChdbState {
  /** Operation completed successfully */
  Success = 0,
  /** Operation failed with an error */
  Error = 1,
}

/**
 * Query execution statistics returned from chdb queries.
 */
export interface ChdbStatistics {
  /** Query execution time in seconds */
  elapsed: number;
  /** Number of rows in the result set */
  rowsRead: number;
  /** Number of bytes in the result set (internal binary format) */
  bytesRead: number;
  /** Number of rows read from storage engine (optional) */
  storageRowsRead?: number;
  /** Number of bytes read from storage engine (optional) */
  storageBytesRead?: number;
}

/**
 * WebAssembly memory interface with buffer access.
 */
export interface WasmMemory {
  buffer: ArrayBuffer;
}

/**
 * Core WASM module interface expected by the bindings.
 * This represents the WebAssembly exports from a compiled chdb module.
 */
export interface ChdbWasmModule {
  /** WebAssembly linear memory */
  memory: WasmMemory;

  /** Exported functions from the WASM module */
  exports: ChdbWasmExports;
}

/**
 * Complete set of WASM exports expected from the chdb module.
 * Functions may be exported with or without underscore prefix depending on
 * the compilation settings.
 */
export interface ChdbWasmExports {
  // Memory access
  memory: WebAssembly.Memory;

  // Memory allocation functions
  malloc: (size: number) => number;
  free: (ptr: number) => void;

  // Connection management
  chdb_connect: (argc: number, argv: number) => number;
  chdb_close_conn: (conn: number) => void;

  // Query execution
  chdb_query: (conn: number, query: number, format: number) => number;
  chdb_query_n: (
    conn: number,
    query: number,
    queryLen: number,
    format: number,
    formatLen: number
  ) => number;
  chdb_query_cmdline: (argc: number, argv: number) => number;

  // Streaming query execution
  chdb_stream_query: (conn: number, query: number, format: number) => number;
  chdb_stream_query_n: (
    conn: number,
    query: number,
    queryLen: number,
    format: number,
    formatLen: number
  ) => number;
  chdb_stream_fetch_result: (conn: number, result: number) => number;
  chdb_stream_cancel_query: (conn: number, result: number) => void;

  // Result accessors
  chdb_result_buffer: (result: number) => number;
  chdb_result_length: (result: number) => number;
  chdb_result_elapsed: (result: number) => number;
  chdb_result_rows_read: (result: number) => bigint;
  chdb_result_bytes_read: (result: number) => bigint;
  chdb_result_storage_rows_read: (result: number) => bigint;
  chdb_result_storage_bytes_read: (result: number) => bigint;
  chdb_result_error: (result: number) => number;
  chdb_destroy_query_result: (result: number) => void;

  // Arrow integration (optional)
  chdb_arrow_scan?: (
    conn: number,
    tableName: number,
    arrowStream: number
  ) => ChdbState;
  chdb_arrow_array_scan?: (
    conn: number,
    tableName: number,
    arrowSchema: number,
    arrowArray: number
  ) => ChdbState;
  chdb_arrow_unregister_table?: (conn: number, tableName: number) => ChdbState;
}

/**
 * Flexible WASM exports interface that supports both prefixed and non-prefixed
 * function names, as well as optional functions.
 */
export interface FlexibleWasmExports {
  memory: WebAssembly.Memory;

  // Memory allocation (may use different naming conventions)
  malloc?: (size: number) => number;
  free?: (ptr: number) => void;
  _malloc?: (size: number) => number;
  _free?: (ptr: number) => void;

  // Connection management
  chdb_connect?: (argc: number, argv: number) => number;
  _chdb_connect?: (argc: number, argv: number) => number;
  chdb_close_conn?: (conn: number) => void;
  _chdb_close_conn?: (conn: number) => void;

  // Query execution
  chdb_query?: (conn: number, query: number, format: number) => number;
  _chdb_query?: (conn: number, query: number, format: number) => number;
  chdb_query_n?: (
    conn: number,
    query: number,
    queryLen: number,
    format: number,
    formatLen: number
  ) => number;
  _chdb_query_n?: (
    conn: number,
    query: number,
    queryLen: number,
    format: number,
    formatLen: number
  ) => number;
  chdb_query_cmdline?: (argc: number, argv: number) => number;
  _chdb_query_cmdline?: (argc: number, argv: number) => number;

  // Streaming query execution
  chdb_stream_query?: (conn: number, query: number, format: number) => number;
  _chdb_stream_query?: (conn: number, query: number, format: number) => number;
  chdb_stream_query_n?: (
    conn: number,
    query: number,
    queryLen: number,
    format: number,
    formatLen: number
  ) => number;
  _chdb_stream_query_n?: (
    conn: number,
    query: number,
    queryLen: number,
    format: number,
    formatLen: number
  ) => number;
  chdb_stream_fetch_result?: (conn: number, result: number) => number;
  _chdb_stream_fetch_result?: (conn: number, result: number) => number;
  chdb_stream_cancel_query?: (conn: number, result: number) => void;
  _chdb_stream_cancel_query?: (conn: number, result: number) => void;

  // Result accessors
  chdb_result_buffer?: (result: number) => number;
  _chdb_result_buffer?: (result: number) => number;
  chdb_result_length?: (result: number) => number;
  _chdb_result_length?: (result: number) => number;
  chdb_result_elapsed?: (result: number) => number;
  _chdb_result_elapsed?: (result: number) => number;
  chdb_result_rows_read?: (result: number) => bigint;
  _chdb_result_rows_read?: (result: number) => bigint;
  chdb_result_bytes_read?: (result: number) => bigint;
  _chdb_result_bytes_read?: (result: number) => bigint;
  chdb_result_storage_rows_read?: (result: number) => bigint;
  _chdb_result_storage_rows_read?: (result: number) => bigint;
  chdb_result_storage_bytes_read?: (result: number) => bigint;
  _chdb_result_storage_bytes_read?: (result: number) => bigint;
  chdb_result_error?: (result: number) => number;
  _chdb_result_error?: (result: number) => number;
  chdb_destroy_query_result?: (result: number) => void;
  _chdb_destroy_query_result?: (result: number) => void;

  // Arrow integration (optional)
  chdb_arrow_scan?: (
    conn: number,
    tableName: number,
    arrowStream: number
  ) => ChdbState;
  _chdb_arrow_scan?: (
    conn: number,
    tableName: number,
    arrowStream: number
  ) => ChdbState;
  chdb_arrow_array_scan?: (
    conn: number,
    tableName: number,
    arrowSchema: number,
    arrowArray: number
  ) => ChdbState;
  _chdb_arrow_array_scan?: (
    conn: number,
    tableName: number,
    arrowSchema: number,
    arrowArray: number
  ) => ChdbState;
  chdb_arrow_unregister_table?: (conn: number, tableName: number) => ChdbState;
  _chdb_arrow_unregister_table?: (
    conn: number,
    tableName: number
  ) => ChdbState;

  // Initialization functions
  _initialize?: () => void;
  __wasm_call_ctors?: () => void;
}

// =============================================================================
// Memory Management Helpers
// =============================================================================

/**
 * Allocates memory in the WASM heap and writes a null-terminated string to it.
 *
 * @param wasm - The WASM module instance with memory and malloc exports
 * @param str - The string to allocate
 * @returns The pointer to the allocated string in WASM memory
 * @throws Error if memory allocation fails
 *
 * @example
 * ```typescript
 * const ptr = allocateString(wasmModule, "SELECT 1");
 * try {
 *   // Use the pointer...
 * } finally {
 *   freeMemory(wasmModule, ptr);
 * }
 * ```
 */
export function allocateString(
  wasm: { exports: FlexibleWasmExports },
  str: string
): number {
  const malloc = wasm.exports.malloc ?? wasm.exports._malloc;
  if (!malloc) {
    throw new Error('malloc function not found in WASM exports');
  }

  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  const ptr = malloc(bytes.length + 1);

  if (ptr === 0) {
    throw new Error('Failed to allocate memory for string');
  }

  const heap = new Uint8Array(wasm.exports.memory.buffer);
  heap.set(bytes, ptr);
  heap[ptr + bytes.length] = 0; // Null terminator

  return ptr;
}

/**
 * Reads a null-terminated string from WASM memory.
 *
 * @param wasm - The WASM module instance with memory export
 * @param ptr - Pointer to the string in WASM memory
 * @param maxLen - Maximum length to read (default: 10000)
 * @returns The decoded string, or empty string if ptr is 0
 *
 * @example
 * ```typescript
 * const errorPtr = wasm.exports.chdb_result_error(resultPtr);
 * if (errorPtr !== 0) {
 *   const errorMessage = readString(wasmModule, errorPtr);
 *   throw new Error(errorMessage);
 * }
 * ```
 */
export function readString(
  wasm: { exports: FlexibleWasmExports },
  ptr: number,
  maxLen = 10000
): string {
  if (ptr === 0) return '';

  const heap = new Uint8Array(wasm.exports.memory.buffer);
  let end = ptr;

  while (end < ptr + maxLen && heap[end] !== 0) {
    end++;
  }

  const decoder = new TextDecoder();
  return decoder.decode(heap.subarray(ptr, end));
}

/**
 * Reads a string of known length from WASM memory.
 * Does not rely on null termination.
 *
 * @param wasm - The WASM module instance with memory export
 * @param ptr - Pointer to the string in WASM memory
 * @param length - The exact length of the string in bytes
 * @returns The decoded string
 *
 * @example
 * ```typescript
 * const bufPtr = wasm.exports.chdb_result_buffer(resultPtr);
 * const bufLen = wasm.exports.chdb_result_length(resultPtr);
 * const data = readStringWithLength(wasmModule, bufPtr, bufLen);
 * ```
 */
export function readStringWithLength(
  wasm: { exports: FlexibleWasmExports },
  ptr: number,
  length: number
): string {
  if (ptr === 0 || length === 0) return '';

  const heap = new Uint8Array(wasm.exports.memory.buffer);
  const decoder = new TextDecoder();
  return decoder.decode(heap.subarray(ptr, ptr + length));
}

/**
 * Reads raw bytes from WASM memory.
 * Useful for binary formats like Parquet or Arrow.
 *
 * @param wasm - The WASM module instance with memory export
 * @param ptr - Pointer to the data in WASM memory
 * @param length - The number of bytes to read
 * @returns A copy of the bytes as a Uint8Array
 *
 * @example
 * ```typescript
 * const bufPtr = wasm.exports.chdb_result_buffer(resultPtr);
 * const bufLen = wasm.exports.chdb_result_length(resultPtr);
 * const parquetData = readBytes(wasmModule, bufPtr, bufLen);
 * ```
 */
export function readBytes(
  wasm: { exports: FlexibleWasmExports },
  ptr: number,
  length: number
): Uint8Array {
  if (ptr === 0 || length === 0) return new Uint8Array(0);

  const heap = new Uint8Array(wasm.exports.memory.buffer);
  // Return a copy to avoid issues with memory growth
  return heap.slice(ptr, ptr + length);
}

/**
 * Frees previously allocated memory in the WASM heap.
 *
 * @param wasm - The WASM module instance with free export
 * @param ptr - Pointer to the memory to free (0 is safe to pass)
 *
 * @example
 * ```typescript
 * const ptr = allocateString(wasmModule, "SELECT 1");
 * try {
 *   // Use the pointer...
 * } finally {
 *   freeMemory(wasmModule, ptr);
 * }
 * ```
 */
export function freeMemory(
  wasm: { exports: FlexibleWasmExports },
  ptr: number
): void {
  if (ptr === 0) return;

  const free = wasm.exports.free ?? wasm.exports._free;
  if (free) {
    free(ptr);
  }
}

/**
 * Builds an argv array for passing command-line arguments to WASM functions.
 * Returns both the argv pointer and the individual argument pointers for cleanup.
 *
 * @param wasm - The WASM module instance
 * @param args - Array of string arguments
 * @returns Object containing argv pointer and array of argument pointers
 * @throws Error if memory allocation fails
 *
 * @example
 * ```typescript
 * const { argvPtr, argPtrs } = buildArgv(wasmModule, ["clickhouse", "--query=SELECT 1"]);
 * try {
 *   const result = wasm.exports.chdb_query_cmdline(args.length, argvPtr);
 *   // Process result...
 * } finally {
 *   freeArgv(wasmModule, argvPtr, argPtrs);
 * }
 * ```
 */
export function buildArgv(
  wasm: { exports: FlexibleWasmExports },
  args: string[]
): { argvPtr: number; argPtrs: number[] } {
  const malloc = wasm.exports.malloc ?? wasm.exports._malloc;
  if (!malloc) {
    throw new Error('malloc function not found in WASM exports');
  }

  // Allocate each argument string
  const argPtrs: number[] = [];
  for (const arg of args) {
    argPtrs.push(allocateString(wasm, arg));
  }

  // Allocate argv array (pointers + null terminator)
  const argvPtr = malloc((args.length + 1) * 4);
  if (argvPtr === 0) {
    // Clean up already allocated strings
    for (const ptr of argPtrs) {
      freeMemory(wasm, ptr);
    }
    throw new Error('Failed to allocate memory for argv');
  }

  // Write pointers to argv array
  const view = new DataView(wasm.exports.memory.buffer);
  for (let i = 0; i < argPtrs.length; i++) {
    view.setUint32(argvPtr + i * 4, argPtrs[i], true);
  }
  // Null terminator
  view.setUint32(argvPtr + argPtrs.length * 4, 0, true);

  return { argvPtr, argPtrs };
}

/**
 * Frees an argv array and all its argument strings.
 *
 * @param wasm - The WASM module instance
 * @param argvPtr - Pointer to the argv array
 * @param argPtrs - Array of pointers to individual argument strings
 */
export function freeArgv(
  wasm: { exports: FlexibleWasmExports },
  argvPtr: number,
  argPtrs: number[]
): void {
  for (const ptr of argPtrs) {
    freeMemory(wasm, ptr);
  }
  freeMemory(wasm, argvPtr);
}

// =============================================================================
// ChdbResult Class
// =============================================================================

/**
 * Wrapper for chdb query result handles.
 * Provides methods to access result data, statistics, and errors.
 *
 * Results must be freed when no longer needed to prevent memory leaks.
 *
 * @example
 * ```typescript
 * const result = await connection.query("SELECT 1 + 1 AS answer");
 * try {
 *   console.log(result.getText()); // {"data":[{"answer":2}],...}
 *   console.log(result.getStatistics()); // { elapsed: 0.001, rowsRead: 1, ... }
 * } finally {
 *   result.free();
 * }
 * ```
 */
export class ChdbResult {
  private handle: number;
  private wasm: { exports: FlexibleWasmExports };
  private freed = false;

  /**
   * Creates a new ChdbResult wrapper.
   *
   * @param handle - The result pointer from a chdb query function
   * @param wasm - The WASM module instance
   * @internal Use ChdbConnection.query() instead of constructing directly
   */
  constructor(handle: number, wasm: { exports: FlexibleWasmExports }) {
    this.handle = handle;
    this.wasm = wasm;
  }

  /**
   * Gets the result data as raw bytes.
   * Useful for binary formats like Parquet or Arrow.
   *
   * @returns A copy of the result data as a Uint8Array
   * @throws Error if the result has been freed
   */
  getData(): Uint8Array {
    this.checkFreed();

    const resultBuffer =
      this.wasm.exports.chdb_result_buffer ??
      this.wasm.exports._chdb_result_buffer;
    const resultLength =
      this.wasm.exports.chdb_result_length ??
      this.wasm.exports._chdb_result_length;

    if (!resultBuffer || !resultLength) {
      throw new Error('Result accessor functions not found in WASM exports');
    }

    const bufPtr = resultBuffer(this.handle);
    const length = resultLength(this.handle);

    return readBytes(this.wasm, bufPtr, length);
  }

  /**
   * Gets the result data as a string.
   * Useful for text formats like JSON, CSV, or TSV.
   *
   * @returns The result data decoded as a UTF-8 string
   * @throws Error if the result has been freed
   */
  getText(): string {
    this.checkFreed();

    const resultBuffer =
      this.wasm.exports.chdb_result_buffer ??
      this.wasm.exports._chdb_result_buffer;
    const resultLength =
      this.wasm.exports.chdb_result_length ??
      this.wasm.exports._chdb_result_length;

    if (!resultBuffer || !resultLength) {
      throw new Error('Result accessor functions not found in WASM exports');
    }

    const bufPtr = resultBuffer(this.handle);
    const length = resultLength(this.handle);

    return readStringWithLength(this.wasm, bufPtr, length);
  }

  /**
   * Gets the error message from the result, if any.
   *
   * @returns The error message string, or null if no error occurred
   * @throws Error if the result has been freed
   */
  getError(): string | null {
    this.checkFreed();

    const resultError =
      this.wasm.exports.chdb_result_error ??
      this.wasm.exports._chdb_result_error;

    if (!resultError) {
      return null;
    }

    const errorPtr = resultError(this.handle);
    if (errorPtr === 0) {
      return null;
    }

    return readString(this.wasm, errorPtr);
  }

  /**
   * Gets query execution statistics.
   *
   * @returns Statistics including elapsed time, rows read, and bytes read
   * @throws Error if the result has been freed
   */
  getStatistics(): ChdbStatistics {
    this.checkFreed();

    const resultElapsed =
      this.wasm.exports.chdb_result_elapsed ??
      this.wasm.exports._chdb_result_elapsed;
    const resultRowsRead =
      this.wasm.exports.chdb_result_rows_read ??
      this.wasm.exports._chdb_result_rows_read;
    const resultBytesRead =
      this.wasm.exports.chdb_result_bytes_read ??
      this.wasm.exports._chdb_result_bytes_read;
    const resultStorageRowsRead =
      this.wasm.exports.chdb_result_storage_rows_read ??
      this.wasm.exports._chdb_result_storage_rows_read;
    const resultStorageBytesRead =
      this.wasm.exports.chdb_result_storage_bytes_read ??
      this.wasm.exports._chdb_result_storage_bytes_read;

    const stats: ChdbStatistics = {
      elapsed: resultElapsed ? resultElapsed(this.handle) : 0,
      rowsRead: resultRowsRead ? Number(resultRowsRead(this.handle)) : 0,
      bytesRead: resultBytesRead ? Number(resultBytesRead(this.handle)) : 0,
    };

    if (resultStorageRowsRead) {
      stats.storageRowsRead = Number(resultStorageRowsRead(this.handle));
    }

    if (resultStorageBytesRead) {
      stats.storageBytesRead = Number(resultStorageBytesRead(this.handle));
    }

    return stats;
  }

  /**
   * Checks if this result has an error.
   *
   * @returns True if the result contains an error
   */
  hasError(): boolean {
    return this.getError() !== null;
  }

  /**
   * Frees the result and releases associated memory.
   * Must be called when the result is no longer needed.
   *
   * Calling free() multiple times is safe (subsequent calls are no-ops).
   */
  free(): void {
    if (this.freed) return;

    const destroyResult =
      this.wasm.exports.chdb_destroy_query_result ??
      this.wasm.exports._chdb_destroy_query_result;

    if (destroyResult && this.handle !== 0) {
      destroyResult(this.handle);
    }

    this.freed = true;
    this.handle = 0;
  }

  /**
   * Checks if this result has been freed.
   *
   * @returns True if free() has been called
   */
  isFreed(): boolean {
    return this.freed;
  }

  /**
   * Gets the raw handle pointer.
   * @internal
   */
  getHandle(): number {
    return this.handle;
  }

  private checkFreed(): void {
    if (this.freed) {
      throw new Error('ChdbResult has been freed');
    }
  }
}

// =============================================================================
// ChdbConnection Class
// =============================================================================

/**
 * Represents a connection to the chdb database engine.
 *
 * Only one active connection is allowed per WASM instance.
 * Creating a new connection with a different path requires closing the existing connection.
 *
 * @example
 * ```typescript
 * // In-memory database (default)
 * const conn = await ChdbConnection.connect(wasmModule);
 *
 * // With persistent storage path
 * const conn = await ChdbConnection.connect(wasmModule, "/data/mydb");
 *
 * try {
 *   const result = await conn.query("SELECT 1 + 1 AS answer");
 *   console.log(result.getText());
 *   result.free();
 * } finally {
 *   conn.close();
 * }
 * ```
 */
export class ChdbConnection {
  private handle: number;
  private wasm: { exports: FlexibleWasmExports };
  private closed = false;

  private constructor(
    handle: number,
    wasm: { exports: FlexibleWasmExports }
  ) {
    this.handle = handle;
    this.wasm = wasm;
  }

  /**
   * Creates a new chdb connection.
   *
   * @param wasm - The loaded WASM module instance
   * @param dataPath - Path to database storage (default: ":memory:" for in-memory)
   * @returns A Promise that resolves to a new ChdbConnection
   * @throws Error if connection creation fails
   *
   * @example
   * ```typescript
   * // In-memory database
   * const conn = await ChdbConnection.connect(wasmModule);
   *
   * // Persistent database
   * const conn = await ChdbConnection.connect(wasmModule, "/path/to/data");
   * ```
   */
  static async connect(
    wasm: { exports: FlexibleWasmExports },
    dataPath = ':memory:'
  ): Promise<ChdbConnection> {
    const connect = wasm.exports.chdb_connect ?? wasm.exports._chdb_connect;

    if (!connect) {
      throw new Error('chdb_connect function not found in WASM exports');
    }

    // Build argv: ["clickhouse", "--path=<path>"]
    const args =
      dataPath === ':memory:'
        ? ['clickhouse']
        : ['clickhouse', `--path=${dataPath}`];

    const { argvPtr, argPtrs } = buildArgv(wasm, args);

    try {
      const connPtr = connect(args.length, argvPtr);

      if (connPtr === 0) {
        throw new Error('Failed to create chdb connection');
      }

      // The connect function returns a pointer to a connection pointer
      // We need to dereference it to get the actual connection handle
      const view = new DataView(wasm.exports.memory.buffer);
      const handle = view.getUint32(connPtr, true);

      if (handle === 0) {
        throw new Error('Connection handle is null');
      }

      return new ChdbConnection(handle, wasm);
    } finally {
      freeArgv(wasm, argvPtr, argPtrs);
    }
  }

  /**
   * Executes a SQL query on this connection.
   *
   * @param sql - The SQL query to execute
   * @param format - Output format (default: "JSON")
   * @returns A Promise that resolves to a ChdbResult
   * @throws Error if the connection is closed or query execution fails
   *
   * @example
   * ```typescript
   * const result = await conn.query("SELECT 1 + 1 AS answer", "JSON");
   * console.log(result.getText());
   * result.free();
   * ```
   */
  async query(sql: string, format = 'JSON'): Promise<ChdbResult> {
    this.checkClosed();

    const query = this.wasm.exports.chdb_query ?? this.wasm.exports._chdb_query;

    if (!query) {
      throw new Error('chdb_query function not found in WASM exports');
    }

    const sqlPtr = allocateString(this.wasm, sql);
    const formatPtr = allocateString(this.wasm, format);

    try {
      const resultPtr = query(this.handle, sqlPtr, formatPtr);

      if (resultPtr === 0) {
        throw new Error('Query returned null result');
      }

      const result = new ChdbResult(resultPtr, this.wasm);

      // Check for query error
      const error = result.getError();
      if (error) {
        result.free();
        throw new Error(error);
      }

      return result;
    } finally {
      freeMemory(this.wasm, sqlPtr);
      freeMemory(this.wasm, formatPtr);
    }
  }

  /**
   * Executes a SQL query with explicit string lengths (binary-safe).
   * Use this when queries may contain null bytes.
   *
   * @param sql - The SQL query to execute
   * @param format - Output format (default: "JSON")
   * @returns A Promise that resolves to a ChdbResult
   * @throws Error if the connection is closed or query execution fails
   */
  async queryBinarySafe(sql: string, format = 'JSON'): Promise<ChdbResult> {
    this.checkClosed();

    const queryN =
      this.wasm.exports.chdb_query_n ?? this.wasm.exports._chdb_query_n;

    if (!queryN) {
      // Fall back to regular query
      return this.query(sql, format);
    }

    const encoder = new TextEncoder();
    const sqlBytes = encoder.encode(sql);
    const formatBytes = encoder.encode(format);

    const malloc = this.wasm.exports.malloc ?? this.wasm.exports._malloc;
    if (!malloc) {
      throw new Error('malloc function not found in WASM exports');
    }

    const sqlPtr = malloc(sqlBytes.length);
    const formatPtr = malloc(formatBytes.length);

    if (sqlPtr === 0 || formatPtr === 0) {
      freeMemory(this.wasm, sqlPtr);
      freeMemory(this.wasm, formatPtr);
      throw new Error('Failed to allocate memory');
    }

    const heap = new Uint8Array(this.wasm.exports.memory.buffer);
    heap.set(sqlBytes, sqlPtr);
    heap.set(formatBytes, formatPtr);

    try {
      const resultPtr = queryN(
        this.handle,
        sqlPtr,
        sqlBytes.length,
        formatPtr,
        formatBytes.length
      );

      if (resultPtr === 0) {
        throw new Error('Query returned null result');
      }

      const result = new ChdbResult(resultPtr, this.wasm);

      const error = result.getError();
      if (error) {
        result.free();
        throw new Error(error);
      }

      return result;
    } finally {
      freeMemory(this.wasm, sqlPtr);
      freeMemory(this.wasm, formatPtr);
    }
  }

  /**
   * Starts a streaming query and returns an async iterator for the results.
   *
   * @param sql - The SQL query to execute
   * @param format - Output format (default: "JSON")
   * @returns An async iterable of result chunks as Uint8Array
   * @throws Error if streaming is not supported or connection is closed
   *
   * @example
   * ```typescript
   * for await (const chunk of conn.queryStream("SELECT * FROM large_table")) {
   *   process.stdout.write(new TextDecoder().decode(chunk));
   * }
   * ```
   */
  async *queryStream(
    sql: string,
    format = 'JSON'
  ): AsyncGenerator<Uint8Array, void, unknown> {
    this.checkClosed();

    const streamQuery =
      this.wasm.exports.chdb_stream_query ??
      this.wasm.exports._chdb_stream_query;
    const streamFetch =
      this.wasm.exports.chdb_stream_fetch_result ??
      this.wasm.exports._chdb_stream_fetch_result;
    const destroyResult =
      this.wasm.exports.chdb_destroy_query_result ??
      this.wasm.exports._chdb_destroy_query_result;

    if (!streamQuery || !streamFetch) {
      throw new Error('Streaming query functions not found in WASM exports');
    }

    const sqlPtr = allocateString(this.wasm, sql);
    const formatPtr = allocateString(this.wasm, format);

    try {
      const streamHandle = streamQuery(this.handle, sqlPtr, formatPtr);

      if (streamHandle === 0) {
        throw new Error('Failed to start streaming query');
      }

      // Check for initial error
      const initialResult = new ChdbResult(streamHandle, this.wasm);
      const error = initialResult.getError();
      if (error) {
        initialResult.free();
        throw new Error(error);
      }

      try {
        while (true) {
          const chunkPtr = streamFetch(this.handle, streamHandle);

          if (chunkPtr === 0) break;

          const chunkResult = new ChdbResult(chunkPtr, this.wasm);
          const data = chunkResult.getData();

          if (data.length === 0) {
            chunkResult.free();
            break;
          }

          yield data;

          if (destroyResult) {
            destroyResult(chunkPtr);
          }
        }
      } finally {
        // Clean up the stream handle
        if (destroyResult) {
          destroyResult(streamHandle);
        }
      }
    } finally {
      freeMemory(this.wasm, sqlPtr);
      freeMemory(this.wasm, formatPtr);
    }
  }

  /**
   * Cancels an ongoing streaming query.
   *
   * @param result - The streaming result to cancel
   */
  cancelStream(result: ChdbResult): void {
    this.checkClosed();

    const cancelQuery =
      this.wasm.exports.chdb_stream_cancel_query ??
      this.wasm.exports._chdb_stream_cancel_query;

    if (cancelQuery && !result.isFreed()) {
      cancelQuery(this.handle, result.getHandle());
    }
  }

  /**
   * Closes the connection and releases all resources.
   * Must be called when the connection is no longer needed.
   *
   * Calling close() multiple times is safe (subsequent calls are no-ops).
   */
  close(): void {
    if (this.closed) return;

    const closeConn =
      this.wasm.exports.chdb_close_conn ?? this.wasm.exports._chdb_close_conn;

    if (closeConn && this.handle !== 0) {
      closeConn(this.handle);
    }

    this.closed = true;
    this.handle = 0;
  }

  /**
   * Checks if this connection has been closed.
   *
   * @returns True if close() has been called
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Gets the raw connection handle.
   * @internal
   */
  getHandle(): number {
    return this.handle;
  }

  private checkClosed(): void {
    if (this.closed) {
      throw new Error('ChdbConnection has been closed');
    }
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Executes a one-off query without maintaining a connection.
 * Uses the command-line interface style API.
 *
 * This is useful for simple queries where connection overhead is not desired.
 *
 * @param wasm - The WASM module instance
 * @param sql - The SQL query to execute
 * @param format - Output format (default: "JSON")
 * @returns The query result as a string
 * @throws Error if the query fails
 *
 * @example
 * ```typescript
 * const result = await queryOnce(wasmModule, "SELECT 1 + 1 AS answer");
 * console.log(result); // {"data":[{"answer":2}],...}
 * ```
 */
export async function queryOnce(
  wasm: { exports: FlexibleWasmExports },
  sql: string,
  format = 'JSON'
): Promise<string> {
  const queryCmdline =
    wasm.exports.chdb_query_cmdline ?? wasm.exports._chdb_query_cmdline;

  if (!queryCmdline) {
    // Fall back to connection-based API
    const conn = await ChdbConnection.connect(wasm);
    try {
      const result = await conn.query(sql, format);
      try {
        return result.getText();
      } finally {
        result.free();
      }
    } finally {
      conn.close();
    }
  }

  const args = ['clickhouse', `--query=${sql}`, `--format=${format}`];

  const { argvPtr, argPtrs } = buildArgv(wasm, args);

  try {
    const resultPtr = queryCmdline(args.length, argvPtr);

    if (resultPtr === 0) {
      throw new Error('Query returned null result');
    }

    const result = new ChdbResult(resultPtr, wasm);
    try {
      const error = result.getError();
      if (error) {
        throw new Error(error);
      }
      return result.getText();
    } finally {
      result.free();
    }
  } finally {
    freeArgv(wasm, argvPtr, argPtrs);
  }
}

/**
 * Initializes the WASM module by calling any necessary constructors.
 * Should be called after instantiation but before using other functions.
 *
 * @param wasm - The WASM module instance
 */
export function initializeWasm(wasm: { exports: FlexibleWasmExports }): void {
  if (wasm.exports._initialize) {
    wasm.exports._initialize();
  } else if (wasm.exports.__wasm_call_ctors) {
    wasm.exports.__wasm_call_ctors();
  }
}

/**
 * Helper to resolve a function that may have underscore prefix.
 * Returns the function or undefined if not found.
 *
 * @param exports - The WASM exports object
 * @param name - The function name (without underscore)
 * @returns The function if found, otherwise undefined
 *
 * @example
 * ```typescript
 * const malloc = resolveExport(wasm.exports, 'malloc');
 * if (!malloc) throw new Error('malloc not found');
 * ```
 */
export function resolveExport<T>(
  exports: Record<string, unknown>,
  name: string
): T | undefined {
  return (exports[name] ?? exports[`_${name}`]) as T | undefined;
}
