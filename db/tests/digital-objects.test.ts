import { describe, it, expect, beforeEach } from 'vitest'
import { createDigitalObjectsAdapter, type DigitalObjectsThingsStore } from '../digital-objects'
import { createMemoryProvider } from '../../primitives/packages/digital-objects/src/memory-provider.js'
import type { DigitalObjectsProvider } from '../../primitives/packages/digital-objects/src/types.js'

describe('Digital Objects Integration', () => {
  let provider: DigitalObjectsProvider
  let store: DigitalObjectsThingsStore

  beforeEach(async () => {
    provider = createMemoryProvider()
    store = createDigitalObjectsAdapter(provider)

    // Define test nouns
    await provider.defineNoun({
      name: 'Customer',
      description: 'A customer entity',
      schema: {
        name: { type: 'string', required: true },
        email: 'string?',
        age: 'number?',
      },
    })

    await provider.defineNoun({
      name: 'Order',
      description: 'An order entity',
      schema: {
        total: { type: 'number', required: true },
        items: 'json?',
      },
    })
  })

  describe('Schema Mapping', () => {
    it('should map digital-objects Thing to @dotdo/db Thing format', async () => {
      const thing = await store.create({ $type: 'Customer', name: 'Alice' })

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
      expect(thing.$createdAt).toBeDefined()
      expect(thing.$updatedAt).toBeDefined()
      expect(typeof thing.$createdAt).toBe('number')
      expect(typeof thing.$updatedAt).toBe('number')
    })

    it('should map between digital-objects fields and @dotdo/db fields', async () => {
      const thing = await store.create({ $type: 'Customer', name: 'Bob', email: 'bob@example.com' })

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Bob')
      expect(thing.email).toBe('bob@example.com')
    })
  })

  describe('Type Generation', () => {
    it('should generate correct TypeScript types from digital-objects schemas', async () => {
      // This is tested at compile time, but we can verify runtime behavior
      const customer = await store.create({
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      })

      expect(customer.name).toBe('Alice')
      expect(customer.email).toBe('alice@example.com')
      expect(customer.age).toBe(30)
    })

    it('should handle optional fields correctly', async () => {
      const customer = await store.create({
        $type: 'Customer',
        name: 'Bob',
      })

      expect(customer.name).toBe('Bob')
      expect(customer.email).toBeUndefined()
      expect(customer.age).toBeUndefined()
    })
  })

  describe('Validation', () => {
    it('should validate required fields using digital-objects schemas', async () => {
      await expect(
        store.create({ $type: 'Customer' } as any, { validate: true })
      ).rejects.toThrow(/validation failed/i)
    })

    it('should validate field types using digital-objects schemas', async () => {
      await expect(
        store.create({ $type: 'Customer', name: 'Alice', age: 'not-a-number' } as any, { validate: true })
      ).rejects.toThrow(/validation failed/i)
    })

    it('should skip validation when not enabled', async () => {
      // Without validate option, should not throw
      const thing = await store.create({ $type: 'Customer', name: 123 } as any)
      expect(thing).toBeDefined()
    })

    it('should validate on update when enabled', async () => {
      const thing = await store.create({ $type: 'Customer', name: 'Alice' })

      await expect(
        store.update(thing.$id, { age: 'not-a-number' } as any, { validate: true })
      ).rejects.toThrow(/validation failed/i)
    })
  })

  describe('CRUD Operations', () => {
    it('should create things using digital-objects provider', async () => {
      const thing = await store.create({ $type: 'Customer', name: 'Alice' })

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
    })

    it('should get things by id', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      const retrieved = await store.get(created.$id)

      expect(retrieved).toBeDefined()
      expect(retrieved?.$id).toBe(created.$id)
      expect(retrieved?.name).toBe('Alice')
    })

    it('should update things', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      const updated = await store.update(created.$id, { name: 'Bob' })

      expect(updated.name).toBe('Bob')
      expect(updated.$type).toBe('Customer')
      expect(updated.$updatedAt).toBeGreaterThanOrEqual(created.$updatedAt)
    })

    it('should delete things', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      await store.delete(created.$id)

      const retrieved = await store.get(created.$id)
      expect(retrieved).toBeNull()
    })

    it('should list things by type', async () => {
      await store.create({ $type: 'Customer', name: 'Alice' })
      await store.create({ $type: 'Customer', name: 'Bob' })
      await store.create({ $type: 'Order', total: 100 })

      const customers = await store.list({ type: 'Customer' })

      expect(customers).toHaveLength(2)
      expect(customers.every(c => c.$type === 'Customer')).toBe(true)
    })
  })

  describe('Query Builder Integration', () => {
    it('should work with query builder', async () => {
      await store.create({ $type: 'Customer', name: 'Alice', age: 30 })
      await store.create({ $type: 'Customer', name: 'Bob', age: 25 })
      await store.create({ $type: 'Customer', name: 'Charlie', age: 35 })

      const results = await store.list({
        type: 'Customer',
        where: { age: 30 },
      })

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Alice')
    })

    it('should support ordering', async () => {
      await store.create({ $type: 'Customer', name: 'Alice', age: 30 })
      await store.create({ $type: 'Customer', name: 'Bob', age: 25 })
      await store.create({ $type: 'Customer', name: 'Charlie', age: 35 })

      const results = await store.list({
        type: 'Customer',
        orderBy: 'age',
        order: 'asc',
      })

      expect(results[0].name).toBe('Bob')
      expect(results[1].name).toBe('Alice')
      expect(results[2].name).toBe('Charlie')
    })

    it('should support pagination', async () => {
      for (let i = 0; i < 10; i++) {
        await store.create({ $type: 'Customer', name: `Customer ${i}` })
      }

      const page1 = await store.list({ type: 'Customer', limit: 3, offset: 0 })
      const page2 = await store.list({ type: 'Customer', limit: 3, offset: 3 })

      expect(page1).toHaveLength(3)
      expect(page2).toHaveLength(3)

      const page1Ids = page1.map(t => t.$id)
      const page2Ids = page2.map(t => t.$id)
      expect(page1Ids.some(id => page2Ids.includes(id))).toBe(false)
    })
  })

  describe('Noun Schema Access', () => {
    it('should expose noun definitions', async () => {
      const noun = await store.getNoun('Customer')

      expect(noun).toBeDefined()
      expect(noun?.name).toBe('Customer')
      expect(noun?.schema).toBeDefined()
      expect(noun?.schema?.name).toBeDefined()
    })

    it('should list all noun definitions', async () => {
      const nouns = await store.listNouns()

      expect(nouns.length).toBeGreaterThanOrEqual(2)
      expect(nouns.some(n => n.name === 'Customer')).toBe(true)
      expect(nouns.some(n => n.name === 'Order')).toBe(true)
    })

    it('should derive singular/plural forms', async () => {
      const noun = await store.getNoun('Customer')

      expect(noun?.singular).toBe('customer')
      expect(noun?.plural).toBe('customers')
    })
  })

  describe('Advanced Features', () => {
    it('should support JSON fields', async () => {
      const order = await store.create({
        $type: 'Order',
        total: 150,
        items: [{ id: 1, name: 'Widget' }, { id: 2, name: 'Gadget' }],
      })

      expect(order.items).toEqual([
        { id: 1, name: 'Widget' },
        { id: 2, name: 'Gadget' },
      ])
    })

    it('should preserve custom properties not in schema', async () => {
      const thing = await store.create({
        $type: 'Customer',
        name: 'Alice',
        customField: 'custom value',
      })

      expect(thing.customField).toBe('custom value')
    })

    it('should handle nested queries', async () => {
      await store.create({ $type: 'Order', total: 100 })
      await store.create({ $type: 'Order', total: 200 })
      await store.create({ $type: 'Order', total: 150 })

      const results = await store.list({
        type: 'Order',
        where: { total: 150 },
      })

      expect(results).toHaveLength(1)
      expect(results[0].total).toBe(150)
    })
  })

  describe('Error Handling', () => {
    it('should throw for undefined nouns', async () => {
      await expect(
        store.create({ $type: 'UndefinedNoun', name: 'Test' })
      ).rejects.toThrow()
    })

    it('should throw for non-existent thing', async () => {
      await expect(
        store.update('non-existent-id', { name: 'Test' })
      ).rejects.toThrow()
    })

    it('should return null for non-existent get', async () => {
      const result = await store.get('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('Bulk Operations', () => {
    it('should bulk create multiple things', async () => {
      const things = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' },
        { $type: 'Customer', name: 'Bob' },
        { $type: 'Customer', name: 'Charlie' },
      ])

      expect(things).toHaveLength(3)
      expect(things[0].$id).toBeDefined()
      expect(things[0].$type).toBe('Customer')
      expect(things[0].name).toBe('Alice')
      expect(things[1].name).toBe('Bob')
      expect(things[2].name).toBe('Charlie')
      expect(things.every(t => t.$createdAt && t.$updatedAt)).toBe(true)
    })

    it('should bulk create things of different types', async () => {
      const things = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' },
        { $type: 'Order', total: 100 },
      ])

      expect(things).toHaveLength(2)
      expect(things[0].$type).toBe('Customer')
      expect(things[0].name).toBe('Alice')
      expect(things[1].$type).toBe('Order')
      expect(things[1].total).toBe(100)
    })

    it('should return empty array for empty bulk create', async () => {
      const things = await store.bulkCreate([])
      expect(things).toEqual([])
    })

    it('should bulk update multiple things', async () => {
      const created = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice', age: 25 },
        { $type: 'Customer', name: 'Bob', age: 30 },
        { $type: 'Customer', name: 'Charlie', age: 35 },
      ])

      const updated = await store.bulkUpdate([
        { id: created[0].$id, data: { age: 26 } },
        { id: created[1].$id, data: { age: 31 } },
        { id: created[2].$id, data: { name: 'Charles', age: 36 } },
      ])

      expect(updated).toHaveLength(3)
      expect(updated[0].age).toBe(26)
      expect(updated[0].name).toBe('Alice')
      expect(updated[1].age).toBe(31)
      expect(updated[2].name).toBe('Charles')
      expect(updated[2].age).toBe(36)
    })

    it('should return empty array for empty bulk update', async () => {
      const updated = await store.bulkUpdate([])
      expect(updated).toEqual([])
    })

    it('should bulk delete multiple things', async () => {
      const created = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' },
        { $type: 'Customer', name: 'Bob' },
        { $type: 'Customer', name: 'Charlie' },
      ])

      await store.bulkDelete([created[0].$id, created[1].$id])

      const remaining = await store.list({ type: 'Customer' })
      expect(remaining).toHaveLength(1)
      expect(remaining[0].name).toBe('Charlie')
    })

    it('should do nothing for empty bulk delete', async () => {
      await store.bulkDelete([])
      // Should not throw
    })

    it('should verify bulk created things are retrievable', async () => {
      const things = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' },
        { $type: 'Customer', name: 'Bob' },
      ])

      for (const thing of things) {
        const retrieved = await store.get(thing.$id)
        expect(retrieved).toBeDefined()
        expect(retrieved?.$id).toBe(thing.$id)
      }
    })

    it('should bulk update preserve immutable fields', async () => {
      const created = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' },
      ])

      const updated = await store.bulkUpdate([
        { id: created[0].$id, data: { name: 'Bob' } },
      ])

      expect(updated[0].$id).toBe(created[0].$id)
      expect(updated[0].$type).toBe('Customer')
      expect(updated[0].$createdAt).toBe(created[0].$createdAt)
      expect(updated[0].$updatedAt).toBeGreaterThanOrEqual(created[0].$updatedAt)
    })
  })
})
