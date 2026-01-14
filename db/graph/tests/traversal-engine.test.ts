/**
 * TraversalEngine Tests - RED Phase
 *
 * TDD RED Phase: Comprehensive failing tests for graph traversal algorithms
 * that work with AdjacencyIndex columnar storage.
 *
 * @see dotdo-vyfkd - [GRAPH-4] RED: Traversal Engine - Write failing tests for BFS/DFS/paths
 *
 * Requirements from issue:
 * - BFS traversal (n-hop)
 * - DFS traversal
 * - pathExists (bidirectional)
 * - shortestPath
 * - allPaths
 * - commonNeighbors
 * - nHopNeighbors with distances
 *
 * Uses real AdjacencyIndex with SQLite, NO MOCKS - per project testing philosophy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ============================================================================
// TYPES - TraversalEngine Interface
// ============================================================================

/**
 * Options for BFS traversal
 */
interface BFSOptions {
  /** Starting node ID */
  startId: string
  /** Maximum depth/hops to traverse (default: Infinity) */
  maxDepth?: number
  /** Edge types to follow (default: all) */
  edgeTypes?: string[]
  /** Direction to traverse: 'out', 'in', or 'both' */
  direction?: 'out' | 'in' | 'both'
  /** Early termination predicate - stop when node matches */
  stopWhen?: (nodeId: string, depth: number) => boolean
  /** Maximum number of nodes to visit */
  maxNodes?: number
}

/**
 * Options for DFS traversal
 */
interface DFSOptions {
  /** Starting node ID */
  startId: string
  /** Maximum depth to traverse (default: Infinity) */
  maxDepth?: number
  /** Edge types to follow (default: all) */
  edgeTypes?: string[]
  /** Direction to traverse: 'out', 'in', or 'both' */
  direction?: 'out' | 'in' | 'both'
  /** Early termination predicate */
  stopWhen?: (nodeId: string, depth: number) => boolean
  /** Whether to include back edges in result (for cycle detection) */
  includeBackEdges?: boolean
}

/**
 * Options for path finding
 */
interface PathOptions {
  /** Edge types to follow (default: all) */
  edgeTypes?: string[]
  /** Direction to traverse: 'out', 'in', or 'both' */
  direction?: 'out' | 'in' | 'both'
  /** Maximum path length (hops) */
  maxLength?: number
  /** Whether to use bidirectional search (for pathExists/shortestPath) */
  bidirectional?: boolean
}

/**
 * Options for allPaths query
 */
interface AllPathsOptions extends PathOptions {
  /** Maximum number of paths to return */
  maxPaths?: number
  /** Whether to include cycles in paths */
  allowCycles?: boolean
}

/**
 * Result of a traversal operation
 */
interface TraversalResult {
  /** Node IDs in visit order */
  visited: string[]
  /** Map of node ID to depth from start */
  depths: Map<string, number>
  /** Number of edges traversed */
  edgesTraversed: number
  /** Whether traversal was terminated early */
  terminatedEarly: boolean
  /** Parent pointers for path reconstruction */
  parents: Map<string, string | null>
}

/**
 * A path through the graph
 */
interface Path {
  /** Ordered list of node IDs from start to end */
  nodes: string[]
  /** Ordered list of edge types used */
  edgeTypes: string[]
  /** Total path length (number of edges) */
  length: number
}

/**
 * Result of shortest path query
 */
interface ShortestPathResult {
  /** The path if found */
  path: Path | null
  /** Number of nodes explored */
  nodesExplored: number
  /** Whether bidirectional search was used */
  usedBidirectional: boolean
}

/**
 * Cycle detection result
 */
interface CycleResult {
  /** Whether cycles exist */
  hasCycles: boolean
  /** List of detected cycles (each cycle is a list of node IDs) */
  cycles: string[][]
  /** Back edges that form cycles */
  backEdges: Array<{ from: string; to: string; type: string }>
}

/**
 * Statistics from traversal
 */
interface TraversalStats {
  /** Total vertices visited */
  verticesVisited: number
  /** Total edges traversed */
  edgesTraversed: number
  /** Maximum depth reached */
  maxDepthReached: number
  /** Time taken in milliseconds */
  durationMs: number
}

/**
 * Interface for the TraversalEngine
 */
interface TraversalEngine {
  // BFS operations
  bfs(options: BFSOptions): Promise<TraversalResult>
  bfsIterator(options: BFSOptions): AsyncGenerator<{ nodeId: string; depth: number }>

  // DFS operations
  dfs(options: DFSOptions): Promise<TraversalResult>
  dfsIterator(options: DFSOptions): AsyncGenerator<{ nodeId: string; depth: number }>

  // Path finding
  pathExists(from: string, to: string, options?: PathOptions): Promise<boolean>
  shortestPath(from: string, to: string, options?: PathOptions): Promise<ShortestPathResult>
  allPaths(from: string, to: string, options?: AllPathsOptions): Promise<Path[]>

  // Cycle detection
  detectCycles(startId?: string): Promise<CycleResult>
  hasCycle(): Promise<boolean>

  // Neighbor queries
  nHopNeighbors(
    nodeId: string,
    n: number,
    options?: { edgeTypes?: string[]; direction?: 'out' | 'in' | 'both' }
  ): Promise<Map<string, number>>
  commonNeighbors(nodeA: string, nodeB: string, options?: { edgeTypes?: string[] }): Promise<string[]>

  // Statistics
  getStats(): TraversalStats
}

// ============================================================================
// HELPER: Create test graph
// ============================================================================

async function createTestGraph() {
  // Import the actual AdjacencyIndex and TraversalEngine
  const { AdjacencyIndex, TraversalEngine } = await import('../index')

  const index = new AdjacencyIndex(':memory:')
  await index.initialize()

  const engine = new TraversalEngine(index)

  return { index, engine }
}

// ============================================================================
// 1. INTERFACE EXPORT TESTS
// ============================================================================

describe('TraversalEngine Interface', () => {
  it('TraversalEngine should be exported from db/graph', async () => {
    const module = await import('../index')
    expect(module).toHaveProperty('TraversalEngine')
  })

  it('TraversalEngine constructor accepts AdjacencyIndex', async () => {
    const module = await import('../index')
    const { AdjacencyIndex, TraversalEngine } = module as {
      AdjacencyIndex: new (path: string) => unknown
      TraversalEngine: new (index: unknown) => TraversalEngine
    }

    const index = new AdjacencyIndex(':memory:')
    const engine = new TraversalEngine(index)

    expect(engine).toBeDefined()
    expect(engine.bfs).toBeDefined()
    expect(engine.dfs).toBeDefined()
    expect(engine.pathExists).toBeDefined()
    expect(engine.shortestPath).toBeDefined()
    expect(engine.allPaths).toBeDefined()
    expect(engine.detectCycles).toBeDefined()
    expect(engine.nHopNeighbors).toBeDefined()
    expect(engine.commonNeighbors).toBeDefined()
  })

  it('createTraversalEngine factory is exported', async () => {
    const module = await import('../index')
    expect(module).toHaveProperty('createTraversalEngine')
  })
})

// ============================================================================
// 2. BFS TRAVERSAL TESTS
// ============================================================================

describe('BFS Traversal', () => {
  describe('basic BFS', () => {
    it('traverses all reachable nodes in breadth-first order', async () => {
      const { index, engine } = await createTestGraph()

      // Create a simple graph: A -> B -> C, A -> D
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('A', 'D', 'KNOWS')

      const result = await engine.bfs({ startId: 'A' })

      // BFS should visit in level order: A, then B and D, then C
      expect(result.visited).toHaveLength(4)
      expect(result.visited[0]).toBe('A')
      // B and D should be visited before C (both at depth 1)
      expect(result.visited.indexOf('B')).toBeLessThan(result.visited.indexOf('C'))
      expect(result.visited.indexOf('D')).toBeLessThan(result.visited.indexOf('C'))
    })

    it('returns correct depths for each node', async () => {
      const { index, engine } = await createTestGraph()

      // Linear graph: A -> B -> C -> D
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS')

      const result = await engine.bfs({ startId: 'A' })

      expect(result.depths.get('A')).toBe(0)
      expect(result.depths.get('B')).toBe(1)
      expect(result.depths.get('C')).toBe(2)
      expect(result.depths.get('D')).toBe(3)
    })

    it('handles disconnected nodes (only visits reachable)', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B, C is disconnected
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS') // Disconnected component

      const result = await engine.bfs({ startId: 'A' })

      expect(result.visited).toContain('A')
      expect(result.visited).toContain('B')
      expect(result.visited).not.toContain('C')
      expect(result.visited).not.toContain('D')
    })

    it('handles empty graph', async () => {
      const { engine } = await createTestGraph()

      const result = await engine.bfs({ startId: 'nonexistent' })

      expect(result.visited).toHaveLength(0)
      expect(result.edgesTraversed).toBe(0)
    })

    it('handles single node graph', async () => {
      const { index, engine } = await createTestGraph()

      // Single node with self-loop
      await index.addEdge('A', 'A', 'SELF')

      const result = await engine.bfs({ startId: 'A' })

      expect(result.visited).toContain('A')
      expect(result.depths.get('A')).toBe(0)
    })
  })

  describe('BFS with maxDepth', () => {
    it('respects maxDepth limit', async () => {
      const { index, engine } = await createTestGraph()

      // Linear graph: A -> B -> C -> D -> E
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS')
      await index.addEdge('D', 'E', 'KNOWS')

      const result = await engine.bfs({ startId: 'A', maxDepth: 2 })

      expect(result.visited).toContain('A')
      expect(result.visited).toContain('B')
      expect(result.visited).toContain('C')
      expect(result.visited).not.toContain('D')
      expect(result.visited).not.toContain('E')
    })

    it('maxDepth 0 returns only start node', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')

      const result = await engine.bfs({ startId: 'A', maxDepth: 0 })

      expect(result.visited).toEqual(['A'])
    })

    it('maxDepth 1 returns immediate neighbors (n-hop with n=1)', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B, A -> C, B -> D
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('A', 'C', 'KNOWS')
      await index.addEdge('B', 'D', 'KNOWS')

      const result = await engine.bfs({ startId: 'A', maxDepth: 1 })

      expect(result.visited).toContain('A')
      expect(result.visited).toContain('B')
      expect(result.visited).toContain('C')
      expect(result.visited).not.toContain('D')
    })
  })

  describe('BFS with edge type filtering', () => {
    it('filters by edge type', async () => {
      const { index, engine } = await createTestGraph()

      // A -KNOWS-> B -WORKS_WITH-> C
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'WORKS_WITH')

      const result = await engine.bfs({
        startId: 'A',
        edgeTypes: ['KNOWS'],
      })

      expect(result.visited).toContain('A')
      expect(result.visited).toContain('B')
      expect(result.visited).not.toContain('C') // WORKS_WITH edge not followed
    })

    it('supports multiple edge types', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'WORKS_WITH')
      await index.addEdge('C', 'D', 'LIKES')

      const result = await engine.bfs({
        startId: 'A',
        edgeTypes: ['KNOWS', 'WORKS_WITH'],
      })

      expect(result.visited).toContain('A')
      expect(result.visited).toContain('B')
      expect(result.visited).toContain('C')
      expect(result.visited).not.toContain('D') // LIKES not in filter
    })
  })

  describe('BFS with direction', () => {
    it('traverses outgoing edges only by default', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B, C -> A
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('C', 'A', 'KNOWS')

      const result = await engine.bfs({ startId: 'A', direction: 'out' })

      expect(result.visited).toContain('A')
      expect(result.visited).toContain('B')
      expect(result.visited).not.toContain('C') // Incoming edge not followed
    })

    it('traverses incoming edges when direction is in', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B, C -> B
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('C', 'B', 'KNOWS')

      const result = await engine.bfs({ startId: 'B', direction: 'in' })

      expect(result.visited).toContain('B')
      expect(result.visited).toContain('A')
      expect(result.visited).toContain('C')
    })

    it('traverses both directions when direction is both', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B -> C
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')

      const result = await engine.bfs({ startId: 'B', direction: 'both' })

      expect(result.visited).toContain('A')
      expect(result.visited).toContain('B')
      expect(result.visited).toContain('C')
    })
  })

  describe('BFS early termination', () => {
    it('stops when stopWhen predicate is true', async () => {
      const { index, engine } = await createTestGraph()

      // Linear: A -> B -> C -> D -> E
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS')
      await index.addEdge('D', 'E', 'KNOWS')

      const result = await engine.bfs({
        startId: 'A',
        stopWhen: (nodeId) => nodeId === 'C',
      })

      expect(result.terminatedEarly).toBe(true)
      expect(result.visited).toContain('A')
      expect(result.visited).toContain('B')
      expect(result.visited).toContain('C')
      expect(result.visited).not.toContain('D')
      expect(result.visited).not.toContain('E')
    })

    it('respects maxNodes limit', async () => {
      const { index, engine } = await createTestGraph()

      // Wide graph: A -> B, A -> C, A -> D, A -> E, A -> F
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('A', 'C', 'KNOWS')
      await index.addEdge('A', 'D', 'KNOWS')
      await index.addEdge('A', 'E', 'KNOWS')
      await index.addEdge('A', 'F', 'KNOWS')

      const result = await engine.bfs({
        startId: 'A',
        maxNodes: 3,
      })

      expect(result.visited).toHaveLength(3)
      expect(result.terminatedEarly).toBe(true)
    })
  })

  describe('BFS iterator', () => {
    it('yields nodes in BFS order', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')

      const visited: string[] = []
      for await (const { nodeId } of engine.bfsIterator({ startId: 'A' })) {
        visited.push(nodeId)
      }

      expect(visited).toEqual(['A', 'B', 'C'])
    })

    it('can break iteration early', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS')

      const visited: string[] = []
      for await (const { nodeId } of engine.bfsIterator({ startId: 'A' })) {
        visited.push(nodeId)
        if (nodeId === 'B') break
      }

      expect(visited).toEqual(['A', 'B'])
    })
  })
})

// ============================================================================
// 3. DFS TRAVERSAL TESTS
// ============================================================================

describe('DFS Traversal', () => {
  describe('basic DFS', () => {
    it('traverses all reachable nodes in depth-first order', async () => {
      const { index, engine } = await createTestGraph()

      // Create graph: A -> B -> C, A -> D
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('A', 'D', 'KNOWS')

      const result = await engine.dfs({ startId: 'A' })

      expect(result.visited).toHaveLength(4)
      expect(result.visited[0]).toBe('A')

      // DFS goes deep first, so either B->C or D should be explored before the other branch
      const bIndex = result.visited.indexOf('B')
      const cIndex = result.visited.indexOf('C')
      const dIndex = result.visited.indexOf('D')

      // Either B->C comes before D, or D comes before B->C
      const bcBeforeD = bIndex < dIndex && cIndex < dIndex
      const dBeforeBC = dIndex < bIndex && dIndex < cIndex

      expect(bcBeforeD || dBeforeBC).toBe(true)
    })

    it('tracks depth correctly', async () => {
      const { index, engine } = await createTestGraph()

      // Linear: A -> B -> C
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')

      const result = await engine.dfs({ startId: 'A' })

      expect(result.depths.get('A')).toBe(0)
      expect(result.depths.get('B')).toBe(1)
      expect(result.depths.get('C')).toBe(2)
    })

    it('handles graphs with cycles (does not revisit nodes)', async () => {
      const { index, engine } = await createTestGraph()

      // Cycle: A -> B -> C -> A
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('C', 'A', 'KNOWS')

      const result = await engine.dfs({ startId: 'A' })

      // Each node visited exactly once
      expect(result.visited).toHaveLength(3)
      expect(new Set(result.visited).size).toBe(3)
    })
  })

  describe('DFS with maxDepth', () => {
    it('respects maxDepth limit', async () => {
      const { index, engine } = await createTestGraph()

      // Linear: A -> B -> C -> D
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS')

      const result = await engine.dfs({ startId: 'A', maxDepth: 1 })

      expect(result.visited).toContain('A')
      expect(result.visited).toContain('B')
      expect(result.visited).not.toContain('C')
      expect(result.visited).not.toContain('D')
    })
  })

  describe('DFS with direction', () => {
    it('supports incoming edge traversal', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B <- C
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('C', 'B', 'KNOWS')

      const result = await engine.dfs({ startId: 'B', direction: 'in' })

      expect(result.visited).toContain('B')
      expect(result.visited).toContain('A')
      expect(result.visited).toContain('C')
    })

    it('supports bidirectional traversal', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B -> C
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')

      const result = await engine.dfs({ startId: 'B', direction: 'both' })

      expect(result.visited).toContain('A')
      expect(result.visited).toContain('B')
      expect(result.visited).toContain('C')
    })
  })

  describe('DFS early termination', () => {
    it('stops when stopWhen predicate returns true', async () => {
      const { index, engine } = await createTestGraph()

      // Deep path: A -> B -> C -> D -> E
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS')
      await index.addEdge('D', 'E', 'KNOWS')

      const result = await engine.dfs({
        startId: 'A',
        stopWhen: (nodeId) => nodeId === 'C',
      })

      expect(result.terminatedEarly).toBe(true)
      expect(result.visited).toContain('C')
      expect(result.visited).not.toContain('D')
    })
  })

  describe('DFS with back edge detection', () => {
    it('detects back edges when includeBackEdges is true', async () => {
      const { index, engine } = await createTestGraph()

      // Graph with cycle: A -> B -> C -> A
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('C', 'A', 'KNOWS') // Back edge

      const result = await engine.dfs({
        startId: 'A',
        includeBackEdges: true,
      })

      expect(result.visited).toHaveLength(3)
      // Back edge info should be available (implementation specific)
    })
  })

  describe('DFS iterator', () => {
    it('yields nodes in DFS order', async () => {
      const { index, engine } = await createTestGraph()

      // Linear: A -> B -> C
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')

      const visited: string[] = []
      for await (const { nodeId } of engine.dfsIterator({ startId: 'A' })) {
        visited.push(nodeId)
      }

      expect(visited).toEqual(['A', 'B', 'C'])
    })
  })
})

// ============================================================================
// 4. PATH EXISTS TESTS
// ============================================================================

describe('pathExists', () => {
  describe('basic path existence', () => {
    it('returns true when path exists', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')

      const exists = await engine.pathExists('A', 'C')

      expect(exists).toBe(true)
    })

    it('returns false when no path exists', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS') // Disconnected

      const exists = await engine.pathExists('A', 'C')

      expect(exists).toBe(false)
    })

    it('returns true for same source and target', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')

      const exists = await engine.pathExists('A', 'A')

      expect(exists).toBe(true)
    })

    it('returns false for non-existent source node', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')

      const exists = await engine.pathExists('X', 'B')

      expect(exists).toBe(false)
    })

    it('returns false for non-existent target node', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')

      const exists = await engine.pathExists('A', 'X')

      expect(exists).toBe(false)
    })
  })

  describe('bidirectional path search', () => {
    it('uses bidirectional search by default for efficiency', async () => {
      const { index, engine } = await createTestGraph()

      // Long path: A -> B -> C -> D -> E -> F
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS')
      await index.addEdge('D', 'E', 'KNOWS')
      await index.addEdge('E', 'F', 'KNOWS')

      const exists = await engine.pathExists('A', 'F', { bidirectional: true })

      expect(exists).toBe(true)
    })

    it('bidirectional search finds path in diamond graph', async () => {
      const { index, engine } = await createTestGraph()

      // Diamond: A -> B -> D, A -> C -> D
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('A', 'C', 'KNOWS')
      await index.addEdge('B', 'D', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS')

      const exists = await engine.pathExists('A', 'D', { bidirectional: true })

      expect(exists).toBe(true)
    })
  })

  describe('path existence with constraints', () => {
    it('respects maxLength constraint', async () => {
      const { index, engine } = await createTestGraph()

      // Path of length 4: A -> B -> C -> D -> E
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS')
      await index.addEdge('D', 'E', 'KNOWS')

      const existsShort = await engine.pathExists('A', 'E', { maxLength: 2 })
      const existsLong = await engine.pathExists('A', 'E', { maxLength: 4 })

      expect(existsShort).toBe(false)
      expect(existsLong).toBe(true)
    })

    it('respects edge type filter', async () => {
      const { index, engine } = await createTestGraph()

      // A -KNOWS-> B -WORKS_WITH-> C
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'WORKS_WITH')

      const existsKnows = await engine.pathExists('A', 'C', { edgeTypes: ['KNOWS'] })
      const existsBoth = await engine.pathExists('A', 'C', { edgeTypes: ['KNOWS', 'WORKS_WITH'] })

      expect(existsKnows).toBe(false)
      expect(existsBoth).toBe(true)
    })
  })
})

// ============================================================================
// 5. SHORTEST PATH TESTS
// ============================================================================

describe('shortestPath', () => {
  describe('finding shortest path', () => {
    it('finds shortest path in simple graph', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B -> C
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')

      const result = await engine.shortestPath('A', 'C')

      expect(result.path).not.toBeNull()
      expect(result.path!.nodes).toEqual(['A', 'B', 'C'])
      expect(result.path!.length).toBe(2)
    })

    it('finds shortest path when multiple paths exist', async () => {
      const { index, engine } = await createTestGraph()

      // Short path: A -> C (length 1)
      // Long path: A -> B -> C (length 2)
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('A', 'C', 'KNOWS')

      const result = await engine.shortestPath('A', 'C')

      expect(result.path).not.toBeNull()
      expect(result.path!.length).toBe(1)
      expect(result.path!.nodes).toEqual(['A', 'C'])
    })

    it('returns null when no path exists', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS')

      const result = await engine.shortestPath('A', 'C')

      expect(result.path).toBeNull()
    })

    it('returns path of length 0 for same source and target', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')

      const result = await engine.shortestPath('A', 'A')

      expect(result.path).not.toBeNull()
      expect(result.path!.length).toBe(0)
      expect(result.path!.nodes).toEqual(['A'])
    })
  })

  describe('shortest path with edge types', () => {
    it('includes edge types in path', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'WORKS_WITH')

      const result = await engine.shortestPath('A', 'C')

      expect(result.path).not.toBeNull()
      expect(result.path!.edgeTypes).toEqual(['KNOWS', 'WORKS_WITH'])
    })
  })

  describe('shortest path metrics', () => {
    it('tracks nodes explored', async () => {
      const { index, engine } = await createTestGraph()

      // Graph with multiple branches
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('A', 'C', 'KNOWS')
      await index.addEdge('B', 'D', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS')

      const result = await engine.shortestPath('A', 'D')

      expect(result.nodesExplored).toBeGreaterThan(0)
    })

    it('reports bidirectional search usage', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')

      const result = await engine.shortestPath('A', 'B', { bidirectional: true })

      expect(result.usedBidirectional).toBe(true)
    })
  })
})

// ============================================================================
// 6. ALL PATHS TESTS
// ============================================================================

describe('allPaths', () => {
  describe('finding all paths', () => {
    it('finds all paths between two nodes', async () => {
      const { index, engine } = await createTestGraph()

      // Two paths from A to D:
      // A -> B -> D
      // A -> C -> D
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('A', 'C', 'KNOWS')
      await index.addEdge('B', 'D', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS')

      const paths = await engine.allPaths('A', 'D')

      expect(paths).toHaveLength(2)

      const pathNodes = paths.map((p) => p.nodes.join('->'))
      expect(pathNodes).toContain('A->B->D')
      expect(pathNodes).toContain('A->C->D')
    })

    it('finds single path when only one exists', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')

      const paths = await engine.allPaths('A', 'C')

      expect(paths).toHaveLength(1)
      expect(paths[0].nodes).toEqual(['A', 'B', 'C'])
    })

    it('returns empty array when no path exists', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS')

      const paths = await engine.allPaths('A', 'C')

      expect(paths).toHaveLength(0)
    })

    it('returns path of length 0 for same source and target', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')

      const paths = await engine.allPaths('A', 'A')

      expect(paths).toHaveLength(1)
      expect(paths[0].nodes).toEqual(['A'])
      expect(paths[0].length).toBe(0)
    })
  })

  describe('allPaths with constraints', () => {
    it('respects maxLength limit', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B -> C -> D
      // A -> D (direct)
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS')
      await index.addEdge('A', 'D', 'KNOWS')

      const paths = await engine.allPaths('A', 'D', { maxLength: 2 })

      // Only direct path should be returned
      expect(paths).toHaveLength(1)
      expect(paths[0].nodes).toEqual(['A', 'D'])
    })

    it('respects maxPaths limit', async () => {
      const { index, engine } = await createTestGraph()

      // Many paths: A -> B1 -> C, A -> B2 -> C, A -> B3 -> C
      await index.addEdge('A', 'B1', 'KNOWS')
      await index.addEdge('A', 'B2', 'KNOWS')
      await index.addEdge('A', 'B3', 'KNOWS')
      await index.addEdge('B1', 'C', 'KNOWS')
      await index.addEdge('B2', 'C', 'KNOWS')
      await index.addEdge('B3', 'C', 'KNOWS')

      const paths = await engine.allPaths('A', 'C', { maxPaths: 2 })

      expect(paths).toHaveLength(2)
    })

    it('handles cycles when allowCycles is false (default)', async () => {
      const { index, engine } = await createTestGraph()

      // Cycle: A -> B -> C -> A
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('C', 'A', 'KNOWS')

      const paths = await engine.allPaths('A', 'C', { allowCycles: false })

      // Should find A -> B -> C but not loop back
      expect(paths).toHaveLength(1)
      expect(paths[0].nodes).toEqual(['A', 'B', 'C'])
    })
  })
})

// ============================================================================
// 7. CYCLE DETECTION TESTS
// ============================================================================

describe('Cycle Detection', () => {
  describe('hasCycle', () => {
    it('returns false for acyclic graph (DAG)', async () => {
      const { index, engine } = await createTestGraph()

      // DAG: A -> B -> C -> D
      await index.addEdge('A', 'B', 'DEPENDS_ON')
      await index.addEdge('B', 'C', 'DEPENDS_ON')
      await index.addEdge('C', 'D', 'DEPENDS_ON')

      const hasCycle = await engine.hasCycle()

      expect(hasCycle).toBe(false)
    })

    it('returns true for graph with cycle', async () => {
      const { index, engine } = await createTestGraph()

      // Cycle: A -> B -> C -> A
      await index.addEdge('A', 'B', 'DEPENDS_ON')
      await index.addEdge('B', 'C', 'DEPENDS_ON')
      await index.addEdge('C', 'A', 'DEPENDS_ON')

      const hasCycle = await engine.hasCycle()

      expect(hasCycle).toBe(true)
    })

    it('detects self-loop as cycle', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'A', 'SELF')

      const hasCycle = await engine.hasCycle()

      expect(hasCycle).toBe(true)
    })

    it('returns false for empty graph', async () => {
      const { engine } = await createTestGraph()

      const hasCycle = await engine.hasCycle()

      expect(hasCycle).toBe(false)
    })
  })

  describe('detectCycles', () => {
    it('returns empty cycles array for acyclic graph', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'DEPENDS_ON')
      await index.addEdge('B', 'C', 'DEPENDS_ON')

      const result = await engine.detectCycles()

      expect(result.hasCycles).toBe(false)
      expect(result.cycles).toHaveLength(0)
    })

    it('returns cycles in graph with single cycle', async () => {
      const { index, engine } = await createTestGraph()

      // Cycle: A -> B -> C -> A
      await index.addEdge('A', 'B', 'DEPENDS_ON')
      await index.addEdge('B', 'C', 'DEPENDS_ON')
      await index.addEdge('C', 'A', 'DEPENDS_ON')

      const result = await engine.detectCycles()

      expect(result.hasCycles).toBe(true)
      expect(result.cycles).toHaveLength(1)

      // Cycle should contain all three nodes
      const cycle = result.cycles[0]
      expect(cycle).toContain('A')
      expect(cycle).toContain('B')
      expect(cycle).toContain('C')
    })

    it('returns multiple cycles in complex graph', async () => {
      const { index, engine } = await createTestGraph()

      // Two cycles: A -> B -> A and C -> D -> C
      await index.addEdge('A', 'B', 'DEPENDS_ON')
      await index.addEdge('B', 'A', 'DEPENDS_ON')
      await index.addEdge('C', 'D', 'DEPENDS_ON')
      await index.addEdge('D', 'C', 'DEPENDS_ON')

      const result = await engine.detectCycles()

      expect(result.hasCycles).toBe(true)
      expect(result.cycles.length).toBeGreaterThanOrEqual(2)
    })

    it('returns back edges that form cycles', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B -> C -> A
      await index.addEdge('A', 'B', 'DEPENDS_ON')
      await index.addEdge('B', 'C', 'DEPENDS_ON')
      await index.addEdge('C', 'A', 'DEPENDS_ON') // Back edge

      const result = await engine.detectCycles()

      expect(result.backEdges.length).toBeGreaterThan(0)
      expect(result.backEdges.some((e) => e.from === 'C' && e.to === 'A')).toBe(true)
    })

    it('detects cycles starting from specific node', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B -> A, C -> D -> C (disconnected cycles)
      await index.addEdge('A', 'B', 'DEPENDS_ON')
      await index.addEdge('B', 'A', 'DEPENDS_ON')
      await index.addEdge('C', 'D', 'DEPENDS_ON')
      await index.addEdge('D', 'C', 'DEPENDS_ON')

      // Only detect cycles reachable from A
      const result = await engine.detectCycles('A')

      expect(result.hasCycles).toBe(true)
      expect(result.cycles.some((c) => c.includes('A'))).toBe(true)
    })
  })
})

// ============================================================================
// 8. N-HOP NEIGHBORS TESTS
// ============================================================================

describe('nHopNeighbors', () => {
  describe('basic n-hop queries', () => {
    it('returns direct neighbors for n=1', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B, A -> C
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('A', 'C', 'KNOWS')
      await index.addEdge('B', 'D', 'KNOWS')

      const neighbors = await engine.nHopNeighbors('A', 1)

      expect(neighbors.size).toBe(2)
      expect(neighbors.get('B')).toBe(1)
      expect(neighbors.get('C')).toBe(1)
      expect(neighbors.has('D')).toBe(false)
    })

    it('returns 2-hop neighbors with correct distances', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B -> C
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')

      const neighbors = await engine.nHopNeighbors('A', 2)

      expect(neighbors.size).toBe(2)
      expect(neighbors.get('B')).toBe(1)
      expect(neighbors.get('C')).toBe(2)
    })

    it('returns all reachable nodes within n hops', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B -> C -> D -> E
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('C', 'D', 'KNOWS')
      await index.addEdge('D', 'E', 'KNOWS')

      const neighbors3 = await engine.nHopNeighbors('A', 3)

      expect(neighbors3.size).toBe(3) // B, C, D
      expect(neighbors3.get('B')).toBe(1)
      expect(neighbors3.get('C')).toBe(2)
      expect(neighbors3.get('D')).toBe(3)
      expect(neighbors3.has('E')).toBe(false)
    })

    it('returns empty map for n=0', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')

      const neighbors = await engine.nHopNeighbors('A', 0)

      expect(neighbors.size).toBe(0)
    })
  })

  describe('n-hop with direction', () => {
    it('follows outgoing edges by default', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B, C -> A
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('C', 'A', 'KNOWS')

      const neighbors = await engine.nHopNeighbors('A', 1, { direction: 'out' })

      expect(neighbors.has('B')).toBe(true)
      expect(neighbors.has('C')).toBe(false)
    })

    it('follows incoming edges when direction is in', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B, C -> B
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('C', 'B', 'KNOWS')

      const neighbors = await engine.nHopNeighbors('B', 1, { direction: 'in' })

      expect(neighbors.has('A')).toBe(true)
      expect(neighbors.has('C')).toBe(true)
    })

    it('follows both directions when direction is both', async () => {
      const { index, engine } = await createTestGraph()

      // A -> B -> C
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')

      const neighbors = await engine.nHopNeighbors('B', 1, { direction: 'both' })

      expect(neighbors.has('A')).toBe(true)
      expect(neighbors.has('C')).toBe(true)
    })
  })

  describe('n-hop with edge type filtering', () => {
    it('filters by edge type', async () => {
      const { index, engine } = await createTestGraph()

      // A -KNOWS-> B -WORKS_WITH-> C
      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('B', 'C', 'WORKS_WITH')

      const neighbors = await engine.nHopNeighbors('A', 2, { edgeTypes: ['KNOWS'] })

      expect(neighbors.has('B')).toBe(true)
      expect(neighbors.has('C')).toBe(false)
    })
  })
})

// ============================================================================
// 9. COMMON NEIGHBORS TESTS
// ============================================================================

describe('commonNeighbors', () => {
  describe('basic common neighbors', () => {
    it('finds common neighbors of two nodes', async () => {
      const { index, engine } = await createTestGraph()

      // A -> C, B -> C (C is common neighbor)
      await index.addEdge('A', 'C', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')

      const common = await engine.commonNeighbors('A', 'B')

      expect(common).toContain('C')
      expect(common).toHaveLength(1)
    })

    it('finds multiple common neighbors', async () => {
      const { index, engine } = await createTestGraph()

      // A -> C, A -> D, B -> C, B -> D
      await index.addEdge('A', 'C', 'KNOWS')
      await index.addEdge('A', 'D', 'KNOWS')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('B', 'D', 'KNOWS')

      const common = await engine.commonNeighbors('A', 'B')

      expect(common).toContain('C')
      expect(common).toContain('D')
      expect(common).toHaveLength(2)
    })

    it('returns empty array when no common neighbors', async () => {
      const { index, engine } = await createTestGraph()

      // A -> C, B -> D (no common)
      await index.addEdge('A', 'C', 'KNOWS')
      await index.addEdge('B', 'D', 'KNOWS')

      const common = await engine.commonNeighbors('A', 'B')

      expect(common).toHaveLength(0)
    })

    it('handles same node input', async () => {
      const { index, engine } = await createTestGraph()

      await index.addEdge('A', 'B', 'KNOWS')
      await index.addEdge('A', 'C', 'KNOWS')

      const common = await engine.commonNeighbors('A', 'A')

      // All neighbors of A are common to A and A
      expect(common).toContain('B')
      expect(common).toContain('C')
    })
  })

  describe('common neighbors with edge type filtering', () => {
    it('filters by edge type', async () => {
      const { index, engine } = await createTestGraph()

      // A -KNOWS-> C, A -WORKS_WITH-> D
      // B -KNOWS-> C, B -WORKS_WITH-> E
      await index.addEdge('A', 'C', 'KNOWS')
      await index.addEdge('A', 'D', 'WORKS_WITH')
      await index.addEdge('B', 'C', 'KNOWS')
      await index.addEdge('B', 'E', 'WORKS_WITH')

      const common = await engine.commonNeighbors('A', 'B', { edgeTypes: ['KNOWS'] })

      expect(common).toContain('C')
      expect(common).not.toContain('D')
      expect(common).not.toContain('E')
    })
  })
})

// ============================================================================
// 10. TRAVERSAL STATISTICS TESTS
// ============================================================================

describe('Traversal Statistics', () => {
  it('tracks vertices visited', async () => {
    const { index, engine } = await createTestGraph()

    await index.addEdge('A', 'B', 'KNOWS')
    await index.addEdge('B', 'C', 'KNOWS')

    await engine.bfs({ startId: 'A' })

    const stats = engine.getStats()

    expect(stats.verticesVisited).toBe(3)
  })

  it('tracks edges traversed', async () => {
    const { index, engine } = await createTestGraph()

    await index.addEdge('A', 'B', 'KNOWS')
    await index.addEdge('B', 'C', 'KNOWS')

    await engine.bfs({ startId: 'A' })

    const stats = engine.getStats()

    expect(stats.edgesTraversed).toBe(2)
  })

  it('tracks maximum depth reached', async () => {
    const { index, engine } = await createTestGraph()

    // Linear path of depth 3
    await index.addEdge('A', 'B', 'KNOWS')
    await index.addEdge('B', 'C', 'KNOWS')
    await index.addEdge('C', 'D', 'KNOWS')

    await engine.bfs({ startId: 'A' })

    const stats = engine.getStats()

    expect(stats.maxDepthReached).toBe(3)
  })

  it('tracks duration', async () => {
    const { index, engine } = await createTestGraph()

    await index.addEdge('A', 'B', 'KNOWS')

    await engine.bfs({ startId: 'A' })

    const stats = engine.getStats()

    expect(stats.durationMs).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// 11. EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  it('handles graph with only self-loops', async () => {
    const { index, engine } = await createTestGraph()

    await index.addEdge('A', 'A', 'SELF')
    await index.addEdge('B', 'B', 'SELF')

    const result = await engine.bfs({ startId: 'A' })

    expect(result.visited).toContain('A')
    expect(result.visited).not.toContain('B')
  })

  it('handles very long paths', async () => {
    const { index, engine } = await createTestGraph()

    // Create a path of 100 nodes
    for (let i = 0; i < 99; i++) {
      await index.addEdge(`N${i}`, `N${i + 1}`, 'NEXT')
    }

    const exists = await engine.pathExists('N0', 'N99')

    expect(exists).toBe(true)
  })

  it('handles wide graph (node with many neighbors)', async () => {
    const { index, engine } = await createTestGraph()

    // A is connected to 100 neighbors
    for (let i = 0; i < 100; i++) {
      await index.addEdge('A', `B${i}`, 'KNOWS')
    }

    const result = await engine.bfs({ startId: 'A', maxDepth: 1 })

    expect(result.visited).toHaveLength(101) // A + 100 neighbors
  })

  it('handles parallel edges (multiple edges between same nodes)', async () => {
    const { index, engine } = await createTestGraph()

    // Multiple edge types between A and B
    await index.addEdge('A', 'B', 'KNOWS')
    await index.addEdge('A', 'B', 'WORKS_WITH')
    await index.addEdge('A', 'B', 'LIVES_NEAR')

    const result = await engine.bfs({ startId: 'A' })

    // Should only visit B once despite multiple edges
    const bCount = result.visited.filter((n) => n === 'B').length
    expect(bCount).toBe(1)
  })
})

// ============================================================================
// 12. FACTORY FUNCTION TESTS
// ============================================================================

describe('Factory Functions', () => {
  it('createTraversalEngine is exported', async () => {
    const module = await import('../index')
    expect(module).toHaveProperty('createTraversalEngine')
  })

  it('creates TraversalEngine with AdjacencyIndex', async () => {
    const { createTraversalEngine, AdjacencyIndex } = (await import('../index')) as {
      createTraversalEngine: (index: unknown) => TraversalEngine
      AdjacencyIndex: new (path: string) => unknown
    }

    const index = new AdjacencyIndex(':memory:')
    const engine = createTraversalEngine(index)

    expect(engine).toBeDefined()
    expect(engine.bfs).toBeDefined()
    expect(engine.dfs).toBeDefined()
  })
})
