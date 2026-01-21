/**
 * DO-Level Rate Limiting Tests (do-soc30)
 *
 * Tests for the DORateLimiter class that provides rate limiting
 * for external callers at the DO level.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DORateLimiter,
  createDORateLimiter,
  createTieredRateLimiter,
  doRateLimitMiddleware,
  type DORateLimitConfig,
} from '../rate-limit'

describe('DORateLimiter', () => {
  let limiter: DORateLimiter

  beforeEach(() => {
    limiter = new DORateLimiter()
  })

  describe('basic functionality', () => {
    it('should allow requests within limit', () => {
      const request = createMockRequest('1.2.3.4')

      for (let i = 0; i < 10; i++) {
        const result = limiter.check(request)
        expect(result.allowed).toBe(true)
        expect(result.remaining).toBeGreaterThanOrEqual(0)
      }
    })

    it('should deny requests over limit', () => {
      // Create a limiter with very low limit for testing
      limiter = new DORateLimiter({
        defaultLimit: { requestsPerWindow: 3, windowMs: 60000 },
      })

      const request = createMockRequest('1.2.3.4')

      // First 3 requests should be allowed
      for (let i = 0; i < 3; i++) {
        const result = limiter.check(request)
        expect(result.allowed).toBe(true)
      }

      // 4th request should be denied
      const result = limiter.check(request)
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.retryAfter).toBeGreaterThan(0)
    })

    it('should track different IPs separately', () => {
      limiter = new DORateLimiter({
        defaultLimit: { requestsPerWindow: 2, windowMs: 60000 },
      })

      const request1 = createMockRequest('1.1.1.1')
      const request2 = createMockRequest('2.2.2.2')

      // Both IPs should be allowed initially
      expect(limiter.check(request1).allowed).toBe(true)
      expect(limiter.check(request1).allowed).toBe(true)
      expect(limiter.check(request2).allowed).toBe(true)
      expect(limiter.check(request2).allowed).toBe(true)

      // Both should now be rate limited
      expect(limiter.check(request1).allowed).toBe(false)
      expect(limiter.check(request2).allowed).toBe(false)
    })
  })

  describe('key extraction strategies', () => {
    it('should extract key from CF-Connecting-IP header', () => {
      const request = createMockRequest('1.2.3.4')
      const result = limiter.check(request)
      expect(result.key).toBe('ip:1.2.3.4')
    })

    it('should extract key from X-Real-IP header', () => {
      const request = new Request('https://example.com', {
        headers: { 'X-Real-IP': '5.6.7.8' },
      })
      const result = limiter.check(request)
      expect(result.key).toBe('ip:5.6.7.8')
    })

    it('should extract key from X-Forwarded-For header', () => {
      const request = new Request('https://example.com', {
        headers: { 'X-Forwarded-For': '9.10.11.12, 13.14.15.16' },
      })
      const result = limiter.check(request)
      expect(result.key).toBe('ip:9.10.11.12')
    })

    it('should use user strategy with X-User-ID header', () => {
      limiter = new DORateLimiter({ keyStrategy: 'user' })

      const request = new Request('https://example.com', {
        headers: { 'X-User-ID': 'user-123' },
      })
      const result = limiter.check(request)
      expect(result.key).toBe('user:user-123')
    })

    it('should use user strategy with Bearer token', () => {
      limiter = new DORateLimiter({ keyStrategy: 'user' })

      const request = new Request('https://example.com', {
        headers: { 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' },
      })
      const result = limiter.check(request)
      expect(result.key).toBe('bearer:eyJhbGciOiJIUzI1')
    })

    it('should use custom key extractor', () => {
      limiter = new DORateLimiter({
        keyStrategy: 'custom',
        keyExtractor: (req) => `custom:${req.headers.get('X-Custom-Key')}`,
      })

      const request = new Request('https://example.com', {
        headers: { 'X-Custom-Key': 'my-key' },
      })
      const result = limiter.check(request)
      expect(result.key).toBe('custom:my-key')
    })

    it('should throw error if custom strategy without extractor', () => {
      expect(() => {
        new DORateLimiter({ keyStrategy: 'custom' })
      }).toThrow('keyExtractor is required')
    })
  })

  describe('skip paths', () => {
    it('should skip rate limiting for health paths', () => {
      limiter = new DORateLimiter({
        defaultLimit: { requestsPerWindow: 1, windowMs: 60000 },
      })

      const healthRequest = new Request('https://example.com/health', {
        headers: { 'CF-Connecting-IP': '1.1.1.1' },
      })

      // Health check should always be allowed
      for (let i = 0; i < 10; i++) {
        const result = limiter.check(healthRequest)
        expect(result.allowed).toBe(true)
        expect(result.key).toBe('skipped')
      }
    })

    it('should skip rate limiting for custom skip paths', () => {
      limiter = new DORateLimiter({
        defaultLimit: { requestsPerWindow: 1, windowMs: 60000 },
        skipPaths: ['/public', '/assets'],
      })

      const publicRequest = new Request('https://example.com/public/data', {
        headers: { 'CF-Connecting-IP': '1.1.1.1' },
      })

      const result = limiter.check(publicRequest)
      expect(result.allowed).toBe(true)
      expect(result.key).toBe('skipped')
    })
  })

  describe('internal calls', () => {
    it('should skip rate limiting for DO-to-DO calls', () => {
      limiter = new DORateLimiter({
        defaultLimit: { requestsPerWindow: 1, windowMs: 60000 },
        skipInternalCalls: true,
      })

      const internalRequest = new Request('https://example.com/api', {
        headers: {
          'CF-Connecting-IP': '1.1.1.1',
          'X-DO-Source': 'CustomerDO',
        },
      })

      // Internal calls should always be allowed
      for (let i = 0; i < 10; i++) {
        const result = limiter.check(internalRequest)
        expect(result.allowed).toBe(true)
        expect(result.key).toBe('internal')
      }
    })

    it('should rate limit internal calls when skipInternalCalls is false', () => {
      limiter = new DORateLimiter({
        defaultLimit: { requestsPerWindow: 1, windowMs: 60000 },
        skipInternalCalls: false,
      })

      const internalRequest = new Request('https://example.com/api', {
        headers: {
          'CF-Connecting-IP': '1.1.1.1',
          'X-DO-Source': 'CustomerDO',
        },
      })

      expect(limiter.check(internalRequest).allowed).toBe(true)
      expect(limiter.check(internalRequest).allowed).toBe(false)
    })
  })

  describe('key overrides', () => {
    it('should apply per-key overrides', () => {
      limiter = new DORateLimiter({
        defaultLimit: { requestsPerWindow: 2, windowMs: 60000 },
        keyOverrides: {
          'ip:10.0.0.1': { requestsPerWindow: 100 },
        },
      })

      const regularRequest = createMockRequest('1.1.1.1')
      const overriddenRequest = createMockRequest('10.0.0.1')

      // Regular request should be limited at 2
      expect(limiter.check(regularRequest).allowed).toBe(true)
      expect(limiter.check(regularRequest).allowed).toBe(true)
      expect(limiter.check(regularRequest).allowed).toBe(false)

      // Overridden request should have much higher limit
      for (let i = 0; i < 50; i++) {
        expect(limiter.check(overriddenRequest).allowed).toBe(true)
      }
    })
  })

  describe('token bucket algorithm', () => {
    it('should use token bucket when configured', () => {
      limiter = new DORateLimiter({
        algorithm: 'token_bucket',
        defaultLimit: { requestsPerWindow: 100, windowMs: 60000, burstCapacity: 10 },
      })

      const request = createMockRequest('1.1.1.1')

      // Should allow burst capacity
      for (let i = 0; i < 10; i++) {
        const result = limiter.check(request)
        expect(result.allowed).toBe(true)
      }

      // 11th request should be denied
      const result = limiter.check(request)
      expect(result.allowed).toBe(false)
    })

    it('should refill tokens over time', () => {
      vi.useFakeTimers()

      limiter = new DORateLimiter({
        algorithm: 'token_bucket',
        defaultLimit: {
          requestsPerWindow: 60, // 1 per second
          windowMs: 60000,
          burstCapacity: 5,
        },
      })

      const request = createMockRequest('1.1.1.1')

      // Use all tokens
      for (let i = 0; i < 5; i++) {
        expect(limiter.check(request).allowed).toBe(true)
      }
      expect(limiter.check(request).allowed).toBe(false)

      // Advance time by 1 second - should refill 1 token
      vi.advanceTimersByTime(1000)
      expect(limiter.check(request).allowed).toBe(true)

      vi.useRealTimers()
    })
  })

  describe('headers and response', () => {
    it('should return proper rate limit headers', () => {
      limiter = new DORateLimiter({
        defaultLimit: { requestsPerWindow: 10, windowMs: 60000 },
      })

      const request = createMockRequest('1.1.1.1')
      const result = limiter.check(request)
      const headers = limiter.getHeaders(result)

      expect(headers['X-RateLimit-Limit']).toBe('10')
      expect(headers['X-RateLimit-Remaining']).toBe('9')
      expect(headers['X-RateLimit-Reset']).toBeDefined()
    })

    it('should include Retry-After when rate limited', () => {
      limiter = new DORateLimiter({
        defaultLimit: { requestsPerWindow: 1, windowMs: 60000 },
      })

      const request = createMockRequest('1.1.1.1')
      limiter.check(request) // Use the single allowed request
      const result = limiter.check(request) // This should be denied

      const headers = limiter.getHeaders(result)
      expect(headers['Retry-After']).toBeDefined()
      expect(parseInt(headers['Retry-After']!)).toBeGreaterThan(0)
    })

    it('should create proper 429 response', () => {
      limiter = new DORateLimiter({
        defaultLimit: { requestsPerWindow: 1, windowMs: 60000 },
      })

      const request = createMockRequest('1.1.1.1')
      limiter.check(request)
      const result = limiter.check(request)

      const response = limiter.createRateLimitResponse(result)

      expect(response.status).toBe(429)
      expect(response.headers.get('Content-Type')).toBe('application/json')
      expect(response.headers.get('X-RateLimit-Limit')).toBe('1')
    })
  })

  describe('reset and stats', () => {
    it('should reset state for a specific key', () => {
      limiter = new DORateLimiter({
        defaultLimit: { requestsPerWindow: 1, windowMs: 60000 },
      })

      const request = createMockRequest('1.1.1.1')

      expect(limiter.check(request).allowed).toBe(true)
      expect(limiter.check(request).allowed).toBe(false)

      // Reset the key
      limiter.reset('ip:1.1.1.1')

      // Should be allowed again
      expect(limiter.check(request).allowed).toBe(true)
    })

    it('should reset all state', () => {
      limiter = new DORateLimiter({
        defaultLimit: { requestsPerWindow: 1, windowMs: 60000 },
      })

      const request1 = createMockRequest('1.1.1.1')
      const request2 = createMockRequest('2.2.2.2')

      limiter.check(request1)
      limiter.check(request2)

      expect(limiter.getStats().entriesCount).toBe(2)

      limiter.resetAll()

      expect(limiter.getStats().entriesCount).toBe(0)
    })

    it('should return stats', () => {
      const request = createMockRequest('1.1.1.1')
      limiter.check(request)

      const stats = limiter.getStats()
      expect(stats.entriesCount).toBe(1)
      expect(stats.lastCleanup).toBe(0) // No cleanup yet
    })
  })

  describe('disabled limiter', () => {
    it('should allow all requests when disabled', () => {
      limiter = new DORateLimiter({
        enabled: false,
        defaultLimit: { requestsPerWindow: 1, windowMs: 60000 },
      })

      const request = createMockRequest('1.1.1.1')

      for (let i = 0; i < 100; i++) {
        expect(limiter.check(request).allowed).toBe(true)
      }
    })
  })

  describe('fail open/closed', () => {
    it('should allow requests with no key when failOpen is true', () => {
      limiter = new DORateLimiter({
        keyStrategy: 'user',
        failOpen: true,
      })

      // Request without user identification
      const request = new Request('https://example.com')
      const result = limiter.check(request)

      expect(result.allowed).toBe(true)
      expect(result.key).toBe('no-key')
    })

    it('should deny requests with no key when failOpen is false', () => {
      limiter = new DORateLimiter({
        keyStrategy: 'user',
        failOpen: false,
      })

      // Request without user identification
      const request = new Request('https://example.com')
      const result = limiter.check(request)

      expect(result.allowed).toBe(false)
      expect(result.key).toBe('no-key')
    })
  })
})

describe('createDORateLimiter', () => {
  it('should create a limiter with default config', () => {
    const limiter = createDORateLimiter()
    const request = createMockRequest('1.1.1.1')
    const result = limiter.check(request)

    expect(result.allowed).toBe(true)
    expect(result.limit).toBe(100) // Default free tier
  })

  it('should create a limiter with custom config', () => {
    const limiter = createDORateLimiter({
      defaultLimit: { requestsPerWindow: 50, windowMs: 30000 },
    })
    const request = createMockRequest('1.1.1.1')
    const result = limiter.check(request)

    expect(result.limit).toBe(50)
  })
})

describe('createTieredRateLimiter', () => {
  it('should create free tier limiter', () => {
    const limiter = createTieredRateLimiter('free')
    const request = createMockRequest('1.1.1.1')
    const result = limiter.check(request)

    expect(result.limit).toBe(100)
  })

  it('should create pro tier limiter', () => {
    const limiter = createTieredRateLimiter('pro')
    const request = createMockRequest('1.1.1.1')
    const result = limiter.check(request)

    expect(result.limit).toBe(1000)
  })

  it('should create enterprise tier limiter', () => {
    const limiter = createTieredRateLimiter('enterprise')
    const request = createMockRequest('1.1.1.1')
    const result = limiter.check(request)

    expect(result.limit).toBe(10000)
  })

  it('should allow overrides', () => {
    const limiter = createTieredRateLimiter('free', {
      keyStrategy: 'user',
    })
    const request = new Request('https://example.com', {
      headers: { 'X-User-ID': 'user-1' },
    })
    const result = limiter.check(request)

    expect(result.key).toBe('user:user-1')
    expect(result.limit).toBe(100) // Still free tier limit
  })
})

describe('doRateLimitMiddleware', () => {
  it('should create middleware that adds rate limit headers', async () => {
    const middleware = doRateLimitMiddleware({
      defaultLimit: { requestsPerWindow: 100, windowMs: 60000 },
    })

    // Create a mock Hono context
    const headers = new Map<string, string>()
    const mockContext = {
      req: {
        raw: createMockRequest('1.1.1.1'),
      },
      header: (key: string, value: string) => headers.set(key, value),
      set: vi.fn(),
      json: vi.fn(),
    }

    let nextCalled = false
    const next = async () => {
      nextCalled = true
    }

    await middleware(mockContext as any, next)

    expect(nextCalled).toBe(true)
    expect(headers.get('X-RateLimit-Limit')).toBe('100')
    expect(headers.get('X-RateLimit-Remaining')).toBe('99')
    expect(mockContext.set).toHaveBeenCalledWith('rateLimit', expect.any(Object))
  })

  it('should return 429 response when rate limited', async () => {
    const middleware = doRateLimitMiddleware({
      defaultLimit: { requestsPerWindow: 1, windowMs: 60000 },
    })

    const mockContext = {
      req: {
        raw: createMockRequest('1.1.1.1'),
      },
      header: vi.fn(),
      set: vi.fn(),
      json: vi.fn().mockReturnValue(new Response(null, { status: 429 })),
    }

    const next = vi.fn()

    // First request - allowed
    await middleware(mockContext as any, next)
    expect(next).toHaveBeenCalled()

    next.mockClear()

    // Second request - rate limited
    const response = await middleware(mockContext as any, next)

    expect(next).not.toHaveBeenCalled()
    expect(mockContext.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'RATE_LIMIT_EXCEEDED',
        }),
      }),
      429
    )
  })
})

// ============================================================================
// HELPERS
// ============================================================================

function createMockRequest(ip: string): Request {
  return new Request('https://example.com/api/data', {
    headers: {
      'CF-Connecting-IP': ip,
    },
  })
}
