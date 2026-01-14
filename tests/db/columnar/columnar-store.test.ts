/**
 * ColumnarStore RED Tests
 *
 * Failing tests that define the API for analytics-optimized columnar storage.
 * These tests should FAIL until ColumnarStore is implemented.
 *
 * Features tested:
 * - Column-per-row storage format (99.4% cost savings)
 * - Bloom filter indexes for equality predicates
 * - Min/max statistics for range pruning
 * - Batch inserts (optimized for DO billing)
 * - Aggregations (SUM, AVG, COUNT, etc.)
 * - JSON subcolumn extraction (ClickHouse-inspired)
 * - CDC event emission
 *
 * @see db/columnar/README.md for full specification
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ColumnarStore } from '../../../db/columnar'

// ============================================================================
// MOCK SQLITE DATABASE
// ============================================================================

/**
 * Mock SQLite database for testing ColumnarStore
 * In production, this would be the DO's sql storage
 */
function createMockDb() {
  const storage = new Map<string, string>()
  return {
    exec: vi.fn((sql: string) => {
      // Track SQL execution for verification
      return { changes: 0 }
    }),
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn().mockReturnThis(),
      run: vi.fn(() => ({ changes: 1 })),
      get: vi.fn(() => {
        // Return column data based on key
        const keyMatch = sql.match(/WHERE key = ['"](.*)['"]/i)
        if (keyMatch) {
          return { value: storage.get(keyMatch[1]) || null }
        }
        return null
      }),
      all: vi.fn(() => []),
    })),
    _storage: storage,
  }
}

// ============================================================================
// COLUMN-PER-ROW STORAGE FORMAT
// ============================================================================

describe('ColumnarStore - Column-per-Row Storage', () => {
  let db: ReturnType<typeof createMockDb>
  let store: ColumnarStore

  beforeEach(() => {
    db = createMockDb()
    store = new ColumnarStore(db)
  })

  it('should store each column as a separate row', async () => {
    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
      { type: 'User', data: { name: 'Bob' } },
    ])

    // Verify storage format: column values stored as JSON arrays
    const ids = await store.getColumn('ids')
    const types = await store.getColumn('types')
    const data = await store.getColumn('data')

    expect(ids).toBeInstanceOf(Array)
    expect(types).toBeInstanceOf(Array)
    expect(data).toBeInstanceOf(Array)
  })

  it('should use 6 row writes for batch of 1000 records', async () => {
    const records = Array.from({ length: 1000 }, (_, i) => ({
      type: 'User',
      data: { name: `User ${i}` },
    }))

    await store.insertBatch(records)

    // Should have written to: ids, types, data, embeddings, timestamps, _meta
    // That's 6 rows regardless of batch size
    const writeCount = store.getWriteCount()
    expect(writeCount).toBeLessThanOrEqual(6)
  })

  it('should maintain metadata with count and dimensions', async () => {
    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
      { type: 'User', data: { name: 'Bob' } },
    ])

    const meta = await store.getMeta()
    expect(meta.count).toBe(2)
    expect(meta.dimensions).toEqual(['ids', 'types', 'data', 'timestamps'])
  })

  it('should store timestamps as JSON arrays with created/updated', async () => {
    const now = Date.now()
    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
    ])

    const timestamps = await store.getColumn('timestamps')
    expect(timestamps).toHaveProperty('created')
    expect(timestamps).toHaveProperty('updated')
    expect(Array.isArray(timestamps.created)).toBe(true)
    expect(timestamps.created[0]).toBeGreaterThanOrEqual(now)
  })

  it('should support binary packed Float32Arrays for embeddings', async () => {
    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' }, embedding: [0.1, 0.2, 0.3] },
      { type: 'User', data: { name: 'Bob' }, embedding: [0.4, 0.5, 0.6] },
    ])

    const embeddings = await store.getColumn('embeddings')
    expect(embeddings).toBeInstanceOf(ArrayBuffer)

    // Should be able to read back as Float32Array
    const view = new Float32Array(embeddings)
    expect(view[0]).toBeCloseTo(0.1)
    expect(view[3]).toBeCloseTo(0.4)
  })
})

// ============================================================================
// BLOOM FILTER INDEXES
// ============================================================================

describe('ColumnarStore - Bloom Filter Indexes', () => {
  let db: ReturnType<typeof createMockDb>
  let store: ColumnarStore

  beforeEach(() => {
    db = createMockDb()
    store = new ColumnarStore(db)
  })

  it('should create bloom filter for high-cardinality columns', async () => {
    await store.insertBatch([
      { type: 'User', data: { email: 'alice@example.com' } },
      { type: 'User', data: { email: 'bob@example.com' } },
    ])

    const bloom = await store.getBloomFilter('data.email')
    expect(bloom).toBeDefined()
    expect(bloom.mightContain).toBeInstanceOf(Function)
  })

  it('should return true for existing values via mightContain', async () => {
    await store.insertBatch([
      { type: 'User', data: { email: 'alice@example.com' } },
      { type: 'User', data: { email: 'bob@example.com' } },
    ])

    const bloom = await store.getBloomFilter('data.email')
    expect(bloom.mightContain('alice@example.com')).toBe(true)
    expect(bloom.mightContain('bob@example.com')).toBe(true)
  })

  it('should return false for definitely non-existing values', async () => {
    await store.insertBatch([
      { type: 'User', data: { email: 'alice@example.com' } },
    ])

    const bloom = await store.getBloomFilter('data.email')
    // Bloom filters have false positives but no false negatives
    // If mightContain returns false, the value definitely doesn't exist
    expect(bloom.mightContain('definitely-not-there@nowhere.com')).toBe(false)
  })

  it('should allow skipping R2 fetches when bloom says no', async () => {
    await store.insertBatch([
      { type: 'User', data: { email: 'alice@example.com' } },
    ])

    const bloom = await store.getBloomFilter('data.email')

    // Query with non-existing email
    const canSkipR2 = !bloom.mightContain('nonexistent@example.com')
    expect(canSkipR2).toBe(true)
  })

  it('should support configurable false positive rate', async () => {
    store = new ColumnarStore(db, { bloomFalsePositiveRate: 0.01 })

    await store.insertBatch([
      { type: 'User', data: { email: 'alice@example.com' } },
    ])

    const bloom = await store.getBloomFilter('data.email')
    expect(bloom.config.falsePositiveRate).toBe(0.01)
  })

  it('should update bloom filter on batch insert', async () => {
    await store.insertBatch([
      { type: 'User', data: { email: 'alice@example.com' } },
    ])

    let bloom = await store.getBloomFilter('data.email')
    expect(bloom.mightContain('bob@example.com')).toBe(false)

    await store.insertBatch([
      { type: 'User', data: { email: 'bob@example.com' } },
    ])

    bloom = await store.getBloomFilter('data.email')
    expect(bloom.mightContain('bob@example.com')).toBe(true)
  })
})

// ============================================================================
// MIN/MAX STATISTICS
// ============================================================================

describe('ColumnarStore - Min/Max Statistics', () => {
  let db: ReturnType<typeof createMockDb>
  let store: ColumnarStore

  beforeEach(() => {
    db = createMockDb()
    store = new ColumnarStore(db)
  })

  it('should track min/max for numeric columns', async () => {
    await store.insertBatch([
      { type: 'Order', data: { total: 100 } },
      { type: 'Order', data: { total: 500 } },
      { type: 'Order', data: { total: 250 } },
    ])

    const stats = await store.getColumnStats('data.total')
    expect(stats.min).toBe(100)
    expect(stats.max).toBe(500)
  })

  it('should track min/max for date columns', async () => {
    await store.insertBatch([
      { type: 'Order', data: { createdAt: '2024-01-01' } },
      { type: 'Order', data: { createdAt: '2024-06-15' } },
      { type: 'Order', data: { createdAt: '2024-03-10' } },
    ])

    const stats = await store.getColumnStats('data.createdAt')
    expect(stats.min).toBe('2024-01-01')
    expect(stats.max).toBe('2024-06-15')
  })

  it('should enable partition pruning based on range predicates', async () => {
    await store.insertBatch([
      { type: 'Order', data: { createdAt: '2024-01-01' } },
      { type: 'Order', data: { createdAt: '2024-06-15' } },
    ])

    const partitions = await store.findPartitions('data.createdAt', {
      op: '>',
      value: '2024-12-01',
    })

    // No partitions have createdAt > 2024-12-01 (max is 2024-06-15)
    expect(partitions).toHaveLength(0)
  })

  it('should return relevant partitions for range queries', async () => {
    await store.insertBatch([
      { type: 'Order', data: { createdAt: '2024-01-01' } },
      { type: 'Order', data: { createdAt: '2024-06-15' } },
    ])

    const partitions = await store.findPartitions('data.createdAt', {
      op: '>',
      value: '2024-01-01',
    })

    // Partition includes values > 2024-01-01
    expect(partitions.length).toBeGreaterThan(0)
  })

  it('should update min/max on batch insert', async () => {
    await store.insertBatch([
      { type: 'Order', data: { total: 100 } },
    ])

    let stats = await store.getColumnStats('data.total')
    expect(stats.max).toBe(100)

    await store.insertBatch([
      { type: 'Order', data: { total: 1000 } },
    ])

    stats = await store.getColumnStats('data.total')
    expect(stats.max).toBe(1000)
  })

  it('should track null count in statistics', async () => {
    await store.insertBatch([
      { type: 'User', data: { age: 25 } },
      { type: 'User', data: { age: null } },
      { type: 'User', data: { name: 'Bob' } }, // age is undefined
    ])

    const stats = await store.getColumnStats('data.age')
    expect(stats.nullCount).toBe(2) // null + undefined
  })

  it('should track cardinality (distinct count) for query planning', async () => {
    await store.insertBatch([
      { type: 'Order', data: { status: 'pending' } },
      { type: 'Order', data: { status: 'pending' } },
      { type: 'Order', data: { status: 'completed' } },
      { type: 'Order', data: { status: 'cancelled' } },
    ])

    const stats = await store.getColumnStats('data.status')
    expect(stats.cardinality).toBe(3) // 3 distinct values
  })
})

// ============================================================================
// BATCH INSERTS
// ============================================================================

describe('ColumnarStore - Batch Inserts', () => {
  let db: ReturnType<typeof createMockDb>
  let store: ColumnarStore

  beforeEach(() => {
    db = createMockDb()
    store = new ColumnarStore(db)
  })

  it('should accept array of records with type and data', async () => {
    const result = await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
      { type: 'User', data: { name: 'Bob' } },
    ])

    expect(result.count).toBe(2)
    expect(result.success).toBe(true)
  })

  it('should generate IDs if not provided', async () => {
    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
    ])

    const ids = await store.getColumn('ids')
    expect(ids[0]).toBeDefined()
    expect(typeof ids[0]).toBe('string')
  })

  it('should preserve provided IDs', async () => {
    await store.insertBatch([
      { id: 'custom-id-1', type: 'User', data: { name: 'Alice' } },
    ])

    const ids = await store.getColumn('ids')
    expect(ids[0]).toBe('custom-id-1')
  })

  it('should handle mixed types in single batch', async () => {
    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
      { type: 'Order', data: { total: 100 } },
    ])

    const types = await store.getColumn('types')
    expect(types).toContain('User')
    expect(types).toContain('Order')
  })

  it('should handle large batches efficiently', async () => {
    const records = Array.from({ length: 10000 }, (_, i) => ({
      type: 'User',
      data: { name: `User ${i}`, index: i },
    }))

    const start = performance.now()
    await store.insertBatch(records)
    const duration = performance.now() - start

    // Should complete in reasonable time (< 1 second for 10k records)
    expect(duration).toBeLessThan(1000)

    const meta = await store.getMeta()
    expect(meta.count).toBe(10000)
  })

  it('should return inserted IDs', async () => {
    const result = await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
      { type: 'User', data: { name: 'Bob' } },
    ])

    expect(result.ids).toHaveLength(2)
    expect(result.ids[0]).toBeDefined()
    expect(result.ids[1]).toBeDefined()
  })

  it('should support optional embeddings', async () => {
    const result = await store.insertBatch([
      { type: 'User', data: { name: 'Alice' }, embedding: [0.1, 0.2, 0.3] },
      { type: 'User', data: { name: 'Bob' } }, // No embedding
    ])

    expect(result.success).toBe(true)

    const embeddings = await store.getColumn('embeddings')
    // First record should have embedding, second should be null/undefined
    expect(embeddings).toBeDefined()
  })
})

// ============================================================================
// AGGREGATIONS
// ============================================================================

describe('ColumnarStore - Aggregations', () => {
  let db: ReturnType<typeof createMockDb>
  let store: ColumnarStore

  beforeEach(async () => {
    db = createMockDb()
    store = new ColumnarStore(db)

    // Seed with test data
    await store.insertBatch([
      { type: 'Order', data: { status: 'pending', total: 100 } },
      { type: 'Order', data: { status: 'pending', total: 200 } },
      { type: 'Order', data: { status: 'completed', total: 300 } },
      { type: 'Order', data: { status: 'completed', total: 400 } },
      { type: 'Order', data: { status: 'cancelled', total: 50 } },
    ])
  })

  it('should support COUNT aggregation', async () => {
    const count = await store.count({ type: 'Order' })
    expect(count).toBe(5)
  })

  it('should support COUNT with filter', async () => {
    const count = await store.count({
      type: 'Order',
      where: { 'data.status': 'pending' },
    })
    expect(count).toBe(2)
  })

  it('should use index for COUNT (0 data reads)', async () => {
    // Count should be answered from metadata, not scanning data
    const readCount = store.getReadCount()
    await store.count({ type: 'Order' })
    const newReadCount = store.getReadCount()

    // Should not have read any data columns
    expect(newReadCount - readCount).toBe(0)
  })

  it('should support SUM aggregation', async () => {
    const stats = await store.aggregate({
      type: 'Order',
      metrics: ['sum:data.total'],
    })

    expect(stats['sum:data.total']).toBe(1050) // 100+200+300+400+50
  })

  it('should support AVG aggregation', async () => {
    const stats = await store.aggregate({
      type: 'Order',
      metrics: ['avg:data.total'],
    })

    expect(stats['avg:data.total']).toBe(210) // 1050/5
  })

  it('should support MIN and MAX aggregation', async () => {
    const stats = await store.aggregate({
      type: 'Order',
      metrics: ['min:data.total', 'max:data.total'],
    })

    expect(stats['min:data.total']).toBe(50)
    expect(stats['max:data.total']).toBe(400)
  })

  it('should support groupBy aggregation', async () => {
    const stats = await store.aggregate({
      type: 'Order',
      groupBy: 'data.status',
      metrics: ['count', 'sum:data.total', 'avg:data.total'],
    })

    expect(stats).toHaveProperty('pending')
    expect(stats).toHaveProperty('completed')
    expect(stats).toHaveProperty('cancelled')

    expect(stats.pending.count).toBe(2)
    expect(stats.pending['sum:data.total']).toBe(300)

    expect(stats.completed.count).toBe(2)
    expect(stats.completed['sum:data.total']).toBe(700)

    expect(stats.cancelled.count).toBe(1)
    expect(stats.cancelled['sum:data.total']).toBe(50)
  })

  it('should support multiple metrics in single query', async () => {
    const stats = await store.aggregate({
      type: 'Order',
      metrics: ['count', 'sum:data.total', 'avg:data.total', 'min:data.total', 'max:data.total'],
    })

    expect(stats.count).toBe(5)
    expect(stats['sum:data.total']).toBe(1050)
    expect(stats['avg:data.total']).toBe(210)
    expect(stats['min:data.total']).toBe(50)
    expect(stats['max:data.total']).toBe(400)
  })

  it('should handle null/undefined values in aggregations', async () => {
    await store.insertBatch([
      { type: 'Order', data: { status: 'test', total: null } },
    ])

    const stats = await store.aggregate({
      type: 'Order',
      where: { 'data.status': 'test' },
      metrics: ['sum:data.total', 'avg:data.total'],
    })

    // Null values should be excluded from sum/avg
    expect(stats['sum:data.total']).toBe(0)
    expect(stats['avg:data.total']).toBeNull()
  })
})

// ============================================================================
// QUERY API
// ============================================================================

describe('ColumnarStore - Query API', () => {
  let db: ReturnType<typeof createMockDb>
  let store: ColumnarStore

  beforeEach(async () => {
    db = createMockDb()
    store = new ColumnarStore(db)

    await store.insertBatch([
      { id: '1', type: 'Order', data: { status: 'pending', total: 100, createdAt: '2024-01-01' } },
      { id: '2', type: 'Order', data: { status: 'completed', total: 200, createdAt: '2024-02-15' } },
      { id: '3', type: 'Order', data: { status: 'completed', total: 300, createdAt: '2024-03-20' } },
    ])
  })

  it('should query by type', async () => {
    const results = await store.query({ type: 'Order' })

    expect(results).toHaveLength(3)
    expect(results.every((r: { type: string }) => r.type === 'Order')).toBe(true)
  })

  it('should support column projection', async () => {
    const results = await store.query({
      type: 'Order',
      columns: ['id', 'data.total', 'data.status'],
    })

    expect(results[0]).toHaveProperty('id')
    expect(results[0]).toHaveProperty('data.total')
    expect(results[0]).toHaveProperty('data.status')
    expect(results[0]).not.toHaveProperty('data.createdAt')
  })

  it('should support where clause with equality', async () => {
    const results = await store.query({
      type: 'Order',
      where: { 'data.status': 'completed' },
    })

    expect(results).toHaveLength(2)
    expect(results.every((r: { data: { status: string } }) => r.data.status === 'completed')).toBe(true)
  })

  it('should support where clause with $gt operator', async () => {
    const results = await store.query({
      type: 'Order',
      where: { 'data.createdAt': { $gt: '2024-01-15' } },
    })

    expect(results).toHaveLength(2)
  })

  it('should support where clause with $lt operator', async () => {
    const results = await store.query({
      type: 'Order',
      where: { 'data.total': { $lt: 250 } },
    })

    expect(results).toHaveLength(2) // 100 and 200
  })

  it('should support where clause with $gte and $lte', async () => {
    const results = await store.query({
      type: 'Order',
      where: {
        'data.total': { $gte: 100, $lte: 200 },
      },
    })

    expect(results).toHaveLength(2) // 100 and 200
  })

  it('should support limit and offset', async () => {
    const results = await store.query({
      type: 'Order',
      limit: 2,
      offset: 1,
    })

    expect(results).toHaveLength(2)
  })

  it('should support ordering', async () => {
    const results = await store.query({
      type: 'Order',
      orderBy: 'data.total',
      order: 'desc',
    })

    expect(results[0].data.total).toBe(300)
    expect(results[2].data.total).toBe(100)
  })

  it('should use partition pruning for range queries', async () => {
    // This should prune partitions based on min/max statistics
    const readCount = store.getReadCount()

    await store.query({
      type: 'Order',
      where: { 'data.createdAt': { $gt: '2024-12-01' } },
    })

    // Should have minimal reads due to pruning (max is 2024-03-20)
    const newReadCount = store.getReadCount()
    expect(newReadCount - readCount).toBeLessThan(3) // Ideally 0
  })
})

// ============================================================================
// JSON SUBCOLUMN EXTRACTION
// ============================================================================

describe('ColumnarStore - JSON Subcolumn Extraction', () => {
  let db: ReturnType<typeof createMockDb>
  let store: ColumnarStore

  beforeEach(() => {
    db = createMockDb()
    store = new ColumnarStore(db)
  })

  it('should automatically extract high-frequency paths as typed subcolumns', async () => {
    await store.insertBatch([
      { type: 'User', data: { email: 'a@x.com', age: 25, premium: true } },
      { type: 'User', data: { email: 'b@x.com', age: 30 } },
      { type: 'User', data: { email: 'c@x.com', age: null, premium: false } },
    ])

    const extractedColumns = await store.getExtractedColumns()

    // email and age appear in 100% of records - should be extracted
    expect(extractedColumns).toContain('data.email')
    expect(extractedColumns).toContain('data.age')
  })

  it('should keep low-frequency paths in _rest JSON', async () => {
    await store.insertBatch([
      { type: 'User', data: { email: 'a@x.com', premium: true } },
      { type: 'User', data: { email: 'b@x.com' } },
      { type: 'User', data: { email: 'c@x.com', premium: false } },
    ])

    const extractedColumns = await store.getExtractedColumns()

    // premium appears in 66% of records - below default 80% threshold
    expect(extractedColumns).not.toContain('data.premium')

    // But email should be extracted (100%)
    expect(extractedColumns).toContain('data.email')
  })

  it('should configure extraction threshold', async () => {
    store = new ColumnarStore(db, { extractionThreshold: 0.5 })

    await store.insertBatch([
      { type: 'User', data: { email: 'a@x.com', premium: true } },
      { type: 'User', data: { email: 'b@x.com' } },
      { type: 'User', data: { email: 'c@x.com', premium: false } },
    ])

    const extractedColumns = await store.getExtractedColumns()

    // With 50% threshold, premium (66%) should now be extracted
    expect(extractedColumns).toContain('data.premium')
  })

  it('should track path statistics (frequency and type)', async () => {
    await store.insertBatch([
      { type: 'User', data: { email: 'a@x.com', age: 25 } },
      { type: 'User', data: { email: 'b@x.com', age: 30 } },
      { type: 'User', data: { email: 'c@x.com' } },
    ])

    const pathStats = await store.getPathStats()

    expect(pathStats['data.email']).toEqual({
      frequency: 1.0, // 100%
      type: 'String',
    })

    expect(pathStats['data.age']).toEqual({
      frequency: 2 / 3, // 66.67%
      type: 'Int64',
    })
  })

  it('should store extracted columns as typed arrays', async () => {
    await store.insertBatch([
      { type: 'User', data: { email: 'a@x.com', age: 25 } },
      { type: 'User', data: { email: 'b@x.com', age: 30 } },
    ])

    const emails = await store.getTypedColumn('data.email')
    expect(emails).toEqual(['a@x.com', 'b@x.com'])

    const ages = await store.getTypedColumn('data.age')
    expect(ages).toEqual([25, 30])
  })

  it('should store remaining JSON in _rest column', async () => {
    await store.insertBatch([
      { type: 'User', data: { email: 'a@x.com', rare: 'value1' } },
      { type: 'User', data: { email: 'b@x.com' } },
    ])

    const rest = await store.getColumn('data._rest')

    // First record has rare field in _rest
    expect(rest[0]).toEqual({ rare: 'value1' })
    // Second record has empty _rest
    expect(rest[1]).toEqual({})
  })

  it('should handle nested JSON paths', async () => {
    await store.insertBatch([
      { type: 'User', data: { profile: { name: 'Alice', settings: { dark: true } } } },
      { type: 'User', data: { profile: { name: 'Bob', settings: { dark: false } } } },
    ])

    const pathStats = await store.getPathStats()

    expect(pathStats['data.profile.name']).toBeDefined()
    expect(pathStats['data.profile.settings.dark']).toBeDefined()
  })

  it('should infer correct types for extracted columns', async () => {
    await store.insertBatch([
      { type: 'User', data: { name: 'Alice', age: 25, active: true, score: 95.5 } },
      { type: 'User', data: { name: 'Bob', age: 30, active: false, score: 88.0 } },
    ])

    const pathStats = await store.getPathStats()

    expect(pathStats['data.name'].type).toBe('String')
    expect(pathStats['data.age'].type).toBe('Int64')
    expect(pathStats['data.active'].type).toBe('Bool')
    expect(pathStats['data.score'].type).toBe('Float64')
  })
})

// ============================================================================
// CDC EVENTS
// ============================================================================

describe('ColumnarStore - CDC Events', () => {
  let db: ReturnType<typeof createMockDb>
  let store: ColumnarStore
  let cdcEvents: any[]

  beforeEach(() => {
    db = createMockDb()
    cdcEvents = []
    store = new ColumnarStore(db, {
      onCdc: (event: any) => cdcEvents.push(event),
    })
  })

  it('should emit CDC event on batch insert', async () => {
    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
      { type: 'User', data: { name: 'Bob' } },
    ])

    expect(cdcEvents).toHaveLength(1)
    expect(cdcEvents[0]).toMatchObject({
      type: 'cdc.batch_insert',
      op: 'c', // create
      store: 'columnar',
      table: 'things',
      count: 2,
    })
  })

  it('should include partition info in CDC event', async () => {
    const now = new Date()
    const dateStr = now.toISOString().split('T')[0]

    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
    ])

    expect(cdcEvents[0].partition).toMatch(new RegExp(`type=User/dt=${dateStr}`))
  })

  it('should batch multiple inserts into single CDC event', async () => {
    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
      { type: 'User', data: { name: 'Bob' } },
      { type: 'Order', data: { total: 100 } },
    ])

    // Single batch = single CDC event
    expect(cdcEvents).toHaveLength(1)
    expect(cdcEvents[0].count).toBe(3)
  })

  it('should include timestamp in CDC event', async () => {
    const before = Date.now()
    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
    ])
    const after = Date.now()

    expect(cdcEvents[0].timestamp).toBeGreaterThanOrEqual(before)
    expect(cdcEvents[0].timestamp).toBeLessThanOrEqual(after)
  })

  it('should include batch ID for correlation', async () => {
    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
    ])

    expect(cdcEvents[0].batchId).toBeDefined()
    expect(typeof cdcEvents[0].batchId).toBe('string')
  })

  it('should support async CDC handlers', async () => {
    let asyncCalled = false
    store = new ColumnarStore(db, {
      onCdc: async (event: any) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        asyncCalled = true
      },
    })

    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
    ])

    expect(asyncCalled).toBe(true)
  })

  it('should not block insert if CDC handler fails', async () => {
    let insertCompleted = false
    store = new ColumnarStore(db, {
      onCdc: async () => {
        throw new Error('CDC handler error')
      },
    })

    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
    ])

    insertCompleted = true
    expect(insertCompleted).toBe(true)
  })
})

// ============================================================================
// TYPE INDEX (PARTITION PRUNING)
// ============================================================================

describe('ColumnarStore - Type Index', () => {
  let db: ReturnType<typeof createMockDb>
  let store: ColumnarStore

  beforeEach(async () => {
    db = createMockDb()
    store = new ColumnarStore(db)

    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
      { type: 'User', data: { name: 'Bob' } },
      { type: 'Order', data: { total: 100 } },
      { type: 'Order', data: { total: 200 } },
      { type: 'Product', data: { sku: 'ABC' } },
    ])
  })

  it('should maintain type index for partition selection', async () => {
    const typeIndex = await store.getTypeIndex()

    expect(typeIndex).toHaveProperty('User')
    expect(typeIndex).toHaveProperty('Order')
    expect(typeIndex).toHaveProperty('Product')
  })

  it('should track count per type', async () => {
    const typeIndex = await store.getTypeIndex()

    expect(typeIndex.User.count).toBe(2)
    expect(typeIndex.Order.count).toBe(2)
    expect(typeIndex.Product.count).toBe(1)
  })

  it('should prune partitions based on type filter', async () => {
    // Query for Users should not scan Order or Product data
    const readCount = store.getReadCount()

    await store.query({ type: 'User' })

    const typesScanned = store.getTypesScanned()
    expect(typesScanned).toContain('User')
    expect(typesScanned).not.toContain('Order')
    expect(typesScanned).not.toContain('Product')
  })

  it('should list distinct types', async () => {
    const types = await store.listTypes()

    expect(types).toEqual(expect.arrayContaining(['User', 'Order', 'Product']))
    expect(types).toHaveLength(3)
  })
})

// ============================================================================
// COST TRACKING
// ============================================================================

describe('ColumnarStore - Cost Tracking', () => {
  let db: ReturnType<typeof createMockDb>
  let store: ColumnarStore

  beforeEach(() => {
    db = createMockDb()
    store = new ColumnarStore(db)
  })

  it('should track row writes', async () => {
    expect(store.getWriteCount()).toBe(0)

    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
      { type: 'User', data: { name: 'Bob' } },
    ])

    // Should be 6 writes (ids, types, data, embeddings, timestamps, _meta)
    expect(store.getWriteCount()).toBeLessThanOrEqual(6)
  })

  it('should track row reads', async () => {
    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
    ])

    const before = store.getReadCount()
    await store.query({ type: 'User' })
    const after = store.getReadCount()

    expect(after).toBeGreaterThan(before)
  })

  it('should calculate cost savings vs traditional storage', async () => {
    const records = Array.from({ length: 1000 }, (_, i) => ({
      type: 'User',
      data: { name: `User ${i}` },
    }))

    await store.insertBatch(records)

    const savings = store.calculateSavings()

    // Traditional: 1000 writes = $1.00
    // Columnar: 6 writes = $0.006
    // Savings: 99.4%
    expect(savings.traditional.writes).toBe(1000)
    expect(savings.columnar.writes).toBeLessThanOrEqual(6)
    expect(savings.percentSaved).toBeGreaterThanOrEqual(99)
  })

  it('should provide cost estimates for queries', async () => {
    await store.insertBatch([
      { type: 'User', data: { name: 'Alice' } },
    ])

    const estimate = store.estimateQueryCost({
      type: 'User',
      columns: ['id', 'data.name'],
    })

    expect(estimate).toHaveProperty('rowReads')
    expect(estimate).toHaveProperty('estimatedCost')
    expect(estimate.rowReads).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// ERROR HANDLING
// ============================================================================

describe('ColumnarStore - Error Handling', () => {
  let db: ReturnType<typeof createMockDb>
  let store: ColumnarStore

  beforeEach(() => {
    db = createMockDb()
    store = new ColumnarStore(db)
  })

  it('should throw on empty batch insert', async () => {
    await expect(store.insertBatch([])).rejects.toThrow('Cannot insert empty batch')
  })

  it('should throw on invalid record (missing type)', async () => {
    await expect(
      store.insertBatch([{ data: { name: 'Alice' } } as any])
    ).rejects.toThrow('Record missing required field: type')
  })

  it('should throw on invalid record (missing data)', async () => {
    await expect(
      store.insertBatch([{ type: 'User' } as any])
    ).rejects.toThrow('Record missing required field: data')
  })

  it('should handle database errors gracefully', async () => {
    db.prepare = vi.fn(() => {
      throw new Error('Database unavailable')
    })

    await expect(
      store.insertBatch([{ type: 'User', data: { name: 'Alice' } }])
    ).rejects.toThrow('Database unavailable')
  })

  it('should validate embedding dimensions are consistent', async () => {
    await expect(
      store.insertBatch([
        { type: 'User', data: { name: 'Alice' }, embedding: [0.1, 0.2, 0.3] },
        { type: 'User', data: { name: 'Bob' }, embedding: [0.1, 0.2] }, // Different dimension
      ])
    ).rejects.toThrow('Inconsistent embedding dimensions')
  })
})

// ============================================================================
// SCHEMA INITIALIZATION
// ============================================================================

describe('ColumnarStore - Schema Initialization', () => {
  let db: ReturnType<typeof createMockDb>

  beforeEach(() => {
    db = createMockDb()
  })

  it('should create storage table on initialization', () => {
    new ColumnarStore(db)

    expect(db.exec).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS')
    )
  })

  it('should create indexes on storage table', () => {
    new ColumnarStore(db)

    expect(db.exec).toHaveBeenCalledWith(
      expect.stringContaining('CREATE INDEX')
    )
  })

  it('should support custom table name prefix', () => {
    new ColumnarStore(db, { tablePrefix: 'analytics_' })

    expect(db.exec).toHaveBeenCalledWith(
      expect.stringContaining('analytics_')
    )
  })
})
