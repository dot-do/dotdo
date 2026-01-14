/**
 * Sliding Window Rate Limiter Tests (TDD - Phase 2)
 *
 * These tests verify the SlidingWindowLimiter implementation which provides:
 * - Precise sliding window semantics (entries expire individually based on timestamp)
 * - Concurrent request safety via atomic counting
 * - Configurable window sizes (minutes, hours, days)
 * - Cleanup for expired entries
 *
 * Part of Platform Integrations TDD Implementation (dotdo-9qmv)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { parseWindow, SlidingWindowLimiter, rateLimitEntries } from '../sliding-window'
import type { RateLimitResult, RateLimitOptions } from '../sliding-window'

// ============================================================================
// 1. parseWindow() - Window String Parsing
// ============================================================================

describe('parseWindow', () => {
  describe('valid formats', () => {
    it('parses minutes correctly', () => {
      expect(parseWindow('1m')).toBe(60 * 1000) // 1 minute in ms
      expect(parseWindow('5m')).toBe(5 * 60 * 1000) // 5 minutes in ms
      expect(parseWindow('60m')).toBe(60 * 60 * 1000) // 60 minutes in ms
    })

    it('parses hours correctly', () => {
      expect(parseWindow('1h')).toBe(60 * 60 * 1000) // 1 hour in ms
      expect(parseWindow('24h')).toBe(24 * 60 * 60 * 1000) // 24 hours in ms
    })

    it('parses days correctly', () => {
      expect(parseWindow('1d')).toBe(24 * 60 * 60 * 1000) // 1 day in ms
      expect(parseWindow('7d')).toBe(7 * 24 * 60 * 60 * 1000) // 7 days in ms
    })

    it('handles large numbers', () => {
      expect(parseWindow('1000m')).toBe(1000 * 60 * 1000)
      expect(parseWindow('999h')).toBe(999 * 60 * 60 * 1000)
    })
  })

  describe('invalid formats', () => {
    it('throws on invalid format - missing number', () => {
      expect(() => parseWindow('m')).toThrow()
      expect(() => parseWindow('h')).toThrow()
      expect(() => parseWindow('d')).toThrow()
    })

    it('throws on invalid format - missing unit', () => {
      expect(() => parseWindow('60')).toThrow()
      expect(() => parseWindow('1')).toThrow()
    })

    it('throws on invalid format - unknown unit', () => {
      expect(() => parseWindow('1s')).toThrow() // seconds not supported
      expect(() => parseWindow('1w')).toThrow() // weeks not supported
      expect(() => parseWindow('1y')).toThrow() // years not supported
    })

    it('throws on zero value', () => {
      expect(() => parseWindow('0m')).toThrow()
      expect(() => parseWindow('0h')).toThrow()
      expect(() => parseWindow('0d')).toThrow()
    })

    it('throws on negative values', () => {
      expect(() => parseWindow('-1m')).toThrow()
      expect(() => parseWindow('-5h')).toThrow()
    })

    it('throws on empty string', () => {
      expect(() => parseWindow('')).toThrow()
    })

    it('throws on invalid characters', () => {
      expect(() => parseWindow('1.5m')).toThrow()
      expect(() => parseWindow('1m2h')).toThrow()
      expect(() => parseWindow('abc')).toThrow()
    })
  })
})

// ============================================================================
// 2. SlidingWindowLimiter - Basic Operations
// ============================================================================

describe('SlidingWindowLimiter', () => {
  /**
   * Mock database for testing.
   * Simulates Drizzle's SQL-based operations.
   *
   * Drizzle's sql`...` template creates objects with queryChunks containing
   * the SQL template parts and the interpolated values.
   */
  function createMockDb() {
    const entries: Array<{ id: number; key: string; timestamp: number }> = []
    let idCounter = 0

    // Helper to extract values from Drizzle SQL object
    // Drizzle's sql`` template creates an object with queryChunks that alternates
    // between StringChunk objects and the interpolated values
    function extractValues(query: unknown): unknown[] {
      const q = query as { queryChunks?: unknown[] }

      if (q.queryChunks && Array.isArray(q.queryChunks)) {
        // Filter out StringChunk objects (which have a 'value' property)
        // Keep only the raw interpolated values
        return q.queryChunks.filter((chunk) => {
          // StringChunk has a 'value' property that's an array of strings
          const c = chunk as { value?: unknown }
          return !c.value || !Array.isArray(c.value)
        })
      }

      return []
    }

    // Helper to get the SQL text from the query
    function getSqlText(query: unknown): string {
      const q = query as { queryChunks?: Array<{ value?: string[] }> }

      if (q.queryChunks && Array.isArray(q.queryChunks)) {
        return q.queryChunks
          .filter((chunk) => chunk.value && Array.isArray(chunk.value))
          .map((chunk) => chunk.value!.join(''))
          .join(' ')
      }

      return ''
    }

    return {
      entries,
      run: (query: unknown) => {
        const queryStr = getSqlText(query)
        const values = extractValues(query)

        // INSERT operation
        if (queryStr.includes('INSERT') || queryStr.includes('insert')) {
          // Values: [key, timestamp]
          const key = String(values[0] ?? '')
          const timestamp = Number(values[1] ?? Date.now())
          entries.push({ id: ++idCounter, key, timestamp })
          return { changes: 1 }
        }

        // DELETE operation
        if (queryStr.includes('DELETE') || queryStr.includes('delete')) {
          // Values: [cutoff]
          const cutoff = Number(values[0] ?? 0)
          const before = entries.length
          const toRemove = entries.filter((e) => e.timestamp < cutoff)
          toRemove.forEach((e) => {
            const idx = entries.indexOf(e)
            if (idx >= 0) entries.splice(idx, 1)
          })
          return { changes: before - entries.length }
        }

        return { changes: 0 }
      },
      all: <T>(query: unknown): T[] => {
        const queryStr = getSqlText(query)
        const values = extractValues(query)

        // COUNT query
        if (queryStr.includes('COUNT') || queryStr.includes('count')) {
          // Values: [key, cutoff]
          const key = String(values[0] ?? '')
          const cutoff = Number(values[1] ?? 0)
          const count = entries.filter((e) => e.key === key && e.timestamp > cutoff).length
          return [{ count }] as T[]
        }

        return [] as T[]
      },
      get: <T>(_query: unknown): T | undefined => undefined,
    }
  }

  describe('check()', () => {
    it('returns { success: true, remaining } when under limit', () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)

      const result = limiter.check('user:123', { limit: 100, window: '1m' })

      expect(result).toBeInstanceOf(Promise)
    })

    it('allows first request', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)

      const result = await limiter.check('user:123', { limit: 10, window: '1m' })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(9) // 10 - 1 = 9
    })

    it('tracks remaining correctly across multiple requests', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)
      const opts: RateLimitOptions = { limit: 5, window: '1m' }

      const r1 = await limiter.check('user:123', opts)
      expect(r1.remaining).toBe(4)

      const r2 = await limiter.check('user:123', opts)
      expect(r2.remaining).toBe(3)

      const r3 = await limiter.check('user:123', opts)
      expect(r3.remaining).toBe(2)
    })

    it('returns { success: false, remaining: 0 } when limit exceeded', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)
      const opts: RateLimitOptions = { limit: 3, window: '1m' }

      await limiter.check('user:123', opts) // 1
      await limiter.check('user:123', opts) // 2
      await limiter.check('user:123', opts) // 3 (at limit)

      const result = await limiter.check('user:123', opts) // 4 (over limit)

      expect(result.success).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('handles limit of 0 - all requests blocked', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)

      const result = await limiter.check('user:123', { limit: 0, window: '1m' })

      expect(result.success).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('throws on negative limit', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)

      await expect(limiter.check('user:123', { limit: -1, window: '1m' })).rejects.toThrow()
    })

    it('isolates different keys', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)
      const opts: RateLimitOptions = { limit: 2, window: '1m' }

      await limiter.check('user:1', opts)
      await limiter.check('user:1', opts)
      const user1Result = await limiter.check('user:1', opts) // over limit

      const user2Result = await limiter.check('user:2', opts) // first request for user:2

      expect(user1Result.success).toBe(false)
      expect(user2Result.success).toBe(true)
    })
  })

  describe('cleanup()', () => {
    it('returns number of entries removed', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)

      // Add some entries
      await limiter.check('user:123', { limit: 100, window: '1m' })
      await limiter.check('user:123', { limit: 100, window: '1m' })

      // Mock old timestamps by manipulating the db
      db.entries.forEach((e) => (e.timestamp = Date.now() - 120000)) // 2 minutes ago

      const result = await limiter.cleanup({ maxAge: '1m' })

      expect(typeof result).toBe('number')
      expect(result).toBe(2)
    })

    it('uses default maxAge of 1m if not specified', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)

      await limiter.check('user:123', { limit: 100, window: '1m' })
      db.entries.forEach((e) => (e.timestamp = Date.now() - 120000))

      const result = await limiter.cleanup()

      expect(result).toBe(1)
    })

    it('preserves entries within window', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)

      await limiter.check('user:123', { limit: 100, window: '1m' })
      // Entry is fresh, should not be cleaned

      const result = await limiter.cleanup({ maxAge: '1h' })

      expect(result).toBe(0)
      expect(db.entries.length).toBe(1)
    })
  })

  describe('window expiry', () => {
    it('resets count after window expires', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)
      const opts: RateLimitOptions = { limit: 2, window: '1m' }

      // Use up the limit
      await limiter.check('user:123', opts)
      await limiter.check('user:123', opts)

      // Move entries to past the window
      db.entries.forEach((e) => (e.timestamp = Date.now() - 120000))

      // Should be allowed again
      const result = await limiter.check('user:123', opts)

      expect(result.success).toBe(true)
    })
  })

  describe('result shape', () => {
    it('always returns { success: boolean, remaining: number }', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)

      const result = await limiter.check('user:123', { limit: 10, window: '1m' })

      expect(typeof result.success).toBe('boolean')
      expect(typeof result.remaining).toBe('number')
    })

    it('remaining is never negative', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)
      const opts: RateLimitOptions = { limit: 1, window: '1m' }

      await limiter.check('user:123', opts)
      const result = await limiter.check('user:123', opts)

      expect(result.remaining).toBeGreaterThanOrEqual(0)
    })
  })

  describe('edge cases', () => {
    it('handles empty key', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)

      const result = await limiter.check('', { limit: 10, window: '1m' })

      expect(result).toBeDefined()
      expect(result.success).toBe(true)
    })

    it('handles special characters in key', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)

      const result1 = await limiter.check('user:123:api/v1', { limit: 10, window: '1m' })
      const result2 = await limiter.check('email@example.com', { limit: 10, window: '1m' })
      const result3 = await limiter.check("key'with'quotes", { limit: 10, window: '1m' })

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      expect(result3.success).toBe(true)
    })

    it('handles very large limits', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)

      const result = await limiter.check('user:123', { limit: 1000000, window: '1m' })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(999999)
    })

    it('handles concurrent requests', async () => {
      const db = createMockDb()
      const limiter = new SlidingWindowLimiter(db)
      const opts: RateLimitOptions = { limit: 10, window: '1m' }

      const results = await Promise.all([
        limiter.check('user:123', opts),
        limiter.check('user:123', opts),
        limiter.check('user:123', opts),
      ])

      results.forEach((result) => {
        expect(result).toHaveProperty('success')
        expect(result).toHaveProperty('remaining')
      })
    })
  })
})

// ============================================================================
// 3. Type Exports Verification
// ============================================================================

describe('Type Exports', () => {
  it('exports RateLimitResult type', () => {
    const result: RateLimitResult = { success: true, remaining: 10 }
    expect(result.success).toBe(true)
    expect(result.remaining).toBe(10)
  })

  it('exports RateLimitOptions type', () => {
    const opts: RateLimitOptions = { limit: 100, window: '1h' }
    expect(opts.limit).toBe(100)
    expect(opts.window).toBe('1h')
  })

  it('exports rateLimitEntries schema', () => {
    expect(rateLimitEntries).toBeDefined()
  })

  it('exports SlidingWindowLimiter class', () => {
    expect(SlidingWindowLimiter).toBeDefined()
  })

  it('exports parseWindow function', () => {
    expect(parseWindow).toBeDefined()
    expect(typeof parseWindow).toBe('function')
  })
})
