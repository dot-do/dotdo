/**
 * RateLimiterDO - Durable Object for Distributed Rate Limiting
 *
 * Provides distributed rate limit state storage using Cloudflare Durable Objects.
 * Each rate limit key is routed to a specific DO instance, ensuring consistent
 * state across all worker instances.
 *
 * Features:
 * - Sliding window and fixed window algorithms
 * - Atomic increment operations
 * - Automatic cleanup of expired entries
 * - RPC interface for fast communication
 *
 * @module api/middleware/RateLimiterDO
 * @issue do-h6df - Rate limiter state not distributed across workers
 */

import { Hono } from 'hono'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Sliding window state stored in DO
 */
interface SlidingWindowState {
  requests: number[] // timestamps in ms
}

/**
 * Fixed window state stored in DO
 */
interface FixedWindowState {
  count: number
  windowStart: number
}

/**
 * Parameters for checking rate limit
 */
export interface RateLimitCheckParams {
  key: string
  windowMs: number
  limit: number
  windowStrategy: 'sliding' | 'fixed'
}

/**
 * Result from rate limit check
 */
export interface RateLimitCheckResult {
  allowed: boolean
  remaining: number
  resetAt: number // Unix timestamp in seconds
  retryAfterMs?: number
}

// ============================================================================
// DURABLE OBJECT CLASS
// ============================================================================

/**
 * RateLimiterDO - Durable Object for rate limit state
 *
 * Each instance handles rate limits for a specific key prefix.
 * State is stored in SQLite for durability and fast access.
 */
export class RateLimiterDO implements DurableObject {
  private readonly state: DurableObjectState
  private readonly app: Hono
  private slidingWindows: Map<string, SlidingWindowState> = new Map()
  private fixedWindows: Map<string, FixedWindowState> = new Map()
  private hydrated = false

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state
    this.app = new Hono()

    // Setup RPC routes
    this.setupRoutes()
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/', (c) => c.json({
      status: 'ok',
      type: 'RateLimiterDO',
      id: this.state.id.toString(),
    }))

    // Check rate limit (POST /check)
    this.app.post('/check', async (c) => {
      const params = await c.req.json<RateLimitCheckParams>()
      const result = await this.check(params)
      return c.json(result)
    })

    // Reset key (POST /reset)
    this.app.post('/reset', async (c) => {
      const { key } = await c.req.json<{ key: string }>()
      await this.resetKey(key)
      return c.json({ success: true })
    })

    // Get state for observability (GET /state/:key)
    this.app.get('/state/:key', async (c) => {
      const key = decodeURIComponent(c.req.param('key'))
      const state = await this.getState(key)
      return c.json(state ?? { found: false })
    })
  }

  async fetch(request: Request): Promise<Response> {
    // Ensure state is hydrated from storage
    if (!this.hydrated) {
      await this.hydrateFromStorage()
      this.hydrated = true
    }
    return this.app.fetch(request)
  }

  /**
   * Check rate limit and record request
   */
  async check(params: RateLimitCheckParams): Promise<RateLimitCheckResult> {
    const { key, windowMs, limit, windowStrategy } = params
    const now = Date.now()

    if (windowStrategy === 'sliding') {
      return this.checkSlidingWindow(key, windowMs, limit, now)
    } else {
      return this.checkFixedWindow(key, windowMs, limit, now)
    }
  }

  /**
   * Sliding window rate limit check
   */
  private async checkSlidingWindow(
    key: string,
    windowMs: number,
    limit: number,
    now: number
  ): Promise<RateLimitCheckResult> {
    let state = this.slidingWindows.get(key)

    if (!state) {
      state = { requests: [] }
      this.slidingWindows.set(key, state)
    }

    // Remove expired requests (outside the window)
    const cutoff = now - windowMs
    state.requests = state.requests.filter((ts) => ts > cutoff)

    const firstRequest = state.requests[0]
    const resetAt = firstRequest !== undefined
      ? Math.ceil((firstRequest + windowMs) / 1000)
      : Math.ceil((now + windowMs) / 1000)

    // Check if over limit
    if (state.requests.length >= limit) {
      const oldestRequestTime = state.requests[0] ?? now
      const retryAfterMs = oldestRequestTime + windowMs - now

      // Don't persist - just return result
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterMs,
      }
    }

    // Add this request
    state.requests.push(now)
    const remaining = Math.max(0, limit - state.requests.length)

    // Persist state
    await this.persistSlidingWindow(key, state)

    return {
      allowed: true,
      remaining,
      resetAt,
    }
  }

  /**
   * Fixed window rate limit check
   */
  private async checkFixedWindow(
    key: string,
    windowMs: number,
    limit: number,
    now: number
  ): Promise<RateLimitCheckResult> {
    let state = this.fixedWindows.get(key)

    // Reset window if expired or doesn't exist
    if (!state || now >= state.windowStart + windowMs) {
      state = { count: 0, windowStart: now }
      this.fixedWindows.set(key, state)
    }

    const resetAt = Math.ceil((state.windowStart + windowMs) / 1000)

    // Check if over limit
    if (state.count >= limit) {
      const retryAfterMs = state.windowStart + windowMs - now

      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterMs,
      }
    }

    // Increment count
    state.count++
    const remaining = Math.max(0, limit - state.count)

    // Persist state
    await this.persistFixedWindow(key, state)

    return {
      allowed: true,
      remaining,
      resetAt,
    }
  }

  /**
   * Reset rate limit state for a key
   */
  async resetKey(key: string): Promise<void> {
    this.slidingWindows.delete(key)
    this.fixedWindows.delete(key)

    // Remove from storage
    await this.state.storage.delete(`sliding:${key}`)
    await this.state.storage.delete(`fixed:${key}`)
  }

  /**
   * Get current state for observability
   */
  async getState(key: string): Promise<{ requests: number; found: boolean } | null> {
    const slidingState = this.slidingWindows.get(key)
    if (slidingState) {
      return {
        requests: slidingState.requests.length,
        found: true,
      }
    }

    const fixedState = this.fixedWindows.get(key)
    if (fixedState) {
      return {
        requests: fixedState.count,
        found: true,
      }
    }

    return null
  }

  /**
   * Hydrate state from storage on first request
   */
  private async hydrateFromStorage(): Promise<void> {
    // Load all stored states
    const stored = await this.state.storage.list<SlidingWindowState | FixedWindowState>()

    for (const [key, value] of stored) {
      if (key.startsWith('sliding:')) {
        const rateLimitKey = key.slice(8) // Remove 'sliding:' prefix
        this.slidingWindows.set(rateLimitKey, value as SlidingWindowState)
      } else if (key.startsWith('fixed:')) {
        const rateLimitKey = key.slice(6) // Remove 'fixed:' prefix
        this.fixedWindows.set(rateLimitKey, value as FixedWindowState)
      }
    }

    // Cleanup expired entries on hydration
    await this.cleanupExpired()
  }

  /**
   * Persist sliding window state
   */
  private async persistSlidingWindow(key: string, state: SlidingWindowState): Promise<void> {
    await this.state.storage.put(`sliding:${key}`, state)
  }

  /**
   * Persist fixed window state
   */
  private async persistFixedWindow(key: string, state: FixedWindowState): Promise<void> {
    await this.state.storage.put(`fixed:${key}`, state)
  }

  /**
   * Cleanup expired entries (called on hydration and periodically)
   */
  private async cleanupExpired(): Promise<void> {
    const now = Date.now()
    const keysToDelete: string[] = []

    // Cleanup sliding windows (assuming max window of 1 hour)
    const maxWindow = 3600000 // 1 hour
    for (const [key, state] of this.slidingWindows) {
      const oldestRequest = state.requests[0]
      if (oldestRequest && now - oldestRequest > maxWindow) {
        // All requests are likely expired
        state.requests = state.requests.filter((ts) => now - ts < maxWindow)
        if (state.requests.length === 0) {
          this.slidingWindows.delete(key)
          keysToDelete.push(`sliding:${key}`)
        }
      }
    }

    // Cleanup fixed windows
    for (const [key, state] of this.fixedWindows) {
      if (now - state.windowStart > maxWindow) {
        this.fixedWindows.delete(key)
        keysToDelete.push(`fixed:${key}`)
      }
    }

    // Batch delete from storage
    if (keysToDelete.length > 0) {
      await this.state.storage.delete(keysToDelete)
    }
  }

  /**
   * Alarm handler for periodic cleanup
   */
  async alarm(): Promise<void> {
    await this.cleanupExpired()
    // Schedule next cleanup in 5 minutes
    await this.state.storage.setAlarm(Date.now() + 300000)
  }
}
