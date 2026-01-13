/**
 * @dotdo/redis - Redis SDK compat tests
 *
 * Tests for ioredis/redis API compatibility backed by DO storage:
 * - String commands (get, set, incr, etc.)
 * - Hash commands (hget, hset, hgetall, etc.)
 * - List commands (lpush, rpush, lrange, etc.)
 * - Set commands (sadd, srem, smembers, etc.)
 * - Sorted Set commands (zadd, zrange, zscore, etc.)
 * - Key commands (del, exists, expire, ttl, etc.)
 * - Pub/Sub (publish, subscribe, psubscribe, etc.)
 * - Transactions (multi, exec, watch, etc.)
 * - Pipelines (pipeline().set().get().exec())
 *
 * @see https://redis.io/commands
 * @see https://github.com/redis/ioredis
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  Redis,
  RedisOptions,
  ExtendedRedisOptions,
  Pipeline,
  Multi,
  SetOptions,
  ZAddOptions,
} from './types'
import { RedisError, ReplyError, TransactionError } from './types'
import { createClient, Redis as RedisClient } from './redis'

// ============================================================================
// CLIENT CREATION TESTS
// ============================================================================

describe('createClient', () => {
  it('should create client with no options', () => {
    const client = createClient()
    expect(client).toBeDefined()
    expect(client.status).toBe('ready')
  })

  it('should create client with host and port', () => {
    const client = createClient({ host: 'localhost', port: 6379 })
    expect(client).toBeDefined()
  })

  it('should create client with URL', () => {
    const client = createClient({ url: 'redis://localhost:6379' })
    expect(client).toBeDefined()
  })

  it('should create client with URL containing auth', () => {
    const client = createClient({ url: 'redis://:password@localhost:6379' })
    expect(client).toBeDefined()
  })

  it('should create client with password', () => {
    const client = createClient({ password: 'secret' })
    expect(client).toBeDefined()
  })

  it('should create client with database number', () => {
    const client = createClient({ db: 1 })
    expect(client).toBeDefined()
  })

  it('should create client with key prefix', () => {
    const client = createClient({ keyPrefix: 'myapp:' })
    expect(client).toBeDefined()
  })

  it('should create client with lazyConnect', () => {
    const client = createClient({ lazyConnect: true })
    expect(client.status).toBe('wait')
  })

  it('should accept extended DO config', () => {
    const client = createClient({
      doNamespace: {} as DurableObjectNamespace,
      shard: { algorithm: 'consistent', count: 4 },
      replica: { readPreference: 'nearest' },
      storage: { preferKV: true },
    } as ExtendedRedisOptions)
    expect(client).toBeDefined()
  })
})

describe('Redis constructor', () => {
  it('should create with new Redis()', () => {
    const client = new RedisClient()
    expect(client).toBeDefined()
  })

  it('should create with new Redis(port, host)', () => {
    const client = new RedisClient(6379, 'localhost')
    expect(client).toBeDefined()
  })

  it('should create with new Redis(url)', () => {
    const client = new RedisClient('redis://localhost:6379')
    expect(client).toBeDefined()
  })

  it('should create with new Redis(options)', () => {
    const client = new RedisClient({ host: 'localhost', port: 6379 })
    expect(client).toBeDefined()
  })
})

// ============================================================================
// STRING COMMAND TESTS
// ============================================================================

describe('String commands', () => {
  let client: Redis

  beforeEach(async () => {
    client = createClient()
    await client.flushdb()
  })

  afterEach(async () => {
    await client.quit()
  })

  describe('GET/SET', () => {
    it('should set and get a value', async () => {
      await client.set('key', 'value')
      const result = await client.get('key')
      expect(result).toBe('value')
    })

    it('should return null for non-existent key', async () => {
      const result = await client.get('nonexistent')
      expect(result).toBeNull()
    })

    it('should set with EX option', async () => {
      await client.set('key', 'value', { EX: 10 })
      const ttl = await client.ttl('key')
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(10)
    })

    it('should set with PX option', async () => {
      await client.set('key', 'value', { PX: 10000 })
      const pttl = await client.pttl('key')
      expect(pttl).toBeGreaterThan(0)
      expect(pttl).toBeLessThanOrEqual(10000)
    })

    it('should set with NX option (key does not exist)', async () => {
      const result = await client.set('key', 'value', { NX: true })
      expect(result).toBe('OK')
    })

    it('should return null with NX option (key exists)', async () => {
      await client.set('key', 'original')
      const result = await client.set('key', 'new', { NX: true })
      expect(result).toBeNull()
      expect(await client.get('key')).toBe('original')
    })

    it('should set with XX option (key exists)', async () => {
      await client.set('key', 'original')
      const result = await client.set('key', 'new', { XX: true })
      expect(result).toBe('OK')
      expect(await client.get('key')).toBe('new')
    })

    it('should return null with XX option (key does not exist)', async () => {
      const result = await client.set('key', 'value', { XX: true })
      expect(result).toBeNull()
    })

    it('should set with GET option', async () => {
      await client.set('key', 'old')
      const result = await client.set('key', 'new', { GET: true })
      expect(result).toBe('old')
    })

    it('should set numeric value', async () => {
      await client.set('num', 42)
      const result = await client.get('num')
      expect(result).toBe('42')
    })

    it('should handle EX token syntax', async () => {
      await client.set('key', 'value', 'EX', 10)
      const ttl = await client.ttl('key')
      expect(ttl).toBeGreaterThan(0)
    })

    it('should handle NX token syntax', async () => {
      const result = await client.set('key', 'value', 'NX')
      expect(result).toBe('OK')
    })
  })

  describe('MGET/MSET', () => {
    it('should mset multiple keys', async () => {
      await client.mset('key1', 'value1', 'key2', 'value2')
      expect(await client.get('key1')).toBe('value1')
      expect(await client.get('key2')).toBe('value2')
    })

    it('should mset with object', async () => {
      await client.mset({ key1: 'value1', key2: 'value2' })
      expect(await client.get('key1')).toBe('value1')
      expect(await client.get('key2')).toBe('value2')
    })

    it('should mget multiple keys', async () => {
      await client.mset('key1', 'value1', 'key2', 'value2')
      const results = await client.mget('key1', 'key2', 'key3')
      expect(results).toEqual(['value1', 'value2', null])
    })
  })

  describe('INCR/DECR', () => {
    it('should increment a key', async () => {
      await client.set('counter', '10')
      const result = await client.incr('counter')
      expect(result).toBe(11)
    })

    it('should decrement a key', async () => {
      await client.set('counter', '10')
      const result = await client.decr('counter')
      expect(result).toBe(9)
    })

    it('should incrby amount', async () => {
      await client.set('counter', '10')
      const result = await client.incrby('counter', 5)
      expect(result).toBe(15)
    })

    it('should decrby amount', async () => {
      await client.set('counter', '10')
      const result = await client.decrby('counter', 3)
      expect(result).toBe(7)
    })

    it('should incrbyfloat', async () => {
      await client.set('counter', '10.5')
      const result = await client.incrbyfloat('counter', 0.1)
      expect(parseFloat(result)).toBeCloseTo(10.6)
    })

    it('should initialize non-existent key to 0 on incr', async () => {
      const result = await client.incr('newcounter')
      expect(result).toBe(1)
    })

    it('should throw on non-integer value', async () => {
      await client.set('str', 'hello')
      await expect(client.incr('str')).rejects.toThrow(ReplyError)
    })
  })

  describe('APPEND/STRLEN', () => {
    it('should append to string', async () => {
      await client.set('key', 'Hello')
      const len = await client.append('key', ' World')
      expect(len).toBe(11)
      expect(await client.get('key')).toBe('Hello World')
    })

    it('should append to non-existent key', async () => {
      const len = await client.append('newkey', 'value')
      expect(len).toBe(5)
    })

    it('should get string length', async () => {
      await client.set('key', 'hello')
      const len = await client.strlen('key')
      expect(len).toBe(5)
    })

    it('should return 0 for non-existent key', async () => {
      const len = await client.strlen('nonexistent')
      expect(len).toBe(0)
    })
  })

  describe('GETRANGE/SETRANGE', () => {
    it('should get substring', async () => {
      await client.set('key', 'Hello World')
      const result = await client.getrange('key', 0, 4)
      expect(result).toBe('Hello')
    })

    it('should handle negative index', async () => {
      await client.set('key', 'Hello World')
      const result = await client.getrange('key', -5, -1)
      expect(result).toBe('World')
    })

    it('should set substring', async () => {
      await client.set('key', 'Hello World')
      await client.setrange('key', 6, 'Redis')
      expect(await client.get('key')).toBe('Hello Redis')
    })
  })

  describe('SETNX/SETEX/PSETEX', () => {
    it('should setnx when key does not exist', async () => {
      const result = await client.setnx('key', 'value')
      expect(result).toBe(1)
    })

    it('should not setnx when key exists', async () => {
      await client.set('key', 'original')
      const result = await client.setnx('key', 'new')
      expect(result).toBe(0)
    })

    it('should setex with expiry', async () => {
      await client.setex('key', 10, 'value')
      const ttl = await client.ttl('key')
      expect(ttl).toBeGreaterThan(0)
    })

    it('should psetex with expiry in ms', async () => {
      await client.psetex('key', 10000, 'value')
      const pttl = await client.pttl('key')
      expect(pttl).toBeGreaterThan(0)
    })
  })

  describe('GETSET/GETDEL', () => {
    it('should getset (set and return old value)', async () => {
      await client.set('key', 'old')
      const result = await client.getset('key', 'new')
      expect(result).toBe('old')
      expect(await client.get('key')).toBe('new')
    })

    it('should getdel (get and delete)', async () => {
      await client.set('key', 'value')
      const result = await client.getdel('key')
      expect(result).toBe('value')
      expect(await client.get('key')).toBeNull()
    })
  })
})

// ============================================================================
// HASH COMMAND TESTS
// ============================================================================

describe('Hash commands', () => {
  let client: Redis

  beforeEach(async () => {
    client = createClient()
    await client.flushdb()
  })

  afterEach(async () => {
    await client.quit()
  })

  describe('HGET/HSET', () => {
    it('should hset and hget a field', async () => {
      await client.hset('hash', 'field', 'value')
      const result = await client.hget('hash', 'field')
      expect(result).toBe('value')
    })

    it('should return null for non-existent field', async () => {
      const result = await client.hget('hash', 'nonexistent')
      expect(result).toBeNull()
    })

    it('should hset multiple fields with object', async () => {
      await client.hset('hash', { field1: 'value1', field2: 'value2' })
      expect(await client.hget('hash', 'field1')).toBe('value1')
      expect(await client.hget('hash', 'field2')).toBe('value2')
    })

    it('should return number of fields added', async () => {
      const result = await client.hset('hash', 'field', 'value')
      expect(result).toBe(1)

      const result2 = await client.hset('hash', 'field', 'newvalue')
      expect(result2).toBe(0) // Field already existed
    })
  })

  describe('HMGET/HMSET', () => {
    it('should hmset multiple fields', async () => {
      await client.hmset('hash', { field1: 'value1', field2: 'value2' })
      expect(await client.hget('hash', 'field1')).toBe('value1')
    })

    it('should hmget multiple fields', async () => {
      await client.hmset('hash', { field1: 'value1', field2: 'value2' })
      const results = await client.hmget('hash', 'field1', 'field2', 'field3')
      expect(results).toEqual(['value1', 'value2', null])
    })
  })

  describe('HGETALL', () => {
    it('should get all fields and values', async () => {
      await client.hmset('hash', { field1: 'value1', field2: 'value2' })
      const result = await client.hgetall('hash')
      expect(result).toEqual({ field1: 'value1', field2: 'value2' })
    })

    it('should return empty object for non-existent hash', async () => {
      const result = await client.hgetall('nonexistent')
      expect(result).toEqual({})
    })
  })

  describe('HDEL/HEXISTS', () => {
    it('should delete fields', async () => {
      await client.hmset('hash', { f1: 'v1', f2: 'v2', f3: 'v3' })
      const deleted = await client.hdel('hash', 'f1', 'f2')
      expect(deleted).toBe(2)
    })

    it('should check if field exists', async () => {
      await client.hset('hash', 'field', 'value')
      expect(await client.hexists('hash', 'field')).toBe(1)
      expect(await client.hexists('hash', 'nonexistent')).toBe(0)
    })
  })

  describe('HKEYS/HVALS/HLEN', () => {
    it('should get all field names', async () => {
      await client.hmset('hash', { f1: 'v1', f2: 'v2' })
      const keys = await client.hkeys('hash')
      expect(keys.sort()).toEqual(['f1', 'f2'])
    })

    it('should get all values', async () => {
      await client.hmset('hash', { f1: 'v1', f2: 'v2' })
      const vals = await client.hvals('hash')
      expect(vals.sort()).toEqual(['v1', 'v2'])
    })

    it('should get hash length', async () => {
      await client.hmset('hash', { f1: 'v1', f2: 'v2', f3: 'v3' })
      const len = await client.hlen('hash')
      expect(len).toBe(3)
    })
  })

  describe('HINCRBY/HINCRBYFLOAT', () => {
    it('should increment hash field by integer', async () => {
      await client.hset('hash', 'counter', '10')
      const result = await client.hincrby('hash', 'counter', 5)
      expect(result).toBe(15)
    })

    it('should increment hash field by float', async () => {
      await client.hset('hash', 'counter', '10.5')
      const result = await client.hincrbyfloat('hash', 'counter', 0.1)
      expect(parseFloat(result)).toBeCloseTo(10.6)
    })

    it('should create field if not exists on hincrby', async () => {
      const result = await client.hincrby('hash', 'newfield', 5)
      expect(result).toBe(5)
    })
  })

  describe('HSETNX', () => {
    it('should set field only if not exists', async () => {
      expect(await client.hsetnx('hash', 'field', 'value')).toBe(1)
      expect(await client.hsetnx('hash', 'field', 'newvalue')).toBe(0)
      expect(await client.hget('hash', 'field')).toBe('value')
    })
  })
})

// ============================================================================
// LIST COMMAND TESTS
// ============================================================================

describe('List commands', () => {
  let client: Redis

  beforeEach(async () => {
    client = createClient()
    await client.flushdb()
  })

  afterEach(async () => {
    await client.quit()
  })

  describe('LPUSH/RPUSH', () => {
    it('should lpush to list', async () => {
      const len = await client.lpush('list', 'c', 'b', 'a')
      expect(len).toBe(3)
      const result = await client.lrange('list', 0, -1)
      expect(result).toEqual(['a', 'b', 'c'])
    })

    it('should rpush to list', async () => {
      const len = await client.rpush('list', 'a', 'b', 'c')
      expect(len).toBe(3)
      const result = await client.lrange('list', 0, -1)
      expect(result).toEqual(['a', 'b', 'c'])
    })
  })

  describe('LPOP/RPOP', () => {
    it('should lpop from list', async () => {
      await client.rpush('list', 'a', 'b', 'c')
      const result = await client.lpop('list')
      expect(result).toBe('a')
    })

    it('should rpop from list', async () => {
      await client.rpush('list', 'a', 'b', 'c')
      const result = await client.rpop('list')
      expect(result).toBe('c')
    })

    it('should lpop with count', async () => {
      await client.rpush('list', 'a', 'b', 'c')
      const result = await client.lpop('list', 2)
      expect(result).toEqual(['a', 'b'])
    })

    it('should return null for empty list', async () => {
      const result = await client.lpop('empty')
      expect(result).toBeNull()
    })
  })

  describe('LRANGE', () => {
    it('should get range of elements', async () => {
      await client.rpush('list', 'a', 'b', 'c', 'd', 'e')
      const result = await client.lrange('list', 1, 3)
      expect(result).toEqual(['b', 'c', 'd'])
    })

    it('should handle negative indexes', async () => {
      await client.rpush('list', 'a', 'b', 'c', 'd', 'e')
      const result = await client.lrange('list', -3, -1)
      expect(result).toEqual(['c', 'd', 'e'])
    })

    it('should return empty array for non-existent list', async () => {
      const result = await client.lrange('nonexistent', 0, -1)
      expect(result).toEqual([])
    })
  })

  describe('LLEN', () => {
    it('should get list length', async () => {
      await client.rpush('list', 'a', 'b', 'c')
      const len = await client.llen('list')
      expect(len).toBe(3)
    })

    it('should return 0 for non-existent list', async () => {
      const len = await client.llen('nonexistent')
      expect(len).toBe(0)
    })
  })

  describe('LINDEX/LSET', () => {
    it('should get element at index', async () => {
      await client.rpush('list', 'a', 'b', 'c')
      expect(await client.lindex('list', 0)).toBe('a')
      expect(await client.lindex('list', -1)).toBe('c')
    })

    it('should set element at index', async () => {
      await client.rpush('list', 'a', 'b', 'c')
      await client.lset('list', 1, 'B')
      expect(await client.lindex('list', 1)).toBe('B')
    })

    it('should throw on out of range index', async () => {
      await client.rpush('list', 'a')
      await expect(client.lset('list', 10, 'x')).rejects.toThrow()
    })
  })

  describe('LREM/LTRIM', () => {
    it('should remove elements by value', async () => {
      await client.rpush('list', 'a', 'b', 'a', 'c', 'a')
      const removed = await client.lrem('list', 2, 'a')
      expect(removed).toBe(2)
      const result = await client.lrange('list', 0, -1)
      expect(result).toEqual(['b', 'c', 'a'])
    })

    it('should trim list to range', async () => {
      await client.rpush('list', 'a', 'b', 'c', 'd', 'e')
      await client.ltrim('list', 1, 3)
      const result = await client.lrange('list', 0, -1)
      expect(result).toEqual(['b', 'c', 'd'])
    })
  })

  describe('LINSERT/LPOS', () => {
    it('should insert before pivot', async () => {
      await client.rpush('list', 'a', 'c')
      await client.linsert('list', 'BEFORE', 'c', 'b')
      expect(await client.lrange('list', 0, -1)).toEqual(['a', 'b', 'c'])
    })

    it('should insert after pivot', async () => {
      await client.rpush('list', 'a', 'c')
      await client.linsert('list', 'AFTER', 'a', 'b')
      expect(await client.lrange('list', 0, -1)).toEqual(['a', 'b', 'c'])
    })

    it('should find position of element', async () => {
      await client.rpush('list', 'a', 'b', 'c', 'b', 'd')
      const pos = await client.lpos('list', 'b')
      expect(pos).toBe(1)
    })
  })
})

// ============================================================================
// SET COMMAND TESTS
// ============================================================================

describe('Set commands', () => {
  let client: Redis

  beforeEach(async () => {
    client = createClient()
    await client.flushdb()
  })

  afterEach(async () => {
    await client.quit()
  })

  describe('SADD/SREM/SMEMBERS', () => {
    it('should add members to set', async () => {
      const added = await client.sadd('set', 'a', 'b', 'c')
      expect(added).toBe(3)
    })

    it('should not add duplicate members', async () => {
      await client.sadd('set', 'a', 'b')
      const added = await client.sadd('set', 'b', 'c')
      expect(added).toBe(1)
    })

    it('should remove members from set', async () => {
      await client.sadd('set', 'a', 'b', 'c')
      const removed = await client.srem('set', 'a', 'b')
      expect(removed).toBe(2)
    })

    it('should get all members', async () => {
      await client.sadd('set', 'a', 'b', 'c')
      const members = await client.smembers('set')
      expect(members.sort()).toEqual(['a', 'b', 'c'])
    })
  })

  describe('SISMEMBER/SMISMEMBER', () => {
    it('should check if member exists', async () => {
      await client.sadd('set', 'a', 'b')
      expect(await client.sismember('set', 'a')).toBe(1)
      expect(await client.sismember('set', 'c')).toBe(0)
    })

    it('should check multiple members', async () => {
      await client.sadd('set', 'a', 'b')
      const results = await client.smismember('set', 'a', 'c', 'b')
      expect(results).toEqual([1, 0, 1])
    })
  })

  describe('SCARD', () => {
    it('should get set cardinality', async () => {
      await client.sadd('set', 'a', 'b', 'c')
      const card = await client.scard('set')
      expect(card).toBe(3)
    })

    it('should return 0 for non-existent set', async () => {
      const card = await client.scard('nonexistent')
      expect(card).toBe(0)
    })
  })

  describe('SINTER/SUNION/SDIFF', () => {
    beforeEach(async () => {
      await client.sadd('set1', 'a', 'b', 'c')
      await client.sadd('set2', 'b', 'c', 'd')
    })

    it('should get intersection', async () => {
      const result = await client.sinter('set1', 'set2')
      expect(result.sort()).toEqual(['b', 'c'])
    })

    it('should get union', async () => {
      const result = await client.sunion('set1', 'set2')
      expect(result.sort()).toEqual(['a', 'b', 'c', 'd'])
    })

    it('should get difference', async () => {
      const result = await client.sdiff('set1', 'set2')
      expect(result).toEqual(['a'])
    })
  })

  describe('SINTERSTORE/SUNIONSTORE/SDIFFSTORE', () => {
    beforeEach(async () => {
      await client.sadd('set1', 'a', 'b', 'c')
      await client.sadd('set2', 'b', 'c', 'd')
    })

    it('should store intersection', async () => {
      const count = await client.sinterstore('dest', 'set1', 'set2')
      expect(count).toBe(2)
      const members = await client.smembers('dest')
      expect(members.sort()).toEqual(['b', 'c'])
    })

    it('should store union', async () => {
      const count = await client.sunionstore('dest', 'set1', 'set2')
      expect(count).toBe(4)
    })

    it('should store difference', async () => {
      const count = await client.sdiffstore('dest', 'set1', 'set2')
      expect(count).toBe(1)
    })
  })

  describe('SRANDMEMBER/SPOP/SMOVE', () => {
    it('should get random member', async () => {
      await client.sadd('set', 'a', 'b', 'c')
      const member = await client.srandmember('set')
      expect(['a', 'b', 'c']).toContain(member)
    })

    it('should get multiple random members', async () => {
      await client.sadd('set', 'a', 'b', 'c')
      const members = await client.srandmember('set', 2)
      expect(members.length).toBe(2)
    })

    it('should pop random member', async () => {
      await client.sadd('set', 'a', 'b', 'c')
      const member = await client.spop('set')
      expect(['a', 'b', 'c']).toContain(member)
      expect(await client.scard('set')).toBe(2)
    })

    it('should move member between sets', async () => {
      await client.sadd('src', 'a', 'b')
      await client.sadd('dst', 'c')
      const result = await client.smove('src', 'dst', 'a')
      expect(result).toBe(1)
      expect(await client.smembers('src')).toEqual(['b'])
      expect((await client.smembers('dst')).sort()).toEqual(['a', 'c'])
    })
  })
})

// ============================================================================
// SORTED SET COMMAND TESTS
// ============================================================================

describe('Sorted Set commands', () => {
  let client: Redis

  beforeEach(async () => {
    client = createClient()
    await client.flushdb()
  })

  afterEach(async () => {
    await client.quit()
  })

  describe('ZADD/ZREM', () => {
    it('should add members with scores', async () => {
      const added = await client.zadd('zset', 1, 'a', 2, 'b', 3, 'c')
      expect(added).toBe(3)
    })

    it('should update score if member exists', async () => {
      await client.zadd('zset', 1, 'a')
      const added = await client.zadd('zset', 2, 'a')
      expect(added).toBe(0) // No new members
      expect(await client.zscore('zset', 'a')).toBe('2')
    })

    it('should respect NX option', async () => {
      await client.zadd('zset', 1, 'a')
      await client.zadd('zset', { NX: true }, 2, 'a', 3, 'b')
      expect(await client.zscore('zset', 'a')).toBe('1') // Not updated
      expect(await client.zscore('zset', 'b')).toBe('3') // Added
    })

    it('should respect XX option', async () => {
      await client.zadd('zset', 1, 'a')
      await client.zadd('zset', { XX: true }, 2, 'a', 3, 'b')
      expect(await client.zscore('zset', 'a')).toBe('2') // Updated
      expect(await client.zscore('zset', 'b')).toBeNull() // Not added
    })

    it('should remove members', async () => {
      await client.zadd('zset', 1, 'a', 2, 'b', 3, 'c')
      const removed = await client.zrem('zset', 'a', 'b')
      expect(removed).toBe(2)
    })
  })

  describe('ZRANGE/ZREVRANGE', () => {
    beforeEach(async () => {
      await client.zadd('zset', 1, 'a', 2, 'b', 3, 'c', 4, 'd', 5, 'e')
    })

    it('should get range by index', async () => {
      const result = await client.zrange('zset', 0, 2)
      expect(result).toEqual(['a', 'b', 'c'])
    })

    it('should get range with WITHSCORES', async () => {
      const result = await client.zrange('zset', 0, 1, 'WITHSCORES')
      expect(result).toEqual(['a', '1', 'b', '2'])
    })

    it('should get reversed range', async () => {
      const result = await client.zrevrange('zset', 0, 2)
      expect(result).toEqual(['e', 'd', 'c'])
    })

    it('should handle negative indexes', async () => {
      const result = await client.zrange('zset', -3, -1)
      expect(result).toEqual(['c', 'd', 'e'])
    })
  })

  describe('ZSCORE/ZRANK/ZREVRANK', () => {
    beforeEach(async () => {
      await client.zadd('zset', 1, 'a', 2, 'b', 3, 'c')
    })

    it('should get score', async () => {
      const score = await client.zscore('zset', 'b')
      expect(score).toBe('2')
    })

    it('should return null for non-existent member', async () => {
      const score = await client.zscore('zset', 'nonexistent')
      expect(score).toBeNull()
    })

    it('should get rank', async () => {
      const rank = await client.zrank('zset', 'b')
      expect(rank).toBe(1)
    })

    it('should get reverse rank', async () => {
      const rank = await client.zrevrank('zset', 'b')
      expect(rank).toBe(1)
    })
  })

  describe('ZCARD/ZCOUNT', () => {
    beforeEach(async () => {
      await client.zadd('zset', 1, 'a', 2, 'b', 3, 'c', 4, 'd', 5, 'e')
    })

    it('should get cardinality', async () => {
      const card = await client.zcard('zset')
      expect(card).toBe(5)
    })

    it('should count members in score range', async () => {
      const count = await client.zcount('zset', 2, 4)
      expect(count).toBe(3)
    })

    it('should handle -inf/+inf', async () => {
      const count = await client.zcount('zset', '-inf', '+inf')
      expect(count).toBe(5)
    })
  })

  describe('ZINCRBY', () => {
    it('should increment score', async () => {
      await client.zadd('zset', 1, 'a')
      const newScore = await client.zincrby('zset', 2, 'a')
      expect(newScore).toBe('3')
    })

    it('should create member if not exists', async () => {
      const newScore = await client.zincrby('zset', 5, 'new')
      expect(newScore).toBe('5')
    })
  })

  describe('ZRANGEBYSCORE/ZREVRANGEBYSCORE', () => {
    beforeEach(async () => {
      await client.zadd('zset', 1, 'a', 2, 'b', 3, 'c', 4, 'd', 5, 'e')
    })

    it('should get range by score', async () => {
      const result = await client.zrangebyscore('zset', 2, 4)
      expect(result).toEqual(['b', 'c', 'd'])
    })

    it('should get reversed range by score', async () => {
      const result = await client.zrevrangebyscore('zset', 4, 2)
      expect(result).toEqual(['d', 'c', 'b'])
    })

    it('should support LIMIT', async () => {
      const result = await client.zrangebyscore('zset', 1, 5, 'LIMIT', 1, 2)
      expect(result).toEqual(['b', 'c'])
    })
  })

  describe('ZPOPMIN/ZPOPMAX', () => {
    beforeEach(async () => {
      await client.zadd('zset', 1, 'a', 2, 'b', 3, 'c')
    })

    it('should pop minimum', async () => {
      const result = await client.zpopmin('zset')
      expect(result).toEqual(['a', '1'])
    })

    it('should pop multiple minimums', async () => {
      const result = await client.zpopmin('zset', 2)
      expect(result).toEqual(['a', '1', 'b', '2'])
    })

    it('should pop maximum', async () => {
      const result = await client.zpopmax('zset')
      expect(result).toEqual(['c', '3'])
    })
  })
})

// ============================================================================
// KEY COMMAND TESTS
// ============================================================================

describe('Key commands', () => {
  let client: Redis

  beforeEach(async () => {
    client = createClient()
    await client.flushdb()
  })

  afterEach(async () => {
    await client.quit()
  })

  describe('DEL/EXISTS/UNLINK', () => {
    it('should delete keys', async () => {
      await client.set('key1', 'value1')
      await client.set('key2', 'value2')
      const deleted = await client.del('key1', 'key2', 'key3')
      expect(deleted).toBe(2)
    })

    it('should check if keys exist', async () => {
      await client.set('key1', 'value1')
      await client.set('key2', 'value2')
      const exists = await client.exists('key1', 'key2', 'key3')
      expect(exists).toBe(2)
    })

    it('should unlink keys (async delete)', async () => {
      await client.set('key1', 'value1')
      const unlinked = await client.unlink('key1')
      expect(unlinked).toBe(1)
      expect(await client.exists('key1')).toBe(0)
    })
  })

  describe('EXPIRE/EXPIREAT/TTL', () => {
    it('should set expiry in seconds', async () => {
      await client.set('key', 'value')
      await client.expire('key', 10)
      const ttl = await client.ttl('key')
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(10)
    })

    it('should set expiry as timestamp', async () => {
      await client.set('key', 'value')
      const timestamp = Math.floor(Date.now() / 1000) + 10
      await client.expireat('key', timestamp)
      const ttl = await client.ttl('key')
      expect(ttl).toBeGreaterThan(0)
    })

    it('should return -1 for key without expiry', async () => {
      await client.set('key', 'value')
      const ttl = await client.ttl('key')
      expect(ttl).toBe(-1)
    })

    it('should return -2 for non-existent key', async () => {
      const ttl = await client.ttl('nonexistent')
      expect(ttl).toBe(-2)
    })
  })

  describe('PEXPIRE/PEXPIREAT/PTTL', () => {
    it('should set expiry in milliseconds', async () => {
      await client.set('key', 'value')
      await client.pexpire('key', 10000)
      const pttl = await client.pttl('key')
      expect(pttl).toBeGreaterThan(0)
      expect(pttl).toBeLessThanOrEqual(10000)
    })

    it('should set expiry as ms timestamp', async () => {
      await client.set('key', 'value')
      const timestamp = Date.now() + 10000
      await client.pexpireat('key', timestamp)
      const pttl = await client.pttl('key')
      expect(pttl).toBeGreaterThan(0)
    })
  })

  describe('PERSIST', () => {
    it('should remove expiry', async () => {
      await client.set('key', 'value')
      await client.expire('key', 10)
      await client.persist('key')
      const ttl = await client.ttl('key')
      expect(ttl).toBe(-1)
    })
  })

  describe('KEYS', () => {
    it('should find keys by pattern', async () => {
      await client.set('user:1', 'a')
      await client.set('user:2', 'b')
      await client.set('other', 'c')

      const keys = await client.keys('user:*')
      expect(keys.sort()).toEqual(['user:1', 'user:2'])
    })

    it('should find all keys', async () => {
      await client.set('a', '1')
      await client.set('b', '2')
      const keys = await client.keys('*')
      expect(keys.sort()).toEqual(['a', 'b'])
    })
  })

  describe('TYPE', () => {
    it('should return string type', async () => {
      await client.set('key', 'value')
      expect(await client.type('key')).toBe('string')
    })

    it('should return hash type', async () => {
      await client.hset('key', 'field', 'value')
      expect(await client.type('key')).toBe('hash')
    })

    it('should return list type', async () => {
      await client.lpush('key', 'value')
      expect(await client.type('key')).toBe('list')
    })

    it('should return set type', async () => {
      await client.sadd('key', 'value')
      expect(await client.type('key')).toBe('set')
    })

    it('should return zset type', async () => {
      await client.zadd('key', 1, 'value')
      expect(await client.type('key')).toBe('zset')
    })

    it('should return none for non-existent key', async () => {
      expect(await client.type('nonexistent')).toBe('none')
    })
  })

  describe('RENAME/RENAMENX', () => {
    it('should rename key', async () => {
      await client.set('old', 'value')
      await client.rename('old', 'new')
      expect(await client.get('old')).toBeNull()
      expect(await client.get('new')).toBe('value')
    })

    it('should rename only if new key does not exist', async () => {
      await client.set('old', 'value1')
      await client.set('new', 'value2')
      const result = await client.renamenx('old', 'new')
      expect(result).toBe(0)
      expect(await client.get('new')).toBe('value2')
    })
  })

  describe('SCAN', () => {
    it('should scan keys', async () => {
      for (let i = 0; i < 10; i++) {
        await client.set(`key:${i}`, `value${i}`)
      }

      const [cursor, keys] = await client.scan(0)
      expect(keys.length).toBeGreaterThan(0)
    })

    it('should scan with MATCH pattern', async () => {
      await client.set('user:1', 'a')
      await client.set('user:2', 'b')
      await client.set('other', 'c')

      const [cursor, keys] = await client.scan(0, { MATCH: 'user:*' })
      expect(keys.every((k) => k.startsWith('user:'))).toBe(true)
    })

    it('should scan with COUNT hint', async () => {
      for (let i = 0; i < 100; i++) {
        await client.set(`key:${i}`, `value${i}`)
      }

      const [cursor, keys] = await client.scan(0, { COUNT: 10 })
      expect(keys.length).toBeLessThanOrEqual(100)
    })
  })

  describe('COPY', () => {
    it('should copy key', async () => {
      await client.set('src', 'value')
      const result = await client.copy('src', 'dst')
      expect(result).toBe(1)
      expect(await client.get('dst')).toBe('value')
    })

    it('should not copy if destination exists without REPLACE', async () => {
      await client.set('src', 'value1')
      await client.set('dst', 'value2')
      const result = await client.copy('src', 'dst')
      expect(result).toBe(0)
    })

    it('should copy with REPLACE option', async () => {
      await client.set('src', 'value1')
      await client.set('dst', 'value2')
      const result = await client.copy('src', 'dst', { REPLACE: true })
      expect(result).toBe(1)
      expect(await client.get('dst')).toBe('value1')
    })
  })
})

// ============================================================================
// PUB/SUB TESTS
// ============================================================================

describe('Pub/Sub commands', () => {
  let publisher: Redis
  let subscriber: Redis

  beforeEach(async () => {
    publisher = createClient()
    subscriber = createClient()
    await publisher.flushdb()
  })

  afterEach(async () => {
    await publisher.quit()
    await subscriber.quit()
    // Clean up static pubSub state to prevent cross-test pollution
    RedisClient._resetTestState()
  })

  it('should publish and receive message', async () => {
    const messages: string[] = []

    subscriber.on('message', (channel, message) => {
      messages.push(`${channel}:${message}`)
    })

    await subscriber.subscribe('channel1')

    // Wait for subscription to be ready
    await new Promise((r) => setTimeout(r, 50))

    const receivers = await publisher.publish('channel1', 'hello')
    expect(receivers).toBeGreaterThanOrEqual(1)

    // Wait for message delivery
    await new Promise((r) => setTimeout(r, 50))
    expect(messages).toContain('channel1:hello')
  })

  it('should subscribe to multiple channels', async () => {
    await subscriber.subscribe('ch1', 'ch2', 'ch3')
    // Subscription setup should not throw
  })

  it('should unsubscribe from channels', async () => {
    await subscriber.subscribe('ch1', 'ch2')
    await subscriber.unsubscribe('ch1')
    // Should not throw
  })

  it('should pattern subscribe', async () => {
    const messages: string[] = []

    subscriber.on('pmessage', (pattern, channel, message) => {
      messages.push(`${pattern}:${channel}:${message}`)
    })

    await subscriber.psubscribe('user:*')
    await new Promise((r) => setTimeout(r, 50))

    await publisher.publish('user:123', 'logged_in')
    await new Promise((r) => setTimeout(r, 50))

    expect(messages.length).toBeGreaterThan(0)
  })

  it('should pattern unsubscribe', async () => {
    await subscriber.psubscribe('user:*', 'order:*')
    await subscriber.punsubscribe('user:*')
    // Should not throw
  })
})

// ============================================================================
// TRANSACTION TESTS
// ============================================================================

describe('Transaction commands', () => {
  let client: Redis

  beforeEach(async () => {
    client = createClient()
    await client.flushdb()
  })

  afterEach(async () => {
    await client.quit()
  })

  describe('MULTI/EXEC', () => {
    it('should execute transaction', async () => {
      const results = await client
        .multi()
        .set('key1', 'value1')
        .set('key2', 'value2')
        .get('key1')
        .exec()

      expect(results).toHaveLength(3)
      expect(results![0]).toEqual([null, 'OK'])
      expect(results![1]).toEqual([null, 'OK'])
      expect(results![2]).toEqual([null, 'value1'])
    })

    it('should discard transaction', async () => {
      await client.set('key', 'original')

      const multi = client.multi()
      multi.set('key', 'changed')
      await multi.discard()

      expect(await client.get('key')).toBe('original')
    })

    it('should execute empty transaction', async () => {
      const results = await client.multi().exec()
      expect(results).toEqual([])
    })
  })

  describe('WATCH', () => {
    it('should watch key for changes', async () => {
      await client.set('key', 'value1')
      await client.watch('key')

      // Simulate concurrent modification
      const client2 = createClient()
      await client2.set('key', 'value2')

      const results = await client
        .multi()
        .set('key', 'value3')
        .exec()

      // Transaction should be aborted due to WATCH
      expect(results).toBeNull()

      await client2.quit()
    })

    it('should unwatch keys', async () => {
      await client.set('key', 'value1')
      await client.watch('key')
      await client.unwatch()

      const client2 = createClient()
      await client2.set('key', 'value2')

      const results = await client
        .multi()
        .set('key', 'value3')
        .exec()

      // Transaction should succeed after UNWATCH
      expect(results).not.toBeNull()

      await client2.quit()
    })
  })
})

// ============================================================================
// PIPELINE TESTS
// ============================================================================

describe('Pipeline commands', () => {
  let client: Redis

  beforeEach(async () => {
    client = createClient()
    await client.flushdb()
  })

  afterEach(async () => {
    await client.quit()
  })

  it('should execute pipeline', async () => {
    const results = await client
      .pipeline()
      .set('key1', 'value1')
      .set('key2', 'value2')
      .get('key1')
      .get('key2')
      .exec()

    expect(results).toHaveLength(4)
    expect(results[2]).toEqual([null, 'value1'])
    expect(results[3]).toEqual([null, 'value2'])
  })

  it('should handle errors in pipeline', async () => {
    await client.set('str', 'hello')

    const results = await client
      .pipeline()
      .incr('str') // This will fail - not a number
      .set('key', 'value')
      .exec()

    expect(results[0][0]).toBeInstanceOf(Error)
    expect(results[1]).toEqual([null, 'OK'])
  })

  it('should pipeline many commands efficiently', async () => {
    const pipeline = client.pipeline()
    for (let i = 0; i < 100; i++) {
      pipeline.set(`key:${i}`, `value:${i}`)
    }
    const results = await pipeline.exec()

    expect(results).toHaveLength(100)
    expect(results.every((r) => r[0] === null && r[1] === 'OK')).toBe(true)
  })

  it('should pipeline mixed commands', async () => {
    const results = await client
      .pipeline()
      .set('counter', '0')
      .incr('counter')
      .incrby('counter', 5)
      .get('counter')
      .exec()

    expect(results[3]).toEqual([null, '6'])
  })
})

// ============================================================================
// SERVER COMMAND TESTS
// ============================================================================

describe('Server commands', () => {
  let client: Redis

  beforeEach(async () => {
    client = createClient()
    await client.flushdb()
  })

  afterEach(async () => {
    await client.quit()
  })

  describe('PING/ECHO', () => {
    it('should ping server', async () => {
      const result = await client.ping()
      expect(result).toBe('PONG')
    })

    it('should ping with message', async () => {
      const result = await client.ping('hello')
      expect(result).toBe('hello')
    })

    it('should echo message', async () => {
      const result = await client.echo('hello')
      expect(result).toBe('hello')
    })
  })

  describe('DBSIZE', () => {
    it('should get database size', async () => {
      await client.set('key1', 'value1')
      await client.set('key2', 'value2')
      const size = await client.dbsize()
      expect(size).toBe(2)
    })
  })

  describe('FLUSHDB/FLUSHALL', () => {
    it('should flush current database', async () => {
      await client.set('key', 'value')
      await client.flushdb()
      expect(await client.dbsize()).toBe(0)
    })

    it('should flush all databases', async () => {
      await client.set('key', 'value')
      await client.flushall()
      expect(await client.dbsize()).toBe(0)
    })
  })

  describe('TIME', () => {
    it('should get server time', async () => {
      const [seconds, microseconds] = await client.time()
      expect(parseInt(seconds)).toBeGreaterThan(0)
      expect(parseInt(microseconds)).toBeGreaterThanOrEqual(0)
    })
  })

  describe('INFO', () => {
    it('should get server info', async () => {
      const info = await client.info()
      expect(typeof info).toBe('string')
      expect(info.length).toBeGreaterThan(0)
    })

    it('should get specific section', async () => {
      const info = await client.info('server')
      expect(typeof info).toBe('string')
    })
  })

  describe('SELECT', () => {
    it('should select database', async () => {
      await client.select(1)
      // Should not throw
      await client.select(0)
    })
  })
})

// ============================================================================
// CONNECTION TESTS
// ============================================================================

describe('Connection', () => {
  it('should connect with lazyConnect', async () => {
    const client = createClient({ lazyConnect: true })
    expect(client.status).toBe('wait')

    await client.connect()
    expect(client.status).toBe('ready')

    await client.quit()
  })

  it('should disconnect gracefully', async () => {
    const client = createClient()
    await client.quit()
    expect(client.status).toBe('end')
  })

  it('should disconnect immediately', () => {
    const client = createClient()
    client.disconnect()
    expect(client.status).toBe('end')
  })

  it('should emit events', async () => {
    const events: string[] = []
    const client = createClient({ lazyConnect: true })

    client.on('connect', () => events.push('connect'))
    client.on('ready', () => events.push('ready'))

    await client.connect()

    expect(events).toContain('ready')

    await client.quit()
  })

  it('should duplicate client', async () => {
    const client = createClient()
    const dup = client.duplicate()

    expect(dup).toBeDefined()
    expect(dup).not.toBe(client)

    await client.quit()
    await dup.quit()
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error handling', () => {
  let client: Redis

  beforeEach(async () => {
    client = createClient()
    await client.flushdb()
  })

  afterEach(async () => {
    await client.quit()
  })

  it('should throw ReplyError on WRONGTYPE', async () => {
    await client.set('key', 'string')
    await expect(client.lpush('key', 'value')).rejects.toThrow(ReplyError)
  })

  it('should throw on invalid command args', async () => {
    await expect(client.lset('nonexistent', 0, 'value')).rejects.toThrow()
  })

  it('should handle connection errors', async () => {
    // Test that error event is emitted
    const errors: Error[] = []
    client.on('error', (err) => errors.push(err))
    // Connection errors would be simulated in real implementation
  })
})

// ============================================================================
// KEY PREFIX TESTS
// ============================================================================

describe('Key prefix', () => {
  let client: Redis

  beforeEach(async () => {
    client = createClient({ keyPrefix: 'myapp:' })
    await client.flushdb()
  })

  afterEach(async () => {
    await client.quit()
  })

  it('should prefix keys on SET/GET', async () => {
    await client.set('key', 'value')
    // Internal key should be 'myapp:key'
    const result = await client.get('key')
    expect(result).toBe('value')
  })

  it('should prefix keys on hash commands', async () => {
    await client.hset('hash', 'field', 'value')
    const result = await client.hget('hash', 'field')
    expect(result).toBe('value')
  })

  it('should prefix keys on list commands', async () => {
    await client.lpush('list', 'value')
    const result = await client.lrange('list', 0, -1)
    expect(result).toEqual(['value'])
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  it('should work with realistic caching workflow', async () => {
    const client = createClient()

    // Simulate caching user data
    const userId = 'user:123'
    const userData = {
      name: 'Alice',
      email: 'alice@example.com.ai',
      score: '100',
    }

    // Store user hash
    await client.hmset(userId, userData)

    // Get specific field
    expect(await client.hget(userId, 'name')).toBe('Alice')

    // Get all fields
    const user = await client.hgetall(userId)
    expect(user.name).toBe('Alice')

    // Increment score
    await client.hincrby(userId, 'score', 10)
    expect(await client.hget(userId, 'score')).toBe('110')

    // Set cache expiry
    await client.expire(userId, 3600)
    expect(await client.ttl(userId)).toBeGreaterThan(0)

    await client.quit()
  })

  it('should work with leaderboard pattern', async () => {
    const client = createClient()

    // Add scores
    await client.zadd('leaderboard', 100, 'player1', 200, 'player2', 150, 'player3')

    // Get top 2 players
    const top2 = await client.zrevrange('leaderboard', 0, 1)
    expect(top2).toEqual(['player2', 'player3'])

    // Get player rank
    const rank = await client.zrevrank('leaderboard', 'player1')
    expect(rank).toBe(2)

    // Update score
    await client.zincrby('leaderboard', 150, 'player1')
    expect(await client.zscore('leaderboard', 'player1')).toBe('250')

    // Now player1 should be #1
    expect(await client.zrevrank('leaderboard', 'player1')).toBe(0)

    await client.quit()
  })

  it('should work with rate limiting pattern', async () => {
    const client = createClient()
    const key = 'rate:user:123'
    const limit = 10
    const window = 60

    // Check current count
    const count = await client.incr(key)

    if (count === 1) {
      // First request, set expiry
      await client.expire(key, window)
    }

    expect(count).toBeLessThanOrEqual(limit)

    // Simulate multiple requests
    for (let i = 0; i < 5; i++) {
      await client.incr(key)
    }

    const finalCount = parseInt((await client.get(key))!, 10)
    expect(finalCount).toBe(6)

    await client.quit()
  })

  it('should work with session storage pattern', async () => {
    const client = createClient()
    const sessionId = 'sess:abc123'

    // Store session
    await client.hmset(sessionId, {
      userId: '123',
      role: 'admin',
      createdAt: Date.now().toString(),
    })

    // Set session expiry
    await client.expire(sessionId, 86400)

    // Check session
    const exists = await client.exists(sessionId)
    expect(exists).toBe(1)

    // Get session data
    const session = await client.hgetall(sessionId)
    expect(session.userId).toBe('123')
    expect(session.role).toBe('admin')

    // Extend session
    await client.expire(sessionId, 86400)

    // Destroy session
    await client.del(sessionId)
    expect(await client.exists(sessionId)).toBe(0)

    await client.quit()
  })
})

// ============================================================================
// STREAM COMMAND TESTS
// ============================================================================

describe('Stream Commands', () => {
  let client: ReturnType<typeof createClient>

  beforeEach(() => {
    client = createClient()
  })

  afterEach(async () => {
    await client.flushdb()
    await client.quit()
  })

  // ==========================================================================
  // XADD TESTS
  // ==========================================================================

  describe('xadd', () => {
    it('should add entry with auto-generated ID', async () => {
      const id = await client.xadd('mystream', '*', 'field1', 'value1')
      expect(id).toMatch(/^\d+-\d+$/)
    })

    it('should add entry with multiple fields', async () => {
      const id = await client.xadd('mystream', '*', 'name', 'Alice', 'age', '30', 'city', 'NYC')
      expect(id).toBeDefined()

      const entries = await client.xrange('mystream', '-', '+')
      expect(entries).toHaveLength(1)
      expect(entries[0][1]).toEqual(['name', 'Alice', 'age', '30', 'city', 'NYC'])
    })

    it('should add entry with specific ID', async () => {
      const specificId = '1526919030474-0'
      const id = await client.xadd('mystream', specificId, 'field1', 'value1')
      expect(id).toBe(specificId)
    })

    it('should fail when adding ID lower than last ID', async () => {
      await client.xadd('mystream', '1000-0', 'field1', 'value1')
      await expect(
        client.xadd('mystream', '500-0', 'field1', 'value1')
      ).rejects.toThrow()
    })

    it('should create stream on first xadd', async () => {
      await client.xadd('newstream', '*', 'key', 'value')
      const len = await client.xlen('newstream')
      expect(len).toBe(1)
    })

    it('should respect NOMKSTREAM option', async () => {
      const result = await client.xadd('nonexistent', { NOMKSTREAM: true, id: '*' }, 'k', 'v')
      expect(result).toBeNull()
    })

    it('should auto-increment sequence for same timestamp', async () => {
      const id1 = await client.xadd('mystream', '1000-0', 'field', 'v1')
      const id2 = await client.xadd('mystream', '1000-*', 'field', 'v2')
      expect(id1).toBe('1000-0')
      expect(id2).toBe('1000-1')
    })

    it('should trim with MAXLEN option', async () => {
      // Add 10 entries
      for (let i = 0; i < 10; i++) {
        await client.xadd('mystream', '*', 'i', String(i))
      }
      // Add with MAXLEN=5
      await client.xadd('mystream', { id: '*', MAXLEN: 5 }, 'i', '10')
      const len = await client.xlen('mystream')
      expect(len).toBeLessThanOrEqual(6) // May have a few extra due to approximate
    })
  })

  // ==========================================================================
  // XLEN TESTS
  // ==========================================================================

  describe('xlen', () => {
    it('should return 0 for non-existent stream', async () => {
      const len = await client.xlen('nonexistent')
      expect(len).toBe(0)
    })

    it('should return correct length', async () => {
      await client.xadd('mystream', '*', 'k1', 'v1')
      await client.xadd('mystream', '*', 'k2', 'v2')
      await client.xadd('mystream', '*', 'k3', 'v3')
      const len = await client.xlen('mystream')
      expect(len).toBe(3)
    })
  })

  // ==========================================================================
  // XRANGE / XREVRANGE TESTS
  // ==========================================================================

  describe('xrange', () => {
    beforeEach(async () => {
      await client.xadd('mystream', '1-0', 'f', 'v1')
      await client.xadd('mystream', '2-0', 'f', 'v2')
      await client.xadd('mystream', '3-0', 'f', 'v3')
      await client.xadd('mystream', '4-0', 'f', 'v4')
      await client.xadd('mystream', '5-0', 'f', 'v5')
    })

    it('should return all entries with - and +', async () => {
      const entries = await client.xrange('mystream', '-', '+')
      expect(entries).toHaveLength(5)
      expect(entries[0][0]).toBe('1-0')
      expect(entries[4][0]).toBe('5-0')
    })

    it('should return range between IDs', async () => {
      const entries = await client.xrange('mystream', '2-0', '4-0')
      expect(entries).toHaveLength(3)
      expect(entries[0][0]).toBe('2-0')
      expect(entries[2][0]).toBe('4-0')
    })

    it('should respect COUNT option', async () => {
      const entries = await client.xrange('mystream', '-', '+', 'COUNT', 2)
      expect(entries).toHaveLength(2)
    })

    it('should return empty array for out-of-range', async () => {
      const entries = await client.xrange('mystream', '100-0', '200-0')
      expect(entries).toHaveLength(0)
    })

    it('should work with exclusive ranges', async () => {
      const entries = await client.xrange('mystream', '(2-0', '(5-0')
      expect(entries).toHaveLength(2) // 3-0 and 4-0
    })
  })

  describe('xrevrange', () => {
    beforeEach(async () => {
      await client.xadd('mystream', '1-0', 'f', 'v1')
      await client.xadd('mystream', '2-0', 'f', 'v2')
      await client.xadd('mystream', '3-0', 'f', 'v3')
    })

    it('should return entries in reverse order', async () => {
      const entries = await client.xrevrange('mystream', '+', '-')
      expect(entries).toHaveLength(3)
      expect(entries[0][0]).toBe('3-0')
      expect(entries[2][0]).toBe('1-0')
    })

    it('should respect COUNT', async () => {
      const entries = await client.xrevrange('mystream', '+', '-', 'COUNT', 1)
      expect(entries).toHaveLength(1)
      expect(entries[0][0]).toBe('3-0')
    })
  })

  // ==========================================================================
  // XREAD TESTS
  // ==========================================================================

  describe('xread', () => {
    it('should read new entries from single stream', async () => {
      await client.xadd('mystream', '1-0', 'field', 'value1')
      await client.xadd('mystream', '2-0', 'field', 'value2')

      const result = await client.xread('STREAMS', 'mystream', '0-0')
      expect(result).not.toBeNull()
      expect(result).toHaveLength(1)
      expect(result![0][0]).toBe('mystream')
      expect(result![0][1]).toHaveLength(2)
    })

    it('should read from multiple streams', async () => {
      await client.xadd('stream1', '1-0', 'f', 'v1')
      await client.xadd('stream2', '1-0', 'f', 'v2')

      const result = await client.xread('STREAMS', 'stream1', 'stream2', '0-0', '0-0')
      expect(result).toHaveLength(2)
    })

    it('should return null when no new entries', async () => {
      await client.xadd('mystream', '1-0', 'f', 'v')
      const result = await client.xread('STREAMS', 'mystream', '1-0')
      expect(result).toBeNull()
    })

    it('should respect COUNT option', async () => {
      for (let i = 1; i <= 10; i++) {
        await client.xadd('mystream', `${i}-0`, 'f', `v${i}`)
      }

      const result = await client.xread({ COUNT: 3 }, 'STREAMS', 'mystream', '0-0')
      expect(result![0][1]).toHaveLength(3)
    })

    it('should use $ for new entries only', async () => {
      await client.xadd('mystream', '1-0', 'f', 'old')
      // With $ we should get null since we're only looking for new entries
      const result = await client.xread('STREAMS', 'mystream', '$')
      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // XDEL TESTS
  // ==========================================================================

  describe('xdel', () => {
    it('should delete single entry', async () => {
      const id = await client.xadd('mystream', '*', 'f', 'v')
      const deleted = await client.xdel('mystream', id)
      expect(deleted).toBe(1)
      expect(await client.xlen('mystream')).toBe(0)
    })

    it('should delete multiple entries', async () => {
      const id1 = await client.xadd('mystream', '*', 'f', 'v1')
      const id2 = await client.xadd('mystream', '*', 'f', 'v2')
      await client.xadd('mystream', '*', 'f', 'v3')

      const deleted = await client.xdel('mystream', id1, id2)
      expect(deleted).toBe(2)
      expect(await client.xlen('mystream')).toBe(1)
    })

    it('should return 0 for non-existent IDs', async () => {
      await client.xadd('mystream', '*', 'f', 'v')
      const deleted = await client.xdel('mystream', '999-0')
      expect(deleted).toBe(0)
    })
  })

  // ==========================================================================
  // XTRIM TESTS
  // ==========================================================================

  describe('xtrim', () => {
    beforeEach(async () => {
      for (let i = 1; i <= 10; i++) {
        await client.xadd('mystream', `${i}-0`, 'f', `v${i}`)
      }
    })

    it('should trim to MAXLEN', async () => {
      const deleted = await client.xtrim('mystream', 'MAXLEN', 5)
      expect(deleted).toBe(5)
      expect(await client.xlen('mystream')).toBe(5)
    })

    it('should trim with approximate MAXLEN', async () => {
      const deleted = await client.xtrim('mystream', 'MAXLEN', '~', 3)
      expect(await client.xlen('mystream')).toBeLessThanOrEqual(5) // Approximate
    })

    it('should trim by MINID', async () => {
      const deleted = await client.xtrim('mystream', 'MINID', '6-0')
      expect(deleted).toBe(5) // Remove IDs < 6-0
      expect(await client.xlen('mystream')).toBe(5)
    })
  })

  // ==========================================================================
  // XINFO TESTS
  // ==========================================================================

  describe('xinfo', () => {
    it('should return stream info', async () => {
      await client.xadd('mystream', '1-0', 'f', 'v1')
      await client.xadd('mystream', '2-0', 'f', 'v2')

      const info = await client.xinfo('STREAM', 'mystream')
      expect(info.length).toBe(2)
      expect(info.lastGeneratedId).toBe('2-0')
      expect(info.firstEntry).toBeDefined()
      expect(info.lastEntry).toBeDefined()
    })

    it('should return groups info', async () => {
      await client.xadd('mystream', '*', 'f', 'v')
      await client.xgroup('CREATE', 'mystream', 'mygroup', '0')

      const groups = await client.xinfo('GROUPS', 'mystream')
      expect(groups).toHaveLength(1)
      expect(groups[0].name).toBe('mygroup')
    })

    it('should return consumers info', async () => {
      await client.xadd('mystream', '*', 'f', 'v')
      await client.xgroup('CREATE', 'mystream', 'mygroup', '0')
      await client.xreadgroup('GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '>')

      const consumers = await client.xinfo('CONSUMERS', 'mystream', 'mygroup')
      expect(consumers).toHaveLength(1)
      expect(consumers[0].name).toBe('consumer1')
    })
  })

  // ==========================================================================
  // XGROUP TESTS
  // ==========================================================================

  describe('xgroup', () => {
    it('should create consumer group', async () => {
      await client.xadd('mystream', '*', 'f', 'v')
      const result = await client.xgroup('CREATE', 'mystream', 'mygroup', '0')
      expect(result).toBe('OK')
    })

    it('should create group with MKSTREAM', async () => {
      const result = await client.xgroup('CREATE', 'newstream', 'mygroup', '$', 'MKSTREAM')
      expect(result).toBe('OK')
      const type = await client.type('newstream')
      expect(type).toBe('stream')
    })

    it('should fail creating duplicate group', async () => {
      await client.xadd('mystream', '*', 'f', 'v')
      await client.xgroup('CREATE', 'mystream', 'mygroup', '0')
      await expect(
        client.xgroup('CREATE', 'mystream', 'mygroup', '0')
      ).rejects.toThrow('BUSYGROUP')
    })

    it('should destroy consumer group', async () => {
      await client.xadd('mystream', '*', 'f', 'v')
      await client.xgroup('CREATE', 'mystream', 'mygroup', '0')

      const deleted = await client.xgroup('DESTROY', 'mystream', 'mygroup')
      expect(deleted).toBe(1)
    })

    it('should delete consumer from group', async () => {
      await client.xadd('mystream', '*', 'f', 'v')
      await client.xgroup('CREATE', 'mystream', 'mygroup', '0')
      await client.xreadgroup('GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '>')

      const pending = await client.xgroup('DELCONSUMER', 'mystream', 'mygroup', 'consumer1')
      expect(typeof pending).toBe('number')
    })

    it('should set group ID', async () => {
      await client.xadd('mystream', '1-0', 'f', 'v1')
      await client.xadd('mystream', '2-0', 'f', 'v2')
      await client.xgroup('CREATE', 'mystream', 'mygroup', '2-0')

      const result = await client.xgroup('SETID', 'mystream', 'mygroup', '0')
      expect(result).toBe('OK')
    })
  })

  // ==========================================================================
  // XREADGROUP TESTS
  // ==========================================================================

  describe('xreadgroup', () => {
    beforeEach(async () => {
      await client.xadd('mystream', '1-0', 'f', 'v1')
      await client.xadd('mystream', '2-0', 'f', 'v2')
      await client.xadd('mystream', '3-0', 'f', 'v3')
      await client.xgroup('CREATE', 'mystream', 'mygroup', '0')
    })

    it('should read entries for consumer', async () => {
      const result = await client.xreadgroup('GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '>')
      expect(result).toHaveLength(1)
      expect(result![0][1]).toHaveLength(3)
    })

    it('should only return undelivered entries with >', async () => {
      await client.xreadgroup('GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '>')
      const result = await client.xreadgroup('GROUP', 'mygroup', 'consumer2', 'STREAMS', 'mystream', '>')
      expect(result).toBeNull()
    })

    it('should return pending entries with 0', async () => {
      await client.xreadgroup('GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '>')
      const result = await client.xreadgroup('GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '0')
      expect(result![0][1]).toHaveLength(3) // All pending for this consumer
    })

    it('should respect COUNT option', async () => {
      const result = await client.xreadgroup('GROUP', 'mygroup', 'consumer1', { COUNT: 1 }, 'STREAMS', 'mystream', '>')
      expect(result![0][1]).toHaveLength(1)
    })

    it('should work with NOACK option', async () => {
      await client.xreadgroup('GROUP', 'mygroup', 'consumer1', { NOACK: true }, 'STREAMS', 'mystream', '>')

      // With NOACK, entries shouldn't be added to pending
      const pending = await client.xpending('mystream', 'mygroup')
      expect(pending[0]).toBe(0) // No pending entries
    })

    it('should read from multiple streams', async () => {
      await client.xadd('stream2', '*', 'f', 'v')
      await client.xgroup('CREATE', 'stream2', 'mygroup', '0')

      const result = await client.xreadgroup(
        'GROUP', 'mygroup', 'consumer1',
        'STREAMS', 'mystream', 'stream2', '>', '>'
      )
      expect(result).toHaveLength(2)
    })
  })

  // ==========================================================================
  // XACK TESTS
  // ==========================================================================

  describe('xack', () => {
    beforeEach(async () => {
      await client.xadd('mystream', '1-0', 'f', 'v1')
      await client.xadd('mystream', '2-0', 'f', 'v2')
      await client.xgroup('CREATE', 'mystream', 'mygroup', '0')
      await client.xreadgroup('GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '>')
    })

    it('should acknowledge single entry', async () => {
      const acked = await client.xack('mystream', 'mygroup', '1-0')
      expect(acked).toBe(1)
    })

    it('should acknowledge multiple entries', async () => {
      const acked = await client.xack('mystream', 'mygroup', '1-0', '2-0')
      expect(acked).toBe(2)
    })

    it('should return 0 for non-pending entries', async () => {
      await client.xack('mystream', 'mygroup', '1-0') // First ack
      const acked = await client.xack('mystream', 'mygroup', '1-0') // Double ack
      expect(acked).toBe(0)
    })

    it('should remove entry from pending list', async () => {
      const pendingBefore = await client.xpending('mystream', 'mygroup')
      expect(pendingBefore[0]).toBe(2)

      await client.xack('mystream', 'mygroup', '1-0')

      const pendingAfter = await client.xpending('mystream', 'mygroup')
      expect(pendingAfter[0]).toBe(1)
    })
  })

  // ==========================================================================
  // XPENDING TESTS
  // ==========================================================================

  describe('xpending', () => {
    beforeEach(async () => {
      await client.xadd('mystream', '1-0', 'f', 'v1')
      await client.xadd('mystream', '2-0', 'f', 'v2')
      await client.xadd('mystream', '3-0', 'f', 'v3')
      await client.xgroup('CREATE', 'mystream', 'mygroup', '0')
      await client.xreadgroup('GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '>')
    })

    it('should return summary for group', async () => {
      const pending = await client.xpending('mystream', 'mygroup')
      expect(pending[0]).toBe(3) // count
      expect(pending[1]).toBe('1-0') // smallest ID
      expect(pending[2]).toBe('3-0') // greatest ID
      expect(pending[3]).toHaveLength(1) // [consumer, count] pairs
      expect(pending[3]![0][0]).toBe('consumer1')
      expect(pending[3]![0][1]).toBe(3)
    })

    it('should return empty summary when no pending', async () => {
      await client.xack('mystream', 'mygroup', '1-0', '2-0', '3-0')
      const pending = await client.xpending('mystream', 'mygroup')
      expect(pending[0]).toBe(0)
      expect(pending[1]).toBeNull()
      expect(pending[2]).toBeNull()
    })

    it('should return detailed info with range', async () => {
      const entries = await client.xpending('mystream', 'mygroup', '-', '+', 10)
      expect(entries).toHaveLength(3)
      expect(entries[0].id).toBe('1-0')
      expect(entries[0].consumer).toBe('consumer1')
      expect(entries[0].deliveryCount).toBe(1)
    })

    it('should filter by consumer', async () => {
      const entries = await client.xpending('mystream', 'mygroup', '-', '+', 10, 'consumer1')
      expect(entries).toHaveLength(3)
    })

    it('should respect COUNT in detailed view', async () => {
      const entries = await client.xpending('mystream', 'mygroup', '-', '+', 1)
      expect(entries).toHaveLength(1)
    })
  })

  // ==========================================================================
  // XCLAIM TESTS
  // ==========================================================================

  describe('xclaim', () => {
    beforeEach(async () => {
      await client.xadd('mystream', '1-0', 'f', 'v1')
      await client.xadd('mystream', '2-0', 'f', 'v2')
      await client.xgroup('CREATE', 'mystream', 'mygroup', '0')
      await client.xreadgroup('GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '>')
    })

    it('should claim pending entries', async () => {
      // Wait a bit for idle time
      await new Promise(r => setTimeout(r, 10))

      const claimed = await client.xclaim('mystream', 'mygroup', 'consumer2', 0, '1-0')
      expect(claimed).toHaveLength(1)
      expect(claimed[0][0]).toBe('1-0')
    })

    it('should claim multiple entries', async () => {
      await new Promise(r => setTimeout(r, 10))

      const claimed = await client.xclaim('mystream', 'mygroup', 'consumer2', 0, '1-0', '2-0')
      expect(claimed).toHaveLength(2)
    })

    it('should respect minIdleTime', async () => {
      // Without waiting, should not claim
      const claimed = await client.xclaim('mystream', 'mygroup', 'consumer2', 100000, '1-0')
      expect(claimed).toHaveLength(0)
    })

    it('should update delivery count', async () => {
      await new Promise(r => setTimeout(r, 10))
      await client.xclaim('mystream', 'mygroup', 'consumer2', 0, '1-0')

      const pending = await client.xpending('mystream', 'mygroup', '-', '+', 10)
      const entry = pending.find(e => e.id === '1-0')
      expect(entry!.deliveryCount).toBe(2) // incremented from 1 to 2
    })

    it('should return just IDs with JUSTID option', async () => {
      await new Promise(r => setTimeout(r, 10))
      const ids = await client.xclaim('mystream', 'mygroup', 'consumer2', 0, ['1-0'], { JUSTID: true })
      expect(ids).toEqual(['1-0'])
    })
  })

  // ==========================================================================
  // XAUTOCLAIM TESTS
  // ==========================================================================

  describe('xautoclaim', () => {
    beforeEach(async () => {
      await client.xadd('mystream', '1-0', 'f', 'v1')
      await client.xadd('mystream', '2-0', 'f', 'v2')
      await client.xadd('mystream', '3-0', 'f', 'v3')
      await client.xgroup('CREATE', 'mystream', 'mygroup', '0')
      await client.xreadgroup('GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '>')
    })

    it('should auto-claim pending entries', async () => {
      await new Promise(r => setTimeout(r, 10))

      const [cursor, claimed, deleted] = await client.xautoclaim(
        'mystream', 'mygroup', 'consumer2', 0, '0-0'
      )
      expect(claimed).toHaveLength(3)
      expect(cursor).toBe('0-0') // No more to claim
      expect(deleted).toHaveLength(0)
    })

    it('should respect COUNT option', async () => {
      await new Promise(r => setTimeout(r, 10))

      const [cursor, claimed] = await client.xautoclaim(
        'mystream', 'mygroup', 'consumer2', 0, '0-0', { COUNT: 1 }
      )
      expect(claimed).toHaveLength(1)
      expect(cursor).not.toBe('0-0') // More to claim
    })

    it('should return cursor for pagination', async () => {
      await new Promise(r => setTimeout(r, 10))

      const [cursor1, claimed1] = await client.xautoclaim(
        'mystream', 'mygroup', 'consumer2', 0, '0-0', { COUNT: 2 }
      )
      expect(claimed1).toHaveLength(2)

      const [cursor2, claimed2] = await client.xautoclaim(
        'mystream', 'mygroup', 'consumer2', 0, cursor1, { COUNT: 2 }
      )
      expect(claimed2).toHaveLength(1)
      expect(cursor2).toBe('0-0')
    })
  })

  // ==========================================================================
  // STREAM TYPE TESTS
  // ==========================================================================

  describe('stream type', () => {
    it('should report type as stream', async () => {
      await client.xadd('mystream', '*', 'f', 'v')
      const type = await client.type('mystream')
      expect(type).toBe('stream')
    })

    it('should fail WRONGTYPE operations', async () => {
      await client.xadd('mystream', '*', 'f', 'v')
      await expect(client.lpush('mystream', 'value')).rejects.toThrow('WRONGTYPE')
    })
  })

  // ==========================================================================
  // REAL-WORLD PATTERN TESTS
  // ==========================================================================

  describe('real-world patterns', () => {
    it('should work as event log', async () => {
      // Add events
      await client.xadd('events', '*', 'type', 'user.created', 'userId', '123')
      await client.xadd('events', '*', 'type', 'user.updated', 'userId', '123', 'field', 'email')
      await client.xadd('events', '*', 'type', 'order.placed', 'orderId', '456')

      // Query recent events
      const events = await client.xrevrange('events', '+', '-', 'COUNT', 10)
      expect(events).toHaveLength(3)
      expect(events[0][1]).toContain('order.placed') // Most recent
    })

    it('should work as task queue with consumer groups', async () => {
      // Producer adds tasks
      await client.xadd('tasks', '*', 'task', 'process-image', 'url', 'https://example.com/img.jpg')
      await client.xadd('tasks', '*', 'task', 'send-email', 'to', 'user@example.com')

      // Create consumer group
      await client.xgroup('CREATE', 'tasks', 'workers', '0', 'MKSTREAM')

      // Worker1 claims tasks
      const tasks = await client.xreadgroup('GROUP', 'workers', 'worker1', { COUNT: 1 }, 'STREAMS', 'tasks', '>')
      expect(tasks![0][1]).toHaveLength(1)

      // Worker processes and acks
      const taskId = tasks![0][1][0][0]
      await client.xack('tasks', 'workers', taskId)

      // Verify task is no longer pending
      const pending = await client.xpending('tasks', 'workers')
      expect(pending[0]).toBe(1) // Only 1 task left pending (second one)
    })

    it('should handle failed consumer recovery', async () => {
      // Setup
      await client.xadd('jobs', '1-0', 'job', 'process')
      await client.xgroup('CREATE', 'jobs', 'processors', '0')

      // Consumer1 takes job but crashes (doesn't ack)
      await client.xreadgroup('GROUP', 'processors', 'consumer1', 'STREAMS', 'jobs', '>')

      // Wait for idle time
      await new Promise(r => setTimeout(r, 10))

      // Consumer2 claims dead consumer's work
      const claimed = await client.xclaim('jobs', 'processors', 'consumer2', 0, '1-0')
      expect(claimed).toHaveLength(1)

      // Consumer2 processes and acks
      await client.xack('jobs', 'processors', '1-0')

      // Verify cleaned up
      const pending = await client.xpending('jobs', 'processors')
      expect(pending[0]).toBe(0)
    })
  })
})
