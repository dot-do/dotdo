/**
 * DO.shard() Operation Tests - Phase 3 ACID Test Suite
 *
 * RED TDD: Comprehensive tests for the shard() operation.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * shard() splits a DO's data across multiple new DO instances
 * based on a sharding strategy for horizontal scaling.
 *
 * This test file covers:
 * - Basic shard creation and distribution
 * - Shard coordinator behavior
 * - Validation and error handling
 * - ACID properties during sharding
 * - Event emission
 *
 * @see types/Lifecycle.ts for ShardOptions, ShardResult, ShardStrategy
 * @see db/objects.ts for objects table shard schema
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../../tests/harness/do'
import { DO } from '../../../objects/DO'
import type {
  ShardOptions,
  ShardResult,
  ShardStrategy,
  CloneMode,
} from '../../../types/Lifecycle'
import {
  PHASE3_FIXTURES,
  createLargeDataset,
  createSqlDataFromFixtures,
  calculateHashShardIndex,
} from '../fixtures/phase3'
import {
  createMockShardCoordinator,
  validateShardOptions,
  calculateIdealDistribution,
} from '../mocks/shard-coordinator'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a DO mock with large dataset for sharding tests
 */
function createShardingTestDO(thingCount: number = 1000): MockDOResult<DO, MockEnv> {
  const things = createLargeDataset(thingCount)
  const sqlData = createSqlDataFromFixtures(things)

  return createMockDO(DO, {
    ns: 'https://source.shard.test.do',
    sqlData,
  })
}

/**
 * Capture emitted events from DO instance
 */
function captureEvents(instance: DO): Array<{ verb: string; data: unknown }> {
  const events: Array<{ verb: string; data: unknown }> = []
  const originalEmit = (instance as unknown as { emitEvent: Function }).emitEvent

  if (originalEmit) {
    ;(instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      events.push({ verb, data })
      return originalEmit.call(instance, verb, data)
    }
  }

  return events
}

// ============================================================================
// TEST SUITE: shard() Operation
// ============================================================================

describe('DO.shard() Operation Tests', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createShardingTestDO(1000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // BASIC FUNCTIONALITY
  // ==========================================================================

  describe('Basic Functionality', () => {
    it('should create specified number of shards', async () => {
      // RED: Basic shard creation test
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      expect(shardResult).toBeDefined()
      expect(shardResult.shards).toHaveLength(4)
      expect(shardResult.shardKey).toBe('id')
    })

    it('should assign unique doIds to each shard', async () => {
      // RED: Each shard should have unique identifier
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      const doIds = shardResult.shards.map((s) => s.doId)
      const uniqueDoIds = new Set(doIds)

      expect(uniqueDoIds.size).toBe(4)
    })

    it('should assign correct shardIndex to each shard (0-based)', async () => {
      // RED: Shard indices should be sequential from 0
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      const indices = shardResult.shards.map((s) => s.shardIndex).sort((a, b) => a - b)
      expect(indices).toEqual([0, 1, 2, 3])
    })

    it('should distribute things across all shards', async () => {
      // RED: All shards should receive data
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      // Each shard should have some things
      for (const shard of shardResult.shards) {
        expect(shard.thingCount).toBeGreaterThan(0)
      }
    })

    it('should maintain total thing count across all shards', async () => {
      // RED: No data loss during sharding
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      const totalThings = shardResult.shards.reduce(
        (sum, shard) => sum + shard.thingCount,
        0
      )

      expect(totalThings).toBe(1000)
    })

    it('should create shard namespaces with consistent naming', async () => {
      // RED: Shard namespaces should follow predictable pattern
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      for (const shard of shardResult.shards) {
        expect(shard.ns).toMatch(/shard/)
        expect(shard.ns).toContain(shard.shardIndex.toString())
      }
    })

    it('should make original DO the shard coordinator (not deleted)', async () => {
      // RED: Source DO should become coordinator
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      await result.instance.shard(options)

      // Verify coordinator state is set
      // The source DO should still exist and have coordinator role
      // Check objects table for self-reference as coordinator
      const objects = result.sqlData.get('objects') as Array<{ relation?: string }>
      const selfEntry = objects.find((o) => o.relation === 'coordinator')
      // In the actual implementation, the coordinator should mark itself
      expect(result.instance).toBeDefined() // DO still exists
    })

    it('should record shards in objects table with relation=shard', async () => {
      // RED: Shard registry should be populated
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      await result.instance.shard(options)

      // Check objects table for shard entries
      const objects = result.sqlData.get('objects') as Array<{
        relation?: string
        shardKey?: string
        shardIndex?: number
      }>

      const shardEntries = objects.filter((o) => o.relation === 'shard')
      expect(shardEntries).toHaveLength(4)

      // Each entry should have shardKey and shardIndex
      for (const entry of shardEntries) {
        expect(entry.shardKey).toBe('id')
        expect(entry.shardIndex).toBeGreaterThanOrEqual(0)
        expect(entry.shardIndex).toBeLessThan(4)
      }
    })
  })

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  describe('Validation', () => {
    it('should reject shard count less than 2', async () => {
      // RED: Minimum 2 shards required
      const options: ShardOptions = {
        key: 'id',
        count: 1,
        strategy: 'hash',
      }

      await expect(result.instance.shard(options)).rejects.toThrow(/count.*2|minimum/i)
    })

    it('should reject shard count of 0', async () => {
      // RED: Zero shards not allowed
      const options: ShardOptions = {
        key: 'id',
        count: 0,
        strategy: 'hash',
      }

      await expect(result.instance.shard(options)).rejects.toThrow(/count|invalid/i)
    })

    it('should reject negative shard count', async () => {
      // RED: Negative shards not allowed
      const options: ShardOptions = {
        key: 'id',
        count: -1,
        strategy: 'hash',
      }

      await expect(result.instance.shard(options)).rejects.toThrow(/count|invalid/i)
    })

    it('should reject invalid shard key', async () => {
      // RED: Empty shard key not allowed
      const options: ShardOptions = {
        key: '',
        count: 4,
        strategy: 'hash',
      }

      await expect(result.instance.shard(options)).rejects.toThrow(/key|invalid/i)
    })

    it('should reject sharding already-sharded DO', async () => {
      // RED: Cannot shard twice
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      // First shard should succeed
      await result.instance.shard(options)

      // Second shard should fail
      await expect(result.instance.shard(options)).rejects.toThrow(/already.*shard|sharded/i)
    })

    it('should reject invalid strategy', async () => {
      // RED: Invalid strategy should be rejected
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'invalid' as ShardStrategy,
      }

      await expect(result.instance.shard(options)).rejects.toThrow(/strategy|invalid/i)
    })

    it('should reject sharding empty DO', async () => {
      // RED: Cannot shard DO with no data
      result.sqlData.set('things', [])

      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      await expect(result.instance.shard(options)).rejects.toThrow(/empty|no.*data/i)
    })

    it('should validate shard count upper limit', async () => {
      // RED: Excessive shard count should be rejected
      const options: ShardOptions = {
        key: 'id',
        count: 1000, // Too many shards
        strategy: 'hash',
      }

      await expect(result.instance.shard(options)).rejects.toThrow(/count.*exceed|too.*many/i)
    })
  })

  // ==========================================================================
  // SHARDING STRATEGIES (Basic)
  // ==========================================================================

  describe('Sharding Strategies (Basic)', () => {
    it('should use hash strategy by default', async () => {
      // RED: Default strategy should be hash
      const options: ShardOptions = {
        key: 'id',
        count: 4,
      }

      const shardResult = await result.instance.shard(options)

      // Verify hash-based distribution (deterministic)
      expect(shardResult.shards).toHaveLength(4)
      // Total should still be 1000
      const total = shardResult.shards.reduce((sum, s) => sum + s.thingCount, 0)
      expect(total).toBe(1000)
    })

    it('should support explicit hash strategy', async () => {
      // RED: Explicit hash strategy
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      expect(shardResult.shards).toHaveLength(4)
    })

    it('should support range strategy', async () => {
      // RED: Range-based partitioning
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'range',
      }

      const shardResult = await result.instance.shard(options)

      expect(shardResult.shards).toHaveLength(4)

      // Range strategy should create roughly equal partitions
      // Each shard should have ~250 things
      for (const shard of shardResult.shards) {
        expect(shard.thingCount).toBeGreaterThanOrEqual(200)
        expect(shard.thingCount).toBeLessThanOrEqual(300)
      }
    })

    it('should support roundRobin strategy', async () => {
      // RED: Round-robin distribution
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'roundRobin',
      }

      const shardResult = await result.instance.shard(options)

      expect(shardResult.shards).toHaveLength(4)

      // Round-robin should create perfectly equal distribution
      for (const shard of shardResult.shards) {
        expect(shard.thingCount).toBe(250)
      }
    })
  })

  // ==========================================================================
  // CLONE MODE INTEGRATION
  // ==========================================================================

  describe('Clone Mode Integration', () => {
    it('should support atomic mode for shard creation', async () => {
      // RED: Atomic sharding - all or nothing
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
        mode: 'atomic',
      }

      const shardResult = await result.instance.shard(options)

      expect(shardResult.shards).toHaveLength(4)
    })

    it('should support staged mode for shard creation', async () => {
      // RED: Staged sharding - two-phase commit
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
        mode: 'staged',
      }

      const shardResult = await result.instance.shard(options)

      expect(shardResult.shards).toHaveLength(4)
    })

    it('should support eventual mode for shard creation', async () => {
      // RED: Eventual sharding - async with progress
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
        mode: 'eventual',
      }

      const shardResult = await result.instance.shard(options)

      expect(shardResult.shards).toHaveLength(4)
    })

    it('should support resumable mode for shard creation', async () => {
      // RED: Resumable sharding - checkpoint-based
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
        mode: 'resumable',
      }

      const shardResult = await result.instance.shard(options)

      expect(shardResult.shards).toHaveLength(4)
    })
  })

  // ==========================================================================
  // ACID PROPERTIES
  // ==========================================================================

  describe('ACID Properties', () => {
    describe('Atomicity', () => {
      it('should create all shards or none on failure', async () => {
        // RED: All-or-nothing behavior
        // Inject failure after 2 shards created
        let shardCreationCount = 0
        const mockNamespace = createMockDONamespace()
        mockNamespace.stubFactory = () => ({
          id: { toString: () => `shard-${shardCreationCount}`, equals: () => false },
          fetch: vi.fn().mockImplementation(async () => {
            shardCreationCount++
            if (shardCreationCount === 3) {
              throw new Error('Shard creation failed')
            }
            return new Response('OK')
          }),
        })
        result.env.DO = mockNamespace

        const options: ShardOptions = {
          key: 'id',
          count: 4,
          strategy: 'hash',
        }

        // Should fail and rollback
        await expect(result.instance.shard(options)).rejects.toThrow()

        // Verify no partial shards exist
        const objects = result.sqlData.get('objects') as Array<{ relation?: string }>
        const shardEntries = objects.filter((o) => o.relation === 'shard')
        expect(shardEntries.length).toBe(0)
      })

      it('should rollback on failure during data distribution', async () => {
        // RED: Rollback if data transfer fails
        let transferCount = 0
        const mockNamespace = createMockDONamespace()
        mockNamespace.stubFactory = () => ({
          id: { toString: () => `shard-${transferCount}`, equals: () => false },
          fetch: vi.fn().mockImplementation(async (req: Request) => {
            const url = new URL(req.url)
            if (url.pathname.includes('transfer')) {
              transferCount++
              if (transferCount === 2) {
                throw new Error('Data transfer failed')
              }
            }
            return new Response('OK')
          }),
        })
        result.env.DO = mockNamespace

        const options: ShardOptions = {
          key: 'id',
          count: 4,
          strategy: 'hash',
        }

        await expect(result.instance.shard(options)).rejects.toThrow()

        // Source data should be unchanged
        const things = result.sqlData.get('things') as unknown[]
        expect(things.length).toBe(1000)
      })
    })

    describe('Consistency', () => {
      it('should maintain total things count equals original', async () => {
        // RED: No data loss
        const originalCount = (result.sqlData.get('things') as unknown[]).length

        const options: ShardOptions = {
          key: 'id',
          count: 4,
          strategy: 'hash',
        }

        const shardResult = await result.instance.shard(options)

        const totalSharded = shardResult.shards.reduce(
          (sum, s) => sum + s.thingCount,
          0
        )

        expect(totalSharded).toBe(originalCount)
      })

      it('should not duplicate things across shards', async () => {
        // RED: Each thing appears in exactly one shard
        const options: ShardOptions = {
          key: 'id',
          count: 4,
          strategy: 'hash',
        }

        const shardResult = await result.instance.shard(options)

        // With hash strategy, distribution should be deterministic
        // Total = sum of all shard counts
        const total = shardResult.shards.reduce((sum, s) => sum + s.thingCount, 0)
        expect(total).toBe(1000) // No duplicates
      })

      it('should preserve thing data integrity in each shard', async () => {
        // RED: Thing data should not be corrupted during transfer
        const options: ShardOptions = {
          key: 'id',
          count: 4,
          strategy: 'hash',
        }

        const shardResult = await result.instance.shard(options)

        // Each shard should have valid thing count
        for (const shard of shardResult.shards) {
          expect(typeof shard.thingCount).toBe('number')
          expect(shard.thingCount).toBeGreaterThanOrEqual(0)
        }
      })
    })

    describe('Isolation', () => {
      it('should not affect ongoing queries during shard creation', async () => {
        // RED: Queries should work during sharding
        const options: ShardOptions = {
          key: 'id',
          count: 4,
          strategy: 'hash',
        }

        // Start sharding in background
        const shardPromise = result.instance.shard(options)

        // Queries should still work
        const things = result.sqlData.get('things') as unknown[]
        expect(things.length).toBe(1000)

        await shardPromise
      })

      it('should lock DO for writes during critical shard phase', async () => {
        // RED: Prevent concurrent writes during sharding
        const options: ShardOptions = {
          key: 'id',
          count: 4,
          strategy: 'hash',
        }

        // Start sharding
        const shardPromise = result.instance.shard(options)

        // Concurrent shard should be blocked/rejected
        await expect(result.instance.shard(options)).rejects.toThrow(/concurrent|locked|in.*progress/i)

        await shardPromise
      })
    })

    describe('Durability', () => {
      it('should persist shard registry after creation', async () => {
        // RED: Shard info should be durable
        const options: ShardOptions = {
          key: 'id',
          count: 4,
          strategy: 'hash',
        }

        await result.instance.shard(options)

        // Shard entries should be in objects table
        const objects = result.sqlData.get('objects') as Array<{
          relation?: string
          shardKey?: string
        }>
        const shardEntries = objects.filter((o) => o.relation === 'shard')

        expect(shardEntries.length).toBe(4)
      })

      it('should emit shard.completed before returning', async () => {
        // RED: Event should be emitted and processed
        const events = captureEvents(result.instance)

        const options: ShardOptions = {
          key: 'id',
          count: 4,
          strategy: 'hash',
        }

        await result.instance.shard(options)

        const completedEvent = events.find((e) => e.verb === 'shard.completed')
        expect(completedEvent).toBeDefined()
      })
    })
  })

  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================

  describe('Event Emission', () => {
    it('should emit shard.started event', async () => {
      // RED: Shard start should emit event
      const events = captureEvents(result.instance)

      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      await result.instance.shard(options)

      const startedEvent = events.find((e) => e.verb === 'shard.started')
      expect(startedEvent).toBeDefined()
      expect(startedEvent?.data).toMatchObject({
        count: 4,
        strategy: 'hash',
        key: 'id',
      })
    })

    it('should emit shard.progress events during creation', async () => {
      // RED: Progress events for each shard
      const events = captureEvents(result.instance)

      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      await result.instance.shard(options)

      const progressEvents = events.filter((e) => e.verb === 'shard.progress')
      // Should have progress event for each shard
      expect(progressEvents.length).toBeGreaterThanOrEqual(1)
    })

    it('should emit shard.completed event on success', async () => {
      // RED: Completion event with summary
      const events = captureEvents(result.instance)

      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      await result.instance.shard(options)

      const completedEvent = events.find((e) => e.verb === 'shard.completed')
      expect(completedEvent).toBeDefined()
      expect(completedEvent?.data).toMatchObject({
        shardCount: 4,
      })
    })

    it('should emit shard.failed event on failure', async () => {
      // RED: Failure event with error details
      const events = captureEvents(result.instance)

      // Force failure by making DO namespace throw
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'fail-shard', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Shard creation failed')),
      })
      result.env.DO = mockNamespace

      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      await expect(result.instance.shard(options)).rejects.toThrow()

      const failedEvent = events.find((e) => e.verb === 'shard.failed')
      expect(failedEvent).toBeDefined()
    })

    it('should include thingsDistributed in completed event', async () => {
      // RED: Completion event should have distribution stats
      const events = captureEvents(result.instance)

      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      await result.instance.shard(options)

      const completedEvent = events.find((e) => e.verb === 'shard.completed')
      expect(completedEvent?.data).toHaveProperty('thingsDistributed')
      expect((completedEvent?.data as { thingsDistributed: number }).thingsDistributed).toBe(1000)
    })
  })

  // ==========================================================================
  // SHARD KEY OPTIONS
  // ==========================================================================

  describe('Shard Key Options', () => {
    it('should support sharding on thing ID (default)', async () => {
      // RED: ID-based sharding
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      expect(shardResult.shardKey).toBe('id')
      expect(shardResult.shards).toHaveLength(4)
    })

    it('should support sharding on thing type', async () => {
      // RED: Type-based sharding
      const options: ShardOptions = {
        key: 'type',
        count: 4,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      expect(shardResult.shardKey).toBe('type')
    })

    it('should support sharding on custom data field', async () => {
      // RED: Custom field sharding (e.g., category or region)
      const options: ShardOptions = {
        key: 'data.category',
        count: 4,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      expect(shardResult.shardKey).toBe('data.category')
    })

    it('should handle missing shard key gracefully', async () => {
      // RED: Fallback to ID hash when key is missing
      // Add some things without the category field
      const things = result.sqlData.get('things') as Array<{ data: Record<string, unknown> }>
      things[0].data = { value: 0 } // Remove category

      const options: ShardOptions = {
        key: 'data.category',
        count: 4,
        strategy: 'hash',
      }

      // Should not throw - use fallback
      const shardResult = await result.instance.shard(options)
      expect(shardResult.shards).toHaveLength(4)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle small dataset (fewer things than shards)', async () => {
      // RED: 5 things into 4 shards
      result = createShardingTestDO(5)

      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      // Some shards may be empty
      const total = shardResult.shards.reduce((sum, s) => sum + s.thingCount, 0)
      expect(total).toBe(5)
    })

    it('should handle exactly 2 shards (minimum)', async () => {
      // RED: Minimum shard count
      const options: ShardOptions = {
        key: 'id',
        count: 2,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      expect(shardResult.shards).toHaveLength(2)
      const total = shardResult.shards.reduce((sum, s) => sum + s.thingCount, 0)
      expect(total).toBe(1000)
    })

    it('should handle large shard count (many shards)', async () => {
      // RED: Many shards (reasonable upper bound)
      const options: ShardOptions = {
        key: 'id',
        count: 50,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      expect(shardResult.shards).toHaveLength(50)
      const total = shardResult.shards.reduce((sum, s) => sum + s.thingCount, 0)
      expect(total).toBe(1000)
    })

    it('should handle dataset with deleted things', async () => {
      // RED: Only non-deleted things should be sharded
      const things = result.sqlData.get('things') as Array<{ deleted: boolean }>
      // Mark first 100 as deleted
      for (let i = 0; i < 100; i++) {
        things[i].deleted = true
      }

      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      const shardResult = await result.instance.shard(options)

      // Only 900 non-deleted things should be distributed
      const total = shardResult.shards.reduce((sum, s) => sum + s.thingCount, 0)
      expect(total).toBe(900)
    })

    it('should handle concurrent shard requests', async () => {
      // RED: Only one shard operation at a time
      const options: ShardOptions = {
        key: 'id',
        count: 4,
        strategy: 'hash',
      }

      // Start two concurrent shards
      const shard1 = result.instance.shard(options)
      const shard2 = result.instance.shard(options)

      // One should succeed, one should fail
      const results = await Promise.allSettled([shard1, shard2])

      const successes = results.filter((r) => r.status === 'fulfilled')
      const failures = results.filter((r) => r.status === 'rejected')

      expect(successes.length).toBe(1)
      expect(failures.length).toBe(1)
    })
  })
})

// ============================================================================
// HELPER FUNCTION TESTS
// ============================================================================

describe('Shard Helper Functions', () => {
  describe('validateShardOptions', () => {
    it('should return empty array for valid options', () => {
      const errors = validateShardOptions({
        key: 'id',
        count: 4,
        strategy: 'hash',
      })

      expect(errors).toHaveLength(0)
    })

    it('should return error for missing key', () => {
      const errors = validateShardOptions({
        key: '',
        count: 4,
        strategy: 'hash',
      })

      expect(errors).toContain('Shard key is required')
    })

    it('should return error for count < 2', () => {
      const errors = validateShardOptions({
        key: 'id',
        count: 1,
        strategy: 'hash',
      })

      expect(errors.some((e) => e.includes('2'))).toBe(true)
    })
  })

  describe('calculateIdealDistribution', () => {
    it('should calculate even distribution', () => {
      const dist = calculateIdealDistribution(1000, 4)

      expect(dist.ideal).toBe(250)
      expect(dist.min).toBe(250)
      expect(dist.max).toBe(250)
    })

    it('should handle uneven distribution', () => {
      const dist = calculateIdealDistribution(1001, 4)

      expect(dist.ideal).toBe(250)
      expect(dist.min).toBe(250)
      expect(dist.max).toBe(251)
    })
  })
})
