/**
 * @fileoverview Sharding Example Stub for Unified Storage
 *
 * This is a placeholder/stub for future sharding implementation.
 * Sharding allows distributing entities across multiple Durable Objects
 * for horizontal scalability.
 *
 * STATUS: STUB - Not yet implemented
 *
 * @example Future usage pattern:
 * ```typescript
 * const shardRouter = new ShardRouter({
 *   shardCount: 16,
 *   env,
 * })
 *
 * // Route to appropriate shard based on entity ID
 * const stub = shardRouter.getStub(entityId)
 * await stub.things.create({ $type: 'Customer', name: 'Alice' })
 * ```
 */

// ============================================================================
// SHARDING CONCEPTS
// ============================================================================

/**
 * Sharding Strategy Options
 *
 * Different strategies for distributing entities across shards:
 *
 * 1. HASH_BASED: Hash entity ID to determine shard
 *    - Pros: Even distribution, simple
 *    - Cons: No locality, cross-shard queries expensive
 *
 * 2. RANGE_BASED: Use ID ranges for shards
 *    - Pros: Range queries within shard efficient
 *    - Cons: Potential hotspots, rebalancing complex
 *
 * 3. TENANT_BASED: Each tenant gets dedicated shard(s)
 *    - Pros: Tenant isolation, simple routing
 *    - Cons: Uneven load, tenant size limits
 *
 * 4. HYBRID: Combine strategies (e.g., tenant + hash)
 *    - Pros: Flexible, balanced
 *    - Cons: More complex routing logic
 */
type ShardingStrategy = 'hash' | 'range' | 'tenant' | 'hybrid'

/**
 * Shard Router Configuration (Future)
 */
interface ShardRouterConfig {
  /** Number of shards */
  shardCount: number
  /** Sharding strategy */
  strategy: ShardingStrategy
  /** Durable Object namespace binding */
  namespace: DurableObjectNamespace
  /** Optional: Custom hash function */
  hashFn?: (id: string) => number
}

/**
 * Shard Router Interface (Future)
 *
 * Routes requests to the appropriate Durable Object shard.
 */
interface ShardRouter {
  /** Get the DO stub for a given entity ID */
  getStub(entityId: string): DurableObjectStub
  /** Get all shards for scatter-gather queries */
  getAllStubs(): DurableObjectStub[]
  /** Get shard index for an entity ID */
  getShardIndex(entityId: string): number
}

// Placeholder type for DO namespace
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

interface DurableObjectId {
  toString(): string
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>
}

// ============================================================================
// STUB IMPLEMENTATION
// ============================================================================

/**
 * ShardRouter Stub (Not Yet Implemented)
 *
 * This is a placeholder showing the intended API for future sharding support.
 */
class ShardRouterStub {
  private config: ShardRouterConfig

  constructor(config: ShardRouterConfig) {
    this.config = config
  }

  /**
   * Get shard index using consistent hashing
   */
  getShardIndex(entityId: string): number {
    // Simple hash-based sharding (placeholder)
    let hash = 0
    for (let i = 0; i < entityId.length; i++) {
      const char = entityId.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash) % this.config.shardCount
  }

  /**
   * Get DO stub for entity
   */
  getStub(entityId: string): DurableObjectStub {
    const shardIndex = this.getShardIndex(entityId)
    const shardName = `shard_${shardIndex}`
    const id = this.config.namespace.idFromName(shardName)
    return this.config.namespace.get(id)
  }

  /**
   * Get all shards for scatter-gather
   */
  getAllStubs(): DurableObjectStub[] {
    const stubs: DurableObjectStub[] = []
    for (let i = 0; i < this.config.shardCount; i++) {
      const id = this.config.namespace.idFromName(`shard_${i}`)
      stubs.push(this.config.namespace.get(id))
    }
    return stubs
  }
}

// ============================================================================
// FUTURE USAGE PATTERNS
// ============================================================================

const futureUsagePatterns = `
SHARDING PATTERNS FOR UNIFIED STORAGE (Future)
==============================================

1. BASIC HASH SHARDING
----------------------
const router = new ShardRouter({
  shardCount: 16,
  strategy: 'hash',
  namespace: env.UNIFIED_STORE,
})

// Create - routes to shard based on ID hash
const stub = router.getStub(customerId)
await stub.things.create({ $type: 'Customer', name: 'Alice' })

// Read - routes to same shard
const customer = await stub.things.get(customerId)


2. TENANT SHARDING
------------------
const router = new ShardRouter({
  shardCount: 100,
  strategy: 'tenant',
  namespace: env.UNIFIED_STORE,
})

// Each tenant gets dedicated shard(s)
const stub = router.getStub(\`tenant_\${tenantId}\`)
await stub.things.create({ $type: 'Customer', tenantId, name: 'Alice' })


3. SCATTER-GATHER QUERIES
-------------------------
// Query across all shards
const allStubs = router.getAllStubs()
const results = await Promise.all(
  allStubs.map(stub => stub.things.query({ $type: 'Customer', plan: 'enterprise' }))
)
const combined = results.flat()


4. CROSS-SHARD TRANSACTIONS (Future)
------------------------------------
// Saga pattern for cross-shard operations
const saga = new CrossShardSaga(router)
await saga
  .step(shard1, 'debit', { amount: 100 })
  .step(shard2, 'credit', { amount: 100 })
  .compensate(shard1, 'refund', { amount: 100 })
  .execute()


CONSIDERATIONS
==============

1. Hot Shards: Monitor shard load, implement rebalancing
2. Cross-Shard Joins: Expensive, prefer denormalization
3. Consistency: Each shard is consistent, cross-shard is eventual
4. Rebalancing: Use virtual shards for easier migration
`

// ============================================================================
// MAIN
// ============================================================================

console.log('=== Sharding Stub Example ===')
console.log('')
console.log('STATUS: This is a placeholder for future sharding implementation.')
console.log('')
console.log(futureUsagePatterns)
console.log('')
console.log('Implementation tracking: See unified-storage roadmap')

export { ShardRouterStub, type ShardRouterConfig, type ShardingStrategy }
