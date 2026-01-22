/**
 * @dotdo/utils - Base Error Class
 *
 * Provides a common base error class that all dotdo package errors can extend.
 * This ensures consistent error handling across the entire ecosystem:
 * - Standardized error codes and messages
 * - Cause chaining for debugging
 * - JSON serialization for cross-boundary transport (RPC, API responses)
 * - Static reconstruction from serialized form
 *
 * @example
 * ```typescript
 * // Extend in your package
 * export class MyPackageError extends DotdoError {
 *   constructor(message: string, options?: DotdoErrorOptions) {
 *     super('MY_PACKAGE_ERROR', message, options)
 *     this.name = 'MyPackageError'
 *   }
 * }
 *
 * // Throw with context
 * throw new MyPackageError('Operation failed', {
 *   cause: originalError,
 *   details: { operation: 'fetch', resourceId: '123' }
 * })
 * ```
 *
 * @module @dotdo/utils/base-error
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Error details/context type.
 *
 * This is intentionally open-ended because error details vary by error type:
 * field names, resource IDs, URLs, counts, etc.
 */
export type ErrorDetails = Record<string, unknown>

/**
 * Options for creating a DotdoError
 */
export interface DotdoErrorOptions {
  /** Underlying cause of the error */
  cause?: Error | unknown
  /** Additional context/metadata */
  details?: ErrorDetails
}

/**
 * Serialized error format for JSON transport
 */
export interface SerializedDotdoError {
  /** Error type name (e.g., 'DotdoError', 'NotFoundError') */
  type: string
  /** Error code for programmatic handling */
  code: string
  /** Human-readable error message */
  message: string
  /** Additional error details */
  details?: ErrorDetails
  /** Stack trace (optional, typically excluded in production) */
  stack?: string
  /** Serialized cause error (optional) */
  cause?: SerializedDotdoError | { name: string; message: string }
}

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base error class for the entire dotdo ecosystem.
 *
 * All package-specific errors should extend this class to ensure:
 * - Consistent error code handling
 * - Proper serialization for cross-boundary transport
 * - Cause chaining for debugging
 *
 * @example
 * ```typescript
 * // Basic usage
 * throw new DotdoError('NOT_FOUND', 'Resource not found')
 *
 * // With details and cause
 * try {
 *   await fetchData()
 * } catch (err) {
 *   throw new DotdoError('NETWORK_ERROR', 'Failed to fetch data', {
 *     cause: err,
 *     details: { url, timeout }
 *   })
 * }
 * ```
 */
export class DotdoError extends Error {
  /** Error code for programmatic handling */
  public readonly code: string
  /** Additional error details/context */
  public readonly details?: ErrorDetails

  constructor(
    code: string,
    message: string,
    options?: DotdoErrorOptions
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'DotdoError'
    this.code = code
    if (options?.details !== undefined) {
      this.details = options.details
    }
    Object.setPrototypeOf(this, new.target.prototype)

    // Capture stack trace properly for V8 (Node.js/Cloudflare Workers)
    const ErrorWithCapture = Error as typeof Error & {
      captureStackTrace?: (target: Error, constructor: unknown) => void
    }
    if (ErrorWithCapture.captureStackTrace) {
      ErrorWithCapture.captureStackTrace(this, this.constructor)
    }
  }

  /**
   * Serialize error for JSON transport.
   *
   * Returns a plain object that can be safely JSON.stringify'd and sent
   * across process/network boundaries.
   */
  toJSON(): SerializedDotdoError {
    const result: SerializedDotdoError = {
      type: this.name,
      code: this.code,
      message: this.message,
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
   * Create a formatted string representation.
   */
  override toString(): string {
    let result = `${this.name} [${this.code}]: ${this.message}`
    if (this.details) {
      result += ` (${JSON.stringify(this.details)})`
    }
    return result
  }

  /**
   * Reconstruct a DotdoError from a serialized representation.
   *
   * This is useful for deserializing errors received over RPC or from API responses.
   *
   * @param serialized - The serialized error object
   * @returns A new DotdoError instance (or subclass if registered)
   */
  static fromJSON(serialized: SerializedDotdoError): DotdoError {
    // Reconstruct cause if present
    let cause: Error | DotdoError | undefined
    if (serialized.cause) {
      if ('code' in serialized.cause) {
        cause = DotdoError.fromJSON(serialized.cause)
      } else {
        const causeError = new Error(serialized.cause.message)
        causeError.name = serialized.cause.name
        cause = causeError
      }
    }

    const error = new DotdoError(
      serialized.code,
      serialized.message,
      {
        ...(serialized.details !== undefined && { details: serialized.details }),
        ...(cause !== undefined && { cause }),
      }
    )

    // Restore the original error name
    error.name = serialized.type

    // Restore stack trace if present
    if (serialized.stack) {
      error.stack = serialized.stack
    }

    return error
  }

  /**
   * Wrap an unknown error as a DotdoError.
   *
   * If the error is already a DotdoError, it is returned as-is.
   * Otherwise, a new DotdoError is created with the original error as the cause.
   *
   * @param error - The error to wrap
   * @param code - The error code to use (default: 'INTERNAL_ERROR')
   * @returns A DotdoError instance
   */
  static wrap(error: unknown, code = 'INTERNAL_ERROR'): DotdoError {
    if (error instanceof DotdoError) {
      return error
    }

    if (error instanceof Error) {
      return new DotdoError(code, error.message, { cause: error })
    }

    return new DotdoError(code, String(error))
  }

  /**
   * Check if an error is a DotdoError with a specific code.
   *
   * @param error - The error to check
   * @param code - The expected error code
   * @returns True if the error is a DotdoError with the given code
   */
  static is(error: unknown, code: string): error is DotdoError {
    return error instanceof DotdoError && error.code === code
  }

  /**
   * Check if an error is any DotdoError.
   *
   * @param error - The error to check
   * @returns True if the error is a DotdoError instance
   */
  static isDotdoError(error: unknown): error is DotdoError {
    return error instanceof DotdoError
  }
}

// =============================================================================
// Type Guard
// =============================================================================

/**
 * Type guard to check if an object is a SerializedDotdoError.
 *
 * Useful for validating data received from external sources before
 * attempting to deserialize it.
 *
 * @param value - The value to check
 * @returns True if the value is a valid SerializedDotdoError
 */
export function isSerializedDotdoError(value: unknown): value is SerializedDotdoError {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  // Must have message and code (required fields)
  if (typeof obj['message'] !== 'string') {
    return false
  }
  if (typeof obj['code'] !== 'string') {
    return false
  }

  // Must have type
  if (typeof obj['type'] !== 'string') {
    return false
  }

  // Optional fields must be correct types if present
  if (obj['details'] !== undefined && typeof obj['details'] !== 'object') {
    return false
  }
  if (obj['stack'] !== undefined && typeof obj['stack'] !== 'string') {
    return false
  }

  return true
}
