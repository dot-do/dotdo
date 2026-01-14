/**
 * Hono Security Middleware
 *
 * Provides security middleware for Hono applications:
 * - Rate limiting
 * - Request size limiting
 * - CSRF protection
 * - Input validation
 * - Security headers
 *
 * @module lib/security/middleware
 */

import type { MiddlewareHandler, Context } from 'hono'
import { RateLimiter, createRateLimiter, type RateLimitConfig } from './rate-limiter'
import { RequestLimiter } from './request-limiter'
import { ObjectSanitizer } from './sanitizers'
import { HeaderValidator } from './validators'
import { SecurityEventEmitter, SecurityEventType, securityEvents } from './events'
import { rateLimitMetrics } from './metrics'

// ============================================================================
// TYPES
// ============================================================================

export interface SecurityMiddlewareOptions {
  /** Rate limit configuration */
  rateLimit?: RateLimitConfig | 'strict' | 'standard' | 'relaxed' | false
  /** Maximum request body size in bytes */
  maxBodySize?: number
  /** Maximum JSON nesting depth */
  maxJsonDepth?: number
  /** Enable CSRF protection */
  csrf?: boolean
  /** Enable security headers */
  securityHeaders?: boolean
  /** Enable prototype pollution protection */
  prototypePollutionProtection?: boolean
  /** Custom security event emitter */
  eventEmitter?: SecurityEventEmitter
  /** Skip security for specific paths */
  skipPaths?: string[]
  /** IP header name (for proxied requests) */
  ipHeader?: string
}

export interface RateLimitInfo {
  limit: number
  remaining: number
  resetAt: number
}

// ============================================================================
// RATE LIMIT MIDDLEWARE
// ============================================================================

/**
 * Create rate limiting middleware for Hono
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { rateLimitMiddleware } from './lib/security/middleware'
 *
 * const app = new Hono()
 * app.use('*', rateLimitMiddleware({ requests: 100, windowSeconds: 60 }))
 * ```
 */
export function rateLimitMiddleware(
  config: RateLimitConfig | 'strict' | 'standard' | 'relaxed',
  options?: {
    keyGenerator?: (c: Context) => string
    onRateLimited?: (c: Context, info: RateLimitInfo) => Response | Promise<Response>
    eventEmitter?: SecurityEventEmitter
    ipHeader?: string
  }
): MiddlewareHandler {
  const limiter = createRateLimiter(config, options?.eventEmitter ?? securityEvents)
  const ipHeader = options?.ipHeader ?? 'cf-connecting-ip'

  return async (c, next) => {
    // Generate rate limit key
    const key = options?.keyGenerator
      ? options.keyGenerator(c)
      : getClientIp(c, ipHeader)

    // Check rate limit
    const result = limiter.check(key)

    // Record metrics
    rateLimitMetrics.record(key, { allowed: result.allowed, remaining: result.remaining })

    // Set rate limit headers
    c.header('X-RateLimit-Limit', String(result.limit))
    c.header('X-RateLimit-Remaining', String(result.remaining))
    c.header('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)))

    if (!result.allowed) {
      // Custom handler or default response
      if (options?.onRateLimited) {
        return options.onRateLimited(c, {
          limit: result.limit,
          remaining: result.remaining,
          resetAt: result.resetAt,
        })
      }

      c.header('Retry-After', String(Math.ceil((result.resetAt - Date.now()) / 1000)))
      return c.json(
        {
          error: 'Too many requests',
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
        },
        429
      )
    }

    await next()
  }
}

// ============================================================================
// REQUEST SIZE MIDDLEWARE
// ============================================================================

/**
 * Create request size limiting middleware
 *
 * @example
 * ```typescript
 * app.use('*', requestSizeMiddleware({ maxBodySize: 1024 * 1024 }))
 * ```
 */
export function requestSizeMiddleware(options?: {
  maxBodySize?: number
  maxJsonDepth?: number
  eventEmitter?: SecurityEventEmitter
}): MiddlewareHandler {
  const maxBodySize = options?.maxBodySize ?? RequestLimiter.MAX_BODY_SIZE
  const maxJsonDepth = options?.maxJsonDepth ?? RequestLimiter.MAX_JSON_DEPTH
  const emitter = options?.eventEmitter ?? securityEvents

  return async (c, next) => {
    const contentLength = c.req.header('content-length')

    // Check Content-Length header first
    if (contentLength && parseInt(contentLength, 10) > maxBodySize) {
      emitter.emit({
        type: SecurityEventType.OVERSIZED_REQUEST,
        timestamp: Date.now(),
        ip: getClientIp(c),
        path: c.req.path,
        method: c.req.method,
        details: {
          contentLength: parseInt(contentLength, 10),
          maxBodySize,
        },
      })

      return c.json(
        { error: 'Request body too large' },
        413
      )
    }

    // For JSON requests, validate depth after parsing
    const contentType = c.req.header('content-type') ?? ''
    if (contentType.includes('application/json')) {
      try {
        const body = await c.req.text()

        // Check actual body size
        RequestLimiter.checkBodySize(body, maxBodySize)

        // Parse and check depth
        const parsed = JSON.parse(body)
        RequestLimiter.checkJsonDepth(parsed, maxJsonDepth)

        // Store parsed body for later use
        c.set('parsedBody', parsed)
      } catch (error) {
        const message = (error as Error).message

        if (message.includes('too large') || message.includes('deeply nested')) {
          emitter.emit({
            type: SecurityEventType.OVERSIZED_REQUEST,
            timestamp: Date.now(),
            ip: getClientIp(c),
            path: c.req.path,
            method: c.req.method,
            details: { error: message },
          })

          return c.json({ error: message }, 413)
        }

        return c.json({ error: 'Invalid JSON' }, 400)
      }
    }

    await next()
  }
}

// ============================================================================
// SECURITY HEADERS MIDDLEWARE
// ============================================================================

/**
 * Create security headers middleware
 *
 * Sets common security headers:
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: DENY
 * - X-XSS-Protection: 1; mode=block
 * - Referrer-Policy: strict-origin-when-cross-origin
 * - Content-Security-Policy (configurable)
 *
 * @example
 * ```typescript
 * app.use('*', securityHeadersMiddleware())
 * ```
 */
export function securityHeadersMiddleware(options?: {
  contentSecurityPolicy?: string | false
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false
  referrerPolicy?: string | false
}): MiddlewareHandler {
  return async (c, next) => {
    await next()

    // Prevent MIME type sniffing
    c.header('X-Content-Type-Options', 'nosniff')

    // XSS protection (legacy, but still useful)
    c.header('X-XSS-Protection', '1; mode=block')

    // Frame options
    if (options?.frameOptions !== false) {
      c.header('X-Frame-Options', options?.frameOptions ?? 'DENY')
    }

    // Referrer policy
    if (options?.referrerPolicy !== false) {
      c.header('Referrer-Policy', options?.referrerPolicy ?? 'strict-origin-when-cross-origin')
    }

    // CSP
    if (options?.contentSecurityPolicy !== false) {
      c.header(
        'Content-Security-Policy',
        options?.contentSecurityPolicy ?? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
      )
    }
  }
}

// ============================================================================
// PROTOTYPE POLLUTION MIDDLEWARE
// ============================================================================

/**
 * Create prototype pollution protection middleware
 *
 * Checks JSON bodies for dangerous keys and either rejects or sanitizes them.
 *
 * @example
 * ```typescript
 * app.use('*', prototypePollutionMiddleware())
 * ```
 */
export function prototypePollutionMiddleware(options?: {
  mode?: 'reject' | 'sanitize'
  eventEmitter?: SecurityEventEmitter
}): MiddlewareHandler {
  const mode = options?.mode ?? 'reject'
  const emitter = options?.eventEmitter ?? securityEvents

  return async (c, next) => {
    // Only check JSON requests with bodies
    const contentType = c.req.header('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      return next()
    }

    // Get parsed body (from requestSizeMiddleware or parse it)
    let body = c.get('parsedBody')
    if (!body) {
      try {
        body = await c.req.json()
      } catch {
        return next()
      }
    }

    // Check for dangerous keys
    if (ObjectSanitizer.hasDangerousKeys(body)) {
      emitter.emit({
        type: SecurityEventType.SUSPICIOUS_ACTIVITY,
        timestamp: Date.now(),
        ip: getClientIp(c),
        path: c.req.path,
        method: c.req.method,
        details: { reason: 'prototype_pollution_attempt' },
      })

      if (mode === 'reject') {
        return c.json(
          { error: 'Request contains invalid keys' },
          400
        )
      }

      // Sanitize mode - store sanitized body
      c.set('parsedBody', ObjectSanitizer.sanitize(body))
    }

    await next()
  }
}

// ============================================================================
// COMBINED SECURITY MIDDLEWARE
// ============================================================================

/**
 * Create combined security middleware with all protections
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { securityMiddleware } from './lib/security/middleware'
 *
 * const app = new Hono()
 * app.use('*', securityMiddleware({
 *   rateLimit: 'standard',
 *   maxBodySize: 1024 * 1024,
 *   securityHeaders: true,
 * }))
 * ```
 */
export function securityMiddleware(options?: SecurityMiddlewareOptions): MiddlewareHandler {
  const emitter = options?.eventEmitter ?? securityEvents
  const skipPaths = new Set(options?.skipPaths ?? [])

  // Create individual middleware
  const middlewares: MiddlewareHandler[] = []

  // Rate limiting
  if (options?.rateLimit !== false) {
    const config = options?.rateLimit ?? 'standard'
    middlewares.push(rateLimitMiddleware(config, {
      eventEmitter: emitter,
      ipHeader: options?.ipHeader,
    }))
  }

  // Request size limiting
  if (options?.maxBodySize || options?.maxJsonDepth) {
    middlewares.push(requestSizeMiddleware({
      maxBodySize: options?.maxBodySize,
      maxJsonDepth: options?.maxJsonDepth,
      eventEmitter: emitter,
    }))
  }

  // Prototype pollution protection
  if (options?.prototypePollutionProtection !== false) {
    middlewares.push(prototypePollutionMiddleware({ eventEmitter: emitter }))
  }

  // Security headers
  if (options?.securityHeaders !== false) {
    middlewares.push(securityHeadersMiddleware())
  }

  // Combined middleware
  return async (c, next) => {
    // Skip security for certain paths
    if (skipPaths.has(c.req.path)) {
      return next()
    }

    // Run each middleware in sequence
    let index = 0
    const runNext = async () => {
      if (index < middlewares.length) {
        const middleware = middlewares[index++]
        await middleware(c, runNext)
      } else {
        await next()
      }
    }

    await runNext()
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get client IP from request
 */
function getClientIp(c: Context, ipHeader?: string): string {
  // Try custom header first (e.g., cf-connecting-ip for Cloudflare)
  if (ipHeader) {
    const headerValue = c.req.header(ipHeader)
    if (headerValue) return headerValue
  }

  // Try common headers
  const forwardedFor = c.req.header('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }

  const realIp = c.req.header('x-real-ip')
  if (realIp) return realIp

  // Fall back to connection info (may not be available in all environments)
  return 'unknown'
}

/**
 * Validate and sanitize a redirect URL from request
 */
export function validateRedirect(url: string, allowedOrigins?: string[]): string | null {
  try {
    HeaderValidator.validateRedirectUrl(url)

    // If allowed origins specified, check against them
    if (allowedOrigins && allowedOrigins.length > 0) {
      const parsed = new URL(url, 'http://localhost')

      // Allow relative URLs
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return url
      }

      // Check origin
      if (!allowedOrigins.includes(parsed.origin)) {
        return null
      }
    }

    return url
  } catch {
    return null
  }
}
