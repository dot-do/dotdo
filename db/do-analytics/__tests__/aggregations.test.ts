/**
 * Cross-DO Aggregations Tests (RED Phase - TDD)
 *
 * Tests for aggregation queries across Durable Object states stored in Iceberg.
 * Enables analytics like totals, averages, and groupings across the entire DO fleet.
 *
 * Features:
 * - COUNT, SUM, AVG, MIN, MAX aggregations
 * - GROUP BY with aggregations
 * - HAVING clause filtering
 * - Aggregations across all DOs
 *
 * RED PHASE: All tests should FAIL initially because CrossDOQuery aggregations don't exist.
 * GREEN PHASE: Implement aggregation support to make tests pass.
 * REFACTOR: Optimize implementation.
 *
 * @module db/do-analytics/__tests__/aggregations.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// =============================================================================
// Type Definitions (same as cross-do-query.test.ts)
// =============================================================================

interface IcebergManifest {
  'format-version': 2
  'table-uuid': string
  location: string
  'last-updated-ms': number
  'current-snapshot-id': string
  'parent-snapshot-id': string | null
  snapshots: SnapshotEntry[]
  schemas: SchemaEntry[]
  manifests: ManifestFileEntry[]
}

interface SnapshotEntry {
  'snapshot-id': string
  'parent-snapshot-id': string | null
  'timestamp-ms': number
  'manifest-list': string
  summary: Record<string, string>
}

interface SchemaEntry {
  'schema-id': number
  type: 'struct'
  fields: SchemaField[]
}

interface SchemaField {
  id: number
  name: string
  required: boolean
  type: string
}

interface ManifestFileEntry {
  'manifest-path': string
  'manifest-length': number
  'partition-spec-id': number
  content: 0 | 1
  'sequence-number': number
  'added-files-count': number
  'added-rows-count': number
  table: string
  schema: string
}

interface AggregationResult<T = Record<string, unknown>> {
  rows: T[]
  columns: Array<{ name: string; type: string }>
  stats: {
    dosScanned: number
    filesScanned: number
    bytesScanned: number
    executionTimeMs: number
  }
}

interface AggregationOptions {
  doId?: string
  table: string
  groupBy?: string[]
  aggregations: Array<{
    function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
    column?: string // optional for COUNT(*)
    alias: string
  }>
  where?: Record<string, unknown>
  having?: Record<string, unknown>
  orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>
  limit?: number
}

interface MockR2Bucket {
  put: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  _storage: Map<string, ArrayBuffer | string>
}

// =============================================================================
// Mock Helpers
// =============================================================================

function createMockR2Bucket(): MockR2Bucket {
  const storage = new Map<string, ArrayBuffer | string>()

  const bucket: MockR2Bucket = {
    put: vi.fn(async (key: string, body: ArrayBuffer | string) => {
      storage.set(key, body)
      return { key }
    }),
    get: vi.fn(async (key: string) => {
      const body = storage.get(key)
      if (!body) return null
      return {
        key,
        body,
        text: async () => (typeof body === 'string' ? body : new TextDecoder().decode(body)),
        json: async <T>() => JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(body)) as T,
        arrayBuffer: async () => (typeof body === 'string' ? new TextEncoder().encode(body).buffer : body),
      }
    }),
    list: vi.fn(async (options?: { prefix?: string }) => {
      const objects: { key: string }[] = []
      for (const key of storage.keys()) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          objects.push({ key })
        }
      }
      return { objects, truncated: false }
    }),
    delete: vi.fn(async (key: string) => {
      storage.delete(key)
    }),
    _storage: storage,
  }

  return bucket
}

function createSampleParquet(rows: Record<string, unknown>[]): ArrayBuffer {
  const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31])
  const jsonData = JSON.stringify(rows)
  const jsonBytes = new TextEncoder().encode(jsonData)

  const buffer = new ArrayBuffer(PARQUET_MAGIC.length * 2 + jsonBytes.length)
  const view = new Uint8Array(buffer)

  view.set(PARQUET_MAGIC, 0)
  view.set(jsonBytes, PARQUET_MAGIC.length)
  view.set(PARQUET_MAGIC, PARQUET_MAGIC.length + jsonBytes.length)

  return buffer
}

function createSampleManifest(
  doId: string,
  snapshotId: string,
  tables: Array<{ name: string; rowCount: number; schema: string }>
): IcebergManifest {
  return {
    'format-version': 2,
    'table-uuid': `uuid-${doId}`,
    location: `do/${doId}`,
    'last-updated-ms': Date.now(),
    'current-snapshot-id': snapshotId,
    'parent-snapshot-id': null,
    snapshots: [{
      'snapshot-id': snapshotId,
      'parent-snapshot-id': null,
      'timestamp-ms': Date.now(),
      'manifest-list': `do/${doId}/metadata/${snapshotId}-manifest-list.avro`,
      summary: { operation: 'append' }
    }],
    schemas: tables.map((t, i) => ({
      'schema-id': i,
      type: 'struct' as const,
      fields: parseSchemaFields(t.schema)
    })),
    manifests: tables.map(t => ({
      'manifest-path': `do/${doId}/data/${t.name}/${snapshotId}.parquet`,
      'manifest-length': 1000,
      'partition-spec-id': 0,
      content: 0 as const,
      'sequence-number': 1,
      'added-files-count': 1,
      'added-rows-count': t.rowCount,
      table: t.name,
      schema: t.schema
    }))
  }
}

function parseSchemaFields(schema: string): SchemaField[] {
  const match = schema.match(/\(([^)]+)\)/i)
  if (!match) return []

  return match[1].split(',').map((col, i) => {
    const parts = col.trim().split(/\s+/)
    return {
      id: i + 1,
      name: parts[0],
      required: col.toUpperCase().includes('NOT NULL'),
      type: mapSqlType(parts[1] || 'TEXT')
    }
  })
}

function mapSqlType(sqlType: string): string {
  const upper = sqlType.toUpperCase()
  if (upper.includes('INT')) return 'long'
  if (upper.includes('REAL') || upper.includes('FLOAT')) return 'double'
  if (upper.includes('DECIMAL')) return 'decimal'
  return 'string'
}

async function setupDOData(
  bucket: MockR2Bucket,
  doId: string,
  snapshotId: string,
  tables: Array<{ name: string; schema: string; rows: Record<string, unknown>[] }>
): Promise<void> {
  const manifest = createSampleManifest(
    doId,
    snapshotId,
    tables.map(t => ({ name: t.name, rowCount: t.rows.length, schema: t.schema }))
  )
  await bucket.put(`do/${doId}/metadata/${snapshotId}.json`, JSON.stringify(manifest))
  await bucket.put(`do/${doId}/metadata/current.json`, JSON.stringify({ currentSnapshotId: snapshotId }))

  for (const table of tables) {
    const parquet = createSampleParquet(table.rows)
    await bucket.put(`do/${doId}/data/${table.name}/${snapshotId}.parquet`, parquet)
  }
}

// =============================================================================
// Import the module under test (will fail in RED phase)
// =============================================================================

import { CrossDOQuery } from '../cross-do-query'

// =============================================================================
// Test Suite
// =============================================================================

describe('CrossDOQuery Aggregations', () => {
  let bucket: MockR2Bucket
  let query: CrossDOQuery

  beforeEach(() => {
    vi.clearAllMocks()
    bucket = createMockR2Bucket()
    query = new CrossDOQuery(bucket)
  })

  // ---------------------------------------------------------------------------
  // Test 1: COUNT aggregation
  // ---------------------------------------------------------------------------
  describe('COUNT aggregation', () => {
    it('counts all rows in a table', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, status TEXT)',
        rows: [
          { id: 1, status: 'pending' },
          { id: 2, status: 'complete' },
          { id: 3, status: 'pending' }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        aggregations: [{ function: 'COUNT', alias: 'total' }]
      })

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].total).toBe(3)
    })

    it('counts specific column (excludes nulls)', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, notes TEXT)',
        rows: [
          { id: 1, notes: 'some note' },
          { id: 2, notes: null },
          { id: 3, notes: 'another note' }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        aggregations: [{ function: 'COUNT', column: 'notes', alias: 'notes_count' }]
      })

      expect(result.rows[0].notes_count).toBe(2)
    })

    it('counts across all DOs', async () => {
      await setupDOData(bucket, 'do-1', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT)',
        rows: [{ id: 1 }, { id: 2 }]
      }])
      await setupDOData(bucket, 'do-2', 'snap-2', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT)',
        rows: [{ id: 3 }, { id: 4 }, { id: 5 }]
      }])

      const result = await query.aggregate({
        table: 'orders',
        aggregations: [{ function: 'COUNT', alias: 'total' }]
      })

      expect(result.rows[0].total).toBe(5)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 2: SUM aggregation
  // ---------------------------------------------------------------------------
  describe('SUM aggregation', () => {
    it('sums column values', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [
          { id: 1, amount: 100 },
          { id: 2, amount: 200 },
          { id: 3, amount: 300 }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        aggregations: [{ function: 'SUM', column: 'amount', alias: 'total_amount' }]
      })

      expect(result.rows[0].total_amount).toBe(600)
    })

    it('sums across all DOs', async () => {
      await setupDOData(bucket, 'do-1', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 1, amount: 100 }]
      }])
      await setupDOData(bucket, 'do-2', 'snap-2', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 2, amount: 250 }]
      }])
      await setupDOData(bucket, 'do-3', 'snap-3', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 3, amount: 150 }]
      }])

      const result = await query.aggregate({
        table: 'orders',
        aggregations: [{ function: 'SUM', column: 'amount', alias: 'total' }]
      })

      expect(result.rows[0].total).toBe(500)
    })

    it('handles null values in SUM', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [
          { id: 1, amount: 100 },
          { id: 2, amount: null },
          { id: 3, amount: 200 }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        aggregations: [{ function: 'SUM', column: 'amount', alias: 'total' }]
      })

      expect(result.rows[0].total).toBe(300)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 3: AVG aggregation
  // ---------------------------------------------------------------------------
  describe('AVG aggregation', () => {
    it('calculates average of column values', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [
          { id: 1, amount: 100 },
          { id: 2, amount: 200 },
          { id: 3, amount: 300 }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        aggregations: [{ function: 'AVG', column: 'amount', alias: 'avg_amount' }]
      })

      expect(result.rows[0].avg_amount).toBe(200)
    })

    it('calculates average across all DOs', async () => {
      await setupDOData(bucket, 'do-1', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 1, amount: 100 }, { id: 2, amount: 200 }]
      }])
      await setupDOData(bucket, 'do-2', 'snap-2', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 3, amount: 300 }, { id: 4, amount: 400 }]
      }])

      const result = await query.aggregate({
        table: 'orders',
        aggregations: [{ function: 'AVG', column: 'amount', alias: 'avg' }]
      })

      // (100 + 200 + 300 + 400) / 4 = 250
      expect(result.rows[0].avg).toBe(250)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 4: MIN/MAX aggregations
  // ---------------------------------------------------------------------------
  describe('MIN/MAX aggregations', () => {
    it('finds minimum value', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [
          { id: 1, amount: 150 },
          { id: 2, amount: 50 },
          { id: 3, amount: 200 }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        aggregations: [{ function: 'MIN', column: 'amount', alias: 'min_amount' }]
      })

      expect(result.rows[0].min_amount).toBe(50)
    })

    it('finds maximum value', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [
          { id: 1, amount: 150 },
          { id: 2, amount: 50 },
          { id: 3, amount: 200 }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        aggregations: [{ function: 'MAX', column: 'amount', alias: 'max_amount' }]
      })

      expect(result.rows[0].max_amount).toBe(200)
    })

    it('finds MIN/MAX across all DOs', async () => {
      await setupDOData(bucket, 'do-1', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 1, amount: 100 }]
      }])
      await setupDOData(bucket, 'do-2', 'snap-2', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 2, amount: 500 }]
      }])
      await setupDOData(bucket, 'do-3', 'snap-3', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 3, amount: 25 }]
      }])

      const result = await query.aggregate({
        table: 'orders',
        aggregations: [
          { function: 'MIN', column: 'amount', alias: 'min' },
          { function: 'MAX', column: 'amount', alias: 'max' }
        ]
      })

      expect(result.rows[0].min).toBe(25)
      expect(result.rows[0].max).toBe(500)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 5: GROUP BY with aggregations
  // ---------------------------------------------------------------------------
  describe('GROUP BY with aggregations', () => {
    it('groups by single column', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, status TEXT, amount DECIMAL)',
        rows: [
          { id: 1, status: 'pending', amount: 100 },
          { id: 2, status: 'complete', amount: 200 },
          { id: 3, status: 'pending', amount: 150 },
          { id: 4, status: 'complete', amount: 300 }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        groupBy: ['status'],
        aggregations: [
          { function: 'COUNT', alias: 'count' },
          { function: 'SUM', column: 'amount', alias: 'total' }
        ]
      })

      expect(result.rows).toHaveLength(2)

      const pending = result.rows.find((r: Record<string, unknown>) => r.status === 'pending')
      const complete = result.rows.find((r: Record<string, unknown>) => r.status === 'complete')

      expect(pending).toMatchObject({ count: 2, total: 250 })
      expect(complete).toMatchObject({ count: 2, total: 500 })
    })

    it('groups by multiple columns', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, region TEXT, status TEXT, amount DECIMAL)',
        rows: [
          { id: 1, region: 'US', status: 'complete', amount: 100 },
          { id: 2, region: 'US', status: 'pending', amount: 200 },
          { id: 3, region: 'EU', status: 'complete', amount: 150 },
          { id: 4, region: 'US', status: 'complete', amount: 250 }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        groupBy: ['region', 'status'],
        aggregations: [
          { function: 'COUNT', alias: 'count' },
          { function: 'SUM', column: 'amount', alias: 'total' }
        ]
      })

      expect(result.rows).toHaveLength(3)

      const usComplete = result.rows.find(
        (r: Record<string, unknown>) => r.region === 'US' && r.status === 'complete'
      )
      expect(usComplete).toMatchObject({ count: 2, total: 350 })
    })

    it('groups by DO ID across all DOs', async () => {
      await setupDOData(bucket, 'do-1', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 1, amount: 100 }, { id: 2, amount: 200 }]
      }])
      await setupDOData(bucket, 'do-2', 'snap-2', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 3, amount: 300 }]
      }])

      const result = await query.aggregate({
        table: 'orders',
        groupBy: ['_do_id'],
        aggregations: [
          { function: 'COUNT', alias: 'count' },
          { function: 'SUM', column: 'amount', alias: 'total' }
        ]
      })

      expect(result.rows).toHaveLength(2)

      const do1 = result.rows.find((r: Record<string, unknown>) => r._do_id === 'do-1')
      const do2 = result.rows.find((r: Record<string, unknown>) => r._do_id === 'do-2')

      expect(do1).toMatchObject({ count: 2, total: 300 })
      expect(do2).toMatchObject({ count: 1, total: 300 })
    })
  })

  // ---------------------------------------------------------------------------
  // Test 6: HAVING clause
  // ---------------------------------------------------------------------------
  describe('HAVING clause', () => {
    it('filters groups with HAVING', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, customer_id INT, amount DECIMAL)',
        rows: [
          { id: 1, customer_id: 1, amount: 100 },
          { id: 2, customer_id: 1, amount: 200 },
          { id: 3, customer_id: 2, amount: 50 },
          { id: 4, customer_id: 3, amount: 500 }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        groupBy: ['customer_id'],
        aggregations: [
          { function: 'SUM', column: 'amount', alias: 'total' }
        ],
        having: { total: { $gte: 200 } }
      })

      expect(result.rows).toHaveLength(2) // customer 1 (300) and customer 3 (500)
      result.rows.forEach((row: Record<string, unknown>) => {
        expect(row.total).toBeGreaterThanOrEqual(200)
      })
    })

    it('filters groups by COUNT in HAVING', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, customer_id INT)',
        rows: [
          { id: 1, customer_id: 1 },
          { id: 2, customer_id: 1 },
          { id: 3, customer_id: 2 },
          { id: 4, customer_id: 1 },
          { id: 5, customer_id: 3 }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        groupBy: ['customer_id'],
        aggregations: [{ function: 'COUNT', alias: 'order_count' }],
        having: { order_count: { $gt: 1 } }
      })

      expect(result.rows).toHaveLength(1) // only customer 1 has > 1 order
      expect(result.rows[0].customer_id).toBe(1)
      expect(result.rows[0].order_count).toBe(3)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 7: Combined aggregations with WHERE, ORDER BY, LIMIT
  // ---------------------------------------------------------------------------
  describe('combined aggregation options', () => {
    it('combines WHERE with aggregations', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, status TEXT, amount DECIMAL)',
        rows: [
          { id: 1, status: 'complete', amount: 100 },
          { id: 2, status: 'pending', amount: 200 },
          { id: 3, status: 'complete', amount: 300 },
          { id: 4, status: 'cancelled', amount: 400 }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        where: { status: 'complete' },
        aggregations: [
          { function: 'COUNT', alias: 'count' },
          { function: 'SUM', column: 'amount', alias: 'total' }
        ]
      })

      expect(result.rows[0].count).toBe(2)
      expect(result.rows[0].total).toBe(400)
    })

    it('orders aggregation results', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, region TEXT, amount DECIMAL)',
        rows: [
          { id: 1, region: 'US', amount: 100 },
          { id: 2, region: 'EU', amount: 500 },
          { id: 3, region: 'US', amount: 200 },
          { id: 4, region: 'APAC', amount: 150 }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        groupBy: ['region'],
        aggregations: [{ function: 'SUM', column: 'amount', alias: 'total' }],
        orderBy: [{ column: 'total', direction: 'desc' }]
      })

      expect(result.rows[0].region).toBe('EU')
      expect(result.rows[0].total).toBe(500)
      expect(result.rows[1].region).toBe('US')
      expect(result.rows[1].total).toBe(300)
    })

    it('limits aggregation results', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, customer_id INT, amount DECIMAL)',
        rows: [
          { id: 1, customer_id: 1, amount: 100 },
          { id: 2, customer_id: 2, amount: 500 },
          { id: 3, customer_id: 3, amount: 300 },
          { id: 4, customer_id: 4, amount: 200 },
          { id: 5, customer_id: 5, amount: 400 }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        groupBy: ['customer_id'],
        aggregations: [{ function: 'SUM', column: 'amount', alias: 'total' }],
        orderBy: [{ column: 'total', direction: 'desc' }],
        limit: 3
      })

      expect(result.rows).toHaveLength(3)
      expect(result.rows[0].total).toBe(500)
      expect(result.rows[1].total).toBe(400)
      expect(result.rows[2].total).toBe(300)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 8: Multiple aggregations in single query
  // ---------------------------------------------------------------------------
  describe('multiple aggregations', () => {
    it('computes multiple aggregations at once', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [
          { id: 1, amount: 100 },
          { id: 2, amount: 200 },
          { id: 3, amount: 300 },
          { id: 4, amount: 400 }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        aggregations: [
          { function: 'COUNT', alias: 'count' },
          { function: 'SUM', column: 'amount', alias: 'total' },
          { function: 'AVG', column: 'amount', alias: 'average' },
          { function: 'MIN', column: 'amount', alias: 'minimum' },
          { function: 'MAX', column: 'amount', alias: 'maximum' }
        ]
      })

      expect(result.rows[0]).toMatchObject({
        count: 4,
        total: 1000,
        average: 250,
        minimum: 100,
        maximum: 400
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Test 9: Empty result handling
  // ---------------------------------------------------------------------------
  describe('empty result handling', () => {
    it('handles no matching rows', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: []
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        aggregations: [
          { function: 'COUNT', alias: 'count' },
          { function: 'SUM', column: 'amount', alias: 'total' }
        ]
      })

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].count).toBe(0)
      expect(result.rows[0].total).toBeNull() // SUM of empty set is NULL
    })

    it('handles no matching groups', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, status TEXT, amount DECIMAL)',
        rows: [
          { id: 1, status: 'pending', amount: 100 }
        ]
      }])

      const result = await query.aggregate({
        doId: 'do-123',
        table: 'orders',
        where: { status: 'complete' }, // no matches
        groupBy: ['status'],
        aggregations: [{ function: 'COUNT', alias: 'count' }]
      })

      expect(result.rows).toHaveLength(0)
    })
  })
})
