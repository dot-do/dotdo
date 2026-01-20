import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createThingsStore, type ThingsStore } from '../things'
import { createRelationshipsStore, type RelationshipsStore } from '../relationships'
import { query, createQuery, JoinType, configureQueryLimits } from '../query'

describe('Query Builder - JOIN Operations', () => {
  let store: ThingsStore
  let relationships: RelationshipsStore

  beforeEach(async () => {
    store = createThingsStore()
    relationships = createRelationshipsStore()

    // Use warn mode for existing tests to maintain backwards compatibility
    // New code should use strict mode (default) with explicit limits
    configureQueryLimits({ mode: 'warn' })

    // Seed test data - Users
    const alice = await store.create({ $type: 'User', name: 'Alice', role: 'admin' })
    const bob = await store.create({ $type: 'User', name: 'Bob', role: 'user' })
    const charlie = await store.create({ $type: 'User', name: 'Charlie', role: 'user' })

    // Seed test data - Orders
    const order1 = await store.create({ $type: 'Order', total: 100, status: 'pending' })
    const order2 = await store.create({ $type: 'Order', total: 200, status: 'completed' })
    const order3 = await store.create({ $type: 'Order', total: 300, status: 'pending' })

    // Seed test data - Products
    const product1 = await store.create({ $type: 'Product', name: 'Widget', price: 50 })
    const product2 = await store.create({ $type: 'Product', name: 'Gadget', price: 75 })

    // Create relationships
    // Alice placed order1 and order2
    await relationships.add({ subject: alice.$id, predicate: 'placed', object: order1.$id })
    await relationships.add({ subject: alice.$id, predicate: 'placed', object: order2.$id })

    // Bob placed order3
    await relationships.add({ subject: bob.$id, predicate: 'placed', object: order3.$id })

    // Charlie has no orders (for LEFT JOIN tests)

    // Order1 contains product1
    await relationships.add({ subject: order1.$id, predicate: 'contains', object: product1.$id })

    // Order2 contains product1 and product2
    await relationships.add({ subject: order2.$id, predicate: 'contains', object: product1.$id })
    await relationships.add({ subject: order2.$id, predicate: 'contains', object: product2.$id })

    // Store references for tests (via store's internal state)
    ;(store as unknown as { _testData: Record<string, unknown> })._testData = { alice, bob, charlie, order1, order2, order3, product1, product2 }
    ;(relationships as unknown as { _testStore: ThingsStore })._testStore = store
  })

  afterEach(() => {
    // Reset to strict mode (default)
    configureQueryLimits({ mode: 'strict' })
  })

  describe('INNER JOIN', () => {
    it('should join Things via relationship predicate', async () => {
      // Get all Users who have placed Orders
      const results = await query(store, relationships)
        .type('User')
        .join('placed', 'Order')
        .execute()

      // Alice and Bob placed orders, Charlie did not
      expect(results).toHaveLength(2)
      expect(results.map(r => r.name).sort()).toEqual(['Alice', 'Bob'])
    })

    it('should return related things in the result', async () => {
      const results = await query(store, relationships)
        .type('User')
        .join('placed', 'Order')
        .execute()

      // Each result should have the joined data
      const alice = results.find(r => r.name === 'Alice')
      expect(alice).toBeDefined()
      expect(alice!._joined).toBeDefined()
      expect(alice!._joined!.placed).toHaveLength(2)
      expect(alice!._joined!.placed[0].$type).toBe('Order')
    })

    it('should filter results based on joined data', async () => {
      // Get Users who have placed completed Orders
      const results = await query(store, relationships)
        .type('User')
        .join('placed', 'Order', { status: 'completed' })
        .execute()

      // Only Alice has a completed order
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Alice')
    })

    it('should support inverse join direction (object -> subject)', async () => {
      // Get Orders that were placed by admin Users
      const results = await query(store, relationships)
        .type('Order')
        .joinFrom('placed', 'User', { role: 'admin' })
        .execute()

      // Orders 1 and 2 were placed by Alice (admin)
      expect(results).toHaveLength(2)
      expect(results.every(r => r._joined?.placedBy?.[0]?.role === 'admin')).toBe(true)
    })
  })

  describe('LEFT JOIN', () => {
    it('should include all source entities even without matches', async () => {
      const results = await query(store, relationships)
        .type('User')
        .leftJoin('placed', 'Order')
        .execute()

      // All 3 users should be returned
      expect(results).toHaveLength(3)

      // Charlie should have empty joined data
      const charlie = results.find(r => r.name === 'Charlie')
      expect(charlie).toBeDefined()
      expect(charlie!._joined?.placed).toEqual([])
    })

    it('should distinguish between no matches and null values', async () => {
      const results = await query(store, relationships)
        .type('User')
        .leftJoin('placed', 'Order')
        .execute()

      const alice = results.find(r => r.name === 'Alice')
      const charlie = results.find(r => r.name === 'Charlie')

      // Alice has orders
      expect(alice!._joined?.placed?.length).toBeGreaterThan(0)

      // Charlie has no orders, but _joined should exist with empty array
      expect(charlie!._joined).toBeDefined()
      expect(charlie!._joined?.placed).toEqual([])
    })

    it('should support leftJoinFrom for inverse direction', async () => {
      // Get all Orders with the Users who placed them (including orders without users)
      // First create an orphan order
      const orphanOrder = await store.create({ $type: 'Order', total: 999, status: 'orphan' })

      const results = await query(store, relationships)
        .type('Order')
        .leftJoinFrom('placed', 'User')
        .execute()

      // Should include all 4 orders
      expect(results).toHaveLength(4)

      // Orphan order should have empty joined users
      const orphan = results.find(r => r.total === 999)
      expect(orphan).toBeDefined()
      expect(orphan!._joined?.placedBy).toEqual([])
    })
  })

  describe('RIGHT JOIN', () => {
    it('should include all target entities even without matches', async () => {
      // Create an orphan order with no user relationship
      const orphanOrder = await store.create({ $type: 'Order', total: 999, status: 'orphan' })

      const results = await query(store, relationships)
        .type('User')
        .rightJoin('placed', 'Order')
        .execute()

      // Should include matched users AND a null entry for the orphan order
      // Alice and Bob have orders (2 users matched)
      // Plus an entry for the orphan order that has no user
      expect(results.length).toBeGreaterThanOrEqual(3)

      // Find the null entry for the orphan order
      const orphanEntry = results.find(r => r.$id === '' && r._joined?.placed?.[0]?.total === 999)
      expect(orphanEntry).toBeDefined()
    })

    it('should include all matched source entities with their joins', async () => {
      const results = await query(store, relationships)
        .type('User')
        .rightJoin('placed', 'Order')
        .execute()

      // Alice and Bob should have their orders
      const alice = results.find(r => r.name === 'Alice')
      const bob = results.find(r => r.name === 'Bob')

      expect(alice).toBeDefined()
      expect(alice!._joined?.placed?.length).toBeGreaterThan(0)

      expect(bob).toBeDefined()
      expect(bob!._joined?.placed?.length).toBeGreaterThan(0)
    })

    it('should support rightJoinFrom for inverse direction', async () => {
      // Create a user who has no orders pointing to them
      const dave = await store.create({ $type: 'User', name: 'Dave', role: 'guest' })

      const results = await query(store, relationships)
        .type('Order')
        .rightJoinFrom('placed', 'User')
        .execute()

      // Should include orders plus null entries for users with no orders (Charlie and Dave)
      const nullEntries = results.filter(r => r.$id === '')
      expect(nullEntries.length).toBeGreaterThanOrEqual(2) // Charlie and Dave

      // Check that unmatched users appear in the null entries
      const charlieEntry = nullEntries.find(r => r._joined?.placedBy?.[0]?.name === 'Charlie')
      const daveEntry = nullEntries.find(r => r._joined?.placedBy?.[0]?.name === 'Dave')

      expect(charlieEntry).toBeDefined()
      expect(daveEntry).toBeDefined()
    })

    it('should filter right joined entities by conditions', async () => {
      // Create orders with different statuses
      const orphanCompleted = await store.create({ $type: 'Order', total: 888, status: 'completed' })
      const orphanPending = await store.create({ $type: 'Order', total: 777, status: 'pending' })

      const results = await query(store, relationships)
        .type('User')
        .rightJoin('placed', 'Order', { status: 'completed' })
        .execute()

      // Should only include completed orders in the null entries
      const nullEntries = results.filter(r => r.$id === '')

      // All null entries should have completed orders only
      for (const entry of nullEntries) {
        const orders = entry._joined?.placed || []
        for (const order of orders) {
          expect(order.status).toBe('completed')
        }
      }
    })
  })

  describe('FULL OUTER JOIN', () => {
    it('should include all entities from both sides', async () => {
      // Create an orphan order with no user relationship
      const orphanOrder = await store.create({ $type: 'Order', total: 999, status: 'orphan' })

      const results = await query(store, relationships)
        .type('User')
        .fullJoin('placed', 'Order')
        .execute()

      // Should include:
      // - All 3 users (Alice, Bob, Charlie - Charlie has no orders)
      // - Plus null entry for the orphan order
      expect(results.length).toBeGreaterThanOrEqual(4)

      // Check Charlie is included (user with no orders)
      const charlie = results.find(r => r.name === 'Charlie')
      expect(charlie).toBeDefined()
      expect(charlie!._joined?.placed).toEqual([])

      // Check orphan order is included via null entry
      const orphanEntry = results.find(r => r.$id === '' && r._joined?.placed?.[0]?.total === 999)
      expect(orphanEntry).toBeDefined()
    })

    it('should include matched entities with their joined data', async () => {
      const results = await query(store, relationships)
        .type('User')
        .fullJoin('placed', 'Order')
        .execute()

      // Alice should have her orders
      const alice = results.find(r => r.name === 'Alice')
      expect(alice).toBeDefined()
      expect(alice!._joined?.placed?.length).toBe(2)

      // Bob should have his order
      const bob = results.find(r => r.name === 'Bob')
      expect(bob).toBeDefined()
      expect(bob!._joined?.placed?.length).toBe(1)
    })

    it('should support fullJoinFrom for inverse direction', async () => {
      // Create a user who has no orders pointing to them
      const dave = await store.create({ $type: 'User', name: 'Dave', role: 'guest' })
      // Create an orphan order
      const orphanOrder = await store.create({ $type: 'Order', total: 999, status: 'orphan' })

      const results = await query(store, relationships)
        .type('Order')
        .fullJoinFrom('placed', 'User')
        .execute()

      // Should include:
      // - All 4 orders (3 original + orphan)
      // - Plus null entries for users with no orders (Charlie and Dave)
      expect(results.length).toBeGreaterThanOrEqual(6)

      // Check orphan order is included directly
      const orphan = results.find(r => r.total === 999 && r.$id !== '')
      expect(orphan).toBeDefined()
      expect(orphan!._joined?.placedBy).toEqual([])

      // Check unmatched users appear as null entries
      const nullEntries = results.filter(r => r.$id === '')
      const charlieEntry = nullEntries.find(r => r._joined?.placedBy?.[0]?.name === 'Charlie')
      const daveEntry = nullEntries.find(r => r._joined?.placedBy?.[0]?.name === 'Dave')

      expect(charlieEntry).toBeDefined()
      expect(daveEntry).toBeDefined()
    })

    it('should filter full joined entities by conditions', async () => {
      // Create orders with different statuses
      const orphanCompleted = await store.create({ $type: 'Order', total: 888, status: 'completed' })
      const orphanPending = await store.create({ $type: 'Order', total: 777, status: 'pending' })

      const results = await query(store, relationships)
        .type('User')
        .fullJoin('placed', 'Order', { status: 'completed' })
        .execute()

      // All users should be included (FULL JOIN preserves left side)
      expect(results.filter(r => r.name).length).toBe(3) // Alice, Bob, Charlie

      // Null entries should only have completed orders
      const nullEntries = results.filter(r => r.$id === '')
      for (const entry of nullEntries) {
        const orders = entry._joined?.placed || []
        for (const order of orders) {
          expect(order.status).toBe('completed')
        }
      }
    })

    it('should handle FULL JOIN with no matches on either side', async () => {
      const emptyStore = createThingsStore()
      const emptyRelationships = createRelationshipsStore()

      // Create users with no orders
      await emptyStore.create({ $type: 'User', name: 'Lonely1' })
      await emptyStore.create({ $type: 'User', name: 'Lonely2' })

      // Create orphan orders
      await emptyStore.create({ $type: 'Order', total: 100 })
      await emptyStore.create({ $type: 'Order', total: 200 })

      const results = await query(emptyStore, emptyRelationships)
        .type('User')
        .fullJoin('placed', 'Order')
        .execute()

      // Should include both users (with empty joins)
      const users = results.filter(r => r.name)
      expect(users.length).toBe(2)
      for (const user of users) {
        expect(user._joined?.placed).toEqual([])
      }

      // Should include null entries for orphan orders
      const nullEntries = results.filter(r => r.$id === '')
      expect(nullEntries.length).toBe(2)
    })
  })

  describe('Multiple Joins', () => {
    it('should support chaining multiple joins', async () => {
      // Get Users with their Orders and the Products in those Orders
      const results = await query(store, relationships)
        .type('User')
        .join('placed', 'Order')
        .join('contains', 'Product', undefined, 'placed') // Join from the 'placed' join result
        .execute()

      const alice = results.find(r => r.name === 'Alice')
      expect(alice).toBeDefined()
      expect(alice!._joined?.placed).toBeDefined()

      // Alice's orders should have nested product joins
      const aliceOrders = alice!._joined?.placed || []
      const orderWithProducts = aliceOrders.find((o: { _joined?: { contains?: unknown[] } }) => o._joined?.contains?.length && o._joined.contains.length > 0)
      expect(orderWithProducts).toBeDefined()
    })

    it('should support multiple independent joins', async () => {
      // Create another relationship type for testing
      await relationships.add({
        subject: (store as unknown as { _testData: Record<string, { $id: string }> })._testData.alice.$id,
        predicate: 'manages',
        object: (store as unknown as { _testData: Record<string, { $id: string }> })._testData.bob.$id
      })

      const results = await query(store, relationships)
        .type('User')
        .where('name', 'Alice')
        .leftJoin('placed', 'Order')
        .leftJoin('manages', 'User')
        .execute()

      expect(results).toHaveLength(1)
      const alice = results[0]

      expect(alice._joined?.placed).toBeDefined()
      expect(alice._joined?.manages).toBeDefined()
      expect(alice._joined?.placed?.length).toBeGreaterThan(0)
      expect(alice._joined?.manages?.length).toBe(1)
    })
  })

  describe('Join with Conditions', () => {
    it('should filter joined entities by conditions', async () => {
      const results = await query(store, relationships)
        .type('User')
        .join('placed', 'Order', { status: 'pending' })
        .execute()

      // Check that only pending orders are included
      for (const user of results) {
        const orders = user._joined?.placed || []
        for (const order of orders) {
          expect(order.status).toBe('pending')
        }
      }
    })

    it('should support multiple conditions in join', async () => {
      // Create additional test data
      const highValuePending = await store.create({ $type: 'Order', total: 500, status: 'pending' })
      await relationships.add({
        subject: (store as unknown as { _testData: Record<string, { $id: string }> })._testData.alice.$id,
        predicate: 'placed',
        object: highValuePending.$id
      })

      const results = await query(store, relationships)
        .type('User')
        .join('placed', 'Order', { status: 'pending', total: 500 })
        .execute()

      // Only Alice has a pending order with total 500
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Alice')
      expect(results[0]._joined?.placed?.[0]?.total).toBe(500)
    })

    it('should combine where and join conditions', async () => {
      const results = await query(store, relationships)
        .type('User')
        .where('role', 'admin')
        .join('placed', 'Order', { status: 'completed' })
        .execute()

      // Admin users with completed orders
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Alice')
      expect(results[0].role).toBe('admin')
    })
  })

  describe('Join Aliases', () => {
    it('should support aliasing joined data', async () => {
      const results = await query(store, relationships)
        .type('User')
        .join('placed', 'Order', undefined, undefined, 'orders')
        .execute()

      const alice = results.find(r => r.name === 'Alice')
      expect(alice!._joined?.orders).toBeDefined()
      expect(alice!._joined?.placed).toBeUndefined()
    })
  })

  describe('Edge Cases', () => {
    it('should handle self-referential joins', async () => {
      // User manages User
      await relationships.add({
        subject: (store as unknown as { _testData: Record<string, { $id: string }> })._testData.alice.$id,
        predicate: 'manages',
        object: (store as unknown as { _testData: Record<string, { $id: string }> })._testData.bob.$id
      })

      const results = await query(store, relationships)
        .type('User')
        .join('manages', 'User')
        .execute()

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Alice')
      expect(results[0]._joined?.manages?.[0]?.name).toBe('Bob')
    })

    it('should handle cyclic relationships without infinite loops', async () => {
      // Create a cycle: Alice -> Bob -> Alice
      await relationships.add({
        subject: (store as unknown as { _testData: Record<string, { $id: string }> })._testData.alice.$id,
        predicate: 'follows',
        object: (store as unknown as { _testData: Record<string, { $id: string }> })._testData.bob.$id
      })
      await relationships.add({
        subject: (store as unknown as { _testData: Record<string, { $id: string }> })._testData.bob.$id,
        predicate: 'follows',
        object: (store as unknown as { _testData: Record<string, { $id: string }> })._testData.alice.$id
      })

      const results = await query(store, relationships)
        .type('User')
        .join('follows', 'User')
        .execute()

      // Both should be returned without infinite loop
      expect(results).toHaveLength(2)
    })

    it('should handle empty store gracefully', async () => {
      const emptyStore = createThingsStore()
      const emptyRelationships = createRelationshipsStore()

      const results = await query(emptyStore, emptyRelationships)
        .type('User')
        .join('placed', 'Order')
        .execute()

      expect(results).toEqual([])
    })

    it('should handle non-existent relationship predicate', async () => {
      const results = await query(store, relationships)
        .type('User')
        .join('nonexistent', 'Order')
        .execute()

      expect(results).toEqual([])
    })

    it('should handle non-existent target type', async () => {
      const results = await query(store, relationships)
        .type('User')
        .join('placed', 'NonExistentType')
        .execute()

      expect(results).toEqual([])
    })
  })

  describe('Performance Considerations', () => {
    it('should support limiting joined results', async () => {
      const results = await query(store, relationships)
        .type('User')
        .join('placed', 'Order', undefined, undefined, undefined, { limit: 1 })
        .execute()

      const alice = results.find(r => r.name === 'Alice')
      // Alice has 2 orders but should only get 1 due to limit
      expect(alice!._joined?.placed?.length).toBe(1)
    })

    it('should support selecting specific fields from joined entities', async () => {
      const results = await query(store, relationships)
        .type('User')
        .select('name')
        .join('placed', 'Order', undefined, undefined, undefined, { select: ['status'] })
        .execute()

      const alice = results.find(r => r.name === 'Alice')
      expect(alice!._joined?.placed?.[0]).toHaveProperty('status')
      expect(alice!._joined?.placed?.[0]).toHaveProperty('$id')
      expect(alice!._joined?.placed?.[0]).not.toHaveProperty('total')
    })
  })
})

describe('JoinType enum', () => {
  it('should export all join type constants', () => {
    expect(JoinType.INNER).toBe('inner')
    expect(JoinType.LEFT).toBe('left')
    expect(JoinType.RIGHT).toBe('right')
    expect(JoinType.FULL).toBe('full')
  })

  it('should have correct type values', () => {
    // Verify the object has exactly 4 join types
    const joinTypes = Object.values(JoinType)
    expect(joinTypes).toHaveLength(4)
    expect(joinTypes).toContain('inner')
    expect(joinTypes).toContain('left')
    expect(joinTypes).toContain('right')
    expect(joinTypes).toContain('full')
  })
})
