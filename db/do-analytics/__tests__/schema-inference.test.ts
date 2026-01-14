/**
 * Schema Inference Tests (RED Phase - TDD)
 *
 * Tests for schema discovery and inference across Durable Object states stored in Iceberg.
 * Enables discovery of available tables, columns, and types across the DO fleet.
 *
 * Features:
 * - List all tables across DOs
 * - Get schema for a specific table
 * - Infer unified schema from multiple DOs
 * - Detect schema drift between DOs
 *
 * RED PHASE: All tests should FAIL initially because schema inference doesn't exist.
 * GREEN PHASE: Implement schema inference to make tests pass.
 * REFACTOR: Optimize implementation.
 *
 * @module db/do-analytics/__tests__/schema-inference.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// =============================================================================
// Type Definitions
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

interface MockR2Bucket {
  put: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  _storage: Map<string, ArrayBuffer | string>
}

/**
 * Table info returned by listTables
 */
interface TableInfo {
  name: string
  doCount: number
  totalRows: number
  lastUpdated: Date
}

/**
 * Column info in a table schema
 */
interface ColumnInfo {
  name: string
  type: string
  required: boolean
  nullable: boolean
  defaultValue?: unknown
}

/**
 * Unified table schema
 */
interface TableSchema {
  tableName: string
  columns: ColumnInfo[]
  primaryKey?: string[]
  doCount: number
  variants: SchemaVariant[]
}

/**
 * Schema variant found in specific DOs
 */
interface SchemaVariant {
  columns: ColumnInfo[]
  doIds: string[]
  percentage: number
}

/**
 * Schema drift detection result
 */
interface SchemaDrift {
  tableName: string
  hasDrift: boolean
  baseSchema: ColumnInfo[]
  variants: Array<{
    doId: string
    differences: Array<{
      type: 'missing_column' | 'extra_column' | 'type_mismatch' | 'nullability_change'
      column: string
      expected?: string
      actual?: string
    }>
  }>
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

function createSampleManifest(
  doId: string,
  snapshotId: string,
  tables: Array<{ name: string; rowCount: number; schema: string }>,
  timestamp?: number
): IcebergManifest {
  return {
    'format-version': 2,
    'table-uuid': `uuid-${doId}`,
    location: `do/${doId}`,
    'last-updated-ms': timestamp || Date.now(),
    'current-snapshot-id': snapshotId,
    'parent-snapshot-id': null,
    snapshots: [{
      'snapshot-id': snapshotId,
      'parent-snapshot-id': null,
      'timestamp-ms': timestamp || Date.now(),
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
  if (upper.includes('BOOL')) return 'boolean'
  if (upper.includes('DATE')) return 'date'
  if (upper.includes('TIME')) return 'timestamp'
  return 'string'
}

async function setupDOMetadata(
  bucket: MockR2Bucket,
  doId: string,
  snapshotId: string,
  tables: Array<{ name: string; rowCount: number; schema: string }>,
  timestamp?: number
): Promise<void> {
  const manifest = createSampleManifest(doId, snapshotId, tables, timestamp)
  await bucket.put(`do/${doId}/metadata/${snapshotId}.json`, JSON.stringify(manifest))
  await bucket.put(`do/${doId}/metadata/current.json`, JSON.stringify({ currentSnapshotId: snapshotId }))
}

// =============================================================================
// Import the module under test (will fail in RED phase)
// =============================================================================

import { CrossDOQuery } from '../cross-do-query'

// =============================================================================
// Test Suite
// =============================================================================

describe('CrossDOQuery Schema Inference', () => {
  let bucket: MockR2Bucket
  let query: CrossDOQuery

  beforeEach(() => {
    vi.clearAllMocks()
    bucket = createMockR2Bucket()
    query = new CrossDOQuery(bucket)
  })

  // ---------------------------------------------------------------------------
  // Test 1: List all tables across DOs
  // ---------------------------------------------------------------------------
  describe('listTables', () => {
    it('lists all unique tables across DOs', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT)' },
        { name: 'users', rowCount: 5, schema: 'CREATE TABLE users (id INT)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT)' },
        { name: 'products', rowCount: 15, schema: 'CREATE TABLE products (id INT)' }
      ])

      const tables = await query.listTables()

      expect(tables).toHaveLength(3)
      const tableNames = tables.map(t => t.name)
      expect(tableNames).toContain('orders')
      expect(tableNames).toContain('users')
      expect(tableNames).toContain('products')
    })

    it('returns DO count for each table', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT)' }
      ])
      await setupDOMetadata(bucket, 'do-3', 'snap-3', [
        { name: 'users', rowCount: 5, schema: 'CREATE TABLE users (id INT)' }
      ])

      const tables = await query.listTables()

      const orders = tables.find(t => t.name === 'orders')
      const users = tables.find(t => t.name === 'users')

      expect(orders?.doCount).toBe(2)
      expect(users?.doCount).toBe(1)
    })

    it('returns total row count for each table', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT)' }
      ])

      const tables = await query.listTables()

      const orders = tables.find(t => t.name === 'orders')
      expect(orders?.totalRows).toBe(30)
    })

    it('returns last updated timestamp', async () => {
      const now = Date.now()
      const earlier = now - 3600000 // 1 hour ago

      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT)' }
      ], earlier)
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT)' }
      ], now)

      const tables = await query.listTables()

      const orders = tables.find(t => t.name === 'orders')
      expect(orders?.lastUpdated.getTime()).toBe(now)
    })

    it('returns empty array when no DOs exist', async () => {
      const tables = await query.listTables()
      expect(tables).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 2: Get schema for specific table
  // ---------------------------------------------------------------------------
  describe('getTableSchema', () => {
    it('returns column info for a table', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'users', rowCount: 10, schema: 'CREATE TABLE users (id INT NOT NULL, name TEXT, email TEXT NOT NULL)' }
      ])

      const schema = await query.getTableSchema('users')

      expect(schema.tableName).toBe('users')
      expect(schema.columns).toHaveLength(3)

      const idCol = schema.columns.find(c => c.name === 'id')
      expect(idCol).toMatchObject({ name: 'id', type: 'long', required: true, nullable: false })

      const nameCol = schema.columns.find(c => c.name === 'name')
      expect(nameCol).toMatchObject({ name: 'name', type: 'string', required: false, nullable: true })
    })

    it('returns unified schema from multiple DOs', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT, amount DECIMAL)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT, amount DECIMAL, status TEXT)' }
      ])

      const schema = await query.getTableSchema('orders')

      expect(schema.columns).toHaveLength(3) // union of all columns
      const columnNames = schema.columns.map(c => c.name)
      expect(columnNames).toContain('id')
      expect(columnNames).toContain('amount')
      expect(columnNames).toContain('status')
    })

    it('returns DO count for the table', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT)' }
      ])
      await setupDOMetadata(bucket, 'do-3', 'snap-3', [
        { name: 'users', rowCount: 5, schema: 'CREATE TABLE users (id INT)' }
      ])

      const schema = await query.getTableSchema('orders')
      expect(schema.doCount).toBe(2)
    })

    it('throws error for non-existent table', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'users', rowCount: 10, schema: 'CREATE TABLE users (id INT)' }
      ])

      await expect(
        query.getTableSchema('non_existent_table')
      ).rejects.toThrow(/table.*not found/i)
    })

    it('returns schema variants when DOs differ', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT, amount DECIMAL)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT, amount DECIMAL)' }
      ])
      await setupDOMetadata(bucket, 'do-3', 'snap-3', [
        { name: 'orders', rowCount: 15, schema: 'CREATE TABLE orders (id INT, amount DECIMAL, status TEXT)' }
      ])

      const schema = await query.getTableSchema('orders')

      expect(schema.variants).toHaveLength(2)

      // Variant 1: 2 DOs with base schema
      const baseVariant = schema.variants.find(v => v.doIds.length === 2)
      expect(baseVariant?.columns).toHaveLength(2)

      // Variant 2: 1 DO with extended schema
      const extendedVariant = schema.variants.find(v => v.doIds.length === 1)
      expect(extendedVariant?.columns).toHaveLength(3)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 3: Get schema for specific DO
  // ---------------------------------------------------------------------------
  describe('getDOSchema', () => {
    it('returns schema for specific DO', async () => {
      await setupDOMetadata(bucket, 'do-123', 'snap-1', [
        { name: 'users', rowCount: 10, schema: 'CREATE TABLE users (id INT, name TEXT)' },
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT, amount DECIMAL)' }
      ])

      const schema = await query.getDOSchema('do-123')

      expect(schema).toHaveLength(2)
      const tableNames = schema.map(s => s.tableName)
      expect(tableNames).toContain('users')
      expect(tableNames).toContain('orders')
    })

    it('throws error for non-existent DO', async () => {
      await expect(
        query.getDOSchema('non-existent-do')
      ).rejects.toThrow(/DO.*not found/i)
    })

    it('returns column details for each table', async () => {
      await setupDOMetadata(bucket, 'do-123', 'snap-1', [
        { name: 'users', rowCount: 10, schema: 'CREATE TABLE users (id INT, name TEXT NOT NULL)' }
      ])

      const schema = await query.getDOSchema('do-123')

      const usersSchema = schema.find(s => s.tableName === 'users')
      expect(usersSchema?.columns).toHaveLength(2)

      const nameCol = usersSchema?.columns.find(c => c.name === 'name')
      expect(nameCol?.required).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 4: Detect schema drift
  // ---------------------------------------------------------------------------
  describe('detectSchemaDrift', () => {
    it('detects no drift when all DOs have same schema', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT, amount DECIMAL)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT, amount DECIMAL)' }
      ])

      const drift = await query.detectSchemaDrift('orders')

      expect(drift.hasDrift).toBe(false)
      expect(drift.variants).toHaveLength(0)
    })

    it('detects missing columns', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT, amount DECIMAL, status TEXT)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT, amount DECIMAL)' }
      ])

      const drift = await query.detectSchemaDrift('orders')

      expect(drift.hasDrift).toBe(true)
      expect(drift.variants).toHaveLength(1)

      const do2Drift = drift.variants.find(v => v.doId === 'do-2')
      expect(do2Drift?.differences).toContainEqual({
        type: 'missing_column',
        column: 'status',
        expected: 'string'
      })
    })

    it('detects extra columns', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT, amount DECIMAL)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT, amount DECIMAL, notes TEXT)' }
      ])

      const drift = await query.detectSchemaDrift('orders')

      expect(drift.hasDrift).toBe(true)

      const do2Drift = drift.variants.find(v => v.doId === 'do-2')
      expect(do2Drift?.differences).toContainEqual({
        type: 'extra_column',
        column: 'notes',
        actual: 'string'
      })
    })

    it('detects type mismatches', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT, amount INT)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT, amount DECIMAL)' }
      ])

      const drift = await query.detectSchemaDrift('orders')

      expect(drift.hasDrift).toBe(true)

      const do2Drift = drift.variants.find(v => v.doId === 'do-2')
      expect(do2Drift?.differences).toContainEqual({
        type: 'type_mismatch',
        column: 'amount',
        expected: 'long',
        actual: 'decimal'
      })
    })

    it('detects nullability changes', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT NOT NULL, amount DECIMAL)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT, amount DECIMAL)' }
      ])

      const drift = await query.detectSchemaDrift('orders')

      expect(drift.hasDrift).toBe(true)

      const do2Drift = drift.variants.find(v => v.doId === 'do-2')
      expect(do2Drift?.differences).toContainEqual({
        type: 'nullability_change',
        column: 'id',
        expected: 'NOT NULL',
        actual: 'NULL'
      })
    })

    it('uses most common schema as base', async () => {
      // 3 DOs with schema A, 1 DO with schema B
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT, amount DECIMAL)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT, amount DECIMAL)' }
      ])
      await setupDOMetadata(bucket, 'do-3', 'snap-3', [
        { name: 'orders', rowCount: 15, schema: 'CREATE TABLE orders (id INT, amount DECIMAL)' }
      ])
      await setupDOMetadata(bucket, 'do-4', 'snap-4', [
        { name: 'orders', rowCount: 5, schema: 'CREATE TABLE orders (id INT, amount DECIMAL, status TEXT)' }
      ])

      const drift = await query.detectSchemaDrift('orders')

      // Base schema should be the one from do-1, do-2, do-3
      expect(drift.baseSchema).toHaveLength(2)
      expect(drift.baseSchema.map(c => c.name)).toContain('id')
      expect(drift.baseSchema.map(c => c.name)).toContain('amount')

      // Only do-4 should have drift
      expect(drift.variants).toHaveLength(1)
      expect(drift.variants[0].doId).toBe('do-4')
    })

    it('throws error for non-existent table', async () => {
      await expect(
        query.detectSchemaDrift('non_existent_table')
      ).rejects.toThrow(/table.*not found/i)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 5: List DOs with specific table
  // ---------------------------------------------------------------------------
  describe('listDOsWithTable', () => {
    it('lists all DOs containing a specific table', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT)' }
      ])
      await setupDOMetadata(bucket, 'do-3', 'snap-3', [
        { name: 'users', rowCount: 5, schema: 'CREATE TABLE users (id INT)' }
      ])

      const doIds = await query.listDOsWithTable('orders')

      expect(doIds).toHaveLength(2)
      expect(doIds).toContain('do-1')
      expect(doIds).toContain('do-2')
      expect(doIds).not.toContain('do-3')
    })

    it('returns empty array when no DOs have the table', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'users', rowCount: 10, schema: 'CREATE TABLE users (id INT)' }
      ])

      const doIds = await query.listDOsWithTable('orders')

      expect(doIds).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 6: Compare schemas between two DOs
  // ---------------------------------------------------------------------------
  describe('compareSchemas', () => {
    it('returns differences between two DOs for a table', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT, amount DECIMAL, status TEXT)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT, total DECIMAL)' }
      ])

      const diff = await query.compareSchemas('orders', 'do-1', 'do-2')

      // Columns in do-1 but not do-2
      expect(diff.onlyInFirst).toContainEqual(expect.objectContaining({ name: 'amount' }))
      expect(diff.onlyInFirst).toContainEqual(expect.objectContaining({ name: 'status' }))

      // Columns in do-2 but not do-1
      expect(diff.onlyInSecond).toContainEqual(expect.objectContaining({ name: 'total' }))

      // Columns in both
      expect(diff.inBoth).toContainEqual(expect.objectContaining({ name: 'id' }))
    })

    it('returns empty differences for identical schemas', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT, amount DECIMAL)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'orders', rowCount: 20, schema: 'CREATE TABLE orders (id INT, amount DECIMAL)' }
      ])

      const diff = await query.compareSchemas('orders', 'do-1', 'do-2')

      expect(diff.onlyInFirst).toHaveLength(0)
      expect(diff.onlyInSecond).toHaveLength(0)
      expect(diff.inBoth).toHaveLength(2)
    })

    it('throws error when DO does not have the table', async () => {
      await setupDOMetadata(bucket, 'do-1', 'snap-1', [
        { name: 'orders', rowCount: 10, schema: 'CREATE TABLE orders (id INT)' }
      ])
      await setupDOMetadata(bucket, 'do-2', 'snap-2', [
        { name: 'users', rowCount: 20, schema: 'CREATE TABLE users (id INT)' }
      ])

      await expect(
        query.compareSchemas('orders', 'do-1', 'do-2')
      ).rejects.toThrow(/do-2.*orders.*not found/i)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 7: Infer column types from data
  // ---------------------------------------------------------------------------
  describe('inferColumnTypes', () => {
    it('infers types from actual data', async () => {
      // Setup with Parquet data
      const rows = [
        { id: 1, name: 'Alice', amount: 99.99, created: '2024-01-15T10:00:00Z', active: true },
        { id: 2, name: 'Bob', amount: 149.50, created: '2024-01-16T10:00:00Z', active: false }
      ]

      const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31])
      const jsonBytes = new TextEncoder().encode(JSON.stringify(rows))
      const buffer = new ArrayBuffer(PARQUET_MAGIC.length * 2 + jsonBytes.length)
      const view = new Uint8Array(buffer)
      view.set(PARQUET_MAGIC, 0)
      view.set(jsonBytes, PARQUET_MAGIC.length)
      view.set(PARQUET_MAGIC, PARQUET_MAGIC.length + jsonBytes.length)

      await setupDOMetadata(bucket, 'do-123', 'snap-1', [
        { name: 'users', rowCount: 2, schema: 'CREATE TABLE users (id INT, name TEXT, amount DECIMAL, created TEXT, active INT)' }
      ])
      await bucket.put('do/do-123/data/users/snap-1.parquet', buffer)

      const inferredTypes = await query.inferColumnTypes('users', { doId: 'do-123', sampleSize: 100 })

      expect(inferredTypes).toContainEqual(expect.objectContaining({ name: 'id', inferredType: 'integer' }))
      expect(inferredTypes).toContainEqual(expect.objectContaining({ name: 'name', inferredType: 'string' }))
      expect(inferredTypes).toContainEqual(expect.objectContaining({ name: 'amount', inferredType: 'decimal' }))
      expect(inferredTypes).toContainEqual(expect.objectContaining({ name: 'active', inferredType: 'boolean' }))
    })
  })
})
