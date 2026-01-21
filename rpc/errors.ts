// Structured Error Types for @dotdo/rpc
// Provides a hierarchy of typed RPC errors with serialization support

/**
 * Standard RPC error codes with semantic meaning
 */
export enum RPCErrorCode {
  // Client errors (4xx)
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  CONFLICT = 'CONFLICT',
  RATE_LIMIT = 'RATE_LIMIT',
  INVALID_PARAMS = 'INVALID_PARAMS', // Alias for VALIDATION_ERROR (backward compat)

  // Server errors (5xx)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  CIRCUIT_OPEN = 'CIRCUIT_OPEN',
}

/**
 * Mapping from error codes to HTTP status codes
 */
const ERROR_CODE_TO_HTTP_STATUS: Record<RPCErrorCode, number> = {
  [RPCErrorCode.NOT_FOUND]: 404,
  [RPCErrorCode.VALIDATION_ERROR]: 400,
  [RPCErrorCode.AUTHENTICATION_ERROR]: 401,
  [RPCErrorCode.AUTHORIZATION_ERROR]: 403,
  [RPCErrorCode.CONFLICT]: 409,
  [RPCErrorCode.RATE_LIMIT]: 429,
  [RPCErrorCode.INVALID_PARAMS]: 400,
  [RPCErrorCode.INTERNAL_ERROR]: 500,
  [RPCErrorCode.TIMEOUT]: 504,
  [RPCErrorCode.NETWORK_ERROR]: 503,
  [RPCErrorCode.SERVICE_UNAVAILABLE]: 503,
  [RPCErrorCode.CIRCUIT_OPEN]: 503,
}

/**
 * Options for creating an RPC error
 */
export interface RPCErrorOptions {
  cause?: Error
}

/**
 * Base RPC Error class with code, message, details, and HTTP status
 */
export class RPCError extends Error {
  public readonly httpStatus: number

  constructor(
    public readonly code: RPCErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    options?: RPCErrorOptions
  ) {
    super(message, options)
    this.name = 'RPCError'
    this.httpStatus = ERROR_CODE_TO_HTTP_STATUS[code] ?? 500
    Object.setPrototypeOf(this, new.target.prototype)
  }

  toJSON(): SerializedError {
    const result: SerializedError = {
      type: this.constructor.name,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
    }
    if (this.details !== undefined) {
      result.details = this.details
    }
    return result
  }
}

// ============================================================================
// Specific Error Types
// ============================================================================

/**
 * Resource not found error (404)
 */
export class NotFoundError extends RPCError {
  constructor(message = 'Resource not found', details?: Record<string, unknown>, options?: RPCErrorOptions) {
    super(RPCErrorCode.NOT_FOUND, message, details, options)
    this.name = 'NotFoundError'
  }

  /**
   * Create a NotFoundError for a specific resource type and ID
   */
  static forResource(resourceType: string, resourceId: string): NotFoundError {
    return new NotFoundError(
      `${resourceType} with id ${resourceId} not found`,
      { resourceType, resourceId }
    )
  }
}

/**
 * Validation error for invalid input (400)
 */
export class ValidationError extends RPCError {
  constructor(message = 'Validation failed', details?: Record<string, unknown>, options?: RPCErrorOptions) {
    super(RPCErrorCode.VALIDATION_ERROR, message, details, options)
    this.name = 'ValidationError'
  }

  /**
   * Create a ValidationError with multiple field errors
   */
  static withErrors(errors: Array<{ field: string; message: string }>): ValidationError {
    const messages = errors.map((e) => `${e.field}: ${e.message}`).join(', ')
    return new ValidationError(`Validation failed: ${messages}`, { errors })
  }

  /**
   * Create a ValidationError for a single field
   */
  static forField(field: string, constraint: string, value?: unknown): ValidationError {
    return new ValidationError(
      `Validation failed: ${field} ${constraint}`,
      { field, constraint, value }
    )
  }
}

/**
 * Authentication error (401)
 */
export class AuthenticationError extends RPCError {
  constructor(message = 'Authentication required', details?: Record<string, unknown>, options?: RPCErrorOptions) {
    super(RPCErrorCode.AUTHENTICATION_ERROR, message, details, options)
    this.name = 'AuthenticationError'
  }

  static tokenExpired(): AuthenticationError {
    return new AuthenticationError('Authentication token has expired', { reason: 'token_expired' })
  }

  static invalidCredentials(): AuthenticationError {
    return new AuthenticationError('Invalid credentials', { reason: 'invalid_credentials' })
  }

  static missingToken(): AuthenticationError {
    return new AuthenticationError('Authentication token is required', { reason: 'missing_token' })
  }
}

/**
 * Authorization error (403)
 */
export class AuthorizationError extends RPCError {
  constructor(message = 'Access denied', details?: Record<string, unknown>, options?: RPCErrorOptions) {
    super(RPCErrorCode.AUTHORIZATION_ERROR, message, details, options)
    this.name = 'AuthorizationError'
  }

  static insufficientPermissions(action: string, resource: string, requiredRoles?: string[]): AuthorizationError {
    return new AuthorizationError(
      `Insufficient permissions to ${action} ${resource}`,
      { action, resource, requiredRoles }
    )
  }
}

/**
 * Conflict error for resource conflicts (409)
 */
export class ConflictError extends RPCError {
  constructor(message = 'Resource conflict', details?: Record<string, unknown>, options?: RPCErrorOptions) {
    super(RPCErrorCode.CONFLICT, message, details, options)
    this.name = 'ConflictError'
  }

  static resourceExists(resourceType: string, conflictField: string, conflictValue: unknown): ConflictError {
    return new ConflictError(
      `${resourceType} with ${conflictField} "${conflictValue}" already exists`,
      { resourceType, conflictField, conflictValue }
    )
  }

  static versionMismatch(
    resourceType: string,
    resourceId: string,
    expectedVersion: number,
    actualVersion: number
  ): ConflictError {
    return new ConflictError(
      `Version mismatch for ${resourceType} ${resourceId}: expected ${expectedVersion}, got ${actualVersion}`,
      { resourceType, resourceId, expectedVersion, actualVersion }
    )
  }
}

/**
 * Rate limit exceeded error (429)
 */
export class RateLimitError extends RPCError {
  constructor(message = 'Rate limit exceeded', details?: Record<string, unknown>, options?: RPCErrorOptions) {
    super(RPCErrorCode.RATE_LIMIT, message, details, options)
    this.name = 'RateLimitError'
  }

  static exceeded(info: { limit: number; window: string; retryAfter?: number }): RateLimitError {
    const retryMsg = info.retryAfter ? ` Retry after ${info.retryAfter}s.` : ''
    return new RateLimitError(
      `Rate limit of ${info.limit} requests per ${info.window} exceeded.${retryMsg}`,
      info
    )
  }
}

/**
 * Timeout error (504)
 */
export class TimeoutError extends RPCError {
  constructor(message = 'Request timed out', details?: Record<string, unknown>, options?: RPCErrorOptions) {
    super(RPCErrorCode.TIMEOUT, message, details, options)
    this.name = 'TimeoutError'
  }

  static afterMs(timeout: number): TimeoutError {
    return new TimeoutError(`Request timed out after ${timeout}ms`, { timeout })
  }
}

/**
 * Network error (503)
 */
export class NetworkError extends RPCError {
  constructor(message = 'Network error', details?: Record<string, unknown>, options?: RPCErrorOptions) {
    super(RPCErrorCode.NETWORK_ERROR, message, details, options)
    this.name = 'NetworkError'
  }

  static connectionRefused(host: string, port: number): NetworkError {
    return new NetworkError(`Connection refused to ${host}:${port}`, {
      host,
      port,
      reason: 'connection_refused',
    })
  }

  static dnsResolutionFailed(host: string): NetworkError {
    return new NetworkError(`DNS resolution failed for ${host}`, {
      host,
      reason: 'dns_resolution_failed',
    })
  }
}

/**
 * Internal server error (500)
 */
export class InternalError extends RPCError {
  constructor(message = 'Internal error', details?: Record<string, unknown>, options?: RPCErrorOptions) {
    super(RPCErrorCode.INTERNAL_ERROR, message, details, options)
    this.name = 'InternalError'
  }

  static wrap(error: unknown): InternalError {
    if (error instanceof Error) {
      return new InternalError(`Internal error: ${error.message}`, undefined, { cause: error })
    }
    return new InternalError(`Internal error: ${String(error)}`)
  }
}

/**
 * Service unavailable error (503)
 */
export class ServiceUnavailableError extends RPCError {
  constructor(
    message = 'Service temporarily unavailable',
    details?: Record<string, unknown>,
    options?: RPCErrorOptions
  ) {
    super(RPCErrorCode.SERVICE_UNAVAILABLE, message, details, options)
    this.name = 'ServiceUnavailableError'
  }

  static maintenance(estimatedRecovery?: string): ServiceUnavailableError {
    return new ServiceUnavailableError('Service is under maintenance', {
      reason: 'maintenance',
      estimatedRecovery,
    })
  }
}

/**
 * Circuit breaker open error (503)
 * Thrown when the circuit breaker is in open state and rejecting requests.
 * This error is retryable - the circuit may transition to half-open after the timeout.
 */
export class CircuitOpenError extends RPCError {
  constructor(
    message = 'Circuit breaker is open',
    details?: Record<string, unknown>,
    options?: RPCErrorOptions
  ) {
    super(RPCErrorCode.CIRCUIT_OPEN, message, details, options)
    this.name = 'CircuitOpenError'
  }

  /**
   * Create a CircuitOpenError with metrics about the circuit state
   */
  static withMetrics(metrics: {
    consecutiveFailures: number
    lastFailureTime: number | null
    resetTimeMs?: number
  }): CircuitOpenError {
    const retryAfter =
      metrics.lastFailureTime && metrics.resetTimeMs
        ? Math.max(0, Math.ceil((metrics.lastFailureTime + metrics.resetTimeMs - Date.now()) / 1000))
        : undefined
    return new CircuitOpenError('Circuit breaker is open - service is experiencing failures', {
      consecutiveFailures: metrics.consecutiveFailures,
      lastFailureTime: metrics.lastFailureTime,
      retryAfter,
    })
  }
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is an RPCError
 */
export function isRPCError(error: unknown): error is RPCError {
  return error instanceof RPCError
}

/**
 * Check if an error is a NotFoundError
 */
export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError
}

/**
 * Check if an error is a ValidationError
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError
}

/**
 * Check if an error is an AuthenticationError
 */
export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError
}

/**
 * Check if an error is an AuthorizationError
 */
export function isAuthorizationError(error: unknown): error is AuthorizationError {
  return error instanceof AuthorizationError
}

/**
 * Check if an error is a CircuitOpenError
 */
export function isCircuitOpenError(error: unknown): error is CircuitOpenError {
  return error instanceof CircuitOpenError
}

/**
 * Check if an error is retryable
 *
 * Checks in order:
 * 1. Custom errors with explicit `retriable` property (definitive)
 * 2. RPCError types with non-retryable codes (ValidationError, AuthN/AuthZ, NotFound)
 * 3. RPCError types with retryable codes (NetworkError, Timeout, etc.)
 * 4. Generic errors default to false (not retryable) - be explicit about retries
 *
 * This philosophy follows "only retry known transient errors"
 * Use NetworkError, TimeoutError, or set retriable=true for transient failures
 */
export function isRetryableError(error: unknown): boolean {
  // Check for explicit retriable property on any error (definitive answer)
  if (error && typeof error === 'object' && 'retriable' in error) {
    return (error as { retriable: boolean }).retriable
  }

  // RPCError-based errors check the error code
  if (error instanceof RPCError) {
    // Explicitly retryable codes (transient errors that may succeed on retry)
    const retryableCodes: RPCErrorCode[] = [
      RPCErrorCode.NETWORK_ERROR,
      RPCErrorCode.TIMEOUT,
      RPCErrorCode.RATE_LIMIT,
      RPCErrorCode.SERVICE_UNAVAILABLE,
      RPCErrorCode.CIRCUIT_OPEN,
    ]
    if (retryableCodes.includes(error.code)) {
      return true
    }

    // All other RPCErrors (including INTERNAL_ERROR) are not retryable by default
    return false
  }

  // Generic errors are NOT retryable by default
  // If you need retry behavior, use NetworkError/TimeoutError or set retriable=true
  return false
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialized error format for transmission across boundaries
 */
export interface SerializedError {
  /** Error type name (e.g., 'NotFoundError') */
  type: string
  /** Error name (alias for type, for backward compatibility) */
  name?: string
  /** Error code for programmatic handling */
  code: RPCErrorCode | string
  /** Human-readable error message */
  message: string
  /** Additional error details */
  details?: Record<string, unknown>
  /** HTTP status code */
  httpStatus?: number
  /** Stack trace (optional) */
  stack?: string
}

/**
 * Options for error serialization
 */
export interface SerializeErrorOptions {
  /** Include stack trace in serialized output (default: true) */
  includeStack?: boolean
}

/**
 * Type for error subclass constructors in the registry
 * All RPCError subclasses use (message, details?, options?) signature
 */
type RPCErrorSubclassConstructor = new (
  message: string,
  details?: Record<string, unknown>,
  options?: RPCErrorOptions
) => RPCError

/**
 * Registry of error constructors for deserialization
 * Note: RPCError itself is not in this registry because it has a different constructor signature
 * (requires error code as first parameter). It's handled as a fallback in deserializeError.
 */
const ERROR_REGISTRY: Record<string, RPCErrorSubclassConstructor> = {
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  RateLimitError,
  TimeoutError,
  NetworkError,
  InternalError,
  ServiceUnavailableError,
  CircuitOpenError,
}

/**
 * Serialize an error for transmission across boundaries
 *
 * Handles RPCError, standard Error, and unknown error types
 */
export function serializeError(error: Error | RPCError, options: SerializeErrorOptions = {}): SerializedError {
  const { includeStack = true } = options

  const serialized: SerializedError = {
    type: error.name,
    name: error.name, // Backward compatibility
    code: error instanceof RPCError ? error.code : RPCErrorCode.INTERNAL_ERROR,
    message: error.message,
  }

  if (error instanceof RPCError) {
    if (error.details !== undefined) {
      serialized.details = error.details
    }
    serialized.httpStatus = error.httpStatus
  }

  if (includeStack && error.stack) {
    serialized.stack = error.stack
  }

  return serialized
}

/**
 * Serialize any value as an error for transmission
 *
 * This is the recommended entry point for error serialization as it handles:
 * - RPCError instances (with code, details, httpStatus)
 * - Standard Error instances (with stack trace)
 * - Unknown values (converted to string message)
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOperation()
 * } catch (error) {
 *   return c.json(serializeUnknownError(error), 500)
 * }
 * ```
 */
export function serializeUnknownError(error: unknown, options: SerializeErrorOptions = {}): SerializedError {
  if (error instanceof RPCError) {
    return serializeError(error, options)
  }

  if (error instanceof Error) {
    return serializeError(error, options)
  }

  // Handle non-Error values (strings, objects, null, undefined, etc.)
  return {
    type: 'UnknownError',
    name: 'UnknownError',
    code: RPCErrorCode.INTERNAL_ERROR,
    message: String(error),
    httpStatus: 500,
  }
}

/**
 * Extract error message from an unknown error value
 *
 * Convenience function for the common pattern:
 * `error instanceof Error ? error.message : String(error)`
 *
 * @example
 * ```typescript
 * catch (error) {
 *   console.error('Operation failed:', getErrorMessage(error))
 * }
 * ```
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Type guard to check if an object is a SerializedError
 *
 * This is useful when receiving error responses from cross-DO RPC calls
 * to determine if the response body contains a structured error that can
 * be deserialized back into an RPCError.
 *
 * @example
 * ```typescript
 * const errorBody = await response.json().catch(() => null)
 * if (errorBody && isSerializedError(errorBody)) {
 *   throw deserializeError(errorBody)
 * }
 * ```
 */
export function isSerializedError(value: unknown): value is SerializedError {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  // Must have a message (required for all errors)
  if (typeof obj.message !== 'string') {
    return false
  }

  // Must have either 'type' or 'name' (for error class identification)
  const hasType = typeof obj.type === 'string'
  const hasName = typeof obj.name === 'string'
  if (!hasType && !hasName) {
    return false
  }

  // Optional fields must be correct types if present
  if (obj.code !== undefined && typeof obj.code !== 'string') {
    return false
  }
  if (obj.httpStatus !== undefined && typeof obj.httpStatus !== 'number') {
    return false
  }
  if (obj.details !== undefined && typeof obj.details !== 'object') {
    return false
  }
  if (obj.stack !== undefined && typeof obj.stack !== 'string') {
    return false
  }

  return true
}

/**
 * Deserialize an error received from across boundaries
 */
export function deserializeError(serialized: SerializedError): Error | RPCError {
  // Support both 'type' and 'name' fields for backward compatibility
  const errorType = serialized.type ?? serialized.name ?? 'Error'

  // Handle generic Error (not an RPCError)
  if (errorType === 'Error' && !serialized.code) {
    const error = new Error(serialized.message)
    error.name = 'Error'
    if (serialized.stack) {
      error.stack = serialized.stack
    }
    return error
  }

  const ErrorClass = ERROR_REGISTRY[errorType]

  if (ErrorClass && errorType !== 'RPCError') {
    const error = new ErrorClass(serialized.message, serialized.details)
    if (serialized.stack) {
      error.stack = serialized.stack
    }
    return error
  }

  // Fallback to base RPCError
  const error = new RPCError(
    (serialized.code as RPCErrorCode) ?? RPCErrorCode.INTERNAL_ERROR,
    serialized.message,
    serialized.details
  )

  if (serialized.stack) {
    error.stack = serialized.stack
  }

  return error
}

// ============================================================================
// Retry and Circuit Breaker (preserved from original)
// ============================================================================

/**
 * Options for retry with backoff
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay?: number
  /** Backoff multiplier (default: 2) */
  backoffFactor?: number
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay?: number
  /** Add random jitter to delays (default: false) */
  jitter?: boolean
}

/**
 * Retry a function with exponential backoff
 *
 * @throws {ValidationError} If maxRetries is negative
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    backoffFactor = 2,
    maxDelay = 30000,
    jitter = false,
  } = options

  // Validate maxRetries to prevent infinite loop or unexpected behavior
  if (maxRetries < 0) {
    throw new ValidationError('maxRetries must be >= 0', {
      field: 'maxRetries',
      value: maxRetries,
      constraint: 'non-negative integer',
    })
  }

  let lastError: unknown
  let attempt = 0

  while (attempt <= maxRetries) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      attempt++

      // Don't retry if not retryable or if we've exhausted retries
      if (!isRetryableError(error) || attempt > maxRetries) {
        throw error
      }

      // Calculate delay with exponential backoff
      let delay = Math.min(initialDelay * Math.pow(backoffFactor, attempt - 1), maxDelay)

      // Add jitter if requested (0-25% added to prevent thundering herd)
      if (jitter) {
        const jitterFactor = 0.25
        delay = delay * (1 + Math.random() * jitterFactor)
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

/**
 * Circuit breaker states
 * @coverage tested in rpc/tests/errors.test.ts - CircuitBreaker suite
 */
export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit breaker options
 */
export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening circuit (default: 5) */
  failureThreshold?: number
  /** Number of successful requests to close circuit from half-open (default: 2) */
  successThreshold?: number
  /** Time in milliseconds before attempting to close circuit (default: 60000) */
  timeout?: number
}

/**
 * Circuit breaker metrics
 */
export interface CircuitMetrics {
  state: CircuitState
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  consecutiveFailures: number
  lastFailureTime: number | null
}

/**
 * Circuit Breaker pattern implementation
 * Prevents cascading failures by stopping requests when a threshold is reached
 * @coverage tested in rpc/tests/errors.test.ts - CircuitBreaker suite (all state transitions, metrics, reset)
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED
  private failureCount = 0
  private successCount = 0
  private consecutiveFailures = 0
  private lastFailureTime: number | null = null
  private totalRequests = 0
  private successfulRequests = 0
  private failedRequests = 0

  private readonly failureThreshold: number
  private readonly successThreshold: number
  private readonly timeout: number

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5
    this.successThreshold = options.successThreshold ?? 2
    this.timeout = options.timeout ?? 60000
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++

    // Check if circuit should transition from OPEN to HALF_OPEN
    if (
      this.state === CircuitState.OPEN &&
      this.lastFailureTime &&
      Date.now() - this.lastFailureTime >= this.timeout
    ) {
      this.state = CircuitState.HALF_OPEN
      this.successCount = 0
    }

    // Reject immediately if circuit is open
    if (this.state === CircuitState.OPEN) {
      this.failedRequests++
      throw CircuitOpenError.withMetrics({
        consecutiveFailures: this.consecutiveFailures,
        lastFailureTime: this.lastFailureTime,
        resetTimeMs: this.timeout,
      })
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.successfulRequests++
    this.consecutiveFailures = 0

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++
      if (this.successCount >= this.successThreshold) {
        this.state = CircuitState.CLOSED
        this.failureCount = 0
        this.successCount = 0
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.failedRequests++
    this.failureCount++
    this.consecutiveFailures++
    this.lastFailureTime = Date.now()

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open reopens the circuit
      this.state = CircuitState.OPEN
    } else if (this.state === CircuitState.CLOSED) {
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.state = CircuitState.OPEN
      }
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state
  }

  /**
   * Get circuit breaker metrics
   */
  getMetrics(): CircuitMetrics {
    return {
      state: this.state,
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTime: this.lastFailureTime,
    }
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED
    this.failureCount = 0
    this.successCount = 0
    this.consecutiveFailures = 0
    this.lastFailureTime = null
  }
}

/**
 * Wrap a promise with a timeout
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(TimeoutError.afterMs(timeoutMs))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeoutHandle!)
  }
}

// ============================================================================
// Client-Side Error Handling Helpers
// ============================================================================

/**
 * Options for handling HTTP error responses
 */
export interface HandleHTTPErrorOptions {
  /** Status code from HTTP response */
  status: number
  /** Correlation ID for tracing */
  correlationId?: string
  /** Custom fallback error message */
  fallbackMessage?: string
}

/**
 * Handle HTTP error responses by attempting to deserialize structured error format.
 *
 * This consolidates the pattern used across RPC clients for error handling:
 * 1. Try to parse the response as JSON
 * 2. Check if it's a valid SerializedError with code and message
 * 3. Deserialize to throw the proper RPCError type
 * 4. If already an RPCError, re-throw it
 * 5. Fall back to generic error with status code
 *
 * @example
 * ```typescript
 * try {
 *   const response = await fetch(url)
 *   if (!response.ok) {
 *     await handleHTTPError(response.json(), {
 *       status: response.status,
 *       correlationId,
 *       fallbackMessage: `RPC error: ${response.status}`
 *     })
 *   }
 * } catch (error) {
 *   // Handle error appropriately
 * }
 * ```
 */
export async function handleHTTPError(
  jsonPromise: Promise<unknown>,
  options: HandleHTTPErrorOptions
): Promise<never> {
  const { status, correlationId, fallbackMessage = `HTTP error: ${status}` } = options

  try {
    const errorBody = await jsonPromise as SerializedError & { correlationId?: string }
    // Check if it's a structured error (has both code and message)
    if (errorBody && typeof errorBody === 'object' && 'code' in errorBody && 'message' in errorBody) {
      throw deserializeError(errorBody)
    }
  } catch (e) {
    // If it's already an RPCError from deserialization, re-throw it
    if (isRPCError(e)) {
      throw e
    }
    // If JSON parsing failed or structure doesn't match, continue to fallback
  }

  // Fallback to generic error with status code and correlation ID
  const message = correlationId ? `${fallbackMessage} [${correlationId}]` : fallbackMessage
  throw new Error(message)
}

/**
 * Internal helper to handle HTTP error responses in a Response object context.
 * This version works directly with Response objects instead of promises.
 *
 * @internal
 */
export async function handleResponseError(
  response: Response,
  options: HandleHTTPErrorOptions
): Promise<never> {
  const { status, correlationId, fallbackMessage = `HTTP error: ${status}` } = options

  try {
    const errorBody = await response.json() as SerializedError & { correlationId?: string }
    // Check if it's a structured error (has both code and message)
    if (errorBody && typeof errorBody === 'object' && 'code' in errorBody && 'message' in errorBody) {
      throw deserializeError(errorBody)
    }
  } catch (e) {
    // If it's already an RPCError from deserialization, re-throw it
    if (isRPCError(e)) {
      throw e
    }
    // If JSON parsing failed or structure doesn't match, continue to fallback
  }

  // Fallback to generic error with status code and correlation ID
  const message = correlationId ? `${fallbackMessage} [${correlationId}]` : fallbackMessage
  throw new Error(message)
}

// ============================================================================
// Server-Side Error Handling Helpers
// ============================================================================

/**
 * Options for serializing and sending error responses
 */
export interface ErrorResponseOptions {
  /** Whether to include stack trace (default: false for production) */
  includeStack?: boolean
  /** Correlation ID to include in response */
  correlationId?: string
}

/**
 * Serialize an error for sending as an HTTP response.
 *
 * This consolidates the pattern used across RPC servers for error responses:
 * 1. Check if it's an RPCError and serialize with proper status
 * 2. Otherwise wrap unknown errors in InternalError and serialize
 *
 * @example
 * ```typescript
 * try {
 *   // do something
 * } catch (error) {
 *   const { serialized, statusCode } = serializeErrorResponse(error, {
 *     includeStack: false,
 *     correlationId
 *   })
 *   return c.json(serialized, statusCode)
 * }
 * ```
 */
export function serializeErrorResponse(
  error: unknown,
  options: ErrorResponseOptions = {}
): { serialized: SerializedError & { correlationId?: string }; statusCode: number } {
  const { includeStack = false, correlationId } = options

  let rpcError: RPCError
  if (isRPCError(error)) {
    rpcError = error
  } else {
    rpcError = InternalError.wrap(error)
  }

  const serialized = {
    ...serializeError(rpcError, { includeStack }),
    ...(correlationId && { correlationId }),
  }

  return {
    serialized,
    statusCode: rpcError.httpStatus,
  }
}

/**
 * Create a serialized error response object for inline error responses.
 *
 * This is a convenience function for creating error responses with correlation ID
 * in a single step, useful for returning error responses in RPC endpoints.
 *
 * @example
 * ```typescript
 * const error = new ValidationError('Invalid input')
 * return c.json(
 *   createErrorResponse(error, correlationId),
 *   error.httpStatus
 * )
 * ```
 */
export function createErrorResponse(
  error: RPCError,
  correlationId?: string,
  includeStack = false
): SerializedError & { correlationId?: string } {
  return {
    ...serializeError(error, { includeStack }),
    ...(correlationId && { correlationId }),
  }
}

// ============================================================================
// Retry with Circuit Breaker
// ============================================================================

/**
 * Options for retry with circuit breaker
 */
export interface RetryWithCircuitBreakerOptions {
  /** Retry options */
  retry?: RetryOptions
  /** Circuit breaker options */
  circuitBreaker?: CircuitBreakerOptions
  /** Optional callback for observing state transitions */
  onStateChange?: ((newState: CircuitState, metrics: CircuitMetrics) => void) | undefined
}

/**
 * Combined retry and circuit breaker metrics
 */
export interface RetryCircuitBreakerMetrics extends CircuitMetrics {
  /** Total number of retry attempts across all requests */
  totalRetryAttempts: number
  /** Last retry delay used */
  lastRetryDelayMs: number | null
}

/**
 * Combines retry with exponential backoff and circuit breaker patterns.
 *
 * This class provides a robust error handling strategy for distributed systems:
 * - Retries transient failures with exponential backoff and jitter
 * - Opens circuit after consecutive failures to fail fast
 * - Transitions to half-open state after timeout to test recovery
 * - Closes circuit after successful requests in half-open state
 *
 * The circuit breaker wraps the retry logic, so:
 * 1. If circuit is OPEN, requests fail immediately with CircuitOpenError
 * 2. If circuit is CLOSED or HALF_OPEN, retries are attempted
 * 3. After all retries fail, failure is recorded and circuit may open
 *
 * @coverage tested in rpc/tests/errors.test.ts - RetryWithCircuitBreaker suite (all state transitions, metrics, onStateChange callbacks)
 *
 * @example
 * ```typescript
 * const resilientClient = new RetryWithCircuitBreaker({
 *   retry: {
 *     maxRetries: 3,
 *     initialDelay: 100,
 *     maxDelay: 5000,
 *     jitter: true,
 *   },
 *   circuitBreaker: {
 *     failureThreshold: 5,
 *     successThreshold: 2,
 *     timeout: 30000, // 30 seconds
 *   },
 *   onStateChange: (state, metrics) => {
 *     console.log(`Circuit state changed to ${state}`, metrics)
 *   },
 * })
 *
 * // Use for RPC calls
 * const result = await resilientClient.execute(() => rpcClient.someMethod())
 * ```
 */
export class RetryWithCircuitBreaker {
  private readonly circuitBreaker: CircuitBreaker
  private readonly retryOptions: Required<RetryOptions>
  private readonly onStateChange?: ((newState: CircuitState, metrics: CircuitMetrics) => void) | undefined
  private lastState: CircuitState = CircuitState.CLOSED
  private totalRetryAttempts = 0
  private lastRetryDelayMs: number | null = null

  constructor(options: RetryWithCircuitBreakerOptions = {}) {
    const maxRetries = options.retry?.maxRetries ?? 3

    // Validate maxRetries to prevent infinite loop or unexpected behavior
    if (maxRetries < 0) {
      throw new ValidationError('maxRetries must be >= 0', {
        field: 'maxRetries',
        value: maxRetries,
        constraint: 'non-negative integer',
      })
    }

    this.circuitBreaker = new CircuitBreaker(options.circuitBreaker)
    this.retryOptions = {
      maxRetries,
      initialDelay: options.retry?.initialDelay ?? 1000,
      backoffFactor: options.retry?.backoffFactor ?? 2,
      maxDelay: options.retry?.maxDelay ?? 30000,
      jitter: options.retry?.jitter ?? true, // Default to true for distributed systems
    }
    this.onStateChange = options.onStateChange
  }

  /**
   * Execute a function with retry and circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check for state change before execution
    this.checkStateChange()

    try {
      // Circuit breaker wraps the retry logic
      const result = await this.circuitBreaker.execute(async () => {
        return this.executeWithRetry(fn)
      })
      // Check for state change after success
      this.checkStateChange()
      return result
    } catch (error) {
      // Check for state change after failure (circuit may have opened)
      this.checkStateChange()
      throw error
    }
  }

  /**
   * Internal retry logic with exponential backoff
   */
  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    const { maxRetries, initialDelay, backoffFactor, maxDelay, jitter } = this.retryOptions

    let lastError: unknown
    let attempt = 0

    while (attempt <= maxRetries) {
      try {
        const result = await fn()
        // Check for state change after success
        this.checkStateChange()
        return result
      } catch (error) {
        lastError = error
        attempt++
        this.totalRetryAttempts++

        // Don't retry if not retryable or if we've exhausted retries
        if (!isRetryableError(error) || attempt > maxRetries) {
          // Check for state change after final failure
          this.checkStateChange()
          throw error
        }

        // Calculate delay with exponential backoff
        let delay = Math.min(initialDelay * Math.pow(backoffFactor, attempt - 1), maxDelay)

        // Add jitter if requested (0-25% added to prevent thundering herd)
        if (jitter) {
          const jitterFactor = 0.25
          delay = delay * (1 + Math.random() * jitterFactor)
        }

        this.lastRetryDelayMs = delay

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    throw lastError
  }

  /**
   * Check and notify state changes
   */
  private checkStateChange(): void {
    const currentState = this.circuitBreaker.getState()
    if (currentState !== this.lastState) {
      this.lastState = currentState
      this.onStateChange?.(currentState, this.circuitBreaker.getMetrics())
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.circuitBreaker.getState()
  }

  /**
   * Get combined metrics
   */
  getMetrics(): RetryCircuitBreakerMetrics {
    return {
      ...this.circuitBreaker.getMetrics(),
      totalRetryAttempts: this.totalRetryAttempts,
      lastRetryDelayMs: this.lastRetryDelayMs,
    }
  }

  /**
   * Manually reset the circuit breaker and retry metrics
   */
  reset(): void {
    this.circuitBreaker.reset()
    this.totalRetryAttempts = 0
    this.lastRetryDelayMs = null
    this.lastState = CircuitState.CLOSED
  }

  /**
   * Check if circuit is currently allowing requests
   */
  isAllowingRequests(): boolean {
    const state = this.circuitBreaker.getState()
    return state === CircuitState.CLOSED || state === CircuitState.HALF_OPEN
  }
}
