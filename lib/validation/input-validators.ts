/**
 * Input Validators
 *
 * Provides utility functions for validating inputs at public API entry points.
 * These validators throw InputValidationError with detailed context on failure.
 *
 * @module lib/validation/input-validators
 */

import { z, ZodType, ZodError } from 'zod'

// ============================================================================
// INPUT VALIDATION ERROR
// ============================================================================

/**
 * Error thrown when input validation fails.
 * Contains detailed context about the validation failure.
 */
export class InputValidationError extends Error {
  /** Name of the input that failed validation */
  readonly inputName: string
  /** The value that was received */
  readonly received: unknown
  /** What was expected */
  readonly expected: string
  /** Error code for API responses */
  readonly code: string

  constructor(options: {
    message: string
    inputName: string
    received?: unknown
    expected?: string
    code?: string
  }) {
    super(options.message)
    this.name = 'InputValidationError'
    this.inputName = options.inputName
    this.received = options.received
    this.expected = options.expected ?? 'valid input'
    this.code = options.code ?? 'INPUT_VALIDATION_ERROR'
  }

  /**
   * Format error as a readable string
   */
  toString(): string {
    return `InputValidationError [${this.inputName}]: ${this.message}`
  }

  /**
   * Convert to JSON-serializable object
   */
  toJSON(): {
    code: string
    message: string
    inputName: string
    expected: string
  } {
    return {
      code: this.code,
      message: this.message,
      inputName: this.inputName,
      expected: this.expected,
    }
  }
}

// ============================================================================
// VALIDATION OPTIONS
// ============================================================================

/**
 * Options for validateInput
 */
export interface ValidateInputOptions {
  /** Allow null values (requires schema to permit null) */
  allowNull?: boolean
  /** Allow undefined values (requires schema to permit undefined) */
  allowUndefined?: boolean
}

/**
 * Options for validateNumber
 */
export interface ValidateNumberOptions {
  /** Minimum allowed value */
  min?: number
  /** Maximum allowed value */
  max?: number
  /** Require integer value */
  integer?: boolean
}

/**
 * Options for validateArray
 */
export interface ValidateArrayOptions {
  /** Minimum array length */
  minLength?: number
  /** Maximum array length */
  maxLength?: number
}

// ============================================================================
// CORE VALIDATORS
// ============================================================================

/**
 * Validate input against a Zod schema.
 * Throws InputValidationError if validation fails.
 *
 * @param value - The value to validate
 * @param schema - Zod schema to validate against
 * @param inputName - Name of the input (for error messages)
 * @param options - Validation options
 * @returns The validated value
 * @throws InputValidationError if validation fails
 */
export function validateInput<T>(
  value: unknown,
  schema: ZodType<T>,
  inputName: string,
  options?: ValidateInputOptions
): T {
  // Handle null/undefined before schema validation
  if (value === null) {
    if (options?.allowNull) {
      // Still run schema validation for nullable schemas
      const result = schema.safeParse(value)
      if (result.success) {
        return result.data
      }
    }
    throw new InputValidationError({
      message: `${inputName} is required`,
      inputName,
      received: null,
      expected: 'non-null value',
    })
  }

  if (value === undefined) {
    if (options?.allowUndefined) {
      // Still run schema validation for optional schemas
      const result = schema.safeParse(value)
      if (result.success) {
        return result.data
      }
    }
    throw new InputValidationError({
      message: `${inputName} is required`,
      inputName,
      received: undefined,
      expected: 'defined value',
    })
  }

  // Validate against schema
  const result = schema.safeParse(value)

  if (!result.success) {
    const firstIssue = result.error.issues[0]
    const message = firstIssue
      ? `${inputName}: ${firstIssue.message}`
      : `${inputName} validation failed`

    throw new InputValidationError({
      message,
      inputName,
      received: value,
      expected: formatExpected(firstIssue),
    })
  }

  return result.data
}

/**
 * Validate that a value is a string.
 *
 * @param value - The value to validate
 * @param inputName - Name of the input (for error messages)
 * @returns The validated string
 * @throws InputValidationError if validation fails
 */
export function validateString(value: unknown, inputName: string): string {
  if (value === null || value === undefined) {
    throw new InputValidationError({
      message: `${inputName} must be a string`,
      inputName,
      received: value,
      expected: 'string',
    })
  }

  if (typeof value !== 'string') {
    throw new InputValidationError({
      message: `${inputName} must be a string`,
      inputName,
      received: value,
      expected: 'string',
    })
  }

  return value
}

/**
 * Validate that a value is a non-empty string.
 * Trims whitespace and rejects empty or whitespace-only strings.
 *
 * @param value - The value to validate
 * @param inputName - Name of the input (for error messages)
 * @returns The trimmed validated string
 * @throws InputValidationError if validation fails
 */
export function validateNonEmptyString(value: unknown, inputName: string): string {
  const str = validateString(value, inputName)
  const trimmed = str.trim()

  if (trimmed.length === 0) {
    throw new InputValidationError({
      message: `${inputName} cannot be empty`,
      inputName,
      received: value,
      expected: 'non-empty string',
    })
  }

  return trimmed
}

/**
 * Validate that a value is a number.
 * Rejects NaN, Infinity, and -Infinity.
 *
 * @param value - The value to validate
 * @param inputName - Name of the input (for error messages)
 * @param options - Additional constraints (min, max, integer)
 * @returns The validated number
 * @throws InputValidationError if validation fails
 */
export function validateNumber(
  value: unknown,
  inputName: string,
  options?: ValidateNumberOptions
): number {
  if (value === null || value === undefined) {
    throw new InputValidationError({
      message: `${inputName} must be a number`,
      inputName,
      received: value,
      expected: 'number',
    })
  }

  if (typeof value !== 'number') {
    throw new InputValidationError({
      message: `${inputName} must be a number`,
      inputName,
      received: value,
      expected: 'number',
    })
  }

  if (Number.isNaN(value)) {
    throw new InputValidationError({
      message: `${inputName} must be a number`,
      inputName,
      received: value,
      expected: 'number (not NaN)',
    })
  }

  if (!Number.isFinite(value)) {
    throw new InputValidationError({
      message: `${inputName} must be a number`,
      inputName,
      received: value,
      expected: 'finite number',
    })
  }

  // Check integer constraint
  if (options?.integer && !Number.isInteger(value)) {
    throw new InputValidationError({
      message: `${inputName} must be an integer`,
      inputName,
      received: value,
      expected: 'integer',
    })
  }

  // Check minimum constraint
  if (options?.min !== undefined && value < options.min) {
    throw new InputValidationError({
      message: `${inputName} must be at least ${options.min}`,
      inputName,
      received: value,
      expected: `>= ${options.min}`,
    })
  }

  // Check maximum constraint
  if (options?.max !== undefined && value > options.max) {
    throw new InputValidationError({
      message: `${inputName} must be at most ${options.max}`,
      inputName,
      received: value,
      expected: `<= ${options.max}`,
    })
  }

  return value
}

/**
 * Validate that a value is a plain object (not null, not array).
 *
 * @param value - The value to validate
 * @param inputName - Name of the input (for error messages)
 * @returns The validated object
 * @throws InputValidationError if validation fails
 */
export function validateObject(
  value: unknown,
  inputName: string
): Record<string, unknown> {
  if (value === null || value === undefined) {
    throw new InputValidationError({
      message: `${inputName} must be an object`,
      inputName,
      received: value,
      expected: 'object',
    })
  }

  if (typeof value !== 'object') {
    throw new InputValidationError({
      message: `${inputName} must be an object`,
      inputName,
      received: value,
      expected: 'object',
    })
  }

  if (Array.isArray(value)) {
    throw new InputValidationError({
      message: `${inputName} must be an object`,
      inputName,
      received: value,
      expected: 'object (not array)',
    })
  }

  return value as Record<string, unknown>
}

/**
 * Validate that a value is an array.
 *
 * @param value - The value to validate
 * @param inputName - Name of the input (for error messages)
 * @param options - Additional constraints (minLength, maxLength)
 * @returns The validated array
 * @throws InputValidationError if validation fails
 */
export function validateArray(
  value: unknown,
  inputName: string,
  options?: ValidateArrayOptions
): unknown[] {
  if (value === null || value === undefined) {
    throw new InputValidationError({
      message: `${inputName} must be an array`,
      inputName,
      received: value,
      expected: 'array',
    })
  }

  if (!Array.isArray(value)) {
    throw new InputValidationError({
      message: `${inputName} must be an array`,
      inputName,
      received: value,
      expected: 'array',
    })
  }

  // Check minimum length constraint
  if (options?.minLength !== undefined && value.length < options.minLength) {
    const plural = options.minLength === 1 ? 'element' : 'elements'
    throw new InputValidationError({
      message: `${inputName} must have at least ${options.minLength} ${plural}`,
      inputName,
      received: value,
      expected: `array with >= ${options.minLength} ${plural}`,
    })
  }

  // Check maximum length constraint
  if (options?.maxLength !== undefined && value.length > options.maxLength) {
    const plural = options.maxLength === 1 ? 'element' : 'elements'
    throw new InputValidationError({
      message: `${inputName} must have at most ${options.maxLength} ${plural}`,
      inputName,
      received: value,
      expected: `array with <= ${options.maxLength} ${plural}`,
    })
  }

  return value
}

/**
 * Validate an ID string (non-empty after trimming).
 *
 * @param value - The value to validate
 * @param inputName - Name of the input (for error messages)
 * @returns The validated ID string
 * @throws InputValidationError if validation fails
 */
export function validateId(value: unknown, inputName: string): string {
  if (value === null || value === undefined) {
    throw new InputValidationError({
      message: `${inputName} is required`,
      inputName,
      received: value,
      expected: 'string ID',
    })
  }

  if (typeof value !== 'string') {
    throw new InputValidationError({
      message: `${inputName} must be a string`,
      inputName,
      received: value,
      expected: 'string ID',
    })
  }

  const trimmed = value.trim()

  if (trimmed.length === 0) {
    throw new InputValidationError({
      message: `${inputName} cannot be empty`,
      inputName,
      received: value,
      expected: 'non-empty string ID',
    })
  }

  return trimmed
}

/**
 * Validate a file path string.
 * Rejects null bytes and normalizes multiple slashes.
 *
 * @param value - The value to validate
 * @param inputName - Name of the input (for error messages)
 * @returns The validated and normalized path
 * @throws InputValidationError if validation fails
 */
export function validatePath(value: unknown, inputName: string): string {
  if (value === null || value === undefined) {
    throw new InputValidationError({
      message: `${inputName} is required`,
      inputName,
      received: value,
      expected: 'file path string',
    })
  }

  if (typeof value !== 'string') {
    throw new InputValidationError({
      message: `${inputName} must be a string`,
      inputName,
      received: value,
      expected: 'file path string',
    })
  }

  if (value.length === 0) {
    throw new InputValidationError({
      message: `${inputName} cannot be empty`,
      inputName,
      received: value,
      expected: 'non-empty file path',
    })
  }

  // Check for null bytes (path traversal attack vector)
  if (value.includes('\x00')) {
    throw new InputValidationError({
      message: `${inputName} contains invalid characters`,
      inputName,
      received: value,
      expected: 'valid file path (no null bytes)',
    })
  }

  // Normalize multiple slashes to single slash
  const normalized = value.replace(/\/+/g, '/')

  return normalized
}

/**
 * Validate optional options object against a Zod schema.
 * Returns empty object if value is null/undefined.
 * Strips unknown keys by default.
 *
 * @param value - The options value to validate (can be null/undefined)
 * @param schema - Zod schema to validate against
 * @param inputName - Name of the input (for error messages)
 * @returns The validated options object
 * @throws InputValidationError if validation fails
 */
export function validateOptions<T extends z.ZodRawShape>(
  value: unknown,
  schema: z.ZodObject<T>,
  inputName: string
): z.infer<typeof schema> {
  // Return empty object for null/undefined
  if (value === null || value === undefined) {
    return {} as z.infer<typeof schema>
  }

  // Must be an object
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new InputValidationError({
      message: `${inputName} must be an object`,
      inputName,
      received: value,
      expected: 'options object',
    })
  }

  // Validate against schema (strip unknown keys by default)
  const strippedSchema = schema.strip()
  const result = strippedSchema.safeParse(value)

  if (!result.success) {
    const firstIssue = result.error.issues[0]
    const path = firstIssue?.path.join('.') || ''
    const fieldInfo = path ? ` (${path})` : ''
    const message = firstIssue
      ? `${inputName}${fieldInfo}: ${firstIssue.message}`
      : `${inputName} validation failed`

    throw new InputValidationError({
      message,
      inputName,
      received: value,
      expected: formatExpected(firstIssue),
    })
  }

  return result.data
}

/**
 * Create a reusable input validator for a specific schema.
 *
 * @param schema - Zod schema to validate against
 * @param inputName - Name of the input (for error messages)
 * @returns A validation function that throws InputValidationError on failure
 */
export function createInputValidator<T>(
  schema: ZodType<T>,
  inputName: string
): (value: unknown) => T {
  return (value: unknown): T => {
    return validateInput(value, schema, inputName)
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format the expected value from a Zod issue
 */
function formatExpected(issue?: z.ZodIssue): string {
  if (!issue) return 'valid input'

  switch (issue.code) {
    case 'invalid_type':
      return (issue as { expected?: string }).expected ?? issue.message
    case 'invalid_literal':
      return `literal ${JSON.stringify((issue as { expected?: unknown }).expected)}`
    case 'invalid_enum_value':
      return `one of [${((issue as { options?: string[] }).options ?? []).join(', ')}]`
    case 'too_small': {
      const smallIssue = issue as { minimum?: number; type?: string }
      if (smallIssue.type === 'string') {
        return `string with at least ${smallIssue.minimum} characters`
      }
      if (smallIssue.type === 'array') {
        return `array with at least ${smallIssue.minimum} elements`
      }
      return `>= ${smallIssue.minimum}`
    }
    case 'too_big': {
      const bigIssue = issue as { maximum?: number; type?: string }
      if (bigIssue.type === 'string') {
        return `string with at most ${bigIssue.maximum} characters`
      }
      if (bigIssue.type === 'array') {
        return `array with at most ${bigIssue.maximum} elements`
      }
      return `<= ${bigIssue.maximum}`
    }
    default:
      return issue.message
  }
}
