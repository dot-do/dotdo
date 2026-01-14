import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  fetchNounConfig,
  clearNounConfigCache,
  getNounConfigCacheStats,
  type NounConfig,
} from '../utils/router'
import type { Env } from '../types'

/**
 * Tests for the noun config cache with TTL, LRU eviction, and race condition handling
 */

// Mock environment factory
function createMockEnv(mockResponse?: { items: NounConfig[] } | NounConfig[]): Env {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockResponse ?? { items: [] }),
  })

  const mockStub = {
    fetch: mockFetch,
  }

  return {
    DO: {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'test-id' }),
      get: vi.fn().mockReturnValue(mockStub),
    } as unknown as DurableObjectNamespace,
  } as Env
}

// Sample noun configs for testing
const sampleNounConfigs: NounConfig[] = [
  {
    noun: 'Customer',
    plural: 'customers',
    doClass: null,
    sharded: false,
    shardCount: 1,
    shardKey: null,
    storage: 'primary',
    ttlDays: null,
    nsStrategy: 'tenant',
  },
  {
    noun: 'Product',
    plural: 'products',
    doClass: null,
    sharded: false,
    shardCount: 1,
    shardKey: null,
    storage: 'primary',
    ttlDays: null,
    nsStrategy: 'tenant',
  },
]

describe('Noun Config Cache', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearNounConfigCache()
    // Reset mocks
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  describe('Basic caching', () => {
    it('returns cached value on subsequent calls', async () => {
      const env = createMockEnv({ items: sampleNounConfigs })

      // First call - should fetch from DO
      const result1 = await fetchNounConfig(env, 'tenant1')
      expect(result1.size).toBe(2)
      expect(env.DO?.idFromName).toHaveBeenCalledTimes(1)

      // Second call - should use cache
      const result2 = await fetchNounConfig(env, 'tenant1')
      expect(result2.size).toBe(2)
      // Should not have called idFromName again
      expect(env.DO?.idFromName).toHaveBeenCalledTimes(1)
    })

    it('caches different tenants separately', async () => {
      const env = createMockEnv({ items: sampleNounConfigs })

      await fetchNounConfig(env, 'tenant1')
      await fetchNounConfig(env, 'tenant2')

      // Should have fetched for both tenants
      expect(env.DO?.idFromName).toHaveBeenCalledTimes(2)

      const stats = getNounConfigCacheStats()
      expect(stats.size).toBe(2)
    })

    it('returns empty map when env.DO is not available', async () => {
      const env = {} as Env

      const result = await fetchNounConfig(env, 'tenant1')
      expect(result.size).toBe(0)
    })
  })

  describe('TTL expiration', () => {
    it('refetches after TTL expires', async () => {
      vi.useFakeTimers()
      const env = createMockEnv({ items: sampleNounConfigs })

      // First fetch
      await fetchNounConfig(env, 'tenant1')
      expect(env.DO?.idFromName).toHaveBeenCalledTimes(1)

      // Advance time past TTL (5 minutes + 1ms)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1)

      // Should refetch after TTL
      await fetchNounConfig(env, 'tenant1')
      expect(env.DO?.idFromName).toHaveBeenCalledTimes(2)
    })

    it('uses cache before TTL expires', async () => {
      vi.useFakeTimers()
      const env = createMockEnv({ items: sampleNounConfigs })

      // First fetch
      await fetchNounConfig(env, 'tenant1')
      expect(env.DO?.idFromName).toHaveBeenCalledTimes(1)

      // Advance time less than TTL (4 minutes)
      vi.advanceTimersByTime(4 * 60 * 1000)

      // Should still use cache
      await fetchNounConfig(env, 'tenant1')
      expect(env.DO?.idFromName).toHaveBeenCalledTimes(1)
    })
  })

  describe('LRU eviction', () => {
    it('evicts oldest entries when exceeding max size', async () => {
      const env = createMockEnv({ items: sampleNounConfigs })

      // Fill cache beyond max (100 entries)
      for (let i = 0; i < 105; i++) {
        await fetchNounConfig(env, `tenant${i}`)
      }

      const stats = getNounConfigCacheStats()
      // Should have evicted oldest entries to stay at max
      expect(stats.size).toBeLessThanOrEqual(stats.maxSize)
    })

    it('updates LRU order on cache hit', async () => {
      vi.useFakeTimers()
      const env = createMockEnv({ items: sampleNounConfigs })

      // Create entries for tenant1, tenant2, tenant3
      await fetchNounConfig(env, 'tenant1')
      vi.advanceTimersByTime(1) // Ensure different timestamps
      await fetchNounConfig(env, 'tenant2')
      vi.advanceTimersByTime(1)
      await fetchNounConfig(env, 'tenant3')

      // Access tenant1 again to move it to the end
      vi.advanceTimersByTime(1)
      await fetchNounConfig(env, 'tenant1')

      // Verify tenant1 was not refetched (cache hit)
      // tenant1 was called once initially, then tenant2 and tenant3
      // tenant1 second call should be a cache hit
      expect(env.DO?.idFromName).toHaveBeenCalledTimes(3)
    })
  })

  describe('Race condition handling', () => {
    it('deduplicates concurrent requests for the same tenant', async () => {
      let resolvePromise: () => void
      const delayedPromise = new Promise<void>((resolve) => {
        resolvePromise = resolve
      })

      const env = createMockEnv({ items: sampleNounConfigs })
      const originalGet = env.DO!.get as ReturnType<typeof vi.fn>
      originalGet.mockImplementation(() => ({
        fetch: async () => {
          await delayedPromise
          return {
            ok: true,
            json: () => Promise.resolve({ items: sampleNounConfigs }),
          }
        },
      }))

      // Start multiple concurrent requests
      const promise1 = fetchNounConfig(env, 'tenant1')
      const promise2 = fetchNounConfig(env, 'tenant1')
      const promise3 = fetchNounConfig(env, 'tenant1')

      // Resolve the delayed fetch
      resolvePromise!()

      // All should resolve to the same result
      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3])

      expect(result1).toBe(result2)
      expect(result2).toBe(result3)

      // Should only have made one fetch call
      expect(env.DO?.idFromName).toHaveBeenCalledTimes(1)
    })

    it('allows new request after failed fetch is cleaned up', async () => {
      const env = createMockEnv()
      let callCount = 0

      const originalGet = env.DO!.get as ReturnType<typeof vi.fn>
      originalGet.mockImplementation(() => ({
        fetch: async () => {
          callCount++
          if (callCount === 1) {
            return { ok: false, status: 500 }
          }
          return {
            ok: true,
            json: () => Promise.resolve({ items: sampleNounConfigs }),
          }
        },
      }))

      // First request fails
      const result1 = await fetchNounConfig(env, 'tenant1')
      expect(result1.size).toBe(0)

      // Second request should work
      const result2 = await fetchNounConfig(env, 'tenant1')
      expect(result2.size).toBe(2)

      // Should have made two fetch calls
      expect(callCount).toBe(2)
    })
  })

  describe('Cache stats', () => {
    it('returns correct cache statistics', () => {
      const stats = getNounConfigCacheStats()

      expect(stats).toHaveProperty('size')
      expect(stats).toHaveProperty('maxSize')
      expect(stats).toHaveProperty('ttlMs')

      expect(stats.size).toBe(0)
      expect(stats.maxSize).toBe(100)
      expect(stats.ttlMs).toBe(5 * 60 * 1000)
    })

    it('updates size after fetching', async () => {
      const env = createMockEnv({ items: sampleNounConfigs })

      await fetchNounConfig(env, 'tenant1')
      expect(getNounConfigCacheStats().size).toBe(1)

      await fetchNounConfig(env, 'tenant2')
      expect(getNounConfigCacheStats().size).toBe(2)
    })
  })

  describe('clearNounConfigCache', () => {
    it('clears all cached entries', async () => {
      const env = createMockEnv({ items: sampleNounConfigs })

      await fetchNounConfig(env, 'tenant1')
      await fetchNounConfig(env, 'tenant2')
      expect(getNounConfigCacheStats().size).toBe(2)

      clearNounConfigCache()
      expect(getNounConfigCacheStats().size).toBe(0)
    })

    it('forces refetch after clear', async () => {
      const env = createMockEnv({ items: sampleNounConfigs })

      await fetchNounConfig(env, 'tenant1')
      expect(env.DO?.idFromName).toHaveBeenCalledTimes(1)

      clearNounConfigCache()

      await fetchNounConfig(env, 'tenant1')
      expect(env.DO?.idFromName).toHaveBeenCalledTimes(2)
    })
  })
})
