/**
 * Compaction Tests (TDD - RED Phase)
 *
 * Tests for Iceberg file compaction functionality. Compaction merges small
 * Parquet files into larger ones to reduce file count and improve query performance.
 *
 * Key behaviors tested:
 * - Compact merges multiple small files into fewer large files
 * - Compaction creates new snapshot maintaining time-travel
 * - Row counts are preserved during compaction
 * - Schema is preserved during compaction
 * - Configurable target file size
 * - Threshold-based compaction (only compact when beneficial)
 *
 * @module db/iceberg/tests/compaction.test
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Iceberg manifest structure for compaction
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
interface MockR2Bucket {
  put: Mock
  get: Mock
  list: Mock
  delete: Mock
  _storage: Map<string, ArrayBuffer | string>
}

/**
 * Mock Parquet adapter interface
 */
interface MockParquetAdapter {
  read: Mock
  write: Mock
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
 * Create a mock Parquet adapter
 */
function createMockParquetAdapter(): MockParquetAdapter {
  return {
    read: vi.fn(async (buffer: ArrayBuffer) => {
      // Parse our mock "parquet" format (JSON with magic header)
      const bytes = new Uint8Array(buffer)
      const MAGIC_SIZE = 4
      const jsonBytes = bytes.slice(MAGIC_SIZE, bytes.length - MAGIC_SIZE)
      const jsonStr = new TextDecoder().decode(jsonBytes)
      return JSON.parse(jsonStr)
    }),
    write: vi.fn(async (rows: unknown[]) => {
      // Create mock "parquet" format
      const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31])
      const jsonData = JSON.stringify(rows)
      const jsonBytes = new TextEncoder().encode(jsonData)
      const buffer = new ArrayBuffer(PARQUET_MAGIC.length * 2 + jsonBytes.length)
      const view = new Uint8Array(buffer)
      view.set(PARQUET_MAGIC, 0)
      view.set(jsonBytes, PARQUET_MAGIC.length)
      view.set(PARQUET_MAGIC, PARQUET_MAGIC.length + jsonBytes.length)
      return buffer
    }),
  }
}

/** Default DO ID used in tests */
const DEFAULT_TEST_DO_ID = 'test-do-compact'

/**
 * Create sample manifest with multiple small files (for compaction testing)
 */
function createManifestWithSmallFiles(
  doId: string,
  snapshotId: string,
  opts?: {
    tableName?: string
    fileCount?: number
    rowsPerFile?: number
    fileSizeBytes?: number
  }
): IcebergSnapshotManifest {
  const tableName = opts?.tableName ?? 'users'
  const fileCount = opts?.fileCount ?? 5
  const rowsPerFile = opts?.rowsPerFile ?? 10
  const fileSizeBytes = opts?.fileSizeBytes ?? 1024 // 1KB per file

  const manifests: ManifestFileEntry[] = []
  for (let i = 0; i < fileCount; i++) {
    manifests.push({
      'manifest-path': `do/${doId}/data/${tableName}/part-${i}.parquet`,
      'manifest-length': fileSizeBytes,
      'partition-spec-id': 0,
      content: 0,
      'sequence-number': i + 1,
      'added-files-count': 1,
      'existing-files-count': 0,
      'deleted-files-count': 0,
      'added-rows-count': rowsPerFile,
      table: tableName,
      schema: `CREATE TABLE ${tableName} (id INTEGER PRIMARY KEY, name TEXT)`,
    })
  }

  return {
    'format-version': 2,
    'table-uuid': 'compact-test-uuid',
    location: `do/${doId}`,
    'last-updated-ms': Date.now(),
    'last-column-id': 2,
    'current-snapshot-id': snapshotId,
    'parent-snapshot-id': null,
    snapshots: [
      {
        'snapshot-id': snapshotId,
        'parent-snapshot-id': null,
        'timestamp-ms': Date.now(),
        'manifest-list': `do/${doId}/metadata/${snapshotId}-manifest-list.avro`,
        summary: {
          operation: 'append',
          'total-data-files': String(fileCount),
          'total-records': String(fileCount * rowsPerFile),
        },
      },
    ],
    schemas: [
      {
        'schema-id': 0,
        type: 'struct',
        fields: [
          { id: 1, name: 'id', required: true, type: 'long' },
          { id: 2, name: 'name', required: false, type: 'string' },
        ],
      },
    ],
    manifests,
  }
}

/**
 * Store manifest and data files in mock bucket
 */
function setupManifestWithData(
  bucket: MockR2Bucket,
  doId: string,
  snapshotId: string,
  manifest: IcebergSnapshotManifest,
  parquetAdapter: MockParquetAdapter
): void {
  // Store current pointer
  bucket._storage.set(
    `do/${doId}/metadata/current.json`,
    JSON.stringify({ current_snapshot_id: snapshotId })
  )

  // Store manifest
  bucket._storage.set(`do/${doId}/metadata/${snapshotId}.json`, JSON.stringify(manifest))

  // Store mock parquet files
  for (let i = 0; i < manifest.manifests.length; i++) {
    const entry = manifest.manifests[i]
    const rowCount = entry['added-rows-count']
    const rows = Array.from({ length: rowCount }, (_, j) => ({
      id: i * 100 + j,
      name: `User ${i * 100 + j}`,
    }))

    // Create mock parquet data
    const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31])
    const jsonData = JSON.stringify(rows)
    const jsonBytes = new TextEncoder().encode(jsonData)
    const buffer = new ArrayBuffer(PARQUET_MAGIC.length * 2 + jsonBytes.length)
    const view = new Uint8Array(buffer)
    view.set(PARQUET_MAGIC, 0)
    view.set(jsonBytes, PARQUET_MAGIC.length)
    view.set(PARQUET_MAGIC, PARQUET_MAGIC.length + jsonBytes.length)

    bucket._storage.set(entry['manifest-path'], buffer)
  }
}

/**
 * Helper to get manifest from mock bucket
 */
async function getManifest(bucket: MockR2Bucket, doId: string, snapshotId: string): Promise<IcebergSnapshotManifest> {
  const key = `do/${doId}/metadata/${snapshotId}.json`
  const content = bucket._storage.get(key)
  if (!content) {
    throw new Error(`Manifest not found at ${key}`)
  }
  return JSON.parse(typeof content === 'string' ? content : new TextDecoder().decode(content as ArrayBuffer))
}

// =============================================================================
// Import the module under test (will fail in RED phase)
// =============================================================================

import { IcebergCompactor, type CompactionResult, type CompactionOptions } from '../compaction'

// =============================================================================
// Test Suite
// =============================================================================

describe('IcebergCompactor', () => {
  let bucket: MockR2Bucket
  let parquetAdapter: MockParquetAdapter
  let compactor: IcebergCompactor
  const doId = DEFAULT_TEST_DO_ID

  beforeEach(() => {
    vi.clearAllMocks()
    bucket = createMockR2Bucket()
    parquetAdapter = createMockParquetAdapter()
    compactor = new IcebergCompactor(bucket as any, parquetAdapter as any)
  })

  // ---------------------------------------------------------------------------
  // Test: Compaction merges multiple files into fewer
  // ---------------------------------------------------------------------------
  describe('compaction merges files', () => {
    it('reduces file count when compacting multiple small files', async () => {
      const snapshotId = 'snap-before-compact'
      const manifest = createManifestWithSmallFiles(doId, snapshotId, {
        fileCount: 10,
        rowsPerFile: 5,
      })
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      expect(result.filesCompacted).toBe(10)
      expect(result.filesCreated).toBeLessThan(result.filesCompacted)
    })

    it('creates new snapshot with compacted manifest', async () => {
      const snapshotId = 'snap-before-compact'
      const manifest = createManifestWithSmallFiles(doId, snapshotId, {
        fileCount: 5,
        rowsPerFile: 10,
      })
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      expect(result.newSnapshotId).toBeDefined()
      expect(result.newSnapshotId).not.toBe(snapshotId)

      // New manifest should exist
      const newManifest = await getManifest(bucket, doId, result.newSnapshotId)
      expect(newManifest['format-version']).toBe(2)
    })

    it('new snapshot references original as parent', async () => {
      const snapshotId = 'snap-before-compact'
      const manifest = createManifestWithSmallFiles(doId, snapshotId)
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      const newManifest = await getManifest(bucket, doId, result.newSnapshotId)
      expect(newManifest['parent-snapshot-id']).toBe(snapshotId)
    })

    it('compacted files are larger than originals', async () => {
      const snapshotId = 'snap-before-compact'
      const manifest = createManifestWithSmallFiles(doId, snapshotId, {
        fileCount: 10,
        fileSizeBytes: 1024, // 1KB each = 10KB total
      })
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      const newManifest = await getManifest(bucket, doId, result.newSnapshotId)
      // Each compacted file should be larger than original small files
      for (const entry of newManifest.manifests) {
        expect(entry['manifest-length']).toBeGreaterThan(1024)
      }
    })

    it('updates current.json to point to new snapshot', async () => {
      const snapshotId = 'snap-before-compact'
      const manifest = createManifestWithSmallFiles(doId, snapshotId)
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      const currentContent = bucket._storage.get(`do/${doId}/metadata/current.json`)
      const current = JSON.parse(currentContent as string)
      expect(current.current_snapshot_id).toBe(result.newSnapshotId)
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Row count preservation
  // ---------------------------------------------------------------------------
  describe('row count preservation', () => {
    it('preserves total row count after compaction', async () => {
      const snapshotId = 'snap-rows'
      const fileCount = 5
      const rowsPerFile = 20
      const totalRows = fileCount * rowsPerFile

      const manifest = createManifestWithSmallFiles(doId, snapshotId, {
        fileCount,
        rowsPerFile,
      })
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      expect(result.totalRows).toBe(totalRows)

      // Verify in new manifest
      const newManifest = await getManifest(bucket, doId, result.newSnapshotId)
      const newTotalRows = newManifest.manifests.reduce((sum, m) => sum + m['added-rows-count'], 0)
      expect(newTotalRows).toBe(totalRows)
    })

    it('reports correct row counts in result', async () => {
      const snapshotId = 'snap-count'
      const manifest = createManifestWithSmallFiles(doId, snapshotId, {
        fileCount: 3,
        rowsPerFile: 15,
      })
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      expect(result.totalRows).toBe(45) // 3 * 15
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Schema preservation
  // ---------------------------------------------------------------------------
  describe('schema preservation', () => {
    it('preserves schema in compacted manifest', async () => {
      const snapshotId = 'snap-schema'
      const manifest = createManifestWithSmallFiles(doId, snapshotId)
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      const newManifest = await getManifest(bucket, doId, result.newSnapshotId)
      expect(newManifest.schemas).toEqual(manifest.schemas)
    })

    it('preserves table name in compacted entries', async () => {
      const snapshotId = 'snap-table'
      const tableName = 'custom_table'
      const manifest = createManifestWithSmallFiles(doId, snapshotId, { tableName })
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      const newManifest = await getManifest(bucket, doId, result.newSnapshotId)
      expect(newManifest.manifests[0].table).toBe(tableName)
    })

    it('preserves schema DDL in manifest entries', async () => {
      const snapshotId = 'snap-ddl'
      const manifest = createManifestWithSmallFiles(doId, snapshotId)
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      const newManifest = await getManifest(bucket, doId, result.newSnapshotId)
      expect(newManifest.manifests[0].schema).toContain('CREATE TABLE')
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Configurable target file size
  // ---------------------------------------------------------------------------
  describe('configurable target file size', () => {
    it('respects target file size option', async () => {
      const snapshotId = 'snap-target-size'
      const manifest = createManifestWithSmallFiles(doId, snapshotId, {
        fileCount: 10,
        rowsPerFile: 100,
        fileSizeBytes: 1024,
      })
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      // Target 5KB files
      const result = await compactor.compact(doId, { targetFileSizeBytes: 5 * 1024 })

      // Should create 2 files (10KB / 5KB)
      expect(result.filesCreated).toBe(2)
    })

    it('creates single file when target is very large', async () => {
      const snapshotId = 'snap-large-target'
      const manifest = createManifestWithSmallFiles(doId, snapshotId, {
        fileCount: 5,
        fileSizeBytes: 1024,
      })
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      // Target 100KB (larger than total)
      const result = await compactor.compact(doId, { targetFileSizeBytes: 100 * 1024 })

      expect(result.filesCreated).toBe(1)
    })

    it('uses default target size when not specified', async () => {
      const snapshotId = 'snap-default'
      const manifest = createManifestWithSmallFiles(doId, snapshotId)
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      // Default should be 64MB, so small test files should compact to 1
      expect(result.filesCreated).toBeGreaterThanOrEqual(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Threshold-based compaction
  // ---------------------------------------------------------------------------
  describe('threshold-based compaction', () => {
    it('skips compaction when file count is below threshold', async () => {
      const snapshotId = 'snap-below-threshold'
      const manifest = createManifestWithSmallFiles(doId, snapshotId, {
        fileCount: 2, // Below default threshold
      })
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId, { minFilesThreshold: 5 })

      expect(result.skipped).toBe(true)
      expect(result.reason).toContain('below threshold')
    })

    it('performs compaction when file count meets threshold', async () => {
      const snapshotId = 'snap-meets-threshold'
      const manifest = createManifestWithSmallFiles(doId, snapshotId, {
        fileCount: 10,
      })
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId, { minFilesThreshold: 5 })

      expect(result.skipped).toBe(false)
      expect(result.filesCompacted).toBe(10)
    })

    it('respects custom threshold value', async () => {
      const snapshotId = 'snap-custom-threshold'
      const manifest = createManifestWithSmallFiles(doId, snapshotId, {
        fileCount: 3,
      })
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      // With threshold 2, should compact
      const result = await compactor.compact(doId, { minFilesThreshold: 2 })

      expect(result.skipped).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Time travel preservation
  // ---------------------------------------------------------------------------
  describe('time travel preservation', () => {
    it('preserves original snapshot in history', async () => {
      const snapshotId = 'snap-original'
      const manifest = createManifestWithSmallFiles(doId, snapshotId)
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      const newManifest = await getManifest(bucket, doId, result.newSnapshotId)
      // Snapshot history should include both
      expect(newManifest.snapshots.length).toBe(2)
      expect(newManifest.snapshots.some((s) => s['snapshot-id'] === snapshotId)).toBe(true)
      expect(newManifest.snapshots.some((s) => s['snapshot-id'] === result.newSnapshotId)).toBe(true)
    })

    it('original data files remain accessible', async () => {
      const snapshotId = 'snap-accessible'
      const manifest = createManifestWithSmallFiles(doId, snapshotId, { fileCount: 3 })
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      await compactor.compact(doId)

      // Original manifest should still exist
      const originalManifest = await getManifest(bucket, doId, snapshotId)
      expect(originalManifest).toBeDefined()

      // Original data files should still exist
      for (const entry of originalManifest.manifests) {
        expect(bucket._storage.has(entry['manifest-path'])).toBe(true)
      }
    })

    it('compaction summary includes operation type', async () => {
      const snapshotId = 'snap-summary'
      const manifest = createManifestWithSmallFiles(doId, snapshotId)
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      const newManifest = await getManifest(bucket, doId, result.newSnapshotId)
      const newSnapshot = newManifest.snapshots.find((s) => s['snapshot-id'] === result.newSnapshotId)
      expect(newSnapshot?.summary.operation).toBe('replace')
      expect(newSnapshot?.summary['files-compacted']).toBeDefined()
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Multi-table compaction
  // ---------------------------------------------------------------------------
  describe('multi-table compaction', () => {
    it('compacts files per table independently', async () => {
      const snapshotId = 'snap-multi-table'

      // Create manifest with files from multiple tables
      const manifest: IcebergSnapshotManifest = {
        'format-version': 2,
        'table-uuid': 'multi-table-uuid',
        location: `do/${doId}`,
        'last-updated-ms': Date.now(),
        'last-column-id': 4,
        'current-snapshot-id': snapshotId,
        'parent-snapshot-id': null,
        snapshots: [
          {
            'snapshot-id': snapshotId,
            'parent-snapshot-id': null,
            'timestamp-ms': Date.now(),
            'manifest-list': '',
            summary: { operation: 'append' },
          },
        ],
        schemas: [
          {
            'schema-id': 0,
            type: 'struct',
            fields: [
              { id: 1, name: 'id', required: true, type: 'long' },
              { id: 2, name: 'name', required: false, type: 'string' },
            ],
          },
        ],
        manifests: [
          // 3 files for users table
          ...Array.from({ length: 3 }, (_, i) => ({
            'manifest-path': `do/${doId}/data/users/part-${i}.parquet`,
            'manifest-length': 1024,
            'partition-spec-id': 0,
            content: 0 as const,
            'sequence-number': i + 1,
            'added-files-count': 1,
            'existing-files-count': 0,
            'deleted-files-count': 0,
            'added-rows-count': 10,
            table: 'users',
            schema: 'CREATE TABLE users (id INTEGER, name TEXT)',
          })),
          // 4 files for orders table
          ...Array.from({ length: 4 }, (_, i) => ({
            'manifest-path': `do/${doId}/data/orders/part-${i}.parquet`,
            'manifest-length': 1024,
            'partition-spec-id': 0,
            content: 0 as const,
            'sequence-number': i + 4,
            'added-files-count': 1,
            'existing-files-count': 0,
            'deleted-files-count': 0,
            'added-rows-count': 15,
            table: 'orders',
            schema: 'CREATE TABLE orders (id INTEGER, total DECIMAL)',
          })),
        ],
      }

      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      expect(result.filesCompacted).toBe(7) // 3 + 4
      expect(result.totalRows).toBe(90) // 3*10 + 4*15

      const newManifest = await getManifest(bucket, doId, result.newSnapshotId)
      const tables = new Set(newManifest.manifests.map((m) => m.table))
      expect(tables.has('users')).toBe(true)
      expect(tables.has('orders')).toBe(true)
    })

    it('can compact specific table only', async () => {
      const snapshotId = 'snap-specific-table'
      const manifest: IcebergSnapshotManifest = {
        'format-version': 2,
        'table-uuid': 'specific-table-uuid',
        location: `do/${doId}`,
        'last-updated-ms': Date.now(),
        'last-column-id': 2,
        'current-snapshot-id': snapshotId,
        'parent-snapshot-id': null,
        snapshots: [
          {
            'snapshot-id': snapshotId,
            'parent-snapshot-id': null,
            'timestamp-ms': Date.now(),
            'manifest-list': '',
            summary: { operation: 'append' },
          },
        ],
        schemas: [],
        manifests: [
          ...Array.from({ length: 5 }, (_, i) => ({
            'manifest-path': `do/${doId}/data/users/part-${i}.parquet`,
            'manifest-length': 1024,
            'partition-spec-id': 0,
            content: 0 as const,
            'sequence-number': i + 1,
            'added-files-count': 1,
            'existing-files-count': 0,
            'deleted-files-count': 0,
            'added-rows-count': 10,
            table: 'users',
            schema: 'CREATE TABLE users (id INTEGER)',
          })),
          ...Array.from({ length: 5 }, (_, i) => ({
            'manifest-path': `do/${doId}/data/orders/part-${i}.parquet`,
            'manifest-length': 1024,
            'partition-spec-id': 0,
            content: 0 as const,
            'sequence-number': i + 6,
            'added-files-count': 1,
            'existing-files-count': 0,
            'deleted-files-count': 0,
            'added-rows-count': 10,
            table: 'orders',
            schema: 'CREATE TABLE orders (id INTEGER)',
          })),
        ],
      }

      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId, { table: 'users' })

      expect(result.filesCompacted).toBe(5) // Only users table

      const newManifest = await getManifest(bucket, doId, result.newSnapshotId)
      const usersFiles = newManifest.manifests.filter((m) => m.table === 'users')
      const ordersFiles = newManifest.manifests.filter((m) => m.table === 'orders')

      // Users should be compacted (1 file)
      expect(usersFiles.length).toBe(1)
      // Orders should remain unchanged (5 files)
      expect(ordersFiles.length).toBe(5)
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Error handling
  // ---------------------------------------------------------------------------
  describe('error handling', () => {
    it('throws error when DO not found', async () => {
      await expect(compactor.compact('nonexistent-do')).rejects.toThrow('DO not found')
    })

    it('throws error when current snapshot not found', async () => {
      bucket._storage.set(
        `do/${doId}/metadata/current.json`,
        JSON.stringify({ current_snapshot_id: 'missing-snapshot' })
      )

      await expect(compactor.compact(doId)).rejects.toThrow('Snapshot not found')
    })

    it('handles empty manifests array', async () => {
      const snapshotId = 'snap-empty'
      const manifest: IcebergSnapshotManifest = {
        'format-version': 2,
        'table-uuid': 'empty-uuid',
        location: `do/${doId}`,
        'last-updated-ms': Date.now(),
        'last-column-id': 0,
        'current-snapshot-id': snapshotId,
        'parent-snapshot-id': null,
        snapshots: [
          {
            'snapshot-id': snapshotId,
            'parent-snapshot-id': null,
            'timestamp-ms': Date.now(),
            'manifest-list': '',
            summary: { operation: 'append' },
          },
        ],
        schemas: [],
        manifests: [],
      }

      bucket._storage.set(
        `do/${doId}/metadata/current.json`,
        JSON.stringify({ current_snapshot_id: snapshotId })
      )
      bucket._storage.set(`do/${doId}/metadata/${snapshotId}.json`, JSON.stringify(manifest))

      const result = await compactor.compact(doId)

      expect(result.skipped).toBe(true)
      expect(result.reason).toContain('no files')
    })

    it('handles R2 put failure gracefully', async () => {
      const snapshotId = 'snap-r2-fail'
      const manifest = createManifestWithSmallFiles(doId, snapshotId)
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      bucket.put.mockRejectedValueOnce(new Error('R2 unavailable'))

      await expect(compactor.compact(doId)).rejects.toThrow('R2 unavailable')
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Compaction result
  // ---------------------------------------------------------------------------
  describe('compaction result', () => {
    it('returns comprehensive result object', async () => {
      const snapshotId = 'snap-result'
      const manifest = createManifestWithSmallFiles(doId, snapshotId, {
        fileCount: 10,
        rowsPerFile: 25,
      })
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      expect(result).toMatchObject({
        newSnapshotId: expect.any(String),
        previousSnapshotId: snapshotId,
        filesCompacted: 10,
        filesCreated: expect.any(Number),
        totalRows: 250,
        skipped: false,
      })
    })

    it('includes duration in result', async () => {
      const snapshotId = 'snap-duration'
      const manifest = createManifestWithSmallFiles(doId, snapshotId)
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      expect(result.durationMs).toBeDefined()
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('includes bytes compacted in result', async () => {
      const snapshotId = 'snap-bytes'
      const manifest = createManifestWithSmallFiles(doId, snapshotId, {
        fileCount: 5,
        fileSizeBytes: 2048,
      })
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId)

      expect(result.bytesCompacted).toBe(5 * 2048) // 5 files * 2KB
    })
  })

  // ---------------------------------------------------------------------------
  // Test: Force compaction
  // ---------------------------------------------------------------------------
  describe('force compaction', () => {
    it('force option bypasses threshold check', async () => {
      const snapshotId = 'snap-force'
      const manifest = createManifestWithSmallFiles(doId, snapshotId, {
        fileCount: 2, // Below default threshold
      })
      setupManifestWithData(bucket, doId, snapshotId, manifest, parquetAdapter)

      const result = await compactor.compact(doId, { force: true })

      expect(result.skipped).toBe(false)
      expect(result.filesCompacted).toBe(2)
    })
  })
})
