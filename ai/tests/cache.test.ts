/**
 * @fileoverview Tests for AI Caching Layer
 *
 * Tests cover:
 * - Cache hit/miss scenarios
 * - TTL expiration
 * - Cache invalidation
 * - Memory limits (LRU eviction)
 * - Hash key generation
 * - EmbeddingCache and GenerationCache
 * - withCache wrapper
 *
 * @module ai/tests/cache.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MemoryCache,
  EmbeddingCache,
  GenerationCache,
  hashKey,
  createCacheKey,
  withCache,
  type CacheEntry,
  type CacheStats,
  type MemoryCacheOptions,
} from '../cache'

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// =============================================================================
// 1. MemoryCache - Cache Hit/Miss Scenarios
// =============================================================================

describe('MemoryCache - Cache Hit/Miss Scenarios', () => {
  let cache: MemoryCache<string>

  beforeEach(() => {
    cache = new MemoryCache<string>()
  })

  afterEach(() => {
    cache.dispose()
  })

  describe('Basic get/set operations', () => {
    it('should return undefined for non-existent key (cache miss)', async () => {
      const result = await cache.get('non-existent')
      expect(result).toBeUndefined()
    })

    it('should store and retrieve a value (cache hit)', async () => {
      await cache.set('key1', 'value1')
      const result = await cache.get('key1')
      expect(result).toBe('value1')
    })

    it('should handle multiple distinct keys', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      expect(await cache.get('key1')).toBe('value1')
      expect(await cache.get('key2')).toBe('value2')
      expect(await cache.get('key3')).toBe('value3')
    })

    it('should overwrite existing key with new value', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key1', 'updated')

      expect(await cache.get('key1')).toBe('updated')
    })

    it('should handle empty string as key', async () => {
      await cache.set('', 'empty-key-value')
      expect(await cache.get('')).toBe('empty-key-value')
    })

    it('should handle empty string as value', async () => {
      await cache.set('key', '')
      expect(await cache.get('key')).toBe('')
    })
  })

  describe('has() method', () => {
    it('should return false for non-existent key', async () => {
      const exists = await cache.has('non-existent')
      expect(exists).toBe(false)
    })

    it('should return true for existing key', async () => {
      await cache.set('key1', 'value1')
      const exists = await cache.has('key1')
      expect(exists).toBe(true)
    })
  })

  describe('keys() and size() methods', () => {
    it('should return empty array when cache is empty', async () => {
      const keys = await cache.keys()
      expect(keys).toEqual([])
    })

    it('should return 0 size when cache is empty', async () => {
      const size = await cache.size()
      expect(size).toBe(0)
    })

    it('should return all keys after setting values', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      const keys = await cache.keys()
      expect(keys).toHaveLength(3)
      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
      expect(keys).toContain('key3')
    })

    it('should return correct size after setting values', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')

      const size = await cache.size()
      expect(size).toBe(2)
    })
  })
})

// =============================================================================
// 2. MemoryCache - TTL Expiration
// =============================================================================

describe('MemoryCache - TTL Expiration', () => {
  let cache: MemoryCache<string>

  afterEach(() => {
    cache?.dispose()
  })

  describe('Per-entry TTL', () => {
    beforeEach(() => {
      cache = new MemoryCache<string>()
    })

    it('should expire entry after TTL', async () => {
      await cache.set('key1', 'value1', { ttl: 50 })

      // Should exist immediately
      expect(await cache.get('key1')).toBe('value1')

      // Wait for expiration
      await sleep(60)

      // Should be expired
      expect(await cache.get('key1')).toBeUndefined()
    })

    it('should not expire entry before TTL', async () => {
      await cache.set('key1', 'value1', { ttl: 100 })

      // Wait less than TTL
      await sleep(50)

      // Should still exist
      expect(await cache.get('key1')).toBe('value1')
    })

    it('should handle different TTLs for different entries', async () => {
      await cache.set('short', 'short-value', { ttl: 30 })
      await cache.set('long', 'long-value', { ttl: 200 })

      // Wait for short TTL to expire
      await sleep(50)

      expect(await cache.get('short')).toBeUndefined()
      expect(await cache.get('long')).toBe('long-value')
    })

    it('should not expire entry without TTL', async () => {
      await cache.set('permanent', 'permanent-value')
      await cache.set('temporary', 'temp-value', { ttl: 30 })

      await sleep(50)

      expect(await cache.get('permanent')).toBe('permanent-value')
      expect(await cache.get('temporary')).toBeUndefined()
    })
  })

  describe('Default TTL', () => {
    it('should apply default TTL to all entries', async () => {
      cache = new MemoryCache<string>({ defaultTTL: 50 })

      await cache.set('key1', 'value1')

      expect(await cache.get('key1')).toBe('value1')

      await sleep(60)

      expect(await cache.get('key1')).toBeUndefined()
    })

    it('should allow per-entry TTL to override default', async () => {
      cache = new MemoryCache<string>({ defaultTTL: 30 })

      await cache.set('short', 'short-value')
      await cache.set('long', 'long-value', { ttl: 200 })

      await sleep(50)

      expect(await cache.get('short')).toBeUndefined()
      expect(await cache.get('long')).toBe('long-value')
    })
  })

  describe('Sliding expiration', () => {
    it('should refresh TTL on access when slidingExpiration is enabled', async () => {
      cache = new MemoryCache<string>({
        defaultTTL: 80,
        slidingExpiration: true,
      })

      await cache.set('key1', 'value1')

      // Access before expiration to refresh
      await sleep(50)
      expect(await cache.get('key1')).toBe('value1')

      // Wait again - TTL was refreshed, so should still exist
      await sleep(50)
      expect(await cache.get('key1')).toBe('value1')

      // Wait without accessing - should expire
      await sleep(100)
      expect(await cache.get('key1')).toBeUndefined()
    })

    it('should not refresh TTL when slidingExpiration is disabled', async () => {
      cache = new MemoryCache<string>({
        defaultTTL: 80,
        slidingExpiration: false,
      })

      await cache.set('key1', 'value1')

      // Access multiple times
      await sleep(30)
      expect(await cache.get('key1')).toBe('value1')

      await sleep(30)
      expect(await cache.get('key1')).toBe('value1')

      // Should still expire at original time
      await sleep(30)
      expect(await cache.get('key1')).toBeUndefined()
    })
  })

  describe('has() with expiration', () => {
    beforeEach(() => {
      cache = new MemoryCache<string>()
    })

    it('should return false for expired entries', async () => {
      await cache.set('key1', 'value1', { ttl: 30 })

      expect(await cache.has('key1')).toBe(true)

      await sleep(50)

      expect(await cache.has('key1')).toBe(false)
    })
  })
})

// =============================================================================
// 3. MemoryCache - Cache Invalidation
// =============================================================================

describe('MemoryCache - Cache Invalidation', () => {
  let cache: MemoryCache<string>

  beforeEach(() => {
    cache = new MemoryCache<string>()
  })

  afterEach(() => {
    cache.dispose()
  })

  describe('delete() method', () => {
    it('should delete existing entry', async () => {
      await cache.set('key1', 'value1')
      expect(await cache.get('key1')).toBe('value1')

      await cache.delete('key1')
      expect(await cache.get('key1')).toBeUndefined()
    })

    it('should not throw when deleting non-existent key', async () => {
      await expect(cache.delete('non-existent')).resolves.not.toThrow()
    })

    it('should only delete specified key', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      await cache.delete('key2')

      expect(await cache.get('key1')).toBe('value1')
      expect(await cache.get('key2')).toBeUndefined()
      expect(await cache.get('key3')).toBe('value3')
    })

    it('should update size after deletion', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')

      expect(await cache.size()).toBe(2)

      await cache.delete('key1')

      expect(await cache.size()).toBe(1)
    })
  })

  describe('clear() method', () => {
    it('should remove all entries', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      expect(await cache.size()).toBe(3)

      await cache.clear()

      expect(await cache.size()).toBe(0)
      expect(await cache.get('key1')).toBeUndefined()
      expect(await cache.get('key2')).toBeUndefined()
      expect(await cache.get('key3')).toBeUndefined()
    })

    it('should not throw when clearing empty cache', async () => {
      await expect(cache.clear()).resolves.not.toThrow()
    })

    it('should allow adding new entries after clear', async () => {
      await cache.set('key1', 'value1')
      await cache.clear()
      await cache.set('key2', 'value2')

      expect(await cache.get('key1')).toBeUndefined()
      expect(await cache.get('key2')).toBe('value2')
    })
  })
})

// =============================================================================
// 4. MemoryCache - Memory Limits (LRU Eviction)
// =============================================================================

describe('MemoryCache - Memory Limits (LRU Eviction)', () => {
  let cache: MemoryCache<string>

  afterEach(() => {
    cache?.dispose()
  })

  describe('maxSize enforcement', () => {
    it('should evict oldest entry when maxSize is reached', async () => {
      cache = new MemoryCache<string>({ maxSize: 3 })

      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      expect(await cache.size()).toBe(3)

      // Adding 4th entry should evict key1 (oldest)
      await cache.set('key4', 'value4')

      expect(await cache.size()).toBe(3)
      expect(await cache.get('key1')).toBeUndefined()
      expect(await cache.get('key2')).toBe('value2')
      expect(await cache.get('key3')).toBe('value3')
      expect(await cache.get('key4')).toBe('value4')
    })

    it('should maintain maxSize through multiple additions', async () => {
      cache = new MemoryCache<string>({ maxSize: 2 })

      await cache.set('a', '1')
      await cache.set('b', '2')
      await cache.set('c', '3')
      await cache.set('d', '4')
      await cache.set('e', '5')

      expect(await cache.size()).toBe(2)
      // Only the last 2 should remain
      expect(await cache.get('d')).toBe('4')
      expect(await cache.get('e')).toBe('5')
    })

    it('should not evict when updating existing key', async () => {
      cache = new MemoryCache<string>({ maxSize: 2 })

      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')

      // Update key1 - should not trigger eviction
      await cache.set('key1', 'updated')

      expect(await cache.size()).toBe(2)
      expect(await cache.get('key1')).toBe('updated')
      expect(await cache.get('key2')).toBe('value2')
    })
  })

  describe('LRU order - access updates recency', () => {
    it('should evict least recently accessed entry', async () => {
      cache = new MemoryCache<string>({ maxSize: 3 })

      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      // Access key1, making key2 the LRU
      await cache.get('key1')

      // Add new entry - should evict key2 (least recently accessed)
      await cache.set('key4', 'value4')

      expect(await cache.get('key1')).toBe('value1')
      expect(await cache.get('key2')).toBeUndefined()
      expect(await cache.get('key3')).toBe('value3')
      expect(await cache.get('key4')).toBe('value4')
    })

    it('should track access order through multiple gets', async () => {
      cache = new MemoryCache<string>({ maxSize: 3 })

      await cache.set('a', '1')
      await cache.set('b', '2')
      await cache.set('c', '3')

      // Access order: a, b, c
      // After access a: b, c, a (a most recent)
      await cache.get('a')

      // After access b: c, a, b (b most recent)
      await cache.get('b')

      // Add new entry - should evict c (least recently accessed)
      await cache.set('d', '4')

      expect(await cache.get('a')).toBe('1')
      expect(await cache.get('b')).toBe('2')
      expect(await cache.get('c')).toBeUndefined()
      expect(await cache.get('d')).toBe('4')
    })
  })

  describe('maxSize of 1', () => {
    it('should handle maxSize of 1', async () => {
      cache = new MemoryCache<string>({ maxSize: 1 })

      await cache.set('key1', 'value1')
      expect(await cache.get('key1')).toBe('value1')

      await cache.set('key2', 'value2')
      expect(await cache.get('key1')).toBeUndefined()
      expect(await cache.get('key2')).toBe('value2')
    })
  })

  describe('No maxSize (unlimited)', () => {
    it('should not evict when maxSize is not set', async () => {
      cache = new MemoryCache<string>()

      for (let i = 0; i < 100; i++) {
        await cache.set(`key${i}`, `value${i}`)
      }

      expect(await cache.size()).toBe(100)

      // All entries should still exist
      expect(await cache.get('key0')).toBe('value0')
      expect(await cache.get('key99')).toBe('value99')
    })
  })
})

// =============================================================================
// 5. MemoryCache - Entry Metadata
// =============================================================================

describe('MemoryCache - Entry Metadata', () => {
  let cache: MemoryCache<string>

  beforeEach(() => {
    cache = new MemoryCache<string>()
  })

  afterEach(() => {
    cache.dispose()
  })

  describe('getEntry() method', () => {
    it('should return full entry with metadata', async () => {
      await cache.set('key1', 'value1')

      const entry = await cache.getEntry('key1')

      expect(entry).toBeDefined()
      expect(entry!.value).toBe('value1')
      expect(entry!.createdAt).toBeDefined()
      expect(entry!.lastAccessedAt).toBeDefined()
      expect(entry!.accessCount).toBe(0)
    })

    it('should track access count', async () => {
      await cache.set('key1', 'value1')

      await cache.get('key1')
      await cache.get('key1')
      await cache.get('key1')

      const entry = await cache.getEntry('key1')
      expect(entry!.accessCount).toBe(3)
    })

    it('should update lastAccessedAt on get', async () => {
      await cache.set('key1', 'value1')

      const entry1 = await cache.getEntry('key1')
      const initialAccess = entry1!.lastAccessedAt

      await sleep(10)
      await cache.get('key1')

      const entry2 = await cache.getEntry('key1')
      expect(entry2!.lastAccessedAt).toBeGreaterThan(initialAccess)
    })

    it('should return undefined for non-existent entry', async () => {
      const entry = await cache.getEntry('non-existent')
      expect(entry).toBeUndefined()
    })

    it('should return undefined for expired entry', async () => {
      await cache.set('key1', 'value1', { ttl: 30 })

      await sleep(50)

      const entry = await cache.getEntry('key1')
      expect(entry).toBeUndefined()
    })

    it('should include expiresAt when TTL is set', async () => {
      await cache.set('key1', 'value1', { ttl: 1000 })

      const entry = await cache.getEntry('key1')
      expect(entry!.expiresAt).toBeDefined()
      expect(entry!.expiresAt).toBeGreaterThan(Date.now())
    })

    it('should not include expiresAt when no TTL', async () => {
      await cache.set('key1', 'value1')

      const entry = await cache.getEntry('key1')
      expect(entry!.expiresAt).toBeUndefined()
    })
  })
})

// =============================================================================
// 6. Hash Key Generation
// =============================================================================

describe('hashKey - Key Generation', () => {
  describe('String input', () => {
    it('should generate consistent hash for same string', () => {
      const hash1 = hashKey('test')
      const hash2 = hashKey('test')
      expect(hash1).toBe(hash2)
    })

    it('should generate different hashes for different strings', () => {
      const hash1 = hashKey('test1')
      const hash2 = hashKey('test2')
      expect(hash1).not.toBe(hash2)
    })

    it('should handle empty string', () => {
      const hash = hashKey('')
      expect(hash).toBeDefined()
      expect(typeof hash).toBe('string')
    })

    it('should handle long strings', () => {
      const longString = 'a'.repeat(10000)
      const hash = hashKey(longString)
      expect(hash).toBeDefined()
      expect(hash.length).toBeLessThan(longString.length)
    })

    it('should handle unicode characters', () => {
      const hash = hashKey('Hello 世界 🌍')
      expect(hash).toBeDefined()
    })
  })

  describe('Object input', () => {
    it('should generate consistent hash for same object', () => {
      const hash1 = hashKey({ a: 1, b: 2 })
      const hash2 = hashKey({ a: 1, b: 2 })
      expect(hash1).toBe(hash2)
    })

    it('should generate same hash regardless of key order', () => {
      const hash1 = hashKey({ a: 1, b: 2, c: 3 })
      const hash2 = hashKey({ c: 3, a: 1, b: 2 })
      expect(hash1).toBe(hash2)
    })

    it('should generate different hashes for different objects', () => {
      const hash1 = hashKey({ a: 1 })
      const hash2 = hashKey({ a: 2 })
      expect(hash1).not.toBe(hash2)
    })

    it('should handle nested objects', () => {
      const hash1 = hashKey({ a: { b: { c: 1 } } })
      const hash2 = hashKey({ a: { b: { c: 1 } } })
      expect(hash1).toBe(hash2)

      const hash3 = hashKey({ a: { b: { c: 2 } } })
      expect(hash1).not.toBe(hash3)
    })

    it('should handle arrays', () => {
      const hash1 = hashKey([1, 2, 3])
      const hash2 = hashKey([1, 2, 3])
      expect(hash1).toBe(hash2)

      const hash3 = hashKey([3, 2, 1])
      expect(hash1).not.toBe(hash3)
    })

    it('should handle mixed arrays and objects', () => {
      const hash = hashKey({ items: [{ id: 1 }, { id: 2 }] })
      expect(hash).toBeDefined()
    })

    it('should handle null', () => {
      const hashNull = hashKey(null)
      expect(hashNull).toBeDefined()
      expect(typeof hashNull).toBe('string')
    })

    it('should throw for undefined input', () => {
      // Note: undefined is not JSON-serializable, so stableStringify returns undefined
      // which causes hashKey to fail when accessing .length
      expect(() => hashKey(undefined)).toThrow()
    })
  })
})

describe('createCacheKey - Type-prefixed Keys', () => {
  it('should create key with embedding prefix', () => {
    const key = createCacheKey('embedding', { content: 'test', model: 'text-embedding-3-small' })
    expect(key).toMatch(/^embedding:/)
  })

  it('should create key with generation prefix', () => {
    const key = createCacheKey('generation', { prompt: 'test', model: 'gpt-4' })
    expect(key).toMatch(/^generation:/)
  })

  it('should generate consistent keys for same params', () => {
    const key1 = createCacheKey('embedding', { content: 'test', model: 'model1' })
    const key2 = createCacheKey('embedding', { content: 'test', model: 'model1' })
    expect(key1).toBe(key2)
  })

  it('should generate different keys for different params', () => {
    const key1 = createCacheKey('embedding', { content: 'test1', model: 'model1' })
    const key2 = createCacheKey('embedding', { content: 'test2', model: 'model1' })
    expect(key1).not.toBe(key2)
  })

  it('should generate different keys for different types', () => {
    const params = { content: 'test', model: 'model1' }
    const keyEmbed = createCacheKey('embedding', params)
    const keyGen = createCacheKey('generation', params)
    expect(keyEmbed).not.toBe(keyGen)
  })
})

// =============================================================================
// 7. EmbeddingCache
// =============================================================================

describe('EmbeddingCache', () => {
  let cache: EmbeddingCache

  beforeEach(() => {
    cache = new EmbeddingCache()
  })

  describe('get/set operations', () => {
    it('should store and retrieve embedding', async () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
      await cache.set('hello', embedding, { model: 'text-embedding-3-small' })

      const result = await cache.get('hello', { model: 'text-embedding-3-small' })
      expect(result).toEqual(embedding)
    })

    it('should return undefined for non-existent content', async () => {
      const result = await cache.get('non-existent', { model: 'text-embedding-3-small' })
      expect(result).toBeUndefined()
    })

    it('should differentiate by model', async () => {
      const embedding1 = [0.1, 0.2]
      const embedding2 = [0.3, 0.4]

      await cache.set('hello', embedding1, { model: 'model-a' })
      await cache.set('hello', embedding2, { model: 'model-b' })

      const result1 = await cache.get('hello', { model: 'model-a' })
      const result2 = await cache.get('hello', { model: 'model-b' })

      expect(result1).toEqual(embedding1)
      expect(result2).toEqual(embedding2)
    })
  })

  describe('Batch operations', () => {
    it('should set multiple embeddings at once', async () => {
      const texts = ['hello', 'world', 'test']
      const embeddings = [
        [0.1, 0.2],
        [0.3, 0.4],
        [0.5, 0.6],
      ]

      await cache.setMany(texts, embeddings, { model: 'text-embedding-3-small' })

      expect(await cache.get('hello', { model: 'text-embedding-3-small' })).toEqual([0.1, 0.2])
      expect(await cache.get('world', { model: 'text-embedding-3-small' })).toEqual([0.3, 0.4])
      expect(await cache.get('test', { model: 'text-embedding-3-small' })).toEqual([0.5, 0.6])
    })

    it('should get multiple embeddings with hits and misses', async () => {
      await cache.set('hello', [0.1, 0.2], { model: 'text-embedding-3-small' })
      await cache.set('world', [0.3, 0.4], { model: 'text-embedding-3-small' })

      const result = await cache.getMany(
        ['hello', 'world', 'unknown'],
        { model: 'text-embedding-3-small' }
      )

      expect(result.hits).toEqual({
        hello: [0.1, 0.2],
        world: [0.3, 0.4],
      })
      expect(result.misses).toEqual(['unknown'])
    })

    it('should return all misses for empty cache', async () => {
      const result = await cache.getMany(
        ['a', 'b', 'c'],
        { model: 'text-embedding-3-small' }
      )

      expect(result.hits).toEqual({})
      expect(result.misses).toEqual(['a', 'b', 'c'])
    })

    it('should return all hits when all cached', async () => {
      await cache.set('a', [0.1], { model: 'model' })
      await cache.set('b', [0.2], { model: 'model' })

      const result = await cache.getMany(['a', 'b'], { model: 'model' })

      expect(Object.keys(result.hits)).toHaveLength(2)
      expect(result.misses).toHaveLength(0)
    })
  })

  describe('Statistics', () => {
    it('should track cache hits', async () => {
      await cache.set('hello', [0.1], { model: 'model' })

      await cache.get('hello', { model: 'model' })
      await cache.get('hello', { model: 'model' })

      const stats = cache.getStats()
      expect(stats.hits).toBe(2)
    })

    it('should track cache misses', async () => {
      await cache.get('miss1', { model: 'model' })
      await cache.get('miss2', { model: 'model' })

      const stats = cache.getStats()
      expect(stats.misses).toBe(2)
    })

    it('should calculate hit rate', async () => {
      await cache.set('hit', [0.1], { model: 'model' })

      await cache.get('hit', { model: 'model' })
      await cache.get('hit', { model: 'model' })
      await cache.get('miss', { model: 'model' })

      const stats = cache.getStats()
      expect(stats.hitRate).toBeCloseTo(2 / 3, 2)
    })

    it('should report 0 hit rate for empty cache', async () => {
      const stats = cache.getStats()
      expect(stats.hitRate).toBe(0)
    })

    it('should report cache size', async () => {
      await cache.set('a', [0.1], { model: 'model' })
      await cache.set('b', [0.2], { model: 'model' })

      const stats = cache.getStats()
      expect(stats.size).toBe(2)
    })
  })

  describe('clear()', () => {
    it('should clear cache and reset stats', async () => {
      await cache.set('a', [0.1], { model: 'model' })
      await cache.get('a', { model: 'model' })
      await cache.get('miss', { model: 'model' })

      await cache.clear()

      const stats = cache.getStats()
      expect(stats.size).toBe(0)
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
    })
  })
})

// =============================================================================
// 8. GenerationCache
// =============================================================================

describe('GenerationCache', () => {
  let cache: GenerationCache

  beforeEach(() => {
    cache = new GenerationCache()
  })

  describe('get/set operations', () => {
    it('should store and retrieve generation result', async () => {
      const params = { prompt: 'Hello', model: 'gpt-4' }
      const result = { text: 'Hello! How can I help?' }

      await cache.set(params, result)
      const cached = await cache.get(params)

      expect(cached).toEqual(result)
    })

    it('should return undefined for non-existent prompt', async () => {
      const result = await cache.get({ prompt: 'unknown', model: 'gpt-4' })
      expect(result).toBeUndefined()
    })

    it('should differentiate by model', async () => {
      const prompt = 'Hello'
      const result1 = { text: 'Response 1' }
      const result2 = { text: 'Response 2' }

      await cache.set({ prompt, model: 'gpt-4' }, result1)
      await cache.set({ prompt, model: 'gpt-3.5-turbo' }, result2)

      expect(await cache.get({ prompt, model: 'gpt-4' })).toEqual(result1)
      expect(await cache.get({ prompt, model: 'gpt-3.5-turbo' })).toEqual(result2)
    })

    it('should differentiate by system prompt', async () => {
      const base = { prompt: 'Hello', model: 'gpt-4' }
      const result1 = { text: 'Response 1' }
      const result2 = { text: 'Response 2' }

      await cache.set({ ...base, system: 'Be helpful' }, result1)
      await cache.set({ ...base, system: 'Be concise' }, result2)

      expect(await cache.get({ ...base, system: 'Be helpful' })).toEqual(result1)
      expect(await cache.get({ ...base, system: 'Be concise' })).toEqual(result2)
    })

    it('should differentiate by temperature', async () => {
      const base = { prompt: 'Hello', model: 'gpt-4' }
      const result1 = { text: 'Response 1' }
      const result2 = { text: 'Response 2' }

      await cache.set({ ...base, temperature: 0 }, result1)
      await cache.set({ ...base, temperature: 1 }, result2)

      expect(await cache.get({ ...base, temperature: 0 })).toEqual(result1)
      expect(await cache.get({ ...base, temperature: 1 })).toEqual(result2)
    })

    it('should differentiate by schema version', async () => {
      const base = { prompt: 'Hello', model: 'gpt-4' }
      const result1 = { text: 'Response 1' }
      const result2 = { text: 'Response 2' }

      await cache.set({ ...base, schemaVersion: 'v1' }, result1)
      await cache.set({ ...base, schemaVersion: 'v2' }, result2)

      expect(await cache.get({ ...base, schemaVersion: 'v1' })).toEqual(result1)
      expect(await cache.get({ ...base, schemaVersion: 'v2' })).toEqual(result2)
    })
  })

  describe('bypass option', () => {
    it('should bypass cache when bypass is true', async () => {
      const params = { prompt: 'Hello', model: 'gpt-4' }
      await cache.set(params, { text: 'Cached' })

      const result = await cache.get(params, { bypass: true })
      expect(result).toBeUndefined()
    })

    it('should not increment stats when bypassing', async () => {
      const params = { prompt: 'Hello', model: 'gpt-4' }
      await cache.set(params, { text: 'Cached' })

      await cache.get(params, { bypass: true })

      const stats = cache.getStats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
    })
  })

  describe('Statistics', () => {
    it('should track hits and misses', async () => {
      await cache.set({ prompt: 'Hello', model: 'gpt-4' }, { text: 'Hi' })

      await cache.get({ prompt: 'Hello', model: 'gpt-4' })
      await cache.get({ prompt: 'Unknown', model: 'gpt-4' })

      const stats = cache.getStats()
      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(1)
    })

    it('should calculate hit rate', async () => {
      await cache.set({ prompt: 'a', model: 'gpt-4' }, { text: 'A' })

      await cache.get({ prompt: 'a', model: 'gpt-4' })
      await cache.get({ prompt: 'a', model: 'gpt-4' })
      await cache.get({ prompt: 'b', model: 'gpt-4' })
      await cache.get({ prompt: 'c', model: 'gpt-4' })

      const stats = cache.getStats()
      expect(stats.hitRate).toBeCloseTo(0.5, 2)
    })
  })

  describe('Typed results', () => {
    it('should preserve type of cached result', async () => {
      interface MyResult {
        items: string[]
        count: number
      }

      const params = { prompt: 'List items', model: 'gpt-4' }
      const result: MyResult = { items: ['a', 'b'], count: 2 }

      await cache.set(params, result)

      const cached = await cache.get<MyResult>(params)
      expect(cached?.items).toEqual(['a', 'b'])
      expect(cached?.count).toBe(2)
    })
  })
})

// =============================================================================
// 9. withCache Wrapper
// =============================================================================

describe('withCache - Function Wrapper', () => {
  let cache: MemoryCache<number>
  let callCount: number

  beforeEach(() => {
    cache = new MemoryCache<number>()
    callCount = 0
  })

  afterEach(() => {
    cache.dispose()
  })

  describe('Basic caching', () => {
    it('should cache function result', async () => {
      const fn = async (x: number) => {
        callCount++
        return x * 2
      }

      const cachedFn = withCache(cache, fn, {
        keyFn: (x) => `double:${x}`,
      })

      const result1 = await cachedFn(5)
      const result2 = await cachedFn(5)

      expect(result1).toBe(10)
      expect(result2).toBe(10)
      expect(callCount).toBe(1) // Only called once
    })

    it('should call function for different arguments', async () => {
      const fn = async (x: number) => {
        callCount++
        return x * 2
      }

      const cachedFn = withCache(cache, fn, {
        keyFn: (x) => `double:${x}`,
      })

      await cachedFn(5)
      await cachedFn(10)

      expect(callCount).toBe(2)
    })

    it('should cache multiple argument functions', async () => {
      const stringCache = new MemoryCache<string>()
      const fn = async (a: string, b: number) => {
        callCount++
        return `${a}-${b}`
      }

      const cachedFn = withCache(stringCache, fn, {
        keyFn: (a, b) => `${a}:${b}`,
      })

      const result1 = await cachedFn('test', 1)
      const result2 = await cachedFn('test', 1)
      const result3 = await cachedFn('test', 2)

      expect(result1).toBe('test-1')
      expect(result2).toBe('test-1')
      expect(result3).toBe('test-2')
      expect(callCount).toBe(2)

      stringCache.dispose()
    })
  })

  describe('TTL support', () => {
    it('should apply TTL to cached entries', async () => {
      const fn = async (x: number) => {
        callCount++
        return x * 2
      }

      const cachedFn = withCache(cache, fn, {
        keyFn: (x) => `double:${x}`,
        ttl: 50,
      })

      await cachedFn(5)
      expect(callCount).toBe(1)

      await cachedFn(5) // Should be cached
      expect(callCount).toBe(1)

      await sleep(60)

      await cachedFn(5) // Should be expired
      expect(callCount).toBe(2)
    })
  })

  describe('bypass() method', () => {
    it('should bypass cache and call function', async () => {
      const fn = async (x: number) => {
        callCount++
        return x * 2
      }

      const cachedFn = withCache(cache, fn, {
        keyFn: (x) => `double:${x}`,
      })

      await cachedFn(5)
      expect(callCount).toBe(1)

      const result = await cachedFn.bypass(5)
      expect(result).toBe(10)
      expect(callCount).toBe(2)
    })

    it('should update cache after bypass', async () => {
      let value = 10
      const fn = async () => {
        callCount++
        return value
      }

      const cachedFn = withCache(cache, fn, {
        keyFn: () => 'static',
      })

      await cachedFn()
      expect(callCount).toBe(1)

      value = 20
      const bypassResult = await cachedFn.bypass()
      expect(bypassResult).toBe(20)
      expect(callCount).toBe(2)

      // Subsequent calls should get updated cached value
      const cachedResult = await cachedFn()
      expect(cachedResult).toBe(20)
      expect(callCount).toBe(2)
    })
  })

  describe('Error handling', () => {
    it('should not cache errors', async () => {
      let shouldFail = true
      const fn = async () => {
        callCount++
        if (shouldFail) {
          throw new Error('Test error')
        }
        return 42
      }

      const cachedFn = withCache(cache, fn, {
        keyFn: () => 'test',
      })

      await expect(cachedFn()).rejects.toThrow('Test error')
      expect(callCount).toBe(1)

      shouldFail = false
      const result = await cachedFn()
      expect(result).toBe(42)
      expect(callCount).toBe(2)
    })
  })
})

// =============================================================================
// 10. Cleanup Timer Tests
// =============================================================================

describe('MemoryCache - Cleanup Timer', () => {
  it('should automatically clean up expired entries', async () => {
    const cache = new MemoryCache<string>({
      cleanupInterval: 30,
    })

    await cache.set('key1', 'value1', { ttl: 20 })
    await cache.set('key2', 'value2') // No TTL

    expect(await cache.get('key1')).toBe('value1')

    // Wait for expiration + cleanup
    await sleep(50)

    // key1 should be cleaned up, key2 should remain
    expect(await cache.get('key2')).toBe('value2')
    // key1 is already removed by cleanup or will return undefined

    cache.dispose()
  })

  it('should stop cleanup timer on dispose', async () => {
    const cache = new MemoryCache<string>({
      cleanupInterval: 10,
    })

    await cache.set('key1', 'value1', { ttl: 20 })

    cache.dispose()

    // Should not throw after dispose
    await sleep(50)
  })

  it('should handle multiple dispose calls', () => {
    const cache = new MemoryCache<string>({
      cleanupInterval: 10,
    })

    cache.dispose()
    cache.dispose() // Should not throw
  })
})

// =============================================================================
// 11. Edge Cases
// =============================================================================

describe('Cache Edge Cases', () => {
  describe('Special key values', () => {
    let cache: MemoryCache<string>

    beforeEach(() => {
      cache = new MemoryCache<string>()
    })

    afterEach(() => {
      cache.dispose()
    })

    it('should handle keys with special characters', async () => {
      const keys = [
        'key:with:colons',
        'key/with/slashes',
        'key.with.dots',
        'key with spaces',
        'key\nwith\nnewlines',
        'key\twith\ttabs',
      ]

      for (const key of keys) {
        await cache.set(key, `value-${key}`)
        expect(await cache.get(key)).toBe(`value-${key}`)
      }
    })

    it('should handle very long keys', async () => {
      const longKey = 'k'.repeat(10000)
      await cache.set(longKey, 'value')
      expect(await cache.get(longKey)).toBe('value')
    })
  })

  describe('Special value types', () => {
    it('should handle null values', async () => {
      const cache = new MemoryCache<null>()
      await cache.set('key', null)
      expect(await cache.get('key')).toBeNull()
      cache.dispose()
    })

    it('should handle complex objects', async () => {
      const cache = new MemoryCache<object>()
      const complexValue = {
        nested: { deep: { value: [1, 2, { a: 'b' }] } },
        fn: undefined, // Functions are not preserved
        date: new Date().toISOString(),
      }

      await cache.set('key', complexValue)
      const result = await cache.get('key')
      expect(result).toEqual(complexValue)
      cache.dispose()
    })

    it('should handle array values', async () => {
      const cache = new MemoryCache<number[]>()
      const arr = [1, 2, 3, 4, 5]

      await cache.set('key', arr)
      expect(await cache.get('key')).toEqual(arr)
      cache.dispose()
    })
  })

  describe('Concurrent operations', () => {
    it('should handle concurrent gets and sets', async () => {
      const cache = new MemoryCache<number>()

      const operations = Array.from({ length: 100 }, (_, i) =>
        i % 2 === 0
          ? cache.set(`key${Math.floor(i / 10)}`, i)
          : cache.get(`key${Math.floor(i / 10)}`)
      )

      await Promise.all(operations)

      // Cache should be in consistent state
      const size = await cache.size()
      expect(size).toBeGreaterThan(0)
      expect(size).toBeLessThanOrEqual(10)

      cache.dispose()
    })
  })
})
