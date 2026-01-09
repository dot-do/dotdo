import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import proxyHandler, {
  resetConfigCache,
  type ProxyConfig,
} from '../../proxy'

/**
 * Integration Tests (GREEN Phase)
 *
 * Full flow tests for the proxy snippet.
 */

// Mock fetch
const mockFetch = vi.fn()
const originalFetch = globalThis.fetch

// Mock caches
const mockCachesMatch = vi.fn()
const mockCachesPut = vi.fn()
const mockCaches = {
  default: {
    match: mockCachesMatch,
    put: mockCachesPut,
  },
}

// Mock context
const mockWaitUntil = vi.fn()
const mockCtx = {
  waitUntil: mockWaitUntil,
}

const mockEnv = {}

const testConfig: ProxyConfig = {
  version: 'test-v1',
  ttl: 60,
  routes: [
    {
      id: 'api-test',
      match: { path: '^/api/test' },
      transforms: {
        request: [{ op: 'setHeader', name: 'X-Request-Id', value: '$requestId' }],
        response: [{ op: 'setHeader', name: 'X-Proxied', value: 'true' }],
      },
    },
    {
      id: 'protected',
      match: { path: '^/api/protected' },
      policies: ['auth:jwt'],
    },
  ],
  policies: {
    'auth:jwt': {
      type: 'jwt',
      publicKey: '-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----',
    },
  },
  variables: {
    domain: 'example.com',
  },
}

describe('Full Proxy Flow', () => {
  beforeEach(() => {
    resetConfigCache()
    mockFetch.mockReset()
    mockCachesMatch.mockReset()
    mockCachesPut.mockReset()
    mockWaitUntil.mockReset()
    globalThis.fetch = mockFetch as unknown as typeof fetch
    // @ts-expect-error - mocking caches global
    globalThis.caches = mockCaches
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('loads config, matches route, transforms, and forwards', async () => {
    // Mock config fetch
    mockCachesMatch.mockResolvedValueOnce(null) // No cache hit for config
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(testConfig),
      })
      .mockResolvedValueOnce(new Response('Upstream response', { status: 200 }))

    const request = new Request('https://example.com/api/test')

    const response = await proxyHandler.fetch(
      request,
      mockEnv,
      mockCtx as unknown as ExecutionContext
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Proxied')).toBe('true')

    // Verify the forwarded request had the transform applied
    const forwardedRequest = mockFetch.mock.calls[1][0] as Request
    expect(forwardedRequest.headers.has('X-Request-Id')).toBe(true)
  })

  it('short-circuits on policy rejection', async () => {
    mockCachesMatch.mockResolvedValue(null)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(testConfig),
    })

    const request = new Request('https://example.com/api/protected')

    const response = await proxyHandler.fetch(
      request,
      mockEnv,
      mockCtx as unknown as ExecutionContext
    )

    // Should return 401 without forwarding to upstream
    expect(response.status).toBe(401)
    expect(mockFetch).toHaveBeenCalledTimes(1) // Only config fetch, no upstream
  })

  it('passes through unmatched routes', async () => {
    mockCachesMatch.mockResolvedValue(null)
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(testConfig),
      })
      .mockResolvedValueOnce(new Response('Not proxied', { status: 200 }))

    const request = new Request('https://example.com/unmatched/path')

    const response = await proxyHandler.fetch(
      request,
      mockEnv,
      mockCtx as unknown as ExecutionContext
    )

    expect(response.status).toBe(200)
    // Verify passthrough (no transforms applied)
    expect(response.headers.has('X-Proxied')).toBe(false)
  })

  it('handles target errors gracefully', async () => {
    mockCachesMatch.mockResolvedValue(null)
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(testConfig),
      })
      .mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }))

    const request = new Request('https://example.com/api/test')

    const response = await proxyHandler.fetch(
      request,
      mockEnv,
      mockCtx as unknown as ExecutionContext
    )

    // Should return the upstream error response (with transforms)
    expect(response.status).toBe(503)
    expect(response.headers.get('X-Proxied')).toBe('true')
  })

  it('handles config fetch failure with passthrough', async () => {
    mockCachesMatch.mockResolvedValue(null)
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      })
      .mockResolvedValueOnce(new Response('Passthrough response', { status: 200 }))

    const request = new Request('https://example.com/api/test')

    const response = await proxyHandler.fetch(
      request,
      mockEnv,
      mockCtx as unknown as ExecutionContext
    )

    // Should passthrough without error
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toBe('Passthrough response')
  })

  it('blocks access to /proxy-config.json', async () => {
    const request = new Request('https://example.com/proxy-config.json')

    const response = await proxyHandler.fetch(
      request,
      mockEnv,
      mockCtx as unknown as ExecutionContext
    )

    expect(response.status).toBe(404)
  })

  it('applies multiple transforms in order', async () => {
    const configWithMultipleTransforms: ProxyConfig = {
      ...testConfig,
      routes: [
        {
          id: 'multi-transform',
          match: { path: '^/api/multi' },
          transforms: {
            request: [
              { op: 'setHeader', name: 'X-First', value: 'first' },
              { op: 'setHeader', name: 'X-Second', value: 'second' },
              { op: 'removeHeader', name: 'X-Remove' },
            ],
            response: [
              { op: 'setHeader', name: 'X-Response-First', value: 'r-first' },
              { op: 'setHeader', name: 'X-Response-Second', value: 'r-second' },
            ],
          },
        },
      ],
    }

    mockCachesMatch.mockResolvedValue(null)
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(configWithMultipleTransforms),
      })
      .mockResolvedValueOnce(new Response('OK', { status: 200 }))

    const request = new Request('https://example.com/api/multi', {
      headers: { 'X-Remove': 'should-be-removed' },
    })

    const response = await proxyHandler.fetch(
      request,
      mockEnv,
      mockCtx as unknown as ExecutionContext
    )

    // Check response transforms applied
    expect(response.headers.get('X-Response-First')).toBe('r-first')
    expect(response.headers.get('X-Response-Second')).toBe('r-second')

    // Check request transforms applied
    const forwardedRequest = mockFetch.mock.calls[1][0] as Request
    expect(forwardedRequest.headers.get('X-First')).toBe('first')
    expect(forwardedRequest.headers.get('X-Second')).toBe('second')
    expect(forwardedRequest.headers.has('X-Remove')).toBe(false)
  })

  it('respects route priority for multiple matches', async () => {
    const configWithPriority: ProxyConfig = {
      ...testConfig,
      routes: [
        {
          id: 'low-priority',
          priority: 1,
          match: { path: '^/api/.*' },
          transforms: {
            response: [{ op: 'setHeader', name: 'X-Match', value: 'low' }],
          },
        },
        {
          id: 'high-priority',
          priority: 100,
          match: { path: '^/api/specific' },
          transforms: {
            response: [{ op: 'setHeader', name: 'X-Match', value: 'high' }],
          },
        },
      ],
    }

    mockCachesMatch.mockResolvedValue(null)
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(configWithPriority),
      })
      .mockResolvedValueOnce(new Response('OK', { status: 200 }))

    const request = new Request('https://example.com/api/specific')

    const response = await proxyHandler.fetch(
      request,
      mockEnv,
      mockCtx as unknown as ExecutionContext
    )

    expect(response.headers.get('X-Match')).toBe('high')
  })
})

describe('Context Variables', () => {
  beforeEach(() => {
    resetConfigCache()
    mockFetch.mockReset()
    mockCachesMatch.mockReset()
    mockCachesPut.mockReset()
    mockWaitUntil.mockReset()
    globalThis.fetch = mockFetch as unknown as typeof fetch
    // @ts-expect-error - mocking caches global
    globalThis.caches = mockCaches
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('generates unique requestId for each request', async () => {
    const configWithRequestId: ProxyConfig = {
      ...testConfig,
      routes: [
        {
          id: 'test',
          match: { path: '^/api/test' },
          transforms: {
            request: [{ op: 'setHeader', name: 'X-Request-Id', value: '$requestId' }],
          },
        },
      ],
    }

    mockCachesMatch.mockResolvedValue({
      json: () => Promise.resolve(configWithRequestId),
    })
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

    // First request
    await proxyHandler.fetch(
      new Request('https://example.com/api/test'),
      mockEnv,
      mockCtx as unknown as ExecutionContext
    )

    const firstRequestId = (mockFetch.mock.calls[0][0] as Request).headers.get('X-Request-Id')

    // Reset and make second request
    mockFetch.mockClear()

    await proxyHandler.fetch(
      new Request('https://example.com/api/test'),
      mockEnv,
      mockCtx as unknown as ExecutionContext
    )

    const secondRequestId = (mockFetch.mock.calls[0][0] as Request).headers.get('X-Request-Id')

    expect(firstRequestId).toBeTruthy()
    expect(secondRequestId).toBeTruthy()
    expect(firstRequestId).not.toBe(secondRequestId)
  })

  it('resolves $config variables from config.variables', async () => {
    const configWithVars: ProxyConfig = {
      ...testConfig,
      routes: [
        {
          id: 'test',
          match: { path: '^/api/test' },
          transforms: {
            request: [{ op: 'setHeader', name: 'X-Domain', value: '$config.domain' }],
          },
        },
      ],
      variables: {
        domain: 'example.com',
      },
    }

    mockCachesMatch.mockResolvedValue({
      json: () => Promise.resolve(configWithVars),
    })
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

    await proxyHandler.fetch(
      new Request('https://example.com/api/test'),
      mockEnv,
      mockCtx as unknown as ExecutionContext
    )

    const forwardedRequest = mockFetch.mock.calls[0][0] as Request
    expect(forwardedRequest.headers.get('X-Domain')).toBe('example.com')
  })
})
