/**
 * Write Buffer Cache for DO SQLite Cost Optimization
 *
 * LRU cache with dirty tracking for batch checkpointing.
 * This enables columnar storage patterns that achieve 99%+ cost reduction
 * by buffering writes and flushing in batches.
 *
 * @module storage/write-buffer
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Cache entry for LRU cache
 */
interface CacheEntry<V> {
  value: V
  size: number
  dirty: boolean
  expiresAt?: number
  accessedAt: number
}

/**
 * Eviction reason for callbacks
 */
export type EvictionReason = 'count' | 'size' | 'expired' | 'deleted' | 'cleared' | 'checkpoint'

/**
 * Options for the write-buffering LRU cache
 */
export interface WriteBufferCacheOptions<V> {
  /** Maximum number of items (default: 500) */
  maxCount?: number
  /** Maximum size in bytes (default: 25MB) */
  maxBytes?: number
  /** Default TTL in milliseconds (default: 0, no expiry) */
  defaultTTL?: number
  /** Callback when an item is evicted */
  onEvict?: (key: string, value: V, reason: EvictionReason) => void
  /** Size calculator for values */
  sizeCalculator?: (value: V) => number
}

/**
 * Cache statistics
 */
export interface CacheStats {
  count: number
  bytes: number
  dirtyCount: number
  hits: number
  misses: number
  hitRate: number
  evictions: number
  checkpoints: number
  memoryUsageRatio: number
}

// ============================================================================
// Write-Buffering LRU Cache
// ============================================================================

/**
 * LRU Cache with write buffering for batch checkpoints
 *
 * This cache tracks dirty entries and flushes them in batches to minimize
 * row writes to SQLite.
 *
 * ## Key Features
 *
 * - **LRU Eviction**: Automatically evicts least-recently-used items
 * - **Dirty Tracking**: Tracks which entries have been modified since last checkpoint
 * - **Size Limits**: Enforces both count and byte limits
 * - **TTL Support**: Optional time-to-live for cache entries
 * - **Eviction Callbacks**: Hooks for handling evicted items
 *
 * @example
 * ```typescript
 * const cache = new WriteBufferCache<SessionState>({
 *   maxCount: 500,
 *   maxBytes: 25 * 1024 * 1024, // 25MB
 *   defaultTTL: 3600000, // 1 hour
 *   onEvict: (key, value, reason) => {
 *     console.log(`Evicted ${key}: ${reason}`)
 *   },
 * })
 *
 * // Set a value (marks as dirty by default)
 * cache.set('session-123', sessionState)
 *
 * // Get dirty entries for checkpointing
 * const dirty = cache.getDirtyEntries()
 *
 * // Mark entries as clean after checkpoint
 * cache.markClean(Array.from(dirty.keys()))
 * ```
 */
export class WriteBufferCache<V> {
  private cache: Map<string, CacheEntry<V>> = new Map()
  private dirtyKeys: Set<string> = new Set()
  private maxCount: number
  private maxBytes: number
  private defaultTTL: number
  private onEvict?: (key: string, value: V, reason: EvictionReason) => void
  private sizeCalculator: (value: V) => number

  // Statistics
  private totalBytes = 0
  private hits = 0
  private misses = 0
  private evictions = 0
  private checkpoints = 0

  constructor(options: WriteBufferCacheOptions<V> = {}) {
    this.maxCount = options.maxCount ?? 500
    this.maxBytes = options.maxBytes ?? 25 * 1024 * 1024 // 25MB default
    this.defaultTTL = options.defaultTTL ?? 0
    this.onEvict = options.onEvict
    this.sizeCalculator = options.sizeCalculator ?? this.defaultSizeCalculator
  }

  /**
   * Get a value from the cache
   */
  get(key: string): V | undefined {
    const entry = this.cache.get(key)

    if (!entry) {
      this.misses++
      return undefined
    }

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.evictEntry(key, entry, 'expired')
      this.misses++
      return undefined
    }

    // Update access time and move to end (most recently used)
    entry.accessedAt = Date.now()
    this.cache.delete(key)
    this.cache.set(key, entry)

    this.hits++
    return entry.value
  }

  /**
   * Set a value in the cache, marking it as dirty
   */
  set(key: string, value: V, options?: { ttl?: number; markDirty?: boolean }): void {
    const markDirty = options?.markDirty ?? true

    // Remove existing entry if present
    const existing = this.cache.get(key)
    if (existing) {
      this.totalBytes -= existing.size
      this.cache.delete(key)
    }

    // Calculate size
    const size = this.sizeCalculator(value)
    const ttl = options?.ttl ?? this.defaultTTL
    const now = Date.now()

    const entry: CacheEntry<V> = {
      value,
      size,
      dirty: markDirty,
      expiresAt: ttl > 0 ? now + ttl : undefined,
      accessedAt: now,
    }

    // Add entry
    this.cache.set(key, entry)
    this.totalBytes += size

    // Track dirty entries
    if (markDirty) {
      this.dirtyKeys.add(key)
    }

    // Evict if necessary
    this.evictIfNeeded()
  }

  /**
   * Delete a value from the cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) {
      return false
    }

    this.evictEntry(key, entry, 'deleted')
    return true
  }

  /**
   * Check if a key exists in the cache
   */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) {
      return false
    }

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.evictEntry(key, entry, 'expired')
      return false
    }

    return true
  }

  /**
   * Get all dirty entries for checkpointing
   */
  getDirtyEntries(): Map<string, V> {
    const dirtyEntries = new Map<string, V>()

    for (const key of this.dirtyKeys) {
      const entry = this.cache.get(key)
      if (entry && (!entry.expiresAt || Date.now() <= entry.expiresAt)) {
        dirtyEntries.set(key, entry.value)
      }
    }

    return dirtyEntries
  }

  /**
   * Mark entries as clean after checkpoint
   */
  markClean(keys: string[]): void {
    for (const key of keys) {
      const entry = this.cache.get(key)
      if (entry) {
        entry.dirty = false
      }
      this.dirtyKeys.delete(key)
    }
    this.checkpoints++
  }

  /**
   * Get the number of dirty entries
   */
  get dirtyCount(): number {
    return this.dirtyKeys.size
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.hits + this.misses
    return {
      count: this.cache.size,
      bytes: this.totalBytes,
      dirtyCount: this.dirtyKeys.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 0,
      evictions: this.evictions,
      checkpoints: this.checkpoints,
      memoryUsageRatio: this.maxBytes > 0 ? this.totalBytes / this.maxBytes : 0,
    }
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    if (this.onEvict) {
      for (const [key, entry] of this.cache) {
        this.onEvict(key, entry.value, 'cleared')
      }
    }
    this.cache.clear()
    this.dirtyKeys.clear()
    this.totalBytes = 0
  }

  /**
   * Iterate over cache entries
   */
  *entries(): IterableIterator<[string, V]> {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        continue
      }
      yield [key, entry.value]
    }
  }

  // Private methods

  private defaultSizeCalculator(value: V): number {
    if (value === null || value === undefined) {
      return 0
    }
    try {
      return JSON.stringify(value).length * 2 // UTF-16
    } catch {
      return 256 // Default estimate
    }
  }

  private evictIfNeeded(): void {
    // Evict by count
    while (this.cache.size > this.maxCount) {
      const key = this.cache.keys().next().value
      if (key !== undefined) {
        const entry = this.cache.get(key)
        if (entry) {
          this.evictEntry(key, entry, 'count')
        }
      } else {
        break
      }
    }

    // Evict by size
    while (this.totalBytes > this.maxBytes && this.cache.size > 0) {
      const key = this.cache.keys().next().value
      if (key !== undefined) {
        const entry = this.cache.get(key)
        if (entry) {
          this.evictEntry(key, entry, 'size')
        }
      } else {
        break
      }
    }
  }

  private evictEntry(key: string, entry: CacheEntry<V>, reason: EvictionReason): void {
    this.totalBytes -= entry.size
    this.cache.delete(key)
    this.dirtyKeys.delete(key)
    this.evictions++

    if (this.onEvict) {
      this.onEvict(key, entry.value, reason)
    }
  }
}
