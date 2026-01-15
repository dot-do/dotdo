/**
 * Sharding - Consistent Hash Ring
 *
 * Implements consistent hashing for distributing data across shards.
 * Uses virtual nodes for even distribution and minimal key movement on rebalancing.
 *
 * Key Features:
 * - FNV-1a 32-bit hash function for good distribution
 * - Virtual nodes (default 150) for minimal data movement
 * - Binary search for O(log N) node lookup
 * - Supports dynamic node addition/removal
 *
 * @module workers/sharding
 */

import type { ConsistentHashRing, ShardConfig } from './types'

// ============================================================================
// Hash Function Constants
// ============================================================================

/** FNV-1a 32-bit offset basis */
const FNV_OFFSET_BASIS = 2166136261

/** FNV-1a 32-bit prime */
const FNV_PRIME = 16777619

// ============================================================================
// Hash Functions
// ============================================================================

/**
 * FNV-1a hash function for consistent hashing
 *
 * FNV-1a produces better distribution than djb2 for similar strings
 * and is widely used in consistent hashing implementations.
 *
 * @param str - String to hash
 * @returns Unsigned 32-bit hash value
 *
 * @internal
 */
function hashString(str: string): number {
  // FNV-1a 32-bit algorithm
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    // Multiply by FNV prime and convert to unsigned 32-bit
    hash = (hash * FNV_PRIME) >>> 0
  }
  return hash >>> 0 // Ensure unsigned 32-bit
}

/**
 * Create a hash key from namespace, type, and id
 *
 * Combines multiple identifiers into a single composite key for hashing.
 * Used with createHashRing to determine shard assignment.
 *
 * @param ns - Namespace (tenant identifier)
 * @param type - Resource type (e.g., 'customers', 'orders')
 * @param id - Resource ID
 * @returns Composite hash key formatted as 'ns:type:id'
 *
 * @example
 * ```
 * const key = hashKey('tenant-1', 'customers', '123')
 * // Returns: 'tenant-1:customers:123'
 *
 * const ring = createHashRing({ shardCount: 4 })
 * ring.addNode('shard-0')
 * ring.addNode('shard-1')
 * const shard = ring.getNode(key) // Maps key to one of the shards
 * ```
 */
export function hashKey(ns: string, type: string, id: string): string {
  return `${ns}:${type}:${id}`
}

/**
 * Create a consistent hash ring
 *
 * Implements consistent hashing with virtual nodes for distributed key-value storage.
 *
 * Algorithm:
 * 1. Each physical node has multiple virtual nodes (improves distribution)
 * 2. All positions hash into a circular 32-bit space
 * 3. Keys hash to positions and find the nearest node clockwise
 * 4. Binary search enables O(log N) lookup time
 *
 * Virtual nodes minimize key remapping when nodes join/leave:
 * - Without virtual nodes: ~100% of keys remapped on node change
 * - With 150 virtual nodes: ~1/N of keys remapped (N = shard count)
 *
 * @param config - Shard configuration with shardCount and optional virtualNodes
 * @returns ConsistentHashRing instance with node management and key routing
 *
 * @example
 * ```
 * const ring = createHashRing({ shardCount: 4, virtualNodes: 150 })
 * ring.addNode('shard-0')
 * ring.addNode('shard-1')
 * ring.addNode('shard-2')
 * ring.addNode('shard-3')
 *
 * const shard = ring.getNode('customer:123') // Routes to one of the shards
 * ```
 */
export function createHashRing(config: ShardConfig): ConsistentHashRing {
  const virtualNodes = config.virtualNodes ?? 150
  const nodes: string[] = []

  // Map of hash position -> node name
  const ring: Map<number, string> = new Map()
  // Sorted list of hash positions for binary search
  let sortedPositions: number[] = []

  /**
   * Rebuild sorted positions for binary search
   * Called after ring modifications
   */
  function updateSortedPositions(): void {
    sortedPositions = Array.from(ring.keys()).sort((a, b) => a - b)
  }

  /**
   * Add a node to the ring with virtual nodes
   *
   * @param node - Node name to add
   */
  function addNode(node: string): void {
    if (nodes.includes(node)) {
      return // Already exists, skip
    }

    nodes.push(node)

    // Create virtual nodes for even distribution
    for (let i = 0; i < virtualNodes; i++) {
      const virtualKey = `${node}:${i}`
      const position = hashString(virtualKey)
      ring.set(position, node)
    }

    updateSortedPositions()
  }

  /**
   * Remove a node from the ring
   *
   * @param node - Node name to remove
   */
  function removeNode(node: string): void {
    const index = nodes.indexOf(node)
    if (index === -1) {
      return // Node doesn't exist
    }

    nodes.splice(index, 1)

    // Remove all virtual nodes for this physical node
    for (let i = 0; i < virtualNodes; i++) {
      const virtualKey = `${node}:${i}`
      const position = hashString(virtualKey)
      ring.delete(position)
    }

    updateSortedPositions()
  }

  /**
   * Get the node responsible for a key
   *
   * Uses binary search to find the node clockwise from key's hash position.
   * If key hashes past all nodes, wraps around to first node.
   *
   * @param key - Key to route
   * @returns Node name responsible for the key
   * @throws Error if ring is empty
   */
  function getNode(key: string): string {
    if (nodes.length === 0) {
      throw new Error('Cannot route key: consistent hash ring is empty. Add nodes first.')
    }

    const keyHash = hashString(key)

    // Binary search for first position >= keyHash (clockwise direction)
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

    // Wrap around to first position if past the end of ring
    const position = sortedPositions[low] ?? sortedPositions[0]
    return ring.get(position)!
  }

  /**
   * Get all nodes in the ring
   *
   * @returns Copy of node list
   */
  function getNodes(): string[] {
    return [...nodes]
  }

  /**
   * Get the configured virtual node count
   *
   * @returns Virtual nodes per physical node
   */
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
