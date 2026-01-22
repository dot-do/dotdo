/**
 * Tests for RPC Rate Limiting
 * @issue do-dp5q.5 - Add rate limiting to RPC endpoints
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  RPCRateLimiter,
  rpcRateLimitMiddleware,
  createRPCRateLimiter,
  DEFAULT_RPC_TIERS,
  type RPCRateLimitConfig,
} from '../rate-limit'
import { Hono } from 'hono'

describe('RPCRateLimiter', () => {
  let rateLimiter: RPCRateLimiter

  beforeEach(() => {
    rateLimiter = new RPCRateLimiter()
  })

  describe('basic rate limiting', () => {
    it('should allow requests within limit', () => {
      const request = new Request('http://test.com/rpc', {
        headers: { 'X-RPC-Client-ID': 'client-1' },
      })

      const result = rateLimiter.check(request, 'users.list')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(99) // Default is 100 per minute
      expect(result.limit).toBe(100)
    })

    it('should block requests exceeding limit', () => {
      const request = new Request('http://test.com/rpc', {
        headers: { 'X-RPC-Client-ID': 'client-2' },
      })

      // Use a low limit config for testing
      rateLimiter = new RPCRateLimiter({
        defaultTier: {
          name: 'test',
          requestsPerWindow: 3,
          windowMs: 60000,
        },
      })

      // Exhaust the limit
      rateLimiter.check(request, 'users.list')
      rateLimiter.check(request, 'users.list')
      rateLimiter.check(request, 'users.list')

      // This should be blocked
      const result = rateLimiter.check(request, 'users.list')

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.retryAfter).toBeGreaterThan(0)
      expect(result.headers['Retry-After']).toBeDefined()
    })

    it('should track different methods separately', () => {
      const request = new Request('http://test.com/rpc', {
        headers: { 'X-RPC-Client-ID': 'client-3' },
      })

      rateLimiter = new RPCRateLimiter({
        defaultTier: {
          name: 'test',
          requestsPerWindow: 2,
          windowMs: 60000,
        },
      })

      // Exhaust limit for method A
      rateLimiter.check(request, 'users.list')
      rateLimiter.check(request, 'users.list')
      const blockedA = rateLimiter.check(request, 'users.list')

      // Method B should still work
      const allowedB = rateLimiter.check(request, 'posts.list')

      expect(blockedA.allowed).toBe(false)
      expect(allowedB.allowed).toBe(true)
    })
  })

  describe('per-endpoint rate limits', () => {
    it('should apply per-method limits when configured', () => {
      const request = new Request('http://test.com/rpc', {
        headers: { 'X-RPC-Client-ID': 'client-4' },
      })

      rateLimiter = new RPCRateLimiter({
        methods: {
          'ai.generate': { requestsPerWindow: 2, windowMs: 60000 },
        },
        defaultTier: {
          name: 'test',
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      // ai.generate has stricter limit
      rateLimiter.check(request, 'ai.generate')
      rateLimiter.check(request, 'ai.generate')
      const blocked = rateLimiter.check(request, 'ai.generate')

      // Other methods still have high limit
      const allowed = rateLimiter.check(request, 'users.list')

      expect(blocked.allowed).toBe(false)
      expect(blocked.limit).toBe(2)
      expect(allowed.allowed).toBe(true)
      expect(allowed.limit).toBe(100)
    })

    it('should apply pattern-based limits', () => {
      const request = new Request('http://test.com/rpc', {
        headers: { 'X-RPC-Client-ID': 'client-5' },
      })

      rateLimiter = new RPCRateLimiter({
        patterns: {
          'admin.*': { requestsPerWindow: 5, windowMs: 60000 },
        },
        defaultTier: {
          name: 'test',
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const adminResult = rateLimiter.check(request, 'admin.deleteUser')
      const userResult = rateLimiter.check(request, 'users.list')

      expect(adminResult.limit).toBe(5)
      expect(userResult.limit).toBe(100)
    })
  })

  describe('per-user/tenant rate limits', () => {
    it('should apply per-user limits', () => {
      rateLimiter = new RPCRateLimiter({
        userLimit: { requestsPerWindow: 5, windowMs: 60000 },
        defaultTier: {
          name: 'test',
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = new Request('http://test.com/rpc', {
        headers: {
          'X-RPC-Client-ID': 'client-6',
          'X-User-ID': 'user-123',
        },
      })

      // Exhaust user limit
      for (let i = 0; i < 5; i++) {
        rateLimiter.check(request, `method${i}`)
      }

      // Should be blocked by user limit even though method limit is not reached
      const result = rateLimiter.check(request, 'another.method')

      expect(result.allowed).toBe(false)
      expect(result.headers['X-RateLimit-User-Limit']).toBeDefined()
    })

    it('should apply per-tenant limits', () => {
      rateLimiter = new RPCRateLimiter({
        tenantLimit: { requestsPerWindow: 10, windowMs: 60000 },
        defaultTier: {
          name: 'test',
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = new Request('http://test.com/rpc', {
        headers: {
          'X-RPC-Client-ID': 'client-7',
          'X-Tenant-ID': 'tenant-abc',
        },
      })

      // Exhaust tenant limit
      for (let i = 0; i < 10; i++) {
        rateLimiter.check(request, `method${i}`)
      }

      // Should be blocked by tenant limit
      const result = rateLimiter.check(request, 'another.method')

      expect(result.allowed).toBe(false)
      expect(result.headers['X-RateLimit-Tenant-Limit']).toBeDefined()
    })

    it('should check tenant before user limits', () => {
      rateLimiter = new RPCRateLimiter({
        tenantLimit: { requestsPerWindow: 3, windowMs: 60000 },
        userLimit: { requestsPerWindow: 10, windowMs: 60000 },
        defaultTier: {
          name: 'test',
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = new Request('http://test.com/rpc', {
        headers: {
          'X-RPC-Client-ID': 'client-8',
          'X-User-ID': 'user-456',
          'X-Tenant-ID': 'tenant-xyz',
        },
      })

      // Make 3 requests to hit tenant limit
      rateLimiter.check(request, 'method1')
      rateLimiter.check(request, 'method2')
      rateLimiter.check(request, 'method3')

      // Should be blocked by tenant limit (stricter)
      const result = rateLimiter.check(request, 'method4')

      expect(result.allowed).toBe(false)
      // Tenant limit kicks in first
      expect(result.headers['X-RateLimit-Tenant-Limit']).toBe('3')
    })

    it('should use custom user/tenant extractors', () => {
      rateLimiter = new RPCRateLimiter({
        userLimit: { requestsPerWindow: 2, windowMs: 60000 },
        userExtractor: (request) => {
          const auth = request.headers.get('Authorization')
          return auth ? auth.replace('Bearer ', '') : null
        },
      })

      const request = new Request('http://test.com/rpc', {
        headers: {
          'X-RPC-Client-ID': 'client-9',
          Authorization: 'Bearer custom-user-token',
        },
      })

      rateLimiter.check(request, 'method1')
      rateLimiter.check(request, 'method2')
      const result = rateLimiter.check(request, 'method3')

      expect(result.allowed).toBe(false)
    })
  })

  describe('configurable windows and thresholds', () => {
    it('should respect custom window duration', async () => {
      rateLimiter = new RPCRateLimiter({
        defaultTier: {
          name: 'short',
          requestsPerWindow: 2,
          windowMs: 100, // Very short window for testing
        },
      })

      const request = new Request('http://test.com/rpc', {
        headers: { 'X-RPC-Client-ID': 'client-10' },
      })

      rateLimiter.check(request, 'test')
      rateLimiter.check(request, 'test')
      const blocked = rateLimiter.check(request, 'test')

      expect(blocked.allowed).toBe(false)

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      const allowed = rateLimiter.check(request, 'test')
      expect(allowed.allowed).toBe(true)
    })

    it('should use tier resolver for dynamic limits', () => {
      const tierResolver = vi.fn((userId: string | null, tenantId: string | null) => {
        if (tenantId === 'enterprise-tenant') {
          return DEFAULT_RPC_TIERS['enterprise']!
        }
        if (userId === 'premium-user') {
          return DEFAULT_RPC_TIERS['pro']!
        }
        return null
      })

      rateLimiter = new RPCRateLimiter({
        tierResolver,
        defaultTier: DEFAULT_RPC_TIERS['free']!,
      })

      const enterpriseRequest = new Request('http://test.com/rpc', {
        headers: {
          'X-RPC-Client-ID': 'client-11',
          'X-Tenant-ID': 'enterprise-tenant',
        },
      })

      const freeRequest = new Request('http://test.com/rpc', {
        headers: { 'X-RPC-Client-ID': 'client-12' },
      })

      const enterpriseResult = rateLimiter.check(enterpriseRequest, 'test')
      const freeResult = rateLimiter.check(freeRequest, 'test')

      expect(enterpriseResult.limit).toBe(10000) // Enterprise tier
      expect(freeResult.limit).toBe(100) // Free tier
      expect(tierResolver).toHaveBeenCalled()
    })
  })

  describe('proper 429 responses with Retry-After', () => {
    it('should include Retry-After header when rate limited', () => {
      rateLimiter = new RPCRateLimiter({
        defaultTier: {
          name: 'test',
          requestsPerWindow: 1,
          windowMs: 60000,
        },
      })

      const request = new Request('http://test.com/rpc', {
        headers: { 'X-RPC-Client-ID': 'client-13' },
      })

      rateLimiter.check(request, 'test')
      const result = rateLimiter.check(request, 'test')

      expect(result.allowed).toBe(false)
      expect(result.retryAfter).toBeGreaterThan(0)
      expect(result.retryAfter).toBeLessThanOrEqual(60) // Within window
      expect(result.headers['Retry-After']).toBe(String(result.retryAfter))
    })

    it('should include all rate limit headers', () => {
      const request = new Request('http://test.com/rpc', {
        headers: { 'X-RPC-Client-ID': 'client-14' },
      })

      const result = rateLimiter.check(request, 'test')

      expect(result.headers['X-RateLimit-Limit']).toBeDefined()
      expect(result.headers['X-RateLimit-Remaining']).toBeDefined()
      expect(result.headers['X-RateLimit-Reset']).toBeDefined()
    })
  })

  describe('skip methods', () => {
    it('should skip rate limiting for specified methods', () => {
      rateLimiter = new RPCRateLimiter({
        skipMethods: ['health.check', 'system.status'],
        defaultTier: {
          name: 'test',
          requestsPerWindow: 1,
          windowMs: 60000,
        },
      })

      const request = new Request('http://test.com/rpc', {
        headers: { 'X-RPC-Client-ID': 'client-15' },
      })

      // These should always be allowed
      const health1 = rateLimiter.check(request, 'health.check')
      const health2 = rateLimiter.check(request, 'health.check')
      const health3 = rateLimiter.check(request, 'health.check')

      expect(health1.allowed).toBe(true)
      expect(health2.allowed).toBe(true)
      expect(health3.allowed).toBe(true)
      expect(health1.remaining).toBe(Infinity)
    })
  })

  describe('reset methods', () => {
    it('should reset state for a specific key', () => {
      const request = new Request('http://test.com/rpc', {
        headers: { 'X-RPC-Client-ID': 'client-16' },
      })

      rateLimiter = new RPCRateLimiter({
        defaultTier: {
          name: 'test',
          requestsPerWindow: 2,
          windowMs: 60000,
        },
      })

      rateLimiter.check(request, 'test')
      rateLimiter.check(request, 'test')
      const blocked = rateLimiter.check(request, 'test')
      expect(blocked.allowed).toBe(false)

      // Reset the key
      rateLimiter.resetKey('client:client-16:test')

      const allowed = rateLimiter.check(request, 'test')
      expect(allowed.allowed).toBe(true)
    })

    it('should reset user state', () => {
      rateLimiter = new RPCRateLimiter({
        userLimit: { requestsPerWindow: 2, windowMs: 60000 },
      })

      const request = new Request('http://test.com/rpc', {
        headers: {
          'X-RPC-Client-ID': 'client-17',
          'X-User-ID': 'user-to-reset',
        },
      })

      rateLimiter.check(request, 'method1')
      rateLimiter.check(request, 'method2')
      const blocked = rateLimiter.check(request, 'method3')
      expect(blocked.allowed).toBe(false)

      rateLimiter.resetUser('user-to-reset')

      const allowed = rateLimiter.check(request, 'method4')
      expect(allowed.allowed).toBe(true)
    })

    it('should reset tenant state', () => {
      rateLimiter = new RPCRateLimiter({
        tenantLimit: { requestsPerWindow: 2, windowMs: 60000 },
      })

      const request = new Request('http://test.com/rpc', {
        headers: {
          'X-RPC-Client-ID': 'client-18',
          'X-Tenant-ID': 'tenant-to-reset',
        },
      })

      rateLimiter.check(request, 'method1')
      rateLimiter.check(request, 'method2')
      const blocked = rateLimiter.check(request, 'method3')
      expect(blocked.allowed).toBe(false)

      rateLimiter.resetTenant('tenant-to-reset')

      const allowed = rateLimiter.check(request, 'method4')
      expect(allowed.allowed).toBe(true)
    })

    it('should reset all state', () => {
      const request = new Request('http://test.com/rpc', {
        headers: { 'X-RPC-Client-ID': 'client-19' },
      })

      rateLimiter = new RPCRateLimiter({
        defaultTier: {
          name: 'test',
          requestsPerWindow: 1,
          windowMs: 60000,
        },
      })

      rateLimiter.check(request, 'test')
      rateLimiter.reset()

      const result = rateLimiter.check(request, 'test')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(0) // Just made a request
    })
  })

  describe('state observability', () => {
    it('should return state for a key', () => {
      const request = new Request('http://test.com/rpc', {
        headers: { 'X-RPC-Client-ID': 'client-20' },
      })

      rateLimiter.check(request, 'test')
      rateLimiter.check(request, 'test')

      const state = rateLimiter.getState('client:client-20:test')

      expect(state).not.toBeNull()
      expect(state?.requests).toBe(2)
    })

    it('should return user state', () => {
      rateLimiter = new RPCRateLimiter({
        userLimit: { requestsPerWindow: 10, windowMs: 60000 },
      })

      const request = new Request('http://test.com/rpc', {
        headers: {
          'X-RPC-Client-ID': 'client-21',
          'X-User-ID': 'observable-user',
        },
      })

      rateLimiter.check(request, 'method1')
      rateLimiter.check(request, 'method2')
      rateLimiter.check(request, 'method3')

      const state = rateLimiter.getUserState('observable-user')

      expect(state).not.toBeNull()
      expect(state?.requests).toBe(3)
      expect(state?.limit).toBe(10)
    })

    it('should return tenant state', () => {
      rateLimiter = new RPCRateLimiter({
        tenantLimit: { requestsPerWindow: 20, windowMs: 60000 },
      })

      const request = new Request('http://test.com/rpc', {
        headers: {
          'X-RPC-Client-ID': 'client-22',
          'X-Tenant-ID': 'observable-tenant',
        },
      })

      rateLimiter.check(request, 'method1')
      rateLimiter.check(request, 'method2')

      const state = rateLimiter.getTenantState('observable-tenant')

      expect(state).not.toBeNull()
      expect(state?.requests).toBe(2)
      expect(state?.limit).toBe(20)
    })
  })

  describe('IP extraction', () => {
    it('should extract IP from CF-Connecting-IP', () => {
      const request = new Request('http://test.com/rpc', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      })

      const result = rateLimiter.check(request, 'test')
      expect(result.key).toContain('1.2.3.4')
    })

    it('should extract IP from X-Real-IP', () => {
      const request = new Request('http://test.com/rpc', {
        headers: { 'X-Real-IP': '5.6.7.8' },
      })

      const result = rateLimiter.check(request, 'test')
      expect(result.key).toContain('5.6.7.8')
    })

    it('should extract IP from X-Forwarded-For', () => {
      const request = new Request('http://test.com/rpc', {
        headers: { 'X-Forwarded-For': '9.10.11.12, 13.14.15.16' },
      })

      const result = rateLimiter.check(request, 'test')
      expect(result.key).toContain('9.10.11.12')
    })

    it('should use unknown when no IP headers present', () => {
      const request = new Request('http://test.com/rpc')

      const result = rateLimiter.check(request, 'test')
      expect(result.key).toContain('unknown')
    })
  })
})

describe('rpcRateLimitMiddleware', () => {
  it('should apply rate limiting to RPC endpoints', async () => {
    const app = new Hono()
    const middleware = rpcRateLimitMiddleware({
      defaultTier: {
        name: 'test',
        requestsPerWindow: 2,
        windowMs: 60000,
      },
    })

    app.use('/rpc/*', middleware)
    app.post('/rpc', (c) => c.json({ success: true }))

    // First two requests should succeed
    const res1 = await app.request('/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RPC-Client-ID': 'test-client',
      },
      body: JSON.stringify({ method: 'users.list', args: [] }),
    })

    const res2 = await app.request('/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RPC-Client-ID': 'test-client',
      },
      body: JSON.stringify({ method: 'users.list', args: [] }),
    })

    // Third request should be rate limited
    const res3 = await app.request('/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RPC-Client-ID': 'test-client',
      },
      body: JSON.stringify({ method: 'users.list', args: [] }),
    })

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    expect(res3.status).toBe(429)

    const errorBody = await res3.json()
    expect(errorBody.code).toBe('RATE_LIMIT')
    expect(res3.headers.get('Retry-After')).toBeDefined()
  })

  it('should skip non-POST requests', async () => {
    const app = new Hono()
    const middleware = rpcRateLimitMiddleware({
      defaultTier: {
        name: 'test',
        requestsPerWindow: 1,
        windowMs: 60000,
      },
    })

    app.use('/rpc/*', middleware)
    app.get('/rpc', (c) => c.json({ status: 'ok' }))

    const res = await app.request('/rpc', { method: 'GET' })

    expect(res.status).toBe(200)
  })

  it('should continue on invalid JSON body', async () => {
    const app = new Hono()
    const middleware = rpcRateLimitMiddleware()

    app.use('/rpc/*', middleware)
    app.post('/rpc', (c) => c.json({ success: true }))

    const res = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json',
    })

    // Should continue to handler (which may or may not handle invalid JSON)
    expect(res.status).not.toBe(429)
  })

  it('should store rate limit info in context', async () => {
    let storedRateLimit: unknown
    const app = new Hono()
    const middleware = rpcRateLimitMiddleware()

    app.use('/rpc/*', middleware)
    app.post('/rpc', (c) => {
      storedRateLimit = c.get('rateLimit')
      return c.json({ success: true })
    })

    await app.request('/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RPC-Client-ID': 'context-test',
      },
      body: JSON.stringify({ method: 'test', args: [] }),
    })

    expect(storedRateLimit).toBeDefined()
    expect((storedRateLimit as { allowed: boolean }).allowed).toBe(true)
  })
})

describe('createRPCRateLimiter', () => {
  it('should create a rate limiter instance', () => {
    const limiter = createRPCRateLimiter({
      global: {
        name: 'custom',
        requestsPerWindow: 500,
        windowMs: 30000,
      },
    })

    expect(limiter).toBeInstanceOf(RPCRateLimiter)

    const request = new Request('http://test.com/rpc', {
      headers: { 'X-RPC-Client-ID': 'factory-test' },
    })

    const result = limiter.check(request, 'test')
    expect(result.limit).toBe(500)
  })
})

describe('DEFAULT_RPC_TIERS', () => {
  it('should have free tier', () => {
    expect(DEFAULT_RPC_TIERS['free']).toBeDefined()
    expect(DEFAULT_RPC_TIERS['free']?.requestsPerWindow).toBe(100)
    expect(DEFAULT_RPC_TIERS['free']?.windowMs).toBe(60000)
  })

  it('should have pro tier', () => {
    expect(DEFAULT_RPC_TIERS['pro']).toBeDefined()
    expect(DEFAULT_RPC_TIERS['pro']?.requestsPerWindow).toBe(1000)
  })

  it('should have enterprise tier', () => {
    expect(DEFAULT_RPC_TIERS['enterprise']).toBeDefined()
    expect(DEFAULT_RPC_TIERS['enterprise']?.requestsPerWindow).toBe(10000)
  })
})
