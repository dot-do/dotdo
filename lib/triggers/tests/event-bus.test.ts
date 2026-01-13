/**
 * Event Bus Tests - Pub/Sub, Filtering
 *
 * RED TDD Phase: These tests define the event bus contract for DO-native pub/sub.
 * All tests WILL FAIL initially until lib/triggers/event-bus.ts is implemented.
 *
 * Test coverage:
 * 1. Publish event to topic
 * 2. Subscribe to topic with handler
 * 3. Filter events by type/pattern
 * 4. Wildcard subscriptions
 * 5. At-least-once delivery guarantee
 * 6. Dead letter queue for failed handlers
 * 7. Event replay from offset
 * 8. Cross-DO event routing
 *
 * The EventBus is part of the TriggerEngine primitive that powers
 * all workflow automation compat layers.
 *
 * @see dotdo-i9ylo - [RED] Event bus tests - pub/sub, filtering
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// EXPECTED TYPES (Design Contract)
// ============================================================================

/**
 * Event published to the event bus
 */
interface BusEvent<TData = unknown> {
  /** Unique event ID (UUID) */
  id: string
  /** Event topic/type (e.g., 'Customer.created', 'Order.placed') */
  topic: string
  /** Event payload data */
  data: TData
  /** Source namespace/DO that emitted the event */
  source: string
  /** ISO timestamp when event was published */
  timestamp: string
  /** Optional correlation ID for tracing */
  correlationId?: string
  /** Optional causation ID (ID of event that caused this one) */
  causationId?: string
  /** Event schema version for evolution */
  version?: number
  /** Optional metadata for filtering */
  metadata?: Record<string, unknown>
}

/**
 * Subscription handler function type
 */
type EventHandler<TData = unknown> = (event: BusEvent<TData>) => Promise<void> | void

/**
 * Filter predicate for conditional event handling
 */
type EventFilter<TData = unknown> = (event: BusEvent<TData>) => boolean | Promise<boolean>

/**
 * Dead letter queue entry
 */
interface DLQEntry<TData = unknown> {
  /** Unique DLQ entry ID */
  id: string
  /** Original event that failed */
  event: BusEvent<TData>
  /** Subscription ID that failed to process */
  subscriptionId: string
  /** Error message from last attempt */
  lastError: string
  /** Number of retry attempts made */
  attempts: number
  /** Timestamp of first failure */
  firstFailedAt: string
  /** Timestamp of last failure */
  lastFailedAt: string
  /** Optional: can be retried manually */
  canRetry: boolean
}

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock storage for event persistence
 */
function createMockStorage() {
  const events: BusEvent[] = []
  const dlq: DLQEntry[] = []

  return {
    appendEvent: vi.fn(async (event: BusEvent) => {
      events.push(event)
      return { offset: String(events.length - 1) }
    }),
    getEvents: vi.fn(async (fromOffset: number, limit: number) => {
      return events.slice(fromOffset, fromOffset + limit)
    }),
    getEventCount: vi.fn(async () => events.length),
    addToDLQ: vi.fn(async (entry: DLQEntry) => {
      dlq.push(entry)
      return entry.id
    }),
    getDLQEntries: vi.fn(async () => dlq),
    removeDLQEntry: vi.fn(async (id: string) => {
      const idx = dlq.findIndex(e => e.id === id)
      if (idx > -1) dlq.splice(idx, 1)
      return idx > -1
    }),
    _events: events,
    _dlq: dlq,
  }
}

/**
 * Mock RPC client for cross-DO communication
 */
function createMockRpcClient() {
  return {
    invoke: vi.fn(async (_ns: string, _method: string, _args: unknown) => {
      return { success: true }
    }),
  }
}

// ============================================================================
// TESTS: Module Exports
// ============================================================================

describe('EventBus Module', () => {
  describe('Module Exports', () => {
    it('should export EventBus class', async () => {
      const module = await import('../event-bus')
      expect(module.EventBus).toBeDefined()
      expect(typeof module.EventBus).toBe('function')
    })

    it('should export createEventBus factory', async () => {
      const module = await import('../event-bus')
      expect(module.createEventBus).toBeDefined()
      expect(typeof module.createEventBus).toBe('function')
    })

    it('should export type interfaces', async () => {
      const module = await import('../event-bus')
      expect(module).toBeDefined()
    })
  })
})

// ============================================================================
// TESTS: 1. Publish Event to Topic
// ============================================================================

describe('EventBus - Publish Event to Topic', () => {
  let mockStorage: ReturnType<typeof createMockStorage>

  beforeEach(() => {
    mockStorage = createMockStorage()
  })

  it('should publish event to a topic', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const result = await bus.publish('Customer.created', {
      customerId: 'cust-123',
      email: 'test@example.com',
    })

    expect(result.eventId).toBeDefined()
    expect(result.topic).toBe('Customer.created')
    expect(result.offset).toBeDefined()
    expect(result.timestamp).toBeDefined()
  })

  it('should generate unique event ID for each publish', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const result1 = await bus.publish('Order.placed', { orderId: '1' })
    const result2 = await bus.publish('Order.placed', { orderId: '2' })

    expect(result1.eventId).toBeDefined()
    expect(result2.eventId).toBeDefined()
    expect(result1.eventId).not.toBe(result2.eventId)
  })

  it('should include source namespace in event', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({
      storage: mockStorage,
      namespace: 'tenant-123',
    })

    await bus.publish('Invoice.sent', { invoiceId: 'inv-1' })

    expect(mockStorage.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'tenant-123',
      })
    )
  })

  it('should support correlation ID in publish options', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    await bus.publish(
      'Payment.received',
      { amount: 100 },
      { correlationId: 'req-abc-123' }
    )

    expect(mockStorage.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'req-abc-123',
      })
    )
  })

  it('should support causation ID for event chaining', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    await bus.publish(
      'Notification.sent',
      { message: 'Hello' },
      { causationId: 'evt-parent-1' }
    )

    expect(mockStorage.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        causationId: 'evt-parent-1',
      })
    )
  })

  it('should support delayed publishing', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const result = await bus.publish(
      'Reminder.scheduled',
      { message: 'Don\'t forget!' },
      { delayMs: 60000 }
    )

    expect(result.eventId).toBeDefined()
    // Verify delayed scheduling mechanism is called
  })

  it('should support metadata for filtering', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    await bus.publish(
      'User.action',
      { action: 'login' },
      {
        metadata: {
          environment: 'production',
          region: 'us-west-2',
          version: '2.0',
        },
      }
    )

    expect(mockStorage.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          environment: 'production',
          region: 'us-west-2',
        }),
      })
    )
  })

  it('should support event version for schema evolution', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    await bus.publish(
      'Schema.updated',
      { field: 'new_field' },
      { version: 2 }
    )

    expect(mockStorage.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
      })
    )
  })
})

// ============================================================================
// TESTS: 2. Subscribe to Topic with Handler
// ============================================================================

describe('EventBus - Subscribe to Topic with Handler', () => {
  let mockStorage: ReturnType<typeof createMockStorage>

  beforeEach(() => {
    mockStorage = createMockStorage()
  })

  it('should subscribe to a topic with handler', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    const subscription = await bus.subscribe('Customer.created', handler)

    expect(subscription).toBeDefined()
    expect(subscription.id).toBeDefined()
    expect(subscription.topic).toBe('Customer.created')
    expect(subscription.isActive()).toBe(true)
  })

  it('should invoke handler when event is published', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    await bus.subscribe('Order.placed', handler)

    await bus.publish('Order.placed', { orderId: 'ord-123' })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'Order.placed',
        data: { orderId: 'ord-123' },
      })
    )
  })

  it('should support multiple handlers for same topic', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler1 = vi.fn()
    const handler2 = vi.fn()
    const handler3 = vi.fn()

    await bus.subscribe('Invoice.paid', handler1)
    await bus.subscribe('Invoice.paid', handler2)
    await bus.subscribe('Invoice.paid', handler3)

    await bus.publish('Invoice.paid', { invoiceId: 'inv-1' })

    expect(handler1).toHaveBeenCalledTimes(1)
    expect(handler2).toHaveBeenCalledTimes(1)
    expect(handler3).toHaveBeenCalledTimes(1)
  })

  it('should not invoke handler for different topics', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const customerHandler = vi.fn()
    const orderHandler = vi.fn()

    await bus.subscribe('Customer.created', customerHandler)
    await bus.subscribe('Order.placed', orderHandler)

    await bus.publish('Order.placed', { orderId: 'ord-1' })

    expect(customerHandler).not.toHaveBeenCalled()
    expect(orderHandler).toHaveBeenCalledTimes(1)
  })

  it('should allow unsubscribing', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    const subscription = await bus.subscribe('Event.test', handler)

    await bus.publish('Event.test', { count: 1 })
    expect(handler).toHaveBeenCalledTimes(1)

    await subscription.unsubscribe()
    expect(subscription.isActive()).toBe(false)

    await bus.publish('Event.test', { count: 2 })
    expect(handler).toHaveBeenCalledTimes(1) // Still 1
  })

  it('should support pausing and resuming subscriptions', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    const subscription = await bus.subscribe('Pausable.event', handler)

    await bus.publish('Pausable.event', { seq: 1 })
    expect(handler).toHaveBeenCalledTimes(1)

    await subscription.pause()
    await bus.publish('Pausable.event', { seq: 2 })
    expect(handler).toHaveBeenCalledTimes(1) // Still 1

    await subscription.resume()
    await bus.publish('Pausable.event', { seq: 3 })
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('should support handler priority ordering', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const executionOrder: number[] = []

    const lowPriorityHandler = vi.fn(() => executionOrder.push(1))
    const highPriorityHandler = vi.fn(() => executionOrder.push(2))
    const defaultPriorityHandler = vi.fn(() => executionOrder.push(3))

    await bus.subscribe('Priority.test', lowPriorityHandler, { priority: -10 })
    await bus.subscribe('Priority.test', highPriorityHandler, { priority: 10 })
    await bus.subscribe('Priority.test', defaultPriorityHandler)

    await bus.publish('Priority.test', {})

    // High priority (10) runs first, then default (0), then low (-10)
    expect(executionOrder).toEqual([2, 3, 1])
  })

  it('should support named subscriptions for debugging', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    const subscription = await bus.subscribe(
      'Named.subscription',
      handler,
      { name: 'my-important-handler' }
    )

    expect(subscription.id).toBeDefined()
  })
})

// ============================================================================
// TESTS: 3. Filter Events by Type/Pattern
// ============================================================================

describe('EventBus - Filter Events by Type/Pattern', () => {
  let mockStorage: ReturnType<typeof createMockStorage>

  beforeEach(() => {
    mockStorage = createMockStorage()
  })

  it('should support filter predicate on subscription', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    const filter: EventFilter = (event) => {
      return (event.data as { amount?: number }).amount! > 100
    }

    await bus.subscribe('Payment.received', handler, { filter })

    await bus.publish('Payment.received', { amount: 50 })
    expect(handler).not.toHaveBeenCalled()

    await bus.publish('Payment.received', { amount: 150 })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should support async filter predicates', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    const asyncFilter: EventFilter = async (event) => {
      await new Promise(resolve => setTimeout(resolve, 1))
      return (event.data as { approved?: boolean }).approved === true
    }

    await bus.subscribe('Request.submitted', handler, { filter: asyncFilter })

    await bus.publish('Request.submitted', { approved: false })
    expect(handler).not.toHaveBeenCalled()

    await bus.publish('Request.submitted', { approved: true })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should support filtering by event metadata', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    const metadataFilter: EventFilter = (event) => {
      return event.metadata?.environment === 'production'
    }

    await bus.subscribe('Deployment.complete', handler, { filter: metadataFilter })

    await bus.publish(
      'Deployment.complete',
      { version: '1.0' },
      { metadata: { environment: 'staging' } }
    )
    expect(handler).not.toHaveBeenCalled()

    await bus.publish(
      'Deployment.complete',
      { version: '1.1' },
      { metadata: { environment: 'production' } }
    )
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should support filtering by source namespace', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus1 = createEventBus({ storage: mockStorage, namespace: 'service-a' })

    const handler = vi.fn()
    const sourceFilter: EventFilter = (event) => event.source === 'service-a'

    await bus1.subscribe('Shared.event', handler, { filter: sourceFilter })

    await bus1.publish('Shared.event', { from: 'a' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should support JSONPath-style filtering', async () => {
    const { createEventBus, jsonPathFilter } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    const filter = jsonPathFilter('$.data.user.role', 'admin')

    await bus.subscribe('Admin.action', handler, { filter })

    await bus.publish('Admin.action', { user: { role: 'user' } })
    expect(handler).not.toHaveBeenCalled()

    await bus.publish('Admin.action', { user: { role: 'admin' } })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should support compound filters with AND logic', async () => {
    const { createEventBus, andFilter } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    const filter = andFilter(
      (e) => (e.data as { amount: number }).amount > 100,
      (e) => (e.data as { currency: string }).currency === 'USD'
    )

    await bus.subscribe('Transaction.large', handler, { filter })

    await bus.publish('Transaction.large', { amount: 150, currency: 'EUR' })
    expect(handler).not.toHaveBeenCalled()

    await bus.publish('Transaction.large', { amount: 50, currency: 'USD' })
    expect(handler).not.toHaveBeenCalled()

    await bus.publish('Transaction.large', { amount: 150, currency: 'USD' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should support compound filters with OR logic', async () => {
    const { createEventBus, orFilter } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    const filter = orFilter(
      (e) => (e.data as { priority: string }).priority === 'high',
      (e) => (e.data as { urgent: boolean }).urgent === true
    )

    await bus.subscribe('Alert.triggered', handler, { filter })

    await bus.publish('Alert.triggered', { priority: 'low', urgent: false })
    expect(handler).not.toHaveBeenCalled()

    await bus.publish('Alert.triggered', { priority: 'high', urgent: false })
    expect(handler).toHaveBeenCalledTimes(1)

    await bus.publish('Alert.triggered', { priority: 'low', urgent: true })
    expect(handler).toHaveBeenCalledTimes(2)
  })
})

// ============================================================================
// TESTS: 4. Wildcard Subscriptions
// ============================================================================

describe('EventBus - Wildcard Subscriptions', () => {
  let mockStorage: ReturnType<typeof createMockStorage>

  beforeEach(() => {
    mockStorage = createMockStorage()
  })

  it('should support * wildcard for single segment', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    await bus.subscribe('*.created', handler)

    await bus.publish('Customer.created', { id: 'c1' })
    await bus.publish('Order.created', { id: 'o1' })
    await bus.publish('Invoice.created', { id: 'i1' })

    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('should support * wildcard for verb', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    await bus.subscribe('Customer.*', handler)

    await bus.publish('Customer.created', { id: 'c1' })
    await bus.publish('Customer.updated', { id: 'c1' })
    await bus.publish('Customer.deleted', { id: 'c1' })
    await bus.publish('Order.created', { id: 'o1' }) // Should NOT trigger

    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('should support ** wildcard for all events', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    await bus.subscribe('**', handler)

    await bus.publish('Customer.created', {})
    await bus.publish('Order.placed', {})
    await bus.publish('Invoice.sent', {})
    await bus.publish('Payment.received', {})

    expect(handler).toHaveBeenCalledTimes(4)
  })

  it('should support multi-level wildcards', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    await bus.subscribe('billing.**', handler)

    await bus.publish('billing.invoice.created', {})
    await bus.publish('billing.payment.received', {})
    await bus.publish('billing.subscription.renewed', {})
    await bus.publish('user.profile.updated', {}) // Should NOT trigger

    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('should match both specific and wildcard handlers', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const wildcardHandler = vi.fn()
    const specificHandler = vi.fn()

    await bus.subscribe('*.created', wildcardHandler)
    await bus.subscribe('Customer.created', specificHandler)

    await bus.publish('Customer.created', { id: 'c1' })

    expect(wildcardHandler).toHaveBeenCalledTimes(1)
    expect(specificHandler).toHaveBeenCalledTimes(1)
  })

  it('should support pattern exclusions via filter', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    await bus.subscribe('Customer.*', handler, {
      filter: (e) => !e.topic.endsWith('.deleted'),
    })

    await bus.publish('Customer.created', {})
    await bus.publish('Customer.updated', {})
    await bus.publish('Customer.deleted', {}) // Should NOT trigger

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('should support topic prefix matching', async () => {
    const { createEventBus, topicStartsWith } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    await bus.subscribe('**', handler, {
      filter: topicStartsWith('audit.'),
    })

    await bus.publish('audit.login', {})
    await bus.publish('audit.logout', {})
    await bus.publish('audit.action.performed', {})
    await bus.publish('user.created', {}) // Should NOT trigger

    expect(handler).toHaveBeenCalledTimes(3)
  })
})

// ============================================================================
// TESTS: 5. At-Least-Once Delivery Guarantee
// ============================================================================

describe('EventBus - At-Least-Once Delivery Guarantee', () => {
  let mockStorage: ReturnType<typeof createMockStorage>

  beforeEach(() => {
    mockStorage = createMockStorage()
  })

  it('should persist event before acknowledging publish', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    await bus.publish('Durable.event', { data: 'test' })

    expect(mockStorage.appendEvent).toHaveBeenCalledTimes(1)
  })

  it('should retry delivery on handler failure', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({
      storage: mockStorage,
      retryPolicy: { maxAttempts: 3, initialDelayMs: 10 },
    })

    let attempts = 0
    const flakyHandler = vi.fn(() => {
      attempts++
      if (attempts < 3) {
        throw new Error('Temporary failure')
      }
    })

    await bus.subscribe('Flaky.event', flakyHandler, { maxRetries: 3 })
    await bus.publish('Flaky.event', {})

    // Wait for retries
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(flakyHandler).toHaveBeenCalledTimes(3)
  })

  it('should track delivery acknowledgments', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    await bus.subscribe('Tracked.event', handler)

    const result = await bus.publish('Tracked.event', {})

    const status = await bus.getDeliveryStatus(result.eventId)

    expect(status).toBeDefined()
    expect(status.delivered).toBe(true)
    expect(status.subscribers).toHaveLength(1)
  })

  it('should maintain ordering within a partition', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const receivedOrder: number[] = []
    const handler = vi.fn((event: BusEvent<{ seq: number }>) => {
      receivedOrder.push(event.data.seq)
    })

    await bus.subscribe('Ordered.event', handler)

    await bus.publish('Ordered.event', { seq: 1 }, { partitionKey: 'user-123' })
    await bus.publish('Ordered.event', { seq: 2 }, { partitionKey: 'user-123' })
    await bus.publish('Ordered.event', { seq: 3 }, { partitionKey: 'user-123' })

    expect(receivedOrder).toEqual([1, 2, 3])
  })

  it('should not lose events on process restart', async () => {
    const { createEventBus } = await import('../event-bus')

    const bus1 = createEventBus({ storage: mockStorage })
    await bus1.publish('Persistent.event', { data: 'important' })

    const handler = vi.fn()
    const bus2 = createEventBus({ storage: mockStorage })
    await bus2.subscribe('Persistent.event', handler, { startFrom: 'earliest' })

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should support idempotent handlers via deduplication', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({
      storage: mockStorage,
      deduplicationWindowMs: 60000,
    })

    const handler = vi.fn()
    await bus.subscribe('Idempotent.event', handler)

    const eventId = 'evt-unique-123'
    await bus.publishWithId(eventId, 'Idempotent.event', { data: 'test' })
    await bus.publishWithId(eventId, 'Idempotent.event', { data: 'test' })

    expect(handler).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// TESTS: 6. Dead Letter Queue for Failed Handlers
// ============================================================================

describe('EventBus - Dead Letter Queue for Failed Handlers', () => {
  let mockStorage: ReturnType<typeof createMockStorage>

  beforeEach(() => {
    mockStorage = createMockStorage()
  })

  it('should move permanently failed events to DLQ', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const failingHandler = vi.fn(() => {
      throw new Error('Permanent failure')
    })

    await bus.subscribe('Failing.event', failingHandler, { maxRetries: 2 })
    await bus.publish('Failing.event', { data: 'will-fail' })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(mockStorage.addToDLQ).toHaveBeenCalledTimes(1)
    expect(mockStorage.addToDLQ).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          topic: 'Failing.event',
        }),
        attempts: 3,
      })
    )
  })

  it('should capture error details in DLQ entry', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const errorMessage = 'Database connection failed'
    const failingHandler = vi.fn(() => {
      throw new Error(errorMessage)
    })

    await bus.subscribe('Error.event', failingHandler, { maxRetries: 1 })
    await bus.publish('Error.event', {})

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(mockStorage.addToDLQ).toHaveBeenCalledWith(
      expect.objectContaining({
        lastError: errorMessage,
      })
    )
  })

  it('should expose DLQ for inspection', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    mockStorage._dlq.push({
      id: 'dlq-1',
      event: { id: 'e1', topic: 'Test.failed', data: {}, source: 'test', timestamp: new Date().toISOString() },
      subscriptionId: 'sub-1',
      lastError: 'Error 1',
      attempts: 3,
      firstFailedAt: new Date().toISOString(),
      lastFailedAt: new Date().toISOString(),
      canRetry: true,
    })

    const dlqEntries = await bus.getDLQ()

    expect(dlqEntries).toHaveLength(1)
    expect(dlqEntries[0].id).toBe('dlq-1')
    expect(dlqEntries[0].event.topic).toBe('Test.failed')
  })

  it('should support manual retry from DLQ', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    let shouldFail = true
    const handler = vi.fn(() => {
      if (shouldFail) throw new Error('Failing')
    })

    await bus.subscribe('Retryable.event', handler, { maxRetries: 1 })
    await bus.publish('Retryable.event', { data: 'test' })

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(mockStorage._dlq).toHaveLength(1)
    const dlqEntry = mockStorage._dlq[0]

    shouldFail = false
    await bus.retryDLQEntry(dlqEntry.id)

    expect(handler).toHaveBeenCalledTimes(3) // 2 failures + 1 retry success
    expect(mockStorage.removeDLQEntry).toHaveBeenCalledWith(dlqEntry.id)
  })

  it('should support purging DLQ entries', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    mockStorage._dlq.push(
      { id: 'dlq-1', canRetry: true } as DLQEntry,
      { id: 'dlq-2', canRetry: true } as DLQEntry,
      { id: 'dlq-3', canRetry: true } as DLQEntry
    )

    await bus.purgeDLQEntry('dlq-2')
    expect(mockStorage.removeDLQEntry).toHaveBeenCalledWith('dlq-2')

    await bus.purgeDLQ()
    expect(mockStorage._dlq).toHaveLength(0)
  })

  it('should emit DLQ events for monitoring', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const dlqHandler = vi.fn()
    await bus.subscribe('system.dlq.added', dlqHandler)

    const failingHandler = vi.fn(() => {
      throw new Error('Test failure')
    })

    await bus.subscribe('Monitored.event', failingHandler, { maxRetries: 0 })
    await bus.publish('Monitored.event', {})

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(dlqHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'system.dlq.added',
      })
    )
  })

  it('should support DLQ entry TTL/expiration', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({
      storage: mockStorage,
      dlqTtlMs: 86400000, // 24 hours
    })

    expect(bus.getDLQConfig).toBeDefined()
    const config = bus.getDLQConfig()
    expect(config.ttlMs).toBe(86400000)
  })
})

// ============================================================================
// TESTS: 7. Event Replay from Offset
// ============================================================================

describe('EventBus - Event Replay from Offset', () => {
  let mockStorage: ReturnType<typeof createMockStorage>

  beforeEach(() => {
    mockStorage = createMockStorage()
    // Pre-populate events
    mockStorage._events.push(
      { id: 'e1', topic: 'Test.event', data: { seq: 1 }, source: 'test', timestamp: new Date().toISOString() },
      { id: 'e2', topic: 'Test.event', data: { seq: 2 }, source: 'test', timestamp: new Date().toISOString() },
      { id: 'e3', topic: 'Other.event', data: { seq: 3 }, source: 'test', timestamp: new Date().toISOString() },
      { id: 'e4', topic: 'Test.event', data: { seq: 4 }, source: 'test', timestamp: new Date().toISOString() },
      { id: 'e5', topic: 'Test.event', data: { seq: 5 }, source: 'test', timestamp: new Date().toISOString() }
    )
  })

  it('should replay events from a specific offset', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const receivedEvents: BusEvent[] = []
    const handler = (event: BusEvent) => {
      receivedEvents.push(event)
    }

    await bus.replay({
      fromOffset: '2',
      handler,
    })

    expect(receivedEvents).toHaveLength(3)
    expect((receivedEvents[0].data as { seq: number }).seq).toBe(3)
  })

  it('should replay events within offset range', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const receivedEvents: BusEvent[] = []
    const handler = (event: BusEvent) => {
      receivedEvents.push(event)
    }

    await bus.replay({
      fromOffset: '1',
      toOffset: '4',
      handler,
    })

    expect(receivedEvents).toHaveLength(3)
    expect((receivedEvents[0].data as { seq: number }).seq).toBe(2)
    expect((receivedEvents[2].data as { seq: number }).seq).toBe(4)
  })

  it('should replay events filtered by topic', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const receivedEvents: BusEvent[] = []
    const handler = (event: BusEvent) => {
      receivedEvents.push(event)
    }

    await bus.replay({
      fromOffset: '0',
      topic: 'Test.event',
      handler,
    })

    expect(receivedEvents).toHaveLength(4)
    expect(receivedEvents.every(e => e.topic === 'Test.event')).toBe(true)
  })

  it('should replay events with custom filter', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const receivedEvents: BusEvent[] = []
    const handler = (event: BusEvent) => {
      receivedEvents.push(event)
    }

    await bus.replay({
      fromOffset: '0',
      filter: (e) => (e.data as { seq: number }).seq > 2,
      handler,
    })

    expect(receivedEvents).toHaveLength(3)
    expect(receivedEvents.every(e => (e.data as { seq: number }).seq > 2)).toBe(true)
  })

  it('should respect limit in replay', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const receivedEvents: BusEvent[] = []
    const handler = (event: BusEvent) => {
      receivedEvents.push(event)
    }

    await bus.replay({
      fromOffset: '0',
      limit: 2,
      handler,
    })

    expect(receivedEvents).toHaveLength(2)
  })

  it('should support subscription from earliest offset', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const receivedEvents: BusEvent[] = []
    const handler = (event: BusEvent) => {
      receivedEvents.push(event)
    }

    await bus.subscribe('Test.event', handler, { startFrom: 'earliest' })

    expect(receivedEvents).toHaveLength(4)
  })

  it('should support subscription from latest offset', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const receivedEvents: BusEvent[] = []
    const handler = (event: BusEvent) => {
      receivedEvents.push(event)
    }

    await bus.subscribe('Test.event', handler, { startFrom: 'latest' })

    expect(receivedEvents).toHaveLength(0)

    await bus.publish('Test.event', { seq: 6 })
    expect(receivedEvents).toHaveLength(1)
  })

  it('should track consumer offsets per group', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()

    await bus.subscribe('Test.event', handler, {
      group: 'consumer-group-1',
      startFrom: 'earliest',
    })

    const offset = await bus.getGroupOffset('consumer-group-1', 'Test.event')
    expect(offset).toBeDefined()
    expect(parseInt(offset)).toBeGreaterThanOrEqual(0)
  })

  it('should support seeking to specific offset', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const receivedEvents: BusEvent[] = []
    const handler = (event: BusEvent) => {
      receivedEvents.push(event)
    }

    const subscription = await bus.subscribe('Test.event', handler, {
      startFrom: 'latest',
    })

    await bus.seek(subscription.id, '1')

    expect(receivedEvents.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// TESTS: 8. Cross-DO Event Routing
// ============================================================================

describe('EventBus - Cross-DO Event Routing', () => {
  let mockStorage: ReturnType<typeof createMockStorage>
  let mockRpcClient: ReturnType<typeof createMockRpcClient>

  beforeEach(() => {
    mockStorage = createMockStorage()
    mockRpcClient = createMockRpcClient()
  })

  it('should route events to other DO namespaces', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({
      storage: mockStorage,
      rpcClient: mockRpcClient,
    })

    await bus.addRoute({
      sourcePattern: 'Order.placed',
      targetNs: 'inventory-service',
      targetMethod: 'handleOrder',
    })

    await bus.publish('Order.placed', { orderId: 'ord-123', items: ['item-1'] })

    expect(mockRpcClient.invoke).toHaveBeenCalledWith(
      'inventory-service',
      'handleOrder',
      expect.objectContaining({
        topic: 'Order.placed',
        data: { orderId: 'ord-123', items: ['item-1'] },
      })
    )
  })

  it('should support wildcard routing', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({
      storage: mockStorage,
      rpcClient: mockRpcClient,
    })

    await bus.addRoute({
      sourcePattern: 'Payment.*',
      targetNs: 'payment-service',
    })

    await bus.publish('Payment.received', { amount: 100 })
    await bus.publish('Payment.refunded', { amount: 50 })

    expect(mockRpcClient.invoke).toHaveBeenCalledTimes(2)
    expect(mockRpcClient.invoke).toHaveBeenCalledWith(
      'payment-service',
      expect.any(String),
      expect.objectContaining({ topic: 'Payment.received' })
    )
    expect(mockRpcClient.invoke).toHaveBeenCalledWith(
      'payment-service',
      expect.any(String),
      expect.objectContaining({ topic: 'Payment.refunded' })
    )
  })

  it('should transform events before routing', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({
      storage: mockStorage,
      rpcClient: mockRpcClient,
    })

    await bus.addRoute({
      sourcePattern: 'User.created',
      targetNs: 'notification-service',
      transform: (event) => ({
        ...event,
        topic: 'Welcome.email.trigger',
        data: { email: (event.data as { email: string }).email },
      }),
    })

    await bus.publish('User.created', { userId: 'u1', email: 'test@example.com', name: 'Test' })

    expect(mockRpcClient.invoke).toHaveBeenCalledWith(
      'notification-service',
      expect.any(String),
      expect.objectContaining({
        topic: 'Welcome.email.trigger',
        data: { email: 'test@example.com' },
      })
    )
  })

  it('should filter events before routing', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({
      storage: mockStorage,
      rpcClient: mockRpcClient,
    })

    await bus.addRoute({
      sourcePattern: 'Transaction.completed',
      targetNs: 'fraud-detection',
      filter: (event) => (event.data as { amount: number }).amount > 1000,
    })

    await bus.publish('Transaction.completed', { amount: 100 })
    expect(mockRpcClient.invoke).not.toHaveBeenCalled()

    await bus.publish('Transaction.completed', { amount: 5000 })
    expect(mockRpcClient.invoke).toHaveBeenCalledTimes(1)
  })

  it('should handle routing failures gracefully', async () => {
    const { createEventBus } = await import('../event-bus')

    mockRpcClient.invoke.mockRejectedValue(new Error('Target DO unavailable'))

    const bus = createEventBus({
      storage: mockStorage,
      rpcClient: mockRpcClient,
    })

    await bus.addRoute({
      sourcePattern: 'Event.routed',
      targetNs: 'unavailable-service',
    })

    await expect(
      bus.publish('Event.routed', {})
    ).resolves.toBeDefined()

    const routeFailures = await bus.getRouteFailures()
    expect(routeFailures).toHaveLength(1)
  })

  it('should support removing routes', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({
      storage: mockStorage,
      rpcClient: mockRpcClient,
    })

    const route = await bus.addRoute({
      sourcePattern: 'Removable.event',
      targetNs: 'target-service',
    })

    await bus.publish('Removable.event', {})
    expect(mockRpcClient.invoke).toHaveBeenCalledTimes(1)

    await bus.removeRoute(route.id)

    await bus.publish('Removable.event', {})
    expect(mockRpcClient.invoke).toHaveBeenCalledTimes(1) // Still 1
  })

  it('should list all configured routes', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({
      storage: mockStorage,
      rpcClient: mockRpcClient,
    })

    await bus.addRoute({ sourcePattern: 'Route.a', targetNs: 'service-a' })
    await bus.addRoute({ sourcePattern: 'Route.b', targetNs: 'service-b' })
    await bus.addRoute({ sourcePattern: 'Route.c', targetNs: 'service-c' })

    const routes = await bus.getRoutes()

    expect(routes).toHaveLength(3)
    expect(routes.map(r => r.targetNs)).toContain('service-a')
    expect(routes.map(r => r.targetNs)).toContain('service-b')
    expect(routes.map(r => r.targetNs)).toContain('service-c')
  })

  it('should support bidirectional routing', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({
      storage: mockStorage,
      rpcClient: mockRpcClient,
      namespace: 'service-a',
    })

    await bus.addRoute({
      sourcePattern: 'Local.event',
      targetNs: 'service-b',
    })

    await bus.acceptFrom({
      sourceNs: 'service-b',
      topicPattern: 'Remote.event',
    })

    await bus.publish('Local.event', {})
    expect(mockRpcClient.invoke).toHaveBeenCalledWith(
      'service-b',
      expect.any(String),
      expect.anything()
    )
  })
})

// ============================================================================
// TESTS: Statistics and Monitoring
// ============================================================================

describe('EventBus - Statistics and Monitoring', () => {
  let mockStorage: ReturnType<typeof createMockStorage>

  beforeEach(() => {
    mockStorage = createMockStorage()
  })

  it('should track event bus statistics', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const handler = vi.fn()
    await bus.subscribe('Stats.event', handler)

    await bus.publish('Stats.event', { count: 1 })
    await bus.publish('Stats.event', { count: 2 })
    await bus.publish('Other.event', { data: 'test' })

    const stats = await bus.getStats()

    expect(stats.totalPublished).toBe(3)
    expect(stats.totalDelivered).toBeGreaterThanOrEqual(2)
    expect(stats.activeSubscriptions).toBeGreaterThanOrEqual(1)
    expect(stats.topicCounts['Stats.event']).toBe(2)
    expect(stats.topicCounts['Other.event']).toBe(1)
  })

  it('should expose health check endpoint', async () => {
    const { createEventBus } = await import('../event-bus')
    const bus = createEventBus({ storage: mockStorage })

    const health = await bus.healthCheck()

    expect(health.healthy).toBe(true)
    expect(health.storage).toBe('connected')
    expect(health.lastEventAt).toBeDefined()
  })
})
