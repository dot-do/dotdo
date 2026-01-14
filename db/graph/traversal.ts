/**
 * Graph Traversal Algorithms
 *
 * BFS and DFS traversal implementations for the GraphStore.
 *
 * @module db/graph/traversal
 */

import type { Relationship, TraverseOptions, TraverseResult, TraversalNode } from './graph-store-types'

/**
 * Get neighbors based on direction.
 */
type GetNeighbors = (nodeId: string, types: string[]) => Relationship[]

/**
 * Breadth-First Search traversal.
 *
 * @param start - Starting node ID
 * @param direction - Direction to traverse ('outgoing' or 'incoming')
 * @param types - Relationship types to follow
 * @param maxDepth - Maximum depth to traverse
 * @param getNeighbors - Function to get neighbors for a node
 * @returns Traversal result with nodes in BFS order
 */
export function bfs(
  start: string,
  direction: 'outgoing' | 'incoming',
  types: string[],
  maxDepth: number,
  getNeighbors: GetNeighbors,
): TraverseResult {
  const visited = new Set<string>([start])
  const result: TraversalNode[] = []
  const queue: Array<{ id: string; depth: number }> = [{ id: start, depth: 0 }]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.depth >= maxDepth) continue

    const edges = getNeighbors(current.id, types)
    for (const edge of edges) {
      const nextId = direction === 'outgoing' ? edge.to : edge.from
      if (!visited.has(nextId)) {
        visited.add(nextId)
        const node: TraversalNode = { id: nextId, depth: current.depth + 1 }
        result.push(node)
        queue.push({ id: nextId, depth: current.depth + 1 })
      }
    }
  }

  return { nodes: result }
}

/**
 * Depth-First Search traversal.
 *
 * @param start - Starting node ID
 * @param direction - Direction to traverse ('outgoing' or 'incoming')
 * @param types - Relationship types to follow
 * @param maxDepth - Maximum depth to traverse
 * @param getNeighbors - Function to get neighbors for a node
 * @returns Traversal result with nodes in DFS order
 */
export function dfs(
  start: string,
  direction: 'outgoing' | 'incoming',
  types: string[],
  maxDepth: number,
  getNeighbors: GetNeighbors,
): TraverseResult {
  const visited = new Set<string>([start])
  const result: TraversalNode[] = []

  function visit(nodeId: string, depth: number): void {
    if (depth >= maxDepth) return

    const edges = getNeighbors(nodeId, types)
    for (const edge of edges) {
      const nextId = direction === 'outgoing' ? edge.to : edge.from
      if (!visited.has(nextId)) {
        visited.add(nextId)
        result.push({ id: nextId, depth: depth + 1 })
        visit(nextId, depth + 1)
      }
    }
  }

  visit(start, 0)
  return { nodes: result }
}

/**
 * Traverse the graph using the specified algorithm.
 */
export function traverse(options: TraverseOptions, getNeighbors: GetNeighbors): TraverseResult {
  const { start, direction, types, maxDepth, algorithm = 'bfs' } = options

  if (algorithm === 'dfs') {
    return dfs(start, direction, types, maxDepth, getNeighbors)
  }
  return bfs(start, direction, types, maxDepth, getNeighbors)
}
