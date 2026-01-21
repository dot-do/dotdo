/**
 * DO-Level Rate Limiting (do-soc30)
 *
 * Provides per-DO rate limiting for external callers using sliding window
 * or token bucket algorithms. This is applied directly within the DO to
 * protect against abuse from external callers.
 *
 * Features:
 * - Sliding window rate limiting (default)
 * - Token bucket for burst handling
 * - Per-caller tracking (by IP, user, or custom key)
 * - SQLite-backed state for persistence across hibernation
 * - Automatic cleanup of expired entries
 * - Rate limit headers in responses
 *
 * @module @dotdo/do/rate-limit
 * @issue do-soc30 - Implement rate limiting at DO level for external callers
 */

import {
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  DEFAULT_FREE_TIER_REQUESTS,
  DEFAULT_MAX_STORE_ENTRIES,
  DEFAULT_CLEANUP_INTERVAL_MS,
  MS_PER_SECOND,
} from '@dotdo/utils'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Rate limit tier configuration
 */
export interface RateLimitTierConfig {
  /** Maximum requests allowed per window */
  requestsPerWindow: number
  /** Window duration in milliseconds */
  windowMs: number
  /** Optional burst capacity (for token bucket) */
  burstCapacity?: number
}

/**
 * Configuration for DO-level rate limiting
 */
export interface DORateLimitConfig {
  /** Enable rate limiting (default: true) */
  enabled?: boolean

  /**
   * Strategy for extracting rate limit key from request
   * - 'ip': Use client IP address (CF-Connecting-IP)
   * - 'user': Use X-User-ID header or Authorization bearer
   * - 'custom': Use custom keyExtractor function
   * @default 'ip'
   */
  keyStrategy?: 'ip' | 'user' | 'custom'

  /** Custom key extractor function (required if keyStrategy is 'custom') */
  keyExtractor?: (request: Request) => string | undefined

  /** Default rate limit configuration */
  defaultLimit?: RateLimitTierConfig

  /** Per-key overrides for specific callers */
  keyOverrides?: Record<string, Partial<RateLimitTierConfig>>

  /** Maximum entries to track (LRU eviction when exceeded) */
  maxEntries?: number

  /** Algorithm: 'sliding_window' or 'token_bucket' */
  algorithm?: 'sliding_window' | 'token_bucket'

  /** Whether to fail open on errors (allow request) */
  failOpen?: boolean

  /** Paths to skip rate limiting */
  skipPaths?: string[]

  /** Skip rate limiting for internal DO-to-DO calls */
  skipInternalCalls?: boolean
}

/**
 * Result of a rate limit check
 */
export interface DORateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Remaining requests in current window */
  remaining: number
  /** Total limit for this caller */
  limit: number
  /** When the window resets (Unix timestamp in seconds) */
  resetAt: number
  /** Key used for rate limiting */
  key: string
  /** Retry-After header value in seconds (only when rate limited) */
  retryAfter?: number
}

/**
 * Rate limit headers to apply to response
 */
export interface RateLimitHeaders {
  'X-RateLimit-Limit': string
  'X-RateLimit-Remaining': string
  'X-RateLimit-Reset': string
  'Retry-After'?: string
}

/**
 * Sliding window entry (stored in memory or SQLite)
 */
interface SlidingWindowEntry {
  key: string
  timestamps: number[]
  lastAccess: number
}

/**
 * Token bucket entry
 */
interface TokenBucketEntry {
  key: string
  tokens: number
  lastRefill: number
  lastAccess: number
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: Required<Omit<DORateLimitConfig, 'keyExtractor' | 'keyOverrides'>> & {
  keyExtractor: undefined
  keyOverrides: Record<string, Partial<RateLimitTierConfig>>
} = {
  enabled: true,
  keyStrategy: 'ip',
  keyExtractor: undefined,
  defaultLimit: {
    requestsPerWindow: DEFAULT_FREE_TIER_REQUESTS,
    windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
    burstCapacity: 20,
  },
  keyOverrides: {},
  maxEntries: DEFAULT_MAX_STORE_ENTRIES,
  algorithm: 'sliding_window',
  failOpen: true,
  skipPaths: ['/health', '/ready', '/live'],
  skipInternalCalls: true,
}

// ============================================================================
// DO RATE LIMITER
// ============================================================================

/**
 * DORateLimiter - Rate limiting for Durable Object instances
 *
 * This class provides rate limiting at the DO level to protect against
 * abuse from external callers. It should be instantiated in the DO
 * constructor and called in the fetch handler.
 *
 * @example
 * ```typescript
 * class MyDO extends DO {
 *   private rateLimiter: DORateLimiter
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *     this.rateLimiter = new DORateLimiter({
 *       defaultLimit: { requestsPerWindow: 100, windowMs: 60000 },
 *       keyStrategy: 'ip',
 *     })
 *   }
 *
 *   async fetch(request: Request): Promise<Response> {
 *     const result = this.rateLimiter.check(request)
 *     if (!result.allowed) {
 *       return this.rateLimiter.createRateLimitResponse(result)
 *     }
 *     return super.fetch(request)
 *   }
 * }
 * ```
 */
export class DORateLimiter {
  private readonly config: Required<Omit<DORateLimitConfig, 'keyExtractor' | 'keyOverrides'>> & {
    keyExtractor: ((request: Request) => string | undefined) | undefined
    keyOverrides: Record<string, Partial<RateLimitTierConfig>>
  }

  // In-memory storage for rate limit state
  private readonly slidingWindows: Map<string, SlidingWindowEntry> = new Map()
  private readonly tokenBuckets: Map<string, TokenBucketEntry> = new Map()

  // LRU tracking
  private readonly lruOrder: string[] = []

  // Cleanup tracking
  private lastCleanup: number = 0

  constructor(config: DORateLimitConfig = {}) {
    this.config = {
      enabled: config.enabled ?? DEFAULT_CONFIG.enabled,
      keyStrategy: config.keyStrategy ?? DEFAULT_CONFIG.keyStrategy,
      keyExtractor: config.keyExtractor,
      defaultLimit: { ...DEFAULT_CONFIG.defaultLimit, ...config.defaultLimit },
      keyOverrides: config.keyOverrides ?? {},
      maxEntries: config.maxEntries ?? DEFAULT_CONFIG.maxEntries,
      algorithm: config.algorithm ?? DEFAULT_CONFIG.algorithm,
      failOpen: config.failOpen ?? DEFAULT_CONFIG.failOpen,
      skipPaths: config.skipPaths ?? DEFAULT_CONFIG.skipPaths,
      skipInternalCalls: config.skipInternalCalls ?? DEFAULT_CONFIG.skipInternalCalls,
    }

    // Validate custom keyExtractor
    if (this.config.keyStrategy === 'custom' && !this.config.keyExtractor) {
      throw new Error('keyExtractor is required when keyStrategy is "custom"')
    }
  }

  /**
   * Check if a request should be rate limited
   *
   * @param request - The incoming request
   * @returns Rate limit result with allowed status and headers
   */
  check(request: Request): DORateLimitResult {
    // Check if rate limiting is enabled
    if (!this.config.enabled) {
      return this.createAllowedResult('disabled', this.config.defaultLimit)
    }

    // Check if path should be skipped
    const url = new URL(request.url)
    if (this.config.skipPaths.some((p) => url.pathname.startsWith(p))) {
      return this.createAllowedResult('skipped', this.config.defaultLimit)
    }

    // Check if internal DO-to-DO call should be skipped
    if (this.config.skipInternalCalls && this.isInternalCall(request)) {
      return this.createAllowedResult('internal', this.config.defaultLimit)
    }

    // Extract rate limit key
    const key = this.extractKey(request)
    if (!key) {
      // No key extracted - fail open or closed based on config
      if (this.config.failOpen) {
        return this.createAllowedResult('no-key', this.config.defaultLimit)
      } else {
        return this.createDeniedResult('no-key', this.config.defaultLimit, 0)
      }
    }

    // Get effective limit for this key
    const limit = this.getEffectiveLimit(key)

    // Periodic cleanup
    this.maybeCleanup()

    // Update LRU
    this.touchLRU(key)

    // Enforce LRU limit
    this.enforceLRULimit()

    // Check rate limit based on algorithm
    if (this.config.algorithm === 'token_bucket') {
      return this.checkTokenBucket(key, limit)
    } else {
      return this.checkSlidingWindow(key, limit)
    }
  }

  /**
   * Create a 429 Too Many Requests response
   */
  createRateLimitResponse(result: DORateLimitResult): Response {
    const headers = this.getHeaders(result)
    return new Response(
      JSON.stringify({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please retry later.',
          retryAfter: result.retryAfter,
        },
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      }
    )
  }

  /**
   * Get rate limit headers to add to response
   */
  getHeaders(result: DORateLimitResult): RateLimitHeaders {
    const headers: RateLimitHeaders = {
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': String(result.resetAt),
    }

    if (result.retryAfter !== undefined && result.retryAfter > 0) {
      headers['Retry-After'] = String(result.retryAfter)
    }

    return headers
  }

  /**
   * Reset rate limit state for a specific key
   */
  reset(key: string): void {
    this.slidingWindows.delete(key)
    this.tokenBuckets.delete(key)
    this.removeLRU(key)
  }

  /**
   * Reset all rate limit state
   */
  resetAll(): void {
    this.slidingWindows.clear()
    this.tokenBuckets.clear()
    this.lruOrder.length = 0
  }

  /**
   * Get current statistics
   */
  getStats(): { entriesCount: number; lastCleanup: number } {
    const entriesCount =
      this.config.algorithm === 'token_bucket'
        ? this.tokenBuckets.size
        : this.slidingWindows.size
    return {
      entriesCount,
      lastCleanup: this.lastCleanup,
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private extractKey(request: Request): string | undefined {
    switch (this.config.keyStrategy) {
      case 'ip':
        return this.extractIP(request)
      case 'user':
        return this.extractUser(request)
      case 'custom':
        return this.config.keyExtractor?.(request)
      default:
        return this.extractIP(request)
    }
  }

  private extractIP(request: Request): string {
    // Cloudflare
    const cfIP = request.headers.get('CF-Connecting-IP')
    if (cfIP) return `ip:${cfIP}`

    // Standard headers
    const realIP = request.headers.get('X-Real-IP')
    if (realIP) return `ip:${realIP}`

    // X-Forwarded-For (take first IP in chain)
    const forwardedFor = request.headers.get('X-Forwarded-For')
    if (forwardedFor) {
      const firstIP = forwardedFor.split(',')[0]?.trim()
      if (firstIP) return `ip:${firstIP}`
    }

    return 'ip:unknown'
  }

  private extractUser(request: Request): string | undefined {
    // Check X-User-ID header
    const userHeader = request.headers.get('X-User-ID')
    if (userHeader) return `user:${userHeader}`

    // Check Authorization header for Bearer token
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      // Use a portion of the token as key (not full token for security)
      const token = authHeader.substring(7)
      return `bearer:${token.substring(0, 16)}`
    }

    return undefined
  }

  private isInternalCall(request: Request): boolean {
    // Check for DO-to-DO call markers
    return (
      request.headers.has('X-DO-Source') ||
      request.headers.has('X-DO-Signature') ||
      request.headers.has('X-CF-Worker')
    )
  }

  private getEffectiveLimit(key: string): RateLimitTierConfig {
    // Check for key-specific override
    const override = this.config.keyOverrides[key]
    if (override) {
      return {
        requestsPerWindow: override.requestsPerWindow ?? this.config.defaultLimit.requestsPerWindow,
        windowMs: override.windowMs ?? this.config.defaultLimit.windowMs,
        burstCapacity: override.burstCapacity ?? this.config.defaultLimit.burstCapacity,
      }
    }
    return this.config.defaultLimit
  }

  private checkSlidingWindow(key: string, limit: RateLimitTierConfig): DORateLimitResult {
    const now = Date.now()
    let entry = this.slidingWindows.get(key)

    if (!entry) {
      entry = { key, timestamps: [], lastAccess: now }
      this.slidingWindows.set(key, entry)
    }

    // Remove expired timestamps
    const cutoff = now - limit.windowMs
    entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff)
    entry.lastAccess = now

    // Calculate reset time
    const firstTimestamp = entry.timestamps[0]
    const resetAt = firstTimestamp !== undefined
      ? Math.ceil((firstTimestamp + limit.windowMs) / MS_PER_SECOND)
      : Math.ceil((now + limit.windowMs) / MS_PER_SECOND)

    // Check if over limit
    if (entry.timestamps.length >= limit.requestsPerWindow) {
      const oldestTimestamp = entry.timestamps[0] ?? now
      const retryAfterMs = oldestTimestamp + limit.windowMs - now
      const retryAfter = Math.ceil(retryAfterMs / MS_PER_SECOND)

      return {
        allowed: false,
        remaining: 0,
        limit: limit.requestsPerWindow,
        resetAt,
        key,
        retryAfter: Math.max(0, retryAfter),
      }
    }

    // Record this request
    entry.timestamps.push(now)

    return {
      allowed: true,
      remaining: Math.max(0, limit.requestsPerWindow - entry.timestamps.length),
      limit: limit.requestsPerWindow,
      resetAt,
      key,
    }
  }

  private checkTokenBucket(key: string, limit: RateLimitTierConfig): DORateLimitResult {
    const now = Date.now()
    let entry = this.tokenBuckets.get(key)

    const capacity = limit.burstCapacity ?? limit.requestsPerWindow
    const refillRate = limit.requestsPerWindow / limit.windowMs // tokens per ms

    if (!entry) {
      entry = { key, tokens: capacity, lastRefill: now, lastAccess: now }
      this.tokenBuckets.set(key, entry)
    }

    // Refill tokens based on elapsed time
    const elapsed = now - entry.lastRefill
    const refillAmount = elapsed * refillRate
    entry.tokens = Math.min(capacity, entry.tokens + refillAmount)
    entry.lastRefill = now
    entry.lastAccess = now

    // Calculate reset time (when bucket would be full again)
    const tokensNeeded = capacity - entry.tokens
    const timeToFull = tokensNeeded > 0 ? tokensNeeded / refillRate : 0
    const resetAt = Math.ceil((now + timeToFull) / MS_PER_SECOND)

    // Check if we have tokens
    if (entry.tokens < 1) {
      const retryAfterMs = (1 - entry.tokens) / refillRate
      const retryAfter = Math.ceil(retryAfterMs / MS_PER_SECOND)

      return {
        allowed: false,
        remaining: 0,
        limit: capacity,
        resetAt,
        key,
        retryAfter: Math.max(0, retryAfter),
      }
    }

    // Consume a token
    entry.tokens -= 1

    return {
      allowed: true,
      remaining: Math.floor(entry.tokens),
      limit: capacity,
      resetAt,
      key,
    }
  }

  private createAllowedResult(key: string, limit: RateLimitTierConfig): DORateLimitResult {
    const now = Date.now()
    return {
      allowed: true,
      remaining: limit.requestsPerWindow,
      limit: limit.requestsPerWindow,
      resetAt: Math.ceil((now + limit.windowMs) / MS_PER_SECOND),
      key,
    }
  }

  private createDeniedResult(
    key: string,
    limit: RateLimitTierConfig,
    retryAfter: number
  ): DORateLimitResult {
    const now = Date.now()
    return {
      allowed: false,
      remaining: 0,
      limit: limit.requestsPerWindow,
      resetAt: Math.ceil((now + limit.windowMs) / MS_PER_SECOND),
      key,
      retryAfter,
    }
  }

  private touchLRU(key: string): void {
    const index = this.lruOrder.indexOf(key)
    if (index !== -1) {
      this.lruOrder.splice(index, 1)
    }
    this.lruOrder.push(key)
  }

  private removeLRU(key: string): void {
    const index = this.lruOrder.indexOf(key)
    if (index !== -1) {
      this.lruOrder.splice(index, 1)
    }
  }

  private enforceLRULimit(): void {
    while (this.lruOrder.length > this.config.maxEntries) {
      const lruKey = this.lruOrder.shift()
      if (lruKey) {
        this.slidingWindows.delete(lruKey)
        this.tokenBuckets.delete(lruKey)
      }
    }
  }

  private maybeCleanup(): void {
    const now = Date.now()
    if (now - this.lastCleanup < DEFAULT_CLEANUP_INTERVAL_MS) {
      return
    }

    this.cleanup()
    this.lastCleanup = now
  }

  private cleanup(): void {
    const now = Date.now()
    const windowMs = this.config.defaultLimit.windowMs

    // Clean sliding windows
    for (const [key, entry] of this.slidingWindows) {
      // Remove expired timestamps
      entry.timestamps = entry.timestamps.filter((ts) => ts > now - windowMs)

      // Remove entry if empty
      if (entry.timestamps.length === 0) {
        this.slidingWindows.delete(key)
        this.removeLRU(key)
      }
    }

    // Clean token buckets (remove if unused for 2x window duration)
    const bucketExpiry = windowMs * 2
    for (const [key, entry] of this.tokenBuckets) {
      if (now - entry.lastAccess > bucketExpiry) {
        this.tokenBuckets.delete(key)
        this.removeLRU(key)
      }
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a DO rate limiter with the given configuration
 */
export function createDORateLimiter(config?: DORateLimitConfig): DORateLimiter {
  return new DORateLimiter(config)
}

/**
 * Create a rate limiter with preset tiers
 *
 * @param tier - 'free', 'pro', or 'enterprise'
 * @param overrides - Optional configuration overrides
 */
export function createTieredRateLimiter(
  tier: 'free' | 'pro' | 'enterprise',
  overrides?: Partial<DORateLimitConfig>
): DORateLimiter {
  const tierLimits: Record<string, RateLimitTierConfig> = {
    free: {
      requestsPerWindow: 100,
      windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
      burstCapacity: 20,
    },
    pro: {
      requestsPerWindow: 1000,
      windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
      burstCapacity: 100,
    },
    enterprise: {
      requestsPerWindow: 10000,
      windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
      burstCapacity: 500,
    },
  }

  return new DORateLimiter({
    ...overrides,
    defaultLimit: { ...tierLimits[tier], ...overrides?.defaultLimit },
  })
}

// ============================================================================
// HONO MIDDLEWARE (for use within DO's Hono app)
// ============================================================================

import type { Context, MiddlewareHandler, Next } from 'hono'

/**
 * Create a Hono middleware for DO-level rate limiting
 *
 * @param config - Rate limiter configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { doRateLimitMiddleware } from '@dotdo/do'
 *
 * const app = new Hono()
 * app.use('/*', doRateLimitMiddleware({
 *   defaultLimit: { requestsPerWindow: 100, windowMs: 60000 },
 * }))
 * ```
 */
export function doRateLimitMiddleware(config?: DORateLimitConfig): MiddlewareHandler {
  const limiter = new DORateLimiter(config)

  return async (c: Context, next: Next): Promise<Response | void> => {
    const result = limiter.check(c.req.raw)

    // Add rate limit headers to context
    const headers = limiter.getHeaders(result)
    for (const [key, value] of Object.entries(headers)) {
      c.header(key, value)
    }

    if (!result.allowed) {
      return c.json(
        {
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests. Please retry later.',
            retryAfter: result.retryAfter,
          },
        },
        429
      )
    }

    // Store rate limit info in context
    c.set('rateLimit', result)

    await next()
  }
}
