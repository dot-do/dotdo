/**
 * KV Store Integration Layer for dotdo
 *
 * Provides a unified, typed interface for Cloudflare KV operations with:
 * - Namespacing for multi-tenant isolation
 * - Automatic JSON serialization/deserialization
 * - TTL management helpers
 * - Session, API key, and rate limit specialized methods
 * - Batch operations support
 * - General-purpose caching layer
 */

/**
 * Cloudflare KV Namespace interface
 */
export interface KVNamespace {
  get(key: string, options?: { type?: string }): Promise<unknown>
  put(key: string, value: string, options?: { expirationTtl?: number; expiration?: number }): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string; expiration?: number }>
    list_complete: boolean
    cursor?: string
  }>
  getWithMetadata(key: string, options?: { type?: string }): Promise<{ value: unknown; metadata: unknown }>
}

/**
 * Configuration options for KVStore
 */
export interface KVStoreConfig {
  /** Namespace prefix for multi-tenant isolation */
  namespace?: string
  /** Default TTL in seconds for all operations */
  defaultTtl?: number
  /** Separator between namespace and key (default: ':') */
  separator?: string
}

/**
 * Options for set operations
 */
export interface SetOptions {
  /** TTL in seconds (0 = no expiration) */
  ttl?: number
  /** Absolute expiration timestamp (unix seconds) */
  expiration?: number
}

/**
 * Rate limit counter data
 */
export interface RateLimitData {
  count: number
  windowStart: number
}

/**
 * Rate limit check result
 */
export interface RateLimitCheckResult {
  allowed: boolean
  remaining: number
  count: number
}

/**
 * List operation result
 */
export interface ListResult {
  keys: Array<{ name: string; expiration?: number }>
  list_complete: boolean
  cursor?: string
}

/**
 * Cache options
 */
export interface CacheOptions {
  /** TTL in seconds */
  ttl: number
  /** Whether to cache null results from factory (default: false) */
  cacheNull?: boolean
}

/**
 * TTL helpers for convenience
 */
export interface TTLHelpers {
  /** Convert seconds to seconds (identity, for consistency) */
  seconds(n: number): number
  /** Convert minutes to seconds */
  minutes(n: number): number
  /** Convert hours to seconds */
  hours(n: number): number
  /** Convert days to seconds */
  days(n: number): number
}

/**
 * Singleton TTL helpers instance
 */
const TTL_HELPERS: TTLHelpers = {
  seconds: (n: number) => n,
  minutes: (n: number) => n * 60,
  hours: (n: number) => n * 3600,
  days: (n: number) => n * 86400,
}

/**
 * KVStore class providing typed KV operations
 */
export class KVStore {
  private kv: KVNamespace
  private namespace: string | undefined
  private defaultTtl: number | undefined
  private separator: string

  constructor(kv: KVNamespace, config?: KVStoreConfig) {
    this.kv = kv
    this.namespace = config?.namespace
    this.defaultTtl = config?.defaultTtl
    this.separator = config?.separator ?? ':'
  }

  /**
   * Build the full key with namespace prefix
   */
  private buildKey(key: string): string {
    if (this.namespace) {
      return `${this.namespace}${this.separator}${key}`
    }
    return key
  }

  /**
   * Strip namespace prefix from key
   */
  private stripNamespace(fullKey: string): string {
    if (this.namespace) {
      const prefix = `${this.namespace}${this.separator}`
      if (fullKey.startsWith(prefix)) {
        return fullKey.slice(prefix.length)
      }
    }
    return fullKey
  }

  /**
   * Build put options from SetOptions
   */
  private buildPutOptions(options?: SetOptions): { expirationTtl?: number; expiration?: number } {
    const result: { expirationTtl?: number; expiration?: number } = {}

    // If ttl is explicitly 0, no TTL (permanent storage)
    if (options?.ttl === 0) {
      return result
    }

    // If absolute expiration is provided, use it
    if (options?.expiration !== undefined) {
      result.expiration = options.expiration
      return result
    }

    // Use provided TTL or default TTL
    const ttl = options?.ttl ?? this.defaultTtl
    if (ttl !== undefined) {
      result.expirationTtl = ttl
    }

    return result
  }

  // ============================================================================
  // Basic Operations
  // ============================================================================

  /**
   * Get a value by key
   */
  async get<T>(key: string): Promise<T | null> {
    const fullKey = this.buildKey(key)
    const result = await this.kv.get(fullKey, { type: 'json' })
    return result as T | null
  }

  /**
   * Set a value by key with optional TTL
   */
  async set<T>(key: string, value: T, options?: SetOptions): Promise<void> {
    const fullKey = this.buildKey(key)
    const serialized = JSON.stringify(value)
    const putOptions = this.buildPutOptions(options)
    await this.kv.put(fullKey, serialized, putOptions)
  }

  /**
   * Delete a key
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.buildKey(key)
    await this.kv.delete(fullKey)
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.get(key)
    return result !== null
  }

  // ============================================================================
  // TTL Convenience Methods
  // ============================================================================

  /**
   * Set a value with explicit TTL (convenience method)
   */
  async setWithTTL<T>(key: string, value: T, ttl: number): Promise<void> {
    await this.set(key, value, { ttl })
  }

  /**
   * TTL helper functions for easy time unit conversion
   *
   * @example
   * ```typescript
   * // Store for 5 minutes
   * await store.set('key', value, { ttl: store.ttl.minutes(5) })
   *
   * // Store for 2 hours
   * await store.set('key', value, { ttl: store.ttl.hours(2) })
   * ```
   */
  get ttl(): TTLHelpers {
    return TTL_HELPERS
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Store a session with TTL
   */
  async setSession<T>(sessionId: string, data: T, ttl: number): Promise<void> {
    await this.set(sessionId, data, { ttl })
  }

  /**
   * Get a session by ID
   */
  async getSession<T>(sessionId: string): Promise<T | null> {
    return this.get<T>(sessionId)
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.delete(sessionId)
  }

  /**
   * Refresh a session's TTL without modifying data
   * Returns true if session was refreshed, false if it didn't exist
   */
  async refreshSession<T>(sessionId: string, ttl: number): Promise<boolean> {
    const data = await this.getSession<T>(sessionId)
    if (data === null) {
      return false
    }
    await this.setSession(sessionId, data, ttl)
    return true
  }

  // ============================================================================
  // API Key Cache
  // ============================================================================

  /**
   * Cache an API key lookup result
   */
  async cacheApiKey<T>(apiKey: string, data: T, ttl: number): Promise<void> {
    await this.set(apiKey, data, { ttl })
  }

  /**
   * Get a cached API key
   */
  async getApiKey<T>(apiKey: string): Promise<T | null> {
    return this.get<T>(apiKey)
  }

  /**
   * Invalidate a cached API key
   */
  async invalidateApiKey(apiKey: string): Promise<void> {
    await this.delete(apiKey)
  }

  // ============================================================================
  // Rate Limiting
  // ============================================================================

  /**
   * Get rate limit counter for a key
   */
  async getRateLimit(key: string): Promise<RateLimitData | null> {
    return this.get<RateLimitData>(key)
  }

  /**
   * Increment rate limit counter, creating if needed
   */
  async incrementRateLimit(key: string, windowSeconds: number): Promise<RateLimitData> {
    const existing = await this.getRateLimit(key)
    const now = Date.now()

    const data: RateLimitData = existing
      ? { count: existing.count + 1, windowStart: existing.windowStart }
      : { count: 1, windowStart: now }

    await this.set(key, data, { ttl: windowSeconds })
    return data
  }

  /**
   * Reset rate limit counter
   */
  async resetRateLimit(key: string): Promise<void> {
    await this.delete(key)
  }

  /**
   * Check rate limit and increment counter
   * Returns whether request is allowed and remaining count
   */
  async checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitCheckResult> {
    const existing = await this.getRateLimit(key)
    const currentCount = existing?.count ?? 0

    // If already at or over limit, reject
    if (currentCount >= limit) {
      return {
        allowed: false,
        remaining: 0,
        count: currentCount,
      }
    }

    // Increment and allow
    const data = await this.incrementRateLimit(key, windowSeconds)
    const remaining = Math.max(0, limit - data.count)

    return {
      allowed: true,
      remaining,
      count: data.count,
    }
  }

  // ============================================================================
  // Cache Layer
  // ============================================================================

  /**
   * Get cached value or compute and cache it
   */
  async cache<T>(key: string, factory: () => Promise<T>, options: CacheOptions): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(key)
    if (cached !== null) {
      return cached
    }

    // Compute value from factory
    const value = await factory()

    // Cache the result (unless null and cacheNull is false)
    if (value !== null || options.cacheNull) {
      await this.set(key, value, { ttl: options.ttl })
    }

    return value
  }

  /**
   * Invalidate a cached value
   */
  async invalidate(key: string): Promise<void> {
    await this.delete(key)
  }

  /**
   * Invalidate all keys matching a pattern (glob-style with *)
   */
  async invalidatePattern(pattern: string): Promise<void> {
    // Convert glob pattern to prefix (everything before the first *)
    const prefix = pattern.replace(/\*.*$/, '')
    const fullPrefix = this.buildKey(prefix)

    // List all keys with the prefix
    const result = await this.kv.list({ prefix: fullPrefix })

    // Delete all matching keys
    await Promise.all(result.keys.map((k) => this.kv.delete(k.name)))
  }

  // ============================================================================
  // Batch Operations
  // ============================================================================

  /**
   * Get multiple values at once
   */
  async mget<T>(keys: string[]): Promise<Record<string, T | null>> {
    if (keys.length === 0) {
      return {}
    }

    const results = await Promise.all(keys.map((key) => this.get<T>(key)))

    const record: Record<string, T | null> = {}
    keys.forEach((key, index) => {
      record[key] = results[index] ?? null
    })

    return record
  }

  /**
   * Set multiple values at once
   */
  async mset<T>(data: Record<string, T>, options?: SetOptions): Promise<void> {
    await Promise.all(
      Object.entries(data).map(([key, value]) => this.set(key, value, options))
    )
  }

  /**
   * Delete multiple keys at once
   */
  async mdelete(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.delete(key)))
  }

  // ============================================================================
  // List Operations
  // ============================================================================

  /**
   * List keys with a given prefix
   */
  async list(prefix: string, options?: { limit?: number; cursor?: string }): Promise<ListResult> {
    const fullPrefix = this.buildKey(prefix)
    const listOptions: { prefix: string; limit?: number; cursor?: string } = {
      prefix: fullPrefix,
    }

    if (options?.limit !== undefined) {
      listOptions.limit = options.limit
    }
    if (options?.cursor !== undefined) {
      listOptions.cursor = options.cursor
    }

    const result = await this.kv.list(listOptions)

    // Strip namespace from keys
    return {
      keys: result.keys.map((k) => ({
        name: this.stripNamespace(k.name),
        expiration: k.expiration,
      })),
      list_complete: result.list_complete,
      cursor: result.cursor,
    }
  }
}

/**
 * Factory function to create a KVStore instance
 */
export function createKVStore(kv: KVNamespace, config?: KVStoreConfig): KVStore {
  return new KVStore(kv, config)
}
