# TimeSeriesStore

> Time-indexed storage with retention, compaction, and range queries

## Overview

TimeSeriesStore provides optimized storage for time-series data like metrics, events, and audit logs. It combines the TemporalStore primitive with automatic tiering, retention policies, and streaming range queries.

## Features

- **Time-indexed** - Optimized for timestamp-based queries
- **Retention policies** - Automatic pruning of old data
- **Compaction** - Roll up detailed data into aggregates
- **Range queries** - Streaming iteration with backpressure
- **Time travel** - Point-in-time queries via `getAsOf()`
- **Three-tier storage** - Hot/warm/cold automatic tiering

## Three-Tier Storage

```
┌─────────────────────────────────────────────────────────────────┐
│ HOT: DO SQLite                                                  │
│ • Recent time windows (last 1 hour default)                     │
│ • Full resolution data points                                   │
│ • Indexed by timestamp for fast range scans                     │
│ • LRU cache for recent getAsOf queries                          │
│ Access: <1ms                                                    │
├─────────────────────────────────────────────────────────────────┤
│ WARM: R2 Parquet                                                │
│ • Rolled-up aggregates (1-min, 5-min, 1-hour buckets)           │
│ • Partitioned by time range (hourly/daily)                      │
│ • Pre-computed statistics (min, max, avg, p50, p99)             │
│ Access: ~50ms                                                   │
├─────────────────────────────────────────────────────────────────┤
│ COLD: R2 Iceberg Archive                                        │
│ • Raw time series data (full resolution)                        │
│ • Compressed with delta encoding + Zstd                         │
│ • Immutable partitions for compliance                           │
│ Access: ~100ms                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Tiering Policy

```typescript
const tieringPolicy = {
  hot: {
    retention: '1h',           // Keep last hour in SQLite
    resolution: 'raw',         // Full resolution
  },
  warm: {
    retention: '7d',           // Keep 7 days rolled up
    resolution: '1m',          // 1-minute aggregates
    aggregates: ['min', 'max', 'avg', 'count', 'sum'],
  },
  cold: {
    retention: '365d',         // Keep 1 year raw
    resolution: 'raw',         // Full resolution for compliance
    compression: 'delta+zstd',
  }
}
```

## API

```typescript
import { TimeSeriesStore } from 'dotdo/db/timeseries'

const metrics = new TimeSeriesStore<Metric>(db, {
  retention: { hot: '1h', warm: '7d', cold: '365d' },
})

// Write data points
await metrics.put('cpu_usage', 0.75, Date.now())
await metrics.put('cpu_usage', 0.82, Date.now() + 1000)

// Batch write
await metrics.putBatch([
  { key: 'memory_mb', value: 1024, timestamp: Date.now() },
  { key: 'disk_io', value: 150, timestamp: Date.now() },
])

// Get current value
const current = await metrics.get('cpu_usage')

// Time travel: what was the value at specific time?
const historical = await metrics.getAsOf('cpu_usage', '2024-01-15T12:00:00Z')

// Range query (streaming with backpressure)
const lastHour = {
  start: Date.now() - 3600000,
  end: Date.now()
}
for await (const point of metrics.range('cpu_usage', lastHour)) {
  await processDataPoint(point)
}

// Aggregated range query (uses warm tier)
const dailyStats = await metrics.aggregate('cpu_usage', {
  start: '2024-01-01',
  end: '2024-01-31',
  bucket: '1d',
  metrics: ['avg', 'max', 'p99']
})
```

## Retention & Compaction

```typescript
// Configure retention
const store = new TimeSeriesStore({
  retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days in hot
  maxVersionsPerKey: 100,               // Max versions per key
})

// Manual prune (usually automatic)
const pruned = await store.prune()
console.log(`Removed ${pruned} old entries from hot tier`)

// Compact to keep only latest N versions per key
await store.compact({ maxVersionsPerKey: 10 })

// Roll up to warm tier
await store.rollup({
  olderThan: '1h',
  bucket: '1m',
  aggregates: ['min', 'max', 'avg', 'count']
})
```

## Snapshots

```typescript
// Create snapshot before risky operation
const snapshotId = store.createSnapshot()

// Perform operations...
await store.put('key1', value1)
await store.put('key2', value2)

// Oops, something went wrong - restore!
await store.restoreSnapshot(snapshotId)
```

## Performance Characteristics

| Operation | Time Complexity | Target Latency |
|-----------|-----------------|----------------|
| put | O(log n) | < 5ms |
| get | O(1) | < 1ms |
| getAsOf (cached) | O(1) | < 1ms |
| getAsOf (uncached) | O(log n) | < 10ms |
| range | O(k + m) | streaming |
| snapshot | O(n) | < 100ms for 10K |
| aggregate (warm) | O(partitions) | < 50ms |

## CDC Events

```typescript
// On write
{
  type: 'cdc.insert',
  op: 'c',
  store: 'timeseries',
  table: 'metrics',
  key: 'cpu_usage',
  timestamp: '2024-01-14T12:00:00Z',
  after: { value: 0.75 }
}

// On rollup (batch)
{
  type: 'cdc.rollup',
  op: 'r',
  store: 'timeseries',
  table: 'metrics',
  partition: 'dt=2024-01-14/hour=12',
  count: 3600,
  aggregates: { min: 0.5, max: 0.95, avg: 0.72 }
}
```

## When to Use

| Use TimeSeriesStore | Use DocumentStore |
|---------------------|-------------------|
| Metrics & monitoring | User profiles |
| Event logs | Transactional data |
| Audit trails | Documents |
| IoT sensor data | General CRUD |

## Dependencies

None. Uses only native SQLite.

## Related Primitives

- [`do/primitives/temporal-store.ts`](../../do/primitives/temporal-store.ts) - Core time-aware KV store
- [`do/primitives/window-manager.ts`](../../do/primitives/window-manager.ts) - Windowing for aggregations

## Implementation Status

| Feature | Status |
|---------|--------|
| Basic put/get | TBD |
| Time travel (getAsOf) | TBD |
| Range queries | TBD |
| Retention policies | TBD |
| Compaction | TBD |
| Rollup aggregates | TBD |
| Snapshots | TBD |
| Hot → Warm tiering | TBD |
| Warm → Cold tiering | TBD |
| CDC integration | TBD |
