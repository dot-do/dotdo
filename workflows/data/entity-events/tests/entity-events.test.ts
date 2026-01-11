/**
 * Entity Events (Event Sourcing) Tests
 *
 * RED Phase: These tests define the expected behavior of entity event sourcing.
 * All tests should FAIL until implementation is complete.
 *
 * Entity event sourcing provides:
 * - $.Entity(id).append(eventType, data) - Append an event to entity's event log
 * - $.Entity(id).state() - Reconstruct current state from events
 * - $.Entity(id).events() - Get full event history
 * - $.Entity(id).stateAt(timestamp) - Time-travel to state at specific point
 * - $.aggregate(entityType, config) - Define state reducers for entity
 * - $.projection(name, config) - Define cross-entity projections
 *
 * Usage scenarios:
 * - Order lifecycle: created -> paid -> shipped -> delivered
 * - Customer history: signup -> verified -> upgraded -> churned
 * - Inventory tracking: received -> allocated -> shipped -> returned
 * - Audit trails: complete history of all state changes
 *
 * Design doc: docs/plans/2026-01-11-data-api-design.md (Entity Event Sourcing section)
 *
 * @module workflows/data/entity-events/tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Import entity events API (will fail - modules don't exist yet)
import {
  createEntityEventContext,
  type EntityEventContext,
  type EntityEvent,
  type EntityState,
  type AggregateDefinition,
  type ProjectionDefinition,
  type ProjectionHandler,
  type SnapshotConfig,
  type EventFilter,
} from '../entity-events'

// ============================================================================
// TEST DATA AND HELPERS
// ============================================================================

interface OrderData {
  customerId?: string
  items?: Array<{ sku: string; qty: number }>
  total?: number
  status?: string
  paymentId?: string
  trackingNumber?: string
  carrier?: string
  deliveredAt?: Date
}

interface OrderEvent {
  type: string
  data: OrderData
  version: number
  timestamp: Date
  entityId: string
}

interface OrderState {
  customerId: string
  items: Array<{ sku: string; qty: number }>
  total: number
  status: 'pending' | 'created' | 'paid' | 'shipped' | 'delivered'
  paymentId?: string
  trackingNumber?: string
  carrier?: string
  deliveredAt?: Date
}

interface CustomerData {
  email?: string
  name?: string
  plan?: string
  signupSource?: string
}

interface CustomerState {
  email: string
  name: string
  plan: 'free' | 'pro' | 'enterprise'
  signupSource?: string
  verified: boolean
  status: 'active' | 'churned'
}

/**
 * Create a mock entity event context for testing
 */
function createTestContext(): EntityEventContext {
  return createEntityEventContext({
    // Mock storage implementation
    storage: new Map<string, unknown>(),
  })
}

/**
 * Helper to wait for async operations
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// TEST SUITE: Basic Event Appending
// ============================================================================

describe('Entity Events - Append Events', () => {
  let ctx: EntityEventContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  // --------------------------------------------------------------------------
  // $.Entity(id).append(eventType, data)
  // --------------------------------------------------------------------------

  describe('$.Entity(id).append(eventType, data)', () => {
    it('appends an event to the entity event log', async () => {
      const orderId = 'ord-123'

      await ctx.$.Order(orderId).append('created', {
        customerId: 'c123',
        items: [{ sku: 'widget-1', qty: 2 }],
        total: 199,
      })

      const events = await ctx.$.Order(orderId).events()
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('Order.created')
    })

    it('returns the appended event with version and timestamp', async () => {
      const orderId = 'ord-456'
      const beforeAppend = Date.now()

      const event = await ctx.$.Order(orderId).append('created', {
        customerId: 'c456',
        items: [],
        total: 0,
      })

      const afterAppend = Date.now()

      expect(event).toBeDefined()
      expect(event.type).toBe('Order.created')
      expect(event.version).toBe(1)
      expect(event.timestamp.getTime()).toBeGreaterThanOrEqual(beforeAppend)
      expect(event.timestamp.getTime()).toBeLessThanOrEqual(afterAppend)
    })

    it('auto-increments version for subsequent events', async () => {
      const orderId = 'ord-789'

      await ctx.$.Order(orderId).append('created', { customerId: 'c789' })
      await ctx.$.Order(orderId).append('paid', { paymentId: 'pay_123' })
      await ctx.$.Order(orderId).append('shipped', { trackingNumber: 'TRK001' })

      const events = await ctx.$.Order(orderId).events()

      expect(events[0].version).toBe(1)
      expect(events[1].version).toBe(2)
      expect(events[2].version).toBe(3)
    })

    it('prefixes event type with entity name', async () => {
      const customerId = 'cust-001'

      await ctx.$.Customer(customerId).append('signup', { email: 'test@example.com' })

      const events = await ctx.$.Customer(customerId).events()
      expect(events[0].type).toBe('Customer.signup')
    })

    it('stores entity ID in event metadata', async () => {
      const orderId = 'ord-meta-test'

      await ctx.$.Order(orderId).append('created', { total: 100 })

      const events = await ctx.$.Order(orderId).events()
      expect(events[0].entityId).toBe(orderId)
    })

    it('supports multiple entity types independently', async () => {
      await ctx.$.Order('ord-1').append('created', { total: 100 })
      await ctx.$.Customer('cust-1').append('signup', { email: 'a@b.com' })
      await ctx.$.Invoice('inv-1').append('issued', { amount: 50 })

      const orderEvents = await ctx.$.Order('ord-1').events()
      const customerEvents = await ctx.$.Customer('cust-1').events()
      const invoiceEvents = await ctx.$.Invoice('inv-1').events()

      expect(orderEvents).toHaveLength(1)
      expect(customerEvents).toHaveLength(1)
      expect(invoiceEvents).toHaveLength(1)
    })

    it('handles concurrent appends to different entities', async () => {
      await Promise.all([
        ctx.$.Order('ord-a').append('created', { total: 100 }),
        ctx.$.Order('ord-b').append('created', { total: 200 }),
        ctx.$.Order('ord-c').append('created', { total: 300 }),
      ])

      const eventsA = await ctx.$.Order('ord-a').events()
      const eventsB = await ctx.$.Order('ord-b').events()
      const eventsC = await ctx.$.Order('ord-c').events()

      expect(eventsA).toHaveLength(1)
      expect(eventsB).toHaveLength(1)
      expect(eventsC).toHaveLength(1)
    })

    it('throws on append to non-existent aggregate type (if strict mode)', async () => {
      ctx.setStrictMode(true)

      // If UnknownEntity aggregate is not defined, should throw
      await expect(ctx.$.UnknownEntity('id-1').append('created', {})).rejects.toThrow(
        /aggregate.*not defined/i
      )
    })

    it('allows append to undefined aggregate in non-strict mode', async () => {
      ctx.setStrictMode(false)

      // Should work without pre-defined aggregate
      await expect(
        ctx.$.UnknownEntity('id-1').append('created', { data: 'test' })
      ).resolves.toBeDefined()
    })
  })

  describe('Event Data Validation', () => {
    it('validates event data against schema if defined', async () => {
      ctx.$.aggregate('Order', {
        initial: () => ({ status: 'pending' }),
        reduce: {},
        events: {
          'Order.created': {
            schema: {
              customerId: { type: 'string', required: true },
              total: { type: 'number', required: true },
            },
          },
        },
      })

      // Missing required field should throw
      await expect(ctx.$.Order('ord-invalid').append('created', { total: 100 })).rejects.toThrow(
        /customerId.*required/i
      )
    })

    it('allows valid event data', async () => {
      ctx.$.aggregate('Order', {
        initial: () => ({ status: 'pending' }),
        reduce: {},
        events: {
          'Order.created': {
            schema: {
              customerId: { type: 'string', required: true },
              total: { type: 'number', required: true },
            },
          },
        },
      })

      await expect(
        ctx.$.Order('ord-valid').append('created', {
          customerId: 'c123',
          total: 199,
        })
      ).resolves.toBeDefined()
    })

    it('handles nested objects in event data', async () => {
      await ctx.$.Order('ord-nested').append('created', {
        customerId: 'c123',
        items: [
          { sku: 'SKU-001', qty: 2, price: 49.99 },
          { sku: 'SKU-002', qty: 1, price: 99.99 },
        ],
        shipping: {
          address: {
            street: '123 Main St',
            city: 'Anytown',
            zip: '12345',
          },
        },
      })

      const events = await ctx.$.Order('ord-nested').events()
      expect(events[0].data.items).toHaveLength(2)
      expect(events[0].data.shipping.address.city).toBe('Anytown')
    })

    it('handles special characters in event data', async () => {
      await ctx.$.Order('ord-special').append('created', {
        notes: 'Unicode: \u{1F600} emoji and special chars: <>&"\'',
        customerId: 'c-123',
      })

      const events = await ctx.$.Order('ord-special').events()
      expect(events[0].data.notes).toContain('\u{1F600}')
    })
  })
})

// ============================================================================
// TEST SUITE: State Reconstruction
// ============================================================================

describe('Entity Events - State Reconstruction', () => {
  let ctx: EntityEventContext

  beforeEach(() => {
    ctx = createTestContext()

    // Define Order aggregate with reducers
    ctx.$.aggregate('Order', {
      initial: (): OrderState => ({
        customerId: '',
        items: [],
        total: 0,
        status: 'pending',
      }),

      reduce: {
        'Order.created': (state: OrderState, event: EntityEvent) => ({
          ...state,
          customerId: event.data.customerId,
          items: event.data.items || [],
          total: event.data.total || 0,
          status: 'created',
        }),
        'Order.paid': (state: OrderState, event: EntityEvent) => ({
          ...state,
          status: 'paid',
          paymentId: event.data.paymentId,
        }),
        'Order.shipped': (state: OrderState, event: EntityEvent) => ({
          ...state,
          status: 'shipped',
          trackingNumber: event.data.trackingNumber,
          carrier: event.data.carrier,
        }),
        'Order.delivered': (state: OrderState, event: EntityEvent) => ({
          ...state,
          status: 'delivered',
          deliveredAt: event.data.deliveredAt || new Date(),
        }),
      },
    })
  })

  // --------------------------------------------------------------------------
  // $.Entity(id).state()
  // --------------------------------------------------------------------------

  describe('$.Entity(id).state()', () => {
    it('returns initial state for entity with no events', async () => {
      const state = await ctx.$.Order('ord-new').state()

      expect(state).toEqual({
        customerId: '',
        items: [],
        total: 0,
        status: 'pending',
      })
    })

    it('reconstructs state from single event', async () => {
      await ctx.$.Order('ord-single').append('created', {
        customerId: 'c123',
        items: [{ sku: 'widget', qty: 1 }],
        total: 49.99,
      })

      const state = await ctx.$.Order('ord-single').state()

      expect(state.customerId).toBe('c123')
      expect(state.items).toHaveLength(1)
      expect(state.total).toBe(49.99)
      expect(state.status).toBe('created')
    })

    it('reconstructs state from multiple events', async () => {
      await ctx.$.Order('ord-multi').append('created', {
        customerId: 'c456',
        items: [{ sku: 'gadget', qty: 2 }],
        total: 199,
      })
      await ctx.$.Order('ord-multi').append('paid', { paymentId: 'pay_789' })
      await ctx.$.Order('ord-multi').append('shipped', {
        trackingNumber: 'TRK12345',
        carrier: 'fedex',
      })

      const state = await ctx.$.Order('ord-multi').state()

      expect(state.customerId).toBe('c456')
      expect(state.status).toBe('shipped')
      expect(state.paymentId).toBe('pay_789')
      expect(state.trackingNumber).toBe('TRK12345')
      expect(state.carrier).toBe('fedex')
    })

    it('applies reducers in event order', async () => {
      await ctx.$.Order('ord-order').append('created', { total: 100 })
      await ctx.$.Order('ord-order').append('paid', {})
      await ctx.$.Order('ord-order').append('shipped', {})
      await ctx.$.Order('ord-order').append('delivered', {})

      const state = await ctx.$.Order('ord-order').state()

      expect(state.status).toBe('delivered')
    })

    it('handles unknown event types gracefully', async () => {
      await ctx.$.Order('ord-unknown').append('created', { total: 100 })
      await ctx.$.Order('ord-unknown').append('customEvent', { foo: 'bar' })

      // Should not throw, just skip unknown event
      const state = await ctx.$.Order('ord-unknown').state()
      expect(state.status).toBe('created')
    })

    it('returns typed state based on aggregate definition', async () => {
      await ctx.$.Order('ord-typed').append('created', { customerId: 'c-typed' })

      const state = await ctx.$.Order('ord-typed').state<OrderState>()

      // Type inference should work
      expect(typeof state.customerId).toBe('string')
      expect(typeof state.total).toBe('number')
      expect(typeof state.status).toBe('string')
    })

    it('throws for undefined aggregate in strict mode', async () => {
      ctx.setStrictMode(true)

      await expect(ctx.$.UndefinedEntity('id').state()).rejects.toThrow(/aggregate.*not defined/i)
    })

    it('returns empty state for undefined aggregate in non-strict mode', async () => {
      ctx.setStrictMode(false)

      const state = await ctx.$.UndefinedEntity('id').state()
      expect(state).toEqual({})
    })
  })

  describe('State Immutability', () => {
    it('state reconstruction does not modify stored events', async () => {
      await ctx.$.Order('ord-immut').append('created', { total: 100 })

      const events1 = await ctx.$.Order('ord-immut').events()
      await ctx.$.Order('ord-immut').state()
      const events2 = await ctx.$.Order('ord-immut').events()

      expect(events1).toEqual(events2)
    })

    it('returned state is a new object each time', async () => {
      await ctx.$.Order('ord-new-obj').append('created', { total: 100 })

      const state1 = await ctx.$.Order('ord-new-obj').state()
      const state2 = await ctx.$.Order('ord-new-obj').state()

      expect(state1).toEqual(state2)
      expect(state1).not.toBe(state2) // Different object references
    })

    it('mutating returned state does not affect future state() calls', async () => {
      await ctx.$.Order('ord-mutate').append('created', {
        items: [{ sku: 'x', qty: 1 }],
      })

      const state1 = await ctx.$.Order('ord-mutate').state()
      state1.items.push({ sku: 'y', qty: 2 })

      const state2 = await ctx.$.Order('ord-mutate').state()
      expect(state2.items).toHaveLength(1)
    })
  })
})

// ============================================================================
// TEST SUITE: Event History
// ============================================================================

describe('Entity Events - Event History', () => {
  let ctx: EntityEventContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  // --------------------------------------------------------------------------
  // $.Entity(id).events()
  // --------------------------------------------------------------------------

  describe('$.Entity(id).events()', () => {
    it('returns empty array for entity with no events', async () => {
      const events = await ctx.$.Order('ord-empty').events()
      expect(events).toEqual([])
    })

    it('returns all events in chronological order', async () => {
      await ctx.$.Order('ord-chrono').append('created', {})
      await ctx.$.Order('ord-chrono').append('paid', {})
      await ctx.$.Order('ord-chrono').append('shipped', {})

      const events = await ctx.$.Order('ord-chrono').events()

      expect(events).toHaveLength(3)
      expect(events[0].type).toBe('Order.created')
      expect(events[1].type).toBe('Order.paid')
      expect(events[2].type).toBe('Order.shipped')
    })

    it('each event has required metadata', async () => {
      await ctx.$.Order('ord-meta').append('created', { total: 100 })

      const events = await ctx.$.Order('ord-meta').events()
      const event = events[0]

      expect(event).toHaveProperty('type')
      expect(event).toHaveProperty('data')
      expect(event).toHaveProperty('version')
      expect(event).toHaveProperty('timestamp')
      expect(event).toHaveProperty('entityId')
    })

    it('timestamps are in ascending order', async () => {
      await ctx.$.Order('ord-ts').append('created', {})
      await delay(10)
      await ctx.$.Order('ord-ts').append('paid', {})
      await delay(10)
      await ctx.$.Order('ord-ts').append('shipped', {})

      const events = await ctx.$.Order('ord-ts').events()

      expect(events[0].timestamp.getTime()).toBeLessThan(events[1].timestamp.getTime())
      expect(events[1].timestamp.getTime()).toBeLessThan(events[2].timestamp.getTime())
    })

    it('preserves original event data', async () => {
      const originalData = {
        customerId: 'c-preserve',
        items: [{ sku: 'ITEM-001', qty: 3 }],
        total: 299.97,
        metadata: { source: 'web', campaign: 'summer-sale' },
      }

      await ctx.$.Order('ord-preserve').append('created', originalData)

      const events = await ctx.$.Order('ord-preserve').events()
      expect(events[0].data).toEqual(originalData)
    })
  })

  describe('Filtered Event Queries', () => {
    beforeEach(async () => {
      // Set up test data with multiple events
      await ctx.$.Order('ord-filter').append('created', { total: 100 })
      await delay(50)
      await ctx.$.Order('ord-filter').append('paid', {})
      await delay(50)
      await ctx.$.Order('ord-filter').append('shipped', {})
      await delay(50)
      await ctx.$.Order('ord-filter').append('delivered', {})
    })

    it('filters events by type', async () => {
      const events = await ctx.$.Order('ord-filter').events({
        type: 'Order.paid',
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('Order.paid')
    })

    it('filters events by version range', async () => {
      const events = await ctx.$.Order('ord-filter').events({
        fromVersion: 2,
        toVersion: 3,
      })

      expect(events).toHaveLength(2)
      expect(events[0].version).toBe(2)
      expect(events[1].version).toBe(3)
    })

    it('filters events by timestamp range', async () => {
      const allEvents = await ctx.$.Order('ord-filter').events()
      const midpoint = allEvents[1].timestamp

      const events = await ctx.$.Order('ord-filter').events({
        since: midpoint,
      })

      expect(events.length).toBeGreaterThanOrEqual(2)
      events.forEach((e) => {
        expect(e.timestamp.getTime()).toBeGreaterThanOrEqual(midpoint.getTime())
      })
    })

    it('limits number of events returned', async () => {
      const events = await ctx.$.Order('ord-filter').events({
        limit: 2,
      })

      expect(events).toHaveLength(2)
    })

    it('supports pagination with offset', async () => {
      const events = await ctx.$.Order('ord-filter').events({
        limit: 2,
        offset: 1,
      })

      expect(events).toHaveLength(2)
      expect(events[0].version).toBe(2)
      expect(events[1].version).toBe(3)
    })

    it('combines multiple filters', async () => {
      const allEvents = await ctx.$.Order('ord-filter').events()

      const events = await ctx.$.Order('ord-filter').events({
        fromVersion: 2,
        limit: 2,
      })

      expect(events).toHaveLength(2)
      expect(events[0].version).toBe(2)
    })
  })
})

// ============================================================================
// TEST SUITE: Aggregate Definitions
// ============================================================================

describe('Entity Events - Aggregate Definitions', () => {
  let ctx: EntityEventContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  // --------------------------------------------------------------------------
  // $.aggregate(entityType, config)
  // --------------------------------------------------------------------------

  describe('$.aggregate(entityType, config)', () => {
    it('defines an aggregate with initial state', () => {
      ctx.$.aggregate('Customer', {
        initial: (): CustomerState => ({
          email: '',
          name: '',
          plan: 'free',
          verified: false,
          status: 'active',
        }),
        reduce: {},
      })

      // Should be registered
      expect(ctx.hasAggregate('Customer')).toBe(true)
    })

    it('defines reducers for event types', () => {
      ctx.$.aggregate('Customer', {
        initial: () => ({ status: 'pending' }),
        reduce: {
          'Customer.signup': (state, event) => ({
            ...state,
            email: event.data.email,
            status: 'active',
          }),
          'Customer.verified': (state) => ({
            ...state,
            verified: true,
          }),
        },
      })

      expect(ctx.hasAggregate('Customer')).toBe(true)
    })

    it('throws if aggregate already defined', () => {
      ctx.$.aggregate('Duplicate', {
        initial: () => ({}),
        reduce: {},
      })

      expect(() =>
        ctx.$.aggregate('Duplicate', {
          initial: () => ({}),
          reduce: {},
        })
      ).toThrow(/already defined/i)
    })

    it('allows overwriting aggregate with force option', () => {
      ctx.$.aggregate('Overwrite', {
        initial: () => ({ version: 1 }),
        reduce: {},
      })

      expect(() =>
        ctx.$.aggregate(
          'Overwrite',
          {
            initial: () => ({ version: 2 }),
            reduce: {},
          },
          { force: true }
        )
      ).not.toThrow()
    })
  })

  describe('Reducer Behavior', () => {
    it('reducer receives current state and event', async () => {
      const reducerSpy = vi.fn((state, event) => ({
        ...state,
        processed: true,
        eventType: event.type,
      }))

      ctx.$.aggregate('SpyEntity', {
        initial: () => ({ processed: false }),
        reduce: {
          'SpyEntity.action': reducerSpy,
        },
      })

      await ctx.$.SpyEntity('spy-1').append('action', { value: 42 })
      await ctx.$.SpyEntity('spy-1').state()

      expect(reducerSpy).toHaveBeenCalled()
      expect(reducerSpy.mock.calls[0][0]).toEqual({ processed: false })
      expect(reducerSpy.mock.calls[0][1].type).toBe('SpyEntity.action')
      expect(reducerSpy.mock.calls[0][1].data.value).toBe(42)
    })

    it('reducers are called in event order', async () => {
      const callOrder: number[] = []

      ctx.$.aggregate('OrderedEntity', {
        initial: () => ({ calls: [] }),
        reduce: {
          'OrderedEntity.first': (state) => {
            callOrder.push(1)
            return { ...state, calls: [...state.calls, 1] }
          },
          'OrderedEntity.second': (state) => {
            callOrder.push(2)
            return { ...state, calls: [...state.calls, 2] }
          },
          'OrderedEntity.third': (state) => {
            callOrder.push(3)
            return { ...state, calls: [...state.calls, 3] }
          },
        },
      })

      await ctx.$.OrderedEntity('oe-1').append('first', {})
      await ctx.$.OrderedEntity('oe-1').append('second', {})
      await ctx.$.OrderedEntity('oe-1').append('third', {})

      await ctx.$.OrderedEntity('oe-1').state()

      expect(callOrder).toEqual([1, 2, 3])
    })

    it('handles async reducers', async () => {
      ctx.$.aggregate('AsyncEntity', {
        initial: () => ({ value: 0 }),
        reduce: {
          'AsyncEntity.compute': async (state, event) => {
            await delay(10)
            return { ...state, value: event.data.input * 2 }
          },
        },
      })

      await ctx.$.AsyncEntity('async-1').append('compute', { input: 21 })
      const state = await ctx.$.AsyncEntity('async-1').state()

      expect(state.value).toBe(42)
    })
  })
})

// ============================================================================
// TEST SUITE: Snapshots
// ============================================================================

describe('Entity Events - Snapshots', () => {
  let ctx: EntityEventContext

  beforeEach(() => {
    ctx = createTestContext()

    ctx.$.aggregate('Order', {
      initial: (): Partial<OrderState> => ({
        status: 'pending',
        items: [],
        total: 0,
      }),
      reduce: {
        'Order.created': (state, event) => ({ ...state, ...event.data, status: 'created' }),
        'Order.itemAdded': (state, event) => ({
          ...state,
          items: [...(state.items || []), event.data.item],
          total: (state.total || 0) + event.data.item.price * event.data.item.qty,
        }),
        'Order.paid': (state) => ({ ...state, status: 'paid' }),
      },
      // Configure snapshots
      snapshots: {
        every: 100, // Snapshot every 100 events
      },
    })
  })

  describe('Automatic Snapshotting', () => {
    it('creates snapshot after configured number of events', async () => {
      const orderId = 'ord-snapshot'

      // Add 100 events
      await ctx.$.Order(orderId).append('created', { customerId: 'c1' })
      for (let i = 0; i < 99; i++) {
        await ctx.$.Order(orderId).append('itemAdded', {
          item: { sku: `SKU-${i}`, qty: 1, price: 10 },
        })
      }

      // Should have created a snapshot
      const snapshots = await ctx.$.Order(orderId).listSnapshots()
      expect(snapshots.length).toBeGreaterThan(0)
    })

    it('uses snapshot for faster state reconstruction', async () => {
      const orderId = 'ord-fast'

      // Create snapshot at version 100
      await ctx.$.Order(orderId).append('created', {})
      for (let i = 0; i < 99; i++) {
        await ctx.$.Order(orderId).append('itemAdded', {
          item: { sku: `SKU-${i}`, qty: 1, price: 10 },
        })
      }

      // Add more events after snapshot
      for (let i = 0; i < 50; i++) {
        await ctx.$.Order(orderId).append('itemAdded', {
          item: { sku: `SKU-AFTER-${i}`, qty: 1, price: 5 },
        })
      }

      // State reconstruction should only replay 50 events, not 150
      const start = performance.now()
      const state = await ctx.$.Order(orderId).state()
      const duration = performance.now() - start

      // State should include all items
      expect(state.items.length).toBe(149)
      expect(state.total).toBe(99 * 10 + 50 * 5)

      // Performance assertion (should be faster with snapshot)
      expect(duration).toBeLessThan(500) // 500ms max
    })

    it('snapshot contains complete state at that point', async () => {
      const orderId = 'ord-complete'

      await ctx.$.Order(orderId).append('created', { customerId: 'c-complete' })
      for (let i = 0; i < 99; i++) {
        await ctx.$.Order(orderId).append('itemAdded', {
          item: { sku: `SKU-${i}`, qty: 1, price: 10 },
        })
      }

      const snapshots = await ctx.$.Order(orderId).listSnapshots()
      const snapshotState = await ctx.$.Order(orderId).getSnapshot(snapshots[0].id)

      expect(snapshotState.customerId).toBe('c-complete')
      expect(snapshotState.items).toHaveLength(99)
    })
  })

  describe('Manual Snapshotting', () => {
    it('allows manual snapshot creation', async () => {
      const orderId = 'ord-manual'

      await ctx.$.Order(orderId).append('created', {})
      await ctx.$.Order(orderId).append('paid', {})

      const snapshotId = await ctx.$.Order(orderId).createSnapshot()

      expect(snapshotId).toBeDefined()
      expect(typeof snapshotId).toBe('string')
    })

    it('restores state from manual snapshot', async () => {
      const orderId = 'ord-restore'

      await ctx.$.Order(orderId).append('created', { customerId: 'c-restore' })
      const snapshotId = await ctx.$.Order(orderId).createSnapshot()

      // Add more events
      await ctx.$.Order(orderId).append('paid', {})

      // Get state at snapshot
      const snapshotState = await ctx.$.Order(orderId).getSnapshot(snapshotId)

      expect(snapshotState.status).toBe('created')
      expect(snapshotState.customerId).toBe('c-restore')
    })
  })

  describe('Snapshot Configuration', () => {
    it('respects custom snapshot interval', async () => {
      ctx.$.aggregate(
        'FrequentSnapshot',
        {
          initial: () => ({ count: 0 }),
          reduce: {
            'FrequentSnapshot.increment': (state) => ({ count: state.count + 1 }),
          },
          snapshots: { every: 10 },
        },
        { force: true }
      )

      for (let i = 0; i < 25; i++) {
        await ctx.$.FrequentSnapshot('freq-1').append('increment', {})
      }

      const snapshots = await ctx.$.FrequentSnapshot('freq-1').listSnapshots()
      expect(snapshots.length).toBe(2) // At version 10 and 20
    })

    it('allows disabling automatic snapshots', async () => {
      ctx.$.aggregate(
        'NoSnapshot',
        {
          initial: () => ({ count: 0 }),
          reduce: {
            'NoSnapshot.increment': (state) => ({ count: state.count + 1 }),
          },
          snapshots: { every: 0 }, // Disabled
        },
        { force: true }
      )

      for (let i = 0; i < 200; i++) {
        await ctx.$.NoSnapshot('no-snap-1').append('increment', {})
      }

      const snapshots = await ctx.$.NoSnapshot('no-snap-1').listSnapshots()
      expect(snapshots).toHaveLength(0)
    })
  })
})

// ============================================================================
// TEST SUITE: Time-Travel
// ============================================================================

describe('Entity Events - Time-Travel', () => {
  let ctx: EntityEventContext

  beforeEach(() => {
    ctx = createTestContext()

    ctx.$.aggregate('Order', {
      initial: (): Partial<OrderState> => ({
        status: 'pending',
        total: 0,
      }),
      reduce: {
        'Order.created': (state, event) => ({
          ...state,
          ...event.data,
          status: 'created',
        }),
        'Order.paid': (state, event) => ({
          ...state,
          status: 'paid',
          paymentId: event.data.paymentId,
        }),
        'Order.shipped': (state, event) => ({
          ...state,
          status: 'shipped',
          trackingNumber: event.data.trackingNumber,
        }),
        'Order.delivered': (state) => ({
          ...state,
          status: 'delivered',
        }),
      },
    })
  })

  // --------------------------------------------------------------------------
  // $.Entity(id).stateAt(timestamp)
  // --------------------------------------------------------------------------

  describe('$.Entity(id).stateAt(timestamp)', () => {
    it('returns state as it existed at a specific timestamp', async () => {
      const orderId = 'ord-time-travel'

      await ctx.$.Order(orderId).append('created', { customerId: 'c1', total: 100 })
      await delay(50)
      const afterCreated = new Date()

      await delay(50)
      await ctx.$.Order(orderId).append('paid', { paymentId: 'pay_1' })
      await delay(50)
      const afterPaid = new Date()

      await delay(50)
      await ctx.$.Order(orderId).append('shipped', { trackingNumber: 'TRK1' })

      // State at afterCreated should be 'created'
      const stateAtCreated = await ctx.$.Order(orderId).stateAt(afterCreated)
      expect(stateAtCreated.status).toBe('created')
      expect(stateAtCreated.paymentId).toBeUndefined()

      // State at afterPaid should be 'paid'
      const stateAtPaid = await ctx.$.Order(orderId).stateAt(afterPaid)
      expect(stateAtPaid.status).toBe('paid')
      expect(stateAtPaid.trackingNumber).toBeUndefined()

      // Current state should be 'shipped'
      const currentState = await ctx.$.Order(orderId).state()
      expect(currentState.status).toBe('shipped')
    })

    it('returns initial state for timestamp before first event', async () => {
      const beforeCreation = new Date()
      await delay(50)

      await ctx.$.Order('ord-before').append('created', { total: 100 })

      const state = await ctx.$.Order('ord-before').stateAt(beforeCreation)
      expect(state.status).toBe('pending')
      expect(state.total).toBe(0)
    })

    it('returns current state for future timestamp', async () => {
      await ctx.$.Order('ord-future').append('created', { total: 100 })
      await ctx.$.Order('ord-future').append('paid', {})

      const futureDate = new Date(Date.now() + 86400000) // Tomorrow
      const state = await ctx.$.Order('ord-future').stateAt(futureDate)

      expect(state.status).toBe('paid')
    })

    it('handles exact timestamp match', async () => {
      await ctx.$.Order('ord-exact').append('created', {})
      const events = await ctx.$.Order('ord-exact').events()
      const exactTimestamp = events[0].timestamp

      const state = await ctx.$.Order('ord-exact').stateAt(exactTimestamp)
      expect(state.status).toBe('created')
    })

    it('supports Date object and number timestamp', async () => {
      await ctx.$.Order('ord-ts-types').append('created', {})
      await delay(50)
      const now = new Date()

      // Using Date object
      const state1 = await ctx.$.Order('ord-ts-types').stateAt(now)

      // Using number (milliseconds)
      const state2 = await ctx.$.Order('ord-ts-types').stateAt(now.getTime())

      // Using ISO string
      const state3 = await ctx.$.Order('ord-ts-types').stateAt(now.toISOString())

      expect(state1).toEqual(state2)
      expect(state2).toEqual(state3)
    })
  })

  describe('Time-Travel with Snapshots', () => {
    it('uses nearest snapshot before target timestamp', async () => {
      // Create entity with many events and snapshots
      ctx.$.aggregate(
        'Counter',
        {
          initial: () => ({ value: 0 }),
          reduce: {
            'Counter.increment': (state) => ({ value: state.value + 1 }),
          },
          snapshots: { every: 50 },
        },
        { force: true }
      )

      const timestamps: Date[] = []

      for (let i = 0; i < 150; i++) {
        await ctx.$.Counter('counter-1').append('increment', {})
        if (i === 75) {
          await delay(10)
          timestamps.push(new Date())
          await delay(10)
        }
      }

      // Query state at version ~75
      const state = await ctx.$.Counter('counter-1').stateAt(timestamps[0])

      // Should use snapshot at 50, then replay events 51-75
      expect(state.value).toBeLessThanOrEqual(76)
      expect(state.value).toBeGreaterThanOrEqual(75)
    })
  })
})

// ============================================================================
// TEST SUITE: Projections
// ============================================================================

describe('Entity Events - Projections', () => {
  let ctx: EntityEventContext

  beforeEach(() => {
    ctx = createTestContext()

    // Define Order aggregate
    ctx.$.aggregate('Order', {
      initial: () => ({ status: 'pending', customerId: '' }),
      reduce: {
        'Order.created': (state, event) => ({
          ...state,
          customerId: event.data.customerId,
          status: 'created',
        }),
        'Order.shipped': (state) => ({ ...state, status: 'shipped' }),
      },
    })
  })

  // --------------------------------------------------------------------------
  // $.projection(name, config)
  // --------------------------------------------------------------------------

  describe('$.projection(name, config)', () => {
    it('defines a projection across entity events', () => {
      ctx.$.projection('OrdersByCustomer', {
        from: ['Order.*'],
        handle: {
          'Order.created': async (event, { upsert }) => {
            await upsert(`customer:${event.data.customerId}:orders`, (orders = []) => [
              ...orders,
              { orderId: event.entityId, status: 'created' },
            ])
          },
        },
      })

      expect(ctx.hasProjection('OrdersByCustomer')).toBe(true)
    })

    it('projection handlers receive events from matching entities', async () => {
      const handlerSpy = vi.fn()

      ctx.$.projection('OrderSpy', {
        from: ['Order.created'],
        handle: {
          'Order.created': handlerSpy,
        },
      })

      await ctx.$.Order('ord-spy').append('created', { customerId: 'c-spy' })

      // Wait for projection to process
      await ctx.$.projection('OrderSpy').process()

      expect(handlerSpy).toHaveBeenCalled()
      expect(handlerSpy.mock.calls[0][0].data.customerId).toBe('c-spy')
    })

    it('projection builds derived state from events', async () => {
      ctx.$.projection('OrdersByCustomer', {
        from: ['Order.*'],
        handle: {
          'Order.created': async (event, { upsert }) => {
            await upsert(`customer:${event.data.customerId}:orders`, (orders = []) => [
              ...orders,
              { orderId: event.entityId, status: 'created', createdAt: event.timestamp },
            ])
          },
          'Order.shipped': async (event, { upsert }) => {
            await upsert(`customer:${event.data.customerId}:orders`, (orders) =>
              orders.map((o: any) => (o.orderId === event.entityId ? { ...o, status: 'shipped' } : o))
            )
          },
        },
      })

      // Create orders for a customer
      await ctx.$.Order('ord-1').append('created', { customerId: 'cust-A' })
      await ctx.$.Order('ord-2').append('created', { customerId: 'cust-A' })
      await ctx.$.Order('ord-1').append('shipped', { customerId: 'cust-A' })

      await ctx.$.projection('OrdersByCustomer').process()

      // Query projection
      const customerOrders = await ctx.$.projection('OrdersByCustomer').get('customer:cust-A:orders')

      expect(customerOrders).toHaveLength(2)
      expect(customerOrders.find((o: any) => o.orderId === 'ord-1')?.status).toBe('shipped')
      expect(customerOrders.find((o: any) => o.orderId === 'ord-2')?.status).toBe('created')
    })
  })

  describe('Projection Utilities', () => {
    beforeEach(() => {
      ctx.$.projection('TestProjection', {
        from: ['Order.*'],
        handle: {
          'Order.created': async (event, { set }) => {
            await set(`order:${event.entityId}`, { status: 'created' })
          },
        },
      })
    })

    it('upsert creates or updates a key', async () => {
      ctx.$.projection('UpsertTest', {
        from: ['Order.*'],
        handle: {
          'Order.created': async (event, { upsert }) => {
            await upsert('counter', (count = 0) => count + 1)
          },
        },
      })

      await ctx.$.Order('o1').append('created', {})
      await ctx.$.Order('o2').append('created', {})
      await ctx.$.Order('o3').append('created', {})

      await ctx.$.projection('UpsertTest').process()

      const count = await ctx.$.projection('UpsertTest').get('counter')
      expect(count).toBe(3)
    })

    it('set overwrites a key', async () => {
      await ctx.$.Order('o-set').append('created', {})
      await ctx.$.projection('TestProjection').process()

      const value = await ctx.$.projection('TestProjection').get('order:o-set')
      expect(value).toEqual({ status: 'created' })
    })

    it('delete removes a key', async () => {
      ctx.$.projection('DeleteTest', {
        from: ['Order.*'],
        handle: {
          'Order.created': async (event, { set }) => {
            await set(`order:${event.entityId}`, { exists: true })
          },
          'Order.cancelled': async (event, { del }) => {
            await del(`order:${event.entityId}`)
          },
        },
      })

      await ctx.$.Order('o-del').append('created', {})
      await ctx.$.projection('DeleteTest').process()

      let value = await ctx.$.projection('DeleteTest').get('order:o-del')
      expect(value).toEqual({ exists: true })

      // Add cancelled event
      ctx.$.aggregate(
        'Order',
        {
          initial: () => ({}),
          reduce: {
            ...ctx.getAggregate('Order').reduce,
            'Order.cancelled': (state) => ({ ...state, status: 'cancelled' }),
          },
        },
        { force: true }
      )

      await ctx.$.Order('o-del').append('cancelled', {})
      await ctx.$.projection('DeleteTest').process()

      value = await ctx.$.projection('DeleteTest').get('order:o-del')
      expect(value).toBeUndefined()
    })
  })

  describe('Projection Queries', () => {
    beforeEach(async () => {
      ctx.$.projection('CustomerStats', {
        from: ['Order.*'],
        handle: {
          'Order.created': async (event, { upsert }) => {
            await upsert(`stats:${event.data.customerId}`, (stats = { orderCount: 0, total: 0 }) => ({
              orderCount: stats.orderCount + 1,
              total: stats.total + (event.data.total || 0),
            }))
          },
        },
      })

      // Create test orders
      await ctx.$.Order('o1').append('created', { customerId: 'c1', total: 100 })
      await ctx.$.Order('o2').append('created', { customerId: 'c1', total: 150 })
      await ctx.$.Order('o3').append('created', { customerId: 'c2', total: 200 })

      await ctx.$.projection('CustomerStats').process()
    })

    it('queries projection by key', async () => {
      const stats = await ctx.$.projection('CustomerStats').get('stats:c1')

      expect(stats.orderCount).toBe(2)
      expect(stats.total).toBe(250)
    })

    it('queries projection with prefix', async () => {
      const allStats = await ctx.$.projection('CustomerStats').list({ prefix: 'stats:' })

      expect(allStats.length).toBe(2)
    })

    it('returns undefined for non-existent key', async () => {
      const stats = await ctx.$.projection('CustomerStats').get('stats:nonexistent')

      expect(stats).toBeUndefined()
    })
  })

  describe('Projection Lifecycle', () => {
    it('rebuilds projection from scratch', async () => {
      ctx.$.projection('RebuildTest', {
        from: ['Order.*'],
        handle: {
          'Order.created': async (event, { upsert }) => {
            await upsert('count', (n = 0) => n + 1)
          },
        },
      })

      await ctx.$.Order('o1').append('created', {})
      await ctx.$.Order('o2').append('created', {})
      await ctx.$.projection('RebuildTest').process()

      expect(await ctx.$.projection('RebuildTest').get('count')).toBe(2)

      // Rebuild from scratch
      await ctx.$.projection('RebuildTest').rebuild()

      expect(await ctx.$.projection('RebuildTest').get('count')).toBe(2)
    })

    it('tracks projection position in event stream', async () => {
      ctx.$.projection('PositionTest', {
        from: ['Order.*'],
        handle: {
          'Order.created': async () => {},
        },
      })

      await ctx.$.Order('o1').append('created', {})
      await ctx.$.projection('PositionTest').process()

      const position1 = await ctx.$.projection('PositionTest').getPosition()

      await ctx.$.Order('o2').append('created', {})
      await ctx.$.projection('PositionTest').process()

      const position2 = await ctx.$.projection('PositionTest').getPosition()

      expect(position2).toBeGreaterThan(position1)
    })
  })
})

// ============================================================================
// TEST SUITE: Error Handling
// ============================================================================

describe('Entity Events - Error Handling', () => {
  let ctx: EntityEventContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  describe('Append Errors', () => {
    it('throws on invalid entity ID', async () => {
      await expect(ctx.$.Order('').append('created', {})).rejects.toThrow(/invalid.*id/i)
    })

    it('throws on empty event type', async () => {
      await expect(ctx.$.Order('ord-1').append('', {})).rejects.toThrow(/event type/i)
    })

    it('handles storage failures gracefully', async () => {
      // Simulate storage failure
      ctx._simulateStorageFailure(true)

      await expect(ctx.$.Order('ord-fail').append('created', {})).rejects.toThrow(/storage/i)

      ctx._simulateStorageFailure(false)
    })
  })

  describe('State Reconstruction Errors', () => {
    it('handles corrupted event data', async () => {
      // Inject corrupted event directly
      await ctx._injectCorruptedEvent('Order', 'ord-corrupt', {
        type: 'Order.created',
        data: null, // Invalid data
        version: 1,
      })

      // Should handle gracefully
      await expect(ctx.$.Order('ord-corrupt').state()).rejects.toThrow(/corrupted/i)
    })

    it('handles reducer errors', async () => {
      ctx.$.aggregate('FailingEntity', {
        initial: () => ({}),
        reduce: {
          'FailingEntity.fail': () => {
            throw new Error('Reducer failed!')
          },
        },
      })

      await ctx.$.FailingEntity('fe-1').append('fail', {})

      await expect(ctx.$.FailingEntity('fe-1').state()).rejects.toThrow('Reducer failed!')
    })
  })

  describe('Projection Errors', () => {
    it('handles projection handler errors', async () => {
      ctx.$.projection('FailingProjection', {
        from: ['Order.*'],
        handle: {
          'Order.created': async () => {
            throw new Error('Projection handler failed!')
          },
        },
      })

      await ctx.$.Order('o1').append('created', {})

      await expect(ctx.$.projection('FailingProjection').process()).rejects.toThrow(
        'Projection handler failed!'
      )
    })

    it('continues processing after error with skip option', async () => {
      let processedCount = 0

      ctx.$.projection('SkipErrors', {
        from: ['Order.*'],
        handle: {
          'Order.created': async (event) => {
            if (event.entityId === 'o2') {
              throw new Error('Skip this one')
            }
            processedCount++
          },
        },
        onError: 'skip',
      })

      await ctx.$.Order('o1').append('created', {})
      await ctx.$.Order('o2').append('created', {})
      await ctx.$.Order('o3').append('created', {})

      await ctx.$.projection('SkipErrors').process()

      expect(processedCount).toBe(2)
    })
  })
})

// ============================================================================
// TEST SUITE: Performance
// ============================================================================

describe('Entity Events - Performance', () => {
  let ctx: EntityEventContext

  beforeEach(() => {
    ctx = createTestContext()

    ctx.$.aggregate('Counter', {
      initial: () => ({ value: 0 }),
      reduce: {
        'Counter.increment': (state, event) => ({
          value: state.value + (event.data.amount || 1),
        }),
      },
      snapshots: { every: 1000 },
    })
  })

  describe('Large Event Counts', () => {
    it.skip('handles 10,000 events efficiently', async () => {
      const counterId = 'counter-10k'

      const start = performance.now()

      for (let i = 0; i < 10000; i++) {
        await ctx.$.Counter(counterId).append('increment', { amount: 1 })
      }

      const appendTime = performance.now() - start

      const stateStart = performance.now()
      const state = await ctx.$.Counter(counterId).state()
      const stateTime = performance.now() - stateStart

      expect(state.value).toBe(10000)
      expect(appendTime).toBeLessThan(10000) // 10 seconds max
      expect(stateTime).toBeLessThan(2000) // 2 seconds max with snapshots
    })

    it.skip('batches events for better performance', async () => {
      const counterId = 'counter-batch'

      const events = Array.from({ length: 1000 }, (_, i) => ({
        type: 'increment',
        data: { amount: i + 1 },
      }))

      const start = performance.now()
      await ctx.$.Counter(counterId).appendBatch(events)
      const batchTime = performance.now() - start

      const state = await ctx.$.Counter(counterId).state()

      // Sum of 1..1000 = 500500
      expect(state.value).toBe(500500)
      expect(batchTime).toBeLessThan(2000)
    })
  })

  describe('Concurrent Operations', () => {
    it('handles concurrent appends to same entity', async () => {
      const counterId = 'counter-concurrent'

      await Promise.all(
        Array.from({ length: 100 }, () => ctx.$.Counter(counterId).append('increment', { amount: 1 }))
      )

      const state = await ctx.$.Counter(counterId).state()
      expect(state.value).toBe(100)
    })

    it('handles concurrent state queries', async () => {
      const counterId = 'counter-query'

      for (let i = 0; i < 100; i++) {
        await ctx.$.Counter(counterId).append('increment', { amount: 1 })
      }

      const states = await Promise.all(
        Array.from({ length: 10 }, () => ctx.$.Counter(counterId).state())
      )

      states.forEach((state) => {
        expect(state.value).toBe(100)
      })
    })
  })
})

// ============================================================================
// TEST SUITE: Integration with $ Context
// ============================================================================

describe('Entity Events - Integration with $ Context', () => {
  let ctx: EntityEventContext

  beforeEach(() => {
    ctx = createTestContext()

    ctx.$.aggregate('Order', {
      initial: () => ({ status: 'pending' }),
      reduce: {
        'Order.created': (state, event) => ({ ...state, ...event.data, status: 'created' }),
        'Order.completed': (state) => ({ ...state, status: 'completed' }),
      },
    })
  })

  describe('Event Handler Integration', () => {
    it('$.on handlers receive entity events', async () => {
      const handler = vi.fn()

      ctx.$.on.Order.created(handler)

      await ctx.$.Order('ord-handler').append('created', { total: 100 })

      // Handler should be called with the event
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'Order.created',
          data: { total: 100 },
        })
      )
    })

    it('$.on handlers can append follow-up events', async () => {
      ctx.$.on.Order.created(async (event) => {
        if (event.data.total === 0) {
          await ctx.$.Order(event.entityId).append('completed', {})
        }
      })

      await ctx.$.Order('ord-auto-complete').append('created', { total: 0 })

      const events = await ctx.$.Order('ord-auto-complete').events()
      expect(events).toHaveLength(2)
      expect(events[1].type).toBe('Order.completed')
    })
  })

  describe('$.do Integration', () => {
    it('append within $.do is durable', async () => {
      await ctx.$.do(async () => {
        await ctx.$.Order('ord-durable').append('created', { total: 100 })
        await ctx.$.Order('ord-durable').append('completed', {})
      })

      const events = await ctx.$.Order('ord-durable').events()
      expect(events).toHaveLength(2)
    })

    it('append within $.do rolls back on failure', async () => {
      try {
        await ctx.$.do(async () => {
          await ctx.$.Order('ord-rollback').append('created', { total: 100 })
          throw new Error('Transaction failed!')
        })
      } catch {
        // Expected
      }

      const events = await ctx.$.Order('ord-rollback').events()
      expect(events).toHaveLength(0)
    })
  })
})

// ============================================================================
// TEST SUITE: Type Safety
// ============================================================================

describe('Entity Events - Type Safety', () => {
  let ctx: EntityEventContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  describe('Typed Aggregates', () => {
    it('infers state type from aggregate definition', async () => {
      ctx.$.aggregate<OrderState>('TypedOrder', {
        initial: (): OrderState => ({
          customerId: '',
          items: [],
          total: 0,
          status: 'pending',
        }),
        reduce: {
          'TypedOrder.created': (state: OrderState, event): OrderState => ({
            ...state,
            customerId: event.data.customerId,
            status: 'created',
          }),
        },
      })

      await ctx.$.TypedOrder('to-1').append('created', { customerId: 'c1' })

      const state = await ctx.$.TypedOrder('to-1').state<OrderState>()

      // Type inference should work
      const customerId: string = state.customerId
      const status: 'pending' | 'created' | 'paid' | 'shipped' | 'delivered' = state.status

      expect(customerId).toBe('c1')
      expect(status).toBe('created')
    })

    it('typed event data in append', async () => {
      interface CreateOrderEvent {
        customerId: string
        items: Array<{ sku: string; qty: number }>
        total: number
      }

      ctx.$.aggregate('TypedOrder2', {
        initial: () => ({}),
        reduce: {},
      })

      // Type-safe append
      const eventData: CreateOrderEvent = {
        customerId: 'c2',
        items: [{ sku: 'X', qty: 1 }],
        total: 99,
      }

      await ctx.$.TypedOrder2('to-2').append<CreateOrderEvent>('created', eventData)

      const events = await ctx.$.TypedOrder2('to-2').events()
      expect(events[0].data.customerId).toBe('c2')
    })
  })
})

// ============================================================================
// TEST SUITE: Edge Cases
// ============================================================================

describe('Entity Events - Edge Cases', () => {
  let ctx: EntityEventContext

  beforeEach(() => {
    ctx = createTestContext()

    ctx.$.aggregate('Entity', {
      initial: () => ({ data: null }),
      reduce: {
        'Entity.set': (state, event) => ({ data: event.data.value }),
      },
    })
  })

  describe('Special Values', () => {
    it('handles null data', async () => {
      await ctx.$.Entity('e-null').append('set', { value: null })

      const state = await ctx.$.Entity('e-null').state()
      expect(state.data).toBeNull()
    })

    it('handles undefined data fields', async () => {
      await ctx.$.Entity('e-undef').append('set', { value: undefined })

      const state = await ctx.$.Entity('e-undef').state()
      expect(state.data).toBeUndefined()
    })

    it('handles empty object', async () => {
      await ctx.$.Entity('e-empty').append('set', {})

      const events = await ctx.$.Entity('e-empty').events()
      expect(events[0].data).toEqual({})
    })

    it('handles very large data', async () => {
      const largeData = { value: 'x'.repeat(100000) }

      await ctx.$.Entity('e-large').append('set', largeData)

      const events = await ctx.$.Entity('e-large').events()
      expect(events[0].data.value.length).toBe(100000)
    })

    it('handles deeply nested data', async () => {
      let nested: any = { value: 'deep' }
      for (let i = 0; i < 50; i++) {
        nested = { child: nested }
      }

      await ctx.$.Entity('e-deep').append('set', { value: nested })

      const events = await ctx.$.Entity('e-deep').events()
      let current = events[0].data.value
      for (let i = 0; i < 50; i++) {
        current = current.child
      }
      expect(current.value).toBe('deep')
    })
  })

  describe('Entity ID Edge Cases', () => {
    it('handles entity ID with special characters', async () => {
      const specialIds = [
        'id-with-dashes',
        'id_with_underscores',
        'id.with.dots',
        'id:with:colons',
        'id/with/slashes',
        'id@with@at',
      ]

      for (const id of specialIds) {
        await ctx.$.Entity(id).append('set', { value: id })
        const state = await ctx.$.Entity(id).state()
        expect(state.data).toBe(id)
      }
    })

    it('handles very long entity ID', async () => {
      const longId = 'x'.repeat(1000)

      await ctx.$.Entity(longId).append('set', { value: 'long-id' })

      const state = await ctx.$.Entity(longId).state()
      expect(state.data).toBe('long-id')
    })

    it('handles unicode entity ID', async () => {
      const unicodeId = '\u{1F600}-emoji-id'

      await ctx.$.Entity(unicodeId).append('set', { value: 'unicode' })

      const state = await ctx.$.Entity(unicodeId).state()
      expect(state.data).toBe('unicode')
    })
  })

  describe('Event Type Edge Cases', () => {
    it('handles event type with dots', async () => {
      ctx.$.aggregate('Complex', {
        initial: () => ({ type: '' }),
        reduce: {
          'Complex.nested.event.type': (state, event) => ({
            type: event.data.value,
          }),
        },
      })

      await ctx.$.Complex('c-1').append('nested.event.type', { value: 'nested' })

      const state = await ctx.$.Complex('c-1').state()
      expect(state.type).toBe('nested')
    })
  })
})
