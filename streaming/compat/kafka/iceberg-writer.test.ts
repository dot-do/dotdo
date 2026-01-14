/**
 * @dotdo/kafka - IcebergWriter Pipeline Registration Tests (RED)
 *
 * FAILING tests for IcebergWriter - automatic Parquet file registration with
 * Iceberg metadata when Cloudflare Pipeline writes complete.
 *
 * When Cloudflare Pipelines write Parquet files to R2, we need to:
 * 1. Register the file with Iceberg metadata
 * 2. Update manifest files
 * 3. Create atomic snapshots
 * 4. Enable external tools to query the data
 *
 * Import from non-existent module so tests fail until implementation exists.
 *
 * @see https://iceberg.apache.org/spec/
 * @see https://developers.cloudflare.com/pipelines/
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// IMPORTS FROM NON-EXISTENT MODULE - WILL FAIL
// ============================================================================

import {
  IcebergWriter,
  // Data file registration types
  DataFileEntry,
  DataFileParams,
  RegisterDataFileResult,
  // Manifest types
  ManifestFile,
  ManifestEntry,
  ManifestWriter,
  // Snapshot types
  Snapshot,
  SnapshotCommitResult,
  // Metadata types
  IcebergTableMetadata,
  MetadataVersion,
  // Error types
  IcebergWriterError,
  IcebergConcurrentCommitError,
  IcebergManifestError,
  IcebergSnapshotError,
  // Configuration types
  IcebergWriterConfig,
  IcebergCatalog,
  // Utilities
  generateSnapshotId,
  generateManifestPath,
  computePartitionValues,
} from './iceberg-writer'

import type { R2Binding } from './kafka-pipelines'

// ============================================================================
// MOCK R2 BINDING FOR TESTS
// ============================================================================

function createMockR2(): R2Binding {
  const storage = new Map<string, string | ArrayBuffer>()

  return {
    get: vi.fn(async (key: string) => {
      const value = storage.get(key)
      if (!value) return null
      return {
        key,
        body: undefined,
        arrayBuffer: async () => (typeof value === 'string' ? new TextEncoder().encode(value).buffer : value),
        text: async () => (typeof value === 'string' ? value : new TextDecoder().decode(value as ArrayBuffer)),
        json: async () => JSON.parse(typeof value === 'string' ? value : new TextDecoder().decode(value as ArrayBuffer)),
      }
    }),
    put: vi.fn(async (key: string, value: ArrayBuffer | string) => {
      storage.set(key, value)
      return {
        key,
        body: undefined,
        arrayBuffer: async () => (typeof value === 'string' ? new TextEncoder().encode(value).buffer : value),
        text: async () => (typeof value === 'string' ? value : new TextDecoder().decode(value)),
        json: async () => JSON.parse(typeof value === 'string' ? value : new TextDecoder().decode(value)),
      }
    }),
    delete: vi.fn(async (key: string) => {
      storage.delete(key)
    }),
    list: vi.fn(async (options?: { prefix?: string }) => {
      const objects: Array<{ key: string }> = []
      for (const key of storage.keys()) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          objects.push({ key })
        }
      }
      return { objects }
    }),
  }
}

// ============================================================================
// MOCK ICEBERG CATALOG FOR TESTS
// ============================================================================

function createMockCatalog(): IcebergCatalog {
  return {
    loadTable: vi.fn(),
    createTable: vi.fn(),
    updateTable: vi.fn(),
    tableExists: vi.fn(),
  }
}

// ============================================================================
// ICEBERG WRITER CONSTRUCTION TESTS
// ============================================================================

describe('IcebergWriter construction', () => {
  let r2: R2Binding
  let catalog: IcebergCatalog

  beforeEach(() => {
    r2 = createMockR2()
    catalog = createMockCatalog()
  })

  it('should create writer with R2 binding and catalog', () => {
    const writer = new IcebergWriter(r2, catalog)
    expect(writer).toBeDefined()
    expect(writer).toBeInstanceOf(IcebergWriter)
  })

  it('should create writer with configuration options', () => {
    const config: IcebergWriterConfig = {
      warehouse: 's3://my-bucket/warehouse',
      defaultNamespace: 'events',
      formatVersion: 2,
      snapshotRetention: 7 * 24 * 60 * 60 * 1000, // 7 days
    }
    const writer = new IcebergWriter(r2, catalog, config)
    expect(writer).toBeDefined()
  })

  it('should default to format version 2', () => {
    const writer = new IcebergWriter(r2, catalog)
    expect(writer.formatVersion).toBe(2)
  })

  it('should support format version 1 configuration', () => {
    const writer = new IcebergWriter(r2, catalog, { formatVersion: 1 })
    expect(writer.formatVersion).toBe(1)
  })

  it('should expose R2 binding', () => {
    const writer = new IcebergWriter(r2, catalog)
    expect(writer.r2).toBe(r2)
  })

  it('should expose catalog', () => {
    const writer = new IcebergWriter(r2, catalog)
    expect(writer.catalog).toBe(catalog)
  })
})

// ============================================================================
// LOAD METADATA TESTS
// ============================================================================

describe('IcebergWriter.loadMetadata', () => {
  let writer: IcebergWriter
  let r2: R2Binding
  let catalog: IcebergCatalog

  beforeEach(() => {
    r2 = createMockR2()
    catalog = createMockCatalog()
    writer = new IcebergWriter(r2, catalog)
  })

  it('should load table metadata from catalog', async () => {
    const metadata = await writer.loadMetadata('events', 'page_views')

    expect(metadata).toBeDefined()
    expect(metadata.formatVersion).toBeDefined()
    expect(metadata.tableUuid).toBeDefined()
    expect(metadata.location).toBeDefined()
  })

  it('should return current snapshot ID', async () => {
    const metadata = await writer.loadMetadata('events', 'page_views')

    expect(metadata.currentSnapshotId).toBeDefined()
    // Can be null for empty tables
  })

  it('should return snapshots array', async () => {
    const metadata = await writer.loadMetadata('events', 'page_views')

    expect(metadata.snapshots).toBeInstanceOf(Array)
  })

  it('should return schemas array', async () => {
    const metadata = await writer.loadMetadata('events', 'page_views')

    expect(metadata.schemas).toBeInstanceOf(Array)
    expect(metadata.schemas.length).toBeGreaterThan(0)
  })

  it('should return partition specs', async () => {
    const metadata = await writer.loadMetadata('events', 'page_views')

    expect(metadata.partitionSpecs).toBeInstanceOf(Array)
  })

  it('should throw for non-existent table', async () => {
    await expect(
      writer.loadMetadata('events', 'non_existent_table')
    ).rejects.toThrow(IcebergWriterError)
  })

  it('should cache metadata for repeated calls', async () => {
    await writer.loadMetadata('events', 'page_views')
    await writer.loadMetadata('events', 'page_views')

    // Catalog should only be called once due to caching
    expect(catalog.loadTable).toHaveBeenCalledTimes(1)
  })

  it('should invalidate cache on demand', async () => {
    await writer.loadMetadata('events', 'page_views')
    writer.invalidateCache('events', 'page_views')
    await writer.loadMetadata('events', 'page_views')

    expect(catalog.loadTable).toHaveBeenCalledTimes(2)
  })
})

// ============================================================================
// REGISTER DATA FILE TESTS
// ============================================================================

describe('IcebergWriter.registerDataFile', () => {
  let writer: IcebergWriter
  let r2: R2Binding
  let catalog: IcebergCatalog

  beforeEach(() => {
    r2 = createMockR2()
    catalog = createMockCatalog()
    writer = new IcebergWriter(r2, catalog)
  })

  it('should register a new Parquet file', async () => {
    const params: DataFileParams = {
      tableName: 'page_views',
      namespace: 'events',
      filePath: 'data/events/page_views/2026/01/09/00001.parquet',
      recordCount: 1000,
      fileSizeBytes: 102400,
      partitionValues: { _partition_hour: '2026-01-09-12' },
    }

    const result = await writer.registerDataFile(params)

    expect(result).toBeDefined()
    expect(result.success).toBe(true)
    expect(result.entry).toBeDefined()
  })

  it('should create data file entry with correct format', async () => {
    const params: DataFileParams = {
      tableName: 'page_views',
      namespace: 'events',
      filePath: 'data/events/page_views/2026/01/09/00001.parquet',
      recordCount: 1000,
      fileSizeBytes: 102400,
      partitionValues: { _partition_hour: '2026-01-09-12' },
    }

    const result = await writer.registerDataFile(params)
    const entry = result.entry

    expect(entry.filePath).toBe(params.filePath)
    expect(entry.fileFormat).toBe('PARQUET')
    expect(entry.recordCount).toBe(1000)
    expect(entry.fileSizeBytes).toBe(102400)
    expect(entry.partition).toEqual({ _partition_hour: '2026-01-09-12' })
    expect(entry.status).toBe(1) // ADDED status
  })

  it('should validate required parameters', async () => {
    await expect(
      writer.registerDataFile({
        tableName: '',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
    ).rejects.toThrow(IcebergWriterError)
  })

  it('should validate file path format', async () => {
    await expect(
      writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: '', // Empty path
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
    ).rejects.toThrow(IcebergWriterError)
  })

  it('should validate record count is non-negative', async () => {
    await expect(
      writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: -1, // Invalid
        fileSizeBytes: 1024,
        partitionValues: {},
      })
    ).rejects.toThrow(IcebergWriterError)
  })

  it('should validate file size is positive', async () => {
    await expect(
      writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 0, // Invalid
        partitionValues: {},
      })
    ).rejects.toThrow(IcebergWriterError)
  })

  it('should support optional column statistics', async () => {
    const params: DataFileParams = {
      tableName: 'page_views',
      namespace: 'events',
      filePath: 'data/events/page_views/2026/01/09/00001.parquet',
      recordCount: 1000,
      fileSizeBytes: 102400,
      partitionValues: { _partition_hour: '2026-01-09-12' },
      columnStats: [
        {
          fieldId: 1,
          lowerBound: 'aaa',
          upperBound: 'zzz',
          nullCount: 0,
        },
        {
          fieldId: 2,
          lowerBound: '0',
          upperBound: '1000',
          nullCount: 5,
        },
      ],
    }

    const result = await writer.registerDataFile(params)

    expect(result.entry.columnStats).toBeDefined()
    expect(result.entry.columnStats).toHaveLength(2)
  })

  it('should support split offsets for large files', async () => {
    const params: DataFileParams = {
      tableName: 'page_views',
      namespace: 'events',
      filePath: 'data/events/page_views/2026/01/09/large.parquet',
      recordCount: 1000000,
      fileSizeBytes: 1024 * 1024 * 100, // 100MB
      partitionValues: {},
      splitOffsets: [0, 33554432, 67108864], // 32MB row groups
    }

    const result = await writer.registerDataFile(params)

    expect(result.entry.splitOffsets).toEqual([0, 33554432, 67108864])
  })

  it('should generate unique file sequence number', async () => {
    const params: DataFileParams = {
      tableName: 'page_views',
      namespace: 'events',
      filePath: 'data/file.parquet',
      recordCount: 100,
      fileSizeBytes: 1024,
      partitionValues: {},
    }

    const result1 = await writer.registerDataFile(params)
    const result2 = await writer.registerDataFile({
      ...params,
      filePath: 'data/file2.parquet',
    })

    expect(result1.entry.fileSequenceNumber).toBeDefined()
    expect(result2.entry.fileSequenceNumber).toBeDefined()
    expect(result2.entry.fileSequenceNumber).toBeGreaterThan(result1.entry.fileSequenceNumber!)
  })
})

// ============================================================================
// APPEND TO MANIFEST TESTS
// ============================================================================

describe('IcebergWriter.appendToManifest', () => {
  let writer: IcebergWriter
  let r2: R2Binding
  let catalog: IcebergCatalog
  let metadata: IcebergTableMetadata
  let entry: DataFileEntry

  beforeEach(async () => {
    r2 = createMockR2()
    catalog = createMockCatalog()
    writer = new IcebergWriter(r2, catalog)

    // Load metadata first
    metadata = await writer.loadMetadata('events', 'page_views')

    // Create a data file entry
    const result = await writer.registerDataFile({
      tableName: 'page_views',
      namespace: 'events',
      filePath: 'data/events/page_views/2026/01/09/00001.parquet',
      recordCount: 1000,
      fileSizeBytes: 102400,
      partitionValues: { _partition_hour: '2026-01-09-12' },
    })
    entry = result.entry
  })

  it('should append entry to new manifest', async () => {
    const manifest = await writer.appendToManifest(metadata, entry)

    expect(manifest).toBeDefined()
    expect(manifest.manifestPath).toBeDefined()
    expect(manifest.manifestPath).toContain('.avro')
  })

  it('should set manifest length after write', async () => {
    const manifest = await writer.appendToManifest(metadata, entry)

    expect(manifest.manifestLength).toBeGreaterThan(0)
  })

  it('should reference correct partition spec', async () => {
    const manifest = await writer.appendToManifest(metadata, entry)

    expect(manifest.partitionSpecId).toBe(metadata.defaultSpecId)
  })

  it('should set sequence numbers', async () => {
    const manifest = await writer.appendToManifest(metadata, entry)

    expect(manifest.sequenceNumber).toBeDefined()
    expect(manifest.minSequenceNumber).toBeDefined()
    expect(manifest.sequenceNumber).toBeGreaterThanOrEqual(manifest.minSequenceNumber!)
  })

  it('should track added files count', async () => {
    const manifest = await writer.appendToManifest(metadata, entry)

    expect(manifest.addedFilesCount).toBe(1)
    expect(manifest.existingFilesCount).toBe(0)
    expect(manifest.deletedFilesCount).toBe(0)
  })

  it('should track added rows count', async () => {
    const manifest = await writer.appendToManifest(metadata, entry)

    expect(manifest.addedRowsCount).toBe(entry.recordCount)
    expect(manifest.existingRowsCount).toBe(0)
    expect(manifest.deletedRowsCount).toBe(0)
  })

  it('should append multiple entries to same manifest', async () => {
    const entry2Result = await writer.registerDataFile({
      tableName: 'page_views',
      namespace: 'events',
      filePath: 'data/events/page_views/2026/01/09/00002.parquet',
      recordCount: 500,
      fileSizeBytes: 51200,
      partitionValues: { _partition_hour: '2026-01-09-12' },
    })

    const manifest = await writer.appendToManifest(metadata, entry, entry2Result.entry)

    expect(manifest.addedFilesCount).toBe(2)
    expect(manifest.addedRowsCount).toBe(1500) // 1000 + 500
  })

  it('should generate partition field summaries', async () => {
    const manifest = await writer.appendToManifest(metadata, entry)

    expect(manifest.partitions).toBeDefined()
    expect(manifest.partitions).toBeInstanceOf(Array)
    expect(manifest.partitions!.length).toBeGreaterThan(0)
  })

  it('should include partition bounds in summary', async () => {
    const manifest = await writer.appendToManifest(metadata, entry)

    const summary = manifest.partitions![0]
    expect(summary.containsNull).toBe(false)
    expect(summary.lowerBound).toBeDefined()
    expect(summary.upperBound).toBeDefined()
  })

  it('should write manifest to R2', async () => {
    const manifest = await writer.appendToManifest(metadata, entry)

    expect(r2.put).toHaveBeenCalled()
    const putCall = (r2.put as ReturnType<typeof vi.fn>).mock.calls.find((call: unknown[]) =>
      (call[0] as string).includes(manifest.manifestPath)
    )
    expect(putCall).toBeDefined()
  })

  it('should use Avro format for manifest', async () => {
    const manifest = await writer.appendToManifest(metadata, entry)

    expect(manifest.manifestPath).toMatch(/\.avro$/)
  })
})

// ============================================================================
// CREATE SNAPSHOT TESTS
// ============================================================================

describe('IcebergWriter.createSnapshot', () => {
  let writer: IcebergWriter
  let r2: R2Binding
  let catalog: IcebergCatalog
  let metadata: IcebergTableMetadata
  let manifest: ManifestFile

  beforeEach(async () => {
    r2 = createMockR2()
    catalog = createMockCatalog()
    writer = new IcebergWriter(r2, catalog)

    metadata = await writer.loadMetadata('events', 'page_views')

    const result = await writer.registerDataFile({
      tableName: 'page_views',
      namespace: 'events',
      filePath: 'data/events/page_views/2026/01/09/00001.parquet',
      recordCount: 1000,
      fileSizeBytes: 102400,
      partitionValues: { _partition_hour: '2026-01-09-12' },
    })

    manifest = await writer.appendToManifest(metadata, result.entry)
  })

  it('should create new snapshot', async () => {
    const snapshot = await writer.createSnapshot(metadata, manifest)

    expect(snapshot).toBeDefined()
    expect(snapshot.snapshotId).toBeDefined()
  })

  it('should generate unique snapshot ID', async () => {
    const snapshot = await writer.createSnapshot(metadata, manifest)

    expect(snapshot.snapshotId).toBeGreaterThan(0)
    // Should not conflict with existing snapshots
    const existingIds = metadata.snapshots?.map((s) => s.snapshotId) ?? []
    expect(existingIds).not.toContain(snapshot.snapshotId)
  })

  it('should reference parent snapshot', async () => {
    const snapshot = await writer.createSnapshot(metadata, manifest)

    expect(snapshot.parentSnapshotId).toBe(metadata.currentSnapshotId)
  })

  it('should set timestamp', async () => {
    const beforeTime = Date.now()
    const snapshot = await writer.createSnapshot(metadata, manifest)
    const afterTime = Date.now()

    expect(snapshot.timestampMs).toBeGreaterThanOrEqual(beforeTime)
    expect(snapshot.timestampMs).toBeLessThanOrEqual(afterTime)
  })

  it('should set sequence number', async () => {
    const snapshot = await writer.createSnapshot(metadata, manifest)

    expect(snapshot.sequenceNumber).toBeDefined()
    expect(snapshot.sequenceNumber).toBeGreaterThan(0)
  })

  it('should create manifest list file', async () => {
    const snapshot = await writer.createSnapshot(metadata, manifest)

    expect(snapshot.manifestList).toBeDefined()
    expect(snapshot.manifestList).toContain('snap-')
    expect(snapshot.manifestList).toMatch(/\.avro$/)
  })

  it('should include manifest in manifest list', async () => {
    const snapshot = await writer.createSnapshot(metadata, manifest)

    // The manifest list file should be written to R2
    expect(r2.put).toHaveBeenCalled()
    const putCalls = (r2.put as ReturnType<typeof vi.fn>).mock.calls
    const manifestListCall = putCalls.find((call: unknown[]) => (call[0] as string).includes('snap-'))
    expect(manifestListCall).toBeDefined()
  })

  it('should set operation summary', async () => {
    const snapshot = await writer.createSnapshot(metadata, manifest)

    expect(snapshot.summary).toBeDefined()
    expect(snapshot.summary!.operation).toBe('append')
  })

  it('should include added files summary', async () => {
    const snapshot = await writer.createSnapshot(metadata, manifest)

    expect(snapshot.summary!['added-data-files']).toBeDefined()
    expect(snapshot.summary!['added-records']).toBeDefined()
    expect(snapshot.summary!['added-files-size']).toBeDefined()
  })

  it('should support replace operation', async () => {
    const snapshot = await writer.createSnapshot(metadata, manifest, { operation: 'replace' })

    expect(snapshot.summary!.operation).toBe('replace')
  })

  it('should support overwrite operation', async () => {
    const snapshot = await writer.createSnapshot(metadata, manifest, { operation: 'overwrite' })

    expect(snapshot.summary!.operation).toBe('overwrite')
  })

  it('should support multiple manifests', async () => {
    const result2 = await writer.registerDataFile({
      tableName: 'page_views',
      namespace: 'events',
      filePath: 'data/events/page_views/2026/01/10/00001.parquet',
      recordCount: 2000,
      fileSizeBytes: 204800,
      partitionValues: { _partition_hour: '2026-01-10-00' },
    })

    const manifest2 = await writer.appendToManifest(metadata, result2.entry)
    const snapshot = await writer.createSnapshot(metadata, manifest, manifest2)

    expect(snapshot.summary!['added-data-files']).toBe('2')
    expect(snapshot.summary!['added-records']).toBe('3000')
  })

  it('should inherit manifests from parent snapshot', async () => {
    // Create first snapshot
    const snapshot1 = await writer.createSnapshot(metadata, manifest)

    // Update metadata with new snapshot
    metadata.snapshots = [...(metadata.snapshots ?? []), snapshot1]
    metadata.currentSnapshotId = snapshot1.snapshotId

    // Create second snapshot
    const result2 = await writer.registerDataFile({
      tableName: 'page_views',
      namespace: 'events',
      filePath: 'data/events/page_views/2026/01/10/00001.parquet',
      recordCount: 500,
      fileSizeBytes: 51200,
      partitionValues: { _partition_hour: '2026-01-10-00' },
    })
    const manifest2 = await writer.appendToManifest(metadata, result2.entry)
    const snapshot2 = await writer.createSnapshot(metadata, manifest2)

    expect(snapshot2.parentSnapshotId).toBe(snapshot1.snapshotId)
    // Manifest list should include both manifest files
  })
})

// ============================================================================
// COMMIT SNAPSHOT TESTS
// ============================================================================

describe('IcebergWriter.commitSnapshot', () => {
  let writer: IcebergWriter
  let r2: R2Binding
  let catalog: IcebergCatalog
  let metadata: IcebergTableMetadata
  let snapshot: Snapshot

  beforeEach(async () => {
    r2 = createMockR2()
    catalog = createMockCatalog()
    writer = new IcebergWriter(r2, catalog)

    metadata = await writer.loadMetadata('events', 'page_views')

    const result = await writer.registerDataFile({
      tableName: 'page_views',
      namespace: 'events',
      filePath: 'data/events/page_views/2026/01/09/00001.parquet',
      recordCount: 1000,
      fileSizeBytes: 102400,
      partitionValues: { _partition_hour: '2026-01-09-12' },
    })

    const manifest = await writer.appendToManifest(metadata, result.entry)
    snapshot = await writer.createSnapshot(metadata, manifest)
  })

  it('should commit snapshot atomically', async () => {
    const result = await writer.commitSnapshot('events', 'page_views', metadata, snapshot)

    expect(result).toBeDefined()
    expect(result.success).toBe(true)
  })

  it('should update current snapshot ID', async () => {
    const result = await writer.commitSnapshot('events', 'page_views', metadata, snapshot)

    expect(result.newCurrentSnapshotId).toBe(snapshot.snapshotId)
  })

  it('should write new metadata.json', async () => {
    await writer.commitSnapshot('events', 'page_views', metadata, snapshot)

    // Should write new metadata file
    const putCalls = (r2.put as ReturnType<typeof vi.fn>).mock.calls
    const metadataCall = putCalls.find((call: unknown[]) => (call[0] as string).includes('metadata'))
    expect(metadataCall).toBeDefined()
  })

  it('should include snapshot in metadata', async () => {
    const result = await writer.commitSnapshot('events', 'page_views', metadata, snapshot)

    expect(result.metadata.snapshots).toContainEqual(
      expect.objectContaining({ snapshotId: snapshot.snapshotId })
    )
  })

  it('should add to snapshot log', async () => {
    const result = await writer.commitSnapshot('events', 'page_views', metadata, snapshot)

    expect(result.metadata.snapshotLog).toBeDefined()
    expect(result.metadata.snapshotLog).toContainEqual(
      expect.objectContaining({ snapshotId: snapshot.snapshotId })
    )
  })

  it('should add to metadata log', async () => {
    const result = await writer.commitSnapshot('events', 'page_views', metadata, snapshot)

    expect(result.metadata.metadataLog).toBeDefined()
    expect(result.metadata.metadataLog!.length).toBeGreaterThan(0)
  })

  it('should increment last sequence number', async () => {
    const beforeSeq = metadata.lastSequenceNumber ?? 0
    const result = await writer.commitSnapshot('events', 'page_views', metadata, snapshot)

    expect(result.metadata.lastSequenceNumber).toBeGreaterThan(beforeSeq)
  })

  it('should update last updated timestamp', async () => {
    const beforeTime = Date.now()
    const result = await writer.commitSnapshot('events', 'page_views', metadata, snapshot)
    const afterTime = Date.now()

    expect(result.metadata.lastUpdatedMs).toBeGreaterThanOrEqual(beforeTime)
    expect(result.metadata.lastUpdatedMs).toBeLessThanOrEqual(afterTime)
  })

  it('should handle concurrent commit conflict', async () => {
    // Simulate another writer committing first
    vi.spyOn(catalog, 'updateTable').mockRejectedValueOnce(
      new IcebergConcurrentCommitError('Version conflict')
    )

    await expect(
      writer.commitSnapshot('events', 'page_views', metadata, snapshot)
    ).rejects.toThrow(IcebergConcurrentCommitError)
  })

  it('should retry on conflict with updated metadata', async () => {
    // First attempt fails with conflict
    vi.spyOn(catalog, 'updateTable')
      .mockRejectedValueOnce(new IcebergConcurrentCommitError('Version conflict'))
      .mockResolvedValueOnce({ success: true })

    const result = await writer.commitSnapshot('events', 'page_views', metadata, snapshot, {
      retries: 3,
      retryDelay: 100,
    })

    expect(result.success).toBe(true)
    expect(catalog.updateTable).toHaveBeenCalledTimes(2)
  })

  it('should fail after max retries', async () => {
    vi.spyOn(catalog, 'updateTable').mockRejectedValue(
      new IcebergConcurrentCommitError('Version conflict')
    )

    await expect(
      writer.commitSnapshot('events', 'page_views', metadata, snapshot, {
        retries: 3,
        retryDelay: 10,
      })
    ).rejects.toThrow(IcebergConcurrentCommitError)

    expect(catalog.updateTable).toHaveBeenCalledTimes(4) // Initial + 3 retries
  })

  it('should use optimistic concurrency control', async () => {
    const result = await writer.commitSnapshot('events', 'page_views', metadata, snapshot)

    // Should have passed the expected version to catalog
    expect(catalog.updateTable).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: metadata.lastSequenceNumber,
      })
    )
  })

  it('should rollback on failure', async () => {
    vi.spyOn(catalog, 'updateTable').mockRejectedValueOnce(new Error('Storage error'))

    try {
      await writer.commitSnapshot('events', 'page_views', metadata, snapshot)
    } catch {
      // Expected to fail
    }

    // Should not have updated current snapshot
    const currentMetadata = await writer.loadMetadata('events', 'page_views')
    expect(currentMetadata.currentSnapshotId).not.toBe(snapshot.snapshotId)
  })

  it('should update catalog after R2 write', async () => {
    await writer.commitSnapshot('events', 'page_views', metadata, snapshot)

    // R2 put should be called before catalog update
    const r2PutOrder = (r2.put as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    const catalogUpdateOrder = (catalog.updateTable as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]

    expect(r2PutOrder).toBeLessThan(catalogUpdateOrder)
  })
})

// ============================================================================
// ICEBERG FORMAT COMPLIANCE TESTS
// ============================================================================

describe('Iceberg format compliance', () => {
  let writer: IcebergWriter
  let r2: R2Binding
  let catalog: IcebergCatalog

  beforeEach(() => {
    r2 = createMockR2()
    catalog = createMockCatalog()
    writer = new IcebergWriter(r2, catalog)
  })

  describe('metadata.json format', () => {
    it('should produce valid v2 metadata structure', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')
      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
      const manifest = await writer.appendToManifest(metadata, result.entry)
      const snapshot = await writer.createSnapshot(metadata, manifest)
      const commitResult = await writer.commitSnapshot('events', 'page_views', metadata, snapshot)

      const finalMetadata = commitResult.metadata

      // Required v2 fields
      expect(finalMetadata.formatVersion).toBe(2)
      expect(finalMetadata.tableUuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
      expect(finalMetadata.location).toBeDefined()
      expect(finalMetadata.lastSequenceNumber).toBeGreaterThan(0)
      expect(finalMetadata.lastUpdatedMs).toBeGreaterThan(0)
      expect(finalMetadata.lastColumnId).toBeGreaterThan(0)
      expect(finalMetadata.currentSchemaId).toBeDefined()
      expect(finalMetadata.schemas).toBeInstanceOf(Array)
      expect(finalMetadata.defaultSpecId).toBeDefined()
      expect(finalMetadata.partitionSpecs).toBeInstanceOf(Array)
      expect(finalMetadata.lastPartitionId).toBeDefined()
      expect(finalMetadata.defaultSortOrderId).toBeDefined()
      expect(finalMetadata.sortOrders).toBeInstanceOf(Array)
      expect(finalMetadata.snapshots).toBeInstanceOf(Array)
    })

    it('should use correct field names (kebab-case)', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')

      // When serialized, should use kebab-case per Iceberg spec
      const serialized = writer.serializeMetadata(metadata)
      const parsed = JSON.parse(serialized)

      expect(parsed['format-version']).toBeDefined()
      expect(parsed['table-uuid']).toBeDefined()
      expect(parsed['last-sequence-number']).toBeDefined()
      expect(parsed['last-updated-ms']).toBeDefined()
      expect(parsed['last-column-id']).toBeDefined()
      expect(parsed['current-schema-id']).toBeDefined()
      expect(parsed['default-spec-id']).toBeDefined()
      expect(parsed['partition-specs']).toBeDefined()
      expect(parsed['default-sort-order-id']).toBeDefined()
      expect(parsed['sort-orders']).toBeDefined()
      expect(parsed['current-snapshot-id']).toBeDefined()
    })

    it('should include snapshot-log and metadata-log', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')
      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
      const manifest = await writer.appendToManifest(metadata, result.entry)
      const snapshot = await writer.createSnapshot(metadata, manifest)
      const commitResult = await writer.commitSnapshot('events', 'page_views', metadata, snapshot)

      expect(commitResult.metadata.snapshotLog).toBeDefined()
      expect(commitResult.metadata.metadataLog).toBeDefined()
    })
  })

  describe('manifest list format', () => {
    it('should produce valid manifest list entries', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')
      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: { hour: '2026-01-09-12' },
      })
      const manifest = await writer.appendToManifest(metadata, result.entry)

      // Manifest list entry should have correct fields
      expect(manifest.manifestPath).toBeDefined()
      expect(manifest.manifestLength).toBeGreaterThan(0)
      expect(manifest.partitionSpecId).toBeDefined()
      expect(manifest.content).toBe(0) // 0 = data files
      expect(manifest.sequenceNumber).toBeGreaterThan(0)
      expect(manifest.addedSnapshotId).toBeDefined()
      expect(manifest.addedFilesCount).toBeGreaterThanOrEqual(0)
      expect(manifest.existingFilesCount).toBeDefined()
      expect(manifest.deletedFilesCount).toBeDefined()
      expect(manifest.addedRowsCount).toBeDefined()
    })

    it('should include partition field summaries', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')
      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: { ns: 'test.do', type: 'Event' },
      })
      const manifest = await writer.appendToManifest(metadata, result.entry)

      expect(manifest.partitions).toBeDefined()
      expect(manifest.partitions!.length).toBeGreaterThan(0)

      const summary = manifest.partitions![0]
      expect(summary).toHaveProperty('containsNull')
      expect(summary).toHaveProperty('lowerBound')
      expect(summary).toHaveProperty('upperBound')
    })
  })

  describe('manifest file format', () => {
    it('should produce valid manifest entries', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')
      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })

      const entry = result.entry

      // Data file entry should have correct fields per spec
      expect(entry.status).toBe(1) // ADDED
      expect(entry.filePath).toBeDefined()
      expect(entry.fileFormat).toBe('PARQUET')
      expect(entry.partition).toBeDefined()
      expect(entry.recordCount).toBeGreaterThanOrEqual(0)
      expect(entry.fileSizeBytes).toBeGreaterThan(0)
    })

    it('should set content type for data files', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')
      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })

      expect(result.entry.content).toBe(0) // 0 = DATA
    })
  })

  describe('snapshot format', () => {
    it('should produce valid snapshot structure', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')
      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
      const manifest = await writer.appendToManifest(metadata, result.entry)
      const snapshot = await writer.createSnapshot(metadata, manifest)

      // Required snapshot fields
      expect(snapshot.snapshotId).toBeGreaterThan(0)
      expect(snapshot.timestampMs).toBeGreaterThan(0)
      expect(snapshot.manifestList).toBeDefined()
      expect(snapshot.summary).toBeDefined()
      expect(snapshot.summary!.operation).toBeDefined()
    })

    it('should include operation summary metrics', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')
      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
      const manifest = await writer.appendToManifest(metadata, result.entry)
      const snapshot = await writer.createSnapshot(metadata, manifest)

      // Standard summary properties per Iceberg spec
      expect(snapshot.summary!['added-data-files']).toBeDefined()
      expect(snapshot.summary!['added-records']).toBeDefined()
      expect(snapshot.summary!['added-files-size']).toBeDefined()
      expect(snapshot.summary!['total-data-files']).toBeDefined()
      expect(snapshot.summary!['total-records']).toBeDefined()
      expect(snapshot.summary!['total-files-size']).toBeDefined()
    })

    it('should set schema ID if provided', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')
      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
      const manifest = await writer.appendToManifest(metadata, result.entry)
      const snapshot = await writer.createSnapshot(metadata, manifest)

      expect(snapshot.schemaId).toBe(metadata.currentSchemaId)
    })
  })
})

// ============================================================================
// ATOMIC OPERATIONS TESTS
// ============================================================================

describe('Atomic operations', () => {
  let writer: IcebergWriter
  let r2: R2Binding
  let catalog: IcebergCatalog

  beforeEach(() => {
    r2 = createMockR2()
    catalog = createMockCatalog()
    writer = new IcebergWriter(r2, catalog)
  })

  describe('concurrent commit handling', () => {
    it('should detect version conflicts', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')
      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
      const manifest = await writer.appendToManifest(metadata, result.entry)
      const snapshot = await writer.createSnapshot(metadata, manifest)

      // Simulate stale metadata
      vi.spyOn(catalog, 'updateTable').mockRejectedValueOnce(
        new IcebergConcurrentCommitError('Version conflict: expected 5, got 6')
      )

      await expect(
        writer.commitSnapshot('events', 'page_views', metadata, snapshot)
      ).rejects.toThrow(IcebergConcurrentCommitError)
    })

    it('should support optimistic locking', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')
      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
      const manifest = await writer.appendToManifest(metadata, result.entry)
      const snapshot = await writer.createSnapshot(metadata, manifest)

      await writer.commitSnapshot('events', 'page_views', metadata, snapshot)

      // Should pass expected version for optimistic concurrency
      expect(catalog.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedVersion: expect.any(Number),
        })
      )
    })

    it('should reload metadata on conflict and retry', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')
      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
      const manifest = await writer.appendToManifest(metadata, result.entry)
      const snapshot = await writer.createSnapshot(metadata, manifest)

      // First attempt fails, second succeeds
      vi.spyOn(catalog, 'updateTable')
        .mockRejectedValueOnce(new IcebergConcurrentCommitError('Conflict'))
        .mockResolvedValueOnce({ success: true })

      // Clear cache to simulate metadata reload
      vi.spyOn(catalog, 'loadTable').mockResolvedValue(metadata)

      const commitResult = await writer.commitSnapshot('events', 'page_views', metadata, snapshot, {
        retries: 1,
      })

      expect(commitResult.success).toBe(true)
      // Should have loaded fresh metadata for retry
      expect(catalog.loadTable).toHaveBeenCalledTimes(2) // Initial + retry
    })
  })

  describe('rollback on failure', () => {
    it('should not update metadata on manifest write failure', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')
      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })

      // Fail manifest write
      vi.spyOn(r2, 'put').mockRejectedValueOnce(new Error('Storage unavailable'))

      await expect(writer.appendToManifest(metadata, result.entry)).rejects.toThrow()

      // Catalog should not have been updated
      expect(catalog.updateTable).not.toHaveBeenCalled()
    })

    it('should not update catalog on metadata write failure', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')
      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
      const manifest = await writer.appendToManifest(metadata, result.entry)
      const snapshot = await writer.createSnapshot(metadata, manifest)

      // Fail metadata.json write
      vi.spyOn(r2, 'put').mockImplementation(async (key: string) => {
        if (key.includes('metadata')) {
          throw new Error('Storage unavailable')
        }
        return { key } as ReturnType<R2Binding['put']>
      })

      await expect(
        writer.commitSnapshot('events', 'page_views', metadata, snapshot)
      ).rejects.toThrow()

      // Catalog should not have been updated
      expect(catalog.updateTable).not.toHaveBeenCalled()
    })

    it('should clean up partial writes on failure', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')
      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
      const manifest = await writer.appendToManifest(metadata, result.entry)
      const snapshot = await writer.createSnapshot(metadata, manifest)

      // Fail on catalog update after R2 write
      vi.spyOn(catalog, 'updateTable').mockRejectedValueOnce(new Error('Catalog unavailable'))

      try {
        await writer.commitSnapshot('events', 'page_views', metadata, snapshot)
      } catch {
        // Expected to fail
      }

      // Should have attempted to clean up the written metadata file
      expect(r2.delete).toHaveBeenCalled()
    })
  })

  describe('version conflicts', () => {
    it('should detect when expected version mismatches', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')

      // Simulate concurrent modification by changing expected version
      const staleMetadata = {
        ...metadata,
        lastSequenceNumber: (metadata.lastSequenceNumber ?? 0) - 1,
      }

      const result = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
      const manifest = await writer.appendToManifest(staleMetadata, result.entry)
      const snapshot = await writer.createSnapshot(staleMetadata, manifest)

      vi.spyOn(catalog, 'updateTable').mockRejectedValueOnce(
        new IcebergConcurrentCommitError('Version mismatch')
      )

      await expect(
        writer.commitSnapshot('events', 'page_views', staleMetadata, snapshot)
      ).rejects.toThrow(IcebergConcurrentCommitError)
    })

    it('should handle rapid sequential commits', async () => {
      const metadata = await writer.loadMetadata('events', 'page_views')

      // Simulate rapid commits where version increments quickly
      let currentVersion = metadata.lastSequenceNumber ?? 0
      vi.spyOn(catalog, 'updateTable').mockImplementation(async (options: { expectedVersion: number }) => {
        if (options.expectedVersion !== currentVersion) {
          throw new IcebergConcurrentCommitError(`Expected ${currentVersion}, got ${options.expectedVersion}`)
        }
        currentVersion++
        return { success: true }
      })

      // First commit should succeed
      const result1 = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file1.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
      const manifest1 = await writer.appendToManifest(metadata, result1.entry)
      const snapshot1 = await writer.createSnapshot(metadata, manifest1)
      await writer.commitSnapshot('events', 'page_views', metadata, snapshot1)

      // Second commit should succeed with updated version
      const result2 = await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file2.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
      const manifest2 = await writer.appendToManifest(metadata, result2.entry)
      const snapshot2 = await writer.createSnapshot(metadata, manifest2)

      // Need fresh metadata for second commit
      const freshMetadata = await writer.loadMetadata('events', 'page_views')
      await writer.commitSnapshot('events', 'page_views', freshMetadata, snapshot2)

      expect(catalog.updateTable).toHaveBeenCalledTimes(2)
    })
  })
})

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('Utility functions', () => {
  describe('generateSnapshotId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateSnapshotId()
      const id2 = generateSnapshotId()

      expect(id1).not.toBe(id2)
    })

    it('should generate positive integers', () => {
      const id = generateSnapshotId()

      expect(id).toBeGreaterThan(0)
      expect(Number.isInteger(id)).toBe(true)
    })

    it('should use high-resolution timestamp', () => {
      const id = generateSnapshotId()

      // ID should be based on timestamp (roughly current time in ms)
      const now = Date.now()
      expect(Math.abs(id - now)).toBeLessThan(10000) // Within 10 seconds
    })
  })

  describe('generateManifestPath', () => {
    it('should generate path with snapshot ID', () => {
      const path = generateManifestPath('iceberg/events/page_views', 123456789)

      expect(path).toContain('123456789')
    })

    it('should use Avro extension', () => {
      const path = generateManifestPath('iceberg/events/page_views', 123456789)

      expect(path).toMatch(/\.avro$/)
    })

    it('should include metadata directory', () => {
      const path = generateManifestPath('iceberg/events/page_views', 123456789)

      expect(path).toContain('metadata')
    })

    it('should generate unique paths', () => {
      const path1 = generateManifestPath('iceberg/events/page_views', 123456789)
      const path2 = generateManifestPath('iceberg/events/page_views', 123456789)

      // Should include UUID or timestamp to ensure uniqueness
      expect(path1).not.toBe(path2)
    })
  })

  describe('computePartitionValues', () => {
    it('should apply identity transform', () => {
      const result = computePartitionValues(
        { ns: 'test.do', type: 'Event' },
        [
          { sourceId: 1, fieldId: 1000, name: 'ns', transform: 'identity' },
          { sourceId: 2, fieldId: 1001, name: 'type', transform: 'identity' },
        ]
      )

      expect(result).toEqual({ ns: 'test.do', type: 'Event' })
    })

    it('should apply hour transform', () => {
      const timestamp = new Date('2026-01-09T14:30:00Z').getTime()
      const result = computePartitionValues(
        { ts: timestamp },
        [{ sourceId: 1, fieldId: 1000, name: 'ts_hour', transform: 'hour' }]
      )

      expect(result.ts_hour).toBe(491102) // Hours since epoch for 2026-01-09T14:30:00Z
    })

    it('should apply day transform', () => {
      const timestamp = new Date('2026-01-09T14:30:00Z').getTime()
      const result = computePartitionValues(
        { ts: timestamp },
        [{ sourceId: 1, fieldId: 1000, name: 'ts_day', transform: 'day' }]
      )

      expect(result.ts_day).toBe(20462) // Days since epoch for 2026-01-09T14:30:00Z
    })

    it('should apply bucket transform', () => {
      const result = computePartitionValues(
        { id: 'abc123' },
        [{ sourceId: 1, fieldId: 1000, name: 'id_bucket', transform: 'bucket[16]' }]
      )

      expect(result.id_bucket).toBeGreaterThanOrEqual(0)
      expect(result.id_bucket).toBeLessThan(16)
    })

    it('should apply truncate transform', () => {
      const result = computePartitionValues(
        { name: 'Hello World' },
        [{ sourceId: 1, fieldId: 1000, name: 'name_trunc', transform: 'truncate[5]' }]
      )

      expect(result.name_trunc).toBe('Hello')
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error handling', () => {
  let writer: IcebergWriter
  let r2: R2Binding
  let catalog: IcebergCatalog

  beforeEach(() => {
    r2 = createMockR2()
    catalog = createMockCatalog()
    writer = new IcebergWriter(r2, catalog)
  })

  it('should throw IcebergWriterError for invalid configuration', () => {
    expect(() => new IcebergWriter(null as unknown as R2Binding, catalog)).toThrow(IcebergWriterError)
  })

  it('should throw IcebergWriterError for missing R2 binding', () => {
    expect(() => new IcebergWriter(undefined as unknown as R2Binding, catalog)).toThrow(IcebergWriterError)
  })

  it('should throw IcebergWriterError for missing catalog', () => {
    expect(() => new IcebergWriter(r2, null as unknown as IcebergCatalog)).toThrow(IcebergWriterError)
  })

  it('should throw IcebergManifestError on manifest write failure', async () => {
    vi.spyOn(r2, 'put').mockRejectedValueOnce(new Error('Write failed'))

    const metadata = await writer.loadMetadata('events', 'page_views')
    const result = await writer.registerDataFile({
      tableName: 'page_views',
      namespace: 'events',
      filePath: 'data/file.parquet',
      recordCount: 100,
      fileSizeBytes: 1024,
      partitionValues: {},
    })

    await expect(writer.appendToManifest(metadata, result.entry)).rejects.toThrow(IcebergManifestError)
  })

  it('should throw IcebergSnapshotError on snapshot creation failure', async () => {
    const metadata = await writer.loadMetadata('events', 'page_views')
    const result = await writer.registerDataFile({
      tableName: 'page_views',
      namespace: 'events',
      filePath: 'data/file.parquet',
      recordCount: 100,
      fileSizeBytes: 1024,
      partitionValues: {},
    })
    const manifest = await writer.appendToManifest(metadata, result.entry)

    // Fail manifest list write
    vi.spyOn(r2, 'put').mockRejectedValueOnce(new Error('Write failed'))

    await expect(writer.createSnapshot(metadata, manifest)).rejects.toThrow(IcebergSnapshotError)
  })

  it('should include context in error messages', async () => {
    vi.spyOn(catalog, 'loadTable').mockRejectedValueOnce(new Error('Table not found'))

    try {
      await writer.loadMetadata('events', 'missing_table')
      expect.fail('Should have thrown')
    } catch (error) {
      expect((error as Error).message).toContain('missing_table')
      expect((error as Error).message).toContain('events')
    }
  })

  it('should preserve original error in cause', async () => {
    const originalError = new Error('Original error')
    vi.spyOn(catalog, 'loadTable').mockRejectedValueOnce(originalError)

    try {
      await writer.loadMetadata('events', 'page_views')
      expect.fail('Should have thrown')
    } catch (error) {
      expect((error as IcebergWriterError).cause).toBe(originalError)
    }
  })
})

// ============================================================================
// PIPELINE INTEGRATION TESTS
// ============================================================================

describe('Pipeline integration', () => {
  let writer: IcebergWriter
  let r2: R2Binding
  let catalog: IcebergCatalog

  beforeEach(() => {
    r2 = createMockR2()
    catalog = createMockCatalog()
    writer = new IcebergWriter(r2, catalog)
  })

  it('should register file from pipeline write completion event', async () => {
    // Simulate Pipeline write completion event
    const pipelineEvent = {
      type: 'write_complete',
      bucket: 'my-bucket',
      key: 'data/events/page_views/2026/01/09/00001.parquet',
      size: 102400,
      records: 1000,
      metadata: {
        partition: { _partition_hour: '2026-01-09-12' },
      },
    }

    // Extract registration params from pipeline event
    const params: DataFileParams = {
      tableName: 'page_views',
      namespace: 'events',
      filePath: pipelineEvent.key,
      recordCount: pipelineEvent.records,
      fileSizeBytes: pipelineEvent.size,
      partitionValues: pipelineEvent.metadata.partition,
    }

    const result = await writer.registerDataFile(params)

    expect(result.success).toBe(true)
    expect(result.entry.filePath).toBe(pipelineEvent.key)
    expect(result.entry.recordCount).toBe(pipelineEvent.records)
  })

  it('should batch multiple file registrations', async () => {
    const files = [
      {
        filePath: 'data/events/page_views/2026/01/09/00001.parquet',
        recordCount: 1000,
        fileSizeBytes: 102400,
        partitionValues: { _partition_hour: '2026-01-09-12' },
      },
      {
        filePath: 'data/events/page_views/2026/01/09/00002.parquet',
        recordCount: 1500,
        fileSizeBytes: 153600,
        partitionValues: { _partition_hour: '2026-01-09-12' },
      },
      {
        filePath: 'data/events/page_views/2026/01/09/00003.parquet',
        recordCount: 800,
        fileSizeBytes: 81920,
        partitionValues: { _partition_hour: '2026-01-09-13' },
      },
    ]

    const metadata = await writer.loadMetadata('events', 'page_views')

    // Register all files
    const entries = await Promise.all(
      files.map((file) =>
        writer.registerDataFile({
          tableName: 'page_views',
          namespace: 'events',
          ...file,
        })
      )
    )

    // Create single manifest with all entries
    const manifest = await writer.appendToManifest(
      metadata,
      ...entries.map((e) => e.entry)
    )

    expect(manifest.addedFilesCount).toBe(3)
    expect(manifest.addedRowsCount).toBe(3300) // 1000 + 1500 + 800
  })

  it('should commit after batch completes', async () => {
    const metadata = await writer.loadMetadata('events', 'page_views')

    const entry1 = (
      await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file1.parquet',
        recordCount: 100,
        fileSizeBytes: 1024,
        partitionValues: {},
      })
    ).entry

    const entry2 = (
      await writer.registerDataFile({
        tableName: 'page_views',
        namespace: 'events',
        filePath: 'data/file2.parquet',
        recordCount: 200,
        fileSizeBytes: 2048,
        partitionValues: {},
      })
    ).entry

    const manifest = await writer.appendToManifest(metadata, entry1, entry2)
    const snapshot = await writer.createSnapshot(metadata, manifest)
    const commitResult = await writer.commitSnapshot('events', 'page_views', metadata, snapshot)

    expect(commitResult.success).toBe(true)
    expect(commitResult.metadata.currentSnapshotId).toBe(snapshot.snapshotId)
  })
})
