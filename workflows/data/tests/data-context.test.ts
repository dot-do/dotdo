/**
 * Tests for $ Data API - Unified data primitives
 *
 * Tests the founder-native data API:
 * - $.data.get/set/delete - Basic CRUD
 * - $.data.list - Query collections
 * - $.data.query - Fluent query API
 * - $.data.watch - Real-time subscriptions
 * - Integration with specialized namespaces
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createDataContext,
  createMinimalDataContext,
  type FullDataContext,
  type DataNamespace,
  type DataStorage,
  type DataCollection,
  type WatchEvent,
} from '../index'

describe('$ Data API', () => {
  describe('$.data - Basic CRUD Operations', () => {
    let $: { data: DataNamespace; _storage: DataStorage }

    beforeEach(() => {
      $ = createMinimalDataContext()
    })

    describe('$.data.get/set', () => {
      it('should set and get a string value', async () => {
        await $.data.set('greeting', 'hello world')
        const result = await $.data.get<string>('greeting')
        expect(result).toBe('hello world')
      })

      it('should set and get an object value', async () => {
        const user = { name: 'Alice', age: 30, active: true }
        await $.data.set('user:1', user)
        const result = await $.data.get<typeof user>('user:1')
        expect(result).toEqual(user)
      })

      it('should return null for non-existent key', async () => {
        const result = await $.data.get('non-existent')
        expect(result).toBeNull()
      })

      it('should overwrite existing value', async () => {
        await $.data.set('key', 'first')
        await $.data.set('key', 'second')
        const result = await $.data.get<string>('key')
        expect(result).toBe('second')
      })

      it('should support TTL expiration', async () => {
        vi.useFakeTimers()

        await $.data.set('expires', 'value', { ttl: 1000 })

        // Before expiration
        let result = await $.data.get<string>('expires')
        expect(result).toBe('value')

        // After expiration
        vi.advanceTimersByTime(1500)
        result = await $.data.get<string>('expires')
        expect(result).toBeNull()

        vi.useRealTimers()
      })
    })

    describe('$.data.delete', () => {
      it('should delete an existing key', async () => {
        await $.data.set('to-delete', 'value')
        const deleted = await $.data.delete('to-delete')
        expect(deleted).toBe(true)

        const result = await $.data.get('to-delete')
        expect(result).toBeNull()
      })

      it('should return false for non-existent key', async () => {
        const deleted = await $.data.delete('non-existent')
        expect(deleted).toBe(false)
      })
    })

    describe('$.data.has', () => {
      it('should return true for existing key', async () => {
        await $.data.set('exists', 'value')
        const exists = await $.data.has('exists')
        expect(exists).toBe(true)
      })

      it('should return false for non-existent key', async () => {
        const exists = await $.data.has('non-existent')
        expect(exists).toBe(false)
      })

      it('should return false for expired key', async () => {
        vi.useFakeTimers()

        await $.data.set('expires', 'value', { ttl: 100 })
        vi.advanceTimersByTime(200)

        const exists = await $.data.has('expires')
        expect(exists).toBe(false)

        vi.useRealTimers()
      })
    })

    describe('$.data.keys', () => {
      beforeEach(async () => {
        await $.data.set('user:1', { name: 'Alice' })
        await $.data.set('user:2', { name: 'Bob' })
        await $.data.set('order:1', { total: 100 })
        await $.data.set('config', { debug: true })
      })

      it('should list all keys', async () => {
        const keys = await $.data.keys()
        expect(keys).toHaveLength(4)
        expect(keys).toContain('user:1')
        expect(keys).toContain('user:2')
        expect(keys).toContain('order:1')
        expect(keys).toContain('config')
      })

      it('should filter keys by pattern', async () => {
        const keys = await $.data.keys('user:*')
        expect(keys).toHaveLength(2)
        expect(keys).toContain('user:1')
        expect(keys).toContain('user:2')
      })

      it('should support exact pattern match', async () => {
        const keys = await $.data.keys('config')
        expect(keys).toEqual(['config'])
      })
    })
  })

  describe('$.data.query - Fluent Query API', () => {
    let $: { data: DataNamespace; _storage: DataStorage }

    beforeEach(async () => {
      $ = createMinimalDataContext()

      // Seed test data
      await $.data.set('user:1', { id: '1', name: 'Alice', age: 30, role: 'admin', active: true })
      await $.data.set('user:2', { id: '2', name: 'Bob', age: 25, role: 'user', active: true })
      await $.data.set('user:3', { id: '3', name: 'Charlie', age: 35, role: 'user', active: false })
      await $.data.set('user:4', { id: '4', name: 'Diana', age: 28, role: 'moderator', active: true })
    })

    describe('where() conditions', () => {
      it('should filter by equality', async () => {
        const results = await $.data.query<{ role: string }>().where({ role: 'admin' }).get()
        expect(results).toHaveLength(1)
        expect(results[0]!.role).toBe('admin')
      })

      it('should filter by multiple conditions', async () => {
        const results = await $.data
          .query<{ role: string; active: boolean }>()
          .where({ role: 'user', active: true })
          .get()
        expect(results).toHaveLength(1)
      })
    })

    describe('comparison operators', () => {
      it('should filter with gt()', async () => {
        const results = await $.data.query<{ age: number }>().gt('age', 30).get()
        expect(results).toHaveLength(1)
        expect(results[0]!.age).toBe(35)
      })

      it('should filter with gte()', async () => {
        const results = await $.data.query<{ age: number }>().gte('age', 30).get()
        expect(results).toHaveLength(2)
      })

      it('should filter with lt()', async () => {
        const results = await $.data.query<{ age: number }>().lt('age', 28).get()
        expect(results).toHaveLength(1)
        expect(results[0]!.age).toBe(25)
      })

      it('should filter with lte()', async () => {
        const results = await $.data.query<{ age: number }>().lte('age', 28).get()
        expect(results).toHaveLength(2)
      })

      it('should filter with in()', async () => {
        const results = await $.data.query<{ role: string }>().in('role', ['admin', 'moderator']).get()
        expect(results).toHaveLength(2)
      })
    })

    describe('orderBy()', () => {
      it('should sort ascending', async () => {
        const results = await $.data.query<{ age: number }>().orderBy('age', 'asc').get()
        expect(results.map((r) => r.age)).toEqual([25, 28, 30, 35])
      })

      it('should sort descending', async () => {
        const results = await $.data.query<{ age: number }>().orderBy('age', 'desc').get()
        expect(results.map((r) => r.age)).toEqual([35, 30, 28, 25])
      })

      it('should sort by multiple fields', async () => {
        const results = await $.data.query<{ role: string; age: number }>().orderBy('role', 'asc').orderBy('age', 'desc').get()

        // Group by role (admin, moderator, user, user) then by age desc within role
        expect(results[0]!.role).toBe('admin')
      })
    })

    describe('limit() and offset()', () => {
      it('should limit results', async () => {
        const results = await $.data.query().limit(2).get()
        expect(results).toHaveLength(2)
      })

      it('should offset results', async () => {
        const results = await $.data.query<{ age: number }>().orderBy('age', 'asc').offset(2).get()
        expect(results).toHaveLength(2)
        expect(results[0]!.age).toBe(30)
      })

      it('should combine limit and offset', async () => {
        const results = await $.data.query<{ age: number }>().orderBy('age', 'asc').offset(1).limit(2).get()
        expect(results).toHaveLength(2)
        expect(results.map((r) => r.age)).toEqual([28, 30])
      })
    })

    describe('first()', () => {
      it('should return first result', async () => {
        const result = await $.data.query<{ age: number }>().orderBy('age', 'asc').first()
        expect(result).not.toBeNull()
        expect(result!.age).toBe(25)
      })

      it('should return null when no results', async () => {
        const result = await $.data.query<{ role: string }>().where({ role: 'superadmin' }).first()
        expect(result).toBeNull()
      })
    })

    describe('count()', () => {
      it('should count all records', async () => {
        const count = await $.data.query().count()
        expect(count).toBe(4)
      })

      it('should count filtered records', async () => {
        const count = await $.data.query<{ active: boolean }>().where({ active: true }).count()
        expect(count).toBe(3)
      })
    })

    describe('paginate()', () => {
      it('should return paginated results', async () => {
        const page1 = await $.data.query<{ age: number }>().orderBy('age', 'asc').paginate({ limit: 2 })

        expect(page1.items).toHaveLength(2)
        expect(page1.total).toBe(4)
        expect(page1.hasMore).toBe(true)
        expect(page1.cursor).toBeDefined()
      })

      it('should fetch next page with cursor', async () => {
        const page1 = await $.data.query<{ age: number }>().orderBy('age', 'asc').paginate({ limit: 2 })

        const page2 = await $.data.query<{ age: number }>().orderBy('age', 'asc').paginate({ limit: 2, cursor: page1.cursor })

        expect(page2.items).toHaveLength(2)
        expect(page2.items.map((r) => r.age)).toEqual([30, 35])
        expect(page2.hasMore).toBe(false)
      })
    })
  })

  describe('$.data.collection - Typed Collections', () => {
    interface User {
      id: string
      name: string
      email: string
      age: number
    }

    let $: { data: DataNamespace; _storage: DataStorage }
    let users: DataCollection<User>

    beforeEach(() => {
      $ = createMinimalDataContext()
      users = $.data.collection<User>('users')
    })

    it('should create and access typed collection', async () => {
      await users.set('1', { id: '1', name: 'Alice', email: 'alice@example.com', age: 30 })
      const user = await users.get('1')
      expect(user).toEqual({ id: '1', name: 'Alice', email: 'alice@example.com', age: 30 })
    })

    it('should check if key exists', async () => {
      await users.set('1', { id: '1', name: 'Alice', email: 'alice@example.com', age: 30 })
      expect(await users.has('1')).toBe(true)
      expect(await users.has('999')).toBe(false)
    })

    it('should delete from collection', async () => {
      await users.set('1', { id: '1', name: 'Alice', email: 'alice@example.com', age: 30 })
      const deleted = await users.delete('1')
      expect(deleted).toBe(true)
      expect(await users.get('1')).toBeNull()
    })

    it('should list collection items', async () => {
      await users.set('1', { id: '1', name: 'Alice', email: 'alice@example.com', age: 30 })
      await users.set('2', { id: '2', name: 'Bob', email: 'bob@example.com', age: 25 })

      const all = await users.list()
      expect(all).toHaveLength(2)
    })

    it('should filter collection items', async () => {
      await users.set('1', { id: '1', name: 'Alice', email: 'alice@example.com', age: 30 })
      await users.set('2', { id: '2', name: 'Bob', email: 'bob@example.com', age: 25 })

      const filtered = await users.list({ where: { age: { gt: 27 } } })
      expect(filtered).toHaveLength(1)
      expect(filtered[0]!.name).toBe('Alice')
    })

    it('should use query builder on collection', async () => {
      await users.set('1', { id: '1', name: 'Alice', email: 'alice@example.com', age: 30 })
      await users.set('2', { id: '2', name: 'Bob', email: 'bob@example.com', age: 25 })
      await users.set('3', { id: '3', name: 'Charlie', email: 'charlie@example.com', age: 35 })

      const results = await users.query().gt('age', 26).orderBy('age', 'asc').get()

      expect(results).toHaveLength(2)
      expect(results[0]!.name).toBe('Alice')
      expect(results[1]!.name).toBe('Charlie')
    })

    it('should count collection items', async () => {
      await users.set('1', { id: '1', name: 'Alice', email: 'alice@example.com', age: 30 })
      await users.set('2', { id: '2', name: 'Bob', email: 'bob@example.com', age: 25 })

      expect(await users.count()).toBe(2)
      expect(await users.count({ age: { gt: 27 } })).toBe(1)
    })
  })

  describe('$.data.watch - Real-time Subscriptions', () => {
    let $: { data: DataNamespace; _storage: DataStorage }

    beforeEach(() => {
      $ = createMinimalDataContext()
    })

    it('should notify on key creation', async () => {
      const events: WatchEvent<string>[] = []
      $.data.watch<string>('test-key', (event) => {
        events.push(event)
      })

      await $.data.set('test-key', 'new value')

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('created')
      expect(events[0]!.value).toBe('new value')
    })

    it('should notify on key update', async () => {
      await $.data.set('test-key', 'initial')

      const events: WatchEvent<string>[] = []
      $.data.watch<string>('test-key', (event) => {
        events.push(event)
      })

      await $.data.set('test-key', 'updated')

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('updated')
      expect(events[0]!.value).toBe('updated')
      expect(events[0]!.previousValue).toBe('initial')
    })

    it('should notify on key deletion', async () => {
      await $.data.set('test-key', 'value')

      const events: WatchEvent<string>[] = []
      $.data.watch<string>('test-key', (event) => {
        events.push(event)
      })

      await $.data.delete('test-key')

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('deleted')
      expect(events[0]!.previousValue).toBe('value')
    })

    it('should support pattern watching', async () => {
      const events: WatchEvent<{ name: string }>[] = []
      $.data.watch<{ name: string }>('user:*', (event) => {
        events.push(event)
      })

      await $.data.set('user:1', { name: 'Alice' })
      await $.data.set('user:2', { name: 'Bob' })
      await $.data.set('order:1', { total: 100 }) // Should not trigger

      expect(events).toHaveLength(2)
    })

    it('should unsubscribe correctly', async () => {
      const events: WatchEvent<string>[] = []
      const sub = $.data.watch<string>('test-key', (event) => {
        events.push(event)
      })

      await $.data.set('test-key', 'first')
      sub.unsubscribe()
      await $.data.set('test-key', 'second')

      expect(events).toHaveLength(1)
    })

    it('should watch collection changes', async () => {
      interface User {
        name: string
        active: boolean
      }

      const events: WatchEvent<User>[] = []
      const users = $.data.collection<User>('users')

      users.watch((event) => {
        events.push(event)
      })

      await users.set('1', { name: 'Alice', active: true })
      await users.set('1', { name: 'Alice Updated', active: true })
      await users.delete('1')

      expect(events).toHaveLength(3)
      expect(events[0]!.type).toBe('created')
      expect(events[1]!.type).toBe('updated')
      expect(events[2]!.type).toBe('deleted')
    })
  })

  describe('Full Data Context Integration', () => {
    let $: FullDataContext

    beforeEach(() => {
      $ = createDataContext()
    })

    it('should have all namespaces available', () => {
      expect($.data).toBeDefined()
      expect($.track).toBeDefined()
      expect($.measure).toBeDefined()
      expect($.experiment).toBeDefined()
      expect($.goal).toBeDefined()
      expect($.stream).toBeDefined()
      expect($.view).toBeDefined()
    })

    it('should integrate $.data with $.track', async () => {
      // Track an event
      await $.track.Purchase({ userId: 'user-1', amount: 100 })

      // Store computed result
      await $.data.set('metrics:user-1:purchases', { count: 1, total: 100 })

      const metrics = await $.data.get<{ count: number; total: number }>('metrics:user-1:purchases')
      expect(metrics).toEqual({ count: 1, total: 100 })
    })

    it('should integrate $.data with $.measure', async () => {
      // Record a metric
      await $.measure.revenue(1000)

      // Store aggregated result
      const sum = await $.measure.revenue.sum()
      await $.data.set('aggregates:revenue:daily', { sum, timestamp: Date.now() })

      const stored = await $.data.get<{ sum: number }>('aggregates:revenue:daily')
      expect(stored!.sum).toBe(sum)
    })

    it('should provide entity access for event sourcing', async () => {
      // Entity operations should be available via proxy
      const OrderEntity = $['Order']
      expect(typeof OrderEntity).toBe('function')
    })

    it('should work with goal tracking', async () => {
      // Define a goal using proper target expression
      await $.goal.define('q1-revenue', {
        target: {
          type: 'measure',
          metric: 'revenue',
          aggregation: 'sum',
          value: 100000,
          direction: 'above',
        },
        by: '2026-03-31',
      })

      const goal = await $.goal('q1-revenue').get()
      expect(goal).toBeDefined()
      expect(goal!.name).toBe('q1-revenue')
    })
  })
})
