/**
 * AdjacencyIndex Tests
 *
 * TDD RED phase: Tests for graph adjacency operations on TypedColumnStore.
 *
 * AdjacencyIndex provides efficient graph relationship storage and traversal:
 * - Adjacency list representation for memory efficiency
 * - Edge properties storage via columnar format
 * - BFS/DFS traversal with depth control
 * - Neighbor lookups with direction filtering
 *
 * Key features:
 * - addEdge: Create relationships between nodes with optional properties
 * - removeEdge: Remove relationships
 * - getNeighbors: Get adjacent nodes with direction filtering
 * - traverse: BFS/DFS traversal with depth limits
 * - getEdgeProperties: Retrieve edge metadata
 * - Efficient columnar storage for edge properties
 *
 * @module db/primitives/adjacency-index
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createAdjacencyIndex,
  type AdjacencyIndex,
  type EdgeDirection,
  type TraversalMode,
  type TraversalResult,
  type EdgeProperties,
} from './index'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a simple test graph:
 *    A -> B -> C
 *    |    |
 *    v    v
 *    D <- E
 */
async function createTestGraph(index: AdjacencyIndex): Promise<void> {
  await index.addEdge('A', 'B', { weight: 1, label: 'follows' })
  await index.addEdge('A', 'D', { weight: 2, label: 'likes' })
  await index.addEdge('B', 'C', { weight: 1, label: 'follows' })
  await index.addEdge('B', 'E', { weight: 3, label: 'mentions' })
  await index.addEdge('E', 'D', { weight: 1, label: 'follows' })
}

/**
 * Create a larger graph for traversal tests
 *    1 -> 2 -> 3 -> 4
 *    |    |    |
 *    v    v    v
 *    5 -> 6 -> 7
 */
async function createLayeredGraph(index: AdjacencyIndex): Promise<void> {
  // Layer 1 -> Layer 2
  await index.addEdge('1', '2')
  await index.addEdge('2', '3')
  await index.addEdge('3', '4')

  // Layer 1 -> Layer 3
  await index.addEdge('1', '5')
  await index.addEdge('2', '6')
  await index.addEdge('3', '7')

  // Layer 3 connections
  await index.addEdge('5', '6')
  await index.addEdge('6', '7')
}

// ============================================================================
// EDGE OPERATIONS
// ============================================================================

describe('AdjacencyIndex', () => {
  describe('addEdge', () => {
    it('should add an edge between two nodes', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')

      const neighbors = await index.getNeighbors('A', 'outgoing')
      expect(neighbors).toContain('B')
    })

    it('should add edge with properties', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B', { weight: 5, label: 'friend' })

      const properties = await index.getEdgeProperties('A', 'B')
      expect(properties).toEqual({ weight: 5, label: 'friend' })
    })

    it('should update edge properties if edge already exists', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B', { weight: 1 })
      await index.addEdge('A', 'B', { weight: 10 })

      const properties = await index.getEdgeProperties('A', 'B')
      expect(properties?.weight).toBe(10)
    })

    it('should support self-loops', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'A', { label: 'self-reference' })

      const outgoing = await index.getNeighbors('A', 'outgoing')
      const incoming = await index.getNeighbors('A', 'incoming')

      expect(outgoing).toContain('A')
      expect(incoming).toContain('A')
    })

    it('should create nodes implicitly when adding edges', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('NewNode1', 'NewNode2')

      expect(await index.hasNode('NewNode1')).toBe(true)
      expect(await index.hasNode('NewNode2')).toBe(true)
    })

    it('should handle multiple edges from same source', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')
      await index.addEdge('A', 'C')
      await index.addEdge('A', 'D')

      const neighbors = await index.getNeighbors('A', 'outgoing')
      expect(neighbors).toHaveLength(3)
      expect(neighbors).toContain('B')
      expect(neighbors).toContain('C')
      expect(neighbors).toContain('D')
    })

    it('should handle multiple edges to same target', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'D')
      await index.addEdge('B', 'D')
      await index.addEdge('C', 'D')

      const incoming = await index.getNeighbors('D', 'incoming')
      expect(incoming).toHaveLength(3)
      expect(incoming).toContain('A')
      expect(incoming).toContain('B')
      expect(incoming).toContain('C')
    })
  })

  describe('removeEdge', () => {
    it('should remove an existing edge', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')
      const removed = await index.removeEdge('A', 'B')

      expect(removed).toBe(true)
      const neighbors = await index.getNeighbors('A', 'outgoing')
      expect(neighbors).not.toContain('B')
    })

    it('should return false when removing non-existent edge', async () => {
      const index = createAdjacencyIndex()

      const removed = await index.removeEdge('A', 'B')

      expect(removed).toBe(false)
    })

    it('should not affect other edges from the same node', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')
      await index.addEdge('A', 'C')
      await index.removeEdge('A', 'B')

      const neighbors = await index.getNeighbors('A', 'outgoing')
      expect(neighbors).not.toContain('B')
      expect(neighbors).toContain('C')
    })

    it('should remove edge properties when edge is removed', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B', { weight: 5 })
      await index.removeEdge('A', 'B')

      const properties = await index.getEdgeProperties('A', 'B')
      expect(properties).toBeNull()
    })
  })

  describe('hasEdge', () => {
    it('should return true for existing edge', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')

      expect(await index.hasEdge('A', 'B')).toBe(true)
    })

    it('should return false for non-existent edge', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')

      expect(await index.hasEdge('B', 'A')).toBe(false) // Direction matters
      expect(await index.hasEdge('A', 'C')).toBe(false)
    })

    it('should return false for edge after removal', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')
      await index.removeEdge('A', 'B')

      expect(await index.hasEdge('A', 'B')).toBe(false)
    })
  })

  // ============================================================================
  // NEIGHBOR QUERIES
  // ============================================================================

  describe('getNeighbors', () => {
    it('should return outgoing neighbors', async () => {
      const index = createAdjacencyIndex()
      await createTestGraph(index)

      const neighbors = await index.getNeighbors('A', 'outgoing')

      expect(neighbors).toHaveLength(2)
      expect(neighbors).toContain('B')
      expect(neighbors).toContain('D')
    })

    it('should return incoming neighbors', async () => {
      const index = createAdjacencyIndex()
      await createTestGraph(index)

      const neighbors = await index.getNeighbors('D', 'incoming')

      expect(neighbors).toHaveLength(2)
      expect(neighbors).toContain('A')
      expect(neighbors).toContain('E')
    })

    it('should return both directions when direction is "both"', async () => {
      const index = createAdjacencyIndex()
      await createTestGraph(index)

      const neighbors = await index.getNeighbors('B', 'both')

      // Outgoing: C, E
      // Incoming: A
      expect(neighbors).toHaveLength(3)
      expect(neighbors).toContain('A')
      expect(neighbors).toContain('C')
      expect(neighbors).toContain('E')
    })

    it('should return empty array for node with no neighbors', async () => {
      const index = createAdjacencyIndex()
      await createTestGraph(index)

      const neighbors = await index.getNeighbors('C', 'outgoing')

      expect(neighbors).toEqual([])
    })

    it('should return empty array for non-existent node', async () => {
      const index = createAdjacencyIndex()

      const neighbors = await index.getNeighbors('NonExistent', 'outgoing')

      expect(neighbors).toEqual([])
    })

    it('should deduplicate when node has both incoming and outgoing to same neighbor', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')
      await index.addEdge('B', 'A')

      const neighbors = await index.getNeighbors('A', 'both')

      expect(neighbors).toHaveLength(1)
      expect(neighbors).toContain('B')
    })
  })

  describe('getOutDegree / getInDegree', () => {
    it('should return correct out-degree', async () => {
      const index = createAdjacencyIndex()
      await createTestGraph(index)

      expect(await index.getOutDegree('A')).toBe(2) // A -> B, A -> D
      expect(await index.getOutDegree('B')).toBe(2) // B -> C, B -> E
      expect(await index.getOutDegree('C')).toBe(0) // C has no outgoing
    })

    it('should return correct in-degree', async () => {
      const index = createAdjacencyIndex()
      await createTestGraph(index)

      expect(await index.getInDegree('D')).toBe(2) // A -> D, E -> D
      expect(await index.getInDegree('B')).toBe(1) // A -> B
      expect(await index.getInDegree('A')).toBe(0) // A has no incoming
    })

    it('should return 0 for non-existent node', async () => {
      const index = createAdjacencyIndex()

      expect(await index.getOutDegree('NonExistent')).toBe(0)
      expect(await index.getInDegree('NonExistent')).toBe(0)
    })
  })

  // ============================================================================
  // TRAVERSAL OPERATIONS
  // ============================================================================

  describe('traverse - BFS', () => {
    it('should traverse in BFS order', async () => {
      const index = createAdjacencyIndex()
      await createLayeredGraph(index)

      const result = await index.traverse('1', { mode: 'bfs', maxDepth: 2 })

      // BFS from 1: first visit 2, 5 (depth 1), then 3, 6 (depth 2)
      expect(result.visited).toContain('1')
      expect(result.visited).toContain('2')
      expect(result.visited).toContain('5')
      expect(result.visited).toContain('3')
      expect(result.visited).toContain('6')
    })

    it('should respect maxDepth limit', async () => {
      const index = createAdjacencyIndex()
      await createLayeredGraph(index)

      const result = await index.traverse('1', { mode: 'bfs', maxDepth: 1 })

      expect(result.visited).toContain('1')
      expect(result.visited).toContain('2')
      expect(result.visited).toContain('5')
      expect(result.visited).not.toContain('3') // Depth 2
      expect(result.visited).not.toContain('4') // Depth 3
    })

    it('should include depth information for each node', async () => {
      const index = createAdjacencyIndex()
      await createLayeredGraph(index)

      const result = await index.traverse('1', { mode: 'bfs', maxDepth: 3 })

      expect(result.depths.get('1')).toBe(0)
      expect(result.depths.get('2')).toBe(1)
      expect(result.depths.get('5')).toBe(1)
      expect(result.depths.get('3')).toBe(2)
    })

    it('should handle cycles without infinite loop', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')
      await index.addEdge('B', 'C')
      await index.addEdge('C', 'A') // Cycle back to A

      const result = await index.traverse('A', { mode: 'bfs', maxDepth: 10 })

      // Should visit each node exactly once
      expect(result.visited).toHaveLength(3)
      expect(result.visited).toContain('A')
      expect(result.visited).toContain('B')
      expect(result.visited).toContain('C')
    })

    it('should return only start node when maxDepth is 0', async () => {
      const index = createAdjacencyIndex()
      await createTestGraph(index)

      const result = await index.traverse('A', { mode: 'bfs', maxDepth: 0 })

      expect(result.visited).toEqual(['A'])
    })

    it('should return empty result for non-existent start node', async () => {
      const index = createAdjacencyIndex()

      const result = await index.traverse('NonExistent', { mode: 'bfs', maxDepth: 5 })

      expect(result.visited).toEqual([])
    })
  })

  describe('traverse - DFS', () => {
    it('should traverse in DFS order', async () => {
      const index = createAdjacencyIndex()

      // Simple linear graph: A -> B -> C -> D
      await index.addEdge('A', 'B')
      await index.addEdge('B', 'C')
      await index.addEdge('C', 'D')

      const result = await index.traverse('A', { mode: 'dfs', maxDepth: 10 })

      // DFS should go deep first
      expect(result.visited[0]).toBe('A')
      expect(result.visited).toContain('B')
      expect(result.visited).toContain('C')
      expect(result.visited).toContain('D')
    })

    it('should respect maxDepth in DFS', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')
      await index.addEdge('B', 'C')
      await index.addEdge('C', 'D')
      await index.addEdge('D', 'E')

      const result = await index.traverse('A', { mode: 'dfs', maxDepth: 2 })

      expect(result.visited).toContain('A')
      expect(result.visited).toContain('B')
      expect(result.visited).toContain('C')
      expect(result.visited).not.toContain('D') // Depth 3
    })

    it('should handle trees correctly in DFS', async () => {
      const index = createAdjacencyIndex()

      //       A
      //      / \
      //     B   C
      //    / \
      //   D   E
      await index.addEdge('A', 'B')
      await index.addEdge('A', 'C')
      await index.addEdge('B', 'D')
      await index.addEdge('B', 'E')

      const result = await index.traverse('A', { mode: 'dfs', maxDepth: 10 })

      expect(result.visited).toHaveLength(5)
      expect(result.visited[0]).toBe('A')
    })
  })

  describe('traverse - direction filtering', () => {
    it('should traverse only outgoing edges by default', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')
      await index.addEdge('C', 'A') // Incoming to A

      const result = await index.traverse('A', { mode: 'bfs', maxDepth: 2 })

      expect(result.visited).toContain('A')
      expect(result.visited).toContain('B')
      expect(result.visited).not.toContain('C')
    })

    it('should traverse incoming edges when direction is "incoming"', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('B', 'A')
      await index.addEdge('C', 'B')

      const result = await index.traverse('A', {
        mode: 'bfs',
        maxDepth: 2,
        direction: 'incoming',
      })

      expect(result.visited).toContain('A')
      expect(result.visited).toContain('B')
      expect(result.visited).toContain('C')
    })

    it('should traverse both directions when specified', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')
      await index.addEdge('C', 'A')

      const result = await index.traverse('A', {
        mode: 'bfs',
        maxDepth: 1,
        direction: 'both',
      })

      expect(result.visited).toContain('A')
      expect(result.visited).toContain('B')
      expect(result.visited).toContain('C')
    })
  })

  // ============================================================================
  // EDGE PROPERTIES
  // ============================================================================

  describe('getEdgeProperties', () => {
    it('should return edge properties', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B', { weight: 5, type: 'friend', active: true })

      const props = await index.getEdgeProperties('A', 'B')

      expect(props).toEqual({ weight: 5, type: 'friend', active: true })
    })

    it('should return null for edge without properties', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')

      const props = await index.getEdgeProperties('A', 'B')

      expect(props).toBeNull()
    })

    it('should return null for non-existent edge', async () => {
      const index = createAdjacencyIndex()

      const props = await index.getEdgeProperties('A', 'B')

      expect(props).toBeNull()
    })

    it('should handle complex property values', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B', {
        metadata: { created: '2024-01-01', author: 'system' },
        tags: ['important', 'reviewed'],
        score: 0.95,
      })

      const props = await index.getEdgeProperties('A', 'B')

      expect(props?.metadata).toEqual({ created: '2024-01-01', author: 'system' })
      expect(props?.tags).toEqual(['important', 'reviewed'])
      expect(props?.score).toBe(0.95)
    })
  })

  describe('setEdgeProperties', () => {
    it('should update existing edge properties', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B', { weight: 1 })
      await index.setEdgeProperties('A', 'B', { weight: 10, label: 'updated' })

      const props = await index.getEdgeProperties('A', 'B')
      expect(props).toEqual({ weight: 10, label: 'updated' })
    })

    it('should return false for non-existent edge', async () => {
      const index = createAdjacencyIndex()

      const result = await index.setEdgeProperties('A', 'B', { weight: 5 })

      expect(result).toBe(false)
    })

    it('should add properties to edge that had none', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')
      await index.setEdgeProperties('A', 'B', { weight: 5 })

      const props = await index.getEdgeProperties('A', 'B')
      expect(props).toEqual({ weight: 5 })
    })
  })

  // ============================================================================
  // STATISTICS AND METADATA
  // ============================================================================

  describe('statistics', () => {
    it('should return node count', async () => {
      const index = createAdjacencyIndex()
      await createTestGraph(index)

      expect(await index.getNodeCount()).toBe(5) // A, B, C, D, E
    })

    it('should return edge count', async () => {
      const index = createAdjacencyIndex()
      await createTestGraph(index)

      expect(await index.getEdgeCount()).toBe(5)
    })

    it('should return 0 for empty index', async () => {
      const index = createAdjacencyIndex()

      expect(await index.getNodeCount()).toBe(0)
      expect(await index.getEdgeCount()).toBe(0)
    })

    it('should update counts after edge removal', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')
      await index.addEdge('A', 'C')
      expect(await index.getEdgeCount()).toBe(2)

      await index.removeEdge('A', 'B')
      expect(await index.getEdgeCount()).toBe(1)
    })
  })

  describe('getAllNodes', () => {
    it('should return all nodes in the graph', async () => {
      const index = createAdjacencyIndex()
      await createTestGraph(index)

      const nodes = await index.getAllNodes()

      expect(nodes).toHaveLength(5)
      expect(nodes).toContain('A')
      expect(nodes).toContain('B')
      expect(nodes).toContain('C')
      expect(nodes).toContain('D')
      expect(nodes).toContain('E')
    })

    it('should return empty array for empty index', async () => {
      const index = createAdjacencyIndex()

      const nodes = await index.getAllNodes()

      expect(nodes).toEqual([])
    })
  })

  describe('getAllEdges', () => {
    it('should return all edges as [from, to] pairs', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')
      await index.addEdge('B', 'C')

      const edges = await index.getAllEdges()

      expect(edges).toHaveLength(2)
      expect(edges).toContainEqual(['A', 'B'])
      expect(edges).toContainEqual(['B', 'C'])
    })
  })

  // ============================================================================
  // CLEAR AND REMOVAL
  // ============================================================================

  describe('removeNode', () => {
    it('should remove node and all its edges', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')
      await index.addEdge('A', 'C')
      await index.addEdge('D', 'A')

      await index.removeNode('A')

      expect(await index.hasNode('A')).toBe(false)
      expect(await index.hasEdge('A', 'B')).toBe(false)
      expect(await index.hasEdge('A', 'C')).toBe(false)
      expect(await index.hasEdge('D', 'A')).toBe(false)
    })

    it('should not affect other nodes', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B')
      await index.addEdge('B', 'C')

      await index.removeNode('A')

      expect(await index.hasNode('B')).toBe(true)
      expect(await index.hasNode('C')).toBe(true)
      expect(await index.hasEdge('B', 'C')).toBe(true)
    })

    it('should return false for non-existent node', async () => {
      const index = createAdjacencyIndex()

      const result = await index.removeNode('NonExistent')

      expect(result).toBe(false)
    })
  })

  describe('clear', () => {
    it('should remove all nodes and edges', async () => {
      const index = createAdjacencyIndex()
      await createTestGraph(index)

      await index.clear()

      expect(await index.getNodeCount()).toBe(0)
      expect(await index.getEdgeCount()).toBe(0)
    })
  })

  // ============================================================================
  // LARGE GRAPH HANDLING
  // ============================================================================

  describe('large graph operations', () => {
    it('should handle 10K nodes efficiently', async () => {
      const index = createAdjacencyIndex()

      // Create a chain of 10K nodes
      for (let i = 0; i < 10000; i++) {
        await index.addEdge(`node-${i}`, `node-${i + 1}`)
      }

      expect(await index.getNodeCount()).toBe(10001)
      expect(await index.getEdgeCount()).toBe(10000)
    })

    it('should handle high-degree nodes', async () => {
      const index = createAdjacencyIndex()

      // Create a hub with 1000 spokes
      for (let i = 0; i < 1000; i++) {
        await index.addEdge('hub', `spoke-${i}`)
      }

      const neighbors = await index.getNeighbors('hub', 'outgoing')
      expect(neighbors).toHaveLength(1000)
    })

    it('should traverse large graph with depth limit efficiently', async () => {
      const index = createAdjacencyIndex()

      // Create a binary tree of depth 10 (~2000 nodes)
      const queue = ['root']
      let nodeCount = 0

      while (queue.length > 0 && nodeCount < 1000) {
        const node = queue.shift()!
        const left = `${node}-L`
        const right = `${node}-R`

        await index.addEdge(node, left)
        await index.addEdge(node, right)
        queue.push(left, right)
        nodeCount += 2
      }

      // Traverse with limited depth should complete quickly
      const result = await index.traverse('root', { mode: 'bfs', maxDepth: 5 })

      expect(result.visited.length).toBeGreaterThan(0)
      expect(result.visited.length).toBeLessThan(100) // Limited by depth
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty string node IDs', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('', 'B')

      expect(await index.hasNode('')).toBe(true)
      expect(await index.hasEdge('', 'B')).toBe(true)
    })

    it('should handle special characters in node IDs', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('node:1', 'node:2')
      await index.addEdge('path/to/node', 'another/path')

      expect(await index.hasEdge('node:1', 'node:2')).toBe(true)
      expect(await index.hasEdge('path/to/node', 'another/path')).toBe(true)
    })

    it('should handle numeric-like node IDs', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('123', '456')
      await index.addEdge('0', '-1')

      expect(await index.hasEdge('123', '456')).toBe(true)
      expect(await index.hasEdge('0', '-1')).toBe(true)
    })

    it('should handle very long node IDs', async () => {
      const index = createAdjacencyIndex()
      const longId = 'a'.repeat(10000)

      await index.addEdge(longId, 'B')

      expect(await index.hasNode(longId)).toBe(true)
    })
  })

  // ============================================================================
  // SERIALIZATION
  // ============================================================================

  describe('toJSON / fromJSON', () => {
    it('should serialize graph to JSON', async () => {
      const index = createAdjacencyIndex()

      await index.addEdge('A', 'B', { weight: 1 })
      await index.addEdge('B', 'C', { weight: 2 })

      const json = await index.toJSON()

      expect(json).toBeDefined()
      expect(typeof json).toBe('string')
    })

    it('should deserialize graph from JSON', async () => {
      const index1 = createAdjacencyIndex()

      await index1.addEdge('A', 'B', { weight: 1 })
      await index1.addEdge('B', 'C', { weight: 2 })

      const json = await index1.toJSON()

      const index2 = createAdjacencyIndex()
      await index2.fromJSON(json)

      expect(await index2.hasEdge('A', 'B')).toBe(true)
      expect(await index2.hasEdge('B', 'C')).toBe(true)
      expect(await index2.getEdgeProperties('A', 'B')).toEqual({ weight: 1 })
    })

    it('should handle empty graph serialization', async () => {
      const index1 = createAdjacencyIndex()
      const json = await index1.toJSON()

      const index2 = createAdjacencyIndex()
      await index2.fromJSON(json)

      expect(await index2.getNodeCount()).toBe(0)
      expect(await index2.getEdgeCount()).toBe(0)
    })
  })
})
