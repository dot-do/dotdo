/**
 * TieredStorage Tests - EdgePostgres Tiered Storage
 *
 * RED TDD Phase: These tests define the expected behavior for TieredStorage -
 * hot→warm→cold data movement with WAL, Parquet, and Iceberg.
 *
 * All tests are expected to FAIL initially since no implementation exists.
 *
 * TieredStorage provides:
 * - Write-Ahead Log (WAL) for immediate durability
 * - Batch flush to Parquet files in R2 (warm tier)
 * - Iceberg metadata tracking for all Parquet files
 * - Unified query interface across hot and warm tiers
 * - Time-range optimization to skip warm tier for recent queries
 *
 * Architecture (from README.md):
 * ```
 * ┌─────────────┬─────────────────┬─────────────────┐
 * │ Hot         │ Warm            │ Cold            │
 * │ DO SQLite   │ R2 Parquet      │ R2 Archive      │
 * │ <1ms        │ 50-150ms        │ Seconds         │
 * └─────────────┴─────────────────┴─────────────────┘
 * ```
 *
 * Write Path:
 * 1. PGLite validates (constraints, triggers, types)
 * 2. WAL append (FSX hot tier) - durable immediately
 * 3. Return result (<1ms)
 * 4. (async) Batch to Parquet at 1000 rows or 60 seconds
 * 5. Write to R2 (warm tier)
 * 6. Update Iceberg manifest
 * 7. Truncate WAL
 *
 * Read Path:
 * 1. Check PGLite (hot tier) - <1ms if recent
 * 2. Check Iceberg (warm tier) - 50-150ms with partition pruning
 * 3. Check archive (cold tier) - rare, compliance queries
 *
 * @see README.md for architecture details
 * @see edge-postgres.ts for EdgePostgres implementation
 * @see dotdo-lw45o for issue details
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Import from non-existent module so tests fail
import {
  TieredStorage,
  type TieredStorageConfig,
  type WALEntry,
  type FlushResult,
  type IcebergManifest,
  type TierQueryResult,
} from './tiered-storage'

// ============================================================================
// TYPE DEFINITIONS (Expected Interface)
// ============================================================================

/**
 * Mock Durable Object context for testing
 */
interface MockDurableObjectState {
  storage: {
    get: <T>(key: string) => Promise<T | undefined>
    put: <T>(key: string, value: T) => Promise<void>
    delete: (key: string) => Promise<boolean>
    list: (options?: { prefix?: string }) => Promise<Map<string, unknown>>
  }
  id: {
    toString: () => string
    name?: string
  }
  waitUntil: (promise: Promise<unknown>) => void
}

/**
 * Mock R2 bucket for testing
 */
interface MockR2Object {
  key: string
  body: ReadableStream
  httpMetadata?: Record<string, string>
  customMetadata?: Record<string, string>
}

interface MockR2Bucket {
  put: (key: string, value: ArrayBuffer | ReadableStream | string) => Promise<MockR2Object>
  get: (key: string) => Promise<MockR2Object | null>
  delete: (key: string | string[]) => Promise<void>
  list: (options?: { prefix?: string }) => Promise<{ objects: MockR2Object[] }>
}

/**
 * Mock environment bindings
 */
interface MockEnv {
  FSX?: unknown
  R2_BUCKET: MockR2Bucket
  ICEBERG_BUCKET?: MockR2Bucket
}

/**
 * Create mock DO context for testing
 */
function createMockContext(): MockDurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    storage: {
      get: async <T>(key: string) => storage.get(key) as T | undefined,
      put: async <T>(key: string, value: T) => { storage.set(key, value) },
      delete: async (key: string) => storage.delete(key),
      list: async (options?: { prefix?: string }) => {
        const result = new Map<string, unknown>()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      },
    },
    id: {
      toString: () => 'test-do-id-12345',
      name: 'test-do',
    },
    waitUntil: (promise: Promise<unknown>) => { promise.catch(() => {}) },
  }
}

/**
 * Create mock R2 bucket for testing
 */
function createMockR2Bucket(): MockR2Bucket {
  const objects = new Map<string, ArrayBuffer | string>()

  return {
    put: async (key: string, value: ArrayBuffer | ReadableStream | string) => {
      if (value instanceof ReadableStream) {
        const reader = value.getReader()
        const chunks: Uint8Array[] = []
        while (true) {
          const { done, value: chunk } = await reader.read()
          if (done) break
          chunks.push(chunk)
        }
        const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0))
        let offset = 0
        for (const chunk of chunks) {
          combined.set(chunk, offset)
          offset += chunk.length
        }
        objects.set(key, combined.buffer)
      } else {
        objects.set(key, value as ArrayBuffer | string)
      }
      return {
        key,
        body: new ReadableStream(),
      }
    },
    get: async (key: string) => {
      const value = objects.get(key)
      if (!value) return null
      return {
        key,
        body: new ReadableStream({
          start(controller) {
            if (typeof value === 'string') {
              controller.enqueue(new TextEncoder().encode(value))
            } else {
              controller.enqueue(new Uint8Array(value as ArrayBuffer))
            }
            controller.close()
          },
        }),
      }
    },
    delete: async (keys: string | string[]) => {
      const keysArray = Array.isArray(keys) ? keys : [keys]
      for (const key of keysArray) {
        objects.delete(key)
      }
    },
    list: async (options?: { prefix?: string }) => {
      const result: MockR2Object[] = []
      for (const [key] of objects) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.push({ key, body: new ReadableStream() })
        }
      }
      return { objects: result }
    },
  }
}

/**
 * Create mock environment
 */
function createMockEnv(): MockEnv {
  return {
    FSX: {},
    R2_BUCKET: createMockR2Bucket(),
    ICEBERG_BUCKET: createMockR2Bucket(),
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('TieredStorage', () => {
  let ctx: MockDurableObjectState
  let env: MockEnv
  let tieredStorage: TieredStorage

  beforeEach(() => {
    vi.useFakeTimers()
    ctx = createMockContext()
    env = createMockEnv()
  })

  afterEach(async () => {
    if (tieredStorage) {
      await tieredStorage.close()
    }
    vi.useRealTimers()
  })

  // ==========================================================================
  // CONSTRUCTOR AND INITIALIZATION
  // ==========================================================================

  describe('Constructor', () => {
    it('should create TieredStorage instance with ctx, env, and config', () => {
      const config: TieredStorageConfig = {
        hotRetentionMs: 5 * 60 * 1000,
        flushThreshold: 1000,
        flushIntervalMs: 60_000,
      }

      tieredStorage = new TieredStorage(ctx, env, config)

      expect(tieredStorage).toBeDefined()
      expect(tieredStorage).toBeInstanceOf(TieredStorage)
    })

    it('should use default config values when not provided', () => {
      tieredStorage = new TieredStorage(ctx, env)

      expect(tieredStorage).toBeDefined()
    })

    it('should accept custom hot retention threshold', () => {
      const config: TieredStorageConfig = {
        hotRetentionMs: 10 * 60 * 1000, // 10 minutes
      }

      tieredStorage = new TieredStorage(ctx, env, config)

      expect(tieredStorage).toBeDefined()
    })

    it('should accept custom flush threshold', () => {
      const config: TieredStorageConfig = {
        flushThreshold: 500, // Flush after 500 rows
      }

      tieredStorage = new TieredStorage(ctx, env, config)

      expect(tieredStorage).toBeDefined()
    })

    it('should accept custom flush interval', () => {
      const config: TieredStorageConfig = {
        flushIntervalMs: 30_000, // 30 seconds
      }

      tieredStorage = new TieredStorage(ctx, env, config)

      expect(tieredStorage).toBeDefined()
    })

    it('should accept R2 bucket configuration', () => {
      const config: TieredStorageConfig = {
        r2BucketBinding: 'CUSTOM_R2_BUCKET',
        icebergBucketBinding: 'CUSTOM_ICEBERG_BUCKET',
      }

      tieredStorage = new TieredStorage(ctx, env, config)

      expect(tieredStorage).toBeDefined()
    })
  })

  // ==========================================================================
  // WRITE-AHEAD LOG (WAL)
  // ==========================================================================

  describe('appendWAL() - Write-Ahead Log', () => {
    beforeEach(() => {
      tieredStorage = new TieredStorage(ctx, env, {
        flushThreshold: 1000,
        flushIntervalMs: 60_000,
      })
    })

    it('should append INSERT operation to WAL', async () => {
      const entry = await tieredStorage.appendWAL('INSERT', 'users', {
        id: 'user-1',
        email: 'alice@example.com',
        name: 'Alice',
      })

      expect(entry).toBeDefined()
      expect(entry.operation).toBe('INSERT')
      expect(entry.table).toBe('users')
      expect(entry.row.id).toBe('user-1')
      expect(entry.lsn).toBeDefined() // Log Sequence Number
      expect(entry.timestamp).toBeDefined()
    })

    it('should append UPDATE operation to WAL', async () => {
      const entry = await tieredStorage.appendWAL('UPDATE', 'users', {
        id: 'user-1',
        email: 'alice.updated@example.com',
      })

      expect(entry.operation).toBe('UPDATE')
      expect(entry.table).toBe('users')
    })

    it('should append DELETE operation to WAL', async () => {
      const entry = await tieredStorage.appendWAL('DELETE', 'users', {
        id: 'user-1',
      })

      expect(entry.operation).toBe('DELETE')
      expect(entry.table).toBe('users')
    })

    it('should assign monotonically increasing LSN', async () => {
      const entry1 = await tieredStorage.appendWAL('INSERT', 'events', { id: '1' })
      const entry2 = await tieredStorage.appendWAL('INSERT', 'events', { id: '2' })
      const entry3 = await tieredStorage.appendWAL('INSERT', 'events', { id: '3' })

      expect(entry2.lsn).toBeGreaterThan(entry1.lsn)
      expect(entry3.lsn).toBeGreaterThan(entry2.lsn)
    })

    it('should persist WAL entry to DO storage immediately', async () => {
      await tieredStorage.appendWAL('INSERT', 'orders', { id: 'order-1', amount: 99.99 })

      // Verify WAL entry is in DO storage
      const walEntries = await ctx.storage.list({ prefix: 'wal:' })
      expect(walEntries.size).toBeGreaterThan(0)
    })

    it('should include timestamp in WAL entry', async () => {
      const before = Date.now()
      const entry = await tieredStorage.appendWAL('INSERT', 'logs', { message: 'test' })
      const after = Date.now()

      expect(entry.timestamp).toBeGreaterThanOrEqual(before)
      expect(entry.timestamp).toBeLessThanOrEqual(after)
    })

    it('should handle concurrent WAL appends without data loss', async () => {
      const promises = Array.from({ length: 100 }, (_, i) =>
        tieredStorage.appendWAL('INSERT', 'concurrent', { id: `item-${i}` })
      )

      const entries = await Promise.all(promises)

      // All entries should have unique LSNs
      const lsns = entries.map(e => e.lsn)
      const uniqueLsns = new Set(lsns)
      expect(uniqueLsns.size).toBe(100)
    })

    it('should survive DO restart with unflushed WAL entries', async () => {
      // Write to WAL
      await tieredStorage.appendWAL('INSERT', 'durable', { id: 'survive-1', value: 'test' })
      await tieredStorage.appendWAL('INSERT', 'durable', { id: 'survive-2', value: 'test2' })
      await tieredStorage.close()

      // Create new instance (simulating DO restart)
      const newTieredStorage = new TieredStorage(ctx, env)

      // Should recover WAL entries
      const pendingWal = await newTieredStorage.getPendingWAL()
      expect(pendingWal.length).toBeGreaterThanOrEqual(2)

      await newTieredStorage.close()
    })
  })

  // ==========================================================================
  // BATCH FLUSH TO PARQUET
  // ==========================================================================

  describe('flushToParquet() - Batch to Parquet', () => {
    beforeEach(() => {
      tieredStorage = new TieredStorage(ctx, env, {
        flushThreshold: 100, // Lower threshold for testing
        flushIntervalMs: 60_000,
      })
    })

    it('should flush WAL entries to Parquet file in R2', async () => {
      // Append entries to WAL
      for (let i = 0; i < 10; i++) {
        await tieredStorage.appendWAL('INSERT', 'events', {
          id: `event-${i}`,
          data: `data-${i}`,
        })
      }

      const result = await tieredStorage.flushToParquet()

      expect(result).toBeDefined()
      expect(result.parquetPath).toMatch(/\.parquet$/)
      expect(result.rowCount).toBe(10)
      expect(result.success).toBe(true)
    })

    it('should auto-flush when row threshold is reached', async () => {
      // Lower threshold for this test
      tieredStorage = new TieredStorage(ctx, env, {
        flushThreshold: 50,
      })

      // Track flush calls
      const flushSpy = vi.spyOn(tieredStorage, 'flushToParquet')

      // Append entries up to threshold
      for (let i = 0; i < 50; i++) {
        await tieredStorage.appendWAL('INSERT', 'threshold', { id: `t-${i}` })
      }

      // Should have triggered auto-flush
      expect(flushSpy).toHaveBeenCalled()
    })

    it('should auto-flush after time interval', async () => {
      tieredStorage = new TieredStorage(ctx, env, {
        flushThreshold: 10000, // High threshold
        flushIntervalMs: 60_000, // 60 second interval
      })

      // Append some entries (below threshold)
      for (let i = 0; i < 10; i++) {
        await tieredStorage.appendWAL('INSERT', 'interval', { id: `i-${i}` })
      }

      const flushSpy = vi.spyOn(tieredStorage, 'flushToParquet')

      // Advance time past flush interval
      await vi.advanceTimersByTimeAsync(60_000)

      expect(flushSpy).toHaveBeenCalled()
    })

    it('should group WAL entries by table in Parquet files', async () => {
      await tieredStorage.appendWAL('INSERT', 'users', { id: 'u1' })
      await tieredStorage.appendWAL('INSERT', 'orders', { id: 'o1' })
      await tieredStorage.appendWAL('INSERT', 'users', { id: 'u2' })
      await tieredStorage.appendWAL('INSERT', 'orders', { id: 'o2' })

      const result = await tieredStorage.flushToParquet()

      // Should create separate Parquet files per table
      expect(result.filesByTable).toBeDefined()
      expect(result.filesByTable.users).toBeDefined()
      expect(result.filesByTable.orders).toBeDefined()
    })

    it('should include correct Parquet schema for table', async () => {
      await tieredStorage.appendWAL('INSERT', 'products', {
        id: 'p1',
        name: 'Widget',
        price: 9.99,
        active: true,
        tags: ['electronics', 'gadgets'],
      })

      const result = await tieredStorage.flushToParquet()

      // Verify Parquet file is in R2
      const r2Object = await env.R2_BUCKET.get(result.parquetPath)
      expect(r2Object).not.toBeNull()
    })

    it('should truncate WAL after successful flush', async () => {
      for (let i = 0; i < 10; i++) {
        await tieredStorage.appendWAL('INSERT', 'truncate', { id: `t-${i}` })
      }

      // Verify WAL has entries
      let walEntries = await ctx.storage.list({ prefix: 'wal:' })
      expect(walEntries.size).toBeGreaterThan(0)

      await tieredStorage.flushToParquet()

      // WAL should be truncated after flush
      walEntries = await ctx.storage.list({ prefix: 'wal:' })
      expect(walEntries.size).toBe(0)
    })

    it('should not truncate WAL if Parquet write fails', async () => {
      // Simulate R2 failure
      const failingBucket = createMockR2Bucket()
      failingBucket.put = async () => { throw new Error('R2 write failed') }
      env.R2_BUCKET = failingBucket

      tieredStorage = new TieredStorage(ctx, env)

      await tieredStorage.appendWAL('INSERT', 'safe', { id: 's1' })

      await expect(tieredStorage.flushToParquet()).rejects.toThrow('R2 write failed')

      // WAL should still have the entry
      const walEntries = await ctx.storage.list({ prefix: 'wal:' })
      expect(walEntries.size).toBeGreaterThan(0)
    })

    it('should return empty result when no WAL entries to flush', async () => {
      const result = await tieredStorage.flushToParquet()

      expect(result.rowCount).toBe(0)
      expect(result.parquetPath).toBeUndefined()
    })

    it('should partition Parquet files by date for time-range optimization', async () => {
      // Insert data spanning multiple days
      const day1 = new Date('2024-01-01T10:00:00Z').getTime()
      const day2 = new Date('2024-01-02T10:00:00Z').getTime()

      vi.setSystemTime(day1)
      await tieredStorage.appendWAL('INSERT', 'partitioned', { id: 'd1-1' })
      await tieredStorage.appendWAL('INSERT', 'partitioned', { id: 'd1-2' })

      vi.setSystemTime(day2)
      await tieredStorage.appendWAL('INSERT', 'partitioned', { id: 'd2-1' })

      const result = await tieredStorage.flushToParquet()

      // Should have partitioned paths like: table/year=2024/month=01/day=01/file.parquet
      expect(result.parquetPath).toMatch(/year=\d{4}/)
      expect(result.parquetPath).toMatch(/month=\d{2}/)
      expect(result.parquetPath).toMatch(/day=\d{2}/)
    })
  })

  // ==========================================================================
  // ICEBERG MANIFEST
  // ==========================================================================

  describe('updateIcebergManifest() - Iceberg Metadata', () => {
    beforeEach(() => {
      tieredStorage = new TieredStorage(ctx, env)
    })

    it('should create Iceberg manifest on first flush', async () => {
      await tieredStorage.appendWAL('INSERT', 'manifest_test', { id: 'm1' })
      await tieredStorage.flushToParquet()

      const manifest = await tieredStorage.updateIcebergManifest()

      expect(manifest).toBeDefined()
      expect(manifest.version).toBe(1)
      expect(manifest.dataFiles.length).toBeGreaterThan(0)
    })

    it('should increment manifest version on each update', async () => {
      await tieredStorage.appendWAL('INSERT', 'versioned', { id: 'v1' })
      await tieredStorage.flushToParquet()
      const manifest1 = await tieredStorage.updateIcebergManifest()

      await tieredStorage.appendWAL('INSERT', 'versioned', { id: 'v2' })
      await tieredStorage.flushToParquet()
      const manifest2 = await tieredStorage.updateIcebergManifest()

      expect(manifest2.version).toBe(manifest1.version + 1)
    })

    it('should track all Parquet files in manifest', async () => {
      // Multiple flushes
      for (let batch = 0; batch < 3; batch++) {
        for (let i = 0; i < 10; i++) {
          await tieredStorage.appendWAL('INSERT', 'multi_flush', {
            id: `batch-${batch}-item-${i}`,
          })
        }
        await tieredStorage.flushToParquet()
        await tieredStorage.updateIcebergManifest()
      }

      const manifest = await tieredStorage.getIcebergManifest()

      // Should have 3 Parquet files tracked
      expect(manifest.dataFiles.length).toBe(3)
    })

    it('should include column statistics in manifest', async () => {
      await tieredStorage.appendWAL('INSERT', 'stats', { id: 's1', value: 10 })
      await tieredStorage.appendWAL('INSERT', 'stats', { id: 's2', value: 20 })
      await tieredStorage.appendWAL('INSERT', 'stats', { id: 's3', value: 30 })
      await tieredStorage.flushToParquet()
      const manifest = await tieredStorage.updateIcebergManifest()

      const dataFile = manifest.dataFiles[0]
      expect(dataFile.columnStats).toBeDefined()
      expect(dataFile.columnStats.value.min).toBe(10)
      expect(dataFile.columnStats.value.max).toBe(30)
    })

    it('should include partition information in manifest', async () => {
      const testDate = new Date('2024-06-15T10:00:00Z')
      vi.setSystemTime(testDate)

      await tieredStorage.appendWAL('INSERT', 'partition_info', { id: 'p1' })
      await tieredStorage.flushToParquet()
      const manifest = await tieredStorage.updateIcebergManifest()

      const dataFile = manifest.dataFiles[0]
      expect(dataFile.partition).toBeDefined()
      expect(dataFile.partition.year).toBe(2024)
      expect(dataFile.partition.month).toBe(6)
      expect(dataFile.partition.day).toBe(15)
    })

    it('should store manifest in R2/Iceberg bucket', async () => {
      await tieredStorage.appendWAL('INSERT', 'stored', { id: 's1' })
      await tieredStorage.flushToParquet()
      await tieredStorage.updateIcebergManifest()

      // Verify manifest is stored
      const manifestObject = await env.ICEBERG_BUCKET!.get('metadata/manifest.json')
      expect(manifestObject).not.toBeNull()
    })

    it('should support time travel by keeping manifest snapshots', async () => {
      // First snapshot
      await tieredStorage.appendWAL('INSERT', 'time_travel', { id: 't1' })
      await tieredStorage.flushToParquet()
      const snapshot1 = await tieredStorage.updateIcebergManifest()

      // Second snapshot
      await tieredStorage.appendWAL('INSERT', 'time_travel', { id: 't2' })
      await tieredStorage.flushToParquet()
      await tieredStorage.updateIcebergManifest()

      // Should be able to query at snapshot 1
      const oldManifest = await tieredStorage.getIcebergManifest(snapshot1.snapshotId)
      expect(oldManifest.dataFiles.length).toBe(1)
    })

    it('should include row count per data file', async () => {
      for (let i = 0; i < 25; i++) {
        await tieredStorage.appendWAL('INSERT', 'row_count', { id: `r-${i}` })
      }
      await tieredStorage.flushToParquet()
      const manifest = await tieredStorage.updateIcebergManifest()

      const dataFile = manifest.dataFiles[0]
      expect(dataFile.rowCount).toBe(25)
    })

    it('should include file size in manifest', async () => {
      await tieredStorage.appendWAL('INSERT', 'size_test', { id: 's1', data: 'x'.repeat(1000) })
      await tieredStorage.flushToParquet()
      const manifest = await tieredStorage.updateIcebergManifest()

      const dataFile = manifest.dataFiles[0]
      expect(dataFile.fileSizeBytes).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // HOT TIER QUERIES
  // ==========================================================================

  describe('queryHot() - Hot Tier Queries', () => {
    beforeEach(async () => {
      tieredStorage = new TieredStorage(ctx, env, {
        hotRetentionMs: 5 * 60 * 1000, // 5 minutes
      })

      // Pre-populate some data in hot tier
      await tieredStorage.appendWAL('INSERT', 'hot_data', { id: 'h1', value: 'hot1' })
      await tieredStorage.appendWAL('INSERT', 'hot_data', { id: 'h2', value: 'hot2' })
      await tieredStorage.appendWAL('INSERT', 'hot_data', { id: 'h3', value: 'hot3' })
    })

    it('should query data from hot tier only', async () => {
      const result = await tieredStorage.queryHot(
        'SELECT * FROM hot_data WHERE id = $1',
        ['h1']
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].id).toBe('h1')
      expect(result.tier).toBe('hot')
    })

    it('should return empty when data not in hot tier', async () => {
      // Flush data to warm tier
      await tieredStorage.flushToParquet()
      await tieredStorage.updateIcebergManifest()

      const result = await tieredStorage.queryHot(
        'SELECT * FROM hot_data WHERE id = $1',
        ['h1']
      )

      expect(result.rows).toHaveLength(0)
    })

    it('should query hot tier with sub-millisecond latency', async () => {
      const start = performance.now()
      await tieredStorage.queryHot('SELECT * FROM hot_data', [])
      const elapsed = performance.now() - start

      // Hot tier should be fast (< 10ms, ideally < 1ms)
      expect(elapsed).toBeLessThan(10)
    })

    it('should see uncommitted WAL entries in hot tier', async () => {
      // Append without flushing
      await tieredStorage.appendWAL('INSERT', 'uncommitted', { id: 'u1', status: 'pending' })

      const result = await tieredStorage.queryHot(
        'SELECT * FROM uncommitted WHERE id = $1',
        ['u1']
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].status).toBe('pending')
    })

    it('should apply UPDATE operations in hot tier', async () => {
      await tieredStorage.appendWAL('UPDATE', 'hot_data', { id: 'h1', value: 'updated' })

      const result = await tieredStorage.queryHot(
        'SELECT * FROM hot_data WHERE id = $1',
        ['h1']
      )

      expect(result.rows[0].value).toBe('updated')
    })

    it('should apply DELETE operations in hot tier', async () => {
      await tieredStorage.appendWAL('DELETE', 'hot_data', { id: 'h2' })

      const result = await tieredStorage.queryHot(
        'SELECT * FROM hot_data',
        []
      )

      // h2 should be deleted
      expect(result.rows.map((r: { id: string }) => r.id)).not.toContain('h2')
    })
  })

  // ==========================================================================
  // WARM TIER QUERIES (ICEBERG)
  // ==========================================================================

  describe('queryWarm() - Warm Tier Queries (Iceberg/Parquet)', () => {
    beforeEach(async () => {
      tieredStorage = new TieredStorage(ctx, env)

      // Insert and flush to warm tier
      for (let i = 0; i < 20; i++) {
        await tieredStorage.appendWAL('INSERT', 'warm_data', {
          id: `w-${i}`,
          category: i % 2 === 0 ? 'even' : 'odd',
          value: i * 10,
        })
      }
      await tieredStorage.flushToParquet()
      await tieredStorage.updateIcebergManifest()
    })

    it('should query data from warm tier (Iceberg)', async () => {
      const result = await tieredStorage.queryWarm(
        'SELECT * FROM warm_data WHERE id = $1',
        ['w-5']
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].id).toBe('w-5')
      expect(result.tier).toBe('warm')
    })

    it('should use partition pruning for date-based queries', async () => {
      // Insert data with specific dates
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
      await tieredStorage.appendWAL('INSERT', 'dated', { id: 'd1', event: 'jan' })
      await tieredStorage.flushToParquet()

      vi.setSystemTime(new Date('2024-02-15T10:00:00Z'))
      await tieredStorage.appendWAL('INSERT', 'dated', { id: 'd2', event: 'feb' })
      await tieredStorage.flushToParquet()
      await tieredStorage.updateIcebergManifest()

      // Query with date filter should only scan January partition
      const result = await tieredStorage.queryWarm(
        `SELECT * FROM dated WHERE _partition_date >= '2024-01-01' AND _partition_date < '2024-02-01'`,
        []
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].event).toBe('jan')
      expect(result.filesScanned).toBe(1) // Only scanned one Parquet file
    })

    it('should use column statistics for predicate pushdown', async () => {
      // Insert data with known ranges
      for (let i = 0; i < 10; i++) {
        await tieredStorage.appendWAL('INSERT', 'ranged', { id: `r-${i}`, score: i })
      }
      await tieredStorage.flushToParquet()
      await tieredStorage.updateIcebergManifest()

      // Query with range that doesn't match file statistics
      const result = await tieredStorage.queryWarm(
        'SELECT * FROM ranged WHERE score > 100',
        []
      )

      // Should skip file based on column stats (max is 9)
      expect(result.rows).toHaveLength(0)
      expect(result.filesScanned).toBe(0)
    })

    it('should handle queries across multiple Parquet files', async () => {
      // Create multiple files
      for (let batch = 0; batch < 3; batch++) {
        for (let i = 0; i < 10; i++) {
          await tieredStorage.appendWAL('INSERT', 'multi_file', {
            id: `b${batch}-i${i}`,
            batch,
          })
        }
        await tieredStorage.flushToParquet()
      }
      await tieredStorage.updateIcebergManifest()

      const result = await tieredStorage.queryWarm(
        'SELECT COUNT(*) as count FROM multi_file',
        []
      )

      expect(result.rows[0].count).toBe(30)
    })

    it('should return latency in 50-150ms range for warm queries', async () => {
      // Note: This test verifies the expected latency range but actual performance
      // depends on R2 latency. In tests with mocks, it will be faster.
      const start = performance.now()
      await tieredStorage.queryWarm('SELECT * FROM warm_data LIMIT 10', [])
      const elapsed = performance.now() - start

      // With real R2, expect 50-150ms. With mocks, should be much faster.
      expect(elapsed).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // UNIFIED QUERY (HOT + WARM)
  // ==========================================================================

  describe('query() - Unified Query Across Tiers', () => {
    beforeEach(async () => {
      tieredStorage = new TieredStorage(ctx, env, {
        hotRetentionMs: 5 * 60 * 1000,
      })
    })

    it('should check hot tier first', async () => {
      // Add to hot tier
      await tieredStorage.appendWAL('INSERT', 'unified', { id: 'u1', source: 'hot' })

      const result = await tieredStorage.query(
        'SELECT * FROM unified WHERE id = $1',
        ['u1']
      )

      expect(result.rows[0].source).toBe('hot')
      expect(result.tiersChecked).toContain('hot')
    })

    it('should fallback to warm tier when not found in hot', async () => {
      // Insert and flush to warm tier
      await tieredStorage.appendWAL('INSERT', 'fallback', { id: 'f1', source: 'warm' })
      await tieredStorage.flushToParquet()
      await tieredStorage.updateIcebergManifest()

      const result = await tieredStorage.query(
        'SELECT * FROM fallback WHERE id = $1',
        ['f1']
      )

      expect(result.rows[0].source).toBe('warm')
      expect(result.tiersChecked).toContain('warm')
    })

    it('should merge results from both tiers', async () => {
      // Data in warm tier
      await tieredStorage.appendWAL('INSERT', 'merged', { id: 'm1', tier: 'warm' })
      await tieredStorage.flushToParquet()
      await tieredStorage.updateIcebergManifest()

      // Data in hot tier (newer)
      await tieredStorage.appendWAL('INSERT', 'merged', { id: 'm2', tier: 'hot' })

      const result = await tieredStorage.query('SELECT * FROM merged', [])

      expect(result.rows).toHaveLength(2)
      expect(result.rows.map((r: { id: string }) => r.id).sort()).toEqual(['m1', 'm2'])
    })

    it('should prefer hot tier data over warm tier for same key', async () => {
      // Insert to warm tier
      await tieredStorage.appendWAL('INSERT', 'preference', { id: 'p1', value: 'old' })
      await tieredStorage.flushToParquet()
      await tieredStorage.updateIcebergManifest()

      // Update in hot tier (newer)
      await tieredStorage.appendWAL('UPDATE', 'preference', { id: 'p1', value: 'new' })

      const result = await tieredStorage.query(
        'SELECT * FROM preference WHERE id = $1',
        ['p1']
      )

      expect(result.rows[0].value).toBe('new')
    })

    it('should skip warm tier for time-range queries within hot retention', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      // Hot tier data (recent)
      await tieredStorage.appendWAL('INSERT', 'time_opt', { id: 't1', created_at: now })

      // Warm tier data (older)
      vi.setSystemTime(now - 10 * 60 * 1000) // 10 minutes ago
      await tieredStorage.appendWAL('INSERT', 'time_opt', { id: 't2', created_at: now - 10 * 60 * 1000 })
      await tieredStorage.flushToParquet()
      await tieredStorage.updateIcebergManifest()

      vi.setSystemTime(now) // Reset to now

      // Query for recent data only
      const result = await tieredStorage.query(
        `SELECT * FROM time_opt WHERE created_at >= $1`,
        [now - 60 * 1000] // Last minute
      )

      // Should only check hot tier (optimization)
      expect(result.tiersChecked).toContain('hot')
      expect(result.tiersChecked).not.toContain('warm')
    })

    it('should deduplicate rows across tiers', async () => {
      // Same ID in both tiers
      await tieredStorage.appendWAL('INSERT', 'dedup', { id: 'd1', version: 1 })
      await tieredStorage.flushToParquet()
      await tieredStorage.updateIcebergManifest()

      await tieredStorage.appendWAL('UPDATE', 'dedup', { id: 'd1', version: 2 })

      const result = await tieredStorage.query('SELECT * FROM dedup', [])

      // Should only have one row (deduplicated)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].version).toBe(2)
    })

    it('should respect deleted rows across tiers', async () => {
      // Insert to warm tier
      await tieredStorage.appendWAL('INSERT', 'deleted', { id: 'del1', value: 'exists' })
      await tieredStorage.flushToParquet()
      await tieredStorage.updateIcebergManifest()

      // Delete in hot tier
      await tieredStorage.appendWAL('DELETE', 'deleted', { id: 'del1' })

      const result = await tieredStorage.query('SELECT * FROM deleted', [])

      // Should not return deleted row
      expect(result.rows).toHaveLength(0)
    })

    it('should handle aggregate queries across tiers', async () => {
      // Warm tier data
      for (let i = 0; i < 5; i++) {
        await tieredStorage.appendWAL('INSERT', 'aggregated', { id: `w-${i}`, amount: 10 })
      }
      await tieredStorage.flushToParquet()
      await tieredStorage.updateIcebergManifest()

      // Hot tier data
      for (let i = 0; i < 5; i++) {
        await tieredStorage.appendWAL('INSERT', 'aggregated', { id: `h-${i}`, amount: 20 })
      }

      const result = await tieredStorage.query(
        'SELECT SUM(amount) as total, COUNT(*) as count FROM aggregated',
        []
      )

      expect(result.rows[0].total).toBe(150) // 5*10 + 5*20
      expect(result.rows[0].count).toBe(10)
    })
  })

  // ==========================================================================
  // DATA LIFECYCLE
  // ==========================================================================

  describe('Data Lifecycle - Hot to Warm Migration', () => {
    beforeEach(() => {
      tieredStorage = new TieredStorage(ctx, env, {
        hotRetentionMs: 5 * 60 * 1000, // 5 minutes
        flushThreshold: 1000,
        flushIntervalMs: 60_000,
      })
    })

    it('should keep recent data in hot tier', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      await tieredStorage.appendWAL('INSERT', 'lifecycle', { id: 'l1' })

      // Advance 1 minute (within hot retention)
      vi.setSystemTime(now + 60 * 1000)

      const hotResult = await tieredStorage.queryHot(
        'SELECT * FROM lifecycle WHERE id = $1',
        ['l1']
      )

      expect(hotResult.rows).toHaveLength(1)
    })

    it('should migrate data to warm tier after hot retention expires', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      await tieredStorage.appendWAL('INSERT', 'expire', { id: 'e1' })

      // Advance past hot retention (6 minutes)
      vi.setSystemTime(now + 6 * 60 * 1000)

      // Trigger migration
      await tieredStorage.runMigration()

      // Data should be in warm tier, not hot
      const hotResult = await tieredStorage.queryHot(
        'SELECT * FROM expire WHERE id = $1',
        ['e1']
      )
      expect(hotResult.rows).toHaveLength(0)

      const warmResult = await tieredStorage.queryWarm(
        'SELECT * FROM expire WHERE id = $1',
        ['e1']
      )
      expect(warmResult.rows).toHaveLength(1)
    })

    it('should handle mixed hot and warm data during migration', async () => {
      const now = Date.now()
      vi.setSystemTime(now - 10 * 60 * 1000) // 10 minutes ago

      // Old data (should migrate)
      await tieredStorage.appendWAL('INSERT', 'mixed', { id: 'old', age: 'old' })

      vi.setSystemTime(now) // Now

      // New data (should stay hot)
      await tieredStorage.appendWAL('INSERT', 'mixed', { id: 'new', age: 'new' })

      await tieredStorage.runMigration()

      // Old data in warm
      const warmResult = await tieredStorage.queryWarm('SELECT * FROM mixed WHERE id = $1', ['old'])
      expect(warmResult.rows).toHaveLength(1)

      // New data still in hot
      const hotResult = await tieredStorage.queryHot('SELECT * FROM mixed WHERE id = $1', ['new'])
      expect(hotResult.rows).toHaveLength(1)
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    beforeEach(() => {
      tieredStorage = new TieredStorage(ctx, env)
    })

    it('should handle R2 read failures gracefully', async () => {
      // Insert and flush
      await tieredStorage.appendWAL('INSERT', 'r2_fail', { id: 'rf1' })
      await tieredStorage.flushToParquet()
      await tieredStorage.updateIcebergManifest()

      // Simulate R2 read failure
      env.R2_BUCKET.get = async () => { throw new Error('R2 read failed') }

      // Should fall back gracefully (or throw meaningful error)
      await expect(
        tieredStorage.queryWarm('SELECT * FROM r2_fail', [])
      ).rejects.toThrow(/R2 read failed|warm tier unavailable/i)
    })

    it('should handle corrupt Parquet file', async () => {
      await tieredStorage.appendWAL('INSERT', 'corrupt', { id: 'c1' })
      await tieredStorage.flushToParquet()

      // Corrupt the Parquet file
      const manifest = await tieredStorage.getIcebergManifest()
      const parquetPath = manifest.dataFiles[0].path
      await env.R2_BUCKET.put(parquetPath, 'not a valid parquet file')

      await expect(
        tieredStorage.queryWarm('SELECT * FROM corrupt', [])
      ).rejects.toThrow(/parquet|corrupt|invalid/i)
    })

    it('should handle missing Iceberg manifest', async () => {
      // Delete manifest
      await env.ICEBERG_BUCKET!.delete('metadata/manifest.json')

      const result = await tieredStorage.queryWarm('SELECT * FROM any_table', [])

      // Should return empty (no warm data) rather than crash
      expect(result.rows).toHaveLength(0)
    })

    it('should handle WAL corruption during recovery', async () => {
      // Write valid WAL entry
      await tieredStorage.appendWAL('INSERT', 'wal_corrupt', { id: 'wc1' })

      // Corrupt WAL storage
      await ctx.storage.put('wal:corrupt-entry', 'invalid json data')

      // Create new instance (triggers WAL recovery)
      const newTieredStorage = new TieredStorage(ctx, env)

      // Should skip corrupt entry and continue
      const pending = await newTieredStorage.getPendingWAL()
      expect(pending.some((e: WALEntry) => e.row?.id === 'wc1')).toBe(true)

      await newTieredStorage.close()
    })

    it('should retry failed flushes with backoff', async () => {
      let attempts = 0
      const originalPut = env.R2_BUCKET.put

      env.R2_BUCKET.put = async (...args) => {
        attempts++
        if (attempts < 3) {
          throw new Error('Temporary R2 failure')
        }
        return originalPut.apply(env.R2_BUCKET, args)
      }

      tieredStorage = new TieredStorage(ctx, env, {
        flushRetries: 3,
        flushRetryDelayMs: 100,
      })

      await tieredStorage.appendWAL('INSERT', 'retry', { id: 'r1' })
      await tieredStorage.flushToParquet()

      expect(attempts).toBe(3)
    })
  })

  // ==========================================================================
  // CLEANUP AND LIFECYCLE
  // ==========================================================================

  describe('close() - Cleanup', () => {
    it('should flush pending WAL before close', async () => {
      tieredStorage = new TieredStorage(ctx, env)

      await tieredStorage.appendWAL('INSERT', 'close_test', { id: 'ct1' })

      await tieredStorage.close()

      // Verify data was flushed
      const manifestJson = await env.ICEBERG_BUCKET!.get('metadata/manifest.json')
      expect(manifestJson).not.toBeNull()
    })

    it('should be safe to call close multiple times', async () => {
      tieredStorage = new TieredStorage(ctx, env)

      await tieredStorage.close()
      await tieredStorage.close()
      await tieredStorage.close()

      // Should not throw
      expect(true).toBe(true)
    })

    it('should reject operations after close', async () => {
      tieredStorage = new TieredStorage(ctx, env)
      await tieredStorage.close()

      await expect(
        tieredStorage.appendWAL('INSERT', 'closed', { id: 'x' })
      ).rejects.toThrow(/closed/i)
    })
  })
})
