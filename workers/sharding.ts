/**
 * Sharding - Consistent Hash Ring
 *
 * Implements consistent hashing for distributing data across shards.
 * Uses virtual nodes for even distribution and minimal key movement.
 *
 * @module workers/sharding
 */

import type { ConsistentHashRing, ShardConfig } from './types'

/**
 * FNV-1a hash function for consistent hashing
 * Produces better distribution than djb2 for similar strings
 */
function hashString(str: string): number {
  // FNV-1a 32-bit
  let hash = 2166136261 // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    // FNV prime for 32-bit: multiply by 16777619
    // Use bit ops to simulate: hash * 16777619
    hash = (hash * 16777619) >>> 0
  }
  return hash >>> 0 // Convert to unsigned 32-bit
}

/**
 * Create a hash key from namespace, type, and id
 *
 * @param ns - Namespace (tenant)
 * @param type - Resource type
 * @param id - Resource ID
 * @returns Composite hash key
 */
export function hashKey(ns: string, type: string, id: string): string {
  return `${ns}:${type}:${id}`
}

/**
 * Create a consistent hash ring
 *
 * @param config - Shard configuration
 * @returns ConsistentHashRing instance
 */
export function createHashRing(config: ShardConfig): ConsistentHashRing {
  const virtualNodes = config.virtualNodes ?? 150
  const nodes: string[] = []

  // Map of hash position -> node name
  const ring: Map<number, string> = new Map()
  // Sorted list of hash positions for binary search
  let sortedPositions: number[] = []

  // Track virtual node count per real node
  const nodeVirtualCounts: Map<string, number> = new Map()

  function updateSortedPositions() {
    sortedPositions = Array.from(ring.keys()).sort((a, b) => a - b)
  }

  function addNode(node: string): void {
    if (nodes.includes(node)) {
      return // Already exists
    }

    nodes.push(node)

    // Add virtual nodes
    for (let i = 0; i < virtualNodes; i++) {
      const virtualKey = `${node}:${i}`
      const position = hashString(virtualKey)
      ring.set(position, node)
    }

    nodeVirtualCounts.set(node, virtualNodes)
    updateSortedPositions()
  }

  function removeNode(node: string): void {
    const index = nodes.indexOf(node)
    if (index === -1) {
      return // Node doesn't exist
    }

    nodes.splice(index, 1)

    // Remove virtual nodes
    for (let i = 0; i < virtualNodes; i++) {
      const virtualKey = `${node}:${i}`
      const position = hashString(virtualKey)
      ring.delete(position)
    }

    nodeVirtualCounts.delete(node)
    updateSortedPositions()
  }

  function getNode(key: string): string {
    if (nodes.length === 0) {
      throw new Error('No nodes in ring')
    }

    const keyHash = hashString(key)

    // Binary search for first position >= keyHash
    let low = 0
    let high = sortedPositions.length

    while (low < high) {
      const mid = (low + high) >>> 1
      if (sortedPositions[mid] < keyHash) {
        low = mid + 1
      } else {
        high = mid
      }
    }

    // Wrap around to first position if past the end
    const position = sortedPositions[low] ?? sortedPositions[0]
    return ring.get(position)!
  }

  function getNodes(): string[] {
    return [...nodes]
  }

  function getVirtualNodeCount(): number {
    return virtualNodes
  }

  return {
    addNode,
    removeNode,
    getNode,
    getNodes,
    getVirtualNodeCount,
  }
}
