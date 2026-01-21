/**
 * @file rate-limit-headers.test.ts
 * @description Tests for standard rate limit response headers
 *
 * Issue: do-hgzdx
 *
 * Tests for:
 * - Legacy X-RateLimit-* headers (backward compatibility)
 * - Standard RateLimit-* headers (IETF draft)
 * - RateLimit-Policy header
 * - CORS exposure of rate limit headers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { RateLimiter, rateLimitMiddleware } from '../middleware/rate-limit'
import { createAPI } from '../app'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockRequest(options: {
  tenantId?: string
  ip?: string
}): Request {
  const { tenantId, ip = '192.168.1.1' } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'CF-Connecting-IP': ip,
  }

  if (tenantId) {
    headers['X-Tenant-ID'] = tenantId
  }

  return new Request('https://api.dotdo.dev/test', {
    method: 'GET',
    headers: new Headers(headers),
  })
}

// ============================================================================
// TESTS: STANDARD RATE LIMIT HEADERS
// ============================================================================

describe('Standard Rate Limit Headers (IETF draft)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('RateLimiter class headers', () => {
    it('should include RateLimit-Limit header', async () => {
      const rateLimiter = new RateLimiter({
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
        },
        defaultTier: 'test',
      })

      const result = await rateLimiter.check(createMockRequest({ tenantId: 'acme' }))

      expect(result.headers['RateLimit-Limit']).toBe('100')
    })

    it('should include RateLimit-Remaining header', async () => {
      const rateLimiter = new RateLimiter({
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
        },
        defaultTier: 'test',
      })

      const result = await rateLimiter.check(createMockRequest({ tenantId: 'acme' }))

      expect(result.headers['RateLimit-Remaining']).toBe('99')
    })

    it('should include RateLimit-Reset header with seconds until reset', async () => {
      const rateLimiter = new RateLimiter({
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
        },
        defaultTier: 'test',
      })

      const result = await rateLimiter.check(createMockRequest({ tenantId: 'acme' }))

      // RateLimit-Reset should be seconds until reset, not Unix timestamp
      const resetSeconds = parseInt(result.headers['RateLimit-Reset']!, 10)
      expect(resetSeconds).toBeGreaterThanOrEqual(0)
      expect(resetSeconds).toBeLessThanOrEqual(60)
    })

    it('should include RateLimit-Policy header with limit and window', async () => {
      const rateLimiter = new RateLimiter({
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
        },
        defaultTier: 'test',
      })

      const result = await rateLimiter.check(createMockRequest({ tenantId: 'acme' }))

      // Policy format: "limit;w=window_seconds" (e.g., "100;w=60")
      expect(result.headers['RateLimit-Policy']).toBe('100;w=60')
    })

    it('should use correct window duration in policy header', async () => {
      const rateLimiter = new RateLimiter({
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 500, windowMs: 3600000 }, // 1 hour
        },
        defaultTier: 'test',
      })

      const result = await rateLimiter.check(createMockRequest({ tenantId: 'acme' }))

      // Should be "500;w=3600" for 500 requests per hour
      expect(result.headers['RateLimit-Policy']).toBe('500;w=3600')
    })
  })

  describe('Both legacy and standard headers', () => {
    it('should include both X-RateLimit-* and RateLimit-* headers', async () => {
      const rateLimiter = new RateLimiter({
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
        },
        defaultTier: 'test',
      })

      const result = await rateLimiter.check(createMockRequest({ tenantId: 'acme' }))

      // Legacy headers
      expect(result.headers['X-RateLimit-Limit']).toBeDefined()
      expect(result.headers['X-RateLimit-Remaining']).toBeDefined()
      expect(result.headers['X-RateLimit-Reset']).toBeDefined()

      // Standard headers
      expect(result.headers['RateLimit-Limit']).toBeDefined()
      expect(result.headers['RateLimit-Remaining']).toBeDefined()
      expect(result.headers['RateLimit-Reset']).toBeDefined()
      expect(result.headers['RateLimit-Policy']).toBeDefined()
    })

    it('should have matching values for limit and remaining', async () => {
      const rateLimiter = new RateLimiter({
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
        },
        defaultTier: 'test',
      })

      const result = await rateLimiter.check(createMockRequest({ tenantId: 'acme' }))

      // Limit should match
      expect(result.headers['X-RateLimit-Limit']).toBe(result.headers['RateLimit-Limit'])

      // Remaining should match
      expect(result.headers['X-RateLimit-Remaining']).toBe(result.headers['RateLimit-Remaining'])
    })
  })

  describe('Rate limited responses', () => {
    it('should include all headers when rate limited', async () => {
      const rateLimiter = new RateLimiter({
        keyStrategy: 'tenant',
        tiers: {
          test: { name: 'test', requestsPerWindow: 1, windowMs: 60000 },
        },
        defaultTier: 'test',
      })

      // Exhaust limit
      await rateLimiter.check(createMockRequest({ tenantId: 'acme' }))

      // Should be rate limited
      const result = await rateLimiter.check(createMockRequest({ tenantId: 'acme' }))

      expect(result.allowed).toBe(false)

      // Should have all headers even when rate limited
      expect(result.headers['RateLimit-Limit']).toBe('1')
      expect(result.headers['RateLimit-Remaining']).toBe('0')
      expect(result.headers['RateLimit-Reset']).toBeDefined()
      expect(result.headers['RateLimit-Policy']).toBe('1;w=60')
      expect(result.headers['Retry-After']).toBeDefined()
    })
  })
})

describe('CORS Header Exposure', () => {
  it('should expose standard rate limit headers in CORS', async () => {
    const api = createAPI()

    // OPTIONS request to get CORS headers
    const res = await api.request('http://localhost/', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'GET',
      },
    })

    const exposedHeaders = res.headers.get('Access-Control-Expose-Headers')
    expect(exposedHeaders).toContain('RateLimit-Limit')
    expect(exposedHeaders).toContain('RateLimit-Remaining')
    expect(exposedHeaders).toContain('RateLimit-Reset')
    expect(exposedHeaders).toContain('RateLimit-Policy')
  })

  it('should expose legacy rate limit headers in CORS', async () => {
    const api = createAPI()

    const res = await api.request('http://localhost/', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'GET',
      },
    })

    const exposedHeaders = res.headers.get('Access-Control-Expose-Headers')
    expect(exposedHeaders).toContain('X-RateLimit-Limit')
    expect(exposedHeaders).toContain('X-RateLimit-Remaining')
    expect(exposedHeaders).toContain('X-RateLimit-Reset')
    expect(exposedHeaders).toContain('Retry-After')
  })
})

describe('Middleware Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should set all rate limit headers on response', async () => {
    const app = new Hono()

    app.use('*', rateLimitMiddleware({
      keyStrategy: 'ip',
      tiers: {
        test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
      },
      defaultTier: 'test',
    }))

    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.fetch(new Request('http://localhost/test', {
      headers: { 'CF-Connecting-IP': '192.168.1.1' },
    }))

    expect(res.status).toBe(200)

    // Legacy headers
    expect(res.headers.get('X-RateLimit-Limit')).toBe('100')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('99')
    expect(res.headers.get('X-RateLimit-Reset')).toBeDefined()

    // Standard headers
    expect(res.headers.get('RateLimit-Limit')).toBe('100')
    expect(res.headers.get('RateLimit-Remaining')).toBe('99')
    expect(res.headers.get('RateLimit-Reset')).toBeDefined()
    expect(res.headers.get('RateLimit-Policy')).toBe('100;w=60')
  })

  it('should include Retry-After only when rate limited', async () => {
    const app = new Hono()

    app.use('*', rateLimitMiddleware({
      keyStrategy: 'ip',
      tiers: {
        test: { name: 'test', requestsPerWindow: 1, windowMs: 60000 },
      },
      defaultTier: 'test',
    }))

    app.get('/test', (c) => c.json({ ok: true }))

    // First request - should NOT have Retry-After
    const res1 = await app.fetch(new Request('http://localhost/test', {
      headers: { 'CF-Connecting-IP': '192.168.1.1' },
    }))

    expect(res1.status).toBe(200)
    expect(res1.headers.get('Retry-After')).toBeNull()

    // Second request - should have Retry-After
    const res2 = await app.fetch(new Request('http://localhost/test', {
      headers: { 'CF-Connecting-IP': '192.168.1.1' },
    }))

    expect(res2.status).toBe(429)
    expect(res2.headers.get('Retry-After')).toBeDefined()
    expect(parseInt(res2.headers.get('Retry-After')!, 10)).toBeGreaterThan(0)
  })
})
