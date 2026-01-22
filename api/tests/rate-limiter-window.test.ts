/**
 * Rate Limiter Window Calculation Bug Test
 *
 * Tests for the bug where the rate limit error response hardcodes the window
 * to 60s instead of using the configured windowMs from the tier configuration.
 *
 * Bug location: api/middleware/rate-limit.ts, rateLimitMiddleware function
 * The error details object hardcodes `window: `${Math.round(60000 / 1000)}s``
 * instead of using the tier's actual windowMs value.
 *
 * @module api/tests/rate-limiter-window.test
 * @issue do-htom - Rate limiter window calculation bug
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { rateLimitMiddleware, type RateLimitConfig } from '../middleware/rate-limit'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock HTTP request
 */
function createMockRequest(tenantId: string, path: string = '/api/test'): Request {
  const hostname = `${tenantId}.api.dotdo.dev`
  const url = `https://${hostname}${path}`

  return new Request(url, {
    method: 'GET',
    headers: new Headers({
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '192.168.1.1',
      'X-Tenant-ID': tenantId,
    }),
  })
}

/**
 * Create a Hono app with rate limiting middleware for testing
 */
function createTestApp(config: RateLimitConfig) {
  const app = new Hono()

  app.use('*', rateLimitMiddleware(config))
  app.get('/api/test', (c) => c.json({ message: 'ok' }))

  return app
}

// ============================================================================
// TESTS: WINDOW CALCULATION BUG
// ============================================================================

describe('Rate Limiter Window Calculation Bug (do-htom)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should report configured window (30s) in error response, not hardcoded 60s', async () => {
    // Configure a 30-second window (30000ms)
    const app = createTestApp({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 1, windowMs: 30000 }, // 30 seconds
      },
      defaultTier: 'test',
    })

    const tenantId = 'acme'

    // First request succeeds
    await app.fetch(createMockRequest(tenantId))

    // Second request should be rate limited
    const res = await app.fetch(createMockRequest(tenantId))
    expect(res.status).toBe(429)

    const body = (await res.json()) as { details?: { window?: string } }

    // BUG: The window is hardcoded to "60s" instead of using the configured 30000ms
    // This test should PASS when the bug is fixed
    expect(body.details?.window).toBe('30s')
  })

  it('should report configured window (120s) in error response, not hardcoded 60s', async () => {
    // Configure a 2-minute window (120000ms)
    const app = createTestApp({
      keyStrategy: 'tenant',
      tiers: {
        test: { name: 'test', requestsPerWindow: 1, windowMs: 120000 }, // 2 minutes
      },
      defaultTier: 'test',
    })

    const tenantId = 'enterprise'

    // First request succeeds
    await app.fetch(createMockRequest(tenantId))

    // Second request should be rate limited
    const res = await app.fetch(createMockRequest(tenantId))
    expect(res.status).toBe(429)

    const body = (await res.json()) as { details?: { window?: string } }

    // BUG: The window is hardcoded to "60s" instead of using the configured 120000ms
    // This test should PASS when the bug is fixed
    expect(body.details?.window).toBe('120s')
  })

  it('should report configured window (5s) in error response for aggressive rate limiting', async () => {
    // Configure a 5-second window (5000ms) for aggressive rate limiting
    const app = createTestApp({
      keyStrategy: 'tenant',
      tiers: {
        aggressive: { name: 'aggressive', requestsPerWindow: 1, windowMs: 5000 }, // 5 seconds
      },
      defaultTier: 'aggressive',
    })

    const tenantId = 'test-tenant'

    // First request succeeds
    await app.fetch(createMockRequest(tenantId))

    // Second request should be rate limited
    const res = await app.fetch(createMockRequest(tenantId))
    expect(res.status).toBe(429)

    const body = (await res.json()) as { details?: { window?: string } }

    // BUG: The window is hardcoded to "60s" instead of using the configured 5000ms
    // This test should PASS when the bug is fixed
    expect(body.details?.window).toBe('5s')
  })

  it('should correctly report 60s window when actually configured as 60s', async () => {
    // Configure a standard 60-second window (60000ms)
    const app = createTestApp({
      keyStrategy: 'tenant',
      tiers: {
        standard: { name: 'standard', requestsPerWindow: 1, windowMs: 60000 }, // 60 seconds
      },
      defaultTier: 'standard',
    })

    const tenantId = 'standard-tenant'

    // First request succeeds
    await app.fetch(createMockRequest(tenantId))

    // Second request should be rate limited
    const res = await app.fetch(createMockRequest(tenantId))
    expect(res.status).toBe(429)

    const body = (await res.json()) as { details?: { window?: string } }

    // This happens to pass because the hardcoded value matches the configured value
    expect(body.details?.window).toBe('60s')
  })
})
