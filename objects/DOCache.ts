/**
 * DOCache - Cache Layer for Durable Objects
 *
 * STUB FILE: This is a placeholder to allow tests to run and fail on assertions.
 * Implementation is TODO.
 *
 * This module will provide:
 * - TTL-based cache invalidation
 * - Event-based invalidation with dependency tracking
 * - Write-through caching
 * - Cross-DO cache invalidation messaging
 * - Cache warming strategies
 * - Observability metrics (hit/miss ratio, evictions, latency)
 *
 * @example
 * ```typescript
 * const cache = new DOCache(state, env)
 *
 * // Basic caching with TTL
 * await cache.set('user:123', userData, { ttl: 60000 })
 * const user = await cache.get('user:123')
 *
 * // Dependency-based invalidation
 * await cache.set('profile:123', profile, { dependencies: ['user:123'] })
 * await cache.invalidateCascade('user:123') // Invalidates profile too
 *
 * // Write-through with pattern invalidation
 * await cache.writeThrough('user:123', newData, { invalidatePattern: 'user:123:*' })
 * ```
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/** Options for cache set operations */
export interface CacheOptions {
  /** Time-to-live in milliseconds */
  ttl?: number
  /** Whether to refresh TTL on read access */
  refreshOnRead?: boolean
  /** Keys this entry depends on (invalidated when dependencies change) */
  dependencies?: string[]
  /** Session ID for read-your-writes consistency */
  sessionId?: string
}

/** Options for cache get operations */
export interface GetOptions {
  /** Session ID for read-your-writes consistency */
  sessionId?: string
  /** Allow returning stale data */
  allowStale?: boolean
  /** Consistency level for this read */
  consistency?: ConsistencyLevel
}

/** Options for write-through operations */
export interface WriteThroughOptions {
  /** Pattern of keys to invalidate (glob-style) */
  invalidatePattern?: string
}

/** Options for broadcast invalidation */
export interface BroadcastOptions {
  /** Target DO namespaces to notify */
  targetNamespaces?: string[]
}

/** Cache entry stored in the cache */
export interface CacheEntry<T = unknown> {
  key: string
  value: T
  ttl: number
  expiresAt: number
  createdAt: number
  lastAccessedAt: number
  etag: string
  dependencies: string[]
  metadata: Record<string, unknown>
}

/** Cache configuration options */
export interface CacheConfig {
  /** Default TTL for entries without explicit TTL */
  defaultTTL?: number
  /** Namespace for this cache instance */
  namespace?: string
  /** Consistency mode */
  consistency?: ConsistencyLevel
  /** Window for eventual consistency in milliseconds */
  consistencyWindowMs?: number
  /** Loader function for cache misses */
  loader?: (key: string) => Promise<unknown>
  /** Bulk loader function for warming */
  bulkLoader?: (keys: string[]) => Promise<Map<string, unknown>>
  /** Maximum cache size (number of entries) */
  maxSize?: number
  /** Eviction policy when max size reached */
  evictionPolicy?: 'lru' | 'lfu' | 'fifo'
  /** Enable metrics tracking */
  enableMetrics?: boolean
  /** Track access patterns for hot key detection */
  trackAccessPatterns?: boolean
  /** Threshold for considering a key "hot" */
  hotKeyThreshold?: number
}

/** Cache statistics */
export interface CacheStats {
  hits: number
  misses: number
  hitRatio: number
  evictions: number
  size: number
  avgLatencyMs: {
    hit: number
    miss: number
    write: number
  }
}

/** Invalidation event structure */
export interface InvalidationEvent {
  type: 'write' | 'delete' | 'expire' | 'cascade' | 'manual'
  key: string
  source: string
  timestamp: number
  cascadeKeys?: string[]
  reason?: string
}

/** Cache dependency definition */
export interface CacheDependency {
  key: string
  dependents: string[]
}

/** Consistency level for cache operations */
export type ConsistencyLevel = 'strong' | 'eventual' | 'session'

/** Warming strategy configuration */
export interface WarmingStrategy {
  type: 'lazy' | 'eager' | 'hot-keys'
  keys?: string[]
  patterns?: string[]
}

/** Result of cascade invalidation */
export interface CascadeInvalidationResult {
  invalidatedKeys: string[]
  duration: number
}

/** Result of batch invalidation */
export interface BatchInvalidationResult {
  invalidatedCount: number
}

/** Entry with etag for optimistic locking */
export interface EntryWithEtag<T> {
  value: T
  etag: string
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

/** Error thrown when accessing an expired cache entry */
export class CacheExpiredError extends Error {
  constructor(key: string) {
    super(`Cache entry '${key}' has expired`)
    this.name = 'CacheExpiredError'
  }
}

/** Error thrown when a cache entry is invalidated */
export class CacheInvalidatedError extends Error {
  constructor(key: string, reason?: string) {
    super(`Cache entry '${key}' was invalidated${reason ? `: ${reason}` : ''}`)
    this.name = 'CacheInvalidatedError'
  }
}

/** Error thrown when a cache key is not found */
export class CacheMissError extends Error {
  constructor(key: string) {
    super(`Cache miss for key '${key}'`)
    this.name = 'CacheMissError'
  }
}

/** Error thrown when etag doesn't match for compare-and-swap */
export class ETagMismatchError extends Error {
  constructor(key: string, expected: string, actual: string) {
    super(`ETag mismatch for '${key}': expected '${expected}', got '${actual}'`)
    this.name = 'ETagMismatchError'
  }
}

// ============================================================================
// DOCACHE CLASS - IMPLEMENTATION
// ============================================================================

/** Internal cache entry with metadata */
interface InternalCacheEntry<T = unknown> {
  value: T
  ttl: number
  expiresAt: number
  createdAt: number
  lastAccessedAt: number
  etag: string
  dependencies: string[]
  refreshOnRead: boolean
  sessionId?: string
}

/**
 * DOCache - Cache layer for Durable Objects
 *
 * Provides TTL-based expiration, dependency tracking, write-through caching,
 * and observability metrics.
 */
export class DOCache {
  private state: DurableObjectState
  private env: unknown
  private config: CacheConfig

  // In-memory cache store
  private cache = new Map<string, InternalCacheEntry>()

  // Dependency tracking: dependencyKey -> Set of dependent keys
  private dependencyIndex = new Map<string, Set<string>>()

  // Reverse dependency tracking: key -> Set of its dependencies
  private reverseDependencyIndex = new Map<string, Set<string>>()

  // Access tracking for hot keys
  private accessCounts = new Map<string, number>()

  // Track recently expired keys for distinguishing CacheExpiredError from CacheMissError
  private recentlyExpired = new Set<string>()

  // Metrics
  private metrics = {
    hits: 0,
    misses: 0,
    evictions: 0,
    hitLatencies: [] as number[],
    missLatencies: [] as number[],
    writeLatencies: [] as number[],
  }

  // Invalidation event subscribers
  private invalidationListeners: ((event: InvalidationEvent) => void)[] = []

  constructor(state: DurableObjectState, env: unknown, config: CacheConfig = {}) {
    this.state = state
    this.env = env
    this.config = {
      defaultTTL: config.defaultTTL ?? 60000, // 1 minute default
      namespace: config.namespace,
      consistency: config.consistency ?? 'session',
      consistencyWindowMs: config.consistencyWindowMs ?? 100,
      loader: config.loader,
      bulkLoader: config.bulkLoader,
      maxSize: config.maxSize,
      evictionPolicy: config.evictionPolicy ?? 'lru',
      enableMetrics: config.enableMetrics ?? false,
      trackAccessPatterns: config.trackAccessPatterns ?? false,
      hotKeyThreshold: config.hotKeyThreshold ?? 3,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  private generateEtag(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
  }

  private isExpired(entry: InternalCacheEntry): boolean {
    return Date.now() >= entry.expiresAt
  }

  private evictIfNeeded(): void {
    if (!this.config.maxSize || this.cache.size < this.config.maxSize) {
      return
    }

    // Evict based on policy
    const policy = this.config.evictionPolicy ?? 'lru'
    let keyToEvict: string | null = null

    if (policy === 'lru') {
      // Find least recently accessed
      let oldest = Infinity
      for (const [key, entry] of this.cache) {
        if (entry.lastAccessedAt < oldest) {
          oldest = entry.lastAccessedAt
          keyToEvict = key
        }
      }
    } else if (policy === 'lfu') {
      // Find least frequently accessed
      let minCount = Infinity
      for (const [key] of this.cache) {
        const count = this.accessCounts.get(key) ?? 0
        if (count < minCount) {
          minCount = count
          keyToEvict = key
        }
      }
    } else if (policy === 'fifo') {
      // Find oldest by creation time
      let oldest = Infinity
      for (const [key, entry] of this.cache) {
        if (entry.createdAt < oldest) {
          oldest = entry.createdAt
          keyToEvict = key
        }
      }
    }

    if (keyToEvict) {
      this.cache.delete(keyToEvict)
      this.metrics.evictions++
      this.emitInvalidationEvent({
        type: 'expire',
        key: keyToEvict,
        source: this.config.namespace ?? 'unknown',
        timestamp: Date.now(),
        reason: 'eviction',
      })
    }
  }

  private emitInvalidationEvent(event: InvalidationEvent): void {
    for (const listener of this.invalidationListeners) {
      listener(event)
    }
  }

  private matchesPattern(key: string, pattern: string): boolean {
    // Simple glob matching for patterns like "user:123:*"
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
      .replace(/\*/g, '.*') // Convert * to .*
    return new RegExp(`^${regexPattern}$`).test(key)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async get<T>(key: string, options?: GetOptions): Promise<T | undefined> {
    // Use performance.now() for latency tracking - unaffected by fake timers
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const getLatency = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime

    // Strong consistency - bypass cache and read from storage
    if (options?.consistency === 'strong') {
      const stored = await this.state.storage.get<{ value: T }>(key)
      if (stored?.value !== undefined) {
        return stored.value
      }
      return undefined
    }

    const entry = this.cache.get(key)

    // Cache miss
    if (!entry) {
      // Try loader if configured
      if (this.config.loader) {
        const loaded = await this.config.loader(key)
        if (loaded !== null && loaded !== undefined) {
          if (this.config.enableMetrics) {
            this.metrics.misses++
            this.metrics.missLatencies.push(getLatency())
          }
          // Cache the loaded value
          await this.set(key, loaded as T)
          return loaded as T
        }
      }

      if (this.config.enableMetrics) {
        this.metrics.misses++
        this.metrics.missLatencies.push(getLatency())
      }
      return undefined
    }

    // Check expiration
    if (this.isExpired(entry)) {
      this.cache.delete(key)
      // Track that this key expired (for getOrThrow to distinguish from miss)
      this.recentlyExpired.add(key)
      if (this.config.enableMetrics) {
        this.metrics.misses++
        this.metrics.missLatencies.push(getLatency())
      }
      return undefined
    }

    // Refresh TTL if configured
    if (entry.refreshOnRead) {
      entry.expiresAt = Date.now() + entry.ttl
    }
    entry.lastAccessedAt = Date.now()

    // Track access for hot keys
    if (this.config.trackAccessPatterns) {
      this.accessCounts.set(key, (this.accessCounts.get(key) ?? 0) + 1)
    }

    if (this.config.enableMetrics) {
      this.metrics.hits++
      this.metrics.hitLatencies.push(getLatency())
    }

    return entry.value as T
  }

  async getOrThrow<T>(key: string, options?: GetOptions): Promise<T> {
    const entry = this.cache.get(key)

    // Check if entry exists but is expired - throw CacheExpiredError
    if (entry && this.isExpired(entry)) {
      this.cache.delete(key)
      this.recentlyExpired.add(key)
      throw new CacheExpiredError(key)
    }

    // If no entry, check if it was recently expired
    if (!entry) {
      if (this.recentlyExpired.has(key)) {
        throw new CacheExpiredError(key)
      }
      throw new CacheMissError(key)
    }

    // Entry exists and is valid
    if (entry.refreshOnRead) {
      entry.expiresAt = Date.now() + entry.ttl
    }
    entry.lastAccessedAt = Date.now()

    return entry.value as T
  }

  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    const startTime = Date.now()

    // Clear recently expired status when setting a new value
    this.recentlyExpired.delete(key)

    // Evict if at capacity
    this.evictIfNeeded()

    const now = Date.now()
    const ttl = options?.ttl ?? this.config.defaultTTL ?? 60000

    const entry: InternalCacheEntry<T> = {
      value,
      ttl,
      expiresAt: now + ttl,
      createdAt: now,
      lastAccessedAt: now,
      etag: this.generateEtag(),
      dependencies: options?.dependencies ?? [],
      refreshOnRead: options?.refreshOnRead ?? false,
      sessionId: options?.sessionId,
    }

    // Persist to storage FIRST - if this fails, don't update cache
    // This ensures cache consistency - no partial writes
    await this.state.storage.put(key, { value, metadata: { updatedAt: now } })

    // Only update cache if storage write succeeded
    // Update dependency index
    for (const dep of entry.dependencies) {
      if (!this.dependencyIndex.has(dep)) {
        this.dependencyIndex.set(dep, new Set())
      }
      this.dependencyIndex.get(dep)!.add(key)
    }

    // Update reverse dependency index
    this.reverseDependencyIndex.set(key, new Set(entry.dependencies))

    this.cache.set(key, entry)

    if (this.config.enableMetrics) {
      this.metrics.writeLatencies.push(Date.now() - startTime)
    }
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key)
    if (!entry) return false
    if (this.isExpired(entry)) {
      this.cache.delete(key)
      return false
    }
    return true
  }

  async delete(key: string): Promise<boolean> {
    const existed = this.cache.has(key)
    this.cache.delete(key)
    this.accessCounts.delete(key)
    await this.state.storage.delete(key)
    return existed
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ETAG / OPTIMISTIC LOCKING
  // ═══════════════════════════════════════════════════════════════════════════

  async setWithEtag<T>(key: string, value: T, options?: CacheOptions): Promise<EntryWithEtag<T>> {
    await this.set(key, value, options)
    const entry = this.cache.get(key)!
    return { value, etag: entry.etag }
  }

  async compareAndSwap<T>(key: string, value: T, expectedEtag: string): Promise<EntryWithEtag<T>> {
    const entry = this.cache.get(key)
    if (!entry) {
      throw new CacheMissError(key)
    }
    if (entry.etag !== expectedEtag) {
      throw new ETagMismatchError(key, expectedEtag, entry.etag)
    }
    return this.setWithEtag(key, value)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INVALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  async invalidate(key: string): Promise<void> {
    this.cache.delete(key)
    this.accessCounts.delete(key)
    this.emitInvalidationEvent({
      type: 'manual',
      key,
      source: this.config.namespace ?? 'unknown',
      timestamp: Date.now(),
    })
  }

  async invalidateByDependency(dependencyKey: string): Promise<void> {
    const dependents = this.dependencyIndex.get(dependencyKey)
    if (dependents) {
      for (const dependent of dependents) {
        await this.invalidate(dependent)
      }
      this.dependencyIndex.delete(dependencyKey)
    }
  }

  async invalidateCascade(key: string): Promise<CascadeInvalidationResult> {
    const startTime = Date.now()
    const invalidatedKeys: string[] = []
    const visited = new Set<string>()

    const cascade = (currentKey: string) => {
      if (visited.has(currentKey)) return
      visited.add(currentKey)
      invalidatedKeys.push(currentKey)

      // Get all entries that depend on this key
      const dependents = this.dependencyIndex.get(currentKey)
      if (dependents) {
        for (const dependent of dependents) {
          cascade(dependent)
        }
      }
    }

    cascade(key)

    // Actually invalidate all collected keys
    for (const k of invalidatedKeys) {
      this.cache.delete(k)
      this.accessCounts.delete(k)
    }

    this.emitInvalidationEvent({
      type: 'cascade',
      key,
      source: this.config.namespace ?? 'unknown',
      timestamp: Date.now(),
      cascadeKeys: invalidatedKeys,
    })

    return {
      invalidatedKeys,
      duration: Date.now() - startTime,
    }
  }

  async invalidateMany(keys: string[]): Promise<BatchInvalidationResult> {
    let count = 0
    for (const key of keys) {
      if (this.cache.has(key)) {
        this.cache.delete(key)
        this.accessCounts.delete(key)
        count++
      }
    }
    return { invalidatedCount: count }
  }

  async broadcastInvalidation(key: string, options?: BroadcastOptions): Promise<void> {
    if (!options?.targetNamespaces?.length) return

    const env = this.env as { DO?: { idFromName: (name: string) => unknown; get: (id: unknown) => { fetch: (req: Request) => Promise<Response> } } }
    if (!env.DO) return

    for (const namespace of options.targetNamespaces) {
      const id = env.DO.idFromName(namespace)
      const stub = env.DO.get(id)
      await stub.fetch(new Request('https://internal/invalidate', {
        method: 'POST',
        body: JSON.stringify({ key }),
      }))
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WRITE-THROUGH
  // ═══════════════════════════════════════════════════════════════════════════

  async writeThrough<T>(key: string, value: T, options?: WriteThroughOptions): Promise<void> {
    // First invalidate matching pattern
    if (options?.invalidatePattern) {
      const pattern = options.invalidatePattern
      for (const cacheKey of this.cache.keys()) {
        if (this.matchesPattern(cacheKey, pattern)) {
          this.cache.delete(cacheKey)
        }
      }
    }

    // Write to cache and storage
    await this.set(key, value)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WARMING
  // ═══════════════════════════════════════════════════════════════════════════

  async warmMany(keys: string[]): Promise<void> {
    if (!this.config.bulkLoader) return

    const loaded = await this.config.bulkLoader(keys)
    for (const [key, value] of loaded) {
      await this.set(key, value)
    }
  }

  async getHotKeys(): Promise<string[]> {
    const threshold = this.config.hotKeyThreshold ?? 3
    const hotKeys: string[] = []

    for (const [key, count] of this.accessCounts) {
      if (count >= threshold) {
        hotKeys.push(key)
      }
    }

    return hotKeys
  }

  async warmHotKeys(loader: (keys: string[]) => Promise<Map<string, unknown>>): Promise<void> {
    const hotKeys = await this.getHotKeys()
    if (hotKeys.length === 0) return

    const loaded = await loader(hotKeys)
    for (const [key, value] of loaded) {
      await this.set(key, value)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // METRICS
  // ═══════════════════════════════════════════════════════════════════════════

  async getStats(): Promise<CacheStats> {
    const avgLatency = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0

    const total = this.metrics.hits + this.metrics.misses
    return {
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      hitRatio: total > 0 ? this.metrics.hits / total : 0,
      evictions: this.metrics.evictions,
      size: this.cache.size,
      avgLatencyMs: {
        hit: avgLatency(this.metrics.hitLatencies),
        miss: avgLatency(this.metrics.missLatencies),
        write: avgLatency(this.metrics.writeLatencies),
      },
    }
  }

  onInvalidation(callback: (event: InvalidationEvent) => void): void {
    this.invalidationListeners.push(callback)
  }
}
