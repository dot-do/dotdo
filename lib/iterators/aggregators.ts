/**
 * Aggregators Module - Collect and aggregate async iterator data
 *
 * Provides standardized patterns for:
 * - Collecting items into arrays (memory-efficient)
 * - Numeric aggregation (sum, avg, min, max, etc.)
 * - Text aggregation (concatenation)
 * - Table aggregation (row/column statistics)
 */

import type {
  AsyncIterableSource,
  NumericAggregation,
  NumericAggregatorOptions,
  TextAggregation,
  TextAggregatorOptions,
  CollectOptions,
  TableAggregation,
  TableAggregatorOptions,
  ColumnStats,
  Reducer,
} from './types'
import { iterate } from './iterator'

// ============================================================================
// Array Aggregator (Collect)
// ============================================================================

/**
 * Collect all items from an async iterator into an array
 *
 * @example
 * ```typescript
 * const items = await collect(asyncGenerator())
 * console.log(items) // [1, 2, 3, ...]
 *
 * // With limit
 * const first100 = await collect(source, { limit: 100 })
 * ```
 */
export async function collect<T>(
  source: AsyncIterableSource<T>,
  options: CollectOptions = {}
): Promise<T[]> {
  const { limit, initialCapacity } = options

  // Pre-allocate if capacity hint provided
  const result: T[] = initialCapacity ? new Array(initialCapacity) : []
  let index = 0

  for await (const item of iterate(source, { limit })) {
    if (initialCapacity && index < initialCapacity) {
      result[index] = item
    } else {
      result.push(item)
    }
    index++
  }

  // Trim if pre-allocated but didn't fill
  if (initialCapacity && index < initialCapacity) {
    result.length = index
  }

  return result
}

/**
 * Collect items into a Set (deduplicated)
 */
export async function collectSet<T>(
  source: AsyncIterableSource<T>,
  options: CollectOptions = {}
): Promise<Set<T>> {
  const result = new Set<T>()

  for await (const item of iterate(source, { limit: options.limit })) {
    result.add(item)
  }

  return result
}

/**
 * Collect items into a Map using a key extractor
 */
export async function collectMap<T, K, V = T>(
  source: AsyncIterableSource<T>,
  keyExtractor: (item: T) => K,
  valueExtractor?: (item: T) => V
): Promise<Map<K, V>> {
  const result = new Map<K, V>()

  for await (const item of iterate(source)) {
    const key = keyExtractor(item)
    const value = valueExtractor ? valueExtractor(item) : (item as unknown as V)
    result.set(key, value)
  }

  return result
}

/**
 * Group items by a key into a Map of arrays
 */
export async function groupBy<T, K>(
  source: AsyncIterableSource<T>,
  keyExtractor: (item: T) => K
): Promise<Map<K, T[]>> {
  const result = new Map<K, T[]>()

  for await (const item of iterate(source)) {
    const key = keyExtractor(item)
    const group = result.get(key)
    if (group) {
      group.push(item)
    } else {
      result.set(key, [item])
    }
  }

  return result
}

// ============================================================================
// Numeric Aggregator
// ============================================================================

/**
 * Aggregate numeric values with statistics
 *
 * @example
 * ```typescript
 * const stats = await aggregateNumeric([1, 2, 3, 4, 5])
 * console.log(stats.sum)    // 15
 * console.log(stats.avg)    // 3
 * console.log(stats.min)    // 1
 * console.log(stats.max)    // 5
 * console.log(stats.stdDev) // 1.414...
 *
 * // From objects
 * const stats = await aggregateNumeric(users, {
 *   valueExtractor: u => u.age
 * })
 * ```
 */
export async function aggregateNumeric<T = number>(
  source: AsyncIterableSource<T>,
  options: NumericAggregatorOptions = {}
): Promise<NumericAggregation> {
  const { includeMedian = false, keepValues = false, valueExtractor } = options

  let count = 0
  let sum = 0
  let min = Infinity
  let max = -Infinity
  let sumOfSquares = 0
  const values: number[] = includeMedian || keepValues ? [] : []

  for await (const item of iterate(source)) {
    const value = valueExtractor ? valueExtractor(item) : (item as unknown as number)

    if (typeof value !== 'number' || isNaN(value)) {
      continue
    }

    count++
    sum += value
    min = Math.min(min, value)
    max = Math.max(max, value)
    sumOfSquares += value * value

    if (includeMedian || keepValues) {
      values.push(value)
    }
  }

  // Handle empty input
  if (count === 0) {
    return {
      sum: 0,
      count: 0,
      avg: 0,
      min: 0,
      max: 0,
      variance: 0,
      stdDev: 0,
      median: includeMedian ? undefined : undefined,
      values: keepValues ? [] : undefined,
    }
  }

  const avg = sum / count
  // Population variance: E[X^2] - E[X]^2
  const variance = sumOfSquares / count - avg * avg
  const stdDev = Math.sqrt(variance)

  // Calculate median if requested
  let median: number | undefined
  if (includeMedian && values.length > 0) {
    values.sort((a, b) => a - b)
    const mid = Math.floor(values.length / 2)
    median = values.length % 2 === 0
      ? (values[mid - 1]! + values[mid]!) / 2
      : values[mid]!
  }

  return {
    sum,
    count,
    avg,
    min,
    max,
    variance,
    stdDev,
    median,
    values: keepValues ? values : undefined,
  }
}

/**
 * Sum all numeric values
 */
export async function sum<T = number>(
  source: AsyncIterableSource<T>,
  valueExtractor?: (item: T) => number
): Promise<number> {
  let total = 0

  for await (const item of iterate(source)) {
    const value = valueExtractor ? valueExtractor(item) : (item as unknown as number)
    if (typeof value === 'number' && !isNaN(value)) {
      total += value
    }
  }

  return total
}

/**
 * Calculate average of numeric values
 */
export async function avg<T = number>(
  source: AsyncIterableSource<T>,
  valueExtractor?: (item: T) => number
): Promise<number> {
  let total = 0
  let count = 0

  for await (const item of iterate(source)) {
    const value = valueExtractor ? valueExtractor(item) : (item as unknown as number)
    if (typeof value === 'number' && !isNaN(value)) {
      total += value
      count++
    }
  }

  return count > 0 ? total / count : 0
}

/**
 * Find minimum value
 */
export async function min<T = number>(
  source: AsyncIterableSource<T>,
  valueExtractor?: (item: T) => number
): Promise<number> {
  let minimum = Infinity

  for await (const item of iterate(source)) {
    const value = valueExtractor ? valueExtractor(item) : (item as unknown as number)
    if (typeof value === 'number' && !isNaN(value)) {
      minimum = Math.min(minimum, value)
    }
  }

  return minimum === Infinity ? 0 : minimum
}

/**
 * Find maximum value
 */
export async function max<T = number>(
  source: AsyncIterableSource<T>,
  valueExtractor?: (item: T) => number
): Promise<number> {
  let maximum = -Infinity

  for await (const item of iterate(source)) {
    const value = valueExtractor ? valueExtractor(item) : (item as unknown as number)
    if (typeof value === 'number' && !isNaN(value)) {
      maximum = Math.max(maximum, value)
    }
  }

  return maximum === -Infinity ? 0 : maximum
}

/**
 * Count items
 */
export async function count<T>(
  source: AsyncIterableSource<T>,
  predicate?: (item: T) => boolean | Promise<boolean>
): Promise<number> {
  let total = 0

  for await (const item of iterate(source)) {
    if (predicate) {
      if (await predicate(item)) {
        total++
      }
    } else {
      total++
    }
  }

  return total
}

// ============================================================================
// Text Aggregator
// ============================================================================

/**
 * Aggregate text/string values
 *
 * @example
 * ```typescript
 * const result = await aggregateText(['Hello', 'World'], { separator: ' ' })
 * console.log(result.text)      // 'Hello World'
 * console.log(result.count)     // 2
 * console.log(result.wordCount) // 2
 * ```
 */
export async function aggregateText(
  source: AsyncIterableSource<string>,
  options: TextAggregatorOptions = {}
): Promise<TextAggregation> {
  const { separator = '', maxLength, trim = false } = options

  const segments: string[] = []
  let charCount = 0
  let count = 0

  for await (const item of iterate(source)) {
    let text = String(item)
    if (trim) {
      text = text.trim()
    }

    // Check max length
    if (maxLength !== undefined) {
      const projectedLength = charCount + (count > 0 ? separator.length : 0) + text.length
      if (projectedLength > maxLength) {
        // Truncate this segment
        const available = maxLength - charCount - (count > 0 ? separator.length : 0)
        if (available > 0) {
          text = text.slice(0, available)
          segments.push(text)
          charCount += text.length + (count > 0 ? separator.length : 0)
          count++
        }
        break
      }
    }

    segments.push(text)
    charCount += text.length + (count > 0 ? separator.length : 0)
    count++
  }

  const text = segments.join(separator)

  // Count words (split by whitespace)
  const wordCount = text.trim().length > 0
    ? text.trim().split(/\s+/).length
    : 0

  // Count lines
  const lineCount = text.split(/\r?\n/).length

  return {
    text,
    count,
    charCount: text.length,
    wordCount,
    lineCount,
  }
}

/**
 * Join strings with a separator
 */
export async function join(
  source: AsyncIterableSource<string>,
  separator: string = ''
): Promise<string> {
  const result = await aggregateText(source, { separator })
  return result.text
}

// ============================================================================
// Table Aggregator
// ============================================================================

/**
 * Aggregate tabular data with column statistics
 *
 * @example
 * ```typescript
 * const table = await aggregateTable([
 *   { name: 'Alice', age: 30 },
 *   { name: 'Bob', age: 25 },
 * ])
 * console.log(table.columns)   // ['name', 'age']
 * console.log(table.rowCount)  // 2
 * console.log(table.columnStats.get('age')?.numeric?.avg) // 27.5
 * ```
 */
export async function aggregateTable<T extends Record<string, unknown>>(
  source: AsyncIterableSource<T>,
  options: TableAggregatorOptions = {}
): Promise<TableAggregation<T>> {
  const { columns: requestedColumns, includeStats = true, maxDistinctValues = 1000 } = options

  const rows: T[] = []
  const detectedColumns = new Set<string>()
  const columnStats = new Map<string, ColumnStatsCollector>()

  for await (const row of iterate(source)) {
    rows.push(row)

    // Detect columns
    for (const key of Object.keys(row)) {
      if (requestedColumns && !requestedColumns.includes(key)) {
        continue
      }
      detectedColumns.add(key)

      // Collect stats
      if (includeStats) {
        if (!columnStats.has(key)) {
          columnStats.set(key, new ColumnStatsCollector(key, maxDistinctValues))
        }
        columnStats.get(key)!.add(row[key])
      }
    }
  }

  // Finalize column stats
  const finalStats = new Map<string, ColumnStats>()
  for (const [name, collector] of columnStats) {
    finalStats.set(name, collector.finalize())
  }

  return {
    rows,
    columns: Array.from(detectedColumns),
    rowCount: rows.length,
    columnStats: finalStats,
  }
}

/**
 * Helper class for collecting column statistics
 */
class ColumnStatsCollector {
  private name: string
  private values: unknown[] = []
  private types = new Map<string, number>()
  private nullCount = 0
  private distinctValues = new Set<string>()
  private maxDistinct: number

  // Numeric stats
  private numericSum = 0
  private numericMin = Infinity
  private numericMax = -Infinity
  private numericCount = 0

  // String stats
  private stringMinLen = Infinity
  private stringMaxLen = 0
  private stringTotalLen = 0
  private stringCount = 0

  constructor(name: string, maxDistinct: number) {
    this.name = name
    this.maxDistinct = maxDistinct
  }

  add(value: unknown): void {
    // Track null/undefined
    if (value === null || value === undefined) {
      this.nullCount++
      return
    }

    // Track type
    const type = this.getType(value)
    this.types.set(type, (this.types.get(type) || 0) + 1)

    // Track distinct values
    if (this.distinctValues.size < this.maxDistinct) {
      this.distinctValues.add(this.valueToKey(value))
    }

    // Type-specific stats
    if (type === 'number') {
      const num = value as number
      if (!isNaN(num)) {
        this.numericSum += num
        this.numericMin = Math.min(this.numericMin, num)
        this.numericMax = Math.max(this.numericMax, num)
        this.numericCount++
      }
    } else if (type === 'string') {
      const str = value as string
      this.stringMinLen = Math.min(this.stringMinLen, str.length)
      this.stringMaxLen = Math.max(this.stringMaxLen, str.length)
      this.stringTotalLen += str.length
      this.stringCount++
    }
  }

  finalize(): ColumnStats {
    // Determine dominant type
    let dominantType: ColumnStats['type'] = 'mixed'
    let maxCount = 0
    let totalCount = 0

    for (const [type, count] of this.types) {
      totalCount += count
      if (count > maxCount) {
        maxCount = count
        dominantType = type as ColumnStats['type']
      }
    }

    // If multiple types with significant presence, mark as mixed
    if (this.types.size > 1 && maxCount < totalCount * 0.9) {
      dominantType = 'mixed'
    }

    const stats: ColumnStats = {
      name: this.name,
      type: dominantType,
      nonNullCount: totalCount,
      nullCount: this.nullCount,
      distinctCount: this.distinctValues.size,
    }

    // Add numeric stats if applicable
    if (this.numericCount > 0) {
      stats.numeric = {
        min: this.numericMin,
        max: this.numericMax,
        sum: this.numericSum,
        avg: this.numericSum / this.numericCount,
      }
    }

    // Add string stats if applicable
    if (this.stringCount > 0) {
      stats.string = {
        minLength: this.stringMinLen === Infinity ? 0 : this.stringMinLen,
        maxLength: this.stringMaxLen,
        avgLength: this.stringTotalLen / this.stringCount,
      }
    }

    return stats
  }

  private getType(value: unknown): string {
    if (value === null || value === undefined) return 'null'
    if (typeof value === 'number') return 'number'
    if (typeof value === 'string') return 'string'
    if (typeof value === 'boolean') return 'boolean'
    if (value instanceof Date) return 'date'
    if (typeof value === 'object') return 'object'
    return 'unknown'
  }

  private valueToKey(value: unknown): string {
    if (typeof value === 'object') {
      return JSON.stringify(value)
    }
    return String(value)
  }
}

// ============================================================================
// Generic Reduce/Fold
// ============================================================================

/**
 * Reduce items to a single value
 *
 * @example
 * ```typescript
 * const product = await reduce([1, 2, 3, 4], (acc, x) => acc * x, 1)
 * console.log(product) // 24
 * ```
 */
export async function reduce<T, R>(
  source: AsyncIterableSource<T>,
  reducer: Reducer<T, R>,
  initial: R
): Promise<R> {
  let accumulator = initial
  let index = 0

  for await (const item of iterate(source)) {
    accumulator = await reducer(accumulator, item, index++)
  }

  return accumulator
}

/**
 * Fold left - same as reduce but with different argument order
 */
export const foldLeft = reduce

/**
 * Fold right - reduce from the end (requires collecting all items first)
 */
export async function foldRight<T, R>(
  source: AsyncIterableSource<T>,
  reducer: Reducer<T, R>,
  initial: R
): Promise<R> {
  const items = await collect(source)
  let accumulator = initial

  for (let i = items.length - 1; i >= 0; i--) {
    accumulator = await reducer(accumulator, items[i]!, i)
  }

  return accumulator
}

// ============================================================================
// First/Last/Find Operations
// ============================================================================

/**
 * Get first item from iterator
 */
export async function first<T>(
  source: AsyncIterableSource<T>
): Promise<T | undefined> {
  for await (const item of iterate(source, { limit: 1 })) {
    return item
  }
  return undefined
}

/**
 * Get last item from iterator
 */
export async function last<T>(
  source: AsyncIterableSource<T>
): Promise<T | undefined> {
  let lastItem: T | undefined

  for await (const item of iterate(source)) {
    lastItem = item
  }

  return lastItem
}

/**
 * Find first item matching predicate
 */
export async function find<T>(
  source: AsyncIterableSource<T>,
  predicate: (item: T) => boolean | Promise<boolean>
): Promise<T | undefined> {
  for await (const item of iterate(source)) {
    if (await predicate(item)) {
      return item
    }
  }
  return undefined
}

/**
 * Find index of first item matching predicate
 */
export async function findIndex<T>(
  source: AsyncIterableSource<T>,
  predicate: (item: T) => boolean | Promise<boolean>
): Promise<number> {
  let index = 0

  for await (const item of iterate(source)) {
    if (await predicate(item)) {
      return index
    }
    index++
  }

  return -1
}

/**
 * Check if any item matches predicate
 */
export async function some<T>(
  source: AsyncIterableSource<T>,
  predicate: (item: T) => boolean | Promise<boolean>
): Promise<boolean> {
  for await (const item of iterate(source)) {
    if (await predicate(item)) {
      return true
    }
  }
  return false
}

/**
 * Check if all items match predicate
 */
export async function every<T>(
  source: AsyncIterableSource<T>,
  predicate: (item: T) => boolean | Promise<boolean>
): Promise<boolean> {
  for await (const item of iterate(source)) {
    if (!(await predicate(item))) {
      return false
    }
  }
  return true
}

/**
 * Check if iterator contains an item
 */
export async function includes<T>(
  source: AsyncIterableSource<T>,
  value: T
): Promise<boolean> {
  for await (const item of iterate(source)) {
    if (item === value) {
      return true
    }
  }
  return false
}

// ============================================================================
// Aggregate Namespace Export
// ============================================================================

/**
 * Aggregation utilities as a namespace
 */
export const aggregate = {
  numeric: aggregateNumeric,
  text: aggregateText,
  table: aggregateTable,
  collect,
  collectSet,
  collectMap,
  groupBy,
  sum,
  avg,
  min,
  max,
  count,
  join,
  reduce,
  foldLeft,
  foldRight,
  first,
  last,
  find,
  findIndex,
  some,
  every,
  includes,
}
