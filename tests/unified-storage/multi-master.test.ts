/**
 * MultiMasterManager tests - Multi-master replication with eventual consistency
 *
 * Multi-master replication enables geo-distributed writes with:
 * - Multiple masters accepting writes independently
 * - All writes emit to shared Pipeline
 * - Each master subscribes to Pipeline and applies remote events
 * - Vector clocks track causality
 * - Conflicts resolved by configured strategy
 *
 * NOTE: These tests are designed to FAIL because the implementation does not exist yet.
 * This is the TDD RED phase.
 *
 * @see /objects/unified-storage/multi-master.ts (to be created in GREEN phase)
 * @issue do-2tr.1.2
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import from non-existent module - this will cause tests to fail
import {
  MultiMasterManager,
  VectorClock,
  type MultiMasterConfig,
  type MasterNode,
  type RemoteEvent,
  type ConflictStrategy,
  type ConflictResult,
  type MultiMasterMetrics,
} from '../../objects/unified-storage/multi-master'

// ============================================================================
// TYPE DEFINITIONS (Expected Interface)
// ============================================================================

/**
 * Entity stored in a master
 */
interface Entity {
  $id: string
  $type: string
  $version: number
  data: Record<string, unknown>
  updatedAt: number
}

/**
 * Write event emitted to Pipeline
 */
interface WriteEvent {
  type: 'write'
  masterId: string
  entityId: string
  entityType: string
  data: Record<string, unknown>
  vectorClock: Record<string, number>
  timestamp: number
}

// ============================================================================
// MOCK FACTORIES
// ============================================================================

/**
 * Create a mock Pipeline for event propagation
 * Uses batch interface: send(events: unknown[])
 */
function createMockPipeline() {
  const subscribers: Map<string, ((event: WriteEvent) => Promise<void>)[]> = new Map()
  const events: WriteEvent[] = []

  return {
    // Batch interface - receives array of events
    send: vi.fn(async (eventBatch: unknown[]) => {
      for (const evt of eventBatch as WriteEvent[]) {
        events.push(evt)
        // Notify all subscribers except the sender
        for (const [masterId, handlers] of subscribers) {
          if (masterId !== evt.masterId) {
            for (const handler of handlers) {
              await handler(evt)
            }
          }
        }
      }
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

// ============================================================================
// TEST SUITE
// ============================================================================

describe('MultiMasterManager', () => {
  let masterA: MultiMasterManager
  let masterB: MultiMasterManager
  let mockPipeline: MockPipeline
  let stateManagerA: MockStateManager
  let stateManagerB: MockStateManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))

    mockPipeline = createMockPipeline()
    stateManagerA = createMockStateManager()
    stateManagerB = createMockStateManager()
  })

  afterEach(async () => {
    if (masterA) await masterA.close?.()
    if (masterB) await masterB.close?.()
    vi.useRealTimers()
  })

  // ==========================================================================
  // Concurrent Writes Tests
  // ==========================================================================

  describe('concurrent writes', () => {
    beforeEach(() => {
      masterA = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManagerA as any,
      })

      masterB = new MultiMasterManager({
        masterId: 'master-b',
        pipeline: mockPipeline as any,
        stateManager: stateManagerB as any,
      })
    })

    it('should accept writes on any master', async () => {
      // Given: Two masters in the cluster
      // When: Writing to master A
      const resultA = await masterA.write('entity-1', { name: 'Alice' })

      // Then: Write should succeed
      expect(resultA.success).toBe(true)
      expect(resultA.entityId).toBe('entity-1')
      expect(resultA.masterId).toBe('master-a')
    })

    it('should emit write event to Pipeline with vector clock', async () => {
      // Given: A master in the cluster
      // When: Writing an entity
      await masterA.write('entity-1', { name: 'Alice' })

      // Then: Event should be emitted to Pipeline
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)

      const emittedEvent = mockPipeline.getEvents()[0]
      expect(emittedEvent).toBeDefined()
      expect(emittedEvent.type).toBe('write')
      expect(emittedEvent.masterId).toBe('master-a')
      expect(emittedEvent.entityId).toBe('entity-1')
      expect(emittedEvent.vectorClock).toBeDefined()
      expect(emittedEvent.vectorClock['master-a']).toBe(1)
    })

    it('should process writes from multiple masters simultaneously', async () => {
      // Given: Two masters ready to write
      // When: Both masters write different entities concurrently
      const writeA = masterA.write('entity-a', { name: 'From A' })
      const writeB = masterB.write('entity-b', { name: 'From B' })

      await vi.advanceTimersByTimeAsync(10)
      const [resultA, resultB] = await Promise.all([writeA, writeB])

      // Then: Both writes should succeed
      expect(resultA.success).toBe(true)
      expect(resultB.success).toBe(true)

      // And: Both events should be in the Pipeline
      expect(mockPipeline.getEvents()).toHaveLength(2)
    })

    it('should apply remote events to local state', async () => {
      // Given: Two masters subscribed to Pipeline
      await masterA.subscribe()
      await masterB.subscribe()

      // When: Master A writes an entity
      await masterA.write('entity-1', { name: 'Alice' })

      // Allow event propagation
      await vi.advanceTimersByTimeAsync(10)

      // Then: Master B should have the entity
      const entityOnB = await stateManagerB.get('entity-1')
      expect(entityOnB).toBeDefined()
      expect(entityOnB!.data.name).toBe('Alice')
    })

    it('should not re-apply own events received from Pipeline', async () => {
      // Given: Master A subscribed to Pipeline
      await masterA.subscribe()

      // When: Master A writes an entity
      await masterA.write('entity-1', { name: 'Alice' })
      await vi.advanceTimersByTimeAsync(10)

      // Then: State manager should be called only once for the write
      expect(stateManagerA.set).toHaveBeenCalledTimes(1)
    })

    it('should handle rapid successive writes', async () => {
      // Given: A master ready to write
      await masterA.subscribe()

      // When: Writing rapidly in succession
      for (let i = 0; i < 10; i++) {
        await masterA.write(`entity-${i}`, { index: i })
      }

      await vi.advanceTimersByTimeAsync(100)

      // Then: All writes should be recorded
      const entities = await stateManagerA.list()
      expect(entities).toHaveLength(10)
    })
  })

  // ==========================================================================
  // Vector Clocks Tests
  // ==========================================================================

  describe('vector clocks', () => {
    beforeEach(() => {
      masterA = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManagerA as any,
      })

      masterB = new MultiMasterManager({
        masterId: 'master-b',
        pipeline: mockPipeline as any,
        stateManager: stateManagerB as any,
      })
    })

    it('should maintain local clock for each master', () => {
      // Given: A new master
      // Then: It should have its own clock entry
      const clock = masterA.getVectorClock()
      expect(clock.get('master-a')).toBeDefined()
      expect(clock.get('master-a')).toBe(0)
    })

    it('should increment local clock on each write', async () => {
      // Given: A master with initial clock
      const initialClock = masterA.getVectorClock().get('master-a')

      // When: Writing multiple times
      await masterA.write('entity-1', { data: 1 })
      await masterA.write('entity-2', { data: 2 })
      await masterA.write('entity-3', { data: 3 })

      // Then: Clock should increment
      const finalClock = masterA.getVectorClock().get('master-a')
      expect(finalClock).toBe(initialClock! + 3)
    })

    it('should merge clocks on receiving remote event', async () => {
      // Given: Two masters subscribed
      await masterA.subscribe()
      await masterB.subscribe()

      // When: Master A writes
      await masterA.write('entity-1', { name: 'Alice' })
      await vi.advanceTimersByTimeAsync(10)

      // Then: Master B's clock should include master A's entry
      const clockB = masterB.getVectorClock()
      expect(clockB.get('master-a')).toBeGreaterThanOrEqual(1)
    })

    it('should preserve happens-before ordering', async () => {
      // Given: Two masters
      await masterA.subscribe()
      await masterB.subscribe()

      // When: Sequential writes A -> B
      await masterA.write('entity-1', { step: 1 })
      await vi.advanceTimersByTimeAsync(10)

      await masterB.write('entity-1', { step: 2 })
      await vi.advanceTimersByTimeAsync(10)

      // Then: B's clock should dominate A's clock for entity-1
      const clockA = masterA.getVectorClock()
      const clockB = masterB.getVectorClock()

      // B should have seen A's write
      expect(clockB.get('master-a')).toBeGreaterThanOrEqual(clockA.get('master-a')!)
    })

    it('should detect concurrent events from different masters', async () => {
      // Given: Two masters NOT yet subscribed (to simulate partition)
      // When: Both write to the same entity concurrently
      const writeA = masterA.write('entity-1', { source: 'A' })
      const writeB = masterB.write('entity-1', { source: 'B' })

      await Promise.all([writeA, writeB])

      // Then: The vector clocks should indicate concurrent writes
      const eventsFromA = mockPipeline.getEvents().filter(e => e.masterId === 'master-a')
      const eventsFromB = mockPipeline.getEvents().filter(e => e.masterId === 'master-b')

      expect(eventsFromA).toHaveLength(1)
      expect(eventsFromB).toHaveLength(1)

      // Check for concurrent clocks
      const clockA = eventsFromA[0]!.vectorClock
      const clockB = eventsFromB[0]!.vectorClock

      // Neither should dominate the other (concurrent)
      const aBeforeB = VectorClock.happensBefore(clockA, clockB)
      const bBeforeA = VectorClock.happensBefore(clockB, clockA)

      expect(aBeforeB).toBe(false)
      expect(bBeforeA).toBe(false)
    })

    it('should detect sequential events', async () => {
      // Given: Two masters subscribed
      await masterA.subscribe()
      await masterB.subscribe()

      // When: A writes, then B writes after receiving A's event
      await masterA.write('entity-1', { step: 1 })
      await vi.advanceTimersByTimeAsync(50)

      await masterB.write('entity-1', { step: 2 })
      await vi.advanceTimersByTimeAsync(50)

      // Then: A's write should happen-before B's write
      const events = mockPipeline.getEvents()
      const eventA = events.find(e => e.masterId === 'master-a')
      const eventB = events.find(e => e.masterId === 'master-b' && e.data.step === 2)

      expect(eventA).toBeDefined()
      expect(eventB).toBeDefined()

      const aBeforeB = VectorClock.happensBefore(eventA!.vectorClock, eventB!.vectorClock)
      expect(aBeforeB).toBe(true)
    })
  })

  // ==========================================================================
  // VectorClock Class Tests
  // ==========================================================================

  describe('VectorClock', () => {
    describe('creation and manipulation', () => {
      it('should create empty vector clock', () => {
        const clock = new VectorClock()
        expect(clock.isEmpty()).toBe(true)
      })

      it('should create vector clock with initial value', () => {
        const clock = new VectorClock({ 'master-a': 1 })
        expect(clock.get('master-a')).toBe(1)
        expect(clock.isEmpty()).toBe(false)
      })

      it('should increment clock for a node', () => {
        const clock = new VectorClock()
        clock.increment('master-a')
        expect(clock.get('master-a')).toBe(1)

        clock.increment('master-a')
        expect(clock.get('master-a')).toBe(2)
      })

      it('should return 0 for unknown node', () => {
        const clock = new VectorClock()
        expect(clock.get('unknown')).toBe(0)
      })
    })

    describe('comparison', () => {
      it('should detect identical clocks', () => {
        const clock1 = new VectorClock({ a: 1, b: 2 })
        const clock2 = new VectorClock({ a: 1, b: 2 })

        expect(VectorClock.compare(clock1, clock2)).toBe('equal')
      })

      it('should detect happens-before relationship', () => {
        const clock1 = new VectorClock({ a: 1, b: 1 })
        const clock2 = new VectorClock({ a: 2, b: 1 })

        expect(VectorClock.compare(clock1, clock2)).toBe('before')
        expect(VectorClock.happensBefore(clock1, clock2)).toBe(true)
      })

      it('should detect happens-after relationship', () => {
        const clock1 = new VectorClock({ a: 2, b: 2 })
        const clock2 = new VectorClock({ a: 1, b: 1 })

        expect(VectorClock.compare(clock1, clock2)).toBe('after')
        expect(VectorClock.happensBefore(clock2, clock1)).toBe(true)
      })

      it('should detect concurrent clocks', () => {
        const clock1 = new VectorClock({ a: 2, b: 1 })
        const clock2 = new VectorClock({ a: 1, b: 2 })

        expect(VectorClock.compare(clock1, clock2)).toBe('concurrent')
        expect(VectorClock.happensBefore(clock1, clock2)).toBe(false)
        expect(VectorClock.happensBefore(clock2, clock1)).toBe(false)
      })

      it('should handle clocks with different nodes', () => {
        const clock1 = new VectorClock({ a: 1 })
        const clock2 = new VectorClock({ a: 1, b: 1 })

        // clock1 happens before clock2 (missing node means 0)
        expect(VectorClock.compare(clock1, clock2)).toBe('before')
      })
    })

    describe('merge', () => {
      it('should merge two clocks taking max of each component', () => {
        const clock1 = new VectorClock({ a: 2, b: 1 })
        const clock2 = new VectorClock({ a: 1, b: 3, c: 1 })

        const merged = VectorClock.merge(clock1, clock2)

        expect(merged.get('a')).toBe(2)
        expect(merged.get('b')).toBe(3)
        expect(merged.get('c')).toBe(1)
      })

      it('should handle empty clock in merge', () => {
        const clock1 = new VectorClock({ a: 1 })
        const clock2 = new VectorClock()

        const merged = VectorClock.merge(clock1, clock2)
        expect(merged.get('a')).toBe(1)
      })
    })

    describe('serialization', () => {
      it('should serialize to JSON', () => {
        const clock = new VectorClock({ a: 1, b: 2 })
        const json = clock.toJSON()

        expect(json).toEqual({ a: 1, b: 2 })
      })

      it('should deserialize from JSON', () => {
        const json = { a: 1, b: 2 }
        const clock = VectorClock.fromJSON(json)

        expect(clock.get('a')).toBe(1)
        expect(clock.get('b')).toBe(2)
      })

      it('should create copy', () => {
        const original = new VectorClock({ a: 1 })
        const copy = original.copy()

        copy.increment('a')

        expect(original.get('a')).toBe(1)
        expect(copy.get('a')).toBe(2)
      })
    })
  })

  // ==========================================================================
  // Event Propagation Tests
  // ==========================================================================

  describe('event propagation', () => {
    beforeEach(() => {
      masterA = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManagerA as any,
      })

      masterB = new MultiMasterManager({
        masterId: 'master-b',
        pipeline: mockPipeline as any,
        stateManager: stateManagerB as any,
      })
    })

    it('should propagate write from A to B via Pipeline', async () => {
      // Given: Both masters subscribed
      await masterA.subscribe()
      await masterB.subscribe()

      // When: Master A writes
      await masterA.write('entity-1', { name: 'Alice' })
      await vi.advanceTimersByTimeAsync(50)

      // Then: Master B should receive and apply the event
      const entityOnB = await masterB.getEntity('entity-1')
      expect(entityOnB).toBeDefined()
      expect(entityOnB!.data.name).toBe('Alice')
    })

    it('should propagate write from B to A via Pipeline', async () => {
      // Given: Both masters subscribed
      await masterA.subscribe()
      await masterB.subscribe()

      // When: Master B writes
      await masterB.write('entity-1', { name: 'Bob' })
      await vi.advanceTimersByTimeAsync(50)

      // Then: Master A should receive and apply the event
      const entityOnA = await masterA.getEntity('entity-1')
      expect(entityOnA).toBeDefined()
      expect(entityOnA!.data.name).toBe('Bob')
    })

    it('should handle bidirectional propagation', async () => {
      // Given: Both masters subscribed
      await masterA.subscribe()
      await masterB.subscribe()

      // When: Both masters write different entities
      await masterA.write('entity-a', { source: 'A' })
      await masterB.write('entity-b', { source: 'B' })
      await vi.advanceTimersByTimeAsync(100)

      // Then: Both should have both entities
      expect(await masterA.getEntity('entity-a')).toBeDefined()
      expect(await masterA.getEntity('entity-b')).toBeDefined()
      expect(await masterB.getEntity('entity-a')).toBeDefined()
      expect(await masterB.getEntity('entity-b')).toBeDefined()
    })

    it('should apply events in causal order', async () => {
      // Given: Both masters subscribed
      await masterA.subscribe()
      await masterB.subscribe()

      // When: Sequential writes with causal dependency
      await masterA.write('entity-1', { version: 1 })
      await vi.advanceTimersByTimeAsync(50)

      await masterB.write('entity-1', { version: 2 })
      await vi.advanceTimersByTimeAsync(50)

      await masterA.write('entity-1', { version: 3 })
      await vi.advanceTimersByTimeAsync(50)

      // Then: Both should converge to version 3
      const entityOnA = await masterA.getEntity('entity-1')
      const entityOnB = await masterB.getEntity('entity-1')

      expect(entityOnA!.data.version).toBe(3)
      expect(entityOnB!.data.version).toBe(3)
    })

    it('should handle events arriving out of order', async () => {
      // Given: Master B subscribed
      await masterB.subscribe()

      // Simulate out-of-order delivery by manually sending events
      const event1: WriteEvent = {
        type: 'write',
        masterId: 'master-a',
        entityId: 'entity-1',
        entityType: 'TestEntity',
        data: { step: 1 },
        vectorClock: { 'master-a': 1 },
        timestamp: Date.now(),
      }

      const event2: WriteEvent = {
        type: 'write',
        masterId: 'master-a',
        entityId: 'entity-1',
        entityType: 'TestEntity',
        data: { step: 2 },
        vectorClock: { 'master-a': 2 },
        timestamp: Date.now() + 100,
      }

      // Send event2 first, then event1 (out of order)
      await masterB.applyRemoteEvent(event2)
      await masterB.applyRemoteEvent(event1)

      // Then: Should converge to the causally latest state (step: 2)
      const entity = await masterB.getEntity('entity-1')
      expect(entity!.data.step).toBe(2)
    })

    it('should buffer events until dependencies are met', async () => {
      // Given: Master B subscribed
      await masterB.subscribe()

      // When: Sending event that depends on unseen event
      const event2: WriteEvent = {
        type: 'write',
        masterId: 'master-a',
        entityId: 'entity-1',
        entityType: 'TestEntity',
        data: { step: 2 },
        vectorClock: { 'master-a': 2 }, // Depends on master-a:1
        timestamp: Date.now(),
      }

      await masterB.applyRemoteEvent(event2)

      // Then: Event should be buffered
      expect(masterB.getBufferedEventCount()).toBeGreaterThan(0)

      // When: Sending the missing dependency
      const event1: WriteEvent = {
        type: 'write',
        masterId: 'master-a',
        entityId: 'entity-1',
        entityType: 'TestEntity',
        data: { step: 1 },
        vectorClock: { 'master-a': 1 },
        timestamp: Date.now() - 100,
      }

      await masterB.applyRemoteEvent(event1)
      await vi.advanceTimersByTimeAsync(10)

      // Then: Buffer should be empty and both events applied
      expect(masterB.getBufferedEventCount()).toBe(0)
      const entity = await masterB.getEntity('entity-1')
      expect(entity!.data.step).toBe(2)
    })
  })

  // ==========================================================================
  // Conflict Detection Tests
  // ==========================================================================

  describe('conflict detection', () => {
    beforeEach(() => {
      masterA = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManagerA as any,
        conflictStrategy: 'detect', // Don't auto-resolve
      })

      masterB = new MultiMasterManager({
        masterId: 'master-b',
        pipeline: mockPipeline as any,
        stateManager: stateManagerB as any,
        conflictStrategy: 'detect',
      })
    })

    it('should detect concurrent modifications to same entity', async () => {
      // Given: Both masters NOT subscribed (simulating partition)
      // When: Both write to the same entity concurrently
      await masterA.write('entity-1', { name: 'Alice' })
      await masterB.write('entity-1', { name: 'Bob' })

      // Then: When they receive each other's events, conflict should be detected
      const eventFromA = mockPipeline.getEvents().find(e => e.masterId === 'master-a')
      const eventFromB = mockPipeline.getEvents().find(e => e.masterId === 'master-b')

      // Apply cross events
      const conflictA = await masterA.applyRemoteEvent(eventFromB!)
      const conflictB = await masterB.applyRemoteEvent(eventFromA!)

      expect(conflictA.isConflict).toBe(true)
      expect(conflictB.isConflict).toBe(true)
    })

    it('should not flag sequential modifications as conflicts', async () => {
      // Given: Both masters subscribed
      await masterA.subscribe()
      await masterB.subscribe()

      // When: Sequential writes (A then B)
      await masterA.write('entity-1', { step: 1 })
      await vi.advanceTimersByTimeAsync(50)

      await masterB.write('entity-1', { step: 2 })
      await vi.advanceTimersByTimeAsync(50)

      // Then: No conflicts should be detected
      const conflicts = await masterB.getConflicts()
      expect(conflicts).toHaveLength(0)
    })

    it('should record conflict details', async () => {
      // Given: Concurrent writes creating a conflict
      await masterA.write('entity-1', { name: 'Alice', age: 30 })
      await masterB.write('entity-1', { name: 'Bob', age: 25 })

      const eventFromB = mockPipeline.getEvents().find(e => e.masterId === 'master-b')
      await masterA.applyRemoteEvent(eventFromB!)

      // Then: Conflict should contain both versions
      const conflicts = await masterA.getConflicts()
      expect(conflicts).toHaveLength(1)

      const conflict = conflicts[0]
      expect(conflict!.entityId).toBe('entity-1')
      expect(conflict!.versions).toHaveLength(2)
      expect(conflict!.versions.map(v => v.masterId)).toContain('master-a')
      expect(conflict!.versions.map(v => v.masterId)).toContain('master-b')
    })

    it('should provide conflict resolution options', async () => {
      // Given: A conflict
      await masterA.write('entity-1', { value: 'A' })
      await masterB.write('entity-1', { value: 'B' })

      const eventFromB = mockPipeline.getEvents().find(e => e.masterId === 'master-b')
      await masterA.applyRemoteEvent(eventFromB!)

      // When: Getting resolution options
      const conflicts = await masterA.getConflicts()
      const conflict = conflicts[0]

      // Then: Options should include both versions and auto-resolution strategies
      expect(conflict!.resolutionOptions).toBeDefined()
      expect(conflict!.resolutionOptions).toContain('keep-local')
      expect(conflict!.resolutionOptions).toContain('keep-remote')
      expect(conflict!.resolutionOptions).toContain('lww')
      expect(conflict!.resolutionOptions).toContain('merge')
    })
  })

  // ==========================================================================
  // Conflict Resolution Tests
  // ==========================================================================

  describe('conflict resolution', () => {
    describe('last-writer-wins (LWW)', () => {
      beforeEach(() => {
        masterA = new MultiMasterManager({
          masterId: 'master-a',
          pipeline: mockPipeline as any,
          stateManager: stateManagerA as any,
          conflictStrategy: 'lww',
        })

        masterB = new MultiMasterManager({
          masterId: 'master-b',
          pipeline: mockPipeline as any,
          stateManager: stateManagerB as any,
          conflictStrategy: 'lww',
        })
      })

      it('should resolve to later write', async () => {
        // Given: Two concurrent writes with different timestamps
        vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
        await masterA.write('entity-1', { name: 'Alice' })

        vi.setSystemTime(new Date('2026-01-14T12:00:01.000Z')) // 1 second later
        await masterB.write('entity-1', { name: 'Bob' })

        // When: Events are exchanged
        const eventFromA = mockPipeline.getEvents().find(e => e.masterId === 'master-a')
        const eventFromB = mockPipeline.getEvents().find(e => e.masterId === 'master-b')

        await masterA.applyRemoteEvent(eventFromB!)
        await masterB.applyRemoteEvent(eventFromA!)

        // Then: Both should converge to Bob (later write)
        const entityOnA = await masterA.getEntity('entity-1')
        const entityOnB = await masterB.getEntity('entity-1')

        expect(entityOnA!.data.name).toBe('Bob')
        expect(entityOnB!.data.name).toBe('Bob')
      })

      it('should use master ID as tiebreaker for same timestamp', async () => {
        // Given: Two writes at exactly the same timestamp
        vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
        await masterA.write('entity-1', { name: 'Alice' })
        await masterB.write('entity-1', { name: 'Bob' })

        // Exchange events
        const eventFromA = mockPipeline.getEvents().find(e => e.masterId === 'master-a')
        const eventFromB = mockPipeline.getEvents().find(e => e.masterId === 'master-b')

        await masterA.applyRemoteEvent(eventFromB!)
        await masterB.applyRemoteEvent(eventFromA!)

        // Then: Both should converge to same value (deterministic tiebreaker)
        const entityOnA = await masterA.getEntity('entity-1')
        const entityOnB = await masterB.getEntity('entity-1')

        expect(entityOnA!.data.name).toBe(entityOnB!.data.name)
      })
    })

    describe('custom merge function', () => {
      it('should apply custom merge function for conflicts', async () => {
        // Given: Masters with custom merge function
        const mergeFunction = vi.fn((local: Entity, remote: Entity) => {
          // Merge by combining data
          return {
            ...local,
            data: { ...local.data, ...remote.data },
          }
        })

        masterA = new MultiMasterManager({
          masterId: 'master-a',
          pipeline: mockPipeline as any,
          stateManager: stateManagerA as any,
          conflictStrategy: 'custom',
          mergeFn: mergeFunction,
        })

        // When: Conflict occurs
        await masterA.write('entity-1', { a: 1 })

        const remoteEvent: WriteEvent = {
          type: 'write',
          masterId: 'master-b',
          entityId: 'entity-1',
          entityType: 'TestEntity',
          data: { b: 2 },
          vectorClock: { 'master-b': 1 }, // Concurrent
          timestamp: Date.now(),
        }

        await masterA.applyRemoteEvent(remoteEvent)

        // Then: Merge function should be called
        expect(mergeFunction).toHaveBeenCalled()

        // And: Entity should have merged data
        const entity = await masterA.getEntity('entity-1')
        expect(entity!.data).toEqual({ a: 1, b: 2 })
      })
    })

    describe('manual resolution', () => {
      beforeEach(() => {
        masterA = new MultiMasterManager({
          masterId: 'master-a',
          pipeline: mockPipeline as any,
          stateManager: stateManagerA as any,
          conflictStrategy: 'manual',
        })
      })

      it('should queue conflicts for manual resolution', async () => {
        // Given: A conflict
        await masterA.write('entity-1', { value: 'local' })

        const remoteEvent: WriteEvent = {
          type: 'write',
          masterId: 'master-b',
          entityId: 'entity-1',
          entityType: 'TestEntity',
          data: { value: 'remote' },
          vectorClock: { 'master-b': 1 },
          timestamp: Date.now(),
        }

        await masterA.applyRemoteEvent(remoteEvent)

        // Then: Conflict should be queued
        const pending = await masterA.getPendingConflicts()
        expect(pending).toHaveLength(1)
      })

      it('should allow manual conflict resolution', async () => {
        // Given: A queued conflict
        await masterA.write('entity-1', { value: 'local' })

        const remoteEvent: WriteEvent = {
          type: 'write',
          masterId: 'master-b',
          entityId: 'entity-1',
          entityType: 'TestEntity',
          data: { value: 'remote' },
          vectorClock: { 'master-b': 1 },
          timestamp: Date.now(),
        }

        await masterA.applyRemoteEvent(remoteEvent)

        // When: Resolving manually
        await masterA.resolveConflict('entity-1', { value: 'merged-manually' })

        // Then: Entity should have resolved value
        const entity = await masterA.getEntity('entity-1')
        expect(entity!.data.value).toBe('merged-manually')

        // And: Conflict should be cleared
        const pending = await masterA.getPendingConflicts()
        expect(pending).toHaveLength(0)
      })
    })
  })

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('configuration', () => {
    it('should accept custom configuration', () => {
      const config: MultiMasterConfig = {
        masterId: 'custom-master',
        pipeline: mockPipeline as any,
        stateManager: stateManagerA as any,
        conflictStrategy: 'lww',
        eventBufferSize: 500,
        applyTimeout: 5000,
      }

      masterA = new MultiMasterManager(config)

      expect(masterA.getMasterId()).toBe('custom-master')
      expect(masterA.getConflictStrategy()).toBe('lww')
    })

    it('should have sensible defaults', () => {
      masterA = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManagerA as any,
      })

      expect(masterA.getConflictStrategy()).toBe('lww') // Default
      expect(masterA.getEventBufferSize()).toBeGreaterThan(0)
    })

    it('should allow changing conflict strategy at runtime', async () => {
      masterA = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManagerA as any,
        conflictStrategy: 'lww',
      })

      expect(masterA.getConflictStrategy()).toBe('lww')

      await masterA.setConflictStrategy('manual')

      expect(masterA.getConflictStrategy()).toBe('manual')
    })
  })

  // ==========================================================================
  // Metrics Tests
  // ==========================================================================

  describe('metrics', () => {
    beforeEach(() => {
      masterA = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManagerA as any,
      })
    })

    it('should track write count', async () => {
      await masterA.write('entity-1', { data: 1 })
      await masterA.write('entity-2', { data: 2 })
      await masterA.write('entity-3', { data: 3 })

      const metrics = masterA.getMetrics()
      expect(metrics.writesLocal).toBe(3)
    })

    it('should track applied remote event count', async () => {
      await masterA.subscribe()

      const remoteEvent: WriteEvent = {
        type: 'write',
        masterId: 'master-b',
        entityId: 'entity-1',
        entityType: 'TestEntity',
        data: { value: 'remote' },
        vectorClock: { 'master-b': 1 },
        timestamp: Date.now(),
      }

      await masterA.applyRemoteEvent(remoteEvent)
      await masterA.applyRemoteEvent({ ...remoteEvent, entityId: 'entity-2', vectorClock: { 'master-b': 2 } })

      const metrics = masterA.getMetrics()
      expect(metrics.eventsApplied).toBe(2)
    })

    it('should track conflict count', async () => {
      masterA = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManagerA as any,
        conflictStrategy: 'detect',
      })

      await masterA.write('entity-1', { value: 'local' })

      const remoteEvent: WriteEvent = {
        type: 'write',
        masterId: 'master-b',
        entityId: 'entity-1',
        entityType: 'TestEntity',
        data: { value: 'remote' },
        vectorClock: { 'master-b': 1 },
        timestamp: Date.now(),
      }

      await masterA.applyRemoteEvent(remoteEvent)

      const metrics = masterA.getMetrics()
      expect(metrics.conflictsDetected).toBe(1)
    })

    it('should track event buffer size', async () => {
      // Send event with unmet dependency
      const event: WriteEvent = {
        type: 'write',
        masterId: 'master-b',
        entityId: 'entity-1',
        entityType: 'TestEntity',
        data: { step: 2 },
        vectorClock: { 'master-b': 2 },
        timestamp: Date.now(),
      }

      await masterA.applyRemoteEvent(event)

      const metrics = masterA.getMetrics()
      expect(metrics.eventBufferSize).toBeGreaterThan(0)
    })

    it('should track vector clock size', async () => {
      await masterA.subscribe()
      await masterA.write('entity-1', { data: 1 })

      // Apply event from another master
      const remoteEvent: WriteEvent = {
        type: 'write',
        masterId: 'master-b',
        entityId: 'entity-2',
        entityType: 'TestEntity',
        data: { value: 'remote' },
        vectorClock: { 'master-b': 1 },
        timestamp: Date.now(),
      }
      await masterA.applyRemoteEvent(remoteEvent)

      const metrics = masterA.getMetrics()
      expect(metrics.vectorClockNodes).toBe(2) // master-a and master-b
    })
  })

  // ==========================================================================
  // Edge Cases Tests
  // ==========================================================================

  describe('edge cases', () => {
    beforeEach(() => {
      masterA = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManagerA as any,
      })
    })

    it('should handle write to non-existent entity', async () => {
      const result = await masterA.write('new-entity', { name: 'New' })

      expect(result.success).toBe(true)

      const entity = await masterA.getEntity('new-entity')
      expect(entity).toBeDefined()
    })

    it('should handle update to existing entity', async () => {
      await masterA.write('entity-1', { name: 'Original', count: 1 })
      await masterA.write('entity-1', { name: 'Updated', count: 2 })

      const entity = await masterA.getEntity('entity-1')
      expect(entity!.data.name).toBe('Updated')
      expect(entity!.data.count).toBe(2)
    })

    it('should handle delete operation', async () => {
      await masterA.write('entity-1', { name: 'ToDelete' })
      await masterA.delete('entity-1')

      const entity = await masterA.getEntity('entity-1')
      expect(entity).toBeUndefined()
    })

    it('should propagate delete operations', async () => {
      masterB = new MultiMasterManager({
        masterId: 'master-b',
        pipeline: mockPipeline as any,
        stateManager: stateManagerB as any,
      })

      await masterA.subscribe()
      await masterB.subscribe()

      // Create on A
      await masterA.write('entity-1', { name: 'Alice' })
      await vi.advanceTimersByTimeAsync(50)

      // Both should have it
      expect(await masterA.getEntity('entity-1')).toBeDefined()
      expect(await masterB.getEntity('entity-1')).toBeDefined()

      // Delete on A
      await masterA.delete('entity-1')
      await vi.advanceTimersByTimeAsync(50)

      // Both should not have it
      expect(await masterA.getEntity('entity-1')).toBeUndefined()
      expect(await masterB.getEntity('entity-1')).toBeUndefined()
    })

    it('should handle Pipeline connection failure gracefully', async () => {
      mockPipeline.send.mockRejectedValueOnce(new Error('Pipeline unavailable'))

      // Write should still succeed locally and queue for retry
      const result = await masterA.write('entity-1', { name: 'Alice' })

      expect(result.success).toBe(true)
      expect(result.queued).toBe(true)

      const entity = await masterA.getEntity('entity-1')
      expect(entity).toBeDefined()
    })

    it('should handle malformed remote events', async () => {
      const malformedEvent = {
        type: 'write',
        masterId: 'master-b',
        // Missing entityId
        data: { value: 'test' },
        vectorClock: { 'master-b': 1 },
        timestamp: Date.now(),
      } as unknown as WriteEvent

      // Should not throw, but log error
      const result = await masterA.applyRemoteEvent(malformedEvent)
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle empty data writes', async () => {
      const result = await masterA.write('entity-1', {})

      expect(result.success).toBe(true)

      const entity = await masterA.getEntity('entity-1')
      expect(entity).toBeDefined()
      expect(entity!.data).toEqual({})
    })

    it('should unsubscribe from Pipeline on close', async () => {
      const unsubscribe = vi.fn()
      mockPipeline.subscribe.mockReturnValue(unsubscribe)

      await masterA.subscribe()
      await masterA.close()

      expect(unsubscribe).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Multi-node Cluster Tests
  // ==========================================================================

  describe('multi-node cluster', () => {
    let masterC: MultiMasterManager
    let stateManagerC: MockStateManager

    beforeEach(() => {
      stateManagerC = createMockStateManager()

      masterA = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: stateManagerA as any,
      })

      masterB = new MultiMasterManager({
        masterId: 'master-b',
        pipeline: mockPipeline as any,
        stateManager: stateManagerB as any,
      })

      masterC = new MultiMasterManager({
        masterId: 'master-c',
        pipeline: mockPipeline as any,
        stateManager: stateManagerC as any,
      })
    })

    afterEach(async () => {
      if (masterC) await masterC.close?.()
    })

    it('should propagate writes to all nodes', async () => {
      // Given: Three masters subscribed
      await masterA.subscribe()
      await masterB.subscribe()
      await masterC.subscribe()

      // When: One master writes
      await masterA.write('entity-1', { name: 'Alice' })
      await vi.advanceTimersByTimeAsync(100)

      // Then: All masters should have the entity
      expect(await masterA.getEntity('entity-1')).toBeDefined()
      expect(await masterB.getEntity('entity-1')).toBeDefined()
      expect(await masterC.getEntity('entity-1')).toBeDefined()
    })

    it('should maintain consistency across three nodes', async () => {
      // Given: Three masters subscribed
      await masterA.subscribe()
      await masterB.subscribe()
      await masterC.subscribe()

      // When: Sequential writes from different nodes
      await masterA.write('entity-1', { value: 1 })
      await vi.advanceTimersByTimeAsync(50)

      await masterB.write('entity-1', { value: 2 })
      await vi.advanceTimersByTimeAsync(50)

      await masterC.write('entity-1', { value: 3 })
      await vi.advanceTimersByTimeAsync(50)

      // Then: All should converge to value 3
      const entityA = await masterA.getEntity('entity-1')
      const entityB = await masterB.getEntity('entity-1')
      const entityC = await masterC.getEntity('entity-1')

      expect(entityA!.data.value).toBe(3)
      expect(entityB!.data.value).toBe(3)
      expect(entityC!.data.value).toBe(3)
    })

    it('should handle node joining cluster', async () => {
      // Given: Two masters already with data
      await masterA.subscribe()
      await masterB.subscribe()

      await masterA.write('entity-1', { name: 'Alice' })
      await masterB.write('entity-2', { name: 'Bob' })
      await vi.advanceTimersByTimeAsync(50)

      // When: Third master joins
      await masterC.subscribe()

      // Master C needs to sync (in real implementation, would request snapshot)
      // For now, new events will propagate

      await masterA.write('entity-3', { name: 'Charlie' })
      await vi.advanceTimersByTimeAsync(50)

      // Then: Master C should receive new events
      expect(await masterC.getEntity('entity-3')).toBeDefined()
    })

    it('should track vector clock across all nodes', async () => {
      // Given: Three masters subscribed
      await masterA.subscribe()
      await masterB.subscribe()
      await masterC.subscribe()

      // When: Each master writes
      await masterA.write('entity-a', { from: 'A' })
      await vi.advanceTimersByTimeAsync(50)

      await masterB.write('entity-b', { from: 'B' })
      await vi.advanceTimersByTimeAsync(50)

      await masterC.write('entity-c', { from: 'C' })
      await vi.advanceTimersByTimeAsync(50)

      // Then: Each master's clock should include all three nodes
      const clockA = masterA.getVectorClock()
      const clockB = masterB.getVectorClock()
      const clockC = masterC.getVectorClock()

      expect(clockA.get('master-a')).toBeGreaterThan(0)
      expect(clockA.get('master-b')).toBeGreaterThan(0)
      expect(clockA.get('master-c')).toBeGreaterThan(0)

      expect(clockB.get('master-a')).toBeGreaterThan(0)
      expect(clockB.get('master-b')).toBeGreaterThan(0)
      expect(clockB.get('master-c')).toBeGreaterThan(0)

      expect(clockC.get('master-a')).toBeGreaterThan(0)
      expect(clockC.get('master-b')).toBeGreaterThan(0)
      expect(clockC.get('master-c')).toBeGreaterThan(0)
    })
  })
})
