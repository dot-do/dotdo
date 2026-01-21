/**
 * Typed DO Stub Cache with TTL and LRU Eviction
 *
 * Provides a cache for DO stubs with:
 * - Configurable TTL (time-to-live) for entries
 * - Max size limit with LRU (Least Recently Used) eviction
 * - Lazy cleanup on access
 * - Statistics tracking (hits, misses, evictions, expirations)
 *
 * Issue: do-o16uz
 *
 * @module do/workflow/stub-cache
 */

import type { DOStubProxy } from './rpc'

/**
 * Cache entry with metadata for TTL and LRU tracking
 */
export interface CacheEntry<T = DOStubProxy> {
  /** The cached value */
  value: T
  /** Timestamp when the entry was created */
  createdAt: number
  /** Timestamp of last access (for LRU) */
  lastAccessedAt: number
  /** Timestamp when the entry expires */
  expiresAt: number
}

/**
 * Configuration options for StubCache
 */
export interface StubCacheOptions {
  /** Maximum number of entries in the cache (default: 100) */
  maxSize: number
  /** Time-to-live in milliseconds (default: 5 minutes = 300000ms) */
  ttlMs: number
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number
  /** Number of cache misses */
  misses: number
  /** Hit rate (hits / (hits + misses)) */
  hitRate: number
  /** Number of entries evicted due to size limit */
  evictions: number
  /** Number of entries that expired */
  expirations: number
  /** Current number of entries */
  size: number
  /** Maximum cache size */
  maxSize: number
}

/**
 * Default cache options
 */
export const DEFAULT_STUB_CACHE_OPTIONS: StubCacheOptions = {
  maxSize: 100,
  ttlMs: 5 * 60 * 1000, // 5 minutes
}

/**
 * A typed cache for DO stubs with TTL expiration and LRU eviction.
 *
 * @example
 * ```ts
 * const cache = new StubCache({ maxSize: 100, ttlMs: 300000 })
 *
 * // Store a stub
 * cache.set('Customer:user-123', customerStub)
 *
 * // Retrieve a stub (returns undefined if expired or not found)
 * const stub = cache.get('Customer:user-123')
 *
 * // Check if entry exists and is valid
 * if (cache.has('Customer:user-123')) {
 *   // Use the stub
 * }
 *
 * // Get cache statistics
 * const stats = cache.getStats()
 * console.log(`Hit rate: ${stats.hitRate}`)
 * ```
 */
export class StubCache<T = DOStubProxy> {
  private cache: Map<string, CacheEntry<T>>
  private options: StubCacheOptions

  // Statistics
  private hits: number = 0
  private misses: number = 0
  private evictions: number = 0
  private expirations: number = 0

  constructor(options?: Partial<StubCacheOptions>) {
    this.options = { ...DEFAULT_STUB_CACHE_OPTIONS, ...options }
    this.cache = new Map()
  }

  /**
   * Get a value from the cache.
   *
   * Returns undefined if the key doesn't exist or has expired.
   * Updates the lastAccessedAt timestamp for LRU tracking.
   * Triggers lazy cleanup of expired entries.
   *
   * @param key - The cache key
   * @returns The cached value or undefined
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key)

    if (!entry) {
      this.misses++
      return undefined
    }

    // Check if expired
    if (this.isExpired(entry)) {
      this.cache.delete(key)
      this.expirations++
      this.misses++
      return undefined
    }

    // Update last access time for LRU
    entry.lastAccessedAt = Date.now()
    this.hits++

    return entry.value
  }

  /**
   * Set a value in the cache.
   *
   * If the cache is at capacity and this is a new key, the least recently
   * used entry will be evicted. Expired entries are prioritized for eviction.
   *
   * @param key - The cache key
   * @param value - The value to cache
   */
  set(key: string, value: T): void {
    const now = Date.now()

    // Check if key already exists
    const existing = this.cache.get(key)
    if (existing) {
      // Update existing entry
      existing.value = value
      existing.lastAccessedAt = now
      existing.expiresAt = now + this.options.ttlMs
      return
    }

    // Need to add new entry - check capacity
    if (this.cache.size >= this.options.maxSize) {
      this.evictOne()
    }

    // Add new entry
    const entry: CacheEntry<T> = {
      value,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: now + this.options.ttlMs,
    }

    this.cache.set(key, entry)
  }

  /**
   * Check if a key exists and is not expired.
   *
   * @param key - The cache key
   * @returns True if the key exists and is valid
   */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false
    if (this.isExpired(entry)) {
      this.cache.delete(key)
      this.expirations++
      return false
    }
    return true
  }

  /**
   * Delete a key from the cache.
   *
   * @param key - The cache key
   * @returns True if the key was deleted
   */
  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Refresh the TTL of an entry.
   *
   * @param key - The cache key
   * @returns True if the entry was refreshed
   */
  refresh(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false
    if (this.isExpired(entry)) {
      this.cache.delete(key)
      this.expirations++
      return false
    }

    const now = Date.now()
    entry.lastAccessedAt = now
    entry.expiresAt = now + this.options.ttlMs
    return true
  }

  /**
   * Manually cleanup expired entries.
   *
   * @returns The number of entries removed
   */
  cleanup(): number {
    let removed = 0

    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        this.cache.delete(key)
        this.expirations++
        removed++
      }
    }

    return removed
  }

  /**
   * Get the current number of entries in the cache.
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Get the number of valid (non-expired) entries.
   */
  get validSize(): number {
    let count = 0
    for (const entry of this.cache.values()) {
      if (!this.isExpired(entry)) {
        count++
      }
    }
    return count
  }

  /**
   * Get all cache keys (including expired ones).
   */
  keys(): string[] {
    return Array.from(this.cache.keys())
  }

  /**
   * Iterate over valid (non-expired) entries.
   */
  *entries(): IterableIterator<[string, T]> {
    for (const [key, entry] of this.cache) {
      if (!this.isExpired(entry)) {
        yield [key, entry.value]
      }
    }
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      evictions: this.evictions,
      expirations: this.expirations,
      size: this.cache.size,
      maxSize: this.options.maxSize,
    }
  }

  /**
   * Check if an entry is expired.
   */
  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() > entry.expiresAt
  }

  /**
   * Evict one entry to make room for a new one.
   *
   * Prioritizes expired entries, then falls back to LRU eviction.
   */
  private evictOne(): void {
    // First, try to evict an expired entry
    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        this.cache.delete(key)
        this.expirations++
        return
      }
    }

    // No expired entries - evict LRU
    let lruKey: string | null = null
    let lruTime = Infinity

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessedAt < lruTime) {
        lruTime = entry.lastAccessedAt
        lruKey = key
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey)
      this.evictions++
    }
  }
}

/**
 * Create a new StubCache with the given options.
 *
 * @param options - Cache configuration options
 * @returns A new StubCache instance
 */
export function createStubCache<T = DOStubProxy>(
  options?: Partial<StubCacheOptions>
): StubCache<T> {
  return new StubCache<T>(options)
}
