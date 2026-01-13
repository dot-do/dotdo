/**
 * Error Transformation for Validation
 *
 * Transforms Zod validation errors into consistent API error responses
 * that integrate with the error handling middleware.
 */

import { ZodError, ZodIssue } from 'zod'

/**
 * Validation error with detailed path and context information
 */
export class ValidationError extends Error {
  /** Path to the invalid field */
  readonly path: (string | number)[]
  /** The invalid value that was provided */
  readonly received: unknown
  /** Expected type or constraint */
  readonly expected: string
  /** Error code for API responses */
  readonly code: string
  /** HTTP status code */
  readonly status: number
  /** Field-level error details */
  readonly details?: Record<string, string[]>

  constructor(options: {
    message: string
    path: (string | number)[]
    received?: unknown
    expected?: string
    code?: string
    status?: number
    details?: Record<string, string[]>
  }) {
    super(options.message)
    this.name = 'ValidationError'
    this.path = options.path
    this.received = options.received
    this.expected = options.expected ?? 'unknown'
    this.code = options.code ?? 'VALIDATION_ERROR'
    this.status = options.status ?? 422
    this.details = options.details
  }

  /**
   * Format error as a readable string with path
   */
  toString(): string {
    const pathStr = this.path.length > 0 ? ` at "${this.path.join('.')}"` : ''
    return `ValidationError${pathStr}: ${this.message}`
  }

  /**
   * Convert to JSON-serializable object
   */
  toJSON(): {
    code: string
    message: string
    path: (string | number)[]
    expected: string
    details?: Record<string, string[]>
  } {
    return {
      code: this.code,
      message: this.message,
      path: this.path,
      expected: this.expected,
      ...(this.details && { details: this.details }),
    }
  }
}

/**
 * Transform a ZodError into a ValidationError with API-friendly formatting
 *
 * @param error - The ZodError to transform
 * @param target - The validation target (body, query, param, header)
 * @param prefix - Optional error message prefix
 * @returns ValidationError suitable for API responses
 */
export function transformValidationError(
  error: ZodError,
  target: string = 'body',
  prefix?: string
): ValidationError {
  const issues = error.issues
  const details = formatIssuesAsDetails(issues)
  const firstIssue = issues[0]

  // Build a user-friendly message
  const messagePrefix = prefix || getTargetPrefix(target)
  const message = formatErrorMessage(issues, messagePrefix)

  return new ValidationError({
    message,
    path: firstIssue?.path ?? [],
    received: undefined, // Don't expose received value in production
    expected: firstIssue ? formatExpected(firstIssue) : 'valid input',
    code: 'UNPROCESSABLE_ENTITY',
    status: 422,
    details,
  })
}

/**
 * Format Zod issues into field-level error details
 */
function formatIssuesAsDetails(issues: ZodIssue[]): Record<string, string[]> {
  const details: Record<string, string[]> = {}

  for (const issue of issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '_root'
    if (!details[path]) {
      details[path] = []
    }
    details[path].push(issue.message)
  }

  return details
}

/**
 * Get a human-friendly prefix for the validation target
 */
function getTargetPrefix(target: string): string {
  switch (target) {
    case 'body':
    case 'json':
      return 'Request body'
    case 'query':
      return 'Query parameter'
    case 'param':
      return 'Path parameter'
    case 'header':
      return 'Header'
    case 'form':
      return 'Form field'
    default:
      return 'Input'
  }
}

/**
 * Format multiple issues into a single error message
 */
function formatErrorMessage(issues: ZodIssue[], prefix: string): string {
  if (issues.length === 0) {
    return `${prefix} validation failed`
  }

  if (issues.length === 1) {
    const issue = issues[0]
    const pathStr = issue.path.length > 0 ? ` "${issue.path.join('.')}"` : ''
    return `${prefix}${pathStr}: ${issue.message}`
  }

  // Multiple issues - summarize
  const fieldCount = new Set(issues.map((i) => i.path.join('.'))).size
  return `${prefix} validation failed: ${fieldCount} field${fieldCount === 1 ? '' : 's'} invalid`
}

/**
 * Format the expected value from a Zod issue
 */
function formatExpected(issue: ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return (issue as { expected?: string }).expected ?? issue.message
    case 'invalid_literal':
      return `literal ${JSON.stringify((issue as { expected?: unknown }).expected)}`
    case 'invalid_enum_value':
      return `one of [${((issue as { options?: string[] }).options ?? []).join(', ')}]`
    case 'invalid_union':
      return 'valid union member'
    case 'invalid_string':
      return (issue as { validation?: string }).validation ?? 'valid string'
    case 'too_small':
      return `minimum ${(issue as { minimum?: number }).minimum}`
    case 'too_big':
      return `maximum ${(issue as { maximum?: number }).maximum}`
    case 'custom':
      return issue.message
    default:
      return issue.message
  }
}

/**
 * Format validation errors for HTTP response body
 *
 * @param error - ValidationError or ZodError
 * @returns Formatted error response object
 */
export function formatValidationResponse(
  error: ValidationError | ZodError
): {
  error: {
    code: string
    message: string
    details?: Record<string, string[]>
  }
} {
  if (error instanceof ValidationError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details && { details: error.details }),
      },
    }
  }

  // Handle raw ZodError
  const transformed = transformValidationError(error, 'body')
  return {
    error: {
      code: transformed.code,
      message: transformed.message,
      ...(transformed.details && { details: transformed.details }),
    },
  }
}

/**
 * Check if an error is a validation error
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError
}

/**
 * Check if an error is a Zod error
 */
export function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError
}

/**
 * Safe JSON parse with validation
 *
 * @param json - JSON string to parse
 * @param schema - Optional Zod schema to validate against
 * @returns Parsed and validated data, or error
 *
 * @example
 * ```ts
 * const result = safeJsonParse(jsonString, UserSchema)
 * if (result.success) {
 *   // result.data is typed
 * } else {
 *   // result.error contains details
 * }
 * ```
 */
export function safeJsonParse<T>(
  json: string,
  schema?: import('zod').ZodType<T>
): { success: true; data: T } | { success: false; error: ValidationError } {
  try {
    const parsed = JSON.parse(json)

    if (!schema) {
      return { success: true, data: parsed as T }
    }

    const result = schema.safeParse(parsed)
    if (result.success) {
      return { success: true, data: result.data }
    }

    return {
      success: false,
      error: transformValidationError(result.error, 'json'),
    }
  } catch (e) {
    return {
      success: false,
      error: new ValidationError({
        message: 'Invalid JSON',
        path: [],
        code: 'INVALID_JSON',
        status: 400,
      }),
    }
  }
}

/**
 * Parse JSON and throw on error
 *
 * @param json - JSON string to parse
 * @param schema - Optional Zod schema to validate against
 * @returns Parsed and validated data
 * @throws ValidationError if parsing or validation fails
 */
export function parseJsonOrThrow<T>(
  json: string,
  schema?: import('zod').ZodType<T>
): T {
  const result = safeJsonParse(json, schema)
  if (!result.success) {
    throw result.error
  }
  return result.data
}
