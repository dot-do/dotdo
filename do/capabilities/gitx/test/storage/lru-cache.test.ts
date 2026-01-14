import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  LRUCache,
  CacheOptions,
  CacheStats,
  CacheEntry,
  SetOptions,
  EvictionReason,
  defaultSizeCalculator,
  createKeySerializer
} from '../../src/storage/lru-cache'

describe('LRUCache', () => {
  describe('cache insertion', () => {
    it('should set and get a value', () => {
      const cache = new LRUCache<string, string>()

      const result = cache.set('key1', 'value1')

      expect(result).toBe(true)
      expect(cache.get('key1')).toBe('value1')
    })

    it('should overwrite existing value', () => {
      const cache = new LRUCache<string, string>()
      cache.set('key1', 'value1')

      cache.set('key1', 'value2')

      expect(cache.get('key1')).toBe('value2')
    })

    it('should return true when setting a value', () => {
      const cache = new LRUCache<string, number>()

      const result = cache.set('count', 42)

      expect(result).toBe(true)
    })

    it('should track size after insertion', () => {
      const cache = new LRUCache<string, string>()

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      expect(cache.size).toBe(2)
    })

    it('should handle different key types', () => {
      const cache = new LRUCache<number, string>()

      cache.set(1, 'one')
      cache.set(2, 'two')

      expect(cache.get(1)).toBe('one')
      expect(cache.get(2)).toBe('two')
    })

    it('should handle complex value types', () => {
      interface GitObject {
        type: string
        data: Uint8Array
        sha: string
      }

      const cache = new LRUCache<string, GitObject>()
      const obj: GitObject = {
        type: 'blob',
        data: new Uint8Array([1, 2, 3]),
        sha: 'abc123'
      }

      cache.set('obj1', obj)

      expect(cache.get('obj1')).toEqual(obj)
    })

    it('should set value with custom TTL', () => {
      const cache = new LRUCache<string, string>()

      const result = cache.set('key1', 'value1', { ttl: 5000 })

      expect(result).toBe(true)
      expect(cache.get('key1')).toBe('value1')
    })

    it('should set value with custom size', () => {
      const cache = new LRUCache<string, string>({ maxBytes: 1000 })

      cache.set('key1', 'value1', { size: 100 })

      expect(cache.bytes).toBeGreaterThanOrEqual(100)
    })
  })

  describe('cache eviction (LRU order)', () => {
    it('should evict least recently used item when maxCount is reached', () => {
      const cache = new LRUCache<string, string>({ maxCount: 3 })

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

    it('should update LRU order on get', () => {
      const cache = new LRUCache<string, string>({ maxCount: 3 })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')
      cache.get('a') // Move 'a' to most recently used
      cache.set('d', '4') // Should evict 'b' (now least recently used)

      expect(cache.get('a')).toBe('1')
      expect(cache.get('b')).toBeUndefined()
      expect(cache.get('c')).toBe('3')
      expect(cache.get('d')).toBe('4')
    })

    it('should update LRU order on set of existing key', () => {
      const cache = new LRUCache<string, string>({ maxCount: 3 })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')
      cache.set('a', 'updated') // Move 'a' to most recently used
      cache.set('d', '4') // Should evict 'b'

      expect(cache.get('a')).toBe('updated')
      expect(cache.get('b')).toBeUndefined()
    })

    it('should evict multiple items if needed for size limit', () => {
      const cache = new LRUCache<string, string>({
        maxBytes: 100,
        sizeCalculator: (v: string) => v.length * 10
      })

      cache.set('a', '12345') // 50 bytes
      cache.set('b', '12345') // 50 bytes - cache full
      cache.set('c', '1234567890') // 100 bytes - should evict both a and b

      expect(cache.get('a')).toBeUndefined()
      expect(cache.get('b')).toBeUndefined()
      expect(cache.get('c')).toBe('1234567890')
    })

    it('should call onEvict callback when item is evicted', () => {
      const evictedItems: Array<{ key: string; value: string; reason: EvictionReason }> = []
      const cache = new LRUCache<string, string>({
        maxCount: 2,
        onEvict: (key, value, reason) => {
          evictedItems.push({ key: key as string, value: value as string, reason })
        }
      })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3') // Evicts 'a'

      expect(evictedItems.length).toBe(1)
      expect(evictedItems[0].key).toBe('a')
      expect(evictedItems[0].value).toBe('1')
      expect(evictedItems[0].reason).toBe('lru')
    })

    it('should not evict items when under limits', () => {
      const cache = new LRUCache<string, string>({ maxCount: 10 })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')

      expect(cache.get('a')).toBe('1')
      expect(cache.get('b')).toBe('2')
      expect(cache.get('c')).toBe('3')
      expect(cache.size).toBe(3)
    })

    it('should maintain correct LRU order after multiple operations', () => {
      const cache = new LRUCache<string, string>({ maxCount: 3 })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')
      cache.get('a')
      cache.get('b')
      cache.set('d', '4') // Evicts 'c' (LRU)

      expect(cache.get('c')).toBeUndefined()
      expect(cache.keys()).toEqual(['d', 'b', 'a'])
    })
  })

  describe('cache hits/misses', () => {
    it('should track cache hits', () => {
      const cache = new LRUCache<string, string>()
      cache.set('key1', 'value1')

      cache.get('key1')
      cache.get('key1')

      const stats = cache.getStats()
      expect(stats.hits).toBe(2)
    })

    it('should track cache misses', () => {
      const cache = new LRUCache<string, string>()

      cache.get('nonexistent1')
      cache.get('nonexistent2')

      const stats = cache.getStats()
      expect(stats.misses).toBe(2)
    })

    it('should calculate hit rate correctly', () => {
      const cache = new LRUCache<string, string>()
      cache.set('key1', 'value1')

      cache.get('key1') // hit
      cache.get('key1') // hit
      cache.get('key1') // hit
      cache.get('missing') // miss

      const stats = cache.getStats()
      expect(stats.hitRate).toBe(75) // 3 hits / 4 total = 75%
    })

    it('should return hitRate of 0 when no gets have been performed', () => {
      const cache = new LRUCache<string, string>()

      const stats = cache.getStats()

      expect(stats.hitRate).toBe(0)
    })

    it('should track evictions in stats', () => {
      const cache = new LRUCache<string, string>({ maxCount: 2 })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3') // eviction
      cache.set('d', '4') // eviction

      const stats = cache.getStats()
      expect(stats.evictions).toBe(2)
    })

    it('should reset stats without clearing data', () => {
      const cache = new LRUCache<string, string>()
      cache.set('key1', 'value1')
      cache.get('key1')
      cache.get('missing')

      cache.resetStats()

      const stats = cache.getStats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      expect(cache.get('key1')).toBe('value1') // Data still there
    })

    it('should return undefined for missing keys', () => {
      const cache = new LRUCache<string, string>()

      const result = cache.get('nonexistent')

      expect(result).toBeUndefined()
    })
  })

  describe('size limits', () => {
    it('should respect maxCount limit', () => {
      const cache = new LRUCache<string, string>({ maxCount: 5 })

      for (let i = 0; i < 10; i++) {
        cache.set(`key${i}`, `value${i}`)
      }

      expect(cache.size).toBe(5)
    })

    it('should respect maxBytes limit', () => {
      const cache = new LRUCache<string, string>({
        maxBytes: 100,
        sizeCalculator: (v: string) => v.length
      })

      // Each value is 10 chars = 10 bytes
      for (let i = 0; i < 20; i++) {
        cache.set(`key${i}`, '0123456789')
      }

      expect(cache.bytes).toBeLessThanOrEqual(100)
    })

    it('should reject items larger than maxBytes', () => {
      const cache = new LRUCache<string, string>({
        maxBytes: 50,
        sizeCalculator: (v: string) => v.length
      })

      const result = cache.set('large', 'x'.repeat(100))

      expect(result).toBe(false)
      expect(cache.get('large')).toBeUndefined()
    })

    it('should use custom sizeCalculator', () => {
      const cache = new LRUCache<string, Uint8Array>({
        maxBytes: 1000,
        sizeCalculator: (v: Uint8Array) => v.byteLength
      })

      const data = new Uint8Array(500)
      cache.set('binary', data)

      expect(cache.bytes).toBe(500)
    })

    it('should track byte size correctly', () => {
      const cache = new LRUCache<string, string>({
        sizeCalculator: (v: string) => v.length * 2 // UTF-16
      })

      cache.set('key1', 'hello') // 10 bytes
      cache.set('key2', 'world') // 10 bytes

      expect(cache.bytes).toBe(20)
    })

    it('should update byte size on delete', () => {
      const cache = new LRUCache<string, string>({
        sizeCalculator: (v: string) => v.length
      })

      cache.set('key1', '12345') // 5 bytes
      cache.set('key2', '12345') // 5 bytes
      cache.delete('key1')

      expect(cache.bytes).toBe(5)
    })

    it('should resize cache with new limits', () => {
      const cache = new LRUCache<string, string>({ maxCount: 10 })

      for (let i = 0; i < 10; i++) {
        cache.set(`key${i}`, `value${i}`)
      }

      cache.resize({ maxCount: 5 })

      expect(cache.size).toBe(5)
    })

    it('should resize cache and evict LRU items', () => {
      const cache = new LRUCache<string, string>({ maxCount: 5 })

      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')
      cache.set('d', '4')
      cache.set('e', '5')

      cache.resize({ maxCount: 2 })

      expect(cache.size).toBe(2)
      // Should keep the 2 most recently used
      expect(cache.get('d')).toBe('4')
      expect(cache.get('e')).toBe('5')
    })
  })

  describe('TTL expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('should expire items after TTL', () => {
      const cache = new LRUCache<string, string>({ defaultTTL: 1000 })
      cache.set('key1', 'value1')

      vi.advanceTimersByTime(1001)

      expect(cache.get('key1')).toBeUndefined()
    })

    it('should not expire items before TTL', () => {
      const cache = new LRUCache<string, string>({ defaultTTL: 1000 })
      cache.set('key1', 'value1')

      vi.advanceTimersByTime(500)

      expect(cache.get('key1')).toBe('value1')
    })

    it('should use per-item TTL over default TTL', () => {
      const cache = new LRUCache<string, string>({ defaultTTL: 1000 })
      cache.set('short', 'value', { ttl: 500 })
      cache.set('long', 'value', { ttl: 2000 })

      vi.advanceTimersByTime(750)

      expect(cache.get('short')).toBeUndefined()
      expect(cache.get('long')).toBe('value')
    })

    it('should handle items with no TTL', () => {
      const cache = new LRUCache<string, string>() // No default TTL
      cache.set('key1', 'value1')

      vi.advanceTimersByTime(100000)

      expect(cache.get('key1')).toBe('value1')
    })

    it('should count expired item as miss', () => {
      const cache = new LRUCache<string, string>({ defaultTTL: 1000 })
      cache.set('key1', 'value1')

      vi.advanceTimersByTime(1001)
      cache.get('key1')

      const stats = cache.getStats()
      expect(stats.misses).toBe(1)
      expect(stats.hits).toBe(0)
    })

    it('should call onEvict with TTL reason when item expires', () => {
      const evictedItems: Array<{ key: string; reason: EvictionReason }> = []
      const cache = new LRUCache<string, string>({
        defaultTTL: 1000,
        onEvict: (key, _value, reason) => {
          evictedItems.push({ key: key as string, reason })
        }
      })
      cache.set('key1', 'value1')

      vi.advanceTimersByTime(1001)
      cache.get('key1') // Triggers expiration

      expect(evictedItems.length).toBe(1)
      expect(evictedItems[0].reason).toBe('ttl')
    })

    it('should prune expired entries', () => {
      const cache = new LRUCache<string, string>({ defaultTTL: 1000 })
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')

      vi.advanceTimersByTime(1001)

      const pruned = cache.prune()

      expect(pruned).toBe(3)
      expect(cache.size).toBe(0)
    })

    it('should only prune expired entries', () => {
      const cache = new LRUCache<string, string>({ defaultTTL: 1000 })
      cache.set('key1', 'value1')

      vi.advanceTimersByTime(500)
      cache.set('key2', 'value2') // This one is newer

      vi.advanceTimersByTime(600) // key1 expired, key2 still valid

      const pruned = cache.prune()

      expect(pruned).toBe(1)
      expect(cache.get('key2')).toBe('value2')
    })

    afterEach(() => {
      vi.useRealTimers()
    })
  })

  describe('has method', () => {
    it('should return true for existing key', () => {
      const cache = new LRUCache<string, string>()
      cache.set('key1', 'value1')

      expect(cache.has('key1')).toBe(true)
    })

    it('should return false for non-existent key', () => {
      const cache = new LRUCache<string, string>()

      expect(cache.has('nonexistent')).toBe(false)
    })

    it('should return false for expired key', () => {
      vi.useFakeTimers()
      const cache = new LRUCache<string, string>({ defaultTTL: 1000 })
      cache.set('key1', 'value1')

      vi.advanceTimersByTime(1001)

      expect(cache.has('key1')).toBe(false)
      vi.useRealTimers()
    })

    it('should NOT update LRU order', () => {
      const cache = new LRUCache<string, string>({ maxCount: 2 })
      cache.set('a', '1')
      cache.set('b', '2')

      cache.has('a') // Should NOT update LRU order
      cache.set('c', '3') // Should evict 'a' since it's still LRU

      expect(cache.get('a')).toBeUndefined()
      expect(cache.get('b')).toBe('2')
    })
  })

  describe('delete method', () => {
    it('should delete existing key', () => {
      const cache = new LRUCache<string, string>()
      cache.set('key1', 'value1')

      const result = cache.delete('key1')

      expect(result).toBe(true)
      expect(cache.get('key1')).toBeUndefined()
    })

    it('should return false for non-existent key', () => {
      const cache = new LRUCache<string, string>()

      const result = cache.delete('nonexistent')

      expect(result).toBe(false)
    })

    it('should update size after delete', () => {
      const cache = new LRUCache<string, string>()
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      cache.delete('key1')

      expect(cache.size).toBe(1)
    })

    it('should call onEvict with manual reason', () => {
      const evictedItems: Array<{ key: string; reason: EvictionReason }> = []
      const cache = new LRUCache<string, string>({
        onEvict: (key, _value, reason) => {
          evictedItems.push({ key: key as string, reason })
        }
      })
      cache.set('key1', 'value1')

      cache.delete('key1')

      expect(evictedItems.length).toBe(1)
      expect(evictedItems[0].reason).toBe('manual')
    })
  })

  describe('clear method', () => {
    it('should remove all entries', () => {
      const cache = new LRUCache<string, string>()
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')

      cache.clear()

      expect(cache.size).toBe(0)
      expect(cache.get('key1')).toBeUndefined()
      expect(cache.get('key2')).toBeUndefined()
      expect(cache.get('key3')).toBeUndefined()
    })

    it('should reset byte size', () => {
      const cache = new LRUCache<string, string>({
        sizeCalculator: (v: string) => v.length
      })
      cache.set('key1', '12345')
      cache.set('key2', '12345')

      cache.clear()

      expect(cache.bytes).toBe(0)
    })

    it('should call onEvict for all entries with clear reason', () => {
      const evictedItems: string[] = []
      const cache = new LRUCache<string, string>({
        onEvict: (key, _value, reason) => {
          if (reason === 'clear') evictedItems.push(key as string)
        }
      })
      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')

      cache.clear()

      expect(evictedItems).toHaveLength(3)
    })
  })

  describe('peek method', () => {
    it('should return value without updating LRU order', () => {
      const cache = new LRUCache<string, string>({ maxCount: 2 })
      cache.set('a', '1')
      cache.set('b', '2')

      const value = cache.peek('a')
      cache.set('c', '3') // Should evict 'a' since peek didn't update order

      expect(value).toBe('1')
      expect(cache.get('a')).toBeUndefined()
    })

    it('should return undefined for non-existent key', () => {
      const cache = new LRUCache<string, string>()

      expect(cache.peek('nonexistent')).toBeUndefined()
    })

    it('should return undefined for expired key', () => {
      vi.useFakeTimers()
      const cache = new LRUCache<string, string>({ defaultTTL: 1000 })
      cache.set('key1', 'value1')

      vi.advanceTimersByTime(1001)

      expect(cache.peek('key1')).toBeUndefined()
      vi.useRealTimers()
    })
  })

  describe('keys, values, entries methods', () => {
    it('should return keys in LRU order (most recent first)', () => {
      const cache = new LRUCache<string, string>()
      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')
      cache.get('a') // 'a' becomes most recent

      expect(cache.keys()).toEqual(['a', 'c', 'b'])
    })

    it('should return values in LRU order', () => {
      const cache = new LRUCache<string, string>()
      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')
      cache.get('a')

      expect(cache.values()).toEqual(['1', '3', '2'])
    })

    it('should return entries in LRU order', () => {
      const cache = new LRUCache<string, string>()
      cache.set('a', '1')
      cache.set('b', '2')
      cache.set('c', '3')
      cache.get('a')

      expect(cache.entries()).toEqual([['a', '1'], ['c', '3'], ['b', '2']])
    })

    it('should return empty arrays for empty cache', () => {
      const cache = new LRUCache<string, string>()

      expect(cache.keys()).toEqual([])
      expect(cache.values()).toEqual([])
      expect(cache.entries()).toEqual([])
    })
  })

  describe('getStats', () => {
    it('should return all statistics', () => {
      const cache = new LRUCache<string, string>({
        maxCount: 2,
        sizeCalculator: (v: string) => v.length
      })
      cache.set('key1', '12345')
      cache.set('key2', '12345')
      cache.get('key1') // hit
      cache.get('missing') // miss
      cache.set('key3', '12345') // eviction

      const stats = cache.getStats()

      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(1)
      expect(stats.count).toBe(2)
      expect(stats.bytes).toBe(10)
      expect(stats.evictions).toBe(1)
      expect(stats.hitRate).toBe(50)
    })

    it('should update count correctly', () => {
      const cache = new LRUCache<string, string>()

      expect(cache.getStats().count).toBe(0)

      cache.set('a', '1')
      expect(cache.getStats().count).toBe(1)

      cache.set('b', '2')
      expect(cache.getStats().count).toBe(2)

      cache.delete('a')
      expect(cache.getStats().count).toBe(1)
    })
  })
})

describe('defaultSizeCalculator', () => {
  it('should calculate size for strings', () => {
    const size = defaultSizeCalculator('hello')
    expect(size).toBeGreaterThan(0)
  })

  it('should calculate size for Uint8Array', () => {
    const data = new Uint8Array(100)
    const size = defaultSizeCalculator(data)
    expect(size).toBe(100)
  })

  it('should calculate size for objects', () => {
    const obj = { key: 'value', nested: { arr: [1, 2, 3] } }
    const size = defaultSizeCalculator(obj)
    expect(size).toBeGreaterThan(0)
  })

  it('should calculate size for ArrayBuffer', () => {
    const buffer = new ArrayBuffer(256)
    const size = defaultSizeCalculator(buffer)
    expect(size).toBe(256)
  })

  it('should handle null and undefined', () => {
    expect(defaultSizeCalculator(null)).toBe(0)
    expect(defaultSizeCalculator(undefined)).toBe(0)
  })

  it('should handle numbers', () => {
    const size = defaultSizeCalculator(12345)
    expect(size).toBeGreaterThan(0)
  })
})

describe('createKeySerializer', () => {
  it('should create serialize/deserialize pair', () => {
    const serializer = createKeySerializer<number>(
      (n) => `num:${n}`,
      (s) => parseInt(s.replace('num:', ''), 10)
    )

    expect(serializer.serialize(42)).toBe('num:42')
    expect(serializer.deserialize('num:42')).toBe(42)
  })

  it('should handle complex key types', () => {
    interface ComplexKey {
      repo: string
      sha: string
    }

    const serializer = createKeySerializer<ComplexKey>(
      (k) => `${k.repo}:${k.sha}`,
      (s) => {
        const [repo, sha] = s.split(':')
        return { repo, sha }
      }
    )

    const key = { repo: 'gitdo', sha: 'abc123' }
    const serialized = serializer.serialize(key)
    const deserialized = serializer.deserialize(serialized)

    expect(deserialized).toEqual(key)
  })
})

describe('LRUCache edge cases', () => {
  it('should handle maxCount of 1', () => {
    const cache = new LRUCache<string, string>({ maxCount: 1 })

    cache.set('a', '1')
    cache.set('b', '2')

    expect(cache.size).toBe(1)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('2')
  })

  it('should handle concurrent-like rapid operations', () => {
    const cache = new LRUCache<number, number>({ maxCount: 100 })

    for (let i = 0; i < 1000; i++) {
      cache.set(i, i * 2)
      if (i % 10 === 0) {
        cache.get(Math.floor(i / 2))
      }
    }

    expect(cache.size).toBe(100)
  })

  it('should work with undefined values', () => {
    const cache = new LRUCache<string, undefined>()

    cache.set('key', undefined)

    expect(cache.has('key')).toBe(true)
    expect(cache.get('key')).toBeUndefined()
  })

  it('should work with null values', () => {
    const cache = new LRUCache<string, null>()

    cache.set('key', null)

    expect(cache.has('key')).toBe(true)
    expect(cache.get('key')).toBeNull()
  })

  it('should handle empty string keys', () => {
    const cache = new LRUCache<string, string>()

    cache.set('', 'empty key value')

    expect(cache.get('')).toBe('empty key value')
  })

  it('should work with both maxCount and maxBytes', () => {
    const cache = new LRUCache<string, string>({
      maxCount: 10,
      maxBytes: 50,
      sizeCalculator: (v: string) => v.length
    })

    // Each value is 10 bytes, so maxBytes (50) is more restrictive
    for (let i = 0; i < 10; i++) {
      cache.set(`key${i}`, '0123456789')
    }

    expect(cache.size).toBeLessThanOrEqual(5)
    expect(cache.bytes).toBeLessThanOrEqual(50)
  })
})
