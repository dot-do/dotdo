/**
 * RED Phase Tests: LRU Cache for Package Metadata
 *
 * These tests define the expected behavior for an LRU (Least Recently Used) cache
 * to prevent OOM issues from unbounded memory growth in NpmDO's packageCache.
 *
 * Acceptance Criteria:
 * - [ ] Cache has max size limit
 * - [ ] LRU eviction works correctly
 * - [ ] Cache stats exposed (hits, misses, evictions)
 * - [ ] No memory growth over time
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
// RED: This import will fail until we implement the LRU cache
import {
  LRUCache,
  type CacheOptions,
  type CacheStats,
} from '../../../core/cache/lru.js'

describe('LRU Cache for Package Metadata', () => {
  describe('Basic Operations', () => {
    it('should set and get a value', () => {
      const cache = new LRUCache<string, string>()

      cache.set('lodash@4.17.21', 'metadata')

      expect(cache.get('lodash@4.17.21')).toBe('metadata')
    })

    it('should return undefined for missing keys', () => {
      const cache = new LRUCache<string, string>()

      expect(cache.get('nonexistent')).toBeUndefined()
    })

    it('should overwrite existing values', () => {
      const cache = new LRUCache<string, string>()

      cache.set('lodash@4.17.21', 'old')
      cache.set('lodash@4.17.21', 'new')

      expect(cache.get('lodash@4.17.21')).toBe('new')
    })

    it('should track current size', () => {
      const cache = new LRUCache<string, string>()

      cache.set('a', '1')
      cache.set('b', '2')

      expect(cache.size).toBe(2)
    })

    it('should delete entries', () => {
      const cache = new LRUCache<string, string>()

      cache.set('key', 'value')
      cache.delete('key')

      expect(cache.get('key')).toBeUndefined()
      expect(cache.size).toBe(0)
    })

    it('should clear all entries', () => {
      const cache = new LRUCache<string, string>()

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')
      cache.clear()

      expect(cache.size).toBe(0)
      expect(cache.get('a')).toBeUndefined()
    })

    it('should check if key exists', () => {
      const cache = new LRUCache<string, string>()

      cache.set('exists', 'value')

      expect(cache.has('exists')).toBe(true)
      expect(cache.has('missing')).toBe(false)
    })
  })

  describe('MAX_CACHE_SIZE Enforcement', () => {
    it('should evict oldest entry when max size is reached', () => {
      const cache = new LRUCache<string, string>({ maxSize: 3 })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')
      cache.set('d', '4') // Should evict 'a'

      expect(cache.get('a')).toBeUndefined()
      expect(cache.get('b')).toBe('2')
      expect(cache.get('c')).toBe('3')
      expect(cache.get('d')).toBe('4')
      expect(cache.size).toBe(3)
    })

    it('should respect default max size of 100', () => {
      const cache = new LRUCache<string, string>()

      // Add 150 items
      for (let i = 0; i < 150; i++) {
        cache.set(`key${i}`, `value${i}`)
      }

      expect(cache.size).toBe(100)
    })

    it('should allow configurable max size', () => {
      const cache = new LRUCache<string, string>({ maxSize: 50 })

      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, `value${i}`)
      }

      expect(cache.size).toBe(50)
    })

    it('should evict multiple entries to fit new entry if needed', () => {
      const cache = new LRUCache<string, string>({ maxSize: 3 })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')

      // Resize the cache to force multiple evictions
      cache.resize(1)

      expect(cache.size).toBe(1)
      // Only most recent should remain
      expect(cache.get('c')).toBe('3')
      expect(cache.get('a')).toBeUndefined()
      expect(cache.get('b')).toBeUndefined()
    })
  })

  describe('LRU Eviction Policy', () => {
    it('should evict least recently USED entry (not just oldest)', () => {
      const cache = new LRUCache<string, string>({ maxSize: 3 })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')
      cache.get('a') // Access 'a', making it most recently used
      cache.set('d', '4') // Should evict 'b' (least recently used)

      expect(cache.get('a')).toBe('1')
      expect(cache.get('b')).toBeUndefined() // 'b' was evicted
      expect(cache.get('c')).toBe('3')
      expect(cache.get('d')).toBe('4')
    })

    it('should update LRU order on get', () => {
      const cache = new LRUCache<string, string>({ maxSize: 3 })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')

      // Access in specific order
      cache.get('a')
      cache.get('b')
      // Now order should be: c (LRU), a, b (MRU)

      cache.set('d', '4') // Should evict 'c'

      expect(cache.get('c')).toBeUndefined()
      expect(cache.get('a')).toBe('1')
      expect(cache.get('b')).toBe('2')
      expect(cache.get('d')).toBe('4')
    })

    it('should update LRU order on set of existing key', () => {
      const cache = new LRUCache<string, string>({ maxSize: 3 })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')
      cache.set('a', 'updated') // Update 'a', making it most recently used
      cache.set('d', '4') // Should evict 'b'

      expect(cache.get('a')).toBe('updated')
      expect(cache.get('b')).toBeUndefined()
      expect(cache.get('c')).toBe('3')
      expect(cache.get('d')).toBe('4')
    })

    it('should not update LRU order on has()', () => {
      const cache = new LRUCache<string, string>({ maxSize: 2 })

      cache.set('a', '1')
      cache.set('b', '2')

      cache.has('a') // Should NOT update LRU order
      cache.set('c', '3') // Should evict 'a' since it's still LRU

      expect(cache.get('a')).toBeUndefined()
      expect(cache.get('b')).toBe('2')
      expect(cache.get('c')).toBe('3')
    })

    it('should provide peek() without updating LRU order', () => {
      const cache = new LRUCache<string, string>({ maxSize: 2 })

      cache.set('a', '1')
      cache.set('b', '2')

      expect(cache.peek('a')).toBe('1')
      cache.set('c', '3') // Should evict 'a' since peek() didn't update order

      expect(cache.get('a')).toBeUndefined()
    })

    it('should return keys in LRU order (MRU first)', () => {
      const cache = new LRUCache<string, string>({ maxSize: 5 })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')
      cache.get('a') // 'a' becomes MRU

      const keys = cache.keys()
      expect(keys[0]).toBe('a') // Most recently used
      expect(keys[keys.length - 1]).toBe('b') // Least recently used
    })
  })

  describe('Cache Statistics', () => {
    it('should track cache hits', () => {
      const cache = new LRUCache<string, string>()
      cache.set('key', 'value')

      cache.get('key') // hit
      cache.get('key') // hit

      const stats = cache.getStats()
      expect(stats.hits).toBe(2)
    })

    it('should track cache misses', () => {
      const cache = new LRUCache<string, string>()

      cache.get('missing1') // miss
      cache.get('missing2') // miss

      const stats = cache.getStats()
      expect(stats.misses).toBe(2)
    })

    it('should track evictions', () => {
      const cache = new LRUCache<string, string>({ maxSize: 2 })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3') // evicts 'a'
      cache.set('d', '4') // evicts 'b'

      const stats = cache.getStats()
      expect(stats.evictions).toBe(2)
    })

    it('should calculate hit rate correctly', () => {
      const cache = new LRUCache<string, string>()
      cache.set('key', 'value')

      cache.get('key') // hit
      cache.get('key') // hit
      cache.get('key') // hit
      cache.get('missing') // miss

      const stats = cache.getStats()
      expect(stats.hitRate).toBe(75) // 3 hits / 4 total = 75%
    })

    it('should return 0 hit rate when no operations', () => {
      const cache = new LRUCache<string, string>()

      const stats = cache.getStats()
      expect(stats.hitRate).toBe(0)
    })

    it('should expose current count in stats', () => {
      const cache = new LRUCache<string, string>()

      cache.set('a', '1')
      cache.set('b', '2')

      const stats = cache.getStats()
      expect(stats.count).toBe(2)
    })

    it('should reset stats without clearing data', () => {
      const cache = new LRUCache<string, string>()
      cache.set('key', 'value')
      cache.get('key')
      cache.get('missing')

      cache.resetStats()

      const stats = cache.getStats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      expect(stats.evictions).toBe(0)
      expect(cache.get('key')).toBe('value') // Data still there
    })
  })

  describe('Memory Bounds (No OOM)', () => {
    it('should not grow beyond max size under continuous load', () => {
      const cache = new LRUCache<string, string>({ maxSize: 100 })

      // Simulate continuous package metadata lookups
      for (let i = 0; i < 10000; i++) {
        cache.set(`package-${i}@${i % 100}.0.0`, `metadata-${i}`)
      }

      expect(cache.size).toBe(100)
    })

    it('should handle rapid access patterns without memory leak', () => {
      const cache = new LRUCache<string, object>({ maxSize: 50 })

      // Simulate hot path with some packages accessed frequently
      for (let round = 0; round < 100; round++) {
        // Popular packages (frequently accessed)
        cache.get('lodash@4.17.21')
        cache.get('react@18.2.0')
        cache.get('typescript@5.0.0')

        // New packages (continuous additions)
        cache.set(`new-package-${round}@1.0.0`, { name: `new-package-${round}` })
      }

      expect(cache.size).toBeLessThanOrEqual(50)
    })

    it('should provide resize() to adjust limits dynamically', () => {
      const cache = new LRUCache<string, string>({ maxSize: 100 })

      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, `value${i}`)
      }

      expect(cache.size).toBe(100)

      // Reduce size (e.g., under memory pressure)
      cache.resize(50)

      expect(cache.size).toBe(50)
    })
  })

  describe('Package Metadata Use Case', () => {
    interface PackageMetadata {
      name: string
      version: string
      dependencies?: Record<string, string>
    }

    it('should work with PackageMetadata objects', () => {
      const cache = new LRUCache<string, PackageMetadata>({ maxSize: 100 })

      const metadata: PackageMetadata = {
        name: 'lodash',
        version: '4.17.21',
        dependencies: {},
      }

      cache.set('lodash@4.17.21', metadata)

      expect(cache.get('lodash@4.17.21')).toEqual(metadata)
    })

    it('should handle package versioning patterns', () => {
      const cache = new LRUCache<string, PackageMetadata>({ maxSize: 10 })

      // Same package, different versions
      cache.set('react@17.0.0', { name: 'react', version: '17.0.0' })
      cache.set('react@18.0.0', { name: 'react', version: '18.0.0' })
      cache.set('react@18.2.0', { name: 'react', version: '18.2.0' })

      expect(cache.get('react@17.0.0')?.version).toBe('17.0.0')
      expect(cache.get('react@18.2.0')?.version).toBe('18.2.0')
    })

    it('should handle scoped packages', () => {
      const cache = new LRUCache<string, PackageMetadata>({ maxSize: 100 })

      const metadata: PackageMetadata = {
        name: '@dotdo/npmx',
        version: '0.0.1',
      }

      cache.set('@dotdo/npmx@0.0.1', metadata)

      expect(cache.get('@dotdo/npmx@0.0.1')).toEqual(metadata)
    })
  })

  describe('Eviction Callback', () => {
    it('should call onEvict when item is evicted due to LRU', () => {
      const evicted: Array<{ key: string; value: string }> = []
      const cache = new LRUCache<string, string>({
        maxSize: 2,
        onEvict: (key, value) => {
          evicted.push({ key, value })
        },
      })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3') // Evicts 'a'

      expect(evicted).toHaveLength(1)
      expect(evicted[0].key).toBe('a')
      expect(evicted[0].value).toBe('1')
    })

    it('should call onEvict on manual delete', () => {
      const evicted: string[] = []
      const cache = new LRUCache<string, string>({
        onEvict: (key) => evicted.push(key),
      })

      cache.set('key', 'value')
      cache.delete('key')

      expect(evicted).toContain('key')
    })

    it('should call onEvict for all items on clear', () => {
      const evicted: string[] = []
      const cache = new LRUCache<string, string>({
        onEvict: (key) => evicted.push(key),
      })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')
      cache.clear()

      expect(evicted).toHaveLength(3)
    })
  })

  describe('Edge Cases', () => {
    it('should handle max size of 1', () => {
      const cache = new LRUCache<string, string>({ maxSize: 1 })

      cache.set('a', '1')
      cache.set('b', '2')

      expect(cache.size).toBe(1)
      expect(cache.get('a')).toBeUndefined()
      expect(cache.get('b')).toBe('2')
    })

    it('should handle empty string keys', () => {
      const cache = new LRUCache<string, string>()

      cache.set('', 'empty key')

      expect(cache.get('')).toBe('empty key')
    })

    it('should handle null and undefined values', () => {
      const cache = new LRUCache<string, null | undefined>()

      cache.set('null', null)
      cache.set('undefined', undefined)

      expect(cache.has('null')).toBe(true)
      expect(cache.get('null')).toBeNull()
      expect(cache.has('undefined')).toBe(true)
      expect(cache.get('undefined')).toBeUndefined()
    })

    it('should handle rapid set/get on same key', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 })

      for (let i = 0; i < 1000; i++) {
        cache.set('hot-key', i)
        expect(cache.get('hot-key')).toBe(i)
      }

      expect(cache.size).toBe(1)
    })
  })
})
