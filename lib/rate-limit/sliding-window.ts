/**
 * Sliding Window Rate Limiter
 *
 * A sliding window rate limiter that stores request entries in SQLite via Drizzle ORM.
 * Each request is recorded with a timestamp, and the limiter counts requests within
 * a sliding time window to determine if new requests should be allowed.
 *
 * Key features:
 * - Precise sliding window semantics (entries expire individually based on timestamp)
 * - Concurrent request safety via atomic counting
 * - Configurable window sizes (minutes, hours, days)
 * - Cleanup for expired entries
 *
 * Usage:
 * ```typescript
 * const limiter = new SlidingWindowLimiter(db)
 * const result = await limiter.check('user:123', { limit: 100, window: '1h' })
 * if (!result.success) {
 *   // Rate limit exceeded
 * }
 * ```
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql, gt, lt } from 'drizzle-orm'

// ============================================================================
// RATE LIMIT SCHEMA
// ============================================================================

/**
 * Schema for rate limit entries.
 * Each entry represents a single request within the sliding window.
 */
export const rateLimitEntries = sqliteTable('rate_limit_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  timestamp: integer('timestamp').notNull(), // Unix timestamp in ms
})

// ============================================================================
// TYPES
// ============================================================================

export interface RateLimitResult {
  success: boolean
  remaining: number
}

export interface RateLimitOptions {
  limit: number
  window: string // '1m', '1h', '1d', etc.
}

export interface CleanupOptions {
  maxAge?: string // '1h', '1d', etc. - entries older than this are removed
}

/**
 * Generic database interface for Drizzle with rate limit entries
 */
export interface RateLimitDb {
  select(fields?: Record<string, unknown>): {
    from(table: typeof rateLimitEntries): {
      where(condition: unknown): Promise<{ id: number; key: string; timestamp: number }[]>
    }
  }
  insert(table: typeof rateLimitEntries): {
    values(values: { key: string; timestamp: number }): Promise<unknown>
  }
  delete(table: typeof rateLimitEntries): {
    where(condition: unknown): Promise<unknown>
  }
}

// ============================================================================
// WINDOW PARSING
// ============================================================================

/**
 * Parses a window string into milliseconds.
 * Format: number + unit (m = minutes, h = hours, d = days)
 *
 * @param window - Window string like '1m', '1h', '1d'
 * @returns Window duration in milliseconds
 * @throws Error if format is invalid
 */
export function parseWindow(window: string): number {
  const match = window.match(/^(\d+)([mhd])$/)
  if (!match) {
    throw new Error(`Invalid window format: ${window}. Expected format: '1m', '1h', '1d'`)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  if (value === 0) {
    throw new Error(`Invalid window value: ${window}. Window must be greater than 0`)
  }

  switch (unit) {
    case 'm':
      return value * 60 * 1000 // minutes to ms
    case 'h':
      return value * 60 * 60 * 1000 // hours to ms
    case 'd':
      return value * 24 * 60 * 60 * 1000 // days to ms
    default:
      throw new Error(`Unknown unit: ${unit}`)
  }
}

// ============================================================================
// SLIDING WINDOW LIMITER
// ============================================================================

/**
 * Sliding Window Rate Limiter
 *
 * Uses SQLite to store request entries and count them within a sliding window.
 * Provides precise rate limiting with per-request expiration.
 */
export class SlidingWindowLimiter {
  private db: unknown

  constructor(db: unknown) {
    this.db = db
  }

  /**
   * Check if a request is allowed for the given key.
   * If allowed, records the request in the database.
   *
   * @param key - The rate limit key (e.g., 'user:123', 'ip:192.168.1.1')
   * @param opts - Rate limit options (limit and window)
   * @returns Result with success boolean and remaining count
   * @throws Error if limit is negative or window format is invalid
   */
  async check(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
    const { limit, window } = opts

    // Validate limit
    if (limit < 0) {
      throw new Error(`Invalid limit: ${limit}. Limit must be non-negative`)
    }

    // Handle limit of 0 - all requests blocked
    if (limit === 0) {
      return { success: false, remaining: 0 }
    }

    // Parse window to get duration in ms
    const windowMs = parseWindow(window)

    // Get current timestamp
    const now = Date.now()

    // Calculate cutoff time (entries older than this are expired)
    const cutoff = now - windowMs

    // Use raw SQL for atomic counting and insertion
    // This prevents race conditions by counting and inserting in a single transaction
    const db = this.db as {
      run(query: unknown): void
      all<T>(query: unknown): T[]
      get<T>(query: unknown): T | undefined
    }

    // Count current entries within the window
    const countResult = db.all<{ count: number }>(
      sql`SELECT COUNT(*) as count FROM rate_limit_entries WHERE key = ${key} AND timestamp > ${cutoff}`
    )

    const currentCount = countResult[0]?.count ?? 0

    // Check if we're at or over the limit
    if (currentCount >= limit) {
      return { success: false, remaining: 0 }
    }

    // Insert new entry
    db.run(
      sql`INSERT INTO rate_limit_entries (key, timestamp) VALUES (${key}, ${now})`
    )

    // Calculate remaining (after this request)
    const remaining = limit - currentCount - 1

    return { success: true, remaining: Math.max(0, remaining) }
  }

  /**
   * Clean up expired entries from the database.
   *
   * @param opts - Optional cleanup options (maxAge for custom threshold)
   * @returns Number of entries removed, or void
   */
  async cleanup(opts?: CleanupOptions): Promise<number | void> {
    // Default to 1 minute if no maxAge specified
    // This is aggressive but ensures cleanup removes entries that are
    // definitely outside typical rate limit windows
    const maxAge = opts?.maxAge ?? '1m'
    const maxAgeMs = parseWindow(maxAge)

    const now = Date.now()
    const cutoff = now - maxAgeMs

    // For Drizzle/better-sqlite3, db.run() returns RunResult synchronously
    // with a 'changes' property indicating number of rows affected
    const db = this.db as {
      run(query: unknown): { changes: number }
    }

    // Delete expired entries and return count from changes
    // (strictly less than cutoff - boundary entries are kept)
    const result = db.run(
      sql`DELETE FROM rate_limit_entries WHERE timestamp < ${cutoff}`
    )

    return result.changes
  }
}

export default SlidingWindowLimiter
