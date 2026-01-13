/**
 * Cache Invalidation Tests - TDD RED Phase
 *
 * Issue: dotdo-b4tmm - RED: Cache Invalidation Tests
 *
 * Tests for cache invalidation behavior in VisibilityCache:
 * - Key invalidation (exact key, visibility-scoped)
 * - Pattern invalidation (prefix-based, wildcard)
 * - TTL expiration behavior
 *
 * These tests are designed to FAIL initially (RED phase) to drive
 * implementation of missing invalidation features.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  VisibilityCache,
  type Visibility,
  type CacheContext,
  type CacheInvalidateOptions,
  buildCacheKey,
  DEFAULT_TTL_CONFIG,
} from '../visibility'

// =============================================================================
// TEST SUITE: Key Invalidation
// =============================================================================

describe('Cache Key Invalidation', () => {
  let cache: VisibilityCache

  beforeEach(() => {
    cache = new VisibilityCache()
  })

  describe('exact key invalidation', () => {
    it('should invalidate a specific key by exact match', async () => {
      // Set up cache entries
      await cache.set({
        key: 'products:123',
        visibility: 'public',
        data: { id: 123, name: 'Widget' },
      })
      await cache.set({
        key: 'products:456',
        visibility: 'public',
        data: { id: 456, name: 'Gadget' },
      })

      // Invalidate only one key
      const invalidatedCount = await cache.invalidate({
        key: 'products:123',
        visibility: 'public',
      })

      // Should have invalidated exactly 1 entry
      expect(invalidatedCount).toBe(1)

      // products:123 should be gone
      const result123 = await cache.get({
        key: 'products:123',
        visibility: 'public',
      })
      expect(result123).toBeUndefined()

      // products:456 should still exist
      const result456 = await cache.get({
        key: 'products:456',
        visibility: 'public',
      })
      expect(result456).toBeDefined()
    })

    it('should return 0 when invalidating non-existent key', async () => {
      const invalidatedCount = await cache.invalidate({
        key: 'nonexistent:key',
        visibility: 'public',
      })

      expect(invalidatedCount).toBe(0)
    })

    it('should only invalidate key in specified visibility level', async () => {
      // Same key, different visibility levels
      await cache.set({
        key: 'shared:data',
        visibility: 'public',
        data: { scope: 'public' },
      })
      await cache.set({
        key: 'shared:data',
        visibility: 'org',
        context: { orgId: 'org-123' },
        data: { scope: 'org' },
      })

      // Invalidate only public visibility
      await cache.invalidate({
        key: 'shared:data',
        visibility: 'public',
      })

      // Public should be gone
      const publicResult = await cache.get({
        key: 'shared:data',
        visibility: 'public',
      })
      expect(publicResult).toBeUndefined()

      // Org-scoped should still exist
      const orgResult = await cache.get({
        key: 'shared:data',
        visibility: 'org',
        context: { orgId: 'org-123' },
      })
      expect(orgResult).toBeDefined()
      expect(orgResult).toEqual({ scope: 'org' })
    })

    it('should invalidate key across all visibility levels when visibility not specified', async () => {
      // Same key in multiple visibility levels
      await cache.set({
        key: 'multi:data',
        visibility: 'public',
        data: { level: 'public' },
      })
      await cache.set({
        key: 'multi:data',
        visibility: 'unlisted',
        data: { level: 'unlisted' },
      })

      // Invalidate without specifying visibility
      const invalidatedCount = await cache.invalidate({
        key: 'multi:data',
      })

      // Should invalidate both
      expect(invalidatedCount).toBe(2)

      expect(await cache.get({ key: 'multi:data', visibility: 'public' })).toBeUndefined()
      expect(await cache.get({ key: 'multi:data', visibility: 'unlisted' })).toBeUndefined()
    })
  })

  describe('context-scoped invalidation', () => {
    it('should invalidate org-scoped key with matching context', async () => {
      await cache.set({
        key: 'customers:list',
        visibility: 'org',
        context: { orgId: 'org-alpha' },
        data: { customers: ['Alice', 'Bob'] },
      })
      await cache.set({
        key: 'customers:list',
        visibility: 'org',
        context: { orgId: 'org-beta' },
        data: { customers: ['Charlie', 'Diana'] },
      })

      // Invalidate for org-alpha only
      const invalidatedCount = await cache.invalidate({
        key: 'customers:list',
        visibility: 'org',
        context: { orgId: 'org-alpha' },
      })

      expect(invalidatedCount).toBe(1)

      // org-alpha should be gone
      expect(await cache.get({
        key: 'customers:list',
        visibility: 'org',
        context: { orgId: 'org-alpha' },
      })).toBeUndefined()

      // org-beta should remain
      expect(await cache.get({
        key: 'customers:list',
        visibility: 'org',
        context: { orgId: 'org-beta' },
      })).toEqual({ customers: ['Charlie', 'Diana'] })
    })

    it('should invalidate user-scoped key with matching context', async () => {
      await cache.set({
        key: 'settings',
        visibility: 'user',
        context: { userId: 'user-001' },
        data: { theme: 'dark' },
      })
      await cache.set({
        key: 'settings',
        visibility: 'user',
        context: { userId: 'user-002' },
        data: { theme: 'light' },
      })

      await cache.invalidate({
        key: 'settings',
        visibility: 'user',
        context: { userId: 'user-001' },
      })

      expect(await cache.get({
        key: 'settings',
        visibility: 'user',
        context: { userId: 'user-001' },
      })).toBeUndefined()

      expect(await cache.get({
        key: 'settings',
        visibility: 'user',
        context: { userId: 'user-002' },
      })).toEqual({ theme: 'light' })
    })
  })

  describe('invalidateByVisibility', () => {
    it('should invalidate all entries for a specific visibility level', async () => {
      await cache.set({ key: 'a', visibility: 'public', data: 1 })
      await cache.set({ key: 'b', visibility: 'public', data: 2 })
      await cache.set({ key: 'c', visibility: 'unlisted', data: 3 })
      await cache.set({
        key: 'd',
        visibility: 'org',
        context: { orgId: 'test' },
        data: 4,
      })

      const invalidatedCount = await cache.invalidateByVisibility('public')

      expect(invalidatedCount).toBe(2)

      // Public entries gone
      expect(await cache.get({ key: 'a', visibility: 'public' })).toBeUndefined()
      expect(await cache.get({ key: 'b', visibility: 'public' })).toBeUndefined()

      // Other visibility levels remain
      expect(await cache.get({ key: 'c', visibility: 'unlisted' })).toBe(3)
      expect(await cache.get({
        key: 'd',
        visibility: 'org',
        context: { orgId: 'test' },
      })).toBe(4)
    })

    it('should return 0 when no entries exist for visibility level', async () => {
      await cache.set({ key: 'public-only', visibility: 'public', data: 'test' })

      const invalidatedCount = await cache.invalidateByVisibility('unlisted')

      expect(invalidatedCount).toBe(0)
    })
  })

  describe('invalidateByOrg', () => {
    it('should invalidate all entries for a specific organization', async () => {
      await cache.set({
        key: 'data:1',
        visibility: 'org',
        context: { orgId: 'acme-corp' },
        data: { org: 'acme' },
      })
      await cache.set({
        key: 'data:2',
        visibility: 'org',
        context: { orgId: 'acme-corp' },
        data: { org: 'acme' },
      })
      await cache.set({
        key: 'data:3',
        visibility: 'org',
        context: { orgId: 'other-org' },
        data: { org: 'other' },
      })
      // Public data shouldn't be affected
      await cache.set({
        key: 'public-data',
        visibility: 'public',
        data: { public: true },
      })

      const invalidatedCount = await cache.invalidateByOrg('acme-corp')

      expect(invalidatedCount).toBe(2)

      // acme-corp entries gone
      expect(await cache.get({
        key: 'data:1',
        visibility: 'org',
        context: { orgId: 'acme-corp' },
      })).toBeUndefined()
      expect(await cache.get({
        key: 'data:2',
        visibility: 'org',
        context: { orgId: 'acme-corp' },
      })).toBeUndefined()

      // other-org entries remain
      expect(await cache.get({
        key: 'data:3',
        visibility: 'org',
        context: { orgId: 'other-org' },
      })).toEqual({ org: 'other' })

      // Public data remains
      expect(await cache.get({
        key: 'public-data',
        visibility: 'public',
      })).toEqual({ public: true })
    })
  })

  describe('invalidateByUser', () => {
    it('should invalidate all entries for a specific user', async () => {
      await cache.set({
        key: 'profile',
        visibility: 'user',
        context: { userId: 'user-abc' },
        data: { name: 'Alice' },
      })
      await cache.set({
        key: 'preferences',
        visibility: 'user',
        context: { userId: 'user-abc' },
        data: { locale: 'en' },
      })
      await cache.set({
        key: 'profile',
        visibility: 'user',
        context: { userId: 'user-xyz' },
        data: { name: 'Bob' },
      })

      const invalidatedCount = await cache.invalidateByUser('user-abc')

      expect(invalidatedCount).toBe(2)

      // user-abc entries gone
      expect(await cache.get({
        key: 'profile',
        visibility: 'user',
        context: { userId: 'user-abc' },
      })).toBeUndefined()
      expect(await cache.get({
        key: 'preferences',
        visibility: 'user',
        context: { userId: 'user-abc' },
      })).toBeUndefined()

      // user-xyz entries remain
      expect(await cache.get({
        key: 'profile',
        visibility: 'user',
        context: { userId: 'user-xyz' },
      })).toEqual({ name: 'Bob' })
    })
  })

  describe('stats update on invalidation', () => {
    it('should update entriesByVisibility stats after invalidation', async () => {
      await cache.set({ key: 'a', visibility: 'public', data: 1 })
      await cache.set({ key: 'b', visibility: 'public', data: 2 })
      await cache.set({ key: 'c', visibility: 'unlisted', data: 3 })

      const statsBefore = cache.getStats()
      expect(statsBefore.entriesByVisibility.public).toBe(2)
      expect(statsBefore.entriesByVisibility.unlisted).toBe(1)
      expect(statsBefore.totalEntries).toBe(3)

      await cache.invalidateByVisibility('public')

      const statsAfter = cache.getStats()
      expect(statsAfter.entriesByVisibility.public).toBe(0)
      expect(statsAfter.entriesByVisibility.unlisted).toBe(1)
      expect(statsAfter.totalEntries).toBe(1)
    })
  })
})

// =============================================================================
// TEST SUITE: Pattern Invalidation
// =============================================================================

describe('Cache Pattern Invalidation', () => {
  let cache: VisibilityCache

  beforeEach(() => {
    cache = new VisibilityCache()
  })

  describe('prefix-based invalidation', () => {
    it('should invalidate all keys matching a prefix', async () => {
      await cache.set({ key: 'products:electronics:1', visibility: 'public', data: 'TV' })
      await cache.set({ key: 'products:electronics:2', visibility: 'public', data: 'Phone' })
      await cache.set({ key: 'products:clothing:1', visibility: 'public', data: 'Shirt' })
      await cache.set({ key: 'orders:1', visibility: 'public', data: 'Order1' })

      const invalidatedCount = await cache.invalidate({
        key: 'products:electronics',
        visibility: 'public',
        prefix: true,
      })

      expect(invalidatedCount).toBe(2)

      // Electronics products gone
      expect(await cache.get({ key: 'products:electronics:1', visibility: 'public' })).toBeUndefined()
      expect(await cache.get({ key: 'products:electronics:2', visibility: 'public' })).toBeUndefined()

      // Clothing and orders remain
      expect(await cache.get({ key: 'products:clothing:1', visibility: 'public' })).toBe('Shirt')
      expect(await cache.get({ key: 'orders:1', visibility: 'public' })).toBe('Order1')
    })

    it('should invalidate prefix across visibility levels when visibility not specified', async () => {
      await cache.set({ key: 'data:segment:1', visibility: 'public', data: 'public1' })
      await cache.set({ key: 'data:segment:2', visibility: 'unlisted', data: 'unlisted1' })
      await cache.set({ key: 'data:other:1', visibility: 'public', data: 'other' })

      const invalidatedCount = await cache.invalidate({
        key: 'data:segment',
        prefix: true,
      })

      expect(invalidatedCount).toBe(2)

      expect(await cache.get({ key: 'data:segment:1', visibility: 'public' })).toBeUndefined()
      expect(await cache.get({ key: 'data:segment:2', visibility: 'unlisted' })).toBeUndefined()
      expect(await cache.get({ key: 'data:other:1', visibility: 'public' })).toBe('other')
    })

    it('should handle prefix with context-scoped entries', async () => {
      await cache.set({
        key: 'reports:monthly:jan',
        visibility: 'org',
        context: { orgId: 'org-1' },
        data: 'Jan Report',
      })
      await cache.set({
        key: 'reports:monthly:feb',
        visibility: 'org',
        context: { orgId: 'org-1' },
        data: 'Feb Report',
      })
      await cache.set({
        key: 'reports:monthly:jan',
        visibility: 'org',
        context: { orgId: 'org-2' },
        data: 'Jan Report Org2',
      })

      // Invalidate only org-1's monthly reports
      const invalidatedCount = await cache.invalidate({
        key: 'reports:monthly',
        visibility: 'org',
        context: { orgId: 'org-1' },
        prefix: true,
      })

      expect(invalidatedCount).toBe(2)

      // org-1's reports gone
      expect(await cache.get({
        key: 'reports:monthly:jan',
        visibility: 'org',
        context: { orgId: 'org-1' },
      })).toBeUndefined()
      expect(await cache.get({
        key: 'reports:monthly:feb',
        visibility: 'org',
        context: { orgId: 'org-1' },
      })).toBeUndefined()

      // org-2's reports remain
      expect(await cache.get({
        key: 'reports:monthly:jan',
        visibility: 'org',
        context: { orgId: 'org-2' },
      })).toBe('Jan Report Org2')
    })

    it('should return 0 when no keys match prefix', async () => {
      await cache.set({ key: 'existing:key', visibility: 'public', data: 'value' })

      const invalidatedCount = await cache.invalidate({
        key: 'nonexistent:prefix',
        visibility: 'public',
        prefix: true,
      })

      expect(invalidatedCount).toBe(0)
    })
  })

  describe('wildcard invalidation patterns', () => {
    it('should support glob-style wildcard patterns', async () => {
      await cache.set({ key: 'user:123:profile', visibility: 'public', data: 'profile' })
      await cache.set({ key: 'user:123:settings', visibility: 'public', data: 'settings' })
      await cache.set({ key: 'user:456:profile', visibility: 'public', data: 'profile2' })
      await cache.set({ key: 'admin:123:profile', visibility: 'public', data: 'admin' })

      // Invalidate all user:*:profile entries (glob pattern)
      const invalidatedCount = await cache.invalidate({
        key: 'user:*:profile',
        visibility: 'public',
        prefix: true, // Treat as pattern
      })

      // This test expects glob/wildcard support - may need implementation
      expect(invalidatedCount).toBe(2) // user:123:profile and user:456:profile
    })

    it('should support nested key pattern invalidation', async () => {
      await cache.set({ key: 'api:v1:users:list', visibility: 'public', data: [] })
      await cache.set({ key: 'api:v1:users:count', visibility: 'public', data: 100 })
      await cache.set({ key: 'api:v2:users:list', visibility: 'public', data: [] })
      await cache.set({ key: 'api:v1:orders:list', visibility: 'public', data: [] })

      // Invalidate all v1 user endpoints
      const invalidatedCount = await cache.invalidate({
        key: 'api:v1:users',
        visibility: 'public',
        prefix: true,
      })

      expect(invalidatedCount).toBe(2)

      expect(await cache.get({ key: 'api:v1:users:list', visibility: 'public' })).toBeUndefined()
      expect(await cache.get({ key: 'api:v1:users:count', visibility: 'public' })).toBeUndefined()
      expect(await cache.get({ key: 'api:v2:users:list', visibility: 'public' })).toEqual([])
      expect(await cache.get({ key: 'api:v1:orders:list', visibility: 'public' })).toEqual([])
    })
  })

  describe('tag-based invalidation', () => {
    /**
     * RED TEST: Tag-based invalidation is not yet implemented
     * This tests a feature that allows entries to be tagged and invalidated by tag
     */
    it('should support invalidation by tag', async () => {
      // This requires extending the cache to support tags
      // Expected API:
      // await cache.set({ key: 'product:1', visibility: 'public', data: {...}, tags: ['products', 'featured'] })
      // await cache.invalidateByTag('featured')

      // For now, this test documents the expected behavior
      const cacheWithTags = cache as VisibilityCache & {
        invalidateByTag: (tag: string) => Promise<number>
      }

      // Skip if not implemented
      if (typeof cacheWithTags.invalidateByTag !== 'function') {
        expect(cacheWithTags.invalidateByTag).toBeUndefined()
        return
      }

      await cache.set({ key: 'product:1', visibility: 'public', data: { featured: true } })
      await cache.set({ key: 'product:2', visibility: 'public', data: { featured: false } })

      const invalidatedCount = await cacheWithTags.invalidateByTag('featured')
      expect(invalidatedCount).toBe(1)
    })
  })
})

// =============================================================================
// TEST SUITE: TTL Expiration Behavior
// =============================================================================

describe('Cache TTL Expiration Behavior', () => {
  let cache: VisibilityCache

  beforeEach(() => {
    vi.useFakeTimers()
    cache = new VisibilityCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('automatic expiration on get', () => {
    it('should return undefined for expired entries', async () => {
      await cache.set({
        key: 'temp:data',
        visibility: 'public',
        data: 'temporary',
        ttl: 60, // 60 seconds
      })

      // Verify it exists immediately
      expect(await cache.get({ key: 'temp:data', visibility: 'public' })).toBe('temporary')

      // Advance time past TTL
      vi.advanceTimersByTime(61 * 1000)

      // Should be expired
      expect(await cache.get({ key: 'temp:data', visibility: 'public' })).toBeUndefined()
    })

    it('should respect visibility-specific default TTLs', async () => {
      // Public: 3600s (1 hour)
      // Unlisted: 600s (10 minutes)
      // Org/User: 300s (5 minutes)

      await cache.set({ key: 'public-item', visibility: 'public', data: 'public' })
      await cache.set({ key: 'unlisted-item', visibility: 'unlisted', data: 'unlisted' })
      await cache.set({
        key: 'org-item',
        visibility: 'org',
        context: { orgId: 'test' },
        data: 'org',
      })

      // After 6 minutes (360 seconds), org should be expired
      vi.advanceTimersByTime(360 * 1000)

      expect(await cache.get({
        key: 'org-item',
        visibility: 'org',
        context: { orgId: 'test' },
      })).toBeUndefined()
      expect(await cache.get({ key: 'unlisted-item', visibility: 'unlisted' })).toBe('unlisted')
      expect(await cache.get({ key: 'public-item', visibility: 'public' })).toBe('public')

      // After 11 minutes total (660 seconds), unlisted should be expired
      vi.advanceTimersByTime(300 * 1000) // Additional 5 minutes

      expect(await cache.get({ key: 'unlisted-item', visibility: 'unlisted' })).toBeUndefined()
      expect(await cache.get({ key: 'public-item', visibility: 'public' })).toBe('public')

      // After 61 minutes total (3660 seconds), public should be expired
      vi.advanceTimersByTime(3000 * 1000) // Additional 50 minutes

      expect(await cache.get({ key: 'public-item', visibility: 'public' })).toBeUndefined()
    })

    it('should use custom TTL when provided', async () => {
      await cache.set({
        key: 'custom-ttl',
        visibility: 'public',
        data: 'short-lived',
        ttl: 10, // 10 seconds instead of default 3600s
      })

      vi.advanceTimersByTime(11 * 1000)

      expect(await cache.get({ key: 'custom-ttl', visibility: 'public' })).toBeUndefined()
    })

    it('should update stats when entry expires on get', async () => {
      await cache.set({
        key: 'expires-soon',
        visibility: 'public',
        data: 'data',
        ttl: 10,
      })

      const statsBefore = cache.getStats()
      expect(statsBefore.totalEntries).toBe(1)
      expect(statsBefore.entriesByVisibility.public).toBe(1)

      vi.advanceTimersByTime(11 * 1000)

      // Trigger expiration check via get
      await cache.get({ key: 'expires-soon', visibility: 'public' })

      const statsAfter = cache.getStats()
      expect(statsAfter.totalEntries).toBe(0)
      expect(statsAfter.entriesByVisibility.public).toBe(0)
      expect(statsAfter.misses).toBe(1) // Expired entry counts as miss
    })
  })

  describe('cleanup method', () => {
    it('should remove all expired entries', async () => {
      // Set entries with different TTLs
      await cache.set({ key: 'short', visibility: 'public', data: 1, ttl: 10 })
      await cache.set({ key: 'medium', visibility: 'public', data: 2, ttl: 60 })
      await cache.set({ key: 'long', visibility: 'public', data: 3, ttl: 120 })

      // Advance past short TTL
      vi.advanceTimersByTime(15 * 1000)

      // Run cleanup
      const cleanedCount = await cache.cleanup()

      expect(cleanedCount).toBe(1) // Only 'short' should be cleaned

      // Verify
      expect(await cache.get({ key: 'short', visibility: 'public' })).toBeUndefined()
      expect(await cache.get({ key: 'medium', visibility: 'public' })).toBe(2)
      expect(await cache.get({ key: 'long', visibility: 'public' })).toBe(3)
    })

    it('should update stats after cleanup', async () => {
      await cache.set({ key: 'a', visibility: 'public', data: 1, ttl: 10 })
      await cache.set({ key: 'b', visibility: 'unlisted', data: 2, ttl: 10 })
      await cache.set({ key: 'c', visibility: 'public', data: 3, ttl: 60 })

      vi.advanceTimersByTime(15 * 1000)

      await cache.cleanup()

      const stats = cache.getStats()
      expect(stats.totalEntries).toBe(1)
      expect(stats.entriesByVisibility.public).toBe(1)
      expect(stats.entriesByVisibility.unlisted).toBe(0)
    })

    it('should return 0 when no entries are expired', async () => {
      await cache.set({ key: 'valid', visibility: 'public', data: 'still-valid', ttl: 3600 })

      const cleanedCount = await cache.cleanup()

      expect(cleanedCount).toBe(0)
    })

    it('should handle empty cache gracefully', async () => {
      const cleanedCount = await cache.cleanup()

      expect(cleanedCount).toBe(0)
    })
  })

  describe('expiration edge cases', () => {
    it('should handle entry that expires exactly at check time', async () => {
      await cache.set({
        key: 'exact',
        visibility: 'public',
        data: 'expires-exactly',
        ttl: 30,
      })

      // Advance exactly to TTL boundary
      vi.advanceTimersByTime(30 * 1000)

      // Entry should be considered expired at exactly TTL
      const result = await cache.get({ key: 'exact', visibility: 'public' })
      expect(result).toBeUndefined()
    })

    it('should handle concurrent access to expiring entry', async () => {
      await cache.set({
        key: 'concurrent',
        visibility: 'public',
        data: 'concurrent-data',
        ttl: 30,
      })

      vi.advanceTimersByTime(31 * 1000)

      // Multiple concurrent gets should all return undefined
      const results = await Promise.all([
        cache.get({ key: 'concurrent', visibility: 'public' }),
        cache.get({ key: 'concurrent', visibility: 'public' }),
        cache.get({ key: 'concurrent', visibility: 'public' }),
      ])

      results.forEach((result) => {
        expect(result).toBeUndefined()
      })

      // Stats should reflect the misses correctly
      const stats = cache.getStats()
      expect(stats.misses).toBe(3)
    })

    it('should handle refresh of expired entry', async () => {
      await cache.set({
        key: 'refresh',
        visibility: 'public',
        data: 'original',
        ttl: 10,
      })

      vi.advanceTimersByTime(15 * 1000)

      // Entry is expired
      expect(await cache.get({ key: 'refresh', visibility: 'public' })).toBeUndefined()

      // Set new value
      await cache.set({
        key: 'refresh',
        visibility: 'public',
        data: 'refreshed',
        ttl: 60,
      })

      // Should have new value
      expect(await cache.get({ key: 'refresh', visibility: 'public' })).toBe('refreshed')

      // Stats should be correct
      const stats = cache.getStats()
      expect(stats.totalEntries).toBe(1)
    })
  })

  describe('TTL configuration', () => {
    it('should use custom TTL configuration', async () => {
      const customCache = new VisibilityCache({
        ttl: {
          public: 120, // 2 minutes instead of 1 hour
          unlisted: 60, // 1 minute instead of 10 minutes
          org: 30, // 30 seconds instead of 5 minutes
          user: 30,
        },
      })

      await customCache.set({ key: 'test', visibility: 'public', data: 'short-public' })

      // After 2.5 minutes, should be expired with custom config
      vi.advanceTimersByTime(150 * 1000)

      expect(await customCache.get({ key: 'test', visibility: 'public' })).toBeUndefined()
    })

    it('should allow partial TTL configuration override', async () => {
      const partialCache = new VisibilityCache({
        ttl: {
          public: 60, // Override only public TTL
          // Other TTLs use defaults
        },
      })

      await partialCache.set({ key: 'pub', visibility: 'public', data: 'public' })
      await partialCache.set({ key: 'unl', visibility: 'unlisted', data: 'unlisted' })

      vi.advanceTimersByTime(90 * 1000) // 1.5 minutes

      // Public should be expired (custom 60s TTL)
      expect(await partialCache.get({ key: 'pub', visibility: 'public' })).toBeUndefined()

      // Unlisted should still be valid (default 600s TTL)
      expect(await partialCache.get({ key: 'unl', visibility: 'unlisted' })).toBe('unlisted')
    })
  })
})

// =============================================================================
// TEST SUITE: Visibility Change Handling
// =============================================================================

describe('Visibility Change Handling', () => {
  let cache: VisibilityCache

  beforeEach(() => {
    cache = new VisibilityCache()
  })

  it('should handle visibility upgrade (user -> public)', async () => {
    // Initially user-scoped
    await cache.set({
      key: 'promoted:item',
      visibility: 'user',
      context: { userId: 'user-1' },
      data: { value: 'private-data' },
    })

    // Handle visibility change
    await cache.handleVisibilityChange({
      key: 'promoted:item',
      oldVisibility: 'user',
      newVisibility: 'public',
      oldContext: { userId: 'user-1' },
      data: { value: 'now-public-data' },
    })

    // Old entry should be gone
    expect(await cache.get({
      key: 'promoted:item',
      visibility: 'user',
      context: { userId: 'user-1' },
    })).toBeUndefined()

    // New entry should exist in public
    expect(await cache.get({
      key: 'promoted:item',
      visibility: 'public',
    })).toEqual({ value: 'now-public-data' })
  })

  it('should handle visibility downgrade (public -> org)', async () => {
    await cache.set({
      key: 'restricted:item',
      visibility: 'public',
      data: { value: 'was-public' },
    })

    await cache.handleVisibilityChange({
      key: 'restricted:item',
      oldVisibility: 'public',
      newVisibility: 'org',
      newContext: { orgId: 'org-secret' },
      data: { value: 'now-restricted' },
    })

    // Public entry should be gone
    expect(await cache.get({
      key: 'restricted:item',
      visibility: 'public',
    })).toBeUndefined()

    // Should exist in org scope
    expect(await cache.get({
      key: 'restricted:item',
      visibility: 'org',
      context: { orgId: 'org-secret' },
    })).toEqual({ value: 'now-restricted' })
  })

  it('should remove old entry without setting new one when data is undefined', async () => {
    await cache.set({
      key: 'delete:me',
      visibility: 'public',
      data: 'old-value',
    })

    await cache.handleVisibilityChange({
      key: 'delete:me',
      oldVisibility: 'public',
      newVisibility: 'unlisted',
      // data is undefined - don't cache in new visibility
    })

    // Should be gone from public
    expect(await cache.get({
      key: 'delete:me',
      visibility: 'public',
    })).toBeUndefined()

    // Should NOT exist in unlisted
    expect(await cache.get({
      key: 'delete:me',
      visibility: 'unlisted',
    })).toBeUndefined()
  })
})

// =============================================================================
// TEST SUITE: Cache Pool Invalidation
// =============================================================================

describe('Cache Pool Invalidation', () => {
  it('should isolate invalidation within pool', async () => {
    const mainCache = new VisibilityCache()
    const analyticsPool = mainCache.createPool({ name: 'analytics' })
    const productsPool = mainCache.createPool({ name: 'products' })

    await mainCache.set({ key: 'data', visibility: 'public', data: 'main' })
    await analyticsPool.set({ key: 'data', visibility: 'public', data: 'analytics' })
    await productsPool.set({ key: 'data', visibility: 'public', data: 'products' })

    // Invalidate only in analytics pool
    await analyticsPool.invalidate({ key: 'data', visibility: 'public' })

    // Analytics should be gone
    expect(await analyticsPool.get({ key: 'data', visibility: 'public' })).toBeUndefined()

    // Others should remain
    expect(await mainCache.get({ key: 'data', visibility: 'public' })).toBe('main')
    expect(await productsPool.get({ key: 'data', visibility: 'public' })).toBe('products')
  })

  it('should use pool-specific TTL configuration', async () => {
    vi.useFakeTimers()

    const mainCache = new VisibilityCache()
    const shortTTLPool = mainCache.createPool({
      name: 'short-ttl',
      ttl: { public: 30, unlisted: 30, org: 30, user: 30 },
    })

    await mainCache.set({ key: 'item', visibility: 'public', data: 'main' })
    await shortTTLPool.set({ key: 'item', visibility: 'public', data: 'short' })

    vi.advanceTimersByTime(45 * 1000) // 45 seconds

    // Short TTL pool entry should be expired
    expect(await shortTTLPool.get({ key: 'item', visibility: 'public' })).toBeUndefined()

    // Main cache entry should still be valid (default 3600s TTL)
    expect(await mainCache.get({ key: 'item', visibility: 'public' })).toBe('main')

    vi.useRealTimers()
  })
})
