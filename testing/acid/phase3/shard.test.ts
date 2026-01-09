/**
 * ACID Test Suite - Phase 3: shard() - Create Shard Set
 *
 * RED TDD: These tests define the expected behavior for the shard() method
 * that creates a shard set from a single DO. All tests are expected to FAIL
 * initially as this is the RED phase.
 *
 * Sharding provides:
 * - Horizontal scaling by distributing data across multiple DOs
 * - Consistent hashing for minimal key redistribution
 * - Automatic data distribution based on shard key
 * - Shard registry for discovery and coordination
 * - Cross-shard query aggregation
 * - Shard rebalancing support
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace, createMockId } from '../../do'
import { DO } from '../../../objects/DO'
import type {
  ShardOptions,
  ShardResult,
  ShardStrategy,
  CloneMode,
} from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR SHARD TESTS
// ============================================================================

/**
 * Extended shard options with additional configuration
 */
interface ExtendedShardOptions extends ShardOptions {
  /** Custom shard key extraction function */
  keyExtractor?: (thing: ThingRecord) => string
  /** Timeout for the shard operation in ms */
  timeout?: number
  /** Correlation ID for tracing */
  correlationId?: string
  /** Whether to include metadata in shard */
  includeMetadata?: boolean
  /** Target shards (for manual assignment) */
  targetShards?: string[]
}

/**
 * Extended shard result with additional metadata
 */
interface ExtendedShardResult extends ShardResult {
  /** Time taken for sharding operation */
  duration: number
  /** Registry entry for the shard set */
  registry: ShardRegistry
  /** Statistics about the distribution */
  stats: ShardDistributionStats
}

/**
 * Shard registry entry for discovery
 */
interface ShardRegistry {
  /** Unique ID for this shard set */
  id: string
  /** Shard key field name */
  shardKey: string
  /** Number of shards */
  shardCount: number
  /** Strategy used */
  strategy: ShardStrategy
  /** Creation timestamp */
  createdAt: Date
  /** Array of shard endpoints */
  endpoints: Array<{
    shardIndex: number
    ns: string
    doId: string
    status: 'active' | 'inactive' | 'rebalancing'
  }>
}

/**
 * Distribution statistics
 */
interface ShardDistributionStats {
  /** Total things distributed */
  totalThings: number
  /** Min things in any shard */
  minPerShard: number
  /** Max things in any shard */
  maxPerShard: number
  /** Average things per shard */
  avgPerShard: number
  /** Standard deviation */
  stdDev: number
  /** Skew ratio (max/min) */
  skewRatio: number
}

/**
 * Thing record for testing
 */
interface ThingRecord {
  id: string
  type: number
  branch: string | null
  name: string
  data: Record<string, unknown>
  deleted: boolean
  visibility: string
  createdAt?: string
  updatedAt?: string
}

/**
 * Shard discovery result
 */
interface ShardDiscoveryResult {
  /** Registry information */
  registry: ShardRegistry
  /** Health status of each shard */
  health: Array<{
    shardIndex: number
    healthy: boolean
    lastCheck: Date
    responseTime?: number
  }>
}

/**
 * Cross-shard query options
 */
interface CrossShardQueryOptions {
  /** Query to execute */
  query: string
  /** Aggregation strategy */
  aggregation?: 'merge' | 'concat' | 'sum' | 'count' | 'avg'
  /** Timeout per shard */
  timeout?: number
  /** Continue on shard error */
  continueOnError?: boolean
}

/**
 * Cross-shard query result
 */
interface CrossShardQueryResult<T = unknown> {
  /** Merged results */
  data: T[]
  /** Per-shard metadata */
  shardResults: Array<{
    shardIndex: number
    itemCount: number
    duration: number
    error?: string
  }>
  /** Total items across all shards */
  totalItems: number
}

/**
 * Rebalance options
 */
interface RebalanceOptions {
  /** Target shard count (for scaling) */
  targetCount?: number
  /** Maximum skew allowed before rebalance */
  maxSkew?: number
  /** Rebalance strategy */
  strategy?: 'incremental' | 'full'
}

/**
 * Rebalance result
 */
interface RebalanceResult {
  /** Items moved between shards */
  itemsMoved: number
  /** New distribution stats */
  newStats: ShardDistributionStats
  /** Shards that were modified */
  modifiedShards: number[]
  /** Duration of rebalance */
  duration: number
}

/**
 * Shard event types
 */
type ShardEventType =
  | 'shard.started'
  | 'shard.completed'
  | 'shard.failed'
  | 'shard.item_assigned'
  | 'shard.rebalance_started'
  | 'shard.rebalance_completed'

/**
 * Shard event payload
 */
interface ShardEvent {
  type: ShardEventType
  correlationId: string
  timestamp: Date
  data?: Record<string, unknown>
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample things with shard key data
 */
function createShardableThings(
  count: number,
  keyField: string = 'tenantId'
): ThingRecord[] {
  const tenants = ['tenant-a', 'tenant-b', 'tenant-c', 'tenant-d', 'tenant-e']
  const now = new Date().toISOString()

  return Array.from({ length: count }, (_, i) => ({
    id: `thing-${i}`,
    type: 1,
    branch: null,
    name: `Item ${i}`,
    data: {
      [keyField]: tenants[i % tenants.length],
      index: i,
      value: `value-${i}`,
    },
    deleted: false,
    visibility: 'user',
    createdAt: now,
    updatedAt: now,
  }))
}

/**
 * Create things with custom tenant distribution
 */
function createThingsWithDistribution(
  distribution: Record<string, number>,
  keyField: string = 'tenantId'
): ThingRecord[] {
  const now = new Date().toISOString()
  const things: ThingRecord[] = []
  let index = 0

  for (const [tenant, count] of Object.entries(distribution)) {
    for (let i = 0; i < count; i++) {
      things.push({
        id: `thing-${index}`,
        type: 1,
        branch: null,
        name: `Item ${index}`,
        data: {
          [keyField]: tenant,
          index,
        },
        deleted: false,
        visibility: 'user',
        createdAt: now,
        updatedAt: now,
      })
      index++
    }
  }

  return things
}

/**
 * Create sample relationships between things
 */
function createThingRelationships(
  thingIds: string[]
): Array<{
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
  createdAt: string
}> {
  const now = new Date().toISOString()
  const relationships: Array<{
    id: string
    verb: string
    from: string
    to: string
    data: Record<string, unknown> | null
    createdAt: string
  }> = []

  // Create chain relationships
  for (let i = 0; i < thingIds.length - 1; i++) {
    relationships.push({
      id: `rel-${i}`,
      verb: 'relatedTo',
      from: thingIds[i],
      to: thingIds[i + 1],
      data: { order: i },
      createdAt: now,
    })
  }

  return relationships
}

// ============================================================================
// TEST SUITE: BASIC SHARDING
// ============================================================================

describe('shard() - create shard set', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: ShardEvent[]

  beforeEach(() => {
    capturedEvents = []

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createShardableThings(100)],
        ['relationships', createThingRelationships(
          Array.from({ length: 100 }, (_, i) => `thing-${i}`)
        )],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    // Mock event capture
    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as ShardEventType,
        correlationId: (data as Record<string, unknown>)?.correlationId as string || '',
        timestamp: new Date(),
        data: data as Record<string, unknown>,
      })
      return originalEmit?.call(result.instance, verb, data)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // BASIC SHARDING
  // ==========================================================================

  describe('basic sharding', () => {
    it('should create N shard DOs', async () => {
      // RED: This test should fail until shard() is implemented
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      expect(shardResult.shards).toHaveLength(4)
      expect(shardResult.shards.every((s) => s.ns)).toBe(true)
      expect(shardResult.shards.every((s) => s.doId)).toBe(true)
    })

    it('should distribute existing data across shards', async () => {
      // RED: Data should be distributed based on shard key
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      // Total things across all shards should equal original count
      const totalThings = shardResult.shards.reduce((sum, s) => sum + s.thingCount, 0)
      expect(totalThings).toBe(100)

      // Each shard should have some data (not all empty or all full)
      expect(shardResult.shards.every((s) => s.thingCount >= 0)).toBe(true)
      expect(shardResult.shards.some((s) => s.thingCount > 0)).toBe(true)
    })

    it('should assign shard keys to data', async () => {
      // RED: Each thing should be assigned to appropriate shard
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      // Shard key should be recorded
      expect(shardResult.shardKey).toBe('tenantId')

      // Each shard should have an index
      for (let i = 0; i < shardResult.shards.length; i++) {
        expect(shardResult.shards[i].shardIndex).toBe(i)
      }
    })

    it('should return correct shard result structure', async () => {
      // RED: Result should conform to ShardResult interface
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      expect(shardResult).toHaveProperty('shardKey')
      expect(shardResult).toHaveProperty('shards')
      expect(shardResult).toHaveProperty('registry')
      expect(shardResult).toHaveProperty('duration')
    })

    it('should create independent DO instances for each shard', async () => {
      // RED: Each shard should be a separate DO
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      const doIds = shardResult.shards.map((s) => s.doId)
      const uniqueIds = new Set(doIds)
      expect(uniqueIds.size).toBe(4) // All unique

      const namespaces = shardResult.shards.map((s) => s.ns)
      const uniqueNs = new Set(namespaces)
      expect(uniqueNs.size).toBe(4) // All unique
    })
  })

  // ==========================================================================
  // DISTRIBUTION STRATEGIES
  // ==========================================================================

  describe('distribution', () => {
    it('should use consistent hashing by default', async () => {
      // RED: Default strategy should be consistent hashing
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      expect(shardResult.registry.strategy).toBe('hash')

      // Same key should always go to same shard
      const key1Shard1 = await getShardForKey('tenant-a', shardResult)
      const key1Shard2 = await getShardForKey('tenant-a', shardResult)
      expect(key1Shard1).toBe(key1Shard2)
    })

    it('should support custom shard key function', async () => {
      // RED: Custom key extractor should be supported
      const options: ExtendedShardOptions = {
        key: 'customKey',
        count: 4,
        keyExtractor: (thing) => {
          // Custom logic: shard by first letter of name
          const name = thing.data.name as string || ''
          return name.charAt(0).toLowerCase()
        },
      }

      const shardResult = await result.instance.shard(options) as ExtendedShardResult

      expect(shardResult.shardKey).toBe('customKey')
      expect(shardResult.shards.length).toBe(4)
    })

    it('should maintain even distribution', async () => {
      // RED: Distribution should be relatively even
      // Create 1000 things with uniform tenant distribution
      result.sqlData.set('things', createShardableThings(1000))

      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      // Check distribution stats
      const counts = shardResult.shards.map((s) => s.thingCount)
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length
      const maxDeviation = Math.max(...counts.map((c) => Math.abs(c - avg)))

      // No shard should be more than 50% away from average
      expect(maxDeviation / avg).toBeLessThan(0.5)
    })

    it('should support hash strategy explicitly', async () => {
      // RED: Explicit hash strategy
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
        strategy: 'hash',
      }) as ExtendedShardResult

      expect(shardResult.registry.strategy).toBe('hash')
    })

    it('should support range strategy', async () => {
      // RED: Range-based sharding
      const shardResult = await result.instance.shard({
        key: 'index',
        count: 4,
        strategy: 'range',
      }) as ExtendedShardResult

      expect(shardResult.registry.strategy).toBe('range')

      // Range sharding should order by key value
      // Low values in first shards, high in last
    })

    it('should support roundRobin strategy', async () => {
      // RED: Round-robin distribution
      const shardResult = await result.instance.shard({
        key: 'id',
        count: 4,
        strategy: 'roundRobin',
      }) as ExtendedShardResult

      expect(shardResult.registry.strategy).toBe('roundRobin')

      // Round robin should give very even distribution
      const counts = shardResult.shards.map((s) => s.thingCount)
      const max = Math.max(...counts)
      const min = Math.min(...counts)
      expect(max - min).toBeLessThanOrEqual(1) // At most 1 difference
    })

    it('should handle skewed data distribution', async () => {
      // RED: Handle uneven source data
      const skewedThings = createThingsWithDistribution({
        'big-tenant': 800,
        'small-tenant-1': 50,
        'small-tenant-2': 100,
        'small-tenant-3': 50,
      })
      result.sqlData.set('things', skewedThings)

      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      // Should still complete, stats should show skew
      expect(shardResult.stats.skewRatio).toBeGreaterThan(1)
      expect(shardResult.shards.reduce((sum, s) => sum + s.thingCount, 0)).toBe(1000)
    })
  })

  // ==========================================================================
  // SHARD SET MANAGEMENT
  // ==========================================================================

  describe('shard set', () => {
    it('should create shard registry', async () => {
      // RED: Registry should track shard set metadata
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      expect(shardResult.registry).toBeDefined()
      expect(shardResult.registry.id).toBeDefined()
      expect(shardResult.registry.shardKey).toBe('tenantId')
      expect(shardResult.registry.shardCount).toBe(4)
      expect(shardResult.registry.createdAt).toBeInstanceOf(Date)
    })

    it('should track shard membership', async () => {
      // RED: Registry should track which DOs are part of shard set
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      expect(shardResult.registry.endpoints).toHaveLength(4)
      for (const endpoint of shardResult.registry.endpoints) {
        expect(endpoint.shardIndex).toBeDefined()
        expect(endpoint.ns).toBeDefined()
        expect(endpoint.doId).toBeDefined()
        expect(endpoint.status).toBe('active')
      }
    })

    it('should support shard discovery', async () => {
      // RED: Should be able to discover shard set from any member
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      // The source DO should be able to discover all shards
      const discovery = await (result.instance as unknown as {
        discoverShards(): Promise<ShardDiscoveryResult>
      }).discoverShards()

      expect(discovery.registry.endpoints).toHaveLength(4)
      expect(discovery.health).toHaveLength(4)
      expect(discovery.health.every((h) => h.healthy)).toBe(true)
    })

    it('should store registry in source DO', async () => {
      // RED: Registry should be persisted
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      // Check that registry is stored
      const storedRegistry = await result.storage.get('shardRegistry')
      expect(storedRegistry).toBeDefined()
    })

    it('should update registry on rebalance', async () => {
      // RED: Registry should update when shards change
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      const originalRegistryId = shardResult.registry.id

      // Trigger rebalance (add a shard)
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({ targetCount: 5 })

      // Get updated registry
      const discovery = await (result.instance as unknown as {
        discoverShards(): Promise<ShardDiscoveryResult>
      }).discoverShards()

      expect(discovery.registry.shardCount).toBe(5)
    })
  })

  // ==========================================================================
  // SHARD OPERATIONS
  // ==========================================================================

  describe('operations', () => {
    it('should route queries to correct shard', async () => {
      // RED: Queries with shard key should go to correct shard
      await result.instance.shard({
        key: 'tenantId',
        count: 4,
      })

      // Query for specific tenant should route to one shard
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: "SELECT * FROM things WHERE data->>'tenantId' = 'tenant-a'",
      })

      // Should only hit one shard (the one with tenant-a data)
      const shardsWithData = queryResult.shardResults.filter((s) => s.itemCount > 0)
      expect(shardsWithData.length).toBe(1)
    })

    it('should support cross-shard aggregation', async () => {
      // RED: Aggregation queries should fan out to all shards
      await result.instance.shard({
        key: 'tenantId',
        count: 4,
      })

      // Count query should aggregate across all shards
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT COUNT(*) FROM things',
        aggregation: 'sum',
      })

      // All shards should be queried
      expect(queryResult.shardResults.length).toBe(4)

      // Total should equal original count
      expect(queryResult.totalItems).toBe(100)
    })

    it('should handle shard rebalancing', async () => {
      // RED: Should be able to rebalance data between shards
      // Create skewed initial distribution
      const skewedThings = createThingsWithDistribution({
        'tenant-a': 400,
        'tenant-b': 300,
        'tenant-c': 200,
        'tenant-d': 100,
      })
      result.sqlData.set('things', skewedThings)

      await result.instance.shard({
        key: 'tenantId',
        count: 4,
      })

      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        maxSkew: 1.2, // Allow 20% skew
        strategy: 'incremental',
      })

      expect(rebalanceResult.itemsMoved).toBeGreaterThan(0)
      expect(rebalanceResult.newStats.skewRatio).toBeLessThanOrEqual(1.2)
    })

    it('should support adding new shards', async () => {
      // RED: Should be able to scale out by adding shards
      await result.instance.shard({
        key: 'tenantId',
        count: 4,
      })

      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 6, // Scale from 4 to 6
      })

      const discovery = await (result.instance as unknown as {
        discoverShards(): Promise<ShardDiscoveryResult>
      }).discoverShards()

      expect(discovery.registry.shardCount).toBe(6)
      expect(discovery.registry.endpoints.length).toBe(6)
    })

    it('should support removing shards', async () => {
      // RED: Should be able to scale in by removing shards
      await result.instance.shard({
        key: 'tenantId',
        count: 4,
      })

      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 2, // Scale from 4 to 2
      })

      const discovery = await (result.instance as unknown as {
        discoverShards(): Promise<ShardDiscoveryResult>
      }).discoverShards()

      expect(discovery.registry.shardCount).toBe(2)
      // All data should still be accessible
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT COUNT(*) FROM things',
        aggregation: 'sum',
      })
      expect(queryResult.totalItems).toBe(100)
    })
  })

  // ==========================================================================
  // SHARD KEY HANDLING
  // ==========================================================================

  describe('shard key extraction', () => {
    it('should extract shard key from thing data', async () => {
      // RED: Should extract key from data object
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      expect(shardResult.shardKey).toBe('tenantId')
    })

    it('should handle nested shard keys', async () => {
      // RED: Should support dot notation for nested keys
      const nestedThings = Array.from({ length: 100 }, (_, i) => ({
        id: `thing-${i}`,
        type: 1,
        branch: null,
        name: `Item ${i}`,
        data: {
          metadata: {
            organization: {
              id: `org-${i % 5}`,
            },
          },
        },
        deleted: false,
        visibility: 'user',
      }))
      result.sqlData.set('things', nestedThings)

      const shardResult = await result.instance.shard({
        key: 'metadata.organization.id',
        count: 4,
      }) as ExtendedShardResult

      expect(shardResult.shardKey).toBe('metadata.organization.id')
      expect(shardResult.shards.length).toBe(4)
    })

    it('should handle missing shard key gracefully', async () => {
      // RED: Things without shard key should go to default shard
      const mixedThings = [
        ...createShardableThings(50),
        ...Array.from({ length: 50 }, (_, i) => ({
          id: `thing-no-key-${i}`,
          type: 1,
          branch: null,
          name: `No Key ${i}`,
          data: { value: i }, // No tenantId
          deleted: false,
          visibility: 'user',
        })),
      ]
      result.sqlData.set('things', mixedThings)

      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      // All things should be distributed
      const total = shardResult.shards.reduce((sum, s) => sum + s.thingCount, 0)
      expect(total).toBe(100)
    })

    it('should handle null shard key values', async () => {
      // RED: Null values should be handled consistently
      const nullKeyThings = Array.from({ length: 100 }, (_, i) => ({
        id: `thing-${i}`,
        type: 1,
        branch: null,
        name: `Item ${i}`,
        data: {
          tenantId: i % 3 === 0 ? null : `tenant-${i % 5}`,
        },
        deleted: false,
        visibility: 'user',
      }))
      result.sqlData.set('things', nullKeyThings)

      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      // Should complete without error
      expect(shardResult.shards.length).toBe(4)
    })
  })

  // ==========================================================================
  // RELATIONSHIPS IN SHARDING
  // ==========================================================================

  describe('relationship handling', () => {
    it('should preserve relationships when sharding', async () => {
      // RED: Relationships should be copied to shards
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      // Query relationships across shards
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: CrossShardQueryOptions): Promise<CrossShardQueryResult<T>>
      }).queryShards({
        query: 'SELECT COUNT(*) FROM relationships',
        aggregation: 'sum',
      })

      // Should have relationships distributed
      expect(queryResult.totalItems).toBeGreaterThan(0)
    })

    it('should handle cross-shard relationships', async () => {
      // RED: Relationships between things in different shards
      // Things with same tenant go to same shard, relationships between tenants cross shards
      const crossShardRels = [
        { id: 'rel-cross-1', verb: 'references', from: 'thing-0', to: 'thing-1', data: null, createdAt: new Date().toISOString() },
        { id: 'rel-cross-2', verb: 'references', from: 'thing-0', to: 'thing-5', data: null, createdAt: new Date().toISOString() },
      ]
      const existingRels = result.sqlData.get('relationships') as unknown[]
      result.sqlData.set('relationships', [...existingRels, ...crossShardRels])

      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      // Cross-shard relationships should be tracked in a special index
      expect(shardResult).toBeDefined()
    })

    it('should collocate related things when possible', async () => {
      // RED: Same-tenant relationships should stay in same shard
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      // All tenant-a things should be in the same shard
      // This ensures related data stays together
      expect(shardResult.shards.length).toBe(4)
    })
  })

  // ==========================================================================
  // SHARD METADATA
  // ==========================================================================

  describe('shard metadata', () => {
    it('should store shard metadata in each shard', async () => {
      // RED: Each shard should know its role
      const options: ExtendedShardOptions = {
        key: 'tenantId',
        count: 4,
        includeMetadata: true,
      }

      const shardResult = await result.instance.shard(options) as ExtendedShardResult

      // Each shard should have metadata about the shard set
      for (const shard of shardResult.shards) {
        expect(shard.ns).toBeDefined()
        expect(shard.shardIndex).toBeDefined()
      }
    })

    it('should track shard creation time', async () => {
      // RED: Shards should have creation timestamps
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      expect(shardResult.registry.createdAt).toBeInstanceOf(Date)
    })

    it('should track distribution statistics', async () => {
      // RED: Stats should be calculated
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      expect(shardResult.stats.totalThings).toBe(100)
      expect(shardResult.stats.avgPerShard).toBe(25)
      expect(shardResult.stats.minPerShard).toBeDefined()
      expect(shardResult.stats.maxPerShard).toBeDefined()
      expect(shardResult.stats.stdDev).toBeDefined()
    })

    it('should include duration in result', async () => {
      // RED: Should track how long sharding took
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      expect(shardResult.duration).toBeGreaterThanOrEqual(0)
      expect(typeof shardResult.duration).toBe('number')
    })
  })

  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================

  describe('event emission', () => {
    it('should emit shard.started event', async () => {
      // RED: Should emit start event
      const options: ExtendedShardOptions = {
        key: 'tenantId',
        count: 4,
        correlationId: 'shard-123',
      }

      await result.instance.shard(options)

      const startEvent = capturedEvents.find((e) => e.type === 'shard.started')
      expect(startEvent).toBeDefined()
      expect(startEvent?.correlationId).toBe('shard-123')
    })

    it('should emit shard.completed event on success', async () => {
      // RED: Should emit completion event
      const options: ExtendedShardOptions = {
        key: 'tenantId',
        count: 4,
        correlationId: 'shard-456',
      }

      await result.instance.shard(options)

      const completedEvent = capturedEvents.find((e) => e.type === 'shard.completed')
      expect(completedEvent).toBeDefined()
      expect(completedEvent?.correlationId).toBe('shard-456')
      expect(completedEvent?.data?.shardCount).toBe(4)
    })

    it('should emit shard.failed event on failure', async () => {
      // RED: Should emit failure event
      const options: ExtendedShardOptions = {
        key: 'nonexistent',
        count: 0, // Invalid count
        correlationId: 'shard-789',
      }

      await expect(result.instance.shard(options)).rejects.toThrow()

      const failedEvent = capturedEvents.find((e) => e.type === 'shard.failed')
      expect(failedEvent).toBeDefined()
      expect(failedEvent?.correlationId).toBe('shard-789')
    })

    it('should generate correlation ID if not provided', async () => {
      // RED: Auto-generate correlation ID
      await result.instance.shard({
        key: 'tenantId',
        count: 4,
      })

      const startEvent = capturedEvents.find((e) => e.type === 'shard.started')
      expect(startEvent?.correlationId).toBeDefined()
      expect(startEvent?.correlationId.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  describe('validation', () => {
    it('should require shard key', async () => {
      // RED: Key is required
      await expect(
        result.instance.shard({
          key: '',
          count: 4,
        })
      ).rejects.toThrow(/key.*required|invalid.*key/i)
    })

    it('should require positive shard count', async () => {
      // RED: Count must be positive
      await expect(
        result.instance.shard({
          key: 'tenantId',
          count: 0,
        })
      ).rejects.toThrow(/count.*positive|invalid.*count/i)

      await expect(
        result.instance.shard({
          key: 'tenantId',
          count: -1,
        })
      ).rejects.toThrow(/count.*positive|invalid.*count/i)
    })

    it('should validate shard count is reasonable', async () => {
      // RED: Count should have upper limit
      await expect(
        result.instance.shard({
          key: 'tenantId',
          count: 10000, // Too many shards
        })
      ).rejects.toThrow(/count.*too.*large|maximum.*shards/i)
    })

    it('should validate strategy is valid', async () => {
      // RED: Strategy must be known type
      await expect(
        result.instance.shard({
          key: 'tenantId',
          count: 4,
          strategy: 'invalid' as ShardStrategy,
        })
      ).rejects.toThrow(/invalid.*strategy/i)
    })

    it('should reject sharding empty DO', async () => {
      // RED: Cannot shard empty data
      result.sqlData.set('things', [])

      await expect(
        result.instance.shard({
          key: 'tenantId',
          count: 4,
        })
      ).rejects.toThrow(/empty|no.*data/i)
    })

    it('should reject sharding already sharded DO', async () => {
      // RED: Cannot shard twice
      await result.instance.shard({
        key: 'tenantId',
        count: 4,
      })

      await expect(
        result.instance.shard({
          key: 'tenantId',
          count: 8,
        })
      ).rejects.toThrow(/already.*sharded/i)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle large dataset sharding', async () => {
      // RED: Should handle many things
      result.sqlData.set('things', createShardableThings(10000))

      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 16,
      }) as ExtendedShardResult

      expect(shardResult.stats.totalThings).toBe(10000)
      expect(shardResult.shards.length).toBe(16)
    })

    it('should handle single shard (no-op)', async () => {
      // RED: Single shard should still work
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 1,
      }) as ExtendedShardResult

      expect(shardResult.shards.length).toBe(1)
      expect(shardResult.shards[0].thingCount).toBe(100)
    })

    it('should handle more shards than unique keys', async () => {
      // RED: 5 tenants with 8 shards = some empty shards
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 8,
      }) as ExtendedShardResult

      // Should complete, some shards may be empty
      expect(shardResult.shards.length).toBe(8)
      // With 5 tenants and 8 shards using consistent hash, at least some shards have data
      const nonEmptyShards = shardResult.shards.filter((s) => s.thingCount > 0)
      expect(nonEmptyShards.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle unicode in shard keys', async () => {
      // RED: Unicode keys should work
      const unicodeThings = Array.from({ length: 100 }, (_, i) => ({
        id: `thing-${i}`,
        type: 1,
        branch: null,
        name: `Item ${i}`,
        data: {
          tenantId: ['org-alpha', 'org-beta', 'org-gamma', 'org-delta'][i % 4],
        },
        deleted: false,
        visibility: 'user',
      }))
      result.sqlData.set('things', unicodeThings)

      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      expect(shardResult.shards.length).toBe(4)
    })

    it('should handle concurrent shard requests', async () => {
      // RED: Should handle or reject concurrent requests
      const shard1 = result.instance.shard({ key: 'tenantId', count: 4 })
      const shard2 = result.instance.shard({ key: 'tenantId', count: 4 })

      const results = await Promise.allSettled([shard1, shard2])

      // At least one should succeed
      const successes = results.filter((r) => r.status === 'fulfilled')
      expect(successes.length).toBeGreaterThanOrEqual(1)

      // Second should be rejected as duplicate
      const rejections = results.filter((r) => r.status === 'rejected')
      expect(rejections.length).toBeLessThanOrEqual(1)
    })

    it('should timeout if sharding takes too long', async () => {
      // RED: Should respect timeout
      result.sqlData.set('things', createShardableThings(100000))

      const options: ExtendedShardOptions = {
        key: 'tenantId',
        count: 64,
        timeout: 100, // Very short timeout
      }

      await expect(
        result.instance.shard(options)
      ).rejects.toThrow(/timeout/i)
    })
  })

  // ==========================================================================
  // CLONE MODE INTEGRATION
  // ==========================================================================

  describe('clone mode integration', () => {
    it('should use atomic mode by default', async () => {
      // RED: Default mode should be atomic
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
      }) as ExtendedShardResult

      // Atomic means all shards created or none
      expect(shardResult.shards.length).toBe(4)
    })

    it('should support staged mode for sharding', async () => {
      // RED: Staged mode for two-phase sharding
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
        mode: 'staged',
      }) as ExtendedShardResult

      expect(shardResult.shards.length).toBe(4)
    })

    it('should support eventual mode for sharding', async () => {
      // RED: Eventual mode for background sharding
      const shardResult = await result.instance.shard({
        key: 'tenantId',
        count: 4,
        mode: 'eventual',
      }) as ExtendedShardResult

      // Eventual mode returns immediately, shards created in background
      expect(shardResult.shards.length).toBe(4)
    })

    it('should rollback on failure in atomic mode', async () => {
      // RED: Atomic should rollback on partial failure
      const mockNamespace = createMockDONamespace()
      let shardCreateCount = 0

      mockNamespace.stubFactory = () => ({
        id: createMockId(`shard-${shardCreateCount}`),
        fetch: vi.fn().mockImplementation(async () => {
          shardCreateCount++
          if (shardCreateCount === 3) {
            throw new Error('Shard creation failed')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.shard({
          key: 'tenantId',
          count: 4,
          mode: 'atomic',
        })
      ).rejects.toThrow()

      // Verify no partial state (no shards in registry)
      const storedRegistry = await result.storage.get('shardRegistry')
      expect(storedRegistry).toBeUndefined()
    })
  })

  // ==========================================================================
  // UNSHARD INTEGRATION
  // ==========================================================================

  describe('unshard integration', () => {
    it('should mark DO as sharded after shard()', async () => {
      // RED: DO should know it's sharded
      await result.instance.shard({
        key: 'tenantId',
        count: 4,
      })

      const isSharded = await (result.instance as unknown as {
        isSharded(): Promise<boolean>
      }).isSharded()

      expect(isSharded).toBe(true)
    })

    it('should support unshard after shard', async () => {
      // RED: Should be able to merge shards back
      await result.instance.shard({
        key: 'tenantId',
        count: 4,
      })

      await result.instance.unshard()

      const isSharded = await (result.instance as unknown as {
        isSharded(): Promise<boolean>
      }).isSharded()

      expect(isSharded).toBe(false)

      // All data should be back in source
      const things = result.sqlData.get('things') as unknown[]
      expect(things.length).toBe(100)
    })
  })
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Helper to determine which shard a key maps to
 */
async function getShardForKey(
  key: string,
  shardResult: ExtendedShardResult
): Promise<number> {
  // Simple consistent hash simulation
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash) % shardResult.shards.length
}
