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
// DOUBLY-LINKED LIST NODE FOR O(1) LRU
// ============================================================================

/**
 * Node in the doubly-linked list for O(1) LRU operations
 */
interface DoublyLinkedListNode<K, V> {
  key: K
  entry: CacheEntry<V>
  prev: DoublyLinkedListNode<K, V> | null
  next: DoublyLinkedListNode<K, V> | null
}

// ============================================================================
// BOUNDED LRU CACHE CLASS
// ============================================================================

/**
 * Bounded LRU Cache with memory tracking
 *
 * Features:
 * - O(1) get and set operations (using doubly-linked list + Map)
 * - LRU eviction when maxSize exceeded
 * - Memory-based eviction when memoryLimit exceeded
 * - Hit/miss/eviction metrics
 * - Memory tracking per entry
 *
 * Implementation:
 * - Map<K, Node> provides O(1) lookup
 * - Doubly-linked list provides O(1) removal and insertion
 * - Head = Most Recently Used (MRU)
 * - Tail = Least Recently Used (LRU)
 */
export class BoundedLRUCache<K extends string, V> {
  /** Map for O(1) lookup of nodes by key */
  private nodeMap = new Map<K, DoublyLinkedListNode<K, V>>()

  /** Head of the doubly-linked list (Most Recently Used) */
  private head: DoublyLinkedListNode<K, V> | null = null

  /** Tail of the doubly-linked list (Least Recently Used) */
  private tail: DoublyLinkedListNode<K, V> | null = null

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
    return this.nodeMap.size
  }

  get memoryBytes(): number {
    return this._memoryBytes
  }

  get memoryLimitBytes(): number | undefined {
    return this._memoryLimitBytes
  }

  /**
   * Get a value from the cache - O(1)
   * Updates access order on hit (use for final result access)
   */
  get(key: K): V | undefined {
    const node = this.nodeMap.get(key)
    if (node) {
      this.metrics.hits++
      this.moveToHead(node)
      return node.entry.value
    }
    this.metrics.misses++
    return undefined
  }

  /**
   * Peek at a value without updating access order - O(1)
   * Still tracks hit/miss metrics
   */
  peek(key: K): V | undefined {
    const node = this.nodeMap.get(key)
    if (node) {
      this.metrics.hits++
      return node.entry.value
    }
    this.metrics.misses++
    return undefined
  }

  /**
   * Check if key exists without affecting metrics or access order - O(1)
   */
  has(key: K): boolean {
    return this.nodeMap.has(key)
  }

  /**
   * Set a value in the cache - O(1)
   * Evicts LRU entries if maxSize or memoryLimit exceeded
   */
  set(key: K, value: V): void {
    const sizeBytes = this.sizeCalculator(value)
    const existingNode = this.nodeMap.get(key)

    // If key exists, update it
    if (existingNode) {
      this._memoryBytes -= existingNode.entry.sizeBytes
      this._memoryBytes += sizeBytes
      existingNode.entry = { value, sizeBytes }
      this.moveToHead(existingNode)
      this.evictIfNeeded()
      return
    }

    // Create new node and add to head
    const newNode: DoublyLinkedListNode<K, V> = {
      key,
      entry: { value, sizeBytes },
      prev: null,
      next: null,
    }

    this.nodeMap.set(key, newNode)
    this.addToHead(newNode)
    this._memoryBytes += sizeBytes

    // Evict if needed
    this.evictIfNeeded()
  }

  /**
   * Delete a key from the cache - O(1)
   */
  delete(key: K): boolean {
    const node = this.nodeMap.get(key)
    if (node) {
      this._memoryBytes -= node.entry.sizeBytes
      this.nodeMap.delete(key)
      this.removeNode(node)
      return true
    }
    return false
  }

  /**
   * Clear all entries - O(1)
   */
  clear(): void {
    this.nodeMap.clear()
    this.head = null
    this.tail = null
    this._memoryBytes = 0
  }

  /**
   * Get all keys in the cache - O(n) but only used for stats
   */
  keys(): K[] {
    return Array.from(this.nodeMap.keys())
  }

  /**
   * Get cache statistics
   */
  getStats(): SingleCacheStats {
    const total = this.metrics.hits + this.metrics.misses
    return {
      size: this.nodeMap.size,
      maxSize: this._maxSize,
      memoryBytes: this._memoryBytes,
      avgEntryBytes: this.nodeMap.size > 0 ? this._memoryBytes / this.nodeMap.size : 0,
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
   * Add a node to the head of the list (MRU position) - O(1)
   */
  private addToHead(node: DoublyLinkedListNode<K, V>): void {
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
   * Remove a node from the list - O(1)
   */
  private removeNode(node: DoublyLinkedListNode<K, V>): void {
    const prev = node.prev
    const next = node.next

    if (prev) {
      prev.next = next
    } else {
      // Node was the head
      this.head = next
    }

    if (next) {
      next.prev = prev
    } else {
      // Node was the tail
      this.tail = prev
    }

    // Clear references
    node.prev = null
    node.next = null
  }

  /**
   * Move an existing node to the head (MRU position) - O(1)
   */
  private moveToHead(node: DoublyLinkedListNode<K, V>): void {
    // Already at head
    if (node === this.head) {
      return
    }

    // Remove from current position
    this.removeNode(node)

    // Add to head
    this.addToHead(node)
  }

  /**
   * Evict entries if size or memory limits exceeded - O(1) per eviction
   */
  private evictIfNeeded(): void {
    // Check size limit
    while (this.nodeMap.size > this._maxSize && this.tail) {
      this.evictLRU()
    }

    // Check memory limit
    if (this._memoryLimitBytes !== undefined) {
      const threshold = this._memoryLimitBytes * this._evictionThreshold
      while (this._memoryBytes > threshold && this.tail) {
        this.evictLRU()
      }
    }
  }

  /**
   * Evict the least recently used entry (tail) - O(1)
   */
  private evictLRU(): void {
    if (!this.tail) return

    const lruNode = this.tail
    this._memoryBytes -= lruNode.entry.sizeBytes
    this.nodeMap.delete(lruNode.key)
    this.removeNode(lruNode)
    this.metrics.evictions++
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
