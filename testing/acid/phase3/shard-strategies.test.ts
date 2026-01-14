/**
 * Shard Strategies Tests - Phase 3 ACID Test Suite
 *
 * RED TDD: Comprehensive tests for sharding strategies.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * Covers the four sharding strategies:
 * - hash: Deterministic consistent hashing on key
 * - range: Sequential range partitioning
 * - roundRobin: Even distribution across shards
 * - custom: User-provided partitioning function
 *
 * @see types/Lifecycle.ts for ShardStrategy
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv } from '../../../tests/harness/do'
import { DO } from '../../../objects/DO'
import type { ShardOptions, ShardResult, ShardStrategy } from '../../../types/Lifecycle'
import {
  PHASE3_FIXTURES,
  createLargeDataset,
  createSqlDataFromFixtures,
  calculateHashShardIndex,
  calculateRangeShardIndex,
  calculateDistributionUniformity,
} from '../fixtures/phase3'
import { createMockShardCoordinator } from '../mocks/shard-coordinator'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a DO mock with dataset for strategy tests
 */
function createStrategyTestDO(thingCount: number = 1000): MockDOResult<DO, MockEnv> {
  const things = createLargeDataset(thingCount)
  const sqlData = createSqlDataFromFixtures(things)

  return createMockDO(DO, {
    ns: 'https://strategy.shard.test.do',
    sqlData,
  })
}

/**
 * Verify distribution uniformity is within acceptable bounds
 * @param shardResult - Result from shard operation
 * @param maxCV - Maximum coefficient of variation (percentage)
 */
function expectUniformDistribution(shardResult: ShardResult, maxCV: number = 20): void {
  const partitions = new Map<number, unknown[]>()
  for (const shard of shardResult.shards) {
    partitions.set(shard.shardIndex, new Array(shard.thingCount).fill(null))
  }

  const cv = calculateDistributionUniformity(partitions)
  expect(cv).toBeLessThan(maxCV)
}

// ============================================================================
// HASH STRATEGY TESTS
// ============================================================================

describe('Hash Sharding Strategy', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createStrategyTestDO(1000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Determinism', () => {
    it('should be deterministic - same key always routes to same shard', async () => {
      // RED: Deterministic routing
      const coordinator1 = createMockShardCoordinator(4, 'hash', 'id')
      const coordinator2 = createMockShardCoordinator(4, 'hash', 'id')

      // Same key should route to same shard
      const testKeys = ['thing-0001', 'thing-0500', 'thing-0999']

      for (const key of testKeys) {
        const index1 = coordinator1.routeKey(key)
        const index2 = coordinator2.routeKey(key)
        expect(index1).toBe(index2)
      }
    })

    it('should produce same result across multiple shard operations', async () => {
      // RED: Consistency across operations
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      // First shard
      const shardResult1 = await result.instance.shard(options)

      // Reset and shard again (simulating different instance)
      result = createStrategyTestDO(1000)
      const shardResult2 = await result.instance.shard(options)

      // Distribution should be identical
      for (let i = 0; i < 4; i++) {
        expect(shardResult1.shards[i].thingCount).toBe(shardResult2.shards[i].thingCount)
      }
    })

    it('should produce consistent routing regardless of shard creation order', async () => {
      // RED: Order independence
      const coordinator = createMockShardCoordinator(4, 'hash', 'id')

      // Route keys before shards are registered
      const key = 'thing-0050'
      const expectedShard = coordinator.routeKey(key)

      // Register shards in different orders
      coordinator.registerShard({ ns: 'https://shard3.do', doId: 'shard-3', index: 3, thingCount: 0 })
      coordinator.registerShard({ ns: 'https://shard1.do', doId: 'shard-1', index: 1, thingCount: 0 })
      coordinator.registerShard({ ns: 'https://shard0.do', doId: 'shard-0', index: 0, thingCount: 0 })
      coordinator.registerShard({ ns: 'https://shard2.do', doId: 'shard-2', index: 2, thingCount: 0 })

      // Routing should still be the same
      expect(coordinator.routeKey(key)).toBe(expectedShard)
    })
  })

  describe('Distribution', () => {
    it('should distribute keys across all shards (uniformity)', async () => {
      // RED: Even distribution
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      // Each shard should have roughly equal count
      const counts = shardResult.shards.map((s) => s.thingCount)
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length

      // All shards should be within 30% of average
      for (const count of counts) {
        expect(count).toBeGreaterThan(avg * 0.7)
        expect(count).toBeLessThan(avg * 1.3)
      }
    })

    it('should have low coefficient of variation', async () => {
      // RED: Statistical uniformity
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      // CV should be less than 15% for good hash distribution
      expectUniformDistribution(shardResult, 15)
    })

    it('should handle different shard counts uniformly', async () => {
      // RED: Uniform distribution for various shard counts
      const shardCounts = [2, 3, 5, 8, 10]

      for (const count of shardCounts) {
        result = createStrategyTestDO(1000)

        const options: ShardOptions = {
          key: 'id',
          count,
          strategy: 'hash',
        }

        const shardResult = await result.instance.shard(options)

        // CV should be less than 20% for all counts
        expectUniformDistribution(shardResult, 20)
      }
    })
  })

  describe('Key Handling', () => {
    it('should handle numeric IDs', async () => {
      // RED: Numeric keys
      const coordinator = createMockShardCoordinator(4, 'hash', 'id')

      const indices = []
      for (let i = 0; i < 100; i++) {
        indices.push(coordinator.routeKey(i.toString()))
      }

      // Should use all shards
      const uniqueIndices = new Set(indices)
      expect(uniqueIndices.size).toBeGreaterThan(1)
    })

    it('should handle UUID-style IDs', async () => {
      // RED: UUID keys
      const coordinator = createMockShardCoordinator(4, 'hash', 'id')

      const uuids = [
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'b2c3d4e5-f6a7-8901-bcde-f12345678901',
        'c3d4e5f6-a7b8-9012-cdef-123456789012',
      ]

      for (const uuid of uuids) {
        const index = coordinator.routeKey(uuid)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(4)
      }
    })

    it('should handle empty string key', async () => {
      // RED: Empty key edge case
      const coordinator = createMockShardCoordinator(4, 'hash', 'id')

      const index = coordinator.routeKey('')
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(4)
    })

    it('should handle very long keys', async () => {
      // RED: Long key handling
      const coordinator = createMockShardCoordinator(4, 'hash', 'id')

      const longKey = 'x'.repeat(10000)
      const index = coordinator.routeKey(longKey)

      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(4)
    })
  })
})

// ============================================================================
// RANGE STRATEGY TESTS
// ============================================================================

describe('Range Sharding Strategy', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createStrategyTestDO(1000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Sequential Partitioning', () => {
    it('should create sequential range partitions', async () => {
      // RED: Range-based partitioning
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'range',
      }

      const shardResult = await result.instance.shard(options)

      // Each shard should have roughly 250 things
      for (const shard of shardResult.shards) {
        expect(shard.thingCount).toBeGreaterThanOrEqual(200)
        expect(shard.thingCount).toBeLessThanOrEqual(300)
      }
    })

    it('should assign consecutive IDs to same shard', async () => {
      // RED: Locality preservation
      const coordinator = createMockShardCoordinator(4, 'range', 'id')
      coordinator.setRangeBoundaries(PHASE3_FIXTURES.rangeBoundaries)

      // Consecutive IDs should be in same shard
      const index1 = coordinator.routeKey('thing-0100')
      const index2 = coordinator.routeKey('thing-0101')
      const index3 = coordinator.routeKey('thing-0102')

      expect(index1).toBe(index2)
      expect(index2).toBe(index3)
    })

    it('should respect range boundaries', async () => {
      // RED: Boundary handling
      const coordinator = createMockShardCoordinator(4, 'range', 'id')
      coordinator.setRangeBoundaries([
        { start: 'thing-0000', end: 'thing-0249', shardIndex: 0 },
        { start: 'thing-0250', end: 'thing-0499', shardIndex: 1 },
        { start: 'thing-0500', end: 'thing-0749', shardIndex: 2 },
        { start: 'thing-0750', end: 'thing-0999', shardIndex: 3 },
      ])

      // Test boundary values
      expect(coordinator.routeKey('thing-0000')).toBe(0) // Start of range 0
      expect(coordinator.routeKey('thing-0249')).toBe(0) // End of range 0
      expect(coordinator.routeKey('thing-0250')).toBe(1) // Start of range 1
      expect(coordinator.routeKey('thing-0749')).toBe(2) // End of range 2
      expect(coordinator.routeKey('thing-0999')).toBe(3) // End of range 3
    })
  })

  describe('Boundary Conditions', () => {
    it('should handle exact boundary values correctly', async () => {
      // RED: Exact boundary matching
      const coordinator = createMockShardCoordinator(4, 'range', 'id')
      coordinator.setRangeBoundaries(PHASE3_FIXTURES.rangeBoundaries)

      // At boundary
      const atBoundary = coordinator.routeKey('thing-0249')
      expect(atBoundary).toBe(0)

      // Just past boundary
      const pastBoundary = coordinator.routeKey('thing-0250')
      expect(pastBoundary).toBe(1)
    })

    it('should handle out-of-range keys', async () => {
      // RED: Keys outside defined ranges
      const coordinator = createMockShardCoordinator(4, 'range', 'id')
      coordinator.setRangeBoundaries(PHASE3_FIXTURES.rangeBoundaries)

      // Key before all ranges
      const beforeAll = coordinator.routeKey('aaa-0000')
      expect(beforeAll).toBeGreaterThanOrEqual(0)
      expect(beforeAll).toBeLessThan(4)

      // Key after all ranges
      const afterAll = coordinator.routeKey('zzz-9999')
      expect(afterAll).toBeGreaterThanOrEqual(0)
      expect(afterAll).toBeLessThan(4)
    })

    it('should handle keys in gaps between ranges', async () => {
      // RED: Gap handling (if ranges have gaps)
      const coordinator = createMockShardCoordinator(4, 'range', 'id')
      coordinator.setRangeBoundaries([
        { start: 'thing-0000', end: 'thing-0099', shardIndex: 0 },
        { start: 'thing-0200', end: 'thing-0299', shardIndex: 1 }, // Gap: 0100-0199
        { start: 'thing-0400', end: 'thing-0499', shardIndex: 2 },
        { start: 'thing-0600', end: 'thing-0999', shardIndex: 3 },
      ])

      // Key in gap should go somewhere defined (last shard by default)
      const inGap = coordinator.routeKey('thing-0150')
      expect(inGap).toBeGreaterThanOrEqual(0)
      expect(inGap).toBeLessThan(4)
    })
  })

  describe('Distribution', () => {
    it('should create equal-sized partitions for sorted data', async () => {
      // RED: Equal partitions
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'range',
      }

      const shardResult = await result.instance.shard(options)

      // Should be roughly equal (within 10%)
      const avgCount = 1000 / 4
      for (const shard of shardResult.shards) {
        expect(shard.thingCount).toBeGreaterThan(avgCount * 0.9)
        expect(shard.thingCount).toBeLessThan(avgCount * 1.1)
      }
    })

    it('should handle skewed data distribution', async () => {
      // RED: Skewed data handling
      // Create data with non-uniform key distribution
      const things = createLargeDataset(100)
      // Modify to have skewed IDs (most in lower range)
      things.forEach((t, i) => {
        t.id = `thing-${(i % 25).toString().padStart(4, '0')}`
      })
      result.sqlData.set('things', things)

      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'range',
      }

      const shardResult = await result.instance.shard(options)

      // Total should still be correct
      const total = shardResult.shards.reduce((sum, s) => sum + s.thingCount, 0)
      expect(total).toBe(100)
    })
  })
})

// ============================================================================
// ROUND ROBIN STRATEGY TESTS
// ============================================================================

describe('RoundRobin Sharding Strategy', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createStrategyTestDO(1000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Even Distribution', () => {
    it('should distribute evenly across all shards', async () => {
      // RED: Perfect distribution
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'roundRobin',
      }

      const shardResult = await result.instance.shard(options)

      // 1000 / 4 = 250 each
      for (const shard of shardResult.shards) {
        expect(shard.thingCount).toBe(250)
      }
    })

    it('should handle non-divisible counts', async () => {
      // RED: Uneven distribution (1001 / 4)
      result = createStrategyTestDO(1001)

      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'roundRobin',
      }

      const shardResult = await result.instance.shard(options)

      // Three shards get 250, one gets 251
      const counts = shardResult.shards.map((s) => s.thingCount).sort((a, b) => a - b)
      expect(counts).toEqual([250, 250, 250, 251])
    })

    it('should have zero coefficient of variation for divisible counts', async () => {
      // RED: Perfect uniformity
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'roundRobin',
      }

      const shardResult = await result.instance.shard(options)

      // CV should be 0 for perfect distribution
      expectUniformDistribution(shardResult, 1) // Allow tiny floating point error
    })
  })

  describe('Order-Based Assignment', () => {
    it('should assign things in order to shards', async () => {
      // RED: Sequential assignment
      const coordinator = createMockShardCoordinator(4, 'roundRobin', 'id')

      // Register shards
      for (let i = 0; i < 4; i++) {
        coordinator.registerShard({
          ns: `https://shard${i}.do`,
          doId: `shard-${i}`,
          index: i,
          thingCount: 0,
        })
      }

      // First 4 keys should go to shards 0, 1, 2, 3
      expect(coordinator.routeKey('key-0')).toBe(0)
      expect(coordinator.routeKey('key-1')).toBe(1)
      expect(coordinator.routeKey('key-2')).toBe(2)
      expect(coordinator.routeKey('key-3')).toBe(3)
      // Then cycle repeats
      expect(coordinator.routeKey('key-4')).toBe(0)
    })

    it('should cycle through shards repeatedly', async () => {
      // RED: Cycling behavior
      const coordinator = createMockShardCoordinator(3, 'roundRobin', 'id')

      const indices = []
      for (let i = 0; i < 9; i++) {
        indices.push(coordinator.routeKey(`key-${i}`))
      }

      // Should be: 0, 1, 2, 0, 1, 2, 0, 1, 2
      expect(indices).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2])
    })
  })

  describe('Key Independence', () => {
    it('should ignore key value for distribution', async () => {
      // RED: Key value doesn't affect shard selection
      // Round robin should not look at key content
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'roundRobin',
      }

      // Modify some keys to have very different values
      const things = result.sqlData.get('things') as Array<{ id: string }>
      things[0].id = 'aaaa'
      things[1].id = 'zzzz'
      things[2].id = '0000'
      things[3].id = '9999'

      const shardResult = await result.instance.shard(options)

      // Distribution should still be even
      for (const shard of shardResult.shards) {
        expect(shard.thingCount).toBe(250)
      }
    })
  })
})

// ============================================================================
// CUSTOM STRATEGY TESTS
// ============================================================================

describe('Custom Sharding Strategy', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createStrategyTestDO(1000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('User-Provided Function', () => {
    it('should use custom function for shard assignment', async () => {
      // RED: Custom function usage
      const coordinator = createMockShardCoordinator(4, 'custom', 'id')

      // Custom function: first letter determines shard
      coordinator.setCustomShardFunction((key, shardCount) => {
        const firstChar = key.charAt(0).toLowerCase()
        return firstChar.charCodeAt(0) % shardCount
      })

      // 't' = 116 % 4 = 0
      expect(coordinator.routeKey('thing-0001')).toBe(0)
      // 'a' = 97 % 4 = 1
      expect(coordinator.routeKey('apple')).toBe(1)
    })

    it('should receive thing and shard count as parameters', async () => {
      // RED: Function parameters
      const coordinator = createMockShardCoordinator(5, 'custom', 'id')

      let receivedKey: string | null = null
      let receivedCount: number | null = null

      coordinator.setCustomShardFunction((key, shardCount) => {
        receivedKey = key
        receivedCount = shardCount
        return 0
      })

      coordinator.routeKey('test-key')

      expect(receivedKey).toBe('test-key')
      expect(receivedCount).toBe(5)
    })

    it('should validate custom function returns valid shard index', async () => {
      // RED: Return value validation
      const coordinator = createMockShardCoordinator(4, 'custom', 'id')

      // Bad function returns invalid index
      coordinator.setCustomShardFunction(() => -1)

      // Should handle gracefully or throw
      expect(() => coordinator.routeKey('key')).not.toThrow()
      const index = coordinator.routeKey('key')
      // Implementation should normalize or error
      expect(index).toBeGreaterThanOrEqual(-1) // Allow implementation to handle
    })

    it('should handle function that returns index >= shardCount', async () => {
      // RED: Out-of-bounds handling
      const coordinator = createMockShardCoordinator(4, 'custom', 'id')

      coordinator.setCustomShardFunction(() => 100) // Way out of bounds

      const index = coordinator.routeKey('key')
      // Implementation should normalize (modulo) or error
      expect(index).toBeDefined()
    })
  })

  describe('Category-Based Sharding', () => {
    it('should support sharding by category field', async () => {
      // RED: Category-based custom function
      const options: ShardOptions = {
        key: 'data.category',
        count: 4,
        strategy: 'custom',
      }

      // Things have categories A, B, C, D
      // Custom function: category letter -> shard index
      // This would be implemented in DO.shard() to use custom logic

      const shardResult = await result.instance.shard(options)

      // Should have created 4 shards
      expect(shardResult.shards).toHaveLength(4)
    })

    it('should support sharding by region field', async () => {
      // RED: Region-based sharding
      const options: ShardOptions = {
        key: 'data.region',
        count: 3, // us-east, us-west, eu-west
        strategy: 'custom',
      }

      const shardResult = await result.instance.shard(options)

      expect(shardResult.shards).toHaveLength(3)
    })
  })

  describe('Error Handling', () => {
    it('should throw if custom strategy without function', async () => {
      // RED: Missing custom function
      const coordinator = createMockShardCoordinator(4, 'custom', 'id')

      // Don't set custom function
      expect(() => coordinator.routeKey('key')).toThrow(/custom.*function/i)
    })

    it('should handle custom function that throws', async () => {
      // RED: Function throws
      const coordinator = createMockShardCoordinator(4, 'custom', 'id')

      coordinator.setCustomShardFunction(() => {
        throw new Error('Custom function error')
      })

      expect(() => coordinator.routeKey('key')).toThrow(/custom function error/i)
    })
  })
})

// ============================================================================
// STRATEGY COMPARISON TESTS
// ============================================================================

describe('Strategy Comparison', () => {
  describe('Distribution Characteristics', () => {
    it('should show different distributions for same data', async () => {
      // RED: Strategies produce different distributions
      const strategies: ShardStrategy[] = ['hash', 'range', 'roundRobin']
      const distributions: Record<string, number[]> = {}

      for (const strategy of strategies) {
        const testResult = createStrategyTestDO(1000)

        const options: ShardOptions = {
          key: 'id',
          count: 4,
          strategy,
        }

        const shardResult = await testResult.instance.shard(options)
        distributions[strategy] = shardResult.shards.map((s) => s.thingCount).sort((a, b) => a - b)
      }

      // Round robin should have perfect distribution
      expect(distributions.roundRobin).toEqual([250, 250, 250, 250])

      // Hash and range will vary but total same
      expect(distributions.hash!.reduce((a, b) => a + b, 0)).toBe(1000)
      expect(distributions.range!.reduce((a, b) => a + b, 0)).toBe(1000)
    })
  })

  describe('Use Case Recommendations', () => {
    it('hash: best for random access patterns', async () => {
      // RED: Hash is good for random access
      const coordinator = createMockShardCoordinator(4, 'hash', 'id')

      // Random access should be O(1) lookup
      const key1 = coordinator.routeKey('random-key-12345')
      const key2 = coordinator.routeKey('random-key-67890')

      expect(key1).not.toBe(key2) // Different keys likely different shards
    })

    it('range: best for range queries', async () => {
      // RED: Range is good for sequential scans
      const coordinator = createMockShardCoordinator(4, 'range', 'id')
      coordinator.setRangeBoundaries(PHASE3_FIXTURES.rangeBoundaries)

      // Range query thing-0100 to thing-0150 hits one shard
      const start = coordinator.routeKey('thing-0100')
      const end = coordinator.routeKey('thing-0150')

      expect(start).toBe(end) // Same shard for range
    })

    it('roundRobin: best for even write distribution', async () => {
      // RED: Round robin good for write-heavy workloads
      const coordinator = createMockShardCoordinator(4, 'roundRobin', 'id')

      // Writing 100 items distributes evenly
      const shardCounts = [0, 0, 0, 0]
      for (let i = 0; i < 100; i++) {
        const index = coordinator.routeKey(`new-item-${i}`)
        shardCounts[index]++
      }

      // Perfect distribution
      expect(shardCounts).toEqual([25, 25, 25, 25])
    })
  })
})
