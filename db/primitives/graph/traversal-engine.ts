/**
 * Traversal Engine - Graph Traversal Algorithms
 *
 * Provides BFS, DFS, and pathfinding algorithms for property graphs.
 * This is a stub implementation - full implementation pending.
 *
 * @module db/primitives/graph/traversal-engine
 */

import type { PropertyGraph, GraphNode, GraphEdge } from './property-graph'
import type { NodeId, EdgeType, Direction } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Traversal direction (same as graph Direction)
 */
export type TraversalDirection = Direction

/**
 * Mode for tracking visited nodes
 */
export type VisitedSetMode = 'global' | 'per-path' | 'none'

/**
 * Options for traversal
 */
export interface TraversalOptions {
  /** Starting node(s) */
  startNodes: NodeId | NodeId[]
  /** Maximum depth to traverse */
  maxDepth?: number
  /** Direction of traversal */
  direction?: TraversalDirection
  /** Edge types to follow */
  edgeTypes?: EdgeType[]
  /** Node filter function */
  nodeFilter?: (node: GraphNode) => boolean
  /** Edge filter function */
  edgeFilter?: (edge: GraphEdge) => boolean
  /** Visited node tracking mode */
  visitedMode?: VisitedSetMode
  /** Limit number of results */
  limit?: number
}

/**
 * Single path in traversal result
 */
export interface PathResult {
  /** Nodes in the path */
  nodes: GraphNode[]
  /** Edges in the path */
  edges: GraphEdge[]
  /** Total cost/weight of path */
  cost?: number
  /** Path length (number of edges) */
  length: number
}

/**
 * Options for path finding
 */
export interface PathOptions extends Omit<TraversalOptions, 'startNodes' | 'limit'> {
  /** Source node */
  source: NodeId
  /** Target node */
  target: NodeId
  /** Property to use as edge weight */
  weightProperty?: string
  /** Default weight if property missing */
  defaultWeight?: number
  /** Return all paths (not just shortest) */
  allPaths?: boolean
  /** Maximum number of paths to return */
  maxPaths?: number
}

/**
 * Traversal result
 */
export interface TraversalResult {
  /** Visited nodes in order */
  nodes: GraphNode[]
  /** Traversed edges */
  edges: GraphEdge[]
  /** Depth at which each node was discovered */
  depths: Map<NodeId, number>
  /** Statistics */
  stats: {
    nodesVisited: number
    edgesTraversed: number
    maxDepthReached: number
    executionTimeMs: number
  }
}

/**
 * Traversal engine interface
 */
export interface TraversalEngine {
  /** Breadth-first search */
  bfs(options: TraversalOptions): Promise<TraversalResult>
  /** Depth-first search */
  dfs(options: TraversalOptions): Promise<TraversalResult>
  /** Find shortest path between two nodes */
  shortestPath(options: PathOptions): Promise<PathResult | null>
  /** Find all paths between two nodes */
  allPaths(options: PathOptions): Promise<PathResult[]>
  /** Check if path exists */
  hasPath(source: NodeId, target: NodeId, options?: Omit<PathOptions, 'source' | 'target'>): Promise<boolean>
  /** Get nodes reachable within N hops */
  reachable(startNode: NodeId, maxHops: number, options?: Omit<TraversalOptions, 'startNodes' | 'maxDepth'>): Promise<GraphNode[]>
}

// ============================================================================
// Factory Function (Stub)
// ============================================================================

/**
 * Create a traversal engine for a property graph
 */
export function createTraversalEngine(_graph: PropertyGraph): TraversalEngine {
  return {
    async bfs(): Promise<TraversalResult> {
      throw new Error('Not implemented')
    },
    async dfs(): Promise<TraversalResult> {
      throw new Error('Not implemented')
    },
    async shortestPath(): Promise<PathResult | null> {
      throw new Error('Not implemented')
    },
    async allPaths(): Promise<PathResult[]> {
      throw new Error('Not implemented')
    },
    async hasPath(): Promise<boolean> {
      throw new Error('Not implemented')
    },
    async reachable(): Promise<GraphNode[]> {
      throw new Error('Not implemented')
    },
  }
}
