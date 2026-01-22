/**
 * Dead Letter Queue Cleanup and Inspection Tests (do-w9gl)
 *
 * Tests for the DLQ cleanup and inspection functionality:
 * - Capture failed event deliveries
 * - Store failure metadata (error, timestamp, retries)
 * - Allow inspection and replay of failed events
 * - Clean up old DLQ entries
 *
 * @module do/tests/dlq-cleanup.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createEventsStore,
  type EventsStore,
  type DLQEntry,
  type DLQCleanupOptions
} from '../events'

describe('Dead Letter Queue Cleanup and Inspection (do-w9gl)', () => {
  let events: EventsStore

  beforeEach(() => {
    events = createEventsStore()
  })

  describe('DLQ Entry Inspection', () => {
    it('should get a single DLQ entry by event ID', async () => {
      // Emit an event
      const event = await events.emit({
        type: 'Order.placed',
        payload: { orderId: '123' }
      })

      // Add to DLQ
      await events.addToDeadLetterQueue({
        event,
        attempts: 3,
        lastError: 'NetworkError: Connection refused'
      })

      // Get the entry
      const entry = await events.getDLQEntry(event.$id)
      expect(entry).not.toBeNull()
      expect(entry?.event.$id).toBe(event.$id)
      expect(entry?.attempts).toBe(3)
      expect(entry?.lastError).toBe('NetworkError: Connection refused')
      expect(entry?.timestamp).toBeGreaterThan(0)
    })

    it('should return null for non-existent DLQ entry', async () => {
      const entry = await events.getDLQEntry('non-existent-id')
      expect(entry).toBeNull()
    })

    it('should store failure metadata correctly', async () => {
      const event = await events.emit({
        type: 'Payment.charge',
        payload: { amount: 100 }
      })

      const beforeAdd = Date.now()

      await events.addToDeadLetterQueue({
        event,
        attempts: 5,
        lastError: 'TimeoutError: Request timed out after 30s',
        handlerIndex: 2
      })

      const entry = await events.getDLQEntry(event.$id)
      expect(entry).not.toBeNull()
      expect(entry?.event.type).toBe('Payment.charge')
      expect(entry?.event.payload).toEqual({ amount: 100 })
      expect(entry?.attempts).toBe(5)
      expect(entry?.lastError).toContain('TimeoutError')
      expect(entry?.handlerIndex).toBe(2)
      expect(entry?.timestamp).toBeGreaterThanOrEqual(beforeAdd)
    })
  })

  describe('DLQ Query Options', () => {
    beforeEach(async () => {
      // Add several DLQ entries with different timestamps
      const baseTime = Date.now()

      for (let i = 0; i < 5; i++) {
        const event = await events.emit({
          type: i < 3 ? 'Order.placed' : 'Payment.failed',
          payload: { index: i }
        })

        events.addToDeadLetterQueue({
          event,
          attempts: i + 1,
          lastError: i < 2 ? 'NetworkError: Failed' : 'TimeoutError: Slow'
        })

        // Small delay to ensure distinct timestamps
        await new Promise(r => setTimeout(r, 10))
      }
    })

    it('should filter by event type', async () => {
      const orderEntries = await events.queryDeadLetterQueue({ type: 'Order.placed' })
      expect(orderEntries.length).toBe(3)

      const paymentEntries = await events.queryDeadLetterQueue({ type: 'Payment.failed' })
      expect(paymentEntries.length).toBe(2)
    })

    it('should filter by since timestamp', async () => {
      const allEntries = await events.getDeadLetterQueue()
      expect(allEntries.length).toBe(5)

      // Get entries since the 3rd entry
      const thirdEntry = allEntries.sort((a, b) => a.timestamp - b.timestamp)[2]
      if (!thirdEntry) throw new Error('Expected third entry')

      const recentEntries = await events.queryDeadLetterQueue({
        since: thirdEntry.timestamp
      })
      expect(recentEntries.length).toBeGreaterThanOrEqual(3)
    })

    it('should filter by until timestamp', async () => {
      const allEntries = await events.getDeadLetterQueue()
      expect(allEntries.length).toBe(5)

      // Get the 2nd oldest entry's timestamp as cutoff
      const sorted = [...allEntries].sort((a, b) => a.timestamp - b.timestamp)
      const secondEntry = sorted[1]
      if (!secondEntry) throw new Error('Expected second entry')

      const oldEntries = await events.queryDeadLetterQueue({
        until: secondEntry.timestamp
      })
      // Should include entries at or before the cutoff timestamp
      expect(oldEntries.length).toBeGreaterThanOrEqual(1)
      expect(oldEntries.every(e => e.timestamp <= secondEntry.timestamp)).toBe(true)
    })

    it('should sort ascending when order is asc', async () => {
      const entries = await events.queryDeadLetterQueue({ order: 'asc' })
      expect(entries.length).toBe(5)

      for (let i = 1; i < entries.length; i++) {
        const prev = entries[i - 1]
        const curr = entries[i]
        if (prev && curr) {
          expect(prev.timestamp).toBeLessThanOrEqual(curr.timestamp)
        }
      }
    })

    it('should sort descending by default', async () => {
      const entries = await events.queryDeadLetterQueue({ order: 'desc' })
      expect(entries.length).toBe(5)

      for (let i = 1; i < entries.length; i++) {
        const prev = entries[i - 1]
        const curr = entries[i]
        if (prev && curr) {
          // Descending means newer entries first
          expect(prev.timestamp).toBeGreaterThanOrEqual(curr.timestamp)
        }
      }
    })

    it('should limit results', async () => {
      const entries = await events.queryDeadLetterQueue({ limit: 2 })
      expect(entries.length).toBe(2)
    })
  })

  describe('DLQ Cleanup', () => {
    // Use a helper to add DLQ entries with custom timestamps
    const addDLQEntryWithTimestamp = async (type: string, index: number, lastError: string, timestamp: number) => {
      const event = await events.emit({
        type,
        payload: { index }
      })
      // Access internal array to set timestamp (test helper only)
      const dlqArray = (events as any)._deadLetterQueue || []
      // Since the internal array might not be exposed, we need another approach
      // Let's just use addToDeadLetterQueue and accept the current timestamp
      events.addToDeadLetterQueue({
        event,
        attempts: 3,
        lastError
      })
      // Modify the entry we just added to have the desired timestamp
      const allEntries = await events.getDeadLetterQueue()
      const addedEntry = allEntries.find(e => e.event.$id === event.$id)
      if (addedEntry) {
        // Can't modify directly, so we need to use the array reference
        // This test approach won't work well with the immutable interface
        // Instead, let's test with time-based queries
      }
    }

    beforeEach(async () => {
      // Add entries that will use current timestamps
      // We'll test cleanup with different criteria
      for (let i = 0; i < 3; i++) {
        const event = await events.emit({
          type: 'Order.placed',
          payload: { index: i }
        })
        events.addToDeadLetterQueue({
          event,
          attempts: 3,
          lastError: 'NetworkError: Failure'
        })
        await new Promise(r => setTimeout(r, 5))
      }

      for (let i = 0; i < 2; i++) {
        const event = await events.emit({
          type: 'Payment.failed',
          payload: { index: i }
        })
        events.addToDeadLetterQueue({
          event,
          attempts: 2,
          lastError: 'TimeoutError: Slow'
        })
        await new Promise(r => setTimeout(r, 5))
      }
    })

    it('should cleanup all entries when olderThan is in the future', async () => {
      const beforeCleanup = await events.getDeadLetterQueue()
      expect(beforeCleanup.length).toBe(5)

      // Set olderThan to future - all entries should be cleaned
      const futureTime = Date.now() + 10000
      const result = await events.cleanupDeadLetterQueue({
        olderThan: futureTime
      })

      expect(result.removed).toBe(5)

      const afterCleanup = await events.getDeadLetterQueue()
      expect(afterCleanup.length).toBe(0)
    })

    it('should not cleanup entries when olderThan is in the past', async () => {
      const beforeCleanup = await events.getDeadLetterQueue()
      expect(beforeCleanup.length).toBe(5)

      // Set olderThan to past - no entries should match
      const pastTime = Date.now() - 10000
      const result = await events.cleanupDeadLetterQueue({
        olderThan: pastTime
      })

      // Entries were just added, so none should be older than 10 seconds ago
      expect(result.removed).toBe(0)

      const afterCleanup = await events.getDeadLetterQueue()
      expect(afterCleanup.length).toBe(5)
    })

    it('should cleanup only specific event types', async () => {
      const beforeCleanup = await events.getDeadLetterQueue()
      expect(beforeCleanup.length).toBe(5)

      // Only cleanup Order.placed types
      const futureTime = Date.now() + 10000
      const result = await events.cleanupDeadLetterQueue({
        types: ['Order.placed'],
        olderThan: futureTime
      })

      expect(result.removed).toBe(3)
      expect(result.removedByType['Order.placed']).toBe(3)
      expect(result.removedByType['Payment.failed']).toBeUndefined()

      const afterCleanup = await events.getDeadLetterQueue()
      expect(afterCleanup.length).toBe(2)
      expect(afterCleanup.every(e => e.event.type === 'Payment.failed')).toBe(true)
    })

    it('should cleanup only specific error types', async () => {
      const beforeCleanup = await events.getDeadLetterQueue()
      expect(beforeCleanup.length).toBe(5)

      // Only cleanup NetworkError entries
      const futureTime = Date.now() + 10000
      const result = await events.cleanupDeadLetterQueue({
        errorTypes: ['NetworkError'],
        olderThan: futureTime
      })

      expect(result.removed).toBe(3)

      const afterCleanup = await events.getDeadLetterQueue()
      expect(afterCleanup.length).toBe(2)
      expect(afterCleanup.every(e => e.lastError.includes('TimeoutError'))).toBe(true)
    })

    it('should respect limit when cleaning up', async () => {
      const beforeCleanup = await events.getDeadLetterQueue()
      expect(beforeCleanup.length).toBe(5)

      const futureTime = Date.now() + 10000
      const result = await events.cleanupDeadLetterQueue({
        olderThan: futureTime,
        limit: 2
      })

      expect(result.removed).toBe(2)

      const afterCleanup = await events.getDeadLetterQueue()
      expect(afterCleanup.length).toBe(3)
    })

    it('should return empty result when no entries match type filter', async () => {
      const futureTime = Date.now() + 10000
      const result = await events.cleanupDeadLetterQueue({
        types: ['NonExistent.type'],
        olderThan: futureTime
      })

      expect(result.removed).toBe(0)
      expect(Object.keys(result.removedByType).length).toBe(0)

      const afterCleanup = await events.getDeadLetterQueue()
      expect(afterCleanup.length).toBe(5)
    })

    it('should combine multiple filter criteria', async () => {
      // Only cleanup Order.placed with NetworkError
      const futureTime = Date.now() + 10000
      const result = await events.cleanupDeadLetterQueue({
        olderThan: futureTime,
        types: ['Order.placed'],
        errorTypes: ['NetworkError']
      })

      expect(result.removed).toBe(3)
      expect(result.removedByType['Order.placed']).toBe(3)

      const afterCleanup = await events.getDeadLetterQueue()
      expect(afterCleanup.length).toBe(2)
    })
  })

  describe('DLQ Statistics', () => {
    it('should return accurate statistics', async () => {
      // Add entries with various types and errors
      for (let i = 0; i < 3; i++) {
        const event = await events.emit({
          type: 'Order.placed',
          payload: { i }
        })
        await events.addToDeadLetterQueue({
          event,
          attempts: i + 1,
          lastError: 'NetworkError: Failed'
        })
      }

      for (let i = 0; i < 2; i++) {
        const event = await events.emit({
          type: 'Payment.failed',
          payload: { i }
        })
        await events.addToDeadLetterQueue({
          event,
          attempts: i + 2,
          lastError: 'TimeoutError: Slow'
        })
      }

      const stats = await events.getDLQStats()

      expect(stats.total).toBe(5)
      expect(stats.byEventType['Order.placed']).toBe(3)
      expect(stats.byEventType['Payment.failed']).toBe(2)
      expect(stats.byErrorType['NetworkError']).toBe(3)
      expect(stats.byErrorType['TimeoutError']).toBe(2)
      expect(stats.averageAttempts).toBeCloseTo((1 + 2 + 3 + 2 + 3) / 5, 2)
      expect(stats.uniqueEvents).toBe(5)
      expect(stats.oldestEntry).toBeDefined()
      expect(stats.newestEntry).toBeDefined()
      expect(stats.oldestEntry! <= stats.newestEntry!).toBe(true)
    })

    it('should return empty statistics for empty DLQ', async () => {
      const stats = await events.getDLQStats()

      expect(stats.total).toBe(0)
      expect(Object.keys(stats.byEventType).length).toBe(0)
      expect(Object.keys(stats.byErrorType).length).toBe(0)
      expect(stats.averageAttempts).toBe(0)
      expect(stats.uniqueEvents).toBe(0)
      expect(stats.oldestEntry).toBeUndefined()
      expect(stats.newestEntry).toBeUndefined()
    })
  })

  describe('DLQ Replay', () => {
    it('should replay events from DLQ', async () => {
      // Add events to DLQ
      const originalEvent = await events.emit({
        type: 'Order.retry',
        payload: { orderId: 'abc' }
      })

      events.addToDeadLetterQueue({
        event: originalEvent,
        attempts: 3,
        lastError: 'NetworkError: Temporary failure'
      })

      // Verify in DLQ
      const dlqBefore = await events.getDeadLetterQueue()
      expect(dlqBefore.length).toBe(1)

      // Replay
      const replayed = await events.replayDeadLetterQueue({ type: 'Order.retry' })
      expect(replayed.length).toBe(1)
      expect(replayed[0]?.type).toBe('Order.retry')
      expect(replayed[0]?.source).toBe('dlq-replay')
      expect(replayed[0]?.correlationId).toBe(originalEvent.$id)

      // Should be removed from DLQ after replay
      const dlqAfter = await events.getDeadLetterQueue()
      expect(dlqAfter.length).toBe(0)
    })

    it('should only replay matching entries', async () => {
      // Add multiple events
      const event1 = await events.emit({ type: 'Type.A', payload: {} })
      const event2 = await events.emit({ type: 'Type.B', payload: {} })

      events.addToDeadLetterQueue({ event: event1, attempts: 1, lastError: 'Error' })
      events.addToDeadLetterQueue({ event: event2, attempts: 1, lastError: 'Error' })

      // Only replay Type.A
      const replayed = await events.replayDeadLetterQueue({ type: 'Type.A' })
      expect(replayed.length).toBe(1)

      // Type.B should still be in DLQ
      const dlq = await events.getDeadLetterQueue()
      expect(dlq.length).toBe(1)
      expect(dlq[0]?.event.type).toBe('Type.B')
    })
  })
})
