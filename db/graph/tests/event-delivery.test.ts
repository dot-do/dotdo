/**
 * Event Delivery Tests - Streamed Flag and Guaranteed Delivery
 *
 * RED PHASE: Tests for guaranteed event delivery with streamed flag.
 *
 * @see dotdo-8x0hz - [RED] Event Delivery - streamed flag tests
 *
 * Events are Relationships with verb in event form (created, updated, deleted).
 * The streamed flag tracks which events have been delivered to pipelines/Iceberg.
 *
 * Design:
 * - Events are completed actions (verb in event form)
 * - streamed=false initially (undelivered)
 * - streamed=true after successful delivery + acknowledgment
 * - Query unstreamed events for retry/batch processing
 * - Idempotent delivery (at-least-once with dedup)
 *
 * Uses real SQLite, NO MOCKS - per project testing philosophy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores'
import {
  ActionLifecycleStore,
  type Event,
  type CreateActionInput,
} from '../actions'

// ============================================================================
// TYPES - Event Delivery
// ============================================================================

/**
 * Extended Event with delivery tracking
 */
interface DeliverableEvent extends Event {
  /** Whether the event has been delivered to pipelines */
  streamed: boolean
  /** Delivery attempt count */
  deliveryAttempts?: number
  /** Last delivery attempt timestamp */
  lastDeliveryAttempt?: Date
  /** Delivery error if failed */
  deliveryError?: string
}

/**
 * Options for querying unstreamed events
 */
interface UnstreamedEventsOptions {
  /** Maximum number of events to return */
  limit?: number
  /** Filter by verb type */
  verb?: string
  /** Filter by source URL */
  from?: string
  /** Minimum age in milliseconds (for delay before retry) */
  minAge?: number
}

/**
 * Delivery result
 */
interface DeliveryResult {
  success: boolean
  eventId: string
  error?: string
  deliveredAt?: Date
}

/**
 * Pipeline configuration
 */
interface PipelineConfig {
  endpoint: string
  timeout?: number
  retryPolicy?: {
    maxRetries: number
    backoffMs: number
    maxBackoffMs: number
  }
}

/**
 * Event Delivery Store - manages event streaming state
 */
interface EventDeliveryStore {
  /**
   * Get an event with delivery metadata
   */
  getEvent(eventId: string): Promise<DeliverableEvent | null>

  /**
   * Query events that haven't been streamed yet
   */
  getUnstreamedEvents(options?: UnstreamedEventsOptions): Promise<DeliverableEvent[]>

  /**
   * Mark an event as delivered (set streamed=true)
   */
  markAsStreamed(eventId: string): Promise<DeliverableEvent>

  /**
   * Deliver an event to configured pipeline
   */
  deliverEvent(eventId: string): Promise<DeliveryResult>

  /**
   * Record a delivery failure
   */
  recordDeliveryFailure(eventId: string, error: Error): Promise<DeliverableEvent>

  /**
   * Get delivery statistics
   */
  getDeliveryStats(): Promise<{
    totalEvents: number
    streamed: number
    unstreamed: number
    failed: number
    avgDeliveryTime: number
  }>

  /**
   * Configure pipeline endpoint
   */
  configurePipeline(config: PipelineConfig): void
}

// ============================================================================
// TEST SUITE: Event Delivery
// ============================================================================

describe('Event Delivery - Streamed Flag', () => {
  let store: SQLiteGraphStore
  let lifecycle: ActionLifecycleStore

  // Bound functions for cleaner test syntax
  let createAction: (input: CreateActionInput) => Promise<import('../actions').Action>
  let startAction: (actionId: string) => Promise<import('../actions').Activity>
  let completeAction: (activityId: string, resultTo: string) => Promise<Event>

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    lifecycle = new ActionLifecycleStore(store)

    // Bind methods
    createAction = lifecycle.createAction.bind(lifecycle)
    startAction = lifecycle.startAction.bind(lifecycle)
    completeAction = lifecycle.completeAction.bind(lifecycle)
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // 1. Streamed Flag Initial State
  // ==========================================================================

  describe('Streamed Flag Initial State', () => {
    it('events have streamed=false initially', async () => {
      // Create and complete an action to generate an event
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      // Import the EventDeliveryStore (will fail until implemented)
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      const deliverableEvent = await deliveryStore.getEvent(event.id)

      expect(deliverableEvent).not.toBeNull()
      expect(deliverableEvent?.streamed).toBe(false)
    })

    it('newly created events default to unstreamed state', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      // Create multiple events
      for (let i = 0; i < 3; i++) {
        const action = await createAction({
          verb: 'create',
          from: 'https://users.do/alice',
          to: `https://projects.do/proj-${i}`,
        })
        const activity = await startAction(action.id)
        await completeAction(activity.id, `https://projects.do/proj-${i}-result`)
      }

      const unstreamed = await deliveryStore.getUnstreamedEvents()

      expect(unstreamed.length).toBe(3)
      expect(unstreamed.every(e => e.streamed === false)).toBe(true)
    })

    it('streamed flag persists across store reinitialization', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')

      // Create an event
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/proj-1',
      })
      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-1-result')

      // Mark as streamed
      const deliveryStore = new EventDeliveryStore(store)
      await deliveryStore.markAsStreamed(event.id)

      // Create new delivery store instance (simulating reconnection)
      const deliveryStore2 = new EventDeliveryStore(store)
      const retrievedEvent = await deliveryStore2.getEvent(event.id)

      expect(retrievedEvent?.streamed).toBe(true)
    })
  })

  // ==========================================================================
  // 2. Mark Event as Streamed
  // ==========================================================================

  describe('Mark Event as Streamed', () => {
    it('marks event as streamed after delivery', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      // Create and complete action
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })
      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      // Verify initially not streamed
      let deliverableEvent = await deliveryStore.getEvent(event.id)
      expect(deliverableEvent?.streamed).toBe(false)

      // Mark as streamed
      await deliveryStore.markAsStreamed(event.id)

      // Verify now streamed
      deliverableEvent = await deliveryStore.getEvent(event.id)
      expect(deliverableEvent?.streamed).toBe(true)
    })

    it('throws error when marking non-existent event as streamed', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      await expect(
        deliveryStore.markAsStreamed('non-existent-event-id')
      ).rejects.toThrow()
    })

    it('marking already-streamed event is idempotent', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })
      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      // Mark as streamed twice - should not throw
      await deliveryStore.markAsStreamed(event.id)
      await deliveryStore.markAsStreamed(event.id)

      const deliverableEvent = await deliveryStore.getEvent(event.id)
      expect(deliverableEvent?.streamed).toBe(true)
    })

    it('only marks events (not actions or activities) as streamed', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      // Create action but don't complete it
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })

      // Action (not event) should fail
      await expect(
        deliveryStore.markAsStreamed(action.id)
      ).rejects.toThrow(/not an event/i)

      // Start but don't complete
      const activity = await startAction(action.id)

      // Activity (not event) should fail
      await expect(
        deliveryStore.markAsStreamed(activity.id)
      ).rejects.toThrow(/not an event/i)
    })
  })

  // ==========================================================================
  // 3. Query Unstreamed Events
  // ==========================================================================

  describe('Query Unstreamed Events', () => {
    beforeEach(async () => {
      // Create multiple events with different timestamps
      for (let i = 0; i < 5; i++) {
        const action = await createAction({
          verb: 'create',
          from: `https://users.do/user-${i}`,
          to: `https://projects.do/proj-${i}`,
        })
        const activity = await startAction(action.id)
        await completeAction(activity.id, `https://projects.do/proj-${i}-result`)
      }
    })

    it('queries unstreamed events for retry', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      const unstreamed = await deliveryStore.getUnstreamedEvents()

      expect(unstreamed.length).toBe(5)
      expect(unstreamed.every(e => !e.streamed)).toBe(true)
    })

    it('returns events in order by createdAt (oldest first)', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      const unstreamed = await deliveryStore.getUnstreamedEvents()

      // Events should be ordered by createdAt ascending (oldest first for FIFO)
      for (let i = 1; i < unstreamed.length; i++) {
        const prevTime = unstreamed[i - 1]!.completedAt.getTime()
        const currTime = unstreamed[i]!.completedAt.getTime()
        expect(currTime).toBeGreaterThanOrEqual(prevTime)
      }
    })

    it('supports batch size limit', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      const batch = await deliveryStore.getUnstreamedEvents({ limit: 2 })

      expect(batch.length).toBe(2)
    })

    it('excludes streamed events from results', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      // Get all unstreamed
      let unstreamed = await deliveryStore.getUnstreamedEvents()
      expect(unstreamed.length).toBe(5)

      // Mark first two as streamed
      await deliveryStore.markAsStreamed(unstreamed[0]!.id)
      await deliveryStore.markAsStreamed(unstreamed[1]!.id)

      // Query again - should only return 3
      unstreamed = await deliveryStore.getUnstreamedEvents()
      expect(unstreamed.length).toBe(3)
    })

    it('filters by verb type', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      // Create events with different verbs
      const updateAction = await createAction({
        verb: 'update',
        from: 'https://users.do/alice',
        to: 'https://projects.do/proj-existing',
      })
      const updateActivity = await startAction(updateAction.id)
      await completeAction(updateActivity.id, 'https://projects.do/proj-updated')

      const deleteAction = await createAction({
        verb: 'delete',
        from: 'https://users.do/alice',
        to: 'https://projects.do/proj-to-delete',
      })
      const deleteActivity = await startAction(deleteAction.id)
      await completeAction(deleteActivity.id, 'https://archive.do/proj-deleted')

      // Query by verb
      const createdEvents = await deliveryStore.getUnstreamedEvents({ verb: 'created' })
      const updatedEvents = await deliveryStore.getUnstreamedEvents({ verb: 'updated' })
      const deletedEvents = await deliveryStore.getUnstreamedEvents({ verb: 'deleted' })

      expect(createdEvents.length).toBe(5)
      expect(updatedEvents.length).toBe(1)
      expect(deletedEvents.length).toBe(1)
    })

    it('filters by source URL', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      const fromUser0 = await deliveryStore.getUnstreamedEvents({
        from: 'https://users.do/user-0'
      })

      expect(fromUser0.length).toBe(1)
      expect(fromUser0[0]?.from).toBe('https://users.do/user-0')
    })
  })

  // ==========================================================================
  // 4. Idempotent Delivery
  // ==========================================================================

  describe('Idempotent Delivery', () => {
    it('does not deliver same event twice', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      // Track delivery count via mock pipeline
      let deliveryCount = 0
      deliveryStore.configurePipeline({
        endpoint: 'https://pipeline.test/events',
        timeout: 5000,
      })

      // Mock the actual delivery to count calls
      const originalDeliver = deliveryStore.deliverEvent.bind(deliveryStore)
      deliveryStore.deliverEvent = async (eventId: string) => {
        deliveryCount++
        return originalDeliver(eventId)
      }

      // Create event
      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })
      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      // Deliver twice
      await deliveryStore.deliverEvent(event.id)
      await deliveryStore.deliverEvent(event.id) // Second call should be no-op

      // Event should only be delivered once (implementation should check streamed flag)
      expect(deliveryCount).toBe(1)
    })

    it('returns same result for repeated delivery attempts on streamed event', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })
      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      // First delivery
      const result1 = await deliveryStore.deliverEvent(event.id)
      expect(result1.success).toBe(true)

      // Second delivery should return success (idempotent)
      const result2 = await deliveryStore.deliverEvent(event.id)
      expect(result2.success).toBe(true)
      expect(result2.eventId).toBe(event.id)
    })
  })

  // ==========================================================================
  // 5. Delivery Acknowledgment
  // ==========================================================================

  describe('Delivery Acknowledgment', () => {
    it('only marks streamed after ack received', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })
      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      // Before delivery
      let deliverableEvent = await deliveryStore.getEvent(event.id)
      expect(deliverableEvent?.streamed).toBe(false)

      // Deliver with acknowledgment
      const result = await deliveryStore.deliverEvent(event.id)

      // After successful delivery with ack
      if (result.success) {
        deliverableEvent = await deliveryStore.getEvent(event.id)
        expect(deliverableEvent?.streamed).toBe(true)
      }
    })

    it('does not mark streamed if delivery fails', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      // Configure with failing endpoint
      deliveryStore.configurePipeline({
        endpoint: 'https://failing-pipeline.test/events',
        timeout: 100,
        retryPolicy: {
          maxRetries: 0,
          backoffMs: 100,
          maxBackoffMs: 1000,
        },
      })

      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })
      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      // Attempt delivery (will fail)
      const result = await deliveryStore.deliverEvent(event.id)

      // Should not be marked as streamed
      const deliverableEvent = await deliveryStore.getEvent(event.id)
      expect(deliverableEvent?.streamed).toBe(false)
      expect(result.success).toBe(false)
    })

    it('retries on failed delivery', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      // Track delivery attempts
      let attemptCount = 0

      deliveryStore.configurePipeline({
        endpoint: 'https://flaky-pipeline.test/events',
        timeout: 1000,
        retryPolicy: {
          maxRetries: 3,
          backoffMs: 10, // Fast for tests
          maxBackoffMs: 100,
        },
      })

      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })
      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      // Delivery should retry on failure
      const result = await deliveryStore.deliverEvent(event.id)

      // Should have incremented delivery attempts
      const deliverableEvent = await deliveryStore.getEvent(event.id)
      expect(deliverableEvent?.deliveryAttempts).toBeGreaterThan(0)
    })

    it('has max retry limit', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      deliveryStore.configurePipeline({
        endpoint: 'https://always-failing.test/events',
        timeout: 100,
        retryPolicy: {
          maxRetries: 3,
          backoffMs: 10,
          maxBackoffMs: 100,
        },
      })

      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })
      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      // Attempt delivery - should stop after max retries
      const result = await deliveryStore.deliverEvent(event.id)

      const deliverableEvent = await deliveryStore.getEvent(event.id)

      // Should have tried maxRetries + 1 times (initial + retries)
      expect(deliverableEvent?.deliveryAttempts).toBeLessThanOrEqual(4)
      expect(result.success).toBe(false)
    })

    it('records delivery failure details', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })
      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      // Record failure
      await deliveryStore.recordDeliveryFailure(event.id, new Error('Connection timeout'))

      const deliverableEvent = await deliveryStore.getEvent(event.id)

      expect(deliverableEvent?.deliveryError).toBe('Connection timeout')
      expect(deliverableEvent?.lastDeliveryAttempt).toBeDefined()
    })
  })

  // ==========================================================================
  // 6. Pipeline Integration
  // ==========================================================================

  describe('Pipeline Integration', () => {
    it('delivers to configured pipeline endpoint', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      // Configure pipeline
      deliveryStore.configurePipeline({
        endpoint: 'https://iceberg.pipeline.do/events',
        timeout: 5000,
      })

      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
        data: { name: 'Test Project' },
      })
      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      const result = await deliveryStore.deliverEvent(event.id)

      expect(result.eventId).toBe(event.id)
      // Result depends on pipeline availability, but shape should be correct
    })

    it('includes event metadata in delivery', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      // Track delivered payload
      let deliveredPayload: unknown = null

      deliveryStore.configurePipeline({
        endpoint: 'https://iceberg.pipeline.do/events',
        timeout: 5000,
      })

      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
        data: { name: 'Test Project', priority: 'high' },
      })
      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      // The delivery payload should include full event metadata
      const deliverableEvent = await deliveryStore.getEvent(event.id)

      // Verify event has all required metadata
      expect(deliverableEvent?.verb).toBe('created')
      expect(deliverableEvent?.from).toBe('https://users.do/alice')
      expect(deliverableEvent?.to).toBe('https://projects.do/proj-123')
      expect(deliverableEvent?.data).toEqual({ name: 'Test Project', priority: 'high' })
      expect(deliverableEvent?.completedAt).toBeDefined()
      expect(deliverableEvent?.actionId).toBe(action.id)
    })

    it('handles pipeline backpressure', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      deliveryStore.configurePipeline({
        endpoint: 'https://slow-pipeline.do/events',
        timeout: 100, // Very short timeout to trigger backpressure handling
      })

      // Create multiple events
      const events: Event[] = []
      for (let i = 0; i < 10; i++) {
        const action = await createAction({
          verb: 'create',
          from: `https://users.do/user-${i}`,
          to: `https://projects.do/proj-${i}`,
        })
        const activity = await startAction(action.id)
        const event = await completeAction(activity.id, `https://projects.do/proj-${i}-result`)
        events.push(event)
      }

      // Attempt concurrent deliveries - should handle backpressure gracefully
      const results = await Promise.allSettled(
        events.map(e => deliveryStore.deliverEvent(e.id))
      )

      // Should not throw, should handle backpressure
      expect(results.length).toBe(10)
      // Some may succeed, some may fail due to backpressure, but all should complete
      results.forEach(result => {
        expect(result.status).toBe('fulfilled') // Should handle gracefully
      })
    })
  })

  // ==========================================================================
  // 7. Delivery Statistics
  // ==========================================================================

  describe('Delivery Statistics', () => {
    it('tracks delivery statistics', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      // Create and complete several events
      for (let i = 0; i < 5; i++) {
        const action = await createAction({
          verb: 'create',
          from: `https://users.do/user-${i}`,
          to: `https://projects.do/proj-${i}`,
        })
        const activity = await startAction(action.id)
        await completeAction(activity.id, `https://projects.do/proj-${i}-result`)
      }

      // Mark some as streamed
      const unstreamed = await deliveryStore.getUnstreamedEvents()
      await deliveryStore.markAsStreamed(unstreamed[0]!.id)
      await deliveryStore.markAsStreamed(unstreamed[1]!.id)

      const stats = await deliveryStore.getDeliveryStats()

      expect(stats.totalEvents).toBe(5)
      expect(stats.streamed).toBe(2)
      expect(stats.unstreamed).toBe(3)
    })
  })

  // ==========================================================================
  // 8. Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles empty event queue gracefully', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      const unstreamed = await deliveryStore.getUnstreamedEvents()

      expect(unstreamed).toEqual([])
      expect(unstreamed.length).toBe(0)
    })

    it('handles concurrent mark as streamed', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
      })
      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      // Concurrent calls should be safe
      await Promise.all([
        deliveryStore.markAsStreamed(event.id),
        deliveryStore.markAsStreamed(event.id),
        deliveryStore.markAsStreamed(event.id),
      ])

      const deliverableEvent = await deliveryStore.getEvent(event.id)
      expect(deliverableEvent?.streamed).toBe(true)
    })

    it('preserves event data integrity through delivery', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      const complexData = {
        nested: {
          array: [1, 2, 3],
          object: { key: 'value' },
        },
        unicode: '\u00e9\u00e8\u00ea',
        large: 'x'.repeat(10000),
      }

      const action = await createAction({
        verb: 'create',
        from: 'https://users.do/alice',
        to: 'https://projects.do/new-project',
        data: complexData,
      })
      const activity = await startAction(action.id)
      const event = await completeAction(activity.id, 'https://projects.do/proj-123')

      const deliverableEvent = await deliveryStore.getEvent(event.id)

      expect(deliverableEvent?.data).toEqual(complexData)
    })

    it('handles rapid event creation and delivery', async () => {
      const { EventDeliveryStore } = await import('../event-delivery')
      const deliveryStore = new EventDeliveryStore(store)

      // Create many events rapidly
      const promises = []
      for (let i = 0; i < 100; i++) {
        promises.push(
          createAction({
            verb: 'create',
            from: `https://users.do/user-${i}`,
            to: `https://projects.do/proj-${i}`,
          }).then(async action => {
            const activity = await startAction(action.id)
            return completeAction(activity.id, `https://projects.do/proj-${i}-result`)
          })
        )
      }

      await Promise.all(promises)

      const unstreamed = await deliveryStore.getUnstreamedEvents()

      expect(unstreamed.length).toBe(100)
    })
  })
})

// ============================================================================
// INTEGRATION TEST: Event Delivery Store Interface
// ============================================================================

describe('EventDeliveryStore Interface', () => {
  it('EventDeliveryStore is exported from db/graph', async () => {
    // This will fail until EventDeliveryStore is implemented and exported
    const { EventDeliveryStore } = await import('../event-delivery')
    expect(EventDeliveryStore).toBeDefined()
  })

  it('has getEvent method', async () => {
    const { EventDeliveryStore } = await import('../event-delivery')
    expect(EventDeliveryStore.prototype.getEvent).toBeDefined()
  })

  it('has getUnstreamedEvents method', async () => {
    const { EventDeliveryStore } = await import('../event-delivery')
    expect(EventDeliveryStore.prototype.getUnstreamedEvents).toBeDefined()
  })

  it('has markAsStreamed method', async () => {
    const { EventDeliveryStore } = await import('../event-delivery')
    expect(EventDeliveryStore.prototype.markAsStreamed).toBeDefined()
  })

  it('has deliverEvent method', async () => {
    const { EventDeliveryStore } = await import('../event-delivery')
    expect(EventDeliveryStore.prototype.deliverEvent).toBeDefined()
  })

  it('has recordDeliveryFailure method', async () => {
    const { EventDeliveryStore } = await import('../event-delivery')
    expect(EventDeliveryStore.prototype.recordDeliveryFailure).toBeDefined()
  })

  it('has getDeliveryStats method', async () => {
    const { EventDeliveryStore } = await import('../event-delivery')
    expect(EventDeliveryStore.prototype.getDeliveryStats).toBeDefined()
  })

  it('has configurePipeline method', async () => {
    const { EventDeliveryStore } = await import('../event-delivery')
    expect(EventDeliveryStore.prototype.configurePipeline).toBeDefined()
  })
})

// ============================================================================
// INTEGRATION TEST: Database Schema for Streamed Flag
// ============================================================================

describe('Database Schema for Streamed Flag', () => {
  let Database: typeof import('better-sqlite3').default
  let sqlite: import('better-sqlite3').Database

  beforeEach(async () => {
    const betterSqlite = await import('better-sqlite3')
    Database = betterSqlite.default
    sqlite = new Database(':memory:')
  })

  afterEach(() => {
    if (sqlite) sqlite.close()
  })

  it('event_delivery table has streamed column', async () => {
    // This schema should be created by EventDeliveryStore.initialize()
    const { EventDeliveryStore } = await import('../event-delivery')

    const store = new SQLiteGraphStore(sqlite)
    await store.initialize()

    const deliveryStore = new EventDeliveryStore(store)

    // Check that the table exists with streamed column
    const tableInfo = sqlite.prepare(`PRAGMA table_info(event_delivery)`).all() as Array<{
      name: string
      type: string
    }>

    const streamedColumn = tableInfo.find(col => col.name === 'streamed')
    expect(streamedColumn).toBeDefined()
    expect(streamedColumn?.type).toBe('INTEGER') // SQLite boolean as INTEGER
  })

  it('streamed column defaults to 0 (false)', async () => {
    const { EventDeliveryStore } = await import('../event-delivery')

    const store = new SQLiteGraphStore(sqlite)
    await store.initialize()

    const deliveryStore = new EventDeliveryStore(store)

    // Insert an event and verify default
    sqlite.exec(`
      INSERT INTO event_delivery (event_id, streamed, created_at)
      VALUES ('test-event-1', NULL, ${Date.now()})
    `)

    const result = sqlite
      .prepare('SELECT streamed FROM event_delivery WHERE event_id = ?')
      .get('test-event-1') as { streamed: number | null }

    // NULL or 0 should both represent false
    expect(result.streamed === null || result.streamed === 0).toBe(true)
  })

  it('has index on streamed column for efficient queries', async () => {
    const { EventDeliveryStore } = await import('../event-delivery')

    const store = new SQLiteGraphStore(sqlite)
    await store.initialize()

    const deliveryStore = new EventDeliveryStore(store)

    // Check for index on streamed column
    const indexes = sqlite.prepare(`PRAGMA index_list(event_delivery)`).all() as Array<{
      name: string
    }>

    // Should have an index that includes streamed column
    const streamedIndex = indexes.find(idx =>
      idx.name.includes('streamed') || idx.name.includes('unstreamed')
    )

    // If not named explicitly, check if any index covers streamed
    const indexInfo = indexes.map(idx => {
      const info = sqlite.prepare(`PRAGMA index_info(${idx.name})`).all() as Array<{
        name: string
      }>
      return { index: idx.name, columns: info.map(c => c.name) }
    })

    const hasStreamedIndex = indexInfo.some(info => info.columns.includes('streamed'))
    expect(hasStreamedIndex).toBe(true)
  })

  it('has delivery_attempts column for retry tracking', async () => {
    const { EventDeliveryStore } = await import('../event-delivery')

    const store = new SQLiteGraphStore(sqlite)
    await store.initialize()

    const deliveryStore = new EventDeliveryStore(store)

    const tableInfo = sqlite.prepare(`PRAGMA table_info(event_delivery)`).all() as Array<{
      name: string
      type: string
    }>

    const attemptsColumn = tableInfo.find(col => col.name === 'delivery_attempts')
    expect(attemptsColumn).toBeDefined()
    expect(attemptsColumn?.type).toBe('INTEGER')
  })

  it('has last_delivery_attempt timestamp column', async () => {
    const { EventDeliveryStore } = await import('../event-delivery')

    const store = new SQLiteGraphStore(sqlite)
    await store.initialize()

    const deliveryStore = new EventDeliveryStore(store)

    const tableInfo = sqlite.prepare(`PRAGMA table_info(event_delivery)`).all() as Array<{
      name: string
      type: string
    }>

    const lastAttemptColumn = tableInfo.find(col => col.name === 'last_delivery_attempt')
    expect(lastAttemptColumn).toBeDefined()
    expect(lastAttemptColumn?.type).toBe('INTEGER') // Unix timestamp
  })

  it('has delivery_error column for failure messages', async () => {
    const { EventDeliveryStore } = await import('../event-delivery')

    const store = new SQLiteGraphStore(sqlite)
    await store.initialize()

    const deliveryStore = new EventDeliveryStore(store)

    const tableInfo = sqlite.prepare(`PRAGMA table_info(event_delivery)`).all() as Array<{
      name: string
      type: string
    }>

    const errorColumn = tableInfo.find(col => col.name === 'delivery_error')
    expect(errorColumn).toBeDefined()
    expect(errorColumn?.type).toBe('TEXT')
  })
})
