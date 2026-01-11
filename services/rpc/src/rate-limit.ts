/**
 * RPC.do Gateway Rate Limiting
 *
 * Rate limiting per tenant and agent with support for:
 * - Multiple time windows (second, minute, hour, day)
 * - Concurrency limits
 * - Burst allowances
 * - Tier-based limits
 *
 * @module services/rpc/rate-limit
 */

import type { Context, MiddlewareHandler, Next } from 'hono'
import type { RateLimitConfig, RateLimitResult, AuthContext } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Rate limit key generator
 */
export type KeyGenerator = (c: Context) => string

/**
 * Rate limit store interface
 */
export interface RateLimitStore {
  /**
   * Check and increment rate limit counter
   * @returns Rate limit result
   */
  check(key: string, config: RateLimitConfig): Promise<RateLimitResult>

  /**
   * Acquire a concurrency slot
   * @returns true if slot acquired, false if at limit
   */
  acquireConcurrency?(key: string, limit: number): Promise<boolean>

  /**
   * Release a concurrency slot
   */
  releaseConcurrency?(key: string): Promise<void>
}

/**
 * Rate limit middleware options
 */
export interface RateLimitOptions {
  /** Rate limit store */
  store: RateLimitStore
  /** Key generator (default: tenant ID) */
  keyGenerator?: KeyGenerator
  /** Default rate limit config */
  defaultConfig?: RateLimitConfig
  /** Config by tier */
  tierConfigs?: Record<string, RateLimitConfig>
  /** Custom response generator */
  onRateLimited?: (c: Context, result: RateLimitResult) => Response | Promise<Response>
  /** Paths to exclude from rate limiting */
  excludePaths?: string[]
  /** Whether to skip rate limiting for admins */
  skipAdmin?: boolean
}

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default rate limit tiers
 */
export const DEFAULT_TIER_CONFIGS: Record<string, RateLimitConfig> = {
  free: {
    rpm: 60,
    rph: 1000,
    rpd: 10000,
    concurrency: 5,
    burst: 10,
  },
  pro: {
    rpm: 300,
    rph: 10000,
    rpd: 100000,
    concurrency: 20,
    burst: 50,
  },
  enterprise: {
    rpm: 1000,
    rph: 50000,
    rpd: 500000,
    concurrency: 100,
    burst: 200,
  },
  unlimited: {
    concurrency: 1000,
  },
}

// ============================================================================
// Rate Limit Stores
// ============================================================================

/**
 * In-memory rate limit store for development/testing
 *
 * Uses sliding window counters with second-level granularity
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private counters = new Map<string, Map<number, number>>()
  private concurrency = new Map<string, number>()

  async check(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000)

    // Get or create counter map for this key
    if (!this.counters.has(key)) {
      this.counters.set(key, new Map())
    }
    const keyCounters = this.counters.get(key)!

    // Clean up old counters (older than 1 day)
    const dayAgo = now - 86400
    for (const [timestamp] of keyCounters) {
      if (timestamp < dayAgo) {
        keyCounters.delete(timestamp)
      }
    }

    // Count requests in each window
    const secondCount = this.countInWindow(keyCounters, now, 1)
    const minuteCount = this.countInWindow(keyCounters, now, 60)
    const hourCount = this.countInWindow(keyCounters, now, 3600)
    const dayCount = this.countInWindow(keyCounters, now, 86400)

    // Check limits
    if (config.rps && secondCount >= config.rps) {
      return {
        allowed: false,
        remaining: 0,
        resetIn: 1,
        limitType: 'rps',
        retryAfter: 1,
      }
    }

    if (config.rpm && minuteCount >= config.rpm) {
      const resetIn = 60 - (now % 60)
      return {
        allowed: false,
        remaining: 0,
        resetIn,
        limitType: 'rpm',
        retryAfter: resetIn,
      }
    }

    if (config.rph && hourCount >= config.rph) {
      const resetIn = 3600 - (now % 3600)
      return {
        allowed: false,
        remaining: 0,
        resetIn,
        limitType: 'rph',
        retryAfter: Math.min(resetIn, 60),
      }
    }

    if (config.rpd && dayCount >= config.rpd) {
      const resetIn = 86400 - (now % 86400)
      return {
        allowed: false,
        remaining: 0,
        resetIn,
        limitType: 'rpd',
        retryAfter: Math.min(resetIn, 300),
      }
    }

    // Increment counter
    keyCounters.set(now, (keyCounters.get(now) || 0) + 1)

    // Calculate remaining (use most restrictive limit)
    let remaining = Infinity
    if (config.rpm) remaining = Math.min(remaining, config.rpm - minuteCount - 1)
    if (config.rph) remaining = Math.min(remaining, config.rph - hourCount - 1)
    if (config.rpd) remaining = Math.min(remaining, config.rpd - dayCount - 1)

    return {
      allowed: true,
      remaining: Math.max(0, remaining),
      resetIn: 60 - (now % 60),
    }
  }

  async acquireConcurrency(key: string, limit: number): Promise<boolean> {
    const current = this.concurrency.get(key) || 0
    if (current >= limit) {
      return false
    }
    this.concurrency.set(key, current + 1)
    return true
  }

  async releaseConcurrency(key: string): Promise<void> {
    const current = this.concurrency.get(key) || 0
    if (current > 0) {
      this.concurrency.set(key, current - 1)
    }
  }

  private countInWindow(
    counters: Map<number, number>,
    now: number,
    windowSeconds: number
  ): number {
    let count = 0
    const windowStart = now - windowSeconds
    for (const [timestamp, value] of counters) {
      if (timestamp > windowStart) {
        count += value
      }
    }
    return count
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.counters.clear()
    this.concurrency.clear()
  }
}

/**
 * Cloudflare Rate Limit binding store
 *
 * Uses Cloudflare's native rate limiting for production
 */
export class CloudflareRateLimitStore implements RateLimitStore {
  constructor(
    private binding: { limit: (params: { key: string }) => Promise<{ success: boolean }> }
  ) {}

  async check(key: string, _config: RateLimitConfig): Promise<RateLimitResult> {
    // Cloudflare rate limit binding has fixed configuration in wrangler.toml
    const result = await this.binding.limit({ key })

    if (!result.success) {
      return {
        allowed: false,
        remaining: 0,
        resetIn: 60, // CF rate limits typically reset per minute
        limitType: 'rpm',
        retryAfter: 60,
      }
    }

    return {
      allowed: true,
      remaining: -1, // Unknown with CF binding
      resetIn: 60,
    }
  }
}

/**
 * KV-backed rate limit store
 *
 * Uses Cloudflare KV for distributed rate limiting
 */
export class KVRateLimitStore implements RateLimitStore {
  constructor(private kv: KVNamespace) {}

  async check(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000)

    // Check minute limit (most common)
    if (config.rpm) {
      const minuteKey = `rl:${key}:m:${Math.floor(now / 60)}`
      const minuteCount = parseInt((await this.kv.get(minuteKey)) || '0', 10)

      if (minuteCount >= config.rpm) {
        return {
          allowed: false,
          remaining: 0,
          resetIn: 60 - (now % 60),
          limitType: 'rpm',
          retryAfter: 60 - (now % 60),
        }
      }

      // Increment counter
      await this.kv.put(minuteKey, String(minuteCount + 1), {
        expirationTtl: 120, // Keep for 2 minutes
      })

      return {
        allowed: true,
        remaining: config.rpm - minuteCount - 1,
        resetIn: 60 - (now % 60),
      }
    }

    // If no limits configured, allow all
    return {
      allowed: true,
      remaining: -1,
      resetIn: 0,
    }
  }

  async acquireConcurrency(key: string, limit: number): Promise<boolean> {
    const concurrencyKey = `rl:${key}:conc`
    const current = parseInt((await this.kv.get(concurrencyKey)) || '0', 10)

    if (current >= limit) {
      return false
    }

    await this.kv.put(concurrencyKey, String(current + 1), {
      expirationTtl: 300, // 5 minute TTL for safety
    })
    return true
  }

  async releaseConcurrency(key: string): Promise<void> {
    const concurrencyKey = `rl:${key}:conc`
    const current = parseInt((await this.kv.get(concurrencyKey)) || '0', 10)

    if (current > 0) {
      await this.kv.put(concurrencyKey, String(current - 1), {
        expirationTtl: 300,
      })
    }
  }
}

/**
 * Durable Object-backed rate limit store
 *
 * Uses Durable Objects for strong consistency
 */
export class DORateLimitStore implements RateLimitStore {
  constructor(
    private doNamespace: DurableObjectNamespace,
    private getStubId: (key: string) => DurableObjectId = (key) =>
      doNamespace.idFromName(key)
  ) {}

  async check(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const stub = this.doNamespace.get(this.getStubId(key))

    const response = await stub.fetch('http://rate-limit/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, config }),
    })

    return response.json()
  }

  async acquireConcurrency(key: string, limit: number): Promise<boolean> {
    const stub = this.doNamespace.get(this.getStubId(key))

    const response = await stub.fetch('http://rate-limit/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, limit }),
    })

    const result = await response.json()
    return (result as { acquired: boolean }).acquired
  }

  async releaseConcurrency(key: string): Promise<void> {
    const stub = this.doNamespace.get(this.getStubId(key))

    await stub.fetch('http://rate-limit/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
  }
}

// ============================================================================
// Key Generators
// ============================================================================

/**
 * Generate rate limit key from tenant ID
 */
export const tenantKeyGenerator: KeyGenerator = (c: Context) => {
  const auth = c.get('auth') as AuthContext | undefined
  return auth?.tenantId || c.req.header('cf-connecting-ip') || 'anonymous'
}

/**
 * Generate rate limit key from user ID
 */
export const userKeyGenerator: KeyGenerator = (c: Context) => {
  const auth = c.get('auth') as AuthContext | undefined
  return auth?.userId || c.req.header('cf-connecting-ip') || 'anonymous'
}

/**
 * Generate rate limit key from agent ID
 */
export const agentKeyGenerator: KeyGenerator = (c: Context) => {
  const auth = c.get('auth') as AuthContext | undefined
  return auth?.agentId || auth?.userId || c.req.header('cf-connecting-ip') || 'anonymous'
}

/**
 * Generate rate limit key from IP address
 */
export const ipKeyGenerator: KeyGenerator = (c: Context) => {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'
}

/**
 * Composite key generator (tenant + endpoint)
 */
export const compositeKeyGenerator: KeyGenerator = (c: Context) => {
  const auth = c.get('auth') as AuthContext | undefined
  const tenant = auth?.tenantId || 'anonymous'
  const path = c.req.path.split('/').slice(0, 3).join('/') // First 3 path segments
  return `${tenant}:${path}`
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Create rate limit middleware
 */
export function rateLimitMiddleware(options: RateLimitOptions): MiddlewareHandler {
  const {
    store,
    keyGenerator = tenantKeyGenerator,
    defaultConfig = DEFAULT_TIER_CONFIGS.free,
    tierConfigs = DEFAULT_TIER_CONFIGS,
    onRateLimited,
    excludePaths = [],
    skipAdmin = true,
  } = options

  return async (c: Context, next: Next) => {
    const path = c.req.path

    // Skip excluded paths
    if (excludePaths.some((p) => path.startsWith(p))) {
      return next()
    }

    // Get auth context
    const auth = c.get('auth') as AuthContext | undefined

    // Skip rate limiting for admins
    if (skipAdmin && auth?.role === 'admin') {
      return next()
    }

    // Generate rate limit key
    const key = keyGenerator(c)

    // Get config based on tier (could be from auth context or header)
    const tier = c.req.header('x-rate-limit-tier') || 'free'
    const config = tierConfigs[tier] || defaultConfig

    // Check concurrency limit first
    if (config.concurrency && store.acquireConcurrency) {
      const acquired = await store.acquireConcurrency(key, config.concurrency)
      if (!acquired) {
        const result: RateLimitResult = {
          allowed: false,
          remaining: 0,
          resetIn: 1,
          limitType: 'concurrency',
          retryAfter: 1,
        }

        if (onRateLimited) {
          return onRateLimited(c, result)
        }

        return rateLimitedResponse(c, result)
      }

      // Ensure concurrency is released after request
      c.executionCtx?.waitUntil?.(
        next()
          .finally(() => store.releaseConcurrency?.(key))
      )
    }

    // Check rate limit
    const result = await store.check(key, config)

    // Set rate limit headers
    c.header('X-RateLimit-Limit', String(config.rpm || config.rph || config.rpd || 'unlimited'))
    c.header('X-RateLimit-Remaining', String(result.remaining >= 0 ? result.remaining : 'unlimited'))
    c.header('X-RateLimit-Reset', String(Math.floor(Date.now() / 1000) + result.resetIn))

    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfter || result.resetIn))

      if (onRateLimited) {
        return onRateLimited(c, result)
      }

      return rateLimitedResponse(c, result)
    }

    // Store rate limit info in context
    c.set('rateLimit', result)

    return next()
  }
}

/**
 * Default rate limited response
 */
function rateLimitedResponse(c: Context, result: RateLimitResult): Response {
  const limitTypeMessages: Record<string, string> = {
    rps: 'Too many requests per second',
    rpm: 'Too many requests per minute',
    rph: 'Too many requests per hour',
    rpd: 'Daily request limit exceeded',
    concurrency: 'Too many concurrent requests',
  }

  return c.json(
    {
      error: {
        code: 'RATE_LIMITED',
        message: limitTypeMessages[result.limitType || 'rpm'] || 'Rate limit exceeded',
        retryAfter: result.retryAfter,
        limitType: result.limitType,
      },
    },
    429
  )
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get rate limit result from context
 */
export function getRateLimitResult(c: Context): RateLimitResult | undefined {
  return c.get('rateLimit') as RateLimitResult | undefined
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create rate limit middleware with in-memory store (for development)
 */
export function createDevRateLimiter(
  options?: Partial<Omit<RateLimitOptions, 'store'>>
): { middleware: MiddlewareHandler; store: InMemoryRateLimitStore } {
  const store = new InMemoryRateLimitStore()
  const middleware = rateLimitMiddleware({ store, ...options })
  return { middleware, store }
}

/**
 * Create rate limit middleware with KV store (for production)
 */
export function createKVRateLimiter(
  kv: KVNamespace,
  options?: Partial<Omit<RateLimitOptions, 'store'>>
): MiddlewareHandler {
  const store = new KVRateLimitStore(kv)
  return rateLimitMiddleware({ store, ...options })
}

/**
 * Create rate limit middleware with Cloudflare binding (for production)
 */
export function createCFRateLimiter(
  binding: { limit: (params: { key: string }) => Promise<{ success: boolean }> },
  options?: Partial<Omit<RateLimitOptions, 'store'>>
): MiddlewareHandler {
  const store = new CloudflareRateLimitStore(binding)
  return rateLimitMiddleware({ store, ...options })
}
