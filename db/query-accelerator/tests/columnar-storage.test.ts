/**
 * RED PHASE: Columnar Storage Tests
 *
 * TDD tests for the production DO Query Accelerator Columnar Storage.
 * These tests define the expected interface and behavior for column-per-row
 * storage that achieves 99%+ cost savings vs row-per-record storage.
 *
 * @see db/ARCHITECTURE.md for design details
 * @issue dotdo-1l8xt
 *
 * Expected implementation location: db/query-accelerator/columnar-storage.ts
 *
 * Key features to implement:
 * 1. Column-per-row storage (ids, types, data columns as separate SQLite rows)
 * 2. Projection pushdown (only load needed columns)
 * 3. Binary packed storage for embeddings
 * 4. Metadata tracking (_meta row)
 * 5. 99%+ write cost savings vs row-per-record
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import production module (will fail until implemented)
import type {
  ColumnarStorage,
  ColumnarStorageOptions,
  ColumnarStorageStats,
  ColumnMetadata,
} from '../columnar-storage'

// Placeholder imports that will fail - these are the interfaces we expect
// @ts-expect-error - Module not yet implemented
import { createColumnarStorage } from '../columnar-storage'

// ============================================================================
// Type Definitions (Expected Interface)
// ============================================================================

interface Thing {
  $id: string
  $type: string
  $ns?: string
  data: Record<string, unknown>
  embedding?: number[]
  createdAt: number
  updatedAt: number
}

// ============================================================================
// Storage Creation Tests
// ============================================================================

describe('Columnar Storage - Creation', () => {
  it('should create storage with default options', () => {
    // RED: Will fail until createColumnarStorage is implemented
    const storage = createColumnarStorage()

    expect(storage).toBeDefined()
    expect(typeof storage.insert).toBe('function')
    expect(typeof storage.flush).toBe('function')
    expect(typeof storage.query).toBe('function')
    expect(typeof storage.get).toBe('function')
    expect(typeof storage.count).toBe('function')
    expect(typeof storage.getStats).toBe('function')
  })

  it('should create storage with custom options', () => {
    const options: ColumnarStorageOptions = {
      embeddingDimensions: 1536,
      maxRecordsPerFlush: 10000,
      compressEmbeddings: true,
    }

    const storage = createColumnarStorage(options)
    expect(storage).toBeDefined()
  })

  it('should export ColumnarStorage class', async () => {
    // RED: Will fail until class is exported
    const module = await import('../columnar-storage')
    expect(module.ColumnarStorage).toBeDefined()
  })

  it('should export createColumnarStorage factory', async () => {
    const module = await import('../columnar-storage')
    expect(module.createColumnarStorage).toBeDefined()
    expect(typeof module.createColumnarStorage).toBe('function')
  })
})

// ============================================================================
// Insert Operations Tests
// ============================================================================

describe('Columnar Storage - Insert', () => {
  let storage: ColumnarStorage

  beforeEach(() => {
    storage = createColumnarStorage()
  })

  it('should insert a single record', () => {
    const thing: Thing = {
      $id: 'thing-001',
      $type: 'Customer',
      data: { name: 'Alice', email: 'alice@test.com' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    storage.insert(thing)
    expect(storage.count()).toBe(1)
  })

  it('should insert multiple records', () => {
    for (let i = 0; i < 100; i++) {
      storage.insert({
        $id: `thing-${i}`,
        $type: 'Customer',
        data: { name: `User ${i}` },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }

    expect(storage.count()).toBe(100)
  })

  it('should handle records with embeddings', () => {
    const embedding = new Array(1536).fill(0).map((_, i) => i * 0.001)

    storage.insert({
      $id: 'thing-001',
      $type: 'Document',
      data: { title: 'Test Doc' },
      embedding,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    expect(storage.count()).toBe(1)
  })

  it('should handle records with different types', () => {
    storage.insert({
      $id: 'customer-001',
      $type: 'Customer',
      data: { name: 'Alice' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    storage.insert({
      $id: 'order-001',
      $type: 'Order',
      data: { total: 100 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    storage.insert({
      $id: 'product-001',
      $type: 'Product',
      data: { price: 50 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    expect(storage.count()).toBe(3)
  })

  it('should support bulk insert', () => {
    const things: Thing[] = Array.from({ length: 1000 }, (_, i) => ({
      $id: `thing-${i}`,
      $type: 'Item',
      data: { index: i },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }))

    storage.insertMany(things)
    expect(storage.count()).toBe(1000)
  })
})

// ============================================================================
// Flush Operations Tests (Column-per-Row Storage)
// ============================================================================

describe('Columnar Storage - Flush (Column-per-Row)', () => {
  let storage: ColumnarStorage

  beforeEach(() => {
    storage = createColumnarStorage()
  })

  it('should flush records as columnar rows', () => {
    for (let i = 0; i < 100; i++) {
      storage.insert({
        $id: `thing-${i}`,
        $type: 'Customer',
        data: { name: `User ${i}`, email: `user${i}@test.com` },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }

    const rows = storage.flush()

    // Should produce columnar rows, not 100 individual rows
    // Expected: _ids, _types, data, _timestamps, _meta (5-10 rows max)
    expect(rows.length).toBeLessThan(20)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('should store IDs as single row', () => {
    for (let i = 0; i < 1000; i++) {
      storage.insert({
        $id: `thing-${i}`,
        $type: 'Item',
        data: { value: i },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }

    const rows = storage.flush()
    const idsRow = rows.find((r) => r.key === '_ids')

    expect(idsRow).toBeDefined()
    expect(idsRow!.key).toBe('_ids')
    // IDs should be JSON array
    const ids = JSON.parse(idsRow!.value as string)
    expect(ids).toHaveLength(1000)
  })

  it('should store types as single row', () => {
    storage.insert({
      $id: 'c1',
      $type: 'Customer',
      data: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    storage.insert({
      $id: 'o1',
      $type: 'Order',
      data: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const rows = storage.flush()
    const typesRow = rows.find((r) => r.key === '_types')

    expect(typesRow).toBeDefined()
    const types = JSON.parse(typesRow!.value as string)
    expect(types).toEqual(['Customer', 'Order'])
  })

  it('should store embeddings as binary packed row', () => {
    for (let i = 0; i < 100; i++) {
      const embedding = new Array(1536).fill(0).map((_, j) => (i * 1536 + j) * 0.001)
      storage.insert({
        $id: `doc-${i}`,
        $type: 'Document',
        data: { title: `Doc ${i}` },
        embedding,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }

    const rows = storage.flush()
    const embeddingsRow = rows.find((r) => r.key === '_embeddings')

    expect(embeddingsRow).toBeDefined()
    // Should be binary (ArrayBuffer or Uint8Array), not JSON
    expect(embeddingsRow!.value instanceof ArrayBuffer || embeddingsRow!.value instanceof Uint8Array).toBe(true)
  })

  it('should store timestamps as single row', () => {
    const now = Date.now()
    storage.insert({
      $id: 'thing-001',
      $type: 'Item',
      data: {},
      createdAt: now - 1000,
      updatedAt: now,
    })

    const rows = storage.flush()
    const timestampsRow = rows.find((r) => r.key === '_timestamps')

    expect(timestampsRow).toBeDefined()
    const timestamps = JSON.parse(timestampsRow!.value as string)
    expect(timestamps.createdAt).toBeDefined()
    expect(timestamps.updatedAt).toBeDefined()
  })

  it('should store metadata row with count and dimensions', () => {
    for (let i = 0; i < 500; i++) {
      storage.insert({
        $id: `thing-${i}`,
        $type: 'Item',
        data: { value: i },
        embedding: new Array(768).fill(0.5),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }

    const rows = storage.flush()
    const metaRow = rows.find((r) => r.key === '_meta')

    expect(metaRow).toBeDefined()
    const meta = JSON.parse(metaRow!.value as string)
    expect(meta.count).toBe(500)
    expect(meta.embeddingDim).toBe(768)
  })

  it('should achieve 99%+ write savings for 10K records', () => {
    for (let i = 0; i < 10000; i++) {
      storage.insert({
        $id: `thing-${i}`,
        $type: 'Item',
        data: { name: `Item ${i}`, value: i },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }

    const rows = storage.flush()

    // Row-per-record would be 10,000 rows
    // Columnar should be <100 rows (99%+ savings)
    expect(rows.length).toBeLessThan(100)

    const savingsPercent = (1 - rows.length / 10000) * 100
    expect(savingsPercent).toBeGreaterThan(99)
  })
})

// ============================================================================
// Query Operations Tests (Projection Pushdown)
// ============================================================================

describe('Columnar Storage - Query (Projection Pushdown)', () => {
  let storage: ColumnarStorage

  beforeEach(() => {
    storage = createColumnarStorage()

    // Insert test data
    for (let i = 0; i < 1000; i++) {
      storage.insert({
        $id: `thing-${i}`,
        $type: i % 2 === 0 ? 'Customer' : 'Order',
        data: {
          name: `Item ${i}`,
          email: `user${i}@test.com`,
          amount: i * 10,
        },
        createdAt: Date.now() - i * 1000,
        updatedAt: Date.now(),
      })
    }
    storage.flush()
  })

  it('should support projection pushdown for single column', () => {
    const results = storage.query({
      select: ['data.name'],
    })

    expect(results.length).toBe(1000)
    // Each result should only have the projected column
    expect(results[0]).toHaveProperty('data.name')
  })

  it('should load only requested columns', () => {
    // Clear in-memory cache to force reload
    storage.clearCache()

    const statsBefore = storage.getStats()
    const readsBefore = statsBefore.columnsRead

    storage.query({
      select: ['data.email'],
    })

    const statsAfter = storage.getStats()

    // Should only read _ids + data column (2 reads), not all columns
    expect(statsAfter.columnsRead - readsBefore).toBeLessThanOrEqual(3)
  })

  it('should support filtering by type', () => {
    const results = storage.query({
      select: ['$id', 'data.name'],
      where: { $type: 'Customer' },
    })

    expect(results.length).toBe(500) // Half are Customers
    results.forEach((r) => {
      expect(r.$type).toBe('Customer')
    })
  })

  it('should support filtering with predicates', () => {
    const results = storage.query({
      select: ['$id', 'data.amount'],
      where: {
        'data.amount': { $gt: 5000 },
      },
    })

    expect(results.length).toBeLessThan(1000)
    results.forEach((r) => {
      expect(r.data.amount).toBeGreaterThan(5000)
    })
  })

  it('should support limit and offset', () => {
    const results = storage.query({
      select: ['$id'],
      limit: 10,
      offset: 100,
    })

    expect(results.length).toBe(10)
  })

  it('should support ordering', () => {
    const results = storage.query({
      select: ['$id', 'data.amount'],
      orderBy: [{ column: 'data.amount', direction: 'desc' }],
      limit: 5,
    })

    expect(results.length).toBe(5)
    // Results should be in descending order by amount
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].data.amount).toBeGreaterThanOrEqual(results[i].data.amount)
    }
  })
})

// ============================================================================
// Get Operations Tests
// ============================================================================

describe('Columnar Storage - Get by ID', () => {
  let storage: ColumnarStorage

  beforeEach(() => {
    storage = createColumnarStorage()

    for (let i = 0; i < 100; i++) {
      storage.insert({
        $id: `thing-${i}`,
        $type: 'Item',
        data: { name: `Item ${i}`, value: i },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
    storage.flush()
  })

  it('should get single record by ID', () => {
    const result = storage.get('thing-50')

    expect(result).not.toBeNull()
    expect(result!.$id).toBe('thing-50')
    expect(result!.data.name).toBe('Item 50')
  })

  it('should get record with projection', () => {
    const result = storage.get('thing-50', ['data.name'])

    expect(result).not.toBeNull()
    expect(result!.data.name).toBe('Item 50')
    // Should not include unprojected fields
    expect(result!.data.value).toBeUndefined()
  })

  it('should return null for non-existent ID', () => {
    const result = storage.get('non-existent-id')
    expect(result).toBeNull()
  })

  it('should support batch get', () => {
    const results = storage.getMany(['thing-10', 'thing-20', 'thing-30'])

    expect(results.length).toBe(3)
    expect(results[0].$id).toBe('thing-10')
    expect(results[1].$id).toBe('thing-20')
    expect(results[2].$id).toBe('thing-30')
  })
})

// ============================================================================
// Aggregation Tests
// ============================================================================

describe('Columnar Storage - Aggregations', () => {
  let storage: ColumnarStorage

  beforeEach(() => {
    storage = createColumnarStorage()

    for (let i = 1; i <= 100; i++) {
      storage.insert({
        $id: `thing-${i}`,
        $type: i % 3 === 0 ? 'TypeA' : i % 3 === 1 ? 'TypeB' : 'TypeC',
        data: { amount: i },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
    storage.flush()
  })

  it('should compute count without loading all data', () => {
    storage.clearCache()
    const statsBefore = storage.getStats()

    const count = storage.count()

    expect(count).toBe(100)
    // Should read at most 1-2 columns (meta or ids)
    const statsAfter = storage.getStats()
    expect(statsAfter.columnsRead - statsBefore.columnsRead).toBeLessThanOrEqual(2)
  })

  it('should compute sum on numeric column', () => {
    const sum = storage.aggregate('data.amount', 'sum')
    expect(sum).toBe(5050) // Sum of 1 to 100
  })

  it('should compute avg on numeric column', () => {
    const avg = storage.aggregate('data.amount', 'avg')
    expect(avg).toBeCloseTo(50.5, 1)
  })

  it('should compute min on numeric column', () => {
    const min = storage.aggregate('data.amount', 'min')
    expect(min).toBe(1)
  })

  it('should compute max on numeric column', () => {
    const max = storage.aggregate('data.amount', 'max')
    expect(max).toBe(100)
  })

  it('should support filtered aggregations', () => {
    const sum = storage.aggregate('data.amount', 'sum', {
      where: { $type: 'TypeA' },
    })

    // TypeA includes items where i % 3 === 0 (3, 6, 9, ..., 99)
    const expected = Array.from({ length: 33 }, (_, i) => (i + 1) * 3).reduce((a, b) => a + b, 0)
    expect(sum).toBe(expected)
  })

  it('should support group by aggregations', () => {
    const results = storage.aggregate('data.amount', 'sum', {
      groupBy: ['$type'],
    })

    expect(results).toHaveLength(3) // TypeA, TypeB, TypeC
    expect(results.find((r) => r.$type === 'TypeA')).toBeDefined()
    expect(results.find((r) => r.$type === 'TypeB')).toBeDefined()
    expect(results.find((r) => r.$type === 'TypeC')).toBeDefined()
  })
})

// ============================================================================
// Statistics Tests
// ============================================================================

describe('Columnar Storage - Statistics', () => {
  it('should track read/write operations', () => {
    const storage = createColumnarStorage()

    for (let i = 0; i < 100; i++) {
      storage.insert({
        $id: `thing-${i}`,
        $type: 'Item',
        data: { value: i },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
    storage.flush()

    const stats = storage.getStats()

    expect(stats.recordCount).toBe(100)
    expect(stats.columnCount).toBeGreaterThan(0)
    expect(stats.bytesStored).toBeGreaterThan(0)
    expect(stats.writeCount).toBeGreaterThan(0)
  })

  it('should report column metadata', () => {
    const storage = createColumnarStorage()

    storage.insert({
      $id: 'thing-001',
      $type: 'Item',
      data: { name: 'Test', value: 100 },
      embedding: new Array(1536).fill(0.5),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    storage.flush()

    const metadata = storage.getColumnMetadata()

    expect(metadata).toHaveProperty('_ids')
    expect(metadata).toHaveProperty('_types')
    expect(metadata).toHaveProperty('_embeddings')
    expect(metadata._embeddings.type).toBe('binary')
    expect(metadata._embeddings.dimensions).toBe(1536)
  })

  it('should calculate storage savings percentage', () => {
    const storage = createColumnarStorage()

    for (let i = 0; i < 10000; i++) {
      storage.insert({
        $id: `thing-${i}`,
        $type: 'Item',
        data: { name: `Item ${i}` },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
    storage.flush()

    const stats = storage.getStats()

    expect(stats.savingsPercent).toBeGreaterThan(99)
    expect(stats.traditionalRowCount).toBe(10000)
    expect(stats.columnarRowCount).toBeLessThan(100)
  })
})

// ============================================================================
// SQL Integration Tests
// ============================================================================

describe('Columnar Storage - SQL Integration', () => {
  it('should generate CREATE TABLE SQL', () => {
    const sql = createColumnarStorage.createTableSQL('things_columnar')

    expect(sql).toContain('CREATE TABLE')
    expect(sql).toContain('things_columnar')
    expect(sql).toContain('column_name')
    expect(sql).toContain('column_data')
    expect(sql).toContain('PRIMARY KEY')
  })

  it('should generate INSERT SQL for columnar rows', () => {
    const storage = createColumnarStorage()

    storage.insert({
      $id: 'thing-001',
      $type: 'Item',
      data: { value: 1 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const sql = storage.toInsertSQL('things_columnar')

    expect(sql.statements.length).toBeGreaterThan(0)
    expect(sql.statements[0]).toContain('INSERT')
    expect(sql.statements[0]).toContain('things_columnar')
  })

  it('should bind to real SQLite storage interface', async () => {
    // This test verifies integration with DO SQLite
    // @ts-expect-error - SqlStorage not yet imported
    const storage = createColumnarStorage({ sqlStorage: mockSqlStorage })

    expect(storage).toBeDefined()
    // Should be able to persist and restore
    expect(typeof storage.persist).toBe('function')
    expect(typeof storage.restore).toBe('function')
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Columnar Storage - Edge Cases', () => {
  it('should handle empty storage', () => {
    const storage = createColumnarStorage()

    expect(storage.count()).toBe(0)
    expect(storage.query({ select: ['$id'] })).toEqual([])
    expect(storage.get('non-existent')).toBeNull()
  })

  it('should handle null values in data', () => {
    const storage = createColumnarStorage()

    storage.insert({
      $id: 'thing-001',
      $type: 'Item',
      data: { name: null, value: undefined },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    storage.flush()

    const result = storage.get('thing-001')
    expect(result).not.toBeNull()
    expect(result!.data.name).toBeNull()
  })

  it('should handle deeply nested data', () => {
    const storage = createColumnarStorage()

    storage.insert({
      $id: 'thing-001',
      $type: 'Item',
      data: {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    storage.flush()

    const result = storage.get('thing-001')
    expect(result!.data.level1.level2.level3.value).toBe('deep')
  })

  it('should handle special characters in data', () => {
    const storage = createColumnarStorage()

    storage.insert({
      $id: 'thing-001',
      $type: 'Item',
      data: {
        text: 'Contains "quotes" and \\backslashes',
        unicode: '\u0000\u001f',
        newlines: 'line1\nline2',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    storage.flush()

    const result = storage.get('thing-001')
    expect(result!.data.text).toBe('Contains "quotes" and \\backslashes')
  })

  it('should handle large embeddings', () => {
    const storage = createColumnarStorage({ embeddingDimensions: 4096 })

    const largeEmbedding = new Array(4096).fill(0).map((_, i) => Math.random())

    storage.insert({
      $id: 'thing-001',
      $type: 'Document',
      data: { title: 'Test' },
      embedding: largeEmbedding,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    storage.flush()

    const result = storage.get('thing-001')
    expect(result!.embedding).toHaveLength(4096)
  })

  it('should handle concurrent inserts', async () => {
    const storage = createColumnarStorage()

    const promises = Array.from({ length: 100 }, (_, i) =>
      Promise.resolve().then(() =>
        storage.insert({
          $id: `thing-${i}`,
          $type: 'Item',
          data: { value: i },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
      )
    )

    await Promise.all(promises)
    expect(storage.count()).toBe(100)
  })
})

// ============================================================================
// Cost Analysis Tests
// ============================================================================

describe('Columnar Storage - Cost Analysis', () => {
  it('should provide write cost comparison', () => {
    const analysis = createColumnarStorage.costAnalysis({
      recordCount: 100000,
      avgRecordSizeBytes: 500,
    })

    expect(analysis.traditional.rowWrites).toBe(100000)
    expect(analysis.columnar.rowWrites).toBeLessThan(100)
    expect(analysis.savingsPercent).toBeGreaterThan(99)
    expect(analysis.costSavings).toBeDefined()
  })

  it('should provide read cost comparison for different query types', () => {
    const analysis = createColumnarStorage.queryCostAnalysis({
      recordCount: 100000,
      queryType: 'single-column',
    })

    expect(analysis.traditional.rowsRead).toBe(100000)
    expect(analysis.columnar.rowsRead).toBeLessThanOrEqual(3)
    expect(analysis.savingsPercent).toBeGreaterThan(99)
  })

  it('should estimate costs for COUNT query', () => {
    const analysis = createColumnarStorage.queryCostAnalysis({
      recordCount: 1000000,
      queryType: 'count',
    })

    // COUNT should read 1 row (metadata) instead of 1M
    expect(analysis.columnar.rowsRead).toBe(1)
    expect(analysis.savingsPercent).toBeCloseTo(100, 2)
  })

  it('should estimate costs for aggregation query', () => {
    const analysis = createColumnarStorage.queryCostAnalysis({
      recordCount: 1000000,
      queryType: 'sum',
      column: 'data.amount',
    })

    // SUM should read 1 column row instead of 1M record rows
    expect(analysis.columnar.rowsRead).toBeLessThanOrEqual(2)
    expect(analysis.savingsPercent).toBeGreaterThan(99)
  })
})
