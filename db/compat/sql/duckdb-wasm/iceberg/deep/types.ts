/**
 * Deep DuckDB-Iceberg Integration Types
 *
 * Comprehensive type definitions for DuckDB WASM + Iceberg tables stored in R2.
 *
 * @module db/compat/sql/duckdb-wasm/iceberg/deep/types
 */

import type { R2Bucket } from '@cloudflare/workers-types'
import type {
  TableMetadata,
  IcebergSchema,
  PartitionSpec,
  Snapshot,
  PartitionField,
} from '../types'

// ============================================================================
// Catalog Types
// ============================================================================

/**
 * OAuth2 configuration for catalog authentication
 */
export interface CatalogOAuthConfig {
  /** OAuth2 token endpoint */
  tokenEndpoint: string
  /** OAuth2 client ID */
  clientId: string
  /** OAuth2 client secret */
  clientSecret: string
  /** OAuth2 scope */
  scope?: string
}

/**
 * Configuration for REST catalog
 */
export interface RESTCatalogConfig {
  /** Catalog REST API URI */
  uri: string
  /** Warehouse location */
  warehouse: string
  /** Static credentials (alternative to OAuth) */
  credentials?: {
    accessKeyId: string
    secretAccessKey: string
  }
  /** OAuth2 configuration */
  oauth?: CatalogOAuthConfig
  /** Custom fetch function (for testing) */
  fetchFn?: typeof fetch
  /** Additional headers */
  headers?: Record<string, string>
  /** Request timeout in milliseconds */
  timeoutMs?: number
}

/**
 * Catalog configuration response
 */
export interface CatalogConfig {
  /** Default configuration values */
  defaults: Record<string, string>
  /** Configuration overrides */
  overrides: Record<string, string>
  /** Warehouse location */
  warehouse?: string
}

/**
 * Namespace information
 */
export interface NamespaceInfo {
  /** Namespace path components */
  namespace: string[]
  /** Namespace properties */
  properties: Record<string, string>
}

/**
 * Table identifier
 */
export interface TableIdentifier {
  /** Namespace path */
  namespace: string[]
  /** Table name */
  name: string
}

/**
 * Loaded table with metadata and location
 */
export interface LoadedTable {
  /** Table metadata */
  metadata: TableMetadata
  /** Metadata file location */
  metadataLocation: string
}

/**
 * Table creation options
 */
export interface CreateTableOptions {
  /** Initial schema */
  schema: IcebergSchema
  /** Partition specification */
  partitionSpec?: PartitionSpec
  /** Write ordering */
  writeOrder?: WriteOrder
  /** Table properties */
  properties?: Record<string, string>
  /** Stage the table without creating data files */
  stageCreate?: boolean
}

/**
 * Write order specification
 */
export interface WriteOrder {
  /** Order ID */
  orderId: number
  /** Sort fields */
  fields: WriteOrderField[]
}

/**
 * Write order field
 */
export interface WriteOrderField {
  /** Source column ID */
  sourceId: number
  /** Transform to apply */
  transform: string
  /** Sort direction */
  direction: 'asc' | 'desc'
  /** Null ordering */
  nullOrder: 'nulls-first' | 'nulls-last'
}

/**
 * Table commit requirement
 */
export interface TableRequirement {
  /** Requirement type */
  type: string
  /** Schema ID assertion */
  'current-schema-id'?: number
  /** Snapshot ID assertion */
  'snapshot-id'?: number
  /** Ref name */
  ref?: string
  /** UUID assertion */
  uuid?: string
}

/**
 * Table update action
 */
export interface TableUpdate {
  /** Update action type */
  action: string
  /** Update payload (varies by action) */
  [key: string]: unknown
}

/**
 * Table commit request
 */
export interface TableCommit {
  /** Requirements that must be met */
  requirements: TableRequirement[]
  /** Updates to apply */
  updates: TableUpdate[]
}

/**
 * Schema evolution operation
 */
export interface SchemaEvolution {
  /** Evolution type */
  type: 'add-column' | 'rename-column' | 'make-optional' | 'update-column' | 'delete-column'
  /** Column definition for add */
  column?: {
    id: number
    name: string
    type: string
    required: boolean
    doc?: string
  }
  /** Column ID for modifications */
  columnId?: number
  /** New name for rename */
  newName?: string
  /** New type for update */
  newType?: string
  /** Parent ID for nested columns */
  parentId?: number
}

/**
 * Iceberg catalog interface
 */
export interface IcebergCatalog {
  /** Get catalog configuration */
  getConfig(): Promise<CatalogConfig>

  /** Authenticate with OAuth (if configured) */
  authenticate(): Promise<void>

  /** List namespaces */
  listNamespaces(parent?: string[]): Promise<string[][]>

  /** Create namespace */
  createNamespace(
    namespace: string[],
    properties?: Record<string, string>
  ): Promise<NamespaceInfo>

  /** Get namespace properties */
  getNamespaceProperties(namespace: string[]): Promise<Record<string, string>>

  /** List tables in namespace */
  listTables(namespace: string[]): Promise<TableIdentifier[]>

  /** Load table with metadata */
  loadTable(namespace: string[], name: string): Promise<LoadedTable>

  /** Create new table */
  createTable(
    namespace: string[],
    name: string,
    options: CreateTableOptions
  ): Promise<LoadedTable>

  /** Commit table updates */
  commitTable(
    namespace: string[],
    name: string,
    commit: TableCommit
  ): Promise<void>

  /** Drop table */
  dropTable(namespace: string[], name: string, purge?: boolean): Promise<void>

  /** Rename table */
  renameTable(
    sourceNamespace: string[],
    sourceName: string,
    destNamespace: string[],
    destName: string
  ): Promise<void>

  /** Evolve table schema */
  evolveSchema(
    namespace: string[],
    name: string,
    evolution: SchemaEvolution
  ): Promise<void>
}

// ============================================================================
// Storage Adapter Types
// ============================================================================

/**
 * Configuration for R2 storage adapter
 */
export interface R2StorageConfig {
  /** R2 bucket binding */
  bucket: R2Bucket
  /** Key prefix for all operations */
  prefix?: string
}

/**
 * File listing entry
 */
export interface FileEntry {
  /** File key (without prefix) */
  key: string
  /** File size in bytes */
  size: number
  /** Last modified timestamp */
  lastModified?: Date
  /** ETag */
  etag?: string
}

/**
 * R2 storage adapter interface
 */
export interface R2StorageAdapter {
  /** Read metadata JSON file */
  readMetadata(path: string): Promise<TableMetadata>

  /** Read Parquet file as ArrayBuffer */
  readParquet(path: string): Promise<ArrayBuffer>

  /** Read Avro manifest file */
  readAvro(path: string): Promise<ArrayBuffer>

  /** Write metadata JSON file */
  writeMetadata(path: string, metadata: TableMetadata): Promise<void>

  /** Write Parquet file */
  writeParquet(path: string, data: ArrayBuffer): Promise<void>

  /** List files with prefix */
  listFiles(prefix: string): Promise<FileEntry[]>

  /** Delete file */
  deleteFile(path: string): Promise<void>

  /** Check if file exists */
  exists(path: string): Promise<boolean>

  /** Resolve S3 path to R2 key */
  resolveS3Path(s3Path: string): string
}

// ============================================================================
// Snapshot Types
// ============================================================================

/**
 * Options for resolving a snapshot
 */
export interface SnapshotResolutionOptions {
  /** Specific snapshot ID */
  snapshotId?: number
  /** Timestamp for AS OF TIMESTAMP queries */
  asOfTimestamp?: number
  /** Branch or tag reference */
  ref?: string
}

/**
 * Iceberg manifest file entry
 */
export interface IcebergManifest {
  /** Path to manifest file */
  manifestPath: string
  /** Manifest file length in bytes */
  manifestLength: number
  /** Partition spec ID */
  partitionSpecId: number
  /** Sequence number */
  sequenceNumber?: number
  /** Minimum sequence number */
  minSequenceNumber?: number
  /** Snapshot ID that added this manifest */
  addedSnapshotId: number
  /** Added files count */
  addedFilesCount?: number
  /** Existing files count */
  existingFilesCount?: number
  /** Deleted files count */
  deletedFilesCount?: number
  /** Added rows count */
  addedRowsCount?: number
  /** Existing rows count */
  existingRowsCount?: number
  /** Deleted rows count */
  deletedRowsCount?: number
  /** Partition field summaries */
  partitions?: PartitionSummary[]
}

/**
 * Partition summary in manifest
 */
export interface PartitionSummary {
  /** Contains null values */
  containsNull: boolean
  /** Contains NaN values */
  containsNan?: boolean
  /** Lower bound */
  lowerBound?: unknown
  /** Upper bound */
  upperBound?: unknown
}

/**
 * Data file entry in manifest
 */
export interface ManifestEntry {
  /** Entry status */
  status: 'EXISTING' | 'ADDED' | 'DELETED'
  /** Snapshot ID */
  snapshotId?: number
  /** Sequence number */
  sequenceNumber?: number
  /** File sequence number */
  fileSequenceNumber?: number
  /** Data file */
  dataFile: DataFile
}

/**
 * Data file information
 */
export interface DataFile {
  /** Content type */
  content: 'DATA' | 'POSITION_DELETES' | 'EQUALITY_DELETES'
  /** File path */
  filePath: string
  /** File format */
  fileFormat: 'PARQUET' | 'AVRO' | 'ORC'
  /** Partition values */
  partition: Record<string, unknown>
  /** Record count */
  recordCount: number
  /** File size in bytes */
  fileSizeBytes: number
  /** Column sizes (field ID -> bytes) */
  columnSizes?: Record<number, number>
  /** Value counts (field ID -> count) */
  valueCounts?: Record<number, number>
  /** Null value counts */
  nullValueCounts?: Record<number, number>
  /** NaN value counts */
  nanValueCounts?: Record<number, number>
  /** Lower bounds (field ID -> value) */
  lowerBounds?: Record<number, unknown>
  /** Upper bounds (field ID -> value) */
  upperBounds?: Record<number, unknown>
  /** Key metadata */
  keyMetadata?: ArrayBuffer
  /** Split offsets */
  splitOffsets?: number[]
  /** Equality field IDs */
  equalityIds?: number[]
  /** Sort order ID */
  sortOrderId?: number
}

/**
 * Snapshot view for consistent querying
 */
export interface SnapshotView {
  /** Snapshot ID */
  snapshotId: number
  /** Schema at this snapshot */
  schema: IcebergSchema
  /** Partition spec at this snapshot */
  partitionSpec: PartitionSpec
  /** Get data files visible at this snapshot */
  getDataFiles(): Promise<DataFile[]>
  /** Get manifests at this snapshot */
  getManifests(): Promise<IcebergManifest[]>
}

/**
 * Snapshot manager interface
 */
export interface SnapshotManager {
  /** List all snapshots */
  listSnapshots(metadata: TableMetadata): Promise<Snapshot[]>

  /** Get current snapshot */
  getCurrentSnapshot(metadata: TableMetadata): Promise<Snapshot | null>

  /** Resolve snapshot by ID, timestamp, or ref */
  resolveSnapshot(
    metadata: TableMetadata,
    options: SnapshotResolutionOptions
  ): Promise<Snapshot | null>

  /** Get manifests for a snapshot */
  getManifests(snapshot: Snapshot): Promise<IcebergManifest[]>

  /** Get manifest entries */
  getManifestEntries(manifest: IcebergManifest): Promise<ManifestEntry[]>

  /** Create a consistent view at snapshot */
  createSnapshotView(
    metadata: TableMetadata,
    snapshotId: number
  ): Promise<SnapshotView>
}

// ============================================================================
// Time Travel Types
// ============================================================================

/**
 * Parsed time travel query
 */
export interface ParsedTimeTravelQuery {
  /** Table name */
  tableName: string
  /** Base query without time travel clause */
  baseQuery: string
  /** AS OF TIMESTAMP value */
  asOfTimestamp?: number
  /** BEFORE TIMESTAMP value */
  beforeTimestamp?: number
  /** AS OF VERSION (snapshot ID) */
  snapshotId?: number
}

/**
 * Time travel query options
 */
export interface TimeTravelOptions {
  /** Specific snapshot ID */
  snapshotId?: number
  /** AS OF TIMESTAMP */
  asOfTimestamp?: number
  /** Branch or tag reference */
  ref?: string
}

/**
 * Time travel query result
 */
export interface TimeTravelQueryResult<T = Record<string, unknown>> {
  /** Result rows */
  rows: T[]
  /** Resolved snapshot ID */
  snapshotId: number
  /** AS OF timestamp (if specified) */
  asOfTimestamp?: number
  /** Query statistics */
  stats: TimeTravelQueryStats
}

/**
 * Time travel query statistics
 */
export interface TimeTravelQueryStats {
  /** Resolved snapshot ID */
  resolvedSnapshotId: number
  /** Snapshot timestamp */
  snapshotTimestamp: number
  /** Partitions pruned */
  partitionsPruned: number
  /** Files scanned */
  filesScanned: number
  /** Bytes scanned */
  bytesScanned: number
  /** Query execution time in ms */
  executionTimeMs: number
}

// ============================================================================
// Partition Pruning Types
// ============================================================================

/**
 * Partition with values and statistics
 */
export interface Partition {
  /** Partition values */
  values: Record<string, unknown>
  /** File path */
  path: string
  /** Record count */
  recordCount: number
  /** File size in bytes */
  fileSizeBytes: number
  /** Column statistics */
  columnStats?: Record<string, unknown>
}

/**
 * Filter predicate for pruning
 */
export interface FilterPredicate {
  /** Column name */
  column: string
  /** Operator */
  op: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'IN' | 'NOT IN' | 'BETWEEN' | 'IS NULL' | 'IS NOT NULL'
  /** Value(s) */
  value: unknown
  /** Second value for BETWEEN */
  value2?: unknown
}

/**
 * Pruning options
 */
export interface PruningOptions {
  /** Filter predicates */
  filters: FilterPredicate[]
}

/**
 * Partition pruning result
 */
export interface PartitionPruningResult {
  /** Selected partitions after pruning */
  selectedPartitions: Partition[]
  /** Number of partitions pruned */
  prunedCount: number
  /** Total partitions before pruning */
  totalCount: number
}

/**
 * Partition pruner interface
 */
export interface PartitionPruner {
  /** Prune partitions based on partition spec and filters */
  prunePartitions(
    partitions: Partition[],
    partitionSpec: PartitionSpec,
    options: PruningOptions
  ): PartitionPruningResult

  /** Prune using column statistics */
  pruneByStats(
    partitions: Partition[],
    options: PruningOptions
  ): PartitionPruningResult

  /** Combined pruning (partition values + stats) */
  prune(
    partitions: Partition[],
    partitionSpec: PartitionSpec,
    options: PruningOptions
  ): PartitionPruningResult
}

// ============================================================================
// Compaction Types
// ============================================================================

/**
 * Compaction configuration
 */
export interface CompactionConfig {
  /** Target file size in bytes */
  targetFileSizeBytes: number
  /** Minimum input files to trigger compaction */
  minInputFiles: number
  /** Maximum concurrent compaction tasks */
  maxConcurrentTasks?: number
  /** Delete original files after compaction */
  deleteOriginalFiles?: boolean
  /** Preserve sort order */
  preserveSortOrder?: boolean
}

/**
 * File information for compaction
 */
export interface CompactionFile {
  /** File path */
  path: string
  /** File size in bytes */
  sizeBytes: number
  /** Record count */
  recordCount?: number
  /** Partition values */
  partition?: Record<string, unknown>
}

/**
 * Compaction analysis result
 */
export interface CompactionAnalysis {
  /** Whether compaction is needed */
  needsCompaction: boolean
  /** Files identified as small */
  smallFiles: CompactionFile[]
  /** Estimated output files count */
  estimatedOutputFiles: number
  /** Estimated space savings */
  estimatedSavingsBytes?: number
}

/**
 * Compaction statistics
 */
export interface CompactionStats {
  /** Input file count */
  inputFileCount: number
  /** Input bytes */
  inputBytes: number
  /** Output file count */
  outputFileCount: number
  /** Output bytes */
  outputBytes: number
  /** Compaction ratio */
  compactionRatio: number
  /** Execution time in ms */
  executionTimeMs: number
}

/**
 * Compaction result
 */
export interface CompactionResult {
  /** Whether compaction succeeded */
  success: boolean
  /** Input file paths */
  inputFiles: string[]
  /** Output file paths */
  outputFiles: string[]
  /** Compaction statistics */
  stats: CompactionStats
  /** Error message if failed */
  error?: string
}

/**
 * Compaction trigger type
 */
export type CompactionTriggerType = 'file-count' | 'cumulative-size' | 'time-based'

/**
 * Compaction trigger configuration
 */
export interface CompactionTriggerConfig {
  /** Trigger type */
  type: CompactionTriggerType
  /** Threshold value */
  threshold?: number
  /** Small file size threshold */
  smallFileSizeBytes?: number
  /** Time interval in ms */
  intervalMs?: number
}

/**
 * Compaction trigger
 */
export interface CompactionTrigger {
  /** Evaluate whether compaction should run */
  evaluate(
    metadata: TableMetadata,
    files: CompactionFile[]
  ): Promise<boolean>
}

/**
 * Compaction manager interface
 */
export interface CompactionManager {
  /** Analyze files for compaction needs */
  analyze(
    files: CompactionFile[],
    config: CompactionConfig
  ): Promise<CompactionAnalysis>

  /** Analyze by partition */
  analyzeByPartition(
    partitions: Record<string, CompactionFile[]>,
    config: CompactionConfig
  ): Promise<Record<string, CompactionAnalysis>>

  /** Execute compaction */
  compact(
    files: CompactionFile[],
    config: CompactionConfig
  ): Promise<CompactionResult>

  /** Create compaction trigger */
  createTrigger(config: CompactionTriggerConfig): CompactionTrigger
}

// ============================================================================
// Table Types
// ============================================================================

/**
 * Iceberg table configuration
 */
export interface IcebergTableConfig {
  /** Table metadata */
  metadata: TableMetadata
  /** Storage adapter */
  storage: R2StorageAdapter
  /** Catalog (optional, for commits) */
  catalog?: IcebergCatalog
}

/**
 * Iceberg table query result
 */
export interface IcebergQueryResult<T = Record<string, unknown>> {
  /** Result rows */
  rows: T[]
  /** Snapshot ID used for query */
  snapshotId: number
  /** AS OF timestamp if specified */
  asOfTimestamp?: number
  /** Query statistics */
  stats: IcebergQueryStats
}

/**
 * Iceberg query statistics
 */
export interface IcebergQueryStats {
  /** Resolved snapshot ID */
  resolvedSnapshotId: number
  /** Snapshot timestamp */
  snapshotTimestamp: number
  /** Partitions pruned */
  partitionsPruned: number
  /** Files scanned */
  filesScanned: number
  /** Bytes scanned */
  bytesScanned: number
  /** Execution time in ms */
  executionTimeMs: number
}

/**
 * Iceberg table interface
 */
export interface IcebergTable {
  /** Table metadata */
  readonly metadata: TableMetadata

  /** Query table with optional time travel */
  query<T = Record<string, unknown>>(
    sql: string,
    options?: TimeTravelOptions
  ): Promise<IcebergQueryResult<T>>

  /** Get current snapshot */
  getCurrentSnapshot(): Promise<Snapshot | null>

  /** Get snapshot by ID */
  getSnapshot(snapshotId: number): Promise<Snapshot | null>

  /** List all snapshots */
  listSnapshots(): Promise<Snapshot[]>

  /** Refresh metadata from storage */
  refresh(): Promise<void>
}

// ============================================================================
// Transaction Types
// ============================================================================

/**
 * Transaction context for atomic operations
 */
export interface TransactionContext {
  /** Transaction ID */
  id: string
  /** Table metadata at transaction start */
  baseMetadata: TableMetadata
  /** Pending updates */
  updates: TableUpdate[]
  /** Add update to transaction */
  addUpdate(update: TableUpdate): void
  /** Commit transaction */
  commit(): Promise<void>
  /** Rollback transaction */
  rollback(): void
}

// ============================================================================
// Snapshot Types (re-export with additional fields)
// ============================================================================

export interface IcebergSnapshot extends Snapshot {
  /** Parent snapshot ID */
  parentSnapshotId?: number
}
