/**
 * Custom Error Types for Error Handling Patterns Example
 *
 * Provides a comprehensive error hierarchy for:
 * - Retryable vs non-retryable errors
 * - Timeout errors
 * - Circuit breaker errors
 * - Validation errors
 * - Rate limit errors
 */

// ============================================================================
// BASE ERROR TYPES
// ============================================================================

/**
 * Base error for all custom application errors
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message)
    this.name = 'AppError'
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
    }
  }
}

// ============================================================================
// RETRYABLE ERRORS
// ============================================================================

/**
 * Error that should be retried with exponential backoff.
 * Used for transient failures like network issues or temporary service outages.
 */
export class RetryableError extends AppError {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
    public readonly maxRetries: number = 3,
    public readonly attempt: number = 1
  ) {
    super(message, 'RETRYABLE', 503)
    this.name = 'RetryableError'
  }

  /**
   * Calculate delay for next retry using exponential backoff
   */
  getNextDelay(baseDelayMs: number = 1000, multiplier: number = 2): number {
    if (this.retryAfterMs) return this.retryAfterMs
    const delay = baseDelayMs * Math.pow(multiplier, this.attempt - 1)
    // Add jitter (10-50% of delay)
    const jitter = delay * (0.1 + Math.random() * 0.4)
    return Math.min(delay + jitter, 30000) // Cap at 30 seconds
  }

  /**
   * Check if more retries are allowed
   */
  canRetry(): boolean {
    return this.attempt < this.maxRetries
  }

  /**
   * Create a new error for the next retry attempt
   */
  nextAttempt(): RetryableError {
    return new RetryableError(
      this.message,
      this.retryAfterMs,
      this.maxRetries,
      this.attempt + 1
    )
  }
}

/**
 * Transient network error - should always retry
 */
export class NetworkError extends RetryableError {
  constructor(
    message: string,
    public readonly endpoint?: string,
    public readonly timeout?: number
  ) {
    super(message)
    this.name = 'NetworkError'
  }
}

/**
 * Rate limit exceeded - retry after specified delay
 */
export class RateLimitError extends RetryableError {
  constructor(
    message: string,
    retryAfterMs: number,
    public readonly limit?: number,
    public readonly remaining?: number
  ) {
    super(message, retryAfterMs)
    this.name = 'RateLimitError'
  }
}

// ============================================================================
// NON-RETRYABLE ERRORS
// ============================================================================

/**
 * Error that should NOT be retried.
 * Used for permanent failures like validation errors or business rule violations.
 */
export class NonRetryableError extends AppError {
  constructor(
    message: string,
    code: string = 'NON_RETRYABLE',
    statusCode: number = 400
  ) {
    super(message, code, statusCode)
    this.name = 'NonRetryableError'
  }
}

/**
 * Validation error - retrying won't help
 */
export class ValidationError extends NonRetryableError {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: unknown
  ) {
    super(message, 'VALIDATION_ERROR', 400)
    this.name = 'ValidationError'
  }
}

/**
 * Authorization error - retrying won't help
 */
export class AuthorizationError extends NonRetryableError {
  constructor(
    message: string = 'Unauthorized',
    public readonly requiredPermission?: string
  ) {
    super(message, 'UNAUTHORIZED', 403)
    this.name = 'AuthorizationError'
  }
}

/**
 * Resource not found - retrying won't help
 */
export class NotFoundError extends NonRetryableError {
  constructor(
    resource: string,
    id?: string
  ) {
    const message = id ? `${resource} '${id}' not found` : `${resource} not found`
    super(message, 'NOT_FOUND', 404)
    this.name = 'NotFoundError'
  }
}

/**
 * Business rule violation - retrying won't help
 */
export class BusinessRuleError extends NonRetryableError {
  constructor(
    message: string,
    public readonly rule?: string
  ) {
    super(message, 'BUSINESS_RULE_VIOLATION', 422)
    this.name = 'BusinessRuleError'
  }
}

// ============================================================================
// TIMEOUT ERRORS
// ============================================================================

/**
 * Operation timed out - may or may not be retryable depending on context
 */
export class TimeoutError extends AppError {
  constructor(
    operation: string,
    public readonly timeoutMs: number,
    public readonly retryable: boolean = true
  ) {
    super(`Operation '${operation}' timed out after ${timeoutMs}ms`, 'TIMEOUT', 504)
    this.name = 'TimeoutError'
  }
}

// ============================================================================
// CIRCUIT BREAKER ERRORS
// ============================================================================

/**
 * Circuit breaker is open - fail fast without calling the service
 */
export class CircuitOpenError extends AppError {
  constructor(
    service: string,
    public readonly resetAtMs?: number
  ) {
    const resetIn = resetAtMs ? ` Resets in ${Math.ceil((resetAtMs - Date.now()) / 1000)}s` : ''
    super(`Circuit breaker open for '${service}'.${resetIn}`, 'CIRCUIT_OPEN', 503)
    this.name = 'CircuitOpenError'
  }

  /**
   * Time until circuit breaker resets
   */
  get timeUntilResetMs(): number {
    return this.resetAtMs ? Math.max(0, this.resetAtMs - Date.now()) : 0
  }
}

// ============================================================================
// AGGREGATE ERRORS
// ============================================================================

/**
 * Multiple errors occurred - used for batch operations
 */
export class AggregateError extends AppError {
  constructor(
    message: string,
    public readonly errors: Error[],
    public readonly partial: boolean = false
  ) {
    super(message, 'AGGREGATE_ERROR', partial ? 207 : 500)
    this.name = 'AggregateError'
  }

  /**
   * Number of errors
   */
  get count(): number {
    return this.errors.length
  }

  /**
   * Check if any errors are retryable
   */
  hasRetryableErrors(): boolean {
    return this.errors.some(e => e instanceof RetryableError)
  }

  /**
   * Get only retryable errors
   */
  getRetryableErrors(): RetryableError[] {
    return this.errors.filter((e): e is RetryableError => e instanceof RetryableError)
  }

  toJSON() {
    return {
      ...super.toJSON(),
      errors: this.errors.map(e => ({
        name: e.name,
        message: e.message,
        ...(e instanceof AppError ? { code: e.code } : {}),
      })),
      partial: this.partial,
    }
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

export function isRetryableError(error: unknown): error is RetryableError {
  return error instanceof RetryableError
}

export function isNonRetryableError(error: unknown): error is NonRetryableError {
  return error instanceof NonRetryableError
}

export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError
}

export function isCircuitOpenError(error: unknown): error is CircuitOpenError {
  return error instanceof CircuitOpenError
}

export function isAggregateError(error: unknown): error is AggregateError {
  return error instanceof AggregateError
}

// ============================================================================
// ERROR UTILITIES
// ============================================================================

/**
 * Ensure a value is an Error, converting if necessary
 */
export function ensureError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string') return new Error(value)
  return new Error(String(value))
}

/**
 * Determine if an error should be retried based on its type
 */
export function shouldRetry(error: unknown): boolean {
  if (error instanceof NonRetryableError) return false
  if (error instanceof RetryableError) return error.canRetry()
  if (error instanceof TimeoutError) return error.retryable
  if (error instanceof CircuitOpenError) return false
  // Default: don't retry unknown errors
  return false
}

/**
 * Get suggested retry delay for an error
 */
export function getRetryDelay(error: unknown, attempt: number = 1): number {
  if (error instanceof RetryableError) {
    return error.getNextDelay()
  }
  if (error instanceof CircuitOpenError) {
    return error.timeUntilResetMs
  }
  // Default exponential backoff
  const baseDelay = 1000
  const delay = baseDelay * Math.pow(2, attempt - 1)
  return Math.min(delay, 30000)
}
