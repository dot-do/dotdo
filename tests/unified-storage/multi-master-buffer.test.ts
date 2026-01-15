/**
 * Multi-Master Buffer Overflow Tests - TDD RED Phase
 *
 * These tests expose a critical bug in MultiMasterManager where the event buffer
 * can grow unboundedly despite having a maxEventBufferSize configuration.
 *
 * Bug Location: /objects/unified-storage/multi-master.ts ~line 567
 * - `this.eventBuffer.get(key)!.push(event)` pushes events without checking maxEventBufferSize
 * - The maxEventBufferSize is configured but never enforced
 * - This causes unbounded memory growth under high load
 *
 * Expected Behavior (what these tests verify):
 * 1. Buffer should NOT exceed maxEventBufferSize
 * 2. Oldest events should be evicted when buffer is full (FIFO eviction)
 * 3. Memory should be bounded under sustained high load
 *
 * @issue do-9q3e
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  MultiMasterManager,
  type WriteEvent,
} from '../../objects/unified-storage/multi-master'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Entity {
  $id: string
  $type: string
  $version: number
  data: Record<string, unknown>
  updatedAt: number
}

// ============================================================================
// MOCK FACTORIES
// ============================================================================

/**
 * Create a mock Pipeline for event propagation
 */
function createMockPipeline() {
  const subscribers: Map<string, ((event: WriteEvent) => Promise<void>)[]> = new Map()
  const events: WriteEvent[] = []

  return {
    send: vi.fn(async (event: WriteEvent) => {
      events.push(event)
      // Don't auto-propagate for these tests - we control delivery manually
    }),
    subscribe: vi.fn((masterId: string, handler: (event: WriteEvent) => Promise<void>) => {
      if (!subscribers.has(masterId)) {
        subscribers.set(masterId, [])
      }
      subscribers.get(masterId)!.push(handler)
      return () => {
        const handlers = subscribers.get(masterId)
        if (handlers) {
          const index = handlers.indexOf(handler)
          if (index >= 0) handlers.splice(index, 1)
        }
      }
    }),
    getEvents: () => events,
    clear: () => {
      events.length = 0
      subscribers.clear()
    },
  }
}

type MockPipeline = ReturnType<typeof createMockPipeline>

/**
 * Create a mock in-memory state manager for a master
 */
function createMockStateManager() {
  const entities = new Map<string, Entity>()

  return {
    get: vi.fn(async (id: string) => entities.get(id)),
    set: vi.fn(async (id: string, entity: Entity) => {
      entities.set(id, entity)
      return entity
    }),
    delete: vi.fn(async (id: string) => {
      const existed = entities.has(id)
      entities.delete(id)
      return existed
    }),
    list: vi.fn(async () => Array.from(entities.values())),
    getAll: () => entities,
    clear: () => entities.clear(),
  }
}

type MockStateManager = ReturnType<typeof createMockStateManager>

/**
 * Create a WriteEvent that will be buffered (has unmet dependencies)
 * These events have vectorClock values that skip earlier events,
 * causing them to be buffered until dependencies are met.
 */
function createBufferableEvent(
  masterId: string,
  entityId: string,
  clockValue: number,
  data: Record<string, unknown> = {}
): WriteEvent {
  return {
    type: 'write',
    masterId,
    entityId,
    entityType: 'TestEntity',
    data,
    // Events with clock > 1 and only one node will be buffered
    // because we haven't seen events 1 through (clockValue - 1)
    vectorClock: { [masterId]: clockValue },
    timestamp: Date.now() + clockValue,
  }
}

// ============================================================================
// TEST SUITE: Event Buffer Overflow
// ============================================================================

describe('MultiMasterManager - Event Buffer Overflow', () => {
  let master: MultiMasterManager
  let mockPipeline: MockPipeline
  let stateManager: MockStateManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))

    mockPipeline = createMockPipeline()
    stateManager = createMockStateManager()
  })

  afterEach(async () => {
    if (master) await master.close?.()
    vi.useRealTimers()
  })

  // ==========================================================================
  // Core Buffer Limit Tests
  // ==========================================================================

  describe('buffer size enforcement', () => {
    it('should NOT exceed maxEventBufferSize when buffering events', async () => {
      // Given: A master with a small buffer limit
      const maxBufferSize = 10
      master = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManager as any,
        eventBufferSize: maxBufferSize,
      })

      // When: We send more events than the buffer limit
      // These events will be buffered because they have unmet dependencies
      // (vectorClock has values > 1 but we never sent event 1)
      const eventsToSend = 25
      for (let i = 0; i < eventsToSend; i++) {
        const event = createBufferableEvent(
          `remote-master-${i % 3}`, // Spread across 3 different remote masters
          `entity-${i}`,
          100 + i, // High clock value ensures buffering (unmet deps)
          { index: i }
        )
        await master.applyRemoteEvent(event)
      }

      // Then: Buffer should NOT exceed the configured limit
      // THIS TEST SHOULD FAIL because the bug allows unbounded growth
      const bufferedCount = master.getBufferedEventCount()
      expect(bufferedCount).toBeLessThanOrEqual(maxBufferSize)
    })

    it('should respect buffer limit per key when events target same entity', async () => {
      // Given: A master with a small buffer limit
      const maxBufferSize = 5
      master = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManager as any,
        eventBufferSize: maxBufferSize,
      })

      // When: We send many events for the SAME entity from the same sender
      // These all go to the same buffer key: "remote-master:entity-1"
      const eventsToSend = 20
      for (let i = 0; i < eventsToSend; i++) {
        const event = createBufferableEvent(
          'remote-master',
          'entity-1',
          100 + i, // Each event has increasing clock, all will be buffered
          { index: i }
        )
        await master.applyRemoteEvent(event)
      }

      // Then: Even for a single key, buffer should be bounded
      // THIS TEST SHOULD FAIL because per-key buffers grow unboundedly
      const bufferedCount = master.getBufferedEventCount()
      expect(bufferedCount).toBeLessThanOrEqual(maxBufferSize)
    })

    it('should enforce buffer limit with very small maxEventBufferSize', async () => {
      // Given: A master with minimal buffer (edge case)
      const maxBufferSize = 3
      master = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManager as any,
        eventBufferSize: maxBufferSize,
      })

      // When: We exceed the tiny limit
      for (let i = 0; i < 10; i++) {
        const event = createBufferableEvent('remote', `entity-${i}`, 50 + i)
        await master.applyRemoteEvent(event)
      }

      // Then: Should still respect the limit
      expect(master.getBufferedEventCount()).toBeLessThanOrEqual(maxBufferSize)
    })
  })

  // ==========================================================================
  // FIFO Eviction Tests
  // ==========================================================================

  describe('FIFO eviction policy', () => {
    it('should evict oldest events when buffer is full', async () => {
      // Given: A master with small buffer
      const maxBufferSize = 5
      master = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManager as any,
        eventBufferSize: maxBufferSize,
      })

      // When: We fill the buffer and then add more events
      // First batch - these should be evicted
      for (let i = 0; i < 3; i++) {
        const event = createBufferableEvent('remote', `entity-old-${i}`, 100 + i, {
          batch: 'old',
          index: i,
        })
        await master.applyRemoteEvent(event)
      }

      // Second batch - these should remain
      for (let i = 0; i < 5; i++) {
        const event = createBufferableEvent('remote', `entity-new-${i}`, 200 + i, {
          batch: 'new',
          index: i,
        })
        await master.applyRemoteEvent(event)
      }

      // Then: Only the newest events should remain in buffer
      // The implementation should use FIFO eviction
      const bufferedCount = master.getBufferedEventCount()
      expect(bufferedCount).toBeLessThanOrEqual(maxBufferSize)

      // Note: Without access to buffer internals, we verify via count
      // A proper implementation would evict oldest first
    })

    it('should preserve most recent events under overflow', async () => {
      // Given: A master with a buffer limit
      const maxBufferSize = 10
      master = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManager as any,
        eventBufferSize: maxBufferSize,
      })

      // When: We send events that will overflow the buffer
      const totalEvents = 50
      for (let i = 0; i < totalEvents; i++) {
        const event = createBufferableEvent(
          'remote-master',
          `entity-${i}`,
          1000 + i, // High clock ensures buffering
          { sequenceNumber: i }
        )
        await master.applyRemoteEvent(event)
      }

      // Then: Buffer should contain only the configured max
      // and metrics should reflect bounded growth
      const metrics = master.getMetrics()
      expect(metrics.eventBufferSize).toBeLessThanOrEqual(maxBufferSize)
    })
  })

  // ==========================================================================
  // Memory Pressure Tests
  // ==========================================================================

  describe('memory pressure scenarios', () => {
    it('should handle sustained high event rate without memory growth', async () => {
      // Given: A master with bounded buffer
      const maxBufferSize = 100
      master = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManager as any,
        eventBufferSize: maxBufferSize,
      })

      // When: Sustained burst of events over time
      // Simulating a partition scenario where events pile up
      const burstSize = 500
      for (let i = 0; i < burstSize; i++) {
        const event = createBufferableEvent(
          `master-${i % 10}`, // 10 different masters
          `entity-${i % 50}`, // 50 different entities
          1000 + i,
          { data: `payload-${i}`, timestamp: Date.now() + i }
        )
        await master.applyRemoteEvent(event)

        // Advance time slightly to simulate real conditions
        if (i % 10 === 0) {
          await vi.advanceTimersByTimeAsync(1)
        }
      }

      // Then: Memory (buffer) should be bounded
      const finalBufferSize = master.getBufferedEventCount()
      expect(finalBufferSize).toBeLessThanOrEqual(maxBufferSize)
    })

    it('should handle large payload events without exceeding buffer limit', async () => {
      // Given: A master with buffer limit
      const maxBufferSize = 10
      master = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManager as any,
        eventBufferSize: maxBufferSize,
      })

      // When: We send events with large payloads
      const largePayload = {
        field1: 'x'.repeat(1000),
        field2: 'y'.repeat(1000),
        nested: { data: 'z'.repeat(500) },
      }

      for (let i = 0; i < 50; i++) {
        const event = createBufferableEvent(
          'remote-master',
          `entity-${i}`,
          500 + i,
          { ...largePayload, index: i }
        )
        await master.applyRemoteEvent(event)
      }

      // Then: Count-based limit should still be enforced
      expect(master.getBufferedEventCount()).toBeLessThanOrEqual(maxBufferSize)
    })

    it('should not leak memory when buffer keys are created and cleared', async () => {
      // Given: A master with buffer limit
      const maxBufferSize = 20
      master = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManager as any,
        eventBufferSize: maxBufferSize,
      })

      // When: We create buffer entries and then satisfy their dependencies
      // This simulates normal operation with buffer churn

      // First, create buffered events (event #2 for each key)
      for (let i = 0; i < 10; i++) {
        const event2 = createBufferableEvent(
          'remote-master',
          `entity-${i}`,
          2, // Requires event 1 to be seen first
          { step: 2 }
        )
        await master.applyRemoteEvent(event2)
      }

      const bufferSizeBefore = master.getBufferedEventCount()
      expect(bufferSizeBefore).toBeGreaterThan(0)

      // Then send the missing dependency events (event #1 for each key)
      for (let i = 0; i < 10; i++) {
        const event1: WriteEvent = {
          type: 'write',
          masterId: 'remote-master',
          entityId: `entity-${i}`,
          entityType: 'TestEntity',
          data: { step: 1 },
          vectorClock: { 'remote-master': 1 },
          timestamp: Date.now(),
        }
        await master.applyRemoteEvent(event1)
      }

      // Buffer should be cleared as dependencies are satisfied
      const bufferSizeAfter = master.getBufferedEventCount()
      expect(bufferSizeAfter).toBe(0)
    })
  })

  // ==========================================================================
  // Multi-Source Overflow Tests
  // ==========================================================================

  describe('multi-source buffer overflow', () => {
    it('should enforce global buffer limit across multiple remote masters', async () => {
      // Given: A master receiving events from many remote masters
      const maxBufferSize = 15
      master = new MultiMasterManager({
        masterId: 'local-master',
        pipeline: mockPipeline as any,
        stateManager: stateManager as any,
        eventBufferSize: maxBufferSize,
      })

      // When: Events arrive from 10 different remote masters
      const numRemoteMasters = 10
      const eventsPerMaster = 10

      for (let m = 0; m < numRemoteMasters; m++) {
        for (let e = 0; e < eventsPerMaster; e++) {
          const event = createBufferableEvent(
            `remote-master-${m}`,
            `entity-${m}-${e}`,
            100 + e,
            { master: m, event: e }
          )
          await master.applyRemoteEvent(event)
        }
      }

      // Then: Total buffer should not exceed limit (100 events sent, max 15)
      const totalBuffered = master.getBufferedEventCount()
      expect(totalBuffered).toBeLessThanOrEqual(maxBufferSize)
    })

    it('should handle concurrent overflow from multiple entity keys', async () => {
      // Given: A master with small buffer
      const maxBufferSize = 8
      master = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManager as any,
        eventBufferSize: maxBufferSize,
      })

      // When: Events for 20 different entities arrive (all bufferable)
      for (let i = 0; i < 20; i++) {
        const event = createBufferableEvent(
          'remote',
          `entity-${i}`,
          99, // Same high clock for all
          { index: i }
        )
        await master.applyRemoteEvent(event)
      }

      // Then: Only maxBufferSize events should be retained
      expect(master.getBufferedEventCount()).toBeLessThanOrEqual(maxBufferSize)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle maxEventBufferSize of 0 (no buffering)', async () => {
      // Given: A master configured to not buffer any events
      master = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManager as any,
        eventBufferSize: 0,
      })

      // When: Bufferable events arrive
      const event = createBufferableEvent('remote', 'entity-1', 50)
      await master.applyRemoteEvent(event)

      // Then: No events should be buffered (they would be dropped)
      expect(master.getBufferedEventCount()).toBe(0)
    })

    it('should handle maxEventBufferSize of 1', async () => {
      // Given: A master with minimal buffer
      master = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManager as any,
        eventBufferSize: 1,
      })

      // When: Multiple bufferable events arrive
      for (let i = 0; i < 10; i++) {
        const event = createBufferableEvent('remote', `entity-${i}`, 100 + i)
        await master.applyRemoteEvent(event)
      }

      // Then: Only 1 event should be buffered
      expect(master.getBufferedEventCount()).toBeLessThanOrEqual(1)
    })

    it('should report correct buffer size in metrics after overflow', async () => {
      // Given: A master with known buffer limit
      const maxBufferSize = 10
      master = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManager as any,
        eventBufferSize: maxBufferSize,
      })

      // When: We overflow the buffer
      for (let i = 0; i < 100; i++) {
        const event = createBufferableEvent('remote', `entity-${i}`, 200 + i)
        await master.applyRemoteEvent(event)
      }

      // Then: Metrics should accurately reflect the bounded buffer
      const metrics = master.getMetrics()
      expect(metrics.eventBufferSize).toBeLessThanOrEqual(maxBufferSize)
      expect(metrics.eventBufferSize).toBe(master.getBufferedEventCount())
    })

    it('should handle rapid alternating writes and buffer growth', async () => {
      // Given: A master
      const maxBufferSize = 5
      master = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManager as any,
        eventBufferSize: maxBufferSize,
      })

      // When: We alternate between local writes and receiving bufferable remote events
      for (let i = 0; i < 20; i++) {
        // Local write (doesn't affect event buffer)
        await master.write(`local-entity-${i}`, { local: true })

        // Remote bufferable event
        const event = createBufferableEvent('remote', `remote-entity-${i}`, 100 + i)
        await master.applyRemoteEvent(event)
      }

      // Then: Buffer should still be bounded despite interleaved operations
      expect(master.getBufferedEventCount()).toBeLessThanOrEqual(maxBufferSize)
    })
  })
})
