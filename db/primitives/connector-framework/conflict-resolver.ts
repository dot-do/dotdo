/**
 * Conflict Resolution Strategies
 *
 * Implements pluggable conflict resolution strategies for bidirectional sync:
 * - LWW (Last-Writer-Wins): Uses timestamps to determine winner
 * - source-wins: Always use source record
 * - dest-wins: Always use destination record
 * - merge: Field-level merge of non-conflicting fields
 * - custom: User-provided resolver function
 *
 * @module db/primitives/connector-framework/conflict-resolver
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Resolution strategy type
 */
export type ResolutionStrategy = 'lww' | 'source-wins' | 'dest-wins' | 'merge' | 'custom'

/**
 * Winner indicator for resolved conflicts
 */
export type Winner = 'source' | 'dest' | 'merged' | 'custom'

/**
 * Record state with timestamp and version
 */
export interface RecordState {
  /** Record data as key-value pairs */
  data: Record<string, unknown>
  /** Last update timestamp (milliseconds since epoch) */
  updatedAt: number
  /** Optional version number for tie-breaking */
  version?: number
}

/**
 * Conflict between source and destination records
 */
export interface Conflict {
  /** Unique key identifying the record */
  key: string
  /** Source (incoming) record state */
  source: RecordState
  /** Destination (existing) record state */
  dest: RecordState
  /** Optional metadata about the conflict */
  metadata?: Record<string, unknown>
}

/**
 * Resolution result metadata
 */
export interface ResolutionMetadata {
  /** List of fields that had conflicts */
  conflictingFields?: string[]
  /** Reason for manual review if applicable */
  reason?: string
  /** Strategy used for resolution */
  strategy?: ResolutionStrategy
  /** Additional context */
  [key: string]: unknown
}

/**
 * Resolved record result
 */
export interface ResolvedRecord {
  /** Resolution type */
  type: 'resolved' | 'skipped' | 'manual'
  /** Resolved data (only for 'resolved' type) */
  data?: Record<string, unknown>
  /** Which side won the conflict */
  winner?: Winner
  /** Original conflict (for manual review) */
  conflict?: Conflict
  /** Resolution metadata */
  metadata?: ResolutionMetadata
}

/**
 * Custom resolver function type
 */
export type CustomResolver = (conflict: Conflict) => ResolvedRecord | 'skip' | 'manual'

/**
 * Merge options for merge strategy
 */
export interface MergeOptions {
  /** Use LWW for individual conflicting fields */
  preferLwwForConflicts?: boolean
  /** Deep merge nested objects */
  deep?: boolean
  /** Fields to always take from source */
  sourceFields?: string[]
  /** Fields to always take from dest */
  destFields?: string[]
}

/**
 * Conflict resolver configuration
 */
export interface ConflictResolverConfig {
  /** Resolution strategy to use */
  strategy: ResolutionStrategy
  /** Custom resolver function (required for 'custom' strategy) */
  customResolver?: CustomResolver
  /** Merge options (for 'merge' strategy) */
  mergeOptions?: MergeOptions
  /** Number of conflicting fields that triggers manual review */
  manualReviewThreshold?: number
  /** Callback when manual review is triggered */
  onManualReview?: (conflict: Conflict, conflictingFields: string[]) => void
}

/**
 * Resolution statistics
 */
export interface ResolutionStats {
  /** Total conflicts resolved */
  total: number
  /** Conflicts won by source */
  sourceWins: number
  /** Conflicts won by dest */
  destWins: number
  /** Conflicts merged */
  merged: number
  /** Conflicts skipped */
  skipped: number
  /** Conflicts sent to manual review */
  manual: number
}

/**
 * Conflict resolver interface
 */
export interface ConflictResolver {
  /** Resolve a conflict using configured strategy */
  resolve(conflict: Conflict): ResolvedRecord
  /** Get resolution statistics */
  getStats(): ResolutionStats
  /** Change resolution strategy at runtime */
  setStrategy(strategy: ResolutionStrategy, customResolver?: CustomResolver): void
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Find conflicting fields between two records
 */
function findConflictingFields(
  source: Record<string, unknown>,
  dest: Record<string, unknown>,
): string[] {
  const conflicts: string[] = []
  const allKeys = new Set([...Object.keys(source), ...Object.keys(dest)])

  for (const key of allKeys) {
    const sourceValue = source[key]
    const destValue = dest[key]

    // Both have the field but with different values
    if (key in source && key in dest) {
      if (!deepEqual(sourceValue, destValue)) {
        conflicts.push(key)
      }
    }
  }

  return conflicts
}

/**
 * Deep equality check for values
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (typeof a !== typeof b) return false

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>
    const bObj = b as Record<string, unknown>
    const aKeys = Object.keys(aObj)
    const bKeys = Object.keys(bObj)

    if (aKeys.length !== bKeys.length) return false

    for (const key of aKeys) {
      if (!bKeys.includes(key)) return false
      if (!deepEqual(aObj[key], bObj[key])) return false
    }

    return true
  }

  return false
}

/**
 * Deep merge two objects bidirectionally
 * Combines all keys from both objects, recursively merging nested objects
 */
function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])

  for (const key of allKeys) {
    const aValue = a[key]
    const bValue = b[key]

    // Only in a
    if (key in a && !(key in b)) {
      result[key] = aValue
      continue
    }

    // Only in b
    if (key in b && !(key in a)) {
      result[key] = bValue
      continue
    }

    // Both have the key - check if both are objects to recursively merge
    if (
      aValue !== null &&
      typeof aValue === 'object' &&
      !Array.isArray(aValue) &&
      bValue !== null &&
      typeof bValue === 'object' &&
      !Array.isArray(bValue)
    ) {
      result[key] = deepMerge(
        aValue as Record<string, unknown>,
        bValue as Record<string, unknown>,
      )
    } else {
      // For non-objects or arrays, prefer a (source) over b (dest)
      result[key] = aValue
    }
  }

  return result
}

/**
 * LWW resolution strategy
 */
function resolveLww(conflict: Conflict): ResolvedRecord {
  const { source, dest } = conflict

  // Compare timestamps
  if (source.updatedAt > dest.updatedAt) {
    return {
      type: 'resolved',
      data: { ...source.data },
      winner: 'source',
      metadata: { strategy: 'lww' },
    }
  }

  if (dest.updatedAt > source.updatedAt) {
    return {
      type: 'resolved',
      data: { ...dest.data },
      winner: 'dest',
      metadata: { strategy: 'lww' },
    }
  }

  // Timestamps equal - use version as tiebreaker
  const sourceVersion = source.version ?? 0
  const destVersion = dest.version ?? 0

  if (sourceVersion >= destVersion) {
    return {
      type: 'resolved',
      data: { ...source.data },
      winner: 'source',
      metadata: { strategy: 'lww' },
    }
  }

  return {
    type: 'resolved',
    data: { ...dest.data },
    winner: 'dest',
    metadata: { strategy: 'lww' },
  }
}

/**
 * Source-wins resolution strategy
 */
function resolveSourceWins(conflict: Conflict): ResolvedRecord {
  return {
    type: 'resolved',
    data: { ...conflict.source.data },
    winner: 'source',
    metadata: { strategy: 'source-wins' },
  }
}

/**
 * Dest-wins resolution strategy
 */
function resolveDestWins(conflict: Conflict): ResolvedRecord {
  return {
    type: 'resolved',
    data: { ...conflict.dest.data },
    winner: 'dest',
    metadata: { strategy: 'dest-wins' },
  }
}

/**
 * Merge resolution strategy
 */
function resolveMerge(conflict: Conflict, options: MergeOptions = {}): ResolvedRecord {
  const { source, dest } = conflict
  const conflictingFields = findConflictingFields(source.data, dest.data)

  // Start with dest data as base
  let merged: Record<string, unknown>

  if (options.deep) {
    // Deep merge: combines all fields from both, recursively merging nested objects
    // Source values preferred for conflicts at leaf level
    merged = deepMerge(source.data, dest.data)

    // For deep merge, only apply explicit field preferences (not default conflict handling)
    // because deepMerge already handles nested conflict resolution
    for (const field of conflictingFields) {
      if (options.sourceFields?.includes(field)) {
        merged[field] = source.data[field]
        continue
      }
      if (options.destFields?.includes(field)) {
        merged[field] = dest.data[field]
        continue
      }
      // For preferLwwForConflicts with deep merge, only apply to primitive conflicts
      if (options.preferLwwForConflicts) {
        const sourceVal = source.data[field]
        const destVal = dest.data[field]
        // Only apply LWW preference if both are primitives (not objects)
        const sourceIsPrimitive = sourceVal === null || typeof sourceVal !== 'object'
        const destIsPrimitive = destVal === null || typeof destVal !== 'object'
        if (sourceIsPrimitive && destIsPrimitive) {
          if (dest.updatedAt > source.updatedAt) {
            merged[field] = dest.data[field]
          }
          // else keep source (already in merged from deepMerge)
        }
      }
    }
  } else {
    // Shallow merge: combine all fields
    merged = { ...dest.data, ...source.data }

    // Handle conflicting fields for shallow merge
    for (const field of conflictingFields) {
      // Check explicit field preferences
      if (options.sourceFields?.includes(field)) {
        merged[field] = source.data[field]
        continue
      }
      if (options.destFields?.includes(field)) {
        merged[field] = dest.data[field]
        continue
      }

      // Use LWW for conflicts if enabled
      if (options.preferLwwForConflicts) {
        if (dest.updatedAt > source.updatedAt) {
          merged[field] = dest.data[field]
        } else {
          merged[field] = source.data[field]
        }
      } else {
        // Default: prefer source for conflicts
        merged[field] = source.data[field]
      }
    }
  }

  return {
    type: 'resolved',
    data: merged,
    winner: 'merged',
    metadata: {
      strategy: 'merge',
      conflictingFields,
    },
  }
}

/**
 * Create a conflict resolver instance
 */
export function createConflictResolver(config: ConflictResolverConfig): ConflictResolver {
  let currentStrategy = config.strategy
  let customResolver = config.customResolver
  const mergeOptions = config.mergeOptions ?? {}
  const manualReviewThreshold = config.manualReviewThreshold
  const onManualReview = config.onManualReview

  // Validate custom strategy has resolver
  if (currentStrategy === 'custom' && !customResolver) {
    throw new Error('Custom resolver function required for custom strategy')
  }

  // Statistics tracking
  const stats: ResolutionStats = {
    total: 0,
    sourceWins: 0,
    destWins: 0,
    merged: 0,
    skipped: 0,
    manual: 0,
  }

  function updateStats(result: ResolvedRecord): void {
    stats.total++
    switch (result.type) {
      case 'resolved':
        if (result.winner === 'source') stats.sourceWins++
        else if (result.winner === 'dest') stats.destWins++
        else if (result.winner === 'merged') stats.merged++
        break
      case 'skipped':
        stats.skipped++
        break
      case 'manual':
        stats.manual++
        break
    }
  }

  function resolve(conflict: Conflict): ResolvedRecord {
    // For merge strategy, check manual review threshold first
    if (currentStrategy === 'merge' && manualReviewThreshold !== undefined) {
      const conflictingFields = findConflictingFields(conflict.source.data, conflict.dest.data)

      if (conflictingFields.length > manualReviewThreshold) {
        onManualReview?.(conflict, conflictingFields)
        const result: ResolvedRecord = {
          type: 'manual',
          conflict,
          metadata: {
            reason: 'exceeded_threshold',
            conflictingFields,
            strategy: 'merge',
          },
        }
        updateStats(result)
        return result
      }
    }

    let result: ResolvedRecord

    switch (currentStrategy) {
      case 'lww':
        result = resolveLww(conflict)
        break

      case 'source-wins':
        result = resolveSourceWins(conflict)
        break

      case 'dest-wins':
        result = resolveDestWins(conflict)
        break

      case 'merge':
        result = resolveMerge(conflict, mergeOptions)
        break

      case 'custom':
        if (!customResolver) {
          throw new Error('Custom resolver function not configured')
        }
        const customResult = customResolver(conflict)

        if (customResult === 'skip') {
          result = { type: 'skipped', metadata: { strategy: 'custom' } }
        } else if (customResult === 'manual') {
          result = {
            type: 'manual',
            conflict,
            metadata: { strategy: 'custom' },
          }
        } else {
          result = customResult
        }
        break

      default:
        throw new Error(`Unknown resolution strategy: ${currentStrategy}`)
    }

    updateStats(result)
    return result
  }

  function getStats(): ResolutionStats {
    return { ...stats }
  }

  function setStrategy(strategy: ResolutionStrategy, resolver?: CustomResolver): void {
    if (strategy === 'custom' && !resolver) {
      throw new Error('Custom resolver function required for custom strategy')
    }
    currentStrategy = strategy
    if (resolver) {
      customResolver = resolver
    }
  }

  return {
    resolve,
    getStats,
    setStrategy,
  }
}
