/**
 * DotdoError - Primary error class for the dotdo runtime
 *
 * Provides structured errors with:
 * - Standardized error codes from codes.ts
 * - Cause chaining for debugging
 * - HTTP status derivation
 * - JSON serialization for API responses
 * - Context/metadata support
 *
 * This class serves as an alternative to DOError when you need
 * stronger type safety on error codes or prefer the "Dotdo" naming.
 * Both classes are compatible and can be used interchangeably.
 */

import { type ErrorCode, ErrorCodes, getHttpStatusForCode, isRetryableError } from './codes'

/**
 * Internal context getter function that can be registered by context.ts
 * This avoids circular import issues by using a callback registration pattern.
 */
let errorContextGetter: (() => Record<string, unknown> | undefined) | null = null

/**
 * Register the error context getter function.
 * This is called by context.ts to enable DotdoError to access context.
 *
 * @internal
 */
export function registerErrorContextGetter(getter: () => Record<string, unknown> | undefined): void {
  errorContextGetter = getter
}

/**
 * Get the current error context from the registered getter
 * This is called internally by DotdoError factory methods
 */
function getCurrentErrorContext(): Record<string, unknown> | undefined {
  return errorContextGetter?.()
}

/**
 * Serialized error format for JSON transport
 */
export interface DotdoErrorJSON {
  name: string
  code: ErrorCode
  message: string
  context?: Record<string, unknown>
  cause?: DotdoErrorJSON | { name: string; message: string }
}

/**
 * Options for creating a DotdoError
 */
export interface DotdoErrorOptions {
  /** Underlying cause of the error */
  cause?: unknown
  /** Additional context/metadata */
  context?: Record<string, unknown>
}

/**
 * Primary error class for dotdo with standardized error codes
 *
 * @example
 * ```ts
 * // Basic usage
 * throw new DotdoError('STORAGE_WRITE_FAILED', 'Failed to persist Thing')
 *
 * // With cause chaining
 * try {
 *   await storage.put(key, value)
 * } catch (err) {
 *   throw new DotdoError('STORAGE_WRITE_FAILED', 'Failed to persist Thing', { cause: err })
 * }
 *
 * // With context
 * throw new DotdoError('NOT_FOUND', 'Customer not found', {
 *   context: { customerId: 'cus_123', operation: 'get' }
 * })
 * ```
 */
export class DotdoError extends Error {
  /**
   * Machine-readable error code
   */
  public readonly code: ErrorCode

  /**
   * Underlying cause of the error (if any)
   */
  public readonly cause?: unknown

  /**
   * Additional context/metadata about the error
   */
  public readonly context?: Record<string, unknown>

  constructor(code: ErrorCode, message: string, options?: DotdoErrorOptions) {
    super(message)
    this.code = code
    this.cause = options?.cause
    this.context = options?.context
    this.name = 'DotdoError'

    // Capture stack trace properly for V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  /**
   * HTTP status code for this error
   * Derived from the error code
   */
  get httpStatus(): number {
    return getHttpStatusForCode(this.code)
  }

  /**
   * Whether this error is retryable
   * Useful for implementing retry logic
   */
  get retryable(): boolean {
    return isRetryableError(this.code)
  }

  /**
   * Serialize the error for JSON transport/logging
   * Does not include stack trace or httpStatus in output
   */
  toJSON(): DotdoErrorJSON {
    const json: DotdoErrorJSON = {
      name: this.name,
      code: this.code,
      message: this.message,
    }

    if (this.context !== undefined && Object.keys(this.context).length > 0) {
      json.context = this.context
    }

    if (this.cause !== undefined && this.cause !== null) {
      if (this.cause instanceof DotdoError) {
        json.cause = this.cause.toJSON()
      } else if (this.cause instanceof Error) {
        json.cause = {
          name: this.cause.name,
          message: this.cause.message,
        }
      }
    }

    return json
  }

  /**
   * Create a formatted string representation
   */
  toString(): string {
    let result = `${this.name} [${this.code}]: ${this.message}`
    if (this.context) {
      result += ` (${JSON.stringify(this.context)})`
    }
    return result
  }

  /**
   * Create a storage error
   */
  static storage(
    message: string,
    options?: DotdoErrorOptions & { operation?: 'read' | 'write' | 'delete' | 'transaction' }
  ): DotdoError {
    const op = options?.operation ?? 'write'
    const codeMap = {
      read: ErrorCodes.STORAGE_READ_FAILED,
      write: ErrorCodes.STORAGE_WRITE_FAILED,
      delete: ErrorCodes.STORAGE_DELETE_FAILED,
      transaction: ErrorCodes.STORAGE_TRANSACTION_FAILED,
    } as const
    return new DotdoError(codeMap[op], message, options)
  }

  /**
   * Create a not found error
   * Automatically includes current error context if available
   */
  static notFound(resource: string, id?: string, options?: DotdoErrorOptions): DotdoError {
    const message = id ? `${resource} '${id}' not found` : `${resource} not found`
    const currentContext = getCurrentErrorContext()
    return new DotdoError(ErrorCodes.NOT_FOUND, message, {
      ...options,
      context: { ...currentContext, resource, id, ...options?.context },
    })
  }

  /**
   * Create a validation error
   */
  static validation(message: string, options?: DotdoErrorOptions): DotdoError {
    return new DotdoError(ErrorCodes.INVALID_INPUT, message, options)
  }

  /**
   * Create a schema validation error
   */
  static schemaValidation(message: string, options?: DotdoErrorOptions): DotdoError {
    return new DotdoError(ErrorCodes.SCHEMA_VALIDATION_FAILED, message, options)
  }

  /**
   * Create an unauthorized error
   */
  static unauthorized(message = 'Authentication required', options?: DotdoErrorOptions): DotdoError {
    return new DotdoError(ErrorCodes.UNAUTHORIZED, message, options)
  }

  /**
   * Create a forbidden error
   */
  static forbidden(message = 'Access denied', options?: DotdoErrorOptions): DotdoError {
    return new DotdoError(ErrorCodes.FORBIDDEN, message, options)
  }

  /**
   * Create an RPC error
   */
  static rpc(
    message: string,
    options?: DotdoErrorOptions & { timeout?: boolean }
  ): DotdoError {
    const code = options?.timeout ? ErrorCodes.RPC_TIMEOUT : ErrorCodes.RPC_CONNECTION_FAILED
    return new DotdoError(code, message, options)
  }

  /**
   * Create a fetch/network error
   */
  static fetch(message: string, options?: DotdoErrorOptions & { timeout?: boolean }): DotdoError {
    const code = options?.timeout ? ErrorCodes.FETCH_TIMEOUT : ErrorCodes.FETCH_FAILED
    return new DotdoError(code, message, options)
  }

  /**
   * Create an internal error
   */
  static internal(message: string, options?: DotdoErrorOptions): DotdoError {
    return new DotdoError(ErrorCodes.INTERNAL_ERROR, message, options)
  }

  /**
   * Create a rate limited error
   */
  static rateLimited(message = 'Too many requests', options?: DotdoErrorOptions): DotdoError {
    return new DotdoError(ErrorCodes.RATE_LIMITED, message, options)
  }

  /**
   * Create a conflict error
   */
  static conflict(message: string, options?: DotdoErrorOptions): DotdoError {
    return new DotdoError(ErrorCodes.CONFLICT, message, options)
  }

  /**
   * Wrap an unknown error as a DotdoError
   * Useful for catch blocks where the error type is unknown
   * Automatically attaches current error context if available
   */
  static wrap(error: unknown, code: ErrorCode = ErrorCodes.INTERNAL_ERROR): DotdoError {
    if (error instanceof DotdoError) {
      return error
    }

    const currentContext = getCurrentErrorContext()

    if (error instanceof Error) {
      return new DotdoError(code, error.message, {
        cause: error,
        context: currentContext,
      })
    }
    return new DotdoError(code, String(error), { context: currentContext })
  }

  /**
   * Check if an error is a DotdoError with a specific code
   */
  static is(error: unknown, code: ErrorCode): error is DotdoError {
    return error instanceof DotdoError && error.code === code
  }

  /**
   * Check if an error is any DotdoError
   */
  static isDotdoError(error: unknown): error is DotdoError {
    return error instanceof DotdoError
  }
}
