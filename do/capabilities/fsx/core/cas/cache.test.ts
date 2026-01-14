import { describe, it, expect, beforeEach } from 'vitest'
import { LRUCache, createLRUCache, type CacheStats } from './cache'
import type { GitObject } from './get-object'

/**
 * Helper to create a mock GitObject
 */
function createGitObject(content: string, type: string = 'blob'): GitObject {
  return {
    type,
    content: new TextEncoder().encode(content),
  }
}

/**
 * Helper to create a GitObject with specific byte size
 */
function createSizedObject(size: number, type: string = 'blob'): GitObject {
  return {
    type,
    content: new Uint8Array(size),
  }
}

describe('LRUCache', () => {
  const encoder = new TextEncoder()

  describe('constructor', () => {
    it('should create cache with default options', () => {
      const cache = new LRUCache()
      const stats = cache.getStats()

      expect(stats.maxEntries).toBe(1000)
      expect(stats.maxBytes).toBe(50 * 1024 * 1024) // 50MB
    })

    it('should create cache with custom maxEntries', () => {
      const cache = new LRUCache({ maxEntries: 100 })
      const stats = cache.getStats()

      expect(stats.maxEntries).toBe(100)
    })

    it('should create cache with custom maxBytes', () => {
      const cache = new LRUCache({ maxBytes: 1024 * 1024 })
      const stats = cache.getStats()

      expect(stats.maxBytes).toBe(1024 * 1024)
    })

    it('should create cache with both custom options', () => {
      const cache = new LRUCache({ maxEntries: 50, maxBytes: 1024 })
      const stats = cache.getStats()

      expect(stats.maxEntries).toBe(50)
      expect(stats.maxBytes).toBe(1024)
    })
  })

  describe('get and set', () => {
    let cache: LRUCache

    beforeEach(() => {
      cache = new LRUCache({ maxEntries: 10, maxBytes: 1024 })
    })

    it('should store and retrieve an object', () => {
      const hash = 'a'.repeat(40)
      const obj = createGitObject('hello world')

      cache.set(hash, obj)
      const result = cache.get(hash)

      expect(result).not.toBeUndefined()
      expect(result!.type).toBe('blob')
      expect(result!.content).toEqual(obj.content)
    })

    it('should return undefined for non-existent hash', () => {
      const result = cache.get('b'.repeat(40))

      expect(result).toBeUndefined()
    })

    it('should normalize hash to lowercase', () => {
      const lowerHash = 'abcdef1234567890'.repeat(2) + 'abcdef12'
      const upperHash = lowerHash.toUpperCase()
      const obj = createGitObject('test')

      cache.set(upperHash, obj)
      const result = cache.get(lowerHash)

      expect(result).not.toBeUndefined()
      expect(result!.content).toEqual(obj.content)
    })

    it('should update existing entry on duplicate set', () => {
      const hash = 'c'.repeat(40)
      const obj1 = createGitObject('first')
      const obj2 = createGitObject('second')

      cache.set(hash, obj1)
      cache.set(hash, obj2)

      const result = cache.get(hash)
      expect(new TextDecoder().decode(result!.content)).toBe('second')
      expect(cache.size).toBe(1)
    })

    it('should track bytes correctly on update', () => {
      const hash = 'd'.repeat(40)
      const obj1 = createSizedObject(100)
      const obj2 = createSizedObject(200)

      cache.set(hash, obj1)
      expect(cache.bytes).toBe(100)

      cache.set(hash, obj2)
      expect(cache.bytes).toBe(200)
      expect(cache.size).toBe(1)
    })
  })

  describe('LRU eviction', () => {
    it('should evict oldest entry when maxEntries exceeded', () => {
      const cache = new LRUCache({ maxEntries: 3, maxBytes: 10000 })

      cache.set('a'.repeat(40), createGitObject('first'))
      cache.set('b'.repeat(40), createGitObject('second'))
      cache.set('c'.repeat(40), createGitObject('third'))

      expect(cache.size).toBe(3)

      // This should evict 'first' (oldest)
      cache.set('d'.repeat(40), createGitObject('fourth'))

      expect(cache.size).toBe(3)
      expect(cache.get('a'.repeat(40))).toBeUndefined() // evicted
      expect(cache.get('b'.repeat(40))).not.toBeUndefined()
      expect(cache.get('c'.repeat(40))).not.toBeUndefined()
      expect(cache.get('d'.repeat(40))).not.toBeUndefined()
    })

    it('should update LRU order on get', () => {
      const cache = new LRUCache({ maxEntries: 3, maxBytes: 10000 })

      cache.set('a'.repeat(40), createGitObject('first'))
      cache.set('b'.repeat(40), createGitObject('second'))
      cache.set('c'.repeat(40), createGitObject('third'))

      // Access 'first' - makes it most recently used
      cache.get('a'.repeat(40))

      // Add new entry - should evict 'second' (now oldest)
      cache.set('d'.repeat(40), createGitObject('fourth'))

      expect(cache.get('a'.repeat(40))).not.toBeUndefined() // still present
      expect(cache.get('b'.repeat(40))).toBeUndefined() // evicted
      expect(cache.get('c'.repeat(40))).not.toBeUndefined()
      expect(cache.get('d'.repeat(40))).not.toBeUndefined()
    })

    it('should evict based on maxBytes', () => {
      const cache = new LRUCache({ maxEntries: 100, maxBytes: 250 })

      // Each object is 100 bytes
      cache.set('a'.repeat(40), createSizedObject(100))
      cache.set('b'.repeat(40), createSizedObject(100))

      expect(cache.size).toBe(2)
      expect(cache.bytes).toBe(200)

      // This 100-byte object would exceed 250 bytes limit
      // Should evict 'a' (oldest) to make room
      cache.set('c'.repeat(40), createSizedObject(100))

      expect(cache.size).toBe(2)
      expect(cache.bytes).toBe(200)
      expect(cache.get('a'.repeat(40))).toBeUndefined() // evicted
      expect(cache.get('b'.repeat(40))).not.toBeUndefined()
      expect(cache.get('c'.repeat(40))).not.toBeUndefined()
    })

    it('should not cache objects larger than maxBytes', () => {
      const cache = new LRUCache({ maxEntries: 10, maxBytes: 100 })

      cache.set('a'.repeat(40), createSizedObject(150)) // too large

      expect(cache.size).toBe(0)
      expect(cache.bytes).toBe(0)
    })

    it('should track evictions in stats', () => {
      const cache = new LRUCache({ maxEntries: 2, maxBytes: 10000 })

      cache.set('a'.repeat(40), createGitObject('first'))
      cache.set('b'.repeat(40), createGitObject('second'))
      cache.set('c'.repeat(40), createGitObject('third')) // evicts 'a'
      cache.set('d'.repeat(40), createGitObject('fourth')) // evicts 'b'

      const stats = cache.getStats()
      expect(stats.evictions).toBe(2)
    })
  })

  describe('has', () => {
    it('should return true for existing entry', () => {
      const cache = new LRUCache()
      const hash = 'a'.repeat(40)

      cache.set(hash, createGitObject('test'))

      expect(cache.has(hash)).toBe(true)
    })

    it('should return false for non-existing entry', () => {
      const cache = new LRUCache()

      expect(cache.has('a'.repeat(40))).toBe(false)
    })

    it('should not affect LRU order', () => {
      const cache = new LRUCache({ maxEntries: 2, maxBytes: 10000 })

      cache.set('a'.repeat(40), createGitObject('first'))
      cache.set('b'.repeat(40), createGitObject('second'))

      // has() should not update LRU order
      cache.has('a'.repeat(40))

      // Adding new entry should still evict 'a' (oldest)
      cache.set('c'.repeat(40), createGitObject('third'))

      expect(cache.has('a'.repeat(40))).toBe(false) // evicted
      expect(cache.has('b'.repeat(40))).toBe(true)
    })
  })

  describe('delete', () => {
    it('should remove entry from cache', () => {
      const cache = new LRUCache()
      const hash = 'a'.repeat(40)

      cache.set(hash, createGitObject('test'))
      expect(cache.has(hash)).toBe(true)

      const deleted = cache.delete(hash)

      expect(deleted).toBe(true)
      expect(cache.has(hash)).toBe(false)
    })

    it('should return false for non-existing entry', () => {
      const cache = new LRUCache()

      const deleted = cache.delete('a'.repeat(40))

      expect(deleted).toBe(false)
    })

    it('should update byte count on delete', () => {
      const cache = new LRUCache()
      const hash = 'a'.repeat(40)

      cache.set(hash, createSizedObject(100))
      expect(cache.bytes).toBe(100)

      cache.delete(hash)
      expect(cache.bytes).toBe(0)
    })
  })

  describe('clear', () => {
    it('should remove all entries', () => {
      const cache = new LRUCache()

      cache.set('a'.repeat(40), createGitObject('first'))
      cache.set('b'.repeat(40), createGitObject('second'))
      cache.set('c'.repeat(40), createGitObject('third'))

      cache.clear()

      expect(cache.size).toBe(0)
      expect(cache.bytes).toBe(0)
    })

    it('should not reset statistics', () => {
      const cache = new LRUCache()
      const hash = 'a'.repeat(40)

      cache.set(hash, createGitObject('test'))
      cache.get(hash) // hit
      cache.get('b'.repeat(40)) // miss

      cache.clear()

      const stats = cache.getStats()
      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(1)
    })
  })

  describe('statistics', () => {
    let cache: LRUCache

    beforeEach(() => {
      cache = new LRUCache({ maxEntries: 10, maxBytes: 1024 })
    })

    it('should track cache hits', () => {
      const hash = 'a'.repeat(40)
      cache.set(hash, createGitObject('test'))

      cache.get(hash)
      cache.get(hash)
      cache.get(hash)

      const stats = cache.getStats()
      expect(stats.hits).toBe(3)
    })

    it('should track cache misses', () => {
      cache.get('a'.repeat(40))
      cache.get('b'.repeat(40))

      const stats = cache.getStats()
      expect(stats.misses).toBe(2)
    })

    it('should calculate hit ratio correctly', () => {
      const hash = 'a'.repeat(40)
      cache.set(hash, createGitObject('test'))

      cache.get(hash) // hit
      cache.get(hash) // hit
      cache.get('b'.repeat(40)) // miss
      cache.get('c'.repeat(40)) // miss

      const stats = cache.getStats()
      expect(stats.hitRatio).toBe(0.5) // 2 hits / 4 total
    })

    it('should return 0 hit ratio when no requests', () => {
      const stats = cache.getStats()
      expect(stats.hitRatio).toBe(0)
    })

    it('should track entry count and bytes', () => {
      cache.set('a'.repeat(40), createSizedObject(100))
      cache.set('b'.repeat(40), createSizedObject(200))

      const stats = cache.getStats()
      expect(stats.entryCount).toBe(2)
      expect(stats.totalBytes).toBe(300)
    })

    it('should reset statistics', () => {
      const hash = 'a'.repeat(40)
      cache.set(hash, createGitObject('test'))
      cache.get(hash)
      cache.get('b'.repeat(40))

      cache.resetStats()

      const stats = cache.getStats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      expect(stats.evictions).toBe(0)
      // But cache contents remain
      expect(stats.entryCount).toBe(1)
    })
  })

  describe('edge cases', () => {
    it('should handle empty content objects', () => {
      const cache = new LRUCache()
      const hash = 'a'.repeat(40)
      const obj: GitObject = { type: 'blob', content: new Uint8Array(0) }

      cache.set(hash, obj)
      const result = cache.get(hash)

      expect(result).not.toBeUndefined()
      expect(result!.content.length).toBe(0)
    })

    it('should handle all object types', () => {
      const cache = new LRUCache()
      const types = ['blob', 'tree', 'commit', 'tag']

      types.forEach((type, i) => {
        const hash = String(i).repeat(40)
        cache.set(hash, createGitObject('content', type))
      })

      types.forEach((type, i) => {
        const hash = String(i).repeat(40)
        const result = cache.get(hash)
        expect(result!.type).toBe(type)
      })
    })

    it('should handle mixed case hashes consistently', () => {
      const cache = new LRUCache()
      const lowerHash = 'abcdef0123456789'.repeat(2) + 'abcdef01'
      const upperHash = lowerHash.toUpperCase()
      const mixedHash = 'AbCdEf0123456789'.repeat(2) + 'AbCdEf01'

      cache.set(lowerHash, createGitObject('test'))

      expect(cache.get(upperHash)).not.toBeUndefined()
      expect(cache.get(mixedHash)).not.toBeUndefined()
      expect(cache.size).toBe(1)
    })

    it('should handle rapid access patterns', () => {
      const cache = new LRUCache({ maxEntries: 3, maxBytes: 10000 })
      const hashes = ['a', 'b', 'c', 'd', 'e'].map(c => c.repeat(40))

      // Fill cache
      hashes.slice(0, 3).forEach(h => cache.set(h, createGitObject('test')))

      // Rapid access pattern
      for (let i = 0; i < 100; i++) {
        const idx = i % 3
        cache.get(hashes[idx])
      }

      expect(cache.size).toBe(3)
    })
  })

  describe('createLRUCache factory', () => {
    it('should create cache with default options', () => {
      const cache = createLRUCache()
      const stats = cache.getStats()

      expect(stats.maxEntries).toBe(1000)
      expect(stats.maxBytes).toBe(50 * 1024 * 1024)
    })

    it('should create cache with custom options', () => {
      const cache = createLRUCache({ maxEntries: 100, maxBytes: 1024 })
      const stats = cache.getStats()

      expect(stats.maxEntries).toBe(100)
      expect(stats.maxBytes).toBe(1024)
    })
  })
})
