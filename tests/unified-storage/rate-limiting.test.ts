/**
 * Rate Limiting Tests - TDD RED Phase
 *
 * These tests define the expected behavior of per-tenant rate limiting
 * in the unified storage layer. Rate limiting enables:
 * - Per-namespace/tenant request limits
 * - Different limits for reads vs writes
 * - Token bucket algorithm with burst allowance
 * - Rate limit headers in responses
 * - Admin overrides for specific tenants
 * - Rate limit metrics for monitoring
 * - Configurable window strategies
 *
 * NOTE: These tests are designed to FAIL because the implementation
 * does not exist yet. This is the TDD RED phase.
 *
 * @see /objects/unified-storage/rate-limiter.ts (to be created in GREEN phase)
 * @see /docs/architecture/unified-storage.md for rate limiting architecture
 * @module tests/unified-storage/rate-limiting.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import from non-existent module - this will cause tests to fail
import {
  TenantRateLimiter,
  type TenantRateLimitConfig,
  type RateLimitResult,
  type RateLimitMetrics,
  type TokenBucketState,
  type RateLimitHeaders,
  type TenantOverride,
  type WindowStrategy,
} from '../../objects/unified-storage/rate-limiter'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock storage adapter for rate limit state
 */
const createMockStorage = (initialState: Record<string, TokenBucketState> = {}) => {
  const state = new Map<string, TokenBucketState>(Object.entries(initialState))

  return {
    get: vi.fn((key: string) => state.get(key)),
    set: vi.fn((key: string, value: TokenBucketState) => state.set(key, value)),
    delete: vi.fn((key: string) => state.delete(key)),
    keys: vi.fn(() => Array.from(state.keys())),
    clear: vi.fn(() => state.clear()),
    _state: state,
  }
}

type MockStorage = ReturnType<typeof createMockStorage>

/**
 * Mock metrics collector
 */
const createMockMetricsCollector = () => {
  const metrics: RateLimitMetrics[] = []

  return {
    record: vi.fn((metric: RateLimitMetrics) => metrics.push(metric)),
    getMetrics: vi.fn(() => [...metrics]),
    clear: vi.fn(() => metrics.length = 0),
    getByTenant: vi.fn((tenant: string) => metrics.filter(m => m.tenant === tenant)),
    _metrics: metrics,
  }
}

type MockMetricsCollector = ReturnType<typeof createMockMetricsCollector>

/**
 * Create a mock HTTP request
 */
const createMockRequest = (options: {
  method?: string
  path?: string
  tenant?: string
  userId?: string
  headers?: Record<string, string>
} = {}) => {
  const {
    method = 'GET',
    path = '/',
    tenant = 'default',
    userId = 'user-123',
    headers = {},
  } = options

  return {
    method,
    url: `https://${tenant}.api.dotdo.dev${path}`,
    headers: {
      get: vi.fn((name: string) => headers[name.toLowerCase()]),
      ...headers,
    },
    tenant,
    userId,
  }
}

type MockRequest = ReturnType<typeof createMockRequest>

// ============================================================================
// TESTS
// ============================================================================

describe('TenantRateLimiter', () => {
  let mockStorage: MockStorage
  let mockMetrics: MockMetricsCollector
  let rateLimiter: TenantRateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockStorage = createMockStorage()
    mockMetrics = createMockMetricsCollector()
  })

  afterEach(async () => {
    if (rateLimiter) {
      await rateLimiter.close()
    }
    vi.useRealTimers()
  })

  // ============================================================================
  // REQUEST REJECTION AT LIMIT (429 RESPONSE)
  // ============================================================================

  describe('Requests rejected at limit (429 response)', () => {
    it('should allow requests under the limit', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })
      const result = await rateLimiter.check(request as any)

      expect(result.allowed).toBe(true)
      expect(result.statusCode).not.toBe(429)
    })

    it('should reject requests at the limit with 429', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 5,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Use up all 5 requests
      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter.check(request as any)
        expect(result.allowed).toBe(true)
      }

      // 6th request should be rejected
      const result = await rateLimiter.check(request as any)

      expect(result.allowed).toBe(false)
      expect(result.statusCode).toBe(429)
    })

    it('should return proper error response body at limit', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 1,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // First request allowed
      await rateLimiter.check(request as any)

      // Second request rejected
      const result = await rateLimiter.check(request as any)

      expect(result.allowed).toBe(false)
      expect(result.statusCode).toBe(429)
      expect(result.error).toBeDefined()
      expect(result.error.code).toBe('RATE_LIMIT_EXCEEDED')
      expect(result.error.message).toMatch(/rate limit/i)
      expect(result.retryAfterMs).toBeGreaterThan(0)
    })

    it('should allow requests after window reset', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 1,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Use up the limit
      await rateLimiter.check(request as any)

      // Verify rejected
      const rejectedResult = await rateLimiter.check(request as any)
      expect(rejectedResult.allowed).toBe(false)

      // Advance time past the window
      await vi.advanceTimersByTimeAsync(61000)

      // Should be allowed again
      const result = await rateLimiter.check(request as any)
      expect(result.allowed).toBe(true)
    })

    it('should track limits per tenant independently', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 2,
          windowMs: 60000,
        },
      })

      const requestA = createMockRequest({ tenant: 'tenant-a' })
      const requestB = createMockRequest({ tenant: 'tenant-b' })

      // Use up tenant-a's limit
      await rateLimiter.check(requestA as any)
      await rateLimiter.check(requestA as any)
      const resultA = await rateLimiter.check(requestA as any)
      expect(resultA.allowed).toBe(false)

      // tenant-b should still have full quota
      const resultB = await rateLimiter.check(requestB as any)
      expect(resultB.allowed).toBe(true)
    })
  })

  // ============================================================================
  // CONFIGURABLE LIMITS PER NAMESPACE/TENANT
  // ============================================================================

  describe('Rate limits configurable per namespace/tenant', () => {
    it('should apply default limits to unconfigured tenants', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const config = await rateLimiter.getConfigForTenant('unknown-tenant')

      expect(config.requestsPerWindow).toBe(100)
      expect(config.windowMs).toBe(60000)
    })

    it('should allow per-tenant configuration', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
        tenantConfigs: {
          'premium-tenant': {
            requestsPerWindow: 10000,
            windowMs: 60000,
          },
          'free-tier': {
            requestsPerWindow: 10,
            windowMs: 60000,
          },
        },
      })

      const premiumConfig = await rateLimiter.getConfigForTenant('premium-tenant')
      const freeConfig = await rateLimiter.getConfigForTenant('free-tier')

      expect(premiumConfig.requestsPerWindow).toBe(10000)
      expect(freeConfig.requestsPerWindow).toBe(10)
    })

    it('should update tenant config at runtime', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      // Initially uses default
      let config = await rateLimiter.getConfigForTenant('tenant-a')
      expect(config.requestsPerWindow).toBe(100)

      // Update config
      await rateLimiter.setTenantConfig('tenant-a', {
        requestsPerWindow: 500,
        windowMs: 60000,
      })

      // Now uses custom config
      config = await rateLimiter.getConfigForTenant('tenant-a')
      expect(config.requestsPerWindow).toBe(500)
    })

    it('should remove tenant config to revert to default', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
        tenantConfigs: {
          'tenant-a': {
            requestsPerWindow: 500,
            windowMs: 60000,
          },
        },
      })

      // Has custom config
      let config = await rateLimiter.getConfigForTenant('tenant-a')
      expect(config.requestsPerWindow).toBe(500)

      // Remove config
      await rateLimiter.removeTenantConfig('tenant-a')

      // Reverts to default
      config = await rateLimiter.getConfigForTenant('tenant-a')
      expect(config.requestsPerWindow).toBe(100)
    })

    it('should list all tenant configurations', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
        tenantConfigs: {
          'tenant-a': { requestsPerWindow: 500, windowMs: 60000 },
          'tenant-b': { requestsPerWindow: 1000, windowMs: 60000 },
        },
      })

      const allConfigs = await rateLimiter.getAllTenantConfigs()

      expect(allConfigs).toHaveProperty('tenant-a')
      expect(allConfigs).toHaveProperty('tenant-b')
      expect(Object.keys(allConfigs)).toHaveLength(2)
    })

    it('should validate tenant config values', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      // Should reject negative limits
      await expect(
        rateLimiter.setTenantConfig('tenant-a', {
          requestsPerWindow: -1,
          windowMs: 60000,
        })
      ).rejects.toThrow(/invalid|negative/i)

      // Should reject zero window
      await expect(
        rateLimiter.setTenantConfig('tenant-a', {
          requestsPerWindow: 100,
          windowMs: 0,
        })
      ).rejects.toThrow(/invalid|zero/i)
    })
  })

  // ============================================================================
  // DIFFERENT LIMITS FOR READS VS WRITES
  // ============================================================================

  describe('Different limits for reads vs writes', () => {
    it('should apply separate read limits', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
          readLimit: 1000,
          writeLimit: 100,
        },
      })

      const readRequest = createMockRequest({ method: 'GET', tenant: 'tenant-a' })

      // Use up read limit
      for (let i = 0; i < 1000; i++) {
        await rateLimiter.check(readRequest as any)
      }

      // 1001st read should be rejected
      const result = await rateLimiter.check(readRequest as any)
      expect(result.allowed).toBe(false)
      expect(result.limitType).toBe('read')
    })

    it('should apply separate write limits', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
          readLimit: 1000,
          writeLimit: 50,
        },
      })

      const writeRequest = createMockRequest({ method: 'POST', tenant: 'tenant-a' })

      // Use up write limit
      for (let i = 0; i < 50; i++) {
        await rateLimiter.check(writeRequest as any)
      }

      // 51st write should be rejected
      const result = await rateLimiter.check(writeRequest as any)
      expect(result.allowed).toBe(false)
      expect(result.limitType).toBe('write')
    })

    it('should classify HTTP methods correctly', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
          readLimit: 100,
          writeLimit: 10,
        },
      })

      const tenant = 'tenant-a'

      // GET and HEAD are reads
      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        const request = createMockRequest({ method, tenant })
        const result = await rateLimiter.check(request as any)
        expect(result.limitType).toBe('read')
      }

      // POST, PUT, PATCH, DELETE are writes
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const request = createMockRequest({ method, tenant })
        const result = await rateLimiter.check(request as any)
        expect(result.limitType).toBe('write')
      }
    })

    it('should track read and write limits independently', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
          readLimit: 5,
          writeLimit: 5,
        },
      })

      const tenant = 'tenant-a'
      const readRequest = createMockRequest({ method: 'GET', tenant })
      const writeRequest = createMockRequest({ method: 'POST', tenant })

      // Use up read limit
      for (let i = 0; i < 5; i++) {
        await rateLimiter.check(readRequest as any)
      }

      // Reads are blocked
      const blockedRead = await rateLimiter.check(readRequest as any)
      expect(blockedRead.allowed).toBe(false)

      // Writes still available
      const allowedWrite = await rateLimiter.check(writeRequest as any)
      expect(allowedWrite.allowed).toBe(true)
    })

    it('should fall back to combined limit when read/write not specified', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
          // No readLimit/writeLimit specified
        },
      })

      const readRequest = createMockRequest({ method: 'GET', tenant: 'tenant-a' })
      const writeRequest = createMockRequest({ method: 'POST', tenant: 'tenant-a' })

      // Use 5 reads and 5 writes
      for (let i = 0; i < 5; i++) {
        await rateLimiter.check(readRequest as any)
        await rateLimiter.check(writeRequest as any)
      }

      // Any request should now be blocked (combined limit of 10 reached)
      const result = await rateLimiter.check(readRequest as any)
      expect(result.allowed).toBe(false)
    })
  })

  // ============================================================================
  // BURST ALLOWANCE WITH TOKEN BUCKET ALGORITHM
  // ============================================================================

  describe('Burst allowance with token bucket algorithm', () => {
    it('should allow burst up to bucket capacity', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
          algorithm: 'token-bucket',
          bucketCapacity: 20, // Allow burst of 20
          refillRate: 10,     // 10 tokens per second
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Should allow burst of 20 requests
      for (let i = 0; i < 20; i++) {
        const result = await rateLimiter.check(request as any)
        expect(result.allowed).toBe(true)
      }

      // 21st request should be rejected (bucket empty)
      const result = await rateLimiter.check(request as any)
      expect(result.allowed).toBe(false)
    })

    it('should refill tokens over time', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
          algorithm: 'token-bucket',
          bucketCapacity: 10,
          refillRate: 1, // 1 token per second
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Drain the bucket
      for (let i = 0; i < 10; i++) {
        await rateLimiter.check(request as any)
      }

      // Bucket is empty
      let result = await rateLimiter.check(request as any)
      expect(result.allowed).toBe(false)

      // Wait 5 seconds - should have 5 tokens
      await vi.advanceTimersByTimeAsync(5000)

      // Should be able to make 5 more requests
      for (let i = 0; i < 5; i++) {
        result = await rateLimiter.check(request as any)
        expect(result.allowed).toBe(true)
      }

      // 6th should fail
      result = await rateLimiter.check(request as any)
      expect(result.allowed).toBe(false)
    })

    it('should not exceed bucket capacity on refill', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
          algorithm: 'token-bucket',
          bucketCapacity: 10,
          refillRate: 1,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Don't use any tokens, wait long time
      await vi.advanceTimersByTimeAsync(60000)

      // Should still only have 10 tokens (capacity)
      const state = await rateLimiter.getBucketState('tenant-a')
      expect(state.tokens).toBe(10)
    })

    it('should support fractional token costs', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
          algorithm: 'token-bucket',
          bucketCapacity: 10,
          refillRate: 1,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Use 0.5 tokens per request
      for (let i = 0; i < 20; i++) {
        const result = await rateLimiter.check(request as any, { cost: 0.5 })
        expect(result.allowed).toBe(true)
      }

      // 21st should fail (10 tokens / 0.5 = 20 requests)
      const result = await rateLimiter.check(request as any, { cost: 0.5 })
      expect(result.allowed).toBe(false)
    })

    it('should reject requests with cost exceeding remaining tokens', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
          algorithm: 'token-bucket',
          bucketCapacity: 10,
          refillRate: 1,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Use 8 tokens
      for (let i = 0; i < 8; i++) {
        await rateLimiter.check(request as any)
      }

      // Request with cost 3 should fail (only 2 tokens left)
      const result = await rateLimiter.check(request as any, { cost: 3 })
      expect(result.allowed).toBe(false)
      expect(result.tokensNeeded).toBe(3)
      expect(result.tokensAvailable).toBe(2)
    })

    it('should report bucket state', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
          algorithm: 'token-bucket',
          bucketCapacity: 10,
          refillRate: 2,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Use 5 tokens
      for (let i = 0; i < 5; i++) {
        await rateLimiter.check(request as any)
      }

      const state = await rateLimiter.getBucketState('tenant-a')

      expect(state.tokens).toBe(5)
      expect(state.capacity).toBe(10)
      expect(state.refillRate).toBe(2)
      expect(state.lastRefill).toBeDefined()
    })
  })

  // ============================================================================
  // RATE LIMIT HEADERS IN RESPONSES
  // ============================================================================

  describe('Rate limit headers in responses (X-RateLimit-*)', () => {
    it('should return X-RateLimit-Limit header', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })
      const result = await rateLimiter.check(request as any)

      expect(result.headers['X-RateLimit-Limit']).toBe('100')
    })

    it('should return X-RateLimit-Remaining header', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // First request
      let result = await rateLimiter.check(request as any)
      expect(result.headers['X-RateLimit-Remaining']).toBe('99')

      // Second request
      result = await rateLimiter.check(request as any)
      expect(result.headers['X-RateLimit-Remaining']).toBe('98')
    })

    it('should return X-RateLimit-Reset header', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })
      const result = await rateLimiter.check(request as any)

      // Should be Unix timestamp when window resets
      const resetTime = parseInt(result.headers['X-RateLimit-Reset'], 10)
      expect(resetTime).toBeGreaterThan(Date.now() / 1000)
      expect(resetTime).toBeLessThanOrEqual((Date.now() + 60000) / 1000)
    })

    it('should return Retry-After header when rate limited', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 1,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Use up the limit
      await rateLimiter.check(request as any)

      // Rate limited response should have Retry-After
      const result = await rateLimiter.check(request as any)
      expect(result.allowed).toBe(false)
      expect(result.headers['Retry-After']).toBeDefined()

      // Retry-After should be in seconds
      const retryAfter = parseInt(result.headers['Retry-After'], 10)
      expect(retryAfter).toBeGreaterThan(0)
      expect(retryAfter).toBeLessThanOrEqual(60)
    })

    it('should return X-RateLimit-Policy header', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })
      const result = await rateLimiter.check(request as any)

      // Should follow RFC 7807 format for rate limit policy
      expect(result.headers['X-RateLimit-Policy']).toBeDefined()
      expect(result.headers['X-RateLimit-Policy']).toMatch(/100.*60/i)
    })

    it('should return separate headers for read/write limits', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
          readLimit: 1000,
          writeLimit: 100,
        },
      })

      const readRequest = createMockRequest({ method: 'GET', tenant: 'tenant-a' })
      const writeRequest = createMockRequest({ method: 'POST', tenant: 'tenant-a' })

      const readResult = await rateLimiter.check(readRequest as any)
      const writeResult = await rateLimiter.check(writeRequest as any)

      expect(readResult.headers['X-RateLimit-Limit']).toBe('1000')
      expect(writeResult.headers['X-RateLimit-Limit']).toBe('100')
    })

    it('should provide helper method to apply headers to Response', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })
      const result = await rateLimiter.check(request as any)

      const response = new Response('OK', { status: 200 })
      const responseWithHeaders = rateLimiter.applyHeaders(response, result)

      expect(responseWithHeaders.headers.get('X-RateLimit-Limit')).toBe('100')
      expect(responseWithHeaders.headers.get('X-RateLimit-Remaining')).toBeDefined()
      expect(responseWithHeaders.headers.get('X-RateLimit-Reset')).toBeDefined()
    })
  })

  // ============================================================================
  // ADMIN OVERRIDE FOR SPECIFIC TENANTS
  // ============================================================================

  describe('Admin override for specific tenants', () => {
    it('should allow unlimited access for admin tenants', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
        },
        adminTenants: ['admin-tenant'],
      })

      const request = createMockRequest({ tenant: 'admin-tenant' })

      // Make many requests - should all be allowed
      for (let i = 0; i < 1000; i++) {
        const result = await rateLimiter.check(request as any)
        expect(result.allowed).toBe(true)
        expect(result.bypass).toBe(true)
      }
    })

    it('should support temporary admin override', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
        },
      })

      const tenant = 'temporary-admin'

      // Apply temporary override
      await rateLimiter.setOverride(tenant, {
        type: 'bypass',
        expiresAt: Date.now() + 3600000, // 1 hour
        reason: 'Load testing',
      })

      const request = createMockRequest({ tenant })

      // Should bypass rate limiting
      for (let i = 0; i < 100; i++) {
        const result = await rateLimiter.check(request as any)
        expect(result.allowed).toBe(true)
        expect(result.bypass).toBe(true)
      }

      // After expiry, should be rate limited again
      await vi.advanceTimersByTimeAsync(3600001)

      // Use up the normal limit
      for (let i = 0; i < 10; i++) {
        await rateLimiter.check(request as any)
      }

      const result = await rateLimiter.check(request as any)
      expect(result.allowed).toBe(false)
      expect(result.bypass).toBeUndefined()
    })

    it('should support override with increased limits', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
        },
      })

      const tenant = 'boosted-tenant'

      // Apply limit increase override
      await rateLimiter.setOverride(tenant, {
        type: 'increase',
        multiplier: 10, // 10x normal limit
        expiresAt: Date.now() + 3600000,
        reason: 'High-traffic event',
      })

      const request = createMockRequest({ tenant })

      // Should allow 100 requests (10 * 10x multiplier)
      for (let i = 0; i < 100; i++) {
        const result = await rateLimiter.check(request as any)
        expect(result.allowed).toBe(true)
      }

      // 101st should be rejected
      const result = await rateLimiter.check(request as any)
      expect(result.allowed).toBe(false)
    })

    it('should list all active overrides', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
        },
        adminTenants: ['admin-1'],
      })

      await rateLimiter.setOverride('tenant-a', {
        type: 'bypass',
        expiresAt: Date.now() + 3600000,
        reason: 'Testing',
      })

      await rateLimiter.setOverride('tenant-b', {
        type: 'increase',
        multiplier: 5,
        expiresAt: Date.now() + 7200000,
        reason: 'Special promotion',
      })

      const overrides = await rateLimiter.getActiveOverrides()

      expect(overrides).toHaveLength(3) // admin-1 + tenant-a + tenant-b
      expect(overrides.map(o => o.tenant)).toContain('admin-1')
      expect(overrides.map(o => o.tenant)).toContain('tenant-a')
      expect(overrides.map(o => o.tenant)).toContain('tenant-b')
    })

    it('should remove override before expiry', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
        },
      })

      const tenant = 'temp-bypass'

      await rateLimiter.setOverride(tenant, {
        type: 'bypass',
        expiresAt: Date.now() + 3600000,
        reason: 'Testing',
      })

      // Remove override
      await rateLimiter.removeOverride(tenant)

      // Should be subject to normal limits now
      const request = createMockRequest({ tenant })

      for (let i = 0; i < 10; i++) {
        await rateLimiter.check(request as any)
      }

      const result = await rateLimiter.check(request as any)
      expect(result.allowed).toBe(false)
    })

    it('should audit override usage', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        metricsCollector: mockMetrics as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
        },
        adminTenants: ['admin-tenant'],
      })

      const request = createMockRequest({ tenant: 'admin-tenant' })
      await rateLimiter.check(request as any)

      expect(mockMetrics.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant: 'admin-tenant',
          bypassed: true,
          bypassReason: expect.any(String),
        })
      )
    })
  })

  // ============================================================================
  // RATE LIMIT METRICS FOR MONITORING
  // ============================================================================

  describe('Rate limit metrics for monitoring', () => {
    it('should record request count per tenant', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        metricsCollector: mockMetrics as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })
      await rateLimiter.check(request as any)
      await rateLimiter.check(request as any)
      await rateLimiter.check(request as any)

      expect(mockMetrics.record).toHaveBeenCalledTimes(3)
      expect(mockMetrics.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant: 'tenant-a',
          type: 'request',
        })
      )
    })

    it('should record rejections separately', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        metricsCollector: mockMetrics as any,
        defaultConfig: {
          requestsPerWindow: 1,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })
      await rateLimiter.check(request as any) // Allowed
      await rateLimiter.check(request as any) // Rejected

      const rejectionMetrics = mockMetrics._metrics.filter(m => m.rejected)
      expect(rejectionMetrics).toHaveLength(1)
      expect(rejectionMetrics[0]).toMatchObject({
        tenant: 'tenant-a',
        rejected: true,
      })
    })

    it('should track remaining quota percentage', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        metricsCollector: mockMetrics as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Use 50 requests
      for (let i = 0; i < 50; i++) {
        await rateLimiter.check(request as any)
      }

      const lastMetric = mockMetrics._metrics[mockMetrics._metrics.length - 1]
      expect(lastMetric.remainingPercent).toBe(50)
    })

    it('should provide aggregated metrics by tenant', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        metricsCollector: mockMetrics as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const requestA = createMockRequest({ tenant: 'tenant-a' })
      const requestB = createMockRequest({ tenant: 'tenant-b' })

      for (let i = 0; i < 10; i++) {
        await rateLimiter.check(requestA as any)
      }
      for (let i = 0; i < 5; i++) {
        await rateLimiter.check(requestB as any)
      }

      const aggregated = await rateLimiter.getAggregatedMetrics()

      expect(aggregated['tenant-a'].totalRequests).toBe(10)
      expect(aggregated['tenant-b'].totalRequests).toBe(5)
    })

    it('should track latency for rate limit checks', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        metricsCollector: mockMetrics as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })
      await rateLimiter.check(request as any)

      expect(mockMetrics.record).toHaveBeenCalledWith(
        expect.objectContaining({
          checkLatencyMs: expect.any(Number),
        })
      )
    })

    it('should emit warning metrics when approaching limit', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        metricsCollector: mockMetrics as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
        warningThreshold: 0.8, // 80%
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Use 80 requests (hit 80% threshold)
      for (let i = 0; i < 80; i++) {
        await rateLimiter.check(request as any)
      }

      const warningMetrics = mockMetrics._metrics.filter(m => m.warning)
      expect(warningMetrics.length).toBeGreaterThan(0)
      expect(warningMetrics[0]).toMatchObject({
        tenant: 'tenant-a',
        warning: true,
        warningType: 'threshold_approaching',
      })
    })

    it('should provide current usage status for tenant', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      for (let i = 0; i < 25; i++) {
        await rateLimiter.check(request as any)
      }

      const status = await rateLimiter.getUsageStatus('tenant-a')

      expect(status.used).toBe(25)
      expect(status.limit).toBe(100)
      expect(status.remaining).toBe(75)
      expect(status.percentUsed).toBe(25)
      expect(status.windowResetsAt).toBeDefined()
    })

    it('should support exporting metrics in Prometheus format', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        metricsCollector: mockMetrics as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })
      await rateLimiter.check(request as any)

      const prometheusMetrics = await rateLimiter.exportPrometheusMetrics()

      expect(prometheusMetrics).toContain('rate_limit_requests_total')
      expect(prometheusMetrics).toContain('tenant="tenant-a"')
    })
  })

  // ============================================================================
  // SLIDING WINDOW VS FIXED WINDOW OPTIONS
  // ============================================================================

  describe('Sliding window vs fixed window options', () => {
    it('should support fixed window strategy (default)', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
          windowStrategy: 'fixed',
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Use all 10 requests
      for (let i = 0; i < 10; i++) {
        await rateLimiter.check(request as any)
      }

      // Rejected
      let result = await rateLimiter.check(request as any)
      expect(result.allowed).toBe(false)

      // Advance to next window
      await vi.advanceTimersByTimeAsync(60001)

      // Full quota restored
      for (let i = 0; i < 10; i++) {
        result = await rateLimiter.check(request as any)
        expect(result.allowed).toBe(true)
      }
    })

    it('should support sliding window strategy', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
          windowStrategy: 'sliding',
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Use 5 requests at start
      for (let i = 0; i < 5; i++) {
        await rateLimiter.check(request as any)
      }

      // Advance 30 seconds (half window)
      await vi.advanceTimersByTimeAsync(30000)

      // Use 5 more requests
      for (let i = 0; i < 5; i++) {
        await rateLimiter.check(request as any)
      }

      // At t=30s: should be rate limited (10 requests in last 60s)
      let result = await rateLimiter.check(request as any)
      expect(result.allowed).toBe(false)

      // Advance 31 more seconds (t=61s from start)
      await vi.advanceTimersByTimeAsync(31000)

      // First 5 requests have now expired, should have 5 available
      for (let i = 0; i < 5; i++) {
        result = await rateLimiter.check(request as any)
        expect(result.allowed).toBe(true)
      }

      // 6th should fail (5 from t=30s still in window)
      result = await rateLimiter.check(request as any)
      expect(result.allowed).toBe(false)
    })

    it('should support sliding log strategy for precision', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
          windowStrategy: 'sliding-log',
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Make requests at different times
      await rateLimiter.check(request as any)
      await vi.advanceTimersByTimeAsync(10000)
      await rateLimiter.check(request as any)
      await vi.advanceTimersByTimeAsync(10000)
      await rateLimiter.check(request as any)

      // Get window info
      const windowInfo = await rateLimiter.getWindowInfo('tenant-a')

      expect(windowInfo.strategy).toBe('sliding-log')
      expect(windowInfo.requestTimestamps).toHaveLength(3)
    })

    it('should allow runtime strategy change', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
          windowStrategy: 'fixed',
        },
      })

      let config = await rateLimiter.getConfigForTenant('tenant-a')
      expect(config.windowStrategy).toBe('fixed')

      await rateLimiter.setTenantConfig('tenant-a', {
        requestsPerWindow: 10,
        windowMs: 60000,
        windowStrategy: 'sliding',
      })

      config = await rateLimiter.getConfigForTenant('tenant-a')
      expect(config.windowStrategy).toBe('sliding')
    })

    it('should handle window strategy per-tenant', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
          windowStrategy: 'fixed',
        },
        tenantConfigs: {
          'sliding-tenant': {
            requestsPerWindow: 10,
            windowMs: 60000,
            windowStrategy: 'sliding',
          },
        },
      })

      const fixedRequest = createMockRequest({ tenant: 'fixed-tenant' })
      const slidingRequest = createMockRequest({ tenant: 'sliding-tenant' })

      const fixedResult = await rateLimiter.check(fixedRequest as any)
      const slidingResult = await rateLimiter.check(slidingRequest as any)

      expect(fixedResult.windowStrategy).toBe('fixed')
      expect(slidingResult.windowStrategy).toBe('sliding')
    })

    it('should accurately report window reset time for each strategy', async () => {
      const now = Date.now()

      // Fixed window
      const fixedLimiter = new TenantRateLimiter({
        storage: createMockStorage() as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
          windowStrategy: 'fixed',
        },
      })

      const fixedRequest = createMockRequest({ tenant: 'tenant-a' })
      const fixedResult = await fixedLimiter.check(fixedRequest as any)

      // Fixed window should reset at the end of the window
      expect(fixedResult.windowResetsAt).toBeDefined()
      expect(fixedResult.windowResetsAt).toBeGreaterThan(now)

      await fixedLimiter.close()

      // Sliding window
      const slidingLimiter = new TenantRateLimiter({
        storage: createMockStorage() as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
          windowStrategy: 'sliding',
        },
      })

      const slidingRequest = createMockRequest({ tenant: 'tenant-a' })
      const slidingResult = await slidingLimiter.check(slidingRequest as any)

      // Sliding window should indicate when oldest request expires
      expect(slidingResult.oldestRequestExpiresAt).toBeDefined()

      await slidingLimiter.close()
    })
  })

  // ============================================================================
  // CONSTRUCTOR AND LIFECYCLE
  // ============================================================================

  describe('Constructor and lifecycle', () => {
    it('should create rate limiter with minimal config', () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      expect(rateLimiter).toBeInstanceOf(TenantRateLimiter)
    })

    it('should validate config on construction', () => {
      expect(() => {
        new TenantRateLimiter({
          storage: mockStorage as any,
          defaultConfig: {
            requestsPerWindow: -1,
            windowMs: 60000,
          },
        })
      }).toThrow(/invalid|negative/i)
    })

    it('should close gracefully', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      await rateLimiter.close()

      expect(rateLimiter.isClosed()).toBe(true)
    })

    it('should reject requests after close', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      await rateLimiter.close()

      const request = createMockRequest({ tenant: 'tenant-a' })

      await expect(rateLimiter.check(request as any)).rejects.toThrow(/closed/i)
    })

    it('should flush pending state on close', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })
      await rateLimiter.check(request as any)

      await rateLimiter.close()

      // State should be persisted to storage
      expect(mockStorage.set).toHaveBeenCalled()
    })
  })

  // ============================================================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================================================

  describe('Edge cases and error handling', () => {
    it('should handle concurrent requests correctly', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Fire 15 concurrent requests
      const results = await Promise.all(
        Array(15).fill(null).map(() => rateLimiter.check(request as any))
      )

      const allowed = results.filter(r => r.allowed).length
      const rejected = results.filter(r => !r.allowed).length

      expect(allowed).toBe(10)
      expect(rejected).toBe(5)
    })

    it('should handle storage failures gracefully', async () => {
      mockStorage.get.mockImplementation(() => {
        throw new Error('Storage unavailable')
      })

      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
        failOpen: true, // Allow requests when storage fails
      })

      const request = createMockRequest({ tenant: 'tenant-a' })
      const result = await rateLimiter.check(request as any)

      // Should allow (fail open)
      expect(result.allowed).toBe(true)
      expect(result.storageError).toBe(true)
    })

    it('should fail closed when configured', async () => {
      mockStorage.get.mockImplementation(() => {
        throw new Error('Storage unavailable')
      })

      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
        failOpen: false, // Block requests when storage fails
      })

      const request = createMockRequest({ tenant: 'tenant-a' })
      const result = await rateLimiter.check(request as any)

      expect(result.allowed).toBe(false)
      expect(result.storageError).toBe(true)
    })

    it('should handle very large limits', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: Number.MAX_SAFE_INTEGER,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })
      const result = await rateLimiter.check(request as any)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(Number.MAX_SAFE_INTEGER - 1)
    })

    it('should handle empty tenant identifier', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: '' })

      await expect(rateLimiter.check(request as any)).rejects.toThrow(/tenant.*required/i)
    })

    it('should handle special characters in tenant names', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 100,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant:with:colons' })
      const result = await rateLimiter.check(request as any)

      expect(result.allowed).toBe(true)
    })

    it('should reset tenant state', async () => {
      rateLimiter = new TenantRateLimiter({
        storage: mockStorage as any,
        defaultConfig: {
          requestsPerWindow: 10,
          windowMs: 60000,
        },
      })

      const request = createMockRequest({ tenant: 'tenant-a' })

      // Use up some quota
      for (let i = 0; i < 5; i++) {
        await rateLimiter.check(request as any)
      }

      // Reset
      await rateLimiter.resetTenant('tenant-a')

      // Should have full quota again
      const status = await rateLimiter.getUsageStatus('tenant-a')
      expect(status.used).toBe(0)
      expect(status.remaining).toBe(10)
    })
  })
})
