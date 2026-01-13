/**
 * GraphEngine - In-memory graph with traversals and algorithms
 *
 * This module provides a comprehensive in-memory graph implementation with:
 * - Node and edge CRUD operations
 * - Graph traversals (BFS, DFS)
 * - Path finding (shortest path, all paths, Dijkstra)
 * - Pattern matching (Cypher-like queries)
 * - Graph algorithms (PageRank, centrality, clustering, MST, topological sort)
 * - Connected components analysis
 * - Graph statistics
 *
 * @module db/graph/graph-engine
 */

// ============================================================================
// TYPES
// ============================================================================

export interface Node {
  id: string
  label: string
  properties: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface Edge {
  id: string
  type: string
  from: string
  to: string
  properties: Record<string, unknown>
  createdAt: number
}

export interface NodeQuery {
  label?: string
  where?: WhereClause
  limit?: number
  offset?: number
  orderBy?: Record<string, 'asc' | 'desc'>
}

export interface EdgeQuery {
  type?: string
  from?: string
  to?: string
  where?: WhereClause
}

export type WhereClause = Record<string, unknown | ComparisonOperators>

export interface ComparisonOperators {
  $gt?: number
  $gte?: number
  $lt?: number
  $lte?: number
  $ne?: unknown
  $in?: unknown[]
  $contains?: string
  $exists?: boolean
}

export interface TraversalOptions {
  start: string | Node
  direction: 'OUTGOING' | 'INCOMING' | 'BOTH'
  maxDepth: number
  filter?: {
    type?: string | string[]
  }
}

export interface TraversalResult {
  nodes: Node[]
  paths?: PathResult[]
  depths?: Map<string, number>
  visitOrder?: string[]
}

export interface PathResult {
  nodes: Node[]
  edges: Edge[]
  length: number
}

export interface ShortestPathOptions {
  relationshipTypes?: string[]
  maxDepth?: number
}

export interface AllPathsOptions {
  maxDepth?: number
  maxPaths?: number
  relationshipTypes?: string[]
}

export interface Pattern {
  pattern: string
  where?: Record<string, unknown | ComparisonOperators>
  return?: string[]
}

export interface MatchResult {
  matches: Record<string, unknown>[]
}

export interface GraphStats {
  nodeCount: number
  edgeCount: number
  labelCounts: Record<string, number>
  typeCounts: Record<string, number>
  avgDegree: number
  isolatedNodes: number
}

export interface GraphExport {
  nodes: Node[]
  edges: Edge[]
  metadata?: {
    exportedAt: number
    version: string
  }
}

export interface PageRankOptions {
  dampingFactor?: number
  maxIterations?: number
  tolerance?: number
}

export interface CentralityOptions {
  normalized?: boolean
}

// ============================================================================
// ERRORS
// ============================================================================

export class GraphError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GraphError'
  }
}

export class NodeNotFoundError extends GraphError {
  constructor(id: string) {
    super(`Node not found: ${id}`)
    this.name = 'NodeNotFoundError'
  }
}

export class EdgeNotFoundError extends GraphError {
  constructor(id: string) {
    super(`Edge not found: ${id}`)
    this.name = 'EdgeNotFoundError'
  }
}

// ============================================================================
// GRAPH ENGINE
// ============================================================================

export class GraphEngine {
  private nodes: Map<string, Node> = new Map()
  private edges: Map<string, Edge> = new Map()
  private outgoingEdges: Map<string, Set<string>> = new Map()
  private incomingEdges: Map<string, Set<string>> = new Map()
  private idCounter = 0

  // --------------------------------------------------------------------------
  // NODE OPERATIONS
  // --------------------------------------------------------------------------

  async createNode(
    label: string,
    properties: Record<string, unknown>,
    options?: { id?: string }
  ): Promise<Node> {
    const id = options?.id ?? this.generateId('node')

    if (this.nodes.has(id)) {
      throw new GraphError(`Node with ID ${id} already exists`)
    }

    const now = Date.now()
    const node: Node = {
      id,
      label,
      properties,
      createdAt: now,
      updatedAt: now,
    }

    this.nodes.set(id, node)
    this.outgoingEdges.set(id, new Set())
    this.incomingEdges.set(id, new Set())

    return node
  }

  async getNode(id: string): Promise<Node | null> {
    return this.nodes.get(id) ?? null
  }

  async updateNode(
    id: string,
    properties: Record<string, unknown>,
    options?: { label?: string }
  ): Promise<Node> {
    const node = this.nodes.get(id)
    if (!node) {
      throw new NodeNotFoundError(id)
    }

    const updated: Node = {
      ...node,
      label: options?.label ?? node.label,
      properties: { ...node.properties, ...properties },
      updatedAt: Date.now(),
    }

    this.nodes.set(id, updated)
    return updated
  }

  async deleteNode(id: string): Promise<boolean> {
    const node = this.nodes.get(id)
    if (!node) {
      return false
    }

    // Delete all connected edges
    const outgoing = this.outgoingEdges.get(id) ?? new Set()
    const incoming = this.incomingEdges.get(id) ?? new Set()

    for (const edgeId of outgoing) {
      await this.deleteEdge(edgeId)
    }

    for (const edgeId of incoming) {
      await this.deleteEdge(edgeId)
    }

    this.nodes.delete(id)
    this.outgoingEdges.delete(id)
    this.incomingEdges.delete(id)

    return true
  }

  async queryNodes(query: NodeQuery): Promise<Node[]> {
    let results = Array.from(this.nodes.values())

    // Filter by label
    if (query.label) {
      results = results.filter((n) => n.label === query.label)
    }

    // Filter by where clause
    if (query.where) {
      results = results.filter((n) => this.matchesWhere(n.properties, query.where!))
    }

    // Order by
    if (query.orderBy) {
      const [field, direction] = Object.entries(query.orderBy)[0]!
      results.sort((a, b) => {
        const aVal = a.properties[field] as number
        const bVal = b.properties[field] as number
        if (aVal === undefined) return direction === 'asc' ? 1 : -1
        if (bVal === undefined) return direction === 'asc' ? -1 : 1
        return direction === 'asc' ? aVal - bVal : bVal - aVal
      })
    }

    // Pagination
    if (query.offset) {
      results = results.slice(query.offset)
    }
    if (query.limit) {
      results = results.slice(0, query.limit)
    }

    return results
  }

  // --------------------------------------------------------------------------
  // EDGE OPERATIONS
  // --------------------------------------------------------------------------

  async createEdge(
    from: string | Node,
    type: string,
    to: string | Node,
    properties: Record<string, unknown> = {}
  ): Promise<Edge> {
    const fromId = typeof from === 'string' ? from : from.id
    const toId = typeof to === 'string' ? to : to.id

    if (!this.nodes.has(fromId)) {
      throw new NodeNotFoundError(fromId)
    }
    if (!this.nodes.has(toId)) {
      throw new NodeNotFoundError(toId)
    }

    const id = this.generateId('edge')
    const edge: Edge = {
      id,
      type,
      from: fromId,
      to: toId,
      properties,
      createdAt: Date.now(),
    }

    this.edges.set(id, edge)
    this.outgoingEdges.get(fromId)!.add(id)
    this.incomingEdges.get(toId)!.add(id)

    return edge
  }

  async getEdge(id: string): Promise<Edge | null> {
    return this.edges.get(id) ?? null
  }

  async updateEdge(id: string, properties: Record<string, unknown>): Promise<Edge> {
    const edge = this.edges.get(id)
    if (!edge) {
      throw new EdgeNotFoundError(id)
    }

    const updated: Edge = {
      ...edge,
      properties: { ...edge.properties, ...properties },
    }

    this.edges.set(id, updated)
    return updated
  }

  async deleteEdge(id: string): Promise<boolean> {
    const edge = this.edges.get(id)
    if (!edge) {
      return false
    }

    this.edges.delete(id)
    this.outgoingEdges.get(edge.from)?.delete(id)
    this.incomingEdges.get(edge.to)?.delete(id)

    return true
  }

  async queryEdges(query: EdgeQuery): Promise<Edge[]> {
    let results = Array.from(this.edges.values())

    if (query.type) {
      results = results.filter((e) => e.type === query.type)
    }
    if (query.from) {
      results = results.filter((e) => e.from === query.from)
    }
    if (query.to) {
      results = results.filter((e) => e.to === query.to)
    }
    if (query.where) {
      results = results.filter((e) => this.matchesWhere(e.properties, query.where!))
    }

    return results
  }

  async getEdges(): Promise<Edge[]> {
    return Array.from(this.edges.values())
  }

  // --------------------------------------------------------------------------
  // TRAVERSAL OPERATIONS
  // --------------------------------------------------------------------------

  async traverse(options: TraversalOptions): Promise<TraversalResult> {
    const startId = typeof options.start === 'string' ? options.start : options.start.id

    if (!this.nodes.has(startId)) {
      throw new NodeNotFoundError(startId)
    }

    const visited = new Set<string>()
    const result: Node[] = []
    const paths: PathResult[] = []
    const depths = new Map<string, number>()
    const queue: [string, PathResult, number][] = []

    const startNode = this.nodes.get(startId)!
    queue.push([startId, { nodes: [startNode], edges: [], length: 0 }, 0])
    visited.add(startId)

    while (queue.length > 0) {
      const [currentId, path, depth] = queue.shift()!

      if (depth > 0) {
        result.push(this.nodes.get(currentId)!)
        paths.push(path)
        depths.set(currentId, depth)
      }

      if (depth >= options.maxDepth) continue

      const neighbors = this.getNeighborEdges(currentId, options.direction, options.filter?.type)

      for (const edge of neighbors) {
        const neighborId = edge.from === currentId ? edge.to : edge.from
        if (!visited.has(neighborId)) {
          visited.add(neighborId)
          const neighborNode = this.nodes.get(neighborId)!
          queue.push([
            neighborId,
            {
              nodes: [...path.nodes, neighborNode],
              edges: [...path.edges, edge],
              length: path.length + 1,
            },
            depth + 1,
          ])
        }
      }
    }

    return { nodes: result, paths, depths }
  }

  async traverseDFS(options: TraversalOptions): Promise<TraversalResult> {
    const startId = typeof options.start === 'string' ? options.start : options.start.id

    if (!this.nodes.has(startId)) {
      throw new NodeNotFoundError(startId)
    }

    const visited = new Set<string>()
    const result: Node[] = []
    const visitOrder: string[] = []
    const paths: PathResult[] = []
    const depths = new Map<string, number>()

    const dfs = (currentId: string, path: PathResult, depth: number) => {
      if (visited.has(currentId)) return
      visited.add(currentId)
      visitOrder.push(currentId)

      if (depth > 0) {
        result.push(this.nodes.get(currentId)!)
        paths.push(path)
        depths.set(currentId, depth)
      }

      if (depth >= options.maxDepth) return

      const neighbors = this.getNeighborEdges(currentId, options.direction, options.filter?.type)

      for (const edge of neighbors) {
        const neighborId = edge.from === currentId ? edge.to : edge.from
        if (!visited.has(neighborId)) {
          const neighborNode = this.nodes.get(neighborId)!
          dfs(
            neighborId,
            {
              nodes: [...path.nodes, neighborNode],
              edges: [...path.edges, edge],
              length: path.length + 1,
            },
            depth + 1
          )
        }
      }
    }

    const startNode = this.nodes.get(startId)!
    dfs(startId, { nodes: [startNode], edges: [], length: 0 }, 0)

    return { nodes: result, paths, depths, visitOrder }
  }

  async neighbors(
    id: string,
    options?: { type?: string; direction?: 'OUTGOING' | 'INCOMING' | 'BOTH' }
  ): Promise<Node[]> {
    const direction = options?.direction ?? 'BOTH'
    const edges = this.getNeighborEdges(id, direction, options?.type)

    const neighborIds = new Set<string>()
    for (const edge of edges) {
      const neighborId = edge.from === id ? edge.to : edge.from
      neighborIds.add(neighborId)
    }

    return Array.from(neighborIds).map((nid) => this.nodes.get(nid)!)
  }

  // --------------------------------------------------------------------------
  // PATH FINDING
  // --------------------------------------------------------------------------

  async shortestPath(
    from: string,
    to: string,
    options?: ShortestPathOptions
  ): Promise<PathResult | null> {
    if (from === to) {
      return {
        nodes: [this.nodes.get(from)!],
        edges: [],
        length: 0,
      }
    }

    const maxDepth = options?.maxDepth ?? 10
    const visited = new Map<string, PathResult>()
    const queue: [string, PathResult][] = []

    const startNode = this.nodes.get(from)!
    visited.set(from, { nodes: [startNode], edges: [], length: 0 })
    queue.push([from, { nodes: [startNode], edges: [], length: 0 }])

    while (queue.length > 0) {
      const [currentId, path] = queue.shift()!

      if (path.length >= maxDepth) continue

      const edges = this.getNeighborEdges(currentId, 'OUTGOING', options?.relationshipTypes)

      for (const edge of edges) {
        if (edge.to === to) {
          return {
            nodes: [...path.nodes, this.nodes.get(to)!],
            edges: [...path.edges, edge],
            length: path.length + 1,
          }
        }

        if (!visited.has(edge.to)) {
          const neighborNode = this.nodes.get(edge.to)!
          const newPath: PathResult = {
            nodes: [...path.nodes, neighborNode],
            edges: [...path.edges, edge],
            length: path.length + 1,
          }
          visited.set(edge.to, newPath)
          queue.push([edge.to, newPath])
        }
      }
    }

    return null
  }

  async allPaths(from: string, to: string, options?: AllPathsOptions): Promise<PathResult[]> {
    const maxDepth = options?.maxDepth ?? 10
    const maxPaths = options?.maxPaths ?? 100
    const paths: PathResult[] = []

    const dfs = (currentId: string, path: PathResult, visited: Set<string>) => {
      if (paths.length >= maxPaths) return

      if (currentId === to && path.length > 0) {
        paths.push(path)
        return
      }

      if (path.length >= maxDepth) return

      const edges = this.getNeighborEdges(currentId, 'OUTGOING', options?.relationshipTypes)

      for (const edge of edges) {
        if (!visited.has(edge.to)) {
          const newVisited = new Set(visited)
          newVisited.add(edge.to)
          const neighborNode = this.nodes.get(edge.to)!
          dfs(
            edge.to,
            {
              nodes: [...path.nodes, neighborNode],
              edges: [...path.edges, edge],
              length: path.length + 1,
            },
            newVisited
          )
        }
      }
    }

    const startNode = this.nodes.get(from)!
    dfs(from, { nodes: [startNode], edges: [], length: 0 }, new Set([from]))

    return paths
  }

  async pathExists(from: string, to: string, options?: ShortestPathOptions): Promise<boolean> {
    if (from === to) return true

    const maxDepth = options?.maxDepth ?? 10

    // Bidirectional BFS for faster existence check
    const forwardVisited = new Set<string>([from])
    const backwardVisited = new Set<string>([to])
    let forwardFrontier = [from]
    let backwardFrontier = [to]

    for (let depth = 0; depth < maxDepth; depth++) {
      // Expand forward frontier
      const nextForward: string[] = []
      for (const nodeId of forwardFrontier) {
        const edges = this.getNeighborEdges(nodeId, 'OUTGOING', options?.relationshipTypes)
        for (const edge of edges) {
          if (backwardVisited.has(edge.to)) return true
          if (!forwardVisited.has(edge.to)) {
            forwardVisited.add(edge.to)
            nextForward.push(edge.to)
          }
        }
      }
      forwardFrontier = nextForward

      // Expand backward frontier
      const nextBackward: string[] = []
      for (const nodeId of backwardFrontier) {
        const edges = this.getNeighborEdges(nodeId, 'INCOMING', options?.relationshipTypes)
        for (const edge of edges) {
          if (forwardVisited.has(edge.from)) return true
          if (!backwardVisited.has(edge.from)) {
            backwardVisited.add(edge.from)
            nextBackward.push(edge.from)
          }
        }
      }
      backwardFrontier = nextBackward

      if (forwardFrontier.length === 0 && backwardFrontier.length === 0) {
        return false
      }
    }

    return false
  }

  // --------------------------------------------------------------------------
  // PATTERN MATCHING
  // --------------------------------------------------------------------------

  async match(pattern: Pattern): Promise<MatchResult> {
    const parsed = this.parsePattern(pattern.pattern)
    const matches: Record<string, unknown>[] = []

    // Find all starting nodes
    let startNodes = Array.from(this.nodes.values())
    if (parsed.startLabel) {
      startNodes = startNodes.filter((n) => n.label === parsed.startLabel)
    }

    for (const startNode of startNodes) {
      const bindings: Record<string, Node | Edge> = {}
      bindings[parsed.startVar] = startNode

      // Recursively match the rest of the pattern
      const pathMatches = this.matchPattern(parsed, startNode, bindings, pattern.where)

      for (const match of pathMatches) {
        // Build result based on return clause
        if (pattern.return) {
          const result: Record<string, unknown> = {}
          for (const field of pattern.return) {
            const [varName, propName] = field.split('.')
            const boundValue = match[varName!]
            if (boundValue && propName) {
              result[field] = (boundValue as Node | Edge).properties?.[propName] ??
                (boundValue as Node)[propName as keyof Node]
            } else {
              result[field] = boundValue
            }
          }
          matches.push(result)
        } else {
          // Return full bindings
          matches.push(match as unknown as Record<string, unknown>)
        }
      }
    }

    return { matches }
  }

  async matchCypher(cypher: string): Promise<MatchResult> {
    // Parse Cypher-like query
    const matchMatch = cypher.match(/MATCH\s+(.+?)(?:\s+WHERE|\s+RETURN|$)/is)
    if (!matchMatch) {
      throw new GraphError('Invalid Cypher: No MATCH clause found')
    }

    const pattern = matchMatch[1]!.trim()

    const whereMatch = cypher.match(/WHERE\s+(.+?)(?:\s+RETURN|$)/is)
    const where = whereMatch ? this.parseWhereClause(whereMatch[1]!) : undefined

    const returnMatch = cypher.match(/RETURN\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/is)
    const returnFields = returnMatch ? returnMatch[1]!.split(',').map((f) => f.trim()) : undefined

    const limitMatch = cypher.match(/LIMIT\s+(\d+)/i)
    const limit = limitMatch ? parseInt(limitMatch[1]!) : undefined

    const orderMatch = cypher.match(/ORDER\s+BY\s+(\S+)\s+(ASC|DESC)?/i)
    const orderBy = orderMatch
      ? { field: orderMatch[1]!, direction: (orderMatch[2]?.toLowerCase() ?? 'asc') as 'asc' | 'desc' }
      : undefined

    let result = await this.match({ pattern, where, return: returnFields })

    if (orderBy) {
      result.matches.sort((a, b) => {
        const aVal = a[orderBy.field] as number
        const bVal = b[orderBy.field] as number
        return orderBy.direction === 'asc' ? aVal - bVal : bVal - aVal
      })
    }

    if (limit) {
      result.matches = result.matches.slice(0, limit)
    }

    return result
  }

  // --------------------------------------------------------------------------
  // AGGREGATIONS
  // --------------------------------------------------------------------------

  async degree(
    id: string,
    direction?: 'OUTGOING' | 'INCOMING',
    options?: { type?: string }
  ): Promise<number> {
    if (direction === 'OUTGOING') {
      const edges = this.getNeighborEdges(id, 'OUTGOING', options?.type)
      return edges.length
    }

    if (direction === 'INCOMING') {
      const edges = this.getNeighborEdges(id, 'INCOMING', options?.type)
      return edges.length
    }

    // Total degree
    const outEdges = this.getNeighborEdges(id, 'OUTGOING', options?.type)
    const inEdges = this.getNeighborEdges(id, 'INCOMING', options?.type)
    return outEdges.length + inEdges.length
  }

  async degreeCentrality(options?: CentralityOptions): Promise<Map<string, number>> {
    const centrality = new Map<string, number>()
    const n = this.nodes.size
    // For undirected: max possible degree is (n-1)
    // For directed total degree (in + out): max possible is 2*(n-1)
    const maxPossible = 2 * (n - 1)

    for (const [id] of this.nodes) {
      const deg = await this.degree(id)
      centrality.set(id, options?.normalized && maxPossible > 0 ? deg / maxPossible : deg)
    }

    return centrality
  }

  async betweennessCentrality(options?: CentralityOptions): Promise<Map<string, number>> {
    const centrality = new Map<string, number>()
    const nodeIds = Array.from(this.nodes.keys())

    // Initialize all to 0
    for (const id of nodeIds) {
      centrality.set(id, 0)
    }

    // For each pair of nodes, find shortest paths and count intermediaries
    for (const source of nodeIds) {
      const { paths, predecessors, distances } = this.bfsWithPredecessors(source)

      // Calculate dependencies
      const dependency = new Map<string, number>()
      for (const id of nodeIds) {
        dependency.set(id, 0)
      }

      // Process nodes in order of decreasing distance
      const orderedNodes = nodeIds
        .filter((id) => distances.has(id) && id !== source)
        .sort((a, b) => (distances.get(b) ?? 0) - (distances.get(a) ?? 0))

      for (const w of orderedNodes) {
        const preds = predecessors.get(w) ?? []
        for (const v of preds) {
          const delta = (1 + (dependency.get(w) ?? 0)) / preds.length
          dependency.set(v, (dependency.get(v) ?? 0) + delta)
        }
        if (w !== source) {
          centrality.set(w, (centrality.get(w) ?? 0) + (dependency.get(w) ?? 0))
        }
      }
    }

    // Normalize if requested
    if (options?.normalized && nodeIds.length > 2) {
      const n = nodeIds.length
      const factor = 2 / ((n - 1) * (n - 2))
      for (const [id, value] of centrality) {
        centrality.set(id, value * factor)
      }
    }

    return centrality
  }

  async pageRank(options?: PageRankOptions): Promise<Map<string, number>> {
    const dampingFactor = options?.dampingFactor ?? 0.85
    const maxIterations = options?.maxIterations ?? 100
    const tolerance = options?.tolerance ?? 1e-6

    const nodeIds = Array.from(this.nodes.keys())
    const n = nodeIds.length
    if (n === 0) return new Map()

    // Initialize ranks
    let ranks = new Map<string, number>()
    for (const id of nodeIds) {
      ranks.set(id, 1)
    }

    // Iterate
    for (let iter = 0; iter < maxIterations; iter++) {
      const newRanks = new Map<string, number>()
      let diff = 0

      for (const id of nodeIds) {
        // Sum contributions from incoming edges
        const inEdges = this.getNeighborEdges(id, 'INCOMING')
        let sum = 0

        for (const edge of inEdges) {
          const outDegree = this.outgoingEdges.get(edge.from)?.size ?? 1
          sum += (ranks.get(edge.from) ?? 0) / outDegree
        }

        const newRank = (1 - dampingFactor) + dampingFactor * sum
        newRanks.set(id, newRank)
        diff += Math.abs(newRank - (ranks.get(id) ?? 0))
      }

      ranks = newRanks

      if (diff < tolerance * n) break
    }

    return ranks
  }

  async commonNeighbors(id1: string, id2: string): Promise<Node[]> {
    const neighbors1 = await this.neighbors(id1, { direction: 'OUTGOING' })
    const neighbors2 = await this.neighbors(id2, { direction: 'OUTGOING' })

    const ids2 = new Set(neighbors2.map((n) => n.id))
    return neighbors1.filter((n) => ids2.has(n.id))
  }

  async clusteringCoefficient(id: string): Promise<number> {
    const neighborNodes = await this.neighbors(id, { direction: 'BOTH' })
    const k = neighborNodes.length

    if (k < 2) return 0

    // Count edges between neighbors (pairs of neighbors that are connected)
    const neighborIds = new Set(neighborNodes.map((n) => n.id))
    const connectedPairs = new Set<string>()

    for (const neighbor of neighborNodes) {
      const neighborEdges = this.getNeighborEdges(neighbor.id, 'BOTH')
      for (const edge of neighborEdges) {
        const otherId = edge.from === neighbor.id ? edge.to : edge.from
        if (neighborIds.has(otherId) && otherId !== id) {
          // Create a canonical pair key (sorted) to avoid double counting
          const pairKey = [neighbor.id, otherId].sort().join(':')
          connectedPairs.add(pairKey)
        }
      }
    }

    // Number of actual edges between neighbors
    const actualEdges = connectedPairs.size
    // Maximum possible edges between k neighbors: k*(k-1)/2
    const maxPossibleEdges = (k * (k - 1)) / 2

    // Clustering coefficient = actual / possible
    return actualEdges / maxPossibleEdges
  }

  // --------------------------------------------------------------------------
  // CONNECTED COMPONENTS
  // --------------------------------------------------------------------------

  /**
   * Find all connected components in the graph (treating edges as undirected).
   * Returns an array of arrays, each inner array containing node IDs in one component.
   */
  async connectedComponents(): Promise<string[][]> {
    const visited = new Set<string>()
    const components: string[][] = []

    for (const nodeId of this.nodes.keys()) {
      if (visited.has(nodeId)) continue

      // BFS to find all nodes in this component
      const component: string[] = []
      const queue = [nodeId]
      visited.add(nodeId)

      while (queue.length > 0) {
        const current = queue.shift()!
        component.push(current)

        // Get neighbors in both directions (treat as undirected)
        const edges = this.getNeighborEdges(current, 'BOTH')
        for (const edge of edges) {
          const neighborId = edge.from === current ? edge.to : edge.from
          if (!visited.has(neighborId)) {
            visited.add(neighborId)
            queue.push(neighborId)
          }
        }
      }

      components.push(component)
    }

    return components
  }

  /**
   * Find strongly connected components in a directed graph using Tarjan's algorithm.
   * Returns an array of arrays, each inner array containing node IDs in one SCC.
   */
  async stronglyConnectedComponents(): Promise<string[][]> {
    const indices = new Map<string, number>()
    const lowlinks = new Map<string, number>()
    const onStack = new Set<string>()
    const stack: string[] = []
    const sccs: string[][] = []
    let index = 0

    const strongConnect = (nodeId: string) => {
      indices.set(nodeId, index)
      lowlinks.set(nodeId, index)
      index++
      stack.push(nodeId)
      onStack.add(nodeId)

      // Consider successors (outgoing edges only for directed graph)
      const edges = this.getNeighborEdges(nodeId, 'OUTGOING')
      for (const edge of edges) {
        const successorId = edge.to
        if (!indices.has(successorId)) {
          // Successor not yet visited
          strongConnect(successorId)
          lowlinks.set(nodeId, Math.min(lowlinks.get(nodeId)!, lowlinks.get(successorId)!))
        } else if (onStack.has(successorId)) {
          // Successor is in stack and hence in current SCC
          lowlinks.set(nodeId, Math.min(lowlinks.get(nodeId)!, indices.get(successorId)!))
        }
      }

      // If nodeId is a root node, pop the stack and generate an SCC
      if (lowlinks.get(nodeId) === indices.get(nodeId)) {
        const scc: string[] = []
        let w: string
        do {
          w = stack.pop()!
          onStack.delete(w)
          scc.push(w)
        } while (w !== nodeId)
        sccs.push(scc)
      }
    }

    for (const nodeId of this.nodes.keys()) {
      if (!indices.has(nodeId)) {
        strongConnect(nodeId)
      }
    }

    return sccs
  }

  /**
   * Check if the graph is connected (treating edges as undirected).
   */
  async isConnected(): Promise<boolean> {
    if (this.nodes.size === 0) return true
    const components = await this.connectedComponents()
    return components.length === 1
  }

  /**
   * Get the largest connected component.
   */
  async largestComponent(): Promise<string[]> {
    const components = await this.connectedComponents()
    if (components.length === 0) return []
    return components.reduce((a, b) => (a.length >= b.length ? a : b))
  }

  // --------------------------------------------------------------------------
  // CLOSENESS CENTRALITY
  // --------------------------------------------------------------------------

  /**
   * Calculate closeness centrality for all nodes.
   * Closeness = (n-1) / sum of shortest path distances to all other reachable nodes.
   * For disconnected graphs, uses Wasserman-Faust formula.
   */
  async closenessCentrality(options?: CentralityOptions): Promise<Map<string, number>> {
    const centrality = new Map<string, number>()
    const nodeIds = Array.from(this.nodes.keys())
    const n = nodeIds.length

    if (n <= 1) {
      for (const id of nodeIds) {
        centrality.set(id, 0)
      }
      return centrality
    }

    for (const source of nodeIds) {
      // BFS to find shortest paths from source to all reachable nodes
      const distances = this.bfsDistances(source)

      let totalDistance = 0
      let reachable = 0

      for (const [targetId, dist] of distances) {
        if (targetId !== source && dist > 0) {
          totalDistance += dist
          reachable++
        }
      }

      let closeness = 0
      if (reachable > 0 && totalDistance > 0) {
        // Wasserman-Faust formula for disconnected graphs
        // C(i) = (r / (n-1)) * (r / sum_distances)
        // where r = number of reachable nodes
        if (options?.normalized) {
          closeness = (reachable / (n - 1)) * (reachable / totalDistance)
        } else {
          closeness = reachable / totalDistance
        }
      }

      centrality.set(source, closeness)
    }

    return centrality
  }

  /**
   * BFS to compute distances from a source to all reachable nodes.
   */
  private bfsDistances(source: string): Map<string, number> {
    const distances = new Map<string, number>()
    distances.set(source, 0)
    const queue = [source]

    while (queue.length > 0) {
      const current = queue.shift()!
      const currentDist = distances.get(current)!

      const edges = this.getNeighborEdges(current, 'OUTGOING')
      for (const edge of edges) {
        if (!distances.has(edge.to)) {
          distances.set(edge.to, currentDist + 1)
          queue.push(edge.to)
        }
      }
    }

    return distances
  }

  // --------------------------------------------------------------------------
  // WEIGHTED SHORTEST PATH (Dijkstra)
  // --------------------------------------------------------------------------

  /**
   * Find shortest weighted path using Dijkstra's algorithm.
   * Weight is read from edge properties using the specified weightProperty.
   */
  async dijkstra(
    from: string,
    to: string,
    options?: { weightProperty?: string; maxWeight?: number }
  ): Promise<{ path: PathResult; weight: number } | null> {
    const weightProperty = options?.weightProperty ?? 'weight'
    const maxWeight = options?.maxWeight ?? Infinity

    if (from === to) {
      const node = this.nodes.get(from)
      if (!node) return null
      return {
        path: { nodes: [node], edges: [], length: 0 },
        weight: 0,
      }
    }

    if (!this.nodes.has(from) || !this.nodes.has(to)) {
      return null
    }

    // Priority queue (simple array-based implementation)
    const distances = new Map<string, number>()
    const previous = new Map<string, { nodeId: string; edge: Edge }>()
    const unvisited = new Set<string>(this.nodes.keys())

    distances.set(from, 0)

    while (unvisited.size > 0) {
      // Find unvisited node with minimum distance
      let minDist = Infinity
      let current: string | null = null
      for (const nodeId of unvisited) {
        const dist = distances.get(nodeId) ?? Infinity
        if (dist < minDist) {
          minDist = dist
          current = nodeId
        }
      }

      if (current === null || minDist === Infinity) break
      if (minDist > maxWeight) break

      unvisited.delete(current)

      if (current === to) {
        // Reconstruct path
        const nodes: Node[] = []
        const edges: Edge[] = []
        let curr: string | undefined = to

        while (curr) {
          nodes.unshift(this.nodes.get(curr)!)
          const prev = previous.get(curr)
          if (prev) {
            edges.unshift(prev.edge)
            curr = prev.nodeId
          } else {
            curr = undefined
          }
        }

        return {
          path: { nodes, edges, length: edges.length },
          weight: distances.get(to)!,
        }
      }

      // Explore neighbors
      const neighborEdges = this.getNeighborEdges(current, 'OUTGOING')
      for (const edge of neighborEdges) {
        if (!unvisited.has(edge.to)) continue

        const weight = (edge.properties[weightProperty] as number) ?? 1
        const alt = (distances.get(current) ?? Infinity) + weight

        if (alt < (distances.get(edge.to) ?? Infinity)) {
          distances.set(edge.to, alt)
          previous.set(edge.to, { nodeId: current, edge })
        }
      }
    }

    return null
  }

  // --------------------------------------------------------------------------
  // MINIMUM SPANNING TREE (Kruskal's Algorithm)
  // --------------------------------------------------------------------------

  /**
   * Find minimum spanning tree using Kruskal's algorithm.
   * Returns the edges in the MST.
   */
  async minimumSpanningTree(options?: { weightProperty?: string }): Promise<Edge[]> {
    const weightProperty = options?.weightProperty ?? 'weight'

    // Get all edges and sort by weight
    const allEdges = Array.from(this.edges.values())
    allEdges.sort((a, b) => {
      const weightA = (a.properties[weightProperty] as number) ?? 1
      const weightB = (b.properties[weightProperty] as number) ?? 1
      return weightA - weightB
    })

    // Union-Find data structure
    const parent = new Map<string, string>()
    const rank = new Map<string, number>()

    const find = (x: string): string => {
      if (!parent.has(x)) {
        parent.set(x, x)
        rank.set(x, 0)
      }
      if (parent.get(x) !== x) {
        parent.set(x, find(parent.get(x)!))
      }
      return parent.get(x)!
    }

    const union = (x: string, y: string): boolean => {
      const rootX = find(x)
      const rootY = find(y)
      if (rootX === rootY) return false

      const rankX = rank.get(rootX) ?? 0
      const rankY = rank.get(rootY) ?? 0

      if (rankX < rankY) {
        parent.set(rootX, rootY)
      } else if (rankX > rankY) {
        parent.set(rootY, rootX)
      } else {
        parent.set(rootY, rootX)
        rank.set(rootX, rankX + 1)
      }
      return true
    }

    // Build MST
    const mst: Edge[] = []
    for (const edge of allEdges) {
      if (union(edge.from, edge.to)) {
        mst.push(edge)
      }
    }

    return mst
  }

  // --------------------------------------------------------------------------
  // TOPOLOGICAL SORT
  // --------------------------------------------------------------------------

  /**
   * Perform topological sort on a directed acyclic graph.
   * Returns null if the graph has cycles.
   */
  async topologicalSort(): Promise<string[] | null> {
    const inDegree = new Map<string, number>()
    const nodeIds = Array.from(this.nodes.keys())

    // Initialize in-degrees
    for (const nodeId of nodeIds) {
      inDegree.set(nodeId, 0)
    }

    // Calculate in-degrees
    for (const edge of this.edges.values()) {
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1)
    }

    // Queue of nodes with no incoming edges
    const queue: string[] = []
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(nodeId)
      }
    }

    const result: string[] = []

    while (queue.length > 0) {
      const current = queue.shift()!
      result.push(current)

      const edges = this.getNeighborEdges(current, 'OUTGOING')
      for (const edge of edges) {
        const newDegree = (inDegree.get(edge.to) ?? 1) - 1
        inDegree.set(edge.to, newDegree)
        if (newDegree === 0) {
          queue.push(edge.to)
        }
      }
    }

    // If we processed all nodes, the graph is acyclic
    if (result.length !== nodeIds.length) {
      return null // Graph has a cycle
    }

    return result
  }

  /**
   * Check if the graph has cycles.
   */
  async hasCycles(): Promise<boolean> {
    const result = await this.topologicalSort()
    return result === null
  }

  // --------------------------------------------------------------------------
  // GRAPH DIAMETER AND RADIUS
  // --------------------------------------------------------------------------

  /**
   * Calculate the eccentricity of a node (max distance to any reachable node).
   */
  async eccentricity(nodeId: string): Promise<number> {
    const distances = this.bfsDistances(nodeId)
    let maxDist = 0
    for (const dist of distances.values()) {
      if (dist > maxDist) maxDist = dist
    }
    return maxDist
  }

  /**
   * Calculate graph diameter (maximum eccentricity).
   */
  async diameter(): Promise<number> {
    let maxEcc = 0
    for (const nodeId of this.nodes.keys()) {
      const ecc = await this.eccentricity(nodeId)
      if (ecc > maxEcc) maxEcc = ecc
    }
    return maxEcc
  }

  /**
   * Calculate graph radius (minimum eccentricity).
   */
  async radius(): Promise<number> {
    let minEcc = Infinity
    for (const nodeId of this.nodes.keys()) {
      const ecc = await this.eccentricity(nodeId)
      if (ecc > 0 && ecc < minEcc) minEcc = ecc
    }
    return minEcc === Infinity ? 0 : minEcc
  }

  /**
   * Find center nodes (nodes with eccentricity equal to radius).
   */
  async center(): Promise<Node[]> {
    const rad = await this.radius()
    const centerNodes: Node[] = []
    for (const [nodeId, node] of this.nodes) {
      const ecc = await this.eccentricity(nodeId)
      if (ecc === rad) centerNodes.push(node)
    }
    return centerNodes
  }

  // --------------------------------------------------------------------------
  // STATISTICS
  // --------------------------------------------------------------------------

  async stats(): Promise<GraphStats> {
    const labelCounts: Record<string, number> = {}
    const typeCounts: Record<string, number> = {}
    let isolatedNodes = 0

    for (const node of this.nodes.values()) {
      labelCounts[node.label] = (labelCounts[node.label] ?? 0) + 1

      const outDegree = this.outgoingEdges.get(node.id)?.size ?? 0
      const inDegree = this.incomingEdges.get(node.id)?.size ?? 0
      if (outDegree === 0 && inDegree === 0) {
        isolatedNodes++
      }
    }

    for (const edge of this.edges.values()) {
      typeCounts[edge.type] = (typeCounts[edge.type] ?? 0) + 1
    }

    const nodeCount = this.nodes.size
    const edgeCount = this.edges.size
    const avgDegree = nodeCount > 0 ? (2 * edgeCount) / nodeCount : 0

    return {
      nodeCount,
      edgeCount,
      labelCounts,
      typeCounts,
      avgDegree,
      isolatedNodes,
    }
  }

  async getNodes(): Promise<Node[]> {
    return Array.from(this.nodes.values())
  }

  async clear(): Promise<void> {
    this.nodes.clear()
    this.edges.clear()
    this.outgoingEdges.clear()
    this.incomingEdges.clear()
    this.idCounter = 0
  }

  // --------------------------------------------------------------------------
  // SERIALIZATION
  // --------------------------------------------------------------------------

  async export(): Promise<GraphExport> {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
      metadata: {
        exportedAt: Date.now(),
        version: '1.0.0',
      },
    }
  }

  async import(data: GraphExport): Promise<void> {
    await this.clear()

    for (const node of data.nodes) {
      this.nodes.set(node.id, node)
      this.outgoingEdges.set(node.id, new Set())
      this.incomingEdges.set(node.id, new Set())
    }

    for (const edge of data.edges) {
      this.edges.set(edge.id, edge)
      this.outgoingEdges.get(edge.from)?.add(edge.id)
      this.incomingEdges.get(edge.to)?.add(edge.id)
    }
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private generateId(prefix: string): string {
    return `${prefix}-${++this.idCounter}-${Date.now().toString(36)}`
  }

  private getNeighborEdges(
    nodeId: string,
    direction: 'OUTGOING' | 'INCOMING' | 'BOTH',
    relationshipTypes?: string | string[]
  ): Edge[] {
    const edges: Edge[] = []
    const types = relationshipTypes
      ? Array.isArray(relationshipTypes)
        ? relationshipTypes
        : [relationshipTypes]
      : undefined

    if (direction === 'OUTGOING' || direction === 'BOTH') {
      const outgoing = this.outgoingEdges.get(nodeId) ?? new Set()
      for (const edgeId of outgoing) {
        const edge = this.edges.get(edgeId)!
        if (!types || types.includes(edge.type)) {
          edges.push(edge)
        }
      }
    }

    if (direction === 'INCOMING' || direction === 'BOTH') {
      const incoming = this.incomingEdges.get(nodeId) ?? new Set()
      for (const edgeId of incoming) {
        const edge = this.edges.get(edgeId)!
        if (!types || types.includes(edge.type)) {
          edges.push(edge)
        }
      }
    }

    return edges
  }

  private matchesWhere(properties: Record<string, unknown>, where: WhereClause): boolean {
    for (const [key, condition] of Object.entries(where)) {
      const value = properties[key]

      if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
        const ops = condition as ComparisonOperators

        if (ops.$gt !== undefined && (value === undefined || (value as number) <= ops.$gt)) {
          return false
        }
        if (ops.$gte !== undefined && (value === undefined || (value as number) < ops.$gte)) {
          return false
        }
        if (ops.$lt !== undefined && (value === undefined || (value as number) >= ops.$lt)) {
          return false
        }
        if (ops.$lte !== undefined && (value === undefined || (value as number) > ops.$lte)) {
          return false
        }
        if (ops.$ne !== undefined && value === ops.$ne) {
          return false
        }
        if (ops.$in !== undefined && !ops.$in.includes(value)) {
          return false
        }
        if (ops.$contains !== undefined && (typeof value !== 'string' || !value.includes(ops.$contains))) {
          return false
        }
        if (ops.$exists !== undefined) {
          const exists = value !== undefined
          if (ops.$exists !== exists) {
            return false
          }
        }
      } else {
        if (value !== condition) {
          return false
        }
      }
    }

    return true
  }

  private parsePattern(pattern: string): {
    startVar: string
    startLabel?: string
    relationships: {
      edgeVar?: string
      edgeTypes?: string[]
      direction: 'out' | 'in' | 'both'
      minHops: number
      maxHops: number
      endVar: string
      endLabel?: string
    }[]
  } {
    // Parse nodes: (var:Label)
    const nodeRegex = /\((\w+)?(?::(\w+))?\)/g
    const nodes: { var?: string; label?: string }[] = []
    let match
    while ((match = nodeRegex.exec(pattern)) !== null) {
      nodes.push({ var: match[1], label: match[2] })
    }

    // Parse relationships: -[var:TYPE*min..max]->
    const relRegex = /<?\-\[(\w+)?(?::([A-Z_|]+))?(?:\*(\d+)?\.\.?(\d+)?)?\]\->/g
    const relationships: {
      edgeVar?: string
      edgeTypes?: string[]
      direction: 'out' | 'in' | 'both'
      minHops: number
      maxHops: number
      endVar: string
      endLabel?: string
    }[] = []

    let relMatch
    let nodeIndex = 0
    while ((relMatch = relRegex.exec(pattern)) !== null) {
      nodeIndex++
      const isDirected = !pattern.substring(relMatch.index - 1, relMatch.index).includes('<')
      const types = relMatch[2] ? relMatch[2].split('|') : undefined

      relationships.push({
        edgeVar: relMatch[1],
        edgeTypes: types,
        direction: pattern.includes('<-') ? 'both' : 'out',
        minHops: relMatch[3] ? parseInt(relMatch[3]) : 1,
        maxHops: relMatch[4] ? parseInt(relMatch[4]) : 1,
        endVar: nodes[nodeIndex]?.var ?? 'n' + nodeIndex,
        endLabel: nodes[nodeIndex]?.label,
      })
    }

    // Handle undirected pattern -[:TYPE]-
    const undirectedRegex = /\-\[(\w+)?(?::([A-Z_|]+))?\]\-(?!>)/g
    while ((relMatch = undirectedRegex.exec(pattern)) !== null) {
      nodeIndex++
      const types = relMatch[2] ? relMatch[2].split('|') : undefined

      relationships.push({
        edgeVar: relMatch[1],
        edgeTypes: types,
        direction: 'both',
        minHops: 1,
        maxHops: 1,
        endVar: nodes[nodeIndex]?.var ?? 'n' + nodeIndex,
        endLabel: nodes[nodeIndex]?.label,
      })
    }

    return {
      startVar: nodes[0]?.var ?? 'a',
      startLabel: nodes[0]?.label,
      relationships,
    }
  }

  private matchPattern(
    parsed: ReturnType<typeof this.parsePattern>,
    currentNode: Node,
    bindings: Record<string, Node | Edge>,
    where?: Record<string, unknown>
  ): Record<string, Node | Edge>[] {
    // Check where clause for current bindings
    if (where && !this.checkWhereClause(bindings, where)) {
      return []
    }

    if (parsed.relationships.length === 0) {
      return [bindings]
    }

    const results: Record<string, Node | Edge>[] = []
    const rel = parsed.relationships[0]
    const remainingRels = parsed.relationships.slice(1)

    // Expand paths for variable length
    this.expandRelationship(
      currentNode,
      rel!,
      bindings,
      where,
      { ...parsed, relationships: remainingRels },
      results,
      1
    )

    return results
  }

  private expandRelationship(
    currentNode: Node,
    rel: ReturnType<typeof this.parsePattern>['relationships'][0],
    bindings: Record<string, Node | Edge>,
    where: Record<string, unknown> | undefined,
    remainingParsed: ReturnType<typeof this.parsePattern>,
    results: Record<string, Node | Edge>[],
    currentHop: number
  ): void {
    const direction = rel.direction === 'both' ? 'BOTH' : 'OUTGOING'
    const edges = this.getNeighborEdges(currentNode.id, direction, rel.edgeTypes)

    for (const edge of edges) {
      const neighborId = edge.from === currentNode.id ? edge.to : edge.from
      const neighborNode = this.nodes.get(neighborId)!

      // Check label constraint
      if (rel.endLabel && neighborNode.label !== rel.endLabel) {
        continue
      }

      const newBindings = { ...bindings }
      if (rel.edgeVar) {
        newBindings[rel.edgeVar] = edge
      }
      newBindings[rel.endVar] = neighborNode

      // If we're within valid hop range
      if (currentHop >= rel.minHops && currentHop <= rel.maxHops) {
        // Continue to remaining pattern
        const subResults = this.matchPattern(remainingParsed, neighborNode, newBindings, where)
        results.push(...subResults)
      }

      // If we can go deeper
      if (currentHop < rel.maxHops) {
        this.expandRelationship(
          neighborNode,
          rel,
          newBindings,
          where,
          remainingParsed,
          results,
          currentHop + 1
        )
      }
    }
  }

  private checkWhereClause(
    bindings: Record<string, Node | Edge>,
    where: Record<string, unknown>
  ): boolean {
    for (const [key, condition] of Object.entries(where)) {
      const [varName, propName] = key.split('.')
      const bound = bindings[varName!] as Node | Edge | undefined

      if (!bound) continue

      const value = propName
        ? (bound as Node).properties?.[propName] ?? (bound as Node)[propName as keyof Node]
        : bound

      if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
        const ops = condition as ComparisonOperators
        if (ops.$gt !== undefined && (value as number) <= ops.$gt) return false
        if (ops.$ne !== undefined && value === ops.$ne) return false
        // Add other operators as needed
      } else {
        if (value !== condition) return false
      }
    }

    return true
  }

  private parseWhereClause(whereStr: string): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    const conditions = whereStr.split(/\s+AND\s+/i)

    for (const condition of conditions) {
      const eqMatch = condition.match(/(\w+\.\w+)\s*=\s*['"]?([^'"]+)['"]?/)
      if (eqMatch) {
        result[eqMatch[1]!] = eqMatch[2]
      }
    }

    return result
  }

  private bfsWithPredecessors(source: string): {
    paths: Map<string, number>
    predecessors: Map<string, string[]>
    distances: Map<string, number>
  } {
    const paths = new Map<string, number>()
    const predecessors = new Map<string, string[]>()
    const distances = new Map<string, number>()

    paths.set(source, 1)
    distances.set(source, 0)

    const queue = [source]

    while (queue.length > 0) {
      const current = queue.shift()!
      const currentDist = distances.get(current)!

      const edges = this.getNeighborEdges(current, 'OUTGOING')
      for (const edge of edges) {
        const neighbor = edge.to

        if (!distances.has(neighbor)) {
          distances.set(neighbor, currentDist + 1)
          paths.set(neighbor, 0)
          predecessors.set(neighbor, [])
          queue.push(neighbor)
        }

        if (distances.get(neighbor) === currentDist + 1) {
          paths.set(neighbor, (paths.get(neighbor) ?? 0) + (paths.get(current) ?? 0))
          predecessors.get(neighbor)!.push(current)
        }
      }
    }

    return { paths, predecessors, distances }
  }
}
