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
 * Per-user/tenant rate limit configuration
 */
export interface UserTenantRateLimit {
  /** Requests allowed per window for this user/tenant */
  requestsPerWindow: number
  /** Window duration in milliseconds */
  windowMs: number
}

/**
 * Function to extract user/tenant ID from request
 */
export type UserTenantExtractor = (request: Request) => string | null

/**
 * Tier resolver function - determines which tier a user/tenant belongs to
 */
export type TierResolver = (userId: string | null, tenantId: string | null) => RPCRateLimitTier | null

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
  /** Per-user rate limit (applied in addition to per-method limits) */
  userLimit?: UserTenantRateLimit
  /** Per-tenant rate limit (applied in addition to per-method limits) */
  tenantLimit?: UserTenantRateLimit
  /** Function to extract user ID from request (default: uses X-User-ID header) */
  userExtractor?: UserTenantExtractor
  /** Function to extract tenant ID from request (default: uses X-Tenant-ID header) */
  tenantExtractor?: UserTenantExtractor
  /** Function to resolve tier based on user/tenant (for dynamic tier assignment) */
  tierResolver?: TierResolver
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
 * - Per-user limits (across all methods for a user)
 * - Per-tenant limits (across all methods for a tenant)
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
   *
   * Checks limits in order (first rejection wins):
   * 1. Per-tenant limit (if configured)
   * 2. Per-user limit (if configured)
   * 3. Per-method/endpoint limit
   *
   * All applicable limits must pass for request to be allowed.
   */
  check(request: Request, method: string): RPCRateLimitResult {
    // Check if method should skip rate limiting
    if (this.config.skipMethods.includes(method)) {
      return this.createAllowedResult(request, method, Infinity, 60000)
    }

    const now = Date.now()

    // Check tenant limit first (broadest scope)
    const tenantResult = this.checkTenantLimit(request, method, now)
    if (tenantResult && !tenantResult.allowed) {
      return tenantResult
    }

    // Check user limit second
    const userResult = this.checkUserLimit(request, method, now)
    if (userResult && !userResult.allowed) {
      return userResult
    }

    // Check per-method/endpoint limit last (narrowest scope)
    const key = this.getKey(request, method)
    const limits = this.getLimitsForMethod(request, method)
    const methodResult = this.checkSlidingWindow(key, method, limits, now)

    // Combine headers from all checks if all passed
    if (methodResult.allowed) {
      const combinedHeaders = { ...methodResult.headers }
      if (tenantResult) {
        Object.assign(combinedHeaders, this.prefixHeaders(tenantResult.headers, 'Tenant'))
      }
      if (userResult) {
        Object.assign(combinedHeaders, this.prefixHeaders(userResult.headers, 'User'))
      }
      return { ...methodResult, headers: combinedHeaders }
    }

    return methodResult
  }

  /**
   * Check tenant-level rate limit
   */
  private checkTenantLimit(request: Request, method: string, now: number): RPCRateLimitResult | null {
    if (!this.config.tenantLimit) {
      return null
    }

    const tenantId = this.extractTenantId(request)
    if (!tenantId) {
      return null // No tenant, skip tenant limit
    }

    const key = `tenant:${tenantId}`
    return this.checkSlidingWindow(key, method, this.config.tenantLimit, now, 'tenant')
  }

  /**
   * Check user-level rate limit
   */
  private checkUserLimit(request: Request, method: string, now: number): RPCRateLimitResult | null {
    if (!this.config.userLimit) {
      return null
    }

    const userId = this.extractUserId(request)
    if (!userId) {
      return null // No user, skip user limit
    }

    const key = `user:${userId}`
    return this.checkSlidingWindow(key, method, this.config.userLimit, now, 'user')
  }

  /**
   * Extract user ID from request
   */
  private extractUserId(request: Request): string | null {
    if (this.config.userExtractor) {
      return this.config.userExtractor(request)
    }

    // Default: use X-User-ID header
    return request.headers.get('X-User-ID')
  }

  /**
   * Extract tenant ID from request
   */
  private extractTenantId(request: Request): string | null {
    if (this.config.tenantExtractor) {
      return this.config.tenantExtractor(request)
    }

    // Default: use X-Tenant-ID header
    return request.headers.get('X-Tenant-ID')
  }

  /**
   * Prefix rate limit headers for user/tenant scopes
   */
  private prefixHeaders(headers: Record<string, string>, scope: string): Record<string, string> {
    const prefixed: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
      // Transform X-RateLimit-Limit → X-RateLimit-Tenant-Limit
      if (key.startsWith('X-RateLimit-')) {
        const suffix = key.replace('X-RateLimit-', '')
        prefixed[`X-RateLimit-${scope}-${suffix}`] = value
      } else if (key === 'Retry-After') {
        // Don't prefix Retry-After, the main one is used
      } else {
        prefixed[`X-${scope}-${key}`] = value
      }
    }
    return prefixed
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
   * Priority: tier resolver > per-method > pattern > global > default tier
   */
  private getLimitsForMethod(request: Request, method: string): MethodRateLimit {
    // Check tier resolver first (dynamic tier based on user/tenant)
    if (this.config.tierResolver) {
      const userId = this.extractUserId(request)
      const tenantId = this.extractTenantId(request)
      const resolvedTier = this.config.tierResolver(userId, tenantId)
      if (resolvedTier) {
        return {
          requestsPerWindow: resolvedTier.requestsPerWindow,
          windowMs: resolvedTier.windowMs,
        }
      }
    }

    // Check per-method limits
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
   * Get default limits (for observability when no request is available)
   */
  private getDefaultLimits(): MethodRateLimit {
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
   * @param key - The rate limit key
   * @param method - The method being called
   * @param limits - The rate limit configuration
   * @param now - Current timestamp
   * @param scope - Optional scope identifier ('user', 'tenant', or undefined for method-level)
   */
  private checkSlidingWindow(
    key: string,
    method: string,
    limits: MethodRateLimit | UserTenantRateLimit,
    now: number,
    scope?: 'user' | 'tenant'
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
        headers: this.buildHeaders(limits.requestsPerWindow, 0, windowResetsAt, retryAfterSec, scope),
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
      headers: this.buildHeaders(limits.requestsPerWindow, remaining, windowResetsAt, undefined, scope),
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
   * @param limit - The rate limit
   * @param remaining - Remaining requests
   * @param resetAt - When the window resets (Unix timestamp)
   * @param retryAfterSec - Retry after in seconds (only when rate limited)
   * @param scope - Optional scope for header naming ('user' or 'tenant')
   */
  private buildHeaders(
    limit: number,
    remaining: number,
    resetAt: number,
    retryAfterSec?: number,
    scope?: 'user' | 'tenant'
  ): Record<string, string> {
    // Use scope-specific header names if scope is provided
    const scopePrefix = scope ? `-${scope.charAt(0).toUpperCase()}${scope.slice(1)}` : ''
    const headers: Record<string, string> = {
      [`X-RateLimit${scopePrefix}-Limit`]: String(limit),
      [`X-RateLimit${scopePrefix}-Remaining`]: String(remaining),
      [`X-RateLimit${scopePrefix}-Reset`]: String(resetAt),
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
   * Reset rate limit state for a specific user
   */
  resetUser(userId: string): void {
    const key = `user:${userId}`
    this.slidingWindows.delete(key)
  }

  /**
   * Reset rate limit state for a specific tenant
   */
  resetTenant(tenantId: string): void {
    const key = `tenant:${tenantId}`
    this.slidingWindows.delete(key)
  }

  /**
   * Get current state for a key (for observability)
   */
  getState(key: string): { requests: number; windowMs: number; limit: number } | null {
    const state = this.slidingWindows.get(key)
    if (!state) return null

    // Determine limits based on key type
    let limits: MethodRateLimit | UserTenantRateLimit

    if (key.startsWith('user:') && this.config.userLimit) {
      limits = this.config.userLimit
    } else if (key.startsWith('tenant:') && this.config.tenantLimit) {
      limits = this.config.tenantLimit
    } else {
      // For method-based keys, use default limits for observability
      limits = this.getDefaultLimits()
    }

    return {
      requests: state.requests.length,
      windowMs: limits.windowMs,
      limit: limits.requestsPerWindow,
    }
  }

  /**
   * Get state for a user's rate limit
   */
  getUserState(userId: string): { requests: number; windowMs: number; limit: number } | null {
    return this.getState(`user:${userId}`)
  }

  /**
   * Get state for a tenant's rate limit
   */
  getTenantState(tenantId: string): { requests: number; windowMs: number; limit: number } | null {
    return this.getState(`tenant:${tenantId}`)
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
