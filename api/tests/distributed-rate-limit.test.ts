/**
 * Distributed Rate Limiting Tests
 *
 * Tests for the distributed rate limiter that uses Durable Objects for state storage.
 * This ensures rate limits work correctly across multiple worker instances.
 *
 * @module api/tests/distributed-rate-limit.test
 * @issue do-h6df - Rate limiter state not distributed across workers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import {
  DistributedRateLimiter,
  distributedRateLimitMiddleware,
  createDistributedRateLimiter,
  DEFAULT_TIERS,
  type DistributedRateLimitConfig,
  type RateLimiterDONamespace,
  type RateLimiterDOStub,
} from '../middleware/rate-limit'
import type { RateLimitCheckResult } from '../middleware/RateLimiterDO'

// ============================================================================
// MOCK DO INFRASTRUCTURE
// ============================================================================

/**
 * Mock RateLimiterDO that simulates distributed state
 *
 * This mock allows testing the distributed rate limiter without actual DO infrastructure.
 * It maintains state in memory but behaves like the real DO.
 */
class MockRateLimiterDO implements RateLimiterDOStub {
  private slidingWindows: Map<string, { requests: number[] }> = new Map()
  private fixedWindows: Map<string, { count: number; windowStart: number }> = new Map()

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/check' && request.method === 'POST') {
      const params = await request.json() as {
        key: string
        windowMs: number
        limit: number
        windowStrategy: 'sliding' | 'fixed'
      }
      const result = this.check(params)
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (path === '/reset' && request.method === 'POST') {
      const { key } = await request.json() as { key: string }
      this.reset(key)
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (path.startsWith('/state/') && request.method === 'GET') {
      const key = decodeURIComponent(path.slice(7))
      const state = this.getState(key)
      return new Response(JSON.stringify(state ?? { found: false }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ status: 'ok', type: 'MockRateLimiterDO' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private check(params: {
    key: string
    windowMs: number
    limit: number
    windowStrategy: 'sliding' | 'fixed'
  }): RateLimitCheckResult {
    const { key, windowMs, limit, windowStrategy } = params
    const now = Date.now()

    if (windowStrategy === 'sliding') {
      return this.checkSlidingWindow(key, windowMs, limit, now)
    } else {
      return this.checkFixedWindow(key, windowMs, limit, now)
    }
  }

  private checkSlidingWindow(
    key: string,
    windowMs: number,
    limit: number,
    now: number
  ): RateLimitCheckResult {
    let state = this.slidingWindows.get(key)

    if (!state) {
      state = { requests: [] }
      this.slidingWindows.set(key, state)
    }

    // Remove expired requests
    const cutoff = now - windowMs
    state.requests = state.requests.filter((ts) => ts > cutoff)

    const firstRequest = state.requests[0]
    const resetAt = firstRequest !== undefined
      ? Math.ceil((firstRequest + windowMs) / 1000)
      : Math.ceil((now + windowMs) / 1000)

    // Check if over limit
    if (state.requests.length >= limit) {
      const oldestRequestTime = state.requests[0] ?? now
      const retryAfterMs = oldestRequestTime + windowMs - now

      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterMs,
      }
    }

    // Add this request
    state.requests.push(now)
    const remaining = Math.max(0, limit - state.requests.length)

    return {
      allowed: true,
      remaining,
      resetAt,
    }
  }

  private checkFixedWindow(
    key: string,
    windowMs: number,
    limit: number,
    now: number
  ): RateLimitCheckResult {
    let state = this.fixedWindows.get(key)

    // Reset window if expired or doesn't exist
    if (!state || now >= state.windowStart + windowMs) {
      state = { count: 0, windowStart: now }
      this.fixedWindows.set(key, state)
    }

    const resetAt = Math.ceil((state.windowStart + windowMs) / 1000)

    // Check if over limit
    if (state.count >= limit) {
      const retryAfterMs = state.windowStart + windowMs - now

      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterMs,
      }
    }

    // Increment count
    state.count++
    const remaining = Math.max(0, limit - state.count)

    return {
      allowed: true,
      remaining,
      resetAt,
    }
  }

  private reset(key: string): void {
    this.slidingWindows.delete(key)
    this.fixedWindows.delete(key)
  }

  private getState(key: string): { requests: number; found: boolean } | null {
    const slidingState = this.slidingWindows.get(key)
    if (slidingState) {
      return { requests: slidingState.requests.length, found: true }
    }

    const fixedState = this.fixedWindows.get(key)
    if (fixedState) {
      return { requests: fixedState.count, found: true }
    }

    return null
  }
}

/**
 * Create a mock DO namespace for testing
 */
function createMockDONamespace(): RateLimiterDONamespace {
  const instances = new Map<string, MockRateLimiterDO>()

  return {
    idFromName(name: string) {
      return { toString: () => name }
    },
    get(id: { toString(): string }) {
      const name = id.toString()
      if (!instances.has(name)) {
        instances.set(name, new MockRateLimiterDO())
      }
      return instances.get(name)!
    },
  }
}

/**
 * Create a mock request
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
 * Create a Hono app with distributed rate limiting middleware
 */
function createTestApp(config: DistributedRateLimitConfig) {
  const app = new Hono()

  app.use('*', distributedRateLimitMiddleware(config))

  app.get('/api/test', (c) => c.json({ message: 'ok' }))
  app.post('/api/data', (c) => c.json({ created: true }))
  app.get('/health', (c) => c.json({ status: 'healthy' }))

  return app
}

// ============================================================================
// TESTS: DISTRIBUTED RATE LIMITER CLASS
// ============================================================================

describe('DistributedRateLimiter', () => {
  let mockDONamespace: RateLimiterDONamespace

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
    mockDONamespace = createMockDONamespace()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should create a distributed rate limiter', () => {
    const rateLimiter = new DistributedRateLimiter({
      keyStrategy: 'tenant',
      rateLimiterDO: mockDONamespace,
    })

    expect(rateLimiter).toBeDefined()
  })

  it('should allow requests under the limit', async () => {
    const rateLimiter = new DistributedRateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
      rateLimiterDO: mockDONamespace,
    })

    const request = createMockRequest({ tenantId: 'acme' })
    const result = await rateLimiter.check(request)

    expect(result.allowed).toBe(true)
    expect(result.statusCode).toBe(200)
    expect(result.remaining).toBe(99)
  })

  it('should return 429 when rate limit exceeded', async () => {
    const rateLimiter = new DistributedRateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 5, windowMs: 60000 },
      },
      defaultTier: 'test',
      rateLimiterDO: mockDONamespace,
    })

    const tenantId = 'acme'

    // Make 5 requests (should all succeed)
    for (let i = 0; i < 5; i++) {
      const result = await rateLimiter.check(createMockRequest({ tenantId }))
      expect(result.allowed).toBe(true)
    }

    // 6th request should be rate limited
    const result = await rateLimiter.check(createMockRequest({ tenantId }))

    expect(result.allowed).toBe(false)
    expect(result.statusCode).toBe(429)
    expect(result.remaining).toBe(0)
  })

  it('should share state across multiple limiter instances (simulating multiple workers)', async () => {
    // Create two rate limiters sharing the same DO namespace (simulates two workers)
    const rateLimiter1 = new DistributedRateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 5, windowMs: 60000 },
      },
      defaultTier: 'test',
      rateLimiterDO: mockDONamespace, // Same namespace
    })

    const rateLimiter2 = new DistributedRateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 5, windowMs: 60000 },
      },
      defaultTier: 'test',
      rateLimiterDO: mockDONamespace, // Same namespace
    })

    const tenantId = 'acme'

    // Make 3 requests via worker 1
    for (let i = 0; i < 3; i++) {
      await rateLimiter1.check(createMockRequest({ tenantId }))
    }

    // Make 2 requests via worker 2
    for (let i = 0; i < 2; i++) {
      await rateLimiter2.check(createMockRequest({ tenantId }))
    }

    // 6th request via either worker should be blocked (state is shared)
    const result1 = await rateLimiter1.check(createMockRequest({ tenantId }))
    expect(result1.allowed).toBe(false)
    expect(result1.statusCode).toBe(429)

    const result2 = await rateLimiter2.check(createMockRequest({ tenantId }))
    expect(result2.allowed).toBe(false)
    expect(result2.statusCode).toBe(429)
  })

  it('should track different tenants independently', async () => {
    const rateLimiter = new DistributedRateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 5, windowMs: 60000 },
      },
      defaultTier: 'test',
      rateLimiterDO: mockDONamespace,
    })

    // Exhaust tenant A's quota
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check(createMockRequest({ tenantId: 'tenant-a' }))
    }
    const resultA = await rateLimiter.check(createMockRequest({ tenantId: 'tenant-a' }))
    expect(resultA.allowed).toBe(false)

    // Tenant B should still have full quota
    const resultB = await rateLimiter.check(createMockRequest({ tenantId: 'tenant-b' }))
    expect(resultB.allowed).toBe(true)
    expect(resultB.remaining).toBe(4)
  })

  it('should reset quota after window expires', async () => {
    const rateLimiter = new DistributedRateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 3, windowMs: 60000 },
      },
      defaultTier: 'test',
      windowStrategy: 'sliding',
      rateLimiterDO: mockDONamespace,
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

    // Should now be allowed
    result = await rateLimiter.check(createMockRequest({ tenantId }))
    expect(result.allowed).toBe(true)
  })

  it('should include proper rate limit headers', async () => {
    const rateLimiter = new DistributedRateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
      rateLimiterDO: mockDONamespace,
    })

    const result = await rateLimiter.check(createMockRequest({ tenantId: 'acme' }))

    expect(result.headers['X-RateLimit-Limit']).toBe('100')
    expect(result.headers['X-RateLimit-Remaining']).toBe('99')
    expect(result.headers['X-RateLimit-Reset']).toBeDefined()
  })

  it('should include Retry-After header when rate limited', async () => {
    const rateLimiter = new DistributedRateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 1, windowMs: 60000 },
      },
      defaultTier: 'test',
      rateLimiterDO: mockDONamespace,
    })

    const tenantId = 'acme'

    // Use up quota
    await rateLimiter.check(createMockRequest({ tenantId }))

    // Next request should be rate limited with Retry-After
    const result = await rateLimiter.check(createMockRequest({ tenantId }))

    expect(result.allowed).toBe(false)
    expect(result.headers['Retry-After']).toBeDefined()
    expect(parseInt(result.headers['Retry-After'], 10)).toBeGreaterThan(0)
  })

  it('should reset key via DO', async () => {
    const rateLimiter = new DistributedRateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 3, windowMs: 60000 },
      },
      defaultTier: 'test',
      rateLimiterDO: mockDONamespace,
    })

    const tenantId = 'acme'

    // Exhaust limit
    for (let i = 0; i < 3; i++) {
      await rateLimiter.check(createMockRequest({ tenantId }))
    }

    // Should be blocked
    let result = await rateLimiter.check(createMockRequest({ tenantId }))
    expect(result.allowed).toBe(false)

    // Reset key
    await rateLimiter.resetKey('tenant:acme')

    // Should have full quota again
    result = await rateLimiter.check(createMockRequest({ tenantId }))
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2)
  })

  it('should get state from DO', async () => {
    const rateLimiter = new DistributedRateLimiter({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 10, windowMs: 60000 },
      },
      defaultTier: 'test',
      rateLimiterDO: mockDONamespace,
    })

    const tenantId = 'acme'

    // Make some requests
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check(createMockRequest({ tenantId }))
    }

    const state = await rateLimiter.getState('tenant:acme')

    expect(state).toBeDefined()
    expect(state!.requests).toBe(5)
    expect(state!.limit).toBe(10)
  })

  it('should fail open on DO communication error by default', async () => {
    // Create a namespace that throws errors
    const failingNamespace: RateLimiterDONamespace = {
      idFromName: (name: string) => ({ toString: () => name }),
      get: () => ({
        fetch: async () => {
          throw new Error('DO unavailable')
        },
      }),
    }

    const rateLimiter = new DistributedRateLimiter({
      keyStrategy: 'tenant',
      failOpen: true,
      rateLimiterDO: failingNamespace,
    })

    const result = await rateLimiter.check(createMockRequest({ tenantId: 'acme' }))

    expect(result.allowed).toBe(true)
  })

  it('should fail closed on DO communication error when configured', async () => {
    // Create a namespace that throws errors
    const failingNamespace: RateLimiterDONamespace = {
      idFromName: (name: string) => ({ toString: () => name }),
      get: () => ({
        fetch: async () => {
          throw new Error('DO unavailable')
        },
      }),
    }

    const rateLimiter = new DistributedRateLimiter({
      keyStrategy: 'tenant',
      failOpen: false,
      rateLimiterDO: failingNamespace,
    })

    const result = await rateLimiter.check(createMockRequest({ tenantId: 'acme' }))

    expect(result.allowed).toBe(false)
    expect(result.statusCode).toBe(429)
  })
})

// ============================================================================
// TESTS: DISTRIBUTED MIDDLEWARE
// ============================================================================

describe('distributedRateLimitMiddleware', () => {
  let mockDONamespace: RateLimiterDONamespace

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
    mockDONamespace = createMockDONamespace()
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
      rateLimiterDO: mockDONamespace,
    })

    // First two requests succeed
    let res = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))
    expect(res.status).toBe(200)

    res = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))
    expect(res.status).toBe(200)

    // Third request should be rate limited
    res = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))
    expect(res.status).toBe(429)
  })

  it('should include rate limit headers in response', async () => {
    const app = createTestApp({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
      rateLimiterDO: mockDONamespace,
    })

    const res = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))

    expect(res.headers.get('X-RateLimit-Limit')).toBe('100')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('99')
    expect(res.headers.get('X-RateLimit-Reset')).toBeDefined()
  })

  it('should skip rate limiting for configured paths', async () => {
    const app = createTestApp({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 1, windowMs: 60000 },
      },
      defaultTier: 'test',
      skipPaths: ['/health'],
      rateLimiterDO: mockDONamespace,
    })

    // Use up quota on /api/test
    await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))

    // /api/test should be rate limited
    const rateLimitedRes = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/api/test' }))
    expect(rateLimitedRes.status).toBe(429)

    // /health should still work (skipped)
    const healthRes = await app.fetch(createMockRequest({ tenantId: 'acme', path: '/health' }))
    expect(healthRes.status).toBe(200)
  })
})

// ============================================================================
// TESTS: FACTORY FUNCTION
// ============================================================================

describe('createDistributedRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should create a distributed rate limiter via factory', () => {
    const mockDONamespace = createMockDONamespace()
    const rateLimiter = createDistributedRateLimiter({
      keyStrategy: 'tenant',
      rateLimiterDO: mockDONamespace,
    })

    expect(rateLimiter).toBeInstanceOf(DistributedRateLimiter)
  })
})
