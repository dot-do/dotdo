// Base Error Classes for @dotdo/rpc
// Provides a hierarchy of typed RPC errors with serialization support

import type { ContentfulStatusCode } from 'hono/utils/http-status'

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
const ERROR_CODE_TO_HTTP_STATUS: Record<RPCErrorCode, ContentfulStatusCode> = {
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
  public readonly httpStatus: ContentfulStatusCode

  constructor(
    public readonly code: RPCErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    options?: RPCErrorOptions
  ) {
    super(message, options)
    this.name = 'RPCError'
    this.httpStatus = ERROR_CODE_TO_HTTP_STATUS[code] ?? (500 as ContentfulStatusCode)
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
 * Transport error for transport-level failures (503)
 * This error is thrown when the underlying transport fails to send a message,
 * such as network connectivity issues, DNS resolution failures, or transport timeouts.
 */
export class TransportError extends RPCError {
  constructor(
    message = 'Transport error',
    details?: Record<string, unknown>,
    options?: RPCErrorOptions
  ) {
    super(RPCErrorCode.NETWORK_ERROR, message, details, options)
    this.name = 'TransportError'
  }

  /**
   * Create a TransportError from an underlying error
   */
  static fromError(error: unknown, transport?: string): TransportError {
    if (error instanceof Error) {
      // Check for abort/timeout errors
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        return new TransportError(
          `Transport timeout: ${error.message}`,
          { transport, reason: 'timeout', originalError: error.name },
          { cause: error }
        )
      }
      // Check for network-related errors
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        return new TransportError(
          `Network error: ${error.message}`,
          { transport, reason: 'network_failure', originalError: error.name },
          { cause: error }
        )
      }
      return new TransportError(
        `Transport error: ${error.message}`,
        { transport, reason: 'unknown', originalError: error.name },
        { cause: error }
      )
    }
    return new TransportError(
      `Transport error: ${String(error)}`,
      { transport, reason: 'unknown' }
    )
  }

  /**
   * Create a TransportError for a fetch failure
   */
  static fetchFailed(url: string, error: Error): TransportError {
    return TransportError.fromError(error, `fetch:${url}`)
  }

  /**
   * Create a TransportError for a WebSocket failure
   */
  static webSocketFailed(url: string, error: Error): TransportError {
    return TransportError.fromError(error, `websocket:${url}`)
  }

  /**
   * Create a TransportError for a DO stub failure
   */
  static stubFailed(error: Error): TransportError {
    return TransportError.fromError(error, 'do-stub')
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
 * Check if an error is a TransportError
 */
export function isTransportError(error: unknown): error is TransportError {
  return error instanceof TransportError
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
  httpStatus?: ContentfulStatusCode
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
  TransportError,
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
    httpStatus: 500 as ContentfulStatusCode,
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
  if (typeof obj['message'] !== 'string') {
    return false
  }

  // Must have either 'type' or 'name' (for error class identification)
  const hasType = typeof obj['type'] === 'string'
  const hasName = typeof obj['name'] === 'string'
  if (!hasType && !hasName) {
    return false
  }

  // Optional fields must be correct types if present
  if (obj['code'] !== undefined && typeof obj['code'] !== 'string') {
    return false
  }
  if (obj['httpStatus'] !== undefined && typeof obj['httpStatus'] !== 'number') {
    return false
  }
  if (obj['details'] !== undefined && typeof obj['details'] !== 'object') {
    return false
  }
  if (obj['stack'] !== undefined && typeof obj['stack'] !== 'string') {
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
