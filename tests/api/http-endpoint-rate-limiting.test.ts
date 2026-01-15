/**
 * HTTP Endpoint Rate Limiting Tests - TDD RED Phase
 *
 * These tests define the expected behavior of rate limiting on HTTP query endpoints:
 * - /query (main query endpoint)
 * - /query/unified (unified query endpoint)
 * - /query/trace (trace query endpoint)
 * - /query/session (session query endpoint)
 *
 * Rate limiting requirements:
 * - Returns 429 when rate limit exceeded
 * - Per-IP rate limiting
 * - Per-tenant rate limiting
 * - Sliding window support
 * - Proper rate limit headers (X-RateLimit-*)
 * - Burst allowance for legitimate traffic spikes
 *
 * NOTE: These tests are designed to FAIL because the rate limiting
 * implementation for HTTP query endpoints does not exist yet.
 * This is the TDD RED phase.
 *
 * @see /api/query-router.ts - Query router without rate limiting
 * @see /api/middleware/rate-limit.ts - Base rate limit middleware
 * @module tests/api/http-endpoint-rate-limiting.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Import from query router to test integration
// This import will work but the rate limiting behavior won't exist yet
import queryRouter from '../../api/query-router'
import type { Env } from '../../api/types'

// Types for the HTTP rate limiter that doesn't exist yet (RED phase)
// These types define the expected interface
interface HTTPRateLimitConfig {
  requestsPerWindow: number
  windowMs: number
  keyStrategy?: 'ip' | 'tenant' | 'ip+tenant' | 'ip+endpoint'
  windowStrategy?: 'fixed' | 'sliding'
  burstCapacity?: number
  burstRefillRate?: number
  failOpen?: boolean
  endpointLimits?: Record<string, { requestsPerWindow: number; windowMs: number }>
}

interface HTTPRateLimitResult {
  allowed: boolean
  statusCode: number
  remaining: number
  windowResetsAt: number
  oldestRequestExpiresAt?: number
  headers: Record<string, string>
  error?: { code: string; message: string }
  retryAfterMs?: number
  burstState?: { tokens: number; capacity: number; refillRate: number }
  storageError?: boolean
}

interface HTTPEndpointRateLimiterClass {
  new (config: HTTPRateLimitConfig): HTTPEndpointRateLimiterInstance
}

interface HTTPEndpointRateLimiterInstance {
  check(request: Request): Promise<HTTPRateLimitResult>
  getKeyForRequest(request: Request): string
  getConfigForEndpoint(endpoint: string): HTTPRateLimitConfig
  applyHeaders(response: Response, result: HTTPRateLimitResult): Response
  getBurstState(key: string): Promise<{ tokens: number; capacity: number; refillRate: number }>
  resetKey(key: string): Promise<void>
  _simulateStorageFailure(fail: boolean): void
}

// These will be dynamically imported in tests - they don't exist yet (RED phase)
let HTTPEndpointRateLimiter: HTTPEndpointRateLimiterClass
let createEndpointRateLimiter: (config: HTTPRateLimitConfig) => HTTPEndpointRateLimiterInstance
let queryRateLimitMiddleware: (config?: HTTPRateLimitConfig) => unknown

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock environment for testing
 */
function createMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    KV: {} as KVNamespace,
    DO: {} as DurableObjectNamespace,
    BROWSER_DO: {} as DurableObjectNamespace,
    SANDBOX_DO: {} as DurableObjectNamespace,
    OBS_BROADCASTER: {} as DurableObjectNamespace,
    TEST_KV: {} as KVNamespace,
    TEST_DO: {} as DurableObjectNamespace,
    ASSETS: {} as Fetcher,
    ...overrides,
  } as Env
}

/**
 * Create a mock HTTP request with configurable IP and tenant
 */
function createMockRequest(options: {
  method?: string
  path?: string
  ip?: string
  tenant?: string
  body?: unknown
  headers?: Record<string, string>
}): Request {
  const {
    method = 'POST',
    path = '/query',
    ip = '192.168.1.1',
    tenant = 'default',
    body,
    headers = {},
  } = options

  const url = `https://${tenant}.api.dotdo.dev${path}`
  const init: RequestInit = {
    method,
    headers: new Headers({
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
      'X-Real-IP': ip,
      ...headers,
    }),
  }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  return new Request(url, init)
}

/**
 * Create multiple requests rapidly to trigger rate limiting
 */
async function makeRapidRequests(
  count: number,
  requestOptions: Parameters<typeof createMockRequest>[0],
  handler: (req: Request) => Promise<Response>
): Promise<Response[]> {
  const responses: Response[] = []
  for (let i = 0; i < count; i++) {
    const req = createMockRequest(requestOptions)
    const res = await handler(req)
    responses.push(res)
  }
  return responses
}

// ============================================================================
// TESTS: HTTP RATE LIMITER MODULE (RED PHASE - SHOULD FAIL)
// ============================================================================

describe('HTTPEndpointRateLimiter module', () => {
  it('should export HTTPEndpointRateLimiter class', async () => {
    // RED phase: This import will fail because the module doesn't exist
    const module = await import('../../api/middleware/query-rate-limit')
    expect(module.HTTPEndpointRateLimiter).toBeDefined()
    HTTPEndpointRateLimiter = module.HTTPEndpointRateLimiter
  })

  it('should export createEndpointRateLimiter factory', async () => {
    const module = await import('../../api/middleware/query-rate-limit')
    expect(module.createEndpointRateLimiter).toBeDefined()
    createEndpointRateLimiter = module.createEndpointRateLimiter
  })

  it('should export queryRateLimitMiddleware', async () => {
    const module = await import('../../api/middleware/query-rate-limit')
    expect(module.queryRateLimitMiddleware).toBeDefined()
    queryRateLimitMiddleware = module.queryRateLimitMiddleware
  })
})

// ============================================================================
// TESTS: RATE LIMIT EXCEEDED RETURNS 429 (RED PHASE)
// ============================================================================

describe('Rate limit exceeded returns 429', () => {
  let rateLimiter: HTTPEndpointRateLimiterInstance

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
    // Dynamic import - will fail because module doesn't exist (RED phase)
    const module = await import('../../api/middleware/query-rate-limit')
    HTTPEndpointRateLimiter = module.HTTPEndpointRateLimiter
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return 200 for requests under the limit', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 100,
      windowMs: 60000,
    })

    const request = createMockRequest({ path: '/query', ip: '192.168.1.1' })
    const result = await rateLimiter.check(request)

    expect(result.allowed).toBe(true)
    expect(result.statusCode).toBe(200)
  })

  it('should return 429 when rate limit exceeded', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 5,
      windowMs: 60000,
    })

    const ip = '192.168.1.100'

    // Make 5 requests (should all succeed)
    for (let i = 0; i < 5; i++) {
      const request = createMockRequest({ path: '/query', ip })
      const result = await rateLimiter.check(request)
      expect(result.allowed).toBe(true)
    }

    // 6th request should be rate limited
    const request = createMockRequest({ path: '/query', ip })
    const result = await rateLimiter.check(request)

    expect(result.allowed).toBe(false)
    expect(result.statusCode).toBe(429)
  })

  it('should return proper error body when rate limited', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 1,
      windowMs: 60000,
    })

    const ip = '192.168.1.200'

    // First request succeeds
    await rateLimiter.check(createMockRequest({ path: '/query', ip }))

    // Second request should be rate limited with proper error
    const request = createMockRequest({ path: '/query', ip })
    const result = await rateLimiter.check(request)

    expect(result.allowed).toBe(false)
    expect(result.statusCode).toBe(429)
    expect(result.error).toBeDefined()
    expect(result.error.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(result.error.message).toMatch(/rate limit/i)
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  it('should return 429 for /query endpoint when limit exceeded', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 2,
      windowMs: 60000,
    })

    const ip = '10.0.0.1'

    await rateLimiter.check(createMockRequest({ path: '/query', ip }))
    await rateLimiter.check(createMockRequest({ path: '/query', ip }))

    const result = await rateLimiter.check(createMockRequest({ path: '/query', ip }))
    expect(result.statusCode).toBe(429)
  })

  it('should return 429 for /query/unified endpoint when limit exceeded', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 2,
      windowMs: 60000,
    })

    const ip = '10.0.0.2'

    await rateLimiter.check(createMockRequest({ path: '/query/unified', ip }))
    await rateLimiter.check(createMockRequest({ path: '/query/unified', ip }))

    const result = await rateLimiter.check(createMockRequest({ path: '/query/unified', ip }))
    expect(result.statusCode).toBe(429)
  })

  it('should return 429 for /query/trace endpoint when limit exceeded', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 2,
      windowMs: 60000,
    })

    const ip = '10.0.0.3'

    await rateLimiter.check(createMockRequest({ path: '/query/trace', ip }))
    await rateLimiter.check(createMockRequest({ path: '/query/trace', ip }))

    const result = await rateLimiter.check(createMockRequest({ path: '/query/trace', ip }))
    expect(result.statusCode).toBe(429)
  })

  it('should return 429 for /query/session endpoint when limit exceeded', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 2,
      windowMs: 60000,
    })

    const ip = '10.0.0.4'

    await rateLimiter.check(createMockRequest({ path: '/query/session', ip }))
    await rateLimiter.check(createMockRequest({ path: '/query/session', ip }))

    const result = await rateLimiter.check(createMockRequest({ path: '/query/session', ip }))
    expect(result.statusCode).toBe(429)
  })
})

// ============================================================================
// TESTS: RATE LIMIT PER IP/TENANT (RED PHASE)
// ============================================================================

describe('Rate limit per IP/tenant', () => {
  let rateLimiter: HTTPEndpointRateLimiterInstance

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
    // Dynamic import - will fail because module doesn't exist (RED phase)
    const module = await import('../../api/middleware/query-rate-limit')
    HTTPEndpointRateLimiter = module.HTTPEndpointRateLimiter
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Per-IP rate limiting', () => {
    it('should track rate limits per IP independently', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 2,
        windowMs: 60000,
        keyStrategy: 'ip',
      })

      const ip1 = '192.168.1.1'
      const ip2 = '192.168.1.2'

      // Exhaust limit for IP1
      await rateLimiter.check(createMockRequest({ ip: ip1 }))
      await rateLimiter.check(createMockRequest({ ip: ip1 }))
      const result1 = await rateLimiter.check(createMockRequest({ ip: ip1 }))
      expect(result1.allowed).toBe(false)

      // IP2 should still have full quota
      const result2 = await rateLimiter.check(createMockRequest({ ip: ip2 }))
      expect(result2.allowed).toBe(true)
    })

    it('should extract IP from CF-Connecting-IP header', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 1,
        windowMs: 60000,
        keyStrategy: 'ip',
      })

      const request = createMockRequest({
        headers: { 'CF-Connecting-IP': '203.0.113.50' },
      })

      const result = await rateLimiter.check(request)
      const key = rateLimiter.getKeyForRequest(request)

      expect(key).toContain('203.0.113.50')
      expect(result.allowed).toBe(true)
    })

    it('should fall back to X-Real-IP header', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 1,
        windowMs: 60000,
        keyStrategy: 'ip',
      })

      const request = new Request('https://api.dotdo.dev/query', {
        method: 'POST',
        headers: new Headers({
          'Content-Type': 'application/json',
          'X-Real-IP': '198.51.100.25',
        }),
      })

      const key = rateLimiter.getKeyForRequest(request)
      expect(key).toContain('198.51.100.25')
    })

    it('should fall back to X-Forwarded-For header', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 1,
        windowMs: 60000,
        keyStrategy: 'ip',
      })

      const request = new Request('https://api.dotdo.dev/query', {
        method: 'POST',
        headers: new Headers({
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.30, 10.0.0.1',
        }),
      })

      const key = rateLimiter.getKeyForRequest(request)
      // Should use first IP in X-Forwarded-For chain
      expect(key).toContain('198.51.100.30')
    })
  })

  describe('Per-tenant rate limiting', () => {
    it('should track rate limits per tenant independently', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 2,
        windowMs: 60000,
        keyStrategy: 'tenant',
      })

      const tenantA = 'tenant-a'
      const tenantB = 'tenant-b'

      // Exhaust limit for tenant A
      await rateLimiter.check(createMockRequest({ tenant: tenantA }))
      await rateLimiter.check(createMockRequest({ tenant: tenantA }))
      const resultA = await rateLimiter.check(createMockRequest({ tenant: tenantA }))
      expect(resultA.allowed).toBe(false)

      // Tenant B should still have full quota
      const resultB = await rateLimiter.check(createMockRequest({ tenant: tenantB }))
      expect(resultB.allowed).toBe(true)
    })

    it('should extract tenant from hostname', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 1,
        windowMs: 60000,
        keyStrategy: 'tenant',
      })

      const request = new Request('https://acme-corp.api.dotdo.dev/query', {
        method: 'POST',
        headers: new Headers({
          'Content-Type': 'application/json',
        }),
      })

      const key = rateLimiter.getKeyForRequest(request)
      expect(key).toContain('acme-corp')
    })

    it('should extract tenant from X-Tenant-ID header', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 1,
        windowMs: 60000,
        keyStrategy: 'tenant',
      })

      const request = new Request('https://api.dotdo.dev/query', {
        method: 'POST',
        headers: new Headers({
          'Content-Type': 'application/json',
          'X-Tenant-ID': 'custom-tenant',
        }),
      })

      const key = rateLimiter.getKeyForRequest(request)
      expect(key).toContain('custom-tenant')
    })

    it('should fall back to default tenant if not specified', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 1,
        windowMs: 60000,
        keyStrategy: 'tenant',
      })

      const request = new Request('https://api.dotdo.dev/query', {
        method: 'POST',
        headers: new Headers({
          'Content-Type': 'application/json',
        }),
      })

      const key = rateLimiter.getKeyForRequest(request)
      expect(key).toContain('default')
    })
  })

  describe('Combined IP + tenant rate limiting', () => {
    it('should support combined IP and tenant limiting', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 2,
        windowMs: 60000,
        keyStrategy: 'ip+tenant',
      })

      const ip = '192.168.1.1'
      const tenant = 'tenant-x'

      // Same IP, same tenant - should be rate limited together
      await rateLimiter.check(createMockRequest({ ip, tenant }))
      await rateLimiter.check(createMockRequest({ ip, tenant }))
      const result1 = await rateLimiter.check(createMockRequest({ ip, tenant }))
      expect(result1.allowed).toBe(false)

      // Same IP, different tenant - should have separate quota
      const result2 = await rateLimiter.check(createMockRequest({ ip, tenant: 'tenant-y' }))
      expect(result2.allowed).toBe(true)

      // Different IP, same tenant - should have separate quota
      const result3 = await rateLimiter.check(createMockRequest({ ip: '192.168.1.2', tenant }))
      expect(result3.allowed).toBe(true)
    })

    it('should generate unique keys for IP+tenant combinations', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 10,
        windowMs: 60000,
        keyStrategy: 'ip+tenant',
      })

      const req1 = createMockRequest({ ip: '192.168.1.1', tenant: 'tenant-a' })
      const req2 = createMockRequest({ ip: '192.168.1.1', tenant: 'tenant-b' })
      const req3 = createMockRequest({ ip: '192.168.1.2', tenant: 'tenant-a' })

      const key1 = rateLimiter.getKeyForRequest(req1)
      const key2 = rateLimiter.getKeyForRequest(req2)
      const key3 = rateLimiter.getKeyForRequest(req3)

      expect(key1).not.toBe(key2)
      expect(key1).not.toBe(key3)
      expect(key2).not.toBe(key3)
    })
  })

  describe('Per-endpoint rate limiting', () => {
    it('should support different limits per endpoint', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 10,
        windowMs: 60000,
        keyStrategy: 'ip+endpoint',
        endpointLimits: {
          '/query': { requestsPerWindow: 100, windowMs: 60000 },
          '/query/trace': { requestsPerWindow: 20, windowMs: 60000 },
          '/query/session': { requestsPerWindow: 50, windowMs: 60000 },
        },
      })

      const ip = '192.168.1.1'

      // /query should have limit of 100
      const queryConfig = rateLimiter.getConfigForEndpoint('/query')
      expect(queryConfig.requestsPerWindow).toBe(100)

      // /query/trace should have limit of 20
      const traceConfig = rateLimiter.getConfigForEndpoint('/query/trace')
      expect(traceConfig.requestsPerWindow).toBe(20)
    })

    it('should track limits per endpoint independently', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 2,
        windowMs: 60000,
        keyStrategy: 'ip+endpoint',
      })

      const ip = '192.168.1.1'

      // Exhaust /query limit
      await rateLimiter.check(createMockRequest({ ip, path: '/query' }))
      await rateLimiter.check(createMockRequest({ ip, path: '/query' }))
      const result1 = await rateLimiter.check(createMockRequest({ ip, path: '/query' }))
      expect(result1.allowed).toBe(false)

      // /query/trace should still have full quota
      const result2 = await rateLimiter.check(createMockRequest({ ip, path: '/query/trace' }))
      expect(result2.allowed).toBe(true)
    })
  })
})

// ============================================================================
// TESTS: RATE LIMIT WINDOW SLIDING (RED PHASE)
// ============================================================================

describe('Rate limit window sliding', () => {
  let rateLimiter: HTTPEndpointRateLimiterInstance

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
    // Dynamic import - will fail because module doesn't exist (RED phase)
    const module = await import('../../api/middleware/query-rate-limit')
    HTTPEndpointRateLimiter = module.HTTPEndpointRateLimiter
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Fixed window', () => {
    it('should reset count after window expires', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 2,
        windowMs: 60000,
        windowStrategy: 'fixed',
      })

      const ip = '192.168.1.1'

      // Exhaust limit
      await rateLimiter.check(createMockRequest({ ip }))
      await rateLimiter.check(createMockRequest({ ip }))
      const blocked = await rateLimiter.check(createMockRequest({ ip }))
      expect(blocked.allowed).toBe(false)

      // Advance time past window
      await vi.advanceTimersByTimeAsync(61000)

      // Should now be allowed
      const allowed = await rateLimiter.check(createMockRequest({ ip }))
      expect(allowed.allowed).toBe(true)
    })

    it('should restore full quota after window reset', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 3,
        windowMs: 60000,
        windowStrategy: 'fixed',
      })

      const ip = '192.168.1.1'

      // Use all quota
      for (let i = 0; i < 3; i++) {
        await rateLimiter.check(createMockRequest({ ip }))
      }

      // Advance past window
      await vi.advanceTimersByTimeAsync(61000)

      // Should have full quota again
      const results = []
      for (let i = 0; i < 3; i++) {
        results.push(await rateLimiter.check(createMockRequest({ ip })))
      }

      expect(results.every(r => r.allowed)).toBe(true)
    })
  })

  describe('Sliding window', () => {
    it('should use sliding window when configured', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 10,
        windowMs: 60000,
        windowStrategy: 'sliding',
      })

      const ip = '192.168.1.1'

      // Make 5 requests at T=0
      for (let i = 0; i < 5; i++) {
        await rateLimiter.check(createMockRequest({ ip }))
      }

      // Advance 30 seconds
      await vi.advanceTimersByTimeAsync(30000)

      // Make 5 more requests at T=30s
      for (let i = 0; i < 5; i++) {
        await rateLimiter.check(createMockRequest({ ip }))
      }

      // Should now be at limit (10 requests in 60s window)
      const blocked = await rateLimiter.check(createMockRequest({ ip }))
      expect(blocked.allowed).toBe(false)

      // Advance 31 more seconds (T=61s, first 5 requests should expire)
      await vi.advanceTimersByTimeAsync(31000)

      // Should now have 5 slots available
      const allowed = await rateLimiter.check(createMockRequest({ ip }))
      expect(allowed.allowed).toBe(true)
    })

    it('should gradually release quota in sliding window', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 6,
        windowMs: 60000,
        windowStrategy: 'sliding',
      })

      const ip = '192.168.1.1'

      // Make requests at different times
      await rateLimiter.check(createMockRequest({ ip })) // T=0
      await vi.advanceTimersByTimeAsync(10000)
      await rateLimiter.check(createMockRequest({ ip })) // T=10s
      await vi.advanceTimersByTimeAsync(10000)
      await rateLimiter.check(createMockRequest({ ip })) // T=20s
      await vi.advanceTimersByTimeAsync(10000)
      await rateLimiter.check(createMockRequest({ ip })) // T=30s
      await vi.advanceTimersByTimeAsync(10000)
      await rateLimiter.check(createMockRequest({ ip })) // T=40s
      await vi.advanceTimersByTimeAsync(10000)
      await rateLimiter.check(createMockRequest({ ip })) // T=50s

      // At T=50s, we have 6 requests in last 60s - should be at limit
      const blockedAt50 = await rateLimiter.check(createMockRequest({ ip }))
      expect(blockedAt50.allowed).toBe(false)

      // Advance to T=61s - first request (T=0) should expire
      await vi.advanceTimersByTimeAsync(11000)
      const allowedAt61 = await rateLimiter.check(createMockRequest({ ip }))
      expect(allowedAt61.allowed).toBe(true)
    })
  })

  describe('Window reset timing', () => {
    it('should report accurate reset time in fixed window', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 5,
        windowMs: 60000,
        windowStrategy: 'fixed',
      })

      const ip = '192.168.1.1'
      const result = await rateLimiter.check(createMockRequest({ ip }))

      expect(result.windowResetsAt).toBeDefined()
      // Reset should be approximately 60s from now
      const resetIn = result.windowResetsAt - Date.now()
      expect(resetIn).toBeGreaterThan(0)
      expect(resetIn).toBeLessThanOrEqual(60000)
    })

    it('should report accurate reset time in sliding window', async () => {
      rateLimiter = new HTTPEndpointRateLimiter({
        requestsPerWindow: 5,
        windowMs: 60000,
        windowStrategy: 'sliding',
      })

      const ip = '192.168.1.1'

      // Make a request
      await rateLimiter.check(createMockRequest({ ip }))

      // Advance 30 seconds and make another request
      await vi.advanceTimersByTimeAsync(30000)
      const result = await rateLimiter.check(createMockRequest({ ip }))

      // In sliding window, should report when oldest request expires
      expect(result.oldestRequestExpiresAt).toBeDefined()
    })
  })
})

// ============================================================================
// TESTS: RATE LIMIT HEADERS IN RESPONSE (RED PHASE)
// ============================================================================

describe('Rate limit headers in response', () => {
  let rateLimiter: HTTPEndpointRateLimiterInstance

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
    // Dynamic import - will fail because module doesn't exist (RED phase)
    const module = await import('../../api/middleware/query-rate-limit')
    HTTPEndpointRateLimiter = module.HTTPEndpointRateLimiter
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return X-RateLimit-Limit header', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 100,
      windowMs: 60000,
    })

    const request = createMockRequest({})
    const result = await rateLimiter.check(request)

    expect(result.headers['X-RateLimit-Limit']).toBe('100')
  })

  it('should return X-RateLimit-Remaining header', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 100,
      windowMs: 60000,
    })

    const ip = '192.168.1.1'

    // First request
    let result = await rateLimiter.check(createMockRequest({ ip }))
    expect(result.headers['X-RateLimit-Remaining']).toBe('99')

    // Second request
    result = await rateLimiter.check(createMockRequest({ ip }))
    expect(result.headers['X-RateLimit-Remaining']).toBe('98')
  })

  it('should return X-RateLimit-Reset header with Unix timestamp', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 100,
      windowMs: 60000,
    })

    const request = createMockRequest({})
    const result = await rateLimiter.check(request)

    const resetTime = parseInt(result.headers['X-RateLimit-Reset'], 10)
    expect(resetTime).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(resetTime).toBeLessThanOrEqual(Math.floor((Date.now() + 60000) / 1000))
  })

  it('should return Retry-After header when rate limited', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 1,
      windowMs: 60000,
    })

    const ip = '192.168.1.1'

    // Use up limit
    await rateLimiter.check(createMockRequest({ ip }))

    // Rate limited response
    const result = await rateLimiter.check(createMockRequest({ ip }))

    expect(result.allowed).toBe(false)
    expect(result.headers['Retry-After']).toBeDefined()

    const retryAfter = parseInt(result.headers['Retry-After'], 10)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(60)
  })

  it('should return X-RateLimit-Policy header', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 100,
      windowMs: 60000,
    })

    const request = createMockRequest({})
    const result = await rateLimiter.check(request)

    expect(result.headers['X-RateLimit-Policy']).toBeDefined()
    // Should contain rate and window info
    expect(result.headers['X-RateLimit-Policy']).toMatch(/100/)
    expect(result.headers['X-RateLimit-Policy']).toMatch(/60/)
  })

  it('should provide helper to apply headers to Response', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 100,
      windowMs: 60000,
    })

    const request = createMockRequest({})
    const result = await rateLimiter.check(request)

    const response = new Response('OK', { status: 200 })
    const responseWithHeaders = rateLimiter.applyHeaders(response, result)

    expect(responseWithHeaders.headers.get('X-RateLimit-Limit')).toBe('100')
    expect(responseWithHeaders.headers.get('X-RateLimit-Remaining')).toBeDefined()
    expect(responseWithHeaders.headers.get('X-RateLimit-Reset')).toBeDefined()
  })

  it('should include all standard rate limit headers', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 100,
      windowMs: 60000,
    })

    const request = createMockRequest({})
    const result = await rateLimiter.check(request)

    const requiredHeaders = [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ]

    for (const header of requiredHeaders) {
      expect(result.headers[header]).toBeDefined()
    }
  })
})

// ============================================================================
// TESTS: BURST ALLOWANCE (RED PHASE)
// ============================================================================

describe('Burst allowance', () => {
  let rateLimiter: HTTPEndpointRateLimiterInstance

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
    // Dynamic import - will fail because module doesn't exist (RED phase)
    const module = await import('../../api/middleware/query-rate-limit')
    HTTPEndpointRateLimiter = module.HTTPEndpointRateLimiter
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should allow burst up to configured capacity', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 60, // 1 per second average
      windowMs: 60000,
      burstCapacity: 20, // Allow burst of 20
    })

    const ip = '192.168.1.1'
    const results = []

    // Should allow 20 requests instantly (burst)
    for (let i = 0; i < 20; i++) {
      results.push(await rateLimiter.check(createMockRequest({ ip })))
    }

    expect(results.every(r => r.allowed)).toBe(true)
  })

  it('should reject requests exceeding burst capacity', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 60,
      windowMs: 60000,
      burstCapacity: 10,
    })

    const ip = '192.168.1.1'

    // Use burst capacity
    for (let i = 0; i < 10; i++) {
      await rateLimiter.check(createMockRequest({ ip }))
    }

    // 11th request should be rejected
    const result = await rateLimiter.check(createMockRequest({ ip }))
    expect(result.allowed).toBe(false)
  })

  it('should refill burst tokens over time', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 60,
      windowMs: 60000,
      burstCapacity: 10,
      burstRefillRate: 1, // 1 token per second
    })

    const ip = '192.168.1.1'

    // Drain burst capacity
    for (let i = 0; i < 10; i++) {
      await rateLimiter.check(createMockRequest({ ip }))
    }

    // Should be blocked
    let result = await rateLimiter.check(createMockRequest({ ip }))
    expect(result.allowed).toBe(false)

    // Wait 5 seconds - should refill 5 tokens
    await vi.advanceTimersByTimeAsync(5000)

    // Should now allow 5 more requests
    for (let i = 0; i < 5; i++) {
      result = await rateLimiter.check(createMockRequest({ ip }))
      expect(result.allowed).toBe(true)
    }

    // 6th should fail
    result = await rateLimiter.check(createMockRequest({ ip }))
    expect(result.allowed).toBe(false)
  })

  it('should not exceed burst capacity on refill', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 60,
      windowMs: 60000,
      burstCapacity: 10,
      burstRefillRate: 1,
    })

    const ip = '192.168.1.1'

    // Wait long time without making requests
    await vi.advanceTimersByTimeAsync(120000)

    // Should still only have 10 tokens (capacity)
    const state = await rateLimiter.getBurstState(ip)
    expect(state.tokens).toBe(10)
  })

  it('should report burst state in result', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 60,
      windowMs: 60000,
      burstCapacity: 10,
      burstRefillRate: 1,
    })

    const ip = '192.168.1.1'

    // Use some burst tokens
    for (let i = 0; i < 5; i++) {
      await rateLimiter.check(createMockRequest({ ip }))
    }

    const result = await rateLimiter.check(createMockRequest({ ip }))

    expect(result.burstState).toBeDefined()
    expect(result.burstState.tokens).toBe(4) // 10 - 6 = 4
    expect(result.burstState.capacity).toBe(10)
    expect(result.burstState.refillRate).toBe(1)
  })
})

// ============================================================================
// TESTS: INTEGRATION WITH QUERY ROUTER (RED PHASE)
// ============================================================================

describe('Integration with Query Router', () => {
  let env: Env

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
    env = createMockEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should apply rate limiting middleware to query router', async () => {
    // This test verifies the query router has rate limiting integrated
    const request = createMockRequest({
      path: '/query',
      ip: '192.168.1.1',
      body: { sql: 'SELECT 1' },
    })

    // Make many requests to trigger rate limiting
    const responses = []
    for (let i = 0; i < 150; i++) {
      const req = createMockRequest({
        path: '/query',
        ip: '192.168.1.1',
        body: { sql: 'SELECT 1' },
      })
      const response = await queryRouter.fetch(req, env)
      responses.push(response)
    }

    // At least one response should be 429
    const rateLimitedResponses = responses.filter(r => r.status === 429)
    expect(rateLimitedResponses.length).toBeGreaterThan(0)
  })

  it('should include rate limit headers in query responses', async () => {
    const request = createMockRequest({
      path: '/query',
      body: { sql: 'SELECT 1' },
    })

    const response = await queryRouter.fetch(request, env)

    expect(response.headers.get('X-RateLimit-Limit')).toBeDefined()
    expect(response.headers.get('X-RateLimit-Remaining')).toBeDefined()
    expect(response.headers.get('X-RateLimit-Reset')).toBeDefined()
  })

  it('should return proper 429 response body', async () => {
    // Configure very low limit for testing
    const responses = []
    for (let i = 0; i < 1000; i++) {
      const request = createMockRequest({
        path: '/query',
        ip: '192.168.1.1',
        body: { sql: 'SELECT 1' },
      })
      const response = await queryRouter.fetch(request, env)
      responses.push(response)
    }

    // Find a 429 response
    const rateLimitedResponse = responses.find(r => r.status === 429)
    expect(rateLimitedResponse).toBeDefined()

    if (rateLimitedResponse) {
      const body = await rateLimitedResponse.json() as { error: string; code: string; retryAfter: number }
      expect(body.error).toMatch(/rate limit/i)
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED')
      expect(body.retryAfter).toBeGreaterThan(0)
    }
  })
})

// ============================================================================
// TESTS: MIDDLEWARE CREATION (RED PHASE)
// ============================================================================

describe('queryRateLimitMiddleware', () => {
  beforeEach(async () => {
    // Dynamic import - will fail because module doesn't exist (RED phase)
    const module = await import('../../api/middleware/query-rate-limit')
    queryRateLimitMiddleware = module.queryRateLimitMiddleware
  })

  it('should create middleware with default config', () => {
    const middleware = queryRateLimitMiddleware()
    expect(middleware).toBeDefined()
    expect(typeof middleware).toBe('function')
  })

  it('should create middleware with custom config', () => {
    const middleware = queryRateLimitMiddleware({
      requestsPerWindow: 500,
      windowMs: 300000,
      keyStrategy: 'tenant',
    })
    expect(middleware).toBeDefined()
  })

  it('should create middleware with endpoint-specific limits', () => {
    const middleware = queryRateLimitMiddleware({
      requestsPerWindow: 100,
      windowMs: 60000,
      endpointLimits: {
        '/query': { requestsPerWindow: 200, windowMs: 60000 },
        '/query/trace': { requestsPerWindow: 50, windowMs: 60000 },
      },
    })
    expect(middleware).toBeDefined()
  })

  it('middleware should call next when under limit', async () => {
    const middleware = queryRateLimitMiddleware({
      requestsPerWindow: 100,
      windowMs: 60000,
    })

    const mockNext = vi.fn()
    const mockContext = {
      req: {
        raw: createMockRequest({ path: '/query' }),
        header: (name: string) => {
          if (name === 'CF-Connecting-IP') return '192.168.1.1'
          return null
        },
        path: '/query',
      },
      set: vi.fn(),
      header: vi.fn(),
    }

    // @ts-expect-error - mock context
    await middleware(mockContext, mockNext)

    expect(mockNext).toHaveBeenCalled()
  })

  it('middleware should return 429 when over limit', async () => {
    const middleware = queryRateLimitMiddleware({
      requestsPerWindow: 1,
      windowMs: 60000,
    })

    const mockNext = vi.fn()
    const mockJson = vi.fn().mockReturnValue(new Response())
    const mockContext = {
      req: {
        raw: createMockRequest({ path: '/query' }),
        header: (name: string) => {
          if (name === 'CF-Connecting-IP') return '192.168.1.1'
          return null
        },
        path: '/query',
      },
      set: vi.fn(),
      header: vi.fn(),
      json: mockJson,
    }

    // First request succeeds
    // @ts-expect-error - mock context
    await middleware(mockContext, mockNext)
    expect(mockNext).toHaveBeenCalledTimes(1)

    // Second request rate limited
    mockNext.mockClear()
    // @ts-expect-error - mock context
    await middleware(mockContext, mockNext)

    expect(mockNext).not.toHaveBeenCalled()
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('rate limit'),
      }),
      429
    )
  })
})

// ============================================================================
// TESTS: ERROR HANDLING AND EDGE CASES (RED PHASE)
// ============================================================================

describe('Error handling and edge cases', () => {
  let rateLimiter: HTTPEndpointRateLimiterInstance

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
    // Dynamic import - will fail because module doesn't exist (RED phase)
    const module = await import('../../api/middleware/query-rate-limit')
    HTTPEndpointRateLimiter = module.HTTPEndpointRateLimiter
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should handle missing IP gracefully', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 100,
      windowMs: 60000,
      keyStrategy: 'ip',
    })

    const request = new Request('https://api.dotdo.dev/query', {
      method: 'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
    })

    // Should use fallback (unknown IP)
    const result = await rateLimiter.check(request)
    expect(result.allowed).toBe(true)
  })

  it('should handle concurrent requests correctly', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 10,
      windowMs: 60000,
    })

    const ip = '192.168.1.1'

    // Fire 20 concurrent requests
    const promises = Array(20)
      .fill(null)
      .map(() => rateLimiter.check(createMockRequest({ ip })))

    const results = await Promise.all(promises)

    const allowed = results.filter(r => r.allowed).length
    const blocked = results.filter(r => !r.allowed).length

    expect(allowed).toBe(10)
    expect(blocked).toBe(10)
  })

  it('should validate config on construction', () => {
    expect(() => {
      new HTTPEndpointRateLimiter({
        requestsPerWindow: -1,
        windowMs: 60000,
      })
    }).toThrow(/invalid/i)

    expect(() => {
      new HTTPEndpointRateLimiter({
        requestsPerWindow: 100,
        windowMs: 0,
      })
    }).toThrow(/invalid/i)
  })

  it('should handle storage errors gracefully (fail open)', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 100,
      windowMs: 60000,
      failOpen: true,
    })

    // Simulate storage failure
    rateLimiter._simulateStorageFailure(true)

    const result = await rateLimiter.check(createMockRequest({}))

    // Should allow (fail open)
    expect(result.allowed).toBe(true)
    expect(result.storageError).toBe(true)
  })

  it('should handle storage errors gracefully (fail closed)', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 100,
      windowMs: 60000,
      failOpen: false,
    })

    // Simulate storage failure
    rateLimiter._simulateStorageFailure(true)

    const result = await rateLimiter.check(createMockRequest({}))

    // Should block (fail closed)
    expect(result.allowed).toBe(false)
    expect(result.storageError).toBe(true)
  })

  it('should handle very large limits', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: Number.MAX_SAFE_INTEGER,
      windowMs: 60000,
    })

    const request = createMockRequest({})
    const result = await rateLimiter.check(request)

    expect(result.allowed).toBe(true)
  })

  it('should handle special characters in IP addresses', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 100,
      windowMs: 60000,
      keyStrategy: 'ip',
    })

    // IPv6 address
    const request = createMockRequest({
      headers: { 'CF-Connecting-IP': '2001:0db8:85a3:0000:0000:8a2e:0370:7334' },
    })

    const result = await rateLimiter.check(request)
    expect(result.allowed).toBe(true)
  })

  it('should reset state for a specific key', async () => {
    rateLimiter = new HTTPEndpointRateLimiter({
      requestsPerWindow: 2,
      windowMs: 60000,
    })

    const ip = '192.168.1.1'

    // Use quota
    await rateLimiter.check(createMockRequest({ ip }))
    await rateLimiter.check(createMockRequest({ ip }))

    // Reset
    await rateLimiter.resetKey(ip)

    // Should have full quota again
    const result = await rateLimiter.check(createMockRequest({ ip }))
    expect(result.allowed).toBe(true)
    expect(result.headers['X-RateLimit-Remaining']).toBe('1')
  })
})
