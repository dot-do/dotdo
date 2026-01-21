/**
 * @dotdo/db - Error Types
 *
 * Provides a consistent error hierarchy for the entire dotdo ecosystem.
 * This is the base layer that other packages (@dotdo/rpc, @dotdo/do, etc.) can extend.
 *
 * Design Principles:
 * 1. Base DotdoError class with standardized error codes
 * 2. Package-specific error types extending base
 * 3. Consistent error codes with HTTP status mapping
 * 4. Proper error serialization for cross-boundary transport
 */

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Standardized error codes following the pattern: CATEGORY_ACTION or CATEGORY
 * These codes provide machine-readable identifiers for programmatic error handling.
 */
export const ErrorCode = {
  // Generic errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMIT: 'RATE_LIMIT',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',

  // Authentication/Authorization errors
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',

  // Network/RPC errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  RPC_ERROR: 'RPC_ERROR',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',

  // Database errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  TRANSACTION_ERROR: 'TRANSACTION_ERROR',
  STORAGE_ERROR: 'STORAGE_ERROR',
} as const

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode]

/**
 * Mapping from error codes to HTTP status codes
 */
export const ERROR_CODE_TO_HTTP_STATUS: Record<ErrorCodeType, number> = {
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.TIMEOUT]: 504,
  [ErrorCode.RATE_LIMIT]: 429,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.NOT_IMPLEMENTED]: 501,
  [ErrorCode.AUTHENTICATION_ERROR]: 401,
  [ErrorCode.AUTHORIZATION_ERROR]: 403,
  [ErrorCode.NETWORK_ERROR]: 503,
  [ErrorCode.RPC_ERROR]: 500,
  [ErrorCode.CIRCUIT_OPEN]: 503,
  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.TRANSACTION_ERROR]: 500,
  [ErrorCode.STORAGE_ERROR]: 500,
}

/**
 * Get HTTP status code for a given error code
 */
export function getHttpStatusForCode(code: ErrorCodeType | string): number {
  return ERROR_CODE_TO_HTTP_STATUS[code as ErrorCodeType] ?? 500
}

/**
 * Check if an error code represents a retryable error
 */
export function isRetryableCode(code: ErrorCodeType | string): boolean {
  const retryableCodes: string[] = [
    ErrorCode.NETWORK_ERROR,
    ErrorCode.TIMEOUT,
    ErrorCode.RATE_LIMIT,
    ErrorCode.SERVICE_UNAVAILABLE,
    ErrorCode.CIRCUIT_OPEN,
  ]
  return retryableCodes.includes(code)
}

// =============================================================================
// Serialization Types
// =============================================================================

/**
 * Serialized error format for JSON transport across boundaries
 */
export interface SerializedDotdoError {
  /** Error type name (e.g., 'DotdoError', 'NotFoundError') */
  type: string
  /** Error name (alias for type, for backward compatibility) */
  name?: string
  /** Error code for programmatic handling */
  code: ErrorCodeType | string
  /** Human-readable error message */
  message: string
  /** Additional error details */
  details?: Record<string, unknown>
  /** HTTP status code */
  httpStatus?: number
  /** Stack trace (optional, excluded by default in production) */
  stack?: string
  /** Serialized cause error (optional) */
  cause?: SerializedDotdoError | { name: string; message: string }
}

/**
 * Options for error serialization
 */
export interface SerializeErrorOptions {
  /** Include stack trace in serialized output (default: false in production) */
  includeStack?: boolean
}

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Options for creating a DotdoError
 */
export interface DotdoErrorOptions {
  /** Underlying cause of the error */
  cause?: Error | unknown
  /** Additional context/metadata */
  details?: Record<string, unknown>
}

/**
 * Base error class for the entire dotdo ecosystem.
 *
 * All package-specific errors should extend this class to ensure:
 * - Consistent error code handling
 * - HTTP status code mapping
 * - Proper serialization for cross-boundary transport
 * - Cause chaining for debugging
 *
 * @example
 * ```typescript
 * // Basic usage
 * throw new DotdoError(ErrorCode.NOT_FOUND, 'Resource not found')
 *
 * // With details and cause
 * try {
 *   await fetchData()
 * } catch (err) {
 *   throw new DotdoError(ErrorCode.NETWORK_ERROR, 'Failed to fetch data', {
 *     cause: err,
 *     details: { url, timeout }
 *   })
 * }
 * ```
 */
export class DotdoError extends Error {
  /** Error code for programmatic handling */
  public readonly code: ErrorCodeType | string
  /** HTTP status code derived from error code */
  public readonly httpStatus: number
  /** Additional error details/context */
  public readonly details?: Record<string, unknown>

  constructor(
    code: ErrorCodeType | string,
    message: string,
    options?: DotdoErrorOptions
  ) {
    super(message, { cause: options?.cause })
    this.name = 'DotdoError'
    this.code = code
    this.httpStatus = getHttpStatusForCode(code)
    this.details = options?.details
    Object.setPrototypeOf(this, new.target.prototype)

    // Capture stack trace properly for V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  /**
   * Check if this error is retryable
   */
  get retryable(): boolean {
    return isRetryableCode(this.code)
  }

  /**
   * Serialize error for JSON transport
   */
  toJSON(): SerializedDotdoError {
    const result: SerializedDotdoError = {
      type: this.name,
      name: this.name,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
    }

    if (this.details !== undefined && Object.keys(this.details).length > 0) {
      result.details = this.details
    }

    if (this.cause) {
      if (this.cause instanceof DotdoError) {
        result.cause = this.cause.toJSON()
      } else if (this.cause instanceof Error) {
        result.cause = {
          name: this.cause.name,
          message: this.cause.message,
        }
      }
    }

    return result
  }

  /**
   * Create a formatted string representation
   */
  toString(): string {
    let result = `${this.name} [${this.code}]: ${this.message}`
    if (this.details) {
      result += ` (${JSON.stringify(this.details)})`
    }
    return result
  }

  /**
   * Wrap an unknown error as a DotdoError
   */
  static wrap(error: unknown, code: ErrorCodeType | string = ErrorCode.INTERNAL_ERROR): DotdoError {
    if (error instanceof DotdoError) {
      return error
    }

    if (error instanceof Error) {
      return new DotdoError(code, error.message, { cause: error })
    }

    return new DotdoError(code, String(error))
  }

  /**
   * Check if an error is a DotdoError with a specific code
   */
  static is(error: unknown, code: ErrorCodeType | string): error is DotdoError {
    return error instanceof DotdoError && error.code === code
  }

  /**
   * Check if an error is any DotdoError
   */
  static isDotdoError(error: unknown): error is DotdoError {
    return error instanceof DotdoError
  }
}

// =============================================================================
// Database-Specific Errors
// =============================================================================

/**
 * Base database error class
 * Extends DotdoError with database-specific defaults
 *
 * Note: Uses positional `details` argument for backward compatibility.
 */
export class DatabaseError extends DotdoError {
  constructor(
    message: string,
    details?: Record<string, unknown>
  ) {
    super(ErrorCode.DATABASE_ERROR, message, {
      ...(details !== undefined && { details }),
    })
    this.name = 'DatabaseError'
  }
}

/**
 * Validation error for invalid input (e.g., missing required fields)
 *
 * Named DbValidationError to avoid conflict with ValidationError interfaces
 * in schema.ts and schemas.ts.
 *
 * Extends DatabaseError for inheritance hierarchy compatibility.
 */
export class DbValidationError extends DatabaseError {
  public override readonly code = ErrorCode.VALIDATION_ERROR
  public override readonly httpStatus = 400

  constructor(message = 'Validation failed', details?: Record<string, unknown>) {
    super(message, details)
    this.name = 'DbValidationError'
  }

  /**
   * Create a DbValidationError with multiple field errors
   */
  static withErrors(errors: Array<{ field: string; message: string }>): DbValidationError {
    const messages = errors.map((e) => `${e.field}: ${e.message}`).join(', ')
    return new DbValidationError(`Validation failed: ${messages}`, { errors })
  }

  /**
   * Create a DbValidationError for a single field
   */
  static forField(field: string, constraint: string, value?: unknown): DbValidationError {
    return new DbValidationError(
      `Validation failed: ${field} ${constraint}`,
      { field, constraint, value }
    )
  }
}

/**
 * Resource not found error
 *
 * Named DbNotFoundError for consistency with DbValidationError.
 *
 * Extends DatabaseError for inheritance hierarchy compatibility.
 */
export class DbNotFoundError extends DatabaseError {
  public override readonly code = ErrorCode.NOT_FOUND
  public override readonly httpStatus = 404

  constructor(message = 'Resource not found', details?: Record<string, unknown>) {
    super(message, details)
    this.name = 'DbNotFoundError'
  }

  /**
   * Create a DbNotFoundError for a specific resource type and ID
   */
  static forResource(resourceType: string, resourceId: string): DbNotFoundError {
    return new DbNotFoundError(
      `${resourceType} with id ${resourceId} not found`,
      { resourceType, resourceId }
    )
  }
}

/**
 * Transaction-related errors for the database layer
 */
export class TransactionError extends DotdoError {
  constructor(
    message: string,
    cause?: Error,
    details?: Record<string, unknown>
  ) {
    super(ErrorCode.TRANSACTION_ERROR, message, {
      ...(cause !== undefined && { cause }),
      ...(details !== undefined && { details }),
    })
    this.name = 'TransactionError'
  }

  /**
   * Create a TransactionError for rollback failure
   */
  static rollbackFailed(originalError: Error, rollbackError: Error): TransactionError {
    return new TransactionError(
      `Transaction rollback failed: ${rollbackError.message}`,
      rollbackError,
      {
        originalError: originalError.message,
        rollbackError: rollbackError.message
      }
    )
  }

  /**
   * Create a TransactionError for nested transaction failure
   */
  static nestedFailed(savepointName: string, error: Error): TransactionError {
    return new TransactionError(
      `Nested transaction '${savepointName}' failed: ${error.message}`,
      error,
      { savepointName }
    )
  }
}

/**
 * Error thrown when attempting nested transactions without support
 */
export class NestedTransactionError extends TransactionError {
  constructor(message = 'Nested transactions are not supported by this adapter') {
    super(message)
    this.name = 'NestedTransactionError'
  }
}

// =============================================================================
// Serialization Functions
// =============================================================================

/**
 * Serialize an error for transmission across boundaries
 */
export function serializeDotdoError(
  error: Error | DotdoError,
  options: SerializeErrorOptions = {}
): SerializedDotdoError {
  const { includeStack = false } = options

  if (error instanceof DotdoError) {
    const serialized = error.toJSON()
    if (includeStack && error.stack) {
      serialized.stack = error.stack
    }
    return serialized
  }

  // Handle standard Error
  const serialized: SerializedDotdoError = {
    type: error.name,
    name: error.name,
    code: ErrorCode.INTERNAL_ERROR,
    message: error.message,
    httpStatus: 500,
  }

  if (includeStack && error.stack) {
    serialized.stack = error.stack
  }

  return serialized
}

/**
 * Serialize any value as an error for transmission
 */
export function serializeUnknownAsDotdoError(
  error: unknown,
  options: SerializeErrorOptions = {}
): SerializedDotdoError {
  if (error instanceof DotdoError) {
    return serializeDotdoError(error, options)
  }

  if (error instanceof Error) {
    return serializeDotdoError(error, options)
  }

  // Handle non-Error values
  return {
    type: 'UnknownError',
    name: 'UnknownError',
    code: ErrorCode.INTERNAL_ERROR,
    message: String(error),
    httpStatus: 500,
  }
}

/**
 * Registry of error constructors for deserialization
 */
const ERROR_REGISTRY: Record<string, new (message: string, options?: DotdoErrorOptions) => DotdoError> = {
  DotdoError: DotdoError as unknown as new (message: string, options?: DotdoErrorOptions) => DotdoError,
  DatabaseError,
  DbValidationError,
  DbNotFoundError,
}

/**
 * Register a custom error class for deserialization
 */
export function registerErrorClass(
  name: string,
  ErrorClass: new (message: string, options?: DotdoErrorOptions) => DotdoError
): void {
  ERROR_REGISTRY[name] = ErrorClass
}

/**
 * Deserialize an error received from across boundaries
 */
export function deserializeDotdoError(serialized: SerializedDotdoError): DotdoError | Error {
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

  const ErrorClass = ERROR_REGISTRY[errorType]

  if (ErrorClass && errorType !== 'DotdoError') {
    const error = new ErrorClass(serialized.message, {
      ...(serialized.details !== undefined && { details: serialized.details }),
    })
    if (serialized.stack) {
      error.stack = serialized.stack
    }
    return error
  }

  // Fallback to base DotdoError
  const error = new DotdoError(
    serialized.code ?? ErrorCode.INTERNAL_ERROR,
    serialized.message,
    {
      ...(serialized.details !== undefined && { details: serialized.details }),
    }
  )

  if (serialized.stack) {
    error.stack = serialized.stack
  }

  return error
}

/**
 * Type guard to check if an object is a SerializedDotdoError
 */
export function isSerializedDotdoError(value: unknown): value is SerializedDotdoError {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  // Must have a message
  if (typeof obj['message'] !== 'string') {
    return false
  }

  // Must have either 'type' or 'name'
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

  return true
}

/**
 * Extract error message from an unknown error value
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  // Check for explicit retryable property
  if (error && typeof error === 'object' && 'retryable' in error) {
    return (error as { retryable: boolean }).retryable
  }

  // Check DotdoError-based errors
  if (error instanceof DotdoError) {
    return error.retryable
  }

  // Generic errors are NOT retryable by default
  return false
}
