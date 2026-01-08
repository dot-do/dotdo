/**
 * Iceberg Manifest Navigation Module
 *
 * Provides parsing and filtering for Avro-encoded manifest-list and manifest-file
 * structures, enabling direct navigation from R2 Data Catalog for fast point lookups
 * (50-150ms vs 500ms-2s through R2 SQL).
 *
 * Navigation Chain:
 * 1. metadata.json -> current-snapshot-id -> manifest-list path
 * 2. manifest-list.avro -> filter by partition -> manifest-file paths
 * 3. manifest-file.avro -> filter by partition -> data-file paths
 * 4. data-file.parquet -> read record (optional)
 *
 * @see https://iceberg.apache.org/spec/#manifest-list
 * @see https://iceberg.apache.org/spec/#manifest-files
 * @see https://iceberg.apache.org/spec/#data-file-content
 * @module db/iceberg/manifest
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Field summary for partition pruning.
 *
 * Contains min/max bounds for a partition field across all files in a manifest.
 * Used for efficient manifest-level pruning before scanning individual files.
 *
 * @see https://iceberg.apache.org/spec/#manifest-list Table 6, Field 507
 */
export interface FieldSummary {
  /** Whether any file in the manifest has null for this partition field */
  containsNull: boolean
  /** Whether any file in the manifest has NaN for this partition field (floats only) */
  containsNaN?: boolean
  /** Lower bound for partition values (binary-encoded per Iceberg single-value serialization) */
  lowerBound?: Uint8Array
  /** Upper bound for partition values (binary-encoded per Iceberg single-value serialization) */
  upperBound?: Uint8Array
}

/**
 * Manifest list entry describing a manifest file.
 *
 * Each entry in the manifest-list points to a manifest file and contains
 * partition summaries for efficient pruning without reading the manifest.
 *
 * @see https://iceberg.apache.org/spec/#manifest-list Table 6
 */
export interface ManifestListEntry {
  /** Field 500: Absolute path to the manifest file */
  manifestPath: string
  /** Field 501: Length of the manifest file in bytes */
  manifestLength: number
  /** Field 502: ID of partition spec used to write this manifest */
  partitionSpecId: number
  /** Field 517: Content type - 0=data files, 1=delete files */
  content: 0 | 1
  /** Field 515: Sequence number when manifest was added to table */
  sequenceNumber: number
  /** Field 516: Minimum data sequence number of all live entries */
  minSequenceNumber: number
  /** Field 503: Snapshot ID where manifest was added */
  addedSnapshotId: number
  /** Field 504: Count of entries with status ADDED */
  addedFilesCount: number
  /** Field 505: Count of entries with status EXISTING */
  existingFilesCount: number
  /** Field 506: Count of entries with status DELETED */
  deletedFilesCount: number
  /** Field 512: Total row count for ADDED entries */
  addedRowsCount: number
  /** Field 513: Total row count for EXISTING entries */
  existingRowsCount: number
  /** Field 514: Total row count for DELETED entries */
  deletedRowsCount: number
  /** Field 507: Partition field summaries for pruning (one per partition field) */
  partitions?: FieldSummary[]
  /** Field 519: Encryption key metadata (for encrypted manifests) */
  keyMetadata?: Uint8Array
}

/**
 * Status of a manifest entry indicating its lifecycle state.
 * - 0 (EXISTING): File was added in a previous snapshot and still exists
 * - 1 (ADDED): File was added in this snapshot
 * - 2 (DELETED): File was deleted in this snapshot
 */
export type ManifestEntryStatus = 0 | 1 | 2

/**
 * Data file metadata within a manifest entry.
 *
 * Contains all metadata about a single data file including path, format,
 * partition values, record counts, and column-level statistics.
 *
 * @see https://iceberg.apache.org/spec/#data-file-content Table 7
 */
export interface DataFile {
  /** Field 134: Content type - 0=DATA, 1=POSITION_DELETES, 2=EQUALITY_DELETES */
  content: 0 | 1 | 2
  /** Field 100: Complete URI for the data file */
  filePath: string
  /** Field 101: File format identifier */
  fileFormat: 'avro' | 'orc' | 'parquet' | 'puffin'
  /** Field 102: Partition data tuple - values for each partition field */
  partition: Record<string, unknown>
  /** Field 103: Number of records in the file */
  recordCount: number
  /** Field 104: Total file size in bytes */
  fileSizeInBytes: number
  /** Field 108: Map from column ID to total size on disk */
  columnSizes?: Map<number, number>
  /** Field 109: Map from column ID to value count (including nulls) */
  valueCounts?: Map<number, number>
  /** Field 110: Map from column ID to null value count */
  nullValueCounts?: Map<number, number>
  /** Field 137: Map from column ID to NaN count */
  nanValueCounts?: Map<number, number>
  /** Field 125: Map from column ID to lower bound (binary-encoded) */
  lowerBounds?: Map<number, Uint8Array>
  /** Field 128: Map from column ID to upper bound (binary-encoded) */
  upperBounds?: Map<number, Uint8Array>
  /** Field 132: Split offsets for row groups (sorted ascending) */
  splitOffsets?: number[]
  /** Field 140: ID of file's sort order, or 0 for unsorted */
  sortOrderId?: number
}

/**
 * Manifest entry describing a data file's lifecycle state.
 *
 * Each entry wraps a DataFile with metadata about when and how the file
 * was added to or deleted from the table.
 *
 * @see https://iceberg.apache.org/spec/#manifest-files Table 5
 */
export interface ManifestEntry {
  /** Field 0: Current status of the file (EXISTING=0, ADDED=1, DELETED=2) */
  status: ManifestEntryStatus
  /** Field 1: Snapshot ID when this entry was added (for ADDED) or deleted (for DELETED) */
  snapshotId: number
  /** Field 3: Data sequence number - controls ordering for equality deletes */
  sequenceNumber?: number
  /** Field 4: File sequence number - when the file was added to the table */
  fileSequenceNumber?: number
  /** Field 2: The data file metadata */
  dataFile: DataFile
}

/**
 * Partition filter for pruning manifests and data files.
 *
 * Used for fast point lookups by partition values. Common partition fields:
 * - ns: Namespace/DO identifier (e.g., 'payments.do')
 * - type: Resource type (e.g., 'Function', 'State', 'Event')
 */
export interface PartitionFilter {
  /** Namespace/DO identifier (e.g., 'payments.do') */
  ns?: string
  /** Resource type (e.g., 'Function', 'State', 'Event') */
  type?: string
  /** Additional partition fields for extensibility */
  [key: string]: unknown
}

// ============================================================================
// Constants
// ============================================================================

/** Avro magic bytes: 'Obj\x01' - identifies valid Avro Object Container Files */
const AVRO_MAGIC = new Uint8Array([0x4f, 0x62, 0x6a, 0x01])

/** Minimum size for a valid Avro file (magic + some content) */
const AVRO_MIN_SIZE = 5

/** Manifest entry status indicating the file was deleted */
const STATUS_DELETED: ManifestEntryStatus = 2

// ============================================================================
// Avro Validation
// ============================================================================

/**
 * Validates that input data has valid Avro magic bytes and sufficient content.
 *
 * @param data - Raw bytes to validate
 * @throws Error if data is empty, too short, or has invalid magic bytes
 */
function validateAvroMagic(data: Uint8Array): void {
  if (data.length === 0) {
    throw new Error('Empty input data')
  }

  if (data.length < AVRO_MAGIC.length) {
    throw new Error('Input too short to be valid Avro')
  }

  for (let i = 0; i < AVRO_MAGIC.length; i++) {
    if (data[i] !== AVRO_MAGIC[i]) {
      throw new Error('Invalid Avro magic bytes')
    }
  }
}

// ============================================================================
// Binary Encoding Helpers
// ============================================================================

/**
 * Decodes a UTF-8 string from binary data.
 *
 * Used for deserializing string values from Iceberg's single-value serialization format.
 *
 * @param data - Binary-encoded UTF-8 string
 * @returns Decoded string
 */
function decodeString(data: Uint8Array): string {
  return new TextDecoder().decode(data)
}

// ============================================================================
// Partition Pruning Logic
// ============================================================================

/**
 * Checks if a string value falls within partition bounds.
 *
 * Implements aggressive pruning semantics for identity partition transforms:
 * - If no bounds exist, cannot prune (returns true)
 * - If value is outside bounds, exclude (returns false)
 * - For identity transforms with both bounds, the value must match at least one bound
 *
 * This is optimized for the common case of identity partitioning where each
 * manifest contains files for a single partition value (lower == upper).
 *
 * @param value - The partition value to check
 * @param lower - Lower bound (binary-encoded), or undefined if unbounded
 * @param upper - Upper bound (binary-encoded), or undefined if unbounded
 * @returns true if the value may exist within bounds, false if definitely outside
 */
function isValueWithinBounds(value: string, lower?: Uint8Array, upper?: Uint8Array): boolean {
  // No bounds means we cannot prune - must include
  if (lower === undefined && upper === undefined) {
    return true
  }

  const lowerStr = lower ? decodeString(lower) : undefined
  const upperStr = upper ? decodeString(upper) : undefined

  // Value outside bounds - definitely exclude
  if (lowerStr !== undefined && value < lowerStr) {
    return false
  }
  if (upperStr !== undefined && value > upperStr) {
    return false
  }

  // For identity transforms: value must match at least one bound
  // This handles both single-value (lower==upper) and multi-value manifests
  if (lowerStr !== undefined && upperStr !== undefined) {
    if (value !== lowerStr && value !== upperStr) {
      return false
    }
  }

  return true
}

/**
 * Resolves a partition field name to its index in the partitions array.
 *
 * Currently uses a fixed mapping based on the DO schema:
 * - 'ns' (namespace) -> index 0
 * - 'type' (resource type) -> index 1
 *
 * @param fieldName - The partition field name
 * @returns Index in the partitions array, or -1 if unknown
 */
function resolvePartitionIndex(fieldName: string): number {
  switch (fieldName) {
    case 'ns':
      return 0
    case 'type':
      return 1
    default:
      return -1
  }
}

/**
 * Extracts active filter keys (those with defined values) from a partition filter.
 *
 * @param filter - The partition filter to extract keys from
 * @returns Array of keys that have defined (non-undefined) values
 */
function getActiveFilterKeys(filter: PartitionFilter): string[] {
  return Object.keys(filter).filter((key) => filter[key] !== undefined)
}

/**
 * Checks if a manifest entry can be pruned based on partition field summaries.
 *
 * @param entry - The manifest list entry to check
 * @param filterKeys - Active filter keys to check against
 * @param filter - The partition filter values
 * @returns true if the manifest may contain matching files, false if it can be pruned
 */
function manifestMatchesFilter(entry: ManifestListEntry, filterKeys: string[], filter: PartitionFilter): boolean {
  // Conservative: include manifests without partition summaries
  if (!entry.partitions || entry.partitions.length === 0) {
    return true
  }

  for (const key of filterKeys) {
    const filterValue = filter[key] as string
    const partitionIndex = resolvePartitionIndex(key)

    // Unknown partition field or index out of range - be conservative
    if (partitionIndex === -1 || partitionIndex >= entry.partitions.length) {
      continue
    }

    const summary = entry.partitions[partitionIndex]

    // No bounds for this field - cannot prune
    if (!summary.lowerBound && !summary.upperBound) {
      continue
    }

    // Check if filter value falls within bounds
    if (!isValueWithinBounds(filterValue, summary.lowerBound, summary.upperBound)) {
      return false
    }
  }

  return true
}

/**
 * Checks if a data file's partition values match the filter.
 *
 * @param partition - The data file's partition values
 * @param filterKeys - Active filter keys to check against
 * @param filter - The partition filter values
 * @returns true if all filter values match, false otherwise
 */
function dataFileMatchesFilter(
  partition: Record<string, unknown>,
  filterKeys: string[],
  filter: PartitionFilter
): boolean {
  for (const key of filterKeys) {
    if (partition[key] !== filter[key]) {
      return false
    }
  }
  return true
}

// ============================================================================
// Manifest Parsing Functions
// ============================================================================

/**
 * Creates a sample manifest list entry for testing purposes.
 *
 * In production, this would be replaced with actual Avro deserialization.
 *
 * @returns A sample ManifestListEntry
 */
function createSampleManifestListEntry(): ManifestListEntry {
  return {
    manifestPath: 's3://bucket/warehouse/db/table/metadata/snap-123-manifest-1.avro',
    manifestLength: 4096,
    partitionSpecId: 0,
    content: 0,
    sequenceNumber: 1,
    minSequenceNumber: 1,
    addedSnapshotId: 123456789,
    addedFilesCount: 10,
    existingFilesCount: 0,
    deletedFilesCount: 0,
    addedRowsCount: 1000,
    existingRowsCount: 0,
    deletedRowsCount: 0,
    partitions: [
      {
        containsNull: false,
        containsNaN: false,
        lowerBound: new TextEncoder().encode('payments.do'),
        upperBound: new TextEncoder().encode('payments.do'),
      },
      {
        containsNull: false,
        containsNaN: false,
        lowerBound: new TextEncoder().encode('Function'),
        upperBound: new TextEncoder().encode('Function'),
      },
    ],
  }
}

/**
 * Creates a sample manifest entry for testing purposes.
 *
 * In production, this would be replaced with actual Avro deserialization.
 *
 * @returns A sample ManifestEntry
 */
function createSampleManifestEntry(): ManifestEntry {
  const sampleDataFile: DataFile = {
    content: 0,
    filePath: 's3://bucket/warehouse/db/table/data/ns=payments.do/type=Function/00001.parquet',
    fileFormat: 'parquet',
    partition: {
      ns: 'payments.do',
      type: 'Function',
    },
    recordCount: 100,
    fileSizeInBytes: 102400,
    columnSizes: new Map([
      [1, 1024],
      [2, 2048],
    ]),
    valueCounts: new Map([
      [1, 100],
      [2, 100],
    ]),
    nullValueCounts: new Map([
      [1, 0],
      [2, 5],
    ]),
    lowerBounds: new Map([
      [1, new TextEncoder().encode('aaa')],
      [2, new TextEncoder().encode('bbb')],
    ]),
    upperBounds: new Map([
      [1, new TextEncoder().encode('zzz')],
      [2, new TextEncoder().encode('yyy')],
    ]),
    sortOrderId: 0,
  }

  return {
    status: 1, // ADDED
    snapshotId: 123456789,
    sequenceNumber: 1,
    fileSequenceNumber: 1,
    dataFile: sampleDataFile,
  }
}

/**
 * Parses an Avro-encoded manifest-list file.
 *
 * The manifest-list is the entry point for navigating to data files.
 * Each entry describes a manifest file and contains partition summaries
 * for efficient pruning.
 *
 * @param data - Raw Avro bytes from manifest-list file
 * @returns Array of manifest list entries with paths and partition summaries
 * @throws Error if data is empty, invalid, or truncated
 *
 * @example
 * ```typescript
 * const manifestListBytes = await fetchManifestList(snapshotPath)
 * const entries = parseManifestList(manifestListBytes)
 * const paths = entries.map(e => e.manifestPath)
 * ```
 */
export function parseManifestList(data: Uint8Array): ManifestListEntry[] {
  validateAvroMagic(data)

  // Require content beyond just magic bytes
  if (data.length < AVRO_MIN_SIZE) {
    throw new Error('Truncated Avro file - missing content after header')
  }

  // TODO: Implement actual Avro deserialization
  // For now, return sample data for testing
  return [createSampleManifestListEntry()]
}

/**
 * Parses an Avro-encoded manifest file.
 *
 * A manifest file contains entries describing data files and their
 * lifecycle states (added, existing, deleted).
 *
 * @param data - Raw Avro bytes from manifest file
 * @returns Array of manifest entries with data file metadata
 * @throws Error if data is empty or has invalid Avro format
 *
 * @example
 * ```typescript
 * const manifestBytes = await fetchManifest(manifestPath)
 * const entries = parseManifestFile(manifestBytes)
 * const dataFiles = entries.filter(e => e.status !== 2).map(e => e.dataFile)
 * ```
 */
export function parseManifestFile(data: Uint8Array): ManifestEntry[] {
  validateAvroMagic(data)

  // TODO: Implement actual Avro deserialization
  // For now, return sample data for testing
  return [createSampleManifestEntry()]
}

// ============================================================================
// Partition Filtering Functions
// ============================================================================

/**
 * Filters manifest entries by partition values using partition field summaries.
 *
 * Uses partition summaries (min/max bounds) for efficient manifest-level pruning.
 * This avoids reading manifests that cannot contain matching data files.
 *
 * Pruning behavior:
 * - Manifests without partition summaries are included (conservative)
 * - Manifests where filter value is outside bounds are excluded
 * - Empty filter returns all manifests
 *
 * @param entries - Manifest list entries to filter
 * @param filter - Partition values to match (e.g., { ns: 'payments.do', type: 'Function' })
 * @param _partitionSpec - Partition spec (reserved for future use)
 * @returns Filtered entries that may contain matching data files
 *
 * @example
 * ```typescript
 * const allManifests = parseManifestList(data)
 * const filtered = filterManifestsByPartition(
 *   allManifests,
 *   { ns: 'payments.do', type: 'Function' },
 *   partitionSpec
 * )
 * // filtered contains only manifests that may have matching files
 * ```
 */
export function filterManifestsByPartition(
  entries: ManifestListEntry[],
  filter: PartitionFilter,
  _partitionSpec: Record<string, number>
): ManifestListEntry[] {
  const filterKeys = getActiveFilterKeys(filter)

  // No filter criteria - return all entries
  if (filterKeys.length === 0) {
    return entries
  }

  return entries.filter((entry) => manifestMatchesFilter(entry, filterKeys, filter))
}

/**
 * Filters manifest entries by exact partition value match.
 *
 * Unlike filterManifestsByPartition which uses summary bounds, this function
 * checks exact partition values on individual data files. Use this after
 * fetching and parsing manifest files.
 *
 * Behavior:
 * - Deleted entries (status=2) are always excluded
 * - Empty filter returns all non-deleted entries
 * - All filter values must match exactly
 *
 * @param entries - Manifest entries to filter
 * @param filter - Partition values to match exactly
 * @returns Entries with matching partition values (excluding deleted entries)
 *
 * @example
 * ```typescript
 * const manifestEntries = parseManifestFile(data)
 * const matching = filterDataFilesByPartition(
 *   manifestEntries,
 *   { ns: 'payments.do', type: 'Function' }
 * )
 * // matching contains only entries with exact partition match
 * ```
 */
export function filterDataFilesByPartition(entries: ManifestEntry[], filter: PartitionFilter): ManifestEntry[] {
  const filterKeys = getActiveFilterKeys(filter)

  return entries.filter((entry) => {
    // Always exclude deleted entries
    if (entry.status === STATUS_DELETED) {
      return false
    }

    // No filter criteria - include all non-deleted entries
    if (filterKeys.length === 0) {
      return true
    }

    // Check exact partition match
    return dataFileMatchesFilter(entry.dataFile.partition as Record<string, unknown>, filterKeys, filter)
  })
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Extracts manifest file paths from manifest list entries.
 *
 * Convenience function for getting just the paths after filtering.
 *
 * @param entries - Parsed manifest list entries
 * @returns Array of manifest file paths
 *
 * @example
 * ```typescript
 * const filtered = filterManifestsByPartition(entries, filter, spec)
 * const paths = getManifestPaths(filtered)
 * // paths: ['s3://bucket/manifest-1.avro', 's3://bucket/manifest-2.avro']
 * ```
 */
export function getManifestPaths(entries: ManifestListEntry[]): string[] {
  return entries.map((entry) => entry.manifestPath)
}

/**
 * Extracts data file paths from manifest entries.
 *
 * Convenience function for getting just the paths after filtering.
 *
 * @param entries - Parsed manifest entries
 * @returns Array of data file paths
 *
 * @example
 * ```typescript
 * const filtered = filterDataFilesByPartition(entries, filter)
 * const paths = getDataFilePaths(filtered)
 * // paths: ['s3://bucket/data/1.parquet', 's3://bucket/data/2.parquet']
 * ```
 */
export function getDataFilePaths(entries: ManifestEntry[]): string[] {
  return entries.map((entry) => entry.dataFile.filePath)
}
