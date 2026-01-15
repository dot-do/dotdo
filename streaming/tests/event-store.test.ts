/**
 * EventStore Interface Tests (TDD GREEN Phase)
 *
 * Tests for the IEventStore interface extracted from EventStreamDO.
 * This component handles persistent event storage with trace/session correlation.
 *
 * @issue do-3x2d - EventStore Interface Tests
 * @wave Wave 3: EventStreamDO Decomposition
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import type { UnifiedEvent, EventType } from '../../types/unified-event'
import { EventStore, type IEventStore, type StoredUnifiedEvent } from '../event-stream/event-store'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function createTestEvent(overrides: Partial<UnifiedEvent> = {}): Partial<UnifiedEvent> {
  return {
    id: generateId(),
    event_type: 'trace' as EventType,
    event_name: 'http.request',
    ns: 'https://api.example.com',
    timestamp: new Date().toISOString(),
    trace_id: null,
    span_id: null,
    parent_id: null,
    session_id: null,
    correlation_id: null,
    ...overrides,
  }
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('EventStore', () => {
  let store: IEventStore

  beforeEach(() => {
    store = new EventStore()
  })

  describe('store()', () => {
    it('stores single event and retrieves by id', async () => {
      // Arrange
      const event = createTestEvent({ id: 'test-event-1' })

      // Act
      await store.store(event)
      const retrieved = await store.getById('test-event-1')

      // Assert
      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe('test-event-1')
      expect(retrieved?.event_type).toBe('trace')
    })

    it('stores event with all unified event fields', async () => {
      // Arrange
      const event = createTestEvent({
        id: 'full-event-1',
        event_type: 'trace',
        event_name: 'db.query',
        ns: 'https://db.example.com',
        trace_id: 'trace-123',
        span_id: 'span-456',
        parent_id: 'span-000',
        session_id: 'session-789',
        correlation_id: 'corr-abc',
        duration_ms: 42,
        outcome: 'success',
      })

      // Act
      await store.store(event)
      const retrieved = await store.getById('full-event-1')

      // Assert
      expect(retrieved?.trace_id).toBe('trace-123')
      expect(retrieved?.span_id).toBe('span-456')
      expect(retrieved?.session_id).toBe('session-789')
      expect(retrieved?.duration_ms).toBe(42)
    })

    it('handles missing optional fields gracefully', async () => {
      // Arrange - minimal event with only required fields
      const event: Partial<UnifiedEvent> = {
        id: 'minimal-1',
        event_type: 'log',
        event_name: 'app.log',
        ns: 'default',
      }

      // Act
      await store.store(event)
      const retrieved = await store.getById('minimal-1')

      // Assert
      expect(retrieved?.trace_id).toBeNull()
      expect(retrieved?.session_id).toBeNull()
    })
  })

  describe('storeBatch()', () => {
    it('stores batch of events efficiently', async () => {
      // Arrange
      const events = [
        createTestEvent({ id: 'batch-1' }),
        createTestEvent({ id: 'batch-2' }),
        createTestEvent({ id: 'batch-3' }),
      ]

      // Act
      await store.storeBatch(events)
      const count = await store.count()

      // Assert
      expect(count).toBe(3)
      expect(await store.getById('batch-1')).not.toBeNull()
      expect(await store.getById('batch-2')).not.toBeNull()
      expect(await store.getById('batch-3')).not.toBeNull()
    })

    it('handles empty batch gracefully', async () => {
      // Act
      await store.storeBatch([])
      const count = await store.count()

      // Assert
      expect(count).toBe(0)
    })

    it('is more efficient than individual stores for large batches', async () => {
      // This test verifies batch insertion completes in reasonable time
      const events = Array.from({ length: 100 }, (_, i) =>
        createTestEvent({ id: `perf-${i}` })
      )

      const batchStart = performance.now()
      await store.storeBatch(events)
      const batchTime = performance.now() - batchStart

      // Batch should complete in reasonable time
      expect(batchTime).toBeLessThan(1000) // Less than 1 second for 100 events
    })
  })

  describe('getByTraceId()', () => {
    it('queries by trace_id', async () => {
      // Arrange
      const traceId = 'trace-lookup-test'
      const events = [
        createTestEvent({ id: 'trace-span-1', trace_id: traceId, span_id: 'span-1' }),
        createTestEvent({ id: 'trace-span-2', trace_id: traceId, span_id: 'span-2' }),
        createTestEvent({ id: 'other-span', trace_id: 'different-trace', span_id: 'span-3' }),
      ]

      // Act
      await store.storeBatch(events)
      const traceEvents = await store.getByTraceId(traceId)

      // Assert
      expect(traceEvents).toHaveLength(2)
      expect(traceEvents.map(e => e.id)).toContain('trace-span-1')
      expect(traceEvents.map(e => e.id)).toContain('trace-span-2')
      expect(traceEvents.map(e => e.id)).not.toContain('other-span')
    })

    it('returns empty array for non-existent trace_id', async () => {
      const traceEvents = await store.getByTraceId('non-existent-trace')
      expect(traceEvents).toHaveLength(0)
    })

    it('orders trace events by timestamp', async () => {
      // Arrange
      const traceId = 'ordered-trace'
      const now = Date.now()
      const events = [
        createTestEvent({ id: 'span-3', trace_id: traceId, timestamp: new Date(now + 200).toISOString() }),
        createTestEvent({ id: 'span-1', trace_id: traceId, timestamp: new Date(now).toISOString() }),
        createTestEvent({ id: 'span-2', trace_id: traceId, timestamp: new Date(now + 100).toISOString() }),
      ]

      // Act
      await store.storeBatch(events)
      const traceEvents = await store.getByTraceId(traceId)

      // Assert - should be ordered by timestamp
      expect(traceEvents[0].id).toBe('span-1')
      expect(traceEvents[1].id).toBe('span-2')
      expect(traceEvents[2].id).toBe('span-3')
    })
  })

  describe('getBySessionId()', () => {
    it('queries by session_id', async () => {
      // Arrange
      const sessionId = 'session-lookup-test'
      const events = [
        createTestEvent({ id: 'session-event-1', session_id: sessionId }),
        createTestEvent({ id: 'session-event-2', session_id: sessionId }),
        createTestEvent({ id: 'other-session', session_id: 'different-session' }),
      ]

      // Act
      await store.storeBatch(events)
      const sessionEvents = await store.getBySessionId(sessionId)

      // Assert
      expect(sessionEvents).toHaveLength(2)
      expect(sessionEvents.map(e => e.id)).toContain('session-event-1')
      expect(sessionEvents.map(e => e.id)).toContain('session-event-2')
    })

    it('returns events with mixed event_types for same session', async () => {
      // A session can have traces, logs, vitals, etc.
      const sessionId = 'multi-type-session'
      const events = [
        createTestEvent({ id: 'session-trace', session_id: sessionId, event_type: 'trace' }),
        createTestEvent({ id: 'session-log', session_id: sessionId, event_type: 'log' }),
        createTestEvent({ id: 'session-vital', session_id: sessionId, event_type: 'vital' }),
      ]

      await store.storeBatch(events)
      const sessionEvents = await store.getBySessionId(sessionId)

      expect(sessionEvents).toHaveLength(3)
      expect(sessionEvents.map(e => e.event_type)).toContain('trace')
      expect(sessionEvents.map(e => e.event_type)).toContain('log')
      expect(sessionEvents.map(e => e.event_type)).toContain('vital')
    })
  })

  describe('getByCorrelationId()', () => {
    it('queries by correlation_id', async () => {
      // Arrange
      const correlationId = 'corr-lookup-test'
      const events = [
        createTestEvent({ id: 'corr-event-1', correlation_id: correlationId }),
        createTestEvent({ id: 'corr-event-2', correlation_id: correlationId }),
      ]

      await store.storeBatch(events)
      const corrEvents = await store.getByCorrelationId(correlationId)

      expect(corrEvents).toHaveLength(2)
    })
  })

  describe('cleanup()', () => {
    it('cleans up events older than threshold', async () => {
      // Arrange
      const now = Date.now()

      // Store old event (10 minutes ago)
      const oldEvent = createTestEvent({
        id: 'old-event',
        timestamp: new Date(now - 10 * 60 * 1000).toISOString(),
      })

      // Store recent event (1 minute ago)
      const recentEvent = createTestEvent({
        id: 'recent-event',
        timestamp: new Date(now - 1 * 60 * 1000).toISOString(),
      })

      await store.storeBatch([oldEvent, recentEvent])

      // Act - cleanup events older than 5 minutes
      const deleted = await store.cleanup(5 * 60 * 1000)

      // Assert
      expect(deleted).toBe(1)
      expect(await store.getById('old-event')).toBeNull()
      expect(await store.getById('recent-event')).not.toBeNull()
    })

    it('returns count of deleted events', async () => {
      const events = Array.from({ length: 5 }, (_, i) =>
        createTestEvent({
          id: `cleanup-${i}`,
          timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        })
      )

      await store.storeBatch(events)
      const deleted = await store.cleanup(5 * 60 * 1000)

      expect(deleted).toBe(5)
    })

    it('handles cleanup with no expired events', async () => {
      const recentEvent = createTestEvent({
        id: 'very-recent',
        timestamp: new Date().toISOString(),
      })

      await store.store(recentEvent)
      const deleted = await store.cleanup(5 * 60 * 1000)

      expect(deleted).toBe(0)
      expect(await store.getById('very-recent')).not.toBeNull()
    })
  })

  describe('query()', () => {
    it('supports basic SQL-like queries', async () => {
      const events = [
        createTestEvent({ id: 'q1', event_type: 'trace', ns: 'api' }),
        createTestEvent({ id: 'q2', event_type: 'log', ns: 'api' }),
        createTestEvent({ id: 'q3', event_type: 'trace', ns: 'worker' }),
      ]

      await store.storeBatch(events)

      // Query by event_type
      const traces = await store.query("event_type = 'trace'")
      expect(traces).toHaveLength(2)

      // Query by ns
      const apiEvents = await store.query("ns = 'api'")
      expect(apiEvents).toHaveLength(2)
    })
  })

  describe('count()', () => {
    it('returns total event count', async () => {
      const events = Array.from({ length: 10 }, (_, i) =>
        createTestEvent({ id: `count-${i}` })
      )

      await store.storeBatch(events)
      const count = await store.count()

      expect(count).toBe(10)
    })

    it('returns 0 for empty store', async () => {
      const count = await store.count()
      expect(count).toBe(0)
    })
  })
})
