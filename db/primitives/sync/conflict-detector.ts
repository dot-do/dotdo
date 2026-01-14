/**
 * ConflictDetector - Conflict detection for bidirectional sync
 *
 * This module provides conflict detection capabilities for bidirectional
 * synchronization scenarios. It identifies when records have been modified
 * in both source and destination systems since the last sync.
 *
 * ## Overview
 *
 * In bidirectional sync, conflicts occur when:
 * - The same record is modified in both systems
 * - A record is modified in one system and deleted in another
 * - The same record is added in both systems with different data
 *
 * ## Usage Example
 *
 * ```typescript
 * import { ConflictDetector } from './conflict-detector'
 *
 * const detector = new ConflictDetector({
 *   defaultStrategy: 'last-write-wins'
 * })
 *
 * const conflicts = detector.detect(sourceChanges, destChanges)
 *
 * for (const conflict of conflicts) {
 *   console.log(`Conflict on ${conflict.key}:`)
 *   console.log(`  Fields: ${conflict.conflictingFields.join(', ')}`)
 *   console.log(`  Suggestion: ${conflict.suggestedResolution}`)
 * }
 * ```
 *
 * @module db/primitives/sync/conflict-detector
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * A record in the diff result with its key, data, and modification timestamp
 */
export interface DiffRecord {
  /** Unique identifier for the record */
  key: string
  /** Record data as key-value pairs */
  data: Record<string, unknown>
  /** When the record was last modified */
  modifiedAt: Date
}

/**
 * Result of a diff operation between sync states
 */
export interface DiffResult {
  /** Records that were added since the last sync */
  added: DiffRecord[]
  /** Records that were modified since the last sync */
  modified: DiffRecord[]
  /** Keys of records that were deleted since the last sync */
  deleted: string[]
}

/**
 * Resolution strategy for conflicts
 */
export type ConflictResolutionStrategy =
  | 'source-wins'        // Always use source value
  | 'destination-wins'   // Always use destination value
  | 'last-write-wins'    // Use the most recently modified value
  | 'first-write-wins'   // Use the first modified value
  | 'manual'             // Require manual resolution

/**
 * Represents a detected conflict between source and destination
 */
export interface Conflict {
  /** The unique key of the conflicting record */
  key: string
  /** The record from the source system (null if deleted) */
  sourceRecord: DiffRecord | null
  /** The record from the destination system (null if deleted) */
  destinationRecord: DiffRecord | null
  /** When the source record was last modified */
  sourceModifiedAt: Date | null
  /** When the destination record was last modified */
  destinationModifiedAt: Date | null
  /** Fields that have conflicting values */
  conflictingFields: string[]
  /** Suggested resolution based on configured strategy */
  suggestedResolution?: ConflictResolutionStrategy
}

/**
 * Custom field comparison function
 * Returns true if the values should be considered equal
 */
export type FieldComparator = (
  field: string,
  sourceValue: unknown,
  destValue: unknown
) => boolean

/**
 * Options for ConflictDetector
 */
export interface ConflictDetectorOptions {
  /** Default strategy for resolving conflicts */
  defaultStrategy?: ConflictResolutionStrategy
  /** Custom field comparator function */
  fieldComparator?: FieldComparator
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * ConflictDetector identifies conflicts in bidirectional sync scenarios
 *
 * @example
 * ```typescript
 * const detector = new ConflictDetector()
 * const conflicts = detector.detect(sourceChanges, destChanges)
 * ```
 */
export class ConflictDetector {
  private readonly defaultStrategy: ConflictResolutionStrategy
  private readonly fieldComparator: FieldComparator

  constructor(options: ConflictDetectorOptions = {}) {
    this.defaultStrategy = options.defaultStrategy ?? 'manual'
    this.fieldComparator = options.fieldComparator ?? this.defaultFieldComparator
  }

  /**
   * Detect conflicts between source and destination changes
   *
   * @param sourceChanges - Changes detected in the source system
   * @param destChanges - Changes detected in the destination system
   * @returns Array of detected conflicts
   */
  detect(sourceChanges: DiffResult, destChanges: DiffResult): Conflict[] {
    const conflicts: Conflict[] = []

    // Build lookup maps for efficient matching
    const sourceAdded = new Map<string, DiffRecord>()
    const sourceModified = new Map<string, DiffRecord>()
    const sourceDeleted = new Set<string>(sourceChanges.deleted)

    const destAdded = new Map<string, DiffRecord>()
    const destModified = new Map<string, DiffRecord>()
    const destDeleted = new Set<string>(destChanges.deleted)

    for (const record of sourceChanges.added) {
      sourceAdded.set(record.key, record)
    }
    for (const record of sourceChanges.modified) {
      sourceModified.set(record.key, record)
    }
    for (const record of destChanges.added) {
      destAdded.set(record.key, record)
    }
    for (const record of destChanges.modified) {
      destModified.set(record.key, record)
    }

    // Check for add-add conflicts (same key added in both)
    for (const [key, sourceRecord] of sourceAdded) {
      const destRecord = destAdded.get(key)
      if (destRecord) {
        // Check if the data is actually different
        const conflictingFields = this.detectFieldConflicts(
          sourceRecord.data,
          destRecord.data
        )

        if (conflictingFields.length > 0) {
          conflicts.push(this.createConflict(
            key,
            sourceRecord,
            destRecord,
            conflictingFields
          ))
        }
      }
    }

    // Check for modify-modify conflicts
    for (const [key, sourceRecord] of sourceModified) {
      const destRecord = destModified.get(key)
      if (destRecord) {
        // Check if the data is actually different
        const conflictingFields = this.detectFieldConflicts(
          sourceRecord.data,
          destRecord.data
        )

        if (conflictingFields.length > 0) {
          conflicts.push(this.createConflict(
            key,
            sourceRecord,
            destRecord,
            conflictingFields
          ))
        }
      }
    }

    // Check for modify-delete conflicts (source modified, dest deleted)
    for (const [key, sourceRecord] of sourceModified) {
      if (destDeleted.has(key)) {
        conflicts.push(this.createConflict(
          key,
          sourceRecord,
          null,
          ['__deleted__']
        ))
      }
    }

    // Check for delete-modify conflicts (source deleted, dest modified)
    for (const [key, destRecord] of destModified) {
      if (sourceDeleted.has(key)) {
        conflicts.push(this.createConflict(
          key,
          null,
          destRecord,
          ['__deleted__']
        ))
      }
    }

    // Check for add-modify conflicts (source added, dest modified)
    // This could happen if source created a record that dest already had
    for (const [key, sourceRecord] of sourceAdded) {
      const destRecord = destModified.get(key)
      if (destRecord) {
        const conflictingFields = this.detectFieldConflicts(
          sourceRecord.data,
          destRecord.data
        )

        if (conflictingFields.length > 0) {
          conflicts.push(this.createConflict(
            key,
            sourceRecord,
            destRecord,
            conflictingFields
          ))
        }
      }
    }

    // Check for modify-add conflicts (source modified, dest added)
    for (const [key, destRecord] of destAdded) {
      const sourceRecord = sourceModified.get(key)
      if (sourceRecord) {
        const conflictingFields = this.detectFieldConflicts(
          sourceRecord.data,
          destRecord.data
        )

        if (conflictingFields.length > 0) {
          conflicts.push(this.createConflict(
            key,
            sourceRecord,
            destRecord,
            conflictingFields
          ))
        }
      }
    }

    // Note: delete-delete is NOT a conflict - both systems agree to delete

    return conflicts
  }

  /**
   * Detect which fields have conflicting values between two records
   *
   * @param sourceData - Data from the source record
   * @param destData - Data from the destination record
   * @returns Array of field names that have different values
   */
  detectFieldConflicts(
    sourceData: Record<string, unknown>,
    destData: Record<string, unknown>
  ): string[] {
    const conflictingFields: string[] = []

    // Get all unique keys from both records
    const allKeys = new Set([
      ...Object.keys(sourceData),
      ...Object.keys(destData),
    ])

    for (const key of allKeys) {
      const sourceValue = sourceData[key]
      const destValue = destData[key]

      if (!this.fieldComparator(key, sourceValue, destValue)) {
        conflictingFields.push(key)
      }
    }

    return conflictingFields
  }

  /**
   * Default field comparator using deep equality check
   */
  private defaultFieldComparator(
    _field: string,
    sourceValue: unknown,
    destValue: unknown
  ): boolean {
    // Handle undefined/null equivalence
    if (sourceValue === undefined && destValue === undefined) return true
    if (sourceValue === null && destValue === null) return true
    if (sourceValue === undefined || destValue === undefined) return false
    if (sourceValue === null || destValue === null) return false

    // For objects and arrays, use JSON comparison
    if (typeof sourceValue === 'object' || typeof destValue === 'object') {
      return JSON.stringify(sourceValue) === JSON.stringify(destValue)
    }

    // Primitive comparison
    return sourceValue === destValue
  }

  /**
   * Create a Conflict object with suggested resolution
   */
  private createConflict(
    key: string,
    sourceRecord: DiffRecord | null,
    destRecord: DiffRecord | null,
    conflictingFields: string[]
  ): Conflict {
    const conflict: Conflict = {
      key,
      sourceRecord,
      destinationRecord: destRecord,
      sourceModifiedAt: sourceRecord?.modifiedAt ?? null,
      destinationModifiedAt: destRecord?.modifiedAt ?? null,
      conflictingFields,
      suggestedResolution: this.suggestResolution(sourceRecord, destRecord),
    }

    return conflict
  }

  /**
   * Suggest a resolution based on the configured strategy
   */
  private suggestResolution(
    sourceRecord: DiffRecord | null,
    destRecord: DiffRecord | null
  ): ConflictResolutionStrategy {
    switch (this.defaultStrategy) {
      case 'source-wins':
        return 'source-wins'

      case 'destination-wins':
        return 'destination-wins'

      case 'last-write-wins': {
        // If one is deleted (null), the other wins by default
        if (!sourceRecord) return 'destination-wins'
        if (!destRecord) return 'source-wins'

        // Compare timestamps
        const sourceTime = sourceRecord.modifiedAt.getTime()
        const destTime = destRecord.modifiedAt.getTime()

        return sourceTime >= destTime ? 'source-wins' : 'destination-wins'
      }

      case 'first-write-wins': {
        // If one is deleted (null), the other wins by default
        if (!sourceRecord) return 'destination-wins'
        if (!destRecord) return 'source-wins'

        // Compare timestamps - first (earlier) wins
        const sourceTime = sourceRecord.modifiedAt.getTime()
        const destTime = destRecord.modifiedAt.getTime()

        return sourceTime <= destTime ? 'source-wins' : 'destination-wins'
      }

      case 'manual':
      default:
        return 'manual'
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new ConflictDetector instance
 *
 * @param options - Configuration options
 * @returns A new ConflictDetector instance
 */
export function createConflictDetector(
  options: ConflictDetectorOptions = {}
): ConflictDetector {
  return new ConflictDetector(options)
}
