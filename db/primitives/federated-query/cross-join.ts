/**
 * Cross-Source Join Execution
 *
 * Implements cross-source join execution that can join data from different
 * data sources (e.g., SQLite + DuckDB + external API) with:
 * - Data type conversions between sources
 * - Streaming results for large datasets
 * - Predicate pushdown where possible
 * - Multiple join strategies (broadcast, shuffle, nested loop)
 *
 * @see dotdo-pc225
 * @module db/primitives/federated-query/cross-join
 */

import type {
  SourceAdapter,
  QueryFragment,
  QueryPredicate,
  Catalog,
} from './index'

import {
  CrossSourceJoinExecutor,
  type JoinConfig,
  type JoinExecutionOptions,
  type JoinStrategy,
  type JoinType,
  type JoinExecutionStats,
} from './join-executor'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Column type for type conversions
 */
export type ColumnType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'json'

/**
 * Type conversion rule
 */
export interface TypeConversionRule {
  /** Column to convert */
  column: string
  /** Source type */
  from: ColumnType
  /** Target type */
  to: ColumnType
  /** Optional format string for date/timestamp conversions */
  format?: string
}

/**
 * Custom conversion rule definition
 */
export interface CustomConversionRule {
  from: ColumnType
  to: ColumnType
  convert: (value: unknown, options?: { format?: string }) => unknown
}

/**
 * Table reference for cross-source join
 */
export interface CrossSourceTableRef {
  source: string
  table: string
  alias?: string
}

/**
 * Chained join definition for multi-way joins
 */
export interface ChainedJoin {
  source: string
  table: string
  joinType: JoinType
  keys: { left: string; right: string }
  predicates?: QueryPredicate[]
}

/**
 * Column specification with optional alias
 */
export type ColumnSpec = string | { column: string; alias: string }

/**
 * Cross-source join configuration
 */
export interface CrossSourceJoinConfig {
  /** Left source table */
  left: CrossSourceTableRef
  /** Right source table */
  right: CrossSourceTableRef
  /** Join type */
  joinType: JoinType
  /** Join keys */
  keys: { left: string; right: string }
  /** Type conversion rules */
  typeConversions?: TypeConversionRule[]
  /** Predicates to push to left source */
  leftPredicates?: QueryPredicate[]
  /** Predicates to push to right source */
  rightPredicates?: QueryPredicate[]
  /** Force a specific join strategy */
  forceStrategy?: JoinStrategy
  /** Timeout in milliseconds */
  timeout?: number
  /** Maximum retry attempts */
  maxRetries?: number
  /** Collect execution statistics */
  collectStats?: boolean
  /** Chained joins for multi-way join */
  chainedJoins?: ChainedJoin[]
  /** Output columns to project */
  columns?: ColumnSpec[]
}

/**
 * Cross-source join execution statistics
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
 * Cross-source join result
 */
export interface CrossSourceJoinResult {
  rows: Record<string, unknown>[]
  stats?: CrossSourceJoinStats
  batchIndex?: number
  isComplete?: boolean
}

/**
 * Streaming options
 */
export interface StreamOptions {
  batchSize?: number
  maxMemoryBytes?: number
}

// =============================================================================
// DATA TYPE CONVERTER
// =============================================================================

/**
 * DataTypeConverter - Handles data type conversions between heterogeneous sources
 */
export class DataTypeConverter {
  private customRules: Map<string, CustomConversionRule> = new Map()

  /**
   * Register a custom conversion rule
   */
  registerRule(rule: CustomConversionRule): void {
    const key = `${rule.from}:${rule.to}`
    this.customRules.set(key, rule)
  }

  /**
   * Convert a value from one type to another
   */
  convert(
    value: unknown,
    from: ColumnType,
    to: ColumnType,
    options?: { format?: string }
  ): unknown {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return null
    }

    // Same type, no conversion needed
    if (from === to) {
      return value
    }

    // Check for custom rule first
    const customKey = `${from}:${to}`
    const customRule = this.customRules.get(customKey)
    if (customRule) {
      return customRule.convert(value, options)
    }

    // Built-in conversions
    return this.defaultConvert(value, from, to, options)
  }

  /**
   * Default type conversion logic
   */
  private defaultConvert(
    value: unknown,
    from: ColumnType,
    to: ColumnType,
    options?: { format?: string }
  ): unknown {
    // String conversions
    if (to === 'string') {
      return String(value)
    }

    // Integer conversions
    if (to === 'integer') {
      if (typeof value === 'string') {
        return parseInt(value, 10)
      }
      if (typeof value === 'number') {
        return Math.floor(value)
      }
      if (typeof value === 'boolean') {
        return value ? 1 : 0
      }
      return parseInt(String(value), 10)
    }

    // Number conversions
    if (to === 'number') {
      if (typeof value === 'string') {
        return parseFloat(value)
      }
      if (typeof value === 'boolean') {
        return value ? 1 : 0
      }
      return Number(value)
    }

    // Boolean conversions
    if (to === 'boolean') {
      if (typeof value === 'string') {
        const lower = value.toLowerCase()
        return lower === 'true' || lower === '1' || lower === 'yes'
      }
      if (typeof value === 'number') {
        return value !== 0
      }
      return Boolean(value)
    }

    // Date conversions
    if (to === 'date') {
      if (typeof value === 'string') {
        // Extract date part from ISO timestamp
        const dateMatch = value.match(/^(\d{4}-\d{2}-\d{2})/)
        if (dateMatch) {
          return dateMatch[1]
        }
        return value
      }
      if (value instanceof Date) {
        return value.toISOString().split('T')[0]
      }
      return String(value)
    }

    // Timestamp conversions
    if (to === 'timestamp') {
      if (typeof value === 'string') {
        // If it's already an ISO timestamp, return as-is
        if (value.includes('T')) {
          return value
        }
        // Convert date to timestamp
        return `${value}T00:00:00.000Z`
      }
      if (value instanceof Date) {
        return value.toISOString()
      }
      return String(value)
    }

    // JSON conversions
    if (to === 'json') {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value)
        } catch {
          return value
        }
      }
      return value
    }

    // Default: return as-is
    return value
  }

  /**
   * Apply type conversions to a row
   */
  convertRow(
    row: Record<string, unknown>,
    rules: TypeConversionRule[]
  ): Record<string, unknown> {
    const converted = { ...row }

    for (const rule of rules) {
      if (rule.column in converted) {
        converted[rule.column] = this.convert(
          converted[rule.column],
          rule.from,
          rule.to,
          { format: rule.format }
        )
      }
    }

    return converted
  }
}

// =============================================================================
// CROSS-SOURCE JOIN
// =============================================================================

/**
 * CrossSourceJoin - High-level interface for cross-source join execution
 *
 * Features:
 * - Joins across heterogeneous data sources
 * - Automatic data type conversions
 * - Streaming results for large datasets
 * - Predicate pushdown to sources
 * - Multiple join strategies
 */
export class CrossSourceJoin {
  private converter: DataTypeConverter
  private executor: CrossSourceJoinExecutor

  constructor(private catalog: Catalog) {
    this.converter = new DataTypeConverter()
    this.executor = new CrossSourceJoinExecutor(
      {
        getAdapter: (source: string) => catalog.getAdapter(source),
      },
      {}
    )
  }

  /**
   * Execute a cross-source join
   */
  async execute(config: CrossSourceJoinConfig): Promise<CrossSourceJoinResult> {
    const startTime = performance.now()
    let retriesAttempted = 0

    // Validate sources
    const leftAdapter = this.catalog.getAdapter(config.left.source)
    const rightAdapter = this.catalog.getAdapter(config.right.source)

    if (!leftAdapter) {
      throw new Error(`No adapter for source: ${config.left.source}`)
    }
    if (!rightAdapter) {
      throw new Error(`No adapter for source: ${config.right.source}`)
    }

    // Build query fragments with predicates
    const leftFragment = this.buildFragment(
      config.left.table,
      config.leftPredicates
    )
    const rightFragment = this.buildFragment(
      config.right.table,
      config.rightPredicates
    )

    // Fetch data from both sources
    const [leftResult, rightResult] = await Promise.all([
      this.fetchWithTimeout(
        leftAdapter,
        leftFragment,
        config.timeout,
        config.maxRetries,
        config.left.source
      ),
      this.fetchWithTimeout(
        rightAdapter,
        rightFragment,
        config.timeout,
        config.maxRetries,
        config.right.source
      ),
    ]).catch((error) => {
      retriesAttempted++
      throw error
    })

    // Apply type conversions if specified
    let leftRows = leftResult.rows
    let rightRows = rightResult.rows

    if (config.typeConversions) {
      leftRows = leftRows.map((row) =>
        this.converter.convertRow(row, config.typeConversions!)
      )
      rightRows = rightRows.map((row) =>
        this.converter.convertRow(row, config.typeConversions!)
      )
    }

    // Select join strategy
    const strategy =
      config.forceStrategy ||
      this.selectStrategy(leftRows.length, rightRows.length)

    // Execute join
    const joinConfig: JoinConfig = {
      type: config.joinType,
      strategy,
      keys: config.keys,
      leftSource: config.left.source,
      rightSource: config.right.source,
      leftTable: config.left.table,
      rightTable: config.right.table,
    }

    const joinResult = await this.executeJoin(
      joinConfig,
      leftRows,
      rightRows,
      config.keys
    )

    // Handle chained joins
    let resultRows = joinResult

    if (config.chainedJoins && config.chainedJoins.length > 0) {
      resultRows = await this.executeChainedJoins(
        resultRows,
        config.chainedJoins,
        config.typeConversions
      )
    }

    // Apply column projection
    if (config.columns) {
      resultRows = this.projectColumns(resultRows, config.columns)
    }

    const endTime = performance.now()

    const result: CrossSourceJoinResult = {
      rows: resultRows,
    }

    if (config.collectStats !== false) {
      result.stats = {
        strategy,
        leftRowsScanned: leftRows.length,
        rightRowsScanned: rightRows.length,
        outputRows: resultRows.length,
        executionTimeMs: endTime - startTime,
        retriesAttempted,
        memoryUsedBytes: this.estimateMemory(leftRows) + this.estimateMemory(rightRows),
      }
    }

    return result
  }

  /**
   * Stream cross-source join results
   */
  async *stream(
    config: CrossSourceJoinConfig,
    options: StreamOptions = {}
  ): AsyncGenerator<CrossSourceJoinResult, void, unknown> {
    const batchSize = options.batchSize ?? 1000

    // Execute the full join first (streaming optimization would fetch in batches)
    const result = await this.execute(config)

    // Yield results in batches
    for (let i = 0; i < result.rows.length; i += batchSize) {
      const batch = result.rows.slice(i, i + batchSize)
      const isLast = i + batchSize >= result.rows.length

      yield {
        rows: batch,
        batchIndex: Math.floor(i / batchSize),
        isComplete: isLast,
        stats: isLast ? result.stats : undefined,
      }
    }

    // Handle empty results
    if (result.rows.length === 0) {
      yield {
        rows: [],
        batchIndex: 0,
        isComplete: true,
        stats: result.stats,
      }
    }
  }

  /**
   * Select optimal join strategy based on table sizes
   */
  private selectStrategy(
    leftRowCount: number,
    rightRowCount: number
  ): JoinStrategy {
    const BROADCAST_THRESHOLD = 10000
    const NESTED_LOOP_THRESHOLD = 100

    // Very small tables: use nested loop
    if (leftRowCount < NESTED_LOOP_THRESHOLD || rightRowCount < NESTED_LOOP_THRESHOLD) {
      return 'nested_loop'
    }

    // One small table: use broadcast
    if (leftRowCount < BROADCAST_THRESHOLD || rightRowCount < BROADCAST_THRESHOLD) {
      return 'broadcast'
    }

    // Both large: use shuffle
    return 'shuffle'
  }

  /**
   * Build a query fragment with predicates
   */
  private buildFragment(
    table: string,
    predicates?: QueryPredicate[]
  ): QueryFragment {
    const fragment: QueryFragment = { table }

    if (predicates && predicates.length > 0) {
      fragment.predicates = predicates
    }

    return fragment
  }

  /**
   * Fetch data with timeout and retry
   */
  private async fetchWithTimeout(
    adapter: SourceAdapter,
    fragment: QueryFragment,
    timeout?: number,
    maxRetries?: number,
    sourceName?: string
  ): Promise<{ rows: Record<string, unknown>[] }> {
    const timeoutMs = timeout ?? 30000
    const retries = maxRetries ?? 3
    let lastError: Error | undefined

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const result = await this.withTimeout(
          adapter.execute(fragment),
          timeoutMs,
          `Query to ${sourceName} timed out`
        )
        return { rows: result.rows }
      } catch (error) {
        lastError = error as Error
        if (attempt < retries - 1) {
          // Exponential backoff
          const delay = 100 * Math.pow(2, attempt)
          await this.sleep(delay)
        }
      }
    }

    throw lastError
  }

  /**
   * Execute join between two sets of rows
   */
  private executeJoin(
    config: JoinConfig,
    leftRows: Record<string, unknown>[],
    rightRows: Record<string, unknown>[],
    keys: { left: string; right: string }
  ): Promise<Record<string, unknown>[]> {
    const leftKey = this.extractColumnName(keys.left)
    const rightKey = this.extractColumnName(keys.right)

    switch (config.strategy) {
      case 'broadcast':
        return Promise.resolve(
          this.executeBroadcastJoin(leftRows, rightRows, leftKey, rightKey, config.type)
        )
      case 'shuffle':
        return Promise.resolve(
          this.executeShuffleJoin(leftRows, rightRows, leftKey, rightKey, config.type)
        )
      case 'nested_loop':
        return Promise.resolve(
          this.executeNestedLoopJoin(leftRows, rightRows, leftKey, rightKey, config.type)
        )
      default:
        throw new Error(`Unknown join strategy: ${config.strategy}`)
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
    // Build side is smaller table
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
   * Execute shuffle join
   */
  private executeShuffleJoin(
    leftRows: Record<string, unknown>[],
    rightRows: Record<string, unknown>[],
    leftKey: string,
    rightKey: string,
    joinType: JoinType
  ): Record<string, unknown>[] {
    const numPartitions = 8

    // Partition both sides
    const leftPartitions: Record<string, unknown>[][] = Array.from(
      { length: numPartitions },
      () => []
    )
    const rightPartitions: Record<string, unknown>[][] = Array.from(
      { length: numPartitions },
      () => []
    )

    for (const row of leftRows) {
      const partitionId = this.hashPartition(row[leftKey], numPartitions)
      leftPartitions[partitionId]!.push(row)
    }

    for (const row of rightRows) {
      const partitionId = this.hashPartition(row[rightKey], numPartitions)
      rightPartitions[partitionId]!.push(row)
    }

    // Join each partition
    const results: Record<string, unknown>[] = []
    for (let i = 0; i < numPartitions; i++) {
      const partitionResult = this.executeBroadcastJoin(
        leftPartitions[i]!,
        rightPartitions[i]!,
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
      let hasMatch = false

      for (let rightIdx = 0; rightIdx < rightRows.length; rightIdx++) {
        const rightRow = rightRows[rightIdx]!

        if (leftRow[leftKey] === rightRow[rightKey]) {
          hasMatch = true
          matchedRight.add(rightIdx)
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
      for (let rightIdx = 0; rightIdx < rightRows.length; rightIdx++) {
        if (!matchedRight.has(rightIdx)) {
          const rightRow = rightRows[rightIdx]!
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
   * Execute chained joins for multi-way join
   */
  private async executeChainedJoins(
    rows: Record<string, unknown>[],
    chainedJoins: ChainedJoin[],
    typeConversions?: TypeConversionRule[]
  ): Promise<Record<string, unknown>[]> {
    let currentRows = rows

    for (const join of chainedJoins) {
      const adapter = this.catalog.getAdapter(join.source)
      if (!adapter) {
        throw new Error(`No adapter for source: ${join.source}`)
      }

      const fragment = this.buildFragment(join.table, join.predicates)
      const result = await adapter.execute(fragment)
      let joinRows = result.rows

      // Apply type conversions
      if (typeConversions) {
        joinRows = joinRows.map((row) =>
          this.converter.convertRow(row, typeConversions)
        )
      }

      // Extract key names
      const leftKey = this.extractColumnName(join.keys.left)
      const rightKey = this.extractColumnName(join.keys.right)

      // Execute join
      currentRows = this.executeBroadcastJoin(
        currentRows,
        joinRows,
        leftKey,
        rightKey,
        join.joinType
      )
    }

    return currentRows
  }

  /**
   * Project specified columns from result rows
   */
  private projectColumns(
    rows: Record<string, unknown>[],
    columns: ColumnSpec[]
  ): Record<string, unknown>[] {
    return rows.map((row) => {
      const projected: Record<string, unknown> = {}

      for (const col of columns) {
        if (typeof col === 'string') {
          if (col in row) {
            projected[col] = row[col]
          }
        } else {
          if (col.column in row) {
            projected[col.alias] = row[col.column]
          }
        }
      }

      return projected
    })
  }

  /**
   * Check if non-matching probe rows should be included
   */
  private shouldIncludeNonMatchingProbe(
    joinType: JoinType,
    buildIsLeft: boolean
  ): boolean {
    if (joinType === 'FULL') return true
    if (joinType === 'LEFT' && !buildIsLeft) return true
    if (joinType === 'RIGHT' && buildIsLeft) return true
    return false
  }

  /**
   * Check if non-matching build rows should be included
   */
  private shouldIncludeNonMatchingBuild(
    joinType: JoinType,
    buildIsLeft: boolean
  ): boolean {
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
   * Extract column name from potentially qualified name
   */
  private extractColumnName(qualifiedName: string): string {
    const parts = qualifiedName.split('.')
    return parts[parts.length - 1]!
  }

  /**
   * Compute hash partition for a value
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
   * Estimate memory usage of rows
   */
  private estimateMemory(rows: Record<string, unknown>[]): number {
    let bytes = rows.length * 100

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
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a cross-source join executor
 */
export function createCrossSourceJoin(catalog: Catalog): CrossSourceJoin {
  return new CrossSourceJoin(catalog)
}
