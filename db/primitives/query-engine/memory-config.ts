/**
 * Memory Configuration for Query Intermediate Results
 *
 * Provides constants and utilities for memory-aware query execution in
 * Durable Objects environment (128 MB per isolate limit).
 *
 * ## Cloudflare DO Memory Constraints
 * - 128 MB per isolate (shared across multiple DOs)
 * - Graceful degradation when exceeded (new isolate, in-flight complete)
 * - SQLite storage: 10 GB per DO for spilling
 * - R2: Unlimited for large overflow
 *
 * ## Usage
 * ```typescript
 * import { MEMORY_BUDGETS, shouldSpillToDisk, estimateRowSetSize } from './memory-config'
 *
 * const estimatedSize = estimateRowSetSize(rowCount, avgRowBytes)
 * if (shouldSpillToDisk(estimatedSize)) {
 *   // Use external sort or disk-backed hash table
 * }
 * ```
 *
 * @see dotdo-ck97t - Memory limits spike
 * @see docs/spikes/memory-limits-intermediate-results.md
 * @module db/primitives/query-engine/memory-config
 */

// =============================================================================
// Memory Budget Constants
// =============================================================================

/**
 * Memory budgets for query execution in DO environment
 *
 * These values are tuned for 128 MB isolate limit, allowing headroom
 * for multiple concurrent queries and DO framework overhead.
 */
export const MEMORY_BUDGETS = {
  // -------------------------------------------------------------------------
  // Per-Query Limits
  // -------------------------------------------------------------------------

  /** Warning threshold - log and consider optimization (30 MB) */
  QUERY_WARN_BYTES: 30 * 1024 * 1024,

  /** Spill threshold - start using disk for intermediate results (50 MB) */
  QUERY_SPILL_BYTES: 50 * 1024 * 1024,

  /** Abort threshold - reject query to protect DO stability (80 MB) */
  QUERY_ABORT_BYTES: 80 * 1024 * 1024,

  // -------------------------------------------------------------------------
  // Per-DO Aggregate Limits (multiple concurrent queries)
  // -------------------------------------------------------------------------

  /** DO warning threshold - start shedding load (80 MB) */
  DO_WARN_BYTES: 80 * 1024 * 1024,

  /** DO critical threshold - emergency measures (100 MB) */
  DO_CRITICAL_BYTES: 100 * 1024 * 1024,

  // -------------------------------------------------------------------------
  // Operator-Specific Limits
  // -------------------------------------------------------------------------

  /** Max in-memory sort size before external sort (30 MB) */
  SORT_MEMORY_BYTES: 30 * 1024 * 1024,

  /** Max hash table size before disk spill (20 MB) */
  HASH_TABLE_BYTES: 20 * 1024 * 1024,

  /** Max aggregation state before checkpointing (20 MB) */
  AGGREGATION_STATE_BYTES: 20 * 1024 * 1024,

  /** Max join build side before switch to nested loop (30 MB) */
  JOIN_BUILD_SIDE_BYTES: 30 * 1024 * 1024,

  // -------------------------------------------------------------------------
  // Buffer Sizes
  // -------------------------------------------------------------------------

  /** Default streaming batch size (1000 rows) */
  DEFAULT_BATCH_SIZE: 1000,

  /** Max streaming batch size (10000 rows) */
  MAX_BATCH_SIZE: 10000,

  /** Backpressure high watermark (1000 events) */
  BACKPRESSURE_HIGH_WATERMARK: 1000,

  /** Backpressure low watermark (200 events) */
  BACKPRESSURE_LOW_WATERMARK: 200,

  // -------------------------------------------------------------------------
  // Thresholds
  // -------------------------------------------------------------------------

  /** Row count threshold for streaming vs buffering */
  STREAMING_THRESHOLD_ROWS: 10000,

  /** Result set size threshold for R2 overflow (1 MB) */
  R2_OVERFLOW_THRESHOLD_BYTES: 1024 * 1024,
} as const

/**
 * Memory budget type for type-safe access
 */
export type MemoryBudgetKey = keyof typeof MEMORY_BUDGETS

// =============================================================================
// Size Estimation
// =============================================================================

/**
 * Estimate memory usage for a row set
 *
 * @param rowCount - Number of rows
 * @param avgRowBytes - Average bytes per row (default: 200)
 * @param overhead - Per-row overhead for JS objects (default: 50)
 * @returns Estimated bytes
 */
export function estimateRowSetSize(
  rowCount: number,
  avgRowBytes: number = 200,
  overhead: number = 50
): number {
  return rowCount * (avgRowBytes + overhead)
}

/**
 * Estimate hash table memory usage
 *
 * Hash tables have ~2x overhead for buckets and collision lists
 *
 * @param entryCount - Number of entries
 * @param avgKeyBytes - Average key size
 * @param avgValueBytes - Average value size
 * @returns Estimated bytes
 */
export function estimateHashTableSize(
  entryCount: number,
  avgKeyBytes: number = 20,
  avgValueBytes: number = 100
): number {
  const entrySize = avgKeyBytes + avgValueBytes + 50 // JS object overhead
  const hashOverhead = 2 // ~2x for hash table structure
  return entryCount * entrySize * hashOverhead
}

/**
 * Estimate sort buffer memory usage
 *
 * @param rowCount - Number of rows to sort
 * @param avgRowBytes - Average row size
 * @returns Estimated bytes
 */
export function estimateSortBufferSize(
  rowCount: number,
  avgRowBytes: number = 200
): number {
  // Sort needs ~1.5x for index array + temp space
  return rowCount * (avgRowBytes + 50) * 1.5
}

// =============================================================================
// Decision Functions
// =============================================================================

/**
 * Determine if result set should spill to disk
 *
 * @param estimatedBytes - Estimated result size in bytes
 * @returns true if disk spill recommended
 */
export function shouldSpillToDisk(estimatedBytes: number): boolean {
  return estimatedBytes > MEMORY_BUDGETS.QUERY_SPILL_BYTES
}

/**
 * Determine if query should be aborted
 *
 * @param estimatedBytes - Estimated memory usage
 * @returns true if query should be rejected
 */
export function shouldAbortQuery(estimatedBytes: number): boolean {
  return estimatedBytes > MEMORY_BUDGETS.QUERY_ABORT_BYTES
}

/**
 * Determine if streaming should be used instead of buffering
 *
 * @param estimatedRows - Expected row count
 * @returns true if streaming recommended
 */
export function shouldUseStreaming(estimatedRows: number): boolean {
  return estimatedRows > MEMORY_BUDGETS.STREAMING_THRESHOLD_ROWS
}

/**
 * Determine if external sort is needed
 *
 * @param rowCount - Rows to sort
 * @param avgRowBytes - Average row size
 * @returns true if external sort recommended
 */
export function shouldUseExternalSort(
  rowCount: number,
  avgRowBytes: number = 200
): boolean {
  return estimateSortBufferSize(rowCount, avgRowBytes) > MEMORY_BUDGETS.SORT_MEMORY_BYTES
}

/**
 * Determine if hash join build side is too large
 *
 * @param buildSideRows - Rows in build side
 * @param avgRowBytes - Average row size
 * @returns true if should switch to nested loop or partition
 */
export function isHashJoinBuildSideTooLarge(
  buildSideRows: number,
  avgRowBytes: number = 200
): boolean {
  return estimateHashTableSize(buildSideRows, 20, avgRowBytes) > MEMORY_BUDGETS.JOIN_BUILD_SIDE_BYTES
}

// =============================================================================
// Memory Pressure Detection
// =============================================================================

/**
 * Memory pressure levels
 */
export type MemoryPressureLevel = 'normal' | 'elevated' | 'critical'

/**
 * Memory pressure state
 */
export interface MemoryPressureState {
  level: MemoryPressureLevel
  currentBytes: number
  thresholdBytes: number
  recommendation: string
}

/**
 * Assess current memory pressure for a DO
 *
 * @param currentUsageBytes - Current estimated memory usage
 * @returns Memory pressure assessment
 */
export function assessMemoryPressure(currentUsageBytes: number): MemoryPressureState {
  if (currentUsageBytes > MEMORY_BUDGETS.DO_CRITICAL_BYTES) {
    return {
      level: 'critical',
      currentBytes: currentUsageBytes,
      thresholdBytes: MEMORY_BUDGETS.DO_CRITICAL_BYTES,
      recommendation: 'Reject new queries, allow in-flight to complete, trigger emergency cleanup',
    }
  }

  if (currentUsageBytes > MEMORY_BUDGETS.DO_WARN_BYTES) {
    return {
      level: 'elevated',
      currentBytes: currentUsageBytes,
      thresholdBytes: MEMORY_BUDGETS.DO_WARN_BYTES,
      recommendation: 'Enable aggressive spilling, prefer streaming, reduce batch sizes',
    }
  }

  return {
    level: 'normal',
    currentBytes: currentUsageBytes,
    thresholdBytes: MEMORY_BUDGETS.QUERY_WARN_BYTES,
    recommendation: 'Normal operation',
  }
}

// =============================================================================
// Batch Size Calculation
// =============================================================================

/**
 * Calculate optimal batch size based on row size and memory budget
 *
 * @param avgRowBytes - Average row size
 * @param memoryBudget - Available memory budget (default: 10 MB)
 * @returns Recommended batch size
 */
export function calculateOptimalBatchSize(
  avgRowBytes: number,
  memoryBudget: number = 10 * 1024 * 1024
): number {
  const rowWithOverhead = avgRowBytes + 50
  const rawBatchSize = Math.floor(memoryBudget / rowWithOverhead)

  // Clamp to reasonable bounds
  return Math.max(
    100,
    Math.min(rawBatchSize, MEMORY_BUDGETS.MAX_BATCH_SIZE)
  )
}

// =============================================================================
// Query Plan Hints
// =============================================================================

/**
 * Execution strategy hints based on memory constraints
 */
export interface ExecutionHints {
  useStreaming: boolean
  useExternalSort: boolean
  spillHashTables: boolean
  maxBatchSize: number
  preferNestedLoopJoin: boolean
  enableCheckpointing: boolean
}

/**
 * Generate execution hints based on estimated query size
 *
 * @param estimatedRows - Expected result rows
 * @param estimatedRowBytes - Average row size
 * @param hasSortClause - Query includes ORDER BY
 * @param hasJoinClause - Query includes JOIN
 * @returns Execution strategy hints
 */
export function generateExecutionHints(
  estimatedRows: number,
  estimatedRowBytes: number = 200,
  hasSortClause: boolean = false,
  hasJoinClause: boolean = false
): ExecutionHints {
  const estimatedResultBytes = estimateRowSetSize(estimatedRows, estimatedRowBytes)

  return {
    useStreaming: shouldUseStreaming(estimatedRows),
    useExternalSort: hasSortClause && shouldUseExternalSort(estimatedRows, estimatedRowBytes),
    spillHashTables: estimatedResultBytes > MEMORY_BUDGETS.HASH_TABLE_BYTES,
    maxBatchSize: calculateOptimalBatchSize(estimatedRowBytes),
    preferNestedLoopJoin: hasJoinClause && isHashJoinBuildSideTooLarge(estimatedRows, estimatedRowBytes),
    enableCheckpointing: estimatedResultBytes > MEMORY_BUDGETS.AGGREGATION_STATE_BYTES,
  }
}
