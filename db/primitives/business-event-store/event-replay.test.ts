/**
 * EventReplay Tests - Comprehensive tests for event replay and projection
 *
 * Tests for:
 * - Event replay from any point in time
 * - Projection functions for state derivation
 * - Snapshot creation for fast replay
 * - Replay filtering by dimensions (5W+H)
 * - Idempotent replay handling
 *
 * @module db/primitives/business-event-store/event-replay.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  EventReplayer,
  EventProjector,
  createEventReplayer,
  createIdempotencyTracker,
  composeProjections,
  createFilteredProjection,
  objectStateProjection,
  eventCountProjection,
  locationHistoryProjection,
  causationProjection,
  objectHistoryProjection,
  timeWindowAggregationProjection,
  type ProjectionFunction,
  type ProjectionContext,
  type ReplayFilter,
  type Snapshot,
  type ReplayOptions,
} from './event-replay'
import { ObjectEvent, type BusinessEvent, type ObjectState, type EventType } from './index'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestEvent(
  id: string,
  what: string[],
  when: Date,
  options: Partial<{
    where: string
    why: string
    who: string
    how: string
    action: 'ADD' | 'OBSERVE' | 'DELETE'
    causedBy: string
    correlationId: string
  }> = {}
): BusinessEvent {
  const event = new ObjectEvent({
    what,
    when,
    action: options.action || 'OBSERVE',
    where: options.where,
    why: options.why,
    who: options.who,
    how: options.how,
    causedBy: options.causedBy,
    correlationId: options.correlationId,
  })
  // Override the auto-generated ID
  return { ...event, id } as BusinessEvent
}

function createEventSequence(count: number, baseTime: Date = new Date()): BusinessEvent[] {
  const events: BusinessEvent[] = []
  for (let i = 0; i < count; i++) {
    events.push(
      createTestEvent(
        `evt_${i}`,
        [`obj_${i % 5}`],
        new Date(baseTime.getTime() + i * 1000),
        {
          where: `loc_${i % 3}`,
          why: `step_${i % 4}`,
          who: `party_${i % 2}`,
          how: `disposition_${i % 3}`,
        }
      )
    )
  }
  return events
}

// =============================================================================
// Event Replay from Any Point in Time
// =============================================================================

describe('Event Replay from Any Point in Time', () => {
  let events: BusinessEvent[]
  const baseTime = new Date('2024-01-01T00:00:00Z')

  beforeEach(() => {
    events = createEventSequence(10, baseTime)
  })

  describe('basic replay', () => {
    it('should replay all events in order', async () => {
      const processedEvents: BusinessEvent[] = []
      const projection: ProjectionFunction<BusinessEvent[]> = (state, event) => {
        state.push(event)
        return state
      }

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, { initialState: [] })

      expect(result.success).toBe(true)
      expect(result.eventsProcessed).toBe(10)
      expect(result.state.length).toBe(10)
      expect(result.state[0].id).toBe('evt_0')
      expect(result.state[9].id).toBe('evt_9')
    })

    it('should report correct time range after replay', async () => {
      const projection: ProjectionFunction<null> = (state) => state
      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, { initialState: null })

      expect(result.timeRange).not.toBeNull()
      expect(result.timeRange!.start.getTime()).toBe(baseTime.getTime())
      expect(result.timeRange!.end.getTime()).toBe(baseTime.getTime() + 9000)
    })

    it('should track last event ID and time', async () => {
      const projection: ProjectionFunction<null> = (state) => state
      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, { initialState: null })

      expect(result.lastEventId).toBe('evt_9')
      expect(result.lastEventTime).toEqual(new Date(baseTime.getTime() + 9000))
    })
  })

  describe('replay from specific time', () => {
    it('should replay only events after "from" time', async () => {
      const projection: ProjectionFunction<BusinessEvent[]> = (state, event) => {
        state.push(event)
        return state
      }

      const replayer = createEventReplayer(projection)
      const fromTime = new Date(baseTime.getTime() + 5000) // Start from event 5
      const result = await replayer.replay(events, {
        initialState: [],
        from: fromTime,
      })

      expect(result.eventsProcessed).toBe(5)
      expect(result.state[0].id).toBe('evt_5')
    })

    it('should replay only events before "to" time', async () => {
      const projection: ProjectionFunction<BusinessEvent[]> = (state, event) => {
        state.push(event)
        return state
      }

      const replayer = createEventReplayer(projection)
      const toTime = new Date(baseTime.getTime() + 4000) // End at event 4
      const result = await replayer.replay(events, {
        initialState: [],
        to: toTime,
      })

      expect(result.eventsProcessed).toBe(5)
      expect(result.state[4].id).toBe('evt_4')
    })

    it('should replay events in specified time range', async () => {
      const projection: ProjectionFunction<BusinessEvent[]> = (state, event) => {
        state.push(event)
        return state
      }

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, {
        initialState: [],
        from: new Date(baseTime.getTime() + 3000),
        to: new Date(baseTime.getTime() + 6000),
      })

      expect(result.eventsProcessed).toBe(4)
      expect(result.state[0].id).toBe('evt_3')
      expect(result.state[3].id).toBe('evt_6')
    })
  })

  describe('replay with limit', () => {
    it('should stop after processing limit events', async () => {
      const projection: ProjectionFunction<number> = (state) => state + 1
      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, {
        initialState: 0,
        limit: 5,
      })

      expect(result.eventsProcessed).toBe(5)
      expect(result.state).toBe(5)
    })
  })

  describe('replay ordering', () => {
    it('should replay in ascending order by default', async () => {
      const projection: ProjectionFunction<string[]> = (state, event) => {
        state.push(event.id)
        return state
      }

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, { initialState: [] })

      expect(result.state).toEqual([
        'evt_0', 'evt_1', 'evt_2', 'evt_3', 'evt_4',
        'evt_5', 'evt_6', 'evt_7', 'evt_8', 'evt_9',
      ])
    })

    it('should replay in descending order when specified', async () => {
      const projection: ProjectionFunction<string[]> = (state, event) => {
        state.push(event.id)
        return state
      }

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, {
        initialState: [],
        order: 'desc',
      })

      expect(result.state).toEqual([
        'evt_9', 'evt_8', 'evt_7', 'evt_6', 'evt_5',
        'evt_4', 'evt_3', 'evt_2', 'evt_1', 'evt_0',
      ])
    })
  })
})

// =============================================================================
// Projection Functions for State Derivation
// =============================================================================

describe('Projection Functions for State Derivation', () => {
  const baseTime = new Date('2024-01-01T00:00:00Z')

  describe('objectStateProjection', () => {
    it('should track object locations', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime, { where: 'warehouse_a' }),
        createTestEvent('evt_2', ['obj_1'], new Date(baseTime.getTime() + 1000), { where: 'warehouse_b' }),
      ]

      const state = await EventProjector.projectObjectStates(events)

      expect(state.get('obj_1')?.location).toBe('warehouse_b')
    })

    it('should track object dispositions', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime, { how: 'in_transit' }),
        createTestEvent('evt_2', ['obj_1'], new Date(baseTime.getTime() + 1000), { how: 'delivered' }),
      ]

      const state = await EventProjector.projectObjectStates(events)

      expect(state.get('obj_1')?.disposition).toBe('delivered')
    })

    it('should track multiple objects independently', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime, { where: 'loc_a' }),
        createTestEvent('evt_2', ['obj_2'], new Date(baseTime.getTime() + 1000), { where: 'loc_b' }),
      ]

      const state = await EventProjector.projectObjectStates(events)

      expect(state.get('obj_1')?.location).toBe('loc_a')
      expect(state.get('obj_2')?.location).toBe('loc_b')
    })
  })

  describe('eventCountProjection', () => {
    it('should count events by type', async () => {
      const events = createEventSequence(10, baseTime)

      const counts = await EventProjector.countEventsByType(events)

      expect(counts.get('ObjectEvent')).toBe(10)
    })
  })

  describe('locationHistoryProjection', () => {
    it('should group events by location', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime, { where: 'loc_a' }),
        createTestEvent('evt_2', ['obj_2'], new Date(baseTime.getTime() + 1000), { where: 'loc_a' }),
        createTestEvent('evt_3', ['obj_3'], new Date(baseTime.getTime() + 2000), { where: 'loc_b' }),
      ]

      const history = await EventProjector.getEventsByLocation(events)

      expect(history.get('loc_a')?.length).toBe(2)
      expect(history.get('loc_b')?.length).toBe(1)
    })
  })

  describe('causationProjection', () => {
    it('should build causation graph', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime),
        createTestEvent('evt_2', ['obj_1'], new Date(baseTime.getTime() + 1000), { causedBy: 'evt_1' }),
        createTestEvent('evt_3', ['obj_1'], new Date(baseTime.getTime() + 2000), { causedBy: 'evt_1' }),
        createTestEvent('evt_4', ['obj_1'], new Date(baseTime.getTime() + 3000), { causedBy: 'evt_2' }),
      ]

      const graph = await EventProjector.buildCausationGraph(events)

      expect(graph.get('evt_1')).toContain('evt_2')
      expect(graph.get('evt_1')).toContain('evt_3')
      expect(graph.get('evt_2')).toContain('evt_4')
    })
  })

  describe('objectHistoryProjection', () => {
    it('should build complete object history', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime, { where: 'loc_a', how: 'received' }),
        createTestEvent('evt_2', ['obj_1'], new Date(baseTime.getTime() + 1000), { where: 'loc_b', how: 'in_transit' }),
        createTestEvent('evt_3', ['obj_1'], new Date(baseTime.getTime() + 2000), { where: 'loc_c', how: 'delivered' }),
      ]

      const histories = await EventProjector.buildObjectHistories(events)
      const history = histories.get('obj_1')

      expect(history).toBeDefined()
      expect(history!.events.length).toBe(3)
      expect(history!.currentState?.location).toBe('loc_c')
      expect(history!.currentState?.disposition).toBe('delivered')
    })
  })

  describe('timeWindowAggregationProjection', () => {
    it('should aggregate events by time window', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], new Date(baseTime.getTime())),
        createTestEvent('evt_2', ['obj_2'], new Date(baseTime.getTime() + 500)),
        createTestEvent('evt_3', ['obj_3'], new Date(baseTime.getTime() + 1500)),
        createTestEvent('evt_4', ['obj_4'], new Date(baseTime.getTime() + 2500)),
      ]

      const windows = await EventProjector.aggregateByTimeWindow(events, 1000) // 1 second windows

      // Should have 3 windows: 0-1000, 1000-2000, 2000-3000
      expect(windows.size).toBe(3)

      const firstWindow = windows.get(baseTime.getTime())
      expect(firstWindow?.count).toBe(2)
    })
  })

  describe('custom projections', () => {
    it('should support custom projection functions', async () => {
      const sumQuantityProjection: ProjectionFunction<number> = (state, event) => {
        const qty = (event.extensions?.quantity as number) || 1
        return state + qty
      }

      const events = [
        { ...createTestEvent('evt_1', ['obj_1'], baseTime), extensions: { quantity: 5 } },
        { ...createTestEvent('evt_2', ['obj_2'], new Date(baseTime.getTime() + 1000)), extensions: { quantity: 3 } },
        { ...createTestEvent('evt_3', ['obj_3'], new Date(baseTime.getTime() + 2000)), extensions: { quantity: 7 } },
      ] as BusinessEvent[]

      const replayer = createEventReplayer(sumQuantityProjection)
      const result = await replayer.replay(events, { initialState: 0 })

      expect(result.state).toBe(15)
    })
  })
})

// =============================================================================
// Snapshot Creation for Fast Replay
// =============================================================================

describe('Snapshot Creation for Fast Replay', () => {
  const baseTime = new Date('2024-01-01T00:00:00Z')

  describe('creating snapshots', () => {
    it('should create snapshot with current state', async () => {
      const events = createEventSequence(100, baseTime)
      const projection: ProjectionFunction<number> = (state) => state + 1

      const replayer = createEventReplayer(projection, { everyNEvents: 50 })
      await replayer.replay(events, { initialState: 0 })

      const snapshots = replayer.getSnapshots()
      expect(snapshots.length).toBeGreaterThan(0)
    })

    it('should manually create snapshot', async () => {
      const events = createEventSequence(10, baseTime)
      const projection: ProjectionFunction<number> = (state) => state + 1

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, { initialState: 0 })

      const snapshot = replayer.createSnapshot(
        result.state,
        events[events.length - 1]!,
        result.eventsProcessed
      )

      expect(snapshot.state).toBe(10)
      expect(snapshot.lastEventId).toBe('evt_9')
      expect(snapshot.eventCount).toBe(10)
    })

    it('should include state hash in snapshot', async () => {
      const events = createEventSequence(10, baseTime)
      const projection: ProjectionFunction<number> = (state) => state + 1

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, { initialState: 0 })

      const snapshot = replayer.createSnapshot(
        result.state,
        events[events.length - 1]!,
        result.eventsProcessed
      )

      expect(snapshot.stateHash).toBeDefined()
      expect(snapshot.stateHash.length).toBeGreaterThan(0)
    })
  })

  describe('restoring from snapshot', () => {
    it('should restore state from snapshot and continue replay', async () => {
      const events = createEventSequence(100, baseTime)
      const projection: ProjectionFunction<number> = (state) => state + 1

      // Create initial replay and snapshot
      const replayer = createEventReplayer(projection)
      await replayer.replay(events.slice(0, 50), { initialState: 0 })

      const snapshot: Snapshot<number> = {
        id: 'snap_test',
        state: 50,
        lastEventId: 'evt_49',
        lastEventTime: events[49]!.when,
        eventCount: 50,
        createdAt: new Date(),
        version: 1,
        stateHash: 'test_hash',
      }

      // Replay remaining events from snapshot
      const result = await replayer.replay(events.slice(50), {
        snapshot,
        initialState: 0,
      })

      expect(result.state).toBe(100)
      expect(result.eventsProcessed).toBe(50) // Only new events processed
    })
  })

  describe('snapshot retrieval', () => {
    it('should get snapshot before specific time', async () => {
      const events = createEventSequence(100, baseTime)
      const projection: ProjectionFunction<number> = (state) => state + 1

      const replayer = createEventReplayer(projection, { everyNEvents: 25 })
      await replayer.replay(events, { initialState: 0 })

      const targetTime = new Date(baseTime.getTime() + 60000) // 60 seconds in
      const snapshot = replayer.getSnapshotBefore(targetTime)

      expect(snapshot).not.toBeNull()
      expect(snapshot!.lastEventTime.getTime()).toBeLessThanOrEqual(targetTime.getTime())
    })

    it('should get snapshot by ID', async () => {
      const events = createEventSequence(10, baseTime)
      const projection: ProjectionFunction<number> = (state) => state + 1

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, { initialState: 0 })

      const createdSnapshot = replayer.createSnapshot(
        result.state,
        events[events.length - 1]!,
        result.eventsProcessed
      )

      const retrieved = replayer.getSnapshot(createdSnapshot.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(createdSnapshot.id)
    })
  })

  describe('snapshot integrity', () => {
    it('should verify snapshot integrity', async () => {
      const events = createEventSequence(10, baseTime)
      const projection: ProjectionFunction<number> = (state) => state + 1

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, { initialState: 0 })

      const snapshot = replayer.createSnapshot(
        result.state,
        events[events.length - 1]!,
        result.eventsProcessed
      )

      expect(replayer.verifySnapshot(snapshot)).toBe(true)

      // Tamper with state
      const tamperedSnapshot = { ...snapshot, state: 999 }
      expect(replayer.verifySnapshot(tamperedSnapshot)).toBe(false)
    })
  })

  describe('snapshot retention', () => {
    it('should enforce max snapshots', async () => {
      const events = createEventSequence(200, baseTime)
      const projection: ProjectionFunction<number> = (state) => state + 1

      const replayer = createEventReplayer(projection, {
        everyNEvents: 10,
        maxSnapshots: 5,
      })
      await replayer.replay(events, { initialState: 0 })

      const snapshots = replayer.getSnapshots()
      expect(snapshots.length).toBeLessThanOrEqual(5)
    })

    it('should delete old snapshots', async () => {
      const events = createEventSequence(10, baseTime)
      const projection: ProjectionFunction<number> = (state) => state + 1

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, { initialState: 0 })

      const snapshot = replayer.createSnapshot(
        result.state,
        events[events.length - 1]!,
        result.eventsProcessed
      )

      expect(replayer.getSnapshots().length).toBe(1)
      replayer.deleteSnapshot(snapshot.id)
      expect(replayer.getSnapshots().length).toBe(0)
    })

    it('should clear all snapshots', async () => {
      const events = createEventSequence(50, baseTime)
      const projection: ProjectionFunction<number> = (state) => state + 1

      const replayer = createEventReplayer(projection, { everyNEvents: 10 })
      await replayer.replay(events, { initialState: 0 })

      expect(replayer.getSnapshots().length).toBeGreaterThan(0)
      replayer.clearSnapshots()
      expect(replayer.getSnapshots().length).toBe(0)
    })
  })
})

// =============================================================================
// Replay Filtering by Dimensions
// =============================================================================

describe('Replay Filtering by Dimensions', () => {
  const baseTime = new Date('2024-01-01T00:00:00Z')

  describe('filter by what (object IDs)', () => {
    it('should filter by single object ID', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime),
        createTestEvent('evt_2', ['obj_2'], new Date(baseTime.getTime() + 1000)),
        createTestEvent('evt_3', ['obj_1'], new Date(baseTime.getTime() + 2000)),
      ]

      const projection: ProjectionFunction<string[]> = (state, event) => {
        state.push(event.id)
        return state
      }

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, {
        initialState: [],
        filter: { what: 'obj_1' },
      })

      expect(result.state).toEqual(['evt_1', 'evt_3'])
    })

    it('should filter by multiple object IDs', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime),
        createTestEvent('evt_2', ['obj_2'], new Date(baseTime.getTime() + 1000)),
        createTestEvent('evt_3', ['obj_3'], new Date(baseTime.getTime() + 2000)),
      ]

      const projection: ProjectionFunction<string[]> = (state, event) => {
        state.push(event.id)
        return state
      }

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, {
        initialState: [],
        filter: { what: ['obj_1', 'obj_3'] },
      })

      expect(result.state).toEqual(['evt_1', 'evt_3'])
    })
  })

  describe('filter by where (location)', () => {
    it('should filter by location', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime, { where: 'warehouse_a' }),
        createTestEvent('evt_2', ['obj_2'], new Date(baseTime.getTime() + 1000), { where: 'warehouse_b' }),
        createTestEvent('evt_3', ['obj_3'], new Date(baseTime.getTime() + 2000), { where: 'warehouse_a' }),
      ]

      const projection: ProjectionFunction<string[]> = (state, event) => {
        state.push(event.id)
        return state
      }

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, {
        initialState: [],
        filter: { where: 'warehouse_a' },
      })

      expect(result.state).toEqual(['evt_1', 'evt_3'])
    })
  })

  describe('filter by why (business step)', () => {
    it('should filter by business step', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime, { why: 'receiving' }),
        createTestEvent('evt_2', ['obj_2'], new Date(baseTime.getTime() + 1000), { why: 'shipping' }),
        createTestEvent('evt_3', ['obj_3'], new Date(baseTime.getTime() + 2000), { why: 'receiving' }),
      ]

      const projection: ProjectionFunction<string[]> = (state, event) => {
        state.push(event.id)
        return state
      }

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, {
        initialState: [],
        filter: { why: 'receiving' },
      })

      expect(result.state).toEqual(['evt_1', 'evt_3'])
    })
  })

  describe('filter by who (party)', () => {
    it('should filter by party', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime, { who: 'supplier_a' }),
        createTestEvent('evt_2', ['obj_2'], new Date(baseTime.getTime() + 1000), { who: 'supplier_b' }),
        createTestEvent('evt_3', ['obj_3'], new Date(baseTime.getTime() + 2000), { who: 'supplier_a' }),
      ]

      const projection: ProjectionFunction<string[]> = (state, event) => {
        state.push(event.id)
        return state
      }

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, {
        initialState: [],
        filter: { who: 'supplier_a' },
      })

      expect(result.state).toEqual(['evt_1', 'evt_3'])
    })
  })

  describe('filter by how (disposition)', () => {
    it('should filter by disposition', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime, { how: 'in_transit' }),
        createTestEvent('evt_2', ['obj_2'], new Date(baseTime.getTime() + 1000), { how: 'delivered' }),
        createTestEvent('evt_3', ['obj_3'], new Date(baseTime.getTime() + 2000), { how: 'in_transit' }),
      ]

      const projection: ProjectionFunction<string[]> = (state, event) => {
        state.push(event.id)
        return state
      }

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, {
        initialState: [],
        filter: { how: 'in_transit' },
      })

      expect(result.state).toEqual(['evt_1', 'evt_3'])
    })
  })

  describe('filter by correlation ID', () => {
    it('should filter by correlation ID', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime, { correlationId: 'corr_1' }),
        createTestEvent('evt_2', ['obj_2'], new Date(baseTime.getTime() + 1000), { correlationId: 'corr_2' }),
        createTestEvent('evt_3', ['obj_3'], new Date(baseTime.getTime() + 2000), { correlationId: 'corr_1' }),
      ]

      const projection: ProjectionFunction<string[]> = (state, event) => {
        state.push(event.id)
        return state
      }

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, {
        initialState: [],
        filter: { correlationId: 'corr_1' },
      })

      expect(result.state).toEqual(['evt_1', 'evt_3'])
    })
  })

  describe('filter by causation', () => {
    it('should filter by causedBy', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime),
        createTestEvent('evt_2', ['obj_2'], new Date(baseTime.getTime() + 1000), { causedBy: 'evt_1' }),
        createTestEvent('evt_3', ['obj_3'], new Date(baseTime.getTime() + 2000)),
        createTestEvent('evt_4', ['obj_4'], new Date(baseTime.getTime() + 3000), { causedBy: 'evt_1' }),
      ]

      const projection: ProjectionFunction<string[]> = (state, event) => {
        state.push(event.id)
        return state
      }

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, {
        initialState: [],
        filter: { causedBy: 'evt_1' },
      })

      expect(result.state).toEqual(['evt_2', 'evt_4'])
    })
  })

  describe('combined filters', () => {
    it('should apply multiple filters together', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime, { where: 'loc_a', why: 'step_1' }),
        createTestEvent('evt_2', ['obj_1'], new Date(baseTime.getTime() + 1000), { where: 'loc_a', why: 'step_2' }),
        createTestEvent('evt_3', ['obj_2'], new Date(baseTime.getTime() + 2000), { where: 'loc_a', why: 'step_1' }),
        createTestEvent('evt_4', ['obj_1'], new Date(baseTime.getTime() + 3000), { where: 'loc_b', why: 'step_1' }),
      ]

      const projection: ProjectionFunction<string[]> = (state, event) => {
        state.push(event.id)
        return state
      }

      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, {
        initialState: [],
        filter: {
          what: 'obj_1',
          where: 'loc_a',
          why: 'step_1',
        },
      })

      expect(result.state).toEqual(['evt_1'])
    })
  })
})

// =============================================================================
// Idempotent Replay Handling
// =============================================================================

describe('Idempotent Replay Handling', () => {
  const baseTime = new Date('2024-01-01T00:00:00Z')

  describe('basic idempotency', () => {
    it('should not process same event twice', async () => {
      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime),
        createTestEvent('evt_1', ['obj_1'], baseTime), // Duplicate
        createTestEvent('evt_2', ['obj_2'], new Date(baseTime.getTime() + 1000)),
      ]

      const projection: ProjectionFunction<number> = (state) => state + 1
      const replayer = createEventReplayer(projection)
      const result = await replayer.replay(events, {
        initialState: 0,
        idempotent: true,
      })

      expect(result.eventsProcessed).toBe(2)
      expect(result.eventsSkipped).toBe(1)
      expect(result.state).toBe(2)
    })

    it('should track idempotency statistics', async () => {
      const events = createEventSequence(10, baseTime)
      const projection: ProjectionFunction<number> = (state) => state + 1

      const replayer = createEventReplayer(projection)
      await replayer.replay(events, {
        initialState: 0,
        idempotent: true,
      })

      const stats = replayer.getIdempotencyStats()
      expect(stats).not.toBeNull()
      expect(stats!.processedCount).toBe(10)
    })

    it('should clear idempotency state', async () => {
      const events = createEventSequence(10, baseTime)
      const projection: ProjectionFunction<number> = (state) => state + 1

      const replayer = createEventReplayer(projection)
      await replayer.replay(events, {
        initialState: 0,
        idempotent: true,
      })

      replayer.clearIdempotencyState()
      const stats = replayer.getIdempotencyStats()
      expect(stats).toBeNull()
    })
  })

  describe('idempotency tracker', () => {
    it('should mark events as processed', () => {
      const tracker = createIdempotencyTracker()

      tracker.markProcessed('evt_1')
      tracker.markProcessed('evt_2')

      expect(tracker.isProcessed('evt_1')).toBe(true)
      expect(tracker.isProcessed('evt_2')).toBe(true)
      expect(tracker.isProcessed('evt_3')).toBe(false)
    })

    it('should return processed event IDs', () => {
      const tracker = createIdempotencyTracker()

      tracker.markProcessed('evt_1')
      tracker.markProcessed('evt_2')

      const ids = tracker.getProcessedIds()
      expect(ids.has('evt_1')).toBe(true)
      expect(ids.has('evt_2')).toBe(true)
      expect(ids.size).toBe(2)
    })

    it('should clear tracking state', () => {
      const tracker = createIdempotencyTracker()

      tracker.markProcessed('evt_1')
      tracker.clear()

      expect(tracker.isProcessed('evt_1')).toBe(false)
      expect(tracker.getStats().processedCount).toBe(0)
    })
  })

  describe('replay across multiple sessions', () => {
    it('should support re-replay without duplicates when idempotent', async () => {
      const events = createEventSequence(10, baseTime)
      const projection: ProjectionFunction<number> = (state) => state + 1

      const replayer = createEventReplayer(projection)

      // First replay
      const result1 = await replayer.replay(events, {
        initialState: 0,
        idempotent: true,
      })
      expect(result1.eventsProcessed).toBe(10)

      // Second replay of same events - should skip all
      const result2 = await replayer.replay(events, {
        initialState: result1.state,
        idempotent: true,
      })
      expect(result2.eventsProcessed).toBe(0)
      expect(result2.eventsSkipped).toBe(10)
    })
  })
})

// =============================================================================
// Projection Composition
// =============================================================================

describe('Projection Composition', () => {
  const baseTime = new Date('2024-01-01T00:00:00Z')

  describe('composeProjections', () => {
    it('should compose multiple projections', async () => {
      interface ComposedState {
        count: number
        locations: Map<string, ObjectState>
      }

      const countProjection: ProjectionFunction<number> = (state) => state + 1
      const locProjection: ProjectionFunction<Map<string, ObjectState>> = objectStateProjection

      const composed = composeProjections<ComposedState>({
        count: countProjection,
        locations: locProjection,
      })

      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime, { where: 'loc_a' }),
        createTestEvent('evt_2', ['obj_2'], new Date(baseTime.getTime() + 1000), { where: 'loc_b' }),
      ]

      const replayer = createEventReplayer(composed)
      const result = await replayer.replay(events, {
        initialState: { count: 0, locations: new Map() },
      })

      expect(result.state.count).toBe(2)
      expect(result.state.locations.get('obj_1')?.location).toBe('loc_a')
      expect(result.state.locations.get('obj_2')?.location).toBe('loc_b')
    })
  })

  describe('createFilteredProjection', () => {
    it('should create projection that only processes matching events', async () => {
      const countProjection: ProjectionFunction<number> = (state) => state + 1
      const filteredProjection = createFilteredProjection(countProjection, {
        where: 'loc_a',
      })

      const events = [
        createTestEvent('evt_1', ['obj_1'], baseTime, { where: 'loc_a' }),
        createTestEvent('evt_2', ['obj_2'], new Date(baseTime.getTime() + 1000), { where: 'loc_b' }),
        createTestEvent('evt_3', ['obj_3'], new Date(baseTime.getTime() + 2000), { where: 'loc_a' }),
      ]

      const replayer = createEventReplayer(filteredProjection)
      const result = await replayer.replay(events, { initialState: 0 })

      expect(result.state).toBe(2)
    })
  })
})

// =============================================================================
// Progress and Callbacks
// =============================================================================

describe('Progress and Callbacks', () => {
  const baseTime = new Date('2024-01-01T00:00:00Z')

  describe('onProgress callback', () => {
    it('should call progress callback for each event', async () => {
      const events = createEventSequence(5, baseTime)
      const progressUpdates: number[] = []

      const projection: ProjectionFunction<number> = (state) => state + 1
      const replayer = createEventReplayer(projection)

      await replayer.replay(events, {
        initialState: 0,
        onProgress: (progress) => {
          progressUpdates.push(progress.eventsProcessed)
        },
      })

      expect(progressUpdates).toEqual([1, 2, 3, 4, 5])
    })

    it('should include percent complete for array input', async () => {
      const events = createEventSequence(10, baseTime)
      const percentages: number[] = []

      const projection: ProjectionFunction<number> = (state) => state + 1
      const replayer = createEventReplayer(projection)

      await replayer.replay(events, {
        initialState: 0,
        onProgress: (progress) => {
          if (progress.percentComplete !== undefined) {
            percentages.push(progress.percentComplete)
          }
        },
      })

      expect(percentages[0]).toBe(10)
      expect(percentages[9]).toBe(100)
    })
  })

  describe('onEvent callback', () => {
    it('should call onEvent for each processed event', async () => {
      const events = createEventSequence(5, baseTime)
      const processedIds: string[] = []

      const projection: ProjectionFunction<number> = (state) => state + 1
      const replayer = createEventReplayer(projection)

      await replayer.replay(events, {
        initialState: 0,
        onEvent: (event) => {
          processedIds.push(event.id)
        },
      })

      expect(processedIds).toEqual(['evt_0', 'evt_1', 'evt_2', 'evt_3', 'evt_4'])
    })
  })
})

// =============================================================================
// Error Handling
// =============================================================================

describe('Error Handling', () => {
  const baseTime = new Date('2024-01-01T00:00:00Z')

  it('should handle projection errors gracefully', async () => {
    const events = createEventSequence(10, baseTime)

    const failingProjection: ProjectionFunction<number> = (state, event) => {
      if (event.id === 'evt_5') {
        throw new Error('Projection failed')
      }
      return state + 1
    }

    const replayer = createEventReplayer(failingProjection)
    const result = await replayer.replay(events, { initialState: 0 })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error!.message).toBe('Projection failed')
    expect(result.eventsProcessed).toBe(5) // Processed 5 before failure
  })

  it('should return partial state on error', async () => {
    const events = createEventSequence(10, baseTime)

    const failingProjection: ProjectionFunction<number> = (state, event) => {
      if (event.id === 'evt_5') {
        throw new Error('Projection failed')
      }
      return state + 1
    }

    const replayer = createEventReplayer(failingProjection)
    const result = await replayer.replay(events, { initialState: 0 })

    expect(result.state).toBe(5) // Partial state before failure
  })
})

// =============================================================================
// Projection Context
// =============================================================================

describe('Projection Context', () => {
  const baseTime = new Date('2024-01-01T00:00:00Z')

  it('should provide correct event index', async () => {
    const events = createEventSequence(5, baseTime)
    const indices: number[] = []

    const projection: ProjectionFunction<null> = (state, event, context) => {
      indices.push(context.eventIndex)
      return state
    }

    const replayer = createEventReplayer(projection)
    await replayer.replay(events, { initialState: null })

    expect(indices).toEqual([0, 1, 2, 3, 4])
  })

  it('should provide total events for array input', async () => {
    const events = createEventSequence(5, baseTime)
    let totalEvents: number | undefined

    const projection: ProjectionFunction<null> = (state, event, context) => {
      totalEvents = context.totalEvents
      return state
    }

    const replayer = createEventReplayer(projection)
    await replayer.replay(events, { initialState: null })

    expect(totalEvents).toBe(5)
  })

  it('should provide current event time', async () => {
    const events = createEventSequence(5, baseTime)
    const times: number[] = []

    const projection: ProjectionFunction<null> = (state, event, context) => {
      times.push(context.currentTime.getTime())
      return state
    }

    const replayer = createEventReplayer(projection)
    await replayer.replay(events, { initialState: null })

    expect(times[0]).toBe(baseTime.getTime())
    expect(times[4]).toBe(baseTime.getTime() + 4000)
  })

  it('should indicate snapshot restore on first event after snapshot', async () => {
    const events = createEventSequence(10, baseTime)
    let isSnapshotRestore: boolean | undefined

    const projection: ProjectionFunction<number> = (state, event, context) => {
      if (context.eventIndex === 0) {
        isSnapshotRestore = context.isSnapshotRestore
      }
      return state + 1
    }

    const snapshot: Snapshot<number> = {
      id: 'snap_test',
      state: 50,
      lastEventId: 'evt_49',
      lastEventTime: new Date(),
      eventCount: 50,
      createdAt: new Date(),
      version: 1,
      stateHash: 'test_hash',
    }

    const replayer = createEventReplayer(projection)
    await replayer.replay(events, {
      initialState: 0,
      snapshot,
    })

    expect(isSnapshotRestore).toBe(true)
  })
})
