/**
 * Rate Limiting Middleware for Hono
 *
 * Provides per-tenant and per-user rate limiting using sliding window algorithm.
 * State can be persisted to SQLite for distributed rate limiting across DO restarts.
 *
 * Features:
 * - Per-tenant rate limiting
 * - Per-user rate limiting
 * - Configurable limits per tier (free, pro, enterprise)
 * - Sliding window algorithm
 * - Proper rate limit headers (X-RateLimit-*)
 * - 429 Too Many Requests responses
 * - SQLite persistence for state across DO restarts (do-svo4)
 * - TTL cleanup for expired entries
 *
 * @module api/middleware/rate-limit
 * @issue do-vytw - Add rate limiting per-tenant/per-user
 * @issue do-svo4 - Fix rate limiter in-memory storage
 */

import type { Context, MiddlewareHandler, Next } from 'hono'
import { RateLimitError, ValidationError } from '../../rpc/errors'

// ============================================================================
// TYPES
// ============================================================================

/**
 * SQLite storage interface for rate limiting
 * Compatible with DurableObjectState.storage.sql
 */
export interface RateLimitSqlStorage {
  exec<T = unknown>(query: string, ...params: unknown[]): { toArray(): T[] }
}

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
  /**
   * SQLite storage for persistent rate limiting across DO restarts.
   * When provided, rate limit state is stored in SQLite instead of in-memory.
   * Pass `state.storage.sql` from DurableObjectState for persistence.
   * @issue do-svo4 - Fix rate limiter in-memory storage
   */
  storage?: RateLimitSqlStorage
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
 * Internal config type that keeps storage optional
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
  storage?: RateLimitSqlStorage
}

/**
 * Rate Limiter using sliding window algorithm
 *
 * Tracks request timestamps per key and enforces limits based on tier configuration.
 * Supports both in-memory storage (default) and SQLite persistence for DO restarts.
 *
 * @issue do-svo4 - Added SQLite storage support for persistence
 */
export class RateLimiter {
  private readonly config: InternalRateLimitConfig
  private readonly slidingWindows: Map<string, SlidingWindowState> = new Map()
  private readonly fixedWindows: Map<string, FixedWindowState> = new Map()
  private simulateStorageFailure = false
  private initialized = false

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
      storage: config.storage,
    }

    // Validate tiers
    if (!this.config.tiers[this.config.defaultTier]) {
      throw ValidationError.forField(
        'defaultTier',
        `must reference an existing tier (got '${this.config.defaultTier}')`,
        this.config.defaultTier
      )
    }

    // Initialize SQLite schema if storage is provided
    if (this.config.storage) {
      this.initializeSqliteSchema()
    }
  }

  /**
   * Initialize SQLite schema for persistent storage
   * @issue do-svo4 - Fix rate limiter in-memory storage
   */
  private initializeSqliteSchema(): void {
    if (!this.config.storage || this.initialized) return

    try {
      // Create sliding window table
      this.config.storage.exec(`
        CREATE TABLE IF NOT EXISTS rate_limit_sliding_window (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL,
          timestamp_ms INTEGER NOT NULL
        )
      `)

      // Create index for efficient queries and cleanup
      this.config.storage.exec(`
        CREATE INDEX IF NOT EXISTS idx_rate_limit_sliding_key_ts
        ON rate_limit_sliding_window (key, timestamp_ms)
      `)

      // Create fixed window table
      this.config.storage.exec(`
        CREATE TABLE IF NOT EXISTS rate_limit_fixed_window (
          key TEXT PRIMARY KEY,
          window_start_ms INTEGER NOT NULL,
          count INTEGER NOT NULL DEFAULT 0
        )
      `)

      this.initialized = true
    } catch (_err) {
      // Schema might already exist, ignore
      this.initialized = true
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
   * Uses SQLite storage if available, otherwise falls back to in-memory
   * @issue do-svo4 - Added SQLite persistence support
   */
  private checkSlidingWindow(
    key: string,
    tierConfig: RateLimitTier,
    now: number,
    tierName: string
  ): RateLimitResult {
    // Use SQLite storage if available
    if (this.config.storage) {
      return this.checkSlidingWindowSql(key, tierConfig, now, tierName)
    }

    // Fall back to in-memory storage
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
   * Check sliding window rate limit using SQLite storage
   * @issue do-svo4 - Fix rate limiter in-memory storage
   */
  private checkSlidingWindowSql(
    key: string,
    tierConfig: RateLimitTier,
    now: number,
    tierName: string
  ): RateLimitResult {
    const storage = this.config.storage!
    const cutoff = now - tierConfig.windowMs

    // Clean up expired entries (TTL cleanup)
    storage.exec(
      `DELETE FROM rate_limit_sliding_window WHERE key = ? AND timestamp_ms <= ?`,
      key,
      cutoff
    )

    // Count current requests
    const countResult = storage.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM rate_limit_sliding_window WHERE key = ?`,
      key
    ).toArray()

    const currentCount = countResult[0]?.count ?? 0

    // Get first request timestamp for reset calculation
    const firstResult = storage.exec<{ first_ts: number | null }>(
      `SELECT MIN(timestamp_ms) as first_ts FROM rate_limit_sliding_window WHERE key = ?`,
      key
    ).toArray()

    const firstTs = firstResult[0]?.first_ts ?? now
    const windowResetsAt = Math.ceil((firstTs + tierConfig.windowMs) / 1000)

    // Check if over limit
    if (currentCount >= tierConfig.requestsPerWindow) {
      const retryAfterMs = firstTs + tierConfig.windowMs - now
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

    // Record this request
    storage.exec(
      `INSERT INTO rate_limit_sliding_window (key, timestamp_ms) VALUES (?, ?)`,
      key,
      now
    )

    const remaining = Math.max(0, tierConfig.requestsPerWindow - currentCount - 1)

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
   * Uses SQLite storage if available, otherwise falls back to in-memory
   * @issue do-svo4 - Added SQLite persistence support
   */
  private checkFixedWindow(
    key: string,
    tierConfig: RateLimitTier,
    now: number,
    tierName: string
  ): RateLimitResult {
    // Use SQLite storage if available
    if (this.config.storage) {
      return this.checkFixedWindowSql(key, tierConfig, now, tierName)
    }

    // Fall back to in-memory storage
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
   * Check fixed window rate limit using SQLite storage
   * @issue do-svo4 - Fix rate limiter in-memory storage
   */
  private checkFixedWindowSql(
    key: string,
    tierConfig: RateLimitTier,
    now: number,
    tierName: string
  ): RateLimitResult {
    const storage = this.config.storage!

    // Get current window state
    const windowResult = storage.exec<{ window_start_ms: number; count: number }>(
      `SELECT window_start_ms, count FROM rate_limit_fixed_window WHERE key = ?`,
      key
    ).toArray()

    let windowStart = now
    let currentCount = 0

    if (windowResult.length > 0) {
      const entry = windowResult[0]!
      // Check if window has expired
      if (now >= entry.window_start_ms + tierConfig.windowMs) {
        // Reset window (TTL cleanup)
        storage.exec(
          `UPDATE rate_limit_fixed_window SET window_start_ms = ?, count = 0 WHERE key = ?`,
          now,
          key
        )
        windowStart = now
        currentCount = 0
      } else {
        windowStart = entry.window_start_ms
        currentCount = entry.count
      }
    } else {
      // Create new entry
      storage.exec(
        `INSERT INTO rate_limit_fixed_window (key, window_start_ms, count) VALUES (?, ?, 0)`,
        key,
        now
      )
    }

    const windowResetsAt = Math.ceil((windowStart + tierConfig.windowMs) / 1000)

    // Check if over limit
    if (currentCount >= tierConfig.requestsPerWindow) {
      const retryAfterMs = windowStart + tierConfig.windowMs - now
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
    storage.exec(
      `UPDATE rate_limit_fixed_window SET count = count + 1 WHERE key = ?`,
      key
    )

    const remaining = Math.max(0, tierConfig.requestsPerWindow - currentCount - 1)

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
   * Uses SQLite storage if available, otherwise falls back to in-memory
   * @issue do-svo4 - Added SQLite persistence support
   */
  async resetKey(key: string): Promise<void> {
    if (this.config.storage) {
      this.config.storage.exec(`DELETE FROM rate_limit_sliding_window WHERE key = ?`, key)
      this.config.storage.exec(`DELETE FROM rate_limit_fixed_window WHERE key = ?`, key)
    }

    // Also clear in-memory cache
    this.slidingWindows.delete(key)
    this.fixedWindows.delete(key)
  }

  /**
   * Get current state for a key (for observability)
   * Uses SQLite storage if available, otherwise falls back to in-memory
   * @issue do-svo4 - Added SQLite persistence support
   */
  async getState(key: string): Promise<{ requests: number; windowMs: number; limit: number } | null> {
    const tierConfig = this.config.tiers[this.config.defaultTier] ?? DEFAULT_TIERS['free']!

    // Use SQLite storage if available
    if (this.config.storage) {
      // Check sliding window
      const slidingResult = this.config.storage.exec<{ count: number }>(
        `SELECT COUNT(*) as count FROM rate_limit_sliding_window WHERE key = ?`,
        key
      ).toArray()

      if (slidingResult.length > 0 && slidingResult[0]!.count > 0) {
        return {
          requests: slidingResult[0]!.count,
          windowMs: tierConfig.windowMs,
          limit: tierConfig.requestsPerWindow,
        }
      }

      // Check fixed window
      const fixedResult = this.config.storage.exec<{ count: number }>(
        `SELECT count FROM rate_limit_fixed_window WHERE key = ?`,
        key
      ).toArray()

      if (fixedResult.length > 0) {
        return {
          requests: fixedResult[0]!.count,
          windowMs: tierConfig.windowMs,
          limit: tierConfig.requestsPerWindow,
        }
      }

      return null
    }

    // Fall back to in-memory storage
    const slidingState = this.slidingWindows.get(key)
    if (slidingState) {
      return {
        requests: slidingState.requests.length,
        windowMs: tierConfig.windowMs,
        limit: tierConfig.requestsPerWindow,
      }
    }

    const fixedState = this.fixedWindows.get(key)
    if (fixedState) {
      return {
        requests: fixedState.count,
        windowMs: tierConfig.windowMs,
        limit: tierConfig.requestsPerWindow,
      }
    }

    return null
  }

  /**
   * Clean up expired entries from SQLite storage.
   * This is called automatically during rate limit checks, but can be called
   * manually for periodic cleanup.
   * @issue do-svo4 - Added TTL cleanup
   */
  async cleanupExpiredEntries(windowMs: number = 60000): Promise<void> {
    if (!this.config.storage) return

    const cutoff = Date.now() - windowMs
    this.config.storage.exec(
      `DELETE FROM rate_limit_sliding_window WHERE timestamp_ms <= ?`,
      cutoff
    )
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

export default rateLimitMiddleware
