import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getConfig,
  resetConfigCache,
  type ProxyConfig,
} from '../../proxy'

/**
 * Config Loading Tests (GREEN Phase)
 *
 * Tests for the config loading and caching mechanism of the proxy snippet.
 * The config should be fetched from /proxy-config.json and cached at multiple layers.
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

const testConfig: ProxyConfig = {
  version: 'test-v1',
  ttl: 60,
  routes: [
    {
      id: 'test-route',
      match: { path: '^/api/test' },
    },
  ],
  policies: {},
}

describe('Config Loading', () => {
  beforeEach(() => {
    vi.useFakeTimers()
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
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  })

  it('fetches config from /proxy-config.json on cold start', async () => {
    mockCachesMatch.mockResolvedValue(null)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(testConfig),
    })

    const config = await getConfig(mockCtx as unknown as ExecutionContext)

    expect(mockFetch).toHaveBeenCalledWith('/proxy-config.json')
    expect(config).toEqual(testConfig)
  })

  it('caches config in isolate memory after first fetch', async () => {
    mockCachesMatch.mockResolvedValue(null)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(testConfig),
    })

    // First call - fetches
    await getConfig(mockCtx as unknown as ExecutionContext)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Second call - uses memory cache
    await getConfig(mockCtx as unknown as ExecutionContext)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('respects config.ttl for cache expiration', async () => {
    const shortTtlConfig = { ...testConfig, ttl: 5 }
    mockCachesMatch.mockResolvedValue(null)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(shortTtlConfig),
    })

    // First call
    await getConfig(mockCtx as unknown as ExecutionContext)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Advance time past TTL
    vi.advanceTimersByTime(6000)

    // Should fetch again after TTL expires
    mockCachesMatch.mockResolvedValue(null)
    await getConfig(mockCtx as unknown as ExecutionContext)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('uses Cache API for cross-isolate caching', async () => {
    const cachedResponse = {
      json: () => Promise.resolve(testConfig),
    }
    mockCachesMatch.mockResolvedValue(cachedResponse)

    const config = await getConfig(mockCtx as unknown as ExecutionContext)

    expect(mockCachesMatch).toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(config).toEqual(testConfig)
  })

  it('refreshes config after TTL expires', async () => {
    mockCachesMatch.mockResolvedValue(null)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(testConfig),
    })

    // Initial fetch
    await getConfig(mockCtx as unknown as ExecutionContext)

    // Advance past TTL
    vi.advanceTimersByTime(61000)

    // Should check Cache API again
    mockCachesMatch.mockResolvedValue(null)
    await getConfig(mockCtx as unknown as ExecutionContext)

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('handles config fetch errors gracefully (passthrough)', async () => {
    mockCachesMatch.mockResolvedValue(null)
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    })

    await expect(getConfig(mockCtx as unknown as ExecutionContext)).rejects.toThrow(
      'Config fetch failed'
    )
  })

  it('populates Cache API in background after fetch', async () => {
    mockCachesMatch.mockResolvedValue(null)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(testConfig),
    })

    await getConfig(mockCtx as unknown as ExecutionContext)

    expect(mockWaitUntil).toHaveBeenCalled()
    expect(mockCachesPut).toHaveBeenCalled()
  })
})
