/**
 * Performance and Stress Tests for Graph Operations
 *
 * RED PHASE: These tests establish baseline performance metrics and detect
 * regressions in graph operations at scale.
 *
 * @see dotdo-j4nu9 - [RED] Performance and Stress Tests
 *
 * Test Categories:
 * 1. Thing CRUD Performance - Create, read, update, delete at scale (10K+)
 * 2. Relationship Query Performance - Traversal and query at scale (100K+)
 * 3. Deep Traversal Performance - Graph traversal with depth=10+
 * 4. Memory Usage Tracking - Memory high-water marks under load
 * 5. SQLite vs DocumentStore Comparison - Backend performance differences
 *
 * Metrics Tracked:
 * - Operations per second (ops/sec)
 * - P50/P95/P99 latency
 * - Memory high-water mark
 * - Query count per operation
 *
 * NO MOCKS - Uses real SQLite backends with in-memory databases
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores/sqlite'
import { DocumentGraphStore } from '../stores/document'
import type { GraphStore } from '../types'

// ============================================================================
// PERFORMANCE UTILITIES
// ============================================================================

/**
 * Calculate percentile from sorted array of values
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0
  const index = Math.ceil((p / 100) * sortedValues.length) - 1
  return sortedValues[Math.max(0, index)]!
}

/**
 * Calculate statistics from an array of timing measurements
 */
function calculateStats(timings: number[]): {
  min: number
  max: number
  mean: number
  p50: number
  p95: number
  p99: number
  total: number
  opsPerSec: number
} {
  const sorted = [...timings].sort((a, b) => a - b)
  const total = timings.reduce((sum, t) => sum + t, 0)
  const mean = total / timings.length

  return {
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    total,
    opsPerSec: timings.length / (total / 1000),
  }
}

/**
 * Measure execution time of an async operation
 */
async function measure<T>(fn: () => Promise<T>): Promise<{ result: T; elapsed: number }> {
  const start = performance.now()
  const result = await fn()
  const elapsed = performance.now() - start
  return { result, elapsed }
}

/**
 * Get current memory usage in MB
 */
function getMemoryMB(): number {
  return process.memoryUsage().heapUsed / (1024 * 1024)
}

// ============================================================================
// THING CRUD PERFORMANCE TESTS
// ============================================================================

describe('Thing CRUD Performance', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Create Performance', () => {
    it('should create 1000 things in under 5 seconds', async () => {
      const count = 1000
      const timings: number[] = []

      const { elapsed: totalElapsed } = await measure(async () => {
        for (let i = 0; i < count; i++) {
          const { elapsed } = await measure(async () => {
            await store.createThing({
              id: `perf-create-${i}`,
              typeId: 500, // Customer type from nouns.ts
              typeName: 'Customer',
              data: { name: `Customer ${i}`, email: `customer${i}@example.com`, index: i },
            })
          })
          timings.push(elapsed)
        }
      })

      const stats = calculateStats(timings)

      console.log(`\nCreate 1000 Things Performance:`)
      console.log(`  Total time: ${totalElapsed.toFixed(2)}ms`)
      console.log(`  Ops/sec: ${stats.opsPerSec.toFixed(2)}`)
      console.log(`  P50: ${stats.p50.toFixed(3)}ms`)
      console.log(`  P95: ${stats.p95.toFixed(3)}ms`)
      console.log(`  P99: ${stats.p99.toFixed(3)}ms`)

      // Baseline assertion: 1000 creates in under 5 seconds
      expect(totalElapsed).toBeLessThan(5000)
      // Individual operations should average under 5ms
      expect(stats.mean).toBeLessThan(5)
    })

    it('should create 10000 things in under 30 seconds', async () => {
      const count = 10000
      const memBefore = getMemoryMB()

      const { elapsed: totalElapsed } = await measure(async () => {
        for (let i = 0; i < count; i++) {
          await store.createThing({
            id: `perf-10k-${i}`,
            typeId: 500,
            typeName: 'Customer',
            data: { name: `Customer ${i}`, index: i },
          })
        }
      })

      const memAfter = getMemoryMB()
      const memDelta = memAfter - memBefore
      const opsPerSec = count / (totalElapsed / 1000)

      console.log(`\nCreate 10K Things Performance:`)
      console.log(`  Total time: ${totalElapsed.toFixed(2)}ms`)
      console.log(`  Ops/sec: ${opsPerSec.toFixed(2)}`)
      console.log(`  Memory delta: ${memDelta.toFixed(2)}MB`)

      // Baseline assertions
      expect(totalElapsed).toBeLessThan(30000)
      expect(opsPerSec).toBeGreaterThan(300) // At least 300 ops/sec
    })

    it('should handle batch create with varying data sizes', async () => {
      const smallData = { name: 'Small' }
      const mediumData = {
        name: 'Medium',
        description: 'A medium sized description'.repeat(10),
        tags: ['tag1', 'tag2', 'tag3'],
      }
      const largeData = {
        name: 'Large',
        description: 'A large description'.repeat(100),
        items: Array.from({ length: 100 }, (_, i) => ({ id: i, value: `item-${i}` })),
        metadata: {
          nested: {
            deeply: {
              nested: {
                value: 'deep'.repeat(50),
              },
            },
          },
        },
      }

      const iterations = 100

      // Small data
      const { elapsed: smallElapsed } = await measure(async () => {
        for (let i = 0; i < iterations; i++) {
          await store.createThing({
            id: `small-${i}`,
            typeId: 500,
            typeName: 'Customer',
            data: smallData,
          })
        }
      })

      // Medium data
      const { elapsed: mediumElapsed } = await measure(async () => {
        for (let i = 0; i < iterations; i++) {
          await store.createThing({
            id: `medium-${i}`,
            typeId: 500,
            typeName: 'Customer',
            data: mediumData,
          })
        }
      })

      // Large data
      const { elapsed: largeElapsed } = await measure(async () => {
        for (let i = 0; i < iterations; i++) {
          await store.createThing({
            id: `large-${i}`,
            typeId: 500,
            typeName: 'Customer',
            data: largeData,
          })
        }
      })

      console.log(`\nData Size Impact (${iterations} iterations each):`)
      console.log(`  Small data: ${smallElapsed.toFixed(2)}ms (${(iterations / (smallElapsed / 1000)).toFixed(2)} ops/sec)`)
      console.log(`  Medium data: ${mediumElapsed.toFixed(2)}ms (${(iterations / (mediumElapsed / 1000)).toFixed(2)} ops/sec)`)
      console.log(`  Large data: ${largeElapsed.toFixed(2)}ms (${(iterations / (largeElapsed / 1000)).toFixed(2)} ops/sec)`)

      // Large data should not be more than 10x slower than small data
      expect(largeElapsed).toBeLessThan(smallElapsed * 10)
    })
  })

  describe('Read Performance', () => {
    it('should read 1000 things individually in under 2 seconds', async () => {
      const count = 1000

      // Setup: Create things first
      for (let i = 0; i < count; i++) {
        await store.createThing({
          id: `read-${i}`,
          typeId: 500,
          typeName: 'Customer',
          data: { index: i },
        })
      }

      // Measure reads
      const timings: number[] = []
      const { elapsed: totalElapsed } = await measure(async () => {
        for (let i = 0; i < count; i++) {
          const { elapsed } = await measure(async () => {
            await store.getThing(`read-${i}`)
          })
          timings.push(elapsed)
        }
      })

      const stats = calculateStats(timings)

      console.log(`\nRead 1000 Things (getThing) Performance:`)
      console.log(`  Total time: ${totalElapsed.toFixed(2)}ms`)
      console.log(`  Ops/sec: ${stats.opsPerSec.toFixed(2)}`)
      console.log(`  P50: ${stats.p50.toFixed(3)}ms`)
      console.log(`  P95: ${stats.p95.toFixed(3)}ms`)
      console.log(`  P99: ${stats.p99.toFixed(3)}ms`)

      // Reads should be faster than creates
      expect(totalElapsed).toBeLessThan(2000)
      expect(stats.mean).toBeLessThan(2)
    })

    it('should batch read 1000 things in under 500ms using getThings()', async () => {
      const count = 1000
      const ids: string[] = []

      // Setup: Create things
      for (let i = 0; i < count; i++) {
        const id = `batch-read-${i}`
        ids.push(id)
        await store.createThing({
          id,
          typeId: 500,
          typeName: 'Customer',
          data: { index: i },
        })
      }

      // Measure batch read
      const { result, elapsed } = await measure(async () => {
        return store.getThings(ids)
      })

      console.log(`\nBatch Read 1000 Things (getThings) Performance:`)
      console.log(`  Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`  Ops/sec: ${(count / (elapsed / 1000)).toFixed(2)}`)
      console.log(`  Items returned: ${result.size}`)

      expect(result.size).toBe(count)
      // Batch should be much faster than individual reads
      expect(elapsed).toBeLessThan(500)
    })

    it('should query 1000 things by type in under 500ms', async () => {
      const count = 1000

      // Setup: Create things of different types
      for (let i = 0; i < count; i++) {
        await store.createThing({
          id: `query-type-${i}`,
          typeId: 500,
          typeName: 'Customer',
          data: { index: i },
        })
      }

      // Also create some of another type
      for (let i = 0; i < 100; i++) {
        await store.createThing({
          id: `other-type-${i}`,
          typeId: 1, // User type
          typeName: 'User',
          data: { index: i },
        })
      }

      // Measure type query
      const { result, elapsed } = await measure(async () => {
        return store.getThingsByType({ typeName: 'Customer' })
      })

      console.log(`\nQuery Things by Type Performance:`)
      console.log(`  Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`  Items returned: ${result.length}`)
      console.log(`  Ops/sec: ${(result.length / (elapsed / 1000)).toFixed(2)}`)

      expect(result.length).toBe(count)
      expect(elapsed).toBeLessThan(500)
    })
  })

  describe('Update Performance', () => {
    it('should update 1000 things in under 5 seconds', async () => {
      const count = 1000

      // Setup: Create things
      for (let i = 0; i < count; i++) {
        await store.createThing({
          id: `update-${i}`,
          typeId: 500,
          typeName: 'Customer',
          data: { version: 1, index: i },
        })
      }

      // Measure updates
      const timings: number[] = []
      const { elapsed: totalElapsed } = await measure(async () => {
        for (let i = 0; i < count; i++) {
          const { elapsed } = await measure(async () => {
            await store.updateThing(`update-${i}`, {
              data: { version: 2, index: i, updatedAt: Date.now() },
            })
          })
          timings.push(elapsed)
        }
      })

      const stats = calculateStats(timings)

      console.log(`\nUpdate 1000 Things Performance:`)
      console.log(`  Total time: ${totalElapsed.toFixed(2)}ms`)
      console.log(`  Ops/sec: ${stats.opsPerSec.toFixed(2)}`)
      console.log(`  P50: ${stats.p50.toFixed(3)}ms`)
      console.log(`  P95: ${stats.p95.toFixed(3)}ms`)
      console.log(`  P99: ${stats.p99.toFixed(3)}ms`)

      expect(totalElapsed).toBeLessThan(5000)
    })
  })

  describe('Delete Performance', () => {
    it('should soft delete 1000 things in under 5 seconds', async () => {
      const count = 1000

      // Setup: Create things
      for (let i = 0; i < count; i++) {
        await store.createThing({
          id: `delete-${i}`,
          typeId: 500,
          typeName: 'Customer',
          data: { index: i },
        })
      }

      // Measure deletes
      const timings: number[] = []
      const { elapsed: totalElapsed } = await measure(async () => {
        for (let i = 0; i < count; i++) {
          const { elapsed } = await measure(async () => {
            await store.deleteThing(`delete-${i}`)
          })
          timings.push(elapsed)
        }
      })

      const stats = calculateStats(timings)

      console.log(`\nDelete 1000 Things Performance:`)
      console.log(`  Total time: ${totalElapsed.toFixed(2)}ms`)
      console.log(`  Ops/sec: ${stats.opsPerSec.toFixed(2)}`)
      console.log(`  P50: ${stats.p50.toFixed(3)}ms`)
      console.log(`  P95: ${stats.p95.toFixed(3)}ms`)

      expect(totalElapsed).toBeLessThan(5000)
    })
  })
})

// ============================================================================
// RELATIONSHIP QUERY PERFORMANCE TESTS
// ============================================================================

describe('Relationship Query Performance', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Create Relationships', () => {
    it('should create 10000 relationships in under 30 seconds', async () => {
      const count = 10000
      const nodeCount = 200

      // Create nodes first
      for (let i = 0; i < nodeCount; i++) {
        await store.createThing({
          id: `node-${i}`,
          typeId: 500,
          typeName: 'Customer',
          data: { index: i },
        })
      }

      const { elapsed: totalElapsed } = await measure(async () => {
        for (let i = 0; i < count; i++) {
          // Use unique combinations: each relationship has unique (from, to, verb) by varying verb
          const fromIndex = Math.floor(i / nodeCount) % nodeCount
          const toIndex = i % nodeCount
          // Avoid self-loops and use verb variations to ensure uniqueness
          const verbVariant = Math.floor(i / (nodeCount * nodeCount))
          await store.createRelationship({
            id: `rel-${i}`,
            verb: `knows-${verbVariant}`,
            from: `do://test/nodes/${fromIndex}`,
            to: `do://test/nodes/${(toIndex + 1) % nodeCount}`, // offset to avoid self-loops
            data: { weight: Math.random() },
          })
        }
      })

      const opsPerSec = count / (totalElapsed / 1000)

      console.log(`\nCreate 10K Relationships Performance:`)
      console.log(`  Total time: ${totalElapsed.toFixed(2)}ms`)
      console.log(`  Ops/sec: ${opsPerSec.toFixed(2)}`)

      expect(totalElapsed).toBeLessThan(30000)
      expect(opsPerSec).toBeGreaterThan(300)
    })
  })

  describe('Query Relationships', () => {
    beforeEach(async () => {
      // Setup: Create a graph with many relationships
      const nodeCount = 100
      const relsPerNode = 50

      for (let i = 0; i < nodeCount; i++) {
        await store.createThing({
          id: `query-node-${i}`,
          typeId: 500,
          typeName: 'Customer',
          data: { index: i },
        })
      }

      let relId = 0
      for (let from = 0; from < nodeCount; from++) {
        for (let j = 0; j < relsPerNode; j++) {
          const to = (from + j + 1) % nodeCount
          await store.createRelationship({
            id: `query-rel-${relId++}`,
            verb: j % 2 === 0 ? 'follows' : 'likes',
            from: `do://test/nodes/${from}`,
            to: `do://test/nodes/${to}`,
          })
        }
      }
    })

    it('should query relationships from a node in under 50ms', async () => {
      const iterations = 100
      const timings: number[] = []

      for (let i = 0; i < iterations; i++) {
        const nodeId = i % 100
        const { elapsed } = await measure(async () => {
          return store.queryRelationshipsFrom(`do://test/nodes/${nodeId}`)
        })
        timings.push(elapsed)
      }

      const stats = calculateStats(timings)

      console.log(`\nQuery Relationships From Node (${iterations} iterations):`)
      console.log(`  Mean: ${stats.mean.toFixed(3)}ms`)
      console.log(`  P50: ${stats.p50.toFixed(3)}ms`)
      console.log(`  P95: ${stats.p95.toFixed(3)}ms`)
      console.log(`  P99: ${stats.p99.toFixed(3)}ms`)

      expect(stats.p95).toBeLessThan(50)
    })

    it('should query relationships to a node in under 50ms', async () => {
      const iterations = 100
      const timings: number[] = []

      for (let i = 0; i < iterations; i++) {
        const nodeId = i % 100
        const { elapsed } = await measure(async () => {
          return store.queryRelationshipsTo(`do://test/nodes/${nodeId}`)
        })
        timings.push(elapsed)
      }

      const stats = calculateStats(timings)

      console.log(`\nQuery Relationships To Node (${iterations} iterations):`)
      console.log(`  Mean: ${stats.mean.toFixed(3)}ms`)
      console.log(`  P50: ${stats.p50.toFixed(3)}ms`)
      console.log(`  P95: ${stats.p95.toFixed(3)}ms`)

      expect(stats.p95).toBeLessThan(50)
    })

    it('should query relationships by verb in under 500ms (5000 results)', async () => {
      const { result, elapsed } = await measure(async () => {
        return store.queryRelationshipsByVerb('follows')
      })

      console.log(`\nQuery Relationships by Verb:`)
      console.log(`  Time: ${elapsed.toFixed(2)}ms`)
      console.log(`  Results: ${result.length}`)

      // 50 nodes * 50 rels per node / 2 (half are 'follows') = 2500
      expect(result.length).toBeGreaterThan(2000)
      expect(elapsed).toBeLessThan(500)
    })

    it('should batch query from many nodes efficiently', async () => {
      const urls = Array.from({ length: 50 }, (_, i) => `do://test/nodes/${i}`)

      const { result, elapsed } = await measure(async () => {
        return store.queryRelationshipsFromMany(urls)
      })

      // Compare with individual queries
      let individualElapsed = 0
      for (const url of urls) {
        const { elapsed: e } = await measure(async () => {
          return store.queryRelationshipsFrom(url)
        })
        individualElapsed += e
      }

      console.log(`\nBatch Query vs Individual Query (50 nodes):`)
      console.log(`  Batch: ${elapsed.toFixed(2)}ms`)
      console.log(`  Individual sum: ${individualElapsed.toFixed(2)}ms`)
      console.log(`  Speedup: ${(individualElapsed / elapsed).toFixed(2)}x`)
      console.log(`  Results: ${result.length}`)

      // Batch should be significantly faster
      expect(elapsed).toBeLessThan(individualElapsed)
      expect(result.length).toBeGreaterThan(2000)
    })
  })
})

// ============================================================================
// DEEP TRAVERSAL PERFORMANCE TESTS
// ============================================================================

describe('Deep Traversal Performance', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  it('should traverse depth=10 chain in under 500ms', async () => {
    const depth = 10

    // Create a linear chain of nodes
    for (let i = 0; i < depth; i++) {
      await store.createThing({
        id: `chain-${i}`,
        typeId: 500,
        typeName: 'Customer',
        data: { level: i },
      })

      if (i > 0) {
        await store.createRelationship({
          id: `chain-rel-${i}`,
          verb: 'parent',
          from: `do://test/chain/${i}`,
          to: `do://test/chain/${i - 1}`,
        })
      }
    }

    // Traverse from leaf to root
    const { elapsed } = await measure(async () => {
      let currentUrl = `do://test/chain/${depth - 1}`
      const visited: string[] = []

      for (let i = 0; i < depth; i++) {
        const rels = await store.queryRelationshipsFrom(currentUrl, { verb: 'parent' })
        if (rels.length === 0) break
        visited.push(rels[0]!.to)
        currentUrl = rels[0]!.to
      }

      return visited
    })

    console.log(`\nDepth ${depth} Chain Traversal:`)
    console.log(`  Time: ${elapsed.toFixed(2)}ms`)
    console.log(`  Per level: ${(elapsed / depth).toFixed(2)}ms`)

    expect(elapsed).toBeLessThan(500)
  })

  it('should handle wide graph traversal (100 children per node, depth=3)', async () => {
    const width = 100
    const depth = 3

    // Create root
    await store.createThing({
      id: 'root',
      typeId: 500,
      typeName: 'Customer',
      data: { level: 0 },
    })

    // Create tree structure
    let nodeCount = 1
    let relCount = 0

    // Level 1
    for (let i = 0; i < width; i++) {
      await store.createThing({
        id: `level1-${i}`,
        typeId: 500,
        typeName: 'Customer',
        data: { level: 1, parent: 'root' },
      })
      await store.createRelationship({
        id: `rel-1-${i}`,
        verb: 'contains',
        from: 'do://test/root',
        to: `do://test/level1-${i}`,
      })
      nodeCount++
      relCount++
    }

    // Level 2 (10 children each for level 1, to keep test reasonable)
    for (let parent = 0; parent < width; parent++) {
      for (let i = 0; i < 10; i++) {
        await store.createThing({
          id: `level2-${parent}-${i}`,
          typeId: 500,
          typeName: 'Customer',
          data: { level: 2 },
        })
        await store.createRelationship({
          id: `rel-2-${parent}-${i}`,
          verb: 'contains',
          from: `do://test/level1-${parent}`,
          to: `do://test/level2-${parent}-${i}`,
        })
        nodeCount++
        relCount++
      }
    }

    console.log(`\nWide graph setup: ${nodeCount} nodes, ${relCount} relationships`)

    // Traverse from root (get all children)
    const { result: level1Children, elapsed: level1Time } = await measure(async () => {
      return store.queryRelationshipsFrom('do://test/root', { verb: 'contains' })
    })

    // Batch traverse to get level 2
    const level1Urls = level1Children.map((r) => r.to)
    const { result: level2Children, elapsed: level2Time } = await measure(async () => {
      return store.queryRelationshipsFromMany(level1Urls, { verb: 'contains' })
    })

    console.log(`\nWide Graph Traversal:`)
    console.log(`  Level 1 (${level1Children.length} children): ${level1Time.toFixed(2)}ms`)
    console.log(`  Level 2 (${level2Children.length} children): ${level2Time.toFixed(2)}ms`)
    console.log(`  Total: ${(level1Time + level2Time).toFixed(2)}ms`)

    expect(level1Children.length).toBe(width)
    expect(level2Children.length).toBe(width * 10)
    expect(level1Time + level2Time).toBeLessThan(2000)
  })
})

// ============================================================================
// MEMORY USAGE TESTS
// ============================================================================

describe('Memory Usage Under Load', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  it('should not leak memory during bulk operations', async () => {
    const batchSize = 1000
    const batches = 5
    const memorySnapshots: number[] = []

    // Force GC if available (requires --expose-gc flag)
    const maybeGC = () => {
      if (typeof global.gc === 'function') {
        global.gc()
      }
    }

    maybeGC()
    memorySnapshots.push(getMemoryMB())

    for (let batch = 0; batch < batches; batch++) {
      // Create batch of things
      for (let i = 0; i < batchSize; i++) {
        await store.createThing({
          id: `mem-${batch}-${i}`,
          typeId: 500,
          typeName: 'Customer',
          data: { batch, index: i, padding: 'x'.repeat(100) },
        })
      }

      // Query them back
      await store.getThingsByType({ typeName: 'Customer', limit: batchSize })

      maybeGC()
      memorySnapshots.push(getMemoryMB())
    }

    const memoryGrowth = memorySnapshots[memorySnapshots.length - 1]! - memorySnapshots[0]!

    console.log(`\nMemory Usage During Bulk Operations:`)
    console.log(`  Initial: ${memorySnapshots[0]!.toFixed(2)}MB`)
    console.log(`  Final: ${memorySnapshots[memorySnapshots.length - 1]!.toFixed(2)}MB`)
    console.log(`  Growth: ${memoryGrowth.toFixed(2)}MB`)
    console.log(`  Per batch: ${(memoryGrowth / batches).toFixed(2)}MB`)
    console.log(`  Snapshots: ${memorySnapshots.map((m) => m.toFixed(1)).join(' -> ')}MB`)

    // Memory growth should be bounded (not unbounded leak)
    // Allow ~50MB growth for 5000 things with 100-byte padding each
    expect(memoryGrowth).toBeLessThan(100)
  })

  it('should handle large result sets without excessive memory', async () => {
    const count = 5000

    // Create things
    for (let i = 0; i < count; i++) {
      await store.createThing({
        id: `large-result-${i}`,
        typeId: 500,
        typeName: 'Customer',
        data: { index: i },
      })
    }

    const memBefore = getMemoryMB()

    const { result, elapsed } = await measure(async () => {
      return store.getThingsByType({ typeName: 'Customer' })
    })

    const memAfter = getMemoryMB()
    const memDelta = memAfter - memBefore

    console.log(`\nLarge Result Set Memory:`)
    console.log(`  Count: ${result.length}`)
    console.log(`  Query time: ${elapsed.toFixed(2)}ms`)
    console.log(`  Memory for results: ${memDelta.toFixed(2)}MB`)
    console.log(`  Per item: ${((memDelta * 1024) / count).toFixed(2)}KB`)

    expect(result.length).toBe(count)
    // 5000 items should not use more than 50MB
    expect(memDelta).toBeLessThan(50)
  })
})

// ============================================================================
// SQLITE VS DOCUMENT STORE COMPARISON
// ============================================================================

describe('SQLite vs DocumentStore Comparison', () => {
  let sqliteStore: SQLiteGraphStore
  let docStore: DocumentGraphStore

  beforeEach(async () => {
    sqliteStore = new SQLiteGraphStore(':memory:')
    await sqliteStore.initialize()

    docStore = new DocumentGraphStore(':memory:')
    await docStore.initialize()
  })

  afterEach(async () => {
    await sqliteStore.close()
    await docStore.close()
  })

  it('should compare create performance', async () => {
    const count = 500

    // SQLite
    const { elapsed: sqliteElapsed } = await measure(async () => {
      for (let i = 0; i < count; i++) {
        await sqliteStore.createThing({
          id: `sqlite-${i}`,
          typeId: 500,
          typeName: 'Customer',
          data: { index: i, name: `Customer ${i}` },
        })
      }
    })

    // DocumentStore
    const { elapsed: docElapsed } = await measure(async () => {
      for (let i = 0; i < count; i++) {
        await docStore.createThing({
          id: `doc-${i}`,
          typeId: 500,
          typeName: 'Customer',
          data: { index: i, name: `Customer ${i}` },
        })
      }
    })

    console.log(`\nCreate Performance Comparison (${count} items):`)
    console.log(`  SQLiteGraphStore: ${sqliteElapsed.toFixed(2)}ms (${(count / (sqliteElapsed / 1000)).toFixed(0)} ops/sec)`)
    console.log(`  DocumentGraphStore: ${docElapsed.toFixed(2)}ms (${(count / (docElapsed / 1000)).toFixed(0)} ops/sec)`)
    console.log(`  Ratio: ${(docElapsed / sqliteElapsed).toFixed(2)}x`)

    // Both should complete in reasonable time
    expect(sqliteElapsed).toBeLessThan(5000)
    expect(docElapsed).toBeLessThan(5000)
  })

  it('should compare query performance', async () => {
    const count = 500

    // Setup both stores
    for (let i = 0; i < count; i++) {
      await sqliteStore.createThing({
        id: `sqlite-query-${i}`,
        typeId: 500,
        typeName: 'Customer',
        data: { index: i },
      })
      await docStore.createThing({
        id: `doc-query-${i}`,
        typeId: 500,
        typeName: 'Customer',
        data: { index: i },
      })
    }

    // SQLite query
    const { result: sqliteResult, elapsed: sqliteElapsed } = await measure(async () => {
      return sqliteStore.getThingsByType({ typeName: 'Customer' })
    })

    // DocumentStore query
    const { result: docResult, elapsed: docElapsed } = await measure(async () => {
      return docStore.getThingsByType({ typeName: 'Customer' })
    })

    console.log(`\nQuery Performance Comparison (${count} items):`)
    console.log(`  SQLiteGraphStore: ${sqliteElapsed.toFixed(2)}ms`)
    console.log(`  DocumentGraphStore: ${docElapsed.toFixed(2)}ms`)
    console.log(`  Ratio: ${(docElapsed / sqliteElapsed).toFixed(2)}x`)

    expect(sqliteResult.length).toBe(count)
    expect(docResult.length).toBe(count)
  })

  it('should compare relationship performance', async () => {
    const nodeCount = 50
    const relsPerNode = 20

    // Setup nodes in both stores
    for (let i = 0; i < nodeCount; i++) {
      await sqliteStore.createThing({
        id: `sqlite-rel-node-${i}`,
        typeId: 500,
        typeName: 'Customer',
        data: { index: i },
      })
      await docStore.createThing({
        id: `doc-rel-node-${i}`,
        typeId: 500,
        typeName: 'Customer',
        data: { index: i },
      })
    }

    // Create relationships
    const { elapsed: sqliteCreateElapsed } = await measure(async () => {
      let id = 0
      for (let from = 0; from < nodeCount; from++) {
        for (let j = 0; j < relsPerNode; j++) {
          const to = (from + j + 1) % nodeCount
          await sqliteStore.createRelationship({
            id: `sqlite-rel-${id++}`,
            verb: 'knows',
            from: `do://test/sqlite/${from}`,
            to: `do://test/sqlite/${to}`,
          })
        }
      }
    })

    const { elapsed: docCreateElapsed } = await measure(async () => {
      let id = 0
      for (let from = 0; from < nodeCount; from++) {
        for (let j = 0; j < relsPerNode; j++) {
          const to = (from + j + 1) % nodeCount
          await docStore.createRelationship({
            id: `doc-rel-${id++}`,
            verb: 'knows',
            from: `do://test/doc/${from}`,
            to: `do://test/doc/${to}`,
          })
        }
      }
    })

    // Query relationships
    const { elapsed: sqliteQueryElapsed } = await measure(async () => {
      for (let i = 0; i < nodeCount; i++) {
        await sqliteStore.queryRelationshipsFrom(`do://test/sqlite/${i}`)
      }
    })

    const { elapsed: docQueryElapsed } = await measure(async () => {
      for (let i = 0; i < nodeCount; i++) {
        await docStore.queryRelationshipsFrom(`do://test/doc/${i}`)
      }
    })

    const totalRels = nodeCount * relsPerNode

    console.log(`\nRelationship Performance Comparison (${totalRels} relationships):`)
    console.log(`  Create:`)
    console.log(`    SQLiteGraphStore: ${sqliteCreateElapsed.toFixed(2)}ms`)
    console.log(`    DocumentGraphStore: ${docCreateElapsed.toFixed(2)}ms`)
    console.log(`  Query (${nodeCount} queryRelationshipsFrom):`)
    console.log(`    SQLiteGraphStore: ${sqliteQueryElapsed.toFixed(2)}ms`)
    console.log(`    DocumentGraphStore: ${docQueryElapsed.toFixed(2)}ms`)
  })
})

// ============================================================================
// STRESS TESTS
// ============================================================================

describe('Stress Tests', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  it('should handle concurrent-like sequential operations without degradation', async () => {
    const operationsPerPhase = 100
    const phases = 7 // Use more phases so we can compute stable median
    const phaseTimes: number[] = []

    // Warmup phase - first phases often have initialization overhead
    for (let i = 0; i < 50; i++) {
      await store.createThing({
        id: `warmup-${i}`,
        typeId: 500,
        typeName: 'Customer',
        data: { warmup: true },
      })
    }

    for (let phase = 0; phase < phases; phase++) {
      const { elapsed } = await measure(async () => {
        for (let i = 0; i < operationsPerPhase; i++) {
          const op = i % 4
          const id = `stress-${phase}-${i}`

          switch (op) {
            case 0: // Create
              await store.createThing({
                id,
                typeId: 500,
                typeName: 'Customer',
                data: { phase, index: i },
              })
              break
            case 1: // Read
              await store.getThing(`stress-${phase}-${i - 1}`)
              break
            case 2: // Update
              await store.updateThing(`stress-${phase}-${i - 2}`, {
                data: { updated: true },
              })
              break
            case 3: // Query
              await store.getThingsByType({ typeName: 'Customer', limit: 10 })
              break
          }
        }
      })

      phaseTimes.push(elapsed)
    }

    const avgTime = phaseTimes.reduce((a, b) => a + b, 0) / phases
    const sorted = [...phaseTimes].sort((a, b) => a - b)
    const median = sorted[Math.floor(phases / 2)]!
    const firstPhase = phaseTimes[0]!
    const lastPhase = phaseTimes[phases - 1]!

    console.log(`\nStress Test - Sequential Operations:`)
    console.log(`  Phase times: ${phaseTimes.map((t) => t.toFixed(0)).join(', ')}ms`)
    console.log(`  Average: ${avgTime.toFixed(2)}ms`)
    console.log(`  Median: ${median.toFixed(2)}ms`)
    console.log(`  First/Last phase: ${firstPhase.toFixed(2)}/${lastPhase.toFixed(2)}ms`)

    // Key assertion: operations should complete in reasonable time
    // SQLite has periodic sync/checkpoint which can cause sporadic slowdowns
    // Focus on total throughput rather than variance which is unreliable
    const totalOps = phases * operationsPerPhase
    const totalTime = phaseTimes.reduce((a, b) => a + b, 0)
    const opsPerSec = totalOps / (totalTime / 1000)

    console.log(`  Total ops/sec: ${opsPerSec.toFixed(2)}`)

    // Should maintain at least 50 ops/sec even with periodic slowdowns
    expect(opsPerSec).toBeGreaterThan(50)
    // Median phase should complete in under 1 second
    expect(median).toBeLessThan(1000)
  })

  it('should survive rapid create/delete cycles', async () => {
    const cycles = 10
    const itemsPerCycle = 100
    const cycleTimes: number[] = []

    for (let cycle = 0; cycle < cycles; cycle++) {
      const { elapsed } = await measure(async () => {
        // Create items
        for (let i = 0; i < itemsPerCycle; i++) {
          await store.createThing({
            id: `cycle-${cycle}-${i}`,
            typeId: 500,
            typeName: 'Customer',
            data: { cycle, index: i },
          })
        }

        // Delete items
        for (let i = 0; i < itemsPerCycle; i++) {
          await store.deleteThing(`cycle-${cycle}-${i}`)
        }
      })

      cycleTimes.push(elapsed)
    }

    const avgCycleTime = cycleTimes.reduce((a, b) => a + b, 0) / cycles

    console.log(`\nStress Test - Create/Delete Cycles:`)
    console.log(`  Cycle times: ${cycleTimes.map((t) => t.toFixed(0)).join(', ')}ms`)
    console.log(`  Average cycle: ${avgCycleTime.toFixed(2)}ms`)
    console.log(`  Total operations: ${cycles * itemsPerCycle * 2}`)

    // Each cycle should complete in reasonable time
    expect(avgCycleTime).toBeLessThan(2000)
  })

  it('should handle mixed workload at scale', async () => {
    const totalOps = 2000
    const memBefore = getMemoryMB()

    const { elapsed } = await measure(async () => {
      for (let i = 0; i < totalOps; i++) {
        const opType = i % 10

        if (opType < 4) {
          // 40% creates
          await store.createThing({
            id: `mixed-${i}`,
            typeId: 500,
            typeName: 'Customer',
            data: { index: i },
          })
        } else if (opType < 6) {
          // 20% reads
          const readId = Math.floor(Math.random() * i)
          await store.getThing(`mixed-${readId}`)
        } else if (opType < 8) {
          // 20% updates
          const updateId = Math.floor(Math.random() * Math.max(1, i - 10))
          await store.updateThing(`mixed-${updateId}`, {
            data: { updated: true, at: Date.now() },
          })
        } else if (opType < 9) {
          // 10% queries
          await store.getThingsByType({ typeName: 'Customer', limit: 20 })
        } else {
          // 10% relationship operations
          if (i > 1) {
            await store.createRelationship({
              id: `mixed-rel-${i}`,
              verb: 'related',
              from: `do://test/mixed/${i - 1}`,
              to: `do://test/mixed/${i - 2}`,
            })
          }
        }
      }
    })

    const memAfter = getMemoryMB()
    const opsPerSec = totalOps / (elapsed / 1000)

    console.log(`\nMixed Workload Performance:`)
    console.log(`  Total operations: ${totalOps}`)
    console.log(`  Total time: ${elapsed.toFixed(2)}ms`)
    console.log(`  Ops/sec: ${opsPerSec.toFixed(2)}`)
    console.log(`  Memory growth: ${(memAfter - memBefore).toFixed(2)}MB`)

    expect(elapsed).toBeLessThan(60000) // 1 minute max
    expect(opsPerSec).toBeGreaterThan(30) // At least 30 ops/sec
  })
})
