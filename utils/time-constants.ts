/**
 * Time Constants
 *
 * Standardized time durations used throughout the codebase.
 * Using named constants improves readability and prevents magic number confusion.
 *
 * @module @dotdo/utils/time-constants
 */

// =============================================================================
// Time Unit Multipliers (for clarity in expressions)
// =============================================================================

/** Milliseconds per second */
export const MS_PER_SECOND = 1000

/** Milliseconds per minute */
export const MS_PER_MINUTE = 60 * MS_PER_SECOND // 60000

/** Milliseconds per hour */
export const MS_PER_HOUR = 60 * MS_PER_MINUTE // 3600000

/** Milliseconds per day */
export const MS_PER_DAY = 24 * MS_PER_HOUR // 86400000

/** Seconds per minute */
export const SECONDS_PER_MINUTE = 60

/** Seconds per hour */
export const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE // 3600

/** Seconds per day */
export const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR // 86400

// =============================================================================
// Common Timeout Defaults
// =============================================================================

/** Default timeout for test utilities: 5 seconds */
export const DEFAULT_TEST_TIMEOUT_MS = 5 * MS_PER_SECOND // 5000

/** Default polling interval for waitFor: 50ms */
export const DEFAULT_POLL_INTERVAL_MS = 50

/** Default retry base delay: 100ms */
export const DEFAULT_RETRY_BASE_DELAY_MS = 100

/** Default max retry delay: 5 seconds */
export const DEFAULT_RETRY_MAX_DELAY_MS = 5 * MS_PER_SECOND // 5000

/** Default max retry attempts */
export const DEFAULT_MAX_RETRY_ATTEMPTS = 3

// =============================================================================
// Cache & Buffer Defaults
// =============================================================================

/** Default cache TTL: 1 minute */
export const DEFAULT_CACHE_TTL_MS = MS_PER_MINUTE // 60000

/** Default buffer flush interval: 5 seconds */
export const DEFAULT_BUFFER_FLUSH_INTERVAL_MS = 5 * MS_PER_SECOND // 5000

/** Default cleanup interval: 5 minutes */
export const DEFAULT_CLEANUP_INTERVAL_MS = 5 * MS_PER_MINUTE // 300000

// =============================================================================
// Rate Limiting Defaults
// =============================================================================

/** Default rate limit window: 1 minute */
export const DEFAULT_RATE_LIMIT_WINDOW_MS = MS_PER_MINUTE // 60000

/** Default rate limit for free tier: 100 requests per window */
export const DEFAULT_FREE_TIER_REQUESTS = 100

/** Default rate limit for pro tier: 1000 requests per window */
export const DEFAULT_PRO_TIER_REQUESTS = 1000

/** Default rate limit for enterprise tier: 10000 requests per window */
export const DEFAULT_ENTERPRISE_TIER_REQUESTS = 10000

// =============================================================================
// RPC & Transport Defaults
// =============================================================================

/** Default RPC timeout: 30 seconds */
export const DEFAULT_RPC_TIMEOUT_MS = 30 * MS_PER_SECOND // 30000

/** Default reconnect delay: 1 second */
export const DEFAULT_RECONNECT_DELAY_MS = MS_PER_SECOND // 1000

/** Default max reconnect delay: 30 seconds */
export const DEFAULT_MAX_RECONNECT_DELAY_MS = 30 * MS_PER_SECOND // 30000

/** Default max reconnect attempts */
export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5

// =============================================================================
// WebSocket & Connection Defaults
// =============================================================================

/** Default heartbeat interval: 30 seconds */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * MS_PER_SECOND // 30000

/** Default connection timeout: 60 seconds (1 minute) */
export const DEFAULT_CONNECTION_TIMEOUT_MS = MS_PER_MINUTE // 60000

// =============================================================================
// Storage & Queue Defaults
// =============================================================================

/** Default max entries for in-memory stores: 10000 */
export const DEFAULT_MAX_STORE_ENTRIES = 10000

/** Default max error age: 24 hours */
export const DEFAULT_MAX_ERROR_AGE_MS = MS_PER_DAY // 86400000

/** Default max backoff for retries: 60 seconds */
export const DEFAULT_MAX_BACKOFF_MS = MS_PER_MINUTE // 60000

/** Default process interval for queues: 1 second */
export const DEFAULT_PROCESS_INTERVAL_MS = MS_PER_SECOND // 1000

/** Default completed item max age: 1 hour */
export const DEFAULT_COMPLETED_ITEM_MAX_AGE_MS = MS_PER_HOUR // 3600000

// =============================================================================
// CORS Defaults
// =============================================================================

/** Default CORS max age: 24 hours */
export const DEFAULT_CORS_MAX_AGE_SECONDS = SECONDS_PER_DAY // 86400

// =============================================================================
// Session & Auth Defaults
// =============================================================================

/** Default session max age: 1 hour */
export const DEFAULT_SESSION_MAX_AGE_SECONDS = SECONDS_PER_HOUR // 3600

/** Default org.ai request timeout: 5 seconds */
export const DEFAULT_ORG_AI_TIMEOUT_MS = 5 * MS_PER_SECOND // 5000

// =============================================================================
// Eval & Execution Defaults
// =============================================================================

/** Default eval timeout: 5 seconds */
export const DEFAULT_EVAL_TIMEOUT_MS = 5 * MS_PER_SECOND // 5000

// =============================================================================
// Validation & Size Limit Defaults
// =============================================================================

/** Default maximum string length for validation: 10000 characters */
export const DEFAULT_MAX_STRING_LENGTH = 10000

/** Default maximum object nesting depth: 10 levels */
export const DEFAULT_MAX_OBJECT_DEPTH = 10

/** Default maximum keys per object: 100 keys */
export const DEFAULT_MAX_OBJECT_KEYS = 100

/** Default maximum array length: 1000 items */
export const DEFAULT_MAX_ARRAY_LENGTH = 1000

/** Maximum ID length: 256 characters */
export const MAX_ID_LENGTH = 256

/** Maximum type name length: 100 characters */
export const MAX_TYPE_NAME_LENGTH = 100

/** Default pagination limit: 100 items */
export const DEFAULT_PAGINATION_LIMIT = 100

/** Maximum pagination limit: 10000 items */
export const MAX_PAGINATION_LIMIT = 10000

/** Maximum pipeline depth: 10 steps */
export const DEFAULT_MAX_PIPELINE_DEPTH = 10

// =============================================================================
// API Key Defaults
// =============================================================================

/** API key prefix display length: 12 characters */
export const API_KEY_PREFIX_LENGTH = 12

/** API key secret minimum length: 16 characters */
export const API_KEY_SECRET_MIN_LENGTH = 16

/** API key random bytes length: 32 bytes */
export const API_KEY_RANDOM_BYTES_LENGTH = 32
