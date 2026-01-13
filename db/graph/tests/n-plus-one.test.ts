/**
 * N+1 Query Pattern Tests
 *
 * RED PHASE: Tests that expose N+1 query anti-patterns in graph adapters.
 * These tests should FAIL, proving the N+1 patterns exist and need fixing.
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
 * NO MOCKS of business logic - only counting real queries
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores/sqlite'
import { createFileGraphAdapter, type FileGraphAdapter } from '../adapters/file-graph-adapter'
import { GitGraphAdapter } from '../adapters/git-graph-adapter'
import { FunctionGraphAdapter } from '../adapters/function-graph-adapter'
import type { GraphStore, GraphThing } from '../types'

// ============================================================================
// QUERY COUNTING WRAPPER
// ============================================================================

/**
 * Query counter that wraps a GraphStore to track query counts.
 * Uses a Proxy to intercept method calls without mocking behavior.
 */
interface QueryCounts {
  getThing: number
  getThingsByType: number
  queryRelationshipsFrom: number
  queryRelationshipsTo: number
  total: number
}

function createQueryCountingStore(store: SQLiteGraphStore): {
  store: GraphStore
  counts: QueryCounts
  reset: () => void
} {
  const counts: QueryCounts = {
    getThing: 0,
    getThingsByType: 0,
    queryRelationshipsFrom: 0,
    queryRelationshipsTo: 0,
    total: 0,
  }

  const reset = () => {
    counts.getThing = 0
    counts.getThingsByType = 0
    counts.queryRelationshipsFrom = 0
    counts.queryRelationshipsTo = 0
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
          } else if (prop === 'getThingsByType') {
            counts.getThingsByType++
            counts.total++
          } else if (prop === 'queryRelationshipsFrom') {
            counts.queryRelationshipsFrom++
            counts.total++
          } else if (prop === 'queryRelationshipsTo') {
            counts.queryRelationshipsTo++
            counts.total++
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
// FILE GRAPH ADAPTER N+1 TESTS
// ============================================================================

describe('FileGraphAdapter N+1 Query Patterns', () => {
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

  describe('ls() - Directory Listing', () => {
    /**
     * To properly test FileGraphAdapter N+1, we need to use the FileGraphAdapterImpl
     * directly with our counting store. The public createFileGraphAdapter() creates
     * its own internal store which we can't wrap.
     *
     * For these tests, we simulate the ls() pattern by reproducing its logic
     * to demonstrate the N+1 issue.
     */
    it('FAILS: ls() pattern queries each child individually (N+1 proven)', async () => {
      // Simulate the ls() pattern: get relationships, then loop and getThing for each
      // This mirrors FileGraphAdapterImpl.ls() lines 527-551

      // Setup: Create a directory with children
      const dirId = 'fs:/dir'
      const fileCount = 30

      // Create directory Thing
      await countingStore.store.createThing({
        id: dirId,
        typeId: 1, // Directory
        typeName: 'Directory',
        data: { path: '/dir', mtime: Date.now() },
      })

      // Create file Things and relationships
      for (let i = 0; i < fileCount; i++) {
        const fileId = `fs:/dir/file-${i}.txt`
        await countingStore.store.createThing({
          id: fileId,
          typeId: 2, // File
          typeName: 'File',
          data: { path: `/dir/file-${i}.txt`, size: 100, mtime: Date.now() },
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

      // Simulate ls() pattern - this IS the N+1 pattern from FileGraphAdapterImpl
      const relationships = await countingStore.store.queryRelationshipsFrom(`thing://${dirId}`, {
        verb: 'contains',
      })

      // N+1 PATTERN: Loop through relationships and query each child individually
      const children = []
      for (const rel of relationships) {
        const childId = rel.to.replace('thing://', '')
        const child = await countingStore.store.getThing(childId) // <-- N+1 here!
        if (child) {
          children.push(child)
        }
      }

      // Assert results
      expect(children.length).toBe(fileCount)
      expect(relationships.length).toBe(fileCount)

      // THIS ASSERTION SHOULD FAIL - proves N+1
      // Expected with batch loading: 1 query for relationships + 1 batch query for things = 2
      // Actual with N+1: 1 query for relationships + N queries for things = N+1
      expect(countingStore.counts.getThing).toBeLessThanOrEqual(2)
    })

    it('FAILS: query count scales linearly with directory size', async () => {
      // Test with two different directory sizes to prove linear scaling

      // Small directory (10 files)
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

      // Large directory (100 files)
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

      // Measure small directory ls()
      countingStore.reset()
      const smallRels = await countingStore.store.queryRelationshipsFrom(`thing://${smallDirId}`, { verb: 'contains' })
      for (const rel of smallRels) {
        await countingStore.store.getThing(rel.to.replace('thing://', ''))
      }
      const smallQueries = countingStore.counts.getThing

      // Measure large directory ls()
      countingStore.reset()
      const largeRels = await countingStore.store.queryRelationshipsFrom(`thing://${largeDirId}`, { verb: 'contains' })
      for (const rel of largeRels) {
        await countingStore.store.getThing(rel.to.replace('thing://', ''))
      }
      const largeQueries = countingStore.counts.getThing

      // THIS ASSERTION SHOULD FAIL - proves linear scaling (N+1)
      // With N+1: largeQueries = 100, smallQueries = 10, ratio = 10
      // Without N+1: both would be ~1-2 queries regardless of size
      expect(largeQueries).toBeLessThan(smallQueries * 2)
    })

    it('tracks memory allocation for large result sets', async () => {
      // This test uses the real createFileGraphAdapter to test memory behavior
      const adapter = await createFileGraphAdapter()

      // Create many files to test memory behavior
      const fileCount = 200
      for (let i = 0; i < fileCount; i++) {
        await adapter.createFile(`/memory/file-${i}.txt`, `Content ${i}`)
      }

      // Track memory before
      const memBefore = process.memoryUsage().heapUsed

      // Execute bulk operation
      const files = await adapter.ls('/memory')

      // Track memory after
      const memAfter = process.memoryUsage().heapUsed
      const memDelta = memAfter - memBefore

      expect(files.length).toBe(fileCount)

      // Memory delta should be reasonable (< 10MB for 200 small items)
      // This helps catch cases where N+1 causes excessive object allocation
      expect(memDelta).toBeLessThan(10 * 1024 * 1024)

      await adapter.close()
    })
  })
})

// ============================================================================
// GIT GRAPH ADAPTER N+1 TESTS
// ============================================================================

describe('GitGraphAdapter N+1 Query Patterns', () => {
  let store: SQLiteGraphStore
  let countingStore: ReturnType<typeof createQueryCountingStore>
  let adapter: GitGraphAdapter

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    countingStore = createQueryCountingStore(store)
    adapter = new GitGraphAdapter(countingStore.store)
  })

  afterEach(async () => {
    await store.close()
  })

  describe('getTreeEntries() - Tree Entry Resolution', () => {
    it('FAILS: getTreeEntries() should batch-load entries, not query individually', async () => {
      // Setup: Create blobs and a tree with many entries
      const entryCount = 30
      const entries = []

      for (let i = 0; i < entryCount; i++) {
        const blob = await adapter.createBlob({ content: `File content ${i}` })
        entries.push({ name: `file-${i}.txt`, mode: '100644', hash: blob.id })
      }

      const tree = await adapter.createTree(entries)

      // Reset counts before the operation we're testing
      countingStore.reset()

      // Execute: Get tree entries (this triggers N+1)
      const results = await adapter.getTreeEntries(tree.id)

      // Assert: Should be 1-2 queries (tree + batch entries), not N+1 queries
      expect(results.length).toBe(entryCount)

      // THIS ASSERTION SHOULD FAIL - proving N+1 exists
      // Expected: 2 queries (1 for tree, 1 batch for all entries)
      // Actual: 1 + N queries (1 for tree, N for each entry)
      expect(countingStore.counts.getThing).toBeLessThanOrEqual(2)
    })

    it('FAILS: query count should not scale linearly with entry count', async () => {
      // Create trees with different entry counts and compare query counts
      const smallEntryCount = 10
      const largeEntryCount = 100

      // Small tree
      const smallEntries = []
      for (let i = 0; i < smallEntryCount; i++) {
        const blob = await adapter.createBlob({ content: `Small ${i}` })
        smallEntries.push({ name: `small-${i}.txt`, mode: '100644', hash: blob.id })
      }
      const smallTree = await adapter.createTree(smallEntries)

      countingStore.reset()
      await adapter.getTreeEntries(smallTree.id)
      const smallQueryCount = countingStore.counts.getThing

      // Large tree
      const largeEntries = []
      for (let i = 0; i < largeEntryCount; i++) {
        const blob = await adapter.createBlob({ content: `Large ${i}` })
        largeEntries.push({ name: `large-${i}.txt`, mode: '100644', hash: blob.id })
      }
      const largeTree = await adapter.createTree(largeEntries)

      countingStore.reset()
      await adapter.getTreeEntries(largeTree.id)
      const largeQueryCount = countingStore.counts.getThing

      // If N+1 is fixed, query count should be similar regardless of N
      // THIS ASSERTION SHOULD FAIL - proving linear scaling
      // With N+1: largeQueryCount ~= 10x smallQueryCount
      // Without N+1: largeQueryCount ~= smallQueryCount
      expect(largeQueryCount).toBeLessThan(smallQueryCount * 2)
    })
  })

  describe('checkout() - Recursive Tree Resolution', () => {
    it('FAILS: checkout() should batch-resolve files, not query per entry', async () => {
      // Setup: Create a nested directory structure
      // /
      // ├── file1.txt
      // ├── file2.txt
      // └── subdir/
      //     ├── file3.txt
      //     └── file4.txt

      const file1 = await adapter.createBlob({ content: 'File 1' })
      const file2 = await adapter.createBlob({ content: 'File 2' })
      const file3 = await adapter.createBlob({ content: 'File 3' })
      const file4 = await adapter.createBlob({ content: 'File 4' })

      const subdir = await adapter.createTree([
        { name: 'file3.txt', mode: '100644', hash: file3.id },
        { name: 'file4.txt', mode: '100644', hash: file4.id },
      ])

      const root = await adapter.createTree([
        { name: 'file1.txt', mode: '100644', hash: file1.id },
        { name: 'file2.txt', mode: '100644', hash: file2.id },
        { name: 'subdir', mode: '040000', hash: subdir.id },
      ])

      const commit = await adapter.createCommit({
        message: 'Initial commit',
        tree: root.id,
      })

      await adapter.createRef('main', 'branch', commit.id)

      // Reset counts
      countingStore.reset()

      // Execute: Checkout triggers recursive tree resolution
      const files = await adapter.checkout('main')

      // Assert: Should batch-load, not N+1
      expect(files.size).toBe(4)

      // THIS ASSERTION SHOULD FAIL - checkout does recursive getThing calls
      // Expected: O(1) batch queries
      // Actual: O(N) individual queries for each blob + tree
      expect(countingStore.counts.getThing).toBeLessThanOrEqual(5)
    })
  })
})

// ============================================================================
// FUNCTION GRAPH ADAPTER N+1 TESTS
// ============================================================================

describe('FunctionGraphAdapter N+1 Query Patterns', () => {
  let store: SQLiteGraphStore
  let countingStore: ReturnType<typeof createQueryCountingStore>
  let adapter: FunctionGraphAdapter

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    countingStore = createQueryCountingStore(store)
    adapter = new FunctionGraphAdapter(countingStore.store)
  })

  afterEach(async () => {
    await store.close()
  })

  describe('getCascadeTargets() - Cascade Resolution', () => {
    it('FAILS: getCascadeTargets() should batch-load targets', async () => {
      // Setup: Create a function with many cascade targets
      const source = await adapter.createFunction({ name: 'source', type: 'code' })

      const targetCount = 20
      for (let i = 0; i < targetCount; i++) {
        const target = await adapter.createFunction({ name: `target-${i}`, type: 'generative' })
        await adapter.addCascade(source.id, target.id, { priority: i })
      }

      // Reset counts
      countingStore.reset()

      // Execute: Get cascade targets
      const targets = await adapter.getCascadeTargets(source.id)

      // Assert
      expect(targets.length).toBe(targetCount)

      // THIS ASSERTION SHOULD FAIL - proves N+1
      // Expected: 1 query for relationships + 1 batch query for functions
      // Actual: 1 query for relationships + N queries for each function
      expect(countingStore.counts.getThing).toBeLessThanOrEqual(2)
    })
  })

  describe('getCascadeSources() - Reverse Cascade Lookup', () => {
    it('FAILS: getCascadeSources() should batch-load sources', async () => {
      // Setup: Create many functions cascading to one target
      const target = await adapter.createFunction({ name: 'target', type: 'human' })

      const sourceCount = 25
      for (let i = 0; i < sourceCount; i++) {
        const source = await adapter.createFunction({ name: `source-${i}`, type: 'code' })
        await adapter.addCascade(source.id, target.id)
      }

      // Reset counts
      countingStore.reset()

      // Execute: Get cascade sources
      const sources = await adapter.getCascadeSources(target.id)

      // Assert
      expect(sources.length).toBe(sourceCount)

      // THIS ASSERTION SHOULD FAIL - proves N+1
      expect(countingStore.counts.getThing).toBeLessThanOrEqual(2)
    })
  })

  describe('getCascadeChain() - Chain Resolution', () => {
    it('FAILS: getCascadeChain() makes O(N) queries for chain of length N', async () => {
      // Setup: Create a cascade chain of depth 15
      const chainLength = 15
      const functions: GraphThing[] = []

      for (let i = 0; i < chainLength; i++) {
        const fn = await adapter.createFunction({
          name: `chain-${i}`,
          type: i % 4 === 0 ? 'code' : i % 4 === 1 ? 'generative' : i % 4 === 2 ? 'agentic' : 'human',
        })
        functions.push(fn)
      }

      // Chain them together
      for (let i = 0; i < chainLength - 1; i++) {
        await adapter.addCascade(functions[i]!.id, functions[i + 1]!.id)
      }

      // Reset counts
      countingStore.reset()

      // Execute: Resolve full chain
      const chain = await adapter.getCascadeChain(functions[0]!.id)

      // Assert
      expect(chain.length).toBe(chainLength)

      // THIS ASSERTION SHOULD FAIL - proves N+1
      // Each step in chain resolution does:
      // 1. getThing for current function
      // 2. queryRelationshipsFrom to find next
      // This accumulates to O(N) queries

      // Expected with optimization: O(1) batch or cached queries
      // Actual: ~N getThing + ~N queryRelationshipsFrom
      expect(countingStore.counts.total).toBeLessThanOrEqual(5)
    })
  })

  describe('getFunctionsByOrg() - Org Function Lookup', () => {
    it('FAILS: getFunctionsByOrg() should batch-load functions', async () => {
      // Setup: Create many functions owned by one org
      const orgId = 'acme-corp'
      const functionCount = 30

      for (let i = 0; i < functionCount; i++) {
        const fn = await adapter.createFunction({ name: `fn-${i}`, type: 'code' })
        await adapter.setOwner(fn.id, orgId)
      }

      // Reset counts
      countingStore.reset()

      // Execute: Get all functions for org
      const orgFunctions = await adapter.getFunctionsByOrg(orgId)

      // Assert
      expect(orgFunctions.length).toBe(functionCount)

      // THIS ASSERTION SHOULD FAIL - proves N+1
      // Expected: 1 query for relationships + 1 batch query
      // Actual: 1 query for relationships + N getThing queries
      expect(countingStore.counts.getThing).toBeLessThanOrEqual(2)
    })
  })

  describe('getFunctionsByInterface() - Interface Implementation Lookup', () => {
    it('FAILS: getFunctionsByInterface() should batch-load functions', async () => {
      // Setup: Create many functions implementing an interface
      const interfaceId = 'IProcessor'
      const functionCount = 25

      for (let i = 0; i < functionCount; i++) {
        const fn = await adapter.createFunction({ name: `processor-${i}`, type: 'code' })
        await adapter.setInterface(fn.id, interfaceId)
      }

      // Reset counts
      countingStore.reset()

      // Execute: Get all functions implementing interface
      const implementations = await adapter.getFunctionsByInterface(interfaceId)

      // Assert
      expect(implementations.length).toBe(functionCount)

      // THIS ASSERTION SHOULD FAIL - proves N+1
      expect(countingStore.counts.getThing).toBeLessThanOrEqual(2)
    })
  })

  describe('getAllFunctions() - Multi-Type Query', () => {
    it('FAILS: getAllFunctions() should use single query, not query per type', async () => {
      // Setup: Create functions of various types
      await adapter.createFunction({ name: 'code1', type: 'code' })
      await adapter.createFunction({ name: 'code2', type: 'code' })
      await adapter.createFunction({ name: 'gen1', type: 'generative' })
      await adapter.createFunction({ name: 'agent1', type: 'agentic' })
      await adapter.createFunction({ name: 'human1', type: 'human' })

      // Reset counts
      countingStore.reset()

      // Execute: Get all functions
      const allFunctions = await adapter.getAllFunctions()

      // Assert
      expect(allFunctions.length).toBe(5)

      // THIS ASSERTION SHOULD FAIL - proves multiple queries per type
      // Currently getAllFunctions loops through type names calling getThingsByType each time
      // Expected: 1 query with type IN (...)
      // Actual: 5 queries (one per type name)
      expect(countingStore.counts.getThingsByType).toBeLessThanOrEqual(1)
    })
  })
})

// ============================================================================
// PERFORMANCE REGRESSION TESTS
// ============================================================================

describe('N+1 Performance Regression Tests', () => {
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

  describe('FileGraphAdapter Performance', () => {
    it('FAILS: ls() with 100+ items completes in reasonable time', async () => {
      const adapter = await createFileGraphAdapter()
      const itemCount = 150

      // Setup: Create many files
      for (let i = 0; i < itemCount; i++) {
        await adapter.createFile(`/perf/file-${i}.txt`, `Content ${i}`)
      }

      // Execute with timing
      const start = performance.now()
      const files = await adapter.ls('/perf')
      const duration = performance.now() - start

      expect(files.length).toBe(itemCount)

      // THIS ASSERTION MAY FAIL - N+1 causes slow performance
      // With N+1: Each file requires DB roundtrip, ~150 queries
      // Without N+1: Single batch query
      // Expected: < 100ms for 150 items
      // Actual with N+1: Could be 500ms+ depending on system
      expect(duration).toBeLessThan(100)

      await adapter.close()
    })
  })

  describe('GitGraphAdapter Performance', () => {
    it('FAILS: checkout() with deep tree completes in reasonable time', async () => {
      const adapter = new GitGraphAdapter(countingStore.store)

      // Create a tree with 100 files
      const entries = []
      for (let i = 0; i < 100; i++) {
        const blob = await adapter.createBlob({ content: `File ${i} content here` })
        entries.push({ name: `file-${i}.txt`, mode: '100644', hash: blob.id })
      }

      const tree = await adapter.createTree(entries)
      const commit = await adapter.createCommit({ message: 'Large commit', tree: tree.id })
      await adapter.createRef('main', 'branch', commit.id)

      // Execute with timing
      const start = performance.now()
      const files = await adapter.checkout('main')
      const duration = performance.now() - start

      expect(files.size).toBe(100)

      // THIS ASSERTION MAY FAIL - N+1 causes slow checkout
      expect(duration).toBeLessThan(100)
    })
  })

  describe('FunctionGraphAdapter Performance', () => {
    it('FAILS: getCascadeChain() with deep chain completes in reasonable time', async () => {
      const adapter = new FunctionGraphAdapter(countingStore.store)

      // Create a chain of 50 functions
      const chainLength = 50
      const functions: GraphThing[] = []

      for (let i = 0; i < chainLength; i++) {
        const fn = await adapter.createFunction({ name: `fn-${i}`, type: 'code' })
        functions.push(fn)
      }

      for (let i = 0; i < chainLength - 1; i++) {
        await adapter.addCascade(functions[i]!.id, functions[i + 1]!.id)
      }

      // Execute with timing
      const start = performance.now()
      const chain = await adapter.getCascadeChain(functions[0]!.id)
      const duration = performance.now() - start

      expect(chain.length).toBe(chainLength)

      // THIS ASSERTION MAY FAIL - N+1 causes slow chain resolution
      expect(duration).toBeLessThan(100)
    })
  })
})

// ============================================================================
// QUERY COUNT DOCUMENTATION TESTS
// ============================================================================

describe('N+1 Query Count Documentation', () => {
  /**
   * These tests document the actual query counts to prove N+1 exists.
   * They don't assert failure but record the counts for analysis.
   */

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

  it('documents GitGraphAdapter.getTreeEntries() query pattern', async () => {
    const adapter = new GitGraphAdapter(countingStore.store)
    const entryCount = 20

    const entries = []
    for (let i = 0; i < entryCount; i++) {
      const blob = await adapter.createBlob({ content: `Content ${i}` })
      entries.push({ name: `file-${i}.txt`, mode: '100644', hash: blob.id })
    }

    const tree = await adapter.createTree(entries)

    countingStore.reset()
    await adapter.getTreeEntries(tree.id)

    // Document actual counts
    console.log('GitGraphAdapter.getTreeEntries() with', entryCount, 'entries:')
    console.log('  getThing calls:', countingStore.counts.getThing)
    console.log('  Expected (no N+1):', 2)
    console.log('  Actual shows N+1:', countingStore.counts.getThing > 2)

    // This proves N+1: getThing count should be ~entryCount + 1 (tree + each entry)
    expect(countingStore.counts.getThing).toBeGreaterThan(entryCount)
  })

  it('documents FunctionGraphAdapter.getCascadeTargets() query pattern', async () => {
    const adapter = new FunctionGraphAdapter(countingStore.store)
    const targetCount = 15

    const source = await adapter.createFunction({ name: 'source', type: 'code' })
    for (let i = 0; i < targetCount; i++) {
      const target = await adapter.createFunction({ name: `target-${i}`, type: 'generative' })
      await adapter.addCascade(source.id, target.id)
    }

    countingStore.reset()
    await adapter.getCascadeTargets(source.id)

    // Document actual counts
    console.log('FunctionGraphAdapter.getCascadeTargets() with', targetCount, 'targets:')
    console.log('  getThing calls:', countingStore.counts.getThing)
    console.log('  queryRelationshipsFrom calls:', countingStore.counts.queryRelationshipsFrom)
    console.log('  Expected (no N+1): 1-2')
    console.log('  Actual shows N+1:', countingStore.counts.getThing > 2)

    // This proves N+1: getThing count should be ~targetCount
    expect(countingStore.counts.getThing).toBeGreaterThan(targetCount - 1)
  })

  it('documents FunctionGraphAdapter.getAllFunctions() query pattern', async () => {
    const adapter = new FunctionGraphAdapter(countingStore.store)

    // Create one function of each type
    await adapter.createFunction({ name: 'code1', type: 'code' })
    await adapter.createFunction({ name: 'gen1', type: 'generative' })
    await adapter.createFunction({ name: 'agent1', type: 'agentic' })
    await adapter.createFunction({ name: 'human1', type: 'human' })

    countingStore.reset()
    await adapter.getAllFunctions()

    // Document actual counts
    console.log('FunctionGraphAdapter.getAllFunctions():')
    console.log('  getThingsByType calls:', countingStore.counts.getThingsByType)
    console.log('  Expected (no N+1): 1')
    console.log('  Actual shows N+1:', countingStore.counts.getThingsByType > 1)

    // This proves N+1: getThingsByType called once per type (5 times)
    expect(countingStore.counts.getThingsByType).toBeGreaterThan(1)
  })
})
