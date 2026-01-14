/**
 * Cross-DO Query Layer Tests (RED Phase - TDD)
 *
 * Tests for DuckDB querying across all Durable Object states stored in Iceberg.
 * This enables analytics, debugging, and administrative capabilities across the DO fleet.
 *
 * Features:
 * - Query single DO state by ID
 * - Query across all DOs (wildcard)
 * - Query with predicates and filters
 * - Time-travel queries to historical snapshots
 *
 * RED PHASE: All tests should FAIL initially because CrossDOQuery doesn't exist.
 * GREEN PHASE: Implement CrossDOQuery to make tests pass.
 * REFACTOR: Optimize implementation.
 *
 * @module db/do-analytics/__tests__/cross-do-query.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Iceberg snapshot manifest stored in R2
 */
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

/**
 * Query result from CrossDOQuery
 */
interface QueryResult<T = Record<string, unknown>> {
  rows: T[]
  columns: Array<{ name: string; type: string }>
  stats: {
    dosScanned: number
    filesScanned: number
    bytesScanned: number
    executionTimeMs: number
  }
}

/**
 * Query options for cross-DO queries
 */
interface CrossDOQueryOptions {
  /** Query specific DO by ID (optional - if omitted, queries all DOs) */
  doId?: string
  /** Table name to query */
  table: string
  /** Optional WHERE clause predicates */
  where?: Record<string, unknown>
  /** Optional columns to select (default: all) */
  columns?: string[]
  /** Optional ORDER BY */
  orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>
  /** Optional LIMIT */
  limit?: number
  /** Optional snapshot ID for time-travel */
  snapshotId?: string
}

/**
 * Mock R2 bucket interface
 */
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

/**
 * Create a mock R2 bucket for testing
 */
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

/**
 * Create sample Parquet data (JSON-based for test compatibility)
 */
function createSampleParquet(rows: Record<string, unknown>[]): ArrayBuffer {
  const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31]) // "PAR1"
  const jsonData = JSON.stringify(rows)
  const jsonBytes = new TextEncoder().encode(jsonData)

  const buffer = new ArrayBuffer(PARQUET_MAGIC.length * 2 + jsonBytes.length)
  const view = new Uint8Array(buffer)

  view.set(PARQUET_MAGIC, 0)
  view.set(jsonBytes, PARQUET_MAGIC.length)
  view.set(PARQUET_MAGIC, PARQUET_MAGIC.length + jsonBytes.length)

  return buffer
}

/**
 * Create sample Iceberg manifest
 */
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

/**
 * Parse simple CREATE TABLE schema into field definitions
 */
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

/**
 * Setup test data in mock R2 for a DO
 */
async function setupDOData(
  bucket: MockR2Bucket,
  doId: string,
  snapshotId: string,
  tables: Array<{ name: string; schema: string; rows: Record<string, unknown>[] }>
): Promise<void> {
  // Create and store manifest
  const manifest = createSampleManifest(
    doId,
    snapshotId,
    tables.map(t => ({ name: t.name, rowCount: t.rows.length, schema: t.schema }))
  )
  await bucket.put(`do/${doId}/metadata/${snapshotId}.json`, JSON.stringify(manifest))
  await bucket.put(`do/${doId}/metadata/current.json`, JSON.stringify({ currentSnapshotId: snapshotId }))

  // Create and store Parquet files
  for (const table of tables) {
    const parquet = createSampleParquet(table.rows)
    await bucket.put(`do/${doId}/data/${table.name}/${snapshotId}.parquet`, parquet)
  }
}

// =============================================================================
// Import the module under test (will fail in RED phase)
// =============================================================================

// This import will FAIL because the module doesn't exist yet
// When implementing, create: db/do-analytics/cross-do-query.ts
import { CrossDOQuery } from '../cross-do-query'

// =============================================================================
// Test Suite
// =============================================================================

describe('CrossDOQuery', () => {
  let bucket: MockR2Bucket
  let query: CrossDOQuery

  beforeEach(() => {
    vi.clearAllMocks()
    bucket = createMockR2Bucket()
    query = new CrossDOQuery(bucket)
  })

  // ---------------------------------------------------------------------------
  // Test 1: Query single DO state
  // ---------------------------------------------------------------------------
  describe('query single DO state', () => {
    it('returns rows from a single DO', async () => {
      // Setup test data
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, customer_id INT, amount DECIMAL)',
        rows: [
          { id: 1, customer_id: 100, amount: 99.99 },
          { id: 2, customer_id: 101, amount: 149.50 }
        ]
      }])

      // Query single DO
      const result = await query.execute({
        doId: 'do-123',
        table: 'orders'
      })

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0]).toMatchObject({ id: 1, customer_id: 100 })
      expect(result.rows[1]).toMatchObject({ id: 2, customer_id: 101 })
    })

    it('returns correct columns metadata', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'users',
        schema: 'CREATE TABLE users (id INT, name TEXT, email TEXT)',
        rows: [{ id: 1, name: 'Alice', email: 'alice@example.com' }]
      }])

      const result = await query.execute({
        doId: 'do-123',
        table: 'users'
      })

      expect(result.columns).toContainEqual({ name: 'id', type: expect.any(String) })
      expect(result.columns).toContainEqual({ name: 'name', type: expect.any(String) })
      expect(result.columns).toContainEqual({ name: 'email', type: expect.any(String) })
    })

    it('returns query stats', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT)',
        rows: [{ id: 1 }]
      }])

      const result = await query.execute({
        doId: 'do-123',
        table: 'orders'
      })

      expect(result.stats).toBeDefined()
      expect(result.stats.dosScanned).toBe(1)
      expect(result.stats.filesScanned).toBeGreaterThanOrEqual(1)
      expect(result.stats.bytesScanned).toBeGreaterThan(0)
      expect(result.stats.executionTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('throws error for non-existent DO', async () => {
      await expect(
        query.execute({ doId: 'non-existent', table: 'orders' })
      ).rejects.toThrow(/not found|does not exist/i)
    })

    it('throws error for non-existent table', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT)',
        rows: []
      }])

      await expect(
        query.execute({ doId: 'do-123', table: 'non_existent_table' })
      ).rejects.toThrow(/table.*not found/i)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 2: Query across all DOs (wildcard)
  // ---------------------------------------------------------------------------
  describe('query across all DOs', () => {
    it('returns rows from multiple DOs', async () => {
      // Setup test data for 3 DOs
      await setupDOData(bucket, 'do-1', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 1, amount: 100 }]
      }])
      await setupDOData(bucket, 'do-2', 'snap-2', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 2, amount: 200 }, { id: 3, amount: 300 }]
      }])
      await setupDOData(bucket, 'do-3', 'snap-3', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 4, amount: 400 }]
      }])

      // Query all DOs (no doId specified)
      const result = await query.execute({ table: 'orders' })

      expect(result.rows).toHaveLength(4)
      expect(result.stats.dosScanned).toBe(3)
    })

    it('includes do_id column in cross-DO queries', async () => {
      await setupDOData(bucket, 'do-1', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT)',
        rows: [{ id: 1 }]
      }])
      await setupDOData(bucket, 'do-2', 'snap-2', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT)',
        rows: [{ id: 2 }]
      }])

      const result = await query.execute({ table: 'orders' })

      // Each row should include the source DO ID
      expect(result.rows[0]).toHaveProperty('_do_id')
      const doIds = result.rows.map((r: Record<string, unknown>) => r._do_id)
      expect(doIds).toContain('do-1')
      expect(doIds).toContain('do-2')
    })

    it('handles DOs with different schemas gracefully', async () => {
      await setupDOData(bucket, 'do-1', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 1, amount: 100 }]
      }])
      await setupDOData(bucket, 'do-2', 'snap-2', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL, status TEXT)',
        rows: [{ id: 2, amount: 200, status: 'complete' }]
      }])

      const result = await query.execute({ table: 'orders' })

      expect(result.rows).toHaveLength(2)
      // Schema should be union of all columns
      const columnNames = result.columns.map(c => c.name)
      expect(columnNames).toContain('id')
      expect(columnNames).toContain('amount')
      expect(columnNames).toContain('status')
    })

    it('skips DOs without the requested table', async () => {
      await setupDOData(bucket, 'do-1', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT)',
        rows: [{ id: 1 }]
      }])
      await setupDOData(bucket, 'do-2', 'snap-2', [{
        name: 'users', // different table
        schema: 'CREATE TABLE users (id INT)',
        rows: [{ id: 2 }]
      }])

      const result = await query.execute({ table: 'orders' })

      expect(result.rows).toHaveLength(1)
      expect(result.stats.dosScanned).toBe(1) // only do-1 was actually scanned
    })

    it('handles empty result set across all DOs', async () => {
      await setupDOData(bucket, 'do-1', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT)',
        rows: []
      }])
      await setupDOData(bucket, 'do-2', 'snap-2', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT)',
        rows: []
      }])

      const result = await query.execute({ table: 'orders' })

      expect(result.rows).toHaveLength(0)
      expect(result.stats.dosScanned).toBe(2)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 3: Query with filters (WHERE clause)
  // ---------------------------------------------------------------------------
  describe('query with filters', () => {
    it('filters with equality predicate', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, status TEXT)',
        rows: [
          { id: 1, status: 'pending' },
          { id: 2, status: 'complete' },
          { id: 3, status: 'pending' }
        ]
      }])

      const result = await query.execute({
        doId: 'do-123',
        table: 'orders',
        where: { status: 'pending' }
      })

      expect(result.rows).toHaveLength(2)
      result.rows.forEach((row: Record<string, unknown>) => {
        expect(row.status).toBe('pending')
      })
    })

    it('filters with comparison predicate', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [
          { id: 1, amount: 50 },
          { id: 2, amount: 150 },
          { id: 3, amount: 250 }
        ]
      }])

      const result = await query.execute({
        doId: 'do-123',
        table: 'orders',
        where: { amount: { $gt: 100 } }
      })

      expect(result.rows).toHaveLength(2)
      result.rows.forEach((row: Record<string, unknown>) => {
        expect(row.amount).toBeGreaterThan(100)
      })
    })

    it('filters with multiple predicates (AND)', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, status TEXT, amount DECIMAL)',
        rows: [
          { id: 1, status: 'complete', amount: 50 },
          { id: 2, status: 'complete', amount: 150 },
          { id: 3, status: 'pending', amount: 150 }
        ]
      }])

      const result = await query.execute({
        doId: 'do-123',
        table: 'orders',
        where: { status: 'complete', amount: { $gt: 100 } }
      })

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({ id: 2, status: 'complete', amount: 150 })
    })

    it('filters with IN predicate', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, status TEXT)',
        rows: [
          { id: 1, status: 'pending' },
          { id: 2, status: 'complete' },
          { id: 3, status: 'cancelled' }
        ]
      }])

      const result = await query.execute({
        doId: 'do-123',
        table: 'orders',
        where: { status: { $in: ['pending', 'complete'] } }
      })

      expect(result.rows).toHaveLength(2)
    })

    it('applies filters across all DOs', async () => {
      await setupDOData(bucket, 'do-1', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 1, amount: 50 }, { id: 2, amount: 150 }]
      }])
      await setupDOData(bucket, 'do-2', 'snap-2', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 3, amount: 250 }]
      }])

      const result = await query.execute({
        table: 'orders',
        where: { amount: { $gte: 100 } }
      })

      expect(result.rows).toHaveLength(2)
      result.rows.forEach((row: Record<string, unknown>) => {
        expect(row.amount).toBeGreaterThanOrEqual(100)
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Test 4: Column projection
  // ---------------------------------------------------------------------------
  describe('column projection', () => {
    it('selects only specified columns', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'users',
        schema: 'CREATE TABLE users (id INT, name TEXT, email TEXT, password TEXT)',
        rows: [{ id: 1, name: 'Alice', email: 'alice@example.com', password: 'secret' }]
      }])

      const result = await query.execute({
        doId: 'do-123',
        table: 'users',
        columns: ['id', 'name']
      })

      expect(result.rows[0]).toHaveProperty('id')
      expect(result.rows[0]).toHaveProperty('name')
      expect(result.rows[0]).not.toHaveProperty('email')
      expect(result.rows[0]).not.toHaveProperty('password')
    })

    it('returns only specified columns in metadata', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'users',
        schema: 'CREATE TABLE users (id INT, name TEXT, email TEXT)',
        rows: [{ id: 1, name: 'Alice', email: 'alice@example.com' }]
      }])

      const result = await query.execute({
        doId: 'do-123',
        table: 'users',
        columns: ['id', 'email']
      })

      const columnNames = result.columns.map(c => c.name)
      expect(columnNames).toContain('id')
      expect(columnNames).toContain('email')
      expect(columnNames).not.toContain('name')
    })
  })

  // ---------------------------------------------------------------------------
  // Test 5: Ordering and limits
  // ---------------------------------------------------------------------------
  describe('ordering and limits', () => {
    it('orders results by column ascending', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [
          { id: 1, amount: 300 },
          { id: 2, amount: 100 },
          { id: 3, amount: 200 }
        ]
      }])

      const result = await query.execute({
        doId: 'do-123',
        table: 'orders',
        orderBy: [{ column: 'amount', direction: 'asc' }]
      })

      expect(result.rows[0].amount).toBe(100)
      expect(result.rows[1].amount).toBe(200)
      expect(result.rows[2].amount).toBe(300)
    })

    it('orders results by column descending', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [
          { id: 1, amount: 100 },
          { id: 2, amount: 300 },
          { id: 3, amount: 200 }
        ]
      }])

      const result = await query.execute({
        doId: 'do-123',
        table: 'orders',
        orderBy: [{ column: 'amount', direction: 'desc' }]
      })

      expect(result.rows[0].amount).toBe(300)
      expect(result.rows[1].amount).toBe(200)
      expect(result.rows[2].amount).toBe(100)
    })

    it('limits results', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT)',
        rows: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }))
      }])

      const result = await query.execute({
        doId: 'do-123',
        table: 'orders',
        limit: 10
      })

      expect(result.rows).toHaveLength(10)
    })

    it('combines order and limit', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [
          { id: 1, amount: 100 },
          { id: 2, amount: 500 },
          { id: 3, amount: 300 },
          { id: 4, amount: 200 },
          { id: 5, amount: 400 }
        ]
      }])

      const result = await query.execute({
        doId: 'do-123',
        table: 'orders',
        orderBy: [{ column: 'amount', direction: 'desc' }],
        limit: 3
      })

      expect(result.rows).toHaveLength(3)
      expect(result.rows[0].amount).toBe(500)
      expect(result.rows[1].amount).toBe(400)
      expect(result.rows[2].amount).toBe(300)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 6: Time-travel queries
  // ---------------------------------------------------------------------------
  describe('time-travel queries', () => {
    it('queries specific snapshot by ID', async () => {
      // Setup DO with multiple snapshots
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, status TEXT)',
        rows: [{ id: 1, status: 'pending' }]
      }])

      // Simulate second snapshot with updated data
      await setupDOData(bucket, 'do-123', 'snap-2', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, status TEXT)',
        rows: [{ id: 1, status: 'complete' }, { id: 2, status: 'pending' }]
      }])

      // Update current pointer
      await bucket.put(`do/do-123/metadata/current.json`, JSON.stringify({ currentSnapshotId: 'snap-2' }))

      // Query old snapshot
      const oldResult = await query.execute({
        doId: 'do-123',
        table: 'orders',
        snapshotId: 'snap-1'
      })

      expect(oldResult.rows).toHaveLength(1)
      expect(oldResult.rows[0].status).toBe('pending')

      // Query current snapshot (default)
      const currentResult = await query.execute({
        doId: 'do-123',
        table: 'orders'
      })

      expect(currentResult.rows).toHaveLength(2)
    })

    it('throws error for non-existent snapshot', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT)',
        rows: [{ id: 1 }]
      }])

      await expect(
        query.execute({
          doId: 'do-123',
          table: 'orders',
          snapshotId: 'non-existent-snapshot'
        })
      ).rejects.toThrow(/snapshot.*not found/i)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 7: Raw SQL queries
  // ---------------------------------------------------------------------------
  describe('raw SQL queries', () => {
    it('executes raw SQL against single DO', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 1, amount: 100 }, { id: 2, amount: 200 }]
      }])

      const result = await query.sql(
        'SELECT * FROM orders WHERE amount > 150',
        { doId: 'do-123' }
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].amount).toBe(200)
    })

    it('executes raw SQL across all DOs', async () => {
      await setupDOData(bucket, 'do-1', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 1, amount: 100 }]
      }])
      await setupDOData(bucket, 'do-2', 'snap-2', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT, amount DECIMAL)',
        rows: [{ id: 2, amount: 200 }]
      }])

      const result = await query.sql('SELECT SUM(amount) as total FROM orders')

      expect(result.rows[0].total).toBe(300)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 8: Error handling
  // ---------------------------------------------------------------------------
  describe('error handling', () => {
    it('handles R2 connection failure', async () => {
      bucket.list.mockRejectedValueOnce(new Error('R2 unavailable'))

      await expect(
        query.execute({ table: 'orders' })
      ).rejects.toThrow(/R2|unavailable|connection/i)
    })

    it('handles corrupted manifest gracefully', async () => {
      await bucket.put('do/do-123/metadata/current.json', JSON.stringify({ currentSnapshotId: 'snap-1' }))
      await bucket.put('do/do-123/metadata/snap-1.json', 'not valid json')

      await expect(
        query.execute({ doId: 'do-123', table: 'orders' })
      ).rejects.toThrow(/parse|invalid|corrupted/i)
    })

    it('handles corrupted Parquet file gracefully', async () => {
      await setupDOData(bucket, 'do-123', 'snap-1', [{
        name: 'orders',
        schema: 'CREATE TABLE orders (id INT)',
        rows: [{ id: 1 }]
      }])

      // Corrupt the Parquet file
      await bucket.put('do/do-123/data/orders/snap-1.parquet', 'not valid parquet')

      await expect(
        query.execute({ doId: 'do-123', table: 'orders' })
      ).rejects.toThrow(/parse|invalid|parquet/i)
    })
  })
})
