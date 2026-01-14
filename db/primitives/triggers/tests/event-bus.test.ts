/**
 * EventBus Tests - TDD RED Phase
 *
 * Comprehensive tests for the EventBus primitive - a DO-native pub/sub system
 * with guaranteed delivery, filtering, and dead letter queue support.
 *
 * This is RED phase TDD - tests should FAIL until the EventBus implementation
 * is complete in db/primitives/triggers/event-bus.ts.
 *
 * Key features tested:
 * - Publish/subscribe pattern
 * - Topic-based routing
 * - Pattern matching subscriptions (wildcards)
 * - Event filtering by attributes
 * - Guaranteed delivery with acknowledgment
 * - Dead letter queue for failed handlers
 * - Event ordering guarantees
 * - Subscription management (subscribe, unsubscribe, list)
 *
 * @see db/primitives/triggers/event-bus.ts (to be implemented)
 * @module db/primitives/triggers/tests/event-bus.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// These imports should FAIL until implemented
import {
  // Factory
  createEventBus,
  // Main class
  EventBus,
  // Types - Core
  type EventBusOptions,
  type Event,
  type EventEnvelope,
  type PublishOptions,
  type PublishResult,
  // Types - Subscription
  type Subscription,
  type SubscriptionOptions,
  type SubscriptionHandle,
  type EventHandler,
  type HandlerResult,
  // Types - Filtering
  type EventFilter,
  type FilterExpression,
  type AttributeFilter,
  // Types - Dead Letter Queue
  type DeadLetterQueueOptions,
  type DeadLetterEvent,
  type DLQHandler,
  // Types - Ordering
  type OrderingKey,
  type OrderingGuarantee,
  // Duration helpers
  seconds,
  minutes,
} from '../event-bus'

// ============================================================================
// Test Fixtures and Helpers
// ============================================================================

interface TestEvent {
  type: string
  payload: Record<string, unknown>
  metadata?: Record<string, unknown>
}

interface OrderEvent extends TestEvent {
  type: 'order.created' | 'order.updated' | 'order.shipped' | 'order.delivered'
  payload: {
    orderId: string
    customerId: string
    total: number
    items: Array<{ sku: string; quantity: number }>
  }
}

interface UserEvent extends TestEvent {
  type: 'user.signup' | 'user.login' | 'user.logout' | 'user.deleted'
  payload: {
    userId: string
    email: string
    timestamp: number
  }
}

/**
 * Create a test order event
 */
function createOrderEvent(
  type: OrderEvent['type'],
  overrides: Partial<OrderEvent['payload']> = {}
): OrderEvent {
  return {
    type,
    payload: {
      orderId: `order-${Date.now()}`,
      customerId: `customer-${Math.random().toString(36).slice(2)}`,
      total: 99.99,
      items: [{ sku: 'SKU-001', quantity: 1 }],
      ...overrides,
    },
  }
}

/**
 * Create a test user event
 */
function createUserEvent(
  type: UserEvent['type'],
  overrides: Partial<UserEvent['payload']> = {}
): UserEvent {
  return {
    type,
    payload: {
      userId: `user-${Date.now()}`,
      email: 'test@example.com',
      timestamp: Date.now(),
      ...overrides,
    },
  }
}

/**
 * Wait for a condition to be true with timeout
 */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5000
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`)
}

/**
 * Collect events from handler into array
 */
function createCollector<T>(): { handler: EventHandler<T>; events: EventEnvelope<T>[] } {
  const events: EventEnvelope<T>[] = []
  const handler: EventHandler<T> = async (envelope) => {
    events.push(envelope)
    return { success: true }
  }
  return { handler, events }
}

// ============================================================================
// Factory and Constructor Tests
// ============================================================================

describe('EventBus Factory', () => {
  describe('createEventBus()', () => {
    it('creates an EventBus instance', () => {
      const bus = createEventBus()

      expect(bus).toBeDefined()
      expect(bus).toBeInstanceOf(EventBus)
    })

    it('accepts optional configuration', () => {
      const bus = createEventBus({
        maxRetries: 5,
        retryDelayMs: 1000,
        enableDeadLetterQueue: true,
      })

      expect(bus).toBeDefined()
    })

    it('supports custom metrics collector', () => {
      const metricsCollector = {
        incrementCounter: vi.fn(),
        recordLatency: vi.fn(),
        recordGauge: vi.fn(),
      }

      const bus = createEventBus({
        metrics: metricsCollector,
      })

      expect(bus).toBeDefined()
    })
  })

  describe('EventBus constructor', () => {
    it('initializes with default options', () => {
      const bus = new EventBus()

      expect(bus.getSubscriptions()).toHaveLength(0)
    })

    it('initializes with provided options', () => {
      const options: EventBusOptions = {
        maxRetries: 3,
        retryDelayMs: 500,
        ackTimeoutMs: 30000,
        enableDeadLetterQueue: true,
        orderingGuarantee: 'per-topic',
      }

      const bus = new EventBus(options)

      expect(bus).toBeDefined()
    })
  })
})

// ============================================================================
// Basic Publish/Subscribe Tests
// ============================================================================

describe('Basic Publish/Subscribe', () => {
  let bus: EventBus<TestEvent>

  beforeEach(() => {
    bus = createEventBus<TestEvent>()
  })

  afterEach(async () => {
    await bus.close()
  })

  describe('publish()', () => {
    it('publishes an event to a topic', async () => {
      const event = createOrderEvent('order.created')

      const result = await bus.publish('orders', event)

      expect(result.success).toBe(true)
      expect(result.eventId).toBeDefined()
      expect(result.eventId.length).toBeGreaterThan(0)
    })

    it('returns timestamp in publish result', async () => {
      const event = createOrderEvent('order.created')

      const result = await bus.publish('orders', event)

      expect(result.timestamp).toBeDefined()
      expect(result.timestamp).toBeInstanceOf(Date)
    })

    it('supports publish options', async () => {
      const event = createOrderEvent('order.created')

      const result = await bus.publish('orders', event, {
        deduplicationId: 'order-123-created',
        orderingKey: 'order-123',
        attributes: {
          priority: 'high',
          region: 'us-east-1',
        },
      })

      expect(result.success).toBe(true)
    })

    it('deduplicates events with same deduplication ID', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      await bus.subscribe('orders', handler)

      const event = createOrderEvent('order.created')

      await bus.publish('orders', event, { deduplicationId: 'order-123' })
      await bus.publish('orders', event, { deduplicationId: 'order-123' })
      await bus.publish('orders', event, { deduplicationId: 'order-123' })

      // Wait for handlers to be called
      await new Promise((r) => setTimeout(r, 100))

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('treats events without deduplication ID as unique', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      await bus.subscribe('orders', handler)

      const event = createOrderEvent('order.created')

      await bus.publish('orders', event)
      await bus.publish('orders', event)
      await bus.publish('orders', event)

      await new Promise((r) => setTimeout(r, 100))

      expect(handler).toHaveBeenCalledTimes(3)
    })
  })

  describe('subscribe()', () => {
    it('subscribes to a topic and receives events', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler)

      const event = createOrderEvent('order.created')
      await bus.publish('orders', event)

      await waitFor(() => events.length === 1)

      expect(events[0].event).toEqual(event)
      expect(events[0].topic).toBe('orders')
    })

    it('returns a subscription handle', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      const subscription = await bus.subscribe('orders', handler)

      expect(subscription).toBeDefined()
      expect(subscription.id).toBeDefined()
      expect(subscription.topic).toBe('orders')
      expect(subscription.createdAt).toBeInstanceOf(Date)
    })

    it('does not receive events from other topics', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      await bus.subscribe('orders', handler)

      await bus.publish('users', createUserEvent('user.signup'))

      await new Promise((r) => setTimeout(r, 100))

      expect(handler).not.toHaveBeenCalled()
    })

    it('multiple subscribers receive the same event', async () => {
      const handler1 = vi.fn().mockResolvedValue({ success: true })
      const handler2 = vi.fn().mockResolvedValue({ success: true })
      const handler3 = vi.fn().mockResolvedValue({ success: true })

      await bus.subscribe('orders', handler1)
      await bus.subscribe('orders', handler2)
      await bus.subscribe('orders', handler3)

      const event = createOrderEvent('order.created')
      await bus.publish('orders', event)

      await waitFor(() => handler1.mock.calls.length === 1)
      await waitFor(() => handler2.mock.calls.length === 1)
      await waitFor(() => handler3.mock.calls.length === 1)

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
      expect(handler3).toHaveBeenCalledTimes(1)
    })

    it('supports subscription options', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      const subscription = await bus.subscribe('orders', handler, {
        name: 'order-processor',
        maxConcurrency: 10,
        ackTimeoutMs: 30000,
      })

      expect(subscription.name).toBe('order-processor')
    })
  })

  describe('unsubscribe()', () => {
    it('unsubscribes from a topic', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      const subscription = await bus.subscribe('orders', handler)
      await bus.unsubscribe(subscription.id)

      await bus.publish('orders', createOrderEvent('order.created'))

      await new Promise((r) => setTimeout(r, 100))

      expect(handler).not.toHaveBeenCalled()
    })

    it('allows re-subscribing after unsubscribe', async () => {
      const handler1 = vi.fn().mockResolvedValue({ success: true })
      const handler2 = vi.fn().mockResolvedValue({ success: true })

      const sub1 = await bus.subscribe('orders', handler1)
      await bus.unsubscribe(sub1.id)

      await bus.subscribe('orders', handler2)
      await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => handler2.mock.calls.length === 1)

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).toHaveBeenCalledTimes(1)
    })

    it('is idempotent - multiple unsubscribes do not error', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      const subscription = await bus.subscribe('orders', handler)

      await expect(bus.unsubscribe(subscription.id)).resolves.not.toThrow()
      await expect(bus.unsubscribe(subscription.id)).resolves.not.toThrow()
      await expect(bus.unsubscribe(subscription.id)).resolves.not.toThrow()
    })
  })

  describe('getSubscriptions()', () => {
    it('returns all active subscriptions', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      await bus.subscribe('orders', handler)
      await bus.subscribe('users', handler)
      await bus.subscribe('payments', handler)

      const subscriptions = bus.getSubscriptions()

      expect(subscriptions).toHaveLength(3)
      expect(subscriptions.map((s) => s.topic).sort()).toEqual(['orders', 'payments', 'users'])
    })

    it('excludes unsubscribed subscriptions', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      const sub1 = await bus.subscribe('orders', handler)
      await bus.subscribe('users', handler)

      await bus.unsubscribe(sub1.id)

      const subscriptions = bus.getSubscriptions()

      expect(subscriptions).toHaveLength(1)
      expect(subscriptions[0].topic).toBe('users')
    })

    it('returns empty array when no subscriptions', () => {
      const subscriptions = bus.getSubscriptions()

      expect(subscriptions).toEqual([])
    })
  })
})

// ============================================================================
// Topic-Based Routing Tests
// ============================================================================

describe('Topic-Based Routing', () => {
  let bus: EventBus<TestEvent>

  beforeEach(() => {
    bus = createEventBus<TestEvent>()
  })

  afterEach(async () => {
    await bus.close()
  })

  describe('exact topic matching', () => {
    it('routes events to matching topic only', async () => {
      const orderHandler = vi.fn().mockResolvedValue({ success: true })
      const userHandler = vi.fn().mockResolvedValue({ success: true })
      const paymentHandler = vi.fn().mockResolvedValue({ success: true })

      await bus.subscribe('orders', orderHandler)
      await bus.subscribe('users', userHandler)
      await bus.subscribe('payments', paymentHandler)

      await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => orderHandler.mock.calls.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(orderHandler).toHaveBeenCalledTimes(1)
      expect(userHandler).not.toHaveBeenCalled()
      expect(paymentHandler).not.toHaveBeenCalled()
    })

    it('supports hierarchical topic names', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      await bus.subscribe('orders.us.east', handler)

      await bus.publish('orders.us.east', createOrderEvent('order.created'))

      await waitFor(() => handler.mock.calls.length === 1)

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('treats similar topic names as different', async () => {
      const handler1 = vi.fn().mockResolvedValue({ success: true })
      const handler2 = vi.fn().mockResolvedValue({ success: true })

      await bus.subscribe('orders', handler1)
      await bus.subscribe('orders-legacy', handler2)

      await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => handler1.mock.calls.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).not.toHaveBeenCalled()
    })
  })

  describe('getTopics()', () => {
    it('returns all topics with active subscriptions', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      await bus.subscribe('orders', handler)
      await bus.subscribe('users', handler)
      await bus.subscribe('payments', handler)

      const topics = bus.getTopics()

      expect(topics.sort()).toEqual(['orders', 'payments', 'users'])
    })

    it('includes topics with published messages', async () => {
      await bus.publish('audit', { type: 'audit.entry', payload: {} })

      const topics = bus.getTopics()

      expect(topics).toContain('audit')
    })
  })
})

// ============================================================================
// Pattern Matching Subscriptions (Wildcards) Tests
// ============================================================================

describe('Pattern Matching Subscriptions', () => {
  let bus: EventBus<TestEvent>

  beforeEach(() => {
    bus = createEventBus<TestEvent>()
  })

  afterEach(async () => {
    await bus.close()
  })

  describe('single-level wildcard (*)', () => {
    it('matches any single segment', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribePattern('orders.*', handler)

      await bus.publish('orders.created', createOrderEvent('order.created'))
      await bus.publish('orders.updated', createOrderEvent('order.updated'))
      await bus.publish('orders.deleted', createOrderEvent('order.shipped'))

      await waitFor(() => events.length === 3)

      expect(events).toHaveLength(3)
    })

    it('does not match multiple segments', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      await bus.subscribePattern('orders.*', handler)

      await bus.publish('orders.us.east', createOrderEvent('order.created'))

      await new Promise((r) => setTimeout(r, 100))

      expect(handler).not.toHaveBeenCalled()
    })

    it('matches in the middle of the topic', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribePattern('orders.*.shipped', handler)

      await bus.publish('orders.us.shipped', createOrderEvent('order.shipped'))
      await bus.publish('orders.eu.shipped', createOrderEvent('order.shipped'))
      await bus.publish('orders.us.created', createOrderEvent('order.created')) // Should not match

      await waitFor(() => events.length === 2)

      expect(events).toHaveLength(2)
    })
  })

  describe('multi-level wildcard (**)', () => {
    it('matches any number of segments', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribePattern('orders.**', handler)

      await bus.publish('orders.created', createOrderEvent('order.created'))
      await bus.publish('orders.us.created', createOrderEvent('order.created'))
      await bus.publish('orders.us.east.created', createOrderEvent('order.created'))

      await waitFor(() => events.length === 3)

      expect(events).toHaveLength(3)
    })

    it('matches zero segments', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      await bus.subscribePattern('orders.**', handler)

      await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => handler.mock.calls.length === 1)

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('can be used at the beginning', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribePattern('**.shipped', handler)

      await bus.publish('orders.shipped', createOrderEvent('order.shipped'))
      await bus.publish('orders.us.shipped', createOrderEvent('order.shipped'))
      await bus.publish('company.orders.shipped', createOrderEvent('order.shipped'))

      await waitFor(() => events.length === 3)

      expect(events).toHaveLength(3)
    })
  })

  describe('single-character wildcard (?)', () => {
    it('matches exactly one character', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribePattern('orders.region-?', handler)

      await bus.publish('orders.region-1', createOrderEvent('order.created'))
      await bus.publish('orders.region-2', createOrderEvent('order.created'))
      await bus.publish('orders.region-a', createOrderEvent('order.created'))

      await waitFor(() => events.length === 3)

      expect(events).toHaveLength(3)
    })

    it('does not match zero characters', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      await bus.subscribePattern('orders.region-?', handler)

      await bus.publish('orders.region-', createOrderEvent('order.created'))

      await new Promise((r) => setTimeout(r, 100))

      expect(handler).not.toHaveBeenCalled()
    })

    it('does not match multiple characters', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      await bus.subscribePattern('orders.region-?', handler)

      await bus.publish('orders.region-12', createOrderEvent('order.created'))

      await new Promise((r) => setTimeout(r, 100))

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('character class wildcard ([abc])', () => {
    it('matches any character in the set', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribePattern('orders.region-[123]', handler)

      await bus.publish('orders.region-1', createOrderEvent('order.created'))
      await bus.publish('orders.region-2', createOrderEvent('order.created'))
      await bus.publish('orders.region-3', createOrderEvent('order.created'))

      await waitFor(() => events.length === 3)

      expect(events).toHaveLength(3)
    })

    it('does not match characters outside the set', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      await bus.subscribePattern('orders.region-[123]', handler)

      await bus.publish('orders.region-4', createOrderEvent('order.created'))

      await new Promise((r) => setTimeout(r, 100))

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('combined wildcards', () => {
    it('supports complex patterns', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribePattern('**.orders.*.shipped', handler)

      await bus.publish('company.orders.123.shipped', createOrderEvent('order.shipped'))
      await bus.publish('region.us.orders.456.shipped', createOrderEvent('order.shipped'))

      await waitFor(() => events.length === 2)

      expect(events).toHaveLength(2)
    })
  })

  describe('unsubscribePattern()', () => {
    it('removes pattern subscription', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      const sub = await bus.subscribePattern('orders.*', handler)
      await bus.unsubscribe(sub.id)

      await bus.publish('orders.created', createOrderEvent('order.created'))

      await new Promise((r) => setTimeout(r, 100))

      expect(handler).not.toHaveBeenCalled()
    })
  })
})

// ============================================================================
// Event Filtering by Attributes Tests
// ============================================================================

describe('Event Filtering by Attributes', () => {
  let bus: EventBus<TestEvent>

  beforeEach(() => {
    bus = createEventBus<TestEvent>()
  })

  afterEach(async () => {
    await bus.close()
  })

  describe('equality filters', () => {
    it('filters by exact attribute match', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          attributes: {
            region: 'us-east-1',
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'us-east-1' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'us-west-2' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'eu-west-1' },
      })

      await waitFor(() => events.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(1)
      expect(events[0].attributes?.region).toBe('us-east-1')
    })

    it('filters by multiple attributes (AND logic)', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          attributes: {
            region: 'us-east-1',
            priority: 'high',
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'us-east-1', priority: 'high' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'us-east-1', priority: 'low' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'us-west-2', priority: 'high' },
      })

      await waitFor(() => events.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(1)
    })

    it('matches events without filter (receive all)', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler)

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'us-east-1' },
      })
      await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => events.length === 2)

      expect(events).toHaveLength(2)
    })
  })

  describe('comparison filters', () => {
    it('filters using $gt (greater than)', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          attributes: {
            total: { $gt: 100 },
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { total: 150 },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { total: 50 },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { total: 100 },
      })

      await waitFor(() => events.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(1)
      expect(events[0].attributes?.total).toBe(150)
    })

    it('filters using $gte (greater than or equal)', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          attributes: {
            total: { $gte: 100 },
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { total: 150 },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { total: 100 },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { total: 50 },
      })

      await waitFor(() => events.length === 2)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(2)
    })

    it('filters using $lt (less than)', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          attributes: {
            total: { $lt: 100 },
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { total: 50 },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { total: 100 },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { total: 150 },
      })

      await waitFor(() => events.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(1)
    })

    it('filters using $lte (less than or equal)', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          attributes: {
            total: { $lte: 100 },
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { total: 50 },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { total: 100 },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { total: 150 },
      })

      await waitFor(() => events.length === 2)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(2)
    })

    it('filters using $ne (not equal)', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          attributes: {
            status: { $ne: 'cancelled' },
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { status: 'pending' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { status: 'cancelled' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { status: 'completed' },
      })

      await waitFor(() => events.length === 2)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(2)
    })
  })

  describe('set filters', () => {
    it('filters using $in (value in set)', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          attributes: {
            region: { $in: ['us-east-1', 'us-west-2'] },
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'us-east-1' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'us-west-2' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'eu-west-1' },
      })

      await waitFor(() => events.length === 2)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(2)
    })

    it('filters using $nin (value not in set)', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          attributes: {
            region: { $nin: ['us-east-1', 'us-west-2'] },
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'us-east-1' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'eu-west-1' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'ap-south-1' },
      })

      await waitFor(() => events.length === 2)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(2)
    })
  })

  describe('string filters', () => {
    it('filters using $startsWith', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          attributes: {
            customerId: { $startsWith: 'customer-premium-' },
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { customerId: 'customer-premium-123' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { customerId: 'customer-standard-456' },
      })

      await waitFor(() => events.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(1)
    })

    it('filters using $endsWith', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          attributes: {
            email: { $endsWith: '@example.com' },
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { email: 'alice@example.com' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { email: 'bob@other.com' },
      })

      await waitFor(() => events.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(1)
    })

    it('filters using $contains', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          attributes: {
            description: { $contains: 'urgent' },
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { description: 'This is an urgent order' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { description: 'Normal order' },
      })

      await waitFor(() => events.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(1)
    })

    it('filters using $regex', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          attributes: {
            orderId: { $regex: '^ORD-[0-9]{5}$' },
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { orderId: 'ORD-12345' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { orderId: 'ORD-123' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { orderId: 'ORDER-12345' },
      })

      await waitFor(() => events.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(1)
    })
  })

  describe('existence filters', () => {
    it('filters using $exists: true', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          attributes: {
            couponCode: { $exists: true },
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { couponCode: 'SAVE10' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: {},
      })

      await waitFor(() => events.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(1)
    })

    it('filters using $exists: false', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          attributes: {
            couponCode: { $exists: false },
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { couponCode: 'SAVE10' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: {},
      })

      await waitFor(() => events.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(1)
    })
  })

  describe('logical operators', () => {
    it('filters using $or', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          $or: [{ attributes: { region: 'us-east-1' } }, { attributes: { priority: 'high' } }],
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'us-east-1', priority: 'low' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'eu-west-1', priority: 'high' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'eu-west-1', priority: 'low' },
      })

      await waitFor(() => events.length === 2)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(2)
    })

    it('filters using $and', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          $and: [
            { attributes: { region: 'us-east-1' } },
            { attributes: { total: { $gt: 100 } } },
          ],
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'us-east-1', total: 150 },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'us-east-1', total: 50 },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'eu-west-1', total: 150 },
      })

      await waitFor(() => events.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(1)
    })

    it('filters using $not', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          $not: {
            attributes: { status: 'cancelled' },
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { status: 'pending' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { status: 'cancelled' },
      })

      await waitFor(() => events.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(1)
    })
  })

  describe('event body filters', () => {
    it('filters by event type field', async () => {
      const { handler, events } = createCollector<TestEvent>()

      await bus.subscribe('orders', handler, {
        filter: {
          event: {
            type: 'order.created',
          },
        },
      })

      await bus.publish('orders', createOrderEvent('order.created'))
      await bus.publish('orders', createOrderEvent('order.updated'))
      await bus.publish('orders', createOrderEvent('order.shipped'))

      await waitFor(() => events.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(1)
      expect(events[0].event.type).toBe('order.created')
    })

    it('filters by nested event payload fields', async () => {
      const { handler, events } = createCollector<OrderEvent>()
      const typedBus = bus as unknown as EventBus<OrderEvent>

      await typedBus.subscribe('orders', handler, {
        filter: {
          event: {
            'payload.total': { $gt: 100 },
          },
        },
      })

      await typedBus.publish(
        'orders',
        createOrderEvent('order.created', { total: 150 })
      )
      await typedBus.publish(
        'orders',
        createOrderEvent('order.created', { total: 50 })
      )

      await waitFor(() => events.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toHaveLength(1)
    })
  })
})

// ============================================================================
// Guaranteed Delivery with Acknowledgment Tests
// ============================================================================

describe('Guaranteed Delivery with Acknowledgment', () => {
  let bus: EventBus<TestEvent>

  beforeEach(() => {
    bus = createEventBus<TestEvent>({
      maxRetries: 3,
      retryDelayMs: 100,
      ackTimeoutMs: 1000,
    })
  })

  afterEach(async () => {
    await bus.close()
  })

  describe('explicit acknowledgment', () => {
    it('marks event as delivered when handler returns success', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      await bus.subscribe('orders', handler, { requireAck: true })

      const result = await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => handler.mock.calls.length === 1)

      const status = await bus.getEventStatus(result.eventId)

      expect(status.acknowledged).toBe(true)
      expect(status.deliveredAt).toBeDefined()
    })

    it('marks event as failed when handler returns failure', async () => {
      const handler = vi.fn().mockResolvedValue({ success: false, error: 'Processing failed' })

      await bus.subscribe('orders', handler, { requireAck: true })

      const result = await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(async () => {
        const status = await bus.getEventStatus(result.eventId)
        return status.status === 'failed'
      })

      const status = await bus.getEventStatus(result.eventId)

      expect(status.acknowledged).toBe(false)
      expect(status.error).toBe('Processing failed')
    })

    it('supports manual acknowledgment via envelope.ack()', async () => {
      const handler = vi.fn().mockImplementation(async (envelope) => {
        // Process event
        await new Promise((r) => setTimeout(r, 50))
        // Manually acknowledge
        await envelope.ack()
      })

      await bus.subscribe('orders', handler, { requireAck: true, manualAck: true })

      const result = await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(async () => {
        const status = await bus.getEventStatus(result.eventId)
        return status.acknowledged === true
      })

      const status = await bus.getEventStatus(result.eventId)

      expect(status.acknowledged).toBe(true)
    })

    it('supports manual negative acknowledgment via envelope.nack()', async () => {
      const handler = vi.fn().mockImplementation(async (envelope) => {
        await envelope.nack('Failed to process')
      })

      await bus.subscribe('orders', handler, { requireAck: true, manualAck: true })

      const result = await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(async () => {
        const status = await bus.getEventStatus(result.eventId)
        return status.status === 'failed'
      })

      const status = await bus.getEventStatus(result.eventId)

      expect(status.acknowledged).toBe(false)
    })
  })

  describe('automatic retries', () => {
    it('retries failed deliveries', async () => {
      const handler = vi
        .fn()
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValue({ success: true })

      await bus.subscribe('orders', handler)

      const result = await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(async () => {
        const status = await bus.getEventStatus(result.eventId)
        return status.acknowledged === true
      })

      expect(handler).toHaveBeenCalledTimes(3)
    })

    it('stops retrying after max attempts', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Permanent failure'))

      await bus.subscribe('orders', handler)

      const result = await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(async () => {
        const status = await bus.getEventStatus(result.eventId)
        return status.attempts >= 3
      })

      expect(handler).toHaveBeenCalledTimes(3) // Initial + 2 retries
    })

    it('uses exponential backoff between retries', async () => {
      vi.useFakeTimers()

      const callTimes: number[] = []
      const handler = vi.fn().mockImplementation(() => {
        callTimes.push(Date.now())
        throw new Error('Failure')
      })

      await bus.subscribe('orders', handler)
      await bus.publish('orders', createOrderEvent('order.created'))

      // First attempt immediate
      await vi.advanceTimersByTimeAsync(0)

      // Second attempt after 100ms
      await vi.advanceTimersByTimeAsync(100)

      // Third attempt after 200ms (exponential backoff)
      await vi.advanceTimersByTimeAsync(200)

      expect(callTimes.length).toBeGreaterThanOrEqual(2)
      if (callTimes.length >= 2) {
        expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(100)
      }

      vi.useRealTimers()
    })
  })

  describe('acknowledgment timeout', () => {
    it('triggers retry on acknowledgment timeout', async () => {
      const handler = vi.fn().mockImplementation(async () => {
        // Never returns - simulating hung handler
        await new Promise(() => {})
      })

      const shortTimeoutBus = createEventBus<TestEvent>({
        ackTimeoutMs: 50,
        maxRetries: 2,
      })

      await shortTimeoutBus.subscribe('orders', handler, { requireAck: true })
      await shortTimeoutBus.publish('orders', createOrderEvent('order.created'))

      await new Promise((r) => setTimeout(r, 200))

      // Should have been called multiple times due to timeout retries
      expect(handler.mock.calls.length).toBeGreaterThan(1)

      await shortTimeoutBus.close()
    })
  })

  describe('delivery status tracking', () => {
    it('tracks delivery attempts', async () => {
      const handler = vi
        .fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValue({ success: true })

      await bus.subscribe('orders', handler)

      const result = await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(async () => {
        const status = await bus.getEventStatus(result.eventId)
        return status.acknowledged === true
      })

      const status = await bus.getEventStatus(result.eventId)

      expect(status.attempts).toBe(2)
      expect(status.attemptHistory).toHaveLength(2)
      expect(status.attemptHistory[0].success).toBe(false)
      expect(status.attemptHistory[1].success).toBe(true)
    })

    it('records handler execution time', async () => {
      const handler = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50))
        return { success: true }
      })

      await bus.subscribe('orders', handler)

      const result = await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(async () => {
        const status = await bus.getEventStatus(result.eventId)
        return status.acknowledged === true
      })

      const status = await bus.getEventStatus(result.eventId)

      expect(status.attemptHistory[0].durationMs).toBeGreaterThanOrEqual(50)
    })
  })
})

// ============================================================================
// Dead Letter Queue Tests
// ============================================================================

describe('Dead Letter Queue', () => {
  let bus: EventBus<TestEvent>

  beforeEach(() => {
    bus = createEventBus<TestEvent>({
      maxRetries: 2,
      retryDelayMs: 50,
      enableDeadLetterQueue: true,
    })
  })

  afterEach(async () => {
    await bus.close()
  })

  describe('DLQ routing', () => {
    it('moves failed events to DLQ after max retries', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Permanent failure'))
      const dlqHandler = vi.fn()

      await bus.subscribe('orders', handler)
      bus.onDeadLetter(dlqHandler)

      const result = await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => dlqHandler.mock.calls.length === 1)

      expect(dlqHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: result.eventId,
          originalTopic: 'orders',
          error: expect.any(String),
          attempts: 2,
        })
      )
    })

    it('includes original event in DLQ entry', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Processing failed'))
      let dlqEvent: DeadLetterEvent<TestEvent> | undefined

      const dlqHandler: DLQHandler<TestEvent> = (event) => {
        dlqEvent = event
      }

      await bus.subscribe('orders', handler)
      bus.onDeadLetter(dlqHandler)

      const originalEvent = createOrderEvent('order.created')
      await bus.publish('orders', originalEvent)

      await waitFor(() => dlqEvent !== undefined)

      expect(dlqEvent?.event).toEqual(originalEvent)
    })

    it('includes failure reason in DLQ entry', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Database connection failed'))
      let dlqEvent: DeadLetterEvent<TestEvent> | undefined

      await bus.subscribe('orders', handler)
      bus.onDeadLetter((event) => {
        dlqEvent = event
      })

      await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => dlqEvent !== undefined)

      expect(dlqEvent?.error).toContain('Database connection failed')
    })

    it('includes attempt history in DLQ entry', async () => {
      const handler = vi
        .fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))

      let dlqEvent: DeadLetterEvent<TestEvent> | undefined

      await bus.subscribe('orders', handler)
      bus.onDeadLetter((event) => {
        dlqEvent = event
      })

      await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => dlqEvent !== undefined)

      expect(dlqEvent?.attemptHistory).toHaveLength(2)
      expect(dlqEvent?.attemptHistory[0].error).toContain('Error 1')
      expect(dlqEvent?.attemptHistory[1].error).toContain('Error 2')
    })
  })

  describe('DLQ querying', () => {
    it('lists events in DLQ', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Failure'))

      await bus.subscribe('orders', handler)

      await bus.publish('orders', createOrderEvent('order.created'))
      await bus.publish('orders', createOrderEvent('order.updated'))

      await waitFor(async () => {
        const dlq = await bus.getDeadLetterQueue()
        return dlq.length === 2
      })

      const dlq = await bus.getDeadLetterQueue()

      expect(dlq).toHaveLength(2)
    })

    it('filters DLQ by topic', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Failure'))

      await bus.subscribe('orders', handler)
      await bus.subscribe('users', handler)

      await bus.publish('orders', createOrderEvent('order.created'))
      await bus.publish('users', createUserEvent('user.signup'))

      await waitFor(async () => {
        const dlq = await bus.getDeadLetterQueue()
        return dlq.length === 2
      })

      const ordersDlq = await bus.getDeadLetterQueue({ topic: 'orders' })
      const usersDlq = await bus.getDeadLetterQueue({ topic: 'users' })

      expect(ordersDlq).toHaveLength(1)
      expect(usersDlq).toHaveLength(1)
    })

    it('filters DLQ by time range', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

      const handler = vi.fn().mockRejectedValue(new Error('Failure'))
      await bus.subscribe('orders', handler)

      await bus.publish('orders', createOrderEvent('order.created'))
      await vi.advanceTimersByTimeAsync(100)

      vi.setSystemTime(new Date('2024-01-15T11:00:00Z'))

      await bus.publish('orders', createOrderEvent('order.updated'))
      await vi.advanceTimersByTimeAsync(100)

      const dlq = await bus.getDeadLetterQueue({
        after: new Date('2024-01-15T10:30:00Z'),
      })

      expect(dlq).toHaveLength(1)

      vi.useRealTimers()
    })
  })

  describe('DLQ reprocessing', () => {
    it('replays event from DLQ', async () => {
      let failCount = 0
      const handler = vi.fn().mockImplementation(() => {
        if (failCount < 2) {
          failCount++
          throw new Error('Temporary failure')
        }
        return { success: true }
      })

      await bus.subscribe('orders', handler)

      const result = await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(async () => {
        const dlq = await bus.getDeadLetterQueue()
        return dlq.length === 1
      })

      // Reset handler to succeed
      failCount = 10 // Ensure handler will succeed

      await bus.replayFromDLQ(result.eventId)

      await waitFor(async () => {
        const status = await bus.getEventStatus(result.eventId)
        return status.acknowledged === true
      })

      const status = await bus.getEventStatus(result.eventId)
      expect(status.acknowledged).toBe(true)
    })

    it('replays multiple events from DLQ', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Failure'))

      await bus.subscribe('orders', handler)

      await bus.publish('orders', createOrderEvent('order.created'))
      await bus.publish('orders', createOrderEvent('order.updated'))

      await waitFor(async () => {
        const dlq = await bus.getDeadLetterQueue()
        return dlq.length === 2
      })

      // Reset handler to succeed
      handler.mockResolvedValue({ success: true })

      const replayResults = await bus.replayAllFromDLQ({ topic: 'orders' })

      expect(replayResults.replayed).toBe(2)
      expect(replayResults.failed).toBe(0)
    })

    it('removes event from DLQ after successful replay', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Failure'))

      await bus.subscribe('orders', handler)

      const result = await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(async () => {
        const dlq = await bus.getDeadLetterQueue()
        return dlq.length === 1
      })

      handler.mockResolvedValue({ success: true })

      await bus.replayFromDLQ(result.eventId)

      await waitFor(async () => {
        const dlq = await bus.getDeadLetterQueue()
        return dlq.length === 0
      })

      const dlq = await bus.getDeadLetterQueue()
      expect(dlq).toHaveLength(0)
    })
  })

  describe('DLQ cleanup', () => {
    it('removes events from DLQ', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Failure'))

      await bus.subscribe('orders', handler)

      const result = await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(async () => {
        const dlq = await bus.getDeadLetterQueue()
        return dlq.length === 1
      })

      await bus.removeFromDLQ(result.eventId)

      const dlq = await bus.getDeadLetterQueue()
      expect(dlq).toHaveLength(0)
    })

    it('purges entire DLQ', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Failure'))

      await bus.subscribe('orders', handler)

      await bus.publish('orders', createOrderEvent('order.created'))
      await bus.publish('orders', createOrderEvent('order.updated'))
      await bus.publish('orders', createOrderEvent('order.shipped'))

      await waitFor(async () => {
        const dlq = await bus.getDeadLetterQueue()
        return dlq.length === 3
      })

      await bus.purgeDLQ()

      const dlq = await bus.getDeadLetterQueue()
      expect(dlq).toHaveLength(0)
    })

    it('purges DLQ by topic', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Failure'))

      await bus.subscribe('orders', handler)
      await bus.subscribe('users', handler)

      await bus.publish('orders', createOrderEvent('order.created'))
      await bus.publish('users', createUserEvent('user.signup'))

      await waitFor(async () => {
        const dlq = await bus.getDeadLetterQueue()
        return dlq.length === 2
      })

      await bus.purgeDLQ({ topic: 'orders' })

      const dlq = await bus.getDeadLetterQueue()
      expect(dlq).toHaveLength(1)
      expect(dlq[0].originalTopic).toBe('users')
    })
  })

  describe('DLQ configuration', () => {
    it('respects maxDLQSize configuration', async () => {
      const limitedBus = createEventBus<TestEvent>({
        maxRetries: 1,
        retryDelayMs: 10,
        enableDeadLetterQueue: true,
        deadLetterQueue: {
          maxSize: 2,
        },
      })

      const handler = vi.fn().mockRejectedValue(new Error('Failure'))
      await limitedBus.subscribe('orders', handler)

      await limitedBus.publish('orders', createOrderEvent('order.created'))
      await limitedBus.publish('orders', createOrderEvent('order.updated'))
      await limitedBus.publish('orders', createOrderEvent('order.shipped'))

      await waitFor(async () => {
        const dlq = await limitedBus.getDeadLetterQueue()
        return dlq.length === 2
      })

      const dlq = await limitedBus.getDeadLetterQueue()
      expect(dlq).toHaveLength(2)

      await limitedBus.close()
    })

    it('respects ttl configuration', async () => {
      vi.useFakeTimers()

      const ttlBus = createEventBus<TestEvent>({
        maxRetries: 1,
        retryDelayMs: 10,
        enableDeadLetterQueue: true,
        deadLetterQueue: {
          ttlMs: 60000, // 1 minute
        },
      })

      const handler = vi.fn().mockRejectedValue(new Error('Failure'))
      await ttlBus.subscribe('orders', handler)

      await ttlBus.publish('orders', createOrderEvent('order.created'))

      await vi.advanceTimersByTimeAsync(100)

      let dlq = await ttlBus.getDeadLetterQueue()
      expect(dlq).toHaveLength(1)

      // Advance past TTL
      vi.advanceTimersByTime(61000)

      dlq = await ttlBus.getDeadLetterQueue()
      expect(dlq).toHaveLength(0)

      await ttlBus.close()
      vi.useRealTimers()
    })
  })
})

// ============================================================================
// Event Ordering Guarantees Tests
// ============================================================================

describe('Event Ordering Guarantees', () => {
  describe('global ordering', () => {
    it('delivers events in publish order globally', async () => {
      const bus = createEventBus<TestEvent>({
        orderingGuarantee: 'global',
      })

      const receivedOrder: number[] = []
      const handler = vi.fn().mockImplementation(async (envelope) => {
        receivedOrder.push(envelope.event.payload.order)
        return { success: true }
      })

      await bus.subscribe('orders', handler)

      // Publish events with explicit ordering
      for (let i = 0; i < 10; i++) {
        await bus.publish('orders', {
          type: 'order.created',
          payload: { order: i },
        } as TestEvent)
      }

      await waitFor(() => receivedOrder.length === 10)

      expect(receivedOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

      await bus.close()
    })
  })

  describe('per-topic ordering', () => {
    it('maintains order within a topic', async () => {
      const bus = createEventBus<TestEvent>({
        orderingGuarantee: 'per-topic',
      })

      const ordersReceived: number[] = []
      const usersReceived: number[] = []

      await bus.subscribe('orders', async (envelope) => {
        ordersReceived.push((envelope.event.payload as any).seq)
        return { success: true }
      })

      await bus.subscribe('users', async (envelope) => {
        usersReceived.push((envelope.event.payload as any).seq)
        return { success: true }
      })

      // Interleave publishes
      await bus.publish('orders', { type: 'order.created', payload: { seq: 1 } } as TestEvent)
      await bus.publish('users', { type: 'user.signup', payload: { seq: 1 } } as TestEvent)
      await bus.publish('orders', { type: 'order.created', payload: { seq: 2 } } as TestEvent)
      await bus.publish('users', { type: 'user.signup', payload: { seq: 2 } } as TestEvent)
      await bus.publish('orders', { type: 'order.created', payload: { seq: 3 } } as TestEvent)

      await waitFor(() => ordersReceived.length === 3 && usersReceived.length === 2)

      expect(ordersReceived).toEqual([1, 2, 3])
      expect(usersReceived).toEqual([1, 2])

      await bus.close()
    })
  })

  describe('per-key ordering', () => {
    it('maintains order for events with same ordering key', async () => {
      const bus = createEventBus<TestEvent>({
        orderingGuarantee: 'per-key',
      })

      const receivedByKey: Record<string, number[]> = {}
      const handler = vi.fn().mockImplementation(async (envelope) => {
        const key = envelope.orderingKey as string
        if (!receivedByKey[key]) receivedByKey[key] = []
        receivedByKey[key].push((envelope.event.payload as any).seq)
        return { success: true }
      })

      await bus.subscribe('orders', handler)

      // Publish with ordering keys
      await bus.publish('orders', { type: 'order.created', payload: { seq: 1 } } as TestEvent, {
        orderingKey: 'customer-A',
      })
      await bus.publish('orders', { type: 'order.created', payload: { seq: 1 } } as TestEvent, {
        orderingKey: 'customer-B',
      })
      await bus.publish('orders', { type: 'order.created', payload: { seq: 2 } } as TestEvent, {
        orderingKey: 'customer-A',
      })
      await bus.publish('orders', { type: 'order.created', payload: { seq: 2 } } as TestEvent, {
        orderingKey: 'customer-B',
      })
      await bus.publish('orders', { type: 'order.created', payload: { seq: 3 } } as TestEvent, {
        orderingKey: 'customer-A',
      })

      await waitFor(() => {
        const aCount = receivedByKey['customer-A']?.length ?? 0
        const bCount = receivedByKey['customer-B']?.length ?? 0
        return aCount === 3 && bCount === 2
      })

      expect(receivedByKey['customer-A']).toEqual([1, 2, 3])
      expect(receivedByKey['customer-B']).toEqual([1, 2])

      await bus.close()
    })

    it('allows parallel processing of different keys', async () => {
      const bus = createEventBus<TestEvent>({
        orderingGuarantee: 'per-key',
      })

      const processingTimes: Array<{ key: string; start: number; end: number }> = []

      const handler = vi.fn().mockImplementation(async (envelope) => {
        const start = Date.now()
        await new Promise((r) => setTimeout(r, 50))
        const end = Date.now()
        processingTimes.push({ key: envelope.orderingKey, start, end })
        return { success: true }
      })

      await bus.subscribe('orders', handler)

      // Publish events with different keys concurrently
      await Promise.all([
        bus.publish('orders', { type: 'order.created', payload: { seq: 1 } } as TestEvent, {
          orderingKey: 'customer-A',
        }),
        bus.publish('orders', { type: 'order.created', payload: { seq: 1 } } as TestEvent, {
          orderingKey: 'customer-B',
        }),
      ])

      await waitFor(() => processingTimes.length === 2)

      // Events with different keys should have overlapping processing times
      const [first, second] = processingTimes.sort((a, b) => a.start - b.start)

      // If parallel, second should start before first ends
      expect(second.start).toBeLessThan(first.end)

      await bus.close()
    })
  })

  describe('no ordering guarantee', () => {
    it('allows out-of-order delivery for maximum throughput', async () => {
      const bus = createEventBus<TestEvent>({
        orderingGuarantee: 'none',
      })

      const received: number[] = []
      const handler = vi.fn().mockImplementation(async (envelope) => {
        // Add random delay to simulate varying processing times
        await new Promise((r) => setTimeout(r, Math.random() * 50))
        received.push((envelope.event.payload as any).seq)
        return { success: true }
      })

      await bus.subscribe('orders', handler)

      // Publish many events quickly
      for (let i = 0; i < 10; i++) {
        await bus.publish('orders', { type: 'order.created', payload: { seq: i } } as TestEvent)
      }

      await waitFor(() => received.length === 10)

      // All events received, order not guaranteed
      expect(received.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

      await bus.close()
    })
  })
})

// ============================================================================
// Subscription Management Tests
// ============================================================================

describe('Subscription Management', () => {
  let bus: EventBus<TestEvent>

  beforeEach(() => {
    bus = createEventBus<TestEvent>()
  })

  afterEach(async () => {
    await bus.close()
  })

  describe('subscription configuration', () => {
    it('supports named subscriptions', async () => {
      const sub = await bus.subscribe('orders', vi.fn(), {
        name: 'order-processor-primary',
      })

      expect(sub.name).toBe('order-processor-primary')

      const subscriptions = bus.getSubscriptions()
      expect(subscriptions[0].name).toBe('order-processor-primary')
    })

    it('supports max concurrency configuration', async () => {
      const sub = await bus.subscribe('orders', vi.fn(), {
        maxConcurrency: 5,
      })

      expect(sub.maxConcurrency).toBe(5)
    })

    it('supports batch size configuration', async () => {
      const sub = await bus.subscribe('orders', vi.fn(), {
        batchSize: 10,
      })

      expect(sub.batchSize).toBe(10)
    })
  })

  describe('subscription querying', () => {
    it('gets subscription by ID', async () => {
      const sub = await bus.subscribe('orders', vi.fn(), { name: 'test-sub' })

      const retrieved = bus.getSubscription(sub.id)

      expect(retrieved).toBeDefined()
      expect(retrieved?.name).toBe('test-sub')
    })

    it('gets subscriptions by topic', async () => {
      await bus.subscribe('orders', vi.fn(), { name: 'sub-1' })
      await bus.subscribe('orders', vi.fn(), { name: 'sub-2' })
      await bus.subscribe('users', vi.fn(), { name: 'sub-3' })

      const orderSubs = bus.getSubscriptionsByTopic('orders')

      expect(orderSubs).toHaveLength(2)
      expect(orderSubs.map((s) => s.name).sort()).toEqual(['sub-1', 'sub-2'])
    })

    it('gets subscription count', async () => {
      await bus.subscribe('orders', vi.fn())
      await bus.subscribe('users', vi.fn())
      await bus.subscribe('payments', vi.fn())

      const count = bus.getSubscriptionCount()

      expect(count).toBe(3)
    })
  })

  describe('subscription pause/resume', () => {
    it('pauses subscription to stop receiving events', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const sub = await bus.subscribe('orders', handler)

      await bus.pauseSubscription(sub.id)

      await bus.publish('orders', createOrderEvent('order.created'))

      await new Promise((r) => setTimeout(r, 100))

      expect(handler).not.toHaveBeenCalled()
    })

    it('resumes subscription to receive events again', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const sub = await bus.subscribe('orders', handler)

      await bus.pauseSubscription(sub.id)
      await bus.resumeSubscription(sub.id)

      await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => handler.mock.calls.length === 1)

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('tracks paused state in subscription', async () => {
      const sub = await bus.subscribe('orders', vi.fn())

      expect(sub.paused).toBe(false)

      await bus.pauseSubscription(sub.id)

      const updated = bus.getSubscription(sub.id)
      expect(updated?.paused).toBe(true)

      await bus.resumeSubscription(sub.id)

      const resumed = bus.getSubscription(sub.id)
      expect(resumed?.paused).toBe(false)
    })
  })

  describe('subscription updates', () => {
    it('updates subscription handler', async () => {
      const handler1 = vi.fn().mockResolvedValue({ success: true })
      const handler2 = vi.fn().mockResolvedValue({ success: true })

      const sub = await bus.subscribe('orders', handler1)

      await bus.updateSubscription(sub.id, { handler: handler2 })

      await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => handler2.mock.calls.length === 1)

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).toHaveBeenCalledTimes(1)
    })

    it('updates subscription filter', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      const sub = await bus.subscribe('orders', handler, {
        filter: { attributes: { region: 'us-east-1' } },
      })

      await bus.updateSubscription(sub.id, {
        filter: { attributes: { region: 'eu-west-1' } },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'us-east-1' },
      })
      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'eu-west-1' },
      })

      await waitFor(() => handler.mock.calls.length === 1)
      await new Promise((r) => setTimeout(r, 50))

      expect(handler).toHaveBeenCalledTimes(1)
    })
  })
})

// ============================================================================
// Statistics and Observability Tests
// ============================================================================

describe('Statistics and Observability', () => {
  let bus: EventBus<TestEvent>

  beforeEach(() => {
    bus = createEventBus<TestEvent>()
  })

  afterEach(async () => {
    await bus.close()
  })

  describe('getStats()', () => {
    it('returns overall event bus statistics', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      await bus.subscribe('orders', handler)
      await bus.subscribe('users', handler)

      await bus.publish('orders', createOrderEvent('order.created'))
      await bus.publish('orders', createOrderEvent('order.updated'))
      await bus.publish('users', createUserEvent('user.signup'))

      await waitFor(() => handler.mock.calls.length === 3)

      const stats = bus.getStats()

      expect(stats.totalPublished).toBe(3)
      expect(stats.totalDelivered).toBe(3)
      expect(stats.activeSubscriptions).toBe(2)
      expect(stats.activeTopics).toBe(2)
    })

    it('tracks failed deliveries', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Failure'))

      const noRetryBus = createEventBus<TestEvent>({ maxRetries: 1 })
      await noRetryBus.subscribe('orders', handler)

      await noRetryBus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => handler.mock.calls.length >= 1)
      await new Promise((r) => setTimeout(r, 100))

      const stats = noRetryBus.getStats()

      expect(stats.totalFailed).toBeGreaterThan(0)

      await noRetryBus.close()
    })
  })

  describe('getTopicStats()', () => {
    it('returns per-topic statistics', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      await bus.subscribe('orders', handler)

      await bus.publish('orders', createOrderEvent('order.created'))
      await bus.publish('orders', createOrderEvent('order.updated'))

      await waitFor(() => handler.mock.calls.length === 2)

      const stats = bus.getTopicStats('orders')

      expect(stats.published).toBe(2)
      expect(stats.delivered).toBe(2)
      expect(stats.subscribers).toBe(1)
    })
  })

  describe('metrics integration', () => {
    it('calls metrics collector on publish', async () => {
      const metrics = {
        incrementCounter: vi.fn(),
        recordLatency: vi.fn(),
        recordGauge: vi.fn(),
      }

      const metricsBus = createEventBus<TestEvent>({ metrics })

      await metricsBus.publish('orders', createOrderEvent('order.created'))

      expect(metrics.incrementCounter).toHaveBeenCalledWith(
        expect.stringContaining('eventbus'),
        expect.any(Object)
      )

      await metricsBus.close()
    })

    it('records delivery latency', async () => {
      const metrics = {
        incrementCounter: vi.fn(),
        recordLatency: vi.fn(),
        recordGauge: vi.fn(),
      }

      const metricsBus = createEventBus<TestEvent>({ metrics })

      const handler = vi.fn().mockResolvedValue({ success: true })
      await metricsBus.subscribe('orders', handler)

      await metricsBus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => handler.mock.calls.length === 1)

      expect(metrics.recordLatency).toHaveBeenCalledWith(
        expect.stringContaining('latency'),
        expect.any(Number)
      )

      await metricsBus.close()
    })
  })
})

// ============================================================================
// Event Envelope Tests
// ============================================================================

describe('Event Envelope', () => {
  let bus: EventBus<TestEvent>

  beforeEach(() => {
    bus = createEventBus<TestEvent>()
  })

  afterEach(async () => {
    await bus.close()
  })

  describe('envelope structure', () => {
    it('includes event ID', async () => {
      let receivedEnvelope: EventEnvelope<TestEvent> | undefined

      await bus.subscribe('orders', async (envelope) => {
        receivedEnvelope = envelope
        return { success: true }
      })

      await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => receivedEnvelope !== undefined)

      expect(receivedEnvelope?.eventId).toBeDefined()
      expect(receivedEnvelope?.eventId.length).toBeGreaterThan(0)
    })

    it('includes topic', async () => {
      let receivedEnvelope: EventEnvelope<TestEvent> | undefined

      await bus.subscribe('orders', async (envelope) => {
        receivedEnvelope = envelope
        return { success: true }
      })

      await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => receivedEnvelope !== undefined)

      expect(receivedEnvelope?.topic).toBe('orders')
    })

    it('includes publish timestamp', async () => {
      let receivedEnvelope: EventEnvelope<TestEvent> | undefined

      await bus.subscribe('orders', async (envelope) => {
        receivedEnvelope = envelope
        return { success: true }
      })

      const beforePublish = Date.now()
      await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => receivedEnvelope !== undefined)

      expect(receivedEnvelope?.publishedAt).toBeInstanceOf(Date)
      expect(receivedEnvelope?.publishedAt.getTime()).toBeGreaterThanOrEqual(beforePublish)
    })

    it('includes attributes when provided', async () => {
      let receivedEnvelope: EventEnvelope<TestEvent> | undefined

      await bus.subscribe('orders', async (envelope) => {
        receivedEnvelope = envelope
        return { success: true }
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: {
          region: 'us-east-1',
          priority: 'high',
        },
      })

      await waitFor(() => receivedEnvelope !== undefined)

      expect(receivedEnvelope?.attributes).toEqual({
        region: 'us-east-1',
        priority: 'high',
      })
    })

    it('includes ordering key when provided', async () => {
      let receivedEnvelope: EventEnvelope<TestEvent> | undefined

      await bus.subscribe('orders', async (envelope) => {
        receivedEnvelope = envelope
        return { success: true }
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        orderingKey: 'customer-123',
      })

      await waitFor(() => receivedEnvelope !== undefined)

      expect(receivedEnvelope?.orderingKey).toBe('customer-123')
    })

    it('includes attempt number', async () => {
      let receivedEnvelope: EventEnvelope<TestEvent> | undefined

      await bus.subscribe('orders', async (envelope) => {
        receivedEnvelope = envelope
        return { success: true }
      })

      await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => receivedEnvelope !== undefined)

      expect(receivedEnvelope?.attempt).toBe(1)
    })

    it('includes matched pattern for pattern subscriptions', async () => {
      let receivedEnvelope: EventEnvelope<TestEvent> | undefined

      await bus.subscribePattern('orders.*', async (envelope) => {
        receivedEnvelope = envelope
        return { success: true }
      })

      await bus.publish('orders.created', createOrderEvent('order.created'))

      await waitFor(() => receivedEnvelope !== undefined)

      expect(receivedEnvelope?.matchedPattern).toBe('orders.*')
    })
  })
})

// ============================================================================
// Module Exports Tests
// ============================================================================

describe('Module Exports', () => {
  it('exports factory function', () => {
    expect(createEventBus).toBeDefined()
    expect(typeof createEventBus).toBe('function')
  })

  it('exports EventBus class', () => {
    expect(EventBus).toBeDefined()
    expect(typeof EventBus).toBe('function')
  })

  it('exports duration helpers', () => {
    expect(seconds).toBeDefined()
    expect(minutes).toBeDefined()
    expect(seconds(5)).toBe(5000)
    expect(minutes(2)).toBe(120000)
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  describe('Order processing workflow', () => {
    it('handles complete order lifecycle', async () => {
      const bus = createEventBus<OrderEvent>()

      const orderHistory: Array<{ orderId: string; status: string }> = []

      // Subscribe to all order events
      await bus.subscribePattern('orders.**', async (envelope) => {
        orderHistory.push({
          orderId: envelope.event.payload.orderId,
          status: envelope.event.type,
        })
        return { success: true }
      })

      const orderId = 'order-12345'

      // Simulate order lifecycle
      await bus.publish('orders.created', createOrderEvent('order.created', { orderId }))
      await bus.publish('orders.updated', createOrderEvent('order.updated', { orderId }))
      await bus.publish('orders.shipped', createOrderEvent('order.shipped', { orderId }))
      await bus.publish('orders.delivered', createOrderEvent('order.delivered', { orderId }))

      await waitFor(() => orderHistory.length === 4)

      expect(orderHistory).toEqual([
        { orderId, status: 'order.created' },
        { orderId, status: 'order.updated' },
        { orderId, status: 'order.shipped' },
        { orderId, status: 'order.delivered' },
      ])

      await bus.close()
    })
  })

  describe('Multi-subscriber fan-out', () => {
    it('delivers event to multiple subscribers concurrently', async () => {
      const bus = createEventBus<TestEvent>()

      const receivedBy: string[] = []

      await bus.subscribe('orders', async () => {
        receivedBy.push('analytics')
        return { success: true }
      })

      await bus.subscribe('orders', async () => {
        receivedBy.push('notification')
        return { success: true }
      })

      await bus.subscribe('orders', async () => {
        receivedBy.push('inventory')
        return { success: true }
      })

      await bus.publish('orders', createOrderEvent('order.created'))

      await waitFor(() => receivedBy.length === 3)

      expect(receivedBy.sort()).toEqual(['analytics', 'inventory', 'notification'])

      await bus.close()
    })
  })

  describe('Filtered event routing', () => {
    it('routes events to appropriate handlers based on filters', async () => {
      const bus = createEventBus<TestEvent>()

      const usRegionEvents: TestEvent[] = []
      const highPriorityEvents: TestEvent[] = []
      const allEvents: TestEvent[] = []

      await bus.subscribe(
        'orders',
        async (envelope) => {
          usRegionEvents.push(envelope.event)
          return { success: true }
        },
        {
          filter: { attributes: { region: { $startsWith: 'us-' } } },
        }
      )

      await bus.subscribe(
        'orders',
        async (envelope) => {
          highPriorityEvents.push(envelope.event)
          return { success: true }
        },
        {
          filter: { attributes: { priority: 'high' } },
        }
      )

      await bus.subscribe('orders', async (envelope) => {
        allEvents.push(envelope.event)
        return { success: true }
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'us-east-1', priority: 'low' },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'eu-west-1', priority: 'high' },
      })

      await bus.publish('orders', createOrderEvent('order.created'), {
        attributes: { region: 'us-west-2', priority: 'high' },
      })

      await waitFor(() => allEvents.length === 3)

      expect(usRegionEvents).toHaveLength(2)
      expect(highPriorityEvents).toHaveLength(2)
      expect(allEvents).toHaveLength(3)

      await bus.close()
    })
  })
})

// ============================================================================
// Cleanup and Resource Management Tests
// ============================================================================

describe('Cleanup and Resource Management', () => {
  describe('close()', () => {
    it('closes the event bus and cleans up resources', async () => {
      const bus = createEventBus<TestEvent>()

      const handler = vi.fn().mockResolvedValue({ success: true })
      await bus.subscribe('orders', handler)

      await bus.close()

      // Publishing after close should throw or be ignored
      await expect(bus.publish('orders', createOrderEvent('order.created'))).rejects.toThrow()
    })

    it('waits for pending handlers to complete before closing', async () => {
      const bus = createEventBus<TestEvent>()

      let handlerCompleted = false
      const handler = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100))
        handlerCompleted = true
        return { success: true }
      })

      await bus.subscribe('orders', handler)
      await bus.publish('orders', createOrderEvent('order.created'))

      // Start close immediately - should wait for handler
      await bus.close()

      expect(handlerCompleted).toBe(true)
    })

    it('removes all subscriptions on close', async () => {
      const bus = createEventBus<TestEvent>()

      await bus.subscribe('orders', vi.fn())
      await bus.subscribe('users', vi.fn())
      await bus.subscribe('payments', vi.fn())

      expect(bus.getSubscriptionCount()).toBe(3)

      await bus.close()

      expect(bus.getSubscriptionCount()).toBe(0)
    })
  })
})
