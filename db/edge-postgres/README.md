# edge-postgres

**Postgres for Durable Objects.** PGLite + FSX + Iceberg. Scales to millions.

## Why edge-postgres?

**Durable Objects don't have Postgres.** You get SQLite. It's fast, but it's not Postgres—no `pgvector`, no JSON operators, no PL/pgSQL.

**AI agents need Postgres.** Semantic search with vectors. Complex queries. Schema migrations. The ecosystem.

**edge-postgres gives you both:**

```typescript
import { EdgePostgres } from '@dotdo/edge-postgres'

class MyAgent extends DO {
  db = new EdgePostgres(this.ctx, this.env)

  async remember(content: string, embedding: number[]) {
    await this.db.query(
      `INSERT INTO memories (content, embedding) VALUES ($1, $2)`,
      [content, embedding]
    )
  }

  async recall(queryEmbedding: number[]) {
    return this.db.query(`
      SELECT content, embedding <-> $1 AS distance
      FROM memories
      ORDER BY distance
      LIMIT 5
    `, [queryEmbedding])
  }
}
```

## Installation

```bash
npm install @dotdo/edge-postgres
```

## Quick Start

```typescript
import { EdgePostgres } from '@dotdo/edge-postgres'

const db = new EdgePostgres(ctx, env)

// Create tables
await db.query(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    embedding vector(1536)
  )
`)

// Insert
await db.query(
  `INSERT INTO users (id, email, embedding) VALUES ($1, $2, $3)`,
  ['user-1', 'alice@example.com.ai', embedding]
)

// Query
const users = await db.query(`SELECT * FROM users WHERE id = $1`, ['user-1'])

// Vector search
const similar = await db.query(`
  SELECT id, email, embedding <-> $1 AS distance
  FROM users
  ORDER BY distance
  LIMIT 10
`, [queryEmbedding])
```

## Features

### Tiered Storage

Hot data stays in memory. Cold data goes to Parquet. You don't manage it.

```typescript
const db = new EdgePostgres(ctx, env, {
  tiering: {
    hotRetentionMs: 5 * 60 * 1000,  // Keep 5 minutes hot
    flushThreshold: 1000,            // Flush after 1000 writes
    flushIntervalMs: 60_000,         // Or every 60 seconds
  }
})

// Writes go to PGLite (hot) immediately
await db.query(`INSERT INTO events VALUES ($1, $2)`, [id, data])

// Background: batched to Parquet, stored in R2, tracked by Iceberg
// Reads automatically check hot tier first, then Iceberg
```

### Sharding

Distribute across up to 1000 Durable Objects. 10GB each. 10TB total.

```typescript
const db = new EdgePostgres(ctx, env, {
  sharding: {
    key: 'tenant_id',
    count: 100,
    algorithm: 'consistent',  // Minimal redistribution on scale
  }
})

// Routed to correct shard automatically
await db.query(
  `INSERT INTO orders (tenant_id, amount) VALUES ($1, $2)`,
  ['tenant-123', 99.99]
)

// Cross-shard queries fan out and merge
const totals = await db.query(`
  SELECT tenant_id, SUM(amount)
  FROM orders
  GROUP BY tenant_id
`)
```

### Replication

Read replicas in 35+ cities. GDPR jurisdictions. Read-your-writes consistency.

```typescript
const db = new EdgePostgres(ctx, env, {
  replication: {
    jurisdiction: 'eu',
    cities: ['fra', 'ams', 'dub'],
    readFrom: 'nearest',
  }
})

// Writes go to primary
const result = await db.query(
  `INSERT INTO users VALUES ($1, $2)`,
  [id, data],
  { sessionToken }
)

// Reads from nearest replica, but see your own writes
const user = await db.query(
  `SELECT * FROM users WHERE id = $1`,
  [id],
  { sessionToken: result.sessionToken }
)
```

### pgvector

HNSW indexes for semantic search:

```typescript
await db.query(`
  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    content TEXT,
    embedding vector(1536)
  );

  CREATE INDEX ON documents
  USING hnsw (embedding vector_cosine_ops);
`)

// Approximate nearest neighbor search
const results = await db.query(`
  SELECT id, content, 1 - (embedding <=> $1) AS similarity
  FROM documents
  ORDER BY embedding <=> $1
  LIMIT 10
`, [queryEmbedding])
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        EdgePostgres                             │
├─────────────────────────────────────────────────────────────────┤
│  PGLite (3MB WASM)                                              │
│  • Full Postgres SQL parser                                     │
│  • pgvector extension                                           │
│  • In-memory execution                                          │
├─────────────────────────────────────────────────────────────────┤
│  Write-Ahead Log                                                │
│  • FSX hot tier (DO SQLite)                                    │
│  • Crash recovery                                               │
│  • Async flush to Parquet                                       │
├─────────────────────────────────────────────────────────────────┤
│  Tiered Storage (FSX)                                           │
│  ┌─────────────┬─────────────────┬─────────────────┐           │
│  │ Hot         │ Warm            │ Cold            │           │
│  │ DO SQLite   │ R2 Parquet      │ R2 Archive      │           │
│  │ <1ms        │ 50-150ms        │ Seconds         │           │
│  └─────────────┴─────────────────┴─────────────────┘           │
├─────────────────────────────────────────────────────────────────┤
│  Iceberg Metadata                                               │
│  • Partition pruning                                            │
│  • Column statistics                                            │
│  • Time travel                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Write Path

```
INSERT INTO users VALUES (...)
         │
         ▼
┌─────────────────────────────┐
│ 1. PGLite validates         │  Constraints, triggers, types
│ 2. WAL append (FSX hot)     │  Durable immediately
│ 3. Return result            │  <1ms
└─────────────────────────────┘
         │ (async)
         ▼
┌─────────────────────────────┐
│ 4. Batch to Parquet         │  1000 rows or 60 seconds
│ 5. Write to R2              │  Warm tier
│ 6. Update Iceberg manifest  │  Metadata
│ 7. Truncate WAL             │  Cleanup
└─────────────────────────────┘
```

### Read Path

```
SELECT * FROM users WHERE id = $1
         │
         ▼
┌─────────────────────────────┐
│ 1. Check PGLite (hot)       │  <1ms if recent
│    └─ Found? Return.        │
│                             │
│ 2. Check Iceberg (warm)     │  50-150ms
│    └─ IcebergReader         │
│    └─ Partition pruning     │
│    └─ Found? Return.        │
│                             │
│ 3. Check archive (cold)     │  Rare, compliance queries
└─────────────────────────────┘
```

## Configuration

```typescript
interface EdgePostgresConfig {
  // Tiering
  tiering?: {
    hotRetentionMs?: number      // Default: 5 minutes
    flushThreshold?: number      // Default: 1000 rows
    flushIntervalMs?: number     // Default: 60 seconds
  }

  // Sharding
  sharding?: {
    key: string                  // Partition key column
    count: number                // Number of shards (max 1000)
    algorithm: 'consistent' | 'range' | 'hash'
  }

  // Replication
  replication?: {
    jurisdiction?: 'eu' | 'us' | 'fedramp'
    regions?: string[]           // AWS-style region names
    cities?: string[]            // IATA airport codes
    readFrom: 'primary' | 'nearest' | 'session'
    writeThrough?: boolean       // Sync to all replicas
  }

  // PGLite
  pglite?: {
    extensions?: string[]        // Additional extensions
    initialMemory?: number       // Pre-allocate memory
  }
}
```

## Memory Budget

128MB Workers limit breakdown:

```
V8 Isolate              ~15MB
PGLite WASM              ~3MB
PGLite heap             ~20MB  (configurable)
pgvector HNSW           ~10MB  (per 100K vectors)
Query buffers           ~10MB
────────────────────────────────
Total (OLTP)            ~58MB  ✓

For analytics: swap PGLite heap for DuckDB (~34MB)
```

## API Reference

### Core Methods

| Method | Description |
|--------|-------------|
| `query(sql, params?, options?)` | Execute SQL, return rows |
| `exec(sql)` | Execute SQL, no return |
| `transaction(fn)` | Execute in transaction |

### Query Options

| Option | Type | Description |
|--------|------|-------------|
| `sessionToken` | string | RYW consistency token |
| `timeout` | number | Query timeout (ms) |
| `tier` | 'hot' \| 'warm' \| 'all' | Force specific tier |

### Lifecycle

| Method | Description |
|--------|-------------|
| `initialize()` | Load from checkpoint, replay WAL |
| `checkpoint()` | Flush to Parquet, save state |
| `close()` | Cleanup resources |

## Comparison

| Feature | DO SQLite | edge-postgres |
|---------|-----------|---------------|
| Vector search | ❌ | ✅ (pgvector) |
| JSON operators | Basic | Full (`->`, `->>`, `@>`) |
| Full-text search | ❌ | ✅ |
| Sharding | Manual | Built-in |
| Replication | ❌ | Built-in |
| Unlimited storage | ❌ | ✅ (Iceberg tiering) |
| Postgres ecosystem | ❌ | ✅ |

## Related

- [FSX](/db/fsx) - Tiered filesystem
- [Iceberg](/db/iceberg) - Table format
- [Streaming](/streaming) - Event streaming
- [Shard/Replica](/db/core) - Distribution primitives
