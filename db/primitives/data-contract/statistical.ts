/**
 * Statistical Expectations - Aggregate validation for data quality
 *
 * Provides statistical expectations for data contract validation:
 * - Row count expectations (min, max, exact, between)
 * - Column statistics (mean, stddev, percentiles)
 * - Uniqueness and cardinality checks
 * - Null percentage thresholds
 *
 * @example
 * ```typescript
 * const expectation = expectStats('orders')
 *   .toHaveRowCount().between(1000, 10000)
 *   .column('amount').mean().toBeBetween(50, 150)
 *   .column('user_id').uniqueRatio().toBeGreaterThan(0.8)
 *   .column('email').nullPercentage().toBeLessThan(0.01)
 *   .build()
 *
 * const result = validateStatisticalExpectations(expectation, data)
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Row count expectation types
 */
export type RowCountExpectationType = 'exactly' | 'between' | 'at_least' | 'at_most'

/**
 * Row count expectation definition
 */
export interface RowCountExpectation {
  type: RowCountExpectationType
  value?: number
  min?: number
  max?: number
}

/**
 * Column statistic types
 */
export type StatisticType = 'mean' | 'stddev' | 'percentile' | 'unique_ratio' | 'unique_count' | 'null_percentage'

/**
 * Comparison types for expectations
 */
export type ComparisonType = 'between' | 'greater_than' | 'less_than' | 'greater_than_or_equal' | 'less_than_or_equal' | 'exactly'

/**
 * Column expectation definition
 */
export interface ColumnExpectation {
  column: string
  statistic: StatisticType
  comparison: ComparisonType
  value?: number
  min?: number
  max?: number
  percentile?: number
}

/**
 * Full statistical expectation definition
 */
export interface StatisticalExpectation {
  table: string
  rowCountExpectation?: RowCountExpectation
  columnExpectations: ColumnExpectation[]
}

/**
 * Single validation failure
 */
export interface StatisticalFailure {
  expectationType: string
  column?: string
  statistic?: string
  message: string
  expected?: unknown
  actual?: unknown
}

/**
 * Computed statistics for a column
 */
export interface ColumnStatistics {
  count?: number
  mean?: number
  stddev?: number
  min?: number
  max?: number
  percentiles?: Record<number, number>
  uniqueRatio?: number
  uniqueCount?: number
  nullPercentage?: number
  nullCount?: number
}

/**
 * Overall computed statistics
 */
export interface ComputedStatistics {
  rowCount: number
  [column: string]: number | ColumnStatistics
}

/**
 * Validation result
 */
export interface StatisticalExpectationResult {
  passed: boolean
  failures: StatisticalFailure[]
  statistics?: ComputedStatistics
  timing: {
    totalMs: number
  }
}

// ============================================================================
// BUILDERS
// ============================================================================

/**
 * Builder for comparison operations
 */
class ComparisonBuilder {
  private parent: StatisticalExpectationBuilder
  private column?: string
  private statistic: StatisticType | 'row_count'
  private percentileValue?: number

  constructor(
    parent: StatisticalExpectationBuilder,
    statistic: StatisticType | 'row_count',
    column?: string,
    percentileValue?: number
  ) {
    this.parent = parent
    this.statistic = statistic
    this.column = column
    this.percentileValue = percentileValue
  }

  /**
   * Expect value to be exactly the specified amount
   */
  exactly(value: number): StatisticalExpectationBuilder {
    if (this.statistic === 'row_count') {
      this.parent.setRowCountExpectation({
        type: 'exactly',
        value,
      })
    } else if (this.column) {
      this.parent.addColumnExpectation({
        column: this.column,
        statistic: this.statistic as StatisticType,
        comparison: 'exactly',
        value,
        percentile: this.percentileValue,
      })
    }
    return this.parent
  }

  /**
   * Expect value to be between min and max (inclusive)
   */
  toBeBetween(min: number, max: number): StatisticalExpectationBuilder {
    if (this.statistic === 'row_count') {
      this.parent.setRowCountExpectation({
        type: 'between',
        min,
        max,
      })
    } else if (this.column) {
      this.parent.addColumnExpectation({
        column: this.column,
        statistic: this.statistic as StatisticType,
        comparison: 'between',
        min,
        max,
        percentile: this.percentileValue,
      })
    }
    return this.parent
  }

  /**
   * Alias for toBeBetween for row count (chainable API)
   */
  between(min: number, max: number): StatisticalExpectationBuilder {
    return this.toBeBetween(min, max)
  }

  /**
   * Expect value to be at least the specified amount
   */
  atLeast(value: number): StatisticalExpectationBuilder {
    if (this.statistic === 'row_count') {
      this.parent.setRowCountExpectation({
        type: 'at_least',
        value,
      })
    } else if (this.column) {
      this.parent.addColumnExpectation({
        column: this.column,
        statistic: this.statistic as StatisticType,
        comparison: 'greater_than_or_equal',
        value,
        percentile: this.percentileValue,
      })
    }
    return this.parent
  }

  /**
   * Expect value to be at most the specified amount
   */
  atMost(value: number): StatisticalExpectationBuilder {
    if (this.statistic === 'row_count') {
      this.parent.setRowCountExpectation({
        type: 'at_most',
        value,
      })
    } else if (this.column) {
      this.parent.addColumnExpectation({
        column: this.column,
        statistic: this.statistic as StatisticType,
        comparison: 'less_than_or_equal',
        value,
        percentile: this.percentileValue,
      })
    }
    return this.parent
  }

  /**
   * Expect value to be greater than the specified amount
   */
  toBeGreaterThan(value: number): StatisticalExpectationBuilder {
    if (this.column) {
      this.parent.addColumnExpectation({
        column: this.column,
        statistic: this.statistic as StatisticType,
        comparison: 'greater_than',
        value,
        percentile: this.percentileValue,
      })
    }
    return this.parent
  }

  /**
   * Expect value to be less than the specified amount
   */
  toBeLessThan(value: number): StatisticalExpectationBuilder {
    if (this.column) {
      this.parent.addColumnExpectation({
        column: this.column,
        statistic: this.statistic as StatisticType,
        comparison: 'less_than',
        value,
        percentile: this.percentileValue,
      })
    }
    return this.parent
  }
}

/**
 * Builder for column statistics
 */
export class ColumnStatsBuilder {
  private parent: StatisticalExpectationBuilder
  private columnName: string

  constructor(parent: StatisticalExpectationBuilder, columnName: string) {
    this.parent = parent
    this.columnName = columnName
  }

  /**
   * Define expectation on mean value
   */
  mean(): ComparisonBuilder {
    return new ComparisonBuilder(this.parent, 'mean', this.columnName)
  }

  /**
   * Define expectation on standard deviation
   */
  stddev(): ComparisonBuilder {
    return new ComparisonBuilder(this.parent, 'stddev', this.columnName)
  }

  /**
   * Define expectation on a specific percentile
   */
  percentile(p: number): ComparisonBuilder {
    return new ComparisonBuilder(this.parent, 'percentile', this.columnName, p)
  }

  /**
   * Define expectation on unique ratio (unique values / total values)
   */
  uniqueRatio(): ComparisonBuilder {
    return new ComparisonBuilder(this.parent, 'unique_ratio', this.columnName)
  }

  /**
   * Define expectation on unique count
   */
  uniqueCount(): ComparisonBuilder {
    return new ComparisonBuilder(this.parent, 'unique_count', this.columnName)
  }

  /**
   * Define expectation on null percentage (0-1 scale)
   */
  nullPercentage(): ComparisonBuilder {
    return new ComparisonBuilder(this.parent, 'null_percentage', this.columnName)
  }
}

/**
 * Main builder for statistical expectations
 */
export class StatisticalExpectationBuilder {
  private tableName: string
  private rowCount?: RowCountExpectation
  private columns: ColumnExpectation[] = []

  constructor(tableName: string) {
    this.tableName = tableName
  }

  /**
   * Get the table name
   */
  getTableName(): string {
    return this.tableName
  }

  /**
   * Define row count expectation
   */
  toHaveRowCount(): ComparisonBuilder {
    return new ComparisonBuilder(this, 'row_count')
  }

  /**
   * Define column-level expectation
   */
  column(name: string): ColumnStatsBuilder {
    return new ColumnStatsBuilder(this, name)
  }

  /**
   * Set row count expectation (internal)
   * @internal
   */
  setRowCountExpectation(expectation: RowCountExpectation): void {
    this.rowCount = expectation
  }

  /**
   * Add column expectation (internal)
   * @internal
   */
  addColumnExpectation(expectation: ColumnExpectation): void {
    this.columns.push(expectation)
  }

  /**
   * Build the final expectation definition
   */
  build(): StatisticalExpectation {
    return {
      table: this.tableName,
      rowCountExpectation: this.rowCount,
      columnExpectations: this.columns,
    }
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

/**
 * Create a statistical expectation builder for a table
 *
 * @example
 * ```typescript
 * const expectation = expectStats('orders')
 *   .toHaveRowCount().between(1000, 10000)
 *   .column('amount').mean().toBeBetween(50, 150)
 *   .column('user_id').uniqueRatio().toBeGreaterThan(0.8)
 *   .column('email').nullPercentage().toBeLessThan(0.01)
 *   .build()
 * ```
 */
export function expectStats(tableName: string): StatisticalExpectationBuilder {
  return new StatisticalExpectationBuilder(tableName)
}

// ============================================================================
// STATISTICS CALCULATION
// ============================================================================

/**
 * Get numeric values from a column, filtering out nulls and non-numeric values
 */
function getNumericValues(data: Record<string, unknown>[], column: string): number[] {
  return data
    .map((row) => row[column])
    .filter((v): v is number => typeof v === 'number' && !isNaN(v))
}

/**
 * Get all values from a column (including nulls for null percentage calculation)
 */
function getAllValues(data: Record<string, unknown>[], column: string): unknown[] {
  return data.map((row) => row[column])
}

/**
 * Calculate mean of numeric values
 */
function calculateMean(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/**
 * Calculate standard deviation of numeric values (population stddev)
 */
function calculateStddev(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const mean = calculateMean(values)!
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2))
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length
  return Math.sqrt(variance)
}

/**
 * Calculate percentile using linear interpolation
 */
function calculatePercentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const index = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  const fraction = index - lower
  return sorted[lower]! * (1 - fraction) + sorted[upper]! * fraction
}

/**
 * Calculate unique ratio (unique values / total non-null values)
 */
function calculateUniqueRatio(values: unknown[]): number {
  const nonNullValues = values.filter((v) => v !== null && v !== undefined)
  if (nonNullValues.length === 0) return 0
  const uniqueValues = new Set(nonNullValues)
  return uniqueValues.size / nonNullValues.length
}

/**
 * Calculate unique count
 */
function calculateUniqueCount(values: unknown[]): number {
  const nonNullValues = values.filter((v) => v !== null && v !== undefined)
  return new Set(nonNullValues).size
}

/**
 * Calculate null percentage (0-1 scale)
 */
function calculateNullPercentage(values: unknown[]): number {
  if (values.length === 0) return 0
  const nullCount = values.filter((v) => v === null || v === undefined).length
  return nullCount / values.length
}

/**
 * Calculate statistics for a column
 */
function calculateColumnStats(
  data: Record<string, unknown>[],
  column: string,
  requiredStats: Set<StatisticType>,
  percentiles: Set<number>
): ColumnStatistics {
  const stats: ColumnStatistics = {}
  const allValues = getAllValues(data, column)
  const numericValues = getNumericValues(data, column)

  if (requiredStats.has('mean') || requiredStats.has('stddev')) {
    stats.mean = calculateMean(numericValues)
    stats.stddev = calculateStddev(numericValues)
  }

  if (requiredStats.has('percentile') && percentiles.size > 0) {
    stats.percentiles = {}
    const percentileArray = Array.from(percentiles)
    for (let i = 0; i < percentileArray.length; i++) {
      const p = percentileArray[i]!
      stats.percentiles[p] = calculatePercentile(numericValues, p)
    }
  }

  if (requiredStats.has('unique_ratio')) {
    stats.uniqueRatio = calculateUniqueRatio(allValues)
  }

  if (requiredStats.has('unique_count')) {
    stats.uniqueCount = calculateUniqueCount(allValues)
  }

  if (requiredStats.has('null_percentage')) {
    stats.nullPercentage = calculateNullPercentage(allValues)
    stats.nullCount = allValues.filter((v) => v === null || v === undefined).length
  }

  return stats
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Check if a value satisfies a comparison
 */
function checkComparison(
  actual: number | undefined,
  expectation: { comparison: ComparisonType; value?: number; min?: number; max?: number }
): boolean {
  if (actual === undefined) return false

  switch (expectation.comparison) {
    case 'exactly':
      return actual === expectation.value
    case 'between':
      return actual >= expectation.min! && actual <= expectation.max!
    case 'greater_than':
      return actual > expectation.value!
    case 'greater_than_or_equal':
      return actual >= expectation.value!
    case 'less_than':
      return actual < expectation.value!
    case 'less_than_or_equal':
      return actual <= expectation.value!
    default:
      return false
  }
}

/**
 * Format expected value for error message
 */
function formatExpected(expectation: { comparison: ComparisonType; value?: number; min?: number; max?: number }): string {
  switch (expectation.comparison) {
    case 'exactly':
      return `exactly ${expectation.value}`
    case 'between':
      return `between ${expectation.min} and ${expectation.max}`
    case 'greater_than':
      return `greater than ${expectation.value}`
    case 'greater_than_or_equal':
      return `at least ${expectation.value}`
    case 'less_than':
      return `less than ${expectation.value}`
    case 'less_than_or_equal':
      return `at most ${expectation.value}`
    default:
      return String(expectation.value)
  }
}

/**
 * Validate statistical expectations against data
 */
export function validateStatisticalExpectations(
  expectation: StatisticalExpectation,
  data: Record<string, unknown>[]
): StatisticalExpectationResult {
  const startTime = performance.now()
  const failures: StatisticalFailure[] = []
  const statistics: ComputedStatistics = { rowCount: data.length }

  // Validate row count
  if (expectation.rowCountExpectation) {
    const rowCount = data.length
    const exp = expectation.rowCountExpectation
    let passed = false

    switch (exp.type) {
      case 'exactly':
        passed = rowCount === exp.value
        break
      case 'between':
        passed = rowCount >= exp.min! && rowCount <= exp.max!
        break
      case 'at_least':
        passed = rowCount >= exp.value!
        break
      case 'at_most':
        passed = rowCount <= exp.value!
        break
    }

    if (!passed) {
      const expectedStr =
        exp.type === 'between'
          ? `between ${exp.min} and ${exp.max}`
          : exp.type === 'at_least'
            ? `at least ${exp.value}`
            : exp.type === 'at_most'
              ? `at most ${exp.value}`
              : `exactly ${exp.value}`

      failures.push({
        expectationType: 'row_count',
        message: `Row count ${rowCount} does not match expected ${expectedStr}`,
        expected: exp.type === 'between' ? { min: exp.min, max: exp.max } : exp.value,
        actual: rowCount,
      })
    }
  }

  // Group column expectations by column to calculate stats efficiently
  const columnExpectationMap = new Map<string, { stats: Set<StatisticType>; percentiles: Set<number>; expectations: ColumnExpectation[] }>()

  for (const colExp of expectation.columnExpectations) {
    if (!columnExpectationMap.has(colExp.column)) {
      columnExpectationMap.set(colExp.column, { stats: new Set(), percentiles: new Set(), expectations: [] })
    }
    const entry = columnExpectationMap.get(colExp.column)!
    entry.stats.add(colExp.statistic)
    if (colExp.statistic === 'percentile' && colExp.percentile !== undefined) {
      entry.percentiles.add(colExp.percentile)
    }
    entry.expectations.push(colExp)
  }

  // Calculate and validate column statistics
  const columnEntries = Array.from(columnExpectationMap.entries())
  for (let idx = 0; idx < columnEntries.length; idx++) {
    const [column, { stats, percentiles, expectations }] = columnEntries[idx]!
    const columnStats = calculateColumnStats(data, column, stats, percentiles)
    statistics[column] = columnStats

    for (const colExp of expectations) {
      let actual: number | undefined

      switch (colExp.statistic) {
        case 'mean':
          actual = columnStats.mean
          break
        case 'stddev':
          actual = columnStats.stddev
          break
        case 'percentile':
          actual = columnStats.percentiles?.[colExp.percentile!]
          break
        case 'unique_ratio':
          actual = columnStats.uniqueRatio
          break
        case 'unique_count':
          actual = columnStats.uniqueCount
          break
        case 'null_percentage':
          actual = columnStats.nullPercentage
          break
      }

      // Check if we have valid data for numeric statistics
      if (actual === undefined) {
        if (['mean', 'stddev', 'percentile'].includes(colExp.statistic)) {
          failures.push({
            expectationType: colExp.statistic,
            column,
            statistic: colExp.statistic,
            message: `Column '${column}' has no valid values for ${colExp.statistic} calculation`,
            expected: formatExpected(colExp),
            actual: undefined,
          })
          continue
        }
      }

      const passed = checkComparison(actual, colExp)

      if (!passed) {
        failures.push({
          expectationType: colExp.statistic,
          column,
          statistic: colExp.statistic,
          message: `Column '${column}' ${colExp.statistic} is ${actual?.toFixed(4) ?? 'undefined'}, expected ${formatExpected(colExp)}`,
          expected: colExp.comparison === 'between' ? { min: colExp.min, max: colExp.max } : colExp.value,
          actual,
        })
      }
    }
  }

  const endTime = performance.now()

  return {
    passed: failures.length === 0,
    failures,
    statistics,
    timing: {
      totalMs: endTime - startTime,
    },
  }
}
