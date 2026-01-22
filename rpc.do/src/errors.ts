/**
 * @module rpc.do/errors
 *
 * Structured error types for rpc.do RPC communication.
 *
 * This module provides a hierarchy of error classes for structured error handling:
 *
 * - {@link RPCError} - Base error class for all RPC errors
 * - {@link ValidationError} - Input validation failures
 * - {@link NotFoundError} - Resource or method not found
 * - {@link AuthError} - Authentication/authorization failures
 * - {@link NetworkError} - Network/transport failures
 * - {@link TimeoutError} - Request timeout errors
 *
 * All errors support:
 * - Error codes for programmatic handling
 * - HTTP status codes for REST compatibility
 * - Optional metadata/details for debugging
 * - Serialization to JSON for RPC transport
 *
 * @example
 * ```typescript
 * import { NotFoundError, ValidationError, RPCError } from 'rpc.do'
 *
 * // Throw structured errors
 * throw new NotFoundError('User not found', 'USER_NOT_FOUND', { userId: '123' })
 *
 * // Check error types
 * if (error instanceof ValidationError) {
 *   console.log('Validation failed:', error.details)
 * }
 *
 * // Serialize for RPC transport
 * const serialized = error.toJSON()
 * // { type: 'NotFoundError', code: 'USER_NOT_FOUND', message: 'User not found', ... }
 * ```
 */

import type { SerializedError } from './types'

/**
 * Standard error codes for RPC errors.
 */
export const ErrorCode = {
  // Generic errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',

  // Validation errors
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',

  // Not found errors
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  PATH_NOT_FOUND: 'PATH_NOT_FOUND',

  // Auth errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',

  // Network errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  TRANSPORT_FAILED: 'TRANSPORT_FAILED',
  CONNECTION_CLOSED: 'CONNECTION_CLOSED',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',

  // Timeout errors
  TIMEOUT: 'TIMEOUT',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
} as const

/**
 * Type representing any valid error code from the ErrorCode constants.
 */
export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode]

/**
 * HTTP status code mapping for error types.
 */
export const ErrorHttpStatus = {
  // 4xx Client Errors
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  TIMEOUT: 408,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,

  // 5xx Server Errors
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const

/**
 * Type representing any valid HTTP status code from the ErrorHttpStatus constants.
 */
export type ErrorHttpStatusType = (typeof ErrorHttpStatus)[keyof typeof ErrorHttpStatus]

/**
 * Base error class for all RPC errors.
 *
 * RPCError extends the standard Error with:
 * - Error codes for programmatic handling
 * - HTTP status codes for REST compatibility
 * - Optional metadata/details for debugging
 * - JSON serialization for RPC transport
 *
 * @example
 * ```typescript
 * const error = new RPCError('Something went wrong', 'INTERNAL_ERROR', 500, { context: 'processing' })
 *
 * // Access error properties
 * console.log(error.code)       // 'INTERNAL_ERROR'
 * console.log(error.httpStatus) // 500
 * console.log(error.details)    // { context: 'processing' }
 *
 * // Serialize for transport
 * const json = error.toJSON()
 * // { type: 'RPCError', code: 'INTERNAL_ERROR', message: 'Something went wrong', httpStatus: 500, ... }
 * ```
 */
export class RPCError extends Error {
  /**
   * Error type name (used for instanceof checks after deserialization)
   */
  readonly type: string = 'RPCError'

  /**
   * Error code for programmatic handling
   */
  readonly code: string

  /**
   * HTTP status code for REST compatibility
   */
  readonly httpStatus: number

  /**
   * Optional additional details/metadata
   */
  readonly details?: Record<string, unknown>

  constructor(
    message: string,
    code: string = ErrorCode.INTERNAL_ERROR,
    httpStatus: number = ErrorHttpStatus.INTERNAL_SERVER_ERROR,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'RPCError'
    this.code = code
    this.httpStatus = httpStatus
    if (details !== undefined) {
      this.details = details
    }

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  /**
   * Serialize error to JSON for RPC transport.
   *
   * @returns SerializedError object suitable for JSON transmission
   */
  toJSON(): SerializedError {
    const result: SerializedError = {
      type: this.type,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
    }
    if (this.details !== undefined) {
      result.details = this.details
    }
    return result
  }

  /**
   * Create an RPCError from a SerializedError object.
   *
   * This is useful for deserializing errors received over RPC transport.
   *
   * @param serialized - The serialized error object
   * @returns A new RPCError instance (or appropriate subclass)
   */
  static fromJSON(serialized: SerializedError): RPCError {
    return fromSerializedError(serialized)
  }
}

/**
 * Validation error for input validation failures.
 *
 * Use this error when:
 * - Request parameters are invalid
 * - Required fields are missing
 * - Data format is incorrect
 * - Schema validation fails
 *
 * @example
 * ```typescript
 * throw new ValidationError('Email is required', 'MISSING_REQUIRED_FIELD', { field: 'email' })
 * throw new ValidationError('Invalid email format', 'INVALID_FORMAT', { value: 'not-an-email' })
 * ```
 */
export class ValidationError extends RPCError {
  override readonly type: string = 'ValidationError'

  constructor(
    message: string,
    code: string = ErrorCode.VALIDATION_FAILED,
    details?: Record<string, unknown>
  ) {
    super(message, code, ErrorHttpStatus.BAD_REQUEST, details)
    this.name = 'ValidationError'
  }
}

/**
 * Not found error for missing resources or methods.
 *
 * Use this error when:
 * - A requested resource doesn't exist
 * - An RPC method is not found
 * - A path cannot be resolved
 *
 * @example
 * ```typescript
 * throw new NotFoundError('User not found', 'RESOURCE_NOT_FOUND', { id: 'user-123' })
 * throw new NotFoundError('Method not found: users.archive', 'METHOD_NOT_FOUND')
 * ```
 */
export class NotFoundError extends RPCError {
  override readonly type: string = 'NotFoundError'

  constructor(
    message: string,
    code: string = ErrorCode.NOT_FOUND,
    details?: Record<string, unknown>
  ) {
    super(message, code, ErrorHttpStatus.NOT_FOUND, details)
    this.name = 'NotFoundError'
  }
}

/**
 * Authentication error for auth failures.
 *
 * Use this error when:
 * - No authentication is provided
 * - Token is invalid or expired
 * - Insufficient permissions
 *
 * @example
 * ```typescript
 * throw new AuthError('Missing authentication', 'UNAUTHORIZED')
 * throw new AuthError('Token expired', 'TOKEN_EXPIRED', { expiredAt: '2024-01-01' })
 * throw new AuthError('Insufficient permissions', 'FORBIDDEN', { required: 'admin' })
 * ```
 */
export class AuthError extends RPCError {
  override readonly type: string = 'AuthError'

  constructor(
    message: string,
    code: string = ErrorCode.UNAUTHORIZED,
    details?: Record<string, unknown>
  ) {
    // Use 403 Forbidden for FORBIDDEN code, 401 Unauthorized otherwise
    const httpStatus = code === ErrorCode.FORBIDDEN
      ? ErrorHttpStatus.FORBIDDEN
      : ErrorHttpStatus.UNAUTHORIZED
    super(message, code, httpStatus, details)
    this.name = 'AuthError'
  }
}

/**
 * Network error for transport/connectivity failures.
 *
 * Use this error when:
 * - Network request fails
 * - Connection is refused
 * - DNS resolution fails
 * - WebSocket disconnects unexpectedly
 *
 * @example
 * ```typescript
 * throw new NetworkError('Connection refused', 'CONNECTION_REFUSED', { host: 'api.example.com' })
 * throw new NetworkError('Network request failed', 'TRANSPORT_FAILED', { cause: 'ECONNRESET' })
 * ```
 */
export class NetworkError extends RPCError {
  override readonly type: string = 'NetworkError'

  constructor(
    message: string,
    code: string = ErrorCode.NETWORK_ERROR,
    details?: Record<string, unknown>
  ) {
    super(message, code, ErrorHttpStatus.SERVICE_UNAVAILABLE, details)
    this.name = 'NetworkError'
  }
}

/**
 * Timeout error for request timeouts.
 *
 * Use this error when:
 * - Request exceeds configured timeout
 * - Connection takes too long to establish
 * - WebSocket message response times out
 *
 * @example
 * ```typescript
 * throw new TimeoutError('Request timed out after 30000ms', 'TIMEOUT', { timeout: 30000 })
 * throw new TimeoutError('Connection timed out', 'CONNECTION_TIMEOUT', { host: 'api.example.com' })
 * ```
 */
export class TimeoutError extends RPCError {
  override readonly type: string = 'TimeoutError'

  constructor(
    message: string,
    code: string = ErrorCode.TIMEOUT,
    details?: Record<string, unknown>
  ) {
    super(message, code, ErrorHttpStatus.TIMEOUT, details)
    this.name = 'TimeoutError'
  }
}

/**
 * Error class map for deserialization.
 */
const errorClasses: Record<string, new (message: string, code: string, details?: Record<string, unknown>) => RPCError> = {
  ValidationError,
  NotFoundError,
  AuthError,
  NetworkError,
  TimeoutError,
}

/**
 * Create an error instance from a SerializedError object.
 *
 * This function deserializes errors received over RPC transport,
 * reconstructing the appropriate error class based on the type field.
 *
 * @param serialized - The serialized error object
 * @returns A new error instance of the appropriate class
 *
 * @example
 * ```typescript
 * const serialized = { type: 'NotFoundError', code: 'NOT_FOUND', message: 'Not found' }
 * const error = fromSerializedError(serialized)
 * console.log(error instanceof NotFoundError) // true
 * ```
 */
export function fromSerializedError(serialized: SerializedError): RPCError {
  const { type, code, message, details, httpStatus } = serialized

  // Try to find a specific error class
  const ErrorClass = errorClasses[type]
  if (ErrorClass) {
    return new ErrorClass(message, code, details)
  }

  // Fall back to base RPCError
  return new RPCError(message, code, httpStatus ?? ErrorHttpStatus.INTERNAL_SERVER_ERROR, details)
}

/**
 * Check if a value is an RPCError instance.
 *
 * @param value - The value to check
 * @returns True if the value is an RPCError
 */
export function isRPCError(value: unknown): value is RPCError {
  return value instanceof RPCError
}

/**
 * Check if a value is a SerializedError object.
 *
 * @param value - The value to check
 * @returns True if the value is a SerializedError
 */
export function isSerializedError(value: unknown): value is SerializedError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as SerializedError).code === 'string' &&
    typeof (value as SerializedError).message === 'string'
  )
}
