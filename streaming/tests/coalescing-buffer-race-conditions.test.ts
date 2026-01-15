/**
 * Coalescing Buffer Race Condition Tests
 *
 * TDD RED Phase: Tests for race conditions in coalescing buffer operations.
 *
 * Race Condition Scenarios:
 *
 * 1. Timer/BatchSize Double Flush:
 *    - Events 1-4 added, timer scheduled for 100ms
 *    - At 99ms, event 5 arrives
 *    - Event 5 triggers batch flush (batch size = 5)
 *    - At 100ms, timer fires, tries to flush same topic
 *    - Two flushes race on same buffer
 *
 * 2. Flush Not Awaited:
 *    - flushCoalescedBuffer is async but NOT awaited in coalesceEvent
 *    - Events added after flush starts but before await completes
 *    - Buffer is deleted synchronously, then new events create new buffer
 *    - But fanOut happens later, potentially with stale data
 *
 * 3. Re-entrancy via Live Query Notifications:
 *    - notifyLiveQuerySubscribers is async and awaited in a loop
 *    - Each await is a yield point where new events could arrive
 *    - New events create new buffer, but old flush is still processing
 *
 * @module streaming/tests/coalescing-buffer-race-conditions.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Install WebSocket mock for test environment
import { installWebSocketMock } from './utils/websocket-mock'
installWebSocketMock()

import { EventStreamDO, BroadcastEvent } from '../event-stream-do'

describe('Coalescing Buffer Race Conditions', () => {
  let eventStream: EventStreamDO
  let mockState: any
  let sentEvents: BroadcastEvent[]

  beforeEach(() => {
    vi.useFakeTimers()
    sentEvents = []

    mockState = {
      storage: {
        get: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue(new Map()),
      },
      id: { toString: () => 'test-id' },
      waitUntil: vi.fn(),
    }

    eventStream = new EventStreamDO(mockState, {}, {
      coalescing: {
        enabled: true,
        maxDelayMs: 100,
        maxBatchSize: 5,
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Timer and batch size double flush race', () => {
    it('FAILS: timer fires while batch-triggered flush is in progress causing duplicate sends', async () => {
      /**
       * Race condition scenario:
       * 1. Events 1-4 added at t=0, timer scheduled for t=100ms
       * 2. At t=99ms, event 5 arrives
       * 3. Event 5 triggers batch flush (not awaited)
       * 4. Batch flush gets buffer, starts processing
       * 5. At t=100ms, timer fires, tries to flush same topic
       * 6. Timer flush gets same buffer (not yet deleted)
       * 7. Both flushes send the same events = DUPLICATES
       */

      const coalesceEvent = (eventStream as any).coalesceEvent.bind(eventStream)
      const buffers = (eventStream as any).coalescingBuffers

      // Track all sent events including duplicates
      const allSentEvents: BroadcastEvent[] = []

      ;(eventStream as any).fanOutToSubscribers = vi.fn().mockImplementation(async (topic: string, event: BroadcastEvent) => {
        if (event.type === 'batch') {
          allSentEvents.push(...(event.payload as any).events)
        } else {
          allSentEvents.push(event)
        }
      })

      // Add 4 events at t=0, timer is scheduled for t=100ms
      for (let i = 1; i <= 4; i++) {
        coalesceEvent('test-topic', {
          id: `event-${i}`,
          type: 'test',
          topic: 'test-topic',
          payload: { num: i },
          timestamp: Date.now(),
        })
      }

      expect(buffers.get('test-topic')?.events.length).toBe(4)

      // Advance to t=99ms (just before timer fires)
      await vi.advanceTimersByTimeAsync(99)

      // Add 5th event - triggers batch flush
      coalesceEvent('test-topic', {
        id: 'event-5',
        type: 'test',
        topic: 'test-topic',
        payload: { num: 5 },
        timestamp: Date.now(),
      })

      // Now at t=99ms, batch flush has been triggered (not awaited)
      // Timer is still scheduled to fire at t=100ms

      // Advance to t=100ms - timer fires
      await vi.advanceTimersByTimeAsync(1)

      // Let all async operations complete
      await vi.runAllTimersAsync()

      // Check for duplicates - each event should only be sent ONCE
      const eventIds = allSentEvents.map((e) => e.id)
      const uniqueIds = [...new Set(eventIds)]

      // This test SHOULD pass if there's proper synchronization
      // It will FAIL if both batch and timer flush send the same events
      expect(eventIds.length).toBe(uniqueIds.length)
      expect(eventIds.sort()).toEqual(['event-1', 'event-2', 'event-3', 'event-4', 'event-5'])
    })

    it('FAILS: events added during async fanOut are orphaned in new buffer', async () => {
      /**
       * Race condition:
       * 1. Events 1-5 trigger batch flush
       * 2. Batch flush deletes buffer synchronously
       * 3. Batch flush awaits fanOut
       * 4. During await, event 6 arrives, creates NEW buffer
       * 5. Timer for new buffer is scheduled
       * 6. If timer is not actually set (bug), event 6 is orphaned
       */

      const coalesceEvent = (eventStream as any).coalesceEvent.bind(eventStream)
      const buffers = (eventStream as any).coalescingBuffers
      const timers = (eventStream as any).coalescingTimers

      // Make fanOut slow so we can add events during the await
      let fanOutResolve: () => void
      ;(eventStream as any).fanOutToSubscribers = vi.fn().mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          fanOutResolve = resolve
        })
      })

      // Add 5 events to trigger batch flush
      for (let i = 1; i <= 5; i++) {
        coalesceEvent('test-topic', {
          id: `event-${i}`,
          type: 'test',
          topic: 'test-topic',
          payload: {},
          timestamp: Date.now(),
        })
      }

      // Buffer should be deleted synchronously after batch flush starts
      // (flush deletes before first await)
      expect(buffers.has('test-topic')).toBe(false)

      // Add event 6 while fanOut is awaiting
      coalesceEvent('test-topic', {
        id: 'event-6',
        type: 'test',
        topic: 'test-topic',
        payload: {},
        timestamp: Date.now(),
      })

      // New buffer should exist with event 6
      expect(buffers.has('test-topic')).toBe(true)
      expect(buffers.get('test-topic')?.events.length).toBe(1)

      // Timer should be set for the new buffer
      // This is the potential bug: if timer wasn't properly set, event-6 could be orphaned
      expect(timers.has('test-topic')).toBe(true)

      // Complete the first flush
      fanOutResolve!()

      // Wait for timer to fire and flush event 6
      await vi.advanceTimersByTimeAsync(100)
      await vi.runAllTimersAsync()

      // After all flushes, buffer should be empty
      expect(buffers.has('test-topic')).toBe(false)

      // fanOut should have been called twice: once for events 1-5, once for event 6
      expect((eventStream as any).fanOutToSubscribers).toHaveBeenCalledTimes(2)
    })
  })

  describe('Buffer state consistency', () => {
    it('FAILS: direct flushCoalescedBuffer call races with timer-triggered flush', async () => {
      /**
       * When flushCoalescedBuffer is called directly (e.g., via flushAllCoalescedBuffers),
       * it can race with timer-triggered flushes.
       */
      const coalesceEvent = (eventStream as any).coalesceEvent.bind(eventStream)
      const flushCoalescedBuffer = (eventStream as any).flushCoalescedBuffer.bind(eventStream)
      const buffers = (eventStream as any).coalescingBuffers
      const timers = (eventStream as any).coalescingTimers

      const sentEvents: string[] = []
      ;(eventStream as any).fanOutToSubscribers = vi.fn().mockImplementation(async (topic: string, event: BroadcastEvent) => {
        if (event.type === 'batch') {
          sentEvents.push(...(event.payload as any).events.map((e: any) => e.id))
        } else {
          sentEvents.push(event.id)
        }
      })

      // Add events
      for (let i = 1; i <= 3; i++) {
        coalesceEvent('test-topic', {
          id: `event-${i}`,
          type: 'test',
          topic: 'test-topic',
          payload: {},
          timestamp: Date.now(),
        })
      }

      expect(buffers.get('test-topic')?.events.length).toBe(3)
      expect(timers.has('test-topic')).toBe(true)

      // Call direct flush (simulating flushAllCoalescedBuffers or shutdown)
      const directFlushPromise = flushCoalescedBuffer('test-topic')

      // Advance time to also trigger timer (even though we called flush directly)
      await vi.advanceTimersByTimeAsync(100)

      await directFlushPromise
      await vi.runAllTimersAsync()

      // Events should be sent exactly once, not duplicated
      expect(sentEvents.sort()).toEqual(['event-1', 'event-2', 'event-3'])
      expect(sentEvents.length).toBe(3) // No duplicates
    })

    it('FAILS: timer cleared but buffer not flushed leaves orphaned events', async () => {
      /**
       * Scenario: If fanOut throws, events are lost because the buffer was
       * already deleted synchronously before the async operation.
       *
       * The fix would be to:
       * 1. Only delete buffer AFTER successful send
       * 2. Or implement retry logic for failed flushes
       */
      const coalesceEvent = (eventStream as any).coalesceEvent.bind(eventStream)
      const buffers = (eventStream as any).coalescingBuffers

      const sentEvents: string[] = []
      let failureCount = 0

      ;(eventStream as any).fanOutToSubscribers = vi.fn().mockImplementation(async (topic: string, event: BroadcastEvent) => {
        failureCount++
        if (failureCount === 1) {
          // First attempt fails - events should be retried or preserved
          throw new Error('Simulated network failure')
        }
        if (event.type === 'batch') {
          sentEvents.push(...(event.payload as any).events.map((e: any) => e.id))
        } else {
          sentEvents.push(event.id)
        }
      })

      // Add events
      for (let i = 1; i <= 3; i++) {
        coalesceEvent('test-topic', {
          id: `event-${i}`,
          type: 'test',
          topic: 'test-topic',
          payload: {},
          timestamp: Date.now(),
        })
      }

      // Capture the promise before the timer fires
      const flushPromises: Promise<void>[] = []
      const originalFlush = (eventStream as any).flushCoalescedBuffer.bind(eventStream)
      ;(eventStream as any).flushCoalescedBuffer = async function (topic: string) {
        const p = originalFlush(topic)
        flushPromises.push(p.catch(() => {})) // Catch to prevent unhandled rejection
        return p.catch(() => {}) // Also catch on the returned promise
      }

      // Trigger flush via timer - this will throw
      await vi.advanceTimersByTimeAsync(100)
      await vi.runAllTimersAsync()
      await Promise.allSettled(flushPromises)

      // After failed flush, events should still be recoverable or retried
      // Currently they are LOST because buffer was deleted before fanOut throws
      // The invariant is: if fanOut fails, events should NOT be lost
      // This test FAILS because events are lost on fanOut failure
      expect(sentEvents.length).toBe(3)
    })

    it('FAILS: metrics.coalescedBatches incremented before successful send', async () => {
      /**
       * The metrics counter is incremented BEFORE the actual send completes.
       * If send fails, metrics are inaccurate.
       */
      const coalesceEvent = (eventStream as any).coalesceEvent.bind(eventStream)
      const metrics = (eventStream as any).metrics

      let sendCount = 0
      ;(eventStream as any).fanOutToSubscribers = vi.fn().mockImplementation(async () => {
        sendCount++
        throw new Error('Send failed')
      })

      const initialBatches = metrics.coalescedBatches

      // Add events to trigger flush
      for (let i = 1; i <= 5; i++) {
        coalesceEvent('test-topic', {
          id: `event-${i}`,
          type: 'test',
          topic: 'test-topic',
          payload: {},
          timestamp: Date.now(),
        })
      }

      await vi.runAllTimersAsync()

      // Metrics should only count SUCCESSFUL sends
      // If metrics.coalescedBatches > initialBatches but sendCount has all failures,
      // the metrics are wrong
      const successfulSends = 0 // All sends failed
      expect(metrics.coalescedBatches - initialBatches).toBe(successfulSends)
    })
  })

  describe('Multiple flushes interleaving', () => {
    it('FAILS: flushAllCoalescedBuffers interleaves with new incoming events', async () => {
      /**
       * When flushAllCoalescedBuffers is called (e.g., during shutdown),
       * new events might arrive between individual topic flushes.
       */
      const coalesceEvent = (eventStream as any).coalesceEvent.bind(eventStream)
      const buffers = (eventStream as any).coalescingBuffers

      const flushOrder: string[] = []
      let allowFlush = false
      let flushPromises: Promise<void>[] = []

      ;(eventStream as any).fanOutToSubscribers = vi.fn().mockImplementation(async (topic: string, event: BroadcastEvent) => {
        flushOrder.push(topic)
        // Simulate some async work
        await Promise.resolve()
      })

      // Add events to multiple topics
      coalesceEvent('topic-a', { id: 'a-1', type: 'test', topic: 'topic-a', payload: {}, timestamp: Date.now() })
      coalesceEvent('topic-b', { id: 'b-1', type: 'test', topic: 'topic-b', payload: {}, timestamp: Date.now() })
      coalesceEvent('topic-c', { id: 'c-1', type: 'test', topic: 'topic-c', payload: {}, timestamp: Date.now() })

      // Start flushing all
      const flushAllPromise = eventStream.flushAllCoalescedBuffers()

      // While flushAll is running, add more events
      coalesceEvent('topic-a', { id: 'a-2', type: 'test', topic: 'topic-a', payload: {}, timestamp: Date.now() })

      await flushAllPromise
      await vi.runAllTimersAsync()

      // event a-2 should eventually be flushed too (after the new timer)
      await vi.advanceTimersByTimeAsync(100)
      await vi.runAllTimersAsync()

      // All events should have been flushed
      const allFlushedTopics = (eventStream as any).fanOutToSubscribers.mock.calls.map((call: any[]) => call[0])

      // topic-a should appear twice (once for a-1, once for a-2)
      expect(allFlushedTopics.filter((t: string) => t === 'topic-a').length).toBe(2)
    })

    it('FAILS: parallel batch flushes for same topic cause data corruption', async () => {
      /**
       * If two events arrive rapidly and both trigger batch flushes,
       * there could be parallel flushes for the same topic.
       */
      const coalesceEvent = (eventStream as any).coalesceEvent.bind(eventStream)

      const allSentEventIds: string[] = []
      ;(eventStream as any).fanOutToSubscribers = vi.fn().mockImplementation(async (topic: string, event: BroadcastEvent) => {
        if (event.type === 'batch') {
          allSentEventIds.push(...(event.payload as any).events.map((e: any) => e.id))
        } else {
          allSentEventIds.push(event.id)
        }
      })

      // Reconfigure for smaller batch size to test quickly
      ;(eventStream as any)._config.coalescing.maxBatchSize = 3

      // Add events rapidly
      for (let i = 1; i <= 9; i++) {
        coalesceEvent('test-topic', {
          id: `event-${i}`,
          type: 'test',
          topic: 'test-topic',
          payload: {},
          timestamp: Date.now(),
        })
      }

      await vi.runAllTimersAsync()

      // All 9 events should be sent exactly once
      expect(allSentEventIds.sort()).toEqual([
        'event-1',
        'event-2',
        'event-3',
        'event-4',
        'event-5',
        'event-6',
        'event-7',
        'event-8',
        'event-9',
      ])
      expect(allSentEventIds.length).toBe(9) // No duplicates or losses
    })
  })

  describe('Write ordering preserved', () => {
    it('FAILS: batch events internal order not guaranteed after race', async () => {
      /**
       * Events within a batch should maintain insertion order.
       * Race conditions during buffer manipulation could corrupt order.
       */
      const coalesceEvent = (eventStream as any).coalesceEvent.bind(eventStream)

      const receivedOrders: number[] = []
      ;(eventStream as any).fanOutToSubscribers = vi.fn().mockImplementation(async (topic: string, event: BroadcastEvent) => {
        if (event.type === 'batch') {
          receivedOrders.push(...(event.payload as any).events.map((e: any) => e.payload.order))
        } else {
          receivedOrders.push(event.payload.order)
        }
      })

      // Add events with explicit order
      for (let i = 1; i <= 5; i++) {
        coalesceEvent('test-topic', {
          id: `event-${i}`,
          type: 'test',
          topic: 'test-topic',
          payload: { order: i },
          timestamp: Date.now(),
        })
      }

      await vi.runAllTimersAsync()

      // Events should be in insertion order: 1, 2, 3, 4, 5
      expect(receivedOrders).toEqual([1, 2, 3, 4, 5])
    })

    it('FAILS: cross-batch ordering violated when second batch arrives during first flush', async () => {
      /**
       * When event 6 arrives while events 1-5 are being flushed,
       * the final delivery order should be: 1,2,3,4,5 then 6
       * Not interleaved or out of order.
       */
      const coalesceEvent = (eventStream as any).coalesceEvent.bind(eventStream)

      const deliveryOrder: number[] = []
      let firstFlushResolve: () => void

      ;(eventStream as any).fanOutToSubscribers = vi.fn().mockImplementation(async (topic: string, event: BroadcastEvent) => {
        const orders = event.type === 'batch'
          ? (event.payload as any).events.map((e: any) => e.payload.order)
          : [event.payload.order]

        // First flush takes time
        if (deliveryOrder.length === 0) {
          await new Promise<void>((resolve) => {
            firstFlushResolve = resolve
          })
        }

        deliveryOrder.push(...orders)
      })

      // Add 5 events to trigger batch flush
      for (let i = 1; i <= 5; i++) {
        coalesceEvent('test-topic', {
          id: `event-${i}`,
          type: 'test',
          topic: 'test-topic',
          payload: { order: i },
          timestamp: Date.now(),
        })
      }

      // Add event 6 while flush is in progress
      coalesceEvent('test-topic', {
        id: 'event-6',
        type: 'test',
        topic: 'test-topic',
        payload: { order: 6 },
        timestamp: Date.now(),
      })

      // Complete first flush
      firstFlushResolve!()

      // Wait for second flush via timer
      await vi.advanceTimersByTimeAsync(100)
      await vi.runAllTimersAsync()

      // Order should be: 1,2,3,4,5,6 (not 6,1,2,3,4,5 or any other permutation)
      expect(deliveryOrder).toEqual([1, 2, 3, 4, 5, 6])
    })
  })

  describe('Edge cases', () => {
    it('FAILS: empty buffer after partial flush due to early return', async () => {
      /**
       * The early return check `if (!buffer || buffer.events.length === 0) return`
       * can cause issues if buffer is mutated between the check and actual processing.
       */
      const coalesceEvent = (eventStream as any).coalesceEvent.bind(eventStream)
      const flushCoalescedBuffer = (eventStream as any).flushCoalescedBuffer.bind(eventStream)
      const buffers = (eventStream as any).coalescingBuffers

      const flushedEvents: string[] = []
      ;(eventStream as any).fanOutToSubscribers = vi.fn().mockImplementation(async (topic: string, event: BroadcastEvent) => {
        if (event.type === 'batch') {
          flushedEvents.push(...(event.payload as any).events.map((e: any) => e.id))
        } else {
          flushedEvents.push(event.id)
        }
      })

      // Add one event
      coalesceEvent('test-topic', {
        id: 'event-1',
        type: 'test',
        topic: 'test-topic',
        payload: {},
        timestamp: Date.now(),
      })

      // Call flush twice rapidly
      const flush1 = flushCoalescedBuffer('test-topic')
      const flush2 = flushCoalescedBuffer('test-topic')

      await Promise.all([flush1, flush2])
      await vi.runAllTimersAsync()

      // Event should be flushed exactly once (second flush should early-return)
      expect(flushedEvents).toEqual(['event-1'])
    })

    it('FAILS: notifyLiveQuerySubscribers loop can be interrupted by new events', async () => {
      /**
       * In flushCoalescedBuffer, there's a loop:
       *   for (const event of events) {
       *     await this.notifyLiveQuerySubscribers(event)
       *   }
       * Each await is a yield point. New events arriving during the loop
       * go into a new buffer but the old processing continues.
       */
      const coalesceEvent = (eventStream as any).coalesceEvent.bind(eventStream)
      const buffers = (eventStream as any).coalescingBuffers

      let liveQueryNotifications = 0
      const originalNotify = (eventStream as any).notifyLiveQuerySubscribers
      ;(eventStream as any).notifyLiveQuerySubscribers = vi.fn().mockImplementation(async (event: BroadcastEvent) => {
        liveQueryNotifications++

        // During the first notification, add a new event
        if (liveQueryNotifications === 1) {
          coalesceEvent('test-topic', {
            id: 'event-during-notify',
            type: 'test',
            topic: 'test-topic',
            payload: {},
            timestamp: Date.now(),
          })
        }

        return originalNotify?.call(eventStream, event)
      })

      const flushedEvents: string[] = []
      ;(eventStream as any).fanOutToSubscribers = vi.fn().mockImplementation(async (topic: string, event: BroadcastEvent) => {
        if (event.type === 'batch') {
          flushedEvents.push(...(event.payload as any).events.map((e: any) => e.id))
        } else {
          flushedEvents.push(event.id)
        }
      })

      // Add 2 events to trigger batch (adjust batch size)
      ;(eventStream as any)._config.coalescing.maxBatchSize = 2
      coalesceEvent('test-topic', {
        id: 'event-1',
        type: 'test',
        topic: 'test-topic',
        payload: {},
        timestamp: Date.now(),
      })
      coalesceEvent('test-topic', {
        id: 'event-2',
        type: 'test',
        topic: 'test-topic',
        payload: {},
        timestamp: Date.now(),
      })

      // Wait for flush and timer
      await vi.advanceTimersByTimeAsync(100)
      await vi.runAllTimersAsync()

      // All three events should be flushed
      expect(flushedEvents.sort()).toEqual(['event-1', 'event-2', 'event-during-notify'])
    })

    it('FAILS: maximum concurrent flushes not limited causes memory pressure', async () => {
      /**
       * If many topics are being flushed simultaneously, there's no limit
       * on concurrent flushes which could cause memory pressure.
       */
      const coalesceEvent = (eventStream as any).coalesceEvent.bind(eventStream)

      let concurrentFlushes = 0
      let maxConcurrentFlushes = 0

      ;(eventStream as any).fanOutToSubscribers = vi.fn().mockImplementation(async () => {
        concurrentFlushes++
        maxConcurrentFlushes = Math.max(maxConcurrentFlushes, concurrentFlushes)
        await new Promise((resolve) => setTimeout(resolve, 10))
        concurrentFlushes--
      })

      // Create 100 topics with events
      for (let t = 1; t <= 100; t++) {
        coalesceEvent(`topic-${t}`, {
          id: `event-${t}`,
          type: 'test',
          topic: `topic-${t}`,
          payload: {},
          timestamp: Date.now(),
        })
      }

      // Trigger all flushes via timer
      await vi.advanceTimersByTimeAsync(100)
      await vi.runAllTimersAsync()

      // There should be some reasonable limit on concurrent flushes
      // (e.g., 10-20, not 100)
      // This test documents the current behavior (unbounded)
      // A fix would limit maxConcurrentFlushes to a reasonable number
      expect(maxConcurrentFlushes).toBeLessThanOrEqual(20)
    })
  })
})
