import { describe, it, expect, beforeEach } from 'vitest'
import { createSQLiteThingsStore, SQLiteAdapter } from '../sqlite'
import type { ThingsStore } from '../things'
import { createMockSqlStorage, type MockSqlStorage } from './sqlite-test-utils'

describe('SQLite ThingsStore', () => {
  let sql: MockSqlStorage
  let store: ThingsStore

  beforeEach(async () => {
    sql = createMockSqlStorage()
    // Use legacy init mode for existing tests since mock doesn't support migrations
    const adapter = new SQLiteAdapter(sql as any, { useLegacyInit: true })
    await adapter.initialize()
    store = createSQLiteThingsStore(adapter)
  })

  describe('create', () => {
    it('should insert thing into SQLite', async () => {
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

    it('should persist data as JSON', async () => {
      const thing = await store.create({
        $type: 'Order',
        total: 100,
        items: ['item1', 'item2'],
        metadata: { source: 'web' }
      })

      const retrieved = await store.get(thing.$id)
      expect(retrieved?.total).toBe(100)
      expect(retrieved?.items).toEqual(['item1', 'item2'])
      expect(retrieved?.metadata).toEqual({ source: 'web' })
    })
  })

  describe('get', () => {
    it('should retrieve thing by id', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      const retrieved = await store.get(created.$id)

      expect(retrieved).toEqual(created)
    })

    it('should return null for non-existent id', async () => {
      const result = await store.get('non-existent')
      expect(result).toBeNull()
    })

    it('should parse JSON data field', async () => {
      const created = await store.create({
        $type: 'Product',
        name: 'Widget',
        price: 99.99,
        tags: ['new', 'featured']
      })

      const retrieved = await store.get(created.$id)
      expect(retrieved?.price).toBe(99.99)
      expect(retrieved?.tags).toEqual(['new', 'featured'])
    })
  })

  describe('update', () => {
    it('should update thing in SQLite', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })

      await new Promise(resolve => setTimeout(resolve, 1))

      const updated = await store.update(created.$id, { name: 'Bob' })

      expect(updated.name).toBe('Bob')
      expect(updated.$type).toBe('Customer')
      expect(updated.$updatedAt).toBeGreaterThanOrEqual(created.$updatedAt)
    })

    it('should throw for non-existent thing', async () => {
      await expect(store.update('non-existent', { name: 'Bob' })).rejects.toThrow('Thing not found')
    })

    it('should preserve $id, $type, and $createdAt', async () => {
      const created = await store.create({ $type: 'Customer', name: 'Alice' })
      const updated = await store.update(created.$id, {
        $id: 'new-id',
        $type: 'Order',
        $createdAt: 0
      } as any)

      expect(updated.$id).toBe(created.$id)
      expect(updated.$type).toBe('Customer')
      expect(updated.$createdAt).toBe(created.$createdAt)
    })
  })

  describe('delete', () => {
    it('should delete thing from SQLite', async () => {
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
    it('should list all things', async () => {
      await store.create({ $type: 'Customer', name: 'Alice' })
      await store.create({ $type: 'Order', total: 100 })
      await store.create({ $type: 'Customer', name: 'Bob' })

      const all = await store.list()
      expect(all.length).toBeGreaterThanOrEqual(3)
    })

    it('should filter by type', async () => {
      await store.create({ $type: 'Customer', name: 'Alice' })
      await store.create({ $type: 'Order', total: 100 })
      await store.create({ $type: 'Customer', name: 'Bob' })

      const customers = await store.list({ type: 'Customer' })
      expect(customers).toHaveLength(2)
      expect(customers.every(t => t.$type === 'Customer')).toBe(true)
    })

    it('should support limit', async () => {
      for (let i = 0; i < 5; i++) {
        await store.create({ $type: 'Item', index: i })
      }

      const limited = await store.list({ limit: 2 })
      expect(limited).toHaveLength(2)
    })

    it('should support offset', async () => {
      for (let i = 0; i < 5; i++) {
        await store.create({ $type: 'Item', index: i })
      }

      const page1 = await store.list({ limit: 2, offset: 0 })
      const page2 = await store.list({ limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)

      const page1Ids = page1.map(t => t.$id)
      const page2Ids = page2.map(t => t.$id)
      expect(page1Ids.some(id => page2Ids.includes(id))).toBe(false)
    })

    it('should sort by createdAt descending', async () => {
      const first = await store.create({ $type: 'Item', name: 'first' })
      await new Promise(resolve => setTimeout(resolve, 5))
      const second = await store.create({ $type: 'Item', name: 'second' })
      await new Promise(resolve => setTimeout(resolve, 5))
      const third = await store.create({ $type: 'Item', name: 'third' })

      const items = await store.list({ type: 'Item' })

      // Verify newest is first (may have same timestamp in fast execution)
      expect(items[0].$createdAt).toBeGreaterThanOrEqual(items[1].$createdAt)
      expect(items[1].$createdAt).toBeGreaterThanOrEqual(items[2].$createdAt)
      // Verify we got the right number of items
      expect(items).toHaveLength(3)
    })
  })
})
