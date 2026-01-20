import { describe, it, expect, beforeEach } from 'vitest'
import { createThingsStore, type Thing, type ThingsStore } from '../things'
import { ValidationError, NotFoundError } from '../../rpc/errors'

describe('Things Store', () => {
  let store: ThingsStore

  beforeEach(() => {
    store = createThingsStore()
  })

  describe('create', () => {
    it('should create a thing with generated $id', async () => {
      const thing = await store.create({ $type: 'Customer', name: 'Alice' })

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
      expect(thing.$createdAt).toBeDefined()
      expect(thing.$updatedAt).toBeDefined()
    })

    it('should require $type', async () => {
      // Intentionally passing invalid input to test runtime validation
      await expect(store.create({ name: 'Alice' } as unknown as { $type: string })).rejects.toThrow(ValidationError)
      await expect(store.create({ name: 'Alice' } as unknown as { $type: string })).rejects.toThrow('$type is required')
    })

    it('should require $type to be a string', async () => {
      await expect(store.create({ $type: 123 } as unknown as { $type: string })).rejects.toThrow(ValidationError)
      await expect(store.create({ $type: 123 } as unknown as { $type: string })).rejects.toThrow('must be a string')
    })

    it('should require $type to not be empty', async () => {
      await expect(store.create({ $type: '' })).rejects.toThrow(ValidationError)
      await expect(store.create({ $type: '   ' })).rejects.toThrow('cannot be empty')
    })

    it('should generate unique IDs for each thing', async () => {
      const thing1 = await store.create({ $type: 'Customer', name: 'Alice' })
      const thing2 = await store.create({ $type: 'Customer', name: 'Bob' })

      expect(thing1.$id).not.toBe(thing2.$id)
    })

    it('should preserve custom properties', async () => {
      const thing = await store.create({
        $type: 'Order',
        total: 100,
        items: ['item1', 'item2'],
        metadata: { source: 'web' }
      })

      expect(thing.total).toBe(100)
      expect(thing.items).toEqual(['item1', 'item2'])
      expect(thing.metadata).toEqual({ source: 'web' })
    })
  })

  describe('get', () => {
    it('should retrieve a thing by id', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      const retrieved = await store.get(created.$id)

      expect(retrieved).toEqual(created)
    })

    it('should return null for non-existent id', async () => {
      const result = await store.get('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('update', () => {
    it('should update a thing', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })

      // Small delay to ensure $updatedAt differs
      await new Promise(resolve => setTimeout(resolve, 1))

      const updated = await store.update(created.$id, { name: 'Bob' })

      expect(updated.name).toBe('Bob')
      expect(updated.$type).toBe('Customer')
      expect(updated.$updatedAt).toBeGreaterThanOrEqual(created.$updatedAt)
    })

    it('should throw NotFoundError for non-existent thing', async () => {
      await expect(store.update('non-existent', { name: 'Bob' })).rejects.toThrow(NotFoundError)
      await expect(store.update('non-existent', { name: 'Bob' })).rejects.toThrow('Thing with id non-existent not found')
    })

    it('should not allow changing $id', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      // Intentionally passing invalid update to test that $id is protected
      const updated = await store.update(created.$id, { $id: 'new-id' } as unknown as Partial<Thing>)

      expect(updated.$id).toBe(created.$id)
    })

    it('should not allow changing $type', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      // Intentionally passing invalid update to test that $type is protected
      const updated = await store.update(created.$id, { $type: 'Order' } as unknown as Partial<Thing>)

      expect(updated.$type).toBe('Customer')
    })

    it('should not allow changing $createdAt', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      // Intentionally passing invalid update to test that $createdAt is protected
      const updated = await store.update(created.$id, { $createdAt: 0 } as unknown as Partial<Thing>)

      expect(updated.$createdAt).toBe(created.$createdAt)
    })

    it('should preserve unmodified properties', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice', email: 'alice@example.com' })
      const updated = await store.update(created.$id, { name: 'Bob' })

      expect(updated.email).toBe('alice@example.com')
    })
  })

  describe('delete', () => {
    it('should delete a thing', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      await store.delete(created.$id)

      const result = await store.get(created.$id)
      expect(result).toBeNull()
    })

    it('should throw NotFoundError for non-existent thing', async () => {
      await expect(store.delete('non-existent')).rejects.toThrow(NotFoundError)
      await expect(store.delete('non-existent')).rejects.toThrow('Thing with id non-existent not found')
    })
  })

  describe('list', () => {
    it('should list all things when no filter', async () => {
      await store.create({ $type: 'Customer', name: 'Alice' })
      await store.create({ $type: 'Order', total: 100 })
      await store.create({ $type: 'Customer', name: 'Bob' })

      const all = await store.list()

      expect(all).toHaveLength(3)
    })

    it('should list things by type', async () => {
      await store.create({ $type: 'Customer', name: 'Alice' })
      await store.create({ $type: 'Order', total: 100 })
      await store.create({ $type: 'Customer', name: 'Bob' })

      const customers = await store.list({ type: 'Customer' })

      expect(customers).toHaveLength(2)
      expect(customers.every(t => t.$type === 'Customer')).toBe(true)
    })

    it('should support pagination with limit', async () => {
      for (let i = 0; i < 5; i++) {
        await store.create({ $type: 'Item', index: i })
      }

      const limited = await store.list({ limit: 2 })

      expect(limited).toHaveLength(2)
    })

    it('should support pagination with offset', async () => {
      for (let i = 0; i < 5; i++) {
        await store.create({ $type: 'Item', index: i })
      }

      const page1 = await store.list({ limit: 2, offset: 0 })
      const page2 = await store.list({ limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)

      // Ensure different items
      const page1Ids = page1.map(t => t.$id)
      const page2Ids = page2.map(t => t.$id)
      expect(page1Ids.some(id => page2Ids.includes(id))).toBe(false)
    })

    it('should sort by createdAt descending (newest first)', async () => {
      const first = await store.create({ $type: 'Item', name: 'first' })
      await new Promise(resolve => setTimeout(resolve, 1))
      const second = await store.create({ $type: 'Item', name: 'second' })
      await new Promise(resolve => setTimeout(resolve, 1))
      const third = await store.create({ $type: 'Item', name: 'third' })

      const items = await store.list({ type: 'Item' })

      expect(items[0].$id).toBe(third.$id)
      expect(items[1].$id).toBe(second.$id)
      expect(items[2].$id).toBe(first.$id)
    })

    it('should return empty array for non-existent type', async () => {
      await store.create({ $type: 'Customer', name: 'Alice' })

      const results = await store.list({ type: 'NonExistent' })

      expect(results).toEqual([])
    })

    it('should default limit to 100', async () => {
      // Create 150 items
      for (let i = 0; i < 150; i++) {
        await store.create({ $type: 'Item', index: i })
      }

      const results = await store.list()

      expect(results).toHaveLength(100)
    })
  })

  describe('bulkCreate', () => {
    it('should create multiple things at once', async () => {
      const things = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' },
        { $type: 'Customer', name: 'Bob' },
        { $type: 'Order', total: 100 }
      ])

      expect(things).toHaveLength(3)
      expect(things[0].$type).toBe('Customer')
      expect(things[0].name).toBe('Alice')
      expect(things[1].$type).toBe('Customer')
      expect(things[1].name).toBe('Bob')
      expect(things[2].$type).toBe('Order')
      expect(things[2].total).toBe(100)

      // All should have unique IDs
      const ids = things.map(t => t.$id)
      expect(new Set(ids).size).toBe(3)
    })

    it('should return empty array for empty input', async () => {
      const things = await store.bulkCreate([])
      expect(things).toEqual([])
    })

    it('should fail atomically if any item is invalid', async () => {
      // Count before
      const beforeCount = (await store.list()).length

      await expect(store.bulkCreate([
        { $type: 'Customer', name: 'Alice' },
        // Intentionally passing invalid input to test atomic rollback
        { name: 'No Type' } as unknown as { $type: string }, // Missing $type
        { $type: 'Customer', name: 'Bob' }
      ])).rejects.toThrow(ValidationError)

      // Count after - should be unchanged (atomic rollback)
      const afterCount = (await store.list()).length
      expect(afterCount).toBe(beforeCount)
    })

    it('should include item index in validation error', async () => {
      await expect(store.bulkCreate([
        { $type: 'Customer', name: 'Alice' },
        { name: 'No Type' } as unknown as { $type: string },
      ])).rejects.toThrow('items[1].$type')
    })

    it('should preserve all custom properties', async () => {
      const things = await store.bulkCreate([
        { $type: 'Order', total: 100, items: ['a', 'b'], metadata: { source: 'web' } },
        { $type: 'Order', total: 200, items: ['c'], metadata: { source: 'api' } }
      ])

      expect(things[0].items).toEqual(['a', 'b'])
      expect(things[0].metadata).toEqual({ source: 'web' })
      expect(things[1].items).toEqual(['c'])
      expect(things[1].metadata).toEqual({ source: 'api' })
    })
  })

  describe('bulkUpdate', () => {
    it('should update multiple things at once', async () => {
      const created = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice', status: 'active' },
        { $type: 'Customer', name: 'Bob', status: 'active' },
        { $type: 'Customer', name: 'Charlie', status: 'active' }
      ])

      await new Promise(resolve => setTimeout(resolve, 1))

      const updated = await store.bulkUpdate([
        { id: created[0].$id, data: { status: 'inactive' } },
        { id: created[1].$id, data: { name: 'Robert', status: 'pending' } }
      ])

      expect(updated).toHaveLength(2)
      expect(updated[0].status).toBe('inactive')
      expect(updated[0].name).toBe('Alice') // Unchanged
      expect(updated[1].status).toBe('pending')
      expect(updated[1].name).toBe('Robert')

      // Charlie should be unchanged
      const charlie = await store.get(created[2].$id)
      expect(charlie?.status).toBe('active')
    })

    it('should return empty array for empty input', async () => {
      const updated = await store.bulkUpdate([])
      expect(updated).toEqual([])
    })

    it('should fail atomically if any item does not exist', async () => {
      const created = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice', status: 'active' },
        { $type: 'Customer', name: 'Bob', status: 'active' }
      ])

      await expect(store.bulkUpdate([
        { id: created[0].$id, data: { status: 'inactive' } },
        { id: 'non-existent', data: { status: 'inactive' } }
      ])).rejects.toThrow(NotFoundError)

      // Alice should be unchanged (atomic rollback)
      const alice = await store.get(created[0].$id)
      expect(alice?.status).toBe('active')
    })

    it('should not allow changing $id, $type, or $createdAt', async () => {
      const created = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' }
      ])

      // Intentionally passing invalid updates to test that system fields are protected
      const updated = await store.bulkUpdate([
        { id: created[0].$id, data: { $id: 'new-id', $type: 'Order', $createdAt: 0 } as unknown as Partial<Thing> }
      ])

      expect(updated[0].$id).toBe(created[0].$id)
      expect(updated[0].$type).toBe('Customer')
      expect(updated[0].$createdAt).toBe(created[0].$createdAt)
    })

    it('should update $updatedAt for all modified things', async () => {
      const created = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' },
        { $type: 'Customer', name: 'Bob' }
      ])

      await new Promise(resolve => setTimeout(resolve, 1))

      const updated = await store.bulkUpdate([
        { id: created[0].$id, data: { name: 'Alice Updated' } },
        { id: created[1].$id, data: { name: 'Bob Updated' } }
      ])

      expect(updated[0].$updatedAt).toBeGreaterThan(created[0].$updatedAt)
      expect(updated[1].$updatedAt).toBeGreaterThan(created[1].$updatedAt)
    })
  })

  describe('bulkDelete', () => {
    it('should delete multiple things at once', async () => {
      const created = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' },
        { $type: 'Customer', name: 'Bob' },
        { $type: 'Customer', name: 'Charlie' }
      ])

      await store.bulkDelete([created[0].$id, created[1].$id])

      expect(await store.get(created[0].$id)).toBeNull()
      expect(await store.get(created[1].$id)).toBeNull()
      expect(await store.get(created[2].$id)).not.toBeNull() // Charlie still exists
    })

    it('should return empty for empty input', async () => {
      await store.bulkDelete([])
      // No error should be thrown
    })

    it('should fail atomically if any item does not exist', async () => {
      const created = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' },
        { $type: 'Customer', name: 'Bob' }
      ])

      await expect(store.bulkDelete([
        created[0].$id,
        'non-existent'
      ])).rejects.toThrow(NotFoundError)

      // Alice should still exist (atomic rollback)
      expect(await store.get(created[0].$id)).not.toBeNull()
    })

    it('should handle deleting a single item', async () => {
      const created = await store.bulkCreate([
        { $type: 'Customer', name: 'Alice' }
      ])

      await store.bulkDelete([created[0].$id])

      expect(await store.get(created[0].$id)).toBeNull()
    })
  })
})
