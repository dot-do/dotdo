/**
 * HashStore - Redis-like hash operations primitive
 *
 * Provides field-level operations on hash data structures:
 *
 * ## Features
 * - **hget/hset/hdel** - Individual field operations
 * - **hgetall/hmset/hmget** - Bulk field operations
 * - **hincrby/hincrbyfloat** - Atomic numeric increments
 * - **TTL** - Hash-level expiration (not field-level)
 * - **Observability** - Metrics integration
 *
 * ## Redis Command Mapping
 * | Method | Redis Command |
 * |--------|---------------|
 * | hget | HGET |
 * | hset | HSET |
 * | hdel | HDEL |
 * | hgetall | HGETALL |
 * | hkeys | HKEYS |
 * | hvals | HVALS |
 * | hlen | HLEN |
 * | hincrby | HINCRBY |
 * | hincrbyfloat | HINCRBYFLOAT |
 * | hsetnx | HSETNX |
 * | hexists | HEXISTS |
 * | hmset | HMSET |
 * | hmget | HMGET |
 *
 * @module db/primitives/hash-store
 */

import { type MetricsCollector, noopMetrics } from './observability'

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Options for hset operations.
 */
export interface HSetOptions {
  /**
   * Time-to-live in milliseconds for the entire hash.
   * Sets or updates the TTL on the hash key.
   * Only effective when `enableTTL` is true in store options.
   */
  ttl?: number
}

/**
 * Configuration options for HashStore.
 */
export interface HashStoreOptions {
  /**
   * Enable TTL-based expiration at the hash level.
   * When true, hashes with TTL set will expire.
   * @default false
   */
  enableTTL?: boolean

  /**
   * Metrics collector for observability.
   * Use TestMetricsCollector for testing or integrate with your metrics backend.
   * @default noopMetrics (zero overhead)
   */
  metrics?: MetricsCollector
}

/**
 * Options for scan operation.
 */
export interface ScanOptions {
  /**
   * Hint for batch size (not guaranteed).
   */
  count?: number

  /**
   * Pattern to match keys against (glob-style).
   * Supports * for any characters.
   */
  match?: string
}

/**
 * Redis-like hash operations interface.
 *
 * @typeParam T - The type of values stored in hash fields
 *
 * @example
 * ```typescript
 * const store = createHashStore<string>()
 *
 * // Set individual field
 * await store.hset('user:1', 'name', 'Alice')
 *
 * // Set multiple fields
 * await store.hmset('user:1', { email: 'alice@example.com', city: 'NYC' })
 *
 * // Get field
 * const name = await store.hget('user:1', 'name')
 *
 * // Get all fields
 * const user = await store.hgetall('user:1')
 *
 * // Atomic increment
 * await store.hincrby('stats', 'views', 1)
 * ```
 */
export interface HashStore<T> {
  // ===========================================================================
  // SINGLE FIELD OPERATIONS
  // ===========================================================================

  /**
   * Set a field in the hash.
   *
   * @param key - Hash key
   * @param field - Field name within the hash
   * @param value - Value to store
   * @param options - Optional TTL configuration
   * @returns 1 if field is new, 0 if field was updated
   */
  hset(key: string, field: string, value: T, options?: HSetOptions): Promise<number>

  /**
   * Get a field from the hash.
   *
   * @param key - Hash key
   * @param field - Field name within the hash
   * @returns Field value or null if not found
   */
  hget(key: string, field: string): Promise<T | null>

  /**
   * Delete one or more fields from the hash.
   *
   * @param key - Hash key
   * @param fields - Field names to delete
   * @returns Number of fields actually deleted
   */
  hdel(key: string, ...fields: string[]): Promise<number>

  /**
   * Check if a field exists in the hash.
   *
   * @param key - Hash key
   * @param field - Field name to check
   * @returns true if field exists
   */
  hexists(key: string, field: string): Promise<boolean>

  /**
   * Set a field only if it does not exist.
   *
   * @param key - Hash key
   * @param field - Field name
   * @param value - Value to store
   * @returns 1 if field was set, 0 if field already exists
   */
  hsetnx(key: string, field: string, value: T): Promise<number>

  // ===========================================================================
  // BULK FIELD OPERATIONS
  // ===========================================================================

  /**
   * Set multiple fields at once.
   *
   * @param key - Hash key
   * @param fields - Object with field-value pairs
   */
  hmset(key: string, fields: Record<string, T>): Promise<void>

  /**
   * Get multiple fields at once.
   *
   * @param key - Hash key
   * @param fields - Field names to retrieve
   * @returns Array of values (null for missing fields), same order as input
   */
  hmget(key: string, ...fields: string[]): Promise<(T | null)[]>

  /**
   * Get all fields and values from the hash.
   *
   * @param key - Hash key
   * @returns Object with all field-value pairs, empty object if key doesn't exist
   */
  hgetall(key: string): Promise<Record<string, T>>

  /**
   * Get all field names from the hash.
   *
   * @param key - Hash key
   * @returns Array of field names
   */
  hkeys(key: string): Promise<string[]>

  /**
   * Get all values from the hash.
   *
   * @param key - Hash key
   * @returns Array of values
   */
  hvals(key: string): Promise<T[]>

  /**
   * Get the number of fields in the hash.
   *
   * @param key - Hash key
   * @returns Number of fields
   */
  hlen(key: string): Promise<number>

  // ===========================================================================
  // NUMERIC OPERATIONS
  // ===========================================================================

  /**
   * Increment an integer field by the given amount.
   * Creates the field with the increment value if it doesn't exist.
   *
   * @param key - Hash key
   * @param field - Field name
   * @param increment - Amount to add (can be negative)
   * @returns New value after increment
   */
  hincrby(key: string, field: string, increment: number): Promise<number>

  /**
   * Increment a float field by the given amount.
   * Creates the field with the increment value if it doesn't exist.
   *
   * @param key - Hash key
   * @param field - Field name
   * @param increment - Amount to add (can be negative)
   * @returns New value after increment
   */
  hincrbyfloat(key: string, field: string, increment: number): Promise<number>

  // ===========================================================================
  // KEY OPERATIONS
  // ===========================================================================

  /**
   * Delete one or more hash keys entirely.
   *
   * @param keys - Hash keys to delete
   * @returns Number of keys actually deleted
   */
  del(...keys: string[]): Promise<number>

  /**
   * Get all hash keys, optionally matching a pattern.
   *
   * @param pattern - Optional glob pattern to match (default: '*')
   * @returns Array of matching keys
   */
  keys(pattern?: string): Promise<string[]>

  /**
   * Iterate over hash keys (cursor-based for large datasets).
   *
   * @param options - Scan options
   * @returns Async iterator of keys
   */
  scan(options?: ScanOptions): AsyncIterable<string>

  // ===========================================================================
  // TTL OPERATIONS
  // ===========================================================================

  /**
   * Set or update TTL on a hash.
   *
   * @param key - Hash key
   * @param ttl - Time-to-live in milliseconds
   * @returns 1 if TTL was set, 0 if key doesn't exist
   */
  setTTL(key: string, ttl: number): Promise<number>

  /**
   * Get remaining TTL on a hash.
   *
   * @param key - Hash key
   * @returns Remaining TTL in ms, -1 if no TTL, -2 if key doesn't exist
   */
  getTTL(key: string): Promise<number>

  /**
   * Remove TTL from a hash (make it persistent).
   *
   * @param key - Hash key
   * @returns 1 if TTL was removed, 0 if key doesn't exist or had no TTL
   */
  persist(key: string): Promise<number>
}

// =============================================================================
// METRIC NAMES
// =============================================================================

export const HashStoreMetrics = {
  HSET_LATENCY: 'hash_store.hset.latency',
  HGET_LATENCY: 'hash_store.hget.latency',
  HDEL_LATENCY: 'hash_store.hdel.latency',
  HMSET_LATENCY: 'hash_store.hmset.latency',
  HMGET_LATENCY: 'hash_store.hmget.latency',
  HGETALL_LATENCY: 'hash_store.hgetall.latency',
  HINCRBY_LATENCY: 'hash_store.hincrby.latency',
  HASH_COUNT: 'hash_store.hash_count',
  FIELD_COUNT: 'hash_store.field_count',
} as const

// =============================================================================
// INTERNAL TYPES
// =============================================================================

/**
 * Internal hash entry with metadata.
 * @internal
 */
interface HashEntry<T> {
  fields: Map<string, T>
  expiresAt?: number
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * In-memory implementation of HashStore.
 * @internal
 */
class InMemoryHashStore<T> implements HashStore<T> {
  /** Map of key -> hash entry */
  private hashes: Map<string, HashEntry<T>> = new Map()

  /** Whether TTL is enabled */
  private readonly enableTTL: boolean

  /** Metrics collector */
  private readonly metrics: MetricsCollector

  /** Total field count (for metrics) */
  private totalFieldCount = 0

  constructor(options?: HashStoreOptions) {
    this.enableTTL = options?.enableTTL ?? false
    this.metrics = options?.metrics ?? noopMetrics
  }

  // ===========================================================================
  // SINGLE FIELD OPERATIONS
  // ===========================================================================

  async hset(key: string, field: string, value: T, options?: HSetOptions): Promise<number> {
    const start = performance.now()
    try {
      let entry = this.hashes.get(key)
      let isNewField = false

      if (!entry) {
        entry = { fields: new Map() }
        this.hashes.set(key, entry)
        this.metrics.recordGauge(HashStoreMetrics.HASH_COUNT, this.hashes.size)
      }

      if (!entry.fields.has(field)) {
        isNewField = true
        this.totalFieldCount++
        this.metrics.recordGauge(HashStoreMetrics.FIELD_COUNT, this.totalFieldCount)
      }

      entry.fields.set(field, value)

      // Handle TTL
      if (this.enableTTL && options?.ttl !== undefined) {
        entry.expiresAt = Date.now() + options.ttl
      }

      return isNewField ? 1 : 0
    } finally {
      this.metrics.recordLatency(HashStoreMetrics.HSET_LATENCY, performance.now() - start)
    }
  }

  async hget(key: string, field: string): Promise<T | null> {
    const start = performance.now()
    try {
      const entry = this.getValidEntry(key)
      if (!entry) {
        return null
      }

      return entry.fields.get(field) ?? null
    } finally {
      this.metrics.recordLatency(HashStoreMetrics.HGET_LATENCY, performance.now() - start)
    }
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    const start = performance.now()
    try {
      const entry = this.getValidEntry(key)
      if (!entry) {
        return 0
      }

      let deleted = 0
      for (const field of fields) {
        if (entry.fields.delete(field)) {
          deleted++
          this.totalFieldCount--
        }
      }

      this.metrics.recordGauge(HashStoreMetrics.FIELD_COUNT, this.totalFieldCount)

      return deleted
    } finally {
      this.metrics.recordLatency(HashStoreMetrics.HDEL_LATENCY, performance.now() - start)
    }
  }

  async hexists(key: string, field: string): Promise<boolean> {
    const entry = this.getValidEntry(key)
    if (!entry) {
      return false
    }
    return entry.fields.has(field)
  }

  async hsetnx(key: string, field: string, value: T): Promise<number> {
    const entry = this.getValidEntry(key)
    if (entry && entry.fields.has(field)) {
      return 0
    }
    return this.hset(key, field, value)
  }

  // ===========================================================================
  // BULK FIELD OPERATIONS
  // ===========================================================================

  async hmset(key: string, fields: Record<string, T>): Promise<void> {
    const start = performance.now()
    try {
      let entry = this.hashes.get(key)

      if (!entry) {
        entry = { fields: new Map() }
        this.hashes.set(key, entry)
        this.metrics.recordGauge(HashStoreMetrics.HASH_COUNT, this.hashes.size)
      }

      for (const [field, value] of Object.entries(fields)) {
        if (!entry.fields.has(field)) {
          this.totalFieldCount++
        }
        entry.fields.set(field, value)
      }

      this.metrics.recordGauge(HashStoreMetrics.FIELD_COUNT, this.totalFieldCount)
    } finally {
      this.metrics.recordLatency(HashStoreMetrics.HMSET_LATENCY, performance.now() - start)
    }
  }

  async hmget(key: string, ...fields: string[]): Promise<(T | null)[]> {
    const start = performance.now()
    try {
      const entry = this.getValidEntry(key)
      if (!entry) {
        return fields.map(() => null)
      }

      return fields.map((field) => entry.fields.get(field) ?? null)
    } finally {
      this.metrics.recordLatency(HashStoreMetrics.HMGET_LATENCY, performance.now() - start)
    }
  }

  async hgetall(key: string): Promise<Record<string, T>> {
    const start = performance.now()
    try {
      const entry = this.getValidEntry(key)
      if (!entry) {
        return {}
      }

      const result: Record<string, T> = {}
      for (const [field, value] of entry.fields) {
        result[field] = value
      }
      return result
    } finally {
      this.metrics.recordLatency(HashStoreMetrics.HGETALL_LATENCY, performance.now() - start)
    }
  }

  async hkeys(key: string): Promise<string[]> {
    const entry = this.getValidEntry(key)
    if (!entry) {
      return []
    }
    return Array.from(entry.fields.keys())
  }

  async hvals(key: string): Promise<T[]> {
    const entry = this.getValidEntry(key)
    if (!entry) {
      return []
    }
    return Array.from(entry.fields.values())
  }

  async hlen(key: string): Promise<number> {
    const entry = this.getValidEntry(key)
    if (!entry) {
      return 0
    }
    return entry.fields.size
  }

  // ===========================================================================
  // NUMERIC OPERATIONS
  // ===========================================================================

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    const start = performance.now()
    try {
      let entry = this.hashes.get(key)

      if (!entry) {
        entry = { fields: new Map() }
        this.hashes.set(key, entry)
        this.metrics.recordGauge(HashStoreMetrics.HASH_COUNT, this.hashes.size)
      }

      const current = (entry.fields.get(field) as number | undefined) ?? 0
      const newValue = current + increment

      if (!entry.fields.has(field)) {
        this.totalFieldCount++
        this.metrics.recordGauge(HashStoreMetrics.FIELD_COUNT, this.totalFieldCount)
      }

      entry.fields.set(field, newValue as unknown as T)

      return newValue
    } finally {
      this.metrics.recordLatency(HashStoreMetrics.HINCRBY_LATENCY, performance.now() - start)
    }
  }

  async hincrbyfloat(key: string, field: string, increment: number): Promise<number> {
    // Implementation is the same as hincrby for JS (numbers are all floats)
    return this.hincrby(key, field, increment)
  }

  // ===========================================================================
  // KEY OPERATIONS
  // ===========================================================================

  async del(...keys: string[]): Promise<number> {
    let deleted = 0

    for (const key of keys) {
      const entry = this.hashes.get(key)
      if (entry) {
        this.totalFieldCount -= entry.fields.size
        this.hashes.delete(key)
        deleted++
      }
    }

    this.metrics.recordGauge(HashStoreMetrics.HASH_COUNT, this.hashes.size)
    this.metrics.recordGauge(HashStoreMetrics.FIELD_COUNT, this.totalFieldCount)

    return deleted
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.hashes.keys()).filter((key) => {
      const entry = this.hashes.get(key)!
      return !this.isExpired(entry)
    })

    if (!pattern || pattern === '*') {
      return allKeys
    }

    const regex = this.patternToRegex(pattern)
    return allKeys.filter((key) => regex.test(key))
  }

  async *scan(options?: ScanOptions): AsyncIterable<string> {
    const allKeys = await this.keys(options?.match)

    for (const key of allKeys) {
      yield key
    }
  }

  // ===========================================================================
  // TTL OPERATIONS
  // ===========================================================================

  async setTTL(key: string, ttl: number): Promise<number> {
    const entry = this.hashes.get(key)
    if (!entry) {
      return 0
    }

    entry.expiresAt = Date.now() + ttl
    return 1
  }

  async getTTL(key: string): Promise<number> {
    const entry = this.hashes.get(key)
    if (!entry) {
      return -2
    }

    if (!entry.expiresAt) {
      return -1
    }

    const remaining = entry.expiresAt - Date.now()
    return remaining > 0 ? remaining : -2
  }

  async persist(key: string): Promise<number> {
    const entry = this.hashes.get(key)
    if (!entry || !entry.expiresAt) {
      return 0
    }

    delete entry.expiresAt
    return 1
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Get a hash entry if it exists and is not expired.
   */
  private getValidEntry(key: string): HashEntry<T> | null {
    const entry = this.hashes.get(key)
    if (!entry) {
      return null
    }

    if (this.isExpired(entry)) {
      // Lazy cleanup
      this.totalFieldCount -= entry.fields.size
      this.hashes.delete(key)
      this.metrics.recordGauge(HashStoreMetrics.HASH_COUNT, this.hashes.size)
      this.metrics.recordGauge(HashStoreMetrics.FIELD_COUNT, this.totalFieldCount)
      return null
    }

    return entry
  }

  /**
   * Check if an entry is expired.
   */
  private isExpired(entry: HashEntry<T>): boolean {
    if (!this.enableTTL || !entry.expiresAt) {
      return false
    }
    return Date.now() >= entry.expiresAt
  }

  /**
   * Convert a glob pattern to a regex.
   */
  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    return new RegExp(`^${escaped}$`)
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new HashStore instance.
 *
 * @typeParam T - The type of values to store in hash fields
 * @param options - Configuration options
 * @returns A new HashStore instance
 *
 * @example
 * ```typescript
 * // Basic usage with string values
 * const store = createHashStore<string>()
 *
 * // With TTL enabled
 * const store = createHashStore<UserData>({ enableTTL: true })
 *
 * // With metrics
 * const store = createHashStore<number>({
 *   metrics: myMetricsCollector,
 * })
 * ```
 */
export function createHashStore<T = string>(options?: HashStoreOptions): HashStore<T> {
  return new InMemoryHashStore<T>(options)
}
