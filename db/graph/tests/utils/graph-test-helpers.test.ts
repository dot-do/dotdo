/**
 * Graph Test Helpers - Unit Tests
 *
 * Tests verifying that the graph test utilities and factories work correctly.
 *
 * @see dotdo-wmtan - [RED] Create graph test utilities and factories
 *
 * Design:
 * - Tests each factory function
 * - Tests each seed scenario
 * - Tests assertion helpers with both passing and failing cases
 * - Uses real SQLite (NO MOCKS) per project testing philosophy
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  // Factory functions
  createTestGraphStore,
  createTestThing,
  createTestThings,
  createTestRelationship,
  createConnectedThings,
  generateTestId,
  resetCounters,
  // Seed functions
  seedTestGraph,
  // Assertion helpers
  assertThingExists,
  assertThingNotExists,
  assertThingHasData,
  assertRelationshipExists,
  assertRelationshipNotExists,
  assertThingCount,
  assertRelationshipCount,
  // Utilities
  buildDoUrl,
  parseDoUrl,
  waitFor,
} from './graph-test-helpers'
import type { SQLiteGraphStore } from '../../stores/sqlite'

// ============================================================================
// FACTORY FUNCTIONS TESTS
// ============================================================================

describe('Graph Test Helpers - Factory Functions', () => {
  let store: SQLiteGraphStore
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    resetCounters()
    const result = await createTestGraphStore()
    store = result.store
    cleanup = result.cleanup
  })

  afterEach(async () => {
    await cleanup()
  })

  describe('createTestGraphStore', () => {
    it('creates an initialized SQLiteGraphStore', async () => {
      expect(store).toBeDefined()
      // Store should be usable
      const thing = await store.createThing({
        id: 'test-thing',
        typeId: 500,
        typeName: 'Customer',
        data: { name: 'Test' },
      })
      expect(thing.id).toBe('test-thing')
    })

    it('provides a cleanup function that closes the store', async () => {
      // Create and immediately clean up a new store
      const { store: newStore, cleanup: newCleanup } = await createTestGraphStore()
      await newCleanup()

      // After cleanup, store operations should fail
      await expect(
        newStore.createThing({
          id: 'after-cleanup',
          typeId: 500,
          typeName: 'Customer',
          data: {},
        })
      ).rejects.toThrow()
    })

    it('creates isolated stores (no data sharing)', async () => {
      // Create a thing in the first store
      await store.createThing({
        id: 'isolated-thing',
        typeId: 500,
        typeName: 'Customer',
        data: { name: 'Isolated' },
      })

      // Create a second store
      const { store: store2, cleanup: cleanup2 } = await createTestGraphStore()

      // Second store should not have the thing
      const thing = await store2.getThing('isolated-thing')
      expect(thing).toBeNull()

      await cleanup2()
    })
  })

  describe('generateTestId', () => {
    it('generates unique IDs', () => {
      const id1 = generateTestId()
      const id2 = generateTestId()
      expect(id1).not.toBe(id2)
    })

    it('uses custom prefix', () => {
      const id = generateTestId('customer')
      expect(id).toMatch(/^customer-\d+-\d+$/)
    })

    it('uses default prefix', () => {
      const id = generateTestId()
      expect(id).toMatch(/^test-\d+-\d+$/)
    })
  })

  describe('createTestThing', () => {
    it('creates a Thing with defaults', async () => {
      const thing = await createTestThing(store)

      expect(thing.id).toMatch(/^customer-/)
      expect(thing.typeName).toBe('Customer')
      expect(thing.data).toHaveProperty('name')
    })

    it('creates a Thing with custom typeName', async () => {
      const thing = await createTestThing(store, { typeName: 'HumanUser' })

      expect(thing.typeName).toBe('HumanUser')
      expect(thing.typeId).toBe(10) // HumanUser typeId from registry
    })

    it('creates a Thing with custom ID', async () => {
      const thing = await createTestThing(store, { id: 'my-custom-id' })

      expect(thing.id).toBe('my-custom-id')
    })

    it('creates a Thing with custom data', async () => {
      const thing = await createTestThing(store, {
        data: { name: 'Alice', email: 'alice@example.com' },
      })

      expect(thing.data).toEqual({ name: 'Alice', email: 'alice@example.com' })
    })

    it('uses typeId from NOUN_REGISTRY when typeName is provided', async () => {
      const thing = await createTestThing(store, { typeName: 'Workflow' })

      expect(thing.typeId).toBe(100) // Workflow typeId from registry
      expect(thing.typeName).toBe('Workflow')
    })

    it('uses provided typeId over registry lookup when valid', async () => {
      // Use a valid typeId from NOUN_REGISTRY (100 = Workflow)
      const thing = await createTestThing(store, { typeId: 100, typeName: 'Workflow' })

      expect(thing.typeId).toBe(100)
    })
  })

  describe('createTestThings', () => {
    it('creates multiple Things at once', async () => {
      const things = await createTestThings(store, 5)

      expect(things).toHaveLength(5)
      // All should have unique IDs
      const ids = things.map((t) => t.id)
      expect(new Set(ids).size).toBe(5)
    })

    it('applies options to all Things', async () => {
      const things = await createTestThings(store, 3, { typeName: 'HumanUser' })

      expect(things.every((t) => t.typeName === 'HumanUser')).toBe(true)
    })

    it('creates zero Things when count is 0', async () => {
      const things = await createTestThings(store, 0)

      expect(things).toHaveLength(0)
    })
  })

  describe('createTestRelationship', () => {
    it('creates a Relationship with required fields', async () => {
      const rel = await createTestRelationship(store, {
        verb: 'owns',
        from: 'do://tenant/users/alice',
        to: 'do://tenant/products/widget',
      })

      expect(rel.verb).toBe('owns')
      expect(rel.from).toBe('do://tenant/users/alice')
      expect(rel.to).toBe('do://tenant/products/widget')
      expect(rel.id).toMatch(/^rel-/)
    })

    it('creates a Relationship with custom ID', async () => {
      const rel = await createTestRelationship(store, {
        id: 'my-rel-id',
        verb: 'owns',
        from: 'do://tenant/a',
        to: 'do://tenant/b',
      })

      expect(rel.id).toBe('my-rel-id')
    })

    it('creates a Relationship with data', async () => {
      const rel = await createTestRelationship(store, {
        verb: 'purchased',
        from: 'do://tenant/customers/alice',
        to: 'do://tenant/products/widget',
        data: { quantity: 2, price: 29.99 },
      })

      expect(rel.data).toEqual({ quantity: 2, price: 29.99 })
    })
  })

  describe('createConnectedThings', () => {
    it('creates two Things connected by a relationship', async () => {
      const { from, to, relationship } = await createConnectedThings(store, {
        fromType: 'Customer',
        fromData: { name: 'Alice' },
        toType: 'HumanUser',
        toData: { name: 'Widget' },
        verb: 'purchased',
      })

      expect(from.typeName).toBe('Customer')
      expect(from.data).toEqual({ name: 'Alice' })
      expect(to.typeName).toBe('HumanUser')
      expect(relationship.verb).toBe('purchased')
      expect(relationship.from).toContain(from.id)
      expect(relationship.to).toContain(to.id)
    })

    it('uses defaults when types not specified', async () => {
      const { from, to } = await createConnectedThings(store, {
        verb: 'owns',
      })

      expect(from.typeName).toBe('Customer')
      expect(to.typeName).toBe('Product')
    })

    it('includes relationship data when provided', async () => {
      const { relationship } = await createConnectedThings(store, {
        verb: 'purchased',
        relationshipData: { quantity: 5 },
      })

      expect(relationship.data).toEqual({ quantity: 5 })
    })
  })
})

// ============================================================================
// SEED FUNCTIONS TESTS
// ============================================================================

describe('Graph Test Helpers - Seed Functions', () => {
  let store: SQLiteGraphStore
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    resetCounters()
    const result = await createTestGraphStore()
    store = result.store
    cleanup = result.cleanup
  })

  afterEach(async () => {
    await cleanup()
  })

  describe('seedTestGraph', () => {
    describe('empty scenario', () => {
      it('returns empty graph', async () => {
        const graph = await seedTestGraph(store, 'empty')

        expect(graph.things).toHaveLength(0)
        expect(graph.relationships).toHaveLength(0)
        expect(Object.keys(graph.refs)).toHaveLength(0)
        expect(Object.keys(graph.rels)).toHaveLength(0)
      })
    })

    describe('ecommerce scenario', () => {
      it('creates customers, products, and relationships', async () => {
        const graph = await seedTestGraph(store, 'ecommerce')

        // Should have customers
        expect(graph.refs.alice).toBeDefined()
        expect(graph.refs.bob).toBeDefined()
        expect(graph.refs.charlie).toBeDefined()

        // Should have products
        expect(graph.refs.widget).toBeDefined()
        expect(graph.refs.gadget).toBeDefined()
        expect(graph.refs.gizmo).toBeDefined()

        // Should have purchase relationships
        expect(graph.rels.alicePurchasesWidget).toBeDefined()
        expect(graph.rels.alicePurchasesGadget).toBeDefined()
        expect(graph.rels.bobPurchasesWidget).toBeDefined()

        // Data should be queryable
        const alice = await store.getThing('customer-alice')
        expect(alice?.data).toEqual({ name: 'Alice', email: 'alice@example.com', tier: 'premium' })
      })

      it('creates relationships that can be queried', async () => {
        await seedTestGraph(store, 'ecommerce')

        const alicePurchases = await store.queryRelationshipsFrom('do://tenant/customers/customer-alice')
        expect(alicePurchases.filter((r) => r.verb === 'purchased')).toHaveLength(2)
      })
    })

    describe('social scenario', () => {
      it('creates users with follow relationships', async () => {
        const graph = await seedTestGraph(store, 'social')

        // Should have users
        expect(graph.refs.alice).toBeDefined()
        expect(graph.refs.bob).toBeDefined()
        expect(graph.refs.charlie).toBeDefined()
        expect(graph.refs.diana).toBeDefined()
        expect(graph.refs.eve).toBeDefined()

        // Should have follow relationships
        const aliceFollows = await store.queryRelationshipsFrom('do://tenant/users/user-alice')
        expect(aliceFollows.filter((r) => r.verb === 'follows').length).toBeGreaterThan(0)
      })

      it('creates mutual follows', async () => {
        await seedTestGraph(store, 'social')

        // Alice follows Bob
        const aliceToBob = await store.queryRelationshipsFrom('do://tenant/users/user-alice', { verb: 'follows' })
        expect(aliceToBob.some((r) => r.to === 'do://tenant/users/user-bob')).toBe(true)

        // Bob follows Alice
        const bobToAlice = await store.queryRelationshipsFrom('do://tenant/users/user-bob', { verb: 'follows' })
        expect(bobToAlice.some((r) => r.to === 'do://tenant/users/user-alice')).toBe(true)
      })
    })

    describe('organization scenario', () => {
      it('creates org hierarchy with teams and members', async () => {
        const graph = await seedTestGraph(store, 'organization')

        // Should have organization
        expect(graph.refs.acme).toBeDefined()
        expect(graph.refs.acme.typeName).toBe('HumanOrganization')

        // Should have teams
        expect(graph.refs.engineering).toBeDefined()
        expect(graph.refs.sales).toBeDefined()

        // Should have members
        expect(graph.refs.nathan).toBeDefined()
        expect(graph.refs.priya).toBeDefined()
        expect(graph.refs.ralph).toBeDefined()

        // Should have membership relationships
        expect(graph.rels.nathanMemberOfAcme).toBeDefined()
        expect(graph.rels.priyaInEngineering).toBeDefined()
      })
    })

    describe('workflow scenario', () => {
      it('creates workflow definition and instances', async () => {
        const graph = await seedTestGraph(store, 'workflow')

        // Should have workflow definition
        expect(graph.refs.onboardingWorkflow).toBeDefined()
        expect(graph.refs.onboardingWorkflow.typeId).toBe(100)

        // Should have instances
        expect(graph.refs.instance1).toBeDefined()
        expect(graph.refs.instance2).toBeDefined()

        // Should have instanceOf relationships
        expect(graph.rels.instance1OfWorkflow).toBeDefined()
      })
    })

    describe('file-tree scenario', () => {
      it('creates directory structure with files', async () => {
        const graph = await seedTestGraph(store, 'file-tree')

        // Should have directories (using Tree type)
        expect(graph.refs.root).toBeDefined()
        expect(graph.refs.root.typeName).toBe('Tree')
        expect(graph.refs.src).toBeDefined()
        expect(graph.refs.tests).toBeDefined()

        // Should have files (using Blob type)
        expect(graph.refs.indexTs).toBeDefined()
        expect(graph.refs.indexTs.typeName).toBe('Blob')
        expect(graph.refs.testTs).toBeDefined()

        // Should have contains relationships
        expect(graph.rels.srcInRoot).toBeDefined()
        expect(graph.rels.indexInSrc).toBeDefined()
      })
    })

    it('throws on unknown scenario', async () => {
      await expect(seedTestGraph(store, 'unknown' as any)).rejects.toThrow('Unknown test graph scenario')
    })
  })
})

// ============================================================================
// ASSERTION HELPERS TESTS
// ============================================================================

describe('Graph Test Helpers - Assertion Helpers', () => {
  let store: SQLiteGraphStore
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    resetCounters()
    const result = await createTestGraphStore()
    store = result.store
    cleanup = result.cleanup
  })

  afterEach(async () => {
    await cleanup()
  })

  describe('assertThingExists', () => {
    it('passes when Thing exists', async () => {
      await createTestThing(store, { id: 'existing-thing' })

      // Should not throw
      await assertThingExists(store, 'existing-thing')
    })

    it('fails when Thing does not exist', async () => {
      await expect(assertThingExists(store, 'non-existent')).rejects.toThrow()
    })

    it('uses custom message in failure', async () => {
      await expect(
        assertThingExists(store, 'missing', 'Custom error message')
      ).rejects.toThrow('Custom error message')
    })
  })

  describe('assertThingNotExists', () => {
    it('passes when Thing does not exist', async () => {
      await assertThingNotExists(store, 'non-existent')
    })

    it('fails when Thing exists', async () => {
      await createTestThing(store, { id: 'existing-thing' })

      await expect(assertThingNotExists(store, 'existing-thing')).rejects.toThrow()
    })
  })

  describe('assertThingHasData', () => {
    it('passes when data matches', async () => {
      await createTestThing(store, {
        id: 'data-thing',
        data: { name: 'Alice', age: 30, city: 'NYC' },
      })

      // Partial match should pass
      await assertThingHasData(store, 'data-thing', { name: 'Alice' })
      await assertThingHasData(store, 'data-thing', { name: 'Alice', age: 30 })
    })

    it('fails when Thing does not exist', async () => {
      await expect(assertThingHasData(store, 'missing', { name: 'Alice' })).rejects.toThrow()
    })

    it('fails when data does not match', async () => {
      await createTestThing(store, {
        id: 'data-thing',
        data: { name: 'Alice' },
      })

      await expect(assertThingHasData(store, 'data-thing', { name: 'Bob' })).rejects.toThrow()
    })
  })

  describe('assertRelationshipExists', () => {
    beforeEach(async () => {
      await createTestRelationship(store, {
        id: 'test-rel',
        verb: 'owns',
        from: 'do://tenant/users/alice',
        to: 'do://tenant/products/widget',
      })
    })

    it('passes when relationship exists by from', async () => {
      await assertRelationshipExists(store, { from: 'do://tenant/users/alice' })
    })

    it('passes when relationship exists by from and verb', async () => {
      await assertRelationshipExists(store, {
        from: 'do://tenant/users/alice',
        verb: 'owns',
      })
    })

    it('passes when relationship exists by to', async () => {
      await assertRelationshipExists(store, { to: 'do://tenant/products/widget' })
    })

    it('passes when relationship exists by verb', async () => {
      await assertRelationshipExists(store, { verb: 'owns' })
    })

    it('fails when relationship does not exist', async () => {
      await expect(
        assertRelationshipExists(store, { from: 'do://tenant/users/bob' })
      ).rejects.toThrow()
    })

    it('fails when wrong verb', async () => {
      await expect(
        assertRelationshipExists(store, {
          from: 'do://tenant/users/alice',
          verb: 'manages',
        })
      ).rejects.toThrow()
    })

    it('throws when no criteria provided', async () => {
      await expect(assertRelationshipExists(store, {})).rejects.toThrow(
        'assertRelationshipExists requires at least one of'
      )
    })
  })

  describe('assertRelationshipNotExists', () => {
    it('passes when relationship does not exist', async () => {
      await assertRelationshipNotExists(store, {
        from: 'do://tenant/users/nobody',
        verb: 'owns',
      })
    })

    it('fails when relationship exists', async () => {
      await createTestRelationship(store, {
        verb: 'owns',
        from: 'do://tenant/users/alice',
        to: 'do://tenant/products/widget',
      })

      await expect(
        assertRelationshipNotExists(store, { from: 'do://tenant/users/alice', verb: 'owns' })
      ).rejects.toThrow()
    })
  })

  describe('assertThingCount', () => {
    it('passes when count matches', async () => {
      await createTestThings(store, 3, { typeName: 'Customer' })

      await assertThingCount(store, 'Customer', 3)
    })

    it('fails when count does not match', async () => {
      await createTestThings(store, 3, { typeName: 'Customer' })

      await expect(assertThingCount(store, 'Customer', 5)).rejects.toThrow()
    })
  })

  describe('assertRelationshipCount', () => {
    it('passes when count matches', async () => {
      await createTestRelationship(store, { verb: 'owns', from: 'a', to: 'b' })
      await createTestRelationship(store, { verb: 'owns', from: 'c', to: 'd' })

      await assertRelationshipCount(store, 'owns', 2)
    })

    it('fails when count does not match', async () => {
      await createTestRelationship(store, { verb: 'owns', from: 'a', to: 'b' })

      await expect(assertRelationshipCount(store, 'owns', 5)).rejects.toThrow()
    })
  })
})

// ============================================================================
// UTILITY FUNCTIONS TESTS
// ============================================================================

describe('Graph Test Helpers - Utility Functions', () => {
  describe('buildDoUrl', () => {
    it('builds a valid DO URL', () => {
      const url = buildDoUrl('acme', 'customers', 'alice')
      expect(url).toBe('do://acme/customers/alice')
    })

    it('handles special characters in ID', () => {
      const url = buildDoUrl('tenant', 'items', 'item-with-dashes')
      expect(url).toBe('do://tenant/items/item-with-dashes')
    })
  })

  describe('parseDoUrl', () => {
    it('parses a valid DO URL', () => {
      const { tenant, collection, id } = parseDoUrl('do://acme/customers/alice')
      expect(tenant).toBe('acme')
      expect(collection).toBe('customers')
      expect(id).toBe('alice')
    })

    it('handles IDs with dashes', () => {
      const { id } = parseDoUrl('do://tenant/items/item-with-dashes-and-more')
      expect(id).toBe('item-with-dashes-and-more')
    })

    it('throws on invalid URL', () => {
      expect(() => parseDoUrl('invalid-url')).toThrow('Invalid DO URL')
      expect(() => parseDoUrl('http://example.com')).toThrow('Invalid DO URL')
    })
  })

  describe('waitFor', () => {
    it('returns true when condition is immediately met', async () => {
      const result = await waitFor(async () => true, { timeout: 1000 })
      expect(result).toBe(true)
    })

    it('returns true when condition is eventually met', async () => {
      let counter = 0
      const result = await waitFor(
        async () => {
          counter++
          return counter >= 3
        },
        { timeout: 1000, interval: 50 }
      )
      expect(result).toBe(true)
      expect(counter).toBeGreaterThanOrEqual(3)
    })

    it('returns false when condition times out', async () => {
      const result = await waitFor(async () => false, { timeout: 100, interval: 20 })
      expect(result).toBe(false)
    })

    it('uses default timeout and interval', async () => {
      // This should work quickly
      const result = await waitFor(async () => true)
      expect(result).toBe(true)
    })
  })

  describe('resetCounters', () => {
    it('resets ID counters', () => {
      generateTestId()
      generateTestId()
      resetCounters()

      // After reset, IDs should start fresh (though timestamp component will differ)
      const id = generateTestId()
      expect(id).toMatch(/-1$/)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Graph Test Helpers - Integration', () => {
  let store: SQLiteGraphStore
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    resetCounters()
    const result = await createTestGraphStore()
    store = result.store
    cleanup = result.cleanup
  })

  afterEach(async () => {
    await cleanup()
  })

  it('full workflow: seed, query, and assert', async () => {
    // Seed a graph
    const { refs, rels } = await seedTestGraph(store, 'ecommerce')

    // Query relationships
    const alicePurchases = await store.queryRelationshipsFrom('do://tenant/customers/customer-alice', {
      verb: 'purchased',
    })

    // Assertions
    expect(alicePurchases).toHaveLength(2)
    await assertThingExists(store, refs.alice.id)
    await assertRelationshipExists(store, {
      from: 'do://tenant/customers/customer-alice',
      verb: 'purchased',
      to: 'do://tenant/products/product-widget',
    })
  })

  it('create, connect, and verify pattern', async () => {
    // Create connected entities
    const { from, to, relationship } = await createConnectedThings(store, {
      fromType: 'HumanUser',
      fromData: { name: 'Nathan' },
      toType: 'HumanOrganization',
      toData: { name: 'Acme Corp' },
      verb: 'memberOf',
      relationshipData: { role: 'admin' },
    })

    // Verify with assertions
    await assertThingExists(store, from.id)
    await assertThingExists(store, to.id)
    await assertThingHasData(store, from.id, { name: 'Nathan' })
    await assertRelationshipExists(store, { verb: 'memberOf' })

    // Verify relationship data
    const rels = await store.queryRelationshipsFrom(relationship.from)
    expect(rels[0].data).toEqual({ role: 'admin' })
  })

  it('batch creation and counting', async () => {
    // Create multiple things
    await createTestThings(store, 10, { typeName: 'Customer' })
    await createTestThings(store, 5, { typeName: 'HumanUser' })

    // Verify counts
    await assertThingCount(store, 'Customer', 10)
    await assertThingCount(store, 'HumanUser', 5)
  })
})
