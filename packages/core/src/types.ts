/**
 * @dotdo/core/types.ts - Shared Types
 *
 * Re-exports all types from errors and retry modules for convenience.
 */

// Error types
export type {
  CompatErrorOptions,
  ValidationErrorOptions,
  AuthenticationErrorOptions,
  AuthorizationErrorOptions,
  NotFoundErrorOptions,
  RateLimitErrorOptions,
  ServiceErrorOptions,
  ToResponseOptions,
} from './errors'

// Retry types
export type {
  RetryConfig,
  RetryContext,
  RetryEvent,
  CircuitState,
  CircuitBreakerConfig,
  ICircuitBreaker,
  RetryHandler,
} from './retry'
