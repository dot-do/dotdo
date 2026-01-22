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
import { createAPI } from '../app'

// ============================================================================
// TESTS: STANDARD RATE LIMIT HEADERS VIA createAPI
// ============================================================================

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

describe('Rate Limit Headers via createAPI', () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    consoleInfoSpy.mockRestore()
  })

  it('should set all rate limit headers on response', async () => {
    const app = createAPI({
      rateLimit: {
        enabled: true,
        keyStrategy: 'ip',
        tiers: {
          test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
        },
        defaultTier: 'test',
      },
    })

    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('http://localhost/test', {
      headers: { 'CF-Connecting-IP': '192.168.1.1' },
    })

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

  it('should include RateLimit-Policy with correct window duration', async () => {
    const app = createAPI({
      rateLimit: {
        enabled: true,
        keyStrategy: 'ip',
        tiers: {
          hourly: { name: 'hourly', requestsPerWindow: 1000, windowMs: 3600000 },
        },
        defaultTier: 'hourly',
      },
    })

    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('http://localhost/test', {
      headers: { 'CF-Connecting-IP': '192.168.1.1' },
    })

    expect(res.status).toBe(200)
    // Policy should be "1000;w=3600" for 1000 requests per hour
    expect(res.headers.get('RateLimit-Policy')).toBe('1000;w=3600')
  })

  it('should include Retry-After only when rate limited', async () => {
    const app = createAPI({
      rateLimit: {
        enabled: true,
        keyStrategy: 'ip',
        tiers: {
          test: { name: 'test', requestsPerWindow: 1, windowMs: 60000 },
        },
        defaultTier: 'test',
      },
    })

    app.get('/test', (c) => c.json({ ok: true }))

    // First request - should NOT have Retry-After
    const res1 = await app.request('http://localhost/test', {
      headers: { 'CF-Connecting-IP': '192.168.1.1' },
    })

    expect(res1.status).toBe(200)
    expect(res1.headers.get('Retry-After')).toBeNull()

    // Second request - should have Retry-After
    const res2 = await app.request('http://localhost/test', {
      headers: { 'CF-Connecting-IP': '192.168.1.1' },
    })

    expect(res2.status).toBe(429)
    expect(res2.headers.get('Retry-After')).toBeDefined()
    expect(parseInt(res2.headers.get('Retry-After')!, 10)).toBeGreaterThan(0)
  })

  it('should have matching legacy and standard header values', async () => {
    const app = createAPI({
      rateLimit: {
        enabled: true,
        keyStrategy: 'ip',
        tiers: {
          test: { name: 'test', requestsPerWindow: 100, windowMs: 60000 },
        },
        defaultTier: 'test',
      },
    })

    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('http://localhost/test', {
      headers: { 'CF-Connecting-IP': '192.168.1.1' },
    })

    // Limit should match between legacy and standard
    expect(res.headers.get('X-RateLimit-Limit')).toBe(res.headers.get('RateLimit-Limit'))

    // Remaining should match between legacy and standard
    expect(res.headers.get('X-RateLimit-Remaining')).toBe(res.headers.get('RateLimit-Remaining'))
  })
})
