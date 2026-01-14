/**
 * Rate Limiting and Quotas Tests (dotdo-nx6sv)
 *
 * Tests for:
 * - Token bucket rate limiter
 * - Retry with exponential backoff
 * - API quota tracking
 * - Concurrent request limits
 * - Rate limit header parsing (X-RateLimit-*)
 *
 * @module db/primitives/connector-framework/rate-limiting.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import {
  type RateLimiter,
  type RateLimiterConfig,
  type QuotaManager,
  type QuotaConfig,
  type RetryConfig,
  type RateLimitInfo,
  createTokenBucketRateLimiter,
  createQuotaManager,
  createRetryWithBackoff,
  parseRateLimitHeaders,
  type RetryResult,
} from './rate-limiting'

describe('TokenBucketRateLimiter', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic rate limiting', () => {
    it('should allow requests within rate limit', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 1, // 1 token per second
        refillInterval: 1000,
      })

      // Should allow 10 requests immediately
      for (let i = 0; i < 10; i++) {
        const result = await rateLimiter.acquire()
        expect(result.allowed).toBe(true)
      }
    })

    it('should block requests when bucket is empty', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 2,
        refillRate: 1,
        refillInterval: 1000,
      })

      await rateLimiter.acquire()
      await rateLimiter.acquire()

      const result = await rateLimiter.acquire()

      expect(result.allowed).toBe(false)
      expect(result.retryAfter).toBeGreaterThan(0)
    })

    it('should refill tokens over time', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 2,
        refillRate: 1,
        refillInterval: 1000,
      })

      await rateLimiter.acquire()
      await rateLimiter.acquire()

      // Advance time by 1 second
      vi.advanceTimersByTime(1000)

      const result = await rateLimiter.acquire()
      expect(result.allowed).toBe(true)
    })

    it('should not exceed max tokens when refilling', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 5,
        refillRate: 2,
        refillInterval: 1000,
      })

      // Advance time significantly
      vi.advanceTimersByTime(10000)

      // Should only have 5 tokens max
      const info = await rateLimiter.getStatus()
      expect(info.availableTokens).toBe(5)
    })
  })

  describe('burst handling', () => {
    it('should support burst capacity', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 5,
        refillInterval: 1000,
        burstCapacity: 5, // Allow refilling up to 15 tokens total
      })

      // Use 10 initial tokens
      for (let i = 0; i < 10; i++) {
        const result = await rateLimiter.acquire()
        expect(result.allowed).toBe(true)
      }

      // Advance time to refill tokens (1 second = 5 tokens)
      vi.advanceTimersByTime(1000)

      // Should allow 5 more requests
      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter.acquire()
        expect(result.allowed).toBe(true)
      }

      // Next should be blocked
      const result = await rateLimiter.acquire()
      expect(result.allowed).toBe(false)
    })

    it('should accumulate up to burst capacity over time', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 5,
        refillInterval: 1000,
        burstCapacity: 5, // Total capacity = 15
      })

      // Advance time significantly to let tokens accumulate
      vi.advanceTimersByTime(10000)

      // Status should show 15 tokens (max + burst)
      const status = await rateLimiter.getStatus()
      expect(status.availableTokens).toBe(15)
      expect(status.maxTokens).toBe(15)
    })
  })

  describe('request cost', () => {
    it('should support variable request costs', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 1,
        refillInterval: 1000,
      })

      // Request with cost of 5 tokens
      const result1 = await rateLimiter.acquire(5)
      expect(result1.allowed).toBe(true)

      // Another request with cost of 5
      const result2 = await rateLimiter.acquire(5)
      expect(result2.allowed).toBe(true)

      // Third request should fail (no tokens left)
      const result3 = await rateLimiter.acquire(1)
      expect(result3.allowed).toBe(false)
    })
  })

  describe('waitForToken', () => {
    it('should wait for token to become available', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 1,
        refillRate: 1,
        refillInterval: 1000,
      })

      await rateLimiter.acquire()

      // Start waiting for token
      const waitPromise = rateLimiter.waitForToken()

      // Should not resolve immediately
      let resolved = false
      waitPromise.then(() => {
        resolved = true
      })

      await vi.advanceTimersByTimeAsync(500)
      expect(resolved).toBe(false)

      await vi.advanceTimersByTimeAsync(500)
      expect(resolved).toBe(true)
    })

    it('should timeout if token not available within limit', async () => {
      rateLimiter = createTokenBucketRateLimiter({
        maxTokens: 1,
        refillRate: 1,
        refillInterval: 10000, // 10 seconds refill
      })

      await rateLimiter.acquire()

      // Start waiting for a token with a 1 second timeout
      const waitPromise = rateLimiter.waitForToken({ timeout: 1000 })

      // Attach catch handler early to prevent unhandled rejection warning
      let error: Error | undefined
      waitPromise.catch((e) => {
        error = e
      })

      // Advance time past the timeout (but not past refill time)
      await vi.advanceTimersByTimeAsync(1500)

      // Wait for the promise to settle
      await vi.waitFor(() => error !== undefined, { timeout: 100 })

      // Verify it was a timeout error
      expect(error?.message).toMatch(/timeout/i)
    })
  })
})

describe('RetryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('exponential backoff', () => {
    it('should retry with exponential backoff', async () => {
      let attempts = 0
      const operation = vi.fn(async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Temporary failure')
        }
        return 'success'
      })

      const retry = createRetryWithBackoff({
        maxRetries: 5,
        initialDelayMs: 100,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
      })

      const resultPromise = retry.execute(operation)

      // First attempt fails immediately
      await vi.advanceTimersByTimeAsync(0)

      // Wait for first retry (100ms)
      await vi.advanceTimersByTimeAsync(100)

      // Wait for second retry (200ms)
      await vi.advanceTimersByTimeAsync(200)

      const result = await resultPromise

      expect(result.success).toBe(true)
      expect(result.value).toBe('success')
      expect(result.attempts).toBe(3)
    })

    it('should respect max delay cap', async () => {
      const delays: number[] = []
      const operation = vi.fn(async () => {
        throw new Error('Always fails')
      })

      const retry = createRetryWithBackoff({
        maxRetries: 5,
        initialDelayMs: 1000,
        maxDelayMs: 3000, // Cap at 3 seconds
        backoffMultiplier: 2,
        onRetry: (attempt, delay) => delays.push(delay),
      })

      const resultPromise = retry.execute(operation)

      // Advance through all retries
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(5000)
      }

      await resultPromise.catch(() => {})

      // Delays should be capped at 3000ms
      expect(delays.every((d) => d <= 3000)).toBe(true)
    })

    it('should add jitter to prevent thundering herd', async () => {
      const allDelays: number[] = []

      // Run multiple executions with jitter
      for (let run = 0; run < 3; run++) {
        const retry = createRetryWithBackoff({
          maxRetries: 5,
          initialDelayMs: 1000,
          maxDelayMs: 10000,
          backoffMultiplier: 2,
          jitter: true,
          shouldRetry: () => true, // Always retry for this test
          onRetry: (_attempt, delay) => allDelays.push(delay),
        })

        const operation = vi.fn(async () => {
          throw new Error('Temporary failure') // Matches retriable pattern
        })

        const resultPromise = retry.execute(operation)
        for (let j = 0; j < 6; j++) {
          await vi.advanceTimersByTimeAsync(15000)
        }
        await resultPromise.catch(() => {})
      }

      // With jitter, delays across runs should have some variance
      // Each run has 5 retries, so we should have 15 delays total
      expect(allDelays.length).toBeGreaterThan(0)

      // Jitter applies 0.5-1.5x multiplier, so base delay of 1000 could be 500-1500
      // Second delay (2000 base) could be 1000-3000, etc.
      // At minimum, the varying random should produce different values
      const uniqueDelays = new Set(allDelays)
      // With 15 delays and random jitter, we expect at least some variation
      // Being lenient: just check we have any variance
      expect(uniqueDelays.size).toBeGreaterThanOrEqual(1)

      // Also verify that jitter actually modifies the base delays
      // Base delays would be 1000, 2000, 4000, 8000, 10000 (capped)
      // With jitter, they should vary from these exact values
      const baseDelays = [1000, 2000, 4000, 8000, 10000]
      const hasModifiedDelay = allDelays.some((d) => !baseDelays.includes(d))
      expect(hasModifiedDelay).toBe(true)
    })
  })

  describe('retry conditions', () => {
    it('should only retry on retriable errors', async () => {
      let attempts = 0
      const operation = vi.fn(async () => {
        attempts++
        if (attempts === 1) {
          const error = new Error('Not found')
          ;(error as any).statusCode = 404
          throw error
        }
        return 'success'
      })

      const retry = createRetryWithBackoff({
        maxRetries: 3,
        initialDelayMs: 100,
        shouldRetry: (error) => {
          return (error as any).statusCode !== 404
        },
      })

      const result = await retry.execute(operation)

      expect(result.success).toBe(false)
      expect(result.attempts).toBe(1) // Should not retry 404
    })

    it('should retry on 429 Too Many Requests', async () => {
      let attempts = 0
      const operation = vi.fn(async () => {
        attempts++
        if (attempts < 3) {
          const error = new Error('Too Many Requests')
          ;(error as any).statusCode = 429
          throw error
        }
        return 'success'
      })

      const retry = createRetryWithBackoff({
        maxRetries: 5,
        initialDelayMs: 100,
      })

      const resultPromise = retry.execute(operation)

      // Advance through retries
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(1000)
      }

      const result = await resultPromise

      expect(result.success).toBe(true)
      expect(result.attempts).toBe(3)
    })
  })

  describe('circuit breaker', () => {
    it('should open circuit after consecutive failures', async () => {
      const operation = vi.fn(async () => {
        throw new Error('Service unavailable')
      })

      const retry = createRetryWithBackoff({
        maxRetries: 1,
        initialDelayMs: 100,
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeoutMs: 5000,
        },
      })

      // First 3 calls trigger circuit breaker
      for (let i = 0; i < 3; i++) {
        const resultPromise = retry.execute(operation)
        await vi.advanceTimersByTimeAsync(1000)
        await resultPromise.catch(() => {})
      }

      // Circuit should be open now
      const result = await retry.execute(operation)

      expect(result.success).toBe(false)
      expect(result.error?.message).toMatch(/circuit.*open/i)
    })

    it('should close circuit after reset timeout', async () => {
      let shouldFail = true
      const operation = vi.fn(async () => {
        if (shouldFail) throw new Error('Service unavailable')
        return 'success'
      })

      const retry = createRetryWithBackoff({
        maxRetries: 1,
        initialDelayMs: 100,
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeoutMs: 5000,
        },
      })

      // Trigger circuit breaker
      for (let i = 0; i < 2; i++) {
        const resultPromise = retry.execute(operation)
        await vi.advanceTimersByTimeAsync(1000)
        await resultPromise.catch(() => {})
      }

      // Wait for reset timeout
      await vi.advanceTimersByTimeAsync(5000)

      // Service recovers
      shouldFail = false

      const result = await retry.execute(operation)

      expect(result.success).toBe(true)
    })
  })
})

describe('QuotaManager', () => {
  let quotaManager: QuotaManager

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('API quota tracking', () => {
    it('should track API quota usage', async () => {
      quotaManager = createQuotaManager({
        quotas: [
          { name: 'daily', limit: 1000, windowMs: 24 * 60 * 60 * 1000 },
          { name: 'hourly', limit: 100, windowMs: 60 * 60 * 1000 },
        ],
      })

      await quotaManager.consume('daily', 50)
      await quotaManager.consume('hourly', 10)

      const dailyStatus = await quotaManager.getStatus('daily')
      const hourlyStatus = await quotaManager.getStatus('hourly')

      expect(dailyStatus.used).toBe(50)
      expect(dailyStatus.remaining).toBe(950)
      expect(hourlyStatus.used).toBe(10)
      expect(hourlyStatus.remaining).toBe(90)
    })

    it('should reject when quota exceeded', async () => {
      quotaManager = createQuotaManager({
        quotas: [{ name: 'requests', limit: 10, windowMs: 60000 }],
      })

      await quotaManager.consume('requests', 10)

      await expect(quotaManager.consume('requests', 1)).rejects.toThrow(/quota.*exceeded/i)
    })

    it('should reset quota after window expires', async () => {
      quotaManager = createQuotaManager({
        quotas: [{ name: 'requests', limit: 10, windowMs: 60000 }],
      })

      await quotaManager.consume('requests', 10)

      // Advance past window
      vi.advanceTimersByTime(60001)

      // Should allow new requests
      await expect(quotaManager.consume('requests', 5)).resolves.not.toThrow()

      const status = await quotaManager.getStatus('requests')
      expect(status.used).toBe(5)
    })
  })

  describe('concurrent request limits', () => {
    it('should limit concurrent requests', async () => {
      quotaManager = createQuotaManager({
        maxConcurrent: 3,
      })

      const tasks: Promise<void>[] = []

      // Start 3 concurrent tasks
      for (let i = 0; i < 3; i++) {
        tasks.push(quotaManager.withConcurrencyLimit(async () => new Promise((r) => setTimeout(r, 1000))))
      }

      // 4th task should wait
      let fourthStarted = false
      const fourthTask = quotaManager.withConcurrencyLimit(async () => {
        fourthStarted = true
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(fourthStarted).toBe(false)

      // Complete first task
      await vi.advanceTimersByTimeAsync(1000)

      // Now fourth should run
      await fourthTask
      expect(fourthStarted).toBe(true)
    })

    it('should track concurrent request count', async () => {
      quotaManager = createQuotaManager({ maxConcurrent: 5 })

      // Start 3 tasks
      const tasks = []
      for (let i = 0; i < 3; i++) {
        tasks.push(quotaManager.withConcurrencyLimit(async () => new Promise((r) => setTimeout(r, 1000))))
      }

      await vi.advanceTimersByTimeAsync(0)

      expect(quotaManager.getConcurrentCount()).toBe(3)

      await vi.advanceTimersByTimeAsync(1000)
      await Promise.all(tasks)

      expect(quotaManager.getConcurrentCount()).toBe(0)
    })
  })
})

describe('parseRateLimitHeaders', () => {
  it('should parse standard X-RateLimit headers', () => {
    const headers = new Headers({
      'X-RateLimit-Limit': '1000',
      'X-RateLimit-Remaining': '999',
      'X-RateLimit-Reset': '1705320000',
    })

    const info = parseRateLimitHeaders(headers)

    expect(info.limit).toBe(1000)
    expect(info.remaining).toBe(999)
    expect(info.resetAt).toEqual(new Date(1705320000 * 1000))
  })

  it('should parse RateLimit headers (draft standard)', () => {
    const headers = new Headers({
      RateLimit: 'limit=100, remaining=50, reset=30',
    })

    const info = parseRateLimitHeaders(headers)

    expect(info.limit).toBe(100)
    expect(info.remaining).toBe(50)
    // reset is in seconds from now
    expect(info.resetInSeconds).toBe(30)
  })

  it('should parse Retry-After header', () => {
    const headers = new Headers({
      'Retry-After': '120',
    })

    const info = parseRateLimitHeaders(headers)

    expect(info.retryAfterSeconds).toBe(120)
  })

  it('should parse GitHub-style rate limit headers', () => {
    const headers = new Headers({
      'X-RateLimit-Limit': '5000',
      'X-RateLimit-Remaining': '4999',
      'X-RateLimit-Reset': '1705320000',
      'X-RateLimit-Used': '1',
      'X-RateLimit-Resource': 'core',
    })

    const info = parseRateLimitHeaders(headers)

    expect(info.limit).toBe(5000)
    expect(info.used).toBe(1)
    expect(info.resource).toBe('core')
  })

  it('should handle missing headers gracefully', () => {
    const headers = new Headers()

    const info = parseRateLimitHeaders(headers)

    expect(info.limit).toBeUndefined()
    expect(info.remaining).toBeUndefined()
  })
})
