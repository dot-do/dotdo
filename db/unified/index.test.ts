/**
 * Unified Store Interface Tests
 *
 * TDD tests for the unified Store<T> interface including batch operations.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createStore, type Store, type Filter } from './index'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface TestItem {
  id: string
  name: string
  status: string
  count: number
  metadata?: {
    tier?: string
    active?: boolean
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Unified Store Interface', () => {
  let store: Store<TestItem>

  beforeEach(() => {
    store = createStore<TestItem>(null, { type: 'TestItem' })
  })

  // ==========================================================================
  // BASIC CRUD (existing functionality)
  // ==========================================================================

  describe('Basic CRUD', () => {
    it('should create an item with auto-generated id', async () => {
      const item = await store.create({ name: 'Alice', status: 'active', count: 0 })

      expect(item.id).toBeDefined()
      expect(item.name).toBe('Alice')
      expect(item.status).toBe('active')
    })

    it('should create an item with provided id', async () => {
      const item = await store.create({ id: 'custom-id', name: 'Bob', status: 'pending', count: 5 })

      expect(item.id).toBe('custom-id')
      expect(item.name).toBe('Bob')
    })

    it('should get an item by id', async () => {
      const created = await store.create({ name: 'Charlie', status: 'active', count: 10 })
      const retrieved = await store.get(created.id)

      expect(retrieved).toEqual(created)
    })

    it('should return null for non-existent id', async () => {
      const result = await store.get('non-existent')

      expect(result).toBeNull()
    })

    it('should update an item', async () => {
      const created = await store.create({ name: 'Dave', status: 'active', count: 0 })
      const updated = await store.update(created.id, { status: 'inactive', count: 5 })

      expect(updated.name).toBe('Dave')
      expect(updated.status).toBe('inactive')
      expect(updated.count).toBe(5)
    })

    it('should delete an item', async () => {
      const created = await store.create({ name: 'Eve', status: 'active', count: 0 })
      const deleted = await store.delete(created.id)
      const retrieved = await store.get(created.id)

      expect(deleted).toBe(true)
      expect(retrieved).toBeNull()
    })

    it('should return false when deleting non-existent item', async () => {
      const deleted = await store.delete('non-existent')

      expect(deleted).toBe(false)
    })
  })

  // ==========================================================================
  // BATCH OPERATIONS (new functionality)
  // ==========================================================================

  describe('Batch Operations', () => {
    describe('createMany()', () => {
      it('should create multiple items at once', async () => {
        const items = await store.createMany([
          { name: 'Item1', status: 'active', count: 1 },
          { name: 'Item2', status: 'pending', count: 2 },
          { name: 'Item3', status: 'active', count: 3 },
        ])

        expect(items).toHaveLength(3)
        expect(items[0].id).toBeDefined()
        expect(items[0].name).toBe('Item1')
        expect(items[1].name).toBe('Item2')
        expect(items[2].name).toBe('Item3')
      })

      it('should create items with provided ids', async () => {
        const items = await store.createMany([
          { id: 'batch-1', name: 'Item1', status: 'active', count: 1 },
          { id: 'batch-2', name: 'Item2', status: 'active', count: 2 },
        ])

        expect(items[0].id).toBe('batch-1')
        expect(items[1].id).toBe('batch-2')
      })

      it('should return empty array for empty input', async () => {
        const items = await store.createMany([])

        expect(items).toEqual([])
      })

      it('should emit CDC events for each created item', async () => {
        const events: Array<{ type: string; item: TestItem }> = []
        store.on('create', (e) => events.push({ type: e.type, item: e.item }))

        await store.createMany([
          { name: 'Item1', status: 'active', count: 1 },
          { name: 'Item2', status: 'active', count: 2 },
        ])

        expect(events).toHaveLength(2)
        expect(events[0].type).toBe('create')
        expect(events[1].type).toBe('create')
      })

      it('should reject duplicate ids within batch', async () => {
        await expect(
          store.createMany([
            { id: 'dup-id', name: 'Item1', status: 'active', count: 1 },
            { id: 'dup-id', name: 'Item2', status: 'active', count: 2 },
          ])
        ).rejects.toThrow()
      })

      it('should reject if id already exists in store', async () => {
        await store.create({ id: 'existing', name: 'Existing', status: 'active', count: 0 })

        await expect(
          store.createMany([
            { id: 'existing', name: 'Duplicate', status: 'active', count: 1 },
          ])
        ).rejects.toThrow()
      })
    })

    describe('updateMany()', () => {
      beforeEach(async () => {
        // Set up test data
        await store.createMany([
          { id: 'u1', name: 'Item1', status: 'active', count: 10, metadata: { tier: 'premium' } },
          { id: 'u2', name: 'Item2', status: 'active', count: 20, metadata: { tier: 'basic' } },
          { id: 'u3', name: 'Item3', status: 'pending', count: 30, metadata: { tier: 'premium' } },
          { id: 'u4', name: 'Item4', status: 'inactive', count: 40, metadata: { tier: 'basic' } },
        ])
      })

      it('should update multiple items matching filter', async () => {
        const count = await store.updateMany(
          { status: 'active' },
          { status: 'archived' }
        )

        expect(count).toBe(2)

        const u1 = await store.get('u1')
        const u2 = await store.get('u2')
        const u3 = await store.get('u3')

        expect(u1?.status).toBe('archived')
        expect(u2?.status).toBe('archived')
        expect(u3?.status).toBe('pending') // unchanged
      })

      it('should return 0 when no items match filter', async () => {
        const count = await store.updateMany(
          { status: 'nonexistent' },
          { count: 999 }
        )

        expect(count).toBe(0)
      })

      it('should update all items when filter is empty', async () => {
        const count = await store.updateMany(
          {},
          { count: 100 }
        )

        expect(count).toBe(4)

        const items = await store.find({})
        expect(items.every(item => item.count === 100)).toBe(true)
      })

      it('should update nested fields', async () => {
        const count = await store.updateMany(
          { 'metadata.tier': 'premium' },
          { 'metadata.active': true }
        )

        expect(count).toBe(2)

        const u1 = await store.get('u1')
        const u3 = await store.get('u3')

        expect(u1?.metadata?.active).toBe(true)
        expect(u3?.metadata?.active).toBe(true)
      })

      it('should emit CDC events for each updated item', async () => {
        const events: Array<{ type: string; item: TestItem }> = []
        store.on('update', (e) => events.push({ type: e.type, item: e.item }))

        await store.updateMany({ status: 'active' }, { count: 0 })

        expect(events).toHaveLength(2)
        expect(events[0].type).toBe('update')
      })

      it('should support filter operators', async () => {
        const count = await store.updateMany(
          { count: { $gt: 15 } },
          { status: 'high-count' }
        )

        expect(count).toBe(3) // u2, u3, u4 have count > 15
      })
    })

    describe('deleteMany()', () => {
      beforeEach(async () => {
        // Set up test data
        await store.createMany([
          { id: 'd1', name: 'Item1', status: 'active', count: 10, metadata: { tier: 'premium' } },
          { id: 'd2', name: 'Item2', status: 'active', count: 20, metadata: { tier: 'basic' } },
          { id: 'd3', name: 'Item3', status: 'pending', count: 30, metadata: { tier: 'premium' } },
          { id: 'd4', name: 'Item4', status: 'inactive', count: 40, metadata: { tier: 'basic' } },
        ])
      })

      it('should delete multiple items matching filter', async () => {
        const count = await store.deleteMany({ status: 'active' })

        expect(count).toBe(2)

        const d1 = await store.get('d1')
        const d2 = await store.get('d2')
        const d3 = await store.get('d3')

        expect(d1).toBeNull()
        expect(d2).toBeNull()
        expect(d3).not.toBeNull() // unchanged
      })

      it('should return 0 when no items match filter', async () => {
        const count = await store.deleteMany({ status: 'nonexistent' })

        expect(count).toBe(0)
      })

      it('should delete all items when filter is empty', async () => {
        const count = await store.deleteMany({})

        expect(count).toBe(4)

        const items = await store.find({})
        expect(items).toHaveLength(0)
      })

      it('should support nested field filters', async () => {
        const count = await store.deleteMany({ 'metadata.tier': 'basic' })

        expect(count).toBe(2)

        const d2 = await store.get('d2')
        const d4 = await store.get('d4')

        expect(d2).toBeNull()
        expect(d4).toBeNull()
      })

      it('should emit CDC events for each deleted item', async () => {
        const events: Array<{ type: string; item: TestItem }> = []
        store.on('delete', (e) => events.push({ type: e.type, item: e.item }))

        await store.deleteMany({ status: 'active' })

        expect(events).toHaveLength(2)
        expect(events[0].type).toBe('delete')
      })

      it('should support filter operators', async () => {
        const count = await store.deleteMany({ count: { $lte: 20 } })

        expect(count).toBe(2) // d1, d2 have count <= 20

        const d1 = await store.get('d1')
        const d2 = await store.get('d2')

        expect(d1).toBeNull()
        expect(d2).toBeNull()
      })
    })
  })

  // ==========================================================================
  // QUERY OPERATIONS
  // ==========================================================================

  describe('Query Operations', () => {
    beforeEach(async () => {
      await store.createMany([
        { id: 'q1', name: 'Alice', status: 'active', count: 10 },
        { id: 'q2', name: 'Bob', status: 'pending', count: 20 },
        { id: 'q3', name: 'Charlie', status: 'active', count: 30 },
      ])
    })

    it('should find items with simple filter', async () => {
      const items = await store.find({ status: 'active' })

      expect(items).toHaveLength(2)
      expect(items.map(i => i.name).sort()).toEqual(['Alice', 'Charlie'])
    })

    it('should find items with operator filter', async () => {
      const items = await store.find({ count: { $gt: 15 } })

      expect(items).toHaveLength(2)
      expect(items.map(i => i.name).sort()).toEqual(['Bob', 'Charlie'])
    })

    it('should query with limit and offset', async () => {
      const items = await store.query()
        .orderBy('count', 'asc')
        .limit(2)
        .offset(1)
        .execute()

      expect(items).toHaveLength(2)
      expect(items[0].name).toBe('Bob')
      expect(items[1].name).toBe('Charlie')
    })
  })

  // ==========================================================================
  // CDC EVENTS
  // ==========================================================================

  describe('CDC Events', () => {
    it('should emit create events', async () => {
      const events: unknown[] = []
      store.on('create', (e) => events.push(e))

      await store.create({ name: 'Test', status: 'active', count: 0 })

      expect(events).toHaveLength(1)
    })

    it('should emit update events', async () => {
      const events: unknown[] = []
      const item = await store.create({ name: 'Test', status: 'active', count: 0 })
      store.on('update', (e) => events.push(e))

      await store.update(item.id, { status: 'inactive' })

      expect(events).toHaveLength(1)
    })

    it('should emit delete events', async () => {
      const events: unknown[] = []
      const item = await store.create({ name: 'Test', status: 'active', count: 0 })
      store.on('delete', (e) => events.push(e))

      await store.delete(item.id)

      expect(events).toHaveLength(1)
    })

    it('should emit wildcard events for all operations', async () => {
      const events: unknown[] = []
      store.on('*', (e) => events.push(e))

      const item = await store.create({ name: 'Test', status: 'active', count: 0 })
      await store.update(item.id, { count: 5 })
      await store.delete(item.id)

      expect(events).toHaveLength(3)
    })
  })
})
