/**
 * HTTP Query Endpoint Rate Limiter
 *
 * Token bucket rate limiter for HTTP query endpoints:
 * - /query (main query endpoint)
 * - /query/unified (unified query endpoint)
 * - /query/trace (trace query endpoint)
 * - /query/session (session query endpoint)
 *
 * Features:
 * - Per-IP rate limiting
 * - Per-tenant rate limiting
 * - Combined IP+tenant or IP+endpoint limiting
 * - Sliding and fixed window support
 * - Burst allowance with token bucket refill
 * - Proper rate limit headers
 *
 * @module api/middleware/query-rate-limit
 * @issue do-9ry0 - Add rate limiting to HTTP query endpoints
 */

import type { Context, MiddlewareHandler, Next } from 'hono'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for the HTTP rate limiter
 */
export interface HTTPRateLimitConfig {
  /** Number of requests allowed per window */
  requestsPerWindow: number
  /** Window duration in milliseconds */
  windowMs: number
  /** Key generation strategy */
  keyStrategy?: 'ip' | 'tenant' | 'ip+tenant' | 'ip+endpoint'
  /** Window strategy: fixed resets at interval, sliding tracks individual requests */
  windowStrategy?: 'fixed' | 'sliding'
  /** Burst capacity (token bucket) */
  burstCapacity?: number
  /** Burst token refill rate (tokens per second) */
  burstRefillRate?: number
  /** Whether to allow requests on storage errors (fail open) */
  failOpen?: boolean
  /** Per-endpoint rate limits override */
  endpointLimits?: Record<string, { requestsPerWindow: number; windowMs: number }>
}

/**
 * Result from rate limit check
 */
export interface HTTPRateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** HTTP status code (200 for allowed, 429 for rate limited) */
  statusCode: number
  /** Remaining requests in current window */
  remaining: number
  /** When the current window resets (Unix timestamp ms) */
  windowResetsAt: number
  /** When the oldest request in sliding window expires */
  oldestRequestExpiresAt?: number
  /** Rate limit headers to apply */
  headers: Record<string, string>
  /** Error details if rate limited */
  error?: { code: string; message: string }
  /** Retry after in milliseconds */
  retryAfterMs?: number
  /** Burst state if using burst capacity */
  burstState?: { tokens: number; capacity: number; refillRate: number }
  /** Whether a storage error occurred */
  storageError?: boolean
}

// ============================================================================
// RATE LIMIT STATE
// ============================================================================

/**
 * State for fixed window rate limiting
 */
interface FixedWindowState {
  count: number
  windowStart: number
}

/**
 * State for sliding window rate limiting
 */
interface SlidingWindowState {
  requests: number[] // timestamps of requests
}

/**
 * State for burst/token bucket
 */
interface BurstState {
  tokens: number
  lastRefill: number
}

// ============================================================================
// HTTP ENDPOINT RATE LIMITER
// ============================================================================

/**
 * HTTP Endpoint Rate Limiter using token bucket algorithm
 * with support for fixed/sliding windows and burst allowance.
 */
export class HTTPEndpointRateLimiter {
  private readonly config: Required<HTTPRateLimitConfig>
  private readonly fixedWindows: Map<string, FixedWindowState> = new Map()
  private readonly slidingWindows: Map<string, SlidingWindowState> = new Map()
  private readonly burstStates: Map<string, BurstState> = new Map()
  private simulateStorageFailure = false

  constructor(config: HTTPRateLimitConfig) {
    // Validate config
    if (config.requestsPerWindow < 0) {
      throw new Error('Invalid config: requestsPerWindow must be non-negative')
    }
    if (config.windowMs <= 0) {
      throw new Error('Invalid config: windowMs must be positive')
    }

    this.config = {
      requestsPerWindow: config.requestsPerWindow,
      windowMs: config.windowMs,
      keyStrategy: config.keyStrategy ?? 'ip',
      windowStrategy: config.windowStrategy ?? 'fixed',
      burstCapacity: config.burstCapacity ?? config.requestsPerWindow,
      burstRefillRate: config.burstRefillRate ?? config.requestsPerWindow / (config.windowMs / 1000),
      failOpen: config.failOpen ?? true,
      endpointLimits: config.endpointLimits ?? {},
    }
  }

  /**
   * Check if a request should be allowed
   */
  async check(request: Request): Promise<HTTPRateLimitResult> {
    // Handle simulated storage failure
    if (this.simulateStorageFailure) {
      const allowed = this.config.failOpen
      return {
        allowed,
        statusCode: allowed ? 200 : 429,
        remaining: allowed ? this.config.requestsPerWindow : 0,
        windowResetsAt: Date.now() + this.config.windowMs,
        headers: this.buildHeaders(this.config.requestsPerWindow, this.config.requestsPerWindow, Date.now() + this.config.windowMs),
        storageError: true,
        error: allowed ? undefined : { code: 'STORAGE_ERROR', message: 'Rate limit storage unavailable' },
      }
    }

    const key = this.getKeyForRequest(request)
    const endpoint = new URL(request.url).pathname
    const effectiveConfig = this.getConfigForEndpoint(endpoint)
    const now = Date.now()

    // Check burst capacity first if configured
    if (this.config.burstCapacity > 0) {
      const burstAllowed = this.checkBurst(key)
      if (!burstAllowed) {
        const burstState = this.burstStates.get(key)
        const retryAfterMs = burstState
          ? Math.ceil((1 / this.config.burstRefillRate) * 1000)
          : this.config.windowMs

        return {
          allowed: false,
          statusCode: 429,
          remaining: 0,
          windowResetsAt: now + retryAfterMs,
          headers: this.buildHeaders(
            effectiveConfig.requestsPerWindow,
            0,
            now + retryAfterMs,
            Math.ceil(retryAfterMs / 1000)
          ),
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'rate limit exceeded. Please retry later.',
          },
          retryAfterMs,
          burstState: burstState
            ? { tokens: burstState.tokens, capacity: this.config.burstCapacity, refillRate: this.config.burstRefillRate }
            : undefined,
        }
      }
    }

    // Check window-based rate limit
    let result: HTTPRateLimitResult
    if (this.config.windowStrategy === 'sliding') {
      result = this.checkSlidingWindow(key, effectiveConfig, now)
    } else {
      result = this.checkFixedWindow(key, effectiveConfig, now)
    }

    // Add burst state to result if burst is configured
    if (this.config.burstCapacity > 0) {
      const burstState = this.burstStates.get(key)
      if (burstState) {
        result.burstState = {
          tokens: burstState.tokens,
          capacity: this.config.burstCapacity,
          refillRate: this.config.burstRefillRate,
        }
      }
    }

    return result
  }

  /**
   * Check fixed window rate limit
   */
  private checkFixedWindow(
    key: string,
    config: { requestsPerWindow: number; windowMs: number },
    now: number
  ): HTTPRateLimitResult {
    let state = this.fixedWindows.get(key)

    // Reset window if expired
    if (!state || now >= state.windowStart + config.windowMs) {
      state = { count: 0, windowStart: now }
      this.fixedWindows.set(key, state)
    }

    const windowResetsAt = state.windowStart + config.windowMs
    const remaining = Math.max(0, config.requestsPerWindow - state.count - 1)

    // Check if over limit
    if (state.count >= config.requestsPerWindow) {
      const retryAfterMs = windowResetsAt - now

      return {
        allowed: false,
        statusCode: 429,
        remaining: 0,
        windowResetsAt,
        headers: this.buildHeaders(
          config.requestsPerWindow,
          0,
          windowResetsAt,
          Math.ceil(retryAfterMs / 1000)
        ),
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'rate limit exceeded. Please retry later.',
        },
        retryAfterMs,
      }
    }

    // Increment count
    state.count++

    return {
      allowed: true,
      statusCode: 200,
      remaining,
      windowResetsAt,
      headers: this.buildHeaders(config.requestsPerWindow, remaining, windowResetsAt),
    }
  }

  /**
   * Check sliding window rate limit
   */
  private checkSlidingWindow(
    key: string,
    config: { requestsPerWindow: number; windowMs: number },
    now: number
  ): HTTPRateLimitResult {
    let state = this.slidingWindows.get(key)

    if (!state) {
      state = { requests: [] }
      this.slidingWindows.set(key, state)
    }

    // Remove expired requests
    const cutoff = now - config.windowMs
    state.requests = state.requests.filter((ts) => ts > cutoff)

    const remaining = Math.max(0, config.requestsPerWindow - state.requests.length - 1)
    const oldestRequestExpiresAt = state.requests.length > 0
      ? state.requests[0] + config.windowMs
      : undefined
    const windowResetsAt = oldestRequestExpiresAt ?? now + config.windowMs

    // Check if over limit
    if (state.requests.length >= config.requestsPerWindow) {
      const retryAfterMs = oldestRequestExpiresAt ? oldestRequestExpiresAt - now : config.windowMs

      return {
        allowed: false,
        statusCode: 429,
        remaining: 0,
        windowResetsAt,
        oldestRequestExpiresAt,
        headers: this.buildHeaders(
          config.requestsPerWindow,
          0,
          windowResetsAt,
          Math.ceil(retryAfterMs / 1000)
        ),
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'rate limit exceeded. Please retry later.',
        },
        retryAfterMs,
      }
    }

    // Add this request
    state.requests.push(now)

    return {
      allowed: true,
      statusCode: 200,
      remaining,
      windowResetsAt,
      oldestRequestExpiresAt: state.requests[0] + config.windowMs,
      headers: this.buildHeaders(config.requestsPerWindow, remaining, windowResetsAt),
    }
  }

  /**
   * Check burst capacity (token bucket)
   */
  private checkBurst(key: string): boolean {
    let state = this.burstStates.get(key)
    const now = Date.now()

    if (!state) {
      state = { tokens: this.config.burstCapacity, lastRefill: now }
      this.burstStates.set(key, state)
    }

    // Refill tokens based on elapsed time
    const elapsedSeconds = (now - state.lastRefill) / 1000
    const tokensToAdd = elapsedSeconds * this.config.burstRefillRate
    state.tokens = Math.min(this.config.burstCapacity, state.tokens + tokensToAdd)
    state.lastRefill = now

    // Check if we have a token
    if (state.tokens >= 1) {
      state.tokens--
      return true
    }

    return false
  }

  /**
   * Get the rate limit key for a request
   */
  getKeyForRequest(request: Request): string {
    const url = new URL(request.url)
    const ip = this.extractIP(request)
    const tenant = this.extractTenant(request)
    const endpoint = url.pathname

    switch (this.config.keyStrategy) {
      case 'ip':
        return `ip:${ip}`
      case 'tenant':
        return `tenant:${tenant}`
      case 'ip+tenant':
        return `ip:${ip}:tenant:${tenant}`
      case 'ip+endpoint':
        return `ip:${ip}:endpoint:${endpoint}`
      default:
        return `ip:${ip}`
    }
  }

  /**
   * Extract IP address from request headers
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
      const firstIP = forwardedFor.split(',')[0].trim()
      return firstIP
    }

    return 'unknown'
  }

  /**
   * Extract tenant from request
   */
  private extractTenant(request: Request): string {
    // Check X-Tenant-ID header first
    const tenantHeader = request.headers.get('X-Tenant-ID')
    if (tenantHeader) return tenantHeader

    // Extract from hostname (tenant.api.dotdo.dev)
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')

    // For subdomains like "acme-corp.api.dotdo.dev"
    if (hostParts.length >= 4) {
      return hostParts[0]
    }

    return 'default'
  }

  /**
   * Get effective config for an endpoint (allows per-endpoint overrides)
   */
  getConfigForEndpoint(endpoint: string): { requestsPerWindow: number; windowMs: number } {
    const override = this.config.endpointLimits[endpoint]
    if (override) {
      return override
    }
    return {
      requestsPerWindow: this.config.requestsPerWindow,
      windowMs: this.config.windowMs,
    }
  }

  /**
   * Build rate limit headers
   */
  private buildHeaders(
    limit: number,
    remaining: number,
    resetAt: number,
    retryAfterSeconds?: number
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(Math.floor(resetAt / 1000)),
      'X-RateLimit-Policy': `${limit};w=${Math.floor(this.config.windowMs / 1000)}`,
    }

    if (retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
      headers['Retry-After'] = String(retryAfterSeconds)
    }

    return headers
  }

  /**
   * Apply rate limit headers to a response
   */
  applyHeaders(response: Response, result: HTTPRateLimitResult): Response {
    const newHeaders = new Headers(response.headers)

    for (const [key, value] of Object.entries(result.headers)) {
      newHeaders.set(key, value)
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    })
  }

  /**
   * Get burst state for a key
   */
  async getBurstState(key: string): Promise<{ tokens: number; capacity: number; refillRate: number }> {
    // Normalize key for burst state lookup
    const normalizedKey = key.includes(':') ? key : `ip:${key}`

    let state = this.burstStates.get(normalizedKey)
    const now = Date.now()

    if (!state) {
      // Return full capacity if no state exists
      return {
        tokens: this.config.burstCapacity,
        capacity: this.config.burstCapacity,
        refillRate: this.config.burstRefillRate,
      }
    }

    // Calculate current tokens with refill
    const elapsedSeconds = (now - state.lastRefill) / 1000
    const tokensToAdd = elapsedSeconds * this.config.burstRefillRate
    const currentTokens = Math.min(this.config.burstCapacity, state.tokens + tokensToAdd)

    return {
      tokens: currentTokens,
      capacity: this.config.burstCapacity,
      refillRate: this.config.burstRefillRate,
    }
  }

  /**
   * Reset rate limit state for a key
   */
  async resetKey(key: string): Promise<void> {
    // Normalize key
    const normalizedKey = key.includes(':') ? key : `ip:${key}`

    this.fixedWindows.delete(normalizedKey)
    this.slidingWindows.delete(normalizedKey)
    this.burstStates.delete(normalizedKey)
  }

  /**
   * Simulate storage failure (for testing)
   * @internal
   */
  _simulateStorageFailure(fail: boolean): void {
    this.simulateStorageFailure = fail
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create an endpoint rate limiter with the given config
 */
export function createEndpointRateLimiter(config: HTTPRateLimitConfig): HTTPEndpointRateLimiter {
  return new HTTPEndpointRateLimiter(config)
}

// ============================================================================
// HONO MIDDLEWARE
// ============================================================================

/**
 * Default rate limit configuration for query endpoints
 */
const DEFAULT_QUERY_RATE_LIMIT_CONFIG: HTTPRateLimitConfig = {
  requestsPerWindow: 100,
  windowMs: 60000, // 1 minute
  keyStrategy: 'ip',
  windowStrategy: 'fixed',
  failOpen: true,
}

/**
 * Create Hono middleware for query endpoint rate limiting
 *
 * @param config - Rate limit configuration (optional, uses defaults)
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { queryRateLimitMiddleware } from './middleware/query-rate-limit'
 *
 * // Apply to query routes
 * app.use('/query/*', queryRateLimitMiddleware())
 *
 * // Custom config
 * app.use('/query/*', queryRateLimitMiddleware({
 *   requestsPerWindow: 500,
 *   windowMs: 60000,
 *   keyStrategy: 'tenant',
 * }))
 * ```
 */
export function queryRateLimitMiddleware(config?: HTTPRateLimitConfig): MiddlewareHandler {
  const rateLimiter = new HTTPEndpointRateLimiter({
    ...DEFAULT_QUERY_RATE_LIMIT_CONFIG,
    ...config,
  })

  return async (c: Context, next: Next): Promise<Response | void> => {
    const result = await rateLimiter.check(c.req.raw)

    // Set rate limit headers on context
    for (const [key, value] of Object.entries(result.headers)) {
      c.header(key, value)
    }

    // If rate limited, return 429 response
    if (!result.allowed) {
      return c.json(
        {
          error: result.error?.message ?? 'Rate limit exceeded',
          code: result.error?.code ?? 'RATE_LIMIT_EXCEEDED',
          retryAfter: result.retryAfterMs ? Math.ceil(result.retryAfterMs / 1000) : undefined,
        },
        429
      )
    }

    // Store rate limit info in context for downstream use
    c.set('rateLimit', {
      allowed: result.allowed,
      remaining: result.remaining,
      limit: rateLimiter.getConfigForEndpoint(c.req.path).requestsPerWindow,
    })

    // Continue to next middleware/handler
    await next()
  }
}

export default queryRateLimitMiddleware
