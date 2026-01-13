/**
 * DocumentGraphStore Backend Tests
 *
 * RED PHASE: Tests for GraphStore implementation backed by DocumentStore.
 *
 * @see dotdo-047vv - [RED] DocumentStore GraphStore backend tests
 *
 * This file tests the DocumentGraphStore implementation which uses the
 * DocumentStore primitive as its storage backend. The DocumentStore provides
 * MongoDB-style document operations, allowing the GraphStore to leverage
 * rich query operators, indexes, and batch operations.
 *
 * Design:
 * - Reuses the parameterized test factory from graph-store.test.ts
 * - Same tests that pass for SQLiteGraphStore should pass for DocumentGraphStore
 * - Additional tests verify DocumentStore-specific features (indexes, JSON queries, batch ops)
 *
 * Storage Model:
 * - Things stored in 'Things' collection with type index
 * - Relationships stored in 'Relationships' collection with verb/from/to indexes
 * - Unique constraint on (verb, from, to) enforced via compound unique index
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createGraphStoreTests } from './graph-store.test'

// ============================================================================
// Import DocumentGraphStore - will fail until implementation exists
// ============================================================================

// This import will fail in RED phase - DocumentGraphStore doesn't exist yet
import { DocumentGraphStore } from '../stores/document'

// ============================================================================
// Run Standard GraphStore Tests Against DocumentStore Backend
// ============================================================================

/**
 * DocumentGraphStore must pass ALL the same tests as SQLiteGraphStore.
 * This ensures the interface contract is satisfied regardless of backend.
 */
createGraphStoreTests(
  'DocumentGraphStore',
  async () => {
    const store = new DocumentGraphStore(':memory:')
    await store.initialize()
    return store
  },
  async (store) => {
    await (store as DocumentGraphStore).close()
  }
)

// ============================================================================
// DocumentStore-Specific Feature Tests
// ============================================================================

describe('DocumentGraphStore - DocumentStore-Specific Features', () => {
  let store: DocumentGraphStore

  beforeEach(async () => {
    store = new DocumentGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // Index Tests
  // ==========================================================================

  describe('Index Management', () => {
    it('creates type index on Things collection', async () => {
      // The Things collection should have an index on typeId and typeName
      // for efficient type-based queries
      const indexes = await store.getThingsIndexes()

      expect(indexes).toBeDefined()
      expect(indexes.some((idx) => idx.name.includes('type'))).toBe(true)
    })

    it('creates verb index on Relationships collection', async () => {
      // Relationships should have an index on verb for efficient verb-based queries
      const indexes = await store.getRelationshipsIndexes()

      expect(indexes).toBeDefined()
      expect(indexes.some((idx) => idx.name.includes('verb'))).toBe(true)
    })

    it('creates from index on Relationships collection', async () => {
      // Relationships should have an index on 'from' for forward traversal
      const indexes = await store.getRelationshipsIndexes()

      expect(indexes).toBeDefined()
      expect(indexes.some((idx) => idx.name.includes('from'))).toBe(true)
    })

    it('creates to index on Relationships collection', async () => {
      // Relationships should have an index on 'to' for backward traversal
      const indexes = await store.getRelationshipsIndexes()

      expect(indexes).toBeDefined()
      expect(indexes.some((idx) => idx.name.includes('to'))).toBe(true)
    })

    it('creates unique compound index on (verb, from, to)', async () => {
      // The unique constraint should be enforced via a compound unique index
      const indexes = await store.getRelationshipsIndexes()

      expect(indexes).toBeDefined()
      const uniqueIndex = indexes.find((idx) => idx.unique === true)
      expect(uniqueIndex).toBeDefined()
      expect(uniqueIndex?.key).toHaveProperty('verb')
      expect(uniqueIndex?.key).toHaveProperty('from')
      expect(uniqueIndex?.key).toHaveProperty('to')
    })
  })

  // ==========================================================================
  // JSON Query Operator Tests
  // ==========================================================================

  describe('JSON Query Operators', () => {
    beforeEach(async () => {
      // Seed test data with various data shapes
      await store.createThing({
        id: 'customer-1',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Alice', age: 30, tier: 'premium', tags: ['vip', 'early-adopter'] },
      })
      await store.createThing({
        id: 'customer-2',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Bob', age: 25, tier: 'basic', tags: ['new'] },
      })
      await store.createThing({
        id: 'customer-3',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Carol', age: 35, tier: 'premium', tags: ['vip'] },
      })
    })

    it('supports $eq operator for exact matching', async () => {
      const results = await store.findThings({
        typeId: 1,
        dataQuery: { 'data.tier': { $eq: 'premium' } },
      })

      expect(results.length).toBe(2)
      expect(results.every((t) => (t.data as { tier: string }).tier === 'premium')).toBe(true)
    })

    it('supports $gt operator for numeric comparison', async () => {
      const results = await store.findThings({
        typeId: 1,
        dataQuery: { 'data.age': { $gt: 28 } },
      })

      expect(results.length).toBe(2)
      expect(results.every((t) => (t.data as { age: number }).age > 28)).toBe(true)
    })

    it('supports $gte operator for numeric comparison', async () => {
      const results = await store.findThings({
        typeId: 1,
        dataQuery: { 'data.age': { $gte: 30 } },
      })

      expect(results.length).toBe(2)
      expect(results.every((t) => (t.data as { age: number }).age >= 30)).toBe(true)
    })

    it('supports $lt operator for numeric comparison', async () => {
      const results = await store.findThings({
        typeId: 1,
        dataQuery: { 'data.age': { $lt: 30 } },
      })

      expect(results.length).toBe(1)
      expect((results[0]?.data as { name: string }).name).toBe('Bob')
    })

    it('supports $lte operator for numeric comparison', async () => {
      const results = await store.findThings({
        typeId: 1,
        dataQuery: { 'data.age': { $lte: 30 } },
      })

      expect(results.length).toBe(2)
    })

    it('supports $in operator for array matching', async () => {
      const results = await store.findThings({
        typeId: 1,
        dataQuery: { 'data.tier': { $in: ['premium', 'enterprise'] } },
      })

      expect(results.length).toBe(2)
    })

    it('supports $nin operator for negative array matching', async () => {
      const results = await store.findThings({
        typeId: 1,
        dataQuery: { 'data.tier': { $nin: ['premium'] } },
      })

      expect(results.length).toBe(1)
      expect((results[0]?.data as { tier: string }).tier).toBe('basic')
    })

    it('supports $regex operator for pattern matching', async () => {
      const results = await store.findThings({
        typeId: 1,
        dataQuery: { 'data.name': { $regex: '^A' } },
      })

      expect(results.length).toBe(1)
      expect((results[0]?.data as { name: string }).name).toBe('Alice')
    })

    it('supports $exists operator', async () => {
      // Add a thing without the 'tier' field
      await store.createThing({
        id: 'customer-4',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Dave', age: 40 },
      })

      const withTier = await store.findThings({
        typeId: 1,
        dataQuery: { 'data.tier': { $exists: true } },
      })

      expect(withTier.length).toBe(3)

      const withoutTier = await store.findThings({
        typeId: 1,
        dataQuery: { 'data.tier': { $exists: false } },
      })

      expect(withoutTier.length).toBe(1)
      expect((withoutTier[0]?.data as { name: string }).name).toBe('Dave')
    })

    it('supports nested field queries', async () => {
      // Add thing with nested data
      await store.createThing({
        id: 'order-1',
        typeId: 2,
        typeName: 'Order',
        data: {
          customer: { name: 'Alice', tier: 'premium' },
          total: 199.99,
        },
      })

      const results = await store.findThings({
        typeId: 2,
        dataQuery: { 'data.customer.tier': { $eq: 'premium' } },
      })

      expect(results.length).toBe(1)
    })

    it('supports $elemMatch for array element queries', async () => {
      const results = await store.findThings({
        typeId: 1,
        dataQuery: { 'data.tags': { $elemMatch: { $eq: 'vip' } } },
      })

      expect(results.length).toBe(2)
    })

    it('supports $all operator for array contains all', async () => {
      const results = await store.findThings({
        typeId: 1,
        dataQuery: { 'data.tags': { $all: ['vip', 'early-adopter'] } },
      })

      expect(results.length).toBe(1)
      expect((results[0]?.data as { name: string }).name).toBe('Alice')
    })

    it('supports combined logical operators', async () => {
      const results = await store.findThings({
        typeId: 1,
        dataQuery: {
          $and: [{ 'data.tier': { $eq: 'premium' } }, { 'data.age': { $gte: 30 } }],
        },
      })

      expect(results.length).toBe(2)
    })

    it('supports $or operator', async () => {
      const results = await store.findThings({
        typeId: 1,
        dataQuery: {
          $or: [{ 'data.tier': { $eq: 'basic' } }, { 'data.age': { $gte: 35 } }],
        },
      })

      expect(results.length).toBe(2) // Bob (basic) and Carol (age 35)
    })
  })

  // ==========================================================================
  // Batch Operation Tests
  // ==========================================================================

  describe('Batch Operations', () => {
    it('handles batch Thing creation efficiently', async () => {
      const things = Array.from({ length: 100 }, (_, i) => ({
        id: `batch-thing-${i}`,
        typeId: 1,
        typeName: 'Customer',
        data: { index: i, name: `Customer ${i}` },
      }))

      const startTime = Date.now()
      const results = await store.createThingsBatch(things)
      const endTime = Date.now()

      expect(results.length).toBe(100)
      expect(results.every((t) => t.id.startsWith('batch-thing-'))).toBe(true)

      // Batch should be faster than individual inserts
      // Allow generous time but ensure it's not doing individual network calls
      expect(endTime - startTime).toBeLessThan(5000) // 5 seconds for 100 items is reasonable
    })

    it('handles batch Relationship creation efficiently', async () => {
      const relationships = Array.from({ length: 100 }, (_, i) => ({
        id: `batch-rel-${i}`,
        verb: 'owns',
        from: `do://tenant/user-${i}`,
        to: `do://tenant/project-${i}`,
        data: { priority: i % 5 },
      }))

      const startTime = Date.now()
      const results = await store.createRelationshipsBatch(relationships)
      const endTime = Date.now()

      expect(results.length).toBe(100)
      expect(results.every((r) => r.id.startsWith('batch-rel-'))).toBe(true)
      expect(endTime - startTime).toBeLessThan(5000)
    })

    it('batch creation rolls back on duplicate error', async () => {
      // Create initial thing
      await store.createThing({
        id: 'existing-thing',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Existing' },
      })

      // Try to batch create including a duplicate
      const things = [
        { id: 'new-thing-1', typeId: 1, typeName: 'Customer', data: { name: 'New 1' } },
        { id: 'existing-thing', typeId: 1, typeName: 'Customer', data: { name: 'Duplicate' } },
        { id: 'new-thing-2', typeId: 1, typeName: 'Customer', data: { name: 'New 2' } },
      ]

      await expect(store.createThingsBatch(things)).rejects.toThrow()

      // Verify rollback - new-thing-1 should not exist
      const thing1 = await store.getThing('new-thing-1')
      expect(thing1).toBeNull()
    })

    it('supports batch updates with bulkWrite', async () => {
      // Seed data
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          store.createThing({
            id: `update-target-${i}`,
            typeId: 1,
            typeName: 'Customer',
            data: { name: `Customer ${i}`, status: 'active' },
          })
        )
      )

      // Bulk update all to inactive
      const result = await store.bulkUpdateThings(
        { typeId: 1 },
        { $set: { 'data.status': 'inactive' } }
      )

      expect(result.modifiedCount).toBe(10)

      // Verify all updated
      const things = await store.getThingsByType({ typeId: 1 })
      expect(things.every((t) => (t.data as { status: string }).status === 'inactive')).toBe(true)
    })

    it('supports batch delete operations', async () => {
      // Seed data
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          store.createThing({
            id: `delete-target-${i}`,
            typeId: 1,
            typeName: 'Customer',
            data: { name: `Customer ${i}` },
          })
        )
      )

      // Batch soft delete
      const result = await store.bulkDeleteThings({ typeId: 1 })

      expect(result.deletedCount).toBe(10)

      // Verify all soft deleted
      const things = await store.getThingsByType({ typeId: 1 })
      expect(things.length).toBe(0)

      // But they should still exist when including deleted
      const allThings = await store.getThingsByType({ typeId: 1, includeDeleted: true })
      expect(allThings.length).toBe(10)
    })
  })

  // ==========================================================================
  // Aggregation Pipeline Tests
  // ==========================================================================

  describe('Aggregation Support', () => {
    beforeEach(async () => {
      // Seed data for aggregation tests
      await store.createThing({
        id: 'order-1',
        typeId: 2,
        typeName: 'Order',
        data: { customerId: 'c1', total: 100, status: 'completed' },
      })
      await store.createThing({
        id: 'order-2',
        typeId: 2,
        typeName: 'Order',
        data: { customerId: 'c1', total: 200, status: 'completed' },
      })
      await store.createThing({
        id: 'order-3',
        typeId: 2,
        typeName: 'Order',
        data: { customerId: 'c2', total: 150, status: 'pending' },
      })
    })

    it('supports aggregation pipeline for Things', async () => {
      const results = await store.aggregateThings([
        { $match: { typeName: 'Order' } },
        {
          $group: {
            _id: '$data.customerId',
            totalSpent: { $sum: '$data.total' },
            orderCount: { $sum: 1 },
          },
        },
        { $sort: { totalSpent: -1 } },
      ])

      expect(results.length).toBe(2)
      expect(results[0]?._id).toBe('c1')
      expect(results[0]?.totalSpent).toBe(300)
      expect(results[0]?.orderCount).toBe(2)
    })

    it('supports aggregation for Relationship analysis', async () => {
      // Create relationships for graph analysis
      await store.createRelationship({
        id: 'rel-1',
        verb: 'purchased',
        from: 'do://tenant/customers/c1',
        to: 'do://tenant/products/p1',
      })
      await store.createRelationship({
        id: 'rel-2',
        verb: 'purchased',
        from: 'do://tenant/customers/c1',
        to: 'do://tenant/products/p2',
      })
      await store.createRelationship({
        id: 'rel-3',
        verb: 'purchased',
        from: 'do://tenant/customers/c2',
        to: 'do://tenant/products/p1',
      })

      // Count purchases per product
      const results = await store.aggregateRelationships([
        { $match: { verb: 'purchased' } },
        {
          $group: {
            _id: '$to',
            purchaseCount: { $sum: 1 },
          },
        },
        { $sort: { purchaseCount: -1 } },
      ])

      expect(results.length).toBe(2)
      expect(results[0]?._id).toBe('do://tenant/products/p1')
      expect(results[0]?.purchaseCount).toBe(2)
    })
  })

  // ==========================================================================
  // Transaction Tests
  // ==========================================================================

  describe('Transaction Support', () => {
    it('supports transactional Thing and Relationship creation', async () => {
      // Create thing and relationship atomically
      await store.transaction(async (session) => {
        await session.createThing({
          id: 'tx-thing',
          typeId: 1,
          typeName: 'Customer',
          data: { name: 'Transaction Customer' },
        })

        await session.createRelationship({
          id: 'tx-rel',
          verb: 'created',
          from: 'do://system',
          to: 'do://tenant/customers/tx-thing',
        })
      })

      // Verify both were created
      const thing = await store.getThing('tx-thing')
      expect(thing).not.toBeNull()

      const rels = await store.queryRelationshipsTo('do://tenant/customers/tx-thing')
      expect(rels.length).toBe(1)
    })

    it('rolls back transaction on error', async () => {
      // Create initial thing
      await store.createThing({
        id: 'existing',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Existing' },
      })

      // Attempt transaction that will fail
      await expect(
        store.transaction(async (session) => {
          await session.createThing({
            id: 'new-in-tx',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'New' },
          })

          // This should fail (duplicate ID)
          await session.createThing({
            id: 'existing',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'Duplicate' },
          })
        })
      ).rejects.toThrow()

      // Verify rollback - 'new-in-tx' should not exist
      const thing = await store.getThing('new-in-tx')
      expect(thing).toBeNull()
    })
  })

  // ==========================================================================
  // Collection Statistics Tests
  // ==========================================================================

  describe('Collection Statistics', () => {
    it('returns Things collection stats', async () => {
      // Seed some data
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          store.createThing({
            id: `stat-thing-${i}`,
            typeId: 1,
            typeName: 'Customer',
            data: { name: `Customer ${i}` },
          })
        )
      )

      const stats = await store.getThingsStats()

      expect(stats.count).toBe(10)
      expect(stats.nindexes).toBeGreaterThan(0)
    })

    it('returns Relationships collection stats', async () => {
      // Seed some relationships
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          store.createRelationship({
            id: `stat-rel-${i}`,
            verb: 'owns',
            from: `do://tenant/user-${i}`,
            to: `do://tenant/project-${i}`,
          })
        )
      )

      const stats = await store.getRelationshipsStats()

      expect(stats.count).toBe(10)
      expect(stats.nindexes).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // Change Stream Tests (Optional - may not be supported in all backends)
  // ==========================================================================

  describe('Change Stream Support', () => {
    it.skip('watches for Thing changes', async () => {
      // Change streams may not be supported in in-memory mode
      // This test is skipped but documents the expected API

      const changes: unknown[] = []
      const stream = store.watchThings()

      // Start collecting changes
      const collector = (async () => {
        for await (const change of stream) {
          changes.push(change)
          if (changes.length >= 2) break
        }
      })()

      // Make changes
      await store.createThing({
        id: 'watch-thing-1',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Watched 1' },
      })
      await store.createThing({
        id: 'watch-thing-2',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Watched 2' },
      })

      await collector
      await stream.close()

      expect(changes.length).toBe(2)
    })
  })
})

// ============================================================================
// Export Verification Tests
// ============================================================================

describe('[RED] DocumentGraphStore Implementation', () => {
  it('DocumentGraphStore is exported from db/graph/stores/document', async () => {
    // This test verifies the export exists
    // Will fail until implementation is created
    const storeModule = await import('../stores/document').catch(() => null)

    expect(storeModule).not.toBeNull()
    expect(storeModule?.DocumentGraphStore).toBeDefined()
  })

  it('DocumentGraphStore implements GraphStore interface', async () => {
    const { DocumentGraphStore } = await import('../stores/document')

    // Type check - DocumentGraphStore should satisfy GraphStore
    const store = new DocumentGraphStore(':memory:')
    await store.initialize()

    // Verify interface methods exist
    expect(typeof store.createThing).toBe('function')
    expect(typeof store.getThing).toBe('function')
    expect(typeof store.getThingsByType).toBe('function')
    expect(typeof store.updateThing).toBe('function')
    expect(typeof store.deleteThing).toBe('function')
    expect(typeof store.createRelationship).toBe('function')
    expect(typeof store.queryRelationshipsFrom).toBe('function')
    expect(typeof store.queryRelationshipsTo).toBe('function')
    expect(typeof store.queryRelationshipsByVerb).toBe('function')
    expect(typeof store.deleteRelationship).toBe('function')

    await store.close()
  })

  it('DocumentGraphStore has DocumentStore-specific methods', async () => {
    const { DocumentGraphStore } = await import('../stores/document')
    const store = new DocumentGraphStore(':memory:')
    await store.initialize()

    // DocumentStore-specific methods
    expect(typeof store.getThingsIndexes).toBe('function')
    expect(typeof store.getRelationshipsIndexes).toBe('function')
    expect(typeof store.findThings).toBe('function')
    expect(typeof store.createThingsBatch).toBe('function')
    expect(typeof store.createRelationshipsBatch).toBe('function')
    expect(typeof store.bulkUpdateThings).toBe('function')
    expect(typeof store.bulkDeleteThings).toBe('function')
    expect(typeof store.aggregateThings).toBe('function')
    expect(typeof store.aggregateRelationships).toBe('function')
    expect(typeof store.transaction).toBe('function')
    expect(typeof store.getThingsStats).toBe('function')
    expect(typeof store.getRelationshipsStats).toBe('function')

    await store.close()
  })
})
