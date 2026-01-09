# duckdb.do

**DuckDB for Cloudflare Workers.** Edge-native OLAP. Parquet on R2. Infinite scale.

[![npm version](https://img.shields.io/npm/v/@dotdo/duckdb.svg)](https://www.npmjs.com/package/@dotdo/duckdb)
[![Tests](https://img.shields.io/badge/tests-117%20passing-brightgreen.svg)](#tests)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

```typescript
import { createDuckDB } from '@dotdo/duckdb'

const db = await createDuckDB()

// Query Parquet from R2
const object = await env.R2_BUCKET.get('analytics/sales.parquet')
await db.registerBuffer('sales.parquet', await object.arrayBuffer())

const result = await db.query(`
  SELECT region, SUM(revenue) as total
  FROM parquet_scan('sales.parquet')
  GROUP BY region
  ORDER BY total DESC
`)
```

## Why duckdb.do?

**DuckDB WASM doesn't run on Workers.** The standard builds use GOT.func and GOT.mem WASM imports that V8 isolates reject. We ship an optimized binary that works.

**HTTPFS doesn't work in WASM.** CORS blocks network requests from WebAssembly. We fetch Parquet from R2 in the Worker, then pass bytes to DuckDB via `registerBuffer()`.

**10GB per Durable Object.** That's the storage limit. We provide optional sharding that distributes data across multiple DOs. Scales to petabytes.

## Installation

```bash
npm install @dotdo/duckdb
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Worker                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Request ──▶ Worker ──▶ DuckDB WASM ──▶ Response                  │
│                  │            │                                     │
│                  ▼            ▼                                     │
│              R2 Bucket    In-Memory                                 │
│              (Parquet)    Analysis                                  │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│   Hot Tier        │   Warm Tier      │   Cold Tier                 │
│   (DuckDB)        │   (R2 Parquet)   │   (Archive)                 │
│   < 100MB         │   < 10GB         │   Unlimited                 │
│   Sub-ms query    │   ~50ms load     │   Minutes                   │
└─────────────────────────────────────────────────────────────────────┘
```

## API Reference

### Core Functions

| Function | Description |
|----------|-------------|
| `createDuckDB(config?)` | Create in-memory DuckDB instance |
| `createDotdoDuckDB(config?)` | Create with dotdo extensions (sharding, tiering) |
| `instantiateDuckDB(options?)` | Low-level WASM instantiation with metrics |
| `registerBuffer(db, name, buffer)` | Register ArrayBuffer as virtual file |
| `dropBuffer(db, name)` | Unregister a buffer |
| `clearCache()` | Clear WASM module cache |
| `isCached()` | Check if WASM is cached |
| `getHeapUsage()` | Estimate current heap usage |

### DuckDBInstance Methods

| Method | Description |
|--------|-------------|
| `query(sql, params?, options?)` | Execute SQL, return rows and columns |
| `registerBuffer(name, buffer, options?)` | Register data buffer as virtual file |
| `dropBuffer(name)` | Remove registered buffer |
| `close()` | Close connection, release resources |

### Configuration

```typescript
interface DuckDBConfig {
  path?: string           // ':memory:' (default)
  useThreads?: boolean    // false (Workers constraint)
  maxMemory?: number      // 100MB default
}

interface DotdoDuckDBConfig extends DuckDBConfig {
  shard?: {
    key: string           // Field to shard on
    count?: number        // Number of shards (default: 16)
    algorithm?: 'consistent' | 'range' | 'hash'
  }
  stream?: {
    pipeline: string      // Pipeline binding name
    sink?: 'iceberg' | 'parquet' | 'json'
  }
  tier?: {
    hot?: 'duckdb'
    warm?: 'r2'
    cold?: 'archive'
    hotThreshold?: string
    coldAfter?: string
  }
  r2Bucket?: R2Bucket
}
```

## Usage Patterns

### Basic In-Memory Analytics

```typescript
import { createDuckDB } from '@dotdo/duckdb'

const db = await createDuckDB()

// Create and query tables
await db.query('CREATE TABLE events (ts TIMESTAMP, type VARCHAR, value DOUBLE)')
await db.query(`INSERT INTO events VALUES
  (NOW(), 'click', 1.0),
  (NOW(), 'view', 0.5)
`)

const result = await db.query(`
  SELECT type, COUNT(*) as count, SUM(value) as total
  FROM events
  GROUP BY type
`)

await db.close()
```

### Parquet from R2

```typescript
import { createDuckDB } from '@dotdo/duckdb'

export default {
  async fetch(request: Request, env: Env) {
    const db = await createDuckDB()

    // Load Parquet from R2
    const object = await env.ANALYTICS_BUCKET.get('2024/sales.parquet')
    if (!object) return new Response('Not found', { status: 404 })

    await db.registerBuffer('sales.parquet', await object.arrayBuffer())

    // OLAP query
    const result = await db.query(`
      SELECT
        DATE_TRUNC('month', sale_date) as month,
        region,
        SUM(amount) as revenue,
        COUNT(*) as orders
      FROM parquet_scan('sales.parquet')
      WHERE sale_date >= '2024-01-01'
      GROUP BY ALL
      ORDER BY month, revenue DESC
    `)

    await db.close()

    return Response.json(result.rows)
  }
}
```

### dotdo Extensions

```typescript
import { createDotdoDuckDB } from '@dotdo/duckdb'

const db = await createDotdoDuckDB({
  r2Bucket: env.DATA_BUCKET,
  tier: {
    hot: 'duckdb',
    warm: 'r2',
    hotThreshold: '50MB',
  },
})

// Load directly from R2
await db.loadFromR2(env.DATA_BUCKET, 'analytics/events.parquet')

const result = await db.query(`
  SELECT * FROM parquet_scan('events.parquet')
  WHERE timestamp > NOW() - INTERVAL 1 HOUR
`)
```

### Multiple Parquet Files

```typescript
const db = await createDuckDB()

// Register multiple files
await Promise.all([
  db.loadFromR2(env.BUCKET, 'orders.parquet'),
  db.loadFromR2(env.BUCKET, 'customers.parquet'),
  db.loadFromR2(env.BUCKET, 'products.parquet'),
])

// Join across files
const result = await db.query(`
  SELECT
    c.name,
    p.category,
    SUM(o.amount) as total
  FROM parquet_scan('orders.parquet') o
  JOIN parquet_scan('customers.parquet') c ON o.customer_id = c.id
  JOIN parquet_scan('products.parquet') p ON o.product_id = p.id
  GROUP BY c.name, p.category
  ORDER BY total DESC
  LIMIT 100
`)
```

## Durable Object Integration

```typescript
import { createDuckDB, type DuckDBInstance } from '@dotdo/duckdb'

export class AnalyticsDO extends DurableObject {
  private db: DuckDBInstance | null = null

  async initialize() {
    if (!this.db) {
      this.db = await createDuckDB()
    }
    return this.db
  }

  async query(sql: string) {
    const db = await this.initialize()
    return db.query(sql)
  }

  async loadParquet(key: string) {
    const db = await this.initialize()
    const object = await this.ctx.storage.get(key)
    if (object) {
      await db.registerBuffer(key, object as ArrayBuffer)
    }
  }
}
```

## MCP Tools

duckdb.do exposes tools for AI agents via MCP:

| Tool | Description |
|------|-------------|
| `duckdb_query` | Execute SQL query and return results |
| `duckdb_load_parquet` | Load Parquet file from R2 |
| `duckdb_create_table` | Create table with schema |
| `duckdb_insert` | Insert rows into table |
| `duckdb_schema` | Get table schemas |

```typescript
// Agent usage
const result = await agent.tool('duckdb_query', {
  sql: 'SELECT * FROM sales WHERE region = $1',
  params: ['NA'],
})
```

## Performance

### Benchmarks

| Operation | Time | Notes |
|-----------|------|-------|
| Cold start | < 500ms | First WASM load |
| Warm start | < 50ms | Cached module |
| 10K row aggregation | < 100ms | GROUP BY + SUM |
| 1M row scan | < 500ms | Filter + COUNT |
| Parquet load (10MB) | ~100ms | R2 fetch + register |

### Memory Limits

| Tier | Limit | Use Case |
|------|-------|----------|
| Worker | 128MB | Query execution |
| Durable Object | 10GB | Persistent state |
| R2 | Unlimited | Cold storage |

### Optimization Tips

1. **Column projection** - Only SELECT columns you need
2. **Predicate pushdown** - Filter in WHERE, not in app code
3. **Parquet partitioning** - Partition by date/tenant in R2
4. **Buffer cleanup** - Call `dropBuffer()` when done
5. **Connection reuse** - Keep DuckDB instance across requests

## Comparison

| Feature | duckdb.do | duckdb-wasm | SQLite WASM |
|---------|-----------|-------------|-------------|
| Workers runtime | Yes | No | Yes |
| Parquet support | Yes | Yes | No |
| R2 integration | Yes | No | No |
| Sharding | Yes | No | No |
| OLAP optimized | Yes | Yes | No |
| Cold start | ~400ms | N/A | ~100ms |
| Max dataset | Unlimited* | 128MB | 10GB |

*With sharding across Durable Objects

## Tests

117 tests covering:

- WASM instantiation and memory limits
- SQL execution (DDL, DML, aggregations, joins, CTEs, window functions)
- Buffer registration and Parquet queries
- Performance benchmarks
- Workers runtime compatibility

```bash
npm test -- --project=workers compat/duckdb
```

## Limitations

- **Single-threaded** - Workers don't support SharedArrayBuffer
- **Memory-only** - No persistent filesystem in Workers
- **No HTTPFS** - CORS blocks WASM network requests
- **128MB limit** - Per-isolate memory constraint

## Related

- [DuckDB](https://duckdb.org) - The analytical database
- [fsx.do](https://fsx.do) - Filesystem on SQLite
- [gitx.do](https://gitx.do) - Git on R2
- [bashx.do](https://bashx.do) - Shell without VMs
- [workers.do](https://workers.do) - Durable Object primitives

## License

MIT
