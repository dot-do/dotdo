/**
 * Primitive Storage Tests
 *
 * Tests for the Redis-compatible storage backed by unified primitives:
 * - TemporalStore for TTL/versioning
 * - KeyedRouter for distributed routing
 *
 * @module db/compat/cache/redis/storage/primitive-storage.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { PrimitiveStorage, createPrimitiveStorage, type ZSetEntry } from './primitive-storage'
import { ReplyError } from '../types'

describe('PrimitiveStorage', () => {
  let storage: PrimitiveStorage

  beforeEach(async () => {
    storage = createPrimitiveStorage()
    await storage.flush()
  })

  // ===========================================================================
  // FACTORY & CONFIGURATION
  // ===========================================================================

  describe('factory', () => {
    it('should create storage with default options', () => {
      const s = createPrimitiveStorage()
      expect(s).toBeInstanceOf(PrimitiveStorage)
    })

    it('should create storage with key prefix', async () => {
      const s = createPrimitiveStorage({ keyPrefix: 'test:' })
      await s.setString('key', 'value')
      expect(await s.getString('key')).toBe('value')
    })

    it('should create storage with partition routing', () => {
      const s = createPrimitiveStorage({ partitionCount: 8 })
      // Different keys should route to different partitions
      const partitions = new Set<number>()
      for (let i = 0; i < 100; i++) {
        partitions.add(s.getPartition(`key${i}`))
      }
      // Should have multiple partitions used
      expect(partitions.size).toBeGreaterThan(1)
    })

    it('should support time-travel option', () => {
      const s = createPrimitiveStorage({ enableTimeTravel: true })
      expect(s).toBeInstanceOf(PrimitiveStorage)
    })
  })

  // ===========================================================================
  // TYPE OPERATIONS
  // ===========================================================================

  describe('type operations', () => {
    it('should return none for non-existent key', async () => {
      expect(await storage.getType('nonexistent')).toBe('none')
    })

    it('should return string type', async () => {
      await storage.setString('key', 'value')
      expect(await storage.getType('key')).toBe('string')
    })

    it('should return hash type', async () => {
      await storage.hset('key', { field: 'value' })
      expect(await storage.getType('key')).toBe('hash')
    })

    it('should return list type', async () => {
      await storage.lpush('key', ['value'])
      expect(await storage.getType('key')).toBe('list')
    })

    it('should return set type', async () => {
      await storage.sadd('key', ['value'])
      expect(await storage.getType('key')).toBe('set')
    })

    it('should return zset type', async () => {
      await storage.zadd('key', [{ member: 'value', score: 1 }])
      expect(await storage.getType('key')).toBe('zset')
    })

    it('should check existence', async () => {
      expect(await storage.exists('key')).toBe(false)
      await storage.setString('key', 'value')
      expect(await storage.exists('key')).toBe(true)
    })

    it('should delete key', async () => {
      await storage.setString('key', 'value')
      expect(await storage.deleteKey('key')).toBe(true)
      expect(await storage.exists('key')).toBe(false)
    })

    it('should return false when deleting non-existent key', async () => {
      expect(await storage.deleteKey('nonexistent')).toBe(false)
    })
  })

  // ===========================================================================
  // STRING OPERATIONS
  // ===========================================================================

  describe('string operations', () => {
    describe('get/set', () => {
      it('should set and get string', async () => {
        await storage.setString('key', 'value')
        expect(await storage.getString('key')).toBe('value')
      })

      it('should return null for non-existent key', async () => {
        expect(await storage.getString('nonexistent')).toBeNull()
      })

      it('should overwrite existing value', async () => {
        await storage.setString('key', 'old')
        await storage.setString('key', 'new')
        expect(await storage.getString('key')).toBe('new')
      })

      it('should respect NX option', async () => {
        await storage.setString('key', 'old')
        const result = await storage.setString('key', 'new', { NX: true })
        expect(result).toBeNull()
        expect(await storage.getString('key')).toBe('old')
      })

      it('should set with NX when key does not exist', async () => {
        const result = await storage.setString('key', 'value', { NX: true })
        expect(result).toBe('OK')
        expect(await storage.getString('key')).toBe('value')
      })

      it('should respect XX option', async () => {
        const result = await storage.setString('key', 'value', { XX: true })
        expect(result).toBeNull()
        expect(await storage.getString('key')).toBeNull()
      })

      it('should set with XX when key exists', async () => {
        await storage.setString('key', 'old')
        const result = await storage.setString('key', 'new', { XX: true })
        expect(result).toBe('OK')
        expect(await storage.getString('key')).toBe('new')
      })

      it('should return old value with GET option', async () => {
        await storage.setString('key', 'old')
        const result = await storage.setString('key', 'new', { GET: true })
        expect(result).toBe('old')
      })

      it('should throw WRONGTYPE for wrong type', async () => {
        await storage.lpush('key', ['value'])
        await expect(storage.getString('key')).rejects.toThrow(ReplyError)
      })
    })

    describe('incr/decr', () => {
      it('should increment string as integer', async () => {
        await storage.setString('counter', '10')
        expect(await storage.incrString('counter', 1)).toBe(11)
      })

      it('should decrement string as integer', async () => {
        await storage.setString('counter', '10')
        expect(await storage.incrString('counter', -1)).toBe(9)
      })

      it('should increment by amount', async () => {
        await storage.setString('counter', '10')
        expect(await storage.incrString('counter', 5)).toBe(15)
      })

      it('should initialize to 0 for non-existent key', async () => {
        expect(await storage.incrString('counter', 1)).toBe(1)
      })

      it('should throw for non-integer value', async () => {
        await storage.setString('key', 'hello')
        await expect(storage.incrString('key', 1)).rejects.toThrow(ReplyError)
      })

      it('should increment by float', async () => {
        await storage.setString('counter', '10.5')
        const result = await storage.incrFloatString('counter', 0.1)
        expect(parseFloat(result)).toBeCloseTo(10.6)
      })
    })

    describe('append', () => {
      it('should append to existing string', async () => {
        await storage.setString('key', 'Hello')
        expect(await storage.appendString('key', ' World')).toBe(11)
        expect(await storage.getString('key')).toBe('Hello World')
      })

      it('should append to non-existent key', async () => {
        expect(await storage.appendString('key', 'value')).toBe(5)
        expect(await storage.getString('key')).toBe('value')
      })
    })
  })

  // ===========================================================================
  // HASH OPERATIONS
  // ===========================================================================

  describe('hash operations', () => {
    describe('hget/hset', () => {
      it('should set and get hash field', async () => {
        await storage.hset('hash', { field: 'value' })
        expect(await storage.hget('hash', 'field')).toBe('value')
      })

      it('should return null for non-existent field', async () => {
        expect(await storage.hget('hash', 'field')).toBeNull()
      })

      it('should return count of new fields', async () => {
        expect(await storage.hset('hash', { f1: 'v1', f2: 'v2' })).toBe(2)
        expect(await storage.hset('hash', { f2: 'v2new', f3: 'v3' })).toBe(1)
      })
    })

    describe('hgetall', () => {
      it('should get all fields', async () => {
        await storage.hset('hash', { f1: 'v1', f2: 'v2' })
        expect(await storage.hgetall('hash')).toEqual({ f1: 'v1', f2: 'v2' })
      })

      it('should return empty object for non-existent hash', async () => {
        expect(await storage.hgetall('nonexistent')).toEqual({})
      })
    })

    describe('hdel', () => {
      it('should delete fields', async () => {
        await storage.hset('hash', { f1: 'v1', f2: 'v2', f3: 'v3' })
        expect(await storage.hdel('hash', ['f1', 'f2'])).toBe(2)
        expect(await storage.hgetall('hash')).toEqual({ f3: 'v3' })
      })

      it('should return 0 for non-existent hash', async () => {
        expect(await storage.hdel('nonexistent', ['field'])).toBe(0)
      })
    })

    describe('hexists/hlen/hkeys/hvals', () => {
      beforeEach(async () => {
        await storage.hset('hash', { f1: 'v1', f2: 'v2' })
      })

      it('should check field existence', async () => {
        expect(await storage.hexists('hash', 'f1')).toBe(1)
        expect(await storage.hexists('hash', 'f3')).toBe(0)
      })

      it('should get field count', async () => {
        expect(await storage.hlen('hash')).toBe(2)
      })

      it('should get all field names', async () => {
        const keys = await storage.hkeys('hash')
        expect(keys.sort()).toEqual(['f1', 'f2'])
      })

      it('should get all values', async () => {
        const vals = await storage.hvals('hash')
        expect(vals.sort()).toEqual(['v1', 'v2'])
      })
    })

    describe('hincrby/hincrbyfloat', () => {
      it('should increment hash field by integer', async () => {
        await storage.hset('hash', { counter: '10' })
        expect(await storage.hincrby('hash', 'counter', 5)).toBe(15)
      })

      it('should increment hash field by float', async () => {
        await storage.hset('hash', { counter: '10.5' })
        const result = await storage.hincrbyfloat('hash', 'counter', 0.1)
        expect(parseFloat(result)).toBeCloseTo(10.6)
      })

      it('should create field if not exists', async () => {
        expect(await storage.hincrby('hash', 'counter', 5)).toBe(5)
      })
    })

    describe('hsetnx', () => {
      it('should set field only if not exists', async () => {
        expect(await storage.hsetnx('hash', 'field', 'value')).toBe(1)
        expect(await storage.hsetnx('hash', 'field', 'new')).toBe(0)
        expect(await storage.hget('hash', 'field')).toBe('value')
      })
    })
  })

  // ===========================================================================
  // LIST OPERATIONS
  // ===========================================================================

  describe('list operations', () => {
    describe('lpush/rpush', () => {
      it('should lpush to head', async () => {
        expect(await storage.lpush('list', ['a', 'b', 'c'])).toBe(3)
        expect(await storage.lrange('list', 0, -1)).toEqual(['c', 'b', 'a'])
      })

      it('should rpush to tail', async () => {
        expect(await storage.rpush('list', ['a', 'b', 'c'])).toBe(3)
        expect(await storage.lrange('list', 0, -1)).toEqual(['a', 'b', 'c'])
      })
    })

    describe('lpop/rpop', () => {
      beforeEach(async () => {
        await storage.rpush('list', ['a', 'b', 'c'])
      })

      it('should lpop from head', async () => {
        expect(await storage.lpop('list')).toBe('a')
        expect(await storage.lrange('list', 0, -1)).toEqual(['b', 'c'])
      })

      it('should rpop from tail', async () => {
        expect(await storage.rpop('list')).toBe('c')
        expect(await storage.lrange('list', 0, -1)).toEqual(['a', 'b'])
      })

      it('should lpop with count', async () => {
        expect(await storage.lpop('list', 2)).toEqual(['a', 'b'])
      })

      it('should return null for empty list', async () => {
        expect(await storage.lpop('empty')).toBeNull()
      })
    })

    describe('lrange', () => {
      beforeEach(async () => {
        await storage.rpush('list', ['a', 'b', 'c', 'd', 'e'])
      })

      it('should get range', async () => {
        expect(await storage.lrange('list', 1, 3)).toEqual(['b', 'c', 'd'])
      })

      it('should handle negative indexes', async () => {
        expect(await storage.lrange('list', -3, -1)).toEqual(['c', 'd', 'e'])
      })

      it('should return empty for non-existent list', async () => {
        expect(await storage.lrange('nonexistent', 0, -1)).toEqual([])
      })
    })

    describe('llen/lindex/lset', () => {
      beforeEach(async () => {
        await storage.rpush('list', ['a', 'b', 'c'])
      })

      it('should get list length', async () => {
        expect(await storage.llen('list')).toBe(3)
      })

      it('should get element at index', async () => {
        expect(await storage.lindex('list', 1)).toBe('b')
        expect(await storage.lindex('list', -1)).toBe('c')
      })

      it('should set element at index', async () => {
        await storage.lset('list', 1, 'B')
        expect(await storage.lindex('list', 1)).toBe('B')
      })

      it('should throw for out of range index', async () => {
        await expect(storage.lset('list', 10, 'x')).rejects.toThrow(ReplyError)
      })
    })

    describe('lrem/ltrim', () => {
      it('should remove elements by value', async () => {
        await storage.rpush('list', ['a', 'b', 'a', 'c', 'a'])
        expect(await storage.lrem('list', 2, 'a')).toBe(2)
        expect(await storage.lrange('list', 0, -1)).toEqual(['b', 'c', 'a'])
      })

      it('should trim list', async () => {
        await storage.rpush('list', ['a', 'b', 'c', 'd', 'e'])
        await storage.ltrim('list', 1, 3)
        expect(await storage.lrange('list', 0, -1)).toEqual(['b', 'c', 'd'])
      })
    })

    describe('linsert/lpos', () => {
      it('should insert before pivot', async () => {
        await storage.rpush('list', ['a', 'c'])
        await storage.linsert('list', 'BEFORE', 'c', 'b')
        expect(await storage.lrange('list', 0, -1)).toEqual(['a', 'b', 'c'])
      })

      it('should insert after pivot', async () => {
        await storage.rpush('list', ['a', 'c'])
        await storage.linsert('list', 'AFTER', 'a', 'b')
        expect(await storage.lrange('list', 0, -1)).toEqual(['a', 'b', 'c'])
      })

      it('should find position of element', async () => {
        await storage.rpush('list', ['a', 'b', 'c', 'b', 'd'])
        expect(await storage.lpos('list', 'b')).toBe(1)
      })
    })
  })

  // ===========================================================================
  // SET OPERATIONS
  // ===========================================================================

  describe('set operations', () => {
    describe('sadd/srem/smembers', () => {
      it('should add members', async () => {
        expect(await storage.sadd('set', ['a', 'b', 'c'])).toBe(3)
      })

      it('should not add duplicates', async () => {
        await storage.sadd('set', ['a', 'b'])
        expect(await storage.sadd('set', ['b', 'c'])).toBe(1)
      })

      it('should remove members', async () => {
        await storage.sadd('set', ['a', 'b', 'c'])
        expect(await storage.srem('set', ['a', 'b'])).toBe(2)
      })

      it('should get all members', async () => {
        await storage.sadd('set', ['a', 'b', 'c'])
        expect((await storage.smembers('set')).sort()).toEqual(['a', 'b', 'c'])
      })
    })

    describe('sismember/smismember', () => {
      beforeEach(async () => {
        await storage.sadd('set', ['a', 'b'])
      })

      it('should check member existence', async () => {
        expect(await storage.sismember('set', 'a')).toBe(1)
        expect(await storage.sismember('set', 'c')).toBe(0)
      })

      it('should check multiple members', async () => {
        expect(await storage.smismember('set', ['a', 'c', 'b'])).toEqual([1, 0, 1])
      })
    })

    describe('scard', () => {
      it('should get cardinality', async () => {
        await storage.sadd('set', ['a', 'b', 'c'])
        expect(await storage.scard('set')).toBe(3)
      })
    })

    describe('sinter/sunion/sdiff', () => {
      beforeEach(async () => {
        await storage.sadd('set1', ['a', 'b', 'c'])
        await storage.sadd('set2', ['b', 'c', 'd'])
      })

      it('should get intersection', async () => {
        expect((await storage.sinter(['set1', 'set2'])).sort()).toEqual(['b', 'c'])
      })

      it('should get union', async () => {
        expect((await storage.sunion(['set1', 'set2'])).sort()).toEqual(['a', 'b', 'c', 'd'])
      })

      it('should get difference', async () => {
        expect(await storage.sdiff(['set1', 'set2'])).toEqual(['a'])
      })
    })

    describe('srandmember/spop/smove', () => {
      beforeEach(async () => {
        await storage.sadd('set', ['a', 'b', 'c'])
      })

      it('should get random member', async () => {
        const member = await storage.srandmember('set')
        expect(['a', 'b', 'c']).toContain(member)
      })

      it('should pop random member', async () => {
        const member = await storage.spop('set')
        expect(['a', 'b', 'c']).toContain(member)
        expect(await storage.scard('set')).toBe(2)
      })

      it('should move member between sets', async () => {
        await storage.sadd('dst', ['d'])
        expect(await storage.smove('set', 'dst', 'a')).toBe(1)
        expect(await storage.sismember('set', 'a')).toBe(0)
        expect(await storage.sismember('dst', 'a')).toBe(1)
      })
    })
  })

  // ===========================================================================
  // SORTED SET OPERATIONS
  // ===========================================================================

  describe('sorted set operations', () => {
    describe('zadd/zrem', () => {
      it('should add members with scores', async () => {
        expect(await storage.zadd('zset', [
          { member: 'a', score: 1 },
          { member: 'b', score: 2 },
          { member: 'c', score: 3 },
        ])).toBe(3)
      })

      it('should update score if member exists', async () => {
        await storage.zadd('zset', [{ member: 'a', score: 1 }])
        expect(await storage.zadd('zset', [{ member: 'a', score: 2 }])).toBe(0)
        expect(await storage.zscore('zset', 'a')).toBe('2')
      })

      it('should respect NX option', async () => {
        await storage.zadd('zset', [{ member: 'a', score: 1 }])
        await storage.zadd('zset', [{ member: 'a', score: 2 }, { member: 'b', score: 3 }], { NX: true })
        expect(await storage.zscore('zset', 'a')).toBe('1')
        expect(await storage.zscore('zset', 'b')).toBe('3')
      })

      it('should respect XX option', async () => {
        await storage.zadd('zset', [{ member: 'a', score: 1 }])
        await storage.zadd('zset', [{ member: 'a', score: 2 }, { member: 'b', score: 3 }], { XX: true })
        expect(await storage.zscore('zset', 'a')).toBe('2')
        expect(await storage.zscore('zset', 'b')).toBeNull()
      })

      it('should remove members', async () => {
        await storage.zadd('zset', [
          { member: 'a', score: 1 },
          { member: 'b', score: 2 },
          { member: 'c', score: 3 },
        ])
        expect(await storage.zrem('zset', ['a', 'b'])).toBe(2)
      })
    })

    describe('zrange/zrevrange', () => {
      beforeEach(async () => {
        await storage.zadd('zset', [
          { member: 'a', score: 1 },
          { member: 'b', score: 2 },
          { member: 'c', score: 3 },
          { member: 'd', score: 4 },
          { member: 'e', score: 5 },
        ])
      })

      it('should get range by index', async () => {
        expect(await storage.zrange('zset', 0, 2)).toEqual(['a', 'b', 'c'])
      })

      it('should get range with WITHSCORES', async () => {
        expect(await storage.zrange('zset', 0, 1, { WITHSCORES: true })).toEqual(['a', '1', 'b', '2'])
      })

      it('should get reversed range', async () => {
        expect(await storage.zrevrange('zset', 0, 2)).toEqual(['e', 'd', 'c'])
      })

      it('should handle negative indexes', async () => {
        expect(await storage.zrange('zset', -3, -1)).toEqual(['c', 'd', 'e'])
      })
    })

    describe('zscore/zrank/zrevrank', () => {
      beforeEach(async () => {
        await storage.zadd('zset', [
          { member: 'a', score: 1 },
          { member: 'b', score: 2 },
          { member: 'c', score: 3 },
        ])
      })

      it('should get score', async () => {
        expect(await storage.zscore('zset', 'b')).toBe('2')
      })

      it('should return null for non-existent member', async () => {
        expect(await storage.zscore('zset', 'x')).toBeNull()
      })

      it('should get rank', async () => {
        expect(await storage.zrank('zset', 'b')).toBe(1)
      })

      it('should get reverse rank', async () => {
        expect(await storage.zrevrank('zset', 'b')).toBe(1)
      })
    })

    describe('zcard/zcount', () => {
      beforeEach(async () => {
        await storage.zadd('zset', [
          { member: 'a', score: 1 },
          { member: 'b', score: 2 },
          { member: 'c', score: 3 },
          { member: 'd', score: 4 },
          { member: 'e', score: 5 },
        ])
      })

      it('should get cardinality', async () => {
        expect(await storage.zcard('zset')).toBe(5)
      })

      it('should count members in score range', async () => {
        expect(await storage.zcount('zset', 2, 4)).toBe(3)
      })

      it('should handle -inf/+inf', async () => {
        expect(await storage.zcount('zset', '-inf', '+inf')).toBe(5)
      })
    })

    describe('zincrby', () => {
      it('should increment score', async () => {
        await storage.zadd('zset', [{ member: 'a', score: 1 }])
        expect(await storage.zincrby('zset', 2, 'a')).toBe('3')
      })

      it('should create member if not exists', async () => {
        expect(await storage.zincrby('zset', 5, 'a')).toBe('5')
      })
    })

    describe('zrangebyscore/zrevrangebyscore', () => {
      beforeEach(async () => {
        await storage.zadd('zset', [
          { member: 'a', score: 1 },
          { member: 'b', score: 2 },
          { member: 'c', score: 3 },
          { member: 'd', score: 4 },
          { member: 'e', score: 5 },
        ])
      })

      it('should get range by score', async () => {
        expect(await storage.zrangebyscore('zset', 2, 4)).toEqual(['b', 'c', 'd'])
      })

      it('should get reversed range by score', async () => {
        expect(await storage.zrevrangebyscore('zset', 4, 2)).toEqual(['d', 'c', 'b'])
      })

      it('should support LIMIT', async () => {
        expect(await storage.zrangebyscore('zset', 1, 5, { LIMIT: { offset: 1, count: 2 } })).toEqual(['b', 'c'])
      })
    })

    describe('zpopmin/zpopmax', () => {
      beforeEach(async () => {
        await storage.zadd('zset', [
          { member: 'a', score: 1 },
          { member: 'b', score: 2 },
          { member: 'c', score: 3 },
        ])
      })

      it('should pop minimum', async () => {
        expect(await storage.zpopmin('zset')).toEqual(['a', '1'])
      })

      it('should pop multiple minimums', async () => {
        expect(await storage.zpopmin('zset', 2)).toEqual(['a', '1', 'b', '2'])
      })

      it('should pop maximum', async () => {
        expect(await storage.zpopmax('zset')).toEqual(['c', '3'])
      })
    })
  })

  // ===========================================================================
  // KEY OPERATIONS
  // ===========================================================================

  describe('key operations', () => {
    describe('rename', () => {
      it('should rename key', async () => {
        await storage.setString('old', 'value')
        await storage.rename('old', 'new')
        expect(await storage.getString('old')).toBeNull()
        expect(await storage.getString('new')).toBe('value')
      })

      it('should throw for non-existent key', async () => {
        await expect(storage.rename('nonexistent', 'new')).rejects.toThrow(ReplyError)
      })
    })

    describe('copy', () => {
      it('should copy key', async () => {
        await storage.setString('src', 'value')
        expect(await storage.copy('src', 'dst')).toBe(true)
        expect(await storage.getString('dst')).toBe('value')
      })

      it('should not copy if destination exists without replace', async () => {
        await storage.setString('src', 'v1')
        await storage.setString('dst', 'v2')
        expect(await storage.copy('src', 'dst')).toBe(false)
        expect(await storage.getString('dst')).toBe('v2')
      })

      it('should copy with replace', async () => {
        await storage.setString('src', 'v1')
        await storage.setString('dst', 'v2')
        expect(await storage.copy('src', 'dst', true)).toBe(true)
        expect(await storage.getString('dst')).toBe('v1')
      })

      it('should deep copy complex types', async () => {
        await storage.hset('src', { f1: 'v1', f2: 'v2' })
        await storage.copy('src', 'dst')

        // Modify source
        await storage.hset('src', { f1: 'modified' })

        // Destination should be unchanged
        expect(await storage.hget('dst', 'f1')).toBe('v1')
      })
    })
  })

  // ===========================================================================
  // VERSION TRACKING
  // ===========================================================================

  describe('version tracking', () => {
    it('should track key versions', async () => {
      const v1 = storage.getVersion('key')
      await storage.setString('key', 'value1')
      const v2 = storage.getVersion('key')
      await storage.setString('key', 'value2')
      const v3 = storage.getVersion('key')

      expect(v2).toBeGreaterThan(v1)
      expect(v3).toBeGreaterThan(v2)
    })
  })

  // ===========================================================================
  // PARTITION ROUTING
  // ===========================================================================

  describe('partition routing', () => {
    it('should consistently route same key', () => {
      const storage = createPrimitiveStorage({ partitionCount: 8 })
      const partition1 = storage.getPartition('mykey')
      const partition2 = storage.getPartition('mykey')
      expect(partition1).toBe(partition2)
    })

    it('should distribute keys across partitions', () => {
      const storage = createPrimitiveStorage({ partitionCount: 8 })
      const partitions = new Map<number, number>()

      for (let i = 0; i < 1000; i++) {
        const p = storage.getPartition(`key${i}`)
        partitions.set(p, (partitions.get(p) ?? 0) + 1)
      }

      // Should use all partitions
      expect(partitions.size).toBe(8)

      // Should be roughly evenly distributed (each should have ~125 keys)
      for (const [, count] of partitions) {
        expect(count).toBeGreaterThan(50)
        expect(count).toBeLessThan(250)
      }
    })
  })

  // ===========================================================================
  // TIME-TRAVEL (Snapshot) OPERATIONS
  // ===========================================================================

  describe('time-travel operations', () => {
    it('should create and list snapshots', async () => {
      await storage.setString('key', 'value1')
      const snapshotId = await storage.createSnapshot()

      const snapshots = await storage.listSnapshots()
      expect(snapshots.find((s) => s.id === snapshotId)).toBeDefined()
    })

    it('should restore from snapshot', async () => {
      await storage.setString('key', 'value1')
      const snapshotId = await storage.createSnapshot()

      await storage.setString('key', 'value2')
      expect(await storage.getString('key')).toBe('value2')

      await storage.restoreSnapshot(snapshotId)
      expect(await storage.getString('key')).toBe('value1')
    })

    it('should throw for time-travel queries when disabled', async () => {
      const s = createPrimitiveStorage({ enableTimeTravel: false })
      await s.setString('key', 'value')

      await expect(s.getAsOf('key', Date.now())).rejects.toThrow('Time-travel queries not enabled')
    })

    it('should support time-travel queries when enabled', async () => {
      const s = createPrimitiveStorage({ enableTimeTravel: true })
      await s.setString('key', 'value1')
      const t1 = Date.now()

      await new Promise((r) => setTimeout(r, 10))
      await s.setString('key', 'value2')

      // Note: getAsOf returns StoredValue wrapper
      const result = await s.getAsOf('key', t1)
      expect(result?.data).toBe('value1')
    })
  })

  // ===========================================================================
  // TYPE SAFETY
  // ===========================================================================

  describe('type safety', () => {
    it('should throw WRONGTYPE for string operations on hash', async () => {
      await storage.hset('key', { field: 'value' })
      await expect(storage.getString('key')).rejects.toThrow(ReplyError)
      await expect(storage.incrString('key', 1)).rejects.toThrow(ReplyError)
    })

    it('should throw WRONGTYPE for hash operations on string', async () => {
      await storage.setString('key', 'value')
      await expect(storage.hget('key', 'field')).rejects.toThrow(ReplyError)
    })

    it('should throw WRONGTYPE for list operations on set', async () => {
      await storage.sadd('key', ['member'])
      await expect(storage.lpush('key', ['value'])).rejects.toThrow(ReplyError)
    })

    it('should throw WRONGTYPE for set operations on list', async () => {
      await storage.lpush('key', ['value'])
      await expect(storage.sadd('key', ['member'])).rejects.toThrow(ReplyError)
    })

    it('should throw WRONGTYPE for zset operations on set', async () => {
      await storage.sadd('key', ['member'])
      await expect(storage.zadd('key', [{ member: 'a', score: 1 }])).rejects.toThrow(ReplyError)
    })
  })
})
