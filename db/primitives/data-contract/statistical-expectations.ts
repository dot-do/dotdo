/**
 * Statistical Expectations - Aggregate validation for data contracts
 *
 * Provides statistical validation expectations:
 * - Central tendency: mean, median bounds
 * - Dispersion: standard deviation, variance limits
 * - Cardinality: unique count, null rate
 * - Distribution: normality tests
 *
 * Uses streaming algorithms where possible for memory efficiency.
 */

import type { Constraint, ExpectationFailure } from './expectation-dsl'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Extended expectation types for statistical checks
 */
export type StatisticalExpectationType =
  // Central tendency
  | 'stat_mean_between'
  | 'stat_median_between'
  // Dispersion
  | 'stat_stddev_less_than'
  | 'stat_variance_less_than'
  // Cardinality
  | 'stat_unique_count'
  | 'stat_null_rate'
  // Distribution
  | 'stat_normally_distributed'
  // Percentiles
  | 'stat_percentile'

/**
 * Result from statistical calculations
 */
export interface StatisticalResult {
  mean?: number
  median?: number
  stdDev?: number
  variance?: number
  uniqueCount?: number
  nullCount?: number
  nullRate?: number
  totalCount?: number
  percentiles?: Record<number, number>
  skewness?: number
  kurtosis?: number
  isNormal?: boolean
  normalityPValue?: number
}

/**
 * Options for percentile assertion
 */
export interface PercentileOptions {
  percentile: number
  min?: number
  max?: number
  exact?: number
}

/**
 * Options for normality test
 */
export interface NormalityOptions {
  /** Significance level for the test (default: 0.05) */
  alpha?: number
  /** Tolerance for skewness/kurtosis-based test */
  tolerance?: number
}

// ============================================================================
// STREAMING STATISTICAL ALGORITHMS
// ============================================================================

/**
 * Welford's online algorithm for computing mean and variance in a single pass.
 * Memory efficient - O(1) space complexity.
 *
 * Reference: Welford, B. P. (1962). "Note on a method for calculating
 * corrected sums of squares and products"
 */
export class StreamingStats {
  private n = 0
  private mean = 0
  private m2 = 0
  private min = Infinity
  private max = -Infinity

  /**
   * Add a value to the running statistics
   */
  push(x: number): void {
    this.n++
    const delta = x - this.mean
    this.mean += delta / this.n
    const delta2 = x - this.mean
    this.m2 += delta * delta2

    if (x < this.min) this.min = x
    if (x > this.max) this.max = x
  }

  /**
   * Get the current count
   */
  count(): number {
    return this.n
  }

  /**
   * Get the current mean
   */
  getMean(): number {
    return this.n > 0 ? this.mean : NaN
  }

  /**
   * Get the population variance
   */
  getVariance(): number {
    return this.n > 1 ? this.m2 / this.n : 0
  }

  /**
   * Get the sample variance (unbiased estimator)
   */
  getSampleVariance(): number {
    return this.n > 1 ? this.m2 / (this.n - 1) : 0
  }

  /**
   * Get the population standard deviation
   */
  getStdDev(): number {
    return Math.sqrt(this.getVariance())
  }

  /**
   * Get the sample standard deviation
   */
  getSampleStdDev(): number {
    return Math.sqrt(this.getSampleVariance())
  }

  /**
   * Get the minimum value
   */
  getMin(): number {
    return this.n > 0 ? this.min : NaN
  }

  /**
   * Get the maximum value
   */
  getMax(): number {
    return this.n > 0 ? this.max : NaN
  }
}

/**
 * Memory-efficient unique counter using a Set.
 * For very large datasets, consider using HyperLogLog instead.
 */
export class UniqueCounter<T> {
  private seen = new Set<T>()
  private nullCount = 0
  private totalCount = 0

  /**
   * Add a value to the counter
   */
  push(value: T | null | undefined): void {
    this.totalCount++
    if (value === null || value === undefined) {
      this.nullCount++
    } else {
      this.seen.add(value)
    }
  }

  /**
   * Get the count of unique non-null values
   */
  getUniqueCount(): number {
    return this.seen.size
  }

  /**
   * Get the count of null/undefined values
   */
  getNullCount(): number {
    return this.nullCount
  }

  /**
   * Get the total count of values
   */
  getTotalCount(): number {
    return this.totalCount
  }

  /**
   * Get the null rate as a percentage (0-100)
   */
  getNullRate(): number {
    return this.totalCount > 0 ? (this.nullCount / this.totalCount) * 100 : 0
  }
}

// ============================================================================
// STATISTICAL CALCULATIONS
// ============================================================================

/**
 * Calculate median using quickselect-based algorithm.
 * Time: O(n) average, O(n^2) worst case
 * Space: O(n) - requires full array in memory
 */
export function calculateMedian(values: number[]): number {
  if (values.length === 0) return NaN

  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2
  }
  return sorted[mid]!
}

/**
 * Calculate a specific percentile.
 * Uses linear interpolation method.
 */
export function calculatePercentile(values: number[], p: number): number {
  if (values.length === 0) return NaN
  if (p < 0 || p > 100) throw new Error('Percentile must be between 0 and 100')

  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length

  if (p === 0) return sorted[0]!
  if (p === 100) return sorted[n - 1]!

  // Linear interpolation
  const rank = (p / 100) * (n - 1)
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  const fraction = rank - lower

  if (lower === upper) return sorted[lower]!
  return sorted[lower]! + fraction * (sorted[upper]! - sorted[lower]!)
}

/**
 * Calculate skewness (measure of asymmetry).
 * Uses Fisher-Pearson standardized moment coefficient.
 */
export function calculateSkewness(values: number[], mean: number, stdDev: number): number {
  if (values.length < 3 || stdDev === 0) return 0

  const n = values.length
  let sum = 0

  for (const v of values) {
    sum += Math.pow((v - mean) / stdDev, 3)
  }

  // Apply bias correction
  const correction = (n * n) / ((n - 1) * (n - 2))
  return correction * (sum / n)
}

/**
 * Calculate excess kurtosis (measure of "tailedness").
 * Uses Fisher's definition where normal distribution has kurtosis of 0.
 */
export function calculateKurtosis(values: number[], mean: number, stdDev: number): number {
  if (values.length < 4 || stdDev === 0) return 0

  const n = values.length
  let sum = 0

  for (const v of values) {
    sum += Math.pow((v - mean) / stdDev, 4)
  }

  // Apply bias correction for excess kurtosis
  const m4 = sum / n
  const correction = ((n + 1) * n) / ((n - 1) * (n - 2) * (n - 3))
  const bias = (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3))

  return correction * m4 - bias
}

/**
 * Jarque-Bera test for normality.
 * Tests whether sample data has skewness and kurtosis matching a normal distribution.
 *
 * Returns a p-value. If p-value < alpha, reject the null hypothesis of normality.
 */
export function jarqueBeraNormalityTest(
  values: number[],
  mean: number,
  stdDev: number
): { statistic: number; pValue: number; isNormal: boolean; alpha: number } {
  const n = values.length
  const alpha = 0.05

  if (n < 20) {
    // JB test is not reliable for small samples
    // Use simplified skewness/kurtosis check instead
    const skew = calculateSkewness(values, mean, stdDev)
    const kurt = calculateKurtosis(values, mean, stdDev)

    // Approximate normality if skewness is close to 0 and kurtosis is close to 0
    const isNormal = Math.abs(skew) < 2 && Math.abs(kurt) < 7
    return { statistic: NaN, pValue: isNormal ? 1 : 0, isNormal, alpha }
  }

  const skewness = calculateSkewness(values, mean, stdDev)
  const kurtosis = calculateKurtosis(values, mean, stdDev)

  // Jarque-Bera statistic
  const jb = (n / 6) * (skewness * skewness + (kurtosis * kurtosis) / 4)

  // Approximate p-value using chi-square distribution with 2 degrees of freedom
  // P(X > jb) where X ~ chi-square(2)
  const pValue = Math.exp(-jb / 2)

  return {
    statistic: jb,
    pValue,
    isNormal: pValue >= alpha,
    alpha,
  }
}

// ============================================================================
// COMPUTE ALL STATISTICS
// ============================================================================

/**
 * Compute comprehensive statistics for a dataset.
 * Uses streaming algorithms where possible.
 */
export function computeStatistics(values: unknown[], column: string): StatisticalResult {
  const stats = new StreamingStats()
  const uniqueCounter = new UniqueCounter<unknown>()
  const numericValues: number[] = []

  // Single pass for streaming stats
  for (const value of values) {
    uniqueCounter.push(value)

    if (typeof value === 'number' && !isNaN(value)) {
      stats.push(value)
      numericValues.push(value)
    }
  }

  const result: StatisticalResult = {
    totalCount: uniqueCounter.getTotalCount(),
    nullCount: uniqueCounter.getNullCount(),
    nullRate: uniqueCounter.getNullRate(),
    uniqueCount: uniqueCounter.getUniqueCount(),
  }

  if (numericValues.length > 0) {
    result.mean = stats.getMean()
    result.variance = stats.getSampleVariance()
    result.stdDev = stats.getSampleStdDev()
    result.median = calculateMedian(numericValues)

    // Calculate percentiles
    result.percentiles = {
      5: calculatePercentile(numericValues, 5),
      25: calculatePercentile(numericValues, 25),
      50: calculatePercentile(numericValues, 50),
      75: calculatePercentile(numericValues, 75),
      95: calculatePercentile(numericValues, 95),
    }

    // Calculate distribution moments
    if (numericValues.length >= 3 && result.stdDev && result.stdDev > 0) {
      result.skewness = calculateSkewness(numericValues, result.mean!, result.stdDev)
    }

    if (numericValues.length >= 4 && result.stdDev && result.stdDev > 0) {
      result.kurtosis = calculateKurtosis(numericValues, result.mean!, result.stdDev)
    }

    // Normality test
    if (numericValues.length >= 3 && result.stdDev && result.stdDev > 0) {
      const normality = jarqueBeraNormalityTest(numericValues, result.mean!, result.stdDev)
      result.isNormal = normality.isNormal
      result.normalityPValue = normality.pValue
    }
  }

  return result
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate statistical constraint against computed statistics
 */
export function validateStatisticalConstraint(
  constraint: Constraint,
  column: string,
  stats: StatisticalResult
): ExpectationFailure | null {
  const { type, params } = constraint

  switch (type as StatisticalExpectationType) {
    case 'stat_mean_between': {
      const min = params?.min as number
      const max = params?.max as number
      const mean = stats.mean

      if (mean === undefined || isNaN(mean)) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' has no numeric values to calculate mean`,
        }
      }

      if (mean < min || mean > max) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' mean ${mean.toFixed(4)} is not between ${min} and ${max}`,
          actualValue: mean,
        }
      }
      break
    }

    case 'stat_median_between': {
      const min = params?.min as number
      const max = params?.max as number
      const median = stats.median

      if (median === undefined || isNaN(median)) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' has no numeric values to calculate median`,
        }
      }

      if (median < min || median > max) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' median ${median.toFixed(4)} is not between ${min} and ${max}`,
          actualValue: median,
        }
      }
      break
    }

    case 'stat_stddev_less_than': {
      const maxStdDev = params?.max as number
      const stdDev = stats.stdDev

      if (stdDev === undefined || isNaN(stdDev)) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' has no numeric values to calculate standard deviation`,
        }
      }

      if (stdDev > maxStdDev) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' standard deviation ${stdDev.toFixed(4)} exceeds maximum ${maxStdDev}`,
          actualValue: stdDev,
        }
      }
      break
    }

    case 'stat_variance_less_than': {
      const maxVariance = params?.max as number
      const variance = stats.variance

      if (variance === undefined || isNaN(variance)) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' has no numeric values to calculate variance`,
        }
      }

      if (variance > maxVariance) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' variance ${variance.toFixed(4)} exceeds maximum ${maxVariance}`,
          actualValue: variance,
        }
      }
      break
    }

    case 'stat_unique_count': {
      const min = params?.min as number | undefined
      const max = params?.max as number | undefined
      const exact = params?.exact as number | undefined
      const uniqueCount = stats.uniqueCount ?? 0

      if (exact !== undefined && uniqueCount !== exact) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' has ${uniqueCount} unique values, expected exactly ${exact}`,
          actualValue: uniqueCount,
        }
      }

      if (min !== undefined && uniqueCount < min) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' has ${uniqueCount} unique values, expected at least ${min}`,
          actualValue: uniqueCount,
        }
      }

      if (max !== undefined && uniqueCount > max) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' has ${uniqueCount} unique values, expected at most ${max}`,
          actualValue: uniqueCount,
        }
      }
      break
    }

    case 'stat_null_rate': {
      const maxRate = params?.maxPercent as number
      const nullRate = stats.nullRate ?? 0

      if (nullRate > maxRate) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' null rate ${nullRate.toFixed(2)}% exceeds maximum ${maxRate}%`,
          actualValue: nullRate,
        }
      }
      break
    }

    case 'stat_normally_distributed': {
      const tolerance = params?.tolerance as number | undefined
      const alpha = params?.alpha as number | undefined ?? 0.05

      if (stats.isNormal === undefined) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' has insufficient data for normality test`,
        }
      }

      // If using tolerance-based approach, check skewness and kurtosis
      if (tolerance !== undefined) {
        const skewness = stats.skewness ?? 0
        const kurtosis = stats.kurtosis ?? 0

        if (Math.abs(skewness) > tolerance || Math.abs(kurtosis) > tolerance * 2) {
          return {
            column,
            expectationType: type,
            message: `Column '${column}' distribution is not normal (skewness: ${skewness.toFixed(4)}, kurtosis: ${kurtosis.toFixed(4)})`,
            actualValue: { skewness, kurtosis },
          }
        }
      } else if (!stats.isNormal) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' distribution is not normal (p-value: ${(stats.normalityPValue ?? 0).toFixed(4)} < ${alpha})`,
          actualValue: { pValue: stats.normalityPValue, isNormal: stats.isNormal },
        }
      }
      break
    }

    case 'stat_percentile': {
      const percentile = params?.percentile as number
      const min = params?.min as number | undefined
      const max = params?.max as number | undefined
      const exact = params?.exact as number | undefined
      const tolerance = params?.tolerance as number | undefined ?? 0

      const pValue = stats.percentiles?.[percentile]

      if (pValue === undefined || isNaN(pValue)) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' could not calculate ${percentile}th percentile`,
        }
      }

      if (exact !== undefined && Math.abs(pValue - exact) > tolerance) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' ${percentile}th percentile ${pValue.toFixed(4)} does not match expected ${exact} (tolerance: ${tolerance})`,
          actualValue: pValue,
        }
      }

      if (min !== undefined && pValue < min) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' ${percentile}th percentile ${pValue.toFixed(4)} is below minimum ${min}`,
          actualValue: pValue,
        }
      }

      if (max !== undefined && pValue > max) {
        return {
          column,
          expectationType: type,
          message: `Column '${column}' ${percentile}th percentile ${pValue.toFixed(4)} exceeds maximum ${max}`,
          actualValue: pValue,
        }
      }
      break
    }
  }

  return null
}

// ============================================================================
// BUILDER EXTENSION
// ============================================================================

/**
 * Statistical expectation builder mixin.
 * Extends the base ExpectationBuilder with statistical methods.
 */
export class StatisticalExpectationBuilder {
  public readonly column: string
  private constraints: Constraint[] = []
  private customMessage?: string

  constructor(column: string) {
    this.column = column
  }

  // ============================================================================
  // CENTRAL TENDENCY
  // ============================================================================

  /**
   * Expect the mean of column values to be within a range
   */
  toHaveMeanBetween(min: number, max: number): this {
    this.constraints.push({
      type: 'stat_mean_between' as const,
      params: { min, max },
    })
    return this
  }

  /**
   * Expect the median of column values to be within a range
   */
  toHaveMedianBetween(min: number, max: number): this {
    this.constraints.push({
      type: 'stat_median_between' as const,
      params: { min, max },
    })
    return this
  }

  // ============================================================================
  // DISPERSION
  // ============================================================================

  /**
   * Expect the standard deviation to be less than a threshold
   */
  toHaveStdDevLessThan(max: number): this {
    this.constraints.push({
      type: 'stat_stddev_less_than' as const,
      params: { max },
    })
    return this
  }

  /**
   * Expect the variance to be less than a threshold
   */
  toHaveVarianceLessThan(max: number): this {
    this.constraints.push({
      type: 'stat_variance_less_than' as const,
      params: { max },
    })
    return this
  }

  // ============================================================================
  // CARDINALITY
  // ============================================================================

  /**
   * Expect a specific number or range of unique values
   */
  toHaveUniqueCount(options: number | { min?: number; max?: number }): this {
    const params = typeof options === 'number' ? { exact: options } : options
    this.constraints.push({
      type: 'stat_unique_count' as const,
      params,
    })
    return this
  }

  /**
   * Expect the null rate to be at most a certain percentage
   */
  toHaveNullRate(maxPercent: number): this {
    this.constraints.push({
      type: 'stat_null_rate' as const,
      params: { maxPercent },
    })
    return this
  }

  // ============================================================================
  // DISTRIBUTION
  // ============================================================================

  /**
   * Expect the distribution to be approximately normal
   */
  toBeNormallyDistributed(options?: NormalityOptions): this {
    this.constraints.push({
      type: 'stat_normally_distributed' as const,
      params: {
        alpha: options?.alpha ?? 0.05,
        tolerance: options?.tolerance,
      },
    })
    return this
  }

  // ============================================================================
  // PERCENTILES
  // ============================================================================

  /**
   * Expect a percentile value to be within bounds
   */
  toHavePercentile(
    percentile: number,
    options: { min?: number; max?: number; exact?: number; tolerance?: number }
  ): this {
    this.constraints.push({
      type: 'stat_percentile' as const,
      params: { percentile, ...options },
    })
    return this
  }

  // ============================================================================
  // MESSAGE & BUILD
  // ============================================================================

  /**
   * Set a custom error message
   */
  withMessage(message: string): this {
    this.customMessage = message
    return this
  }

  /**
   * Chain with and()
   */
  and(): this {
    return this
  }

  /**
   * Build the expectation
   */
  build(): StatisticalExpectation {
    return {
      column: this.column,
      constraints: this.constraints,
      message: this.customMessage,
    }
  }
}

/**
 * Statistical expectation definition
 */
export interface StatisticalExpectation {
  column: string
  constraints: Constraint[]
  message?: string
}

/**
 * Result of statistical expectation validation
 */
export interface StatisticalExpectationResult {
  passed: boolean
  failures: ExpectationFailure[]
  statistics: Record<string, StatisticalResult>
  expectationsChecked: number
  timing: {
    totalMs: number
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

/**
 * Create a statistical expectation builder for a column
 */
export function statExpect(column: string): StatisticalExpectationBuilder {
  return new StatisticalExpectationBuilder(column)
}

// ============================================================================
// VALIDATION ENGINE
// ============================================================================

/**
 * Get a value from a nested path like 'address.city' or 'tags[0]'
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(/\.|\[|\]/).filter((p) => p !== '')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }

  return current
}

/**
 * Validate statistical expectations against data
 */
export function validateStatisticalExpectations(
  expectations: StatisticalExpectation[],
  data: Record<string, unknown>[]
): StatisticalExpectationResult {
  const startTime = performance.now()
  const failures: ExpectationFailure[] = []
  const statistics: Record<string, StatisticalResult> = {}

  // Compute statistics for each unique column
  const columns = new Set(expectations.map((e) => e.column))

  for (const column of columns) {
    const values = data.map((row) => getNestedValue(row, column))
    statistics[column] = computeStatistics(values, column)
  }

  // Validate each expectation
  for (const expectation of expectations) {
    const { column, constraints, message } = expectation
    const stats = statistics[column]!

    for (const constraint of constraints) {
      const failure = validateStatisticalConstraint(constraint, column, stats)
      if (failure) {
        failures.push({
          ...failure,
          message: message ?? failure.message,
        })
      }
    }
  }

  const endTime = performance.now()

  return {
    passed: failures.length === 0,
    failures,
    statistics,
    expectationsChecked: expectations.length,
    timing: {
      totalMs: endTime - startTime,
    },
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  statExpect as stat,
  statExpect as expectStats,
}
