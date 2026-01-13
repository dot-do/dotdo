/**
 * RateLimiter Tests
 *
 * TDD test suite for rate limiting to respect destination API limits.
 *
 * The RateLimiter implements a token bucket algorithm to control the rate
 * of requests to external APIs, preventing rate limit violations.
 *
 * Test Coverage:
 * - [x] RateLimiter enforces requests per second limit
 * - [x] RateLimiter allows burst up to configured size
 * - [x] RateLimiter blocks when limit exceeded
 * - [x] RateLimiter integrates with token bucket algorithm
 * - [x] RateLimiter handles multiple concurrent callers fairly
 *
 * @module db/primitives/sync/tests/rate-limiter.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  RateLimiter,
  createRateLimiter,
  type RateLimitConfig,
} from '../rate-limiter'

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Helper to measure elapsed time for an async operation
 */
async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; elapsed: number }> {
  const start = performance.now()
  const result = await fn()
  const elapsed = performance.now() - start
  return { result, elapsed }
}

/**
 * Helper to wait for a specific duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// =============================================================================
// RATE LIMITER TESTS
// =============================================================================

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('constructor', () => {
    it('creates a rate limiter with default configuration', () => {
      const limiter = new RateLimiter({})
      expect(limiter).toBeInstanceOf(RateLimiter)
    })

    it('accepts requests per second configuration', () => {
      const limiter = new RateLimiter({ requestsPerSecond: 10 })
      expect(limiter).toBeInstanceOf(RateLimiter)
    })

    it('accepts requests per minute configuration', () => {
      const limiter = new RateLimiter({ requestsPerMinute: 100 })
      expect(limiter).toBeInstanceOf(RateLimiter)
    })

    it('accepts requests per hour configuration', () => {
      const limiter = new RateLimiter({ requestsPerHour: 1000 })
      expect(limiter).toBeInstanceOf(RateLimiter)
    })

    it('accepts burst size configuration', () => {
      const limiter = new RateLimiter({ requestsPerSecond: 10, burstSize: 20 })
      expect(limiter).toBeInstanceOf(RateLimiter)
    })

    it('throws error for invalid configuration (negative values)', () => {
      expect(() => new RateLimiter({ requestsPerSecond: -1 })).toThrow()
    })

    it('throws error for invalid configuration (zero rate)', () => {
      expect(() => new RateLimiter({ requestsPerSecond: 0 })).toThrow()
    })
  })

  describe('acquire', () => {
    it('allows immediate acquisition when tokens are available', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 10 })

      const acquirePromise = limiter.acquire()
      vi.advanceTimersByTime(0)

      await expect(acquirePromise).resolves.toBeUndefined()
    })

    it('allows multiple acquisitions up to burst limit', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 10, burstSize: 5 })

      // Should be able to acquire 5 tokens immediately (burst size)
      const promises = []
      for (let i = 0; i < 5; i++) {
        promises.push(limiter.acquire())
      }

      vi.advanceTimersByTime(0)
      await Promise.all(promises)

      // All should resolve without blocking
      expect(promises).toHaveLength(5)
    })

    it('blocks when tokens are exhausted', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 2, burstSize: 2 })

      // Exhaust tokens
      await limiter.acquire()
      await limiter.acquire()

      // Third request should block
      let resolved = false
      const thirdAcquire = limiter.acquire().then(() => {
        resolved = true
      })

      // Advance time slightly, should still be blocked
      vi.advanceTimersByTime(100)
      await Promise.resolve() // flush microtasks
      expect(resolved).toBe(false)

      // Advance time to allow token refill (500ms for 2 req/sec)
      vi.advanceTimersByTime(500)
      await thirdAcquire
      expect(resolved).toBe(true)
    })

    it('enforces requests per second limit', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 2, burstSize: 1 })

      // First request should be immediate
      await limiter.acquire()

      // Second request should be delayed by ~500ms (1/2 second)
      let secondResolved = false
      const secondAcquire = limiter.acquire().then(() => {
        secondResolved = true
      })

      // After 400ms, should still be blocked
      vi.advanceTimersByTime(400)
      await Promise.resolve()
      expect(secondResolved).toBe(false)

      // After 600ms total, should be resolved
      vi.advanceTimersByTime(200)
      await secondAcquire
      expect(secondResolved).toBe(true)
    })

    it('enforces requests per minute limit', async () => {
      const limiter = new RateLimiter({ requestsPerMinute: 6, burstSize: 1 })

      // First request should be immediate
      await limiter.acquire()

      // Second request should be delayed by ~10 seconds (60s / 6 requests)
      let secondResolved = false
      const secondAcquire = limiter.acquire().then(() => {
        secondResolved = true
      })

      // After 5 seconds, should still be blocked
      vi.advanceTimersByTime(5000)
      await Promise.resolve()
      expect(secondResolved).toBe(false)

      // After 10 seconds total, should be resolved
      vi.advanceTimersByTime(5000)
      await secondAcquire
      expect(secondResolved).toBe(true)
    })

    it('enforces requests per hour limit', async () => {
      const limiter = new RateLimiter({ requestsPerHour: 36, burstSize: 1 })

      // First request should be immediate
      await limiter.acquire()

      // Second request should be delayed by ~100 seconds (3600s / 36 requests)
      let secondResolved = false
      const secondAcquire = limiter.acquire().then(() => {
        secondResolved = true
      })

      // After 50 seconds, should still be blocked
      vi.advanceTimersByTime(50000)
      await Promise.resolve()
      expect(secondResolved).toBe(false)

      // After 100 seconds total, should be resolved
      vi.advanceTimersByTime(50000)
      await secondAcquire
      expect(secondResolved).toBe(true)
    })
  })

  describe('release', () => {
    it('returns a token to the bucket', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 2, burstSize: 2 })

      // Exhaust tokens
      await limiter.acquire()
      await limiter.acquire()

      // Release one token
      limiter.release()

      // Should be able to acquire immediately now
      let resolved = false
      const acquirePromise = limiter.acquire().then(() => {
        resolved = true
      })

      vi.advanceTimersByTime(0)
      await acquirePromise
      expect(resolved).toBe(true)
    })

    it('does not exceed burst size when releasing', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 2, burstSize: 2 })

      // Multiple releases should not exceed burst size
      limiter.release()
      limiter.release()
      limiter.release()
      limiter.release()

      // Should only be able to acquire burst size (2) immediately, then block
      await limiter.acquire()
      await limiter.acquire()

      let thirdResolved = false
      const thirdAcquire = limiter.acquire().then(() => {
        thirdResolved = true
      })

      vi.advanceTimersByTime(100)
      await Promise.resolve()
      expect(thirdResolved).toBe(false)

      vi.advanceTimersByTime(500)
      await thirdAcquire
    })
  })

  describe('token bucket algorithm', () => {
    it('refills tokens over time according to rate', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 4, burstSize: 2 })

      // Exhaust initial tokens
      await limiter.acquire()
      await limiter.acquire()

      // Wait 250ms (should refill 1 token at 4 req/sec)
      vi.advanceTimersByTime(250)

      // Should be able to acquire one token
      let firstResolved = false
      const firstAcquire = limiter.acquire().then(() => {
        firstResolved = true
      })
      vi.advanceTimersByTime(0)
      await firstAcquire
      expect(firstResolved).toBe(true)

      // But second should block
      let secondResolved = false
      const secondAcquire = limiter.acquire().then(() => {
        secondResolved = true
      })
      vi.advanceTimersByTime(100)
      await Promise.resolve()
      expect(secondResolved).toBe(false)

      vi.advanceTimersByTime(200)
      await secondAcquire
    })

    it('caps token refill at burst size', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 10, burstSize: 5 })

      // Wait a long time to ensure bucket is full
      vi.advanceTimersByTime(10000)

      // Should only be able to acquire burst size (5) immediately
      const promises = []
      for (let i = 0; i < 5; i++) {
        promises.push(limiter.acquire())
      }
      vi.advanceTimersByTime(0)
      await Promise.all(promises)

      // 6th should block
      let sixthResolved = false
      const sixthAcquire = limiter.acquire().then(() => {
        sixthResolved = true
      })
      vi.advanceTimersByTime(50)
      await Promise.resolve()
      expect(sixthResolved).toBe(false)

      vi.advanceTimersByTime(100)
      await sixthAcquire
    })

    it('handles fractional token accumulation', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 3, burstSize: 1 })

      // First request
      await limiter.acquire()

      // Wait 333ms (should refill ~1 token)
      vi.advanceTimersByTime(333)

      let resolved = false
      const acquirePromise = limiter.acquire().then(() => {
        resolved = true
      })
      vi.advanceTimersByTime(10) // Small buffer for timing
      await acquirePromise
      expect(resolved).toBe(true)
    })
  })

  describe('concurrent callers', () => {
    it('processes waiting callers in FIFO order', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 1, burstSize: 1 })

      const order: number[] = []

      // First caller gets token immediately
      await limiter.acquire()

      // Queue up three more callers
      const caller1 = limiter.acquire().then(() => order.push(1))
      const caller2 = limiter.acquire().then(() => order.push(2))
      const caller3 = limiter.acquire().then(() => order.push(3))

      // Advance time to process each caller
      vi.advanceTimersByTime(1000) // First waiting caller
      await Promise.resolve()
      vi.advanceTimersByTime(1000) // Second waiting caller
      await Promise.resolve()
      vi.advanceTimersByTime(1000) // Third waiting caller
      await Promise.all([caller1, caller2, caller3])

      // Should be processed in order
      expect(order).toEqual([1, 2, 3])
    })

    it('handles multiple concurrent callers fairly', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 2, burstSize: 2 })

      let completed = 0
      const promises: Promise<void>[] = []

      // Create 10 concurrent callers
      for (let i = 0; i < 10; i++) {
        promises.push(
          limiter.acquire().then(() => {
            completed++
          })
        )
      }

      // First 2 should complete immediately (burst)
      await vi.advanceTimersByTimeAsync(0)
      expect(completed).toBe(2)

      // After 500ms, 1 more should complete
      await vi.advanceTimersByTimeAsync(500)
      expect(completed).toBe(3)

      // After another 500ms, 1 more
      await vi.advanceTimersByTimeAsync(500)
      expect(completed).toBe(4)

      // Finish all remaining
      await vi.advanceTimersByTimeAsync(5000)
      await Promise.all(promises)
      expect(completed).toBe(10)
    })

    it('does not starve any caller', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 5, burstSize: 1 })

      const callerIds: number[] = []

      // Exhaust initial token
      await limiter.acquire()

      // Queue up callers
      const promises = []
      for (let i = 1; i <= 5; i++) {
        promises.push(
          limiter.acquire().then(() => {
            callerIds.push(i)
          })
        )
      }

      // Advance enough time for all to complete
      vi.advanceTimersByTime(5000)
      await Promise.all(promises)

      // All callers should have been served
      expect(callerIds.sort()).toEqual([1, 2, 3, 4, 5])
    })
  })

  describe('getAvailableTokens', () => {
    it('returns current available tokens', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 10, burstSize: 5 })

      expect(limiter.getAvailableTokens()).toBe(5)

      await limiter.acquire()
      expect(limiter.getAvailableTokens()).toBe(4)

      await limiter.acquire()
      expect(limiter.getAvailableTokens()).toBe(3)
    })

    it('reflects token refill over time', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 10, burstSize: 5 })

      // Exhaust all tokens
      for (let i = 0; i < 5; i++) {
        await limiter.acquire()
      }
      expect(limiter.getAvailableTokens()).toBe(0)

      // Wait 100ms (should refill 1 token)
      vi.advanceTimersByTime(100)
      expect(limiter.getAvailableTokens()).toBe(1)

      // Wait another 400ms (should refill 4 more, up to max 5)
      vi.advanceTimersByTime(400)
      expect(limiter.getAvailableTokens()).toBe(5)
    })
  })

  describe('getWaitTime', () => {
    it('returns 0 when tokens are available', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 10, burstSize: 5 })

      expect(limiter.getWaitTime()).toBe(0)
    })

    it('returns estimated wait time when tokens are exhausted', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 2, burstSize: 2 })

      await limiter.acquire()
      await limiter.acquire()

      // Should wait ~500ms for next token (1/2 requests per second)
      const waitTime = limiter.getWaitTime()
      expect(waitTime).toBeGreaterThanOrEqual(450)
      expect(waitTime).toBeLessThanOrEqual(550)
    })
  })

  describe('tryAcquire', () => {
    it('returns true when token is available', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 10, burstSize: 5 })

      expect(limiter.tryAcquire()).toBe(true)
    })

    it('returns false when tokens are exhausted (non-blocking)', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 2, burstSize: 2 })

      await limiter.acquire()
      await limiter.acquire()

      // Should return false immediately without blocking
      expect(limiter.tryAcquire()).toBe(false)
    })

    it('consumes token when returning true', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 10, burstSize: 2 })

      expect(limiter.getAvailableTokens()).toBe(2)
      expect(limiter.tryAcquire()).toBe(true)
      expect(limiter.getAvailableTokens()).toBe(1)
      expect(limiter.tryAcquire()).toBe(true)
      expect(limiter.getAvailableTokens()).toBe(0)
      expect(limiter.tryAcquire()).toBe(false)
    })
  })

  describe('reset', () => {
    it('resets tokens to burst size', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 10, burstSize: 5 })

      // Exhaust all tokens
      for (let i = 0; i < 5; i++) {
        await limiter.acquire()
      }
      expect(limiter.getAvailableTokens()).toBe(0)

      // Reset
      limiter.reset()
      expect(limiter.getAvailableTokens()).toBe(5)
    })
  })

  describe('factory function', () => {
    it('creates a rate limiter via createRateLimiter', () => {
      const limiter = createRateLimiter({ requestsPerSecond: 10 })
      expect(limiter).toBeInstanceOf(RateLimiter)
    })

    it('passes configuration to the rate limiter', async () => {
      const limiter = createRateLimiter({ requestsPerSecond: 2, burstSize: 1 })

      await limiter.acquire()

      // Second should be delayed
      let resolved = false
      const secondAcquire = limiter.acquire().then(() => {
        resolved = true
      })

      vi.advanceTimersByTime(400)
      await Promise.resolve()
      expect(resolved).toBe(false)

      vi.advanceTimersByTime(200)
      await secondAcquire
      expect(resolved).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('handles very high request rates', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 10000, burstSize: 100 })

      // Should handle high throughput
      const promises = []
      for (let i = 0; i < 100; i++) {
        promises.push(limiter.acquire())
      }

      vi.advanceTimersByTime(0)
      await Promise.all(promises)
    })

    it('handles very low request rates', async () => {
      // 1 request per hour - verify configuration is accepted and wait time is calculated correctly
      const limiter = new RateLimiter({ requestsPerHour: 1, burstSize: 1 })

      // First request should be immediate
      await limiter.acquire()
      expect(limiter.getAvailableTokens()).toBe(0)

      // Wait time should be ~1 hour (3600000ms) for next token
      const waitTime = limiter.getWaitTime()
      expect(waitTime).toBeGreaterThan(3500000) // Close to 1 hour
      expect(waitTime).toBeLessThanOrEqual(3600000)

      // Verify tryAcquire returns false (non-blocking check)
      expect(limiter.tryAcquire()).toBe(false)

      // Verify tokens refill correctly over time
      vi.advanceTimersByTime(3600000) // Advance 1 hour
      expect(limiter.getAvailableTokens()).toBe(1) // Should have refilled
    })

    it('handles combination of rate limits (uses most restrictive)', async () => {
      // 10 per second, but only 60 per minute (more restrictive at sustained rate)
      const limiter = new RateLimiter({
        requestsPerSecond: 10,
        requestsPerMinute: 6, // This is more restrictive for sustained traffic
        burstSize: 3,
      })

      // Burst should allow 3 immediately
      await limiter.acquire()
      await limiter.acquire()
      await limiter.acquire()

      // Fourth should be rate limited by the most restrictive (6/min = 10s interval)
      let resolved = false
      const fourthAcquire = limiter.acquire().then(() => {
        resolved = true
      })

      vi.advanceTimersByTime(5000) // 5 seconds
      await Promise.resolve()
      expect(resolved).toBe(false)

      vi.advanceTimersByTime(5000) // 10 seconds total
      await fourthAcquire
      expect(resolved).toBe(true)
    })

    it('handles burst size of 1', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 2, burstSize: 1 })

      // First should be immediate
      await limiter.acquire()

      // Second should wait
      let resolved = false
      const secondAcquire = limiter.acquire().then(() => {
        resolved = true
      })

      vi.advanceTimersByTime(400)
      await Promise.resolve()
      expect(resolved).toBe(false)

      vi.advanceTimersByTime(200)
      await secondAcquire
      expect(resolved).toBe(true)
    })
  })
})
