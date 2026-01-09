import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getConfig,
  clearConfigCache,
  CONFIG_CACHE_KEY,
  type ProxyConfig,
} from '../proxy'

/**
 * Config Loading Tests (RED Phase)
 *
 * The proxy snippet loads configuration from /proxy-config.json at runtime.
 * Config is cached in multiple layers:
 * 1. Isolate memory (fastest, lives for isolate lifetime)
 * 2. Cache API (cross-isolate, respects TTL)
 * 3. Static assets fetch (1 subrequest)
 *
 * These tests are expected to FAIL until the proxy snippet is implemented.
 */

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_CONFIG: ProxyConfig = {
  version: 'test-v1',
  ttl: 60,
  routes: [
    {
      id: 'api-customers',
      priority: 100,
      match: {
        path: '^/api/v1/customers(?:/|$)',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
      },
      target: { type: 'passthrough' },
      transforms: {
        request: [{ op: 'setHeader', name: 'X-Request-Id', value: '$requestId' }],
        response: [{ op: 'setHeader', name: 'X-Served-By', value: 'dotdo' }],
      },
      policies: ['auth:jwt'],
    },
  ],
  policies: {
    'auth:jwt': {
      type: 'jwt',
      algorithm: 'RS256',
      publicKey: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----',
    },
  },
  variables: {
    domain: 'example.com',
  },
}

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockContext() {
  return {
    waitUntil: vi.fn(),
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

// ============================================================================
// Config Fetching Tests
// ============================================================================

describe('Config Loading', () => {
  beforeEach(() => {
    // Reset config cache before each test
    clearConfigCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches config from /proxy-config.json on cold start', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(TEST_CONFIG), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    // Replace global fetch and caches
    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    const config = await getConfig(ctx)

    // Should have fetched from /proxy-config.json
    expect(mockFetch).toHaveBeenCalledWith('/proxy-config.json')
    expect(config.version).toBe('test-v1')
    expect(config.ttl).toBe(60)
  })

  it('caches config in isolate memory after first fetch', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(TEST_CONFIG), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    // First call - should fetch
    const config1 = await getConfig(ctx)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Second call - should use memory cache
    const config2 = await getConfig(ctx)
    expect(mockFetch).toHaveBeenCalledTimes(1) // No additional fetch
    expect(config1).toEqual(config2)
  })

  it('respects config.ttl for cache expiration', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()
    const shortTtlConfig = { ...TEST_CONFIG, ttl: 1 } // 1 second TTL
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(shortTtlConfig), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    // First call
    await getConfig(ctx)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Advance time past TTL
    vi.useFakeTimers()
    vi.advanceTimersByTime(1100) // 1.1 seconds

    // Second call - should refetch due to TTL expiration
    await getConfig(ctx)
    expect(mockFetch).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('uses Cache API for cross-isolate caching', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(TEST_CONFIG), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    await getConfig(ctx)

    // Should populate Cache API in waitUntil
    expect(ctx.waitUntil).toHaveBeenCalled()
    expect(mockCaches.default.put).toHaveBeenCalled()

    // The cache key should be the config cache key
    const putCalls = mockCaches.default.put.mock.calls
    expect(putCalls.length).toBeGreaterThan(0)
    const cacheKey = putCalls[0][0]
    expect(cacheKey.url || cacheKey).toContain(CONFIG_CACHE_KEY)
  })

  it('refreshes config after TTL expires', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()

    // First response
    const v1Config = { ...TEST_CONFIG, version: 'v1', ttl: 1 }
    // Second response after TTL
    const v2Config = { ...TEST_CONFIG, version: 'v2', ttl: 1 }

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(v1Config), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(v2Config), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    vi.useFakeTimers()

    // First call
    const config1 = await getConfig(ctx)
    expect(config1.version).toBe('v1')

    // Advance time past TTL
    vi.advanceTimersByTime(1100)

    // Second call - should get new version
    const config2 = await getConfig(ctx)
    expect(config2.version).toBe('v2')

    vi.useRealTimers()
  })

  it('handles config fetch errors gracefully (passthrough)', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Not Found', {
        status: 404,
      })
    )

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    // Should throw an error that can be caught
    await expect(getConfig(ctx)).rejects.toThrow()
  })

  it('validates config against JSON schema', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()

    // Invalid config - missing required fields
    const invalidConfig = {
      version: 'test',
      // Missing: ttl, routes
    }

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(invalidConfig), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    // Should throw validation error
    await expect(getConfig(ctx)).rejects.toThrow(/invalid|schema|validation/i)
  })

  it('uses cached config from Cache API on memory miss', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()

    // Pre-populate Cache API
    const cachedResponse = new Response(JSON.stringify(TEST_CONFIG), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=60',
      },
    })
    mockCaches._store.set(CONFIG_CACHE_KEY, cachedResponse)

    const mockFetch = vi.fn()

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    // Memory cache is empty (cold isolate), should use Cache API
    const config = await getConfig(ctx)

    // Should NOT have fetched - used Cache API
    expect(mockFetch).not.toHaveBeenCalled()
    expect(config.version).toBe('test-v1')
  })

  it('handles Cache API errors gracefully', async () => {
    const ctx = createMockContext()
    const mockCaches = {
      default: {
        match: vi.fn().mockRejectedValue(new Error('Cache API unavailable')),
        put: vi.fn(),
      },
    }
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(TEST_CONFIG), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    // Should fall back to fetch when Cache API fails
    const config = await getConfig(ctx)

    expect(mockFetch).toHaveBeenCalled()
    expect(config.version).toBe('test-v1')
  })

  it('handles network timeout on config fetch', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()
    const mockFetch = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Network timeout')), 100)
        })
    )

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    await expect(getConfig(ctx)).rejects.toThrow(/timeout|network/i)
  })

  it('parses JSON config correctly', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(TEST_CONFIG), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    const config = await getConfig(ctx)

    // Verify all config fields are parsed correctly
    expect(config.version).toBe('test-v1')
    expect(config.ttl).toBe(60)
    expect(config.routes).toHaveLength(1)
    expect(config.routes[0].id).toBe('api-customers')
    expect(config.routes[0].match.path).toBe('^/api/v1/customers(?:/|$)')
    expect(config.policies['auth:jwt'].type).toBe('jwt')
    expect(config.variables?.domain).toBe('example.com')
  })

  it('handles malformed JSON gracefully', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{ invalid json }', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    await expect(getConfig(ctx)).rejects.toThrow()
  })
})

// ============================================================================
// Cache Key Generation Tests
// ============================================================================

describe('Config Cache Key', () => {
  it('uses consistent cache key for config', () => {
    // The cache key should be a constant URL
    expect(CONFIG_CACHE_KEY).toBeDefined()
    expect(typeof CONFIG_CACHE_KEY).toBe('string')
    expect(CONFIG_CACHE_KEY).toMatch(/^https?:\/\//)
  })
})

// ============================================================================
// Default TTL Tests
// ============================================================================

describe('Config TTL Handling', () => {
  beforeEach(() => {
    clearConfigCache()
    vi.restoreAllMocks()
  })

  it('uses default TTL when not specified in config', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()
    const configWithoutTtl = {
      version: 'test',
      routes: [],
      policies: {},
      // ttl is missing - should use default
    }
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(configWithoutTtl), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    const config = await getConfig(ctx)

    // Should still work with default TTL
    expect(config.version).toBe('test')
    // The cache should be populated with default TTL
    expect(ctx.waitUntil).toHaveBeenCalled()
  })
})
