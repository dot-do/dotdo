/**
 * RateLimiter Tests (TDD GREEN Phase)
 *
 * Tests for the RateLimiter class extracted from EventStreamDO.
 * This component handles token bucket rate limiting for connections and operations.
 *
 * @issue do-b6rj - RateLimiter Interface Tests
 * @issue do-e7ke - Extract RateLimiter from EventStreamDO
 * @wave Wave 3: EventStreamDO Decomposition
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  RateLimiter,
  type IRateLimiter,
  type RateLimitConfig,
  type RateLimitStatus,
} from '../event-stream/rate-limiter'

// Re-export types for backwards compatibility
export type { RateLimitConfig, RateLimitStatus, IRateLimiter }

// ============================================================================
// TEST SUITES
// ============================================================================

describe('RateLimiter', () => {
  let limiter: IRateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    limiter = new RateLimiter({
      maxTokens: 100,
      refillRate: 10,
      refillIntervalMs: 1000
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('tryAcquire()', () => {
    it('allows requests under limit', () => {
      // Initial bucket should be full (100 tokens)
      expect(limiter.tryAcquire('user-1')).toBe(true)
      expect(limiter.tryAcquire('user-1')).toBe(true)
      expect(limiter.tryAcquire('user-1')).toBe(true)

      // Should have 97 tokens remaining
      expect(limiter.getRemainingTokens('user-1')).toBe(97)
    })

    it('blocks requests over limit', () => {
      // Exhaust all 100 tokens
      for (let i = 0; i < 100; i++) {
        expect(limiter.tryAcquire('user-1')).toBe(true)
      }

      // 101st request should be blocked
      expect(limiter.tryAcquire('user-1')).toBe(false)
      expect(limiter.getRemainingTokens('user-1')).toBe(0)
    })

    it('consumes specified cost', () => {
      // Consume 50 tokens at once
      expect(limiter.tryAcquire('user-1', 50)).toBe(true)
      expect(limiter.getRemainingTokens('user-1')).toBe(50)

      // Try to consume 60 more (should fail, only 50 left)
      expect(limiter.tryAcquire('user-1', 60)).toBe(false)
      expect(limiter.getRemainingTokens('user-1')).toBe(50)

      // Consume exactly remaining
      expect(limiter.tryAcquire('user-1', 50)).toBe(true)
      expect(limiter.getRemainingTokens('user-1')).toBe(0)
    })

    it('defaults cost to 1', () => {
      limiter.tryAcquire('user-1')  // Should consume 1 token
      expect(limiter.getRemainingTokens('user-1')).toBe(99)
    })

    it('tracks limits per key independently', () => {
      // User 1 exhausts their limit
      for (let i = 0; i < 100; i++) {
        limiter.tryAcquire('user-1')
      }

      // User 2 should still have full tokens
      expect(limiter.tryAcquire('user-2')).toBe(true)
      expect(limiter.getRemainingTokens('user-2')).toBe(99)
    })
  })

  describe('refills tokens over time', () => {
    it('refills tokens after interval', () => {
      // Exhaust all tokens
      for (let i = 0; i < 100; i++) {
        limiter.tryAcquire('user-1')
      }
      expect(limiter.getRemainingTokens('user-1')).toBe(0)

      // Advance time by refill interval (1 second)
      vi.advanceTimersByTime(1000)

      // Should have 10 tokens refilled
      expect(limiter.getRemainingTokens('user-1')).toBe(10)
      expect(limiter.tryAcquire('user-1')).toBe(true)
    })

    it('does not exceed max tokens on refill', () => {
      // Use 10 tokens
      for (let i = 0; i < 10; i++) {
        limiter.tryAcquire('user-1')
      }
      expect(limiter.getRemainingTokens('user-1')).toBe(90)

      // Advance time by 5 seconds (would add 50 tokens)
      vi.advanceTimersByTime(5000)

      // Should cap at 100, not 140
      expect(limiter.getRemainingTokens('user-1')).toBe(100)
    })

    it('accumulates refills correctly', () => {
      // Exhaust all tokens
      for (let i = 0; i < 100; i++) {
        limiter.tryAcquire('user-1')
      }

      // Advance time by 3 seconds
      vi.advanceTimersByTime(3000)

      // Should have 30 tokens (3 * 10)
      expect(limiter.getRemainingTokens('user-1')).toBe(30)
    })

    it('handles partial interval time', () => {
      // Exhaust all tokens
      for (let i = 0; i < 100; i++) {
        limiter.tryAcquire('user-1')
      }

      // Advance by 500ms (half interval)
      vi.advanceTimersByTime(500)

      // Should still be 0 (no refill yet)
      expect(limiter.getRemainingTokens('user-1')).toBe(0)

      // Advance another 500ms (completes interval)
      vi.advanceTimersByTime(500)

      // Now should have 10 tokens
      expect(limiter.getRemainingTokens('user-1')).toBe(10)
    })
  })

  describe('reset()', () => {
    it('resets key to full tokens', () => {
      // Exhaust some tokens
      for (let i = 0; i < 50; i++) {
        limiter.tryAcquire('user-1')
      }
      expect(limiter.getRemainingTokens('user-1')).toBe(50)

      // Reset
      limiter.reset('user-1')

      // Should be back to full
      expect(limiter.getRemainingTokens('user-1')).toBe(100)
    })

    it('handles reset of non-existent key', () => {
      // Should not throw
      limiter.reset('non-existent')
      expect(limiter.getRemainingTokens('non-existent')).toBe(100)
    })
  })

  describe('getStatus()', () => {
    it('returns full status information', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      // Use some tokens
      for (let i = 0; i < 30; i++) {
        limiter.tryAcquire('user-1')
      }

      const status = limiter.getStatus('user-1')

      expect(status.remaining).toBe(70)
      expect(status.limit).toBe(100)
      expect(status.isLimited).toBe(false)
      expect(status.resetAt).toBeGreaterThan(now)
    })

    it('indicates when rate limited', () => {
      // Exhaust all tokens
      for (let i = 0; i < 100; i++) {
        limiter.tryAcquire('user-1')
      }

      const status = limiter.getStatus('user-1')
      expect(status.isLimited).toBe(true)
      expect(status.remaining).toBe(0)
    })

    it('calculates correct resetAt time', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      // Exhaust all tokens
      for (let i = 0; i < 100; i++) {
        limiter.tryAcquire('user-1')
      }

      const status = limiter.getStatus('user-1')

      // Should reset to full in 10 seconds (100 tokens / 10 per second)
      expect(status.resetAt).toBe(now + 10000)
    })
  })

  describe('configure()', () => {
    it('supports per-key configuration', () => {
      // Configure user-1 with higher limits
      limiter.configure('user-1', { maxTokens: 1000, refillRate: 100 })

      // User 1 should have 1000 tokens
      expect(limiter.getRemainingTokens('user-1')).toBe(1000)

      // User 2 should still have default 100
      expect(limiter.getRemainingTokens('user-2')).toBe(100)
    })

    it('allows partial configuration updates', () => {
      // Configure only maxTokens
      limiter.configure('user-1', { maxTokens: 500 })

      const status = limiter.getStatus('user-1')
      expect(status.limit).toBe(500)
    })

    it('applies new refill rate on next interval', () => {
      // Configure higher refill rate
      limiter.configure('user-1', { refillRate: 50 })

      // Exhaust tokens
      for (let i = 0; i < 100; i++) {
        limiter.tryAcquire('user-1')
      }

      // Advance one interval
      vi.advanceTimersByTime(1000)

      // Should refill 50 instead of 10
      expect(limiter.getRemainingTokens('user-1')).toBe(50)
    })
  })

  describe('setDefaults()', () => {
    it('applies defaults to new keys', () => {
      limiter.setDefaults({
        maxTokens: 50,
        refillRate: 5,
        refillIntervalMs: 2000
      })

      // New key should get new defaults
      expect(limiter.getRemainingTokens('new-user')).toBe(50)
    })

    it('does not affect existing keys', () => {
      // Create key with old defaults
      limiter.tryAcquire('existing-user')
      expect(limiter.getRemainingTokens('existing-user')).toBe(99)

      // Change defaults
      limiter.setDefaults({ maxTokens: 50, refillRate: 5, refillIntervalMs: 2000 })

      // Existing key should keep old limits
      expect(limiter.getStatus('existing-user').limit).toBe(100)
    })
  })

  describe('cleanup()', () => {
    it('removes inactive keys', () => {
      // Create some keys
      limiter.tryAcquire('user-1')
      limiter.tryAcquire('user-2')
      limiter.tryAcquire('user-3')

      // Advance time past the default 1 hour threshold
      vi.advanceTimersByTime(60 * 60 * 1000 + 1)

      // Cleanup inactive keys
      const removed = limiter.cleanup()

      expect(removed).toBe(3)
    })

    it('keeps recently active keys', () => {
      // Create keys at different times
      limiter.tryAcquire('old-user')

      vi.advanceTimersByTime(30 * 60 * 1000)  // 30 minutes

      limiter.tryAcquire('new-user')

      vi.advanceTimersByTime(10 * 60 * 1000)  // 10 more minutes

      // Cleanup (assume 1 hour threshold)
      const removed = limiter.cleanup()

      // Only old-user should be removed (40 min old > 1 hour threshold? No, 40 < 60)
      // Actually with default 1 hour threshold, neither should be removed
      // old-user: 40 minutes
      // new-user: 10 minutes
      // Let's advance more to make old-user > 1 hour old
      vi.advanceTimersByTime(25 * 60 * 1000)  // 25 more minutes

      // Now old-user is 65 minutes old, new-user is 35 minutes old
      const removed2 = limiter.cleanup()

      // Only old-user should be removed
      expect(removed2).toBe(1)
      expect(limiter.getRemainingTokens('new-user')).toBeGreaterThan(0)
    })

    it('returns count of removed keys', () => {
      // Create 5 keys
      for (let i = 0; i < 5; i++) {
        limiter.tryAcquire(`user-${i}`)
      }

      // Advance time beyond threshold
      vi.advanceTimersByTime(60 * 60 * 1000 + 1000)

      const removed = limiter.cleanup()
      expect(removed).toBe(5)
    })
  })

  describe('Edge Cases', () => {
    it('handles zero cost acquire', () => {
      // Zero cost should always succeed and not consume tokens
      expect(limiter.tryAcquire('user-1', 0)).toBe(true)
      expect(limiter.getRemainingTokens('user-1')).toBe(100)
    })

    it('handles negative cost as zero', () => {
      // Negative cost should be treated as zero
      expect(limiter.tryAcquire('user-1', -5)).toBe(true)
      expect(limiter.getRemainingTokens('user-1')).toBe(100)
    })

    it('handles very large cost', () => {
      // Cost larger than max tokens should fail
      expect(limiter.tryAcquire('user-1', 1000)).toBe(false)
      expect(limiter.getRemainingTokens('user-1')).toBe(100)
    })

    it('handles rapid sequential requests', () => {
      // Simulate burst of requests
      let successful = 0
      for (let i = 0; i < 150; i++) {
        if (limiter.tryAcquire('user-1')) {
          successful++
        }
      }

      // Should only allow 100
      expect(successful).toBe(100)
    })

    it('handles concurrent key access', () => {
      // Multiple keys accessed in interleaved fashion
      limiter.tryAcquire('user-1')
      limiter.tryAcquire('user-2')
      limiter.tryAcquire('user-1')
      limiter.tryAcquire('user-3')
      limiter.tryAcquire('user-1')

      expect(limiter.getRemainingTokens('user-1')).toBe(97)
      expect(limiter.getRemainingTokens('user-2')).toBe(99)
      expect(limiter.getRemainingTokens('user-3')).toBe(99)
    })
  })
})
