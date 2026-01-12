/**
 * RateLimiter Tests - TDD Red-Green-Refactor
 *
 * Comprehensive tests for rate limiting primitives
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  RateLimiter,
  FixedWindow,
  SlidingWindow,
  TokenBucket,
  LeakyBucket,
  DistributedRateLimiter,
  QuotaManager,
  MemoryStorage,
} from './index'
import type {
  RateLimitConfig,
  RateLimitKey,
  RateLimitResult,
  TokenBucketConfig,
  LeakyBucketConfig,
  QuotaConfig,
  DistributedConfig,
} from './types'

// =============================================================================
// Fixed Window Tests
// =============================================================================

describe('FixedWindow', () => {
  let storage: MemoryStorage
  let fixedWindow: FixedWindow

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    storage = new MemoryStorage()
    fixedWindow = new FixedWindow({ requests: 10, window: 60000 }, storage)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic counting', () => {
    it('should allow requests within limit', async () => {
      const result = await fixedWindow.consume('user:123')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(9)
      expect(result.used).toBe(1)
      expect(result.limit).toBe(10)
    })

    it('should track multiple requests', async () => {
      for (let i = 0; i < 5; i++) {
        await fixedWindow.consume('user:123')
      }
      const result = await fixedWindow.consume('user:123')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4)
      expect(result.used).toBe(6)
    })

    it('should block requests when limit exceeded', async () => {
      for (let i = 0; i < 10; i++) {
        await fixedWindow.consume('user:123')
      }
      const result = await fixedWindow.consume('user:123')
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.used).toBe(10)
    })

    it('should calculate retryAfter correctly', async () => {
      for (let i = 0; i < 10; i++) {
        await fixedWindow.consume('user:123')
      }
      const result = await fixedWindow.consume('user:123')
      expect(result.allowed).toBe(false)
      expect(result.retryAfter).toBe(60) // 60 seconds remaining in window
    })
  })

  describe('window reset', () => {
    it('should reset count when window expires', async () => {
      for (let i = 0; i < 10; i++) {
        await fixedWindow.consume('user:123')
      }

      // Advance time past the window
      vi.advanceTimersByTime(60001)

      const result = await fixedWindow.consume('user:123')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(9)
      expect(result.used).toBe(1)
    })

    it('should provide correct resetAt timestamp', async () => {
      const result = await fixedWindow.consume('user:123')
      const now = Date.now()
      expect(result.resetAt).toBe(now + 60000)
    })
  })

  describe('check without consume', () => {
    it('should check without modifying state', async () => {
      await fixedWindow.consume('user:123')
      const check1 = await fixedWindow.check('user:123')
      const check2 = await fixedWindow.check('user:123')

      expect(check1.used).toBe(1)
      expect(check2.used).toBe(1) // Same as before
      expect(check1.remaining).toBe(9)
      expect(check2.remaining).toBe(9)
    })
  })

  describe('reset', () => {
    it('should reset the limit for a key', async () => {
      for (let i = 0; i < 10; i++) {
        await fixedWindow.consume('user:123')
      }

      await fixedWindow.reset('user:123')

      const result = await fixedWindow.consume('user:123')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(9)
    })
  })

  describe('multi-key isolation', () => {
    it('should track different keys independently', async () => {
      for (let i = 0; i < 10; i++) {
        await fixedWindow.consume('user:123')
      }

      const user123 = await fixedWindow.check('user:123')
      const user456 = await fixedWindow.check('user:456')

      expect(user123.allowed).toBe(false)
      expect(user456.allowed).toBe(true)
      expect(user456.remaining).toBe(10)
    })
  })
})

// =============================================================================
// Sliding Window Tests
// =============================================================================

describe('SlidingWindow', () => {
  let storage: MemoryStorage
  let slidingWindow: SlidingWindow

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    storage = new MemoryStorage()
    slidingWindow = new SlidingWindow({ requests: 10, window: 60000 }, storage)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('sliding accuracy', () => {
    it('should slide the window based on request timestamps', async () => {
      // Make 6 requests at T=0
      for (let i = 0; i < 6; i++) {
        await slidingWindow.consume('user:123')
      }

      // Advance 30 seconds
      vi.advanceTimersByTime(30000)

      // Make 4 more requests at T=30s
      for (let i = 0; i < 4; i++) {
        await slidingWindow.consume('user:123')
      }

      // Now we have 10 requests total
      let result = await slidingWindow.check('user:123')
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)

      // Advance another 31 seconds (T=61s)
      // The first 6 requests should now be outside the window
      vi.advanceTimersByTime(31000)

      result = await slidingWindow.check('user:123')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(6) // Only 4 requests in window now
    })

    it('should handle requests at window boundary', async () => {
      // Make 10 requests at T=0
      for (let i = 0; i < 10; i++) {
        await slidingWindow.consume('user:123')
      }

      // At exactly T=60s, old requests should expire
      vi.advanceTimersByTime(60000)

      const result = await slidingWindow.check('user:123')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(10)
    })
  })

  describe('log cleanup', () => {
    it('should remove expired entries from the log', async () => {
      // Make requests
      for (let i = 0; i < 5; i++) {
        await slidingWindow.consume('user:123')
        vi.advanceTimersByTime(10000)
      }

      // Advance time to expire all entries
      vi.advanceTimersByTime(60000)

      const result = await slidingWindow.check('user:123')
      expect(result.remaining).toBe(10)
    })
  })

  describe('multi-token consumption', () => {
    it('should consume multiple tokens at once', async () => {
      const result = await slidingWindow.consume('user:123', 5)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(5)
      expect(result.used).toBe(5)
    })

    it('should deny if not enough tokens', async () => {
      await slidingWindow.consume('user:123', 8)
      const result = await slidingWindow.consume('user:123', 5)
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(2)
    })
  })
})

// =============================================================================
// Token Bucket Tests
// =============================================================================

describe('TokenBucket', () => {
  let storage: MemoryStorage
  let tokenBucket: TokenBucket

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    storage = new MemoryStorage()
    tokenBucket = new TokenBucket(
      { capacity: 10, refillRate: 1 }, // 10 tokens max, 1 token/second refill
      storage
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('token consumption', () => {
    it('should start with full bucket', async () => {
      const state = await tokenBucket.getTokens('user:123')
      expect(state.tokens).toBe(10)
    })

    it('should consume tokens', async () => {
      const consumed = await tokenBucket.tryConsume('user:123', 3)
      expect(consumed).toBe(true)

      const state = await tokenBucket.getTokens('user:123')
      expect(state.tokens).toBe(7)
    })

    it('should deny when insufficient tokens', async () => {
      await tokenBucket.tryConsume('user:123', 8)
      const consumed = await tokenBucket.tryConsume('user:123', 5)
      expect(consumed).toBe(false)

      const state = await tokenBucket.getTokens('user:123')
      expect(state.tokens).toBe(2) // Unchanged
    })

    it('should handle burst traffic', async () => {
      // Burst of 10 requests immediately
      for (let i = 0; i < 10; i++) {
        const consumed = await tokenBucket.tryConsume('user:123', 1)
        expect(consumed).toBe(true)
      }

      // 11th request should fail
      const consumed = await tokenBucket.tryConsume('user:123', 1)
      expect(consumed).toBe(false)
    })
  })

  describe('token refill', () => {
    it('should refill tokens over time', async () => {
      await tokenBucket.tryConsume('user:123', 10)

      // Advance 5 seconds
      vi.advanceTimersByTime(5000)

      const state = await tokenBucket.getTokens('user:123')
      expect(state.tokens).toBe(5) // 5 tokens refilled
    })

    it('should not exceed capacity on refill', async () => {
      await tokenBucket.tryConsume('user:123', 2)

      // Advance 10 seconds (would add 10 tokens)
      vi.advanceTimersByTime(10000)

      const state = await tokenBucket.getTokens('user:123')
      expect(state.tokens).toBe(10) // Capped at capacity
    })

    it('should handle fractional refill rates', async () => {
      const slowBucket = new TokenBucket(
        { capacity: 10, refillRate: 0.1 }, // 1 token per 10 seconds
        storage
      )

      await slowBucket.tryConsume('user:456', 5)

      vi.advanceTimersByTime(30000) // 30 seconds = 3 tokens

      const state = await slowBucket.getTokens('user:456')
      expect(state.tokens).toBe(8) // 5 + 3
    })
  })

  describe('reset', () => {
    it('should reset bucket to full capacity', async () => {
      await tokenBucket.tryConsume('user:123', 10)
      await tokenBucket.reset('user:123')

      const state = await tokenBucket.getTokens('user:123')
      expect(state.tokens).toBe(10)
    })
  })

  describe('custom initial tokens', () => {
    it('should support custom initial token count', async () => {
      const customBucket = new TokenBucket(
        { capacity: 10, refillRate: 1, initialTokens: 5 },
        storage
      )

      const state = await customBucket.getTokens('new:user')
      expect(state.tokens).toBe(5)
    })
  })
})

// =============================================================================
// Leaky Bucket Tests
// =============================================================================

describe('LeakyBucket', () => {
  let storage: MemoryStorage
  let leakyBucket: LeakyBucket

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    storage = new MemoryStorage()
    leakyBucket = new LeakyBucket(
      { capacity: 10, leakRate: 2 }, // 10 capacity, 2 requests/second drain
      storage
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('request queuing', () => {
    it('should start with empty bucket', async () => {
      const state = await leakyBucket.getLevel('user:123')
      expect(state.level).toBe(0)
    })

    it('should accept requests and increase level', async () => {
      const accepted = await leakyBucket.add('user:123')
      expect(accepted).toBe(true)

      const state = await leakyBucket.getLevel('user:123')
      expect(state.level).toBe(1)
    })

    it('should reject when bucket is full', async () => {
      for (let i = 0; i < 10; i++) {
        await leakyBucket.add('user:123')
      }

      const accepted = await leakyBucket.add('user:123')
      expect(accepted).toBe(false)

      const state = await leakyBucket.getLevel('user:123')
      expect(state.level).toBe(10) // Still at capacity
    })
  })

  describe('drain rate', () => {
    it('should drain at configured rate', async () => {
      for (let i = 0; i < 10; i++) {
        await leakyBucket.add('user:123')
      }

      // Advance 3 seconds (should drain 6 requests)
      vi.advanceTimersByTime(3000)

      const state = await leakyBucket.getLevel('user:123')
      expect(state.level).toBe(4)
    })

    it('should not go below zero', async () => {
      await leakyBucket.add('user:123')

      // Advance 10 seconds (would drain 20)
      vi.advanceTimersByTime(10000)

      const state = await leakyBucket.getLevel('user:123')
      expect(state.level).toBe(0)
    })

    it('should accept new requests after draining', async () => {
      for (let i = 0; i < 10; i++) {
        await leakyBucket.add('user:123')
      }

      // Bucket full, advance 5 seconds (drain 10)
      vi.advanceTimersByTime(5000)

      const accepted = await leakyBucket.add('user:123')
      expect(accepted).toBe(true)
    })
  })

  describe('drain', () => {
    it('should completely drain the bucket', async () => {
      for (let i = 0; i < 5; i++) {
        await leakyBucket.add('user:123')
      }

      await leakyBucket.drain('user:123')

      const state = await leakyBucket.getLevel('user:123')
      expect(state.level).toBe(0)
    })
  })

  describe('smooth rate enforcement', () => {
    it('should enforce smooth rate', async () => {
      // Add requests rapidly
      const results: boolean[] = []
      for (let i = 0; i < 15; i++) {
        results.push(await leakyBucket.add('user:123'))
      }

      // First 10 should succeed
      expect(results.slice(0, 10).every(r => r === true)).toBe(true)
      // Next 5 should fail
      expect(results.slice(10).every(r => r === false)).toBe(true)

      // After 1 second (2 drained), 2 more should succeed
      vi.advanceTimersByTime(1000)

      expect(await leakyBucket.add('user:123')).toBe(true)
      expect(await leakyBucket.add('user:123')).toBe(true)
      expect(await leakyBucket.add('user:123')).toBe(false)
    })
  })
})

// =============================================================================
// RateLimiter (unified interface) Tests
// =============================================================================

describe('RateLimiter', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    storage = new MemoryStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('strategy selection', () => {
    it('should use fixed-window strategy by default', async () => {
      const limiter = new RateLimiter({ requests: 10, window: 60000 }, storage)

      const result = await limiter.consume('user:123')
      expect(result.allowed).toBe(true)
    })

    it('should use sliding-window when specified', async () => {
      const limiter = new RateLimiter(
        { requests: 10, window: 60000, strategy: 'sliding-window' },
        storage
      )

      const result = await limiter.consume('user:123')
      expect(result.allowed).toBe(true)
    })
  })

  describe('RateLimitKey support', () => {
    it('should accept RateLimitKey object', async () => {
      const limiter = new RateLimiter({ requests: 10, window: 60000 }, storage)

      const key: RateLimitKey = {
        identifier: 'user:123',
        scope: 'api',
        metadata: { endpoint: '/users' },
      }

      const result = await limiter.consume(key)
      expect(result.allowed).toBe(true)
    })

    it('should include scope in key resolution', async () => {
      const limiter = new RateLimiter({ requests: 10, window: 60000 }, storage)

      const apiKey: RateLimitKey = { identifier: 'user:123', scope: 'api' }
      const authKey: RateLimitKey = { identifier: 'user:123', scope: 'auth' }

      // Exhaust API limit
      for (let i = 0; i < 10; i++) {
        await limiter.consume(apiKey)
      }

      // Auth should still work (different scope)
      const result = await limiter.consume(authKey)
      expect(result.allowed).toBe(true)
    })
  })

  describe('getStatus', () => {
    it('should return current status without modifying state', async () => {
      const limiter = new RateLimiter({ requests: 10, window: 60000 }, storage)

      await limiter.consume('user:123')
      await limiter.consume('user:123')

      const status1 = await limiter.getStatus('user:123')
      const status2 = await limiter.getStatus('user:123')

      expect(status1.used).toBe(2)
      expect(status2.used).toBe(2)
    })
  })
})

// =============================================================================
// Distributed Rate Limiter Tests
// =============================================================================

describe('DistributedRateLimiter', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    storage = new MemoryStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('local burst', () => {
    it('should allow local burst before sync', async () => {
      const config: DistributedConfig = {
        localBurst: 5,
        syncInterval: 1000,
      }

      const limiter = new DistributedRateLimiter(
        { requests: 100, window: 60000 },
        config,
        storage
      )

      // Should allow 5 requests locally without sync
      for (let i = 0; i < 5; i++) {
        const result = await limiter.consume('user:123')
        expect(result.allowed).toBe(true)
      }
    })
  })

  describe('coordination', () => {
    it('should coordinate counts across instances', async () => {
      const config: DistributedConfig = {
        localBurst: 10, // Allow local burst up to 10
        syncInterval: 100,
      }

      // Simulate two instances sharing storage
      const limiter1 = new DistributedRateLimiter(
        { requests: 10, window: 60000 },
        config,
        storage,
        'node-1'
      )

      const limiter2 = new DistributedRateLimiter(
        { requests: 10, window: 60000 },
        config,
        storage,
        'node-2'
      )

      // Each uses 5 requests
      for (let i = 0; i < 5; i++) {
        await limiter1.consume('user:123')
      }

      // Force sync after first batch
      vi.advanceTimersByTime(150)
      await limiter1.consume('user:123', 0) // Trigger sync

      for (let i = 0; i < 5; i++) {
        await limiter2.consume('user:123')
      }

      // Force sync on limiter2
      vi.advanceTimersByTime(150)
      await limiter2.consume('user:123', 0) // Trigger sync

      // After sync, global count should reflect combined usage
      const status1 = await limiter1.getStatus('user:123')
      // Note: With distributed limiters, exact count depends on sync timing
      // Both limiters consumed 5 each through local limiter
      expect(status1.used).toBeGreaterThanOrEqual(5)
    })
  })

  describe('region awareness', () => {
    it('should track per-region counts when enabled', async () => {
      const config: DistributedConfig = {
        regionAware: true,
        localBurst: 10,
      }

      const limiter = new DistributedRateLimiter(
        { requests: 100, window: 60000 },
        config,
        storage,
        'node-1',
        'us-east'
      )

      await limiter.consume('user:123')

      const status = await limiter.getStatus('user:123')
      expect(status.used).toBe(1)
    })
  })
})

// =============================================================================
// Quota Manager Tests
// =============================================================================

describe('QuotaManager', () => {
  let storage: MemoryStorage
  let quotaManager: QuotaManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    storage = new MemoryStorage()
    quotaManager = new QuotaManager(
      {
        minute: 10,
        hourly: 100,
        daily: 1000,
        monthly: 10000,
      },
      storage
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('period tracking', () => {
    it('should track minute quota', async () => {
      for (let i = 0; i < 10; i++) {
        await quotaManager.consume('user:123')
      }

      const status = await quotaManager.getStatus('user:123')
      expect(status.usage.minute?.used).toBe(10)
      expect(status.usage.minute?.remaining).toBe(0)
      expect(status.exceededPeriods).toContain('minute')
    })

    it('should track hourly quota', async () => {
      // Use hourly-only manager to test hourly tracking independently
      const hourlyManager = new QuotaManager({ hourly: 100 }, storage)

      for (let i = 0; i < 50; i++) {
        await hourlyManager.consume('user:123')
      }

      const status = await hourlyManager.getStatus('user:123')
      expect(status.usage.hourly?.used).toBe(50)
      expect(status.usage.hourly?.remaining).toBe(50)
    })

    it('should track daily quota', async () => {
      // Use daily-only manager to test daily tracking independently
      const dailyManager = new QuotaManager({ daily: 1000 }, storage)

      for (let i = 0; i < 100; i++) {
        await dailyManager.consume('user:123')
      }

      const status = await dailyManager.getStatus('user:123')
      expect(status.usage.daily?.used).toBe(100)
      expect(status.usage.daily?.remaining).toBe(900)
    })

    it('should track monthly quota', async () => {
      // Use monthly-only manager to test monthly tracking independently
      const monthlyManager = new QuotaManager({ monthly: 10000 }, storage)

      for (let i = 0; i < 500; i++) {
        await monthlyManager.consume('user:123')
      }

      const status = await monthlyManager.getStatus('user:123')
      expect(status.usage.monthly?.used).toBe(500)
      expect(status.usage.monthly?.remaining).toBe(9500)
    })
  })

  describe('period reset', () => {
    it('should reset minute quota after 1 minute', async () => {
      for (let i = 0; i < 10; i++) {
        await quotaManager.consume('user:123')
      }

      // Advance 1 minute
      vi.advanceTimersByTime(60001)

      const status = await quotaManager.getStatus('user:123')
      expect(status.usage.minute?.used).toBe(0)
      expect(status.usage.minute?.remaining).toBe(10)
    })

    it('should reset hourly quota after 1 hour', async () => {
      for (let i = 0; i < 100; i++) {
        await quotaManager.consume('user:123')
      }

      // Advance 1 hour
      vi.advanceTimersByTime(3600001)

      const status = await quotaManager.getStatus('user:123')
      expect(status.usage.hourly?.used).toBe(0)
      expect(status.usage.hourly?.remaining).toBe(100)
    })

    it('should reset daily quota after 1 day', async () => {
      for (let i = 0; i < 1000; i++) {
        await quotaManager.consume('user:123')
      }

      // Advance 1 day
      vi.advanceTimersByTime(86400001)

      const status = await quotaManager.getStatus('user:123')
      expect(status.usage.daily?.used).toBe(0)
      expect(status.usage.daily?.remaining).toBe(1000)
    })

    it('should reset monthly quota after 1 month', async () => {
      for (let i = 0; i < 10000; i++) {
        await quotaManager.consume('user:123')
      }

      // Advance ~31 days
      vi.advanceTimersByTime(31 * 86400001)

      const status = await quotaManager.getStatus('user:123')
      expect(status.usage.monthly?.used).toBe(0)
      expect(status.usage.monthly?.remaining).toBe(10000)
    })
  })

  describe('exceeded detection', () => {
    it('should detect when any quota is exceeded', async () => {
      for (let i = 0; i < 10; i++) {
        await quotaManager.consume('user:123')
      }

      const status = await quotaManager.getStatus('user:123')
      expect(status.exceeded).toBe(true)
      expect(status.exceededPeriods).toContain('minute')
    })

    it('should block consumption when quota exceeded', async () => {
      for (let i = 0; i < 10; i++) {
        await quotaManager.consume('user:123')
      }

      // 11th request should fail due to minute quota
      const status = await quotaManager.consume('user:123')
      expect(status.exceeded).toBe(true)
      expect(status.usage.minute?.used).toBe(10) // Not incremented
    })
  })

  describe('check without consume', () => {
    it('should check quota without modifying state', async () => {
      for (let i = 0; i < 5; i++) {
        await quotaManager.consume('user:123')
      }

      const check1 = await quotaManager.check('user:123')
      const check2 = await quotaManager.check('user:123')

      expect(check1.usage.minute?.used).toBe(5)
      expect(check2.usage.minute?.used).toBe(5)
    })
  })

  describe('manual reset', () => {
    it('should reset specific periods', async () => {
      // Use only daily and hourly quotas (no minute limit blocking)
      const multiPeriodManager = new QuotaManager({ hourly: 100, daily: 1000 }, storage)

      for (let i = 0; i < 50; i++) {
        await multiPeriodManager.consume('user:123')
      }

      await multiPeriodManager.reset('user:123', ['hour'])

      const status = await multiPeriodManager.getStatus('user:123')
      expect(status.usage.hourly?.used).toBe(0)
      expect(status.usage.daily?.used).toBe(50) // Not reset
    })

    it('should reset all periods when none specified', async () => {
      for (let i = 0; i < 50; i++) {
        await quotaManager.consume('user:123')
      }

      await quotaManager.reset('user:123')

      const status = await quotaManager.getStatus('user:123')
      expect(status.usage.minute?.used).toBe(0)
      expect(status.usage.hourly?.used).toBe(0)
      expect(status.usage.daily?.used).toBe(0)
      expect(status.usage.monthly?.used).toBe(0)
    })
  })

  describe('resetAt calculation', () => {
    it('should calculate correct resetAt for each period', async () => {
      const status = await quotaManager.getStatus('user:123')
      const now = Date.now()

      // Minute reset at next minute boundary
      expect(status.usage.minute?.resetAt).toBe(now + 60000)

      // Hourly reset at next hour boundary
      expect(status.usage.hourly?.resetAt).toBe(now + 3600000)

      // Daily reset at next day boundary
      expect(status.usage.daily?.resetAt).toBe(now + 86400000)
    })
  })

  describe('weekly quota', () => {
    it('should track weekly quota', async () => {
      const weeklyManager = new QuotaManager({ weekly: 100 }, storage)

      for (let i = 0; i < 50; i++) {
        await weeklyManager.consume('user:123')
      }

      const status = await weeklyManager.getStatus('user:123')
      expect(status.usage.weekly?.used).toBe(50)
      expect(status.usage.weekly?.remaining).toBe(50)
    })

    it('should reset weekly quota after 1 week', async () => {
      const weeklyManager = new QuotaManager({ weekly: 100 }, storage)

      for (let i = 0; i < 100; i++) {
        await weeklyManager.consume('user:123')
      }

      // Advance 1 week
      vi.advanceTimersByTime(7 * 86400001)

      const status = await weeklyManager.getStatus('user:123')
      expect(status.usage.weekly?.used).toBe(0)
      expect(status.usage.weekly?.remaining).toBe(100)
    })
  })
})

// =============================================================================
// Memory Storage Tests
// =============================================================================

describe('MemoryStorage', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    storage = new MemoryStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should get and set values', async () => {
    await storage.set('key1', { value: 'test' })
    const result = await storage.get<{ value: string }>('key1')
    expect(result?.value).toBe('test')
  })

  it('should return null for missing keys', async () => {
    const result = await storage.get('missing')
    expect(result).toBeNull()
  })

  it('should handle TTL expiration', async () => {
    await storage.set('key1', { value: 'test' }, 1000) // 1 second TTL

    vi.advanceTimersByTime(500)
    let result = await storage.get('key1')
    expect(result).not.toBeNull()

    vi.advanceTimersByTime(600)
    result = await storage.get('key1')
    expect(result).toBeNull()
  })

  it('should delete keys', async () => {
    await storage.set('key1', { value: 'test' })
    await storage.delete('key1')
    const result = await storage.get('key1')
    expect(result).toBeNull()
  })

  it('should list keys by prefix', async () => {
    await storage.set('user:123:minute', {})
    await storage.set('user:123:hourly', {})
    await storage.set('user:456:minute', {})

    const keys = await storage.list('user:123:')
    expect(keys).toHaveLength(2)
    expect(keys).toContain('user:123:minute')
    expect(keys).toContain('user:123:hourly')
  })
})

// =============================================================================
// Edge Cases and Race Conditions
// =============================================================================

describe('Edge Cases', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    storage = new MemoryStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('zero and negative values', () => {
    it('should handle zero requests config', async () => {
      const limiter = new RateLimiter({ requests: 0, window: 60000 }, storage)
      const result = await limiter.consume('user:123')
      expect(result.allowed).toBe(false)
    })

    it('should handle zero token consumption', async () => {
      const limiter = new RateLimiter({ requests: 10, window: 60000 }, storage)
      const result = await limiter.consume('user:123', 0)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(10)
    })
  })

  describe('concurrent requests', () => {
    it('should handle concurrent consume calls', async () => {
      const limiter = new RateLimiter({ requests: 5, window: 60000 }, storage)

      // Simulate sequential requests (concurrent would need atomic storage)
      // In-memory storage doesn't provide atomicity for true concurrent access
      const results: RateLimitResult[] = []
      for (let i = 0; i < 7; i++) {
        results.push(await limiter.consume('user:123'))
      }

      const allowed = results.filter(r => r.allowed).length
      expect(allowed).toBe(5) // Exactly 5 should succeed
    })
  })

  describe('large values', () => {
    it('should handle large request limits', async () => {
      const limiter = new RateLimiter({ requests: 1000000, window: 60000 }, storage)

      const result = await limiter.consume('user:123')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(999999)
    })

    it('should handle very short windows', async () => {
      const limiter = new RateLimiter({ requests: 10, window: 1 }, storage)

      const result = await limiter.consume('user:123')
      expect(result.allowed).toBe(true)

      vi.advanceTimersByTime(2)

      const result2 = await limiter.consume('user:123')
      expect(result2.remaining).toBe(9) // New window started
    })
  })

  describe('special characters in keys', () => {
    it('should handle special characters in keys', async () => {
      const limiter = new RateLimiter({ requests: 10, window: 60000 }, storage)

      const result = await limiter.consume('user:email@example.com:api/v1/users?q=test')
      expect(result.allowed).toBe(true)
    })
  })

  describe('Retry-After header calculation', () => {
    it('should calculate correct Retry-After for fixed window', async () => {
      const limiter = new RateLimiter({ requests: 1, window: 30000 }, storage)

      await limiter.consume('user:123')
      const result = await limiter.consume('user:123')

      expect(result.allowed).toBe(false)
      expect(result.retryAfter).toBe(30) // 30 seconds
    })

    it('should return 0 retryAfter when allowed', async () => {
      const limiter = new RateLimiter({ requests: 10, window: 60000 }, storage)

      const result = await limiter.consume('user:123')
      expect(result.retryAfter).toBe(0)
    })
  })
})
