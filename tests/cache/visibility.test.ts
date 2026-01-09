import { describe, it, expect, beforeEach } from 'vitest'
import {
  VisibilityCache,
  createVisibilityCache,
  createSeparatedCachePools,
  buildCacheKey,
  parseCacheKey,
  hashContext,
  validateVisibility,
  validateCacheContext,
  getTTLForVisibility,
  DEFAULT_TTL_CONFIG,
  VISIBILITY_PREFIXES,
  type Visibility,
  type CacheContext,
} from '../../lib/cache/visibility'

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('Cache Key Building', () => {
  describe('buildCacheKey', () => {
    it('builds key for public visibility (shared cache)', () => {
      const key = buildCacheKey('products:featured', 'public')

      expect(key).toBe('pub:public::products:featured')
      expect(key).not.toContain('user')
      expect(key).not.toContain('org')
    })

    it('builds key for unlisted visibility (per-item cache)', () => {
      const key = buildCacheKey('documents:abc123', 'unlisted')

      expect(key).toBe('unl:unlisted::documents:abc123')
    })

    it('builds key for org visibility with orgId in key', () => {
      const key = buildCacheKey('customers:list', 'org', { orgId: 'org-123' })

      expect(key).toBe('org:org:o:org-123:customers:list')
      expect(key).toContain('org-123')
    })

    it('builds key for user visibility with userId in key', () => {
      const key = buildCacheKey('settings', 'user', { userId: 'user-456' })

      expect(key).toBe('usr:user:u:user-456:settings')
      expect(key).toContain('user-456')
    })

    it('includes pool prefix when provided', () => {
      const key = buildCacheKey('data', 'public', undefined, 'analytics')

      expect(key).toBe('analytics:pub:public::data')
    })

    it('includes both userId and orgId when both provided', () => {
      const key = buildCacheKey('dashboard', 'org', {
        userId: 'user-1',
        orgId: 'org-2',
      })

      expect(key).toContain('user-1')
      expect(key).toContain('org-2')
    })
  })

  describe('parseCacheKey', () => {
    it('parses public cache key', () => {
      const parsed = parseCacheKey('pub:public::products:featured')

      expect(parsed).toEqual({
        visibility: 'public',
        contextHash: '',
        key: 'products:featured',
      })
    })

    it('parses org cache key', () => {
      const parsed = parseCacheKey('org:org:o:org-123:customers:list')

      expect(parsed).toEqual({
        visibility: 'org',
        contextHash: 'o:org-123',
        key: 'customers:list',
      })
    })

    it('parses user cache key', () => {
      const parsed = parseCacheKey('usr:user:u:user-456:settings')

      expect(parsed).toEqual({
        visibility: 'user',
        contextHash: 'u:user-456',
        key: 'settings',
      })
    })

    it('returns null for invalid key', () => {
      const parsed = parseCacheKey('invalid:key:format')

      expect(parsed).toBeNull()
    })
  })

  describe('hashContext', () => {
    it('returns empty string for undefined context', () => {
      expect(hashContext(undefined)).toBe('')
    })

    it('returns empty string for empty context', () => {
      expect(hashContext({})).toBe('')
    })

    it('hashes userId', () => {
      const hash = hashContext({ userId: 'user-123' })

      expect(hash).toBe('u:user-123')
    })

    it('hashes orgId', () => {
      const hash = hashContext({ orgId: 'org-456' })

      expect(hash).toBe('o:org-456')
    })

    it('hashes both userId and orgId', () => {
      const hash = hashContext({ userId: 'user-123', orgId: 'org-456' })

      expect(hash).toBe('u:user-123:o:org-456')
    })
  })
})

describe('Visibility Validation', () => {
  describe('validateVisibility', () => {
    it('accepts valid visibility levels', () => {
      expect(validateVisibility('public')).toBe(true)
      expect(validateVisibility('unlisted')).toBe(true)
      expect(validateVisibility('org')).toBe(true)
      expect(validateVisibility('user')).toBe(true)
    })

    it('rejects invalid visibility levels', () => {
      expect(validateVisibility('private')).toBe(false)
      expect(validateVisibility('internal')).toBe(false)
      expect(validateVisibility('')).toBe(false)
      expect(validateVisibility(null)).toBe(false)
      expect(validateVisibility(undefined)).toBe(false)
      expect(validateVisibility(123)).toBe(false)
    })
  })

  describe('validateCacheContext', () => {
    it('does not throw for public visibility without context', () => {
      expect(() => validateCacheContext('public')).not.toThrow()
      expect(() => validateCacheContext('public', {})).not.toThrow()
    })

    it('does not throw for unlisted visibility without context', () => {
      expect(() => validateCacheContext('unlisted')).not.toThrow()
    })

    it('throws for org visibility without orgId', () => {
      expect(() => validateCacheContext('org')).toThrow(
        'Org context (orgId) required for org visibility caching'
      )
      expect(() => validateCacheContext('org', { userId: 'user-1' })).toThrow()
    })

    it('does not throw for org visibility with orgId', () => {
      expect(() => validateCacheContext('org', { orgId: 'org-1' })).not.toThrow()
    })

    it('throws for user visibility without userId', () => {
      expect(() => validateCacheContext('user')).toThrow(
        'User context (userId) required for user visibility caching'
      )
      expect(() => validateCacheContext('user', { orgId: 'org-1' })).toThrow()
    })

    it('does not throw for user visibility with userId', () => {
      expect(() => validateCacheContext('user', { userId: 'user-1' })).not.toThrow()
    })
  })
})

describe('TTL Configuration', () => {
  describe('getTTLForVisibility', () => {
    it('returns default TTLs', () => {
      expect(getTTLForVisibility('public')).toBe(3600) // 1 hour
      expect(getTTLForVisibility('unlisted')).toBe(600) // 10 minutes
      expect(getTTLForVisibility('org')).toBe(300) // 5 minutes
      expect(getTTLForVisibility('user')).toBe(300) // 5 minutes
    })

    it('uses custom TTL config', () => {
      const customConfig = {
        public: 7200,
        unlisted: 1200,
        org: 600,
        user: 600,
      }

      expect(getTTLForVisibility('public', customConfig)).toBe(7200)
      expect(getTTLForVisibility('unlisted', customConfig)).toBe(1200)
    })
  })

  describe('DEFAULT_TTL_CONFIG', () => {
    it('has correct default values', () => {
      expect(DEFAULT_TTL_CONFIG.public).toBe(3600)
      expect(DEFAULT_TTL_CONFIG.unlisted).toBe(600)
      expect(DEFAULT_TTL_CONFIG.org).toBe(300)
      expect(DEFAULT_TTL_CONFIG.user).toBe(300)
    })
  })

  describe('VISIBILITY_PREFIXES', () => {
    it('has correct prefixes', () => {
      expect(VISIBILITY_PREFIXES.public).toBe('pub')
      expect(VISIBILITY_PREFIXES.unlisted).toBe('unl')
      expect(VISIBILITY_PREFIXES.org).toBe('org')
      expect(VISIBILITY_PREFIXES.user).toBe('usr')
    })
  })
})

// ============================================================================
// VisibilityCache Class Tests
// ============================================================================

describe('VisibilityCache', () => {
  let cache: VisibilityCache

  beforeEach(() => {
    cache = new VisibilityCache()
  })

  describe('Basic Operations', () => {
    describe('set and get', () => {
      it('caches and retrieves public data', async () => {
        await cache.set({
          key: 'products',
          visibility: 'public',
          data: [{ id: 1, name: 'Product 1' }],
        })

        const result = await cache.get<{ id: number; name: string }[]>({
          key: 'products',
          visibility: 'public',
        })

        expect(result).toEqual([{ id: 1, name: 'Product 1' }])
      })

      it('caches and retrieves unlisted data', async () => {
        await cache.set({
          key: 'doc:secret-link',
          visibility: 'unlisted',
          data: { content: 'secret' },
        })

        const result = await cache.get({
          key: 'doc:secret-link',
          visibility: 'unlisted',
        })

        expect(result).toEqual({ content: 'secret' })
      })

      it('caches and retrieves org-scoped data', async () => {
        const context: CacheContext = { orgId: 'org-123' }

        await cache.set({
          key: 'customers',
          visibility: 'org',
          context,
          data: [{ id: 1, name: 'Customer 1' }],
        })

        const result = await cache.get({
          key: 'customers',
          visibility: 'org',
          context,
        })

        expect(result).toEqual([{ id: 1, name: 'Customer 1' }])
      })

      it('caches and retrieves user-scoped data', async () => {
        const context: CacheContext = { userId: 'user-456' }

        await cache.set({
          key: 'settings',
          visibility: 'user',
          context,
          data: { theme: 'dark' },
        })

        const result = await cache.get({
          key: 'settings',
          visibility: 'user',
          context,
        })

        expect(result).toEqual({ theme: 'dark' })
      })
    })

    describe('has', () => {
      it('returns true for existing entry', async () => {
        await cache.set({
          key: 'test',
          visibility: 'public',
          data: 'value',
        })

        const exists = await cache.has({
          key: 'test',
          visibility: 'public',
        })

        expect(exists).toBe(true)
      })

      it('returns false for non-existing entry', async () => {
        const exists = await cache.has({
          key: 'nonexistent',
          visibility: 'public',
        })

        expect(exists).toBe(false)
      })
    })

    describe('delete', () => {
      it('deletes cached entry', async () => {
        await cache.set({
          key: 'to-delete',
          visibility: 'public',
          data: 'value',
        })

        const deleted = await cache.delete({
          key: 'to-delete',
          visibility: 'public',
        })

        expect(deleted).toBe(true)
        expect(await cache.get({ key: 'to-delete', visibility: 'public' })).toBeUndefined()
      })

      it('returns false when deleting non-existing entry', async () => {
        const deleted = await cache.delete({
          key: 'nonexistent',
          visibility: 'public',
        })

        expect(deleted).toBe(false)
      })
    })
  })

  describe('Cache Isolation', () => {
    it('isolates public cache from org cache', async () => {
      await cache.set({
        key: 'data',
        visibility: 'public',
        data: 'public-value',
      })

      // Different visibility should not find the entry
      const result = await cache.get({
        key: 'data',
        visibility: 'org',
        context: { orgId: 'org-1' },
      })

      expect(result).toBeUndefined()
    })

    it('isolates org caches between different orgs', async () => {
      await cache.set({
        key: 'customers',
        visibility: 'org',
        context: { orgId: 'org-1' },
        data: [{ id: 1 }],
      })

      // Different org should not see the data
      const result = await cache.get({
        key: 'customers',
        visibility: 'org',
        context: { orgId: 'org-2' },
      })

      expect(result).toBeUndefined()
    })

    it('isolates user caches between different users', async () => {
      await cache.set({
        key: 'settings',
        visibility: 'user',
        context: { userId: 'user-1' },
        data: { theme: 'dark' },
      })

      // Different user should not see the data
      const result = await cache.get({
        key: 'settings',
        visibility: 'user',
        context: { userId: 'user-2' },
      })

      expect(result).toBeUndefined()
    })

    it('prevents cache leakage via key manipulation', async () => {
      await cache.set({
        key: 'secret',
        visibility: 'user',
        context: { userId: 'victim-user' },
        data: 'sensitive-data',
      })

      // Attacker trying to access with different context
      const result = await cache.get({
        key: 'secret',
        visibility: 'user',
        context: { userId: 'attacker-user' },
      })

      expect(result).toBeUndefined()
    })
  })

  describe('TTL and Expiration', () => {
    it('returns undefined for expired entries', async () => {
      // Create a cache with very short TTL for testing
      const shortTTLCache = new VisibilityCache({
        ttl: { public: 0.001, unlisted: 0.001, org: 0.001, user: 0.001 },
      })

      await shortTTLCache.set({
        key: 'expires-fast',
        visibility: 'public',
        data: 'value',
      })

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10))

      const result = await shortTTLCache.get({
        key: 'expires-fast',
        visibility: 'public',
      })

      expect(result).toBeUndefined()
    })

    it('respects custom TTL', async () => {
      await cache.set({
        key: 'custom-ttl',
        visibility: 'public',
        data: 'value',
        ttl: 0.001, // Very short TTL
      })

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10))

      const result = await cache.get({
        key: 'custom-ttl',
        visibility: 'public',
      })

      expect(result).toBeUndefined()
    })
  })

  describe('getOrSet', () => {
    it('returns cached value without calling compute', async () => {
      await cache.set({
        key: 'cached',
        visibility: 'public',
        data: 'cached-value',
      })

      let computeCalled = false
      const result = await cache.getOrSet(
        { key: 'cached', visibility: 'public' },
        async () => {
          computeCalled = true
          return 'computed-value'
        }
      )

      expect(result).toBe('cached-value')
      expect(computeCalled).toBe(false)
    })

    it('computes and caches value on miss', async () => {
      let computeCallCount = 0
      const result = await cache.getOrSet(
        { key: 'not-cached', visibility: 'public' },
        async () => {
          computeCallCount++
          return 'computed-value'
        }
      )

      expect(result).toBe('computed-value')
      expect(computeCallCount).toBe(1)

      // Second call should use cached value
      await cache.getOrSet(
        { key: 'not-cached', visibility: 'public' },
        async () => {
          computeCallCount++
          return 'new-value'
        }
      )

      expect(computeCallCount).toBe(1)
    })
  })

  describe('Invalidation', () => {
    beforeEach(async () => {
      await cache.set({
        key: 'item1',
        visibility: 'public',
        data: 'value1',
      })
      await cache.set({
        key: 'item2',
        visibility: 'public',
        data: 'value2',
      })
      await cache.set({
        key: 'item1',
        visibility: 'org',
        context: { orgId: 'org-1' },
        data: 'org-value1',
      })
    })

    it('invalidates by exact key and visibility', async () => {
      const count = await cache.invalidate({
        key: 'item1',
        visibility: 'public',
      })

      expect(count).toBe(1)
      expect(await cache.get({ key: 'item1', visibility: 'public' })).toBeUndefined()
      expect(await cache.get({ key: 'item2', visibility: 'public' })).toBe('value2')
    })

    it('invalidates by prefix', async () => {
      await cache.set({ key: 'products:1', visibility: 'public', data: 'p1' })
      await cache.set({ key: 'products:2', visibility: 'public', data: 'p2' })
      await cache.set({ key: 'customers:1', visibility: 'public', data: 'c1' })

      const count = await cache.invalidate({
        key: 'products',
        visibility: 'public',
        prefix: true,
      })

      expect(count).toBe(2)
      expect(await cache.get({ key: 'products:1', visibility: 'public' })).toBeUndefined()
      expect(await cache.get({ key: 'products:2', visibility: 'public' })).toBeUndefined()
      expect(await cache.get({ key: 'customers:1', visibility: 'public' })).toBe('c1')
    })

    it('invalidates by visibility level', async () => {
      const count = await cache.invalidateByVisibility('public')

      expect(count).toBe(2) // item1 and item2
      expect(await cache.get({ key: 'item1', visibility: 'public' })).toBeUndefined()
      expect(await cache.get({ key: 'item1', visibility: 'org', context: { orgId: 'org-1' } })).toBe('org-value1')
    })

    it('invalidates by org', async () => {
      await cache.set({
        key: 'data1',
        visibility: 'org',
        context: { orgId: 'org-1' },
        data: 'org1-data1',
      })
      await cache.set({
        key: 'data2',
        visibility: 'org',
        context: { orgId: 'org-1' },
        data: 'org1-data2',
      })
      await cache.set({
        key: 'data1',
        visibility: 'org',
        context: { orgId: 'org-2' },
        data: 'org2-data1',
      })

      const count = await cache.invalidateByOrg('org-1')

      expect(count).toBe(3) // item1 + data1 + data2 for org-1
      expect(await cache.get({ key: 'data1', visibility: 'org', context: { orgId: 'org-1' } })).toBeUndefined()
      expect(await cache.get({ key: 'data1', visibility: 'org', context: { orgId: 'org-2' } })).toBe('org2-data1')
    })

    it('invalidates by user', async () => {
      await cache.set({
        key: 'settings',
        visibility: 'user',
        context: { userId: 'user-1' },
        data: 'user1-settings',
      })
      await cache.set({
        key: 'preferences',
        visibility: 'user',
        context: { userId: 'user-1' },
        data: 'user1-prefs',
      })
      await cache.set({
        key: 'settings',
        visibility: 'user',
        context: { userId: 'user-2' },
        data: 'user2-settings',
      })

      const count = await cache.invalidateByUser('user-1')

      expect(count).toBe(2)
      expect(await cache.get({ key: 'settings', visibility: 'user', context: { userId: 'user-1' } })).toBeUndefined()
      expect(await cache.get({ key: 'settings', visibility: 'user', context: { userId: 'user-2' } })).toBe('user2-settings')
    })
  })

  describe('Visibility Change Handling', () => {
    it('handles visibility change from user to public', async () => {
      await cache.set({
        key: 'product:123',
        visibility: 'user',
        context: { userId: 'user-1' },
        data: { id: 123, name: 'Product', price: 100 },
      })

      await cache.handleVisibilityChange({
        key: 'product:123',
        oldVisibility: 'user',
        newVisibility: 'public',
        oldContext: { userId: 'user-1' },
        data: { id: 123, name: 'Product', price: 100 },
      })

      // Old cache entry should be removed
      expect(
        await cache.get({
          key: 'product:123',
          visibility: 'user',
          context: { userId: 'user-1' },
        })
      ).toBeUndefined()

      // New cache entry should exist
      expect(
        await cache.get({
          key: 'product:123',
          visibility: 'public',
        })
      ).toEqual({ id: 123, name: 'Product', price: 100 })
    })

    it('handles visibility change from public to org', async () => {
      await cache.set({
        key: 'doc:abc',
        visibility: 'public',
        data: { content: 'document' },
      })

      await cache.handleVisibilityChange({
        key: 'doc:abc',
        oldVisibility: 'public',
        newVisibility: 'org',
        newContext: { orgId: 'org-1' },
        data: { content: 'document' },
      })

      // Old cache entry should be removed
      expect(
        await cache.get({
          key: 'doc:abc',
          visibility: 'public',
        })
      ).toBeUndefined()

      // New cache entry should exist
      expect(
        await cache.get({
          key: 'doc:abc',
          visibility: 'org',
          context: { orgId: 'org-1' },
        })
      ).toEqual({ content: 'document' })
    })

    it('removes from cache without re-caching when data not provided', async () => {
      await cache.set({
        key: 'item',
        visibility: 'public',
        data: 'value',
      })

      await cache.handleVisibilityChange({
        key: 'item',
        oldVisibility: 'public',
        newVisibility: 'user',
        newContext: { userId: 'user-1' },
        // data not provided - just remove from old cache
      })

      expect(
        await cache.get({
          key: 'item',
          visibility: 'public',
        })
      ).toBeUndefined()

      expect(
        await cache.get({
          key: 'item',
          visibility: 'user',
          context: { userId: 'user-1' },
        })
      ).toBeUndefined()
    })
  })

  describe('Cache Pools', () => {
    it('creates namespaced pool', () => {
      const productsCache = cache.createPool({ name: 'products' })

      expect(productsCache).toBeInstanceOf(VisibilityCache)
    })

    it('pools have separate namespaces', async () => {
      const productsCache = cache.createPool({ name: 'products' })
      const usersCache = cache.createPool({ name: 'users' })

      await productsCache.set({
        key: 'item',
        visibility: 'public',
        data: 'product',
      })

      await usersCache.set({
        key: 'item',
        visibility: 'public',
        data: 'user',
      })

      // Verify both caches have independent data
      expect(await productsCache.get({ key: 'item', visibility: 'public' })).toBe('product')
      expect(await usersCache.get({ key: 'item', visibility: 'public' })).toBe('user')
    })

    it('pools can have custom TTL', async () => {
      const shortTTLPool = cache.createPool({
        name: 'short-lived',
        ttl: { public: 0.001 },
      })

      await shortTTLPool.set({
        key: 'expires',
        visibility: 'public',
        data: 'value',
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(await shortTTLPool.get({ key: 'expires', visibility: 'public' })).toBeUndefined()
    })
  })

  describe('Statistics', () => {
    it('tracks hits and misses', async () => {
      await cache.set({ key: 'test', visibility: 'public', data: 'value' })

      await cache.get({ key: 'test', visibility: 'public' }) // hit
      await cache.get({ key: 'test', visibility: 'public' }) // hit
      await cache.get({ key: 'nonexistent', visibility: 'public' }) // miss

      const stats = cache.getStats()

      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(1)
    })

    it('tracks entries by visibility', async () => {
      await cache.set({ key: 'pub1', visibility: 'public', data: '1' })
      await cache.set({ key: 'pub2', visibility: 'public', data: '2' })
      await cache.set({ key: 'unl1', visibility: 'unlisted', data: '3' })
      await cache.set({ key: 'org1', visibility: 'org', context: { orgId: 'o1' }, data: '4' })

      const stats = cache.getStats()

      expect(stats.entriesByVisibility.public).toBe(2)
      expect(stats.entriesByVisibility.unlisted).toBe(1)
      expect(stats.entriesByVisibility.org).toBe(1)
      expect(stats.entriesByVisibility.user).toBe(0)
      expect(stats.totalEntries).toBe(4)
    })
  })

  describe('Utility Methods', () => {
    it('clears all entries', async () => {
      await cache.set({ key: 'a', visibility: 'public', data: 1 })
      await cache.set({ key: 'b', visibility: 'public', data: 2 })

      await cache.clear()

      expect(cache.size).toBe(0)
      expect(cache.getStats().totalEntries).toBe(0)
    })

    it('cleans up expired entries', async () => {
      const shortCache = new VisibilityCache({
        ttl: { public: 0.001, unlisted: 0.001, org: 0.001, user: 0.001 },
      })

      await shortCache.set({ key: 'exp1', visibility: 'public', data: 1 })
      await shortCache.set({ key: 'exp2', visibility: 'public', data: 2 })

      await new Promise((resolve) => setTimeout(resolve, 10))

      const cleaned = await shortCache.cleanup()

      expect(cleaned).toBe(2)
      expect(shortCache.size).toBe(0)
    })

    it('reports size correctly', async () => {
      expect(cache.size).toBe(0)

      await cache.set({ key: 'a', visibility: 'public', data: 1 })
      expect(cache.size).toBe(1)

      await cache.set({ key: 'b', visibility: 'public', data: 2 })
      expect(cache.size).toBe(2)

      await cache.delete({ key: 'a', visibility: 'public' })
      expect(cache.size).toBe(1)
    })
  })
})

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Factory Functions', () => {
  describe('createVisibilityCache', () => {
    it('creates cache with default config', () => {
      const cache = createVisibilityCache()

      expect(cache).toBeInstanceOf(VisibilityCache)
    })

    it('creates cache with custom TTL', async () => {
      const cache = createVisibilityCache({
        ttl: { public: 0.001 },
      })

      await cache.set({ key: 'test', visibility: 'public', data: 'value' })
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(await cache.get({ key: 'test', visibility: 'public' })).toBeUndefined()
    })

    it('creates cache with pool name', async () => {
      const cache = createVisibilityCache({ pool: 'mypool' })

      await cache.set({ key: 'test', visibility: 'public', data: 'value' })

      // The internal key should include the pool prefix
      // We can verify this by checking isolation from a non-pooled cache
      const otherCache = createVisibilityCache()
      expect(await otherCache.get({ key: 'test', visibility: 'public' })).toBeUndefined()
    })
  })

  describe('createSeparatedCachePools', () => {
    it('creates public and private pools', () => {
      const pools = createSeparatedCachePools()

      expect(pools.public).toBeInstanceOf(VisibilityCache)
      expect(pools.private).toBeInstanceOf(VisibilityCache)
    })

    it('pools are isolated', async () => {
      const pools = createSeparatedCachePools()

      await pools.public.set({ key: 'shared', visibility: 'public', data: 'public-data' })
      await pools.private.set({ key: 'shared', visibility: 'public', data: 'private-data' })

      expect(await pools.public.get({ key: 'shared', visibility: 'public' })).toBe('public-data')
      expect(await pools.private.get({ key: 'shared', visibility: 'public' })).toBe('private-data')
    })
  })
})

// ============================================================================
// Security Tests
// ============================================================================

describe('Security', () => {
  let cache: VisibilityCache

  beforeEach(() => {
    cache = new VisibilityCache()
  })

  it('prevents accessing org data without orgId', async () => {
    await cache.set({
      key: 'secret',
      visibility: 'org',
      context: { orgId: 'org-123' },
      data: 'sensitive',
    })

    // Attempt to access without proper context should throw
    await expect(
      cache.get({ key: 'secret', visibility: 'org' })
    ).rejects.toThrow('Org context (orgId) required')
  })

  it('prevents accessing user data without userId', async () => {
    await cache.set({
      key: 'personal',
      visibility: 'user',
      context: { userId: 'user-123' },
      data: 'private',
    })

    // Attempt to access without proper context should throw
    await expect(
      cache.get({ key: 'personal', visibility: 'user' })
    ).rejects.toThrow('User context (userId) required')
  })

  it('different users cannot access each other data', async () => {
    await cache.set({
      key: 'data',
      visibility: 'user',
      context: { userId: 'user-1' },
      data: 'user-1-data',
    })

    const result = await cache.get({
      key: 'data',
      visibility: 'user',
      context: { userId: 'user-2' },
    })

    expect(result).toBeUndefined()
  })

  it('different orgs cannot access each other data', async () => {
    await cache.set({
      key: 'data',
      visibility: 'org',
      context: { orgId: 'org-1' },
      data: 'org-1-data',
    })

    const result = await cache.get({
      key: 'data',
      visibility: 'org',
      context: { orgId: 'org-2' },
    })

    expect(result).toBeUndefined()
  })

  it('public data is accessible without context', async () => {
    await cache.set({
      key: 'public-info',
      visibility: 'public',
      data: 'open-data',
    })

    const result = await cache.get({
      key: 'public-info',
      visibility: 'public',
    })

    expect(result).toBe('open-data')
  })

  it('unlisted data is accessible without context (by key)', async () => {
    await cache.set({
      key: 'unlisted-doc:abc123',
      visibility: 'unlisted',
      data: 'not-discoverable-but-accessible',
    })

    const result = await cache.get({
      key: 'unlisted-doc:abc123',
      visibility: 'unlisted',
    })

    expect(result).toBe('not-discoverable-but-accessible')
  })
})
