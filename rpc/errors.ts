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
    return {
      type: this.constructor.name,
      code: this.code,
      message: this.message,
      details: this.details,
      httpStatus: this.httpStatus,
    }
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
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof RPCError)) {
    return false
  }

  const retryableCodes: RPCErrorCode[] = [
    RPCErrorCode.NETWORK_ERROR,
    RPCErrorCode.TIMEOUT,
    RPCErrorCode.RATE_LIMIT,
    RPCErrorCode.SERVICE_UNAVAILABLE,
  ]

  return retryableCodes.includes(error.code)
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
}

/**
 * Serialize an error for transmission across boundaries
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
    serialized.details = error.details
    serialized.httpStatus = error.httpStatus
  }

  if (includeStack && error.stack) {
    serialized.stack = error.stack
  }

  return serialized
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
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    backoffFactor = 2,
    maxDelay = 30000,
    jitter = false,
  } = options

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

      // Add jitter if requested
      if (jitter) {
        delay = delay * (0.5 + Math.random() * 0.5)
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

/**
 * Circuit breaker states
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
  private resetTimer: ReturnType<typeof setTimeout> | null = null

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
      throw new ServiceUnavailableError('Circuit breaker is open', {
        state: this.state,
        failures: this.consecutiveFailures,
        lastFailureTime: this.lastFailureTime,
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
      this.scheduleReset()
    } else if (this.state === CircuitState.CLOSED) {
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.state = CircuitState.OPEN
        this.scheduleReset()
      }
    }
  }

  /**
   * Schedule automatic transition to half-open state
   */
  private scheduleReset(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer)
    }
    // Note: Timer will be checked on next execute() call
    // We don't actively schedule here to avoid timer issues in tests
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
    if (this.resetTimer) {
      clearTimeout(this.resetTimer)
      this.resetTimer = null
    }
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
