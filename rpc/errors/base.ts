// Base Error Classes for @dotdo/rpc
// Extends @dotdo/db error types for ecosystem consistency
// Provides additional RPC-specific error types and utilities

import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  DotdoError,
  type DotdoErrorOptions,
  type ErrorDetails,
  ErrorCode,
  type ErrorCodeType,
  ERROR_CODE_TO_HTTP_STATUS,
  getHttpStatusForCode,
  isRetryableCode,
  type SerializedDotdoError,
  type SerializeErrorOptions as DbSerializeErrorOptions,
  serializeDotdoError,
  serializeUnknownAsDotdoError,
  deserializeDotdoError,
  isSerializedDotdoError,
  getErrorMessage,
  isRetryableError as dbIsRetryableError,
  registerErrorClass,
} from '../../db/errors'

// =============================================================================
// Re-export base types from @dotdo/db for backward compatibility
// =============================================================================

export {
  ErrorCode,
  type ErrorCodeType,
  type ErrorDetails,
  ERROR_CODE_TO_HTTP_STATUS,
  getHttpStatusForCode,
  isRetryableCode,
  type SerializedDotdoError,
  type DbSerializeErrorOptions,
  getErrorMessage,
  DotdoError,
  type DotdoErrorOptions,
}

/**
 * Standard RPC error codes - alias for ErrorCode for backward compatibility
 * @deprecated Use ErrorCode from @dotdo/db instead
 */
export const RPCErrorCode = {
  // Client errors (4xx)
  NOT_FOUND: ErrorCode.NOT_FOUND,
  VALIDATION_ERROR: ErrorCode.VALIDATION_ERROR,
  AUTHENTICATION_ERROR: ErrorCode.AUTHENTICATION_ERROR,
  AUTHORIZATION_ERROR: ErrorCode.AUTHORIZATION_ERROR,
  CONFLICT: ErrorCode.CONFLICT,
  RATE_LIMIT: ErrorCode.RATE_LIMIT,
  PAYLOAD_TOO_LARGE: ErrorCode.PAYLOAD_TOO_LARGE,
  INVALID_PARAMS: ErrorCode.VALIDATION_ERROR, // Alias for VALIDATION_ERROR (backward compat)

  // Server errors (5xx)
  INTERNAL_ERROR: ErrorCode.INTERNAL_ERROR,
  TIMEOUT: ErrorCode.TIMEOUT,
  NETWORK_ERROR: ErrorCode.NETWORK_ERROR,
  SERVICE_UNAVAILABLE: ErrorCode.SERVICE_UNAVAILABLE,
  CIRCUIT_OPEN: ErrorCode.CIRCUIT_OPEN,
} as const

export type RPCErrorCodeType = (typeof RPCErrorCode)[keyof typeof RPCErrorCode]

/**
 * Options for creating an RPC error
 * Extends DotdoErrorOptions for consistency
 */
export interface RPCErrorOptions {
  cause?: Error
}

/**
 * Base RPC Error class extending DotdoError
 * Maintains backward compatibility while using consistent base
 */
export class RPCError extends DotdoError {
  public readonly httpStatus: ContentfulStatusCode

  constructor(
    code: ErrorCodeType | string,
    message: string,
    details?: ErrorDetails,
    options?: RPCErrorOptions
  ) {
    super(code, message, {
      ...(options?.cause !== undefined && { cause: options.cause }),
      ...(details !== undefined && { details }),
    })
    this.name = 'RPCError'
    this.httpStatus = getHttpStatusForCode(code) as ContentfulStatusCode
  }

  toJSON(): SerializedError {
    const result: SerializedError = {
      type: this.name,
      name: this.name, // Backward compatibility
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
  constructor(message = 'Resource not found', details?: ErrorDetails, options?: RPCErrorOptions) {
    super(ErrorCode.NOT_FOUND, message, details, options)
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
  constructor(message = 'Validation failed', details?: ErrorDetails, options?: RPCErrorOptions) {
    super(ErrorCode.VALIDATION_ERROR, message, details, options)
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
  constructor(message = 'Authentication required', details?: ErrorDetails, options?: RPCErrorOptions) {
    super(ErrorCode.AUTHENTICATION_ERROR, message, details, options)
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
  constructor(message = 'Access denied', details?: ErrorDetails, options?: RPCErrorOptions) {
    super(ErrorCode.AUTHORIZATION_ERROR, message, details, options)
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
  constructor(message = 'Resource conflict', details?: ErrorDetails, options?: RPCErrorOptions) {
    super(ErrorCode.CONFLICT, message, details, options)
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
  constructor(message = 'Rate limit exceeded', details?: ErrorDetails, options?: RPCErrorOptions) {
    super(ErrorCode.RATE_LIMIT, message, details, options)
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
 * Payload too large error (413)
 */
export class PayloadTooLargeError extends RPCError {
  constructor(message = 'Request payload too large', details?: ErrorDetails, options?: RPCErrorOptions) {
    super(ErrorCode.PAYLOAD_TOO_LARGE, message, details, options)
    this.name = 'PayloadTooLargeError'
  }

  /**
   * Create a PayloadTooLargeError with size information
   */
  static exceeded(info: { size: number; maxSize: number; unit?: string }): PayloadTooLargeError {
    const unit = info.unit ?? 'bytes'
    return new PayloadTooLargeError(
      `Request payload size (${info.size} ${unit}) exceeds maximum allowed size (${info.maxSize} ${unit})`,
      { size: info.size, maxSize: info.maxSize, unit }
    )
  }

  /**
   * Create a PayloadTooLargeError with human-readable size information
   */
  static exceededReadable(info: { sizeBytes: number; maxSizeBytes: number }): PayloadTooLargeError {
    const formatSize = (bytes: number): string => {
      if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
      }
      if (bytes >= 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`
      }
      return `${bytes} bytes`
    }
    return new PayloadTooLargeError(
      `Request payload size (${formatSize(info.sizeBytes)}) exceeds maximum allowed size (${formatSize(info.maxSizeBytes)})`,
      { sizeBytes: info.sizeBytes, maxSizeBytes: info.maxSizeBytes }
    )
  }
}

/**
 * Timeout error (504)
 */
export class TimeoutError extends RPCError {
  constructor(message = 'Request timed out', details?: ErrorDetails, options?: RPCErrorOptions) {
    super(ErrorCode.TIMEOUT, message, details, options)
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
  constructor(message = 'Network error', details?: ErrorDetails, options?: RPCErrorOptions) {
    super(ErrorCode.NETWORK_ERROR, message, details, options)
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
  constructor(message = 'Internal error', details?: ErrorDetails, options?: RPCErrorOptions) {
    super(ErrorCode.INTERNAL_ERROR, message, details, options)
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
    details?: ErrorDetails,
    options?: RPCErrorOptions
  ) {
    super(ErrorCode.SERVICE_UNAVAILABLE, message, details, options)
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
    details?: ErrorDetails,
    options?: RPCErrorOptions
  ) {
    super(ErrorCode.NETWORK_ERROR, message, details, options)
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

  /**
   * Create a TransportError when a circuit breaker is open
   */
  static circuitOpen(circuitName: string): TransportError {
    return new TransportError(
      `Circuit breaker "${circuitName}" is open - requests are being rejected`,
      {
        transport: 'circuit-breaker',
        reason: 'circuit_open',
        circuitName,
      }
    )
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
    details?: ErrorDetails,
    options?: RPCErrorOptions
  ) {
    super(ErrorCode.CIRCUIT_OPEN, message, details, options)
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
 * Check if a value is an RPCError (or DotdoError)
 */
export function isRPCError(error: unknown): error is RPCError {
  return error instanceof RPCError || error instanceof DotdoError
}

/**
 * Check if an error is a NotFoundError
 */
export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError || (error instanceof DotdoError && error.code === ErrorCode.NOT_FOUND)
}

/**
 * Check if an error is a ValidationError
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError || (error instanceof DotdoError && error.code === ErrorCode.VALIDATION_ERROR)
}

/**
 * Check if an error is an AuthenticationError
 */
export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError || (error instanceof DotdoError && error.code === ErrorCode.AUTHENTICATION_ERROR)
}

/**
 * Check if an error is an AuthorizationError
 */
export function isAuthorizationError(error: unknown): error is AuthorizationError {
  return error instanceof AuthorizationError || (error instanceof DotdoError && error.code === ErrorCode.AUTHORIZATION_ERROR)
}

/**
 * Check if an error is a PayloadTooLargeError
 */
export function isPayloadTooLargeError(error: unknown): error is PayloadTooLargeError {
  return error instanceof PayloadTooLargeError || (error instanceof DotdoError && error.code === ErrorCode.PAYLOAD_TOO_LARGE)
}

/**
 * Check if an error is a CircuitOpenError
 */
export function isCircuitOpenError(error: unknown): error is CircuitOpenError {
  return error instanceof CircuitOpenError || (error instanceof DotdoError && error.code === ErrorCode.CIRCUIT_OPEN)
}

/**
 * Check if an error is a TransportError
 */
export function isTransportError(error: unknown): error is TransportError {
  return error instanceof TransportError
}

/**
 * Check if an error is retryable
 * Delegates to base implementation from @dotdo/db
 */
export function isRetryableError(error: unknown): boolean {
  return dbIsRetryableError(error)
}

// ============================================================================
// Serialization - Unified with @dotdo/db
// ============================================================================

/**
 * Serialized error format for transmission across boundaries
 * Extends SerializedDotdoError for compatibility
 */
export interface SerializedError extends SerializedDotdoError {
  /** HTTP status code */
  httpStatus?: ContentfulStatusCode
}

/**
 * Options for error serialization
 * Alias for backward compatibility
 */
export type SerializeErrorOptions = DbSerializeErrorOptions

/**
 * Type for error subclass constructors in the registry
 * All RPCError subclasses use (message, details?, options?) signature
 */
type RPCErrorSubclassConstructor = new (
  message: string,
  details?: ErrorDetails,
  options?: RPCErrorOptions
) => RPCError

/**
 * Registry of RPC error constructors for deserialization
 */
const RPC_ERROR_REGISTRY: Record<string, RPCErrorSubclassConstructor> = {
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  RateLimitError,
  PayloadTooLargeError,
  TimeoutError,
  NetworkError,
  InternalError,
  ServiceUnavailableError,
  CircuitOpenError,
  TransportError,
}

// Register RPC error classes with the db error registry for cross-boundary deserialization
for (const [name, ErrorClass] of Object.entries(RPC_ERROR_REGISTRY)) {
  registerErrorClass(name, ErrorClass as unknown as new (message: string, options?: DotdoErrorOptions) => DotdoError)
}

/**
 * Serialize an error for transmission across boundaries
 *
 * Handles RPCError, DotdoError, standard Error, and unknown error types
 */
export function serializeError(error: Error | RPCError | DotdoError, options: SerializeErrorOptions = {}): SerializedError {
  const { includeStack = true } = options

  if (error instanceof RPCError) {
    const serialized = error.toJSON()
    if (includeStack && error.stack) {
      serialized.stack = error.stack
    }
    return serialized
  }

  if (error instanceof DotdoError) {
    return serializeDotdoError(error, options) as SerializedError
  }

  const serialized: SerializedError = {
    type: error.name,
    name: error.name,
    code: ErrorCode.INTERNAL_ERROR,
    message: error.message,
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
 * - DotdoError instances (from @dotdo/db)
 * - Standard Error instances (with stack trace)
 * - Unknown values (converted to string message)
 */
export function serializeUnknownError(error: unknown, options: SerializeErrorOptions = {}): SerializedError {
  if (error instanceof RPCError) {
    return serializeError(error, options)
  }

  if (error instanceof DotdoError) {
    return serializeDotdoError(error, options) as SerializedError
  }

  if (error instanceof Error) {
    return serializeError(error, options)
  }

  // Handle non-Error values
  return {
    type: 'UnknownError',
    name: 'UnknownError',
    code: ErrorCode.INTERNAL_ERROR,
    message: String(error),
    httpStatus: 500 as ContentfulStatusCode,
  }
}

/**
 * Type guard to check if an object is a SerializedError
 * Delegates to @dotdo/db implementation
 */
export function isSerializedError(value: unknown): value is SerializedError {
  return isSerializedDotdoError(value)
}

/**
 * Deserialize an error received from across boundaries
 * Handles both RPC and db error types
 */
export function deserializeError(serialized: SerializedError): Error | RPCError | DotdoError {
  const errorType = serialized.type ?? serialized.name ?? 'Error'

  // Handle generic Error
  if (errorType === 'Error' && !serialized.code) {
    const error = new Error(serialized.message)
    error.name = 'Error'
    if (serialized.stack) {
      error.stack = serialized.stack
    }
    return error
  }

  // Check RPC error registry first (for specific error types)
  const RPCErrorClass = RPC_ERROR_REGISTRY[errorType]
  if (RPCErrorClass) {
    const error = new RPCErrorClass(serialized.message, serialized.details)
    if (serialized.stack) {
      error.stack = serialized.stack
    }
    return error
  }

  // Handle base RPCError type explicitly
  if (errorType === 'RPCError') {
    const error = new RPCError(
      serialized.code ?? ErrorCode.INTERNAL_ERROR,
      serialized.message,
      serialized.details
    )
    if (serialized.stack) {
      error.stack = serialized.stack
    }
    return error
  }

  // Try db error registry via deserializeDotdoError
  const dbError = deserializeDotdoError(serialized)
  if (dbError instanceof DotdoError && !(dbError instanceof Error && dbError.name === 'DotdoError')) {
    return dbError
  }

  // Fallback to base RPCError for RPC-related errors
  const error = new RPCError(
    serialized.code ?? ErrorCode.INTERNAL_ERROR,
    serialized.message,
    serialized.details
  )

  if (serialized.stack) {
    error.stack = serialized.stack
  }

  return error
}

// Re-export getErrorMessage from @dotdo/db (already exported above)

// ============================================================================
// HTTP Error Handling Helpers
// ============================================================================

/**
 * Options for handling HTTP errors
 */
export interface HTTPErrorOptions {
  /** HTTP status code */
  status: number
  /** Fallback error message if no structured error is returned */
  fallbackMessage?: string
  /** Correlation ID for request tracing */
  correlationId?: string
}

/**
 * Handle an HTTP error response by deserializing structured errors
 *
 * @param jsonPromise - Promise that resolves to the JSON body (or rejects on parse error)
 * @param options - HTTP error options
 * @throws The deserialized RPCError or a generic InternalError
 */
export async function handleHTTPError(
  jsonPromise: Promise<unknown>,
  options: HTTPErrorOptions
): Promise<never> {
  const { status, fallbackMessage, correlationId } = options

  try {
    const json = await jsonPromise

    // Check if it's a structured error
    if (isSerializedError(json)) {
      throw deserializeError(json)
    }

    // Not a structured error - create a generic one
    const message = fallbackMessage
      ? correlationId
        ? `${fallbackMessage} [${correlationId}]`
        : fallbackMessage
      : `HTTP error: ${status}`
    throw new InternalError(message)
  } catch (error) {
    // Re-throw RPC errors directly
    if (error instanceof RPCError || error instanceof DotdoError) {
      throw error
    }

    // JSON parsing or other error - create generic error
    const message = fallbackMessage ?? `HTTP error: ${status}`
    throw new InternalError(message)
  }
}

/**
 * Handle an HTTP Response error by parsing the body and deserializing structured errors
 *
 * @param response - The HTTP Response object
 * @param options - HTTP error options
 * @throws The deserialized RPCError or a generic InternalError
 */
export async function handleResponseError(
  response: Response,
  options: HTTPErrorOptions
): Promise<never> {
  try {
    const json = await response.json()
    return handleHTTPError(Promise.resolve(json), options)
  } catch (error) {
    // Re-throw RPC errors directly
    if (error instanceof RPCError || error instanceof DotdoError) {
      throw error
    }

    // JSON parsing failed - create generic error
    const message = options.fallbackMessage ?? `HTTP error: ${options.status}`
    throw new InternalError(message)
  }
}

/**
 * Options for serializing error responses
 */
export interface SerializeErrorResponseOptions {
  /** Include stack trace in response */
  includeStack?: boolean
  /** Correlation ID for request tracing */
  correlationId?: string | undefined
}

/**
 * Result of serializing an error for HTTP response
 */
export interface SerializedErrorResponse {
  /** Serialized error object */
  serialized: SerializedError & { correlationId?: string }
  /** HTTP status code to use for the response */
  statusCode: number
}

/**
 * Serialize an error for an HTTP error response
 *
 * @param error - The error to serialize
 * @param options - Serialization options
 * @returns Object with serialized error and HTTP status code
 */
export function serializeErrorResponse(
  error: unknown,
  options: SerializeErrorResponseOptions = {}
): SerializedErrorResponse {
  const { includeStack = false, correlationId } = options

  // Wrap non-RPCError as InternalError
  let rpcError: RPCError
  if (error instanceof RPCError) {
    rpcError = error
  } else if (error instanceof DotdoError) {
    rpcError = new RPCError(error.code, error.message, error.details)
  } else if (error instanceof Error) {
    rpcError = InternalError.wrap(error)
  } else {
    rpcError = InternalError.wrap(error)
  }

  const serialized = serializeError(rpcError, { includeStack })

  if (correlationId) {
    (serialized as SerializedError & { correlationId?: string }).correlationId = correlationId
  }

  return {
    serialized: serialized as SerializedError & { correlationId?: string },
    statusCode: rpcError.httpStatus,
  }
}

/**
 * Create a serialized error response object (simplified helper)
 *
 * @param error - The error to serialize
 * @param correlationId - Optional correlation ID
 * @param includeStack - Whether to include stack trace
 * @returns Serialized error with optional correlation ID
 */
export function createErrorResponse(
  error: unknown,
  correlationId?: string,
  includeStack = false
): SerializedError & { correlationId?: string } {
  const { serialized } = serializeErrorResponse(error, { includeStack, correlationId })
  return serialized
}
