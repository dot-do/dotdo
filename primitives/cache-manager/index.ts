/**
 * Cache Manager Primitive
 * Comprehensive caching system for the dotdo platform
 */

export * from './types'
import type {
  CacheConfig,
  CacheEntry,
  CacheEntryMetadata,
  CacheOptions,
  CacheStats,
  ICache,
  InvalidationPattern,
  CacheFactory,
  CacheTier,
} from './types'

/**
 * Check if a cache entry has expired
 */
function isExpired<T>(entry: CacheEntry<T>): boolean {
  if (entry.expiresAt === undefined) {
    return false
  }
  return Date.now() > entry.expiresAt
}

/**
 * Base CacheManager class with basic get/set/delete operations
 */
export class CacheManager<T = unknown> implements ICache<T> {
  private entries: Map<string, CacheEntry<T>> = new Map()
  private _stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
  }
  private pendingFactories: Map<string, Promise<T>> = new Map()

  constructor(private config: CacheConfig = {}) {}

  /**
   * Get a value from the cache
   */
  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) {
      this._stats.misses++
      return undefined
    }

    // Check if expired
    if (isExpired(entry)) {
      this.entries.delete(key)
      this._stats.expirations++
      this._stats.misses++
      return undefined
    }

    // Update access metadata
    entry.metadata.lastAccessedAt = Date.now()
    entry.metadata.accessCount++
    this._stats.hits++

    return entry.value
  }

  /**
   * Set a value in the cache
   */
  set(key: string, value: T, options?: CacheOptions): void {
    const now = Date.now()
    const metadata: CacheEntryMetadata = {
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      tags: options?.tags,
      priority: options?.priority,
    }

    // Determine TTL: per-entry TTL takes precedence, then config TTL
    const ttl = options?.ttl ?? this.config.ttl

    const entry: CacheEntry<T> = {
      key,
      value,
      metadata,
      expiresAt: ttl !== undefined ? now + ttl : undefined,
    }

    this.entries.set(key, entry)
  }

  /**
   * Delete a value from the cache
   */
  delete(key: string): boolean {
    return this.entries.delete(key)
  }

  /**
   * Check if a key exists in the cache
   */
  has(key: string): boolean {
    const entry = this.entries.get(key)
    if (!entry) {
      return false
    }

    // Check if expired
    if (isExpired(entry)) {
      this.entries.delete(key)
      this._stats.expirations++
      return false
    }

    return true
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.entries.clear()
  }

  /**
   * Get or compute a value
   */
  getOrSet(key: string, factory: CacheFactory<T>, options?: CacheOptions): T | Promise<T> {
    // Check if value exists
    const existing = this.get(key)
    if (existing !== undefined) {
      // Undo the hit count from get() since we're just checking
      return existing
    }
    // Undo the miss count from get() since we're about to set
    this._stats.misses--

    // Check if there's a pending factory call for this key
    const pending = this.pendingFactories.get(key)
    if (pending) {
      return pending
    }

    // Call factory
    const result = factory()

    // Handle async factory
    if (result instanceof Promise) {
      const promise = result.then(value => {
        this.set(key, value, options)
        this.pendingFactories.delete(key)
        return value
      }).catch(err => {
        this.pendingFactories.delete(key)
        throw err
      })
      this.pendingFactories.set(key, promise)
      return promise
    }

    // Sync factory
    this.set(key, result, options)
    return result
  }

  /**
   * Get cache statistics
   */
  stats(): CacheStats {
    const total = this._stats.hits + this._stats.misses
    return {
      hits: this._stats.hits,
      misses: this._stats.misses,
      hitRate: total > 0 ? this._stats.hits / total : 0,
      size: this.size(),
      evictions: this._stats.evictions,
      expirations: this._stats.expirations,
    }
  }

  /**
   * Get all keys in the cache (excluding expired entries)
   */
  keys(): string[] {
    const validKeys: string[] = []
    for (const [key, entry] of this.entries) {
      if (!isExpired(entry)) {
        validKeys.push(key)
      } else {
        // Clean up expired entry
        this.entries.delete(key)
        this._stats.expirations++
      }
    }
    return validKeys
  }

  /**
   * Get the current size of the cache (excluding expired entries)
   */
  size(): number {
    let count = 0
    for (const [key, entry] of this.entries) {
      if (!isExpired(entry)) {
        count++
      } else {
        // Clean up expired entry
        this.entries.delete(key)
        this._stats.expirations++
      }
    }
    return count
  }

  /**
   * Get entry with metadata (for invalidator)
   */
  getEntry(key: string): CacheEntry<T> | undefined {
    return this.entries.get(key)
  }

  /**
   * Get all entries (for invalidator)
   */
  getEntries(): Map<string, CacheEntry<T>> {
    return this.entries
  }
}

/**
 * LRU (Least Recently Used) Cache
 * Evicts the least recently accessed entry when at capacity
 */
export class LRUCache<T = unknown> implements ICache<T> {
  private entries: Map<string, CacheEntry<T>> = new Map()
  private _stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
  }
  private pendingFactories: Map<string, Promise<T>> = new Map()

  constructor(private config: CacheConfig = {}) {}

  /**
   * Get a value from the cache and update its access time
   */
  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) {
      this._stats.misses++
      return undefined
    }

    // Check if expired
    if (isExpired(entry)) {
      this.entries.delete(key)
      this._stats.expirations++
      this._stats.misses++
      return undefined
    }

    // Update access time by re-inserting (Map maintains insertion order)
    this.entries.delete(key)
    entry.metadata.lastAccessedAt = Date.now()
    entry.metadata.accessCount++
    this.entries.set(key, entry)
    this._stats.hits++

    return entry.value
  }

  /**
   * Set a value in the cache with LRU eviction
   */
  set(key: string, value: T, options?: CacheOptions): void {
    const now = Date.now()

    // If key already exists, remove it first (to update order)
    if (this.entries.has(key)) {
      this.entries.delete(key)
    } else if (this.config.maxSize !== undefined && this.entries.size >= this.config.maxSize) {
      // Evict the least recently used entry (first entry in Map)
      const firstKey = this.entries.keys().next().value
      if (firstKey !== undefined) {
        this.entries.delete(firstKey)
        this._stats.evictions++
      }
    }

    const metadata: CacheEntryMetadata = {
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      tags: options?.tags,
      priority: options?.priority,
    }

    // Determine TTL: per-entry TTL takes precedence, then config TTL
    const ttl = options?.ttl ?? this.config.ttl

    const entry: CacheEntry<T> = {
      key,
      value,
      metadata,
      expiresAt: ttl !== undefined ? now + ttl : undefined,
    }

    this.entries.set(key, entry)
  }

  /**
   * Delete a value from the cache
   */
  delete(key: string): boolean {
    return this.entries.delete(key)
  }

  /**
   * Check if a key exists in the cache
   */
  has(key: string): boolean {
    const entry = this.entries.get(key)
    if (!entry) {
      return false
    }

    // Check if expired
    if (isExpired(entry)) {
      this.entries.delete(key)
      this._stats.expirations++
      return false
    }

    return true
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.entries.clear()
  }

  /**
   * Get or compute a value
   */
  getOrSet(key: string, factory: CacheFactory<T>, options?: CacheOptions): T | Promise<T> {
    const existing = this.get(key)
    if (existing !== undefined) {
      return existing
    }
    this._stats.misses--

    const pending = this.pendingFactories.get(key)
    if (pending) {
      return pending
    }

    const result = factory()

    if (result instanceof Promise) {
      const promise = result.then(value => {
        this.set(key, value, options)
        this.pendingFactories.delete(key)
        return value
      }).catch(err => {
        this.pendingFactories.delete(key)
        throw err
      })
      this.pendingFactories.set(key, promise)
      return promise
    }

    this.set(key, result, options)
    return result
  }

  /**
   * Get cache statistics
   */
  stats(): CacheStats {
    const total = this._stats.hits + this._stats.misses
    return {
      hits: this._stats.hits,
      misses: this._stats.misses,
      hitRate: total > 0 ? this._stats.hits / total : 0,
      size: this.size(),
      evictions: this._stats.evictions,
      expirations: this._stats.expirations,
    }
  }

  /**
   * Get all keys in the cache (excluding expired entries)
   */
  keys(): string[] {
    const validKeys: string[] = []
    for (const [key, entry] of this.entries) {
      if (!isExpired(entry)) {
        validKeys.push(key)
      } else {
        this.entries.delete(key)
        this._stats.expirations++
      }
    }
    return validKeys
  }

  /**
   * Get the current size of the cache (excluding expired entries)
   */
  size(): number {
    let count = 0
    for (const [key, entry] of this.entries) {
      if (!isExpired(entry)) {
        count++
      } else {
        this.entries.delete(key)
        this._stats.expirations++
      }
    }
    return count
  }
}

/**
 * LFU (Least Frequently Used) Cache
 * Evicts the least frequently accessed entry when at capacity
 * Ties are broken by evicting the oldest entry
 */
export class LFUCache<T = unknown> implements ICache<T> {
  private entries: Map<string, CacheEntry<T>> = new Map()
  // Track insertion order for tie-breaking
  private insertionOrder: string[] = []
  private _stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
  }
  private pendingFactories: Map<string, Promise<T>> = new Map()

  constructor(private config: CacheConfig = {}) {}

  /**
   * Find the key with minimum frequency, using insertion order for ties
   */
  private findLFUKey(): string | undefined {
    let minFreq = Infinity
    let lfuKey: string | undefined

    // Iterate in insertion order to handle ties
    for (const key of this.insertionOrder) {
      const entry = this.entries.get(key)
      if (entry && !isExpired(entry)) {
        if (entry.metadata.accessCount < minFreq) {
          minFreq = entry.metadata.accessCount
          lfuKey = key
        }
      }
    }

    return lfuKey
  }

  /**
   * Get a value from the cache and increment its frequency
   */
  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) {
      this._stats.misses++
      return undefined
    }

    // Check if expired
    if (isExpired(entry)) {
      this.entries.delete(key)
      this.insertionOrder = this.insertionOrder.filter(k => k !== key)
      this._stats.expirations++
      this._stats.misses++
      return undefined
    }

    // Increment access count
    entry.metadata.accessCount++
    entry.metadata.lastAccessedAt = Date.now()
    this._stats.hits++

    return entry.value
  }

  /**
   * Set a value in the cache with LFU eviction
   */
  set(key: string, value: T, options?: CacheOptions): void {
    const now = Date.now()

    // If key already exists, update it without eviction
    if (this.entries.has(key)) {
      const existingEntry = this.entries.get(key)!
      existingEntry.value = value
      existingEntry.metadata.lastAccessedAt = now
      return
    }

    // Evict if at capacity
    if (this.config.maxSize !== undefined && this.entries.size >= this.config.maxSize) {
      const lfuKey = this.findLFUKey()
      if (lfuKey !== undefined) {
        this.entries.delete(lfuKey)
        this.insertionOrder = this.insertionOrder.filter(k => k !== lfuKey)
        this._stats.evictions++
      }
    }

    const metadata: CacheEntryMetadata = {
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1, // Initial access count
      tags: options?.tags,
      priority: options?.priority,
    }

    // Determine TTL
    const ttl = options?.ttl ?? this.config.ttl

    const entry: CacheEntry<T> = {
      key,
      value,
      metadata,
      expiresAt: ttl !== undefined ? now + ttl : undefined,
    }

    this.entries.set(key, entry)
    this.insertionOrder.push(key)
  }

  /**
   * Delete a value from the cache
   */
  delete(key: string): boolean {
    const deleted = this.entries.delete(key)
    if (deleted) {
      this.insertionOrder = this.insertionOrder.filter(k => k !== key)
    }
    return deleted
  }

  /**
   * Check if a key exists in the cache
   */
  has(key: string): boolean {
    const entry = this.entries.get(key)
    if (!entry) {
      return false
    }

    if (isExpired(entry)) {
      this.entries.delete(key)
      this.insertionOrder = this.insertionOrder.filter(k => k !== key)
      this._stats.expirations++
      return false
    }

    return true
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.entries.clear()
    this.insertionOrder = []
  }

  /**
   * Get or compute a value
   */
  getOrSet(key: string, factory: CacheFactory<T>, options?: CacheOptions): T | Promise<T> {
    const existing = this.get(key)
    if (existing !== undefined) {
      return existing
    }
    this._stats.misses--

    const pending = this.pendingFactories.get(key)
    if (pending) {
      return pending
    }

    const result = factory()

    if (result instanceof Promise) {
      const promise = result.then(value => {
        this.set(key, value, options)
        this.pendingFactories.delete(key)
        return value
      }).catch(err => {
        this.pendingFactories.delete(key)
        throw err
      })
      this.pendingFactories.set(key, promise)
      return promise
    }

    this.set(key, result, options)
    return result
  }

  /**
   * Get cache statistics
   */
  stats(): CacheStats {
    const total = this._stats.hits + this._stats.misses
    return {
      hits: this._stats.hits,
      misses: this._stats.misses,
      hitRate: total > 0 ? this._stats.hits / total : 0,
      size: this.size(),
      evictions: this._stats.evictions,
      expirations: this._stats.expirations,
    }
  }

  /**
   * Get all keys in the cache (excluding expired entries)
   */
  keys(): string[] {
    const validKeys: string[] = []
    for (const [key, entry] of this.entries) {
      if (!isExpired(entry)) {
        validKeys.push(key)
      } else {
        this.entries.delete(key)
        this.insertionOrder = this.insertionOrder.filter(k => k !== key)
        this._stats.expirations++
      }
    }
    return validKeys
  }

  /**
   * Get the current size of the cache (excluding expired entries)
   */
  size(): number {
    let count = 0
    for (const [key, entry] of this.entries) {
      if (!isExpired(entry)) {
        count++
      } else {
        this.entries.delete(key)
        this.insertionOrder = this.insertionOrder.filter(k => k !== key)
        this._stats.expirations++
      }
    }
    return count
  }
}

/**
 * FIFO (First In, First Out) Cache
 * Evicts the first inserted entry when at capacity, regardless of access patterns
 */
export class FIFOCache<T = unknown> implements ICache<T> {
  private entries: Map<string, CacheEntry<T>> = new Map()
  // Track insertion order (only for new keys, not updates)
  private insertionOrder: string[] = []
  private _stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
  }
  private pendingFactories: Map<string, Promise<T>> = new Map()

  constructor(private config: CacheConfig = {}) {}

  /**
   * Get a value from the cache (does NOT affect eviction order)
   */
  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) {
      this._stats.misses++
      return undefined
    }

    // Check if expired
    if (isExpired(entry)) {
      this.entries.delete(key)
      this.insertionOrder = this.insertionOrder.filter(k => k !== key)
      this._stats.expirations++
      this._stats.misses++
      return undefined
    }

    this._stats.hits++
    return entry.value
  }

  /**
   * Set a value in the cache with FIFO eviction
   */
  set(key: string, value: T, options?: CacheOptions): void {
    const now = Date.now()

    // If key already exists, just update the value (don't change order)
    if (this.entries.has(key)) {
      const existingEntry = this.entries.get(key)!
      existingEntry.value = value
      existingEntry.metadata.lastAccessedAt = now
      return
    }

    // Evict if at capacity
    if (this.config.maxSize !== undefined && this.entries.size >= this.config.maxSize) {
      // Evict the first inserted entry
      const firstKey = this.insertionOrder[0]
      if (firstKey !== undefined) {
        this.entries.delete(firstKey)
        this.insertionOrder.shift()
        this._stats.evictions++
      }
    }

    const metadata: CacheEntryMetadata = {
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1,
      tags: options?.tags,
      priority: options?.priority,
    }

    // Determine TTL
    const ttl = options?.ttl ?? this.config.ttl

    const entry: CacheEntry<T> = {
      key,
      value,
      metadata,
      expiresAt: ttl !== undefined ? now + ttl : undefined,
    }

    this.entries.set(key, entry)
    this.insertionOrder.push(key)
  }

  /**
   * Delete a value from the cache
   */
  delete(key: string): boolean {
    const deleted = this.entries.delete(key)
    if (deleted) {
      this.insertionOrder = this.insertionOrder.filter(k => k !== key)
    }
    return deleted
  }

  /**
   * Check if a key exists in the cache
   */
  has(key: string): boolean {
    const entry = this.entries.get(key)
    if (!entry) {
      return false
    }

    if (isExpired(entry)) {
      this.entries.delete(key)
      this.insertionOrder = this.insertionOrder.filter(k => k !== key)
      this._stats.expirations++
      return false
    }

    return true
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.entries.clear()
    this.insertionOrder = []
  }

  /**
   * Get or compute a value
   */
  getOrSet(key: string, factory: CacheFactory<T>, options?: CacheOptions): T | Promise<T> {
    const existing = this.get(key)
    if (existing !== undefined) {
      return existing
    }
    this._stats.misses--

    const pending = this.pendingFactories.get(key)
    if (pending) {
      return pending
    }

    const result = factory()

    if (result instanceof Promise) {
      const promise = result.then(value => {
        this.set(key, value, options)
        this.pendingFactories.delete(key)
        return value
      }).catch(err => {
        this.pendingFactories.delete(key)
        throw err
      })
      this.pendingFactories.set(key, promise)
      return promise
    }

    this.set(key, result, options)
    return result
  }

  /**
   * Get cache statistics
   */
  stats(): CacheStats {
    const total = this._stats.hits + this._stats.misses
    return {
      hits: this._stats.hits,
      misses: this._stats.misses,
      hitRate: total > 0 ? this._stats.hits / total : 0,
      size: this.size(),
      evictions: this._stats.evictions,
      expirations: this._stats.expirations,
    }
  }

  /**
   * Get all keys in the cache (excluding expired entries)
   */
  keys(): string[] {
    const validKeys: string[] = []
    for (const [key, entry] of this.entries) {
      if (!isExpired(entry)) {
        validKeys.push(key)
      } else {
        this.entries.delete(key)
        this.insertionOrder = this.insertionOrder.filter(k => k !== key)
        this._stats.expirations++
      }
    }
    return validKeys
  }

  /**
   * Get the current size of the cache (excluding expired entries)
   */
  size(): number {
    let count = 0
    for (const [key, entry] of this.entries) {
      if (!isExpired(entry)) {
        count++
      } else {
        this.entries.delete(key)
        this.insertionOrder = this.insertionOrder.filter(k => k !== key)
        this._stats.expirations++
      }
    }
    return count
  }
}

/**
 * Tag-based cache invalidator
 */
export class TagInvalidator {
  constructor(private cache: CacheManager<unknown>) {}

  /**
   * Invalidate entries matching the pattern
   */
  invalidate(pattern: InvalidationPattern): number {
    let count = 0
    const entries = this.cache.getEntries()
    const keysToDelete: string[] = []

    for (const [key, entry] of entries) {
      let shouldDelete = false

      // Check tags
      if (pattern.tags && pattern.tags.length > 0) {
        const entryTags = entry.metadata.tags || []
        if (pattern.tags.some(tag => entryTags.includes(tag))) {
          shouldDelete = true
        }
      }

      // Check prefix
      if (pattern.prefix && key.startsWith(pattern.prefix)) {
        shouldDelete = true
      }

      // Check regex
      if (pattern.regex && pattern.regex.test(key)) {
        shouldDelete = true
      }

      if (shouldDelete) {
        keysToDelete.push(key)
      }
    }

    // Delete matched entries
    for (const key of keysToDelete) {
      this.cache.delete(key)
      count++
    }

    return count
  }
}

/**
 * Tiered cache configuration
 */
interface TierConfig {
  name: CacheTier
  cache: ICache<unknown>
  promoteOnAccess?: boolean
}

/**
 * Multi-tier cache with promotion/demotion
 */
export class TieredCache<T = unknown> implements ICache<T> {
  private tiers: TierConfig[]
  private pendingFactories: Map<string, Promise<T>> = new Map()

  constructor(tiers: TierConfig[]) {
    this.tiers = tiers
  }

  /**
   * Get a value, checking tiers in order
   */
  get(key: string): T | undefined {
    for (let i = 0; i < this.tiers.length; i++) {
      const tier = this.tiers[i]
      const value = tier.cache.get(key) as T | undefined
      if (value !== undefined) {
        // Promote to higher tier if configured
        if (i > 0 && tier.promoteOnAccess !== false) {
          // Check if first tier promotes on access
          const firstTier = this.tiers[0]
          if (firstTier.promoteOnAccess) {
            firstTier.cache.set(key, value)
          }
        }
        return value
      }
    }
    return undefined
  }

  /**
   * Set a value in the first tier
   */
  set(key: string, value: T, options?: CacheOptions): void {
    if (this.tiers.length > 0) {
      this.tiers[0].cache.set(key, value, options)
    }
  }

  /**
   * Delete from all tiers
   */
  delete(key: string): boolean {
    let deleted = false
    for (const tier of this.tiers) {
      if (tier.cache.delete(key)) {
        deleted = true
      }
    }
    return deleted
  }

  /**
   * Check if key exists in any tier
   */
  has(key: string): boolean {
    for (const tier of this.tiers) {
      if (tier.cache.has(key)) {
        return true
      }
    }
    return false
  }

  /**
   * Clear all tiers
   */
  clear(): void {
    for (const tier of this.tiers) {
      tier.cache.clear()
    }
  }

  /**
   * Get or compute a value
   */
  getOrSet(key: string, factory: CacheFactory<T>, options?: CacheOptions): T | Promise<T> {
    const existing = this.get(key)
    if (existing !== undefined) {
      return existing
    }

    const pending = this.pendingFactories.get(key)
    if (pending) {
      return pending
    }

    const result = factory()

    if (result instanceof Promise) {
      const promise = result.then(value => {
        this.set(key, value, options)
        this.pendingFactories.delete(key)
        return value
      }).catch(err => {
        this.pendingFactories.delete(key)
        throw err
      })
      this.pendingFactories.set(key, promise)
      return promise
    }

    this.set(key, result, options)
    return result
  }

  /**
   * Demote a value from higher to lower tier
   */
  demote(key: string): void {
    for (let i = 0; i < this.tiers.length - 1; i++) {
      const value = this.tiers[i].cache.get(key) as T | undefined
      if (value !== undefined) {
        this.tiers[i].cache.delete(key)
        this.tiers[i + 1].cache.set(key, value)
        return
      }
    }
  }

  /**
   * Aggregate stats from all tiers
   */
  stats(): CacheStats {
    let hits = 0
    let misses = 0
    let evictions = 0
    let expirations = 0
    let size = 0

    for (const tier of this.tiers) {
      const tierStats = tier.cache.stats()
      hits += tierStats.hits
      misses += tierStats.misses
      evictions += tierStats.evictions
      expirations += tierStats.expirations
      size += tierStats.size
    }

    const total = hits + misses
    return {
      hits,
      misses,
      hitRate: total > 0 ? hits / total : 0,
      size,
      evictions,
      expirations,
    }
  }

  /**
   * Get keys from all tiers (may have duplicates)
   */
  keys(): string[] {
    const allKeys = new Set<string>()
    for (const tier of this.tiers) {
      for (const key of tier.cache.keys()) {
        allKeys.add(key)
      }
    }
    return Array.from(allKeys)
  }

  /**
   * Get total size across all tiers
   */
  size(): number {
    return this.stats().size
  }
}

/**
 * Cache warmer result
 */
interface WarmResult {
  total: number
  success: number
  failed: number
}

/**
 * Cache warmer for pre-populating cache
 */
export class CacheWarmer<T = unknown> {
  constructor(private cache: ICache<T>) {}

  /**
   * Warm the cache with the given keys
   */
  async warm(
    keys: string[],
    factory: (key: string) => Promise<T>,
    options?: CacheOptions
  ): Promise<WarmResult> {
    let success = 0
    let failed = 0

    await Promise.all(
      keys.map(async key => {
        try {
          const value = await factory(key)
          this.cache.set(key, value, options)
          success++
        } catch {
          failed++
        }
      })
    )

    return {
      total: keys.length,
      success,
      failed,
    }
  }
}

/**
 * JSON serializer
 */
export class JSONSerializer {
  serialize<T>(value: T): string {
    return JSON.stringify(value)
  }

  deserialize<T>(data: string | Uint8Array): T {
    const str = typeof data === 'string' ? data : new TextDecoder().decode(data)
    return JSON.parse(str)
  }
}

/**
 * MsgPack-like binary serializer
 * A simplified implementation that produces compact binary output
 */
export class MsgPackSerializer {
  serialize<T>(value: T): Uint8Array {
    return this.encode(value)
  }

  deserialize<T>(data: Uint8Array): T {
    return this.decode(data) as T
  }

  private encode(value: unknown): Uint8Array {
    const parts: number[] = []
    this.encodeValue(value, parts)
    return new Uint8Array(parts)
  }

  private encodeValue(value: unknown, parts: number[]): void {
    if (value === null) {
      parts.push(0xc0) // nil
    } else if (value === undefined) {
      parts.push(0xc0) // treat undefined as nil
    } else if (typeof value === 'boolean') {
      parts.push(value ? 0xc3 : 0xc2) // true/false
    } else if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        if (value >= 0 && value <= 127) {
          parts.push(value) // positive fixint
        } else if (value >= -32 && value < 0) {
          parts.push(0xe0 | (value + 32)) // negative fixint
        } else if (value >= 0 && value <= 255) {
          parts.push(0xcc, value) // uint8
        } else if (value >= 0 && value <= 65535) {
          parts.push(0xcd, (value >> 8) & 0xff, value & 0xff) // uint16
        } else if (value >= 0 && value <= 0xffffffff) {
          parts.push(0xce, (value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff) // uint32
        } else if (value >= -128 && value <= 127) {
          parts.push(0xd0, value & 0xff) // int8
        } else if (value >= -32768 && value <= 32767) {
          parts.push(0xd1, (value >> 8) & 0xff, value & 0xff) // int16
        } else {
          // Fall back to float64 for large integers
          this.encodeFloat64(value, parts)
        }
      } else {
        this.encodeFloat64(value, parts)
      }
    } else if (typeof value === 'string') {
      const bytes = new TextEncoder().encode(value)
      if (bytes.length <= 31) {
        parts.push(0xa0 | bytes.length) // fixstr
      } else if (bytes.length <= 255) {
        parts.push(0xd9, bytes.length) // str8
      } else if (bytes.length <= 65535) {
        parts.push(0xda, (bytes.length >> 8) & 0xff, bytes.length & 0xff) // str16
      } else {
        parts.push(0xdb, (bytes.length >> 24) & 0xff, (bytes.length >> 16) & 0xff, (bytes.length >> 8) & 0xff, bytes.length & 0xff) // str32
      }
      for (const b of bytes) {
        parts.push(b)
      }
    } else if (Array.isArray(value)) {
      if (value.length <= 15) {
        parts.push(0x90 | value.length) // fixarray
      } else if (value.length <= 65535) {
        parts.push(0xdc, (value.length >> 8) & 0xff, value.length & 0xff) // array16
      } else {
        parts.push(0xdd, (value.length >> 24) & 0xff, (value.length >> 16) & 0xff, (value.length >> 8) & 0xff, value.length & 0xff) // array32
      }
      for (const item of value) {
        this.encodeValue(item, parts)
      }
    } else if (typeof value === 'object') {
      const keys = Object.keys(value as object)
      if (keys.length <= 15) {
        parts.push(0x80 | keys.length) // fixmap
      } else if (keys.length <= 65535) {
        parts.push(0xde, (keys.length >> 8) & 0xff, keys.length & 0xff) // map16
      } else {
        parts.push(0xdf, (keys.length >> 24) & 0xff, (keys.length >> 16) & 0xff, (keys.length >> 8) & 0xff, keys.length & 0xff) // map32
      }
      for (const key of keys) {
        this.encodeValue(key, parts)
        this.encodeValue((value as Record<string, unknown>)[key], parts)
      }
    }
  }

  private encodeFloat64(value: number, parts: number[]): void {
    parts.push(0xcb) // float64
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    view.setFloat64(0, value, false) // big-endian
    for (let i = 0; i < 8; i++) {
      parts.push(view.getUint8(i))
    }
  }

  private decode(data: Uint8Array): unknown {
    const result = this.decodeValue(data, 0)
    return result.value
  }

  private decodeValue(data: Uint8Array, offset: number): { value: unknown; offset: number } {
    const type = data[offset]

    // Positive fixint (0x00 - 0x7f)
    if (type <= 0x7f) {
      return { value: type, offset: offset + 1 }
    }

    // Fixmap (0x80 - 0x8f)
    if (type >= 0x80 && type <= 0x8f) {
      const length = type & 0x0f
      return this.decodeMap(data, offset + 1, length)
    }

    // Fixarray (0x90 - 0x9f)
    if (type >= 0x90 && type <= 0x9f) {
      const length = type & 0x0f
      return this.decodeArray(data, offset + 1, length)
    }

    // Fixstr (0xa0 - 0xbf)
    if (type >= 0xa0 && type <= 0xbf) {
      const length = type & 0x1f
      const str = new TextDecoder().decode(data.slice(offset + 1, offset + 1 + length))
      return { value: str, offset: offset + 1 + length }
    }

    // Nil
    if (type === 0xc0) {
      return { value: null, offset: offset + 1 }
    }

    // False
    if (type === 0xc2) {
      return { value: false, offset: offset + 1 }
    }

    // True
    if (type === 0xc3) {
      return { value: true, offset: offset + 1 }
    }

    // uint8
    if (type === 0xcc) {
      return { value: data[offset + 1], offset: offset + 2 }
    }

    // uint16
    if (type === 0xcd) {
      return { value: (data[offset + 1] << 8) | data[offset + 2], offset: offset + 3 }
    }

    // uint32
    if (type === 0xce) {
      return { value: (data[offset + 1] << 24) | (data[offset + 2] << 16) | (data[offset + 3] << 8) | data[offset + 4], offset: offset + 5 }
    }

    // int8
    if (type === 0xd0) {
      let val = data[offset + 1]
      if (val >= 128) val -= 256
      return { value: val, offset: offset + 2 }
    }

    // int16
    if (type === 0xd1) {
      let val = (data[offset + 1] << 8) | data[offset + 2]
      if (val >= 32768) val -= 65536
      return { value: val, offset: offset + 3 }
    }

    // float64
    if (type === 0xcb) {
      const buffer = new ArrayBuffer(8)
      const view = new DataView(buffer)
      for (let i = 0; i < 8; i++) {
        view.setUint8(i, data[offset + 1 + i])
      }
      return { value: view.getFloat64(0, false), offset: offset + 9 }
    }

    // str8
    if (type === 0xd9) {
      const length = data[offset + 1]
      const str = new TextDecoder().decode(data.slice(offset + 2, offset + 2 + length))
      return { value: str, offset: offset + 2 + length }
    }

    // str16
    if (type === 0xda) {
      const length = (data[offset + 1] << 8) | data[offset + 2]
      const str = new TextDecoder().decode(data.slice(offset + 3, offset + 3 + length))
      return { value: str, offset: offset + 3 + length }
    }

    // array16
    if (type === 0xdc) {
      const length = (data[offset + 1] << 8) | data[offset + 2]
      return this.decodeArray(data, offset + 3, length)
    }

    // map16
    if (type === 0xde) {
      const length = (data[offset + 1] << 8) | data[offset + 2]
      return this.decodeMap(data, offset + 3, length)
    }

    // Negative fixint (0xe0 - 0xff)
    if (type >= 0xe0) {
      return { value: type - 256, offset: offset + 1 }
    }

    throw new Error(`Unknown msgpack type: 0x${type.toString(16)}`)
  }

  private decodeArray(data: Uint8Array, offset: number, length: number): { value: unknown[]; offset: number } {
    const arr: unknown[] = []
    for (let i = 0; i < length; i++) {
      const result = this.decodeValue(data, offset)
      arr.push(result.value)
      offset = result.offset
    }
    return { value: arr, offset }
  }

  private decodeMap(data: Uint8Array, offset: number, length: number): { value: Record<string, unknown>; offset: number } {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < length; i++) {
      const keyResult = this.decodeValue(data, offset)
      offset = keyResult.offset
      const valueResult = this.decodeValue(data, offset)
      offset = valueResult.offset
      obj[keyResult.value as string] = valueResult.value
    }
    return { value: obj, offset }
  }
}
