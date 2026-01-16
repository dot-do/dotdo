import { describe, it, expect, vi } from 'vitest'
import { LRUCache } from './lru-cache'

/**
 * LRUCache Unit Tests
 *
 * Tests for the simple LRU cache implementation used by DOCore
 * for caching things in memory.
 */

describe('LRUCache', () => {
  describe('basic operations', () => {
    it('should get and set values', () => {
      const cache = new LRUCache<string>()

      cache.set('key1', 'value1')
      expect(cache.get('key1')).toBe('value1')
    })

    it('should return undefined for missing keys', () => {
      const cache = new LRUCache<string>()

      expect(cache.get('nonexistent')).toBeUndefined()
    })

    it('should delete values', () => {
      const cache = new LRUCache<string>()

      cache.set('key1', 'value1')
      expect(cache.delete('key1')).toBe(true)
      expect(cache.get('key1')).toBeUndefined()
    })

    it('should return false when deleting nonexistent key', () => {
      const cache = new LRUCache<string>()

      expect(cache.delete('nonexistent')).toBe(false)
    })

    it('should clear all values', () => {
      const cache = new LRUCache<string>()

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.clear()

      expect(cache.size).toBe(0)
      expect(cache.get('key1')).toBeUndefined()
    })

    it('should track size correctly', () => {
      const cache = new LRUCache<string>()

      expect(cache.size).toBe(0)
      cache.set('key1', 'value1')
      expect(cache.size).toBe(1)
      cache.set('key2', 'value2')
      expect(cache.size).toBe(2)
      cache.delete('key1')
      expect(cache.size).toBe(1)
    })

    it('should check existence with has()', () => {
      const cache = new LRUCache<string>()

      expect(cache.has('key1')).toBe(false)
      cache.set('key1', 'value1')
      expect(cache.has('key1')).toBe(true)
    })
  })

  describe('LRU eviction', () => {
    it('should evict oldest entry when exceeding maxSize', () => {
      const cache = new LRUCache<string>({ maxSize: 2 })

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')

      // key1 should be evicted (oldest)
      expect(cache.get('key1')).toBeUndefined()
      expect(cache.get('key2')).toBe('value2')
      expect(cache.get('key3')).toBe('value3')
      expect(cache.size).toBe(2)
    })

    it('should move accessed items to MRU position', () => {
      const cache = new LRUCache<string>({ maxSize: 2 })

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      // Access key1 (moves it to MRU)
      cache.get('key1')

      // Add key3 - should evict key2 (now LRU)
      cache.set('key3', 'value3')

      expect(cache.get('key1')).toBe('value1')
      expect(cache.get('key2')).toBeUndefined()
      expect(cache.get('key3')).toBe('value3')
    })

    it('should move updated items to MRU position', () => {
      const cache = new LRUCache<string>({ maxSize: 2 })

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      // Update key1 (moves it to MRU)
      cache.set('key1', 'updated1')

      // Add key3 - should evict key2 (now LRU)
      cache.set('key3', 'value3')

      expect(cache.get('key1')).toBe('updated1')
      expect(cache.get('key2')).toBeUndefined()
      expect(cache.get('key3')).toBe('value3')
    })

    it('should call onEvict callback when evicting', () => {
      const onEvict = vi.fn()
      const cache = new LRUCache<string>({ maxSize: 2, onEvict })

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')

      expect(onEvict).toHaveBeenCalledTimes(1)
      expect(onEvict).toHaveBeenCalledWith('key1', 'value1')
    })

    it('should handle multiple evictions in a row', () => {
      const onEvict = vi.fn()
      const cache = new LRUCache<string>({ maxSize: 2, onEvict })

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')
      cache.set('key4', 'value4')

      expect(onEvict).toHaveBeenCalledTimes(2)
      expect(onEvict).toHaveBeenNthCalledWith(1, 'key1', 'value1')
      expect(onEvict).toHaveBeenNthCalledWith(2, 'key2', 'value2')
    })
  })

  describe('iteration', () => {
    it('should iterate over entries', () => {
      const cache = new LRUCache<string>()

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      const entries = Array.from(cache.entries())
      expect(entries).toHaveLength(2)
      expect(entries).toContainEqual(['key1', 'value1'])
      expect(entries).toContainEqual(['key2', 'value2'])
    })

    it('should iterate over values', () => {
      const cache = new LRUCache<string>()

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      const values = Array.from(cache.values())
      expect(values).toContain('value1')
      expect(values).toContain('value2')
    })

    it('should iterate over keys', () => {
      const cache = new LRUCache<string>()

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      const keys = Array.from(cache.keys())
      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
    })
  })

  describe('edge cases', () => {
    it('should handle maxSize of 1', () => {
      const cache = new LRUCache<string>({ maxSize: 1 })

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      expect(cache.get('key1')).toBeUndefined()
      expect(cache.get('key2')).toBe('value2')
      expect(cache.size).toBe(1)
    })

    it('should handle empty cache operations', () => {
      const cache = new LRUCache<string>()

      expect(cache.get('anything')).toBeUndefined()
      expect(cache.delete('anything')).toBe(false)
      expect(cache.size).toBe(0)

      cache.clear() // should not throw
      expect(cache.size).toBe(0)
    })

    it('should work with object values', () => {
      const cache = new LRUCache<{ name: string; count: number }>({ maxSize: 2 })

      cache.set('obj1', { name: 'Alice', count: 1 })
      cache.set('obj2', { name: 'Bob', count: 2 })

      expect(cache.get('obj1')).toEqual({ name: 'Alice', count: 1 })
      expect(cache.get('obj2')).toEqual({ name: 'Bob', count: 2 })
    })

    it('should default to maxSize of 1000', () => {
      const cache = new LRUCache<string>()

      // Add 1001 items
      for (let i = 0; i < 1001; i++) {
        cache.set(`key${i}`, `value${i}`)
      }

      // First item should be evicted
      expect(cache.get('key0')).toBeUndefined()
      // Last item should exist
      expect(cache.get('key1000')).toBe('value1000')
      expect(cache.size).toBe(1000)
    })
  })
})
