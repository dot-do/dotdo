/**
 * Cross-Source Join Implementation
 *
 * Provides cross-source join execution with support for:
 * - INNER, LEFT, RIGHT, FULL outer joins
 * - Semi-joins and anti-joins
 * - Cross (Cartesian) joins
 * - Sort-merge join execution
 * - Data type conversion between sources
 * - Streaming result support
 *
 * @see dotdo-fv8v0
 * @module db/primitives/federated-query/cross-source-join
 */

import type { Catalog } from './index'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Extended join types including semi/anti joins
 */
export type ExtendedJoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'SEMI' | 'ANTI' | 'CROSS'

/**
 * Table reference for cross-source join
 */
export interface CrossSourceTableRef {
  source: string
  table: string
}

/**
 * Join key specification
 */
export interface CrossSourceJoinKey {
  left: string
  right: string
}

/**
 * Column specification with optional alias
 */
export type ColumnSpec = string | { column: string; alias: string }

/**
 * Type conversion rule for cross-source data
 */
export interface TypeConversionRule {
  column: string
  from: string
  to: string
  format?: string
}

/**
 * Streaming options
 */
export interface StreamingOptions {
  batchSize?: number
}

/**
 * Cross-source join configuration
 */
export interface CrossSourceJoinConfig {
  left: CrossSourceTableRef
  right: CrossSourceTableRef
  joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'
  keys: CrossSourceJoinKey
  leftPredicates?: Array<{ column: string; op: string; value: unknown }>
  rightPredicates?: Array<{ column: string; op: string; value: unknown }>
  columns?: ColumnSpec[]
  typeConversions?: TypeConversionRule[]
  forceStrategy?: 'broadcast' | 'shuffle' | 'nested_loop' | 'sort_merge'
  timeout?: number
  maxRetries?: number
  collectStats?: boolean
}

/**
 * Semi-join configuration
 */
export interface SemiJoinConfig {
  left: CrossSourceTableRef
  right: CrossSourceTableRef
  keys: CrossSourceJoinKey
  leftPredicates?: Array<{ column: string; op: string; value: unknown }>
  rightPredicates?: Array<{ column: string; op: string; value: unknown }>
  collectStats?: boolean
}

/**
 * Anti-join configuration
 */
export interface AntiJoinConfig {
  left: CrossSourceTableRef
  right: CrossSourceTableRef
  keys: CrossSourceJoinKey
  leftPredicates?: Array<{ column: string; op: string; value: unknown }>
  rightPredicates?: Array<{ column: string; op: string; value: unknown }>
}

/**
 * Cross (Cartesian) join configuration
 */
export interface CrossJoinConfig {
  left: CrossSourceTableRef
  right: CrossSourceTableRef
  leftPredicates?: Array<{ column: string; op: string; value: unknown }>
  rightPredicates?: Array<{ column: string; op: string; value: unknown }>
  limit?: number
  maxRows?: number
  columns?: ColumnSpec[]
}

/**
 * Sort-merge join configuration
 */
export interface SortMergeJoinConfig {
  left: CrossSourceTableRef
  right: CrossSourceTableRef
  joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'
  keys: CrossSourceJoinKey
  leftSorted: boolean
  rightSorted: boolean
  sortDirection?: 'ASC' | 'DESC'
  leftPredicates?: Array<{ column: string; op: string; value: unknown }>
  rightPredicates?: Array<{ column: string; op: string; value: unknown }>
}

/**
 * Cross-source join statistics
 */
export interface CrossSourceJoinStats {
  strategy: string
  leftRowsScanned: number
  rightRowsScanned: number
  outputRows: number
  executionTimeMs: number
  retriesAttempted?: number
  memoryUsedBytes?: number
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

// =============================================================================
// DATA TYPE CONVERTER
// =============================================================================

/**
 * DataTypeConverter - Handles type conversion between different sources
 */
export class DataTypeConverter {
  private rules: Map<string, (value: unknown, options?: Record<string, unknown>) => unknown> = new Map()

  constructor() {
    this.registerDefaultRules()
  }

  private registerDefaultRules(): void {
    // String to number
    this.rules.set('string->number', (v) => {
      if (v === null || v === undefined) return null
      return parseFloat(String(v))
    })

    this.rules.set('string->integer', (v) => {
      if (v === null || v === undefined) return null
      return parseInt(String(v), 10)
    })

    // Number to string
    this.rules.set('number->string', (v) => {
      if (v === null || v === undefined) return null
      return String(v)
    })

    // String to boolean
    this.rules.set('string->boolean', (v) => {
      if (v === null || v === undefined) return null
      const str = String(v).toLowerCase()
      return str === 'true' || str === '1' || str === 'yes'
    })

    // Number to boolean
    this.rules.set('number->boolean', (v) => {
      if (v === null || v === undefined) return null
      return v !== 0
    })

    // Boolean to string
    this.rules.set('boolean->string', (v) => {
      if (v === null || v === undefined) return null
      return String(v)
    })

    // Timestamp to date
    this.rules.set('timestamp->date', (v, opts) => {
      if (v === null || v === undefined) return null
      const date = new Date(String(v))
      const format = opts?.format as string || 'YYYY-MM-DD'
      if (format === 'YYYY-MM-DD') {
        return date.toISOString().split('T')[0]
      }
      return date.toISOString()
    })

    // Date to timestamp
    this.rules.set('date->timestamp', (v) => {
      if (v === null || v === undefined) return null
      return new Date(String(v)).toISOString()
    })

    // String to JSON (parse JSON string into object)
    this.rules.set('string->json', (v) => {
      if (v === null || v === undefined) return null
      try {
        return JSON.parse(String(v))
      } catch {
        return null
      }
    })

    // JSON to string (stringify object to JSON string)
    this.rules.set('json->string', (v) => {
      if (v === null || v === undefined) return null
      return JSON.stringify(v)
    })
  }

  convert(value: unknown, from: string, to: string, options?: Record<string, unknown>): unknown {
    if (value === null || value === undefined) return null

    const key = `${from}->${to}`
    const rule = this.rules.get(key)

    if (rule) {
      return rule(value, options)
    }

    // No conversion found, return as-is
    return value
  }

  /**
   * Apply multiple conversions to a row
   */
  applyConversions(row: Record<string, unknown>, conversions: TypeConversionRule[]): Record<string, unknown> {
    const result = { ...row }
    for (const conv of conversions) {
      if (conv.column in result) {
        result[conv.column] = this.convert(result[conv.column], conv.from, conv.to, { format: conv.format })
      }
    }
    return result
  }

  registerRule(rule: TypeConversionRule & { convert: (value: unknown, options?: Record<string, unknown>) => unknown }): void {
    const key = `${rule.from}->${rule.to}`
    this.rules.set(key, rule.convert)
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Apply predicates to filter rows
 */
function applyPredicates(
  rows: Record<string, unknown>[],
  predicates?: Array<{ column: string; op: string; value: unknown }>
): Record<string, unknown>[] {
  if (!predicates || predicates.length === 0) return rows

  return rows.filter((row) => {
    return predicates.every((pred) => {
      const value = row[pred.column]
      switch (pred.op) {
        case '=':
          return value === pred.value
        case '!=':
          return value !== pred.value
        case '>':
          return (value as number) > (pred.value as number)
        case '<':
          return (value as number) < (pred.value as number)
        case '>=':
          return (value as number) >= (pred.value as number)
        case '<=':
          return (value as number) <= (pred.value as number)
        case 'LIKE':
          if (typeof value !== 'string' || typeof pred.value !== 'string') return false
          const regex = new RegExp(pred.value.replace(/%/g, '.*').replace(/_/g, '.'), 'i')
          return regex.test(value)
        case 'IN':
          return Array.isArray(pred.value) && pred.value.includes(value)
        case 'NOT IN':
          return Array.isArray(pred.value) && !pred.value.includes(value)
        default:
          return true
      }
    })
  })
}

/**
 * Create a null row from a sample row
 */
function createNullRow(sample: Record<string, unknown>): Record<string, unknown> {
  const nullRow: Record<string, unknown> = {}
  for (const key of Object.keys(sample)) {
    nullRow[key] = null
  }
  return nullRow
}

/**
 * Extract the column name from a potentially qualified key like "db.table.column"
 * Returns the last segment (the actual column name)
 */
function getColumnName(qualifiedKey: string): string {
  const parts = qualifiedKey.split('.')
  return parts[parts.length - 1]!
}

/**
 * Sort rows by a key
 */
function sortRows(
  rows: Record<string, unknown>[],
  key: string,
  direction: 'ASC' | 'DESC' = 'ASC'
): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const aVal = a[key]
    const bVal = b[key]

    if (aVal === null || aVal === undefined) return direction === 'ASC' ? 1 : -1
    if (bVal === null || bVal === undefined) return direction === 'ASC' ? -1 : 1

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return direction === 'ASC' ? aVal - bVal : bVal - aVal
    }

    const aStr = String(aVal)
    const bStr = String(bVal)
    const cmp = aStr.localeCompare(bStr)
    return direction === 'ASC' ? cmp : -cmp
  })
}

// =============================================================================
// CROSS-SOURCE JOIN CLASS
// =============================================================================

/**
 * CrossSourceJoin - Main class for executing cross-source joins
 */
export class CrossSourceJoin {
  constructor(private catalog: Catalog) {}

  async execute(config: CrossSourceJoinConfig): Promise<CrossSourceJoinResult> {
    const startTime = performance.now()

    const leftAdapter = this.catalog.getAdapter(config.left.source)
    const rightAdapter = this.catalog.getAdapter(config.right.source)

    if (!leftAdapter) {
      throw new Error(`No adapter for source: ${config.left.source}`)
    }
    if (!rightAdapter) {
      throw new Error(`No adapter for source: ${config.right.source}`)
    }

    // Execute queries
    const [leftResult, rightResult] = await Promise.all([
      leftAdapter.execute({ table: config.left.table }),
      rightAdapter.execute({ table: config.right.table }),
    ])

    // Apply predicates
    let leftRows = applyPredicates(leftResult.rows, config.leftPredicates)
    let rightRows = applyPredicates(rightResult.rows, config.rightPredicates)

    // Apply type conversions
    if (config.typeConversions) {
      const converter = new DataTypeConverter()
      for (const rule of config.typeConversions) {
        leftRows = leftRows.map((row) => {
          if (rule.column in row) {
            return {
              ...row,
              [rule.column]: converter.convert(row[rule.column], rule.from, rule.to, { format: rule.format }),
            }
          }
          return row
        })
        rightRows = rightRows.map((row) => {
          if (rule.column in row) {
            return {
              ...row,
              [rule.column]: converter.convert(row[rule.column], rule.from, rule.to, { format: rule.format }),
            }
          }
          return row
        })
      }
    }

    // Execute join - handle qualified column names like "db.table.column"
    const leftKey = getColumnName(config.keys.left)
    const rightKey = getColumnName(config.keys.right)

    const results = this.executeJoin(leftRows, rightRows, leftKey, rightKey, config.joinType)

    // Apply column projection
    let finalRows = results
    if (config.columns) {
      finalRows = results.map((row) => {
        const projected: Record<string, unknown> = {}
        for (const col of config.columns!) {
          if (typeof col === 'string') {
            projected[col] = row[col]
          } else {
            projected[col.alias] = row[col.column]
          }
        }
        return projected
      })
    }

    // Return stats only if collectStats is not explicitly false
    if (config.collectStats === false) {
      return { rows: finalRows }
    }

    const stats: CrossSourceJoinStats = {
      strategy: config.forceStrategy || 'nested_loop',
      leftRowsScanned: leftRows.length,
      rightRowsScanned: rightRows.length,
      outputRows: finalRows.length,
      executionTimeMs: performance.now() - startTime,
    }

    // Add memory stats if explicitly collecting stats
    if (config.collectStats) {
      stats.memoryUsedBytes = JSON.stringify(finalRows).length * 2 // Rough estimate
    }

    return { rows: finalRows, stats }
  }

  private executeJoin(
    left: Record<string, unknown>[],
    right: Record<string, unknown>[],
    leftKey: string,
    rightKey: string,
    joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'
  ): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = []
    const matchedRight = new Set<number>()

    // Build hash table for right side
    const rightIndex = new Map<unknown, Record<string, unknown>[]>()
    for (const row of right) {
      const key = row[rightKey]
      const existing = rightIndex.get(key)
      if (existing) {
        existing.push(row)
      } else {
        rightIndex.set(key, [row])
      }
    }

    // Process left rows
    for (const leftRow of left) {
      const key = leftRow[leftKey]
      const matches = rightIndex.get(key)

      if (matches && matches.length > 0) {
        for (let i = 0; i < right.length; i++) {
          if (right[i]![rightKey] === key) {
            matchedRight.add(i)
          }
        }
        for (const rightRow of matches) {
          results.push({ ...leftRow, ...rightRow })
        }
      } else if (joinType === 'LEFT' || joinType === 'FULL') {
        const nullRight = right.length > 0 ? createNullRow(right[0]!) : {}
        results.push({ ...leftRow, ...nullRight })
      }
    }

    // Handle RIGHT and FULL - add unmatched right rows
    if (joinType === 'RIGHT' || joinType === 'FULL') {
      for (let i = 0; i < right.length; i++) {
        if (!matchedRight.has(i)) {
          const nullLeft = left.length > 0 ? createNullRow(left[0]!) : {}
          results.push({ ...nullLeft, ...right[i]! })
        }
      }
    }

    return results
  }

  async *stream(
    config: CrossSourceJoinConfig,
    options?: StreamingOptions
  ): AsyncGenerator<CrossSourceJoinResult, void, unknown> {
    const batchSize = options?.batchSize || 1000
    const result = await this.execute(config)

    for (let i = 0; i < result.rows.length; i += batchSize) {
      const batch = result.rows.slice(i, i + batchSize)
      const isLast = i + batchSize >= result.rows.length

      yield {
        rows: batch,
        stats: isLast ? result.stats : undefined,
        batchIndex: Math.floor(i / batchSize),
        isComplete: isLast,
      }
    }
  }
}

// =============================================================================
// STANDALONE FUNCTIONS
// =============================================================================

/**
 * Create a CrossSourceJoin instance
 */
export function createCrossSourceJoin(catalog: Catalog): CrossSourceJoin {
  return new CrossSourceJoin(catalog)
}

/**
 * Execute a cross-source join
 */
export async function executeCrossSourceJoin(
  catalog: Catalog,
  config: CrossSourceJoinConfig
): Promise<CrossSourceJoinResult> {
  const join = new CrossSourceJoin(catalog)
  return join.execute(config)
}

/**
 * Stream cross-source join results
 */
export async function* streamCrossSourceJoin(
  catalog: Catalog,
  config: CrossSourceJoinConfig,
  options?: StreamingOptions
): AsyncGenerator<CrossSourceJoinResult, void, unknown> {
  const join = new CrossSourceJoin(catalog)
  yield* join.stream(config, options)
}

/**
 * Execute a semi-join (return left rows that have matches in right)
 */
export async function executeSemiJoin(
  catalog: Catalog,
  config: SemiJoinConfig
): Promise<CrossSourceJoinResult> {
  const startTime = performance.now()

  const leftAdapter = catalog.getAdapter(config.left.source)
  const rightAdapter = catalog.getAdapter(config.right.source)

  if (!leftAdapter) throw new Error(`No adapter for source: ${config.left.source}`)
  if (!rightAdapter) throw new Error(`No adapter for source: ${config.right.source}`)

  const [leftResult, rightResult] = await Promise.all([
    leftAdapter.execute({ table: config.left.table }),
    rightAdapter.execute({ table: config.right.table }),
  ])

  let leftRows = applyPredicates(leftResult.rows, config.leftPredicates)
  const rightRows = applyPredicates(rightResult.rows, config.rightPredicates)

  // Build set of right keys
  const rightKeys = new Set(rightRows.map((r) => r[config.keys.right]))

  // Filter left rows that have matching keys
  const results = leftRows.filter((row) => rightKeys.has(row[config.keys.left]))

  if (config.collectStats) {
    const stats: CrossSourceJoinStats = {
      strategy: 'semi_join',
      leftRowsScanned: leftRows.length,
      rightRowsScanned: rightRows.length,
      outputRows: results.length,
      executionTimeMs: performance.now() - startTime,
    }
    return { rows: results, stats }
  }

  return { rows: results }
}

/**
 * Execute an anti-join (return left rows that have NO matches in right)
 */
export async function executeAntiJoin(
  catalog: Catalog,
  config: AntiJoinConfig
): Promise<CrossSourceJoinResult> {
  const leftAdapter = catalog.getAdapter(config.left.source)
  const rightAdapter = catalog.getAdapter(config.right.source)

  if (!leftAdapter) throw new Error(`No adapter for source: ${config.left.source}`)
  if (!rightAdapter) throw new Error(`No adapter for source: ${config.right.source}`)

  const [leftResult, rightResult] = await Promise.all([
    leftAdapter.execute({ table: config.left.table }),
    rightAdapter.execute({ table: config.right.table }),
  ])

  let leftRows = applyPredicates(leftResult.rows, config.leftPredicates)
  const rightRows = applyPredicates(rightResult.rows, config.rightPredicates)

  // Build set of right keys
  const rightKeys = new Set(rightRows.map((r) => r[config.keys.right]))

  // Filter left rows that do NOT have matching keys
  const results = leftRows.filter((row) => !rightKeys.has(row[config.keys.left]))

  return { rows: results }
}

/**
 * Execute a cross (Cartesian) join
 */
export async function executeCrossJoin(
  catalog: Catalog,
  config: CrossJoinConfig
): Promise<CrossSourceJoinResult> {
  const leftAdapter = catalog.getAdapter(config.left.source)
  const rightAdapter = catalog.getAdapter(config.right.source)

  if (!leftAdapter) throw new Error(`No adapter for source: ${config.left.source}`)
  if (!rightAdapter) throw new Error(`No adapter for source: ${config.right.source}`)

  const [leftResult, rightResult] = await Promise.all([
    leftAdapter.execute({ table: config.left.table }),
    rightAdapter.execute({ table: config.right.table }),
  ])

  let leftRows = applyPredicates(leftResult.rows, config.leftPredicates)
  let rightRows = applyPredicates(rightResult.rows, config.rightPredicates)

  // Check maxRows before execution to avoid OOM
  if (config.maxRows !== undefined) {
    const expectedRows = leftRows.length * rightRows.length
    if (expectedRows > config.maxRows) {
      throw new Error(
        `Cross join would produce ${expectedRows} rows, exceeding maxRows limit of ${config.maxRows}`
      )
    }
  }

  const results: Record<string, unknown>[] = []
  const limit = config.limit || Infinity

  outer: for (const leftRow of leftRows) {
    for (const rightRow of rightRows) {
      results.push({ ...leftRow, ...rightRow })
      if (results.length >= limit) break outer
    }
  }

  // Apply column projection if specified
  let finalRows = results
  if (config.columns) {
    finalRows = results.map((row) => {
      const projected: Record<string, unknown> = {}
      for (const col of config.columns!) {
        if (typeof col === 'string') {
          projected[col] = row[col]
        } else {
          projected[col.alias] = row[col.column]
        }
      }
      return projected
    })
  }

  return { rows: finalRows }
}

/**
 * Execute a sort-merge join
 */
export async function executeSortMergeJoin(
  catalog: Catalog,
  config: SortMergeJoinConfig
): Promise<CrossSourceJoinResult> {
  const startTime = performance.now()

  const leftAdapter = catalog.getAdapter(config.left.source)
  const rightAdapter = catalog.getAdapter(config.right.source)

  if (!leftAdapter) throw new Error(`No adapter for source: ${config.left.source}`)
  if (!rightAdapter) throw new Error(`No adapter for source: ${config.right.source}`)

  const [leftResult, rightResult] = await Promise.all([
    leftAdapter.execute({ table: config.left.table }),
    rightAdapter.execute({ table: config.right.table }),
  ])

  let leftRows = applyPredicates(leftResult.rows, config.leftPredicates)
  let rightRows = applyPredicates(rightResult.rows, config.rightPredicates)

  const leftKey = config.keys.left
  const rightKey = config.keys.right
  const direction = config.sortDirection || 'ASC'

  // Sort if not already sorted
  if (!config.leftSorted) {
    leftRows = sortRows(leftRows, leftKey, direction)
  }
  if (!config.rightSorted) {
    rightRows = sortRows(rightRows, rightKey, direction)
  }

  // Merge
  const results = mergeSortedTables(leftRows, rightRows, leftKey, rightKey, config.joinType, direction)

  const stats: CrossSourceJoinStats = {
    strategy: 'sort_merge',
    leftRowsScanned: leftRows.length,
    rightRowsScanned: rightRows.length,
    outputRows: results.length,
    executionTimeMs: performance.now() - startTime,
  }

  return { rows: results, stats }
}

/**
 * Merge two sorted tables using two-pointer technique
 */
function mergeSortedTables(
  left: Record<string, unknown>[],
  right: Record<string, unknown>[],
  leftKey: string,
  rightKey: string,
  joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL',
  direction: 'ASC' | 'DESC'
): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []

  if (left.length === 0 && right.length === 0) return results

  // For empty table handling in outer joins
  if (left.length === 0) {
    if (joinType === 'RIGHT' || joinType === 'FULL') {
      const nullLeft: Record<string, unknown> = {}
      return right.map((r) => ({ ...nullLeft, ...r }))
    }
    return results
  }

  if (right.length === 0) {
    if (joinType === 'LEFT' || joinType === 'FULL') {
      const nullRight = createNullRow({})
      return left.map((l) => ({ ...l, ...nullRight }))
    }
    return results
  }

  let leftIdx = 0
  let rightIdx = 0

  const matchedLeft = new Set<number>()
  const matchedRight = new Set<number>()

  const compareValues = (a: unknown, b: unknown): number => {
    if (a === null || a === undefined) return direction === 'ASC' ? 1 : -1
    if (b === null || b === undefined) return direction === 'ASC' ? -1 : 1

    if (typeof a === 'number' && typeof b === 'number') {
      return direction === 'ASC' ? a - b : b - a
    }

    const aStr = String(a)
    const bStr = String(b)
    const cmp = aStr.localeCompare(bStr)
    return direction === 'ASC' ? cmp : -cmp
  }

  while (leftIdx < left.length && rightIdx < right.length) {
    const leftVal = left[leftIdx]![leftKey]
    const rightVal = right[rightIdx]![rightKey]

    // Skip null values - NULL does not match NULL in joins
    if (leftVal === null || leftVal === undefined) {
      leftIdx++
      continue
    }
    if (rightVal === null || rightVal === undefined) {
      rightIdx++
      continue
    }

    const cmp = compareValues(leftVal, rightVal)

    if (cmp < 0) {
      leftIdx++
    } else if (cmp > 0) {
      rightIdx++
    } else {
      // Values match - find all matching rows on both sides
      const leftGroupStart = leftIdx
      while (leftIdx < left.length && compareValues(left[leftIdx]![leftKey], leftVal) === 0) {
        leftIdx++
      }

      const rightGroupStart = rightIdx
      while (rightIdx < right.length && compareValues(right[rightIdx]![rightKey], rightVal) === 0) {
        rightIdx++
      }

      // Cartesian product of matching groups
      for (let li = leftGroupStart; li < leftIdx; li++) {
        matchedLeft.add(li)
        for (let ri = rightGroupStart; ri < rightIdx; ri++) {
          matchedRight.add(ri)
          results.push({ ...left[li]!, ...right[ri]! })
        }
      }
    }
  }

  // Handle outer joins
  if (joinType === 'LEFT' || joinType === 'FULL') {
    const nullRight = right.length > 0 ? createNullRow(right[0]!) : {}
    for (let i = 0; i < left.length; i++) {
      if (!matchedLeft.has(i)) {
        results.push({ ...left[i]!, ...nullRight })
      }
    }
  }

  if (joinType === 'RIGHT' || joinType === 'FULL') {
    const nullLeft = left.length > 0 ? createNullRow(left[0]!) : {}
    for (let i = 0; i < right.length; i++) {
      if (!matchedRight.has(i)) {
        results.push({ ...nullLeft, ...right[i]! })
      }
    }
  }

  return results
}
