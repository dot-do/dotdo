/**
 * Parallel Scan Coordination for Query Federation
 *
 * This module provides parallel scan coordination capabilities for splitting
 * large table scans across multiple workers for parallel execution.
 *
 * @see dotdo-f6ccw
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Filter predicate for partition-specific filtering
 */
export interface PartitionFilter {
  column: string
  op: string
  value: unknown
}

/**
 * Defines a partition of work for parallel scanning
 */
export interface ScanPartition {
  /** Unique identifier for this partition */
  id: string
  /** Row offset to start scanning from */
  offset: number
  /** Maximum number of rows to scan */
  limit: number
  /** Optional partition-specific filter */
  filter?: PartitionFilter

  // Range partitioning fields
  /** Start value for range partitioning (inclusive) */
  rangeStart?: number
  /** End value for range partitioning (exclusive, except last partition) */
  rangeEnd?: number
  /** Column used for range partitioning */
  rangeColumn?: string

  // Hash partitioning fields
  /** Hash bucket number (0-indexed) */
  hashBucket?: number
  /** Total number of hash buckets */
  totalBuckets?: number
  /** Column used for hash partitioning */
  hashColumn?: string
}

/**
 * Partition strategy type
 */
export type PartitionStrategy = 'offset' | 'range' | 'hash' | 'round-robin'

/**
 * Column statistics for partition planning
 */
export interface ColumnStats {
  min: number
  max: number
  distinct: number
  sorted?: boolean
}

/**
 * Table metadata for partition planning
 */
export interface TableMetadata {
  tableName: string
  rowCount: number
  avgRowSize: number
  columnStats?: Record<string, ColumnStats>
}

/**
 * Options for partitioning a table
 */
export interface PartitionOptions {
  partitionCount: number
  strategy?: PartitionStrategy
  rangeColumn?: string
  hashColumn?: string
}

/**
 * Order specification for scan results
 */
export interface OrderSpec {
  column: string
  direction: 'ASC' | 'DESC'
}

/**
 * Options for creating a scan plan
 */
export interface ScanPlanOptions {
  tableName: string
  columns: string[]
  globalFilter?: PartitionFilter
  orderBy?: OrderSpec
}

/**
 * Execution plan for parallel scanning
 */
export interface ScanPlan {
  tableName: string
  columns: string[]
  partitions: ScanPartition[]
  parallelism: number
  estimatedCost: number
  estimatedRows: number
  globalFilter?: PartitionFilter
  orderBy?: OrderSpec
  mergeStrategy: 'append' | 'ordered'
}

/**
 * Result from a single partition scan
 */
export interface PartitionResult {
  partitionId: string
  rows: Record<string, unknown>[]
  rowCount: number
  scanTimeMs?: number
  bytesScanned?: number
}

/**
 * Options for merging scan results
 */
export interface MergeOptions {
  strategy?: 'append' | 'ordered'
  orderBy?: OrderSpec
  limit?: number
  deduplicate?: boolean
  deduplicateKey?: string
}

/**
 * Statistics from merged scan results
 */
export interface MergeStats {
  totalBytesScanned: number
  maxPartitionTime: number
  partitionsCompleted: number
}

/**
 * Merged scan result
 */
export interface MergedResult {
  rows: Record<string, unknown>[]
  totalRowCount: number
  hasMore?: boolean
  duplicatesRemoved?: number
  stats: MergeStats
}

/**
 * Options for estimating partition count
 */
export interface EstimateOptions {
  maxWorkers?: number
  maxMemoryPerWorker?: number
  scanThroughputBytesPerSec?: number
  rangeColumn?: string
  hashColumn?: string
}

/**
 * Partition estimation result
 */
export interface PartitionEstimate {
  partitionCount: number
  recommendedStrategy: PartitionStrategy
  estimatedMemoryPerPartition: number
  estimatedScanTimeMs: number
  estimatedParallelScanTimeMs: number
  reason: string
}

// =============================================================================
// Constants
// =============================================================================

/** Minimum rows to consider parallelization */
const MIN_ROWS_FOR_PARALLEL = 1000

/** Default rows per partition */
const DEFAULT_ROWS_PER_PARTITION = 10000

/** Maximum partitions */
const MAX_PARTITIONS = 64

/** Default scan throughput (bytes/sec) for estimation */
const DEFAULT_SCAN_THROUGHPUT = 50 * 1024 * 1024 // 50MB/s

/** Default memory per worker */
const DEFAULT_MEMORY_PER_WORKER = 128 * 1024 * 1024 // 128MB

// =============================================================================
// ParallelScanCoordinator Class
// =============================================================================

/**
 * Coordinator for parallel table scans
 */
export class ParallelScanCoordinator {
  /**
   * Split a table into partitions based on row count and strategy
   */
  partitionTable(metadata: TableMetadata, options: PartitionOptions): ScanPartition[] {
    const { rowCount } = metadata
    const { partitionCount, strategy = 'offset' } = options

    // Handle empty or very small tables
    if (rowCount === 0) {
      return [this.createPartition(0, 0, 0)]
    }

    if (rowCount < MIN_ROWS_FOR_PARALLEL) {
      return [this.createPartition(0, 0, rowCount)]
    }

    // Select strategy
    switch (strategy) {
      case 'range':
        return this.createRangePartitions(metadata, options)
      case 'hash':
        return this.createHashPartitions(metadata, options)
      case 'round-robin':
        return this.createRoundRobinPartitions(metadata, options)
      default:
        return this.createOffsetPartitions(metadata, options)
    }
  }

  /**
   * Create execution plan with parallel workers
   */
  createScanPlan(partitions: ScanPartition[], options: ScanPlanOptions): ScanPlan {
    const { tableName, columns, globalFilter, orderBy } = options

    const estimatedRows = partitions.reduce((sum, p) => sum + p.limit, 0)
    const estimatedCost = this.calculatePlanCost(partitions, estimatedRows)

    return {
      tableName,
      columns,
      partitions,
      parallelism: partitions.length,
      estimatedCost,
      estimatedRows,
      globalFilter,
      orderBy,
      mergeStrategy: orderBy ? 'ordered' : 'append',
    }
  }

  /**
   * Combine results from multiple partitions
   */
  mergeScanResults(results: PartitionResult[], options: MergeOptions = {}): MergedResult {
    const { strategy = 'append', orderBy, limit, deduplicate = false, deduplicateKey } = options

    // Collect statistics
    const stats = this.collectMergeStats(results)

    if (results.length === 0) {
      return {
        rows: [],
        totalRowCount: 0,
        stats,
      }
    }

    // Combine all rows
    let allRows = results.flatMap(r => r.rows)
    let duplicatesRemoved = 0

    // Deduplicate if requested
    if (deduplicate && deduplicateKey) {
      const seen = new Set<unknown>()
      const uniqueRows: Record<string, unknown>[] = []
      for (const row of allRows) {
        const key = row[deduplicateKey]
        if (!seen.has(key)) {
          seen.add(key)
          uniqueRows.push(row)
        } else {
          duplicatesRemoved++
        }
      }
      allRows = uniqueRows
    }

    // Sort if ordered merge
    if (strategy === 'ordered' && orderBy) {
      allRows = this.sortRows(allRows, orderBy)
    }

    // Apply limit
    let hasMore = false
    if (limit !== undefined && allRows.length > limit) {
      allRows = allRows.slice(0, limit)
      hasMore = true
    }

    return {
      rows: allRows,
      totalRowCount: allRows.length,
      hasMore,
      duplicatesRemoved: duplicatesRemoved > 0 ? duplicatesRemoved : undefined,
      stats,
    }
  }

  /**
   * Estimate optimal partition count based on table characteristics
   */
  estimatePartitions(metadata: TableMetadata, options: EstimateOptions = {}): PartitionEstimate {
    const {
      maxWorkers = 16,
      maxMemoryPerWorker = DEFAULT_MEMORY_PER_WORKER,
      scanThroughputBytesPerSec = DEFAULT_SCAN_THROUGHPUT,
      rangeColumn,
      hashColumn,
    } = options

    const { rowCount, avgRowSize, columnStats } = metadata

    // Small tables - single partition
    if (rowCount < MIN_ROWS_FOR_PARALLEL) {
      return {
        partitionCount: 1,
        recommendedStrategy: 'offset',
        estimatedMemoryPerPartition: rowCount * avgRowSize,
        estimatedScanTimeMs: this.calculateScanTime(rowCount, avgRowSize, scanThroughputBytesPerSec),
        estimatedParallelScanTimeMs: this.calculateScanTime(rowCount, avgRowSize, scanThroughputBytesPerSec),
        reason: 'Table too small for parallel scanning',
      }
    }

    // Calculate total data size
    const totalDataSize = rowCount * avgRowSize

    // Determine partition count based on memory constraints
    const memoryBasedPartitions = Math.ceil(totalDataSize / maxMemoryPerWorker)

    // Determine partition count based on row count
    const rowBasedPartitions = Math.ceil(rowCount / DEFAULT_ROWS_PER_PARTITION)

    // Use the higher of the two, but cap at max workers and MAX_PARTITIONS
    let partitionCount = Math.max(memoryBasedPartitions, rowBasedPartitions)
    partitionCount = Math.min(partitionCount, maxWorkers, MAX_PARTITIONS)
    partitionCount = Math.max(partitionCount, 1)

    // Determine recommended strategy
    const recommendedStrategy = this.recommendStrategy(columnStats, rangeColumn, hashColumn)

    // Calculate timing estimates
    const sequentialScanTime = this.calculateScanTime(rowCount, avgRowSize, scanThroughputBytesPerSec)
    const parallelScanTime = sequentialScanTime / partitionCount

    return {
      partitionCount,
      recommendedStrategy,
      estimatedMemoryPerPartition: totalDataSize / partitionCount,
      estimatedScanTimeMs: sequentialScanTime,
      estimatedParallelScanTimeMs: parallelScanTime,
      reason: `Optimal partition count for ${rowCount} rows`,
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private createPartition(index: number, offset: number, limit: number): ScanPartition {
    return {
      id: `partition-${index}`,
      offset,
      limit,
    }
  }

  private createOffsetPartitions(metadata: TableMetadata, options: PartitionOptions): ScanPartition[] {
    const { rowCount } = metadata
    const { partitionCount } = options

    const effectivePartitionCount = Math.min(partitionCount, rowCount)
    const baseSize = Math.floor(rowCount / effectivePartitionCount)
    const remainder = rowCount % effectivePartitionCount

    const partitions: ScanPartition[] = []
    let currentOffset = 0

    for (let i = 0; i < effectivePartitionCount; i++) {
      // Distribute remainder across first partitions
      const extraRow = i < remainder ? 1 : 0
      const partitionLimit = baseSize + extraRow

      partitions.push(this.createPartition(i, currentOffset, partitionLimit))
      currentOffset += partitionLimit
    }

    return partitions
  }

  private createRangePartitions(metadata: TableMetadata, options: PartitionOptions): ScanPartition[] {
    const { rowCount, columnStats } = metadata
    const { partitionCount, rangeColumn } = options

    // If no column stats, fall back to offset partitioning
    if (!columnStats || !rangeColumn || !columnStats[rangeColumn]) {
      return this.createOffsetPartitions(metadata, options)
    }

    const stats = columnStats[rangeColumn]
    const rangeSize = stats.max - stats.min
    const partitionRangeSize = rangeSize / partitionCount

    const partitions: ScanPartition[] = []
    const rowsPerPartition = Math.ceil(rowCount / partitionCount)

    for (let i = 0; i < partitionCount; i++) {
      const rangeStart = stats.min + i * partitionRangeSize
      const rangeEnd = i === partitionCount - 1 ? stats.max : stats.min + (i + 1) * partitionRangeSize

      partitions.push({
        id: `partition-${i}`,
        offset: i * rowsPerPartition,
        limit: rowsPerPartition,
        rangeStart,
        rangeEnd,
        rangeColumn,
      })
    }

    return partitions
  }

  private createHashPartitions(metadata: TableMetadata, options: PartitionOptions): ScanPartition[] {
    const { rowCount } = metadata
    const { partitionCount, hashColumn } = options

    const rowsPerPartition = Math.ceil(rowCount / partitionCount)
    const partitions: ScanPartition[] = []

    for (let i = 0; i < partitionCount; i++) {
      partitions.push({
        id: `partition-${i}`,
        offset: 0, // Hash partitions don't use offset
        limit: rowsPerPartition,
        hashBucket: i,
        totalBuckets: partitionCount,
        hashColumn: hashColumn || 'id',
      })
    }

    return partitions
  }

  private createRoundRobinPartitions(metadata: TableMetadata, options: PartitionOptions): ScanPartition[] {
    const { rowCount } = metadata
    const { partitionCount } = options

    const rowsPerPartition = Math.floor(rowCount / partitionCount)
    const partitions: ScanPartition[] = []

    for (let i = 0; i < partitionCount; i++) {
      partitions.push({
        id: `partition-${i}`,
        offset: i * rowsPerPartition,
        limit: rowsPerPartition,
      })
    }

    return partitions
  }

  private calculatePlanCost(partitions: ScanPartition[], estimatedRows: number): number {
    // Base cost is proportional to row count
    const baseCost = estimatedRows * 0.01

    // Add overhead for coordination
    const coordinationCost = partitions.length * 10

    return baseCost + coordinationCost
  }

  private collectMergeStats(results: PartitionResult[]): MergeStats {
    let totalBytesScanned = 0
    let maxPartitionTime = 0

    for (const result of results) {
      if (result.bytesScanned) {
        totalBytesScanned += result.bytesScanned
      }
      if (result.scanTimeMs && result.scanTimeMs > maxPartitionTime) {
        maxPartitionTime = result.scanTimeMs
      }
    }

    return {
      totalBytesScanned,
      maxPartitionTime,
      partitionsCompleted: results.length,
    }
  }

  private sortRows(rows: Record<string, unknown>[], orderBy: OrderSpec): Record<string, unknown>[] {
    const { column, direction } = orderBy
    const multiplier = direction === 'ASC' ? 1 : -1

    return [...rows].sort((a, b) => {
      const aVal = a[column]
      const bVal = b[column]

      if (aVal === bVal) return 0
      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * multiplier
      }

      return String(aVal).localeCompare(String(bVal)) * multiplier
    })
  }

  private calculateScanTime(rowCount: number, avgRowSize: number, throughput: number): number {
    const totalBytes = rowCount * avgRowSize
    return (totalBytes / throughput) * 1000 // Convert to ms
  }

  private recommendStrategy(
    columnStats?: Record<string, ColumnStats>,
    rangeColumn?: string,
    hashColumn?: string
  ): PartitionStrategy {
    // If range column specified and has stats, prefer range
    if (rangeColumn && columnStats?.[rangeColumn]) {
      const stats = columnStats[rangeColumn]
      // If column is sorted, range is definitely best
      if (stats.sorted) {
        return 'range'
      }
      // If high cardinality, range is good
      if (stats.distinct > 1000) {
        return 'range'
      }
    }

    // If hash column specified and has high cardinality, prefer hash
    if (hashColumn && columnStats?.[hashColumn]) {
      const stats = columnStats[hashColumn]
      if (stats.distinct > 1000) {
        return 'hash'
      }
    }

    // Default to offset-based partitioning
    return 'offset'
  }
}
