/**
 * TimeSeriesStore RED Tests
 *
 * These tests define the expected API for TimeSeriesStore.
 * They are designed to FAIL until the implementation is complete.
 *
 * TimeSeriesStore provides optimized storage for time-series data like:
 * - Metrics & monitoring
 * - Event logs
 * - Audit trails
 * - IoT sensor data
 *
 * Key features:
 * - Time-indexed storage
 * - Time travel (getAsOf)
 * - Range queries with streaming
 * - Retention policies
 * - Compaction/rollup
 * - Three-tier storage (hot/warm/cold)
 * - CDC event emission
 *
 * @see db/timeseries/README.md for full API documentation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TimeSeriesStore } from '../../../db/timeseries'

// Type definitions based on README API
interface Metric {
  value: number
  tags?: Record<string, string>
}

interface DataPoint<T = unknown> {
  key: string
  value: T
  timestamp: number
}

interface AggregateResult {
  bucket: string
  min?: number
  max?: number
  avg?: number
  count?: number
  sum?: number
  p50?: number
  p99?: number
}

interface CDCEvent {
  type: string
  op: string
  store: string
  table: string
  key?: string
  timestamp?: string
  after?: unknown
  partition?: string
  count?: number
  aggregates?: Record<string, number>
}

describe('TimeSeriesStore', () => {
  describe('initialization', () => {
    it('should create a TimeSeriesStore with default configuration', () => {
      // Mock db object - in real implementation this would be SQLite from DO
      const db = {} as any

      const store = new TimeSeriesStore<Metric>(db)

      expect(store).toBeDefined()
      expect(store).toBeInstanceOf(TimeSeriesStore)
    })

    it('should accept retention configuration', () => {
      const db = {} as any

      const store = new TimeSeriesStore<Metric>(db, {
        retention: { hot: '1h', warm: '7d', cold: '365d' },
      })

      expect(store).toBeDefined()
    })

    it('should accept retentionMs for hot tier', () => {
      const db = {} as any

      const store = new TimeSeriesStore<Metric>(db, {
        retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
        maxVersionsPerKey: 100,
      })

      expect(store).toBeDefined()
    })
  })

  describe('put/get operations', () => {
    let store: TimeSeriesStore<number>
    const db = {} as any

    beforeEach(() => {
      store = new TimeSeriesStore<number>(db)
    })

    it('should put a value with explicit timestamp', async () => {
      const timestamp = Date.now()

      await store.put('cpu_usage', 0.75, timestamp)

      const value = await store.get('cpu_usage')
      expect(value).toBe(0.75)
    })

    it('should put multiple values at different timestamps', async () => {
      const now = Date.now()

      await store.put('cpu_usage', 0.75, now)
      await store.put('cpu_usage', 0.82, now + 1000)
      await store.put('cpu_usage', 0.68, now + 2000)

      // get() returns the latest value
      const latest = await store.get('cpu_usage')
      expect(latest).toBe(0.68)
    })

    it('should return undefined for non-existent keys', async () => {
      const value = await store.get('non_existent_key')
      expect(value).toBeUndefined()
    })

    it('should handle batch writes with putBatch', async () => {
      const now = Date.now()

      await store.putBatch([
        { key: 'memory_mb', value: 1024, timestamp: now },
        { key: 'disk_io', value: 150, timestamp: now },
        { key: 'network_rx', value: 500, timestamp: now },
      ])

      const memory = await store.get('memory_mb')
      const disk = await store.get('disk_io')
      const network = await store.get('network_rx')

      expect(memory).toBe(1024)
      expect(disk).toBe(150)
      expect(network).toBe(500)
    })

    it('should preserve all timestamps for time travel', async () => {
      const now = Date.now()

      await store.put('cpu_usage', 0.50, now - 10000)
      await store.put('cpu_usage', 0.75, now - 5000)
      await store.put('cpu_usage', 0.90, now)

      // All three values should be queryable via getAsOf
      const oldest = await store.getAsOf('cpu_usage', now - 10000)
      const middle = await store.getAsOf('cpu_usage', now - 5000)
      const latest = await store.getAsOf('cpu_usage', now)

      expect(oldest).toBe(0.50)
      expect(middle).toBe(0.75)
      expect(latest).toBe(0.90)
    })
  })

  describe('time travel (getAsOf)', () => {
    let store: TimeSeriesStore<number>
    const db = {} as any

    beforeEach(() => {
      store = new TimeSeriesStore<number>(db)
    })

    it('should return value at specific timestamp with number', async () => {
      const now = Date.now()

      await store.put('cpu_usage', 0.50, now - 60000)  // 1 minute ago
      await store.put('cpu_usage', 0.75, now - 30000)  // 30 seconds ago
      await store.put('cpu_usage', 0.90, now)         // now

      // Get value as of 45 seconds ago (should return 0.50)
      const historical = await store.getAsOf('cpu_usage', now - 45000)
      expect(historical).toBe(0.50)
    })

    it('should return value at specific timestamp with ISO string', async () => {
      const baseTime = new Date('2024-01-15T12:00:00Z').getTime()

      await store.put('cpu_usage', 0.50, baseTime)
      await store.put('cpu_usage', 0.75, baseTime + 60000)  // +1 minute

      const historical = await store.getAsOf('cpu_usage', '2024-01-15T12:00:00Z')
      expect(historical).toBe(0.50)

      const later = await store.getAsOf('cpu_usage', '2024-01-15T12:01:00Z')
      expect(later).toBe(0.75)
    })

    it('should return undefined for timestamp before any data', async () => {
      const now = Date.now()

      await store.put('cpu_usage', 0.75, now)

      const before = await store.getAsOf('cpu_usage', now - 10000)
      expect(before).toBeUndefined()
    })

    it('should return most recent value at or before timestamp', async () => {
      const now = Date.now()

      await store.put('cpu_usage', 0.50, now - 60000)
      await store.put('cpu_usage', 0.75, now - 30000)
      await store.put('cpu_usage', 0.90, now)

      // Query at exact timestamp of middle write
      const atMiddle = await store.getAsOf('cpu_usage', now - 30000)
      expect(atMiddle).toBe(0.75)

      // Query between middle and latest - should return middle
      const between = await store.getAsOf('cpu_usage', now - 15000)
      expect(between).toBe(0.75)
    })

    it('should use LRU cache for repeated getAsOf queries', async () => {
      const now = Date.now()

      await store.put('cpu_usage', 0.75, now)

      // First call - cache miss
      const first = await store.getAsOf('cpu_usage', now)
      // Second call - should be cached
      const second = await store.getAsOf('cpu_usage', now)

      expect(first).toBe(second)
      // Note: In implementation, we'd verify cache hit via metrics or spy
    })
  })

  describe('range queries', () => {
    let store: TimeSeriesStore<number>
    const db = {} as any

    beforeEach(() => {
      store = new TimeSeriesStore<number>(db)
    })

    it('should return async iterable for range query', async () => {
      const now = Date.now()

      // Insert data points
      for (let i = 0; i < 10; i++) {
        await store.put('cpu_usage', 0.5 + i * 0.05, now - (10 - i) * 1000)
      }

      const range = { start: now - 10000, end: now }
      const points: DataPoint<number>[] = []

      for await (const point of store.range('cpu_usage', range)) {
        points.push(point)
      }

      expect(points.length).toBe(10)
      // Should be in timestamp order (oldest first)
      expect(points[0].timestamp).toBeLessThan(points[9].timestamp)
    })

    it('should support streaming with backpressure', async () => {
      const now = Date.now()

      // Insert 1000 data points
      for (let i = 0; i < 1000; i++) {
        await store.put('cpu_usage', Math.random(), now - (1000 - i) * 100)
      }

      const range = { start: now - 100000, end: now }
      let count = 0

      for await (const point of store.range('cpu_usage', range)) {
        count++
        // Simulate async processing
        await new Promise(resolve => setImmediate(resolve))
        if (count >= 100) break // Early exit after 100 points
      }

      expect(count).toBe(100)
    })

    it('should accept Date objects for range bounds', async () => {
      const now = Date.now()
      await store.put('cpu_usage', 0.75, now)

      const range = {
        start: new Date(now - 1000),
        end: new Date(now + 1000),
      }

      const points: DataPoint<number>[] = []
      for await (const point of store.range('cpu_usage', range)) {
        points.push(point)
      }

      expect(points.length).toBeGreaterThanOrEqual(1)
    })

    it('should accept ISO string dates for range bounds', async () => {
      const baseTime = new Date('2024-01-15T12:00:00Z').getTime()

      await store.put('cpu_usage', 0.75, baseTime)
      await store.put('cpu_usage', 0.80, baseTime + 60000)

      const range = {
        start: '2024-01-15T11:59:00Z',
        end: '2024-01-15T12:02:00Z',
      }

      const points: DataPoint<number>[] = []
      for await (const point of store.range('cpu_usage', range)) {
        points.push(point)
      }

      expect(points.length).toBe(2)
    })

    it('should return empty iterator for range with no data', async () => {
      const now = Date.now()

      const range = { start: now - 10000, end: now }
      const points: DataPoint<number>[] = []

      for await (const point of store.range('non_existent', range)) {
        points.push(point)
      }

      expect(points.length).toBe(0)
    })
  })

  describe('aggregated range queries', () => {
    let store: TimeSeriesStore<number>
    const db = {} as any

    beforeEach(async () => {
      store = new TimeSeriesStore<number>(db)

      // Insert data points across January 2024
      const baseTime = new Date('2024-01-01T00:00:00Z').getTime()
      for (let day = 0; day < 31; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const timestamp = baseTime + day * 86400000 + hour * 3600000
          const value = 0.5 + Math.random() * 0.5 // Random value between 0.5 and 1.0
          await store.put('cpu_usage', value, timestamp)
        }
      }
    })

    it('should compute aggregates over time buckets', async () => {
      const result = await store.aggregate('cpu_usage', {
        start: '2024-01-01',
        end: '2024-01-31',
        bucket: '1d',
        metrics: ['avg', 'max', 'p99'],
      })

      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)

      // Each result should have the requested metrics
      const firstDay = result[0]
      expect(firstDay.bucket).toBeDefined()
      expect(firstDay.avg).toBeDefined()
      expect(firstDay.max).toBeDefined()
      expect(firstDay.p99).toBeDefined()
    })

    it('should support different bucket sizes', async () => {
      // Hourly buckets
      const hourlyResult = await store.aggregate('cpu_usage', {
        start: '2024-01-01',
        end: '2024-01-02',
        bucket: '1h',
        metrics: ['avg'],
      })
      expect(hourlyResult.length).toBe(24)

      // Daily buckets
      const dailyResult = await store.aggregate('cpu_usage', {
        start: '2024-01-01',
        end: '2024-01-08',
        bucket: '1d',
        metrics: ['avg'],
      })
      expect(dailyResult.length).toBe(7)
    })

    it('should compute all standard metrics', async () => {
      const result = await store.aggregate('cpu_usage', {
        start: '2024-01-01',
        end: '2024-01-02',
        bucket: '1d',
        metrics: ['min', 'max', 'avg', 'count', 'sum', 'p50', 'p99'],
      })

      expect(result.length).toBe(1)
      const day = result[0]

      expect(day.min).toBeDefined()
      expect(day.max).toBeDefined()
      expect(day.avg).toBeDefined()
      expect(day.count).toBeDefined()
      expect(day.sum).toBeDefined()
      expect(day.p50).toBeDefined()
      expect(day.p99).toBeDefined()

      // Verify basic sanity checks
      expect(day.min).toBeLessThanOrEqual(day.avg!)
      expect(day.avg).toBeLessThanOrEqual(day.max!)
      expect(day.p50).toBeLessThanOrEqual(day.p99!)
    })

    it('should use warm tier for aggregated queries', async () => {
      // After rollup, aggregates should come from warm tier
      await store.rollup({
        olderThan: '1h',
        bucket: '1h',
        aggregates: ['min', 'max', 'avg', 'count'],
      })

      const result = await store.aggregate('cpu_usage', {
        start: '2024-01-01',
        end: '2024-01-31',
        bucket: '1d',
        metrics: ['avg'],
      })

      // Should still work after rollup
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('retention policies', () => {
    let store: TimeSeriesStore<number>
    const db = {} as any

    beforeEach(() => {
      store = new TimeSeriesStore<number>(db, {
        retentionMs: 60 * 60 * 1000, // 1 hour in hot tier
        maxVersionsPerKey: 100,
      })
    })

    it('should automatically prune data older than retention', async () => {
      const now = Date.now()
      const twoHoursAgo = now - 2 * 60 * 60 * 1000

      // Insert old data
      await store.put('cpu_usage', 0.50, twoHoursAgo)
      // Insert recent data
      await store.put('cpu_usage', 0.75, now)

      // Prune old data
      const pruned = await store.prune()

      expect(pruned).toBeGreaterThanOrEqual(1)

      // Old data should be gone from hot tier
      const old = await store.getAsOf('cpu_usage', twoHoursAgo)
      expect(old).toBeUndefined()

      // Recent data should remain
      const recent = await store.get('cpu_usage')
      expect(recent).toBe(0.75)
    })

    it('should return count of pruned entries', async () => {
      const now = Date.now()
      const twoHoursAgo = now - 2 * 60 * 60 * 1000

      // Insert multiple old entries
      for (let i = 0; i < 10; i++) {
        await store.put('cpu_usage', 0.5 + i * 0.05, twoHoursAgo + i * 1000)
      }

      const pruned = await store.prune()
      expect(pruned).toBe(10)
    })

    it('should respect maxVersionsPerKey during compaction', async () => {
      const now = Date.now()

      // Insert 200 versions
      for (let i = 0; i < 200; i++) {
        await store.put('cpu_usage', Math.random(), now - (200 - i) * 100)
      }

      // Compact to keep only latest 10
      await store.compact({ maxVersionsPerKey: 10 })

      // Should only have 10 versions remaining
      const range = { start: now - 100000, end: now }
      let count = 0
      for await (const _ of store.range('cpu_usage', range)) {
        count++
      }

      expect(count).toBe(10)
    })

    it('should keep newest versions during compaction', async () => {
      const now = Date.now()

      // Insert 100 versions
      for (let i = 0; i < 100; i++) {
        await store.put('cpu_usage', i / 100, now - (100 - i) * 1000)
      }

      await store.compact({ maxVersionsPerKey: 5 })

      // The latest value should still be the most recent
      const latest = await store.get('cpu_usage')
      expect(latest).toBe(0.99) // Last inserted value was 99/100
    })
  })

  describe('rollup to warm tier', () => {
    let store: TimeSeriesStore<number>
    const db = {} as any

    beforeEach(async () => {
      store = new TimeSeriesStore<number>(db, {
        retention: { hot: '1h', warm: '7d', cold: '365d' },
      })

      // Insert high-resolution data
      const now = Date.now()
      for (let i = 0; i < 3600; i++) { // 1 hour of per-second data
        await store.put('cpu_usage', 0.5 + Math.random() * 0.5, now - (3600 - i) * 1000)
      }
    })

    it('should rollup data to specified bucket size', async () => {
      await store.rollup({
        olderThan: '1h',
        bucket: '1m',
        aggregates: ['min', 'max', 'avg', 'count'],
      })

      // Hot tier should be compacted, warm tier should have 60 1-minute buckets
      // Verify via aggregate query on warm tier
      const result = await store.aggregate('cpu_usage', {
        start: Date.now() - 3600000,
        end: Date.now(),
        bucket: '1m',
        metrics: ['avg'],
      })

      expect(result.length).toBe(60)
    })

    it('should preserve specified aggregates during rollup', async () => {
      await store.rollup({
        olderThan: '30m',
        bucket: '5m',
        aggregates: ['min', 'max', 'avg', 'count', 'sum'],
      })

      const result = await store.aggregate('cpu_usage', {
        start: Date.now() - 1800000, // Last 30 minutes
        end: Date.now(),
        bucket: '5m',
        metrics: ['min', 'max', 'avg', 'count', 'sum'],
      })

      for (const bucket of result) {
        expect(bucket.min).toBeDefined()
        expect(bucket.max).toBeDefined()
        expect(bucket.avg).toBeDefined()
        expect(bucket.count).toBeDefined()
        expect(bucket.sum).toBeDefined()
      }
    })

    it('should remove raw data from hot tier after rollup', async () => {
      const thirtyMinsAgo = Date.now() - 30 * 60 * 1000

      await store.rollup({
        olderThan: '30m',
        bucket: '1m',
        aggregates: ['avg'],
      })

      // Raw data older than 30 minutes should be gone from hot tier
      // Range query on hot tier should return fewer points
      const range = { start: thirtyMinsAgo - 60000, end: thirtyMinsAgo }
      let count = 0
      for await (const _ of store.range('cpu_usage', range)) {
        count++
      }

      // Should have 0 raw points in that range (they were rolled up)
      expect(count).toBe(0)
    })
  })

  describe('snapshots', () => {
    let store: TimeSeriesStore<number>
    const db = {} as any

    beforeEach(() => {
      store = new TimeSeriesStore<number>(db)
    })

    it('should create a snapshot and return snapshot ID', async () => {
      await store.put('cpu_usage', 0.75, Date.now())

      const snapshotId = store.createSnapshot()

      expect(snapshotId).toBeDefined()
      expect(typeof snapshotId).toBe('string')
    })

    it('should restore to snapshot state', async () => {
      const now = Date.now()

      await store.put('cpu_usage', 0.75, now)

      const snapshotId = store.createSnapshot()

      // Make changes after snapshot
      await store.put('cpu_usage', 0.99, now + 1000)
      await store.put('memory_mb', 2048, now + 1000)

      // Verify changes exist
      expect(await store.get('cpu_usage')).toBe(0.99)
      expect(await store.get('memory_mb')).toBe(2048)

      // Restore snapshot
      await store.restoreSnapshot(snapshotId)

      // Should be back to pre-change state
      expect(await store.get('cpu_usage')).toBe(0.75)
      expect(await store.get('memory_mb')).toBeUndefined()
    })

    it('should support multiple snapshots', async () => {
      const now = Date.now()

      await store.put('cpu_usage', 0.50, now)
      const snapshot1 = store.createSnapshot()

      await store.put('cpu_usage', 0.75, now + 1000)
      const snapshot2 = store.createSnapshot()

      await store.put('cpu_usage', 0.99, now + 2000)

      // Restore to first snapshot
      await store.restoreSnapshot(snapshot1)
      expect(await store.get('cpu_usage')).toBe(0.50)

      // Restore to second snapshot
      await store.restoreSnapshot(snapshot2)
      expect(await store.get('cpu_usage')).toBe(0.75)
    })

    it('should throw for invalid snapshot ID', async () => {
      await expect(store.restoreSnapshot('invalid-snapshot-id'))
        .rejects.toThrow()
    })
  })

  describe('CDC event emission', () => {
    let store: TimeSeriesStore<number>
    let cdcHandler: ReturnType<typeof vi.fn>
    const db = {} as any

    beforeEach(() => {
      cdcHandler = vi.fn()
      store = new TimeSeriesStore<number>(db, {
        onCDC: cdcHandler,
      })
    })

    it('should emit cdc.insert event on put', async () => {
      const now = Date.now()

      await store.put('cpu_usage', 0.75, now)

      expect(cdcHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cdc.insert',
          op: 'c',
          store: 'timeseries',
          key: 'cpu_usage',
          after: { value: 0.75 },
        })
      )
    })

    it('should include timestamp in CDC event', async () => {
      const now = Date.now()
      const isoTimestamp = new Date(now).toISOString()

      await store.put('cpu_usage', 0.75, now)

      expect(cdcHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: isoTimestamp,
        })
      )
    })

    it('should emit cdc.insert for each item in batch', async () => {
      const now = Date.now()

      await store.putBatch([
        { key: 'cpu_usage', value: 0.75, timestamp: now },
        { key: 'memory_mb', value: 1024, timestamp: now },
      ])

      expect(cdcHandler).toHaveBeenCalledTimes(2)
    })

    it('should emit cdc.rollup event on rollup', async () => {
      const now = Date.now()

      // Insert data to rollup
      for (let i = 0; i < 60; i++) {
        await store.put('cpu_usage', 0.5 + Math.random() * 0.5, now - (60 - i) * 60000)
      }

      cdcHandler.mockClear()

      await store.rollup({
        olderThan: '30m',
        bucket: '1m',
        aggregates: ['min', 'max', 'avg', 'count'],
      })

      // Should emit rollup CDC events
      const rollupCalls = cdcHandler.mock.calls.filter(
        (call: [CDCEvent]) => call[0].type === 'cdc.rollup'
      )
      expect(rollupCalls.length).toBeGreaterThan(0)

      const rollupEvent = rollupCalls[0][0] as CDCEvent
      expect(rollupEvent.op).toBe('r')
      expect(rollupEvent.store).toBe('timeseries')
      expect(rollupEvent.partition).toBeDefined()
      expect(rollupEvent.count).toBeDefined()
      expect(rollupEvent.aggregates).toBeDefined()
    })

    it('should include table name in CDC events', async () => {
      const customStore = new TimeSeriesStore<number>(db, {
        table: 'metrics',
        onCDC: cdcHandler,
      })

      await customStore.put('cpu_usage', 0.75, Date.now())

      expect(cdcHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'metrics',
        })
      )
    })
  })

  describe('three-tier storage', () => {
    let store: TimeSeriesStore<number>
    const db = {} as any

    beforeEach(() => {
      store = new TimeSeriesStore<number>(db, {
        retention: {
          hot: '1h',
          warm: '7d',
          cold: '365d',
        },
      })
    })

    it('should store recent data in hot tier (SQLite)', async () => {
      const now = Date.now()

      await store.put('cpu_usage', 0.75, now)

      // Recent data should be in hot tier - fast access
      const value = await store.get('cpu_usage')
      expect(value).toBe(0.75)
    })

    it('should tier data to warm after hot retention period', async () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000

      await store.put('cpu_usage', 0.75, twoHoursAgo)

      // Trigger tiering
      await store.rollup({
        olderThan: '1h',
        bucket: '1m',
        aggregates: ['min', 'max', 'avg', 'count', 'sum'],
      })

      // Data should still be accessible via aggregate queries (warm tier)
      const result = await store.aggregate('cpu_usage', {
        start: twoHoursAgo - 60000,
        end: twoHoursAgo + 60000,
        bucket: '1m',
        metrics: ['avg'],
      })

      expect(result.length).toBeGreaterThan(0)
    })

    it('should archive to cold tier with full resolution', async () => {
      const store = new TimeSeriesStore<number>(db, {
        retention: { hot: '1h', warm: '7d', cold: '365d' },
      })

      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000

      await store.put('cpu_usage', 0.75, eightDaysAgo)

      // Trigger archival to cold tier
      await store.archive({
        olderThan: '7d',
      })

      // Raw data should still be accessible from cold tier
      const historical = await store.getAsOf('cpu_usage', eightDaysAgo)
      expect(historical).toBe(0.75)
    })

    it('should query across tiers transparently', async () => {
      const now = Date.now()
      const oneHourAgo = now - 60 * 60 * 1000
      const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000

      // Insert data at different ages
      await store.put('cpu_usage', 0.75, now)         // Hot tier
      await store.put('cpu_usage', 0.65, oneHourAgo)  // Will be in warm after rollup
      await store.put('cpu_usage', 0.55, twoDaysAgo)  // Will be in warm after rollup

      // Rollup old data
      await store.rollup({
        olderThan: '30m',
        bucket: '1m',
        aggregates: ['avg'],
      })

      // Range query should span multiple tiers
      const result = await store.aggregate('cpu_usage', {
        start: twoDaysAgo - 60000,
        end: now + 60000,
        bucket: '1h',
        metrics: ['avg'],
      })

      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('performance characteristics', () => {
    let store: TimeSeriesStore<number>
    const db = {} as any

    beforeEach(() => {
      store = new TimeSeriesStore<number>(db)
    })

    it('should perform put in O(log n)', async () => {
      // Insert 10,000 data points
      const now = Date.now()
      const start = performance.now()

      for (let i = 0; i < 10000; i++) {
        await store.put('cpu_usage', Math.random(), now - i * 100)
      }

      const elapsed = performance.now() - start

      // Should complete in reasonable time (< 5s for 10K writes)
      expect(elapsed).toBeLessThan(5000)
    })

    it('should perform get in O(1)', async () => {
      const now = Date.now()

      // Setup: insert many data points
      for (let i = 0; i < 10000; i++) {
        await store.put('cpu_usage', Math.random(), now - i * 100)
      }

      // Benchmark get
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        await store.get('cpu_usage')
      }
      const elapsed = performance.now() - start

      // 1000 gets should be very fast (< 100ms)
      expect(elapsed).toBeLessThan(100)
    })

    it('should create snapshot in O(n)', async () => {
      const now = Date.now()

      // Insert 10,000 data points
      for (let i = 0; i < 10000; i++) {
        await store.put(`key_${i % 100}`, Math.random(), now - i * 100)
      }

      const start = performance.now()
      store.createSnapshot()
      const elapsed = performance.now() - start

      // Snapshot of 10K entries should be < 100ms
      expect(elapsed).toBeLessThan(100)
    })
  })

  describe('edge cases', () => {
    let store: TimeSeriesStore<number>
    const db = {} as any

    beforeEach(() => {
      store = new TimeSeriesStore<number>(db)
    })

    it('should handle concurrent writes to same key', async () => {
      const now = Date.now()

      // Concurrent writes
      await Promise.all([
        store.put('cpu_usage', 0.75, now),
        store.put('cpu_usage', 0.80, now + 1),
        store.put('cpu_usage', 0.85, now + 2),
      ])

      // Latest value should be deterministically the one with highest timestamp
      const value = await store.get('cpu_usage')
      expect(value).toBe(0.85)
    })

    it('should handle very large values', async () => {
      const now = Date.now()
      const largeValue = Number.MAX_SAFE_INTEGER

      await store.put('large', largeValue, now)

      const retrieved = await store.get('large')
      expect(retrieved).toBe(largeValue)
    })

    it('should handle very small (negative) values', async () => {
      const now = Date.now()
      const smallValue = Number.MIN_SAFE_INTEGER

      await store.put('small', smallValue, now)

      const retrieved = await store.get('small')
      expect(retrieved).toBe(smallValue)
    })

    it('should handle floating point precision', async () => {
      const now = Date.now()
      const preciseValue = 0.1 + 0.2 // JavaScript floating point

      await store.put('precise', preciseValue, now)

      const retrieved = await store.get('precise')
      expect(retrieved).toBeCloseTo(0.3, 15)
    })

    it('should handle empty key', async () => {
      const now = Date.now()

      await expect(store.put('', 0.75, now)).rejects.toThrow()
    })

    it('should handle special characters in keys', async () => {
      const now = Date.now()
      const specialKey = 'cpu:usage.host=server-1,region="us-east"'

      await store.put(specialKey, 0.75, now)

      const value = await store.get(specialKey)
      expect(value).toBe(0.75)
    })

    it('should handle timestamps at epoch boundaries', async () => {
      // Near epoch start
      await store.put('early', 0.5, 1000)

      // Far future
      const farFuture = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000 // 100 years
      await store.put('future', 0.9, farFuture)

      expect(await store.get('early')).toBe(0.5)
      expect(await store.get('future')).toBe(0.9)
    })
  })
})
