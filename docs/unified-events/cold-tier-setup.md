# Cold Tier R2/Iceberg Setup Guide

This guide covers setting up the cold tier storage using Cloudflare R2 and Apache Iceberg format for long-term event archival and historical analytics.

## Table of Contents

1. [Overview](#overview)
2. [R2 Bucket Configuration](#r2-bucket-configuration)
3. [Iceberg Table Creation](#iceberg-table-creation)
4. [Pipeline Binding Setup](#pipeline-binding-setup)
5. [Partition Management](#partition-management)
6. [Query Examples](#query-examples)
7. [Tiering Policies](#tiering-policies)

---

## Overview

### Three-Tier Storage Architecture

dotdo uses a three-tier storage architecture for optimal cost and performance:

| Tier | Storage | Access Latency | Capacity | Use Case |
|------|---------|----------------|----------|----------|
| **Hot** | DO SQLite | <1ms | ~100MB | Real-time queries, recent events |
| **Warm** | R2 Parquet | ~50ms | ~10GB | Recent historical, active analytics |
| **Cold** | R2 Iceberg | ~100ms | Unlimited | Long-term archival, compliance |

### Why R2 + Iceberg?

- **Cost Efficient**: R2 has no egress fees, Iceberg provides columnar compression
- **Query Flexible**: Iceberg format works with DuckDB, Spark, Trino, chdb
- **Time Travel**: Query historical snapshots without data duplication
- **Partition Pruning**: Skip irrelevant data files for fast queries
- **Schema Evolution**: Add/rename columns without rewriting data

---

## R2 Bucket Configuration

### Create R2 Buckets

Create two R2 buckets for the cold tier: one for event data and one for Iceberg metadata.

**Via Wrangler CLI:**

```bash
# Create the main events Iceberg bucket
wrangler r2 bucket create events-iceberg

# Create a general data lake bucket (optional, for other cold data)
wrangler r2 bucket create dotdo-lake
```

**Via Cloudflare Dashboard:**

1. Navigate to R2 in your Cloudflare dashboard
2. Click "Create bucket"
3. Name: `events-iceberg`
4. Location: Choose your preferred region (or auto)
5. Click "Create bucket"

### Bucket Structure

The R2 bucket follows the Iceberg table layout:

```
events-iceberg/
├── cdc/
│   └── {namespace}/
│       ├── data/
│       │   └── year={YYYY}/
│       │       └── month={MM}/
│       │           └── day={DD}/
│       │               └── hour={HH}/
│       │                   └── {file-id}.parquet
│       └── metadata/
│           ├── manifest-{sequence}.json
│           └── latest
├── metadata.json           # Iceberg table metadata
├── manifest-list.avro      # Manifest list file
└── manifests/
    └── manifest-{id}.avro  # Individual manifest files
```

### Bucket Permissions

Ensure your Worker has read/write access to the R2 bucket via the binding.

---

## Iceberg Table Creation

### Table Schema

The cold tier uses the same 165-column UnifiedEvent schema as the hot tier. Key partition columns:

```typescript
// Partition columns (in order of selectivity)
interface IcebergPartition {
  year: number      // Partition by year
  month: number     // Partition by month
  day: number       // Partition by day
  hour?: number     // Optional hourly partitioning
}
```

### R2IcebergSink Configuration

Configure the sink in your code:

```typescript
import { R2IcebergSink, createR2IcebergSink } from 'dotdo/db/cdc/r2-iceberg-sink'

// Create the sink instance
const sink = createR2IcebergSink({
  // R2 bucket binding from environment
  bucket: env.EVENTS_ICEBERG_BUCKET,

  // Base path prefix in R2
  basePath: 'cdc/',

  // Namespace/tenant identifier
  namespace: 'tenant-123',

  // Batch size before flushing to R2 (default: 1000)
  batchSize: 1000,

  // Maximum time to hold events before flush in ms (default: 60000)
  maxFlushDelayMs: 60000,

  // Partition scheme: 'hourly' | 'daily' | 'monthly'
  partitionScheme: 'hourly',

  // Enable compression (default: true)
  compression: true,
})
```

### Sink Usage

```typescript
// Write events (buffered)
await sink.write(events)

// Manually flush to R2
const flushedCount = await sink.flush()

// Get statistics
const stats = sink.getStats()
console.log(`Flushed: ${stats.eventsFlushed}, Files: ${stats.filesWritten}`)

// List data files
const files = await sink.listDataFiles()

// Graceful shutdown
await sink.close()
```

### Data File Entry Structure

Each data file is tracked with metadata for partition pruning:

```typescript
interface DataFileEntry {
  file_path: string           // R2 key path
  file_format: 'PARQUET'      // Always Parquet
  record_count: number        // Events in file
  file_size_in_bytes: number  // File size
  partition: {
    year: number
    month: number
    day: number
    hour?: number
  }
  min_lsn: number            // Minimum log sequence number
  max_lsn: number            // Maximum log sequence number
  min_timestamp: string      // Earliest event timestamp
  max_timestamp: string      // Latest event timestamp
}
```

---

## Pipeline Binding Setup

### wrangler.jsonc Configuration

Add the R2 bucket and pipeline bindings to your `wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-worker",
  "main": "api/index.ts",
  "compatibility_date": "2026-01-08",

  // Durable Objects with SQLite (hot tier)
  "durable_objects": {
    "bindings": [
      {
        "name": "DO",
        "class_name": "DO"
      }
    ]
  },

  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["DO"]
    }
  ],

  // R2 Buckets for warm/cold tiers
  "r2_buckets": [
    {
      "binding": "R2",
      "bucket_name": "dotdo-lake"
    },
    {
      "binding": "EVENTS_ICEBERG_BUCKET",
      "bucket_name": "events-iceberg"
    }
  ],

  // Unified Events Pipeline - streams to R2 Iceberg
  "pipelines": [
    {
      "pipeline": "unified_events",
      "binding": "UNIFIED_EVENTS_PIPELINE"
    }
  ]
}
```

### Environment Types

Add the bindings to your TypeScript environment types:

```typescript
// types/CloudflareBindings.ts
export interface Env {
  // Durable Objects
  DO: DurableObjectNamespace

  // R2 Buckets
  R2: R2Bucket                      // General data lake
  EVENTS_ICEBERG_BUCKET: R2Bucket   // Events cold tier

  // Pipelines
  UNIFIED_EVENTS_PIPELINE: Pipeline
}
```

### Multi-Tier Configuration

For separate warm and cold buckets:

```jsonc
{
  "r2_buckets": [
    {
      "binding": "R2_WARM",
      "bucket_name": "events-warm"
    },
    {
      "binding": "R2_COLD",
      "bucket_name": "events-cold"
    }
  ]
}
```

---

## Partition Management

### Partition Schemes

Choose based on your query patterns and data volume:

| Scheme | Path Format | Best For |
|--------|-------------|----------|
| `hourly` | `year=YYYY/month=MM/day=DD/hour=HH/` | High-volume, real-time queries |
| `daily` | `year=YYYY/month=MM/day=DD/` | Medium volume, daily reports |
| `monthly` | `year=YYYY/month=MM/` | Low volume, long-term archival |

### Partition Pruning

The Iceberg reader uses partition statistics to skip irrelevant files:

```typescript
import { IcebergReader } from 'dotdo/db/iceberg'

const reader = new IcebergReader(env.EVENTS_ICEBERG_BUCKET)

// Query with partition filter - fast (skips 80%+ of files)
const result = await reader.findFile({
  table: 'events',
  partition: { ns: 'payments.do', type: 'cdc' },
  id: 'event-123'
})

// Query without partition - slow (scans all files)
const slowResult = await reader.getRecord({
  table: 'events',
  id: 'event-123'
  // No partition filter = full scan
})
```

### Compaction Strategy

Periodically compact small files into larger ones:

```typescript
// db/iceberg/compaction.ts
import { compactIcebergPartition } from 'dotdo/db/iceberg/compaction'

// Compact files smaller than 128MB in a partition
await compactIcebergPartition({
  bucket: env.EVENTS_ICEBERG_BUCKET,
  table: 'events',
  partition: { year: 2024, month: 1, day: 15 },
  targetFileSizeMB: 128,
  minFilesToCompact: 4,
})
```

---

## Query Examples

### Point Lookups (50-150ms)

```typescript
import { IcebergReader } from 'dotdo/db/iceberg'

const reader = new IcebergReader(env.EVENTS_ICEBERG_BUCKET)

// Find a specific event by ID
const event = await reader.getRecord({
  table: 'events',
  partition: { ns: 'payments.do', type: 'cdc' },
  id: 'event-abc123'
})

console.log(event)
// { id: 'event-abc123', event_type: 'cdc', ... }
```

### Time Range Queries

```typescript
// Query via chdb or DuckDB
const results = await ctx.queryIceberg<{
  id: string
  event_type: string
  timestamp: string
}>(`
  SELECT id, event_type, timestamp
  FROM events
  WHERE year = 2024
    AND month = 1
    AND day BETWEEN 1 AND 15
    AND event_type = 'trace'
  ORDER BY timestamp DESC
  LIMIT 1000
`)
```

### Aggregation Queries

```typescript
// Count events by type for a day
const counts = await ctx.queryIceberg<{
  event_type: string
  count: number
}>(`
  SELECT
    event_type,
    COUNT(*) as count
  FROM events
  WHERE year = 2024 AND month = 1 AND day = 15
  GROUP BY event_type
  ORDER BY count DESC
`)

// Calculate p95 latency by service
const latencies = await ctx.queryIceberg<{
  service_name: string
  p95_ms: number
}>(`
  SELECT
    service_name,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_ms
  FROM events
  WHERE event_type = 'trace'
    AND year = 2024
    AND month = 1
  GROUP BY service_name
`)
```

### Time Travel Queries

Query historical snapshots without data duplication:

```typescript
import { IcebergReader } from 'dotdo/db/iceberg'

const reader = new IcebergReader(env.EVENTS_ICEBERG_BUCKET)

// Query a historical snapshot
const historicalEvent = await reader.getRecord({
  table: 'events',
  partition: { ns: 'payments.do' },
  id: 'event-123',
  snapshotId: 1234567890  // Historical snapshot ID
})
```

### Cross-Shard Queries

For scatter-gather across multiple shards:

```typescript
// Single shard query (fast, ~50ms)
const singleShard = await queryIceberg({
  shardKey: 'tenant-123',
  sql: 'SELECT * FROM events WHERE ns = ? LIMIT 100'
})

// Scatter-gather across 10 shards (~150-300ms)
const allShards = await queryScatterGather({
  shardCount: 10,
  sql: 'SELECT COUNT(*) as total FROM events'
})
```

---

## Tiering Policies

### Policy Configuration

Configure automatic data tiering based on age or access patterns:

```typescript
import { PolicyEvaluator, ageBasedPolicy, PRESET_POLICIES } from 'dotdo/db/core/tiering/policy'

// Age-based policy: warm after 7 days, cold after 30 days
const policy = ageBasedPolicy(7, 30)

// Or use a preset
const conservativePolicy = PRESET_POLICIES.conservative
// warm after 30 days, cold after 90 days

const aggressivePolicy = PRESET_POLICIES.aggressive
// warm after 1 day, cold after 7 days

// Create evaluator
const evaluator = new PolicyEvaluator(policy)

// Evaluate if data should be tiered
const targetTier = evaluator.evaluate(metadata)
if (targetTier && targetTier !== metadata.tier) {
  await tierData(key, targetTier)
}
```

### Preset Policies

| Preset | Warm After | Cold After | Use Case |
|--------|------------|------------|----------|
| `aggressive` | 1 day | 7 days | High-volume, cost-sensitive |
| `standard` | 7 days | 30 days | General purpose |
| `conservative` | 30 days | 90 days | Important data |
| `longTerm` | 90 days | 365 days | Compliance, archival |

### Custom Policies

```typescript
import { customPolicy, combinedPolicy } from 'dotdo/db/core/tiering/policy'

// Access-based tiering
const accessPolicy = accessBasedPolicy(1000, 10000)
// Move to warm after 1000 accesses, cold after 10000

// Combined age + access policy
const combined = combinedPolicy({
  warmAfterDays: 7,
  coldAfterDays: 30,
  warmAfterAccess: 1000,
})

// Custom predicate-based policy
const inactivePolicy = customPolicy({
  shouldCold: (metadata) => {
    const thirtyDays = 30 * 24 * 60 * 60 * 1000
    return Date.now() - metadata.lastAccess > thirtyDays
  }
})
```

### R2 Tier Client

Use the R2TierClient for warm/cold tier operations:

```typescript
import { R2TierClient, batchMove } from 'dotdo/db/core/tiering/r2-client'

const client = new R2TierClient({
  warm: env.R2_WARM,
  cold: env.R2_COLD,
  keyPrefix: 'events',
})

// Store in warm tier
await client.put('warm', 'event:123', eventData)

// Get with fallback (warm -> cold)
const { data, tier } = await client.getWithFallback('event:123')

// Move to cold tier
await client.move('event:123', 'warm', 'cold')

// Batch move multiple keys
const results = await batchMove(client, keys, 'warm', 'cold', {
  concurrency: 10,
})
```

---

## Performance Targets

The cold tier is designed for the following performance characteristics:

| Operation | p95 Latency | Notes |
|-----------|-------------|-------|
| Point lookup (cached metadata) | 50-100ms | Metadata in memory |
| Point lookup (cold metadata) | 100-150ms | Includes R2 metadata fetch |
| Partition-pruned query | <100ms | With partition filter |
| Full scan query | <500ms | No partition filter |
| Single shard query | <100ms | With shard key |
| Scatter-gather (10 shards) | 150-300ms | Parallel execution |
| Cache benefit | 30-50ms | Metadata caching saves |

### Optimization Tips

1. **Always use partition filters** - Skip 80%+ of data files
2. **Cache metadata** - 30-50ms savings per query
3. **Use hourly partitions** for high-volume data
4. **Compact small files** - Reduce metadata overhead
5. **Project only needed columns** - Parquet columnar reads

---

## Next Steps

- **[Schema Reference](/docs/unified-events/schema-reference.md)**: Full 165-column schema documentation
- **[Custom Transformers](/docs/unified-events/custom-transformers.md)**: Create custom event transformers
- **[Getting Started](/docs/unified-events/getting-started.md)**: Quick start with Unified Events
