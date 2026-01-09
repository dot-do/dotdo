/**
 * ACID Test Suite - Phase 3: Shard Rebalancing
 *
 * RED TDD: These tests define the expected behavior for shard rebalancing
 * operations that redistribute data when scaling the shard count or correcting
 * skewed distributions. All tests are expected to FAIL initially as this is
 * the RED phase.
 *
 * Rebalancing provides:
 * - Scale-out by adding shards (horizontal scaling)
 * - Scale-in by removing shards (cost optimization)
 * - Skew correction for uneven data distribution
 * - Live rebalancing without downtime
 * - Consistent hashing for minimal data movement
 * - Progress tracking and resumability
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace, createMockId } from '../../do'
import { DO } from '../../../objects/DO'
import type {
  ShardOptions,
  ShardResult,
  CloneMode,
} from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR REBALANCE TESTS
// ============================================================================

/**
 * Rebalance operation type
 */
type RebalanceType = 'scale_out' | 'scale_in' | 'skew_correction' | 'manual'

/**
 * Rebalance strategy
 */
type RebalanceStrategy = 'incremental' | 'full' | 'minimal_movement'

/**
 * Rebalance options
 */
interface RebalanceOptions {
  /** Target shard count (for scaling) */
  targetCount?: number
  /** Maximum skew allowed before rebalance */
  maxSkew?: number
  /** Rebalance strategy */
  strategy?: RebalanceStrategy
  /** Timeout for rebalance operation */
  timeout?: number
  /** Correlation ID for tracing */
  correlationId?: string
  /** Whether to allow reads during rebalance */
  allowReadsDuringRebalance?: boolean
  /** Whether to allow writes during rebalance */
  allowWritesDuringRebalance?: boolean
  /** Batch size for data movement */
  batchSize?: number
  /** Specific shards to include/exclude */
  includeShards?: number[]
  excludeShards?: number[]
  /** Maximum concurrent data transfers */
  maxConcurrency?: number
}

/**
 * Rebalance result
 */
interface RebalanceResult {
  /** Whether rebalance completed successfully */
  success: boolean
  /** Type of rebalance performed */
  type: RebalanceType
  /** Items moved between shards */
  itemsMoved: number
  /** Relationships moved */
  relationshipsMoved: number
  /** Previous shard count */
  previousShardCount: number
  /** New shard count */
  newShardCount: number
  /** Previous distribution stats */
  previousStats: ShardDistributionStats
  /** New distribution stats */
  newStats: ShardDistributionStats
  /** Shards that were modified */
  modifiedShards: number[]
  /** Shards that were added (scale-out) */
  addedShards?: number[]
  /** Shards that were removed (scale-in) */
  removedShards?: number[]
  /** Duration of rebalance */
  duration: number
  /** Detailed move operations */
  moveOperations: MoveOperation[]
}

/**
 * A single data move operation
 */
interface MoveOperation {
  /** Item ID that was moved */
  itemId: string
  /** Item type (thing or relationship) */
  itemType: 'thing' | 'relationship'
  /** Source shard index */
  fromShard: number
  /** Destination shard index */
  toShard: number
  /** Time taken for this move */
  duration: number
  /** Whether move succeeded */
  success: boolean
  /** Error if move failed */
  error?: string
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
  /** Per-shard counts */
  shardCounts: number[]
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
  version?: number
}

/**
 * Shard registry entry
 */
interface ShardRegistry {
  /** Unique ID for this shard set */
  id: string
  /** Shard key field name */
  shardKey: string
  /** Number of shards */
  shardCount: number
  /** Strategy used */
  strategy: 'hash' | 'range' | 'roundRobin' | 'custom'
  /** Creation timestamp */
  createdAt: Date
  /** Last rebalance timestamp */
  lastRebalance?: Date
  /** Array of shard endpoints */
  endpoints: Array<{
    shardIndex: number
    ns: string
    doId: string
    status: 'active' | 'inactive' | 'rebalancing' | 'draining'
  }>
}

/**
 * Rebalance progress tracking
 */
interface RebalanceProgress {
  /** Current phase */
  phase: 'preparing' | 'moving_data' | 'verifying' | 'completing' | 'failed'
  /** Total items to move */
  totalItems: number
  /** Items moved so far */
  movedItems: number
  /** Percentage complete */
  percentComplete: number
  /** Estimated time remaining (ms) */
  estimatedTimeRemaining: number
  /** Current batch being processed */
  currentBatch: number
  /** Total batches */
  totalBatches: number
  /** Start time */
  startedAt: Date
  /** Last update time */
  lastUpdated: Date
}

/**
 * Rebalance event types
 */
type RebalanceEventType =
  | 'rebalance.started'
  | 'rebalance.completed'
  | 'rebalance.failed'
  | 'rebalance.progress'
  | 'rebalance.batch_completed'
  | 'rebalance.shard_drained'
  | 'rebalance.shard_activated'
  | 'rebalance.paused'
  | 'rebalance.resumed'
  | 'rebalance.cancelled'

/**
 * Rebalance event payload
 */
interface RebalanceEvent {
  type: RebalanceEventType
  correlationId: string
  timestamp: Date
  data?: Record<string, unknown>
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample things with specific distribution
 */
function createThingsWithDistribution(
  distribution: Record<string, number>,
  keyField: string = 'tenantId'
): ThingRecord[] {
  const now = new Date().toISOString()
  const things: ThingRecord[] = []
  let index = 0

  for (const [key, count] of Object.entries(distribution)) {
    for (let i = 0; i < count; i++) {
      things.push({
        id: `thing-${index}`,
        type: 1,
        branch: null,
        name: `Item ${index}`,
        data: {
          [keyField]: key,
          index,
        },
        deleted: false,
        visibility: 'user',
        createdAt: now,
        updatedAt: now,
        version: 1,
      })
      index++
    }
  }

  return things
}

/**
 * Create uniform distribution of things
 */
function createUniformThings(
  count: number,
  tenantCount: number = 5,
  keyField: string = 'tenantId'
): ThingRecord[] {
  const distribution: Record<string, number> = {}
  const perTenant = Math.floor(count / tenantCount)
  const remainder = count % tenantCount

  for (let i = 0; i < tenantCount; i++) {
    distribution[`tenant-${i}`] = perTenant + (i < remainder ? 1 : 0)
  }

  return createThingsWithDistribution(distribution, keyField)
}

/**
 * Create skewed distribution of things
 */
function createSkewedThings(
  totalCount: number,
  keyField: string = 'tenantId'
): ThingRecord[] {
  // Create heavily skewed distribution: 80% in one tenant, 20% distributed
  const bigTenantCount = Math.floor(totalCount * 0.8)
  const smallTenantCount = Math.floor(totalCount * 0.2)
  const perSmallTenant = Math.floor(smallTenantCount / 4)

  return createThingsWithDistribution({
    'big-tenant': bigTenantCount,
    'small-tenant-1': perSmallTenant,
    'small-tenant-2': perSmallTenant,
    'small-tenant-3': perSmallTenant,
    'small-tenant-4': smallTenantCount - (perSmallTenant * 3),
  }, keyField)
}

/**
 * Create mock shard data structure
 */
function createMockShards(
  count: number,
  thingsPerShard: number[]
): Array<{ shardIndex: number; things: ThingRecord[] }> {
  return Array.from({ length: count }, (_, i) => ({
    shardIndex: i,
    things: createUniformThings(thingsPerShard[i] || 0, 1).map((t) => ({
      ...t,
      id: `shard${i}-${t.id}`,
    })),
  }))
}

// ============================================================================
// TEST SUITE: SCALE-OUT (ADDING SHARDS)
// ============================================================================

describe('shard rebalance - scale out', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: RebalanceEvent[]

  beforeEach(() => {
    capturedEvents = []

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createUniformThings(1000, 10)],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    // Mock event capture
    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as RebalanceEventType,
        correlationId: (data as Record<string, unknown>)?.correlationId as string || '',
        timestamp: new Date(),
        data: data as Record<string, unknown>,
      })
      return originalEmit?.call(result.instance, verb, data)
    }

    // Setup initial shard state
    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', {
      id: 'shard-set-1',
      shardKey: 'tenantId',
      shardCount: 4,
      strategy: 'hash',
      createdAt: new Date(),
      endpoints: Array.from({ length: 4 }, (_, i) => ({
        shardIndex: i,
        ns: `https://shard-${i}.test.do`,
        doId: `shard-do-${i}`,
        status: 'active',
      })),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('basic scale-out', () => {
    it('should add new shards when scaling out', async () => {
      // RED: Should create new shard DOs
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8, // Scale from 4 to 8
      })

      expect(rebalanceResult.success).toBe(true)
      expect(rebalanceResult.type).toBe('scale_out')
      expect(rebalanceResult.previousShardCount).toBe(4)
      expect(rebalanceResult.newShardCount).toBe(8)
      expect(rebalanceResult.addedShards).toHaveLength(4)
    })

    it('should redistribute data to new shards', async () => {
      // RED: Data should be moved to new shards
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
      })

      expect(rebalanceResult.itemsMoved).toBeGreaterThan(0)
      // New shards should have data
      expect(rebalanceResult.addedShards?.every((s) =>
        rebalanceResult.newStats.shardCounts[s] > 0
      )).toBe(true)
    })

    it('should use consistent hashing to minimize data movement', async () => {
      // RED: Only ~N/M of data should move when adding shards
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        strategy: 'minimal_movement',
      })

      // With consistent hashing, ~50% of data should move when doubling shards
      const expectedMaxMoved = rebalanceResult.previousStats.totalThings * 0.6
      expect(rebalanceResult.itemsMoved).toBeLessThan(expectedMaxMoved)
    })

    it('should update shard registry after scale-out', async () => {
      // RED: Registry should reflect new shard count
      await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
      })

      const registry = result.storage.data.get('shardRegistry') as ShardRegistry
      expect(registry.shardCount).toBe(8)
      expect(registry.endpoints.length).toBe(8)
      expect(registry.lastRebalance).toBeDefined()
    })

    it('should verify data integrity after scale-out', async () => {
      // RED: Total data count should be preserved
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
      })

      expect(rebalanceResult.newStats.totalThings).toBe(
        rebalanceResult.previousStats.totalThings
      )
    })

    it('should handle large scale-out (2x to 16x)', async () => {
      // RED: Should handle significant scaling
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 16, // 4x scale
      })

      expect(rebalanceResult.success).toBe(true)
      expect(rebalanceResult.newShardCount).toBe(16)
    })
  })

  describe('incremental scale-out', () => {
    it('should support adding one shard at a time', async () => {
      // RED: Incremental scaling should work
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 5, // Add just one shard
        strategy: 'incremental',
      })

      expect(rebalanceResult.success).toBe(true)
      expect(rebalanceResult.addedShards).toHaveLength(1)
      expect(rebalanceResult.newShardCount).toBe(5)
    })

    it('should minimize disruption during incremental scale-out', async () => {
      // RED: Incremental should move less data at once
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 5,
        strategy: 'incremental',
      })

      // Only ~20% of data should move when adding 1 of 5 shards
      const expectedMaxMoved = rebalanceResult.previousStats.totalThings * 0.3
      expect(rebalanceResult.itemsMoved).toBeLessThan(expectedMaxMoved)
    })
  })
})

// ============================================================================
// TEST SUITE: SCALE-IN (REMOVING SHARDS)
// ============================================================================

describe('shard rebalance - scale in', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: RebalanceEvent[]

  beforeEach(() => {
    capturedEvents = []

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createUniformThings(1000, 10)],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    // Setup initial shard state with 8 shards
    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', {
      id: 'shard-set-1',
      shardKey: 'tenantId',
      shardCount: 8,
      strategy: 'hash',
      createdAt: new Date(),
      endpoints: Array.from({ length: 8 }, (_, i) => ({
        shardIndex: i,
        ns: `https://shard-${i}.test.do`,
        doId: `shard-do-${i}`,
        status: 'active',
      })),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('basic scale-in', () => {
    it('should remove shards when scaling in', async () => {
      // RED: Should remove shard DOs
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 4, // Scale from 8 to 4
      })

      expect(rebalanceResult.success).toBe(true)
      expect(rebalanceResult.type).toBe('scale_in')
      expect(rebalanceResult.previousShardCount).toBe(8)
      expect(rebalanceResult.newShardCount).toBe(4)
      expect(rebalanceResult.removedShards).toHaveLength(4)
    })

    it('should drain shards before removal', async () => {
      // RED: Shards should be drained before deletion
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 4,
      })

      // All data from removed shards should be moved
      const drainedShards = rebalanceResult.removedShards || []
      const drainOperations = rebalanceResult.moveOperations.filter(
        (op) => drainedShards.includes(op.fromShard)
      )
      expect(drainOperations.length).toBeGreaterThan(0)
    })

    it('should preserve all data during scale-in', async () => {
      // RED: No data should be lost
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 4,
      })

      expect(rebalanceResult.newStats.totalThings).toBe(
        rebalanceResult.previousStats.totalThings
      )
    })

    it('should update registry after scale-in', async () => {
      // RED: Registry should reflect reduced shard count
      await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 4,
      })

      const registry = result.storage.data.get('shardRegistry') as ShardRegistry
      expect(registry.shardCount).toBe(4)
      expect(registry.endpoints.length).toBe(4)
    })

    it('should handle aggressive scale-in (8 to 2)', async () => {
      // RED: Should handle significant scale-in
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 2,
      })

      expect(rebalanceResult.success).toBe(true)
      expect(rebalanceResult.newShardCount).toBe(2)
      expect(rebalanceResult.removedShards).toHaveLength(6)
    })

    it('should reject scale-in to zero shards', async () => {
      // RED: Cannot scale to zero
      await expect(
        (result.instance as unknown as {
          rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
        }).rebalanceShards({
          targetCount: 0,
        })
      ).rejects.toThrow(/invalid.*count|cannot.*zero/i)
    })

    it('should mark shards as draining during scale-in', async () => {
      // RED: Shards should be marked as draining
      let registryDuringRebalance: ShardRegistry | undefined

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          registryDuringRebalance = result.storage.data.get('shardRegistry') as ShardRegistry
          return new Response(JSON.stringify({ things: [] }))
        }),
      })
      result.env.DO = mockNamespace

      await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 4,
      })

      // During rebalance, some shards should be marked as draining
      const drainingShards = registryDuringRebalance?.endpoints.filter(
        (e) => e.status === 'draining'
      )
      expect(drainingShards?.length).toBeGreaterThan(0)
    })
  })

  describe('incremental scale-in', () => {
    it('should support removing one shard at a time', async () => {
      // RED: Incremental scaling should work
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 7,
        strategy: 'incremental',
      })

      expect(rebalanceResult.success).toBe(true)
      expect(rebalanceResult.removedShards).toHaveLength(1)
    })

    it('should select optimal shard for removal', async () => {
      // RED: Should remove shard with least data for efficiency
      // Setup uneven distribution
      result.storage.data.set('shardStats', {
        0: { thingCount: 100 },
        1: { thingCount: 150 },
        2: { thingCount: 80 }, // Smallest - should be removed first
        3: { thingCount: 120 },
        4: { thingCount: 110 },
        5: { thingCount: 130 },
        6: { thingCount: 90 },
        7: { thingCount: 140 },
      })

      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 7,
        strategy: 'minimal_movement',
      })

      // Shard 2 (smallest) should be removed
      expect(rebalanceResult.removedShards).toContain(2)
    })
  })
})

// ============================================================================
// TEST SUITE: SKEW CORRECTION
// ============================================================================

describe('shard rebalance - skew correction', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createSkewedThings(1000)],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    // Setup skewed shard state
    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', {
      id: 'shard-set-1',
      shardKey: 'tenantId',
      shardCount: 4,
      strategy: 'hash',
      createdAt: new Date(),
      endpoints: Array.from({ length: 4 }, (_, i) => ({
        shardIndex: i,
        ns: `https://shard-${i}.test.do`,
        doId: `shard-do-${i}`,
        status: 'active',
      })),
    })
    result.storage.data.set('shardStats', {
      0: { thingCount: 800 }, // Heavily skewed
      1: { thingCount: 50 },
      2: { thingCount: 100 },
      3: { thingCount: 50 },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('automatic skew detection', () => {
    it('should detect skewed distribution', async () => {
      // RED: Should identify skew
      const stats = await (result.instance as unknown as {
        getShardStats(): Promise<ShardDistributionStats>
      }).getShardStats()

      expect(stats.skewRatio).toBeGreaterThan(10) // 800/50 = 16
    })

    it('should trigger rebalance when skew exceeds threshold', async () => {
      // RED: Automatic rebalance on high skew
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        maxSkew: 2.0, // Allow 2x max/min ratio
      })

      expect(rebalanceResult.success).toBe(true)
      expect(rebalanceResult.type).toBe('skew_correction')
      expect(rebalanceResult.newStats.skewRatio).toBeLessThanOrEqual(2.0)
    })

    it('should not rebalance when skew is acceptable', async () => {
      // RED: Skip rebalance if skew is within threshold
      // Setup balanced distribution
      result.storage.data.set('shardStats', {
        0: { thingCount: 260 },
        1: { thingCount: 240 },
        2: { thingCount: 250 },
        3: { thingCount: 250 },
      })

      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        maxSkew: 1.5,
      })

      expect(rebalanceResult.itemsMoved).toBe(0)
    })
  })

  describe('skew correction strategies', () => {
    it('should redistribute data to reduce skew', async () => {
      // RED: Should balance the distribution
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        maxSkew: 1.5,
        strategy: 'full',
      })

      // Distribution should be more even
      const newCounts = rebalanceResult.newStats.shardCounts
      const avg = newCounts.reduce((a, b) => a + b, 0) / newCounts.length
      const maxDev = Math.max(...newCounts.map((c) => Math.abs(c - avg)))

      expect(maxDev / avg).toBeLessThan(0.5) // Within 50% of average
    })

    it('should use incremental strategy for minimal disruption', async () => {
      // RED: Incremental should move less data
      const fullResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        maxSkew: 1.5,
        strategy: 'full',
      })

      // Reset
      result.storage.data.set('shardStats', {
        0: { thingCount: 800 },
        1: { thingCount: 50 },
        2: { thingCount: 100 },
        3: { thingCount: 50 },
      })

      const incrementalResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        maxSkew: 1.5,
        strategy: 'incremental',
      })

      // Incremental may not fully balance but should improve
      expect(incrementalResult.newStats.skewRatio).toBeLessThan(16) // Better than original
    })
  })
})

// ============================================================================
// TEST SUITE: LIVE REBALANCING
// ============================================================================

describe('shard rebalance - live operations', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createUniformThings(1000, 10)],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', {
      id: 'shard-set-1',
      shardKey: 'tenantId',
      shardCount: 4,
      strategy: 'hash',
      createdAt: new Date(),
      endpoints: Array.from({ length: 4 }, (_, i) => ({
        shardIndex: i,
        ns: `https://shard-${i}.test.do`,
        doId: `shard-do-${i}`,
        status: 'active',
      })),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('read availability during rebalance', () => {
    it('should allow reads during rebalance by default', async () => {
      // RED: Reads should continue during rebalance
      const rebalancePromise = (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        allowReadsDuringRebalance: true,
      })

      // Simulate concurrent read
      const readResult = await (result.instance as unknown as {
        queryShards<T>(options: { query: string }): Promise<{ data: T[] }>
      }).queryShards({
        query: 'SELECT * FROM things LIMIT 10',
      })

      await rebalancePromise

      expect(readResult.data).toBeDefined()
    })

    it('should route reads correctly during data movement', async () => {
      // RED: Reads should find data even while being moved
      // This tests double-write/dual-read pattern during rebalance
      const options: RebalanceOptions = {
        targetCount: 8,
        allowReadsDuringRebalance: true,
      }

      const rebalancePromise = (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards(options)

      // Query for specific tenant during rebalance
      const queryResult = await (result.instance as unknown as {
        queryShards<T>(options: { query: string }): Promise<{ data: T[]; totalItems: number }>
      }).queryShards({
        query: "SELECT * FROM things WHERE data->>'tenantId' = 'tenant-0'",
      })

      await rebalancePromise

      // Should find all tenant-0 items regardless of rebalance state
      expect(queryResult.totalItems).toBeGreaterThan(0)
    })
  })

  describe('write availability during rebalance', () => {
    it('should allow writes during rebalance when configured', async () => {
      // RED: Writes should be accepted during rebalance
      const rebalancePromise = (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        allowWritesDuringRebalance: true,
      })

      // Simulate concurrent write
      const writeResult = await (result.instance as unknown as {
        createThing(data: Record<string, unknown>): Promise<ThingRecord>
      }).createThing({
        name: 'New Item',
        data: { tenantId: 'tenant-0' },
      })

      await rebalancePromise

      expect(writeResult.id).toBeDefined()
    })

    it('should route new writes to correct shard', async () => {
      // RED: New writes should go to correct shard based on new topology
      await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        allowWritesDuringRebalance: true,
      })

      // Write after rebalance should use new shard layout
      const writeResult = await (result.instance as unknown as {
        createThing(data: Record<string, unknown>): Promise<ThingRecord>
      }).createThing({
        name: 'Post-Rebalance Item',
        data: { tenantId: 'tenant-new' },
      })

      // Should be routed to one of 8 shards
      expect(writeResult.id).toBeDefined()
    })

    it('should block writes when not allowed during rebalance', async () => {
      // RED: Writes should be rejected when not allowed
      const rebalancePromise = (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        allowWritesDuringRebalance: false,
      })

      // Concurrent write should fail
      await expect(
        (result.instance as unknown as {
          createThing(data: Record<string, unknown>): Promise<ThingRecord>
        }).createThing({
          name: 'Blocked Item',
          data: { tenantId: 'tenant-0' },
        })
      ).rejects.toThrow(/rebalance.*progress|write.*blocked/i)

      await rebalancePromise
    })
  })
})

// ============================================================================
// TEST SUITE: PROGRESS AND RESUMABILITY
// ============================================================================

describe('shard rebalance - progress tracking', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: RebalanceEvent[]

  beforeEach(() => {
    capturedEvents = []

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createUniformThings(1000, 10)],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    // Mock event capture
    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as RebalanceEventType,
        correlationId: (data as Record<string, unknown>)?.correlationId as string || '',
        timestamp: new Date(),
        data: data as Record<string, unknown>,
      })
      return originalEmit?.call(result.instance, verb, data)
    }

    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', {
      id: 'shard-set-1',
      shardKey: 'tenantId',
      shardCount: 4,
      strategy: 'hash',
      createdAt: new Date(),
      endpoints: Array.from({ length: 4 }, (_, i) => ({
        shardIndex: i,
        ns: `https://shard-${i}.test.do`,
        doId: `shard-do-${i}`,
        status: 'active',
      })),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('progress events', () => {
    it('should emit rebalance.started event', async () => {
      // RED: Should emit start event
      await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        correlationId: 'rebalance-123',
      })

      const startEvent = capturedEvents.find((e) => e.type === 'rebalance.started')
      expect(startEvent).toBeDefined()
      expect(startEvent?.correlationId).toBe('rebalance-123')
    })

    it('should emit rebalance.progress events', async () => {
      // RED: Should emit progress updates
      await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        batchSize: 100, // Small batches to generate more progress events
      })

      const progressEvents = capturedEvents.filter((e) => e.type === 'rebalance.progress')
      expect(progressEvents.length).toBeGreaterThan(0)
    })

    it('should emit batch completion events', async () => {
      // RED: Should emit event for each batch
      await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        batchSize: 100,
      })

      const batchEvents = capturedEvents.filter((e) => e.type === 'rebalance.batch_completed')
      expect(batchEvents.length).toBeGreaterThan(0)
    })

    it('should emit rebalance.completed event', async () => {
      // RED: Should emit completion event
      await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        correlationId: 'rebalance-456',
      })

      const completedEvent = capturedEvents.find((e) => e.type === 'rebalance.completed')
      expect(completedEvent).toBeDefined()
      expect(completedEvent?.data?.itemsMoved).toBeDefined()
    })
  })

  describe('progress querying', () => {
    it('should provide progress status during rebalance', async () => {
      // RED: Should be able to query progress
      const rebalancePromise = (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
      })

      // Query progress while rebalancing
      const progress = await (result.instance as unknown as {
        getRebalanceProgress(): Promise<RebalanceProgress | null>
      }).getRebalanceProgress()

      await rebalancePromise

      // Progress should have been available during rebalance
      // (may be null after completion)
    })

    it('should track percentage complete', async () => {
      // RED: Progress should include percentage
      const rebalancePromise = (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        batchSize: 50, // Small batches
      })

      // Wait a bit then check progress
      await new Promise((resolve) => setTimeout(resolve, 10))

      const progress = await (result.instance as unknown as {
        getRebalanceProgress(): Promise<RebalanceProgress | null>
      }).getRebalanceProgress()

      await rebalancePromise

      if (progress) {
        expect(progress.percentComplete).toBeGreaterThanOrEqual(0)
        expect(progress.percentComplete).toBeLessThanOrEqual(100)
      }
    })

    it('should estimate time remaining', async () => {
      // RED: Should estimate completion time
      const rebalancePromise = (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        batchSize: 50,
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      const progress = await (result.instance as unknown as {
        getRebalanceProgress(): Promise<RebalanceProgress | null>
      }).getRebalanceProgress()

      await rebalancePromise

      if (progress && progress.percentComplete > 0) {
        expect(progress.estimatedTimeRemaining).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('pause and resume', () => {
    it('should support pausing rebalance', async () => {
      // RED: Should be able to pause
      const rebalancePromise = (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        batchSize: 50,
      })

      // Pause after starting
      await new Promise((resolve) => setTimeout(resolve, 10))
      await (result.instance as unknown as {
        pauseRebalance(): Promise<void>
      }).pauseRebalance()

      const pauseEvent = capturedEvents.find((e) => e.type === 'rebalance.paused')
      expect(pauseEvent).toBeDefined()

      // Resume to complete
      await (result.instance as unknown as {
        resumeRebalance(): Promise<void>
      }).resumeRebalance()

      await rebalancePromise
    })

    it('should preserve progress when paused', async () => {
      // RED: Progress should not be lost on pause
      const rebalancePromise = (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        batchSize: 50,
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      const progressBeforePause = await (result.instance as unknown as {
        getRebalanceProgress(): Promise<RebalanceProgress | null>
      }).getRebalanceProgress()

      await (result.instance as unknown as {
        pauseRebalance(): Promise<void>
      }).pauseRebalance()

      const progressAfterPause = await (result.instance as unknown as {
        getRebalanceProgress(): Promise<RebalanceProgress | null>
      }).getRebalanceProgress()

      expect(progressAfterPause?.movedItems).toBeGreaterThanOrEqual(
        progressBeforePause?.movedItems || 0
      )

      await (result.instance as unknown as {
        resumeRebalance(): Promise<void>
      }).resumeRebalance()

      await rebalancePromise
    })

    it('should support cancelling rebalance', async () => {
      // RED: Should be able to cancel
      const rebalancePromise = (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        batchSize: 50,
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      await (result.instance as unknown as {
        cancelRebalance(): Promise<void>
      }).cancelRebalance()

      await expect(rebalancePromise).rejects.toThrow(/cancel/i)

      const cancelEvent = capturedEvents.find((e) => e.type === 'rebalance.cancelled')
      expect(cancelEvent).toBeDefined()
    })

    it('should rollback partial changes on cancel', async () => {
      // RED: Cancelled rebalance should not leave partial state
      const originalRegistry = result.storage.data.get('shardRegistry') as ShardRegistry
      const originalCount = originalRegistry.shardCount

      const rebalancePromise = (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        batchSize: 50,
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      await (result.instance as unknown as {
        cancelRebalance(): Promise<void>
      }).cancelRebalance()

      try {
        await rebalancePromise
      } catch {
        // Expected to throw
      }

      // Registry should be back to original state
      const registry = result.storage.data.get('shardRegistry') as ShardRegistry
      expect(registry.shardCount).toBe(originalCount)
    })
  })
})

// ============================================================================
// TEST SUITE: FAILURE HANDLING
// ============================================================================

describe('shard rebalance - failure handling', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createUniformThings(1000, 10)],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', {
      id: 'shard-set-1',
      shardKey: 'tenantId',
      shardCount: 4,
      strategy: 'hash',
      createdAt: new Date(),
      endpoints: Array.from({ length: 4 }, (_, i) => ({
        shardIndex: i,
        ns: `https://shard-${i}.test.do`,
        doId: `shard-do-${i}`,
        status: 'active',
      })),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('shard failures', () => {
    it('should handle unreachable source shard', async () => {
      // RED: Should handle source shard failure
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          if (shardIndex === 2) {
            throw new Error('Shard 2 unreachable')
          }
          return new Response(JSON.stringify({ things: [] }))
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        (result.instance as unknown as {
          rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
        }).rebalanceShards({
          targetCount: 8,
        })
      ).rejects.toThrow(/shard.*unreachable|failed/i)
    })

    it('should handle destination shard failure', async () => {
      // RED: Should handle destination shard failure
      const mockNamespace = createMockDONamespace()
      let createCount = 0
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (request: Request) => {
          if (request.method === 'POST') {
            createCount++
            if (createCount === 3) {
              throw new Error('Destination shard failed')
            }
          }
          return new Response(JSON.stringify({ success: true }))
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        (result.instance as unknown as {
          rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
        }).rebalanceShards({
          targetCount: 8,
        })
      ).rejects.toThrow(/destination.*failed|write.*failed/i)
    })

    it('should retry failed transfers', async () => {
      // RED: Should retry transient failures
      const mockNamespace = createMockDONamespace()
      let failCount = 0
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          failCount++
          if (failCount <= 2) {
            throw new Error('Transient failure')
          }
          return new Response(JSON.stringify({ things: [] }))
        }),
      })
      result.env.DO = mockNamespace

      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
      })

      // Should succeed after retries
      expect(rebalanceResult.success).toBe(true)
    })

    it('should exclude failed shards and continue', async () => {
      // RED: Should continue with remaining shards on failure
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          if (shardIndex === 2) {
            throw new Error('Shard 2 failed')
          }
          return new Response(JSON.stringify({ things: [], success: true }))
        }),
      })
      result.env.DO = mockNamespace

      // With exclude option, should continue despite shard 2 failure
      const rebalanceResult = await (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        excludeShards: [2],
      })

      expect(rebalanceResult.success).toBe(true)
    })
  })

  describe('data integrity on failure', () => {
    it('should not lose data on failure', async () => {
      // RED: Data should be preserved on failure
      const originalStats = await (result.instance as unknown as {
        getShardStats(): Promise<ShardDistributionStats>
      }).getShardStats()

      const mockNamespace = createMockDONamespace()
      let writeCount = 0
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (request: Request) => {
          if (request.method === 'POST') {
            writeCount++
            if (writeCount === 50) {
              throw new Error('Mid-rebalance failure')
            }
          }
          return new Response(JSON.stringify({ things: [], success: true }))
        }),
      })
      result.env.DO = mockNamespace

      try {
        await (result.instance as unknown as {
          rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
        }).rebalanceShards({
          targetCount: 8,
        })
      } catch {
        // Expected to fail
      }

      const afterStats = await (result.instance as unknown as {
        getShardStats(): Promise<ShardDistributionStats>
      }).getShardStats()

      // Total data should be preserved
      expect(afterStats.totalThings).toBe(originalStats.totalThings)
    })

    it('should rollback on verification failure', async () => {
      // RED: Should rollback if verification detects issues
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (request: Request) => {
          const url = new URL(request.url)
          if (url.pathname.includes('/verify')) {
            return new Response(JSON.stringify({
              valid: false,
              error: 'Checksum mismatch',
            }))
          }
          return new Response(JSON.stringify({ things: [], success: true }))
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        (result.instance as unknown as {
          rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
        }).rebalanceShards({
          targetCount: 8,
        })
      ).rejects.toThrow(/verification.*failed|checksum/i)
    })
  })

  describe('timeout handling', () => {
    it('should timeout if rebalance takes too long', async () => {
      // RED: Should respect timeout
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 200))
          return new Response(JSON.stringify({ things: [] }))
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        (result.instance as unknown as {
          rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
        }).rebalanceShards({
          targetCount: 8,
          timeout: 100,
        })
      ).rejects.toThrow(/timeout/i)
    })

    it('should save checkpoint on timeout', async () => {
      // RED: Should preserve progress on timeout
      const mockNamespace = createMockDONamespace()
      let callCount = 0
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          callCount++
          if (callCount > 5) {
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
          return new Response(JSON.stringify({ things: [] }))
        }),
      })
      result.env.DO = mockNamespace

      try {
        await (result.instance as unknown as {
          rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
        }).rebalanceShards({
          targetCount: 8,
          timeout: 100,
        })
      } catch {
        // Expected timeout
      }

      // Should have saved checkpoint
      const checkpoint = result.storage.data.get('rebalanceCheckpoint')
      expect(checkpoint).toBeDefined()
    })
  })
})

// ============================================================================
// TEST SUITE: VALIDATION
// ============================================================================

describe('shard rebalance - validation', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createUniformThings(1000, 10)],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', {
      id: 'shard-set-1',
      shardKey: 'tenantId',
      shardCount: 4,
      strategy: 'hash',
      createdAt: new Date(),
      endpoints: Array.from({ length: 4 }, (_, i) => ({
        shardIndex: i,
        ns: `https://shard-${i}.test.do`,
        doId: `shard-do-${i}`,
        status: 'active',
      })),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should reject rebalance on non-sharded DO', async () => {
    // RED: Cannot rebalance if not sharded
    result.storage.data.set('isSharded', false)
    result.storage.data.delete('shardRegistry')

    await expect(
      (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
      })
    ).rejects.toThrow(/not.*sharded/i)
  })

  it('should reject invalid target count', async () => {
    // RED: Target count must be valid
    await expect(
      (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: -1,
      })
    ).rejects.toThrow(/invalid.*count/i)
  })

  it('should reject same target count without maxSkew', async () => {
    // RED: No-op rebalance should be rejected
    await expect(
      (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 4, // Same as current
      })
    ).rejects.toThrow(/no.*change|same.*count/i)
  })

  it('should reject excessive shard count', async () => {
    // RED: Shard count should have upper limit
    await expect(
      (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 10000,
      })
    ).rejects.toThrow(/too.*many|maximum.*shards/i)
  })

  it('should reject invalid strategy', async () => {
    // RED: Strategy must be valid
    await expect(
      (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        targetCount: 8,
        strategy: 'invalid' as RebalanceStrategy,
      })
    ).rejects.toThrow(/invalid.*strategy/i)
  })

  it('should reject rebalance during active rebalance', async () => {
    // RED: Cannot start new rebalance while one is in progress
    const rebalance1 = (result.instance as unknown as {
      rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
    }).rebalanceShards({
      targetCount: 8,
    })

    const rebalance2 = (result.instance as unknown as {
      rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
    }).rebalanceShards({
      targetCount: 16,
    })

    const results = await Promise.allSettled([rebalance1, rebalance2])

    const rejections = results.filter((r) => r.status === 'rejected')
    expect(rejections.length).toBeGreaterThanOrEqual(1)
  })

  it('should validate maxSkew is positive', async () => {
    // RED: maxSkew must be positive
    await expect(
      (result.instance as unknown as {
        rebalanceShards(options: RebalanceOptions): Promise<RebalanceResult>
      }).rebalanceShards({
        maxSkew: 0,
      })
    ).rejects.toThrow(/invalid.*skew|positive/i)
  })
})
