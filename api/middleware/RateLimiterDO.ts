/**
 * RateLimiterDO - Durable Object for Distributed Rate Limiting
 *
 * Provides distributed rate limiting state storage using SQLite.
 * Each DO instance handles rate limits for a specific tenant/user/IP
 * based on the key routing strategy.
 *
 * Features:
 * - Sliding window and fixed window algorithms
 * - SQLite-backed persistent state
 * - Automatic cleanup of expired entries
 * - State inspection for observability
 *
 * @module api/middleware/RateLimiterDO
 * @issue do-h6df - Rate limiter state not distributed across workers
 * @issue do-zab7.4 - Create missing RateLimiterDO module
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parameters for a rate limit check request
 */
export interface RateLimitCheckParams {
  /** The rate limit key (e.g., "tenant:acme" or "user:user-123") */
  key: string
  /** Window duration in milliseconds */
  windowMs: number
  /** Maximum requests allowed in the window */
  limit: number
  /** Window strategy: 'sliding' or 'fixed' */
  windowStrategy: 'sliding' | 'fixed'
}

/**
 * Result of a rate limit check
 */
export interface RateLimitCheckResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Remaining requests in current window */
  remaining: number
  /** When the window resets (Unix timestamp in seconds) */
  resetAt: number
  /** Retry after in milliseconds (only when rate limited) */
  retryAfterMs?: number
}

/**
 * Sliding window entry stored in SQLite
 */
interface SlidingWindowEntry {
  key: string
  timestamp_ms: number
}

/**
 * Fixed window entry stored in SQLite
 */
interface FixedWindowEntry {
  key: string
  window_start_ms: number
  count: number
}

// ============================================================================
// RATE LIMITER DURABLE OBJECT
// ============================================================================

/**
 * RateLimiterDO - Durable Object for distributed rate limiting
 *
 * This DO stores rate limit state in SQLite, providing consistent
 * distributed state across all worker instances.
 *
 * @example
 * ```typescript
 * // From DistributedRateLimiter class
 * const doId = env.RATE_LIMITER.idFromName('rate-limiter:tenant:acme')
 * const stub = env.RATE_LIMITER.get(doId)
 *
 * const response = await stub.fetch(new Request('https://rate-limiter/check', {
 *   method: 'POST',
 *   body: JSON.stringify({ key: 'tenant:acme', windowMs: 60000, limit: 100 }),
 * }))
 * ```
 */
export class RateLimiterDO implements DurableObject {
  private app: Hono
  private state: DurableObjectState
  private sql: SqlStorage | null = null
  private initialized = false

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state
    this.app = new Hono()

    // Try to get SQL storage
    this.sql = (state.storage as unknown as { sql?: SqlStorage }).sql ?? null

    // Initialize schema within blockConcurrencyWhile
    state.blockConcurrencyWhile(async () => {
      await this.ensureInitialized()
    })

    // Setup middleware
    this.app.use('/*', cors())

    // Setup routes
    this.setupRoutes()
  }

  /**
   * Ensure SQLite schema is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized || !this.sql) return

    // Create sliding window table with auto-increment id to allow
    // multiple requests at the same millisecond
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS sliding_window (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL
      )
    `)

    // Create index for efficient key-based queries and cleanup
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_sliding_window_key_ts
      ON sliding_window (key, timestamp_ms)
    `)

    // Create fixed window table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS fixed_window (
        key TEXT PRIMARY KEY,
        window_start_ms INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0
      )
    `)

    this.initialized = true
  }

  /**
   * Setup Hono routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/', (c) => c.json({
      status: 'ok',
      type: 'RateLimiterDO',
      id: this.state.id.toString(),
    }))

    // Rate limit check
    this.app.post('/check', async (c) => {
      const params = await c.req.json<RateLimitCheckParams>()
      const result = await this.checkRateLimit(params)
      return c.json(result)
    })

    // Reset key
    this.app.post('/reset', async (c) => {
      const { key } = await c.req.json<{ key: string }>()
      await this.resetKey(key)
      return c.json({ success: true })
    })

    // Get state for observability
    this.app.get('/state/:key', async (c) => {
      const key = decodeURIComponent(c.req.param('key'))
      const state = await this.getKeyState(key)
      return c.json(state)
    })
  }

  /**
   * Check rate limit for a key
   */
  private async checkRateLimit(params: RateLimitCheckParams): Promise<RateLimitCheckResult> {
    const { key, windowMs, limit, windowStrategy } = params
    const now = Date.now()

    if (windowStrategy === 'sliding') {
      return this.checkSlidingWindow(key, windowMs, limit, now)
    } else {
      return this.checkFixedWindow(key, windowMs, limit, now)
    }
  }

  /**
   * Check sliding window rate limit
   */
  private checkSlidingWindow(
    key: string,
    windowMs: number,
    limit: number,
    now: number
  ): RateLimitCheckResult {
    if (!this.sql) {
      // No SQL storage - fall back to allow
      return {
        allowed: true,
        remaining: limit - 1,
        resetAt: Math.ceil((now + windowMs) / 1000),
      }
    }

    // Clean up expired entries
    const cutoff = now - windowMs
    this.sql.exec(
      `DELETE FROM sliding_window WHERE key = ? AND timestamp_ms <= ?`,
      key,
      cutoff
    )

    // Count current requests
    const countResult = this.sql.exec(
      `SELECT COUNT(*) as count FROM sliding_window WHERE key = ?`,
      key
    ).toArray() as Array<{ count: number }>

    const currentCount = countResult[0]?.count ?? 0

    // Get first request timestamp for reset calculation
    const firstResult = this.sql.exec(
      `SELECT MIN(timestamp_ms) as first_ts FROM sliding_window WHERE key = ?`,
      key
    ).toArray() as Array<{ first_ts: number | null }>

    const firstTs = firstResult[0]?.first_ts ?? now
    const resetAt = Math.ceil((firstTs + windowMs) / 1000)

    // Check if over limit
    if (currentCount >= limit) {
      const retryAfterMs = firstTs + windowMs - now

      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterMs: Math.max(0, retryAfterMs),
      }
    }

    // Record this request
    this.sql.exec(
      `INSERT INTO sliding_window (key, timestamp_ms) VALUES (?, ?)`,
      key,
      now
    )

    return {
      allowed: true,
      remaining: Math.max(0, limit - currentCount - 1),
      resetAt,
    }
  }

  /**
   * Check fixed window rate limit
   */
  private checkFixedWindow(
    key: string,
    windowMs: number,
    limit: number,
    now: number
  ): RateLimitCheckResult {
    if (!this.sql) {
      // No SQL storage - fall back to allow
      return {
        allowed: true,
        remaining: limit - 1,
        resetAt: Math.ceil((now + windowMs) / 1000),
      }
    }

    // Get current window state
    const windowResult = this.sql.exec(
      `SELECT window_start_ms, count FROM fixed_window WHERE key = ?`,
      key
    ).toArray() as unknown as Array<FixedWindowEntry>

    let windowStart = now
    let currentCount = 0

    if (windowResult.length > 0) {
      const entry = windowResult[0]!
      // Check if window has expired
      if (now >= entry.window_start_ms + windowMs) {
        // Start new window
        this.sql.exec(
          `UPDATE fixed_window SET window_start_ms = ?, count = 0 WHERE key = ?`,
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
      this.sql.exec(
        `INSERT INTO fixed_window (key, window_start_ms, count) VALUES (?, ?, 0)`,
        key,
        now
      )
    }

    const resetAt = Math.ceil((windowStart + windowMs) / 1000)

    // Check if over limit
    if (currentCount >= limit) {
      const retryAfterMs = windowStart + windowMs - now

      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterMs: Math.max(0, retryAfterMs),
      }
    }

    // Increment count
    this.sql.exec(
      `UPDATE fixed_window SET count = count + 1 WHERE key = ?`,
      key
    )

    return {
      allowed: true,
      remaining: Math.max(0, limit - currentCount - 1),
      resetAt,
    }
  }

  /**
   * Reset rate limit state for a key
   */
  private async resetKey(key: string): Promise<void> {
    if (!this.sql) return

    this.sql.exec(`DELETE FROM sliding_window WHERE key = ?`, key)
    this.sql.exec(`DELETE FROM fixed_window WHERE key = ?`, key)
  }

  /**
   * Get current state for a key (for observability)
   */
  private async getKeyState(key: string): Promise<{ found: boolean; requests?: number }> {
    if (!this.sql) {
      return { found: false }
    }

    // Check sliding window
    const slidingResult = this.sql.exec(
      `SELECT COUNT(*) as count FROM sliding_window WHERE key = ?`,
      key
    ).toArray() as Array<{ count: number }>

    if (slidingResult.length > 0 && slidingResult[0]!.count > 0) {
      return {
        found: true,
        requests: slidingResult[0]!.count,
      }
    }

    // Check fixed window
    const fixedResult = this.sql.exec(
      `SELECT count FROM fixed_window WHERE key = ?`,
      key
    ).toArray() as Array<{ count: number }>

    if (fixedResult.length > 0) {
      return {
        found: true,
        requests: fixedResult[0]!.count,
      }
    }

    return { found: false }
  }

  /**
   * Handle incoming fetch requests
   */
  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}
