/**
 * Cache management utilities for @dotdo/tanstack
 *
 * Provides utilities for managing cached data, invalidation,
 * and synchronization between local cache and server state.
 *
 * @module @dotdo/tanstack
 */

import type { BaseItem } from './react/types'

// =============================================================================
// Cache Entry Types
// =============================================================================

/**
 * A single cache entry with metadata
 */
export interface CacheEntry<T> {
  /** The cached data */
  data: T
  /** When this entry was cached */
  cachedAt: number
  /** When this entry expires (0 = never) */
  expiresAt: number
  /** Last known transaction ID from server */
  txid: number
  /** Whether this entry has pending optimistic updates */
  hasPendingUpdates: boolean
}

/**
 * Cache configuration options
 */
export interface CacheConfig {
  /** Default TTL in milliseconds (default: 5 minutes) */
  defaultTTL?: number
  /** Maximum number of entries (default: 1000) */
  maxEntries?: number
  /** Stale-while-revalidate window in milliseconds (default: 30 seconds) */
  staleWhileRevalidate?: number
}

// =============================================================================
// DotdoCache - In-memory cache for DO data
// =============================================================================

/**
 * In-memory cache for Durable Object data.
 *
 * Features:
 * - TTL-based expiration
 * - LRU eviction when max entries exceeded
 * - Stale-while-revalidate support
 * - Transaction ID tracking for consistency
 *
 * @example
 * ```typescript
 * const cache = new DotdoCache({
 *   defaultTTL: 60000, // 1 minute
 *   maxEntries: 500,
 * })
 *
 * // Cache a collection
 * cache.set('Customer', customers, 12345)
 *
 * // Get from cache
 * const entry = cache.get('Customer')
 * if (entry && !cache.isStale('Customer')) {
 *   return entry.data
 * }
 *
 * // Invalidate on mutation
 * cache.invalidate('Customer')
 * ```
 */
export class DotdoCache<T extends BaseItem = BaseItem> {
  private entries: Map<string, CacheEntry<T[]>>
  private accessOrder: string[] // For LRU eviction
  private config: Required<CacheConfig>

  constructor(config: CacheConfig = {}) {
    this.entries = new Map()
    this.accessOrder = []
    this.config = {
      defaultTTL: config.defaultTTL ?? 5 * 60 * 1000, // 5 minutes
      maxEntries: config.maxEntries ?? 1000,
      staleWhileRevalidate: config.staleWhileRevalidate ?? 30 * 1000, // 30 seconds
    }
  }

  /**
   * Get a cache entry by collection key
   */
  get(key: string): CacheEntry<T[]> | undefined {
    const entry = this.entries.get(key)

    if (!entry) {
      return undefined
    }

    // Update access order for LRU
    this.updateAccessOrder(key)

    return entry
  }

  /**
   * Set a cache entry
   */
  set(
    key: string,
    data: T[],
    txid: number,
    options: { ttl?: number; hasPendingUpdates?: boolean } = {}
  ): void {
    const now = Date.now()
    const ttl = options.ttl ?? this.config.defaultTTL

    // Evict if at capacity
    while (this.entries.size >= this.config.maxEntries) {
      this.evictLRU()
    }

    const entry: CacheEntry<T[]> = {
      data,
      cachedAt: now,
      expiresAt: ttl > 0 ? now + ttl : 0,
      txid,
      hasPendingUpdates: options.hasPendingUpdates ?? false,
    }

    this.entries.set(key, entry)
    this.updateAccessOrder(key)
  }

  /**
   * Check if a cache entry is stale (expired but within SWR window)
   */
  isStale(key: string): boolean {
    const entry = this.entries.get(key)

    if (!entry) {
      return true
    }

    if (entry.expiresAt === 0) {
      return false // Never expires
    }

    const now = Date.now()
    return now > entry.expiresAt
  }

  /**
   * Check if a cache entry is expired (past SWR window)
   */
  isExpired(key: string): boolean {
    const entry = this.entries.get(key)

    if (!entry) {
      return true
    }

    if (entry.expiresAt === 0) {
      return false // Never expires
    }

    const now = Date.now()
    return now > entry.expiresAt + this.config.staleWhileRevalidate
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(key: string): void {
    this.entries.delete(key)
    this.accessOrder = this.accessOrder.filter((k) => k !== key)
  }

  /**
   * Invalidate all cache entries matching a prefix
   */
  invalidatePrefix(prefix: string): void {
    const keysToDelete: string[] = []

    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key)
      }
    }

    for (const key of keysToDelete) {
      this.invalidate(key)
    }
  }

  /**
   * Invalidate all cache entries
   */
  invalidateAll(): void {
    this.entries.clear()
    this.accessOrder = []
  }

  /**
   * Update a single item in a cached collection
   */
  updateItem(collectionKey: string, item: T): void {
    const entry = this.entries.get(collectionKey)

    if (!entry) {
      return
    }

    const updatedData = entry.data.map((existing) =>
      existing.$id === item.$id ? item : existing
    )

    this.set(collectionKey, updatedData, entry.txid, {
      hasPendingUpdates: entry.hasPendingUpdates,
    })
  }

  /**
   * Insert an item into a cached collection
   */
  insertItem(collectionKey: string, item: T): void {
    const entry = this.entries.get(collectionKey)

    if (!entry) {
      return
    }

    // Don't insert if already exists
    if (entry.data.find((existing) => existing.$id === item.$id)) {
      return
    }

    const updatedData = [...entry.data, item]

    this.set(collectionKey, updatedData, entry.txid, {
      hasPendingUpdates: entry.hasPendingUpdates,
    })
  }

  /**
   * Delete an item from a cached collection
   */
  deleteItem(collectionKey: string, itemId: string): void {
    const entry = this.entries.get(collectionKey)

    if (!entry) {
      return
    }

    const updatedData = entry.data.filter((existing) => existing.$id !== itemId)

    this.set(collectionKey, updatedData, entry.txid, {
      hasPendingUpdates: entry.hasPendingUpdates,
    })
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    let staleCount = 0
    let expiredCount = 0
    let pendingCount = 0

    for (const key of this.entries.keys()) {
      if (this.isExpired(key)) {
        expiredCount++
      } else if (this.isStale(key)) {
        staleCount++
      }

      const entry = this.entries.get(key)
      if (entry?.hasPendingUpdates) {
        pendingCount++
      }
    }

    return {
      totalEntries: this.entries.size,
      staleEntries: staleCount,
      expiredEntries: expiredCount,
      pendingUpdates: pendingCount,
      maxEntries: this.config.maxEntries,
    }
  }

  /**
   * Prune expired entries
   */
  prune(): number {
    let pruned = 0

    for (const key of [...this.entries.keys()]) {
      if (this.isExpired(key)) {
        this.invalidate(key)
        pruned++
      }
    }

    return pruned
  }

  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
    this.accessOrder.push(key)
  }

  private evictLRU(): void {
    const lruKey = this.accessOrder.shift()
    if (lruKey) {
      this.entries.delete(lruKey)
    }
  }
}

/**
 * Cache statistics
 */
export interface CacheStats {
  totalEntries: number
  staleEntries: number
  expiredEntries: number
  pendingUpdates: number
  maxEntries: number
}

// =============================================================================
// Cache Key Utilities
// =============================================================================

/**
 * Build a cache key for a collection
 */
export function buildCollectionKey(
  doUrl: string,
  collection: string,
  branch?: string
): string {
  const normalizedUrl = doUrl.replace(/\/$/, '')
  const branchSuffix = branch ? `:${branch}` : ''
  return `${normalizedUrl}:${collection}${branchSuffix}`
}

/**
 * Build a cache key for a single item
 */
export function buildItemKey(
  doUrl: string,
  collection: string,
  itemId: string,
  branch?: string
): string {
  return `${buildCollectionKey(doUrl, collection, branch)}:${itemId}`
}

/**
 * Parse a cache key back into components
 */
export function parseCacheKey(key: string): {
  doUrl: string
  collection: string
  branch?: string
  itemId?: string
} | null {
  // Pattern: doUrl:collection[:branch][:itemId]
  const parts = key.split(':')

  if (parts.length < 3) {
    return null
  }

  // Reconstruct URL (may contain port with :)
  let urlEndIndex = 2 // After protocol://
  if (parts[1].includes('//')) {
    // http://localhost:8787 -> parts = ['http', '//localhost', '8787', 'Collection']
    // We need to find where the URL ends
    for (let i = 2; i < parts.length; i++) {
      if (parts[i].match(/^\d+$/)) {
        urlEndIndex = i + 1 // Include port
      } else {
        break
      }
    }
  }

  const doUrl = parts.slice(0, urlEndIndex).join(':')
  const remaining = parts.slice(urlEndIndex)

  if (remaining.length === 0) {
    return null
  }

  const collection = remaining[0]
  const branch = remaining.length > 1 && !remaining[1].match(/^[a-z0-9-]+$/i) ? remaining[1] : undefined
  const itemId = remaining.length > 2 ? remaining[remaining.length - 1] : undefined

  return {
    doUrl,
    collection,
    branch,
    itemId,
  }
}

// =============================================================================
// Global Cache Instance
// =============================================================================

/**
 * Default global cache instance.
 *
 * For most applications, using a single shared cache is sufficient.
 * Create custom instances for isolation in tests or multi-tenant apps.
 */
export const defaultCache = new DotdoCache()
