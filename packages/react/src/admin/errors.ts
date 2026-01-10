/**
 * Admin Error Handling
 *
 * Unified error types and utilities for the admin data layer.
 *
 * @module @dotdo/react/admin
 */

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Error codes for admin operations
 */
export type AdminErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN'

// =============================================================================
// Error Details
// =============================================================================

/**
 * Detailed error information
 */
export interface AdminErrorDetails {
  /** Error code for programmatic handling */
  code: AdminErrorCode
  /** Human-readable message */
  message: string
  /** HTTP status code if applicable */
  status?: number
  /** Resource name where error occurred */
  resource?: string
  /** Record ID if applicable */
  recordId?: string
  /** Field-level validation errors */
  fieldErrors?: Record<string, string[]>
  /** Original error for debugging */
  originalError?: unknown
  /** Whether the operation can be retried */
  retryable?: boolean
  /** Suggested retry delay in ms */
  retryAfter?: number
}

// =============================================================================
// AdminError Class
// =============================================================================

/**
 * Structured error class for admin operations.
 *
 * Provides consistent error handling across all data provider operations.
 *
 * @example
 * ```ts
 * try {
 *   await dataProvider.create({ resource: 'User', data })
 * } catch (err) {
 *   if (isAdminError(err) && err.code === 'VALIDATION_ERROR') {
 *     // Handle validation errors
 *     console.log(err.fieldErrors)
 *   }
 * }
 * ```
 */
export class AdminError extends Error {
  readonly code: AdminErrorCode
  readonly status?: number
  readonly resource?: string
  readonly recordId?: string
  readonly fieldErrors?: Record<string, string[]>
  readonly originalError?: unknown
  readonly retryable: boolean
  readonly retryAfter?: number

  constructor(details: AdminErrorDetails) {
    super(details.message)
    this.name = 'AdminError'
    this.code = details.code
    this.status = details.status
    this.resource = details.resource
    this.recordId = details.recordId
    this.fieldErrors = details.fieldErrors
    this.originalError = details.originalError
    this.retryable = details.retryable ?? isRetryableCode(details.code)
    this.retryAfter = details.retryAfter

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AdminError)
    }

    // Ensure instanceof works correctly
    Object.setPrototypeOf(this, AdminError.prototype)
  }

  /**
   * Create an AdminError from an HTTP response
   */
  static fromResponse(
    response: Response,
    resource?: string,
    body?: unknown
  ): AdminError {
    const code = httpStatusToCode(response.status)
    const message = extractMessage(body, response.statusText)

    return new AdminError({
      code,
      message,
      status: response.status,
      resource,
      fieldErrors: extractFieldErrors(body),
      retryable: response.status >= 500 || response.status === 429,
      retryAfter: parseRetryAfter(response.headers.get('Retry-After')),
    })
  }

  /**
   * Create an AdminError from a network error
   */
  static fromNetworkError(error: Error, resource?: string): AdminError {
    return new AdminError({
      code: 'NETWORK_ERROR',
      message: `Network error: ${error.message}`,
      resource,
      originalError: error,
      retryable: true,
    })
  }

  /**
   * Create an AdminError from a validation error
   */
  static fromValidation(
    fieldErrors: Record<string, string[]>,
    resource?: string
  ): AdminError {
    const fieldMessages = Object.entries(fieldErrors)
      .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
      .join('; ')

    return new AdminError({
      code: 'VALIDATION_ERROR',
      message: `Validation failed - ${fieldMessages}`,
      resource,
      fieldErrors,
      retryable: false,
    })
  }

  /**
   * Create a not found error
   */
  static notFound(resource: string, id: string): AdminError {
    return new AdminError({
      code: 'NOT_FOUND',
      message: `${resource} with ID ${id} not found`,
      status: 404,
      resource,
      recordId: id,
      retryable: false,
    })
  }

  /**
   * Get a user-friendly error message
   */
  toUserMessage(): string {
    switch (this.code) {
      case 'VALIDATION_ERROR':
        return 'Please check the form for errors and try again.'
      case 'NOT_FOUND':
        return 'The requested item could not be found.'
      case 'NETWORK_ERROR':
        return 'Unable to connect. Please check your internet connection.'
      case 'UNAUTHORIZED':
        return 'Please log in to continue.'
      case 'FORBIDDEN':
        return 'You do not have permission to perform this action.'
      case 'CONFLICT':
        return 'This item has been modified. Please refresh and try again.'
      case 'RATE_LIMITED':
        return 'Too many requests. Please wait a moment and try again.'
      case 'TIMEOUT':
        return 'The request took too long. Please try again.'
      case 'SERVER_ERROR':
        return 'Something went wrong on our end. Please try again later.'
      default:
        return 'An unexpected error occurred. Please try again.'
    }
  }
}

// =============================================================================
// Type Guards and Utilities
// =============================================================================

/**
 * Type guard to check if an error is an AdminError
 */
export function isAdminError(error: unknown): error is AdminError {
  return error instanceof AdminError
}

/**
 * Format any error into an AdminError
 */
export function formatAdminError(
  error: unknown,
  resource?: string
): AdminError {
  if (isAdminError(error)) {
    return error
  }

  if (error instanceof Error) {
    // Check for network-related errors
    if (
      error.name === 'TypeError' ||
      error.message.includes('fetch') ||
      error.message.includes('network')
    ) {
      return AdminError.fromNetworkError(error, resource)
    }

    return new AdminError({
      code: 'UNKNOWN',
      message: error.message,
      resource,
      originalError: error,
    })
  }

  return new AdminError({
    code: 'UNKNOWN',
    message: String(error),
    resource,
    originalError: error,
  })
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Map HTTP status codes to AdminErrorCode
 */
function httpStatusToCode(status: number): AdminErrorCode {
  if (status === 400) return 'VALIDATION_ERROR'
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 429) return 'RATE_LIMITED'
  if (status === 408) return 'TIMEOUT'
  if (status >= 500) return 'SERVER_ERROR'
  return 'UNKNOWN'
}

/**
 * Check if an error code is retryable
 */
function isRetryableCode(code: AdminErrorCode): boolean {
  return ['NETWORK_ERROR', 'RATE_LIMITED', 'TIMEOUT', 'SERVER_ERROR'].includes(
    code
  )
}

/**
 * Extract error message from response body
 */
function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.error === 'string') return obj.error
    if (obj.error && typeof obj.error === 'object') {
      const err = obj.error as Record<string, unknown>
      if (typeof err.message === 'string') return err.message
    }
  }
  return fallback
}

/**
 * Extract field errors from response body
 */
function extractFieldErrors(
  body: unknown
): Record<string, string[]> | undefined {
  if (!body || typeof body !== 'object') return undefined

  const obj = body as Record<string, unknown>

  // Check common field error formats
  if (obj.fieldErrors && typeof obj.fieldErrors === 'object') {
    return obj.fieldErrors as Record<string, string[]>
  }

  if (obj.errors && typeof obj.errors === 'object') {
    return obj.errors as Record<string, string[]>
  }

  // Zod-style errors
  if (Array.isArray(obj.issues)) {
    const fieldErrors: Record<string, string[]> = {}
    for (const issue of obj.issues) {
      if (issue && typeof issue === 'object' && 'path' in issue) {
        const path = Array.isArray(issue.path)
          ? issue.path.join('.')
          : String(issue.path)
        if (!fieldErrors[path]) {
          fieldErrors[path] = []
        }
        fieldErrors[path].push(String(issue.message || 'Invalid value'))
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return fieldErrors
    }
  }

  return undefined
}

/**
 * Parse Retry-After header
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined

  // Try parsing as number of seconds
  const seconds = parseInt(value, 10)
  if (!isNaN(seconds)) {
    return seconds * 1000
  }

  // Try parsing as HTTP date
  const date = new Date(value)
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now())
  }

  return undefined
}
