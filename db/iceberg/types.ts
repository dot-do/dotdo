/**
 * Iceberg table format types for direct navigation
 *
 * These types represent the Iceberg metadata structures used
 * for fast point lookups without R2 SQL overhead.
 */

import type { R2Bucket } from '@cloudflare/workers-types'

/**
 * Column-level statistics for data files.
 * Used to determine which Parquet file contains a specific id.
 */
export interface ColumnStats {
  /** Column field id */
  fieldId: number
  /** Minimum value in the column (encoded as bytes or string) */
  lowerBound?: string | Uint8Array
  /** Maximum value in the column (encoded as bytes or string) */
  upperBound?: string | Uint8Array
  /** Number of null values */
  nullCount?: number
  /** Number of NaN values (for floating point columns) */
  nanCount?: number
  /** Number of distinct values */
  distinctCount?: number
}

/**
 * Entry for a data file in a manifest file.
 * Contains file path and statistics for partition pruning.
 */
export interface DataFileEntry {
  /** Status: 0=existing, 1=added, 2=deleted */
  status: 0 | 1 | 2
  /** File path relative to table location */
  filePath: string
  /** File format: 'PARQUET' | 'AVRO' | 'ORC' */
  fileFormat: string
  /** Partition values (e.g., { ns: 'payments.do', type: 'Function' }) */
  partition: Record<string, string | number | null>
  /** Number of records in this file */
  recordCount: number
  /** File size in bytes */
  fileSizeBytes: number
  /** Per-column statistics */
  columnStats?: ColumnStats[]
  /** Column sizes map (fieldId -> size in bytes) */
  columnSizes?: Record<number, number>
  /** Value counts map (fieldId -> count) */
  valueCounts?: Record<number, number>
  /** Null value counts map (fieldId -> count) */
  nullValueCounts?: Record<number, number>
  /** Lower bounds map (fieldId -> bound value) */
  lowerBounds?: Record<number, string | Uint8Array>
  /** Upper bounds map (fieldId -> bound value) */
  upperBounds?: Record<number, string | Uint8Array>
}

/**
 * Entry in a manifest list pointing to a manifest file.
 * Each manifest file contains entries for data files.
 */
export interface ManifestFile {
  /** Path to the manifest file (Avro) */
  manifestPath: string
  /** Length of the manifest file in bytes */
  manifestLength: number
  /** Partition spec id used by this manifest */
  partitionSpecId: number
  /** Sequence number for ordering */
  sequenceNumber?: number
  /** Minimum sequence number of files in this manifest */
  minSequenceNumber?: number
  /** Snapshot id that added this manifest */
  addedSnapshotId: number
  /** Count of added data files */
  addedFilesCount?: number
  /** Count of existing data files */
  existingFilesCount?: number
  /** Count of deleted data files */
  deletedFilesCount?: number
  /** Total number of rows across all data files */
  addedRowsCount?: number
  /** Rows in existing files */
  existingRowsCount?: number
  /** Rows in deleted files */
  deletedRowsCount?: number
  /** Partition field summaries for pruning */
  partitions?: Array<{
    containsNull: boolean
    containsNan?: boolean
    lowerBound?: string | Uint8Array
    upperBound?: string | Uint8Array
  }>
}

/**
 * Manifest list containing references to all manifest files for a snapshot.
 */
export interface ManifestList {
  /** List of manifest file entries */
  manifests: ManifestFile[]
}

/**
 * Snapshot represents a point-in-time state of the table.
 */
export interface Snapshot {
  /** Unique snapshot id */
  snapshotId: number
  /** Parent snapshot id (null for first snapshot) */
  parentSnapshotId?: number | null
  /** Sequence number for ordering */
  sequenceNumber?: number
  /** Timestamp when this snapshot was created (ms since epoch) */
  timestampMs: number
  /** Path to manifest list file */
  manifestList: string
  /** Summary of snapshot operation */
  summary?: {
    operation: 'append' | 'replace' | 'overwrite' | 'delete'
    [key: string]: string
  }
  /** Schema id used by this snapshot */
  schemaId?: number
}

/**
 * Partition field specification.
 */
export interface PartitionField {
  /** Source column id */
  sourceId: number
  /** Partition field id */
  fieldId: number
  /** Name of the partition field */
  name: string
  /** Transform applied: identity, bucket, truncate, year, month, day, hour */
  transform: string
}

/**
 * Partition specification.
 */
export interface PartitionSpec {
  /** Spec id */
  specId: number
  /** List of partition fields */
  fields: PartitionField[]
}

/**
 * Schema field definition.
 */
export interface SchemaField {
  /** Field id */
  id: number
  /** Field name */
  name: string
  /** Whether field is required */
  required: boolean
  /** Field type (primitive or complex) */
  type: string | SchemaType
}

/**
 * Complex schema type (struct, list, map).
 */
export interface SchemaType {
  type: 'struct' | 'list' | 'map'
  fields?: SchemaField[]
  elementId?: number
  element?: string | SchemaType
  elementRequired?: boolean
  keyId?: number
  key?: string | SchemaType
  keyRequired?: boolean
  valueId?: number
  value?: string | SchemaType
  valueRequired?: boolean
}

/**
 * Table schema definition.
 */
export interface Schema {
  /** Schema id */
  schemaId: number
  /** Type is always 'struct' for table schema */
  type: 'struct'
  /** List of schema fields */
  fields: SchemaField[]
  /** Identifier field ids (primary key columns) */
  identifierFieldIds?: number[]
}

/**
 * Iceberg table metadata (metadata.json).
 * Contains table configuration, schema, partitioning, and snapshots.
 */
export interface IcebergMetadata {
  /** Format version: 1 or 2 */
  formatVersion: 1 | 2
  /** Unique table UUID */
  tableUuid: string
  /** Table location in storage */
  location: string
  /** Last updated timestamp (ms since epoch) */
  lastUpdatedMs: number
  /** Last assigned column id */
  lastColumnId: number
  /** List of schemas */
  schemas: Schema[]
  /** Current schema id */
  currentSchemaId: number
  /** List of partition specs */
  partitionSpecs: PartitionSpec[]
  /** Default partition spec id */
  defaultSpecId: number
  /** Last assigned partition field id */
  lastPartitionId: number
  /** Table properties */
  properties?: Record<string, string>
  /** Current snapshot id (null if table is empty) */
  currentSnapshotId?: number | null
  /** List of snapshots */
  snapshots?: Snapshot[]
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
  /** Sort orders */
  sortOrders?: Array<{
    orderId: number
    fields: Array<{
      sourceId: number
      transform: string
      direction: 'asc' | 'desc'
      nullOrder: 'nulls-first' | 'nulls-last'
    }>
  }>
  /** Default sort order id */
  defaultSortOrderId?: number
  /** Refs (branches and tags) */
  refs?: Record<
    string,
    {
      snapshotId: number
      type: 'branch' | 'tag'
      maxRefAgeMs?: number
      maxSnapshotAgeMs?: number
      minSnapshotsToKeep?: number
    }
  >
}

/**
 * Visibility levels for records.
 * - 'public': Accessible without authentication
 * - 'unlisted': Accessible by direct lookup only (no listing)
 * - 'org': Accessible to organization members only
 * - 'user': Accessible to the owning user only
 */
export type Visibility = 'public' | 'unlisted' | 'org' | 'user'

/**
 * Auth context for visibility checking.
 */
export interface AuthContext {
  /** Current user ID */
  userId?: string
  /** Current organization ID */
  orgId?: string
  /** User roles */
  roles?: string[]
}

/**
 * Partition specification for point lookups.
 * Used to filter manifest files and data files.
 */
export interface PartitionFilter {
  /** Namespace (e.g., 'payments.do') */
  ns: string
  /** Resource type (e.g., 'Function', 'Schema', 'Event') */
  type: string
  /** Visibility level filter */
  visibility?: Visibility
}

/**
 * Options for IcebergReader constructor.
 */
export interface IcebergReaderOptions {
  /** R2 bucket containing Iceberg tables */
  bucket: R2Bucket
  /** Base path for Iceberg tables (default: 'iceberg/') */
  basePath?: string
  /** Whether to cache metadata in memory (default: true) */
  cacheMetadata?: boolean
  /** Cache TTL in milliseconds (default: 60000) */
  cacheTtlMs?: number
}

/**
 * Options for findFile method.
 */
export interface FindFileOptions {
  /** Table name (e.g., 'do_resources', 'do_events') */
  table: string
  /** Partition filter for efficient pruning */
  partition: PartitionFilter
  /** Record id to find */
  id: string
  /** Snapshot id (default: current snapshot) */
  snapshotId?: number
  /** Auth context for visibility checks */
  auth?: AuthContext
}

/**
 * Options for getRecord method.
 */
export interface GetRecordOptions extends FindFileOptions {
  /** Columns to read (default: all) */
  columns?: string[]
}

/**
 * Result of findFile method.
 */
export interface FindFileResult {
  /** Path to the data file containing the record */
  filePath: string
  /** File format */
  fileFormat: string
  /** Record count in the file */
  recordCount: number
  /** File size in bytes */
  fileSizeBytes: number
  /** Partition values */
  partition: Record<string, string | number | null>
}

/**
 * Generic record type returned by getRecord.
 */
export interface IcebergRecord {
  /** Namespace */
  ns: string
  /** Resource type */
  type: string
  /** Record id */
  id: string
  /** Timestamp */
  ts: Date | string
  /** Additional fields depending on table schema */
  [key: string]: unknown
}
