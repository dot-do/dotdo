/**
 * Cache module exports
 *
 * Provides visibility-aware caching utilities for dotdo.
 *
 * @example
 * ```typescript
 * import { createVisibilityCache, type Visibility } from './lib/cache'
 *
 * const cache = createVisibilityCache()
 *
 * // Cache public data with long TTL
 * await cache.set({
 *   key: 'products:featured',
 *   visibility: 'public',
 *   data: products,
 * })
 *
 * // Cache org-scoped data
 * await cache.set({
 *   key: 'customers:list',
 *   visibility: 'org',
 *   context: { orgId: 'org-123' },
 *   data: customers,
 * })
 * ```
 */

export {
  // Types
  type Visibility,
  type CacheContext,
  type VisibilityTTLConfig,
  type CacheEntry,
  type CacheGetOptions,
  type CacheSetOptions,
  type CacheInvalidateOptions,
  type CachePoolConfig,
  type CacheStats,

  // Constants
  DEFAULT_TTL_CONFIG,
  VISIBILITY_PREFIXES,

  // Utility Functions
  validateVisibility,
  validateCacheContext,
  getTTLForVisibility,
  hashContext,
  buildCacheKey,
  parseCacheKey,

  // Classes
  VisibilityCache,
  CloudflareVisibilityCache,

  // Factory Functions
  createVisibilityCache,
  createCloudflareVisibilityCache,
  createSeparatedCachePools,
} from './visibility'
