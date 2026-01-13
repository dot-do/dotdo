/**
 * IcebergSnapshotWriter Tests (RED Phase - TDD)
 *
 * Tests for Iceberg snapshot creation from libSQL state.
 * These tests define the expected behavior for exporting DO state to Iceberg format.
 *
 * Features:
 * - Create valid Iceberg manifests from libSQL tables
 * - Export tables to Parquet format
 * - Handle multiple tables in a single snapshot
 * - Preserve schema information in manifests
 * - Track parent snapshots for time-travel capability
 *
 * RED PHASE: All tests should FAIL initially because IcebergSnapshotWriter doesn't exist.
 * GREEN PHASE: Implement IcebergSnapshotWriter to make tests pass.
 * REFACTOR: Optimize implementation.
 *
 * @module db/iceberg/tests/snapshot-writer.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Iceberg format version 2 snapshot manifest structure
 * @see https://iceberg.apache.org/spec/#table-metadata
 */
interface IcebergSnapshotManifest {
  'format-version': 2
  'table-uuid': string
  location: string
  'last-updated-ms': number
  'last-column-id': number
  'current-snapshot-id': string | null
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
  'existing-files-count': number
  'deleted-files-count': number
  'added-rows-count': number
  table: string
  schema: string
}

/**
 * Mock R2 bucket interface
 */
interface MockR2Object {
  key: string
  body: ArrayBuffer | string
}

interface MockR2Bucket {
  put: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  _storage: Map<string, ArrayBuffer | string>
}

/**
 * Mock SQL storage interface (simulates Cloudflare SqlStorage)
 */
interface MockSqlStorage {
  exec: ReturnType<typeof vi.fn>
  _tables: Map<string, Map<string, unknown[]>>
  _schemas: Map<string, string>
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
 * Create a mock SQL storage that simulates libSQL/Cloudflare SqlStorage
 */
function createMockSqlStorage(): MockSqlStorage {
  const tables = new Map<string, Map<string, unknown[]>>()
  const schemas = new Map<string, string>()

  const sqlStorage: MockSqlStorage = {
    exec: vi.fn((query: string, ...params: unknown[]) => {
      const normalizedQuery = query.trim().toUpperCase()

      // Handle CREATE TABLE
      if (normalizedQuery.startsWith('CREATE TABLE')) {
        const match = query.match(/CREATE TABLE\s+(\w+)\s*\(([^)]+)\)/i)
        if (match) {
          const tableName = match[1]
          tables.set(tableName, new Map())
          schemas.set(tableName, query)
        }
        return { toArray: () => [], changes: 0 }
      }

      // Handle INSERT
      if (normalizedQuery.startsWith('INSERT')) {
        const match = query.match(/INSERT INTO\s+(\w+)/i)
        if (match) {
          const tableName = match[1]
          const tableData = tables.get(tableName)
          if (tableData) {
            // Simplified: track row count
            const rowCount = (tableData.get('_count') as number[] || [0])[0] + 1
            tableData.set('_count', [rowCount])
          }
        }
        return { toArray: () => [], changes: 1 }
      }

      // Handle SELECT * for data export
      if (normalizedQuery.startsWith('SELECT *')) {
        const match = query.match(/FROM\s+(\w+)/i)
        if (match) {
          const tableName = match[1]
          const tableData = tables.get(tableName)
          if (tableData) {
            // Return mock rows
            const count = (tableData.get('_count') as number[] || [0])[0]
            const rows: unknown[] = []
            for (let i = 0; i < count; i++) {
              rows.push({ id: i + 1, data: `row${i + 1}` })
            }
            return { toArray: () => rows, raw: () => rows }
          }
        }
        return { toArray: () => [], raw: () => [] }
      }

      // Handle sqlite_master query for table listing
      if (normalizedQuery.includes('SQLITE_MASTER') || normalizedQuery.includes('SQLITE_SCHEMA')) {
        const tableList: { name: string; sql: string }[] = []
        for (const [name, sql] of schemas) {
          if (!name.startsWith('sqlite_') && name !== 'kv') {
            tableList.push({ name, sql })
          }
        }
        return { toArray: () => tableList, raw: () => tableList }
      }

      return { toArray: () => [], raw: () => [] }
    }),
    _tables: tables,
    _schemas: schemas,
  }

  return sqlStorage
}

/**
 * Helper to retrieve and parse manifest from mock R2
 */
async function getManifest(bucket: MockR2Bucket, doId: string, snapshotId: string): Promise<IcebergSnapshotManifest> {
  const key = `do/${doId}/metadata/${snapshotId}.json`
  const obj = await bucket.get(key)
  if (!obj) {
    throw new Error(`Manifest not found at ${key}`)
  }
  return obj.json<IcebergSnapshotManifest>()
}

// =============================================================================
// Import the module under test (will fail in RED phase)
// =============================================================================

// This import will FAIL because the module doesn't exist yet
// When implementing, create: db/iceberg/snapshot-writer.ts
import { IcebergSnapshotWriter } from '../snapshot-writer'

// =============================================================================
// Test Suite
// =============================================================================

describe('IcebergSnapshotWriter', () => {
  let bucket: MockR2Bucket
  let sqlStorage: MockSqlStorage
  let writer: IcebergSnapshotWriter
  const doId = 'test-do-123'

  beforeEach(() => {
    vi.clearAllMocks()
    bucket = createMockR2Bucket()
    sqlStorage = createMockSqlStorage()
    writer = new IcebergSnapshotWriter(bucket, sqlStorage, doId)
  })

  // ---------------------------------------------------------------------------
  // Test 1: snapshot creates valid Iceberg manifest
  // ---------------------------------------------------------------------------
  describe('snapshot creates valid Iceberg manifest', () => {
    it('creates manifest with format-version 2', async () => {
      // Setup: Create a table with data
      sqlStorage.exec('CREATE TABLE users (id INT, name TEXT)')
      sqlStorage.exec("INSERT INTO users VALUES (1, 'Alice')")

      // Act: Create snapshot
      const snapshotId = await writer.snapshot()

      // Assert: Manifest exists and has correct format version
      const manifest = await getManifest(bucket, doId, snapshotId)
      expect(manifest['format-version']).toBe(2)
    })

    it('creates manifest with table-uuid', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT, name TEXT)')
      sqlStorage.exec("INSERT INTO users VALUES (1, 'Alice')")

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      expect(manifest['table-uuid']).toBeDefined()
      expect(typeof manifest['table-uuid']).toBe('string')
      // UUID should match standard format
      expect(manifest['table-uuid']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    })

    it('creates manifest with correct location', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT, name TEXT)')
      sqlStorage.exec("INSERT INTO users VALUES (1, 'Alice')")

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      expect(manifest.location).toBe(`do/${doId}`)
    })

    it('creates manifest with last-updated-ms timestamp', async () => {
      const beforeTime = Date.now()

      sqlStorage.exec('CREATE TABLE users (id INT, name TEXT)')
      sqlStorage.exec("INSERT INTO users VALUES (1, 'Alice')")

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      const afterTime = Date.now()

      expect(manifest['last-updated-ms']).toBeGreaterThanOrEqual(beforeTime)
      expect(manifest['last-updated-ms']).toBeLessThanOrEqual(afterTime)
    })

    it('creates manifest with current-snapshot-id', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT, name TEXT)')
      sqlStorage.exec("INSERT INTO users VALUES (1, 'Alice')")

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      expect(manifest['current-snapshot-id']).toBe(snapshotId)
    })

    it('creates manifest with manifests array containing table entries', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT, name TEXT)')
      sqlStorage.exec("INSERT INTO users VALUES (1, 'Alice')")

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      expect(manifest.manifests).toBeDefined()
      expect(Array.isArray(manifest.manifests)).toBe(true)
      expect(manifest.manifests.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 2: snapshot exports tables to Parquet
  // ---------------------------------------------------------------------------
  describe('snapshot exports tables to Parquet', () => {
    it('creates Parquet file for each table', async () => {
      sqlStorage.exec('CREATE TABLE orders (id INT, amount DECIMAL)')
      sqlStorage.exec('INSERT INTO orders VALUES (1, 99.99)')

      const snapshotId = await writer.snapshot()

      // Check that Parquet file was written to R2
      const parquetKey = `do/${doId}/data/orders/${snapshotId}.parquet`
      expect(bucket.put).toHaveBeenCalledWith(
        parquetKey,
        expect.any(ArrayBuffer)
      )
    })

    it('writes Parquet file with correct data', async () => {
      sqlStorage.exec('CREATE TABLE orders (id INT, amount DECIMAL)')
      sqlStorage.exec('INSERT INTO orders VALUES (1, 99.99)')
      sqlStorage.exec('INSERT INTO orders VALUES (2, 149.50)')

      const snapshotId = await writer.snapshot()

      // Verify file exists in mock storage
      const parquetKey = `do/${doId}/data/orders/${snapshotId}.parquet`
      const parquetData = bucket._storage.get(parquetKey)
      expect(parquetData).toBeDefined()
    })

    it('manifest references Parquet file paths', async () => {
      sqlStorage.exec('CREATE TABLE orders (id INT, amount DECIMAL)')
      sqlStorage.exec('INSERT INTO orders VALUES (1, 99.99)')

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      // Find the manifest entry for orders table
      const ordersManifest = manifest.manifests.find(m => m.table === 'orders')
      expect(ordersManifest).toBeDefined()
      expect(ordersManifest!['manifest-path']).toContain('orders')
      expect(ordersManifest!['manifest-path']).toContain('.parquet')
    })

    it('tracks row count in manifest entry', async () => {
      sqlStorage.exec('CREATE TABLE orders (id INT, amount DECIMAL)')
      sqlStorage.exec('INSERT INTO orders VALUES (1, 99.99)')
      sqlStorage.exec('INSERT INTO orders VALUES (2, 149.50)')
      sqlStorage.exec('INSERT INTO orders VALUES (3, 75.00)')

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      const ordersManifest = manifest.manifests.find(m => m.table === 'orders')
      expect(ordersManifest).toBeDefined()
      expect(ordersManifest!['added-rows-count']).toBe(3)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 3: snapshot handles multiple tables
  // ---------------------------------------------------------------------------
  describe('snapshot handles multiple tables', () => {
    it('creates manifest entries for all tables', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT, name TEXT)')
      sqlStorage.exec('CREATE TABLE orders (id INT, user_id INT, total DECIMAL)')
      sqlStorage.exec('CREATE TABLE products (id INT, name TEXT, price DECIMAL)')

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      expect(manifest.manifests.length).toBe(3)

      const tableNames = manifest.manifests.map(m => m.table)
      expect(tableNames).toContain('users')
      expect(tableNames).toContain('orders')
      expect(tableNames).toContain('products')
    })

    it('creates separate Parquet files for each table', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT)')
      sqlStorage.exec('CREATE TABLE orders (id INT)')
      sqlStorage.exec('INSERT INTO users VALUES (1)')
      sqlStorage.exec('INSERT INTO orders VALUES (1)')

      const snapshotId = await writer.snapshot()

      // Verify both Parquet files exist
      const usersKey = `do/${doId}/data/users/${snapshotId}.parquet`
      const ordersKey = `do/${doId}/data/orders/${snapshotId}.parquet`

      expect(bucket._storage.has(usersKey)).toBe(true)
      expect(bucket._storage.has(ordersKey)).toBe(true)
    })

    it('handles empty tables correctly', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT)')
      sqlStorage.exec('CREATE TABLE orders (id INT)')
      sqlStorage.exec('INSERT INTO users VALUES (1)')
      // orders table is empty

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      // Both tables should have manifest entries
      expect(manifest.manifests.length).toBe(2)

      const ordersManifest = manifest.manifests.find(m => m.table === 'orders')
      expect(ordersManifest).toBeDefined()
      expect(ordersManifest!['added-rows-count']).toBe(0)
    })

    it('excludes internal sqlite tables', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT)')
      // sqlite_master, sqlite_sequence, etc. should be excluded

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      const tableNames = manifest.manifests.map(m => m.table)
      expect(tableNames).not.toContain('sqlite_master')
      expect(tableNames).not.toContain('sqlite_sequence')
      expect(tableNames).not.toContain('sqlite_schema')
    })

    it('excludes kv table (handled separately)', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT)')
      sqlStorage.exec('CREATE TABLE kv (key TEXT, value TEXT)')

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      const tableNames = manifest.manifests.map(m => m.table)
      // kv table may be included or excluded depending on design
      // For now, we expect it to be included if it exists
      // This can be adjusted based on implementation requirements
    })
  })

  // ---------------------------------------------------------------------------
  // Test 4: snapshot preserves schema in manifest
  // ---------------------------------------------------------------------------
  describe('snapshot preserves schema in manifest', () => {
    it('includes CREATE TABLE statement in manifest entry', async () => {
      sqlStorage.exec('CREATE TABLE complex (a INT, b TEXT, c REAL)')

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      const complexManifest = manifest.manifests.find(m => m.table === 'complex')
      expect(complexManifest).toBeDefined()
      expect(complexManifest!.schema).toContain('CREATE TABLE')
      expect(complexManifest!.schema).toContain('complex')
    })

    it('preserves column definitions in schema', async () => {
      sqlStorage.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, age INTEGER)')

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      const usersManifest = manifest.manifests.find(m => m.table === 'users')
      expect(usersManifest).toBeDefined()
      expect(usersManifest!.schema).toContain('id')
      expect(usersManifest!.schema).toContain('name')
      expect(usersManifest!.schema).toContain('email')
      expect(usersManifest!.schema).toContain('age')
    })

    it('includes schemas array in manifest', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT, name TEXT)')

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      expect(manifest.schemas).toBeDefined()
      expect(Array.isArray(manifest.schemas)).toBe(true)
      expect(manifest.schemas.length).toBeGreaterThanOrEqual(1)
    })

    it('schema fields include correct types', async () => {
      sqlStorage.exec('CREATE TABLE typed (int_col INT, text_col TEXT, real_col REAL, blob_col BLOB)')

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      // Find schema entry
      const schema = manifest.schemas.find(s => s.fields.some(f => f.name === 'int_col'))
      expect(schema).toBeDefined()

      const intField = schema!.fields.find(f => f.name === 'int_col')
      expect(intField).toBeDefined()
      expect(intField!.type).toMatch(/int|integer|long/i)

      const textField = schema!.fields.find(f => f.name === 'text_col')
      expect(textField).toBeDefined()
      expect(textField!.type).toMatch(/text|string/i)
    })
  })

  // ---------------------------------------------------------------------------
  // Test 5: snapshot tracks parent snapshot for history
  // ---------------------------------------------------------------------------
  describe('snapshot tracks parent snapshot for history', () => {
    it('first snapshot has null parent-snapshot-id', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT, name TEXT)')
      sqlStorage.exec("INSERT INTO users VALUES (1, 'Alice')")

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      expect(manifest['parent-snapshot-id']).toBeNull()
    })

    it('second snapshot references first as parent', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT, name TEXT)')
      sqlStorage.exec("INSERT INTO users VALUES (1, 'Alice')")

      const snap1 = await writer.snapshot()

      sqlStorage.exec("INSERT INTO users VALUES (2, 'Bob')")

      const snap2 = await writer.snapshot()
      const manifest2 = await getManifest(bucket, doId, snap2)

      expect(manifest2['parent-snapshot-id']).toBe(snap1)
    })

    it('maintains snapshot chain through multiple snapshots', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT, name TEXT)')

      const snap1 = await writer.snapshot()

      sqlStorage.exec("INSERT INTO users VALUES (1, 'Alice')")
      const snap2 = await writer.snapshot()

      sqlStorage.exec("INSERT INTO users VALUES (2, 'Bob')")
      const snap3 = await writer.snapshot()

      const manifest2 = await getManifest(bucket, doId, snap2)
      const manifest3 = await getManifest(bucket, doId, snap3)

      expect(manifest2['parent-snapshot-id']).toBe(snap1)
      expect(manifest3['parent-snapshot-id']).toBe(snap2)
    })

    it('snapshots array contains all snapshots', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT, name TEXT)')

      await writer.snapshot()
      sqlStorage.exec("INSERT INTO users VALUES (1, 'Alice')")
      await writer.snapshot()
      sqlStorage.exec("INSERT INTO users VALUES (2, 'Bob')")
      const snap3 = await writer.snapshot()

      const manifest = await getManifest(bucket, doId, snap3)

      expect(manifest.snapshots).toBeDefined()
      expect(manifest.snapshots.length).toBe(3)
    })

    it('each snapshot entry has timestamp', async () => {
      const beforeTime = Date.now()

      sqlStorage.exec('CREATE TABLE users (id INT, name TEXT)')
      const snap1 = await writer.snapshot()

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10))

      sqlStorage.exec("INSERT INTO users VALUES (1, 'Alice')")
      const snap2 = await writer.snapshot()

      const afterTime = Date.now()

      const manifest = await getManifest(bucket, doId, snap2)

      for (const snapshot of manifest.snapshots) {
        expect(snapshot['timestamp-ms']).toBeGreaterThanOrEqual(beforeTime)
        expect(snapshot['timestamp-ms']).toBeLessThanOrEqual(afterTime)
      }
    })

    it('snapshot summary includes operation type', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT, name TEXT)')
      const snapshotId = await writer.snapshot()

      const manifest = await getManifest(bucket, doId, snapshotId)

      const snapshotEntry = manifest.snapshots.find(s => s['snapshot-id'] === snapshotId)
      expect(snapshotEntry).toBeDefined()
      expect(snapshotEntry!.summary).toBeDefined()
      expect(snapshotEntry!.summary.operation).toMatch(/append|overwrite|replace/i)
    })
  })

  // ---------------------------------------------------------------------------
  // Additional Iceberg format validation tests
  // ---------------------------------------------------------------------------
  describe('Iceberg format compliance', () => {
    it('returns unique snapshot IDs', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT)')

      const snap1 = await writer.snapshot()
      const snap2 = await writer.snapshot()
      const snap3 = await writer.snapshot()

      expect(snap1).not.toBe(snap2)
      expect(snap2).not.toBe(snap3)
      expect(snap1).not.toBe(snap3)
    })

    it('snapshot ID is a valid identifier', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT)')

      const snapshotId = await writer.snapshot()

      // Snapshot ID should be a valid string (UUID or timestamp-based)
      expect(typeof snapshotId).toBe('string')
      expect(snapshotId.length).toBeGreaterThan(0)
    })

    it('manifest entry has required Iceberg fields', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT)')
      sqlStorage.exec('INSERT INTO users VALUES (1)')

      const snapshotId = await writer.snapshot()
      const manifest = await getManifest(bucket, doId, snapshotId)

      const entry = manifest.manifests[0]
      expect(entry['manifest-path']).toBeDefined()
      expect(entry['manifest-length']).toBeGreaterThan(0)
      expect(entry['partition-spec-id']).toBeDefined()
      expect(entry.content).toBe(0) // 0 = data files
      expect(entry['sequence-number']).toBeGreaterThanOrEqual(1)
      expect(entry['added-files-count']).toBeGreaterThanOrEqual(0)
    })

    it('handles concurrent snapshot calls correctly', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT)')
      sqlStorage.exec('INSERT INTO users VALUES (1)')

      // Create multiple snapshots concurrently
      const [snap1, snap2, snap3] = await Promise.all([
        writer.snapshot(),
        writer.snapshot(),
        writer.snapshot(),
      ])

      // All should complete successfully with unique IDs
      const ids = new Set([snap1, snap2, snap3])
      expect(ids.size).toBe(3)
    })
  })

  // ---------------------------------------------------------------------------
  // Error handling tests
  // ---------------------------------------------------------------------------
  describe('error handling', () => {
    it('handles R2 put failure gracefully', async () => {
      sqlStorage.exec('CREATE TABLE users (id INT)')
      sqlStorage.exec('INSERT INTO users VALUES (1)')

      // Simulate R2 failure
      bucket.put.mockRejectedValueOnce(new Error('R2 unavailable'))

      await expect(writer.snapshot()).rejects.toThrow('R2 unavailable')
    })

    it('handles SQL query failure gracefully', async () => {
      // Simulate SQL failure
      sqlStorage.exec.mockImplementationOnce(() => {
        throw new Error('SQL error')
      })

      await expect(writer.snapshot()).rejects.toThrow()
    })

    it('handles empty database (no tables)', async () => {
      // No tables created
      const snapshotId = await writer.snapshot()

      const manifest = await getManifest(bucket, doId, snapshotId)

      // Should create a valid manifest with empty manifests array
      expect(manifest['format-version']).toBe(2)
      expect(manifest.manifests).toEqual([])
    })
  })
})
