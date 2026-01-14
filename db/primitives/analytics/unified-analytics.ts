/**
 * Unified Analytics API
 *
 * A fluent builder API that unifies all analytics primitives:
 * - TypedColumnStore for columnar storage
 * - MaterializedTable for pre-computed aggregates
 * - CUBE/ROLLUP for multi-dimensional analysis
 * - Approximate queries (T-Digest, Count-Min Sketch)
 *
 * The API provides:
 * - Fluent chained method calls
 * - Query plan generation and explain
 * - Streaming and batch modes
 * - Full type inference
 *
 * @module db/primitives/analytics/unified-analytics
 * @see dotdo-eqrhx
 */

import {
  cube as generateCube,
  rollup as generateRollup,
  aggregate as cubeAggregate,
  type AggregateSpec as CubeAggregateSpec,
  type GroupingSet,
  type CubeResultRow,
} from './cube'

import {
  createMaterializedTable,
  type MaterializedTable,
  type AggregateDefinition,
  type MaterializationConfig,
  type AggregateFnDef,
  type WindowAssigner as MatWindowAssigner,
  sum as matSum,
  count as matCount,
  avg as matAvg,
  min as matMin,
  max as matMax,
  countDistinct as matCountDistinct,
  tumbling as matTumbling,
  sliding as matSliding,
} from './materialized-table'

import { createTDigest, createTopK, type TopKItem } from './approximate-queries'

// ============================================================================
// Types
// ============================================================================

/**
 * Analytics configuration options
 */
export interface AnalyticsConfig {
  /** Default window for streaming queries */
  defaultWindow?: WindowSpec
  /** Threshold for switching to approximate queries */
  approximateThreshold?: number
}

/**
 * Window specification for time-based aggregation
 */
export interface WindowSpec {
  type: 'tumbling' | 'sliding'
  size: number
  slide?: number
}

/**
 * Comparison operators for predicates
 */
export type ComparisonOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'between' | 'in'

/**
 * Predicate for filtering rows
 */
export interface Predicate {
  column: string
  op: ComparisonOp
  value: unknown
}

/**
 * Aggregate function type
 */
export type AggregateFnType =
  | 'sum'
  | 'count'
  | 'avg'
  | 'min'
  | 'max'
  | 'countDistinct'
  | 'approxPercentile'
  | 'approxTopK'

/**
 * Aggregate specification
 */
export interface AggregateSpec {
  type: AggregateFnType
  column?: string
  params?: Record<string, unknown>
}

/**
 * Order specification for sorting
 */
export interface OrderSpec {
  column: string
  direction: 'asc' | 'desc'
}

/**
 * Grouping mode
 */
export type GroupingMode = 'simple' | 'cube' | 'rollup'

/**
 * Query plan operation types
 */
export type PlanOperationType = 'scan' | 'filter' | 'group' | 'aggregate' | 'sort' | 'limit' | 'window' | 'materialize'

/**
 * Query plan operation node
 */
export interface PlanOperation {
  type: PlanOperationType
  columns?: string[]
  predicates?: Predicate[]
  mode?: GroupingMode
  aggregates?: Record<string, AggregateSpec>
  orders?: OrderSpec[]
  limit?: number
  offset?: number
  window?: WindowSpec
  cost?: number
}

/**
 * Query plan with operations and estimated costs
 */
export interface QueryPlan {
  operations: PlanOperation[]
  estimatedRows: number
  estimatedCost: number
  toString(): string
}

/**
 * Materialized table options
 */
export interface MaterializeOptions {
  refresh?: 'on-insert' | 'periodic' | 'manual'
  refreshInterval?: number
}

/**
 * Materialized table wrapper
 */
export interface MaterializedAnalyticsTable<T> {
  name: string
  ingest(rows: T[]): void
  query(): T[]
  getStats(): { rowCount: number; groupCount: number }
}

// ============================================================================
// Predicate Helpers
// ============================================================================

/**
 * Create an equality predicate
 */
export function eq(column: string, value: unknown): Predicate {
  return { column, op: '=', value }
}

/**
 * Create an inequality predicate
 */
export function neq(column: string, value: unknown): Predicate {
  return { column, op: '!=', value }
}

/**
 * Create a greater-than predicate
 */
export function gt(column: string, value: number): Predicate {
  return { column, op: '>', value }
}

/**
 * Create a less-than predicate
 */
export function lt(column: string, value: number): Predicate {
  return { column, op: '<', value }
}

/**
 * Create a greater-than-or-equal predicate
 */
export function gte(column: string, value: number): Predicate {
  return { column, op: '>=', value }
}

/**
 * Create a less-than-or-equal predicate
 */
export function lte(column: string, value: number): Predicate {
  return { column, op: '<=', value }
}

/**
 * Create a between predicate (inclusive)
 */
export function between(column: string, min: number, max: number): Predicate {
  return { column, op: 'between', value: [min, max] }
}

/**
 * Create an in-list predicate
 */
export function inList(column: string, values: unknown[]): Predicate {
  return { column, op: 'in', value: values }
}

// ============================================================================
// Aggregate Helpers
// ============================================================================

/**
 * Create a sum aggregate
 */
export function sum(column: string): AggregateSpec {
  return { type: 'sum', column }
}

/**
 * Create a count aggregate
 */
export function count(column?: string): AggregateSpec {
  return { type: 'count', column }
}

/**
 * Create an average aggregate
 */
export function avg(column: string): AggregateSpec {
  return { type: 'avg', column }
}

/**
 * Create a min aggregate
 */
export function min(column: string): AggregateSpec {
  return { type: 'min', column }
}

/**
 * Create a max aggregate
 */
export function max(column: string): AggregateSpec {
  return { type: 'max', column }
}

/**
 * Create a count distinct aggregate
 */
export function countDistinct(column: string): AggregateSpec {
  return { type: 'countDistinct', column }
}

/**
 * Create an approximate percentile aggregate
 */
export function approxPercentile(column: string, percentile: number): AggregateSpec {
  return { type: 'approxPercentile', column, params: { percentile } }
}

/**
 * Create an approximate top-k aggregate
 */
export function approxTopK(column: string, k: number): AggregateSpec {
  return { type: 'approxTopK', column, params: { k } }
}

// ============================================================================
// Order Helpers
// ============================================================================

/**
 * Create an ascending order specification
 */
export function asc(column: string): OrderSpec {
  return { column, direction: 'asc' }
}

/**
 * Create a descending order specification
 */
export function desc(column: string): OrderSpec {
  return { column, direction: 'desc' }
}

// ============================================================================
// Window Helpers
// ============================================================================

/**
 * Create a tumbling window specification
 * @param size Window size (e.g., '1h', '5m', '30s', or milliseconds)
 */
export function tumbling(size: string | number): WindowSpec {
  return {
    type: 'tumbling',
    size: parseWindowSize(size),
  }
}

/**
 * Create a sliding window specification
 * @param size Window size
 * @param slide Slide interval
 */
export function sliding(size: string | number, slide: string | number): WindowSpec {
  return {
    type: 'sliding',
    size: parseWindowSize(size),
    slide: parseWindowSize(slide),
  }
}

/**
 * Parse window size string to milliseconds
 */
function parseWindowSize(size: string | number): number {
  if (typeof size === 'number') return size

  const match = size.match(/^(\d+)(ms|s|m|h|d)?$/)
  if (!match) throw new Error(`Invalid window size: ${size}`)

  const value = parseInt(match[1]!, 10)
  const unit = match[2] || 'ms'

  switch (unit) {
    case 'ms': return value
    case 's': return value * 1000
    case 'm': return value * 60 * 1000
    case 'h': return value * 60 * 60 * 1000
    case 'd': return value * 24 * 60 * 60 * 1000
    default: return value
  }
}

// ============================================================================
// Analytics Builder Implementation
// ============================================================================

/**
 * Fluent analytics query builder
 */
export class AnalyticsBuilder<T extends Record<string, unknown>> {
  private source: T[] = []
  private tableName?: string
  private predicates: Predicate[] = []
  private groupColumns: string[] = []
  private groupingMode: GroupingMode = 'simple'
  private aggregates: Record<string, AggregateSpec> = {}
  private orders: OrderSpec[] = []
  private limitValue?: number
  private offsetValue?: number
  private windowSpec?: WindowSpec
  private analytics: Analytics

  constructor(analytics: Analytics, source?: T[] | string) {
    this.analytics = analytics
    if (typeof source === 'string') {
      this.tableName = source
      const table = analytics.getMaterializedTable(source)
      if (table) {
        this.source = table.query() as T[]
      }
    } else if (source) {
      this.source = source
    }
  }

  /**
   * Filter rows matching the predicate
   */
  filter(...predicates: Predicate[]): this {
    this.predicates.push(...predicates)
    return this
  }

  /**
   * Alias for filter()
   */
  where(...predicates: Predicate[]): this {
    return this.filter(...predicates)
  }

  /**
   * Group by columns
   */
  groupBy(...columns: string[]): this {
    this.groupColumns = columns
    this.groupingMode = 'simple'
    return this
  }

  /**
   * Generate CUBE grouping sets (all dimension combinations)
   */
  cube(...columns: string[]): this {
    this.groupColumns = columns
    this.groupingMode = 'cube'
    return this
  }

  /**
   * Generate ROLLUP grouping sets (hierarchical subtotals)
   */
  rollup(...columns: string[]): this {
    this.groupColumns = columns
    this.groupingMode = 'rollup'
    return this
  }

  /**
   * Set time window for aggregation
   */
  window(spec: WindowSpec): this {
    this.windowSpec = spec
    return this
  }

  /**
   * Define aggregate functions
   */
  aggregate(aggregates: Record<string, AggregateSpec>): this {
    this.aggregates = aggregates
    return this
  }

  /**
   * Order results
   */
  orderBy(...orders: OrderSpec[]): this {
    this.orders = orders
    return this
  }

  /**
   * Limit number of results
   */
  limit(n: number): this {
    this.limitValue = n
    return this
  }

  /**
   * Skip first n results
   */
  offset(n: number): this {
    this.offsetValue = n
    return this
  }

  /**
   * Execute the query and return results
   */
  async execute(): Promise<Array<Record<string, unknown>>> {
    // Apply filters
    let data = this.applyFilters(this.source)

    // Apply windowing
    if (this.windowSpec) {
      return this.executeWithWindow(data)
    }

    // Apply grouping and aggregation
    if (Object.keys(this.aggregates).length > 0) {
      data = this.executeAggregation(data)
    }

    // Apply ordering
    if (this.orders.length > 0) {
      data = this.applyOrdering(data)
    }

    // Apply offset and limit
    if (this.offsetValue !== undefined) {
      data = data.slice(this.offsetValue)
    }
    if (this.limitValue !== undefined) {
      data = data.slice(0, this.limitValue)
    }

    return data
  }

  /**
   * Create a materialized table from the query
   */
  async materialize(
    name: string,
    options: MaterializeOptions = {}
  ): Promise<MaterializedAnalyticsTable<Record<string, unknown>>> {
    const table = createMaterializedTable<T>()

    // Define materialization config
    const aggregateDefs: AggregateDefinition[] = Object.entries(this.aggregates).map(
      ([aggName, spec]) => ({
        name: aggName,
        fn: this.toMatAggregateFn(spec),
      })
    )

    const config: MaterializationConfig<T> = {
      groupBy: this.groupColumns as (keyof T)[],
      aggregates: aggregateDefs,
      refresh: options.refresh || 'on-insert',
      refreshInterval: options.refreshInterval,
    }

    if (this.windowSpec) {
      config.window = {
        type: this.windowSpec.type,
        size: this.windowSpec.size,
        slide: this.windowSpec.slide,
      }
    }

    table.define(config)

    // Ingest initial data
    table.ingest(this.applyFilters(this.source) as T[])

    // Register with analytics
    const wrapper: MaterializedAnalyticsTable<Record<string, unknown>> = {
      name,
      ingest: (rows) => table.ingest(rows as T[]),
      query: () => table.query(),
      getStats: () => table.getStats(),
    }

    this.analytics.registerMaterializedTable(name, wrapper)

    return wrapper
  }

  /**
   * Get the query plan without executing
   */
  explain(): QueryPlan {
    const operations: PlanOperation[] = []

    // Scan operation
    operations.push({
      type: 'scan',
      cost: this.source.length,
    })

    // Filter operations
    if (this.predicates.length > 0) {
      operations.push({
        type: 'filter',
        predicates: [...this.predicates],
        cost: this.source.length * 0.1 * this.predicates.length,
      })
    }

    // Window operation
    if (this.windowSpec) {
      operations.push({
        type: 'window',
        window: this.windowSpec,
        cost: this.source.length * 0.2,
      })
    }

    // Group operation
    if (this.groupColumns.length > 0 || Object.keys(this.aggregates).length > 0) {
      operations.push({
        type: 'group',
        columns: this.groupColumns,
        mode: this.groupingMode,
        cost: this.source.length * 0.5,
      })
    }

    // Aggregate operation
    if (Object.keys(this.aggregates).length > 0) {
      operations.push({
        type: 'aggregate',
        aggregates: { ...this.aggregates },
        cost: this.source.length * 0.3,
      })
    }

    // Sort operation
    if (this.orders.length > 0) {
      operations.push({
        type: 'sort',
        orders: [...this.orders],
        cost: this.estimateRowCount() * Math.log2(this.estimateRowCount() + 1),
      })
    }

    // Limit operation
    if (this.limitValue !== undefined || this.offsetValue !== undefined) {
      operations.push({
        type: 'limit',
        limit: this.limitValue,
        offset: this.offsetValue,
        cost: 1,
      })
    }

    const estimatedRows = this.estimateRowCount()
    const estimatedCost = operations.reduce((sum, op) => sum + (op.cost || 0), 0)

    return {
      operations,
      estimatedRows,
      estimatedCost,
      toString: () => this.formatQueryPlan(operations, estimatedRows, estimatedCost),
    }
  }

  // =========================================================================
  // Private Helper Methods
  // =========================================================================

  private applyFilters(data: T[]): T[] {
    if (this.predicates.length === 0) return data

    return data.filter((row) => {
      return this.predicates.every((pred) => this.evaluatePredicate(row, pred))
    })
  }

  private evaluatePredicate(row: T, predicate: Predicate): boolean {
    const value = row[predicate.column]

    switch (predicate.op) {
      case '=':
        return value === predicate.value
      case '!=':
        return value !== predicate.value
      case '>':
        return typeof value === 'number' && value > (predicate.value as number)
      case '<':
        return typeof value === 'number' && value < (predicate.value as number)
      case '>=':
        return typeof value === 'number' && value >= (predicate.value as number)
      case '<=':
        return typeof value === 'number' && value <= (predicate.value as number)
      case 'between': {
        const [min, max] = predicate.value as [number, number]
        return typeof value === 'number' && value >= min && value <= max
      }
      case 'in':
        return (predicate.value as unknown[]).includes(value)
      default:
        return false
    }
  }

  private executeWithWindow(data: T[]): Array<Record<string, unknown>> {
    if (!this.windowSpec) return data as unknown as Array<Record<string, unknown>>

    const windowSize = this.windowSpec.size
    const windowSlide = this.windowSpec.slide || windowSize

    // Group data into windows based on timestamp
    const windows = new Map<number, T[]>()

    for (const row of data) {
      const timestamp = row.timestamp as number
      if (timestamp === undefined) continue

      // For tumbling windows
      if (this.windowSpec.type === 'tumbling') {
        const windowStart = Math.floor(timestamp / windowSize) * windowSize
        if (!windows.has(windowStart)) {
          windows.set(windowStart, [])
        }
        windows.get(windowStart)!.push(row)
      } else {
        // For sliding windows - element belongs to multiple windows
        const lastWindowStart = Math.floor(timestamp / windowSlide) * windowSlide
        const numWindows = Math.ceil(windowSize / windowSlide)

        for (let i = 0; i < numWindows; i++) {
          const windowStart = lastWindowStart - i * windowSlide
          const windowEnd = windowStart + windowSize
          if (timestamp >= windowStart && timestamp < windowEnd) {
            if (!windows.has(windowStart)) {
              windows.set(windowStart, [])
            }
            windows.get(windowStart)!.push(row)
          }
        }
      }
    }

    // Aggregate each window
    const results: Array<Record<string, unknown>> = []

    for (const [windowStart, windowData] of windows) {
      const windowEnd = windowStart + windowSize

      if (this.groupColumns.length > 0) {
        // Group within window
        const groups = this.groupData(windowData)
        for (const [_, groupData] of groups) {
          const aggregated = this.computeAggregates(groupData)
          results.push({
            windowStart,
            windowEnd,
            ...groupData[0], // Include group key values
            ...aggregated,
          })
        }
      } else {
        // Aggregate entire window
        const aggregated = this.computeAggregates(windowData)
        results.push({
          windowStart,
          windowEnd,
          ...aggregated,
        })
      }
    }

    // Apply ordering
    let finalResults = results
    if (this.orders.length > 0) {
      finalResults = this.applyOrdering(results)
    }

    // Apply offset and limit
    if (this.offsetValue !== undefined) {
      finalResults = finalResults.slice(this.offsetValue)
    }
    if (this.limitValue !== undefined) {
      finalResults = finalResults.slice(0, this.limitValue)
    }

    return finalResults
  }

  private executeAggregation(data: T[]): Array<Record<string, unknown>> {
    if (this.groupColumns.length === 0 && this.groupingMode === 'simple') {
      // Global aggregation
      const aggregated = this.computeAggregates(data)
      return [aggregated]
    }

    // Get grouping sets based on mode
    let groupingSets: GroupingSet[]

    switch (this.groupingMode) {
      case 'cube':
        groupingSets = generateCube(this.groupColumns)
        break
      case 'rollup':
        groupingSets = generateRollup(this.groupColumns)
        break
      default:
        groupingSets = [this.groupColumns]
    }

    // Use cube.ts aggregate function for multi-dimensional analysis
    const aggregateSpecs: CubeAggregateSpec[] = Object.entries(this.aggregates).map(
      ([alias, spec]) => ({
        column: spec.column || '*',
        fn: this.toCubeAggregateFn(spec),
        alias,
      })
    )

    const cubeResults = cubeAggregate(data, groupingSets, aggregateSpecs)

    // Convert to flat result format
    return cubeResults.map((row) => {
      const result: Record<string, unknown> = {}

      // Add dimension values
      for (const [key, value] of Object.entries(row.dimensions)) {
        result[key] = value
      }

      // Add measure values
      for (const [key, value] of Object.entries(row.measures)) {
        result[key] = value
      }

      return result
    })
  }

  private groupData(data: T[]): Map<string, T[]> {
    const groups = new Map<string, T[]>()

    for (const row of data) {
      const keyParts = this.groupColumns.map((col) => String(row[col]))
      const key = keyParts.join('|')

      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(row)
    }

    return groups
  }

  private computeAggregates(data: T[]): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const [name, spec] of Object.entries(this.aggregates)) {
      result[name] = this.computeAggregate(data, spec)
    }

    return result
  }

  private computeAggregate(data: T[], spec: AggregateSpec): unknown {
    const column = spec.column

    switch (spec.type) {
      case 'count':
        return data.length

      case 'sum': {
        if (!column) return 0
        return data.reduce((sum, row) => {
          const val = row[column]
          return sum + (typeof val === 'number' ? val : 0)
        }, 0)
      }

      case 'avg': {
        if (!column || data.length === 0) return 0
        const sum = data.reduce((acc, row) => {
          const val = row[column]
          return acc + (typeof val === 'number' ? val : 0)
        }, 0)
        return sum / data.length
      }

      case 'min': {
        if (!column || data.length === 0) return null
        let minVal = Infinity
        for (const row of data) {
          const val = row[column]
          if (typeof val === 'number' && val < minVal) {
            minVal = val
          }
        }
        return minVal === Infinity ? null : minVal
      }

      case 'max': {
        if (!column || data.length === 0) return null
        let maxVal = -Infinity
        for (const row of data) {
          const val = row[column]
          if (typeof val === 'number' && val > maxVal) {
            maxVal = val
          }
        }
        return maxVal === -Infinity ? null : maxVal
      }

      case 'countDistinct': {
        if (!column) return 0
        const values = new Set(data.map((row) => row[column]))
        return values.size
      }

      case 'approxPercentile': {
        if (!column || data.length === 0) return null
        const percentile = (spec.params?.percentile as number) || 50
        const tDigest = createTDigest()

        for (const row of data) {
          const val = row[column]
          if (typeof val === 'number') {
            tDigest.add(val)
          }
        }

        return tDigest.percentile(percentile)
      }

      case 'approxTopK': {
        if (!column) return []
        const k = (spec.params?.k as number) || 10
        const topK = createTopK(k)

        for (const row of data) {
          const val = row[column]
          if (val !== undefined && val !== null) {
            topK.add(String(val))
          }
        }

        return topK.getTopK()
      }

      default:
        return null
    }
  }

  private applyOrdering(data: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    return [...data].sort((a, b) => {
      for (const order of this.orders) {
        const aVal = a[order.column]
        const bVal = b[order.column]

        let comparison = 0
        if (aVal === null || aVal === undefined) comparison = 1
        else if (bVal === null || bVal === undefined) comparison = -1
        else if (typeof aVal === 'number' && typeof bVal === 'number') {
          comparison = aVal - bVal
        } else {
          comparison = String(aVal).localeCompare(String(bVal))
        }

        if (comparison !== 0) {
          return order.direction === 'desc' ? -comparison : comparison
        }
      }
      return 0
    })
  }

  private estimateRowCount(): number {
    let estimate = this.source.length

    // Filter reduces rows
    if (this.predicates.length > 0) {
      estimate = Math.max(1, Math.floor(estimate * 0.5))
    }

    // Grouping reduces rows
    if (this.groupColumns.length > 0) {
      // Estimate based on cardinality
      estimate = Math.max(1, Math.min(estimate, Math.pow(10, this.groupColumns.length)))
    }

    // CUBE multiplies result sets
    if (this.groupingMode === 'cube') {
      estimate = estimate * Math.pow(2, this.groupColumns.length)
    }

    // ROLLUP adds subtotals
    if (this.groupingMode === 'rollup') {
      estimate = estimate * (this.groupColumns.length + 1)
    }

    // Limit caps the result
    if (this.limitValue !== undefined) {
      estimate = Math.min(estimate, this.limitValue)
    }

    return estimate
  }

  private formatQueryPlan(
    operations: PlanOperation[],
    estimatedRows: number,
    estimatedCost: number
  ): string {
    const lines: string[] = []
    lines.push('Query Plan')
    lines.push('='.repeat(50))

    for (const op of operations) {
      const cost = op.cost ? ` (cost: ${op.cost.toFixed(2)})` : ''
      switch (op.type) {
        case 'scan':
          lines.push(`Scan: source data${cost}`)
          break
        case 'filter':
          lines.push(`Filter: ${op.predicates?.length || 0} predicates${cost}`)
          break
        case 'window':
          lines.push(`Window: ${op.window?.type} (${op.window?.size}ms)${cost}`)
          break
        case 'group':
          lines.push(`Group: ${op.mode} on [${op.columns?.join(', ')}]${cost}`)
          break
        case 'aggregate':
          const aggNames = Object.keys(op.aggregates || {})
          lines.push(`Aggregate: [${aggNames.join(', ')}]${cost}`)
          break
        case 'sort':
          const orderStrs = op.orders?.map((o) => `${o.column} ${o.direction}`)
          lines.push(`Sort: [${orderStrs?.join(', ')}]${cost}`)
          break
        case 'limit':
          lines.push(`Limit: ${op.limit}${op.offset ? ` offset ${op.offset}` : ''}${cost}`)
          break
      }
    }

    lines.push('='.repeat(50))
    lines.push(`Estimated rows: ${estimatedRows}`)
    lines.push(`Estimated cost: ${estimatedCost.toFixed(2)}`)

    return lines.join('\n')
  }

  private toCubeAggregateFn(spec: AggregateSpec): 'sum' | 'count' | 'avg' | 'min' | 'max' | 'first' | 'last' {
    switch (spec.type) {
      case 'sum': return 'sum'
      case 'count': return 'count'
      case 'avg': return 'avg'
      case 'min': return 'min'
      case 'max': return 'max'
      case 'countDistinct': return 'count' // Approximation for cube
      default: return 'count'
    }
  }

  private toMatAggregateFn(spec: AggregateSpec): AggregateFnDef {
    switch (spec.type) {
      case 'sum': return matSum(spec.column || '')
      case 'count': return matCount()
      case 'avg': return matAvg(spec.column || '')
      case 'min': return matMin(spec.column || '')
      case 'max': return matMax(spec.column || '')
      case 'countDistinct': return matCountDistinct(spec.column || '')
      default: return matCount()
    }
  }
}

// ============================================================================
// Analytics Class
// ============================================================================

/**
 * Main Analytics API entry point
 */
export class Analytics {
  private config: AnalyticsConfig
  private materializedTables: Map<string, MaterializedAnalyticsTable<Record<string, unknown>>> = new Map()

  constructor(config: AnalyticsConfig = {}) {
    this.config = config
  }

  /**
   * Create a builder from a named table
   */
  table<T extends Record<string, unknown>>(name: string): AnalyticsBuilder<T> {
    return new AnalyticsBuilder<T>(this, name)
  }

  /**
   * Create a builder from an array of data
   */
  fromData<T extends Record<string, unknown>>(data: T[]): AnalyticsBuilder<T> {
    return new AnalyticsBuilder<T>(this, data)
  }

  /**
   * Register a materialized table
   */
  registerMaterializedTable(
    name: string,
    table: MaterializedAnalyticsTable<Record<string, unknown>>
  ): void {
    this.materializedTables.set(name, table)
  }

  /**
   * Get a materialized table by name
   */
  getMaterializedTable(
    name: string
  ): MaterializedAnalyticsTable<Record<string, unknown>> | undefined {
    return this.materializedTables.get(name)
  }

  /**
   * List all materialized tables
   */
  listMaterializedTables(): string[] {
    return Array.from(this.materializedTables.keys())
  }

  /**
   * Drop a materialized table
   */
  dropMaterializedTable(name: string): boolean {
    return this.materializedTables.delete(name)
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new Analytics instance
 */
export function createAnalytics(config?: AnalyticsConfig): Analytics {
  return new Analytics(config)
}
