/**
 * Iceberg Manifest Parsing
 *
 * Parses Avro-encoded manifest-list and manifest-file structures
 * for direct navigation from R2 Data Catalog.
 *
 * Iceberg Spec References:
 * - Manifest List: https://iceberg.apache.org/spec/#manifest-list
 * - Manifest File: https://iceberg.apache.org/spec/#manifest-files
 * - Data File: https://iceberg.apache.org/spec/#data-file-content
 */

// ============================================================================
// Manifest List Types (from manifest-list.avro)
// ============================================================================

/**
 * Field summary for partition pruning
 * Contains min/max bounds for a partition field across all files in manifest
 */
export interface FieldSummary {
  /** Whether the partition field contains null values */
  containsNull: boolean
  /** Whether the partition field contains NaN values */
  containsNaN?: boolean
  /** Lower bound for partition values (binary-encoded) */
  lowerBound?: Uint8Array
  /** Upper bound for partition values (binary-encoded) */
  upperBound?: Uint8Array
}

/**
 * Manifest list entry - describes a manifest file
 * Field IDs from Iceberg spec Table 6
 */
export interface ManifestListEntry {
  /** 500: Location of the manifest file */
  manifestPath: string
  /** 501: Length of the manifest file in bytes */
  manifestLength: number
  /** 502: ID of partition spec used to write the manifest */
  partitionSpecId: number
  /** 517: Type of files tracked: 0=data, 1=deletes */
  content: 0 | 1
  /** 515: Sequence number when manifest was added */
  sequenceNumber: number
  /** 516: Minimum data sequence number of all live files */
  minSequenceNumber: number
  /** 503: ID of snapshot where manifest was added */
  addedSnapshotId: number
  /** 504: Count of entries with status ADDED */
  addedFilesCount: number
  /** 505: Count of entries with status EXISTING */
  existingFilesCount: number
  /** 506: Count of entries with status DELETED */
  deletedFilesCount: number
  /** 512: Row count for ADDED entries */
  addedRowsCount: number
  /** 513: Row count for EXISTING entries */
  existingRowsCount: number
  /** 514: Row count for DELETED entries */
  deletedRowsCount: number
  /** 507: Field summaries for partition pruning */
  partitions?: FieldSummary[]
  /** 519: Encryption key metadata */
  keyMetadata?: Uint8Array
}

// ============================================================================
// Manifest Entry Types (from manifest.avro)
// ============================================================================

/** Status of a manifest entry */
export type ManifestEntryStatus = 0 | 1 | 2 // 0=EXISTING, 1=ADDED, 2=DELETED

/**
 * Data file metadata within a manifest entry
 * Field IDs from Iceberg spec Table 7
 */
export interface DataFile {
  /** 134: Content type: 0=DATA, 1=POSITION_DELETES, 2=EQUALITY_DELETES */
  content: 0 | 1 | 2
  /** 100: Complete URI for the file */
  filePath: string
  /** 101: Format name: avro, orc, parquet, or puffin */
  fileFormat: 'avro' | 'orc' | 'parquet' | 'puffin'
  /** 102: Partition data tuple - values for each partition field */
  partition: Record<string, unknown>
  /** 103: Number of records in the file */
  recordCount: number
  /** 104: Total file size in bytes */
  fileSizeInBytes: number
  /** 108: Map from column ID to total size on disk */
  columnSizes?: Map<number, number>
  /** 109: Map from column ID to value count (including nulls) */
  valueCounts?: Map<number, number>
  /** 110: Map from column ID to null value count */
  nullValueCounts?: Map<number, number>
  /** 137: Map from column ID to NaN count */
  nanValueCounts?: Map<number, number>
  /** 125: Map from column ID to lower bound (binary) */
  lowerBounds?: Map<number, Uint8Array>
  /** 128: Map from column ID to upper bound (binary) */
  upperBounds?: Map<number, Uint8Array>
  /** 132: Split offsets for row groups (sorted ascending) */
  splitOffsets?: number[]
  /** 140: ID of file's sort order */
  sortOrderId?: number
}

/**
 * Manifest entry - describes a data file's lifecycle state
 * Field IDs from Iceberg spec Table 5
 */
export interface ManifestEntry {
  /** 0: Status of the file: 0=EXISTING, 1=ADDED, 2=DELETED */
  status: ManifestEntryStatus
  /** 1: Snapshot ID where file was added or deleted */
  snapshotId: number
  /** 3: Data sequence number of the file */
  sequenceNumber?: number
  /** 4: File sequence number indicating when file was added */
  fileSequenceNumber?: number
  /** 2: The data file metadata */
  dataFile: DataFile
}

// ============================================================================
// Partition Filter Types
// ============================================================================

/**
 * Partition filter for pruning manifests and data files
 * Used for fast point lookups by partition values
 */
export interface PartitionFilter {
  /** Namespace/DO identifier (e.g., 'payments.do') */
  ns?: string
  /** Resource type (e.g., 'Function', 'State', 'Event') */
  type?: string
  /** Additional partition fields */
  [key: string]: unknown
}

// ============================================================================
// Parse Functions (Stubs - to be implemented)
// ============================================================================

/**
 * Parse an Avro-encoded manifest-list file
 *
 * @param data - Raw Avro bytes from manifest-list file
 * @returns Array of manifest list entries with paths and partition summaries
 * @throws Error if parsing fails or data is invalid
 */
export function parseManifestList(data: Uint8Array): ManifestListEntry[] {
  throw new Error('parseManifestList not implemented')
}

/**
 * Parse an Avro-encoded manifest file
 *
 * @param data - Raw Avro bytes from manifest file
 * @returns Array of manifest entries with data file metadata
 * @throws Error if parsing fails or data is invalid
 */
export function parseManifestFile(data: Uint8Array): ManifestEntry[] {
  throw new Error('parseManifestFile not implemented')
}

/**
 * Filter manifest entries by partition values
 *
 * Uses partition field summaries for efficient pruning:
 * 1. Check if partition value falls within min/max bounds
 * 2. Exclude manifests that cannot contain matching files
 *
 * @param entries - Manifest list entries to filter
 * @param filter - Partition values to match
 * @param partitionSpec - Mapping of partition field names to field IDs
 * @returns Filtered entries that may contain matching data files
 */
export function filterManifestsByPartition(
  entries: ManifestListEntry[],
  filter: PartitionFilter,
  partitionSpec: Record<string, number>
): ManifestListEntry[] {
  throw new Error('filterManifestsByPartition not implemented')
}

/**
 * Filter data files by partition values
 *
 * @param entries - Manifest entries to filter
 * @param filter - Partition values to match
 * @returns Entries with matching partition values
 */
export function filterDataFilesByPartition(entries: ManifestEntry[], filter: PartitionFilter): ManifestEntry[] {
  throw new Error('filterDataFilesByPartition not implemented')
}

/**
 * Get manifest file paths from manifest list
 * Convenience function for extracting just the paths
 *
 * @param entries - Parsed manifest list entries
 * @returns Array of manifest file paths
 */
export function getManifestPaths(entries: ManifestListEntry[]): string[] {
  throw new Error('getManifestPaths not implemented')
}

/**
 * Get data file paths from manifest entries
 * Convenience function for extracting just the paths
 *
 * @param entries - Parsed manifest entries
 * @returns Array of data file paths
 */
export function getDataFilePaths(entries: ManifestEntry[]): string[] {
  throw new Error('getDataFilePaths not implemented')
}
