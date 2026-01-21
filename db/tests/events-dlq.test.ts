/**
 * Dead Letter Queue (DLQ) Tests (do-7wcm.1)
 *
 * TDD tests for DLQ functionality in @dotdo/db events.ts:
 * - addToDeadLetterQueue() / moveToDLQ() - add event to DLQ
 * - getDeadLetterQueue() / queryDeadLetterQueue() - query DLQ entries
 * - getDLQStats() - get DLQ statistics
 * - removeFromDeadLetterQueue() - remove entry from DLQ
 * - Events move to DLQ after max retries exceeded
 * - DLQ entries include error information
 *
 * @module db/tests/events-dlq.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createEventsStore,
  createEventsStoreWithAdapter,
  type EventsStore,
  type DLQEntry,
  type DLQStats,
  type Event
} from '../events'
import { createMemoryStorageAdapter } from '../adapters/memory'

describe('Dead Letter Queue (DLQ) - (do-7wcm.1)', () => {
  let events: EventsStore

  beforeEach(() => {
    events = createEventsStore()
  })

  describe('addToDeadLetterQueue() - Move Event to DLQ', () => {
    it('should add an event to the dead letter queue', async () => {
      const event = await events.emit({
        type: 'Order.process',
        payload: { orderId: 'ord-123' }
      })

      events.addToDeadLetterQueue({
        event,
        attempts: 3,
        lastError: 'NetworkError: Connection refused'
      })

      const dlq = events.getDeadLetterQueue()
      expect(dlq.length).toBe(1)
      expect(dlq[0]?.event.$id).toBe(event.$id)
    })

    it('should auto-generate timestamp when adding to DLQ', async () => {
      const beforeAdd = Date.now()

      const event = await events.emit({
        type: 'Payment.charge',
        payload: { amount: 100 }
      })

      events.addToDeadLetterQueue({
        event,
        attempts: 1,
        lastError: 'Error: Insufficient funds'
      })

      const afterAdd = Date.now()
      const dlq = events.getDeadLetterQueue()

      expect(dlq[0]?.timestamp).toBeGreaterThanOrEqual(beforeAdd)
      expect(dlq[0]?.timestamp).toBeLessThanOrEqual(afterAdd)
    })

    it('should store the handler index when provided', async () => {
      const event = await events.emit({
        type: 'Webhook.deliver',
        payload: { url: 'https://example.com/hook' }
      })

      events.addToDeadLetterQueue({
        event,
        attempts: 2,
        lastError: 'HTTPError: 500 Internal Server Error',
        handlerIndex: 3
      })

      const dlq = events.getDeadLetterQueue()
      expect(dlq[0]?.handlerIndex).toBe(3)
    })

    it('should preserve handlerIndex as undefined when not provided', async () => {
      const event = await events.emit({
        type: 'Email.send',
        payload: { to: 'user@example.com' }
      })

      events.addToDeadLetterQueue({
        event,
        attempts: 1,
        lastError: 'SMTPError: Connection timeout'
      })

      const dlq = events.getDeadLetterQueue()
      expect(dlq[0]?.handlerIndex).toBeUndefined()
    })

    it('should allow multiple entries for the same event (different handlers)', async () => {
      const event = await events.emit({
        type: 'Order.created',
        payload: { orderId: 'ord-456' }
      })

      // First handler fails
      events.addToDeadLetterQueue({
        event,
        attempts: 3,
        lastError: 'Handler1Error: Database unavailable',
        handlerIndex: 0
      })

      // Second handler fails
      events.addToDeadLetterQueue({
        event,
        attempts: 3,
        lastError: 'Handler2Error: Email service down',
        handlerIndex: 1
      })

      const dlq = events.getDeadLetterQueue()
      expect(dlq.length).toBe(2)
      expect(dlq.filter(e => e.event.$id === event.$id).length).toBe(2)
    })
  })

  describe('getDeadLetterQueue() / queryDeadLetterQueue() - Query DLQ Entries', () => {
    beforeEach(async () => {
      // Add various DLQ entries
      for (let i = 0; i < 3; i++) {
        const event = await events.emit({
          type: 'Order.process',
          payload: { index: i }
        })
        events.addToDeadLetterQueue({
          event,
          attempts: i + 1,
          lastError: 'NetworkError: Connection refused'
        })
        await new Promise(r => setTimeout(r, 5))
      }

      for (let i = 0; i < 2; i++) {
        const event = await events.emit({
          type: 'Payment.charge',
          payload: { index: i }
        })
        events.addToDeadLetterQueue({
          event,
          attempts: i + 2,
          lastError: 'TimeoutError: Gateway timeout'
        })
        await new Promise(r => setTimeout(r, 5))
      }
    })

    it('should return all DLQ entries with getDeadLetterQueue()', () => {
      const dlq = events.getDeadLetterQueue()
      expect(dlq.length).toBe(5)
    })

    it('should return a copy, not the internal array', () => {
      const dlq1 = events.getDeadLetterQueue()
      const dlq2 = events.getDeadLetterQueue()
      expect(dlq1).not.toBe(dlq2)

      // Modifying the returned array should not affect the internal state
      dlq1.pop()
      expect(events.getDeadLetterQueue().length).toBe(5)
    })

    it('should filter by event type with queryDeadLetterQueue()', () => {
      const orderEntries = events.queryDeadLetterQueue({ type: 'Order.process' })
      expect(orderEntries.length).toBe(3)

      const paymentEntries = events.queryDeadLetterQueue({ type: 'Payment.charge' })
      expect(paymentEntries.length).toBe(2)
    })

    it('should filter by timestamp range (since/until)', () => {
      const allEntries = events.getDeadLetterQueue()
      const sorted = [...allEntries].sort((a, b) => a.timestamp - b.timestamp)

      // Get middle entry timestamp
      const middleEntry = sorted[2]
      if (!middleEntry) throw new Error('Expected middle entry')

      const recentEntries = events.queryDeadLetterQueue({ since: middleEntry.timestamp })
      expect(recentEntries.length).toBeGreaterThanOrEqual(3)
      expect(recentEntries.every(e => e.timestamp >= middleEntry.timestamp)).toBe(true)
    })

    it('should limit results', () => {
      const limited = events.queryDeadLetterQueue({ limit: 2 })
      expect(limited.length).toBe(2)
    })

    it('should sort by timestamp ascending when order is "asc"', () => {
      const entries = events.queryDeadLetterQueue({ order: 'asc' })

      for (let i = 1; i < entries.length; i++) {
        const prev = entries[i - 1]
        const curr = entries[i]
        if (prev && curr) {
          expect(prev.timestamp).toBeLessThanOrEqual(curr.timestamp)
        }
      }
    })

    it('should sort by timestamp descending by default', () => {
      const entries = events.queryDeadLetterQueue({})

      for (let i = 1; i < entries.length; i++) {
        const prev = entries[i - 1]
        const curr = entries[i]
        if (prev && curr) {
          expect(prev.timestamp).toBeGreaterThanOrEqual(curr.timestamp)
        }
      }
    })

    it('should combine multiple query options', () => {
      const entries = events.queryDeadLetterQueue({
        type: 'Order.process',
        limit: 2,
        order: 'asc'
      })

      expect(entries.length).toBe(2)
      expect(entries.every(e => e.event.type === 'Order.process')).toBe(true)
    })
  })

  describe('getDLQStats() - Get DLQ Statistics', () => {
    it('should return empty stats for empty DLQ', () => {
      const stats = events.getDLQStats()

      expect(stats.total).toBe(0)
      expect(stats.uniqueEvents).toBe(0)
      expect(stats.averageAttempts).toBe(0)
      expect(Object.keys(stats.byEventType).length).toBe(0)
      expect(Object.keys(stats.byErrorType).length).toBe(0)
      expect(stats.oldestEntry).toBeUndefined()
      expect(stats.newestEntry).toBeUndefined()
    })

    it('should count total entries', async () => {
      for (let i = 0; i < 5; i++) {
        const event = await events.emit({ type: 'Test.event', payload: { i } })
        events.addToDeadLetterQueue({ event, attempts: 1, lastError: 'Error' })
      }

      const stats = events.getDLQStats()
      expect(stats.total).toBe(5)
    })

    it('should count by event type', async () => {
      const event1 = await events.emit({ type: 'Order.process', payload: {} })
      const event2 = await events.emit({ type: 'Order.process', payload: {} })
      const event3 = await events.emit({ type: 'Payment.charge', payload: {} })

      events.addToDeadLetterQueue({ event: event1, attempts: 1, lastError: 'Error' })
      events.addToDeadLetterQueue({ event: event2, attempts: 1, lastError: 'Error' })
      events.addToDeadLetterQueue({ event: event3, attempts: 1, lastError: 'Error' })

      const stats = events.getDLQStats()
      expect(stats.byEventType['Order.process']).toBe(2)
      expect(stats.byEventType['Payment.charge']).toBe(1)
    })

    it('should count by error type', async () => {
      const event1 = await events.emit({ type: 'Test', payload: {} })
      const event2 = await events.emit({ type: 'Test', payload: {} })
      const event3 = await events.emit({ type: 'Test', payload: {} })

      events.addToDeadLetterQueue({ event: event1, attempts: 1, lastError: 'NetworkError: Connection refused' })
      events.addToDeadLetterQueue({ event: event2, attempts: 1, lastError: 'TimeoutError: Request timed out' })
      events.addToDeadLetterQueue({ event: event3, attempts: 1, lastError: 'NetworkError: DNS lookup failed' })

      const stats = events.getDLQStats()
      expect(stats.byErrorType['NetworkError']).toBe(2)
      expect(stats.byErrorType['TimeoutError']).toBe(1)
    })

    it('should calculate average attempts', async () => {
      const event1 = await events.emit({ type: 'Test', payload: {} })
      const event2 = await events.emit({ type: 'Test', payload: {} })
      const event3 = await events.emit({ type: 'Test', payload: {} })

      events.addToDeadLetterQueue({ event: event1, attempts: 1, lastError: 'Error' })
      events.addToDeadLetterQueue({ event: event2, attempts: 3, lastError: 'Error' })
      events.addToDeadLetterQueue({ event: event3, attempts: 5, lastError: 'Error' })

      const stats = events.getDLQStats()
      expect(stats.averageAttempts).toBeCloseTo(3, 2) // (1 + 3 + 5) / 3 = 3
    })

    it('should count unique events', async () => {
      const event = await events.emit({ type: 'Test', payload: {} })

      // Same event added multiple times (different handler failures)
      events.addToDeadLetterQueue({ event, attempts: 1, lastError: 'Error1', handlerIndex: 0 })
      events.addToDeadLetterQueue({ event, attempts: 1, lastError: 'Error2', handlerIndex: 1 })

      const stats = events.getDLQStats()
      expect(stats.total).toBe(2)
      expect(stats.uniqueEvents).toBe(1)
    })

    it('should track oldest and newest entry timestamps', async () => {
      const event1 = await events.emit({ type: 'Test', payload: {} })
      events.addToDeadLetterQueue({ event: event1, attempts: 1, lastError: 'Error' })

      await new Promise(r => setTimeout(r, 10))

      const event2 = await events.emit({ type: 'Test', payload: {} })
      events.addToDeadLetterQueue({ event: event2, attempts: 1, lastError: 'Error' })

      const stats = events.getDLQStats()
      expect(stats.oldestEntry).toBeDefined()
      expect(stats.newestEntry).toBeDefined()
      expect(stats.oldestEntry!).toBeLessThan(stats.newestEntry!)
    })

    it('should handle unknown error format', async () => {
      const event = await events.emit({ type: 'Test', payload: {} })
      events.addToDeadLetterQueue({ event, attempts: 1, lastError: 'Some random error message' })

      const stats = events.getDLQStats()
      expect(stats.byErrorType['UnknownError']).toBe(1)
    })
  })

  describe('removeFromDeadLetterQueue() - Remove Entry from DLQ', () => {
    it('should remove an entry by event ID', async () => {
      const event1 = await events.emit({ type: 'Test', payload: { id: 1 } })
      const event2 = await events.emit({ type: 'Test', payload: { id: 2 } })

      events.addToDeadLetterQueue({ event: event1, attempts: 1, lastError: 'Error' })
      events.addToDeadLetterQueue({ event: event2, attempts: 1, lastError: 'Error' })

      expect(events.getDeadLetterQueue().length).toBe(2)

      const removed = events.removeFromDeadLetterQueue(event1.$id)
      expect(removed).toBe(true)

      const dlq = events.getDeadLetterQueue()
      expect(dlq.length).toBe(1)
      expect(dlq[0]?.event.$id).toBe(event2.$id)
    })

    it('should return false when event ID not found', () => {
      const removed = events.removeFromDeadLetterQueue('non-existent-id')
      expect(removed).toBe(false)
    })

    it('should only remove the first matching entry when event has multiple DLQ entries', async () => {
      const event = await events.emit({ type: 'Test', payload: {} })

      // Same event, different handler failures
      events.addToDeadLetterQueue({ event, attempts: 1, lastError: 'Error1', handlerIndex: 0 })
      events.addToDeadLetterQueue({ event, attempts: 1, lastError: 'Error2', handlerIndex: 1 })

      expect(events.getDeadLetterQueue().length).toBe(2)

      const removed = events.removeFromDeadLetterQueue(event.$id)
      expect(removed).toBe(true)

      // Should still have one entry for this event
      const dlq = events.getDeadLetterQueue()
      expect(dlq.length).toBe(1)
      expect(dlq[0]?.event.$id).toBe(event.$id)
    })
  })

  describe('getDLQEntry() - Get Single DLQ Entry', () => {
    it('should get a specific DLQ entry by event ID', async () => {
      const event = await events.emit({
        type: 'Order.process',
        payload: { orderId: 'ord-789' }
      })

      events.addToDeadLetterQueue({
        event,
        attempts: 3,
        lastError: 'DatabaseError: Connection pool exhausted'
      })

      const entry = events.getDLQEntry(event.$id)
      expect(entry).not.toBeNull()
      expect(entry?.event.$id).toBe(event.$id)
      expect(entry?.attempts).toBe(3)
      expect(entry?.lastError).toBe('DatabaseError: Connection pool exhausted')
    })

    it('should return null for non-existent event ID', () => {
      const entry = events.getDLQEntry('non-existent-id')
      expect(entry).toBeNull()
    })
  })

  describe('Events Move to DLQ After Subscriber Errors', () => {
    it('should move event to DLQ when sync subscriber throws', async () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Handler failure')
      })

      events.subscribe(errorHandler)

      await events.emit({
        type: 'Test.event',
        payload: { trigger: 'error' }
      })

      // Check that event was added to DLQ
      const dlq = events.getDeadLetterQueue()
      expect(dlq.length).toBe(1)
      expect(dlq[0]?.lastError).toBe('Handler failure')
      expect(dlq[0]?.attempts).toBe(1)
      expect(dlq[0]?.handlerIndex).toBe(0)
    })

    it('should move event to DLQ when async subscriber rejects', async () => {
      const asyncErrorHandler = vi.fn(async () => {
        await new Promise(r => setTimeout(r, 1))
        throw new Error('Async handler failure')
      })

      events.subscribe(asyncErrorHandler)

      await events.emit({
        type: 'Test.async',
        payload: { trigger: 'async-error' }
      })

      // Wait for async handler to reject
      await new Promise(r => setTimeout(r, 50))

      const dlq = events.getDeadLetterQueue()
      expect(dlq.length).toBe(1)
      expect(dlq[0]?.lastError).toBe('Async handler failure')
    })

    it('should track handler index for multiple subscribers', async () => {
      const goodHandler = vi.fn()
      const badHandler = vi.fn(() => {
        throw new Error('Bad handler')
      })
      const anotherGoodHandler = vi.fn()

      events.subscribe(goodHandler)      // index 0
      events.subscribe(badHandler)       // index 1
      events.subscribe(anotherGoodHandler) // index 2

      await events.emit({ type: 'Test', payload: {} })

      // Good handlers should still be called
      expect(goodHandler).toHaveBeenCalled()
      expect(anotherGoodHandler).toHaveBeenCalled()

      // Bad handler should have its failure logged to DLQ
      const dlq = events.getDeadLetterQueue()
      expect(dlq.length).toBe(1)
      expect(dlq[0]?.handlerIndex).toBe(1)
    })
  })

  describe('DLQ Entries Include Error Information', () => {
    it('should preserve full error message', async () => {
      const event = await events.emit({ type: 'Test', payload: {} })

      events.addToDeadLetterQueue({
        event,
        attempts: 3,
        lastError: 'NetworkError: ECONNREFUSED - Connection refused to host localhost:5432'
      })

      const entry = events.getDLQEntry(event.$id)
      expect(entry?.lastError).toBe('NetworkError: ECONNREFUSED - Connection refused to host localhost:5432')
    })

    it('should preserve original event payload in DLQ entry', async () => {
      const originalPayload = {
        orderId: 'ord-complex',
        items: [{ sku: 'ABC', qty: 2 }],
        metadata: { source: 'api', version: '2.0' }
      }

      const event = await events.emit({
        type: 'Order.complex',
        payload: originalPayload
      })

      events.addToDeadLetterQueue({
        event,
        attempts: 1,
        lastError: 'ValidationError: Invalid items'
      })

      const entry = events.getDLQEntry(event.$id)
      expect(entry?.event.payload).toEqual(originalPayload)
    })

    it('should preserve event source and correlationId', async () => {
      const event = await events.emit({
        type: 'Traced.event',
        payload: {},
        source: 'api-gateway',
        correlationId: 'trace-123'
      })

      events.addToDeadLetterQueue({
        event,
        attempts: 1,
        lastError: 'Error'
      })

      const entry = events.getDLQEntry(event.$id)
      expect(entry?.event.source).toBe('api-gateway')
      expect(entry?.event.correlationId).toBe('trace-123')
    })
  })

  describe('replayDeadLetterQueue() - Replay Failed Events', () => {
    it('should re-emit events from DLQ', async () => {
      const originalEvent = await events.emit({
        type: 'Order.retry',
        payload: { orderId: 'retry-001' }
      })

      events.addToDeadLetterQueue({
        event: originalEvent,
        attempts: 3,
        lastError: 'Temporary failure'
      })

      const replayed = await events.replayDeadLetterQueue({ type: 'Order.retry' })

      expect(replayed.length).toBe(1)
      expect(replayed[0]?.type).toBe('Order.retry')
      expect(replayed[0]?.payload).toEqual({ orderId: 'retry-001' })
      expect(replayed[0]?.source).toBe('dlq-replay')
      expect(replayed[0]?.correlationId).toBe(originalEvent.$id)
    })

    it('should remove replayed events from DLQ', async () => {
      const event = await events.emit({ type: 'Replay.test', payload: {} })
      events.addToDeadLetterQueue({ event, attempts: 1, lastError: 'Error' })

      expect(events.getDeadLetterQueue().length).toBe(1)

      await events.replayDeadLetterQueue()

      expect(events.getDeadLetterQueue().length).toBe(0)
    })

    it('should create new event IDs for replayed events', async () => {
      const original = await events.emit({ type: 'Replay.newId', payload: {} })
      events.addToDeadLetterQueue({ event: original, attempts: 1, lastError: 'Error' })

      const [replayed] = await events.replayDeadLetterQueue()

      expect(replayed?.$id).not.toBe(original.$id)
    })
  })

  describe('cleanupDeadLetterQueue() - Cleanup Old Entries', () => {
    beforeEach(async () => {
      // Add entries with different types and errors
      for (let i = 0; i < 3; i++) {
        const event = await events.emit({ type: 'Order.stale', payload: { i } })
        events.addToDeadLetterQueue({ event, attempts: 1, lastError: 'NetworkError: Stale' })
        await new Promise(r => setTimeout(r, 5))
      }
    })

    it('should cleanup entries older than specified timestamp', async () => {
      const futureTime = Date.now() + 10000
      const result = events.cleanupDeadLetterQueue({ olderThan: futureTime })

      expect(result.removed).toBe(3)
      expect(events.getDeadLetterQueue().length).toBe(0)
    })

    it('should not cleanup recent entries', () => {
      const pastTime = Date.now() - 10000
      const result = events.cleanupDeadLetterQueue({ olderThan: pastTime })

      expect(result.removed).toBe(0)
      expect(events.getDeadLetterQueue().length).toBe(3)
    })

    it('should track removed counts by event type', () => {
      const futureTime = Date.now() + 10000
      const result = events.cleanupDeadLetterQueue({ olderThan: futureTime })

      expect(result.removedByType['Order.stale']).toBe(3)
    })

    it('should respect limit option', () => {
      const futureTime = Date.now() + 10000
      const result = events.cleanupDeadLetterQueue({ olderThan: futureTime, limit: 1 })

      expect(result.removed).toBe(1)
      expect(events.getDeadLetterQueue().length).toBe(2)
    })

    it('should cleanup by olderThanDays', async () => {
      // Current entries are very recent, so 1 day old should not match
      const result = events.cleanupDeadLetterQueue({ olderThanDays: 1 })
      expect(result.removed).toBe(0)
    })

    it('should filter by event types', async () => {
      // Add some different types
      const event = await events.emit({ type: 'Payment.stale', payload: {} })
      events.addToDeadLetterQueue({ event, attempts: 1, lastError: 'Error' })

      const futureTime = Date.now() + 10000
      const result = events.cleanupDeadLetterQueue({
        olderThan: futureTime,
        types: ['Order.stale']
      })

      expect(result.removed).toBe(3)
      expect(result.removedByType['Order.stale']).toBe(3)
      expect(events.getDeadLetterQueue().length).toBe(1) // Payment.stale remains
    })

    it('should filter by error types', async () => {
      // Add entry with different error
      const event = await events.emit({ type: 'Other.event', payload: {} })
      events.addToDeadLetterQueue({ event, attempts: 1, lastError: 'TimeoutError: Slow' })

      const futureTime = Date.now() + 10000
      const result = events.cleanupDeadLetterQueue({
        olderThan: futureTime,
        errorTypes: ['NetworkError']
      })

      expect(result.removed).toBe(3)
      expect(events.getDeadLetterQueue().length).toBe(1) // TimeoutError entry remains
    })
  })

  describe('Storage Adapter Integration', () => {
    let adapterStore: EventsStore

    beforeEach(() => {
      adapterStore = createEventsStoreWithAdapter(createMemoryStorageAdapter())
    })

    it('should add to DLQ with storage adapter', async () => {
      const event = await adapterStore.emit({
        type: 'Adapter.event',
        payload: { test: true }
      })

      adapterStore.addToDeadLetterQueue({
        event,
        attempts: 2,
        lastError: 'AdapterError: Storage failed'
      })

      const dlq = adapterStore.getDeadLetterQueue()
      expect(dlq.length).toBe(1)
      expect(dlq[0]?.event.$id).toBe(event.$id)
    })

    it('should query DLQ with storage adapter', async () => {
      const event1 = await adapterStore.emit({ type: 'Type.A', payload: {} })
      const event2 = await adapterStore.emit({ type: 'Type.B', payload: {} })

      adapterStore.addToDeadLetterQueue({ event: event1, attempts: 1, lastError: 'Error' })
      adapterStore.addToDeadLetterQueue({ event: event2, attempts: 1, lastError: 'Error' })

      const filtered = adapterStore.queryDeadLetterQueue({ type: 'Type.A' })
      expect(filtered.length).toBe(1)
    })

    it('should get DLQ stats with storage adapter', async () => {
      const event1 = await adapterStore.emit({ type: 'Stats.event', payload: {} })
      const event2 = await adapterStore.emit({ type: 'Stats.event', payload: {} })

      adapterStore.addToDeadLetterQueue({ event: event1, attempts: 1, lastError: 'NetworkError: Test' })
      adapterStore.addToDeadLetterQueue({ event: event2, attempts: 3, lastError: 'NetworkError: Test' })

      const stats = adapterStore.getDLQStats()
      expect(stats.total).toBe(2)
      expect(stats.averageAttempts).toBe(2) // (1 + 3) / 2
    })

    it('should remove from DLQ with storage adapter', async () => {
      const event = await adapterStore.emit({ type: 'Remove.event', payload: {} })
      adapterStore.addToDeadLetterQueue({ event, attempts: 1, lastError: 'Error' })

      expect(adapterStore.getDeadLetterQueue().length).toBe(1)

      const removed = adapterStore.removeFromDeadLetterQueue(event.$id)
      expect(removed).toBe(true)
      expect(adapterStore.getDeadLetterQueue().length).toBe(0)
    })

    it('should replay DLQ with storage adapter', async () => {
      const event = await adapterStore.emit({
        type: 'Replay.adapter',
        payload: { data: 'test' }
      })

      adapterStore.addToDeadLetterQueue({
        event,
        attempts: 2,
        lastError: 'Temporary error'
      })

      const replayed = await adapterStore.replayDeadLetterQueue()
      expect(replayed.length).toBe(1)
      expect(replayed[0]?.source).toBe('dlq-replay')
      expect(adapterStore.getDeadLetterQueue().length).toBe(0)
    })
  })
})
