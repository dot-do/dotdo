/**
 * @dotdo/rpc - Rate Limiting for RPC Endpoints
 *
 * Provides rate limiting middleware for RPC servers with:
 * - Per-method rate limits
 * - Global rate limits
 * - Sliding window algorithm
 * - Proper RateLimitError responses with headers
 *
 * @module @dotdo/rpc/rate-limit
 * @issue do-dp5q.5 - Add rate limiting to RPC endpoints
 */

import type { Context, MiddlewareHandler, Next } from 'hono'
import { RateLimitError } from './errors'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Rate limit tier configuration
 */
export interface RPCRateLimitTier {
  /** Tier name (e.g., 'free', 'pro', 'enterprise') */
  name: string
  /** Requests allowed per window */
  requestsPerWindow: number
  /** Window duration in milliseconds */
  windowMs: number
  /** Optional burst capacity */
  burstCapacity?: number
}

/**
 * Per-method rate limit configuration
 */
export interface MethodRateLimit {
  /** Requests allowed per window for this method */
  requestsPerWindow: number
  /** Window duration in milliseconds */
  windowMs: number
}

/**
 * RPC Rate limiter configuration
 */
export interface RPCRateLimitConfig {
  /** Global rate limit applied to all methods */
  global?: RPCRateLimitTier
  /** Per-method rate limits (method path -> limits) */
  methods?: Record<string, MethodRateLimit>
  /** Method patterns for grouped limits (glob pattern -> limits) */
  patterns?: Record<string, MethodRateLimit>
  /** Default tier configuration */
  defaultTier?: RPCRateLimitTier
  /** Key extractor function (default: uses X-RPC-Client-ID header or IP) */
  keyExtractor?: (request: Request, method: string) => string
  /** Whether to fail open on rate limit storage errors (default: true) */
  failOpen?: boolean
  /** Skip rate limiting for specific methods */
  skipMethods?: string[]
}

/**
 * Rate limit check result
 */
export interface RPCRateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Remaining requests in current window */
  remaining: number
  /** Total limit for this entity */
  limit: number
  /** When the window resets (Unix timestamp in seconds) */
  resetAt: number
  /** Window duration in milliseconds */
  windowMs: number
  /** Rate limit headers to apply */
  headers: Record<string, string>
  /** Retry after in seconds (only when rate limited) */
  retryAfter?: number
  /** The key used for rate limiting */
  key: string
  /** The method being rate limited */
  method: string
}

/**
 * Sliding window state for rate limiting
 */
interface SlidingWindowState {
  requests: number[] // timestamps of requests in ms
}

// ============================================================================
// DEFAULT TIERS
// ============================================================================

/**
 * Default tier configurations for RPC rate limiting
 */
export const DEFAULT_RPC_TIERS: Record<string, RPCRateLimitTier> = {
  free: {
    name: 'free',
    requestsPerWindow: 100,
    windowMs: 60000, // 1 minute
    burstCapacity: 20,
  },
  pro: {
    name: 'pro',
    requestsPerWindow: 1000,
    windowMs: 60000,
    burstCapacity: 100,
  },
  enterprise: {
    name: 'enterprise',
    requestsPerWindow: 10000,
    windowMs: 60000,
    burstCapacity: 500,
  },
}

// ============================================================================
// RPC RATE LIMITER CLASS
// ============================================================================

/**
 * RPC Rate Limiter using sliding window algorithm
 *
 * Tracks request timestamps per key+method and enforces limits based on:
 * - Global limits (apply to all methods)
 * - Per-method limits (specific method paths)
 * - Pattern-based limits (glob patterns like 'users.*')
 *
 * @issue do-dp5q.5 - Add rate limiting to RPC endpoints
 */
export class RPCRateLimiter {
  private readonly config: Required<
    Pick<RPCRateLimitConfig, 'failOpen' | 'skipMethods'>
  > & RPCRateLimitConfig
  private readonly slidingWindows: Map<string, SlidingWindowState> = new Map()

  constructor(config: RPCRateLimitConfig = {}) {
    this.config = {
      ...config,
      failOpen: config.failOpen ?? true,
      skipMethods: config.skipMethods ?? [],
      defaultTier: config.defaultTier ?? DEFAULT_RPC_TIERS['free'] as RPCRateLimitTier,
    }
  }

  /**
   * Check if a request should be allowed
   */
  check(request: Request, method: string): RPCRateLimitResult {
    // Check if method should skip rate limiting
    if (this.config.skipMethods.includes(method)) {
      return this.createAllowedResult(request, method, Infinity, 60000)
    }

    const key = this.getKey(request, method)
    const limits = this.getLimitsForMethod(method)
    const now = Date.now()

    return this.checkSlidingWindow(key, method, limits, now)
  }

  /**
   * Get the rate limit key for a request
   */
  private getKey(request: Request, method: string): string {
    if (this.config.keyExtractor) {
      return this.config.keyExtractor(request, method)
    }

    // Default key extraction: client ID > IP > anonymous
    const clientId = request.headers.get('X-RPC-Client-ID')
    if (clientId) {
      return `client:${clientId}:${method}`
    }

    const ip = this.extractIP(request)
    return `ip:${ip}:${method}`
  }

  /**
   * Extract IP address from request
   */
  private extractIP(request: Request): string {
    // Cloudflare
    const cfIP = request.headers.get('CF-Connecting-IP')
    if (cfIP) return cfIP

    // Standard headers
    const realIP = request.headers.get('X-Real-IP')
    if (realIP) return realIP

    // X-Forwarded-For (take first IP in chain)
    const forwardedFor = request.headers.get('X-Forwarded-For')
    if (forwardedFor) {
      const firstIP = forwardedFor.split(',')[0]
      return firstIP?.trim() ?? 'unknown'
    }

    return 'unknown'
  }

  /**
   * Get rate limits for a specific method
   * Priority: per-method > pattern > global > default
   */
  private getLimitsForMethod(method: string): MethodRateLimit {
    // Check per-method limits first
    if (this.config.methods?.[method]) {
      return this.config.methods[method]
    }

    // Check pattern-based limits
    if (this.config.patterns) {
      for (const [pattern, limits] of Object.entries(this.config.patterns)) {
        if (this.matchesPattern(method, pattern)) {
          return limits
        }
      }
    }

    // Fall back to global limits
    if (this.config.global) {
      return {
        requestsPerWindow: this.config.global.requestsPerWindow,
        windowMs: this.config.global.windowMs,
      }
    }

    // Use default tier
    const defaultTier = this.config.defaultTier ?? DEFAULT_RPC_TIERS['free']!
    return {
      requestsPerWindow: defaultTier.requestsPerWindow,
      windowMs: defaultTier.windowMs,
    }
  }

  /**
   * Check if a method matches a glob pattern
   */
  private matchesPattern(method: string, pattern: string): boolean {
    if (pattern === method) return true
    if (!pattern.includes('*')) return false

    // Convert glob to regex
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    const regexPattern = escaped.replace(/\*/g, '.*')
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(method)
  }

  /**
   * Check sliding window rate limit
   */
  private checkSlidingWindow(
    key: string,
    method: string,
    limits: MethodRateLimit,
    now: number
  ): RPCRateLimitResult {
    let state = this.slidingWindows.get(key)

    if (!state) {
      state = { requests: [] }
      this.slidingWindows.set(key, state)
    }

    // Remove expired requests (outside the window)
    const cutoff = now - limits.windowMs
    state.requests = state.requests.filter((ts) => ts > cutoff)

    const firstRequest = state.requests[0]
    const windowResetsAt = firstRequest !== undefined
      ? Math.ceil((firstRequest + limits.windowMs) / 1000)
      : Math.ceil((now + limits.windowMs) / 1000)

    // Check if over limit
    if (state.requests.length >= limits.requestsPerWindow) {
      const oldestRequestTime = state.requests[0] ?? now
      const retryAfterMs = oldestRequestTime + limits.windowMs - now
      const retryAfterSec = Math.ceil(retryAfterMs / 1000)

      return {
        allowed: false,
        remaining: 0,
        limit: limits.requestsPerWindow,
        resetAt: windowResetsAt,
        windowMs: limits.windowMs,
        headers: this.buildHeaders(limits.requestsPerWindow, 0, windowResetsAt, retryAfterSec),
        retryAfter: retryAfterSec,
        key,
        method,
      }
    }

    // Add this request
    state.requests.push(now)
    const remaining = Math.max(0, limits.requestsPerWindow - state.requests.length)

    return {
      allowed: true,
      remaining,
      limit: limits.requestsPerWindow,
      resetAt: windowResetsAt,
      windowMs: limits.windowMs,
      headers: this.buildHeaders(limits.requestsPerWindow, remaining, windowResetsAt),
      key,
      method,
    }
  }

  /**
   * Create an allowed result for skipped methods
   */
  private createAllowedResult(
    request: Request,
    method: string,
    limit: number,
    windowMs: number
  ): RPCRateLimitResult {
    const now = Date.now()
    const resetAt = Math.ceil((now + windowMs) / 1000)
    const key = this.getKey(request, method)

    return {
      allowed: true,
      remaining: limit,
      limit,
      resetAt,
      windowMs,
      headers: {},
      key,
      method,
    }
  }

  /**
   * Build rate limit headers
   */
  private buildHeaders(
    limit: number,
    remaining: number,
    resetAt: number,
    retryAfterSec?: number
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(resetAt),
    }

    if (retryAfterSec !== undefined && retryAfterSec > 0) {
      headers['Retry-After'] = String(retryAfterSec)
    }

    return headers
  }

  /**
   * Reset rate limit state for a key
   */
  resetKey(key: string): void {
    this.slidingWindows.delete(key)
  }

  /**
   * Reset all rate limit state for a method (all clients)
   */
  resetMethod(method: string): void {
    for (const key of this.slidingWindows.keys()) {
      if (key.endsWith(`:${method}`)) {
        this.slidingWindows.delete(key)
      }
    }
  }

  /**
   * Reset all rate limit state
   */
  reset(): void {
    this.slidingWindows.clear()
  }

  /**
   * Get current state for a key (for observability)
   */
  getState(key: string): { requests: number; windowMs: number; limit: number } | null {
    const state = this.slidingWindows.get(key)
    if (!state) return null

    // Find the method from the key to get proper limits
    const methodMatch = key.match(/:([^:]+)$/)
    const method = methodMatch?.[1] ?? ''
    const limits = this.getLimitsForMethod(method)

    return {
      requests: state.requests.length,
      windowMs: limits.windowMs,
      limit: limits.requestsPerWindow,
    }
  }
}

// ============================================================================
// HONO MIDDLEWARE FOR RPC
// ============================================================================

/**
 * Create rate limit middleware for RPC servers
 *
 * This middleware should be applied to the /rpc and /rpc/pipeline endpoints
 * to enforce rate limits on RPC method calls.
 *
 * @param config - Rate limit configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { createServer } from '@dotdo/rpc'
 * import { rpcRateLimitMiddleware } from '@dotdo/rpc/rate-limit'
 *
 * const server = createServer({ target: api })
 *
 * // Apply rate limiting before RPC routes
 * server.use('/rpc/*', rpcRateLimitMiddleware({
 *   global: {
 *     name: 'global',
 *     requestsPerWindow: 100,
 *     windowMs: 60000,
 *   },
 *   methods: {
 *     'users.create': { requestsPerWindow: 10, windowMs: 60000 },
 *     'ai.generate': { requestsPerWindow: 5, windowMs: 60000 },
 *   },
 *   patterns: {
 *     'admin.*': { requestsPerWindow: 1000, windowMs: 60000 },
 *   },
 * }))
 * ```
 *
 * @issue do-dp5q.5 - Add rate limiting to RPC endpoints
 */
export function rpcRateLimitMiddleware(config: RPCRateLimitConfig = {}): MiddlewareHandler {
  const rateLimiter = new RPCRateLimiter(config)

  return async (c: Context, next: Next): Promise<Response | void> => {
    // Only apply to POST requests (RPC calls)
    if (c.req.method !== 'POST') {
      return next()
    }

    // Parse the body to get the method name
    // Note: We clone the request to avoid consuming the body
    let method = 'unknown'
    try {
      const body = await c.req.json()
      method = body.method ?? 'unknown'
      // Store parsed body for downstream handlers to avoid re-parsing
      c.set('rpcBody', body)
    } catch {
      // If body parsing fails, continue without rate limiting
      // The RPC handler will return an appropriate error
      return next()
    }

    const result = rateLimiter.check(c.req.raw, method)

    // Set rate limit headers
    for (const [key, value] of Object.entries(result.headers)) {
      c.header(key, value)
    }

    // If rate limited, return 429 response with RateLimitError format
    if (!result.allowed) {
      const windowStr = result.windowMs >= 60000
        ? `${Math.round(result.windowMs / 60000)}m`
        : `${Math.round(result.windowMs / 1000)}s`

      const errorDetails: { limit: number; window: string; method: string; retryAfter?: number } = {
        limit: result.limit,
        window: windowStr,
        method: result.method,
      }
      if (result.retryAfter !== undefined) {
        errorDetails.retryAfter = result.retryAfter
      }

      const rateLimitError = RateLimitError.exceeded(errorDetails)
      return c.json(rateLimitError.toJSON(), rateLimitError.httpStatus as 429)
    }

    // Store rate limit info in context for downstream use
    c.set('rateLimit', {
      allowed: result.allowed,
      remaining: result.remaining,
      limit: result.limit,
      resetAt: result.resetAt,
      key: result.key,
      method: result.method,
    })

    // Continue to next middleware/handler
    await next()
  }
}

/**
 * Create a rate limiter instance for use outside middleware
 */
export function createRPCRateLimiter(config: RPCRateLimitConfig = {}): RPCRateLimiter {
  return new RPCRateLimiter(config)
}

export default rpcRateLimitMiddleware
