/**
 * Bounded LRU Cache Implementation
 *
 * LRU cache with configurable max size and memory-based eviction.
 * Provides hit/miss metrics and memory tracking.
 *
 * @module db/vector/cache
 */

// ============================================================================
// TYPES
// ============================================================================

export interface CacheEntry<V> {
  value: V
  sizeBytes: number
}

export interface CacheMetrics {
  hits: number
  misses: number
  evictions: number
}

export interface CacheConfig {
  maxSize: number
  binaryHashMaxSize?: number
  matryoshkaMaxSize?: number
  memoryLimitBytes?: number
  evictionThreshold?: number
  autoPopulateOnPromote?: boolean
}

export interface SingleCacheStats {
  size: number
  maxSize: number
  memoryBytes: number
  avgEntryBytes: number
  hits: number
  misses: number
  hitRate: number
  evictions: number
  keys: string[]
}

export interface CacheStats {
  binaryHashCache: SingleCacheStats
  matryoshkaCache: SingleCacheStats
  totalMemoryBytes: number
  memoryBytes: number
  memoryLimitBytes: number
  memoryUsagePercent: number
}

// ============================================================================
// BOUNDED LRU CACHE CLASS
// ============================================================================

/**
 * Bounded LRU Cache with memory tracking
 *
 * Features:
 * - O(1) get and set operations
 * - LRU eviction when maxSize exceeded
 * - Memory-based eviction when memoryLimit exceeded
 * - Hit/miss/eviction metrics
 * - Memory tracking per entry
 */
export class BoundedLRUCache<K extends string, V> {
  private cache = new Map<K, CacheEntry<V>>()
  private accessOrder: K[] = []
  private _maxSize: number
  private _memoryLimitBytes: number | undefined
  private _evictionThreshold: number
  private _memoryBytes = 0
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    evictions: 0,
  }
  private sizeCalculator: (value: V) => number

  constructor(
    maxSize: number,
    sizeCalculator: (value: V) => number,
    options?: {
      memoryLimitBytes?: number
      evictionThreshold?: number
    }
  ) {
    this._maxSize = maxSize
    this.sizeCalculator = sizeCalculator
    this._memoryLimitBytes = options?.memoryLimitBytes
    this._evictionThreshold = options?.evictionThreshold ?? 1.0
  }

  get maxSize(): number {
    return this._maxSize
  }

  get size(): number {
    return this.cache.size
  }

  get memoryBytes(): number {
    return this._memoryBytes
  }

  get memoryLimitBytes(): number | undefined {
    return this._memoryLimitBytes
  }

  /**
   * Get a value from the cache
   * Updates access order on hit (use for final result access)
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key)
    if (entry) {
      this.metrics.hits++
      this.updateAccessOrder(key)
      return entry.value
    }
    this.metrics.misses++
    return undefined
  }

  /**
   * Peek at a value without updating access order
   * Still tracks hit/miss metrics
   */
  peek(key: K): V | undefined {
    const entry = this.cache.get(key)
    if (entry) {
      this.metrics.hits++
      return entry.value
    }
    this.metrics.misses++
    return undefined
  }

  /**
   * Check if key exists without affecting metrics or access order
   */
  has(key: K): boolean {
    return this.cache.has(key)
  }

  /**
   * Set a value in the cache
   * Evicts LRU entries if maxSize or memoryLimit exceeded
   */
  set(key: K, value: V): void {
    const sizeBytes = this.sizeCalculator(value)

    // If key exists, update it
    if (this.cache.has(key)) {
      const oldEntry = this.cache.get(key)!
      this._memoryBytes -= oldEntry.sizeBytes
      this._memoryBytes += sizeBytes
      this.cache.set(key, { value, sizeBytes })
      this.updateAccessOrder(key)
      this.evictIfNeeded()
      return
    }

    // Add new entry
    this.cache.set(key, { value, sizeBytes })
    this.accessOrder.push(key)
    this._memoryBytes += sizeBytes

    // Evict if needed
    this.evictIfNeeded()
  }

  /**
   * Delete a key from the cache
   */
  delete(key: K): boolean {
    const entry = this.cache.get(key)
    if (entry) {
      this._memoryBytes -= entry.sizeBytes
      this.cache.delete(key)
      const idx = this.accessOrder.indexOf(key)
      if (idx >= 0) {
        this.accessOrder.splice(idx, 1)
      }
      return true
    }
    return false
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear()
    this.accessOrder = []
    this._memoryBytes = 0
  }

  /**
   * Get all keys in the cache
   */
  keys(): K[] {
    return Array.from(this.cache.keys())
  }

  /**
   * Get cache statistics
   */
  getStats(): SingleCacheStats {
    const total = this.metrics.hits + this.metrics.misses
    return {
      size: this.cache.size,
      maxSize: this._maxSize,
      memoryBytes: this._memoryBytes,
      avgEntryBytes: this.cache.size > 0 ? this._memoryBytes / this.cache.size : 0,
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      hitRate: total > 0 ? this.metrics.hits / total : 0,
      evictions: this.metrics.evictions,
      keys: this.keys(),
    }
  }

  /**
   * Reset metrics without clearing cache
   */
  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
    }
  }

  /**
   * Resize the cache, evicting entries if needed
   */
  resize(newMaxSize: number, newMemoryLimitBytes?: number): void {
    this._maxSize = newMaxSize
    if (newMemoryLimitBytes !== undefined) {
      this._memoryLimitBytes = newMemoryLimitBytes
    }
    this.evictIfNeeded()
  }

  /**
   * Update access order - move key to end (most recently used)
   */
  private updateAccessOrder(key: K): void {
    const idx = this.accessOrder.indexOf(key)
    if (idx >= 0) {
      this.accessOrder.splice(idx, 1)
    }
    this.accessOrder.push(key)
  }

  /**
   * Evict entries if size or memory limits exceeded
   */
  private evictIfNeeded(): void {
    // Check size limit
    while (this.cache.size > this._maxSize && this.accessOrder.length > 0) {
      this.evictLRU()
    }

    // Check memory limit
    if (this._memoryLimitBytes !== undefined) {
      const threshold = this._memoryLimitBytes * this._evictionThreshold
      while (this._memoryBytes > threshold && this.accessOrder.length > 0) {
        this.evictLRU()
      }
    }
  }

  /**
   * Evict the least recently used entry
   */
  private evictLRU(): void {
    if (this.accessOrder.length === 0) return

    const lruKey = this.accessOrder.shift()!
    const entry = this.cache.get(lruKey)
    if (entry) {
      this._memoryBytes -= entry.sizeBytes
      this.cache.delete(lruKey)
      this.metrics.evictions++
    }
  }
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxSize: 10000,
}

/**
 * Calculate size of a Uint8Array (binary hash)
 */
export function binaryHashSizeCalculator(value: Uint8Array): number {
  return value.byteLength
}

/**
 * Calculate size of a Map of Float32Arrays (matryoshka cache entry)
 */
export function matryoshkaSizeCalculator(value: Map<number, Float32Array>): number {
  let size = 0
  value.forEach((arr) => {
    size += arr.byteLength
  })
  // Add overhead for Map structure
  return size + 64
}

/**
 * Validate cache configuration
 */
export function validateCacheConfig(config: Partial<CacheConfig>): void {
  if (config.maxSize !== undefined) {
    if (config.maxSize <= 0) {
      throw new Error('Invalid cache size: maxSize must be positive')
    }
    if (!Number.isInteger(config.maxSize)) {
      throw new Error('Invalid cache size: maxSize must be an integer')
    }
  }

  if (config.binaryHashMaxSize !== undefined) {
    if (config.binaryHashMaxSize <= 0) {
      throw new Error('Invalid cache size: binaryHashMaxSize must be positive')
    }
  }

  if (config.matryoshkaMaxSize !== undefined) {
    if (config.matryoshkaMaxSize <= 0) {
      throw new Error('Invalid cache size: matryoshkaMaxSize must be positive')
    }
  }

  if (config.memoryLimitBytes !== undefined && config.memoryLimitBytes <= 0) {
    throw new Error('Invalid cache size: memoryLimitBytes must be positive')
  }

  if (config.evictionThreshold !== undefined) {
    if (config.evictionThreshold <= 0 || config.evictionThreshold > 1) {
      throw new Error('Invalid cache config: evictionThreshold must be between 0 and 1')
    }
  }
}
