/**
 * LineageTracker Queries - Graph Traversal Operations
 *
 * Provides efficient graph traversal algorithms for finding upstream dependencies
 * (what does X depend on) and downstream dependents (what depends on X).
 *
 * @module db/primitives/lineage-tracker/queries
 */

import type { LineageStore } from './storage'
import type {
  LineageNode,
  LineageEdge,
  LineageGraph,
  LineagePath,
  TraversalOptions,
  ImpactAnalysis,
  ImpactOptions,
  AffectedNode,
  BlastRadiusMetrics,
  NodeType,
} from './types'

// =============================================================================
// LINEAGE TRAVERSAL CLASS
// =============================================================================

/**
 * LineageTraversal - Graph traversal algorithms for lineage queries
 */
export class LineageTraversal {
  constructor(private store: LineageStore) {}

  /**
   * Get all nodes upstream of the given node (dependencies)
   *
   * Traverses the graph backwards to find all sources that this node depends on.
   */
  getUpstream(nodeId: string, options?: TraversalOptions): LineageGraph {
    const maxDepth = options?.maxDepth ?? Number.POSITIVE_INFINITY
    const nodeTypes = options?.nodeTypes
    const includeMetadata = options?.includeMetadata ?? true

    const visited = new Set<string>()
    const nodes: LineageNode[] = []
    const edges: LineageEdge[] = []
    const edgeSet = new Set<string>()

    this.traverseUpstream(nodeId, 0, maxDepth, visited, nodes, edges, edgeSet, nodeTypes, includeMetadata)

    return { nodes, edges, rootId: nodeId }
  }

  private traverseUpstream(
    nodeId: string,
    depth: number,
    maxDepth: number,
    visited: Set<string>,
    nodes: LineageNode[],
    edges: LineageEdge[],
    edgeSet: Set<string>,
    nodeTypes?: NodeType[],
    includeMetadata?: boolean
  ): void {
    if (depth >= maxDepth || visited.has(nodeId)) return

    visited.add(nodeId)

    // Get incoming edges (edges pointing TO this node)
    const incoming = this.store.getIncomingEdges(nodeId)

    for (const edge of incoming) {
      const sourceNode = this.store.getNode(edge.fromNodeId)
      if (!sourceNode) continue

      // Check if we've already visited this source (to avoid adding duplicates)
      const alreadyVisited = visited.has(sourceNode.id)

      // Only add to results if it passes the type filter
      // But ALWAYS recurse to continue traversing through the graph
      const passesFilter = !nodeTypes || nodeTypes.includes(sourceNode.type)

      // Add the node if not already visited AND passes filter
      if (!alreadyVisited && passesFilter) {
        const nodeToAdd = includeMetadata
          ? sourceNode
          : { ...sourceNode, metadata: {} }
        nodes.push(nodeToAdd)
      }

      // Add the edge if not already added (only if both endpoints pass filter or no filter)
      if (!edgeSet.has(edge.id) && passesFilter) {
        const edgeToAdd = includeMetadata
          ? edge
          : { ...edge, metadata: {} }
        edges.push(edgeToAdd)
        edgeSet.add(edge.id)
      }

      // ALWAYS recurse upstream (don't skip based on type filter)
      if (!alreadyVisited) {
        this.traverseUpstream(
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

  /**
   * Get all nodes downstream of the given node (dependents)
   *
   * Traverses the graph forward to find all targets that depend on this node.
   */
  getDownstream(nodeId: string, options?: TraversalOptions): LineageGraph {
    const maxDepth = options?.maxDepth ?? Number.POSITIVE_INFINITY
    const nodeTypes = options?.nodeTypes
    const includeMetadata = options?.includeMetadata ?? true

    const visited = new Set<string>()
    const nodes: LineageNode[] = []
    const edges: LineageEdge[] = []
    const edgeSet = new Set<string>()

    this.traverseDownstream(nodeId, 0, maxDepth, visited, nodes, edges, edgeSet, nodeTypes, includeMetadata)

    return { nodes, edges, rootId: nodeId }
  }

  private traverseDownstream(
    nodeId: string,
    depth: number,
    maxDepth: number,
    visited: Set<string>,
    nodes: LineageNode[],
    edges: LineageEdge[],
    edgeSet: Set<string>,
    nodeTypes?: NodeType[],
    includeMetadata?: boolean
  ): void {
    if (depth >= maxDepth || visited.has(nodeId)) return

    visited.add(nodeId)

    // Get outgoing edges (edges pointing FROM this node)
    const outgoing = this.store.getOutgoingEdges(nodeId)

    for (const edge of outgoing) {
      const targetNode = this.store.getNode(edge.toNodeId)
      if (!targetNode) continue

      // Check if we've already visited this target (to avoid adding duplicates)
      const alreadyVisited = visited.has(targetNode.id)

      // Only add to results if it passes the type filter
      // But ALWAYS recurse to continue traversing through the graph
      const passesFilter = !nodeTypes || nodeTypes.includes(targetNode.type)

      // Add the node if not already visited AND passes filter
      if (!alreadyVisited && passesFilter) {
        const nodeToAdd = includeMetadata
          ? targetNode
          : { ...targetNode, metadata: {} }
        nodes.push(nodeToAdd)
      }

      // Add the edge if not already added (only if target passes filter or no filter)
      if (!edgeSet.has(edge.id) && passesFilter) {
        const edgeToAdd = includeMetadata
          ? edge
          : { ...edge, metadata: {} }
        edges.push(edgeToAdd)
        edgeSet.add(edge.id)
      }

      // ALWAYS recurse downstream (don't skip based on type filter)
      if (!alreadyVisited) {
        this.traverseDownstream(
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

  /**
   * Get the full lineage graph in both directions
   */
  getFullLineage(nodeId: string, options?: TraversalOptions): LineageGraph {
    const upstream = this.getUpstream(nodeId, options)
    const downstream = this.getDownstream(nodeId, options)

    // Merge results
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

  /**
   * Find all paths between two nodes
   */
  findPaths(fromId: string, toId: string, maxDepth = 100): LineagePath[] {
    const paths: LineagePath[] = []
    const currentPath: string[] = [fromId]
    const currentEdges: string[] = []
    const visited = new Set<string>()

    this.dfs(fromId, toId, currentPath, currentEdges, visited, paths, 0, maxDepth)

    return paths
  }

  private dfs(
    current: string,
    target: string,
    currentPath: string[],
    currentEdges: string[],
    visited: Set<string>,
    paths: LineagePath[],
    depth: number,
    maxDepth: number
  ): void {
    if (depth > maxDepth) return

    if (current === target) {
      paths.push({
        nodeIds: [...currentPath],
        edgeIds: [...currentEdges],
      })
      return
    }

    visited.add(current)

    const outgoing = this.store.getOutgoingEdges(current)
    for (const edge of outgoing) {
      if (!visited.has(edge.toNodeId)) {
        currentPath.push(edge.toNodeId)
        currentEdges.push(edge.id)

        this.dfs(edge.toNodeId, target, currentPath, currentEdges, visited, paths, depth + 1, maxDepth)

        currentPath.pop()
        currentEdges.pop()
      }
    }

    visited.delete(current)
  }

  /**
   * Get immediate parents of a node (one hop upstream)
   */
  getParents(nodeId: string): LineageNode[] {
    const incoming = this.store.getIncomingEdges(nodeId)
    const parents: LineageNode[] = []

    for (const edge of incoming) {
      const node = this.store.getNode(edge.fromNodeId)
      if (node) {
        parents.push(node)
      }
    }

    return parents
  }

  /**
   * Get immediate children of a node (one hop downstream)
   */
  getChildren(nodeId: string): LineageNode[] {
    const outgoing = this.store.getOutgoingEdges(nodeId)
    const children: LineageNode[] = []

    for (const edge of outgoing) {
      const node = this.store.getNode(edge.toNodeId)
      if (node) {
        children.push(node)
      }
    }

    return children
  }
}

// =============================================================================
// IMPACT ANALYZER CLASS
// =============================================================================

/**
 * ImpactAnalyzer - Analyzes the downstream impact of changes to a node
 */
export class ImpactAnalyzer {
  private traversal: LineageTraversal

  constructor(private store: LineageStore) {
    this.traversal = new LineageTraversal(store)
  }

  /**
   * Analyze the impact of changing a node
   *
   * Returns all downstream nodes that would be affected, with details about
   * distance, path count, and impact classification.
   */
  analyze(nodeId: string, options?: ImpactOptions): ImpactAnalysis {
    const sourceNode = this.store.getNode(nodeId)
    if (!sourceNode) {
      throw new Error(`Node not found: ${nodeId}`)
    }

    const maxDepth = options?.maxDepth ?? Number.POSITIVE_INFINITY
    const nodeTypes = options?.nodeTypes
    const includeIndirect = options?.includeIndirect ?? true

    // Track affected nodes with their distances and path counts
    const affectedMap = new Map<string, { distance: number; pathCount: number }>()
    const visited = new Set<string>()

    // BFS to find all affected nodes with distances
    this.bfsImpact(nodeId, 0, maxDepth, visited, affectedMap, nodeTypes)

    // Build affected nodes list
    const affectedNodes: AffectedNode[] = []
    for (const [id, info] of Array.from(affectedMap.entries())) {
      const node = this.store.getNode(id)
      if (!node) continue

      const isDirectChild = info.distance === 1
      affectedNodes.push({
        node,
        distance: info.distance,
        pathCount: info.pathCount,
        impact: isDirectChild ? 'direct' : 'indirect',
      })
    }

    // Sort by distance, then by path count (most connected first)
    affectedNodes.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance
      return b.pathCount - a.pathCount
    })

    // Filter out indirect if not requested
    const finalAffected = includeIndirect
      ? affectedNodes
      : affectedNodes.filter((n) => n.impact === 'direct')

    // Find critical paths (longest paths to leaf nodes)
    const criticalPaths = this.findCriticalPaths(nodeId, affectedMap, options?.criticalPathThreshold ?? 0)

    // Calculate metrics
    const metrics = this.calculateMetrics(finalAffected, criticalPaths)

    return {
      sourceNode,
      affectedNodes: finalAffected,
      totalAffected: finalAffected.length,
      criticalPaths,
      metrics,
    }
  }

  private bfsImpact(
    startId: string,
    startDepth: number,
    maxDepth: number,
    visited: Set<string>,
    affectedMap: Map<string, { distance: number; pathCount: number }>,
    nodeTypes?: NodeType[]
  ): void {
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: startDepth }]
    visited.add(startId)

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!

      if (depth >= maxDepth) continue

      const outgoing = this.store.getOutgoingEdges(id)
      for (const edge of outgoing) {
        const targetNode = this.store.getNode(edge.toNodeId)
        if (!targetNode) continue

        const newDepth = depth + 1

        // Check if node passes the type filter
        const passesFilter = !nodeTypes || nodeTypes.includes(targetNode.type)

        // Only add to affectedMap if it passes the filter
        if (passesFilter) {
          if (!affectedMap.has(edge.toNodeId)) {
            // First time seeing this node
            affectedMap.set(edge.toNodeId, { distance: newDepth, pathCount: 1 })
          } else {
            // Already seen - increment path count but keep minimum distance
            const existing = affectedMap.get(edge.toNodeId)!
            existing.pathCount++
          }
        }

        // ALWAYS continue traversing (even through filtered nodes)
        if (!visited.has(edge.toNodeId)) {
          visited.add(edge.toNodeId)
          queue.push({ id: edge.toNodeId, depth: newDepth })
        }
      }
    }
  }

  private findCriticalPaths(
    sourceId: string,
    affectedMap: Map<string, { distance: number; pathCount: number }>,
    threshold: number
  ): LineagePath[] {
    // Find leaf nodes among affected (nodes with no further downstream)
    const leaves: string[] = []
    for (const [nodeId] of affectedMap) {
      const outgoing = this.store.getOutgoingEdges(nodeId)
      // Filter to only edges pointing to other affected nodes
      const affectedOutgoing = outgoing.filter((e) => affectedMap.has(e.toNodeId))
      if (affectedOutgoing.length === 0) {
        leaves.push(nodeId)
      }
    }

    // Find paths to leaves (these are the critical paths)
    const criticalPaths: LineagePath[] = []
    for (const leafId of leaves) {
      const paths = this.traversal.findPaths(sourceId, leafId)
      criticalPaths.push(...paths)
    }

    // Sort by path length (longest first) and filter by threshold
    return criticalPaths
      .filter((p) => p.nodeIds.length >= threshold)
      .sort((a, b) => b.nodeIds.length - a.nodeIds.length)
  }

  private calculateMetrics(
    affectedNodes: AffectedNode[],
    criticalPaths: LineagePath[]
  ): BlastRadiusMetrics {
    const byDepth = new Map<number, number>()
    const byType = new Map<NodeType, number>()
    let maxDepth = 0

    for (const affected of affectedNodes) {
      // By depth
      const depthCount = byDepth.get(affected.distance) ?? 0
      byDepth.set(affected.distance, depthCount + 1)

      // By type
      const typeCount = byType.get(affected.node.type) ?? 0
      byType.set(affected.node.type, typeCount + 1)

      // Max depth
      if (affected.distance > maxDepth) {
        maxDepth = affected.distance
      }
    }

    return {
      totalAffected: affectedNodes.length,
      byDepth,
      byType,
      maxDepth,
      criticalPathCount: criticalPaths.length,
    }
  }

  /**
   * Get affected nodes grouped by type
   */
  getAffectedByType(nodeId: string, options?: ImpactOptions): Map<NodeType, LineageNode[]> {
    const analysis = this.analyze(nodeId, options)
    const result = new Map<NodeType, LineageNode[]>()

    for (const affected of analysis.affectedNodes) {
      const existing = result.get(affected.node.type) ?? []
      existing.push(affected.node)
      result.set(affected.node.type, existing)
    }

    return result
  }

  /**
   * Get blast radius metrics only (lightweight version of analyze)
   */
  getBlastRadius(nodeId: string, options?: ImpactOptions): BlastRadiusMetrics {
    const analysis = this.analyze(nodeId, options)
    return analysis.metrics
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a LineageTraversal instance
 */
export function createLineageTraversal(store: LineageStore): LineageTraversal {
  return new LineageTraversal(store)
}

/**
 * Create an ImpactAnalyzer instance
 */
export function createImpactAnalyzer(store: LineageStore): ImpactAnalyzer {
  return new ImpactAnalyzer(store)
}
