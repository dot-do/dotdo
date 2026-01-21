/**
 * Rate Limiting Middleware for Hono
 *
 * Provides per-tenant and per-user rate limiting using sliding window algorithm.
 * State is stored in Durable Objects for distributed rate limiting.
 *
 * Features:
 * - Per-tenant rate limiting
 * - Per-user rate limiting
 * - Configurable limits per tier (free, pro, enterprise)
 * - Sliding window algorithm
 * - Proper rate limit headers (X-RateLimit-*)
 * - 429 Too Many Requests responses
 *
 * @module api/middleware/rate-limit
 * @issue do-vytw - Add rate limiting per-tenant/per-user
 */

import type { Context, MiddlewareHandler, Next } from 'hono'
import { RateLimitError, ValidationError } from '../../rpc/errors'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Rate limit tier configuration
 */
export interface RateLimitTier {
  /** Tier name (e.g., 'free', 'pro', 'enterprise') */
  name: string
  /** Requests allowed per window */
  requestsPerWindow: number
  /** Window duration in milliseconds */
  windowMs: number
  /** Optional burst capacity */
  burstCapacity?: number | undefined
}

/**
 * Default tier configurations
 */
export const DEFAULT_TIERS: Record<string, RateLimitTier> = {
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

/**
 * Rate limiter configuration
 */
export interface RateLimitConfig {
  /** Key strategy for rate limiting */
  keyStrategy: 'tenant' | 'user' | 'tenant+user' | 'ip'
  /** Default tier for unknown entities */
  defaultTier?: string
  /** Custom tiers configuration */
  tiers?: Record<string, RateLimitTier>
  /** Override limits for specific tenants */
  tenantOverrides?: Record<string, Partial<RateLimitTier>>
  /** Override limits for specific users */
  userOverrides?: Record<string, Partial<RateLimitTier>>
  /** Whether to fail open on storage errors */
  failOpen?: boolean
  /** Window strategy: 'sliding' or 'fixed' */
  windowStrategy?: 'sliding' | 'fixed'
  /** Skip rate limiting for specific paths */
  skipPaths?: string[]
  /** Maximum number of entries before LRU eviction (default: 10000) */
  maxEntries?: number
  /** Cleanup interval in milliseconds (default: 300000 = 5 minutes) */
  cleanupIntervalMs?: number
}

/**
 * Rate limiter metrics
 */
export interface RateLimiterMetrics {
  /** Number of sliding window entries */
  slidingWindowCount: number
  /** Number of fixed window entries */
  fixedWindowCount: number
  /** Total entries across both maps */
  totalEntries: number
  /** Timestamp of last cleanup (null if never cleaned) */
  lastCleanup: number | null
  /** Number of entries removed in last cleanup (0 if never cleaned) */
  entriesRemoved: number
}

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** HTTP status code */
  statusCode: number
  /** Remaining requests in current window */
  remaining: number
  /** Total limit for this entity */
  limit: number
  /** When the window resets (Unix timestamp in seconds) */
  resetAt: number
  /** Rate limit headers to apply */
  headers: Record<string, string>
  /** Error details if rate limited */
  error?: { code: string; message: string } | undefined
  /** Retry after in seconds (only when rate limited) */
  retryAfter?: number | undefined
  /** The key used for rate limiting */
  key: string
  /** The tier applied */
  tier: string
}

/**
 * Sliding window state
 */
interface SlidingWindowState {
  requests: number[] // timestamps of requests in ms
}

/**
 * Fixed window state
 */
interface FixedWindowState {
  count: number
  windowStart: number
}

/**
 * Internal config with all required fields
 */
interface InternalRateLimitConfig {
  keyStrategy: 'tenant' | 'user' | 'tenant+user' | 'ip'
  defaultTier: string
  tiers: Record<string, RateLimitTier>
  tenantOverrides: Record<string, Partial<RateLimitTier>>
  userOverrides: Record<string, Partial<RateLimitTier>>
  failOpen: boolean
  windowStrategy: 'sliding' | 'fixed'
  skipPaths: string[]
  maxEntries: number
  cleanupIntervalMs: number
}

// ============================================================================
// RATE LIMITER CLASS
// ============================================================================

/**
 * Rate Limiter using sliding window algorithm
 *
 * Tracks request timestamps per key and enforces limits based on tier configuration.
 * Includes memory management via periodic cleanup and LRU eviction.
 *
 * @issue do-ti43.9 - [TDD] Rate limiter memory cleanup
 */
export class RateLimiter {
  private readonly config: InternalRateLimitConfig
  private readonly slidingWindows: Map<string, SlidingWindowState> = new Map()
  private readonly fixedWindows: Map<string, FixedWindowState> = new Map()
  /** LRU order tracking - most recently used keys at the end */
  private readonly lruOrder: string[] = []
  private simulateStorageFailure = false
  private lastCleanup: number | null = null
  private lastEntriesRemoved: number = 0
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null

  constructor(config: RateLimitConfig) {
    this.config = {
      keyStrategy: config.keyStrategy,
      defaultTier: config.defaultTier ?? 'free',
      tiers: { ...DEFAULT_TIERS, ...config.tiers },
      tenantOverrides: config.tenantOverrides ?? {},
      userOverrides: config.userOverrides ?? {},
      failOpen: config.failOpen ?? true,
      windowStrategy: config.windowStrategy ?? 'sliding',
      skipPaths: config.skipPaths ?? [],
      maxEntries: config.maxEntries ?? 10000,
      cleanupIntervalMs: config.cleanupIntervalMs ?? 300000, // 5 minutes
    }

    // Validate tiers
    if (!this.config.tiers[this.config.defaultTier]) {
      throw ValidationError.forField(
        'defaultTier',
        `must reference an existing tier (got '${this.config.defaultTier}')`,
        this.config.defaultTier
      )
    }
  }

  /**
   * Check if a request should be allowed
   */
  async check(request: Request, context?: { tenantId?: string; userId?: string; tier?: string }): Promise<RateLimitResult> {
    // Handle simulated storage failure
    if (this.simulateStorageFailure) {
      return this.handleStorageError()
    }

    const key = this.getKeyForRequest(request, context)
    const tier = this.getTierForKey(key, context)
    const tierConfig = this.getEffectiveTierConfig(tier, context)
    const now = Date.now()

    // Update LRU order for the key
    this.touchLRU(key)

    // Enforce maxEntries limit via LRU eviction
    this.enforceLRULimit()

    if (this.config.windowStrategy === 'sliding') {
      return this.checkSlidingWindow(key, tierConfig, now, tier)
    } else {
      return this.checkFixedWindow(key, tierConfig, now, tier)
    }
  }

  /**
   * Update LRU order - move key to end (most recently used)
   */
  private touchLRU(key: string): void {
    const index = this.lruOrder.indexOf(key)
    if (index !== -1) {
      // Remove from current position
      this.lruOrder.splice(index, 1)
    }
    // Add to end (most recently used)
    this.lruOrder.push(key)
  }

  /**
   * Enforce LRU eviction when maxEntries exceeded
   */
  private enforceLRULimit(): void {
    while (this.lruOrder.length > this.config.maxEntries) {
      // Remove least recently used (first in array)
      const lruKey = this.lruOrder.shift()
      if (lruKey) {
        this.slidingWindows.delete(lruKey)
        this.fixedWindows.delete(lruKey)
      }
    }
  }

  /**
   * Check sliding window rate limit
   */
  private checkSlidingWindow(
    key: string,
    tierConfig: RateLimitTier,
    now: number,
    tierName: string
  ): RateLimitResult {
    let state = this.slidingWindows.get(key)

    if (!state) {
      state = { requests: [] }
      this.slidingWindows.set(key, state)
    }

    // Remove expired requests (outside the window)
    const cutoff = now - tierConfig.windowMs
    state.requests = state.requests.filter((ts) => ts > cutoff)

    const firstRequest = state.requests[0]
    const windowResetsAt = firstRequest !== undefined
      ? Math.ceil((firstRequest + tierConfig.windowMs) / 1000)
      : Math.ceil((now + tierConfig.windowMs) / 1000)

    // Check if over limit
    if (state.requests.length >= tierConfig.requestsPerWindow) {
      const oldestRequestTime = state.requests[0] ?? now
      const retryAfterMs = oldestRequestTime + tierConfig.windowMs - now
      const retryAfterSec = Math.ceil(retryAfterMs / 1000)

      return {
        allowed: false,
        statusCode: 429,
        remaining: 0,
        limit: tierConfig.requestsPerWindow,
        resetAt: windowResetsAt,
        headers: this.buildHeaders(tierConfig.requestsPerWindow, 0, windowResetsAt, retryAfterSec),
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please retry later.',
        },
        retryAfter: retryAfterSec,
        key,
        tier: tierName,
      }
    }

    // Add this request
    state.requests.push(now)
    const remaining = Math.max(0, tierConfig.requestsPerWindow - state.requests.length)

    return {
      allowed: true,
      statusCode: 200,
      remaining,
      limit: tierConfig.requestsPerWindow,
      resetAt: windowResetsAt,
      headers: this.buildHeaders(tierConfig.requestsPerWindow, remaining, windowResetsAt),
      key,
      tier: tierName,
    }
  }

  /**
   * Check fixed window rate limit
   */
  private checkFixedWindow(
    key: string,
    tierConfig: RateLimitTier,
    now: number,
    tierName: string
  ): RateLimitResult {
    let state = this.fixedWindows.get(key)

    // Reset window if expired
    if (!state || now >= state.windowStart + tierConfig.windowMs) {
      state = { count: 0, windowStart: now }
      this.fixedWindows.set(key, state)
    }

    const windowResetsAt = Math.ceil((state.windowStart + tierConfig.windowMs) / 1000)

    // Check if over limit
    if (state.count >= tierConfig.requestsPerWindow) {
      const retryAfterMs = state.windowStart + tierConfig.windowMs - now
      const retryAfterSec = Math.ceil(retryAfterMs / 1000)

      return {
        allowed: false,
        statusCode: 429,
        remaining: 0,
        limit: tierConfig.requestsPerWindow,
        resetAt: windowResetsAt,
        headers: this.buildHeaders(tierConfig.requestsPerWindow, 0, windowResetsAt, retryAfterSec),
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please retry later.',
        },
        retryAfter: retryAfterSec,
        key,
        tier: tierName,
      }
    }

    // Increment count
    state.count++
    const remaining = Math.max(0, tierConfig.requestsPerWindow - state.count)

    return {
      allowed: true,
      statusCode: 200,
      remaining,
      limit: tierConfig.requestsPerWindow,
      resetAt: windowResetsAt,
      headers: this.buildHeaders(tierConfig.requestsPerWindow, remaining, windowResetsAt),
      key,
      tier: tierName,
    }
  }

  /**
   * Get the rate limit key for a request
   */
  getKeyForRequest(request: Request, context?: { tenantId?: string; userId?: string }): string {
    const tenantId = context?.tenantId ?? this.extractTenant(request)
    const userId = context?.userId ?? this.extractUser(request)
    const ip = this.extractIP(request)

    switch (this.config.keyStrategy) {
      case 'tenant':
        return `tenant:${tenantId}`
      case 'user':
        return `user:${userId}`
      case 'tenant+user':
        return `tenant:${tenantId}:user:${userId}`
      case 'ip':
        return `ip:${ip}`
      default:
        return `tenant:${tenantId}`
    }
  }

  /**
   * Extract tenant ID from request
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
      return hostParts[0] ?? 'default'
    }

    return 'default'
  }

  /**
   * Extract user ID from request
   */
  private extractUser(request: Request): string {
    // Check X-User-ID header
    const userHeader = request.headers.get('X-User-ID')
    if (userHeader) return userHeader

    // Check Authorization header for JWT (would decode in real impl)
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      // In real implementation, decode JWT and extract user ID
      // For now, use a hash of the token
      return `bearer:${authHeader.substring(7, 20)}`
    }

    return 'anonymous'
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
   * Get the tier name for a given key
   */
  private getTierForKey(_key: string, context?: { tier?: string }): string {
    // Explicit tier in context takes precedence
    if (context?.tier && this.config.tiers[context.tier]) {
      return context.tier
    }
    return this.config.defaultTier
  }

  /**
   * Get effective tier config (with overrides applied)
   */
  private getEffectiveTierConfig(tierName: string, context?: { tenantId?: string; userId?: string }): RateLimitTier {
    const baseTier = this.config.tiers[tierName] ?? this.config.tiers[this.config.defaultTier]
    if (!baseTier) {
      // This should not happen if constructor validation passed, but satisfy type checker
      return DEFAULT_TIERS['free']!
    }

    // Apply tenant overrides
    if (context?.tenantId) {
      const tenantOverride = this.config.tenantOverrides[context.tenantId]
      if (tenantOverride) {
        return { ...baseTier, name: tenantOverride.name ?? baseTier.name, requestsPerWindow: tenantOverride.requestsPerWindow ?? baseTier.requestsPerWindow, windowMs: tenantOverride.windowMs ?? baseTier.windowMs, burstCapacity: tenantOverride.burstCapacity ?? baseTier.burstCapacity }
      }
    }

    // Apply user overrides
    if (context?.userId) {
      const userOverride = this.config.userOverrides[context.userId]
      if (userOverride) {
        return { ...baseTier, name: userOverride.name ?? baseTier.name, requestsPerWindow: userOverride.requestsPerWindow ?? baseTier.requestsPerWindow, windowMs: userOverride.windowMs ?? baseTier.windowMs, burstCapacity: userOverride.burstCapacity ?? baseTier.burstCapacity }
      }
    }

    return baseTier
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
   * Handle storage error
   */
  private handleStorageError(): RateLimitResult {
    const allowed = this.config.failOpen
    const now = Date.now()
    const resetAt = Math.ceil((now + 60000) / 1000)

    return {
      allowed,
      statusCode: allowed ? 200 : 429,
      remaining: allowed ? 100 : 0,
      limit: 100,
      resetAt,
      headers: this.buildHeaders(100, allowed ? 100 : 0, resetAt),
      error: allowed ? undefined : { code: 'STORAGE_ERROR', message: 'Rate limit storage unavailable' },
      key: 'unknown',
      tier: this.config.defaultTier,
    }
  }

  /**
   * Reset rate limit state for a key
   */
  async resetKey(key: string): Promise<void> {
    this.slidingWindows.delete(key)
    this.fixedWindows.delete(key)
  }

  /**
   * Get current state for a key (for observability)
   */
  async getState(key: string): Promise<{ requests: number; windowMs: number; limit: number } | null> {
    const slidingState = this.slidingWindows.get(key)
    if (slidingState) {
      const tierConfig = this.config.tiers[this.config.defaultTier] ?? DEFAULT_TIERS['free']!
      return {
        requests: slidingState.requests.length,
        windowMs: tierConfig.windowMs,
        limit: tierConfig.requestsPerWindow,
      }
    }

    const fixedState = this.fixedWindows.get(key)
    if (fixedState) {
      const tierConfig = this.config.tiers[this.config.defaultTier] ?? DEFAULT_TIERS['free']!
      return {
        requests: fixedState.count,
        windowMs: tierConfig.windowMs,
        limit: tierConfig.requestsPerWindow,
      }
    }

    return null
  }

  /**
   * Simulate storage failure (for testing)
   * @internal
   */
  _simulateStorageFailure(fail: boolean): void {
    this.simulateStorageFailure = fail
  }

  /**
   * Clean up expired entries from both window maps
   * Removes entries where all requests have expired beyond the window duration
   *
   * @returns Number of entries removed during cleanup
   */
  async cleanup(): Promise<number> {
    const now = Date.now()
    const defaultTier = this.config.tiers[this.config.defaultTier] ?? DEFAULT_TIERS['free']!
    const windowMs = defaultTier.windowMs
    let entriesRemoved = 0

    // Clean sliding windows - remove entries with all requests expired
    for (const [key, state] of this.slidingWindows) {
      // Filter out expired requests
      const cutoff = now - windowMs
      state.requests = state.requests.filter((ts) => ts > cutoff)

      // If no requests remain, delete the entry
      if (state.requests.length === 0) {
        this.slidingWindows.delete(key)
        this.removeLRU(key)
        entriesRemoved++
      }
    }

    // Clean fixed windows - remove entries past their window
    for (const [key, state] of this.fixedWindows) {
      if (now >= state.windowStart + windowMs) {
        this.fixedWindows.delete(key)
        this.removeLRU(key)
        entriesRemoved++
      }
    }

    this.lastCleanup = now
    this.lastEntriesRemoved = entriesRemoved
    return entriesRemoved
  }

  /**
   * Remove key from LRU tracking
   */
  private removeLRU(key: string): void {
    const index = this.lruOrder.indexOf(key)
    if (index !== -1) {
      this.lruOrder.splice(index, 1)
    }
  }

  /**
   * Get metrics about the rate limiter's memory usage
   */
  async getMetrics(): Promise<RateLimiterMetrics> {
    return {
      slidingWindowCount: this.slidingWindows.size,
      fixedWindowCount: this.fixedWindows.size,
      totalEntries: this.slidingWindows.size + this.fixedWindows.size,
      lastCleanup: this.lastCleanup,
      entriesRemoved: this.lastEntriesRemoved,
    }
  }

  /**
   * Get the current configuration
   */
  getConfig(): InternalRateLimitConfig {
    return { ...this.config }
  }

  /**
   * Start automatic periodic cleanup
   */
  startAutoCleanup(): void {
    // Don't start multiple intervals
    if (this.cleanupIntervalId !== null) {
      return
    }

    this.cleanupIntervalId = setInterval(async () => {
      await this.cleanup()
    }, this.config.cleanupIntervalMs)
  }

  /**
   * Stop automatic periodic cleanup
   */
  stopAutoCleanup(): void {
    if (this.cleanupIntervalId !== null) {
      clearInterval(this.cleanupIntervalId)
      this.cleanupIntervalId = null
    }
  }
}

// ============================================================================
// HONO MIDDLEWARE
// ============================================================================

/**
 * Create rate limit middleware for Hono
 *
 * @param config - Rate limit configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { rateLimitMiddleware } from './middleware/rate-limit'
 *
 * // Per-tenant rate limiting
 * app.use('/api/*', rateLimitMiddleware({
 *   keyStrategy: 'tenant',
 *   defaultTier: 'free',
 * }))
 *
 * // Per-user rate limiting with custom tiers
 * app.use('/api/*', rateLimitMiddleware({
 *   keyStrategy: 'user',
 *   tiers: {
 *     basic: { name: 'basic', requestsPerWindow: 50, windowMs: 60000 },
 *     premium: { name: 'premium', requestsPerWindow: 500, windowMs: 60000 },
 *   },
 *   defaultTier: 'basic',
 * }))
 * ```
 */
export function rateLimitMiddleware(config: RateLimitConfig): MiddlewareHandler {
  const rateLimiter = new RateLimiter(config)

  return async (c: Context, next: Next): Promise<Response | void> => {
    // Check if path should be skipped
    const path = new URL(c.req.url).pathname
    if (config.skipPaths?.some((skip) => path.startsWith(skip))) {
      return next()
    }

    // Extract context from Hono context or request headers (for overrides to work)
    const tenantId = c.get('tenantId') as string | undefined ?? c.req.header('X-Tenant-ID')
    const userId = c.get('userId') as string | undefined ?? c.req.header('X-User-ID')
    const tier = c.get('tier') as string | undefined

    const result = await rateLimiter.check(c.req.raw, {
      ...(tenantId !== undefined && { tenantId }),
      ...(userId !== undefined && { userId }),
      ...(tier !== undefined && { tier }),
    })

    // Set rate limit headers on context
    for (const [key, value] of Object.entries(result.headers)) {
      c.header(key, value)
    }

    // If rate limited, return 429 response with standard RPCError format
    if (!result.allowed) {
      const rateLimitError = RateLimitError.exceeded({
        limit: result.limit,
        window: `${Math.round(60000 / 1000)}s`, // Assumes 60s window, could be configurable
        ...(result.retryAfter !== undefined && { retryAfter: result.retryAfter }),
      })
      return c.json(rateLimitError.toJSON(), rateLimitError.httpStatus)
    }

    // Store rate limit info in context for downstream use
    c.set('rateLimit', {
      allowed: result.allowed,
      remaining: result.remaining,
      limit: result.limit,
      resetAt: result.resetAt,
      key: result.key,
      tier: result.tier,
    })

    // Continue to next middleware/handler
    await next()
  }
}

/**
 * Create a rate limiter instance (for use outside middleware)
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  return new RateLimiter(config)
}

export default rateLimitMiddleware
