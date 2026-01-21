/**
 * Tiered Storage for @dotdo/db
 *
 * Provides a cost-optimized, tiered storage system that uses:
 * - Hot Tier (Cache): Cloudflare Cache API - FREE, fastest, ephemeral, global edge
 * - Warm Tier (DO): Durable Object SQLite - fast, persistent, limited capacity
 * - Cold Tier (R2): R2 Object Storage - durable, unlimited, slower, cheapest
 *
 * Key benefit: Cache API is FREE on Cloudflare, significantly reducing costs
 * while maintaining low latency for frequently accessed data.
 *
 * Based on the tiered VFS pattern from postgres.do
 *
 * @module tiered-storage
 */

import type { StorageAdapter, ListOptions, ListResult } from './storage'

/**
 * Storage tier identifiers
 * - hot: Cloudflare Cache API (FREE, fastest, ephemeral)
 * - warm: Durable Object Storage (fast, persistent, limited)
 * - cold: R2 (durable, unlimited, slower)
 */
export type StorageTier = 'hot' | 'warm' | 'cold'

/**
 * Result of locating a key across tiers
 */
export interface KeyLocation {
  /** The tier where the key was found */
  tier?: StorageTier
  /** Whether the key was found */
  found: boolean
  /** The key */
  key: string
}

/**
 * Options for read operations
 */
export interface TieredReadOptions {
  /** Whether to skip promotion after read */
  skipPromotion?: boolean
  /** Whether to track access for promotion/demotion decisions */
  trackAccess?: boolean
}

/**
 * Options for write operations
 */
export interface TieredWriteOptions {
  /** Target tier for the write */
  tier?: StorageTier
  /** Whether to also write to colder tiers for durability */
  writeThrough?: boolean
}

/**
 * Metadata attached to cached entries
 */
export interface CacheEntryMetadata {
  /** Timestamp when last accessed */
  lastAccessed?: number
  /** Number of times accessed */
  accessCount?: number
  /** Size in bytes */
  size?: number
}

/**
 * Configuration for the Cache Layer
 */
export interface CacheLayerConfig {
  /** Name of the cache to use */
  cacheName: string
  /** TTL for cached entries in seconds */
  ttlSeconds: number
  /** Base URL for cache key construction */
  baseUrl: string
}

/**
 * Cache layer statistics
 */
export interface CacheLayerStats {
  /** Number of cache hits */
  hits: number
  /** Number of cache misses */
  misses: number
  /** Number of writes */
  writes: number
  /** Number of deletes */
  deletes: number
  /** Total bytes read from cache */
  bytesRead: number
  /** Total bytes written to cache */
  bytesWritten: number
  /** Number of errors encountered */
  errors: number
  /** Hit ratio (0-1) */
  hitRatio: number
}

/**
 * CacheLayer wraps the Cloudflare Workers Cache API for storage.
 *
 * The Cache API is FREE on Cloudflare Workers, making it ideal for caching
 * frequently accessed data at the edge.
 */
export class CacheLayer {
  private cache: Cache
  private config: CacheLayerConfig
  private stats: {
    hits: number
    misses: number
    writes: number
    deletes: number
    bytesRead: number
    bytesWritten: number
    errors: number
  }

  constructor(cache: Cache, config: CacheLayerConfig) {
    this.cache = cache
    this.config = config
    this.stats = {
      hits: 0,
      misses: 0,
      writes: 0,
      deletes: 0,
      bytesRead: 0,
      bytesWritten: 0,
      errors: 0,
    }
  }

  /**
   * Construct a cache key URL from a key string
   */
  private buildCacheUrl(key: string): string {
    return `${this.config.baseUrl}/${encodeURIComponent(key)}`
  }

  /**
   * Get data from the cache
   */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    try {
      const request = new Request(this.buildCacheUrl(key))
      const response = await this.cache.match(request)

      if (!response) {
        this.stats.misses++
        return undefined
      }

      this.stats.hits++
      const text = await response.text()
      this.stats.bytesRead += text.length
      return JSON.parse(text) as T
    } catch {
      this.stats.errors++
      return undefined
    }
  }

  /**
   * Store data in the cache
   */
  async put<T = unknown>(key: string, value: T, metadata?: CacheEntryMetadata): Promise<void> {
    try {
      const request = new Request(this.buildCacheUrl(key))
      const serialized = JSON.stringify(value)
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${this.config.ttlSeconds}`,
      }

      if (metadata?.lastAccessed !== undefined) {
        headers['X-Last-Accessed'] = metadata.lastAccessed.toString()
      }
      if (metadata?.accessCount !== undefined) {
        headers['X-Access-Count'] = metadata.accessCount.toString()
      }
      if (metadata?.size !== undefined) {
        headers['X-Size'] = metadata.size.toString()
      }

      const response = new Response(serialized, { headers })

      await this.cache.put(request, response)
      this.stats.writes++
      this.stats.bytesWritten += serialized.length
    } catch {
      this.stats.errors++
    }
  }

  /**
   * Delete an entry from the cache
   */
  async delete(key: string): Promise<boolean> {
    try {
      const request = new Request(this.buildCacheUrl(key))
      const result = await this.cache.delete(request)
      if (result) {
        this.stats.deletes++
      }
      return result
    } catch {
      this.stats.errors++
      return false
    }
  }

  /**
   * Check if an entry exists in the cache
   */
  async has(key: string): Promise<boolean> {
    try {
      const request = new Request(this.buildCacheUrl(key))
      const response = await this.cache.match(request)
      return response !== undefined
    } catch {
      return false
    }
  }

  /**
   * Get statistics for this cache layer
   */
  getStats(): CacheLayerStats {
    const totalRequests = this.stats.hits + this.stats.misses
    return {
      ...this.stats,
      hitRatio: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
    }
  }

  /**
   * Reset statistics counters
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      writes: 0,
      deletes: 0,
      bytesRead: 0,
      bytesWritten: 0,
      errors: 0,
    }
  }
}

/**
 * Create a new CacheLayer instance
 */
export async function createCacheLayer(config: CacheLayerConfig): Promise<CacheLayer> {
  const cache = await caches.open(config.cacheName)
  return new CacheLayer(cache, config)
}

/**
 * Configuration for R2StorageLayer
 */
export interface R2StorageLayerConfig {
  /** The R2 bucket binding */
  bucket: R2Bucket
  /** Prefix for all keys in the bucket */
  prefix: string
}

/**
 * R2 layer statistics
 */
export interface R2LayerStats {
  /** Number of reads */
  reads: number
  /** Number of writes */
  writes: number
  /** Number of deletes */
  deletes: number
  /** Total bytes read */
  bytesRead: number
  /** Total bytes written */
  bytesWritten: number
  /** Number of errors */
  errors: number
}

/**
 * R2StorageLayer wraps Cloudflare R2 for cold storage.
 */
export class R2StorageLayer {
  private bucket: R2Bucket
  private prefix: string
  private stats: {
    reads: number
    writes: number
    deletes: number
    bytesRead: number
    bytesWritten: number
    errors: number
  }

  constructor(config: R2StorageLayerConfig) {
    this.bucket = config.bucket
    this.prefix = config.prefix
    this.stats = {
      reads: 0,
      writes: 0,
      deletes: 0,
      bytesRead: 0,
      bytesWritten: 0,
      errors: 0,
    }
  }

  /**
   * Build full key with prefix
   */
  private buildKey(key: string): string {
    return `${this.prefix}${key}`
  }

  /**
   * Strip prefix from key
   */
  private stripPrefix(key: string): string {
    return key.startsWith(this.prefix) ? key.slice(this.prefix.length) : key
  }

  /**
   * Get data from R2
   */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    try {
      const object = await this.bucket.get(this.buildKey(key))

      if (!object) {
        return undefined
      }

      this.stats.reads++
      const text = await object.text()
      this.stats.bytesRead += text.length
      return JSON.parse(text) as T
    } catch {
      this.stats.errors++
      return undefined
    }
  }

  /**
   * Store data in R2
   */
  async put<T = unknown>(key: string, value: T): Promise<void> {
    try {
      const serialized = JSON.stringify(value)
      await this.bucket.put(this.buildKey(key), serialized, {
        httpMetadata: { contentType: 'application/json' },
      })
      this.stats.writes++
      this.stats.bytesWritten += serialized.length
    } catch {
      this.stats.errors++
      throw new Error(`Failed to write to R2: ${key}`)
    }
  }

  /**
   * Delete a key from R2
   */
  async delete(key: string): Promise<void> {
    try {
      await this.bucket.delete(this.buildKey(key))
      this.stats.deletes++
    } catch {
      this.stats.errors++
    }
  }

  /**
   * Check if a key exists in R2
   */
  async has(key: string): Promise<boolean> {
    try {
      const object = await this.bucket.head(this.buildKey(key))
      return object !== null
    } catch {
      return false
    }
  }

  /**
   * List keys with the configured prefix
   */
  async list(options?: { limit?: number; cursor?: string }): Promise<{
    keys: string[]
    truncated: boolean
    cursor?: string
  }> {
    try {
      const listOptions: R2ListOptions = {
        prefix: this.prefix,
      }
      if (options?.limit !== undefined) {
        listOptions.limit = options.limit
      }
      if (options?.cursor !== undefined) {
        listOptions.cursor = options.cursor
      }
      const result = await this.bucket.list(listOptions)

      const response: { keys: string[]; truncated: boolean; cursor?: string } = {
        keys: result.objects.map((obj) => this.stripPrefix(obj.key)),
        truncated: result.truncated,
      }
      if (result.truncated && result.cursor) {
        response.cursor = result.cursor
      }
      return response
    } catch {
      this.stats.errors++
      return { keys: [], truncated: false }
    }
  }

  /**
   * Get statistics for this R2 layer
   */
  getStats(): R2LayerStats {
    return { ...this.stats }
  }

  /**
   * Reset statistics counters
   */
  resetStats(): void {
    this.stats = {
      reads: 0,
      writes: 0,
      deletes: 0,
      bytesRead: 0,
      bytesWritten: 0,
      errors: 0,
    }
  }
}

/**
 * Create a new R2StorageLayer instance
 */
export function createR2StorageLayer(config: R2StorageLayerConfig): R2StorageLayer {
  return new R2StorageLayer(config)
}

/**
 * Promotion event data
 */
export interface PromotionEvent {
  key: string
  fromTier: StorageTier
  toTier: StorageTier
  timestamp: number
  success: boolean
  error?: string
}

/**
 * Demotion event data
 */
export interface DemotionEvent {
  key: string
  fromTier: StorageTier
  toTier: StorageTier
  timestamp: number
  success: boolean
  reason: 'ttl_expired' | 'lru_eviction' | 'manual'
  error?: string
}

/**
 * Callback for tier events
 */
export type TierEventCallback<T extends PromotionEvent | DemotionEvent> = (event: T) => void

/**
 * Combined statistics from all tiers
 */
export interface TieredStorageStats {
  /** Cache layer statistics */
  cache: CacheLayerStats
  /** R2 layer statistics */
  r2: R2LayerStats
  /** DO storage statistics */
  do: {
    reads: number
    writes: number
    deletes: number
    bytesRead: number
    bytesWritten: number
  }
  /** Promotion statistics */
  promotions: {
    coldToWarm: number
    warmToHot: number
  }
  /** Demotion statistics */
  demotions: {
    hotToWarm: number
    warmToCold: number
  }
}

/**
 * Configuration for TieredStorageAdapter
 */
export interface TieredStorageConfig {
  /** Cache layer for hot tier */
  cacheLayer: CacheLayer
  /** Durable Object storage adapter for warm tier */
  doStorage: StorageAdapter
  /** R2 layer for cold tier */
  r2Layer: R2StorageLayer
  /** Number of accesses before promoting to hotter tier */
  promotionThreshold?: number
  /** Whether to auto-promote on read from cold tiers */
  autoPromote?: boolean
  /** TTL for hot tier in milliseconds (default: 5 minutes) */
  hotTTLMs?: number
  /** TTL for warm tier in milliseconds (default: 1 hour) */
  warmTTLMs?: number
}

/**
 * TieredStorageAdapter combines Cache, DO Storage, and R2 into a unified storage layer.
 *
 * Read path: Cache (hot) -> DO (warm) -> R2 (cold)
 * Write path: Configurable target tier, default to DO (warm)
 *
 * Implements the StorageAdapter interface for seamless integration with @dotdo/db
 *
 * @example
 * ```typescript
 * const tieredStorage = new TieredStorageAdapter({
 *   cacheLayer: await createCacheLayer({
 *     cacheName: 'dotdo-data',
 *     ttlSeconds: 300,
 *     baseUrl: 'https://cache.dotdo.dev',
 *   }),
 *   doStorage: sqliteAdapter,
 *   r2Layer: createR2StorageLayer({
 *     bucket: env.R2_BUCKET,
 *     prefix: 'dotdo/',
 *   }),
 *   promotionThreshold: 3,
 *   autoPromote: true,
 * })
 *
 * // Read - automatically checks all tiers
 * const thing = await tieredStorage.get('thing:123')
 *
 * // Write - defaults to warm tier (DO)
 * await tieredStorage.put('thing:456', data)
 * ```
 */
export class TieredStorageAdapter implements StorageAdapter {
  private cacheLayer: CacheLayer
  private doStorage: StorageAdapter
  private r2Layer: R2StorageLayer
  private promotionThreshold: number
  private autoPromote: boolean
  private hotTTLMs: number
  private warmTTLMs: number
  private doStats: {
    reads: number
    writes: number
    deletes: number
    bytesRead: number
    bytesWritten: number
  }
  private promotionStats: {
    coldToWarm: number
    warmToHot: number
  }
  private demotionStats: {
    hotToWarm: number
    warmToCold: number
  }
  private accessCounts: Map<string, number>
  private lastAccessTimes: Map<string, number>
  private onPromotionCallback?: TierEventCallback<PromotionEvent>
  private onDemotionCallback?: TierEventCallback<DemotionEvent>

  constructor(config: TieredStorageConfig) {
    this.cacheLayer = config.cacheLayer
    this.doStorage = config.doStorage
    this.r2Layer = config.r2Layer
    this.promotionThreshold = config.promotionThreshold ?? 3
    this.autoPromote = config.autoPromote ?? false
    this.hotTTLMs = config.hotTTLMs ?? 5 * 60 * 1000 // 5 minutes
    this.warmTTLMs = config.warmTTLMs ?? 60 * 60 * 1000 // 1 hour
    this.doStats = {
      reads: 0,
      writes: 0,
      deletes: 0,
      bytesRead: 0,
      bytesWritten: 0,
    }
    this.promotionStats = {
      coldToWarm: 0,
      warmToHot: 0,
    }
    this.demotionStats = {
      hotToWarm: 0,
      warmToCold: 0,
    }
    this.accessCounts = new Map()
    this.lastAccessTimes = new Map()
  }

  /**
   * Set callback for promotion events
   */
  onPromotion(callback: TierEventCallback<PromotionEvent>): void {
    this.onPromotionCallback = callback
  }

  /**
   * Set callback for demotion events
   */
  onDemotion(callback: TierEventCallback<DemotionEvent>): void {
    this.onDemotionCallback = callback
  }

  /**
   * Increment access count and check if promotion is needed
   */
  private trackAccess(key: string): number {
    const count = (this.accessCounts.get(key) ?? 0) + 1
    this.accessCounts.set(key, count)
    this.lastAccessTimes.set(key, Date.now())
    return count
  }

  /**
   * Reset access count for a key
   */
  private resetAccessCount(key: string): void {
    this.accessCounts.delete(key)
  }

  /**
   * Get a value from the tiered storage
   *
   * Checks tiers in order: hot (Cache) -> warm (DO) -> cold (R2)
   * Optionally promotes values to hotter tiers based on access patterns.
   */
  async get<T = unknown>(key: string, options?: TieredReadOptions): Promise<T | undefined> {
    const trackAccess = options?.trackAccess ?? true
    const skipPromotion = options?.skipPromotion ?? false

    // Try hot tier (Cache) first
    const cached = await this.cacheLayer.get<T>(key)
    if (cached !== undefined) {
      if (trackAccess) {
        this.trackAccess(key)
      }
      return cached
    }

    // Try warm tier (DO Storage)
    const doData = await this.doStorage.get<T>(key)
    if (doData !== undefined) {
      this.doStats.reads++
      this.doStats.bytesRead += JSON.stringify(doData).length

      if (trackAccess) {
        const accessCount = this.trackAccess(key)

        // Check for promotion to hot tier
        if (!skipPromotion && this.autoPromote && accessCount >= this.promotionThreshold) {
          await this.promoteToHot(key, doData)
        }
      }

      return doData
    }

    // Try cold tier (R2)
    const r2Data = await this.r2Layer.get<T>(key)
    if (r2Data !== undefined) {
      if (trackAccess) {
        const accessCount = this.trackAccess(key)

        // Check for promotion to warm tier
        if (!skipPromotion && this.autoPromote && accessCount >= this.promotionThreshold) {
          await this.promoteToWarm(key, r2Data)
        }
      }

      return r2Data
    }

    return undefined
  }

  /**
   * Get multiple values by keys
   */
  async getMany<T = unknown>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>()
    const missingKeys: string[] = []

    // Try cache first for all keys
    for (const key of keys) {
      const cached = await this.cacheLayer.get<T>(key)
      if (cached !== undefined) {
        result.set(key, cached)
        this.trackAccess(key)
      } else {
        missingKeys.push(key)
      }
    }

    if (missingKeys.length === 0) {
      return result
    }

    // Try DO for remaining keys
    const doResults = await this.doStorage.getMany<T>(missingKeys)
    const stillMissing: string[] = []

    for (const key of missingKeys) {
      const value = doResults.get(key)
      if (value !== undefined) {
        result.set(key, value)
        this.doStats.reads++
        this.trackAccess(key)
      } else {
        stillMissing.push(key)
      }
    }

    // Try R2 for any remaining keys
    for (const key of stillMissing) {
      const r2Data = await this.r2Layer.get<T>(key)
      if (r2Data !== undefined) {
        result.set(key, r2Data)
        this.trackAccess(key)
      }
    }

    return result
  }

  /**
   * Store a value at a key
   *
   * By default writes to warm tier (DO Storage).
   * Can optionally write to hot (Cache) or cold (R2) tiers.
   */
  async put<T = unknown>(key: string, value: T, options?: TieredWriteOptions): Promise<void> {
    const tier = options?.tier ?? 'warm'

    switch (tier) {
      case 'hot':
        // Write to both DO (for persistence) and Cache (for speed)
        await this.doStorage.put(key, value)
        this.doStats.writes++
        this.doStats.bytesWritten += JSON.stringify(value).length
        await this.cacheLayer.put(key, value, {
          lastAccessed: Date.now(),
          accessCount: 1,
        })

        // Optionally write through to cold tier for durability
        if (options?.writeThrough) {
          await this.r2Layer.put(key, value)
        }
        break

      case 'warm':
        // Write to DO only
        await this.doStorage.put(key, value)
        this.doStats.writes++
        this.doStats.bytesWritten += JSON.stringify(value).length

        // Optionally write through to cold tier for durability
        if (options?.writeThrough) {
          await this.r2Layer.put(key, value)
        }
        break

      case 'cold':
        // Write to R2 only (for archival)
        await this.r2Layer.put(key, value)
        break
    }
  }

  /**
   * Store multiple key-value pairs
   */
  async putMany<T = unknown>(entries: Map<string, T>): Promise<void> {
    // Write to DO (warm tier)
    await this.doStorage.putMany(entries)
    this.doStats.writes += entries.size
    for (const [, value] of entries) {
      this.doStats.bytesWritten += JSON.stringify(value).length
    }
  }

  /**
   * Delete a key from all tiers
   */
  async delete(key: string): Promise<void> {
    // Delete from all tiers in parallel
    await Promise.all([
      this.cacheLayer.delete(key),
      this.doStorage.delete(key).then(() => {
        this.doStats.deletes++
      }),
      this.r2Layer.delete(key),
    ])

    // Clear access tracking
    this.resetAccessCount(key)
    this.lastAccessTimes.delete(key)
  }

  /**
   * Delete multiple keys from all tiers
   */
  async deleteMany(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.delete(key)))
  }

  /**
   * List keys with optional filtering and pagination
   *
   * Lists from warm tier (DO) as the source of truth
   */
  async list<T = unknown>(options?: ListOptions): Promise<ListResult<T>> {
    return this.doStorage.list<T>(options)
  }

  /**
   * Execute a function within a transaction
   */
  async transaction<T>(fn: () => Promise<T>, options?: import('./storage').TransactionOptions): Promise<T> {
    return this.doStorage.transaction(fn, options)
  }

  /**
   * Check if currently inside a transaction
   */
  inTransaction(): boolean {
    return this.doStorage.inTransaction?.() ?? false
  }

  /**
   * Check if the adapter supports nested transactions
   */
  supportsNestedTransactions(): boolean {
    return this.doStorage.supportsNestedTransactions?.() ?? false
  }

  /**
   * Check if a key exists
   */
  async has(key: string): Promise<boolean> {
    // Check hot tier first
    if (await this.cacheLayer.has(key)) {
      return true
    }

    // Check warm tier
    if (await this.doStorage.has(key)) {
      return true
    }

    // Check cold tier
    return this.r2Layer.has(key)
  }

  /**
   * Clear all data from storage
   */
  async clear(): Promise<void> {
    await this.doStorage.clear()
    this.accessCounts.clear()
    this.lastAccessTimes.clear()
  }

  /**
   * Get the number of keys in storage
   */
  async count(prefix?: string): Promise<number> {
    return this.doStorage.count(prefix)
  }

  /**
   * Locate which tier a key is stored in
   */
  async locateKey(key: string): Promise<KeyLocation> {
    // Check hot tier
    if (await this.cacheLayer.has(key)) {
      return { tier: 'hot', found: true, key }
    }

    // Check warm tier
    if (await this.doStorage.has(key)) {
      return { tier: 'warm', found: true, key }
    }

    // Check cold tier
    if (await this.r2Layer.has(key)) {
      return { tier: 'cold', found: true, key }
    }

    return { found: false, key }
  }

  /**
   * Promote a key from cold (R2) to warm (DO) tier
   */
  async promoteToWarm<T = unknown>(key: string, data?: T): Promise<void> {
    const value = data ?? (await this.r2Layer.get<T>(key))
    if (value === undefined) {
      return
    }

    const event: PromotionEvent = {
      key,
      fromTier: 'cold',
      toTier: 'warm',
      timestamp: Date.now(),
      success: false,
    }

    try {
      await this.doStorage.put(key, value)
      this.doStats.writes++
      this.doStats.bytesWritten += JSON.stringify(value).length
      this.promotionStats.coldToWarm++
      this.resetAccessCount(key)
      event.success = true
    } catch (error) {
      event.error = error instanceof Error ? error.message : 'Unknown error'
    }

    this.onPromotionCallback?.(event)
  }

  /**
   * Promote a key from warm (DO) to hot (Cache) tier
   */
  async promoteToHot<T = unknown>(key: string, data?: T): Promise<void> {
    const value = data ?? (await this.doStorage.get<T>(key))
    if (value === undefined) {
      return
    }

    const event: PromotionEvent = {
      key,
      fromTier: 'warm',
      toTier: 'hot',
      timestamp: Date.now(),
      success: false,
    }

    try {
      await this.cacheLayer.put(key, value, {
        lastAccessed: Date.now(),
        accessCount: this.accessCounts.get(key) ?? 1,
      })
      this.promotionStats.warmToHot++
      this.resetAccessCount(key)
      event.success = true
    } catch (error) {
      event.error = error instanceof Error ? error.message : 'Unknown error'
    }

    this.onPromotionCallback?.(event)
  }

  /**
   * Demote a key from hot (Cache) to warm (DO) tier
   */
  async demoteFromHot(key: string): Promise<void> {
    const event: DemotionEvent = {
      key,
      fromTier: 'hot',
      toTier: 'warm',
      timestamp: Date.now(),
      success: false,
      reason: 'manual',
    }

    try {
      // Just delete from cache - data should already be in DO
      await this.cacheLayer.delete(key)
      this.demotionStats.hotToWarm++
      event.success = true
    } catch (error) {
      event.error = error instanceof Error ? error.message : 'Unknown error'
    }

    this.onDemotionCallback?.(event)
  }

  /**
   * Demote a key from warm (DO) to cold (R2) tier
   */
  async demoteFromWarm<T = unknown>(key: string): Promise<void> {
    const event: DemotionEvent = {
      key,
      fromTier: 'warm',
      toTier: 'cold',
      timestamp: Date.now(),
      success: false,
      reason: 'manual',
    }

    try {
      // Copy to R2, then delete from DO
      const data = await this.doStorage.get<T>(key)
      if (data !== undefined) {
        await this.r2Layer.put(key, data)
        await this.doStorage.delete(key)
        this.doStats.deletes++
        this.demotionStats.warmToCold++
        event.success = true
      }
    } catch (error) {
      event.error = error instanceof Error ? error.message : 'Unknown error'
    }

    this.onDemotionCallback?.(event)
  }

  /**
   * Get combined statistics from all tiers
   */
  getStats(): TieredStorageStats {
    return {
      cache: this.cacheLayer.getStats(),
      r2: this.r2Layer.getStats(),
      do: { ...this.doStats },
      promotions: { ...this.promotionStats },
      demotions: { ...this.demotionStats },
    }
  }

  /**
   * Reset all statistics
   */
  resetStats(): void {
    this.cacheLayer.resetStats()
    this.r2Layer.resetStats()
    this.doStats = {
      reads: 0,
      writes: 0,
      deletes: 0,
      bytesRead: 0,
      bytesWritten: 0,
    }
    this.promotionStats = {
      coldToWarm: 0,
      warmToHot: 0,
    }
    this.demotionStats = {
      hotToWarm: 0,
      warmToCold: 0,
    }
    this.accessCounts.clear()
    this.lastAccessTimes.clear()
  }

  /**
   * Get the access count for a key
   */
  getAccessCount(key: string): number {
    return this.accessCounts.get(key) ?? 0
  }

  /**
   * Get the promotion threshold
   */
  getPromotionThreshold(): number {
    return this.promotionThreshold
  }

  /**
   * Set the promotion threshold
   */
  setPromotionThreshold(threshold: number): void {
    this.promotionThreshold = threshold
  }

  /**
   * Enable or disable auto-promotion
   */
  setAutoPromote(enabled: boolean): void {
    this.autoPromote = enabled
  }

  /**
   * Check if auto-promotion is enabled
   */
  isAutoPromoteEnabled(): boolean {
    return this.autoPromote
  }
}

/**
 * Create a new TieredStorageAdapter instance
 */
export function createTieredStorageAdapter(config: TieredStorageConfig): TieredStorageAdapter {
  return new TieredStorageAdapter(config)
}
