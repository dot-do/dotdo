/**
 * DO.unshard() Operation Tests - Phase 3 ACID Test Suite
 *
 * RED TDD: Comprehensive tests for the unshard() operation.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * unshard() merges all shards back into a single DO,
 * consolidating distributed data.
 *
 * This test file covers:
 * - Basic unshard functionality
 * - Target selection (coordinator, new DO, first shard)
 * - Clone mode integration
 * - Conflict resolution
 * - Validation and error handling
 * - ACID properties during unshard
 * - Event emission
 *
 * @see types/Lifecycle.ts for UnshardOptions
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../../tests/harness/do'
import { DO } from '../../../objects/DO'
import type { UnshardOptions, CloneMode } from '../../../types/Lifecycle'
import {
  PHASE3_FIXTURES,
  createLargeDataset,
  createSqlDataFromFixtures,
  createConflictingThings,
  TestThing,
} from '../fixtures/phase3'
import { createMockShardCoordinator } from '../mocks/shard-coordinator'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a sharded DO (coordinator) for unshard tests
 */
function createShardedCoordinatorDO(): MockDOResult<DO, MockEnv> {
  // Coordinator has shard registry but minimal data
  const sqlData = createSqlDataFromFixtures([], PHASE3_FIXTURES.shardRegistry)

  // Mark as coordinator (has shards registered)
  sqlData.set('_coordinator', [{ isCoordinator: true, shardCount: 4 }])

  return createMockDO(DO, {
    ns: 'https://coordinator.unshard.test.do',
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
// TEST SUITE: unshard() Operation
// ============================================================================

describe('DO.unshard() Operation Tests', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createShardedCoordinatorDO()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // BASIC FUNCTIONALITY
  // ==========================================================================

  describe('Basic Functionality', () => {
    it('should merge all shard data into target', async () => {
      // RED: Basic merge operation
      // Mock shard responses
      let totalMerged = 0
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'shard-stub', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          totalMerged += 250
          return new Response(JSON.stringify({
            things: Array(250).fill({ id: 'thing', data: {} }),
          }))
        }),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard()

      // All 4 shards merged = 1000 things
      expect(totalMerged).toBe(1000)
    })

    it('should update shard registry (remove shards)', async () => {
      // RED: Registry cleanup
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'shard-stub', equals: () => false },
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ things: [] }))),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard()

      // Shard entries should be removed from objects table
      const objects = result.sqlData.get('objects') as Array<{ relation?: string }>
      const shardEntries = objects.filter((o) => o.relation === 'shard')

      expect(shardEntries.length).toBe(0)
    })

    it('should clean up shard DOs after merge', async () => {
      // RED: Shard cleanup
      const cleanedUpShards: string[] = []
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('cleanup') || req.method === 'DELETE') {
            cleanedUpShards.push(id.toString())
          }
          return new Response(JSON.stringify({ things: [] }))
        }),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard()

      // All 4 shards should be cleaned up
      // (exact cleanup mechanism depends on implementation)
    })

    it('should make coordinator the single DO again', async () => {
      // RED: Coordinator becomes single DO
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'shard-stub', equals: () => false },
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ things: [] }))),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard()

      // Coordinator metadata should be cleared
      const coordData = result.sqlData.get('_coordinator') as Array<{ isCoordinator: boolean }>
      // Implementation should clear coordinator flag
    })
  })

  // ==========================================================================
  // TARGET SELECTION
  // ==========================================================================

  describe('Target Selection', () => {
    it('should unshard to coordinator by default', async () => {
      // RED: Default target = coordinator
      const mockNamespace = createMockDONamespace()
      let targetNs: string | null = null

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'shard-stub', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          targetNs = new URL(req.url).hostname
          return new Response(JSON.stringify({ things: [] }))
        }),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard()

      // Default: merge into coordinator (self)
    })

    it('should unshard to specified target DO', async () => {
      // RED: Custom target
      const customTarget = 'https://custom-target.do'
      const options: UnshardOptions = {
        target: customTarget,
      }

      const mockNamespace = createMockDONamespace()
      let targetedNs: string | null = null

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'shard-stub', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (new URL(req.url).hostname.includes('custom-target')) {
            targetedNs = 'custom-target.do'
          }
          return new Response(JSON.stringify({ things: [] }))
        }),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard(options)

      // Data should be sent to custom target
    })

    it('should support unsharding to first shard', async () => {
      // RED: First shard as target
      const options: UnshardOptions = {
        target: 'https://test.do/shard/0', // First shard
      }

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'shard-0', equals: () => false },
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ things: [] }))),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard(options)
    })
  })

  // ==========================================================================
  // CLONE MODE INTEGRATION
  // ==========================================================================

  describe('Clone Mode Integration', () => {
    it('should support atomic mode for all-or-nothing merge', async () => {
      // RED: Atomic unshard
      const options: UnshardOptions = {
        mode: 'atomic',
      }

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'shard-stub', equals: () => false },
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ things: [] }))),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard(options)
    })

    it('should support staged mode for two-phase merge', async () => {
      // RED: Staged unshard
      const options: UnshardOptions = {
        mode: 'staged',
      }

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'shard-stub', equals: () => false },
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ things: [] }))),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard(options)
    })

    it('should support eventual mode for background merge', async () => {
      // RED: Eventual unshard
      const options: UnshardOptions = {
        mode: 'eventual',
      }

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'shard-stub', equals: () => false },
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ things: [] }))),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard(options)
    })

    it('should support resumable mode for checkpoint-based merge', async () => {
      // RED: Resumable unshard
      const options: UnshardOptions = {
        mode: 'resumable',
      }

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'shard-stub', equals: () => false },
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ things: [] }))),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard(options)
    })
  })

  // ==========================================================================
  // CONFLICT RESOLUTION
  // ==========================================================================

  describe('Conflict Resolution', () => {
    it('should handle things with same ID across shards', async () => {
      // RED: ID conflict handling
      const conflictingThings = createConflictingThings('conflict-id', 4)

      const mockNamespace = createMockDONamespace()
      let shardIndex = 0

      mockNamespace.stubFactory = () => ({
        id: { toString: () => `shard-${shardIndex}`, equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          const thing = conflictingThings.get(shardIndex)
          shardIndex++
          return new Response(JSON.stringify({ things: thing ? [thing] : [] }))
        }),
      })
      result.env.DO = mockNamespace

      // Should not throw - conflicts should be resolved
      await expect(result.instance.unshard()).resolves.not.toThrow()
    })

    it('should apply merge strategy for conflicts', async () => {
      // RED: Merge strategy application
      // Implementation should use last-write-wins or configurable strategy

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'shard-stub', equals: () => false },
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({
          things: [{ id: 'dup', data: { version: 1 }, updatedAt: Date.now() }],
        }))),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard()

      // Final data should have resolved conflicts
    })

    it('should log conflicts for review', async () => {
      // RED: Conflict logging
      const conflictingThings = createConflictingThings('conflict-id', 2)
      let conflictsLogged = false

      const mockNamespace = createMockDONamespace()
      let callCount = 0

      mockNamespace.stubFactory = () => ({
        id: { toString: () => `shard-${callCount}`, equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          const thing = conflictingThings.get(callCount % 2)
          callCount++
          return new Response(JSON.stringify({ things: thing ? [thing] : [] }))
        }),
      })
      result.env.DO = mockNamespace

      const events = captureEvents(result.instance)

      await result.instance.unshard()

      // Check for conflict events
      const conflictEvents = events.filter((e) => e.verb.includes('conflict'))
      // Implementation should emit conflict events
    })
  })

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  describe('Validation', () => {
    it('should reject unshard on non-sharded DO', async () => {
      // RED: Not a coordinator
      // Remove shard registry
      result.sqlData.set('objects', [])
      result.sqlData.set('_coordinator', [])

      await expect(result.instance.unshard()).rejects.toThrow(/not.*shard|no.*shards/i)
    })

    it('should validate target exists if specified', async () => {
      // RED: Target validation
      const options: UnshardOptions = {
        target: 'https://nonexistent.do',
      }

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'target-check', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Target not found')),
      })
      result.env.DO = mockNamespace

      await expect(result.instance.unshard(options)).rejects.toThrow(/target|not.*found/i)
    })

    it('should verify all shards reachable before start', async () => {
      // RED: Pre-flight check
      const mockNamespace = createMockDONamespace()
      let healthCheckCount = 0

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'health-check', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('health')) {
            healthCheckCount++
            if (healthCheckCount === 3) {
              throw new Error('Shard unreachable')
            }
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(result.instance.unshard()).rejects.toThrow(/shard.*unreachable|health/i)
    })
  })

  // ==========================================================================
  // ACID PROPERTIES
  // ==========================================================================

  describe('ACID Properties', () => {
    describe('Atomicity', () => {
      it('should complete entire merge or rollback', async () => {
        // RED: All-or-nothing
        let mergeCount = 0

        const mockNamespace = createMockDONamespace()
        mockNamespace.stubFactory = () => ({
          id: { toString: () => 'atomic-test', equals: () => false },
          fetch: vi.fn().mockImplementation(async () => {
            mergeCount++
            if (mergeCount === 3) {
              throw new Error('Merge failed mid-operation')
            }
            return new Response(JSON.stringify({ things: [] }))
          }),
        })
        result.env.DO = mockNamespace

        await expect(result.instance.unshard()).rejects.toThrow()

        // Shard registry should still exist (rollback)
        const objects = result.sqlData.get('objects') as Array<{ relation?: string }>
        const shardEntries = objects.filter((o) => o.relation === 'shard')
        expect(shardEntries.length).toBe(4)
      })
    })

    describe('Consistency', () => {
      it('should ensure no data loss during unshard', async () => {
        // RED: Data preservation
        const expectedTotal = 1000

        const mockNamespace = createMockDONamespace()
        let totalFetched = 0

        mockNamespace.stubFactory = () => ({
          id: { toString: () => 'data-check', equals: () => false },
          fetch: vi.fn().mockImplementation(async () => {
            totalFetched += 250
            return new Response(JSON.stringify({
              things: Array(250).fill({ id: 'thing', data: {} }),
            }))
          }),
        })
        result.env.DO = mockNamespace

        await result.instance.unshard()

        expect(totalFetched).toBe(expectedTotal)
      })
    })

    describe('Isolation', () => {
      it('should allow queries during unshard', async () => {
        // RED: Read availability
        const mockNamespace = createMockDONamespace()
        mockNamespace.stubFactory = () => ({
          id: { toString: () => 'query-test', equals: () => false },
          fetch: vi.fn().mockImplementation(async () => {
            // Simulate slow merge
            await new Promise((r) => setTimeout(r, 10))
            return new Response(JSON.stringify({ things: [] }))
          }),
        })
        result.env.DO = mockNamespace

        // Start unshard
        const unshardPromise = result.instance.unshard()

        // Queries should still work
        const objects = result.sqlData.get('objects')
        expect(objects).toBeDefined()

        await unshardPromise
      })
    })

    describe('Durability', () => {
      it('should persist merged data durably', async () => {
        // RED: Durable merge
        const mockNamespace = createMockDONamespace()
        mockNamespace.stubFactory = () => ({
          id: { toString: () => 'durable-test', equals: () => false },
          fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({
            things: [{ id: 'merged-thing', data: { value: 42 } }],
          }))),
        })
        result.env.DO = mockNamespace

        await result.instance.unshard()

        // Data should be persisted in things table
        // (actual persistence depends on implementation)
      })
    })
  })

  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================

  describe('Event Emission', () => {
    it('should emit unshard.started event', async () => {
      // RED: Start event
      const events = captureEvents(result.instance)

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'event-test', equals: () => false },
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ things: [] }))),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard()

      const startedEvent = events.find((e) => e.verb === 'unshard.started')
      expect(startedEvent).toBeDefined()
      expect(startedEvent?.data).toMatchObject({
        shardCount: 4,
      })
    })

    it('should emit unshard.progress events during merge', async () => {
      // RED: Progress events
      const events = captureEvents(result.instance)

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'progress-test', equals: () => false },
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ things: [] }))),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard()

      const progressEvents = events.filter((e) => e.verb === 'unshard.progress')
      expect(progressEvents.length).toBeGreaterThanOrEqual(1)
    })

    it('should emit unshard.completed event on success', async () => {
      // RED: Completion event
      const events = captureEvents(result.instance)

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'complete-test', equals: () => false },
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({
          things: Array(250).fill({ id: 'thing', data: {} }),
        }))),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard()

      const completedEvent = events.find((e) => e.verb === 'unshard.completed')
      expect(completedEvent).toBeDefined()
      expect(completedEvent?.data).toHaveProperty('totalThings')
      expect(completedEvent?.data).toHaveProperty('duration')
    })

    it('should emit unshard.failed event on failure', async () => {
      // RED: Failure event
      const events = captureEvents(result.instance)

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'fail-test', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Unshard failed')),
      })
      result.env.DO = mockNamespace

      await expect(result.instance.unshard()).rejects.toThrow()

      const failedEvent = events.find((e) => e.verb === 'unshard.failed')
      expect(failedEvent).toBeDefined()
    })

    it('should include duration in completed event', async () => {
      // RED: Timing info
      const events = captureEvents(result.instance)

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'timing-test', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 10))
          return new Response(JSON.stringify({ things: [] }))
        }),
      })
      result.env.DO = mockNamespace

      await result.instance.unshard()

      const completedEvent = events.find((e) => e.verb === 'unshard.completed')
      expect((completedEvent?.data as { duration: number }).duration).toBeGreaterThanOrEqual(10)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty shards', async () => {
      // RED: All shards empty
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'empty-test', equals: () => false },
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ things: [] }))),
      })
      result.env.DO = mockNamespace

      // Should not throw
      await expect(result.instance.unshard()).resolves.not.toThrow()
    })

    it('should handle single shard remaining', async () => {
      // RED: Already consolidated
      // Modify to have only 1 shard
      result.sqlData.set('objects', [PHASE3_FIXTURES.shardRegistry[0]])

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'single-test', equals: () => false },
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ things: [] }))),
      })
      result.env.DO = mockNamespace

      // Single shard unshard should work (basically just cleanup)
      await result.instance.unshard()
    })

    it('should handle partial shard failures during merge', async () => {
      // RED: Partial failure handling
      let callCount = 0

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => `partial-${callCount}`, equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          callCount++
          if (callCount === 2) {
            throw new Error('Shard 2 temporarily unavailable')
          }
          return new Response(JSON.stringify({ things: [] }))
        }),
      })
      result.env.DO = mockNamespace

      // Atomic mode should fail entirely
      await expect(result.instance.unshard({ mode: 'atomic' })).rejects.toThrow()
    })

    it('should handle concurrent unshard requests', async () => {
      // RED: Concurrency control
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'concurrent-test', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 50))
          return new Response(JSON.stringify({ things: [] }))
        }),
      })
      result.env.DO = mockNamespace

      const unshard1 = result.instance.unshard()
      const unshard2 = result.instance.unshard()

      const results = await Promise.allSettled([unshard1, unshard2])

      // One should succeed, one should fail (or be blocked)
      const successes = results.filter((r) => r.status === 'fulfilled')
      const failures = results.filter((r) => r.status === 'rejected')

      expect(successes.length).toBe(1)
      expect(failures.length).toBe(1)
    })
  })
})
