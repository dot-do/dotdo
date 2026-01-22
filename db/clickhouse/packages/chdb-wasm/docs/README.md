# chdb-wasm Documentation

**Real ClickHouse running as WebAssembly on Cloudflare Workers**

This package brings the actual ClickHouse database engine to the edge, compiled to WebAssembly via Emscripten. This is not a simulation or mock - it's the real ClickHouse C++ codebase running in your browser or Cloudflare Worker.

## Quick Links

| Document | Description |
|----------|-------------|
| [Getting Started](./GETTING_STARTED.md) | Install, build, and run your first query |
| [Architecture](./ARCHITECTURE.md) | How ClickHouse WASM works |
| [Build Profiles](./BUILD_PROFILES.md) | Choose the right WASM build for your use case |
| [Testing](./TESTING.md) | Run tests across Node.js, workerd, and deployed workers |

## What This Is

```
vendor/chdb (ClickHouse C++ source)
        |
        v
   Emscripten
        |
        v
  chdb-*.wasm (WebAssembly modules)
        |
        v
  Cloudflare Workers / Browsers
```

This project compiles ClickHouse's C++ source code to WebAssembly using Emscripten. The result is a fully functional SQL database that runs:

- **In Cloudflare Workers** - Execute ClickHouse queries at the edge with sub-100ms latency
- **In browsers** - Run analytics directly in the user's browser
- **Without servers** - No database to manage, pay only for what you use

## Key Features

- **Real ClickHouse SQL** - Full SQL support including aggregates, JOINs, CTEs, window functions
- **Multiple output formats** - JSON, CSV, TSV, Parquet, XML, Markdown
- **Edge storage** - Durable Objects for state, R2 for large datasets
- **Dynamic extensions** - Load specialized functions (geo, JSON, crypto) on demand
- **Build profiles** - From 300KB (parser only) to 25MB+ (full ClickHouse)

## Example Usage

```typescript
// In a Cloudflare Worker
import { createChdb } from '@dotdo/chdb-wasm';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const chdb = await createChdb({ assets: env.ASSETS });

    const result = await chdb.query(`
      SELECT
        toDate(timestamp) as day,
        count() as events,
        uniqExact(user_id) as users
      FROM events
      WHERE timestamp >= today() - 7
      GROUP BY day
      ORDER BY day DESC
    `, { format: 'JSON' });

    return new Response(result, {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

## Build Profiles

Choose the right profile for your use case:

| Profile | Size | Use Case |
|---------|------|----------|
| `parser` | ~300KB | SQL validation, IDE integration |
| `dashboard` | ~3MB | Simple dashboards, small datasets |
| `analytics` | ~8MB | ClickBench-style OLAP analytics |
| `etl` | ~12-15MB | Parquet/Arrow processing, ETL pipelines |
| `lakehouse` | ~18-20MB | Query S3/R2 data lakes directly |
| `full` | ~25MB+ | Maximum ClickHouse compatibility |

## How It Works

1. **Vendor Submodule**: The `vendor/chdb` directory contains the ClickHouse source code
2. **Emscripten Build**: CMake + Emscripten compiles C++ to WebAssembly
3. **WASM Modules**: Output includes `.wasm` binary and `.js` loader
4. **Worker Integration**: WASM loads via Cloudflare Static Assets
5. **Query Execution**: SQL runs in the actual ClickHouse engine

## Source Code Structure

```
packages/chdb-wasm/
  src/
    worker.ts           # Cloudflare Worker entry point
    http-query-handler.ts  # ClickHouse HTTP API compatibility
    wasm/               # WASM loading and bindings
    storage/            # Durable Objects storage layer
    table-engines/      # External table engines (Turso, PGlite)
  wasm/                 # C++ WASM source code
    core/               # Core WASM module
    extensions/         # Dynamic extension modules
  cmake/                # CMake build configuration
  vendor/chdb/          # ClickHouse source (git submodule)
```

## Next Steps

1. **[Getting Started](./GETTING_STARTED.md)** - Build and run your first query
2. **[Architecture](./ARCHITECTURE.md)** - Understand the system design
3. **[Build Profiles](./BUILD_PROFILES.md)** - Choose your WASM configuration
