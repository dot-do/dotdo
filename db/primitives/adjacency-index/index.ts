/**
 * AdjacencyIndex - Graph adjacency operations on columnar storage
 *
 * A primitive for efficient graph relationship storage and traversal operations.
 * Uses adjacency list representation for memory efficiency with optional
 * columnar storage for edge properties.
 *
 * ## Features
 * - **Adjacency List**: Memory-efficient edge storage
 * - **Edge Properties**: Optional metadata on relationships
 * - **Traversal**: BFS/DFS with depth control and direction filtering
 * - **Neighbor Queries**: Fast O(1) neighbor lookups per node
 *
 * ## Usage
 * ```typescript
 * const index = createAdjacencyIndex()
 *
 * // Add edges with optional properties
 * await index.addEdge('user:1', 'user:2', { weight: 0.8, type: 'follows' })
 * await index.addEdge('user:2', 'user:3')
 *
 * // Query neighbors
 * const followers = await index.getNeighbors('user:1', 'outgoing')
 * const following = await index.getNeighbors('user:1', 'incoming')
 *
 * // Traverse graph
 * const result = await index.traverse('user:1', { mode: 'bfs', maxDepth: 3 })
 * console.log(result.visited) // All reachable nodes within 3 hops
 * ```
 *
 * @module db/primitives/adjacency-index
 */

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Direction for edge queries and traversal
 */
export type EdgeDirection = 'outgoing' | 'incoming' | 'both'

/**
 * Traversal mode
 */
export type TraversalMode = 'bfs' | 'dfs'

/**
 * Edge properties (arbitrary key-value pairs)
 */
export type EdgeProperties = Record<string, unknown>

/**
 * Options for graph traversal
 */
export interface TraversalOptions {
  /** Traversal algorithm: BFS (breadth-first) or DFS (depth-first) */
  mode: TraversalMode
  /** Maximum depth to traverse (0 = start node only) */
  maxDepth: number
  /** Direction to traverse edges */
  direction?: EdgeDirection
}

/**
 * Result of a graph traversal operation
 */
export interface TraversalResult {
  /** Nodes visited in traversal order */
  visited: string[]
  /** Map of node -> depth from start */
  depths: Map<string, number>
  /** Map of node -> parent in traversal tree */
  parents: Map<string, string | null>
}

/**
 * Configuration options for AdjacencyIndex
 */
export interface AdjacencyIndexOptions {
  /** Initial capacity hint for node storage */
  initialCapacity?: number
}

/**
 * AdjacencyIndex interface for graph operations
 */
export interface AdjacencyIndex {
  // ===========================================================================
  // EDGE OPERATIONS
  // ===========================================================================

  /**
   * Add an edge between two nodes.
   * Creates nodes implicitly if they don't exist.
   *
   * @param from - Source node ID
   * @param to - Target node ID
   * @param properties - Optional edge properties
   */
  addEdge(from: string, to: string, properties?: EdgeProperties): Promise<void>

  /**
   * Remove an edge between two nodes.
   *
   * @param from - Source node ID
   * @param to - Target node ID
   * @returns true if edge was removed, false if it didn't exist
   */
  removeEdge(from: string, to: string): Promise<boolean>

  /**
   * Check if an edge exists.
   *
   * @param from - Source node ID
   * @param to - Target node ID
   * @returns true if edge exists
   */
  hasEdge(from: string, to: string): Promise<boolean>

  // ===========================================================================
  // NODE OPERATIONS
  // ===========================================================================

  /**
   * Check if a node exists.
   *
   * @param nodeId - Node ID to check
   * @returns true if node exists
   */
  hasNode(nodeId: string): Promise<boolean>

  /**
   * Remove a node and all its edges.
   *
   * @param nodeId - Node ID to remove
   * @returns true if node was removed, false if it didn't exist
   */
  removeNode(nodeId: string): Promise<boolean>

  // ===========================================================================
  // NEIGHBOR QUERIES
  // ===========================================================================

  /**
   * Get neighbors of a node.
   *
   * @param nodeId - Node ID to query
   * @param direction - Which edges to follow: outgoing, incoming, or both
   * @returns Array of neighbor node IDs
   */
  getNeighbors(nodeId: string, direction: EdgeDirection): Promise<string[]>

  /**
   * Get the out-degree (number of outgoing edges) of a node.
   *
   * @param nodeId - Node ID to query
   * @returns Number of outgoing edges
   */
  getOutDegree(nodeId: string): Promise<number>

  /**
   * Get the in-degree (number of incoming edges) of a node.
   *
   * @param nodeId - Node ID to query
   * @returns Number of incoming edges
   */
  getInDegree(nodeId: string): Promise<number>

  // ===========================================================================
  // TRAVERSAL
  // ===========================================================================

  /**
   * Traverse the graph from a starting node.
   *
   * @param startNode - Node to start traversal from
   * @param options - Traversal options (mode, maxDepth, direction)
   * @returns Traversal result with visited nodes and depth information
   */
  traverse(startNode: string, options: TraversalOptions): Promise<TraversalResult>

  // ===========================================================================
  // EDGE PROPERTIES
  // ===========================================================================

  /**
   * Get properties of an edge.
   *
   * @param from - Source node ID
   * @param to - Target node ID
   * @returns Edge properties or null if edge doesn't exist or has no properties
   */
  getEdgeProperties(from: string, to: string): Promise<EdgeProperties | null>

  /**
   * Set properties of an edge.
   *
   * @param from - Source node ID
   * @param to - Target node ID
   * @param properties - Properties to set
   * @returns true if edge exists and properties were set
   */
  setEdgeProperties(from: string, to: string, properties: EdgeProperties): Promise<boolean>

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  /**
   * Get the total number of nodes.
   */
  getNodeCount(): Promise<number>

  /**
   * Get the total number of edges.
   */
  getEdgeCount(): Promise<number>

  /**
   * Get all node IDs.
   */
  getAllNodes(): Promise<string[]>

  /**
   * Get all edges as [from, to] pairs.
   */
  getAllEdges(): Promise<[string, string][]>

  // ===========================================================================
  // MAINTENANCE
  // ===========================================================================

  /**
   * Clear all nodes and edges.
   */
  clear(): Promise<void>

  // ===========================================================================
  // SERIALIZATION
  // ===========================================================================

  /**
   * Serialize the graph to JSON.
   */
  toJSON(): Promise<string>

  /**
   * Load graph from JSON.
   *
   * @param json - JSON string to load from
   */
  fromJSON(json: string): Promise<void>
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

/**
 * Edge key for property storage
 */
function edgeKey(from: string, to: string): string {
  return `${from}\0${to}`
}

/**
 * Parse edge key back to [from, to]
 */
function parseEdgeKey(key: string): [string, string] {
  const parts = key.split('\0')
  return [parts[0]!, parts[1]!]
}

/**
 * Serialized graph format
 */
interface SerializedGraph {
  nodes: string[]
  edges: Array<{ from: string; to: string; properties?: EdgeProperties }>
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * In-memory implementation of AdjacencyIndex using adjacency lists.
 */
class AdjacencyIndexImpl implements AdjacencyIndex {
  /** Set of all nodes */
  private nodes: Set<string> = new Set()

  /** Outgoing adjacency list: node -> Set of target nodes */
  private outgoing: Map<string, Set<string>> = new Map()

  /** Incoming adjacency list: node -> Set of source nodes */
  private incoming: Map<string, Set<string>> = new Map()

  /** Edge properties storage */
  private edgeProperties: Map<string, EdgeProperties> = new Map()

  /** Total edge count */
  private edgeCount = 0

  constructor(_options?: AdjacencyIndexOptions) {
    // Options reserved for future use (e.g., initial capacity hints)
  }

  // ===========================================================================
  // EDGE OPERATIONS
  // ===========================================================================

  async addEdge(from: string, to: string, properties?: EdgeProperties): Promise<void> {
    // Ensure nodes exist
    this.ensureNode(from)
    this.ensureNode(to)

    // Get or create adjacency sets
    let outSet = this.outgoing.get(from)
    if (!outSet) {
      outSet = new Set()
      this.outgoing.set(from, outSet)
    }

    let inSet = this.incoming.get(to)
    if (!inSet) {
      inSet = new Set()
      this.incoming.set(to, inSet)
    }

    // Check if edge already exists
    const isNewEdge = !outSet.has(to)

    // Add edge
    outSet.add(to)
    inSet.add(from)

    if (isNewEdge) {
      this.edgeCount++
    }

    // Store properties if provided
    if (properties !== undefined) {
      this.edgeProperties.set(edgeKey(from, to), properties)
    }
  }

  async removeEdge(from: string, to: string): Promise<boolean> {
    const outSet = this.outgoing.get(from)
    const inSet = this.incoming.get(to)

    if (!outSet || !outSet.has(to)) {
      return false
    }

    // Remove from adjacency lists
    outSet.delete(to)
    if (inSet) {
      inSet.delete(from)
    }

    // Remove properties
    this.edgeProperties.delete(edgeKey(from, to))

    this.edgeCount--
    return true
  }

  async hasEdge(from: string, to: string): Promise<boolean> {
    const outSet = this.outgoing.get(from)
    return outSet !== undefined && outSet.has(to)
  }

  // ===========================================================================
  // NODE OPERATIONS
  // ===========================================================================

  async hasNode(nodeId: string): Promise<boolean> {
    return this.nodes.has(nodeId)
  }

  async removeNode(nodeId: string): Promise<boolean> {
    if (!this.nodes.has(nodeId)) {
      return false
    }

    // Remove all outgoing edges
    const outSet = this.outgoing.get(nodeId)
    if (outSet) {
      for (const target of outSet) {
        const targetInSet = this.incoming.get(target)
        if (targetInSet) {
          targetInSet.delete(nodeId)
        }
        this.edgeProperties.delete(edgeKey(nodeId, target))
        this.edgeCount--
      }
      this.outgoing.delete(nodeId)
    }

    // Remove all incoming edges
    const inSet = this.incoming.get(nodeId)
    if (inSet) {
      for (const source of inSet) {
        const sourceOutSet = this.outgoing.get(source)
        if (sourceOutSet) {
          sourceOutSet.delete(nodeId)
        }
        this.edgeProperties.delete(edgeKey(source, nodeId))
        this.edgeCount--
      }
      this.incoming.delete(nodeId)
    }

    // Remove node
    this.nodes.delete(nodeId)
    return true
  }

  // ===========================================================================
  // NEIGHBOR QUERIES
  // ===========================================================================

  async getNeighbors(nodeId: string, direction: EdgeDirection): Promise<string[]> {
    const neighbors = new Set<string>()

    if (direction === 'outgoing' || direction === 'both') {
      const outSet = this.outgoing.get(nodeId)
      if (outSet) {
        for (const target of outSet) {
          neighbors.add(target)
        }
      }
    }

    if (direction === 'incoming' || direction === 'both') {
      const inSet = this.incoming.get(nodeId)
      if (inSet) {
        for (const source of inSet) {
          neighbors.add(source)
        }
      }
    }

    return Array.from(neighbors)
  }

  async getOutDegree(nodeId: string): Promise<number> {
    const outSet = this.outgoing.get(nodeId)
    return outSet ? outSet.size : 0
  }

  async getInDegree(nodeId: string): Promise<number> {
    const inSet = this.incoming.get(nodeId)
    return inSet ? inSet.size : 0
  }

  // ===========================================================================
  // TRAVERSAL
  // ===========================================================================

  async traverse(startNode: string, options: TraversalOptions): Promise<TraversalResult> {
    const { mode, maxDepth, direction = 'outgoing' } = options

    const visited: string[] = []
    const depths = new Map<string, number>()
    const parents = new Map<string, string | null>()
    const seen = new Set<string>()

    // Check if start node exists
    if (!this.nodes.has(startNode)) {
      return { visited, depths, parents }
    }

    if (mode === 'bfs') {
      await this.traverseBFS(startNode, maxDepth, direction, visited, depths, parents, seen)
    } else {
      await this.traverseDFS(startNode, 0, maxDepth, direction, visited, depths, parents, seen, null)
    }

    return { visited, depths, parents }
  }

  private async traverseBFS(
    startNode: string,
    maxDepth: number,
    direction: EdgeDirection,
    visited: string[],
    depths: Map<string, number>,
    parents: Map<string, string | null>,
    seen: Set<string>
  ): Promise<void> {
    const queue: Array<{ node: string; depth: number; parent: string | null }> = [
      { node: startNode, depth: 0, parent: null },
    ]
    seen.add(startNode)

    while (queue.length > 0) {
      const { node, depth, parent } = queue.shift()!

      visited.push(node)
      depths.set(node, depth)
      parents.set(node, parent)

      // Stop expanding if at max depth
      if (depth >= maxDepth) {
        continue
      }

      // Get neighbors based on direction
      const neighbors = await this.getNeighbors(node, direction)

      for (const neighbor of neighbors) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor)
          queue.push({ node: neighbor, depth: depth + 1, parent: node })
        }
      }
    }
  }

  private async traverseDFS(
    node: string,
    depth: number,
    maxDepth: number,
    direction: EdgeDirection,
    visited: string[],
    depths: Map<string, number>,
    parents: Map<string, string | null>,
    seen: Set<string>,
    parent: string | null
  ): Promise<void> {
    seen.add(node)
    visited.push(node)
    depths.set(node, depth)
    parents.set(node, parent)

    // Stop expanding if at max depth
    if (depth >= maxDepth) {
      return
    }

    // Get neighbors based on direction
    const neighbors = await this.getNeighbors(node, direction)

    for (const neighbor of neighbors) {
      if (!seen.has(neighbor)) {
        await this.traverseDFS(neighbor, depth + 1, maxDepth, direction, visited, depths, parents, seen, node)
      }
    }
  }

  // ===========================================================================
  // EDGE PROPERTIES
  // ===========================================================================

  async getEdgeProperties(from: string, to: string): Promise<EdgeProperties | null> {
    const key = edgeKey(from, to)
    return this.edgeProperties.get(key) ?? null
  }

  async setEdgeProperties(from: string, to: string, properties: EdgeProperties): Promise<boolean> {
    if (!(await this.hasEdge(from, to))) {
      return false
    }

    this.edgeProperties.set(edgeKey(from, to), properties)
    return true
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  async getNodeCount(): Promise<number> {
    return this.nodes.size
  }

  async getEdgeCount(): Promise<number> {
    return this.edgeCount
  }

  async getAllNodes(): Promise<string[]> {
    return Array.from(this.nodes)
  }

  async getAllEdges(): Promise<[string, string][]> {
    const edges: [string, string][] = []

    for (const [from, targets] of this.outgoing) {
      for (const to of targets) {
        edges.push([from, to])
      }
    }

    return edges
  }

  // ===========================================================================
  // MAINTENANCE
  // ===========================================================================

  async clear(): Promise<void> {
    this.nodes.clear()
    this.outgoing.clear()
    this.incoming.clear()
    this.edgeProperties.clear()
    this.edgeCount = 0
  }

  // ===========================================================================
  // SERIALIZATION
  // ===========================================================================

  async toJSON(): Promise<string> {
    const serialized: SerializedGraph = {
      nodes: Array.from(this.nodes),
      edges: [],
    }

    for (const [from, targets] of this.outgoing) {
      for (const to of targets) {
        const props = this.edgeProperties.get(edgeKey(from, to))
        if (props !== undefined) {
          serialized.edges.push({ from, to, properties: props })
        } else {
          serialized.edges.push({ from, to })
        }
      }
    }

    return JSON.stringify(serialized)
  }

  async fromJSON(json: string): Promise<void> {
    await this.clear()

    const data: SerializedGraph = JSON.parse(json)

    // Restore edges (nodes are created implicitly)
    for (const edge of data.edges) {
      await this.addEdge(edge.from, edge.to, edge.properties)
    }

    // Restore isolated nodes (nodes without edges)
    for (const node of data.nodes) {
      this.ensureNode(node)
    }
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Ensure a node exists in the graph.
   */
  private ensureNode(nodeId: string): void {
    if (!this.nodes.has(nodeId)) {
      this.nodes.add(nodeId)
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new AdjacencyIndex instance.
 *
 * @param options - Configuration options
 * @returns A new AdjacencyIndex instance
 *
 * @example
 * ```typescript
 * const index = createAdjacencyIndex()
 *
 * // Build a social graph
 * await index.addEdge('alice', 'bob', { type: 'follows' })
 * await index.addEdge('bob', 'charlie', { type: 'follows' })
 *
 * // Find who alice follows
 * const following = await index.getNeighbors('alice', 'outgoing')
 *
 * // Traverse the graph
 * const result = await index.traverse('alice', { mode: 'bfs', maxDepth: 2 })
 * ```
 */
export function createAdjacencyIndex(options?: AdjacencyIndexOptions): AdjacencyIndex {
  return new AdjacencyIndexImpl(options)
}
