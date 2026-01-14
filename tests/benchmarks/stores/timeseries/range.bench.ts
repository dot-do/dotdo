/**
 * TimeSeriesStore Range Benchmarks
 *
 * GREEN PHASE: Benchmarks for time-series operations.
 * Tests put, range queries, aggregations, and tier management.
 *
 * @see do-z9k - Store Benchmark Implementation
 */

import { describe, bench, beforeAll, afterAll } from 'vitest'
import { TimeSeriesGenerator } from '../../datasets/timeseries'
import { createMockTimeSeriesStore } from '../harness'
import { CostTracker } from '../../framework/cost-tracker'

describe('TimeSeriesStore Range Benchmarks', () => {
  const generator = new TimeSeriesGenerator()
  let store: ReturnType<typeof createMockTimeSeriesStore>
  let tracker: CostTracker

  beforeAll(async () => {
    // GREEN: Use mock store - will be replaced with real miniflare instance
    store = createMockTimeSeriesStore()
    tracker = new CostTracker()

    // Seed some initial time series data for range/aggregate benchmarks
    const now = Date.now()
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000
    const seedPoints = generator.generateSync({
      size: 1000,
      startTime: new Date(oneWeekAgo),
      interval: 60000, // 1 minute intervals
      seed: 12345,
    })
    await store.putBatch(
      seedPoints.map((p) => ({
        key: 'metric_1',
        value: p.value,
        timestamp: p.timestamp.getTime(),
      }))
    )
    // Create archived metric data
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
    await store.put('archived_metric', 42, thirtyDaysAgo)
  })

  afterAll(async () => {
    // Cleanup
  })

  // =========================================================================
  // SINGLE POINT OPERATIONS
  // =========================================================================

  bench('put single point', async () => {
    await store.put('metric_1', Math.random() * 100, Date.now())
  })

  bench('put single point with key generation', async () => {
    await store.put(`metric_${Date.now()}`, Math.random() * 100, Date.now())
  })

  bench('get latest value for key', async () => {
    await store.get('metric_1')
  })

  bench('getAsOf - time travel query', async () => {
    const oneHourAgo = Date.now() - 3600000
    await store.getAsOf('metric_1', oneHourAgo)
  })

  bench('getAsOf - with ISO string timestamp', async () => {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString()
    await store.getAsOf('metric_1', oneHourAgo)
  })

  // =========================================================================
  // BATCH PUT OPERATIONS
  // =========================================================================

  bench('putBatch 10 points', async () => {
    const points = generator.generateSync({
      size: 10,
      startTime: new Date(),
      interval: 1000,
      seed: Date.now(),
    })
    await store.putBatch(
      points.map((p, i) => ({
        key: `batch_metric_${i}`,
        value: p.value,
        timestamp: p.timestamp.getTime(),
      }))
    )
  })

  bench('putBatch 100 points', async () => {
    const points = generator.generateSync({
      size: 100,
      startTime: new Date(),
      interval: 1000,
      seed: Date.now(),
    })
    await store.putBatch(
      points.map((p, i) => ({
        key: 'batch_metric',
        value: p.value,
        timestamp: p.timestamp.getTime(),
      }))
    )
  })

  bench('putBatch 1000 points', async () => {
    const points = generator.generateSync({
      size: 1000,
      startTime: new Date(),
      interval: 1000,
      seed: Date.now(),
    })
    await store.putBatch(
      points.map((p, i) => ({
        key: 'batch_metric',
        value: p.value,
        timestamp: p.timestamp.getTime(),
      }))
    )
  })

  bench('putBatch 10000 points', async () => {
    const points = generator.generateSync({
      size: 10000,
      startTime: new Date(),
      interval: 100,
      seed: Date.now(),
    })
    await store.putBatch(
      points.map((p) => ({
        key: 'high_freq_metric',
        value: p.value,
        timestamp: p.timestamp.getTime(),
      }))
    )
  })

  // =========================================================================
  // RANGE QUERIES
  // =========================================================================

  bench('range query - 1 minute', async () => {
    const end = Date.now()
    const start = end - 60000 // 1 minute
    const results: unknown[] = []
    for await (const point of store.range('metric_1', { start, end })) {
      results.push(point)
    }
  })

  bench('range query - 1 hour', async () => {
    const end = Date.now()
    const start = end - 3600000 // 1 hour
    const results: unknown[] = []
    for await (const point of store.range('metric_1', { start, end })) {
      results.push(point)
    }
  })

  bench('range query - 1 day', async () => {
    const end = Date.now()
    const start = end - 86400000 // 1 day
    const results: unknown[] = []
    for await (const point of store.range('metric_1', { start, end })) {
      results.push(point)
    }
  })

  bench('range query - 7 days', async () => {
    const end = Date.now()
    const start = end - 604800000 // 7 days
    const results: unknown[] = []
    for await (const point of store.range('metric_1', { start, end })) {
      results.push(point)
    }
  })

  // =========================================================================
  // AGGREGATION QUERIES
  // =========================================================================

  bench('aggregate - 1 minute buckets, count', async () => {
    const end = Date.now()
    const start = end - 3600000
    await store.aggregate('metric_1', {
      start,
      end,
      bucket: '1m',
      metrics: ['count'],
    })
  })

  bench('aggregate - 5 minute buckets, avg', async () => {
    const end = Date.now()
    const start = end - 3600000
    await store.aggregate('metric_1', {
      start,
      end,
      bucket: '5m',
      metrics: ['avg'],
    })
  })

  bench('aggregate - 1 hour buckets, min/max/avg', async () => {
    const end = Date.now()
    const start = end - 86400000
    await store.aggregate('metric_1', {
      start,
      end,
      bucket: '1h',
      metrics: ['min', 'max', 'avg'],
    })
  })

  bench('aggregate - 1 day buckets, full metrics', async () => {
    const end = Date.now()
    const start = end - 604800000
    await store.aggregate('metric_1', {
      start,
      end,
      bucket: '1d',
      metrics: ['min', 'max', 'avg', 'count', 'sum', 'p50', 'p99'],
    })
  })

  bench('aggregate - percentiles only', async () => {
    const end = Date.now()
    const start = end - 3600000
    await store.aggregate('metric_1', {
      start,
      end,
      bucket: '5m',
      metrics: ['p50', 'p99'],
    })
  })

  // =========================================================================
  // TIER MANAGEMENT
  // =========================================================================

  bench('rollup - hourly aggregates', async () => {
    await store.rollup({
      olderThan: '1h',
      bucket: '1h',
      aggregates: ['min', 'max', 'avg', 'count', 'sum'],
    })
  })

  bench('rollup - daily aggregates', async () => {
    await store.rollup({
      olderThan: '7d',
      bucket: '1d',
      aggregates: ['min', 'max', 'avg', 'count', 'sum'],
    })
  })

  bench('archive - move to cold tier', async () => {
    await store.archive({
      olderThan: '30d',
    })
  })

  bench('prune - remove expired data', async () => {
    await store.prune()
  })

  bench('compact - reduce versions per key', async () => {
    await store.compact({ maxVersionsPerKey: 1000 })
  })

  // =========================================================================
  // SNAPSHOTS
  // =========================================================================

  bench('create snapshot', () => {
    store.createSnapshot()
  })

  bench('restore snapshot', async () => {
    const snapshotId = store.createSnapshot()
    await store.restoreSnapshot(snapshotId)
  })

  // =========================================================================
  // HIGH-FREQUENCY INGESTION SIMULATION
  // =========================================================================

  bench('high-frequency put - 100 points/second simulation', async () => {
    const now = Date.now()
    for (let i = 0; i < 100; i++) {
      await store.put('hf_metric', Math.random() * 100, now + i * 10)
    }
  })

  bench('high-frequency put - 1000 points/second simulation', async () => {
    const now = Date.now()
    for (let i = 0; i < 1000; i++) {
      await store.put('hf_metric', Math.random() * 100, now + i)
    }
  })

  // =========================================================================
  // MULTI-KEY OPERATIONS
  // =========================================================================

  bench('put points to multiple keys (10 keys)', async () => {
    const now = Date.now()
    for (let i = 0; i < 10; i++) {
      await store.put(`multi_metric_${i}`, Math.random() * 100, now)
    }
  })

  bench('put points to multiple keys (100 keys)', async () => {
    const now = Date.now()
    for (let i = 0; i < 100; i++) {
      await store.put(`multi_metric_${i}`, Math.random() * 100, now)
    }
  })

  // =========================================================================
  // COLD TIER QUERIES
  // =========================================================================

  bench('get from cold tier (archived data)', async () => {
    // After archive, data moves to cold tier
    await store.get('archived_metric')
  })

  bench('getAsOf from cold tier', async () => {
    const thirtyDaysAgo = Date.now() - 30 * 86400000
    await store.getAsOf('archived_metric', thirtyDaysAgo)
  })
})
