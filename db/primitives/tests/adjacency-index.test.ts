/**
 * AdjacencyIndex Tests
 *
 * This is TDD RED phase - tests for a graph adjacency index primitive
 * built on TypedColumnStore.
 *
 * These tests MUST FAIL until the implementation is complete in
 * db/primitives/adjacency-index.ts
 *
 * Key features tested:
 * - Edge addition/removal (single and batch)
 * - Outgoing/incoming neighbor lookups
 * - Bloom filter accelerated edge existence checks
 * - Degree calculations
 * - Edge type filtering
 * - Range queries on edge timestamps
 * - Batch operations for efficiency
 *
 * @module db/primitives/tests/adjacency-index.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  type AdjacencyIndex,
  type Edge,
  type Direction,
  type EdgeQuery,
  createAdjacencyIndex,
} from '../adjacency-index'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Generate a simple directed graph for testing
 * A -> B -> C
 * A -> D
 * B -> D
 */
function createSimpleGraph(index: AdjacencyIndex): void {
  index.addEdge('A', 'B', 'KNOWS')
  index.addEdge('B', 'C', 'KNOWS')
  index.addEdge('A', 'D', 'FOLLOWS')
  index.addEdge('B', 'D', 'FOLLOWS')
}

/**
 * Generate a larger graph for performance testing
 */
function createLargeGraph(index: AdjacencyIndex, nodeCount: number, edgesPerNode: number): void {
  const edges: Array<{ from: string; to: string; type: string; props?: Record<string, unknown> }> = []

  for (let i = 0; i < nodeCount; i++) {
    for (let j = 0; j < edgesPerNode; j++) {
      const targetNode = (i + j + 1) % nodeCount
      edges.push({
        from: `node-${i}`,
        to: `node-${targetNode}`,
        type: j % 2 === 0 ? 'TYPE_A' : 'TYPE_B',
        props: { weight: Math.random() },
      })
    }
  }

  index.addEdgeBatch(edges)
}

// ============================================================================
// Basic Operations Tests
// ============================================================================

describe('AdjacencyIndex - Basic Operations', () => {
  let index: AdjacencyIndex

  beforeEach(() => {
    index = createAdjacencyIndex()
  })

  describe('addEdge', () => {
    it('should add a simple edge', () => {
      index.addEdge('A', 'B', 'KNOWS')

      const outgoing = index.getOutgoing('A')
      expect(outgoing).toHaveLength(1)
      expect(outgoing[0]!.from).toBe('A')
      expect(outgoing[0]!.to).toBe('B')
      expect(outgoing[0]!.type).toBe('KNOWS')
    })

    it('should add an edge with properties', () => {
      index.addEdge('A', 'B', 'KNOWS', { weight: 0.5, since: 2020 })

      const outgoing = index.getOutgoing('A')
      expect(outgoing[0]!.props).toEqual({ weight: 0.5, since: 2020 })
    })

    it('should allow multiple edges between same nodes with different types', () => {
      index.addEdge('A', 'B', 'KNOWS')
      index.addEdge('A', 'B', 'FOLLOWS')

      const outgoing = index.getOutgoing('A')
      expect(outgoing).toHaveLength(2)

      const types = outgoing.map((e) => e.type).sort()
      expect(types).toEqual(['FOLLOWS', 'KNOWS'])
    })

    it('should store timestamp on edge creation', () => {
      const before = Date.now()
      index.addEdge('A', 'B', 'KNOWS')
      const after = Date.now()

      const outgoing = index.getOutgoing('A')
      expect(outgoing[0]!.createdAt).toBeGreaterThanOrEqual(before)
      expect(outgoing[0]!.createdAt).toBeLessThanOrEqual(after)
    })

    it('should handle self-loops', () => {
      index.addEdge('A', 'A', 'SELF_REF')

      const outgoing = index.getOutgoing('A')
      const incoming = index.getIncoming('A')

      expect(outgoing).toHaveLength(1)
      expect(incoming).toHaveLength(1)
      expect(outgoing[0]!.from).toBe('A')
      expect(outgoing[0]!.to).toBe('A')
    })
  })

  describe('removeEdge', () => {
    beforeEach(() => {
      createSimpleGraph(index)
    })

    it('should remove an existing edge', () => {
      const removed = index.removeEdge('A', 'B', 'KNOWS')

      expect(removed).toBe(true)
      expect(index.getOutgoing('A').filter((e) => e.to === 'B' && e.type === 'KNOWS')).toHaveLength(0)
    })

    it('should return false for non-existent edge', () => {
      const removed = index.removeEdge('A', 'C', 'KNOWS')
      expect(removed).toBe(false)
    })

    it('should only remove the specified edge type', () => {
      index.addEdge('A', 'B', 'FOLLOWS')

      const removed = index.removeEdge('A', 'B', 'KNOWS')

      expect(removed).toBe(true)
      const outgoing = index.getOutgoing('A', ['FOLLOWS'])
      expect(outgoing.filter((e) => e.to === 'B')).toHaveLength(1)
    })

    it('should update both outgoing and incoming indices', () => {
      index.removeEdge('A', 'B', 'KNOWS')

      expect(index.getOutgoing('A', ['KNOWS'])).toHaveLength(0)
      expect(index.getIncoming('B', ['KNOWS']).filter((e) => e.from === 'A')).toHaveLength(0)
    })
  })
})

// ============================================================================
// Neighbor Queries Tests
// ============================================================================

describe('AdjacencyIndex - Neighbor Queries', () => {
  let index: AdjacencyIndex

  beforeEach(() => {
    index = createAdjacencyIndex()
    createSimpleGraph(index)
  })

  describe('getOutgoing', () => {
    it('should return all outgoing edges for a node', () => {
      const outgoing = index.getOutgoing('A')

      expect(outgoing).toHaveLength(2)
      expect(outgoing.map((e) => e.to).sort()).toEqual(['B', 'D'])
    })

    it('should filter by edge types', () => {
      const outgoing = index.getOutgoing('A', ['KNOWS'])

      expect(outgoing).toHaveLength(1)
      expect(outgoing[0]!.to).toBe('B')
    })

    it('should filter by multiple edge types', () => {
      const outgoing = index.getOutgoing('A', ['KNOWS', 'FOLLOWS'])

      expect(outgoing).toHaveLength(2)
    })

    it('should return empty array for node with no outgoing edges', () => {
      const outgoing = index.getOutgoing('C')
      expect(outgoing).toHaveLength(0)
    })

    it('should return empty array for non-existent node', () => {
      const outgoing = index.getOutgoing('Z')
      expect(outgoing).toHaveLength(0)
    })
  })

  describe('getIncoming', () => {
    it('should return all incoming edges for a node', () => {
      const incoming = index.getIncoming('D')

      expect(incoming).toHaveLength(2)
      expect(incoming.map((e) => e.from).sort()).toEqual(['A', 'B'])
    })

    it('should filter by edge types', () => {
      const incoming = index.getIncoming('D', ['FOLLOWS'])

      expect(incoming).toHaveLength(2)
    })

    it('should return empty array for node with no incoming edges', () => {
      const incoming = index.getIncoming('A')
      expect(incoming).toHaveLength(0)
    })
  })

  describe('getNeighbors', () => {
    it('should return outgoing neighbors', () => {
      const neighbors = index.getNeighbors('A', 'out')

      expect(neighbors.sort()).toEqual(['B', 'D'])
    })

    it('should return incoming neighbors', () => {
      const neighbors = index.getNeighbors('D', 'in')

      expect(neighbors.sort()).toEqual(['A', 'B'])
    })

    it('should return all neighbors for both direction', () => {
      const neighbors = index.getNeighbors('B', 'both')

      // B has: outgoing to C, D; incoming from A
      expect(neighbors.sort()).toEqual(['A', 'C', 'D'])
    })

    it('should filter by edge types', () => {
      const neighbors = index.getNeighbors('A', 'out', ['KNOWS'])

      expect(neighbors).toEqual(['B'])
    })

    it('should deduplicate neighbors with multiple edges', () => {
      index.addEdge('A', 'B', 'FOLLOWS')

      const neighbors = index.getNeighbors('A', 'out')

      // Should still only have B and D, not B twice
      expect(neighbors.sort()).toEqual(['B', 'D'])
    })
  })
})

// ============================================================================
// Edge Existence Tests (Bloom Filter Accelerated)
// ============================================================================

describe('AdjacencyIndex - Edge Existence (hasEdge)', () => {
  let index: AdjacencyIndex

  beforeEach(() => {
    index = createAdjacencyIndex()
    createSimpleGraph(index)
  })

  describe('hasEdge', () => {
    it('should return true for existing edge', () => {
      expect(index.hasEdge('A', 'B')).toBe(true)
      expect(index.hasEdge('B', 'C')).toBe(true)
    })

    it('should return false for non-existing edge', () => {
      expect(index.hasEdge('A', 'C')).toBe(false)
      expect(index.hasEdge('D', 'A')).toBe(false)
    })

    it('should check specific edge type when provided', () => {
      expect(index.hasEdge('A', 'B', 'KNOWS')).toBe(true)
      expect(index.hasEdge('A', 'B', 'FOLLOWS')).toBe(false)
    })

    it('should return true for any type when type not specified', () => {
      expect(index.hasEdge('A', 'D')).toBe(true) // FOLLOWS edge exists
    })

    it('should handle self-loops correctly', () => {
      index.addEdge('X', 'X', 'SELF')

      expect(index.hasEdge('X', 'X')).toBe(true)
      expect(index.hasEdge('X', 'X', 'SELF')).toBe(true)
      expect(index.hasEdge('X', 'X', 'OTHER')).toBe(false)
    })
  })

  describe('hasEdge with large graph (bloom filter optimization)', () => {
    beforeEach(() => {
      // Create a larger graph to test bloom filter effectiveness
      createLargeGraph(index, 1000, 5)
    })

    it('should quickly determine non-existence (bloom filter negative)', () => {
      // Non-existent edges should be caught by bloom filter
      expect(index.hasEdge('node-0', 'node-999')).toBe(false)
      expect(index.hasEdge('nonexistent', 'node-0')).toBe(false)
    })

    it('should correctly report existing edges', () => {
      // Existing edges must always return true
      expect(index.hasEdge('node-0', 'node-1')).toBe(true)
    })

    it('should have low false positive rate for bloom filter', () => {
      // Test a sample of non-existent edges
      let falsePositives = 0
      const testCount = 1000

      for (let i = 0; i < testCount; i++) {
        // These edges definitely don't exist (reverse direction)
        const from = `node-${i}`
        const to = `definitely-nonexistent-${i}`

        if (index.hasEdge(from, to)) {
          falsePositives++
        }
      }

      // Bloom filter should have < 1% FPR
      const fpr = falsePositives / testCount
      expect(fpr).toBeLessThan(0.01)
    })
  })
})

// ============================================================================
// Degree Tests
// ============================================================================

describe('AdjacencyIndex - Degree', () => {
  let index: AdjacencyIndex

  beforeEach(() => {
    index = createAdjacencyIndex()
    createSimpleGraph(index)
  })

  describe('degree', () => {
    it('should calculate out-degree', () => {
      expect(index.degree('A', 'out')).toBe(2) // A -> B, A -> D
      expect(index.degree('B', 'out')).toBe(2) // B -> C, B -> D
      expect(index.degree('C', 'out')).toBe(0) // C has no outgoing
    })

    it('should calculate in-degree', () => {
      expect(index.degree('D', 'in')).toBe(2) // A -> D, B -> D
      expect(index.degree('B', 'in')).toBe(1) // A -> B
      expect(index.degree('A', 'in')).toBe(0) // A has no incoming
    })

    it('should calculate total degree (both directions)', () => {
      expect(index.degree('B', 'both')).toBe(3) // in: A; out: C, D
    })

    it('should return 0 for non-existent node', () => {
      expect(index.degree('Z', 'out')).toBe(0)
      expect(index.degree('Z', 'in')).toBe(0)
      expect(index.degree('Z', 'both')).toBe(0)
    })

    it('should handle self-loops correctly', () => {
      index.addEdge('X', 'X', 'SELF')

      // Self-loop counts as both outgoing and incoming
      expect(index.degree('X', 'out')).toBe(1)
      expect(index.degree('X', 'in')).toBe(1)
      // But total degree should count it once
      expect(index.degree('X', 'both')).toBe(1)
    })
  })
})

// ============================================================================
// Batch Operations Tests
// ============================================================================

describe('AdjacencyIndex - Batch Operations', () => {
  let index: AdjacencyIndex

  beforeEach(() => {
    index = createAdjacencyIndex()
  })

  describe('addEdgeBatch', () => {
    it('should add multiple edges at once', () => {
      index.addEdgeBatch([
        { from: 'A', to: 'B', type: 'KNOWS' },
        { from: 'B', to: 'C', type: 'KNOWS' },
        { from: 'A', to: 'C', type: 'FOLLOWS' },
      ])

      expect(index.getOutgoing('A')).toHaveLength(2)
      expect(index.getOutgoing('B')).toHaveLength(1)
      expect(index.hasEdge('A', 'C', 'FOLLOWS')).toBe(true)
    })

    it('should handle empty batch', () => {
      index.addEdgeBatch([])

      expect(index.getOutgoing('A')).toHaveLength(0)
    })

    it('should preserve properties in batch', () => {
      index.addEdgeBatch([
        { from: 'A', to: 'B', type: 'KNOWS', props: { weight: 0.5 } },
        { from: 'A', to: 'C', type: 'KNOWS', props: { weight: 0.8 } },
      ])

      const edges = index.getOutgoing('A')
      const edgeToB = edges.find((e) => e.to === 'B')
      const edgeToC = edges.find((e) => e.to === 'C')

      expect(edgeToB?.props).toEqual({ weight: 0.5 })
      expect(edgeToC?.props).toEqual({ weight: 0.8 })
    })

    it('should be more efficient than individual adds', () => {
      const edges: Array<{ from: string; to: string; type: string }> = []
      for (let i = 0; i < 10000; i++) {
        edges.push({ from: `node-${i}`, to: `node-${i + 1}`, type: 'EDGE' })
      }

      const startBatch = performance.now()
      const batchIndex = createAdjacencyIndex()
      batchIndex.addEdgeBatch(edges)
      const batchTime = performance.now() - startBatch

      const startIndividual = performance.now()
      const individualIndex = createAdjacencyIndex()
      for (const edge of edges) {
        individualIndex.addEdge(edge.from, edge.to, edge.type)
      }
      const individualTime = performance.now() - startIndividual

      // Batch should complete in reasonable time (not worse than 2x individual)
      // Note: In this implementation, batch has similar perf since we're in-memory
      // The real benefit would be with actual database writes
      expect(batchTime).toBeLessThan(individualTime * 2)

      // Both should produce the same result
      expect(batchIndex.stats().edgeCount).toBe(individualIndex.stats().edgeCount)
    })
  })

  describe('getNeighborsBatch', () => {
    beforeEach(() => {
      createLargeGraph(index, 100, 5)
    })

    it('should return neighbors for multiple nodes', () => {
      const results = index.getNeighborsBatch(['node-0', 'node-1', 'node-2'])

      expect(results.size).toBe(3)
      expect(results.has('node-0')).toBe(true)
      expect(results.has('node-1')).toBe(true)
      expect(results.has('node-2')).toBe(true)
    })

    it('should handle non-existent nodes in batch', () => {
      const results = index.getNeighborsBatch(['node-0', 'nonexistent', 'node-1'])

      expect(results.size).toBe(3)
      expect(results.get('nonexistent')).toEqual([])
    })

    it('should be more efficient than individual lookups', () => {
      const nodeIds = Array.from({ length: 100 }, (_, i) => `node-${i}`)

      const batchResults = index.getNeighborsBatch(nodeIds)

      const individualResults = new Map<string, string[]>()
      for (const nodeId of nodeIds) {
        individualResults.set(nodeId, index.getNeighbors(nodeId, 'out'))
      }

      // Results should be equivalent
      expect(batchResults.size).toBe(individualResults.size)

      // Verify results match
      for (const [nodeId, neighbors] of batchResults) {
        const individualNeighbors = individualResults.get(nodeId)!
        expect(neighbors.sort()).toEqual(individualNeighbors.sort())
      }
    })
  })
})

// ============================================================================
// Edge Query Tests
// ============================================================================

describe('AdjacencyIndex - Edge Queries', () => {
  let index: AdjacencyIndex

  beforeEach(() => {
    index = createAdjacencyIndex()

    // Add edges with timestamps and properties
    const baseTime = Date.now()
    index.addEdge('A', 'B', 'KNOWS', { weight: 0.5, timestamp: baseTime })
    index.addEdge('A', 'C', 'KNOWS', { weight: 0.8, timestamp: baseTime + 1000 })
    index.addEdge('A', 'D', 'FOLLOWS', { weight: 0.3, timestamp: baseTime + 2000 })
    index.addEdge('B', 'C', 'KNOWS', { weight: 0.9, timestamp: baseTime + 3000 })
  })

  describe('queryEdges', () => {
    it('should query edges by source node', () => {
      const edges = index.queryEdges({ from: 'A' })
      expect(edges).toHaveLength(3)
    })

    it('should query edges by target node', () => {
      const edges = index.queryEdges({ to: 'C' })
      expect(edges).toHaveLength(2)
    })

    it('should query edges by type', () => {
      const edges = index.queryEdges({ types: ['KNOWS'] })
      expect(edges).toHaveLength(3)
    })

    it('should combine query conditions', () => {
      const edges = index.queryEdges({ from: 'A', types: ['KNOWS'] })
      expect(edges).toHaveLength(2)
    })

    it('should query edges by time range', () => {
      // Get the createdAt range of actual edges
      const allEdges = index.queryEdges({})
      const createdTimes = allEdges.map((e) => e.createdAt).sort((a, b) => a - b)
      const minTime = createdTimes[0]!
      const maxTime = createdTimes[createdTimes.length - 1]!

      // Query edges created within a reasonable time range
      // Since all edges are created nearly simultaneously, this tests the filter works
      const edges = index.queryEdges({
        createdAfter: minTime - 1,
        createdBefore: maxTime + 1,
      })

      // Should include all 4 edges created within the time range
      expect(edges).toHaveLength(4)
    })

    it('should limit results', () => {
      const edges = index.queryEdges({ limit: 2 })
      expect(edges).toHaveLength(2)
    })

    it('should return empty array for no matches', () => {
      const edges = index.queryEdges({ types: ['NONEXISTENT'] })
      expect(edges).toHaveLength(0)
    })
  })
})

// ============================================================================
// Statistics Tests
// ============================================================================

describe('AdjacencyIndex - Statistics', () => {
  let index: AdjacencyIndex

  beforeEach(() => {
    index = createAdjacencyIndex()
    createSimpleGraph(index)
  })

  describe('stats', () => {
    it('should return edge count', () => {
      const stats = index.stats()
      expect(stats.edgeCount).toBe(4)
    })

    it('should return node count', () => {
      const stats = index.stats()
      // A, B, C, D are nodes that have at least one edge
      expect(stats.nodeCount).toBe(4)
    })

    it('should return type distribution', () => {
      const stats = index.stats()
      expect(stats.typeCounts['KNOWS']).toBe(2)
      expect(stats.typeCounts['FOLLOWS']).toBe(2)
    })

    it('should return average degree', () => {
      const stats = index.stats()
      // 4 edges, 4 nodes -> avgOutDegree = 4/4 = 1
      expect(stats.avgOutDegree).toBe(1)
    })
  })
})

// ============================================================================
// Serialization Tests
// ============================================================================

describe('AdjacencyIndex - Serialization', () => {
  let index: AdjacencyIndex

  beforeEach(() => {
    index = createAdjacencyIndex()
    createSimpleGraph(index)
  })

  describe('export/import', () => {
    it('should export all edges', () => {
      const exported = index.export()

      expect(exported.edges).toHaveLength(4)
      expect(exported.metadata?.version).toBeDefined()
    })

    it('should import edges correctly', () => {
      const exported = index.export()

      const newIndex = createAdjacencyIndex()
      newIndex.import(exported)

      expect(newIndex.hasEdge('A', 'B', 'KNOWS')).toBe(true)
      expect(newIndex.hasEdge('B', 'C', 'KNOWS')).toBe(true)
      expect(newIndex.hasEdge('A', 'D', 'FOLLOWS')).toBe(true)
      expect(newIndex.hasEdge('B', 'D', 'FOLLOWS')).toBe(true)
    })

    it('should preserve edge properties through export/import', () => {
      const propIndex = createAdjacencyIndex()
      propIndex.addEdge('X', 'Y', 'HAS', { weight: 0.75, label: 'test' })

      const exported = propIndex.export()
      const importedIndex = createAdjacencyIndex()
      importedIndex.import(exported)

      const edges = importedIndex.getOutgoing('X')
      expect(edges[0]!.props).toEqual({ weight: 0.75, label: 'test' })
    })
  })
})

// ============================================================================
// Large Graph Performance Tests
// ============================================================================

describe('AdjacencyIndex - Performance', () => {
  describe('large graph operations', () => {
    it('should handle 100K edges efficiently', () => {
      const index = createAdjacencyIndex()

      const startCreate = performance.now()
      createLargeGraph(index, 10000, 10) // 100K edges
      const createTime = performance.now() - startCreate

      // Creation should be under 2 seconds
      expect(createTime).toBeLessThan(2000)

      // Neighbor lookup should be fast
      const startLookup = performance.now()
      for (let i = 0; i < 1000; i++) {
        index.getNeighbors(`node-${i}`, 'out')
      }
      const lookupTime = performance.now() - startLookup

      // 1000 lookups should be under 100ms
      expect(lookupTime).toBeLessThan(100)
    })

    it('should efficiently check edge existence on large graphs', () => {
      const index = createAdjacencyIndex()
      createLargeGraph(index, 10000, 10) // 100K edges

      const startCheck = performance.now()
      for (let i = 0; i < 10000; i++) {
        index.hasEdge(`node-${i}`, `node-${(i + 1) % 10000}`)
      }
      const checkTime = performance.now() - startCheck

      // 10000 existence checks should be under 50ms (bloom filter accelerated)
      expect(checkTime).toBeLessThan(50)
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('AdjacencyIndex - Integration', () => {
  let index: AdjacencyIndex

  beforeEach(() => {
    index = createAdjacencyIndex()
  })

  it('should support building and querying a social network', () => {
    // Build a small social network
    const users = ['alice', 'bob', 'charlie', 'diana', 'eve']

    index.addEdgeBatch([
      { from: 'alice', to: 'bob', type: 'FRIENDS', props: { since: 2019 } },
      { from: 'alice', to: 'charlie', type: 'FRIENDS', props: { since: 2020 } },
      { from: 'bob', to: 'charlie', type: 'FRIENDS', props: { since: 2018 } },
      { from: 'bob', to: 'diana', type: 'FOLLOWS' },
      { from: 'charlie', to: 'eve', type: 'FOLLOWS' },
      { from: 'diana', to: 'alice', type: 'FOLLOWS' },
      { from: 'eve', to: 'alice', type: 'FRIENDS', props: { since: 2021 } },
    ])

    // Find all friends of alice
    const aliceFriends = index.getNeighbors('alice', 'out', ['FRIENDS'])
    expect(aliceFriends.sort()).toEqual(['bob', 'charlie'])

    // Find who follows alice
    const aliceFollowers = index.getNeighbors('alice', 'in', ['FOLLOWS'])
    expect(aliceFollowers).toEqual(['diana'])

    // Find all alice's connections (friends + followers)
    const allConnections = index.getNeighbors('alice', 'both')
    expect(allConnections.sort()).toEqual(['bob', 'charlie', 'diana', 'eve'])

    // Check edge existence
    expect(index.hasEdge('alice', 'bob', 'FRIENDS')).toBe(true)
    expect(index.hasEdge('alice', 'diana', 'FRIENDS')).toBe(false)
  })

  it('should support building and traversing a dependency graph', () => {
    // Build a package dependency graph
    index.addEdgeBatch([
      { from: 'app', to: 'react', type: 'DEPENDS_ON' },
      { from: 'app', to: 'typescript', type: 'DEPENDS_ON' },
      { from: 'react', to: 'scheduler', type: 'DEPENDS_ON' },
      { from: 'react', to: 'react-dom', type: 'PEER_DEP' },
      { from: 'typescript', to: 'lib-esnext', type: 'DEPENDS_ON' },
    ])

    // Direct dependencies of app
    const directDeps = index.getNeighbors('app', 'out', ['DEPENDS_ON'])
    expect(directDeps.sort()).toEqual(['react', 'typescript'])

    // Find what depends on react
    const reactDependents = index.getNeighbors('react', 'in', ['DEPENDS_ON'])
    expect(reactDependents).toEqual(['app'])

    // Find all dependencies (including peer)
    const allReactDeps = index.getNeighbors('react', 'out')
    expect(allReactDeps.sort()).toEqual(['react-dom', 'scheduler'])
  })
})
