/**
 * Graph Algorithms
 *
 * Cycle detection and shortest path algorithms for the GraphStore.
 *
 * @module db/graph/algorithms
 */

import type { Relationship } from './graph-store-types'

/**
 * Get outgoing edges for a node filtered by type.
 */
type GetOutgoing = (nodeId: string, type: string) => Relationship[]

/**
 * Get outgoing edges for a node filtered by multiple types.
 */
type GetOutgoingMulti = (nodeId: string, types: string[]) => Relationship[]

/**
 * Detect if there is a cycle starting from the given node using DFS.
 *
 * @param start - Starting node ID
 * @param type - Relationship type to follow
 * @param getOutgoing - Function to get outgoing edges
 * @returns true if a cycle is detected, false otherwise
 */
export function detectCycle(start: string, type: string, getOutgoing: GetOutgoing): boolean {
  // Use DFS with recursion stack to detect back edges
  const visited = new Set<string>()
  const recStack = new Set<string>()

  function dfs(nodeId: string): boolean {
    visited.add(nodeId)
    recStack.add(nodeId)

    const edges = getOutgoing(nodeId, type)
    for (const edge of edges) {
      const nextId = edge.to
      // If next node is in recursion stack, we found a cycle
      if (recStack.has(nextId)) {
        return true
      }
      // If not visited, recurse
      if (!visited.has(nextId)) {
        if (dfs(nextId)) {
          return true
        }
      }
    }

    recStack.delete(nodeId)
    return false
  }

  return dfs(start)
}

/**
 * Find any path between two nodes using BFS.
 *
 * @param from - Starting node ID
 * @param to - Target node ID
 * @param types - Relationship types to follow
 * @param getOutgoing - Function to get outgoing edges
 * @returns Array of node IDs representing the path, or null if no path exists
 */
export function findPath(
  from: string,
  to: string,
  types: string[],
  getOutgoing: GetOutgoingMulti,
): string[] | null {
  if (from === to) {
    return [from]
  }

  const visited = new Set<string>([from])
  const parent = new Map<string, string>()
  const queue: string[] = [from]

  while (queue.length > 0) {
    const current = queue.shift()!
    const edges = getOutgoing(current, types)

    for (const edge of edges) {
      const nextId = edge.to
      if (!visited.has(nextId)) {
        visited.add(nextId)
        parent.set(nextId, current)

        if (nextId === to) {
          // Reconstruct path
          const path: string[] = [to]
          let node = to
          while (parent.has(node)) {
            node = parent.get(node)!
            path.unshift(node)
          }
          return path
        }

        queue.push(nextId)
      }
    }
  }

  return null
}

/**
 * Find the shortest path between two nodes using BFS.
 *
 * @param from - Starting node ID
 * @param to - Target node ID
 * @param types - Relationship types to follow
 * @param maxDepth - Maximum depth to search (default: Infinity)
 * @param getOutgoing - Function to get outgoing edges
 * @returns Array of node IDs representing the shortest path, or null if no path exists
 */
export function shortestPath(
  from: string,
  to: string,
  types: string[],
  maxDepth: number = Infinity,
  getOutgoing: GetOutgoingMulti,
): string[] | null {
  if (from === to) {
    return [from]
  }

  const visited = new Set<string>([from])
  const parent = new Map<string, string>()
  const depth = new Map<string, number>([[from, 0]])
  const queue: string[] = [from]

  while (queue.length > 0) {
    const current = queue.shift()!
    const currentDepth = depth.get(current)!

    // Stop if we've reached max depth
    if (currentDepth >= maxDepth) {
      continue
    }

    const edges = getOutgoing(current, types)

    for (const edge of edges) {
      const nextId = edge.to
      if (!visited.has(nextId)) {
        visited.add(nextId)
        parent.set(nextId, current)
        depth.set(nextId, currentDepth + 1)

        if (nextId === to) {
          // Reconstruct path
          const path: string[] = [to]
          let node = to
          while (parent.has(node)) {
            node = parent.get(node)!
            path.unshift(node)
          }
          return path
        }

        queue.push(nextId)
      }
    }
  }

  return null
}
