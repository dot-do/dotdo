/**
 * @dotdo/compat/core/errors.ts - Unified Error Format
 *
 * Re-exports all error types from @dotdo/core to ensure a single source of truth.
 * This prevents instanceof checks from failing across module boundaries.
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

// Re-export everything from packages/core/src/errors for consistency
// This ensures instanceof checks work across module boundaries
export {
  // Error Classes
  CompatError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ServiceError,
  // Type Guards
  isCompatError,
  // Utilities
  wrapError,
  toResponse,
  safeSerialize,
  // SDK Mappers
  fromStripeError,
  fromOpenAIError,
  fromAWSError,
} from '../../packages/core/src/errors'

// Re-export types for backwards compatibility
export type {
  CompatErrorOptions,
  ValidationErrorOptions,
  AuthenticationErrorOptions,
  AuthorizationErrorOptions,
  NotFoundErrorOptions,
  RateLimitErrorOptions,
  ServiceErrorOptions,
  ToResponseOptions,
} from '../../packages/core/src/errors'
