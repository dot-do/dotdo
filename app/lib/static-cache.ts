/**
 * Static Cache Utilities for Documentation
 *
 * Provides caching strategies for static documentation pages:
 * - Build-time content hashing for cache invalidation
 * - ETags for efficient conditional requests
 * - Stale-while-revalidate patterns for CDN caching
 *
 * @see https://web.dev/stale-while-revalidate/
 */

import { createHash } from 'crypto'

/**
 * Cache configuration for different content types
 */
export const cacheConfig = {
  /** Documentation pages - cache 1 hour, stale for 1 day */
  docs: {
    maxAge: 3600,
    staleWhileRevalidate: 86400,
    immutable: false,
  },
  /** Static assets (JS/CSS with hash) - immutable */
  assets: {
    maxAge: 31536000,
    staleWhileRevalidate: 0,
    immutable: true,
  },
  /** Images - cache 1 week with revalidation */
  images: {
    maxAge: 604800,
    staleWhileRevalidate: 86400,
    immutable: false,
  },
  /** API responses - short cache with revalidation */
  api: {
    maxAge: 60,
    staleWhileRevalidate: 300,
    immutable: false,
  },
} as const

export type CacheType = keyof typeof cacheConfig

/**
 * Generate Cache-Control header value
 */
export function getCacheControl(type: CacheType): string {
  const config = cacheConfig[type]
  const directives = ['public', `max-age=${config.maxAge}`]

  if (config.staleWhileRevalidate > 0) {
    directives.push(`stale-while-revalidate=${config.staleWhileRevalidate}`)
  }

  if (config.immutable) {
    directives.push('immutable')
  }

  return directives.join(', ')
}

/**
 * Generate ETag from content
 */
export function generateETag(content: string | Buffer): string {
  const hash = createHash('sha256').update(content).digest('hex').substring(0, 16)
  return `"${hash}"`
}

/**
 * Generate weak ETag for large content (doesn't require byte-for-byte match)
 */
export function generateWeakETag(content: string | Buffer): string {
  const hash = createHash('sha256').update(content).digest('hex').substring(0, 16)
  return `W/"${hash}"`
}

/**
 * Check if request has valid conditional headers
 */
export function checkConditionalRequest(
  request: { headers: { get(name: string): string | null } },
  etag: string
): { shouldReturn304: boolean } {
  const ifNoneMatch = request.headers.get('if-none-match')

  if (ifNoneMatch) {
    // Handle multiple ETags and weak comparison
    const tags = ifNoneMatch.split(',').map((t) => t.trim())
    const matches = tags.some((tag) => {
      // Weak comparison - strip W/ prefix if present
      const normalizedTag = tag.replace(/^W\//, '')
      const normalizedEtag = etag.replace(/^W\//, '')
      return normalizedTag === normalizedEtag || tag === '*'
    })
    return { shouldReturn304: matches }
  }

  return { shouldReturn304: false }
}

/**
 * Build manifest entry for a prerendered page
 */
export interface CacheManifestEntry {
  path: string
  etag: string
  lastModified: string
  contentLength: number
  collection?: string
}

/**
 * Create cache manifest for prerendered pages
 * Used for incremental builds and cache invalidation
 */
export function createCacheManifest(entries: CacheManifestEntry[]): {
  version: string
  generated: string
  entries: CacheManifestEntry[]
} {
  const version = generateETag(JSON.stringify(entries.map((e) => e.etag))).replace(/"/g, '')
  return {
    version,
    generated: new Date().toISOString(),
    entries,
  }
}

/**
 * Service worker cache strategy hints
 * These are embedded in HTML for service worker consumption
 */
export const swCacheStrategies = {
  /** Cache-first for static assets */
  CACHE_FIRST: 'cache-first',
  /** Network-first for dynamic content */
  NETWORK_FIRST: 'network-first',
  /** Stale-while-revalidate for docs */
  STALE_WHILE_REVALIDATE: 'stale-while-revalidate',
  /** Network-only for API calls */
  NETWORK_ONLY: 'network-only',
} as const

/**
 * Get recommended cache strategy for a path
 */
export function getCacheStrategy(path: string): (typeof swCacheStrategies)[keyof typeof swCacheStrategies] {
  if (path.startsWith('/assets/')) {
    return swCacheStrategies.CACHE_FIRST
  }
  if (path.startsWith('/docs/')) {
    return swCacheStrategies.STALE_WHILE_REVALIDATE
  }
  if (path.startsWith('/api/')) {
    return swCacheStrategies.NETWORK_ONLY
  }
  return swCacheStrategies.NETWORK_FIRST
}

/**
 * Cloudflare Pages specific cache configuration
 * @see https://developers.cloudflare.com/pages/configuration/serving-pages/
 */
export const cloudflarePagesCacheConfig = {
  // Browser cache TTL for HTML pages
  browserTTL: {
    docs: 3600, // 1 hour
    static: 86400, // 1 day
    api: 0, // No browser cache
  },
  // Edge cache TTL
  edgeTTL: {
    docs: 86400, // 1 day
    static: 2592000, // 30 days
    api: 60, // 1 minute
  },
}

/**
 * Generate Cloudflare Pages _headers content for a path pattern
 */
export function generateCfHeadersRule(pathPattern: string, type: CacheType): string {
  const cacheControl = getCacheControl(type)
  return `${pathPattern}\n  Cache-Control: ${cacheControl}`
}
