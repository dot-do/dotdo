/**
 * Cache Manager Types
 * Comprehensive caching system for the dotdo platform
 */

/**
 * Cache eviction strategies
 */
export type CacheStrategy = 'lru' | 'lfu' | 'fifo' | 'ttl'

/**
 * Cache tier levels
 */
export type CacheTier = 'memory' | 'do-storage' | 'kv' | 'r2'

/**
 * Configuration for cache behavior
 */
export interface CacheConfig {
  /** Default TTL in milliseconds */
  ttl?: number
  /** Maximum number of entries */
  maxSize?: number
  /** Eviction strategy */
  strategy?: CacheStrategy
  /** Cache tier */
  tier?: CacheTier
}

/**
 * Metadata for cache entries
 */
export interface CacheEntryMetadata {
  /** Creation timestamp */
  createdAt: number
  /** Last access timestamp */
  lastAccessedAt: number
  /** Access count for LFU */
  accessCount: number
  /** Tags for invalidation */
  tags?: string[]
  /** Priority for eviction */
  priority?: number
}

/**
 * A single cache entry
 */
export interface CacheEntry<T = unknown> {
  /** Cache key */
  key: string
  /** Cached value */
  value: T
  /** Entry metadata */
  metadata: CacheEntryMetadata
  /** Expiration timestamp (undefined = never expires) */
  expiresAt?: number
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number
  /** Number of cache misses */
  misses: number
  /** Hit rate (hits / (hits + misses)) */
  hitRate: number
  /** Current number of entries */
  size: number
  /** Number of evictions */
  evictions: number
  /** Number of expirations */
  expirations: number
}

/**
 * Pattern for invalidating cache entries
 */
export interface InvalidationPattern {
  /** Invalidate by tags */
  tags?: string[]
  /** Invalidate by key prefix */
  prefix?: string
  /** Invalidate by regex pattern */
  regex?: RegExp
}

/**
 * Options for setting cache entries
 */
export interface CacheOptions {
  /** TTL in milliseconds */
  ttl?: number
  /** Tags for invalidation */
  tags?: string[]
  /** Priority (higher = less likely to be evicted) */
  priority?: number
}

/**
 * Factory function for getOrSet
 */
export type CacheFactory<T> = () => T | Promise<T>

/**
 * Serializer interface for cache values
 */
export interface CacheSerializer {
  serialize<T>(value: T): string | Uint8Array
  deserialize<T>(data: string | Uint8Array): T
}

/**
 * Cache interface
 */
export interface ICache<T = unknown> {
  get(key: string): T | undefined
  set(key: string, value: T, options?: CacheOptions): void
  delete(key: string): boolean
  has(key: string): boolean
  clear(): void
  getOrSet(key: string, factory: CacheFactory<T>, options?: CacheOptions): T | Promise<T>
  stats(): CacheStats
  size(): number
  keys(): string[]
}

/**
 * Tiered cache configuration
 */
export interface TieredCacheConfig {
  tiers: Array<{
    name: CacheTier
    cache: ICache
    /** Promote to higher tier on access */
    promoteOnAccess?: boolean
  }>
}
