/**
 * @dotdo/core - Core SDK Infrastructure
 *
 * Unified error handling and retry infrastructure for all dotdo compat SDKs.
 *
 * @example Error handling
 * ```typescript
 * import { CompatError, ValidationError, wrapError, toResponse } from '@dotdo/core'
 *
 * // Create typed errors
 * throw new ValidationError({
 *   message: 'Invalid email format',
 *   field: 'email',
 *   value: input.email
 * })
 *
 * // Wrap SDK errors
 * try {
 *   await stripeClient.charges.create(...)
 * } catch (e) {
 *   throw wrapError(e, 'stripe')
 * }
 *
 * // Convert to HTTP response
 * const response = toResponse(error)
 * ```
 *
 * @example Retry handling
 * ```typescript
 * import { createRetryHandler } from '@dotdo/core'
 *
 * const retry = createRetryHandler({
 *   maxRetries: 3,
 *   initialDelay: 1000,
 * })
 *
 * // Retry any async function
 * const result = await retry.execute(() => fetchData())
 *
 * // Retry fetch with Retry-After header support
 * const response = await retry.fetch(url, options)
 * ```
 */

// =============================================================================
// Error Classes
// =============================================================================

export {
  CompatError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ServiceError,
} from './errors'

// =============================================================================
// Error Utilities
// =============================================================================

export {
  isCompatError,
  wrapError,
  toResponse,
} from './errors'

// =============================================================================
// SDK-Specific Mappers
// =============================================================================

export {
  fromStripeError,
  fromOpenAIError,
  fromAWSError,
} from './errors'

// =============================================================================
// Retry Infrastructure
// =============================================================================

export {
  createRetryHandler,
  isRetryableStatus,
  parseRetryAfter,
  calculateExponentialBackoff,
  CircuitBreaker,
  DEFAULT_RETRY_CONFIG,
} from './retry'

// =============================================================================
// Types
// =============================================================================

export type {
  // Error types
  CompatErrorOptions,
  ValidationErrorOptions,
  AuthenticationErrorOptions,
  AuthorizationErrorOptions,
  NotFoundErrorOptions,
  RateLimitErrorOptions,
  ServiceErrorOptions,
  ToResponseOptions,
  // Retry types
  RetryConfig,
  RetryContext,
  RetryEvent,
  CircuitState,
  CircuitBreakerConfig,
  ICircuitBreaker,
  RetryHandler,
} from './types'
