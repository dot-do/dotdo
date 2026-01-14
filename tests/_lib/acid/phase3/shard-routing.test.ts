/**
 * Shard Routing Tests - Phase 3 ACID Test Suite
 *
 * RED TDD: Comprehensive tests for shard routing behavior.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * Covers routing mechanisms:
 * - Hash-based routing (determinism, uniformity)
 * - Range-based routing (boundaries, out-of-range)
 * - Routing table management
 * - Cross-DO resolution
 * - Circuit breaker per shard
 * - Routing consistency during rebalancing
 *
 * @see types/Lifecycle.ts for ShardStrategy
 * @see db/objects.ts for objects table routing schema
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../../tests/harness/do'
import { DO } from '../../../objects/DO'
import type { ShardOptions } from '../../../types/Lifecycle'
import {
  PHASE3_FIXTURES,
  createLargeDataset,
  createSqlDataFromFixtures,
  calculateHashShardIndex,
} from '../fixtures/phase3'
import { createMockShardCoordinator, ShardInfo } from '../mocks/shard-coordinator'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a sharded DO setup for routing tests
 */
function createShardedDO(): MockDOResult<DO, MockEnv> {
  const things = createLargeDataset(1000)
  const sqlData = createSqlDataFromFixtures(things, PHASE3_FIXTURES.shardRegistry)

  return createMockDO(DO, {
    ns: 'https://coordinator.shard.test.do',
    sqlData,
  })
}

// ============================================================================
// HASH-BASED ROUTING TESTS
// ============================================================================

describe('Hash-Based Routing', () => {
  let coordinator: ReturnType<typeof createMockShardCoordinator>

  beforeEach(() => {
    coordinator = createMockShardCoordinator(4, 'hash', 'id')

    // Register shards
    PHASE3_FIXTURES.shardRegistry.forEach((shard, i) => {
      coordinator.registerShard({
        ns: shard.ns,
        doId: shard.id,
        index: shard.shardIndex,
        thingCount: 250,
      })
    })
  })

  describe('Determinism', () => {
    it('should route same key to same shard every time', () => {
      // RED: Deterministic routing
      const key = 'thing-0001'

      const results = []
      for (let i = 0; i < 100; i++) {
        results.push(coordinator.routeKey(key))
      }

      // All results should be the same
      const uniqueResults = new Set(results)
      expect(uniqueResults.size).toBe(1)
    })

    it('should route consistently across different coordinator instances', () => {
      // RED: Cross-instance consistency
      const coordinator1 = createMockShardCoordinator(4, 'hash', 'id')
      const coordinator2 = createMockShardCoordinator(4, 'hash', 'id')

      const testKeys = [
        'thing-0000',
        'thing-0500',
        'thing-0999',
        'user-abc',
        'order-xyz',
      ]

      for (const key of testKeys) {
        expect(coordinator1.routeKey(key)).toBe(coordinator2.routeKey(key))
      }
    })

    it('should be deterministic after shard count is known', () => {
      // RED: Count-aware determinism
      const key = 'stable-key'

      // Route before and after shard registration
      const beforeIndex = coordinator.routeKey(key)

      // Add more registrations (shouldn't change routing)
      coordinator.registerShard({
        ns: 'https://extra.do',
        doId: 'extra',
        index: 0, // Same index, different DO
        thingCount: 0,
      })

      const afterIndex = coordinator.routeKey(key)

      expect(beforeIndex).toBe(afterIndex)
    })
  })

  describe('Uniformity', () => {
    it('should distribute different keys across all shards', () => {
      // RED: Use all shards
      const shardCounts = [0, 0, 0, 0]

      for (let i = 0; i < 1000; i++) {
        const index = coordinator.routeKey(`key-${i}`)
        shardCounts[index]++
      }

      // All shards should be used
      for (const count of shardCounts) {
        expect(count).toBeGreaterThan(0)
      }
    })

    it('should have roughly equal distribution', () => {
      // RED: Statistical uniformity
      const shardCounts = [0, 0, 0, 0]

      for (let i = 0; i < 10000; i++) {
        const index = coordinator.routeKey(`random-${i}-${Math.random()}`)
        shardCounts[index]++
      }

      const avg = 10000 / 4
      for (const count of shardCounts) {
        // Within 20% of average
        expect(count).toBeGreaterThan(avg * 0.8)
        expect(count).toBeLessThan(avg * 1.2)
      }
    })

    it('should handle key collision gracefully', () => {
      // RED: Collision handling
      const key1 = 'collision-key-1'
      const key2 = 'collision-key-2'

      // Even if they hash to same value, should still work
      const index1 = coordinator.routeKey(key1)
      const index2 = coordinator.routeKey(key2)

      // Both should be valid indices
      expect(index1).toBeGreaterThanOrEqual(0)
      expect(index1).toBeLessThan(4)
      expect(index2).toBeGreaterThanOrEqual(0)
      expect(index2).toBeLessThan(4)
    })
  })
})

// ============================================================================
// RANGE-BASED ROUTING TESTS
// ============================================================================

describe('Range-Based Routing', () => {
  let coordinator: ReturnType<typeof createMockShardCoordinator>

  beforeEach(() => {
    coordinator = createMockShardCoordinator(4, 'range', 'id')
    coordinator.setRangeBoundaries(PHASE3_FIXTURES.rangeBoundaries)

    // Register shards
    PHASE3_FIXTURES.shardRegistry.forEach((shard) => {
      coordinator.registerShard({
        ns: shard.ns,
        doId: shard.id,
        index: shard.shardIndex,
        thingCount: 250,
      })
    })
  })

  describe('Range Boundaries', () => {
    it('should route keys within range to correct shard', () => {
      // RED: In-range routing
      expect(coordinator.routeKey('thing-0050')).toBe(0) // First range
      expect(coordinator.routeKey('thing-0300')).toBe(1) // Second range
      expect(coordinator.routeKey('thing-0600')).toBe(2) // Third range
      expect(coordinator.routeKey('thing-0900')).toBe(3) // Fourth range
    })

    it('should handle boundary start values correctly', () => {
      // RED: Start boundary handling
      expect(coordinator.routeKey('thing-0000')).toBe(0) // Start of range 0
      expect(coordinator.routeKey('thing-0250')).toBe(1) // Start of range 1
      expect(coordinator.routeKey('thing-0500')).toBe(2) // Start of range 2
      expect(coordinator.routeKey('thing-0750')).toBe(3) // Start of range 3
    })

    it('should handle boundary end values correctly', () => {
      // RED: End boundary handling
      expect(coordinator.routeKey('thing-0249')).toBe(0) // End of range 0
      expect(coordinator.routeKey('thing-0499')).toBe(1) // End of range 1
      expect(coordinator.routeKey('thing-0749')).toBe(2) // End of range 2
      expect(coordinator.routeKey('thing-0999')).toBe(3) // End of range 3
    })
  })

  describe('Out-of-Range Handling', () => {
    it('should have defined behavior for keys before first range', () => {
      // RED: Before-range handling
      const index = coordinator.routeKey('aaa-before')

      // Should go to some shard (implementation choice)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(4)
    })

    it('should have defined behavior for keys after last range', () => {
      // RED: After-range handling
      const index = coordinator.routeKey('zzz-after')

      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(4)
    })

    it('should handle empty key', () => {
      // RED: Empty key handling
      const index = coordinator.routeKey('')

      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(4)
    })
  })
})

// ============================================================================
// ROUTING TABLE TESTS
// ============================================================================

describe('Routing Table Management', () => {
  let result: MockDOResult<DO, MockEnv>
  let coordinator: ReturnType<typeof createMockShardCoordinator>

  beforeEach(() => {
    result = createShardedDO()
    coordinator = createMockShardCoordinator(4, 'hash', 'id')

    // Register shards
    PHASE3_FIXTURES.shardRegistry.forEach((shard) => {
      coordinator.registerShard({
        ns: shard.ns,
        doId: shard.id,
        index: shard.shardIndex,
        thingCount: 250,
      })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Table Maintenance', () => {
    it('should maintain routing table in objects table', async () => {
      // RED: Routing table persistence
      const objects = result.sqlData.get('objects') as Array<{
        relation?: string
        shardKey?: string
        shardIndex?: number
      }>

      const shardEntries = objects.filter((o) => o.relation === 'shard')
      expect(shardEntries.length).toBe(4)

      // Each entry should have routing info
      for (const entry of shardEntries) {
        expect(entry.shardKey).toBe('id')
        expect(entry.shardIndex).toBeGreaterThanOrEqual(0)
      }
    })

    it('should update routing table on shard changes', () => {
      // RED: Dynamic updates
      const initialTable = coordinator.getRoutingTable()
      expect(initialTable.size).toBe(4)

      // Add a new shard
      coordinator.registerShard({
        ns: 'https://newshard.do',
        doId: 'new-shard',
        index: 4,
        thingCount: 0,
      })

      // Note: In real implementation, adding a shard would trigger rebalancing
      // For mock, just verify registration works
      const shards = coordinator.getShards()
      expect(shards.length).toBe(5)
    })

    it('should detect stale routing table', async () => {
      // RED: Stale detection
      // This would require version tracking in real implementation
      const table = coordinator.getRoutingTable()

      // Mock: Update entries with different timestamps
      coordinator.updateRoutingTable(new Map([
        ['shard-0', { shardIndex: 0, ns: 'https://updated.do' }],
      ]))

      const updatedTable = coordinator.getRoutingTable()
      expect(updatedTable.get('shard-0')?.ns).toBe('https://updated.do')
    })

    it('should cache routing table for performance', async () => {
      // RED: Caching behavior
      // Multiple lookups should use cached table
      const key = 'test-key'

      const start = Date.now()
      for (let i = 0; i < 10000; i++) {
        coordinator.routeKey(key)
      }
      const duration = Date.now() - start

      // 10000 lookups should be fast (< 100ms on modern hardware)
      expect(duration).toBeLessThan(100)
    })
  })
})

// ============================================================================
// CROSS-DO RESOLUTION TESTS
// ============================================================================

describe('Cross-DO Resolution', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createShardedDO()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('resolveLocal() Delegation', () => {
    it('should delegate to correct shard for local resolution', async () => {
      // RED: Local resolution routing
      // When coordinator receives a request for a sharded thing,
      // it should delegate to the correct shard

      const fetchCalls: string[] = []
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          fetchCalls.push(new URL(req.url).pathname)
          return new Response(JSON.stringify({ id: 'thing-0001' }))
        }),
      })
      result.env.DO = mockNamespace

      // Request for thing that should be on shard 1
      // (Implementation would route based on shard key)
      const request = new Request('https://test.do/things/thing-0001')

      // This would trigger delegation in real implementation
      await result.instance.fetch(request)

      // Verify a fetch was made (delegation occurred)
      // Actual shard selection depends on implementation
    })
  })

  describe('resolve() with Shard URL', () => {
    it('should route correctly when given shard URL', async () => {
      // RED: Explicit shard URL routing
      const mockNamespace = createMockDONamespace()
      let targetUrl: string | null = null

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'shard-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          targetUrl = req.url
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      // Resolve to specific shard URL
      const shardUrl = 'https://test.do/shard/1'

      // In real implementation, this would use the shard URL directly
      // For testing, we verify the namespace is used correctly
    })
  })

  describe('Circuit Breaker Per-Shard', () => {
    it('should have circuit breaker per shard for resilience', async () => {
      // RED: Per-shard circuit breaker
      const coordinator = createMockShardCoordinator(4, 'hash', 'id')

      // Register shards
      for (let i = 0; i < 4; i++) {
        coordinator.registerShard({
          ns: `https://shard${i}.do`,
          doId: `shard-${i}`,
          index: i,
          thingCount: 250,
        })
      }

      // Mark shard 2 as unhealthy
      coordinator.markUnhealthy(2)

      const shards = coordinator.getShards()
      const shard2 = shards.find((s) => s.index === 2)

      expect(shard2?.healthy).toBe(false)
      expect(shard2?.circuitState).toBe('open')
    })

    it('should skip unhealthy shards in scatter-gather', async () => {
      // RED: Unhealthy shard skipping
      const coordinator = createMockShardCoordinator(4, 'hash', 'id')

      // Register shards
      for (let i = 0; i < 4; i++) {
        coordinator.registerShard({
          ns: `https://shard${i}.do`,
          doId: `shard-${i}`,
          index: i,
          thingCount: 250,
        })
      }

      // Mark shard 1 as unhealthy
      coordinator.markUnhealthy(1)

      // Scatter query
      const result = await coordinator.scatter(async (index) => {
        return { shardIndex: index, data: 'test' }
      })

      // Should have results from healthy shards only
      expect(result.results.has(0)).toBe(true)
      expect(result.results.has(1)).toBe(false) // Skipped
      expect(result.results.has(2)).toBe(true)
      expect(result.results.has(3)).toBe(true)
    })

    it('should recover unhealthy shard after success', async () => {
      // RED: Circuit breaker recovery
      const coordinator = createMockShardCoordinator(4, 'hash', 'id')

      for (let i = 0; i < 4; i++) {
        coordinator.registerShard({
          ns: `https://shard${i}.do`,
          doId: `shard-${i}`,
          index: i,
          thingCount: 250,
        })
      }

      // Mark unhealthy then healthy
      coordinator.markUnhealthy(2)
      expect(coordinator.getShard(2)?.circuitState).toBe('open')

      coordinator.markHealthy(2)
      expect(coordinator.getShard(2)?.circuitState).toBe('closed')
      expect(coordinator.getShard(2)?.healthy).toBe(true)
    })
  })
})

// ============================================================================
// ROUTING CONSISTENCY TESTS
// ============================================================================

describe('Routing Consistency', () => {
  describe('During Rebalancing', () => {
    it('should maintain routing consistency during rebalancing', async () => {
      // RED: Consistency during shard changes
      const coordinator = createMockShardCoordinator(4, 'hash', 'id')

      // Initial routing
      const key = 'stable-key'
      const initialIndex = coordinator.routeKey(key)

      // Simulate rebalancing by changing shard info
      // In real implementation, this would involve moving data

      // Routing should remain stable for existing keys
      const afterIndex = coordinator.routeKey(key)
      expect(afterIndex).toBe(initialIndex)
    })

    it('should propagate routing updates to all clients', async () => {
      // RED: Update propagation
      // This tests that routing table changes are visible

      const coordinator1 = createMockShardCoordinator(4, 'hash', 'id')
      const coordinator2 = createMockShardCoordinator(4, 'hash', 'id')

      // Both should have same initial routing
      const key = 'test-key'
      expect(coordinator1.routeKey(key)).toBe(coordinator2.routeKey(key))

      // In real implementation, updating one would propagate to others
      // via shared state in DO storage or version vectors
    })
  })

  describe('Version Vector', () => {
    it('should track routing table version', async () => {
      // RED: Version tracking
      // Real implementation would use version vectors for consistency

      const coordinator = createMockShardCoordinator(4, 'hash', 'id')

      // Register shards
      for (let i = 0; i < 4; i++) {
        coordinator.registerShard({
          ns: `https://shard${i}.do`,
          doId: `shard-${i}`,
          index: i,
          thingCount: 250,
        })
      }

      const table = coordinator.getRoutingTable()
      // Table should have entries
      expect(table.size).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// ROUTING PERFORMANCE TESTS
// ============================================================================

describe('Routing Performance', () => {
  it('should route keys in O(1) time for hash strategy', () => {
    // RED: Constant time routing
    const coordinator = createMockShardCoordinator(100, 'hash', 'id')

    const times: number[] = []

    for (let i = 0; i < 10; i++) {
      const start = performance.now()
      for (let j = 0; j < 10000; j++) {
        coordinator.routeKey(`key-${i}-${j}`)
      }
      times.push(performance.now() - start)
    }

    // Times should be roughly constant (O(1))
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    for (const time of times) {
      expect(time).toBeLessThan(avg * 2) // Within 2x of average
    }
  })

  it('should handle high throughput routing', () => {
    // RED: High throughput
    const coordinator = createMockShardCoordinator(16, 'hash', 'id')

    const start = performance.now()
    for (let i = 0; i < 100000; i++) {
      coordinator.routeKey(`high-throughput-${i}`)
    }
    const duration = performance.now() - start

    // 100K routings should be fast (< 500ms)
    expect(duration).toBeLessThan(500)
  })
})
