/**
 * Type definitions for DuckDB Iceberg Extension Integration
 *
 * Provides types for R2 Data Catalog integration with DuckDB WASM.
 *
 * Key constraints:
 * - DuckDB Iceberg extension works in browser WASM (not Workers due to sync XHR)
 * - R2 Data Catalog provides REST API for Iceberg metadata
 * - This integration uses direct R2 access in Workers, DuckDB-WASM in browser
 *
 * @module db/compat/sql/duckdb-wasm/iceberg/types
 * @see https://iceberg.apache.org/spec/
 */

import type { R2Bucket } from '@cloudflare/workers-types'

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for an Iceberg table reference
 */
export interface IcebergTableConfig {
  /** Namespace/database containing the table */
  namespace: string

  /** Table name */
  tableName: string

  /** R2 bucket name for data files */
  bucket: string

  /** R2 Data Catalog REST endpoint */
  catalogEndpoint: string

  /** Optional warehouse path prefix */
  warehousePath?: string

  /** Optional snapshot ID for time-travel queries */
  snapshotId?: number
}

/**
 * Configuration for R2 Data Catalog client
 */
export interface R2CatalogConfig {
  /** Cloudflare account ID */
  accountId: string

  /** R2 access key ID */
  accessKeyId: string

  /** R2 secret access key */
  secretAccessKey: string

  /** R2 endpoint URL (e.g., https://account-id.r2.cloudflarestorage.com) */
  endpoint: string

  /** R2 bucket name */
  bucketName: string

  /** Optional custom catalog path */
  catalogPath?: string
}

/**
 * Options for creating an IcebergDataSource
 */
export interface DataSourceOptions {
  /** R2 catalog configuration */
  catalogConfig: R2CatalogConfig

  /** Custom fetch function (for testing) */
  fetchFn?: typeof fetch

  /** R2 bucket binding (for Workers) */
  r2Bucket?: R2Bucket

  /** Cache TTL in milliseconds (default: 60000) */
  cacheTtlMs?: number
}

// ============================================================================
// Iceberg Schema Types
// ============================================================================

/**
 * Iceberg primitive type names
 */
export type IcebergPrimitiveType =
  | 'boolean'
  | 'int'
  | 'long'
  | 'float'
  | 'double'
  | 'decimal'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'timestamptz'
  | 'string'
  | 'uuid'
  | 'fixed'
  | 'binary'

/**
 * Iceberg field definition
 */
export interface IcebergField {
  /** Unique field ID */
  id: number

  /** Field name */
  name: string

  /** Field type (primitive string or complex type) */
  type: IcebergPrimitiveType | string | IcebergComplexType

  /** Whether the field is required (non-nullable) */
  required: boolean

  /** Optional documentation */
  doc?: string

  /** Initial default value */
  initialDefault?: unknown

  /** Write default value */
  writeDefault?: unknown
}

/**
 * Complex Iceberg types (struct, list, map)
 */
export interface IcebergComplexType {
  /** Type kind */
  type: 'struct' | 'list' | 'map'

  /** Fields for struct type */
  fields?: IcebergField[]

  /** Element ID for list type */
  elementId?: number

  /** Element type for list type */
  element?: IcebergPrimitiveType | string | IcebergComplexType

  /** Whether list elements are required */
  elementRequired?: boolean

  /** Key ID for map type */
  keyId?: number

  /** Key type for map type */
  key?: IcebergPrimitiveType | string

  /** Value ID for map type */
  valueId?: number

  /** Value type for map type */
  value?: IcebergPrimitiveType | string | IcebergComplexType

  /** Whether map values are required */
  valueRequired?: boolean
}

/**
 * Iceberg schema definition
 */
export interface IcebergSchema {
  /** Schema ID */
  schemaId: number

  /** Always 'struct' for table schema */
  type: 'struct'

  /** Schema fields */
  fields: IcebergField[]

  /** Identifier field IDs (primary key columns) */
  identifierFieldIds?: number[]
}

// ============================================================================
// Partition Types
// ============================================================================

/**
 * Partition field definition
 */
export interface PartitionField {
  /** Source column ID in schema */
  sourceId: number

  /** Partition field ID */
  fieldId: number

  /** Partition field name */
  name: string

  /** Transform to apply: identity, bucket[N], truncate[N], year, month, day, hour */
  transform: string
}

/**
 * Partition specification
 */
export interface PartitionSpec {
  /** Spec ID */
  specId: number

  /** Partition fields */
  fields: PartitionField[]
}

// ============================================================================
// Snapshot Types
// ============================================================================

/**
 * Snapshot summary with operation and metrics
 */
export interface SnapshotSummary {
  /** Operation type */
  operation: 'append' | 'replace' | 'overwrite' | 'delete'

  /** Additional metrics as key-value strings */
  [key: string]: string
}

/**
 * Iceberg snapshot representing table state at a point in time
 */
export interface Snapshot {
  /** Unique snapshot ID */
  snapshotId: number

  /** Parent snapshot ID */
  parentSnapshotId?: number

  /** Sequence number for ordering */
  sequenceNumber: number

  /** Timestamp when snapshot was created (ms) */
  timestampMs: number

  /** Path to manifest list file */
  manifestList: string

  /** Snapshot summary */
  summary: SnapshotSummary

  /** Schema ID used by this snapshot */
  schemaId?: number
}

// ============================================================================
// Table Metadata Types
// ============================================================================

/**
 * Sort field definition
 */
export interface SortField {
  /** Source column ID */
  sourceId: number

  /** Transform to apply before sorting */
  transform: string

  /** Sort direction */
  direction: 'asc' | 'desc'

  /** Null ordering */
  nullOrder: 'nulls-first' | 'nulls-last'
}

/**
 * Sort order specification
 */
export interface SortOrder {
  /** Order ID */
  orderId: number

  /** Sort fields */
  fields: SortField[]
}

/**
 * Iceberg table metadata (metadata.json)
 */
export interface TableMetadata {
  /** Format version: 1 or 2 */
  formatVersion: 1 | 2

  /** Table UUID */
  tableUuid: string

  /** Table location in storage */
  location: string

  /** Last updated timestamp (ms) */
  lastUpdatedMs: number

  /** Last sequence number */
  lastSequenceNumber?: number

  /** Last column ID */
  lastColumnId?: number

  /** All schemas */
  schemas: IcebergSchema[]

  /** Current schema ID */
  currentSchemaId: number

  /** All partition specs */
  partitionSpecs: PartitionSpec[]

  /** Default partition spec ID */
  defaultSpecId: number

  /** Last partition ID */
  lastPartitionId?: number

  /** All sort orders */
  sortOrders?: SortOrder[]

  /** Default sort order ID */
  defaultSortOrderId?: number

  /** Table properties */
  properties?: Record<string, string>

  /** Current snapshot ID (null for empty tables) */
  currentSnapshotId: number | null

  /** All snapshots */
  snapshots: Snapshot[]

  /** Snapshot log */
  snapshotLog?: Array<{
    snapshotId: number
    timestampMs: number
  }>

  /** Metadata log */
  metadataLog?: Array<{
    metadataFile: string
    timestampMs: number
  }>

  /** Refs (branches and tags) */
  refs?: Record<string, {
    snapshotId: number
    type: 'branch' | 'tag'
    maxRefAgeMs?: number
    maxSnapshotAgeMs?: number
    minSnapshotsToKeep?: number
  }>
}

// ============================================================================
// Manifest Types
// ============================================================================

/**
 * Column statistics for data files
 */
export interface ColumnStats {
  /** Column field ID */
  fieldId: number

  /** Minimum value */
  lowerBound?: unknown

  /** Maximum value */
  upperBound?: unknown

  /** Number of null values */
  nullCount?: number

  /** Number of NaN values */
  nanCount?: number

  /** Distinct value count */
  distinctCount?: number
}

/**
 * Data file entry in a manifest
 */
export interface DataFileEntry {
  /** Status: 0=existing, 1=added, 2=deleted */
  status: 0 | 1 | 2

  /** File path relative to table location */
  filePath: string

  /** File format: 'PARQUET' | 'AVRO' | 'ORC' */
  fileFormat: string

  /** Partition values */
  partition: Record<string, unknown>

  /** Record count */
  recordCount: number

  /** File size in bytes */
  fileSizeBytes: number

  /** Column statistics */
  columnStats?: ColumnStats[]

  /** Column sizes (fieldId -> bytes) */
  columnSizes?: Record<number, number>

  /** Lower bounds (fieldId -> value) */
  lowerBounds?: Record<number, unknown>

  /** Upper bounds (fieldId -> value) */
  upperBounds?: Record<number, unknown>

  /** Null value counts (fieldId -> count) */
  nullValueCounts?: Record<number, number>
}

/**
 * Manifest file entry in manifest list
 */
export interface ManifestFile {
  /** Path to manifest file (Avro) */
  manifestPath: string

  /** Manifest file length in bytes */
  manifestLength: number

  /** Partition spec ID used by this manifest */
  partitionSpecId: number

  /** Sequence number */
  sequenceNumber?: number

  /** Minimum sequence number of files */
  minSequenceNumber?: number

  /** Snapshot ID that added this manifest */
  addedSnapshotId: number

  /** Count of added data files */
  addedFilesCount?: number

  /** Count of existing data files */
  existingFilesCount?: number

  /** Count of deleted data files */
  deletedFilesCount?: number

  /** Total rows added */
  addedRowsCount?: number

  /** Rows in existing files */
  existingRowsCount?: number

  /** Rows in deleted files */
  deletedRowsCount?: number

  /** Partition field summaries */
  partitions?: Array<{
    containsNull: boolean
    containsNan?: boolean
    lowerBound?: unknown
    upperBound?: unknown
  }>
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Predicate for partition pruning and filter pushdown
 */
export interface Predicate {
  /** Column name */
  column: string

  /** Operator */
  op: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'IN' | 'BETWEEN' | 'IS NULL' | 'IS NOT NULL'

  /** Value(s) for comparison */
  value: unknown
}

/**
 * Options for scanning an Iceberg table
 */
export interface ScanOptions {
  /** Namespace */
  namespace: string

  /** Table name */
  tableName: string

  /** Optional predicate for partition pruning */
  predicate?: Predicate

  /** Table metadata */
  metadata: TableMetadata

  /** Function to fetch Parquet files */
  fetchParquet: (path: string) => Promise<ArrayBuffer>

  /** Optional column projection */
  columns?: string[]

  /** Optional limit */
  limit?: number
}

/**
 * Result of scanning an Iceberg table
 */
export interface ScanResult {
  /** Number of partitions pruned */
  prunedPartitions: number

  /** Number of files scanned */
  scannedFiles: number

  /** Total bytes scanned */
  scannedBytes: number

  /** Parquet file buffers */
  files: ArrayBuffer[]

  /** Data file paths that were scanned */
  filePaths: string[]
}

// ============================================================================
// Registration Types
// ============================================================================

/**
 * Result of registering an Iceberg table with DuckDB
 */
export interface RegisterTableResult {
  /** Whether registration succeeded */
  success: boolean

  /** Registered table name */
  tableName: string

  /** Whether the table is empty (no snapshots) */
  isEmpty?: boolean

  /** Error message if registration failed */
  error?: string

  /** Number of data files registered */
  fileCount?: number

  /** Total bytes registered */
  totalBytes?: number
}

/**
 * Table reference returned by loadTable
 */
export interface TableRef {
  /** Namespace */
  namespace: string

  /** Table name */
  tableName: string

  /** Table metadata */
  metadata: TableMetadata

  /** Current schema */
  schema: IcebergSchema

  /** Current partition spec */
  partitionSpec: PartitionSpec

  /** Current snapshot (null if table is empty) */
  currentSnapshot: Snapshot | null
}

// ============================================================================
// Data Source Types
// ============================================================================

/**
 * Query result from IcebergDataSource
 */
export interface QueryResult<T = Record<string, unknown>> {
  /** Result rows */
  rows: T[]

  /** Column metadata */
  columns: Array<{
    name: string
    type: string
  }>

  /** Number of rows affected (for mutations) */
  rowsAffected?: number

  /** Query statistics */
  stats?: {
    /** Partitions scanned */
    partitionsScanned: number

    /** Files scanned */
    filesScanned: number

    /** Bytes scanned */
    bytesScanned: number

    /** Execution time in ms */
    executionTimeMs: number
  }
}

/**
 * IcebergDataSource interface for unified table access
 */
export interface IcebergDataSource {
  /**
   * Get a table reference
   * @param namespace Namespace/database name
   * @param tableName Table name
   */
  getTable(namespace: string, tableName: string): Promise<TableRef>

  /**
   * Execute a SQL query against Iceberg tables
   * @param sql SQL query string
   * @param params Optional query parameters
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>

  /**
   * Clear metadata cache
   */
  clearCache(): void
}
