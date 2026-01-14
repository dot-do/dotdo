/**
 * SQL-Style Window Functions for Aggregation Pipeline
 *
 * Implements window functions that operate over partitions of data:
 * - **Ranking**: ROW_NUMBER, RANK, DENSE_RANK, NTILE, PERCENT_RANK, CUME_DIST
 * - **Offset**: LAG, LEAD
 * - **Value**: FIRST_VALUE, LAST_VALUE, NTH_VALUE
 * - **Aggregate**: SUM, AVG, MIN, MAX, COUNT with window framing
 *
 * Window frames support:
 * - ROWS: Physical row-based boundaries
 * - RANGE: Logical value-based boundaries
 *
 * Uses incremental computation where possible for O(1) sliding window operations.
 *
 * @module db/primitives/aggregation-pipeline/stages/window-functions
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Window frame boundary types
 */
export type FrameBoundaryType =
  | 'UNBOUNDED PRECEDING'
  | 'PRECEDING'
  | 'CURRENT ROW'
  | 'FOLLOWING'
  | 'UNBOUNDED FOLLOWING'

/**
 * Frame boundary specification
 */
export interface FrameBoundary {
  type: FrameBoundaryType
  offset?: number // Required for PRECEDING/FOLLOWING
}

/**
 * Window frame specification (ROWS or RANGE)
 */
export interface WindowFrame {
  type: 'ROWS' | 'RANGE'
  start: FrameBoundary
  end: FrameBoundary
}

/**
 * Sort direction for ORDER BY
 */
export type SortDirection = 'ASC' | 'DESC'

/**
 * Null handling in ORDER BY
 */
export type NullPosition = 'FIRST' | 'LAST'

/**
 * ORDER BY specification
 */
export interface OrderBySpec {
  column: string
  direction?: SortDirection
  nulls?: NullPosition
}

/**
 * Window function types
 */
export type WindowFunctionType =
  | 'ROW_NUMBER'
  | 'RANK'
  | 'DENSE_RANK'
  | 'NTILE'
  | 'PERCENT_RANK'
  | 'CUME_DIST'
  | 'LAG'
  | 'LEAD'
  | 'FIRST_VALUE'
  | 'LAST_VALUE'
  | 'NTH_VALUE'
  | 'SUM'
  | 'AVG'
  | 'MIN'
  | 'MAX'
  | 'COUNT'

/**
 * Window function definition
 */
export interface WindowFunction {
  type: WindowFunctionType
  column?: string // For aggregate/value functions
  offset?: number // For LAG/LEAD/NTH_VALUE
  defaultValue?: unknown // For LAG/LEAD
  n?: number // For NTILE
}

/**
 * Complete window specification
 */
export interface WindowSpec {
  function: WindowFunction
  partitionBy?: string[]
  orderBy?: OrderBySpec[]
  frame?: WindowFrame
  alias: string
}

// =============================================================================
// Window Function Factory Functions
// =============================================================================

/**
 * Create a ROW_NUMBER window function
 */
export function rowNumber(): WindowFunction {
  return { type: 'ROW_NUMBER' }
}

/**
 * Create a RANK window function
 */
export function rank(): WindowFunction {
  return { type: 'RANK' }
}

/**
 * Create a DENSE_RANK window function
 */
export function denseRank(): WindowFunction {
  return { type: 'DENSE_RANK' }
}

/**
 * Create an NTILE window function
 */
export function ntile(n: number): WindowFunction {
  return { type: 'NTILE', n }
}

/**
 * Create a PERCENT_RANK window function
 */
export function percentRank(): WindowFunction {
  return { type: 'PERCENT_RANK' }
}

/**
 * Create a CUME_DIST window function
 */
export function cumeDist(): WindowFunction {
  return { type: 'CUME_DIST' }
}

/**
 * Create a LAG window function
 */
export function lag(column: string, offset: number = 1, defaultValue?: unknown): WindowFunction {
  return { type: 'LAG', column, offset, defaultValue }
}

/**
 * Create a LEAD window function
 */
export function lead(column: string, offset: number = 1, defaultValue?: unknown): WindowFunction {
  return { type: 'LEAD', column, offset, defaultValue }
}

/**
 * Create a FIRST_VALUE window function
 */
export function firstValue(column: string): WindowFunction {
  return { type: 'FIRST_VALUE', column }
}

/**
 * Create a LAST_VALUE window function
 */
export function lastValue(column: string): WindowFunction {
  return { type: 'LAST_VALUE', column }
}

/**
 * Create an NTH_VALUE window function
 */
export function nthValue(column: string, n: number): WindowFunction {
  return { type: 'NTH_VALUE', column, offset: n }
}

/**
 * Create a SUM OVER window function
 */
export function sumOver(column: string): WindowFunction {
  return { type: 'SUM', column }
}

/**
 * Create an AVG OVER window function
 */
export function avgOver(column: string): WindowFunction {
  return { type: 'AVG', column }
}

/**
 * Create a MIN OVER window function
 */
export function minOver(column: string): WindowFunction {
  return { type: 'MIN', column }
}

/**
 * Create a MAX OVER window function
 */
export function maxOver(column: string): WindowFunction {
  return { type: 'MAX', column }
}

/**
 * Create a COUNT OVER window function
 */
export function countOver(column?: string): WindowFunction {
  return { type: 'COUNT', column }
}

/**
 * Generic window function factory
 */
export function createWindowFunction(spec: WindowFunction): WindowFunction {
  return spec
}

// =============================================================================
// Default Frame Specifications
// =============================================================================

/**
 * Default frame for aggregate functions: RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
 */
const DEFAULT_AGGREGATE_FRAME: WindowFrame = {
  type: 'RANGE',
  start: { type: 'UNBOUNDED PRECEDING' },
  end: { type: 'CURRENT ROW' },
}

/**
 * Entire partition frame: ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
 */
const ENTIRE_PARTITION_FRAME: WindowFrame = {
  type: 'ROWS',
  start: { type: 'UNBOUNDED PRECEDING' },
  end: { type: 'UNBOUNDED FOLLOWING' },
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get value from object by path
 */
function getValue<T>(obj: T, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Compare values for sorting
 */
function compareValues(a: unknown, b: unknown, direction: SortDirection, nulls: NullPosition = 'LAST'): number {
  // Handle nulls
  const aIsNull = a === null || a === undefined
  const bIsNull = b === null || b === undefined

  if (aIsNull && bIsNull) return 0
  if (aIsNull) return nulls === 'FIRST' ? -1 : 1
  if (bIsNull) return nulls === 'FIRST' ? 1 : -1

  // Compare non-null values
  let result: number
  if (typeof a === 'number' && typeof b === 'number') {
    result = a - b
  } else if (typeof a === 'string' && typeof b === 'string') {
    result = a.localeCompare(b)
  } else if (a instanceof Date && b instanceof Date) {
    result = a.getTime() - b.getTime()
  } else {
    result = String(a).localeCompare(String(b))
  }

  return direction === 'DESC' ? -result : result
}

/**
 * Create a comparator function from ORDER BY specs
 */
function createComparator<T>(orderBy: OrderBySpec[]): (a: T, b: T) => number {
  return (a: T, b: T) => {
    for (const spec of orderBy) {
      const aVal = getValue(a, spec.column)
      const bVal = getValue(b, spec.column)
      const result = compareValues(aVal, bVal, spec.direction ?? 'ASC', spec.nulls)
      if (result !== 0) return result
    }
    return 0
  }
}

/**
 * Group rows by partition keys
 */
function partitionRows<T>(rows: T[], partitionBy: string[]): Map<string, T[]> {
  const partitions = new Map<string, T[]>()

  for (const row of rows) {
    const key = partitionBy.map((col) => JSON.stringify(getValue(row, col))).join('|')
    const partition = partitions.get(key)
    if (partition) {
      partition.push(row)
    } else {
      partitions.set(key, [row])
    }
  }

  return partitions
}

/**
 * Check if two rows have equal ORDER BY values
 */
function equalOrderByValues<T>(a: T, b: T, orderBy: OrderBySpec[]): boolean {
  for (const spec of orderBy) {
    const aVal = getValue(a, spec.column)
    const bVal = getValue(b, spec.column)
    if (aVal !== bVal) return false
  }
  return true
}

/**
 * Get frame boundaries as indices for a given row in a sorted partition
 */
function getFrameIndices<T>(
  partitionRows: T[],
  currentIndex: number,
  frame: WindowFrame,
  orderBy?: OrderBySpec[]
): { start: number; end: number } {
  const n = partitionRows.length

  if (frame.type === 'ROWS') {
    // ROWS mode: physical row offsets
    let start: number
    let end: number

    switch (frame.start.type) {
      case 'UNBOUNDED PRECEDING':
        start = 0
        break
      case 'PRECEDING':
        start = Math.max(0, currentIndex - (frame.start.offset ?? 0))
        break
      case 'CURRENT ROW':
        start = currentIndex
        break
      case 'FOLLOWING':
        start = Math.min(n - 1, currentIndex + (frame.start.offset ?? 0))
        break
      case 'UNBOUNDED FOLLOWING':
        start = n - 1
        break
    }

    switch (frame.end.type) {
      case 'UNBOUNDED PRECEDING':
        end = 0
        break
      case 'PRECEDING':
        end = Math.max(0, currentIndex - (frame.end.offset ?? 0))
        break
      case 'CURRENT ROW':
        end = currentIndex
        break
      case 'FOLLOWING':
        end = Math.min(n - 1, currentIndex + (frame.end.offset ?? 0))
        break
      case 'UNBOUNDED FOLLOWING':
        end = n - 1
        break
    }

    return { start, end }
  } else {
    // RANGE mode: logical value range (peers with same ORDER BY value treated together)
    if (!orderBy || orderBy.length === 0) {
      // Without ORDER BY, entire partition is one peer group
      return { start: 0, end: n - 1 }
    }

    const currentRow = partitionRows[currentIndex]!

    // Find peer group boundaries
    let peerStart = currentIndex
    let peerEnd = currentIndex

    // Find start of peer group
    while (peerStart > 0 && equalOrderByValues(partitionRows[peerStart - 1]!, currentRow, orderBy)) {
      peerStart--
    }

    // Find end of peer group
    while (peerEnd < n - 1 && equalOrderByValues(partitionRows[peerEnd + 1]!, currentRow, orderBy)) {
      peerEnd++
    }

    let start: number
    let end: number

    switch (frame.start.type) {
      case 'UNBOUNDED PRECEDING':
        start = 0
        break
      case 'CURRENT ROW':
        start = peerStart
        break
      default:
        // PRECEDING/FOLLOWING with offset not fully supported for RANGE
        start = peerStart
    }

    switch (frame.end.type) {
      case 'UNBOUNDED FOLLOWING':
        end = n - 1
        break
      case 'CURRENT ROW':
        end = peerEnd
        break
      default:
        end = peerEnd
    }

    return { start, end }
  }
}

// =============================================================================
// Window Function Processor
// =============================================================================

/**
 * Processor for applying window functions to data
 *
 * Supports all standard SQL window functions with partition, ordering, and framing.
 */
export class WindowFunctionProcessor<T extends Record<string, unknown>> {
  /**
   * Process data with a single window function specification
   */
  process(data: T[], spec: WindowSpec): (T & Record<string, unknown>)[] {
    if (data.length === 0) return []

    // Partition the data
    const partitions = spec.partitionBy
      ? partitionRows(data, spec.partitionBy)
      : new Map([['', [...data]]])

    const results: (T & Record<string, unknown>)[] = []
    const rowToResult = new Map<T, T & Record<string, unknown>>()

    // Process each partition
    for (const [, partition] of partitions) {
      // Sort within partition
      if (spec.orderBy && spec.orderBy.length > 0) {
        const comparator = createComparator<T>(spec.orderBy)
        partition.sort(comparator)
      }

      // Apply window function
      const partitionResults = this.applyWindowFunction(partition, spec)

      // Map original rows to results
      for (let i = 0; i < partition.length; i++) {
        const row = partition[i]!
        rowToResult.set(row, partitionResults[i]!)
      }
    }

    // Preserve original order
    for (const row of data) {
      const result = rowToResult.get(row)
      if (result) {
        results.push(result)
      }
    }

    return results
  }

  /**
   * Process data with multiple window function specifications
   */
  processMultiple(data: T[], specs: WindowSpec[]): (T & Record<string, unknown>)[] {
    if (data.length === 0) return []

    // Initialize results with original data
    let results = data.map((row) => ({ ...row }))

    // Apply each spec
    for (const spec of specs) {
      const processed = this.process(results as T[], spec)
      // Merge results - copy new alias values to existing results
      for (let i = 0; i < results.length; i++) {
        const original = data[i]!
        const processedRow = processed.find((p) => {
          // Match by comparing original properties
          return Object.keys(original).every((key) => p[key] === original[key])
        })
        if (processedRow) {
          results[i]![spec.alias] = processedRow[spec.alias]
        }
      }
    }

    return results
  }

  /**
   * Apply window function to a sorted partition
   */
  private applyWindowFunction(partition: T[], spec: WindowSpec): (T & Record<string, unknown>)[] {
    const { function: fn, orderBy, frame, alias } = spec
    const results: (T & Record<string, unknown>)[] = partition.map((row) => ({ ...row }))
    const n = partition.length

    switch (fn.type) {
      case 'ROW_NUMBER':
        for (let i = 0; i < n; i++) {
          results[i]![alias] = i + 1
        }
        break

      case 'RANK':
        this.applyRank(results, alias, orderBy ?? [])
        break

      case 'DENSE_RANK':
        this.applyDenseRank(results, alias, orderBy ?? [])
        break

      case 'NTILE':
        this.applyNtile(results, alias, fn.n ?? 1)
        break

      case 'PERCENT_RANK':
        this.applyPercentRank(results, alias, orderBy ?? [])
        break

      case 'CUME_DIST':
        this.applyCumeDist(results, alias, orderBy ?? [])
        break

      case 'LAG':
        this.applyLag(results, alias, fn.column!, fn.offset ?? 1, fn.defaultValue)
        break

      case 'LEAD':
        this.applyLead(results, alias, fn.column!, fn.offset ?? 1, fn.defaultValue)
        break

      case 'FIRST_VALUE':
        this.applyFirstValue(results, alias, fn.column!, frame ?? ENTIRE_PARTITION_FRAME, orderBy)
        break

      case 'LAST_VALUE':
        this.applyLastValue(results, alias, fn.column!, frame ?? DEFAULT_AGGREGATE_FRAME, orderBy)
        break

      case 'NTH_VALUE':
        this.applyNthValue(results, alias, fn.column!, fn.offset ?? 1, frame ?? ENTIRE_PARTITION_FRAME, orderBy)
        break

      case 'SUM':
        this.applyAggregateWindow(results, alias, fn.column!, 'SUM', frame ?? DEFAULT_AGGREGATE_FRAME, orderBy)
        break

      case 'AVG':
        this.applyAggregateWindow(results, alias, fn.column!, 'AVG', frame ?? DEFAULT_AGGREGATE_FRAME, orderBy)
        break

      case 'MIN':
        this.applyAggregateWindow(results, alias, fn.column!, 'MIN', frame ?? DEFAULT_AGGREGATE_FRAME, orderBy)
        break

      case 'MAX':
        this.applyAggregateWindow(results, alias, fn.column!, 'MAX', frame ?? DEFAULT_AGGREGATE_FRAME, orderBy)
        break

      case 'COUNT':
        this.applyAggregateWindow(results, alias, fn.column, 'COUNT', frame ?? DEFAULT_AGGREGATE_FRAME, orderBy)
        break
    }

    return results
  }

  // =========================================================================
  // Ranking Functions
  // =========================================================================

  private applyRank<R extends Record<string, unknown>>(
    results: R[],
    alias: string,
    orderBy: OrderBySpec[]
  ): void {
    const n = results.length
    if (n === 0) return

    let currentRank = 1
    results[0]![alias] = currentRank

    for (let i = 1; i < n; i++) {
      if (orderBy.length === 0 || equalOrderByValues(results[i]!, results[i - 1]!, orderBy)) {
        results[i]![alias] = results[i - 1]![alias]
      } else {
        results[i]![alias] = i + 1 // Rank with gaps
      }
    }
  }

  private applyDenseRank<R extends Record<string, unknown>>(
    results: R[],
    alias: string,
    orderBy: OrderBySpec[]
  ): void {
    const n = results.length
    if (n === 0) return

    let currentRank = 1
    results[0]![alias] = currentRank

    for (let i = 1; i < n; i++) {
      if (orderBy.length === 0 || equalOrderByValues(results[i]!, results[i - 1]!, orderBy)) {
        results[i]![alias] = results[i - 1]![alias]
      } else {
        currentRank++
        results[i]![alias] = currentRank // No gaps
      }
    }
  }

  private applyNtile<R extends Record<string, unknown>>(
    results: R[],
    alias: string,
    numBuckets: number
  ): void {
    const n = results.length
    if (n === 0) return

    const bucketSize = Math.floor(n / numBuckets)
    const remainder = n % numBuckets

    let bucket = 1
    let count = 0
    const currentBucketSize = bucketSize + (bucket <= remainder ? 1 : 0)

    for (let i = 0; i < n; i++) {
      results[i]![alias] = bucket
      count++
      if (count >= (bucketSize + (bucket <= remainder ? 1 : 0)) && bucket < numBuckets) {
        bucket++
        count = 0
      }
    }
  }

  private applyPercentRank<R extends Record<string, unknown>>(
    results: R[],
    alias: string,
    orderBy: OrderBySpec[]
  ): void {
    const n = results.length
    if (n <= 1) {
      for (const row of results) {
        row[alias] = 0
      }
      return
    }

    // First compute ranks
    const ranks: number[] = new Array(n)
    ranks[0] = 1

    for (let i = 1; i < n; i++) {
      if (orderBy.length === 0 || equalOrderByValues(results[i]!, results[i - 1]!, orderBy)) {
        ranks[i] = ranks[i - 1]!
      } else {
        ranks[i] = i + 1
      }
    }

    // Convert to percent rank: (rank - 1) / (n - 1)
    for (let i = 0; i < n; i++) {
      results[i]![alias] = (ranks[i]! - 1) / (n - 1)
    }
  }

  private applyCumeDist<R extends Record<string, unknown>>(
    results: R[],
    alias: string,
    orderBy: OrderBySpec[]
  ): void {
    const n = results.length
    if (n === 0) return

    // For each row, cume_dist = (number of rows <= current) / total rows
    // For rows with same ORDER BY value, they have the same cume_dist
    for (let i = 0; i < n; i++) {
      // Find the last row in the peer group
      let peerEnd = i
      while (peerEnd < n - 1 && equalOrderByValues(results[peerEnd + 1]!, results[i]!, orderBy)) {
        peerEnd++
      }
      // All peers share the same cume_dist
      const cumeDist = (peerEnd + 1) / n
      for (let j = i; j <= peerEnd; j++) {
        results[j]![alias] = cumeDist
      }
      i = peerEnd // Skip processed peers
    }
  }

  // =========================================================================
  // Offset Functions
  // =========================================================================

  private applyLag<R extends Record<string, unknown>>(
    results: R[],
    alias: string,
    column: string,
    offset: number,
    defaultValue: unknown
  ): void {
    const n = results.length

    for (let i = 0; i < n; i++) {
      const lagIndex = i - offset
      if (lagIndex >= 0) {
        results[i]![alias] = getValue(results[lagIndex]!, column) ?? null
      } else {
        results[i]![alias] = defaultValue ?? null
      }
    }
  }

  private applyLead<R extends Record<string, unknown>>(
    results: R[],
    alias: string,
    column: string,
    offset: number,
    defaultValue: unknown
  ): void {
    const n = results.length

    for (let i = 0; i < n; i++) {
      const leadIndex = i + offset
      if (leadIndex < n) {
        results[i]![alias] = getValue(results[leadIndex]!, column) ?? null
      } else {
        results[i]![alias] = defaultValue ?? null
      }
    }
  }

  // =========================================================================
  // Value Functions
  // =========================================================================

  private applyFirstValue<R extends Record<string, unknown>>(
    results: R[],
    alias: string,
    column: string,
    frame: WindowFrame,
    orderBy?: OrderBySpec[]
  ): void {
    const n = results.length

    for (let i = 0; i < n; i++) {
      const { start } = getFrameIndices(results, i, frame, orderBy)
      results[i]![alias] = getValue(results[start]!, column) ?? null
    }
  }

  private applyLastValue<R extends Record<string, unknown>>(
    results: R[],
    alias: string,
    column: string,
    frame: WindowFrame,
    orderBy?: OrderBySpec[]
  ): void {
    const n = results.length

    for (let i = 0; i < n; i++) {
      const { end } = getFrameIndices(results, i, frame, orderBy)
      results[i]![alias] = getValue(results[end]!, column) ?? null
    }
  }

  private applyNthValue<R extends Record<string, unknown>>(
    results: R[],
    alias: string,
    column: string,
    n: number,
    frame: WindowFrame,
    orderBy?: OrderBySpec[]
  ): void {
    const rowCount = results.length

    for (let i = 0; i < rowCount; i++) {
      const { start, end } = getFrameIndices(results, i, frame, orderBy)
      const targetIndex = start + n - 1 // 1-indexed

      if (targetIndex <= end && targetIndex < rowCount) {
        results[i]![alias] = getValue(results[targetIndex]!, column) ?? null
      } else {
        results[i]![alias] = null
      }
    }
  }

  // =========================================================================
  // Aggregate Window Functions
  // =========================================================================

  private applyAggregateWindow<R extends Record<string, unknown>>(
    results: R[],
    alias: string,
    column: string | undefined,
    aggType: 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT',
    frame: WindowFrame,
    orderBy?: OrderBySpec[]
  ): void {
    const n = results.length

    // For running aggregates with UNBOUNDED PRECEDING to CURRENT ROW, use incremental
    // Note: UNBOUNDED FOLLOWING means entire partition, NOT a running aggregate
    const isRunningAggregate =
      frame.start.type === 'UNBOUNDED PRECEDING' &&
      frame.end.type === 'CURRENT ROW'

    if (isRunningAggregate && (aggType === 'SUM' || aggType === 'COUNT')) {
      // Optimized incremental path for running sum/count
      this.applyIncrementalAggregate(results, alias, column, aggType, frame, orderBy)
      return
    }

    // General frame-based computation
    for (let i = 0; i < n; i++) {
      const { start, end } = getFrameIndices(results, i, frame, orderBy)

      // Collect values in frame
      const values: number[] = []
      for (let j = start; j <= end; j++) {
        if (column) {
          const val = getValue(results[j]!, column)
          if (typeof val === 'number') {
            values.push(val)
          }
        } else {
          values.push(1) // For COUNT without column
        }
      }

      // Compute aggregate
      results[i]![alias] = this.computeAggregate(values, aggType)
    }
  }

  private applyIncrementalAggregate<R extends Record<string, unknown>>(
    results: R[],
    alias: string,
    column: string | undefined,
    aggType: 'SUM' | 'COUNT',
    frame: WindowFrame,
    orderBy?: OrderBySpec[]
  ): void {
    const n = results.length
    if (n === 0) return

    const isRange = frame.type === 'RANGE'
    const isCurrentRow = frame.end.type === 'CURRENT ROW'

    // For SUM, use Kahan summation for numerical stability
    let runningSum = 0
    let compensation = 0
    let runningCount = 0

    if (!isRange || !orderBy || orderBy.length === 0) {
      // ROWS mode or no ORDER BY: simple running aggregate
      for (let i = 0; i < n; i++) {
        if (column) {
          const val = getValue(results[i]!, column)
          if (typeof val === 'number') {
            if (aggType === 'SUM') {
              // Kahan summation
              const y = val - compensation
              const t = runningSum + y
              compensation = (t - runningSum) - y
              runningSum = t
            }
            runningCount++
          }
        } else {
          runningCount++
        }

        results[i]![alias] = aggType === 'SUM' ? runningSum : runningCount
      }
    } else {
      // RANGE mode with ORDER BY: peers share the same running value
      for (let i = 0; i < n; i++) {
        // Add all values for current peer group
        const peerStart = i
        let peerEnd = i

        // Find end of peer group
        while (peerEnd < n - 1 && equalOrderByValues(results[peerEnd + 1]!, results[i]!, orderBy!)) {
          peerEnd++
        }

        // Add all peer values
        for (let j = peerStart; j <= peerEnd; j++) {
          if (column) {
            const val = getValue(results[j]!, column)
            if (typeof val === 'number') {
              if (aggType === 'SUM') {
                const y = val - compensation
                const t = runningSum + y
                compensation = (t - runningSum) - y
                runningSum = t
              }
              runningCount++
            }
          } else {
            runningCount++
          }
        }

        // Set value for all peers
        const resultValue = aggType === 'SUM' ? runningSum : runningCount
        for (let j = peerStart; j <= peerEnd; j++) {
          results[j]![alias] = resultValue
        }

        i = peerEnd // Skip processed peers
      }
    }
  }

  private computeAggregate(values: number[], aggType: 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT'): number | null {
    if (values.length === 0 && aggType !== 'COUNT') return null

    switch (aggType) {
      case 'SUM':
        return values.reduce((a, b) => a + b, 0)

      case 'AVG':
        if (values.length === 0) return null
        return values.reduce((a, b) => a + b, 0) / values.length

      case 'MIN':
        if (values.length === 0) return null
        return Math.min(...values)

      case 'MAX':
        if (values.length === 0) return null
        return Math.max(...values)

      case 'COUNT':
        return values.length

      default:
        return null
    }
  }
}
