/**
 * Graph Algorithm Tests
 *
 * Tests for advanced graph algorithms:
 * - Connected Components
 * - Strongly Connected Components
 * - Closeness Centrality
 * - Dijkstra's Algorithm (weighted shortest path)
 * - Minimum Spanning Tree
 * - Topological Sort
 * - Graph Metrics (diameter, radius, center)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GraphEngine, type Node } from '../index'

describe('Graph Algorithms', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  // ==========================================================================
  // CONNECTED COMPONENTS
  // ==========================================================================

  describe('Connected Components', () => {
    describe('connectedComponents', () => {
      it('finds single component in connected graph', async () => {
        const a = await graph.createNode('Person', { name: 'A' })
        const b = await graph.createNode('Person', { name: 'B' })
        const c = await graph.createNode('Person', { name: 'C' })

        await graph.createEdge(a.id, 'KNOWS', b.id)
        await graph.createEdge(b.id, 'KNOWS', c.id)

        const components = await graph.connectedComponents()

        expect(components).toHaveLength(1)
        expect(components[0]).toHaveLength(3)
      })

      it('finds multiple disconnected components', async () => {
        const a = await graph.createNode('Person', { name: 'A' })
        const b = await graph.createNode('Person', { name: 'B' })
        const c = await graph.createNode('Person', { name: 'C' })
        const d = await graph.createNode('Person', { name: 'D' })

        // Component 1: A-B
        await graph.createEdge(a.id, 'KNOWS', b.id)
        // Component 2: C-D
        await graph.createEdge(c.id, 'KNOWS', d.id)

        const components = await graph.connectedComponents()

        expect(components).toHaveLength(2)
        expect(components.every(c => c.length === 2)).toBe(true)
      })

      it('treats isolated nodes as separate components', async () => {
        const a = await graph.createNode('Person', { name: 'A' })
        const b = await graph.createNode('Person', { name: 'B' })
        const c = await graph.createNode('Person', { name: 'C' })

        await graph.createEdge(a.id, 'KNOWS', b.id)
        // C is isolated

        const components = await graph.connectedComponents()

        expect(components).toHaveLength(2)
        expect(components.some(c => c.length === 2)).toBe(true)
        expect(components.some(c => c.length === 1)).toBe(true)
      })

      it('returns empty array for empty graph', async () => {
        const components = await graph.connectedComponents()
        expect(components).toHaveLength(0)
      })

      it('treats directed edges as undirected', async () => {
        const a = await graph.createNode('Person', { name: 'A' })
        const b = await graph.createNode('Person', { name: 'B' })
        const c = await graph.createNode('Person', { name: 'C' })

        // A -> B -> C (directed)
        await graph.createEdge(a.id, 'KNOWS', b.id)
        await graph.createEdge(b.id, 'KNOWS', c.id)

        const components = await graph.connectedComponents()

        // Should still be one component when treating as undirected
        expect(components).toHaveLength(1)
        expect(components[0]).toHaveLength(3)
      })
    })

    describe('stronglyConnectedComponents', () => {
      it('finds SCCs in directed graph', async () => {
        const a = await graph.createNode('Person', { name: 'A' })
        const b = await graph.createNode('Person', { name: 'B' })
        const c = await graph.createNode('Person', { name: 'C' })

        // A -> B -> C -> A (cycle = one SCC)
        await graph.createEdge(a.id, 'KNOWS', b.id)
        await graph.createEdge(b.id, 'KNOWS', c.id)
        await graph.createEdge(c.id, 'KNOWS', a.id)

        const sccs = await graph.stronglyConnectedComponents()

        expect(sccs).toHaveLength(1)
        expect(sccs[0]).toHaveLength(3)
      })

      it('finds multiple SCCs', async () => {
        const a = await graph.createNode('Person', { name: 'A' })
        const b = await graph.createNode('Person', { name: 'B' })
        const c = await graph.createNode('Person', { name: 'C' })
        const d = await graph.createNode('Person', { name: 'D' })

        // A -> B (A is its own SCC, B is its own SCC)
        // C <-> D (C-D form one SCC)
        await graph.createEdge(a.id, 'KNOWS', b.id)
        await graph.createEdge(c.id, 'KNOWS', d.id)
        await graph.createEdge(d.id, 'KNOWS', c.id)

        const sccs = await graph.stronglyConnectedComponents()

        expect(sccs.length).toBeGreaterThanOrEqual(2)
        expect(sccs.some(scc => scc.length === 2)).toBe(true) // C-D
      })
    })

    describe('isConnected', () => {
      it('returns true for connected graph', async () => {
        const a = await graph.createNode('Person', { name: 'A' })
        const b = await graph.createNode('Person', { name: 'B' })

        await graph.createEdge(a.id, 'KNOWS', b.id)

        expect(await graph.isConnected()).toBe(true)
      })

      it('returns false for disconnected graph', async () => {
        await graph.createNode('Person', { name: 'A' })
        await graph.createNode('Person', { name: 'B' })

        expect(await graph.isConnected()).toBe(false)
      })

      it('returns true for empty graph', async () => {
        expect(await graph.isConnected()).toBe(true)
      })

      it('returns true for single node', async () => {
        await graph.createNode('Person', { name: 'A' })
        expect(await graph.isConnected()).toBe(true)
      })
    })

    describe('largestComponent', () => {
      it('returns the largest component', async () => {
        const a = await graph.createNode('Person', { name: 'A' })
        const b = await graph.createNode('Person', { name: 'B' })
        const c = await graph.createNode('Person', { name: 'C' })
        const d = await graph.createNode('Person', { name: 'D' })
        const e = await graph.createNode('Person', { name: 'E' })

        // Component 1: A-B-C (3 nodes)
        await graph.createEdge(a.id, 'KNOWS', b.id)
        await graph.createEdge(b.id, 'KNOWS', c.id)
        // Component 2: D-E (2 nodes)
        await graph.createEdge(d.id, 'KNOWS', e.id)

        const largest = await graph.largestComponent()

        expect(largest).toHaveLength(3)
      })

      it('returns empty array for empty graph', async () => {
        const largest = await graph.largestComponent()
        expect(largest).toHaveLength(0)
      })
    })
  })

  // ==========================================================================
  // CLOSENESS CENTRALITY
  // ==========================================================================

  describe('Closeness Centrality', () => {
    it('calculates closeness centrality', async () => {
      const a = await graph.createNode('Person', { name: 'A' })
      const b = await graph.createNode('Person', { name: 'B' })
      const c = await graph.createNode('Person', { name: 'C' })

      // A -> B -> C (linear)
      await graph.createEdge(a.id, 'KNOWS', b.id)
      await graph.createEdge(b.id, 'KNOWS', c.id)

      const centrality = await graph.closenessCentrality()

      expect(centrality.size).toBe(3)
      // A can reach B (dist 1) and C (dist 2) = sum 3, closeness = 2/3
      expect(centrality.get(a.id)).toBeCloseTo(2 / 3, 2)
    })

    it('returns 0 for isolated nodes', async () => {
      const a = await graph.createNode('Person', { name: 'A' })
      await graph.createNode('Person', { name: 'B' })

      const centrality = await graph.closenessCentrality()

      expect(centrality.get(a.id)).toBe(0)
    })

    it('central node has higher closeness', async () => {
      // Star topology: center connected to all others
      const center = await graph.createNode('Person', { name: 'Center' })
      const p1 = await graph.createNode('Person', { name: 'P1' })
      const p2 = await graph.createNode('Person', { name: 'P2' })
      const p3 = await graph.createNode('Person', { name: 'P3' })

      await graph.createEdge(center.id, 'KNOWS', p1.id)
      await graph.createEdge(center.id, 'KNOWS', p2.id)
      await graph.createEdge(center.id, 'KNOWS', p3.id)

      const centrality = await graph.closenessCentrality()

      expect(centrality.get(center.id)).toBeGreaterThan(centrality.get(p1.id)!)
    })

    it('normalizes values when requested', async () => {
      const a = await graph.createNode('Person', { name: 'A' })
      const b = await graph.createNode('Person', { name: 'B' })
      const c = await graph.createNode('Person', { name: 'C' })

      await graph.createEdge(a.id, 'KNOWS', b.id)
      await graph.createEdge(b.id, 'KNOWS', c.id)

      const centrality = await graph.closenessCentrality({ normalized: true })

      for (const value of centrality.values()) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    })
  })

  // ==========================================================================
  // DIJKSTRA'S ALGORITHM
  // ==========================================================================

  describe('Dijkstra Weighted Shortest Path', () => {
    it('finds shortest weighted path', async () => {
      const a = await graph.createNode('City', { name: 'A' })
      const b = await graph.createNode('City', { name: 'B' })
      const c = await graph.createNode('City', { name: 'C' })

      await graph.createEdge(a.id, 'ROAD', b.id, { weight: 1 })
      await graph.createEdge(b.id, 'ROAD', c.id, { weight: 2 })
      await graph.createEdge(a.id, 'ROAD', c.id, { weight: 5 }) // Longer direct path

      const result = await graph.dijkstra(a.id, c.id)

      expect(result).not.toBeNull()
      expect(result!.weight).toBe(3) // 1 + 2 = 3 via B, not 5 direct
      expect(result!.path.nodes).toHaveLength(3)
    })

    it('returns null for unreachable nodes', async () => {
      const a = await graph.createNode('City', { name: 'A' })
      const b = await graph.createNode('City', { name: 'B' })

      const result = await graph.dijkstra(a.id, b.id)

      expect(result).toBeNull()
    })

    it('returns path of weight 0 for same node', async () => {
      const a = await graph.createNode('City', { name: 'A' })

      const result = await graph.dijkstra(a.id, a.id)

      expect(result).not.toBeNull()
      expect(result!.weight).toBe(0)
      expect(result!.path.nodes).toHaveLength(1)
    })

    it('uses custom weight property', async () => {
      const a = await graph.createNode('City', { name: 'A' })
      const b = await graph.createNode('City', { name: 'B' })

      await graph.createEdge(a.id, 'ROAD', b.id, { cost: 10 })

      const result = await graph.dijkstra(a.id, b.id, { weightProperty: 'cost' })

      expect(result).not.toBeNull()
      expect(result!.weight).toBe(10)
    })

    it('defaults to weight 1 when property missing', async () => {
      const a = await graph.createNode('City', { name: 'A' })
      const b = await graph.createNode('City', { name: 'B' })

      await graph.createEdge(a.id, 'ROAD', b.id, {}) // No weight property

      const result = await graph.dijkstra(a.id, b.id)

      expect(result).not.toBeNull()
      expect(result!.weight).toBe(1)
    })

    it('respects maxWeight limit', async () => {
      const a = await graph.createNode('City', { name: 'A' })
      const b = await graph.createNode('City', { name: 'B' })
      const c = await graph.createNode('City', { name: 'C' })

      await graph.createEdge(a.id, 'ROAD', b.id, { weight: 5 })
      await graph.createEdge(b.id, 'ROAD', c.id, { weight: 5 })

      const result = await graph.dijkstra(a.id, c.id, { maxWeight: 8 })

      expect(result).toBeNull() // Total would be 10, exceeds maxWeight
    })
  })

  // ==========================================================================
  // MINIMUM SPANNING TREE
  // ==========================================================================

  describe('Minimum Spanning Tree', () => {
    it('finds MST using Kruskal algorithm', async () => {
      const a = await graph.createNode('City', { name: 'A' })
      const b = await graph.createNode('City', { name: 'B' })
      const c = await graph.createNode('City', { name: 'C' })

      await graph.createEdge(a.id, 'ROAD', b.id, { weight: 1 })
      await graph.createEdge(b.id, 'ROAD', c.id, { weight: 2 })
      await graph.createEdge(a.id, 'ROAD', c.id, { weight: 3 })

      const mst = await graph.minimumSpanningTree()

      // MST should have 2 edges (n-1 for 3 nodes)
      expect(mst).toHaveLength(2)

      // Should pick edges with weight 1 and 2, not 3
      const weights = mst.map(e => e.properties.weight as number)
      expect(weights).toContain(1)
      expect(weights).toContain(2)
      expect(weights).not.toContain(3)
    })

    it('handles disconnected graph', async () => {
      const a = await graph.createNode('City', { name: 'A' })
      const b = await graph.createNode('City', { name: 'B' })
      const c = await graph.createNode('City', { name: 'C' })
      const d = await graph.createNode('City', { name: 'D' })

      await graph.createEdge(a.id, 'ROAD', b.id, { weight: 1 })
      await graph.createEdge(c.id, 'ROAD', d.id, { weight: 2 })

      const mst = await graph.minimumSpanningTree()

      // Should have 2 edges (spanning forest)
      expect(mst).toHaveLength(2)
    })

    it('uses custom weight property', async () => {
      const a = await graph.createNode('City', { name: 'A' })
      const b = await graph.createNode('City', { name: 'B' })

      await graph.createEdge(a.id, 'ROAD', b.id, { distance: 10 })

      const mst = await graph.minimumSpanningTree({ weightProperty: 'distance' })

      expect(mst).toHaveLength(1)
    })
  })

  // ==========================================================================
  // TOPOLOGICAL SORT
  // ==========================================================================

  describe('Topological Sort', () => {
    it('sorts DAG topologically', async () => {
      const a = await graph.createNode('Task', { name: 'A' })
      const b = await graph.createNode('Task', { name: 'B' })
      const c = await graph.createNode('Task', { name: 'C' })

      // A -> B -> C
      await graph.createEdge(a.id, 'DEPENDS_ON', b.id)
      await graph.createEdge(b.id, 'DEPENDS_ON', c.id)

      const sorted = await graph.topologicalSort()

      expect(sorted).not.toBeNull()
      expect(sorted).toHaveLength(3)

      // A must come before B, B before C
      const aIdx = sorted!.indexOf(a.id)
      const bIdx = sorted!.indexOf(b.id)
      const cIdx = sorted!.indexOf(c.id)

      expect(aIdx).toBeLessThan(bIdx)
      expect(bIdx).toBeLessThan(cIdx)
    })

    it('returns null for graph with cycles', async () => {
      const a = await graph.createNode('Task', { name: 'A' })
      const b = await graph.createNode('Task', { name: 'B' })
      const c = await graph.createNode('Task', { name: 'C' })

      // A -> B -> C -> A (cycle)
      await graph.createEdge(a.id, 'DEPENDS_ON', b.id)
      await graph.createEdge(b.id, 'DEPENDS_ON', c.id)
      await graph.createEdge(c.id, 'DEPENDS_ON', a.id)

      const sorted = await graph.topologicalSort()

      expect(sorted).toBeNull()
    })

    it('handles multiple valid orderings', async () => {
      const a = await graph.createNode('Task', { name: 'A' })
      const b = await graph.createNode('Task', { name: 'B' })
      const c = await graph.createNode('Task', { name: 'C' })

      // A -> C, B -> C (A and B can be in any order, but both before C)
      await graph.createEdge(a.id, 'DEPENDS_ON', c.id)
      await graph.createEdge(b.id, 'DEPENDS_ON', c.id)

      const sorted = await graph.topologicalSort()

      expect(sorted).not.toBeNull()
      expect(sorted).toHaveLength(3)

      // C must come after both A and B
      const cIdx = sorted!.indexOf(c.id)
      const aIdx = sorted!.indexOf(a.id)
      const bIdx = sorted!.indexOf(b.id)

      expect(cIdx).toBeGreaterThan(aIdx)
      expect(cIdx).toBeGreaterThan(bIdx)
    })
  })

  describe('hasCycles', () => {
    it('returns true for graph with cycle', async () => {
      const a = await graph.createNode('Task', { name: 'A' })
      const b = await graph.createNode('Task', { name: 'B' })

      await graph.createEdge(a.id, 'DEPENDS_ON', b.id)
      await graph.createEdge(b.id, 'DEPENDS_ON', a.id)

      expect(await graph.hasCycles()).toBe(true)
    })

    it('returns false for DAG', async () => {
      const a = await graph.createNode('Task', { name: 'A' })
      const b = await graph.createNode('Task', { name: 'B' })

      await graph.createEdge(a.id, 'DEPENDS_ON', b.id)

      expect(await graph.hasCycles()).toBe(false)
    })
  })

  // ==========================================================================
  // GRAPH METRICS
  // ==========================================================================

  describe('Graph Metrics', () => {
    describe('eccentricity', () => {
      it('calculates node eccentricity', async () => {
        const a = await graph.createNode('Person', { name: 'A' })
        const b = await graph.createNode('Person', { name: 'B' })
        const c = await graph.createNode('Person', { name: 'C' })

        await graph.createEdge(a.id, 'KNOWS', b.id)
        await graph.createEdge(b.id, 'KNOWS', c.id)

        const ecc = await graph.eccentricity(a.id)

        expect(ecc).toBe(2) // Max distance from A to C
      })

      it('returns 0 for isolated node', async () => {
        const a = await graph.createNode('Person', { name: 'A' })

        const ecc = await graph.eccentricity(a.id)

        expect(ecc).toBe(0)
      })
    })

    describe('diameter', () => {
      it('calculates graph diameter', async () => {
        const a = await graph.createNode('Person', { name: 'A' })
        const b = await graph.createNode('Person', { name: 'B' })
        const c = await graph.createNode('Person', { name: 'C' })
        const d = await graph.createNode('Person', { name: 'D' })

        // Linear graph: A -> B -> C -> D
        await graph.createEdge(a.id, 'KNOWS', b.id)
        await graph.createEdge(b.id, 'KNOWS', c.id)
        await graph.createEdge(c.id, 'KNOWS', d.id)

        const diam = await graph.diameter()

        expect(diam).toBe(3) // Longest shortest path: A to D
      })
    })

    describe('radius', () => {
      it('calculates graph radius', async () => {
        const a = await graph.createNode('Person', { name: 'A' })
        const b = await graph.createNode('Person', { name: 'B' })
        const c = await graph.createNode('Person', { name: 'C' })

        // A -> B, A -> C (star from A)
        await graph.createEdge(a.id, 'KNOWS', b.id)
        await graph.createEdge(a.id, 'KNOWS', c.id)

        const rad = await graph.radius()

        // A has eccentricity 1, B and C have 0 (can't reach anything)
        // Radius is minimum positive eccentricity = 1
        expect(rad).toBe(1)
      })
    })

    describe('center', () => {
      it('finds center nodes', async () => {
        const a = await graph.createNode('Person', { name: 'A' })
        const b = await graph.createNode('Person', { name: 'B' })
        const c = await graph.createNode('Person', { name: 'C' })

        // Linear: A -> B -> C
        await graph.createEdge(a.id, 'KNOWS', b.id)
        await graph.createEdge(b.id, 'KNOWS', c.id)

        const centerNodes = await graph.center()

        // B is the center (eccentricity 1)
        expect(centerNodes.some(n => n.id === b.id)).toBe(true)
      })
    })
  })
})
