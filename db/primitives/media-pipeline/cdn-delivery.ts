/**
 * CDN Delivery - R2-backed content delivery with cache optimization
 *
 * Provides CDN delivery layer with:
 * - **Cache-Control Headers**: Configurable caching directives
 * - **ETag Generation**: Strong and weak ETag support
 * - **Conditional Requests**: If-None-Match, If-Modified-Since handling
 * - **Range Requests**: Byte-range support for large files
 * - **Content Negotiation**: Content-Type, Content-Disposition
 * - **Security Headers**: X-Content-Type-Options, CORS, etc.
 *
 * ## Usage
 *
 * ```typescript
 * import { createCDNDelivery } from './cdn-delivery'
 *
 * const cdn = createCDNDelivery({
 *   bucket: env.R2_BUCKET,
 *   defaultCacheControl: 'public, max-age=86400',
 *   enableConditionalRequests: true,
 *   enableRangeRequests: true,
 * })
 *
 * // Handle request
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     return cdn.handleRequest(request)
 *   }
 * }
 * ```
 *
 * @see https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
 * @module db/primitives/media-pipeline
 */

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * CDN delivery configuration options
 */
export interface CDNDeliveryConfig {
  /** R2 bucket binding */
  bucket: R2Bucket
  /** Default Cache-Control header value */
  defaultCacheControl?: string
  /** Enable conditional request handling (If-None-Match, If-Modified-Since) */
  enableConditionalRequests?: boolean
  /** Enable range request support */
  enableRangeRequests?: boolean
  /** Use weak ETags (W/"...") instead of strong */
  weakETags?: boolean
  /** URL path prefix to strip (e.g., '/cdn/') */
  pathPrefix?: string
  /** Security headers to include */
  securityHeaders?: Record<string, string>
  /** CORS configuration */
  cors?: CorsConfig
}

/**
 * CORS configuration
 */
export interface CorsConfig {
  /** Allowed origins (use '*' for any) */
  allowOrigins: string[]
  /** Allowed HTTP methods */
  allowMethods?: string[]
  /** Headers to expose to client */
  exposeHeaders?: string[]
  /** Max age for preflight cache (seconds) */
  maxAge?: number
}

/**
 * Conditional request headers
 */
export interface ConditionalHeaders {
  /** If-None-Match header value (ETag comparison) */
  ifNoneMatch?: string
  /** If-Modified-Since header value */
  ifModifiedSince?: string
}

/**
 * Delivery options for a single request
 */
export interface DeliveryOptions {
  /** Override Cache-Control header */
  cacheControl?: string
  /** Conditional headers */
  conditionalHeaders?: ConditionalHeaders
  /** Range header value (e.g., 'bytes=0-100') */
  range?: string
  /** Content-Disposition header (for downloads) */
  disposition?: string
  /** Origin header (for CORS) */
  origin?: string
}

/**
 * Cache control generation options
 */
export interface CacheOptions {
  /** Public caching allowed */
  public?: boolean
  /** Private caching only */
  private?: boolean
  /** max-age in seconds */
  maxAge?: number
  /** s-maxage for shared caches (CDN) */
  sMaxAge?: number
  /** Mark as immutable */
  immutable?: boolean
  /** Stale-while-revalidate time */
  staleWhileRevalidate?: number
  /** Stale-if-error time */
  staleIfError?: number
  /** No-cache (revalidate every time) */
  noCache?: boolean
  /** No-store (never cache) */
  noStore?: boolean
}

/**
 * Delivery request interface (minimal Request-like object)
 */
export interface DeliveryRequest {
  method: string
  url: string
  headers: Headers
}

/**
 * Delivery response interface
 */
export interface DeliveryResponse extends Response {}

/**
 * CDN Delivery interface
 */
export interface CDNDelivery {
  /**
   * Deliver a file by key
   * @param key - R2 object key
   * @param options - Delivery options
   */
  deliver(key: string, options?: DeliveryOptions): Promise<Response>

  /**
   * Handle a full HTTP request
   * @param request - HTTP Request object
   */
  handleRequest(request: Request): Promise<Response>
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Creates a CDN delivery instance
 *
 * @param config - CDN delivery configuration
 * @returns CDNDelivery instance
 */
export function createCDNDelivery(config: CDNDeliveryConfig): CDNDelivery {
  const {
    bucket,
    defaultCacheControl = 'public, max-age=86400',
    enableConditionalRequests = true,
    enableRangeRequests = true,
    weakETags = false,
    pathPrefix = '',
    securityHeaders = {},
    cors,
  } = config

  /**
   * Get file key from URL path
   */
  function getKeyFromPath(url: URL): string {
    let path = url.pathname
    if (pathPrefix && path.startsWith(pathPrefix)) {
      path = path.slice(pathPrefix.length)
    }
    // Remove leading slash
    if (path.startsWith('/')) {
      path = path.slice(1)
    }
    return path
  }

  /**
   * Check if ETag matches If-None-Match header
   */
  function matchesETag(objectETag: string, ifNoneMatch: string): boolean {
    // Handle wildcard
    if (ifNoneMatch === '*') {
      return true
    }

    // Parse multiple ETags (comma-separated)
    const requestETags = ifNoneMatch
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)

    // Normalize object ETag (ensure quoted)
    const normalizedObjectETag = objectETag.startsWith('"') ? objectETag : `"${objectETag}"`

    // Check if any match (ignoring weak indicator for comparison)
    for (const requestETag of requestETags) {
      const normalized = requestETag.replace(/^W\//, '')
      if (normalized === normalizedObjectETag || normalized === normalizedObjectETag.replace(/^W\//, '')) {
        return true
      }
    }

    return false
  }

  /**
   * Check if file was modified after If-Modified-Since date
   */
  function isModifiedSince(uploaded: Date, ifModifiedSince: string): boolean {
    try {
      const sinceDate = new Date(ifModifiedSince)
      if (isNaN(sinceDate.getTime())) {
        return true // Invalid date, treat as modified
      }
      // Round to seconds for comparison (HTTP dates have 1-second precision)
      return uploaded.getTime() > sinceDate.getTime()
    } catch {
      return true // On error, treat as modified
    }
  }

  /**
   * Parse Range header
   * Returns { start, end } for valid range, null for invalid syntax, 'invalid' for unsatisfiable
   */
  function parseRange(
    rangeHeader: string,
    size: number
  ): { start: number; end: number } | null | 'invalid_syntax' {
    const match = rangeHeader.match(/^bytes=(-?\d*)-(\d*)$/)
    if (!match) {
      return 'invalid_syntax' // Invalid format, ignore and serve full content
    }

    const [, startStr, endStr] = match
    let start: number
    let end: number

    if (startStr === '') {
      // Suffix range: -500 means last 500 bytes
      const suffix = parseInt(endStr, 10)
      if (isNaN(suffix) || suffix <= 0) return null
      start = Math.max(0, size - suffix)
      end = size - 1
    } else if (endStr === '') {
      // Open-ended: 500- means from byte 500 to end
      start = parseInt(startStr, 10)
      if (isNaN(start) || start < 0) return null
      end = size - 1
    } else {
      start = parseInt(startStr, 10)
      end = parseInt(endStr, 10)
      if (isNaN(start) || isNaN(end) || start < 0) return null
    }

    // Validate range
    if (start > end || start >= size) {
      return null
    }

    // Clamp end to file size
    end = Math.min(end, size - 1)

    return { start, end }
  }

  /**
   * Build response headers with all configured options
   */
  function buildHeaders(
    object: R2Object,
    options: DeliveryOptions = {}
  ): Headers {
    const headers = new Headers()

    // Content-Type from R2 metadata
    const contentType = object.httpMetadata?.contentType || 'application/octet-stream'
    headers.set('Content-Type', contentType)

    // Content-Length
    headers.set('Content-Length', object.size.toString())

    // ETag
    const etag = weakETags ? `W/${object.httpEtag}` : object.httpEtag
    headers.set('ETag', etag)

    // Last-Modified
    headers.set('Last-Modified', object.uploaded.toUTCString())

    // Cache-Control (order of precedence: request option > object > default)
    const cacheControl =
      options.cacheControl ||
      object.httpMetadata?.cacheControl ||
      defaultCacheControl
    headers.set('Cache-Control', cacheControl)

    // Accept-Ranges (if range requests enabled)
    if (enableRangeRequests) {
      headers.set('Accept-Ranges', 'bytes')
    }

    // Content-Disposition (if specified)
    if (options.disposition) {
      headers.set('Content-Disposition', options.disposition)
    } else if (object.httpMetadata?.contentDisposition) {
      headers.set('Content-Disposition', object.httpMetadata.contentDisposition)
    }

    // Security headers
    for (const [name, value] of Object.entries(securityHeaders)) {
      headers.set(name, value)
    }

    // CORS headers
    if (cors && options.origin) {
      const isAllowedOrigin =
        cors.allowOrigins.includes('*') || cors.allowOrigins.includes(options.origin)

      if (isAllowedOrigin) {
        headers.set('Access-Control-Allow-Origin', options.origin)

        if (cors.exposeHeaders?.length) {
          headers.set('Access-Control-Expose-Headers', cors.exposeHeaders.join(', '))
        }
      }
    }

    return headers
  }

  /**
   * Handle CORS preflight request
   */
  function handlePreflight(request: Request): Response | null {
    if (request.method !== 'OPTIONS' || !cors) {
      return null
    }

    const origin = request.headers.get('Origin')
    if (!origin) {
      return null
    }

    const isAllowedOrigin =
      cors.allowOrigins.includes('*') || cors.allowOrigins.includes(origin)

    if (!isAllowedOrigin) {
      return new Response(null, { status: 403 })
    }

    const headers = new Headers()
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', (cors.allowMethods || ['GET', 'HEAD']).join(', '))

    if (cors.maxAge !== undefined) {
      headers.set('Access-Control-Max-Age', cors.maxAge.toString())
    }

    return new Response(null, { status: 204, headers })
  }

  /**
   * Deliver a file by key
   */
  async function deliver(key: string, options: DeliveryOptions = {}): Promise<Response> {
    try {
      // Get object from R2
      const object = await bucket.get(key)

      if (!object) {
        return new Response('Not Found', { status: 404 })
      }

      // Handle conditional requests
      if (enableConditionalRequests && options.conditionalHeaders) {
        const { ifNoneMatch, ifModifiedSince } = options.conditionalHeaders

        // If-None-Match takes precedence
        if (ifNoneMatch && matchesETag(object.httpEtag, ifNoneMatch)) {
          const notModifiedHeaders = buildHeaders(object, options)
          // Remove body-related headers for 304
          notModifiedHeaders.delete('Content-Length')
          return new Response(null, { status: 304, headers: notModifiedHeaders })
        }

        // If-Modified-Since (only if If-None-Match not present or didn't match)
        if (ifModifiedSince && !ifNoneMatch) {
          if (!isModifiedSince(object.uploaded, ifModifiedSince)) {
            const notModifiedHeaders = buildHeaders(object, options)
            notModifiedHeaders.delete('Content-Length')
            return new Response(null, { status: 304, headers: notModifiedHeaders })
          }
        }
      }

      // Handle range requests
      if (enableRangeRequests && options.range) {
        const range = parseRange(options.range, object.size)

        if (range === 'invalid_syntax') {
          // Invalid format - ignore and serve full content
          const headers = buildHeaders(object, options)
          return new Response(object.body, { status: 200, headers })
        }

        if (range === null) {
          // Valid format but unsatisfiable range
          const headers = new Headers()
          headers.set('Content-Range', `bytes */${object.size}`)
          return new Response('Range Not Satisfiable', { status: 416, headers })
        }

        // Get ranged content
        const { start, end } = range
        const length = end - start + 1

        // Read full body and slice
        const fullBody = await object.arrayBuffer()
        const rangedBody = fullBody.slice(start, end + 1)

        const headers = buildHeaders(object, options)
        headers.set('Content-Length', length.toString())
        headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`)

        return new Response(rangedBody, { status: 206, headers })
      }

      // Full response
      const headers = buildHeaders(object, options)
      return new Response(object.body, { status: 200, headers })
    } catch (error) {
      console.error('CDN delivery error:', error)
      return new Response('Internal Server Error', { status: 500 })
    }
  }

  /**
   * Handle a full HTTP request
   */
  async function handleRequest(request: Request): Promise<Response> {
    // Handle CORS preflight
    const preflightResponse = handlePreflight(request)
    if (preflightResponse) {
      return preflightResponse
    }

    // Only allow GET and HEAD
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      })
    }

    const url = new URL(request.url)
    const key = getKeyFromPath(url)

    // Build delivery options from request headers
    const options: DeliveryOptions = {
      conditionalHeaders: {
        ifNoneMatch: request.headers.get('If-None-Match') || undefined,
        ifModifiedSince: request.headers.get('If-Modified-Since') || undefined,
      },
      range: request.headers.get('Range') || undefined,
      origin: request.headers.get('Origin') || undefined,
    }

    // For HEAD requests, we still need to get the object for headers
    if (request.method === 'HEAD') {
      try {
        const object = await bucket.head(key)

        if (!object) {
          return new Response('Not Found', { status: 404 })
        }

        const headers = buildHeaders(object as R2Object, options)
        return new Response(null, { status: 200, headers })
      } catch (error) {
        console.error('CDN HEAD error:', error)
        return new Response('Internal Server Error', { status: 500 })
      }
    }

    return deliver(key, options)
  }

  return {
    deliver,
    handleRequest,
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate an ETag from content hash and size
 *
 * @param hash - Content hash or unique identifier
 * @param size - Content size in bytes
 * @returns ETag string in quoted format
 */
export function generateETag(hash: string, size: number): string {
  // Simple ETag: combine hash and size
  const combined = `${hash}-${size}`
  // Create a simple hash for the ETag
  let hashValue = 0
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i)
    hashValue = ((hashValue << 5) - hashValue) + char
    hashValue = hashValue & hashValue // Convert to 32-bit integer
  }
  return `"${Math.abs(hashValue).toString(16)}"`
}

/**
 * Generate Cache-Control header value from options
 *
 * @param options - Cache options
 * @returns Cache-Control header value
 */
export function generateCacheControl(options: CacheOptions): string {
  const directives: string[] = []

  // Privacy directive
  if (options.noStore) {
    directives.push('no-store')
  } else if (options.noCache) {
    directives.push('no-cache')
  } else if (options.private) {
    directives.push('private')
  } else if (options.public) {
    directives.push('public')
  }

  // Max-age
  if (options.maxAge !== undefined) {
    directives.push(`max-age=${options.maxAge}`)
  }

  // s-maxage (shared cache)
  if (options.sMaxAge !== undefined) {
    directives.push(`s-maxage=${options.sMaxAge}`)
  }

  // Immutable
  if (options.immutable) {
    directives.push('immutable')
  }

  // Stale-while-revalidate
  if (options.staleWhileRevalidate !== undefined) {
    directives.push(`stale-while-revalidate=${options.staleWhileRevalidate}`)
  }

  // Stale-if-error
  if (options.staleIfError !== undefined) {
    directives.push(`stale-if-error=${options.staleIfError}`)
  }

  return directives.join(', ')
}

/**
 * Check if a response is stale based on Cache-Control and Date headers
 *
 * @param headers - Response headers
 * @returns true if response is stale
 */
export function isStaleResponse(headers: Headers): boolean {
  const cacheControl = headers.get('Cache-Control')
  const dateHeader = headers.get('Date')

  if (!cacheControl || !dateHeader) {
    return false // Cannot determine, assume fresh
  }

  // Parse max-age from Cache-Control
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/)
  if (!maxAgeMatch) {
    return false // No max-age, cannot determine
  }

  const maxAge = parseInt(maxAgeMatch[1], 10)
  const responseDate = new Date(dateHeader)

  if (isNaN(responseDate.getTime())) {
    return false // Invalid date
  }

  const age = (Date.now() - responseDate.getTime()) / 1000
  return age > maxAge
}
