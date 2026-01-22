# @dotdo/chdb-wasm

**Real ClickHouse compiled to WebAssembly, running on Cloudflare Workers.**

This is **actual ClickHouse** - the same C++ codebase that powers ClickHouse Cloud and self-hosted deployments - compiled to WebAssembly via Emscripten and optimized for edge computing.

## What This IS

- **Real ClickHouse**: The actual ClickHouse C++ codebase from `vendor/chdb` (chDB - ClickHouse embedded)
- **Compiled via Emscripten**: C++ source code compiled to WebAssembly binary
- **Running on Cloudflare Workers**: Full ClickHouse SQL execution at the edge
- **Full SQL Compatibility**: Same SQL dialect, same functions, same behavior as ClickHouse

## What This is NOT

- NOT a JavaScript SQL engine
- NOT a mock implementation
- NOT a partial reimplementation
- NOT a SQL parser that pretends to be ClickHouse

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Build Pipeline                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   vendor/chdb (ClickHouse C++ Source)                           │
│          │                                                       │
│          ▼                                                       │
│   Emscripten (emcc) - C++ to WASM Compiler                      │
│          │                                                       │
│          ▼                                                       │
│   chdb.wasm (WebAssembly Binary)                                │
│          │                                                       │
│          ▼                                                       │
│   Cloudflare Workers (V8 Isolate Runtime)                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Source: vendor/chdb

The `vendor/chdb` directory contains the [chDB](https://github.com/chdb-io/chdb) project - ClickHouse compiled as an embeddable library. This is the **exact same SQL engine** that powers:

- ClickHouse Cloud
- Self-hosted ClickHouse servers
- chDB Python bindings

### Compilation: Emscripten

The C++ source is compiled to WebAssembly using [Emscripten](https://emscripten.org/):

```bash
# Build process (simplified)
emcmake cmake -S vendor/chdb -B build
emmake make -C build
```

This produces a `.wasm` binary containing the compiled ClickHouse engine.

### Runtime: Cloudflare Workers

The WASM binary runs in Cloudflare Workers' V8 isolate environment, providing:

- Sub-millisecond cold starts
- Global edge distribution (150+ locations)
- 128MB memory per Worker
- ClickHouse-compatible HTTP interface

## Features

- **Full ClickHouse SQL**: SELECT, INSERT, WITH, JOIN, subqueries, window functions
- **Native Functions**: 500+ ClickHouse functions (math, string, date, array, etc.)
- **Aggregate Functions**: COUNT, SUM, AVG, MIN, MAX, quantile, groupArray, etc.
- **Table Functions**: url(), s3(), numbers(), generateRandom()
- **Output Formats**: JSON, JSONEachRow, CSV, TSV, Parquet, Arrow
- **Input Formats**: Parquet, CSV, JSON, TSV from URLs

## Installation

```bash
pnpm add @dotdo/chdb-wasm
```

## Usage

### Basic Query

```typescript
import { createChdb } from '@dotdo/chdb-wasm'

const chdb = await createChdb()

const result = await chdb.query(`
  SELECT number, number * 2 as doubled
  FROM numbers(10)
  FORMAT JSON
`)

console.log(result)
```

### With Cloudflare Workers

```typescript
import { createChdb } from '@dotdo/chdb-wasm'

export default {
  async fetch(request: Request): Promise<Response> {
    const chdb = await createChdb()

    const url = new URL(request.url)
    const query = url.searchParams.get('query') || 'SELECT 1'

    const result = await chdb.query(query, { format: 'JSONEachRow' })

    return new Response(result, {
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
```

### With Durable Objects

```typescript
import { createChdb, type ChdbInstance } from '@dotdo/chdb-wasm'

export class AnalyticsDO implements DurableObject {
  private chdb: ChdbInstance | null = null

  constructor(
    private state: DurableObjectState,
    private env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    // Initialize once - stays warm between requests
    if (!this.chdb) {
      this.chdb = await createChdb()
    }

    const query = await request.text()
    const result = await this.chdb.query(query)

    return new Response(result)
  }
}
```

## Querying Remote Data

```typescript
// Query Parquet files from R2/S3
const result = await chdb.query(`
  SELECT *
  FROM url('https://your-bucket.r2.cloudflarestorage.com/data.parquet')
  WHERE date >= '2024-01-01'
  LIMIT 1000
  FORMAT JSON
`)

// Query with credentials (via presigned URL or env)
const result = await chdb.query(`
  SELECT *
  FROM s3('https://bucket.s3.amazonaws.com/path/*.parquet',
          'access_key', 'secret_key')
  FORMAT JSON
`)
```

## Build Profiles

Import the profile that matches your needs:

```typescript
// Minimal - smallest size, basic features
import { createChdb } from '@dotdo/chdb-wasm/minimal'

// Standard - balanced size and features (default)
import { createChdb } from '@dotdo/chdb-wasm'

// Full - all features, largest size
import { createChdb } from '@dotdo/chdb-wasm/full'
```

### Profile Comparison

| Profile | Gzipped Size | Table Engines | Formats | Functions |
|---------|--------------|---------------|---------|-----------|
| `minimal` | ~3MB | Memory, URL | JSON, Parquet | Core SQL |
| `standard` | ~10MB | + MergeTree, S3 | + CSV, TSV, Arrow | + Aggregates |
| `full` | ~20MB | All supported | All supported | All supported |

## Configuration

```typescript
const chdb = await createChdb({
  // Memory limit in bytes (default: 64MB)
  memoryLimit: 64 * 1024 * 1024,

  // Enable query logging
  logging: true,

  // Custom settings
  settings: {
    max_threads: 1,
    max_block_size: 10000
  }
})
```

## Memory Management

The WASM module is designed for constrained environments:

```typescript
// Check memory usage
const stats = chdb.getMemoryStats()
console.log(`Used: ${stats.used / 1024 / 1024}MB`)
console.log(`Peak: ${stats.peak / 1024 / 1024}MB`)

// Clear query cache to free memory
chdb.clearCache()

// Dispose instance completely
chdb.dispose()
```

## Streaming Results

For large result sets, use streaming to avoid memory issues:

```typescript
const stream = await chdb.queryStream(`
  SELECT * FROM large_table
  FORMAT JSONEachRow
`)

for await (const chunk of stream) {
  // Process chunk
  console.log(chunk)
}
```

## Deploying the Cloudflare Worker

This package includes a Cloudflare Worker that provides a ClickHouse-compatible HTTP interface.

### Quick Start

```bash
# Install dependencies
pnpm install

# Run locally for development
pnpm dev

# Deploy to Cloudflare Workers
pnpm deploy
```

### Local Development

Start the development server:

```bash
pnpm dev
```

This will start a local server at `http://localhost:8787`. You can then:

- Open `http://localhost:8787/play` for the interactive SQL playground
- Query via HTTP: `curl "http://localhost:8787/?query=SELECT+1+as+result"`
- Check health: `curl http://localhost:8787/ping`

### HTTP Interface Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET/POST | Execute SQL queries (ClickHouse HTTP protocol) |
| `/play` | GET | Interactive SQL playground UI |
| `/ping` | GET | Health check endpoint (returns `Ok.`) |
| `/replicas_status` | GET | Compatibility endpoint (returns `Ok.`) |

### Query Execution

The worker supports the ClickHouse HTTP interface:

```bash
# GET request with query parameter
curl "http://localhost:8787/?query=SELECT%201%2B1%20as%20result"

# POST request with query in body
curl -X POST "http://localhost:8787/" -d "SELECT 1+1 as result"

# Specify output format
curl "http://localhost:8787/?query=SELECT+1&default_format=JSON"

# Using X-ClickHouse-Format header
curl -H "X-ClickHouse-Format: JSONEachRow" -X POST "http://localhost:8787/" -d "SELECT 1 as n"
```

### Supported Formats

- `JSON` - Full JSON with metadata
- `JSONCompact` - Compact JSON with arrays
- `JSONEachRow` - NDJSON (newline-delimited JSON)
- `CSV` / `CSVWithNames` - Comma-separated values
- `TSV` / `TSVWithNames` / `TabSeparated` - Tab-separated values

## Building from Source

Requires Emscripten SDK:

```bash
# Install emsdk
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest

# Build minimal profile
pnpm build:wasm:minimal

# Build all profiles
pnpm build:wasm
```

## Limitations

- **Memory**: ~128MB total for Workers, plan queries accordingly
- **CPU Time**: Workers have CPU time limits per request
- **No Persistence**: In-memory only, use DO SQLite for durability
- **Single-threaded**: No parallel query execution
- **Subset of Engines**: Not all ClickHouse table engines supported

## API Reference

### `createChdb(options?): Promise<ChdbInstance>`

Creates a new chdb instance.

### `ChdbInstance.query(sql, options?): Promise<string>`

Executes a query and returns results as a string.

### `ChdbInstance.queryStream(sql, options?): AsyncIterable<string>`

Executes a query and returns a streaming result.

### `ChdbInstance.getMemoryStats(): MemoryStats`

Returns current memory usage statistics.

### `ChdbInstance.clearCache(): void`

Clears internal caches to free memory.

### `ChdbInstance.dispose(): void`

Disposes the instance and frees all resources.

## License

Apache-2.0
