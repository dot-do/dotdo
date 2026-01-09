/**
 * Rate Limit Middleware for Hono
 *
 * Integrates Cloudflare Rate Limit bindings with Hono middleware.
 *
 * Usage:
 * ```typescript
 * import { rateLimitMiddleware } from './middleware/rate-limit'
 *
 * app.use('/api/*', rateLimitMiddleware({
 *   binding: env.RATE_LIMIT_API,
 *   keyGenerator: (c) => c.req.header('X-User-ID') || 'anonymous',
 *   limit: 100,  // Optional: for header display
 * }))
 * ```
 */

import type { Context, MiddlewareHandler, Next } from 'hono'
import type { RateLimitBinding } from '../../lib/rate-limit'

/**
 * Configuration for the rate limit middleware
 */
export interface RateLimitMiddlewareConfig {
  /**
   * The Cloudflare Rate Limit binding
   */
  binding: RateLimitBinding

  /**
   * Function to generate the rate limit key from the request context.
   * Defaults to using the X-User-ID header or 'anonymous'.
   */
  keyGenerator?: (c: Context) => string

  /**
   * The rate limit value (for header display).
   * This should match the limit configured in wrangler.toml.
   * Defaults to 100.
   */
  limit?: number

  /**
   * Custom error response generator.
   * Defaults to returning a JSON error with 429 status.
   */
  onRateLimited?: (c: Context, remaining: number) => Response | Promise<Response>
}

/**
 * Default key generator - uses X-User-ID header or falls back to 'anonymous'
 */
function defaultKeyGenerator(c: Context): string {
  return c.req.header('X-User-ID') || 'anonymous'
}

/**
 * Creates a rate limit middleware using Cloudflare's Rate Limit binding.
 *
 * @param config - Configuration options for the middleware
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * app.use('/api/*', rateLimitMiddleware({
 *   binding: env.RATE_LIMIT_API,
 * }))
 *
 * // Custom key generator based on IP
 * app.use('/api/*', rateLimitMiddleware({
 *   binding: env.RATE_LIMIT_API,
 *   keyGenerator: (c) => c.req.header('CF-Connecting-IP') || 'unknown',
 *   limit: 1000,
 * }))
 *
 * // Custom rate limited response
 * app.use('/api/*', rateLimitMiddleware({
 *   binding: env.RATE_LIMIT_API,
 *   onRateLimited: (c, remaining) => c.text('Too many requests', 429),
 * }))
 * ```
 */
export function rateLimitMiddleware(config: RateLimitMiddlewareConfig): MiddlewareHandler {
  const { binding, keyGenerator = defaultKeyGenerator, limit = 100, onRateLimited } = config

  return async (c: Context, next: Next): Promise<Response | void> => {
    // Generate the rate limit key
    const key = keyGenerator(c)

    // Check the rate limit
    const result = await binding.limit({ key })

    // Set rate limit headers
    c.header('X-RateLimit-Limit', String(limit))
    c.header('X-RateLimit-Remaining', String(result.remaining))

    // If rate limited, return 429 response
    if (!result.success) {
      if (onRateLimited) {
        return onRateLimited(c, result.remaining)
      }

      return c.json(
        {
          error: 'Too many requests - rate limit exceeded',
          remaining: result.remaining,
        },
        429,
      )
    }

    // Store rate limit info in context for downstream use
    c.set('rateLimit', {
      success: result.success,
      remaining: result.remaining,
      limit,
    })

    // Continue to next middleware/handler
    await next()
  }
}

export default rateLimitMiddleware
