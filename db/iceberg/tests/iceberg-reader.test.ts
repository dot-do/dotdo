/**
 * IcebergReader Restore and Time Travel Tests (GREEN Phase - TDD)
 *
 * Tests for restoring DO state from Iceberg snapshots and time travel queries.
 * This complements the IcebergSnapshotWriter by providing the read/restore side.
 *
 * Features:
 * - restore(snapshotId) - restore state from snapshot
 * - listSnapshots() - list available snapshots
 * - getSnapshotAt(timestamp) - get snapshot by timestamp
 * - Clear existing tables before restore
 * - Load data from Parquet files
 *
 * @module db/iceberg/tests/iceberg-reader.test
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Iceberg manifest structure stored in R2
 */
interface IcebergManifest {
  'format-version': 2
  'table-uuid': string
  location: string
  'last-updated-ms': number
  'current-snapshot-id': string | null
  'parent-snapshot-id': string | null
  snapshot_id: string
  timestamp_ms: number
  parent_snapshot_id: string | null
  snapshots: SnapshotEntry[]
  manifests: ManifestEntry[]
}

interface SnapshotEntry {
  snapshot_id: string
  parent_snapshot_id: string | null
  timestamp_ms: number
  manifest_list: string
  summary: Record<string, string>
}

interface ManifestEntry {
  table: string
  schema: string
  data_file: string
  row_count: number
}

/**
 * Snapshot info returned by listSnapshots
 */
interface SnapshotInfo {
  id: string
  timestamp: Date
  parentId: string | null
}

/**
 * Mock R2 bucket interface
 */
interface MockR2Object {
  key: string
  json<T>(): Promise<T>
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
}

interface MockR2Bucket {
  put: Mock
  get: Mock
  list: Mock
  delete: Mock
  _storage: Map<string, ArrayBuffer | string>
}

/**
 * Mock SQL client interface (libSQL-style)
 */
interface MockSqlClient {
  execute: Mock
  batch: Mock
  _tables: Map<string, unknown[]>
  _executed: string[]
}

/**
 * Mock Parquet adapter interface
 */
interface MockParquetAdapter {
  read: Mock
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
        text: async () => (typeof body === 'string' ? body : new TextDecoder().decode(body as ArrayBuffer)),
        json: async <T>() => JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(body as ArrayBuffer)) as T,
        arrayBuffer: async () => (typeof body === 'string' ? new TextEncoder().encode(body).buffer : body),
      } as MockR2Object
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
 * Create a mock SQL client for testing
 */
function createMockSqlClient(): MockSqlClient {
  const tables = new Map<string, unknown[]>()
  const executed: string[] = []

  const client: MockSqlClient = {
    execute: vi.fn(async (query: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof query === 'string' ? query : query.sql
      executed.push(sql)

      // Handle SELECT from sqlite_master
      if (sql.includes('sqlite_master') || sql.includes('sqlite_schema')) {
        const tableList: { name: string }[] = []
        for (const name of tables.keys()) {
          tableList.push({ name })
        }
        return { rows: tableList }
      }

      // Handle DROP TABLE
      if (sql.toUpperCase().startsWith('DROP TABLE')) {
        const match = sql.match(/DROP TABLE IF EXISTS\s+(\w+)/i)
        if (match) {
          tables.delete(match[1])
        }
        return { rows: [] }
      }

      // Handle CREATE TABLE
      if (sql.toUpperCase().startsWith('CREATE TABLE')) {
        const match = sql.match(/CREATE TABLE\s+(\w+)/i)
        if (match) {
          tables.set(match[1], [])
        }
        return { rows: [] }
      }

      // Handle INSERT
      if (sql.toUpperCase().startsWith('INSERT')) {
        const match = sql.match(/INSERT INTO\s+(\w+)/i)
        if (match && typeof query !== 'string') {
          const tableData = tables.get(match[1]) || []
          tableData.push(query.args)
          tables.set(match[1], tableData)
        }
        return { rows: [] }
      }

      return { rows: [] }
    }),
    batch: vi.fn(async (statements: Array<{ sql: string; args?: unknown[] }>) => {
      const results = []
      for (const stmt of statements) {
        results.push(await client.execute(stmt))
      }
      return results
    }),
    _tables: tables,
    _executed: executed,
  }

  return client
}

/**
 * Create a mock Parquet adapter
 */
function createMockParquetAdapter(): MockParquetAdapter {
  return {
    read: vi.fn(async (_buffer: ArrayBuffer) => {
      // Default: return empty array, tests will configure specific behavior
      return []
    }),
  }
}

/**
 * Create a sample manifest for testing
 */
function createSampleManifest(snapshotId: string, opts?: {
  parentId?: string | null
  timestamp?: number
  tables?: Array<{ name: string; schema: string; rows: number }>
}): IcebergManifest {
  const timestamp = opts?.timestamp ?? Date.now()
  const tables = opts?.tables ?? [
    { name: 'users', schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)', rows: 10 },
  ]

  return {
    'format-version': 2,
    'table-uuid': 'test-uuid-1234',
    location: `do/test-do/metadata`,
    'last-updated-ms': timestamp,
    'current-snapshot-id': snapshotId,
    'parent-snapshot-id': opts?.parentId ?? null,
    snapshot_id: snapshotId,
    timestamp_ms: timestamp,
    parent_snapshot_id: opts?.parentId ?? null,
    snapshots: [{
      snapshot_id: snapshotId,
      parent_snapshot_id: opts?.parentId ?? null,
      timestamp_ms: timestamp,
      manifest_list: `do/test-do/metadata/${snapshotId}-manifest-list.avro`,
      summary: { operation: 'append' },
    }],
    manifests: tables.map((t) => ({
      table: t.name,
      schema: t.schema,
      data_file: `do/test-do/data/${snapshotId}/${t.name}.parquet`,
      row_count: t.rows,
    })),
  }
}

/**
 * Store a manifest in the mock bucket
 */
function storeManifest(bucket: MockR2Bucket, doId: string, snapshotId: string, manifest: IcebergManifest): void {
  const key = `do/${doId}/metadata/${snapshotId}.json`
  bucket._storage.set(key, JSON.stringify(manifest))
}

/**
 * Store Parquet data in the mock bucket
 */
function storeParquetData(bucket: MockR2Bucket, path: string, _data: unknown[]): void {
  // Store as "parquet" (actually just a placeholder, the adapter will mock the read)
  bucket._storage.set(path, new TextEncoder().encode('PARQUET_DATA').buffer)
}

// =============================================================================
// Import the module under test
// =============================================================================

import { IcebergRestorer } from '../iceberg-reader'

// =============================================================================
// Test Suite
// =============================================================================

describe('IcebergRestorer', () => {
  let bucket: MockR2Bucket
  let db: MockSqlClient
  let parquetAdapter: MockParquetAdapter
  let restorer: IcebergRestorer
  const doId = 'test-do-123'

  beforeEach(() => {
    vi.clearAllMocks()
    bucket = createMockR2Bucket()
    db = createMockSqlClient()
    parquetAdapter = createMockParquetAdapter()
    restorer = new IcebergRestorer(
      bucket as unknown as import('@cloudflare/workers-types').R2Bucket,
      doId,
      db as unknown as import('../iceberg-reader').SqlClient,
      parquetAdapter as unknown as import('../iceberg-reader').ParquetAdapter
    )
  })

  // ---------------------------------------------------------------------------
  // restore() Tests
  // ---------------------------------------------------------------------------
  describe('restore(snapshotId)', () => {
    it('throws error when snapshot not found', async () => {
      await expect(restorer.restore('nonexistent-snapshot')).rejects.toThrow('Snapshot not found')
    })

    it('clears existing tables before restore', async () => {
      // Setup: Add existing tables to DB
      db._tables.set('old_table', [{ id: 1 }])
      db._tables.set('another_table', [{ id: 2 }])

      // Setup: Create snapshot with different table
      const snapshotId = 'snap-001'
      const manifest = createSampleManifest(snapshotId, {
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER)', rows: 5 }],
      })
      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, `do/${doId}/data/${snapshotId}/users.parquet`, [])

      // Mock parquet read
      parquetAdapter.read.mockResolvedValue([{ id: 1, name: 'Alice' }])

      // Act
      await restorer.restore(snapshotId)

      // Assert: DROP TABLE was called for existing tables
      const dropCalls = db._executed.filter((sql) => sql.includes('DROP TABLE'))
      expect(dropCalls.length).toBeGreaterThanOrEqual(2)
    })

    it('creates tables from manifest schema', async () => {
      const snapshotId = 'snap-002'
      const manifest = createSampleManifest(snapshotId, {
        tables: [
          { name: 'users', schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)', rows: 5 },
          { name: 'orders', schema: 'CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER)', rows: 3 },
        ],
      })
      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, `do/${doId}/data/${snapshotId}/users.parquet`, [])
      storeParquetData(bucket, `do/${doId}/data/${snapshotId}/orders.parquet`, [])

      parquetAdapter.read.mockResolvedValue([])

      await restorer.restore(snapshotId)

      // Assert: CREATE TABLE was called for each table
      const createCalls = db._executed.filter((sql) => sql.includes('CREATE TABLE'))
      expect(createCalls).toContainEqual(expect.stringContaining('CREATE TABLE users'))
      expect(createCalls).toContainEqual(expect.stringContaining('CREATE TABLE orders'))
    })

    it('loads data from Parquet files', async () => {
      const snapshotId = 'snap-003'
      const manifest = createSampleManifest(snapshotId, {
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER, name TEXT)', rows: 2 }],
      })
      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, `do/${doId}/data/${snapshotId}/users.parquet`, [])

      // Mock parquet to return specific rows
      parquetAdapter.read.mockResolvedValue([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ])

      await restorer.restore(snapshotId)

      // Assert: Parquet adapter was called
      expect(parquetAdapter.read).toHaveBeenCalled()

      // Assert: INSERT was called for each row
      const insertCalls = db._executed.filter((sql) => sql.includes('INSERT'))
      expect(insertCalls.length).toBe(2)
    })

    it('inserts rows with correct column values', async () => {
      const snapshotId = 'snap-004'
      const manifest = createSampleManifest(snapshotId, {
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER, name TEXT, email TEXT)', rows: 1 }],
      })
      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, `do/${doId}/data/${snapshotId}/users.parquet`, [])

      parquetAdapter.read.mockResolvedValue([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
      ])

      await restorer.restore(snapshotId)

      // Assert: INSERT statement has correct structure
      const insertCall = db._executed.find((sql) => sql.includes('INSERT INTO users'))
      expect(insertCall).toBeDefined()
      expect(insertCall).toContain('id')
      expect(insertCall).toContain('name')
      expect(insertCall).toContain('email')
    })

    it('handles empty tables correctly', async () => {
      const snapshotId = 'snap-005'
      const manifest = createSampleManifest(snapshotId, {
        tables: [{ name: 'empty_table', schema: 'CREATE TABLE empty_table (id INTEGER)', rows: 0 }],
      })
      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, `do/${doId}/data/${snapshotId}/empty_table.parquet`, [])

      parquetAdapter.read.mockResolvedValue([])

      // Should not throw
      await expect(restorer.restore(snapshotId)).resolves.not.toThrow()

      // Table should still be created
      const createCalls = db._executed.filter((sql) => sql.includes('CREATE TABLE'))
      expect(createCalls).toContainEqual(expect.stringContaining('empty_table'))
    })

    it('handles multiple tables in single restore', async () => {
      const snapshotId = 'snap-006'
      const manifest = createSampleManifest(snapshotId, {
        tables: [
          { name: 'users', schema: 'CREATE TABLE users (id INTEGER, name TEXT)', rows: 2 },
          { name: 'products', schema: 'CREATE TABLE products (id INTEGER, title TEXT)', rows: 3 },
          { name: 'orders', schema: 'CREATE TABLE orders (id INTEGER, user_id INTEGER)', rows: 1 },
        ],
      })
      storeManifest(bucket, doId, snapshotId, manifest)

      for (const t of manifest.manifests) {
        storeParquetData(bucket, t.data_file, [])
      }

      parquetAdapter.read
        .mockResolvedValueOnce([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }])
        .mockResolvedValueOnce([{ id: 1, title: 'Product A' }, { id: 2, title: 'Product B' }, { id: 3, title: 'Product C' }])
        .mockResolvedValueOnce([{ id: 1, user_id: 1 }])

      await restorer.restore(snapshotId)

      // Assert: All three tables created
      const createCalls = db._executed.filter((sql) => sql.includes('CREATE TABLE'))
      expect(createCalls.length).toBe(3)

      // Assert: Total of 6 inserts (2 + 3 + 1)
      const insertCalls = db._executed.filter((sql) => sql.includes('INSERT'))
      expect(insertCalls.length).toBe(6)
    })
  })

  // ---------------------------------------------------------------------------
  // listSnapshots() Tests
  // ---------------------------------------------------------------------------
  describe('listSnapshots()', () => {
    it('returns empty array when no snapshots exist', async () => {
      const snapshots = await restorer.listSnapshots()
      expect(snapshots).toEqual([])
    })

    it('returns all available snapshots', async () => {
      // Setup: Create multiple snapshots
      const snap1 = createSampleManifest('snap-001', { timestamp: 1000000 })
      const snap2 = createSampleManifest('snap-002', { timestamp: 2000000, parentId: 'snap-001' })
      const snap3 = createSampleManifest('snap-003', { timestamp: 3000000, parentId: 'snap-002' })

      storeManifest(bucket, doId, 'snap-001', snap1)
      storeManifest(bucket, doId, 'snap-002', snap2)
      storeManifest(bucket, doId, 'snap-003', snap3)

      const snapshots = await restorer.listSnapshots()

      expect(snapshots).toHaveLength(3)
    })

    it('returns snapshots sorted by timestamp descending', async () => {
      const snap1 = createSampleManifest('snap-001', { timestamp: 1000000 })
      const snap2 = createSampleManifest('snap-002', { timestamp: 2000000 })
      const snap3 = createSampleManifest('snap-003', { timestamp: 3000000 })

      storeManifest(bucket, doId, 'snap-001', snap1)
      storeManifest(bucket, doId, 'snap-002', snap2)
      storeManifest(bucket, doId, 'snap-003', snap3)

      const snapshots = await restorer.listSnapshots()

      // Most recent first
      expect(snapshots[0].id).toBe('snap-003')
      expect(snapshots[1].id).toBe('snap-002')
      expect(snapshots[2].id).toBe('snap-001')
    })

    it('includes snapshot id, timestamp, and parentId', async () => {
      const snap = createSampleManifest('snap-001', { timestamp: 1234567890, parentId: null })
      storeManifest(bucket, doId, 'snap-001', snap)

      const snapshots = await restorer.listSnapshots()

      expect(snapshots[0]).toEqual({
        id: 'snap-001',
        timestamp: new Date(1234567890),
        parentId: null,
      })
    })

    it('correctly reports parent snapshot relationships', async () => {
      const snap1 = createSampleManifest('snap-001', { timestamp: 1000000, parentId: null })
      const snap2 = createSampleManifest('snap-002', { timestamp: 2000000, parentId: 'snap-001' })

      storeManifest(bucket, doId, 'snap-001', snap1)
      storeManifest(bucket, doId, 'snap-002', snap2)

      const snapshots = await restorer.listSnapshots()

      const snap1Info = snapshots.find((s) => s.id === 'snap-001')
      const snap2Info = snapshots.find((s) => s.id === 'snap-002')

      expect(snap1Info?.parentId).toBeNull()
      expect(snap2Info?.parentId).toBe('snap-001')
    })

    it('excludes current.json pointer file from snapshot list', async () => {
      const snap = createSampleManifest('snap-001', { timestamp: 1000000 })
      storeManifest(bucket, doId, 'snap-001', snap)

      // Add a current.json pointer file
      bucket._storage.set(`do/${doId}/metadata/current.json`, JSON.stringify({ currentSnapshotId: 'snap-001' }))

      const snapshots = await restorer.listSnapshots()

      // Should only have one snapshot, not the current.json file
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0].id).toBe('snap-001')
    })
  })

  // ---------------------------------------------------------------------------
  // getSnapshotAt(timestamp) Tests
  // ---------------------------------------------------------------------------
  describe('getSnapshotAt(timestamp)', () => {
    it('returns null when no snapshots exist', async () => {
      const result = await restorer.getSnapshotAt(Date.now())
      expect(result).toBeNull()
    })

    it('returns most recent snapshot before timestamp', async () => {
      const snap1 = createSampleManifest('snap-001', { timestamp: 1000 })
      const snap2 = createSampleManifest('snap-002', { timestamp: 2000 })
      const snap3 = createSampleManifest('snap-003', { timestamp: 3000 })

      storeManifest(bucket, doId, 'snap-001', snap1)
      storeManifest(bucket, doId, 'snap-002', snap2)
      storeManifest(bucket, doId, 'snap-003', snap3)

      // Query for timestamp 2500 - should get snap-002
      const result = await restorer.getSnapshotAt(2500)

      expect(result).not.toBeNull()
      expect(result?.id).toBe('snap-002')
    })

    it('returns exact match when timestamp equals snapshot time', async () => {
      const snap1 = createSampleManifest('snap-001', { timestamp: 1000 })
      const snap2 = createSampleManifest('snap-002', { timestamp: 2000 })

      storeManifest(bucket, doId, 'snap-001', snap1)
      storeManifest(bucket, doId, 'snap-002', snap2)

      const result = await restorer.getSnapshotAt(2000)

      expect(result?.id).toBe('snap-002')
    })

    it('returns null when timestamp is before all snapshots', async () => {
      const snap1 = createSampleManifest('snap-001', { timestamp: 1000 })
      const snap2 = createSampleManifest('snap-002', { timestamp: 2000 })

      storeManifest(bucket, doId, 'snap-001', snap1)
      storeManifest(bucket, doId, 'snap-002', snap2)

      const result = await restorer.getSnapshotAt(500)

      expect(result).toBeNull()
    })

    it('returns latest snapshot when timestamp is after all snapshots', async () => {
      const snap1 = createSampleManifest('snap-001', { timestamp: 1000 })
      const snap2 = createSampleManifest('snap-002', { timestamp: 2000 })

      storeManifest(bucket, doId, 'snap-001', snap1)
      storeManifest(bucket, doId, 'snap-002', snap2)

      const result = await restorer.getSnapshotAt(5000)

      expect(result?.id).toBe('snap-002')
    })

    it('handles single snapshot correctly', async () => {
      const snap = createSampleManifest('snap-001', { timestamp: 1000 })
      storeManifest(bucket, doId, 'snap-001', snap)

      const before = await restorer.getSnapshotAt(500)
      const exact = await restorer.getSnapshotAt(1000)
      const after = await restorer.getSnapshotAt(2000)

      expect(before).toBeNull()
      expect(exact?.id).toBe('snap-001')
      expect(after?.id).toBe('snap-001')
    })
  })

  // ---------------------------------------------------------------------------
  // Time Travel Restore Tests (combining getSnapshotAt + restore)
  // ---------------------------------------------------------------------------
  describe('Time Travel Restore', () => {
    it('can restore to a point in time', async () => {
      // Setup: Create snapshot chain representing changes over time
      const snap1 = createSampleManifest('snap-001', {
        timestamp: 1000,
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER, name TEXT)', rows: 1 }],
      })
      const snap2 = createSampleManifest('snap-002', {
        timestamp: 2000,
        parentId: 'snap-001',
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER, name TEXT)', rows: 2 }],
      })

      storeManifest(bucket, doId, 'snap-001', snap1)
      storeManifest(bucket, doId, 'snap-002', snap2)

      for (const snap of [snap1, snap2]) {
        for (const m of snap.manifests) {
          storeParquetData(bucket, m.data_file, [])
        }
      }

      // Configure parquet to return different data based on which file
      parquetAdapter.read.mockImplementation(async (buffer: ArrayBuffer) => {
        // Simple mock - in reality would parse the buffer
        return [{ id: 1, name: 'Time Travel User' }]
      })

      // Act: Get snapshot at time 1500 (should get snap-001)
      const snapshot = await restorer.getSnapshotAt(1500)
      expect(snapshot?.id).toBe('snap-001')

      // Restore to that snapshot
      await restorer.restore(snapshot!.id)

      // Verify restore happened
      expect(db._executed).toContainEqual(expect.stringContaining('CREATE TABLE users'))
    })
  })

  // ---------------------------------------------------------------------------
  // Error Handling Tests
  // ---------------------------------------------------------------------------
  describe('Error Handling', () => {
    it('throws meaningful error when R2 is unavailable', async () => {
      // Make bucket.get throw
      bucket.get = vi.fn().mockRejectedValue(new Error('R2 unavailable'))

      await expect(restorer.listSnapshots()).rejects.toThrow('R2 unavailable')
    })

    it('throws error when Parquet file is missing', async () => {
      const snapshotId = 'snap-missing-parquet'
      const manifest = createSampleManifest(snapshotId)
      storeManifest(bucket, doId, snapshotId, manifest)
      // Don't store the parquet file

      await expect(restorer.restore(snapshotId)).rejects.toThrow()
    })

    it('handles corrupt manifest JSON gracefully', async () => {
      // Store invalid JSON
      bucket._storage.set(`do/${doId}/metadata/corrupt.json`, 'not valid json {{{')

      // listSnapshots should skip invalid files or throw appropriate error
      // Implementation can choose either behavior
      const result = await restorer.listSnapshots()
      // Should either skip the corrupt file or throw - both are acceptable
      expect(result.every((s) => s.id !== 'corrupt')).toBe(true)
    })

    it('throws error when manifest has no tables', async () => {
      const snapshotId = 'snap-no-tables'
      const manifest = createSampleManifest(snapshotId, { tables: [] })
      storeManifest(bucket, doId, snapshotId, manifest)

      // Restoring with no tables should work (just clears state)
      await expect(restorer.restore(snapshotId)).resolves.not.toThrow()
    })
  })
})
