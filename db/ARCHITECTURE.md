# DO Database Architecture

## Overview

This document describes the foundational database architecture for building ClickHouse-grade analytics on Cloudflare Workers with Durable Objects (DOs). The key insight is exploiting DO billing characteristics to achieve 10-100x cost savings compared to traditional OLAP solutions.

## The Cost Problem

Cloudflare DOs bill based on:
- **Rows read**: $0.001 per million
- **Rows written**: $1.00 per million

Traditional row-based storage for analytics is prohibitively expensive:
```
1M Things = 1M rows written = $1.00 per write cycle
10M Things with 100 queries = $1,000/day in reads
```

## The Columnar Solution

By storing data in **columnar format** where each column is a SQLite row, we dramatically reduce costs:

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

**Cost savings: 99.4%** (6 writes vs 1000 writes)

## Three-Tier Storage Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Tier 1: DO SQLite (Hot)                                                         │
│ ┌─────────────────────────────────────────────────────────────────────────────┐ │
│ │ Columnar Storage:                                                           │ │
│ │ • Row: "ids"        → ["id1", "id2", "id3", ...]                            │ │
│ │ • Row: "types"      → ["User", "Order", "Product", ...]                     │ │
│ │ • Row: "data"       → [{...}, {...}, {...}, ...]                            │ │
│ │ • Row: "embeddings" → <binary: packed Float32Arrays>                        │ │
│ │ • Row: "timestamps" → {created: [...], updated: [...]}                      │ │
│ │ • Row: "_meta"      → {count: 1000, embeddingDim: 1536}                     │ │
│ │                                                                             │ │
│ │ Index Layer:                                                                │ │
│ │ • Row: "bloom:data.email" → <bloom filter bitmap>                           │ │
│ │ • Row: "minmax:createdAt" → {partitions: [{key, min, max}, ...]}            │ │
│ │ • Row: "_manifest"        → <Iceberg manifest summary>                      │ │
│ │                                                                             │ │
│ │ Access: <1ms | Cost: $0.001/M reads                                         │ │
│ └─────────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                         │
│                                       ▼                                         │
│ Tier 2: DO Filesystem Extension (Warm) - Coming soon                            │
│ ┌─────────────────────────────────────────────────────────────────────────────┐ │
│ │ • Local disk cache for frequently accessed partitions                       │ │
│ │ • Persistent across DO wake/sleep cycles                                    │ │
│ │ • Access: <10ms                                                             │ │
│ └─────────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                         │
│                                       ▼                                         │
│ Tier 3: R2 Iceberg (Cold)                                                       │
│ ┌─────────────────────────────────────────────────────────────────────────────┐ │
│ │ things/                                                                     │ │
│ │ ├── type=User/                                                              │ │
│ │ │   ├── dt=2024-01-01/data.parquet                                          │ │
│ │ │   ├── dt=2024-01-02/data.parquet                                          │ │
│ │ │   └── ...                                                                 │ │
│ │ ├── type=Order/                                                             │ │
│ │ │   └── ...                                                                 │ │
│ │ └── metadata/                                                               │ │
│ │     ├── manifest.json                                                       │ │
│ │     └── snapshots/                                                          │ │
│ │                                                                             │ │
│ │ relationships/                                                              │ │
│ │ └── ...                                                                     │ │
│ │                                                                             │ │
│ │ Access: ~100ms | Cost: $0.015/GB | Unlimited storage                        │ │
│ └─────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Query Accelerator

The DO Query Accelerator maintains indexes in SQLite that accelerate queries over R2 Iceberg data without fetching from cold storage.

### Index Types

1. **Bloom Filters** - For equality predicates on high-cardinality columns
   ```typescript
   // Check if email might exist before fetching from R2
   const bloom = accelerator.getBloomFilter('data.email')
   if (!bloom.mightContain('user@example.com')) {
     return []  // Skip R2 entirely!
   }
   ```

2. **Min/Max Statistics** - For range predicates
   ```typescript
   // Prune partitions that can't contain matching rows
   const partitions = minMaxIndex.findPartitions('createdAt', {
     op: '>',
     value: '2024-01-01'
   })
   // Only fetch partitions where max(createdAt) > '2024-01-01'
   ```

3. **Type Index** - For type-based partition pruning
   ```typescript
   // Jump directly to User partitions
   SELECT * FROM things WHERE type = 'User'
   // → Only scan things/type=User/*.parquet
   ```

4. **Cardinality Statistics** - For query optimization
   ```typescript
   // Know row counts without scanning
   SELECT COUNT(*) FROM things
   // → 1 DO row read, 0 R2 fetches
   ```

### Query Execution Flow

```
                     ┌─────────────────────────┐
                     │  SELECT * FROM things   │
                     │  WHERE type = 'User'    │
                     │  AND data.email = '...' │
                     │  AND createdAt > date   │
                     └───────────┬─────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │ Step 1: Can answer from index alone? │
              │ • COUNT(*) → yes, return immediately │
              │ • EXISTS(id) → yes, check id index   │
              └───────────────────┬──────────────────┘
                                  │ no
                                  ▼
              ┌──────────────────────────────────────┐
              │ Step 2: Prune partitions             │
              │ • type = 'User' → User partitions    │
              │ • createdAt > date → min/max prune   │
              │ 1000 partitions → 10 partitions      │
              └───────────────────┬──────────────────┘
                                  │
                                  ▼
              ┌──────────────────────────────────────┐
              │ Step 3: Check bloom filters          │
              │ • data.email = 'x@y.com'             │
              │ • Bloom says "definitely not"?       │
              │   → Return empty, skip R2 entirely   │
              └───────────────────┬──────────────────┘
                                  │ maybe exists
                                  ▼
              ┌──────────────────────────────────────┐
              │ Step 4: Fetch from R2 (projection)   │
              │ • Only fetch needed columns          │
              │ • Only fetch matching partitions     │
              │ • Cache hot partitions in DO         │
              └───────────────────┬──────────────────┘
                                  │
                                  ▼
              ┌──────────────────────────────────────┐
              │ Step 5: Execute on fetched data      │
              │ • Apply remaining filters            │
              │ • Aggregate, sort, limit             │
              │ • Return results                     │
              └──────────────────────────────────────┘
```

## JSON Columnar Storage

Inspired by ClickHouse's JSON type, we automatically extract typed subcolumns from JSON data:

```typescript
// Input records with varying JSON structures
[
  { id: 'a', data: { email: 'a@x.com', age: 25, premium: true } },
  { id: 'b', data: { email: 'b@x.com', age: 30 } },
  { id: 'c', data: { email: 'c@x.com', age: null, premium: false } },
]

// Automatic extraction based on path frequency
Path Statistics:
  data.email:   frequency=100%, type=String   → EXTRACT
  data.age:     frequency=100%, type=Int64    → EXTRACT
  data.premium: frequency=66%,  type=Bool     → KEEP IN JSON (below threshold)

// Storage after extraction
Row: "data.email"   → ["a@x.com", "b@x.com", "c@x.com"]   // TypedColumn<String>
Row: "data.age"     → [25, 30, null]                      // TypedColumn<Int64>
Row: "data._rest"   → [{premium:true}, {}, {premium:false}] // Remaining JSON
```

### Benefits

1. **Type-specific compression** - Numbers stored as binary, not JSON strings
2. **Direct column access** - Query `data.email` without parsing JSON
3. **Bloom filters on subcolumns** - Index `data.email` for fast lookups
4. **Schema evolution** - New fields automatically detected and extracted

## Cost Analysis

### Example: 10M Things, 1000 Partitions

| Query | Traditional (Full Scan) | With Accelerator |
|-------|------------------------|------------------|
| `SELECT COUNT(*)` | 1000 partition reads = $0.001 | 1 DO read = $0.000001 |
| `WHERE type = 'User'` | 1000 partition reads | ~100 partition reads (10x savings) |
| `WHERE data.email = 'x'` | 1000 partition reads | 0 reads (bloom says no) |
| `WHERE createdAt > date` | 1000 partition reads | ~250 reads (75% pruned) |

### Monthly Savings Estimate

```
Traditional OLAP (Snowflake/BigQuery):
  10M records × 1000 queries/day × 30 days = $$$$$

DO Query Accelerator:
  - Index storage: ~$0.05/month
  - Index reads: ~$0.10/month
  - Targeted R2 reads: ~$1/month
  
Savings: 10-100x depending on query patterns
```

## Implementation Status

### Completed Spikes

1. **DO Cost Optimization** (`do-cost-optimization.ts`)
   - 6 storage strategies benchmarked
   - ClickHouseColumnarStorage proven optimal
   - 40 tests passing

2. **JSON Columnar Storage** (`json-columnar.ts`)
   - Path statistics tracking
   - Typed subcolumn extraction
   - Schema evolution handling
   - 30 tests passing

3. **Iceberg Index Accelerator** (`iceberg-index-accelerator.ts`)
   - Bloom filter implementation
   - Min/max statistics index
   - Partition pruning
   - Query execution engine
   - 26 tests passing

### Production Implementation (TDD)

See beads issues for RED/GREEN/REFACTOR cycles:
- Columnar Storage Layer
- JSON Typed Columns
- Query Accelerator
- R2 Iceberg Integration

## Future Enhancements

1. **Materialized Views**
   - Pre-computed aggregations
   - Incremental maintenance
   - Staleness tracking

2. **Vectorized Execution**
   - SIMD operations on columns
   - Batch processing

3. **Distributed Queries**
   - Cross-DO query coordination
   - Partition-aware routing

4. **Real-time Streaming**
   - Change data capture
   - Incremental index updates

## References

- [ClickHouse JSON Type](https://clickhouse.com/docs/en/sql-reference/data-types/json)
- [Apache Iceberg Spec](https://iceberg.apache.org/spec/)
- [Cloudflare DO Billing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
