/**
 * GREEN Phase Tests for $.rateLimit() Workflow Context API
 *
 * These tests verify the $.rateLimit() context API that integrates
 * rate limiting into the workflow context ($).
 *
 * Related issues:
 * - dotdo-c0qk: [Red] $.rateLimit() context API tests (cost-based)
 * - dotdo-au4m: [Green] Implement $.rateLimit() API
 *
 * The API integrates with the existing $ proxy pattern:
 * - $.rateLimit(key) returns a RateLimitContextInstance for per-key operations
 * - $.rateLimits provides named limit configurations (e.g., 'api', 'ai', 'upload')
 *
 * Cost-based rate limiting allows:
 * - Different operations to consume different amounts of quota
 * - AI token operations cost more than simple API calls
 * - Heavy operations (uploads, exports) can be rate limited separately
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createMockContext,
  parseWindow,
  type RateLimitResult,
  type RateLimitConfig,
  type RateLimitOptions,
  type RateLimitContextInstance,
  type RateLimitsCollection,
  type RateLimitStorage,
} from '../../workflows/context/rate-limit'

// Re-export types for backward compatibility with any code depending on this file
export type { RateLimitResult, RateLimitConfig, RateLimitOptions, RateLimitContextInstance, RateLimitsCollection }

/**
 * Mock storage type alias for backward compatibility
 */
type MockStorage = RateLimitStorage

// ============================================================================
// $.rateLimit(key).check() - Check if request is allowed
// ============================================================================

describe('$.rateLimit(key).check() returns rate limit result', () => {
  let $: ReturnType<typeof createMockContext>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    $ = createMockContext()

    // Setup default 'api' limit
    $.rateLimits.configure('api', { limit: 100, window: '1m' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns success: true for first request', async () => {
    const result = await $.rateLimit('user:123').check({ name: 'api' })

    expect(result.success).toBe(true)
  })

  it('returns remaining count after request', async () => {
    const result = await $.rateLimit('user:123').check({ name: 'api' })

    expect(result.remaining).toBe(99) // 100 - 1 = 99
  })

  it('returns success: true until limit is reached', async () => {
    // Configure a small limit for testing
    $.rateLimits.configure('test', { limit: 3, window: '1m' })

    const results: RateLimitResult[] = []
    for (let i = 0; i < 3; i++) {
      results.push(await $.rateLimit('user:123').check({ name: 'test' }))
    }

    expect(results.every((r) => r.success)).toBe(true)
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0])
  })

  it('returns success: false when limit is exceeded', async () => {
    $.rateLimits.configure('test', { limit: 2, window: '1m' })

    await $.rateLimit('user:123').check({ name: 'test' })
    await $.rateLimit('user:123').check({ name: 'test' })
    const result = await $.rateLimit('user:123').check({ name: 'test' })

    expect(result.success).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('tracks different keys independently', async () => {
    $.rateLimits.configure('test', { limit: 2, window: '1m' })

    // Exhaust limit for user:A
    await $.rateLimit('user:A').check({ name: 'test' })
    await $.rateLimit('user:A').check({ name: 'test' })

    // user:B should still have full quota
    const result = await $.rateLimit('user:B').check({ name: 'test' })
    expect(result.success).toBe(true)
    expect(result.remaining).toBe(1)
  })

  it('resets after window expires', async () => {
    $.rateLimits.configure('test', { limit: 1, window: '1m' })

    await $.rateLimit('user:123').check({ name: 'test' })

    // Should be blocked
    expect((await $.rateLimit('user:123').check({ name: 'test' })).success).toBe(false)

    // Advance time past the window
    vi.advanceTimersByTime(61 * 1000)

    // Should be allowed again
    const result = await $.rateLimit('user:123').check({ name: 'test' })
    expect(result.success).toBe(true)
  })

  it('returns resetAt timestamp', async () => {
    $.rateLimits.configure('test', { limit: 1, window: '1m' })

    const result = await $.rateLimit('user:123').check({ name: 'test' })

    expect(result.resetAt).toBeDefined()
    expect(result.resetAt).toBeGreaterThan(Date.now())
  })

  it('returns limit in result', async () => {
    $.rateLimits.configure('test', { limit: 50, window: '1h' })

    const result = await $.rateLimit('user:123').check({ name: 'test' })

    expect(result.limit).toBe(50)
  })
})

// ============================================================================
// $.rateLimit(key).isAllowed() - Boolean check
// ============================================================================

describe('$.rateLimit(key).isAllowed() returns boolean', () => {
  let $: ReturnType<typeof createMockContext>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    $ = createMockContext()
    $.rateLimits.configure('api', { limit: 100, window: '1m' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns true when under limit', async () => {
    $.rateLimits.configure('test', { limit: 10, window: '1m' })

    const allowed = await $.rateLimit('user:123').isAllowed({ name: 'test' })

    expect(allowed).toBe(true)
    expect(typeof allowed).toBe('boolean')
  })

  it('returns false when at limit', async () => {
    $.rateLimits.configure('test', { limit: 1, window: '1m' })

    await $.rateLimit('user:123').check({ name: 'test' })
    const allowed = await $.rateLimit('user:123').isAllowed({ name: 'test' })

    expect(allowed).toBe(false)
  })

  it('does NOT consume quota (peek only)', async () => {
    $.rateLimits.configure('test', { limit: 2, window: '1m' })

    // Call isAllowed multiple times
    await $.rateLimit('user:123').isAllowed({ name: 'test' })
    await $.rateLimit('user:123').isAllowed({ name: 'test' })
    await $.rateLimit('user:123').isAllowed({ name: 'test' })

    // Should still have full quota
    const result = await $.rateLimit('user:123').check({ name: 'test' })
    expect(result.remaining).toBe(1) // 2 - 1 = 1
  })

  it('respects cost parameter for check', async () => {
    $.rateLimits.configure('test', { limit: 10, window: '1m' })

    // Consume 8 units
    await $.rateLimit('user:123').check({ name: 'test', cost: 8 })

    // isAllowed with cost 1 should return true (2 remaining)
    expect(await $.rateLimit('user:123').isAllowed({ name: 'test', cost: 1 })).toBe(true)

    // isAllowed with cost 3 should return false (only 2 remaining)
    expect(await $.rateLimit('user:123').isAllowed({ name: 'test', cost: 3 })).toBe(false)
  })

  it('returns true after window resets', async () => {
    $.rateLimits.configure('test', { limit: 1, window: '1m' })

    await $.rateLimit('user:123').check({ name: 'test' })
    expect(await $.rateLimit('user:123').isAllowed({ name: 'test' })).toBe(false)

    vi.advanceTimersByTime(61 * 1000)

    expect(await $.rateLimit('user:123').isAllowed({ name: 'test' })).toBe(true)
  })
})

// ============================================================================
// $.rateLimit(key).remaining() - Get remaining count
// ============================================================================

describe('$.rateLimit(key).remaining() returns remaining quota', () => {
  let $: ReturnType<typeof createMockContext>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    $ = createMockContext()
    $.rateLimits.configure('api', { limit: 100, window: '1m' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns full limit for new key', async () => {
    $.rateLimits.configure('test', { limit: 50, window: '1m' })

    const remaining = await $.rateLimit('user:123').remaining({ name: 'test' })

    expect(remaining).toBe(50)
  })

  it('returns correct remaining after consumption', async () => {
    $.rateLimits.configure('test', { limit: 10, window: '1m' })

    await $.rateLimit('user:123').check({ name: 'test' })
    await $.rateLimit('user:123').check({ name: 'test' })
    await $.rateLimit('user:123').check({ name: 'test' })

    const remaining = await $.rateLimit('user:123').remaining({ name: 'test' })
    expect(remaining).toBe(7)
  })

  it('returns 0 when limit is exhausted', async () => {
    $.rateLimits.configure('test', { limit: 2, window: '1m' })

    await $.rateLimit('user:123').check({ name: 'test' })
    await $.rateLimit('user:123').check({ name: 'test' })

    const remaining = await $.rateLimit('user:123').remaining({ name: 'test' })
    expect(remaining).toBe(0)
  })

  it('never returns negative', async () => {
    $.rateLimits.configure('test', { limit: 1, window: '1m' })

    await $.rateLimit('user:123').check({ name: 'test' })
    await $.rateLimit('user:123').check({ name: 'test' }) // Blocked, but let's check

    const remaining = await $.rateLimit('user:123').remaining({ name: 'test' })
    expect(remaining).toBeGreaterThanOrEqual(0)
  })

  it('does NOT consume quota', async () => {
    $.rateLimits.configure('test', { limit: 5, window: '1m' })

    // Call remaining multiple times
    await $.rateLimit('user:123').remaining({ name: 'test' })
    await $.rateLimit('user:123').remaining({ name: 'test' })
    await $.rateLimit('user:123').remaining({ name: 'test' })

    // Should still have full quota
    const remaining = await $.rateLimit('user:123').remaining({ name: 'test' })
    expect(remaining).toBe(5)
  })

  it('returns full limit after window resets', async () => {
    $.rateLimits.configure('test', { limit: 10, window: '1m' })

    // Exhaust limit
    for (let i = 0; i < 10; i++) {
      await $.rateLimit('user:123').check({ name: 'test' })
    }

    expect(await $.rateLimit('user:123').remaining({ name: 'test' })).toBe(0)

    // Advance past window
    vi.advanceTimersByTime(61 * 1000)

    expect(await $.rateLimit('user:123').remaining({ name: 'test' })).toBe(10)
  })

  it('tracks different keys independently', async () => {
    $.rateLimits.configure('test', { limit: 10, window: '1m' })

    await $.rateLimit('user:A').check({ name: 'test', cost: 5 })

    expect(await $.rateLimit('user:A').remaining({ name: 'test' })).toBe(5)
    expect(await $.rateLimit('user:B').remaining({ name: 'test' })).toBe(10)
  })
})

// ============================================================================
// Cost-based rate limiting
// ============================================================================

describe('Cost-based rate limiting', () => {
  let $: ReturnType<typeof createMockContext>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    $ = createMockContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic cost consumption', () => {
    it('consumes 1 unit by default', async () => {
      $.rateLimits.configure('test', { limit: 10, window: '1m' })

      await $.rateLimit('user:123').check({ name: 'test' })

      expect(await $.rateLimit('user:123').remaining({ name: 'test' })).toBe(9)
    })

    it('consumes specified cost', async () => {
      $.rateLimits.configure('test', { limit: 100, window: '1m' })

      await $.rateLimit('user:123').check({ name: 'test', cost: 10 })

      expect(await $.rateLimit('user:123').remaining({ name: 'test' })).toBe(90)
    })

    it('blocks when cost exceeds remaining', async () => {
      $.rateLimits.configure('test', { limit: 10, window: '1m' })

      await $.rateLimit('user:123').check({ name: 'test', cost: 8 })

      // Try to consume 5 more (only 2 remaining)
      const result = await $.rateLimit('user:123').check({ name: 'test', cost: 5 })

      expect(result.success).toBe(false)
      expect(result.remaining).toBe(2)
    })

    it('allows exact remaining cost', async () => {
      $.rateLimits.configure('test', { limit: 10, window: '1m' })

      await $.rateLimit('user:123').check({ name: 'test', cost: 8 })

      // Consume exactly remaining
      const result = await $.rateLimit('user:123').check({ name: 'test', cost: 2 })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(0)
    })

    it('returns cost in result', async () => {
      $.rateLimits.configure('test', { limit: 100, window: '1m' })

      const result = await $.rateLimit('user:123').check({ name: 'test', cost: 15 })

      expect(result.cost).toBe(15)
    })
  })

  describe('AI token cost modeling', () => {
    beforeEach(() => {
      // AI limit: 100,000 tokens per hour
      $.rateLimits.configure('ai', { limit: 100000, window: '1h', description: 'AI token limit' })
    })

    it('handles AI token costs (typical prompt)', async () => {
      // Typical prompt: ~500 tokens
      const result = await $.rateLimit('user:123').check({ name: 'ai', cost: 500 })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(99500)
    })

    it('handles AI token costs (large context)', async () => {
      // Large context: ~10,000 tokens
      const result = await $.rateLimit('user:123').check({ name: 'ai', cost: 10000 })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(90000)
    })

    it('blocks when AI token limit exceeded', async () => {
      // Use up most of the limit
      await $.rateLimit('user:123').check({ name: 'ai', cost: 95000 })

      // Try to use 10,000 more (only 5,000 remaining)
      const result = await $.rateLimit('user:123').check({ name: 'ai', cost: 10000 })

      expect(result.success).toBe(false)
      expect(result.remaining).toBe(5000)
    })

    it('allows multiple small requests that total under limit', async () => {
      // 100 requests of 500 tokens each = 50,000 total
      const results: RateLimitResult[] = []
      for (let i = 0; i < 100; i++) {
        results.push(await $.rateLimit('user:123').check({ name: 'ai', cost: 500 }))
      }

      expect(results.every((r) => r.success)).toBe(true)
      expect(results[results.length - 1].remaining).toBe(50000)
    })

    it('isAllowed respects token cost', async () => {
      await $.rateLimit('user:123').check({ name: 'ai', cost: 95000 })

      // Check if 1000 tokens would be allowed (yes, 5000 remaining)
      expect(await $.rateLimit('user:123').isAllowed({ name: 'ai', cost: 1000 })).toBe(true)

      // Check if 10000 tokens would be allowed (no, only 5000 remaining)
      expect(await $.rateLimit('user:123').isAllowed({ name: 'ai', cost: 10000 })).toBe(false)
    })
  })

  describe('API call vs AI call differentiation', () => {
    beforeEach(() => {
      // API: 1000 requests per minute (each costs 1)
      $.rateLimits.configure('api', { limit: 1000, window: '1m' })
      // AI: 100,000 tokens per hour
      $.rateLimits.configure('ai', { limit: 100000, window: '1h' })
    })

    it('simple API calls cost 1', async () => {
      const result = await $.rateLimit('user:123').check({ name: 'api', cost: 1 })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(999)
    })

    it('AI calls can cost more', async () => {
      const result = await $.rateLimit('user:123').check({ name: 'ai', cost: 5000 })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(95000)
    })

    it('same key can be rate limited differently for api vs ai', async () => {
      // User makes API calls and AI calls
      await $.rateLimit('user:123').check({ name: 'api', cost: 500 }) // 500/1000 API
      await $.rateLimit('user:123').check({ name: 'ai', cost: 50000 }) // 50000/100000 AI

      // Check remaining for each
      expect(await $.rateLimit('user:123').remaining({ name: 'api' })).toBe(500)
      expect(await $.rateLimit('user:123').remaining({ name: 'ai' })).toBe(50000)
    })

    it('exhausting API limit does not affect AI limit', async () => {
      // Exhaust API limit
      await $.rateLimit('user:123').check({ name: 'api', cost: 1000 })
      expect((await $.rateLimit('user:123').check({ name: 'api' })).success).toBe(false)

      // AI should still work
      const result = await $.rateLimit('user:123').check({ name: 'ai', cost: 1000 })
      expect(result.success).toBe(true)
    })
  })

  describe('$.rateLimit(key).consume() for post-facto consumption', () => {
    beforeEach(() => {
      $.rateLimits.configure('ai', { limit: 100000, window: '1h' })
    })

    it('consumes tokens after the fact', async () => {
      // User makes an AI call, we measure tokens afterward
      // First, reserve some quota
      await $.rateLimit('user:123').check({ name: 'ai', cost: 0 })

      // After measuring actual usage, consume the tokens
      const result = await $.rateLimit('user:123').consume(7500, { name: 'ai' })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(92500)
    })

    it('consume() can exceed remaining (goes negative scenario)', async () => {
      // Use most of the quota
      await $.rateLimit('user:123').check({ name: 'ai', cost: 95000 })

      // AI response comes back with more tokens than expected
      // consume() should still record it (implementation may vary)
      const result = await $.rateLimit('user:123').consume(10000, { name: 'ai' })

      // Either success: false (blocked future requests) or remaining: -5000
      // The key point is the consumption is recorded
      expect(result.remaining).toBeLessThanOrEqual(0)
    })

    it('consume() returns updated remaining', async () => {
      await $.rateLimit('user:123').check({ name: 'ai', cost: 50000 })

      const result = await $.rateLimit('user:123').consume(25000, { name: 'ai' })

      expect(result.remaining).toBe(25000)
    })
  })

  describe('upload/heavy operation cost modeling', () => {
    beforeEach(() => {
      // Upload limit: 100 MB per day (measured in KB for granularity)
      $.rateLimits.configure('upload', { limit: 100 * 1024, window: '1d', description: 'Upload limit in KB' })
    })

    it('small file upload costs proportionally', async () => {
      // 500 KB file
      const result = await $.rateLimit('user:123').check({ name: 'upload', cost: 500 })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(100 * 1024 - 500)
    })

    it('large file upload costs proportionally', async () => {
      // 50 MB file (50 * 1024 KB)
      const result = await $.rateLimit('user:123').check({ name: 'upload', cost: 50 * 1024 })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(50 * 1024) // 50 MB remaining
    })

    it('blocks when upload limit exceeded', async () => {
      // Use 90 MB
      await $.rateLimit('user:123').check({ name: 'upload', cost: 90 * 1024 })

      // Try to upload 20 MB more (only 10 MB remaining)
      const result = await $.rateLimit('user:123').check({ name: 'upload', cost: 20 * 1024 })

      expect(result.success).toBe(false)
    })
  })

  describe('fractional costs', () => {
    it('handles fractional costs (rounds appropriately)', async () => {
      $.rateLimits.configure('test', { limit: 1000, window: '1m' })

      // Cost of 1.5 - implementation may floor, ceil, or round
      const result = await $.rateLimit('user:123').check({ name: 'test', cost: 1.5 })

      expect(result.success).toBe(true)
      // Remaining should reflect the consumption (exact handling is implementation detail)
      expect(result.remaining).toBeLessThan(1000)
    })

    it('handles zero cost (peek/check without consuming)', async () => {
      $.rateLimits.configure('test', { limit: 10, window: '1m' })

      const result = await $.rateLimit('user:123').check({ name: 'test', cost: 0 })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(10) // No consumption
    })

    it('rejects negative cost', async () => {
      $.rateLimits.configure('test', { limit: 10, window: '1m' })

      await expect($.rateLimit('user:123').check({ name: 'test', cost: -5 })).rejects.toThrow()
    })
  })
})

// ============================================================================
// Named limits (e.g., 'api', 'ai', 'upload')
// ============================================================================

describe('Named rate limits', () => {
  let $: ReturnType<typeof createMockContext>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    $ = createMockContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('$.rateLimits.configure()', () => {
    it('configures a new named limit', () => {
      $.rateLimits.configure('custom', { limit: 500, window: '5m' })

      const config = $.rateLimits.get('custom')
      expect(config).toEqual({ limit: 500, window: '5m' })
    })

    it('overwrites existing configuration', () => {
      $.rateLimits.configure('api', { limit: 100, window: '1m' })
      $.rateLimits.configure('api', { limit: 200, window: '2m' })

      const config = $.rateLimits.get('api')
      expect(config).toEqual({ limit: 200, window: '2m' })
    })

    it('supports description field', () => {
      $.rateLimits.configure('ai', {
        limit: 100000,
        window: '1h',
        description: 'AI token limit per hour',
      })

      const config = $.rateLimits.get('ai')
      expect(config?.description).toBe('AI token limit per hour')
    })
  })

  describe('$.rateLimits.getConfig()', () => {
    it('returns all configured limits', () => {
      $.rateLimits.configure('api', { limit: 1000, window: '1m' })
      $.rateLimits.configure('ai', { limit: 100000, window: '1h' })
      $.rateLimits.configure('upload', { limit: 102400, window: '1d' })

      const configs = $.rateLimits.getConfig()

      expect(configs['api']).toEqual({ limit: 1000, window: '1m' })
      expect(configs['ai']).toEqual({ limit: 100000, window: '1h' })
      expect(configs['upload']).toEqual({ limit: 102400, window: '1d' })
    })

    it('returns empty object when no limits configured', () => {
      const configs = $.rateLimits.getConfig()
      expect(configs).toEqual({})
    })

    it('returns a snapshot (mutations do not affect storage)', () => {
      $.rateLimits.configure('api', { limit: 100, window: '1m' })

      const configs = $.rateLimits.getConfig()
      configs['api'].limit = 999

      expect($.rateLimits.get('api')?.limit).toBe(100)
    })
  })

  describe('$.rateLimits.get()', () => {
    it('returns config for existing limit', () => {
      $.rateLimits.configure('api', { limit: 1000, window: '1m' })

      const config = $.rateLimits.get('api')
      expect(config).toEqual({ limit: 1000, window: '1m' })
    })

    it('returns undefined for non-existent limit', () => {
      const config = $.rateLimits.get('nonexistent')
      expect(config).toBeUndefined()
    })
  })

  describe('using named limits', () => {
    beforeEach(() => {
      $.rateLimits.configure('api', { limit: 100, window: '1m' })
      $.rateLimits.configure('ai', { limit: 10000, window: '1h' })
    })

    it('uses configured limit by name', async () => {
      const result = await $.rateLimit('user:123').check({ name: 'api' })

      expect(result.limit).toBe(100)
    })

    it('uses different limits for different names', async () => {
      const apiResult = await $.rateLimit('user:123').check({ name: 'api' })
      const aiResult = await $.rateLimit('user:123').check({ name: 'ai' })

      expect(apiResult.limit).toBe(100)
      expect(aiResult.limit).toBe(10000)
    })

    it('throws for unconfigured limit name', async () => {
      await expect($.rateLimit('user:123').check({ name: 'unknown' })).rejects.toThrow()
    })

    it('different named limits have separate counters', async () => {
      // Exhaust API limit
      for (let i = 0; i < 100; i++) {
        await $.rateLimit('user:123').check({ name: 'api' })
      }

      // API should be blocked
      expect((await $.rateLimit('user:123').check({ name: 'api' })).success).toBe(false)

      // AI should still have full quota
      const aiResult = await $.rateLimit('user:123').check({ name: 'ai' })
      expect(aiResult.success).toBe(true)
      expect(aiResult.remaining).toBe(9999)
    })

    it('same key + different limits = independent tracking', async () => {
      await $.rateLimit('user:123').check({ name: 'api', cost: 50 })
      await $.rateLimit('user:123').check({ name: 'ai', cost: 5000 })

      expect(await $.rateLimit('user:123').remaining({ name: 'api' })).toBe(50)
      expect(await $.rateLimit('user:123').remaining({ name: 'ai' })).toBe(5000)
    })
  })

  describe('common limit configurations', () => {
    it('API rate limit: 1000 req/min', async () => {
      $.rateLimits.configure('api', { limit: 1000, window: '1m' })

      // Make 1000 requests
      for (let i = 0; i < 1000; i++) {
        await $.rateLimit('user:123').check({ name: 'api' })
      }

      // 1001st should be blocked
      expect((await $.rateLimit('user:123').check({ name: 'api' })).success).toBe(false)
    })

    it('AI token limit: 100k tokens/hour', async () => {
      $.rateLimits.configure('ai', { limit: 100000, window: '1h' })

      await $.rateLimit('user:123').check({ name: 'ai', cost: 100000 })
      expect((await $.rateLimit('user:123').check({ name: 'ai', cost: 1 })).success).toBe(false)
    })

    it('Upload limit: 100 MB/day', async () => {
      $.rateLimits.configure('upload', { limit: 100 * 1024, window: '1d' }) // in KB

      await $.rateLimit('user:123').check({ name: 'upload', cost: 100 * 1024 })
      expect((await $.rateLimit('user:123').check({ name: 'upload', cost: 1 })).success).toBe(false)
    })

    it('Auth rate limit: 5 attempts/15min', async () => {
      $.rateLimits.configure('auth', { limit: 5, window: '15m' })

      for (let i = 0; i < 5; i++) {
        await $.rateLimit('ip:192.168.1.1').check({ name: 'auth' })
      }

      expect((await $.rateLimit('ip:192.168.1.1').check({ name: 'auth' })).success).toBe(false)
    })
  })
})

// ============================================================================
// $.rateLimit(key).reset() and $.rateLimit(key).status()
// ============================================================================

describe('$.rateLimit(key).reset() and $.rateLimit(key).status()', () => {
  let $: ReturnType<typeof createMockContext>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    $ = createMockContext()
    $.rateLimits.configure('api', { limit: 100, window: '1m' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('reset()', () => {
    it('resets rate limit for a key', async () => {
      // Exhaust limit
      for (let i = 0; i < 100; i++) {
        await $.rateLimit('user:123').check({ name: 'api' })
      }

      // Should be blocked
      expect((await $.rateLimit('user:123').check({ name: 'api' })).success).toBe(false)

      // Reset
      await $.rateLimit('user:123').reset({ name: 'api' })

      // Should be allowed again
      const result = await $.rateLimit('user:123').check({ name: 'api' })
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(99)
    })

    it('only resets the specified key', async () => {
      // Use quota for both users
      await $.rateLimit('user:A').check({ name: 'api', cost: 50 })
      await $.rateLimit('user:B').check({ name: 'api', cost: 50 })

      // Reset only user:A
      await $.rateLimit('user:A').reset({ name: 'api' })

      // user:A should have full quota
      expect(await $.rateLimit('user:A').remaining({ name: 'api' })).toBe(100)
      // user:B should still have 50 used
      expect(await $.rateLimit('user:B').remaining({ name: 'api' })).toBe(50)
    })

    it('reset is specific to named limit', async () => {
      $.rateLimits.configure('ai', { limit: 10000, window: '1h' })

      // Use both limits
      await $.rateLimit('user:123').check({ name: 'api', cost: 50 })
      await $.rateLimit('user:123').check({ name: 'ai', cost: 5000 })

      // Reset only API
      await $.rateLimit('user:123').reset({ name: 'api' })

      expect(await $.rateLimit('user:123').remaining({ name: 'api' })).toBe(100)
      expect(await $.rateLimit('user:123').remaining({ name: 'ai' })).toBe(5000)
    })

    it('reset is idempotent', async () => {
      await $.rateLimit('user:123').check({ name: 'api', cost: 50 })

      await $.rateLimit('user:123').reset({ name: 'api' })
      await $.rateLimit('user:123').reset({ name: 'api' })
      await $.rateLimit('user:123').reset({ name: 'api' })

      expect(await $.rateLimit('user:123').remaining({ name: 'api' })).toBe(100)
    })
  })

  describe('status()', () => {
    it('returns current status without modifying quota', async () => {
      await $.rateLimit('user:123').check({ name: 'api', cost: 30 })

      const status1 = await $.rateLimit('user:123').status({ name: 'api' })
      const status2 = await $.rateLimit('user:123').status({ name: 'api' })
      const status3 = await $.rateLimit('user:123').status({ name: 'api' })

      // All should return same values
      expect(status1.remaining).toBe(70)
      expect(status2.remaining).toBe(70)
      expect(status3.remaining).toBe(70)
    })

    it('returns success based on remaining quota', async () => {
      await $.rateLimit('user:123').check({ name: 'api', cost: 100 })

      const status = await $.rateLimit('user:123').status({ name: 'api' })

      expect(status.success).toBe(false)
      expect(status.remaining).toBe(0)
    })

    it('returns limit and resetAt', async () => {
      await $.rateLimit('user:123').check({ name: 'api' })

      const status = await $.rateLimit('user:123').status({ name: 'api' })

      expect(status.limit).toBe(100)
      expect(status.resetAt).toBeDefined()
      expect(status.resetAt).toBeGreaterThan(Date.now())
    })

    it('returns full quota for new key', async () => {
      const status = await $.rateLimit('new-user:456').status({ name: 'api' })

      expect(status.success).toBe(true)
      expect(status.remaining).toBe(100)
    })
  })
})

// ============================================================================
// Integration tests
// ============================================================================

describe('$.rateLimit integration', () => {
  let $: ReturnType<typeof createMockContext>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    $ = createMockContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('complete workflow: configure, check, consume, status, reset', async () => {
    // Configure limits
    $.rateLimits.configure('api', { limit: 100, window: '1m' })
    $.rateLimits.configure('ai', { limit: 10000, window: '1h' })

    // Check initial status
    const initialStatus = await $.rateLimit('user:123').status({ name: 'api' })
    expect(initialStatus.remaining).toBe(100)

    // Make some requests
    await $.rateLimit('user:123').check({ name: 'api', cost: 30 })
    await $.rateLimit('user:123').check({ name: 'ai', cost: 2000 })

    // Check remaining
    expect(await $.rateLimit('user:123').remaining({ name: 'api' })).toBe(70)
    expect(await $.rateLimit('user:123').remaining({ name: 'ai' })).toBe(8000)

    // Consume more after-the-fact
    await $.rateLimit('user:123').consume(20, { name: 'api' })
    expect(await $.rateLimit('user:123').remaining({ name: 'api' })).toBe(50)

    // Check isAllowed
    expect(await $.rateLimit('user:123').isAllowed({ name: 'api', cost: 50 })).toBe(true)
    expect(await $.rateLimit('user:123').isAllowed({ name: 'api', cost: 51 })).toBe(false)

    // Reset API limit
    await $.rateLimit('user:123').reset({ name: 'api' })
    expect(await $.rateLimit('user:123').remaining({ name: 'api' })).toBe(100)

    // AI limit should be unchanged
    expect(await $.rateLimit('user:123').remaining({ name: 'ai' })).toBe(8000)
  })

  it('handles concurrent requests correctly', async () => {
    $.rateLimits.configure('api', { limit: 10, window: '1m' })

    // Fire 20 concurrent requests
    const promises = Array(20)
      .fill(null)
      .map(() => $.rateLimit('user:123').check({ name: 'api' }))

    const results = await Promise.all(promises)

    const successes = results.filter((r) => r.success).length
    const failures = results.filter((r) => !r.success).length

    expect(successes).toBe(10)
    expect(failures).toBe(10)
  })

  it('sliding window expires old entries', async () => {
    $.rateLimits.configure('api', { limit: 10, window: '1m' })

    // Make 5 requests
    for (let i = 0; i < 5; i++) {
      await $.rateLimit('user:123').check({ name: 'api' })
    }

    // Advance 30 seconds
    vi.advanceTimersByTime(30 * 1000)

    // Make 5 more requests
    for (let i = 0; i < 5; i++) {
      await $.rateLimit('user:123').check({ name: 'api' })
    }

    // Should be at limit now
    expect((await $.rateLimit('user:123').check({ name: 'api' })).success).toBe(false)

    // Advance 31 more seconds (first 5 requests expire)
    vi.advanceTimersByTime(31 * 1000)

    // Should have 5 slots available
    const result = await $.rateLimit('user:123').check({ name: 'api' })
    expect(result.success).toBe(true)
    expect(result.remaining).toBe(4) // 5 - 1 = 4
  })

  it('works with composite keys', async () => {
    $.rateLimits.configure('api', { limit: 10, window: '1m' })

    // Composite key: user + endpoint
    const key1 = 'user:123:endpoint:/api/users'
    const key2 = 'user:123:endpoint:/api/posts'

    // Each composite key has its own limit
    for (let i = 0; i < 10; i++) {
      await $.rateLimit(key1).check({ name: 'api' })
    }

    // key1 should be blocked
    expect((await $.rateLimit(key1).check({ name: 'api' })).success).toBe(false)

    // key2 should still have full quota
    expect((await $.rateLimit(key2).check({ name: 'api' })).remaining).toBe(9)
  })
})

// ============================================================================
// Edge cases and error handling
// ============================================================================

describe('Edge cases and error handling', () => {
  let $: ReturnType<typeof createMockContext>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    $ = createMockContext()
    $.rateLimits.configure('api', { limit: 100, window: '1m' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('handles empty key', async () => {
    // Empty key should either work or throw consistently
    const result = await $.rateLimit('').check({ name: 'api' })
    expect(result).toBeDefined()
  })

  it('handles very long key', async () => {
    const longKey = 'user:' + 'a'.repeat(10000)
    const result = await $.rateLimit(longKey).check({ name: 'api' })
    expect(result.success).toBe(true)
  })

  it('handles special characters in key', async () => {
    const specialKeys = [
      'user:test@example.com.ai',
      'ip:192.168.1.1',
      'api:/users?id=123&type=admin',
      'user:name with spaces',
    ]

    for (const key of specialKeys) {
      const result = await $.rateLimit(key).check({ name: 'api' })
      expect(result).toBeDefined()
    }
  })

  it('throws for invalid window format in config', () => {
    expect(() => $.rateLimits.configure('bad', { limit: 100, window: 'invalid' })).toThrow()
    expect(() => $.rateLimits.configure('bad', { limit: 100, window: '1x' })).toThrow()
    expect(() => $.rateLimits.configure('bad', { limit: 100, window: '' })).toThrow()
  })

  it('throws for negative limit in config', () => {
    expect(() => $.rateLimits.configure('bad', { limit: -1, window: '1m' })).toThrow()
  })

  it('handles limit of 0 (all requests blocked)', async () => {
    $.rateLimits.configure('blocked', { limit: 0, window: '1m' })

    const result = await $.rateLimit('user:123').check({ name: 'blocked' })
    expect(result.success).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('handles very high limit', async () => {
    $.rateLimits.configure('high', { limit: 1000000000, window: '1d' })

    const result = await $.rateLimit('user:123').check({ name: 'high' })
    expect(result.success).toBe(true)
    expect(result.remaining).toBe(999999999)
  })

  it('handles very high cost', async () => {
    $.rateLimits.configure('high', { limit: 1000000000, window: '1d' })

    const result = await $.rateLimit('user:123').check({ name: 'high', cost: 500000000 })
    expect(result.success).toBe(true)
    expect(result.remaining).toBe(500000000)
  })
})
