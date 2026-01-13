/**
 * Iceberg Column Statistics
 *
 * Extracts and filters using column statistics from Iceberg manifest entries.
 * Column statistics (lower_bound, upper_bound, null_count) enable efficient
 * file pruning without reading Parquet data.
 *
 * Key concepts:
 * - Each manifest entry contains column stats for its data file
 * - lower_bound/upper_bound are binary-encoded column min/max values
 * - Used for predicate pushdown (e.g., "which files might contain id='charge'?")
 *
 * @see https://iceberg.apache.org/spec/#manifests
 */

// ============================================================================
// Constants
// ============================================================================

/** Manifest entry status codes as defined in the Iceberg spec */
export const ENTRY_STATUS = {
  /** Entry references an existing data file */
  EXISTING: 0,
  /** Entry was added in this snapshot */
  ADDED: 1,
  /** Entry was deleted in this snapshot */
  DELETED: 2,
} as const

// ============================================================================
// Types
// ============================================================================

/** Supported column types for value encoding/decoding */
export type ColumnType = 'string' | 'int' | 'long' | 'boolean' | 'binary'

/** Primitive value types supported for column statistics */
export type PrimitiveValue = string | number | bigint | boolean | Uint8Array

/**
 * Column statistics from a manifest entry
 */
export interface ColumnStats {
  /** Column field ID from Iceberg schema */
  fieldId: number
  /** Minimum value in the column (binary encoded) */
  lowerBound: Uint8Array | null
  /** Maximum value in the column (binary encoded) */
  upperBound: Uint8Array | null
  /** Count of null values */
  nullCount: bigint | null
  /** Count of NaN values (floats only) */
  nanCount: bigint | null
  /** Total value count (non-null) */
  valueCount: bigint | null
}

/**
 * Parsed manifest entry with column statistics
 */
export interface ManifestEntry {
  /** Status: 0=existing, 1=added, 2=deleted */
  status: number
  /** Snapshot ID when this entry was added */
  snapshotId: bigint
  /** Sequence number */
  sequenceNumber: bigint
  /** Data file path in storage */
  dataFile: {
    /** Full file path (e.g., s3://bucket/path/to/file.parquet) */
    filePath: string
    /** File format (PARQUET, AVRO, ORC) */
    fileFormat: 'PARQUET' | 'AVRO' | 'ORC'
    /** Number of records in file */
    recordCount: bigint
    /** File size in bytes */
    fileSizeBytes: bigint
    /** Column sizes map (field_id -> size) */
    columnSizes: Map<number, bigint> | null
    /** Value counts map (field_id -> count) */
    valueCounts: Map<number, bigint> | null
    /** Null value counts map (field_id -> count) */
    nullValueCounts: Map<number, bigint> | null
    /** NaN value counts map (field_id -> count) */
    nanValueCounts: Map<number, bigint> | null
    /** Lower bounds map (field_id -> binary value) */
    lowerBounds: Map<number, Uint8Array> | null
    /** Upper bounds map (field_id -> binary value) */
    upperBounds: Map<number, Uint8Array> | null
    /** Partition data */
    partition: Record<string, unknown>
  }
}

/**
 * Options for file selection based on column statistics
 */
export interface FileSelectionOptions {
  /** Column field ID to filter on */
  fieldId: number
  /** Value to look up (will be encoded appropriately) */
  value: PrimitiveValue
  /** Column type for encoding */
  columnType: ColumnType
}

/**
 * Result of file selection
 */
export interface FileSelectionResult {
  /** File path that may contain the value */
  filePath: string
  /** Whether file definitely contains the value (vs. might contain) */
  definite: boolean
  /** Lower bound for the column (decoded) */
  lowerBound: PrimitiveValue | null
  /** Upper bound for the column (decoded) */
  upperBound: PrimitiveValue | null
}

// ============================================================================
// Column Stats Extraction
// ============================================================================

/**
 * Extract column statistics from a manifest entry for a specific field
 *
 * @param entry - The manifest entry containing data file info
 * @param fieldId - The Iceberg field ID to get stats for
 * @returns Column statistics or null if not available
 */
export function extractColumnStats(entry: ManifestEntry, fieldId: number): ColumnStats | null {
  const { dataFile } = entry
  const lowerBound = dataFile.lowerBounds?.get(fieldId) ?? null
  const upperBound = dataFile.upperBounds?.get(fieldId) ?? null
  const nullCount = dataFile.nullValueCounts?.get(fieldId) ?? null
  const nanCount = dataFile.nanValueCounts?.get(fieldId) ?? null
  const valueCount = dataFile.valueCounts?.get(fieldId) ?? null

  // Return null if no statistics available for this field
  if (lowerBound === null && upperBound === null && nullCount === null && valueCount === null) {
    return null
  }

  return {
    fieldId,
    lowerBound,
    upperBound,
    nullCount,
    nanCount,
    valueCount,
  }
}

/**
 * Extract all column statistics from a manifest entry
 *
 * @param entry - The manifest entry containing data file info
 * @returns Map of field ID to column statistics
 */
export function extractAllColumnStats(entry: ManifestEntry): Map<number, ColumnStats> {
  const result = new Map<number, ColumnStats>()
  const { dataFile } = entry

  // Collect all field IDs from all statistics maps
  const fieldIds = new Set<number>()
  dataFile.lowerBounds?.forEach((_, id) => fieldIds.add(id))
  dataFile.upperBounds?.forEach((_, id) => fieldIds.add(id))
  dataFile.nullValueCounts?.forEach((_, id) => fieldIds.add(id))
  dataFile.valueCounts?.forEach((_, id) => fieldIds.add(id))
  dataFile.nanValueCounts?.forEach((_, id) => fieldIds.add(id))

  // Extract stats for each field
  for (const fieldId of fieldIds) {
    const stats = extractColumnStats(entry, fieldId)
    if (stats !== null) {
      result.set(fieldId, stats)
    }
  }

  return result
}

// ============================================================================
// Value Encoding/Decoding
// ============================================================================

/**
 * Encode a value to binary format for comparison with column bounds.
 * Uses Iceberg's single-value serialization format (little-endian for numeric types).
 *
 * @param value - The value to encode
 * @param type - The column type determining the encoding strategy
 * @returns Binary encoded value as Uint8Array
 *
 * @example
 * ```ts
 * encodeValue('hello', 'string')  // UTF-8 bytes
 * encodeValue(42, 'int')          // 4-byte little-endian
 * encodeValue(BigInt(1000), 'long') // 8-byte little-endian
 * encodeValue(true, 'boolean')    // Single byte [1]
 * ```
 */
export function encodeValue(value: PrimitiveValue, type: ColumnType): Uint8Array {
  switch (type) {
    case 'string':
      return new TextEncoder().encode(value as string)
    case 'int': {
      const buffer = new ArrayBuffer(4)
      new DataView(buffer).setInt32(0, value as number, true) // little-endian
      return new Uint8Array(buffer)
    }
    case 'long': {
      const buffer = new ArrayBuffer(8)
      new DataView(buffer).setBigInt64(0, value as bigint, true) // little-endian
      return new Uint8Array(buffer)
    }
    case 'boolean':
      return new Uint8Array([value ? 1 : 0])
    case 'binary':
      // Binary values are already Uint8Array or can be passed through
      if (value !== null && typeof value === 'object' && value instanceof Uint8Array) {
        return value
      }
      return new TextEncoder().encode(String(value))
  }
}

/**
 * Decode a binary value from column bounds to its typed value.
 * Reverses the encoding performed by {@link encodeValue}.
 *
 * @param bytes - The binary encoded value from Iceberg column bounds
 * @param type - The column type determining the decoding strategy
 * @returns Decoded value in its native TypeScript type
 *
 * @example
 * ```ts
 * decodeValue(new Uint8Array([104, 101, 108, 108, 111]), 'string')  // 'hello'
 * decodeValue(new Uint8Array([42, 0, 0, 0]), 'int')  // 42
 * ```
 */
export function decodeValue(bytes: Uint8Array, type: ColumnType): PrimitiveValue {
  switch (type) {
    case 'string':
      return new TextDecoder().decode(bytes)
    case 'int':
      return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(0, true)
    case 'long':
      return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(0, true)
    case 'boolean':
      return bytes[0] === 1
    case 'binary':
      return new TextDecoder().decode(bytes)
  }
}

// ============================================================================
// Range Filtering
// ============================================================================

/**
 * Check if a value falls within the column bounds
 * Uses binary comparison for efficiency
 *
 * @param value - The value to check (already encoded)
 * @param lowerBound - Lower bound (binary)
 * @param upperBound - Upper bound (binary)
 * @returns true if value might be in range, false if definitely not
 */
export function isInRange(value: Uint8Array, lowerBound: Uint8Array | null, upperBound: Uint8Array | null): boolean {
  // If lower bound exists, value must be >= lower bound
  if (lowerBound !== null && compareBinary(value, lowerBound) < 0) {
    return false
  }
  // If upper bound exists, value must be <= upper bound
  if (upperBound !== null && compareBinary(value, upperBound) > 0) {
    return false
  }
  return true
}

/**
 * Compare two binary-encoded values
 *
 * @param a - First value
 * @param b - Second value
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareBinary(a: Uint8Array, b: Uint8Array): -1 | 0 | 1 {
  const minLen = Math.min(a.length, b.length)
  for (let i = 0; i < minLen; i++) {
    if (a[i]! < b[i]!) return -1
    if (a[i]! > b[i]!) return 1
  }
  // If all bytes are equal up to minLen, shorter array is "less"
  if (a.length < b.length) return -1
  if (a.length > b.length) return 1
  return 0
}

/**
 * Filter manifest entries by id range
 * Returns entries whose id column bounds overlap with the target value
 *
 * @param entries - Manifest entries to filter
 * @param idFieldId - The field ID of the 'id' column
 * @param targetId - The id value to look up
 * @returns Filtered entries that might contain the id
 */
export function filterByIdRange(entries: ManifestEntry[], idFieldId: number, targetId: string): ManifestEntry[] {
  const encodedTarget = encodeValue(targetId, 'string')

  return entries.filter((entry) => {
    // Exclude deleted entries
    if (entry.status === ENTRY_STATUS.DELETED) {
      return false
    }

    const { dataFile } = entry
    const lowerBound = dataFile.lowerBounds?.get(idFieldId) ?? null
    const upperBound = dataFile.upperBounds?.get(idFieldId) ?? null

    // If no statistics, include conservatively (might contain the value)
    if (lowerBound === null && upperBound === null) {
      return true
    }

    return isInRange(encodedTarget, lowerBound, upperBound)
  })
}

// ============================================================================
// File Selection
// ============================================================================

/**
 * Select files that may contain a specific value
 * Uses column statistics to prune files that definitely don't contain the value
 *
 * @param entries - All manifest entries
 * @param options - Selection options (field, value, type)
 * @returns List of files that may contain the value
 */
export function selectFilesForValue(entries: ManifestEntry[], options: FileSelectionOptions): FileSelectionResult[] {
  const { fieldId, value, columnType } = options
  const results: FileSelectionResult[] = []

  for (const entry of entries) {
    // Skip deleted entries
    if (entry.status === ENTRY_STATUS.DELETED) {
      continue
    }

    const { dataFile } = entry
    const lowerBoundBytes = dataFile.lowerBounds?.get(fieldId) ?? null
    const upperBoundBytes = dataFile.upperBounds?.get(fieldId) ?? null

    // Decode bounds for typed comparison
    const lower = lowerBoundBytes ? decodeValue(lowerBoundBytes, columnType) : null
    const upper = upperBoundBytes ? decodeValue(upperBoundBytes, columnType) : null

    // Check if value is in range using typed comparison
    if (!isValueInRange(value, lower, upper)) {
      continue
    }

    // Determine if the match is definite (value equals both bounds)
    // This means the file contains only this one value for this column
    const definite = lower !== null && upper !== null && value === lower && value === upper

    results.push({
      filePath: dataFile.filePath,
      definite,
      lowerBound: lower,
      upperBound: upper,
    })
  }

  return results
}

/**
 * Check if a typed value falls within the given bounds.
 * Used by {@link selectFilesForValue} for type-aware comparisons.
 *
 * Handles different comparison semantics:
 * - Numeric types (int, long): Mathematical comparison
 * - Strings: Lexicographic comparison
 * - Booleans: false < true ordering
 *
 * @param value - The value to check
 * @param lower - Lower bound (null = unbounded below)
 * @param upper - Upper bound (null = unbounded above)
 * @returns true if value is within bounds (inclusive), false otherwise
 *
 * @internal
 */
function isValueInRange(
  value: PrimitiveValue,
  lower: PrimitiveValue | null,
  upper: PrimitiveValue | null
): boolean {
  // If both bounds are null, always in range
  if (lower === null && upper === null) {
    return true
  }

  // For numeric types, compare numerically
  if (typeof value === 'number' || typeof value === 'bigint') {
    if (lower !== null && value < (lower as number | bigint)) {
      return false
    }
    if (upper !== null && value > (upper as number | bigint)) {
      return false
    }
    return true
  }

  // For strings, compare lexicographically
  if (typeof value === 'string') {
    if (lower !== null && value < (lower as string)) {
      return false
    }
    if (upper !== null && value > (upper as string)) {
      return false
    }
    return true
  }

  // For booleans, compare directly
  if (typeof value === 'boolean') {
    // Boolean range: false(0) <= x <= true(1)
    if (lower !== null && !value && (lower as boolean)) {
      return false // value is false, lower is true
    }
    if (upper !== null && value && !(upper as boolean)) {
      return false // value is true, upper is false
    }
    return true
  }

  return true
}

/**
 * Find the single file most likely to contain a specific id
 * Uses statistics to narrow down to one file when possible
 *
 * @param entries - All manifest entries
 * @param idFieldId - The field ID of the 'id' column
 * @param targetId - The id value to look up
 * @returns The file most likely to contain the id, or null if none
 */
export function findFileForId(entries: ManifestEntry[], idFieldId: number, targetId: string): FileSelectionResult | null {
  const candidates = selectFilesForValue(entries, {
    fieldId: idFieldId,
    value: targetId,
    columnType: 'string',
  })

  if (candidates.length === 0) {
    return null
  }

  // If only one candidate, return it
  if (candidates.length === 1) {
    return candidates[0] ?? null
  }

  // Prefer files with narrower ranges - more likely to contain the target
  let best = candidates[0]!
  let bestRangeSize = computeStringRangeSize(best.lowerBound as string | null, best.upperBound as string | null)

  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i]!
    const rangeSize = computeStringRangeSize(candidate.lowerBound as string | null, candidate.upperBound as string | null)
    if (rangeSize < bestRangeSize) {
      best = candidate
      bestRangeSize = rangeSize
    }
  }

  return best ?? null
}

/**
 * Compute a rough estimate of the range size for string bounds.
 * Used by {@link findFileForId} to prefer files with narrower ranges.
 *
 * The algorithm computes a byte-weighted distance where early bytes
 * have more weight than later bytes (base-256 positional weighting).
 *
 * @param lower - Lower bound string (null = unbounded)
 * @param upper - Upper bound string (null = unbounded)
 * @returns Estimated range size (Infinity for unbounded ranges)
 *
 * @internal
 */
function computeStringRangeSize(lower: string | null, upper: string | null): number {
  if (lower === null || upper === null) {
    return Infinity // Unbounded = largest
  }
  // Use length difference as a simple heuristic for string range size
  // A more precise approach would compare byte-by-byte
  const lowerBytes = new TextEncoder().encode(lower)
  const upperBytes = new TextEncoder().encode(upper)

  // Compute a simple distance based on byte values
  let distance = 0
  const maxLen = Math.max(lowerBytes.length, upperBytes.length)
  for (let i = 0; i < maxLen; i++) {
    const lb = lowerBytes[i] ?? 0
    const ub = upperBytes[i] ?? 0
    distance = distance * 256 + (ub - lb)
    if (distance > 1e15) break // Avoid overflow, we just need relative comparison
  }
  return distance
}

// ============================================================================
// Statistics Helpers
// ============================================================================

/**
 * Check if a file has any statistics available
 *
 * @param entry - Manifest entry to check
 * @returns true if the entry has column statistics
 */
export function hasStatistics(entry: ManifestEntry): boolean {
  const { dataFile } = entry
  return (
    (dataFile.lowerBounds !== null && dataFile.lowerBounds.size > 0) ||
    (dataFile.upperBounds !== null && dataFile.upperBounds.size > 0) ||
    (dataFile.nullValueCounts !== null && dataFile.nullValueCounts.size > 0) ||
    (dataFile.valueCounts !== null && dataFile.valueCounts.size > 0)
  )
}

/**
 * Get the null count for a column in a file
 *
 * @param entry - Manifest entry
 * @param fieldId - Column field ID
 * @returns Null count or null if not available
 */
export function getNullCount(entry: ManifestEntry, fieldId: number): bigint | null {
  return entry.dataFile.nullValueCounts?.get(fieldId) ?? null
}

/**
 * Check if a column has any non-null values in a file
 *
 * @param entry - Manifest entry
 * @param fieldId - Column field ID
 * @returns true if the column has at least one non-null value
 */
export function hasNonNullValues(entry: ManifestEntry, fieldId: number): boolean {
  const { dataFile } = entry

  // If bounds exist, there must be non-null values
  if (dataFile.lowerBounds?.has(fieldId) || dataFile.upperBounds?.has(fieldId)) {
    return true
  }

  const valueCount = dataFile.valueCounts?.get(fieldId)
  const nullCount = dataFile.nullValueCounts?.get(fieldId)

  // If we have both counts, check if value count > 0
  if (valueCount !== undefined && valueCount > 0) {
    return true
  }

  // If we only have null count and it's >= 0, but no value count, we can't determine
  // If stats are missing, assume conservatively there might be non-null values
  if (valueCount === undefined && nullCount === undefined) {
    return true
  }

  // value count is 0 and null count exists
  return false
}
