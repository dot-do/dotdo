/**
 * Unified Error Handling for Workflow Compat Layers
 *
 * Maps between dotdo errors and platform-native errors.
 *
 * This module provides a consistent error hierarchy that can be translated
 * to/from platform-specific errors (Inngest, Temporal, Trigger.dev, QStash).
 *
 * @example
 * ```typescript
 * import { DotdoRetryableError, mapToNativeError } from '@dotdo/workflows/compat/errors'
 *
 * // Throw a dotdo error that will be mapped to the correct platform error
 * throw new DotdoRetryableError('Service temporarily unavailable', 5000)
 *
 * // Map dotdo error to platform-native error
 * const nativeError = mapToNativeError(dotdoError, 'inngest')
 * ```
 */

// ============================================================================
// BASE ERROR TYPES
// ============================================================================

/**
 * Base error class for all dotdo workflow errors
 */
export class DotdoError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message)
    this.name = 'DotdoError'
  }
}

/**
 * Error that should be retried
 *
 * Use this when an operation failed but may succeed on retry
 * (e.g., network errors, rate limits, temporary service outages)
 */
export class DotdoRetryableError extends DotdoError {
  constructor(
    message: string,
    public readonly retryAfter?: number,
    public readonly maxRetries?: number
  ) {
    super(message, 'RETRYABLE')
    this.name = 'DotdoRetryableError'
  }
}

/**
 * Error that should NOT be retried
 *
 * Use this when retrying would not help
 * (e.g., validation errors, permission denied, resource not found)
 */
export class DotdoNonRetryableError extends DotdoError {
  constructor(message: string) {
    super(message, 'NON_RETRYABLE')
    this.name = 'DotdoNonRetryableError'
  }
}

/**
 * Error indicating an operation timed out
 */
export class DotdoTimeoutError extends DotdoError {
  constructor(
    message: string,
    public readonly timeoutMs: number
  ) {
    super(message, 'TIMEOUT')
    this.name = 'DotdoTimeoutError'
  }
}

/**
 * Error indicating an operation was cancelled
 */
export class DotdoCancellationError extends DotdoError {
  constructor(message: string = 'Operation was cancelled') {
    super(message, 'CANCELLED')
    this.name = 'DotdoCancellationError'
  }
}

/**
 * Error indicating a feature is not implemented in a specific platform compat layer
 */
export class DotdoNotImplementedError extends DotdoError {
  constructor(feature: string, platform: string) {
    super(
      `${feature} is not implemented in @dotdo/${platform}. ` +
        `See https://dotdo.dev/docs/${platform}/feature-parity for alternatives.`,
      'NOT_IMPLEMENTED'
    )
    this.name = 'DotdoNotImplementedError'
  }
}

/**
 * Error indicating a step/activity failed
 */
export class DotdoStepError extends DotdoError {
  constructor(
    message: string,
    public readonly stepId: string,
    public readonly cause?: Error
  ) {
    super(message, 'STEP_FAILED')
    this.name = 'DotdoStepError'
  }
}

/**
 * Error indicating a workflow invocation timed out
 */
export class DotdoInvokeTimeoutError extends DotdoError {
  constructor(
    public readonly workflowId: string,
    public readonly timeout: number
  ) {
    super(`Invoked workflow ${workflowId} timed out after ${timeout}ms`, 'INVOKE_TIMEOUT')
    this.name = 'DotdoInvokeTimeoutError'
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a value is an Error
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error
}

/**
 * Type guard to check if an error is a DotdoError
 */
export function isDotdoError(error: unknown): error is DotdoError {
  return error instanceof DotdoError
}

/**
 * Type guard to check if an error is retryable
 */
export function isRetryableError(error: unknown): error is DotdoRetryableError {
  return error instanceof DotdoRetryableError
}

/**
 * Type guard to check if an error is non-retryable
 */
export function isNonRetryableError(error: unknown): error is DotdoNonRetryableError {
  return error instanceof DotdoNonRetryableError
}

/**
 * Type guard to check if an error is a cancellation
 */
export function isCancellationError(error: unknown): error is DotdoCancellationError {
  return error instanceof DotdoCancellationError
}

/**
 * Type guard to check if an error is a timeout
 */
export function isTimeoutError(error: unknown): error is DotdoTimeoutError {
  return error instanceof DotdoTimeoutError
}

/**
 * Ensure a value is an Error, converting if necessary
 */
export function ensureError(error: unknown): Error {
  if (isError(error)) return error
  return new Error(String(error))
}

// ============================================================================
// PLATFORM MAPPING
// ============================================================================

/**
 * Supported workflow platforms for error mapping
 */
export type Platform = 'inngest' | 'temporal' | 'qstash' | 'trigger'

/**
 * Map a DotdoError to the equivalent platform-native error
 *
 * This allows dotdo code to throw unified errors while ensuring
 * platform-specific behavior is preserved.
 *
 * @example
 * ```typescript
 * try {
 *   await someOperation()
 * } catch (error) {
 *   if (isDotdoError(error)) {
 *     throw mapToNativeError(error, 'inngest')
 *   }
 *   throw error
 * }
 * ```
 */
export function mapToNativeError(error: DotdoError, platform: Platform): Error {
  switch (platform) {
    case 'inngest':
      if (error instanceof DotdoNonRetryableError) {
        // Return Inngest's NonRetriableError equivalent
        const err = new Error(error.message) as Error & { isNonRetriableError?: boolean }
        err.name = 'NonRetriableError'
        err.isNonRetriableError = true
        return err
      }
      if (error instanceof DotdoRetryableError) {
        const err = new Error(error.message) as Error & {
          isRetryAfterError?: boolean
          retryAfter?: number
        }
        err.name = 'RetryAfterError'
        err.isRetryAfterError = true
        err.retryAfter = error.retryAfter
        return err
      }
      if (error instanceof DotdoStepError) {
        const err = new Error(error.message) as Error & {
          isStepError?: boolean
          stepId?: string
        }
        err.name = 'StepError'
        err.isStepError = true
        err.stepId = error.stepId
        return err
      }
      if (error instanceof DotdoCancellationError) {
        const err = new Error(error.message) as Error & { isCancellationError?: boolean }
        err.name = 'CancellationError'
        err.isCancellationError = true
        return err
      }
      break

    case 'temporal':
      if (error instanceof DotdoTimeoutError) {
        const err = new Error(error.message)
        err.name = 'TimeoutError'
        return err
      }
      if (error instanceof DotdoCancellationError) {
        const err = new Error(error.message)
        err.name = 'CancelledFailure'
        return err
      }
      if (error instanceof DotdoNonRetryableError) {
        const err = new Error(error.message) as Error & {
          nonRetryable?: boolean
        }
        err.name = 'ApplicationFailure'
        err.nonRetryable = true
        return err
      }
      break

    case 'qstash':
      // QStash doesn't have specific error types, but we can add headers context
      // The error is typically handled by retry logic
      if (error instanceof DotdoRetryableError) {
        const err = new Error(error.message) as Error & {
          retryAfter?: number
          shouldRetry?: boolean
        }
        err.retryAfter = error.retryAfter
        err.shouldRetry = true
        return err
      }
      if (error instanceof DotdoNonRetryableError) {
        const err = new Error(error.message) as Error & { shouldRetry?: boolean }
        err.shouldRetry = false
        return err
      }
      break

    case 'trigger':
      if (error instanceof DotdoCancellationError) {
        const err = new Error(error.message) as Error & { isAbortTaskRunError?: boolean }
        err.name = 'AbortTaskRunError'
        err.isAbortTaskRunError = true
        return err
      }
      if (error instanceof DotdoNonRetryableError) {
        // Trigger.dev uses AbortTaskRunError for non-retryable errors
        const err = new Error(error.message) as Error & { isAbortTaskRunError?: boolean }
        err.name = 'AbortTaskRunError'
        err.isAbortTaskRunError = true
        return err
      }
      break
  }

  // Return original error if no specific mapping
  return error
}

/**
 * Map a platform-native error to the equivalent DotdoError
 *
 * This allows handling platform-specific errors in a unified way.
 *
 * @example
 * ```typescript
 * try {
 *   await inngestFunction()
 * } catch (error) {
 *   const dotdoError = mapFromNativeError(error, 'inngest')
 *   if (isRetryableError(dotdoError)) {
 *     // Handle retryable error
 *   }
 * }
 * ```
 */
export function mapFromNativeError(error: Error, platform: Platform): DotdoError {
  const message = error.message

  switch (platform) {
    case 'inngest':
      if (error.name === 'NonRetriableError' || (error as any).isNonRetriableError) {
        return new DotdoNonRetryableError(message)
      }
      if (error.name === 'RetryAfterError' || (error as any).isRetryAfterError) {
        return new DotdoRetryableError(message, (error as any).retryAfter)
      }
      if (error.name === 'StepError' || (error as any).isStepError) {
        return new DotdoStepError(message, (error as any).stepId, error)
      }
      if (error.name === 'CancellationError' || (error as any).isCancellationError) {
        return new DotdoCancellationError(message)
      }
      if (error.name === 'InvokeTimeoutError' || (error as any).isInvokeTimeoutError) {
        return new DotdoInvokeTimeoutError((error as any).functionId, (error as any).timeout)
      }
      break

    case 'temporal':
      if (error.name === 'TimeoutError') {
        return new DotdoTimeoutError(message, 0)
      }
      if (error.name === 'CancelledFailure') {
        return new DotdoCancellationError(message)
      }
      if (error.name === 'ApplicationFailure' && (error as any).nonRetryable) {
        return new DotdoNonRetryableError(message)
      }
      break

    case 'qstash':
      // QStash errors are typically HTTP-based
      if ((error as any).shouldRetry === false) {
        return new DotdoNonRetryableError(message)
      }
      if ((error as any).shouldRetry === true || (error as any).retryAfter !== undefined) {
        return new DotdoRetryableError(message, (error as any).retryAfter)
      }
      break

    case 'trigger':
      if (error.name === 'AbortTaskRunError' || (error as any).isAbortTaskRunError) {
        return new DotdoCancellationError(message)
      }
      break
  }

  return new DotdoError(message, 'UNKNOWN')
}

// ============================================================================
// ERROR WRAPPING UTILITIES
// ============================================================================

/**
 * Wrap an error with additional context
 */
export function wrapError(error: unknown, context: string): DotdoError {
  const baseError = ensureError(error)
  const wrappedMessage = `${context}: ${baseError.message}`

  if (isDotdoError(error)) {
    // Preserve the error type
    if (error instanceof DotdoRetryableError) {
      return new DotdoRetryableError(wrappedMessage, error.retryAfter, error.maxRetries)
    }
    if (error instanceof DotdoNonRetryableError) {
      return new DotdoNonRetryableError(wrappedMessage)
    }
    if (error instanceof DotdoTimeoutError) {
      return new DotdoTimeoutError(wrappedMessage, error.timeoutMs)
    }
    if (error instanceof DotdoCancellationError) {
      return new DotdoCancellationError(wrappedMessage)
    }
    if (error instanceof DotdoStepError) {
      return new DotdoStepError(wrappedMessage, error.stepId, error.cause)
    }
    return new DotdoError(wrappedMessage, error.code)
  }

  return new DotdoError(wrappedMessage, 'WRAPPED')
}

/**
 * Create a non-retryable error from any error
 */
export function toNonRetryable(error: unknown): DotdoNonRetryableError {
  const baseError = ensureError(error)
  return new DotdoNonRetryableError(baseError.message)
}

/**
 * Create a retryable error from any error
 */
export function toRetryable(error: unknown, retryAfter?: number, maxRetries?: number): DotdoRetryableError {
  const baseError = ensureError(error)
  return new DotdoRetryableError(baseError.message, retryAfter, maxRetries)
}
