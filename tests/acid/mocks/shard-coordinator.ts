/**
 * ACID Test Suite - Phase 3: Shard Coordinator Mock
 *
 * Mock implementation of a shard coordinator for testing sharding operations.
 * Provides deterministic routing, scatter-gather, and shard management.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 3 Sharding
 */

import type { ShardStrategy } from '../../../types/Lifecycle'
import {
  type ShardInfo,
  type RoutingTableEntry,
  type CrossShardResult,
  type MockThing,
  simpleHash,
  SHARD_REGISTRY_4,
  RANGE_BOUNDARIES_4,
} from '../fixtures/phase3'

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Mock shard coordinator interface
 */
export interface MockShardCoordinator {
  /** Namespace of the coordinator */
  readonly ns: string

  /** Whether this is a coordinator */
  readonly isCoordinator: boolean

  /** Current shard count */
  readonly shardCount: number

  /** Sharding strategy */
  readonly strategy: ShardStrategy

  /** Shard key being used */
  readonly shardKey: string

  /** Register a new shard */
  registerShard(shard: ShardInfo): Promise<void>

  /** Unregister a shard */
  unregisterShard(shardIndex: number): Promise<void>

  /** Get all registered shards */
  getShards(): ShardInfo[]

  /** Get shard by index */
  getShard(shardIndex: number): ShardInfo | undefined

  /** Get the routing table */
  getRoutingTable(): RoutingTableEntry[]

  /** Route a key to a shard index */
  routeKey(key: string): number

  /** Route a thing to a shard index */
  routeThing(thing: MockThing): number

  /** Scatter a query to all shards in parallel */
  scatter<T>(query: (shard: ShardInfo) => Promise<T>): Promise<Map<number, T>>

  /** Scatter with timeout */
  scatterWithTimeout<T>(
    query: (shard: ShardInfo) => Promise<T>,
    timeoutMs: number
  ): Promise<Map<number, T | Error>>

  /** Gather results from shards */
  gather<T>(results: Map<number, T[]>): T[]

  /** Gather with deduplication by ID */
  gatherUnique<T extends { id: string }>(results: Map<number, T[]>): T[]

  /** Aggregate numeric results */
  aggregate(results: Map<number, number>, operation: 'sum' | 'avg' | 'min' | 'max'): number

  /** Check if coordinator is healthy */
  healthCheck(): Promise<{ healthy: boolean; shardHealth: Map<number, boolean> }>

  /** Get shard statistics */
  getStats(): {
    totalThings: number
    shardCounts: Map<number, number>
    averagePerShard: number
    imbalance: number
  }
}

/**
 * Mock shard stub for simulating DO stubs
 */
export interface MockShardStub {
  /** Shard info */
  info: ShardInfo

  /** Things stored in this shard */
  things: MockThing[]

  /** Simulated latency in ms */
  latency: number

  /** Whether shard is healthy */
  healthy: boolean

  /** Fetch simulation */
  fetch(request: Request): Promise<Response>

  /** RPC simulation - list things */
  list(): Promise<MockThing[]>

  /** RPC simulation - count things */
  count(): Promise<number>

  /** RPC simulation - find by query */
  find(predicate: (thing: MockThing) => boolean): Promise<MockThing[]>
}

/**
 * Options for creating a mock coordinator
 */
export interface MockCoordinatorOptions {
  /** Namespace for the coordinator */
  ns?: string

  /** Number of shards */
  shardCount?: number

  /** Sharding strategy */
  strategy?: ShardStrategy

  /** Key to shard on */
  shardKey?: string

  /** Pre-populate with shard registry */
  shards?: ShardInfo[]

  /** Range boundaries (for range strategy) */
  rangeBoundaries?: Array<{ shardIndex: number; start: string; end: string }>

  /** Custom hash function */
  hashFn?: (key: string) => number

  /** Custom routing function */
  routeFn?: (key: string, shardCount: number) => number
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Create a mock shard coordinator
 */
export function createMockShardCoordinator(
  options: MockCoordinatorOptions = {}
): MockShardCoordinator {
  const {
    ns = 'https://coordinator.test.do',
    shardCount = 4,
    strategy = 'hash',
    shardKey = 'id',
    shards = SHARD_REGISTRY_4.slice(0, shardCount),
    rangeBoundaries = RANGE_BOUNDARIES_4.slice(0, shardCount),
    hashFn = simpleHash,
    routeFn,
  } = options

  // Internal state
  const shardRegistry = new Map<number, ShardInfo>()
  const shardStubs = new Map<number, MockShardStub>()

  // Initialize shards
  for (const shard of shards) {
    shardRegistry.set(shard.shardIndex, shard)
    shardStubs.set(shard.shardIndex, createMockShardStub(shard))
  }

  // Route key to shard using configured strategy
  function routeKeyInternal(key: string): number {
    if (routeFn) {
      return routeFn(key, shardRegistry.size)
    }

    switch (strategy) {
      case 'hash':
        return hashFn(key) % shardRegistry.size

      case 'range':
        for (const boundary of rangeBoundaries) {
          if (key >= boundary.start && key <= boundary.end) {
            return boundary.shardIndex
          }
        }
        // Default to last shard
        return shardRegistry.size - 1

      case 'roundRobin':
        // For round-robin, we use a simple hash to ensure determinism
        return hashFn(key) % shardRegistry.size

      case 'custom':
        // Custom should use provided routeFn
        throw new Error('Custom strategy requires routeFn option')

      default:
        throw new Error(`Unknown strategy: ${strategy}`)
    }
  }

  const coordinator: MockShardCoordinator = {
    ns,
    isCoordinator: true,
    shardCount: shardRegistry.size,
    strategy,
    shardKey,

    async registerShard(shard: ShardInfo): Promise<void> {
      shardRegistry.set(shard.shardIndex, shard)
      shardStubs.set(shard.shardIndex, createMockShardStub(shard))
    },

    async unregisterShard(shardIndex: number): Promise<void> {
      shardRegistry.delete(shardIndex)
      shardStubs.delete(shardIndex)
    },

    getShards(): ShardInfo[] {
      return Array.from(shardRegistry.values()).sort((a, b) => a.shardIndex - b.shardIndex)
    },

    getShard(shardIndex: number): ShardInfo | undefined {
      return shardRegistry.get(shardIndex)
    },

    getRoutingTable(): RoutingTableEntry[] {
      return Array.from(shardRegistry.values()).map((shard) => {
        const entry: RoutingTableEntry = {
          index: shard.shardIndex,
          ns: shard.ns,
          doId: shard.doId,
        }

        if (strategy === 'range') {
          const boundary = rangeBoundaries.find((b) => b.shardIndex === shard.shardIndex)
          if (boundary) {
            entry.rangeStart = boundary.start
            entry.rangeEnd = boundary.end
          }
        }

        return entry
      })
    },

    routeKey(key: string): number {
      return routeKeyInternal(key)
    },

    routeThing(thing: MockThing): number {
      const keyValue =
        shardKey === 'id'
          ? thing.id
          : String((thing.data as Record<string, unknown>)[shardKey] ?? thing.id)
      return routeKeyInternal(keyValue)
    },

    async scatter<T>(query: (shard: ShardInfo) => Promise<T>): Promise<Map<number, T>> {
      const results = new Map<number, T>()

      // Execute in parallel
      const promises = Array.from(shardRegistry.entries()).map(async ([index, shard]) => {
        const result = await query(shard)
        return { index, result }
      })

      const settled = await Promise.all(promises)

      for (const { index, result } of settled) {
        results.set(index, result)
      }

      return results
    },

    async scatterWithTimeout<T>(
      query: (shard: ShardInfo) => Promise<T>,
      timeoutMs: number
    ): Promise<Map<number, T | Error>> {
      const results = new Map<number, T | Error>()

      const promises = Array.from(shardRegistry.entries()).map(async ([index, shard]) => {
        try {
          const result = await Promise.race([
            query(shard),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Shard ${index} timed out after ${timeoutMs}ms`)), timeoutMs)
            ),
          ])
          return { index, result: result as T | Error }
        } catch (error) {
          return { index, result: error as Error }
        }
      })

      const settled = await Promise.all(promises)

      for (const { index, result } of settled) {
        results.set(index, result)
      }

      return results
    },

    gather<T>(results: Map<number, T[]>): T[] {
      const gathered: T[] = []
      for (const items of results.values()) {
        gathered.push(...items)
      }
      return gathered
    },

    gatherUnique<T extends { id: string }>(results: Map<number, T[]>): T[] {
      const seen = new Set<string>()
      const unique: T[] = []

      for (const items of results.values()) {
        for (const item of items) {
          if (!seen.has(item.id)) {
            seen.add(item.id)
            unique.push(item)
          }
        }
      }

      return unique
    },

    aggregate(results: Map<number, number>, operation: 'sum' | 'avg' | 'min' | 'max'): number {
      const values = Array.from(results.values())

      if (values.length === 0) {
        return 0
      }

      switch (operation) {
        case 'sum':
          return values.reduce((a, b) => a + b, 0)
        case 'avg':
          return values.reduce((a, b) => a + b, 0) / values.length
        case 'min':
          return Math.min(...values)
        case 'max':
          return Math.max(...values)
      }
    },

    async healthCheck(): Promise<{ healthy: boolean; shardHealth: Map<number, boolean> }> {
      const shardHealth = new Map<number, boolean>()
      let allHealthy = true

      for (const [index, stub] of shardStubs) {
        shardHealth.set(index, stub.healthy)
        if (!stub.healthy) {
          allHealthy = false
        }
      }

      return { healthy: allHealthy, shardHealth }
    },

    getStats(): {
      totalThings: number
      shardCounts: Map<number, number>
      averagePerShard: number
      imbalance: number
    } {
      const shardCounts = new Map<number, number>()
      let total = 0

      for (const [index, stub] of shardStubs) {
        const count = stub.things.length
        shardCounts.set(index, count)
        total += count
      }

      const average = total / shardStubs.size
      const maxDeviation = Math.max(
        ...Array.from(shardCounts.values()).map((c) => Math.abs(c - average))
      )
      const imbalance = average > 0 ? maxDeviation / average : 0

      return { totalThings: total, shardCounts, averagePerShard: average, imbalance }
    },
  }

  return coordinator
}

/**
 * Create a mock shard stub
 */
export function createMockShardStub(
  info: ShardInfo,
  options: {
    things?: MockThing[]
    latency?: number
    healthy?: boolean
  } = {}
): MockShardStub {
  const { things = [], latency = 0, healthy = true } = options

  const stub: MockShardStub = {
    info,
    things: [...things],
    latency,
    healthy,

    async fetch(request: Request): Promise<Response> {
      if (!stub.healthy) {
        return new Response('Service Unavailable', { status: 503 })
      }

      if (stub.latency > 0) {
        await new Promise((resolve) => setTimeout(resolve, stub.latency))
      }

      const url = new URL(request.url)

      // Simple routing
      if (url.pathname.endsWith('/things')) {
        return new Response(JSON.stringify(stub.things), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.pathname.endsWith('/count')) {
        return new Response(JSON.stringify({ count: stub.things.length }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not Found', { status: 404 })
    },

    async list(): Promise<MockThing[]> {
      if (!stub.healthy) {
        throw new Error('Shard unavailable')
      }

      if (stub.latency > 0) {
        await new Promise((resolve) => setTimeout(resolve, stub.latency))
      }

      return [...stub.things]
    },

    async count(): Promise<number> {
      if (!stub.healthy) {
        throw new Error('Shard unavailable')
      }

      if (stub.latency > 0) {
        await new Promise((resolve) => setTimeout(resolve, stub.latency))
      }

      return stub.things.length
    },

    async find(predicate: (thing: MockThing) => boolean): Promise<MockThing[]> {
      if (!stub.healthy) {
        throw new Error('Shard unavailable')
      }

      if (stub.latency > 0) {
        await new Promise((resolve) => setTimeout(resolve, stub.latency))
      }

      return stub.things.filter(predicate)
    },
  }

  return stub
}

// ============================================================================
// DISTRIBUTED COORDINATOR (for multi-coordinator scenarios)
// ============================================================================

/**
 * Mock distributed shard coordinator for testing rebalancing
 */
export interface MockDistributedCoordinator extends MockShardCoordinator {
  /** Version of the routing table */
  routingTableVersion: number

  /** Update routing table (for rebalancing) */
  updateRoutingTable(newShards: ShardInfo[]): Promise<void>

  /** Add a new shard (rebalancing) */
  addShard(shard: ShardInfo): Promise<void>

  /** Remove a shard (rebalancing) */
  removeShard(shardIndex: number): Promise<void>

  /** Migrate things between shards */
  migrateThing(thingId: string, fromShard: number, toShard: number): Promise<void>

  /** Get routing table version for consistency checks */
  getRoutingTableVersion(): number
}

/**
 * Create a mock distributed coordinator
 */
export function createMockDistributedCoordinator(
  options: MockCoordinatorOptions & { version?: number } = {}
): MockDistributedCoordinator {
  const baseCoordinator = createMockShardCoordinator(options)
  let routingTableVersion = options.version ?? 1

  const distributed: MockDistributedCoordinator = {
    ...baseCoordinator,

    routingTableVersion,

    async updateRoutingTable(newShards: ShardInfo[]): Promise<void> {
      // Clear existing
      for (const shard of baseCoordinator.getShards()) {
        await baseCoordinator.unregisterShard(shard.shardIndex)
      }

      // Register new shards
      for (const shard of newShards) {
        await baseCoordinator.registerShard(shard)
      }

      routingTableVersion++
    },

    async addShard(shard: ShardInfo): Promise<void> {
      await baseCoordinator.registerShard(shard)
      routingTableVersion++
    },

    async removeShard(shardIndex: number): Promise<void> {
      await baseCoordinator.unregisterShard(shardIndex)
      routingTableVersion++
    },

    async migrateThing(_thingId: string, _fromShard: number, _toShard: number): Promise<void> {
      // In a real implementation, this would move the thing between shards
      // For mock, we just track the routing table version
      routingTableVersion++
    },

    getRoutingTableVersion(): number {
      return routingTableVersion
    },
  }

  return distributed
}

// ============================================================================
// CIRCUIT BREAKER MOCK
// ============================================================================

/**
 * Mock circuit breaker for shard resilience testing
 */
export interface MockCircuitBreaker {
  /** Current state */
  state: 'closed' | 'open' | 'half-open'

  /** Failure count */
  failures: number

  /** Success count since last failure */
  successes: number

  /** Check if request should be allowed */
  canRequest(): boolean

  /** Record a success */
  recordSuccess(): void

  /** Record a failure */
  recordFailure(): void

  /** Reset the circuit breaker */
  reset(): void

  /** Force open the circuit */
  forceOpen(): void

  /** Get circuit state */
  getState(): { state: string; failures: number; successes: number }
}

/**
 * Create a mock circuit breaker
 */
export function createMockCircuitBreaker(options: {
  failureThreshold?: number
  successThreshold?: number
  resetTimeout?: number
} = {}): MockCircuitBreaker {
  const { failureThreshold = 3, successThreshold = 2, resetTimeout = 5000 } = options

  let state: 'closed' | 'open' | 'half-open' = 'closed'
  let failures = 0
  let successes = 0
  let openedAt: number | null = null

  const breaker: MockCircuitBreaker = {
    get state() {
      return state
    },
    get failures() {
      return failures
    },
    get successes() {
      return successes
    },

    canRequest(): boolean {
      if (state === 'closed') {
        return true
      }

      if (state === 'open') {
        // Check if timeout has passed
        if (openedAt && Date.now() - openedAt >= resetTimeout) {
          state = 'half-open'
          return true
        }
        return false
      }

      // half-open: allow one request
      return true
    },

    recordSuccess(): void {
      if (state === 'half-open') {
        successes++
        if (successes >= successThreshold) {
          state = 'closed'
          failures = 0
          successes = 0
          openedAt = null
        }
      } else if (state === 'closed') {
        // Reset failure count on success
        failures = 0
      }
    },

    recordFailure(): void {
      failures++
      successes = 0

      if (state === 'half-open') {
        state = 'open'
        openedAt = Date.now()
      } else if (state === 'closed' && failures >= failureThreshold) {
        state = 'open'
        openedAt = Date.now()
      }
    },

    reset(): void {
      state = 'closed'
      failures = 0
      successes = 0
      openedAt = null
    },

    forceOpen(): void {
      state = 'open'
      openedAt = Date.now()
    },

    getState(): { state: string; failures: number; successes: number } {
      return { state, failures, successes }
    },
  }

  return breaker
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a coordinator with pre-distributed things
 */
export function createCoordinatorWithData(
  things: MockThing[],
  options: MockCoordinatorOptions = {}
): {
  coordinator: MockShardCoordinator
  stubs: Map<number, MockShardStub>
  distribution: Map<number, MockThing[]>
} {
  const coordinator = createMockShardCoordinator(options)
  const stubs = new Map<number, MockShardStub>()
  const distribution = new Map<number, MockThing[]>()

  // Initialize distribution
  for (const shard of coordinator.getShards()) {
    distribution.set(shard.shardIndex, [])
  }

  // Distribute things
  for (const thing of things) {
    const shardIndex = coordinator.routeThing(thing)
    distribution.get(shardIndex)!.push(thing)
  }

  // Create stubs with data
  for (const shard of coordinator.getShards()) {
    const stub = createMockShardStub(shard, {
      things: distribution.get(shard.shardIndex) || [],
    })
    stubs.set(shard.shardIndex, stub)
  }

  return { coordinator, stubs, distribution }
}

/**
 * Simulate shard failure
 */
export function simulateShardFailure(
  stubs: Map<number, MockShardStub>,
  shardIndex: number
): void {
  const stub = stubs.get(shardIndex)
  if (stub) {
    stub.healthy = false
  }
}

/**
 * Simulate shard recovery
 */
export function simulateShardRecovery(
  stubs: Map<number, MockShardStub>,
  shardIndex: number
): void {
  const stub = stubs.get(shardIndex)
  if (stub) {
    stub.healthy = true
  }
}

/**
 * Simulate network latency for a shard
 */
export function simulateLatency(
  stubs: Map<number, MockShardStub>,
  shardIndex: number,
  latencyMs: number
): void {
  const stub = stubs.get(shardIndex)
  if (stub) {
    stub.latency = latencyMs
  }
}
