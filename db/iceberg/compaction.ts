/**
 * Iceberg File Compaction
 *
 * Implements Iceberg compaction for merging small Parquet files into larger ones.
 * This reduces file count, improves query performance, and reduces S3/R2 list costs.
 *
 * Key features:
 * - Merge multiple small files into fewer large files
 * - Maintain time-travel by creating new snapshots
 * - Preserve row counts and schema
 * - Configurable target file size
 * - Threshold-based compaction (skip when not beneficial)
 *
 * @module db/iceberg/compaction
 */

// =============================================================================
// Types
// =============================================================================

/**
 * R2/S3 bucket interface (simplified for typing)
 */
export interface R2BucketLike {
  put(key: string, body: ArrayBuffer | string): Promise<unknown>
  get(key: string): Promise<R2ObjectLike | null>
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[]; truncated: boolean }>
  delete(key: string): Promise<void>
}

/**
 * R2 object interface
 */
export interface R2ObjectLike {
  json<T>(): Promise<T>
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * Parquet adapter for reading and writing Parquet files
 */
export interface ParquetAdapter {
  read(buffer: ArrayBuffer): Promise<Record<string, unknown>[]>
  write(rows: Record<string, unknown>[]): Promise<ArrayBuffer>
}

/**
 * Compaction options
 */
export interface CompactionOptions {
  /** Target file size in bytes (default: 64MB) */
  targetFileSizeBytes?: number
  /** Minimum number of files before compaction (default: 5) */
  minFilesThreshold?: number
  /** Force compaction even if below threshold */
  force?: boolean
  /** Compact only a specific table */
  table?: string
  /** Compact within partitions only (preserves partition boundaries) */
  partitionAware?: boolean
  /** Partition key field name for partition-aware compaction */
  partitionKey?: string
}

/**
 * Options for partition rewriting
 */
export interface PartitionRewriteOptions {
  /** Target file size in bytes (default: 64MB) */
  targetFileSizeBytes?: number
  /** Specific partitions to rewrite (if empty, all partitions) */
  partitions?: string[]
  /** Force rewrite even if partition is already optimal */
  force?: boolean
}

/**
 * Result of partition rewrite operation
 */
export interface PartitionRewriteResult {
  /** New snapshot ID created by rewrite */
  newSnapshotId: string
  /** Previous snapshot ID */
  previousSnapshotId: string
  /** Number of partitions rewritten */
  partitionsRewritten: number
  /** Total files rewritten */
  filesRewritten: number
  /** New files created */
  filesCreated: number
  /** Total rows */
  totalRows: number
  /** Duration in milliseconds */
  durationMs: number
}

/**
 * Options for manifest compaction
 */
export interface ManifestCompactionOptions {
  /** Maximum number of manifests to merge per operation */
  maxManifestsToMerge?: number
  /** Minimum manifests required before compaction (default: 10) */
  minManifestsThreshold?: number
  /** Force compaction even if below threshold */
  force?: boolean
}

/**
 * Result of manifest compaction
 */
export interface ManifestCompactionResult {
  /** New snapshot ID */
  newSnapshotId: string
  /** Previous snapshot ID */
  previousSnapshotId: string
  /** Manifests merged */
  manifestsMerged: number
  /** New manifests created */
  manifestsCreated: number
  /** Whether compaction was skipped */
  skipped: boolean
  /** Reason for skipping */
  reason?: string
  /** Duration in milliseconds */
  durationMs: number
}

/**
 * Options for garbage collection
 */
export interface GarbageCollectionOptions {
  /** Retain snapshots newer than this age in milliseconds (default: 7 days) */
  retainSnapshotsNewerThanMs?: number
  /** Minimum snapshots to keep regardless of age (default: 3) */
  minSnapshotsToKeep?: number
  /** Delete orphaned files not referenced by any snapshot */
  deleteOrphanedFiles?: boolean
  /** Dry run - report what would be deleted without actually deleting */
  dryRun?: boolean
}

/**
 * Result of garbage collection
 */
export interface GarbageCollectionResult {
  /** Snapshots expired */
  snapshotsExpired: number
  /** Data files deleted */
  dataFilesDeleted: number
  /** Manifest files deleted */
  manifestFilesDeleted: number
  /** Bytes reclaimed */
  bytesReclaimed: number
  /** Files that would be deleted (dry run only) */
  filesToDelete?: string[]
  /** Whether operation was dry run */
  dryRun: boolean
  /** Duration in milliseconds */
  durationMs: number
}

/**
 * Result of compaction operation
 */
export interface CompactionResult {
  /** New snapshot ID created by compaction */
  newSnapshotId: string
  /** Previous snapshot ID */
  previousSnapshotId: string
  /** Number of files that were compacted */
  filesCompacted: number
  /** Number of new files created */
  filesCreated: number
  /** Total rows across all compacted files */
  totalRows: number
  /** Whether compaction was skipped */
  skipped: boolean
  /** Reason for skipping (if skipped) */
  reason?: string
  /** Duration of compaction in milliseconds */
  durationMs: number
  /** Total bytes compacted */
  bytesCompacted: number
}

/**
 * Iceberg manifest entry
 */
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
  /** Partition values for this file */
  partition?: Record<string, string | number | null>
}

/**
 * Snapshot entry
 */
interface SnapshotEntry {
  'snapshot-id': string
  'parent-snapshot-id': string | null
  'timestamp-ms': number
  'manifest-list': string
  summary: Record<string, string>
}

/**
 * Schema entry
 */
interface SchemaEntry {
  'schema-id': number
  type: 'struct'
  fields: Array<{
    id: number
    name: string
    required: boolean
    type: string
  }>
}

/**
 * Iceberg snapshot manifest
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

/**
 * Current snapshot pointer
 */
interface CurrentSnapshot {
  current_snapshot_id: string
}

// =============================================================================
// Constants
// =============================================================================

/** Default target file size: 64MB */
const DEFAULT_TARGET_FILE_SIZE = 64 * 1024 * 1024

/** Default minimum files threshold for compaction */
const DEFAULT_MIN_FILES_THRESHOLD = 5

/** Default minimum manifests threshold for manifest compaction */
const DEFAULT_MIN_MANIFESTS_THRESHOLD = 10

/** Default retention period for garbage collection: 7 days */
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** Default minimum snapshots to keep */
const DEFAULT_MIN_SNAPSHOTS_TO_KEEP = 3

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// =============================================================================
// IcebergCompactor Class
// =============================================================================

/**
 * IcebergCompactor - Merges small Parquet files into larger ones
 *
 * Compaction improves query performance by reducing the number of files
 * that need to be read during queries. It creates a new snapshot that
 * maintains time-travel capabilities.
 *
 * @example
 * ```typescript
 * const compactor = new IcebergCompactor(bucket, parquetAdapter)
 *
 * // Basic compaction
 * const result = await compactor.compact('my-do-id')
 * console.log(`Compacted ${result.filesCompacted} files into ${result.filesCreated}`)
 *
 * // Custom target file size
 * await compactor.compact('my-do-id', { targetFileSizeBytes: 128 * 1024 * 1024 })
 *
 * // Compact specific table only
 * await compactor.compact('my-do-id', { table: 'users' })
 * ```
 */
export class IcebergCompactor {
  private readonly bucket: R2BucketLike
  private readonly parquetAdapter: ParquetAdapter

  constructor(bucket: R2BucketLike, parquetAdapter: ParquetAdapter) {
    this.bucket = bucket
    this.parquetAdapter = parquetAdapter
  }

  /**
   * Compact files for a Durable Object
   *
   * @param doId - Durable Object ID
   * @param options - Compaction options
   * @returns Compaction result
   */
  async compact(doId: string, options: CompactionOptions = {}): Promise<CompactionResult> {
    const startTime = Date.now()
    const targetFileSize = options.targetFileSizeBytes ?? DEFAULT_TARGET_FILE_SIZE
    const minThreshold = options.minFilesThreshold ?? DEFAULT_MIN_FILES_THRESHOLD

    // 1. Get current snapshot
    const currentKey = `do/${doId}/metadata/current.json`
    const currentObj = await this.bucket.get(currentKey)
    if (!currentObj) {
      throw new Error('DO not found')
    }
    const current = await currentObj.json<CurrentSnapshot>()
    const previousSnapshotId = current.current_snapshot_id

    // 2. Load manifest
    const manifestKey = `do/${doId}/metadata/${previousSnapshotId}.json`
    const manifestObj = await this.bucket.get(manifestKey)
    if (!manifestObj) {
      throw new Error('Snapshot not found')
    }
    const manifest = await manifestObj.json<IcebergSnapshotManifest>()

    // 3. Filter manifests by table if specified
    let manifestsToCompact = manifest.manifests
    const manifestsToKeep: ManifestFileEntry[] = []

    if (options.table) {
      manifestsToKeep.push(...manifest.manifests.filter((m) => m.table !== options.table))
      manifestsToCompact = manifest.manifests.filter((m) => m.table === options.table)
    }

    // 4. Check if compaction is needed
    if (manifestsToCompact.length === 0) {
      return {
        newSnapshotId: previousSnapshotId,
        previousSnapshotId,
        filesCompacted: 0,
        filesCreated: 0,
        totalRows: 0,
        skipped: true,
        reason: 'no files to compact',
        durationMs: Date.now() - startTime,
        bytesCompacted: 0,
      }
    }

    if (!options.force && manifestsToCompact.length < minThreshold) {
      return {
        newSnapshotId: previousSnapshotId,
        previousSnapshotId,
        filesCompacted: 0,
        filesCreated: 0,
        totalRows: manifest.manifests.reduce((sum, m) => sum + m['added-rows-count'], 0),
        skipped: true,
        reason: `file count (${manifestsToCompact.length}) below threshold (${minThreshold})`,
        durationMs: Date.now() - startTime,
        bytesCompacted: 0,
      }
    }

    // 5. Group files by table
    const filesByTable = new Map<string, ManifestFileEntry[]>()
    for (const entry of manifestsToCompact) {
      const tableFiles = filesByTable.get(entry.table) || []
      tableFiles.push(entry)
      filesByTable.set(entry.table, tableFiles)
    }

    // 6. Compact each table
    const newSnapshotId = generateUUID()
    const newManifests: ManifestFileEntry[] = [...manifestsToKeep]
    let totalBytesCompacted = 0
    let totalRowsCompacted = 0
    let filesCreated = 0

    for (const [tableName, tableFiles] of filesByTable) {
      // Calculate total size and rows
      const totalSize = tableFiles.reduce((sum, f) => sum + f['manifest-length'], 0)
      const totalRows = tableFiles.reduce((sum, f) => sum + f['added-rows-count'], 0)
      totalBytesCompacted += totalSize
      totalRowsCompacted += totalRows

      // Read all data from source files
      const allRows: Record<string, unknown>[] = []
      for (const entry of tableFiles) {
        const fileObj = await this.bucket.get(entry['manifest-path'])
        if (fileObj) {
          const buffer = await fileObj.arrayBuffer()
          const rows = await this.parquetAdapter.read(buffer)
          allRows.push(...rows)
        }
      }

      // Determine number of output files based on target size
      const avgRowSize = totalSize > 0 && allRows.length > 0 ? totalSize / allRows.length : 100
      const rowsPerFile = Math.max(1, Math.floor(targetFileSize / avgRowSize))
      const numOutputFiles = Math.max(1, Math.ceil(allRows.length / rowsPerFile))

      // Get schema and sequence info from first file
      const firstEntry = tableFiles[0]
      const maxSequence = Math.max(...tableFiles.map((f) => f['sequence-number']))

      // Write compacted files
      for (let i = 0; i < numOutputFiles; i++) {
        const startIdx = i * rowsPerFile
        const endIdx = Math.min(startIdx + rowsPerFile, allRows.length)
        const chunk = allRows.slice(startIdx, endIdx)

        if (chunk.length === 0) continue

        const parquetBuffer = await this.parquetAdapter.write(chunk)
        const outputPath = `do/${doId}/data/${tableName}/compacted-${newSnapshotId}-${i}.parquet`

        await this.bucket.put(outputPath, parquetBuffer)

        newManifests.push({
          'manifest-path': outputPath,
          'manifest-length': parquetBuffer.byteLength,
          'partition-spec-id': firstEntry['partition-spec-id'],
          content: 0,
          'sequence-number': maxSequence + 1,
          'added-files-count': 1,
          'existing-files-count': 0,
          'deleted-files-count': 0,
          'added-rows-count': chunk.length,
          table: tableName,
          schema: firstEntry.schema,
        })

        filesCreated++
      }
    }

    // 7. Create new snapshot entry
    const newSnapshotEntry: SnapshotEntry = {
      'snapshot-id': newSnapshotId,
      'parent-snapshot-id': previousSnapshotId,
      'timestamp-ms': Date.now(),
      'manifest-list': `do/${doId}/metadata/${newSnapshotId}-manifest-list.avro`,
      summary: {
        operation: 'replace',
        'files-compacted': String(manifestsToCompact.length),
        'files-created': String(filesCreated),
        'total-rows': String(totalRowsCompacted),
      },
    }

    // 8. Create new manifest
    const newManifest: IcebergSnapshotManifest = {
      'format-version': 2,
      'table-uuid': manifest['table-uuid'],
      location: manifest.location,
      'last-updated-ms': Date.now(),
      'last-column-id': manifest['last-column-id'],
      'current-snapshot-id': newSnapshotId,
      'parent-snapshot-id': previousSnapshotId,
      snapshots: [...manifest.snapshots, newSnapshotEntry],
      schemas: manifest.schemas,
      manifests: newManifests,
    }

    // 9. Write new manifest
    const newManifestKey = `do/${doId}/metadata/${newSnapshotId}.json`
    await this.bucket.put(newManifestKey, JSON.stringify(newManifest, null, 2))

    // 10. Update current pointer
    await this.bucket.put(currentKey, JSON.stringify({ current_snapshot_id: newSnapshotId }))

    return {
      newSnapshotId,
      previousSnapshotId,
      filesCompacted: manifestsToCompact.length,
      filesCreated,
      totalRows: totalRowsCompacted,
      skipped: false,
      durationMs: Date.now() - startTime,
      bytesCompacted: totalBytesCompacted,
    }
  }

  /**
   * Rewrite partitions to optimize file layout within each partition.
   *
   * Unlike basic compaction which merges files across partitions, partition
   * rewriting maintains partition boundaries and optimizes files within each
   * partition independently. This is useful for:
   * - Ensuring each partition has optimally-sized files
   * - Sorting data within partitions for better scan performance
   * - Reorganizing data after schema evolution
   *
   * @param doId - Durable Object ID
   * @param table - Table name to rewrite partitions for
   * @param partitionKey - The partition key field name
   * @param options - Rewrite options
   * @returns Partition rewrite result
   *
   * @example
   * ```typescript
   * // Rewrite all partitions in the 'events' table
   * const result = await compactor.rewritePartitions('my-do', 'events', 'event_type')
   *
   * // Rewrite specific partitions only
   * const result = await compactor.rewritePartitions('my-do', 'events', 'event_type', {
   *   partitions: ['purchase', 'view']
   * })
   * ```
   */
  async rewritePartitions(
    doId: string,
    table: string,
    partitionKey: string,
    options: PartitionRewriteOptions = {}
  ): Promise<PartitionRewriteResult> {
    const startTime = Date.now()
    const targetFileSize = options.targetFileSizeBytes ?? DEFAULT_TARGET_FILE_SIZE

    // 1. Load current manifest
    const currentKey = `do/${doId}/metadata/current.json`
    const currentObj = await this.bucket.get(currentKey)
    if (!currentObj) {
      throw new Error('DO not found')
    }
    const current = await currentObj.json<CurrentSnapshot>()
    const previousSnapshotId = current.current_snapshot_id

    const manifestKey = `do/${doId}/metadata/${previousSnapshotId}.json`
    const manifestObj = await this.bucket.get(manifestKey)
    if (!manifestObj) {
      throw new Error('Snapshot not found')
    }
    const manifest = await manifestObj.json<IcebergSnapshotManifest>()

    // 2. Filter to specified table and group by partition
    const tableManifests = manifest.manifests.filter((m) => m.table === table)
    const otherManifests = manifest.manifests.filter((m) => m.table !== table)

    if (tableManifests.length === 0) {
      return {
        newSnapshotId: previousSnapshotId,
        previousSnapshotId,
        partitionsRewritten: 0,
        filesRewritten: 0,
        filesCreated: 0,
        totalRows: 0,
        durationMs: Date.now() - startTime,
      }
    }

    // 3. Group files by partition value
    const filesByPartition = new Map<string, ManifestFileEntry[]>()
    for (const entry of tableManifests) {
      // Extract partition value from path or entry
      const partitionValue = this.extractPartitionValue(entry, partitionKey)
      const existing = filesByPartition.get(partitionValue) || []
      existing.push(entry)
      filesByPartition.set(partitionValue, existing)
    }

    // 4. Filter partitions to rewrite if specified
    let partitionsToRewrite = Array.from(filesByPartition.keys())
    if (options.partitions && options.partitions.length > 0) {
      partitionsToRewrite = partitionsToRewrite.filter((p) => options.partitions!.includes(p))
    }

    // 5. Rewrite each partition
    const newSnapshotId = generateUUID()
    const newManifests: ManifestFileEntry[] = [...otherManifests]
    let totalPartitionsRewritten = 0
    let totalFilesRewritten = 0
    let totalFilesCreated = 0
    let totalRows = 0

    for (const partitionValue of partitionsToRewrite) {
      const partitionFiles = filesByPartition.get(partitionValue)!

      // Skip if only one file and not forced
      if (!options.force && partitionFiles.length === 1) {
        newManifests.push(...partitionFiles)
        totalRows += partitionFiles.reduce((sum, f) => sum + f['added-rows-count'], 0)
        continue
      }

      // Read all rows from this partition
      const allRows: Record<string, unknown>[] = []
      let totalSize = 0
      for (const entry of partitionFiles) {
        const fileObj = await this.bucket.get(entry['manifest-path'])
        if (fileObj) {
          const buffer = await fileObj.arrayBuffer()
          const rows = await this.parquetAdapter.read(buffer)
          allRows.push(...rows)
          totalSize += buffer.byteLength
        }
      }

      if (allRows.length === 0) continue

      totalFilesRewritten += partitionFiles.length
      totalPartitionsRewritten++
      totalRows += allRows.length

      // Calculate output file count
      const avgRowSize = totalSize / allRows.length
      const rowsPerFile = Math.max(1, Math.floor(targetFileSize / avgRowSize))
      const numOutputFiles = Math.max(1, Math.ceil(allRows.length / rowsPerFile))

      const firstEntry = partitionFiles[0]
      const maxSequence = Math.max(...partitionFiles.map((f) => f['sequence-number']))

      // Write new files for this partition
      for (let i = 0; i < numOutputFiles; i++) {
        const startIdx = i * rowsPerFile
        const endIdx = Math.min(startIdx + rowsPerFile, allRows.length)
        const chunk = allRows.slice(startIdx, endIdx)

        if (chunk.length === 0) continue

        const parquetBuffer = await this.parquetAdapter.write(chunk)
        const outputPath = `do/${doId}/data/${table}/${partitionKey}=${partitionValue}/rewritten-${newSnapshotId}-${i}.parquet`

        await this.bucket.put(outputPath, parquetBuffer)

        newManifests.push({
          'manifest-path': outputPath,
          'manifest-length': parquetBuffer.byteLength,
          'partition-spec-id': firstEntry['partition-spec-id'],
          content: 0,
          'sequence-number': maxSequence + 1,
          'added-files-count': 1,
          'existing-files-count': 0,
          'deleted-files-count': 0,
          'added-rows-count': chunk.length,
          table,
          schema: firstEntry.schema,
          partition: { [partitionKey]: partitionValue },
        })

        totalFilesCreated++
      }
    }

    // 6. Add files from partitions not rewritten
    for (const [partitionValue, files] of filesByPartition) {
      if (!partitionsToRewrite.includes(partitionValue)) {
        newManifests.push(...files)
        totalRows += files.reduce((sum, f) => sum + f['added-rows-count'], 0)
      }
    }

    // 7. Create new snapshot
    const newSnapshotEntry: SnapshotEntry = {
      'snapshot-id': newSnapshotId,
      'parent-snapshot-id': previousSnapshotId,
      'timestamp-ms': Date.now(),
      'manifest-list': `do/${doId}/metadata/${newSnapshotId}-manifest-list.avro`,
      summary: {
        operation: 'replace',
        'partitions-rewritten': String(totalPartitionsRewritten),
        'files-rewritten': String(totalFilesRewritten),
        'files-created': String(totalFilesCreated),
        'total-rows': String(totalRows),
      },
    }

    const newManifest: IcebergSnapshotManifest = {
      'format-version': 2,
      'table-uuid': manifest['table-uuid'],
      location: manifest.location,
      'last-updated-ms': Date.now(),
      'last-column-id': manifest['last-column-id'],
      'current-snapshot-id': newSnapshotId,
      'parent-snapshot-id': previousSnapshotId,
      snapshots: [...manifest.snapshots, newSnapshotEntry],
      schemas: manifest.schemas,
      manifests: newManifests,
    }

    await this.bucket.put(`do/${doId}/metadata/${newSnapshotId}.json`, JSON.stringify(newManifest, null, 2))
    await this.bucket.put(currentKey, JSON.stringify({ current_snapshot_id: newSnapshotId }))

    return {
      newSnapshotId,
      previousSnapshotId,
      partitionsRewritten: totalPartitionsRewritten,
      filesRewritten: totalFilesRewritten,
      filesCreated: totalFilesCreated,
      totalRows,
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * Compact manifest files to reduce metadata overhead.
   *
   * Over time, many small manifest files accumulate from incremental writes.
   * This method merges multiple manifest entries into fewer entries while
   * preserving the same data files they reference.
   *
   * @param doId - Durable Object ID
   * @param options - Manifest compaction options
   * @returns Manifest compaction result
   *
   * @example
   * ```typescript
   * // Compact manifests when there are more than 10
   * const result = await compactor.compactManifests('my-do')
   *
   * // Force manifest compaction even below threshold
   * const result = await compactor.compactManifests('my-do', { force: true })
   * ```
   */
  async compactManifests(
    doId: string,
    options: ManifestCompactionOptions = {}
  ): Promise<ManifestCompactionResult> {
    const startTime = Date.now()
    const minThreshold = options.minManifestsThreshold ?? DEFAULT_MIN_MANIFESTS_THRESHOLD

    // 1. Load current manifest
    const currentKey = `do/${doId}/metadata/current.json`
    const currentObj = await this.bucket.get(currentKey)
    if (!currentObj) {
      throw new Error('DO not found')
    }
    const current = await currentObj.json<CurrentSnapshot>()
    const previousSnapshotId = current.current_snapshot_id

    const manifestKey = `do/${doId}/metadata/${previousSnapshotId}.json`
    const manifestObj = await this.bucket.get(manifestKey)
    if (!manifestObj) {
      throw new Error('Snapshot not found')
    }
    const manifest = await manifestObj.json<IcebergSnapshotManifest>()

    // 2. Check if compaction is needed
    const manifestCount = manifest.manifests.length
    if (!options.force && manifestCount < minThreshold) {
      return {
        newSnapshotId: previousSnapshotId,
        previousSnapshotId,
        manifestsMerged: 0,
        manifestsCreated: 0,
        skipped: true,
        reason: `manifest count (${manifestCount}) below threshold (${minThreshold})`,
        durationMs: Date.now() - startTime,
      }
    }

    // 3. Group manifests by table
    const manifestsByTable = new Map<string, ManifestFileEntry[]>()
    for (const entry of manifest.manifests) {
      const existing = manifestsByTable.get(entry.table) || []
      existing.push(entry)
      manifestsByTable.set(entry.table, existing)
    }

    // 4. Create consolidated manifest entries per table
    const newSnapshotId = generateUUID()
    const newManifests: ManifestFileEntry[] = []
    let totalManifestsMerged = 0
    let totalManifestsCreated = 0

    for (const [tableName, tableManifests] of manifestsByTable) {
      if (tableManifests.length <= 1) {
        // Keep single manifests as-is
        newManifests.push(...tableManifests)
        continue
      }

      totalManifestsMerged += tableManifests.length

      // Aggregate stats from all manifests for this table
      const totalRows = tableManifests.reduce((sum, m) => sum + m['added-rows-count'], 0)
      const totalLength = tableManifests.reduce((sum, m) => sum + m['manifest-length'], 0)
      const maxSequence = Math.max(...tableManifests.map((m) => m['sequence-number']))
      const firstEntry = tableManifests[0]

      // Create a single consolidated manifest entry
      // Note: In a real Iceberg implementation, we'd actually merge the manifest files
      // Here we just consolidate the metadata entries
      newManifests.push({
        'manifest-path': `do/${doId}/metadata/consolidated-${tableName}-${newSnapshotId}.avro`,
        'manifest-length': totalLength,
        'partition-spec-id': firstEntry['partition-spec-id'],
        content: 0,
        'sequence-number': maxSequence + 1,
        'added-files-count': tableManifests.reduce((sum, m) => sum + m['added-files-count'], 0),
        'existing-files-count': tableManifests.reduce((sum, m) => sum + m['existing-files-count'], 0),
        'deleted-files-count': tableManifests.reduce((sum, m) => sum + m['deleted-files-count'], 0),
        'added-rows-count': totalRows,
        table: tableName,
        schema: firstEntry.schema,
      })

      totalManifestsCreated++
    }

    // 5. Create new snapshot
    const newSnapshotEntry: SnapshotEntry = {
      'snapshot-id': newSnapshotId,
      'parent-snapshot-id': previousSnapshotId,
      'timestamp-ms': Date.now(),
      'manifest-list': `do/${doId}/metadata/${newSnapshotId}-manifest-list.avro`,
      summary: {
        operation: 'replace',
        'manifests-merged': String(totalManifestsMerged),
        'manifests-created': String(totalManifestsCreated),
      },
    }

    const newManifest: IcebergSnapshotManifest = {
      'format-version': 2,
      'table-uuid': manifest['table-uuid'],
      location: manifest.location,
      'last-updated-ms': Date.now(),
      'last-column-id': manifest['last-column-id'],
      'current-snapshot-id': newSnapshotId,
      'parent-snapshot-id': previousSnapshotId,
      snapshots: [...manifest.snapshots, newSnapshotEntry],
      schemas: manifest.schemas,
      manifests: newManifests,
    }

    await this.bucket.put(`do/${doId}/metadata/${newSnapshotId}.json`, JSON.stringify(newManifest, null, 2))
    await this.bucket.put(currentKey, JSON.stringify({ current_snapshot_id: newSnapshotId }))

    return {
      newSnapshotId,
      previousSnapshotId,
      manifestsMerged: totalManifestsMerged,
      manifestsCreated: totalManifestsCreated,
      skipped: false,
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * Garbage collect expired snapshots and orphaned files.
   *
   * This method removes old snapshots and their associated data files that are
   * no longer needed for time-travel queries. It also identifies and removes
   * orphaned files not referenced by any snapshot.
   *
   * @param doId - Durable Object ID
   * @param options - Garbage collection options
   * @returns Garbage collection result
   *
   * @example
   * ```typescript
   * // Dry run to see what would be deleted
   * const preview = await compactor.garbageCollect('my-do', { dryRun: true })
   * console.log(`Would delete ${preview.dataFilesDeleted} files`)
   *
   * // Actually perform garbage collection
   * const result = await compactor.garbageCollect('my-do')
   * console.log(`Reclaimed ${result.bytesReclaimed} bytes`)
   *
   * // Keep snapshots from the last 30 days
   * const result = await compactor.garbageCollect('my-do', {
   *   retainSnapshotsNewerThanMs: 30 * 24 * 60 * 60 * 1000
   * })
   * ```
   */
  async garbageCollect(
    doId: string,
    options: GarbageCollectionOptions = {}
  ): Promise<GarbageCollectionResult> {
    const startTime = Date.now()
    const retentionMs = options.retainSnapshotsNewerThanMs ?? DEFAULT_RETENTION_MS
    const minSnapshots = options.minSnapshotsToKeep ?? DEFAULT_MIN_SNAPSHOTS_TO_KEEP
    const dryRun = options.dryRun ?? false
    const deleteOrphans = options.deleteOrphanedFiles ?? true

    // 1. Load current manifest
    const currentKey = `do/${doId}/metadata/current.json`
    const currentObj = await this.bucket.get(currentKey)
    if (!currentObj) {
      throw new Error('DO not found')
    }
    const current = await currentObj.json<CurrentSnapshot>()

    const manifestKey = `do/${doId}/metadata/${current.current_snapshot_id}.json`
    const manifestObj = await this.bucket.get(manifestKey)
    if (!manifestObj) {
      throw new Error('Snapshot not found')
    }
    const manifest = await manifestObj.json<IcebergSnapshotManifest>()

    // 2. Identify snapshots to expire
    const now = Date.now()
    const cutoffTime = now - retentionMs
    const sortedSnapshots = [...manifest.snapshots].sort((a, b) => b['timestamp-ms'] - a['timestamp-ms'])

    // Keep at least minSnapshots, and all snapshots newer than cutoff
    const snapshotsToKeep: Set<string> = new Set()
    const snapshotsToExpire: SnapshotEntry[] = []

    for (let i = 0; i < sortedSnapshots.length; i++) {
      const snapshot = sortedSnapshots[i]
      if (i < minSnapshots || snapshot['timestamp-ms'] >= cutoffTime) {
        snapshotsToKeep.add(snapshot['snapshot-id'])
      } else {
        snapshotsToExpire.push(snapshot)
      }
    }

    // 3. Collect files referenced by retained snapshots
    const referencedFiles = new Set<string>()
    for (const entry of manifest.manifests) {
      referencedFiles.add(entry['manifest-path'])
    }

    // For expired snapshots, we need to load their manifests to find their files
    const expiredFiles: string[] = []
    const expiredManifestKeys: string[] = []

    for (const snapshot of snapshotsToExpire) {
      const snapshotManifestKey = `do/${doId}/metadata/${snapshot['snapshot-id']}.json`
      expiredManifestKeys.push(snapshotManifestKey)

      try {
        const snapshotManifestObj = await this.bucket.get(snapshotManifestKey)
        if (snapshotManifestObj) {
          const snapshotManifest = await snapshotManifestObj.json<IcebergSnapshotManifest>()
          for (const entry of snapshotManifest.manifests) {
            // Only mark for deletion if not referenced by kept snapshots
            if (!referencedFiles.has(entry['manifest-path'])) {
              expiredFiles.push(entry['manifest-path'])
            }
          }
        }
      } catch {
        // Snapshot manifest already deleted or inaccessible
      }
    }

    // 4. Find orphaned files if requested
    let orphanedFiles: string[] = []
    if (deleteOrphans) {
      const dataPrefix = `do/${doId}/data/`
      const listResult = await this.bucket.list({ prefix: dataPrefix })
      for (const obj of listResult.objects) {
        if (!referencedFiles.has(obj.key) && !expiredFiles.includes(obj.key)) {
          orphanedFiles.push(obj.key)
        }
      }
    }

    // 5. Calculate bytes to reclaim (estimate based on manifest lengths)
    let bytesReclaimed = 0
    for (const snapshot of snapshotsToExpire) {
      // Load manifest to get actual sizes
      try {
        const snapshotManifestKey = `do/${doId}/metadata/${snapshot['snapshot-id']}.json`
        const snapshotManifestObj = await this.bucket.get(snapshotManifestKey)
        if (snapshotManifestObj) {
          const snapshotManifest = await snapshotManifestObj.json<IcebergSnapshotManifest>()
          for (const entry of snapshotManifest.manifests) {
            if (!referencedFiles.has(entry['manifest-path'])) {
              bytesReclaimed += entry['manifest-length']
            }
          }
        }
      } catch {
        // Ignore errors for already-deleted snapshots
      }
    }

    // 6. Perform deletion if not dry run
    const allFilesToDelete = [...expiredFiles, ...orphanedFiles, ...expiredManifestKeys]

    if (!dryRun) {
      for (const file of allFilesToDelete) {
        try {
          await this.bucket.delete(file)
        } catch {
          // Ignore deletion errors for already-deleted files
        }
      }

      // Update manifest to remove expired snapshots
      if (snapshotsToExpire.length > 0) {
        const newSnapshotId = generateUUID()
        const newSnapshotEntry: SnapshotEntry = {
          'snapshot-id': newSnapshotId,
          'parent-snapshot-id': current.current_snapshot_id,
          'timestamp-ms': now,
          'manifest-list': `do/${doId}/metadata/${newSnapshotId}-manifest-list.avro`,
          summary: {
            operation: 'delete',
            'snapshots-expired': String(snapshotsToExpire.length),
            'files-deleted': String(expiredFiles.length + orphanedFiles.length),
          },
        }

        const newManifest: IcebergSnapshotManifest = {
          'format-version': 2,
          'table-uuid': manifest['table-uuid'],
          location: manifest.location,
          'last-updated-ms': now,
          'last-column-id': manifest['last-column-id'],
          'current-snapshot-id': newSnapshotId,
          'parent-snapshot-id': current.current_snapshot_id,
          snapshots: [
            ...sortedSnapshots.filter((s) => snapshotsToKeep.has(s['snapshot-id'])),
            newSnapshotEntry,
          ],
          schemas: manifest.schemas,
          manifests: manifest.manifests,
        }

        await this.bucket.put(`do/${doId}/metadata/${newSnapshotId}.json`, JSON.stringify(newManifest, null, 2))
        await this.bucket.put(currentKey, JSON.stringify({ current_snapshot_id: newSnapshotId }))
      }
    }

    return {
      snapshotsExpired: snapshotsToExpire.length,
      dataFilesDeleted: expiredFiles.length + orphanedFiles.length,
      manifestFilesDeleted: expiredManifestKeys.length,
      bytesReclaimed,
      filesToDelete: dryRun ? allFilesToDelete : undefined,
      dryRun,
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * Extract partition value from a manifest entry.
   * Attempts to extract from the partition field or parse from the file path.
   */
  private extractPartitionValue(entry: ManifestFileEntry, partitionKey: string): string {
    // First try the partition field if present
    if (entry.partition && entry.partition[partitionKey] !== undefined) {
      return String(entry.partition[partitionKey])
    }

    // Fall back to parsing from path (e.g., "data/table/key=value/file.parquet")
    const pathParts = entry['manifest-path'].split('/')
    for (const part of pathParts) {
      if (part.startsWith(`${partitionKey}=`)) {
        return part.substring(partitionKey.length + 1)
      }
    }

    // Default to 'default' partition if not found
    return 'default'
  }
}
