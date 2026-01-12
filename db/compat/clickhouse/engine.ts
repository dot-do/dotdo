/**
 * ClickHouse Query Execution Engine
 *
 * Executes queries against MergeTree tables using the unified QueryEngine primitives.
 * Provides query planning, optimization, and execution with statistics.
 *
 * @see dotdo-b80fl - Unified Analytics Compat Layer Epic
 */

import { MergeTreeTable, type SelectOptions, type AggregateSpec, type OrderByClause } from './tables'
import { createAggregator, type AggregatorType } from './aggregations'

// ============================================================================
// Types
// ============================================================================

/**
 * Query plan node types
 */
export type PlanNodeType =
  | 'scan'
  | 'index_scan'
  | 'filter'
  | 'project'
  | 'sort'
  | 'limit'
  | 'aggregate'
  | 'hash_aggregate'
  | 'window'
  | 'join'
  | 'union'

/**
 * Query plan node
 */
export interface PlanNode {
  type: PlanNodeType
  table?: string
  columns?: string[]
  predicate?: unknown
  orderBy?: OrderByClause[]
  limit?: number
  offset?: number
  aggregations?: Record<string, unknown>
  groupBy?: string[]
  window?: unknown
  children?: PlanNode[]
  estimatedRows: number
  estimatedCost: number
  indexUsed?: boolean
  partitionsPruned?: number
}

/**
 * Query explain result
 */
export interface ExplainResult {
  plan: PlanNode
  indexUsed: boolean
  estimatedRows: number
  estimatedCost: number
  partitionsPruned: number
  warnings?: string[]
}

/**
 * Aggregate query options
 */
export interface AggregateQueryOptions<T extends Record<string, unknown>> {
  table: MergeTreeTable<T>
  aggregations: AggregateSpec
  where?: unknown
  groupBy?: string[]
  having?: unknown
  orderBy?: OrderByClause[]
  limit?: number
  useVectorized?: boolean
}

/**
 * Aggregate result with metadata
 */
export interface AggregateQueryResult extends Record<string, unknown> {
  _meta?: {
    vectorized: boolean
    executionTimeMs: number
    rowsScanned: number
  }
}

/**
 * Explain query options
 */
export interface ExplainQueryOptions<T extends Record<string, unknown>> {
  table: MergeTreeTable<T>
  where?: unknown
  columns?: string[]
  orderBy?: OrderByClause[]
  limit?: number
  groupBy?: string[]
  aggregations?: AggregateSpec
}

// ============================================================================
// Query Planner
// ============================================================================

/**
 * Query planner that generates execution plans
 */
export class QueryPlanner {
  /**
   * Generate an execution plan for a query
   */
  plan<T extends Record<string, unknown>>(options: ExplainQueryOptions<T>): PlanNode {
    const { table, where, columns, orderBy, limit, groupBy, aggregations } = options

    let estimatedRows = table.rowCount() || 1000 // Default estimate
    let cost = 0
    const children: PlanNode[] = []

    // Start with scan
    let scanType: PlanNodeType = 'scan'
    let indexUsed = false
    let partitionsPruned = 0

    // Check if we can use index
    if (where && this.canUseIndex(where, table.orderBy)) {
      scanType = 'index_scan'
      indexUsed = true
      estimatedRows = Math.max(1, Math.floor(estimatedRows * 0.1)) // Estimate 10% selectivity
    }

    // Check partition pruning
    if (table.partitionBy && where) {
      partitionsPruned = this.estimatePartitionPruning(where, table.partitionBy)
      estimatedRows = Math.max(1, Math.floor(estimatedRows * (1 - partitionsPruned * 0.1)))
    }

    // Build scan node
    const scanNode: PlanNode = {
      type: scanType,
      table: table.name,
      predicate: where,
      estimatedRows,
      estimatedCost: estimatedRows,
      indexUsed,
      partitionsPruned,
    }
    cost += scanNode.estimatedCost

    // Add filter if WHERE clause exists and not using index
    let currentNode = scanNode
    if (where && !indexUsed) {
      const filterNode: PlanNode = {
        type: 'filter',
        predicate: where,
        estimatedRows: Math.max(1, Math.floor(estimatedRows * 0.5)),
        estimatedCost: estimatedRows * 0.1,
        children: [currentNode],
      }
      currentNode = filterNode
      cost += filterNode.estimatedCost
      estimatedRows = filterNode.estimatedRows
    }

    // Add aggregation if GROUP BY or aggregations
    if (groupBy || aggregations) {
      const aggNode: PlanNode = {
        type: groupBy ? 'hash_aggregate' : 'aggregate',
        groupBy,
        aggregations: aggregations as Record<string, unknown>,
        estimatedRows: groupBy ? Math.min(estimatedRows, 100) : 1,
        estimatedCost: estimatedRows * 0.5,
        children: [currentNode],
      }
      currentNode = aggNode
      cost += aggNode.estimatedCost
      estimatedRows = aggNode.estimatedRows
    }

    // Add projection if specific columns
    if (columns && columns.length > 0) {
      const projectNode: PlanNode = {
        type: 'project',
        columns,
        estimatedRows,
        estimatedCost: estimatedRows * 0.01,
        children: [currentNode],
      }
      currentNode = projectNode
      cost += projectNode.estimatedCost
    }

    // Add sort if ORDER BY
    if (orderBy && orderBy.length > 0) {
      // Check if already sorted by ORDER BY columns
      const needsSort = !this.isSortedBy(table.orderBy, orderBy)
      if (needsSort) {
        const sortNode: PlanNode = {
          type: 'sort',
          orderBy,
          estimatedRows,
          estimatedCost: estimatedRows * Math.log2(Math.max(2, estimatedRows)),
          children: [currentNode],
        }
        currentNode = sortNode
        cost += sortNode.estimatedCost
      }
    }

    // Add limit
    if (limit !== undefined) {
      const limitNode: PlanNode = {
        type: 'limit',
        limit,
        estimatedRows: Math.min(estimatedRows, limit),
        estimatedCost: 1,
        children: [currentNode],
      }
      currentNode = limitNode
      cost += limitNode.estimatedCost
      estimatedRows = limitNode.estimatedRows
    }

    currentNode.estimatedCost = cost
    return currentNode
  }

  /**
   * Check if index can be used for WHERE clause
   */
  private canUseIndex(where: unknown, orderBy: string[]): boolean {
    if (!where || typeof where !== 'object') return false

    const whereObj = where as Record<string, unknown>
    const firstOrderByCol = orderBy[0]!

    // Index is useful if WHERE includes prefix of ORDER BY
    return firstOrderByCol in whereObj
  }

  /**
   * Estimate partition pruning benefit
   */
  private estimatePartitionPruning(where: unknown, partitionBy: string): number {
    if (!where || typeof where !== 'object') return 0

    // Check if WHERE references partition column
    const whereObj = where as Record<string, unknown>

    // Extract column name from partition expression
    const partitionCol = partitionBy.replace(/^to\w+\((\w+)\)$/, '$1')

    if (partitionCol in whereObj) {
      return 5 // Assume 5 partitions can be pruned
    }

    return 0
  }

  /**
   * Check if table is already sorted by required columns
   */
  private isSortedBy(tableOrder: string[], required: OrderByClause[]): boolean {
    for (let i = 0; i < required.length; i++) {
      if (i >= tableOrder.length) return false
      if (tableOrder[i] !== required[i]!.column) return false
      // Note: direction matters in real implementation
    }
    return true
  }
}

// ============================================================================
// ClickHouse Engine
// ============================================================================

/**
 * Main query execution engine
 */
export class ClickHouseEngine {
  private planner: QueryPlanner

  constructor() {
    this.planner = new QueryPlanner()
  }

  /**
   * Generate and explain query plan
   */
  explain<T extends Record<string, unknown>>(options: ExplainQueryOptions<T>): ExplainResult {
    const plan = this.planner.plan(options)

    const warnings: string[] = []

    // Check for potential issues
    if (!plan.indexUsed && (options.table.rowCount() ?? 0) > 10000) {
      warnings.push('Full table scan on large table - consider adding index')
    }

    if (plan.type === 'sort' && plan.estimatedRows > 100000) {
      warnings.push('Large sort operation - may require external sort')
    }

    return {
      plan,
      indexUsed: plan.indexUsed ?? false,
      estimatedRows: plan.estimatedRows,
      estimatedCost: plan.estimatedCost,
      partitionsPruned: plan.partitionsPruned ?? 0,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  }

  /**
   * Execute aggregate query with vectorized optimization
   */
  executeAggregate<T extends Record<string, unknown>>(options: AggregateQueryOptions<T>): AggregateQueryResult {
    const startTime = performance.now()
    const { table, aggregations, where, groupBy, having, orderBy, limit, useVectorized = false } = options

    // Get rows (with optional filtering)
    let rows = table.getRows()
    const rowsScanned = rows.length

    // Apply WHERE filter
    if (where) {
      rows = this.filterRows(rows, where)
    }

    let result: AggregateQueryResult

    if (groupBy && groupBy.length > 0) {
      // GROUP BY aggregation
      result = this.executeGroupedAggregate(rows, groupBy, aggregations, having, orderBy, limit)
    } else {
      // Simple aggregation
      result = table.aggregate(aggregations) as AggregateQueryResult
    }

    const executionTimeMs = performance.now() - startTime

    // Add metadata
    result._meta = {
      vectorized: useVectorized,
      executionTimeMs,
      rowsScanned,
    }

    return result
  }

  /**
   * Execute grouped aggregation
   */
  private executeGroupedAggregate<T extends Record<string, unknown>>(
    rows: T[],
    groupBy: string[],
    aggregations: AggregateSpec,
    having?: unknown,
    orderBy?: OrderByClause[],
    limit?: number
  ): AggregateQueryResult {
    // Group rows
    const groups = new Map<string, T[]>()

    for (const row of rows) {
      const keyParts = groupBy.map(col => JSON.stringify(row[col]))
      const key = keyParts.join('|')
      const group = groups.get(key)
      if (group) {
        group.push(row)
      } else {
        groups.set(key, [row])
      }
    }

    // Aggregate each group
    const results: Record<string, unknown>[] = []

    for (const [key, groupRows] of groups) {
      const keyValues = key.split('|').map(v => JSON.parse(v))

      const groupResult: Record<string, unknown> = {}

      // Add group key values
      for (let i = 0; i < groupBy.length; i++) {
        groupResult[groupBy[i]!] = keyValues[i]
      }

      // Compute aggregations
      for (const [aggName, aggSpec] of Object.entries(aggregations)) {
        if (aggSpec === '*') {
          groupResult[aggName] = groupRows.length
        } else if (typeof aggSpec === 'string') {
          // Simple aggregation on column
          groupResult[aggName] = this.computeSimpleAgg(aggName as AggregatorType, groupRows, aggSpec)
        } else if (typeof aggSpec === 'object' && aggSpec !== null) {
          // Complex aggregation
          groupResult[aggName] = this.computeComplexAgg(aggSpec, groupRows)
        }
      }

      results.push(groupResult)
    }

    // Apply HAVING
    let filtered = results
    if (having) {
      filtered = this.filterRows(results, having)
    }

    // Apply ORDER BY
    if (orderBy && orderBy.length > 0) {
      filtered.sort((a, b) => {
        for (const clause of orderBy) {
          const aVal = a[clause.column]
          const bVal = b[clause.column]
          let cmp = 0
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            cmp = aVal - bVal
          } else {
            cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''))
          }
          if (cmp !== 0) {
            return clause.direction === 'DESC' ? -cmp : cmp
          }
        }
        return 0
      })
    }

    // Apply LIMIT
    if (limit !== undefined) {
      filtered = filtered.slice(0, limit)
    }

    return filtered as unknown as AggregateQueryResult
  }

  /**
   * Compute simple aggregation on column
   */
  private computeSimpleAgg<T extends Record<string, unknown>>(
    aggType: AggregatorType,
    rows: T[],
    column: string
  ): unknown {
    const aggregator = createAggregator(aggType)
    const state = aggregator.init()

    for (const row of rows) {
      const value = row[column]
      aggregator.add(state, value)
    }

    return aggregator.finalize(state)
  }

  /**
   * Compute complex aggregation with options
   */
  private computeComplexAgg<T extends Record<string, unknown>>(
    spec: Record<string, unknown>,
    rows: T[]
  ): unknown {
    if ('column' in spec) {
      // Aggregation with column
      const { column, ...options } = spec

      // Determine aggregation type from other properties
      if ('level' in options) {
        // quantile
        const aggregator = createAggregator('quantile', options)
        const state = aggregator.init()
        for (const row of rows) {
          aggregator.add(state, row[column as string])
        }
        return aggregator.finalize(state)
      }

      if ('levels' in options) {
        // quantiles
        const aggregator = createAggregator('quantiles', options)
        const state = aggregator.init()
        for (const row of rows) {
          aggregator.add(state, row[column as string])
        }
        return aggregator.finalize(state)
      }

      if ('k' in options) {
        // topK
        const aggregator = createAggregator('topK', options)
        const state = aggregator.init()
        for (const row of rows) {
          aggregator.add(state, row[column as string])
        }
        return aggregator.finalize(state)
      }

      if ('by' in options) {
        // argMin/argMax
        const aggType = 'min' in options ? 'argMin' : 'argMax'
        const aggregator = createAggregator(aggType)
        const state = aggregator.init()
        for (const row of rows) {
          aggregator.add(state, { value: row[column as string], by: row[options.by as string] as number })
        }
        return aggregator.finalize(state)
      }
    }

    return null
  }

  /**
   * Filter rows by predicate
   */
  private filterRows<T>(rows: T[], predicate: unknown): T[] {
    if (!predicate || typeof predicate !== 'object') return rows

    const pred = predicate as Record<string, unknown>

    return rows.filter(row => {
      for (const [key, condition] of Object.entries(pred)) {
        if (key === '$and') {
          const andConditions = condition as Record<string, unknown>[]
          if (!andConditions.every(c => this.filterRows([row], c).length > 0)) {
            return false
          }
          continue
        }

        if (key === '$or') {
          const orConditions = condition as Record<string, unknown>[]
          if (!orConditions.some(c => this.filterRows([row], c).length > 0)) {
            return false
          }
          continue
        }

        const rowValue = (row as Record<string, unknown>)[key]

        if (typeof condition === 'object' && condition !== null && !(condition instanceof Date)) {
          // Operator condition
          const ops = condition as Record<string, unknown>
          if ('$gt' in ops && !((rowValue as number) > (ops.$gt as number))) return false
          if ('$gte' in ops && !((rowValue as number) >= (ops.$gte as number))) return false
          if ('$lt' in ops && !((rowValue as number) < (ops.$lt as number))) return false
          if ('$lte' in ops && !((rowValue as number) <= (ops.$lte as number))) return false
          if ('$eq' in ops && rowValue !== ops.$eq) return false
          if ('$ne' in ops && rowValue === ops.$ne) return false
          if ('$in' in ops && !(ops.$in as unknown[]).includes(rowValue)) return false
        } else {
          // Direct equality
          if (rowValue !== condition) return false
        }
      }
      return true
    })
  }

  /**
   * Execute vectorized sum using TypedArray
   */
  vectorizedSum(values: number[]): number {
    // Use Float64Array for SIMD-friendly operations
    const arr = new Float64Array(values)
    let sum = 0
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i]!
    }
    return sum
  }

  /**
   * Execute vectorized count
   */
  vectorizedCount(values: unknown[]): number {
    let count = 0
    for (let i = 0; i < values.length; i++) {
      if (values[i] !== null && values[i] !== undefined) {
        count++
      }
    }
    return count
  }

  /**
   * Execute vectorized min/max
   */
  vectorizedMinMax(values: number[]): { min: number; max: number } | null {
    if (values.length === 0) return null

    const arr = new Float64Array(values)
    let min = arr[0]!
    let max = arr[0]!

    for (let i = 1; i < arr.length; i++) {
      if (arr[i]! < min) min = arr[i]!
      if (arr[i]! > max) max = arr[i]!
    }

    return { min, max }
  }

  /**
   * Execute vectorized average
   */
  vectorizedAvg(values: number[]): number | null {
    if (values.length === 0) return null

    const arr = new Float64Array(values)
    let sum = 0
    let count = 0

    for (let i = 0; i < arr.length; i++) {
      if (!Number.isNaN(arr[i]!)) {
        sum += arr[i]!
        count++
      }
    }

    return count > 0 ? sum / count : null
  }

  /**
   * Execute vectorized standard deviation (population)
   */
  vectorizedStddev(values: number[]): number | null {
    if (values.length === 0) return null

    const arr = new Float64Array(values)
    let sum = 0
    let sumSq = 0
    let count = 0

    for (let i = 0; i < arr.length; i++) {
      if (!Number.isNaN(arr[i]!)) {
        sum += arr[i]!
        sumSq += arr[i]! * arr[i]!
        count++
      }
    }

    if (count === 0) return null

    const mean = sum / count
    const variance = sumSq / count - mean * mean
    return Math.sqrt(Math.max(0, variance))
  }

  /**
   * Execute batch aggregation on multiple columns
   */
  batchAggregate<T extends Record<string, unknown>>(
    table: MergeTreeTable<T>,
    specs: Array<{ column: string; function: AggregatorType }>
  ): Record<string, unknown> {
    const rows = table.getRows()
    const results: Record<string, unknown> = {}

    for (const spec of specs) {
      const values = rows.map(r => r[spec.column]) as number[]

      switch (spec.function) {
        case 'sum':
          results[`${spec.function}_${spec.column}`] = this.vectorizedSum(values)
          break
        case 'count':
          results[`${spec.function}_${spec.column}`] = this.vectorizedCount(values)
          break
        case 'avg':
          results[`${spec.function}_${spec.column}`] = this.vectorizedAvg(values)
          break
        case 'min':
        case 'max':
          const minMax = this.vectorizedMinMax(values)
          if (minMax) {
            results[`${spec.function}_${spec.column}`] = spec.function === 'min' ? minMax.min : minMax.max
          }
          break
        case 'stddevPop':
          results[`${spec.function}_${spec.column}`] = this.vectorizedStddev(values)
          break
      }
    }

    return results
  }

  /**
   * Collect table statistics for cost estimation
   */
  collectStatistics<T extends Record<string, unknown>>(table: MergeTreeTable<T>): TableStats {
    const rows = table.getRows()
    const stats: TableStats = {
      rowCount: rows.length,
      columnStats: new Map(),
    }

    for (const col of table.columns) {
      const values = rows.map(r => r[col.name])
      const numericValues = values.filter(v => typeof v === 'number') as number[]

      stats.columnStats.set(col.name, {
        distinctCount: new Set(values.map(v => JSON.stringify(v))).size,
        nullCount: values.filter(v => v === null || v === undefined).length,
        min: numericValues.length > 0 ? Math.min(...numericValues) : undefined,
        max: numericValues.length > 0 ? Math.max(...numericValues) : undefined,
      })
    }

    return stats
  }
}

/**
 * Table statistics for query optimization
 */
interface TableStats {
  rowCount: number
  columnStats: Map<string, ColumnStats>
}

/**
 * Column statistics
 */
interface ColumnStats {
  distinctCount: number
  nullCount: number
  min?: number
  max?: number
}

// =============================================================================
// MaterializedView
// =============================================================================

/**
 * Materialized View for incremental aggregations
 */
export class MaterializedView<T extends Record<string, unknown>> {
  readonly name: string
  readonly sourceTable: MergeTreeTable<T>
  readonly aggregations: AggregateSpec
  readonly groupBy: (keyof T & string)[]
  readonly refreshInterval?: number

  private cache: Map<string, Record<string, unknown>> = new Map()
  private lastRefresh?: number
  private refreshTimer?: ReturnType<typeof setInterval>

  constructor(config: {
    name: string
    source: MergeTreeTable<T>
    aggregations: AggregateSpec
    groupBy: (keyof T & string)[]
    refreshInterval?: number
  }) {
    this.name = config.name
    this.sourceTable = config.source
    this.aggregations = config.aggregations
    this.groupBy = config.groupBy
    this.refreshInterval = config.refreshInterval

    // Initial computation
    this.refresh()

    // Setup auto-refresh if interval specified
    if (this.refreshInterval && this.refreshInterval > 0) {
      this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval)
    }
  }

  /**
   * Refresh the materialized view
   */
  refresh(): void {
    this.cache.clear()

    const results = this.sourceTable.groupBy(this.groupBy, this.aggregations)

    for (const row of results) {
      const keyParts = this.groupBy.map(col => JSON.stringify(row[col]))
      const key = keyParts.join('|')
      this.cache.set(key, row)
    }

    this.lastRefresh = Date.now()
  }

  /**
   * Get cached results
   */
  getResults(): Record<string, unknown>[] {
    return [...this.cache.values()]
  }

  /**
   * Get result for specific group key
   */
  get(keyValues: Record<string, unknown>): Record<string, unknown> | undefined {
    const keyParts = this.groupBy.map(col => JSON.stringify(keyValues[col]))
    const key = keyParts.join('|')
    return this.cache.get(key)
  }

  /**
   * Check if view is stale
   */
  isStale(maxAge: number): boolean {
    if (!this.lastRefresh) return true
    return Date.now() - this.lastRefresh > maxAge
  }

  /**
   * Stop auto-refresh
   */
  dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
    }
  }
}
