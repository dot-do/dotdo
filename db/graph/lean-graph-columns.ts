/**
 * Lean Graph Columns - depth, is_leaf, is_root
 *
 * Provides computed hierarchy columns for efficient graph queries:
 * - depth: How many levels deep in the hierarchy (0 for root nodes)
 * - is_leaf: Boolean, true if node has no children (no outgoing edges of this type)
 * - is_root: Boolean, true if node has no parent (no incoming edges of this type)
 *
 * These columns enable:
 * - Fast queries for all root/leaf nodes
 * - Efficient depth-based filtering (e.g., "get all nodes at depth 3")
 * - Tree breadcrumb generation
 * - Hierarchical navigation
 *
 * @module db/graph/lean-graph-columns
 */

import type { RelationshipsStore, GraphRelationship } from './relationships'

// ============================================================================
// Types
// ============================================================================

/**
 * Node hierarchy information computed from relationships
 */
export interface NodeHierarchyInfo {
  /** The node URL/ID */
  nodeId: string
  /** Depth from root (0 = root, 1 = first level children, etc.) */
  depth: number
  /** True if node has no children (no outgoing edges of this type) */
  is_leaf: boolean
  /** True if node has no parent (no incoming edges of this type) */
  is_root: boolean
  /** Number of direct children */
  childCount: number
  /** Number of direct parents */
  parentCount: number
}

// ============================================================================
// Standalone Helper Functions
// ============================================================================

/**
 * Compute the depth of a node in a hierarchy.
 *
 * @param nodeId - The node to compute depth for
 * @param verb - The relationship verb defining the hierarchy (e.g., 'manages', 'contains')
 * @param relationships - Relationships store instance
 * @returns The depth (0 for root nodes, -1 if not in hierarchy)
 */
export async function computeDepth(
  nodeId: string,
  verb: string,
  relationships: RelationshipsStore
): Promise<number> {
  // Build parent map for the hierarchy
  const allRelationships = await relationships.queryByVerb(verb)

  // If no relationships, return -1 (node not in hierarchy)
  if (allRelationships.length === 0) {
    return -1
  }

  // Build parent map: child -> parent
  const parentMap = new Map<string, string>()
  for (const rel of allRelationships) {
    // from -> to means from is parent of to
    parentMap.set(rel.to, rel.from)
  }

  // Check if node exists in hierarchy
  const allNodes = new Set<string>()
  for (const rel of allRelationships) {
    allNodes.add(rel.from)
    allNodes.add(rel.to)
  }

  if (!allNodes.has(nodeId)) {
    return -1
  }

  // Trace path from node to root
  let depth = 0
  let current = nodeId
  const visited = new Set<string>()

  while (parentMap.has(current)) {
    if (visited.has(current)) {
      // Cycle detected - return current depth
      break
    }
    visited.add(current)
    current = parentMap.get(current)!
    depth++
  }

  return depth
}

/**
 * Check if a node is a leaf (has no children).
 *
 * @param nodeId - The node to check
 * @param verb - The relationship verb defining the hierarchy
 * @param relationships - Relationships store instance
 * @returns True if the node has no outgoing edges of this type
 */
export async function isLeaf(
  nodeId: string,
  verb: string,
  relationships: RelationshipsStore
): Promise<boolean> {
  const outgoing = await relationships.queryByFrom(nodeId, { verb })
  return outgoing.length === 0
}

/**
 * Check if a node is a root (has no parent).
 *
 * @param nodeId - The node to check
 * @param verb - The relationship verb defining the hierarchy
 * @param relationships - Relationships store instance
 * @returns True if the node has no incoming edges of this type
 */
export async function isRoot(
  nodeId: string,
  verb: string,
  relationships: RelationshipsStore
): Promise<boolean> {
  const incoming = await relationships.queryByTo(nodeId, { verb })
  return incoming.length === 0
}

/**
 * Get complete hierarchy information for a node.
 *
 * @param nodeId - The node to get hierarchy info for
 * @param verb - The relationship verb defining the hierarchy
 * @param relationships - Relationships store instance
 * @returns NodeHierarchyInfo with all hierarchy properties
 */
export async function getNodeHierarchy(
  nodeId: string,
  verb: string,
  relationships: RelationshipsStore
): Promise<NodeHierarchyInfo> {
  const [depth, outgoing, incoming] = await Promise.all([
    computeDepth(nodeId, verb, relationships),
    relationships.queryByFrom(nodeId, { verb }),
    relationships.queryByTo(nodeId, { verb }),
  ])

  return {
    nodeId,
    depth: depth === -1 ? 0 : depth, // Default to 0 if not in hierarchy
    is_leaf: outgoing.length === 0,
    is_root: incoming.length === 0,
    childCount: outgoing.length,
    parentCount: incoming.length,
  }
}

// ============================================================================
// LeanGraphColumns Class
// ============================================================================

/**
 * LeanGraphColumns provides computed hierarchy columns for graph data.
 *
 * This class wraps a RelationshipsStore and provides efficient methods
 * for querying hierarchical relationships.
 *
 * @example
 * ```typescript
 * const leanColumns = new LeanGraphColumns(relationshipsStore)
 *
 * // Get hierarchy info for a node
 * const info = await leanColumns.getHierarchy('https://org.do/manager', 'manages')
 * console.log(info.depth)    // 1
 * console.log(info.is_leaf)  // false
 * console.log(info.is_root)  // false
 *
 * // Get all leaf nodes
 * const leaves = await leanColumns.getLeaves('manages')
 *
 * // Get all root nodes
 * const roots = await leanColumns.getRoots('manages')
 * ```
 */
export class LeanGraphColumns {
  private relationships: RelationshipsStore

  constructor(relationships: RelationshipsStore) {
    this.relationships = relationships
  }

  /**
   * Get complete hierarchy information for a node.
   *
   * @param nodeId - The node to get hierarchy info for
   * @param verb - The relationship verb defining the hierarchy
   * @returns NodeHierarchyInfo with all hierarchy properties
   */
  async getHierarchy(nodeId: string, verb: string): Promise<NodeHierarchyInfo> {
    return getNodeHierarchy(nodeId, verb, this.relationships)
  }

  /**
   * Get all leaf nodes (nodes with no children) for a hierarchy.
   *
   * @param verb - The relationship verb defining the hierarchy
   * @returns Array of node IDs that are leaves
   */
  async getLeaves(verb: string): Promise<string[]> {
    const allRelationships = await this.relationships.queryByVerb(verb)

    // Collect all nodes that are targets (potential leaves)
    const targets = new Set<string>()
    const sources = new Set<string>()

    for (const rel of allRelationships) {
      sources.add(rel.from)
      targets.add(rel.to)
    }

    // Leaves are targets that are not sources
    const leaves: string[] = []
    for (const target of targets) {
      if (!sources.has(target)) {
        leaves.push(target)
      }
    }

    return leaves
  }

  /**
   * Get all root nodes (nodes with no parent) for a hierarchy.
   *
   * @param verb - The relationship verb defining the hierarchy
   * @returns Array of node IDs that are roots
   */
  async getRoots(verb: string): Promise<string[]> {
    const allRelationships = await this.relationships.queryByVerb(verb)

    // Collect all nodes that are sources (potential roots)
    const targets = new Set<string>()
    const sources = new Set<string>()

    for (const rel of allRelationships) {
      sources.add(rel.from)
      targets.add(rel.to)
    }

    // Roots are sources that are not targets
    const roots: string[] = []
    for (const source of sources) {
      if (!targets.has(source)) {
        roots.push(source)
      }
    }

    return roots
  }

  /**
   * Get all nodes at a specific depth in the hierarchy.
   *
   * @param verb - The relationship verb defining the hierarchy
   * @param depth - The depth level to query (0 = roots, 1 = first level children, etc.)
   * @returns Array of node IDs at the specified depth
   */
  async getNodesAtDepth(verb: string, depth: number): Promise<string[]> {
    const allRelationships = await this.relationships.queryByVerb(verb)

    if (allRelationships.length === 0) {
      return []
    }

    // Build parent map: child -> parent
    const parentMap = new Map<string, string>()
    const sources = new Set<string>()
    const targets = new Set<string>()

    for (const rel of allRelationships) {
      parentMap.set(rel.to, rel.from)
      sources.add(rel.from)
      targets.add(rel.to)
    }

    // Find all unique nodes
    const allNodes = new Set([...sources, ...targets])

    // Compute depth for each node and filter
    const nodesAtDepth: string[] = []

    for (const nodeId of allNodes) {
      // Compute depth by tracing to root
      let nodeDepth = 0
      let current = nodeId
      const visited = new Set<string>()

      while (parentMap.has(current)) {
        if (visited.has(current)) break
        visited.add(current)
        current = parentMap.get(current)!
        nodeDepth++
      }

      if (nodeDepth === depth) {
        nodesAtDepth.push(nodeId)
      }
    }

    return nodesAtDepth
  }

  /**
   * Get the maximum depth of the hierarchy.
   *
   * @param verb - The relationship verb defining the hierarchy
   * @returns Maximum depth (0 if only roots, -1 if no hierarchy)
   */
  async getMaxDepth(verb: string): Promise<number> {
    const allRelationships = await this.relationships.queryByVerb(verb)

    if (allRelationships.length === 0) {
      return -1
    }

    // Build parent map: child -> parent
    const parentMap = new Map<string, string>()
    const sources = new Set<string>()
    const targets = new Set<string>()

    for (const rel of allRelationships) {
      parentMap.set(rel.to, rel.from)
      sources.add(rel.from)
      targets.add(rel.to)
    }

    // Find all unique nodes
    const allNodes = new Set([...sources, ...targets])

    // Compute max depth
    let maxDepth = 0

    for (const nodeId of allNodes) {
      // Compute depth by tracing to root
      let nodeDepth = 0
      let current = nodeId
      const visited = new Set<string>()

      while (parentMap.has(current)) {
        if (visited.has(current)) break
        visited.add(current)
        current = parentMap.get(current)!
        nodeDepth++
      }

      if (nodeDepth > maxDepth) {
        maxDepth = nodeDepth
      }
    }

    return maxDepth
  }

  /**
   * Get hierarchy info for multiple nodes in batch.
   * More efficient than calling getHierarchy multiple times.
   *
   * @param nodeIds - The nodes to get hierarchy info for
   * @param verb - The relationship verb defining the hierarchy
   * @returns Map of node ID to NodeHierarchyInfo
   */
  async getHierarchyBatch(
    nodeIds: string[],
    verb: string
  ): Promise<Map<string, NodeHierarchyInfo>> {
    const allRelationships = await this.relationships.queryByVerb(verb)

    // Build lookup structures
    const parentMap = new Map<string, string>()
    const childrenMap = new Map<string, string[]>()
    const parentsMap = new Map<string, string[]>()

    for (const rel of allRelationships) {
      parentMap.set(rel.to, rel.from)

      // Track children
      const children = childrenMap.get(rel.from) || []
      children.push(rel.to)
      childrenMap.set(rel.from, children)

      // Track parents
      const parents = parentsMap.get(rel.to) || []
      parents.push(rel.from)
      parentsMap.set(rel.to, parents)
    }

    // Compute hierarchy info for each node
    const result = new Map<string, NodeHierarchyInfo>()

    for (const nodeId of nodeIds) {
      // Compute depth
      let depth = 0
      let current = nodeId
      const visited = new Set<string>()

      while (parentMap.has(current)) {
        if (visited.has(current)) break
        visited.add(current)
        current = parentMap.get(current)!
        depth++
      }

      const children = childrenMap.get(nodeId) || []
      const parents = parentsMap.get(nodeId) || []

      result.set(nodeId, {
        nodeId,
        depth,
        is_leaf: children.length === 0,
        is_root: parents.length === 0,
        childCount: children.length,
        parentCount: parents.length,
      })
    }

    return result
  }

  /**
   * Get the path from a node to its root.
   *
   * @param nodeId - The node to trace from
   * @param verb - The relationship verb defining the hierarchy
   * @returns Array of node IDs from nodeId to root (inclusive)
   */
  async getPathToRoot(nodeId: string, verb: string): Promise<string[]> {
    const allRelationships = await this.relationships.queryByVerb(verb)

    // Build parent map: child -> parent
    const parentMap = new Map<string, string>()
    for (const rel of allRelationships) {
      parentMap.set(rel.to, rel.from)
    }

    // Trace path to root
    const path: string[] = [nodeId]
    let current = nodeId
    const visited = new Set<string>()

    while (parentMap.has(current)) {
      if (visited.has(current)) break
      visited.add(current)
      current = parentMap.get(current)!
      path.push(current)
    }

    return path
  }

  /**
   * Get all descendants of a node.
   *
   * @param nodeId - The node to get descendants for
   * @param verb - The relationship verb defining the hierarchy
   * @param maxDepth - Maximum depth to traverse (optional)
   * @returns Array of descendant node IDs
   */
  async getDescendants(
    nodeId: string,
    verb: string,
    maxDepth?: number
  ): Promise<string[]> {
    const allRelationships = await this.relationships.queryByVerb(verb)

    // Build children map: parent -> children
    const childrenMap = new Map<string, string[]>()
    for (const rel of allRelationships) {
      const children = childrenMap.get(rel.from) || []
      children.push(rel.to)
      childrenMap.set(rel.from, children)
    }

    // BFS to collect descendants
    const descendants: string[] = []
    const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }]
    const visited = new Set<string>([nodeId])

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!

      // Check depth limit
      if (maxDepth !== undefined && depth >= maxDepth) {
        continue
      }

      const children = childrenMap.get(id) || []
      for (const child of children) {
        if (!visited.has(child)) {
          visited.add(child)
          descendants.push(child)
          queue.push({ id: child, depth: depth + 1 })
        }
      }
    }

    return descendants
  }

  /**
   * Get all ancestors of a node.
   *
   * @param nodeId - The node to get ancestors for
   * @param verb - The relationship verb defining the hierarchy
   * @returns Array of ancestor node IDs (from immediate parent to root)
   */
  async getAncestors(nodeId: string, verb: string): Promise<string[]> {
    const path = await this.getPathToRoot(nodeId, verb)
    // Remove the node itself from the path
    return path.slice(1)
  }
}
