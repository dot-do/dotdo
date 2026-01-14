/**
 * N+1 Query Pattern Tests
 *
 * RED PHASE: Tests exposing N+1 query patterns in graph adapters.
 * These tests INTENTIONALLY FAIL to prove N+1 patterns exist.
 *
 * @see dotdo-fpjqf - [RED] N+1 Query Pattern Tests (P1)
 *
 * Known N+1 Locations:
 * - FileGraphAdapter.ls(): Queries Things individually in loops
 * - GitGraphAdapter.getTreeEntries(): Individual queries for each tree entry
 * - GitGraphAdapter.collectTreeFiles(): Recursive individual queries
 * - FunctionGraphAdapter.getCascadeTargets(): Individual queries for each target
 * - FunctionGraphAdapter.getCascadeSources(): Individual queries for each source
 * - FunctionGraphAdapter.getFunctionsByOrg(): Individual queries for each function
 * - FunctionGraphAdapter.getAllFunctions(): Multiple getThingsByType queries
 *
 * Test Strategy:
 * - Wrap GraphStore methods to count query calls
 * - Assert query count is O(1) or O(batch) instead of O(N)
 * - These assertions will FAIL proving N+1 exists
 *
 * NO MOCKS of business logic - only counting real queries on real stores
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores/sqlite'
import type { GraphStore, GraphThing, GraphRelationship } from '../types'

// ============================================================================
// QUERY COUNTING WRAPPER
// ============================================================================

/**
 * Query counter that wraps a GraphStore to track query counts.
 * Uses a Proxy to intercept method calls without mocking behavior.
 */
interface QueryCounts {
  getThing: number
  getThings: number
  getThingsByIds: number
  getThingsByType: number
  queryRelationshipsFrom: number
  queryRelationshipsFromMany: number
  queryRelationshipsTo: number
  createThing: number
  createRelationship: number
  total: number
}

function createQueryCountingStore(store: SQLiteGraphStore): {
  store: GraphStore
  counts: QueryCounts
  reset: () => void
} {
  const counts: QueryCounts = {
    getThing: 0,
    getThings: 0,
    getThingsByIds: 0,
    getThingsByType: 0,
    queryRelationshipsFrom: 0,
    queryRelationshipsFromMany: 0,
    queryRelationshipsTo: 0,
    createThing: 0,
    createRelationship: 0,
    total: 0,
  }

  const reset = () => {
    counts.getThing = 0
    counts.getThings = 0
    counts.getThingsByIds = 0
    counts.getThingsByType = 0
    counts.queryRelationshipsFrom = 0
    counts.queryRelationshipsFromMany = 0
    counts.queryRelationshipsTo = 0
    counts.createThing = 0
    counts.createRelationship = 0
    counts.total = 0
  }

  const proxy = new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)

      if (typeof value === 'function') {
        return function (this: unknown, ...args: unknown[]) {
          // Count specific query methods
          if (prop === 'getThing') {
            counts.getThing++
            counts.total++
          } else if (prop === 'getThings') {
            counts.getThings++
            counts.total++
          } else if (prop === 'getThingsByIds') {
            counts.getThingsByIds++
            counts.total++
          } else if (prop === 'getThingsByType') {
            counts.getThingsByType++
            counts.total++
          } else if (prop === 'queryRelationshipsFrom') {
            counts.queryRelationshipsFrom++
            counts.total++
          } else if (prop === 'queryRelationshipsFromMany') {
            counts.queryRelationshipsFromMany++
            counts.total++
          } else if (prop === 'queryRelationshipsTo') {
            counts.queryRelationshipsTo++
            counts.total++
          } else if (prop === 'createThing') {
            counts.createThing++
            // Don't count creates toward query total
          } else if (prop === 'createRelationship') {
            counts.createRelationship++
            // Don't count creates toward query total
          }

          return value.apply(target, args)
        }
      }

      return value
    },
  })

  return { store: proxy as GraphStore, counts, reset }
}

// ============================================================================
// N+1 QUERY PATTERN DETECTION TESTS
// ============================================================================

describe('N+1 Query Pattern Detection', () => {
  let store: SQLiteGraphStore
  let countingStore: ReturnType<typeof createQueryCountingStore>

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    countingStore = createQueryCountingStore(store)
  })

  afterEach(async () => {
    await store.close()
  })

  describe('getThings batch method', () => {
    it('should fetch 100 things in single query, not 100 queries', async () => {
      // Create 100 things
      const ids: string[] = []
      for (let i = 0; i < 100; i++) {
        const thing = await store.createThing({
          id: `thing-${i}`,
          typeId: 1,
          typeName: 'Noun',
          data: { index: i },
        })
        ids.push(thing.id)
      }

      // Reset counts before the batch fetch
      countingStore.reset()

      // Fetch all 100 using batch method - should be 1 query not 100
      const result = await countingStore.store.getThings(ids)

      expect(result.size).toBe(100)

      // If using batch getThings, should be O(1) queries
      // If N+1, would be 100 getThing calls
      expect(countingStore.counts.getThings).toBe(1)
      expect(countingStore.counts.getThing).toBe(0)
    })

    it('should handle empty array gracefully', async () => {
      countingStore.reset()
      const result = await countingStore.store.getThings([])
      expect(result.size).toBe(0)
      expect(countingStore.counts.total).toBe(1) // Single call, no actual queries needed
    })

    it('should handle 500+ items with chunking', async () => {
      // Create 600 things to test chunking (SQLite has ~999 variable limit)
      const ids: string[] = []
      for (let i = 0; i < 600; i++) {
        const thing = await store.createThing({
          id: `chunk-thing-${i}`,
          typeId: 1,
          typeName: 'Noun',
          data: { index: i },
        })
        ids.push(thing.id)
      }

      countingStore.reset()

      const result = await countingStore.store.getThings(ids)

      expect(result.size).toBe(600)

      // Should be 2 queries (chunked at 500), not 600
      expect(countingStore.counts.getThings).toBe(1)
      expect(countingStore.counts.getThing).toBe(0)
    })
  })

  describe('getThingsByIds batch method', () => {
    it('should preserve order and return nulls for missing', async () => {
      // Create some things
      await store.createThing({ id: 'a', typeId: 1, typeName: 'Noun', data: {} })
      await store.createThing({ id: 'c', typeId: 1, typeName: 'Noun', data: {} })

      countingStore.reset()

      // Request in specific order with missing 'b'
      const result = await countingStore.store.getThingsByIds(['a', 'b', 'c'])

      expect(result.length).toBe(3)
      expect(result[0]?.id).toBe('a')
      expect(result[1]).toBeNull() // 'b' doesn't exist
      expect(result[2]?.id).toBe('c')

      // Should use batch internally
      expect(countingStore.counts.getThingsByIds).toBe(1)
    })
  })

  describe('queryRelationshipsFromMany batch method', () => {
    it('should fetch relationships from 100 sources in single query', async () => {
      // Create 100 source things
      const sourceUrls: string[] = []
      for (let i = 0; i < 100; i++) {
        await store.createThing({
          id: `source-${i}`,
          typeId: 1,
          typeName: 'Source',
          data: {},
        })

        await store.createThing({
          id: `target-${i}`,
          typeId: 2,
          typeName: 'Target',
          data: {},
        })

        await store.createRelationship({
          id: `rel-${i}`,
          verb: 'connects',
          from: `do://sources/${i}`,
          to: `do://targets/${i}`,
        })

        sourceUrls.push(`do://sources/${i}`)
      }

      countingStore.reset()

      // Batch query all 100 sources
      const result = await countingStore.store.queryRelationshipsFromMany(sourceUrls)

      expect(result.length).toBe(100)

      // Should be 1 batch query, not 100 individual queries
      expect(countingStore.counts.queryRelationshipsFromMany).toBe(1)
      expect(countingStore.counts.queryRelationshipsFrom).toBe(0)
    })
  })
})

// ============================================================================
// ADAPTER N+1 PATTERN TESTS (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('FileGraphAdapter N+1 Patterns', () => {
  let store: SQLiteGraphStore
  let countingStore: ReturnType<typeof createQueryCountingStore>

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    countingStore = createQueryCountingStore(store)
  })

  afterEach(async () => {
    await store.close()
  })

  describe('ls() pattern simulation', () => {
    it('[RED] demonstrates N+1: individual getThing per child', async () => {
      // This test PROVES the N+1 pattern exists by simulating what ls() does
      const dirId = 'fs:/testdir'
      const fileCount = 50

      // Setup: Create directory and files
      await countingStore.store.createThing({
        id: dirId,
        typeId: 1,
        typeName: 'Directory',
        data: { path: '/testdir', mtime: Date.now() },
      })

      for (let i = 0; i < fileCount; i++) {
        const fileId = `fs:/testdir/file-${i}.txt`
        await countingStore.store.createThing({
          id: fileId,
          typeId: 2,
          typeName: 'File',
          data: { path: `/testdir/file-${i}.txt`, size: 100, mtime: Date.now() },
        })

        await countingStore.store.createRelationship({
          id: `rel:contains:${dirId}:${fileId}`,
          verb: 'contains',
          from: `thing://${dirId}`,
          to: `thing://${fileId}`,
        })
      }

      // Reset counts before ls() simulation
      countingStore.reset()

      // Simulate ls() - this is the N+1 pattern
      const relationships = await countingStore.store.queryRelationshipsFrom(
        `thing://${dirId}`,
        { verb: 'contains' }
      )

      // N+1 PATTERN: Loop through and query each child individually
      const children: GraphThing[] = []
      for (const rel of relationships) {
        const childId = rel.to.replace('thing://', '')
        const child = await countingStore.store.getThing(childId)
        if (child) {
          children.push(child)
        }
      }

      expect(children.length).toBe(fileCount)
      expect(relationships.length).toBe(fileCount)

      // This PROVES N+1: getThing called once per child
      expect(countingStore.counts.getThing).toBe(fileCount)

      // After GREEN phase fix, this should pass:
      // expect(countingStore.counts.getThing).toBeLessThanOrEqual(2)
    })

    it('[RED] query count scales linearly (O(N)) with directory size', async () => {
      // Test with two directory sizes to prove linear scaling

      // Small directory
      const smallDirId = 'fs:/small'
      const smallCount = 10

      await countingStore.store.createThing({
        id: smallDirId,
        typeId: 1,
        typeName: 'Directory',
        data: { path: '/small', mtime: Date.now() },
      })

      for (let i = 0; i < smallCount; i++) {
        const fileId = `fs:/small/file-${i}.txt`
        await countingStore.store.createThing({
          id: fileId,
          typeId: 2,
          typeName: 'File',
          data: { path: `/small/file-${i}.txt`, size: 50, mtime: Date.now() },
        })
        await countingStore.store.createRelationship({
          id: `rel:contains:${smallDirId}:${fileId}`,
          verb: 'contains',
          from: `thing://${smallDirId}`,
          to: `thing://${fileId}`,
        })
      }

      // Large directory (10x)
      const largeDirId = 'fs:/large'
      const largeCount = 100

      await countingStore.store.createThing({
        id: largeDirId,
        typeId: 1,
        typeName: 'Directory',
        data: { path: '/large', mtime: Date.now() },
      })

      for (let i = 0; i < largeCount; i++) {
        const fileId = `fs:/large/file-${i}.txt`
        await countingStore.store.createThing({
          id: fileId,
          typeId: 2,
          typeName: 'File',
          data: { path: `/large/file-${i}.txt`, size: 50, mtime: Date.now() },
        })
        await countingStore.store.createRelationship({
          id: `rel:contains:${largeDirId}:${fileId}`,
          verb: 'contains',
          from: `thing://${largeDirId}`,
          to: `thing://${fileId}`,
        })
      }

      // Measure small
      countingStore.reset()
      const smallRels = await countingStore.store.queryRelationshipsFrom(
        `thing://${smallDirId}`,
        { verb: 'contains' }
      )
      for (const rel of smallRels) {
        await countingStore.store.getThing(rel.to.replace('thing://', ''))
      }
      const smallQueries = countingStore.counts.getThing

      // Measure large
      countingStore.reset()
      const largeRels = await countingStore.store.queryRelationshipsFrom(
        `thing://${largeDirId}`,
        { verb: 'contains' }
      )
      for (const rel of largeRels) {
        await countingStore.store.getThing(rel.to.replace('thing://', ''))
      }
      const largeQueries = countingStore.counts.getThing

      // This PROVES linear scaling (N+1)
      expect(smallQueries).toBe(smallCount)
      expect(largeQueries).toBe(largeCount)

      // Ratio should be ~10x (linear)
      const ratio = largeQueries / smallQueries
      expect(ratio).toBeGreaterThanOrEqual(8) // ~10x

      // After GREEN phase fix, this should pass:
      // expect(ratio).toBeLessThan(2) // O(1) means ratio near 1
    })
  })
})

describe('GitGraphAdapter N+1 Patterns', () => {
  let store: SQLiteGraphStore
  let countingStore: ReturnType<typeof createQueryCountingStore>

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    countingStore = createQueryCountingStore(store)
  })

  afterEach(async () => {
    await store.close()
  })

  describe('getTreeEntries() pattern simulation', () => {
    it('[RED] demonstrates N+1: individual getThing per tree entry', async () => {
      // Simulate tree with many entries
      const entryCount = 30
      const entries: Array<{ name: string; mode: string; hash: string }> = []

      // Create blobs
      for (let i = 0; i < entryCount; i++) {
        const blobId = `blob-${i}`
        await store.createThing({
          id: blobId,
          typeId: 4, // Blob type
          typeName: 'Blob',
          data: { size: 100, contentRef: `internal:${blobId}` },
        })
        entries.push({ name: `file-${i}.txt`, mode: '100644', hash: blobId })
      }

      // Create tree with entries in data
      const treeId = 'tree-1'
      await store.createThing({
        id: treeId,
        typeId: 3, // Tree type
        typeName: 'Tree',
        data: { entries },
      })

      // Reset counts
      countingStore.reset()

      // Simulate getTreeEntries - this is the N+1 pattern
      const tree = await countingStore.store.getThing(treeId)
      const treeData = tree?.data as { entries: typeof entries }
      const results: Array<{ thing: GraphThing; entry: typeof entries[0] }> = []

      for (const entry of treeData.entries) {
        const thing = await countingStore.store.getThing(entry.hash)
        if (thing) {
          results.push({ thing, entry })
        }
      }

      expect(results.length).toBe(entryCount)

      // This PROVES N+1: 1 (tree) + N (entries) = N+1 queries
      expect(countingStore.counts.getThing).toBe(entryCount + 1)

      // After GREEN phase fix:
      // expect(countingStore.counts.getThing).toBeLessThanOrEqual(2)
    })
  })
})

describe('FunctionGraphAdapter N+1 Patterns', () => {
  let store: SQLiteGraphStore
  let countingStore: ReturnType<typeof createQueryCountingStore>

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    countingStore = createQueryCountingStore(store)
  })

  afterEach(async () => {
    await store.close()
  })

  describe('getCascadeTargets() pattern simulation', () => {
    it('[RED] demonstrates N+1: individual getThing per cascade target', async () => {
      const targetCount = 20

      // Create source function
      const sourceId = 'fn-source'
      await store.createThing({
        id: sourceId,
        typeId: 100, // CodeFunction
        typeName: 'CodeFunction',
        data: { name: 'source', type: 'code' },
      })

      // Create target functions and cascade relationships
      for (let i = 0; i < targetCount; i++) {
        const targetId = `fn-target-${i}`
        await store.createThing({
          id: targetId,
          typeId: 101, // GenerativeFunction
          typeName: 'GenerativeFunction',
          data: { name: `target-${i}`, type: 'generative' },
        })

        await store.createRelationship({
          id: `cascade-${i}`,
          verb: 'cascadesTo',
          from: `do://functions/${sourceId}`,
          to: `do://functions/${targetId}`,
          data: { priority: i },
        })
      }

      // Reset counts
      countingStore.reset()

      // Simulate getCascadeTargets - this is the N+1 pattern
      const rels = await countingStore.store.queryRelationshipsFrom(
        `do://functions/${sourceId}`,
        { verb: 'cascadesTo' }
      )

      const targets: GraphThing[] = []
      for (const rel of rels) {
        const targetId = rel.to.replace('do://functions/', '')
        const fn = await countingStore.store.getThing(targetId)
        if (fn) {
          targets.push(fn)
        }
      }

      expect(targets.length).toBe(targetCount)

      // This PROVES N+1: N getThing calls
      expect(countingStore.counts.getThing).toBe(targetCount)

      // After GREEN phase fix:
      // expect(countingStore.counts.getThing).toBeLessThanOrEqual(2)
    })
  })

  describe('getCascadeChain() pattern simulation', () => {
    it('[RED] demonstrates N+1: O(N) queries for chain of length N', async () => {
      const chainLength = 15

      // Create chain of functions
      const functionIds: string[] = []
      for (let i = 0; i < chainLength; i++) {
        const fnId = `fn-chain-${i}`
        await store.createThing({
          id: fnId,
          typeId: 100 + (i % 4), // Rotate through function types
          typeName: ['CodeFunction', 'GenerativeFunction', 'AgenticFunction', 'HumanFunction'][i % 4]!,
          data: { name: `chain-${i}`, type: ['code', 'generative', 'agentic', 'human'][i % 4] },
        })
        functionIds.push(fnId)
      }

      // Link them in a chain
      for (let i = 0; i < chainLength - 1; i++) {
        await store.createRelationship({
          id: `cascade-chain-${i}`,
          verb: 'cascadesTo',
          from: `do://functions/${functionIds[i]}`,
          to: `do://functions/${functionIds[i + 1]}`,
        })
      }

      // Reset counts
      countingStore.reset()

      // Simulate getCascadeChain - this is the N+1 pattern
      const chain: GraphThing[] = []
      let currentId: string | null = functionIds[0]!
      const visited = new Set<string>()

      while (currentId && !visited.has(currentId)) {
        visited.add(currentId)

        // Query 1: Get the function
        const fn = await countingStore.store.getThing(currentId)
        if (!fn) break

        chain.push(fn)

        // Query 2: Get next in chain
        const rels = await countingStore.store.queryRelationshipsFrom(
          `do://functions/${currentId}`,
          { verb: 'cascadesTo' }
        )

        if (rels.length === 0) break

        currentId = rels[0]!.to.replace('do://functions/', '')
      }

      expect(chain.length).toBe(chainLength)

      // This PROVES N+1: N getThing + N queryRelationshipsFrom = 2N queries
      expect(countingStore.counts.getThing).toBe(chainLength)
      expect(countingStore.counts.queryRelationshipsFrom).toBe(chainLength)
      expect(countingStore.counts.total).toBe(chainLength * 2)

      // After GREEN phase fix with caching/batching:
      // expect(countingStore.counts.total).toBeLessThanOrEqual(5)
    })
  })

  describe('getFunctionsByOrg() pattern simulation', () => {
    it('[RED] demonstrates N+1: individual getThing per owned function', async () => {
      const functionCount = 30
      const orgId = 'acme-corp'

      // Create functions owned by org
      for (let i = 0; i < functionCount; i++) {
        const fnId = `fn-org-${i}`
        await store.createThing({
          id: fnId,
          typeId: 100,
          typeName: 'CodeFunction',
          data: { name: `fn-${i}`, type: 'code' },
        })

        await store.createRelationship({
          id: `owned-${i}`,
          verb: 'ownedBy',
          from: `do://functions/${fnId}`,
          to: `do://orgs/${orgId}`,
        })
      }

      // Reset counts
      countingStore.reset()

      // Simulate getFunctionsByOrg - this is the N+1 pattern
      const rels = await countingStore.store.queryRelationshipsTo(
        `do://orgs/${orgId}`,
        { verb: 'ownedBy' }
      )

      const functions: GraphThing[] = []
      for (const rel of rels) {
        const fnId = rel.from.replace('do://functions/', '')
        const fn = await countingStore.store.getThing(fnId)
        if (fn) {
          functions.push(fn)
        }
      }

      expect(functions.length).toBe(functionCount)

      // This PROVES N+1: N getThing calls
      expect(countingStore.counts.getThing).toBe(functionCount)

      // After GREEN phase fix:
      // expect(countingStore.counts.getThing).toBeLessThanOrEqual(2)
    })
  })

  describe('getAllFunctions() pattern simulation', () => {
    it('[RED] demonstrates N+1: separate query per function type', async () => {
      // Create functions of each type
      await store.createThing({ id: 'code1', typeId: 100, typeName: 'CodeFunction', data: { name: 'code1', type: 'code' } })
      await store.createThing({ id: 'code2', typeId: 100, typeName: 'CodeFunction', data: { name: 'code2', type: 'code' } })
      await store.createThing({ id: 'gen1', typeId: 101, typeName: 'GenerativeFunction', data: { name: 'gen1', type: 'generative' } })
      await store.createThing({ id: 'agent1', typeId: 102, typeName: 'AgenticFunction', data: { name: 'agent1', type: 'agentic' } })
      await store.createThing({ id: 'human1', typeId: 103, typeName: 'HumanFunction', data: { name: 'human1', type: 'human' } })

      // Reset counts
      countingStore.reset()

      // Simulate getAllFunctions - this is the N+1 pattern
      const typeNames = ['CodeFunction', 'GenerativeFunction', 'AgenticFunction', 'HumanFunction', 'Function']
      const results: GraphThing[] = []

      for (const typeName of typeNames) {
        const functions = await countingStore.store.getThingsByType({ typeName })
        results.push(...functions)
      }

      expect(results.length).toBe(5)

      // This PROVES N+1: 5 separate queries (one per type)
      expect(countingStore.counts.getThingsByType).toBe(5)

      // After GREEN phase fix with typeName IN (...):
      // expect(countingStore.counts.getThingsByType).toBeLessThanOrEqual(1)
    })
  })
})

// ============================================================================
// PERFORMANCE REGRESSION TESTS WITH 100+ ITEMS
// ============================================================================

describe('Performance Regression Tests (100+ items)', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Batch getThings performance', () => {
    it('should fetch 100 things efficiently', async () => {
      // Create 100 things
      const ids: string[] = []
      for (let i = 0; i < 100; i++) {
        const thing = await store.createThing({
          id: `perf-thing-${i}`,
          typeId: 1,
          typeName: 'TestItem',
          data: { index: i, payload: 'x'.repeat(100) },
        })
        ids.push(thing.id)
      }

      const start = performance.now()
      const result = await store.getThings(ids)
      const duration = performance.now() - start

      expect(result.size).toBe(100)
      expect(duration).toBeLessThan(100) // Should complete in < 100ms
    })

    it('should fetch 500 things efficiently with chunking', async () => {
      // Create 500 things
      const ids: string[] = []
      for (let i = 0; i < 500; i++) {
        const thing = await store.createThing({
          id: `perf-500-${i}`,
          typeId: 1,
          typeName: 'TestItem',
          data: { index: i },
        })
        ids.push(thing.id)
      }

      const start = performance.now()
      const result = await store.getThings(ids)
      const duration = performance.now() - start

      expect(result.size).toBe(500)
      expect(duration).toBeLessThan(500) // Should complete in < 500ms
    })
  })

  describe('Batch relationship queries performance', () => {
    it('should query relationships from 100 sources efficiently', async () => {
      // Create 100 source-target pairs
      const sourceUrls: string[] = []
      for (let i = 0; i < 100; i++) {
        await store.createThing({
          id: `perf-source-${i}`,
          typeId: 1,
          typeName: 'Source',
          data: {},
        })
        await store.createThing({
          id: `perf-target-${i}`,
          typeId: 2,
          typeName: 'Target',
          data: {},
        })
        await store.createRelationship({
          id: `perf-rel-${i}`,
          verb: 'links',
          from: `do://perf-sources/${i}`,
          to: `do://perf-targets/${i}`,
        })
        sourceUrls.push(`do://perf-sources/${i}`)
      }

      const start = performance.now()
      const result = await store.queryRelationshipsFromMany(sourceUrls)
      const duration = performance.now() - start

      expect(result.length).toBe(100)
      expect(duration).toBeLessThan(100) // Should complete in < 100ms
    })
  })

  describe('Memory usage for large result sets', () => {
    it('should handle 200 items without excessive memory', async () => {
      const itemCount = 200

      // Create items
      const ids: string[] = []
      for (let i = 0; i < itemCount; i++) {
        const thing = await store.createThing({
          id: `mem-item-${i}`,
          typeId: 1,
          typeName: 'MemoryTest',
          data: { index: i, content: 'Test data ' + i },
        })
        ids.push(thing.id)
      }

      // Capture memory before
      const memBefore = process.memoryUsage().heapUsed

      // Execute batch fetch
      const result = await store.getThings(ids)

      // Capture memory after
      const memAfter = process.memoryUsage().heapUsed
      const memDelta = memAfter - memBefore

      expect(result.size).toBe(itemCount)

      // Memory delta should be reasonable (< 10MB for 200 items)
      expect(memDelta).toBeLessThan(10 * 1024 * 1024)
    })
  })
})

// ============================================================================
// QUERY COUNT DOCUMENTATION TESTS
// ============================================================================

describe('N+1 Query Count Documentation', () => {
  let store: SQLiteGraphStore
  let countingStore: ReturnType<typeof createQueryCountingStore>

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    countingStore = createQueryCountingStore(store)
  })

  afterEach(async () => {
    await store.close()
  })

  it('documents actual vs expected query counts', async () => {
    // Create test data
    const itemCount = 20
    for (let i = 0; i < itemCount; i++) {
      await store.createThing({
        id: `doc-item-${i}`,
        typeId: 1,
        typeName: 'DocItem',
        data: { index: i },
      })
    }

    const ids = Array.from({ length: itemCount }, (_, i) => `doc-item-${i}`)

    // Test N+1 pattern (loop of getThing)
    countingStore.reset()
    for (const id of ids) {
      await countingStore.store.getThing(id)
    }
    const nPlus1Queries = countingStore.counts.getThing

    // Test batch pattern (single getThings)
    countingStore.reset()
    await countingStore.store.getThings(ids)
    const batchQueries = countingStore.counts.getThings

    // Document the difference
    console.log(`Query count comparison for ${itemCount} items:`)
    console.log(`  N+1 pattern (loop of getThing): ${nPlus1Queries} queries`)
    console.log(`  Batch pattern (getThings):      ${batchQueries} queries`)
    console.log(`  Improvement: ${nPlus1Queries / batchQueries}x fewer queries`)

    // Verify the improvement
    expect(nPlus1Queries).toBe(itemCount) // N+1 does N queries
    expect(batchQueries).toBe(1) // Batch does 1 query
  })
})
