/**
 * Graph Analytics Algorithms
 *
 * Implements common graph analytics algorithms:
 * - PageRank - Iterative node importance scoring
 * - Connected Components - Union-find based component detection
 * - Strongly Connected Components - Tarjan's algorithm
 * - Triangle Counting - Clustering coefficient calculation
 * - Community Detection - Label propagation algorithm
 *
 * @see Issue dotdo-judnb
 * @module db/compat/graph/src/graph-analytics
 */

import { AdjacencyIndex } from './traversal-engine'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for PageRank algorithm
 */
export interface PageRankOptions {
  /** Damping factor (typically 0.85) */
  damping?: number
  /** Maximum number of iterations */
  iterations?: number
  /** Convergence tolerance - stop when max change < tolerance */
  tolerance?: number
}

/**
 * PageRank result - node ID to score mapping
 */
export type PageRankResult = Map<string, number>

/**
 * Connected components result
 */
export interface ConnectedComponentsResult {
  /** Total number of components */
  componentCount: number
  /** Map from node ID to component ID */
  nodeToComponent: Map<string, string>
  /** Map from component ID to size */
  componentSizes: Map<string, number>
}

/**
 * Strongly connected components result
 */
export interface StronglyConnectedComponentsResult {
  /** Total number of strongly connected components */
  componentCount: number
  /** Map from node ID to component ID */
  nodeToComponent: Map<string, string>
  /** Map from component ID to size */
  componentSizes: Map<string, number>
}

/**
 * Triangle count result
 */
export interface TriangleCountResult {
  /** Total number of triangles in the graph */
  totalTriangles: number
  /** Map from node ID to number of triangles it participates in */
  nodeTriangles: Map<string, number>
}

/**
 * Community detection options
 */
export interface CommunityOptions {
  /** Maximum iterations for label propagation */
  maxIterations?: number
}

/**
 * Community detection result
 */
export interface CommunityResult {
  /** Total number of communities */
  communityCount: number
  /** Map from node ID to community ID */
  nodeToCommunity: Map<string, string>
  /** Map from community ID to size */
  communitySizes: Map<string, number>
}

// ============================================================================
// Union-Find Data Structure (for Connected Components)
// ============================================================================

class UnionFind {
  private parent: Map<string, string> = new Map()
  private rank: Map<string, number> = new Map()

  /**
   * Add a node to the union-find structure
   */
  add(node: string): void {
    if (!this.parent.has(node)) {
      this.parent.set(node, node)
      this.rank.set(node, 0)
    }
  }

  /**
   * Find the root of a node with path compression
   */
  find(node: string): string {
    if (!this.parent.has(node)) {
      this.add(node)
    }

    if (this.parent.get(node) !== node) {
      // Path compression
      this.parent.set(node, this.find(this.parent.get(node)!))
    }
    return this.parent.get(node)!
  }

  /**
   * Union two nodes by rank
   */
  union(a: string, b: string): void {
    const rootA = this.find(a)
    const rootB = this.find(b)

    if (rootA === rootB) return

    const rankA = this.rank.get(rootA)!
    const rankB = this.rank.get(rootB)!

    if (rankA < rankB) {
      this.parent.set(rootA, rootB)
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA)
    } else {
      this.parent.set(rootB, rootA)
      this.rank.set(rootA, rankA + 1)
    }
  }

  /**
   * Get all nodes
   */
  getNodes(): string[] {
    return Array.from(this.parent.keys())
  }
}

// ============================================================================
// Graph Analytics Class
// ============================================================================

/**
 * Graph analytics algorithms implementation
 */
export class GraphAnalytics {
  private index: AdjacencyIndex

  constructor(index: AdjacencyIndex) {
    this.index = index
  }

  /**
   * Get all unique node IDs from the adjacency index
   */
  private getAllNodes(): Set<string> {
    const nodes = new Set<string>()

    // We need to access the internal maps of AdjacencyIndex
    // Since AdjacencyIndex only exposes getOutgoing/getIncoming/getNeighbors,
    // we collect nodes by iterating through results
    // This is a limitation - in a real implementation, we'd add a getAllNodes() method

    // For now, we'll use a workaround by tracking nodes when edges are added
    // We need to get nodes from the index - let's check what methods are available

    // The AdjacencyIndex has private outgoing/incoming maps
    // We can get nodes by collecting from edge operations
    // Let's use reflection or add a method to expose this

    // Workaround: use the internal structure
    const indexAny = this.index as any
    if (indexAny.outgoing) {
      for (const nodeId of indexAny.outgoing.keys()) {
        nodes.add(nodeId)
      }
    }
    if (indexAny.incoming) {
      for (const nodeId of indexAny.incoming.keys()) {
        nodes.add(nodeId)
      }
    }

    return nodes
  }

  /**
   * Get outgoing edges for a node
   */
  private getOutgoing(nodeId: string): string[] {
    return this.index.getOutgoing(nodeId).map(e => e.to)
  }

  /**
   * Get incoming edges for a node
   */
  private getIncoming(nodeId: string): string[] {
    return this.index.getIncoming(nodeId).map(e => e.from)
  }

  /**
   * Get all neighbors (both directions) for a node
   */
  private getNeighbors(nodeId: string): string[] {
    return this.index.getNeighbors(nodeId, 'both')
  }

  // ==========================================================================
  // PageRank Algorithm
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
  async pageRank(options: PageRankOptions = {}): Promise<PageRankResult> {
    const damping = options.damping ?? 0.85
    const maxIterations = options.iterations ?? 20
    const tolerance = options.tolerance ?? 0.0001

    const nodes = this.getAllNodes()
    const nodeIds = Array.from(nodes)
    const N = nodeIds.length

    if (N === 0) {
      return new Map()
    }

    // Initialize PageRank values
    const ranks = new Map<string, number>()
    const initialRank = 1 / N

    for (const nodeId of nodeIds) {
      ranks.set(nodeId, initialRank)
    }

    // Calculate out-degree for each node
    const outDegree = new Map<string, number>()
    for (const nodeId of nodeIds) {
      const outgoing = this.getOutgoing(nodeId)
      outDegree.set(nodeId, outgoing.length)
    }

    // Iterative computation
    for (let iter = 0; iter < maxIterations; iter++) {
      const newRanks = new Map<string, number>()
      let maxDiff = 0

      // Calculate dangling node contribution (nodes with no outgoing links)
      let danglingSum = 0
      for (const nodeId of nodeIds) {
        if (outDegree.get(nodeId) === 0) {
          danglingSum += ranks.get(nodeId)!
        }
      }
      const danglingContribution = damping * danglingSum / N

      for (const nodeId of nodeIds) {
        // Sum contributions from incoming nodes
        let incomingSum = 0
        const incoming = this.getIncoming(nodeId)

        for (const sourceId of incoming) {
          const sourceRank = ranks.get(sourceId) || 0
          const sourceOutDegree = outDegree.get(sourceId) || 1
          if (sourceOutDegree > 0) {
            incomingSum += sourceRank / sourceOutDegree
          }
        }

        // Calculate new rank with random jump and dangling contribution
        const newRank = (1 - damping) / N + damping * incomingSum + danglingContribution
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

    return ranks
  }

  // ==========================================================================
  // Connected Components (Union-Find)
  // ==========================================================================

  /**
   * Find connected components using Union-Find (treating graph as undirected)
   */
  async connectedComponents(): Promise<ConnectedComponentsResult> {
    const nodes = this.getAllNodes()

    if (nodes.size === 0) {
      return {
        componentCount: 0,
        nodeToComponent: new Map(),
        componentSizes: new Map(),
      }
    }

    const uf = new UnionFind()

    // Add all nodes
    for (const nodeId of nodes) {
      uf.add(nodeId)
    }

    // Union connected nodes
    for (const nodeId of nodes) {
      const neighbors = this.getNeighbors(nodeId)
      for (const neighbor of neighbors) {
        uf.union(nodeId, neighbor)
      }
    }

    // Build result
    const nodeToComponent = new Map<string, string>()
    const componentSizes = new Map<string, number>()

    for (const nodeId of nodes) {
      const root = uf.find(nodeId)
      nodeToComponent.set(nodeId, root)

      const currentSize = componentSizes.get(root) || 0
      componentSizes.set(root, currentSize + 1)
    }

    return {
      componentCount: componentSizes.size,
      nodeToComponent,
      componentSizes,
    }
  }

  // ==========================================================================
  // Strongly Connected Components (Tarjan's Algorithm)
  // ==========================================================================

  /**
   * Find strongly connected components using Tarjan's algorithm
   */
  async stronglyConnectedComponents(): Promise<StronglyConnectedComponentsResult> {
    const nodes = this.getAllNodes()

    if (nodes.size === 0) {
      return {
        componentCount: 0,
        nodeToComponent: new Map(),
        componentSizes: new Map(),
      }
    }

    // Tarjan's algorithm state
    let index = 0
    const nodeIndex = new Map<string, number>()
    const lowLink = new Map<string, number>()
    const onStack = new Set<string>()
    const stack: string[] = []

    const components: string[][] = []
    const nodeToComponent = new Map<string, string>()

    const strongConnect = (nodeId: string): void => {
      // Set the depth index for v to the smallest unused index
      nodeIndex.set(nodeId, index)
      lowLink.set(nodeId, index)
      index++
      stack.push(nodeId)
      onStack.add(nodeId)

      // Consider successors of v
      const successors = this.getOutgoing(nodeId)
      for (const successor of successors) {
        if (!nodeIndex.has(successor)) {
          // Successor has not yet been visited; recurse on it
          strongConnect(successor)
          lowLink.set(nodeId, Math.min(lowLink.get(nodeId)!, lowLink.get(successor)!))
        } else if (onStack.has(successor)) {
          // Successor is in stack and hence in the current SCC
          lowLink.set(nodeId, Math.min(lowLink.get(nodeId)!, nodeIndex.get(successor)!))
        }
      }

      // If v is a root node, pop the stack and generate an SCC
      if (lowLink.get(nodeId) === nodeIndex.get(nodeId)) {
        const component: string[] = []
        let w: string
        do {
          w = stack.pop()!
          onStack.delete(w)
          component.push(w)
        } while (w !== nodeId)

        components.push(component)
      }
    }

    // Run algorithm on all nodes
    for (const nodeId of nodes) {
      if (!nodeIndex.has(nodeId)) {
        strongConnect(nodeId)
      }
    }

    // Build result
    const componentSizes = new Map<string, number>()

    for (let i = 0; i < components.length; i++) {
      const component = components[i]
      const componentId = `scc-${i}`

      for (const nodeId of component) {
        nodeToComponent.set(nodeId, componentId)
      }

      componentSizes.set(componentId, component.length)
    }

    return {
      componentCount: components.length,
      nodeToComponent,
      componentSizes,
    }
  }

  // ==========================================================================
  // Triangle Counting
  // ==========================================================================

  /**
   * Count triangles in the graph
   *
   * A triangle is a set of three nodes where each pair is connected.
   * For undirected graphs, we count each unique triangle once.
   */
  async triangleCount(): Promise<TriangleCountResult> {
    const nodes = this.getAllNodes()
    const nodeList = Array.from(nodes)

    if (nodeList.length < 3) {
      return {
        totalTriangles: 0,
        nodeTriangles: new Map(nodeList.map(n => [n, 0])),
      }
    }

    // Build adjacency set for fast lookup
    const adjacencySet = new Map<string, Set<string>>()
    for (const nodeId of nodeList) {
      const neighbors = new Set(this.getNeighbors(nodeId))
      adjacencySet.set(nodeId, neighbors)
    }

    // Count triangles
    const nodeTriangles = new Map<string, number>()
    for (const nodeId of nodeList) {
      nodeTriangles.set(nodeId, 0)
    }

    let totalTriangles = 0
    const countedTriangles = new Set<string>()

    // For each node, check if any two of its neighbors are connected
    for (const u of nodeList) {
      const neighborsU = adjacencySet.get(u) || new Set()

      for (const v of neighborsU) {
        if (v <= u) continue // Avoid counting same triangle multiple times

        const neighborsV = adjacencySet.get(v) || new Set()

        for (const w of neighborsV) {
          if (w <= v) continue // Avoid counting same triangle multiple times

          // Check if w is also a neighbor of u (forming a triangle)
          if (neighborsU.has(w)) {
            // Create canonical triangle ID to avoid duplicates
            const triangleId = [u, v, w].sort().join('-')
            if (!countedTriangles.has(triangleId)) {
              countedTriangles.add(triangleId)
              totalTriangles++

              // Increment count for each node in the triangle
              nodeTriangles.set(u, (nodeTriangles.get(u) || 0) + 1)
              nodeTriangles.set(v, (nodeTriangles.get(v) || 0) + 1)
              nodeTriangles.set(w, (nodeTriangles.get(w) || 0) + 1)
            }
          }
        }
      }
    }

    return {
      totalTriangles,
      nodeTriangles,
    }
  }

  // ==========================================================================
  // Community Detection (Label Propagation)
  // ==========================================================================

  /**
   * Detect communities using Label Propagation Algorithm
   *
   * Each node is assigned a label (initially its own ID).
   * In each iteration, nodes adopt the most frequent label among their neighbors.
   * The algorithm converges when labels stabilize.
   */
  async communities(options: CommunityOptions = {}): Promise<CommunityResult> {
    const maxIterations = options.maxIterations ?? 10

    const nodes = this.getAllNodes()
    const nodeList = Array.from(nodes)

    if (nodeList.length === 0) {
      return {
        communityCount: 0,
        nodeToCommunity: new Map(),
        communitySizes: new Map(),
      }
    }

    // Initialize: each node is its own community
    const labels = new Map<string, string>()
    for (const nodeId of nodeList) {
      labels.set(nodeId, nodeId)
    }

    // Iterative label propagation
    for (let iter = 0; iter < maxIterations; iter++) {
      let changed = false

      // Shuffle node order for better convergence
      const shuffled = [...nodeList].sort(() => Math.random() - 0.5)

      for (const nodeId of shuffled) {
        const neighbors = this.getNeighbors(nodeId)

        if (neighbors.length === 0) continue

        // Count label frequencies among neighbors
        const labelCounts = new Map<string, number>()
        for (const neighbor of neighbors) {
          const neighborLabel = labels.get(neighbor)!
          labelCounts.set(neighborLabel, (labelCounts.get(neighborLabel) || 0) + 1)
        }

        // Find most frequent label
        let maxCount = 0
        let maxLabel = labels.get(nodeId)!
        const maxLabels: string[] = []

        for (const [label, count] of labelCounts) {
          if (count > maxCount) {
            maxCount = count
            maxLabels.length = 0
            maxLabels.push(label)
          } else if (count === maxCount) {
            maxLabels.push(label)
          }
        }

        // If tie, randomly select one (or keep current if it's in the tie)
        if (maxLabels.length > 0) {
          const currentLabel = labels.get(nodeId)!
          if (maxLabels.includes(currentLabel)) {
            maxLabel = currentLabel
          } else {
            // Random selection for tie-breaking
            maxLabel = maxLabels[Math.floor(Math.random() * maxLabels.length)]
          }
        }

        if (labels.get(nodeId) !== maxLabel) {
          labels.set(nodeId, maxLabel)
          changed = true
        }
      }

      // Stop if no changes
      if (!changed) break
    }

    // Build result - renumber communities for clean IDs
    const nodeToCommunity = new Map<string, string>()
    const labelToId = new Map<string, string>()
    let communityCounter = 0

    for (const [nodeId, label] of labels) {
      if (!labelToId.has(label)) {
        labelToId.set(label, `community-${communityCounter++}`)
      }
      nodeToCommunity.set(nodeId, labelToId.get(label)!)
    }

    // Calculate community sizes
    const communitySizes = new Map<string, number>()
    for (const [_nodeId, communityId] of nodeToCommunity) {
      communitySizes.set(communityId, (communitySizes.get(communityId) || 0) + 1)
    }

    return {
      communityCount: communitySizes.size,
      nodeToCommunity,
      communitySizes,
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new GraphAnalytics instance from an AdjacencyIndex
 */
export function createGraphAnalytics(index: AdjacencyIndex): GraphAnalytics {
  return new GraphAnalytics(index)
}
