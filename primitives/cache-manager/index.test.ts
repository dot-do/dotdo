import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CacheManager,
  LRUCache,
  LFUCache,
  FIFOCache,
  TieredCache,
  TagInvalidator,
  CacheWarmer,
  JSONSerializer,
  MsgPackSerializer,
} from './index'
import type { CacheConfig, CacheOptions, CacheStats, ICache } from './types'

describe('CacheManager', () => {
  describe('Basic get/set/delete operations', () => {
    let cache: CacheManager<string>

    beforeEach(() => {
      cache = new CacheManager<string>()
    })

    test('get returns undefined for non-existent key', () => {
      expect(cache.get('nonexistent')).toBeUndefined()
    })

    test('set stores a value that can be retrieved with get', () => {
      cache.set('key1', 'value1')
      expect(cache.get('key1')).toBe('value1')
    })

    test('set overwrites existing value', () => {
      cache.set('key1', 'value1')
      cache.set('key1', 'value2')
      expect(cache.get('key1')).toBe('value2')
    })

    test('delete removes an entry and returns true', () => {
      cache.set('key1', 'value1')
      const result = cache.delete('key1')
      expect(result).toBe(true)
      expect(cache.get('key1')).toBeUndefined()
    })

    test('delete returns false for non-existent key', () => {
      const result = cache.delete('nonexistent')
      expect(result).toBe(false)
    })

    test('has returns true for existing key', () => {
      cache.set('key1', 'value1')
      expect(cache.has('key1')).toBe(true)
    })

    test('has returns false for non-existent key', () => {
      expect(cache.has('nonexistent')).toBe(false)
    })

    test('clear removes all entries', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')
      cache.clear()
      expect(cache.has('key1')).toBe(false)
      expect(cache.has('key2')).toBe(false)
      expect(cache.has('key3')).toBe(false)
      expect(cache.size()).toBe(0)
    })

    test('size returns correct count of entries', () => {
      expect(cache.size()).toBe(0)
      cache.set('key1', 'value1')
      expect(cache.size()).toBe(1)
      cache.set('key2', 'value2')
      expect(cache.size()).toBe(2)
      cache.delete('key1')
      expect(cache.size()).toBe(1)
    })

    test('keys returns all keys', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')
      const keys = cache.keys()
      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
      expect(keys).toContain('key3')
      expect(keys.length).toBe(3)
    })
  })

  describe('TTL expiration', () => {
    let cache: CacheManager<string>

    beforeEach(() => {
      vi.useFakeTimers()
      cache = new CacheManager<string>()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    test('entry expires after TTL', () => {
      cache.set('key1', 'value1', { ttl: 1000 })
      expect(cache.get('key1')).toBe('value1')

      vi.advanceTimersByTime(1001)
      expect(cache.get('key1')).toBeUndefined()
    })

    test('entry with TTL is valid before expiration', () => {
      cache.set('key1', 'value1', { ttl: 1000 })

      vi.advanceTimersByTime(500)
      expect(cache.get('key1')).toBe('value1')
    })

    test('has returns false for expired entry', () => {
      cache.set('key1', 'value1', { ttl: 1000 })

      vi.advanceTimersByTime(1001)
      expect(cache.has('key1')).toBe(false)
    })

    test('entry without TTL never expires', () => {
      cache.set('key1', 'value1')

      vi.advanceTimersByTime(100000)
      expect(cache.get('key1')).toBe('value1')
    })

    test('default TTL from config applies to all entries', () => {
      cache = new CacheManager<string>({ ttl: 500 })
      cache.set('key1', 'value1')

      vi.advanceTimersByTime(501)
      expect(cache.get('key1')).toBeUndefined()
    })

    test('per-entry TTL overrides default TTL', () => {
      cache = new CacheManager<string>({ ttl: 500 })
      cache.set('key1', 'value1', { ttl: 2000 })

      vi.advanceTimersByTime(501)
      expect(cache.get('key1')).toBe('value1')

      vi.advanceTimersByTime(1500)
      expect(cache.get('key1')).toBeUndefined()
    })

    test('size excludes expired entries', () => {
      cache.set('key1', 'value1', { ttl: 1000 })
      cache.set('key2', 'value2', { ttl: 2000 })
      cache.set('key3', 'value3')

      expect(cache.size()).toBe(3)

      vi.advanceTimersByTime(1001)
      expect(cache.size()).toBe(2)

      vi.advanceTimersByTime(1000)
      expect(cache.size()).toBe(1)
    })

    test('keys excludes expired entries', () => {
      cache.set('key1', 'value1', { ttl: 1000 })
      cache.set('key2', 'value2')

      vi.advanceTimersByTime(1001)
      const keys = cache.keys()
      expect(keys).not.toContain('key1')
      expect(keys).toContain('key2')
    })
  })

  describe('getOrSet with factory', () => {
    let cache: CacheManager<string>

    beforeEach(() => {
      cache = new CacheManager<string>()
    })

    test('getOrSet returns existing value without calling factory', () => {
      cache.set('key1', 'existing')
      const factory = vi.fn(() => 'new')

      const result = cache.getOrSet('key1', factory)

      expect(result).toBe('existing')
      expect(factory).not.toHaveBeenCalled()
    })

    test('getOrSet calls factory for missing key', () => {
      const factory = vi.fn(() => 'computed')

      const result = cache.getOrSet('key1', factory)

      expect(result).toBe('computed')
      expect(factory).toHaveBeenCalledTimes(1)
    })

    test('getOrSet caches the computed value', () => {
      const factory = vi.fn(() => 'computed')

      cache.getOrSet('key1', factory)
      const result = cache.get('key1')

      expect(result).toBe('computed')
    })

    test('getOrSet applies options to cached value', () => {
      vi.useFakeTimers()
      const factory = vi.fn(() => 'computed')

      cache.getOrSet('key1', factory, { ttl: 1000 })

      vi.advanceTimersByTime(1001)
      expect(cache.get('key1')).toBeUndefined()
      vi.useRealTimers()
    })

    test('getOrSet handles async factory', async () => {
      const factory = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return 'async-value'
      })

      const result = await cache.getOrSet('key1', factory)

      expect(result).toBe('async-value')
      expect(cache.get('key1')).toBe('async-value')
    })
  })

  describe('Cache stats tracking', () => {
    let cache: CacheManager<string>

    beforeEach(() => {
      cache = new CacheManager<string>()
    })

    test('stats returns initial values', () => {
      const stats = cache.stats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      expect(stats.hitRate).toBe(0)
      expect(stats.size).toBe(0)
      expect(stats.evictions).toBe(0)
      expect(stats.expirations).toBe(0)
    })

    test('stats tracks hits', () => {
      cache.set('key1', 'value1')
      cache.get('key1')
      cache.get('key1')

      const stats = cache.stats()
      expect(stats.hits).toBe(2)
    })

    test('stats tracks misses', () => {
      cache.get('nonexistent1')
      cache.get('nonexistent2')

      const stats = cache.stats()
      expect(stats.misses).toBe(2)
    })

    test('stats calculates hit rate', () => {
      cache.set('key1', 'value1')
      cache.get('key1') // hit
      cache.get('key1') // hit
      cache.get('nonexistent') // miss

      const stats = cache.stats()
      expect(stats.hitRate).toBeCloseTo(0.666, 2)
    })

    test('stats tracks current size', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      expect(cache.stats().size).toBe(2)
    })

    test('stats tracks expirations', () => {
      vi.useFakeTimers()
      cache.set('key1', 'value1', { ttl: 1000 })

      vi.advanceTimersByTime(1001)
      cache.get('key1') // triggers expiration detection

      const stats = cache.stats()
      expect(stats.expirations).toBe(1)
      vi.useRealTimers()
    })
  })
})

describe('LRUCache', () => {
  let cache: LRUCache<string>

  beforeEach(() => {
    cache = new LRUCache<string>({ maxSize: 3 })
  })

  test('evicts least recently used entry when at capacity', () => {
    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')

    // Access 'a' to make it recently used
    cache.get('a')

    // Adding a new entry should evict 'b' (least recently used)
    cache.set('d', 'value-d')

    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
    expect(cache.has('d')).toBe(true)
  })

  test('get updates access time', () => {
    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')

    // Access 'a' multiple times
    cache.get('a')
    cache.get('a')

    // Add two new entries
    cache.set('d', 'value-d')
    cache.set('e', 'value-e')

    // 'a' should still be there (most recently used)
    expect(cache.has('a')).toBe(true)
    // 'b' and 'c' should be evicted
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(false)
  })

  test('set on existing key updates access time', () => {
    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')

    // Update 'a'
    cache.set('a', 'new-value-a')

    // Add a new entry - should evict 'b'
    cache.set('d', 'value-d')

    expect(cache.get('a')).toBe('new-value-a')
    expect(cache.has('b')).toBe(false)
  })

  test('respects maxSize configuration', () => {
    cache = new LRUCache<string>({ maxSize: 2 })
    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')

    expect(cache.size()).toBe(2)
    expect(cache.has('a')).toBe(false)
  })

  test('tracks eviction count in stats', () => {
    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')
    cache.set('d', 'value-d')
    cache.set('e', 'value-e')

    const stats = cache.stats()
    expect(stats.evictions).toBe(2)
  })

  test('works with unlimited size (no eviction)', () => {
    cache = new LRUCache<string>() // No maxSize
    for (let i = 0; i < 100; i++) {
      cache.set(`key${i}`, `value${i}`)
    }
    expect(cache.size()).toBe(100)
  })
})

describe('LFUCache', () => {
  let cache: LFUCache<string>

  beforeEach(() => {
    cache = new LFUCache<string>({ maxSize: 3 })
  })

  test('evicts least frequently used entry when at capacity', () => {
    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')

    // Access 'a' and 'c' multiple times to increase their frequency
    cache.get('a')
    cache.get('a')
    cache.get('c')

    // Adding a new entry should evict 'b' (least frequently used)
    cache.set('d', 'value-d')

    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
    expect(cache.has('d')).toBe(true)
  })

  test('frequency increases with each access', () => {
    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')

    // Access 'a' 5 times, 'b' 3 times, 'c' 1 time
    for (let i = 0; i < 5; i++) cache.get('a')
    for (let i = 0; i < 3; i++) cache.get('b')
    cache.get('c')

    // Add 'd' - should evict 'c' (lowest frequency)
    cache.set('d', 'value-d')

    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(true)
    expect(cache.has('c')).toBe(false)
    expect(cache.has('d')).toBe(true)
  })

  test('with equal frequency, evicts older entry', () => {
    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')

    // No additional accesses - all have frequency 1
    // Adding 'd' should evict 'a' (oldest with same frequency)
    cache.set('d', 'value-d')

    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(true)
    expect(cache.has('c')).toBe(true)
    expect(cache.has('d')).toBe(true)
  })

  test('set on existing key does not increase size', () => {
    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')

    cache.set('a', 'new-value-a')
    cache.set('a', 'newer-value-a')

    expect(cache.size()).toBe(3)
    expect(cache.get('a')).toBe('newer-value-a')
  })

  test('tracks eviction count in stats', () => {
    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')
    cache.set('d', 'value-d')
    cache.set('e', 'value-e')

    const stats = cache.stats()
    expect(stats.evictions).toBe(2)
  })
})

describe('FIFOCache', () => {
  let cache: FIFOCache<string>

  beforeEach(() => {
    cache = new FIFOCache<string>({ maxSize: 3 })
  })

  test('evicts first inserted entry when at capacity', () => {
    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')

    // Access 'a' (should not affect eviction order)
    cache.get('a')

    // Adding a new entry should evict 'a' (first inserted)
    cache.set('d', 'value-d')

    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(true)
    expect(cache.has('c')).toBe(true)
    expect(cache.has('d')).toBe(true)
  })

  test('access does not change eviction order', () => {
    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')

    // Access all entries multiple times
    for (let i = 0; i < 10; i++) {
      cache.get('a')
      cache.get('b')
      cache.get('c')
    }

    // Add new entries - should still evict in FIFO order
    cache.set('d', 'value-d')
    cache.set('e', 'value-e')

    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
    expect(cache.has('d')).toBe(true)
    expect(cache.has('e')).toBe(true)
  })

  test('update does not change eviction order', () => {
    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')

    // Update 'a' multiple times
    cache.set('a', 'new-value-a')
    cache.set('a', 'newer-value-a')

    // Add new entry - should still evict 'a' (first inserted)
    cache.set('d', 'value-d')

    expect(cache.has('a')).toBe(false)
    expect(cache.get('b')).toBe('value-b')
  })

  test('tracks eviction count in stats', () => {
    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')
    cache.set('d', 'value-d')
    cache.set('e', 'value-e')

    const stats = cache.stats()
    expect(stats.evictions).toBe(2)
  })

  test('respects maxSize configuration', () => {
    cache = new FIFOCache<string>({ maxSize: 2 })
    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')

    expect(cache.size()).toBe(2)
    expect(cache.has('a')).toBe(false)
  })
})

describe('TagInvalidator', () => {
  let cache: CacheManager<string>
  let invalidator: TagInvalidator

  beforeEach(() => {
    cache = new CacheManager<string>()
    invalidator = new TagInvalidator(cache)
  })

  test('invalidates entries by single tag', () => {
    cache.set('user:1', 'alice', { tags: ['users'] })
    cache.set('user:2', 'bob', { tags: ['users'] })
    cache.set('product:1', 'widget', { tags: ['products'] })

    invalidator.invalidate({ tags: ['users'] })

    expect(cache.has('user:1')).toBe(false)
    expect(cache.has('user:2')).toBe(false)
    expect(cache.has('product:1')).toBe(true)
  })

  test('invalidates entries by multiple tags (OR logic)', () => {
    cache.set('user:1', 'alice', { tags: ['users', 'admins'] })
    cache.set('user:2', 'bob', { tags: ['users'] })
    cache.set('product:1', 'widget', { tags: ['products'] })

    invalidator.invalidate({ tags: ['admins'] })

    expect(cache.has('user:1')).toBe(false)
    expect(cache.has('user:2')).toBe(true)
    expect(cache.has('product:1')).toBe(true)
  })

  test('invalidates entries by prefix', () => {
    cache.set('user:1', 'alice')
    cache.set('user:2', 'bob')
    cache.set('product:1', 'widget')

    invalidator.invalidate({ prefix: 'user:' })

    expect(cache.has('user:1')).toBe(false)
    expect(cache.has('user:2')).toBe(false)
    expect(cache.has('product:1')).toBe(true)
  })

  test('invalidates entries by regex', () => {
    cache.set('user:1:profile', 'data1')
    cache.set('user:2:settings', 'data2')
    cache.set('user:1:settings', 'data3')
    cache.set('product:1', 'widget')

    invalidator.invalidate({ regex: /^user:\d+:settings$/ })

    expect(cache.has('user:1:profile')).toBe(true)
    expect(cache.has('user:2:settings')).toBe(false)
    expect(cache.has('user:1:settings')).toBe(false)
    expect(cache.has('product:1')).toBe(true)
  })

  test('combines tag, prefix, and regex (OR logic)', () => {
    cache.set('user:1', 'alice', { tags: ['users'] })
    cache.set('admin:1', 'superuser')
    cache.set('temp:1', 'temporary')
    cache.set('product:1', 'widget')

    invalidator.invalidate({
      tags: ['users'],
      prefix: 'admin:',
      regex: /^temp:/,
    })

    expect(cache.has('user:1')).toBe(false)
    expect(cache.has('admin:1')).toBe(false)
    expect(cache.has('temp:1')).toBe(false)
    expect(cache.has('product:1')).toBe(true)
  })

  test('returns count of invalidated entries', () => {
    cache.set('user:1', 'alice', { tags: ['users'] })
    cache.set('user:2', 'bob', { tags: ['users'] })
    cache.set('product:1', 'widget')

    const count = invalidator.invalidate({ tags: ['users'] })

    expect(count).toBe(2)
  })
})

describe('TieredCache', () => {
  let l1Cache: CacheManager<string>
  let l2Cache: CacheManager<string>
  let tieredCache: TieredCache<string>

  beforeEach(() => {
    l1Cache = new CacheManager<string>({ maxSize: 2 })
    l2Cache = new CacheManager<string>({ maxSize: 10 })
    tieredCache = new TieredCache<string>([
      { name: 'memory', cache: l1Cache, promoteOnAccess: true },
      { name: 'do-storage', cache: l2Cache },
    ])
  })

  test('get checks tiers in order', () => {
    l1Cache.set('key1', 'l1-value')
    l2Cache.set('key2', 'l2-value')

    expect(tieredCache.get('key1')).toBe('l1-value')
    expect(tieredCache.get('key2')).toBe('l2-value')
  })

  test('set writes to first tier', () => {
    tieredCache.set('key1', 'value1')

    expect(l1Cache.get('key1')).toBe('value1')
    expect(l2Cache.has('key1')).toBe(false)
  })

  test('promotes value to higher tier on access', () => {
    l2Cache.set('key1', 'l2-value')

    // Access through tiered cache - should promote to L1
    tieredCache.get('key1')

    expect(l1Cache.get('key1')).toBe('l2-value')
  })

  test('demotes value to lower tier', () => {
    tieredCache.set('key1', 'value1')

    tieredCache.demote('key1')

    expect(l1Cache.has('key1')).toBe(false)
    expect(l2Cache.get('key1')).toBe('value1')
  })

  test('delete removes from all tiers', () => {
    l1Cache.set('key1', 'value1')
    l2Cache.set('key1', 'value1')

    tieredCache.delete('key1')

    expect(l1Cache.has('key1')).toBe(false)
    expect(l2Cache.has('key1')).toBe(false)
  })

  test('clear clears all tiers', () => {
    l1Cache.set('key1', 'value1')
    l2Cache.set('key2', 'value2')

    tieredCache.clear()

    expect(l1Cache.size()).toBe(0)
    expect(l2Cache.size()).toBe(0)
  })

  test('aggregates stats from all tiers', () => {
    l1Cache.set('key1', 'value1')
    l2Cache.set('key2', 'value2')
    l2Cache.set('key3', 'value3')

    const stats = tieredCache.stats()
    expect(stats.size).toBe(3)
  })
})

describe('CacheWarmer', () => {
  let cache: CacheManager<string>
  let warmer: CacheWarmer<string>

  beforeEach(() => {
    cache = new CacheManager<string>()
    warmer = new CacheWarmer(cache)
  })

  test('warms cache with provided keys and factory', async () => {
    const factory = vi.fn((key: string) => Promise.resolve(`value-for-${key}`))

    await warmer.warm(['key1', 'key2', 'key3'], factory)

    expect(cache.get('key1')).toBe('value-for-key1')
    expect(cache.get('key2')).toBe('value-for-key2')
    expect(cache.get('key3')).toBe('value-for-key3')
  })

  test('applies options to warmed entries', async () => {
    vi.useFakeTimers()
    const factory = vi.fn((key: string) => Promise.resolve(`value-for-${key}`))

    await warmer.warm(['key1'], factory, { ttl: 1000 })

    vi.advanceTimersByTime(1001)
    expect(cache.get('key1')).toBeUndefined()
    vi.useRealTimers()
  })

  test('calls factory for each key', async () => {
    const factory = vi.fn((key: string) => Promise.resolve(`value-for-${key}`))

    await warmer.warm(['a', 'b', 'c'], factory)

    expect(factory).toHaveBeenCalledTimes(3)
    expect(factory).toHaveBeenCalledWith('a')
    expect(factory).toHaveBeenCalledWith('b')
    expect(factory).toHaveBeenCalledWith('c')
  })

  test('handles factory errors gracefully', async () => {
    const factory = vi.fn((key: string) => {
      if (key === 'fail') throw new Error('Failed to fetch')
      return Promise.resolve(`value-for-${key}`)
    })

    await expect(warmer.warm(['key1', 'fail', 'key2'], factory)).resolves.not.toThrow()

    expect(cache.get('key1')).toBe('value-for-key1')
    expect(cache.has('fail')).toBe(false)
    expect(cache.get('key2')).toBe('value-for-key2')
  })

  test('returns warming result with success/failure counts', async () => {
    const factory = vi.fn((key: string) => {
      if (key === 'fail') throw new Error('Failed')
      return Promise.resolve(`value-for-${key}`)
    })

    const result = await warmer.warm(['a', 'b', 'fail', 'c'], factory)

    expect(result.total).toBe(4)
    expect(result.success).toBe(3)
    expect(result.failed).toBe(1)
  })
})

describe('Serialization', () => {
  describe('JSONSerializer', () => {
    let serializer: JSONSerializer

    beforeEach(() => {
      serializer = new JSONSerializer()
    })

    test('serializes primitive values', () => {
      const data = serializer.serialize('hello')
      const result = serializer.deserialize<string>(data)
      expect(result).toBe('hello')
    })

    test('serializes objects', () => {
      const obj = { name: 'test', value: 42 }
      const data = serializer.serialize(obj)
      const result = serializer.deserialize<typeof obj>(data)
      expect(result).toEqual(obj)
    })

    test('serializes arrays', () => {
      const arr = [1, 2, 3, 'four', { five: 5 }]
      const data = serializer.serialize(arr)
      const result = serializer.deserialize<typeof arr>(data)
      expect(result).toEqual(arr)
    })

    test('handles nested objects', () => {
      const nested = { a: { b: { c: { d: 'deep' } } } }
      const data = serializer.serialize(nested)
      const result = serializer.deserialize<typeof nested>(data)
      expect(result).toEqual(nested)
    })

    test('throws on circular references', () => {
      const circular: any = { self: null }
      circular.self = circular
      expect(() => serializer.serialize(circular)).toThrow()
    })
  })

  describe('MsgPackSerializer', () => {
    let serializer: MsgPackSerializer

    beforeEach(() => {
      serializer = new MsgPackSerializer()
    })

    test('serializes primitive values', () => {
      const data = serializer.serialize('hello')
      const result = serializer.deserialize<string>(data)
      expect(result).toBe('hello')
    })

    test('serializes objects', () => {
      const obj = { name: 'test', value: 42 }
      const data = serializer.serialize(obj)
      const result = serializer.deserialize<typeof obj>(data)
      expect(result).toEqual(obj)
    })

    test('serializes to Uint8Array', () => {
      const data = serializer.serialize({ test: true })
      expect(data).toBeInstanceOf(Uint8Array)
    })

    test('produces smaller output than JSON for objects', () => {
      const obj = { name: 'test', value: 42, nested: { a: 1, b: 2 } }
      const jsonSerializer = new JSONSerializer()

      const msgpackData = serializer.serialize(obj)
      const jsonData = jsonSerializer.serialize(obj)

      // MsgPack should be more compact
      expect(msgpackData.length).toBeLessThan(jsonData.length)
    })
  })
})

describe('Concurrent access', () => {
  let cache: CacheManager<number>

  beforeEach(() => {
    cache = new CacheManager<number>()
  })

  test('handles concurrent reads safely', async () => {
    cache.set('counter', 100)

    const reads = Array.from({ length: 100 }, () =>
      Promise.resolve(cache.get('counter'))
    )

    const results = await Promise.all(reads)
    expect(results.every(r => r === 100)).toBe(true)
  })

  test('handles concurrent writes safely', async () => {
    const writes = Array.from({ length: 100 }, (_, i) =>
      Promise.resolve(cache.set(`key${i}`, i))
    )

    await Promise.all(writes)
    expect(cache.size()).toBe(100)
  })

  test('getOrSet prevents duplicate factory calls', async () => {
    let callCount = 0
    const slowFactory = async () => {
      callCount++
      await new Promise(resolve => setTimeout(resolve, 50))
      return 'computed'
    }

    // Concurrent getOrSet calls for the same key
    const results = await Promise.all([
      cache.getOrSet('key1', slowFactory),
      cache.getOrSet('key1', slowFactory),
      cache.getOrSet('key1', slowFactory),
    ])

    // Factory should only be called once
    expect(callCount).toBe(1)
    expect(results.every(r => r === 'computed')).toBe(true)
  })
})
