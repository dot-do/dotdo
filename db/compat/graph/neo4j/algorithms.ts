/**
 * Graph Algorithms for Neo4j Compat Layer
 *
 * Implements common graph algorithms:
 * - Shortest Path (BFS-based)
 * - All Shortest Paths
 * - PageRank
 * - Connected Components (Weakly/Strongly)
 * - Degree Centrality
 * - Betweenness Centrality
 * - Closeness Centrality
 * - BFS/DFS Traversal
 *
 * @see https://neo4j.com/docs/graph-data-science/current/algorithms/
 */

import type { Session, Node, Relationship } from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Simplified node representation for algorithms
 */
export interface GraphNode {
  id: string
  labels: string[]
  properties: Record<string, unknown>
}

/**
 * Simplified edge representation for algorithms
 */
export interface GraphEdge {
  id: string
  type: string
  sourceId: string
  targetId: string
  properties: Record<string, unknown>
}

/**
 * Path result containing nodes and relationships
 */
export interface PathResult {
  nodes: GraphNode[]
  relationships: GraphEdge[]
  length: number
}

/**
 * PageRank result for a single node
 */
export interface PageRankResult {
  nodeId: string
  score: number
}

/**
 * Centrality result for a single node
 */
export interface CentralityResult {
  nodeId: string
  score: number
}

/**
 * Connected components result
 */
export interface ComponentResult {
  componentCount: number
  componentSizes: number[]
  nodes: Array<{
    nodeId: string
    componentId: number
  }>
}

/**
 * Configuration for path algorithms
 */
export interface PathConfig {
  nodeLabel: string
  nodeProperty: string
  relationshipType?: string
  direction?: 'OUT' | 'IN' | 'BOTH'
  maxDepth?: number
}

/**
 * Configuration for PageRank algorithm
 */
export interface PageRankConfig {
  nodeLabel: string
  relationshipType?: string
  dampingFactor?: number
  maxIterations?: number
  tolerance?: number
}

/**
 * Configuration for connected components
 */
export interface ComponentConfig {
  nodeLabel: string
  relationshipType?: string
}

/**
 * Configuration for centrality algorithms
 */
export interface CentralityConfig {
  nodeLabel: string
  relationshipType?: string
  direction?: 'IN' | 'OUT' | 'BOTH'
  normalized?: boolean
}

/**
 * Configuration for traversal algorithms
 */
export interface TraversalConfig {
  nodeLabel: string
  nodeProperty: string
  relationshipType?: string
  direction?: 'OUT' | 'IN' | 'BOTH'
  maxDepth?: number
  onVisit: (node: GraphNode) => void
}

// ============================================================================
// INTERNAL GRAPH REPRESENTATION
// ============================================================================

interface InternalGraph {
  nodes: Map<string, GraphNode>
  adjacency: Map<string, Array<{ targetId: string; edgeId: string; type: string }>>
  reverseAdjacency: Map<string, Array<{ sourceId: string; edgeId: string; type: string }>>
  edges: Map<string, GraphEdge>
}

// ============================================================================
// GRAPH ALGORITHMS CLASS
// ============================================================================

/**
 * Graph Algorithms implementation
 *
 * Uses the Neo4j session to load graph data and execute algorithms.
 */
export class GraphAlgorithms {
  private session: Session

  constructor(session: Session) {
    this.session = session
  }

  // ==========================================================================
  // GRAPH LOADING
  // ==========================================================================

  /**
   * Load graph data from Neo4j into internal representation
   */
  private async loadGraph(config: {
    nodeLabel: string
    relationshipType?: string
  }): Promise<InternalGraph> {
    const nodes = new Map<string, GraphNode>()
    const adjacency = new Map<string, Array<{ targetId: string; edgeId: string; type: string }>>()
    const reverseAdjacency = new Map<string, Array<{ sourceId: string; edgeId: string; type: string }>>()
    const edges = new Map<string, GraphEdge>()

    // Load nodes
    const nodeResult = await this.session.run(
      `MATCH (n:${config.nodeLabel}) RETURN n`
    )
    const nodeRecords = await nodeResult.records()

    for (const record of nodeRecords) {
      const node = record.get('n') as Node
      const nodeId = node.elementId
      nodes.set(nodeId, {
        id: nodeId,
        labels: node.labels,
        properties: node.properties,
      })
      adjacency.set(nodeId, [])
      reverseAdjacency.set(nodeId, [])
    }

    // Load relationships
    const relType = config.relationshipType ? `:${config.relationshipType}` : ''
    const relResult = await this.session.run(
      `MATCH (a:${config.nodeLabel})-[r${relType}]->(b:${config.nodeLabel}) RETURN a, r, b`
    )
    const relRecords = await relResult.records()

    for (const record of relRecords) {
      const sourceNode = record.get('a') as Node
      const rel = record.get('r') as Relationship
      const targetNode = record.get('b') as Node

      const sourceId = sourceNode.elementId
      const targetId = targetNode.elementId
      const edgeId = rel.elementId

      edges.set(edgeId, {
        id: edgeId,
        type: rel.type,
        sourceId,
        targetId,
        properties: rel.properties,
      })

      // Add to adjacency lists
      const sourceAdj = adjacency.get(sourceId) || []
      sourceAdj.push({ targetId, edgeId, type: rel.type })
      adjacency.set(sourceId, sourceAdj)

      const targetRevAdj = reverseAdjacency.get(targetId) || []
      targetRevAdj.push({ sourceId, edgeId, type: rel.type })
      reverseAdjacency.set(targetId, targetRevAdj)
    }

    return { nodes, adjacency, reverseAdjacency, edges }
  }

  /**
   * Find node by property value
   */
  private findNodeByProperty(
    graph: InternalGraph,
    propertyName: string,
    value: unknown
  ): GraphNode | null {
    for (const node of graph.nodes.values()) {
      if (node.properties[propertyName] === value) {
        return node
      }
    }
    return null
  }

  /**
   * Get neighbors of a node based on direction
   */
  private getNeighbors(
    graph: InternalGraph,
    nodeId: string,
    direction: 'OUT' | 'IN' | 'BOTH' = 'OUT'
  ): Array<{ nodeId: string; edgeId: string }> {
    const neighbors: Array<{ nodeId: string; edgeId: string }> = []

    if (direction === 'OUT' || direction === 'BOTH') {
      const outgoing = graph.adjacency.get(nodeId) || []
      for (const { targetId, edgeId } of outgoing) {
        neighbors.push({ nodeId: targetId, edgeId })
      }
    }

    if (direction === 'IN' || direction === 'BOTH') {
      const incoming = graph.reverseAdjacency.get(nodeId) || []
      for (const { sourceId, edgeId } of incoming) {
        neighbors.push({ nodeId: sourceId, edgeId })
      }
    }

    return neighbors
  }

  // ==========================================================================
  // SHORTEST PATH ALGORITHMS
  // ==========================================================================

  /**
   * Find the shortest path between two nodes using BFS
   */
  async shortestPath(
    startValue: unknown,
    endValue: unknown,
    config: PathConfig
  ): Promise<PathResult | null> {
    const graph = await this.loadGraph({
      nodeLabel: config.nodeLabel,
      relationshipType: config.relationshipType,
    })

    const startNode = this.findNodeByProperty(graph, config.nodeProperty, startValue)
    const endNode = this.findNodeByProperty(graph, config.nodeProperty, endValue)

    if (!startNode || !endNode) {
      return null
    }

    const direction = config.direction || 'OUT'
    const maxDepth = config.maxDepth ?? Infinity

    // BFS
    const queue: Array<{ nodeId: string; path: string[]; edges: string[] }> = [
      { nodeId: startNode.id, path: [startNode.id], edges: [] },
    ]
    const visited = new Set<string>([startNode.id])

    while (queue.length > 0) {
      const current = queue.shift()!

      if (current.nodeId === endNode.id) {
        // Found path
        const nodes = current.path.map((id) => graph.nodes.get(id)!)
        const relationships = current.edges.map((id) => graph.edges.get(id)!)
        return {
          nodes,
          relationships,
          length: current.edges.length,
        }
      }

      if (current.path.length - 1 >= maxDepth) {
        continue
      }

      const neighbors = this.getNeighbors(graph, current.nodeId, direction)

      for (const { nodeId: neighborId, edgeId } of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId)
          queue.push({
            nodeId: neighborId,
            path: [...current.path, neighborId],
            edges: [...current.edges, edgeId],
          })
        }
      }
    }

    return null
  }

  /**
   * Find all shortest paths between two nodes
   */
  async allShortestPaths(
    startValue: unknown,
    endValue: unknown,
    config: PathConfig
  ): Promise<PathResult[]> {
    const graph = await this.loadGraph({
      nodeLabel: config.nodeLabel,
      relationshipType: config.relationshipType,
    })

    const startNode = this.findNodeByProperty(graph, config.nodeProperty, startValue)
    const endNode = this.findNodeByProperty(graph, config.nodeProperty, endValue)

    if (!startNode || !endNode) {
      return []
    }

    const direction = config.direction || 'OUT'
    const maxDepth = config.maxDepth ?? Infinity

    // BFS to find all paths at each level
    const results: PathResult[] = []
    let shortestLength = Infinity

    const queue: Array<{ nodeId: string; path: string[]; edges: string[] }> = [
      { nodeId: startNode.id, path: [startNode.id], edges: [] },
    ]

    // Track visited at each depth to allow multiple paths
    const visitedAtDepth = new Map<string, number>()
    visitedAtDepth.set(startNode.id, 0)

    while (queue.length > 0) {
      const current = queue.shift()!
      const currentDepth = current.path.length - 1

      if (currentDepth > shortestLength || currentDepth >= maxDepth) {
        continue
      }

      if (current.nodeId === endNode.id) {
        const nodes = current.path.map((id) => graph.nodes.get(id)!)
        const relationships = current.edges.map((id) => graph.edges.get(id)!)
        results.push({
          nodes,
          relationships,
          length: current.edges.length,
        })
        shortestLength = currentDepth
        continue
      }

      const neighbors = this.getNeighbors(graph, current.nodeId, direction)

      for (const { nodeId: neighborId, edgeId } of neighbors) {
        const prevDepth = visitedAtDepth.get(neighborId)
        if (prevDepth === undefined || prevDepth >= currentDepth + 1) {
          visitedAtDepth.set(neighborId, currentDepth + 1)
          queue.push({
            nodeId: neighborId,
            path: [...current.path, neighborId],
            edges: [...current.edges, edgeId],
          })
        }
      }
    }

    // Filter to only shortest
    const minLength = Math.min(...results.map((r) => r.length))
    return results.filter((r) => r.length === minLength)
  }

  // ==========================================================================
  // PAGERANK ALGORITHM
  // ==========================================================================

  /**
   * Compute PageRank for all nodes
   *
   * PageRank formula:
   * PR(u) = (1-d)/N + d * sum(PR(v) / L(v)) for all v linking to u
   *
   * where:
   * - d is damping factor (typically 0.85)
   * - N is total number of nodes
   * - L(v) is the number of outgoing links from v
   */
  async pageRank(config: PageRankConfig): Promise<PageRankResult[]> {
    const graph = await this.loadGraph({
      nodeLabel: config.nodeLabel,
      relationshipType: config.relationshipType,
    })

    const dampingFactor = config.dampingFactor ?? 0.85
    const maxIterations = config.maxIterations ?? 20
    const tolerance = config.tolerance ?? 0.0001

    const nodeIds = Array.from(graph.nodes.keys())
    const N = nodeIds.length

    if (N === 0) {
      return []
    }

    // Initialize PageRank values
    const ranks = new Map<string, number>()
    const initialRank = 1 / N

    nodeIds.forEach((nodeId) => {
      ranks.set(nodeId, initialRank)
    })

    // Calculate out-degree for each node
    const outDegree = new Map<string, number>()
    for (const nodeId of nodeIds) {
      const outgoing = graph.adjacency.get(nodeId) || []
      outDegree.set(nodeId, outgoing.length)
    }

    // Iterative computation
    for (let iter = 0; iter < maxIterations; iter++) {
      const newRanks = new Map<string, number>()
      let maxDiff = 0

      for (const nodeId of nodeIds) {
        // Sum contributions from incoming nodes
        let incomingSum = 0
        const incoming = graph.reverseAdjacency.get(nodeId) || []

        for (const { sourceId } of incoming) {
          const sourceRank = ranks.get(sourceId) || 0
          const sourceOutDegree = outDegree.get(sourceId) || 1
          incomingSum += sourceRank / sourceOutDegree
        }

        // Calculate new rank
        const newRank = (1 - dampingFactor) / N + dampingFactor * incomingSum
        newRanks.set(nodeId, newRank)

        // Track convergence
        const oldRank = ranks.get(nodeId) || 0
        maxDiff = Math.max(maxDiff, Math.abs(newRank - oldRank))
      }

      // Update ranks
      for (const [nodeId, rank] of newRanks) {
        ranks.set(nodeId, rank)
      }

      // Check convergence
      if (maxDiff < tolerance) {
        break
      }
    }

    // Build results
    const results: PageRankResult[] = []
    ranks.forEach((score, nodeId) => {
      const node = graph.nodes.get(nodeId)!
      // Include node property in ID for easier identification
      const propValue = Object.values(node.properties)[0]
      results.push({
        nodeId: propValue ? `${propValue}` : nodeId,
        score,
      })
    })

    // Sort by score descending
    results.sort((a, b) => b.score - a.score)

    return results
  }

  // ==========================================================================
  // CONNECTED COMPONENTS
  // ==========================================================================

  /**
   * Find connected components (treating graph as undirected)
   */
  async connectedComponents(config: ComponentConfig): Promise<ComponentResult> {
    const graph = await this.loadGraph({
      nodeLabel: config.nodeLabel,
      relationshipType: config.relationshipType,
    })

    const nodeIds = Array.from(graph.nodes.keys())
    const visited = new Set<string>()
    const componentMap = new Map<string, number>()
    const componentSizes: number[] = []
    let componentId = 0

    for (const startId of nodeIds) {
      if (visited.has(startId)) continue

      // BFS to find all nodes in this component
      const queue = [startId]
      let size = 0

      while (queue.length > 0) {
        const nodeId = queue.shift()!

        if (visited.has(nodeId)) continue
        visited.add(nodeId)

        componentMap.set(nodeId, componentId)
        size++

        // Get neighbors in both directions (treating as undirected)
        const neighbors = this.getNeighbors(graph, nodeId, 'BOTH')
        for (const { nodeId: neighborId } of neighbors) {
          if (!visited.has(neighborId)) {
            queue.push(neighborId)
          }
        }
      }

      componentSizes.push(size)
      componentId++
    }

    // Build result
    const nodes: Array<{ nodeId: string; componentId: number }> = []
    componentMap.forEach((compId, nodeId) => {
      const node = graph.nodes.get(nodeId)!
      const propValue = Object.values(node.properties)[0]
      nodes.push({
        nodeId: propValue ? `${propValue}` : nodeId,
        componentId: compId,
      })
    })

    return {
      componentCount: componentId,
      componentSizes,
      nodes,
    }
  }

  /**
   * Find weakly connected components (same as connectedComponents for directed graphs
   * when treating edges as undirected)
   */
  async weaklyConnectedComponents(config: ComponentConfig): Promise<ComponentResult> {
    return this.connectedComponents(config)
  }

  // ==========================================================================
  // CENTRALITY ALGORITHMS
  // ==========================================================================

  /**
   * Compute degree centrality for all nodes
   */
  async degreeCentrality(config: CentralityConfig): Promise<CentralityResult[]> {
    const graph = await this.loadGraph({
      nodeLabel: config.nodeLabel,
      relationshipType: config.relationshipType,
    })

    const direction = config.direction || 'BOTH'
    const results: CentralityResult[] = []

    graph.nodes.forEach((node, nodeId) => {
      let degree = 0

      if (direction === 'OUT' || direction === 'BOTH') {
        const outgoing = graph.adjacency.get(nodeId) || []
        degree += outgoing.length
      }

      if (direction === 'IN' || direction === 'BOTH') {
        const incoming = graph.reverseAdjacency.get(nodeId) || []
        degree += incoming.length
      }

      const propValue = Object.values(node.properties)[0]
      results.push({
        nodeId: propValue ? `${propValue}` : nodeId,
        score: degree,
      })
    })

    results.sort((a, b) => b.score - a.score)
    return results
  }

  /**
   * Compute betweenness centrality for all nodes
   *
   * Betweenness centrality measures how often a node lies on the shortest path
   * between other pairs of nodes.
   */
  async betweennessCentrality(config: CentralityConfig): Promise<CentralityResult[]> {
    const graph = await this.loadGraph({
      nodeLabel: config.nodeLabel,
      relationshipType: config.relationshipType,
    })

    const nodeIds = Array.from(graph.nodes.keys())
    const betweenness = new Map<string, number>()

    // Initialize
    for (const nodeId of nodeIds) {
      betweenness.set(nodeId, 0)
    }

    // For each source node, compute shortest paths to all other nodes
    for (const source of nodeIds) {
      // BFS to find shortest paths
      const dist = new Map<string, number>()
      const sigma = new Map<string, number>() // Number of shortest paths
      const pred = new Map<string, string[]>() // Predecessors on shortest paths
      const queue: string[] = []
      const stack: string[] = []

      // Initialize
      for (const v of nodeIds) {
        dist.set(v, -1)
        sigma.set(v, 0)
        pred.set(v, [])
      }

      dist.set(source, 0)
      sigma.set(source, 1)
      queue.push(source)

      // BFS
      while (queue.length > 0) {
        const v = queue.shift()!
        stack.push(v)

        const neighbors = this.getNeighbors(graph, v, 'OUT')
        for (const { nodeId: w } of neighbors) {
          // First visit
          if (dist.get(w)! < 0) {
            dist.set(w, dist.get(v)! + 1)
            queue.push(w)
          }

          // Shortest path via v
          if (dist.get(w) === dist.get(v)! + 1) {
            sigma.set(w, sigma.get(w)! + sigma.get(v)!)
            pred.get(w)!.push(v)
          }
        }
      }

      // Accumulation
      const delta = new Map<string, number>()
      for (const v of nodeIds) {
        delta.set(v, 0)
      }

      while (stack.length > 0) {
        const w = stack.pop()!
        for (const v of pred.get(w)!) {
          const d = (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!)
          delta.set(v, delta.get(v)! + d)
        }

        if (w !== source) {
          betweenness.set(w, betweenness.get(w)! + delta.get(w)!)
        }
      }
    }

    // Build results
    const N = nodeIds.length
    const results: CentralityResult[] = []

    for (const [nodeId, score] of betweenness) {
      const node = graph.nodes.get(nodeId)!
      const propValue = Object.values(node.properties)[0]

      // Normalize if requested
      let finalScore = score
      if (config.normalized && N > 2) {
        finalScore = score / ((N - 1) * (N - 2))
      }

      results.push({
        nodeId: propValue ? `${propValue}` : nodeId,
        score: finalScore,
      })
    }

    results.sort((a, b) => b.score - a.score)
    return results
  }

  /**
   * Compute closeness centrality for all nodes
   *
   * Closeness centrality is the reciprocal of the sum of shortest path distances
   * from the node to all other nodes.
   */
  async closenessCentrality(config: CentralityConfig): Promise<CentralityResult[]> {
    const graph = await this.loadGraph({
      nodeLabel: config.nodeLabel,
      relationshipType: config.relationshipType,
    })

    const nodeIds = Array.from(graph.nodes.keys())
    const results: CentralityResult[] = []

    for (const source of nodeIds) {
      // BFS to find distances to all other nodes
      const dist = new Map<string, number>()
      const queue: string[] = [source]
      dist.set(source, 0)

      while (queue.length > 0) {
        const v = queue.shift()!
        const neighbors = this.getNeighbors(graph, v, 'OUT')

        for (const { nodeId: w } of neighbors) {
          if (!dist.has(w)) {
            dist.set(w, dist.get(v)! + 1)
            queue.push(w)
          }
        }
      }

      // Sum of distances
      let totalDist = 0
      let reachable = 0

      for (const targetId of nodeIds) {
        if (targetId !== source && dist.has(targetId)) {
          totalDist += dist.get(targetId)!
          reachable++
        }
      }

      // Closeness = (n-1) / sum(distances)
      const node = graph.nodes.get(source)!
      const propValue = Object.values(node.properties)[0]

      let closeness = 0
      if (totalDist > 0 && reachable > 0) {
        closeness = reachable / totalDist
        if (config.normalized) {
          closeness = closeness * (reachable / (nodeIds.length - 1))
        }
      }

      results.push({
        nodeId: propValue ? `${propValue}` : source,
        score: closeness,
      })
    }

    results.sort((a, b) => b.score - a.score)
    return results
  }

  // ==========================================================================
  // TRAVERSAL ALGORITHMS
  // ==========================================================================

  /**
   * Breadth-First Search traversal
   */
  async bfs(
    startValue: unknown,
    config: TraversalConfig
  ): Promise<void> {
    const graph = await this.loadGraph({
      nodeLabel: config.nodeLabel,
      relationshipType: config.relationshipType,
    })

    const startNode = this.findNodeByProperty(graph, config.nodeProperty, startValue)
    if (!startNode) return

    const direction = config.direction || 'OUT'
    const maxDepth = config.maxDepth ?? Infinity

    const visited = new Set<string>()
    const queue: Array<{ nodeId: string; depth: number }> = [
      { nodeId: startNode.id, depth: 0 },
    ]

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!

      if (visited.has(nodeId)) continue
      visited.add(nodeId)

      const node = graph.nodes.get(nodeId)!
      config.onVisit(node)

      if (depth >= maxDepth) continue

      const neighbors = this.getNeighbors(graph, nodeId, direction)
      for (const { nodeId: neighborId } of neighbors) {
        if (!visited.has(neighborId)) {
          queue.push({ nodeId: neighborId, depth: depth + 1 })
        }
      }
    }
  }

  /**
   * Depth-First Search traversal
   */
  async dfs(
    startValue: unknown,
    config: TraversalConfig
  ): Promise<void> {
    const graph = await this.loadGraph({
      nodeLabel: config.nodeLabel,
      relationshipType: config.relationshipType,
    })

    const startNode = this.findNodeByProperty(graph, config.nodeProperty, startValue)
    if (!startNode) return

    const direction = config.direction || 'OUT'
    const maxDepth = config.maxDepth ?? Infinity

    const visited = new Set<string>()

    const dfsHelper = (nodeId: string, depth: number): void => {
      if (visited.has(nodeId) || depth > maxDepth) return
      visited.add(nodeId)

      const node = graph.nodes.get(nodeId)!
      config.onVisit(node)

      const neighbors = this.getNeighbors(graph, nodeId, direction)
      for (const { nodeId: neighborId } of neighbors) {
        dfsHelper(neighborId, depth + 1)
      }
    }

    dfsHelper(startNode.id, 0)
  }
}
