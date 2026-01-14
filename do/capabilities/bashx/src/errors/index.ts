/**
 * Bashx Error Module
 *
 * Central export point for the unified error hierarchy.
 *
 * @packageDocumentation
 */

// Re-export all error types from bashx-error
export {
  // Base class
  BashxError,
  // Subclasses
  TierExecutionError,
  CommandNotFoundError,
  BashxTimeoutError,
  BashxRateLimitError,
  ParseError,
  SafetyBlockedError,
  // Factory and type guards
  fromError,
  isBashxError,
  // Helper functions
  getErrorMessage,
  isRetryableError,
  // Types
  type ErrorCode,
  type ErrorContext,
  type SerializedError,
  type TierExecutionErrorOptions,
  type CommandNotFoundErrorOptions,
  type BashxTimeoutErrorOptions,
  type BashxRateLimitErrorOptions,
  type RateLimitProvider,
  type ParseErrorOptions,
  type SafetyBlockedErrorOptions,
  type SafetyImpact,
  type SafetyClassification,
} from './bashx-error.js'

// Backwards-compatible aliases
export { BashxRateLimitError as RateLimitError } from './bashx-error.js'
export { BashxTimeoutError as TimeoutError } from './bashx-error.js'
