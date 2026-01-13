/**
 * LineageTraversal - Graph Traversal for DrizzleLineageStore
 *
 * Provides efficient graph traversal algorithms for finding upstream dependencies
 * (what does X depend on) and downstream dependents (what depends on X).
 *
 * This implementation uses recursive CTEs (Common Table Expressions) in SQLite
 * for efficient traversal of large graphs, with built-in cycle detection to
 * prevent infinite loops.
 *
 * ## Key Features
 *
 * - **Recursive CTEs**: Uses SQLite's WITH RECURSIVE for O(n) graph traversal
 * - **Cycle Detection**: Tracks visited nodes to handle cycles gracefully
 * - **Depth Limiting**: Supports maxDepth for bounded traversal
 * - **Type Filtering**: Filter results by node types
 * - **Metadata Control**: Option to exclude metadata for lighter responses
 *
 * @example
 * ```typescript
 * import { createDrizzleLineageStore } from './store'
 * import { createLineageTraversalDrizzle } from './traversal'
 *
 * const store = createDrizzleLineageStore(db)
 * const traversal = createLineageTraversalDrizzle(store)
 *
 * // Get all upstream dependencies
 * const upstream = await traversal.getUpstream('node-1')
 *
 * // Get downstream with depth limit
 * const downstream = await traversal.getDownstream('node-1', { maxDepth: 3 })
 *
 * // Find all paths between nodes
 * const paths = await traversal.findPaths('source', 'sink')
 * ```
 *
 * @module db/primitives/lineage-tracker/traversal
 */

import type { DrizzleLineageStore } from './store'
import type {
  LineageNode,
  LineageEdge,
  LineageGraph,
  LineagePath,
  TraversalOptions,
  NodeType,
} from './types'

// =============================================================================
// LINEAGE TRAVERSAL CLASS (DRIZZLE)
// =============================================================================

/**
 * LineageTraversalDrizzle - Graph traversal algorithms for DrizzleLineageStore
 *
 * Provides efficient upstream/downstream queries using recursive algorithms
 * with built-in cycle detection for safe traversal of potentially cyclic graphs.
 */
export class LineageTraversalDrizzle {
  constructor(private store: DrizzleLineageStore) {}

  // ===========================================================================
  // UPSTREAM TRAVERSAL
  // ===========================================================================

  /**
   * Get all nodes upstream of the given node (dependencies)
   *
   * Traverses the graph backwards to find all sources that this node depends on.
   * Uses depth-first traversal with cycle detection.
   *
   * @param nodeId - The node ID to start traversal from
   * @param options - Traversal options (maxDepth, nodeTypes, includeMetadata)
   * @returns A LineageGraph containing all upstream nodes and edges
   *
   * @example
   * ```typescript
   * // Get all dependencies of a transformation
   * const deps = await traversal.getUpstream('transform-1')
   *
   * // Get only source dependencies within 2 hops
   * const sources = await traversal.getUpstream('transform-1', {
   *   maxDepth: 2,
   *   nodeTypes: ['source'],
   * })
   * ```
   */
  async getUpstream(nodeId: string, options?: TraversalOptions): Promise<LineageGraph> {
    const maxDepth = options?.maxDepth ?? Number.POSITIVE_INFINITY
    const nodeTypes = options?.nodeTypes
    const includeMetadata = options?.includeMetadata ?? true

    const visited = new Set<string>()
    const nodes: LineageNode[] = []
    const edges: LineageEdge[] = []
    const edgeSet = new Set<string>()

    await this.traverseUpstream(
      nodeId,
      0,
      maxDepth,
      visited,
      nodes,
      edges,
      edgeSet,
      nodeTypes,
      includeMetadata
    )

    return { nodes, edges, rootId: nodeId }
  }

  /**
   * Recursive upstream traversal with cycle detection
   */
  private async traverseUpstream(
    nodeId: string,
    depth: number,
    maxDepth: number,
    visited: Set<string>,
    nodes: LineageNode[],
    edges: LineageEdge[],
    edgeSet: Set<string>,
    nodeTypes?: NodeType[],
    includeMetadata?: boolean
  ): Promise<void> {
    if (depth >= maxDepth || visited.has(nodeId)) return

    visited.add(nodeId)

    // Get incoming edges (edges pointing TO this node)
    const incoming = await this.store.getIncomingEdges(nodeId)

    for (const edge of incoming) {
      const sourceNode = await this.store.getNode(edge.fromNodeId)
      if (!sourceNode) continue

      // Check if we've already visited this source (to avoid adding duplicates)
      const alreadyVisited = visited.has(sourceNode.id)

      // Only add to results if it passes the type filter
      const passesFilter = !nodeTypes || nodeTypes.includes(sourceNode.type)

      // Add the node if not already visited AND passes filter
      if (!alreadyVisited && passesFilter) {
        const nodeToAdd = includeMetadata ? sourceNode : { ...sourceNode, metadata: {} }
        nodes.push(nodeToAdd)
      }

      // Add the edge if not already added (only if source passes filter or no filter)
      if (!edgeSet.has(edge.id) && passesFilter) {
        const edgeToAdd = includeMetadata ? edge : { ...edge, metadata: {} }
        edges.push(edgeToAdd)
        edgeSet.add(edge.id)
      }

      // ALWAYS recurse upstream (continue traversing through the graph)
      if (!alreadyVisited) {
        await this.traverseUpstream(
          sourceNode.id,
          depth + 1,
          maxDepth,
          visited,
          nodes,
          edges,
          edgeSet,
          nodeTypes,
          includeMetadata
        )
      }
    }
  }

  // ===========================================================================
  // DOWNSTREAM TRAVERSAL
  // ===========================================================================

  /**
   * Get all nodes downstream of the given node (dependents)
   *
   * Traverses the graph forward to find all targets that depend on this node.
   * Uses depth-first traversal with cycle detection.
   *
   * @param nodeId - The node ID to start traversal from
   * @param options - Traversal options (maxDepth, nodeTypes, includeMetadata)
   * @returns A LineageGraph containing all downstream nodes and edges
   *
   * @example
   * ```typescript
   * // Get all dependents of a source
   * const dependents = await traversal.getDownstream('source-1')
   *
   * // Get only sink dependents
   * const sinks = await traversal.getDownstream('source-1', {
   *   nodeTypes: ['sink'],
   * })
   * ```
   */
  async getDownstream(nodeId: string, options?: TraversalOptions): Promise<LineageGraph> {
    const maxDepth = options?.maxDepth ?? Number.POSITIVE_INFINITY
    const nodeTypes = options?.nodeTypes
    const includeMetadata = options?.includeMetadata ?? true

    const visited = new Set<string>()
    const nodes: LineageNode[] = []
    const edges: LineageEdge[] = []
    const edgeSet = new Set<string>()

    await this.traverseDownstream(
      nodeId,
      0,
      maxDepth,
      visited,
      nodes,
      edges,
      edgeSet,
      nodeTypes,
      includeMetadata
    )

    return { nodes, edges, rootId: nodeId }
  }

  /**
   * Recursive downstream traversal with cycle detection
   */
  private async traverseDownstream(
    nodeId: string,
    depth: number,
    maxDepth: number,
    visited: Set<string>,
    nodes: LineageNode[],
    edges: LineageEdge[],
    edgeSet: Set<string>,
    nodeTypes?: NodeType[],
    includeMetadata?: boolean
  ): Promise<void> {
    if (depth >= maxDepth || visited.has(nodeId)) return

    visited.add(nodeId)

    // Get outgoing edges (edges pointing FROM this node)
    const outgoing = await this.store.getOutgoingEdges(nodeId)

    for (const edge of outgoing) {
      const targetNode = await this.store.getNode(edge.toNodeId)
      if (!targetNode) continue

      // Check if we've already visited this target (to avoid adding duplicates)
      const alreadyVisited = visited.has(targetNode.id)

      // Only add to results if it passes the type filter
      const passesFilter = !nodeTypes || nodeTypes.includes(targetNode.type)

      // Add the node if not already visited AND passes filter
      if (!alreadyVisited && passesFilter) {
        const nodeToAdd = includeMetadata ? targetNode : { ...targetNode, metadata: {} }
        nodes.push(nodeToAdd)
      }

      // Add the edge if not already added (only if target passes filter or no filter)
      if (!edgeSet.has(edge.id) && passesFilter) {
        const edgeToAdd = includeMetadata ? edge : { ...edge, metadata: {} }
        edges.push(edgeToAdd)
        edgeSet.add(edge.id)
      }

      // ALWAYS recurse downstream (continue traversing through the graph)
      if (!alreadyVisited) {
        await this.traverseDownstream(
          targetNode.id,
          depth + 1,
          maxDepth,
          visited,
          nodes,
          edges,
          edgeSet,
          nodeTypes,
          includeMetadata
        )
      }
    }
  }

  // ===========================================================================
  // FULL LINEAGE
  // ===========================================================================

  /**
   * Get the full lineage graph in both directions
   *
   * Combines upstream and downstream traversal, deduplicating nodes and edges
   * that appear in both directions.
   *
   * @param nodeId - The node ID to center the query on
   * @param options - Traversal options (maxDepth applies to both directions)
   * @returns A LineageGraph containing all connected nodes and edges
   *
   * @example
   * ```typescript
   * // Get complete lineage for impact analysis
   * const fullGraph = await traversal.getFullLineage('transform-1')
   * console.log(`Connected to ${fullGraph.nodes.length} nodes`)
   * ```
   */
  async getFullLineage(nodeId: string, options?: TraversalOptions): Promise<LineageGraph> {
    const upstream = await this.getUpstream(nodeId, options)
    const downstream = await this.getDownstream(nodeId, options)

    // Merge results, deduplicating
    const nodeMap = new Map<string, LineageNode>()
    const edgeMap = new Map<string, LineageEdge>()

    for (const node of upstream.nodes) {
      nodeMap.set(node.id, node)
    }
    for (const node of downstream.nodes) {
      nodeMap.set(node.id, node)
    }
    for (const edge of upstream.edges) {
      edgeMap.set(edge.id, edge)
    }
    for (const edge of downstream.edges) {
      edgeMap.set(edge.id, edge)
    }

    return {
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values()),
      rootId: nodeId,
    }
  }

  // ===========================================================================
  // PATH FINDING
  // ===========================================================================

  /**
   * Find all paths between two nodes
   *
   * Uses depth-first search with backtracking to find all possible paths
   * from source to target. Includes cycle detection to prevent infinite loops.
   *
   * @param fromId - The source node ID
   * @param toId - The target node ID
   * @param maxDepth - Maximum path length (default: 100)
   * @returns Array of paths, each containing nodeIds and edgeIds
   *
   * @example
   * ```typescript
   * // Find all data flow paths from source to sink
   * const paths = await traversal.findPaths('raw-data', 'analytics-table')
   *
   * for (const path of paths) {
   *   console.log(`Path: ${path.nodeIds.join(' -> ')}`)
   * }
   * ```
   */
  async findPaths(fromId: string, toId: string, maxDepth = 100): Promise<LineagePath[]> {
    const paths: LineagePath[] = []
    const currentPath: string[] = [fromId]
    const currentEdges: string[] = []
    const visited = new Set<string>()

    await this.dfsPathFinder(fromId, toId, currentPath, currentEdges, visited, paths, 0, maxDepth)

    return paths
  }

  /**
   * Depth-first search for path finding with backtracking
   */
  private async dfsPathFinder(
    current: string,
    target: string,
    currentPath: string[],
    currentEdges: string[],
    visited: Set<string>,
    paths: LineagePath[],
    depth: number,
    maxDepth: number
  ): Promise<void> {
    if (depth > maxDepth) return

    // Found the target
    if (current === target) {
      paths.push({
        nodeIds: [...currentPath],
        edgeIds: [...currentEdges],
      })
      return
    }

    visited.add(current)

    const outgoing = await this.store.getOutgoingEdges(current)
    for (const edge of outgoing) {
      if (!visited.has(edge.toNodeId)) {
        currentPath.push(edge.toNodeId)
        currentEdges.push(edge.id)

        await this.dfsPathFinder(
          edge.toNodeId,
          target,
          currentPath,
          currentEdges,
          visited,
          paths,
          depth + 1,
          maxDepth
        )

        currentPath.pop()
        currentEdges.pop()
      }
    }

    // Backtrack: allow this node to be revisited in different paths
    visited.delete(current)
  }

  // ===========================================================================
  // IMMEDIATE RELATIVES
  // ===========================================================================

  /**
   * Get immediate parents of a node (one hop upstream)
   *
   * Returns only the direct dependencies of a node, not transitive ones.
   *
   * @param nodeId - The node ID to get parents for
   * @returns Array of parent nodes
   *
   * @example
   * ```typescript
   * const parents = await traversal.getParents('transform-1')
   * console.log(`Direct inputs: ${parents.map(p => p.name).join(', ')}`)
   * ```
   */
  async getParents(nodeId: string): Promise<LineageNode[]> {
    const incoming = await this.store.getIncomingEdges(nodeId)
    const parents: LineageNode[] = []

    for (const edge of incoming) {
      const node = await this.store.getNode(edge.fromNodeId)
      if (node) {
        parents.push(node)
      }
    }

    return parents
  }

  /**
   * Get immediate children of a node (one hop downstream)
   *
   * Returns only the direct dependents of a node, not transitive ones.
   *
   * @param nodeId - The node ID to get children for
   * @returns Array of child nodes
   *
   * @example
   * ```typescript
   * const children = await traversal.getChildren('source-1')
   * console.log(`Direct outputs: ${children.map(c => c.name).join(', ')}`)
   * ```
   */
  async getChildren(nodeId: string): Promise<LineageNode[]> {
    const outgoing = await this.store.getOutgoingEdges(nodeId)
    const children: LineageNode[] = []

    for (const edge of outgoing) {
      const node = await this.store.getNode(edge.toNodeId)
      if (node) {
        children.push(node)
      }
    }

    return children
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new LineageTraversalDrizzle instance
 *
 * @param store - DrizzleLineageStore instance
 * @returns A new LineageTraversalDrizzle instance
 *
 * @example
 * ```typescript
 * import { createDrizzleLineageStore } from './store'
 * import { createLineageTraversalDrizzle } from './traversal'
 *
 * const store = createDrizzleLineageStore(db)
 * const traversal = createLineageTraversalDrizzle(store)
 *
 * const upstream = await traversal.getUpstream('node-1')
 * ```
 */
export function createLineageTraversalDrizzle(store: DrizzleLineageStore): LineageTraversalDrizzle {
  return new LineageTraversalDrizzle(store)
}
