/**
 * DiffEngine - Calculate added, modified, deleted records for sync operations
 *
 * Implements diff calculations between source and destination datasets:
 * - Full diff: Compare all records, identify adds/modifies/deletes
 * - Incremental diff: Only compare records modified since last sync
 *
 * Supports:
 * - Single and composite primary keys
 * - Field-level comparison with ignore/include options
 * - Nested object deep comparison
 * - Timestamp-based incremental filtering
 *
 * Part of the SyncEngine primitive (dotdo-cjahp)
 * Issue: dotdo-6xxid
 *
 * @module db/primitives/connector-framework/diff-engine
 */

// =============================================================================
// Types
// =============================================================================

/**
 * A record to be diffed - can be any object with key-value pairs
 */
export type DiffRecord = Record<string, unknown>

/**
 * Statistics about the diff operation
 */
export interface DiffStats {
  /** Number of records in source */
  sourceCount: number
  /** Number of records in destination */
  destinationCount: number
  /** Number of added records */
  addedCount: number
  /** Number of modified records */
  modifiedCount: number
  /** Number of deleted records */
  deletedCount: number
  /** Number of unchanged records */
  unchangedCount: number
}

/**
 * Result of a diff operation
 */
export interface DiffResult {
  /** Records present in source but not in destination */
  added: DiffRecord[]
  /** Records present in both but with different field values */
  modified: DiffRecord[]
  /** Records present in destination but not in source */
  deleted: DiffRecord[]
  /** Count of unchanged records */
  unchanged: number
  /** Detailed statistics */
  stats: DiffStats
}

/**
 * Configuration options for DiffEngine
 */
export interface DiffOptions {
  /**
   * Primary key field(s) used to match records between source and destination.
   * Can be a single field name or array of field names for composite keys.
   */
  primaryKey: string | string[]

  /**
   * Optional timestamp field for incremental sync filtering.
   * Used by diffIncremental to filter records modified after last sync.
   */
  timestampField?: string

  /**
   * Fields to ignore when comparing records for modifications.
   * These fields won't trigger a modification even if they differ.
   */
  ignoreFields?: string[]

  /**
   * If specified, only these fields are compared for modifications.
   * Takes precedence over ignoreFields.
   */
  compareFields?: string[]
}

/**
 * DiffEngine interface
 */
export interface DiffEngine {
  /**
   * Perform a full diff between source and destination
   * @param source - Array of source records
   * @param destination - Array of destination records
   * @returns Diff result with added, modified, deleted records
   */
  diff(source: DiffRecord[], destination: DiffRecord[]): DiffResult

  /**
   * Perform an incremental diff, only considering source records modified after lastSync
   * @param source - Array of source records (will be filtered by timestamp)
   * @param destination - Array of destination records
   * @param lastSync - Date of last sync - only records after this are considered
   * @returns Diff result for incremental changes (deletions are not tracked)
   */
  diffIncremental(source: DiffRecord[], destination: DiffRecord[], lastSync: Date): DiffResult
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Generate a composite key string from a record
 */
function generateKey(record: DiffRecord, primaryKeyFields: string[]): string {
  return primaryKeyFields.map((field) => String(record[field] ?? '')).join('|')
}

/**
 * Deep equality check for two values
 */
function deepEqual(a: unknown, b: unknown): boolean {
  // Handle primitives and null/undefined
  if (a === b) return true
  if (a === null || b === null) return false
  if (a === undefined || b === undefined) return false

  // Handle different types
  const typeA = typeof a
  const typeB = typeof b
  if (typeA !== typeB) return false

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }

  // Handle objects
  if (typeA === 'object' && a !== null && b !== null) {
    // Handle Date objects
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime()
    }

    const objA = a as Record<string, unknown>
    const objB = b as Record<string, unknown>
    const keysA = Object.keys(objA)
    const keysB = Object.keys(objB)

    if (keysA.length !== keysB.length) return false

    for (const key of keysA) {
      if (!keysB.includes(key)) return false
      if (!deepEqual(objA[key], objB[key])) return false
    }
    return true
  }

  return false
}

/**
 * Check if two records are equal for the purpose of modification detection
 */
function recordsEqual(
  source: DiffRecord,
  destination: DiffRecord,
  options: DiffOptions,
  primaryKeyFields: string[],
): boolean {
  // Determine which fields to compare
  let fieldsToCompare: string[]

  if (options.compareFields) {
    // Only compare specified fields
    fieldsToCompare = options.compareFields
  } else {
    // Compare all fields, potentially ignoring some
    const allFields = new Set([...Object.keys(source), ...Object.keys(destination)])
    // Remove primary key fields from comparison (they're already matched)
    primaryKeyFields.forEach((f) => allFields.delete(f))
    // Remove ignored fields
    if (options.ignoreFields) {
      options.ignoreFields.forEach((f) => allFields.delete(f))
    }
    fieldsToCompare = Array.from(allFields)
  }

  // Compare each field
  for (const field of fieldsToCompare) {
    if (!deepEqual(source[field], destination[field])) {
      return false
    }
  }

  return true
}

/**
 * Parse a timestamp value from various formats
 */
function parseTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null
  }

  if (value instanceof Date) {
    return value
  }

  if (typeof value === 'number') {
    return new Date(value)
  }

  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!isNaN(parsed.getTime())) {
      return parsed
    }
  }

  return null
}

/**
 * Create a DiffEngine instance
 */
export function createDiffEngine(options: DiffOptions): DiffEngine {
  // Normalize primaryKey to array
  const primaryKeyFields = Array.isArray(options.primaryKey)
    ? options.primaryKey
    : [options.primaryKey]

  return {
    diff(source: DiffRecord[], destination: DiffRecord[]): DiffResult {
      const added: DiffRecord[] = []
      const modified: DiffRecord[] = []
      const deleted: DiffRecord[] = []
      let unchanged = 0

      // Build lookup map for destination records
      const destinationMap = new Map<string, DiffRecord>()
      for (const record of destination) {
        const key = generateKey(record, primaryKeyFields)
        destinationMap.set(key, record)
      }

      // Track which destination keys we've seen
      const seenDestKeys = new Set<string>()

      // Process source records
      for (const sourceRecord of source) {
        const key = generateKey(sourceRecord, primaryKeyFields)
        const destRecord = destinationMap.get(key)

        if (!destRecord) {
          // Record exists in source but not in destination -> added
          added.push(sourceRecord)
        } else {
          seenDestKeys.add(key)
          // Record exists in both -> check for modifications
          if (recordsEqual(sourceRecord, destRecord, options, primaryKeyFields)) {
            unchanged++
          } else {
            modified.push(sourceRecord)
          }
        }
      }

      // Find deleted records (in destination but not in source)
      for (const destRecord of destination) {
        const key = generateKey(destRecord, primaryKeyFields)
        if (!seenDestKeys.has(key) && !added.some((r) => generateKey(r, primaryKeyFields) === key)) {
          // Check if we actually processed this key from source
          const wasInSource = source.some((s) => generateKey(s, primaryKeyFields) === key)
          if (!wasInSource) {
            deleted.push(destRecord)
          }
        }
      }

      return {
        added,
        modified,
        deleted,
        unchanged,
        stats: {
          sourceCount: source.length,
          destinationCount: destination.length,
          addedCount: added.length,
          modifiedCount: modified.length,
          deletedCount: deleted.length,
          unchangedCount: unchanged,
        },
      }
    },

    diffIncremental(
      source: DiffRecord[],
      destination: DiffRecord[],
      lastSync: Date,
    ): DiffResult {
      const timestampField = options.timestampField

      if (!timestampField) {
        // No timestamp field configured - fall back to full diff but skip deletions
        const fullResult = this.diff(source, destination)
        return {
          ...fullResult,
          deleted: [], // Incremental mode doesn't track deletions
          stats: {
            ...fullResult.stats,
            deletedCount: 0,
          },
        }
      }

      // Filter source to only include records modified after lastSync
      const filteredSource = source.filter((record) => {
        const timestamp = parseTimestamp(record[timestampField])
        if (!timestamp) {
          // Skip records without valid timestamp
          return false
        }
        return timestamp > lastSync
      })

      // Build destination lookup
      const destinationMap = new Map<string, DiffRecord>()
      for (const record of destination) {
        const key = generateKey(record, primaryKeyFields)
        destinationMap.set(key, record)
      }

      const added: DiffRecord[] = []
      const modified: DiffRecord[] = []
      let unchanged = 0

      // Process filtered source records
      for (const sourceRecord of filteredSource) {
        const key = generateKey(sourceRecord, primaryKeyFields)
        const destRecord = destinationMap.get(key)

        if (!destRecord) {
          added.push(sourceRecord)
        } else {
          if (recordsEqual(sourceRecord, destRecord, options, primaryKeyFields)) {
            unchanged++
          } else {
            modified.push(sourceRecord)
          }
        }
      }

      return {
        added,
        modified,
        deleted: [], // Incremental mode doesn't track deletions
        unchanged,
        stats: {
          sourceCount: filteredSource.length,
          destinationCount: destination.length,
          addedCount: added.length,
          modifiedCount: modified.length,
          deletedCount: 0,
          unchangedCount: unchanged,
        },
      }
    },
  }
}

// =============================================================================
// Convenience Exports
// =============================================================================

export { DiffEngine }
