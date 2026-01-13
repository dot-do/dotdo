/**
 * IcebergCatalog Tests (TDD - RED Phase)
 *
 * Tests for the IcebergCatalog that enables DuckDB to query Iceberg tables
 * stored in R2. This is the bridge between our Iceberg DO state and DuckDB analytics.
 *
 * Features:
 * - List available DOs and their tables
 * - Get schema information for tables
 * - Build query paths for DuckDB Parquet scanning
 * - Support time-travel queries via snapshot IDs
 *
 * @module db/do-analytics/tests/iceberg-catalog.test
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Iceberg manifest structure for catalog tests
 */
interface IcebergManifest {
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
    list: vi.fn(async (options?: { prefix?: string; delimiter?: string }) => {
      const objects: { key: string }[] = []
      const delimitedPrefixes: Set<string> = new Set()

      for (const key of storage.keys()) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          if (options?.delimiter) {
            // Extract the part after the prefix and before the next delimiter
            const afterPrefix = key.slice(options.prefix?.length || 0)
            const delimiterIndex = afterPrefix.indexOf(options.delimiter)
            if (delimiterIndex !== -1) {
              delimitedPrefixes.add((options.prefix || '') + afterPrefix.slice(0, delimiterIndex + 1))
            } else {
              objects.push({ key })
            }
          } else {
            objects.push({ key })
          }
        }
      }
      return {
        objects,
        truncated: false,
        delimitedPrefixes: Array.from(delimitedPrefixes),
      }
    }),
    delete: vi.fn(async (key: string) => {
      storage.delete(key)
    }),
    _storage: storage,
  }

  return bucket
}

/**
 * Create a sample manifest for testing
 */
function createSampleManifest(
  snapshotId: string,
  opts?: {
    parentId?: string | null
    timestamp?: number
    tables?: Array<{ name: string; schema: string; rows: number }>
    doId?: string
  }
): IcebergManifest {
  const timestamp = opts?.timestamp ?? Date.now()
  const testDoId = opts?.doId ?? 'test-do-123'
  const tables = opts?.tables ?? [
    { name: 'users', schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)', rows: 10 },
  ]

  return {
    'format-version': 2,
    'table-uuid': `uuid-${testDoId}`,
    location: `do/${testDoId}`,
    'last-updated-ms': timestamp,
    'last-column-id': 10,
    'current-snapshot-id': snapshotId,
    'parent-snapshot-id': opts?.parentId ?? null,
    snapshots: [
      {
        'snapshot-id': snapshotId,
        'parent-snapshot-id': opts?.parentId ?? null,
        'timestamp-ms': timestamp,
        'manifest-list': `do/${testDoId}/metadata/${snapshotId}-manifest-list.avro`,
        summary: { operation: 'append' },
      },
    ],
    schemas: tables.map((t, i) => ({
      'schema-id': i,
      type: 'struct' as const,
      fields: parseSchemaFields(t.schema),
    })),
    manifests: tables.map((t) => ({
      'manifest-path': `do/${testDoId}/data/${t.name}/${snapshotId}.parquet`,
      'manifest-length': 1024,
      'partition-spec-id': 0,
      content: 0 as const,
      'sequence-number': 1,
      'added-files-count': 1,
      'existing-files-count': 0,
      'deleted-files-count': 0,
      'added-rows-count': t.rows,
      table: t.name,
      schema: t.schema,
    })),
  }
}

/**
 * Parse CREATE TABLE to extract fields (simplified)
 */
function parseSchemaFields(createSql: string): SchemaField[] {
  const match = createSql.match(/\(([^)]+)\)/i)
  if (!match) return []

  const columns = match[1].split(',').map((c) => c.trim())
  return columns.map((col, i) => {
    const parts = col.split(/\s+/)
    return {
      id: i + 1,
      name: parts[0],
      required: col.toUpperCase().includes('NOT NULL') || col.toUpperCase().includes('PRIMARY KEY'),
      type: mapSqlTypeToIceberg(parts[1] || 'TEXT'),
    }
  })
}

function mapSqlTypeToIceberg(sqlType: string): string {
  const upper = sqlType.toUpperCase()
  if (upper.includes('INT')) return 'long'
  if (upper.includes('TEXT') || upper.includes('VARCHAR')) return 'string'
  if (upper.includes('REAL') || upper.includes('FLOAT')) return 'double'
  if (upper.includes('BOOL')) return 'boolean'
  return 'string'
}

/**
 * Store a manifest in the mock bucket
 */
function storeManifest(
  bucket: MockR2Bucket,
  doId: string,
  snapshotId: string,
  manifest: IcebergManifest
): void {
  const key = `do/${doId}/metadata/${snapshotId}.json`
  bucket._storage.set(key, JSON.stringify(manifest))
}

/**
 * Store current snapshot pointer
 */
function storeCurrentSnapshot(bucket: MockR2Bucket, doId: string, snapshotId: string): void {
  const key = `do/${doId}/metadata/current.json`
  bucket._storage.set(key, JSON.stringify({ current_snapshot_id: snapshotId }))
}

// =============================================================================
// Import the module under test
// =============================================================================

import { IcebergCatalog, type TableInfo, type DOInfo } from '../iceberg-catalog'

// =============================================================================
// Test Suite
// =============================================================================

describe('IcebergCatalog', () => {
  let bucket: MockR2Bucket
  let catalog: IcebergCatalog

  beforeEach(() => {
    vi.clearAllMocks()
    bucket = createMockR2Bucket()
    catalog = new IcebergCatalog(bucket as unknown as import('@cloudflare/workers-types').R2Bucket)
  })

  // ---------------------------------------------------------------------------
  // listDOs() Tests
  // ---------------------------------------------------------------------------
  describe('listDOs()', () => {
    it('returns empty array when no DOs exist', async () => {
      const dos = await catalog.listDOs()
      expect(dos).toEqual([])
    })

    it('lists all DOs with state in R2', async () => {
      // Setup: Create multiple DOs
      const manifest1 = createSampleManifest('snap-001', { doId: 'payments-do' })
      const manifest2 = createSampleManifest('snap-002', { doId: 'orders-do' })

      storeManifest(bucket, 'payments-do', 'snap-001', manifest1)
      storeCurrentSnapshot(bucket, 'payments-do', 'snap-001')
      storeManifest(bucket, 'orders-do', 'snap-002', manifest2)
      storeCurrentSnapshot(bucket, 'orders-do', 'snap-002')

      const dos = await catalog.listDOs()

      expect(dos).toHaveLength(2)
      expect(dos.map((d) => d.id)).toContain('payments-do')
      expect(dos.map((d) => d.id)).toContain('orders-do')
    })

    it('returns DO info with current snapshot ID', async () => {
      const manifest = createSampleManifest('snap-123', { doId: 'test-do', timestamp: 1000000 })
      storeManifest(bucket, 'test-do', 'snap-123', manifest)
      storeCurrentSnapshot(bucket, 'test-do', 'snap-123')

      const dos = await catalog.listDOs()

      expect(dos).toHaveLength(1)
      expect(dos[0]).toEqual({
        id: 'test-do',
        currentSnapshotId: 'snap-123',
        lastUpdatedMs: 1000000,
      })
    })

    it('excludes DOs without current.json', async () => {
      // Create manifest but no current.json
      const manifest = createSampleManifest('snap-001', { doId: 'incomplete-do' })
      storeManifest(bucket, 'incomplete-do', 'snap-001', manifest)

      // Create complete DO
      const manifest2 = createSampleManifest('snap-002', { doId: 'complete-do' })
      storeManifest(bucket, 'complete-do', 'snap-002', manifest2)
      storeCurrentSnapshot(bucket, 'complete-do', 'snap-002')

      const dos = await catalog.listDOs()

      expect(dos).toHaveLength(1)
      expect(dos[0].id).toBe('complete-do')
    })
  })

  // ---------------------------------------------------------------------------
  // listTables() Tests
  // ---------------------------------------------------------------------------
  describe('listTables(doId)', () => {
    it('throws error when DO not found', async () => {
      await expect(catalog.listTables('nonexistent')).rejects.toThrow('DO not found')
    })

    it('returns all tables in DO state', async () => {
      const manifest = createSampleManifest('snap-001', {
        doId: 'multi-table-do',
        tables: [
          { name: 'users', schema: 'CREATE TABLE users (id INTEGER, name TEXT)', rows: 10 },
          { name: 'orders', schema: 'CREATE TABLE orders (id INTEGER, user_id INTEGER, total REAL)', rows: 25 },
          { name: 'products', schema: 'CREATE TABLE products (id INTEGER, title TEXT)', rows: 50 },
        ],
      })
      storeManifest(bucket, 'multi-table-do', 'snap-001', manifest)
      storeCurrentSnapshot(bucket, 'multi-table-do', 'snap-001')

      const tables = await catalog.listTables('multi-table-do')

      expect(tables).toHaveLength(3)
      expect(tables.map((t) => t.name)).toContain('users')
      expect(tables.map((t) => t.name)).toContain('orders')
      expect(tables.map((t) => t.name)).toContain('products')
    })

    it('returns table info with row counts', async () => {
      const manifest = createSampleManifest('snap-001', {
        doId: 'counted-do',
        tables: [{ name: 'events', schema: 'CREATE TABLE events (id INTEGER, type TEXT)', rows: 1000 }],
      })
      storeManifest(bucket, 'counted-do', 'snap-001', manifest)
      storeCurrentSnapshot(bucket, 'counted-do', 'snap-001')

      const tables = await catalog.listTables('counted-do')

      expect(tables).toHaveLength(1)
      expect(tables[0]).toMatchObject({
        name: 'events',
        rowCount: 1000,
      })
    })

    it('returns table schema information', async () => {
      const manifest = createSampleManifest('snap-001', {
        doId: 'schema-do',
        tables: [
          {
            name: 'users',
            schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT)',
            rows: 5,
          },
        ],
      })
      storeManifest(bucket, 'schema-do', 'snap-001', manifest)
      storeCurrentSnapshot(bucket, 'schema-do', 'snap-001')

      const tables = await catalog.listTables('schema-do')

      expect(tables[0].columns).toHaveLength(3)
      expect(tables[0].columns).toContainEqual(
        expect.objectContaining({ name: 'id', type: 'long', required: true })
      )
      expect(tables[0].columns).toContainEqual(
        expect.objectContaining({ name: 'name', type: 'string', required: true })
      )
      expect(tables[0].columns).toContainEqual(
        expect.objectContaining({ name: 'email', type: 'string', required: false })
      )
    })
  })

  // ---------------------------------------------------------------------------
  // getTablePaths() Tests
  // ---------------------------------------------------------------------------
  describe('getTablePaths(doId, tableName)', () => {
    it('returns Parquet file paths for table', async () => {
      const manifest = createSampleManifest('snap-001', {
        doId: 'path-test-do',
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER)', rows: 10 }],
      })
      storeManifest(bucket, 'path-test-do', 'snap-001', manifest)
      storeCurrentSnapshot(bucket, 'path-test-do', 'snap-001')

      const paths = await catalog.getTablePaths('path-test-do', 'users')

      expect(paths).toHaveLength(1)
      expect(paths[0]).toContain('users')
      expect(paths[0]).toContain('.parquet')
    })

    it('throws error when table not found', async () => {
      const manifest = createSampleManifest('snap-001', {
        doId: 'missing-table-do',
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER)', rows: 10 }],
      })
      storeManifest(bucket, 'missing-table-do', 'snap-001', manifest)
      storeCurrentSnapshot(bucket, 'missing-table-do', 'snap-001')

      await expect(catalog.getTablePaths('missing-table-do', 'nonexistent')).rejects.toThrow('Table not found')
    })

    it('returns multiple paths for partitioned data', async () => {
      const manifest = createSampleManifest('snap-001', {
        doId: 'partitioned-do',
        tables: [{ name: 'events', schema: 'CREATE TABLE events (id INTEGER, type TEXT)', rows: 100 }],
      })
      // Add multiple manifest entries for same table (simulating partitions)
      manifest.manifests.push({
        'manifest-path': 'do/partitioned-do/data/events/snap-001-part2.parquet',
        'manifest-length': 1024,
        'partition-spec-id': 0,
        content: 0,
        'sequence-number': 1,
        'added-files-count': 1,
        'existing-files-count': 0,
        'deleted-files-count': 0,
        'added-rows-count': 50,
        table: 'events',
        schema: 'CREATE TABLE events (id INTEGER, type TEXT)',
      })
      storeManifest(bucket, 'partitioned-do', 'snap-001', manifest)
      storeCurrentSnapshot(bucket, 'partitioned-do', 'snap-001')

      const paths = await catalog.getTablePaths('partitioned-do', 'events')

      expect(paths.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ---------------------------------------------------------------------------
  // getCrossDoQuery() Tests
  // ---------------------------------------------------------------------------
  describe('getCrossDoQuery(tableName)', () => {
    it('generates query for all DOs with specified table', async () => {
      // Setup multiple DOs with same table structure
      const manifest1 = createSampleManifest('snap-001', {
        doId: 'do-1',
        tables: [{ name: 'orders', schema: 'CREATE TABLE orders (id INTEGER, amount REAL)', rows: 10 }],
      })
      const manifest2 = createSampleManifest('snap-002', {
        doId: 'do-2',
        tables: [{ name: 'orders', schema: 'CREATE TABLE orders (id INTEGER, amount REAL)', rows: 20 }],
      })
      const manifest3 = createSampleManifest('snap-003', {
        doId: 'do-3',
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER)', rows: 5 }], // Different table
      })

      storeManifest(bucket, 'do-1', 'snap-001', manifest1)
      storeCurrentSnapshot(bucket, 'do-1', 'snap-001')
      storeManifest(bucket, 'do-2', 'snap-002', manifest2)
      storeCurrentSnapshot(bucket, 'do-2', 'snap-002')
      storeManifest(bucket, 'do-3', 'snap-003', manifest3)
      storeCurrentSnapshot(bucket, 'do-3', 'snap-003')

      const query = await catalog.getCrossDoQuery('orders')

      // Should include paths from do-1 and do-2, not do-3
      expect(query.paths).toHaveLength(2)
      expect(query.paths.some((p) => p.includes('do-1'))).toBe(true)
      expect(query.paths.some((p) => p.includes('do-2'))).toBe(true)
      expect(query.paths.some((p) => p.includes('do-3'))).toBe(false)
    })

    it('includes DO id column in schema', async () => {
      const manifest = createSampleManifest('snap-001', {
        doId: 'test-do',
        tables: [{ name: 'data', schema: 'CREATE TABLE data (id INTEGER, value TEXT)', rows: 5 }],
      })
      storeManifest(bucket, 'test-do', 'snap-001', manifest)
      storeCurrentSnapshot(bucket, 'test-do', 'snap-001')

      const query = await catalog.getCrossDoQuery('data')

      // Query info should indicate do_id will be available
      expect(query.includesDoId).toBe(true)
    })

    it('returns empty result when no DOs have table', async () => {
      const manifest = createSampleManifest('snap-001', {
        doId: 'other-do',
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER)', rows: 5 }],
      })
      storeManifest(bucket, 'other-do', 'snap-001', manifest)
      storeCurrentSnapshot(bucket, 'other-do', 'snap-001')

      const query = await catalog.getCrossDoQuery('nonexistent_table')

      expect(query.paths).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Time Travel Tests
  // ---------------------------------------------------------------------------
  describe('Time Travel', () => {
    it('listTables returns tables at specific snapshot', async () => {
      // Create two snapshots with different tables
      const snap1 = createSampleManifest('snap-001', {
        doId: 'evolving-do',
        timestamp: 1000,
        tables: [{ name: 'users', schema: 'CREATE TABLE users (id INTEGER)', rows: 10 }],
      })
      const snap2 = createSampleManifest('snap-002', {
        doId: 'evolving-do',
        timestamp: 2000,
        parentId: 'snap-001',
        tables: [
          { name: 'users', schema: 'CREATE TABLE users (id INTEGER)', rows: 15 },
          { name: 'orders', schema: 'CREATE TABLE orders (id INTEGER)', rows: 5 },
        ],
      })

      storeManifest(bucket, 'evolving-do', 'snap-001', snap1)
      storeManifest(bucket, 'evolving-do', 'snap-002', snap2)
      storeCurrentSnapshot(bucket, 'evolving-do', 'snap-002')

      // Query at old snapshot
      const oldTables = await catalog.listTables('evolving-do', { snapshotId: 'snap-001' })
      expect(oldTables).toHaveLength(1)
      expect(oldTables[0].name).toBe('users')

      // Query at current snapshot
      const newTables = await catalog.listTables('evolving-do')
      expect(newTables).toHaveLength(2)
    })

    it('getTablePaths returns paths at specific snapshot', async () => {
      const snap1 = createSampleManifest('snap-001', {
        doId: 'versioned-do',
        tables: [{ name: 'data', schema: 'CREATE TABLE data (id INTEGER)', rows: 10 }],
      })
      const snap2 = createSampleManifest('snap-002', {
        doId: 'versioned-do',
        parentId: 'snap-001',
        tables: [{ name: 'data', schema: 'CREATE TABLE data (id INTEGER)', rows: 20 }],
      })

      storeManifest(bucket, 'versioned-do', 'snap-001', snap1)
      storeManifest(bucket, 'versioned-do', 'snap-002', snap2)
      storeCurrentSnapshot(bucket, 'versioned-do', 'snap-002')

      const oldPaths = await catalog.getTablePaths('versioned-do', 'data', { snapshotId: 'snap-001' })
      const newPaths = await catalog.getTablePaths('versioned-do', 'data')

      expect(oldPaths[0]).toContain('snap-001')
      expect(newPaths[0]).toContain('snap-002')
    })

    it('listSnapshots returns all snapshots for a DO', async () => {
      const snap1 = createSampleManifest('snap-001', {
        doId: 'history-do',
        timestamp: 1000,
        tables: [{ name: 'data', schema: 'CREATE TABLE data (id INTEGER)', rows: 5 }],
      })
      const snap2 = createSampleManifest('snap-002', {
        doId: 'history-do',
        timestamp: 2000,
        parentId: 'snap-001',
        tables: [{ name: 'data', schema: 'CREATE TABLE data (id INTEGER)', rows: 10 }],
      })

      storeManifest(bucket, 'history-do', 'snap-001', snap1)
      storeManifest(bucket, 'history-do', 'snap-002', snap2)
      storeCurrentSnapshot(bucket, 'history-do', 'snap-002')

      const snapshots = await catalog.listSnapshots('history-do')

      expect(snapshots).toHaveLength(2)
      expect(snapshots[0].id).toBe('snap-002') // Most recent first
      expect(snapshots[1].id).toBe('snap-001')
    })
  })

  // ---------------------------------------------------------------------------
  // buildDuckDbQuery() Tests
  // ---------------------------------------------------------------------------
  describe('buildDuckDbQuery()', () => {
    it('generates valid DuckDB parquet_scan for single DO', async () => {
      const manifest = createSampleManifest('snap-001', {
        doId: 'query-do',
        tables: [{ name: 'events', schema: 'CREATE TABLE events (id INTEGER, type TEXT)', rows: 100 }],
      })
      storeManifest(bucket, 'query-do', 'snap-001', manifest)
      storeCurrentSnapshot(bucket, 'query-do', 'snap-001')

      const sql = await catalog.buildDuckDbQuery('query-do', 'events')

      expect(sql).toContain("read_parquet")
      expect(sql).toContain('events')
    })

    it('generates UNION ALL query for cross-DO', async () => {
      const manifest1 = createSampleManifest('snap-001', {
        doId: 'union-do-1',
        tables: [{ name: 'logs', schema: 'CREATE TABLE logs (id INTEGER, msg TEXT)', rows: 50 }],
      })
      const manifest2 = createSampleManifest('snap-002', {
        doId: 'union-do-2',
        tables: [{ name: 'logs', schema: 'CREATE TABLE logs (id INTEGER, msg TEXT)', rows: 30 }],
      })

      storeManifest(bucket, 'union-do-1', 'snap-001', manifest1)
      storeCurrentSnapshot(bucket, 'union-do-1', 'snap-001')
      storeManifest(bucket, 'union-do-2', 'snap-002', manifest2)
      storeCurrentSnapshot(bucket, 'union-do-2', 'snap-002')

      const sql = await catalog.buildCrossDoQuery('logs')

      expect(sql).toContain('UNION ALL')
      expect(sql).toContain('union-do-1')
      expect(sql).toContain('union-do-2')
    })

    it('adds do_id column in cross-DO queries', async () => {
      const manifest = createSampleManifest('snap-001', {
        doId: 'id-do',
        tables: [{ name: 'data', schema: 'CREATE TABLE data (id INTEGER)', rows: 5 }],
      })
      storeManifest(bucket, 'id-do', 'snap-001', manifest)
      storeCurrentSnapshot(bucket, 'id-do', 'snap-001')

      const sql = await catalog.buildCrossDoQuery('data')

      expect(sql).toContain("'id-do' AS do_id")
    })
  })

  // ---------------------------------------------------------------------------
  // Error Handling Tests
  // ---------------------------------------------------------------------------
  describe('Error Handling', () => {
    it('handles R2 list failure gracefully', async () => {
      bucket.list = vi.fn().mockRejectedValue(new Error('R2 unavailable'))

      await expect(catalog.listDOs()).rejects.toThrow('R2 unavailable')
    })

    it('handles corrupt manifest gracefully', async () => {
      bucket._storage.set('do/corrupt-do/metadata/current.json', JSON.stringify({ current_snapshot_id: 'bad' }))
      bucket._storage.set('do/corrupt-do/metadata/bad.json', 'not valid json {{{')

      await expect(catalog.listTables('corrupt-do')).rejects.toThrow()
    })

    it('handles missing snapshot gracefully', async () => {
      const manifest = createSampleManifest('snap-001', { doId: 'missing-snap-do' })
      storeManifest(bucket, 'missing-snap-do', 'snap-001', manifest)
      storeCurrentSnapshot(bucket, 'missing-snap-do', 'snap-001')

      await expect(
        catalog.listTables('missing-snap-do', { snapshotId: 'nonexistent-snapshot' })
      ).rejects.toThrow('Snapshot not found')
    })
  })

  // ---------------------------------------------------------------------------
  // Aggregation Query Building Tests
  // ---------------------------------------------------------------------------
  describe('Aggregation Queries', () => {
    it('builds aggregation query across DOs', async () => {
      const manifest1 = createSampleManifest('snap-001', {
        doId: 'agg-do-1',
        tables: [{ name: 'orders', schema: 'CREATE TABLE orders (id INTEGER, amount REAL)', rows: 100 }],
      })
      const manifest2 = createSampleManifest('snap-002', {
        doId: 'agg-do-2',
        tables: [{ name: 'orders', schema: 'CREATE TABLE orders (id INTEGER, amount REAL)', rows: 200 }],
      })

      storeManifest(bucket, 'agg-do-1', 'snap-001', manifest1)
      storeCurrentSnapshot(bucket, 'agg-do-1', 'snap-001')
      storeManifest(bucket, 'agg-do-2', 'snap-002', manifest2)
      storeCurrentSnapshot(bucket, 'agg-do-2', 'snap-002')

      const sql = await catalog.buildAggregationQuery('orders', {
        select: ['do_id', 'SUM(amount) as total'],
        groupBy: ['do_id'],
      })

      expect(sql).toContain('SELECT')
      expect(sql).toContain('do_id')
      expect(sql).toContain('SUM(amount)')
      expect(sql).toContain('GROUP BY')
    })

    it('supports WHERE clause in aggregation', async () => {
      const manifest = createSampleManifest('snap-001', {
        doId: 'filter-do',
        tables: [{ name: 'events', schema: 'CREATE TABLE events (id INTEGER, type TEXT, value REAL)', rows: 50 }],
      })
      storeManifest(bucket, 'filter-do', 'snap-001', manifest)
      storeCurrentSnapshot(bucket, 'filter-do', 'snap-001')

      const sql = await catalog.buildAggregationQuery('events', {
        select: ['type', 'COUNT(*) as count'],
        where: "type = 'purchase'",
        groupBy: ['type'],
      })

      expect(sql).toContain('WHERE')
      expect(sql).toContain("type = 'purchase'")
    })
  })
})
