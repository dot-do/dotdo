/**
 * ErrorHandler - Safe Catch Handler Utilities for bashx.do
 *
 * Provides safe patterns for handling errors in catch blocks, replacing:
 * - `error as { code?: string }` without validation
 * - `error instanceof Error ? error.message : String(error)`
 * - Silent catch handlers returning null
 * - All errors returning HTTP 400 (should be 400 vs 500)
 *
 * Usage:
 * ```typescript
 * try {
 *   await execute(command)
 * } catch (error) {
 *   // Instead of: const err = error as { code?: string; message?: string }
 *   // Use:
 *   const wrapped = ErrorHandler.wrap(error, { command })
 *   const httpError = ErrorHandler.toHttpError(error)
 *   return c.json(httpError, httpError.status)
 * }
 * ```
 *
 * @packageDocumentation
 */

import {
  BashxError,
  fromError,
  getErrorMessage,
  isBashxError,
  type ErrorCode,
  type ErrorContext,
} from './bashx-error.js'

// ============================================================================
// HTTP Error Response Types
// ============================================================================

/**
 * HTTP error response format for API endpoints.
 *
 * Used by worker.ts and other HTTP handlers to return consistent error responses.
 */
export interface HttpErrorResponse {
  /** Always true for error responses */
  error: true
  /** Error code for programmatic handling */
  code: string
  /** Human-readable error message */
  message: string
  /** HTTP status code */
  status: number
  /** Optional recovery hint */
  hint?: string
}

// ============================================================================
// HTTP Status Code Mapping
// ============================================================================

/**
 * Map error codes to appropriate HTTP status codes.
 *
 * - 400: Client errors (bad input, invalid commands, safety blocked)
 * - 429: Rate limit exceeded
 * - 500: Server/execution errors
 * - 502: Upstream/RPC errors
 * - 503: Service unavailable (circuit breaker)
 * - 504: Timeout errors
 */
const HTTP_STATUS_MAP: Record<ErrorCode, number> = {
  // Client errors (400)
  PARSE_ERROR: 400,
  COMMAND_NOT_FOUND: 400,
  SAFETY_BLOCKED: 400,

  // Rate limiting (429)
  RATE_LIMIT_ERROR: 429,

  // Server/execution errors (500)
  EXECUTION_ERROR: 500,
  TIER_EXECUTION_ERROR: 500,
  UNKNOWN_ERROR: 500,

  // Upstream errors (502)
  NETWORK_ERROR: 502,
  RPC_ERROR: 502,

  // Service unavailable (503)
  CIRCUIT_OPEN: 503,

  // Timeout (504)
  TIMEOUT_ERROR: 504,
}

/**
 * Client error codes that should return 4xx status.
 */
const CLIENT_ERROR_CODES: Set<ErrorCode> = new Set([
  'PARSE_ERROR',
  'COMMAND_NOT_FOUND',
  'SAFETY_BLOCKED',
])

// ============================================================================
// ErrorHandler Class
// ============================================================================

/**
 * ErrorHandler - Utility class for safe error handling in catch blocks.
 *
 * This class provides static methods to replace unsafe error handling patterns
 * across the codebase. All methods handle unknown error types safely.
 *
 * @example Basic wrapping
 * ```typescript
 * catch (error) {
 *   // Instead of: const err = error as { code?: string }
 *   const wrapped = ErrorHandler.wrap(error, { command: 'ls' })
 *   console.error(wrapped.message, wrapped.code, wrapped.context)
 * }
 * ```
 *
 * @example HTTP error response
 * ```typescript
 * catch (error) {
 *   // Instead of: return c.json({ error: true }, 400)
 *   const httpError = ErrorHandler.toHttpError(error)
 *   return c.json(httpError, httpError.status)
 * }
 * ```
 */
export class ErrorHandler {
  /**
   * Safely wrap any thrown value as a BashxError.
   *
   * If the error is already a BashxError, it is returned unchanged.
   * Otherwise, it is wrapped using fromError() with optional context.
   *
   * This replaces the pattern:
   * ```typescript
   * // OLD (unsafe):
   * const err = error as { code?: string; message?: string }
   *
   * // NEW (safe):
   * const wrapped = ErrorHandler.wrap(error, { command })
   * ```
   *
   * @param error - Unknown error value from catch block
   * @param context - Optional context to add to the error
   * @returns BashxError instance
   */
  static wrap(error: unknown, context?: ErrorContext & { code?: ErrorCode }): BashxError {
    // Already a BashxError - return unchanged (preserves subclass type)
    if (isBashxError(error)) {
      return error
    }

    // Wrap unknown error with context
    return fromError(error, context)
  }

  /**
   * Convert any error to an HTTP-appropriate error response.
   *
   * Determines the correct HTTP status code based on error type:
   * - 400: Client errors (parse, command not found, safety blocked)
   * - 429: Rate limit errors
   * - 500: Execution/unknown errors
   * - 502: Network/RPC errors
   * - 503: Circuit breaker open
   * - 504: Timeout errors
   *
   * @param error - Unknown error value from catch block
   * @returns HTTP error response with appropriate status code
   *
   * @example
   * ```typescript
   * catch (error) {
   *   // Instead of: return c.json({ error: true, message: err.message }, 400)
   *   const httpError = ErrorHandler.toHttpError(error)
   *   return c.json(httpError, httpError.status)
   * }
   * ```
   */
  static toHttpError(error: unknown): HttpErrorResponse {
    const wrapped = ErrorHandler.wrap(error)
    const status = HTTP_STATUS_MAP[wrapped.code] ?? 500

    const response: HttpErrorResponse = {
      error: true,
      code: wrapped.code,
      message: wrapped.message,
      status,
    }

    if (wrapped.hint) {
      response.hint = wrapped.hint
    }

    return response
  }

  /**
   * Safely extract an error code from any value.
   *
   * Returns the error code if available, otherwise 'UNKNOWN_ERROR'.
   * Works with BashxError, plain Error with code property, and error-like objects.
   *
   * @param error - Unknown error value
   * @returns Error code string
   *
   * @example
   * ```typescript
   * catch (error) {
   *   const code = ErrorHandler.getCode(error)
   *   console.log(`Error code: ${code}`)
   * }
   * ```
   */
  static getCode(error: unknown): string {
    // BashxError - return typed code
    if (isBashxError(error)) {
      return error.code
    }

    // Error-like object with code property
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as { code: unknown }).code === 'string'
    ) {
      return (error as { code: string }).code
    }

    return 'UNKNOWN_ERROR'
  }

  /**
   * Check if an error is a client error (4xx) vs server error (5xx).
   *
   * Client errors are caused by invalid input:
   * - ParseError (invalid syntax)
   * - CommandNotFoundError (invalid command)
   * - SafetyBlockedError (dangerous command)
   *
   * @param error - Unknown error value
   * @returns True if the error is a client error (should return 4xx)
   */
  static isClientError(error: unknown): boolean {
    if (isBashxError(error)) {
      return CLIENT_ERROR_CODES.has(error.code)
    }
    return false
  }

  /**
   * Safely extract an error message from any value.
   *
   * This is an alias for getErrorMessage() for API consistency.
   *
   * @param error - Unknown error value
   * @returns Error message string
   */
  static getMessage(error: unknown): string {
    return getErrorMessage(error)
  }
}
