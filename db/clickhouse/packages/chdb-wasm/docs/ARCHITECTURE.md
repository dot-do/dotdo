# chdb-wasm Architecture

This document describes how real ClickHouse runs as WebAssembly on Cloudflare Workers.

## Overview

```
+------------------+
| vendor/chdb      |  ClickHouse C++ Source Code
| (git submodule)  |  - SQL Parser
+--------+---------+  - Query Executor
         |            - Aggregate Functions
         v            - Table Engines
+------------------+
| Emscripten       |  C++ to WebAssembly Compiler
| + CMake          |  - WASM binary output
+--------+---------+  - JavaScript bindings
         |            - Memory management
         v
+------------------+
| chdb-*.wasm      |  WebAssembly Modules
| chdb-*.js        |  - Multiple build profiles
+--------+---------+  - Dynamic extensions
         |
         v
+------------------+
| Cloudflare       |  Edge Runtime
| Workers          |  - 128MB memory limit
+------------------+  - Static Assets for WASM
                      - Durable Objects for state
                      - R2 for large data
```

## The Build Pipeline

### 1. Source Code (vendor/chdb)

The `vendor/chdb` git submodule contains the ClickHouse source code. Key components used:

| Component | Purpose |
|-----------|---------|
| `src/Parsers/` | SQL lexer and parser |
| `src/Interpreters/` | Query execution logic |
| `src/AggregateFunctions/` | COUNT, SUM, AVG, etc. |
| `src/Functions/` | String, math, date functions |
| `src/Storages/` | MergeTree, Memory engines |
| `src/Formats/` | JSON, CSV, Parquet output |

### 2. Emscripten Compilation

CMake configures the build with Emscripten flags optimized for Cloudflare Workers:

```cmake
# Memory configuration
-sINITIAL_MEMORY=16777216    # 16MB initial
-sMAXIMUM_MEMORY=134217728   # 128MB maximum (Workers limit)
-sALLOW_MEMORY_GROWTH=1

# Module configuration
-sMODULARIZE=1               # ES module output
-sEXPORT_ES6=1
-sMAIN_MODULE=2              # Support dynamic extensions

# Size optimization
-Oz                          # Aggressive size optimization
-sMALLOC=emmalloc            # Smallest allocator
--closure=1                  # JS minification
```

### 3. WASM Module Output

Each build profile produces:

```
dist/
  dashboard/
    chdb-dashboard.wasm     # Binary (3MB)
    chdb-dashboard.js       # Loader/bindings
  analytics/
    chdb-analytics.wasm     # Binary (8MB)
    chdb-analytics.js
  ...
```

### 4. Dynamic Extensions (SIDE_MODULEs)

Large features compile as separate modules loaded on demand:

```
extensions/
  ext-geo.wasm              # H3, S2 geometry
  ext-json.wasm             # JSONPath, extraction
  ext-crypto.wasm           # Hashing, encryption
  ext-parquet.wasm          # Parquet reading
```

Extensions use Emscripten's dynamic linking:
- Share memory with the main module
- Share function tables
- Load only when needed

## Runtime Architecture

### Cloudflare Workers Integration

```
                    +----------------------------------+
                    |      Cloudflare Workers          |
                    |      (V8 Isolate Runtime)        |
                    +----------------------------------+
                                    |
          +-------------------------+-------------------------+
          |                         |                         |
          v                         v                         v
+------------------+    +------------------+    +------------------+
|   worker.ts      |    |  Static Assets   |    |   R2 Bucket      |
|   Entry Point    |    |  (WASM files)    |    |   (Data)         |
+------------------+    +------------------+    +------------------+
          |
          v
+------------------+
| HTTP Query       |
| Handler          |
+--------+---------+
         |
         v
+------------------+
| WASM Runtime     |    Real ClickHouse execution
| (chdb-*.wasm)    |    - SQL parsing
+--------+---------+    - Query planning
         |              - Aggregate computation
         v              - Result formatting
+------------------+
| Storage Layer    |
| - Durable Objects|    Persistent state
| - R2 VFS         |    Large file access
+------------------+
```

### Memory Budget (128MB Workers Limit)

```
Total Available:                128MB
-------------------------------------
V8 Runtime Overhead:            ~10MB
Worker Script + Dependencies:    ~5MB
WASM Module Instance:          ~45MB  (varies by profile)
Query Working Memory:          ~50MB
Result Buffers:                ~15MB
Safety Margin:                  ~3MB
```

### Request Flow

1. **HTTP Request** arrives at Worker
2. **WASM Module** loads from Static Assets (cached after first load)
3. **SQL Parser** tokenizes and validates the query
4. **Query Executor** runs the plan
5. **Storage Layer** fetches data (DO or R2)
6. **Result Formatter** outputs JSON/CSV/etc.
7. **HTTP Response** returns to client

## Storage Architecture

### Durable Objects (Stateful Edge Storage)

```typescript
// Memory Engine backed by Durable Objects
export class MemoryEngineDO implements DurableObject {
  // Stores table data across Worker restarts
  // Chunked to respect 128KB per-key limit
  // Transaction support for atomicity
}
```

Use cases:
- Memory engine tables that persist
- Session state
- Small datasets (<10GB per DO)

### R2 (Object Storage)

```typescript
// Virtual File System over R2
class R2VFS {
  // Range requests for partial reads
  // Read-ahead buffering
  // Concurrent read limiting
  // Retry with exponential backoff
}
```

Use cases:
- Large Parquet files
- ClickBench datasets
- MergeTree data parts

## Extension Loading

### Auto-Detection

The query analyzer scans SQL to detect required extensions:

```sql
SELECT geoToH3(lat, lon, 7), cityHash64(name)
FROM locations
```

Detected functions:
- `geoToH3` -> requires `ext-geo.wasm`
- `cityHash64` -> requires `ext-crypto.wasm`

### Dynamic Loading

```typescript
const loader = new ExtensionLoader({
  assets: env.ASSETS,
  extensions: ['ext-geo', 'ext-crypto']
});

// Load on demand
await loader.ensureLoaded('ext-geo');

// Extensions share memory with core module
// Cross-module calls via shared function table
```

## Build Profiles

| Profile | Size | What's Included |
|---------|------|-----------------|
| `parser` | ~300KB | Lexer, parser, AST |
| `dashboard` | ~3MB | + Memory engine, basic aggregates, JSON/CSV |
| `analytics` | ~8MB | + MergeTree, all aggregates, CTEs |
| `etl` | ~12-15MB | + Parquet/Arrow, window functions |
| `lakehouse` | ~18-20MB | + S3/URL table functions |
| `full` | ~25MB+ | + Geo, all formats, all engines |

## HTTP API Compatibility

The Worker implements ClickHouse's HTTP interface:

```
GET  /?query=SELECT+1          Query via URL parameter
POST /                         Query in request body
GET  /play                     Interactive SQL UI
GET  /ping                     Health check
GET  /replicas_status          Replica status
```

Supported output formats:
- `JSON`, `JSONEachRow`, `JSONCompact`
- `TabSeparated`, `TSV`, `TSVWithNames`
- `CSV`, `CSVWithNames`
- `Markdown`, `Pretty`
- `XML`

## Performance Characteristics

| Operation | Latency |
|-----------|---------|
| Cold start (WASM load) | ~50-200ms |
| Warm query (simple) | ~5-20ms |
| Warm query (complex) | ~50-500ms |
| DO storage read | ~1-5ms |
| R2 read (cached) | ~10-50ms |
| R2 read (uncached) | ~50-200ms |

## Key Design Decisions

### Why Emscripten?

- Mature toolchain for C++ to WASM
- Supports dynamic linking (SIDE_MODULE)
- Memory growth within limits
- Good WASI compatibility

### Why Dynamic Extensions?

- Reduce initial load time
- Load only what queries need
- Keep core module small
- Modular development

### Why Durable Objects?

- Persistent state at edge
- Single-writer consistency
- Low latency storage
- Global addressing

### Why R2?

- S3-compatible API
- No egress fees
- Global distribution
- Large object support (5TB)

## Limitations

1. **Memory**: 128MB hard limit in Workers
2. **CPU**: 30s max execution time (Unbound)
3. **Storage**: DO 10GB per object, R2 unlimited but slower
4. **Networking**: No outbound TCP (use HTTP-based alternatives)
5. **Threads**: Single-threaded (no parallel query execution)
