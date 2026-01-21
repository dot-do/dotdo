// Redis Integration Tests
// TDD tests for Redis database integration (do-h3in)

import { describe, it, expect, beforeEach } from 'vitest'
import {
  RedisIntegration,
  createRedisIntegration,
  type RedisConfig,
} from '../redis'

describe('RedisIntegration', () => {
  let redis: RedisIntegration

  beforeEach(() => {
    redis = createRedisIntegration()
  })

  describe('metadata', () => {
    it('should have correct name and version', () => {
      expect(redis.name).toBe('redis')
      expect(redis.version).toBe('1.0.0')
    })

    it('should have correct metadata', () => {
      expect(redis.metadata.displayName).toBe('Redis')
      expect(redis.metadata.category).toBe('database')
      expect(redis.metadata.requiredConfig).toContain('url')
    })

    it('should start uninitialized', () => {
      expect(redis.status).toBe('uninitialized')
    })
  })

  describe('init', () => {
    it('should initialize with URL', async () => {
      const config: RedisConfig = {
        url: 'redis://localhost:6379',
      }

      await redis.init(config)
      expect(redis.status).toBe('ready')
    })

    it('should initialize with host and port', async () => {
      const config: RedisConfig = {
        host: 'localhost',
        port: 6379,
      }

      await redis.init(config)
      expect(redis.status).toBe('ready')
    })

    it('should initialize with password', async () => {
      const config: RedisConfig = {
        url: 'redis://:password@localhost:6379',
      }

      await redis.init(config)
      expect(redis.status).toBe('ready')
    })

    it('should initialize with TLS', async () => {
      const config: RedisConfig = {
        url: 'rediss://localhost:6379',
        tls: true,
      }

      await redis.init(config)
      expect(redis.status).toBe('ready')
    })

    it('should reject missing connection info', async () => {
      const config = {} as RedisConfig

      await expect(redis.init(config)).rejects.toThrow('Redis URL or host is required')
    })

    it('should set status to error on init failure', async () => {
      const config = {} as RedisConfig

      try {
        await redis.init(config)
      } catch {
        // Expected
      }

      expect(redis.status).toBe('error')
    })
  })

  describe('shutdown', () => {
    it('should reset to uninitialized state', async () => {
      const config: RedisConfig = {
        url: 'redis://localhost:6379',
      }

      await redis.init(config)
      expect(redis.status).toBe('ready')

      await redis.shutdown()
      expect(redis.status).toBe('uninitialized')
    })
  })

  describe('healthCheck', () => {
    it('should return false when not initialized', async () => {
      const result = await redis.healthCheck()
      expect(result).toBe(false)
    })

    it('should return true when initialized', async () => {
      const config: RedisConfig = {
        url: 'redis://localhost:6379',
      }

      await redis.init(config)
      const result = await redis.healthCheck()
      expect(result).toBe(true)
    })
  })

  // String operations
  describe('methods.get', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should get a string value', async () => {
      const result = await redis.methods.get('mykey')
      expect(result.success).toBe(true)
    })

    it('should fail when not initialized', async () => {
      const uninitRedis = createRedisIntegration()
      const result = await uninitRedis.methods.get('mykey')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
      }
    })
  })

  describe('methods.set', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should set a string value', async () => {
      const result = await redis.methods.set('mykey', 'myvalue')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe('OK')
      }
    })

    it('should set with expiration (EX)', async () => {
      const result = await redis.methods.set('mykey', 'myvalue', { ex: 60 })
      expect(result.success).toBe(true)
    })

    it('should set with expiration (PX)', async () => {
      const result = await redis.methods.set('mykey', 'myvalue', { px: 60000 })
      expect(result.success).toBe(true)
    })

    it('should set only if not exists (NX)', async () => {
      const result = await redis.methods.set('mykey', 'myvalue', { nx: true })
      expect(result.success).toBe(true)
    })

    it('should set only if exists (XX)', async () => {
      const result = await redis.methods.set('mykey', 'myvalue', { xx: true })
      expect(result.success).toBe(true)
    })
  })

  describe('methods.del', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should delete a key', async () => {
      const result = await redis.methods.del('mykey')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('number')
      }
    })

    it('should delete multiple keys', async () => {
      const result = await redis.methods.del('key1', 'key2', 'key3')
      expect(result.success).toBe(true)
    })
  })

  describe('methods.exists', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should check if key exists', async () => {
      const result = await redis.methods.exists('mykey')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('number')
      }
    })
  })

  describe('methods.expire', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should set expiration on a key', async () => {
      const result = await redis.methods.expire('mykey', 60)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('boolean')
      }
    })
  })

  describe('methods.ttl', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should get TTL of a key', async () => {
      const result = await redis.methods.ttl('mykey')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('number')
      }
    })
  })

  // Hash operations
  describe('methods.hget', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should get a hash field', async () => {
      const result = await redis.methods.hget('myhash', 'field1')
      expect(result.success).toBe(true)
    })
  })

  describe('methods.hset', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should set a hash field', async () => {
      const result = await redis.methods.hset('myhash', 'field1', 'value1')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('number')
      }
    })

    it('should set multiple hash fields', async () => {
      const result = await redis.methods.hset('myhash', { field1: 'value1', field2: 'value2' })
      expect(result.success).toBe(true)
    })
  })

  describe('methods.hgetall', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should get all hash fields', async () => {
      const result = await redis.methods.hgetall('myhash')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('object')
      }
    })
  })

  describe('methods.hdel', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should delete hash fields', async () => {
      const result = await redis.methods.hdel('myhash', 'field1', 'field2')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('number')
      }
    })
  })

  // List operations
  describe('methods.lpush', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should push to left of list', async () => {
      const result = await redis.methods.lpush('mylist', 'value1', 'value2')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('number')
      }
    })
  })

  describe('methods.rpush', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should push to right of list', async () => {
      const result = await redis.methods.rpush('mylist', 'value1', 'value2')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('number')
      }
    })
  })

  describe('methods.lpop', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should pop from left of list', async () => {
      const result = await redis.methods.lpop('mylist')
      expect(result.success).toBe(true)
    })
  })

  describe('methods.rpop', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should pop from right of list', async () => {
      const result = await redis.methods.rpop('mylist')
      expect(result.success).toBe(true)
    })
  })

  describe('methods.lrange', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should get range from list', async () => {
      const result = await redis.methods.lrange('mylist', 0, -1)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(Array.isArray(result.data)).toBe(true)
      }
    })
  })

  describe('methods.llen', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should get list length', async () => {
      const result = await redis.methods.llen('mylist')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('number')
      }
    })
  })

  // Set operations
  describe('methods.sadd', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should add members to set', async () => {
      const result = await redis.methods.sadd('myset', 'member1', 'member2')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('number')
      }
    })
  })

  describe('methods.smembers', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should get all set members', async () => {
      const result = await redis.methods.smembers('myset')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(Array.isArray(result.data)).toBe(true)
      }
    })
  })

  describe('methods.sismember', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should check set membership', async () => {
      const result = await redis.methods.sismember('myset', 'member1')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('boolean')
      }
    })
  })

  describe('methods.srem', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should remove set members', async () => {
      const result = await redis.methods.srem('myset', 'member1', 'member2')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('number')
      }
    })
  })

  // Counter operations
  describe('methods.incr', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should increment a value', async () => {
      const result = await redis.methods.incr('counter')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('number')
      }
    })
  })

  describe('methods.incrby', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should increment by specific amount', async () => {
      const result = await redis.methods.incrby('counter', 5)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('number')
      }
    })
  })

  describe('methods.decr', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should decrement a value', async () => {
      const result = await redis.methods.decr('counter')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('number')
      }
    })
  })

  // JSON operations (RedisJSON-like)
  describe('methods.jsonSet', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should set JSON value', async () => {
      const result = await redis.methods.jsonSet('myobj', '$', { name: 'Alice', age: 30 })
      expect(result.success).toBe(true)
    })
  })

  describe('methods.jsonGet', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should get JSON value', async () => {
      const result = await redis.methods.jsonGet('myobj', '$')
      expect(result.success).toBe(true)
    })
  })

  // Pub/Sub operations
  describe('methods.publish', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should publish message to channel', async () => {
      const result = await redis.methods.publish('mychannel', 'hello')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(typeof result.data).toBe('number')
      }
    })
  })

  // Utility operations
  describe('methods.keys', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should find keys matching pattern', async () => {
      const result = await redis.methods.keys('user:*')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(Array.isArray(result.data)).toBe(true)
      }
    })
  })

  describe('methods.scan', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should scan keys', async () => {
      const result = await redis.methods.scan(0, { match: 'user:*', count: 10 })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.cursor).toBeDefined()
        expect(Array.isArray(result.data.keys)).toBe(true)
      }
    })
  })

  describe('methods.ping', () => {
    beforeEach(async () => {
      const config: RedisConfig = { url: 'redis://localhost:6379' }
      await redis.init(config)
    })

    it('should ping the server', async () => {
      const result = await redis.methods.ping()
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe('PONG')
      }
    })
  })
})

describe('createRedisIntegration', () => {
  it('should create a new RedisIntegration instance', () => {
    const redis = createRedisIntegration()
    expect(redis).toBeInstanceOf(RedisIntegration)
    expect(redis.name).toBe('redis')
  })
})
