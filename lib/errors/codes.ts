/**
 * Standardized Error Codes for the dotdo runtime
 *
 * These codes provide machine-readable identifiers for error conditions
 * that can be used for:
 * - Programmatic error handling
 * - Logging and monitoring
 * - API error responses
 * - Client-side error recovery
 *
 * Error codes follow the pattern: CATEGORY_ACTION_RESULT
 * e.g., STORAGE_WRITE_FAILED, RPC_CALL_TIMEOUT
 */

export const ErrorCodes = {
  // Storage errors - SQLite/DO persistence operations
  STORAGE_WRITE_FAILED: 'STORAGE_WRITE_FAILED',
  STORAGE_READ_FAILED: 'STORAGE_READ_FAILED',
  STORAGE_DELETE_FAILED: 'STORAGE_DELETE_FAILED',
  STORAGE_TRANSACTION_FAILED: 'STORAGE_TRANSACTION_FAILED',
  STORAGE_MIGRATION_FAILED: 'STORAGE_MIGRATION_FAILED',
  STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',

  // Network errors - HTTP fetch and external calls
  FETCH_FAILED: 'FETCH_FAILED',
  FETCH_TIMEOUT: 'FETCH_TIMEOUT',
  FETCH_ABORTED: 'FETCH_ABORTED',
  NETWORK_OFFLINE: 'NETWORK_OFFLINE',

  // RPC errors - Cross-DO and Cap'n Web RPC
  RPC_TIMEOUT: 'RPC_TIMEOUT',
  RPC_CONNECTION_FAILED: 'RPC_CONNECTION_FAILED',
  RPC_METHOD_NOT_FOUND: 'RPC_METHOD_NOT_FOUND',
  RPC_INVALID_RESPONSE: 'RPC_INVALID_RESPONSE',
  RPC_SERIALIZATION_FAILED: 'RPC_SERIALIZATION_FAILED',

  // Validation errors - Input and schema validation
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_TYPE: 'INVALID_TYPE',
  SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',
  REQUIRED_FIELD_MISSING: 'REQUIRED_FIELD_MISSING',
  CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION',

  // Auth errors - Authentication and authorization
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',

  // Resource errors - CRUD operations on entities
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',
  GONE: 'GONE',
  LOCKED: 'LOCKED',

  // Rate limiting and quotas
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',

  // Workflow errors - $ context and event handling
  WORKFLOW_FAILED: 'WORKFLOW_FAILED',
  WORKFLOW_TIMEOUT: 'WORKFLOW_TIMEOUT',
  WORKFLOW_CANCELLED: 'WORKFLOW_CANCELLED',
  EVENT_HANDLER_FAILED: 'EVENT_HANDLER_FAILED',
  SCHEDULE_INVALID: 'SCHEDULE_INVALID',

  // DO-specific errors
  DO_NOT_FOUND: 'DO_NOT_FOUND',
  DO_UNAVAILABLE: 'DO_UNAVAILABLE',
  DO_HIBERNATING: 'DO_HIBERNATING',
  DO_EXCEEDED_CPU: 'DO_EXCEEDED_CPU',

  // AI/LLM errors
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
  AI_CONTEXT_TOO_LONG: 'AI_CONTEXT_TOO_LONG',
  AI_CONTENT_FILTERED: 'AI_CONTENT_FILTERED',

  // Generic errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  BAD_REQUEST: 'BAD_REQUEST',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
} as const

/**
 * Type representing any valid error code
 */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

/**
 * HTTP status code mapping for error codes
 * Used by error handlers to determine response status
 */
export const ErrorCodeToHttpStatus: Record<ErrorCode, number> = {
  // Storage errors - 500 series (server-side failures)
  [ErrorCodes.STORAGE_WRITE_FAILED]: 500,
  [ErrorCodes.STORAGE_READ_FAILED]: 500,
  [ErrorCodes.STORAGE_DELETE_FAILED]: 500,
  [ErrorCodes.STORAGE_TRANSACTION_FAILED]: 500,
  [ErrorCodes.STORAGE_MIGRATION_FAILED]: 500,
  [ErrorCodes.STORAGE_QUOTA_EXCEEDED]: 507,

  // Network errors - 502/503/504 (gateway/service issues)
  [ErrorCodes.FETCH_FAILED]: 502,
  [ErrorCodes.FETCH_TIMEOUT]: 504,
  [ErrorCodes.FETCH_ABORTED]: 499,
  [ErrorCodes.NETWORK_OFFLINE]: 503,

  // RPC errors - 502/504 (gateway issues)
  [ErrorCodes.RPC_TIMEOUT]: 504,
  [ErrorCodes.RPC_CONNECTION_FAILED]: 502,
  [ErrorCodes.RPC_METHOD_NOT_FOUND]: 404,
  [ErrorCodes.RPC_INVALID_RESPONSE]: 502,
  [ErrorCodes.RPC_SERIALIZATION_FAILED]: 500,

  // Validation errors - 400/422 (client errors)
  [ErrorCodes.INVALID_INPUT]: 400,
  [ErrorCodes.INVALID_JSON]: 400,
  [ErrorCodes.INVALID_TYPE]: 400,
  [ErrorCodes.SCHEMA_VALIDATION_FAILED]: 422,
  [ErrorCodes.REQUIRED_FIELD_MISSING]: 422,
  [ErrorCodes.CONSTRAINT_VIOLATION]: 422,

  // Auth errors - 401/403
  [ErrorCodes.UNAUTHORIZED]: 401,
  [ErrorCodes.FORBIDDEN]: 403,
  [ErrorCodes.TOKEN_EXPIRED]: 401,
  [ErrorCodes.TOKEN_INVALID]: 401,
  [ErrorCodes.SESSION_EXPIRED]: 401,
  [ErrorCodes.INSUFFICIENT_PERMISSIONS]: 403,

  // Resource errors - 404/409/410
  [ErrorCodes.NOT_FOUND]: 404,
  [ErrorCodes.ALREADY_EXISTS]: 409,
  [ErrorCodes.CONFLICT]: 409,
  [ErrorCodes.GONE]: 410,
  [ErrorCodes.LOCKED]: 423,

  // Rate limiting - 429
  [ErrorCodes.RATE_LIMITED]: 429,
  [ErrorCodes.QUOTA_EXCEEDED]: 429,
  [ErrorCodes.TOO_MANY_REQUESTS]: 429,

  // Workflow errors - 500 series
  [ErrorCodes.WORKFLOW_FAILED]: 500,
  [ErrorCodes.WORKFLOW_TIMEOUT]: 504,
  [ErrorCodes.WORKFLOW_CANCELLED]: 499,
  [ErrorCodes.EVENT_HANDLER_FAILED]: 500,
  [ErrorCodes.SCHEDULE_INVALID]: 400,

  // DO-specific errors
  [ErrorCodes.DO_NOT_FOUND]: 404,
  [ErrorCodes.DO_UNAVAILABLE]: 503,
  [ErrorCodes.DO_HIBERNATING]: 503,
  [ErrorCodes.DO_EXCEEDED_CPU]: 503,

  // AI errors
  [ErrorCodes.AI_PROVIDER_ERROR]: 502,
  [ErrorCodes.AI_RATE_LIMITED]: 429,
  [ErrorCodes.AI_CONTEXT_TOO_LONG]: 400,
  [ErrorCodes.AI_CONTENT_FILTERED]: 422,

  // Generic errors
  [ErrorCodes.INTERNAL_ERROR]: 500,
  [ErrorCodes.NOT_IMPLEMENTED]: 501,
  [ErrorCodes.SERVICE_UNAVAILABLE]: 503,
  [ErrorCodes.BAD_REQUEST]: 400,
  [ErrorCodes.METHOD_NOT_ALLOWED]: 405,
}

/**
 * Get the HTTP status code for a given error code
 */
export function getHttpStatusForCode(code: ErrorCode): number {
  return ErrorCodeToHttpStatus[code] ?? 500
}

/**
 * Check if an error code represents a client error (4xx)
 */
export function isClientError(code: ErrorCode): boolean {
  const status = getHttpStatusForCode(code)
  return status >= 400 && status < 500
}

/**
 * Check if an error code represents a server error (5xx)
 */
export function isServerError(code: ErrorCode): boolean {
  const status = getHttpStatusForCode(code)
  return status >= 500 && status < 600
}

/**
 * Check if an error code represents a retryable error
 * Retryable errors are typically transient network/service issues
 */
export function isRetryableError(code: ErrorCode): boolean {
  const retryableCodes: ErrorCode[] = [
    ErrorCodes.FETCH_TIMEOUT,
    ErrorCodes.FETCH_FAILED,
    ErrorCodes.RPC_TIMEOUT,
    ErrorCodes.RPC_CONNECTION_FAILED,
    ErrorCodes.NETWORK_OFFLINE,
    ErrorCodes.SERVICE_UNAVAILABLE,
    ErrorCodes.DO_UNAVAILABLE,
    ErrorCodes.DO_HIBERNATING,
    ErrorCodes.RATE_LIMITED,
    ErrorCodes.TOO_MANY_REQUESTS,
    ErrorCodes.AI_RATE_LIMITED,
  ]
  return retryableCodes.includes(code)
}
