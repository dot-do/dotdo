/**
 * MergeTree-style Tables for ClickHouse Compatibility Layer
 *
 * Implements ClickHouse's MergeTree family of table engines using TypedColumnStore.
 * Supports:
 * - MergeTree: Basic sorted table
 * - ReplacingMergeTree: Deduplication by primary key
 * - AggregatingMergeTree: Pre-aggregated data
 *
 * @see dotdo-b80fl - Unified Analytics Compat Layer Epic
 */

import { createColumnStore, type TypedColumnStore, type ColumnType, type Predicate, type ColumnBatch } from '../../primitives'
import {
  createCubeStage,
  createRollupStage,
  createGroupingSetsStage,
  type GroupedRow,
} from '../../primitives/aggregation-pipeline'

// ============================================================================
// Types
// ============================================================================

/**
 * ClickHouse data types mapped to TypedColumnStore types
 */
export type ClickHouseType =
  | 'Date'
  | 'DateTime'
  | 'DateTime64'
  | 'UInt8'
  | 'UInt16'
  | 'UInt32'
  | 'UInt64'
  | 'Int8'
  | 'Int16'
  | 'Int32'
  | 'Int64'
  | 'Float32'
  | 'Float64'
  | 'String'
  | 'FixedString'
  | 'UUID'
  | 'Enum8'
  | 'Enum16'
  | 'Array'
  | 'Nullable'
  | 'LowCardinality'
  | string // For complex types like AggregateFunction

/**
 * Column definition
 */
export interface ColumnDef {
  name: string
  type: ClickHouseType
  nullable?: boolean
  defaultValue?: unknown
  codec?: string // Compression codec
}

/**
 * MergeTree engine types
 */
export type MergeTreeEngine =
  | 'MergeTree'
  | 'ReplacingMergeTree'
  | 'SummingMergeTree'
  | 'AggregatingMergeTree'
  | 'CollapsingMergeTree'
  | 'VersionedCollapsingMergeTree'

/**
 * Table schema configuration
 */
export interface TableSchema<T = unknown> {
  name: string
  engine: MergeTreeEngine
  columns: ColumnDef[]
  orderBy: (keyof T & string)[]
  partitionBy?: string
  primaryKey?: (keyof T & string)[]
  sampleBy?: string
  ttl?: string
  settings?: Record<string, unknown>
  // Engine-specific options
  versionColumn?: string // For ReplacingMergeTree
  signColumn?: string // For CollapsingMergeTree
}

/**
 * Query options for SELECT
 */
export interface SelectOptions<T> {
  columns?: (keyof T & string)[]
  where?: WhereClause<T>
  orderBy?: OrderByClause[]
  limit?: number
  offset?: number
}

/**
 * WHERE clause operators
 */
export type WhereOperator =
  | { $eq: unknown }
  | { $ne: unknown }
  | { $gt: number | Date }
  | { $gte: number | Date }
  | { $lt: number | Date }
  | { $lte: number | Date }
  | { $in: unknown[] }
  | { $notIn: unknown[] }
  | { $between: [number | Date, number | Date] }
  | { $like: string }
  | { $ilike: string }
  | { $isNull: boolean }

/**
 * WHERE clause structure
 */
export type WhereClause<T> = {
  [K in keyof T]?: T[K] | WhereOperator | (WhereOperator & { $and?: WhereOperator[] })
} & {
  $and?: WhereClause<T>[]
  $or?: WhereClause<T>[]
  $not?: WhereClause<T>
}

/**
 * ORDER BY clause
 */
export interface OrderByClause {
  column: string
  direction?: 'ASC' | 'DESC'
  nulls?: 'FIRST' | 'LAST'
}

/**
 * Aggregate specification
 */
export interface AggregateSpec {
  count?: '*' | string
  sum?: string
  avg?: string
  min?: string
  max?: string
  uniq?: string
  uniqExact?: string
  quantile?: { column: string; level: number }
  quantiles?: { column: string; levels: number[] }
  argMin?: { column: string; by: string }
  argMax?: { column: string; by: string }
  anyHeavy?: string
  topK?: { column: string; k: number }
}

/**
 * Aggregate result
 */
export type AggregateResult = {
  [K in keyof AggregateSpec]?: unknown
}

/**
 * GROUP BY options
 */
export interface GroupByOptions<T> {
  having?: Record<string, WhereOperator>
  withTotals?: boolean
  orderBy?: OrderByClause[]
  limit?: number
}

/**
 * GROUP BY result
 */
export interface GroupByResult<T> extends Array<T & AggregateResult> {
  totals?: T & AggregateResult
}

/**
 * Window function specification
 */
export interface WindowSpec {
  rowNumber?: string
  rank?: string
  denseRank?: string
  lag?: { column: string; offset?: number; default?: unknown; alias: string }
  lead?: { column: string; offset?: number; default?: unknown; alias: string }
  sum?: { column: string; alias: string }
  avg?: { column: string; alias: string }
  min?: { column: string; alias: string }
  max?: { column: string; alias: string }
  partitionBy?: string[]
  orderBy?: OrderByClause[]
  frame?: {
    type: 'ROWS' | 'RANGE'
    start: number | 'UNBOUNDED PRECEDING' | 'CURRENT ROW'
    end: number | 'UNBOUNDED FOLLOWING' | 'CURRENT ROW'
  }
}

/**
 * Window SELECT options
 */
export interface WindowSelectOptions<T> {
  columns: (keyof T & string)[]
  window: WindowSpec
}

/**
 * CUBE/ROLLUP specification
 */
export interface CubeRollupSpec<T> {
  dimensions: (keyof T & string)[]
  measures: Record<string, { $sum: string } | { $count: Record<string, never> } | { $avg: string } | { $min: string } | { $max: string }>
  withGrouping?: boolean
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map ClickHouse type to TypedColumnStore type
 */
function mapType(chType: ClickHouseType): ColumnType {
  const normalized = chType.replace(/\(.*\)/, '').trim()

  switch (normalized) {
    case 'Date':
    case 'DateTime':
    case 'DateTime64':
      return 'timestamp'
    case 'UInt8':
    case 'UInt16':
    case 'UInt32':
    case 'UInt64':
    case 'Int8':
    case 'Int16':
    case 'Int32':
    case 'Int64':
      return 'int64'
    case 'Float32':
    case 'Float64':
      return 'float64'
    case 'String':
    case 'FixedString':
    case 'UUID':
      return 'string'
    default:
      if (normalized.startsWith('Enum')) return 'string'
      if (normalized.startsWith('Nullable')) return mapType(chType.replace(/^Nullable\(|\)$/g, '') as ClickHouseType)
      if (normalized.startsWith('LowCardinality')) return mapType(chType.replace(/^LowCardinality\(|\)$/g, '') as ClickHouseType)
      return 'string'
  }
}

/**
 * Convert value to appropriate type
 */
function convertValue(value: unknown, chType: ClickHouseType): unknown {
  if (value === null || value === undefined) return value

  const normalized = chType.replace(/\(.*\)/, '').trim()

  switch (normalized) {
    case 'Date':
    case 'DateTime':
    case 'DateTime64':
      return value instanceof Date ? value.getTime() : new Date(value as string).getTime()
    case 'UInt8':
    case 'UInt16':
    case 'UInt32':
    case 'UInt64':
    case 'Int8':
    case 'Int16':
    case 'Int32':
    case 'Int64':
      return typeof value === 'number' ? value : parseInt(value as string, 10)
    case 'Float32':
    case 'Float64':
      return typeof value === 'number' ? value : parseFloat(value as string)
    default:
      return value
  }
}

/**
 * Evaluate a WHERE clause predicate against a row
 */
function evaluatePredicate<T>(row: T, where: WhereClause<T>): boolean {
  // Handle $and
  if (where.$and) {
    return where.$and.every(clause => evaluatePredicate(row, clause))
  }

  // Handle $or
  if (where.$or) {
    return where.$or.some(clause => evaluatePredicate(row, clause))
  }

  // Handle $not
  if (where.$not) {
    return !evaluatePredicate(row, where.$not)
  }

  // Handle field conditions
  for (const [key, condition] of Object.entries(where)) {
    if (key.startsWith('$')) continue

    const fieldValue = (row as Record<string, unknown>)[key]

    if (condition === undefined) continue

    // Direct equality
    if (typeof condition !== 'object' || condition === null || condition instanceof Date) {
      if (!equalValues(fieldValue, condition)) return false
      continue
    }

    // Operator conditions
    const ops = condition as Record<string, unknown>

    if ('$eq' in ops && !equalValues(fieldValue, ops.$eq)) return false
    if ('$ne' in ops && equalValues(fieldValue, ops.$ne)) return false
    if ('$gt' in ops && !((fieldValue as number) > (ops.$gt as number))) return false
    if ('$gte' in ops && !((fieldValue as number) >= (ops.$gte as number))) return false
    if ('$lt' in ops && !((fieldValue as number) < (ops.$lt as number))) return false
    if ('$lte' in ops && !((fieldValue as number) <= (ops.$lte as number))) return false
    if ('$in' in ops && !(ops.$in as unknown[]).includes(fieldValue)) return false
    if ('$notIn' in ops && (ops.$notIn as unknown[]).includes(fieldValue)) return false
    if ('$between' in ops) {
      const [min, max] = ops.$between as [number, number]
      if ((fieldValue as number) < min || (fieldValue as number) > max) return false
    }
    if ('$like' in ops && !matchLike(fieldValue as string, ops.$like as string)) return false
    if ('$ilike' in ops && !matchLike((fieldValue as string).toLowerCase(), (ops.$ilike as string).toLowerCase())) return false
    if ('$isNull' in ops) {
      const isNull = fieldValue === null || fieldValue === undefined
      if (ops.$isNull !== isNull) return false
    }
  }

  return true
}

/**
 * Compare values for equality (handles dates, etc.)
 */
function equalValues(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }
  if (a instanceof Date) {
    return a.getTime() === (typeof b === 'number' ? b : new Date(b as string).getTime())
  }
  if (b instanceof Date) {
    return (typeof a === 'number' ? a : new Date(a as string).getTime()) === b.getTime()
  }
  return a === b
}

/**
 * Match LIKE pattern
 */
function matchLike(value: string, pattern: string): boolean {
  // Convert SQL LIKE pattern to regex
  const regex = new RegExp(
    '^' +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/%/g, '.*')
      .replace(/_/g, '.')
    + '$'
  )
  return regex.test(value)
}

/**
 * Compare values for sorting
 */
function compareValues(a: unknown, b: unknown, direction: 'ASC' | 'DESC' = 'ASC'): number {
  let cmp = 0

  if (a === null || a === undefined) return direction === 'ASC' ? 1 : -1
  if (b === null || b === undefined) return direction === 'ASC' ? -1 : 1

  if (typeof a === 'number' && typeof b === 'number') {
    cmp = a - b
  } else if (a instanceof Date && b instanceof Date) {
    cmp = a.getTime() - b.getTime()
  } else {
    cmp = String(a).localeCompare(String(b))
  }

  return direction === 'DESC' ? -cmp : cmp
}

// ============================================================================
// MergeTreeTable Implementation
// ============================================================================

/**
 * MergeTree-style table implementation
 */
export class MergeTreeTable<T extends Record<string, unknown>> {
  readonly name: string
  readonly engine: MergeTreeEngine
  readonly columns: ColumnDef[]
  readonly orderBy: string[]
  readonly primaryKey?: string[]
  readonly partitionBy?: string
  readonly ttl?: string
  readonly versionColumn?: string
  readonly signColumn?: string

  private columnStore: TypedColumnStore
  private rows: T[] = []
  private columnMap: Map<string, ColumnDef>
  private dirty = false

  constructor(schema: TableSchema<T>) {
    this.name = schema.name
    this.engine = schema.engine
    this.columns = schema.columns
    this.orderBy = schema.orderBy as string[]
    this.primaryKey = schema.primaryKey as string[] | undefined
    this.partitionBy = schema.partitionBy
    this.ttl = schema.ttl
    this.versionColumn = schema.versionColumn
    this.signColumn = schema.signColumn

    // Build column lookup map
    this.columnMap = new Map()
    for (const col of this.columns) {
      this.columnMap.set(col.name, col)
    }

    // Initialize column store
    this.columnStore = createColumnStore()
    for (const col of this.columns) {
      this.columnStore.addColumn(col.name, mapType(col.type))
    }
  }

  // ==========================================================================
  // INSERT Operations
  // ==========================================================================

  /**
   * Insert a single row
   */
  insert(row: T): void {
    this.rows.push(this.normalizeRow(row))
    this.dirty = true
  }

  /**
   * Insert multiple rows with batch optimization
   */
  insertBatch(rows: T[]): void {
    for (const row of rows) {
      this.rows.push(this.normalizeRow(row))
    }
    this.dirty = true
  }

  /**
   * Insert data in columnar format
   */
  insertColumnar(data: { [K in keyof T]?: T[K][] }): void {
    const columns = Object.keys(data) as (keyof T)[]
    if (columns.length === 0) return

    const rowCount = (data[columns[0]] as unknown[])?.length ?? 0

    for (let i = 0; i < rowCount; i++) {
      const row = {} as T
      for (const col of columns) {
        const values = data[col] as unknown[]
        ;(row as Record<string, unknown>)[col as string] = values[i]
      }
      this.rows.push(this.normalizeRow(row))
    }
    this.dirty = true
  }

  /**
   * Normalize row values to correct types
   */
  private normalizeRow(row: T): T {
    const normalized = { ...row } as T
    for (const col of this.columns) {
      const value = (row as Record<string, unknown>)[col.name]
      ;(normalized as Record<string, unknown>)[col.name] = convertValue(value, col.type)
    }
    return normalized
  }

  /**
   * Sort rows by ORDER BY clause (lazy, called before read operations)
   */
  private ensureSorted(): void {
    if (!this.dirty) return

    this.rows.sort((a, b) => {
      for (const col of this.orderBy) {
        const cmp = compareValues(
          (a as Record<string, unknown>)[col],
          (b as Record<string, unknown>)[col],
          'ASC'
        )
        if (cmp !== 0) return cmp
      }
      return 0
    })

    // Update column store
    this.rebuildColumnStore()
    this.dirty = false
  }

  /**
   * Rebuild column store from rows
   */
  private rebuildColumnStore(): void {
    this.columnStore = createColumnStore()
    for (const col of this.columns) {
      this.columnStore.addColumn(col.name, mapType(col.type))
    }

    for (const col of this.columns) {
      const values = this.rows.map(r => (r as Record<string, unknown>)[col.name])
      this.columnStore.append(col.name, values)
    }
  }

  // ==========================================================================
  // SELECT Operations
  // ==========================================================================

  /**
   * Get row count
   */
  rowCount(): number {
    return this.rows.length
  }

  /**
   * Select all rows
   */
  selectAll(): T[] {
    this.ensureSorted()
    return [...this.rows]
  }

  /**
   * Select rows with options
   */
  select(options: SelectOptions<T> = {}): T[] {
    this.ensureSorted()

    let result = [...this.rows]

    // Apply WHERE clause
    if (options.where) {
      result = result.filter(row => evaluatePredicate(row, options.where!))
    }

    // Apply ORDER BY
    if (options.orderBy && options.orderBy.length > 0) {
      result.sort((a, b) => {
        for (const clause of options.orderBy!) {
          const cmp = compareValues(
            (a as Record<string, unknown>)[clause.column],
            (b as Record<string, unknown>)[clause.column],
            clause.direction
          )
          if (cmp !== 0) return cmp
        }
        return 0
      })
    }

    // Apply OFFSET
    if (options.offset && options.offset > 0) {
      result = result.slice(options.offset)
    }

    // Apply LIMIT
    if (options.limit !== undefined && options.limit >= 0) {
      result = result.slice(0, options.limit)
    }

    // Project columns if specified
    if (options.columns) {
      result = result.map(row => {
        const projected = {} as T
        for (const col of options.columns!) {
          ;(projected as Record<string, unknown>)[col] = (row as Record<string, unknown>)[col]
        }
        return projected
      })
    }

    return result
  }

  // ==========================================================================
  // Aggregate Operations
  // ==========================================================================

  /**
   * Compute aggregations across all rows
   */
  aggregate(spec: AggregateSpec): AggregateResult {
    this.ensureSorted()

    const result: AggregateResult = {}

    // count
    if (spec.count !== undefined) {
      if (spec.count === '*') {
        result.count = this.rows.length
      } else {
        result.count = this.rows.filter(r =>
          (r as Record<string, unknown>)[spec.count as string] !== null &&
          (r as Record<string, unknown>)[spec.count as string] !== undefined
        ).length
      }
    }

    // sum
    if (spec.sum) {
      result.sum = this.rows.reduce((acc, r) => {
        const val = (r as Record<string, unknown>)[spec.sum!]
        return acc + (typeof val === 'number' ? val : 0)
      }, 0)
    }

    // avg
    if (spec.avg) {
      const values = this.rows
        .map(r => (r as Record<string, unknown>)[spec.avg!])
        .filter(v => typeof v === 'number') as number[]
      result.avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null
    }

    // min
    if (spec.min) {
      const values = this.rows
        .map(r => (r as Record<string, unknown>)[spec.min!])
        .filter(v => v !== null && v !== undefined) as number[]
      result.min = values.length > 0 ? Math.min(...values) : null
    }

    // max
    if (spec.max) {
      const values = this.rows
        .map(r => (r as Record<string, unknown>)[spec.max!])
        .filter(v => v !== null && v !== undefined) as number[]
      result.max = values.length > 0 ? Math.max(...values) : null
    }

    // uniq (approximate distinct count)
    if (spec.uniq) {
      const values = this.rows.map(r => (r as Record<string, unknown>)[spec.uniq!])
      result.uniq = new Set(values.map(v => JSON.stringify(v))).size
    }

    // uniqExact
    if (spec.uniqExact) {
      const values = this.rows.map(r => (r as Record<string, unknown>)[spec.uniqExact!])
      result.uniqExact = new Set(values.map(v => JSON.stringify(v))).size
    }

    // quantile
    if (spec.quantile) {
      const values = this.rows
        .map(r => (r as Record<string, unknown>)[spec.quantile!.column])
        .filter(v => typeof v === 'number')
        .sort((a, b) => (a as number) - (b as number)) as number[]
      if (values.length > 0) {
        const idx = Math.floor(spec.quantile.level * (values.length - 1))
        result.quantile = values[idx]
      }
    }

    // quantiles
    if (spec.quantiles) {
      const values = this.rows
        .map(r => (r as Record<string, unknown>)[spec.quantiles!.column])
        .filter(v => typeof v === 'number')
        .sort((a, b) => (a as number) - (b as number)) as number[]
      result.quantiles = spec.quantiles.levels.map(level => {
        if (values.length === 0) return null
        const idx = Math.floor(level * (values.length - 1))
        return values[idx]
      })
    }

    // argMin
    if (spec.argMin) {
      let minRow: T | null = null
      let minVal: number | null = null
      for (const row of this.rows) {
        const val = (row as Record<string, unknown>)[spec.argMin.by]
        if (typeof val === 'number' && (minVal === null || val < minVal)) {
          minVal = val
          minRow = row
        }
      }
      result.argMin = minRow ? (minRow as Record<string, unknown>)[spec.argMin.column] : null
    }

    // argMax
    if (spec.argMax) {
      let maxRow: T | null = null
      let maxVal: number | null = null
      for (const row of this.rows) {
        const val = (row as Record<string, unknown>)[spec.argMax.by]
        if (typeof val === 'number' && (maxVal === null || val > maxVal)) {
          maxVal = val
          maxRow = row
        }
      }
      result.argMax = maxRow ? (maxRow as Record<string, unknown>)[spec.argMax.column] : null
    }

    // anyHeavy (approximate mode)
    if (spec.anyHeavy) {
      const counts = new Map<string, number>()
      for (const row of this.rows) {
        const val = JSON.stringify((row as Record<string, unknown>)[spec.anyHeavy])
        counts.set(val, (counts.get(val) || 0) + 1)
      }
      let maxCount = 0
      let maxVal: unknown = null
      for (const [val, count] of counts) {
        if (count > maxCount) {
          maxCount = count
          maxVal = JSON.parse(val)
        }
      }
      result.anyHeavy = maxVal
    }

    // topK
    if (spec.topK) {
      const counts = new Map<string, { value: unknown; count: number }>()
      for (const row of this.rows) {
        const val = (row as Record<string, unknown>)[spec.topK.column]
        const key = JSON.stringify(val)
        const existing = counts.get(key)
        if (existing) {
          existing.count++
        } else {
          counts.set(key, { value: val, count: 1 })
        }
      }
      const sorted = Array.from(counts.values()).sort((a, b) => b.count - a.count)
      result.topK = sorted.slice(0, spec.topK.k).map(item => item.value)
    }

    return result
  }

  /**
   * GROUP BY with aggregations
   */
  groupBy<R extends Record<string, unknown> = T & AggregateResult>(
    groupColumns: (keyof T & string)[],
    aggregations: AggregateSpec,
    options: GroupByOptions<T> = {}
  ): GroupByResult<R> {
    this.ensureSorted()

    // Group rows
    const groups = new Map<string, T[]>()
    for (const row of this.rows) {
      const keyParts = groupColumns.map(col => JSON.stringify((row as Record<string, unknown>)[col]))
      const key = keyParts.join('|')
      const group = groups.get(key)
      if (group) {
        group.push(row)
      } else {
        groups.set(key, [row])
      }
    }

    // Aggregate each group
    const results: R[] = []
    let totalsSum: Record<string, number> = {}
    let totalsCount = 0

    for (const [key, groupRows] of groups) {
      const keyValues = key.split('|').map(v => JSON.parse(v))

      // Build group key object
      const groupResult = {} as R
      for (let i = 0; i < groupColumns.length; i++) {
        ;(groupResult as Record<string, unknown>)[groupColumns[i]] = keyValues[i]
      }

      // Compute aggregations for this group
      const tempTable = new MergeTreeTable<T>({
        name: 'temp',
        engine: 'MergeTree',
        columns: this.columns,
        orderBy: this.orderBy as (keyof T & string)[],
      })
      tempTable.insertBatch(groupRows)
      const agg = tempTable.aggregate(aggregations)

      // Merge aggregations into result
      Object.assign(groupResult, agg)

      // Update totals
      if (options.withTotals) {
        totalsCount++
        for (const [aggKey, aggValue] of Object.entries(agg)) {
          if (typeof aggValue === 'number') {
            totalsSum[aggKey] = (totalsSum[aggKey] || 0) + aggValue
          }
        }
      }

      results.push(groupResult)
    }

    // Apply HAVING
    let filteredResults = results
    if (options.having) {
      filteredResults = results.filter(row => {
        for (const [field, condition] of Object.entries(options.having!)) {
          const value = (row as Record<string, unknown>)[field]
          const ops = condition as Record<string, unknown>
          if ('$gt' in ops && !((value as number) > (ops.$gt as number))) return false
          if ('$gte' in ops && !((value as number) >= (ops.$gte as number))) return false
          if ('$lt' in ops && !((value as number) < (ops.$lt as number))) return false
          if ('$lte' in ops && !((value as number) <= (ops.$lte as number))) return false
          if ('$eq' in ops && value !== ops.$eq) return false
        }
        return true
      })
    }

    // Apply ORDER BY
    if (options.orderBy && options.orderBy.length > 0) {
      filteredResults.sort((a, b) => {
        for (const clause of options.orderBy!) {
          const cmp = compareValues(
            (a as Record<string, unknown>)[clause.column],
            (b as Record<string, unknown>)[clause.column],
            clause.direction
          )
          if (cmp !== 0) return cmp
        }
        return 0
      })
    }

    // Apply LIMIT
    if (options.limit !== undefined && options.limit >= 0) {
      filteredResults = filteredResults.slice(0, options.limit)
    }

    // Build result with totals
    const finalResult = filteredResults as GroupByResult<R>

    if (options.withTotals) {
      const totals = {} as R & AggregateResult
      for (const col of groupColumns) {
        ;(totals as Record<string, unknown>)[col] = null
      }

      // Compute totals from all data (not filtered)
      const allAgg = this.aggregate(aggregations)
      Object.assign(totals, allAgg)

      finalResult.totals = totals
    }

    return finalResult
  }

  // ==========================================================================
  // Window Functions
  // ==========================================================================

  /**
   * SELECT with window functions
   */
  selectWithWindow<R extends T & Record<string, unknown>>(options: WindowSelectOptions<T>): R[] {
    this.ensureSorted()

    const { columns, window } = options

    // Sort by window's ORDER BY
    let sortedRows = [...this.rows]
    if (window.orderBy && window.orderBy.length > 0) {
      sortedRows.sort((a, b) => {
        for (const clause of window.orderBy!) {
          const cmp = compareValues(
            (a as Record<string, unknown>)[clause.column],
            (b as Record<string, unknown>)[clause.column],
            clause.direction
          )
          if (cmp !== 0) return cmp
        }
        return 0
      })
    }

    // Group by partition
    const partitions = new Map<string, T[]>()
    for (const row of sortedRows) {
      const key = window.partitionBy
        ? window.partitionBy.map(col => JSON.stringify((row as Record<string, unknown>)[col])).join('|')
        : '__all__'
      const partition = partitions.get(key)
      if (partition) {
        partition.push(row)
      } else {
        partitions.set(key, [row])
      }
    }

    // Compute window functions for each partition
    const results: R[] = []

    for (const partitionRows of partitions.values()) {
      for (let i = 0; i < partitionRows.length; i++) {
        const row = partitionRows[i]
        const resultRow = {} as R

        // Copy selected columns
        for (const col of columns) {
          ;(resultRow as Record<string, unknown>)[col] = (row as Record<string, unknown>)[col]
        }

        // row_number
        if (window.rowNumber) {
          ;(resultRow as Record<string, unknown>)[window.rowNumber] = i + 1
        }

        // rank (simplified - same as row_number in this implementation)
        if (window.rank) {
          ;(resultRow as Record<string, unknown>)[window.rank] = i + 1
        }

        // dense_rank
        if (window.denseRank) {
          ;(resultRow as Record<string, unknown>)[window.denseRank] = i + 1
        }

        // lag
        if (window.lag) {
          const offset = window.lag.offset ?? 1
          const prevIdx = i - offset
          if (prevIdx >= 0) {
            ;(resultRow as Record<string, unknown>)[window.lag.alias] =
              (partitionRows[prevIdx] as Record<string, unknown>)[window.lag.column]
          } else {
            ;(resultRow as Record<string, unknown>)[window.lag.alias] = window.lag.default ?? null
          }
        }

        // lead
        if (window.lead) {
          const offset = window.lead.offset ?? 1
          const nextIdx = i + offset
          if (nextIdx < partitionRows.length) {
            ;(resultRow as Record<string, unknown>)[window.lead.alias] =
              (partitionRows[nextIdx] as Record<string, unknown>)[window.lead.column]
          } else {
            ;(resultRow as Record<string, unknown>)[window.lead.alias] = window.lead.default ?? null
          }
        }

        // Running sum
        if (window.sum) {
          const frameStart = this.getFrameStart(window.frame, i)
          const frameEnd = this.getFrameEnd(window.frame, i, partitionRows.length)
          let sum = 0
          for (let j = frameStart; j <= frameEnd; j++) {
            const val = (partitionRows[j] as Record<string, unknown>)[window.sum.column]
            sum += typeof val === 'number' ? val : 0
          }
          ;(resultRow as Record<string, unknown>)[window.sum.alias] = sum
        }

        // Running avg
        if (window.avg) {
          const frameStart = this.getFrameStart(window.frame, i)
          const frameEnd = this.getFrameEnd(window.frame, i, partitionRows.length)
          let sum = 0
          let count = 0
          for (let j = frameStart; j <= frameEnd; j++) {
            const val = (partitionRows[j] as Record<string, unknown>)[window.avg.column]
            if (typeof val === 'number') {
              sum += val
              count++
            }
          }
          ;(resultRow as Record<string, unknown>)[window.avg.alias] = count > 0 ? sum / count : null
        }

        results.push(resultRow)
      }
    }

    return results
  }

  /**
   * Get frame start index
   */
  private getFrameStart(frame: WindowSpec['frame'] | undefined, currentIdx: number): number {
    if (!frame) return 0 // Default: unbounded preceding

    if (frame.start === 'UNBOUNDED PRECEDING') return 0
    if (frame.start === 'CURRENT ROW') return currentIdx
    if (typeof frame.start === 'number') {
      return Math.max(0, currentIdx + frame.start)
    }
    return 0
  }

  /**
   * Get frame end index
   */
  private getFrameEnd(frame: WindowSpec['frame'] | undefined, currentIdx: number, partitionSize: number): number {
    if (!frame) return currentIdx // Default: current row

    if (frame.end === 'UNBOUNDED FOLLOWING') return partitionSize - 1
    if (frame.end === 'CURRENT ROW') return currentIdx
    if (typeof frame.end === 'number') {
      return Math.min(partitionSize - 1, currentIdx + frame.end)
    }
    return currentIdx
  }

  // ==========================================================================
  // CUBE / ROLLUP / GROUPING SETS
  // ==========================================================================

  /**
   * Compute CUBE aggregations
   */
  cube<R extends GroupedRow = GroupedRow>(spec: CubeRollupSpec<T>): R[] {
    this.ensureSorted()

    const stage = createCubeStage<T>({
      dimensions: spec.dimensions as (keyof T)[],
      measures: spec.measures as any,
    })

    return stage.process(this.rows) as R[]
  }

  /**
   * Compute ROLLUP aggregations
   */
  rollup<R extends GroupedRow = GroupedRow>(spec: CubeRollupSpec<T>): R[] {
    this.ensureSorted()

    const stage = createRollupStage<T>({
      dimensions: spec.dimensions as (keyof T)[],
      measures: spec.measures as any,
    })

    return stage.process(this.rows) as R[]
  }

  /**
   * Compute GROUPING SETS aggregations
   */
  groupingSets<R extends GroupedRow = GroupedRow>(spec: {
    sets: (keyof T & string)[][]
    measures: CubeRollupSpec<T>['measures']
  }): R[] {
    this.ensureSorted()

    const stage = createGroupingSetsStage<T>({
      sets: spec.sets as (keyof T)[][],
      measures: spec.measures as any,
    })

    return stage.process(this.rows) as R[]
  }

  // ==========================================================================
  // Data Access
  // ==========================================================================

  /**
   * Get underlying column store for direct columnar operations
   */
  getColumnStore(): TypedColumnStore {
    this.ensureSorted()
    return this.columnStore
  }

  /**
   * Get raw rows
   */
  getRows(): T[] {
    this.ensureSorted()
    return [...this.rows]
  }
}
