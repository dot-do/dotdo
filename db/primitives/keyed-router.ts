/**
 * KeyedRouter - Partition-aware routing for distributed processing
 *
 * Provides consistent hash-based key-to-partition routing with:
 * - Deterministic routing: same key always maps to same partition
 * - Even distribution: keys are approximately uniformly distributed
 * - Batch operations: efficient routing of multiple keys
 * - Shuffle operations: grouping data by key for distributed processing
 *
 * Uses MurmurHash3-inspired algorithm for good distribution properties.
 */

import { murmurHash3 } from './utils/murmur3'

/**
 * Configuration options for KeyedRouter
 */
export interface KeyedRouterOptions {
  /** Number of partitions to route keys across */
  partitionCount: number
  /** Optional seed for hash function (affects routing but maintains consistency) */
  seed?: number
}

/**
 * Partition-aware router interface
 */
export interface KeyedRouter<K> {
  /** Route a key to its partition number */
  route(key: K): number
  /** Alias for route() - returns partition number for a key */
  getPartition(key: K): number
  /** Group keys by their partition */
  routeBatch(keys: K[]): Map<number, K[]>
  /** Shuffle data items by key, grouping them by partition */
  shuffle<T>(data: T[], keyFn: (t: T) => K): Map<number, T[]>
  /** Get the total number of partitions */
  getPartitionCount(): number
  /** Get distribution statistics: partition -> count of keys */
  getDistribution(keys: K[]): Map<number, number>
}

/**
 * Convert any key to a string representation for hashing
 */
function keyToString<K>(key: K): string {
  if (typeof key === 'string') {
    return key
  }
  if (typeof key === 'number') {
    return String(key)
  }
  // Use toString() for objects (including custom classes)
  return String(key)
}

/**
 * Internal KeyedRouter implementation
 */
class KeyedRouterImpl<K> implements KeyedRouter<K> {
  private readonly partitionCount: number
  private readonly seed: number

  constructor(options: KeyedRouterOptions) {
    if (options.partitionCount <= 0) {
      throw new Error('partitionCount must be a positive integer')
    }
    if (!Number.isInteger(options.partitionCount)) {
      throw new Error('partitionCount must be a positive integer')
    }

    this.partitionCount = options.partitionCount
    this.seed = options.seed ?? 0
  }

  /**
   * Route a key to its partition number
   * Uses consistent hashing to ensure same key always maps to same partition
   */
  route(key: K): number {
    const str = keyToString(key)
    const hash = murmurHash3(str, this.seed)
    return hash % this.partitionCount
  }

  /**
   * Alias for route() - returns partition number for a key
   */
  getPartition(key: K): number {
    return this.route(key)
  }

  /**
   * Group keys by their partition
   * Returns a Map where keys are partition numbers and values are arrays of keys
   */
  routeBatch(keys: K[]): Map<number, K[]> {
    const result = new Map<number, K[]>()

    for (const key of keys) {
      const partition = this.route(key)
      const existing = result.get(partition)
      if (existing) {
        existing.push(key)
      } else {
        result.set(partition, [key])
      }
    }

    return result
  }

  /**
   * Shuffle data items by key, grouping them by partition
   * Useful for distributed processing where items with same key must be co-located
   */
  shuffle<T>(data: T[], keyFn: (t: T) => K): Map<number, T[]> {
    const result = new Map<number, T[]>()

    for (const item of data) {
      const key = keyFn(item)
      const partition = this.route(key)
      const existing = result.get(partition)
      if (existing) {
        existing.push(item)
      } else {
        result.set(partition, [item])
      }
    }

    return result
  }

  /**
   * Get the total number of partitions
   */
  getPartitionCount(): number {
    return this.partitionCount
  }

  /**
   * Get distribution statistics showing how many keys map to each partition
   * Returns a Map of partition number to count
   */
  getDistribution(keys: K[]): Map<number, number> {
    const result = new Map<number, number>()

    for (const key of keys) {
      const partition = this.route(key)
      result.set(partition, (result.get(partition) ?? 0) + 1)
    }

    return result
  }
}

/**
 * Create a new KeyedRouter instance
 *
 * @param partitionCountOrOptions - Either the number of partitions or an options object
 * @returns A new KeyedRouter instance
 *
 * @example
 * ```typescript
 * // Create with partition count
 * const router = createKeyedRouter<string>(16)
 *
 * // Create with options
 * const router = createKeyedRouter<string>({ partitionCount: 16, seed: 42 })
 *
 * // Route a key
 * const partition = router.route('my-key')
 *
 * // Batch route multiple keys
 * const batched = router.routeBatch(['key1', 'key2', 'key3'])
 *
 * // Shuffle data by key
 * const shuffled = router.shuffle(items, item => item.id)
 * ```
 */
export function createKeyedRouter<K>(partitionCountOrOptions: number | KeyedRouterOptions): KeyedRouter<K> {
  if (typeof partitionCountOrOptions === 'number') {
    return new KeyedRouterImpl<K>({ partitionCount: partitionCountOrOptions })
  }
  return new KeyedRouterImpl<K>(partitionCountOrOptions)
}

// Re-export the class for type inference if needed
export { KeyedRouterImpl }
