/**
 * Tiered Storage Tests - RED Phase
 *
 * Tests for DO SQLite hot tier + R2 Iceberg cold tier storage layer.
 *
 * Run: npx vitest run db/compat/sql/clickhouse/storage/tiered-storage.test.ts
 *
 * @see dotdo-55o4f [RED] Storage Layer - Test DO SQLite hot tier + R2 Iceberg cold tier
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { TieredStorage, HotTier, ColdTier, FlushManager } from './tiered-storage'
import type {
  DurableObjectStateLike,
  SqlStorageLike,
  SqlStorageCursorLike,
  R2BucketLike,
  ThingRow,
  TieredStorageConfig,
} from './types'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock SQL storage that mimics DO SQLite
 */
function createMockSqlStorage(): SqlStorageLike {
  const tables: Map<string, any[]> = new Map()
  let rowsWritten = 0

  return {
    exec(query: string, ...params: unknown[]): SqlStorageCursorLike {
      const normalizedQuery = query.trim().toUpperCase()

      // Handle CREATE TABLE
      if (normalizedQuery.startsWith('CREATE TABLE')) {
        const tableMatch = query.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)
        if (tableMatch && !tables.has(tableMatch[1])) {
          tables.set(tableMatch[1], [])
        }
        return createCursor([], 0)
      }

      // Handle CREATE INDEX
      if (normalizedQuery.startsWith('CREATE INDEX')) {
        return createCursor([], 0)
      }

      // Handle INSERT OR REPLACE
      if (normalizedQuery.startsWith('INSERT')) {
        const things = tables.get('things') ?? []
        const [id, type, data, embedding, created_at, updated_at] = params as [
          string,
          string,
          string,
          ArrayBuffer | null,
          number,
          number
        ]

        // Remove existing row with same ID (upsert)
        const existingIdx = things.findIndex((r) => r.id === id)
        const isReplace = existingIdx >= 0
        if (isReplace) {
          things.splice(existingIdx, 1)
        }

        things.push({ id, type, data, embedding, created_at, updated_at })
        tables.set('things', things)
        // Only count as written if actually new (not replace)
        rowsWritten = isReplace ? 0 : 1
        return createCursor([], rowsWritten)
      }

      // Handle SELECT COUNT(*)
      if (normalizedQuery.includes('COUNT(*)')) {
        const things = tables.get('things') ?? []
        return createCursor([{ count: things.length }], 0)
      }

      // Handle SELECT *
      if (normalizedQuery.startsWith('SELECT')) {
        const things = tables.get('things') ?? []

        // Handle WHERE clause
        const whereMatch = query.match(/WHERE\s+id\s*=\s*\?/i)
        if (whereMatch && params[0]) {
          const filtered = things.filter((r) => r.id === params[0])
          return createCursor(filtered, 0)
        }

        // Handle created_at > ?
        const afterMatch = query.match(/WHERE\s+created_at\s*>\s*\?/i)
        if (afterMatch && params[0] !== undefined) {
          const filtered = things.filter((r) => r.created_at > (params[0] as number))
          return createCursor(filtered, 0)
        }

        return createCursor(things, 0)
      }

      // Handle DELETE
      if (normalizedQuery.startsWith('DELETE')) {
        const things = tables.get('things') ?? []
        const idsToDelete = params as string[]

        const before = things.length
        const remaining = things.filter((r) => !idsToDelete.includes(r.id))
        tables.set('things', remaining)
        rowsWritten = before - remaining.length
        return createCursor([], rowsWritten)
      }

      return createCursor([], 0)
    },
  }

  function createCursor(rows: unknown[], written: number): SqlStorageCursorLike {
    return {
      toArray: () => rows,
      one: () => rows[0] ?? null,
      raw: () => rows.map((r) => Object.values(r as object)),
      columnNames: rows.length > 0 ? Object.keys(rows[0] as object) : [],
      rowsRead: rows.length,
      rowsWritten: written,
    }
  }
}

/**
 * Create a mock Durable Object state
 */
function createMockDoState(
  sql?: SqlStorageLike,
  namespace = 'test'
): DurableObjectStateLike {
  const storage = new Map<string, unknown>()
  const sqlStorage = sql ?? createMockSqlStorage()

  return {
    storage: {
      sql: sqlStorage,
      async get<T>(key: string): Promise<T | undefined> {
        return storage.get(key) as T | undefined
      },
      async put<T>(key: string, value: T): Promise<void> {
        storage.set(key, value)
      },
      async delete(key: string): Promise<boolean> {
        return storage.delete(key)
      },
      async list(options?: { prefix?: string }): Promise<Map<string, unknown>> {
        const result = new Map<string, unknown>()
        for (const [k, v] of storage) {
          if (!options?.prefix || k.startsWith(options.prefix)) {
            result.set(k, v)
          }
        }
        return result
      },
    },
    id: { toString: () => namespace },
  }
}

/**
 * Create a mock R2 bucket
 */
function createMockR2Bucket(): R2BucketLike {
  const storage = new Map<string, ArrayBuffer | string>()

  return {
    async put(key: string, body: ArrayBuffer | string): Promise<unknown> {
      storage.set(key, body)
      return {}
    },
    async get(key: string) {
      const value = storage.get(key)
      if (!value) return null

      return {
        key,
        async json() {
          if (typeof value === 'string') {
            return JSON.parse(value)
          }
          const text = new TextDecoder().decode(value)
          return JSON.parse(text)
        },
        async text() {
          if (typeof value === 'string') return value
          return new TextDecoder().decode(value)
        },
        async arrayBuffer() {
          if (typeof value === 'string') {
            return new TextEncoder().encode(value).buffer
          }
          return value
        },
      }
    },
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? ''
      const objects = [...storage.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key }))

      return { objects, truncated: false }
    },
    async delete(key: string) {
      storage.delete(key)
    },
  }
}

/**
 * Generate test thing rows
 */
function generateThings(count: number, typePrefix = 'event'): ThingRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${typePrefix}-${i}`,
    type: typePrefix,
    data: JSON.stringify({ index: i, action: 'click' }),
    embedding: null,
    created_at: Date.now() + i,
    updated_at: Date.now() + i,
  }))
}

// ============================================================================
// HOT TIER TESTS
// ============================================================================

describe('HotTier', () => {
  let hotTier: HotTier
  let sqlStorage: SqlStorageLike

  beforeEach(() => {
    sqlStorage = createMockSqlStorage()
    hotTier = new HotTier(sqlStorage)
  })

  describe('initialization', () => {
    it('creates schema on first access', async () => {
      await hotTier.initialize()
      expect(hotTier.rowCount).toBe(0)
    })

    it('counts existing rows after initialization', async () => {
      // Pre-populate some data
      await hotTier.insert({
        id: 'test-1',
        type: 'event',
        data: '{}',
        embedding: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      // Re-create hot tier and verify count
      const newHotTier = new HotTier(sqlStorage)
      await newHotTier.initialize()

      expect(newHotTier.rowCount).toBe(1)
    })
  })

  describe('insert operations', () => {
    it('inserts a single row', async () => {
      const row: ThingRow = {
        id: 'event-1',
        type: 'event',
        data: JSON.stringify({ action: 'click' }),
        embedding: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      }

      await hotTier.insert(row)

      expect(hotTier.rowCount).toBe(1)
    })

    it('inserts multiple rows in batch', async () => {
      const rows = generateThings(100)

      await hotTier.insertBatch(rows)

      expect(hotTier.rowCount).toBe(100)
    })

    it('replaces row with same ID (upsert)', async () => {
      const row1: ThingRow = {
        id: 'event-1',
        type: 'event',
        data: JSON.stringify({ version: 1 }),
        embedding: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      }

      const row2: ThingRow = {
        ...row1,
        data: JSON.stringify({ version: 2 }),
        updated_at: Date.now() + 1000,
      }

      await hotTier.insert(row1)
      await hotTier.insert(row2)

      // Query to verify single row exists
      const result = await hotTier.query('SELECT * FROM things')
      expect(result.rows.length).toBe(1)

      const gotRow = await hotTier.get('event-1')
      expect(gotRow).not.toBeNull()
      expect(JSON.parse(gotRow!.data as string).version).toBe(2)
    })
  })

  describe('query operations', () => {
    it('queries all rows', async () => {
      await hotTier.insertBatch(generateThings(10))

      const result = await hotTier.query('SELECT * FROM things')

      expect(result.rows.length).toBe(10)
      expect(result.source).toBe('hot')
    })

    it('queries with LIMIT', async () => {
      await hotTier.insertBatch(generateThings(100))

      const result = await hotTier.query('SELECT * FROM things', { limit: 10 })

      // Note: Mock doesn't apply LIMIT - this test verifies the interface
      // In real DO SQLite, LIMIT would be applied
      expect(result.rows.length).toBeGreaterThan(0)
    })

    it('queries with OFFSET', async () => {
      await hotTier.insertBatch(generateThings(100))

      const result = await hotTier.query('SELECT * FROM things', {
        limit: 10,
        offset: 50,
      })

      // Note: Mock doesn't apply OFFSET - this test verifies the interface
      // In real DO SQLite, OFFSET would be applied
      expect(result.rows.length).toBeGreaterThan(0)
    })

    it('parses JSON data fields automatically', async () => {
      await hotTier.insert({
        id: 'test-1',
        type: 'event',
        data: JSON.stringify({ foo: 'bar', nested: { x: 1 } }),
        embedding: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      const result = await hotTier.query('SELECT * FROM things WHERE id = ?')
      const row = result.rows[0]

      expect(typeof row.data).toBe('object')
      expect((row.data as any).foo).toBe('bar')
      expect((row.data as any).nested.x).toBe(1)
    })
  })

  describe('delete operations', () => {
    it('deletes rows by ID', async () => {
      await hotTier.insertBatch(generateThings(10))

      const deleted = await hotTier.deleteRows(['event-0', 'event-1', 'event-2'])

      expect(deleted).toBe(3)
      expect(hotTier.rowCount).toBe(7)
    })

    it('deletes single row by ID', async () => {
      await hotTier.insert({
        id: 'test-1',
        type: 'event',
        data: '{}',
        embedding: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      const result = await hotTier.delete('test-1')

      expect(result).toBe(true)
      expect(hotTier.rowCount).toBe(0)
    })

    it('clears all data', async () => {
      await hotTier.insertBatch(generateThings(100))

      await hotTier.clear()

      expect(hotTier.rowCount).toBe(0)
    })
  })
})

// ============================================================================
// COLD TIER TESTS
// ============================================================================

describe('ColdTier', () => {
  let coldTier: ColdTier
  let r2Bucket: R2BucketLike

  beforeEach(() => {
    r2Bucket = createMockR2Bucket()
    coldTier = new ColdTier(r2Bucket, 'test-namespace')
  })

  describe('initialization', () => {
    it('initializes with empty state', async () => {
      await coldTier.initialize()

      expect(coldTier.getSnapshotId()).toBeNull()
    })

    it('loads existing manifest on initialization', async () => {
      // Write some data first
      await coldTier.write(generateThings(10))

      // Create new cold tier instance and initialize
      const newColdTier = new ColdTier(r2Bucket, 'test-namespace')
      await newColdTier.initialize()

      expect(newColdTier.getSnapshotId()).not.toBeNull()
    })
  })

  describe('write operations', () => {
    it('writes rows as Iceberg data file', async () => {
      const rows = generateThings(10)

      const snapshotId = await coldTier.write(rows)

      expect(snapshotId).toBeDefined()
      expect(typeof snapshotId).toBe('string')
      expect(coldTier.getSnapshotId()).toBe(snapshotId)
    })

    it('creates time-based partition keys', async () => {
      const rows = generateThings(10)

      await coldTier.write(rows)

      const files = await coldTier.listDataFiles()
      expect(files.length).toBe(1)
      // Partition should be YYYY-MM format
      expect(files[0].partition).toMatch(/^\d{4}-\d{2}$/)
    })

    it('creates new snapshot for each write', async () => {
      const snapshot1 = await coldTier.write(generateThings(5, 'batch1'))
      const snapshot2 = await coldTier.write(generateThings(5, 'batch2'))

      expect(snapshot1).not.toBe(snapshot2)

      const files = await coldTier.listDataFiles()
      expect(files.length).toBe(2)
    })
  })

  describe('query operations', () => {
    it('queries all rows from cold tier', async () => {
      await coldTier.write(generateThings(10))

      const result = await coldTier.query('SELECT * FROM things')

      expect(result.rows.length).toBe(10)
      expect(result.source).toBe('cold')
    })

    it('queries with WHERE clause', async () => {
      await coldTier.write([
        ...generateThings(5, 'user'),
        ...generateThings(5, 'event'),
      ])

      const result = await coldTier.query("SELECT * FROM things WHERE type = 'user'")

      expect(result.rows.length).toBe(5)
      expect(result.rows.every((r) => r.type === 'user')).toBe(true)
    })

    it('supports time travel queries', async () => {
      // Write first batch
      const snapshot1 = await coldTier.write(generateThings(5, 'batch1'))

      // Write second batch
      await coldTier.write(generateThings(5, 'batch2'))

      // Query at first snapshot - should only see first batch
      const result = await coldTier.query('SELECT * FROM things', {
        snapshotId: snapshot1,
      })

      expect(result.rows.length).toBe(5)
      expect(result.rows.every((r) => r.type === 'batch1')).toBe(true)
    })

    it('returns empty result for non-existent snapshot', async () => {
      const result = await coldTier.query('SELECT * FROM things', {
        snapshotId: 'non-existent',
      })

      expect(result.rows.length).toBe(0)
    })
  })

  describe('row count', () => {
    it('returns zero for empty cold tier', async () => {
      const count = await coldTier.getRowCount()
      expect(count).toBe(0)
    })

    it('returns total row count across all data files', async () => {
      await coldTier.write(generateThings(10))
      await coldTier.write(generateThings(20))

      const count = await coldTier.getRowCount()
      expect(count).toBe(30)
    })
  })
})

// ============================================================================
// TIERED STORAGE INTEGRATION TESTS
// ============================================================================

describe('TieredStorage', () => {
  let storage: TieredStorage
  let doState: DurableObjectStateLike
  let r2Bucket: R2BucketLike

  beforeEach(() => {
    doState = createMockDoState()
    r2Bucket = createMockR2Bucket()
    storage = new TieredStorage(doState, { R2: r2Bucket })
  })

  describe('writes to DO SQLite hot tier', () => {
    it('writes to DO SQLite hot tier', async () => {
      await storage.insert('things', {
        id: 'event-1',
        type: 'event',
        data: { action: 'click' },
        embedding: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      const hot = await storage.queryHotTier('SELECT count(*) FROM things')
      expect(hot.rows[0].count).toBe(1)
    })

    it('inserts with object data (auto-serialized)', async () => {
      await storage.insert('things', {
        id: 'event-1',
        type: 'event',
        data: { x: 100, y: 200 },
        embedding: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      })

      const result = await storage.queryHotTier('SELECT * FROM things')
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].data).toEqual({ x: 100, y: 200 })
    })
  })

  describe('auto-flushes to R2 Iceberg cold tier', () => {
    it('auto-flushes when threshold exceeded', async () => {
      // Create storage with low threshold
      const lowThresholdStorage = new TieredStorage(doState, { R2: r2Bucket }, {
        flushThreshold: 10,
        autoFlush: true,
      })

      // Write more rows than threshold
      for (let i = 0; i < 15; i++) {
        await lowThresholdStorage.insert('things', {
          id: `event-${i}`,
          type: 'event',
          data: { i },
          embedding: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        })
      }

      // Check cold tier has data
      const cold = await lowThresholdStorage.queryColdTier('SELECT count(*) FROM things')
      expect(cold.rows.length).toBeGreaterThan(0)
    })

    it('tracks row count correctly after flush', async () => {
      const lowThresholdStorage = new TieredStorage(doState, { R2: r2Bucket }, {
        flushThreshold: 5,
        autoFlush: true,
      })

      // Write rows to trigger flush
      for (let i = 0; i < 10; i++) {
        await lowThresholdStorage.insert('things', {
          id: `event-${i}`,
          type: 'event',
          data: { i },
          embedding: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        })
      }

      const stats = await lowThresholdStorage.getStats()
      // Total should be correct (hot + cold)
      expect(stats.hotRowCount + stats.coldRowCount).toBe(10)
    })
  })

  describe('queries across both tiers seamlessly', () => {
    it('queries across both tiers', async () => {
      // Write to hot tier first, then flush to cold
      for (let i = 0; i < 10; i++) {
        await storage.insert(
          'things',
          {
            id: `cold-${i}`,
            type: 'cold',
            data: { i },
            embedding: null,
            created_at: Date.now(),
            updated_at: Date.now(),
          },
          { skipFlushCheck: true }
        )
      }
      await storage.flush()

      // Write more to hot tier
      for (let i = 0; i < 5; i++) {
        await storage.insert('things', {
          id: `hot-${i}`,
          type: 'hot',
          data: { i },
          embedding: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        })
      }

      // Query both tiers
      const result = await storage.query('SELECT * FROM things')
      expect(result.count).toBe(15) // 10 cold + 5 hot
    })

    it('merges results from hot and cold tiers', async () => {
      // Force flush some data to cold tier
      for (let i = 0; i < 5; i++) {
        await storage.insert(
          'things',
          {
            id: `cold-${i}`,
            type: 'cold',
            data: { i },
            embedding: null,
            created_at: Date.now(),
            updated_at: Date.now(),
          },
          { skipFlushCheck: true }
        )
      }

      await storage.flush()

      // Add more to hot tier
      for (let i = 0; i < 5; i++) {
        await storage.insert('things', {
          id: `hot-${i}`,
          type: 'hot',
          data: { i },
          embedding: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        })
      }

      const result = await storage.query('SELECT * FROM things')
      expect(result.count).toBe(10)
      expect(result.source).toBe('both')
    })
  })

  describe('deduplicates between tiers', () => {
    it('deduplicates rows with same ID during query', async () => {
      // Write to cold tier
      const coldTier = new ColdTier(r2Bucket, doState.id.toString())
      await coldTier.write([
        {
          id: 'dup-1',
          type: 'event',
          data: JSON.stringify({ version: 1 }),
          embedding: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ])

      // Write same ID to hot tier with updated data
      await storage.insert('things', {
        id: 'dup-1',
        type: 'event',
        data: { version: 2 },
        embedding: null,
        created_at: Date.now() + 1000,
        updated_at: Date.now() + 1000,
      })

      const result = await storage.query("SELECT * FROM things WHERE id = 'dup-1'")
      expect(result.rows.length).toBe(1) // Not duplicated
      // Hot tier data takes precedence
      expect((result.rows[0].data as any).version).toBe(2)
    })
  })

  describe('supports time travel queries', () => {
    it('queries at specific snapshot', async () => {
      // Write initial data and flush
      for (let i = 0; i < 5; i++) {
        await storage.insert('things', {
          id: `v1-${i}`,
          type: 'v1',
          data: { version: 1 },
          embedding: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        })
      }

      await storage.flush()
      const snapshot = await storage.getSnapshotId()
      expect(snapshot).not.toBeNull()

      // Write more data
      for (let i = 0; i < 5; i++) {
        await storage.insert('things', {
          id: `v2-${i}`,
          type: 'v2',
          data: { version: 2 },
          embedding: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        })
      }

      await storage.flush()

      // Query at old snapshot - should only see v1 data
      const result = await storage.query('SELECT count(*) FROM things', {
        snapshotId: snapshot!,
      })

      expect(result.rows[0].count).toBe(5)
    })
  })

  describe('partitions by time automatically', () => {
    it('partitions data files by month', async () => {
      // Write data with specific timestamp
      await storage.insert('things', {
        id: 'jan-1',
        type: 'event',
        data: {},
        embedding: null,
        created_at: new Date('2025-01-15').getTime(),
        updated_at: new Date('2025-01-15').getTime(),
      })

      await storage.flush()

      const files = await storage.listDataFiles()
      expect(files.some((f) => f.partition.includes('2025-01'))).toBe(true)
    })
  })

  describe('batch insert', () => {
    it('inserts multiple rows efficiently', async () => {
      const rows = generateThings(100)

      await storage.insertBatch('things', rows)

      const result = await storage.queryHotTier('SELECT count(*) FROM things')
      expect(result.rows[0].count).toBe(100)
    })
  })

  describe('statistics', () => {
    it('returns accurate statistics', async () => {
      // Write some data
      for (let i = 0; i < 5; i++) {
        await storage.insert('things', {
          id: `event-${i}`,
          type: 'event',
          data: {},
          embedding: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        })
      }

      const stats = await storage.getStats()

      expect(stats.hotRowCount).toBe(5)
      expect(stats.coldRowCount).toBe(0)
      expect(stats.flushThreshold).toBe(10000)
      expect(stats.autoFlush).toBe(true)
    })
  })

  describe('configuration', () => {
    it('allows runtime config updates', async () => {
      storage.setConfig({ flushThreshold: 500 })

      const stats = await storage.getStats()
      expect(stats.flushThreshold).toBe(500)
    })
  })
})

// ============================================================================
// FLUSH MANAGER TESTS
// ============================================================================

describe('FlushManager', () => {
  let hotTier: HotTier
  let coldTier: ColdTier
  let flushManager: FlushManager
  let r2Bucket: R2BucketLike

  beforeEach(() => {
    const sqlStorage = createMockSqlStorage()
    r2Bucket = createMockR2Bucket()
    hotTier = new HotTier(sqlStorage)
    coldTier = new ColdTier(r2Bucket, 'test')
    flushManager = new FlushManager(hotTier, coldTier, { flushThreshold: 10 })
  })

  describe('threshold detection', () => {
    it('detects when flush is needed by row count', async () => {
      await hotTier.insertBatch(generateThings(15))

      expect(flushManager.shouldFlush()).toBe(true)
    })

    it('does not trigger flush below threshold', async () => {
      await hotTier.insertBatch(generateThings(5))

      expect(flushManager.shouldFlush()).toBe(false)
    })
  })

  describe('flush operation', () => {
    it('flushes data from hot to cold tier', async () => {
      await hotTier.insertBatch(generateThings(10))

      const result = await flushManager.flush()

      expect(result.rowCount).toBe(10)
      expect(result.snapshotId).toBeDefined()
      expect(hotTier.rowCount).toBe(0) // Cleared after flush
    })

    it('creates valid Iceberg snapshot', async () => {
      await hotTier.insertBatch(generateThings(10))

      const result = await flushManager.flush()

      expect(coldTier.getSnapshotId()).toBe(result.snapshotId)
    })

    it('handles empty flush gracefully', async () => {
      const result = await flushManager.flush()

      expect(result.rowCount).toBe(0)
      expect(result.snapshotId).toBe('')
    })

    it('prevents concurrent flushes', async () => {
      await hotTier.insertBatch(generateThings(10))

      // Start a flush but don't await it
      const flush1 = flushManager.flush()

      // Try to start another flush immediately
      await expect(flushManager.flush()).rejects.toThrow(/already in progress/i)

      await flush1
    })
  })

  describe('conditional flush', () => {
    it('flushes only if needed', async () => {
      await hotTier.insertBatch(generateThings(5))

      const result = await flushManager.flushIfNeeded()

      expect(result).toBeNull() // Not needed
    })

    it('flushes when threshold exceeded', async () => {
      await hotTier.insertBatch(generateThings(15))

      const result = await flushManager.flushIfNeeded()

      expect(result).not.toBeNull()
      expect(result!.rowCount).toBe(15)
    })
  })

  describe('statistics', () => {
    it('tracks flush statistics', async () => {
      await hotTier.insertBatch(generateThings(5))

      const stats = flushManager.getStats()

      expect(stats.hotRowCount).toBe(5)
      expect(stats.flushThreshold).toBe(10)
      expect(stats.flushInProgress).toBe(false)
    })
  })
})

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('Performance', () => {
  it('flushes 10K rows in under 1 second', async () => {
    const doState = createMockDoState()
    const r2Bucket = createMockR2Bucket()
    const storage = new TieredStorage(doState, { R2: r2Bucket }, { autoFlush: false })

    // Insert 10K rows
    const rows = generateThings(10000)
    await storage.insertBatch('things', rows)

    // Time the flush
    const start = performance.now()
    await storage.flush()
    const duration = performance.now() - start

    console.log(`Flushed 10K rows in ${duration.toFixed(2)}ms`)
    expect(duration).toBeLessThan(1000) // < 1 second
  })

  it('queries across tiers efficiently', async () => {
    const doState = createMockDoState()
    const r2Bucket = createMockR2Bucket()
    const storage = new TieredStorage(doState, { R2: r2Bucket }, { autoFlush: false })

    // Write to cold tier
    await storage.insertBatch('things', generateThings(5000, 'cold'))
    await storage.flush()

    // Write to hot tier
    await storage.insertBatch('things', generateThings(5000, 'hot'))

    // Time the cross-tier query
    const start = performance.now()
    const result = await storage.query('SELECT count(*) FROM things')
    const duration = performance.now() - start

    console.log(`Cross-tier query in ${duration.toFixed(2)}ms`)
    expect(result.count).toBe(10000)
    expect(duration).toBeLessThan(500) // < 500ms
  })
})
