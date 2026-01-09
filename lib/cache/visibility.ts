/**
 * Unified Visibility-Aware Cache
 *
 * Provides a caching strategy that respects visibility levels to prevent
 * data leakage while maximizing cache efficiency.
 *
 * Visibility levels and caching strategy:
 * - public: Shared cache, long TTL (3600s) - aggressive caching
 * - unlisted: Per-item cache, medium TTL (600s) - not discoverable but cacheable
 * - org: Org-scoped cache key, short TTL (300s) - includes orgId in key
 * - user: User-scoped cache key, short TTL (300s) - includes userId in key
 *
 * Cache keys MUST include visibility + context to prevent data leaks.
 *
 * @example
 * ```typescript
 * const cache = new VisibilityCache()
 *
 * // Public data - shared cache
 * const result = await cache.get<Product>({
 *   key: 'products:featured',
 *   visibility: 'public',
 * })
 *
 * // Org data - scoped to org
 * const orgData = await cache.get<Customer>({
 *   key: 'customers:list',
 *   visibility: 'org',
 *   context: { orgId: 'org-123' },
 * })
 * ```
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Visibility levels for data access control
 */
export type Visibility = 'public' | 'unlisted' | 'org' | 'user'

/**
 * Cache context for scoping
 */
export interface CacheContext {
  /** User ID for user-scoped caching */
  userId?: string
  /** Organization ID for org-scoped caching */
  orgId?: string
  /** Whether the requester is an admin (can bypass some restrictions) */
  isAdmin?: boolean
}

/**
 * TTL configuration by visibility level (in seconds)
 */
export interface VisibilityTTLConfig {
  /** Public data TTL (default: 3600s = 1 hour) */
  public: number
  /** Unlisted data TTL (default: 600s = 10 minutes) */
  unlisted: number
  /** Org-scoped data TTL (default: 300s = 5 minutes) */
  org: number
  /** User-scoped data TTL (default: 300s = 5 minutes) */
  user: number
}

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T> {
  /** Cached data */
  data: T
  /** When the entry was cached */
  cachedAt: number
  /** When the entry expires */
  expiresAt: number
  /** Visibility level of the cached data */
  visibility: Visibility
  /** Context used to create the cache key (for validation) */
  contextHash?: string
}

/**
 * Cache get options
 */
export interface CacheGetOptions {
  /** Cache key (without visibility prefix) */
  key: string
  /** Visibility level */
  visibility: Visibility
  /** Context for scoped caching */
  context?: CacheContext
}

/**
 * Cache set options
 */
export interface CacheSetOptions<T> extends CacheGetOptions {
  /** Data to cache */
  data: T
  /** Optional custom TTL (overrides visibility-based TTL) */
  ttl?: number
}

/**
 * Cache invalidation options
 */
export interface CacheInvalidateOptions {
  /** Cache key pattern to invalidate */
  key: string
  /** Visibility level */
  visibility?: Visibility
  /** Context for scoped invalidation */
  context?: CacheContext
  /** Invalidate all entries matching key prefix */
  prefix?: boolean
}

/**
 * Cache pool configuration
 */
export interface CachePoolConfig {
  /** Pool name prefix */
  name: string
  /** Custom TTL config for this pool */
  ttl?: Partial<VisibilityTTLConfig>
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Total cache hits */
  hits: number
  /** Total cache misses */
  misses: number
  /** Total entries by visibility */
  entriesByVisibility: Record<Visibility, number>
  /** Total entries */
  totalEntries: number
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default TTL configuration by visibility level
 */
export const DEFAULT_TTL_CONFIG: VisibilityTTLConfig = {
  public: 3600, // 1 hour - aggressive caching for public data
  unlisted: 600, // 10 minutes - medium caching
  org: 300, // 5 minutes - short TTL for org data
  user: 300, // 5 minutes - short TTL for user data
}

/**
 * Cache key prefixes by visibility level
 */
export const VISIBILITY_PREFIXES: Record<Visibility, string> = {
  public: 'pub',
  unlisted: 'unl',
  org: 'org',
  user: 'usr',
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validate visibility level
 */
export function validateVisibility(visibility: unknown): visibility is Visibility {
  return (
    typeof visibility === 'string' &&
    ['public', 'unlisted', 'org', 'user'].includes(visibility)
  )
}

/**
 * Validate cache context for visibility level
 */
export function validateCacheContext(
  visibility: Visibility,
  context?: CacheContext
): void {
  if (visibility === 'org' && !context?.orgId) {
    throw new Error('Org context (orgId) required for org visibility caching')
  }
  if (visibility === 'user' && !context?.userId) {
    throw new Error('User context (userId) required for user visibility caching')
  }
}

/**
 * Get TTL for visibility level
 */
export function getTTLForVisibility(
  visibility: Visibility,
  config: VisibilityTTLConfig = DEFAULT_TTL_CONFIG
): number {
  return config[visibility]
}

/**
 * Create a hash from context for cache key
 */
export function hashContext(context?: CacheContext): string {
  if (!context) return ''
  const parts: string[] = []
  if (context.userId) parts.push(`u:${context.userId}`)
  if (context.orgId) parts.push(`o:${context.orgId}`)
  return parts.join(':')
}

/**
 * Build a cache key that includes visibility and context
 *
 * Key format: {prefix}:{visibility}:{contextHash}:{key}
 *
 * Examples:
 * - Public: pub:public::products:featured
 * - Org: org:org:o:org-123:customers:list
 * - User: usr:user:u:user-456:settings
 */
export function buildCacheKey(
  key: string,
  visibility: Visibility,
  context?: CacheContext,
  poolPrefix?: string
): string {
  const prefix = poolPrefix ? `${poolPrefix}:` : ''
  const visPrefix = VISIBILITY_PREFIXES[visibility]
  const contextHash = hashContext(context)

  // For public data, we use a shared key (no context)
  if (visibility === 'public') {
    return `${prefix}${visPrefix}:${visibility}::${key}`
  }

  // For unlisted, we include the key but no user/org context (per-item caching)
  if (visibility === 'unlisted') {
    return `${prefix}${visPrefix}:${visibility}::${key}`
  }

  // For org/user, we MUST include context to prevent leaks
  return `${prefix}${visPrefix}:${visibility}:${contextHash}:${key}`
}

/**
 * Parse a cache key to extract components
 *
 * Key format: {poolPrefix?}:{visPrefix}:{visibility}:{contextHash}:{key}
 * Examples:
 * - pub:public::products:featured
 * - org:org:o:org-123:customers:list
 * - usr:user:u:user-456:settings
 * - analytics:pub:public::data
 */
export function parseCacheKey(
  fullKey: string
): { visibility: Visibility; contextHash: string; key: string } | null {
  const parts = fullKey.split(':')

  // Find visibility in parts (it should be one of the known values)
  const visIndex = parts.findIndex((p) => validateVisibility(p))
  if (visIndex === -1) return null

  const visibility = parts[visIndex] as Visibility

  // For public/unlisted: contextHash is empty, key starts at visIndex + 2
  // For org/user: contextHash has format like "o:org-123" or "u:user-456"
  if (visibility === 'public' || visibility === 'unlisted') {
    // Format: {prefix}:{visibility}::{key}
    // parts[visIndex+1] should be empty, rest is key
    const contextHash = ''
    const key = parts.slice(visIndex + 2).join(':')
    return { visibility, contextHash, key }
  }

  // For org/user, context hash format is "o:org-id" or "u:user-id"
  // We need to find where the context hash ends and the key begins
  // Context hash starts with 'o:' or 'u:' followed by the ID
  const contextStart = visIndex + 1
  const contextPrefixPart = parts[contextStart] // 'o' or 'u'

  if (contextPrefixPart === 'o' || contextPrefixPart === 'u') {
    // Context is "o:org-id" or "u:user-id"
    const contextId = parts[contextStart + 1]
    const contextHash = `${contextPrefixPart}:${contextId}`
    const key = parts.slice(contextStart + 2).join(':')
    return { visibility, contextHash, key }
  }

  // Fallback for empty context
  const contextHash = parts[visIndex + 1] || ''
  const key = parts.slice(visIndex + 2).join(':')
  return { visibility, contextHash, key }
}

// ============================================================================
// VisibilityCache Class
// ============================================================================

/**
 * Visibility-aware cache implementation
 *
 * Ensures that:
 * 1. Public data has aggressive caching (long TTL, shared cache)
 * 2. Org/user data is NOT leaked via cache (context in key)
 * 3. Cache isolation by visibility level
 * 4. Easy cache invalidation on visibility changes
 */
export class VisibilityCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map()
  private ttlConfig: VisibilityTTLConfig
  private poolPrefix: string
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    entriesByVisibility: { public: 0, unlisted: 0, org: 0, user: 0 },
    totalEntries: 0,
  }

  constructor(options?: {
    ttl?: Partial<VisibilityTTLConfig>
    pool?: string
  }) {
    this.ttlConfig = { ...DEFAULT_TTL_CONFIG, ...options?.ttl }
    this.poolPrefix = options?.pool ?? ''
  }

  // --------------------------------------------------------------------------
  // Core Cache Operations
  // --------------------------------------------------------------------------

  /**
   * Get a cached value
   */
  async get<T>(options: CacheGetOptions): Promise<T | undefined> {
    validateCacheContext(options.visibility, options.context)

    const cacheKey = buildCacheKey(
      options.key,
      options.visibility,
      options.context,
      this.poolPrefix
    )

    const entry = this.cache.get(cacheKey) as CacheEntry<T> | undefined

    if (!entry) {
      this.stats.misses++
      return undefined
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(cacheKey)
      this.stats.entriesByVisibility[entry.visibility]--
      this.stats.totalEntries--
      this.stats.misses++
      return undefined
    }

    // Validate context matches (prevent key manipulation attacks)
    const expectedContextHash = hashContext(options.context)
    if (entry.contextHash && entry.contextHash !== expectedContextHash) {
      // Context mismatch - this could be an attack attempt
      this.stats.misses++
      return undefined
    }

    this.stats.hits++
    return entry.data
  }

  /**
   * Set a cached value
   */
  async set<T>(options: CacheSetOptions<T>): Promise<void> {
    validateCacheContext(options.visibility, options.context)

    const cacheKey = buildCacheKey(
      options.key,
      options.visibility,
      options.context,
      this.poolPrefix
    )

    const ttl = options.ttl ?? getTTLForVisibility(options.visibility, this.ttlConfig)
    const now = Date.now()

    const entry: CacheEntry<T> = {
      data: options.data,
      cachedAt: now,
      expiresAt: now + ttl * 1000,
      visibility: options.visibility,
      contextHash: hashContext(options.context),
    }

    // Track stats
    const existing = this.cache.get(cacheKey)
    if (!existing) {
      this.stats.entriesByVisibility[options.visibility]++
      this.stats.totalEntries++
    }

    this.cache.set(cacheKey, entry as CacheEntry<unknown>)
  }

  /**
   * Delete a cached value
   */
  async delete(options: CacheGetOptions): Promise<boolean> {
    const cacheKey = buildCacheKey(
      options.key,
      options.visibility,
      options.context,
      this.poolPrefix
    )

    const entry = this.cache.get(cacheKey)
    if (entry) {
      this.stats.entriesByVisibility[entry.visibility]--
      this.stats.totalEntries--
      this.cache.delete(cacheKey)
      return true
    }

    return false
  }

  /**
   * Check if a key exists in cache
   */
  async has(options: CacheGetOptions): Promise<boolean> {
    const value = await this.get(options)
    return value !== undefined
  }

  // --------------------------------------------------------------------------
  // Get or Set Pattern
  // --------------------------------------------------------------------------

  /**
   * Get cached value or compute and cache it
   */
  async getOrSet<T>(
    options: CacheGetOptions,
    compute: () => Promise<T>
  ): Promise<T> {
    const cached = await this.get<T>(options)
    if (cached !== undefined) {
      return cached
    }

    const value = await compute()
    await this.set({ ...options, data: value })
    return value
  }

  // --------------------------------------------------------------------------
  // Cache Invalidation
  // --------------------------------------------------------------------------

  /**
   * Invalidate cache entries
   *
   * Supports:
   * - Exact key match
   * - Prefix match (all keys starting with pattern)
   * - Visibility-scoped invalidation
   * - Context-scoped invalidation
   */
  async invalidate(options: CacheInvalidateOptions): Promise<number> {
    let invalidated = 0

    if (options.prefix) {
      // Prefix-based invalidation
      const prefixKey = options.visibility
        ? buildCacheKey(options.key, options.visibility, options.context, this.poolPrefix)
        : options.key

      for (const [key, entry] of this.cache.entries()) {
        if (key.startsWith(prefixKey)) {
          this.cache.delete(key)
          this.stats.entriesByVisibility[entry.visibility]--
          this.stats.totalEntries--
          invalidated++
        }
      }
    } else if (options.visibility) {
      // Exact key invalidation
      const deleted = await this.delete({
        key: options.key,
        visibility: options.visibility,
        context: options.context,
      })
      if (deleted) invalidated++
    } else {
      // Invalidate key across all visibility levels
      for (const visibility of ['public', 'unlisted', 'org', 'user'] as Visibility[]) {
        const deleted = await this.delete({
          key: options.key,
          visibility,
          context: options.context,
        })
        if (deleted) invalidated++
      }
    }

    return invalidated
  }

  /**
   * Invalidate all entries for a specific visibility level
   */
  async invalidateByVisibility(visibility: Visibility): Promise<number> {
    let invalidated = 0

    for (const [key, entry] of this.cache.entries()) {
      if (entry.visibility === visibility) {
        this.cache.delete(key)
        this.stats.entriesByVisibility[visibility]--
        this.stats.totalEntries--
        invalidated++
      }
    }

    return invalidated
  }

  /**
   * Invalidate all entries for a specific org
   */
  async invalidateByOrg(orgId: string): Promise<number> {
    let invalidated = 0
    const orgContextHash = `o:${orgId}`

    for (const [key, entry] of this.cache.entries()) {
      if (entry.contextHash?.includes(orgContextHash)) {
        this.cache.delete(key)
        this.stats.entriesByVisibility[entry.visibility]--
        this.stats.totalEntries--
        invalidated++
      }
    }

    return invalidated
  }

  /**
   * Invalidate all entries for a specific user
   */
  async invalidateByUser(userId: string): Promise<number> {
    let invalidated = 0
    const userContextHash = `u:${userId}`

    for (const [key, entry] of this.cache.entries()) {
      if (entry.contextHash?.includes(userContextHash)) {
        this.cache.delete(key)
        this.stats.entriesByVisibility[entry.visibility]--
        this.stats.totalEntries--
        invalidated++
      }
    }

    return invalidated
  }

  // --------------------------------------------------------------------------
  // Visibility Change Helpers
  // --------------------------------------------------------------------------

  /**
   * Handle visibility change for a cached item
   *
   * When an item's visibility changes, we need to:
   * 1. Remove from old visibility cache
   * 2. Optionally cache in new visibility level
   *
   * @example
   * ```typescript
   * // When a product goes from 'user' to 'public'
   * await cache.handleVisibilityChange({
   *   key: 'products:123',
   *   oldVisibility: 'user',
   *   newVisibility: 'public',
   *   oldContext: { userId: 'user-456' },
   *   data: productData, // Optional: re-cache with new visibility
   * })
   * ```
   */
  async handleVisibilityChange<T>(options: {
    key: string
    oldVisibility: Visibility
    newVisibility: Visibility
    oldContext?: CacheContext
    newContext?: CacheContext
    data?: T
  }): Promise<void> {
    // Remove from old cache
    await this.delete({
      key: options.key,
      visibility: options.oldVisibility,
      context: options.oldContext,
    })

    // Optionally cache in new visibility level
    if (options.data !== undefined) {
      await this.set({
        key: options.key,
        visibility: options.newVisibility,
        context: options.newContext,
        data: options.data,
      })
    }
  }

  // --------------------------------------------------------------------------
  // Cache Pool Management
  // --------------------------------------------------------------------------

  /**
   * Create a namespaced cache pool
   *
   * Useful for separating different types of cached data
   * (e.g., products, users, analytics)
   */
  createPool(config: CachePoolConfig): VisibilityCache {
    return new VisibilityCache({
      ttl: { ...this.ttlConfig, ...config.ttl },
      pool: config.name,
    })
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.cache.clear()
    this.stats = {
      hits: 0,
      misses: 0,
      entriesByVisibility: { public: 0, unlisted: 0, org: 0, user: 0 },
      totalEntries: 0,
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats }
  }

  /**
   * Get number of entries
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Cleanup expired entries
   */
  async cleanup(): Promise<number> {
    let cleaned = 0
    const now = Date.now()

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
        this.stats.entriesByVisibility[entry.visibility]--
        this.stats.totalEntries--
        cleaned++
      }
    }

    return cleaned
  }
}

// ============================================================================
// Cloudflare Cache API Integration
// ============================================================================

/**
 * Visibility-aware cache using Cloudflare Cache API
 *
 * Designed for edge caching with proper visibility isolation.
 */
export class CloudflareVisibilityCache {
  private cache: Cache | null = null
  private cacheName: string
  private ttlConfig: VisibilityTTLConfig
  private poolPrefix: string

  constructor(options?: {
    cacheName?: string
    ttl?: Partial<VisibilityTTLConfig>
    pool?: string
  }) {
    this.cacheName = options?.cacheName ?? 'visibility-cache'
    this.ttlConfig = { ...DEFAULT_TTL_CONFIG, ...options?.ttl }
    this.poolPrefix = options?.pool ?? ''
  }

  private async getCache(): Promise<Cache> {
    if (!this.cache && typeof caches !== 'undefined') {
      this.cache = await caches.open(this.cacheName)
    }
    if (!this.cache) {
      throw new Error('Cache API not available')
    }
    return this.cache
  }

  /**
   * Get cached value
   */
  async get<T>(options: CacheGetOptions): Promise<T | undefined> {
    validateCacheContext(options.visibility, options.context)

    const cacheKey = buildCacheKey(
      options.key,
      options.visibility,
      options.context,
      this.poolPrefix
    )

    try {
      const cache = await this.getCache()
      const request = new Request(`https://cache.local/${encodeURIComponent(cacheKey)}`)
      const response = await cache.match(request)

      if (!response) {
        return undefined
      }

      // Check X-Cache-Date header for TTL validation
      const cacheDate = response.headers.get('X-Cache-Date')
      if (cacheDate) {
        const age = (Date.now() - new Date(cacheDate).getTime()) / 1000
        const ttl = getTTLForVisibility(options.visibility, this.ttlConfig)
        if (age > ttl) {
          await cache.delete(request)
          return undefined
        }
      }

      const data = await response.json()
      return data as T
    } catch {
      return undefined
    }
  }

  /**
   * Set cached value
   */
  async set<T>(options: CacheSetOptions<T>): Promise<void> {
    validateCacheContext(options.visibility, options.context)

    const cacheKey = buildCacheKey(
      options.key,
      options.visibility,
      options.context,
      this.poolPrefix
    )

    const ttl = options.ttl ?? getTTLForVisibility(options.visibility, this.ttlConfig)

    try {
      const cache = await this.getCache()
      const request = new Request(`https://cache.local/${encodeURIComponent(cacheKey)}`)

      const headers = new Headers()
      headers.set('Content-Type', 'application/json')
      headers.set('Cache-Control', `max-age=${ttl}`)
      headers.set('X-Cache-Date', new Date().toISOString())
      headers.set('X-Visibility', options.visibility)
      if (options.context) {
        headers.set('X-Context-Hash', hashContext(options.context))
      }

      const response = new Response(JSON.stringify(options.data), {
        status: 200,
        headers,
      })

      await cache.put(request, response)
    } catch {
      // Silently fail if cache API not available
    }
  }

  /**
   * Delete cached value
   */
  async delete(options: CacheGetOptions): Promise<boolean> {
    const cacheKey = buildCacheKey(
      options.key,
      options.visibility,
      options.context,
      this.poolPrefix
    )

    try {
      const cache = await this.getCache()
      const request = new Request(`https://cache.local/${encodeURIComponent(cacheKey)}`)
      return await cache.delete(request)
    } catch {
      return false
    }
  }

  /**
   * Get or set pattern
   */
  async getOrSet<T>(
    options: CacheGetOptions,
    compute: () => Promise<T>
  ): Promise<T> {
    const cached = await this.get<T>(options)
    if (cached !== undefined) {
      return cached
    }

    const value = await compute()
    await this.set({ ...options, data: value })
    return value
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a visibility-aware cache with default configuration
 */
export function createVisibilityCache(options?: {
  ttl?: Partial<VisibilityTTLConfig>
  pool?: string
}): VisibilityCache {
  return new VisibilityCache(options)
}

/**
 * Create a visibility-aware cache backed by Cloudflare Cache API
 */
export function createCloudflareVisibilityCache(options?: {
  cacheName?: string
  ttl?: Partial<VisibilityTTLConfig>
  pool?: string
}): CloudflareVisibilityCache {
  return new CloudflareVisibilityCache(options)
}

/**
 * Create separate cache pools for different visibility levels
 *
 * This is useful when you want physical separation between
 * public and private caches.
 */
export function createSeparatedCachePools(): {
  public: VisibilityCache
  private: VisibilityCache
} {
  return {
    // Public pool with long TTL
    public: new VisibilityCache({
      pool: 'public',
      ttl: { public: 3600, unlisted: 600, org: 300, user: 300 },
    }),
    // Private pool with shorter TTL
    private: new VisibilityCache({
      pool: 'private',
      ttl: { public: 3600, unlisted: 600, org: 300, user: 300 },
    }),
  }
}
