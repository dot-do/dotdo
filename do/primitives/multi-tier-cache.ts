/**
 * MultiTierCache - Unified cache primitive with L1/L2/L3 architecture
 *
 * Provides a hierarchical caching system optimized for edge workloads:
 *
 * ## Architecture
 * - **L1 (Local)** - In-memory LRU cache with sub-millisecond access
 * - **L2 (Shared)** - Durable Object-backed cache with SQLite persistence
 * - **L3 (Origin)** - Custom loader function for cache misses
 *
 * ## Features
 * - **TTL Support** - Per-key time-to-live with lazy expiration
 * - **Write Strategies** - Write-through, write-back, write-around
 * - **Cache Metrics** - Hit/miss rates, latencies, eviction counts
 * - **Stale-While-Revalidate** - Serve stale data while refreshing
 * - **Negative Caching** - Cache null results to prevent cache stampede
 *
 * ## Performance Characteristics
 * | Tier | Latency | Capacity | Durability |
 * |------|---------|----------|------------|
 * | L1 | < 1ms | 1K-10K items | None (memory) |
 * | L2 | 1-5ms | Unlimited | SQLite |
 * | L3 | Variable | N/A | Origin |
 *
 * @module db/primitives/multi-tier-cache
 */

import { type MetricsCollector, noopMetrics } from './observability'

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T> {
  /** The cached value */
  value: T
  /** When the entry was created (epoch ms) */
  createdAt: number
  /** When the entry expires (epoch ms), undefined for no expiry */
  expiresAt?: number
  /** When the entry becomes stale for SWR (epoch ms) */
  staleAt?: number
  /** Last access time for LRU tracking */
  lastAccessed: number
  /** Access count for LFU tracking */
  accessCount: number
  /** Size in bytes (estimated) */
  size?: number
}

/**
 * Options for cache get operations
 */
export interface CacheGetOptions {
  /** Skip L1 cache and read from L2/L3 */
  skipL1?: boolean
  /** Skip L2 cache and read from L3 */
  skipL2?: boolean
  /** Return stale data if available while revalidating */
  staleWhileRevalidate?: boolean
}

/**
 * Options for cache set operations
 */
export interface CacheSetOptions {
  /** Time-to-live in milliseconds */
  ttl?: number
  /** Stale-while-revalidate window in milliseconds */
  staleWhileRevalidate?: number
  /** Skip writing to L1 */
  skipL1?: boolean
  /** Skip writing to L2 */
  skipL2?: boolean
  /** Force write even if key exists */
  force?: boolean
}

/**
 * Options for cache delete operations
 */
export interface CacheDeleteOptions {
  /** Only delete from L1 */
  l1Only?: boolean
  /** Delete from all tiers */
  cascade?: boolean
}

/**
 * Write strategy for cache updates
 */
export type WriteStrategy = 'write-through' | 'write-back' | 'write-around'

/**
 * Eviction policy for L1 cache
 */
export type EvictionPolicy = 'lru' | 'lfu' | 'fifo' | 'random'

/**
 * Loader function for L3 cache misses
 */
export type CacheLoader<T> = (key: string) => Promise<T | null>

/**
 * L2 storage interface (can be backed by DO SQLite, KV, etc.)
 */
export interface L2Storage<T> {
  get(key: string): Promise<CacheEntry<T> | null>
  set(key: string, entry: CacheEntry<T>): Promise<void>
  delete(key: string): Promise<boolean>
  clear(): Promise<void>
  keys(pattern?: string): Promise<string[]>
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** L1 cache statistics */
  l1: {
    hits: number
    misses: number
    size: number
    maxSize: number
    evictions: number
    hitRate: number
  }
  /** L2 cache statistics */
  l2: {
    hits: number
    misses: number
    hitRate: number
  }
  /** L3 cache statistics */
  l3: {
    loads: number
    loadErrors: number
    avgLoadTimeMs: number
  }
  /** Overall statistics */
  overall: {
    totalHits: number
    totalMisses: number
    hitRate: number
  }
}

/**
 * Configuration options for MultiTierCache
 */
export interface MultiTierCacheOptions<T> {
  /**
   * L1 (memory) cache maximum size
   * @default 1000
   */
  l1MaxSize?: number

  /**
   * L2 storage backend (optional)
   * If not provided, only L1 + L3 are used
   */
  l2Storage?: L2Storage<T>

  /**
   * L3 loader function for cache misses
   * @required
   */
  loader: CacheLoader<T>

  /**
   * Default TTL in milliseconds
   * @default undefined (no expiry)
   */
  defaultTTL?: number

  /**
   * Default stale-while-revalidate window
   * @default undefined (no SWR)
   */
  defaultSWR?: number

  /**
   * Write strategy
   * @default 'write-through'
   */
  writeStrategy?: WriteStrategy

  /**
   * L1 eviction policy
   * @default 'lru'
   */
  evictionPolicy?: EvictionPolicy

  /**
   * Enable negative caching (cache null results)
   * @default true
   */
  negativeCache?: boolean

  /**
   * TTL for negative cache entries
   * @default 60000 (1 minute)
   */
  negativeCacheTTL?: number

  /**
   * Metrics collector
   * @default noopMetrics
   */
  metrics?: MetricsCollector
}

// =============================================================================
// METRIC NAMES
// =============================================================================

export const MultiTierCacheMetrics = {
  L1_HIT: 'cache.l1.hit',
  L1_MISS: 'cache.l1.miss',
  L1_EVICTION: 'cache.l1.eviction',
  L1_SIZE: 'cache.l1.size',
  L2_HIT: 'cache.l2.hit',
  L2_MISS: 'cache.l2.miss',
  L3_LOAD: 'cache.l3.load',
  L3_LOAD_ERROR: 'cache.l3.load_error',
  GET_LATENCY: 'cache.get.latency',
  SET_LATENCY: 'cache.set.latency',
  DELETE_LATENCY: 'cache.delete.latency',
  L3_LOAD_LATENCY: 'cache.l3.load.latency',
} as const

// =============================================================================
// MULTI-TIER CACHE INTERFACE
// =============================================================================

/**
 * Multi-tier cache interface
 *
 * @typeParam T - The type of values stored in the cache
 */
export interface MultiTierCache<T> {
  /**
   * Get a value from the cache.
   * Checks L1 first, then L2, then L3 (loader).
   *
   * @param key - Cache key
   * @param options - Get options
   * @returns Cached value or null
   */
  get(key: string, options?: CacheGetOptions): Promise<T | null>

  /**
   * Get multiple values from the cache.
   *
   * @param keys - Array of cache keys
   * @param options - Get options
   * @returns Map of key to value (missing keys have null values)
   */
  getMany(keys: string[], options?: CacheGetOptions): Promise<Map<string, T | null>>

  /**
   * Set a value in the cache.
   *
   * @param key - Cache key
   * @param value - Value to cache
   * @param options - Set options (TTL, etc.)
   */
  set(key: string, value: T, options?: CacheSetOptions): Promise<void>

  /**
   * Set multiple values in the cache.
   *
   * @param entries - Map of key to value
   * @param options - Set options
   */
  setMany(entries: Map<string, T>, options?: CacheSetOptions): Promise<void>

  /**
   * Delete a value from the cache.
   *
   * @param key - Cache key
   * @param options - Delete options
   * @returns true if the key existed
   */
  delete(key: string, options?: CacheDeleteOptions): Promise<boolean>

  /**
   * Delete multiple values from the cache.
   *
   * @param keys - Array of cache keys
   * @param options - Delete options
   * @returns Number of keys deleted
   */
  deleteMany(keys: string[], options?: CacheDeleteOptions): Promise<number>

  /**
   * Clear the entire cache (L1 and optionally L2).
   *
   * @param includeL2 - Also clear L2 storage
   */
  clear(includeL2?: boolean): Promise<void>

  /**
   * Invalidate entries matching a pattern.
   *
   * @param pattern - Glob pattern (e.g., 'user:*')
   * @param includeL2 - Also invalidate L2 storage
   */
  invalidate(pattern: string, includeL2?: boolean): Promise<number>

  /**
   * Check if a key exists in the cache.
   *
   * @param key - Cache key
   * @returns true if the key exists and is not expired
   */
  has(key: string): Promise<boolean>

  /**
   * Get the TTL remaining for a key.
   *
   * @param key - Cache key
   * @returns TTL in ms, -1 if no TTL, -2 if key doesn't exist
   */
  ttl(key: string): Promise<number>

  /**
   * Update the TTL for a key.
   *
   * @param key - Cache key
   * @param ttl - New TTL in milliseconds
   * @returns true if TTL was set
   */
  expire(key: string, ttl: number): Promise<boolean>

  /**
   * Remove TTL from a key.
   *
   * @param key - Cache key
   * @returns true if TTL was removed
   */
  persist(key: string): Promise<boolean>

  /**
   * Get cache statistics.
   *
   * @returns Current cache statistics
   */
  stats(): CacheStats

  /**
   * Reset cache statistics.
   */
  resetStats(): void

  /**
   * Warm the cache by preloading keys.
   *
   * @param keys - Keys to preload
   * @returns Number of keys loaded
   */
  warm(keys: string[]): Promise<number>

  /**
   * Get all keys in L1 cache.
   *
   * @param pattern - Optional glob pattern
   * @returns Array of matching keys
   */
  keys(pattern?: string): Promise<string[]>
}

// =============================================================================
// LRU CACHE IMPLEMENTATION (L1)
// =============================================================================

/**
 * L1 LRU cache with eviction tracking
 */
class L1Cache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map()
  private readonly maxSize: number
  private readonly evictionPolicy: EvictionPolicy
  private readonly metrics: MetricsCollector
  public evictions = 0

  constructor(
    maxSize: number,
    evictionPolicy: EvictionPolicy,
    metrics: MetricsCollector
  ) {
    this.maxSize = maxSize
    this.evictionPolicy = evictionPolicy
    this.metrics = metrics
  }

  get(key: string): CacheEntry<T> | undefined {
    const entry = this.cache.get(key)
    if (entry) {
      // Check expiration
      if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
        this.cache.delete(key)
        return undefined
      }

      // Update access metadata for LRU/LFU
      entry.lastAccessed = Date.now()
      entry.accessCount++

      // Move to end for LRU (Map maintains insertion order)
      if (this.evictionPolicy === 'lru') {
        this.cache.delete(key)
        this.cache.set(key, entry)
      }

      return entry
    }
    return undefined
  }

  set(key: string, entry: CacheEntry<T>): void {
    // If key exists, update it
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      this.evict()
    }
    this.cache.set(key, entry)
    this.metrics.recordGauge(MultiTierCacheMetrics.L1_SIZE, this.cache.size)
  }

  delete(key: string): boolean {
    const deleted = this.cache.delete(key)
    this.metrics.recordGauge(MultiTierCacheMetrics.L1_SIZE, this.cache.size)
    return deleted
  }

  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (entry && entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
      this.cache.delete(key)
      return false
    }
    return this.cache.has(key)
  }

  clear(): void {
    this.cache.clear()
    this.metrics.recordGauge(MultiTierCacheMetrics.L1_SIZE, 0)
  }

  get size(): number {
    return this.cache.size
  }

  keys(pattern?: string): string[] {
    const allKeys = Array.from(this.cache.keys())
    if (!pattern || pattern === '*') {
      return allKeys
    }
    const regex = this.patternToRegex(pattern)
    return allKeys.filter((key) => regex.test(key))
  }

  private evict(): void {
    let keyToEvict: string | undefined

    switch (this.evictionPolicy) {
      case 'lru':
        // First key is least recently used (Map insertion order)
        keyToEvict = this.cache.keys().next().value
        break

      case 'lfu':
        // Find key with lowest access count
        let minCount = Infinity
        for (const [key, entry] of this.cache) {
          if (entry.accessCount < minCount) {
            minCount = entry.accessCount
            keyToEvict = key
          }
        }
        break

      case 'fifo':
        // First key is oldest (Map insertion order)
        keyToEvict = this.cache.keys().next().value
        break

      case 'random':
        // Random eviction
        const keys = Array.from(this.cache.keys())
        keyToEvict = keys[Math.floor(Math.random() * keys.length)]
        break
    }

    if (keyToEvict !== undefined) {
      this.cache.delete(keyToEvict)
      this.evictions++
      this.metrics.incrementCounter(MultiTierCacheMetrics.L1_EVICTION)
    }
  }

  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    return new RegExp(`^${escaped}$`)
  }
}

// =============================================================================
// IN-MEMORY L2 STORAGE (for testing/single-instance)
// =============================================================================

/**
 * In-memory L2 storage implementation
 */
export class InMemoryL2Storage<T> implements L2Storage<T> {
  private storage: Map<string, CacheEntry<T>> = new Map()

  async get(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.storage.get(key)
    if (!entry) return null

    // Check expiration
    if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
      this.storage.delete(key)
      return null
    }

    return entry
  }

  async set(key: string, entry: CacheEntry<T>): Promise<void> {
    this.storage.set(key, entry)
  }

  async delete(key: string): Promise<boolean> {
    return this.storage.delete(key)
  }

  async clear(): Promise<void> {
    this.storage.clear()
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.storage.keys())
    if (!pattern || pattern === '*') {
      return allKeys
    }
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
    return allKeys.filter((key) => regex.test(key))
  }
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Multi-tier cache implementation
 */
class MultiTierCacheImpl<T> implements MultiTierCache<T> {
  private readonly l1: L1Cache<T>
  private readonly l2: L2Storage<T> | undefined
  private readonly loader: CacheLoader<T>
  private readonly defaultTTL: number | undefined
  private readonly defaultSWR: number | undefined
  private readonly writeStrategy: WriteStrategy
  private readonly negativeCache: boolean
  private readonly negativeCacheTTL: number
  private readonly metrics: MetricsCollector

  // Statistics
  private l1Hits = 0
  private l1Misses = 0
  private l2Hits = 0
  private l2Misses = 0
  private l3Loads = 0
  private l3LoadErrors = 0
  private l3TotalLoadTime = 0

  // Revalidation in progress (for SWR)
  private revalidating: Set<string> = new Set()

  constructor(options: MultiTierCacheOptions<T>) {
    this.l1 = new L1Cache<T>(
      options.l1MaxSize ?? 1000,
      options.evictionPolicy ?? 'lru',
      options.metrics ?? noopMetrics
    )
    this.l2 = options.l2Storage
    this.loader = options.loader
    this.defaultTTL = options.defaultTTL
    this.defaultSWR = options.defaultSWR
    this.writeStrategy = options.writeStrategy ?? 'write-through'
    this.negativeCache = options.negativeCache ?? true
    this.negativeCacheTTL = options.negativeCacheTTL ?? 60000
    this.metrics = options.metrics ?? noopMetrics
  }

  async get(key: string, options?: CacheGetOptions): Promise<T | null> {
    const start = performance.now()

    try {
      // Check L1
      if (!options?.skipL1) {
        const l1Entry = this.l1.get(key)
        if (l1Entry) {
          this.l1Hits++
          this.metrics.incrementCounter(MultiTierCacheMetrics.L1_HIT)

          // Check if stale (SWR)
          if (
            options?.staleWhileRevalidate &&
            l1Entry.staleAt !== undefined &&
            Date.now() >= l1Entry.staleAt &&
            !this.revalidating.has(key)
          ) {
            this.revalidateInBackground(key)
          }

          return l1Entry.value
        }
        this.l1Misses++
        this.metrics.incrementCounter(MultiTierCacheMetrics.L1_MISS)
      }

      // Check L2
      if (this.l2 && !options?.skipL2) {
        const l2Entry = await this.l2.get(key)
        if (l2Entry) {
          this.l2Hits++
          this.metrics.incrementCounter(MultiTierCacheMetrics.L2_HIT)

          // Promote to L1
          if (!options?.skipL1) {
            this.l1.set(key, l2Entry)
          }

          // Check if stale (SWR)
          if (
            options?.staleWhileRevalidate &&
            l2Entry.staleAt !== undefined &&
            Date.now() >= l2Entry.staleAt &&
            !this.revalidating.has(key)
          ) {
            this.revalidateInBackground(key)
          }

          return l2Entry.value
        }
        this.l2Misses++
        this.metrics.incrementCounter(MultiTierCacheMetrics.L2_MISS)
      }

      // Load from L3
      return await this.loadFromL3(key)
    } finally {
      this.metrics.recordLatency(MultiTierCacheMetrics.GET_LATENCY, performance.now() - start)
    }
  }

  async getMany(keys: string[], options?: CacheGetOptions): Promise<Map<string, T | null>> {
    const results = new Map<string, T | null>()
    const promises = keys.map(async (key) => {
      const value = await this.get(key, options)
      results.set(key, value)
    })
    await Promise.all(promises)
    return results
  }

  async set(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    const start = performance.now()

    try {
      const now = Date.now()
      const ttl = options?.ttl ?? this.defaultTTL
      const swr = options?.staleWhileRevalidate ?? this.defaultSWR

      const entry: CacheEntry<T> = {
        value,
        createdAt: now,
        expiresAt: ttl !== undefined ? now + ttl : undefined,
        staleAt: swr !== undefined && ttl !== undefined ? now + ttl - swr : undefined,
        lastAccessed: now,
        accessCount: 1,
      }

      // Write to L1
      if (!options?.skipL1) {
        this.l1.set(key, entry)
      }

      // Write to L2 based on strategy
      if (this.l2 && !options?.skipL2) {
        if (this.writeStrategy === 'write-through') {
          await this.l2.set(key, entry)
        } else if (this.writeStrategy === 'write-back') {
          // Async write (fire and forget)
          this.l2.set(key, entry).catch(() => {
            // Log error but don't fail
          })
        }
        // write-around: skip L2 write
      }
    } finally {
      this.metrics.recordLatency(MultiTierCacheMetrics.SET_LATENCY, performance.now() - start)
    }
  }

  async setMany(entries: Map<string, T>, options?: CacheSetOptions): Promise<void> {
    const promises: Promise<void>[] = []
    for (const [key, value] of entries) {
      promises.push(this.set(key, value, options))
    }
    await Promise.all(promises)
  }

  async delete(key: string, options?: CacheDeleteOptions): Promise<boolean> {
    const start = performance.now()

    try {
      let deleted = false

      // Delete from L1
      if (this.l1.delete(key)) {
        deleted = true
      }

      // Delete from L2
      if (this.l2 && !options?.l1Only && (options?.cascade ?? true)) {
        if (await this.l2.delete(key)) {
          deleted = true
        }
      }

      return deleted
    } finally {
      this.metrics.recordLatency(MultiTierCacheMetrics.DELETE_LATENCY, performance.now() - start)
    }
  }

  async deleteMany(keys: string[], options?: CacheDeleteOptions): Promise<number> {
    let count = 0
    for (const key of keys) {
      if (await this.delete(key, options)) {
        count++
      }
    }
    return count
  }

  async clear(includeL2?: boolean): Promise<void> {
    this.l1.clear()
    if (includeL2 && this.l2) {
      await this.l2.clear()
    }
  }

  async invalidate(pattern: string, includeL2?: boolean): Promise<number> {
    let count = 0

    // Invalidate L1
    const l1Keys = this.l1.keys(pattern)
    for (const key of l1Keys) {
      this.l1.delete(key)
      count++
    }

    // Invalidate L2
    if (includeL2 && this.l2) {
      const l2Keys = await this.l2.keys(pattern)
      for (const key of l2Keys) {
        await this.l2.delete(key)
        count++
      }
    }

    return count
  }

  async has(key: string): Promise<boolean> {
    if (this.l1.has(key)) {
      return true
    }
    if (this.l2) {
      const entry = await this.l2.get(key)
      return entry !== null
    }
    return false
  }

  async ttl(key: string): Promise<number> {
    const entry = this.l1.get(key)
    if (entry) {
      if (entry.expiresAt === undefined) {
        return -1
      }
      const remaining = entry.expiresAt - Date.now()
      return remaining > 0 ? remaining : -2
    }

    if (this.l2) {
      const l2Entry = await this.l2.get(key)
      if (l2Entry) {
        if (l2Entry.expiresAt === undefined) {
          return -1
        }
        const remaining = l2Entry.expiresAt - Date.now()
        return remaining > 0 ? remaining : -2
      }
    }

    return -2
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    const entry = this.l1.get(key)
    if (entry) {
      entry.expiresAt = Date.now() + ttl
      return true
    }

    if (this.l2) {
      const l2Entry = await this.l2.get(key)
      if (l2Entry) {
        l2Entry.expiresAt = Date.now() + ttl
        await this.l2.set(key, l2Entry)
        return true
      }
    }

    return false
  }

  async persist(key: string): Promise<boolean> {
    const entry = this.l1.get(key)
    if (entry && entry.expiresAt !== undefined) {
      delete entry.expiresAt
      delete entry.staleAt
      return true
    }

    if (this.l2) {
      const l2Entry = await this.l2.get(key)
      if (l2Entry && l2Entry.expiresAt !== undefined) {
        delete l2Entry.expiresAt
        delete l2Entry.staleAt
        await this.l2.set(key, l2Entry)
        return true
      }
    }

    return false
  }

  stats(): CacheStats {
    const totalL1 = this.l1Hits + this.l1Misses
    const totalL2 = this.l2Hits + this.l2Misses
    const totalHits = this.l1Hits + this.l2Hits
    const totalMisses = this.l3Loads
    const total = totalHits + totalMisses

    return {
      l1: {
        hits: this.l1Hits,
        misses: this.l1Misses,
        size: this.l1.size,
        maxSize: 1000, // Would need to expose from L1Cache
        evictions: this.l1.evictions,
        hitRate: totalL1 > 0 ? this.l1Hits / totalL1 : 0,
      },
      l2: {
        hits: this.l2Hits,
        misses: this.l2Misses,
        hitRate: totalL2 > 0 ? this.l2Hits / totalL2 : 0,
      },
      l3: {
        loads: this.l3Loads,
        loadErrors: this.l3LoadErrors,
        avgLoadTimeMs: this.l3Loads > 0 ? this.l3TotalLoadTime / this.l3Loads : 0,
      },
      overall: {
        totalHits,
        totalMisses,
        hitRate: total > 0 ? totalHits / total : 0,
      },
    }
  }

  resetStats(): void {
    this.l1Hits = 0
    this.l1Misses = 0
    this.l2Hits = 0
    this.l2Misses = 0
    this.l3Loads = 0
    this.l3LoadErrors = 0
    this.l3TotalLoadTime = 0
  }

  async warm(keys: string[]): Promise<number> {
    let loaded = 0
    for (const key of keys) {
      const value = await this.get(key)
      if (value !== null) {
        loaded++
      }
    }
    return loaded
  }

  async keys(pattern?: string): Promise<string[]> {
    return this.l1.keys(pattern)
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private async loadFromL3(key: string): Promise<T | null> {
    const start = performance.now()
    this.l3Loads++
    this.metrics.incrementCounter(MultiTierCacheMetrics.L3_LOAD)

    try {
      const value = await this.loader(key)

      const loadTime = performance.now() - start
      this.l3TotalLoadTime += loadTime
      this.metrics.recordLatency(MultiTierCacheMetrics.L3_LOAD_LATENCY, loadTime)

      // Cache the result (including null for negative caching)
      if (value !== null) {
        await this.set(key, value)
      } else if (this.negativeCache) {
        await this.set(key, null as unknown as T, { ttl: this.negativeCacheTTL })
      }

      return value
    } catch (error) {
      this.l3LoadErrors++
      this.metrics.incrementCounter(MultiTierCacheMetrics.L3_LOAD_ERROR)
      throw error
    }
  }

  private revalidateInBackground(key: string): void {
    this.revalidating.add(key)

    this.loader(key)
      .then((value) => {
        if (value !== null) {
          // Update cache with fresh value
          this.set(key, value).catch(() => {
            // Ignore errors in background revalidation
          })
        }
      })
      .catch(() => {
        // Ignore errors in background revalidation
      })
      .finally(() => {
        this.revalidating.delete(key)
      })
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new MultiTierCache instance.
 *
 * @typeParam T - The type of values to cache
 * @param options - Configuration options
 * @returns A new MultiTierCache instance
 *
 * @example
 * ```typescript
 * // Basic usage with loader
 * const cache = createMultiTierCache<User>({
 *   loader: async (key) => fetchUserFromDB(key),
 *   defaultTTL: 60000, // 1 minute
 * })
 *
 * // With L2 storage
 * const cache = createMultiTierCache<Product>({
 *   l2Storage: new InMemoryL2Storage(),
 *   loader: async (key) => fetchProduct(key),
 *   defaultTTL: 300000, // 5 minutes
 *   defaultSWR: 60000, // 1 minute stale window
 * })
 *
 * // Usage
 * const user = await cache.get('user:123')
 * await cache.set('user:456', newUser, { ttl: 3600000 })
 * ```
 */
export function createMultiTierCache<T>(options: MultiTierCacheOptions<T>): MultiTierCache<T> {
  return new MultiTierCacheImpl<T>(options)
}
