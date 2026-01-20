/**
 * Rate Limiting Tests
 *
 * Tests for per-tenant and per-user rate limiting middleware.
 *
 * Coverage:
 * - Rate limit enforcement
 * - Different limits per tier
 * - Reset after window expires
 * - Proper 429 responses
 * - Rate limit headers
 * - Tenant/user overrides
 * - Sliding window algorithm
 *
 * @module api/tests/rate-limit.test
 * @issue do-vytw - Add rate limiting per-tenant/per-user
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import {
  RateLimiter,
  rateLimitMiddleware,
  createRateLimiter,
  DEFAULT_TIERS,
  type RateLimitConfig,
  type RateLimitTier,
} from '../middleware/rate-limit'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock HTTP request with configurable headers
 */
function createMockRequest(options: {
  method?: string
  path?: string
  ip?: string
  tenantId?: string
  userId?: string
  headers?: Record<string, string>
}): Request {
  const {
    method = 'GET',
    path = '/api/test',
    ip = '192.168.1.1',
    tenantId,
    userId,
    headers = {},
  } = options

  const hostname = tenantId ? `${tenantId}.api.dotdo.dev` : 'api.dotdo.dev'
  const url = `https://${hostname}${path}`

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'CF-Connecting-IP': ip,
    ...headers,
  }

  if (tenantId) {
    requestHeaders['X-Tenant-ID'] = tenantId
  }

  if (userId) {
    requestHeaders['X-User-ID'] = userId
  }

  return new Request(url, {
    method,
    headers: new Headers(requestHeaders),
  })
}

/**
 * Create a Hono app with rate limiting middleware for testing
 */
function createTestApp(config: RateLimitConfig) {
  const app = new Hono()

  app.use('*', rateLimitMiddleware(config))

  app.get('/api/test', (c) => c.json({ message: 'ok' }))
  app.post('/api/data', (c) => c.json({ created: true }))
  app.get('/health', (c) => c.json({ status: 'healthy' }))

  return app
}

// ============================================================================
// TESTS: MODULE EXPORTS
// ============================================================================

describe('Rate Limit Module Exports', () => {
  it('should export RateLimiter class', () => {
    expect(RateLimiter).toBeDefined()
    expect(typeof RateLimiter).toBe('function')
  })

  it('should export rateLimitMiddleware function', () => {
    expect(rateLimitMiddleware).toBeDefined()
    expect(typeof rateLimitMiddleware).toBe('function')
  })

  it('should export createRateLimiter factory', () => {
    expect(createRateLimiter).toBeDefined()
    expect(typeof createRateLimiter).toBe('function')
  })

  it('should export DEFAULT_TIERS', () => {
    expect(DEFAULT_TIERS).toBeDefined()
    expect(DEFAULT_TIERS.free).toBeDefined()
    expect(DEFAULT_TIERS.pro).toBeDefined()
    expect(DEFAULT_TIERS.enterprise).toBeDefined()
  })
})

// ============================================================================
// TESTS: RATE LIMIT ENFORCEMENT
// ============================================================================

describe('Rate Limit Enforcement', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should allow requests under the limit', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
    })

    const request = createMockRequest({ tenantId: 'acme' })
    const result = await rateLimiter.check(request)

    expect(result.allowed).toBe(true)
    expect(result.statusCode).toBe(200)
    expect(result.remaining).toBe(99)
  })

  it('should return 429 when rate limit exceeded', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 5, windowMs: 60000 },
      },
      defaultTier: 'test',
    })

    const tenantId = 'acme'

    // Make 5 requests (should all succeed)
    for (let i = 0; i < 5; i++) {
      const request = createMockRequest({ tenantId })
      const result = await rateLimiter.check(request)
      expect(result.allowed).toBe(true)
    }

    // 6th request should be rate limited
    const request = createMockRequest({ tenantId })
    const result = await rateLimiter.check(request)

    expect(result.allowed).toBe(false)
    expect(result.statusCode).toBe(429)
    expect(result.remaining).toBe(0)
  })

  it('should return proper error body when rate limited', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 1, windowMs: 60000 },
      },
      defaultTier: 'test',
    })

    const tenantId = 'acme'

    // First request succeeds
    await rateLimiter.check(createMockRequest({ tenantId }))

    // Second request should be rate limited with proper error
    const result = await rateLimiter.check(createMockRequest({ tenantId }))

    expect(result.allowed).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error!.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(result.error!.message).toMatch(/too many requests/i)
    expect(result.retryAfter).toBeGreaterThan(0)
  })

  it('should track remaining requests correctly', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 10, windowMs: 60000 },
      },
      defaultTier: 'test',
    })

    const tenantId = 'acme'

    // Make requests and verify remaining decrements
    for (let i = 0; i < 10; i++) {
      const result = await rateLimiter.check(createMockRequest({ tenantId }))
      expect(result.remaining).toBe(10 - i - 1)
    }
  })
})

// ============================================================================
// TESTS: DIFFERENT LIMITS PER TIER
// ============================================================================

describe('Different Limits Per Tier', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should use free tier limits by default', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
    })

    const result = await rateLimiter.check(createMockRequest({ tenantId: 'acme' }))

    expect(result.tier).toBe('free')
    expect(result.limit).toBe(DEFAULT_TIERS.free.requestsPerWindow)
  })

  it('should apply different limits for different tiers', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        basic: { name: 'basic', requestsPerWindow: 50, windowMs: 60000 },
        premium: { name: 'premium', requestsPerWindow: 500, windowMs: 60000 },
      },
      defaultTier: 'basic',
    })

    // Basic tier
    const basicResult = await rateLimiter.check(
      createMockRequest({ tenantId: 'basic-tenant' }),
      { tier: 'basic' }
    )
    expect(basicResult.limit).toBe(50)

    // Premium tier
    const premiumResult = await rateLimiter.check(
      createMockRequest({ tenantId: 'premium-tenant' }),
      { tier: 'premium' }
    )
    expect(premiumResult.limit).toBe(500)
  })

  it('should apply tenant-specific overrides', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        default: { name: 'default', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'default',
      tenantOverrides: {
        'vip-tenant': { requestsPerWindow: 1000 },
      },
    })

    // Normal tenant
    const normalResult = await rateLimiter.check(
      createMockRequest({ tenantId: 'normal' }),
      { tenantId: 'normal' }
    )
    expect(normalResult.limit).toBe(100)

    // VIP tenant with override
    const vipResult = await rateLimiter.check(
      createMockRequest({ tenantId: 'vip-tenant' }),
      { tenantId: 'vip-tenant' }
    )
    expect(vipResult.limit).toBe(1000)
  })

  it('should apply user-specific overrides', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'user',
      tiers: {
        default: { name: 'default', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'default',
      userOverrides: {
        'admin-user': { requestsPerWindow: 5000 },
      },
    })

    // Normal user
    const normalResult = await rateLimiter.check(
      createMockRequest({ userId: 'normal-user' }),
      { userId: 'normal-user' }
    )
    expect(normalResult.limit).toBe(100)

    // Admin user with override
    const adminResult = await rateLimiter.check(
      createMockRequest({ userId: 'admin-user' }),
      { userId: 'admin-user' }
    )
    expect(adminResult.limit).toBe(5000)
  })

  it('should fall back to default tier for unknown tier', async () => {
    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        known: { name: 'known', requestsPerWindow: 200, windowMs: 60000 },
      },
      defaultTier: 'known',
    })

    const result = await rateLimiter.check(
      createMockRequest({ tenantId: 'acme' }),
      { tier: 'unknown-tier' }
    )

    // Should fall back to default tier
    expect(result.limit).toBe(200)
  })
})

// ============================================================================
// TESTS: RESET AFTER WINDOW EXPIRES
// ============================================================================

describe('Reset After Window Expires', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Sliding Window', () => {
    it('should reset quota after window expires', async () => {
      rateLimiter = new RateLimiter({
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 3, windowMs: 60000 },
        },
        defaultTier: 'test',
        windowStrategy: 'sliding',
      })

      const tenantId = 'acme'

      // Exhaust limit
      for (let i = 0; i < 3; i++) {
        await rateLimiter.check(createMockRequest({ tenantId }))
      }

      // Should be blocked
      let result = await rateLimiter.check(createMockRequest({ tenantId }))
      expect(result.allowed).toBe(false)

      // Advance time past window
      await vi.advanceTimersByTimeAsync(61000)

      // Should now be allowed with full quota
      result = await rateLimiter.check(createMockRequest({ tenantId }))
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(2) // 3 - 1 = 2
    })

    it('should gradually release quota in sliding window', async () => {
      rateLimiter = new RateLimiter({
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 6, windowMs: 60000 },
        },
        defaultTier: 'test',
        windowStrategy: 'sliding',
      })

      const tenantId = 'acme'

      // Make requests at different times
      await rateLimiter.check(createMockRequest({ tenantId })) // T=0
      await vi.advanceTimersByTimeAsync(10000)
      await rateLimiter.check(createMockRequest({ tenantId })) // T=10s
      await vi.advanceTimersByTimeAsync(10000)
      await rateLimiter.check(createMockRequest({ tenantId })) // T=20s
      await vi.advanceTimersByTimeAsync(10000)
      await rateLimiter.check(createMockRequest({ tenantId })) // T=30s
      await vi.advanceTimersByTimeAsync(10000)
      await rateLimiter.check(createMockRequest({ tenantId })) // T=40s
      await vi.advanceTimersByTimeAsync(10000)
      await rateLimiter.check(createMockRequest({ tenantId })) // T=50s

      // At T=50s, should be at limit
      let result = await rateLimiter.check(createMockRequest({ tenantId }))
      expect(result.allowed).toBe(false)

      // Advance to T=61s - first request (T=0) should expire
      await vi.advanceTimersByTimeAsync(11000)
      result = await rateLimiter.check(createMockRequest({ tenantId }))
      expect(result.allowed).toBe(true)
    })
  })

  describe('Fixed Window', () => {
    it('should reset count after window expires', async () => {
      rateLimiter = new RateLimiter({
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 3, windowMs: 60000 },
        },
        defaultTier: 'test',
        windowStrategy: 'fixed',
      })

      const tenantId = 'acme'

      // Exhaust limit
      for (let i = 0; i < 3; i++) {
        await rateLimiter.check(createMockRequest({ tenantId }))
      }

      // Should be blocked
      let result = await rateLimiter.check(createMockRequest({ tenantId }))
      expect(result.allowed).toBe(false)

      // Advance time past window
      await vi.advanceTimersByTimeAsync(61000)

      // Should now have full quota
      result = await rateLimiter.check(createMockRequest({ tenantId }))
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(2)
    })
  })
})

// ============================================================================
// TESTS: PROPER 429 RESPONSES
// ============================================================================

describe('Proper 429 Responses', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return 429 via middleware when limit exceeded', async () => {
    const app = createTestApp({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 2, windowMs: 60000 },
      },
      defaultTier: 'test',
    })

    // First two requests succeed
    let res = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))
    expect(res.status).toBe(200)

    res = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))
    expect(res.status).toBe(200)

    // Third request should be rate limited
    res = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))
    expect(res.status).toBe(429)

    const body = await res.json() as { error: string; code: string; retryAfter: number }
    expect(body.error).toMatch(/too many requests/i)
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(body.retryAfter).toBeGreaterThan(0)
  })

  it('should include Retry-After header in 429 response', async () => {
    const app = createTestApp({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 1, windowMs: 60000 },
      },
      defaultTier: 'test',
    })

    // First request succeeds
    await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))

    // Second request should be rate limited
    const res = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeDefined()
    expect(parseInt(res.headers.get('Retry-After')!, 10)).toBeGreaterThan(0)
  })
})

// ============================================================================
// TESTS: RATE LIMIT HEADERS
// ============================================================================

describe('Rate Limit Headers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should include X-RateLimit-Limit header', async () => {
    const app = createTestApp({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
    })

    const res = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))

    expect(res.headers.get('X-RateLimit-Limit')).toBe('100')
  })

  it('should include X-RateLimit-Remaining header', async () => {
    const app = createTestApp({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
    })

    let res = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('99')

    res = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('98')
  })

  it('should include X-RateLimit-Reset header with Unix timestamp', async () => {
    const app = createTestApp({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
    })

    const res = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))

    const resetTime = parseInt(res.headers.get('X-RateLimit-Reset')!, 10)
    const nowSeconds = Math.floor(Date.now() / 1000)

    expect(resetTime).toBeGreaterThan(nowSeconds)
    expect(resetTime).toBeLessThanOrEqual(nowSeconds + 60)
  })

  it('should include all standard rate limit headers', async () => {
    const app = createTestApp({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
    })

    const res = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))

    expect(res.headers.get('X-RateLimit-Limit')).toBeDefined()
    expect(res.headers.get('X-RateLimit-Remaining')).toBeDefined()
    expect(res.headers.get('X-RateLimit-Reset')).toBeDefined()
  })
})

// ============================================================================
// TESTS: PER-TENANT RATE LIMITING
// ============================================================================

describe('Per-Tenant Rate Limiting', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))

    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 5, windowMs: 60000 },
      },
      defaultTier: 'test',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should track rate limits per tenant independently', async () => {
    const tenantA = 'tenant-a'
    const tenantB = 'tenant-b'

    // Exhaust limit for tenant A
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check(createMockRequest({ tenantId: tenantA }))
    }
    const resultA = await rateLimiter.check(createMockRequest({ tenantId: tenantA }))
    expect(resultA.allowed).toBe(false)

    // Tenant B should still have full quota
    const resultB = await rateLimiter.check(createMockRequest({ tenantId: tenantB }))
    expect(resultB.allowed).toBe(true)
    expect(resultB.remaining).toBe(4)
  })

  it('should extract tenant from X-Tenant-ID header', async () => {
    const request = createMockRequest({ tenantId: 'acme-corp' })
    const key = rateLimiter.getKeyForRequest(request)

    expect(key).toBe('tenant:acme-corp')
  })

  it('should extract tenant from hostname', async () => {
    const request = new Request('https://acme-corp.api.dotdo.dev/test', {
      method: 'GET',
      headers: new Headers({ 'CF-Connecting-IP': '192.168.1.1' }),
    })

    const key = rateLimiter.getKeyForRequest(request)
    expect(key).toContain('acme-corp')
  })

  it('should use default tenant if not specified', async () => {
    const request = new Request('https://api.dotdo.dev/test', {
      method: 'GET',
      headers: new Headers({ 'CF-Connecting-IP': '192.168.1.1' }),
    })

    const key = rateLimiter.getKeyForRequest(request)
    expect(key).toBe('tenant:default')
  })
})

// ============================================================================
// TESTS: PER-USER RATE LIMITING
// ============================================================================

describe('Per-User Rate Limiting', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))

    rateLimiter = new RateLimiter({
      keyStrategy: 'user',
      tiers: {
        test: { name: 'test', requestsPerWindow: 5, windowMs: 60000 },
      },
      defaultTier: 'test',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should track rate limits per user independently', async () => {
    const userA = 'user-a'
    const userB = 'user-b'

    // Exhaust limit for user A
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check(createMockRequest({ userId: userA }))
    }
    const resultA = await rateLimiter.check(createMockRequest({ userId: userA }))
    expect(resultA.allowed).toBe(false)

    // User B should still have full quota
    const resultB = await rateLimiter.check(createMockRequest({ userId: userB }))
    expect(resultB.allowed).toBe(true)
  })

  it('should extract user from X-User-ID header', async () => {
    const request = createMockRequest({ userId: 'user-123' })
    const key = rateLimiter.getKeyForRequest(request)

    expect(key).toBe('user:user-123')
  })

  it('should use anonymous for unauthenticated users', async () => {
    const request = new Request('https://api.dotdo.dev/test', {
      method: 'GET',
      headers: new Headers({ 'CF-Connecting-IP': '192.168.1.1' }),
    })

    const key = rateLimiter.getKeyForRequest(request)
    expect(key).toBe('user:anonymous')
  })
})

// ============================================================================
// TESTS: COMBINED TENANT+USER RATE LIMITING
// ============================================================================

describe('Combined Tenant+User Rate Limiting', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))

    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant+user',
      tiers: {
        test: { name: 'test', requestsPerWindow: 3, windowMs: 60000 },
      },
      defaultTier: 'test',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should track limits per tenant+user combination', async () => {
    // Same tenant, same user - should be rate limited together
    for (let i = 0; i < 3; i++) {
      await rateLimiter.check(createMockRequest({ tenantId: 'acme', userId: 'user-1' }))
    }
    const result1 = await rateLimiter.check(createMockRequest({ tenantId: 'acme', userId: 'user-1' }))
    expect(result1.allowed).toBe(false)

    // Same tenant, different user - should have separate quota
    const result2 = await rateLimiter.check(createMockRequest({ tenantId: 'acme', userId: 'user-2' }))
    expect(result2.allowed).toBe(true)

    // Different tenant, same user - should have separate quota
    const result3 = await rateLimiter.check(createMockRequest({ tenantId: 'other', userId: 'user-1' }))
    expect(result3.allowed).toBe(true)
  })

  it('should generate unique keys for tenant+user combinations', async () => {
    const req1 = createMockRequest({ tenantId: 'acme', userId: 'user-1' })
    const req2 = createMockRequest({ tenantId: 'acme', userId: 'user-2' })
    const req3 = createMockRequest({ tenantId: 'other', userId: 'user-1' })

    const key1 = rateLimiter.getKeyForRequest(req1)
    const key2 = rateLimiter.getKeyForRequest(req2)
    const key3 = rateLimiter.getKeyForRequest(req3)

    expect(key1).not.toBe(key2)
    expect(key1).not.toBe(key3)
    expect(key2).not.toBe(key3)
  })
})

// ============================================================================
// TESTS: IP-BASED RATE LIMITING
// ============================================================================

describe('IP-Based Rate Limiting', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))

    rateLimiter = new RateLimiter({
      keyStrategy: 'ip',
      tiers: {
        test: { name: 'test', requestsPerWindow: 5, windowMs: 60000 },
      },
      defaultTier: 'test',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should track rate limits per IP independently', async () => {
    const ip1 = '192.168.1.1'
    const ip2 = '192.168.1.2'

    // Exhaust limit for IP1
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check(createMockRequest({ ip: ip1 }))
    }
    const result1 = await rateLimiter.check(createMockRequest({ ip: ip1 }))
    expect(result1.allowed).toBe(false)

    // IP2 should still have full quota
    const result2 = await rateLimiter.check(createMockRequest({ ip: ip2 }))
    expect(result2.allowed).toBe(true)
  })

  it('should extract IP from CF-Connecting-IP header', async () => {
    const request = createMockRequest({ ip: '203.0.113.50' })
    const key = rateLimiter.getKeyForRequest(request)

    expect(key).toBe('ip:203.0.113.50')
  })

  it('should fall back to X-Real-IP header', async () => {
    const request = new Request('https://api.dotdo.dev/test', {
      method: 'GET',
      headers: new Headers({
        'X-Real-IP': '198.51.100.25',
      }),
    })

    const key = rateLimiter.getKeyForRequest(request)
    expect(key).toBe('ip:198.51.100.25')
  })

  it('should fall back to X-Forwarded-For header', async () => {
    const request = new Request('https://api.dotdo.dev/test', {
      method: 'GET',
      headers: new Headers({
        'X-Forwarded-For': '198.51.100.30, 10.0.0.1',
      }),
    })

    const key = rateLimiter.getKeyForRequest(request)
    // Should use first IP in X-Forwarded-For chain
    expect(key).toBe('ip:198.51.100.30')
  })
})

// ============================================================================
// TESTS: SKIP PATHS
// ============================================================================

describe('Skip Paths', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should skip rate limiting for configured paths', async () => {
    const app = createTestApp({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 1, windowMs: 60000 },
      },
      defaultTier: 'test',
      skipPaths: ['/health'],
    })

    // First request to /api/test uses quota
    await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))

    // Second request to /api/test should be rate limited
    const rateLimitedRes = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))
    expect(rateLimitedRes.status).toBe(429)

    // Health endpoint should still work (skipped)
    const healthRes = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/health' }))
    expect(healthRes.status).toBe(200)
  })
})

// ============================================================================
// TESTS: ERROR HANDLING
// ============================================================================

describe('Error Handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should throw on invalid config (unknown default tier)', () => {
    expect(() => {
      new RateLimiter({
        keyStrategy: 'tenant',
        tiers: {
          known: { name: 'known', requestsPerWindow: 100, windowMs: 60000 },
        },
        defaultTier: 'unknown',
      })
    }).toThrow(/default tier/)
  })

  it('should fail open on storage errors by default', async () => {
    const rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      failOpen: true,
    })

    rateLimiter._simulateStorageFailure(true)

    const result = await rateLimiter.check(createMockRequest({ tenantId: 'acme' }))

    expect(result.allowed).toBe(true)
  })

  it('should fail closed on storage errors when configured', async () => {
    const rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      failOpen: false,
    })

    rateLimiter._simulateStorageFailure(true)

    const result = await rateLimiter.check(createMockRequest({ tenantId: 'acme' }))

    expect(result.allowed).toBe(false)
    expect(result.statusCode).toBe(429)
  })

  it('should handle missing IP gracefully', async () => {
    const rateLimiter = new RateLimiter({
      keyStrategy: 'ip',
    })

    const request = new Request('https://api.dotdo.dev/test', {
      method: 'GET',
    })

    const result = await rateLimiter.check(request)
    expect(result.allowed).toBe(true)
    expect(result.key).toBe('ip:unknown')
  })
})

// ============================================================================
// TESTS: RESET KEY
// ============================================================================

describe('Reset Key', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))

    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 3, windowMs: 60000 },
      },
      defaultTier: 'test',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should reset rate limit state for a key', async () => {
    const tenantId = 'acme'

    // Use quota
    for (let i = 0; i < 3; i++) {
      await rateLimiter.check(createMockRequest({ tenantId }))
    }

    // Should be rate limited
    let result = await rateLimiter.check(createMockRequest({ tenantId }))
    expect(result.allowed).toBe(false)

    // Reset
    await rateLimiter.resetKey('tenant:acme')

    // Should have full quota again
    result = await rateLimiter.check(createMockRequest({ tenantId }))
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2)
  })
})

// ============================================================================
// TESTS: OBSERVABILITY
// ============================================================================

describe('Observability', () => {
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))

    rateLimiter = new RateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 10, windowMs: 60000 },
      },
      defaultTier: 'test',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return current state for a key', async () => {
    const tenantId = 'acme'

    // Make some requests
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check(createMockRequest({ tenantId }))
    }

    const state = await rateLimiter.getState('tenant:acme')

    expect(state).toBeDefined()
    expect(state!.requests).toBe(5)
    expect(state!.limit).toBe(10)
    expect(state!.windowMs).toBe(60000)
  })

  it('should return null for unknown key', async () => {
    const state = await rateLimiter.getState('tenant:unknown')
    expect(state).toBeNull()
  })

  it('should include key and tier in result', async () => {
    const result = await rateLimiter.check(
      createMockRequest({ tenantId: 'acme' }),
      { tier: 'test' }
    )

    expect(result.key).toBe('tenant:acme')
    expect(result.tier).toBe('test')
  })
})

// ============================================================================
// TESTS: MIDDLEWARE INTEGRATION
// ============================================================================

describe('Middleware Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should create middleware with default config', () => {
    const middleware = rateLimitMiddleware({ keyStrategy: 'tenant' })
    expect(middleware).toBeDefined()
    expect(typeof middleware).toBe('function')
  })

  it('should pass rate limit info to downstream handlers', async () => {
    const app = new Hono()

    app.use('*', rateLimitMiddleware({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
    }))

    app.get('/api/test', (c) => {
      const rateLimit = c.get('rateLimit')
      return c.json({
        remaining: rateLimit?.remaining,
        limit: rateLimit?.limit,
      })
    })

    const res = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))
    const body = await res.json() as { remaining: number; limit: number }

    expect(body.remaining).toBe(99)
    expect(body.limit).toBe(100)
  })
})
