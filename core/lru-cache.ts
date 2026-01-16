/**
 * Simple LRU Cache implementation using Map's iteration order.
 *
 * Map in JavaScript preserves insertion order, making it ideal for LRU:
 * - To "touch" an entry (move to most recently used): delete then re-insert
 * - LRU entries are at the beginning of iteration order
 * - All operations are O(1)
 *
 * @module core/lru-cache
 */

export interface LRUCacheOptions<T> {
  /** Maximum number of entries (default: 1000) */
  maxSize?: number
  /** Optional callback when entries are evicted */
  onEvict?: (key: string, value: T) => void
}

/**
 * Generic LRU Cache with O(1) operations.
 *
 * Uses Map insertion order to track LRU - first key in iteration is LRU.
 *
 * @example
 * const cache = new LRUCache<ThingData>({ maxSize: 1000 })
 * cache.set('id-1', { $id: 'id-1', $type: 'Customer', name: 'Alice' })
 * cache.get('id-1') // Returns the thing and moves it to MRU position
 * cache.delete('id-1')
 */
export class LRUCache<T> {
  private cache = new Map<string, T>()
  private maxSize: number
  private onEvict?: (key: string, value: T) => void

  constructor(options: LRUCacheOptions<T> = {}) {
    this.maxSize = options.maxSize ?? 1000
    this.onEvict = options.onEvict
  }

  /**
   * Get a value and move it to the most recently used position.
   * @returns The value or undefined if not found
   */
  get(key: string): T | undefined {
    const value = this.cache.get(key)
    if (value === undefined) {
      return undefined
    }

    // Move to MRU by deleting and re-inserting
    this.cache.delete(key)
    this.cache.set(key, value)

    return value
  }

  /**
   * Set a value. If the cache exceeds maxSize, evict the LRU entry.
   */
  set(key: string, value: T): void {
    // If key exists, delete it first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    // Add to cache
    this.cache.set(key, value)

    // Evict LRU if over capacity
    this.evictIfNeeded()
  }

  /**
   * Delete a value from the cache.
   * @returns true if the key existed
   */
  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * Check if a key exists in the cache.
   * Does NOT update LRU position (use get() for that).
   */
  has(key: string): boolean {
    return this.cache.has(key)
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get the current number of entries.
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Iterate over all entries (no LRU update).
   */
  entries(): IterableIterator<[string, T]> {
    return this.cache.entries()
  }

  /**
   * Iterate over all values (no LRU update).
   */
  values(): IterableIterator<T> {
    return this.cache.values()
  }

  /**
   * Iterate over all keys (no LRU update).
   */
  keys(): IterableIterator<string> {
    return this.cache.keys()
  }

  /**
   * Evict LRU entries until under maxSize.
   */
  private evictIfNeeded(): void {
    while (this.cache.size > this.maxSize) {
      // Get the first key (LRU)
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        const value = this.cache.get(firstKey)
        this.cache.delete(firstKey)

        // Call eviction callback if provided
        if (this.onEvict && value !== undefined) {
          this.onEvict(firstKey, value)
        }
      } else {
        break
      }
    }
  }
}
