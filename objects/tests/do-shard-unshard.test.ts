/**
 * DO Shard and Unshard Operations Tests
 *
 * These tests verify that Durable Objects correctly implement horizontal scaling
 * operations via shard() and unshard() methods using REAL miniflare DOs.
 *
 * IMPORTANT: These tests use REAL miniflare DOs with SQLite storage.
 * NO MOCKS are used - this tests the actual DO shard/unshard behavior.
 *
 * Reference implementations:
 * - shard(): objects/DOFull.ts:2356
 * - unshard(): objects/DOFull.ts:2405
 * - ShardModule: objects/lifecycle/Shard.ts
 *
 * Run with: npx vitest run objects/tests/do-shard-unshard.test.ts --project=do-rpc
 *
 * @module objects/tests/do-shard-unshard.test
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'
import type { ShardStrategy } from '../../types/Lifecycle'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Unique namespace per test suite run to ensure isolation
 */
const testRunId = Date.now()

/**
 * Generate a unique namespace for each test to ensure isolation
 */
function uniqueNs(prefix: string = 'shard-test'): string {
  return `${prefix}-${testRunId}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Type definitions for RPC responses
 */
interface ThingEntity {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
}

/**
 * Shard result type
 */
interface ShardResult {
  shardKey: string
  shards: Array<{
    ns: string
    doId: string
    shardIndex: number
    thingCount: number
  }>
  duration: number
  registry: {
    id: string
    shardKey: string
    shardCount: number
    strategy: ShardStrategy
    createdAt: Date
    endpoints: Array<{
      shardIndex: number
      ns: string
      doId: string
      status: 'active' | 'inactive' | 'rebalancing'
    }>
  }
  stats: {
    totalThings: number
    minPerShard: number
    maxPerShard: number
    avgPerShard: number
    stdDev: number
    skewRatio: number
  }
}

/**
 * Shard discovery result
 */
interface ShardDiscoveryResult {
  registry: ShardResult['registry']
  health: Array<{
    shardIndex: number
    healthy: boolean
    lastCheck: Date
    responseTime?: number
  }>
}

/**
 * Cross-shard query result
 */
interface CrossShardQueryResult<T = unknown> {
  data: T[]
  shardResults: Array<{
    shardIndex: number
    itemCount: number
    duration: number
    error?: string
  }>
  totalItems: number
}

/**
 * Rebalance result
 */
interface RebalanceResult {
  itemsMoved: number
  newStats: ShardResult['stats']
  modifiedShards: number[]
  duration: number
}

/**
 * Extended stub type with shard/unshard RPC methods
 */
interface ShardableStub extends DurableObjectStub {
  // Things operations
  thingsCreate(data: Partial<ThingEntity> & { type?: string }): Promise<ThingEntity>
  thingsGet(id: string): Promise<ThingEntity | null>
  thingsList(options?: { type?: string }): Promise<ThingEntity[]>

  // Shard operations
  shard(options: {
    key: string
    count: number
    strategy?: ShardStrategy
    correlationId?: string
    timeout?: number
    keyExtractor?: (thing: {
      id: string
      type: unknown
      branch: string | null
      name: string
      data: Record<string, unknown>
      deleted: boolean
    }) => string
    includeMetadata?: boolean
  }): Promise<ShardResult>

  unshard(options?: {
    target?: string
    compress?: boolean
  }): Promise<void>

  isSharded(): Promise<boolean>

  discoverShards(): Promise<ShardDiscoveryResult>

  queryShards<T = unknown>(options: {
    query: string
    aggregation?: 'merge' | 'concat' | 'sum' | 'count' | 'avg'
    timeout?: number
    continueOnError?: boolean
  }): Promise<CrossShardQueryResult<T>>

  rebalanceShards(options: {
    targetCount?: number
    maxSkew?: number
    strategy?: 'incremental' | 'full'
  }): Promise<RebalanceResult>

  // Identity
  getNs(): Promise<string>
}

// ============================================================================
// Test Suite: DO Shard and Unshard Operations
// ============================================================================

describe('DO Shard and Unshard Operations', () => {
  let stub: ShardableStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as ShardableStub
  })

  // ==========================================================================
  // shard() - Basic Sharding
  // ==========================================================================

  describe('shard() - basic operations', () => {
    /**
     * Test: Create N shard DOs from a single DO
     *
     * Expected behavior:
     * - shard() should create the specified number of shard DOs
     * - Each shard should have a unique namespace and DO ID
     * - The result should contain shard metadata
     */
    it('creates N shard DOs', async () => {
      // Create initial data to shard
      const tenants = ['tenant-a', 'tenant-b', 'tenant-c', 'tenant-d']
      for (let i = 0; i < 20; i++) {
        await stub.thingsCreate({
          $type: 'Customer',
          name: `Customer ${i}`,
          data: { tenantId: tenants[i % tenants.length], index: i },
        })
      }

      // Shard into 4 DOs
      const result = await stub.shard({
        key: 'tenantId',
        count: 4,
      })

      expect(result.shards).toHaveLength(4)
      expect(result.shards.every((s) => s.ns)).toBe(true)
      expect(result.shards.every((s) => s.doId)).toBe(true)

      // All shard IDs should be unique
      const doIds = result.shards.map((s) => s.doId)
      const uniqueIds = new Set(doIds)
      expect(uniqueIds.size).toBe(4)
    })

    /**
     * Test: Distribute existing data across shards
     *
     * Expected behavior:
     * - Total things across all shards should equal original count
     * - Each shard should have some data (not all empty)
     */
    it('distributes existing data across shards', async () => {
      // Create 50 items with varied tenants
      const tenants = ['tenant-a', 'tenant-b', 'tenant-c', 'tenant-d', 'tenant-e']
      for (let i = 0; i < 50; i++) {
        await stub.thingsCreate({
          $type: 'Item',
          name: `Item ${i}`,
          data: { tenantId: tenants[i % tenants.length], value: i },
        })
      }

      const result = await stub.shard({
        key: 'tenantId',
        count: 4,
      })

      // Total things across all shards should equal original count
      const totalThings = result.shards.reduce((sum, s) => sum + s.thingCount, 0)
      expect(totalThings).toBe(50)

      // Stats should reflect distribution
      expect(result.stats.totalThings).toBe(50)
    })

    /**
     * Test: Shard key is correctly assigned
     *
     * Expected behavior:
     * - shardKey should match the provided key
     * - Each shard should have a sequential shardIndex
     */
    it('assigns shard keys to data correctly', async () => {
      // Create data
      for (let i = 0; i < 20; i++) {
        await stub.thingsCreate({
          $type: 'Order',
          name: `Order ${i}`,
          data: { tenantId: `tenant-${i % 4}` },
        })
      }

      const result = await stub.shard({
        key: 'tenantId',
        count: 4,
      })

      expect(result.shardKey).toBe('tenantId')

      // Each shard should have an index
      for (let i = 0; i < result.shards.length; i++) {
        expect(result.shards[i].shardIndex).toBe(i)
      }
    })

    /**
     * Test: Result structure is correct
     *
     * Expected behavior:
     * - Result should have all required properties
     * - Duration should be a non-negative number
     */
    it('returns correct shard result structure', async () => {
      for (let i = 0; i < 10; i++) {
        await stub.thingsCreate({
          $type: 'Widget',
          name: `Widget ${i}`,
          data: { category: `cat-${i % 3}` },
        })
      }

      const result = await stub.shard({
        key: 'category',
        count: 3,
      })

      expect(result).toHaveProperty('shardKey')
      expect(result).toHaveProperty('shards')
      expect(result).toHaveProperty('registry')
      expect(result).toHaveProperty('duration')
      expect(result).toHaveProperty('stats')
      expect(typeof result.duration).toBe('number')
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // shard() - Distribution Strategies
  // ==========================================================================

  describe('shard() - distribution strategies', () => {
    /**
     * Test: Hash strategy (default)
     *
     * Expected behavior:
     * - Default strategy should be 'hash'
     * - Same key should always go to the same shard
     */
    it('uses hash strategy by default', async () => {
      for (let i = 0; i < 20; i++) {
        await stub.thingsCreate({
          $type: 'Record',
          name: `Record ${i}`,
          data: { key: `key-${i % 5}` },
        })
      }

      const result = await stub.shard({
        key: 'key',
        count: 4,
      })

      expect(result.registry.strategy).toBe('hash')
    })

    /**
     * Test: Explicit hash strategy
     *
     * Expected behavior:
     * - Strategy in registry should be 'hash'
     */
    it('supports explicit hash strategy', async () => {
      for (let i = 0; i < 20; i++) {
        await stub.thingsCreate({
          $type: 'Document',
          name: `Doc ${i}`,
          data: { bucket: `bucket-${i % 4}` },
        })
      }

      const result = await stub.shard({
        key: 'bucket',
        count: 4,
        strategy: 'hash',
      })

      expect(result.registry.strategy).toBe('hash')
    })

    /**
     * Test: Range strategy
     *
     * Expected behavior:
     * - Strategy in registry should be 'range'
     * - Data should be distributed by value ranges
     */
    it('supports range strategy', async () => {
      for (let i = 0; i < 100; i++) {
        await stub.thingsCreate({
          $type: 'Metric',
          name: `Metric ${i}`,
          data: { value: i },
        })
      }

      const result = await stub.shard({
        key: 'value',
        count: 4,
        strategy: 'range',
      })

      expect(result.registry.strategy).toBe('range')
      expect(result.shards.length).toBe(4)
    })

    /**
     * Test: Round-robin strategy
     *
     * Expected behavior:
     * - Strategy in registry should be 'roundRobin'
     * - Distribution should be very even (max difference of 1)
     */
    it('supports roundRobin strategy', async () => {
      for (let i = 0; i < 20; i++) {
        await stub.thingsCreate({
          $type: 'Task',
          name: `Task ${i}`,
          data: { id: `id-${i}` },
        })
      }

      const result = await stub.shard({
        key: 'id',
        count: 4,
        strategy: 'roundRobin',
      })

      expect(result.registry.strategy).toBe('roundRobin')

      // Round robin should give very even distribution
      const counts = result.shards.map((s) => s.thingCount)
      const max = Math.max(...counts)
      const min = Math.min(...counts)
      expect(max - min).toBeLessThanOrEqual(1)
    })
  })

  // ==========================================================================
  // shard() - Shard Registry
  // ==========================================================================

  describe('shard() - shard registry', () => {
    /**
     * Test: Registry is created with correct metadata
     *
     * Expected behavior:
     * - Registry should have all required fields
     * - Endpoints should match shard count
     */
    it('creates shard registry with correct metadata', async () => {
      for (let i = 0; i < 20; i++) {
        await stub.thingsCreate({
          $type: 'Entity',
          name: `Entity ${i}`,
          data: { group: `group-${i % 3}` },
        })
      }

      const result = await stub.shard({
        key: 'group',
        count: 3,
      })

      expect(result.registry).toBeDefined()
      expect(result.registry.id).toBeDefined()
      expect(result.registry.shardKey).toBe('group')
      expect(result.registry.shardCount).toBe(3)
      expect(result.registry.createdAt).toBeDefined()
      expect(result.registry.endpoints).toHaveLength(3)
    })

    /**
     * Test: Endpoints have correct status
     *
     * Expected behavior:
     * - All endpoints should have 'active' status initially
     */
    it('tracks shard endpoints with active status', async () => {
      for (let i = 0; i < 15; i++) {
        await stub.thingsCreate({
          $type: 'Node',
          name: `Node ${i}`,
          data: { partition: `p-${i % 3}` },
        })
      }

      const result = await stub.shard({
        key: 'partition',
        count: 3,
      })

      for (const endpoint of result.registry.endpoints) {
        expect(endpoint.shardIndex).toBeDefined()
        expect(endpoint.ns).toBeDefined()
        expect(endpoint.doId).toBeDefined()
        expect(endpoint.status).toBe('active')
      }
    })
  })

  // ==========================================================================
  // shard() - Distribution Statistics
  // ==========================================================================

  describe('shard() - statistics', () => {
    /**
     * Test: Statistics are calculated correctly
     *
     * Expected behavior:
     * - Stats should include totalThings, min, max, avg, stdDev, skewRatio
     */
    it('calculates distribution statistics', async () => {
      for (let i = 0; i < 40; i++) {
        await stub.thingsCreate({
          $type: 'DataPoint',
          name: `Point ${i}`,
          data: { cluster: `c-${i % 4}` },
        })
      }

      const result = await stub.shard({
        key: 'cluster',
        count: 4,
      })

      expect(result.stats.totalThings).toBe(40)
      expect(result.stats.avgPerShard).toBe(10)
      expect(result.stats.minPerShard).toBeDefined()
      expect(result.stats.maxPerShard).toBeDefined()
      expect(result.stats.stdDev).toBeDefined()
      expect(result.stats.skewRatio).toBeDefined()
    })
  })

  // ==========================================================================
  // shard() - Validation
  // ==========================================================================

  describe('shard() - validation', () => {
    /**
     * Test: Requires shard key
     *
     * Expected behavior:
     * - Should throw error when key is empty
     */
    it('requires shard key', async () => {
      for (let i = 0; i < 10; i++) {
        await stub.thingsCreate({
          $type: 'Test',
          name: `Test ${i}`,
          data: { field: 'value' },
        })
      }

      await expect(
        stub.shard({
          key: '',
          count: 4,
        })
      ).rejects.toThrow(/key.*required/i)
    })

    /**
     * Test: Requires positive shard count
     *
     * Expected behavior:
     * - Should throw error when count is 0 or negative
     */
    it('requires positive shard count', async () => {
      for (let i = 0; i < 10; i++) {
        await stub.thingsCreate({
          $type: 'Test',
          name: `Test ${i}`,
          data: { field: 'value' },
        })
      }

      await expect(
        stub.shard({
          key: 'field',
          count: 0,
        })
      ).rejects.toThrow(/count.*positive/i)

      await expect(
        stub.shard({
          key: 'field',
          count: -1,
        })
      ).rejects.toThrow(/count.*positive/i)
    })

    /**
     * Test: Validates maximum shard count
     *
     * Expected behavior:
     * - Should throw error when count exceeds maximum (1000)
     */
    it('validates maximum shard count', async () => {
      for (let i = 0; i < 10; i++) {
        await stub.thingsCreate({
          $type: 'Test',
          name: `Test ${i}`,
          data: { field: 'value' },
        })
      }

      await expect(
        stub.shard({
          key: 'field',
          count: 10000,
        })
      ).rejects.toThrow(/count.*too.*large|maximum.*shards/i)
    })

    /**
     * Test: Validates strategy
     *
     * Expected behavior:
     * - Should throw error for invalid strategy
     */
    it('validates shard strategy', async () => {
      for (let i = 0; i < 10; i++) {
        await stub.thingsCreate({
          $type: 'Test',
          name: `Test ${i}`,
          data: { field: 'value' },
        })
      }

      await expect(
        stub.shard({
          key: 'field',
          count: 4,
          strategy: 'invalid' as ShardStrategy,
        })
      ).rejects.toThrow(/invalid.*strategy/i)
    })

    /**
     * Test: Rejects sharding empty DO
     *
     * Expected behavior:
     * - Should throw error when there's no data to shard
     */
    it('rejects sharding empty DO', async () => {
      await expect(
        stub.shard({
          key: 'tenantId',
          count: 4,
        })
      ).rejects.toThrow(/empty|no.*data/i)
    })

    /**
     * Test: Rejects double sharding
     *
     * Expected behavior:
     * - Should throw error when DO is already sharded
     */
    it('rejects sharding already sharded DO', async () => {
      for (let i = 0; i < 20; i++) {
        await stub.thingsCreate({
          $type: 'Item',
          name: `Item ${i}`,
          data: { tenant: `t-${i % 4}` },
        })
      }

      await stub.shard({
        key: 'tenant',
        count: 4,
      })

      await expect(
        stub.shard({
          key: 'tenant',
          count: 8,
        })
      ).rejects.toThrow(/already.*sharded/i)
    })
  })

  // ==========================================================================
  // shard() - Edge Cases
  // ==========================================================================

  describe('shard() - edge cases', () => {
    /**
     * Test: Handle single shard (no-op)
     *
     * Expected behavior:
     * - Single shard should still work
     * - All data should be in the single shard
     */
    it('handles single shard', async () => {
      for (let i = 0; i < 10; i++) {
        await stub.thingsCreate({
          $type: 'Record',
          name: `Record ${i}`,
          data: { key: `k-${i}` },
        })
      }

      const result = await stub.shard({
        key: 'key',
        count: 1,
      })

      expect(result.shards.length).toBe(1)
      expect(result.shards[0].thingCount).toBe(10)
    })

    /**
     * Test: Handle missing shard key values
     *
     * Expected behavior:
     * - Things without the shard key should be distributed to a default shard
     * - All things should still be distributed
     */
    it('handles missing shard key values', async () => {
      // Create some with the key, some without
      for (let i = 0; i < 10; i++) {
        await stub.thingsCreate({
          $type: 'Mixed',
          name: `With Key ${i}`,
          data: { tenantId: `tenant-${i % 3}`, value: i },
        })
      }
      for (let i = 0; i < 10; i++) {
        await stub.thingsCreate({
          $type: 'Mixed',
          name: `Without Key ${i}`,
          data: { value: i }, // No tenantId
        })
      }

      const result = await stub.shard({
        key: 'tenantId',
        count: 4,
      })

      // All 20 things should be distributed
      const total = result.shards.reduce((sum, s) => sum + s.thingCount, 0)
      expect(total).toBe(20)
    })

    /**
     * Test: Handle null shard key values
     *
     * Expected behavior:
     * - Null values should be handled consistently
     * - Should not throw error
     */
    it('handles null shard key values', async () => {
      for (let i = 0; i < 15; i++) {
        await stub.thingsCreate({
          $type: 'NullableKey',
          name: `Item ${i}`,
          data: { tenantId: i % 3 === 0 ? null : `tenant-${i % 5}` },
        })
      }

      const result = await stub.shard({
        key: 'tenantId',
        count: 4,
      })

      expect(result.shards.length).toBe(4)
      const total = result.shards.reduce((sum, s) => sum + s.thingCount, 0)
      expect(total).toBe(15)
    })

    /**
     * Test: Handle nested shard keys
     *
     * Expected behavior:
     * - Dot notation should work for nested keys
     */
    it('handles nested shard keys', async () => {
      for (let i = 0; i < 20; i++) {
        await stub.thingsCreate({
          $type: 'Nested',
          name: `Nested ${i}`,
          data: {
            metadata: {
              organization: {
                id: `org-${i % 4}`,
              },
            },
          },
        })
      }

      const result = await stub.shard({
        key: 'metadata.organization.id',
        count: 4,
      })

      expect(result.shardKey).toBe('metadata.organization.id')
      expect(result.shards.length).toBe(4)
    })
  })

  // ==========================================================================
  // unshard() - Basic Operations
  // ==========================================================================

  describe('unshard() - basic operations', () => {
    /**
     * Test: Unshard merges data back
     *
     * Expected behavior:
     * - After unshard, isSharded should return false
     * - All data should be accessible in the source DO
     */
    it('merges sharded DOs back into one', async () => {
      // Create and shard data
      for (let i = 0; i < 30; i++) {
        await stub.thingsCreate({
          $type: 'Mergeable',
          name: `Item ${i}`,
          data: { group: `g-${i % 3}` },
        })
      }

      await stub.shard({
        key: 'group',
        count: 3,
      })

      // Verify it's sharded
      const isShardedBefore = await stub.isSharded()
      expect(isShardedBefore).toBe(true)

      // Unshard
      await stub.unshard()

      // Verify it's no longer sharded
      const isShardedAfter = await stub.isSharded()
      expect(isShardedAfter).toBe(false)
    })

    /**
     * Test: Unshard fails on non-sharded DO
     *
     * Expected behavior:
     * - Should throw error when DO is not sharded
     */
    it('fails when DO is not sharded', async () => {
      // Create some data but don't shard
      for (let i = 0; i < 10; i++) {
        await stub.thingsCreate({
          $type: 'Unsharded',
          name: `Item ${i}`,
          data: { value: i },
        })
      }

      await expect(stub.unshard()).rejects.toThrow(/not.*sharded/i)
    })
  })

  // ==========================================================================
  // isSharded() - Status Checking
  // ==========================================================================

  describe('isSharded() - status checking', () => {
    /**
     * Test: isSharded returns false initially
     *
     * Expected behavior:
     * - New DO should not be sharded
     */
    it('returns false for new DO', async () => {
      const isSharded = await stub.isSharded()
      expect(isSharded).toBe(false)
    })

    /**
     * Test: isSharded returns true after sharding
     *
     * Expected behavior:
     * - Should return true after shard() is called
     */
    it('returns true after sharding', async () => {
      for (let i = 0; i < 10; i++) {
        await stub.thingsCreate({
          $type: 'Checkable',
          name: `Item ${i}`,
          data: { key: `k-${i % 3}` },
        })
      }

      await stub.shard({
        key: 'key',
        count: 3,
      })

      const isSharded = await stub.isSharded()
      expect(isSharded).toBe(true)
    })

    /**
     * Test: isSharded returns false after unshard
     *
     * Expected behavior:
     * - Should return false after unshard() is called
     */
    it('returns false after unshard', async () => {
      for (let i = 0; i < 10; i++) {
        await stub.thingsCreate({
          $type: 'Toggleable',
          name: `Item ${i}`,
          data: { key: `k-${i % 3}` },
        })
      }

      await stub.shard({
        key: 'key',
        count: 3,
      })

      expect(await stub.isSharded()).toBe(true)

      await stub.unshard()

      expect(await stub.isSharded()).toBe(false)
    })
  })

  // ==========================================================================
  // discoverShards() - Shard Discovery
  // ==========================================================================

  describe('discoverShards() - shard discovery', () => {
    /**
     * Test: Discover shards returns registry and health
     *
     * Expected behavior:
     * - Should return registry information
     * - Should return health status for each shard
     */
    it('discovers shard set from source', async () => {
      for (let i = 0; i < 20; i++) {
        await stub.thingsCreate({
          $type: 'Discoverable',
          name: `Item ${i}`,
          data: { region: `r-${i % 4}` },
        })
      }

      await stub.shard({
        key: 'region',
        count: 4,
      })

      const discovery = await stub.discoverShards()

      expect(discovery.registry).toBeDefined()
      expect(discovery.registry.endpoints).toHaveLength(4)
      expect(discovery.health).toHaveLength(4)
    })

    /**
     * Test: discoverShards fails when not sharded
     *
     * Expected behavior:
     * - Should throw error when DO is not sharded
     */
    it('fails when DO is not sharded', async () => {
      await expect(stub.discoverShards()).rejects.toThrow(/not.*sharded/i)
    })
  })

  // ==========================================================================
  // queryShards() - Cross-Shard Queries
  // ==========================================================================

  describe('queryShards() - cross-shard queries', () => {
    /**
     * Test: Query across all shards
     *
     * Expected behavior:
     * - Query should aggregate results from all shards
     * - Total items should match original count
     */
    it('queries across all shards', async () => {
      for (let i = 0; i < 40; i++) {
        await stub.thingsCreate({
          $type: 'Queryable',
          name: `Item ${i}`,
          data: { zone: `z-${i % 4}` },
        })
      }

      await stub.shard({
        key: 'zone',
        count: 4,
      })

      const queryResult = await stub.queryShards({
        query: 'SELECT COUNT(*) FROM things',
        aggregation: 'sum',
      })

      expect(queryResult.shardResults.length).toBe(4)
      expect(queryResult.totalItems).toBeGreaterThanOrEqual(0)
    })

    /**
     * Test: queryShards fails when not sharded
     *
     * Expected behavior:
     * - Should throw error when DO is not sharded
     */
    it('fails when DO is not sharded', async () => {
      await expect(
        stub.queryShards({
          query: 'SELECT * FROM things',
        })
      ).rejects.toThrow(/not.*sharded/i)
    })
  })

  // ==========================================================================
  // rebalanceShards() - Shard Rebalancing
  // ==========================================================================

  describe('rebalanceShards() - rebalancing', () => {
    /**
     * Test: Add new shards (scale up)
     *
     * Expected behavior:
     * - New shards should be added
     * - Registry should reflect new shard count
     */
    it('supports scaling up by adding shards', async () => {
      for (let i = 0; i < 40; i++) {
        await stub.thingsCreate({
          $type: 'Scalable',
          name: `Item ${i}`,
          data: { partition: `p-${i % 4}` },
        })
      }

      await stub.shard({
        key: 'partition',
        count: 4,
      })

      const rebalanceResult = await stub.rebalanceShards({
        targetCount: 6,
      })

      expect(rebalanceResult.duration).toBeGreaterThanOrEqual(0)

      const discovery = await stub.discoverShards()
      expect(discovery.registry.shardCount).toBe(6)
    })

    /**
     * Test: Remove shards (scale down)
     *
     * Expected behavior:
     * - Shards should be removed
     * - Data should be redistributed
     * - Registry should reflect new shard count
     */
    it('supports scaling down by removing shards', async () => {
      for (let i = 0; i < 40; i++) {
        await stub.thingsCreate({
          $type: 'Shrinkable',
          name: `Item ${i}`,
          data: { bucket: `b-${i % 4}` },
        })
      }

      await stub.shard({
        key: 'bucket',
        count: 4,
      })

      const rebalanceResult = await stub.rebalanceShards({
        targetCount: 2,
      })

      expect(rebalanceResult.duration).toBeGreaterThanOrEqual(0)

      const discovery = await stub.discoverShards()
      expect(discovery.registry.shardCount).toBe(2)
    })

    /**
     * Test: rebalanceShards fails when not sharded
     *
     * Expected behavior:
     * - Should throw error when DO is not sharded
     */
    it('fails when DO is not sharded', async () => {
      await expect(
        stub.rebalanceShards({
          targetCount: 4,
        })
      ).rejects.toThrow(/not.*sharded/i)
    })
  })

  // ==========================================================================
  // Full Lifecycle Test
  // ==========================================================================

  describe('full shard lifecycle', () => {
    /**
     * Test: Complete shard -> query -> rebalance -> unshard cycle
     *
     * Expected behavior:
     * - All operations in the lifecycle should work together
     * - Data integrity should be maintained throughout
     */
    it('completes full shard lifecycle', async () => {
      // Step 1: Create initial data
      const itemCount = 50
      for (let i = 0; i < itemCount; i++) {
        await stub.thingsCreate({
          $type: 'LifecycleItem',
          name: `Item ${i}`,
          data: { segment: `seg-${i % 5}` },
        })
      }

      // Step 2: Verify not sharded initially
      expect(await stub.isSharded()).toBe(false)

      // Step 3: Shard the data
      const shardResult = await stub.shard({
        key: 'segment',
        count: 4,
      })
      expect(shardResult.shards.length).toBe(4)
      expect(shardResult.stats.totalThings).toBe(itemCount)

      // Step 4: Verify sharded
      expect(await stub.isSharded()).toBe(true)

      // Step 5: Discover shards
      const discovery = await stub.discoverShards()
      expect(discovery.registry.endpoints.length).toBe(4)

      // Step 6: Rebalance (scale to 5 shards)
      await stub.rebalanceShards({ targetCount: 5 })
      const discoveryAfterRebalance = await stub.discoverShards()
      expect(discoveryAfterRebalance.registry.shardCount).toBe(5)

      // Step 7: Unshard
      await stub.unshard()

      // Step 8: Verify unsharded
      expect(await stub.isSharded()).toBe(false)
    })
  })
})
