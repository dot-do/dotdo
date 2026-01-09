/**
 * Iceberg table format types for IcebergMetadataDO
 *
 * These types support parsing and caching Iceberg metadata,
 * manifest lists (Avro), manifests (Avro), and data file paths.
 *
 * @module types/iceberg
 */

// Re-export base types from db/iceberg/types
export type {
  IcebergMetadata,
  ManifestFile,
  ManifestList,
  Snapshot,
  PartitionSpec,
  PartitionField,
  Schema,
  SchemaField,
  SchemaType,
  DataFileEntry,
  ColumnStats,
  PartitionFilter,
  FindFileResult,
  IcebergRecord,
} from '../db/iceberg/types'

// ============================================================================
// Filter Types for Partition Pruning
// ============================================================================

/**
 * Comparison operators for filter expressions
 */
export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'is_null' | 'is_not_null'

/**
 * Filter expression for partition and column pruning
 */
export interface Filter {
  /** Column name to filter on */
  column: string
  /** Comparison operator */
  operator: FilterOperator
  /** Value to compare against (not needed for is_null/is_not_null) */
  value?: unknown
  /** Multiple values for 'in' and 'not_in' operators */
  values?: unknown[]
}

/**
 * Combined filter with logical operators
 */
export interface CombinedFilter {
  /** Logical operator to combine filters */
  type: 'and' | 'or'
  /** Child filters */
  filters: (Filter | CombinedFilter)[]
}

// ============================================================================
// File Scan Plan Types
// ============================================================================

/**
 * Information about a data file to scan
 */
export interface DataFileInfo {
  /** Full path to the data file in R2 */
  filePath: string
  /** File format (PARQUET, AVRO, ORC) */
  fileFormat: 'PARQUET' | 'AVRO' | 'ORC'
  /** Partition values for this file */
  partition: Record<string, string | number | null>
  /** Number of records in the file */
  recordCount: number
  /** File size in bytes */
  fileSizeBytes: number
  /** Column-level statistics for predicate pushdown */
  columnStats?: {
    [columnName: string]: {
      lowerBound?: unknown
      upperBound?: unknown
      nullCount?: number
      distinctCount?: number
    }
  }
}

/**
 * Result of partition pruning - a plan of files to scan
 */
export interface FileScanPlan {
  /** Table identifier */
  tableId: string
  /** Snapshot ID this plan is based on */
  snapshotId: number
  /** Files to scan after partition pruning */
  files: DataFileInfo[]
  /** Total number of records across all files */
  totalRecords: number
  /** Total size in bytes across all files */
  totalSizeBytes: number
  /** Statistics about pruning */
  pruningStats: {
    /** Total manifests in snapshot */
    totalManifests: number
    /** Manifests pruned by partition bounds */
    prunedManifests: number
    /** Total data files before pruning */
    totalDataFiles: number
    /** Data files pruned by partition/column bounds */
    prunedDataFiles: number
  }
  /** Timestamp when plan was created */
  createdAt: number
}

// ============================================================================
// Cached Metadata Types
// ============================================================================

/**
 * Cached table metadata with TTL
 */
export interface CachedMetadata {
  /** Parsed Iceberg metadata */
  metadata: import('../db/iceberg/types').IcebergMetadata
  /** When this cache entry was created */
  cachedAt: number
  /** TTL in milliseconds */
  ttlMs: number
  /** Current snapshot ID at cache time */
  snapshotId: number | null
  /** Location of metadata.json */
  metadataLocation: string
}

/**
 * Cached manifest list
 */
export interface CachedManifestList {
  /** Parsed manifest list entries */
  manifests: import('../db/iceberg/types').ManifestFile[]
  /** Snapshot ID this list belongs to */
  snapshotId: number
  /** When this cache entry was created */
  cachedAt: number
  /** TTL in milliseconds */
  ttlMs: number
}

/**
 * Cached manifest (data file entries)
 */
export interface CachedManifest {
  /** Path to the manifest file */
  manifestPath: string
  /** Parsed data file entries */
  dataFiles: import('../db/iceberg/types').DataFileEntry[]
  /** When this cache entry was created */
  cachedAt: number
  /** TTL in milliseconds */
  ttlMs: number
}

// ============================================================================
// Avro Schema Types for Iceberg Files
// ============================================================================

/**
 * Avro schema for manifest list entry (manifest_file)
 * Based on Iceberg spec v2
 */
export interface AvroManifestListEntry {
  manifest_path: string
  manifest_length: number
  partition_spec_id: number
  content: 0 | 1 // 0 = data, 1 = deletes
  sequence_number: number
  min_sequence_number: number
  added_snapshot_id: number
  added_files_count: number
  existing_files_count: number
  deleted_files_count: number
  added_rows_count: number
  existing_rows_count: number
  deleted_rows_count: number
  partitions?: Array<{
    contains_null: boolean
    contains_nan?: boolean
    lower_bound?: Buffer
    upper_bound?: Buffer
  }>
}

/**
 * Avro schema for manifest entry (data file)
 * Based on Iceberg spec v2
 */
export interface AvroManifestEntry {
  status: 0 | 1 | 2 // 0 = existing, 1 = added, 2 = deleted
  snapshot_id: number | null
  sequence_number: number | null
  file_sequence_number: number | null
  data_file: {
    content: 0 | 1 | 2 // 0 = data, 1 = position deletes, 2 = equality deletes
    file_path: string
    file_format: string
    partition: Record<string, unknown>
    record_count: number
    file_size_in_bytes: number
    column_sizes?: Record<string, number>
    value_counts?: Record<string, number>
    null_value_counts?: Record<string, number>
    nan_value_counts?: Record<string, number>
    lower_bounds?: Record<string, Buffer>
    upper_bounds?: Record<string, Buffer>
    key_metadata?: Buffer
    split_offsets?: number[]
    equality_ids?: number[]
    sort_order_id?: number
  }
}

// ============================================================================
// IcebergMetadataDO Types
// ============================================================================

/**
 * Options for getting table metadata
 */
export interface GetMetadataOptions {
  /** Force refresh even if cached */
  forceRefresh?: boolean
  /** Custom TTL for this request (overrides default) */
  ttlMs?: number
}

/**
 * Options for getting a partition plan
 */
export interface GetPartitionPlanOptions {
  /** Filters to apply for partition pruning */
  filters?: Filter[]
  /** Snapshot ID to use (default: current) */
  snapshotId?: number
  /** Maximum number of files to include in plan */
  maxFiles?: number
}

/**
 * Statistics about the metadata cache
 */
export interface CacheStats {
  /** Number of cached tables */
  cachedTables: number
  /** Number of cached manifest lists */
  cachedManifestLists: number
  /** Number of cached manifests */
  cachedManifests: number
  /** Cache hit rate (0-1) */
  hitRate: number
  /** Total cache size in bytes (approximate) */
  cacheSizeBytes: number
}

/**
 * Result of cache invalidation
 */
export interface InvalidationResult {
  /** Whether invalidation was successful */
  success: boolean
  /** Number of cache entries removed */
  entriesRemoved: number
  /** Table ID that was invalidated */
  tableId: string
  /** Timestamp of invalidation */
  invalidatedAt: number
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a filter is a combined filter (AND/OR)
 */
export function isCombinedFilter(filter: Filter | CombinedFilter): filter is CombinedFilter {
  return 'type' in filter && ('and' === filter.type || 'or' === filter.type)
}

/**
 * Check if a value matches a filter
 */
export function matchesFilter(value: unknown, filter: Filter): boolean {
  const { operator } = filter

  switch (operator) {
    case 'is_null':
      return value === null || value === undefined
    case 'is_not_null':
      return value !== null && value !== undefined
    case 'eq':
      return value === filter.value
    case 'neq':
      return value !== filter.value
    case 'gt':
      return typeof value === 'number' && typeof filter.value === 'number' && value > filter.value
    case 'gte':
      return typeof value === 'number' && typeof filter.value === 'number' && value >= filter.value
    case 'lt':
      return typeof value === 'number' && typeof filter.value === 'number' && value < filter.value
    case 'lte':
      return typeof value === 'number' && typeof filter.value === 'number' && value <= filter.value
    case 'in':
      return Array.isArray(filter.values) && filter.values.includes(value)
    case 'not_in':
      return Array.isArray(filter.values) && !filter.values.includes(value)
    default:
      return false
  }
}
