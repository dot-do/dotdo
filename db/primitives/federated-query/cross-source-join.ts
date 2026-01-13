/**
 * Cross-Source Join Execution
 *
 * High-level cross-source join executor that coordinates joins across
 * heterogeneous data sources with support for:
 * - Multiple join strategies (broadcast, shuffle, nested loop)
 * - Data type conversions between sources
 * - Streaming for large datasets
 * - Predicate pushdown optimization
 * - Memory-efficient execution
 * - Multi-way joins (chained)
 *
 * @see dotdo-pc225
 * @module db/primitives/federated-query/cross-source-join
 */

import type {
  Catalog,
  SourceAdapter,
  QueryFragment,
  QueryPredicate,
} from './index'

import {
  CrossSourceJoinExecutor,
  type JoinConfig,
  type JoinExecutionOptions,
  type JoinType,
  type JoinStrategy,
  type JoinExecutionStats,
  type StreamingJoinBatch,
} from './join-executor'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Table reference for cross-source join
 */
export interface CrossSourceTableRef {
  source: string
  table: string
  alias?: string
}

/**
 * Join key specification
 */
export interface CrossSourceJoinKey {
  left: string
  right: string
}

/**
 * Type conversion rule for cross-source joins
 */
export interface TypeConversionRule {
  /** Column to convert */
  column: string
  /** Source type */
  from: 'string' | 'number' | 'boolean' | 'integer' | 'timestamp' | 'date' | 'json'
  /** Target type */
  to: 'string' | 'number' | 'boolean' | 'integer' | 'timestamp' | 'date' | 'json'
  /** Optional format for date/timestamp conversions */
  format?: string
}

/**
 * Column specification with optional alias
 */
export interface ColumnSpec {
  column: string
  alias?: string
}

/**
 * Chained join definition for multi-way joins
 */
export interface ChainedJoin {
  source: string
  table: string
  joinType: JoinType
  keys: CrossSourceJoinKey
  predicates?: QueryPredicate[]
}

/**
 * Cross-source join configuration
 */
export interface CrossSourceJoinConfig {
  /** Left side table */
  left: CrossSourceTableRef
  /** Right side table */
  right: CrossSourceTableRef
  /** Join type */
  joinType: JoinType
  /** Join keys */
  keys: CrossSourceJoinKey
  /** Type conversion rules */
  typeConversions?: TypeConversionRule[]
  /** Predicates to push to left source */
  leftPredicates?: QueryPredicate[]
  /** Predicates to push to right source */
  rightPredicates?: QueryPredicate[]
  /** Force specific join strategy */
  forceStrategy?: JoinStrategy
  /** Additional chained joins for multi-way joins */
  chainedJoins?: ChainedJoin[]
  /** Columns to project (or column specs with aliases) */
  columns?: (string | ColumnSpec)[]
  /** Timeout in milliseconds */
  timeout?: number
  /** Maximum retry attempts */
  maxRetries?: number
  /** Collect execution statistics */
  collectStats?: boolean
}

/**
 * Cross-source join execution result
 */
export interface CrossSourceJoinResult {
  rows: Record<string, unknown>[]
  stats?: CrossSourceJoinStats
  batchIndex?: number
  isComplete?: boolean
}

/**
 * Join execution statistics
 */
export interface CrossSourceJoinStats {
  strategy: JoinStrategy
  leftRowsScanned: number
  rightRowsScanned: number
  outputRows: number
  executionTimeMs: number
  retriesAttempted: number
  memoryUsedBytes: number
  partitionsUsed?: number
}

/**
 * Streaming options for cross-source joins
 */
export interface StreamingOptions {
  batchSize?: number
  maxMemoryBytes?: number
}

// =============================================================================
// DATA TYPE CONVERTER
// =============================================================================

/**
 * DataTypeConverter - Handles type conversions between heterogeneous sources
 *
 * Supports conversions between common data types to enable joins across
 * sources with different type representations.
 */
export class DataTypeConverter {
  private customRules: TypeConversionRule[] = []

  /**
   * Register a custom conversion rule
   */
  registerRule(rule: TypeConversionRule & { convert: (value: unknown) => unknown }): void {
    this.customRules.push(rule)
  }

  /**
   * Convert a value from one type to another
   */
  convert(
    value: unknown,
    from: string,
    to: string,
    options?: { format?: string }
  ): unknown {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return null
    }

    // Check for custom rules first
    for (const rule of this.customRules as Array<TypeConversionRule & { convert?: (value: unknown) => unknown }>) {
      if (rule.from === from && rule.to === to && rule.convert) {
        return rule.convert(value)
      }
    }

    // Built-in conversions
    switch (`${from}->${to}`) {
      // String to numeric
      case 'string->number':
      case 'string->integer': {
        const num = parseFloat(String(value))
        if (isNaN(num)) return null
        return to === 'integer' ? Math.floor(num) : num
      }

      // Numeric to string
      case 'number->string':
      case 'integer->string':
        return String(value)

      // String to boolean
      case 'string->boolean': {
        const str = String(value).toLowerCase()
        if (str === 'true' || str === '1' || str === 'yes') return true
        if (str === 'false' || str === '0' || str === 'no') return false
        return null
      }

      // Number to boolean
      case 'number->boolean':
      case 'integer->boolean':
        return value !== 0

      // Boolean to string
      case 'boolean->string':
        return String(value)

      // Boolean to number
      case 'boolean->number':
      case 'boolean->integer':
        return value ? 1 : 0

      // Timestamp to date
      case 'timestamp->date': {
        const dateStr = String(value)
        const date = new Date(dateStr)
        if (isNaN(date.getTime())) return null

        const format = options?.format || 'YYYY-MM-DD'
        return this.formatDate(date, format)
      }

      // Date to timestamp
      case 'date->timestamp': {
        const dateStr = String(value)
        // Simple date string parsing
        const date = new Date(dateStr)
        if (isNaN(date.getTime())) return null
        return date.toISOString()
      }

      // JSON handling
      case 'string->json':
        try {
          return JSON.parse(String(value))
        } catch {
          return null
        }

      case 'json->string':
        return JSON.stringify(value)

      // Same type - no conversion needed
      default:
        if (from === to) return value
        // Fall back to string representation
        return String(value)
    }
  }

  /**
   * Apply conversions to a row
   */
  applyConversions(
    row: Record<string, unknown>,
    conversions: TypeConversionRule[]
  ): Record<string, unknown> {
    const result = { ...row }

    for (const conv of conversions) {
      if (conv.column in result) {
        result[conv.column] = this.convert(
          result[conv.column],
          conv.from,
          conv.to,
          { format: conv.format }
        )
      }
    }

    return result
  }

  /**
   * Format date according to pattern
   */
  private formatDate(date: Date, format: string): string {
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    const hours = String(date.getUTCHours()).padStart(2, '0')
    const minutes = String(date.getUTCMinutes()).padStart(2, '0')
    const seconds = String(date.getUTCSeconds()).padStart(2, '0')

    return format
      .replace('YYYY', String(year))
      .replace('MM', month)
      .replace('DD', day)
      .replace('HH', hours)
      .replace('mm', minutes)
      .replace('ss', seconds)
  }
}

// =============================================================================
// CROSS-SOURCE JOIN CLASS
// =============================================================================

/**
 * CrossSourceJoin - High-level cross-source join executor
 *
 * Provides a user-friendly interface for executing joins across different
 * data sources with automatic strategy selection, type conversions,
 * and streaming support.
 */
export class CrossSourceJoin {
  private converter: DataTypeConverter
  private defaultOptions = {
    timeout: 30000,
    maxRetries: 3,
    batchSize: 1000,
    maxMemoryBytes: 100 * 1024 * 1024, // 100MB
  }

  constructor(private catalog: Catalog) {
    this.converter = new DataTypeConverter()
  }

  /**
   * Execute a cross-source join
   */
  async execute(config: CrossSourceJoinConfig): Promise<CrossSourceJoinResult> {
    const startTime = performance.now()
    const timeout = config.timeout ?? this.defaultOptions.timeout
    const maxRetries = config.maxRetries ?? this.defaultOptions.maxRetries

    // Get adapters for both sources
    const leftAdapter = this.catalog.getAdapter(config.left.source)
    const rightAdapter = this.catalog.getAdapter(config.right.source)

    if (!leftAdapter) {
      throw new Error(`No adapter for source: ${config.left.source}`)
    }
    if (!rightAdapter) {
      throw new Error(`No adapter for source: ${config.right.source}`)
    }

    // Build query fragments with predicate pushdown
    const leftFragment = this.buildQueryFragment(
      config.left.table,
      config.leftPredicates,
      config.columns,
      config.keys.left
    )
    const rightFragment = this.buildQueryFragment(
      config.right.table,
      config.rightPredicates,
      config.columns,
      config.keys.right
    )

    // Fetch data from both sources (with retry and timeout)
    const [leftRows, rightRows] = await Promise.all([
      this.fetchWithRetryAndTimeout(leftAdapter, leftFragment, maxRetries, timeout, config.left.source),
      this.fetchWithRetryAndTimeout(rightAdapter, rightFragment, maxRetries, timeout, config.right.source),
    ])

    // Apply type conversions if specified
    const convertedLeftRows = config.typeConversions
      ? leftRows.map(row => this.converter.applyConversions(row, config.typeConversions!))
      : leftRows

    // Select join strategy
    const strategy = config.forceStrategy ?? this.selectStrategy(leftRows.length, rightRows.length)

    // Execute the join
    let result = this.executeJoin(
      convertedLeftRows,
      rightRows,
      config.keys,
      config.joinType,
      strategy
    )

    // Execute chained joins if any
    if (config.chainedJoins && config.chainedJoins.length > 0) {
      result = await this.executeChainedJoins(result, config.chainedJoins, timeout, maxRetries)
    }

    // Apply column projection
    if (config.columns) {
      result = this.projectColumns(result, config.columns)
    }

    const executionTimeMs = performance.now() - startTime

    const stats: CrossSourceJoinStats | undefined = config.collectStats !== false
      ? {
          strategy,
          leftRowsScanned: leftRows.length,
          rightRowsScanned: rightRows.length,
          outputRows: result.length,
          executionTimeMs,
          retriesAttempted: 0,
          memoryUsedBytes: this.estimateMemory(result),
        }
      : undefined

    return { rows: result, stats }
  }

  /**
   * Stream join results in batches
   */
  async *stream(
    config: CrossSourceJoinConfig,
    options: StreamingOptions = {}
  ): AsyncGenerator<CrossSourceJoinResult> {
    const batchSize = options.batchSize ?? this.defaultOptions.batchSize
    const timeout = config.timeout ?? this.defaultOptions.timeout
    const maxRetries = config.maxRetries ?? this.defaultOptions.maxRetries

    // Get adapters
    const leftAdapter = this.catalog.getAdapter(config.left.source)
    const rightAdapter = this.catalog.getAdapter(config.right.source)

    if (!leftAdapter) {
      throw new Error(`No adapter for source: ${config.left.source}`)
    }
    if (!rightAdapter) {
      throw new Error(`No adapter for source: ${config.right.source}`)
    }

    // Build query fragments
    const leftFragment = this.buildQueryFragment(
      config.left.table,
      config.leftPredicates,
      config.columns,
      config.keys.left
    )
    const rightFragment = this.buildQueryFragment(
      config.right.table,
      config.rightPredicates,
      config.columns,
      config.keys.right
    )

    // Fetch data
    const [leftRows, rightRows] = await Promise.all([
      this.fetchWithRetryAndTimeout(leftAdapter, leftFragment, maxRetries, timeout, config.left.source),
      this.fetchWithRetryAndTimeout(rightAdapter, rightFragment, maxRetries, timeout, config.right.source),
    ])

    // Apply type conversions
    const convertedLeftRows = config.typeConversions
      ? leftRows.map(row => this.converter.applyConversions(row, config.typeConversions!))
      : leftRows

    // Select strategy
    const strategy = config.forceStrategy ?? this.selectStrategy(leftRows.length, rightRows.length)

    // Execute join and stream results
    const allResults = this.executeJoin(
      convertedLeftRows,
      rightRows,
      config.keys,
      config.joinType,
      strategy
    )

    // Apply projections to all results first
    const projectedResults = config.columns
      ? this.projectColumns(allResults, config.columns)
      : allResults

    // Stream in batches
    let batchIndex = 0
    for (let i = 0; i < projectedResults.length; i += batchSize) {
      const batch = projectedResults.slice(i, i + batchSize)
      const isComplete = i + batchSize >= projectedResults.length

      yield {
        rows: batch,
        batchIndex,
        isComplete,
        stats: isComplete && config.collectStats !== false
          ? {
              strategy,
              leftRowsScanned: leftRows.length,
              rightRowsScanned: rightRows.length,
              outputRows: projectedResults.length,
              executionTimeMs: 0,
              retriesAttempted: 0,
              memoryUsedBytes: this.estimateMemory(projectedResults),
            }
          : undefined,
      }

      batchIndex++
    }

    // Handle empty result set
    if (projectedResults.length === 0) {
      yield {
        rows: [],
        batchIndex: 0,
        isComplete: true,
        stats: config.collectStats !== false
          ? {
              strategy,
              leftRowsScanned: leftRows.length,
              rightRowsScanned: rightRows.length,
              outputRows: 0,
              executionTimeMs: 0,
              retriesAttempted: 0,
              memoryUsedBytes: 0,
            }
          : undefined,
      }
    }
  }

  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  /**
   * Build query fragment for a source
   */
  private buildQueryFragment(
    table: string,
    predicates?: QueryPredicate[],
    columns?: (string | ColumnSpec)[],
    joinKey?: string
  ): QueryFragment {
    const fragment: QueryFragment = { table }

    if (predicates && predicates.length > 0) {
      fragment.predicates = predicates
    }

    // Ensure join key is always included in projection
    if (columns) {
      const cols = columns.map(c => typeof c === 'string' ? c : c.column)

      // Add join key if not already included
      if (joinKey) {
        const keyColumn = joinKey.includes('.') ? joinKey.split('.').pop()! : joinKey
        if (!cols.includes(keyColumn)) {
          cols.push(keyColumn)
        }
      }

      // Filter to columns that might belong to this table
      // (simple heuristic - unqualified columns or columns prefixed with table name)
      fragment.columns = cols.filter(c => !c.includes('.') || c.startsWith(table + '.'))
        .map(c => c.includes('.') ? c.split('.').pop()! : c)
    }

    return fragment
  }

  /**
   * Fetch data with retry and timeout
   */
  private async fetchWithRetryAndTimeout(
    adapter: SourceAdapter,
    fragment: QueryFragment,
    maxRetries: number,
    timeout: number,
    sourceName: string
  ): Promise<Record<string, unknown>[]> {
    let lastError: Error | undefined
    let attempts = 0

    while (attempts < maxRetries) {
      try {
        const result = await this.withTimeout(
          adapter.execute(fragment),
          timeout,
          `Query to ${sourceName} timed out`
        )
        return result.rows
      } catch (error) {
        lastError = error as Error
        attempts++

        if (attempts < maxRetries) {
          // Exponential backoff
          const delay = 100 * Math.pow(2, attempts - 1)
          await this.sleep(delay)
        }
      }
    }

    throw new Error(
      `Failed to fetch from ${sourceName} after ${maxRetries} attempts: ${lastError?.message}`
    )
  }

  /**
   * Execute with timeout
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
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Select optimal join strategy based on row counts
   */
  private selectStrategy(leftCount: number, rightCount: number): JoinStrategy {
    const smaller = Math.min(leftCount, rightCount)
    const larger = Math.max(leftCount, rightCount)

    // Very small tables - use nested loop
    if (smaller < 100 && larger < 1000) {
      return 'nested_loop'
    }

    // One small table - use broadcast
    if (smaller < 10000) {
      return 'broadcast'
    }

    // Both large - use shuffle
    return 'shuffle'
  }

  /**
   * Execute join using selected strategy
   */
  private executeJoin(
    leftRows: Record<string, unknown>[],
    rightRows: Record<string, unknown>[],
    keys: CrossSourceJoinKey,
    joinType: JoinType,
    strategy: JoinStrategy
  ): Record<string, unknown>[] {
    const leftKey = this.extractColumnName(keys.left)
    const rightKey = this.extractColumnName(keys.right)

    switch (strategy) {
      case 'broadcast':
        return this.executeBroadcastJoin(leftRows, rightRows, leftKey, rightKey, joinType)
      case 'shuffle':
        return this.executeShuffleJoin(leftRows, rightRows, leftKey, rightKey, joinType)
      case 'nested_loop':
      default:
        return this.executeNestedLoopJoin(leftRows, rightRows, leftKey, rightKey, joinType)
    }
  }

  /**
   * Execute broadcast join
   */
  private executeBroadcastJoin(
    leftRows: Record<string, unknown>[],
    rightRows: Record<string, unknown>[],
    leftKey: string,
    rightKey: string,
    joinType: JoinType
  ): Record<string, unknown>[] {
    // Determine build side (smaller table)
    const leftIsBuildSide = leftRows.length <= rightRows.length
    const buildRows = leftIsBuildSide ? leftRows : rightRows
    const probeRows = leftIsBuildSide ? rightRows : leftRows
    const buildKey = leftIsBuildSide ? leftKey : rightKey
    const probeKey = leftIsBuildSide ? rightKey : leftKey

    // Build hash table
    const hashTable = new Map<unknown, Record<string, unknown>[]>()
    for (const row of buildRows) {
      const key = row[buildKey]
      const existing = hashTable.get(key)
      if (existing) {
        existing.push(row)
      } else {
        hashTable.set(key, [row])
      }
    }

    // Probe and join
    return this.probeHashTable(
      probeRows,
      hashTable,
      probeKey,
      joinType,
      leftIsBuildSide,
      buildRows[0] || {}
    )
  }

  /**
   * Execute shuffle join (hash partitioning)
   */
  private executeShuffleJoin(
    leftRows: Record<string, unknown>[],
    rightRows: Record<string, unknown>[],
    leftKey: string,
    rightKey: string,
    joinType: JoinType
  ): Record<string, unknown>[] {
    const numPartitions = 8

    // Create partitions
    const partitions = Array.from({ length: numPartitions }, () => ({
      left: [] as Record<string, unknown>[],
      right: [] as Record<string, unknown>[],
    }))

    // Hash partition both sides
    for (const row of leftRows) {
      const partitionId = this.hashPartition(row[leftKey], numPartitions)
      partitions[partitionId]!.left.push(row)
    }

    for (const row of rightRows) {
      const partitionId = this.hashPartition(row[rightKey], numPartitions)
      partitions[partitionId]!.right.push(row)
    }

    // Join each partition
    const results: Record<string, unknown>[] = []
    for (const partition of partitions) {
      const partitionResult = this.executeBroadcastJoin(
        partition.left,
        partition.right,
        leftKey,
        rightKey,
        joinType
      )
      results.push(...partitionResult)
    }

    return results
  }

  /**
   * Execute nested loop join
   */
  private executeNestedLoopJoin(
    leftRows: Record<string, unknown>[],
    rightRows: Record<string, unknown>[],
    leftKey: string,
    rightKey: string,
    joinType: JoinType
  ): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = []
    const matchedRight = new Set<number>()

    for (const leftRow of leftRows) {
      const leftValue = leftRow[leftKey]
      let hasMatch = false

      for (let i = 0; i < rightRows.length; i++) {
        const rightRow = rightRows[i]!
        const rightValue = rightRow[rightKey]

        if (leftValue === rightValue) {
          hasMatch = true
          matchedRight.add(i)
          results.push({ ...leftRow, ...rightRow })
        }
      }

      // Handle non-matching left rows for LEFT/FULL joins
      if (!hasMatch && (joinType === 'LEFT' || joinType === 'FULL')) {
        const nullRight = this.createNullRow(rightRows[0] || {})
        results.push({ ...leftRow, ...nullRight })
      }
    }

    // Handle non-matching right rows for RIGHT/FULL joins
    if (joinType === 'RIGHT' || joinType === 'FULL') {
      for (let i = 0; i < rightRows.length; i++) {
        if (!matchedRight.has(i)) {
          const rightRow = rightRows[i]!
          const nullLeft = this.createNullRow(leftRows[0] || {})
          results.push({ ...nullLeft, ...rightRow })
        }
      }
    }

    return results
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
          // Left side columns first
          const merged = buildIsLeft
            ? { ...buildRow, ...probeRow }
            : { ...probeRow, ...buildRow }
          results.push(merged)
        }
      } else if (this.shouldIncludeNonMatchingProbe(joinType, buildIsLeft)) {
        const nullBuild = this.createNullRow(sampleBuildRow)
        const merged = buildIsLeft
          ? { ...nullBuild, ...probeRow }
          : { ...probeRow, ...nullBuild }
        results.push(merged)
      }
    }

    // Handle non-matching build rows
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
   * Execute chained joins for multi-way joins
   */
  private async executeChainedJoins(
    currentResult: Record<string, unknown>[],
    chainedJoins: ChainedJoin[],
    timeout: number,
    maxRetries: number
  ): Promise<Record<string, unknown>[]> {
    let result = currentResult

    for (const chain of chainedJoins) {
      const adapter = this.catalog.getAdapter(chain.source)
      if (!adapter) {
        throw new Error(`No adapter for source: ${chain.source}`)
      }

      const fragment = this.buildQueryFragment(chain.table, chain.predicates, undefined, chain.keys.right)
      const chainRows = await this.fetchWithRetryAndTimeout(
        adapter,
        fragment,
        maxRetries,
        timeout,
        chain.source
      )

      const leftKey = this.extractColumnName(chain.keys.left)
      const rightKey = this.extractColumnName(chain.keys.right)

      result = this.executeNestedLoopJoin(
        result,
        chainRows,
        leftKey,
        rightKey,
        chain.joinType
      )
    }

    return result
  }

  /**
   * Project columns with optional aliasing
   */
  private projectColumns(
    rows: Record<string, unknown>[],
    columns: (string | ColumnSpec)[]
  ): Record<string, unknown>[] {
    return rows.map(row => {
      const projected: Record<string, unknown> = {}

      for (const col of columns) {
        if (typeof col === 'string') {
          const colName = col.includes('.') ? col.split('.').pop()! : col
          if (colName in row) {
            projected[colName] = row[colName]
          }
        } else {
          const colName = col.column.includes('.') ? col.column.split('.').pop()! : col.column
          const alias = col.alias || colName
          if (colName in row) {
            projected[alias] = row[colName]
          }
        }
      }

      return projected
    })
  }

  /**
   * Extract column name from potentially qualified name
   */
  private extractColumnName(qualifiedName: string): string {
    const parts = qualifiedName.split('.')
    return parts[parts.length - 1]!
  }

  /**
   * Create null row from sample
   */
  private createNullRow(sample: Record<string, unknown>): Record<string, unknown> {
    const nullRow: Record<string, unknown> = {}
    for (const key of Object.keys(sample)) {
      nullRow[key] = null
    }
    return nullRow
  }

  /**
   * Hash partition for shuffle join
   */
  private hashPartition(value: unknown, numPartitions: number): number {
    const hash = this.hashValue(value)
    return Math.abs(hash) % numPartitions
  }

  /**
   * Simple hash function
   */
  private hashValue(value: unknown): number {
    if (value === null || value === undefined) return 0

    const str = String(value)
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    return hash
  }

  /**
   * Estimate memory usage
   */
  private estimateMemory(rows: Record<string, unknown>[]): number {
    let bytes = rows.length * 100 // overhead per row

    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (typeof value === 'string') {
          bytes += value.length * 2
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
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a CrossSourceJoin instance
 */
export function createCrossSourceJoin(catalog: Catalog): CrossSourceJoin {
  return new CrossSourceJoin(catalog)
}
