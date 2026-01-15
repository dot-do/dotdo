/**
 * ShardRouter - Consistent Hash Ring Router
 *
 * Implements consistent hashing for distributing keys across shards.
 * Uses virtual nodes to ensure even distribution and minimizes key
 * movement when shards are added or removed.
 *
 * Key features:
 * - Consistent hash ring with configurable virtual nodes
 * - O(log n) lookup time via binary search
 * - <5% key movement on shard add/remove (for many shards)
 * - Even distribution across shards
 *
 * Usage:
 * ```typescript
 * const router = new ShardRouter(['shard-1', 'shard-2', 'shard-3'])
 * const shardId = router.getShardId('customer-123')  // Returns consistent shard
 *
 * // Dynamic scaling
 * router.addShard('shard-4')
 * router.removeShard('shard-1')
 * ```
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration options for ShardRouter
 */
export interface ShardRouterOptions {
  /**
   * Number of virtual nodes per shard.
   * More virtual nodes = more even distribution but more memory.
   * Default: 100
   */
  virtualNodes?: number
}

// =============================================================================
// ShardRouter Implementation
// =============================================================================

/**
 * Consistent hash ring router for distributing keys across shards.
 *
 * Uses FNV-1a hashing and virtual nodes to ensure even distribution.
 * Supports dynamic shard addition and removal with minimal key movement.
 */
export class ShardRouter {
  /** Hash ring mapping hash values to shard IDs */
  private ring: Map<number, string> = new Map()

  /** Sorted array of hashes for binary search */
  private sortedHashes: number[] = []

  /** Number of virtual nodes per shard */
  private virtualNodes: number

  /** Set of active shard IDs */
  private shardIds: Set<string> = new Set()

  /**
   * Create a new ShardRouter with the given shard IDs.
   *
   * @param shardIds - Array of shard identifiers to distribute keys across
   * @param options - Configuration options
   * @throws Error if shardIds is empty
   */
  constructor(shardIds: string[], options?: ShardRouterOptions) {
    if (shardIds.length === 0) {
      throw new Error('ShardRouter requires at least one shard')
    }

    this.virtualNodes = options?.virtualNodes ?? 150

    for (const shardId of shardIds) {
      this.addShard(shardId)
    }
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Get the shard ID for a given key using consistent hashing.
   *
   * The key will consistently map to the same shard as long as the
   * shard configuration doesn't change. O(log n) lookup time.
   *
   * @param key - The routing key (e.g., tenant ID, customer ID)
   * @returns The shard ID responsible for this key
   * @throws Error if no shards are configured
   */
  getShardId(key: string): string {
    if (this.sortedHashes.length === 0) {
      throw new Error('No shards available')
    }

    const hash = this.hash(key)
    const index = this.findNextHash(hash)
    return this.ring.get(this.sortedHashes[index])!
  }

  /**
   * Add a new shard to the router.
   *
   * This will redistribute some keys to the new shard.
   * Only keys that hash near the new virtual nodes will move.
   *
   * @param shardId - The shard identifier to add
   */
  addShard(shardId: string): void {
    if (this.shardIds.has(shardId)) {
      return
    }

    this.shardIds.add(shardId)

    // Add virtual nodes to the ring
    for (let i = 0; i < this.virtualNodes; i++) {
      const virtualKey = `${shardId}:${i}`
      const hash = this.hash(virtualKey)
      this.ring.set(hash, shardId)
    }

    this.rebuildSortedHashes()
  }

  /**
   * Remove a shard from the router.
   *
   * Keys previously assigned to this shard will be redistributed
   * to the next shard on the ring.
   *
   * @param shardId - The shard identifier to remove
   */
  removeShard(shardId: string): void {
    if (!this.shardIds.has(shardId)) {
      return
    }

    this.shardIds.delete(shardId)

    // Remove virtual nodes from the ring
    for (let i = 0; i < this.virtualNodes; i++) {
      const virtualKey = `${shardId}:${i}`
      const hash = this.hash(virtualKey)
      this.ring.delete(hash)
    }

    this.rebuildSortedHashes()
  }

  /**
   * Get all configured shard IDs.
   *
   * @returns Array of shard identifiers
   */
  getShardIds(): string[] {
    return Array.from(this.shardIds)
  }

  /**
   * Get the number of configured shards.
   *
   * @returns Number of shards
   */
  getShardCount(): number {
    return this.shardIds.size
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * FNV-1a hash function.
   *
   * Produces a 32-bit hash value with good distribution properties.
   * FNV-1a is fast, simple, and has good avalanche behavior.
   *
   * @param key - String to hash
   * @returns 32-bit unsigned hash value
   */
  private hash(key: string): number {
    // FNV-1a parameters for 32-bit hash
    const FNV_OFFSET_BASIS = 2166136261
    const FNV_PRIME = 16777619

    let hash = FNV_OFFSET_BASIS

    for (let i = 0; i < key.length; i++) {
      // XOR with byte then multiply (FNV-1a order)
      hash ^= key.charCodeAt(i)
      hash = Math.imul(hash, FNV_PRIME)
    }

    // Convert to unsigned 32-bit integer
    return hash >>> 0
  }

  /**
   * Rebuild the sorted hash array after ring changes.
   */
  private rebuildSortedHashes(): void {
    this.sortedHashes = Array.from(this.ring.keys()).sort((a, b) => a - b)
  }

  /**
   * Binary search to find the first hash >= target.
   *
   * If no hash >= target exists, wraps around to index 0.
   * This implements the "next node clockwise" behavior of consistent hashing.
   *
   * @param targetHash - The hash value to find
   * @returns Index into sortedHashes array
   */
  private findNextHash(targetHash: number): number {
    const hashes = this.sortedHashes
    let low = 0
    let high = hashes.length

    while (low < high) {
      const mid = (low + high) >>> 1
      if (hashes[mid] < targetHash) {
        low = mid + 1
      } else {
        high = mid
      }
    }

    // Wrap around if we've gone past the end
    return low === hashes.length ? 0 : low
  }
}
