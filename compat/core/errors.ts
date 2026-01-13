/**
 * @dotdo/compat/core/errors.ts - Unified Error Format
 *
 * Provides a consistent error interface across all compat SDKs:
 * - S3, Stripe, OpenAI, SendGrid, and more
 *
 * Features:
 * - CompatError base class with code, message, cause, statusCode, sdk
 * - Specialized error subclasses: ValidationError, AuthenticationError, etc.
 * - SDK-specific error mappers: fromStripeError, fromOpenAIError, fromAWSError
 * - HTTP Response generation with toResponse()
 * - Type guards and utilities: isCompatError, wrapError
 */

import { safeSerialize } from '../../lib/safe-stringify'

// =============================================================================
// Types
// =============================================================================

export interface CompatErrorOptions {
  code: string
  message: string
  statusCode?: number
  sdk?: string
  requestId?: string
  cause?: Error
  details?: Record<string, unknown>
  retryable?: boolean
}

export interface ValidationErrorOptions {
  message: string
  field?: string
  value?: unknown
  errors?: Array<{ field: string; message: string }>
  sdk?: string
  requestId?: string
  cause?: Error
}

export interface AuthenticationErrorOptions {
  message: string
  sdk?: string
  requestId?: string
  cause?: Error
  details?: Record<string, unknown>
}

export interface AuthorizationErrorOptions {
  message: string
  resource?: string
  action?: string
  sdk?: string
  requestId?: string
  cause?: Error
  details?: Record<string, unknown>
}

export interface NotFoundErrorOptions {
  message: string
  resourceType?: string
  resourceId?: string
  sdk?: string
  requestId?: string
  cause?: Error
  details?: Record<string, unknown>
}

export interface RateLimitErrorOptions {
  message: string
  retryAfter?: number
  limit?: number
  remaining?: number
  resetAt?: Date
  sdk?: string
  requestId?: string
  cause?: Error
  details?: Record<string, unknown>
}

export interface ServiceErrorOptions {
  message: string
  statusCode?: number
  service?: string
  sdk?: string
  requestId?: string
  cause?: Error
  details?: Record<string, unknown>
  retryable?: boolean
}

export interface ToResponseOptions {
  exposeDetails?: boolean
}

// =============================================================================
// Safe JSON Serialization (imported from lib/safe-stringify)
// =============================================================================

// Re-export for backwards compatibility
export { safeSerialize }

// =============================================================================
// CompatError Base Class
// =============================================================================

export class CompatError extends Error {
  public readonly code: string
  public readonly statusCode: number
  public readonly sdk?: string
  public readonly requestId?: string
  public readonly details?: Record<string, unknown>
  public readonly retryable: boolean

  constructor(options: CompatErrorOptions) {
    super(options.message)
    this.name = 'CompatError'
    this.code = options.code
    this.statusCode = options.statusCode ?? 500
    this.sdk = options.sdk
    this.requestId = options.requestId
    this.details = options.details
    this.cause = options.cause

    // Default retryable based on status code
    if (options.retryable !== undefined) {
      this.retryable = options.retryable
    } else {
      this.retryable = this.statusCode >= 500 || this.statusCode === 429
    }

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
    }

    if (this.sdk !== undefined) {
      json.sdk = this.sdk
    }
    if (this.requestId !== undefined) {
      json.requestId = this.requestId
    }
    if (this.details !== undefined) {
      json.details = safeSerialize(this.details)
    }

    return json
  }

  static fromResponse(response: Response, message: string): CompatError {
    const requestId =
      response.headers.get('x-request-id') ||
      response.headers.get('x-amzn-requestid') ||
      response.headers.get('x-amz-request-id') ||
      response.headers.get('request-id') ||
      undefined

    const cfRay = response.headers.get('cf-ray') || undefined

    const details: Record<string, unknown> = {}
    if (cfRay) {
      details.cfRay = cfRay
    }

    return new CompatError({
      code: 'HTTP_ERROR',
      message,
      statusCode: response.status,
      requestId,
      details: Object.keys(details).length > 0 ? details : undefined,
    })
  }
}

// =============================================================================
// Specialized Error Classes
// =============================================================================

export class ValidationError extends CompatError {
  public readonly field?: string
  public readonly value?: unknown
  public readonly errors?: Array<{ field: string; message: string }>

  constructor(options: ValidationErrorOptions) {
    super({
      code: 'VALIDATION_ERROR',
      message: options.message,
      statusCode: 400,
      sdk: options.sdk,
      requestId: options.requestId,
      cause: options.cause,
      retryable: false,
    })
    this.name = 'ValidationError'
    this.field = options.field
    this.value = options.value
    this.errors = options.errors
  }
}

export class AuthenticationError extends CompatError {
  constructor(options: AuthenticationErrorOptions) {
    super({
      code: 'AUTHENTICATION_ERROR',
      message: options.message,
      statusCode: 401,
      sdk: options.sdk,
      requestId: options.requestId,
      cause: options.cause,
      details: options.details,
      retryable: false,
    })
    this.name = 'AuthenticationError'
  }
}

export class AuthorizationError extends CompatError {
  public readonly resource?: string
  public readonly action?: string

  constructor(options: AuthorizationErrorOptions) {
    super({
      code: 'AUTHORIZATION_ERROR',
      message: options.message,
      statusCode: 403,
      sdk: options.sdk,
      requestId: options.requestId,
      cause: options.cause,
      details: options.details,
      retryable: false,
    })
    this.name = 'AuthorizationError'
    this.resource = options.resource
    this.action = options.action
  }
}

export class NotFoundError extends CompatError {
  public readonly resourceType?: string
  public readonly resourceId?: string

  constructor(options: NotFoundErrorOptions) {
    super({
      code: 'NOT_FOUND',
      message: options.message,
      statusCode: 404,
      sdk: options.sdk,
      requestId: options.requestId,
      cause: options.cause,
      details: options.details,
      retryable: false,
    })
    this.name = 'NotFoundError'
    this.resourceType = options.resourceType
    this.resourceId = options.resourceId
  }
}

export class RateLimitError extends CompatError {
  public readonly retryAfter?: number
  public readonly limit?: number
  public readonly remaining?: number
  public readonly resetAt?: Date

  constructor(options: RateLimitErrorOptions) {
    super({
      code: 'RATE_LIMIT_ERROR',
      message: options.message,
      statusCode: 429,
      sdk: options.sdk,
      requestId: options.requestId,
      cause: options.cause,
      details: options.details,
      retryable: true,
    })
    this.name = 'RateLimitError'
    this.retryAfter = options.retryAfter
    this.limit = options.limit
    this.remaining = options.remaining
    this.resetAt = options.resetAt
  }

  static fromHeaders(message: string, headers: Headers): RateLimitError {
    const retryAfterHeader = headers.get('Retry-After')
    let retryAfter: number | undefined
    let resetAt: Date | undefined

    if (retryAfterHeader) {
      // Check if it's a number (seconds) or a date
      const parsed = parseInt(retryAfterHeader, 10)
      if (!isNaN(parsed)) {
        retryAfter = parsed
      } else {
        // Parse as HTTP date
        resetAt = new Date(retryAfterHeader)
        if (!isNaN(resetAt.getTime())) {
          // Compute seconds from now, minimum of 1 if date is valid (even if in past)
          const secondsFromNow = Math.ceil(
            (resetAt.getTime() - Date.now()) / 1000
          )
          retryAfter = Math.max(1, secondsFromNow)
        }
      }
    }

    const limitHeader = headers.get('X-RateLimit-Limit')
    const remainingHeader = headers.get('X-RateLimit-Remaining')
    const resetHeader = headers.get('X-RateLimit-Reset')

    const limit = limitHeader ? parseInt(limitHeader, 10) : undefined
    const remaining = remainingHeader
      ? parseInt(remainingHeader, 10)
      : undefined

    if (resetHeader && !resetAt) {
      const resetTimestamp = parseInt(resetHeader, 10)
      if (!isNaN(resetTimestamp)) {
        resetAt = new Date(resetTimestamp * 1000)
      }
    }

    return new RateLimitError({
      message,
      retryAfter,
      limit,
      remaining,
      resetAt,
    })
  }
}

export class ServiceError extends CompatError {
  public readonly service?: string

  constructor(options: ServiceErrorOptions) {
    const statusCode = options.statusCode ?? 500
    super({
      code: 'SERVICE_ERROR',
      message: options.message,
      statusCode,
      sdk: options.sdk,
      requestId: options.requestId,
      cause: options.cause,
      details: options.details,
      retryable: options.retryable ?? statusCode >= 500,
    })
    this.name = 'ServiceError'
    this.service = options.service
  }
}

// =============================================================================
// Type Guards
// =============================================================================

export function isCompatError(error: unknown): error is CompatError {
  return error instanceof CompatError
}

// =============================================================================
// Utilities
// =============================================================================

export function wrapError(error: unknown, sdk?: string): CompatError {
  // Preserve existing CompatError instances
  if (isCompatError(error)) {
    return error
  }

  // Handle native Error
  if (error instanceof Error) {
    return new CompatError({
      code: 'UNKNOWN_ERROR',
      message: error.message,
      statusCode: 500,
      sdk,
      cause: error,
    })
  }

  // Handle string errors
  if (typeof error === 'string') {
    return new CompatError({
      code: 'UNKNOWN_ERROR',
      message: error,
      statusCode: 500,
      sdk,
    })
  }

  // Handle unknown error types
  return new CompatError({
    code: 'UNKNOWN_ERROR',
    message: 'Unknown error',
    statusCode: 500,
    sdk,
    details: { original: error },
  })
}

export function toResponse(
  error: CompatError,
  options?: ToResponseOptions
): Response {
  const exposeDetails = options?.exposeDetails ?? true

  const body: Record<string, unknown> = {
    error: {
      code: error.code,
      message: error.message,
    },
  }

  // Add additional properties if exposeDetails is true
  if (exposeDetails) {
    if (error instanceof NotFoundError) {
      if (error.resourceType) {
        ;(body.error as Record<string, unknown>).resourceType =
          error.resourceType
      }
      if (error.resourceId) {
        ;(body.error as Record<string, unknown>).resourceId = error.resourceId
      }
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (error.requestId) {
    headers['X-Request-Id'] = error.requestId
  }

  if (error instanceof RateLimitError && error.retryAfter !== undefined) {
    headers['Retry-After'] = String(error.retryAfter)
  }

  return new Response(JSON.stringify(body), {
    status: error.statusCode,
    headers,
  })
}

// =============================================================================
// SDK-Specific Mappers
// =============================================================================

interface StripeError {
  type: string
  code?: string
  message: string
  decline_code?: string
  param?: string
  doc_url?: string
}

export function fromStripeError(
  stripeError: StripeError,
  statusCode: number,
  requestId?: string
): CompatError {
  // Map authentication errors
  if (stripeError.type === 'authentication_error') {
    return new AuthenticationError({
      message: stripeError.message,
      sdk: 'stripe',
      requestId,
    })
  }

  // Map card errors and other types
  const code = stripeError.code
    ? stripeError.code.toUpperCase()
    : stripeError.type.toUpperCase()

  const details: Record<string, unknown> = {
    stripeType: stripeError.type,
  }

  if (stripeError.code) {
    details.stripeCode = stripeError.code
  }
  if (stripeError.decline_code) {
    details.declineCode = stripeError.decline_code
  }
  if (stripeError.param) {
    details.param = stripeError.param
  }
  if (stripeError.doc_url) {
    details.docUrl = stripeError.doc_url
  }

  return new CompatError({
    code,
    message: stripeError.message,
    statusCode,
    sdk: 'stripe',
    requestId,
    details,
  })
}

interface OpenAIError {
  message: string
  type: string
  code?: string | null
  param?: string | null
}

export function fromOpenAIError(
  openaiError: OpenAIError,
  statusCode: number,
  requestId?: string
): CompatError {
  // Map rate limit errors
  if (openaiError.type === 'rate_limit_error') {
    return new RateLimitError({
      message: openaiError.message,
      sdk: 'openai',
      requestId,
    })
  }

  const code = (openaiError.code || openaiError.type).toUpperCase()

  return new CompatError({
    code,
    message: openaiError.message,
    statusCode,
    sdk: 'openai',
    requestId,
  })
}

interface AWSError {
  name: string
  message: string
  $fault: 'client' | 'server'
  $metadata: {
    httpStatusCode: number
    requestId?: string
    extendedRequestId?: string
  }
}

export function fromAWSError(awsError: AWSError, sdk: string): CompatError {
  const statusCode = awsError.$metadata.httpStatusCode
  const requestId = awsError.$metadata.requestId

  const details: Record<string, unknown> = {
    awsErrorName: awsError.name,
    fault: awsError.$fault,
  }

  if (awsError.$metadata.extendedRequestId) {
    details.extendedRequestId = awsError.$metadata.extendedRequestId
  }

  // Map server faults to ServiceError
  if (awsError.$fault === 'server') {
    return new ServiceError({
      message: awsError.message,
      statusCode,
      sdk,
      requestId,
      details,
      retryable: true,
    })
  }

  // Convert error name to code format (PascalCase to SCREAMING_SNAKE_CASE)
  const code = awsError.name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()

  // Map 404s to NotFoundError but preserve the original code
  if (statusCode === 404) {
    const error = new NotFoundError({
      message: awsError.message,
      sdk,
      requestId,
      details,
    })
    // Override the code to use the AWS error name
    ;(error as { code: string }).code = code
    return error
  }

  return new CompatError({
    code,
    message: awsError.message,
    statusCode,
    sdk,
    requestId,
    details,
  })
}
