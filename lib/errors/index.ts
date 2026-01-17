/**
 * @module lib/errors
 *
 * Standardized Error Handling for dotdo
 *
 * This module provides:
 * - Base DotdoError class with consistent structure
 * - Error code constants across the application
 * - Standard error factory functions
 * - Serialization methods (toJSON, toClientError)
 *
 * All custom errors should extend DotdoError for consistency.
 *
 * @example
 * ```typescript
 * import { DotdoError, createValidationError, ERROR_CODES } from './errors'
 *
 * // Throw a validation error
 * throw createValidationError('Field is required', {
 *   field: 'email',
 *   value: input.email
 * })
 *
 * // Throw a custom error with cause chaining
 * try {
 *   await externalCall()
 * } catch (cause) {
 *   throw new DotdoError(
 *     'Failed to process request',
 *     ERROR_CODES.EXTERNAL_SERVICE_ERROR,
 *     { service: 'payment' },
 *     { cause }
 *   )
 * }
 * ```
 */

// =============================================================================
// ERROR CODES
// =============================================================================

/**
 * Standard error codes used across dotdo.
 * Organized by category for easy navigation and consistency.
 */
export const ERROR_CODES = {
  // Validation errors (400)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_VALUE: 'INVALID_VALUE',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',

  // Query/SQL errors (400)
  QUERY_VALIDATION_ERROR: 'QUERY_VALIDATION_ERROR',
  INVALID_QUERY: 'INVALID_QUERY',
  SQL_SECURITY_ERROR: 'SQL_SECURITY_ERROR',
  WRITE_OPERATION_FORBIDDEN: 'WRITE_OPERATION_FORBIDDEN',
  MULTI_STATEMENT_FORBIDDEN: 'MULTI_STATEMENT_FORBIDDEN',
  COMMENT_FORBIDDEN: 'COMMENT_FORBIDDEN',
  PRAGMA_FORBIDDEN: 'PRAGMA_FORBIDDEN',
  EMPTY_QUERY: 'EMPTY_QUERY',
  COMMAND_FORBIDDEN: 'COMMAND_FORBIDDEN',

  // Authentication & Authorization (401, 403)
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CAPABILITY_INVALID: 'CAPABILITY_INVALID',
  CAPABILITY_EXPIRED: 'CAPABILITY_EXPIRED',
  CAPABILITY_REVOKED: 'CAPABILITY_REVOKED',
  INSUFFICIENT_SCOPE: 'INSUFFICIENT_SCOPE',
  EXPIRED: 'EXPIRED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  WRONG_TARGET: 'WRONG_TARGET',
  SECRET_REQUIRED: 'SECRET_REQUIRED',

  // Resource errors (404, 409)
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  RESOURCE_IN_USE: 'RESOURCE_IN_USE',

  // RPC errors (400, 500)
  RPC_ERROR: 'RPC_ERROR',
  METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
  INVALID_REQUEST: 'INVALID_REQUEST',
  VERSION_MISMATCH: 'VERSION_MISMATCH',

  // Timeout & Reliability (504)
  TIMEOUT: 'TIMEOUT',
  DEADLINE_EXCEEDED: 'DEADLINE_EXCEEDED',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  CIRCUIT_HALF_OPEN: 'CIRCUIT_HALF_OPEN',

  // Resource limits (429, 507)
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  QUEUE_FULL: 'QUEUE_FULL',

  // Server errors (500)
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',

  // Data errors (500)
  DATABASE_ERROR: 'DATABASE_ERROR',
  STORAGE_ERROR: 'STORAGE_ERROR',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',

  // AI/LLM errors (500)
  AI_ERROR: 'AI_ERROR',
  AI_BUDGET_EXCEEDED: 'AI_BUDGET_EXCEEDED',
  INVALID_MODEL: 'INVALID_MODEL',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/**
 * Map error codes to HTTP status codes
 */
export const ERROR_CODE_TO_STATUS: Record<ErrorCode, number> = {
  // 400 - Bad Request
  VALIDATION_ERROR: 400,
  INVALID_TYPE: 400,
  INVALID_VALUE: 400,
  MISSING_REQUIRED_FIELD: 400,
  INVALID_FORMAT: 400,
  QUERY_VALIDATION_ERROR: 400,
  INVALID_QUERY: 400,
  INVALID_REQUEST: 400,

  // 401 - Unauthorized
  UNAUTHORIZED: 401,
  CAPABILITY_INVALID: 401,
  CAPABILITY_EXPIRED: 401,
  CAPABILITY_REVOKED: 401,
  EXPIRED: 401,
  INVALID_SIGNATURE: 401,

  // 403 - Forbidden
  FORBIDDEN: 403,
  INSUFFICIENT_SCOPE: 403,
  WRITE_OPERATION_FORBIDDEN: 403,
  MULTI_STATEMENT_FORBIDDEN: 403,
  COMMENT_FORBIDDEN: 403,
  PRAGMA_FORBIDDEN: 403,
  COMMAND_FORBIDDEN: 403,

  // 404 - Not Found
  NOT_FOUND: 404,
  METHOD_NOT_FOUND: 404,
  WRONG_TARGET: 404,

  // 409 - Conflict
  CONFLICT: 409,
  ALREADY_EXISTS: 409,
  RESOURCE_IN_USE: 409,

  // 429 - Too Many Requests
  RATE_LIMITED: 429,
  RATE_LIMIT_EXCEEDED: 429,
  QUOTA_EXCEEDED: 429,
  BUDGET_EXCEEDED: 429,

  // 504 - Gateway Timeout
  TIMEOUT: 504,
  DEADLINE_EXCEEDED: 504,
  CIRCUIT_OPEN: 504,
  CIRCUIT_HALF_OPEN: 504,
  QUEUE_FULL: 507,

  // 500 - Internal Server Error
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  SERVICE_UNAVAILABLE: 503,
  EXTERNAL_SERVICE_ERROR: 500,
  SQL_SECURITY_ERROR: 500,
  EMPTY_QUERY: 500,
  RPC_ERROR: 500,
  VERSION_MISMATCH: 500,
  DATABASE_ERROR: 500,
  STORAGE_ERROR: 500,
  TRANSACTION_FAILED: 500,
  AI_ERROR: 500,
  AI_BUDGET_EXCEEDED: 500,
  INVALID_MODEL: 500,
  SECRET_REQUIRED: 500,
}

// =============================================================================
// BASE ERROR CLASS
// =============================================================================

/**
 * Base error class for all dotdo errors.
 *
 * All custom errors should extend this class to ensure consistent
 * structure, serialization, and context tracking across the codebase.
 */
export class DotdoError extends Error {
  /** Machine-readable error code */
  readonly code: ErrorCode

  /** Error context for structured logging and debugging */
  readonly context?: Record<string, unknown>

  /** Original error that caused this error (error chaining) */
  readonly cause?: Error

  constructor(
    message: string,
    code: ErrorCode,
    context?: Record<string, unknown>,
    options?: { cause?: Error }
  ) {
    super(message)
    this.name = 'DotdoError'
    this.code = code
    this.context = context
    this.cause = options?.cause

    // Maintain proper stack trace in V8 environments
    const ErrorWithStackTrace = Error as typeof Error & {
      captureStackTrace?: (targetObject: object, constructorOpt?: Function) => void
    }
    if (ErrorWithStackTrace.captureStackTrace) {
      ErrorWithStackTrace.captureStackTrace(this, DotdoError)
    }
  }

  /**
   * Serialize error to JSON (for logging, monitoring, etc.)
   *
   * Includes stack trace and full context - suitable for internal logging.
   */
  toJSON(): {
    name: string
    message: string
    code: ErrorCode
    context?: Record<string, unknown>
    cause?: unknown
    stack?: string
  } {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      cause: this.cause?.message,
      stack: this.stack,
    }
  }

  /**
   * Serialize error to client-safe JSON (for API responses)
   *
   * Removes stack traces and sensitive context for security.
   * Subclasses can override to sanitize specific fields.
   */
  toClientError(): {
    name: string
    message: string
    code: ErrorCode
    context?: Record<string, unknown>
  } {
    // Subclasses should override to sanitize sensitive data
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
    }
  }

  /**
   * Get HTTP status code for this error
   */
  getStatusCode(): number {
    return ERROR_CODE_TO_STATUS[this.code] ?? 500
  }
}

// =============================================================================
// ERROR FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a validation error
 */
export function createValidationError(
  message: string,
  context?: Record<string, unknown>,
  options?: { cause?: Error }
): DotdoError {
  return new DotdoError(message, ERROR_CODES.VALIDATION_ERROR, context, options)
}

/**
 * Create a not found error
 */
export function createNotFoundError(
  resourceType: string,
  resourceId?: string,
  options?: { cause?: Error }
): DotdoError {
  const resource = resourceId ? `${resourceType} '${resourceId}'` : resourceType
  return new DotdoError(`${resource} not found`, ERROR_CODES.NOT_FOUND, { resourceType, resourceId }, options)
}

/**
 * Create an unauthorized error
 */
export function createUnauthorizedError(
  message = 'Unauthorized',
  context?: Record<string, unknown>,
  options?: { cause?: Error }
): DotdoError {
  return new DotdoError(message, ERROR_CODES.UNAUTHORIZED, context, options)
}

/**
 * Create a forbidden error
 */
export function createForbiddenError(
  message = 'Forbidden',
  context?: Record<string, unknown>,
  options?: { cause?: Error }
): DotdoError {
  return new DotdoError(message, ERROR_CODES.FORBIDDEN, context, options)
}

/**
 * Create a conflict error
 */
export function createConflictError(
  resourceType: string,
  reason?: string,
  options?: { cause?: Error }
): DotdoError {
  const message = reason ? `${resourceType} conflict: ${reason}` : `${resourceType} already exists`
  return new DotdoError(message, ERROR_CODES.CONFLICT, { resourceType, reason }, options)
}

/**
 * Create a timeout error
 */
export function createTimeoutError(
  operationName: string,
  timeoutMs: number,
  options?: { cause?: Error }
): DotdoError {
  const message = `${operationName} timed out after ${timeoutMs}ms`
  return new DotdoError(message, ERROR_CODES.TIMEOUT, { operationName, timeoutMs }, options)
}

/**
 * Create an internal server error
 */
export function createInternalError(
  message: string,
  context?: Record<string, unknown>,
  options?: { cause?: Error }
): DotdoError {
  return new DotdoError(message, ERROR_CODES.INTERNAL_SERVER_ERROR, context, options)
}

/**
 * Create a circuit breaker error
 */
export function createCircuitBreakerError(
  state: 'open' | 'half-open',
  options?: { cause?: Error }
): DotdoError {
  const code = state === 'open' ? ERROR_CODES.CIRCUIT_OPEN : ERROR_CODES.CIRCUIT_HALF_OPEN
  const message = `Circuit breaker is ${state}`
  return new DotdoError(message, code, { state }, options)
}

/**
 * Create a rate limit error
 */
export function createRateLimitError(
  limitType: string,
  retryAfterMs?: number,
  options?: { cause?: Error }
): DotdoError {
  const message = retryAfterMs
    ? `Rate limited on ${limitType}. Retry after ${retryAfterMs}ms`
    : `Rate limited on ${limitType}`
  return new DotdoError(message, ERROR_CODES.RATE_LIMITED, { limitType, retryAfterMs }, options)
}

/**
 * Create an RPC error
 */
export function createRpcError(
  code: 'METHOD_NOT_FOUND' | 'INVALID_REQUEST' | 'VERSION_MISMATCH' | 'RPC_ERROR',
  message: string,
  context?: Record<string, unknown>,
  options?: { cause?: Error }
): DotdoError {
  const errorCode = code as ErrorCode
  return new DotdoError(message, errorCode, context, options)
}

// =============================================================================
// ERROR CHECKING UTILITIES
// =============================================================================

/**
 * Check if an error is a DotdoError
 */
export function isDotdoError(error: unknown): error is DotdoError {
  return error instanceof DotdoError
}

/**
 * Extract error code from any error
 */
export function getErrorCode(error: unknown): ErrorCode | null {
  if (isDotdoError(error)) {
    return error.code
  }
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code as ErrorCode
  }
  return null
}

/**
 * Extract error message from any error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'An unexpected error occurred'
}

/**
 * Convert any error to a DotdoError
 */
export function toDotdoError(error: unknown, defaultCode: ErrorCode = ERROR_CODES.INTERNAL_SERVER_ERROR): DotdoError {
  if (isDotdoError(error)) {
    return error
  }

  if (error instanceof Error) {
    const code = getErrorCode(error) || defaultCode
    return new DotdoError(error.message, code, undefined, { cause: error })
  }

  return new DotdoError(getErrorMessage(error), defaultCode)
}
