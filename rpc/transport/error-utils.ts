// Error Utilities for Unified Transport Error Handling
// Provides shared utilities for normalizing and categorizing errors across all transports

import {
  type SerializedError,
  ErrorCode,
  isRetryableCode,
  TransportError,
  TimeoutError,
  NetworkError,
  ValidationError,
} from '../errors'
import type { ErrorCategory, ErrorContext, ErrorInterceptor, RPCMessage, TransportType } from './types'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * Determine the error category from an error code
 */
export function getErrorCategory(code: string, httpStatus?: number): ErrorCategory {
  switch (code) {
    case ErrorCode.TIMEOUT:
      return 'timeout'
    case ErrorCode.NETWORK_ERROR:
    case ErrorCode.SERVICE_UNAVAILABLE:
      return 'network'
    case ErrorCode.VALIDATION_ERROR:
      return 'validation'
    case ErrorCode.CIRCUIT_OPEN:
      return 'transport'
    default:
      // Check HTTP status for server errors
      if (httpStatus !== undefined) {
        if (httpStatus >= 500) return 'server'
        if (httpStatus >= 400) return 'validation'
      }
      return 'server'
  }
}

/**
 * Create a normalized serialized error with consistent structure
 */
export interface NormalizedErrorOptions {
  type: string
  code: string
  message: string
  httpStatus?: ContentfulStatusCode
  details?: Record<string, unknown>
}

export function createNormalizedError(options: NormalizedErrorOptions): SerializedError {
  const { type, code, message, httpStatus, details } = options
  const error: SerializedError = {
    type,
    name: type, // Include name for backward compatibility
    code,
    message,
  }
  if (httpStatus !== undefined) {
    error.httpStatus = httpStatus
  }
  if (details !== undefined) {
    error.details = details
  }
  return error
}

/**
 * Create a timeout error with normalized structure
 */
export function createTimeoutError(timeoutMs: number, transportType: TransportType): SerializedError {
  return createNormalizedError({
    type: 'TimeoutError',
    code: ErrorCode.TIMEOUT,
    message: `Request timed out after ${timeoutMs}ms`,
    httpStatus: 504,
    details: { timeout: timeoutMs, transportType },
  })
}

/**
 * Create a network error with normalized structure
 */
export function createNetworkError(
  message: string,
  transportType: TransportType,
  details?: Record<string, unknown>
): SerializedError {
  return createNormalizedError({
    type: 'NetworkError',
    code: ErrorCode.NETWORK_ERROR,
    message,
    httpStatus: 503,
    details: { transportType, ...details },
  })
}

/**
 * Create a transport error from an underlying error
 */
export function createTransportErrorFromCatch(
  error: unknown,
  transportType: TransportType,
  endpoint?: string
): SerializedError {
  // Handle AbortError/TimeoutError specially
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return createNormalizedError({
        type: 'TimeoutError',
        code: ErrorCode.TIMEOUT,
        message: `Transport timeout: ${error.message}`,
        httpStatus: 504,
        details: {
          transportType,
          endpoint,
          reason: 'timeout',
          originalError: error.name,
        },
      })
    }

    // Network-related errors
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return createNetworkError(
        `Network error: ${error.message}`,
        transportType,
        { endpoint, reason: 'network_failure', originalError: error.name }
      )
    }
  }

  // Generic transport error
  const message = error instanceof Error ? error.message : String(error)
  return createNormalizedError({
    type: 'TransportError',
    code: ErrorCode.NETWORK_ERROR,
    message: `Transport error: ${message}`,
    httpStatus: 503,
    details: {
      transportType,
      endpoint,
      reason: 'unknown',
      originalError: error instanceof Error ? error.name : 'Unknown',
    },
  })
}

/**
 * Create an error context for the error interceptor
 */
export function createErrorContext(params: {
  transportType: TransportType
  message: RPCMessage
  correlationId: string
  error: SerializedError
  endpoint?: string
  attempt?: number
  startTime?: number
}): ErrorContext {
  const { transportType, message, correlationId, error, endpoint, attempt, startTime } = params

  const category = getErrorCategory(error.code, error.httpStatus)
  const retryable = isRetryableCode(error.code)

  const context: ErrorContext = {
    transportType,
    message,
    correlationId,
    category,
    retryable,
  }

  if (endpoint !== undefined) {
    context.endpoint = endpoint
  }
  if (error.httpStatus !== undefined) {
    context.httpStatus = error.httpStatus
  }
  if (attempt !== undefined) {
    context.attempt = attempt
  }
  if (startTime !== undefined) {
    context.durationMs = Date.now() - startTime
  }

  return context
}

/**
 * Apply error interceptor and return the final error
 *
 * This utility handles the interceptor invocation and falls back to the original
 * error if the interceptor returns undefined or throws.
 */
export function applyErrorInterceptor(
  error: SerializedError,
  context: ErrorContext,
  interceptor?: ErrorInterceptor
): SerializedError {
  if (!interceptor) {
    return error
  }

  try {
    const transformed = interceptor(error, context)
    // Return transformed error if provided, otherwise use original
    return transformed ?? error
  } catch {
    // Interceptor threw - use original error
    return error
  }
}

/**
 * Create an error response with normalized structure and optional interceptor
 */
export function createErrorResponse<T>(params: {
  error: SerializedError
  correlationId: string
  transportType: TransportType
  message: RPCMessage
  endpoint?: string
  attempt?: number
  startTime?: number
  onError?: ErrorInterceptor
}): { error: SerializedError; correlationId: string } {
  const { error, correlationId, transportType, message, endpoint, attempt, startTime, onError } = params

  const context = createErrorContext({
    transportType,
    message,
    correlationId,
    error,
    endpoint,
    attempt,
    startTime,
  })

  const finalError = applyErrorInterceptor(error, context, onError)

  return {
    error: finalError,
    correlationId,
  }
}

/**
 * Create a validation error response
 */
export function createValidationErrorResponse(
  errorMessage: string,
  correlationId: string
): SerializedError {
  return createNormalizedError({
    type: 'ValidationError',
    code: ErrorCode.VALIDATION_ERROR,
    message: errorMessage,
    httpStatus: 400,
  })
}

/**
 * Create a generic server error response from HTTP status
 */
export function createServerErrorFromStatus(
  status: number,
  transportType: TransportType,
  statusText?: string
): SerializedError {
  const message = statusText ?? `${transportType} RPC error: ${status}`
  return createNormalizedError({
    type: 'RPCError',
    code: status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_ERROR,
    message,
    httpStatus: status as ContentfulStatusCode,
    details: { transportType },
  })
}

/**
 * Create a transport closed error
 */
export function createTransportClosedError(transportType: TransportType): SerializedError {
  return createNormalizedError({
    type: 'TransportError',
    code: ErrorCode.NETWORK_ERROR,
    message: 'Transport has been closed',
    httpStatus: 503,
    details: { transportType, reason: 'closed' },
  })
}

/**
 * Create a no transport available error
 */
export function createNoTransportError(transportType: TransportType): SerializedError {
  return createNormalizedError({
    type: 'TransportError',
    code: ErrorCode.NETWORK_ERROR,
    message: 'No transport available',
    httpStatus: 503,
    details: { transportType, reason: 'no_transport' },
  })
}

/**
 * Unified error handler options for transport implementations
 */
export interface UnifiedErrorHandlerOptions {
  transportType: TransportType
  endpoint?: string
  onError?: ErrorInterceptor
}

/**
 * Create a unified error handler for transport implementations.
 *
 * This factory creates a consistent error handling function that:
 * - Normalizes errors from different sources (catch blocks, HTTP responses, etc.)
 * - Creates proper error context
 * - Applies error interceptors
 * - Returns consistent error responses
 *
 * @example
 * ```typescript
 * const handleError = createUnifiedErrorHandler({
 *   transportType: 'fetch',
 *   endpoint: 'https://api.example.com',
 *   onError: (error, context) => {
 *     console.error(`[${context.transportType}] ${error.message}`)
 *   }
 * })
 *
 * // In transport implementation:
 * try {
 *   // ... send request
 * } catch (error) {
 *   return handleError.fromCatch(error, message, correlationId, startTime)
 * }
 * ```
 */
export function createUnifiedErrorHandler(options: UnifiedErrorHandlerOptions) {
  const { transportType, endpoint, onError } = options

  return {
    /**
     * Handle an error from a catch block (transport-level errors)
     */
    fromCatch(
      error: unknown,
      message: RPCMessage,
      correlationId: string,
      startTime?: number
    ): { error: SerializedError; correlationId: string } {
      const transportError = createTransportErrorFromCatch(error, transportType, endpoint)
      return createErrorResponse({
        error: transportError,
        correlationId,
        transportType,
        message,
        endpoint,
        startTime,
        onError,
      })
    },

    /**
     * Handle an already-serialized error (e.g., from server response)
     */
    fromSerializedError(
      error: SerializedError,
      message: RPCMessage,
      correlationId: string,
      startTime?: number
    ): { error: SerializedError; correlationId: string } {
      const context = createErrorContext({
        transportType,
        message,
        correlationId,
        error,
        endpoint,
        startTime,
      })
      const finalError = applyErrorInterceptor(error, context, onError)
      return { error: finalError, correlationId }
    },

    /**
     * Handle a timeout error
     */
    fromTimeout(
      timeoutMs: number,
      message: RPCMessage,
      correlationId: string,
      startTime?: number
    ): { error: SerializedError; correlationId: string } {
      const error = createTimeoutError(timeoutMs, transportType)
      return createErrorResponse({
        error,
        correlationId,
        transportType,
        message,
        endpoint,
        startTime,
        onError,
      })
    },

    /**
     * Handle a network error
     */
    fromNetworkError(
      errorMessage: string,
      message: RPCMessage,
      correlationId: string,
      details?: Record<string, unknown>,
      startTime?: number
    ): { error: SerializedError; correlationId: string } {
      const error = createNetworkError(errorMessage, transportType, details)
      return createErrorResponse({
        error,
        correlationId,
        transportType,
        message,
        endpoint,
        startTime,
        onError,
      })
    },

    /**
     * Handle a validation error
     */
    fromValidationError(
      errorMessage: string,
      message: RPCMessage,
      correlationId: string,
      startTime?: number
    ): { error: SerializedError; correlationId: string } {
      const error = createValidationErrorResponse(errorMessage, correlationId)
      return createErrorResponse({
        error,
        correlationId,
        transportType,
        message,
        endpoint,
        startTime,
        onError,
      })
    },

    /**
     * Handle an HTTP status error
     */
    fromHttpStatus(
      status: number,
      message: RPCMessage,
      correlationId: string,
      statusText?: string,
      startTime?: number
    ): { error: SerializedError; correlationId: string } {
      const error = createServerErrorFromStatus(status, transportType, statusText)
      return createErrorResponse({
        error,
        correlationId,
        transportType,
        message,
        endpoint,
        startTime,
        onError,
      })
    },

    /**
     * Handle a transport closed error
     */
    fromClosed(
      message: RPCMessage,
      correlationId: string
    ): { error: SerializedError; correlationId: string } {
      const error = createTransportClosedError(transportType)
      return { error, correlationId }
    },

    /**
     * Handle a no transport available error
     */
    fromNoTransport(
      message: RPCMessage,
      correlationId: string
    ): { error: SerializedError; correlationId: string } {
      const error = createNoTransportError(transportType)
      return { error, correlationId }
    },
  }
}
