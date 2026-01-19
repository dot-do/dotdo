import { describe, it, expect, beforeEach } from 'vitest'
import { createThingsStore, type ThingsStore } from '../things'
import { query, createQuery } from '../query'

describe('Query Interface', () => {
  let store: ThingsStore

  beforeEach(async () => {
    store = createThingsStore()

    // Seed test data
    await store.create({ $type: 'User', name: 'Alice', age: 30, role: 'admin' })
    await store.create({ $type: 'User', name: 'Bob', age: 25, role: 'user' })
    await store.create({ $type: 'User', name: 'Charlie', age: 35, role: 'user' })
    await store.create({ $type: 'Order', total: 100, status: 'pending' })
    await store.create({ $type: 'Order', total: 200, status: 'completed' })
  })

  describe('type()', () => {
    it('should filter by $type', async () => {
      const users = await query(store).type('User').execute()
      expect(users).toHaveLength(3)
      expect(users.every(u => u.$type === 'User')).toBe(true)
    })
  })

  describe('where()', () => {
    it('should filter by field value', async () => {
      const admins = await query(store)
        .type('User')
        .where('role', 'admin')
        .execute()

      expect(admins).toHaveLength(1)
      expect(admins[0].name).toBe('Alice')
    })

    it('should accept object of conditions', async () => {
      const results = await query(store)
        .type('User')
        .where({ role: 'user', age: 25 })
        .execute()

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Bob')
    })

    it('should chain multiple where calls', async () => {
      const results = await query(store)
        .type('Order')
        .where('status', 'pending')
        .where('total', 100)
        .execute()

      expect(results).toHaveLength(1)
    })
  })

  describe('orderBy()', () => {
    it('should order results descending by default', async () => {
      const users = await query(store)
        .type('User')
        .orderBy('age')
        .execute()

      expect(users[0].name).toBe('Charlie') // age 35
      expect(users[2].name).toBe('Bob')     // age 25
    })

    it('should order ascending when specified', async () => {
      const users = await query(store)
        .type('User')
        .orderBy('age', 'asc')
        .execute()

      expect(users[0].name).toBe('Bob')     // age 25
      expect(users[2].name).toBe('Charlie') // age 35
    })
  })

  describe('limit() and offset()', () => {
    it('should limit results', async () => {
      const users = await query(store)
        .type('User')
        .limit(2)
        .execute()

      expect(users).toHaveLength(2)
    })

    it('should offset results', async () => {
      const page1 = await query(store).type('User').limit(2).offset(0).execute()
      const page2 = await query(store).type('User').limit(2).offset(2).execute()

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(1)
    })
  })

  describe('select()', () => {
    it('should project specific fields', async () => {
      const users = await query(store)
        .type('User')
        .select('name', 'role')
        .execute()

      expect(users[0]).toHaveProperty('$id')
      expect(users[0]).toHaveProperty('$type')
      expect(users[0]).toHaveProperty('name')
      expect(users[0]).toHaveProperty('role')
      expect(users[0]).not.toHaveProperty('age')
    })
  })

  describe('first()', () => {
    it('should return first matching result', async () => {
      const user = await query(store)
        .type('User')
        .where('name', 'Alice')
        .first()

      expect(user?.name).toBe('Alice')
    })

    it('should return null when no match', async () => {
      const user = await query(store)
        .type('User')
        .where('name', 'Nobody')
        .first()

      expect(user).toBeNull()
    })
  })

  describe('count()', () => {
    it('should count matching results', async () => {
      const count = await query(store).type('User').count()
      expect(count).toBe(3)
    })

    it('should respect where filters', async () => {
      const count = await query(store)
        .type('User')
        .where('role', 'user')
        .count()

      expect(count).toBe(2)
    })
  })
})
