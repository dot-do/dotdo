/**
 * Tests for Test Infrastructure Mocks
 *
 * These tests define the expected API for mock classes used in testing:
 * - MockCloneOperation: Simulates clone operations with failure/delay injection
 * - MockShardCoordinator: Simulates shard routing with different strategies
 * - MockReplica: Simulates replica lag and sync behavior
 * - Enhanced MockPipeline: Extended pipeline mock with batch inspection
 *
 * RED PHASE: These tests are expected to fail initially.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  MockCloneOperation,
  createMockCloneOperation,
  MockShardCoordinator,
  createMockShardCoordinator,
  MockReplica,
  createMockReplica,
  type EnhancedMockPipeline,
  createEnhancedMockPipeline,
  type CloneOperationOptions,
  type ShardRoutingStrategy,
  type ShardMetadata,
  type ReplicaState,
} from '../mocks/index'

// =============================================================================
// MockCloneOperation Tests
// =============================================================================

describe('MockCloneOperation', () => {
  describe('construction', () => {
    it('creates instance with default options', () => {
      const clone = createMockCloneOperation()

      expect(clone).toBeInstanceOf(MockCloneOperation)
      expect(clone.getProgress()).toBe(0)
    })

    it('accepts failAt option', () => {
      const clone = createMockCloneOperation({ failAt: 50 })

      expect(clone).toBeInstanceOf(MockCloneOperation)
    })

    it('accepts delayAt and delayMs options', () => {
      const clone = createMockCloneOperation({
        delayAt: 75,
        delayMs: 100,
      })

      expect(clone).toBeInstanceOf(MockCloneOperation)
    })

    it('accepts all options together', () => {
      const clone = createMockCloneOperation({
        failAt: 80,
        delayAt: 50,
        delayMs: 200,
      })

      expect(clone).toBeInstanceOf(MockCloneOperation)
    })
  })

  describe('execute()', () => {
    it('completes successfully with no options', async () => {
      const clone = createMockCloneOperation()

      await clone.execute()

      expect(clone.getProgress()).toBe(100)
    })

    it('updates progress during execution', async () => {
      const clone = createMockCloneOperation()
      const progressUpdates: number[] = []

      // Subscribe to progress updates
      clone.onProgress((progress) => {
        progressUpdates.push(progress)
      })

      await clone.execute()

      expect(progressUpdates.length).toBeGreaterThan(0)
      expect(progressUpdates[progressUpdates.length - 1]).toBe(100)
    })

    it('fails at specified percentage', async () => {
      const clone = createMockCloneOperation({ failAt: 50 })

      await expect(clone.execute()).rejects.toThrow('Clone failed at 50%')

      expect(clone.getProgress()).toBe(50)
    })

    it('fails at 0% when failAt is 0', async () => {
      const clone = createMockCloneOperation({ failAt: 0 })

      await expect(clone.execute()).rejects.toThrow('Clone failed at 0%')

      expect(clone.getProgress()).toBe(0)
    })

    it('fails at 100% when failAt is 100', async () => {
      const clone = createMockCloneOperation({ failAt: 100 })

      await expect(clone.execute()).rejects.toThrow('Clone failed at 100%')

      expect(clone.getProgress()).toBe(100)
    })

    it('delays at specified percentage', async () => {
      const clone = createMockCloneOperation({
        delayAt: 50,
        delayMs: 100,
      })

      const start = Date.now()
      await clone.execute()
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(95) // Allow 5ms tolerance
    })

    it('applies delay before failure when both configured', async () => {
      const clone = createMockCloneOperation({
        failAt: 75,
        delayAt: 50,
        delayMs: 50,
      })

      const start = Date.now()
      await expect(clone.execute()).rejects.toThrow('Clone failed at 75%')
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(45)
    })

    it('does not delay if delayAt is after failAt', async () => {
      const clone = createMockCloneOperation({
        failAt: 25,
        delayAt: 50,
        delayMs: 100,
      })

      const start = Date.now()
      await expect(clone.execute()).rejects.toThrow('Clone failed at 25%')
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(50)
    })
  })

  describe('getProgress()', () => {
    it('returns 0 before execution starts', () => {
      const clone = createMockCloneOperation()

      expect(clone.getProgress()).toBe(0)
    })

    it('returns current progress during execution', async () => {
      const clone = createMockCloneOperation({ failAt: 50 })

      try {
        await clone.execute()
      } catch {
        // Expected failure
      }

      expect(clone.getProgress()).toBe(50)
    })

    it('returns 100 after successful execution', async () => {
      const clone = createMockCloneOperation()

      await clone.execute()

      expect(clone.getProgress()).toBe(100)
    })
  })

  describe('reset()', () => {
    it('resets progress to 0', async () => {
      const clone = createMockCloneOperation()
      await clone.execute()

      clone.reset()

      expect(clone.getProgress()).toBe(0)
    })

    it('allows re-execution after reset', async () => {
      const clone = createMockCloneOperation({ failAt: 50 })

      try {
        await clone.execute()
      } catch {
        // Expected
      }

      clone.reset()
      clone.setOptions({}) // Clear failAt

      await clone.execute()

      expect(clone.getProgress()).toBe(100)
    })
  })
})

// =============================================================================
// MockShardCoordinator Tests
// =============================================================================

describe('MockShardCoordinator', () => {
  describe('construction', () => {
    it('creates instance with shard count', () => {
      const coordinator = createMockShardCoordinator(4)

      expect(coordinator).toBeInstanceOf(MockShardCoordinator)
    })

    it('defaults to hash strategy', () => {
      const coordinator = createMockShardCoordinator(4)

      expect(coordinator.getStrategy()).toBe('hash')
    })

    it('accepts strategy option', () => {
      const coordinator = createMockShardCoordinator(4, { strategy: 'range' })

      expect(coordinator.getStrategy()).toBe('range')
    })

    it('throws if shard count is less than 1', () => {
      expect(() => createMockShardCoordinator(0)).toThrow(
        'Shard count must be at least 1'
      )
    })
  })

  describe('route()', () => {
    describe('hash strategy', () => {
      it('returns shard index within valid range', () => {
        const coordinator = createMockShardCoordinator(4)

        const shard = coordinator.route('test-id')

        expect(shard).toBeGreaterThanOrEqual(0)
        expect(shard).toBeLessThan(4)
      })

      it('returns same shard for same ID (deterministic)', () => {
        const coordinator = createMockShardCoordinator(8)

        const shard1 = coordinator.route('user-123')
        const shard2 = coordinator.route('user-123')
        const shard3 = coordinator.route('user-123')

        expect(shard1).toBe(shard2)
        expect(shard2).toBe(shard3)
      })

      it('distributes different IDs across shards', () => {
        const coordinator = createMockShardCoordinator(4)
        const shardsUsed = new Set<number>()

        // Generate enough IDs to likely hit all shards
        for (let i = 0; i < 100; i++) {
          shardsUsed.add(coordinator.route(`id-${i}`))
        }

        // Should use multiple shards (likely all 4)
        expect(shardsUsed.size).toBeGreaterThan(1)
      })

      it('handles empty string ID', () => {
        const coordinator = createMockShardCoordinator(4)

        const shard = coordinator.route('')

        expect(shard).toBeGreaterThanOrEqual(0)
        expect(shard).toBeLessThan(4)
      })
    })

    describe('range strategy', () => {
      it('routes based on ID lexicographic order', () => {
        const coordinator = createMockShardCoordinator(4, { strategy: 'range' })

        // With 4 shards, IDs starting with a-f, g-l, m-r, s-z should map to different shards
        const shardA = coordinator.route('apple')
        const shardZ = coordinator.route('zebra')

        expect(shardA).not.toBe(shardZ)
      })

      it('routes same prefix to same shard', () => {
        const coordinator = createMockShardCoordinator(4, { strategy: 'range' })

        const shard1 = coordinator.route('app-1')
        const shard2 = coordinator.route('app-2')

        expect(shard1).toBe(shard2)
      })
    })

    describe('roundRobin strategy', () => {
      it('cycles through shards in order', () => {
        const coordinator = createMockShardCoordinator(3, {
          strategy: 'roundRobin',
        })

        // Should cycle: 0, 1, 2, 0, 1, 2, ...
        expect(coordinator.route('id-1')).toBe(0)
        expect(coordinator.route('id-2')).toBe(1)
        expect(coordinator.route('id-3')).toBe(2)
        expect(coordinator.route('id-4')).toBe(0)
        expect(coordinator.route('id-5')).toBe(1)
      })

      it('ignores ID content for routing', () => {
        const coordinator = createMockShardCoordinator(2, {
          strategy: 'roundRobin',
        })

        // First call returns 0, second returns 1, regardless of ID
        const first = coordinator.route('any-id')
        const second = coordinator.route('any-id')

        expect(first).toBe(0)
        expect(second).toBe(1)
      })
    })
  })

  describe('getShards()', () => {
    it('returns list of shard metadata', () => {
      const coordinator = createMockShardCoordinator(3)

      const shards = coordinator.getShards()

      expect(shards).toHaveLength(3)
    })

    it('includes index in shard metadata', () => {
      const coordinator = createMockShardCoordinator(2)

      const shards = coordinator.getShards()

      expect(shards[0].index).toBe(0)
      expect(shards[1].index).toBe(1)
    })

    it('includes shard ID in metadata', () => {
      const coordinator = createMockShardCoordinator(2)

      const shards = coordinator.getShards()

      expect(shards[0].id).toBeDefined()
      expect(typeof shards[0].id).toBe('string')
    })

    it('includes shard status in metadata', () => {
      const coordinator = createMockShardCoordinator(2)

      const shards = coordinator.getShards()

      expect(shards[0].status).toBe('healthy')
    })
  })

  describe('setShardStatus()', () => {
    it('updates shard status', () => {
      const coordinator = createMockShardCoordinator(3)

      coordinator.setShardStatus(1, 'unhealthy')

      const shards = coordinator.getShards()
      expect(shards[1].status).toBe('unhealthy')
    })

    it('throws for invalid shard index', () => {
      const coordinator = createMockShardCoordinator(2)

      expect(() => coordinator.setShardStatus(5, 'unhealthy')).toThrow(
        'Invalid shard index'
      )
    })
  })
})

// =============================================================================
// MockReplica Tests
// =============================================================================

describe('MockReplica', () => {
  describe('construction', () => {
    it('creates instance with primary reference', () => {
      const replica = createMockReplica('primary-do-id')

      expect(replica).toBeInstanceOf(MockReplica)
    })

    it('starts with no lag', () => {
      const replica = createMockReplica('primary')

      expect(replica.getLag()).toBe(0)
    })

    it('starts in synced state', () => {
      const replica = createMockReplica('primary')

      expect(replica.isConsistent()).toBe(true)
    })
  })

  describe('setLag()', () => {
    it('configures simulated lag', () => {
      const replica = createMockReplica('primary')

      replica.setLag(500)

      expect(replica.getLag()).toBe(500)
    })

    it('marks replica as inconsistent when lag is set', () => {
      const replica = createMockReplica('primary')

      replica.setLag(100)

      expect(replica.isConsistent()).toBe(false)
    })

    it('setting lag to 0 does not automatically restore consistency', () => {
      const replica = createMockReplica('primary')
      replica.setLag(100)

      replica.setLag(0)

      // Still inconsistent until sync() is called
      expect(replica.isConsistent()).toBe(false)
    })
  })

  describe('sync()', () => {
    it('triggers sync from primary', async () => {
      const replica = createMockReplica('primary')
      replica.setLag(100)

      await replica.sync()

      expect(replica.isConsistent()).toBe(true)
    })

    it('respects configured lag delay', async () => {
      const replica = createMockReplica('primary')
      replica.setLag(50)

      const start = Date.now()
      await replica.sync()
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(45)
    })

    it('can sync multiple times', async () => {
      const replica = createMockReplica('primary')

      await replica.sync()
      replica.setLag(10)
      await replica.sync()

      expect(replica.isConsistent()).toBe(true)
    })

    it('no-op when already consistent', async () => {
      const replica = createMockReplica('primary')

      const start = Date.now()
      await replica.sync()
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(10)
    })
  })

  describe('getState()', () => {
    it('returns current replica state', () => {
      const replica = createMockReplica('primary-123')

      const state = replica.getState()

      expect(state.primaryRef).toBe('primary-123')
      expect(state.lag).toBe(0)
      expect(state.consistent).toBe(true)
      expect(state.lastSyncAt).toBeDefined()
    })

    it('reflects state changes', () => {
      const replica = createMockReplica('primary')
      replica.setLag(200)

      const state = replica.getState()

      expect(state.lag).toBe(200)
      expect(state.consistent).toBe(false)
    })

    it('updates lastSyncAt after sync', async () => {
      const replica = createMockReplica('primary')
      const stateBefore = replica.getState()

      await new Promise((r) => setTimeout(r, 10))
      replica.setLag(1)
      await replica.sync()

      const stateAfter = replica.getState()
      expect(stateAfter.lastSyncAt).not.toBe(stateBefore.lastSyncAt)
    })
  })

  describe('isConsistent()', () => {
    it('returns true when in sync', () => {
      const replica = createMockReplica('primary')

      expect(replica.isConsistent()).toBe(true)
    })

    it('returns false when lagging', () => {
      const replica = createMockReplica('primary')
      replica.setLag(100)

      expect(replica.isConsistent()).toBe(false)
    })

    it('returns true after sync completes', async () => {
      const replica = createMockReplica('primary')
      replica.setLag(10)

      await replica.sync()

      expect(replica.isConsistent()).toBe(true)
    })
  })

  describe('simulateWrite()', () => {
    it('marks replica as inconsistent', () => {
      const replica = createMockReplica('primary')

      replica.simulateWrite()

      expect(replica.isConsistent()).toBe(false)
    })

    it('applies default lag on write', async () => {
      const replica = createMockReplica('primary')
      replica.setLag(50)
      await replica.sync()

      replica.simulateWrite()

      expect(replica.getLag()).toBeGreaterThan(0)
    })
  })
})

// =============================================================================
// Enhanced MockPipeline Tests
// =============================================================================

describe('EnhancedMockPipeline', () => {
  let pipeline: EnhancedMockPipeline

  beforeEach(() => {
    pipeline = createEnhancedMockPipeline()
  })

  describe('construction', () => {
    it('creates enhanced mock pipeline', () => {
      expect(pipeline).toBeDefined()
      expect(pipeline.events).toBeDefined()
    })

    it('inherits basic pipeline functionality', async () => {
      await pipeline.send([{ type: 'test' }])

      expect(pipeline.events).toHaveLength(1)
    })
  })

  describe('getBatches()', () => {
    it('returns empty array when no events sent', () => {
      const batches = pipeline.getBatches()

      expect(batches).toEqual([])
    })

    it('returns all batched events', async () => {
      await pipeline.send([{ id: 1 }])
      await pipeline.send([{ id: 2 }, { id: 3 }])

      const batches = pipeline.getBatches()

      expect(batches).toHaveLength(2)
      expect(batches[0]).toEqual([{ id: 1 }])
      expect(batches[1]).toEqual([{ id: 2 }, { id: 3 }])
    })

    it('preserves batch structure', async () => {
      await pipeline.send([{ a: 1 }, { b: 2 }])
      await pipeline.send([{ c: 3 }])

      const batches = pipeline.getBatches()

      expect(batches[0]).toHaveLength(2)
      expect(batches[1]).toHaveLength(1)
    })
  })

  describe('getLastBatch()', () => {
    it('returns undefined when no events sent', () => {
      const batch = pipeline.getLastBatch()

      expect(batch).toBeUndefined()
    })

    it('returns most recent batch', async () => {
      await pipeline.send([{ first: true }])
      await pipeline.send([{ second: true }])
      await pipeline.send([{ third: true }])

      const batch = pipeline.getLastBatch()

      expect(batch).toEqual([{ third: true }])
    })
  })

  describe('assertEventSent()', () => {
    it('passes when matching event exists', async () => {
      await pipeline.send([{ type: 'user.created', userId: '123' }])

      expect(() =>
        pipeline.assertEventSent({ type: 'user.created' })
      ).not.toThrow()
    })

    it('fails when no matching event exists', async () => {
      await pipeline.send([{ type: 'user.created' }])

      expect(() => pipeline.assertEventSent({ type: 'user.deleted' })).toThrow(
        'Expected event matching'
      )
    })

    it('supports partial matching', async () => {
      await pipeline.send([
        {
          type: 'order.completed',
          orderId: 'order-123',
          amount: 99.99,
          currency: 'USD',
        },
      ])

      expect(() =>
        pipeline.assertEventSent({ type: 'order.completed', orderId: 'order-123' })
      ).not.toThrow()
    })

    it('supports function matcher', async () => {
      await pipeline.send([{ value: 42 }, { value: 100 }])

      expect(() =>
        pipeline.assertEventSent((event) => event.value > 50)
      ).not.toThrow()
    })

    it('fails with helpful error message', async () => {
      await pipeline.send([{ type: 'a' }, { type: 'b' }])

      expect(() => pipeline.assertEventSent({ type: 'c' })).toThrow(
        /Expected event matching.*but found 2 events/
      )
    })
  })

  describe('assertNoEvents()', () => {
    it('passes when no events have been sent', () => {
      expect(() => pipeline.assertNoEvents()).not.toThrow()
    })

    it('fails when events have been sent', async () => {
      await pipeline.send([{ type: 'unexpected' }])

      expect(() => pipeline.assertNoEvents()).toThrow(
        'Expected no events but found 1'
      )
    })

    it('includes event count in error', async () => {
      await pipeline.send([{ a: 1 }, { b: 2 }, { c: 3 }])

      expect(() => pipeline.assertNoEvents()).toThrow(
        'Expected no events but found 3'
      )
    })
  })

  describe('setBackpressure()', () => {
    it('can enable backpressure', () => {
      pipeline.setBackpressure(true)

      expect(pipeline.hasBackpressure()).toBe(true)
    })

    it('can disable backpressure', () => {
      pipeline.setBackpressure(true)
      pipeline.setBackpressure(false)

      expect(pipeline.hasBackpressure()).toBe(false)
    })

    it('rejects sends when backpressure is enabled', async () => {
      pipeline.setBackpressure(true)

      await expect(pipeline.send([{ data: 'test' }])).rejects.toThrow(
        'Pipeline backpressure'
      )
    })

    it('queues events during backpressure if configured', async () => {
      const queueingPipeline = createEnhancedMockPipeline({
        queueOnBackpressure: true,
      })
      queueingPipeline.setBackpressure(true)

      await queueingPipeline.send([{ queued: true }])

      expect(queueingPipeline.getQueuedEvents()).toHaveLength(1)
    })

    it('flushes queued events when backpressure is released', async () => {
      const queueingPipeline = createEnhancedMockPipeline({
        queueOnBackpressure: true,
      })
      queueingPipeline.setBackpressure(true)
      await queueingPipeline.send([{ queued: 1 }])
      await queueingPipeline.send([{ queued: 2 }])

      queueingPipeline.setBackpressure(false)
      await queueingPipeline.flushQueue()

      expect(queueingPipeline.events).toHaveLength(2)
      expect(queueingPipeline.getQueuedEvents()).toHaveLength(0)
    })
  })

  describe('clear()', () => {
    it('clears batches as well as events', async () => {
      await pipeline.send([{ batch: 1 }])
      await pipeline.send([{ batch: 2 }])

      pipeline.clear()

      expect(pipeline.getBatches()).toHaveLength(0)
    })

    it('resets backpressure state', () => {
      pipeline.setBackpressure(true)

      pipeline.clear()

      expect(pipeline.hasBackpressure()).toBe(false)
    })
  })
})
