/**
 * Sliding Window Rate Limiter Tests
 *
 * RED TDD: These tests exercise the DO-based sliding window rate limiter.
 * Tests should FAIL initially as the implementation does not exist yet.
 *
 * The SlidingWindowLimiter stores request entries in DO SQLite via Drizzle,
 * allowing precise rate limiting with sliding window semantics.
 *
 * Key behaviors:
 * - Tracks requests per key within a time window
 * - Allows requests within the configured limit
 * - Blocks requests that exceed the limit
 * - Slides the window (old entries expire based on timestamp)
 * - Cleans up old entries to prevent unbounded growth
 * - Handles concurrent requests safely
 *
 * Interface:
 * ```typescript
 * class SlidingWindowLimiter {
 *   constructor(db: DrizzleDB)
 *   check(key: string, opts: { limit: number; window: string }): Promise<{ success: boolean; remaining: number }>
 *   cleanup(): Promise<void>
 * }
 * ```
 *
 * Window format: '1m' (minutes), '1h' (hours), '1d' (days)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

// ============================================================================
// RATE LIMIT SCHEMA (expected to be created in db/rate-limit.ts)
// ============================================================================

/**
 * Schema for rate limit entries.
 * Each entry represents a single request within the sliding window.
 */
const rateLimitEntries = sqliteTable('rate_limit_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  timestamp: integer('timestamp').notNull(), // Unix timestamp in ms
})

type RateLimitSchema = {
  rateLimitEntries: typeof rateLimitEntries
}

// ============================================================================
// TEST DATABASE SETUP
// ============================================================================

/**
 * Creates an in-memory SQLite database with Drizzle for testing.
 * This simulates the DO SQLite environment.
 */
function createTestDB(): BetterSQLite3Database<RateLimitSchema> {
  const sqlite = new Database(':memory:')

  // Create the rate limit entries table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS rate_limit_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `)

  // Create index for efficient lookups by key
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_rate_limit_key ON rate_limit_entries(key)
  `)

  // Create index for timestamp-based cleanup
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_rate_limit_timestamp ON rate_limit_entries(timestamp)
  `)

  return drizzle(sqlite, { schema: { rateLimitEntries } }) as BetterSQLite3Database<RateLimitSchema>
}

// ============================================================================
// TYPE DEFINITIONS (expected interface)
// ============================================================================

interface RateLimitResult {
  success: boolean
  remaining: number
}

interface RateLimitOptions {
  limit: number
  window: string // '1m', '1h', '1d', etc.
}

/**
 * SlidingWindowLimiter - Expected interface for the rate limiter.
 *
 * RED TDD: This class doesn't exist yet. We define the expected interface here
 * and the tests will fail with "SlidingWindowLimiter is not a constructor" until
 * the actual implementation is created at lib/rate-limit/sliding-window.ts
 */
let SlidingWindowLimiter: {
  new (db: BetterSQLite3Database<RateLimitSchema>): SlidingWindowLimiterInstance
}

interface SlidingWindowLimiterInstance {
  check(key: string, opts: RateLimitOptions): Promise<RateLimitResult>
  cleanup(opts?: { maxAge?: string }): Promise<number | void>
}

// Attempt to import the actual implementation
// This will fail until the implementation exists
try {
  // Dynamic import wrapped in a try-catch doesn't work at module level
  // Instead, we leave SlidingWindowLimiter undefined and tests will fail
  // when trying to instantiate it
  //
  // When the implementation is created at lib/rate-limit/sliding-window.ts,
  // update this file to: import { SlidingWindowLimiter } from '../../lib/rate-limit/sliding-window'
  SlidingWindowLimiter = undefined as any
} catch {
  SlidingWindowLimiter = undefined as any
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parses a window string into milliseconds.
 * Format: number + unit (m = minutes, h = hours, d = days)
 */
function parseWindow(window: string): number {
  const match = window.match(/^(\d+)([mhd])$/)
  if (!match) {
    throw new Error(`Invalid window format: ${window}. Expected format: '1m', '1h', '1d'`)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

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

/**
 * Advances mock time by the specified milliseconds
 */
function advanceTime(ms: number): void {
  vi.advanceTimersByTime(ms)
}

// ============================================================================
// TESTS: BASIC RATE LIMITING
// ============================================================================

describe('SlidingWindowLimiter', () => {
  let db: BetterSQLite3Database<RateLimitSchema>
  let limiter: SlidingWindowLimiterInstance

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-08T12:00:00.000Z'))
    db = createTestDB()
    // RED TDD: This will throw "SlidingWindowLimiter is not a constructor" until implemented
    limiter = new SlidingWindowLimiter(db)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // TESTS: ALLOWS REQUESTS WITHIN LIMIT
  // ==========================================================================

  describe('allows requests within limit', () => {
    it('allows first request for a key', async () => {
      const result = await limiter.check('user:123', { limit: 10, window: '1m' })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(9)
    })

    it('allows multiple requests up to the limit', async () => {
      const key = 'user:456'
      const opts: RateLimitOptions = { limit: 5, window: '1m' }

      // Make 5 requests (exactly at the limit)
      for (let i = 0; i < 5; i++) {
        const result = await limiter.check(key, opts)
        expect(result.success).toBe(true)
        expect(result.remaining).toBe(4 - i)
      }
    })

    it('allows request at exactly the limit', async () => {
      const key = 'user:exact'
      const opts: RateLimitOptions = { limit: 3, window: '1m' }

      // Use up 2 requests
      await limiter.check(key, opts)
      await limiter.check(key, opts)

      // Third request should succeed (at limit)
      const result = await limiter.check(key, opts)
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(0)
    })

    it('tracks different keys independently', async () => {
      const opts: RateLimitOptions = { limit: 2, window: '1m' }

      // User A uses 2 requests
      await limiter.check('user:A', opts)
      await limiter.check('user:A', opts)

      // User B should still have full quota
      const result = await limiter.check('user:B', opts)
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(1)
    })

    it('returns correct remaining count after each request', async () => {
      const key = 'user:remaining'
      const opts: RateLimitOptions = { limit: 5, window: '1m' }

      const results: number[] = []
      for (let i = 0; i < 5; i++) {
        const result = await limiter.check(key, opts)
        results.push(result.remaining)
      }

      expect(results).toEqual([4, 3, 2, 1, 0])
    })
  })

  // ==========================================================================
  // TESTS: BLOCKS REQUESTS OVER LIMIT
  // ==========================================================================

  describe('blocks requests over limit', () => {
    it('blocks request when limit is exceeded', async () => {
      const key = 'user:blocked'
      const opts: RateLimitOptions = { limit: 3, window: '1m' }

      // Use up all 3 requests
      await limiter.check(key, opts)
      await limiter.check(key, opts)
      await limiter.check(key, opts)

      // Fourth request should be blocked
      const result = await limiter.check(key, opts)
      expect(result.success).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('continues blocking after limit is exceeded', async () => {
      const key = 'user:still-blocked'
      const opts: RateLimitOptions = { limit: 2, window: '1m' }

      // Exceed limit
      await limiter.check(key, opts)
      await limiter.check(key, opts)

      // Multiple blocked attempts
      for (let i = 0; i < 5; i++) {
        const result = await limiter.check(key, opts)
        expect(result.success).toBe(false)
        expect(result.remaining).toBe(0)
      }
    })

    it('blocks with remaining = 0 when at capacity', async () => {
      const key = 'user:capacity'
      const opts: RateLimitOptions = { limit: 1, window: '1m' }

      // Use the single allowed request
      const first = await limiter.check(key, opts)
      expect(first.success).toBe(true)
      expect(first.remaining).toBe(0)

      // Next request should be blocked
      const second = await limiter.check(key, opts)
      expect(second.success).toBe(false)
      expect(second.remaining).toBe(0)
    })

    it('does not count blocked requests against the limit', async () => {
      const key = 'user:no-count'
      const opts: RateLimitOptions = { limit: 2, window: '1m' }

      // Use up limit
      await limiter.check(key, opts)
      await limiter.check(key, opts)

      // Blocked requests should not add entries
      await limiter.check(key, opts)
      await limiter.check(key, opts)
      await limiter.check(key, opts)

      // After window slides, should have 2 available again (not 5)
      advanceTime(parseWindow('1m') + 1)

      const result = await limiter.check(key, opts)
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(1) // 2 - 1 = 1, not affected by blocked attempts
    })
  })

  // ==========================================================================
  // TESTS: SLIDING WINDOW BEHAVIOR
  // ==========================================================================

  describe('slides window correctly (old entries expire)', () => {
    it('allows requests after window expires', async () => {
      const key = 'user:expire'
      const opts: RateLimitOptions = { limit: 2, window: '1m' }

      // Use up limit
      await limiter.check(key, opts)
      await limiter.check(key, opts)

      // Should be blocked
      const blocked = await limiter.check(key, opts)
      expect(blocked.success).toBe(false)

      // Advance past the window
      advanceTime(parseWindow('1m') + 1)

      // Should be allowed again
      const result = await limiter.check(key, opts)
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(1)
    })

    it('expires entries individually as they age out', async () => {
      const key = 'user:individual'
      const opts: RateLimitOptions = { limit: 3, window: '1m' }

      // Make requests at different times
      await limiter.check(key, opts) // t=0
      advanceTime(20000) // t=20s
      await limiter.check(key, opts) // t=20s
      advanceTime(20000) // t=40s
      await limiter.check(key, opts) // t=40s

      // At t=40s, should be at limit (3 requests in last minute)
      const atLimit = await limiter.check(key, opts)
      expect(atLimit.success).toBe(false)

      // Advance to t=61s (first request expires)
      advanceTime(21000)

      // Should have 1 slot available
      const afterExpire = await limiter.check(key, opts)
      expect(afterExpire.success).toBe(true)
      expect(afterExpire.remaining).toBe(0) // 3 - 2 remaining - 1 new = 0
    })

    it('handles partial window expiration correctly', async () => {
      const key = 'user:partial'
      const opts: RateLimitOptions = { limit: 4, window: '1m' }

      // Make 4 requests at t=0
      for (let i = 0; i < 4; i++) {
        await limiter.check(key, opts)
      }

      // Should be at limit
      expect((await limiter.check(key, opts)).success).toBe(false)

      // Advance 30 seconds (half the window)
      advanceTime(30000)

      // Still at limit (no entries have expired)
      expect((await limiter.check(key, opts)).success).toBe(false)

      // Make 2 more requests at t=30s (they will be blocked)
      // Advance another 31 seconds (t=61s, first 4 expire)
      advanceTime(31000)

      // Should now have full capacity
      const result = await limiter.check(key, opts)
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(3)
    })

    it('works with hour-based windows', async () => {
      const key = 'user:hourly'
      const opts: RateLimitOptions = { limit: 100, window: '1h' }

      // Use up 100 requests
      for (let i = 0; i < 100; i++) {
        await limiter.check(key, opts)
      }

      // Should be blocked
      expect((await limiter.check(key, opts)).success).toBe(false)

      // Advance 30 minutes
      advanceTime(30 * 60 * 1000)

      // Still blocked
      expect((await limiter.check(key, opts)).success).toBe(false)

      // Advance another 31 minutes (total 61 minutes)
      advanceTime(31 * 60 * 1000)

      // Should be allowed
      expect((await limiter.check(key, opts)).success).toBe(true)
    })

    it('works with day-based windows', async () => {
      const key = 'user:daily'
      const opts: RateLimitOptions = { limit: 1000, window: '1d' }

      // Use up 1000 requests
      for (let i = 0; i < 1000; i++) {
        await limiter.check(key, opts)
      }

      // Should be blocked
      expect((await limiter.check(key, opts)).success).toBe(false)

      // Advance 12 hours
      advanceTime(12 * 60 * 60 * 1000)

      // Still blocked
      expect((await limiter.check(key, opts)).success).toBe(false)

      // Advance another 13 hours (total 25 hours)
      advanceTime(13 * 60 * 60 * 1000)

      // Should be allowed
      expect((await limiter.check(key, opts)).success).toBe(true)
    })

    it('handles configurable window sizes', async () => {
      const key = 'user:config'

      // Test 5 minute window
      const opts5m: RateLimitOptions = { limit: 10, window: '5m' }
      for (let i = 0; i < 10; i++) {
        await limiter.check(key + ':5m', opts5m)
      }
      expect((await limiter.check(key + ':5m', opts5m)).success).toBe(false)

      // Advance 5 minutes + 1ms
      advanceTime(5 * 60 * 1000 + 1)
      expect((await limiter.check(key + ':5m', opts5m)).success).toBe(true)
    })

    it('sliding window provides smoother rate limiting than fixed windows', async () => {
      const key = 'user:smooth'
      const opts: RateLimitOptions = { limit: 10, window: '1m' }

      // Make 10 requests at t=50s (just before minute boundary)
      advanceTime(50000)
      for (let i = 0; i < 10; i++) {
        await limiter.check(key, opts)
      }

      // Advance to t=60s (would be new window in fixed window algorithm)
      advanceTime(10000)

      // In sliding window, should still be at limit (requests are only 10s old)
      expect((await limiter.check(key, opts)).success).toBe(false)

      // Advance to t=111s (requests at t=50s should now be expired)
      advanceTime(51000)

      // Now should be allowed
      expect((await limiter.check(key, opts)).success).toBe(true)
    })
  })

  // ==========================================================================
  // TESTS: CLEANUP
  // ==========================================================================

  describe('cleans up old entries', () => {
    it('cleanup removes expired entries', async () => {
      const key = 'user:cleanup'
      const opts: RateLimitOptions = { limit: 10, window: '1m' }

      // Make some requests
      for (let i = 0; i < 10; i++) {
        await limiter.check(key, opts)
      }

      // Advance past window
      advanceTime(parseWindow('1m') + 1)

      // Run cleanup
      await limiter.cleanup()

      // Verify entries are cleaned (by checking we can make new requests)
      const result = await limiter.check(key, opts)
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(9)
    })

    it('cleanup does not remove unexpired entries', async () => {
      const key = 'user:keep'
      const opts: RateLimitOptions = { limit: 5, window: '1m' }

      // Make 3 requests
      await limiter.check(key, opts)
      await limiter.check(key, opts)
      await limiter.check(key, opts)

      // Run cleanup (entries are still fresh)
      await limiter.cleanup()

      // Should still have 2 remaining (3 used)
      const result = await limiter.check(key, opts)
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(1) // 5 - 3 - 1 = 1
    })

    it('cleanup handles mixed expired and fresh entries', async () => {
      const key = 'user:mixed'
      const opts: RateLimitOptions = { limit: 10, window: '1m' }

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await limiter.check(key, opts)
      }

      // Advance 30 seconds
      advanceTime(30000)

      // Make 3 more requests
      for (let i = 0; i < 3; i++) {
        await limiter.check(key, opts)
      }

      // Advance another 31 seconds (first 5 should expire)
      advanceTime(31000)

      // Run cleanup
      await limiter.cleanup()

      // Should have 7 remaining (only 3 recent requests count)
      const result = await limiter.check(key, opts)
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(6) // 10 - 3 - 1 = 6
    })

    it('cleanup is idempotent', async () => {
      const key = 'user:idempotent'
      const opts: RateLimitOptions = { limit: 5, window: '1m' }

      // Make requests
      await limiter.check(key, opts)
      await limiter.check(key, opts)

      // Advance past window
      advanceTime(parseWindow('1m') + 1)

      // Run cleanup multiple times
      await limiter.cleanup()
      await limiter.cleanup()
      await limiter.cleanup()

      // Should behave the same
      const result = await limiter.check(key, opts)
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(4)
    })

    it('cleanup works across multiple keys', async () => {
      const opts: RateLimitOptions = { limit: 5, window: '1m' }

      // Create entries for multiple keys
      await limiter.check('key:A', opts)
      await limiter.check('key:A', opts)
      await limiter.check('key:B', opts)
      await limiter.check('key:C', opts)
      await limiter.check('key:C', opts)
      await limiter.check('key:C', opts)

      // Advance past window
      advanceTime(parseWindow('1m') + 1)

      // Run cleanup
      await limiter.cleanup()

      // All keys should have full capacity
      expect((await limiter.check('key:A', opts)).remaining).toBe(4)
      expect((await limiter.check('key:B', opts)).remaining).toBe(4)
      expect((await limiter.check('key:C', opts)).remaining).toBe(4)
    })

    it('cleanup with custom age threshold', async () => {
      const key = 'user:threshold'
      const opts: RateLimitOptions = { limit: 10, window: '1h' }

      // Make requests
      for (let i = 0; i < 5; i++) {
        await limiter.check(key, opts)
      }

      // Advance 30 minutes
      advanceTime(30 * 60 * 1000)

      // @ts-expect-error - cleanup with options not yet implemented
      // Cleanup with 30 minute threshold (should not clean)
      await limiter.cleanup({ maxAge: '30m' })

      // Entries should still exist
      const result1 = await limiter.check(key, opts)
      expect(result1.remaining).toBe(4) // 10 - 5 - 1 = 4

      // Advance another 31 minutes
      advanceTime(31 * 60 * 1000)

      // Cleanup with 1 hour threshold (should clean)
      // @ts-expect-error - cleanup with options not yet implemented
      await limiter.cleanup({ maxAge: '1h' })

      // Entries should be cleaned
      const result2 = await limiter.check(key, opts)
      expect(result2.remaining).toBe(9)
    })

    it('cleanup returns count of removed entries', async () => {
      const opts: RateLimitOptions = { limit: 100, window: '1m' }

      // Create 50 entries
      for (let i = 0; i < 50; i++) {
        await limiter.check(`key:${i % 10}`, opts)
      }

      // Advance past window
      advanceTime(parseWindow('1m') + 1)

      // Run cleanup and check return value
      // @ts-expect-error - cleanup return value not yet implemented
      const removed = await limiter.cleanup()
      expect(removed).toBe(50)
    })
  })

  // ==========================================================================
  // TESTS: CONCURRENT REQUESTS
  // ==========================================================================

  describe('handles concurrent requests', () => {
    it('handles concurrent requests to the same key', async () => {
      const key = 'user:concurrent'
      const opts: RateLimitOptions = { limit: 5, window: '1m' }

      // Fire 10 concurrent requests
      const promises = Array(10)
        .fill(null)
        .map(() => limiter.check(key, opts))

      const results = await Promise.all(promises)

      // Exactly 5 should succeed
      const successes = results.filter((r) => r.success).length
      const failures = results.filter((r) => !r.success).length

      expect(successes).toBe(5)
      expect(failures).toBe(5)
    })

    it('maintains count accuracy under concurrent load', async () => {
      const key = 'user:accuracy'
      const opts: RateLimitOptions = { limit: 100, window: '1m' }

      // Fire 150 concurrent requests
      const promises = Array(150)
        .fill(null)
        .map(() => limiter.check(key, opts))

      const results = await Promise.all(promises)

      // Exactly 100 should succeed
      const successes = results.filter((r) => r.success).length
      expect(successes).toBe(100)
    })

    it('handles concurrent requests to different keys', async () => {
      const opts: RateLimitOptions = { limit: 2, window: '1m' }

      // Fire concurrent requests to different keys
      const promises = [
        limiter.check('key:A', opts),
        limiter.check('key:B', opts),
        limiter.check('key:A', opts),
        limiter.check('key:B', opts),
        limiter.check('key:A', opts), // Should fail for A
        limiter.check('key:B', opts), // Should fail for B
        limiter.check('key:C', opts), // Should succeed for C
        limiter.check('key:C', opts), // Should succeed for C
        limiter.check('key:C', opts), // Should fail for C
      ]

      const results = await Promise.all(promises)

      // 2 for A, 2 for B, 2 for C = 6 successes
      const successes = results.filter((r) => r.success).length
      expect(successes).toBe(6)
    })

    it('remaining count is correct after concurrent requests', async () => {
      const key = 'user:remaining-concurrent'
      const opts: RateLimitOptions = { limit: 10, window: '1m' }

      // Fire 5 concurrent requests
      const promises = Array(5)
        .fill(null)
        .map(() => limiter.check(key, opts))

      await Promise.all(promises)

      // Sequential request should see 5 remaining
      const result = await limiter.check(key, opts)
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(4) // 10 - 5 - 1 = 4
    })

    it('handles race condition at the limit boundary', async () => {
      const key = 'user:race'
      const opts: RateLimitOptions = { limit: 1, window: '1m' }

      // Fire 2 concurrent requests when limit is 1
      const promises = [
        limiter.check(key, opts),
        limiter.check(key, opts),
      ]

      const results = await Promise.all(promises)

      // Exactly 1 should succeed
      const successes = results.filter((r) => r.success).length
      expect(successes).toBe(1)
    })

    it('handles high concurrency without data corruption', async () => {
      const opts: RateLimitOptions = { limit: 50, window: '1m' }

      // Fire 100 requests each to 10 different keys
      const allPromises: Promise<RateLimitResult>[] = []

      for (let key = 0; key < 10; key++) {
        for (let req = 0; req < 100; req++) {
          allPromises.push(limiter.check(`key:${key}`, opts))
        }
      }

      const results = await Promise.all(allPromises)

      // Each key should have exactly 50 successes
      for (let key = 0; key < 10; key++) {
        const keyResults = results.slice(key * 100, (key + 1) * 100)
        const successes = keyResults.filter((r) => r.success).length
        expect(successes).toBe(50)
      }
    })
  })

  // ==========================================================================
  // TESTS: WINDOW FORMAT PARSING
  // ==========================================================================

  describe('window format parsing', () => {
    it('parses minute windows correctly', async () => {
      const key = 'user:minute'

      // 1 minute
      await limiter.check(key + ':1m', { limit: 1, window: '1m' })
      advanceTime(61000)
      expect((await limiter.check(key + ':1m', { limit: 1, window: '1m' })).success).toBe(true)

      // 5 minutes
      await limiter.check(key + ':5m', { limit: 1, window: '5m' })
      advanceTime(5 * 60 * 1000 + 1)
      expect((await limiter.check(key + ':5m', { limit: 1, window: '5m' })).success).toBe(true)

      // 30 minutes
      await limiter.check(key + ':30m', { limit: 1, window: '30m' })
      advanceTime(30 * 60 * 1000 + 1)
      expect((await limiter.check(key + ':30m', { limit: 1, window: '30m' })).success).toBe(true)
    })

    it('parses hour windows correctly', async () => {
      const key = 'user:hour'

      // 1 hour
      await limiter.check(key + ':1h', { limit: 1, window: '1h' })
      advanceTime(60 * 60 * 1000 + 1)
      expect((await limiter.check(key + ':1h', { limit: 1, window: '1h' })).success).toBe(true)

      // 12 hours
      await limiter.check(key + ':12h', { limit: 1, window: '12h' })
      advanceTime(12 * 60 * 60 * 1000 + 1)
      expect((await limiter.check(key + ':12h', { limit: 1, window: '12h' })).success).toBe(true)
    })

    it('parses day windows correctly', async () => {
      const key = 'user:day'

      // 1 day
      await limiter.check(key + ':1d', { limit: 1, window: '1d' })
      advanceTime(24 * 60 * 60 * 1000 + 1)
      expect((await limiter.check(key + ':1d', { limit: 1, window: '1d' })).success).toBe(true)

      // 7 days
      await limiter.check(key + ':7d', { limit: 1, window: '7d' })
      advanceTime(7 * 24 * 60 * 60 * 1000 + 1)
      expect((await limiter.check(key + ':7d', { limit: 1, window: '7d' })).success).toBe(true)
    })

    it('throws error for invalid window format', async () => {
      const key = 'user:invalid'

      // Invalid formats should throw
      await expect(limiter.check(key, { limit: 1, window: 'invalid' })).rejects.toThrow()
      await expect(limiter.check(key, { limit: 1, window: '1x' })).rejects.toThrow()
      await expect(limiter.check(key, { limit: 1, window: 'm1' })).rejects.toThrow()
      await expect(limiter.check(key, { limit: 1, window: '' })).rejects.toThrow()
      await expect(limiter.check(key, { limit: 1, window: '1' })).rejects.toThrow()
      await expect(limiter.check(key, { limit: 1, window: 'm' })).rejects.toThrow()
    })

    it('handles edge case window values', async () => {
      const key = 'user:edge'

      // 0 should throw or be handled gracefully
      await expect(limiter.check(key, { limit: 1, window: '0m' })).rejects.toThrow()

      // Very large numbers
      expect((await limiter.check(key + ':large', { limit: 1, window: '999d' })).success).toBe(true)
    })
  })

  // ==========================================================================
  // TESTS: EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('handles limit of 0', async () => {
      const key = 'user:zero-limit'

      // All requests should be blocked immediately
      const result = await limiter.check(key, { limit: 0, window: '1m' })
      expect(result.success).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('handles very high limits', async () => {
      const key = 'user:high-limit'
      const opts: RateLimitOptions = { limit: 1000000, window: '1m' }

      // Should allow up to the limit
      const result = await limiter.check(key, opts)
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(999999)
    })

    it('handles empty key', async () => {
      const opts: RateLimitOptions = { limit: 1, window: '1m' }

      // Empty key should work (or throw, depending on design)
      // Testing that it handles gracefully
      const result = await limiter.check('', opts)
      expect(result.success).toBe(true)
    })

    it('handles special characters in key', async () => {
      const opts: RateLimitOptions = { limit: 2, window: '1m' }

      // Keys with special characters
      const specialKeys = [
        'user:123:action:create',
        'ip:192.168.1.1',
        'api:v1/users/list',
        'user:test@example.com',
        'user:name with spaces',
        'user:unicode-\u00e9\u00e8\u00ea',
      ]

      for (const key of specialKeys) {
        const result = await limiter.check(key, opts)
        expect(result.success).toBe(true)
      }
    })

    it('handles very long key', async () => {
      const opts: RateLimitOptions = { limit: 1, window: '1m' }
      const longKey = 'user:' + 'a'.repeat(10000)

      const result = await limiter.check(longKey, opts)
      expect(result.success).toBe(true)
    })

    it('handles negative limit', async () => {
      const key = 'user:negative'

      // Negative limit should throw or be handled as 0
      await expect(limiter.check(key, { limit: -1, window: '1m' })).rejects.toThrow()
    })

    it('returns consistent results for same timestamp', async () => {
      const key = 'user:same-time'
      const opts: RateLimitOptions = { limit: 5, window: '1m' }

      // All requests at exactly the same time should count
      const results = await Promise.all([
        limiter.check(key, opts),
        limiter.check(key, opts),
        limiter.check(key, opts),
      ])

      const successes = results.filter((r) => r.success).length
      expect(successes).toBeGreaterThan(0)
      expect(successes).toBeLessThanOrEqual(5)
    })

    it('handles different limits for same key', async () => {
      const key = 'user:different-limits'

      // Make 5 requests with limit 10
      for (let i = 0; i < 5; i++) {
        await limiter.check(key, { limit: 10, window: '1m' })
      }

      // Check with lower limit should still count all entries
      const result = await limiter.check(key, { limit: 3, window: '1m' })
      expect(result.success).toBe(false) // 5 > 3, should be blocked
    })

    it('handles different windows for same key', async () => {
      const key = 'user:different-windows'

      // Make requests with 1 minute window
      await limiter.check(key, { limit: 10, window: '1m' })
      await limiter.check(key, { limit: 10, window: '1m' })

      // Advance 61 seconds
      advanceTime(61000)

      // With 1 minute window, should have full quota
      const result1m = await limiter.check(key, { limit: 10, window: '1m' })
      expect(result1m.remaining).toBe(9)

      // With 1 hour window, should still count old requests
      // This depends on implementation - testing the behavior
      const result1h = await limiter.check(key, { limit: 10, window: '1h' })
      // The 2 requests at t=0 are still within 1h window
      // Plus 1 at t=61s and 1 at t=61s = 4 total
      expect(result1h.remaining).toBeLessThan(10)
    })
  })

})

// ============================================================================
// TESTS: HELPER FUNCTION (parseWindow) - These tests pass immediately
// since the helper is implemented in this file
// ============================================================================

describe('parseWindow helper', () => {
  it('converts minutes to milliseconds', () => {
    expect(parseWindow('1m')).toBe(60000)
    expect(parseWindow('5m')).toBe(300000)
    expect(parseWindow('30m')).toBe(1800000)
    expect(parseWindow('60m')).toBe(3600000)
  })

  it('converts hours to milliseconds', () => {
    expect(parseWindow('1h')).toBe(3600000)
    expect(parseWindow('12h')).toBe(43200000)
    expect(parseWindow('24h')).toBe(86400000)
  })

  it('converts days to milliseconds', () => {
    expect(parseWindow('1d')).toBe(86400000)
    expect(parseWindow('7d')).toBe(604800000)
    expect(parseWindow('30d')).toBe(2592000000)
  })

  it('throws for invalid formats', () => {
    expect(() => parseWindow('invalid')).toThrow()
    expect(() => parseWindow('1x')).toThrow()
    expect(() => parseWindow('m1')).toThrow()
    expect(() => parseWindow('')).toThrow()
    expect(() => parseWindow('1')).toThrow()
    expect(() => parseWindow('m')).toThrow()
    expect(() => parseWindow('1s')).toThrow() // seconds not supported
  })
})
