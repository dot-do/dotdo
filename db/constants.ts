/**
 * DB Module Constants
 *
 * Centralized configuration constants for the database module.
 * Extracted from various files to improve maintainability and documentation.
 */

// =============================================================================
// BLOOM FILTER CONSTANTS
// =============================================================================

/**
 * Default expected number of elements for Bloom filters.
 * Used in columnar store for column-level membership tests.
 * @see db/columnar/store.ts
 * @see db/columnar/indexes.ts
 */
export const BLOOM_FILTER_DEFAULT_EXPECTED_ELEMENTS = 1000

/**
 * Expected elements for document store Bloom filters.
 * Larger than columnar store to accommodate per-document-type filtering.
 * @see db/document/store.ts
 */
export const BLOOM_FILTER_DOCUMENT_STORE_EXPECTED_ELEMENTS = 10000

/**
 * Default false positive rate for Bloom filters (10%).
 * Lower rates require more bits but give fewer false positives.
 * @see db/columnar/indexes.ts
 */
export const BLOOM_FILTER_DEFAULT_FALSE_POSITIVE_RATE = 0.1

/**
 * Number of hash functions for document store Bloom filters.
 * More functions = fewer false positives but slower operations.
 * @see db/document/store.ts
 */
export const BLOOM_FILTER_DOCUMENT_STORE_HASH_COUNT = 5

/**
 * Minimum bit array size for Bloom filters (64 bits).
 * Ensures filter works even with very small expected element counts.
 * @see db/columnar/indexes.ts
 */
export const BLOOM_FILTER_MIN_SIZE = 64

/**
 * Minimum number of hash functions for Bloom filters.
 * Ensures reasonable false positive rate even with small filters.
 * @see db/columnar/indexes.ts
 */
export const BLOOM_FILTER_MIN_HASH_COUNT = 3

// =============================================================================
// FNV-1A HASH CONSTANTS
// =============================================================================

/**
 * FNV-1a offset basis for 32-bit hash.
 * Standard constant from the FNV hash specification.
 * @see db/columnar/indexes.ts
 */
export const FNV1A_OFFSET_BASIS = 2166136261

/**
 * FNV-1a prime for 32-bit hash.
 * Standard constant from the FNV hash specification.
 * @see db/columnar/indexes.ts
 */
export const FNV1A_PRIME = 16777619

// =============================================================================
// CONCURRENCY CONSTANTS
// =============================================================================

/**
 * Default timeout for lock acquisition in milliseconds.
 * Allows reasonable time for lock contention to resolve.
 * @see db/concurrency.ts
 */
export const LOCK_DEFAULT_TIMEOUT_MS = 5000

/**
 * Default timeout for document update operations in milliseconds.
 * Matches typical web request timeout expectations.
 * @see db/document/store.ts
 */
export const DOCUMENT_UPDATE_LOCK_TIMEOUT_MS = 30000

/**
 * Maximum queue depth for lock requests per key.
 * Prevents unbounded memory growth under high contention.
 * @see db/concurrency.ts
 */
export const LOCK_MAX_QUEUE_DEPTH = 1000

// =============================================================================
// RETRY CONSTANTS
// =============================================================================

/**
 * Default maximum retry attempts for transient failures.
 * @see db/concurrency.ts
 * @see db/document/store.ts
 * @see db/cdc/emitter-dlq.ts
 */
export const DEFAULT_MAX_RETRIES = 3

/**
 * Default base delay for exponential backoff in milliseconds.
 * @see db/concurrency.ts
 */
export const DEFAULT_RETRY_BASE_DELAY_MS = 10

/**
 * Default base delay for CDC emitter retries in milliseconds.
 * @see db/cdc/emitter-dlq.ts
 */
export const CDC_EMITTER_RETRY_BASE_DELAY_MS = 100

/**
 * Default maximum delay cap for retries in milliseconds.
 * @see db/concurrency.ts
 */
export const DEFAULT_RETRY_MAX_DELAY_MS = 1000

/**
 * Default jitter factor for retry delays (10%).
 * Helps prevent thundering herd on retries.
 * @see db/concurrency.ts
 */
export const DEFAULT_RETRY_JITTER = 0.1

// =============================================================================
// CDC/STREAMING CONSTANTS
// =============================================================================

/**
 * Default batch size for CDC events before flushing.
 * Balances latency vs. write efficiency.
 * @see db/cdc/r2-iceberg-sink.ts
 * @see db/cdc/exactly-once-emitter.ts
 */
export const CDC_DEFAULT_BATCH_SIZE = 1000

/**
 * Default batch size for exactly-once emitter buffer.
 * Smaller than sink batch size for lower latency.
 * @see db/cdc/exactly-once-emitter.ts
 */
export const CDC_EMITTER_MAX_BUFFER_SIZE = 100

/**
 * Default maximum flush delay for CDC events in milliseconds (1 minute).
 * Events are flushed at most this often, regardless of batch size.
 * @see db/cdc/r2-iceberg-sink.ts
 */
export const CDC_DEFAULT_MAX_FLUSH_DELAY_MS = 60000

// =============================================================================
// TIME UNIT CONSTANTS (for duration parsing)
// =============================================================================

/**
 * Milliseconds per second.
 * @see db/cdc/dlq.ts
 * @see db/core/tier.ts
 */
export const MS_PER_SECOND = 1000

/**
 * Milliseconds per minute.
 * @see db/cdc/dlq.ts
 */
export const MS_PER_MINUTE = 60 * MS_PER_SECOND

/**
 * Milliseconds per hour.
 * @see db/cdc/dlq.ts
 */
export const MS_PER_HOUR = 60 * MS_PER_MINUTE

/**
 * Milliseconds per day.
 * @see db/cdc/dlq.ts
 */
export const MS_PER_DAY = 24 * MS_PER_HOUR

/**
 * Time unit multipliers for duration string parsing.
 * @see db/cdc/dlq.ts
 */
export const TIME_UNIT_MULTIPLIERS: Record<string, number> = {
  s: MS_PER_SECOND,
  m: MS_PER_MINUTE,
  h: MS_PER_HOUR,
  d: MS_PER_DAY,
}

// =============================================================================
// MIGRATION/BATCH CONSTANTS
// =============================================================================

/**
 * Default batch size for migration operations.
 * @see db/migrations/visibility.ts
 */
export const MIGRATION_DEFAULT_BATCH_SIZE = 100

/**
 * Default limit for visibility history queries.
 * @see db/migrations/visibility.ts
 */
export const VISIBILITY_HISTORY_DEFAULT_LIMIT = 1000

/**
 * Maximum things to scan for visibility statistics.
 * @see db/migrations/visibility.ts
 */
export const VISIBILITY_STATS_MAX_SCAN = 100000

// =============================================================================
// RPC/NETWORK CONSTANTS
// =============================================================================

/**
 * Default timeout for RPC calls in milliseconds (30 seconds).
 * @see db/tanstack/rpc.ts
 */
export const RPC_DEFAULT_TIMEOUT_MS = 30000

/**
 * Maximum reconnect delay for sync client in milliseconds (30 seconds).
 * @see db/tanstack/sync-client.ts
 */
export const RECONNECT_MAX_DELAY_MS = 30000

// =============================================================================
// COST CALCULATION CONSTANTS
// =============================================================================

/**
 * Cost per million write operations in dollars.
 * Used for columnar store cost savings calculations.
 * @see db/columnar/store.ts
 */
export const COST_PER_MILLION_WRITES = 1.0

/**
 * Cost per million read operations in dollars.
 * @see db/columnar/store.ts
 */
export const COST_PER_MILLION_READS = 0.001

/**
 * Maximum column rows to read for query cost estimation.
 * @see db/columnar/store.ts
 */
export const MAX_COLUMN_ROWS_FOR_COST_ESTIMATE = 6

// =============================================================================
// COLUMNAR STORE CONSTANTS
// =============================================================================

/**
 * Number of row writes per columnar batch insert (columnar storage format).
 * Each insert writes 6 separate column rows: ids, types, data, embeddings, timestamps.created, timestamps.updated
 * @see db/columnar/store.ts
 */
export const COLUMNAR_ROWS_PER_INSERT = 6

/**
 * Default extraction threshold for auto-extracting high-frequency JSON columns.
 * Columns appearing in 80%+ of records are extracted to typed columns.
 * @see db/columnar/store.ts
 */
export const DEFAULT_COLUMN_EXTRACTION_THRESHOLD = 0.8
