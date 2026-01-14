/**
 * E2E Test Infrastructure - Unit Tests
 *
 * Tests verifying the E2E test infrastructure utilities work correctly.
 *
 * @see dotdo-61mmm - [REFACTOR] E2E Test Infrastructure
 *
 * Design:
 * - Tests simplified API functions
 * - Tests cross-store matrix functionality
 * - Tests graph topology creation utilities
 * - Tests performance measurement utilities
 * - Tests chaos testing resilience
 * - Uses real SQLite (NO MOCKS) per project testing philosophy
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
  // Simplified API (from issue spec)
  createTestStore,
  seedTestData,
  createThingChain,
  // Cross-store testing
  createStoreMatrix,
  withAllStores,
  // Graph topology utilities
  createBinaryTree,
  createCompleteGraph,
  createStarGraph,
  // Performance utilities
  measurePerformance,
  runPerformanceBaseline,
  // Chaos testing
  runChaosOperations,
  // Data verification
  verifyGraphIntegrity,
  // Re-exported helpers (verify they're accessible)
  createTestGraphStore,
  assertThingExists,
  seedTestGraph,
  buildDoUrl,
} from './test-utils'
import type { GraphStore } from '../types'
import { SQLiteGraphStore } from '../stores/sqlite'

// ============================================================================
// SIMPLIFIED API TESTS
// ============================================================================

describe('E2E Test Infrastructure - Simplified API', () => {
  let store: SQLiteGraphStore

  afterEach(async () => {
    if (store) {
      await store.close()
    }
  })

  describe('createTestStore', () => {
    it('creates an initialized store', async () => {
      store = await createTestStore()

      expect(store).toBeInstanceOf(SQLiteGraphStore)

      // Should be usable
      const thing = await store.createThing({
        id: 'test-thing',
        typeId: 1,
        typeName: 'Noun',
        data: { name: 'Test' },
      })
      expect(thing.id).toBe('test-thing')
    })
  })

  describe('seedTestData', () => {
    it('seeds the specified number of Things', async () => {
      store = await createTestStore()

      await seedTestData(store, { thingCount: 5 })

      const things = await store.getThingsByType({ typeName: 'Noun' })
      expect(things.length).toBe(5)
    })

    it('uses default count when not specified', async () => {
      store = await createTestStore()

      await seedTestData(store)

      const things = await store.getThingsByType({ typeName: 'Noun' })
      expect(things.length).toBe(10) // Default
    })

    it('applies custom type name', async () => {
      store = await createTestStore()

      await seedTestData(store, { thingCount: 3, typeName: 'Customer' })

      const things = await store.getThingsByType({ typeName: 'Customer' })
      expect(things.length).toBe(3)
    })

    it('applies data template', async () => {
      store = await createTestStore()

      await seedTestData(store, {
        thingCount: 2,
        dataTemplate: { tier: 'premium', region: 'us-west' },
      })

      const things = await store.getThingsByType({ typeName: 'Noun' })
      expect(things[0]?.data).toMatchObject({ tier: 'premium', region: 'us-west' })
    })

    it('creates relationships when specified', async () => {
      store = await createTestStore()

      await seedTestData(store, { thingCount: 5, relationshipCount: 3 })

      const rels = await store.queryRelationshipsByVerb('relatedTo')
      expect(rels.length).toBeLessThanOrEqual(3)
    })
  })

  describe('createThingChain', () => {
    it('creates a chain of connected Things', async () => {
      store = await createTestStore()

      const ids = await createThingChain(store, 5)

      expect(ids).toHaveLength(5)
      expect(ids[0]).toBe('chain-0')
      expect(ids[4]).toBe('chain-4')

      // Verify relationships exist
      const rels = await store.queryRelationshipsFrom('do://test/nouns/chain-0')
      expect(rels.some((r) => r.to.includes('chain-1'))).toBe(true)
    })

    it('uses custom verb', async () => {
      store = await createTestStore()

      await createThingChain(store, 3, 'follows')

      const rels = await store.queryRelationshipsByVerb('follows')
      expect(rels.length).toBe(2) // 3 nodes = 2 edges
    })

    it('creates no relationships for single node', async () => {
      store = await createTestStore()

      const ids = await createThingChain(store, 1)

      expect(ids).toHaveLength(1)
      const rels = await store.queryRelationshipsByVerb('links')
      expect(rels.length).toBe(0)
    })
  })
})

// ============================================================================
// CROSS-STORE TESTING
// ============================================================================

describe('E2E Test Infrastructure - Cross-Store Testing', () => {
  describe('createStoreMatrix', () => {
    it('returns both SQLite and Document stores', async () => {
      const stores = await createStoreMatrix()

      expect(stores).toHaveLength(2)
      expect(stores.map((s) => s.type).sort()).toEqual(['document', 'sqlite'])

      // Cleanup
      for (const { cleanup } of stores) {
        await cleanup()
      }
    })

    it('returns initialized stores that are usable', async () => {
      const stores = await createStoreMatrix()

      for (const { name, store, cleanup } of stores) {
        // Each store should be usable
        const thing = await store.createThing({
          id: 'test-thing',
          typeId: 1,
          typeName: 'Noun',
          data: { store: name },
        })
        expect(thing.id).toBe('test-thing')

        await cleanup()
      }
    })
  })

  describe('withAllStores', () => {
    it('executes test function with each store type', async () => {
      const storeNames: string[] = []

      await withAllStores(async (store, name) => {
        storeNames.push(name)

        const thing = await store.createThing({
          id: 'with-all-test',
          typeId: 1,
          typeName: 'Noun',
          data: {},
        })
        expect(thing.id).toBe('with-all-test')
      })

      expect(storeNames).toHaveLength(2)
      expect(storeNames).toContain('SQLiteGraphStore')
      expect(storeNames).toContain('DocumentGraphStore')
    })

    it('cleans up after each test', async () => {
      let firstStore: GraphStore | null = null

      await withAllStores(async (store, name) => {
        if (!firstStore) {
          firstStore = store
        }
      })

      // After withAllStores, stores should be closed
      // Attempting to use them should fail
      await expect(
        firstStore!.createThing({
          id: 'after-cleanup',
          typeId: 1,
          typeName: 'Noun',
          data: {},
        })
      ).rejects.toThrow()
    })
  })
})

// ============================================================================
// GRAPH TOPOLOGY UTILITIES
// ============================================================================

describe('E2E Test Infrastructure - Graph Topology', () => {
  let store: SQLiteGraphStore

  afterEach(async () => {
    if (store) {
      await store.close()
    }
  })

  describe('createBinaryTree', () => {
    it('creates a root-only tree with depth 0', async () => {
      store = await createTestStore()

      const rootId = await createBinaryTree(store, 0)

      expect(rootId).toBe('tree-node-0')
      const things = await store.getThingsByType({ typeName: 'Noun' })
      expect(things.length).toBe(1)
    })

    it('creates a tree with correct node count', async () => {
      store = await createTestStore()

      await createBinaryTree(store, 2)

      // Depth 2: 1 + 2 + 4 = 7 nodes
      const things = await store.getThingsByType({ typeName: 'Noun' })
      expect(things.length).toBe(7)
    })

    it('creates parent relationships', async () => {
      store = await createTestStore()

      await createBinaryTree(store, 1, 'parent')

      // Root has 2 children, each pointing to parent
      const rels = await store.queryRelationshipsByVerb('parent')
      expect(rels.length).toBe(2)
    })
  })

  describe('createCompleteGraph', () => {
    it('creates a single node with size 1', async () => {
      store = await createTestStore()

      const ids = await createCompleteGraph(store, 1)

      expect(ids).toHaveLength(1)
      const rels = await store.queryRelationshipsByVerb('connectedTo')
      expect(rels.length).toBe(0)
    })

    it('creates correct edge count', async () => {
      store = await createTestStore()

      const ids = await createCompleteGraph(store, 4)

      // 4 nodes = 4*3/2 = 6 edges
      expect(ids).toHaveLength(4)
      const rels = await store.queryRelationshipsByVerb('connectedTo')
      expect(rels.length).toBe(6)
    })

    it('uses custom verb', async () => {
      store = await createTestStore()

      await createCompleteGraph(store, 3, 'knows')

      const rels = await store.queryRelationshipsByVerb('knows')
      expect(rels.length).toBe(3) // 3*2/2 = 3
    })
  })

  describe('createStarGraph', () => {
    it('creates hub and spokes', async () => {
      store = await createTestStore()

      const { hubId, spokeIds } = await createStarGraph(store, 5)

      expect(hubId).toBe('star-hub')
      expect(spokeIds).toHaveLength(5)
    })

    it('creates relationships from spokes to hub', async () => {
      store = await createTestStore()

      const { hubId, spokeIds } = await createStarGraph(store, 3, 'belongsTo')

      const rels = await store.queryRelationshipsTo(`do://test/nouns/${hubId}`, {
        verb: 'belongsTo',
      })
      expect(rels.length).toBe(3)
    })
  })
})

// ============================================================================
// PERFORMANCE UTILITIES
// ============================================================================

describe('E2E Test Infrastructure - Performance Utilities', () => {
  let store: SQLiteGraphStore

  afterEach(async () => {
    if (store) {
      await store.close()
    }
  })

  describe('measurePerformance', () => {
    it('measures operation duration', async () => {
      const result = await measurePerformance(
        'sleep',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
        },
        3
      )

      expect(result.operation).toBe('sleep')
      expect(result.durationMs).toBeGreaterThan(25) // At least 30ms for 3 iterations
      expect(result.meta?.iterations).toBe(3)
    })

    it('calculates ops per second', async () => {
      let counter = 0
      const result = await measurePerformance(
        'increment',
        async () => {
          counter++
        },
        100
      )

      expect(result.opsPerSec).toBeGreaterThan(0)
      expect(counter).toBe(100)
    })
  })

  describe('runPerformanceBaseline', () => {
    it('returns results for standard operations', async () => {
      store = await createTestStore()

      const results = await runPerformanceBaseline(store, 10)

      expect(results.length).toBeGreaterThan(0)
      expect(results.map((r) => r.operation)).toContain('createThing')
      expect(results.map((r) => r.operation)).toContain('getThing')
      expect(results.map((r) => r.operation)).toContain('getThingsByType')
      expect(results.map((r) => r.operation)).toContain('createRelationship')
      expect(results.map((r) => r.operation)).toContain('queryRelationshipsFrom')
    })

    it('measures real operations', async () => {
      store = await createTestStore()

      const results = await runPerformanceBaseline(store, 5)

      for (const result of results) {
        expect(result.durationMs).toBeGreaterThan(0)
        expect(result.opsPerSec).toBeGreaterThan(0)
      }
    })
  })
})

// ============================================================================
// CHAOS TESTING
// ============================================================================

describe('E2E Test Infrastructure - Chaos Testing', () => {
  let store: SQLiteGraphStore

  afterEach(async () => {
    if (store) {
      await store.close()
    }
  })

  describe('runChaosOperations', () => {
    it('runs without crashing', async () => {
      store = await createTestStore()

      // Should not throw
      await runChaosOperations(store, 100)
    })

    it('creates some Things', async () => {
      store = await createTestStore()

      await runChaosOperations(store, 50)

      const things = await store.getThingsByType({ includeDeleted: true })
      expect(things.length).toBeGreaterThan(0)
    })

    it('handles high operation count', async () => {
      store = await createTestStore()

      // Stress test
      await runChaosOperations(store, 500)

      // Store should still be usable
      const thing = await store.createThing({
        id: 'after-chaos',
        typeId: 1,
        typeName: 'Noun',
        data: {},
      })
      expect(thing.id).toBe('after-chaos')
    })
  })
})

// ============================================================================
// DATA VERIFICATION
// ============================================================================

describe('E2E Test Infrastructure - Data Verification', () => {
  let store: SQLiteGraphStore

  afterEach(async () => {
    if (store) {
      await store.close()
    }
  })

  describe('verifyGraphIntegrity', () => {
    it('reports valid for empty store', async () => {
      store = await createTestStore()

      const result = await verifyGraphIntegrity(store)

      expect(result.valid).toBe(true)
      expect(result.thingCount).toBe(0)
      expect(result.relationshipCount).toBe(0)
      expect(result.issues).toHaveLength(0)
    })

    it('reports valid for consistent data', async () => {
      store = await createTestStore()

      await createThingChain(store, 5, 'links')

      const result = await verifyGraphIntegrity(store)

      expect(result.valid).toBe(true)
      expect(result.thingCount).toBe(5)
      expect(result.relationshipCount).toBe(4)
    })

    it('counts multiple relationship types', async () => {
      store = await createTestStore()

      await createThingChain(store, 3, 'links')
      await createStarGraph(store, 2, 'belongsTo')

      const result = await verifyGraphIntegrity(store)

      expect(result.thingCount).toBe(6) // 3 chain + 3 star (hub + 2 spokes)
      expect(result.relationshipCount).toBe(4) // 2 links + 2 belongsTo
    })
  })
})

// ============================================================================
// RE-EXPORTS VERIFICATION
// ============================================================================

describe('E2E Test Infrastructure - Re-exports', () => {
  it('re-exports factory functions', async () => {
    // Verify the comprehensive helpers are accessible through test-utils
    expect(createTestGraphStore).toBeDefined()
    expect(typeof createTestGraphStore).toBe('function')
  })

  it('re-exports assertion helpers', async () => {
    expect(assertThingExists).toBeDefined()
    expect(typeof assertThingExists).toBe('function')
  })

  it('re-exports seed functions', async () => {
    expect(seedTestGraph).toBeDefined()
    expect(typeof seedTestGraph).toBe('function')
  })

  it('re-exports utility functions', async () => {
    expect(buildDoUrl).toBeDefined()
    expect(buildDoUrl('tenant', 'things', 'id')).toBe('do://tenant/things/id')
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('E2E Test Infrastructure - Integration', () => {
  it('full workflow: create store, seed, measure, verify', async () => {
    // Create store
    const store = await createTestStore()

    try {
      // Seed data
      await seedTestData(store, { thingCount: 20, relationshipCount: 10 })

      // Create some topology
      await createThingChain(store, 5, 'links')

      // Run performance baseline
      const perfResults = await runPerformanceBaseline(store, 5)
      expect(perfResults.length).toBeGreaterThan(0)

      // Verify integrity
      const integrity = await verifyGraphIntegrity(store)
      expect(integrity.valid).toBe(true)
      // 20 seeded + 5 chain + 5 from performance baseline createThing = 30
      expect(integrity.thingCount).toBeGreaterThanOrEqual(25)
    } finally {
      await store.close()
    }
  })

  it('cross-store consistency test', async () => {
    // Verify both stores produce consistent results
    await withAllStores(async (store, name) => {
      // Seed same data
      await seedTestData(store, { thingCount: 10 })

      // Create same topology
      await createThingChain(store, 3, 'links')

      // Verify
      const things = await store.getThingsByType({ typeName: 'Noun' })
      expect(things.length).toBe(13) // 10 seeded + 3 chain

      const rels = await store.queryRelationshipsByVerb('links')
      expect(rels.length).toBe(2) // 3 nodes = 2 edges
    })
  })
})
