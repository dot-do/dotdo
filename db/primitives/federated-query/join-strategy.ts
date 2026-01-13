/**
 * Join Strategy Selection
 *
 * Cost-based selection of optimal join strategies for federated queries:
 * - Broadcast join: Small table broadcast to all nodes
 * - Shuffle join: Hash partition both sides for large-to-large joins
 * - Sort-merge join: Sort both sides and merge (for already-sorted data or indexed lookups)
 * - Nested loop join: For small result sets or inequality joins
 *
 * @see dotdo-fv8v0
 * @module db/primitives/federated-query/join-strategy
 */

import type { Catalog, SourceStatistics, TableStats } from './index'

// =============================================================================
// THRESHOLD CONSTANTS
// =============================================================================

/**
 * Maximum row count for broadcast join eligibility
 * Tables with fewer rows than this will be considered for broadcast
 */
export const BROADCAST_THRESHOLD_ROWS = 10_000

/**
 * Maximum byte size for broadcast join eligibility (10MB)
 * Tables smaller than this will be considered for broadcast
 */
export const BROADCAST_THRESHOLD_BYTES = 10 * 1024 * 1024

/**
 * Threshold for very small tables (use nested loop)
 */
const NESTED_LOOP_THRESHOLD_ROWS = 50

/**
 * Default row estimate when statistics are unavailable
 */
const DEFAULT_ROW_ESTIMATE = 100_000

/**
 * Default byte estimate when statistics are unavailable
 */
const DEFAULT_BYTE_ESTIMATE = 50 * 1024 * 1024 // 50MB

/**
 * Default partition count for shuffle joins
 */
const DEFAULT_PARTITION_COUNT = 16

/**
 * Target partition size in bytes for shuffle join planning
 */
const TARGET_PARTITION_BYTES = 64 * 1024 * 1024 // 64MB

/**
 * Sort-merge join threshold: prefer sort-merge when data is already sorted
 * or when indexed access is available
 */
const SORT_MERGE_PREFER_SORTED_THRESHOLD = 0.8 // 80% of data already sorted

/**
 * Index selectivity threshold for preferring indexed nested loop
 */
const INDEX_LOOKUP_SELECTIVITY_THRESHOLD = 0.01 // 1% selectivity

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Join type enumeration
 */
export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'

/**
 * Join operator type
 */
export type JoinOperator = '=' | '<' | '>' | '<=' | '>=' | '!='

/**
 * Table reference for join strategy input
 */
export interface JoinTableRef {
  source: string
  table: string
}

/**
 * Join condition specification
 */
export interface JoinCondition {
  left: string
  right: string
  operator?: JoinOperator
}

/**
 * Source capability for join execution
 */
export interface SourceJoinCapability {
  canHash: boolean
  canStream: boolean
  canBroadcast?: boolean
  canSort?: boolean
  canMerge?: boolean
}

/**
 * Index type enumeration
 */
export type IndexType = 'btree' | 'hash' | 'clustered' | 'covering'

/**
 * Index information for a column
 */
export interface ColumnIndex {
  name: string
  type: IndexType
  columns: string[]
  unique?: boolean
  /** Whether data is physically sorted by this index (clustered) */
  clustered?: boolean
  /** Estimated selectivity (0-1) */
  selectivity?: number
}

/**
 * Table index information
 */
export interface TableIndexInfo {
  indexes: ColumnIndex[]
  /** Primary key columns */
  primaryKey?: string[]
  /** Whether table is sorted by any column */
  sortedBy?: string[]
}

/**
 * Input for join strategy selection
 */
export interface JoinStrategyInput {
  left: JoinTableRef
  right: JoinTableRef
  joinType: JoinType
  on: JoinCondition
  secondaryCondition?: JoinCondition
  sourceCapabilities?: Record<string, SourceJoinCapability>
  /** Index information for tables */
  indexInfo?: Record<string, TableIndexInfo>
}

/**
 * Base join strategy interface
 */
export interface BaseJoinStrategy {
  type: 'broadcast' | 'shuffle' | 'nested_loop' | 'sort_merge'
}

/**
 * Broadcast join strategy - small table is materialized and sent to all nodes
 */
export interface BroadcastJoinStrategy extends BaseJoinStrategy {
  type: 'broadcast'
  broadcastSide: 'left' | 'right'
}

/**
 * Shuffle join strategy - hash partition both sides by join key
 */
export interface ShuffleJoinStrategy extends BaseJoinStrategy {
  type: 'shuffle'
  partitionCount: number
  partitionKey: string
}

/**
 * Nested loop join strategy - for small tables or inequality joins
 */
export interface NestedLoopJoinStrategy extends BaseJoinStrategy {
  type: 'nested_loop'
  outerSide: 'left' | 'right'
  streamInner?: boolean
  /** Use index lookup for inner table */
  useIndex?: boolean
  /** Index name to use for lookups */
  indexName?: string
}

/**
 * Sort-merge join strategy - sort both sides and merge
 * Optimal when data is already sorted or when indexed access is available
 */
export interface SortMergeJoinStrategy extends BaseJoinStrategy {
  type: 'sort_merge'
  /** Sort key column */
  sortKey: string
  /** Sort direction */
  sortDirection: 'ASC' | 'DESC'
  /** Whether left side is already sorted */
  leftSorted: boolean
  /** Whether right side is already sorted */
  rightSorted: boolean
  /** Whether to use external sort for large datasets */
  useExternalSort?: boolean
}

/**
 * Union type of all join strategies
 */
export type JoinStrategy = BroadcastJoinStrategy | ShuffleJoinStrategy | NestedLoopJoinStrategy | SortMergeJoinStrategy

/**
 * Cost estimate for a join strategy
 */
export interface JoinCost {
  totalCost: number
  networkBytes: number
  comparisons: number
  networkLatencyFactor: number
  estimatedTimeMs?: number
}

/**
 * Table statistics for join planning
 */
interface TableStatistics {
  rowCount: number
  sizeBytes: number
  distinctCounts?: Record<string, number>
}

// =============================================================================
// JOIN STRATEGY SELECTOR
// =============================================================================

/**
 * JoinStrategySelector - Selects optimal join strategy based on cost estimation
 *
 * Strategy selection rules:
 * 1. Non-equi joins (< > <= >= !=) -> nested loop (with index if available)
 * 2. Very small tables (both < 50 rows) -> nested loop
 * 3. Both tables already sorted on join key -> sort-merge
 * 4. One table sorted + index on other -> sort-merge
 * 5. One small table (< threshold) -> broadcast
 * 6. Both large tables -> shuffle or sort-merge
 * 7. No statistics -> conservative shuffle (safe default)
 */
export class JoinStrategySelector {
  constructor(private catalog: Catalog) {}

  /**
   * Select optimal join strategy for the given input
   */
  select(input: JoinStrategyInput): JoinStrategy {
    // Check for non-equi join (must use nested loop)
    if (this.isNonEquiJoin(input)) {
      return this.createNestedLoopStrategy(input)
    }

    // Get table statistics
    const leftStats = this.getTableStats(input.left)
    const rightStats = this.getTableStats(input.right)

    // Check if statistics are available
    const hasStats = this.hasKnownStats(input.left) || this.hasKnownStats(input.right)

    // If no statistics, use conservative shuffle
    if (!hasStats) {
      return this.createShuffleStrategy(input, leftStats, rightStats)
    }

    // Check for very small tables (nested loop)
    if (this.areBothVerySmall(leftStats, rightStats)) {
      return this.createNestedLoopStrategy(input)
    }

    // Check if sort-merge join is optimal (already sorted data or good indexes)
    const sortMergeStrategy = this.checkSortMergeEligibility(input, leftStats, rightStats)
    if (sortMergeStrategy !== null) {
      return sortMergeStrategy
    }

    // Check for broadcast eligibility
    const broadcastSide = this.getBroadcastSide(input, leftStats, rightStats)
    if (broadcastSide !== null) {
      return this.createBroadcastStrategy(input, broadcastSide)
    }

    // Check source capabilities for shuffle
    if (input.sourceCapabilities) {
      const canShuffle = this.canDoShuffleJoin(input)
      if (!canShuffle) {
        // Check if sort-merge is possible
        if (this.canDoSortMergeJoin(input)) {
          return this.createSortMergeStrategy(input, leftStats, rightStats)
        }
        // Fall back to broadcast if possible
        const forceBroadcastSide = this.forceBroadcastSide(input, leftStats, rightStats)
        if (forceBroadcastSide !== null) {
          return this.createBroadcastStrategy(input, forceBroadcastSide)
        }
        // Last resort: nested loop
        return this.createNestedLoopStrategy(input)
      }
    }

    // Default to shuffle for large-to-large joins
    return this.createShuffleStrategy(input, leftStats, rightStats)
  }

  /**
   * Estimate cost for a specific strategy
   */
  estimateCost(input: JoinStrategyInput, strategy: JoinStrategy): JoinCost {
    const leftStats = this.getTableStats(input.left)
    const rightStats = this.getTableStats(input.right)
    const latencyFactor = this.calculateNetworkLatencyFactor(input)

    switch (strategy.type) {
      case 'broadcast':
        return this.estimateBroadcastCost(
          input,
          strategy,
          leftStats,
          rightStats,
          latencyFactor
        )

      case 'shuffle':
        return this.estimateShuffleCost(
          input,
          strategy,
          leftStats,
          rightStats,
          latencyFactor
        )

      case 'nested_loop':
        return this.estimateNestedLoopCost(
          input,
          strategy,
          leftStats,
          rightStats,
          latencyFactor
        )

      case 'sort_merge':
        return this.estimateSortMergeCost(
          input,
          strategy,
          leftStats,
          rightStats,
          latencyFactor
        )
    }
  }

  /**
   * Get all possible strategies for comparison
   */
  allStrategies(input: JoinStrategyInput): JoinStrategy[] {
    const strategies: JoinStrategy[] = []
    const leftStats = this.getTableStats(input.left)
    const rightStats = this.getTableStats(input.right)

    // Nested loop is always possible
    strategies.push(this.createNestedLoopStrategy(input))

    // Broadcast with left side
    if (this.canBroadcast(leftStats)) {
      strategies.push({
        type: 'broadcast',
        broadcastSide: 'left',
      })
    }

    // Broadcast with right side
    if (this.canBroadcast(rightStats)) {
      strategies.push({
        type: 'broadcast',
        broadcastSide: 'right',
      })
    }

    // Shuffle if equi-join and sources support it
    if (!this.isNonEquiJoin(input) && this.canDoShuffleJoin(input)) {
      strategies.push(this.createShuffleStrategy(input, leftStats, rightStats))
    }

    // Sort-merge if equi-join and sources support it
    if (!this.isNonEquiJoin(input) && this.canDoSortMergeJoin(input)) {
      strategies.push(this.createSortMergeStrategy(input, leftStats, rightStats))
    }

    return strategies
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Check if this is a non-equi join (requires nested loop)
   */
  private isNonEquiJoin(input: JoinStrategyInput): boolean {
    const operator = input.on.operator ?? '='
    return operator !== '=' || input.secondaryCondition !== undefined
  }

  /**
   * Get table statistics from catalog
   */
  private getTableStats(ref: JoinTableRef): TableStatistics {
    const sourceStats = this.catalog.getStatistics(ref.source)
    const tableStats = sourceStats?.tables[ref.table]

    return {
      rowCount: tableStats?.rowCount ?? DEFAULT_ROW_ESTIMATE,
      sizeBytes: tableStats?.sizeBytes ?? DEFAULT_BYTE_ESTIMATE,
      distinctCounts: tableStats?.distinctCounts,
    }
  }

  /**
   * Check if we have known statistics for a table
   */
  private hasKnownStats(ref: JoinTableRef): boolean {
    const sourceStats = this.catalog.getStatistics(ref.source)
    return sourceStats?.tables[ref.table] !== undefined
  }

  /**
   * Check if both tables are very small (use nested loop)
   */
  private areBothVerySmall(left: TableStatistics, right: TableStatistics): boolean {
    return (
      left.rowCount < NESTED_LOOP_THRESHOLD_ROWS &&
      right.rowCount < NESTED_LOOP_THRESHOLD_ROWS
    )
  }

  /**
   * Check if a table is small enough for broadcast
   */
  private canBroadcast(stats: TableStatistics): boolean {
    return (
      stats.rowCount < BROADCAST_THRESHOLD_ROWS ||
      stats.sizeBytes < BROADCAST_THRESHOLD_BYTES
    )
  }

  /**
   * Determine which side (if any) should be broadcast
   * Returns null if neither side is eligible for broadcast
   */
  private getBroadcastSide(
    input: JoinStrategyInput,
    leftStats: TableStatistics,
    rightStats: TableStatistics
  ): 'left' | 'right' | null {
    const leftCanBroadcast = this.canBroadcast(leftStats)
    const rightCanBroadcast = this.canBroadcast(rightStats)

    // Neither can broadcast
    if (!leftCanBroadcast && !rightCanBroadcast) {
      return null
    }

    // Join type constraints
    switch (input.joinType) {
      case 'LEFT':
        // For LEFT JOIN, must broadcast right side (to preserve all left rows)
        return rightCanBroadcast ? 'right' : null

      case 'RIGHT':
        // For RIGHT JOIN, must broadcast left side (to preserve all right rows)
        return leftCanBroadcast ? 'left' : null

      case 'FULL':
        // FULL JOIN - prefer smaller side, but both must be broadcastable
        // Actually for full join, we can still broadcast the smaller side
        if (leftCanBroadcast && rightCanBroadcast) {
          return leftStats.sizeBytes <= rightStats.sizeBytes ? 'left' : 'right'
        }
        return leftCanBroadcast ? 'left' : (rightCanBroadcast ? 'right' : null)

      case 'INNER':
      default:
        // For INNER JOIN, broadcast the smaller side
        if (leftCanBroadcast && rightCanBroadcast) {
          return leftStats.sizeBytes <= rightStats.sizeBytes ? 'left' : 'right'
        }
        return leftCanBroadcast ? 'left' : 'right'
    }
  }

  /**
   * Force broadcast side when shuffle is not available
   */
  private forceBroadcastSide(
    input: JoinStrategyInput,
    leftStats: TableStatistics,
    rightStats: TableStatistics
  ): 'left' | 'right' | null {
    // Try to broadcast regardless of threshold
    switch (input.joinType) {
      case 'LEFT':
        return 'right'
      case 'RIGHT':
        return 'left'
      default:
        return leftStats.sizeBytes <= rightStats.sizeBytes ? 'left' : 'right'
    }
  }

  /**
   * Check if sources support shuffle join
   */
  private canDoShuffleJoin(input: JoinStrategyInput): boolean {
    if (!input.sourceCapabilities) {
      return true // Assume capable if not specified
    }

    const leftCaps = input.sourceCapabilities[input.left.source]
    const rightCaps = input.sourceCapabilities[input.right.source]

    // Both sources must support hashing for shuffle
    if (leftCaps && !leftCaps.canHash) return false
    if (rightCaps && !rightCaps.canHash) return false

    return true
  }

  /**
   * Check if sources support sort-merge join
   */
  private canDoSortMergeJoin(input: JoinStrategyInput): boolean {
    if (!input.sourceCapabilities) {
      return true // Assume capable if not specified
    }

    const leftCaps = input.sourceCapabilities[input.left.source]
    const rightCaps = input.sourceCapabilities[input.right.source]

    // Both sources must support sorting and merging
    if (leftCaps && leftCaps.canSort === false) return false
    if (rightCaps && rightCaps.canSort === false) return false

    return true
  }

  /**
   * Check if sort-merge join is optimal based on sorted data or index availability
   */
  private checkSortMergeEligibility(
    input: JoinStrategyInput,
    leftStats: TableStatistics,
    rightStats: TableStatistics
  ): SortMergeJoinStrategy | null {
    const leftKey = input.on.left.split('.').pop()!
    const rightKey = input.on.right.split('.').pop()!

    // Get index information
    const leftTableKey = `${input.left.source}.${input.left.table}`
    const rightTableKey = `${input.right.source}.${input.right.table}`
    const leftIndexInfo = input.indexInfo?.[leftTableKey]
    const rightIndexInfo = input.indexInfo?.[rightTableKey]

    // Check if both tables are already sorted on the join key
    const leftSorted = this.isTableSortedOnColumn(leftIndexInfo, leftKey)
    const rightSorted = this.isTableSortedOnColumn(rightIndexInfo, rightKey)

    // If both are already sorted, sort-merge is optimal
    if (leftSorted && rightSorted) {
      return {
        type: 'sort_merge',
        sortKey: leftKey,
        sortDirection: 'ASC',
        leftSorted: true,
        rightSorted: true,
        useExternalSort: false,
      }
    }

    // If one side is sorted and the other has good index coverage, prefer sort-merge
    // This is more efficient than shuffle when one side is already sorted
    if (leftSorted || rightSorted) {
      const unsortedSide = leftSorted ? 'right' : 'left'
      const unsortedStats = leftSorted ? rightStats : leftStats
      const unsortedKey = leftSorted ? rightKey : leftKey
      const unsortedIndexInfo = leftSorted ? rightIndexInfo : leftIndexInfo

      // Check if unsorted side has a btree index on the join key
      const hasIndex = this.hasIndexOnColumn(unsortedIndexInfo, unsortedKey, 'btree')

      // Prefer sort-merge if:
      // 1. Unsorted side has btree index (can scan in order), or
      // 2. Unsorted side is small enough to sort efficiently
      if (hasIndex || unsortedStats.rowCount < 1_000_000) {
        return {
          type: 'sort_merge',
          sortKey: leftKey,
          sortDirection: 'ASC',
          leftSorted,
          rightSorted,
          useExternalSort: unsortedStats.rowCount > 100_000,
        }
      }
    }

    // Check for clustered indexes on both sides (data is physically sorted)
    const leftHasClusteredIndex = this.hasClusteredIndexOnColumn(leftIndexInfo, leftKey)
    const rightHasClusteredIndex = this.hasClusteredIndexOnColumn(rightIndexInfo, rightKey)

    if (leftHasClusteredIndex && rightHasClusteredIndex) {
      return {
        type: 'sort_merge',
        sortKey: leftKey,
        sortDirection: 'ASC',
        leftSorted: true,
        rightSorted: true,
        useExternalSort: false,
      }
    }

    return null
  }

  /**
   * Check if a table is sorted on a given column
   */
  private isTableSortedOnColumn(indexInfo: TableIndexInfo | undefined, column: string): boolean {
    if (!indexInfo) return false

    // Check if table is explicitly sorted by this column
    if (indexInfo.sortedBy?.includes(column)) {
      return true
    }

    // Check for clustered index on this column
    return this.hasClusteredIndexOnColumn(indexInfo, column)
  }

  /**
   * Check if table has an index on a given column
   */
  private hasIndexOnColumn(
    indexInfo: TableIndexInfo | undefined,
    column: string,
    indexType?: IndexType
  ): boolean {
    if (!indexInfo) return false

    return indexInfo.indexes.some(idx => {
      // Column must be first in the index for efficient lookup
      if (idx.columns[0] !== column) return false
      // Check index type if specified
      if (indexType && idx.type !== indexType) return false
      return true
    })
  }

  /**
   * Check if table has a clustered index on a given column
   */
  private hasClusteredIndexOnColumn(
    indexInfo: TableIndexInfo | undefined,
    column: string
  ): boolean {
    if (!indexInfo) return false

    return indexInfo.indexes.some(idx =>
      idx.columns[0] === column && (idx.clustered === true || idx.type === 'clustered')
    )
  }

  /**
   * Get index for a column if available
   */
  private getIndexForColumn(
    indexInfo: TableIndexInfo | undefined,
    column: string
  ): ColumnIndex | undefined {
    if (!indexInfo) return undefined

    return indexInfo.indexes.find(idx => idx.columns[0] === column)
  }

  /**
   * Calculate network latency factor based on source regions
   */
  private calculateNetworkLatencyFactor(input: JoinStrategyInput): number {
    const leftSource = this.catalog.getSource(input.left.source)
    const rightSource = this.catalog.getSource(input.right.source)

    const leftRegion = leftSource?.config?.region as string | undefined
    const rightRegion = rightSource?.config?.region as string | undefined

    // Same region or no region info
    if (!leftRegion || !rightRegion || leftRegion === rightRegion) {
      return 1.0
    }

    // Cross-region penalty
    // Simple heuristic: same continent = 1.5x, cross-continent = 2.5x
    const leftContinent = this.extractContinent(leftRegion)
    const rightContinent = this.extractContinent(rightRegion)

    if (leftContinent === rightContinent) {
      return 1.5
    }

    return 2.5
  }

  /**
   * Extract continent from region name (simple heuristic)
   */
  private extractContinent(region: string): string {
    if (region.startsWith('us-') || region.startsWith('ca-')) return 'americas'
    if (region.startsWith('eu-') || region.startsWith('uk-')) return 'europe'
    if (region.startsWith('ap-') || region.startsWith('cn-')) return 'asia'
    if (region.startsWith('sa-')) return 'americas'
    if (region.startsWith('af-')) return 'africa'
    if (region.startsWith('me-')) return 'middle-east'
    return 'unknown'
  }

  // ===========================================================================
  // STRATEGY CREATION
  // ===========================================================================

  /**
   * Create nested loop strategy
   */
  private createNestedLoopStrategy(input: JoinStrategyInput): NestedLoopJoinStrategy {
    const leftStats = this.getTableStats(input.left)
    const rightStats = this.getTableStats(input.right)

    // Outer side should be smaller
    const outerSide = leftStats.rowCount <= rightStats.rowCount ? 'left' : 'right'

    // Check if inner can be streamed
    const leftCaps = input.sourceCapabilities?.[input.left.source]
    const rightCaps = input.sourceCapabilities?.[input.right.source]
    const innerCaps = outerSide === 'left' ? rightCaps : leftCaps
    const streamInner = innerCaps?.canStream ?? true

    return {
      type: 'nested_loop',
      outerSide,
      streamInner,
    }
  }

  /**
   * Create broadcast strategy
   */
  private createBroadcastStrategy(
    input: JoinStrategyInput,
    broadcastSide: 'left' | 'right'
  ): BroadcastJoinStrategy {
    return {
      type: 'broadcast',
      broadcastSide,
    }
  }

  /**
   * Create shuffle strategy
   */
  private createShuffleStrategy(
    input: JoinStrategyInput,
    leftStats: TableStatistics,
    rightStats: TableStatistics
  ): ShuffleJoinStrategy {
    // Calculate optimal partition count based on data size
    const totalBytes = leftStats.sizeBytes + rightStats.sizeBytes
    let partitionCount = Math.ceil(totalBytes / TARGET_PARTITION_BYTES)

    // Clamp to reasonable range
    partitionCount = Math.max(4, Math.min(256, partitionCount))

    // Use distinct counts to optimize if available
    const leftKey = input.on.left.split('.').pop()!
    const rightKey = input.on.right.split('.').pop()!

    const leftDistinct = leftStats.distinctCounts?.[leftKey]
    const rightDistinct = rightStats.distinctCounts?.[rightKey]

    if (leftDistinct !== undefined || rightDistinct !== undefined) {
      // Don't create more partitions than distinct values
      const maxDistinct = Math.max(leftDistinct ?? Infinity, rightDistinct ?? Infinity)
      if (maxDistinct < partitionCount && maxDistinct < Infinity) {
        partitionCount = Math.max(4, Math.ceil(maxDistinct / 2))
      }
    }

    // Use the join key as partition key
    const partitionKey = leftKey

    return {
      type: 'shuffle',
      partitionCount,
      partitionKey,
    }
  }

  /**
   * Create sort-merge strategy
   */
  private createSortMergeStrategy(
    input: JoinStrategyInput,
    leftStats: TableStatistics,
    rightStats: TableStatistics
  ): SortMergeJoinStrategy {
    const leftKey = input.on.left.split('.').pop()!
    const rightKey = input.on.right.split('.').pop()!

    // Get index information
    const leftTableKey = `${input.left.source}.${input.left.table}`
    const rightTableKey = `${input.right.source}.${input.right.table}`
    const leftIndexInfo = input.indexInfo?.[leftTableKey]
    const rightIndexInfo = input.indexInfo?.[rightTableKey]

    // Check if tables are already sorted
    const leftSorted = this.isTableSortedOnColumn(leftIndexInfo, leftKey)
    const rightSorted = this.isTableSortedOnColumn(rightIndexInfo, rightKey)

    // Determine if external sort is needed for large unsorted tables
    const leftNeedsSort = !leftSorted
    const rightNeedsSort = !rightSorted
    const useExternalSort =
      (leftNeedsSort && leftStats.rowCount > 100_000) ||
      (rightNeedsSort && rightStats.rowCount > 100_000)

    return {
      type: 'sort_merge',
      sortKey: leftKey,
      sortDirection: 'ASC',
      leftSorted,
      rightSorted,
      useExternalSort,
    }
  }

  // ===========================================================================
  // COST ESTIMATION
  // ===========================================================================

  /**
   * Estimate cost for broadcast join
   */
  private estimateBroadcastCost(
    input: JoinStrategyInput,
    strategy: BroadcastJoinStrategy,
    leftStats: TableStatistics,
    rightStats: TableStatistics,
    latencyFactor: number
  ): JoinCost {
    // Network cost: broadcast the smaller table
    const broadcastStats = strategy.broadcastSide === 'left' ? leftStats : rightStats
    const probeStats = strategy.broadcastSide === 'left' ? rightStats : leftStats

    // Only broadcast side is transferred
    const networkBytes = broadcastStats.sizeBytes

    // Hash table build: O(broadcast rows)
    // Probe: O(probe rows)
    const comparisons = broadcastStats.rowCount + probeStats.rowCount

    // Total cost = network + compute
    const networkCost = networkBytes * latencyFactor / 1_000_000 // Normalize to MB
    const computeCost = comparisons / 1_000_000 // Normalize
    const totalCost = networkCost + computeCost

    return {
      totalCost,
      networkBytes,
      comparisons,
      networkLatencyFactor: latencyFactor,
      estimatedTimeMs: networkCost * 10 + computeCost * 1, // Rough estimate
    }
  }

  /**
   * Estimate cost for shuffle join
   */
  private estimateShuffleCost(
    input: JoinStrategyInput,
    strategy: ShuffleJoinStrategy,
    leftStats: TableStatistics,
    rightStats: TableStatistics,
    latencyFactor: number
  ): JoinCost {
    // Network cost: shuffle both tables
    // In shuffle, all data must be redistributed across partitions
    // Assume average redistribution factor of 0.75 (some data stays local)
    const redistributionFactor = 0.75
    const networkBytes = (leftStats.sizeBytes + rightStats.sizeBytes) * redistributionFactor

    // Per-partition hash join
    const avgLeftPerPartition = leftStats.rowCount / strategy.partitionCount
    const avgRightPerPartition = rightStats.rowCount / strategy.partitionCount

    // Hash join per partition: O(build + probe)
    const comparisonsPerPartition = avgLeftPerPartition + avgRightPerPartition
    const comparisons = comparisonsPerPartition * strategy.partitionCount

    // Total cost
    const networkCost = networkBytes * latencyFactor / 1_000_000
    const computeCost = comparisons / 1_000_000
    const totalCost = networkCost + computeCost

    return {
      totalCost,
      networkBytes,
      comparisons,
      networkLatencyFactor: latencyFactor,
      estimatedTimeMs: networkCost * 10 + computeCost * 1,
    }
  }

  /**
   * Estimate cost for nested loop join
   */
  private estimateNestedLoopCost(
    input: JoinStrategyInput,
    strategy: NestedLoopJoinStrategy,
    leftStats: TableStatistics,
    rightStats: TableStatistics,
    latencyFactor: number
  ): JoinCost {
    const outerStats = strategy.outerSide === 'left' ? leftStats : rightStats
    const innerStats = strategy.outerSide === 'left' ? rightStats : leftStats

    // Network cost: transfer both tables to join executor
    const networkBytes = leftStats.sizeBytes + rightStats.sizeBytes

    // Nested loop: O(outer * inner) comparisons
    // If using index, reduce comparisons significantly
    let comparisons = outerStats.rowCount * innerStats.rowCount
    if (strategy.useIndex) {
      // With index, comparisons are roughly O(outer * log(inner))
      comparisons = outerStats.rowCount * Math.log2(innerStats.rowCount + 1)
    }

    // Total cost
    const networkCost = networkBytes * latencyFactor / 1_000_000
    const computeCost = comparisons / 1_000_000
    const totalCost = networkCost + computeCost * (strategy.useIndex ? 2 : 10)

    return {
      totalCost,
      networkBytes,
      comparisons,
      networkLatencyFactor: latencyFactor,
      estimatedTimeMs: networkCost * 10 + comparisons / 1000,
    }
  }

  /**
   * Estimate cost for sort-merge join
   */
  private estimateSortMergeCost(
    input: JoinStrategyInput,
    strategy: SortMergeJoinStrategy,
    leftStats: TableStatistics,
    rightStats: TableStatistics,
    latencyFactor: number
  ): JoinCost {
    // Network cost: transfer both tables to join executor
    const networkBytes = leftStats.sizeBytes + rightStats.sizeBytes

    // Sort-merge: O(n log n) for sorting each side + O(n + m) for merge
    // If already sorted, skip the sort cost
    let leftSortCost = 0
    let rightSortCost = 0

    if (!strategy.leftSorted) {
      // O(n log n) sort cost
      leftSortCost = leftStats.rowCount * Math.log2(leftStats.rowCount + 1)
    }
    if (!strategy.rightSorted) {
      rightSortCost = rightStats.rowCount * Math.log2(rightStats.rowCount + 1)
    }

    // Merge cost is linear: O(n + m)
    const mergeCost = leftStats.rowCount + rightStats.rowCount

    // Total comparisons including sort and merge
    const comparisons = leftSortCost + rightSortCost + mergeCost

    // External sort penalty if needed
    const externalSortMultiplier = strategy.useExternalSort ? 2.0 : 1.0

    // Total cost
    const networkCost = networkBytes * latencyFactor / 1_000_000
    const computeCost = (comparisons / 1_000_000) * externalSortMultiplier

    // Sort-merge has moderate cost - between hash join and nested loop
    const totalCost = networkCost + computeCost * 3

    return {
      totalCost,
      networkBytes,
      comparisons,
      networkLatencyFactor: latencyFactor,
      estimatedTimeMs: networkCost * 10 + computeCost * 5,
    }
  }
}
