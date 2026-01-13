/**
 * Value Expectations - Comprehensive value validation for data contracts
 *
 * Provides a rich set of value-level expectations:
 *
 * Range Validation:
 * - toBeBetween(min, max) - check value is within range
 * - toBeGreaterThan(n) - check value is greater than n
 * - toBeLessThan(n) - check value is less than n
 *
 * Regex Pattern Matching:
 * - toMatchRegex(pattern) - check value matches regex pattern
 * - toStartWith(prefix) - check string starts with prefix
 * - toEndWith(suffix) - check string ends with suffix
 *
 * Enum/Allowed Values:
 * - toBeIn(values) - check value is in allowed set
 * - toBeOneOf(values) - alias for toBeIn
 *
 * Length Validation:
 * - toHaveLength(min, max?) - check string/array length
 *
 * Custom Validation:
 * - toPassCustom(fn, message?) - run custom validation function
 *
 * Date Validation:
 * - toBeAfter(date) - check date is after given date
 * - toBeBefore(date) - check date is before given date
 * - toBeDateBetween(start, end) - check date is within range
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Extended expectation types for value validation
 */
export type ValueExpectationType =
  // Range validation
  | 'between'
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal'
  // Pattern matching
  | 'regex_pattern'
  | 'starts_with'
  | 'ends_with'
  // Enum membership
  | 'in_set'
  | 'not_in_set'
  // Length validation
  | 'length_range'
  | 'exact_length'
  // Custom validation
  | 'custom'
  // Date validation
  | 'date_after'
  | 'date_before'
  | 'date_between'
  // Composite validators
  | 'all_of'
  | 'any_of'
  | 'none_of'

/**
 * Custom validation function signature
 */
export type CustomValidationFn<T = unknown> = (value: T) => boolean | ValidationFnResult

/**
 * Result from a custom validation function
 */
export interface ValidationFnResult {
  valid: boolean
  message?: string
}

/**
 * Single value constraint
 */
export interface ValueConstraint {
  type: ValueExpectationType
  params?: Record<string, unknown>
}

/**
 * Validation failure details
 */
export interface ValueValidationFailure {
  field: string
  type: ValueExpectationType
  message: string
  actualValue?: unknown
  expectedValue?: unknown
}

/**
 * Validation result
 */
export interface ValueValidationResult {
  valid: boolean
  failures: ValueValidationFailure[]
}

/**
 * Options for between validation
 */
export interface BetweenOptions {
  /** Whether bounds are exclusive (default: false = inclusive) */
  exclusive?: boolean
  /** Whether to include min in valid range (default: true) */
  includeMin?: boolean
  /** Whether to include max in valid range (default: true) */
  includeMax?: boolean
  /** Whether min bound is exclusive (takes precedence over exclusive flag) */
  minExclusive?: boolean
  /** Whether max bound is exclusive (takes precedence over exclusive flag) */
  maxExclusive?: boolean
}

/**
 * Options for length validation
 */
export interface LengthOptions {
  /** Minimum length */
  min?: number
  /** Maximum length */
  max?: number
  /** Exact length (if set, min/max are ignored) */
  exact?: number
}

/**
 * Null handling modes for value validation
 */
export enum NullHandling {
  /** Skip validation for null/undefined values (default) */
  SKIP = 'skip',
  /** Fail validation if value is null/undefined */
  FAIL = 'fail',
  /** Pass validation if value is null/undefined */
  PASS = 'pass',
}

// ============================================================================
// BUILT-IN PATTERNS
// ============================================================================

/**
 * Common regex patterns for value validation
 */
export const patterns = {
  /** Email address pattern */
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,

  /** Phone number pattern (flexible - allows +, (), -, spaces, and digits) */
  phone: /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]*$/,

  /** URL pattern (http or https) */
  url: /^https?:\/\/[^\s/$.?#].[^\s]*$/i,

  /** UUID pattern (versions 1-5) */
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,

  /** IPv4 address pattern */
  ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,

  /** Credit card number pattern (13-19 digits) */
  creditCard: /^\d{13,19}$/,

  /** US postal code pattern (5 digits or 5+4 format) */
  postalCodeUS: /^\d{5}(-\d{4})?$/,

  /** URL slug pattern (lowercase letters, numbers, and hyphens) */
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,

  /** Alphanumeric pattern (letters and numbers only) */
  alphanumeric: /^[a-zA-Z0-9]+$/,

  /** ISO 8601 date pattern (YYYY-MM-DD) */
  isoDate: /^\d{4}-\d{2}-\d{2}$/,

  /** ISO 8601 datetime pattern */
  isoDateTime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})?$/,

  /** Hexadecimal color pattern (#RGB or #RRGGBB) */
  hexColor: /^#([0-9A-Fa-f]{3}){1,2}$/,

  /** Semantic version pattern (major.minor.patch) */
  semver: /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
} as const

// ============================================================================
// VALUE EXPECTATION BUILDER
// ============================================================================

/**
 * Fluent builder for value expectations
 */
export class ValueExpectationBuilder<T = unknown> {
  private field: string
  private constraints: ValueConstraint[] = []
  private compiledRegexCache: Map<string, RegExp> = new Map()
  private nullHandling: NullHandling = NullHandling.SKIP

  constructor(field: string) {
    this.field = field
  }

  /**
   * Set how null/undefined values should be handled during validation
   */
  withNullHandling(mode: NullHandling): this {
    this.nullHandling = mode
    return this
  }

  // ==========================================================================
  // RANGE VALIDATION
  // ==========================================================================

  /**
   * Expect the value to be between min and max
   * Works with numbers and dates
   */
  toBeBetween(min: number | Date, max: number | Date, options?: BetweenOptions): this {
    this.constraints.push({
      type: 'between',
      params: {
        min: min instanceof Date ? min.getTime() : min,
        max: max instanceof Date ? max.getTime() : max,
        exclusive: options?.exclusive ?? false,
        includeMin: options?.includeMin ?? true,
        includeMax: options?.includeMax ?? true,
        minExclusive: options?.minExclusive,
        maxExclusive: options?.maxExclusive,
        isDate: min instanceof Date,
      },
    })
    return this
  }

  /**
   * Expect the value to be greater than n
   */
  toBeGreaterThan(n: number | Date): this {
    this.constraints.push({
      type: 'greater_than',
      params: {
        value: n instanceof Date ? n.getTime() : n,
        isDate: n instanceof Date,
      },
    })
    return this
  }

  /**
   * Expect the value to be greater than or equal to n
   */
  toBeGreaterThanOrEqual(n: number | Date): this {
    this.constraints.push({
      type: 'greater_than_or_equal',
      params: {
        value: n instanceof Date ? n.getTime() : n,
        isDate: n instanceof Date,
      },
    })
    return this
  }

  /**
   * Expect the value to be less than n
   */
  toBeLessThan(n: number | Date): this {
    this.constraints.push({
      type: 'less_than',
      params: {
        value: n instanceof Date ? n.getTime() : n,
        isDate: n instanceof Date,
      },
    })
    return this
  }

  /**
   * Expect the value to be less than or equal to n
   */
  toBeLessThanOrEqual(n: number | Date): this {
    this.constraints.push({
      type: 'less_than_or_equal',
      params: {
        value: n instanceof Date ? n.getTime() : n,
        isDate: n instanceof Date,
      },
    })
    return this
  }

  // ==========================================================================
  // REGEX PATTERN MATCHING
  // ==========================================================================

  /**
   * Expect the value to match a regex pattern
   * Compiles the regex once for efficiency
   */
  toMatchRegex(pattern: RegExp | string): this {
    // Compile regex if string, caching for reuse
    let regex: RegExp
    if (typeof pattern === 'string') {
      if (!this.compiledRegexCache.has(pattern)) {
        this.compiledRegexCache.set(pattern, new RegExp(pattern))
      }
      regex = this.compiledRegexCache.get(pattern)!
    } else {
      regex = pattern
    }

    this.constraints.push({
      type: 'regex_pattern',
      params: { pattern: regex },
    })
    return this
  }

  /**
   * Expect the string value to start with the given prefix
   */
  toStartWith(prefix: string): this {
    this.constraints.push({
      type: 'starts_with',
      params: { prefix },
    })
    return this
  }

  /**
   * Expect the string value to end with the given suffix
   */
  toEndWith(suffix: string): this {
    this.constraints.push({
      type: 'ends_with',
      params: { suffix },
    })
    return this
  }

  // ==========================================================================
  // ENUM/ALLOWED VALUES
  // ==========================================================================

  /**
   * Expect the value to be in the allowed set
   * Supports arrays and Sets
   */
  toBeIn<V extends string | number | boolean>(values: readonly V[] | Set<V>): this {
    const valueArray = values instanceof Set ? Array.from(values) : [...values]
    this.constraints.push({
      type: 'in_set',
      params: { values: valueArray, valueSet: new Set(valueArray) },
    })
    return this
  }

  /**
   * Alias for toBeIn()
   */
  toBeOneOf<V extends string | number | boolean>(values: readonly V[] | Set<V>): this {
    return this.toBeIn(values)
  }

  /**
   * Expect the value to NOT be in the disallowed set
   * Supports arrays and Sets
   */
  toNotBeIn<V extends string | number | boolean>(values: readonly V[] | Set<V>): this {
    const valueArray = values instanceof Set ? Array.from(values) : [...values]
    this.constraints.push({
      type: 'not_in_set',
      params: { values: valueArray, valueSet: new Set(valueArray) },
    })
    return this
  }

  // ==========================================================================
  // COMPOSITE VALIDATORS
  // ==========================================================================

  /**
   * Expect ALL validators to pass (AND logic)
   * @param validators Array of validation functions
   * @param message Custom error message for when validation fails
   */
  allOf(validators: CustomValidationFn<T>[], message?: string): this {
    this.constraints.push({
      type: 'all_of',
      params: { validators, message },
    })
    return this
  }

  /**
   * Expect AT LEAST ONE validator to pass (OR logic)
   * @param validators Array of validation functions
   * @param message Custom error message for when validation fails
   */
  anyOf(validators: CustomValidationFn<T>[], message?: string): this {
    this.constraints.push({
      type: 'any_of',
      params: { validators, message },
    })
    return this
  }

  /**
   * Expect NONE of the validators to pass (NOT logic)
   * @param validators Array of validation functions
   * @param message Custom error message for when validation fails
   */
  noneOf(validators: CustomValidationFn<T>[], message?: string): this {
    this.constraints.push({
      type: 'none_of',
      params: { validators, message },
    })
    return this
  }

  // ==========================================================================
  // LENGTH VALIDATION
  // ==========================================================================

  /**
   * Expect the string or array to have a length within the specified range
   */
  toHaveLength(min: number, max?: number): this {
    this.constraints.push({
      type: 'length_range',
      params: { min, max: max ?? min },
    })
    return this
  }

  /**
   * Expect the string or array to have exactly the specified length
   */
  toHaveExactLength(length: number): this {
    this.constraints.push({
      type: 'exact_length',
      params: { length },
    })
    return this
  }

  // ==========================================================================
  // CUSTOM VALIDATION
  // ==========================================================================

  /**
   * Apply a custom validation function
   */
  toPassCustom(fn: CustomValidationFn<T>, message?: string): this {
    this.constraints.push({
      type: 'custom',
      params: { fn, message },
    })
    return this
  }

  // ==========================================================================
  // DATE VALIDATION
  // ==========================================================================

  /**
   * Expect the date value to be after the given date
   */
  toBeAfter(date: Date): this {
    this.constraints.push({
      type: 'date_after',
      params: { date: date.getTime() },
    })
    return this
  }

  /**
   * Expect the date value to be before the given date
   */
  toBeBefore(date: Date): this {
    this.constraints.push({
      type: 'date_before',
      params: { date: date.getTime() },
    })
    return this
  }

  /**
   * Expect the date value to be between start and end dates
   */
  toBeDateBetween(start: Date, end: Date): this {
    this.constraints.push({
      type: 'date_between',
      params: { start: start.getTime(), end: end.getTime() },
    })
    return this
  }

  // ==========================================================================
  // BUILD
  // ==========================================================================

  /**
   * Build the value expectation
   */
  build(): ValueExpectation {
    return new ValueExpectation(this.field, this.constraints, this.nullHandling)
  }
}

// ============================================================================
// VALUE EXPECTATION
// ============================================================================

/**
 * Compiled value expectation ready for validation
 */
export class ValueExpectation {
  readonly field: string
  readonly constraints: ValueConstraint[]
  readonly nullHandling: NullHandling

  constructor(field: string, constraints: ValueConstraint[], nullHandling: NullHandling = NullHandling.SKIP) {
    this.field = field
    this.constraints = constraints
    this.nullHandling = nullHandling
  }

  /**
   * Validate a single value against this expectation
   */
  validate(value: unknown): ValueValidationResult {
    const failures: ValueValidationFailure[] = []

    // Handle null/undefined based on nullHandling mode
    if (value === null || value === undefined) {
      switch (this.nullHandling) {
        case NullHandling.SKIP:
        case NullHandling.PASS:
          return { valid: true, failures: [] }
        case NullHandling.FAIL:
          failures.push({
            field: this.field,
            type: 'between' as ValueExpectationType, // Generic type for null failure
            message: `Field '${this.field}' has null/undefined value but null handling is set to FAIL`,
            actualValue: value,
          })
          return { valid: false, failures }
      }
    }

    for (const constraint of this.constraints) {
      const failure = this.validateConstraint(constraint, value)
      if (failure) {
        failures.push(failure)
      }
    }

    return {
      valid: failures.length === 0,
      failures,
    }
  }

  /**
   * Validate multiple values against this expectation
   */
  validateMany(values: unknown[]): ValueValidationResult {
    const failures: ValueValidationFailure[] = []

    for (const value of values) {
      const result = this.validate(value)
      failures.push(...result.failures)
    }

    return {
      valid: failures.length === 0,
      failures,
    }
  }

  private validateConstraint(constraint: ValueConstraint, value: unknown): ValueValidationFailure | null {
    const { type, params } = constraint

    switch (type) {
      case 'between':
        return this.validateBetween(value, params!)

      case 'greater_than':
        return this.validateGreaterThan(value, params!)

      case 'greater_than_or_equal':
        return this.validateGreaterThanOrEqual(value, params!)

      case 'less_than':
        return this.validateLessThan(value, params!)

      case 'less_than_or_equal':
        return this.validateLessThanOrEqual(value, params!)

      case 'regex_pattern':
        return this.validateRegex(value, params!)

      case 'starts_with':
        return this.validateStartsWith(value, params!)

      case 'ends_with':
        return this.validateEndsWith(value, params!)

      case 'in_set':
        return this.validateInSet(value, params!)

      case 'not_in_set':
        return this.validateNotInSet(value, params!)

      case 'all_of':
        return this.validateAllOf(value, params!)

      case 'any_of':
        return this.validateAnyOf(value, params!)

      case 'none_of':
        return this.validateNoneOf(value, params!)

      case 'length_range':
        return this.validateLengthRange(value, params!)

      case 'exact_length':
        return this.validateExactLength(value, params!)

      case 'custom':
        return this.validateCustom(value, params!)

      case 'date_after':
        return this.validateDateAfter(value, params!)

      case 'date_before':
        return this.validateDateBefore(value, params!)

      case 'date_between':
        return this.validateDateBetween(value, params!)

      default:
        return null
    }
  }

  // ==========================================================================
  // RANGE VALIDATION HELPERS
  // ==========================================================================

  private validateBetween(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const min = params.min as number
    const max = params.max as number
    const exclusive = params.exclusive as boolean
    const includeMin = params.includeMin as boolean
    const includeMax = params.includeMax as boolean
    const minExclusive = params.minExclusive as boolean | undefined
    const maxExclusive = params.maxExclusive as boolean | undefined
    const isDate = params.isDate as boolean

    let numValue: number
    if (isDate) {
      if (value instanceof Date) {
        numValue = value.getTime()
      } else if (typeof value === 'string') {
        const parsed = new Date(value)
        if (isNaN(parsed.getTime())) {
          return {
            field: this.field,
            type: 'between',
            message: `Field '${this.field}' has invalid date value`,
            actualValue: value,
          }
        }
        numValue = parsed.getTime()
      } else {
        return {
          field: this.field,
          type: 'between',
          message: `Field '${this.field}' expected date, got ${typeof value}`,
          actualValue: value,
        }
      }
    } else {
      if (typeof value !== 'number') {
        return {
          field: this.field,
          type: 'between',
          message: `Field '${this.field}' expected number, got ${typeof value}`,
          actualValue: value,
        }
      }
      numValue = value
    }

    // Determine effective exclusivity for each bound
    // minExclusive/maxExclusive take precedence over exclusive flag
    let isMinExclusive: boolean
    let isMaxExclusive: boolean

    if (minExclusive !== undefined) {
      isMinExclusive = minExclusive
    } else if (exclusive) {
      isMinExclusive = true
    } else {
      isMinExclusive = !includeMin
    }

    if (maxExclusive !== undefined) {
      isMaxExclusive = maxExclusive
    } else if (exclusive) {
      isMaxExclusive = true
    } else {
      isMaxExclusive = !includeMax
    }

    const failsMin = isMinExclusive ? numValue <= min : numValue < min
    const failsMax = isMaxExclusive ? numValue >= max : numValue > max

    if (failsMin || failsMax) {
      const minDisplay = isDate ? new Date(min).toISOString() : min
      const maxDisplay = isDate ? new Date(max).toISOString() : max
      return {
        field: this.field,
        type: 'between',
        message: `Field '${this.field}' value ${value} is not between ${minDisplay} and ${maxDisplay}`,
        actualValue: value,
        expectedValue: { min: minDisplay, max: maxDisplay },
      }
    }

    return null
  }

  private validateGreaterThan(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const threshold = params.value as number
    const isDate = params.isDate as boolean

    const numValue = this.getNumericValue(value, isDate)
    if (numValue === null) {
      return {
        field: this.field,
        type: 'greater_than',
        message: `Field '${this.field}' expected ${isDate ? 'date' : 'number'}`,
        actualValue: value,
      }
    }

    if (numValue <= threshold) {
      const display = isDate ? new Date(threshold).toISOString() : threshold
      return {
        field: this.field,
        type: 'greater_than',
        message: `Field '${this.field}' value must be greater than ${display}`,
        actualValue: value,
        expectedValue: display,
      }
    }

    return null
  }

  private validateGreaterThanOrEqual(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const threshold = params.value as number
    const isDate = params.isDate as boolean

    const numValue = this.getNumericValue(value, isDate)
    if (numValue === null) {
      return {
        field: this.field,
        type: 'greater_than_or_equal',
        message: `Field '${this.field}' expected ${isDate ? 'date' : 'number'}`,
        actualValue: value,
      }
    }

    if (numValue < threshold) {
      const display = isDate ? new Date(threshold).toISOString() : threshold
      return {
        field: this.field,
        type: 'greater_than_or_equal',
        message: `Field '${this.field}' value must be greater than or equal to ${display}`,
        actualValue: value,
        expectedValue: display,
      }
    }

    return null
  }

  private validateLessThan(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const threshold = params.value as number
    const isDate = params.isDate as boolean

    const numValue = this.getNumericValue(value, isDate)
    if (numValue === null) {
      return {
        field: this.field,
        type: 'less_than',
        message: `Field '${this.field}' expected ${isDate ? 'date' : 'number'}`,
        actualValue: value,
      }
    }

    if (numValue >= threshold) {
      const display = isDate ? new Date(threshold).toISOString() : threshold
      return {
        field: this.field,
        type: 'less_than',
        message: `Field '${this.field}' value must be less than ${display}`,
        actualValue: value,
        expectedValue: display,
      }
    }

    return null
  }

  private validateLessThanOrEqual(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const threshold = params.value as number
    const isDate = params.isDate as boolean

    const numValue = this.getNumericValue(value, isDate)
    if (numValue === null) {
      return {
        field: this.field,
        type: 'less_than_or_equal',
        message: `Field '${this.field}' expected ${isDate ? 'date' : 'number'}`,
        actualValue: value,
      }
    }

    if (numValue > threshold) {
      const display = isDate ? new Date(threshold).toISOString() : threshold
      return {
        field: this.field,
        type: 'less_than_or_equal',
        message: `Field '${this.field}' value must be less than or equal to ${display}`,
        actualValue: value,
        expectedValue: display,
      }
    }

    return null
  }

  private getNumericValue(value: unknown, isDate: boolean): number | null {
    if (isDate) {
      if (value instanceof Date) {
        return value.getTime()
      }
      if (typeof value === 'string') {
        const parsed = new Date(value)
        return isNaN(parsed.getTime()) ? null : parsed.getTime()
      }
      return null
    }

    return typeof value === 'number' ? value : null
  }

  // ==========================================================================
  // REGEX VALIDATION HELPERS
  // ==========================================================================

  private validateRegex(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const pattern = params.pattern as RegExp

    if (typeof value !== 'string') {
      return {
        field: this.field,
        type: 'regex_pattern',
        message: `Field '${this.field}' expected string for regex match`,
        actualValue: value,
      }
    }

    if (!pattern.test(value)) {
      return {
        field: this.field,
        type: 'regex_pattern',
        message: `Field '${this.field}' value '${value}' does not match pattern ${pattern}`,
        actualValue: value,
        expectedValue: pattern.source,
      }
    }

    return null
  }

  private validateStartsWith(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const prefix = params.prefix as string

    if (typeof value !== 'string') {
      return {
        field: this.field,
        type: 'starts_with',
        message: `Field '${this.field}' expected string`,
        actualValue: value,
      }
    }

    if (!value.startsWith(prefix)) {
      return {
        field: this.field,
        type: 'starts_with',
        message: `Field '${this.field}' value '${value}' does not start with '${prefix}'`,
        actualValue: value,
        expectedValue: prefix,
      }
    }

    return null
  }

  private validateEndsWith(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const suffix = params.suffix as string

    if (typeof value !== 'string') {
      return {
        field: this.field,
        type: 'ends_with',
        message: `Field '${this.field}' expected string`,
        actualValue: value,
      }
    }

    if (!value.endsWith(suffix)) {
      return {
        field: this.field,
        type: 'ends_with',
        message: `Field '${this.field}' value '${value}' does not end with '${suffix}'`,
        actualValue: value,
        expectedValue: suffix,
      }
    }

    return null
  }

  // ==========================================================================
  // ENUM VALIDATION HELPERS
  // ==========================================================================

  private validateInSet(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const valueSet = params.valueSet as Set<string | number | boolean>
    const values = params.values as (string | number | boolean)[]

    if (!valueSet.has(value as string | number | boolean)) {
      return {
        field: this.field,
        type: 'in_set',
        message: `Field '${this.field}' value '${value}' is not in allowed values [${values.join(', ')}]`,
        actualValue: value,
        expectedValue: values,
      }
    }

    return null
  }

  private validateNotInSet(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const valueSet = params.valueSet as Set<string | number | boolean>
    const values = params.values as (string | number | boolean)[]

    if (valueSet.has(value as string | number | boolean)) {
      return {
        field: this.field,
        type: 'not_in_set',
        message: `Field '${this.field}' value '${value}' is in disallowed values [${values.join(', ')}]`,
        actualValue: value,
        expectedValue: values,
      }
    }

    return null
  }

  // ==========================================================================
  // COMPOSITE VALIDATION HELPERS
  // ==========================================================================

  private validateAllOf(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const validators = params.validators as CustomValidationFn[]
    const customMessage = params.message as string | undefined

    for (const validator of validators) {
      try {
        const result = validator(value)

        if (typeof result === 'boolean') {
          if (!result) {
            return {
              field: this.field,
              type: 'all_of',
              message: customMessage ?? `Field '${this.field}' failed allOf validation`,
              actualValue: value,
            }
          }
        } else {
          if (!result.valid) {
            return {
              field: this.field,
              type: 'all_of',
              message: customMessage ?? result.message ?? `Field '${this.field}' failed allOf validation`,
              actualValue: value,
            }
          }
        }
      } catch (error) {
        return {
          field: this.field,
          type: 'all_of',
          message: customMessage ?? `Field '${this.field}' allOf validator threw error: ${error instanceof Error ? error.message : String(error)}`,
          actualValue: value,
        }
      }
    }

    return null
  }

  private validateAnyOf(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const validators = params.validators as CustomValidationFn[]
    const customMessage = params.message as string | undefined

    for (const validator of validators) {
      try {
        const result = validator(value)

        if (typeof result === 'boolean') {
          if (result) {
            return null // At least one passed
          }
        } else {
          if (result.valid) {
            return null // At least one passed
          }
        }
      } catch {
        // Continue to next validator
      }
    }

    // None passed
    return {
      field: this.field,
      type: 'any_of',
      message: customMessage ?? `Field '${this.field}' failed anyOf validation - no validators passed`,
      actualValue: value,
    }
  }

  private validateNoneOf(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const validators = params.validators as CustomValidationFn[]
    const customMessage = params.message as string | undefined

    for (const validator of validators) {
      try {
        const result = validator(value)

        if (typeof result === 'boolean') {
          if (result) {
            // One passed, which is a failure for noneOf
            return {
              field: this.field,
              type: 'none_of',
              message: customMessage ?? `Field '${this.field}' failed noneOf validation - a validator passed`,
              actualValue: value,
            }
          }
        } else {
          if (result.valid) {
            // One passed, which is a failure for noneOf
            return {
              field: this.field,
              type: 'none_of',
              message: customMessage ?? `Field '${this.field}' failed noneOf validation - a validator passed`,
              actualValue: value,
            }
          }
        }
      } catch {
        // Error means validator didn't pass, continue
      }
    }

    // None passed, which is success for noneOf
    return null
  }

  // ==========================================================================
  // LENGTH VALIDATION HELPERS
  // ==========================================================================

  private validateLengthRange(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const min = params.min as number
    const max = params.max as number

    let length: number
    if (typeof value === 'string') {
      length = value.length
    } else if (Array.isArray(value)) {
      length = value.length
    } else {
      return {
        field: this.field,
        type: 'length_range',
        message: `Field '${this.field}' expected string or array for length check`,
        actualValue: value,
      }
    }

    if (length < min || length > max) {
      const rangeMsg = min === max ? `exactly ${min}` : `between ${min} and ${max}`
      return {
        field: this.field,
        type: 'length_range',
        message: `Field '${this.field}' length ${length} is not ${rangeMsg}`,
        actualValue: value,
        expectedValue: { min, max },
      }
    }

    return null
  }

  private validateExactLength(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const expectedLength = params.length as number

    let length: number
    if (typeof value === 'string') {
      length = value.length
    } else if (Array.isArray(value)) {
      length = value.length
    } else {
      return {
        field: this.field,
        type: 'exact_length',
        message: `Field '${this.field}' expected string or array for length check`,
        actualValue: value,
      }
    }

    if (length !== expectedLength) {
      return {
        field: this.field,
        type: 'exact_length',
        message: `Field '${this.field}' length ${length} is not exactly ${expectedLength}`,
        actualValue: value,
        expectedValue: expectedLength,
      }
    }

    return null
  }

  // ==========================================================================
  // CUSTOM VALIDATION HELPERS
  // ==========================================================================

  private validateCustom(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const fn = params.fn as CustomValidationFn
    const defaultMessage = params.message as string | undefined

    try {
      const result = fn(value)

      if (typeof result === 'boolean') {
        if (!result) {
          return {
            field: this.field,
            type: 'custom',
            message: defaultMessage ?? `Field '${this.field}' failed custom validation`,
            actualValue: value,
          }
        }
      } else {
        if (!result.valid) {
          return {
            field: this.field,
            type: 'custom',
            message: result.message ?? defaultMessage ?? `Field '${this.field}' failed custom validation`,
            actualValue: value,
          }
        }
      }
    } catch (error) {
      return {
        field: this.field,
        type: 'custom',
        message: `Field '${this.field}' custom validation threw error: ${error instanceof Error ? error.message : String(error)}`,
        actualValue: value,
      }
    }

    return null
  }

  // ==========================================================================
  // DATE VALIDATION HELPERS
  // ==========================================================================

  private validateDateAfter(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const threshold = params.date as number
    const dateValue = this.parseDateValue(value)

    if (dateValue === null) {
      return {
        field: this.field,
        type: 'date_after',
        message: `Field '${this.field}' expected valid date`,
        actualValue: value,
      }
    }

    if (dateValue <= threshold) {
      return {
        field: this.field,
        type: 'date_after',
        message: `Field '${this.field}' date must be after ${new Date(threshold).toISOString()}`,
        actualValue: value,
        expectedValue: new Date(threshold).toISOString(),
      }
    }

    return null
  }

  private validateDateBefore(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const threshold = params.date as number
    const dateValue = this.parseDateValue(value)

    if (dateValue === null) {
      return {
        field: this.field,
        type: 'date_before',
        message: `Field '${this.field}' expected valid date`,
        actualValue: value,
      }
    }

    if (dateValue >= threshold) {
      return {
        field: this.field,
        type: 'date_before',
        message: `Field '${this.field}' date must be before ${new Date(threshold).toISOString()}`,
        actualValue: value,
        expectedValue: new Date(threshold).toISOString(),
      }
    }

    return null
  }

  private validateDateBetween(value: unknown, params: Record<string, unknown>): ValueValidationFailure | null {
    const start = params.start as number
    const end = params.end as number
    const dateValue = this.parseDateValue(value)

    if (dateValue === null) {
      return {
        field: this.field,
        type: 'date_between',
        message: `Field '${this.field}' expected valid date`,
        actualValue: value,
      }
    }

    if (dateValue < start || dateValue > end) {
      return {
        field: this.field,
        type: 'date_between',
        message: `Field '${this.field}' date must be between ${new Date(start).toISOString()} and ${new Date(end).toISOString()}`,
        actualValue: value,
        expectedValue: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
      }
    }

    return null
  }

  private parseDateValue(value: unknown): number | null {
    if (value instanceof Date) {
      const time = value.getTime()
      return isNaN(time) ? null : time
    }
    if (typeof value === 'string') {
      const parsed = new Date(value)
      const time = parsed.getTime()
      return isNaN(time) ? null : time
    }
    if (typeof value === 'number') {
      return value
    }
    return null
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a value expectation builder for a field
 *
 * @example
 * ```typescript
 * const ageExpectation = valueExpect('age')
 *   .toBeBetween(0, 150)
 *   .build()
 *
 * const result = ageExpectation.validate(25)
 * console.log(result.valid) // true
 * ```
 */
export function valueExpect<T = unknown>(field: string): ValueExpectationBuilder<T> {
  return new ValueExpectationBuilder<T>(field)
}

/**
 * Alias for valueExpect
 */
export const ve = valueExpect

/**
 * Validate a value against multiple expectations
 */
export function validateValue(
  value: unknown,
  expectations: ValueExpectation[]
): ValueValidationResult {
  const failures: ValueValidationFailure[] = []

  for (const expectation of expectations) {
    const result = expectation.validate(value)
    failures.push(...result.failures)
  }

  return {
    valid: failures.length === 0,
    failures,
  }
}

/**
 * Validate a record against field expectations
 */
export function validateRecord(
  record: Record<string, unknown>,
  expectations: ValueExpectation[]
): ValueValidationResult {
  const failures: ValueValidationFailure[] = []

  for (const expectation of expectations) {
    const value = getNestedValue(record, expectation.field)
    const result = expectation.validate(value)
    failures.push(...result.failures)
  }

  return {
    valid: failures.length === 0,
    failures,
  }
}

/**
 * Validate multiple records against field expectations
 */
export function validateRecords(
  records: Record<string, unknown>[],
  expectations: ValueExpectation[]
): ValueValidationResult {
  const failures: ValueValidationFailure[] = []

  for (const record of records) {
    const result = validateRecord(record, expectations)
    failures.push(...result.failures)
  }

  return {
    valid: failures.length === 0,
    failures,
  }
}

// ============================================================================
// UTILITY FUNCTIONS
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
