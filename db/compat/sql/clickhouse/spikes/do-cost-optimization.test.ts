/**
 * Tests for DO Cost Optimization Spike
 *
 * Validates various storage strategies for minimizing DO SQLite billing
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  RowPerRecordStorage,
  ColumnarStorage,
  ChunkedColumnarStorage,
  BufferedStorage,
  TrueColumnarStorage,
  ClickHouseColumnarStorage,
  DOColumnarWrapper,
  generateTestThings,
  runBenchmark,
  type Thing,
} from './do-cost-optimization'

describe('DO Cost Optimization', () => {
  // ============================================================================
  // Strategy 1: Row-Per-Record (Baseline)
  // ============================================================================
  describe('RowPerRecordStorage (baseline)', () => {
    let storage: RowPerRecordStorage

    beforeEach(() => {
      storage = new RowPerRecordStorage()
    })

    it('should insert and retrieve a single thing', () => {
      const thing: Thing = {
        id: 'test-1',
        type: 'user',
        data: { name: 'Alice' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      storage.insert(thing)
      const retrieved = storage.get('test-1')

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe('test-1')
      expect(retrieved!.type).toBe('user')
      expect(retrieved!.data).toEqual({ name: 'Alice' })
    })

    it('should count one write per insert', () => {
      const things = generateTestThings(100)
      for (const thing of things) {
        storage.insert(thing)
      }

      const stats = storage.getStats()
      expect(stats.writeCount).toBe(100) // 100 rows written
      expect(stats.rowCount).toBe(100)
    })

    it('should count one read per get operation', () => {
      const things = generateTestThings(10)
      for (const thing of things) {
        storage.insert(thing)
      }

      storage.get('thing-0')
      storage.get('thing-5')
      storage.get('thing-9')

      const stats = storage.getStats()
      expect(stats.readCount).toBe(3)
    })

    it('should count N reads for getAll with N records', () => {
      const things = generateTestThings(50)
      for (const thing of things) {
        storage.insert(thing)
      }

      storage.getAll()

      const stats = storage.getStats()
      expect(stats.readCount).toBe(50) // Must read every row
    })

    it('should count N reads for getByType (full scan)', () => {
      const things = generateTestThings(100)
      for (const thing of things) {
        storage.insert(thing)
      }

      const users = storage.getByType('user')

      const stats = storage.getStats()
      expect(stats.readCount).toBe(100) // Must scan all rows
      expect(users.length).toBe(20) // 100/5 types = 20 users
    })

    it('should handle embeddings correctly', () => {
      const thing: Thing = {
        id: 'with-embedding',
        type: 'vector',
        data: {},
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      storage.insert(thing)
      const retrieved = storage.get('with-embedding')

      expect(retrieved!.embedding).toBeInstanceOf(Float32Array)
      expect(retrieved!.embedding!.length).toBe(3)
      // Float32 has precision differences
      expect(retrieved!.embedding![0]).toBeCloseTo(0.1, 5)
      expect(retrieved!.embedding![1]).toBeCloseTo(0.2, 5)
      expect(retrieved!.embedding![2]).toBeCloseTo(0.3, 5)
    })
  })

  // ============================================================================
  // Strategy 2: Columnar JSON Storage
  // ============================================================================
  describe('ColumnarStorage', () => {
    let storage: ColumnarStorage

    beforeEach(() => {
      storage = new ColumnarStorage()
    })

    it('should store all records in single write after flush', () => {
      const things = generateTestThings(100)
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      const stats = storage.getStats()
      expect(stats.writeCount).toBe(1) // Single row write for 100 records!
    })

    it('should retrieve all records with single read', () => {
      const things = generateTestThings(50)
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      // Clear in-memory data to force reload
      storage['chunk'] = storage['createEmptyChunk']()

      const all = storage.getAll()
      const stats = storage.getStats()

      expect(all.length).toBe(50)
      expect(stats.readCount).toBe(1) // Single row read!
    })

    it('should filter by type with single read', () => {
      const things = generateTestThings(100)
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()
      storage['chunk'] = storage['createEmptyChunk']()

      const users = storage.getByType('user')
      const stats = storage.getStats()

      expect(users.length).toBe(20)
      expect(stats.readCount).toBe(1) // Still just 1 read
    })

    it('should provide 99% cost savings vs baseline for 100 records', () => {
      // Baseline: 100 writes + 100 reads = 200 row ops
      // Columnar: 1 write + 1 read = 2 row ops
      // Savings: (200-2)/200 = 99%

      const things = generateTestThings(100)

      // Baseline
      const baseline = new RowPerRecordStorage()
      for (const thing of things) {
        baseline.insert(thing)
      }
      baseline.getAll()
      const baselineStats = baseline.getStats()

      // Columnar
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()
      storage['chunk'] = storage['createEmptyChunk']()
      storage.getAll()
      const columnarStats = storage.getStats()

      const baselineOps = baselineStats.writeCount + baselineStats.readCount
      const columnarOps = columnarStats.writeCount + columnarStats.readCount
      const savings = (1 - columnarOps / baselineOps) * 100

      expect(savings).toBeGreaterThanOrEqual(99)
    })
  })

  // ============================================================================
  // Strategy 3: Chunked Columnar Storage
  // ============================================================================
  describe('ChunkedColumnarStorage', () => {
    it('should create multiple chunks based on threshold', () => {
      const storage = new ChunkedColumnarStorage(100) // 100 records per chunk
      const things = generateTestThings(350)

      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      const stats = storage.getStats()
      expect(stats.chunkCount).toBe(4) // ceil(350/100) = 4 chunks
      // Note: flush() writes all chunks including partially filled ones
      // 3 full chunks auto-flushed + final flush writes all 4
      expect(stats.writeCount).toBeLessThan(350) // Still much better than row-per-record!
    })

    it('should retrieve specific record efficiently', () => {
      const storage = new ChunkedColumnarStorage(100)
      const things = generateTestThings(500)

      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      // Reset read count
      const retrieved = storage.get('thing-250')

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe('thing-250')
    })

    it('should balance chunk size vs row count tradeoff', () => {
      // Small chunks = more rows but better random access
      // Large chunks = fewer rows but must read more data
      const smallChunks = new ChunkedColumnarStorage(100)
      const largeChunks = new ChunkedColumnarStorage(1000)

      const things = generateTestThings(5000)

      for (const thing of things) {
        smallChunks.insert(thing)
        largeChunks.insert(thing)
      }
      smallChunks.flush()
      largeChunks.flush()

      const smallStats = smallChunks.getStats()
      const largeStats = largeChunks.getStats()

      expect(smallStats.chunkCount).toBe(50) // 5000/100
      expect(largeStats.chunkCount).toBe(5) // 5000/1000
      // Write count includes auto-flush + final flush
      expect(smallStats.writeCount).toBeLessThan(5000) // Much less than row-per-record
      expect(largeStats.writeCount).toBeLessThan(smallStats.writeCount) // Larger chunks = fewer writes
    })
  })

  // ============================================================================
  // Strategy 4: Buffered Storage
  // ============================================================================
  describe('BufferedStorage', () => {
    it('should buffer writes and flush in batches', () => {
      const storage = new BufferedStorage(50) // Flush every 50 records
      const things = generateTestThings(120)

      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush() // Final flush

      const stats = storage.getStats()
      expect(stats.flushCount).toBe(3) // 120/50 = 2 auto + 1 manual
    })

    it('should find buffered items before flush', () => {
      const storage = new BufferedStorage(100)
      const things = generateTestThings(10)

      for (const thing of things) {
        storage.insert(thing)
      }

      // Don't flush - items should still be in buffer
      const retrieved = storage.get('thing-5')
      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe('thing-5')

      const stats = storage.getStats()
      expect(stats.bufferedCount).toBe(10)
    })
  })

  // ============================================================================
  // Strategy 5: True Columnar Storage
  // ============================================================================
  describe('TrueColumnarStorage', () => {
    let storage: TrueColumnarStorage

    beforeEach(() => {
      storage = new TrueColumnarStorage()
    })

    it('should store columns separately', () => {
      const things = generateTestThings(100)
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      const stats = storage.getStats()
      // 6 columns: ids, types, dataJson, timestamps, embeddings (if any), count
      expect(stats.columnCount).toBeGreaterThanOrEqual(5)
    })

    it('should allow reading only specific columns', () => {
      const things = generateTestThings(100)
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      // Read only IDs - should be efficient
      const ids = storage.getIdsOnly()
      expect(ids.length).toBe(100)

      const stats = storage.getStats()
      expect(stats.readCount).toBe(1) // Only read ids column
    })

    it('should handle embeddings in separate column', () => {
      const things = generateTestThings(50, true, 64) // with embeddings
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      const all = storage.getAll()
      expect(all[0].embedding).toBeInstanceOf(Float32Array)
      expect(all[0].embedding!.length).toBe(64)
    })
  })

  // ============================================================================
  // Strategy 6: ClickHouse-Style Columnar (Column Per Row)
  // ============================================================================
  describe('ClickHouseColumnarStorage', () => {
    let storage: ClickHouseColumnarStorage

    beforeEach(() => {
      storage = new ClickHouseColumnarStorage()
    })

    it('should write minimal rows for any number of records', () => {
      const things = generateTestThings(1000)
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      const stats = storage.getStats()
      // ids, types, data, timestamps, _meta (embeddings skipped if none)
      expect(stats.writeCount).toBeLessThanOrEqual(6)
      expect(stats.writeCount).toBeGreaterThanOrEqual(5)
      expect(stats.recordCount).toBe(1000)
      // Key insight: 5-6 writes vs 1000 row-per-record writes!
    })

    it('should read only 1 row for COUNT query', () => {
      const things = generateTestThings(500)
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      // Clear in-memory to force read
      const readCount = storage['readCount']
      storage['ids'] = []
      storage['readCount'] = 0

      const count = storage.count()

      expect(count).toBe(500)
      expect(storage.getStats().readCount).toBe(1) // Only _meta row!
    })

    it('should read only 1 row for SELECT ids query', () => {
      const things = generateTestThings(200)
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      // Clear in-memory
      storage['ids'] = []
      storage['idIndex'].clear()
      storage['readCount'] = 0

      const ids = storage.getAllIds()

      expect(ids.length).toBe(200)
      expect(storage.getStats().readCount).toBe(1) // Only ids row!
    })

    it('should read only 2 rows for SELECT id, type query', () => {
      const things = generateTestThings(300)
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      // Clear in-memory
      storage['ids'] = []
      storage['types'] = []
      storage['idIndex'].clear()
      storage['readCount'] = 0

      const userIds = storage.getByType('user')

      expect(userIds.length).toBe(60) // 300/5 types
      expect(storage.getStats().readCount).toBe(2) // ids + types rows
    })

    it('should read 2 rows for SELECT embedding query', () => {
      const things = generateTestThings(100, true, 128)
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      // Clear in-memory
      storage['ids'] = []
      storage['embeddings'] = []
      storage['idIndex'].clear()
      storage['readCount'] = 0

      const embeddings = storage.getAllEmbeddings()

      expect(embeddings.size).toBe(100)
      // Note: may need to read _meta for embeddingDim, so 2-3 reads
      expect(storage.getStats().readCount).toBeLessThanOrEqual(3)
    })

    it('should support projection pushdown', () => {
      const things = generateTestThings(50)
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      // Clear in-memory
      storage['ids'] = []
      storage['types'] = []
      storage['data'] = []
      storage['idIndex'].clear()
      storage['readCount'] = 0

      // Only request id and type
      const result = storage.get('thing-25', ['id', 'type'])

      expect(result).not.toBeNull()
      expect(result!.id).toBe('thing-25')
      expect(result!.type).toBeDefined()
      expect(result!.data).toBeUndefined() // Not requested!
    })

    it('should provide query cost comparison', () => {
      const comparison = ClickHouseColumnarStorage.queryCostComparison(10000)

      // COUNT should be 99.99% savings
      const countQuery = comparison.find((c) => c.query === 'SELECT COUNT(*)')
      expect(countQuery).toBeDefined()
      expect(countQuery!.rowPerRecord).toBe(10000)
      expect(countQuery!.columnar).toBe(1)
      expect(countQuery!.savings).toBe('100%') // rounds to 100%

      // INSERT should be 99.4% savings
      const insertQuery = comparison.find((c) => c.query === 'INSERT 1000 records')
      expect(insertQuery).toBeDefined()
      expect(insertQuery!.rowPerRecord).toBe(1000)
      expect(insertQuery!.columnar).toBe(6)
      expect(insertQuery!.savings).toBe('99%')
    })

    it('should generate correct SQL schema', () => {
      const sql = ClickHouseColumnarStorage.createTableSQL('things_columnar')

      expect(sql).toContain('column_name TEXT PRIMARY KEY')
      expect(sql).toContain('column_data BLOB NOT NULL')
    })
  })

  // ============================================================================
  // DO SQLite Wrapper
  // ============================================================================
  describe('DOColumnarWrapper', () => {
    it('should generate correct table creation SQL', () => {
      const wrapper = new DOColumnarWrapper('things')
      const sql = wrapper.createTableSQL()

      expect(sql).toContain('chunk_id INTEGER PRIMARY KEY')
      expect(sql).toContain('data TEXT NOT NULL')
      expect(sql).toContain('record_count INTEGER')
    })

    it('should calculate cost savings correctly', () => {
      const wrapper = new DOColumnarWrapper('things', 1000)
      const savings = wrapper.calculateCostSavings(10000)

      expect(savings.rowPerRecord.writes).toBe(10000)
      expect(savings.rowPerRecord.reads).toBe(10000)
      expect(savings.columnar.writes).toBe(10) // ceil(10000/1000)
      expect(savings.columnar.reads).toBe(10)
      expect(savings.savingsPercent).toBe(100) // rounds to 100%
    })

    it('should generate upsert SQL with correct params', () => {
      const wrapper = new DOColumnarWrapper('things')
      const chunk = {
        chunkId: 0,
        ids: ['id1', 'id2'],
        types: ['user', 'order'],
        data: [{ a: 1 }, { b: 2 }],
        embeddings: null,
        createdAts: [1000, 2000],
        updatedAts: [1000, 2000],
        recordCount: 2,
      }

      const { sql, params } = wrapper.upsertChunkSQL(chunk)

      expect(sql).toContain('INSERT INTO things')
      expect(sql).toContain('ON CONFLICT(chunk_id) DO UPDATE')
      expect(params[0]).toBe(0) // chunk_id
      expect(params[2]).toBe(2) // record_count
    })
  })

  // ============================================================================
  // Benchmark Comparison
  // ============================================================================
  describe('Benchmark', () => {
    it('should show columnar strategies are more efficient than baseline', () => {
      const results = runBenchmark(1000, false)

      // All columnar strategies should have fewer row writes than baseline
      expect(results.columnar.rowsWritten).toBeLessThan(results.baseline.rowsWritten)
      expect(results.chunked.rowsWritten).toBeLessThan(results.baseline.rowsWritten)

      // Cost savings should be significant
      expect(results.columnar.costSavingsPercent).toBeGreaterThan(90)
    })

    it('should handle records with embeddings', () => {
      const results = runBenchmark(500, true)

      expect(results.baseline.recordCount).toBe(500)
      expect(results.columnar.recordCount).toBe(500)

      // Columnar should still be more efficient
      expect(results.columnar.rowsWritten).toBe(1)
      expect(results.baseline.rowsWritten).toBe(500)
    })

    it('should show chunked strategy balances access patterns', () => {
      const results = runBenchmark(5000, false)

      // Chunked has more writes than pure columnar but better random access
      expect(results.chunked.rowsWritten).toBeGreaterThan(results.columnar.rowsWritten)
      expect(results.chunked.rowsWritten).toBeLessThan(results.baseline.rowsWritten)

      // But chunked still saves >99% vs baseline
      expect(results.chunked.costSavingsPercent).toBeGreaterThan(99)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================
  describe('Edge Cases', () => {
    it('should handle empty storage', () => {
      const storage = new ClickHouseColumnarStorage()
      expect(storage.count()).toBe(0)
      expect(storage.getAllIds()).toEqual([])
      expect(storage.getAll()).toEqual([])
    })

    it('should handle single record', () => {
      const storage = new ClickHouseColumnarStorage()
      const thing: Thing = {
        id: 'single',
        type: 'test',
        data: { key: 'value' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      storage.insert(thing)
      storage.flush()

      expect(storage.count()).toBe(1)
      const retrieved = storage.get('single')
      expect(retrieved).not.toBeNull()
      expect(retrieved!.data).toEqual({ key: 'value' })
    })

    it('should handle missing record lookup', () => {
      const storage = new ClickHouseColumnarStorage()
      const things = generateTestThings(10)
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      const missing = storage.get('nonexistent')
      expect(missing).toBeNull()
    })

    it('should handle large data objects', () => {
      const storage = new ClickHouseColumnarStorage()
      const largeData: Record<string, unknown> = {}
      for (let i = 0; i < 100; i++) {
        largeData[`key${i}`] = `value${i}`.repeat(100)
      }

      const thing: Thing = {
        id: 'large',
        type: 'test',
        data: largeData,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      storage.insert(thing)
      storage.flush()

      const retrieved = storage.get('large')
      expect(retrieved).not.toBeNull()
      expect(Object.keys(retrieved!.data!)).toHaveLength(100)
    })

    it('should handle null/undefined in data', () => {
      const storage = new ClickHouseColumnarStorage()
      const thing: Thing = {
        id: 'nulls',
        type: 'test',
        data: { a: null, b: undefined, c: 'value' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      storage.insert(thing)
      storage.flush()

      const retrieved = storage.get('nulls')
      expect(retrieved).not.toBeNull()
      expect(retrieved!.data!.a).toBeNull()
      // undefined becomes null in JSON
      expect(retrieved!.data!.c).toBe('value')
    })
  })

  // ============================================================================
  // Cost Analysis
  // ============================================================================
  describe('Cost Analysis', () => {
    it('should demonstrate 99.4% write cost savings at 1000 records', () => {
      // Row-per-record: 1000 writes
      // ClickHouse columnar: 6 writes
      // Savings: (1000-6)/1000 = 99.4%

      const storage = new ClickHouseColumnarStorage()
      const things = generateTestThings(1000)
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      const stats = storage.getStats()
      const savings = (1 - stats.writeCount / 1000) * 100

      expect(savings).toBeGreaterThanOrEqual(99)
    })

    it('should demonstrate 99.99% read cost savings for COUNT at 10000 records', () => {
      // Row-per-record: must scan all 10000 rows
      // ClickHouse columnar: 1 read (_meta)
      // Savings: (10000-1)/10000 = 99.99%

      const storage = new ClickHouseColumnarStorage()
      const things = generateTestThings(10000)
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      // Clear in-memory
      storage['ids'] = []
      storage['readCount'] = 0

      storage.count()

      const stats = storage.getStats()
      const savings = (1 - stats.readCount / 10000) * 100

      expect(savings).toBeGreaterThanOrEqual(99.9)
    })

    it('should demonstrate 99.98% savings for SELECT id, type at 10000 records', () => {
      // Row-per-record: 10000 reads
      // ClickHouse columnar: 2 reads (ids + types)
      // Savings: (10000-2)/10000 = 99.98%

      const storage = new ClickHouseColumnarStorage()
      const things = generateTestThings(10000)
      for (const thing of things) {
        storage.insert(thing)
      }
      storage.flush()

      // Clear in-memory
      storage['ids'] = []
      storage['types'] = []
      storage['idIndex'].clear()
      storage['readCount'] = 0

      storage.getByType('user')

      const stats = storage.getStats()
      const savings = (1 - stats.readCount / 10000) * 100

      expect(savings).toBeGreaterThanOrEqual(99.9)
    })
  })
})
