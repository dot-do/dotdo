# ColumnarStore

> Analytics-optimized columnar storage with 99.4% cost savings

## Overview

ColumnarStore provides ClickHouse-inspired columnar storage that exploits Cloudflare DO billing characteristics. By storing each column as a separate SQLite row, we achieve massive cost savings on row-based billing while enabling efficient analytical queries.

## The Cost Problem

Cloudflare DOs bill based on:
- **Rows read**: $0.001 per million
- **Rows written**: $1.00 per million

Traditional row-based storage for analytics is prohibitively expensive.

## The Columnar Solution

```
Traditional: 1000 records = 1000 row writes = $1.00
Columnar:    1000 records = 6 row writes   = $0.006

Savings: 99.4%
```

## Three-Tier Storage

```
┌─────────────────────────────────────────────────────────────────┐
│ HOT: DO SQLite (Index Layer)                                    │
│ • Columnar indexes only (not full data)                         │
│ • Bloom filters for equality predicates                         │
│ • Min/max statistics for range pruning                          │
│ • Type index for partition selection                            │
│ • Cardinality statistics for query planning                     │
│ Access: <1ms | Storage: ~100MB                                  │
├─────────────────────────────────────────────────────────────────┤
│ WARM: R2 Parquet (Partitioned Data)                             │
│ • Columnar Parquet files partitioned by type/date               │
│ • Column pruning (only read needed columns)                     │
│ • Predicate pushdown to file level                              │
│ Access: ~50ms | Storage: ~10GB                                  │
├─────────────────────────────────────────────────────────────────┤
│ COLD: R2 Iceberg (Full Archive)                                 │
│ • things/type=User/dt=2024-01/*.parquet                         │
│ • Full columnar data with Zstd compression                      │
│ • Time travel via Iceberg snapshots                             │
│ Access: ~100ms | Storage: Unlimited                             │
└─────────────────────────────────────────────────────────────────┘
```

## Storage Format

```typescript
// Traditional: 1000 records = 1000 row writes
INSERT INTO things (id, type, data) VALUES (?, ?, ?);  // x1000

// Columnar: 1000 records = 6 row writes
UPDATE storage SET value = ? WHERE key = 'ids';        // JSON array of 1000 IDs
UPDATE storage SET value = ? WHERE key = 'types';      // JSON array of 1000 types
UPDATE storage SET value = ? WHERE key = 'data';       // JSON array of 1000 data objects
UPDATE storage SET value = ? WHERE key = 'embeddings'; // Binary packed Float32Arrays
UPDATE storage SET value = ? WHERE key = 'timestamps'; // JSON with created/updated arrays
UPDATE storage SET value = ? WHERE key = '_meta';      // Metadata (count, dimensions)
```

## API

```typescript
import { ColumnarStore } from 'dotdo/db/columnar'

const store = new ColumnarStore(db)

// Batch insert (optimized for columnar)
await store.insertBatch([
  { type: 'User', data: { name: 'Alice' } },
  { type: 'User', data: { name: 'Bob' } },
  // ... 1000 more
])

// Analytical queries
const count = await store.count({ type: 'User' })  // Uses index, 0 data reads

const stats = await store.aggregate({
  type: 'Order',
  groupBy: 'status',
  metrics: ['count', 'sum:total', 'avg:total']
})

// Range query with partition pruning
const recent = await store.query({
  type: 'Order',
  where: { createdAt: { $gt: '2024-01-01' } },
  columns: ['id', 'total', 'status'],  // Column projection
})
```

## Query Accelerator

The DO maintains indexes that accelerate queries without fetching from cold storage:

### Index Types

```typescript
// 1. Bloom Filters - Equality predicates on high-cardinality columns
const bloom = accelerator.getBloomFilter('data.email')
if (!bloom.mightContain('user@example.com')) {
  return []  // Skip R2 entirely!
}

// 2. Min/Max Statistics - Range predicates
const partitions = minMaxIndex.findPartitions('createdAt', {
  op: '>',
  value: '2024-01-01'
})
// Only fetch partitions where max(createdAt) > '2024-01-01'

// 3. Type Index - Partition pruning by type
// SELECT * FROM things WHERE type = 'User'
// → Only scan things/type=User/*.parquet

// 4. Cardinality Statistics - Query optimization
// SELECT COUNT(*) FROM things
// → 1 DO row read, 0 R2 fetches
```

### Query Execution Flow

```
Query → Index Check → Partition Prune → Bloom Filter → Fetch (if needed)
  │          │              │                │              │
  │      Can answer     Skip 90% of      Skip remaining   Minimal
  │      from index?    partitions       via bloom        R2 reads
  │          │              │                │              │
  └── <1ms ─┴───────────────┴────────────────┴──────────────┘
```

## JSON Columnar Storage

Inspired by ClickHouse's JSON type, automatically extract typed subcolumns:

```typescript
// Input records with varying JSON structures
[
  { id: 'a', data: { email: 'a@x.com', age: 25, premium: true } },
  { id: 'b', data: { email: 'b@x.com', age: 30 } },
  { id: 'c', data: { email: 'c@x.com', age: null, premium: false } },
]

// Automatic extraction based on path frequency
// Path Statistics:
//   data.email:   frequency=100%, type=String   → EXTRACT
//   data.age:     frequency=100%, type=Int64    → EXTRACT
//   data.premium: frequency=66%,  type=Bool     → KEEP IN JSON (below threshold)

// Storage after extraction
// Row: "data.email"   → ["a@x.com", "b@x.com", "c@x.com"]   // TypedColumn<String>
// Row: "data.age"     → [25, 30, null]                      // TypedColumn<Int64>
// Row: "data._rest"   → [{premium:true}, {}, {premium:false}] // Remaining JSON
```

## Cost Analysis

### Example: 10M Things, 1000 Partitions

| Query | Traditional (Full Scan) | With Accelerator |
|-------|------------------------|------------------|
| `SELECT COUNT(*)` | 1000 partition reads = $0.001 | 1 DO read = $0.000001 |
| `WHERE type = 'User'` | 1000 partition reads | ~100 partition reads (10x savings) |
| `WHERE data.email = 'x'` | 1000 partition reads | 0 reads (bloom says no) |
| `WHERE createdAt > date` | 1000 partition reads | ~250 reads (75% pruned) |

## CDC Events

```typescript
// Batch insert emits single CDC event
{
  type: 'cdc.batch_insert',
  op: 'c',
  store: 'columnar',
  table: 'things',
  count: 1000,
  partition: 'type=User/dt=2024-01-14'
}
```

## When to Use

| Use ColumnarStore | Use DocumentStore |
|-------------------|-------------------|
| Analytical queries | Transactional queries |
| Batch inserts | Single-record operations |
| Aggregations | Document retrieval |
| Cost-sensitive analytics | Real-time CRUD |

## Dependencies

None. Uses only native SQLite.

## Implementation Status

| Feature | Status |
|---------|--------|
| Columnar storage format | TBD |
| Bloom filters | TBD |
| Min/max indexes | TBD |
| Type index | TBD |
| JSON subcolumn extraction | TBD |
| Batch insert | TBD |
| Aggregations | TBD |
| Partition pruning | TBD |
| R2 Parquet integration | TBD |
