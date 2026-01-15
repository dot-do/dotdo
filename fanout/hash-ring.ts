/**
 * Consistent Hash Ring
 *
 * Maps keys to nodes with minimal redistribution when nodes are added/removed.
 * Uses virtual nodes for even distribution.
 */

interface HashRingOptions {
  virtualNodesPerNode?: number
}

interface VirtualNode {
  hash: number
  nodeId: string
}

/**
 * MurmurHash3-inspired hash function for better distribution
 */
function hash32(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // Final mixing
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

export class ConsistentHashRing {
  private nodes: Map<string, number> = new Map() // nodeId -> weight
  private virtualNodes: VirtualNode[] = []
  private virtualNodesPerNode: number

  constructor(initialNodes: string[] = [], options: HashRingOptions = {}) {
    this.virtualNodesPerNode = options.virtualNodesPerNode ?? 150

    for (const nodeId of initialNodes) {
      this.addNode(nodeId)
    }
  }

  /**
   * Hash a key to a number
   */
  hash(key: string): number {
    return hash32(key)
  }

  /**
   * Get the node responsible for a key
   */
  getNode(key: string): string {
    if (this.virtualNodes.length === 0) {
      throw new Error('No nodes in ring')
    }

    const keyHash = this.hash(key)

    // Binary search for the first virtual node with hash >= keyHash
    let left = 0
    let right = this.virtualNodes.length

    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (this.virtualNodes[mid].hash < keyHash) {
        left = mid + 1
      } else {
        right = mid
      }
    }

    // If we're past the end, wrap to first node
    const index = left >= this.virtualNodes.length ? 0 : left
    return this.virtualNodes[index].nodeId
  }

  /**
   * Add a node to the ring
   * @param weight Multiplier for virtual nodes (default 1)
   */
  addNode(nodeId: string, weight: number = 1): void {
    if (this.nodes.has(nodeId)) return

    this.nodes.set(nodeId, weight)
    this.rebuildRing()
  }

  /**
   * Remove a node from the ring
   */
  removeNode(nodeId: string): void {
    if (!this.nodes.has(nodeId)) {
      throw new Error(`Node ${nodeId} not found in ring`)
    }

    if (this.nodes.size === 1) {
      throw new Error('Cannot remove the last node from the ring')
    }

    this.nodes.delete(nodeId)
    this.rebuildRing()
  }

  /**
   * Get all physical node IDs
   */
  getNodes(): string[] {
    return Array.from(this.nodes.keys())
  }

  /**
   * Get count of virtual nodes
   */
  getVirtualNodeCount(): number {
    return this.virtualNodes.length
  }

  /**
   * Rebalance and return map of moved keys
   * Note: This is a tracking method - actual key tracking must be done externally
   */
  rebalance(): Map<string, string[]> {
    // The ring rebuilds automatically on add/remove
    // This method returns an empty map since we don't track keys internally
    // In practice, the caller would track their own keys and call getNode
    // to see which ones moved
    return new Map()
  }

  private rebuildRing(): void {
    this.virtualNodes = []

    for (const [nodeId, weight] of this.nodes) {
      const numVirtualNodes = this.virtualNodesPerNode * weight

      for (let i = 0; i < numVirtualNodes; i++) {
        const virtualNodeKey = `${nodeId}:vn${i}`
        const hash = this.hash(virtualNodeKey)
        this.virtualNodes.push({ hash, nodeId })
      }
    }

    // Sort by hash for binary search
    this.virtualNodes.sort((a, b) => a.hash - b.hash)
  }
}
