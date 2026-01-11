/**
 * Rate Limit Context Integration Tests
 *
 * These tests verify that $.rateLimit works correctly under load and in realistic
 * scenarios. Following TDD: write failing tests first, then verify they fail,
 * then implement to make them pass.
 *
 * Test scenarios:
 * 1. Rate limit enforcement across multiple requests
 * 2. Rate limit reset behavior
 * 3. Rate limit with different window sizes
 * 4. Integration with circuit breaker
 * 5. Cross-DO rate limiting scenarios
 *
 * @module tests/rate-limit/integration.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createMockContext,
  parseWindow,
  type RateLimitResult,
  type RateLimitConfig,
  type RateLimitContextInstance,
} from '../../workflows/context/rate-limit'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a context with pre-configured limits for testing
 */
function createTestContext(configs?: Record<string, RateLimitConfig>) {
  const $ = createMockContext()

  // Default test configurations
  const defaultConfigs: Record<string, RateLimitConfig> = {
    api: { limit: 100, window: '1m' },
    ai: { limit: 10000, window: '1h' },
    auth: { limit: 5, window: '15m' },
    upload: { limit: 100 * 1024, window: '1d' }, // 100 MB in KB
    burst: { limit: 10, window: '1m' },
    ...configs,
  }

  for (const [name, config] of Object.entries(defaultConfigs)) {
    $.rateLimits.configure(name, config)
  }

  return $
}

/**
 * Simulate multiple rapid requests from the same key
 */
async function simulateRapidRequests(
  rateLimit: (key: string) => RateLimitContextInstance,
  key: string,
  count: number,
  limitName: string,
  cost = 1
): Promise<RateLimitResult[]> {
  const results: RateLimitResult[] = []
  for (let i = 0; i < count; i++) {
    results.push(await rateLimit(key).check({ name: limitName, cost }))
  }
  return results
}

/**
 * Simulate concurrent requests (Promise.all pattern)
 */
async function simulateConcurrentRequests(
  rateLimit: (key: string) => RateLimitContextInstance,
  key: string,
  count: number,
  limitName: string,
  cost = 1
): Promise<RateLimitResult[]> {
  const promises = Array(count)
    .fill(null)
    .map(() => rateLimit(key).check({ name: limitName, cost }))
  return Promise.all(promises)
}

// ============================================================================
// 1. RATE LIMIT ENFORCEMENT ACROSS MULTIPLE REQUESTS
// ============================================================================

describe('Rate limit enforcement across multiple requests', () => {
  let $: ReturnType<typeof createTestContext>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'))
    $ = createTestContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('sequential request handling', () => {
    it('allows requests up to the limit', async () => {
      const results = await simulateRapidRequests($.rateLimit, 'user:123', 100, 'api')

      const successCount = results.filter((r) => r.success).length
      expect(successCount).toBe(100)
    })

    it('blocks request 101 after 100 allowed', async () => {
      await simulateRapidRequests($.rateLimit, 'user:123', 100, 'api')

      const blocked = await $.rateLimit('user:123').check({ name: 'api' })
      expect(blocked.success).toBe(false)
      expect(blocked.remaining).toBe(0)
    })

    it('remaining count decrements correctly', async () => {
      const results = await simulateRapidRequests($.rateLimit, 'user:123', 5, 'api')

      expect(results.map((r) => r.remaining)).toEqual([99, 98, 97, 96, 95])
    })

    it('tracks multiple users independently', async () => {
      // User A uses 50 requests
      await simulateRapidRequests($.rateLimit, 'user:A', 50, 'api')

      // User B should have full quota
      const userB = await $.rateLimit('user:B').check({ name: 'api' })
      expect(userB.success).toBe(true)
      expect(userB.remaining).toBe(99)

      // User A should have 50 remaining
      const userARemaining = await $.rateLimit('user:A').remaining({ name: 'api' })
      expect(userARemaining).toBe(50)
    })

    it('tracks multiple endpoints independently for same user', async () => {
      // User hits API endpoint 50 times
      await simulateRapidRequests($.rateLimit, 'user:123', 50, 'api')

      // User hits auth endpoint 3 times (limit is 5)
      await simulateRapidRequests($.rateLimit, 'user:123', 3, 'auth')

      // Check remaining for each
      expect(await $.rateLimit('user:123').remaining({ name: 'api' })).toBe(50)
      expect(await $.rateLimit('user:123').remaining({ name: 'auth' })).toBe(2)
    })
  })

  describe('concurrent request handling', () => {
    it('handles burst of concurrent requests correctly', async () => {
      // Fire 20 concurrent requests with limit of 10
      const results = await simulateConcurrentRequests($.rateLimit, 'user:burst', 20, 'burst')

      const successCount = results.filter((r) => r.success).length
      const failCount = results.filter((r) => !r.success).length

      expect(successCount).toBe(10)
      expect(failCount).toBe(10)
    })

    it('maintains atomicity under concurrent load', async () => {
      // Run 5 batches of 30 concurrent requests each
      const allResults: RateLimitResult[] = []

      for (let batch = 0; batch < 5; batch++) {
        const batchResults = await simulateConcurrentRequests(
          $.rateLimit,
          'user:atomic',
          30,
          'api'
        )
        allResults.push(...batchResults)
      }

      // Total 150 requests, limit is 100
      const successCount = allResults.filter((r) => r.success).length
      expect(successCount).toBe(100)
    })

    it('handles concurrent requests from different users', async () => {
      // Create promises for 10 users, each making 15 requests (limit is 10 for burst)
      const allPromises: Promise<RateLimitResult>[] = []

      for (let user = 0; user < 10; user++) {
        for (let req = 0; req < 15; req++) {
          allPromises.push($.rateLimit(`user:${user}`).check({ name: 'burst' }))
        }
      }

      const results = await Promise.all(allPromises)

      // Each user should have 10 successes, 5 failures
      for (let user = 0; user < 10; user++) {
        const userResults = results.slice(user * 15, (user + 1) * 15)
        const successCount = userResults.filter((r) => r.success).length
        expect(successCount).toBe(10)
      }
    })
  })

  describe('cost-based enforcement', () => {
    it('enforces cost-based limits correctly', async () => {
      // AI limit is 10000 tokens per hour
      // Make requests with varying costs
      await $.rateLimit('user:ai').check({ name: 'ai', cost: 5000 })
      await $.rateLimit('user:ai').check({ name: 'ai', cost: 3000 })

      // 2000 remaining
      const remaining = await $.rateLimit('user:ai').remaining({ name: 'ai' })
      expect(remaining).toBe(2000)

      // Request for 3000 more should fail
      const blocked = await $.rateLimit('user:ai').check({ name: 'ai', cost: 3000 })
      expect(blocked.success).toBe(false)

      // Request for 2000 should succeed
      const allowed = await $.rateLimit('user:ai').check({ name: 'ai', cost: 2000 })
      expect(allowed.success).toBe(true)
      expect(allowed.remaining).toBe(0)
    })

    it('handles mixed cost requests correctly', async () => {
      // Simulate a realistic AI usage pattern
      const requests = [
        { cost: 100 },  // Small prompt
        { cost: 500 },  // Medium prompt
        { cost: 2000 }, // Large context
        { cost: 100 },  // Small prompt
        { cost: 3000 }, // Very large context
        { cost: 500 },  // Medium prompt
        { cost: 1000 }, // Medium-large prompt
      ]

      let totalCost = 0
      for (const req of requests) {
        await $.rateLimit('user:mixed').check({ name: 'ai', cost: req.cost })
        totalCost += req.cost
      }

      const remaining = await $.rateLimit('user:mixed').remaining({ name: 'ai' })
      expect(remaining).toBe(10000 - totalCost)
    })
  })
})

// ============================================================================
// 2. RATE LIMIT RESET BEHAVIOR
// ============================================================================

describe('Rate limit reset behavior', () => {
  let $: ReturnType<typeof createTestContext>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'))
    $ = createTestContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('natural window reset', () => {
    it('resets quota after window expires', async () => {
      // Exhaust the limit
      await simulateRapidRequests($.rateLimit, 'user:123', 100, 'api')
      expect((await $.rateLimit('user:123').check({ name: 'api' })).success).toBe(false)

      // Advance past the window (1 minute + 1ms)
      vi.advanceTimersByTime(60 * 1000 + 1)

      // Should have full quota again
      const result = await $.rateLimit('user:123').check({ name: 'api' })
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(99)
    })

    it('partial window reset (sliding window behavior)', async () => {
      // Make 10 requests at t=0
      await simulateRapidRequests($.rateLimit, 'user:slide', 10, 'burst')

      // Advance 30 seconds
      vi.advanceTimersByTime(30 * 1000)

      // Should be at limit
      expect((await $.rateLimit('user:slide').check({ name: 'burst' })).success).toBe(false)

      // Advance another 31 seconds (t=61s, first requests expire)
      vi.advanceTimersByTime(31 * 1000)

      // Should have full quota again
      const result = await $.rateLimit('user:slide').check({ name: 'burst' })
      expect(result.success).toBe(true)
    })

    it('gradual window expiration', async () => {
      // Make requests at different times
      await $.rateLimit('user:gradual').check({ name: 'burst' }) // t=0
      vi.advanceTimersByTime(10 * 1000)
      await $.rateLimit('user:gradual').check({ name: 'burst' }) // t=10s
      vi.advanceTimersByTime(10 * 1000)
      await $.rateLimit('user:gradual').check({ name: 'burst' }) // t=20s
      vi.advanceTimersByTime(10 * 1000)
      await $.rateLimit('user:gradual').check({ name: 'burst' }) // t=30s

      // At t=30s, 4 requests in window
      expect(await $.rateLimit('user:gradual').remaining({ name: 'burst' })).toBe(6)

      // Advance to t=61s (first request expires)
      vi.advanceTimersByTime(31 * 1000)
      expect(await $.rateLimit('user:gradual').remaining({ name: 'burst' })).toBe(7)

      // Advance to t=71s (second request expires)
      vi.advanceTimersByTime(10 * 1000)
      expect(await $.rateLimit('user:gradual').remaining({ name: 'burst' })).toBe(8)
    })
  })

  describe('manual reset', () => {
    it('reset() restores full quota immediately', async () => {
      // Use up quota
      await simulateRapidRequests($.rateLimit, 'user:manual', 100, 'api')
      expect(await $.rateLimit('user:manual').remaining({ name: 'api' })).toBe(0)

      // Reset
      await $.rateLimit('user:manual').reset({ name: 'api' })

      // Full quota restored
      expect(await $.rateLimit('user:manual').remaining({ name: 'api' })).toBe(100)
    })

    it('reset() only affects the specified key', async () => {
      // Both users consume quota
      await simulateRapidRequests($.rateLimit, 'user:A', 50, 'api')
      await simulateRapidRequests($.rateLimit, 'user:B', 50, 'api')

      // Reset only user:A
      await $.rateLimit('user:A').reset({ name: 'api' })

      expect(await $.rateLimit('user:A').remaining({ name: 'api' })).toBe(100)
      expect(await $.rateLimit('user:B').remaining({ name: 'api' })).toBe(50)
    })

    it('reset() only affects the specified limit', async () => {
      // User consumes both API and AI quota
      await simulateRapidRequests($.rateLimit, 'user:multi', 50, 'api')
      await $.rateLimit('user:multi').check({ name: 'ai', cost: 5000 })

      // Reset only API
      await $.rateLimit('user:multi').reset({ name: 'api' })

      expect(await $.rateLimit('user:multi').remaining({ name: 'api' })).toBe(100)
      expect(await $.rateLimit('user:multi').remaining({ name: 'ai' })).toBe(5000)
    })

    it('reset() is idempotent', async () => {
      await simulateRapidRequests($.rateLimit, 'user:idempotent', 50, 'api')

      // Reset multiple times
      await $.rateLimit('user:idempotent').reset({ name: 'api' })
      await $.rateLimit('user:idempotent').reset({ name: 'api' })
      await $.rateLimit('user:idempotent').reset({ name: 'api' })

      expect(await $.rateLimit('user:idempotent').remaining({ name: 'api' })).toBe(100)
    })
  })

  describe('resetAt timestamp', () => {
    it('returns correct resetAt time', async () => {
      const result = await $.rateLimit('user:reset').check({ name: 'api' })

      const now = Date.now()
      const windowMs = parseWindow('1m')

      expect(result.resetAt).toBeDefined()
      expect(result.resetAt).toBeGreaterThanOrEqual(now)
      expect(result.resetAt).toBeLessThanOrEqual(now + windowMs)
    })

    it('resetAt reflects when current request expires for successful checks', async () => {
      const start = Date.now()

      await $.rateLimit('user:oldest').check({ name: 'api' })
      vi.advanceTimersByTime(10 * 1000)
      await $.rateLimit('user:oldest').check({ name: 'api' })
      vi.advanceTimersByTime(10 * 1000)
      const lastResult = await $.rateLimit('user:oldest').check({ name: 'api' })

      // For successful requests, resetAt = now + windowMs
      // (when the current request will expire)
      const windowMs = parseWindow('1m')
      const now = Date.now() // This is start + 20s
      expect(lastResult.resetAt).toBe(now + windowMs)
    })
  })
})

// ============================================================================
// 3. RATE LIMIT WITH DIFFERENT WINDOW SIZES
// ============================================================================

describe('Rate limit with different window sizes', () => {
  let $: ReturnType<typeof createTestContext>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'))
    $ = createTestContext({
      minute: { limit: 10, window: '1m' },
      fiveMin: { limit: 50, window: '5m' },
      hour: { limit: 100, window: '1h' },
      day: { limit: 1000, window: '1d' },
      fifteenMin: { limit: 5, window: '15m' },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('minute-based windows', () => {
    it('1 minute window enforces correctly', async () => {
      await simulateRapidRequests($.rateLimit, 'user:1m', 10, 'minute')
      expect((await $.rateLimit('user:1m').check({ name: 'minute' })).success).toBe(false)

      vi.advanceTimersByTime(61 * 1000)
      expect((await $.rateLimit('user:1m').check({ name: 'minute' })).success).toBe(true)
    })

    it('5 minute window enforces correctly', async () => {
      await simulateRapidRequests($.rateLimit, 'user:5m', 50, 'fiveMin')
      expect((await $.rateLimit('user:5m').check({ name: 'fiveMin' })).success).toBe(false)

      // 4 minutes - still blocked
      vi.advanceTimersByTime(4 * 60 * 1000)
      expect((await $.rateLimit('user:5m').check({ name: 'fiveMin' })).success).toBe(false)

      // 1 more minute + 1ms - allowed
      vi.advanceTimersByTime(60 * 1000 + 1)
      expect((await $.rateLimit('user:5m').check({ name: 'fiveMin' })).success).toBe(true)
    })

    it('15 minute window enforces correctly', async () => {
      await simulateRapidRequests($.rateLimit, 'user:15m', 5, 'fifteenMin')
      expect((await $.rateLimit('user:15m').check({ name: 'fifteenMin' })).success).toBe(false)

      // 10 minutes - still blocked
      vi.advanceTimersByTime(10 * 60 * 1000)
      expect((await $.rateLimit('user:15m').check({ name: 'fifteenMin' })).success).toBe(false)

      // 5 more minutes + 1ms - allowed
      vi.advanceTimersByTime(5 * 60 * 1000 + 1)
      expect((await $.rateLimit('user:15m').check({ name: 'fifteenMin' })).success).toBe(true)
    })
  })

  describe('hour-based windows', () => {
    it('1 hour window enforces correctly', async () => {
      await simulateRapidRequests($.rateLimit, 'user:1h', 100, 'hour')
      expect((await $.rateLimit('user:1h').check({ name: 'hour' })).success).toBe(false)

      // 30 minutes - still blocked
      vi.advanceTimersByTime(30 * 60 * 1000)
      expect((await $.rateLimit('user:1h').check({ name: 'hour' })).success).toBe(false)

      // 30 more minutes + 1ms - allowed
      vi.advanceTimersByTime(30 * 60 * 1000 + 1)
      expect((await $.rateLimit('user:1h').check({ name: 'hour' })).success).toBe(true)
    })
  })

  describe('day-based windows', () => {
    it('1 day window enforces correctly', async () => {
      await simulateRapidRequests($.rateLimit, 'user:1d', 1000, 'day')
      expect((await $.rateLimit('user:1d').check({ name: 'day' })).success).toBe(false)

      // 12 hours - still blocked
      vi.advanceTimersByTime(12 * 60 * 60 * 1000)
      expect((await $.rateLimit('user:1d').check({ name: 'day' })).success).toBe(false)

      // 12 more hours + 1ms - allowed
      vi.advanceTimersByTime(12 * 60 * 60 * 1000 + 1)
      expect((await $.rateLimit('user:1d').check({ name: 'day' })).success).toBe(true)
    })
  })

  describe('multiple windows for same key', () => {
    it('same user can be rate limited differently on different limits', async () => {
      // Different named limits have independent tracking even for same user key
      // This is by design - 'minute' and 'hour' are separate limits

      // Exhaust minute limit
      await simulateRapidRequests($.rateLimit, 'user:multi-window', 10, 'minute')
      expect((await $.rateLimit('user:multi-window').check({ name: 'minute' })).success).toBe(false)

      // Hour limit is tracked separately and should still have full quota
      expect(await $.rateLimit('user:multi-window').remaining({ name: 'hour' })).toBe(100)

      // After minute window resets, can make more minute requests
      vi.advanceTimersByTime(61 * 1000)
      await simulateRapidRequests($.rateLimit, 'user:multi-window', 10, 'minute')

      // Hour limit remains at full quota because it's tracked independently
      // (this is the correct behavior - different limits are independent)
      expect(await $.rateLimit('user:multi-window').remaining({ name: 'hour' })).toBe(100)
    })

    it('same limit name with different keys tracks independently', async () => {
      // User A uses minute limit
      await simulateRapidRequests($.rateLimit, 'user:A', 5, 'minute')
      // User B uses minute limit
      await simulateRapidRequests($.rateLimit, 'user:B', 3, 'minute')

      // Each user has their own quota
      expect(await $.rateLimit('user:A').remaining({ name: 'minute' })).toBe(5)
      expect(await $.rateLimit('user:B').remaining({ name: 'minute' })).toBe(7)
    })
  })
})

// ============================================================================
// 4. INTEGRATION WITH CIRCUIT BREAKER
// ============================================================================

describe('Integration with circuit breaker patterns', () => {
  let $: ReturnType<typeof createTestContext>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'))
    $ = createTestContext({
      strict: { limit: 3, window: '1m' },
      retry: { limit: 5, window: '1m' },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('rate limiting as circuit breaker trigger', () => {
    it('can track failed attempts for circuit breaker decision', async () => {
      // Simulate tracking failed auth attempts
      const trackAttempt = async (key: string) => {
        return await $.rateLimit(key).check({ name: 'strict' })
      }

      // 3 failed attempts should exhaust limit
      const attempt1 = await trackAttempt('ip:192.168.1.1')
      expect(attempt1.success).toBe(true)
      expect(attempt1.remaining).toBe(2)

      const attempt2 = await trackAttempt('ip:192.168.1.1')
      expect(attempt2.success).toBe(true)
      expect(attempt2.remaining).toBe(1)

      const attempt3 = await trackAttempt('ip:192.168.1.1')
      expect(attempt3.success).toBe(true)
      expect(attempt3.remaining).toBe(0)

      // 4th attempt should be blocked (circuit "open")
      const attempt4 = await trackAttempt('ip:192.168.1.1')
      expect(attempt4.success).toBe(false)
    })

    it('status can be used for circuit breaker state check', async () => {
      // Exhaust limit
      await simulateRapidRequests($.rateLimit, 'service:external', 3, 'strict')

      // Check status (like checking circuit breaker state)
      const status = await $.rateLimit('service:external').status({ name: 'strict' })
      expect(status.success).toBe(false) // "circuit open"
      expect(status.remaining).toBe(0)

      // Wait for reset (like circuit breaker reset timeout)
      vi.advanceTimersByTime(61 * 1000)

      const statusAfter = await $.rateLimit('service:external').status({ name: 'strict' })
      expect(statusAfter.success).toBe(true) // "circuit closed"
    })
  })

  describe('retry budget patterns', () => {
    it('tracks retry attempts with cost', async () => {
      // Each retry costs 2 (initial attempt costs 1)
      await $.rateLimit('job:123').check({ name: 'retry', cost: 1 }) // Initial
      expect(await $.rateLimit('job:123').remaining({ name: 'retry' })).toBe(4)

      await $.rateLimit('job:123').check({ name: 'retry', cost: 2 }) // Retry 1
      expect(await $.rateLimit('job:123').remaining({ name: 'retry' })).toBe(2)

      await $.rateLimit('job:123').check({ name: 'retry', cost: 2 }) // Retry 2
      expect(await $.rateLimit('job:123').remaining({ name: 'retry' })).toBe(0)

      // No more retries allowed
      const noRetry = await $.rateLimit('job:123').check({ name: 'retry', cost: 2 })
      expect(noRetry.success).toBe(false)
    })

    it('isAllowed for pre-check without consuming budget', async () => {
      await $.rateLimit('job:456').check({ name: 'retry', cost: 4 })

      // Check if retry is allowed without consuming
      expect(await $.rateLimit('job:456').isAllowed({ name: 'retry', cost: 2 })).toBe(false)
      expect(await $.rateLimit('job:456').isAllowed({ name: 'retry', cost: 1 })).toBe(true)

      // Budget should still be 1
      expect(await $.rateLimit('job:456').remaining({ name: 'retry' })).toBe(1)
    })
  })

  describe('half-open state simulation', () => {
    it('simulates half-open by allowing limited requests after reset', async () => {
      // "Open" the circuit
      await simulateRapidRequests($.rateLimit, 'service:db', 3, 'strict')
      expect((await $.rateLimit('service:db').check({ name: 'strict' })).success).toBe(false)

      // Wait for "half-open" timeout
      vi.advanceTimersByTime(61 * 1000)

      // In half-open, allow limited probe requests
      const probe = await $.rateLimit('service:db').check({ name: 'strict' })
      expect(probe.success).toBe(true)

      // Simulate success - could reset the limit entirely
      // (In real circuit breaker, this would close the circuit)
    })
  })
})

// ============================================================================
// 5. CROSS-DO RATE LIMITING SCENARIOS
// ============================================================================

describe('Cross-DO rate limiting scenarios', () => {
  let $: ReturnType<typeof createTestContext>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'))
    $ = createTestContext({
      global: { limit: 1000, window: '1m' },
      perDO: { limit: 100, window: '1m' },
      tenant: { limit: 500, window: '1h' },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('per-tenant rate limiting', () => {
    it('each tenant has independent limits', async () => {
      // Tenant A uses their quota
      await simulateRapidRequests($.rateLimit, 'tenant:A', 200, 'tenant')

      // Tenant B has full quota
      expect(await $.rateLimit('tenant:B').remaining({ name: 'tenant' })).toBe(500)

      // Tenant A has 300 remaining
      expect(await $.rateLimit('tenant:A').remaining({ name: 'tenant' })).toBe(300)
    })

    it('global limit applies across all tenants', async () => {
      // Multiple tenants hit the global limit
      await simulateRapidRequests($.rateLimit, 'global:all', 500, 'global')
      await simulateRapidRequests($.rateLimit, 'global:all', 500, 'global')

      // Global limit reached
      expect((await $.rateLimit('global:all').check({ name: 'global' })).success).toBe(false)
    })
  })

  describe('hierarchical rate limiting', () => {
    it('composite key for hierarchical limits (tenant:user)', async () => {
      // Tenant A, User 1
      await simulateRapidRequests($.rateLimit, 'tenant:A:user:1', 50, 'perDO')

      // Tenant A, User 2 - independent quota
      expect(await $.rateLimit('tenant:A:user:2').remaining({ name: 'perDO' })).toBe(100)

      // Tenant A, User 1 - has 50 remaining
      expect(await $.rateLimit('tenant:A:user:1').remaining({ name: 'perDO' })).toBe(50)
    })

    it('can enforce both tenant and user limits', async () => {
      // Configure tenant-level limit with higher value
      $.rateLimits.configure('tenantLevel', { limit: 200, window: '1m' })
      $.rateLimits.configure('userLevel', { limit: 50, window: '1m' })

      // User hits their personal limit
      await simulateRapidRequests($.rateLimit, 'tenant:A:user:1', 50, 'userLevel')
      expect((await $.rateLimit('tenant:A:user:1').check({ name: 'userLevel' })).success).toBe(false)

      // But tenant still has quota
      expect(await $.rateLimit('tenant:A').remaining({ name: 'tenantLevel' })).toBe(200)
    })
  })

  describe('distributed rate limiting patterns', () => {
    it('tracks requests across multiple DO instances (simulated)', async () => {
      // Simulate requests from different DO instances using the same key prefix
      const doInstances = ['do:1', 'do:2', 'do:3']

      for (const doInstance of doInstances) {
        await simulateRapidRequests($.rateLimit, `global:${doInstance}`, 100, 'global')
      }

      // Total is 300 requests against 1000 limit
      // Each DO instance key is independent, so each has 100 used
      expect(await $.rateLimit('global:do:1').remaining({ name: 'global' })).toBe(900)
    })

    it('shared key for cross-DO coordination', async () => {
      // All DO instances use the same key for global coordination
      await simulateRapidRequests($.rateLimit, 'shared:api-gateway', 500, 'global')
      await simulateRapidRequests($.rateLimit, 'shared:api-gateway', 500, 'global')

      // Global limit reached across all DOs
      expect((await $.rateLimit('shared:api-gateway').check({ name: 'global' })).success).toBe(false)
    })
  })
})

// ============================================================================
// 6. LOAD TESTING SCENARIOS
// ============================================================================

describe('Load testing scenarios', () => {
  let $: ReturnType<typeof createTestContext>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'))
    $ = createTestContext({
      highVolume: { limit: 10000, window: '1m' },
      lowLatency: { limit: 100, window: '1m' },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('high volume scenarios', () => {
    it('handles 10000 requests correctly', async () => {
      const results = await simulateRapidRequests($.rateLimit, 'user:high-volume', 10000, 'highVolume')

      const successCount = results.filter((r) => r.success).length
      expect(successCount).toBe(10000)

      // 10001st should fail
      const blocked = await $.rateLimit('user:high-volume').check({ name: 'highVolume' })
      expect(blocked.success).toBe(false)
    })

    it('handles 1000 concurrent requests', async () => {
      const results = await simulateConcurrentRequests($.rateLimit, 'user:concurrent', 1000, 'highVolume')

      const successCount = results.filter((r) => r.success).length
      expect(successCount).toBe(1000)
    })

    it('handles rapid sequential-then-concurrent pattern', async () => {
      // First burst: 5000 sequential
      await simulateRapidRequests($.rateLimit, 'user:mixed-load', 5000, 'highVolume')

      // Second burst: 5000 concurrent
      const results = await simulateConcurrentRequests($.rateLimit, 'user:mixed-load', 5000, 'highVolume')
      const successCount = results.filter((r) => r.success).length
      expect(successCount).toBe(5000)

      // Should be at limit
      expect(await $.rateLimit('user:mixed-load').remaining({ name: 'highVolume' })).toBe(0)
    })
  })

  describe('stress test patterns', () => {
    it('handles many different keys', async () => {
      const keyCount = 100
      const requestsPerKey = 50

      const allPromises: Promise<RateLimitResult>[] = []

      for (let key = 0; key < keyCount; key++) {
        for (let req = 0; req < requestsPerKey; req++) {
          allPromises.push($.rateLimit(`key:${key}`).check({ name: 'lowLatency' }))
        }
      }

      const results = await Promise.all(allPromises)

      // Each key should have 50 successes (all within limit of 100)
      const successCount = results.filter((r) => r.success).length
      expect(successCount).toBe(keyCount * requestsPerKey)
    })

    it('handles interleaved requests across multiple limits', async () => {
      const limits = ['api', 'ai', 'auth', 'burst']
      const requests: Promise<RateLimitResult>[] = []

      for (let i = 0; i < 200; i++) {
        const limit = limits[i % limits.length]
        requests.push($.rateLimit(`user:interleaved`).check({ name: limit }))
      }

      const results = await Promise.all(requests)

      // Each limit should have 50 requests (200 / 4)
      // api: 100 limit, 50 requests = all success
      // ai: 10000 limit, 50 requests = all success
      // auth: 5 limit, 50 requests = 5 success
      // burst: 10 limit, 50 requests = 10 success
      const successCount = results.filter((r) => r.success).length
      expect(successCount).toBe(50 + 50 + 5 + 10) // 115
    })
  })
})

// ============================================================================
// 7. EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Edge cases and error handling', () => {
  let $: ReturnType<typeof createTestContext>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'))
    $ = createTestContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('boundary conditions', () => {
    it('handles exact limit boundary correctly', async () => {
      $.rateLimits.configure('exact', { limit: 5, window: '1m' })

      const results: RateLimitResult[] = []
      for (let i = 0; i < 6; i++) {
        results.push(await $.rateLimit('user:exact').check({ name: 'exact' }))
      }

      expect(results[4].success).toBe(true) // 5th request
      expect(results[4].remaining).toBe(0)
      expect(results[5].success).toBe(false) // 6th request
    })

    it('handles limit of 1', async () => {
      $.rateLimits.configure('single', { limit: 1, window: '1m' })

      const first = await $.rateLimit('user:single').check({ name: 'single' })
      expect(first.success).toBe(true)
      expect(first.remaining).toBe(0)

      const second = await $.rateLimit('user:single').check({ name: 'single' })
      expect(second.success).toBe(false)
    })

    it('handles limit of 0 (all blocked)', async () => {
      $.rateLimits.configure('blocked', { limit: 0, window: '1m' })

      const result = await $.rateLimit('user:blocked').check({ name: 'blocked' })
      expect(result.success).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('handles very large limit', async () => {
      $.rateLimits.configure('huge', { limit: Number.MAX_SAFE_INTEGER, window: '1m' })

      const result = await $.rateLimit('user:huge').check({ name: 'huge' })
      expect(result.success).toBe(true)
      expect(result.remaining).toBe(Number.MAX_SAFE_INTEGER - 1)
    })
  })

  describe('invalid inputs', () => {
    it('throws for unconfigured limit name', async () => {
      await expect($.rateLimit('user:123').check({ name: 'nonexistent' })).rejects.toThrow()
    })

    it('throws for negative cost', async () => {
      await expect($.rateLimit('user:123').check({ name: 'api', cost: -1 })).rejects.toThrow()
    })

    it('throws for invalid window format in config', () => {
      expect(() => $.rateLimits.configure('bad', { limit: 100, window: 'invalid' })).toThrow()
      expect(() => $.rateLimits.configure('bad', { limit: 100, window: '1x' })).toThrow()
      expect(() => $.rateLimits.configure('bad', { limit: 100, window: '' })).toThrow()
    })

    it('throws for negative limit in config', () => {
      expect(() => $.rateLimits.configure('bad', { limit: -1, window: '1m' })).toThrow()
    })
  })

  describe('special key handling', () => {
    it('handles empty key', async () => {
      const result = await $.rateLimit('').check({ name: 'api' })
      expect(result).toBeDefined()
      expect(typeof result.success).toBe('boolean')
    })

    it('handles key with special characters', async () => {
      const specialKeys = [
        'user:test@example.com.ai',
        'ip:192.168.1.1:8080',
        'path:/api/v1/users?id=123',
        'unicode:\u00e9\u00e8\u00ea',
        'spaces:key with spaces',
        'newline:key\nwith\nnewlines',
      ]

      for (const key of specialKeys) {
        const result = await $.rateLimit(key).check({ name: 'api' })
        expect(result.success).toBe(true)
      }
    })

    it('handles very long key', async () => {
      const longKey = 'user:' + 'a'.repeat(10000)
      const result = await $.rateLimit(longKey).check({ name: 'api' })
      expect(result.success).toBe(true)
    })
  })
})
