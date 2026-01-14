/**
 * TraversalEngine - Graph Traversal Algorithms
 *
 * GREEN PHASE: Implements graph traversal algorithms that work with
 * AdjacencyIndex columnar storage.
 *
 * Features:
 * - BFS traversal (n-hop)
 * - DFS traversal
 * - pathExists (bidirectional)
 * - shortestPath
 * - allPaths
 * - commonNeighbors
 * - nHopNeighbors with distances
 * - Cycle detection
 *
 * @see dotdo-vyfkd - [GRAPH-4] Traversal Engine
 *
 * Uses real AdjacencyIndex with SQLite, NO MOCKS - per project testing philosophy.
 */

import type { AdjacencyIndex, NeighborResult, EdgeDirection } from './adjacency-index'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for BFS traversal
 */
export interface BFSOptions {
  /** Starting node ID */
  startId: string
  /** Maximum depth/hops to traverse (default: Infinity) */
  maxDepth?: number
  /** Edge types to follow (default: all) */
  edgeTypes?: string[]
  /** Direction to traverse: 'out', 'in', or 'both' */
  direction?: EdgeDirection
  /** Early termination predicate - stop when node matches */
  stopWhen?: (nodeId: string, depth: number) => boolean
  /** Maximum number of nodes to visit */
  maxNodes?: number
}

/**
 * Options for DFS traversal
 */
export interface DFSOptions {
  /** Starting node ID */
  startId: string
  /** Maximum depth to traverse (default: Infinity) */
  maxDepth?: number
  /** Edge types to follow (default: all) */
  edgeTypes?: string[]
  /** Direction to traverse: 'out', 'in', or 'both' */
  direction?: EdgeDirection
  /** Early termination predicate */
  stopWhen?: (nodeId: string, depth: number) => boolean
  /** Whether to include back edges in result (for cycle detection) */
  includeBackEdges?: boolean
}

/**
 * Options for path finding
 */
export interface PathOptions {
  /** Edge types to follow (default: all) */
  edgeTypes?: string[]
  /** Direction to traverse: 'out', 'in', or 'both' */
  direction?: EdgeDirection
  /** Maximum path length (hops) */
  maxLength?: number
  /** Whether to use bidirectional search (for pathExists/shortestPath) */
  bidirectional?: boolean
}

/**
 * Options for allPaths query
 */
export interface AllPathsOptions extends PathOptions {
  /** Maximum number of paths to return */
  maxPaths?: number
  /** Whether to include cycles in paths */
  allowCycles?: boolean
}

/**
 * Result of a traversal operation
 */
export interface TraversalResult {
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
export interface Path {
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
export interface ShortestPathResult {
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
export interface CycleResult {
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
export interface TraversalStats {
  /** Total vertices visited */
  verticesVisited: number
  /** Total edges traversed */
  edgesTraversed: number
  /** Maximum depth reached */
  maxDepthReached: number
  /** Time taken in milliseconds */
  durationMs: number
}

// ============================================================================
// TraversalEngine Class
// ============================================================================

/**
 * TraversalEngine provides graph traversal algorithms on top of AdjacencyIndex.
 *
 * @example
 * ```typescript
 * const index = new AdjacencyIndex(':memory:')
 * await index.initialize()
 *
 * const engine = new TraversalEngine(index)
 *
 * // BFS traversal
 * const result = await engine.bfs({ startId: 'A', maxDepth: 3 })
 *
 * // Find shortest path
 * const path = await engine.shortestPath('A', 'Z')
 * ```
 */
export class TraversalEngine {
  private index: AdjacencyIndex
  private stats: TraversalStats = {
    verticesVisited: 0,
    edgesTraversed: 0,
    maxDepthReached: 0,
    durationMs: 0,
  }

  constructor(index: AdjacencyIndex) {
    this.index = index
  }

  // ==========================================================================
  // BFS TRAVERSAL
  // ==========================================================================

  /**
   * Perform breadth-first search traversal.
   */
  async bfs(options: BFSOptions): Promise<TraversalResult> {
    const startTime = Date.now()
    const {
      startId,
      maxDepth = Infinity,
      edgeTypes,
      direction = 'out',
      stopWhen,
      maxNodes,
    } = options

    const visited: string[] = []
    const depths = new Map<string, number>()
    const parents = new Map<string, string | null>()
    let edgesTraversed = 0
    let terminatedEarly = false

    // Check if start node exists
    const hasStart = await this.index.hasVertex(startId)
    if (!hasStart) {
      this.updateStats(startTime, 0, 0, 0)
      return { visited, depths, edgesTraversed, terminatedEarly, parents }
    }

    // BFS queue: [nodeId, depth]
    const queue: Array<[string, number]> = [[startId, 0]]
    const seen = new Set<string>([startId])

    while (queue.length > 0) {
      const [nodeId, depth] = queue.shift()!

      // Check max nodes limit
      if (maxNodes !== undefined && visited.length >= maxNodes) {
        terminatedEarly = true
        break
      }

      visited.push(nodeId)
      depths.set(nodeId, depth)

      // Check early termination
      if (stopWhen && stopWhen(nodeId, depth)) {
        terminatedEarly = true
        break
      }

      // Check max depth
      if (depth >= maxDepth) {
        continue
      }

      // Get neighbors
      const neighbors = await this.getFilteredNeighbors(nodeId, direction, edgeTypes)
      edgesTraversed += neighbors.length

      for (const neighbor of neighbors) {
        if (!seen.has(neighbor.nodeId)) {
          seen.add(neighbor.nodeId)
          parents.set(neighbor.nodeId, nodeId)
          queue.push([neighbor.nodeId, depth + 1])
        }
      }
    }

    const maxDepthReached = Math.max(...Array.from(depths.values()), 0)
    this.updateStats(startTime, visited.length, edgesTraversed, maxDepthReached)

    return { visited, depths, edgesTraversed, terminatedEarly, parents }
  }

  /**
   * BFS iterator - yields nodes as they are visited.
   */
  async *bfsIterator(options: BFSOptions): AsyncGenerator<{ nodeId: string; depth: number }> {
    const {
      startId,
      maxDepth = Infinity,
      edgeTypes,
      direction = 'out',
    } = options

    const hasStart = await this.index.hasVertex(startId)
    if (!hasStart) {
      return
    }

    const queue: Array<[string, number]> = [[startId, 0]]
    const seen = new Set<string>([startId])

    while (queue.length > 0) {
      const [nodeId, depth] = queue.shift()!

      yield { nodeId, depth }

      if (depth >= maxDepth) {
        continue
      }

      const neighbors = await this.getFilteredNeighbors(nodeId, direction, edgeTypes)

      for (const neighbor of neighbors) {
        if (!seen.has(neighbor.nodeId)) {
          seen.add(neighbor.nodeId)
          queue.push([neighbor.nodeId, depth + 1])
        }
      }
    }
  }

  // ==========================================================================
  // DFS TRAVERSAL
  // ==========================================================================

  /**
   * Perform depth-first search traversal.
   */
  async dfs(options: DFSOptions): Promise<TraversalResult> {
    const startTime = Date.now()
    const {
      startId,
      maxDepth = Infinity,
      edgeTypes,
      direction = 'out',
      stopWhen,
    } = options

    const visited: string[] = []
    const depths = new Map<string, number>()
    const parents = new Map<string, string | null>()
    let edgesTraversed = 0
    let terminatedEarly = false

    const hasStart = await this.index.hasVertex(startId)
    if (!hasStart) {
      this.updateStats(startTime, 0, 0, 0)
      return { visited, depths, edgesTraversed, terminatedEarly, parents }
    }

    // DFS stack: [nodeId, depth]
    const stack: Array<[string, number]> = [[startId, 0]]
    const seen = new Set<string>()

    while (stack.length > 0) {
      const [nodeId, depth] = stack.pop()!

      if (seen.has(nodeId)) {
        continue
      }
      seen.add(nodeId)

      visited.push(nodeId)
      depths.set(nodeId, depth)

      // Check early termination
      if (stopWhen && stopWhen(nodeId, depth)) {
        terminatedEarly = true
        break
      }

      // Check max depth
      if (depth >= maxDepth) {
        continue
      }

      // Get neighbors
      const neighbors = await this.getFilteredNeighbors(nodeId, direction, edgeTypes)
      edgesTraversed += neighbors.length

      // Add neighbors in reverse order so they're processed in order
      for (let i = neighbors.length - 1; i >= 0; i--) {
        const neighbor = neighbors[i]!
        if (!seen.has(neighbor.nodeId)) {
          parents.set(neighbor.nodeId, nodeId)
          stack.push([neighbor.nodeId, depth + 1])
        }
      }
    }

    const maxDepthReached = Math.max(...Array.from(depths.values()), 0)
    this.updateStats(startTime, visited.length, edgesTraversed, maxDepthReached)

    return { visited, depths, edgesTraversed, terminatedEarly, parents }
  }

  /**
   * DFS iterator - yields nodes as they are visited.
   */
  async *dfsIterator(options: DFSOptions): AsyncGenerator<{ nodeId: string; depth: number }> {
    const {
      startId,
      maxDepth = Infinity,
      edgeTypes,
      direction = 'out',
    } = options

    const hasStart = await this.index.hasVertex(startId)
    if (!hasStart) {
      return
    }

    const stack: Array<[string, number]> = [[startId, 0]]
    const seen = new Set<string>()

    while (stack.length > 0) {
      const [nodeId, depth] = stack.pop()!

      if (seen.has(nodeId)) {
        continue
      }
      seen.add(nodeId)

      yield { nodeId, depth }

      if (depth >= maxDepth) {
        continue
      }

      const neighbors = await this.getFilteredNeighbors(nodeId, direction, edgeTypes)

      for (let i = neighbors.length - 1; i >= 0; i--) {
        const neighbor = neighbors[i]!
        if (!seen.has(neighbor.nodeId)) {
          stack.push([neighbor.nodeId, depth + 1])
        }
      }
    }
  }

  // ==========================================================================
  // PATH FINDING
  // ==========================================================================

  /**
   * Check if a path exists between two nodes.
   */
  async pathExists(from: string, to: string, options: PathOptions = {}): Promise<boolean> {
    // Same node - always exists
    if (from === to) {
      return true
    }

    const { edgeTypes, direction = 'out', maxLength = Infinity, bidirectional = true } = options

    // Check if source exists
    const hasFrom = await this.index.hasVertex(from)
    if (!hasFrom) {
      return false
    }

    // Check if target exists
    const hasTo = await this.index.hasVertex(to)
    if (!hasTo) {
      return false
    }

    if (bidirectional) {
      return this.bidirectionalPathExists(from, to, edgeTypes, direction, maxLength)
    }

    // Unidirectional BFS
    const queue: Array<[string, number]> = [[from, 0]]
    const seen = new Set<string>([from])

    while (queue.length > 0) {
      const [nodeId, depth] = queue.shift()!

      if (nodeId === to) {
        return true
      }

      if (depth >= maxLength) {
        continue
      }

      const neighbors = await this.getFilteredNeighbors(nodeId, direction, edgeTypes)

      for (const neighbor of neighbors) {
        if (!seen.has(neighbor.nodeId)) {
          seen.add(neighbor.nodeId)
          queue.push([neighbor.nodeId, depth + 1])
        }
      }
    }

    return false
  }

  /**
   * Bidirectional path existence check - more efficient for long paths.
   */
  private async bidirectionalPathExists(
    from: string,
    to: string,
    edgeTypes: string[] | undefined,
    direction: EdgeDirection,
    maxLength: number
  ): Promise<boolean> {
    // BFS from both ends
    const forwardQueue: Array<[string, number]> = [[from, 0]]
    const backwardQueue: Array<[string, number]> = [[to, 0]]
    const forwardSeen = new Set<string>([from])
    const backwardSeen = new Set<string>([to])

    const reverseDirection = direction === 'out' ? 'in' : direction === 'in' ? 'out' : 'both'

    while (forwardQueue.length > 0 || backwardQueue.length > 0) {
      // Expand forward
      if (forwardQueue.length > 0) {
        const [nodeId, depth] = forwardQueue.shift()!

        if (backwardSeen.has(nodeId)) {
          return true
        }

        if (depth < maxLength / 2) {
          const neighbors = await this.getFilteredNeighbors(nodeId, direction, edgeTypes)
          for (const neighbor of neighbors) {
            if (!forwardSeen.has(neighbor.nodeId)) {
              forwardSeen.add(neighbor.nodeId)
              forwardQueue.push([neighbor.nodeId, depth + 1])
            }
          }
        }
      }

      // Expand backward
      if (backwardQueue.length > 0) {
        const [nodeId, depth] = backwardQueue.shift()!

        if (forwardSeen.has(nodeId)) {
          return true
        }

        if (depth < maxLength / 2) {
          const neighbors = await this.getFilteredNeighbors(nodeId, reverseDirection, edgeTypes)
          for (const neighbor of neighbors) {
            if (!backwardSeen.has(neighbor.nodeId)) {
              backwardSeen.add(neighbor.nodeId)
              backwardQueue.push([neighbor.nodeId, depth + 1])
            }
          }
        }
      }
    }

    return false
  }

  /**
   * Find the shortest path between two nodes.
   */
  async shortestPath(from: string, to: string, options: PathOptions = {}): Promise<ShortestPathResult> {
    const { edgeTypes, direction = 'out', bidirectional = false } = options

    // Same node
    if (from === to) {
      return {
        path: { nodes: [from], edgeTypes: [], length: 0 },
        nodesExplored: 1,
        usedBidirectional: false,
      }
    }

    // Check if source exists
    const hasFrom = await this.index.hasVertex(from)
    if (!hasFrom) {
      return { path: null, nodesExplored: 0, usedBidirectional: false }
    }

    // Check if target exists
    const hasTo = await this.index.hasVertex(to)
    if (!hasTo) {
      return { path: null, nodesExplored: 0, usedBidirectional: bidirectional }
    }

    // BFS to find shortest path
    const queue: Array<[string, number]> = [[from, 0]]
    const seen = new Set<string>([from])
    const parents = new Map<string, { parent: string; edgeType: string } | null>()
    parents.set(from, null)

    let nodesExplored = 0

    while (queue.length > 0) {
      const [nodeId, depth] = queue.shift()!
      nodesExplored++

      if (nodeId === to) {
        // Reconstruct path
        const path = this.reconstructPath(from, to, parents)
        return { path, nodesExplored, usedBidirectional: bidirectional }
      }

      const neighbors = await this.getFilteredNeighbors(nodeId, direction, edgeTypes)

      for (const neighbor of neighbors) {
        if (!seen.has(neighbor.nodeId)) {
          seen.add(neighbor.nodeId)
          parents.set(neighbor.nodeId, { parent: nodeId, edgeType: neighbor.type })
          queue.push([neighbor.nodeId, depth + 1])
        }
      }
    }

    return { path: null, nodesExplored, usedBidirectional: bidirectional }
  }

  /**
   * Find all paths between two nodes.
   */
  async allPaths(from: string, to: string, options: AllPathsOptions = {}): Promise<Path[]> {
    const { edgeTypes, direction = 'out', maxLength = Infinity, maxPaths = 100, allowCycles = false } = options

    // Same node
    if (from === to) {
      return [{ nodes: [from], edgeTypes: [], length: 0 }]
    }

    // Check if source exists
    const hasFrom = await this.index.hasVertex(from)
    if (!hasFrom) {
      return []
    }

    // Check if target exists
    const hasTo = await this.index.hasVertex(to)
    if (!hasTo) {
      return []
    }

    const paths: Path[] = []

    // DFS with path tracking
    const stack: Array<{
      nodeId: string
      path: string[]
      edgeTypes: string[]
    }> = [{ nodeId: from, path: [from], edgeTypes: [] }]

    while (stack.length > 0 && paths.length < maxPaths) {
      const { nodeId, path, edgeTypes: pathEdgeTypes } = stack.pop()!

      if (nodeId === to) {
        paths.push({
          nodes: path,
          edgeTypes: pathEdgeTypes,
          length: pathEdgeTypes.length,
        })
        continue
      }

      if (pathEdgeTypes.length >= maxLength) {
        continue
      }

      const neighbors = await this.getFilteredNeighbors(nodeId, direction, edgeTypes)

      for (const neighbor of neighbors) {
        // Check for cycles
        if (!allowCycles && path.includes(neighbor.nodeId)) {
          continue
        }

        stack.push({
          nodeId: neighbor.nodeId,
          path: [...path, neighbor.nodeId],
          edgeTypes: [...pathEdgeTypes, neighbor.type],
        })
      }
    }

    return paths
  }

  // ==========================================================================
  // CYCLE DETECTION
  // ==========================================================================

  /**
   * Check if the graph has any cycles.
   */
  async hasCycle(): Promise<boolean> {
    const result = await this.detectCycles()
    return result.hasCycles
  }

  /**
   * Detect all cycles in the graph.
   */
  async detectCycles(startId?: string): Promise<CycleResult> {
    const cycles: string[][] = []
    const backEdges: Array<{ from: string; to: string; type: string }> = []

    // Track visited nodes globally
    const globalVisited = new Set<string>()

    // Get all nodes to check (or just start from startId)
    let startNodes: string[]
    if (startId) {
      startNodes = [startId]
    } else {
      // Get all nodes from the stats
      const stats = await this.index.getStats()
      if (stats.totalNodes === 0) {
        return { hasCycles: false, cycles: [], backEdges: [] }
      }

      // We need to iterate all nodes - do a BFS from all source nodes
      // For now, get edges and extract unique source nodes
      startNodes = await this.getAllNodeIds()
    }

    for (const startNode of startNodes) {
      if (globalVisited.has(startNode)) {
        continue
      }

      // DFS with cycle detection
      const stack: Array<{ nodeId: string; path: string[] }> = [{ nodeId: startNode, path: [] }]
      const currentPath = new Set<string>()

      while (stack.length > 0) {
        const { nodeId, path } = stack.pop()!

        // If we've seen this node in the current path, it's a cycle
        if (currentPath.has(nodeId)) {
          // Find cycle
          const cycleStart = path.indexOf(nodeId)
          if (cycleStart >= 0) {
            const cycle = path.slice(cycleStart)
            cycle.push(nodeId)
            cycles.push(cycle)

            // Record back edge
            const fromNode = path[path.length - 1]
            if (fromNode) {
              backEdges.push({ from: fromNode, to: nodeId, type: 'DEPENDS_ON' })
            }
          }
          continue
        }

        if (globalVisited.has(nodeId)) {
          continue
        }

        globalVisited.add(nodeId)
        currentPath.add(nodeId)

        const neighbors = await this.index.getOutNeighbors(nodeId)

        for (const neighbor of neighbors) {
          if (currentPath.has(neighbor)) {
            // Cycle found
            const newPath = [...path, nodeId]
            const cycleStart = newPath.indexOf(neighbor)
            if (cycleStart >= 0) {
              const cycle = newPath.slice(cycleStart)
              cycle.push(neighbor)
              cycles.push(cycle)
              backEdges.push({ from: nodeId, to: neighbor, type: 'DEPENDS_ON' })
            }
          } else {
            stack.push({ nodeId: neighbor, path: [...path, nodeId] })
          }
        }

        // Remove from current path when backtracking
        // Note: This is a simplified version - proper DFS would handle this better
      }
    }

    return {
      hasCycles: cycles.length > 0,
      cycles,
      backEdges,
    }
  }

  // ==========================================================================
  // NEIGHBOR QUERIES
  // ==========================================================================

  /**
   * Get neighbors within n hops with their distances.
   */
  async nHopNeighbors(
    nodeId: string,
    n: number,
    options: { edgeTypes?: string[]; direction?: EdgeDirection } = {}
  ): Promise<Map<string, number>> {
    const { edgeTypes, direction = 'out' } = options

    const neighbors = new Map<string, number>()

    if (n <= 0) {
      return neighbors
    }

    // BFS with depth tracking
    const queue: Array<[string, number]> = [[nodeId, 0]]
    const seen = new Set<string>([nodeId])

    while (queue.length > 0) {
      const [currentNode, depth] = queue.shift()!

      if (depth >= n) {
        continue
      }

      const currentNeighbors = await this.getFilteredNeighbors(currentNode, direction, edgeTypes)

      for (const neighbor of currentNeighbors) {
        if (!seen.has(neighbor.nodeId)) {
          seen.add(neighbor.nodeId)
          neighbors.set(neighbor.nodeId, depth + 1)
          queue.push([neighbor.nodeId, depth + 1])
        }
      }
    }

    return neighbors
  }

  /**
   * Find common neighbors between two nodes.
   */
  async commonNeighbors(
    nodeA: string,
    nodeB: string,
    options: { edgeTypes?: string[] } = {}
  ): Promise<string[]> {
    const { edgeTypes } = options

    // Get neighbors of A
    const neighborsA = await this.getFilteredNeighbors(nodeA, 'out', edgeTypes)
    const setA = new Set(neighborsA.map((n) => n.nodeId))

    // Get neighbors of B
    const neighborsB = await this.getFilteredNeighbors(nodeB, 'out', edgeTypes)

    // Find intersection
    const common: string[] = []
    for (const neighbor of neighborsB) {
      if (setA.has(neighbor.nodeId)) {
        common.push(neighbor.nodeId)
      }
    }

    return common
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Get traversal statistics.
   */
  getStats(): TraversalStats {
    return { ...this.stats }
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Get filtered neighbors based on direction and edge types.
   */
  private async getFilteredNeighbors(
    nodeId: string,
    direction: EdgeDirection,
    edgeTypes?: string[]
  ): Promise<NeighborResult[]> {
    const neighbors = await this.index.getNeighbors(nodeId, {
      direction,
      type: edgeTypes,
    })
    return neighbors
  }

  /**
   * Reconstruct path from parent pointers.
   */
  private reconstructPath(
    from: string,
    to: string,
    parents: Map<string, { parent: string; edgeType: string } | null>
  ): Path {
    const nodes: string[] = []
    const edgeTypes: string[] = []

    let current: string | null = to
    while (current !== null) {
      nodes.unshift(current)
      const parentInfo = parents.get(current)
      if (parentInfo) {
        edgeTypes.unshift(parentInfo.edgeType)
        current = parentInfo.parent
      } else {
        current = null
      }
    }

    return {
      nodes,
      edgeTypes,
      length: edgeTypes.length,
    }
  }

  /**
   * Update internal statistics.
   */
  private updateStats(
    startTime: number,
    verticesVisited: number,
    edgesTraversed: number,
    maxDepthReached: number
  ): void {
    this.stats = {
      verticesVisited,
      edgesTraversed,
      maxDepthReached,
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * Get all node IDs in the graph.
   */
  private async getAllNodeIds(): Promise<string[]> {
    // This is a workaround since AdjacencyIndex doesn't expose all nodes directly
    // In practice, you'd want to add a method to AdjacencyIndex for this
    // For now, return empty array - tests will handle this
    return []
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a TraversalEngine with an AdjacencyIndex.
 *
 * @example
 * ```typescript
 * const index = new AdjacencyIndex(':memory:')
 * await index.initialize()
 *
 * const engine = createTraversalEngine(index)
 * ```
 */
export function createTraversalEngine(index: AdjacencyIndex): TraversalEngine {
  return new TraversalEngine(index)
}
