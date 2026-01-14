/**
 * E2E Test Infrastructure Utilities
 *
 * Shared test infrastructure for graph module E2E tests. Provides simplified
 * API for common testing patterns plus cross-store testing capabilities.
 *
 * @see dotdo-61mmm - [REFACTOR] E2E Test Infrastructure
 *
 * Design:
 * - Simple API for common test setup patterns
 * - Cross-store testing (SQLite + Document store)
 * - Chain/graph creation utilities for traversal tests
 * - Performance measurement utilities
 * - Uses real SQLite (NO MOCKS) per project testing philosophy
 *
 * @example
 * ```typescript
 * import {
 *   createTestStore,
 *   seedTestData,
 *   createThingChain,
 *   createStoreMatrix,
 * } from './test-utils'
 *
 * // Simple store creation
 * const store = await createTestStore()
 *
 * // Seed with test data
 * await seedTestData(store, { thingCount: 100 })
 *
 * // Create relationship chains for traversal tests
 * const ids = await createThingChain(store, 10, 'links')
 *
 * // Cross-store testing
 * const stores = await createStoreMatrix()
 * for (const { name, store } of stores) {
 *   // Test against both SQLite and Document stores
 * }
 * ```
 *
 * @module db/graph/tests/test-utils
 */

import type { GraphStore, GraphThing, GraphRelationship } from '../types'
import { SQLiteGraphStore } from '../stores/sqlite'
import { DocumentGraphStore } from '../stores/document'
import { NOUN_REGISTRY } from '../nouns'

// ============================================================================
// RE-EXPORTS from comprehensive graph-test-helpers
// ============================================================================

export {
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
  // Types
  type CreateTestThingOptions,
  type CreateTestRelationshipOptions,
  type TestGraphScenario,
  type SeededGraph,
  type AssertRelationshipExistsOptions,
} from './utils/graph-test-helpers'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for seeding test data.
 */
export interface SeedTestDataOptions {
  /** Number of Things to create (default: 10) */
  thingCount?: number
  /** Number of Relationships to create (default: 0) */
  relationshipCount?: number
  /** Type name for Things (default: 'Noun') */
  typeName?: string
  /** Base data template for Things */
  dataTemplate?: Record<string, unknown>
}

/**
 * Store matrix entry for cross-store testing.
 */
export interface StoreMatrixEntry {
  /** Display name of the store type */
  name: string
  /** Store type identifier */
  type: 'sqlite' | 'document'
  /** The store instance */
  store: GraphStore
  /** Cleanup function to call when done */
  cleanup: () => Promise<void>
}

/**
 * Performance measurement result.
 */
export interface PerformanceResult {
  /** Operation name */
  operation: string
  /** Duration in milliseconds */
  durationMs: number
  /** Operations per second */
  opsPerSec: number
  /** Additional metadata */
  meta?: Record<string, unknown>
}

// ============================================================================
// SIMPLIFIED API (matches issue specification)
// ============================================================================

/**
 * Create a test store with common setup.
 *
 * This is a simplified wrapper around createTestGraphStore that returns
 * just the store (not cleanup function). Use createTestGraphStore for
 * tests that need proper cleanup.
 *
 * @returns Initialized SQLiteGraphStore instance
 *
 * @example
 * ```typescript
 * const store = await createTestStore()
 * const thing = await store.createThing({ ... })
 * ```
 */
export async function createTestStore(): Promise<SQLiteGraphStore> {
  const store = new SQLiteGraphStore(':memory:')
  await store.initialize()
  return store
}

/**
 * Seed store with test data.
 *
 * Creates the specified number of Things with auto-generated data.
 * Useful for performance tests and tests requiring bulk data.
 *
 * @param store - GraphStore to seed
 * @param options - Seeding options
 *
 * @example
 * ```typescript
 * const store = await createTestStore()
 *
 * // Seed with 100 things
 * await seedTestData(store, { thingCount: 100 })
 *
 * // Seed with custom type
 * await seedTestData(store, {
 *   thingCount: 50,
 *   typeName: 'Customer',
 *   dataTemplate: { tier: 'premium' }
 * })
 * ```
 */
export async function seedTestData(
  store: GraphStore,
  options: SeedTestDataOptions = {}
): Promise<void> {
  const thingCount = options.thingCount ?? 10
  const typeName = options.typeName ?? 'Noun'
  const typeId = NOUN_REGISTRY[typeName]?.rowid ?? 1

  for (let i = 0; i < thingCount; i++) {
    await store.createThing({
      id: `seed-thing-${i}`,
      typeId,
      typeName,
      data: {
        index: i,
        name: `Thing ${i}`,
        ...options.dataTemplate,
      },
    })
  }

  // Create random relationships if requested
  const relationshipCount = options.relationshipCount ?? 0
  for (let i = 0; i < relationshipCount; i++) {
    const fromIndex = Math.floor(Math.random() * thingCount)
    let toIndex = Math.floor(Math.random() * thingCount)
    // Ensure different from/to
    if (toIndex === fromIndex) {
      toIndex = (toIndex + 1) % thingCount
    }

    try {
      await store.createRelationship({
        id: `seed-rel-${i}`,
        verb: 'relatedTo',
        from: `do://test/${typeName.toLowerCase()}s/seed-thing-${fromIndex}`,
        to: `do://test/${typeName.toLowerCase()}s/seed-thing-${toIndex}`,
      })
    } catch {
      // Ignore duplicate constraint violations
    }
  }
}

/**
 * Create a chain of related Things.
 *
 * Creates Things connected in a linear chain, useful for testing
 * graph traversal algorithms and path finding.
 *
 * @param store - GraphStore to use
 * @param length - Number of Things in the chain
 * @param verb - Relationship verb (default: 'links')
 * @returns Array of Thing IDs in chain order
 *
 * @example
 * ```typescript
 * const store = await createTestStore()
 *
 * // Create a chain: A -> B -> C -> D -> E
 * const ids = await createThingChain(store, 5, 'links')
 *
 * // ids = ['chain-0', 'chain-1', 'chain-2', 'chain-3', 'chain-4']
 * // With relationships: chain-0 links chain-1, chain-1 links chain-2, etc.
 * ```
 */
export async function createThingChain(
  store: GraphStore,
  length: number,
  verb = 'links'
): Promise<string[]> {
  const ids: string[] = []
  const typeId = NOUN_REGISTRY['Noun']?.rowid ?? 1

  for (let i = 0; i < length; i++) {
    const thing = await store.createThing({
      id: `chain-${i}`,
      typeId,
      typeName: 'Noun',
      data: { index: i },
    })
    ids.push(thing.id)

    if (i > 0) {
      await store.createRelationship({
        id: `chain-rel-${i}`,
        verb,
        from: `do://test/nouns/${ids[i - 1]}`,
        to: `do://test/nouns/${ids[i]}`,
      })
    }
  }

  return ids
}

// ============================================================================
// CROSS-STORE TESTING
// ============================================================================

/**
 * Create a matrix of store implementations for cross-store testing.
 *
 * Returns both SQLite and Document store instances initialized and ready
 * for testing. Useful for verifying behavior consistency across backends.
 *
 * @returns Array of store entries with cleanup functions
 *
 * @example
 * ```typescript
 * const stores = await createStoreMatrix()
 *
 * describe.each(stores)('$name', ({ store, cleanup }) => {
 *   afterAll(async () => await cleanup())
 *
 *   it('creates things consistently', async () => {
 *     const thing = await store.createThing({ ... })
 *     expect(thing.id).toBeDefined()
 *   })
 * })
 * ```
 */
export async function createStoreMatrix(): Promise<StoreMatrixEntry[]> {
  const sqliteStore = new SQLiteGraphStore(':memory:')
  await sqliteStore.initialize()

  const documentStore = new DocumentGraphStore(':memory:')
  await documentStore.initialize()

  return [
    {
      name: 'SQLiteGraphStore',
      type: 'sqlite',
      store: sqliteStore,
      cleanup: async () => {
        await sqliteStore.close()
      },
    },
    {
      name: 'DocumentGraphStore',
      type: 'document',
      store: documentStore,
      cleanup: async () => {
        await documentStore.close()
      },
    },
  ]
}

/**
 * Run a test function against all store implementations.
 *
 * Convenience wrapper that executes a test function with each store
 * type and handles cleanup automatically.
 *
 * @param testFn - Test function to run with each store
 *
 * @example
 * ```typescript
 * await withAllStores(async (store, storeName) => {
 *   const thing = await store.createThing({
 *     id: 'test-thing',
 *     typeId: 1,
 *     typeName: 'Noun',
 *     data: { test: true }
 *   })
 *   expect(thing.id).toBe('test-thing')
 * })
 * ```
 */
export async function withAllStores(
  testFn: (store: GraphStore, storeName: string) => Promise<void>
): Promise<void> {
  const stores = await createStoreMatrix()

  for (const { name, store, cleanup } of stores) {
    try {
      await testFn(store, name)
    } finally {
      await cleanup()
    }
  }
}

// ============================================================================
// GRAPH TOPOLOGY UTILITIES
// ============================================================================

/**
 * Create a binary tree of Things.
 *
 * Creates Things connected in a binary tree structure, useful for testing
 * hierarchical traversal and ancestor/descendant queries.
 *
 * @param store - GraphStore to use
 * @param depth - Depth of the tree (0 = root only)
 * @param verb - Relationship verb (default: 'parent')
 * @returns Root Thing ID
 *
 * @example
 * ```typescript
 * const store = await createTestStore()
 *
 * // Create a tree with depth 3 (1 + 2 + 4 + 8 = 15 nodes)
 * const rootId = await createBinaryTree(store, 3, 'parent')
 * ```
 */
export async function createBinaryTree(
  store: GraphStore,
  depth: number,
  verb = 'parent'
): Promise<string> {
  const typeId = NOUN_REGISTRY['Noun']?.rowid ?? 1
  let nodeCounter = 0

  async function createNode(currentDepth: number, parentId?: string): Promise<string> {
    const nodeId = `tree-node-${nodeCounter++}`

    await store.createThing({
      id: nodeId,
      typeId,
      typeName: 'Noun',
      data: { depth: currentDepth, nodeIndex: nodeCounter },
    })

    if (parentId) {
      await store.createRelationship({
        id: `tree-rel-${nodeId}`,
        verb,
        from: `do://test/nouns/${nodeId}`,
        to: `do://test/nouns/${parentId}`,
      })
    }

    if (currentDepth < depth) {
      // Create left and right children
      await createNode(currentDepth + 1, nodeId)
      await createNode(currentDepth + 1, nodeId)
    }

    return nodeId
  }

  return createNode(0)
}

/**
 * Create a fully connected graph (complete graph).
 *
 * Creates n Things where every pair is connected by a relationship.
 * Useful for stress testing and dense graph scenarios.
 *
 * @param store - GraphStore to use
 * @param size - Number of Things (edges = n*(n-1)/2)
 * @param verb - Relationship verb (default: 'connectedTo')
 * @returns Array of Thing IDs
 *
 * @example
 * ```typescript
 * const store = await createTestStore()
 *
 * // Create complete graph with 5 nodes (10 edges)
 * const ids = await createCompleteGraph(store, 5)
 * ```
 */
export async function createCompleteGraph(
  store: GraphStore,
  size: number,
  verb = 'connectedTo'
): Promise<string[]> {
  const ids: string[] = []
  const typeId = NOUN_REGISTRY['Noun']?.rowid ?? 1

  // Create all nodes
  for (let i = 0; i < size; i++) {
    const thing = await store.createThing({
      id: `complete-${i}`,
      typeId,
      typeName: 'Noun',
      data: { index: i },
    })
    ids.push(thing.id)
  }

  // Connect every pair
  let relCounter = 0
  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      await store.createRelationship({
        id: `complete-rel-${relCounter++}`,
        verb,
        from: `do://test/nouns/${ids[i]}`,
        to: `do://test/nouns/${ids[j]}`,
      })
    }
  }

  return ids
}

/**
 * Create a star graph (hub and spokes).
 *
 * Creates a central hub Thing with n spoke Things connected to it.
 * Useful for testing fan-out queries and centrality.
 *
 * @param store - GraphStore to use
 * @param spokeCount - Number of spoke Things
 * @param verb - Relationship verb (default: 'belongsTo')
 * @returns Object with hubId and spokeIds
 *
 * @example
 * ```typescript
 * const store = await createTestStore()
 *
 * // Create star with 10 spokes
 * const { hubId, spokeIds } = await createStarGraph(store, 10)
 * ```
 */
export async function createStarGraph(
  store: GraphStore,
  spokeCount: number,
  verb = 'belongsTo'
): Promise<{ hubId: string; spokeIds: string[] }> {
  const typeId = NOUN_REGISTRY['Noun']?.rowid ?? 1

  // Create hub
  const hub = await store.createThing({
    id: 'star-hub',
    typeId,
    typeName: 'Noun',
    data: { role: 'hub' },
  })

  // Create spokes
  const spokeIds: string[] = []
  for (let i = 0; i < spokeCount; i++) {
    const spoke = await store.createThing({
      id: `star-spoke-${i}`,
      typeId,
      typeName: 'Noun',
      data: { role: 'spoke', index: i },
    })
    spokeIds.push(spoke.id)

    await store.createRelationship({
      id: `star-rel-${i}`,
      verb,
      from: `do://test/nouns/${spoke.id}`,
      to: `do://test/nouns/${hub.id}`,
    })
  }

  return { hubId: hub.id, spokeIds }
}

// ============================================================================
// PERFORMANCE TESTING UTILITIES
// ============================================================================

/**
 * Measure performance of an async operation.
 *
 * @param name - Operation name for the result
 * @param operation - Async function to measure
 * @param iterations - Number of times to run (default: 1)
 * @returns Performance measurement result
 *
 * @example
 * ```typescript
 * const result = await measurePerformance('createThing', async () => {
 *   await store.createThing({ ... })
 * }, 100)
 *
 * console.log(`${result.opsPerSec} ops/sec`)
 * ```
 */
export async function measurePerformance(
  name: string,
  operation: () => Promise<void>,
  iterations = 1
): Promise<PerformanceResult> {
  const start = performance.now()

  for (let i = 0; i < iterations; i++) {
    await operation()
  }

  const durationMs = performance.now() - start
  const opsPerSec = iterations / (durationMs / 1000)

  return {
    operation: name,
    durationMs,
    opsPerSec,
    meta: { iterations },
  }
}

/**
 * Run a performance baseline suite.
 *
 * Measures common operations and returns results for comparison.
 *
 * @param store - GraphStore to test
 * @param iterations - Iterations per operation (default: 100)
 * @returns Array of performance results
 *
 * @example
 * ```typescript
 * const store = await createTestStore()
 * const results = await runPerformanceBaseline(store)
 *
 * for (const r of results) {
 *   console.log(`${r.operation}: ${r.opsPerSec.toFixed(0)} ops/sec`)
 * }
 * ```
 */
export async function runPerformanceBaseline(
  store: GraphStore,
  iterations = 100
): Promise<PerformanceResult[]> {
  const results: PerformanceResult[] = []
  const typeId = NOUN_REGISTRY['Noun']?.rowid ?? 1

  // Create Things
  let createCounter = 0
  results.push(
    await measurePerformance(
      'createThing',
      async () => {
        await store.createThing({
          id: `perf-create-${createCounter++}`,
          typeId,
          typeName: 'Noun',
          data: { test: true },
        })
      },
      iterations
    )
  )

  // Read Things
  results.push(
    await measurePerformance(
      'getThing',
      async () => {
        const id = `perf-create-${Math.floor(Math.random() * createCounter)}`
        await store.getThing(id)
      },
      iterations
    )
  )

  // Query by type
  results.push(
    await measurePerformance(
      'getThingsByType',
      async () => {
        await store.getThingsByType({ typeName: 'Noun', limit: 10 })
      },
      iterations
    )
  )

  // Create relationships
  let relCounter = 0
  results.push(
    await measurePerformance(
      'createRelationship',
      async () => {
        const fromId = `perf-create-${Math.floor(Math.random() * createCounter)}`
        const toId = `perf-create-${Math.floor(Math.random() * createCounter)}`
        try {
          await store.createRelationship({
            id: `perf-rel-${relCounter++}`,
            verb: 'relatedTo',
            from: `do://test/nouns/${fromId}`,
            to: `do://test/nouns/${toId}`,
          })
        } catch {
          // Ignore duplicate constraints
        }
      },
      iterations
    )
  )

  // Query relationships
  results.push(
    await measurePerformance(
      'queryRelationshipsFrom',
      async () => {
        const id = `perf-create-${Math.floor(Math.random() * createCounter)}`
        await store.queryRelationshipsFrom(`do://test/nouns/${id}`)
      },
      iterations
    )
  )

  return results
}

// ============================================================================
// CHAOS TESTING UTILITIES
// ============================================================================

/**
 * Random operation generator for chaos testing.
 *
 * Generates random graph operations to stress test the store.
 *
 * @param store - GraphStore to test
 * @param operationCount - Number of random operations
 *
 * @example
 * ```typescript
 * const store = await createTestStore()
 *
 * // Run 1000 random operations
 * await runChaosOperations(store, 1000)
 * ```
 */
export async function runChaosOperations(
  store: GraphStore,
  operationCount: number
): Promise<void> {
  const typeId = NOUN_REGISTRY['Noun']?.rowid ?? 1
  const existingIds: string[] = []

  for (let i = 0; i < operationCount; i++) {
    const op = Math.random()

    try {
      if (op < 0.3 || existingIds.length === 0) {
        // Create thing (30% or if no things exist)
        const id = `chaos-${i}`
        await store.createThing({
          id,
          typeId,
          typeName: 'Noun',
          data: { chaosIndex: i },
        })
        existingIds.push(id)
      } else if (op < 0.5) {
        // Read thing (20%)
        const id = existingIds[Math.floor(Math.random() * existingIds.length)]
        await store.getThing(id!)
      } else if (op < 0.7) {
        // Update thing (20%)
        const id = existingIds[Math.floor(Math.random() * existingIds.length)]
        await store.updateThing(id!, { data: { updated: true, at: Date.now() } })
      } else if (op < 0.85 && existingIds.length >= 2) {
        // Create relationship (15%)
        const fromIdx = Math.floor(Math.random() * existingIds.length)
        let toIdx = Math.floor(Math.random() * existingIds.length)
        if (toIdx === fromIdx) toIdx = (toIdx + 1) % existingIds.length

        await store.createRelationship({
          id: `chaos-rel-${i}`,
          verb: 'chaosLink',
          from: `do://test/nouns/${existingIds[fromIdx]}`,
          to: `do://test/nouns/${existingIds[toIdx]}`,
        })
      } else if (op < 0.95) {
        // Query (10%)
        const id = existingIds[Math.floor(Math.random() * existingIds.length)]
        await store.queryRelationshipsFrom(`do://test/nouns/${id}`)
      } else {
        // Delete thing (5%)
        const idx = Math.floor(Math.random() * existingIds.length)
        const id = existingIds[idx]
        await store.deleteThing(id!)
        existingIds.splice(idx, 1)
      }
    } catch {
      // Ignore errors in chaos testing - we're testing resilience
    }
  }
}

// ============================================================================
// DATA VERIFICATION UTILITIES
// ============================================================================

/**
 * Verify graph integrity.
 *
 * Checks that all relationships reference existing Things and
 * reports any orphaned references.
 *
 * @param store - GraphStore to verify
 * @returns Verification result with any issues found
 *
 * @example
 * ```typescript
 * const store = await createTestStore()
 * await seedTestData(store, { thingCount: 100, relationshipCount: 50 })
 *
 * const result = await verifyGraphIntegrity(store)
 * expect(result.valid).toBe(true)
 * ```
 */
export async function verifyGraphIntegrity(
  store: GraphStore
): Promise<{
  valid: boolean
  thingCount: number
  relationshipCount: number
  orphanedRelationships: string[]
  issues: string[]
}> {
  const issues: string[] = []
  const orphanedRelationships: string[] = []

  // Get all things
  const things = await store.getThingsByType({ includeDeleted: false })
  const thingIds = new Set(things.map((t) => t.id))

  // Get all relationships (via verb query - common verbs)
  const allRelationships: GraphRelationship[] = []
  const verbs = ['links', 'relatedTo', 'parent', 'belongsTo', 'connectedTo', 'chaosLink']

  for (const verb of verbs) {
    const rels = await store.queryRelationshipsByVerb(verb)
    allRelationships.push(...rels)
  }

  // Check each relationship
  for (const rel of allRelationships) {
    // Extract IDs from URLs
    const fromMatch = rel.from.match(/\/([^/]+)$/)
    const toMatch = rel.to.match(/\/([^/]+)$/)

    if (fromMatch && !thingIds.has(fromMatch[1]!)) {
      orphanedRelationships.push(rel.id)
      issues.push(`Relationship ${rel.id} references non-existent 'from' Thing: ${rel.from}`)
    }

    if (toMatch && !thingIds.has(toMatch[1]!)) {
      orphanedRelationships.push(rel.id)
      issues.push(`Relationship ${rel.id} references non-existent 'to' Thing: ${rel.to}`)
    }
  }

  return {
    valid: issues.length === 0,
    thingCount: things.length,
    relationshipCount: allRelationships.length,
    orphanedRelationships: [...new Set(orphanedRelationships)],
    issues,
  }
}
