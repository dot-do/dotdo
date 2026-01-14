# CDC (Change Data Capture)

> Unified event streaming from all stores to R2 Iceberg via Pipelines

## Overview

CDC provides a unified event format for capturing changes from all store primitives. Every write operation across DocumentStore, GraphStore, RelationalStore, etc. emits a `UnifiedEvent` that flows through Cloudflare Pipelines to R2 Iceberg tables.

## The Unification Problem

Without CDC unification, you have:
- DocumentStore emits JSON patches
- RelationalStore emits row changes
- GraphStore emits edge mutations
- TimeSeriesStore emits data points
- VectorStore emits embedding updates

With CDC unification, you have:
- **One format** for all changes
- **One pipeline** to R2 Iceberg
- **One query interface** for analytics

## UnifiedEvent Format

```typescript
interface UnifiedEvent {
  // ===== ENVELOPE (always present) =====
  id: string                    // Unique event ID (ULID)
  type: string                  // Event type: 'Customer.created' | 'cdc.insert'
  timestamp: string             // ISO 8601 timestamp
  ns: string                    // DO namespace (tenant identifier)
  correlationId?: string        // Request correlation ID

  // ===== CDC FIELDS (for store mutations) =====
  op?: 'c' | 'u' | 'd' | 'r'   // Operation: create/update/delete/read
  store?: StoreType             // 'document' | 'graph' | 'relational' | etc.
  table?: string                // Table/collection name
  key?: string                  // Primary key
  before?: Record<string, unknown>  // Previous state (for u/d)
  after?: Record<string, unknown>   // New state (for c/u)
  txid?: string                 // Transaction ID (for batched changes)
  lsn?: number                  // Log sequence number (ordering)

  // ===== DOMAIN EVENT FIELDS =====
  actor?: string                // Who triggered this (User/alice)
  data?: Record<string, unknown>  // Domain-specific payload
  visibility?: 'user' | 'team' | 'public'  // Access control

  // ===== METADATA =====
  _meta?: {
    schemaVersion: number       // Event schema version
    source: string              // Source service/worker
    retries?: number            // Retry count
  }
}
```

## Store Type Mapping

| Store | `op` | `store` | Notes |
|-------|------|---------|-------|
| DocumentStore | c/u/d | `document` | Full document in `after` |
| GraphStore | c/u/d | `graph` | Edge in `after`, nodes in `before`/`after` |
| RelationalStore | c/u/d | `relational` | Row changes, typed columns |
| ColumnarStore | c | `columnar` | Batch inserts, partition info |
| TimeSeriesStore | c/r | `timeseries` | Data points, rollup events |
| VectorStore | c/u/d | `vector` | Embedding metadata (not full vectors) |

## Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DURABLE OBJECTS                                 │
│                                                                              │
│   DocumentStore ──┐                                                         │
│   GraphStore    ──┼──▶ UnifiedEvent ──▶ PIPELINE BINDING                   │
│   RelationalStore─┤                            │                            │
│   TimeSeriesStore─┤                            │                            │
│   VectorStore   ──┘                            │                            │
└────────────────────────────────────────────────┼────────────────────────────┘
                                                 │
                                                 ▼
                                    ┌─────────────────────────┐
                                    │   CLOUDFLARE PIPELINE   │
                                    │                         │
                                    │   • Buffered queue      │
                                    │   • SQL transform       │
                                    │   • Batching            │
                                    └─────────────────────────┘
                                                 │
                                                 ▼
                                    ┌─────────────────────────┐
                                    │      R2 ICEBERG         │
                                    │                         │
                                    │   events/               │
                                    │   ├── type=Customer/    │
                                    │   │   └── dt=2024-01/   │
                                    │   ├── type=Order/       │
                                    │   │   └── dt=2024-01/   │
                                    │   └── metadata/         │
                                    └─────────────────────────┘
                                                 │
                                                 ▼
                                    ┌─────────────────────────┐
                                    │        R2 SQL           │
                                    │                         │
                                    │   Cross-DO queries      │
                                    │   Analytics             │
                                    │   Audit/SOC2            │
                                    └─────────────────────────┘
```

## API

### Emitting Events

```typescript
import { CDCEmitter } from 'dotdo/db/cdc'

const cdc = new CDCEmitter(env.EVENTS_PIPELINE, {
  ns: 'startups.studio',
  source: 'DO/customers',
})

// CDC event (from store mutation)
await cdc.emit({
  op: 'c',
  store: 'document',
  table: 'Customer',
  key: 'cust_123',
  after: { name: 'Alice', email: 'alice@example.com' },
})

// Domain event (business logic)
await cdc.emit({
  type: 'Customer.created',
  actor: 'User/nathan',
  data: { customerId: 'cust_123', source: 'signup' },
})

// Batch events
await cdc.emitBatch([
  { op: 'c', store: 'document', table: 'Order', key: 'ord_1', after: {...} },
  { op: 'c', store: 'document', table: 'Order', key: 'ord_2', after: {...} },
])
```

### Managed Pipeline (HTTP Fallback)

When DO doesn't have PIPELINE binding, use HTTP:

```typescript
import { ManagedPipeline } from 'dotdo/streaming/managed-pipeline'

const pipeline = new ManagedPipeline({
  endpoint: 'https://events.do/ingest',
  authToken: oauthToken,  // From oauth.do
  namespace: 'startups.studio',
})

await pipeline.send([event1, event2, event3])
```

### Consuming Events (R2 SQL)

```sql
-- Cross-DO query: All customers created today
SELECT * FROM events
WHERE type = 'Customer.created'
  AND DATE(timestamp) = CURRENT_DATE
  AND ns LIKE 'startups.%'

-- Analytics: Events by type and hour
SELECT
  type,
  DATE_TRUNC('hour', timestamp) as hour,
  COUNT(*) as count
FROM events
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY type, hour
ORDER BY hour DESC

-- Audit: All changes by actor
SELECT * FROM events
WHERE actor = 'User/nathan'
  AND op IN ('c', 'u', 'd')
ORDER BY timestamp DESC
LIMIT 100
```

## Pipeline SQL Transform

The pipeline transforms local DO events to global URLs:

```sql
-- streams/events.sql
SELECT
  id,
  type,
  timestamp,
  -- Expand local IDs to global URLs
  CONCAT(ns, '/', source) as source,
  CONCAT(ns, '/', table) as table_url,
  op,
  store,
  key,
  before,
  after,
  actor,
  data,
  correlation_id,
  _meta
FROM events
```

## Schema (R2 Iceberg)

```
events/
├── type=Customer.created/
│   └── dt=2024-01-14/
│       ├── part-00000.parquet
│       └── part-00001.parquet
├── type=cdc.insert/
│   └── dt=2024-01-14/
│       └── ...
└── metadata/
    ├── v1.metadata.json
    └── snapshots/
        └── snap-1234567890.avro
```

### Parquet Schema

```
events.parquet:
├── id: string
├── type: string
├── timestamp: timestamp
├── ns: string
├── op: string (nullable)
├── store: string (nullable)
├── table_url: string (nullable)
├── key: string (nullable)
├── before: json (nullable)
├── after: json (nullable)
├── actor: string (nullable)
├── data: json (nullable)
├── correlation_id: string (nullable)
└── _meta: json
```

## Exactly-Once Delivery

```typescript
import { ExactlyOnceContext } from 'dotdo/do/primitives'

const ctx = new ExactlyOnceContext(db)

await ctx.transaction(async (tx) => {
  // Store mutation
  await tx.execute(sql`INSERT INTO customers ...`)

  // CDC event (part of same transaction)
  await tx.emit({
    op: 'c',
    store: 'document',
    table: 'Customer',
    key: 'cust_123',
    after: customer,
  })
})
// Both succeed or both fail
```

## When to Use CDC

| Use CDC | Use Direct Pipeline |
|---------|---------------------|
| Store mutations | Custom events |
| Audit requirements | Real-time streaming |
| Cross-DO analytics | External integrations |
| Compliance (SOC2) | High-volume metrics |

## Dependencies

- Cloudflare Pipelines (binding) or ManagedPipeline (HTTP)
- R2 + Iceberg for storage

## Related

- [`streaming/managed-pipeline.ts`](../../streaming/managed-pipeline.ts) - HTTP pipeline
- [`db/streams/`](../streams/) - Pipeline SQL schemas
- [`do/primitives/exactly-once-context.ts`](../../do/primitives/exactly-once-context.ts) - Transaction support

## Implementation Status

| Feature | Status |
|---------|--------|
| UnifiedEvent type | TBD |
| CDCEmitter | TBD |
| Store integrations | TBD |
| Pipeline SQL transform | See `db/streams/` |
| ManagedPipeline | ✅ Exists |
| Exactly-once | See `do/primitives/` |
| R2 Iceberg sink | TBD |
| R2 SQL queries | TBD |
