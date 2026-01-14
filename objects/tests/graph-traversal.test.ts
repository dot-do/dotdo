/**
 * Graph Traversal Tests
 *
 * TDD RED Phase: Comprehensive tests for graph traversal algorithms.
 *
 * Tests verify:
 * 1. BFS traversal correctness
 * 2. DFS traversal with cycle detection
 * 3. Dijkstra's shortest path
 * 4. PageRank computation
 * 5. Graph mutations during traversal
 * 6. Large graph performance (1000+ nodes)
 * 7. Disconnected components handling
 *
 * Implementation: db/graph/graph-engine.ts
 *
 * These tests use the GraphEngine directly in Node environment.
 * For DO integration, see do-rpc.test.ts patterns.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GraphEngine, type Node, type TraversalResult, type PathResult } from '../../db/graph/graph-engine'

describe('Graph Traversal', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  // ==========================================================================
  // BFS TRAVERSAL CORRECTNESS
  // ==========================================================================

  describe('BFS Traversal', () => {
    it('traverses nodes in breadth-first order', async () => {
      // Create a simple tree: A -> B, A -> C, B -> D, C -> E
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })
      const d = await graph.createNode('Node', { name: 'D' })
      const e = await graph.createNode('Node', { name: 'E' })

      await graph.createEdge(a.id, 'CONNECTS', b.id)
      await graph.createEdge(a.id, 'CONNECTS', c.id)
      await graph.createEdge(b.id, 'CONNECTS', d.id)
      await graph.createEdge(c.id, 'CONNECTS', e.id)

      const result = await graph.traverse({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 3,
      })

      // BFS should visit B and C (depth 1) before D and E (depth 2)
      expect(result.nodes).toHaveLength(4)

      // Verify depths
      expect(result.depths?.get(b.id)).toBe(1)
      expect(result.depths?.get(c.id)).toBe(1)
      expect(result.depths?.get(d.id)).toBe(2)
      expect(result.depths?.get(e.id)).toBe(2)
    })

    it('respects maxDepth limit', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })
      const d = await graph.createNode('Node', { name: 'D' })

      await graph.createEdge(a.id, 'CONNECTS', b.id)
      await graph.createEdge(b.id, 'CONNECTS', c.id)
      await graph.createEdge(c.id, 'CONNECTS', d.id)

      const result = await graph.traverse({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 2,
      })

      // Should only traverse to depth 2 (B and C), not D
      expect(result.nodes).toHaveLength(2)
      expect(result.nodes.map(n => n.properties.name)).toContain('B')
      expect(result.nodes.map(n => n.properties.name)).toContain('C')
      expect(result.nodes.map(n => n.properties.name)).not.toContain('D')
    })

    it('handles bidirectional traversal', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })

      await graph.createEdge(a.id, 'CONNECTS', b.id)
      await graph.createEdge(c.id, 'CONNECTS', b.id)

      const result = await graph.traverse({
        start: b.id,
        direction: 'BOTH',
        maxDepth: 1,
      })

      // From B, should find both A (incoming) and reach via the bidirectional
      expect(result.nodes.length).toBeGreaterThanOrEqual(1)
    })

    it('filters edges by type', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })

      await graph.createEdge(a.id, 'FRIEND', b.id)
      await graph.createEdge(a.id, 'ENEMY', c.id)

      const result = await graph.traverse({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 1,
        filter: { type: 'FRIEND' },
      })

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0]?.properties.name).toBe('B')
    })

    it('returns empty result for non-existent start node', async () => {
      await expect(
        graph.traverse({
          start: 'non-existent',
          direction: 'OUTGOING',
          maxDepth: 1,
        })
      ).rejects.toThrow()
    })
  })

  // ==========================================================================
  // DFS TRAVERSAL WITH CYCLE DETECTION
  // ==========================================================================

  describe('DFS Traversal', () => {
    it('traverses nodes in depth-first order', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })
      const d = await graph.createNode('Node', { name: 'D' })

      // A -> B -> D
      // A -> C
      await graph.createEdge(a.id, 'CONNECTS', b.id)
      await graph.createEdge(b.id, 'CONNECTS', d.id)
      await graph.createEdge(a.id, 'CONNECTS', c.id)

      const result = await graph.traverseDFS({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 3,
      })

      expect(result.nodes).toHaveLength(3)
      expect(result.visitOrder).toBeDefined()
      // DFS should include visit order
      expect(result.visitOrder!.length).toBeGreaterThan(0)
    })

    it('detects and handles cycles without infinite loop', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })

      // Create a cycle: A -> B -> C -> A
      await graph.createEdge(a.id, 'CONNECTS', b.id)
      await graph.createEdge(b.id, 'CONNECTS', c.id)
      await graph.createEdge(c.id, 'CONNECTS', a.id)

      const result = await graph.traverseDFS({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 10,
      })

      // Should visit each node exactly once (no infinite loop)
      expect(result.nodes).toHaveLength(2) // B and C (A is start, not counted)

      // Verify no duplicate visits
      const visitedIds = result.nodes.map(n => n.id)
      expect(new Set(visitedIds).size).toBe(visitedIds.length)
    })

    it('reports cycles via hasCycles method', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })

      await graph.createEdge(a.id, 'CONNECTS', b.id)
      await graph.createEdge(b.id, 'CONNECTS', c.id)
      await graph.createEdge(c.id, 'CONNECTS', a.id)

      const hasCycle = await graph.hasCycles()
      expect(hasCycle).toBe(true)
    })

    it('correctly identifies acyclic graphs', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })

      await graph.createEdge(a.id, 'CONNECTS', b.id)
      await graph.createEdge(a.id, 'CONNECTS', c.id)

      const hasCycle = await graph.hasCycles()
      expect(hasCycle).toBe(false)
    })

    it('returns visit order for DFS traversal', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })

      await graph.createEdge(a.id, 'CONNECTS', b.id)
      await graph.createEdge(a.id, 'CONNECTS', c.id)

      const result = await graph.traverseDFS({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 2,
      })

      expect(result.visitOrder).toBeDefined()
      expect(result.visitOrder![0]).toBe(a.id) // Start node visited first
    })
  })

  // ==========================================================================
  // DIJKSTRA'S SHORTEST PATH
  // ==========================================================================

  describe("Dijkstra's Algorithm", () => {
    it('finds shortest weighted path', async () => {
      const a = await graph.createNode('City', { name: 'A' })
      const b = await graph.createNode('City', { name: 'B' })
      const c = await graph.createNode('City', { name: 'C' })

      // A -> B (weight 5)
      // A -> C (weight 2)
      // C -> B (weight 1)
      // Shortest path A -> B should be A -> C -> B (weight 3)
      await graph.createEdge(a.id, 'ROAD', b.id, { weight: 5 })
      await graph.createEdge(a.id, 'ROAD', c.id, { weight: 2 })
      await graph.createEdge(c.id, 'ROAD', b.id, { weight: 1 })

      const result = await graph.dijkstra(a.id, b.id)

      expect(result).not.toBeNull()
      expect(result!.weight).toBe(3)
      expect(result!.path.nodes).toHaveLength(3)
      expect(result!.path.nodes[0]?.id).toBe(a.id)
      expect(result!.path.nodes[1]?.id).toBe(c.id)
      expect(result!.path.nodes[2]?.id).toBe(b.id)
    })

    it('uses default weight of 1 for edges without weight', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })

      await graph.createEdge(a.id, 'CONNECTS', b.id) // No weight specified

      const result = await graph.dijkstra(a.id, b.id)

      expect(result).not.toBeNull()
      expect(result!.weight).toBe(1)
    })

    it('respects custom weight property', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })

      await graph.createEdge(a.id, 'CONNECTS', b.id, { distance: 10 })

      const result = await graph.dijkstra(a.id, b.id, { weightProperty: 'distance' })

      expect(result).not.toBeNull()
      expect(result!.weight).toBe(10)
    })

    it('returns null when no path exists', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })

      // No edge between A and B

      const result = await graph.dijkstra(a.id, b.id)

      expect(result).toBeNull()
    })

    it('handles same source and destination', async () => {
      const a = await graph.createNode('Node', { name: 'A' })

      const result = await graph.dijkstra(a.id, a.id)

      expect(result).not.toBeNull()
      expect(result!.weight).toBe(0)
      expect(result!.path.nodes).toHaveLength(1)
    })

    it('respects maxWeight constraint', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })

      await graph.createEdge(a.id, 'CONNECTS', b.id, { weight: 100 })

      const result = await graph.dijkstra(a.id, b.id, { maxWeight: 50 })

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // PAGERANK COMPUTATION
  // ==========================================================================

  describe('PageRank', () => {
    it('computes PageRank for simple graph', async () => {
      const a = await graph.createNode('Page', { name: 'A' })
      const b = await graph.createNode('Page', { name: 'B' })
      const c = await graph.createNode('Page', { name: 'C' })

      // A -> B, A -> C
      // B -> C
      await graph.createEdge(a.id, 'LINKS', b.id)
      await graph.createEdge(a.id, 'LINKS', c.id)
      await graph.createEdge(b.id, 'LINKS', c.id)

      const ranks = await graph.pageRank()

      expect(ranks.size).toBe(3)
      // C should have highest rank (receives most links)
      expect(ranks.get(c.id)).toBeGreaterThan(ranks.get(a.id)!)
    })

    it('handles isolated nodes', async () => {
      const a = await graph.createNode('Page', { name: 'A' })
      const b = await graph.createNode('Page', { name: 'B' })
      const isolated = await graph.createNode('Page', { name: 'Isolated' })

      await graph.createEdge(a.id, 'LINKS', b.id)

      const ranks = await graph.pageRank()

      expect(ranks.size).toBe(3)
      expect(ranks.has(isolated.id)).toBe(true)
    })

    it('respects damping factor', async () => {
      const a = await graph.createNode('Page', { name: 'A' })
      const b = await graph.createNode('Page', { name: 'B' })

      await graph.createEdge(a.id, 'LINKS', b.id)

      const ranksDefault = await graph.pageRank({ dampingFactor: 0.85 })
      const ranksLow = await graph.pageRank({ dampingFactor: 0.5 })

      // Different damping factors should produce different results
      expect(ranksDefault.get(b.id)).not.toBe(ranksLow.get(b.id))
    })

    it('converges within max iterations', async () => {
      const nodes: Node[] = []
      for (let i = 0; i < 10; i++) {
        nodes.push(await graph.createNode('Page', { name: `Node${i}` }))
      }

      // Create a fully connected graph
      for (let i = 0; i < nodes.length; i++) {
        for (let j = 0; j < nodes.length; j++) {
          if (i !== j) {
            await graph.createEdge(nodes[i]!.id, 'LINKS', nodes[j]!.id)
          }
        }
      }

      const ranks = await graph.pageRank({ maxIterations: 100, tolerance: 1e-6 })

      expect(ranks.size).toBe(10)
      // In a complete graph, all nodes should have similar PageRank
      const values = Array.from(ranks.values())
      const avg = values.reduce((a, b) => a + b, 0) / values.length
      for (const value of values) {
        expect(Math.abs(value - avg)).toBeLessThan(0.1)
      }
    })

    it('returns empty map for empty graph', async () => {
      const ranks = await graph.pageRank()
      expect(ranks.size).toBe(0)
    })
  })

  // ==========================================================================
  // GRAPH MUTATIONS DURING TRAVERSAL
  // ==========================================================================

  describe('Graph Mutations During Traversal', () => {
    it('handles node deletion during iteration gracefully', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })

      await graph.createEdge(a.id, 'CONNECTS', b.id)
      await graph.createEdge(b.id, 'CONNECTS', c.id)

      // Start traversal
      const result = await graph.traverse({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 3,
      })

      expect(result.nodes).toHaveLength(2)

      // Now delete a node and verify graph consistency
      await graph.deleteNode(b.id)

      const stats = await graph.stats()
      expect(stats.nodeCount).toBe(2) // A and C remain
    })

    it('handles edge deletion during traversal gracefully', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })

      const edge1 = await graph.createEdge(a.id, 'CONNECTS', b.id)
      await graph.createEdge(b.id, 'CONNECTS', c.id)

      // Delete the first edge
      await graph.deleteEdge(edge1.id)

      // Traverse - should not reach B or C from A anymore
      const result = await graph.traverse({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 3,
      })

      expect(result.nodes).toHaveLength(0)
    })

    it('correctly updates after node addition during session', async () => {
      const a = await graph.createNode('Node', { name: 'A' })

      // First traversal
      let result = await graph.traverse({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 3,
      })
      expect(result.nodes).toHaveLength(0)

      // Add new node and edge
      const b = await graph.createNode('Node', { name: 'B' })
      await graph.createEdge(a.id, 'CONNECTS', b.id)

      // Second traversal should include new node
      result = await graph.traverse({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 3,
      })
      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0]?.id).toBe(b.id)
    })
  })

  // ==========================================================================
  // LARGE GRAPH PERFORMANCE (1000+ nodes)
  // ==========================================================================

  describe('Large Graph Performance', () => {
    it('traverses 1000+ node graph efficiently', async () => {
      const nodeCount = 1000
      const nodes: Node[] = []

      // Create nodes
      for (let i = 0; i < nodeCount; i++) {
        nodes.push(await graph.createNode('Node', { index: i }))
      }

      // Create a chain: 0 -> 1 -> 2 -> ... -> 999
      for (let i = 0; i < nodeCount - 1; i++) {
        await graph.createEdge(nodes[i]!.id, 'NEXT', nodes[i + 1]!.id)
      }

      const startTime = Date.now()
      const result = await graph.traverse({
        start: nodes[0]!.id,
        direction: 'OUTGOING',
        maxDepth: nodeCount,
      })
      const elapsed = Date.now() - startTime

      expect(result.nodes.length).toBe(nodeCount - 1)
      // Should complete in reasonable time (less than 5 seconds)
      expect(elapsed).toBeLessThan(5000)
    })

    it('computes PageRank on large graph within time limit', async () => {
      const nodeCount = 500
      const nodes: Node[] = []

      for (let i = 0; i < nodeCount; i++) {
        nodes.push(await graph.createNode('Page', { index: i }))
      }

      // Create random edges (simulate web links)
      for (let i = 0; i < nodeCount; i++) {
        const edgeCount = Math.min(5, nodeCount - i - 1)
        for (let j = 0; j < edgeCount; j++) {
          const targetIndex = (i + j + 1) % nodeCount
          await graph.createEdge(nodes[i]!.id, 'LINKS', nodes[targetIndex]!.id)
        }
      }

      const startTime = Date.now()
      const ranks = await graph.pageRank({ maxIterations: 50 })
      const elapsed = Date.now() - startTime

      expect(ranks.size).toBe(nodeCount)
      expect(elapsed).toBeLessThan(10000) // Should complete in 10 seconds
    })

    it('finds shortest path in large graph efficiently', async () => {
      const nodeCount = 1000
      const nodes: Node[] = []

      for (let i = 0; i < nodeCount; i++) {
        nodes.push(await graph.createNode('Node', { index: i }))
      }

      // Create a chain with weights
      for (let i = 0; i < nodeCount - 1; i++) {
        await graph.createEdge(nodes[i]!.id, 'NEXT', nodes[i + 1]!.id, { weight: 1 })
      }

      const startTime = Date.now()
      const result = await graph.dijkstra(nodes[0]!.id, nodes[999]!.id)
      const elapsed = Date.now() - startTime

      expect(result).not.toBeNull()
      expect(result!.weight).toBe(999)
      expect(elapsed).toBeLessThan(5000)
    })
  })

  // ==========================================================================
  // DISCONNECTED COMPONENTS HANDLING
  // ==========================================================================

  describe('Disconnected Components', () => {
    it('identifies all connected components', async () => {
      // Component 1: A - B
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      await graph.createEdge(a.id, 'CONNECTS', b.id)

      // Component 2: C - D - E
      const c = await graph.createNode('Node', { name: 'C' })
      const d = await graph.createNode('Node', { name: 'D' })
      const e = await graph.createNode('Node', { name: 'E' })
      await graph.createEdge(c.id, 'CONNECTS', d.id)
      await graph.createEdge(d.id, 'CONNECTS', e.id)

      // Component 3: F (isolated)
      await graph.createNode('Node', { name: 'F' })

      const components = await graph.connectedComponents()

      expect(components).toHaveLength(3)
      expect(components.some(c => c.length === 2)).toBe(true) // A-B
      expect(components.some(c => c.length === 3)).toBe(true) // C-D-E
      expect(components.some(c => c.length === 1)).toBe(true) // F
    })

    it('finds largest connected component', async () => {
      // Small component
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      await graph.createEdge(a.id, 'CONNECTS', b.id)

      // Large component
      const c = await graph.createNode('Node', { name: 'C' })
      const d = await graph.createNode('Node', { name: 'D' })
      const e = await graph.createNode('Node', { name: 'E' })
      const f = await graph.createNode('Node', { name: 'F' })
      await graph.createEdge(c.id, 'CONNECTS', d.id)
      await graph.createEdge(d.id, 'CONNECTS', e.id)
      await graph.createEdge(e.id, 'CONNECTS', f.id)

      const largest = await graph.largestComponent()

      expect(largest).toHaveLength(4)
    })

    it('correctly reports graph connectivity', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })

      // Disconnected
      expect(await graph.isConnected()).toBe(false)

      // Connect them
      await graph.createEdge(a.id, 'CONNECTS', b.id)
      expect(await graph.isConnected()).toBe(true)
    })

    it('shortestPath returns null for nodes in different components', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })

      // A and B connected, C isolated
      await graph.createEdge(a.id, 'CONNECTS', b.id)

      const path = await graph.shortestPath(a.id, c.id)
      expect(path).toBeNull()
    })

    it('handles traversal starting from isolated node', async () => {
      const isolated = await graph.createNode('Node', { name: 'Isolated' })
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      await graph.createEdge(a.id, 'CONNECTS', b.id)

      const result = await graph.traverse({
        start: isolated.id,
        direction: 'OUTGOING',
        maxDepth: 10,
      })

      expect(result.nodes).toHaveLength(0)
    })

    it('identifies strongly connected components in directed graph', async () => {
      // SCC 1: A -> B -> C -> A
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })
      await graph.createEdge(a.id, 'CONNECTS', b.id)
      await graph.createEdge(b.id, 'CONNECTS', c.id)
      await graph.createEdge(c.id, 'CONNECTS', a.id)

      // SCC 2: D -> E -> D
      const d = await graph.createNode('Node', { name: 'D' })
      const e = await graph.createNode('Node', { name: 'E' })
      await graph.createEdge(d.id, 'CONNECTS', e.id)
      await graph.createEdge(e.id, 'CONNECTS', d.id)

      // Connection between SCCs (not bidirectional)
      await graph.createEdge(c.id, 'CONNECTS', d.id)

      const sccs = await graph.stronglyConnectedComponents()

      expect(sccs.length).toBeGreaterThanOrEqual(2)
      expect(sccs.some(scc => scc.length === 3)).toBe(true) // A-B-C
      expect(sccs.some(scc => scc.length === 2)).toBe(true) // D-E
    })
  })

  // ==========================================================================
  // ADDITIONAL ALGORITHM TESTS
  // ==========================================================================

  describe('Additional Algorithms', () => {
    it('computes topological sort for DAG', async () => {
      const a = await graph.createNode('Task', { name: 'A' })
      const b = await graph.createNode('Task', { name: 'B' })
      const c = await graph.createNode('Task', { name: 'C' })
      const d = await graph.createNode('Task', { name: 'D' })

      // Dependencies: A -> B -> D, A -> C -> D
      await graph.createEdge(a.id, 'DEPENDS', b.id)
      await graph.createEdge(a.id, 'DEPENDS', c.id)
      await graph.createEdge(b.id, 'DEPENDS', d.id)
      await graph.createEdge(c.id, 'DEPENDS', d.id)

      const sorted = await graph.topologicalSort()

      expect(sorted).not.toBeNull()
      expect(sorted).toHaveLength(4)
      // A must come before B and C, B and C must come before D
      const aIndex = sorted!.indexOf(a.id)
      const bIndex = sorted!.indexOf(b.id)
      const cIndex = sorted!.indexOf(c.id)
      const dIndex = sorted!.indexOf(d.id)
      expect(aIndex).toBeLessThan(bIndex)
      expect(aIndex).toBeLessThan(cIndex)
      expect(bIndex).toBeLessThan(dIndex)
      expect(cIndex).toBeLessThan(dIndex)
    })

    it('returns null for topological sort on cyclic graph', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })

      await graph.createEdge(a.id, 'CONNECTS', b.id)
      await graph.createEdge(b.id, 'CONNECTS', a.id)

      const sorted = await graph.topologicalSort()
      expect(sorted).toBeNull()
    })

    it('computes betweenness centrality', async () => {
      // Star topology: center connected to all others
      const center = await graph.createNode('Node', { name: 'Center' })
      const leaf1 = await graph.createNode('Node', { name: 'Leaf1' })
      const leaf2 = await graph.createNode('Node', { name: 'Leaf2' })
      const leaf3 = await graph.createNode('Node', { name: 'Leaf3' })

      await graph.createEdge(center.id, 'CONNECTS', leaf1.id)
      await graph.createEdge(center.id, 'CONNECTS', leaf2.id)
      await graph.createEdge(center.id, 'CONNECTS', leaf3.id)

      const centrality = await graph.betweennessCentrality()

      expect(centrality.size).toBe(4)
      // Center should have highest betweenness (all paths go through it)
      // Note: in this topology, leaves have 0 betweenness
    })

    it('computes minimum spanning tree', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })

      await graph.createEdge(a.id, 'CONNECTS', b.id, { weight: 1 })
      await graph.createEdge(b.id, 'CONNECTS', c.id, { weight: 2 })
      await graph.createEdge(a.id, 'CONNECTS', c.id, { weight: 3 })

      const mst = await graph.minimumSpanningTree()

      // MST should have 2 edges (n-1 for n nodes)
      expect(mst).toHaveLength(2)

      // Total weight should be minimal (1 + 2 = 3, not 1 + 3 or 2 + 3)
      const totalWeight = mst.reduce(
        (sum, edge) => sum + ((edge.properties.weight as number) ?? 1),
        0
      )
      expect(totalWeight).toBe(3)
    })
  })
})
