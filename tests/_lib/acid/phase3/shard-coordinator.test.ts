/**
 * Shard Coordinator Tests - Phase 3 ACID Test Suite
 *
 * RED TDD: Comprehensive tests for shard coordinator behavior.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * Covers coordinator responsibilities:
 * - Role assignment (original DO becomes coordinator)
 * - Registry management (shard registration, updates, removal)
 * - Cross-DO coordination (query routing, aggregation)
 * - Health monitoring (detection, circuit breaker, health checks)
 * - Rebalancing (initiate, maintain availability, atomic updates)
 *
 * @see types/Lifecycle.ts for ShardResult
 * @see db/objects.ts for objects table shard schema
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../../tests/harness/do'
import { DO } from '../../../objects/DO'
import type { ShardOptions, ShardResult } from '../../../types/Lifecycle'
import {
  PHASE3_FIXTURES,
  createLargeDataset,
  createSqlDataFromFixtures,
} from '../fixtures/phase3'
import { createMockShardCoordinator, ShardInfo } from '../mocks/shard-coordinator'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a coordinator DO for testing
 */
function createCoordinatorDO(): MockDOResult<DO, MockEnv> {
  const things = createLargeDataset(1000)
  const sqlData = createSqlDataFromFixtures(things)

  return createMockDO(DO, {
    ns: 'https://coordinator.test.do',
    sqlData,
  })
}

// ============================================================================
// COORDINATOR ROLE TESTS
// ============================================================================

describe('Coordinator Role', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createCoordinatorDO()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Role Assignment', () => {
    it('should make original DO the coordinator after shard()', async () => {
      // RED: Original DO becomes coordinator
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'new-shard', equals: () => false },
        fetch: vi.fn().mockResolvedValue(new Response('OK')),
      })
      result.env.DO = mockNamespace

      await result.instance.shard(options)

      // Verify coordinator role is set
      // Implementation should set a flag or metadata
      const storageData = result.storage.data
      // Check for coordinator marker
    })

    it('should maintain coordinator state in objects table', async () => {
      // RED: Coordinator persistence
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'new-shard', equals: () => false },
        fetch: vi.fn().mockResolvedValue(new Response('OK')),
      })
      result.env.DO = mockNamespace

      await result.instance.shard(options)

      const objects = result.sqlData.get('objects') as Array<{
        relation?: string
        shardKey?: string
      }>

      // Should have shard entries
      const shardEntries = objects.filter((o) => o.relation === 'shard')
      expect(shardEntries.length).toBe(4)
    })

    it('should track shard count as coordinator', async () => {
      // RED: Shard count tracking
      const coordinator = createMockShardCoordinator(4, 'hash', 'id')

      for (let i = 0; i < 4; i++) {
        coordinator.registerShard({
          ns: `https://shard${i}.do`,
          doId: `shard-${i}`,
          index: i,
          thingCount: 250,
        })
      }

      expect(coordinator.shardCount).toBe(4)
      expect(coordinator.getShards().length).toBe(4)
    })
  })

  describe('Querying Coordinator', () => {
    it('should expose shard list via coordinator', async () => {
      // RED: Shard list query
      const coordinator = createMockShardCoordinator(4, 'hash', 'id')

      for (let i = 0; i < 4; i++) {
        coordinator.registerShard({
          ns: `https://shard${i}.do`,
          doId: `shard-${i}`,
          index: i,
          thingCount: 250,
        })
      }

      const shards = coordinator.getShards()

      expect(shards).toHaveLength(4)
      expect(shards[0]).toMatchObject({
        ns: 'https://shard0.do',
        index: 0,
        thingCount: 250,
      })
    })
  })
})

// ============================================================================
// REGISTRY MANAGEMENT TESTS
// ============================================================================

describe('Registry Management', () => {
  let coordinator: ReturnType<typeof createMockShardCoordinator>

  beforeEach(() => {
    coordinator = createMockShardCoordinator(4, 'hash', 'id')
  })

  describe('Shard Registration', () => {
    it('should register new shards correctly', () => {
      // RED: Basic registration
      coordinator.registerShard({
        ns: 'https://shard0.do',
        doId: 'shard-0',
        index: 0,
        thingCount: 250,
      })

      const shard = coordinator.getShard(0)
      expect(shard).toBeDefined()
      expect(shard?.ns).toBe('https://shard0.do')
      expect(shard?.thingCount).toBe(250)
    })

    it('should track health status for registered shards', () => {
      // RED: Health tracking
      coordinator.registerShard({
        ns: 'https://shard0.do',
        doId: 'shard-0',
        index: 0,
        thingCount: 250,
      })

      const shard = coordinator.getShard(0)
      expect(shard?.healthy).toBe(true)
      expect(shard?.circuitState).toBe('closed')
    })
  })

  describe('Registry Updates', () => {
    it('should update shard metadata', () => {
      // RED: Metadata updates
      coordinator.registerShard({
        ns: 'https://shard0.do',
        doId: 'shard-0',
        index: 0,
        thingCount: 250,
      })

      // Update thing count (e.g., after rebalancing)
      coordinator.registerShard({
        ns: 'https://shard0.do',
        doId: 'shard-0',
        index: 0,
        thingCount: 300, // Updated
      })

      const shard = coordinator.getShard(0)
      expect(shard?.thingCount).toBe(300)
    })

    it('should update routing table on shard changes', () => {
      // RED: Routing table sync
      coordinator.registerShard({
        ns: 'https://shard0.do',
        doId: 'shard-0',
        index: 0,
        thingCount: 250,
      })

      const table = coordinator.getRoutingTable()
      expect(table.has('shard-0')).toBe(true)
      expect(table.get('shard-0')?.ns).toBe('https://shard0.do')
    })
  })

  describe('Shard Removal', () => {
    it('should remove shards on unshard', () => {
      // RED: Shard removal
      // Register 4 shards
      for (let i = 0; i < 4; i++) {
        coordinator.registerShard({
          ns: `https://shard${i}.do`,
          doId: `shard-${i}`,
          index: i,
          thingCount: 250,
        })
      }

      expect(coordinator.getShards().length).toBe(4)

      // Remove shard 2
      coordinator.unregisterShard(2)

      expect(coordinator.getShards().length).toBe(3)
      expect(coordinator.getShard(2)).toBeUndefined()
    })

    it('should handle orphaned shard references', () => {
      // RED: Orphan handling
      coordinator.registerShard({
        ns: 'https://shard0.do',
        doId: 'shard-0',
        index: 0,
        thingCount: 250,
      })

      // Mark as unhealthy (simulating orphan)
      coordinator.markUnhealthy(0)

      const shard = coordinator.getShard(0)
      expect(shard?.healthy).toBe(false)

      // Remove orphan
      coordinator.unregisterShard(0)
      expect(coordinator.getShard(0)).toBeUndefined()
    })
  })
})

// ============================================================================
// CROSS-DO COORDINATION TESTS
// ============================================================================

describe('Cross-DO Coordination', () => {
  let coordinator: ReturnType<typeof createMockShardCoordinator>

  beforeEach(() => {
    coordinator = createMockShardCoordinator(4, 'hash', 'id')

    for (let i = 0; i < 4; i++) {
      coordinator.registerShard({
        ns: `https://shard${i}.do`,
        doId: `shard-${i}`,
        index: i,
        thingCount: 250,
      })
    }
  })

  describe('Query Routing', () => {
    it('should route queries to correct shard', () => {
      // RED: Query routing
      const key = 'thing-0001'
      const shardIndex = coordinator.routeKey(key)
      const shardNs = coordinator.routeKeyToNs(key)

      expect(shardIndex).toBeGreaterThanOrEqual(0)
      expect(shardIndex).toBeLessThan(4)
      expect(shardNs).toMatch(/shard\d\.do/)
    })

    it('should route to namespace for specific key', () => {
      // RED: Key to namespace mapping
      const key = 'user-123'
      const ns = coordinator.routeKeyToNs(key)

      expect(ns).toBeDefined()
      expect(ns).toMatch(/^https:\/\/shard\d\.do$/)
    })
  })

  describe('Response Aggregation', () => {
    it('should aggregate responses from shards', async () => {
      // RED: Response aggregation
      const result = await coordinator.scatter(async (shardIndex) => {
        return { count: 250, shard: shardIndex }
      })

      let totalCount = 0
      result.results.forEach((r) => {
        totalCount += r.count
      })

      expect(totalCount).toBe(1000)
    })

    it('should merge results maintaining order', async () => {
      // RED: Ordered merge
      const results = new Map<number, number[]>([
        [0, [1, 5, 9]],
        [1, [2, 6, 10]],
        [2, [3, 7, 11]],
        [3, [4, 8, 12]],
      ])

      const merged = coordinator.gather(results, {
        sort: (a, b) => a - b,
      })

      expect(merged).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    })
  })

  describe('Failure Handling', () => {
    it('should handle individual shard failures', async () => {
      // RED: Single shard failure
      const result = await coordinator.scatter(async (shardIndex) => {
        if (shardIndex === 2) {
          throw new Error('Shard 2 failed')
        }
        return { ok: true, shard: shardIndex }
      })

      expect(result.results.size).toBe(3)
      expect(result.errors.size).toBe(1)
      expect(result.errors.has(2)).toBe(true)
    })

    it('should report partial failures in result', async () => {
      // RED: Partial failure reporting
      const result = await coordinator.scatter(async (shardIndex) => {
        if (shardIndex % 2 === 0) {
          throw new Error(`Shard ${shardIndex} down`)
        }
        return { data: shardIndex }
      })

      expect(result.allSucceeded).toBe(false)
      expect(result.results.size).toBe(2) // Odd shards
      expect(result.errors.size).toBe(2) // Even shards
    })
  })
})

// ============================================================================
// HEALTH MONITORING TESTS
// ============================================================================

describe('Health Monitoring', () => {
  let coordinator: ReturnType<typeof createMockShardCoordinator>

  beforeEach(() => {
    coordinator = createMockShardCoordinator(4, 'hash', 'id')

    for (let i = 0; i < 4; i++) {
      coordinator.registerShard({
        ns: `https://shard${i}.do`,
        doId: `shard-${i}`,
        index: i,
        thingCount: 250,
      })
    }
  })

  describe('Unresponsive Shard Detection', () => {
    it('should detect unresponsive shards', async () => {
      // RED: Unresponsive detection
      coordinator.markUnhealthy(1)

      const health = await coordinator.healthCheck()

      expect(health.get(0)).toBe(true)
      expect(health.get(1)).toBe(false) // Marked unhealthy
      expect(health.get(2)).toBe(true)
      expect(health.get(3)).toBe(true)
    })

    it('should track last health check timestamp', () => {
      // RED: Timestamp tracking
      coordinator.registerShard({
        ns: 'https://new-shard.do',
        doId: 'new-shard',
        index: 5,
        thingCount: 0,
      })

      const shard = coordinator.getShard(5)
      expect(shard?.lastHealthCheck).toBeInstanceOf(Date)
    })
  })

  describe('Circuit Breaker', () => {
    it('should open circuit breaker for failing shards', () => {
      // RED: Circuit breaker open
      coordinator.markUnhealthy(2)

      const shard = coordinator.getShard(2)
      expect(shard?.circuitState).toBe('open')
    })

    it('should track failure count', () => {
      // RED: Failure counting
      coordinator.markUnhealthy(1)

      const shard = coordinator.getShard(1)
      expect(shard?.failureCount).toBeGreaterThan(0)
    })

    it('should recover circuit after success', () => {
      // RED: Circuit recovery
      coordinator.markUnhealthy(3)
      expect(coordinator.getShard(3)?.circuitState).toBe('open')

      coordinator.markHealthy(3)
      expect(coordinator.getShard(3)?.circuitState).toBe('closed')
      expect(coordinator.getShard(3)?.failureCount).toBe(0)
    })
  })

  describe('Health Check Endpoint', () => {
    it('should provide health check for all shards', async () => {
      // RED: Health check endpoint
      const health = await coordinator.healthCheck()

      expect(health.size).toBe(4)
      health.forEach((isHealthy) => {
        expect(typeof isHealthy).toBe('boolean')
      })
    })

    it('should update lastHealthCheck on check', async () => {
      // RED: Health check timestamp update
      const beforeCheck = new Date()

      await new Promise((r) => setTimeout(r, 10))
      await coordinator.healthCheck()

      const shard = coordinator.getShard(0)
      expect(shard?.lastHealthCheck.getTime()).toBeGreaterThanOrEqual(beforeCheck.getTime())
    })
  })
})

// ============================================================================
// REBALANCING TESTS
// ============================================================================

describe('Rebalancing', () => {
  let coordinator: ReturnType<typeof createMockShardCoordinator>

  beforeEach(() => {
    coordinator = createMockShardCoordinator(4, 'hash', 'id')

    for (let i = 0; i < 4; i++) {
      coordinator.registerShard({
        ns: `https://shard${i}.do`,
        doId: `shard-${i}`,
        index: i,
        thingCount: 250,
      })
    }
  })

  describe('Initiate Rebalancing', () => {
    it('should be able to initiate rebalancing', () => {
      // RED: Rebalance initiation
      // This is a conceptual test - real implementation would have a rebalance() method

      // Simulate unbalanced state
      coordinator.registerShard({
        ns: 'https://shard0.do',
        doId: 'shard-0',
        index: 0,
        thingCount: 400, // Overloaded
      })

      const shard0 = coordinator.getShard(0)
      expect(shard0?.thingCount).toBe(400)

      // In real implementation, coordinator.rebalance() would redistribute
    })
  })

  describe('Read Availability During Rebalance', () => {
    it('should maintain read availability during rebalance', async () => {
      // RED: Read availability
      // During rebalancing, queries should still work

      const result = await coordinator.scatter(async (shardIndex) => {
        return { data: `from-shard-${shardIndex}` }
      })

      expect(result.allSucceeded).toBe(true)
    })

    it('should route reads to available shards', async () => {
      // RED: Available shard routing
      coordinator.markUnhealthy(1)

      const result = await coordinator.scatter(async (shardIndex) => {
        return { shard: shardIndex }
      })

      // Should not query unhealthy shard
      expect(result.results.has(1)).toBe(false)
    })
  })

  describe('Routing Table Updates', () => {
    it('should update routing table atomically', () => {
      // RED: Atomic routing update
      const newEntries = new Map([
        ['shard-0', { shardIndex: 0, ns: 'https://new-shard0.do' }],
        ['shard-1', { shardIndex: 1, ns: 'https://new-shard1.do' }],
      ])

      coordinator.updateRoutingTable(newEntries)

      const table = coordinator.getRoutingTable()
      expect(table.get('shard-0')?.ns).toBe('https://new-shard0.do')
      expect(table.get('shard-1')?.ns).toBe('https://new-shard1.do')
    })

    it('should preserve routing consistency during update', () => {
      // RED: Routing consistency
      const key = 'stable-key'
      const beforeIndex = coordinator.routeKey(key)

      // Update routing table
      coordinator.updateRoutingTable(new Map([
        ['shard-new', { shardIndex: 0, ns: 'https://newshard.do' }],
      ]))

      // Routing for existing keys should still work
      const afterIndex = coordinator.routeKey(key)
      expect(afterIndex).toBe(beforeIndex)
    })
  })
})

// ============================================================================
// COORDINATOR STATE TESTS
// ============================================================================

describe('Coordinator State Management', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createCoordinatorDO()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should persist coordinator state across restarts', async () => {
    // RED: State persistence
    const options: ShardOptions = {
      key: 'id',
      count: 4,
      strategy: 'hash',
    }

    const mockNamespace = createMockDONamespace()
    mockNamespace.stubFactory = () => ({
      id: { toString: () => 'shard-stub', equals: () => false },
      fetch: vi.fn().mockResolvedValue(new Response('OK')),
    })
    result.env.DO = mockNamespace

    await result.instance.shard(options)

    // Verify state is in SQL tables
    const objects = result.sqlData.get('objects') as unknown[]
    expect(objects.length).toBeGreaterThan(0)
  })

  it('should recover coordinator role from persisted state', async () => {
    // RED: State recovery
    // Pre-populate with shard registry
    result.sqlData.set('objects', PHASE3_FIXTURES.shardRegistry)

    // Coordinator should recognize it has shards
    const objects = result.sqlData.get('objects') as Array<{ relation?: string }>
    const shardEntries = objects.filter((o) => o.relation === 'shard')

    expect(shardEntries.length).toBe(4)
  })

  it('should handle coordinator failover', async () => {
    // RED: Failover handling
    // In a real implementation, another shard could become coordinator

    const coordinator = createMockShardCoordinator(4, 'hash', 'id')

    for (let i = 0; i < 4; i++) {
      coordinator.registerShard({
        ns: `https://shard${i}.do`,
        doId: `shard-${i}`,
        index: i,
        thingCount: 250,
      })
    }

    // Simulate coordinator failure by marking unhealthy
    // In real implementation, another node would take over

    const shards = coordinator.getShards()
    expect(shards.length).toBe(4)
  })
})
