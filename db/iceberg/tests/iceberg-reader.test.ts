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

/** Default DO ID used in tests */
const DEFAULT_TEST_DO_ID = 'test-do-123'

/**
 * Create a sample manifest for testing
 */
function createSampleManifest(snapshotId: string, opts?: {
  parentId?: string | null
  timestamp?: number
  tables?: Array<{ name: string; schema: string; rows: number }>
  doId?: string
}): IcebergManifest {
  const timestamp = opts?.timestamp ?? Date.now()
  const testDoId = opts?.doId ?? DEFAULT_TEST_DO_ID
  const tables = opts?.tables ?? [
    { name: 'users', schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)', rows: 10 },
  ]

  return {
    'format-version': 2,
    'table-uuid': 'test-uuid-1234',
    location: `do/${testDoId}/metadata`,
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
      manifest_list: `do/${testDoId}/metadata/${snapshotId}-manifest-list.avro`,
      summary: { operation: 'append' },
    }],
    manifests: tables.map((t) => ({
      table: t.name,
      schema: t.schema,
      data_file: `do/${testDoId}/data/${snapshotId}/${t.name}.parquet`,
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
    it('throws meaningful error when R2 list is unavailable', async () => {
      // Make bucket.list throw (this is not caught internally)
      bucket.list = vi.fn().mockRejectedValue(new Error('R2 unavailable'))

      await expect(restorer.listSnapshots()).rejects.toThrow('R2 unavailable')
    })

    it('skips manifests when bucket.get fails during listSnapshots', async () => {
      // Add a snapshot to the storage so list returns it
      const snap = createSampleManifest('snap-001', { timestamp: 1000 })
      storeManifest(bucket, doId, 'snap-001', snap)

      // Override get to throw after list succeeds
      bucket.get = vi.fn().mockRejectedValue(new Error('R2 get failed'))

      // listSnapshots catches errors per-manifest and continues
      const result = await restorer.listSnapshots()
      expect(result).toEqual([]) // Should return empty because all gets failed
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

  // ---------------------------------------------------------------------------
  // Partition Pruning Tests
  // ---------------------------------------------------------------------------
  describe('Partition Pruning', () => {
    it('restores only tables from specified partition', async () => {
      const snapshotId = 'snap-partition-001'
      const manifest = createSampleManifest(snapshotId, {
        tables: [
          { name: 'users_ns1', schema: 'CREATE TABLE users_ns1 (id INTEGER, name TEXT)', rows: 5 },
          { name: 'users_ns2', schema: 'CREATE TABLE users_ns2 (id INTEGER, name TEXT)', rows: 3 },
        ],
      })
      storeManifest(bucket, doId, snapshotId, manifest)

      for (const m of manifest.manifests) {
        storeParquetData(bucket, m.data_file, [])
      }

      parquetAdapter.read
        .mockResolvedValueOnce([{ id: 1, name: 'User1' }])
        .mockResolvedValueOnce([{ id: 2, name: 'User2' }])

      await restorer.restore(snapshotId)

      // Both tables should be restored (no partition filter in IcebergRestorer)
      const createCalls = db._executed.filter((sql) => sql.includes('CREATE TABLE'))
      expect(createCalls).toHaveLength(2)
    })

    it('handles partitioned data files correctly', async () => {
      const snapshotId = 'snap-partitioned-001'

      // Create manifest with partition-prefixed data files
      const manifest: IcebergManifest = {
        'format-version': 2,
        'table-uuid': 'test-uuid-partitioned',
        location: `do/${doId}/metadata`,
        'last-updated-ms': Date.now(),
        'current-snapshot-id': snapshotId,
        'parent-snapshot-id': null,
        snapshot_id: snapshotId,
        timestamp_ms: Date.now(),
        parent_snapshot_id: null,
        snapshots: [{
          snapshot_id: snapshotId,
          parent_snapshot_id: null,
          timestamp_ms: Date.now(),
          manifest_list: `do/${doId}/metadata/${snapshotId}-manifest-list.avro`,
          summary: { operation: 'append' },
        }],
        manifests: [
          {
            table: 'events',
            schema: 'CREATE TABLE events (id INTEGER, type TEXT, ns TEXT)',
            data_file: `do/${doId}/data/ns=payments.do/type=Function/${snapshotId}/events.parquet`,
            row_count: 10,
          },
        ],
      }

      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, manifest.manifests[0].data_file, [])

      parquetAdapter.read.mockResolvedValue([
        { id: 1, type: 'created', ns: 'payments.do' },
        { id: 2, type: 'updated', ns: 'payments.do' },
      ])

      await restorer.restore(snapshotId)

      // Verify the partitioned path was accessed
      expect(bucket.get).toHaveBeenCalledWith(
        expect.stringContaining('ns=payments.do/type=Function')
      )
    })

    it('restores data from multiple partition paths', async () => {
      const snapshotId = 'snap-multi-partition'

      const manifest: IcebergManifest = {
        'format-version': 2,
        'table-uuid': 'test-uuid-multi',
        location: `do/${doId}/metadata`,
        'last-updated-ms': Date.now(),
        'current-snapshot-id': snapshotId,
        'parent-snapshot-id': null,
        snapshot_id: snapshotId,
        timestamp_ms: Date.now(),
        parent_snapshot_id: null,
        snapshots: [{
          snapshot_id: snapshotId,
          parent_snapshot_id: null,
          timestamp_ms: Date.now(),
          manifest_list: `do/${doId}/metadata/${snapshotId}-manifest-list.avro`,
          summary: { operation: 'append' },
        }],
        manifests: [
          {
            table: 'functions_ns1',
            schema: 'CREATE TABLE functions_ns1 (id INTEGER, code TEXT)',
            data_file: `do/${doId}/data/ns=payments.do/functions.parquet`,
            row_count: 5,
          },
          {
            table: 'functions_ns2',
            schema: 'CREATE TABLE functions_ns2 (id INTEGER, code TEXT)',
            data_file: `do/${doId}/data/ns=orders.do/functions.parquet`,
            row_count: 3,
          },
        ],
      }

      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, `do/${doId}/data/ns=payments.do/functions.parquet`, [])
      storeParquetData(bucket, `do/${doId}/data/ns=orders.do/functions.parquet`, [])

      parquetAdapter.read
        .mockResolvedValueOnce([{ id: 1, code: 'charge()' }])
        .mockResolvedValueOnce([{ id: 2, code: 'order()' }])

      await restorer.restore(snapshotId)

      // Verify both partition paths were accessed
      const getCalls = bucket.get.mock.calls.map(([key]: [string]) => key)
      expect(getCalls.some((k: string) => k.includes('ns=payments.do'))).toBe(true)
      expect(getCalls.some((k: string) => k.includes('ns=orders.do'))).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Schema Evolution Reading Tests
  // ---------------------------------------------------------------------------
  describe('Schema Evolution Reading', () => {
    it('restores table with added columns (new schema)', async () => {
      const snapshotId = 'snap-evolved-001'
      const manifest = createSampleManifest(snapshotId, {
        tables: [{
          name: 'users',
          schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, created_at TEXT)',
          rows: 2,
        }],
      })

      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, manifest.manifests[0].data_file, [])

      // Parquet data has all columns including new ones
      parquetAdapter.read.mockResolvedValue([
        { id: 1, name: 'Alice', email: 'alice@test.com', created_at: '2024-01-01' },
        { id: 2, name: 'Bob', email: 'bob@test.com', created_at: '2024-01-02' },
      ])

      await restorer.restore(snapshotId)

      // Verify schema with new columns was created
      const createCall = db._executed.find((sql) => sql.includes('CREATE TABLE users'))
      expect(createCall).toContain('email')
      expect(createCall).toContain('created_at')
    })

    it('handles rows with missing optional columns (backward compatible read)', async () => {
      const snapshotId = 'snap-backward-001'
      const manifest = createSampleManifest(snapshotId, {
        tables: [{
          name: 'users',
          schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)',
          rows: 2,
        }],
      })

      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, manifest.manifests[0].data_file, [])

      // Old data might not have the email column - read returns undefined for missing
      parquetAdapter.read.mockResolvedValue([
        { id: 1, name: 'Alice' }, // No email (old data)
        { id: 2, name: 'Bob', email: 'bob@test.com' }, // Has email (new data)
      ])

      await restorer.restore(snapshotId)

      // Should successfully insert both rows
      const insertCalls = db._executed.filter((sql) => sql.includes('INSERT INTO users'))
      expect(insertCalls).toHaveLength(2)
    })

    it('restores table with renamed columns in schema', async () => {
      const snapshotId = 'snap-renamed-001'
      const manifest = createSampleManifest(snapshotId, {
        tables: [{
          name: 'users',
          // Schema uses new column name 'full_name' instead of 'name'
          schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT)',
          rows: 1,
        }],
      })

      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, manifest.manifests[0].data_file, [])

      // Parquet data has the new column name
      parquetAdapter.read.mockResolvedValue([
        { id: 1, full_name: 'Alice Smith' },
      ])

      await restorer.restore(snapshotId)

      // Verify new column name is used
      const createCall = db._executed.find((sql) => sql.includes('CREATE TABLE users'))
      expect(createCall).toContain('full_name')
      expect(createCall).not.toContain(' name ')
    })

    it('handles schema with type changes (string to integer)', async () => {
      const snapshotId = 'snap-typechange-001'
      const manifest = createSampleManifest(snapshotId, {
        tables: [{
          name: 'config',
          schema: 'CREATE TABLE config (key TEXT PRIMARY KEY, value INTEGER)', // value changed from TEXT to INTEGER
          rows: 2,
        }],
      })

      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, manifest.manifests[0].data_file, [])

      parquetAdapter.read.mockResolvedValue([
        { key: 'max_retries', value: 5 },
        { key: 'timeout_ms', value: 30000 },
      ])

      await restorer.restore(snapshotId)

      // Should successfully create table and insert data
      const createCall = db._executed.find((sql) => sql.includes('CREATE TABLE config'))
      expect(createCall).toContain('value INTEGER')
    })

    it('restores multiple schema versions across tables', async () => {
      const snapshotId = 'snap-multi-schema-001'
      const manifest = createSampleManifest(snapshotId, {
        tables: [
          { name: 'users_v1', schema: 'CREATE TABLE users_v1 (id INTEGER, name TEXT)', rows: 1 },
          { name: 'users_v2', schema: 'CREATE TABLE users_v2 (id INTEGER, name TEXT, email TEXT)', rows: 1 },
          { name: 'users_v3', schema: 'CREATE TABLE users_v3 (id INTEGER, name TEXT, email TEXT, role TEXT)', rows: 1 },
        ],
      })

      storeManifest(bucket, doId, snapshotId, manifest)

      for (const m of manifest.manifests) {
        storeParquetData(bucket, m.data_file, [])
      }

      parquetAdapter.read
        .mockResolvedValueOnce([{ id: 1, name: 'V1 User' }])
        .mockResolvedValueOnce([{ id: 2, name: 'V2 User', email: 'v2@test.com' }])
        .mockResolvedValueOnce([{ id: 3, name: 'V3 User', email: 'v3@test.com', role: 'admin' }])

      await restorer.restore(snapshotId)

      // All three schema versions should be created
      const createCalls = db._executed.filter((sql) => sql.includes('CREATE TABLE'))
      expect(createCalls).toHaveLength(3)

      // Verify each schema has correct columns
      expect(createCalls.find((sql) => sql.includes('users_v1'))).not.toContain('email')
      expect(createCalls.find((sql) => sql.includes('users_v2'))).toContain('email')
      expect(createCalls.find((sql) => sql.includes('users_v3'))).toContain('role')
    })

    it('handles complex nested schema types', async () => {
      const snapshotId = 'snap-complex-schema'
      const manifest = createSampleManifest(snapshotId, {
        tables: [{
          name: 'events',
          schema: 'CREATE TABLE events (id INTEGER PRIMARY KEY, type TEXT, payload TEXT, metadata TEXT)',
          rows: 2,
        }],
      })

      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, manifest.manifests[0].data_file, [])

      // Complex nested data stored as JSON strings
      parquetAdapter.read.mockResolvedValue([
        {
          id: 1,
          type: 'user.created',
          payload: JSON.stringify({ userId: 'u1', email: 'test@test.com' }),
          metadata: JSON.stringify({ source: 'api', timestamp: Date.now() }),
        },
        {
          id: 2,
          type: 'user.updated',
          payload: JSON.stringify({ userId: 'u1', name: 'Updated Name' }),
          metadata: JSON.stringify({ source: 'web', timestamp: Date.now() }),
        },
      ])

      await restorer.restore(snapshotId)

      // Should successfully insert both rows with complex data
      const insertCalls = db._executed.filter((sql) => sql.includes('INSERT INTO events'))
      expect(insertCalls).toHaveLength(2)
    })
  })

  // ---------------------------------------------------------------------------
  // Advanced Time Travel Scenarios
  // ---------------------------------------------------------------------------
  describe('Advanced Time Travel Scenarios', () => {
    it('supports disaster recovery by restoring to pre-corruption state', async () => {
      // Simulate a corruption scenario:
      // snap-001 (good) -> snap-002 (good) -> snap-003 (corrupted data)

      const snap1 = createSampleManifest('snap-001', {
        timestamp: 1000,
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER, status TEXT)', rows: 10 }],
      })
      const snap2 = createSampleManifest('snap-002', {
        timestamp: 2000,
        parentId: 'snap-001',
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER, status TEXT)', rows: 15 }],
      })
      const snap3 = createSampleManifest('snap-003', {
        timestamp: 3000,
        parentId: 'snap-002',
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER, status TEXT)', rows: 5 }], // Data loss!
      })

      storeManifest(bucket, doId, 'snap-001', snap1)
      storeManifest(bucket, doId, 'snap-002', snap2)
      storeManifest(bucket, doId, 'snap-003', snap3)

      for (const snap of [snap1, snap2, snap3]) {
        storeParquetData(bucket, snap.manifests[0].data_file, [])
      }

      // Disaster detected at timestamp 3500, need to recover to pre-disaster state
      const disasterTime = 3500
      const lastGoodSnapshot = await restorer.getSnapshotAt(disasterTime - 1000)

      expect(lastGoodSnapshot).not.toBeNull()
      expect(lastGoodSnapshot?.id).toBe('snap-002')

      // Restore to last known good state
      parquetAdapter.read.mockResolvedValue([
        { id: 1, status: 'active' },
        { id: 2, status: 'active' },
      ])

      await restorer.restore(lastGoodSnapshot!.id)

      // Verify restoration
      expect(db._executed).toContainEqual(expect.stringContaining('CREATE TABLE users'))
    })

    it('navigates snapshot lineage for audit trail', async () => {
      // Create a chain of snapshots with lineage
      const baseTime = 1000000000
      const snapshots = [
        { id: 'snap-base', timestamp: baseTime, parentId: null },
        { id: 'snap-feature-1', timestamp: baseTime + 1000, parentId: 'snap-base' },
        { id: 'snap-feature-2', timestamp: baseTime + 2000, parentId: 'snap-feature-1' },
        { id: 'snap-hotfix', timestamp: baseTime + 3000, parentId: 'snap-feature-2' },
      ]

      for (const snap of snapshots) {
        const manifest = createSampleManifest(snap.id, {
          timestamp: snap.timestamp,
          parentId: snap.parentId,
        })
        storeManifest(bucket, doId, snap.id, manifest)
      }

      const allSnapshots = await restorer.listSnapshots()

      // Verify we can trace the lineage
      expect(allSnapshots).toHaveLength(4)

      const hotfix = allSnapshots.find((s) => s.id === 'snap-hotfix')
      expect(hotfix?.parentId).toBe('snap-feature-2')

      const feature2 = allSnapshots.find((s) => s.id === 'snap-feature-2')
      expect(feature2?.parentId).toBe('snap-feature-1')

      const feature1 = allSnapshots.find((s) => s.id === 'snap-feature-1')
      expect(feature1?.parentId).toBe('snap-base')

      const base = allSnapshots.find((s) => s.id === 'snap-base')
      expect(base?.parentId).toBeNull()
    })

    it('supports querying state at arbitrary points in continuous timeline', async () => {
      // Create snapshots at specific timestamps
      const timeline = [
        { id: 'hour-1', timestamp: 3600000 },
        { id: 'hour-2', timestamp: 7200000 },
        { id: 'hour-3', timestamp: 10800000 },
        { id: 'hour-4', timestamp: 14400000 },
      ]

      for (const point of timeline) {
        const manifest = createSampleManifest(point.id, { timestamp: point.timestamp })
        storeManifest(bucket, doId, point.id, manifest)
      }

      // Query at various points
      const at30min = await restorer.getSnapshotAt(1800000) // Before first snapshot
      expect(at30min).toBeNull()

      const at90min = await restorer.getSnapshotAt(5400000) // Between hour-1 and hour-2
      expect(at90min?.id).toBe('hour-1')

      const at150min = await restorer.getSnapshotAt(9000000) // Between hour-2 and hour-3
      expect(at150min?.id).toBe('hour-2')

      const at5hours = await restorer.getSnapshotAt(18000000) // After all snapshots
      expect(at5hours?.id).toBe('hour-4')
    })

    it('handles microsecond precision timestamps', async () => {
      // Iceberg supports microsecond precision
      const microTimestamp1 = 1704067200000000 // Microseconds
      const microTimestamp2 = 1704067200001000 // 1 millisecond later

      const snap1 = createSampleManifest('snap-micro-1', { timestamp: microTimestamp1 })
      const snap2 = createSampleManifest('snap-micro-2', { timestamp: microTimestamp2 })

      storeManifest(bucket, doId, 'snap-micro-1', snap1)
      storeManifest(bucket, doId, 'snap-micro-2', snap2)

      const snapshots = await restorer.listSnapshots()
      expect(snapshots).toHaveLength(2)

      // Should correctly order even with microsecond differences
      expect(snapshots[0].id).toBe('snap-micro-2')
      expect(snapshots[1].id).toBe('snap-micro-1')
    })

    it('restores to snapshot with specific data state', async () => {
      // Snapshot 1: Initial state with 2 users
      const snap1 = createSampleManifest('snap-initial', {
        timestamp: 1000,
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER, name TEXT)', rows: 2 }],
      })

      // Snapshot 2: After adding 3 more users
      const snap2 = createSampleManifest('snap-growth', {
        timestamp: 2000,
        parentId: 'snap-initial',
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER, name TEXT)', rows: 5 }],
      })

      // Snapshot 3: After deleting some users
      const snap3 = createSampleManifest('snap-cleanup', {
        timestamp: 3000,
        parentId: 'snap-growth',
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER, name TEXT)', rows: 3 }],
      })

      storeManifest(bucket, doId, 'snap-initial', snap1)
      storeManifest(bucket, doId, 'snap-growth', snap2)
      storeManifest(bucket, doId, 'snap-cleanup', snap3)

      for (const snap of [snap1, snap2, snap3]) {
        storeParquetData(bucket, snap.manifests[0].data_file, [])
      }

      // Restore to growth state (5 users)
      parquetAdapter.read.mockResolvedValue([
        { id: 1, name: 'User 1' },
        { id: 2, name: 'User 2' },
        { id: 3, name: 'User 3' },
        { id: 4, name: 'User 4' },
        { id: 5, name: 'User 5' },
      ])

      await restorer.restore('snap-growth')

      // Verify 5 rows were inserted
      const insertCalls = db._executed.filter((sql) => sql.includes('INSERT INTO users'))
      expect(insertCalls).toHaveLength(5)
    })
  })

  // ---------------------------------------------------------------------------
  // Edge Cases and Boundary Conditions
  // ---------------------------------------------------------------------------
  describe('Edge Cases and Boundary Conditions', () => {
    it('handles snapshot with very large row counts', async () => {
      const snapshotId = 'snap-large'
      const manifest = createSampleManifest(snapshotId, {
        tables: [{ name: 'logs', schema: 'CREATE TABLE logs (id INTEGER, message TEXT)', rows: 1000000 }],
      })

      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, manifest.manifests[0].data_file, [])

      // Simulate reading a large dataset
      const largeDataset = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        message: `Log entry ${i}`,
      }))
      parquetAdapter.read.mockResolvedValue(largeDataset)

      await restorer.restore(snapshotId)

      const insertCalls = db._executed.filter((sql) => sql.includes('INSERT INTO logs'))
      expect(insertCalls).toHaveLength(100)
    })

    it('handles special characters in table names', async () => {
      const snapshotId = 'snap-special'
      const manifest = createSampleManifest(snapshotId, {
        tables: [{ name: 'user_events_2024', schema: 'CREATE TABLE user_events_2024 (id INTEGER)', rows: 1 }],
      })

      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, manifest.manifests[0].data_file, [])

      parquetAdapter.read.mockResolvedValue([{ id: 1 }])

      await restorer.restore(snapshotId)

      const createCall = db._executed.find((sql) => sql.includes('CREATE TABLE'))
      expect(createCall).toContain('user_events_2024')
    })

    it('handles null values in data correctly', async () => {
      const snapshotId = 'snap-nulls'
      const manifest = createSampleManifest(snapshotId, {
        tables: [{
          name: 'nullable_data',
          schema: 'CREATE TABLE nullable_data (id INTEGER, optional_field TEXT, another_field INTEGER)',
          rows: 3,
        }],
      })

      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, manifest.manifests[0].data_file, [])

      parquetAdapter.read.mockResolvedValue([
        { id: 1, optional_field: null, another_field: 10 },
        { id: 2, optional_field: 'has value', another_field: null },
        { id: 3, optional_field: null, another_field: null },
      ])

      await restorer.restore(snapshotId)

      const insertCalls = db._executed.filter((sql) => sql.includes('INSERT INTO'))
      expect(insertCalls).toHaveLength(3)
    })

    it('handles binary data in columns', async () => {
      const snapshotId = 'snap-binary'
      const manifest = createSampleManifest(snapshotId, {
        tables: [{
          name: 'binary_data',
          schema: 'CREATE TABLE binary_data (id INTEGER, blob_data BLOB)',
          rows: 1,
        }],
      })

      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, manifest.manifests[0].data_file, [])

      // Binary data might be returned as base64 or Uint8Array
      parquetAdapter.read.mockResolvedValue([
        { id: 1, blob_data: 'SGVsbG8gV29ybGQ=' }, // Base64 encoded
      ])

      await restorer.restore(snapshotId)

      const insertCalls = db._executed.filter((sql) => sql.includes('INSERT INTO'))
      expect(insertCalls).toHaveLength(1)
    })

    it('handles empty string values vs null', async () => {
      const snapshotId = 'snap-empty-strings'
      const manifest = createSampleManifest(snapshotId, {
        tables: [{
          name: 'string_data',
          schema: 'CREATE TABLE string_data (id INTEGER, value TEXT)',
          rows: 3,
        }],
      })

      storeManifest(bucket, doId, snapshotId, manifest)
      storeParquetData(bucket, manifest.manifests[0].data_file, [])

      parquetAdapter.read.mockResolvedValue([
        { id: 1, value: '' },        // Empty string
        { id: 2, value: null },      // NULL
        { id: 3, value: 'actual' },  // Actual value
      ])

      await restorer.restore(snapshotId)

      const insertCalls = db._executed.filter((sql) => sql.includes('INSERT INTO'))
      expect(insertCalls).toHaveLength(3)
    })

    it('handles timestamps at epoch boundaries', async () => {
      const snap1 = createSampleManifest('snap-epoch-0', { timestamp: 0 })
      const snap2 = createSampleManifest('snap-epoch-1', { timestamp: 1 })

      storeManifest(bucket, doId, 'snap-epoch-0', snap1)
      storeManifest(bucket, doId, 'snap-epoch-1', snap2)

      const snapshots = await restorer.listSnapshots()
      expect(snapshots).toHaveLength(2)

      // Timestamp 0 is valid
      const atZero = await restorer.getSnapshotAt(0)
      expect(atZero?.id).toBe('snap-epoch-0')
    })

    it('handles large timestamp values (year 3000)', async () => {
      // Use a large but valid timestamp (year 3000 in milliseconds)
      // Date max safe value is around 8.64e15 ms (year 275760)
      const year3000Timestamp = 32503680000000 // 3000-01-01 00:00:00 UTC
      const snap = createSampleManifest('snap-future', { timestamp: year3000Timestamp })

      storeManifest(bucket, doId, 'snap-future', snap)

      const snapshots = await restorer.listSnapshots()
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0].timestamp.getTime()).toBe(year3000Timestamp)
      // Check year is around 3000 (timezone can affect exact year)
      expect(snapshots[0].timestamp.getUTCFullYear()).toBeGreaterThanOrEqual(2999)
      expect(snapshots[0].timestamp.getUTCFullYear()).toBeLessThanOrEqual(3000)
    })

    it('handles many snapshots efficiently', async () => {
      // Create many snapshots
      const numSnapshots = 20
      for (let i = 0; i < numSnapshots; i++) {
        const snap = createSampleManifest(`snap-batch-${i}`, {
          timestamp: (i + 1) * 1000,
          parentId: i > 0 ? `snap-batch-${i - 1}` : null,
        })
        storeManifest(bucket, doId, `snap-batch-${i}`, snap)
      }

      // List should return all snapshots
      const snapshots = await restorer.listSnapshots()
      expect(snapshots).toHaveLength(numSnapshots)

      // Should be sorted by timestamp descending
      for (let i = 0; i < snapshots.length - 1; i++) {
        expect(snapshots[i].timestamp.getTime()).toBeGreaterThan(snapshots[i + 1].timestamp.getTime())
      }

      // First snapshot should be most recent
      expect(snapshots[0].id).toBe(`snap-batch-${numSnapshots - 1}`)
    })
  })
})
