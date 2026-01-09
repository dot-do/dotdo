/**
 * Cloudflare Rate Limit Binding Wrapper Tests
 *
 * RED TDD: These tests exercise the rate limit binding wrapper.
 * All tests should FAIL initially as this is the RED phase.
 *
 * The CF Rate Limit binding has this interface:
 * ```typescript
 * interface RateLimitBinding {
 *   limit(options: { key: string }): Promise<{ success: boolean; remaining: number }>
 * }
 * ```
 *
 * Configured in wrangler.toml:
 * ```toml
 * [[unsafe.bindings]]
 * name = "RATE_LIMIT_API"
 * type = "ratelimit"
 * simple = { limit: 1000, period: 3600 }
 * ```
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { RateLimitWrapper } from '../../lib/rate-limit'
import { rateLimitMiddleware } from '../../api/middleware/rate-limit'

// ============================================================================
// TYPES
// ============================================================================

/**
 * The interface for Cloudflare's Rate Limit binding
 */
interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean; remaining: number }>
}

/**
 * Configuration for the mock rate limit binding
 */
interface RateLimitConfig {
  /** Maximum number of requests allowed per period */
  limit: number
  /** Period in seconds */
  period: number
}

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Creates a mock Cloudflare Rate Limit binding for testing.
 *
 * Simulates the behavior of CF's rate limit binding:
 * - Tracks request counts per key
 * - Returns success: true when under limit
 * - Returns success: false when over limit
 * - Resets counts after period expires
 * - Returns remaining count
 */
function createMockRateLimitBinding(config: RateLimitConfig): RateLimitBinding {
  const counts = new Map<string, { count: number; resetAt: number }>()

  return {
    async limit(options: { key: string }): Promise<{ success: boolean; remaining: number }> {
      const now = Date.now()
      const key = options.key
      let entry = counts.get(key)

      // Reset if period has expired
      if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + config.period * 1000 }
        counts.set(key, entry)
      }

      // Increment count
      entry.count++

      // Check if over limit
      const success = entry.count <= config.limit
      const remaining = Math.max(0, config.limit - entry.count)

      return { success, remaining }
    },
  }
}

// ============================================================================
// THE RATE LIMIT WRAPPER (NOT YET IMPLEMENTED)
// ============================================================================

/**
 * This wrapper class does not exist yet - tests should FAIL.
 *
 * The wrapper should provide:
 * - checkLimit(key: string): Promise<RateLimitResult>
 * - isAllowed(key: string): Promise<boolean>
 * - getRemainingCount(key: string): Promise<number>
 */

// Import the wrapper that doesn't exist yet (this will fail)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - RateLimitWrapper does not exist yet (RED phase)
// import { RateLimitWrapper } from '../../lib/rate-limit'

// ============================================================================
// TESTS: MOCK BINDING BEHAVIOR (SHOULD PASS)
// ============================================================================

describe('Mock Rate Limit Binding', () => {
  let binding: RateLimitBinding

  beforeEach(() => {
    vi.useFakeTimers()
    binding = createMockRateLimitBinding({ limit: 3, period: 60 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('returns success when under limit', () => {
    it('first request returns success: true', async () => {
      const result = await binding.limit({ key: 'user:123' })

      expect(result.success).toBe(true)
    })

    it('first request returns correct remaining count', async () => {
      const result = await binding.limit({ key: 'user:123' })

      expect(result.remaining).toBe(2) // 3 limit - 1 used = 2 remaining
    })

    it('second request still under limit returns success: true', async () => {
      await binding.limit({ key: 'user:123' }) // 1st
      const result = await binding.limit({ key: 'user:123' }) // 2nd

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(1) // 3 limit - 2 used = 1 remaining
    })

    it('third request at limit returns success: true', async () => {
      await binding.limit({ key: 'user:123' }) // 1st
      await binding.limit({ key: 'user:123' }) // 2nd
      const result = await binding.limit({ key: 'user:123' }) // 3rd

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(0) // 3 limit - 3 used = 0 remaining
    })
  })

  describe('returns failure when over limit', () => {
    it('fourth request over limit returns success: false', async () => {
      await binding.limit({ key: 'user:123' }) // 1st
      await binding.limit({ key: 'user:123' }) // 2nd
      await binding.limit({ key: 'user:123' }) // 3rd
      const result = await binding.limit({ key: 'user:123' }) // 4th - over limit

      expect(result.success).toBe(false)
    })

    it('over limit returns remaining: 0', async () => {
      await binding.limit({ key: 'user:123' }) // 1st
      await binding.limit({ key: 'user:123' }) // 2nd
      await binding.limit({ key: 'user:123' }) // 3rd
      const result = await binding.limit({ key: 'user:123' }) // 4th - over limit

      expect(result.remaining).toBe(0)
    })

    it('subsequent requests after limit also return success: false', async () => {
      // Exhaust the limit
      for (let i = 0; i < 3; i++) {
        await binding.limit({ key: 'user:123' })
      }

      // 4th, 5th, 6th should all fail
      for (let i = 0; i < 3; i++) {
        const result = await binding.limit({ key: 'user:123' })
        expect(result.success).toBe(false)
        expect(result.remaining).toBe(0)
      }
    })
  })

  describe('resets after period expires', () => {
    it('request after period resets returns success: true', async () => {
      // Exhaust the limit
      for (let i = 0; i < 4; i++) {
        await binding.limit({ key: 'user:123' })
      }

      // Advance time past the period (60 seconds)
      vi.advanceTimersByTime(61 * 1000)

      // Should now succeed
      const result = await binding.limit({ key: 'user:123' })
      expect(result.success).toBe(true)
    })

    it('request after period resets returns full remaining count', async () => {
      // Exhaust the limit
      for (let i = 0; i < 4; i++) {
        await binding.limit({ key: 'user:123' })
      }

      // Advance time past the period (60 seconds)
      vi.advanceTimersByTime(61 * 1000)

      // Should now have remaining = limit - 1
      const result = await binding.limit({ key: 'user:123' })
      expect(result.remaining).toBe(2) // 3 - 1 = 2
    })

    it('reset applies per key independently', async () => {
      // Exhaust limit for user:123
      for (let i = 0; i < 4; i++) {
        await binding.limit({ key: 'user:123' })
      }

      // Advance time by 30 seconds (half the period)
      vi.advanceTimersByTime(30 * 1000)

      // Use limit for user:456
      await binding.limit({ key: 'user:456' })
      await binding.limit({ key: 'user:456' })

      // Advance time by another 35 seconds (total 65s for user:123, 35s for user:456)
      vi.advanceTimersByTime(35 * 1000)

      // user:123 should be reset
      const result123 = await binding.limit({ key: 'user:123' })
      expect(result123.success).toBe(true)
      expect(result123.remaining).toBe(2)

      // user:456 should still have remaining from their period
      const result456 = await binding.limit({ key: 'user:456' })
      expect(result456.success).toBe(true)
      expect(result456.remaining).toBe(0) // They used 2 before, now 3rd = 0 remaining
    })
  })

  describe('tracks limits per key independently', () => {
    it('different keys have separate counters', async () => {
      const result1 = await binding.limit({ key: 'user:123' })
      const result2 = await binding.limit({ key: 'user:456' })

      expect(result1.remaining).toBe(2)
      expect(result2.remaining).toBe(2)
    })

    it('exhausting one key does not affect another', async () => {
      // Exhaust user:123
      for (let i = 0; i < 4; i++) {
        await binding.limit({ key: 'user:123' })
      }

      // user:456 should still have full limit
      const result = await binding.limit({ key: 'user:456' })
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(2)
    })

    it('handles API endpoint keys independently from user keys', async () => {
      await binding.limit({ key: 'api:/users/create' })
      await binding.limit({ key: 'api:/users/create' })
      await binding.limit({ key: 'user:123' })

      const apiResult = await binding.limit({ key: 'api:/users/create' })
      const userResult = await binding.limit({ key: 'user:123' })

      expect(apiResult.remaining).toBe(0) // 3 - 3 = 0
      expect(userResult.remaining).toBe(1) // 3 - 2 = 1
    })

    it('handles composite keys (user + endpoint)', async () => {
      const key1 = 'user:123:api:/users/create'
      const key2 = 'user:123:api:/users/delete'
      const key3 = 'user:456:api:/users/create'

      await binding.limit({ key: key1 })
      await binding.limit({ key: key1 })
      await binding.limit({ key: key2 })
      await binding.limit({ key: key3 })

      const result1 = await binding.limit({ key: key1 })
      const result2 = await binding.limit({ key: key2 })
      const result3 = await binding.limit({ key: key3 })

      expect(result1.success).toBe(true)
      expect(result1.remaining).toBe(0) // 3 - 3 = 0

      expect(result2.remaining).toBe(1) // 3 - 2 = 1

      expect(result3.remaining).toBe(1) // 3 - 2 = 1
    })
  })

  describe('returns remaining count', () => {
    it('returns correct remaining after each request', async () => {
      const binding3 = createMockRateLimitBinding({ limit: 5, period: 60 })

      expect((await binding3.limit({ key: 'test' })).remaining).toBe(4)
      expect((await binding3.limit({ key: 'test' })).remaining).toBe(3)
      expect((await binding3.limit({ key: 'test' })).remaining).toBe(2)
      expect((await binding3.limit({ key: 'test' })).remaining).toBe(1)
      expect((await binding3.limit({ key: 'test' })).remaining).toBe(0)
      expect((await binding3.limit({ key: 'test' })).remaining).toBe(0)
    })

    it('remaining never goes negative', async () => {
      // Exhaust limit and then make more requests
      for (let i = 0; i < 10; i++) {
        const result = await binding.limit({ key: 'test' })
        expect(result.remaining).toBeGreaterThanOrEqual(0)
      }
    })
  })
})

// ============================================================================
// TESTS: RATE LIMIT WRAPPER (SHOULD FAIL - RED PHASE)
// ============================================================================

describe('RateLimitWrapper', () => {
  describe('wrapper import', () => {
    it('should import RateLimitWrapper from lib/rate-limit', async () => {
      // GREEN phase: module now exists and exports RateLimitWrapper
      const module = await import('../../lib/rate-limit')
      expect(module.RateLimitWrapper).toBeDefined()
    })
  })

  describe('wrapper instantiation', () => {
    it('should create a wrapper with a binding', () => {
      const wrapper = new RateLimitWrapper(createMockRateLimitBinding({ limit: 100, period: 3600 }))
      expect(wrapper).toBeDefined()
    })
  })

  describe('checkLimit method', () => {
    it('should return success: true when under limit', async () => {
      const wrapper = new RateLimitWrapper(createMockRateLimitBinding({ limit: 100, period: 3600 }))
      const result = await wrapper.checkLimit('user:123')
      expect(result.success).toBe(true)
    })

    it('should return remaining count', async () => {
      const wrapper = new RateLimitWrapper(createMockRateLimitBinding({ limit: 100, period: 3600 }))
      const result = await wrapper.checkLimit('user:123')
      expect(result.remaining).toBe(99)
    })

    it('should return success: false when over limit', async () => {
      const wrapper = new RateLimitWrapper(createMockRateLimitBinding({ limit: 1, period: 3600 }))
      await wrapper.checkLimit('user:123')
      const result = await wrapper.checkLimit('user:123')
      expect(result.success).toBe(false)
    })
  })

  describe('isAllowed method', () => {
    it('should return true when under limit', async () => {
      const wrapper = new RateLimitWrapper(createMockRateLimitBinding({ limit: 100, period: 3600 }))
      const allowed = await wrapper.isAllowed('user:123')
      expect(allowed).toBe(true)
    })

    it('should return false when over limit', async () => {
      const wrapper = new RateLimitWrapper(createMockRateLimitBinding({ limit: 1, period: 3600 }))
      await wrapper.isAllowed('user:123')
      const allowed = await wrapper.isAllowed('user:123')
      expect(allowed).toBe(false)
    })
  })

  describe('getRemainingCount method', () => {
    it('should return remaining count for a key', async () => {
      const wrapper = new RateLimitWrapper(createMockRateLimitBinding({ limit: 100, period: 3600 }))
      await wrapper.checkLimit('user:123')
      const remaining = await wrapper.getRemainingCount('user:123')
      expect(remaining).toBe(99)
    })

    it('should return 0 when over limit', async () => {
      const wrapper = new RateLimitWrapper(createMockRateLimitBinding({ limit: 1, period: 3600 }))
      await wrapper.checkLimit('user:123')
      await wrapper.checkLimit('user:123')
      const remaining = await wrapper.getRemainingCount('user:123')
      expect(remaining).toBe(0)
    })
  })

  describe('key generation', () => {
    it('should support user-based keys', async () => {
      const wrapper = new RateLimitWrapper(createMockRateLimitBinding({ limit: 100, period: 3600 }))
      const result = await wrapper.checkLimit(wrapper.buildKey({ userId: '123' }))
      expect(result.success).toBe(true)
    })

    it('should support endpoint-based keys', async () => {
      const wrapper = new RateLimitWrapper(createMockRateLimitBinding({ limit: 100, period: 3600 }))
      const result = await wrapper.checkLimit(wrapper.buildKey({ endpoint: '/api/users' }))
      expect(result.success).toBe(true)
    })

    it('should support composite keys', async () => {
      const wrapper = new RateLimitWrapper(createMockRateLimitBinding({ limit: 100, period: 3600 }))
      const result = await wrapper.checkLimit(
        wrapper.buildKey({ userId: '123', endpoint: '/api/users', action: 'create' })
      )
      expect(result.success).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle empty key', async () => {
      const wrapper = new RateLimitWrapper(createMockRateLimitBinding({ limit: 100, period: 3600 }))
      // Should throw or handle gracefully
      await expect(wrapper.checkLimit('')).rejects.toThrow()
    })

    it('should handle very long keys', async () => {
      const wrapper = new RateLimitWrapper(createMockRateLimitBinding({ limit: 100, period: 3600 }))
      const longKey = 'a'.repeat(1000)
      const result = await wrapper.checkLimit(longKey)
      expect(result).toBeDefined()
    })

    it('should handle special characters in keys', async () => {
      const wrapper = new RateLimitWrapper(createMockRateLimitBinding({ limit: 100, period: 3600 }))
      const result = await wrapper.checkLimit('user:123:endpoint:/api/users?id=456&type=admin')
      expect(result).toBeDefined()
    })

    it('should handle concurrent requests', async () => {
      const wrapper = new RateLimitWrapper(createMockRateLimitBinding({ limit: 5, period: 3600 }))

      // Make 10 concurrent requests
      const promises = Array(10)
        .fill(null)
        .map(() => wrapper.checkLimit('concurrent-test'))

      const results = await Promise.all(promises)

      // First 5 should succeed, rest should fail
      const successCount = results.filter((r) => r.success).length
      const failCount = results.filter((r) => !r.success).length

      expect(successCount).toBe(5)
      expect(failCount).toBe(5)
    })
  })
})

// ============================================================================
// TESTS: INTEGRATION WITH HONO MIDDLEWARE (SHOULD FAIL - RED PHASE)
// ============================================================================

describe('Rate Limit Hono Middleware', () => {
  it('should import rateLimitMiddleware from middleware/rate-limit', async () => {
    // GREEN phase: middleware now exists
    const module = await import('../../api/middleware/rate-limit')
    expect(module.rateLimitMiddleware).toBeDefined()
  })

  it('should create middleware with config', () => {
    const middleware = rateLimitMiddleware({
      binding: createMockRateLimitBinding({ limit: 100, period: 3600 }),
      keyGenerator: (c) => c.req.header('X-User-ID') || 'anonymous',
    })
    expect(middleware).toBeDefined()
  })

  it('should allow requests under limit', async () => {
    const middleware = rateLimitMiddleware({
      binding: createMockRateLimitBinding({ limit: 100, period: 3600 }),
    })

    // Mock Hono context
    const mockNext = vi.fn()
    const mockC = {
      req: { header: () => 'user:123' },
      set: vi.fn(),
      header: vi.fn(),
    }

    // @ts-expect-error - mock context
    await middleware(mockC, mockNext)

    expect(mockNext).toHaveBeenCalled()
  })

  it('should block requests over limit', async () => {
    const middleware = rateLimitMiddleware({
      binding: createMockRateLimitBinding({ limit: 1, period: 3600 }),
    })

    const mockNext = vi.fn()
    const mockC = {
      req: { header: () => 'user:123' },
      set: vi.fn(),
      header: vi.fn(),
      json: vi.fn().mockReturnValue(new Response()),
    }

    // First request should pass
    // @ts-expect-error - mock context
    await middleware(mockC, mockNext)
    expect(mockNext).toHaveBeenCalledTimes(1)

    // Second request should be blocked
    mockNext.mockClear()
    // @ts-expect-error - mock context
    await middleware(mockC, mockNext)
    expect(mockNext).not.toHaveBeenCalled()
    expect(mockC.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('rate limit') }),
      429
    )
  })

  it('should set rate limit headers', async () => {
    const middleware = rateLimitMiddleware({
      binding: createMockRateLimitBinding({ limit: 100, period: 3600 }),
    })

    const mockC = {
      req: { header: () => 'user:123' },
      set: vi.fn(),
      header: vi.fn(),
    }

    // @ts-expect-error - mock context
    await middleware(mockC, vi.fn())

    expect(mockC.header).toHaveBeenCalledWith('X-RateLimit-Limit', '100')
    expect(mockC.header).toHaveBeenCalledWith('X-RateLimit-Remaining', '99')
  })
})
