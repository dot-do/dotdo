/**
 * Validation Runner - Executes expectation suites against data
 *
 * Provides high-performance validation of data against expectation suites:
 * - Batch validation for entire datasets
 * - Streaming validation for async data sources
 * - Row-level validation for real-time use
 * - Parallel execution for independent expectations
 * - Short-circuit option on first failure
 * - Progress reporting for long-running validations
 *
 * @example
 * ```typescript
 * import { ValidationRunner, expect } from 'dotdo/datacontract'
 *
 * const suite = [
 *   expect('email').toBeNotNull().and().toMatch(/^.+@.+$/).build(),
 *   expect('age').toBeNumber().and().toBeBetween(0, 150).build(),
 * ]
 *
 * const runner = new ValidationRunner(suite)
 *
 * // Batch validation
 * const report = await runner.validate(data)
 *
 * // Streaming validation
 * for await (const result of runner.validateStream(asyncStream)) {
 *   if (!result.passed) handleFailure(result)
 * }
 *
 * // Row-level validation
 * const rowResult = runner.validateRow(row)
 * ```
 */

import type {
  Expectation,
  ExpectationType,
  ExpectationFailure,
  ExpectationResult,
  Constraint,
} from './expectation-dsl'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Suite of expectations to validate against
 */
export type ExpectationSuite = Expectation[]

/**
 * Row-level validation result
 */
export interface RowValidationResult {
  /** Row index (or -1 for single row validation) */
  index: number
  /** Whether the row passed all expectations */
  passed: boolean
  /** List of failures for this row */
  failures: ExpectationFailure[]
  /** The original data row */
  data?: Record<string, unknown>
  /** Timing information */
  timing: {
    totalMs: number
  }
}

/**
 * Batch validation report
 */
export interface ValidationReport {
  /** Overall pass/fail status */
  passed: boolean
  /** Total number of records validated */
  totalRecords: number
  /** Number of records that passed all expectations */
  passedRecords: number
  /** Number of records that failed one or more expectations */
  failedRecords: number
  /** Number of records skipped (for sampling mode) */
  skippedRecords: number
  /** All failures across all records */
  failures: ExpectationFailure[]
  /** Per-row validation results */
  rowResults: RowValidationResult[]
  /** Number of expectations checked */
  expectationsChecked: number
  /** Whether validation terminated early */
  earlyTerminated: boolean
  /** Timing information */
  timing: {
    totalMs: number
    avgPerRecordMs: number
    parseMs: number
    validateMs: number
  }
}

/**
 * Streaming validation result yielded for each record
 */
export interface StreamRowResult extends RowValidationResult {
  /** Cumulative count of passed records so far */
  cumulativePassedCount: number
  /** Cumulative count of failed records so far */
  cumulativeFailedCount: number
}

/**
 * Summary from streaming validation
 */
export interface StreamValidationSummary {
  totalRecords: number
  passedRecords: number
  failedRecords: number
  skippedRecords: number
  expectationsChecked: number
  timing: {
    totalMs: number
    avgPerRecordMs: number
  }
}

/**
 * Progress callback for long-running validations
 */
export type ProgressCallback = (progress: ValidationProgress) => void

/**
 * Progress information
 */
export interface ValidationProgress {
  /** Current record index */
  currentIndex: number
  /** Total records (if known) */
  totalRecords?: number
  /** Percentage complete (0-100) */
  percentComplete?: number
  /** Records processed */
  processedRecords: number
  /** Records passed so far */
  passedRecords: number
  /** Records failed so far */
  failedRecords: number
  /** Elapsed time in ms */
  elapsedMs: number
  /** Estimated time remaining in ms (if total known) */
  estimatedRemainingMs?: number
}

/**
 * Validation runner options
 */
export interface ValidationRunnerOptions {
  /** Stop on first failure (default: false) */
  shortCircuit?: boolean
  /** Maximum number of failures before stopping (default: unlimited) */
  maxFailures?: number
  /** Sample rate for large datasets (0-1, default: 1.0 = validate all) */
  sampleRate?: number
  /** Progress callback for long-running validations */
  onProgress?: ProgressCallback
  /** Progress reporting interval in records (default: 100) */
  progressInterval?: number
  /** Execute independent expectations in parallel (default: false) */
  parallelExecution?: boolean
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * Async data source types
 */
export type AsyncDataSource =
  | AsyncIterable<Record<string, unknown>>
  | Iterable<Record<string, unknown>>
  | (() => AsyncIterable<Record<string, unknown>>)
  | (() => Iterable<Record<string, unknown>>)

// ============================================================================
// VALIDATION RUNNER
// ============================================================================

/**
 * High-performance validation runner for expectation suites
 */
export class ValidationRunner {
  private suite: ExpectationSuite
  private options: Required<ValidationRunnerOptions>

  constructor(suite: ExpectationSuite, options?: ValidationRunnerOptions) {
    this.suite = suite
    this.options = {
      shortCircuit: options?.shortCircuit ?? false,
      maxFailures: options?.maxFailures ?? Infinity,
      sampleRate: options?.sampleRate ?? 1.0,
      onProgress: options?.onProgress ?? (() => {}),
      progressInterval: options?.progressInterval ?? 100,
      parallelExecution: options?.parallelExecution ?? false,
      signal: options?.signal ?? undefined as unknown as AbortSignal,
    }
  }

  // ============================================================================
  // ROW-LEVEL VALIDATION
  // ============================================================================

  /**
   * Validate a single row against the expectation suite
   *
   * @param row - The data row to validate
   * @param index - Optional row index (default: -1)
   * @returns Row validation result
   */
  validateRow(row: Record<string, unknown>, index = -1): RowValidationResult {
    const startTime = performance.now()
    const failures: ExpectationFailure[] = []

    for (const expectation of this.suite) {
      const expFailures = this.validateExpectation(expectation, row, index, [row])

      if (expFailures.length > 0) {
        failures.push(...expFailures)

        if (this.options.shortCircuit) {
          break
        }
      }
    }

    const endTime = performance.now()

    return {
      index,
      passed: failures.length === 0,
      failures,
      data: row,
      timing: {
        totalMs: endTime - startTime,
      },
    }
  }

  // ============================================================================
  // BATCH VALIDATION
  // ============================================================================

  /**
   * Validate an array of data records against the expectation suite
   *
   * @param data - Array of data records to validate
   * @returns Validation report
   */
  validate(data: Record<string, unknown>[]): ValidationReport {
    const startTime = performance.now()
    const parseEndTime = performance.now()

    const failures: ExpectationFailure[] = []
    const rowResults: RowValidationResult[] = []
    let passedCount = 0
    let failedCount = 0
    let skippedCount = 0
    let earlyTerminated = false
    let totalFailures = 0

    // First, run aggregate expectations (once for entire dataset)
    const aggregateFailures = this.validateAggregateExpectations(data)
    failures.push(...aggregateFailures)
    totalFailures += aggregateFailures.length

    // Check for early termination
    if (this.options.shortCircuit && totalFailures > 0) {
      earlyTerminated = true
    }

    if (!earlyTerminated) {
      // Then, run row-level expectations
      for (let i = 0; i < data.length; i++) {
        // Check abort signal
        if (this.options.signal?.aborted) {
          earlyTerminated = true
          break
        }

        // Check max failures
        if (totalFailures >= this.options.maxFailures) {
          earlyTerminated = true
          break
        }

        // Sample mode: skip some records
        if (this.options.sampleRate < 1.0 && Math.random() >= this.options.sampleRate) {
          skippedCount++
          rowResults.push({
            index: i,
            passed: true,
            failures: [],
            data: data[i],
            timing: { totalMs: 0 },
          })
          continue
        }

        const rowResult = this.validateRowLevel(data[i]!, i, data)
        rowResults.push(rowResult)

        if (rowResult.passed) {
          passedCount++
        } else {
          failedCount++
          failures.push(...rowResult.failures)
          totalFailures += rowResult.failures.length
        }

        // Report progress
        if ((i + 1) % this.options.progressInterval === 0) {
          const elapsed = performance.now() - startTime
          this.options.onProgress({
            currentIndex: i,
            totalRecords: data.length,
            percentComplete: ((i + 1) / data.length) * 100,
            processedRecords: i + 1,
            passedRecords: passedCount,
            failedRecords: failedCount,
            elapsedMs: elapsed,
            estimatedRemainingMs: (elapsed / (i + 1)) * (data.length - i - 1),
          })
        }

        // Short circuit on first failure
        if (this.options.shortCircuit && rowResult.failures.length > 0) {
          earlyTerminated = true
          break
        }
      }
    }

    const endTime = performance.now()
    const processedCount = passedCount + failedCount
    const totalMs = endTime - startTime

    return {
      passed: failures.length === 0,
      totalRecords: data.length,
      passedRecords: passedCount,
      failedRecords: failedCount,
      skippedRecords: skippedCount,
      failures,
      rowResults,
      expectationsChecked: this.suite.length,
      earlyTerminated,
      timing: {
        totalMs,
        avgPerRecordMs: processedCount > 0 ? totalMs / processedCount : 0,
        parseMs: parseEndTime - startTime,
        validateMs: endTime - parseEndTime,
      },
    }
  }

  /**
   * Validate data asynchronously (same as validate but returns a Promise)
   * Useful when validation might be computationally expensive
   */
  async validateAsync(data: Record<string, unknown>[]): Promise<ValidationReport> {
    return this.validate(data)
  }

  // ============================================================================
  // STREAMING VALIDATION
  // ============================================================================

  /**
   * Validate records from an async data source, yielding results as they are processed
   *
   * @param source - Async iterable, iterable, or factory function returning records
   * @yields StreamRowResult for each record
   * @returns StreamValidationSummary when complete
   */
  async *validateStream(
    source: AsyncDataSource
  ): AsyncGenerator<StreamRowResult, StreamValidationSummary, undefined> {
    const startTime = performance.now()
    let index = 0
    let passedCount = 0
    let failedCount = 0
    let skippedCount = 0
    let totalFailures = 0
    const collectedData: Record<string, unknown>[] = []

    // Get the iterable
    const iterable = typeof source === 'function' ? source() : source

    for await (const row of iterable) {
      // Check abort signal
      if (this.options.signal?.aborted) {
        break
      }

      // Check max failures
      if (totalFailures >= this.options.maxFailures) {
        break
      }

      // Collect data for aggregate checks later
      collectedData.push(row)

      // Sample mode: skip some records
      if (this.options.sampleRate < 1.0 && Math.random() >= this.options.sampleRate) {
        skippedCount++
        yield {
          index,
          passed: true,
          failures: [],
          data: row,
          timing: { totalMs: 0 },
          cumulativePassedCount: passedCount,
          cumulativeFailedCount: failedCount,
        }
        index++
        continue
      }

      // Validate this row
      const rowResult = this.validateRowLevel(row, index, collectedData)

      if (rowResult.passed) {
        passedCount++
      } else {
        failedCount++
        totalFailures += rowResult.failures.length
      }

      // Report progress
      if ((index + 1) % this.options.progressInterval === 0) {
        const elapsed = performance.now() - startTime
        this.options.onProgress({
          currentIndex: index,
          processedRecords: index + 1,
          passedRecords: passedCount,
          failedRecords: failedCount,
          elapsedMs: elapsed,
        })
      }

      yield {
        ...rowResult,
        cumulativePassedCount: passedCount,
        cumulativeFailedCount: failedCount,
      }

      // Short circuit on first failure
      if (this.options.shortCircuit && rowResult.failures.length > 0) {
        break
      }

      index++
    }

    const endTime = performance.now()
    const processedCount = passedCount + failedCount
    const totalMs = endTime - startTime

    return {
      totalRecords: index,
      passedRecords: passedCount,
      failedRecords: failedCount,
      skippedRecords: skippedCount,
      expectationsChecked: this.suite.length,
      timing: {
        totalMs,
        avgPerRecordMs: processedCount > 0 ? totalMs / processedCount : 0,
      },
    }
  }

  /**
   * Validate a stream and collect results into a batch report
   *
   * @param source - Async data source
   * @returns Promise resolving to ValidationReport
   */
  async validateStreamToBatch(source: AsyncDataSource): Promise<ValidationReport> {
    const startTime = performance.now()
    const failures: ExpectationFailure[] = []
    const rowResults: RowValidationResult[] = []
    let passedCount = 0
    let failedCount = 0
    let skippedCount = 0
    let totalRecords = 0

    const stream = this.validateStream(source)
    let iterResult = await stream.next()

    while (!iterResult.done) {
      const result = iterResult.value
      rowResults.push(result)
      totalRecords++

      if (result.passed) {
        passedCount++
      } else {
        failedCount++
        failures.push(...result.failures)
      }

      iterResult = await stream.next()
    }

    const summary = iterResult.value
    skippedCount = summary?.skippedRecords ?? 0

    const endTime = performance.now()
    const processedCount = passedCount + failedCount
    const totalMs = endTime - startTime

    return {
      passed: failures.length === 0,
      totalRecords,
      passedRecords: passedCount,
      failedRecords: failedCount,
      skippedRecords: skippedCount,
      failures,
      rowResults,
      expectationsChecked: this.suite.length,
      earlyTerminated: false,
      timing: {
        totalMs,
        avgPerRecordMs: processedCount > 0 ? totalMs / processedCount : 0,
        parseMs: 0,
        validateMs: totalMs,
      },
    }
  }

  // ============================================================================
  // PARALLEL EXECUTION
  // ============================================================================

  /**
   * Validate data with parallel expectation execution
   * Independent expectations are run concurrently for better performance
   *
   * @param data - Array of data records
   * @returns Promise resolving to ValidationReport
   */
  async validateParallel(data: Record<string, unknown>[]): Promise<ValidationReport> {
    const startTime = performance.now()
    const parseEndTime = performance.now()

    // Separate aggregate and row-level expectations
    const aggregateExps = this.suite.filter((exp) =>
      exp.constraints.some((c) => this.isAggregateConstraint(c.type))
    )
    const rowExps = this.suite.filter((exp) =>
      !exp.constraints.some((c) => this.isAggregateConstraint(c.type))
    )

    // Run aggregate expectations in parallel
    const aggregatePromises = aggregateExps.map(async (exp) => {
      return this.validateAggregateExpectation(exp, data)
    })

    const aggregateResults = await Promise.all(aggregatePromises)
    const aggregateFailures = aggregateResults.flat()

    // Run row validations in parallel batches
    const BATCH_SIZE = 100
    const rowResults: RowValidationResult[] = []
    const failures: ExpectationFailure[] = [...aggregateFailures]
    let passedCount = 0
    let failedCount = 0
    let skippedCount = 0
    let earlyTerminated = false

    for (let batchStart = 0; batchStart < data.length; batchStart += BATCH_SIZE) {
      if (this.options.signal?.aborted || earlyTerminated) {
        earlyTerminated = true
        break
      }

      const batchEnd = Math.min(batchStart + BATCH_SIZE, data.length)
      const batch = data.slice(batchStart, batchEnd)

      const batchPromises = batch.map(async (row, i) => {
        const globalIndex = batchStart + i

        // Sample mode
        if (this.options.sampleRate < 1.0 && Math.random() >= this.options.sampleRate) {
          return {
            index: globalIndex,
            passed: true,
            failures: [],
            data: row,
            timing: { totalMs: 0 },
            skipped: true,
          }
        }

        const result = this.validateRowLevel(row, globalIndex, data)
        return { ...result, skipped: false }
      })

      const batchResults = await Promise.all(batchPromises)

      for (const result of batchResults) {
        if ((result as { skipped: boolean }).skipped) {
          skippedCount++
          rowResults.push(result)
          continue
        }

        rowResults.push(result)

        if (result.passed) {
          passedCount++
        } else {
          failedCount++
          failures.push(...result.failures)
        }

        if (this.options.shortCircuit && result.failures.length > 0) {
          earlyTerminated = true
          break
        }

        if (failures.length >= this.options.maxFailures) {
          earlyTerminated = true
          break
        }
      }
    }

    const endTime = performance.now()
    const processedCount = passedCount + failedCount
    const totalMs = endTime - startTime

    return {
      passed: failures.length === 0,
      totalRecords: data.length,
      passedRecords: passedCount,
      failedRecords: failedCount,
      skippedRecords: skippedCount,
      failures,
      rowResults,
      expectationsChecked: this.suite.length,
      earlyTerminated,
      timing: {
        totalMs,
        avgPerRecordMs: processedCount > 0 ? totalMs / processedCount : 0,
        parseMs: parseEndTime - startTime,
        validateMs: endTime - parseEndTime,
      },
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Validate a single expectation against a row
   */
  private validateExpectation(
    expectation: Expectation,
    row: Record<string, unknown>,
    rowIndex: number,
    allData: Record<string, unknown>[]
  ): ExpectationFailure[] {
    const { column, constraints, message, logicalOperator } = expectation
    const isOr = logicalOperator === 'or'
    const failures: ExpectationFailure[] = []

    // Separate aggregate and row-level constraints
    const aggregateConstraints = constraints.filter((c) =>
      this.isAggregateConstraint(c.type) || this.isUniquenessConstraint(c.type)
    )
    const rowConstraints = constraints.filter((c) =>
      !this.isAggregateConstraint(c.type) && !this.isUniquenessConstraint(c.type)
    )

    // Validate aggregate constraints
    for (const constraint of aggregateConstraints) {
      const failure = this.validateConstraint(constraint, null, column, rowIndex, allData, isOr)
      if (failure) {
        failures.push({
          ...failure,
          message: message ?? failure.message,
        })
      }
    }

    // Get the value for row-level validation
    const value = this.getNestedValue(row, column)

    if (isOr) {
      // OR logic: at least one constraint must pass
      let anyPassed = false
      const rowFailures: ExpectationFailure[] = []

      for (const constraint of rowConstraints) {
        const failure = this.validateConstraint(constraint, value, column, rowIndex, allData, isOr)
        if (!failure) {
          anyPassed = true
          break
        }
        rowFailures.push({
          ...failure,
          message: message ?? failure.message,
        })
      }

      if (!anyPassed && rowFailures.length > 0) {
        failures.push(rowFailures[0]!)
      }
    } else {
      // AND logic: all constraints must pass
      for (const constraint of rowConstraints) {
        const failure = this.validateConstraint(constraint, value, column, rowIndex, allData, isOr)
        if (failure) {
          failures.push({
            ...failure,
            message: message ?? failure.message,
          })
        }
      }
    }

    return failures
  }

  /**
   * Validate only row-level expectations (not aggregates)
   */
  private validateRowLevel(
    row: Record<string, unknown>,
    index: number,
    allData: Record<string, unknown>[]
  ): RowValidationResult {
    const startTime = performance.now()
    const failures: ExpectationFailure[] = []

    for (const expectation of this.suite) {
      // Skip aggregate-only expectations
      const hasRowConstraints = expectation.constraints.some((c) =>
        !this.isAggregateConstraint(c.type) && !this.isUniquenessConstraint(c.type)
      )

      if (!hasRowConstraints) {
        continue
      }

      const expFailures = this.validateExpectation(expectation, row, index, allData)
      failures.push(...expFailures)

      if (this.options.shortCircuit && expFailures.length > 0) {
        break
      }
    }

    const endTime = performance.now()

    return {
      index,
      passed: failures.length === 0,
      failures,
      data: row,
      timing: {
        totalMs: endTime - startTime,
      },
    }
  }

  /**
   * Validate aggregate expectations against the entire dataset
   */
  private validateAggregateExpectations(data: Record<string, unknown>[]): ExpectationFailure[] {
    const failures: ExpectationFailure[] = []

    for (const expectation of this.suite) {
      const aggregateConstraints = expectation.constraints.filter((c) =>
        this.isAggregateConstraint(c.type) || this.isUniquenessConstraint(c.type)
      )

      if (aggregateConstraints.length === 0) {
        continue
      }

      for (const constraint of aggregateConstraints) {
        const failure = this.validateConstraint(
          constraint,
          null,
          expectation.column,
          -1,
          data,
          expectation.logicalOperator === 'or'
        )

        if (failure) {
          failures.push({
            ...failure,
            message: expectation.message ?? failure.message,
          })
        }
      }
    }

    return failures
  }

  /**
   * Validate a single aggregate expectation
   */
  private async validateAggregateExpectation(
    expectation: Expectation,
    data: Record<string, unknown>[]
  ): Promise<ExpectationFailure[]> {
    const failures: ExpectationFailure[] = []

    const aggregateConstraints = expectation.constraints.filter((c) =>
      this.isAggregateConstraint(c.type) || this.isUniquenessConstraint(c.type)
    )

    for (const constraint of aggregateConstraints) {
      const failure = this.validateConstraint(
        constraint,
        null,
        expectation.column,
        -1,
        data,
        expectation.logicalOperator === 'or'
      )

      if (failure) {
        failures.push({
          ...failure,
          message: expectation.message ?? failure.message,
        })
      }
    }

    return failures
  }

  /**
   * Validate a single constraint against a value
   */
  private validateConstraint(
    constraint: Constraint,
    value: unknown,
    column: string,
    rowIndex: number,
    allData: Record<string, unknown>[],
    _isOr: boolean
  ): ExpectationFailure | null {
    const { type, params } = constraint

    // Skip null/undefined for non-null checks, except for aggregate and unique constraints
    const isAggregate = this.isAggregateConstraint(type)
    const isUnique = this.isUniquenessConstraint(type)
    if (!isAggregate && !isUnique && type !== 'not_null' && (value === null || value === undefined)) {
      return null
    }

    switch (type) {
      case 'not_null':
        if (value === null || value === undefined) {
          return {
            column,
            expectationType: type,
            message: `Column '${column}' must not be null or empty`,
            rowIndex,
            actualValue: value,
          }
        }
        break

      case 'unique': {
        const values = allData
          .map((row) => this.getNestedValue(row, column))
          .filter((v) => v !== null && v !== undefined)
        const seen = new Set()
        for (const v of values) {
          if (seen.has(v)) {
            return {
              column,
              expectationType: type,
              message: `Column '${column}' has duplicate values`,
            }
          }
          seen.add(v)
        }
        break
      }

      case 'pattern': {
        const pattern = params?.pattern as RegExp
        if (typeof value === 'string' && !pattern.test(value)) {
          return {
            column,
            expectationType: type,
            message: `Column '${column}' value '${value}' does not match pattern ${pattern}`,
            rowIndex,
            actualValue: value,
          }
        }
        break
      }

      case 'in_set': {
        const allowedValues = params?.values as (string | number | boolean)[]
        if (!allowedValues.includes(value as string | number | boolean)) {
          return {
            column,
            expectationType: type,
            message: `Column '${column}' value '${value}' is not in allowed set`,
            rowIndex,
            actualValue: value,
          }
        }
        break
      }

      case 'greater_than': {
        const threshold = params?.value as number
        if (typeof value === 'number' && value <= threshold) {
          return {
            column,
            expectationType: type,
            message: `Column '${column}' value ${value} is not greater than ${threshold}`,
            rowIndex,
            actualValue: value,
          }
        }
        break
      }

      case 'greater_than_or_equal': {
        const threshold = params?.value as number
        if (typeof value === 'number' && value < threshold) {
          return {
            column,
            expectationType: type,
            message: `Column '${column}' value ${value} is not greater than or equal to ${threshold}`,
            rowIndex,
            actualValue: value,
          }
        }
        break
      }

      case 'less_than': {
        const threshold = params?.value as number
        if (typeof value === 'number' && value >= threshold) {
          return {
            column,
            expectationType: type,
            message: `Column '${column}' value ${value} is not less than ${threshold}`,
            rowIndex,
            actualValue: value,
          }
        }
        break
      }

      case 'less_than_or_equal': {
        const threshold = params?.value as number
        if (typeof value === 'number' && value > threshold) {
          return {
            column,
            expectationType: type,
            message: `Column '${column}' value ${value} is not less than or equal to ${threshold}`,
            rowIndex,
            actualValue: value,
          }
        }
        break
      }

      case 'between': {
        const min = params?.min as number
        const max = params?.max as number
        const exclusive = params?.exclusive as boolean
        if (typeof value === 'number') {
          const failsMin = exclusive ? value <= min : value < min
          const failsMax = exclusive ? value >= max : value > max
          if (failsMin || failsMax) {
            return {
              column,
              expectationType: type,
              message: `Column '${column}' value ${value} is not between ${min} and ${max}`,
              rowIndex,
              actualValue: value,
            }
          }
        }
        break
      }

      case 'type_string':
        if (typeof value !== 'string') {
          return {
            column,
            expectationType: type,
            message: `Column '${column}' value is not a string`,
            rowIndex,
            actualValue: value,
          }
        }
        break

      case 'type_number':
        if (typeof value !== 'number') {
          return {
            column,
            expectationType: type,
            message: `Column '${column}' value is not a number`,
            rowIndex,
            actualValue: value,
          }
        }
        break

      case 'type_integer':
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          return {
            column,
            expectationType: type,
            message: `Column '${column}' value is not an integer`,
            rowIndex,
            actualValue: value,
          }
        }
        break

      case 'type_date':
        if (!this.isValidDate(value)) {
          return {
            column,
            expectationType: type,
            message: `Column '${column}' value is not a valid date`,
            rowIndex,
            actualValue: value,
          }
        }
        break

      case 'type_boolean':
        if (typeof value !== 'boolean') {
          return {
            column,
            expectationType: type,
            message: `Column '${column}' value is not a boolean`,
            rowIndex,
            actualValue: value,
          }
        }
        break

      case 'min_length': {
        const minLen = params?.length as number
        if (typeof value === 'string' && value.length < minLen) {
          return {
            column,
            expectationType: type,
            message: `Column '${column}' value length ${value.length} is less than minimum ${minLen}`,
            rowIndex,
            actualValue: value,
          }
        }
        break
      }

      case 'max_length': {
        const maxLen = params?.length as number
        if (typeof value === 'string' && value.length > maxLen) {
          return {
            column,
            expectationType: type,
            message: `Column '${column}' value length ${value.length} exceeds maximum ${maxLen}`,
            rowIndex,
            actualValue: value,
          }
        }
        break
      }

      case 'aggregate_count': {
        const expected = params?.expected as number | { min?: number; max?: number }
        const count = allData.length
        if (typeof expected === 'number') {
          if (count !== expected) {
            return {
              column,
              expectationType: type,
              message: `Row count ${count} does not match expected ${expected}`,
            }
          }
        } else {
          if (expected.min !== undefined && count < expected.min) {
            return {
              column,
              expectationType: type,
              message: `Row count ${count} is below minimum ${expected.min}`,
            }
          }
          if (expected.max !== undefined && count > expected.max) {
            return {
              column,
              expectationType: type,
              message: `Row count ${count} exceeds maximum ${expected.max}`,
            }
          }
        }
        break
      }

      case 'aggregate_sum': {
        const expected = params?.expected as number | { min?: number; max?: number }
        const values = allData
          .map((row) => this.getNestedValue(row, column))
          .filter((v) => typeof v === 'number') as number[]
        const sum = values.reduce((a, b) => a + b, 0)
        if (typeof expected === 'number') {
          if (sum !== expected) {
            return {
              column,
              expectationType: type,
              message: `Sum ${sum} does not match expected ${expected}`,
            }
          }
        } else {
          if (expected.min !== undefined && sum < expected.min) {
            return {
              column,
              expectationType: type,
              message: `Sum ${sum} is below minimum ${expected.min}`,
            }
          }
          if (expected.max !== undefined && sum > expected.max) {
            return {
              column,
              expectationType: type,
              message: `Sum ${sum} exceeds maximum ${expected.max}`,
            }
          }
        }
        break
      }

      case 'aggregate_avg': {
        const expected = params?.expected as number
        const tolerance = (params?.tolerance as number) ?? 0
        const values = allData
          .map((row) => this.getNestedValue(row, column))
          .filter((v) => typeof v === 'number') as number[]
        if (values.length > 0) {
          const avg = values.reduce((a, b) => a + b, 0) / values.length
          if (Math.abs(avg - expected) > tolerance) {
            return {
              column,
              expectationType: type,
              message: `Average ${avg} does not match expected ${expected} (tolerance: ${tolerance})`,
            }
          }
        }
        break
      }

      case 'aggregate_min': {
        const expected = params?.expected as number
        const values = allData
          .map((row) => this.getNestedValue(row, column))
          .filter((v) => typeof v === 'number') as number[]
        if (values.length > 0) {
          const min = Math.min(...values)
          if (min !== expected) {
            return {
              column,
              expectationType: type,
              message: `Minimum ${min} does not match expected ${expected}`,
            }
          }
        }
        break
      }

      case 'aggregate_max': {
        const expected = params?.expected as number
        const values = allData
          .map((row) => this.getNestedValue(row, column))
          .filter((v) => typeof v === 'number') as number[]
        if (values.length > 0) {
          const max = Math.max(...values)
          if (max !== expected) {
            return {
              column,
              expectationType: type,
              message: `Maximum ${max} does not match expected ${expected}`,
            }
          }
        }
        break
      }
    }

    return null
  }

  /**
   * Get a value from a nested path like 'address.city' or 'tags[0]'
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
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
   * Check if a value is a valid date
   */
  private isValidDate(value: unknown): boolean {
    if (value instanceof Date) {
      return !isNaN(value.getTime())
    }
    if (typeof value === 'string') {
      const date = new Date(value)
      return !isNaN(date.getTime())
    }
    return false
  }

  /**
   * Check if a constraint is an aggregate constraint
   */
  private isAggregateConstraint(type: ExpectationType): boolean {
    return type.startsWith('aggregate_')
  }

  /**
   * Check if a constraint is a uniqueness constraint
   */
  private isUniquenessConstraint(type: ExpectationType): boolean {
    return type === 'unique'
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a validation runner for an expectation suite
 *
 * @param suite - Array of expectations to validate against
 * @param options - Optional configuration
 * @returns ValidationRunner instance
 */
export function createRunner(
  suite: ExpectationSuite,
  options?: ValidationRunnerOptions
): ValidationRunner {
  return new ValidationRunner(suite, options)
}

/**
 * Quick validation helper - validates data against expectations
 *
 * @param suite - Expectation suite
 * @param data - Data to validate
 * @param options - Optional configuration
 * @returns ValidationReport
 */
export function runValidation(
  suite: ExpectationSuite,
  data: Record<string, unknown>[],
  options?: ValidationRunnerOptions
): ValidationReport {
  const runner = createRunner(suite, options)
  return runner.validate(data)
}

/**
 * Quick row validation helper
 *
 * @param suite - Expectation suite
 * @param row - Single row to validate
 * @returns RowValidationResult
 */
export function validateSingleRow(
  suite: ExpectationSuite,
  row: Record<string, unknown>
): RowValidationResult {
  const runner = createRunner(suite)
  return runner.validateRow(row)
}
