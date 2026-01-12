/**
 * Deep DuckDB-Iceberg Integration Tests
 *
 * Comprehensive TDD tests for DuckDB WASM + Iceberg tables stored in R2.
 *
 * Features tested:
 * - REST catalog protocol
 * - S3/R2 table locations
 * - Snapshot management and isolation
 * - Time-travel queries (AS OF TIMESTAMP)
 * - Partition pruning for R2-backed tables
 * - Table creation and schema evolution
 * - Compaction triggers
 *
 * @module db/compat/sql/duckdb-wasm/iceberg/tests/deep-integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Import types that will be implemented
import type {
  IcebergCatalog,
  IcebergTable,
  IcebergSnapshot,
  IcebergManifest,
  ManifestEntry,
  TimeTravelOptions,
  PartitionPruningResult,
  CompactionConfig,
  CompactionResult,
  SchemaEvolution,
  R2StorageAdapter,
  TableCommit,
  TransactionContext,
} from '../deep/types'

// Import implementations that will be created
import {
  createRESTCatalog,
  createR2StorageAdapter,
  createIcebergTable,
  createSnapshotManager,
  createPartitionPruner,
  createCompactionManager,
  parseTimeTravelQuery,
} from '../deep'

// ============================================================================
// Test Constants
// ============================================================================

const TEST_R2_CONFIG = {
  accountId: 'test-account',
  bucketName: 'iceberg-data',
  endpoint: 'https://test-account.r2.cloudflarestorage.com',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
}

const TEST_CATALOG_URI = 'https://catalog.test.com/v1'

// ============================================================================
// REST Catalog Protocol Tests
// ============================================================================

describe('REST Catalog Protocol', () => {
  let catalog: IcebergCatalog
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    catalog = createRESTCatalog({
      uri: TEST_CATALOG_URI,
      warehouse: 's3://iceberg-data/warehouse',
      credentials: {
        accessKeyId: TEST_R2_CONFIG.accessKeyId,
        secretAccessKey: TEST_R2_CONFIG.secretAccessKey,
      },
      fetchFn: mockFetch,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Configuration', () => {
    it('should fetch catalog configuration on connect', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          defaults: {
            'warehouse': 's3://iceberg-data/warehouse',
          },
          overrides: {},
        }),
      })

      const config = await catalog.getConfig()

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_CATALOG_URI}/config`,
        expect.objectContaining({ method: 'GET' })
      )
      expect(config.warehouse).toBe('s3://iceberg-data/warehouse')
    })

    it('should handle OAuth2 token exchange', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'oauth-token-12345',
          token_type: 'bearer',
          expires_in: 3600,
        }),
      })

      const catalog = createRESTCatalog({
        uri: TEST_CATALOG_URI,
        warehouse: 's3://iceberg-data/warehouse',
        oauth: {
          tokenEndpoint: `${TEST_CATALOG_URI}/oauth/tokens`,
          clientId: 'client-id',
          clientSecret: 'client-secret',
          scope: 'catalog',
        },
        fetchFn: mockFetch,
      })

      await catalog.authenticate()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/oauth/tokens'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('grant_type=client_credentials'),
        })
      )
    })
  })

  describe('Namespace Operations', () => {
    it('should list namespaces', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          namespaces: [['analytics'], ['production', 'events']],
        }),
      })

      const namespaces = await catalog.listNamespaces()

      expect(namespaces).toEqual([['analytics'], ['production', 'events']])
      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_CATALOG_URI}/namespaces`,
        expect.any(Object)
      )
    })

    it('should create namespace with properties', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          namespace: ['analytics'],
          properties: { location: 's3://data/analytics' },
        }),
      })

      const result = await catalog.createNamespace(['analytics'], {
        location: 's3://data/analytics',
      })

      expect(result.namespace).toEqual(['analytics'])
      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_CATALOG_URI}/namespaces`,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"namespace":["analytics"]'),
        })
      )
    })

    it('should get namespace properties', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          namespace: ['analytics'],
          properties: {
            location: 's3://data/analytics',
            owner: 'data-team',
          },
        }),
      })

      const props = await catalog.getNamespaceProperties(['analytics'])

      expect(props.location).toBe('s3://data/analytics')
      expect(props.owner).toBe('data-team')
    })
  })

  describe('Table Operations', () => {
    it('should list tables in namespace', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          identifiers: [
            { namespace: ['analytics'], name: 'events' },
            { namespace: ['analytics'], name: 'users' },
          ],
        }),
      })

      const tables = await catalog.listTables(['analytics'])

      expect(tables).toHaveLength(2)
      expect(tables[0].name).toBe('events')
    })

    it('should load table with full metadata', async () => {
      const mockMetadata = createMockTableMetadata()
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          metadata: mockMetadata,
          'metadata-location': 's3://data/analytics/events/metadata/v1.json',
        }),
      })

      const table = await catalog.loadTable(['analytics'], 'events')

      expect(table.metadata.formatVersion).toBe(2)
      expect(table.metadata.tableUuid).toBeDefined()
      expect(table.metadataLocation).toBe('s3://data/analytics/events/metadata/v1.json')
    })

    it('should create table with schema and partition spec', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          metadata: createMockTableMetadata(),
          'metadata-location': 's3://data/analytics/new_table/metadata/v1.json',
        }),
      })

      const result = await catalog.createTable(['analytics'], 'new_table', {
        schema: {
          type: 'struct',
          schemaId: 0,
          fields: [
            { id: 1, name: 'id', type: 'long', required: true },
            { id: 2, name: 'timestamp', type: 'timestamptz', required: true },
            { id: 3, name: 'event_type', type: 'string', required: true },
            { id: 4, name: 'payload', type: 'string', required: false },
          ],
        },
        partitionSpec: {
          specId: 0,
          fields: [
            { sourceId: 2, fieldId: 1000, name: 'day', transform: 'day' },
            { sourceId: 3, fieldId: 1001, name: 'event_type', transform: 'identity' },
          ],
        },
        writeOrder: {
          orderId: 0,
          fields: [
            { sourceId: 2, transform: 'identity', direction: 'asc', nullOrder: 'nulls-last' },
          ],
        },
      })

      expect(result.metadata).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/namespaces/analytics/tables'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('should commit table update transaction', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'metadata-location': 's3://data/analytics/events/metadata/v2.json',
        }),
      })

      const commit: TableCommit = {
        requirements: [
          { type: 'assert-current-schema-id', 'current-schema-id': 0 },
        ],
        updates: [
          { action: 'add-schema', schema: { type: 'struct', schemaId: 1, fields: [] } },
          { action: 'set-current-schema', 'schema-id': 1 },
        ],
      }

      await catalog.commitTable(['analytics'], 'events', commit)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/namespaces/analytics/tables/events'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"requirements"'),
        })
      )
    })

    it('should handle table not found error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          error: { message: 'Table not found', type: 'NoSuchTableException' },
        }),
      })

      await expect(
        catalog.loadTable(['analytics'], 'nonexistent')
      ).rejects.toThrow('Table not found')
    })

    it('should handle commit conflict error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            message: 'Commit conflict: table has been modified',
            type: 'CommitFailedException',
          },
        }),
      })

      await expect(
        catalog.commitTable(['analytics'], 'events', { requirements: [], updates: [] })
      ).rejects.toThrow('Commit conflict')
    })
  })
})

// ============================================================================
// S3/R2 Storage Adapter Tests
// ============================================================================

describe('R2 Storage Adapter', () => {
  let storage: R2StorageAdapter
  let mockR2Bucket: any

  beforeEach(() => {
    mockR2Bucket = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      head: vi.fn(),
    }

    storage = createR2StorageAdapter({
      bucket: mockR2Bucket,
      prefix: 'warehouse/',
    })
  })

  describe('File Operations', () => {
    it('should read metadata JSON files', async () => {
      const mockMetadata = createMockTableMetadata()
      mockR2Bucket.get.mockResolvedValueOnce({
        json: async () => mockMetadata,
        arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(mockMetadata)),
      })

      const metadata = await storage.readMetadata('analytics/events/metadata/v1.json')

      expect(metadata.formatVersion).toBe(2)
      expect(mockR2Bucket.get).toHaveBeenCalledWith('warehouse/analytics/events/metadata/v1.json')
    })

    it('should read Parquet files as ArrayBuffer', async () => {
      const mockParquet = new ArrayBuffer(1024)
      mockR2Bucket.get.mockResolvedValueOnce({
        arrayBuffer: async () => mockParquet,
      })

      const buffer = await storage.readParquet('analytics/events/data/part-00000.parquet')

      expect(buffer.byteLength).toBe(1024)
    })

    it('should read Avro manifest files', async () => {
      const mockAvro = new ArrayBuffer(512)
      mockR2Bucket.get.mockResolvedValueOnce({
        arrayBuffer: async () => mockAvro,
      })

      const buffer = await storage.readAvro('analytics/events/metadata/snap-123.avro')

      expect(buffer).toBeDefined()
    })

    it('should write metadata files atomically', async () => {
      mockR2Bucket.put.mockResolvedValueOnce({})

      const metadata = createMockTableMetadata()
      await storage.writeMetadata('analytics/events/metadata/v2.json', metadata)

      expect(mockR2Bucket.put).toHaveBeenCalledWith(
        'warehouse/analytics/events/metadata/v2.json',
        expect.any(String),
        expect.objectContaining({
          httpMetadata: { contentType: 'application/json' },
        })
      )
    })

    it('should write Parquet files', async () => {
      mockR2Bucket.put.mockResolvedValueOnce({})

      const parquetData = new ArrayBuffer(2048)
      await storage.writeParquet('analytics/events/data/part-00001.parquet', parquetData)

      expect(mockR2Bucket.put).toHaveBeenCalledWith(
        'warehouse/analytics/events/data/part-00001.parquet',
        parquetData,
        expect.objectContaining({
          httpMetadata: { contentType: 'application/octet-stream' },
        })
      )
    })

    it('should list files with prefix', async () => {
      mockR2Bucket.list.mockResolvedValueOnce({
        objects: [
          { key: 'warehouse/analytics/events/data/part-00000.parquet', size: 1000 },
          { key: 'warehouse/analytics/events/data/part-00001.parquet', size: 1200 },
        ],
        truncated: false,
      })

      const files = await storage.listFiles('analytics/events/data/')

      expect(files).toHaveLength(2)
      expect(files[0].key).toBe('analytics/events/data/part-00000.parquet')
    })

    it('should handle pagination for large listings', async () => {
      mockR2Bucket.list
        .mockResolvedValueOnce({
          objects: [{ key: 'warehouse/data/part-0.parquet', size: 100 }],
          truncated: true,
          cursor: 'cursor-1',
        })
        .mockResolvedValueOnce({
          objects: [{ key: 'warehouse/data/part-1.parquet', size: 100 }],
          truncated: false,
        })

      const files = await storage.listFiles('data/')

      expect(files).toHaveLength(2)
      expect(mockR2Bucket.list).toHaveBeenCalledTimes(2)
    })

    it('should delete files', async () => {
      mockR2Bucket.delete.mockResolvedValueOnce({})

      await storage.deleteFile('analytics/events/data/part-00000.parquet')

      expect(mockR2Bucket.delete).toHaveBeenCalledWith(
        'warehouse/analytics/events/data/part-00000.parquet'
      )
    })

    it('should check file existence', async () => {
      mockR2Bucket.head.mockResolvedValueOnce({ key: 'test', size: 100 })

      const exists = await storage.exists('analytics/events/metadata/v1.json')

      expect(exists).toBe(true)
    })

    it('should handle file not found', async () => {
      mockR2Bucket.get.mockResolvedValueOnce(null)

      await expect(
        storage.readMetadata('nonexistent.json')
      ).rejects.toThrow('File not found')
    })
  })

  describe('Path Resolution', () => {
    it('should resolve S3 paths to R2 keys', () => {
      const key = storage.resolveS3Path('s3://iceberg-data/warehouse/analytics/events')

      expect(key).toBe('warehouse/analytics/events')
    })

    it('should handle paths without s3:// prefix', () => {
      const key = storage.resolveS3Path('analytics/events/data')

      expect(key).toBe('analytics/events/data')
    })
  })
})

// ============================================================================
// Snapshot Management Tests
// ============================================================================

describe('Snapshot Management', () => {
  let snapshotManager: ReturnType<typeof createSnapshotManager>
  let mockStorage: R2StorageAdapter

  beforeEach(() => {
    mockStorage = {
      readMetadata: vi.fn(),
      readAvro: vi.fn(),
      writeMetadata: vi.fn(),
      readParquet: vi.fn(),
      writeParquet: vi.fn(),
      listFiles: vi.fn(),
      deleteFile: vi.fn(),
      exists: vi.fn(),
      resolveS3Path: vi.fn((p: string) => p),
    } as unknown as R2StorageAdapter

    snapshotManager = createSnapshotManager(mockStorage)
  })

  describe('Snapshot Listing', () => {
    it('should list all snapshots in table metadata', async () => {
      const metadata = createMockTableMetadata()
      metadata.snapshots = [
        createMockSnapshot(1, 1704067200000),
        createMockSnapshot(2, 1704153600000, 1),
        createMockSnapshot(3, 1704240000000, 2),
      ]

      const snapshots = await snapshotManager.listSnapshots(metadata)

      expect(snapshots).toHaveLength(3)
      expect(snapshots[0].snapshotId).toBe(1)
      expect(snapshots[2].parentSnapshotId).toBe(2)
    })

    it('should get current snapshot', async () => {
      const metadata = createMockTableMetadata()
      metadata.currentSnapshotId = 2
      metadata.snapshots = [
        createMockSnapshot(1, 1704067200000),
        createMockSnapshot(2, 1704153600000, 1),
      ]

      const current = await snapshotManager.getCurrentSnapshot(metadata)

      expect(current?.snapshotId).toBe(2)
    })

    it('should return null for empty table', async () => {
      const metadata = createMockTableMetadata()
      metadata.currentSnapshotId = null
      metadata.snapshots = []

      const current = await snapshotManager.getCurrentSnapshot(metadata)

      expect(current).toBeNull()
    })
  })

  describe('Snapshot Resolution', () => {
    it('should resolve snapshot by ID', async () => {
      const metadata = createMockTableMetadata()
      metadata.snapshots = [
        createMockSnapshot(1, 1704067200000),
        createMockSnapshot(2, 1704153600000, 1),
      ]

      const snapshot = await snapshotManager.resolveSnapshot(metadata, { snapshotId: 1 })

      expect(snapshot?.snapshotId).toBe(1)
    })

    it('should resolve snapshot by timestamp', async () => {
      const metadata = createMockTableMetadata()
      metadata.snapshots = [
        createMockSnapshot(1, 1704067200000), // 2024-01-01 00:00:00
        createMockSnapshot(2, 1704153600000, 1), // 2024-01-02 00:00:00
        createMockSnapshot(3, 1704240000000, 2), // 2024-01-03 00:00:00
      ]

      // Query at 2024-01-02 12:00:00 should return snapshot 2
      const snapshot = await snapshotManager.resolveSnapshot(metadata, {
        asOfTimestamp: 1704196800000,
      })

      expect(snapshot?.snapshotId).toBe(2)
    })

    it('should resolve snapshot by ref (branch/tag)', async () => {
      const metadata = createMockTableMetadata()
      metadata.refs = {
        main: { snapshotId: 3, type: 'branch' },
        'v1.0': { snapshotId: 1, type: 'tag' },
      }
      metadata.snapshots = [
        createMockSnapshot(1, 1704067200000),
        createMockSnapshot(2, 1704153600000, 1),
        createMockSnapshot(3, 1704240000000, 2),
      ]

      const tagSnapshot = await snapshotManager.resolveSnapshot(metadata, { ref: 'v1.0' })
      const branchSnapshot = await snapshotManager.resolveSnapshot(metadata, { ref: 'main' })

      expect(tagSnapshot?.snapshotId).toBe(1)
      expect(branchSnapshot?.snapshotId).toBe(3)
    })

    it('should throw for non-existent snapshot ID', async () => {
      const metadata = createMockTableMetadata()
      metadata.snapshots = [createMockSnapshot(1, 1704067200000)]

      await expect(
        snapshotManager.resolveSnapshot(metadata, { snapshotId: 999 })
      ).rejects.toThrow('Snapshot 999 not found')
    })

    it('should throw for timestamp before any snapshot', async () => {
      const metadata = createMockTableMetadata()
      metadata.snapshots = [createMockSnapshot(1, 1704067200000)] // 2024-01-01

      await expect(
        snapshotManager.resolveSnapshot(metadata, { asOfTimestamp: 1703980800000 }) // 2023-12-31
      ).rejects.toThrow('No snapshot found')
    })
  })

  describe('Manifest List Parsing', () => {
    it('should parse manifest list from snapshot', async () => {
      const mockManifestList = new ArrayBuffer(1024)
      ;(mockStorage.readAvro as any).mockResolvedValueOnce(mockManifestList)

      const snapshot = createMockSnapshot(1, Date.now())
      const manifests = await snapshotManager.getManifests(snapshot)

      expect(manifests).toBeDefined()
      expect(Array.isArray(manifests)).toBe(true)
    })

    it('should parse data file entries from manifest', async () => {
      const mockManifestData = new ArrayBuffer(512)
      ;(mockStorage.readAvro as any).mockResolvedValueOnce(mockManifestData)

      const manifest: IcebergManifest = {
        manifestPath: 's3://bucket/manifest-1.avro',
        manifestLength: 512,
        partitionSpecId: 0,
        addedSnapshotId: 1,
        addedFilesCount: 5,
        existingFilesCount: 0,
        deletedFilesCount: 0,
      }

      const entries = await snapshotManager.getManifestEntries(manifest)

      expect(entries).toBeDefined()
      expect(Array.isArray(entries)).toBe(true)
    })
  })

  describe('Snapshot Isolation', () => {
    it('should provide consistent view at snapshot', async () => {
      const metadata = createMockTableMetadata()
      metadata.snapshots = [
        createMockSnapshot(1, 1704067200000),
        createMockSnapshot(2, 1704153600000, 1),
      ]

      const view = await snapshotManager.createSnapshotView(metadata, 1)

      expect(view.snapshotId).toBe(1)
      expect(view.schema).toBeDefined()
      expect(view.partitionSpec).toBeDefined()
    })

    it('should track data files visible at snapshot', async () => {
      const metadata = createMockTableMetadata()
      metadata.snapshots = [createMockSnapshot(1, 1704067200000)]

      ;(mockStorage.readAvro as any).mockResolvedValue(new ArrayBuffer(100))

      const view = await snapshotManager.createSnapshotView(metadata, 1)
      const files = await view.getDataFiles()

      expect(Array.isArray(files)).toBe(true)
    })
  })
})

// ============================================================================
// Time-Travel Query Tests
// ============================================================================

describe('Time-Travel Queries', () => {
  describe('Query Parsing', () => {
    it('should parse AS OF TIMESTAMP clause', () => {
      const sql = "SELECT * FROM events FOR SYSTEM_TIME AS OF TIMESTAMP '2024-01-15T10:00:00Z'"
      const parsed = parseTimeTravelQuery(sql)

      expect(parsed.tableName).toBe('events')
      expect(parsed.asOfTimestamp).toBe(1705312800000)
    })

    it('should parse AS OF VERSION clause', () => {
      const sql = 'SELECT * FROM events FOR SYSTEM_VERSION AS OF 12345'
      const parsed = parseTimeTravelQuery(sql)

      expect(parsed.tableName).toBe('events')
      expect(parsed.snapshotId).toBe(12345)
    })

    it('should parse BEFORE clause', () => {
      const sql = "SELECT * FROM events FOR SYSTEM_TIME BEFORE TIMESTAMP '2024-01-15T10:00:00Z'"
      const parsed = parseTimeTravelQuery(sql)

      expect(parsed.tableName).toBe('events')
      expect(parsed.beforeTimestamp).toBe(1705312800000)
    })

    it('should handle ISO timestamp formats', () => {
      const sql1 = "SELECT * FROM t FOR SYSTEM_TIME AS OF TIMESTAMP '2024-01-15'"
      const sql2 = "SELECT * FROM t FOR SYSTEM_TIME AS OF TIMESTAMP '2024-01-15T00:00:00'"
      const sql3 = "SELECT * FROM t FOR SYSTEM_TIME AS OF TIMESTAMP '2024-01-15T00:00:00.000Z'"

      const p1 = parseTimeTravelQuery(sql1)
      const p2 = parseTimeTravelQuery(sql2)
      const p3 = parseTimeTravelQuery(sql3)

      expect(p1.asOfTimestamp).toBeDefined()
      expect(p2.asOfTimestamp).toBeDefined()
      expect(p3.asOfTimestamp).toBeDefined()
    })

    it('should preserve original query structure', () => {
      const sql = "SELECT id, COUNT(*) FROM events FOR SYSTEM_TIME AS OF TIMESTAMP '2024-01-15' WHERE type = 'click' GROUP BY id"
      const parsed = parseTimeTravelQuery(sql)

      expect(parsed.baseQuery).toContain('SELECT id, COUNT(*)')
      expect(parsed.baseQuery).toContain('GROUP BY id')
      expect(parsed.baseQuery).not.toContain('FOR SYSTEM_TIME')
    })
  })

  describe('Query Execution', () => {
    let table: IcebergTable
    let mockStorage: R2StorageAdapter

    beforeEach(() => {
      mockStorage = createMockStorage()
      // Use metadata with snapshots for time-travel tests
      const metadata = createMockTableMetadata()
      metadata.snapshots = [
        createMockSnapshot(1, 1704067200000), // 2024-01-01
        createMockSnapshot(2, 1704153600000, 1), // 2024-01-02
        createMockSnapshot(3, 1704240000000, 2), // 2024-01-03
      ]
      metadata.currentSnapshotId = 3

      table = createIcebergTable({
        metadata,
        storage: mockStorage,
      })
    })

    it('should execute query at specific snapshot', async () => {
      const result = await table.query(
        'SELECT * FROM events',
        { snapshotId: 1 }
      )

      expect(result.snapshotId).toBe(1)
      expect(result.rows).toBeDefined()
    })

    it('should execute query at specific timestamp', async () => {
      const result = await table.query(
        'SELECT * FROM events',
        { asOfTimestamp: 1704153600000 }
      )

      expect(result.snapshotId).toBeDefined()
      expect(result.asOfTimestamp).toBe(1704153600000)
    })

    it('should return metadata about time travel execution', async () => {
      const result = await table.query(
        'SELECT * FROM events',
        { asOfTimestamp: 1704153600000 }
      )

      expect(result.stats).toBeDefined()
      expect(result.stats.resolvedSnapshotId).toBeDefined()
      expect(result.stats.snapshotTimestamp).toBeDefined()
    })
  })
})

// ============================================================================
// Partition Pruning Tests
// ============================================================================

describe('Partition Pruning', () => {
  let pruner: ReturnType<typeof createPartitionPruner>

  beforeEach(() => {
    pruner = createPartitionPruner()
  })

  describe('Identity Partition Pruning', () => {
    it('should prune partitions for equality predicate', () => {
      const partitionSpec = {
        specId: 0,
        fields: [
          { sourceId: 1, fieldId: 1000, name: 'region', transform: 'identity' },
        ],
      }

      const partitions = [
        createMockPartition({ region: 'us-east-1' }, 'part-0.parquet'),
        createMockPartition({ region: 'us-west-2' }, 'part-1.parquet'),
        createMockPartition({ region: 'eu-west-1' }, 'part-2.parquet'),
      ]

      const result = pruner.prunePartitions(partitions, partitionSpec, {
        filters: [{ column: 'region', op: '=', value: 'us-west-2' }],
      })

      expect(result.selectedPartitions).toHaveLength(1)
      expect(result.selectedPartitions[0].values.region).toBe('us-west-2')
      expect(result.prunedCount).toBe(2)
    })

    it('should prune partitions for IN predicate', () => {
      const partitionSpec = {
        specId: 0,
        fields: [
          { sourceId: 1, fieldId: 1000, name: 'country', transform: 'identity' },
        ],
      }

      const partitions = [
        createMockPartition({ country: 'US' }, 'part-0.parquet'),
        createMockPartition({ country: 'UK' }, 'part-1.parquet'),
        createMockPartition({ country: 'DE' }, 'part-2.parquet'),
        createMockPartition({ country: 'FR' }, 'part-3.parquet'),
      ]

      const result = pruner.prunePartitions(partitions, partitionSpec, {
        filters: [{ column: 'country', op: 'IN', value: ['US', 'UK'] }],
      })

      expect(result.selectedPartitions).toHaveLength(2)
      expect(result.prunedCount).toBe(2)
    })
  })

  describe('Temporal Partition Pruning', () => {
    it('should prune year partitions', () => {
      const partitionSpec = {
        specId: 0,
        fields: [
          { sourceId: 1, fieldId: 1000, name: 'event_year', transform: 'year' },
        ],
      }

      const partitions = [
        createMockPartition({ event_year: 2022 }, 'part-2022.parquet'),
        createMockPartition({ event_year: 2023 }, 'part-2023.parquet'),
        createMockPartition({ event_year: 2024 }, 'part-2024.parquet'),
      ]

      // Filter using partition field name directly
      const result = pruner.prunePartitions(partitions, partitionSpec, {
        filters: [{ column: 'event_year', op: '>=', value: 2023 }],
      })

      expect(result.selectedPartitions).toHaveLength(2)
      expect(result.prunedCount).toBe(1)
    })

    it('should prune month partitions', () => {
      const partitionSpec = {
        specId: 0,
        fields: [
          { sourceId: 1, fieldId: 1000, name: 'event_month', transform: 'month' },
        ],
      }

      const partitions = [
        createMockPartition({ event_month: '2024-01' }, 'part-01.parquet'),
        createMockPartition({ event_month: '2024-02' }, 'part-02.parquet'),
        createMockPartition({ event_month: '2024-03' }, 'part-03.parquet'),
      ]

      // Filter using partition field name directly
      const result = pruner.prunePartitions(partitions, partitionSpec, {
        filters: [
          { column: 'event_month', op: 'BETWEEN', value: '2024-01', value2: '2024-02' },
        ],
      })

      expect(result.selectedPartitions).toHaveLength(2)
    })

    it('should prune day partitions', () => {
      const partitionSpec = {
        specId: 0,
        fields: [
          { sourceId: 1, fieldId: 1000, name: 'event_day', transform: 'day' },
        ],
      }

      const partitions = [
        createMockPartition({ event_day: '2024-01-15' }, 'part-15.parquet'),
        createMockPartition({ event_day: '2024-01-16' }, 'part-16.parquet'),
        createMockPartition({ event_day: '2024-01-17' }, 'part-17.parquet'),
      ]

      // Filter using partition field name directly
      const result = pruner.prunePartitions(partitions, partitionSpec, {
        filters: [{ column: 'event_day', op: '=', value: '2024-01-16' }],
      })

      expect(result.selectedPartitions).toHaveLength(1)
      expect(result.prunedCount).toBe(2)
    })

    it('should prune hour partitions', () => {
      const partitionSpec = {
        specId: 0,
        fields: [
          { sourceId: 1, fieldId: 1000, name: 'event_hour', transform: 'hour' },
        ],
      }

      const partitions = [
        createMockPartition({ event_hour: '2024-01-16-00' }, 'part-00.parquet'),
        createMockPartition({ event_hour: '2024-01-16-01' }, 'part-01.parquet'),
        createMockPartition({ event_hour: '2024-01-16-02' }, 'part-02.parquet'),
      ]

      // Filter using partition field name directly
      const result = pruner.prunePartitions(partitions, partitionSpec, {
        filters: [{ column: 'event_hour', op: '<', value: '2024-01-16-02' }],
      })

      expect(result.selectedPartitions).toHaveLength(2)
    })
  })

  describe('Bucket Partition Pruning', () => {
    it('should prune bucket partitions for equality on bucket field', () => {
      const partitionSpec = {
        specId: 0,
        fields: [
          { sourceId: 1, fieldId: 1000, name: 'id_bucket', transform: 'bucket[16]' },
        ],
      }

      const partitions = Array.from({ length: 16 }, (_, i) =>
        createMockPartition({ id_bucket: i }, `part-${i}.parquet`)
      )

      // Filter directly by bucket value (most common use case)
      const result = pruner.prunePartitions(partitions, partitionSpec, {
        filters: [{ column: 'id_bucket', op: '=', value: 5 }],
      })

      // Should select only bucket 5
      expect(result.selectedPartitions).toHaveLength(1)
      expect(result.selectedPartitions[0].values.id_bucket).toBe(5)
    })
  })

  describe('Min/Max Statistics Pruning', () => {
    it('should prune using column min/max statistics', () => {
      const partitions = [
        createMockPartitionWithStats({ min_id: 1, max_id: 100 }, 'part-0.parquet'),
        createMockPartitionWithStats({ min_id: 101, max_id: 200 }, 'part-1.parquet'),
        createMockPartitionWithStats({ min_id: 201, max_id: 300 }, 'part-2.parquet'),
      ]

      const result = pruner.pruneByStats(partitions, {
        filters: [{ column: 'id', op: '=', value: 150 }],
      })

      expect(result.selectedPartitions).toHaveLength(1)
      expect(result.selectedPartitions[0].path).toBe('part-1.parquet')
    })

    it('should prune using range predicate with stats', () => {
      const partitions = [
        createMockPartitionWithStats({ min_timestamp: '2024-01-01', max_timestamp: '2024-01-10' }, 'part-0.parquet'),
        createMockPartitionWithStats({ min_timestamp: '2024-01-11', max_timestamp: '2024-01-20' }, 'part-1.parquet'),
        createMockPartitionWithStats({ min_timestamp: '2024-01-21', max_timestamp: '2024-01-31' }, 'part-2.parquet'),
      ]

      const result = pruner.pruneByStats(partitions, {
        filters: [{ column: 'timestamp', op: '>', value: '2024-01-18' }],
      })

      expect(result.selectedPartitions).toHaveLength(2) // part-1 and part-2
    })
  })

  describe('Combined Pruning', () => {
    it('should combine partition pruning with stats pruning', () => {
      const partitionSpec = {
        specId: 0,
        fields: [
          { sourceId: 1, fieldId: 1000, name: 'region', transform: 'identity' },
        ],
      }

      const partitions = [
        createMockPartitionWithStatsAndValues(
          { region: 'us-east-1' },
          { min_amount: 0, max_amount: 100 },
          'part-0.parquet'
        ),
        createMockPartitionWithStatsAndValues(
          { region: 'us-east-1' },
          { min_amount: 100, max_amount: 200 },
          'part-1.parquet'
        ),
        createMockPartitionWithStatsAndValues(
          { region: 'us-west-2' },
          { min_amount: 0, max_amount: 150 },
          'part-2.parquet'
        ),
      ]

      const result = pruner.prune(partitions, partitionSpec, {
        filters: [
          { column: 'region', op: '=', value: 'us-east-1' },
          { column: 'amount', op: '>', value: 50 },
        ],
      })

      expect(result.selectedPartitions).toHaveLength(2)
      expect(result.prunedCount).toBe(1)
    })
  })
})

// ============================================================================
// Table Creation and Schema Evolution Tests
// ============================================================================

describe('Table Creation and Schema Evolution', () => {
  let catalog: IcebergCatalog
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    catalog = createRESTCatalog({
      uri: TEST_CATALOG_URI,
      warehouse: 's3://iceberg-data/warehouse',
      fetchFn: mockFetch,
    })
  })

  describe('Table Creation', () => {
    it('should create table with initial schema', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          metadata: createMockTableMetadata(),
          'metadata-location': 's3://data/table/metadata/v1.json',
        }),
      })

      const result = await catalog.createTable(['analytics'], 'events', {
        schema: {
          type: 'struct',
          schemaId: 0,
          fields: [
            { id: 1, name: 'id', type: 'long', required: true },
            { id: 2, name: 'data', type: 'string', required: false },
          ],
        },
      })

      expect(result.metadata.schemas).toHaveLength(1)
    })

    it('should create table with partition spec', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          metadata: createMockTableMetadata(),
        }),
      })

      await catalog.createTable(['analytics'], 'events', {
        schema: {
          type: 'struct',
          schemaId: 0,
          fields: [
            { id: 1, name: 'id', type: 'long', required: true },
            { id: 2, name: 'timestamp', type: 'timestamptz', required: true },
          ],
        },
        partitionSpec: {
          specId: 0,
          fields: [
            { sourceId: 2, fieldId: 1000, name: 'day', transform: 'day' },
          ],
        },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"partition-spec"'),
        })
      )
    })

    it('should create table with sort order', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          metadata: createMockTableMetadata(),
        }),
      })

      await catalog.createTable(['analytics'], 'events', {
        schema: {
          type: 'struct',
          schemaId: 0,
          fields: [
            { id: 1, name: 'id', type: 'long', required: true },
            { id: 2, name: 'timestamp', type: 'timestamptz', required: true },
          ],
        },
        writeOrder: {
          orderId: 0,
          fields: [
            { sourceId: 2, transform: 'identity', direction: 'asc', nullOrder: 'nulls-last' },
          ],
        },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"write-order"'),
        })
      )
    })
  })

  describe('Schema Evolution', () => {
    it('should add new column', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'metadata-location': 's3://data/table/metadata/v2.json',
        }),
      })

      const evolution: SchemaEvolution = {
        type: 'add-column',
        column: {
          id: 3,
          name: 'new_field',
          type: 'string',
          required: false,
        },
      }

      await catalog.evolveSchema(['analytics'], 'events', evolution)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"add-column"'),
        })
      )
    })

    it('should rename column', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'metadata-location': 's3://data/table/metadata/v2.json',
        }),
      })

      const evolution: SchemaEvolution = {
        type: 'rename-column',
        columnId: 2,
        newName: 'event_timestamp',
      }

      await catalog.evolveSchema(['analytics'], 'events', evolution)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"rename-column"'),
        })
      )
    })

    it('should make column optional', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'metadata-location': 's3://data/table/metadata/v2.json',
        }),
      })

      const evolution: SchemaEvolution = {
        type: 'make-optional',
        columnId: 2,
      }

      await catalog.evolveSchema(['analytics'], 'events', evolution)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"make-column-optional"'),
        })
      )
    })

    it('should widen column type', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'metadata-location': 's3://data/table/metadata/v2.json',
        }),
      })

      const evolution: SchemaEvolution = {
        type: 'update-column',
        columnId: 1,
        newType: 'decimal(20, 2)', // Widen from int to decimal
      }

      await catalog.evolveSchema(['analytics'], 'events', evolution)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"update-column"'),
        })
      )
    })

    it('should drop column', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'metadata-location': 's3://data/table/metadata/v2.json',
        }),
      })

      const evolution: SchemaEvolution = {
        type: 'delete-column',
        columnId: 3,
      }

      await catalog.evolveSchema(['analytics'], 'events', evolution)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"delete-column"'),
        })
      )
    })
  })
})

// ============================================================================
// Compaction Tests
// ============================================================================

describe('Compaction', () => {
  let compactionManager: ReturnType<typeof createCompactionManager>
  let mockStorage: R2StorageAdapter

  beforeEach(() => {
    mockStorage = createMockStorage()
    compactionManager = createCompactionManager(mockStorage)
  })

  describe('Compaction Analysis', () => {
    it('should identify small files for compaction', async () => {
      const files = [
        { path: 'part-0.parquet', sizeBytes: 1024 * 1024 }, // 1MB
        { path: 'part-1.parquet', sizeBytes: 2 * 1024 * 1024 }, // 2MB
        { path: 'part-2.parquet', sizeBytes: 512 * 1024 }, // 512KB
        { path: 'part-3.parquet', sizeBytes: 256 * 1024 }, // 256KB
        { path: 'part-4.parquet', sizeBytes: 100 * 1024 * 1024 }, // 100MB (target)
      ]

      const config: CompactionConfig = {
        targetFileSizeBytes: 128 * 1024 * 1024, // 128MB
        minInputFiles: 2,
        maxConcurrentTasks: 4,
      }

      const analysis = await compactionManager.analyze(files, config)

      expect(analysis.needsCompaction).toBe(true)
      expect(analysis.smallFiles.length).toBeGreaterThan(0)
      expect(analysis.estimatedOutputFiles).toBeLessThan(files.length)
    })

    it('should not recommend compaction for optimally sized files', async () => {
      const files = [
        { path: 'part-0.parquet', sizeBytes: 128 * 1024 * 1024 },
        { path: 'part-1.parquet', sizeBytes: 127 * 1024 * 1024 },
        { path: 'part-2.parquet', sizeBytes: 130 * 1024 * 1024 },
      ]

      const config: CompactionConfig = {
        targetFileSizeBytes: 128 * 1024 * 1024,
        minInputFiles: 2,
      }

      const analysis = await compactionManager.analyze(files, config)

      expect(analysis.needsCompaction).toBe(false)
    })

    it('should analyze files per partition', async () => {
      const partitions = {
        'day=2024-01-15': [
          { path: 'day=2024-01-15/part-0.parquet', sizeBytes: 1024 * 1024 },
          { path: 'day=2024-01-15/part-1.parquet', sizeBytes: 2 * 1024 * 1024 },
        ],
        'day=2024-01-16': [
          { path: 'day=2024-01-16/part-0.parquet', sizeBytes: 128 * 1024 * 1024 },
        ],
      }

      const config: CompactionConfig = {
        targetFileSizeBytes: 128 * 1024 * 1024,
        minInputFiles: 2,
      }

      const analysis = await compactionManager.analyzeByPartition(partitions, config)

      expect(analysis['day=2024-01-15'].needsCompaction).toBe(true)
      expect(analysis['day=2024-01-16'].needsCompaction).toBe(false)
    })
  })

  describe('Compaction Execution', () => {
    it('should compact small files into larger files', async () => {
      const files = [
        { path: 'part-0.parquet', sizeBytes: 10 * 1024 * 1024 },
        { path: 'part-1.parquet', sizeBytes: 10 * 1024 * 1024 },
        { path: 'part-2.parquet', sizeBytes: 10 * 1024 * 1024 },
      ]

      const config: CompactionConfig = {
        targetFileSizeBytes: 128 * 1024 * 1024,
        minInputFiles: 2,
      }

      const result = await compactionManager.compact(files, config)

      expect(result.success).toBe(true)
      expect(result.inputFiles).toEqual(files.map(f => f.path))
      expect(result.outputFiles.length).toBeLessThan(files.length)
    })

    it('should return compaction statistics', async () => {
      const files = [
        { path: 'part-0.parquet', sizeBytes: 10 * 1024 * 1024 },
        { path: 'part-1.parquet', sizeBytes: 10 * 1024 * 1024 },
      ]

      const config: CompactionConfig = {
        targetFileSizeBytes: 128 * 1024 * 1024,
        minInputFiles: 2,
      }

      const result = await compactionManager.compact(files, config)

      expect(result.stats).toBeDefined()
      expect(result.stats.inputFileCount).toBe(2)
      expect(result.stats.inputBytes).toBeDefined()
      expect(result.stats.outputFileCount).toBeDefined()
      expect(result.stats.outputBytes).toBeDefined()
      expect(result.stats.compactionRatio).toBeDefined()
    })
  })

  describe('Compaction Triggers', () => {
    it('should trigger compaction based on file count threshold', async () => {
      const metadata = createMockTableMetadata()
      const trigger = compactionManager.createTrigger({
        type: 'file-count',
        threshold: 10,
      })

      const files = Array.from({ length: 15 }, (_, i) => ({
        path: `part-${i}.parquet`,
        sizeBytes: 10 * 1024 * 1024,
      }))

      const shouldCompact = await trigger.evaluate(metadata, files)

      expect(shouldCompact).toBe(true)
    })

    it('should trigger compaction based on cumulative size threshold', async () => {
      const metadata = createMockTableMetadata()
      const trigger = compactionManager.createTrigger({
        type: 'cumulative-size',
        threshold: 5 * 1024 * 1024, // 5MB of small files threshold
        smallFileSizeBytes: 10 * 1024 * 1024, // Files < 10MB are small
      })

      const files = [
        { path: 'part-0.parquet', sizeBytes: 1 * 1024 * 1024 }, // 1MB - small
        { path: 'part-1.parquet', sizeBytes: 2 * 1024 * 1024 }, // 2MB - small
        { path: 'part-2.parquet', sizeBytes: 3 * 1024 * 1024 }, // 3MB - small
        { path: 'part-3.parquet', sizeBytes: 50 * 1024 * 1024 }, // 50MB - not small
      ]

      // Small files total: 1 + 2 + 3 = 6MB, which exceeds 5MB threshold
      const shouldCompact = await trigger.evaluate(metadata, files)

      expect(shouldCompact).toBe(true)
    })

    it('should trigger compaction based on time since last compaction', async () => {
      const metadata = createMockTableMetadata()
      metadata.properties = {
        'compaction.last-run': String(Date.now() - 48 * 60 * 60 * 1000), // 48 hours ago
      }

      const trigger = compactionManager.createTrigger({
        type: 'time-based',
        intervalMs: 24 * 60 * 60 * 1000, // 24 hours
      })

      const shouldCompact = await trigger.evaluate(metadata, [])

      expect(shouldCompact).toBe(true)
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('DuckDB-Iceberg Integration', () => {
  describe('Query Execution Pipeline', () => {
    it('should execute full query pipeline with partition pruning', async () => {
      const mockStorage = createMockStorage()
      const metadata = createMockTableMetadataWithPartitions()
      // Add a snapshot so the table has data
      metadata.snapshots = [createMockSnapshot(1, Date.now())]
      metadata.currentSnapshotId = 1

      const table = createIcebergTable({
        metadata,
        storage: mockStorage,
      })

      // Execute query with partition filter
      const result = await table.query(
        "SELECT * FROM events WHERE event_date = '2024-01-15'",
        {}
      )

      // Stats should be defined even if no actual files
      expect(result.stats).toBeDefined()
      expect(result.stats.filesScanned).toBeDefined()
    })

    it('should combine time travel with partition pruning', async () => {
      const mockStorage = createMockStorage()
      const metadata = createMockTableMetadataWithSnapshots()

      const table = createIcebergTable({
        metadata,
        storage: mockStorage,
      })

      const result = await table.query(
        "SELECT * FROM events WHERE region = 'us-west-2'",
        { asOfTimestamp: 1704153600000 }
      )

      expect(result.snapshotId).toBeDefined()
      expect(result.stats).toBeDefined()
    })
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

function createMockTableMetadata() {
  return {
    formatVersion: 2 as const,
    tableUuid: '550e8400-e29b-41d4-a716-446655440000',
    location: 's3://iceberg-data/warehouse/analytics/events',
    lastUpdatedMs: Date.now(),
    lastSequenceNumber: 1,
    lastColumnId: 4,
    schemas: [{
      schemaId: 0,
      type: 'struct' as const,
      fields: [
        { id: 1, name: 'id', type: 'long', required: true },
        { id: 2, name: 'timestamp', type: 'timestamptz', required: true },
        { id: 3, name: 'event_type', type: 'string', required: true },
        { id: 4, name: 'payload', type: 'string', required: false },
      ],
    }],
    currentSchemaId: 0,
    partitionSpecs: [{
      specId: 0,
      fields: [],
    }],
    defaultSpecId: 0,
    lastPartitionId: 0,
    sortOrders: [],
    defaultSortOrderId: 0,
    properties: {},
    currentSnapshotId: null as number | null,
    snapshots: [] as any[],
    snapshotLog: [],
    metadataLog: [],
    refs: {} as Record<string, any>,
  }
}

function createMockSnapshot(
  snapshotId: number,
  timestampMs: number,
  parentSnapshotId?: number
) {
  return {
    snapshotId,
    parentSnapshotId,
    sequenceNumber: snapshotId,
    timestampMs,
    manifestList: `s3://bucket/metadata/snap-${snapshotId}.avro`,
    summary: { operation: 'append' as const },
    schemaId: 0,
  }
}

function createMockPartition(values: Record<string, unknown>, path: string) {
  return {
    values,
    path,
    recordCount: 1000,
    fileSizeBytes: 10 * 1024 * 1024,
  }
}

function createMockPartitionWithStats(
  stats: Record<string, unknown>,
  path: string
) {
  return {
    path,
    recordCount: 1000,
    fileSizeBytes: 10 * 1024 * 1024,
    columnStats: stats,
    values: {},
  }
}

function createMockPartitionWithStatsAndValues(
  values: Record<string, unknown>,
  stats: Record<string, unknown>,
  path: string
) {
  return {
    values,
    path,
    recordCount: 1000,
    fileSizeBytes: 10 * 1024 * 1024,
    columnStats: stats,
  }
}

function createMockStorage(): R2StorageAdapter {
  return {
    readMetadata: vi.fn().mockResolvedValue(createMockTableMetadata()),
    readAvro: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
    writeMetadata: vi.fn().mockResolvedValue(undefined),
    readParquet: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
    writeParquet: vi.fn().mockResolvedValue(undefined),
    listFiles: vi.fn().mockResolvedValue([]),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    resolveS3Path: vi.fn((p: string) => p),
  } as unknown as R2StorageAdapter
}

function createMockTableMetadataWithPartitions() {
  const metadata = createMockTableMetadata()
  metadata.partitionSpecs = [{
    specId: 0,
    fields: [
      { sourceId: 2, fieldId: 1000, name: 'event_date', transform: 'day' },
    ],
  }]
  metadata.snapshots = [createMockSnapshot(1, Date.now())]
  metadata.currentSnapshotId = 1
  return metadata
}

function createMockTableMetadataWithSnapshots() {
  const metadata = createMockTableMetadata()
  metadata.snapshots = [
    createMockSnapshot(1, 1704067200000),
    createMockSnapshot(2, 1704153600000, 1),
    createMockSnapshot(3, 1704240000000, 2),
  ]
  metadata.currentSnapshotId = 3
  metadata.partitionSpecs = [{
    specId: 0,
    fields: [
      { sourceId: 3, fieldId: 1000, name: 'region', transform: 'identity' },
    ],
  }]
  return metadata
}
