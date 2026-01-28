/**
 * @dotdo/api v4 - HTTP routes and auth middleware
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { MiddlewareHandler } from 'hono'

// ============================================================================
// API Factory
// ============================================================================

export interface APIOptions {
  /** Enable CORS */
  cors?: boolean
  /** Enable request logging */
  logging?: boolean
  /** Custom error handler */
  onError?: (error: Error) => Response
}

export function createAPI(options: APIOptions = {}): Hono {
  const app = new Hono()

  // Middleware
  if (options.cors !== false) {
    app.use('*', cors())
  }

  if (options.logging) {
    app.use('*', logger())
  }

  // Error handling
  app.onError((error, c) => {
    console.error('API Error:', error)

    if (options.onError) {
      return options.onError(error)
    }

    return c.json(
      {
        error: error.name,
        message: error.message,
      },
      500
    )
  })

  return app
}

// ============================================================================
// Auth Middleware
// ============================================================================

export interface AuthContext {
  userId?: string
  orgId?: string
  roles?: string[]
  token?: string
}

export interface AuthOptions {
  /** Header name for auth token */
  header?: string
  /** Token validation function */
  validate: (token: string) => Promise<AuthContext | null>
  /** Allow unauthenticated requests */
  optional?: boolean
}

export function auth(options: AuthOptions): MiddlewareHandler {
  const headerName = options.header ?? 'Authorization'

  return async (c, next) => {
    const authHeader = c.req.header(headerName)

    if (!authHeader) {
      if (options.optional) {
        c.set('auth', {} as AuthContext)
        return next()
      }
      return c.json({ error: 'Unauthorized', message: 'Missing authorization header' }, 401)
    }

    // Extract token (Bearer or raw)
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader

    try {
      const context = await options.validate(token)

      if (!context) {
        return c.json({ error: 'Unauthorized', message: 'Invalid token' }, 401)
      }

      c.set('auth', context)
      return next()
    } catch (error) {
      return c.json({ error: 'Unauthorized', message: 'Token validation failed' }, 401)
    }
  }
}

/**
 * Get auth context from request
 */
export function getAuth(c: { get: (key: string) => unknown }): AuthContext {
  return (c.get('auth') as AuthContext) ?? {}
}

/**
 * Require specific role
 */
export function requireRole(role: string): MiddlewareHandler {
  return async (c, next) => {
    const authContext = getAuth(c)

    if (!authContext.roles?.includes(role)) {
      return c.json(
        {
          error: 'Forbidden',
          message: `Role '${role}' required`,
        },
        403
      )
    }

    return next()
  }
}

// ============================================================================
// Rate Limiting
// ============================================================================

export interface RateLimitOptions {
  /** Max requests per window */
  max: number
  /** Window size in ms */
  windowMs: number
  /** Key function (default: IP) */
  keyFn?: (c: { req: { header: (name: string) => string | undefined } }) => string
  /** Storage for rate limit data */
  store?: RateLimitStore
}

export interface RateLimitStore {
  get(key: string): Promise<number>
  set(key: string, value: number, ttlMs: number): Promise<void>
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const keyFn = options.keyFn ?? ((c) => c.req.header('CF-Connecting-IP') ?? 'unknown')

  // In-memory store (for single-worker, use KV for distributed)
  const memoryStore = new Map<string, { count: number; expires: number }>()

  return async (c, next) => {
    const key = `ratelimit:${keyFn(c)}`
    const now = Date.now()

    let entry = memoryStore.get(key)

    if (!entry || entry.expires < now) {
      entry = { count: 0, expires: now + options.windowMs }
    }

    entry.count++
    memoryStore.set(key, entry)

    // Set rate limit headers
    c.res.headers.set('X-RateLimit-Limit', String(options.max))
    c.res.headers.set('X-RateLimit-Remaining', String(Math.max(0, options.max - entry.count)))
    c.res.headers.set('X-RateLimit-Reset', String(Math.ceil(entry.expires / 1000)))

    if (entry.count > options.max) {
      return c.json(
        {
          error: 'Too Many Requests',
          message: 'Rate limit exceeded',
          retryAfter: Math.ceil((entry.expires - now) / 1000),
        },
        429
      )
    }

    return next()
  }
}

// ============================================================================
// Request ID
// ============================================================================

export function requestId(): MiddlewareHandler {
  return async (c, next) => {
    const id = c.req.header('X-Request-ID') ?? crypto.randomUUID()
    c.set('requestId', id)
    c.res.headers.set('X-Request-ID', id)
    return next()
  }
}

// ============================================================================
// Response Helpers
// ============================================================================

export function jsonResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function errorResponse(error: string, message: string, status = 400): Response {
  return jsonResponse({ error, message }, status)
}

// ============================================================================
// Re-exports
// ============================================================================

export { Hono } from 'hono'
export { cors } from 'hono/cors'
export { logger } from 'hono/logger'
export type { Context, MiddlewareHandler } from 'hono'
