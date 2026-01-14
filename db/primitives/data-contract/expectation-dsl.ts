/**
 * Expectation DSL - Fluent API for data contract validation
 *
 * Provides a readable, fluent way to define expectations on data columns:
 *
 * ```typescript
 * import { expect } from './expectation-dsl'
 *
 * const expectations = [
 *   expect('email').toBeNotNull().and().toMatch(/^.+@.+$/).build(),
 *   expect('age').toBeNumber().and().toBeBetween(0, 150).build(),
 *   expect('status').toBeIn(['active', 'inactive', 'pending']).build(),
 *   expect('id').toBeUnique().build(),
 *   expect('amount').toHaveSum({ min: 0, max: 1000000 }).build(),
 * ]
 *
 * const result = validateExpectations(expectations, data)
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Types of expectations that can be defined
 */
export type ExpectationType =
  // Null/existence checks
  | 'not_null'
  | 'unique'
  // Pattern matching
  | 'pattern'
  | 'in_set'
  // Comparisons
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal'
  | 'between'
  // Type checks
  | 'type_string'
  | 'type_number'
  | 'type_integer'
  | 'type_date'
  | 'type_boolean'
  // String length
  | 'min_length'
  | 'max_length'
  // Aggregates
  | 'aggregate_count'
  | 'aggregate_sum'
  | 'aggregate_avg'
  | 'aggregate_min'
  | 'aggregate_max'

/**
 * Logical operator for combining constraints
 */
export type LogicalOperator = 'and' | 'or'

/**
 * Single constraint within an expectation
 */
export interface Constraint {
  type: ExpectationType
  params?: Record<string, unknown>
}

/**
 * Full expectation definition
 */
export interface Expectation {
  column: string
  type: ExpectationType
  constraints: Constraint[]
  params?: Record<string, unknown>
  message?: string
  logicalOperator?: LogicalOperator
}

/**
 * Single validation failure
 */
export interface ExpectationFailure {
  column: string
  expectationType: ExpectationType
  message: string
  rowIndex?: number
  actualValue?: unknown
}

/**
 * Overall validation result
 */
export interface ExpectationResult {
  passed: boolean
  failures: ExpectationFailure[]
  expectationsChecked: number
  timing: {
    totalMs: number
  }
}

/**
 * Count expectation options (exact or range)
 */
export type CountExpectation = number | { min?: number; max?: number }

/**
 * Sum/Avg expectation options
 */
export type AggregateExpectation = number | { min?: number; max?: number }

/**
 * Between options
 */
export interface BetweenOptions {
  exclusive?: boolean
}

/**
 * Average options with tolerance
 */
export interface AvgOptions {
  tolerance?: number
}

// ============================================================================
// EXPECTATION BUILDER
// ============================================================================

/**
 * Fluent builder for constructing expectations
 */
export class ExpectationBuilder {
  public readonly column: string
  private constraints: Constraint[] = []
  private customMessage?: string
  private operator: LogicalOperator = 'and'
  private pendingOperator?: LogicalOperator

  constructor(column: string) {
    this.column = column
  }

  // ============================================================================
  // NULL/EXISTENCE CHECKS
  // ============================================================================

  /**
   * Expect the column value to not be null or undefined
   */
  toBeNotNull(): this {
    this.addConstraint({ type: 'not_null' })
    return this
  }

  /**
   * Expect all values in the column to be unique
   */
  toBeUnique(): this {
    this.addConstraint({ type: 'unique' })
    return this
  }

  // ============================================================================
  // PATTERN MATCHING
  // ============================================================================

  /**
   * Expect the column value to match a regex pattern
   */
  toMatch(pattern: RegExp | string): this {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
    this.addConstraint({ type: 'pattern', params: { pattern: regex } })
    return this
  }

  /**
   * Alias for toMatch() - Expect the column value to match a regex pattern
   */
  toMatchRegex(pattern: RegExp | string): this {
    return this.toMatch(pattern)
  }

  /**
   * Expect the column value to be one of the specified values
   */
  toBeIn(values: readonly (string | number | boolean)[]): this {
    this.addConstraint({ type: 'in_set', params: { values: [...values] } })
    return this
  }

  // ============================================================================
  // COMPARISONS
  // ============================================================================

  /**
   * Expect the column value to be greater than the specified value
   */
  toBeGreaterThan(value: number): this {
    this.addConstraint({ type: 'greater_than', params: { value } })
    return this
  }

  /**
   * Expect the column value to be greater than or equal to the specified value
   */
  toBeGreaterThanOrEqual(value: number): this {
    this.addConstraint({ type: 'greater_than_or_equal', params: { value } })
    return this
  }

  /**
   * Expect the column value to be less than the specified value
   */
  toBeLessThan(value: number): this {
    this.addConstraint({ type: 'less_than', params: { value } })
    return this
  }

  /**
   * Expect the column value to be less than or equal to the specified value
   */
  toBeLessThanOrEqual(value: number): this {
    this.addConstraint({ type: 'less_than_or_equal', params: { value } })
    return this
  }

  /**
   * Expect the column value to be between min and max (inclusive by default)
   */
  toBeBetween(min: number, max: number, options?: BetweenOptions): this {
    this.addConstraint({
      type: 'between',
      params: { min, max, exclusive: options?.exclusive ?? false },
    })
    return this
  }

  // ============================================================================
  // TYPE CHECKS
  // ============================================================================

  /**
   * Expect the column value to be a string
   */
  toBeString(): this {
    this.addConstraint({ type: 'type_string' })
    return this
  }

  /**
   * Expect the column value to be a number
   */
  toBeNumber(): this {
    this.addConstraint({ type: 'type_number' })
    return this
  }

  /**
   * Expect the column value to be an integer
   */
  toBeInteger(): this {
    this.addConstraint({ type: 'type_integer' })
    return this
  }

  /**
   * Expect the column value to be a valid date
   */
  toBeDate(): this {
    this.addConstraint({ type: 'type_date' })
    return this
  }

  /**
   * Expect the column value to be a boolean
   */
  toBeBoolean(): this {
    this.addConstraint({ type: 'type_boolean' })
    return this
  }

  // ============================================================================
  // STRING LENGTH
  // ============================================================================

  /**
   * Expect the string value to have at least the specified length
   */
  toHaveMinLength(length: number): this {
    this.addConstraint({ type: 'min_length', params: { length } })
    return this
  }

  /**
   * Expect the string value to have at most the specified length
   */
  toHaveMaxLength(length: number): this {
    this.addConstraint({ type: 'max_length', params: { length } })
    return this
  }

  // ============================================================================
  // AGGREGATES
  // ============================================================================

  /**
   * Expect the number of rows to match
   */
  toHaveCount(expected: CountExpectation): this {
    this.addConstraint({ type: 'aggregate_count', params: { expected } })
    return this
  }

  /**
   * Expect the sum of column values to match
   */
  toHaveSum(expected: AggregateExpectation): this {
    this.addConstraint({ type: 'aggregate_sum', params: { expected } })
    return this
  }

  /**
   * Expect the average of column values to match
   */
  toHaveAvg(expected: number, options?: AvgOptions): this {
    this.addConstraint({
      type: 'aggregate_avg',
      params: { expected, tolerance: options?.tolerance ?? 0 },
    })
    return this
  }

  /**
   * Expect the minimum value to match
   */
  toHaveMin(expected: number): this {
    this.addConstraint({ type: 'aggregate_min', params: { expected } })
    return this
  }

  /**
   * Expect the maximum value to match
   */
  toHaveMax(expected: number): this {
    this.addConstraint({ type: 'aggregate_max', params: { expected } })
    return this
  }

  // ============================================================================
  // LOGICAL CHAINING
  // ============================================================================

  /**
   * Chain expectations with AND logic
   */
  and(): this {
    this.pendingOperator = 'and'
    return this
  }

  /**
   * Chain expectations with OR logic
   */
  or(): this {
    this.pendingOperator = 'or'
    this.operator = 'or'
    return this
  }

  // ============================================================================
  // CUSTOM MESSAGE
  // ============================================================================

  /**
   * Set a custom error message for this expectation
   */
  withMessage(message: string): this {
    this.customMessage = message
    return this
  }

  // ============================================================================
  // BUILD
  // ============================================================================

  /**
   * Build the final Expectation object
   */
  build(): Expectation {
    const firstConstraint = this.constraints[0]
    return {
      column: this.column,
      type: firstConstraint?.type ?? 'not_null',
      constraints: this.constraints,
      params: firstConstraint?.params,
      message: this.customMessage,
      logicalOperator: this.operator !== 'and' ? this.operator : undefined,
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private addConstraint(constraint: Constraint): void {
    this.constraints.push(constraint)
    this.pendingOperator = undefined
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

/**
 * Create an expectation builder for a column
 *
 * @example
 * ```typescript
 * const expectation = expect('email').toBeNotNull().and().toMatch(/^.+@.+$/).build()
 * ```
 */
export function expect(column: string): ExpectationBuilder {
  return new ExpectationBuilder(column)
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
 * Check if a value is a valid date
 */
function isValidDate(value: unknown): boolean {
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
 * Validate a single constraint against a value
 */
function validateConstraint(
  constraint: Constraint,
  value: unknown,
  column: string,
  rowIndex: number,
  allData: Record<string, unknown>[],
  isOr: boolean
): ExpectationFailure | null {
  const { type, params } = constraint

  // Skip null/undefined for non-null checks, except for aggregate and unique constraints
  const isAggregate = isAggregateConstraint(type)
  const isUnique = isUniquenessConstraint(type)
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
      // Check uniqueness across all data (excluding nulls)
      const values = allData.map((row) => getNestedValue(row, column)).filter((v) => v !== null && v !== undefined)
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
      if (!isValidDate(value)) {
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
      const expected = params?.expected as CountExpectation
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
      const expected = params?.expected as AggregateExpectation
      const values = allData.map((row) => getNestedValue(row, column)).filter((v) => typeof v === 'number') as number[]
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
      const values = allData.map((row) => getNestedValue(row, column)).filter((v) => typeof v === 'number') as number[]
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
      const values = allData.map((row) => getNestedValue(row, column)).filter((v) => typeof v === 'number') as number[]
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
      const values = allData.map((row) => getNestedValue(row, column)).filter((v) => typeof v === 'number') as number[]
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
 * Check if a constraint is an aggregate constraint
 */
function isAggregateConstraint(type: ExpectationType): boolean {
  return type.startsWith('aggregate_')
}

/**
 * Check if a constraint is a uniqueness constraint
 */
function isUniquenessConstraint(type: ExpectationType): boolean {
  return type === 'unique'
}

/**
 * Validate expectations against data
 */
export function validateExpectations(
  expectations: Expectation[],
  data: Record<string, unknown>[]
): ExpectationResult {
  const startTime = performance.now()
  const failures: ExpectationFailure[] = []

  for (const expectation of expectations) {
    const { column, constraints, message, logicalOperator } = expectation
    const isOr = logicalOperator === 'or'

    // Separate aggregate and row-level constraints
    const aggregateConstraints = constraints.filter((c) => isAggregateConstraint(c.type) || isUniquenessConstraint(c.type))
    const rowConstraints = constraints.filter((c) => !isAggregateConstraint(c.type) && !isUniquenessConstraint(c.type))

    // Validate aggregate constraints (once per dataset)
    for (const constraint of aggregateConstraints) {
      const failure = validateConstraint(constraint, null, column, -1, data, isOr)
      if (failure) {
        failures.push({
          ...failure,
          message: message ?? failure.message,
        })
      }
    }

    // Validate row-level constraints (per row)
    for (let i = 0; i < data.length; i++) {
      const row = data[i]!
      const value = getNestedValue(row, column)

      if (isOr) {
        // OR logic: at least one constraint must pass
        let anyPassed = false
        const rowFailures: ExpectationFailure[] = []

        for (const constraint of rowConstraints) {
          const failure = validateConstraint(constraint, value, column, i, data, isOr)
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
          // Add the first failure as representative
          failures.push(rowFailures[0]!)
        }
      } else {
        // AND logic: all constraints must pass
        for (const constraint of rowConstraints) {
          const failure = validateConstraint(constraint, value, column, i, data, isOr)
          if (failure) {
            failures.push({
              ...failure,
              message: message ?? failure.message,
            })
          }
        }
      }
    }
  }

  const endTime = performance.now()

  return {
    passed: failures.length === 0,
    failures,
    expectationsChecked: expectations.length,
    timing: {
      totalMs: endTime - startTime,
    },
  }
}

// Re-export for convenience
export { expect as exp }

// ============================================================================
// TABLE EXPECTATION BUILDER
// ============================================================================

/**
 * Table-level expectation definition for JSON serialization
 */
export interface TableExpectationDefinition {
  table: string
  columns: Expectation[]
}

/**
 * Column builder that returns to parent table builder for chaining
 */
export class ChainedColumnBuilder {
  private parent: TableExpectationBuilder
  private columnBuilder: ExpectationBuilder

  constructor(parent: TableExpectationBuilder, columnName: string) {
    this.parent = parent
    this.columnBuilder = new ExpectationBuilder(columnName)
  }

  // Null/existence checks
  toBeNotNull(): this {
    this.columnBuilder.toBeNotNull()
    return this
  }

  toBeUnique(): this {
    this.columnBuilder.toBeUnique()
    return this
  }

  // Pattern matching
  toMatch(pattern: RegExp | string): this {
    this.columnBuilder.toMatch(pattern)
    return this
  }

  toMatchRegex(pattern: RegExp | string): this {
    this.columnBuilder.toMatchRegex(pattern)
    return this
  }

  toBeIn(values: readonly (string | number | boolean)[]): this {
    this.columnBuilder.toBeIn(values)
    return this
  }

  // Comparisons
  toBeGreaterThan(value: number): this {
    this.columnBuilder.toBeGreaterThan(value)
    return this
  }

  toBeGreaterThanOrEqual(value: number): this {
    this.columnBuilder.toBeGreaterThanOrEqual(value)
    return this
  }

  toBeLessThan(value: number): this {
    this.columnBuilder.toBeLessThan(value)
    return this
  }

  toBeLessThanOrEqual(value: number): this {
    this.columnBuilder.toBeLessThanOrEqual(value)
    return this
  }

  toBeBetween(min: number, max: number, options?: BetweenOptions): this {
    this.columnBuilder.toBeBetween(min, max, options)
    return this
  }

  // Type checks
  toBeString(): this {
    this.columnBuilder.toBeString()
    return this
  }

  toBeNumber(): this {
    this.columnBuilder.toBeNumber()
    return this
  }

  toBeInteger(): this {
    this.columnBuilder.toBeInteger()
    return this
  }

  toBeDate(): this {
    this.columnBuilder.toBeDate()
    return this
  }

  toBeBoolean(): this {
    this.columnBuilder.toBeBoolean()
    return this
  }

  // String length
  toHaveMinLength(length: number): this {
    this.columnBuilder.toHaveMinLength(length)
    return this
  }

  toHaveMaxLength(length: number): this {
    this.columnBuilder.toHaveMaxLength(length)
    return this
  }

  // Aggregates
  toHaveCount(expected: CountExpectation): this {
    this.columnBuilder.toHaveCount(expected)
    return this
  }

  toHaveSum(expected: AggregateExpectation): this {
    this.columnBuilder.toHaveSum(expected)
    return this
  }

  toHaveAvg(expected: number, options?: AvgOptions): this {
    this.columnBuilder.toHaveAvg(expected, options)
    return this
  }

  toHaveMin(expected: number): this {
    this.columnBuilder.toHaveMin(expected)
    return this
  }

  toHaveMax(expected: number): this {
    this.columnBuilder.toHaveMax(expected)
    return this
  }

  // Logical chaining
  and(): this {
    this.columnBuilder.and()
    return this
  }

  or(): this {
    this.columnBuilder.or()
    return this
  }

  // Custom message
  withMessage(message: string): this {
    this.columnBuilder.withMessage(message)
    return this
  }

  /**
   * Chain to another column in the same table
   */
  column(name: string): ChainedColumnBuilder {
    // Finalize current column and return new column builder
    this.parent.addColumnExpectation(this.columnBuilder.build())
    return new ChainedColumnBuilder(this.parent, name)
  }

  /**
   * Build all expectations for the table
   */
  build(): TableExpectationDefinition {
    // Finalize current column
    this.parent.addColumnExpectation(this.columnBuilder.build())
    return this.parent.build()
  }

  /**
   * Get the underlying ExpectationBuilder for advanced use
   */
  getExpectationBuilder(): ExpectationBuilder {
    return this.columnBuilder
  }
}

/**
 * Fluent builder for table-level expectations
 *
 * Provides a table-centric API for defining expectations on multiple columns:
 *
 * @example
 * ```typescript
 * const tableExpectations = expectTable('users')
 *   .column('email').toBeString().toMatchRegex(/^.+@.+$/)
 *   .column('age').toBeNumber().toBeBetween(0, 150)
 *   .column('status').toBeIn(['active', 'inactive', 'pending'])
 *   .build()
 *
 * const result = validateTableExpectations(tableExpectations, data)
 * ```
 */
export class TableExpectationBuilder {
  private tableName: string
  private columnExpectations: Expectation[] = []

  constructor(tableName: string) {
    this.tableName = tableName
  }

  /**
   * Start defining expectations for a column
   */
  column(name: string): ChainedColumnBuilder {
    return new ChainedColumnBuilder(this, name)
  }

  /**
   * Add a column expectation (called internally by ChainedColumnBuilder)
   * @internal
   */
  addColumnExpectation(expectation: Expectation): void {
    this.columnExpectations.push(expectation)
  }

  /**
   * Build the table expectation definition
   */
  build(): TableExpectationDefinition {
    return {
      table: this.tableName,
      columns: this.columnExpectations,
    }
  }

  /**
   * Get the table name
   */
  getTableName(): string {
    return this.tableName
  }

  /**
   * Get all column expectations built so far
   */
  getColumnExpectations(): Expectation[] {
    return [...this.columnExpectations]
  }
}

/**
 * Create a table expectation builder
 *
 * @example
 * ```typescript
 * const expectations = expectTable('users')
 *   .column('email').toBeString().toMatchRegex(/^.+@.+$/)
 *   .column('age').toBeNumber().toBeBetween(0, 150)
 *   .column('status').toBeIn(['active', 'inactive', 'pending'])
 *   .build()
 * ```
 */
export function expectTable(tableName: string): TableExpectationBuilder {
  return new TableExpectationBuilder(tableName)
}

/**
 * Validate data against table expectations
 */
export function validateTableExpectations(
  tableExpectation: TableExpectationDefinition,
  data: Record<string, unknown>[]
): ExpectationResult {
  return validateExpectations(tableExpectation.columns, data)
}

/**
 * Convert table expectations to JSON for storage/transport
 */
export function serializeTableExpectations(tableExpectation: TableExpectationDefinition): string {
  // Convert regex patterns to string representation for serialization
  const serializable = {
    table: tableExpectation.table,
    columns: tableExpectation.columns.map((col) => ({
      ...col,
      constraints: col.constraints.map((c) => ({
        ...c,
        params: c.params
          ? {
              ...c.params,
              pattern: c.params.pattern instanceof RegExp ? { $regex: c.params.pattern.source, flags: c.params.pattern.flags } : c.params.pattern,
            }
          : undefined,
      })),
      params: col.params
        ? {
            ...col.params,
            pattern: col.params.pattern instanceof RegExp ? { $regex: col.params.pattern.source, flags: col.params.pattern.flags } : col.params.pattern,
          }
        : undefined,
    })),
  }
  return JSON.stringify(serializable)
}

/**
 * Deserialize table expectations from JSON
 */
export function deserializeTableExpectations(json: string): TableExpectationDefinition {
  const parsed = JSON.parse(json)

  // Reconstruct regex patterns from serialized form
  const deserialized: TableExpectationDefinition = {
    table: parsed.table,
    columns: parsed.columns.map((col: Expectation & { constraints: Array<Constraint & { params?: Record<string, unknown> }> }) => ({
      ...col,
      constraints: col.constraints.map((c) => ({
        ...c,
        params: c.params
          ? {
              ...c.params,
              pattern:
                c.params.pattern && typeof c.params.pattern === 'object' && '$regex' in (c.params.pattern as Record<string, unknown>)
                  ? new RegExp(
                      (c.params.pattern as { $regex: string; flags?: string }).$regex,
                      (c.params.pattern as { $regex: string; flags?: string }).flags
                    )
                  : c.params.pattern,
            }
          : undefined,
      })),
      params: col.params
        ? {
            ...col.params,
            pattern:
              col.params.pattern && typeof col.params.pattern === 'object' && '$regex' in (col.params.pattern as Record<string, unknown>)
                ? new RegExp(
                    (col.params.pattern as { $regex: string; flags?: string }).$regex,
                    (col.params.pattern as { $regex: string; flags?: string }).flags
                  )
                : col.params.pattern,
          }
        : undefined,
    })),
  }

  return deserialized
}
