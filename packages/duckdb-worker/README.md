# @dotdo/duckdb-worker

DuckDB WASM optimized for Cloudflare Workers runtime. Run SQL analytics at the edge with 0ms cold starts.

## Features

- Custom DuckDB WASM build optimized for Cloudflare Workers V8 isolates
- No GOT imports - compatible with Workers runtime restrictions
- In-memory virtual filesystem for buffer registration
- Type-safe TypeScript API with full type definitions
- Module caching for efficient reuse across requests

## Installation

```bash
npm install @dotdo/duckdb-worker
```

## Quick Start

```typescript
import { createDuckDB } from '@dotdo/duckdb-worker'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Create a DuckDB instance
    const db = await createDuckDB()

    // Run SQL queries
    const result = await db.query('SELECT 1 + 1 as answer')
    console.log(result.rows[0].answer) // 2

    // Create tables and insert data
    await db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name VARCHAR,
        email VARCHAR
      )
    `)

    await db.exec(`
      INSERT INTO users VALUES
        (1, 'Alice', 'alice@example.com.ai'),
        (2, 'Bob', 'bob@example.com.ai')
    `)

    const users = await db.query('SELECT * FROM users')

    // Clean up
    await db.close()

    return Response.json(users.rows)
  }
}
```

## Usage with WASM Module Binding

For optimal performance, bind the WASM module directly in your `wrangler.toml`:

```toml
# wrangler.toml
[wasm_modules]
DUCKDB_WASM = "node_modules/@dotdo/duckdb-worker/wasm/duckdb-worker.wasm"
```

Then use the pre-compiled module:

```typescript
import { createDuckDB } from '@dotdo/duckdb-worker'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Use the pre-compiled WASM module binding
    const db = await createDuckDB({}, { wasmModule: env.DUCKDB_WASM })

    const result = await db.query('SELECT version() as version')
    await db.close()

    return Response.json(result.rows[0])
  }
}

interface Env {
  DUCKDB_WASM: WebAssembly.Module
}
```

## API Reference

### createDuckDB(config?, loadOptions?)

Creates a new DuckDB instance.

```typescript
const db = await createDuckDB(config?, loadOptions?)
```

#### Parameters

- `config` (optional): DuckDB configuration options
  - `maxMemory`: Memory limit (e.g., '256MB', '1GB')
  - `threads`: Number of threads (default: 1 in Workers)
  - `accessMode`: 'automatic' | 'read_only' | 'read_write'
  - `defaultOrder`: 'asc' | 'desc'

- `loadOptions` (optional): WASM loading options
  - `wasmBinary`: Pre-loaded WASM binary (ArrayBuffer)
  - `wasmModule`: Pre-compiled WebAssembly.Module
  - `loaderModule`: Pre-loaded Emscripten loader

### DuckDBInstance

#### query<T>(sql, params?)

Execute a SQL query and return results.

```typescript
const result = await db.query<{ id: number; name: string }>('SELECT * FROM users')
// result.rows: Array<{ id: number; name: string }>
// result.columns: Array<{ name: string; type: string; typeCode: number }>
// result.rowCount: number
// result.success: boolean
```

#### exec(sql, params?)

Execute a SQL statement without returning results.

```typescript
await db.exec('CREATE TABLE items (id INTEGER, name VARCHAR)')
await db.exec('INSERT INTO items VALUES (1, "Widget")')
```

#### registerFileBuffer(name, buffer)

Register an in-memory buffer as a virtual file.

```typescript
// Load Parquet from R2
const parquetData = await env.BUCKET.get('data.parquet')
const buffer = await parquetData.arrayBuffer()

db.registerFileBuffer('data.parquet', buffer)

// Query the Parquet file directly
const result = await db.query('SELECT * FROM read_parquet("data.parquet")')
```

#### dropFile(name)

Remove a registered virtual file.

```typescript
db.dropFile('data.parquet')
```

#### close()

Close the database and release resources.

```typescript
await db.close()
```

#### isOpen()

Check if the database instance is still open.

```typescript
if (db.isOpen()) {
  // Database is ready for queries
}
```

### instantiateDuckDB(loadOptions?)

Pre-load the WASM module during worker initialization.

```typescript
import { instantiateDuckDB, createDuckDB } from '@dotdo/duckdb-worker'

// Pre-load during initialization
const result = await instantiateDuckDB({ wasmModule: env.DUCKDB_WASM })
if (!result.success) {
  console.error('Failed to load DuckDB:', result.error)
}

// Later, createDuckDB will use the cached module
const db = await createDuckDB()
```

### File Buffer Utilities

```typescript
import {
  registerFileBuffer,
  dropFile,
  getFileBuffer,
  hasFile,
  listFiles,
  getFileSize,
  clearAllFiles,
  getTotalMemoryUsage
} from '@dotdo/duckdb-worker'

// Register a buffer
registerFileBuffer('sales.parquet', buffer)

// Check if file exists
if (hasFile('sales.parquet')) {
  console.log('File size:', getFileSize('sales.parquet'))
}

// List all registered files
console.log('Files:', listFiles())

// Get total memory usage
console.log('Memory usage:', getTotalMemoryUsage(), 'bytes')

// Clean up
clearAllFiles()
```

## Data Types

DuckDB types are automatically converted to JavaScript types:

| DuckDB Type | JavaScript Type |
|-------------|-----------------|
| BOOLEAN | boolean |
| TINYINT, SMALLINT, INTEGER | number |
| BIGINT, HUGEINT | BigInt |
| FLOAT, DOUBLE, DECIMAL | number |
| VARCHAR, TEXT | string |
| DATE, TIME, TIMESTAMP | string (ISO format) |
| BLOB | string (base64) |
| NULL | null |

## Working with Parquet

```typescript
// Load Parquet from R2
const data = await env.BUCKET.get('analytics/events.parquet')
db.registerFileBuffer('events.parquet', await data.arrayBuffer())

// Query with full SQL support
const result = await db.query(`
  SELECT
    date_trunc('day', timestamp) as day,
    event_type,
    COUNT(*) as count
  FROM read_parquet('events.parquet')
  WHERE timestamp > '2024-01-01'
  GROUP BY 1, 2
  ORDER BY count DESC
  LIMIT 100
`)
```

## Performance Tips

1. **Use WASM module bindings** - Pre-compiled modules skip compilation on each request
2. **Reuse instances** - Store the DuckDB instance in a Durable Object for persistence
3. **Register buffers once** - Avoid re-registering the same data across queries
4. **Use appropriate data types** - DuckDB's columnar format excels with analytical queries

## Limitations

- **Single-threaded** - Workers V8 isolates don't support WebWorkers
- **Memory limits** - Subject to Workers memory limits (128MB default, 512MB on paid plans)
- **No persistent storage** - Use R2, D1, or Durable Objects for persistence
- **In-memory only** - Database exists only for the request lifetime (unless using DO)

## License

MIT
