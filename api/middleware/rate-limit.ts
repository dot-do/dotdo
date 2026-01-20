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
 * - Distributed state via Durable Objects (do-h6df)
 *
 * @module api/middleware/rate-limit
 * @issue do-vytw - Add rate limiting per-tenant/per-user
 * @issue do-h6df - Rate limiter state not distributed across workers
 */

import type { Context, MiddlewareHandler, Next } from 'hono'
import { RateLimitError, ValidationError } from '../../rpc/errors'
import type { RateLimitCheckParams, RateLimitCheckResult } from './RateLimiterDO'

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
  burstCapacity?: number
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
 * Durable Object namespace for rate limiting
 */
export interface RateLimiterDONamespace {
  idFromName(name: string): { toString(): string }
  get(id: { toString(): string }): RateLimiterDOStub
}

/**
 * DO stub interface for rate limiter
 */
export interface RateLimiterDOStub {
  fetch(request: Request): Promise<Response>
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
}

/**
 * Distributed rate limiter configuration (extends base config with DO namespace)
 */
export interface DistributedRateLimitConfig extends RateLimitConfig {
  /** Durable Object namespace for distributed state */
  rateLimiterDO: RateLimiterDONamespace
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
  error?: { code: string; message: string }
  /** Retry after in seconds (only when rate limited) */
  retryAfter?: number
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

// ============================================================================
// RATE LIMITER CLASS
// ============================================================================

/**
 * Rate Limiter using sliding window algorithm
 *
 * Tracks request timestamps per key and enforces limits based on tier configuration.
 */
export class RateLimiter {
  private readonly config: Required<RateLimitConfig>
  private readonly slidingWindows: Map<string, SlidingWindowState> = new Map()
  private readonly fixedWindows: Map<string, FixedWindowState> = new Map()
  private simulateStorageFailure = false

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

    if (this.config.windowStrategy === 'sliding') {
      return this.checkSlidingWindow(key, tierConfig, now, tier)
    } else {
      return this.checkFixedWindow(key, tierConfig, now, tier)
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
}

// ============================================================================
// DISTRIBUTED RATE LIMITER (DO-BACKED)
// ============================================================================

/**
 * Distributed Rate Limiter using Durable Objects
 *
 * Routes rate limit checks to a RateLimiterDO instance, ensuring consistent
 * state across all worker instances. This solves the issue (do-h6df) where
 * in-memory Maps don't share state across workers.
 *
 * The DO instance is selected based on a hash of the rate limit key, which
 * provides natural sharding and load distribution.
 *
 * @example
 * ```typescript
 * // In worker
 * const rateLimiter = new DistributedRateLimiter({
 *   keyStrategy: 'tenant',
 *   rateLimiterDO: env.RATE_LIMITER,
 * })
 *
 * const result = await rateLimiter.check(request)
 * ```
 */
export class DistributedRateLimiter {
  private readonly config: Required<Omit<DistributedRateLimitConfig, 'rateLimiterDO'>> & { rateLimiterDO: RateLimiterDONamespace }
  private simulateStorageFailure = false

  constructor(config: DistributedRateLimitConfig) {
    this.config = {
      keyStrategy: config.keyStrategy,
      defaultTier: config.defaultTier ?? 'free',
      tiers: { ...DEFAULT_TIERS, ...config.tiers },
      tenantOverrides: config.tenantOverrides ?? {},
      userOverrides: config.userOverrides ?? {},
      failOpen: config.failOpen ?? true,
      windowStrategy: config.windowStrategy ?? 'sliding',
      skipPaths: config.skipPaths ?? [],
      rateLimiterDO: config.rateLimiterDO,
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
   * Check if a request should be allowed (distributed version)
   */
  async check(request: Request, context?: { tenantId?: string; userId?: string; tier?: string }): Promise<RateLimitResult> {
    // Handle simulated storage failure
    if (this.simulateStorageFailure) {
      return this.handleStorageError()
    }

    const key = this.getKeyForRequest(request, context)
    const tier = this.getTierForKey(key, context)
    const tierConfig = this.getEffectiveTierConfig(tier, context)

    try {
      // Get DO instance based on key (provides natural sharding)
      const doId = this.config.rateLimiterDO.idFromName(this.getDONameForKey(key))
      const stub = this.config.rateLimiterDO.get(doId)

      // Make RPC call to DO
      const params: RateLimitCheckParams = {
        key,
        windowMs: tierConfig.windowMs,
        limit: tierConfig.requestsPerWindow,
        windowStrategy: this.config.windowStrategy,
      }

      const response = await stub.fetch(new Request('https://rate-limiter/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }))

      if (!response.ok) {
        throw new Error(`Rate limiter DO returned ${response.status}`)
      }

      const result = await response.json() as RateLimitCheckResult

      // Build full result with headers
      const retryAfterSec = result.retryAfterMs ? Math.ceil(result.retryAfterMs / 1000) : undefined

      return {
        allowed: result.allowed,
        statusCode: result.allowed ? 200 : 429,
        remaining: result.remaining,
        limit: tierConfig.requestsPerWindow,
        resetAt: result.resetAt,
        headers: this.buildHeaders(tierConfig.requestsPerWindow, result.remaining, result.resetAt, retryAfterSec),
        error: result.allowed ? undefined : {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please retry later.',
        },
        retryAfter: retryAfterSec,
        key,
        tier,
      }
    } catch (error) {
      // Handle DO communication failure
      console.error('[DistributedRateLimiter] DO communication error:', error)
      return this.handleStorageError(key, tier)
    }
  }

  /**
   * Get DO name for a key (groups related keys to same DO for efficiency)
   *
   * Strategy: Use the first part of the key (tenant/user/ip identifier) to route
   * to a specific DO. This ensures all rate limits for a given entity go to the
   * same DO, while distributing load across DOs.
   */
  private getDONameForKey(key: string): string {
    // Extract primary identifier from key
    // tenant:acme -> rate-limiter:tenant:acme
    // user:user-123 -> rate-limiter:user:user-123
    // tenant:acme:user:user-123 -> rate-limiter:tenant:acme
    // ip:192.168.1.1 -> rate-limiter:ip:192.168.1.1
    const parts = key.split(':')
    if (parts.length >= 2) {
      return `rate-limiter:${parts[0]}:${parts[1]}`
    }
    return `rate-limiter:${key}`
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
    const tenantHeader = request.headers.get('X-Tenant-ID')
    if (tenantHeader) return tenantHeader

    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')

    if (hostParts.length >= 4) {
      return hostParts[0] ?? 'default'
    }

    return 'default'
  }

  /**
   * Extract user ID from request
   */
  private extractUser(request: Request): string {
    const userHeader = request.headers.get('X-User-ID')
    if (userHeader) return userHeader

    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      return `bearer:${authHeader.substring(7, 20)}`
    }

    return 'anonymous'
  }

  /**
   * Extract IP address from request
   */
  private extractIP(request: Request): string {
    const cfIP = request.headers.get('CF-Connecting-IP')
    if (cfIP) return cfIP

    const realIP = request.headers.get('X-Real-IP')
    if (realIP) return realIP

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
      return DEFAULT_TIERS['free']!
    }

    if (context?.tenantId) {
      const tenantOverride = this.config.tenantOverrides[context.tenantId]
      if (tenantOverride) {
        return {
          ...baseTier,
          name: tenantOverride.name ?? baseTier.name,
          requestsPerWindow: tenantOverride.requestsPerWindow ?? baseTier.requestsPerWindow,
          windowMs: tenantOverride.windowMs ?? baseTier.windowMs,
          burstCapacity: tenantOverride.burstCapacity ?? baseTier.burstCapacity,
        }
      }
    }

    if (context?.userId) {
      const userOverride = this.config.userOverrides[context.userId]
      if (userOverride) {
        return {
          ...baseTier,
          name: userOverride.name ?? baseTier.name,
          requestsPerWindow: userOverride.requestsPerWindow ?? baseTier.requestsPerWindow,
          windowMs: userOverride.windowMs ?? baseTier.windowMs,
          burstCapacity: userOverride.burstCapacity ?? baseTier.burstCapacity,
        }
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
   * Handle storage/DO error
   */
  private handleStorageError(key = 'unknown', tier?: string): RateLimitResult {
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
      key,
      tier: tier ?? this.config.defaultTier,
    }
  }

  /**
   * Reset rate limit state for a key (distributed version)
   */
  async resetKey(key: string): Promise<void> {
    try {
      const doId = this.config.rateLimiterDO.idFromName(this.getDONameForKey(key))
      const stub = this.config.rateLimiterDO.get(doId)

      await stub.fetch(new Request('https://rate-limiter/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      }))
    } catch (error) {
      console.error('[DistributedRateLimiter] Failed to reset key:', error)
    }
  }

  /**
   * Get current state for a key (for observability)
   */
  async getState(key: string): Promise<{ requests: number; windowMs: number; limit: number } | null> {
    try {
      const doId = this.config.rateLimiterDO.idFromName(this.getDONameForKey(key))
      const stub = this.config.rateLimiterDO.get(doId)

      const response = await stub.fetch(new Request(`https://rate-limiter/state/${encodeURIComponent(key)}`, {
        method: 'GET',
      }))

      if (!response.ok) {
        return null
      }

      const state = await response.json() as { requests?: number; found?: boolean }
      if (!state.found) {
        return null
      }

      const tierConfig = this.config.tiers[this.config.defaultTier] ?? DEFAULT_TIERS['free']!
      return {
        requests: state.requests ?? 0,
        windowMs: tierConfig.windowMs,
        limit: tierConfig.requestsPerWindow,
      }
    } catch (error) {
      console.error('[DistributedRateLimiter] Failed to get state:', error)
      return null
    }
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

    // Extract context from Hono context (if available)
    const tenantId = c.get('tenantId') as string | undefined
    const userId = c.get('userId') as string | undefined
    const tier = c.get('tier') as string | undefined

    const result = await rateLimiter.check(c.req.raw, { tenantId, userId, tier })

    // Set rate limit headers on context
    for (const [key, value] of Object.entries(result.headers)) {
      c.header(key, value)
    }

    // If rate limited, return 429 response with standard RPCError format
    if (!result.allowed) {
      const rateLimitError = RateLimitError.exceeded({
        limit: result.limit,
        window: `${Math.round(60000 / 1000)}s`, // Assumes 60s window, could be configurable
        retryAfter: result.retryAfter,
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

/**
 * Create a distributed rate limiter instance (DO-backed)
 */
export function createDistributedRateLimiter(config: DistributedRateLimitConfig): DistributedRateLimiter {
  return new DistributedRateLimiter(config)
}

// ============================================================================
// DISTRIBUTED HONO MIDDLEWARE
// ============================================================================

/**
 * Create distributed rate limit middleware for Hono (DO-backed)
 *
 * This middleware uses Durable Objects for state storage, ensuring rate limits
 * work correctly across multiple worker instances.
 *
 * @param config - Distributed rate limit configuration (includes DO namespace)
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { distributedRateLimitMiddleware } from './middleware/rate-limit'
 *
 * // In your worker
 * app.use('/api/*', distributedRateLimitMiddleware({
 *   keyStrategy: 'tenant',
 *   defaultTier: 'free',
 *   rateLimiterDO: env.RATE_LIMITER, // DO namespace from env
 * }))
 * ```
 */
export function distributedRateLimitMiddleware(config: DistributedRateLimitConfig): MiddlewareHandler {
  const rateLimiter = new DistributedRateLimiter(config)

  return async (c: Context, next: Next): Promise<Response | void> => {
    // Check if path should be skipped
    const path = new URL(c.req.url).pathname
    if (config.skipPaths?.some((skip) => path.startsWith(skip))) {
      return next()
    }

    // Extract context from Hono context (if available)
    const tenantId = c.get('tenantId') as string | undefined
    const userId = c.get('userId') as string | undefined
    const tier = c.get('tier') as string | undefined

    const result = await rateLimiter.check(c.req.raw, { tenantId, userId, tier })

    // Set rate limit headers on context
    for (const [key, value] of Object.entries(result.headers)) {
      c.header(key, value)
    }

    // If rate limited, return 429 response with standard RPCError format
    if (!result.allowed) {
      const rateLimitError = RateLimitError.exceeded({
        limit: result.limit,
        window: `${Math.round(60000 / 1000)}s`,
        retryAfter: result.retryAfter,
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

export default rateLimitMiddleware
