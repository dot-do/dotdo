/**
 * Cross-Source Join Executor
 *
 * Executes joins across different data sources with support for:
 * - Broadcast joins (small table materialized and sent to all partitions)
 * - Shuffle joins (hash partitioning for large-to-large joins)
 * - Nested loop joins (streaming for very small outer tables)
 * - Retry logic and graceful error handling
 *
 * @see dotdo-pc225
 * @module db/primitives/federated-query/join-executor
 */

import type {
  SourceAdapter,
  QueryFragment,
  QueryPredicate,
} from './index'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Join type enumeration
 */
export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'

/**
 * Join strategy enumeration
 */
export type JoinStrategy = 'broadcast' | 'shuffle' | 'nested_loop' | 'sort_merge'

/**
 * Join key specification
 */
export interface JoinKey {
  left: string
  right: string
}

/**
 * Join configuration
 */
export interface JoinConfig {
  type: JoinType
  strategy: JoinStrategy
  keys: JoinKey
  leftSource: string
  rightSource: string
  leftTable: string
  rightTable: string
}

/**
 * Source data provider interface
 */
export interface SourceDataProvider {
  getAdapter(source: string): SourceAdapter | undefined
}

/**
 * Temporary result set for intermediate join results
 */
export interface TempResultSet {
  id: string
  rows: Record<string, unknown>[]
  memoryBytes: number
  createdAt: number
  expiresAt: number
}

/**
 * Sort-merge join configuration
 */
export interface SortMergeConfig {
  /** Sort key for the join (defaults to join key) */
  sortKey?: string
  /** Sort direction */
  sortDirection?: 'ASC' | 'DESC'
  /** Whether left side is already sorted */
  leftSorted?: boolean
  /** Whether right side is already sorted */
  rightSorted?: boolean
  /** Whether to use external sort for large datasets */
  useExternalSort?: boolean
  /** External sort memory limit in bytes */
  externalSortMemoryLimit?: number
}

/**
 * Join execution options
 */
export interface JoinExecutionOptions {
  /** Batch size for streaming operations */
  batchSize?: number
  /** Maximum memory for temporary result sets (in bytes) */
  maxMemoryBytes?: number
  /** Maximum retry attempts for failed operations */
  maxRetries?: number
  /** Retry delay in milliseconds */
  retryDelayMs?: number
  /** Timeout for individual source queries (ms) */
  queryTimeoutMs?: number
  /** Number of partitions for shuffle joins */
  shufflePartitions?: number
  /** Broadcast threshold - tables smaller than this (rows) use broadcast */
  broadcastThreshold?: number
  /** Sort-merge join configuration */
  sortMergeConfig?: SortMergeConfig
}

/**
 * Join execution result
 */
export interface JoinExecutionResult {
  rows: Record<string, unknown>[]
  stats: JoinExecutionStats
}

/**
 * Join execution statistics
 */
export interface JoinExecutionStats {
  strategy: JoinStrategy
  leftRowsScanned: number
  rightRowsScanned: number
  outputRows: number
  executionTimeMs: number
  retriesAttempted: number
  memoryUsedBytes: number
  partitionsUsed?: number
  /** Whether external sort was used for sort-merge join */
  usedExternalSort?: boolean
  /** Sort time in ms (for sort-merge join) */
  sortTimeMs?: number
  /** Merge time in ms (for sort-merge join) */
  mergeTimeMs?: number
}

/**
 * Streaming join result batch
 */
export interface StreamingJoinBatch {
  rows: Record<string, unknown>[]
  batchIndex: number
  isLast: boolean
  stats?: Partial<JoinExecutionStats>
}

/**
 * Partition for shuffle joins
 */
interface ShufflePartition {
  id: number
  leftRows: Record<string, unknown>[]
  rightRows: Record<string, unknown>[]
}

/**
 * Retry state tracking
 */
interface RetryState {
  attempts: number
  lastError?: Error
  lastAttemptAt?: number
}

// =============================================================================
// CROSS-SOURCE JOIN EXECUTOR
// =============================================================================

/**
 * CrossSourceJoinExecutor - Executes joins across different data sources
 *
 * Supports three join strategies:
 * 1. Broadcast - Materializes small table and broadcasts to all workers
 * 2. Shuffle - Hash-partitions both sides for parallel join execution
 * 3. Nested Loop - Streams outer table and probes inner for each row
 */
export class CrossSourceJoinExecutor {
  private tempResults: Map<string, TempResultSet> = new Map()
  private totalMemoryUsed = 0

  private readonly defaultOptions: Required<JoinExecutionOptions> = {
    batchSize: 1000,
    maxMemoryBytes: 100 * 1024 * 1024, // 100MB
    maxRetries: 3,
    retryDelayMs: 100,
    queryTimeoutMs: 30000,
    shufflePartitions: 8,
    broadcastThreshold: 10000,
    sortMergeConfig: {
      sortDirection: 'ASC',
      leftSorted: false,
      rightSorted: false,
      useExternalSort: false,
      externalSortMemoryLimit: 50 * 1024 * 1024, // 50MB
    },
  }

  constructor(
    private provider: SourceDataProvider,
    private options: JoinExecutionOptions = {}
  ) {
    this.options = { ...this.defaultOptions, ...options }
  }

  /**
   * Execute a cross-source join
   */
  async execute(
    config: JoinConfig,
    leftFragment: QueryFragment,
    rightFragment: QueryFragment,
    options: JoinExecutionOptions = {}
  ): Promise<JoinExecutionResult> {
    const opts = { ...this.defaultOptions, ...this.options, ...options }
    const startTime = performance.now()
    let retriesAttempted = 0

    const stats: JoinExecutionStats = {
      strategy: config.strategy,
      leftRowsScanned: 0,
      rightRowsScanned: 0,
      outputRows: 0,
      executionTimeMs: 0,
      retriesAttempted: 0,
      memoryUsedBytes: 0,
    }

    try {
      let result: Record<string, unknown>[]

      switch (config.strategy) {
        case 'broadcast':
          result = await this.executeBroadcastJoin(
            config,
            leftFragment,
            rightFragment,
            opts,
            stats
          )
          break

        case 'shuffle':
          result = await this.executeShuffleJoin(
            config,
            leftFragment,
            rightFragment,
            opts,
            stats
          )
          break

        case 'nested_loop':
          result = await this.executeNestedLoopJoin(
            config,
            leftFragment,
            rightFragment,
            opts,
            stats
          )
          break

        case 'sort_merge':
          result = await this.executeSortMergeJoin(
            config,
            leftFragment,
            rightFragment,
            opts,
            stats
          )
          break

        default:
          throw new Error(`Unknown join strategy: ${config.strategy}`)
      }

      stats.outputRows = result.length
      stats.executionTimeMs = performance.now() - startTime
      stats.retriesAttempted = retriesAttempted

      return { rows: result, stats }
    } finally {
      // Cleanup temporary result sets
      this.cleanupExpiredResults()
    }
  }

  /**
   * Stream join results for large result sets
   */
  async *stream(
    config: JoinConfig,
    leftFragment: QueryFragment,
    rightFragment: QueryFragment,
    options: JoinExecutionOptions = {}
  ): AsyncGenerator<StreamingJoinBatch, void, unknown> {
    const opts = { ...this.defaultOptions, ...this.options, ...options }
    const batchSize = opts.batchSize

    // For streaming, we use nested loop strategy by default
    // as it naturally supports streaming output
    if (config.strategy === 'nested_loop') {
      yield* this.streamNestedLoopJoin(
        config,
        leftFragment,
        rightFragment,
        opts
      )
    } else {
      // For other strategies, execute fully and batch the output
      const result = await this.execute(
        config,
        leftFragment,
        rightFragment,
        opts
      )

      for (let i = 0; i < result.rows.length; i += batchSize) {
        const batch = result.rows.slice(i, i + batchSize)
        const isLast = i + batchSize >= result.rows.length

        yield {
          rows: batch,
          batchIndex: Math.floor(i / batchSize),
          isLast,
          stats: isLast ? result.stats : undefined,
        }
      }
    }
  }

  /**
   * Select optimal join strategy based on table statistics
   */
  selectStrategy(
    leftRowCount: number,
    rightRowCount: number,
    options: JoinExecutionOptions = {}
  ): JoinStrategy {
    const opts = { ...this.defaultOptions, ...this.options, ...options }
    const threshold = opts.broadcastThreshold

    // If either side is very small, use broadcast
    if (leftRowCount < threshold || rightRowCount < threshold) {
      // If one side is tiny (< 100), use nested loop
      if (leftRowCount < 100 || rightRowCount < 100) {
        return 'nested_loop'
      }
      return 'broadcast'
    }

    // For large-to-large joins, use shuffle
    return 'shuffle'
  }

  // =============================================================================
  // BROADCAST JOIN IMPLEMENTATION
  // =============================================================================

  /**
   * Execute broadcast join
   *
   * Strategy:
   * 1. Fetch and materialize the smaller table completely
   * 2. Build a hash table on the join key
   * 3. Stream the larger table and probe the hash table
   */
  private async executeBroadcastJoin(
    config: JoinConfig,
    leftFragment: QueryFragment,
    rightFragment: QueryFragment,
    opts: Required<JoinExecutionOptions>,
    stats: JoinExecutionStats
  ): Promise<Record<string, unknown>[]> {
    const leftAdapter = this.provider.getAdapter(config.leftSource)
    const rightAdapter = this.provider.getAdapter(config.rightSource)

    if (!leftAdapter) {
      throw new Error(`No adapter for source: ${config.leftSource}`)
    }
    if (!rightAdapter) {
      throw new Error(`No adapter for source: ${config.rightSource}`)
    }

    // Fetch both sides with retry
    const [leftRows, rightRows] = await Promise.all([
      this.fetchWithRetry(leftAdapter, leftFragment, opts, config.leftSource),
      this.fetchWithRetry(rightAdapter, rightFragment, opts, config.rightSource),
    ])

    stats.leftRowsScanned = leftRows.length
    stats.rightRowsScanned = rightRows.length

    // Determine build side (smaller table)
    const leftIsBuildSide = leftRows.length <= rightRows.length
    const buildRows = leftIsBuildSide ? leftRows : rightRows
    const probeRows = leftIsBuildSide ? rightRows : leftRows
    const buildKey = leftIsBuildSide
      ? this.extractColumnName(config.keys.left)
      : this.extractColumnName(config.keys.right)
    const probeKey = leftIsBuildSide
      ? this.extractColumnName(config.keys.right)
      : this.extractColumnName(config.keys.left)

    // Store materialized table in temp result set
    const tempId = this.storeTempResult(buildRows, opts.maxMemoryBytes)
    stats.memoryUsedBytes = this.estimateMemory(buildRows)

    try {
      // Build hash table
      const hashTable = this.buildHashTable(buildRows, buildKey)

      // Probe and join
      return this.probeHashTable(
        probeRows,
        hashTable,
        probeKey,
        config.type,
        leftIsBuildSide,
        buildRows[0] || {}
      )
    } finally {
      // Cleanup temp result
      this.deleteTempResult(tempId)
    }
  }

  // =============================================================================
  // SHUFFLE JOIN IMPLEMENTATION
  // =============================================================================

  /**
   * Execute shuffle join
   *
   * Strategy:
   * 1. Hash-partition both tables by join key
   * 2. Process each partition pair independently
   * 3. Combine results from all partitions
   */
  private async executeShuffleJoin(
    config: JoinConfig,
    leftFragment: QueryFragment,
    rightFragment: QueryFragment,
    opts: Required<JoinExecutionOptions>,
    stats: JoinExecutionStats
  ): Promise<Record<string, unknown>[]> {
    const leftAdapter = this.provider.getAdapter(config.leftSource)
    const rightAdapter = this.provider.getAdapter(config.rightSource)

    if (!leftAdapter) {
      throw new Error(`No adapter for source: ${config.leftSource}`)
    }
    if (!rightAdapter) {
      throw new Error(`No adapter for source: ${config.rightSource}`)
    }

    const numPartitions = opts.shufflePartitions
    stats.partitionsUsed = numPartitions

    // Fetch both sides
    const [leftRows, rightRows] = await Promise.all([
      this.fetchWithRetry(leftAdapter, leftFragment, opts, config.leftSource),
      this.fetchWithRetry(rightAdapter, rightFragment, opts, config.rightSource),
    ])

    stats.leftRowsScanned = leftRows.length
    stats.rightRowsScanned = rightRows.length

    const leftKey = this.extractColumnName(config.keys.left)
    const rightKey = this.extractColumnName(config.keys.right)

    // Partition both sides
    const partitions = this.createPartitions(
      leftRows,
      rightRows,
      leftKey,
      rightKey,
      numPartitions
    )

    // Track memory usage
    stats.memoryUsedBytes = this.estimateMemory(leftRows) + this.estimateMemory(rightRows)

    // Process partitions (can be parallelized)
    const results: Record<string, unknown>[][] = await Promise.all(
      partitions.map((partition) =>
        this.processPartition(partition, leftKey, rightKey, config.type)
      )
    )

    return results.flat()
  }

  /**
   * Create hash partitions for shuffle join
   */
  private createPartitions(
    leftRows: Record<string, unknown>[],
    rightRows: Record<string, unknown>[],
    leftKey: string,
    rightKey: string,
    numPartitions: number
  ): ShufflePartition[] {
    const partitions: ShufflePartition[] = Array.from(
      { length: numPartitions },
      (_, i) => ({
        id: i,
        leftRows: [],
        rightRows: [],
      })
    )

    // Partition left rows
    for (const row of leftRows) {
      const partitionId = this.hashPartition(row[leftKey], numPartitions)
      partitions[partitionId]!.leftRows.push(row)
    }

    // Partition right rows
    for (const row of rightRows) {
      const partitionId = this.hashPartition(row[rightKey], numPartitions)
      partitions[partitionId]!.rightRows.push(row)
    }

    return partitions
  }

  /**
   * Process a single partition for shuffle join
   */
  private async processPartition(
    partition: ShufflePartition,
    leftKey: string,
    rightKey: string,
    joinType: JoinType
  ): Promise<Record<string, unknown>[]> {
    // Build hash table on smaller side
    const leftIsBuildSide = partition.leftRows.length <= partition.rightRows.length
    const buildRows = leftIsBuildSide ? partition.leftRows : partition.rightRows
    const probeRows = leftIsBuildSide ? partition.rightRows : partition.leftRows
    const buildKeyName = leftIsBuildSide ? leftKey : rightKey
    const probeKeyName = leftIsBuildSide ? rightKey : leftKey

    const hashTable = this.buildHashTable(buildRows, buildKeyName)

    return this.probeHashTable(
      probeRows,
      hashTable,
      probeKeyName,
      joinType,
      leftIsBuildSide,
      buildRows[0] || {}
    )
  }

  /**
   * Compute hash partition for a value
   */
  private hashPartition(value: unknown, numPartitions: number): number {
    const hash = this.hashValue(value)
    return Math.abs(hash) % numPartitions
  }

  /**
   * Simple hash function for partition assignment
   */
  private hashValue(value: unknown): number {
    if (value === null || value === undefined) return 0

    const str = String(value)
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return hash
  }

  // =============================================================================
  // NESTED LOOP JOIN IMPLEMENTATION
  // =============================================================================

  /**
   * Execute nested loop join
   *
   * Strategy:
   * 1. Stream the outer table (typically smaller)
   * 2. For each outer row, scan the inner table for matches
   * 3. Optimized for very small outer tables
   */
  private async executeNestedLoopJoin(
    config: JoinConfig,
    leftFragment: QueryFragment,
    rightFragment: QueryFragment,
    opts: Required<JoinExecutionOptions>,
    stats: JoinExecutionStats
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = []

    for await (const batch of this.streamNestedLoopJoin(
      config,
      leftFragment,
      rightFragment,
      opts
    )) {
      results.push(...batch.rows)

      if (batch.stats) {
        stats.leftRowsScanned = batch.stats.leftRowsScanned ?? 0
        stats.rightRowsScanned = batch.stats.rightRowsScanned ?? 0
        stats.memoryUsedBytes = batch.stats.memoryUsedBytes ?? 0
      }
    }

    return results
  }

  /**
   * Stream nested loop join results
   */
  private async *streamNestedLoopJoin(
    config: JoinConfig,
    leftFragment: QueryFragment,
    rightFragment: QueryFragment,
    opts: Required<JoinExecutionOptions>
  ): AsyncGenerator<StreamingJoinBatch, void, unknown> {
    const leftAdapter = this.provider.getAdapter(config.leftSource)
    const rightAdapter = this.provider.getAdapter(config.rightSource)

    if (!leftAdapter) {
      throw new Error(`No adapter for source: ${config.leftSource}`)
    }
    if (!rightAdapter) {
      throw new Error(`No adapter for source: ${config.rightSource}`)
    }

    const leftKey = this.extractColumnName(config.keys.left)
    const rightKey = this.extractColumnName(config.keys.right)

    // For nested loop, we need to decide which side is outer
    // Fetch both to determine sizes (in real impl, would use stats)
    const [leftRows, rightRows] = await Promise.all([
      this.fetchWithRetry(leftAdapter, leftFragment, opts, config.leftSource),
      this.fetchWithRetry(rightAdapter, rightFragment, opts, config.rightSource),
    ])

    // Smaller side becomes outer
    const leftIsOuter = leftRows.length <= rightRows.length
    const outerRows = leftIsOuter ? leftRows : rightRows
    const innerRows = leftIsOuter ? rightRows : leftRows
    const outerKey = leftIsOuter ? leftKey : rightKey
    const innerKey = leftIsOuter ? rightKey : leftKey

    let batchIndex = 0
    let currentBatch: Record<string, unknown>[] = []
    const leftRowsScanned = leftRows.length
    const rightRowsScanned = rightRows.length

    // Track matched outer rows for FULL/LEFT/RIGHT joins
    const matchedOuter = new Set<number>()
    const matchedInner = new Set<number>()

    // Stream through outer rows
    for (let outerIdx = 0; outerIdx < outerRows.length; outerIdx++) {
      const outerRow = outerRows[outerIdx]!
      const outerValue = outerRow[outerKey]
      let hasMatch = false

      // Scan inner for matches
      for (let innerIdx = 0; innerIdx < innerRows.length; innerIdx++) {
        const innerRow = innerRows[innerIdx]!
        const innerValue = innerRow[innerKey]

        if (outerValue === innerValue) {
          hasMatch = true
          matchedOuter.add(outerIdx)
          matchedInner.add(innerIdx)

          // Merge rows (outer columns first, then inner)
          const merged = leftIsOuter
            ? { ...outerRow, ...innerRow }
            : { ...innerRow, ...outerRow }

          currentBatch.push(merged)

          if (currentBatch.length >= opts.batchSize) {
            yield {
              rows: currentBatch,
              batchIndex: batchIndex++,
              isLast: false,
            }
            currentBatch = []
          }
        }
      }

      // Handle non-matching outer rows for LEFT/FULL joins
      if (!hasMatch && this.shouldIncludeNonMatchingOuter(config.type, leftIsOuter)) {
        const nullInner = this.createNullRow(innerRows[0] || {})
        const merged = leftIsOuter
          ? { ...outerRow, ...nullInner }
          : { ...nullInner, ...outerRow }
        currentBatch.push(merged)
      }
    }

    // Handle non-matching inner rows for RIGHT/FULL joins
    if (this.shouldIncludeNonMatchingInner(config.type, leftIsOuter)) {
      for (let innerIdx = 0; innerIdx < innerRows.length; innerIdx++) {
        if (!matchedInner.has(innerIdx)) {
          const innerRow = innerRows[innerIdx]!
          const nullOuter = this.createNullRow(outerRows[0] || {})
          const merged = leftIsOuter
            ? { ...nullOuter, ...innerRow }
            : { ...innerRow, ...nullOuter }
          currentBatch.push(merged)
        }
      }
    }

    // Emit final batch
    if (currentBatch.length > 0 || batchIndex === 0) {
      yield {
        rows: currentBatch,
        batchIndex: batchIndex,
        isLast: true,
        stats: {
          strategy: 'nested_loop',
          leftRowsScanned,
          rightRowsScanned,
          memoryUsedBytes: this.estimateMemory(outerRows) + this.estimateMemory(innerRows),
        },
      }
    }
  }

  /**
   * Check if non-matching outer rows should be included
   */
  private shouldIncludeNonMatchingOuter(joinType: JoinType, leftIsOuter: boolean): boolean {
    if (joinType === 'FULL') return true
    if (joinType === 'LEFT' && leftIsOuter) return true
    if (joinType === 'RIGHT' && !leftIsOuter) return true
    return false
  }

  /**
   * Check if non-matching inner rows should be included
   */
  private shouldIncludeNonMatchingInner(joinType: JoinType, leftIsOuter: boolean): boolean {
    if (joinType === 'FULL') return true
    if (joinType === 'RIGHT' && leftIsOuter) return true
    if (joinType === 'LEFT' && !leftIsOuter) return true
    return false
  }

  // =============================================================================
  // HELPER METHODS
  // =============================================================================

  /**
   * Fetch data from adapter with retry logic
   */
  private async fetchWithRetry(
    adapter: SourceAdapter,
    fragment: QueryFragment,
    opts: Required<JoinExecutionOptions>,
    sourceName: string
  ): Promise<Record<string, unknown>[]> {
    let lastError: Error | undefined
    let attempts = 0

    while (attempts < opts.maxRetries) {
      try {
        const result = await this.withTimeout(
          adapter.execute(fragment),
          opts.queryTimeoutMs,
          `Query to ${sourceName} timed out`
        )
        return result.rows
      } catch (error) {
        lastError = error as Error
        attempts++

        if (attempts < opts.maxRetries) {
          // Exponential backoff
          const delay = opts.retryDelayMs * Math.pow(2, attempts - 1)
          await this.sleep(delay)
        }
      }
    }

    throw new Error(
      `Failed to fetch from ${sourceName} after ${opts.maxRetries} attempts: ${lastError?.message}`
    )
  }

  /**
   * Execute promise with timeout
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
    })

    try {
      return await Promise.race([promise, timeoutPromise])
    } finally {
      clearTimeout(timeoutId!)
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Build hash table from rows
   */
  private buildHashTable(
    rows: Record<string, unknown>[],
    keyColumn: string
  ): Map<unknown, Record<string, unknown>[]> {
    const hashTable = new Map<unknown, Record<string, unknown>[]>()

    for (const row of rows) {
      const key = row[keyColumn]
      const existing = hashTable.get(key)

      if (existing) {
        existing.push(row)
      } else {
        hashTable.set(key, [row])
      }
    }

    return hashTable
  }

  /**
   * Probe hash table and produce join results
   */
  private probeHashTable(
    probeRows: Record<string, unknown>[],
    hashTable: Map<unknown, Record<string, unknown>[]>,
    probeKey: string,
    joinType: JoinType,
    buildIsLeft: boolean,
    sampleBuildRow: Record<string, unknown>
  ): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = []
    const matchedBuildKeys = new Set<unknown>()

    for (const probeRow of probeRows) {
      const key = probeRow[probeKey]
      const matches = hashTable.get(key)

      if (matches) {
        for (const buildRow of matches) {
          matchedBuildKeys.add(key)
          // Merge: left side columns first, then right
          const merged = buildIsLeft
            ? { ...buildRow, ...probeRow }
            : { ...probeRow, ...buildRow }
          results.push(merged)
        }
      } else if (this.shouldIncludeNonMatchingProbe(joinType, buildIsLeft)) {
        // Non-matching probe row for LEFT/RIGHT/FULL joins
        const nullBuild = this.createNullRow(sampleBuildRow)
        const merged = buildIsLeft
          ? { ...nullBuild, ...probeRow }
          : { ...probeRow, ...nullBuild }
        results.push(merged)
      }
    }

    // Handle non-matching build rows for FULL/RIGHT joins
    if (this.shouldIncludeNonMatchingBuild(joinType, buildIsLeft)) {
      for (const [key, buildRows] of hashTable) {
        if (!matchedBuildKeys.has(key)) {
          for (const buildRow of buildRows) {
            const nullProbe = this.createNullRow(probeRows[0] || {})
            const merged = buildIsLeft
              ? { ...buildRow, ...nullProbe }
              : { ...nullProbe, ...buildRow }
            results.push(merged)
          }
        }
      }
    }

    return results
  }

  /**
   * Check if non-matching probe rows should be included
   */
  private shouldIncludeNonMatchingProbe(joinType: JoinType, buildIsLeft: boolean): boolean {
    if (joinType === 'FULL') return true
    if (joinType === 'LEFT' && !buildIsLeft) return true
    if (joinType === 'RIGHT' && buildIsLeft) return true
    return false
  }

  /**
   * Check if non-matching build rows should be included
   */
  private shouldIncludeNonMatchingBuild(joinType: JoinType, buildIsLeft: boolean): boolean {
    if (joinType === 'FULL') return true
    if (joinType === 'LEFT' && buildIsLeft) return true
    if (joinType === 'RIGHT' && !buildIsLeft) return true
    return false
  }

  /**
   * Create a null row from a sample row
   */
  private createNullRow(sample: Record<string, unknown>): Record<string, unknown> {
    const nullRow: Record<string, unknown> = {}
    for (const key of Object.keys(sample)) {
      nullRow[key] = null
    }
    return nullRow
  }

  /**
   * Extract column name from potentially qualified name (table.column)
   */
  private extractColumnName(qualifiedName: string): string {
    const parts = qualifiedName.split('.')
    return parts[parts.length - 1]!
  }

  /**
   * Estimate memory usage of rows
   */
  private estimateMemory(rows: Record<string, unknown>[]): number {
    // Rough estimate: 100 bytes overhead per row + sum of value sizes
    let bytes = rows.length * 100

    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (typeof value === 'string') {
          bytes += value.length * 2 // UTF-16
        } else if (typeof value === 'number') {
          bytes += 8
        } else if (typeof value === 'boolean') {
          bytes += 4
        } else if (value === null || value === undefined) {
          bytes += 4
        } else {
          bytes += JSON.stringify(value).length * 2
        }
      }
    }

    return bytes
  }

  // =============================================================================
  // TEMPORARY RESULT SET MANAGEMENT
  // =============================================================================

  /**
   * Store rows in temporary result set
   */
  private storeTempResult(
    rows: Record<string, unknown>[],
    maxMemory: number
  ): string {
    const id = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const memoryBytes = this.estimateMemory(rows)

    // Check memory limits
    if (this.totalMemoryUsed + memoryBytes > maxMemory) {
      // Try to free up space by cleaning expired results
      this.cleanupExpiredResults()

      if (this.totalMemoryUsed + memoryBytes > maxMemory) {
        throw new Error(
          `Memory limit exceeded: cannot store ${memoryBytes} bytes, ` +
            `current usage: ${this.totalMemoryUsed}, limit: ${maxMemory}`
        )
      }
    }

    const result: TempResultSet = {
      id,
      rows,
      memoryBytes,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000, // 1 minute expiry
    }

    this.tempResults.set(id, result)
    this.totalMemoryUsed += memoryBytes

    return id
  }

  /**
   * Delete temporary result set
   */
  private deleteTempResult(id: string): void {
    const result = this.tempResults.get(id)
    if (result) {
      this.totalMemoryUsed -= result.memoryBytes
      this.tempResults.delete(id)
    }
  }

  /**
   * Cleanup expired temporary result sets
   */
  private cleanupExpiredResults(): void {
    const now = Date.now()
    for (const [id, result] of this.tempResults) {
      if (result.expiresAt < now) {
        this.totalMemoryUsed -= result.memoryBytes
        this.tempResults.delete(id)
      }
    }
  }

  /**
   * Get current memory usage
   */
  getMemoryUsage(): { used: number; tempSets: number } {
    return {
      used: this.totalMemoryUsed,
      tempSets: this.tempResults.size,
    }
  }

  /**
   * Clear all temporary results
   */
  clearTempResults(): void {
    this.tempResults.clear()
    this.totalMemoryUsed = 0
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a cross-source join executor
 */
export function createJoinExecutor(
  provider: SourceDataProvider,
  options?: JoinExecutionOptions
): CrossSourceJoinExecutor {
  return new CrossSourceJoinExecutor(provider, options)
}
