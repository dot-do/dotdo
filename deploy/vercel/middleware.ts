/**
 * Vercel Edge Middleware
 *
 * Request preprocessing middleware for DO edge routing.
 * Handles CORS, authentication, rate limiting, and logging.
 *
 * @module deploy/vercel/middleware
 *
 * @example
 * ```typescript
 * import { edgeRouter, corsMiddleware, loggingMiddleware } from 'dotdo/deploy/vercel'
 *
 * export default edgeRouter({
 *   classes: { Business },
 *   middleware: [
 *     corsMiddleware({ origins: ['https://app.example.com'] }),
 *     loggingMiddleware(),
 *   ],
 * })
 * ```
 */

import type { VercelEnv } from './env.d'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Middleware context passed through the chain
 */
export interface MiddlewareContext {
  /** Original request */
  request: Request
  /** Environment variables */
  env: VercelEnv
  /** DO identifier */
  doId: string
  /** DO type */
  doType: string
  /** Remaining path after DO ID extraction */
  remainingPath: string
  /** Request start time */
  startTime: number
  /** Custom properties set by middleware */
  [key: string]: unknown
}

/**
 * Middleware function signature
 */
export type MiddlewareFunction = (
  ctx: MiddlewareContext,
  next: () => Promise<Response>
) => Promise<Response>

// ============================================================================
// MIDDLEWARE CHAIN
// ============================================================================

/**
 * Create a middleware chain executor
 */
export function createMiddlewareChain(
  middlewares: MiddlewareFunction[]
): (ctx: MiddlewareContext, handler: () => Promise<Response>) => Promise<Response> {
  return async (ctx, handler) => {
    let index = -1

    const dispatch = async (i: number): Promise<Response> => {
      if (i <= index) {
        throw new Error('next() called multiple times')
      }
      index = i

      if (i < middlewares.length) {
        const middleware = middlewares[i]
        return middleware(ctx, () => dispatch(i + 1))
      }

      return handler()
    }

    return dispatch(0)
  }
}

// ============================================================================
// CORS MIDDLEWARE
// ============================================================================

/**
 * CORS middleware options
 */
export interface CorsOptions {
  /** Allowed origins (default: ['*']) */
  origins?: string[]
  /** Allowed methods (default: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) */
  methods?: string[]
  /** Allowed headers */
  allowedHeaders?: string[]
  /** Exposed headers */
  exposedHeaders?: string[]
  /** Allow credentials */
  credentials?: boolean
  /** Max age for preflight cache */
  maxAge?: number
}

/**
 * Create CORS middleware
 */
export function corsMiddleware(options: CorsOptions = {}): MiddlewareFunction {
  const {
    origins = ['*'],
    methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders = ['Content-Type', 'Authorization', 'X-DO-ID', 'X-DO-Type'],
    exposedHeaders = ['X-Response-Time', 'X-Request-ID'],
    credentials = false,
    maxAge = 86400,
  } = options

  return async (ctx, next) => {
    const origin = ctx.request.headers.get('Origin')

    // Check if origin is allowed
    const isAllowed = origins.includes('*') || (origin && origins.includes(origin))

    // Handle preflight
    if (ctx.request.method === 'OPTIONS') {
      const headers = new Headers()

      if (isAllowed) {
        headers.set('Access-Control-Allow-Origin', origin || '*')
        headers.set('Access-Control-Allow-Methods', methods.join(', '))
        headers.set('Access-Control-Allow-Headers', allowedHeaders.join(', '))
        headers.set('Access-Control-Max-Age', maxAge.toString())

        if (credentials) {
          headers.set('Access-Control-Allow-Credentials', 'true')
        }
      }

      return new Response(null, { status: 204, headers })
    }

    // Execute next middleware
    const response = await next()

    // Add CORS headers to response
    if (isAllowed) {
      const headers = new Headers(response.headers)
      headers.set('Access-Control-Allow-Origin', origin || '*')

      if (credentials) {
        headers.set('Access-Control-Allow-Credentials', 'true')
      }

      if (exposedHeaders.length > 0) {
        headers.set('Access-Control-Expose-Headers', exposedHeaders.join(', '))
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    return response
  }
}

// ============================================================================
// LOGGING MIDDLEWARE
// ============================================================================

/**
 * Logging middleware options
 */
export interface LoggingOptions {
  /** Include request body in logs */
  includeBody?: boolean
  /** Include response body in logs */
  includeResponseBody?: boolean
  /** Custom log formatter */
  formatter?: (entry: LogEntry) => string
}

/**
 * Log entry
 */
export interface LogEntry {
  timestamp: string
  method: string
  path: string
  doId: string
  doType: string
  status: number
  duration: number
  requestId?: string
  error?: string
}

/**
 * Create logging middleware
 */
export function loggingMiddleware(options: LoggingOptions = {}): MiddlewareFunction {
  const { formatter = defaultLogFormatter } = options

  return async (ctx, next) => {
    const requestId = crypto.randomUUID()

    try {
      const response = await next()
      const duration = Date.now() - ctx.startTime

      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        method: ctx.request.method,
        path: new URL(ctx.request.url).pathname,
        doId: ctx.doId,
        doType: ctx.doType,
        status: response.status,
        duration,
        requestId,
      }

      console.log(formatter(entry))

      // Add request ID to response
      const headers = new Headers(response.headers)
      headers.set('X-Request-ID', requestId)

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    } catch (error) {
      const duration = Date.now() - ctx.startTime

      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        method: ctx.request.method,
        path: new URL(ctx.request.url).pathname,
        doId: ctx.doId,
        doType: ctx.doType,
        status: 500,
        duration,
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }

      console.error(formatter(entry))
      throw error
    }
  }
}

/**
 * Default log formatter
 */
function defaultLogFormatter(entry: LogEntry): string {
  const status = entry.status >= 400 ? `[${entry.status}]` : entry.status.toString()
  return `${entry.timestamp} ${entry.method} ${entry.path} -> ${entry.doType}/${entry.doId} ${status} ${entry.duration}ms`
}

// ============================================================================
// RATE LIMITING MIDDLEWARE
// ============================================================================

/**
 * Rate limit options
 */
export interface RateLimitOptions {
  /** Maximum requests per window */
  limit: number
  /** Window size in milliseconds */
  window: number
  /** Key extractor (default: IP address) */
  keyExtractor?: (ctx: MiddlewareContext) => string
  /** Rate limit exceeded handler */
  onLimitExceeded?: (ctx: MiddlewareContext, resetTime: number) => Response
}

// In-memory rate limit store (per edge instance)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

/**
 * Create rate limiting middleware
 *
 * Note: This is per-edge-instance rate limiting. For global rate limiting,
 * use a distributed store like Redis or libSQL.
 */
export function rateLimitMiddleware(options: RateLimitOptions): MiddlewareFunction {
  const {
    limit,
    window,
    keyExtractor = defaultKeyExtractor,
    onLimitExceeded = defaultLimitExceededHandler,
  } = options

  return async (ctx, next) => {
    const key = keyExtractor(ctx)
    const now = Date.now()

    // Clean up expired entries periodically
    if (Math.random() < 0.01) {
      for (const [k, v] of rateLimitStore) {
        if (v.resetAt < now) {
          rateLimitStore.delete(k)
        }
      }
    }

    // Get or create rate limit entry
    let entry = rateLimitStore.get(key)

    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + window }
      rateLimitStore.set(key, entry)
    }

    // Check limit
    if (entry.count >= limit) {
      return onLimitExceeded(ctx, entry.resetAt)
    }

    // Increment count
    entry.count++

    // Execute next middleware
    const response = await next()

    // Add rate limit headers
    const headers = new Headers(response.headers)
    headers.set('X-RateLimit-Limit', limit.toString())
    headers.set('X-RateLimit-Remaining', Math.max(0, limit - entry.count).toString())
    headers.set('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000).toString())

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

/**
 * Default key extractor (IP address or DO ID)
 */
function defaultKeyExtractor(ctx: MiddlewareContext): string {
  const ip = ctx.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || ctx.request.headers.get('x-real-ip')
    || 'unknown'
  return `${ip}:${ctx.doId}`
}

/**
 * Default rate limit exceeded handler
 */
function defaultLimitExceededHandler(ctx: MiddlewareContext, resetTime: number): Response {
  return new Response(JSON.stringify({
    error: 'Rate limit exceeded',
    retryAfter: Math.ceil((resetTime - Date.now()) / 1000),
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': Math.ceil((resetTime - Date.now()) / 1000).toString(),
    },
  })
}

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

/**
 * Auth middleware options
 */
export interface AuthOptions {
  /** Header name for token (default: 'Authorization') */
  header?: string
  /** Token prefix (default: 'Bearer') */
  prefix?: string
  /** Token validator function */
  validate: (token: string, ctx: MiddlewareContext) => Promise<AuthResult>
  /** Paths to skip authentication */
  skipPaths?: string[]
  /** Allow unauthenticated requests (add user info if token present) */
  optional?: boolean
}

/**
 * Auth result
 */
export interface AuthResult {
  valid: boolean
  user?: Record<string, unknown>
  error?: string
}

/**
 * Create authentication middleware
 */
export function authMiddleware(options: AuthOptions): MiddlewareFunction {
  const {
    header = 'Authorization',
    prefix = 'Bearer',
    validate,
    skipPaths = [],
    optional = false,
  } = options

  return async (ctx, next) => {
    // Check if path should skip auth
    const path = new URL(ctx.request.url).pathname
    if (skipPaths.some(p => path.startsWith(p))) {
      return next()
    }

    // Get token from header
    const authHeader = ctx.request.headers.get(header)
    let token: string | null = null

    if (authHeader) {
      if (prefix) {
        if (authHeader.startsWith(`${prefix} `)) {
          token = authHeader.slice(prefix.length + 1)
        }
      } else {
        token = authHeader
      }
    }

    // No token
    if (!token) {
      if (optional) {
        return next()
      }

      return new Response(JSON.stringify({
        error: 'Authentication required',
      }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `${prefix} realm="DO API"`,
        },
      })
    }

    // Validate token
    const result = await validate(token, ctx)

    if (!result.valid) {
      return new Response(JSON.stringify({
        error: result.error || 'Invalid token',
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Add user to context
    if (result.user) {
      ctx.user = result.user
    }

    return next()
  }
}

// ============================================================================
// REQUEST ID MIDDLEWARE
// ============================================================================

/**
 * Create request ID middleware
 * Adds a unique request ID to all requests
 */
export function requestIdMiddleware(): MiddlewareFunction {
  return async (ctx, next) => {
    const requestId = ctx.request.headers.get('X-Request-ID') || crypto.randomUUID()
    ctx.requestId = requestId

    const response = await next()

    const headers = new Headers(response.headers)
    headers.set('X-Request-ID', requestId)

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

// ============================================================================
// COMPRESSION MIDDLEWARE
// ============================================================================

/**
 * Compression middleware options
 */
export interface CompressionOptions {
  /** Minimum size to compress (default: 1024) */
  threshold?: number
  /** Compression level (default: 'default') */
  level?: 'default' | 'best-compression' | 'best-speed'
}

/**
 * Create compression middleware
 * Note: Vercel Edge Functions automatically handle compression,
 * but this can be used for explicit control
 */
export function compressionMiddleware(options: CompressionOptions = {}): MiddlewareFunction {
  const { threshold = 1024 } = options

  return async (ctx, next) => {
    const response = await next()

    // Skip if already compressed or no body
    if (
      response.headers.get('Content-Encoding') ||
      !response.body
    ) {
      return response
    }

    // Check Accept-Encoding
    const acceptEncoding = ctx.request.headers.get('Accept-Encoding') || ''
    const supportsGzip = acceptEncoding.includes('gzip')

    if (!supportsGzip) {
      return response
    }

    // Check content length
    const contentLength = response.headers.get('Content-Length')
    if (contentLength && parseInt(contentLength, 10) < threshold) {
      return response
    }

    // Compress with CompressionStream (Web Streams API)
    const compressionStream = new CompressionStream('gzip')
    const compressedBody = response.body.pipeThrough(compressionStream)

    const headers = new Headers(response.headers)
    headers.set('Content-Encoding', 'gzip')
    headers.delete('Content-Length') // Length changes after compression

    return new Response(compressedBody, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

// ============================================================================
// CACHE MIDDLEWARE
// ============================================================================

/**
 * Cache middleware options
 */
export interface CacheOptions {
  /** Cache duration in seconds (default: 60) */
  maxAge?: number
  /** Stale while revalidate duration */
  staleWhileRevalidate?: number
  /** Methods to cache (default: ['GET', 'HEAD']) */
  methods?: string[]
  /** Paths to cache (default: all) */
  paths?: string[]
  /** Cache key generator */
  keyGenerator?: (ctx: MiddlewareContext) => string
}

/**
 * Create cache control middleware
 * Sets Cache-Control headers for edge caching
 */
export function cacheMiddleware(options: CacheOptions = {}): MiddlewareFunction {
  const {
    maxAge = 60,
    staleWhileRevalidate,
    methods = ['GET', 'HEAD'],
    paths,
  } = options

  return async (ctx, next) => {
    // Only cache specified methods
    if (!methods.includes(ctx.request.method)) {
      return next()
    }

    // Check path filter
    if (paths) {
      const pathname = new URL(ctx.request.url).pathname
      if (!paths.some(p => pathname.startsWith(p))) {
        return next()
      }
    }

    const response = await next()

    // Don't cache error responses
    if (response.status >= 400) {
      return response
    }

    // Don't override existing Cache-Control
    if (response.headers.has('Cache-Control')) {
      return response
    }

    // Build Cache-Control header
    const directives = [`max-age=${maxAge}`]
    if (staleWhileRevalidate) {
      directives.push(`stale-while-revalidate=${staleWhileRevalidate}`)
    }

    const headers = new Headers(response.headers)
    headers.set('Cache-Control', directives.join(', '))

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  createMiddlewareChain as default,
}
