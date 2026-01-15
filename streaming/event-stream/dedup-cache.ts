/**
 * LRUDedupCache - LRU eviction-based deduplication cache for EventStreamDO
 *
 * Implements LRU (Least Recently Used) eviction combined with TTL-based expiration
 * to prevent unbounded memory growth in long-running EventStreamDO instances.
 *
 * Problem: Simple Map-based deduplication with only TTL cleanup can grow unbounded
 * if many unique events arrive within the dedup window.
 *
 * Solution: Use LRU eviction with configurable max size, plus TTL expiration.
 *
 * @issue do-3wmj - GREEN: Add LRU eviction to deduplication cache
 * @wave Wave 2: Code Consolidation
 */

/**
 * Configuration options for the deduplication cache
 */
export interface DedupCacheConfig {
  /** Maximum number of entries in the cache (default: 10000) */
  maxSize: number
  /** Time-to-live in milliseconds (default: 60000 = 60 seconds) */
  ttlMs: number
  /** Optional callback when an entry is evicted */
  onEvict?: (topic: string, eventId: string) => void
}

/**
 * Statistics about cache usage
 */
export interface DedupCacheStats {
  /** Number of duplicate events detected */
  duplicateCount: number
  /** Number of unique events added */
  uniqueCount: number
  /** Number of entries evicted due to LRU or TTL */
  evictionCount: number
  /** Current number of entries in the cache */
  currentSize: number
  /** Number of distinct topics in the cache */
  topicCount: number
}

/**
 * Internal entry structure for tracking events
 */
interface CacheEntry {
  topic: string
  eventId: string
  timestamp: number
}

/**
 * LRUDedupCache - Deduplication cache with LRU eviction and TTL expiration
 *
 * Uses a Map for O(1) lookups with insertion order preservation for LRU.
 * JavaScript Maps maintain insertion order, so we can use delete + set
 * to move entries to the end (most recently used).
 */
export class LRUDedupCache {
  private cache: Map<string, CacheEntry> = new Map()
  private config: DedupCacheConfig
  private stats: DedupCacheStats = {
    duplicateCount: 0,
    uniqueCount: 0,
    evictionCount: 0,
    currentSize: 0,
    topicCount: 0,
  }
  private topics: Set<string> = new Set()

  /**
   * Create a new LRUDedupCache
   * @param config - Optional configuration options
   */
  constructor(config?: Partial<DedupCacheConfig>) {
    this.config = {
      maxSize: config?.maxSize ?? 10000,
      ttlMs: config?.ttlMs ?? 60000,
      onEvict: config?.onEvict,
    }
  }

  /**
   * Check if an event is a duplicate
   *
   * This method both checks for duplicates AND tracks new events.
   * - Returns false and adds to cache if event is new
   * - Returns true if event is already in cache (duplicate)
   * - Updates LRU order on every access
   * - Refreshes TTL on every access
   *
   * @param topic - The topic/channel name
   * @param eventId - The event identifier
   * @returns true if this is a duplicate event, false if new
   */
  isDuplicate(topic: string, eventId: string): boolean {
    const key = this.makeKey(topic, eventId)
    const now = Date.now()

    // Check if entry exists
    const existing = this.cache.get(key)

    if (existing) {
      // Check if expired
      if (now - existing.timestamp > this.config.ttlMs) {
        // Entry expired - remove it and treat as new
        this.evictEntry(key, existing)
        return this.addEntry(topic, eventId, key, now)
      }

      // Entry exists and is valid - it's a duplicate
      // Update LRU order by deleting and re-adding
      this.cache.delete(key)
      existing.timestamp = now // Refresh TTL
      this.cache.set(key, existing)
      this.stats.duplicateCount++
      return true
    }

    // New entry
    return this.addEntry(topic, eventId, key, now)
  }

  /**
   * Check if an entry exists without adding it
   *
   * Unlike isDuplicate, this method only checks - it doesn't add new entries
   * or update LRU order. Useful for testing and inspection.
   *
   * @param topic - The topic/channel name
   * @param eventId - The event identifier
   * @returns true if entry exists and is not expired, false otherwise
   */
  has(topic: string, eventId: string): boolean {
    const key = this.makeKey(topic, eventId)
    const entry = this.cache.get(key)

    if (!entry) {
      return false
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.config.ttlMs) {
      return false
    }

    return true
  }

  /**
   * Get the current number of entries in the cache
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    if (this.config.onEvict) {
      // Call onEvict for each entry
      for (const entry of this.cache.values()) {
        this.config.onEvict(entry.topic, entry.eventId)
      }
    }
    this.stats.evictionCount += this.cache.size
    this.cache.clear()
    this.topics.clear()
    this.stats.currentSize = 0
    this.stats.topicCount = 0
  }

  /**
   * Resize the cache to a new maximum size
   * Evicts oldest entries if current size exceeds new max
   *
   * @param newMaxSize - New maximum cache size
   */
  resize(newMaxSize: number): void {
    this.config.maxSize = newMaxSize

    // Evict oldest entries until we're within bounds
    while (this.cache.size > newMaxSize) {
      this.evictOldest()
    }
    this.stats.currentSize = this.cache.size
  }

  /**
   * Manually prune expired entries
   * Called automatically during normal operations, but can be triggered manually
   */
  prune(): void {
    const now = Date.now()
    const expired: string[] = []

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.config.ttlMs) {
        expired.push(key)
      }
    }

    for (const key of expired) {
      const entry = this.cache.get(key)
      if (entry) {
        this.evictEntry(key, entry)
      }
    }
    this.updateTopicCount()
  }

  /**
   * Get cache statistics
   */
  getStats(): DedupCacheStats {
    return {
      ...this.stats,
      currentSize: this.cache.size,
      topicCount: this.topics.size,
    }
  }

  /**
   * Reset statistics counters without clearing data
   */
  resetStats(): void {
    this.stats.duplicateCount = 0
    this.stats.uniqueCount = 0
    this.stats.evictionCount = 0
    // currentSize and topicCount are computed from actual data
  }

  /**
   * Get all entries for a specific topic
   * Useful for topic-specific cleanup or debugging
   *
   * @param topic - The topic to get entries for
   * @returns Array of event IDs for the topic
   */
  getEntriesByTopic(topic: string): string[] {
    const entries: string[] = []
    for (const entry of this.cache.values()) {
      if (entry.topic === topic) {
        entries.push(entry.eventId)
      }
    }
    return entries
  }

  /**
   * Clear all entries for a specific topic
   *
   * @param topic - The topic to clear
   */
  clearTopic(topic: string): void {
    const keysToDelete: string[] = []

    for (const [key, entry] of this.cache) {
      if (entry.topic === topic) {
        keysToDelete.push(key)
      }
    }

    for (const key of keysToDelete) {
      const entry = this.cache.get(key)
      if (entry) {
        this.evictEntry(key, entry)
      }
    }

    this.topics.delete(topic)
    this.updateTopicCount()
  }

  /**
   * Create a cache key from topic and eventId
   */
  private makeKey(topic: string, eventId: string): string {
    return `${topic}:${eventId}`
  }

  /**
   * Add a new entry to the cache
   * Handles LRU eviction if needed
   *
   * @returns false (indicating not a duplicate)
   */
  private addEntry(topic: string, eventId: string, key: string, timestamp: number): boolean {
    // Evict oldest if at capacity
    if (this.cache.size >= this.config.maxSize) {
      this.evictOldest()
    }

    // Add new entry
    this.cache.set(key, { topic, eventId, timestamp })
    this.topics.add(topic)
    this.stats.uniqueCount++
    this.stats.currentSize = this.cache.size

    return false
  }

  /**
   * Evict the oldest (least recently used) entry
   */
  private evictOldest(): void {
    // Map maintains insertion order, so first entry is oldest
    const firstKey = this.cache.keys().next().value
    if (firstKey !== undefined) {
      const entry = this.cache.get(firstKey)
      if (entry) {
        this.evictEntry(firstKey, entry)
      }
    }
  }

  /**
   * Evict a specific entry
   */
  private evictEntry(key: string, entry: CacheEntry): void {
    if (this.config.onEvict) {
      this.config.onEvict(entry.topic, entry.eventId)
    }
    this.cache.delete(key)
    this.stats.evictionCount++
    this.stats.currentSize = this.cache.size
  }

  /**
   * Update the topic count based on remaining entries
   */
  private updateTopicCount(): void {
    this.topics.clear()
    for (const entry of this.cache.values()) {
      this.topics.add(entry.topic)
    }
    this.stats.topicCount = this.topics.size
  }
}
