import { describe, it, expect, beforeEach } from 'vitest'
import { createThingsStore, type Thing, type ThingsStore } from '../things'

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
      await expect(store.create({ name: 'Alice' } as any)).rejects.toThrow('$type is required')
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

    it('should throw for non-existent thing', async () => {
      await expect(store.update('non-existent', { name: 'Bob' })).rejects.toThrow('Thing not found')
    })

    it('should not allow changing $id', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      const updated = await store.update(created.$id, { $id: 'new-id' } as any)

      expect(updated.$id).toBe(created.$id)
    })

    it('should not allow changing $type', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      const updated = await store.update(created.$id, { $type: 'Order' } as any)

      expect(updated.$type).toBe('Customer')
    })

    it('should not allow changing $createdAt', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      const updated = await store.update(created.$id, { $createdAt: 0 } as any)

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

    it('should throw for non-existent thing', async () => {
      await expect(store.delete('non-existent')).rejects.toThrow('Thing not found')
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
})
