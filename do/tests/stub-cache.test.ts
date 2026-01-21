/**
 * DO Stub Cache Tests - TTL and Eviction Policies
 *
 * Tests for the typed DO stub cache with:
 * 1. TTL-based expiration
 * 2. Max size limits
 * 3. LRU eviction when cache is full
 * 4. Lazy cleanup on access
 *
 * Issue: do-o16uz
 *
 * @module do/tests/stub-cache.test
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  StubCache,
  type StubCacheOptions,
  type CacheEntry,
  DEFAULT_STUB_CACHE_OPTIONS,
} from '../workflow/stub-cache'
import type { DOStubProxy } from '../workflow/rpc'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock DO stub for testing
 */
function createMockStub(name: string): DOStubProxy {
  return {
    testMethod: async () => ({ name }),
  }
}

/**
 * Create a cache with default test options
 */
function createTestCache(options?: Partial<StubCacheOptions>): StubCache {
  return new StubCache({
    maxSize: 100,
    ttlMs: 5 * 60 * 1000, // 5 minutes
    ...options,
  })
}

// ============================================================================
// TESTS
// ============================================================================

describe('StubCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // DEFAULT OPTIONS
  // ==========================================================================

  describe('Default Options', () => {
    it('should have sensible default values', () => {
      expect(DEFAULT_STUB_CACHE_OPTIONS.maxSize).toBe(100)
      expect(DEFAULT_STUB_CACHE_OPTIONS.ttlMs).toBe(5 * 60 * 1000) // 5 minutes
    })
  })

  // ==========================================================================
  // TTL EXPIRATION TESTS
  // ==========================================================================

  describe('TTL Expiration', () => {
    it('should return cached entry before TTL expires', () => {
      const cache = createTestCache({ ttlMs: 1000 })
      const stub = createMockStub('test')

      cache.set('key1', stub)

      // Advance time but stay within TTL
      vi.advanceTimersByTime(500)

      expect(cache.get('key1')).toBe(stub)
    })

    it('should return undefined for expired entries', () => {
      const cache = createTestCache({ ttlMs: 1000 })
      const stub = createMockStub('test')

      cache.set('key1', stub)

      // Advance time past TTL
      vi.advanceTimersByTime(1001)

      expect(cache.get('key1')).toBeUndefined()
    })

    it('should not count expired entries in size', () => {
      const cache = createTestCache({ ttlMs: 1000 })

      cache.set('key1', createMockStub('1'))
      cache.set('key2', createMockStub('2'))

      expect(cache.size).toBe(2)

      // Expire all entries
      vi.advanceTimersByTime(1001)

      // Size should still report physical size (for internal tracking)
      // but validSize should be 0
      expect(cache.validSize).toBe(0)
    })

    it('should clean up expired entries on access', () => {
      const cache = createTestCache({ ttlMs: 1000 })

      cache.set('key1', createMockStub('1'))
      cache.set('key2', createMockStub('2'))

      // Expire first entry by waiting
      vi.advanceTimersByTime(500)

      // Add new entry
      cache.set('key3', createMockStub('3'))

      // Expire key1 and key2
      vi.advanceTimersByTime(501)

      // Access triggers cleanup
      cache.get('key3')

      // Only key3 should remain (it's not expired yet)
      expect(cache.has('key1')).toBe(false)
      expect(cache.has('key2')).toBe(false)
      expect(cache.has('key3')).toBe(true)
    })

    it('should refresh TTL on explicit refresh call', () => {
      const cache = createTestCache({ ttlMs: 1000 })
      const stub = createMockStub('test')

      cache.set('key1', stub)

      // Advance 800ms
      vi.advanceTimersByTime(800)

      // Refresh the entry
      cache.refresh('key1')

      // Advance another 800ms (1600ms total from original set)
      vi.advanceTimersByTime(800)

      // Entry should still be valid because we refreshed it
      expect(cache.get('key1')).toBe(stub)

      // Advance past new TTL
      vi.advanceTimersByTime(201)

      expect(cache.get('key1')).toBeUndefined()
    })
  })

  // ==========================================================================
  // MAX SIZE TESTS
  // ==========================================================================

  describe('Max Size Limit', () => {
    it('should enforce max size limit', () => {
      const cache = createTestCache({ maxSize: 3 })

      cache.set('key1', createMockStub('1'))
      cache.set('key2', createMockStub('2'))
      cache.set('key3', createMockStub('3'))
      cache.set('key4', createMockStub('4'))

      // Should have evicted one entry
      expect(cache.size).toBe(3)
    })

    it('should evict oldest entry when at capacity', () => {
      const cache = createTestCache({ maxSize: 3 })

      cache.set('key1', createMockStub('1'))
      vi.advanceTimersByTime(10)
      cache.set('key2', createMockStub('2'))
      vi.advanceTimersByTime(10)
      cache.set('key3', createMockStub('3'))
      vi.advanceTimersByTime(10)

      // This should evict key1 (oldest)
      cache.set('key4', createMockStub('4'))

      expect(cache.has('key1')).toBe(false)
      expect(cache.has('key2')).toBe(true)
      expect(cache.has('key3')).toBe(true)
      expect(cache.has('key4')).toBe(true)
    })

    it('should not evict when updating existing key', () => {
      const cache = createTestCache({ maxSize: 3 })

      cache.set('key1', createMockStub('1'))
      cache.set('key2', createMockStub('2'))
      cache.set('key3', createMockStub('3'))

      // Update existing key
      const newStub = createMockStub('1-updated')
      cache.set('key1', newStub)

      expect(cache.size).toBe(3)
      expect(cache.get('key1')).toBe(newStub)
    })
  })

  // ==========================================================================
  // LRU EVICTION TESTS
  // ==========================================================================

  describe('LRU Eviction', () => {
    it('should evict least recently used entry', () => {
      const cache = createTestCache({ maxSize: 3 })

      cache.set('key1', createMockStub('1'))
      vi.advanceTimersByTime(10)
      cache.set('key2', createMockStub('2'))
      vi.advanceTimersByTime(10)
      cache.set('key3', createMockStub('3'))
      vi.advanceTimersByTime(10)

      // Access key1 to make it recently used
      cache.get('key1')
      vi.advanceTimersByTime(10)

      // Add new entry - should evict key2 (least recently used)
      cache.set('key4', createMockStub('4'))

      expect(cache.has('key1')).toBe(true) // Recently accessed
      expect(cache.has('key2')).toBe(false) // LRU - evicted
      expect(cache.has('key3')).toBe(true)
      expect(cache.has('key4')).toBe(true)
    })

    it('should update last access time on get', () => {
      const cache = createTestCache({ maxSize: 3 })

      cache.set('key1', createMockStub('1'))
      vi.advanceTimersByTime(10)
      cache.set('key2', createMockStub('2'))
      vi.advanceTimersByTime(10)
      cache.set('key3', createMockStub('3'))
      vi.advanceTimersByTime(10)

      // Access key1 multiple times
      cache.get('key1')
      vi.advanceTimersByTime(10)
      cache.get('key1')
      vi.advanceTimersByTime(10)

      // Access key2
      cache.get('key2')
      vi.advanceTimersByTime(10)

      // Add new entry - should evict key3 (least recently used)
      cache.set('key4', createMockStub('4'))

      expect(cache.has('key1')).toBe(true)
      expect(cache.has('key2')).toBe(true)
      expect(cache.has('key3')).toBe(false) // LRU - evicted
      expect(cache.has('key4')).toBe(true)
    })

    it('should prioritize evicting expired entries over LRU', () => {
      const cache = createTestCache({ maxSize: 3, ttlMs: 50 })

      cache.set('key1', createMockStub('1'))
      vi.advanceTimersByTime(10)
      cache.set('key2', createMockStub('2'))
      vi.advanceTimersByTime(10)
      cache.set('key3', createMockStub('3'))
      vi.advanceTimersByTime(10)

      // Make key1 and key2 expired
      vi.advanceTimersByTime(40)

      // Now key1 and key2 are expired (60ms old), key3 is not (30ms old)
      // Access key3 to keep it fresh
      cache.get('key3')

      // Add new entry - should evict expired entries first
      cache.set('key4', createMockStub('4'))

      expect(cache.has('key3')).toBe(true)
      expect(cache.has('key4')).toBe(true)
    })
  })

  // ==========================================================================
  // BASIC OPERATIONS
  // ==========================================================================

  describe('Basic Operations', () => {
    it('should set and get entries', () => {
      const cache = createTestCache()
      const stub = createMockStub('test')

      cache.set('key1', stub)

      expect(cache.get('key1')).toBe(stub)
    })

    it('should check if entry exists', () => {
      const cache = createTestCache()

      cache.set('key1', createMockStub('1'))

      expect(cache.has('key1')).toBe(true)
      expect(cache.has('key2')).toBe(false)
    })

    it('should delete entries', () => {
      const cache = createTestCache()

      cache.set('key1', createMockStub('1'))
      cache.set('key2', createMockStub('2'))

      expect(cache.delete('key1')).toBe(true)
      expect(cache.has('key1')).toBe(false)
      expect(cache.has('key2')).toBe(true)
    })

    it('should return false when deleting non-existent key', () => {
      const cache = createTestCache()

      expect(cache.delete('nonexistent')).toBe(false)
    })

    it('should clear all entries', () => {
      const cache = createTestCache()

      cache.set('key1', createMockStub('1'))
      cache.set('key2', createMockStub('2'))
      cache.set('key3', createMockStub('3'))

      cache.clear()

      expect(cache.size).toBe(0)
      expect(cache.has('key1')).toBe(false)
      expect(cache.has('key2')).toBe(false)
      expect(cache.has('key3')).toBe(false)
    })

    it('should return correct size', () => {
      const cache = createTestCache()

      expect(cache.size).toBe(0)

      cache.set('key1', createMockStub('1'))
      expect(cache.size).toBe(1)

      cache.set('key2', createMockStub('2'))
      expect(cache.size).toBe(2)

      cache.delete('key1')
      expect(cache.size).toBe(1)
    })
  })

  // ==========================================================================
  // CLEANUP OPERATIONS
  // ==========================================================================

  describe('Cleanup Operations', () => {
    it('should remove expired entries on cleanup', () => {
      const cache = createTestCache({ ttlMs: 1000 })

      cache.set('key1', createMockStub('1'))
      vi.advanceTimersByTime(500)
      cache.set('key2', createMockStub('2'))
      vi.advanceTimersByTime(600)

      // key1 is expired (1100ms old), key2 is not (600ms old)
      const removed = cache.cleanup()

      expect(removed).toBe(1)
      expect(cache.has('key1')).toBe(false)
      expect(cache.has('key2')).toBe(true)
    })

    it('should return 0 when no entries are expired', () => {
      const cache = createTestCache({ ttlMs: 1000 })

      cache.set('key1', createMockStub('1'))
      cache.set('key2', createMockStub('2'))

      const removed = cache.cleanup()

      expect(removed).toBe(0)
    })
  })

  // ==========================================================================
  // ITERATION
  // ==========================================================================

  describe('Iteration', () => {
    it('should iterate over valid entries only', () => {
      const cache = createTestCache({ ttlMs: 1000 })

      cache.set('key1', createMockStub('1'))
      vi.advanceTimersByTime(500)
      cache.set('key2', createMockStub('2'))
      vi.advanceTimersByTime(600)

      // key1 is expired
      const keys: string[] = []
      for (const [key] of cache.entries()) {
        keys.push(key)
      }

      expect(keys).toEqual(['key2'])
    })

    it('should return all keys', () => {
      const cache = createTestCache()

      cache.set('key1', createMockStub('1'))
      cache.set('key2', createMockStub('2'))
      cache.set('key3', createMockStub('3'))

      const keys = cache.keys()

      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
      expect(keys).toContain('key3')
    })
  })

  // ==========================================================================
  // STATS
  // ==========================================================================

  describe('Cache Stats', () => {
    it('should track hits and misses', () => {
      const cache = createTestCache()

      cache.set('key1', createMockStub('1'))

      cache.get('key1') // hit
      cache.get('key1') // hit
      cache.get('key2') // miss
      cache.get('key3') // miss

      const stats = cache.getStats()

      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(2)
      expect(stats.hitRate).toBe(0.5)
    })

    it('should track evictions', () => {
      const cache = createTestCache({ maxSize: 2 })

      cache.set('key1', createMockStub('1'))
      cache.set('key2', createMockStub('2'))
      cache.set('key3', createMockStub('3')) // evicts key1
      cache.set('key4', createMockStub('4')) // evicts key2

      const stats = cache.getStats()

      expect(stats.evictions).toBe(2)
    })

    it('should track expirations', () => {
      const cache = createTestCache({ ttlMs: 100 })

      cache.set('key1', createMockStub('1'))
      cache.set('key2', createMockStub('2'))

      vi.advanceTimersByTime(101)

      // Access to trigger expiration detection
      cache.get('key1')
      cache.get('key2')

      const stats = cache.getStats()

      expect(stats.expirations).toBe(2)
    })

    it('should report current size and capacity', () => {
      const cache = createTestCache({ maxSize: 10 })

      cache.set('key1', createMockStub('1'))
      cache.set('key2', createMockStub('2'))
      cache.set('key3', createMockStub('3'))

      const stats = cache.getStats()

      expect(stats.size).toBe(3)
      expect(stats.maxSize).toBe(10)
    })
  })
})
