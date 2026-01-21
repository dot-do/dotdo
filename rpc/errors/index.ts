// Re-exports for @dotdo/rpc errors module
// This file provides a single entry point for all error-related exports

// Export all base error classes, types, and utilities
export {
  // Error codes
  RPCErrorCode,

  // Base error class and options
  RPCError,
  type RPCErrorOptions,

  // Specific error types
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  RateLimitError,
  TimeoutError,
  NetworkError,
  InternalError,
  ServiceUnavailableError,
  TransportError,
  CircuitOpenError,

  // Type guards
  isRPCError,
  isNotFoundError,
  isValidationError,
  isAuthenticationError,
  isAuthorizationError,
  isCircuitOpenError,
  isTransportError,
  isRetryableError,

  // Serialization
  type SerializedError,
  type SerializeErrorOptions,
  serializeError,
  serializeUnknownError,
  getErrorMessage,
  isSerializedError,
  deserializeError,
} from './base'

// Export retry utilities
export {
  type RetryOptions,
  retryWithBackoff,
  withTimeout,
} from './retry'

// Export circuit breaker
export {
  CircuitState,
  type CircuitBreakerOptions,
  type CircuitMetrics,
  CircuitBreaker,
  type RetryWithCircuitBreakerOptions,
  type RetryCircuitBreakerMetrics,
  RetryWithCircuitBreaker,
} from './circuit-breaker'
