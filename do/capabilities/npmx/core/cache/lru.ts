/**
 * LRU Cache Implementation for Package Metadata
 *
 * A bounded Least Recently Used (LRU) cache to prevent OOM in long-running DOs.
 * When the cache exceeds maxSize, the least recently used entries are evicted.
 *
 * Features:
 * - Configurable max size (default 100)
 * - O(1) get/set/delete operations using doubly linked list + Map
 * - LRU eviction policy (evicts least recently used on overflow)
 * - Statistics tracking (hits, misses, evictions, hit rate)
 * - Optional eviction callback
 *
 * @module core/cache/lru
 */

/**
 * Configuration options for the LRU cache.
 */
export interface CacheOptions<K = string, V = unknown> {
  /**
   * Maximum number of entries in the cache.
   * When exceeded, least recently used entries are evicted.
   * @default 100
   */
  maxSize?: number

  /**
   * Callback invoked when an entry is evicted from the cache.
   * Useful for cleanup, logging, or metrics.
   */
  onEvict?: (key: K, value: V) => void
}

/**
 * Cache statistics for monitoring and debugging.
 */
export interface CacheStats {
  /** Number of successful cache lookups */
  hits: number
  /** Number of failed cache lookups */
  misses: number
  /** Number of entries evicted due to size limits */
  evictions: number
  /** Current number of entries in the cache */
  count: number
  /** Hit rate as percentage (0-100) */
  hitRate: number
}

/**
 * Internal node for the doubly linked list.
 * Enables O(1) removal and reordering.
 */
interface ListNode<K, V> {
  key: K
  value: V
  prev: ListNode<K, V> | null
  next: ListNode<K, V> | null
}

/**
 * LRU Cache with bounded size and statistics tracking.
 *
 * Uses a combination of:
 * - Map for O(1) key lookup
 * - Doubly linked list for O(1) LRU ordering
 *
 * @example
 * ```typescript
 * const cache = new LRUCache<string, PackageMetadata>({ maxSize: 100 })
 *
 * cache.set('lodash@4.17.21', metadata)
 * const hit = cache.get('lodash@4.17.21')
 *
 * const stats = cache.getStats()
 * console.log(`Hit rate: ${stats.hitRate}%`)
 * ```
 */
export class LRUCache<K = string, V = unknown> {
  private cache: Map<K, ListNode<K, V>> = new Map()
  private head: ListNode<K, V> | null = null // Most recently used
  private tail: ListNode<K, V> | null = null // Least recently used

  private _maxSize: number
  private _hits = 0
  private _misses = 0
  private _evictions = 0
  private _onEvict: ((key: K, value: V) => void) | undefined

  /**
   * Creates a new LRU cache.
   *
   * @param options - Configuration options
   */
  constructor(options?: CacheOptions<K, V>) {
    this._maxSize = options?.maxSize ?? 100
    this._onEvict = options?.onEvict ?? undefined
  }

  /**
   * Gets the current number of entries in the cache.
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Gets a value from the cache.
   * Moves the entry to the most recently used position.
   *
   * @param key - The cache key
   * @returns The cached value or undefined if not found
   */
  get(key: K): V | undefined {
    const node = this.cache.get(key)

    if (!node) {
      this._misses++
      return undefined
    }

    // Move to head (most recently used)
    this.moveToHead(node)
    this._hits++

    return node.value
  }

  /**
   * Sets a value in the cache.
   * If the key exists, updates the value and moves to MRU.
   * If at capacity, evicts the LRU entry first.
   *
   * @param key - The cache key
   * @param value - The value to cache
   */
  set(key: K, value: V): void {
    const existingNode = this.cache.get(key)

    if (existingNode) {
      // Update existing entry
      existingNode.value = value
      this.moveToHead(existingNode)
      return
    }

    // Evict if at capacity
    if (this.cache.size >= this._maxSize) {
      this.evictLRU()
    }

    // Create new node
    const node: ListNode<K, V> = {
      key,
      value,
      prev: null,
      next: null,
    }

    this.cache.set(key, node)
    this.addToHead(node)
  }

  /**
   * Deletes an entry from the cache.
   *
   * @param key - The cache key
   * @returns true if the entry was deleted, false if not found
   */
  delete(key: K): boolean {
    const node = this.cache.get(key)

    if (!node) {
      return false
    }

    this.removeNode(node)
    this.cache.delete(key)

    if (this._onEvict) {
      this._onEvict(key, node.value)
    }

    return true
  }

  /**
   * Checks if a key exists in the cache.
   * Does NOT update LRU order.
   *
   * @param key - The cache key
   * @returns true if the key exists
   */
  has(key: K): boolean {
    return this.cache.has(key)
  }

  /**
   * Gets a value without updating LRU order.
   * Useful for inspection without affecting eviction priority.
   *
   * @param key - The cache key
   * @returns The cached value or undefined if not found
   */
  peek(key: K): V | undefined {
    const node = this.cache.get(key)
    return node?.value
  }

  /**
   * Clears all entries from the cache.
   * Calls onEvict for each entry if configured.
   */
  clear(): void {
    if (this._onEvict) {
      for (const [key, node] of this.cache) {
        this._onEvict(key, node.value)
      }
    }

    this.cache.clear()
    this.head = null
    this.tail = null
  }

  /**
   * Gets all keys in LRU order (most recently used first).
   *
   * @returns Array of keys from MRU to LRU
   */
  keys(): K[] {
    const keys: K[] = []
    let node = this.head

    while (node) {
      keys.push(node.key)
      node = node.next
    }

    return keys
  }

  /**
   * Resizes the cache to a new maximum size.
   * Evicts LRU entries if current size exceeds new limit.
   *
   * @param newMaxSize - The new maximum size
   */
  resize(newMaxSize: number): void {
    this._maxSize = newMaxSize

    // Evict until we're at the new limit
    while (this.cache.size > newMaxSize) {
      this.evictLRU()
    }
  }

  /**
   * Gets cache statistics.
   *
   * @returns Current cache statistics
   */
  getStats(): CacheStats {
    const total = this._hits + this._misses
    const hitRate = total === 0 ? 0 : Math.round((this._hits / total) * 100)

    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      count: this.cache.size,
      hitRate,
    }
  }

  /**
   * Resets statistics without clearing cached data.
   */
  resetStats(): void {
    this._hits = 0
    this._misses = 0
    this._evictions = 0
  }

  // ============================================
  // Private Methods - Linked List Operations
  // ============================================

  /**
   * Moves a node to the head (most recently used).
   */
  private moveToHead(node: ListNode<K, V>): void {
    if (node === this.head) {
      return
    }

    this.removeNode(node)
    this.addToHead(node)
  }

  /**
   * Adds a node to the head of the list.
   */
  private addToHead(node: ListNode<K, V>): void {
    node.prev = null
    node.next = this.head

    if (this.head) {
      this.head.prev = node
    }

    this.head = node

    if (!this.tail) {
      this.tail = node
    }
  }

  /**
   * Removes a node from the linked list.
   */
  private removeNode(node: ListNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next
    } else {
      this.head = node.next
    }

    if (node.next) {
      node.next.prev = node.prev
    } else {
      this.tail = node.prev
    }

    node.prev = null
    node.next = null
  }

  /**
   * Evicts the least recently used entry.
   */
  private evictLRU(): void {
    if (!this.tail) {
      return
    }

    const lru = this.tail
    this.removeNode(lru)
    this.cache.delete(lru.key)
    this._evictions++

    if (this._onEvict) {
      this._onEvict(lru.key, lru.value)
    }
  }
}
