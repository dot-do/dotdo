/**
 * Cloudflare Durable Object Storage Limits and Guards
 *
 * Cloudflare Durable Objects have hard limits on storage and memory that must
 * be respected to avoid runtime errors and data loss. This module provides:
 *
 * - Constants for all CF DO storage/memory limits
 * - A StorageGuard utility that validates operations before they execute
 * - A paginated list() helper that respects the 1000-key batch limit
 *
 * @see https://developers.cloudflare.com/durable-objects/platform/limits/
 * @module do/storage-limits
 */

// Minimal logger to avoid pulling in @dotdo/utils barrel (which has heavy transitive deps).
// This module should be zero-dep for maximum portability and testability.
const logger = {
  warn: (...args: unknown[]) => console.warn('[StorageLimits]', ...args),
}

// =============================================================================
// Cloudflare Durable Object Limit Constants
// =============================================================================

/**
 * Maximum memory per Durable Object instance in megabytes.
 *
 * When a DO exceeds this limit, the runtime terminates the isolate with an
 * "Exceeded memory limit" error. All in-flight requests fail and the DO
 * restarts on the next request.
 *
 * @see https://developers.cloudflare.com/durable-objects/platform/limits/
 */
export const MAX_MEMORY_MB = 128

/**
 * Maximum persistent storage per Durable Object in gigabytes (KV-style storage).
 *
 * This is the total size of all keys + values stored via `state.storage.put()`.
 * Exceeding this limit causes put() calls to throw.
 *
 * @see https://developers.cloudflare.com/durable-objects/platform/limits/
 */
export const MAX_STORAGE_GB = 10

/**
 * Maximum size of a single KV value in bytes (128 KB).
 *
 * Individual values written via `state.storage.put(key, value)` must not
 * exceed this size. The key itself has a separate limit of 2048 bytes.
 * Attempting to put() a value larger than this throws an error.
 *
 * @see https://developers.cloudflare.com/durable-objects/platform/limits/
 */
export const MAX_VALUE_SIZE = 131072 // 128 * 1024 = 131,072 bytes

/**
 * Maximum number of key-value pairs returned per `state.storage.list()` call.
 *
 * When listing keys, the runtime returns at most 1000 entries per call.
 * To retrieve all keys, callers must paginate by passing `{ start: lastKey }` or
 * `{ startAfter: lastKey }` in subsequent calls.
 *
 * @see https://developers.cloudflare.com/durable-objects/platform/limits/
 */
export const MAX_LIST_BATCH = 1000

/**
 * Maximum key size in bytes.
 *
 * Keys passed to `state.storage.put()`, `get()`, `delete()`, etc. must not
 * exceed 2048 bytes when UTF-8 encoded.
 *
 * @see https://developers.cloudflare.com/durable-objects/platform/limits/
 */
export const MAX_KEY_SIZE = 2048

/**
 * Maximum number of keys that can be read in a single `state.storage.get()` call
 * when passing an array of keys.
 *
 * @see https://developers.cloudflare.com/durable-objects/platform/limits/
 */
export const MAX_KEYS_PER_GET = 128

/**
 * Maximum number of key-value pairs that can be written in a single
 * `state.storage.put()` call when passing a map/object.
 *
 * @see https://developers.cloudflare.com/durable-objects/platform/limits/
 */
export const MAX_KEYS_PER_PUT = 128

// =============================================================================
// Warning Thresholds (percentage of limit)
// =============================================================================

/**
 * Percentage of a limit at which a warning is emitted.
 * Default: 80% (0.8).
 */
export const DEFAULT_WARN_THRESHOLD = 0.8

/**
 * Warn threshold for value size: 80% of MAX_VALUE_SIZE (102,400 bytes).
 */
export const WARN_VALUE_SIZE = Math.floor(MAX_VALUE_SIZE * DEFAULT_WARN_THRESHOLD)

// =============================================================================
// StorageGuard
// =============================================================================

/**
 * Behavior when a limit is approached or exceeded.
 *
 * - `'warn'` — Log a warning but allow the operation to proceed
 * - `'throw'` — Throw a StorageLimitError, preventing the operation
 */
export type LimitBehavior = 'warn' | 'throw'

/**
 * Configuration for StorageGuard.
 */
export interface StorageGuardConfig {
  /**
   * Behavior when a value exceeds MAX_VALUE_SIZE.
   * @default 'throw'
   */
  onValueSizeExceeded?: LimitBehavior

  /**
   * Behavior when a value approaches the size limit (above WARN_VALUE_SIZE
   * but below MAX_VALUE_SIZE).
   * @default 'warn'
   */
  onValueSizeWarning?: LimitBehavior

  /**
   * Behavior when a key exceeds MAX_KEY_SIZE.
   * @default 'throw'
   */
  onKeySizeExceeded?: LimitBehavior

  /**
   * Custom warn threshold as a fraction (0..1) of MAX_VALUE_SIZE.
   * @default DEFAULT_WARN_THRESHOLD (0.8)
   */
  warnThreshold?: number
}

/**
 * Error thrown when a Cloudflare DO storage limit is exceeded.
 */
export class StorageLimitError extends Error {
  /** The limit that was exceeded */
  readonly limit: string
  /** The actual value that exceeded the limit */
  readonly actual: number
  /** The maximum allowed value */
  readonly maximum: number

  constructor(limit: string, actual: number, maximum: number, message?: string) {
    const msg = message ?? `Storage limit exceeded: ${limit} (${actual} > ${maximum})`
    super(msg)
    this.name = 'StorageLimitError'
    this.limit = limit
    this.actual = actual
    this.maximum = maximum
  }
}

/**
 * Result of a storage guard check.
 */
export interface StorageGuardResult {
  /** Whether the operation is allowed to proceed */
  allowed: boolean
  /** Warning message if approaching a limit (undefined if no warning) */
  warning?: string
  /** Error message if a limit is exceeded (undefined if not exceeded) */
  error?: string
}

/**
 * StorageGuard validates Durable Object storage operations against
 * Cloudflare's hard limits before they execute.
 *
 * Use this to catch oversized values, overly long keys, and other
 * limit violations before they cause runtime errors.
 *
 * @example
 * ```typescript
 * import { StorageGuard, StorageLimitError } from '@dotdo/do'
 *
 * const guard = new StorageGuard()
 *
 * // Check before writing
 * guard.checkValueSize(myValue)          // throws if > 128KB
 * await state.storage.put(key, myValue)  // safe to proceed
 *
 * // Check key size
 * guard.checkKeySize(key)                // throws if > 2048 bytes
 *
 * // Paginated list (automatically handles 1000-key batches)
 * const allEntries = await guard.paginatedList(state.storage)
 * ```
 */
export class StorageGuard {
  private readonly config: Required<StorageGuardConfig>
  private readonly warnValueSize: number

  constructor(config: StorageGuardConfig = {}) {
    this.config = {
      onValueSizeExceeded: config.onValueSizeExceeded ?? 'throw',
      onValueSizeWarning: config.onValueSizeWarning ?? 'warn',
      onKeySizeExceeded: config.onKeySizeExceeded ?? 'throw',
      warnThreshold: config.warnThreshold ?? DEFAULT_WARN_THRESHOLD,
    }
    this.warnValueSize = Math.floor(MAX_VALUE_SIZE * this.config.warnThreshold)
  }

  /**
   * Check a value's serialized size against MAX_VALUE_SIZE before writing.
   *
   * Cloudflare serializes values using the structured clone algorithm. This
   * method uses `JSON.stringify` as an approximation (structured clone can
   * sometimes be slightly larger or smaller depending on the data types).
   *
   * @param value - The value to check
   * @param key - Optional key name for better error messages
   * @returns StorageGuardResult indicating whether the operation is safe
   * @throws StorageLimitError if onValueSizeExceeded is 'throw' and value exceeds limit
   *
   * @example
   * ```typescript
   * const guard = new StorageGuard()
   * guard.checkValueSize({ name: 'Alice', data: largeBlob })
   * // throws StorageLimitError if serialized size > 128KB
   * ```
   */
  checkValueSize(value: unknown, key?: string): StorageGuardResult {
    const size = estimateValueSize(value)
    const keyLabel = key ? ` for key "${key}"` : ''

    // Exceeds hard limit
    if (size > MAX_VALUE_SIZE) {
      const message = `Value size${keyLabel} exceeds maximum: ${formatBytes(size)} > ${formatBytes(MAX_VALUE_SIZE)}`

      if (this.config.onValueSizeExceeded === 'throw') {
        throw new StorageLimitError('MAX_VALUE_SIZE', size, MAX_VALUE_SIZE, message)
      }
      logger.warn(message)
      return { allowed: false, error: message }
    }

    // Approaching limit (warning zone)
    if (size > this.warnValueSize) {
      const pct = ((size / MAX_VALUE_SIZE) * 100).toFixed(1)
      const message = `Value size${keyLabel} approaching limit: ${formatBytes(size)} (${pct}% of ${formatBytes(MAX_VALUE_SIZE)})`

      if (this.config.onValueSizeWarning === 'throw') {
        throw new StorageLimitError('MAX_VALUE_SIZE', size, MAX_VALUE_SIZE, message)
      }
      logger.warn(message)
      return { allowed: true, warning: message }
    }

    return { allowed: true }
  }

  /**
   * Check a key's size against MAX_KEY_SIZE.
   *
   * @param key - The key string to validate
   * @returns StorageGuardResult
   * @throws StorageLimitError if onKeySizeExceeded is 'throw' and key exceeds limit
   *
   * @example
   * ```typescript
   * guard.checkKeySize('session:user-12345:preferences:theme')
   * ```
   */
  checkKeySize(key: string): StorageGuardResult {
    const size = new TextEncoder().encode(key).byteLength

    if (size > MAX_KEY_SIZE) {
      const message = `Key size exceeds maximum: ${size} bytes > ${MAX_KEY_SIZE} bytes (key: "${key.slice(0, 50)}${key.length > 50 ? '...' : ''}")`

      if (this.config.onKeySizeExceeded === 'throw') {
        throw new StorageLimitError('MAX_KEY_SIZE', size, MAX_KEY_SIZE, message)
      }
      logger.warn(message)
      return { allowed: false, error: message }
    }

    return { allowed: true }
  }

  /**
   * Validate a put() operation: checks both key and value sizes.
   *
   * @param key - The storage key
   * @param value - The value to store
   * @returns StorageGuardResult
   * @throws StorageLimitError if limits are exceeded in throw mode
   *
   * @example
   * ```typescript
   * guard.checkPut('user:123', { name: 'Alice', data: payload })
   * await state.storage.put('user:123', { name: 'Alice', data: payload })
   * ```
   */
  checkPut(key: string, value: unknown): StorageGuardResult {
    const keyResult = this.checkKeySize(key)
    if (!keyResult.allowed) {
      return keyResult
    }

    const valueResult = this.checkValueSize(value, key)
    return valueResult
  }

  /**
   * List all entries from DO storage with automatic pagination.
   *
   * Cloudflare's `state.storage.list()` returns at most 1000 entries per call
   * (MAX_LIST_BATCH). This method handles pagination transparently, making
   * successive list() calls with `startAfter` to retrieve all entries.
   *
   * @param storage - The DurableObjectStorage instance
   * @param options - Optional list options (prefix, limit, etc.)
   * @returns Map of all matching key-value pairs
   *
   * @example
   * ```typescript
   * // Get all entries
   * const all = await StorageGuard.paginatedList(state.storage)
   *
   * // Get all entries with a prefix
   * const sessions = await StorageGuard.paginatedList(state.storage, {
   *   prefix: 'session:'
   * })
   *
   * // Get at most 5000 entries
   * const limited = await StorageGuard.paginatedList(state.storage, {
   *   limit: 5000
   * })
   * ```
   */
  static async paginatedList(
    storage: DurableObjectStorage,
    options: PaginatedListOptions = {}
  ): Promise<Map<string, unknown>> {
    const { prefix, limit, reverse } = options
    const allEntries = new Map<string, unknown>()
    let cursor: string | undefined

    while (true) {
      const remaining = limit !== undefined ? limit - allEntries.size : undefined
      if (remaining !== undefined && remaining <= 0) {
        break
      }

      const batchSize = remaining !== undefined
        ? Math.min(remaining, MAX_LIST_BATCH)
        : MAX_LIST_BATCH

      const listOpts: Record<string, unknown> = { limit: batchSize }
      if (prefix !== undefined) listOpts.prefix = prefix
      if (reverse !== undefined) listOpts.reverse = reverse
      if (cursor !== undefined) listOpts.startAfter = cursor

      const batch = await storage.list(listOpts as DurableObjectListOptions)

      if (batch.size === 0) {
        break
      }

      let lastKey: string | undefined
      for (const [key, value] of batch) {
        allEntries.set(key, value)
        lastKey = key
      }

      // If we got fewer entries than requested, we have reached the end
      if (batch.size < batchSize) {
        break
      }

      cursor = lastKey
    }

    return allEntries
  }
}

// =============================================================================
// Paginated List Options
// =============================================================================

/**
 * Options for paginated list operations.
 */
export interface PaginatedListOptions {
  /** Key prefix filter */
  prefix?: string
  /** Maximum total entries to retrieve (across all pages) */
  limit?: number
  /** List in reverse order */
  reverse?: boolean
}

/**
 * Convenience type alias for DurableObjectStorage list options.
 * Used internally; not all runtimes expose this type.
 */
interface DurableObjectListOptions {
  prefix?: string
  limit?: number
  reverse?: boolean
  start?: string
  startAfter?: string
  end?: string
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Estimate the serialized size of a value in bytes.
 *
 * Uses JSON.stringify as an approximation of Cloudflare's structured clone
 * serialization. For ArrayBuffer/TypedArray values, returns the byte length
 * directly (structured clone preserves binary data efficiently).
 *
 * @param value - The value to estimate
 * @returns Estimated size in bytes
 */
export function estimateValueSize(value: unknown): number {
  if (value === null || value === undefined) {
    return 0
  }

  // Binary data: return actual byte length
  if (value instanceof ArrayBuffer) {
    return value.byteLength
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength
  }

  // Strings: UTF-8 encoded length
  if (typeof value === 'string') {
    return new TextEncoder().encode(value).byteLength
  }

  // Numbers, booleans: small fixed size
  if (typeof value === 'number' || typeof value === 'boolean') {
    return 8 // approximation
  }

  // Objects/arrays: use JSON serialization as approximation
  try {
    const serialized = JSON.stringify(value)
    return new TextEncoder().encode(serialized).byteLength
  } catch {
    // Circular references or non-serializable values
    // Return a conservative estimate
    return MAX_VALUE_SIZE + 1
  }
}

/**
 * Format a byte count into a human-readable string.
 *
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "128 KB", "1.5 MB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const value = bytes / Math.pow(k, i)
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[i]}`
}
