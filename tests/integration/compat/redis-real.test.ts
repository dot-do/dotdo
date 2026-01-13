/**
 * Redis Compat Layer Integration Tests (RED Phase)
 *
 * Tests the @dotdo/redis compat layer with real DO storage,
 * verifying API compatibility with ioredis.
 *
 * These tests:
 * 1. Verify correct API shape matching ioredis
 * 2. Verify proper DO storage for state persistence
 * 3. Verify error handling matches ioredis behavior
 *
 * Run with: npx vitest run tests/integration/compat/redis-real.test.ts --project=integration
 *
 * @module tests/integration/compat/redis-real
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('Redis Compat Layer - Real Integration', () => {
  /**
   * Test Suite 1: API Shape Compatibility with ioredis
   *
   * Verifies that the Redis compat layer exports the same API surface
   * as the official ioredis package.
   */
  describe('API Shape Compatibility', () => {
    it('exports Redis class with ioredis-compatible constructor', async () => {
      const { Redis } = await import('../../../packages/redis/src/index')

      // Redis class should exist and be constructable
      expect(Redis).toBeDefined()
      expect(typeof Redis).toBe('function')

      // Should accept connection options like ioredis
      const client = new Redis()
      expect(client).toBeDefined()
    })

    it('exposes string commands: GET, SET, MGET, MSET, INCR, DECR', async () => {
      const { Redis } = await import('../../../packages/redis/src/index')
      const redis = new Redis()

      // Verify string command methods exist
      expect(typeof redis.get).toBe('function')
      expect(typeof redis.set).toBe('function')
      expect(typeof redis.mget).toBe('function')
      expect(typeof redis.mset).toBe('function')
      expect(typeof redis.incr).toBe('function')
      expect(typeof redis.decr).toBe('function')
      expect(typeof redis.append).toBe('function')
      expect(typeof redis.strlen).toBe('function')
    })

    it('exposes hash commands: HGET, HSET, HGETALL, HDEL, HINCRBY', async () => {
      const { Redis } = await import('../../../packages/redis/src/index')
      const redis = new Redis()

      expect(typeof redis.hget).toBe('function')
      expect(typeof redis.hset).toBe('function')
      expect(typeof redis.hgetall).toBe('function')
      expect(typeof redis.hdel).toBe('function')
      expect(typeof redis.hincrby).toBe('function')
      expect(typeof redis.hkeys).toBe('function')
      expect(typeof redis.hvals).toBe('function')
    })

    it('exposes list commands: LPUSH, RPUSH, LPOP, RPOP, LRANGE, LLEN', async () => {
      const { Redis } = await import('../../../packages/redis/src/index')
      const redis = new Redis()

      expect(typeof redis.lpush).toBe('function')
      expect(typeof redis.rpush).toBe('function')
      expect(typeof redis.lpop).toBe('function')
      expect(typeof redis.rpop).toBe('function')
      expect(typeof redis.lrange).toBe('function')
      expect(typeof redis.llen).toBe('function')
      expect(typeof redis.lindex).toBe('function')
    })

    it('exposes set commands: SADD, SREM, SMEMBERS, SINTER, SUNION', async () => {
      const { Redis } = await import('../../../packages/redis/src/index')
      const redis = new Redis()

      expect(typeof redis.sadd).toBe('function')
      expect(typeof redis.srem).toBe('function')
      expect(typeof redis.smembers).toBe('function')
      expect(typeof redis.sinter).toBe('function')
      expect(typeof redis.sunion).toBe('function')
      expect(typeof redis.sdiff).toBe('function')
    })

    it('exposes key commands: DEL, EXISTS, EXPIRE, TTL, KEYS, TYPE', async () => {
      const { Redis } = await import('../../../packages/redis/src/index')
      const redis = new Redis()

      expect(typeof redis.del).toBe('function')
      expect(typeof redis.exists).toBe('function')
      expect(typeof redis.expire).toBe('function')
      expect(typeof redis.ttl).toBe('function')
      expect(typeof redis.keys).toBe('function')
      expect(typeof redis.type).toBe('function')
      expect(typeof redis.rename).toBe('function')
    })
  })

  /**
   * Test Suite 2: DO Storage Integration
   *
   * Verifies that Redis operations properly persist to DO SQLite storage.
   */
  describe('DO Storage Persistence', () => {
    let redis: any

    beforeEach(async () => {
      const { Redis } = await import('../../../packages/redis/src/index')
      redis = new Redis()
      await redis.flushdb()
    })

    it('persists string values across operations', async () => {
      // Set a value
      await redis.set('persist:key1', 'value1')

      // Should be retrievable
      const value = await redis.get('persist:key1')
      expect(value).toBe('value1')

      // Should survive KEYS scan
      const keys = await redis.keys('persist:*')
      expect(keys).toContain('persist:key1')
    })

    it('persists hash data structures', async () => {
      // Set hash fields
      await redis.hset('persist:hash', [
        ['field1', 'value1'],
        ['field2', 'value2'],
      ])

      // Should be retrievable
      const all = await redis.hgetall('persist:hash')
      expect(all).toEqual({ field1: 'value1', field2: 'value2' })
    })

    it('persists list data structures', async () => {
      // Push to list
      await redis.rpush('persist:list', ['a', 'b', 'c'])

      // Should be retrievable
      const list = await redis.lrange('persist:list', 0, -1)
      expect(list).toEqual(['a', 'b', 'c'])
    })

    it('persists set data structures', async () => {
      // Add to set
      await redis.sadd('persist:set', ['member1', 'member2', 'member3'])

      // Should be retrievable
      const members = await redis.smembers('persist:set')
      expect(members).toHaveLength(3)
      expect(members).toContain('member1')
      expect(members).toContain('member2')
      expect(members).toContain('member3')
    })

    it('persists TTL/expiration metadata', async () => {
      // Set with expiration
      await redis.set('persist:expiring', 'value')
      await redis.expire('persist:expiring', 3600)

      // TTL should be retrievable
      const ttl = await redis.ttl('persist:expiring')
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(3600)
    })

    it('maintains atomicity for INCR/DECR operations', async () => {
      await redis.set('persist:counter', '0')

      // Run multiple increments
      const results = await Promise.all([
        redis.incr('persist:counter'),
        redis.incr('persist:counter'),
        redis.incr('persist:counter'),
      ])

      // Final value should be 3
      const final = await redis.get('persist:counter')
      expect(final).toBe('3')
    })
  })

  /**
   * Test Suite 3: Error Handling Compatibility
   *
   * Verifies that errors match ioredis error patterns.
   */
  describe('Error Handling Compatibility', () => {
    let redis: any

    beforeEach(async () => {
      const { Redis } = await import('../../../packages/redis/src/index')
      redis = new Redis()
      await redis.flushdb()
    })

    it('throws WRONGTYPE error for type mismatches', async () => {
      // Set a string value
      await redis.set('str', 'value')

      // Attempting hash operation should throw WRONGTYPE
      await expect(redis.hget('str', 'field')).rejects.toThrow(/WRONGTYPE/)
    })

    it('throws error for INCR on non-integer values', async () => {
      await redis.set('notint', 'hello')

      await expect(redis.incr('notint')).rejects.toThrow()
    })

    it('throws error for LSET on out-of-range index', async () => {
      await redis.rpush('mylist', ['a', 'b', 'c'])

      await expect(redis.lset('mylist', 100, 'x')).rejects.toThrow()
    })

    it('throws error for RENAME on non-existent key', async () => {
      await expect(redis.rename('nonexistent', 'newkey')).rejects.toThrow()
    })

    it('returns null for GET on non-existent key (not error)', async () => {
      const result = await redis.get('nonexistent')
      expect(result).toBeNull()
    })

    it('returns empty array for SMEMBERS on non-existent key', async () => {
      const result = await redis.smembers('nonexistent')
      expect(result).toEqual([])
    })

    it('returns -2 for TTL on non-existent key', async () => {
      const ttl = await redis.ttl('nonexistent')
      expect(ttl).toBe(-2)
    })

    it('returns -1 for TTL on key without expiry', async () => {
      await redis.set('noexpiry', 'value')
      const ttl = await redis.ttl('noexpiry')
      expect(ttl).toBe(-1)
    })
  })

  /**
   * Test Suite 4: Data Type Behavior
   *
   * Verifies correct behavior for different Redis data types.
   */
  describe('Data Type Behavior', () => {
    let redis: any

    beforeEach(async () => {
      const { Redis } = await import('../../../packages/redis/src/index')
      redis = new Redis()
      await redis.flushdb()
    })

    it('TYPE command returns correct type', async () => {
      await redis.set('str', 'value')
      await redis.hset('hash', [['f', 'v']])
      await redis.rpush('list', ['a'])
      await redis.sadd('set', ['a'])

      expect(await redis.type('str')).toBe('string')
      expect(await redis.type('hash')).toBe('hash')
      expect(await redis.type('list')).toBe('list')
      expect(await redis.type('set')).toBe('set')
      expect(await redis.type('nonexistent')).toBe('none')
    })

    it('KEYS pattern matching works correctly', async () => {
      await redis.set('user:1:name', 'Alice')
      await redis.set('user:1:email', 'alice@example.com')
      await redis.set('user:2:name', 'Bob')
      await redis.set('admin:1:name', 'Admin')

      const userKeys = await redis.keys('user:*')
      expect(userKeys.length).toBe(3)

      const user1Keys = await redis.keys('user:1:*')
      expect(user1Keys.length).toBe(2)

      const allKeys = await redis.keys('*')
      expect(allKeys.length).toBe(4)
    })

    it('Set operations maintain uniqueness', async () => {
      await redis.sadd('myset', ['a', 'b', 'c'])
      await redis.sadd('myset', ['b', 'c', 'd'])

      const members = await redis.smembers('myset')
      expect(members.length).toBe(4)
    })

    it('List operations maintain order', async () => {
      await redis.rpush('mylist', ['a', 'b'])
      await redis.lpush('mylist', ['c'])
      await redis.rpush('mylist', ['d'])

      const list = await redis.lrange('mylist', 0, -1)
      expect(list).toEqual(['c', 'a', 'b', 'd'])
    })
  })
})
