import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import proxySnippet from '../proxy'
import type { ProxyConfig } from '../proxy'

/**
 * Integration Tests (RED Phase)
 *
 * These tests verify the full proxy flow:
 * 1. Config loading
 * 2. Route matching
 * 3. Request transforms
 * 4. Policy application
 * 5. Target forwarding
 * 6. Response transforms
 *
 * Also includes subrequest counting tests to ensure we stay within budget.
 *
 * These tests are expected to FAIL until the proxy snippet is implemented.
 */

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1LfVLPHCozMxH2Mo
4lgOEePzNm0tRgeLezV6ffAt0gunVTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u
+qKhbwKfBstIs+bMY2Zkp18gnTxKLxoS2tFczGkPLPgizskuemMghRniWaoLcyeh
kd3qqGElvW/VDL5AaWTg0nLVkjRo9z+40RQzuVaE8AkAFmxZzow3x+VJYKdjykkJ
0iT9wCS0DRTXu269V264Vf/3jvredZiKRkgwlL9xNAwxXFg0x/XFw005UWVRIkdg
cKWTjpBP2dPwVZ4WWC+9aGVd+Gyn1o0CLelf4rEjGoXbAAEgAqeGUxrcIlbjXfbc
mwIDAQAB
-----END PUBLIC KEY-----`

const TEST_CONFIG: ProxyConfig = {
  version: 'test-v1',
  ttl: 60,
  routes: [
    {
      id: 'test-api',
      match: { path: '^/api/test' },
      transforms: {
        request: [{ op: 'setHeader', name: 'X-Test', value: '$requestId' }],
        response: [{ op: 'setHeader', name: 'X-Proxied', value: 'true' }],
      },
      policies: ['auth:jwt'],
      target: { type: 'passthrough' },
    },
    {
      id: 'public-api',
      match: { path: '^/api/public' },
      transforms: {
        response: [{ op: 'setHeader', name: 'X-Public', value: 'true' }],
      },
      target: { type: 'passthrough' },
    },
    {
      id: 'admin-api',
      priority: 100,
      match: { path: '^/api/admin', methods: ['GET', 'POST'] },
      policies: ['auth:jwt', 'geoBlock:us'],
      target: { type: 'passthrough' },
    },
  ],
  policies: {
    'auth:jwt': {
      type: 'jwt',
      publicKey: TEST_PUBLIC_KEY,
    },
    'geoBlock:us': {
      type: 'geoBlock',
      allowedCountries: ['US'],
    },
  },
  variables: {
    domain: 'example.com',
  },
}

function createMockEnv() {
  return {
    // Environment bindings would go here
  }
}

function createMockContext() {
  const waitUntilPromises: Promise<unknown>[] = []
  return {
    waitUntil: vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise)
    }),
    _waitUntilPromises: waitUntilPromises,
  }
}

function createMockCaches() {
  const store = new Map<string, Response>()
  return {
    default: {
      match: vi.fn(async (key: Request | string) => {
        const url = typeof key === 'string' ? key : key.url
        return store.get(url)?.clone()
      }),
      put: vi.fn(async (key: Request | string, response: Response) => {
        const url = typeof key === 'string' ? key : key.url
        store.set(url, response.clone())
      }),
    },
    _store: store,
  }
}

function createTestJwt(payload: Record<string, unknown>, expired = false): string {
  const header = { alg: 'RS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = {
    ...payload,
    iat: now - 60,
    exp: expired ? now - 1 : now + 3600,
  }

  const headerB64 = btoa(JSON.stringify(header))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  const payloadB64 = btoa(JSON.stringify(fullPayload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  const signature = 'mock-signature-for-testing'

  return `${headerB64}.${payloadB64}.${signature}`
}

// ============================================================================
// Full Proxy Flow Tests
// ============================================================================

describe('Full Proxy Flow', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let mockCaches: ReturnType<typeof createMockCaches>
  let subrequestCount: number

  beforeEach(() => {
    subrequestCount = 0
    mockCaches = createMockCaches()

    // Count subrequests and respond appropriately
    mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      subrequestCount++
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      // Config fetch
      if (url === '/proxy-config.json' || url.endsWith('/proxy-config.json')) {
        return new Response(JSON.stringify(TEST_CONFIG), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Target API response
      return new Response(JSON.stringify({ data: 'test-response' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads config, matches route, transforms, applies policy, forwards', async () => {
    const jwt = createTestJwt({ sub: 'user_123' })
    const request = new Request('https://example.com/api/test/resource', {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    const env = createMockEnv()
    const ctx = createMockContext()

    const response = await proxySnippet.fetch(request, env, ctx)

    // Should have matched route and applied transforms
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Proxied')).toBe('true')

    // Target should have received transformed request
    expect(mockFetch).toHaveBeenCalled()
    const forwardedRequest = mockFetch.mock.calls.find(
      (call: unknown[]) => !(call[0] as string).includes('proxy-config.json')
    )
    expect(forwardedRequest).toBeDefined()
  })

  it('short-circuits on policy rejection', async () => {
    // No JWT token - should be rejected by auth:jwt policy
    const request = new Request('https://example.com/api/test/resource')
    const env = createMockEnv()
    const ctx = createMockContext()

    const response = await proxySnippet.fetch(request, env, ctx)

    // Should return 401 without forwarding to target
    expect(response.status).toBe(401)

    // Should not have forwarded to target API
    const targetCalls = mockFetch.mock.calls.filter(
      (call: unknown[]) => !(call[0] as string).includes('proxy-config.json')
    )
    expect(targetCalls.length).toBe(0)
  })

  it('passes through unmatched routes', async () => {
    const request = new Request('https://example.com/unmatched/path')
    const env = createMockEnv()
    const ctx = createMockContext()

    const response = await proxySnippet.fetch(request, env, ctx)

    // Should passthrough to origin
    expect(response.status).toBe(200)
    expect(mockFetch).toHaveBeenCalled()
  })

  it('handles target errors gracefully', async () => {
    mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url === '/proxy-config.json') {
        return new Response(JSON.stringify(TEST_CONFIG), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Target returns error
      return new Response('Internal Server Error', { status: 500 })
    })
    vi.stubGlobal('fetch', mockFetch)

    const request = new Request('https://example.com/api/public/resource')
    const env = createMockEnv()
    const ctx = createMockContext()

    const response = await proxySnippet.fetch(request, env, ctx)

    // Should forward the error response
    expect(response.status).toBe(500)
    // Response transforms should still be applied
    expect(response.headers.get('X-Public')).toBe('true')
  })

  it('applies multiple policies in order', async () => {
    const jwt = createTestJwt({ sub: 'user_123' })
    const request = new Request('https://example.com/api/admin/users', {
      headers: { Authorization: `Bearer ${jwt}` },
      cf: { country: 'US' } as RequestInit['cf'],
    })
    const env = createMockEnv()
    const ctx = createMockContext()

    // Mock CF data
    Object.defineProperty(request, 'cf', {
      value: { country: 'US' },
      writable: true,
    })

    const response = await proxySnippet.fetch(request, env, ctx)

    // Should pass both JWT and geoBlock policies
    expect(response.status).toBe(200)
  })

  it('blocks on config path (security)', async () => {
    const request = new Request('https://example.com/proxy-config.json')
    const env = createMockEnv()
    const ctx = createMockContext()

    const response = await proxySnippet.fetch(request, env, ctx)

    // Should NOT expose config to external requests
    expect(response.status).toBe(404)
  })
})

// ============================================================================
// Subrequest Budget Tests
// ============================================================================

describe('Subrequest Budget', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let mockCaches: ReturnType<typeof createMockCaches>
  let subrequestCount: number

  beforeEach(() => {
    subrequestCount = 0
    mockCaches = createMockCaches()

    mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      subrequestCount++
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url === '/proxy-config.json' || url.endsWith('/proxy-config.json')) {
        return new Response(JSON.stringify(TEST_CONFIG), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('OK', { status: 200 })
    })

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses 0 subrequests when config is memory-cached', async () => {
    // Pre-warm the config cache by making a request first
    const warmupRequest = new Request('https://example.com/api/public/warmup')
    const env = createMockEnv()
    const ctx = createMockContext()

    await proxySnippet.fetch(warmupRequest, env, ctx)

    // Reset counter after warmup
    subrequestCount = 0

    // Second request should use memory-cached config
    const request = new Request('https://example.com/api/public/resource')
    await proxySnippet.fetch(request, env, ctx)

    // Should only have 1 subrequest (target forward), not config fetch
    // Config fetch count should be 0 for this request
    const configFetches = mockFetch.mock.calls.filter((call: unknown[]) =>
      (call[0] as string).includes('proxy-config.json')
    ).length

    // After warmup, no new config fetches should occur
    expect(configFetches).toBeLessThanOrEqual(1) // At most 1 from warmup
  })

  it('uses 1 subrequest for cold config fetch', async () => {
    const request = new Request('https://example.com/api/public/resource')
    const env = createMockEnv()
    const ctx = createMockContext()

    await proxySnippet.fetch(request, env, ctx)

    // Should have fetched config once
    const configFetches = mockFetch.mock.calls.filter((call: unknown[]) =>
      (call[0] as string).includes('proxy-config.json')
    ).length

    expect(configFetches).toBe(1)
  })

  it('uses 1 subrequest for cache.match on rate limit', async () => {
    const configWithRateLimit = {
      ...TEST_CONFIG,
      routes: [
        {
          id: 'rate-limited',
          match: { path: '^/api/limited' },
          policies: ['rateLimit:check'],
          target: { type: 'passthrough' },
        },
      ],
      policies: {
        ...TEST_CONFIG.policies,
        'rateLimit:check': {
          type: 'rateLimitCache',
          keyFrom: '$cf.ip',
        },
      },
    }

    mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url === '/proxy-config.json') {
        return new Response(JSON.stringify(configWithRateLimit), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('OK', { status: 200 })
    })
    vi.stubGlobal('fetch', mockFetch)

    const request = new Request('https://example.com/api/limited/resource')
    const env = createMockEnv()
    const ctx = createMockContext()

    await proxySnippet.fetch(request, env, ctx)

    // Cache.match should have been called for rate limit check
    expect(mockCaches.default.match).toHaveBeenCalled()
  })

  it('uses 1 subrequest for target forward', async () => {
    const request = new Request('https://example.com/api/public/resource')
    const env = createMockEnv()
    const ctx = createMockContext()

    await proxySnippet.fetch(request, env, ctx)

    // Should have forwarded to target
    const targetFetches = mockFetch.mock.calls.filter(
      (call: unknown[]) => !(call[0] as string).includes('proxy-config.json')
    ).length

    expect(targetFetches).toBe(1)
  })

  it('never exceeds 2 total subrequests', async () => {
    // Worst case: cold start with rate limit policy
    const configWithRateLimit = {
      ...TEST_CONFIG,
      routes: [
        {
          id: 'rate-limited',
          match: { path: '^/api/limited' },
          policies: ['rateLimit:check'],
          target: { type: 'passthrough' },
        },
      ],
      policies: {
        'rateLimit:check': {
          type: 'rateLimitCache',
          keyFrom: '$cf.ip',
        },
      },
    }

    mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      subrequestCount++
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url === '/proxy-config.json') {
        return new Response(JSON.stringify(configWithRateLimit), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('OK', { status: 200 })
    })
    vi.stubGlobal('fetch', mockFetch)

    subrequestCount = 0

    const request = new Request('https://example.com/api/limited/resource')
    const env = createMockEnv()
    const ctx = createMockContext()

    await proxySnippet.fetch(request, env, ctx)

    // Cold config fetch + target forward = 2 (cache.match doesn't count as subrequest)
    expect(subrequestCount).toBeLessThanOrEqual(2)
  })
})

// ============================================================================
// Config Passthrough Tests
// ============================================================================

describe('Config Passthrough on Error', () => {
  it('passes through when config fetch fails', async () => {
    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url === '/proxy-config.json') {
        return new Response('Not Found', { status: 404 })
      }

      return new Response('Origin Response', { status: 200 })
    })
    vi.stubGlobal('fetch', mockFetch)

    const request = new Request('https://example.com/any/path')
    const env = createMockEnv()
    const ctx = createMockContext()

    const response = await proxySnippet.fetch(request, env, ctx)

    // Should passthrough to origin when config fails
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toBe('Origin Response')
  })
})

// ============================================================================
// Route Priority Tests
// ============================================================================

describe('Route Priority in Integration', () => {
  it('matches higher priority routes first', async () => {
    const jwt = createTestJwt({ sub: 'user_123' })
    const request = new Request('https://example.com/api/admin/resource', {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    const env = createMockEnv()
    const ctx = createMockContext()

    // Mock CF data for geo policy
    Object.defineProperty(request, 'cf', {
      value: { country: 'US' },
      writable: true,
    })

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url === '/proxy-config.json') {
        return new Response(JSON.stringify(TEST_CONFIG), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Admin Response', { status: 200 })
    })
    vi.stubGlobal('fetch', mockFetch)

    const response = await proxySnippet.fetch(request, env, ctx)

    // admin-api route has priority 100, should match before other routes
    expect(response.status).toBe(200)
  })
})

// ============================================================================
// Transform Chain Tests
// ============================================================================

describe('Transform Chain in Integration', () => {
  it('applies request and response transforms correctly', async () => {
    let capturedRequestHeaders: Headers | null = null

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url === '/proxy-config.json') {
        return new Response(JSON.stringify(TEST_CONFIG), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Capture forwarded request headers
      if (input instanceof Request) {
        capturedRequestHeaders = input.headers
      }

      return new Response('OK', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    })
    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', createMockCaches())

    const jwt = createTestJwt({ sub: 'user_123' })
    const request = new Request('https://example.com/api/test/resource', {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    const env = createMockEnv()
    const ctx = createMockContext()

    const response = await proxySnippet.fetch(request, env, ctx)

    // Request transform should have added X-Test header
    expect(capturedRequestHeaders?.get('X-Test')).toBeDefined()

    // Response transform should have added X-Proxied header
    expect(response.headers.get('X-Proxied')).toBe('true')
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Integration Edge Cases', () => {
  beforeEach(() => {
    vi.stubGlobal('caches', createMockCaches())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('handles empty routes array', async () => {
    const emptyConfig = {
      version: 'empty',
      ttl: 60,
      routes: [],
      policies: {},
    }

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url === '/proxy-config.json') {
        return new Response(JSON.stringify(emptyConfig), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Origin', { status: 200 })
    })
    vi.stubGlobal('fetch', mockFetch)

    const request = new Request('https://example.com/any/path')
    const env = createMockEnv()
    const ctx = createMockContext()

    const response = await proxySnippet.fetch(request, env, ctx)

    // Should passthrough to origin
    expect(response.status).toBe(200)
  })

  it('handles concurrent requests correctly', async () => {
    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url === '/proxy-config.json') {
        // Simulate slow config fetch
        await new Promise((resolve) => setTimeout(resolve, 10))
        return new Response(JSON.stringify(TEST_CONFIG), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('OK', { status: 200 })
    })
    vi.stubGlobal('fetch', mockFetch)

    const env = createMockEnv()

    // Make multiple concurrent requests
    const requests = Array.from({ length: 5 }, (_, i) =>
      proxySnippet.fetch(
        new Request(`https://example.com/api/public/resource/${i}`),
        env,
        createMockContext()
      )
    )

    const responses = await Promise.all(requests)

    // All should succeed
    responses.forEach((response) => {
      expect(response.status).toBe(200)
    })
  })

  it('preserves request body through proxy', async () => {
    let capturedBody: string | null = null

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url === '/proxy-config.json') {
        return new Response(JSON.stringify(TEST_CONFIG), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (input instanceof Request) {
        capturedBody = await input.text()
      }

      return new Response('OK', { status: 200 })
    })
    vi.stubGlobal('fetch', mockFetch)

    const requestBody = JSON.stringify({ data: 'test-payload' })
    const request = new Request('https://example.com/api/public/resource', {
      method: 'POST',
      body: requestBody,
      headers: { 'Content-Type': 'application/json' },
    })
    const env = createMockEnv()
    const ctx = createMockContext()

    await proxySnippet.fetch(request, env, ctx)

    expect(capturedBody).toBe(requestBody)
  })
})
