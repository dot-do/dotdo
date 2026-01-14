/**
 * DOError hierarchy - structured errors for the dotdo runtime
 *
 * All errors extend DOError and provide:
 * - code: Machine-readable error code
 * - message: Human-readable description
 * - cause: Optional underlying error
 * - httpStatus: Corresponding HTTP status code
 * - toJSON(): Serialization for logging/transport
 */

export interface DOErrorJSON {
  name: string
  code: string
  message: string
  cause?: DOErrorJSON | { name: string; message: string }
}

/**
 * Base error class for all dotdo errors.
 * Provides structured error information with optional cause chaining.
 */
export class DOError extends Error {
  public readonly code: string
  public override readonly cause?: Error

  constructor(code: string, message: string, cause?: Error) {
    super(message)
    this.code = code
    this.cause = cause
    this.name = 'DOError'

    // Capture stack trace properly for V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  /**
   * HTTP status code for this error type.
   * Override in subclasses for specific status codes.
   */
  get httpStatus(): number {
    return 500
  }

  /**
   * Serialize the error for JSON transport/logging.
   * Does not include stack trace or httpStatus in output.
   */
  toJSON(): DOErrorJSON {
    const json: DOErrorJSON = {
      name: this.name,
      code: this.code,
      message: this.message,
    }

    if (this.cause !== undefined && this.cause !== null) {
      if (this.cause instanceof DOError) {
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
}

/**
 * Validation error - invalid input or data format.
 * HTTP 400 Bad Request.
 */
export class ValidationError extends DOError {
  constructor(code: string, message: string, cause?: Error) {
    super(code, message, cause)
    this.name = 'ValidationError'
  }

  override get httpStatus(): number {
    return 400
  }
}

/**
 * Not found error - resource does not exist.
 * HTTP 404 Not Found.
 */
export class NotFoundError extends DOError {
  constructor(code: string, message: string, cause?: Error) {
    super(code, message, cause)
    this.name = 'NotFoundError'
  }

  override get httpStatus(): number {
    return 404
  }
}

/**
 * Authorization error - access denied.
 * HTTP 403 Forbidden.
 */
export class AuthorizationError extends DOError {
  constructor(code: string, message: string, cause?: Error) {
    super(code, message, cause)
    this.name = 'AuthorizationError'
  }

  override get httpStatus(): number {
    return 403
  }
}

/**
 * Timeout error - operation exceeded time limit.
 * HTTP 408 Request Timeout.
 */
export class TimeoutError extends DOError {
  constructor(code: string, message: string, cause?: Error) {
    super(code, message, cause)
    this.name = 'TimeoutError'
  }

  override get httpStatus(): number {
    return 408
  }
}

/**
 * Transport error - RPC or network failure.
 * HTTP 502 Bad Gateway.
 */
export class TransportError extends DOError {
  constructor(code: string, message: string, cause?: Error) {
    super(code, message, cause)
    this.name = 'TransportError'
  }

  override get httpStatus(): number {
    return 502
  }
}

/**
 * Not implemented error - feature not available in this context.
 * HTTP 501 Not Implemented.
 */
export class NotImplementedError extends DOError {
  constructor(feature: string, context: string, cause?: Error) {
    super(
      'NOT_IMPLEMENTED',
      `${feature} is not implemented in ${context}. See https://dotdo.dev/docs/${context}/feature-parity for alternatives.`,
      cause
    )
    this.name = 'NotImplementedError'
  }

  override get httpStatus(): number {
    return 501
  }
}
