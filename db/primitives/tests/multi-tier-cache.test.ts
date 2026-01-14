/**
 * Tests for MultiTierCache primitive
 *
 * Following TDD approach with real implementations (no mocks)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createMultiTierCache,
  type MultiTierCache,
  type CacheLoader,
  InMemoryL2Storage,
  MultiTierCacheMetrics,
} from '../multi-tier-cache'
import { TestMetricsCollector } from '../observability'

describe('MultiTierCache', () => {
  let cache: MultiTierCache<string>
  let loader: CacheLoader<string>
  let loadCounts: Map<string, number>

  beforeEach(() => {
    loadCounts = new Map()
    loader = async (key: string) => {
      const count = loadCounts.get(key) ?? 0
      loadCounts.set(key, count + 1)

      // Simulate some data
      if (key.startsWith('user:')) {
        return `User ${key.slice(5)}`
      }
      if (key.startsWith('missing:')) {
        return null
      }
      return `value:${key}`
    }

    cache = createMultiTierCache<string>({
      loader,
      l1MaxSize: 100,
    })
  })

  describe('basic operations', () => {
    it('should get value from L3 loader on cache miss', async () => {
      const value = await cache.get('user:123')
      expect(value).toBe('User 123')
      expect(loadCounts.get('user:123')).toBe(1)
    })

    it('should return cached value on subsequent gets (L1 hit)', async () => {
      // First get - loads from L3
      await cache.get('user:123')
      expect(loadCounts.get('user:123')).toBe(1)

      // Second get - should hit L1
      const value = await cache.get('user:123')
      expect(value).toBe('User 123')
      expect(loadCounts.get('user:123')).toBe(1) // Still 1, no new load
    })

    it('should set values directly', async () => {
      await cache.set('custom:key', 'custom value')
      const value = await cache.get('custom:key')
      expect(value).toBe('custom value')
      expect(loadCounts.has('custom:key')).toBe(false) // No loader call
    })

    it('should delete values', async () => {
      await cache.set('key', 'value')
      expect(await cache.has('key')).toBe(true)

      const deleted = await cache.delete('key')
      expect(deleted).toBe(true)
      expect(await cache.has('key')).toBe(false)
    })

    it('should return false when deleting non-existent key', async () => {
      const deleted = await cache.delete('nonexistent')
      expect(deleted).toBe(false)
    })

    it('should handle null values from loader (negative caching)', async () => {
      const value = await cache.get('missing:item')
      expect(value).toBeNull()
      expect(loadCounts.get('missing:item')).toBe(1)

      // Second get should not call loader again (negative cache)
      await cache.get('missing:item')
      expect(loadCounts.get('missing:item')).toBe(1)
    })
  })

  describe('getMany / setMany', () => {
    it('should get multiple values', async () => {
      await cache.set('a', 'value-a')
      await cache.set('b', 'value-b')

      const results = await cache.getMany(['a', 'b', 'c'])
      expect(results.get('a')).toBe('value-a')
      expect(results.get('b')).toBe('value-b')
      expect(results.get('c')).toBe('value:c') // From loader
    })

    it('should set multiple values', async () => {
      const entries = new Map([
        ['x', 'value-x'],
        ['y', 'value-y'],
      ])
      await cache.setMany(entries)

      expect(await cache.get('x')).toBe('value-x')
      expect(await cache.get('y')).toBe('value-y')
    })

    it('should delete multiple values', async () => {
      await cache.set('del1', 'v1')
      await cache.set('del2', 'v2')
      await cache.set('del3', 'v3')

      const count = await cache.deleteMany(['del1', 'del2', 'nonexistent'])
      expect(count).toBe(2)
      expect(await cache.has('del1')).toBe(false)
      expect(await cache.has('del2')).toBe(false)
      expect(await cache.has('del3')).toBe(true)
    })
  })

  describe('TTL expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should expire entries after TTL', async () => {
      cache = createMultiTierCache<string>({
        loader,
        defaultTTL: 1000, // 1 second
      })

      await cache.set('ttl-key', 'ttl-value')
      expect(await cache.get('ttl-key')).toBe('ttl-value')

      // Advance time past TTL
      vi.advanceTimersByTime(1500)

      // Should reload from L3 because entry expired
      const value = await cache.get('ttl-key')
      expect(value).toBe('value:ttl-key') // From loader
      expect(loadCounts.get('ttl-key')).toBe(1)
    })

    it('should support per-key TTL override', async () => {
      cache = createMultiTierCache<string>({
        loader,
        defaultTTL: 10000, // 10 seconds
      })

      await cache.set('short-ttl', 'value', { ttl: 500 }) // Override to 500ms

      // After 600ms, should be expired
      vi.advanceTimersByTime(600)

      const value = await cache.get('short-ttl')
      expect(value).toBe('value:short-ttl') // Reloaded
    })

    it('should report TTL remaining', async () => {
      vi.useRealTimers() // Use real timers for this test

      cache = createMultiTierCache<string>({
        loader,
      })

      await cache.set('ttl-check', 'value', { ttl: 5000 })
      const remaining = await cache.ttl('ttl-check')
      expect(remaining).toBeGreaterThan(4000)
      expect(remaining).toBeLessThanOrEqual(5000)
    })

    it('should return -1 for keys without TTL', async () => {
      await cache.set('no-ttl', 'value')
      const ttl = await cache.ttl('no-ttl')
      expect(ttl).toBe(-1)
    })

    it('should return -2 for non-existent keys', async () => {
      const ttl = await cache.ttl('nonexistent')
      expect(ttl).toBe(-2)
    })

    it('should update TTL with expire()', async () => {
      await cache.set('expire-test', 'value', { ttl: 1000 })
      await cache.expire('expire-test', 5000)

      const remaining = await cache.ttl('expire-test')
      expect(remaining).toBeGreaterThan(4000)
    })

    it('should remove TTL with persist()', async () => {
      await cache.set('persist-test', 'value', { ttl: 1000 })
      expect(await cache.ttl('persist-test')).toBeGreaterThan(0)

      await cache.persist('persist-test')
      expect(await cache.ttl('persist-test')).toBe(-1)
    })
  })

  describe('L2 storage', () => {
    let l2: InMemoryL2Storage<string>

    beforeEach(() => {
      l2 = new InMemoryL2Storage<string>()
      cache = createMultiTierCache<string>({
        loader,
        l2Storage: l2,
      })
    })

    it('should populate L2 on cache set', async () => {
      await cache.set('l2-key', 'l2-value')

      // Verify L2 has the entry
      const entry = await l2.get('l2-key')
      expect(entry).not.toBeNull()
      expect(entry?.value).toBe('l2-value')
    })

    it('should read from L2 when L1 misses', async () => {
      // Set directly in L2
      await l2.set('l2-only', {
        value: 'from-l2',
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        accessCount: 1,
      })

      // Clear L1 by creating new cache with same L2
      cache = createMultiTierCache<string>({
        loader,
        l2Storage: l2,
      })

      const value = await cache.get('l2-only')
      expect(value).toBe('from-l2')
      expect(loadCounts.has('l2-only')).toBe(false) // No L3 load
    })

    it('should promote L2 entries to L1', async () => {
      // Set in L2 directly
      await l2.set('promote-key', {
        value: 'promoted',
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        accessCount: 1,
      })

      // First get - reads from L2, promotes to L1
      await cache.get('promote-key')

      // Delete from L2 to prove L1 has it
      await l2.delete('promote-key')

      // Should still get from L1
      const value = await cache.get('promote-key')
      expect(value).toBe('promoted')
    })

    it('should skip L1 with skipL1 option', async () => {
      await cache.set('skip-l1', 'value')

      // Skip L1, should still find in L2
      const value = await cache.get('skip-l1', { skipL1: true })
      expect(value).toBe('value')
    })

    it('should skip L2 with skipL2 option', async () => {
      // Set in L2 only
      await l2.set('l2-only', {
        value: 'should-skip',
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        accessCount: 1,
      })

      // Skip L2, should load from L3
      const value = await cache.get('l2-only', { skipL2: true })
      expect(value).toBe('value:l2-only') // From loader
      expect(loadCounts.get('l2-only')).toBe(1)
    })
  })

  describe('eviction', () => {
    it('should evict old entries when L1 is full (LRU)', async () => {
      cache = createMultiTierCache<string>({
        loader,
        l1MaxSize: 3,
        evictionPolicy: 'lru',
      })

      await cache.set('a', 'v-a')
      await cache.set('b', 'v-b')
      await cache.set('c', 'v-c')

      // Access 'a' to make it recently used
      await cache.get('a')

      // Add 'd' - should evict 'b' (least recently used)
      await cache.set('d', 'v-d')

      expect(await cache.has('a')).toBe(true) // Accessed recently
      expect(await cache.has('b')).toBe(false) // Evicted
      expect(await cache.has('c')).toBe(true)
      expect(await cache.has('d')).toBe(true)
    })

    it('should track eviction count in stats', async () => {
      cache = createMultiTierCache<string>({
        loader,
        l1MaxSize: 2,
      })

      await cache.set('1', 'v1')
      await cache.set('2', 'v2')
      await cache.set('3', 'v3') // Triggers eviction

      const stats = cache.stats()
      expect(stats.l1.evictions).toBeGreaterThanOrEqual(1)
    })
  })

  describe('cache statistics', () => {
    it('should track L1 hits and misses', async () => {
      await cache.set('key', 'value')
      await cache.get('key') // L1 hit
      await cache.get('key') // L1 hit
      await cache.get('other') // L1 miss, L3 load

      const stats = cache.stats()
      expect(stats.l1.hits).toBe(2)
      expect(stats.l1.misses).toBe(1)
    })

    it('should track L2 hits and misses', async () => {
      const l2 = new InMemoryL2Storage<string>()
      cache = createMultiTierCache<string>({
        loader,
        l2Storage: l2,
      })

      // Set in L2 directly
      await l2.set('l2-key', {
        value: 'from-l2',
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        accessCount: 1,
      })

      // Miss L1, hit L2
      await cache.get('l2-key', { skipL1: true })

      // Miss L1, miss L2, load from L3
      await cache.get('new-key', { skipL1: true })

      const stats = cache.stats()
      expect(stats.l2.hits).toBe(1)
      expect(stats.l2.misses).toBe(1)
    })

    it('should track L3 loads', async () => {
      await cache.get('load1')
      await cache.get('load2')
      await cache.get('load1') // Should be cached

      const stats = cache.stats()
      expect(stats.l3.loads).toBe(2)
    })

    it('should calculate hit rates', async () => {
      await cache.set('cached', 'value')
      await cache.get('cached') // Hit
      await cache.get('cached') // Hit
      await cache.get('other') // Miss

      const stats = cache.stats()
      expect(stats.l1.hitRate).toBeCloseTo(2/3, 1)
    })

    it('should reset statistics', async () => {
      await cache.get('key1')
      await cache.get('key2')

      cache.resetStats()

      const stats = cache.stats()
      expect(stats.l1.hits).toBe(0)
      expect(stats.l1.misses).toBe(0)
      expect(stats.l3.loads).toBe(0)
    })
  })

  describe('metrics integration', () => {
    let metrics: TestMetricsCollector

    beforeEach(() => {
      metrics = new TestMetricsCollector()
      cache = createMultiTierCache<string>({
        loader,
        metrics,
      })
    })

    it('should record L1 hit metrics', async () => {
      await cache.set('key', 'value')
      await cache.get('key')

      const hits = metrics.getCounterTotal(MultiTierCacheMetrics.L1_HIT)
      expect(hits).toBe(1)
    })

    it('should record L1 miss metrics', async () => {
      await cache.get('uncached')

      const misses = metrics.getCounterTotal(MultiTierCacheMetrics.L1_MISS)
      expect(misses).toBe(1)
    })

    it('should record L3 load metrics', async () => {
      await cache.get('from-loader')

      const loads = metrics.getCounterTotal(MultiTierCacheMetrics.L3_LOAD)
      expect(loads).toBe(1)
    })

    it('should record latency metrics', async () => {
      await cache.get('key')

      const latencies = metrics.getLatencies(MultiTierCacheMetrics.GET_LATENCY)
      expect(latencies.length).toBe(1)
      expect(latencies[0]).toBeGreaterThanOrEqual(0)
    })

    it('should record eviction metrics', async () => {
      cache = createMultiTierCache<string>({
        loader,
        metrics,
        l1MaxSize: 2,
      })

      await cache.set('a', 'v')
      await cache.set('b', 'v')
      await cache.set('c', 'v') // Triggers eviction

      const evictions = metrics.getCounterTotal(MultiTierCacheMetrics.L1_EVICTION)
      expect(evictions).toBe(1)
    })
  })

  describe('clear and invalidate', () => {
    it('should clear all L1 entries', async () => {
      await cache.set('a', 'v')
      await cache.set('b', 'v')
      await cache.set('c', 'v')

      await cache.clear()

      expect(await cache.has('a')).toBe(false)
      expect(await cache.has('b')).toBe(false)
      expect(await cache.has('c')).toBe(false)
    })

    it('should clear L2 with includeL2 flag', async () => {
      const l2 = new InMemoryL2Storage<string>()
      cache = createMultiTierCache<string>({
        loader,
        l2Storage: l2,
      })

      await cache.set('key', 'value')
      expect(await l2.get('key')).not.toBeNull()

      await cache.clear(true) // Include L2

      expect(await l2.get('key')).toBeNull()
    })

    it('should invalidate by pattern', async () => {
      await cache.set('user:1', 'v')
      await cache.set('user:2', 'v')
      await cache.set('post:1', 'v')

      const count = await cache.invalidate('user:*')

      expect(count).toBe(2)
      expect(await cache.has('user:1')).toBe(false)
      expect(await cache.has('user:2')).toBe(false)
      expect(await cache.has('post:1')).toBe(true)
    })
  })

  describe('cache warming', () => {
    it('should preload keys', async () => {
      const loaded = await cache.warm(['user:1', 'user:2', 'user:3'])
      expect(loaded).toBe(3)

      // All should be cached now
      expect(loadCounts.get('user:1')).toBe(1)
      expect(loadCounts.get('user:2')).toBe(1)
      expect(loadCounts.get('user:3')).toBe(1)

      // Get again should not reload
      await cache.get('user:1')
      expect(loadCounts.get('user:1')).toBe(1)
    })

    it('should not count null results in warm', async () => {
      const loaded = await cache.warm(['user:1', 'missing:x', 'user:2'])
      expect(loaded).toBe(2)
    })
  })

  describe('keys listing', () => {
    it('should list all keys', async () => {
      await cache.set('a', 'v')
      await cache.set('b', 'v')
      await cache.set('c', 'v')

      const keys = await cache.keys()
      expect(keys).toHaveLength(3)
      expect(keys).toContain('a')
      expect(keys).toContain('b')
      expect(keys).toContain('c')
    })

    it('should filter keys by pattern', async () => {
      await cache.set('user:1', 'v')
      await cache.set('user:2', 'v')
      await cache.set('post:1', 'v')

      const keys = await cache.keys('user:*')
      expect(keys).toHaveLength(2)
      expect(keys).toContain('user:1')
      expect(keys).toContain('user:2')
    })
  })

  describe('write strategies', () => {
    it('should support write-through (default)', async () => {
      const l2 = new InMemoryL2Storage<string>()
      cache = createMultiTierCache<string>({
        loader,
        l2Storage: l2,
        writeStrategy: 'write-through',
      })

      await cache.set('key', 'value')

      // L2 should have the value immediately
      const entry = await l2.get('key')
      expect(entry?.value).toBe('value')
    })

    it('should support write-around', async () => {
      const l2 = new InMemoryL2Storage<string>()
      cache = createMultiTierCache<string>({
        loader,
        l2Storage: l2,
        writeStrategy: 'write-around',
      })

      await cache.set('key', 'value')

      // L2 should NOT have the value (write-around skips L2)
      const entry = await l2.get('key')
      expect(entry).toBeNull()
    })
  })

  describe('loader errors', () => {
    it('should propagate loader errors', async () => {
      const errorLoader: CacheLoader<string> = async () => {
        throw new Error('Loader failed')
      }

      cache = createMultiTierCache<string>({
        loader: errorLoader,
      })

      await expect(cache.get('key')).rejects.toThrow('Loader failed')
    })

    it('should track load errors in stats', async () => {
      const metrics = new TestMetricsCollector()
      const errorLoader: CacheLoader<string> = async () => {
        throw new Error('Loader failed')
      }

      cache = createMultiTierCache<string>({
        loader: errorLoader,
        metrics,
      })

      await cache.get('key').catch(() => {})

      const errors = metrics.getCounterTotal(MultiTierCacheMetrics.L3_LOAD_ERROR)
      expect(errors).toBe(1)

      const stats = cache.stats()
      expect(stats.l3.loadErrors).toBe(1)
    })
  })

  describe('negative caching', () => {
    it('should cache null results by default', async () => {
      await cache.get('missing:item')
      await cache.get('missing:item')

      // Should only call loader once
      expect(loadCounts.get('missing:item')).toBe(1)
    })

    it('should disable negative caching when configured', async () => {
      cache = createMultiTierCache<string>({
        loader,
        negativeCache: false,
      })

      await cache.get('missing:item')
      await cache.get('missing:item')

      // Should call loader twice (no negative cache)
      expect(loadCounts.get('missing:item')).toBe(2)
    })

    it('should expire negative cache entries', async () => {
      vi.useFakeTimers()

      cache = createMultiTierCache<string>({
        loader,
        negativeCacheTTL: 1000,
      })

      await cache.get('missing:item')
      expect(loadCounts.get('missing:item')).toBe(1)

      // Advance past negative cache TTL
      vi.advanceTimersByTime(1500)

      await cache.get('missing:item')
      expect(loadCounts.get('missing:item')).toBe(2)

      vi.useRealTimers()
    })
  })
})

describe('InMemoryL2Storage', () => {
  let storage: InMemoryL2Storage<string>

  beforeEach(() => {
    storage = new InMemoryL2Storage<string>()
  })

  it('should get and set entries', async () => {
    const entry = {
      value: 'test',
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 1,
    }

    await storage.set('key', entry)
    const result = await storage.get('key')

    expect(result?.value).toBe('test')
  })

  it('should return null for missing keys', async () => {
    const result = await storage.get('missing')
    expect(result).toBeNull()
  })

  it('should delete entries', async () => {
    await storage.set('key', {
      value: 'test',
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 1,
    })

    const deleted = await storage.delete('key')
    expect(deleted).toBe(true)

    const result = await storage.get('key')
    expect(result).toBeNull()
  })

  it('should clear all entries', async () => {
    await storage.set('a', { value: 'v', createdAt: 0, lastAccessed: 0, accessCount: 0 })
    await storage.set('b', { value: 'v', createdAt: 0, lastAccessed: 0, accessCount: 0 })

    await storage.clear()

    expect(await storage.get('a')).toBeNull()
    expect(await storage.get('b')).toBeNull()
  })

  it('should list keys', async () => {
    await storage.set('user:1', { value: 'v', createdAt: 0, lastAccessed: 0, accessCount: 0 })
    await storage.set('user:2', { value: 'v', createdAt: 0, lastAccessed: 0, accessCount: 0 })
    await storage.set('post:1', { value: 'v', createdAt: 0, lastAccessed: 0, accessCount: 0 })

    const allKeys = await storage.keys()
    expect(allKeys).toHaveLength(3)

    const userKeys = await storage.keys('user:*')
    expect(userKeys).toHaveLength(2)
  })

  it('should handle TTL expiration', async () => {
    vi.useFakeTimers()

    await storage.set('ttl-key', {
      value: 'test',
      createdAt: Date.now(),
      expiresAt: Date.now() + 1000,
      lastAccessed: Date.now(),
      accessCount: 1,
    })

    // Before expiration
    expect(await storage.get('ttl-key')).not.toBeNull()

    // After expiration
    vi.advanceTimersByTime(1500)
    expect(await storage.get('ttl-key')).toBeNull()

    vi.useRealTimers()
  })
})

// Import afterEach for cleanup
import { afterEach } from 'vitest'
