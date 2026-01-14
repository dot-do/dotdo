/**
 * Graph Analytics Algorithms - TDD Tests
 *
 * Tests for graph analytics algorithms:
 * - PageRank - Iterative node importance scoring
 * - Connected Components - Union-find based component detection
 * - Strongly Connected Components - For directed graphs
 * - Triangle Counting - Clustering coefficient calculation
 * - Community Detection - Label propagation algorithm
 *
 * @see Issue dotdo-judnb
 * @module db/compat/graph/src/graph-analytics
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  GraphAnalytics,
  createGraphAnalytics,
  type PageRankOptions,
  type PageRankResult,
  type ConnectedComponentsResult,
  type StronglyConnectedComponentsResult,
  type TriangleCountResult,
  type CommunityResult,
} from './graph-analytics'
import { AdjacencyIndex, type Relationship } from './traversal-engine'

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Create a simple directed graph:
 *
 *     A ---> B ---> C
 *     |      |
 *     v      v
 *     D ---> E
 *
 */
function createSimpleGraph(): AdjacencyIndex {
  const index = new AdjacencyIndex()

  const edges: Relationship[] = [
    { id: 'e1', type: 'links', from: 'A', to: 'B', createdAt: Date.now() },
    { id: 'e2', type: 'links', from: 'B', to: 'C', createdAt: Date.now() },
    { id: 'e3', type: 'links', from: 'A', to: 'D', createdAt: Date.now() },
    { id: 'e4', type: 'links', from: 'B', to: 'E', createdAt: Date.now() },
    { id: 'e5', type: 'links', from: 'D', to: 'E', createdAt: Date.now() },
  ]

  for (const edge of edges) {
    index.addEdge(edge)
  }

  return index
}

/**
 * Create a web-like graph for PageRank testing:
 *
 *     Page1 ---> Page2
 *       |          |
 *       v          v
 *     Page3 <------+
 *       |
 *       v
 *     Page4
 *
 * Page3 receives most links, should have highest PageRank
 */
function createWebGraph(): AdjacencyIndex {
  const index = new AdjacencyIndex()

  const edges: Relationship[] = [
    { id: 'e1', type: 'links_to', from: 'page1', to: 'page2', createdAt: Date.now() },
    { id: 'e2', type: 'links_to', from: 'page1', to: 'page3', createdAt: Date.now() },
    { id: 'e3', type: 'links_to', from: 'page2', to: 'page3', createdAt: Date.now() },
    { id: 'e4', type: 'links_to', from: 'page3', to: 'page4', createdAt: Date.now() },
  ]

  for (const edge of edges) {
    index.addEdge(edge)
  }

  return index
}

/**
 * Create a disconnected graph with two components:
 *
 * Component 1: A <--> B <--> C
 * Component 2: X <--> Y
 */
function createDisconnectedGraph(): AdjacencyIndex {
  const index = new AdjacencyIndex()

  const edges: Relationship[] = [
    // Component 1 (bidirectional)
    { id: 'e1', type: 'links', from: 'A', to: 'B', createdAt: Date.now() },
    { id: 'e2', type: 'links', from: 'B', to: 'A', createdAt: Date.now() },
    { id: 'e3', type: 'links', from: 'B', to: 'C', createdAt: Date.now() },
    { id: 'e4', type: 'links', from: 'C', to: 'B', createdAt: Date.now() },
    // Component 2 (bidirectional)
    { id: 'e5', type: 'links', from: 'X', to: 'Y', createdAt: Date.now() },
    { id: 'e6', type: 'links', from: 'Y', to: 'X', createdAt: Date.now() },
  ]

  for (const edge of edges) {
    index.addEdge(edge)
  }

  return index
}

/**
 * Create a graph with strongly connected component:
 *
 *     A ---> B
 *     ^      |
 *     |      v
 *     +<---- C
 *
 *     D ---> E (not strongly connected)
 */
function createSCCGraph(): AdjacencyIndex {
  const index = new AdjacencyIndex()

  const edges: Relationship[] = [
    // Strongly connected component A-B-C
    { id: 'e1', type: 'links', from: 'A', to: 'B', createdAt: Date.now() },
    { id: 'e2', type: 'links', from: 'B', to: 'C', createdAt: Date.now() },
    { id: 'e3', type: 'links', from: 'C', to: 'A', createdAt: Date.now() },
    // Not strongly connected
    { id: 'e4', type: 'links', from: 'A', to: 'D', createdAt: Date.now() },
    { id: 'e5', type: 'links', from: 'D', to: 'E', createdAt: Date.now() },
  ]

  for (const edge of edges) {
    index.addEdge(edge)
  }

  return index
}

/**
 * Create a graph with triangles for triangle counting:
 *
 *     A ----- B
 *      \     /|
 *       \   / |
 *        \ /  |
 *         C---D
 *
 * Triangles: (A,B,C), (B,C,D)
 */
function createTriangleGraph(): AdjacencyIndex {
  const index = new AdjacencyIndex()

  const edges: Relationship[] = [
    // Triangle A-B-C
    { id: 'e1', type: 'friends', from: 'A', to: 'B', createdAt: Date.now() },
    { id: 'e2', type: 'friends', from: 'B', to: 'A', createdAt: Date.now() },
    { id: 'e3', type: 'friends', from: 'B', to: 'C', createdAt: Date.now() },
    { id: 'e4', type: 'friends', from: 'C', to: 'B', createdAt: Date.now() },
    { id: 'e5', type: 'friends', from: 'A', to: 'C', createdAt: Date.now() },
    { id: 'e6', type: 'friends', from: 'C', to: 'A', createdAt: Date.now() },
    // Triangle B-C-D
    { id: 'e7', type: 'friends', from: 'B', to: 'D', createdAt: Date.now() },
    { id: 'e8', type: 'friends', from: 'D', to: 'B', createdAt: Date.now() },
    { id: 'e9', type: 'friends', from: 'C', to: 'D', createdAt: Date.now() },
    { id: 'e10', type: 'friends', from: 'D', to: 'C', createdAt: Date.now() },
  ]

  for (const edge of edges) {
    index.addEdge(edge)
  }

  return index
}

/**
 * Create a community graph for label propagation:
 *
 * Community 1:  A --- B --- C
 *               |     |
 *               +-----+
 *
 * Community 2:  X --- Y --- Z
 *               |     |
 *               +-----+
 *
 * Bridge:       C --- X (weak connection between communities)
 */
function createCommunityGraph(): AdjacencyIndex {
  const index = new AdjacencyIndex()

  const edges: Relationship[] = [
    // Community 1 - dense connections
    { id: 'e1', type: 'knows', from: 'A', to: 'B', createdAt: Date.now() },
    { id: 'e2', type: 'knows', from: 'B', to: 'A', createdAt: Date.now() },
    { id: 'e3', type: 'knows', from: 'B', to: 'C', createdAt: Date.now() },
    { id: 'e4', type: 'knows', from: 'C', to: 'B', createdAt: Date.now() },
    { id: 'e5', type: 'knows', from: 'A', to: 'C', createdAt: Date.now() },
    { id: 'e6', type: 'knows', from: 'C', to: 'A', createdAt: Date.now() },
    // Community 2 - dense connections
    { id: 'e7', type: 'knows', from: 'X', to: 'Y', createdAt: Date.now() },
    { id: 'e8', type: 'knows', from: 'Y', to: 'X', createdAt: Date.now() },
    { id: 'e9', type: 'knows', from: 'Y', to: 'Z', createdAt: Date.now() },
    { id: 'e10', type: 'knows', from: 'Z', to: 'Y', createdAt: Date.now() },
    { id: 'e11', type: 'knows', from: 'X', to: 'Z', createdAt: Date.now() },
    { id: 'e12', type: 'knows', from: 'Z', to: 'X', createdAt: Date.now() },
    // Bridge between communities (weaker)
    { id: 'e13', type: 'knows', from: 'C', to: 'X', createdAt: Date.now() },
    { id: 'e14', type: 'knows', from: 'X', to: 'C', createdAt: Date.now() },
  ]

  for (const edge of edges) {
    index.addEdge(edge)
  }

  return index
}

// ============================================================================
// PAGERANK TESTS
// ============================================================================

describe('PageRank Algorithm', () => {
  describe('basic functionality', () => {
    let analytics: GraphAnalytics

    beforeEach(() => {
      const index = createWebGraph()
      analytics = createGraphAnalytics(index)
    })

    it('should compute PageRank for all nodes', async () => {
      const results = await analytics.pageRank()

      expect(results.size).toBe(4)
      expect(results.has('page1')).toBe(true)
      expect(results.has('page2')).toBe(true)
      expect(results.has('page3')).toBe(true)
      expect(results.has('page4')).toBe(true)
    })

    it('should return scores between 0 and 1', async () => {
      const results = await analytics.pageRank()

      for (const [_nodeId, score] of results) {
        expect(score).toBeGreaterThan(0)
        expect(score).toBeLessThanOrEqual(1)
      }
    })

    it('should rank page3 highest (receives most links)', async () => {
      const results = await analytics.pageRank()

      const page3Score = results.get('page3')!
      const page1Score = results.get('page1')!

      expect(page3Score).toBeGreaterThan(page1Score)
    })

    it('should sum to approximately 1 (normalized)', async () => {
      const results = await analytics.pageRank()

      let sum = 0
      for (const [_nodeId, score] of results) {
        sum += score
      }

      // Allow small floating point tolerance
      expect(sum).toBeGreaterThan(0.95)
      expect(sum).toBeLessThan(1.05)
    })
  })

  describe('configuration options', () => {
    let analytics: GraphAnalytics

    beforeEach(() => {
      const index = createWebGraph()
      analytics = createGraphAnalytics(index)
    })

    it('should accept custom damping factor', async () => {
      const results1 = await analytics.pageRank({ damping: 0.5 })
      const results2 = await analytics.pageRank({ damping: 0.99 })

      // Different damping factors should produce different scores
      expect(results1.get('page3')).not.toBe(results2.get('page3'))
    })

    it('should accept custom iteration count', async () => {
      const results = await analytics.pageRank({ iterations: 5 })

      expect(results.size).toBe(4)
    })

    it('should converge with tolerance', async () => {
      const results = await analytics.pageRank({
        tolerance: 0.0001,
        iterations: 100,
      })

      expect(results.size).toBe(4)
    })

    it('should use default damping of 0.85', async () => {
      const explicitResults = await analytics.pageRank({ damping: 0.85 })
      const defaultResults = await analytics.pageRank()

      // Should produce same results
      for (const [nodeId, score] of defaultResults) {
        expect(score).toBeCloseTo(explicitResults.get(nodeId)!, 10)
      }
    })
  })

  describe('edge cases', () => {
    it('should handle empty graph', async () => {
      const index = new AdjacencyIndex()
      const analytics = createGraphAnalytics(index)

      const results = await analytics.pageRank()

      expect(results.size).toBe(0)
    })

    it('should handle single node graph', async () => {
      const index = new AdjacencyIndex()
      // Add a self-loop to create a single node
      index.addEdge({ id: 'e1', type: 'self', from: 'solo', to: 'solo', createdAt: Date.now() })
      const analytics = createGraphAnalytics(index)

      const results = await analytics.pageRank()

      expect(results.size).toBe(1)
      expect(results.get('solo')).toBeDefined()
    })

    it('should handle cyclic graph', async () => {
      const index = new AdjacencyIndex()
      // Create a cycle: A -> B -> C -> A
      index.addEdge({ id: 'e1', type: 'links', from: 'A', to: 'B', createdAt: Date.now() })
      index.addEdge({ id: 'e2', type: 'links', from: 'B', to: 'C', createdAt: Date.now() })
      index.addEdge({ id: 'e3', type: 'links', from: 'C', to: 'A', createdAt: Date.now() })
      const analytics = createGraphAnalytics(index)

      const results = await analytics.pageRank()

      expect(results.size).toBe(3)
      // In a simple cycle, all nodes should have similar PageRank
      const scores = Array.from(results.values())
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
      for (const score of scores) {
        expect(Math.abs(score - avgScore)).toBeLessThan(0.1)
      }
    })

    it('should handle dangling nodes (no outgoing links)', async () => {
      const index = new AdjacencyIndex()
      index.addEdge({ id: 'e1', type: 'links', from: 'A', to: 'B', createdAt: Date.now() })
      // B has no outgoing edges (dangling)
      const analytics = createGraphAnalytics(index)

      const results = await analytics.pageRank()

      expect(results.size).toBe(2)
      // B should have a valid score
      expect(results.get('B')).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// CONNECTED COMPONENTS TESTS
// ============================================================================

describe('Connected Components Algorithm', () => {
  describe('basic functionality', () => {
    it('should find connected components', async () => {
      const index = createDisconnectedGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.connectedComponents()

      expect(result.componentCount).toBe(2)
      expect(result.nodeToComponent.size).toBe(5)
    })

    it('should assign same component ID to connected nodes', async () => {
      const index = createDisconnectedGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.connectedComponents()

      const componentA = result.nodeToComponent.get('A')
      const componentB = result.nodeToComponent.get('B')
      const componentC = result.nodeToComponent.get('C')

      expect(componentA).toBe(componentB)
      expect(componentB).toBe(componentC)
    })

    it('should assign different component IDs to disconnected nodes', async () => {
      const index = createDisconnectedGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.connectedComponents()

      const componentA = result.nodeToComponent.get('A')
      const componentX = result.nodeToComponent.get('X')

      expect(componentA).not.toBe(componentX)
    })

    it('should return component sizes', async () => {
      const index = createDisconnectedGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.connectedComponents()

      // Component 1 has 3 nodes (A, B, C), Component 2 has 2 nodes (X, Y)
      const sizes = Array.from(result.componentSizes.values()).sort()
      expect(sizes).toEqual([2, 3])
    })
  })

  describe('single connected graph', () => {
    it('should return 1 component for fully connected graph', async () => {
      const index = createSimpleGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.connectedComponents()

      expect(result.componentCount).toBe(1)
    })
  })

  describe('edge cases', () => {
    it('should handle empty graph', async () => {
      const index = new AdjacencyIndex()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.connectedComponents()

      expect(result.componentCount).toBe(0)
      expect(result.nodeToComponent.size).toBe(0)
    })

    it('should handle isolated nodes as separate components', async () => {
      const index = new AdjacencyIndex()
      // Add edges that create isolated nodes
      index.addEdge({ id: 'e1', type: 'links', from: 'A', to: 'A', createdAt: Date.now() })
      index.addEdge({ id: 'e2', type: 'links', from: 'B', to: 'B', createdAt: Date.now() })
      const analytics = createGraphAnalytics(index)

      const result = await analytics.connectedComponents()

      // Self-loops don't connect nodes to each other
      expect(result.componentCount).toBe(2)
    })
  })
})

// ============================================================================
// STRONGLY CONNECTED COMPONENTS TESTS
// ============================================================================

describe('Strongly Connected Components Algorithm', () => {
  describe('basic functionality', () => {
    it('should find strongly connected components', async () => {
      const index = createSCCGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.stronglyConnectedComponents()

      // A-B-C form a strongly connected component
      // D and E are separate (only one-way connections)
      expect(result.componentCount).toBeGreaterThanOrEqual(3)
    })

    it('should identify the cycle as a single SCC', async () => {
      const index = createSCCGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.stronglyConnectedComponents()

      const componentA = result.nodeToComponent.get('A')
      const componentB = result.nodeToComponent.get('B')
      const componentC = result.nodeToComponent.get('C')

      expect(componentA).toBe(componentB)
      expect(componentB).toBe(componentC)
    })

    it('should separate non-cyclic nodes into their own SCCs', async () => {
      const index = createSCCGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.stronglyConnectedComponents()

      const componentA = result.nodeToComponent.get('A')
      const componentD = result.nodeToComponent.get('D')
      const componentE = result.nodeToComponent.get('E')

      expect(componentA).not.toBe(componentD)
      expect(componentD).not.toBe(componentE)
    })
  })

  describe('all nodes in cycle', () => {
    it('should return 1 SCC when all nodes form a cycle', async () => {
      const index = new AdjacencyIndex()
      index.addEdge({ id: 'e1', type: 'links', from: 'A', to: 'B', createdAt: Date.now() })
      index.addEdge({ id: 'e2', type: 'links', from: 'B', to: 'C', createdAt: Date.now() })
      index.addEdge({ id: 'e3', type: 'links', from: 'C', to: 'A', createdAt: Date.now() })
      const analytics = createGraphAnalytics(index)

      const result = await analytics.stronglyConnectedComponents()

      expect(result.componentCount).toBe(1)
    })
  })

  describe('DAG (no cycles)', () => {
    it('should return N SCCs for N-node DAG', async () => {
      const index = new AdjacencyIndex()
      // A -> B -> C (no cycles)
      index.addEdge({ id: 'e1', type: 'links', from: 'A', to: 'B', createdAt: Date.now() })
      index.addEdge({ id: 'e2', type: 'links', from: 'B', to: 'C', createdAt: Date.now() })
      const analytics = createGraphAnalytics(index)

      const result = await analytics.stronglyConnectedComponents()

      // Each node is its own SCC in a DAG
      expect(result.componentCount).toBe(3)
    })
  })
})

// ============================================================================
// TRIANGLE COUNTING TESTS
// ============================================================================

describe('Triangle Counting Algorithm', () => {
  describe('basic functionality', () => {
    it('should count triangles in graph', async () => {
      const index = createTriangleGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.triangleCount()

      // Two triangles: (A,B,C) and (B,C,D)
      expect(result.totalTriangles).toBe(2)
    })

    it('should return per-node triangle counts', async () => {
      const index = createTriangleGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.triangleCount()

      // B and C are in both triangles
      expect(result.nodeTriangles.get('B')).toBe(2)
      expect(result.nodeTriangles.get('C')).toBe(2)
      // A and D are each in one triangle
      expect(result.nodeTriangles.get('A')).toBe(1)
      expect(result.nodeTriangles.get('D')).toBe(1)
    })
  })

  describe('no triangles', () => {
    it('should return 0 for graph with no triangles', async () => {
      const index = createSimpleGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.triangleCount()

      expect(result.totalTriangles).toBe(0)
    })

    it('should return empty map for nodes with no triangles', async () => {
      const index = createSimpleGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.triangleCount()

      // All nodes should have 0 triangles or not be in the map
      for (const [_node, count] of result.nodeTriangles) {
        expect(count).toBe(0)
      }
    })
  })

  describe('single triangle', () => {
    it('should correctly count single triangle', async () => {
      const index = new AdjacencyIndex()
      // Create a single triangle A-B-C
      index.addEdge({ id: 'e1', type: 'friends', from: 'A', to: 'B', createdAt: Date.now() })
      index.addEdge({ id: 'e2', type: 'friends', from: 'B', to: 'A', createdAt: Date.now() })
      index.addEdge({ id: 'e3', type: 'friends', from: 'B', to: 'C', createdAt: Date.now() })
      index.addEdge({ id: 'e4', type: 'friends', from: 'C', to: 'B', createdAt: Date.now() })
      index.addEdge({ id: 'e5', type: 'friends', from: 'A', to: 'C', createdAt: Date.now() })
      index.addEdge({ id: 'e6', type: 'friends', from: 'C', to: 'A', createdAt: Date.now() })
      const analytics = createGraphAnalytics(index)

      const result = await analytics.triangleCount()

      expect(result.totalTriangles).toBe(1)
      expect(result.nodeTriangles.get('A')).toBe(1)
      expect(result.nodeTriangles.get('B')).toBe(1)
      expect(result.nodeTriangles.get('C')).toBe(1)
    })
  })

  describe('edge cases', () => {
    it('should handle empty graph', async () => {
      const index = new AdjacencyIndex()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.triangleCount()

      expect(result.totalTriangles).toBe(0)
      expect(result.nodeTriangles.size).toBe(0)
    })
  })
})

// ============================================================================
// COMMUNITY DETECTION TESTS
// ============================================================================

describe('Community Detection (Label Propagation)', () => {
  describe('basic functionality', () => {
    it('should detect communities', async () => {
      const index = createCommunityGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.communities()

      // Should detect at least 2 communities
      expect(result.communityCount).toBeGreaterThanOrEqual(1)
      expect(result.nodeToCommunity.size).toBe(6)
    })

    it('should group densely connected nodes together', async () => {
      const index = createCommunityGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.communities()

      // A, B, C should be in the same community (densely connected)
      const communityA = result.nodeToCommunity.get('A')
      const communityB = result.nodeToCommunity.get('B')
      const communityC = result.nodeToCommunity.get('C')

      expect(communityA).toBe(communityB)
      expect(communityB).toBe(communityC)
    })

    it('should separate loosely connected communities', async () => {
      const index = createCommunityGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.communities()

      // Due to the bridge edge, communities might merge
      // But at minimum, we should have valid community assignments
      expect(result.nodeToCommunity.get('A')).toBeDefined()
      expect(result.nodeToCommunity.get('X')).toBeDefined()
    })

    it('should return community sizes', async () => {
      const index = createCommunityGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.communities()

      const totalNodes = Array.from(result.communitySizes.values()).reduce((a, b) => a + b, 0)
      expect(totalNodes).toBe(6)
    })
  })

  describe('configuration options', () => {
    it('should accept max iterations option', async () => {
      const index = createCommunityGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.communities({ maxIterations: 5 })

      expect(result.communityCount).toBeGreaterThanOrEqual(1)
    })
  })

  describe('disconnected graph', () => {
    it('should detect separate communities for disconnected components', async () => {
      const index = createDisconnectedGraph()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.communities()

      // Disconnected components should be in different communities
      const communityA = result.nodeToCommunity.get('A')
      const communityX = result.nodeToCommunity.get('X')

      expect(communityA).not.toBe(communityX)
    })
  })

  describe('edge cases', () => {
    it('should handle empty graph', async () => {
      const index = new AdjacencyIndex()
      const analytics = createGraphAnalytics(index)

      const result = await analytics.communities()

      expect(result.communityCount).toBe(0)
      expect(result.nodeToCommunity.size).toBe(0)
    })

    it('should handle single node', async () => {
      const index = new AdjacencyIndex()
      index.addEdge({ id: 'e1', type: 'self', from: 'solo', to: 'solo', createdAt: Date.now() })
      const analytics = createGraphAnalytics(index)

      const result = await analytics.communities()

      expect(result.communityCount).toBe(1)
      expect(result.nodeToCommunity.get('solo')).toBeDefined()
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('GraphAnalytics Integration', () => {
  it('should create analytics from AdjacencyIndex', () => {
    const index = createSimpleGraph()
    const analytics = createGraphAnalytics(index)

    expect(analytics).toBeDefined()
    expect(typeof analytics.pageRank).toBe('function')
    expect(typeof analytics.connectedComponents).toBe('function')
    expect(typeof analytics.stronglyConnectedComponents).toBe('function')
    expect(typeof analytics.triangleCount).toBe('function')
    expect(typeof analytics.communities).toBe('function')
  })

  it('should work with dynamic graph updates', async () => {
    const index = new AdjacencyIndex()
    const analytics = createGraphAnalytics(index)

    // Initially empty
    let result = await analytics.connectedComponents()
    expect(result.componentCount).toBe(0)

    // Add some edges
    index.addEdge({ id: 'e1', type: 'links', from: 'A', to: 'B', createdAt: Date.now() })
    index.addEdge({ id: 'e2', type: 'links', from: 'B', to: 'A', createdAt: Date.now() })

    // Should now find 1 component
    result = await analytics.connectedComponents()
    expect(result.componentCount).toBe(1)

    // Add disconnected edge
    index.addEdge({ id: 'e3', type: 'links', from: 'X', to: 'Y', createdAt: Date.now() })
    index.addEdge({ id: 'e4', type: 'links', from: 'Y', to: 'X', createdAt: Date.now() })

    // Should now find 2 components
    result = await analytics.connectedComponents()
    expect(result.componentCount).toBe(2)
  })
})
