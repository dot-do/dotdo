/**
 * HashStore tests
 *
 * RED phase: These tests define the expected behavior of HashStore.
 * All tests should FAIL until implementation is complete.
 *
 * HashStore provides Redis-like hash operations:
 * - hget/hset/hdel for individual fields
 * - hgetall for bulk retrieval
 * - hincrby/hincrbyfloat for atomic increments
 * - TTL inheritance from parent key
 *
 * Maps to Redis: HGET, HSET, HDEL, HGETALL, HKEYS, HVALS, HLEN,
 *               HINCRBY, HINCRBYFLOAT, HSETNX, HEXISTS
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createHashStore,
  type HashStore,
  type HashStoreOptions,
} from '../hash-store'
import { TestMetricsCollector } from '../observability'

// ============================================================================
// TEST DATA AND HELPERS
// ============================================================================

interface UserProfile {
  name: string
  email: string
  age: number
  premium: boolean
}

function createTestStore<T = string>(options?: HashStoreOptions): HashStore<T> {
  return createHashStore<T>(options)
}

// ============================================================================
// BASIC HSET/HGET OPERATIONS
// ============================================================================

describe('HashStore', () => {
  describe('basic hset/hget operations', () => {
    it('should set and get a single field', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')
      const result = await store.hget('user:1', 'name')

      expect(result).toBe('Alice')
    })

    it('should return null for non-existent field', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')
      const result = await store.hget('user:1', 'email')

      expect(result).toBeNull()
    })

    it('should return null for non-existent key', async () => {
      const store = createTestStore()

      const result = await store.hget('nonexistent', 'field')

      expect(result).toBeNull()
    })

    it('should overwrite existing field', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')
      await store.hset('user:1', 'name', 'Bob')
      const result = await store.hget('user:1', 'name')

      expect(result).toBe('Bob')
    })

    it('should handle multiple fields in same hash', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')
      await store.hset('user:1', 'email', 'alice@example.com')
      await store.hset('user:1', 'city', 'NYC')

      expect(await store.hget('user:1', 'name')).toBe('Alice')
      expect(await store.hget('user:1', 'email')).toBe('alice@example.com')
      expect(await store.hget('user:1', 'city')).toBe('NYC')
    })

    it('should handle multiple independent hashes', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')
      await store.hset('user:2', 'name', 'Bob')

      expect(await store.hget('user:1', 'name')).toBe('Alice')
      expect(await store.hget('user:2', 'name')).toBe('Bob')
    })

    it('should return 1 for new field, 0 for overwrite', async () => {
      const store = createTestStore()

      const firstSet = await store.hset('user:1', 'name', 'Alice')
      const secondSet = await store.hset('user:1', 'name', 'Bob')

      expect(firstSet).toBe(1)
      expect(secondSet).toBe(0)
    })

    it('should handle empty string field name', async () => {
      const store = createTestStore()

      await store.hset('key', '', 'empty field')
      const result = await store.hget('key', '')

      expect(result).toBe('empty field')
    })

    it('should handle special characters in field names', async () => {
      const store = createTestStore()

      await store.hset('key', 'field:with:colons', 'value1')
      await store.hset('key', 'field/with/slashes', 'value2')
      await store.hset('key', 'field.with.dots', 'value3')

      expect(await store.hget('key', 'field:with:colons')).toBe('value1')
      expect(await store.hget('key', 'field/with/slashes')).toBe('value2')
      expect(await store.hget('key', 'field.with.dots')).toBe('value3')
    })
  })

  // ============================================================================
  // HMSET - SET MULTIPLE FIELDS
  // ============================================================================

  describe('hmset - set multiple fields', () => {
    it('should set multiple fields at once', async () => {
      const store = createTestStore()

      await store.hmset('user:1', {
        name: 'Alice',
        email: 'alice@example.com',
        city: 'NYC',
      })

      expect(await store.hget('user:1', 'name')).toBe('Alice')
      expect(await store.hget('user:1', 'email')).toBe('alice@example.com')
      expect(await store.hget('user:1', 'city')).toBe('NYC')
    })

    it('should overwrite existing fields and add new ones', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')
      await store.hset('user:1', 'email', 'old@example.com')

      await store.hmset('user:1', {
        email: 'new@example.com',
        city: 'NYC',
      })

      expect(await store.hget('user:1', 'name')).toBe('Alice')
      expect(await store.hget('user:1', 'email')).toBe('new@example.com')
      expect(await store.hget('user:1', 'city')).toBe('NYC')
    })

    it('should handle empty object', async () => {
      const store = createTestStore()

      await store.hmset('user:1', {})

      // Hash should exist but be empty
      expect(await store.hlen('user:1')).toBe(0)
    })
  })

  // ============================================================================
  // HDEL - DELETE FIELDS
  // ============================================================================

  describe('hdel - delete fields', () => {
    it('should delete a single field', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')
      await store.hset('user:1', 'email', 'alice@example.com')

      const deleted = await store.hdel('user:1', 'name')

      expect(deleted).toBe(1)
      expect(await store.hget('user:1', 'name')).toBeNull()
      expect(await store.hget('user:1', 'email')).toBe('alice@example.com')
    })

    it('should delete multiple fields', async () => {
      const store = createTestStore()

      await store.hmset('user:1', {
        name: 'Alice',
        email: 'alice@example.com',
        city: 'NYC',
      })

      const deleted = await store.hdel('user:1', 'name', 'city')

      expect(deleted).toBe(2)
      expect(await store.hget('user:1', 'name')).toBeNull()
      expect(await store.hget('user:1', 'city')).toBeNull()
      expect(await store.hget('user:1', 'email')).toBe('alice@example.com')
    })

    it('should return 0 for non-existent fields', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')

      const deleted = await store.hdel('user:1', 'nonexistent')

      expect(deleted).toBe(0)
    })

    it('should return 0 for non-existent key', async () => {
      const store = createTestStore()

      const deleted = await store.hdel('nonexistent', 'field')

      expect(deleted).toBe(0)
    })

    it('should count only existing fields in multi-delete', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')

      const deleted = await store.hdel('user:1', 'name', 'nonexistent1', 'nonexistent2')

      expect(deleted).toBe(1)
    })
  })

  // ============================================================================
  // HGETALL - GET ALL FIELDS
  // ============================================================================

  describe('hgetall - get all fields', () => {
    it('should return all fields and values', async () => {
      const store = createTestStore()

      await store.hmset('user:1', {
        name: 'Alice',
        email: 'alice@example.com',
        city: 'NYC',
      })

      const result = await store.hgetall('user:1')

      expect(result).toEqual({
        name: 'Alice',
        email: 'alice@example.com',
        city: 'NYC',
      })
    })

    it('should return empty object for non-existent key', async () => {
      const store = createTestStore()

      const result = await store.hgetall('nonexistent')

      expect(result).toEqual({})
    })

    it('should return empty object after all fields deleted', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')
      await store.hdel('user:1', 'name')

      const result = await store.hgetall('user:1')

      expect(result).toEqual({})
    })
  })

  // ============================================================================
  // HKEYS - GET ALL FIELD NAMES
  // ============================================================================

  describe('hkeys - get all field names', () => {
    it('should return all field names', async () => {
      const store = createTestStore()

      await store.hmset('user:1', {
        name: 'Alice',
        email: 'alice@example.com',
        city: 'NYC',
      })

      const keys = await store.hkeys('user:1')

      expect(keys).toHaveLength(3)
      expect(keys).toContain('name')
      expect(keys).toContain('email')
      expect(keys).toContain('city')
    })

    it('should return empty array for non-existent key', async () => {
      const store = createTestStore()

      const keys = await store.hkeys('nonexistent')

      expect(keys).toEqual([])
    })
  })

  // ============================================================================
  // HVALS - GET ALL VALUES
  // ============================================================================

  describe('hvals - get all values', () => {
    it('should return all values', async () => {
      const store = createTestStore()

      await store.hmset('user:1', {
        name: 'Alice',
        email: 'alice@example.com',
        city: 'NYC',
      })

      const values = await store.hvals('user:1')

      expect(values).toHaveLength(3)
      expect(values).toContain('Alice')
      expect(values).toContain('alice@example.com')
      expect(values).toContain('NYC')
    })

    it('should return empty array for non-existent key', async () => {
      const store = createTestStore()

      const values = await store.hvals('nonexistent')

      expect(values).toEqual([])
    })
  })

  // ============================================================================
  // HLEN - GET FIELD COUNT
  // ============================================================================

  describe('hlen - get field count', () => {
    it('should return number of fields', async () => {
      const store = createTestStore()

      await store.hmset('user:1', {
        name: 'Alice',
        email: 'alice@example.com',
        city: 'NYC',
      })

      const len = await store.hlen('user:1')

      expect(len).toBe(3)
    })

    it('should return 0 for non-existent key', async () => {
      const store = createTestStore()

      const len = await store.hlen('nonexistent')

      expect(len).toBe(0)
    })

    it('should update after adding/removing fields', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')
      expect(await store.hlen('user:1')).toBe(1)

      await store.hset('user:1', 'email', 'alice@example.com')
      expect(await store.hlen('user:1')).toBe(2)

      await store.hdel('user:1', 'name')
      expect(await store.hlen('user:1')).toBe(1)
    })
  })

  // ============================================================================
  // HEXISTS - CHECK FIELD EXISTS
  // ============================================================================

  describe('hexists - check field exists', () => {
    it('should return true for existing field', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')

      const exists = await store.hexists('user:1', 'name')

      expect(exists).toBe(true)
    })

    it('should return false for non-existent field', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')

      const exists = await store.hexists('user:1', 'email')

      expect(exists).toBe(false)
    })

    it('should return false for non-existent key', async () => {
      const store = createTestStore()

      const exists = await store.hexists('nonexistent', 'field')

      expect(exists).toBe(false)
    })

    it('should return false after field deleted', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')
      await store.hdel('user:1', 'name')

      const exists = await store.hexists('user:1', 'name')

      expect(exists).toBe(false)
    })
  })

  // ============================================================================
  // HSETNX - SET IF NOT EXISTS
  // ============================================================================

  describe('hsetnx - set if not exists', () => {
    it('should set field if it does not exist', async () => {
      const store = createTestStore()

      const result = await store.hsetnx('user:1', 'name', 'Alice')

      expect(result).toBe(1)
      expect(await store.hget('user:1', 'name')).toBe('Alice')
    })

    it('should not overwrite existing field', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')

      const result = await store.hsetnx('user:1', 'name', 'Bob')

      expect(result).toBe(0)
      expect(await store.hget('user:1', 'name')).toBe('Alice')
    })

    it('should allow setting other fields even if one exists', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')

      const result = await store.hsetnx('user:1', 'email', 'alice@example.com')

      expect(result).toBe(1)
      expect(await store.hget('user:1', 'email')).toBe('alice@example.com')
    })
  })

  // ============================================================================
  // HINCRBY - INCREMENT INTEGER FIELD
  // ============================================================================

  describe('hincrby - increment integer field', () => {
    it('should increment existing integer field', async () => {
      const store = createTestStore<number>()

      await store.hset('stats', 'count', 10)

      const result = await store.hincrby('stats', 'count', 5)

      expect(result).toBe(15)
      expect(await store.hget('stats', 'count')).toBe(15)
    })

    it('should create field with increment value if not exists', async () => {
      const store = createTestStore<number>()

      const result = await store.hincrby('stats', 'count', 5)

      expect(result).toBe(5)
      expect(await store.hget('stats', 'count')).toBe(5)
    })

    it('should handle negative increments (decrement)', async () => {
      const store = createTestStore<number>()

      await store.hset('stats', 'count', 10)

      const result = await store.hincrby('stats', 'count', -3)

      expect(result).toBe(7)
    })

    it('should handle zero increment', async () => {
      const store = createTestStore<number>()

      await store.hset('stats', 'count', 10)

      const result = await store.hincrby('stats', 'count', 0)

      expect(result).toBe(10)
    })

    it('should handle large increments', async () => {
      const store = createTestStore<number>()

      await store.hset('stats', 'count', 0)

      const result = await store.hincrby('stats', 'count', 1000000)

      expect(result).toBe(1000000)
    })

    it('should handle negative values becoming more negative', async () => {
      const store = createTestStore<number>()

      await store.hset('balance', 'amount', -5)

      const result = await store.hincrby('balance', 'amount', -10)

      expect(result).toBe(-15)
    })
  })

  // ============================================================================
  // HINCRBYFLOAT - INCREMENT FLOAT FIELD
  // ============================================================================

  describe('hincrbyfloat - increment float field', () => {
    it('should increment existing float field', async () => {
      const store = createTestStore<number>()

      await store.hset('stats', 'rate', 1.5)

      const result = await store.hincrbyfloat('stats', 'rate', 0.5)

      expect(result).toBeCloseTo(2.0)
      expect(await store.hget('stats', 'rate')).toBeCloseTo(2.0)
    })

    it('should create field with increment value if not exists', async () => {
      const store = createTestStore<number>()

      const result = await store.hincrbyfloat('stats', 'rate', 3.14)

      expect(result).toBeCloseTo(3.14)
    })

    it('should handle negative float increments', async () => {
      const store = createTestStore<number>()

      await store.hset('stats', 'rate', 5.5)

      const result = await store.hincrbyfloat('stats', 'rate', -2.3)

      expect(result).toBeCloseTo(3.2)
    })

    it('should handle integer values as floats', async () => {
      const store = createTestStore<number>()

      await store.hset('stats', 'value', 10)

      const result = await store.hincrbyfloat('stats', 'value', 0.5)

      expect(result).toBeCloseTo(10.5)
    })

    it('should handle small float precision', async () => {
      const store = createTestStore<number>()

      await store.hset('stats', 'precise', 0.1)

      const result = await store.hincrbyfloat('stats', 'precise', 0.2)

      // Note: floating point precision - 0.1 + 0.2 = 0.30000000000000004
      expect(result).toBeCloseTo(0.3, 10)
    })
  })

  // ============================================================================
  // HMGET - GET MULTIPLE FIELDS
  // ============================================================================

  describe('hmget - get multiple fields', () => {
    it('should get multiple fields at once', async () => {
      const store = createTestStore()

      await store.hmset('user:1', {
        name: 'Alice',
        email: 'alice@example.com',
        city: 'NYC',
      })

      const result = await store.hmget('user:1', 'name', 'email')

      expect(result).toEqual(['Alice', 'alice@example.com'])
    })

    it('should return null for non-existent fields', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')

      const result = await store.hmget('user:1', 'name', 'email', 'city')

      expect(result).toEqual(['Alice', null, null])
    })

    it('should return all nulls for non-existent key', async () => {
      const store = createTestStore()

      const result = await store.hmget('nonexistent', 'field1', 'field2')

      expect(result).toEqual([null, null])
    })

    it('should preserve field order', async () => {
      const store = createTestStore()

      await store.hmset('user:1', {
        a: '1',
        b: '2',
        c: '3',
      })

      const result = await store.hmget('user:1', 'c', 'a', 'b')

      expect(result).toEqual(['3', '1', '2'])
    })
  })

  // ============================================================================
  // TTL - TIME TO LIVE (HASH LEVEL)
  // ============================================================================

  describe('TTL at hash level', () => {
    it('should set TTL on hash creation', async () => {
      vi.useFakeTimers()
      try {
        const store = createTestStore({ enableTTL: true })

        await store.hset('user:1', 'name', 'Alice', { ttl: 1000 })

        // Should exist immediately
        expect(await store.hget('user:1', 'name')).toBe('Alice')

        // Advance past TTL
        vi.advanceTimersByTime(1500)

        // Should be expired
        expect(await store.hget('user:1', 'name')).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should expire entire hash, not individual fields', async () => {
      vi.useFakeTimers()
      try {
        const store = createTestStore({ enableTTL: true })

        await store.hset('user:1', 'name', 'Alice', { ttl: 1000 })
        await store.hset('user:1', 'email', 'alice@example.com') // No TTL extension

        vi.advanceTimersByTime(1500)

        // Both fields should be expired (whole hash expires)
        expect(await store.hget('user:1', 'name')).toBeNull()
        expect(await store.hget('user:1', 'email')).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should update TTL with setTTL', async () => {
      vi.useFakeTimers()
      try {
        const store = createTestStore({ enableTTL: true })

        await store.hset('user:1', 'name', 'Alice', { ttl: 500 })
        await store.setTTL('user:1', 2000)

        vi.advanceTimersByTime(1000)

        // Should still exist due to TTL extension
        expect(await store.hget('user:1', 'name')).toBe('Alice')

        vi.advanceTimersByTime(1500)

        // Now should be expired
        expect(await store.hget('user:1', 'name')).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should return current TTL', async () => {
      vi.useFakeTimers()
      try {
        const store = createTestStore({ enableTTL: true })

        await store.hset('user:1', 'name', 'Alice', { ttl: 5000 })

        vi.advanceTimersByTime(2000)

        const ttl = await store.getTTL('user:1')

        // Should have ~3000ms remaining
        expect(ttl).toBeGreaterThan(2500)
        expect(ttl).toBeLessThanOrEqual(3000)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should return -1 for no TTL', async () => {
      const store = createTestStore({ enableTTL: true })

      await store.hset('user:1', 'name', 'Alice') // No TTL

      const ttl = await store.getTTL('user:1')

      expect(ttl).toBe(-1)
    })

    it('should return -2 for non-existent key', async () => {
      const store = createTestStore({ enableTTL: true })

      const ttl = await store.getTTL('nonexistent')

      expect(ttl).toBe(-2)
    })

    it('should remove TTL with persist', async () => {
      vi.useFakeTimers()
      try {
        const store = createTestStore({ enableTTL: true })

        await store.hset('user:1', 'name', 'Alice', { ttl: 1000 })
        await store.persist('user:1')

        vi.advanceTimersByTime(2000)

        // Should still exist
        expect(await store.hget('user:1', 'name')).toBe('Alice')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  // ============================================================================
  // DEL - DELETE ENTIRE HASH
  // ============================================================================

  describe('del - delete entire hash', () => {
    it('should delete entire hash', async () => {
      const store = createTestStore()

      await store.hmset('user:1', {
        name: 'Alice',
        email: 'alice@example.com',
      })

      const deleted = await store.del('user:1')

      expect(deleted).toBe(1)
      expect(await store.hgetall('user:1')).toEqual({})
    })

    it('should return 0 for non-existent key', async () => {
      const store = createTestStore()

      const deleted = await store.del('nonexistent')

      expect(deleted).toBe(0)
    })

    it('should delete multiple hashes', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')
      await store.hset('user:2', 'name', 'Bob')
      await store.hset('user:3', 'name', 'Charlie')

      const deleted = await store.del('user:1', 'user:2', 'nonexistent')

      expect(deleted).toBe(2)
      expect(await store.hgetall('user:1')).toEqual({})
      expect(await store.hgetall('user:2')).toEqual({})
      expect(await store.hget('user:3', 'name')).toBe('Charlie')
    })
  })

  // ============================================================================
  // TYPE SAFETY
  // ============================================================================

  describe('type safety', () => {
    it('should preserve generic type for complex values', async () => {
      interface ComplexValue {
        nested: { data: string }
        items: number[]
      }

      const store = createHashStore<ComplexValue>()

      await store.hset('key', 'field', { nested: { data: 'test' }, items: [1, 2, 3] })
      const result = await store.hget('key', 'field')

      if (result) {
        expect(result.nested.data).toBe('test')
        expect(result.items).toEqual([1, 2, 3])
      }
    })

    it('should handle number type', async () => {
      const store = createHashStore<number>()

      await store.hset('stats', 'views', 100)
      await store.hset('stats', 'likes', 50)

      const result = await store.hgetall('stats')

      expect(result).toEqual({ views: 100, likes: 50 })
    })

    it('should handle boolean type', async () => {
      const store = createHashStore<boolean>()

      await store.hset('flags', 'active', true)
      await store.hset('flags', 'premium', false)

      expect(await store.hget('flags', 'active')).toBe(true)
      expect(await store.hget('flags', 'premium')).toBe(false)
    })
  })

  // ============================================================================
  // OBSERVABILITY
  // ============================================================================

  describe('observability', () => {
    it('should record metrics for operations', async () => {
      const metrics = new TestMetricsCollector()
      const store = createTestStore({ metrics })

      await store.hset('user:1', 'name', 'Alice')
      await store.hget('user:1', 'name')
      await store.hdel('user:1', 'name')

      expect(metrics.getLatencies('hash_store.hset.latency').length).toBeGreaterThan(0)
      expect(metrics.getLatencies('hash_store.hget.latency').length).toBeGreaterThan(0)
      expect(metrics.getLatencies('hash_store.hdel.latency').length).toBeGreaterThan(0)
    })

    it('should track hash count gauge', async () => {
      const metrics = new TestMetricsCollector()
      const store = createTestStore({ metrics })

      await store.hset('hash1', 'field', 'value')
      await store.hset('hash2', 'field', 'value')

      const hashCount = metrics.getLatestGauge('hash_store.hash_count')
      expect(hashCount).toBe(2)
    })

    it('should track field count gauge', async () => {
      const metrics = new TestMetricsCollector()
      const store = createTestStore({ metrics })

      await store.hmset('user:1', {
        name: 'Alice',
        email: 'alice@example.com',
        city: 'NYC',
      })

      const fieldCount = metrics.getLatestGauge('hash_store.field_count')
      expect(fieldCount).toBe(3)
    })
  })

  // ============================================================================
  // CONCURRENT OPERATIONS
  // ============================================================================

  describe('concurrent operations', () => {
    it('should handle concurrent hset to different keys', async () => {
      const store = createTestStore()

      await Promise.all([
        store.hset('user:1', 'name', 'Alice'),
        store.hset('user:2', 'name', 'Bob'),
        store.hset('user:3', 'name', 'Charlie'),
      ])

      expect(await store.hget('user:1', 'name')).toBe('Alice')
      expect(await store.hget('user:2', 'name')).toBe('Bob')
      expect(await store.hget('user:3', 'name')).toBe('Charlie')
    })

    it('should handle concurrent hset to same key different fields', async () => {
      const store = createTestStore()

      await Promise.all([
        store.hset('user:1', 'name', 'Alice'),
        store.hset('user:1', 'email', 'alice@example.com'),
        store.hset('user:1', 'city', 'NYC'),
      ])

      expect(await store.hget('user:1', 'name')).toBe('Alice')
      expect(await store.hget('user:1', 'email')).toBe('alice@example.com')
      expect(await store.hget('user:1', 'city')).toBe('NYC')
    })

    it('should handle concurrent hincrby to same field (atomic)', async () => {
      const store = createTestStore<number>()

      await store.hset('counter', 'value', 0)

      await Promise.all(
        Array.from({ length: 10 }, () => store.hincrby('counter', 'value', 1))
      )

      const result = await store.hget('counter', 'value')
      expect(result).toBe(10)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle very long field names', async () => {
      const store = createTestStore()
      const longField = 'a'.repeat(10000)

      await store.hset('key', longField, 'value')
      const result = await store.hget('key', longField)

      expect(result).toBe('value')
    })

    it('should handle very long values', async () => {
      const store = createTestStore()
      const longValue = 'x'.repeat(100000)

      await store.hset('key', 'field', longValue)
      const result = await store.hget('key', 'field')

      expect(result).toBe(longValue)
    })

    it('should handle unicode in field names and values', async () => {
      const store = createTestStore()

      await store.hset('key', 'field', 'value')
      await store.hset('key', 'field', 'value')
      await store.hset('key', 'emoji', 'thumbsup')

      expect(await store.hget('key', 'field')).toBe('value')
      expect(await store.hget('key', 'field')).toBe('value')
      expect(await store.hget('key', 'emoji')).toBe('thumbsup')
    })

    it('should handle null-like values in fields', async () => {
      const store = createHashStore<string | null>()

      await store.hset('key', 'nullable', null)
      const result = await store.hget('key', 'nullable')

      expect(result).toBeNull()
    })
  })

  // ============================================================================
  // KEYS - LIST ALL HASH KEYS
  // ============================================================================

  describe('keys - list all hash keys', () => {
    it('should return all hash keys', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')
      await store.hset('user:2', 'name', 'Bob')
      await store.hset('product:1', 'name', 'Widget')

      const keys = await store.keys()

      expect(keys).toHaveLength(3)
      expect(keys).toContain('user:1')
      expect(keys).toContain('user:2')
      expect(keys).toContain('product:1')
    })

    it('should return keys matching pattern', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')
      await store.hset('user:2', 'name', 'Bob')
      await store.hset('product:1', 'name', 'Widget')

      const keys = await store.keys('user:*')

      expect(keys).toHaveLength(2)
      expect(keys).toContain('user:1')
      expect(keys).toContain('user:2')
    })

    it('should return empty array when no keys', async () => {
      const store = createTestStore()

      const keys = await store.keys()

      expect(keys).toEqual([])
    })
  })

  // ============================================================================
  // SCAN - ITERATE OVER HASH KEYS
  // ============================================================================

  describe('scan - iterate over hash keys', () => {
    it('should iterate over all keys', async () => {
      const store = createTestStore()

      for (let i = 0; i < 20; i++) {
        await store.hset(`key:${i}`, 'field', `value${i}`)
      }

      const allKeys: string[] = []
      for await (const key of store.scan()) {
        allKeys.push(key)
      }

      expect(allKeys).toHaveLength(20)
    })

    it('should support count hint for batch size', async () => {
      const store = createTestStore()

      for (let i = 0; i < 50; i++) {
        await store.hset(`key:${i}`, 'field', `value${i}`)
      }

      const allKeys: string[] = []
      for await (const key of store.scan({ count: 10 })) {
        allKeys.push(key)
      }

      expect(allKeys).toHaveLength(50)
    })

    it('should support pattern matching', async () => {
      const store = createTestStore()

      await store.hset('user:1', 'name', 'Alice')
      await store.hset('user:2', 'name', 'Bob')
      await store.hset('product:1', 'name', 'Widget')

      const keys: string[] = []
      for await (const key of store.scan({ match: 'user:*' })) {
        keys.push(key)
      }

      expect(keys).toHaveLength(2)
      expect(keys).toContain('user:1')
      expect(keys).toContain('user:2')
    })
  })
})
