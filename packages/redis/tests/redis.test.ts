/**
 * @dotdo/redis Tests
 * Red-green-refactor: These tests define the expected behavior
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Redis } from '../src/index'

describe('@dotdo/redis', () => {
  let redis: Redis

  beforeEach(() => {
    redis = new Redis()
  })

  describe('String Commands', () => {
    describe('GET', () => {
      it('returns null for non-existent key', async () => {
        expect(await redis.get('nonexistent')).toBe(null)
      })

      it('returns the value for existing key', async () => {
        await redis.set('mykey', 'myvalue')
        expect(await redis.get('mykey')).toBe('myvalue')
      })
    })

    describe('SET', () => {
      it('sets a value and returns OK', async () => {
        expect(await redis.set('key', 'value')).toBe('OK')
        expect(await redis.get('key')).toBe('value')
      })

      it('overwrites existing value', async () => {
        await redis.set('key', 'value1')
        await redis.set('key', 'value2')
        expect(await redis.get('key')).toBe('value2')
      })

      it('supports NX option (set only if not exists)', async () => {
        await redis.set('key', 'value1')
        const result = await redis.set('key', 'value2', { nx: true })
        expect(result).toBe(null)
        expect(await redis.get('key')).toBe('value1')
      })

      it('supports XX option (set only if exists)', async () => {
        const result = await redis.set('newkey', 'value', { xx: true })
        expect(result).toBe(null)
        expect(await redis.get('newkey')).toBe(null)
      })
    })

    describe('INCR', () => {
      it('increments existing integer value', async () => {
        await redis.set('counter', '10')
        expect(await redis.incr('counter')).toBe(11)
        expect(await redis.get('counter')).toBe('11')
      })

      it('initializes to 1 for non-existent key', async () => {
        expect(await redis.incr('newcounter')).toBe(1)
        expect(await redis.get('newcounter')).toBe('1')
      })

      it('throws on non-integer value', async () => {
        await redis.set('str', 'hello')
        await expect(redis.incr('str')).rejects.toThrow()
      })
    })

    describe('DECR', () => {
      it('decrements existing integer value', async () => {
        await redis.set('counter', '10')
        expect(await redis.decr('counter')).toBe(9)
      })

      it('initializes to -1 for non-existent key', async () => {
        expect(await redis.decr('newcounter')).toBe(-1)
      })
    })

    describe('INCRBY', () => {
      it('increments by specified amount', async () => {
        await redis.set('counter', '10')
        expect(await redis.incrby('counter', 5)).toBe(15)
      })
    })

    describe('MGET', () => {
      it('returns values for multiple keys', async () => {
        await redis.set('key1', 'value1')
        await redis.set('key2', 'value2')
        expect(await redis.mget(['key1', 'key2', 'key3'])).toEqual(['value1', 'value2', null])
      })
    })

    describe('MSET', () => {
      it('sets multiple key-value pairs', async () => {
        expect(await redis.mset([['key1', 'value1'], ['key2', 'value2']])).toBe('OK')
        expect(await redis.get('key1')).toBe('value1')
        expect(await redis.get('key2')).toBe('value2')
      })
    })

    describe('APPEND', () => {
      it('appends to existing value', async () => {
        await redis.set('key', 'Hello')
        expect(await redis.append('key', ' World')).toBe(11)
        expect(await redis.get('key')).toBe('Hello World')
      })

      it('creates key if not exists', async () => {
        expect(await redis.append('newkey', 'value')).toBe(5)
        expect(await redis.get('newkey')).toBe('value')
      })
    })

    describe('STRLEN', () => {
      it('returns length of string value', async () => {
        await redis.set('key', 'Hello World')
        expect(await redis.strlen('key')).toBe(11)
      })

      it('returns 0 for non-existent key', async () => {
        expect(await redis.strlen('nonexistent')).toBe(0)
      })
    })
  })

  describe('Hash Commands', () => {
    describe('HGET/HSET', () => {
      it('sets and gets hash field', async () => {
        await redis.hset('myhash', [['field1', 'value1']])
        expect(await redis.hget('myhash', 'field1')).toBe('value1')
      })

      it('returns null for non-existent field', async () => {
        await redis.hset('myhash', [['field1', 'value1']])
        expect(await redis.hget('myhash', 'nonexistent')).toBe(null)
      })

      it('returns count of new fields added', async () => {
        expect(await redis.hset('myhash', [['f1', 'v1'], ['f2', 'v2']])).toBe(2)
        expect(await redis.hset('myhash', [['f1', 'newv1'], ['f3', 'v3']])).toBe(1)
      })
    })

    describe('HMGET', () => {
      it('gets multiple hash fields', async () => {
        await redis.hset('myhash', [['f1', 'v1'], ['f2', 'v2']])
        expect(await redis.hmget('myhash', ['f1', 'f2', 'f3'])).toEqual(['v1', 'v2', null])
      })
    })

    describe('HGETALL', () => {
      it('returns all fields and values', async () => {
        await redis.hset('myhash', [['f1', 'v1'], ['f2', 'v2']])
        expect(await redis.hgetall('myhash')).toEqual({ f1: 'v1', f2: 'v2' })
      })

      it('returns empty object for non-existent key', async () => {
        expect(await redis.hgetall('nonexistent')).toEqual({})
      })
    })

    describe('HDEL', () => {
      it('deletes hash fields', async () => {
        await redis.hset('myhash', [['f1', 'v1'], ['f2', 'v2'], ['f3', 'v3']])
        expect(await redis.hdel('myhash', ['f1', 'f3', 'nonexistent'])).toBe(2)
        expect(await redis.hget('myhash', 'f1')).toBe(null)
        expect(await redis.hget('myhash', 'f2')).toBe('v2')
      })
    })

    describe('HEXISTS', () => {
      it('returns 1 if field exists', async () => {
        await redis.hset('myhash', [['f1', 'v1']])
        expect(await redis.hexists('myhash', 'f1')).toBe(1)
      })

      it('returns 0 if field does not exist', async () => {
        await redis.hset('myhash', [['f1', 'v1']])
        expect(await redis.hexists('myhash', 'nonexistent')).toBe(0)
      })
    })

    describe('HLEN', () => {
      it('returns number of fields', async () => {
        await redis.hset('myhash', [['f1', 'v1'], ['f2', 'v2']])
        expect(await redis.hlen('myhash')).toBe(2)
      })
    })

    describe('HKEYS/HVALS', () => {
      it('returns all field names', async () => {
        await redis.hset('myhash', [['f1', 'v1'], ['f2', 'v2']])
        expect(await redis.hkeys('myhash')).toEqual(expect.arrayContaining(['f1', 'f2']))
      })

      it('returns all values', async () => {
        await redis.hset('myhash', [['f1', 'v1'], ['f2', 'v2']])
        expect(await redis.hvals('myhash')).toEqual(expect.arrayContaining(['v1', 'v2']))
      })
    })

    describe('HINCRBY', () => {
      it('increments hash field by integer', async () => {
        await redis.hset('myhash', [['counter', '10']])
        expect(await redis.hincrby('myhash', 'counter', 5)).toBe(15)
      })

      it('initializes to increment for new field', async () => {
        expect(await redis.hincrby('myhash', 'newfield', 3)).toBe(3)
      })
    })
  })

  describe('List Commands', () => {
    describe('LPUSH/RPUSH', () => {
      it('LPUSH adds elements to head', async () => {
        expect(await redis.lpush('mylist', ['world'])).toBe(1)
        expect(await redis.lpush('mylist', ['hello'])).toBe(2)
        expect(await redis.lrange('mylist', 0, -1)).toEqual(['hello', 'world'])
      })

      it('RPUSH adds elements to tail', async () => {
        expect(await redis.rpush('mylist', ['hello'])).toBe(1)
        expect(await redis.rpush('mylist', ['world'])).toBe(2)
        expect(await redis.lrange('mylist', 0, -1)).toEqual(['hello', 'world'])
      })

      it('LPUSH adds multiple elements in reverse order', async () => {
        await redis.lpush('mylist', ['a', 'b', 'c'])
        expect(await redis.lrange('mylist', 0, -1)).toEqual(['c', 'b', 'a'])
      })
    })

    describe('LPOP/RPOP', () => {
      it('LPOP removes and returns head element', async () => {
        await redis.rpush('mylist', ['one', 'two', 'three'])
        expect(await redis.lpop('mylist')).toBe('one')
        expect(await redis.lrange('mylist', 0, -1)).toEqual(['two', 'three'])
      })

      it('RPOP removes and returns tail element', async () => {
        await redis.rpush('mylist', ['one', 'two', 'three'])
        expect(await redis.rpop('mylist')).toBe('three')
        expect(await redis.lrange('mylist', 0, -1)).toEqual(['one', 'two'])
      })

      it('returns null for empty list', async () => {
        expect(await redis.lpop('nonexistent')).toBe(null)
        expect(await redis.rpop('nonexistent')).toBe(null)
      })

      it('LPOP with count returns multiple elements', async () => {
        await redis.rpush('mylist', ['one', 'two', 'three', 'four'])
        expect(await redis.lpop('mylist', 2)).toEqual(['one', 'two'])
      })
    })

    describe('LRANGE', () => {
      it('returns range of elements', async () => {
        await redis.rpush('mylist', ['a', 'b', 'c', 'd', 'e'])
        expect(await redis.lrange('mylist', 0, 2)).toEqual(['a', 'b', 'c'])
        expect(await redis.lrange('mylist', -3, -1)).toEqual(['c', 'd', 'e'])
      })

      it('returns empty array for non-existent key', async () => {
        expect(await redis.lrange('nonexistent', 0, -1)).toEqual([])
      })
    })

    describe('LLEN', () => {
      it('returns list length', async () => {
        await redis.rpush('mylist', ['a', 'b', 'c'])
        expect(await redis.llen('mylist')).toBe(3)
      })

      it('returns 0 for non-existent key', async () => {
        expect(await redis.llen('nonexistent')).toBe(0)
      })
    })

    describe('LINDEX', () => {
      it('returns element at index', async () => {
        await redis.rpush('mylist', ['a', 'b', 'c'])
        expect(await redis.lindex('mylist', 1)).toBe('b')
        expect(await redis.lindex('mylist', -1)).toBe('c')
      })

      it('returns null for out of range index', async () => {
        await redis.rpush('mylist', ['a', 'b', 'c'])
        expect(await redis.lindex('mylist', 10)).toBe(null)
      })
    })

    describe('LSET', () => {
      it('sets element at index', async () => {
        await redis.rpush('mylist', ['a', 'b', 'c'])
        expect(await redis.lset('mylist', 1, 'B')).toBe('OK')
        expect(await redis.lindex('mylist', 1)).toBe('B')
      })

      it('throws for out of range index', async () => {
        await redis.rpush('mylist', ['a', 'b', 'c'])
        await expect(redis.lset('mylist', 10, 'x')).rejects.toThrow()
      })
    })
  })

  describe('Set Commands', () => {
    describe('SADD', () => {
      it('adds members to set', async () => {
        expect(await redis.sadd('myset', ['a', 'b', 'c'])).toBe(3)
        expect(await redis.sadd('myset', ['b', 'd'])).toBe(1) // b already exists
      })
    })

    describe('SMEMBERS', () => {
      it('returns all members', async () => {
        await redis.sadd('myset', ['a', 'b', 'c'])
        expect(await redis.smembers('myset')).toEqual(expect.arrayContaining(['a', 'b', 'c']))
      })

      it('returns empty array for non-existent key', async () => {
        expect(await redis.smembers('nonexistent')).toEqual([])
      })
    })

    describe('SREM', () => {
      it('removes members from set', async () => {
        await redis.sadd('myset', ['a', 'b', 'c'])
        expect(await redis.srem('myset', ['b', 'd'])).toBe(1) // only b was in set
        expect(await redis.smembers('myset')).toEqual(expect.arrayContaining(['a', 'c']))
      })
    })

    describe('SISMEMBER', () => {
      it('returns 1 if member exists', async () => {
        await redis.sadd('myset', ['a', 'b'])
        expect(await redis.sismember('myset', 'a')).toBe(1)
      })

      it('returns 0 if member does not exist', async () => {
        await redis.sadd('myset', ['a', 'b'])
        expect(await redis.sismember('myset', 'c')).toBe(0)
      })
    })

    describe('SCARD', () => {
      it('returns cardinality of set', async () => {
        await redis.sadd('myset', ['a', 'b', 'c'])
        expect(await redis.scard('myset')).toBe(3)
      })

      it('returns 0 for non-existent key', async () => {
        expect(await redis.scard('nonexistent')).toBe(0)
      })
    })

    describe('SINTER', () => {
      it('returns intersection of sets', async () => {
        await redis.sadd('set1', ['a', 'b', 'c'])
        await redis.sadd('set2', ['b', 'c', 'd'])
        await redis.sadd('set3', ['c', 'd', 'e'])
        expect(await redis.sinter(['set1', 'set2', 'set3'])).toEqual(['c'])
      })
    })

    describe('SUNION', () => {
      it('returns union of sets', async () => {
        await redis.sadd('set1', ['a', 'b'])
        await redis.sadd('set2', ['c', 'd'])
        const union = await redis.sunion(['set1', 'set2'])
        expect(union).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd']))
        expect(union.length).toBe(4)
      })
    })

    describe('SDIFF', () => {
      it('returns difference of sets', async () => {
        await redis.sadd('set1', ['a', 'b', 'c'])
        await redis.sadd('set2', ['b', 'c', 'd'])
        expect(await redis.sdiff(['set1', 'set2'])).toEqual(['a'])
      })
    })
  })

  describe('Key Commands', () => {
    describe('DEL', () => {
      it('deletes keys and returns count', async () => {
        await redis.set('key1', 'value1')
        await redis.set('key2', 'value2')
        expect(await redis.del(['key1', 'key2', 'nonexistent'])).toBe(2)
        expect(await redis.get('key1')).toBe(null)
      })
    })

    describe('EXISTS', () => {
      it('returns count of existing keys', async () => {
        await redis.set('key1', 'value1')
        await redis.set('key2', 'value2')
        expect(await redis.exists(['key1', 'key2', 'nonexistent'])).toBe(2)
      })
    })

    describe('EXPIRE/TTL', () => {
      it('sets expiration and returns TTL', async () => {
        await redis.set('key', 'value')
        expect(await redis.expire('key', 100)).toBe(1)
        const ttl = await redis.ttl('key')
        expect(ttl).toBeGreaterThan(0)
        expect(ttl).toBeLessThanOrEqual(100)
      })

      it('returns -2 for non-existent key', async () => {
        expect(await redis.ttl('nonexistent')).toBe(-2)
      })

      it('returns -1 for key without expiry', async () => {
        await redis.set('key', 'value')
        expect(await redis.ttl('key')).toBe(-1)
      })
    })

    describe('PEXPIRE/PTTL', () => {
      it('sets expiration in milliseconds', async () => {
        await redis.set('key', 'value')
        expect(await redis.pexpire('key', 10000)).toBe(1)
        const pttl = await redis.pttl('key')
        expect(pttl).toBeGreaterThan(0)
        expect(pttl).toBeLessThanOrEqual(10000)
      })
    })

    describe('TYPE', () => {
      it('returns type of value', async () => {
        await redis.set('string', 'value')
        await redis.hset('hash', [['f', 'v']])
        await redis.lpush('list', ['a'])
        await redis.sadd('set', ['a'])

        expect(await redis.type('string')).toBe('string')
        expect(await redis.type('hash')).toBe('hash')
        expect(await redis.type('list')).toBe('list')
        expect(await redis.type('set')).toBe('set')
        expect(await redis.type('nonexistent')).toBe('none')
      })
    })

    describe('KEYS', () => {
      it('returns keys matching pattern', async () => {
        await redis.set('user:1', 'a')
        await redis.set('user:2', 'b')
        await redis.set('admin:1', 'c')

        const userKeys = await redis.keys('user:*')
        expect(userKeys).toEqual(expect.arrayContaining(['user:1', 'user:2']))
        expect(userKeys.length).toBe(2)
      })

      it('returns all keys with wildcard', async () => {
        await redis.set('key1', 'a')
        await redis.set('key2', 'b')
        expect((await redis.keys('*')).length).toBe(2)
      })
    })

    describe('RENAME', () => {
      it('renames a key', async () => {
        await redis.set('oldkey', 'value')
        expect(await redis.rename('oldkey', 'newkey')).toBe('OK')
        expect(await redis.get('oldkey')).toBe(null)
        expect(await redis.get('newkey')).toBe('value')
      })

      it('throws if source key does not exist', async () => {
        await expect(redis.rename('nonexistent', 'newkey')).rejects.toThrow()
      })
    })

    describe('PERSIST', () => {
      it('removes expiration from key', async () => {
        await redis.set('key', 'value')
        await redis.expire('key', 100)
        expect(await redis.persist('key')).toBe(1)
        expect(await redis.ttl('key')).toBe(-1)
      })

      it('returns 0 if key has no expiry', async () => {
        await redis.set('key', 'value')
        expect(await redis.persist('key')).toBe(0)
      })
    })

    describe('FLUSHDB', () => {
      it('removes all keys', async () => {
        await redis.set('key1', 'value1')
        await redis.set('key2', 'value2')
        expect(await redis.flushdb()).toBe('OK')
        expect(await redis.keys('*')).toEqual([])
      })
    })
  })

  describe('WRONGTYPE errors', () => {
    it('throws when using string command on hash', async () => {
      await redis.hset('hash', [['f', 'v']])
      await expect(redis.get('hash')).rejects.toThrow('WRONGTYPE')
    })

    it('throws when using hash command on string', async () => {
      await redis.set('str', 'value')
      await expect(redis.hget('str', 'field')).rejects.toThrow('WRONGTYPE')
    })

    it('throws when using list command on set', async () => {
      await redis.sadd('myset', ['a'])
      await expect(redis.lpush('myset', ['b'])).rejects.toThrow('WRONGTYPE')
    })
  })
})
