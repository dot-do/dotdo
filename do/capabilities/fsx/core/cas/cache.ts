/**
 * LRU Cache for Content-Addressable Storage
 *
 * Provides an efficient in-memory cache for frequently accessed git objects.
 * Uses a Least Recently Used (LRU) eviction policy to manage cache size.
 *
 * Features:
 * - Configurable maximum cache size (by entry count or total bytes)
 * - LRU eviction when cache is full
 * - Cache hit/miss statistics
 * - Thread-safe for single-threaded JS environments
 */

import type { GitObject } from './get-object.js'

/**
 * Cache entry containing the object and metadata
 */
interface CacheEntry {
  object: GitObject
  size: number
  lastAccessed: number
}

/**
 * Cache statistics for monitoring cache performance
 */
export interface CacheStats {
  /** Total number of cache hits */
  hits: number
  /** Total number of cache misses */
  misses: number
  /** Current number of entries in cache */
  entryCount: number
  /** Current total bytes stored in cache */
  totalBytes: number
  /** Maximum entries allowed in cache */
  maxEntries: number
  /** Maximum bytes allowed in cache */
  maxBytes: number
  /** Cache hit ratio (hits / total requests) */
  hitRatio: number
  /** Number of evictions performed */
  evictions: number
}

/**
 * Configuration options for the LRU cache
 */
export interface LRUCacheOptions {
  /**
   * Maximum number of entries to store in cache.
   * When exceeded, least recently used entries are evicted.
   * @default 1000
   */
  maxEntries?: number

  /**
   * Maximum total bytes to store in cache.
   * When exceeded, least recently used entries are evicted until under limit.
   * @default 50MB (50 * 1024 * 1024)
   */
  maxBytes?: number
}

/**
 * Default cache configuration
 */
const DEFAULT_MAX_ENTRIES = 1000
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024 // 50MB

/**
 * LRU Cache implementation for git objects
 *
 * Uses a Map for O(1) access and maintains access order for LRU eviction.
 * The Map's insertion order is leveraged for LRU - we delete and re-insert
 * on access to maintain LRU order.
 */
export class LRUCache {
  private cache: Map<string, CacheEntry> = new Map()
  private maxEntries: number
  private maxBytes: number
  private currentBytes: number = 0

  // Statistics
  private hits: number = 0
  private misses: number = 0
  private evictions: number = 0

  constructor(options: LRUCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  }

  /**
   * Get an object from the cache
   *
   * @param hash - The content hash to look up
   * @returns The cached object or undefined if not in cache
   */
  get(hash: string): GitObject | undefined {
    const normalizedHash = hash.toLowerCase()
    const entry = this.cache.get(normalizedHash)

    if (!entry) {
      this.misses++
      return undefined
    }

    // Update access time and move to end (most recently used)
    entry.lastAccessed = Date.now()
    this.cache.delete(normalizedHash)
    this.cache.set(normalizedHash, entry)

    this.hits++
    return entry.object
  }

  /**
   * Store an object in the cache
   *
   * @param hash - The content hash
   * @param object - The git object to cache
   */
  set(hash: string, object: GitObject): void {
    const normalizedHash = hash.toLowerCase()
    const size = object.content.length

    // Don't cache objects larger than maxBytes
    if (size > this.maxBytes) {
      return
    }

    // Check if already in cache
    const existing = this.cache.get(normalizedHash)
    if (existing) {
      // Update existing entry and move to end
      this.currentBytes -= existing.size
      this.cache.delete(normalizedHash)
    }

    // Evict entries until we have space
    this.evictIfNeeded(size)

    // Store the entry
    const entry: CacheEntry = {
      object,
      size,
      lastAccessed: Date.now(),
    }
    this.cache.set(normalizedHash, entry)
    this.currentBytes += size
  }

  /**
   * Check if a hash is in the cache (without affecting LRU order)
   */
  has(hash: string): boolean {
    return this.cache.has(hash.toLowerCase())
  }

  /**
   * Remove an entry from the cache
   */
  delete(hash: string): boolean {
    const normalizedHash = hash.toLowerCase()
    const entry = this.cache.get(normalizedHash)
    if (entry) {
      this.currentBytes -= entry.size
      this.cache.delete(normalizedHash)
      return true
    }
    return false
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear()
    this.currentBytes = 0
    // Note: We don't reset statistics on clear
  }

  /**
   * Get current cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses
    return {
      hits: this.hits,
      misses: this.misses,
      entryCount: this.cache.size,
      totalBytes: this.currentBytes,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
      hitRatio: total > 0 ? this.hits / total : 0,
      evictions: this.evictions,
    }
  }

  /**
   * Reset statistics counters
   */
  resetStats(): void {
    this.hits = 0
    this.misses = 0
    this.evictions = 0
  }

  /**
   * Get current entry count
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Get current bytes used
   */
  get bytes(): number {
    return this.currentBytes
  }

  /**
   * Evict least recently used entries until we have space
   */
  private evictIfNeeded(incomingSize: number): void {
    // Evict until we're under entry limit
    while (this.cache.size >= this.maxEntries) {
      this.evictOldest()
    }

    // Evict until we're under byte limit
    while (this.currentBytes + incomingSize > this.maxBytes && this.cache.size > 0) {
      this.evictOldest()
    }
  }

  /**
   * Evict the oldest (least recently used) entry
   */
  private evictOldest(): void {
    // Map iterates in insertion order, so first entry is oldest
    const firstKey = this.cache.keys().next().value
    if (firstKey !== undefined) {
      const entry = this.cache.get(firstKey)
      if (entry) {
        this.currentBytes -= entry.size
      }
      this.cache.delete(firstKey)
      this.evictions++
    }
  }
}

/**
 * Create a new LRU cache with the given options
 */
export function createLRUCache(options?: LRUCacheOptions): LRUCache {
  return new LRUCache(options)
}
