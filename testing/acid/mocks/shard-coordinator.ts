/**
 * Mock Shard Coordinator - Testing utilities for shard coordination
 *
 * Provides mock implementations for testing DO sharding operations:
 * - Shard registration and routing table management
 * - Deterministic key routing (hash, range, roundRobin)
 * - Scatter-gather query coordination
 * - Result aggregation and merging
 *
 * @see types/Lifecycle.ts for ShardStrategy, ShardResult
 * @see db/objects.ts for objects table shard schema
 */

import type { ShardStrategy, ShardResult, ShardOptions } from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Shard information stored in the coordinator
 */
export interface ShardInfo {
  /** Namespace URL of the shard DO */
  ns: string
  /** Durable Object ID */
  doId: string
  /** Shard index (0-based) */
  index: number
  /** Number of things in this shard */
  thingCount: number
  /** Health status */
  healthy: boolean
  /** Last health check timestamp */
  lastHealthCheck: Date
  /** Circuit breaker state */
  circuitState: 'closed' | 'open' | 'half-open'
  /** Consecutive failure count */
  failureCount: number
}

/**
 * Routing table entry
 */
export interface RoutingEntry {
  /** Shard index this key maps to */
  shardIndex: number
  /** Shard namespace */
  ns: string
}

/**
 * Scatter-gather query options
 */
export interface ScatterGatherOptions {
  /** Timeout for each shard query (ms) */
  timeout?: number
  /** Whether to fail on partial failures */
  failOnPartial?: boolean
  /** Maximum retries per shard */
  maxRetries?: number
  /** Callback for partial results */
  onPartialResult?: (shardIndex: number, result: unknown) => void
}

/**
 * Scatter-gather result
 */
export interface ScatterGatherResult<T> {
  /** Successful results by shard index */
  results: Map<number, T>
  /** Errors by shard index */
  errors: Map<number, Error>
  /** Whether all shards succeeded */
  allSucceeded: boolean
  /** Total duration (ms) */
  duration: number
}

/**
 * Range boundary for range-based routing
 */
export interface RangeBoundary {
  start: string
  end: string
  shardIndex: number
}

/**
 * Custom shard function type
 */
export type CustomShardFunction = (key: string, shardCount: number) => number

/**
 * Mock Shard Coordinator interface
 */
export interface MockShardCoordinator {
  /** The sharding key */
  shardKey: string
  /** Sharding strategy */
  strategy: ShardStrategy
  /** Number of shards */
  shardCount: number

  // Registration
  /** Register a new shard */
  registerShard(shard: Omit<ShardInfo, 'healthy' | 'lastHealthCheck' | 'circuitState' | 'failureCount'>): void
  /** Unregister a shard */
  unregisterShard(shardIndex: number): void
  /** Get all registered shards */
  getShards(): ShardInfo[]
  /** Get a specific shard by index */
  getShard(index: number): ShardInfo | undefined

  // Routing
  /** Get the full routing table */
  getRoutingTable(): Map<string, RoutingEntry>
  /** Route a key to a shard index */
  routeKey(key: string): number
  /** Route a key to a shard namespace */
  routeKeyToNs(key: string): string | undefined
  /** Update routing table */
  updateRoutingTable(entries: Map<string, RoutingEntry>): void

  // Scatter-Gather
  /** Scatter a query to all shards */
  scatter<T>(query: (shardIndex: number, shardNs: string) => Promise<T>, options?: ScatterGatherOptions): Promise<ScatterGatherResult<T>>
  /** Gather and merge results from shards */
  gather<T>(results: Map<number, T[]>, options?: { sort?: (a: T, b: T) => number; limit?: number; offset?: number }): T[]

  // Health
  /** Check health of all shards */
  healthCheck(): Promise<Map<number, boolean>>
  /** Mark a shard as unhealthy (circuit breaker) */
  markUnhealthy(shardIndex: number): void
  /** Mark a shard as healthy */
  markHealthy(shardIndex: number): void

  // Range-specific (for range strategy)
  /** Set range boundaries */
  setRangeBoundaries(boundaries: RangeBoundary[]): void
  /** Get range boundaries */
  getRangeBoundaries(): RangeBoundary[]

  // Custom strategy
  /** Set custom shard function */
  setCustomShardFunction(fn: CustomShardFunction): void
}

// ============================================================================
// HASH FUNCTIONS
// ============================================================================

/**
 * Simple hash function for deterministic routing
 * Uses djb2 algorithm for consistent hashing
 */
function djb2Hash(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
  }
  return Math.abs(hash)
}

/**
 * Consistent hash function that distributes keys evenly
 */
function consistentHash(key: string, shardCount: number): number {
  const hash = djb2Hash(key)
  return hash % shardCount
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a mock shard coordinator for testing
 *
 * @param shardCount - Number of shards to coordinate
 * @param strategy - Sharding strategy (default: 'hash')
 * @param shardKey - The key field used for sharding (default: 'id')
 *
 * @example
 * ```typescript
 * const coordinator = createMockShardCoordinator(4, 'hash', 'id')
 *
 * // Register shards
 * coordinator.registerShard({ ns: 'https://shard0.do', doId: 'shard-0', index: 0, thingCount: 250 })
 * coordinator.registerShard({ ns: 'https://shard1.do', doId: 'shard-1', index: 1, thingCount: 250 })
 *
 * // Route keys
 * const shardIndex = coordinator.routeKey('thing-0001')
 * expect(shardIndex).toBe(1)
 *
 * // Scatter-gather
 * const result = await coordinator.scatter(async (index, ns) => {
 *   return await fetchFromShard(ns, query)
 * })
 * ```
 */
export function createMockShardCoordinator(
  shardCount: number,
  strategy: ShardStrategy = 'hash',
  shardKey: string = 'id'
): MockShardCoordinator {
  // Internal state
  const shards = new Map<number, ShardInfo>()
  const routingTable = new Map<string, RoutingEntry>()
  let rangeBoundaries: RangeBoundary[] = []
  let customShardFunction: CustomShardFunction | undefined

  // Round-robin state
  let roundRobinIndex = 0

  /**
   * Route a key using hash strategy
   */
  function routeHash(key: string): number {
    return consistentHash(key, shardCount)
  }

  /**
   * Route a key using range strategy
   */
  function routeRange(key: string): number {
    for (const boundary of rangeBoundaries) {
      if (key >= boundary.start && key <= boundary.end) {
        return boundary.shardIndex
      }
    }
    // Default to last shard
    return shardCount - 1
  }

  /**
   * Route a key using round-robin strategy
   */
  function routeRoundRobin(_key: string): number {
    const index = roundRobinIndex
    roundRobinIndex = (roundRobinIndex + 1) % shardCount
    return index
  }

  /**
   * Route a key using custom strategy
   */
  function routeCustom(key: string): number {
    if (!customShardFunction) {
      throw new Error('Custom shard function not set')
    }
    return customShardFunction(key, shardCount)
  }

  return {
    shardKey,
    strategy,
    shardCount,

    // Registration
    registerShard(shard) {
      const shardInfo: ShardInfo = {
        ...shard,
        healthy: true,
        lastHealthCheck: new Date(),
        circuitState: 'closed',
        failureCount: 0,
      }
      shards.set(shard.index, shardInfo)

      // Update routing table
      routingTable.set(`shard-${shard.index}`, {
        shardIndex: shard.index,
        ns: shard.ns,
      })
    },

    unregisterShard(shardIndex) {
      shards.delete(shardIndex)
      routingTable.delete(`shard-${shardIndex}`)
    },

    getShards() {
      return Array.from(shards.values())
    },

    getShard(index) {
      return shards.get(index)
    },

    // Routing
    getRoutingTable() {
      return new Map(routingTable)
    },

    routeKey(key) {
      switch (strategy) {
        case 'hash':
          return routeHash(key)
        case 'range':
          return routeRange(key)
        case 'roundRobin':
          return routeRoundRobin(key)
        case 'custom':
          return routeCustom(key)
        default:
          throw new Error(`Unknown shard strategy: ${strategy}`)
      }
    },

    routeKeyToNs(key) {
      const index = this.routeKey(key)
      const shard = shards.get(index)
      return shard?.ns
    },

    updateRoutingTable(entries) {
      entries.forEach((entry, key) => {
        routingTable.set(key, entry)
      })
    },

    // Scatter-Gather
    async scatter<T>(
      query: (shardIndex: number, shardNs: string) => Promise<T>,
      options: ScatterGatherOptions = {}
    ): Promise<ScatterGatherResult<T>> {
      const startTime = Date.now()
      const results = new Map<number, T>()
      const errors = new Map<number, Error>()

      const timeout = options.timeout ?? 30000
      const maxRetries = options.maxRetries ?? 0

      // Create promise for each shard
      const promises = Array.from(shards.values())
        .filter((shard) => shard.healthy && shard.circuitState !== 'open')
        .map(async (shard) => {
          let lastError: Error | undefined
          let attempts = 0

          while (attempts <= maxRetries) {
            try {
              // Execute query with timeout
              const result = await Promise.race([
                query(shard.index, shard.ns),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('Shard query timeout')), timeout)
                ),
              ])

              results.set(shard.index, result)
              options.onPartialResult?.(shard.index, result)
              return
            } catch (error) {
              lastError = error instanceof Error ? error : new Error(String(error))
              attempts++
            }
          }

          // All retries exhausted
          if (lastError) {
            errors.set(shard.index, lastError)
          }
        })

      await Promise.all(promises)

      return {
        results,
        errors,
        allSucceeded: errors.size === 0 && results.size === shards.size,
        duration: Date.now() - startTime,
      }
    },

    gather<T>(
      resultsMap: Map<number, T[]>,
      options: { sort?: (a: T, b: T) => number; limit?: number; offset?: number } = {}
    ): T[] {
      // Flatten results from all shards
      let combined: T[] = []
      resultsMap.forEach((items) => {
        combined.push(...items)
      })

      // Sort if provided
      if (options.sort) {
        combined.sort(options.sort)
      }

      // Apply offset
      if (options.offset && options.offset > 0) {
        combined = combined.slice(options.offset)
      }

      // Apply limit
      if (options.limit && options.limit > 0) {
        combined = combined.slice(0, options.limit)
      }

      return combined
    },

    // Health
    async healthCheck(): Promise<Map<number, boolean>> {
      const results = new Map<number, boolean>()

      for (const shard of shards.values()) {
        // In mock, all shards are healthy unless marked otherwise
        results.set(shard.index, shard.healthy)
        shard.lastHealthCheck = new Date()
      }

      return results
    },

    markUnhealthy(shardIndex) {
      const shard = shards.get(shardIndex)
      if (shard) {
        shard.failureCount++
        shard.healthy = false
        shard.circuitState = 'open'
      }
    },

    markHealthy(shardIndex) {
      const shard = shards.get(shardIndex)
      if (shard) {
        shard.failureCount = 0
        shard.healthy = true
        shard.circuitState = 'closed'
      }
    },

    // Range-specific
    setRangeBoundaries(boundaries) {
      rangeBoundaries = boundaries
    },

    getRangeBoundaries() {
      return [...rangeBoundaries]
    },

    // Custom strategy
    setCustomShardFunction(fn) {
      customShardFunction = fn
    },
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a mock ShardResult from shard info
 */
export function createMockShardResult(
  shardKey: string,
  shards: ShardInfo[]
): ShardResult {
  return {
    shardKey,
    shards: shards.map((s) => ({
      ns: s.ns,
      doId: s.doId,
      shardIndex: s.index,
      thingCount: s.thingCount,
    })),
  }
}

/**
 * Validate shard options
 */
export function validateShardOptions(options: ShardOptions): string[] {
  const errors: string[] = []

  if (!options.key) {
    errors.push('Shard key is required')
  }

  if (options.count < 2) {
    errors.push('Shard count must be at least 2')
  }

  if (options.count > 100) {
    errors.push('Shard count cannot exceed 100')
  }

  if (options.strategy && !['hash', 'range', 'roundRobin', 'custom'].includes(options.strategy)) {
    errors.push(`Invalid shard strategy: ${options.strategy}`)
  }

  return errors
}

/**
 * Calculate ideal shard distribution
 */
export function calculateIdealDistribution(
  totalThings: number,
  shardCount: number
): { min: number; max: number; ideal: number } {
  const ideal = Math.floor(totalThings / shardCount)
  const remainder = totalThings % shardCount

  return {
    min: ideal,
    max: ideal + (remainder > 0 ? 1 : 0),
    ideal,
  }
}

export default createMockShardCoordinator
