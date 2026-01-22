// Re-exports for @dotdo/rpc errors module
// This file provides a single entry point for all error-related exports
// RPC errors extend the base types from @dotdo/db for ecosystem consistency
// Export all base error classes, types, and utilities
export { 
// Error codes - both legacy RPC and unified ErrorCode
RPCErrorCode, ErrorCode, ERROR_CODE_TO_HTTP_STATUS, getHttpStatusForCode, isRetryableCode, 
// Base error classes
DotdoError, RPCError, 
// Specific error types
NotFoundError, ValidationError, AuthenticationError, AuthorizationError, ConflictError, RateLimitError, PayloadTooLargeError, TimeoutError, NetworkError, InternalError, ServiceUnavailableError, TransportError, CircuitOpenError, 
// Type guards
isRPCError, isNotFoundError, isValidationError, isAuthenticationError, isAuthorizationError, isPayloadTooLargeError, isCircuitOpenError, isTransportError, isRetryableError, serializeError, serializeUnknownError, getErrorMessage, isSerializedError, deserializeError, handleHTTPError, handleResponseError, serializeErrorResponse, createErrorResponse, } from './base';
// Export retry utilities
export { calculateJitteredDelay, retryWithBackoff, withTimeout, } from './retry';
// Export circuit breaker
export { CircuitState, CircuitBreaker, RetryWithCircuitBreaker, } from './circuit-breaker';
//# sourceMappingURL=index.js.map