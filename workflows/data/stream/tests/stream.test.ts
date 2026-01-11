/**
 * RED Phase Tests for Stream Processing API ($.stream)
 *
 * These tests define the expected behavior of the $.stream namespace for
 * real-time stream processing. They will FAIL until the implementation is created.
 *
 * The $.stream API provides:
 * - Stream sources from domain events, tracked events, and measurements
 * - Transformations: filter(), map(), enrich()
 * - Keyed streams via keyBy()
 * - Windowing: tumbling, sliding, session windows
 * - Aggregations within windows
 * - Stream joins with temporal constraints
 * - Sinks to track, measure, and view
 *
 * @see docs/plans/2026-01-11-data-api-design.md
 * @module workflows/data/stream/tests/stream
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Import the stream API (will fail - module doesn't exist yet)
import {
  createStreamContext,
  type StreamContext,
  type Stream,
  type KeyedStream,
  type WindowedStream,
  type StreamSource,
  type StreamSink,
  type JoinedStream,
  type AggregateSpec,
  type WindowSpec,
} from '../../stream'

// ============================================================================
// Test Fixtures
// ============================================================================

interface Order {
  orderId: string
  customerId: string
  total: number
  region: string
  timestamp: number
  items: Array<{ sku: string; qty: number; price: number }>
}

interface Payment {
  paymentId: string
  orderId: string
  amount: number
  method: 'card' | 'bank' | 'crypto'
  timestamp: number
}

interface Customer {
  customerId: string
  name: string
  tier: 'bronze' | 'silver' | 'gold'
  email: string
}

interface PageView {
  userId: string
  path: string
  referrer?: string
  timestamp: number
}

interface Signup {
  userId: string
  plan: 'free' | 'pro' | 'enterprise'
  source: string
  timestamp: number
}

const BASE_TIME = 1704067200000 // 2024-01-01 00:00:00 UTC

function ts(offsetMs: number): number {
  return BASE_TIME + offsetMs
}

function createOrder(overrides: Partial<Order> = {}): Order {
  return {
    orderId: `order-${Math.random().toString(36).slice(2, 8)}`,
    customerId: 'customer-123',
    total: 100,
    region: 'us-east',
    timestamp: ts(0),
    items: [{ sku: 'widget-1', qty: 1, price: 100 }],
    ...overrides,
  }
}

function createPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    paymentId: `pay-${Math.random().toString(36).slice(2, 8)}`,
    orderId: 'order-123',
    amount: 100,
    method: 'card',
    timestamp: ts(0),
    ...overrides,
  }
}

// ============================================================================
// Stream Source Tests
// ============================================================================

describe('$.stream - Stream Sources', () => {
  let $: StreamContext

  beforeEach(() => {
    $ = createStreamContext()
  })

  describe('$.stream.from.Entity.event - Domain Events', () => {
    it('creates a stream from domain events', () => {
      const stream = $.stream.from.Order.created

      expect(stream).toBeDefined()
      expect(stream.type).toBe('stream')
      expect(stream.source.entity).toBe('Order')
      expect(stream.source.event).toBe('created')
    })

    it('creates streams for different entity types', () => {
      const orderStream = $.stream.from.Order.created
      const customerStream = $.stream.from.Customer.signup
      const paymentStream = $.stream.from.Payment.completed

      expect(orderStream.source.entity).toBe('Order')
      expect(customerStream.source.entity).toBe('Customer')
      expect(paymentStream.source.entity).toBe('Payment')
    })

    it('supports wildcard event matching', () => {
      // All 'created' events across all entities
      const createdStream = $.stream.from['*'].created

      expect(createdStream).toBeDefined()
      expect(createdStream.source.entity).toBe('*')
      expect(createdStream.source.event).toBe('created')
    })

    it('supports wildcard entity matching', () => {
      // All events from Order entity
      const allOrderEvents = $.stream.from.Order['*']

      expect(allOrderEvents).toBeDefined()
      expect(allOrderEvents.source.entity).toBe('Order')
      expect(allOrderEvents.source.event).toBe('*')
    })

    it('stream source is immutable', () => {
      const stream = $.stream.from.Order.created

      // Attempting to modify should not affect original
      expect(() => {
        ;(stream.source as any).entity = 'Modified'
      }).toThrow()
    })
  })

  describe('$.stream.from.track.Event - Tracked Events', () => {
    it('creates a stream from tracked events', () => {
      const stream = $.stream.from.track.Purchase

      expect(stream).toBeDefined()
      expect(stream.source.type).toBe('track')
      expect(stream.source.event).toBe('Purchase')
    })

    it('creates streams for different tracked event types', () => {
      const purchaseStream = $.stream.from.track.Purchase
      const pageViewStream = $.stream.from.track.PageView
      const signupStream = $.stream.from.track.Signup

      expect(purchaseStream.source.event).toBe('Purchase')
      expect(pageViewStream.source.event).toBe('PageView')
      expect(signupStream.source.event).toBe('Signup')
    })
  })

  describe('$.stream.from.measure.Metric - Measurements', () => {
    it('creates a stream from measurements', () => {
      const stream = $.stream.from.measure.revenue

      expect(stream).toBeDefined()
      expect(stream.source.type).toBe('measure')
      expect(stream.source.metric).toBe('revenue')
    })

    it('creates streams for different metrics', () => {
      const revenueStream = $.stream.from.measure.revenue
      const latencyStream = $.stream.from.measure.latency
      const cpuStream = $.stream.from.measure.cpu

      expect(revenueStream.source.metric).toBe('revenue')
      expect(latencyStream.source.metric).toBe('latency')
      expect(cpuStream.source.metric).toBe('cpu')
    })
  })
})

// ============================================================================
// Transformation Tests
// ============================================================================

describe('$.stream - Transformations', () => {
  let $: StreamContext

  beforeEach(() => {
    $ = createStreamContext()
  })

  describe('.filter() - Stream Filtering', () => {
    it('filters elements based on predicate', () => {
      const stream = $.stream.from.Order.created.filter((order: Order) => order.total > 100)

      expect(stream).toBeDefined()
      expect(stream.type).toBe('stream')
    })

    it('filter predicate receives element', async () => {
      const predicateFn = vi.fn((order: Order) => order.total > 100)
      const stream = $.stream.from.Order.created.filter(predicateFn)

      // Emit a test order
      await $.stream.emit('Order', 'created', createOrder({ total: 150 }))
      await stream.flush()

      expect(predicateFn).toHaveBeenCalledWith(expect.objectContaining({ total: 150 }))
    })

    it('filters out elements that do not match', async () => {
      const stream = $.stream.from.Order.created.filter((order: Order) => order.total > 100)

      const output: Order[] = []
      stream.subscribe((order) => output.push(order))

      await $.stream.emit('Order', 'created', createOrder({ total: 50 }))
      await $.stream.emit('Order', 'created', createOrder({ total: 150 }))
      await $.stream.emit('Order', 'created', createOrder({ total: 75 }))
      await stream.flush()

      expect(output).toHaveLength(1)
      expect(output[0].total).toBe(150)
    })

    it('supports multiple chained filters', async () => {
      const stream = $.stream.from.Order.created
        .filter((order: Order) => order.total > 50)
        .filter((order: Order) => order.region === 'us-east')

      const output: Order[] = []
      stream.subscribe((order) => output.push(order))

      await $.stream.emit('Order', 'created', createOrder({ total: 100, region: 'us-east' }))
      await $.stream.emit('Order', 'created', createOrder({ total: 100, region: 'eu-west' }))
      await $.stream.emit('Order', 'created', createOrder({ total: 25, region: 'us-east' }))
      await stream.flush()

      expect(output).toHaveLength(1)
      expect(output[0].region).toBe('us-east')
    })

    it('filter with async predicate', async () => {
      const stream = $.stream.from.Order.created.filter(async (order: Order) => {
        // Simulate async validation
        await new Promise((resolve) => setTimeout(resolve, 1))
        return order.total > 100
      })

      const output: Order[] = []
      stream.subscribe((order) => output.push(order))

      await $.stream.emit('Order', 'created', createOrder({ total: 150 }))
      await stream.flush()

      expect(output).toHaveLength(1)
    })
  })

  describe('.map() - Stream Mapping', () => {
    it('transforms elements', () => {
      const stream = $.stream.from.Order.created.map((order: Order) => ({
        customerId: order.customerId,
        amount: order.total,
        isHighValue: order.total > 1000,
      }))

      expect(stream).toBeDefined()
      expect(stream.type).toBe('stream')
    })

    it('map function receives element and transforms it', async () => {
      const stream = $.stream.from.Order.created.map((order: Order) => ({
        id: order.orderId,
        value: order.total,
      }))

      const output: Array<{ id: string; value: number }> = []
      stream.subscribe((item) => output.push(item))

      await $.stream.emit('Order', 'created', createOrder({ orderId: 'ord-1', total: 100 }))
      await stream.flush()

      expect(output).toHaveLength(1)
      expect(output[0]).toEqual({ id: 'ord-1', value: 100 })
    })

    it('map changes element type', async () => {
      const stream = $.stream.from.Order.created.map((order: Order) => order.total)

      const output: number[] = []
      stream.subscribe((value) => output.push(value))

      await $.stream.emit('Order', 'created', createOrder({ total: 99 }))
      await stream.flush()

      expect(output).toEqual([99])
    })

    it('supports chained map operations', async () => {
      const stream = $.stream.from.Order.created
        .map((order: Order) => order.total)
        .map((total: number) => total * 1.1)
        .map((total: number) => Math.round(total))

      const output: number[] = []
      stream.subscribe((value) => output.push(value))

      await $.stream.emit('Order', 'created', createOrder({ total: 100 }))
      await stream.flush()

      expect(output).toEqual([110])
    })

    it('map with async transformer', async () => {
      const stream = $.stream.from.Order.created.map(async (order: Order) => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return { orderId: order.orderId, processed: true }
      })

      const output: Array<{ orderId: string; processed: boolean }> = []
      stream.subscribe((item) => output.push(item))

      await $.stream.emit('Order', 'created', createOrder({ orderId: 'ord-async' }))
      await stream.flush()

      expect(output[0]).toEqual({ orderId: 'ord-async', processed: true })
    })
  })

  describe('.enrich() - Stream Enrichment', () => {
    it('enriches elements with external data', async () => {
      const stream = $.stream.from.Order.created.enrich(async (order: Order, context) => ({
        ...order,
        customer: await context.Customer(order.customerId).get(),
      }))

      expect(stream).toBeDefined()
      expect(stream.type).toBe('stream')
    })

    it('enrich function receives element and $ context', async () => {
      const enrichFn = vi.fn(async (order: Order, context: StreamContext) => ({
        ...order,
        customerName: 'Test Customer',
      }))

      const stream = $.stream.from.Order.created.enrich(enrichFn)

      await $.stream.emit('Order', 'created', createOrder())
      await stream.flush()

      expect(enrichFn).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ Customer: expect.any(Function) }))
    })

    it('enriches with entity lookup', async () => {
      // Mock customer data
      $._storage.customers.set('customer-123', {
        customerId: 'customer-123',
        name: 'John Doe',
        tier: 'gold',
        email: 'john@example.com',
      })

      const stream = $.stream.from.Order.created.enrich(async (order: Order, ctx) => ({
        ...order,
        customer: await ctx.Customer(order.customerId).get(),
      }))

      const output: Array<Order & { customer: Customer }> = []
      stream.subscribe((item) => output.push(item))

      await $.stream.emit('Order', 'created', createOrder({ customerId: 'customer-123' }))
      await stream.flush()

      expect(output[0].customer).toBeDefined()
      expect(output[0].customer.name).toBe('John Doe')
    })

    it('enrich handles missing lookup data gracefully', async () => {
      const stream = $.stream.from.Order.created.enrich(async (order: Order, ctx) => ({
        ...order,
        customer: (await ctx.Customer(order.customerId).get()) ?? null,
      }))

      const output: Array<Order & { customer: Customer | null }> = []
      stream.subscribe((item) => output.push(item))

      await $.stream.emit('Order', 'created', createOrder({ customerId: 'nonexistent' }))
      await stream.flush()

      expect(output[0].customer).toBeNull()
    })

    it('supports chaining filter, map, and enrich', async () => {
      $._storage.customers.set('customer-vip', {
        customerId: 'customer-vip',
        name: 'VIP Customer',
        tier: 'gold',
        email: 'vip@example.com',
      })

      const stream = $.stream.from.Order.created
        .filter((order: Order) => order.total > 100)
        .map((order: Order) => ({
          orderId: order.orderId,
          customerId: order.customerId,
          amount: order.total,
        }))
        .enrich(async (order, ctx) => ({
          ...order,
          customerTier: ((await ctx.Customer(order.customerId).get()) as Customer)?.tier ?? 'unknown',
        }))

      const output: Array<{ orderId: string; customerId: string; amount: number; customerTier: string }> = []
      stream.subscribe((item) => output.push(item))

      await $.stream.emit('Order', 'created', createOrder({ total: 150, customerId: 'customer-vip' }))
      await stream.flush()

      expect(output[0].customerTier).toBe('gold')
    })
  })

  describe('.flatMap() - Stream FlatMapping', () => {
    it('expands elements into multiple elements', async () => {
      const stream = $.stream.from.Order.created.flatMap((order: Order) => order.items.map((item) => ({ ...item, orderId: order.orderId })))

      const output: Array<{ sku: string; qty: number; price: number; orderId: string }> = []
      stream.subscribe((item) => output.push(item))

      await $.stream.emit(
        'Order',
        'created',
        createOrder({
          orderId: 'ord-1',
          items: [
            { sku: 'sku-a', qty: 2, price: 50 },
            { sku: 'sku-b', qty: 1, price: 75 },
          ],
        })
      )
      await stream.flush()

      expect(output).toHaveLength(2)
      expect(output[0].sku).toBe('sku-a')
      expect(output[1].sku).toBe('sku-b')
    })

    it('flatMap with empty result removes element', async () => {
      const stream = $.stream.from.Order.created.flatMap((order: Order) => (order.total > 100 ? [order] : []))

      const output: Order[] = []
      stream.subscribe((item) => output.push(item))

      await $.stream.emit('Order', 'created', createOrder({ total: 50 }))
      await $.stream.emit('Order', 'created', createOrder({ total: 150 }))
      await stream.flush()

      expect(output).toHaveLength(1)
      expect(output[0].total).toBe(150)
    })
  })
})

// ============================================================================
// Keyed Stream Tests
// ============================================================================

describe('$.stream - Keyed Streams', () => {
  let $: StreamContext

  beforeEach(() => {
    $ = createStreamContext()
  })

  describe('.keyBy() - Stream Partitioning', () => {
    it('creates a keyed stream by field', () => {
      const stream = $.stream.from.Order.created.keyBy('region')

      expect(stream).toBeDefined()
      expect(stream.type).toBe('keyed-stream')
      expect(stream.keySelector).toBe('region')
    })

    it('keyed stream groups elements by key', async () => {
      const stream = $.stream.from.Order.created.keyBy('region')

      const keyedOutput = new Map<string, Order[]>()
      stream.subscribe((order, key) => {
        if (!keyedOutput.has(key)) keyedOutput.set(key, [])
        keyedOutput.get(key)!.push(order)
      })

      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east' }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'eu-west' }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east' }))
      await stream.flush()

      expect(keyedOutput.get('us-east')).toHaveLength(2)
      expect(keyedOutput.get('eu-west')).toHaveLength(1)
    })

    it('keyBy with function selector', () => {
      const stream = $.stream.from.Order.created.keyBy((order: Order) => `${order.region}:${order.customerId}`)

      expect(stream.type).toBe('keyed-stream')
    })

    it('keyBy with composite key', async () => {
      const stream = $.stream.from.Order.created.keyBy((order: Order) => `${order.region}:${order.customerId}`)

      const keys: string[] = []
      stream.subscribe((order, key) => keys.push(key))

      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', customerId: 'c1' }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', customerId: 'c2' }))
      await stream.flush()

      expect(keys).toContain('us-east:c1')
      expect(keys).toContain('us-east:c2')
    })

    it('keyBy preserves transformations', async () => {
      const stream = $.stream.from.Order.created
        .filter((order: Order) => order.total > 50)
        .map((order: Order) => ({ id: order.orderId, amount: order.total, region: order.region }))
        .keyBy('region')

      const output: Array<{ id: string; amount: number; region: string }> = []
      stream.subscribe((item) => output.push(item))

      await $.stream.emit('Order', 'created', createOrder({ total: 100, region: 'us-east' }))
      await $.stream.emit('Order', 'created', createOrder({ total: 25, region: 'us-east' })) // filtered out
      await stream.flush()

      expect(output).toHaveLength(1)
    })
  })
})

// ============================================================================
// Window Tests
// ============================================================================

describe('$.stream - Windowing', () => {
  let $: StreamContext

  beforeEach(() => {
    vi.useFakeTimers()
    $ = createStreamContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('.window.tumbling() - Fixed Non-overlapping Windows', () => {
    it('creates tumbling windows with duration string', () => {
      const stream = $.stream.from.Order.created.keyBy('region').window.tumbling('1h')

      expect(stream).toBeDefined()
      expect(stream.type).toBe('windowed-stream')
      expect(stream.window.type).toBe('tumbling')
      expect(stream.window.size).toBe(3600000) // 1 hour in ms
    })

    it('creates tumbling windows with duration number (ms)', () => {
      const stream = $.stream.from.Order.created.keyBy('region').window.tumbling(300000) // 5 minutes

      expect(stream.window.size).toBe(300000)
    })

    it('tumbling windows collect elements within window', async () => {
      const stream = $.stream.from.Order.created.keyBy('region').window.tumbling('5m')

      const windows: Array<{ key: string; elements: Order[] }> = []
      stream.onWindowClose((key, elements) => {
        windows.push({ key, elements: [...elements] })
      })

      // Emit orders within a 5-minute window
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', timestamp: ts(0) }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', timestamp: ts(60000) })) // 1 min
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', timestamp: ts(120000) })) // 2 min

      // Advance time past window end
      vi.advanceTimersByTime(5 * 60 * 1000)
      await stream.flush()

      expect(windows).toHaveLength(1)
      expect(windows[0].elements).toHaveLength(3)
    })

    it('tumbling windows do not overlap', async () => {
      const stream = $.stream.from.Order.created.keyBy('region').window.tumbling('5m')

      const windowBoundaries: number[][] = []
      stream.onWindowClose((key, elements, windowInfo) => {
        windowBoundaries.push([windowInfo.start, windowInfo.end])
      })

      // Emit orders spanning multiple windows
      for (let i = 0; i < 12; i++) {
        await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', timestamp: ts(i * 60 * 1000) }))
      }

      vi.advanceTimersByTime(15 * 60 * 1000)
      await stream.flush()

      // Should have 3 windows (0-5m, 5-10m, 10-15m)
      expect(windowBoundaries).toHaveLength(3)

      // Windows should not overlap
      for (let i = 1; i < windowBoundaries.length; i++) {
        expect(windowBoundaries[i][0]).toBeGreaterThanOrEqual(windowBoundaries[i - 1][1])
      }
    })
  })

  describe('.window.sliding() - Overlapping Windows', () => {
    it('creates sliding windows with size and slide', () => {
      const stream = $.stream.from.Order.created.keyBy('region').window.sliding('1h', '15m')

      expect(stream.type).toBe('windowed-stream')
      expect(stream.window.type).toBe('sliding')
      expect(stream.window.size).toBe(3600000) // 1 hour
      expect(stream.window.slide).toBe(900000) // 15 minutes
    })

    it('sliding windows overlap correctly', async () => {
      // 10-minute windows sliding every 5 minutes
      const stream = $.stream.from.Order.created.keyBy('region').window.sliding('10m', '5m')

      const windowContents: Order[][] = []
      stream.onWindowClose((key, elements) => {
        windowContents.push([...elements])
      })

      // Emit order at 7 minutes (should be in windows [0,10) and [5,15))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', timestamp: ts(7 * 60 * 1000) }))

      vi.advanceTimersByTime(15 * 60 * 1000)
      await stream.flush()

      // The order should appear in 2 windows
      const windowsWithOrder = windowContents.filter((w) => w.length > 0)
      expect(windowsWithOrder.length).toBe(2)
    })

    it('validates slide <= size', () => {
      expect(() => $.stream.from.Order.created.keyBy('region').window.sliding('5m', '10m')).toThrow(/slide.*size/i)
    })
  })

  describe('.window.session() - Gap-based Sessions', () => {
    it('creates session windows with gap duration', () => {
      const stream = $.stream.from.Order.created.keyBy('customerId').window.session('30m')

      expect(stream.type).toBe('windowed-stream')
      expect(stream.window.type).toBe('session')
      expect(stream.window.gap).toBe(30 * 60 * 1000) // 30 minutes
    })

    it('session windows merge elements within gap', async () => {
      const stream = $.stream.from.Order.created.keyBy('customerId').window.session('5m')

      const sessions: Array<{ customerId: string; orders: Order[] }> = []
      stream.onWindowClose((key, elements) => {
        sessions.push({ customerId: key, orders: [...elements] })
      })

      // Customer activity within 5-minute gaps
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', timestamp: ts(0) }))
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', timestamp: ts(2 * 60 * 1000) })) // 2 min gap
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', timestamp: ts(4 * 60 * 1000) })) // 2 min gap

      // Wait for session to close
      vi.advanceTimersByTime(10 * 60 * 1000)
      await stream.flush()

      expect(sessions).toHaveLength(1)
      expect(sessions[0].orders).toHaveLength(3)
    })

    it('session windows split on gap exceeding threshold', async () => {
      const stream = $.stream.from.Order.created.keyBy('customerId').window.session('5m')

      const sessions: Order[][] = []
      stream.onWindowClose((key, elements) => {
        sessions.push([...elements])
      })

      // First session
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', timestamp: ts(0) }))
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', timestamp: ts(2 * 60 * 1000) }))

      // Gap of 10 minutes - new session
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', timestamp: ts(12 * 60 * 1000) }))

      vi.advanceTimersByTime(20 * 60 * 1000)
      await stream.flush()

      expect(sessions).toHaveLength(2)
      expect(sessions[0]).toHaveLength(2)
      expect(sessions[1]).toHaveLength(1)
    })

    it('session windows are per-key', async () => {
      const stream = $.stream.from.Order.created.keyBy('customerId').window.session('5m')

      const sessions: Array<{ key: string; count: number }> = []
      stream.onWindowClose((key, elements) => {
        sessions.push({ key, count: elements.length })
      })

      // Customer 1 activity
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', timestamp: ts(0) }))
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', timestamp: ts(60 * 1000) }))

      // Customer 2 activity (same time, separate session)
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c2', timestamp: ts(0) }))

      vi.advanceTimersByTime(10 * 60 * 1000)
      await stream.flush()

      expect(sessions).toHaveLength(2)
      expect(sessions.find((s) => s.key === 'c1')?.count).toBe(2)
      expect(sessions.find((s) => s.key === 'c2')?.count).toBe(1)
    })
  })

  describe('Window from non-keyed stream', () => {
    it('tumbling window on non-keyed stream uses global key', () => {
      const stream = $.stream.from.Order.created.window.tumbling('1h')

      expect(stream.type).toBe('windowed-stream')
      expect(stream.key).toBe('__global__')
    })
  })
})

// ============================================================================
// Aggregation Tests
// ============================================================================

describe('$.stream - Aggregations', () => {
  let $: StreamContext

  beforeEach(() => {
    vi.useFakeTimers()
    $ = createStreamContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('.aggregate() - Window Aggregations', () => {
    it('aggregates with count', async () => {
      const stream = $.stream.from.Order.created.keyBy('region').window.tumbling('1h').aggregate({
        orderCount: $.count(),
      })

      const results: Array<{ key: string; orderCount: number }> = []
      stream.subscribe((result, key) => {
        results.push({ key, orderCount: result.orderCount })
      })

      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east' }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east' }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east' }))

      vi.advanceTimersByTime(60 * 60 * 1000)
      await stream.flush()

      expect(results).toHaveLength(1)
      expect(results[0].orderCount).toBe(3)
    })

    it('aggregates with sum', async () => {
      const stream = $.stream.from.Order.created.keyBy('region').window.tumbling('1h').aggregate({
        revenue: $.sum('total'),
      })

      const results: Array<{ revenue: number }> = []
      stream.subscribe((result) => results.push(result))

      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 100 }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 200 }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 150 }))

      vi.advanceTimersByTime(60 * 60 * 1000)
      await stream.flush()

      expect(results[0].revenue).toBe(450)
    })

    it('aggregates with avg', async () => {
      const stream = $.stream.from.Order.created.keyBy('region').window.tumbling('1h').aggregate({
        avgOrder: $.avg('total'),
      })

      const results: Array<{ avgOrder: number }> = []
      stream.subscribe((result) => results.push(result))

      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 100 }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 200 }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 300 }))

      vi.advanceTimersByTime(60 * 60 * 1000)
      await stream.flush()

      expect(results[0].avgOrder).toBe(200)
    })

    it('aggregates with min and max', async () => {
      const stream = $.stream.from.Order.created.keyBy('region').window.tumbling('1h').aggregate({
        minOrder: $.min('total'),
        maxOrder: $.max('total'),
      })

      const results: Array<{ minOrder: number; maxOrder: number }> = []
      stream.subscribe((result) => results.push(result))

      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 150 }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 50 }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 250 }))

      vi.advanceTimersByTime(60 * 60 * 1000)
      await stream.flush()

      expect(results[0].minOrder).toBe(50)
      expect(results[0].maxOrder).toBe(250)
    })

    it('aggregates with multiple metrics', async () => {
      const stream = $.stream.from.Order.created.keyBy('region').window.tumbling('1h').aggregate({
        orderCount: $.count(),
        revenue: $.sum('total'),
        avgOrder: $.avg('total'),
      })

      const results: Array<{ orderCount: number; revenue: number; avgOrder: number }> = []
      stream.subscribe((result) => results.push(result))

      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 100 }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 200 }))

      vi.advanceTimersByTime(60 * 60 * 1000)
      await stream.flush()

      expect(results[0].orderCount).toBe(2)
      expect(results[0].revenue).toBe(300)
      expect(results[0].avgOrder).toBe(150)
    })

    it('aggregates per key', async () => {
      const stream = $.stream.from.Order.created.keyBy('region').window.tumbling('1h').aggregate({
        revenue: $.sum('total'),
      })

      const results = new Map<string, number>()
      stream.subscribe((result, key) => {
        results.set(key, result.revenue)
      })

      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 100 }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'eu-west', total: 200 }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 150 }))

      vi.advanceTimersByTime(60 * 60 * 1000)
      await stream.flush()

      expect(results.get('us-east')).toBe(250)
      expect(results.get('eu-west')).toBe(200)
    })

    it('aggregate result includes window metadata', async () => {
      const stream = $.stream.from.Order.created.keyBy('region').window.tumbling('1h').aggregate({
        count: $.count(),
      })

      let windowInfo: { start: number; end: number } | null = null
      stream.subscribe((result, key, info) => {
        windowInfo = info
      })

      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east' }))

      vi.advanceTimersByTime(60 * 60 * 1000)
      await stream.flush()

      expect(windowInfo).not.toBeNull()
      expect(windowInfo!.end - windowInfo!.start).toBe(60 * 60 * 1000)
    })
  })

  describe('.reduce() - Custom Aggregation', () => {
    it('reduces with custom reducer function', async () => {
      const stream = $.stream.from.Order.created
        .keyBy('region')
        .window.tumbling('1h')
        .reduce((acc, order) => ({
          count: acc.count + 1,
          totalRevenue: acc.totalRevenue + order.total,
          uniqueCustomers: acc.uniqueCustomers.add(order.customerId),
        }), { count: 0, totalRevenue: 0, uniqueCustomers: new Set<string>() })

      const results: Array<{ count: number; totalRevenue: number; uniqueCustomers: Set<string> }> = []
      stream.subscribe((result) => results.push(result))

      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', customerId: 'c1', total: 100 }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', customerId: 'c2', total: 200 }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', customerId: 'c1', total: 150 }))

      vi.advanceTimersByTime(60 * 60 * 1000)
      await stream.flush()

      expect(results[0].count).toBe(3)
      expect(results[0].totalRevenue).toBe(450)
      expect(results[0].uniqueCustomers.size).toBe(2)
    })
  })

  describe('Aggregation functions', () => {
    it('$.count() counts all elements', () => {
      const counter = $.count()
      expect(counter.type).toBe('count')
    })

    it('$.sum(field) sums field values', () => {
      const summer = $.sum('total')
      expect(summer.type).toBe('sum')
      expect(summer.field).toBe('total')
    })

    it('$.avg(field) averages field values', () => {
      const averager = $.avg('total')
      expect(averager.type).toBe('avg')
      expect(averager.field).toBe('total')
    })

    it('$.min(field) finds minimum', () => {
      const minner = $.min('total')
      expect(minner.type).toBe('min')
      expect(minner.field).toBe('total')
    })

    it('$.max(field) finds maximum', () => {
      const maxxer = $.max('total')
      expect(maxxer.type).toBe('max')
      expect(maxxer.field).toBe('total')
    })

    it('$.first() gets first element', () => {
      const firster = $.first()
      expect(firster.type).toBe('first')
    })

    it('$.last() gets last element', () => {
      const laster = $.last()
      expect(laster.type).toBe('last')
    })

    it('$.collect() collects all elements into array', () => {
      const collector = $.collect()
      expect(collector.type).toBe('collect')
    })

    it('$.distinct(field) counts distinct values', () => {
      const distinctor = $.distinct('customerId')
      expect(distinctor.type).toBe('distinct')
      expect(distinctor.field).toBe('customerId')
    })
  })
})

// ============================================================================
// Stream Join Tests
// ============================================================================

describe('$.stream - Stream Joins', () => {
  let $: StreamContext

  beforeEach(() => {
    vi.useFakeTimers()
    $ = createStreamContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('.join() - Stream Joins', () => {
    it('creates a join between two keyed streams', () => {
      const orders = $.stream.from.Order.created.keyBy('orderId')
      const payments = $.stream.from.Payment.completed.keyBy('orderId')

      const joined = orders.join(payments)

      expect(joined).toBeDefined()
      expect(joined.type).toBe('joined-stream')
    })

    it('join requires keyed streams', () => {
      const orders = $.stream.from.Order.created // Not keyed
      const payments = $.stream.from.Payment.completed.keyBy('orderId')

      expect(() => orders.join(payments)).toThrow(/keyed/i)
    })

    it('.within() specifies temporal join window', () => {
      const orders = $.stream.from.Order.created.keyBy('orderId')
      const payments = $.stream.from.Payment.completed.keyBy('orderId')

      const joined = orders.join(payments).within('10m')

      expect(joined.window).toBe(10 * 60 * 1000)
    })

    it('.on() specifies join result mapping', () => {
      const orders = $.stream.from.Order.created.keyBy('orderId')
      const payments = $.stream.from.Payment.completed.keyBy('orderId')

      const joined = orders
        .join(payments)
        .within('10m')
        .on((order: Order, payment: Payment) => ({
          orderId: order.orderId,
          amount: order.total,
          paid: true,
          paymentMethod: payment.method,
        }))

      expect(joined.type).toBe('stream')
    })

    it('joins matching elements within window', async () => {
      const orders = $.stream.from.Order.created.keyBy('orderId')
      const payments = $.stream.from.Payment.completed.keyBy('orderId')

      const joined = orders
        .join(payments)
        .within('10m')
        .on((order: Order, payment: Payment) => ({
          orderId: order.orderId,
          orderTotal: order.total,
          paymentAmount: payment.amount,
        }))

      const results: Array<{ orderId: string; orderTotal: number; paymentAmount: number }> = []
      joined.subscribe((result) => results.push(result))

      // Emit order
      await $.stream.emit('Order', 'created', createOrder({ orderId: 'ord-1', total: 100, timestamp: ts(0) }))

      // Emit matching payment within window
      await $.stream.emit('Payment', 'completed', createPayment({ orderId: 'ord-1', amount: 100, timestamp: ts(5 * 60 * 1000) }))

      await joined.flush()

      expect(results).toHaveLength(1)
      expect(results[0].orderId).toBe('ord-1')
    })

    it('does not join elements outside window', async () => {
      const orders = $.stream.from.Order.created.keyBy('orderId')
      const payments = $.stream.from.Payment.completed.keyBy('orderId')

      const joined = orders
        .join(payments)
        .within('5m')
        .on((order: Order, payment: Payment) => ({ orderId: order.orderId }))

      const results: Array<{ orderId: string }> = []
      joined.subscribe((result) => results.push(result))

      // Emit order
      await $.stream.emit('Order', 'created', createOrder({ orderId: 'ord-1', timestamp: ts(0) }))

      // Emit payment OUTSIDE window (10 minutes later)
      await $.stream.emit('Payment', 'completed', createPayment({ orderId: 'ord-1', timestamp: ts(10 * 60 * 1000) }))

      vi.advanceTimersByTime(15 * 60 * 1000)
      await joined.flush()

      expect(results).toHaveLength(0)
    })

    it('joins with multiple matches', async () => {
      const orders = $.stream.from.Order.created.keyBy('customerId')
      const signups = $.stream.from.Customer.signup.keyBy('customerId')

      const joined = orders
        .join(signups)
        .within('24h')
        .on((order: Order, signup: any) => ({
          customerId: order.customerId,
          orderId: order.orderId,
          signupSource: signup.source,
        }))

      const results: Array<{ customerId: string; orderId: string; signupSource: string }> = []
      joined.subscribe((result) => results.push(result))

      // Customer signs up
      await $.stream.emit('Customer', 'signup', { customerId: 'c1', source: 'google', timestamp: ts(0) })

      // Customer places multiple orders
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', orderId: 'ord-1', timestamp: ts(60 * 1000) }))
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', orderId: 'ord-2', timestamp: ts(120 * 1000) }))

      await joined.flush()

      expect(results).toHaveLength(2)
    })
  })

  describe('.leftJoin() - Left Outer Join', () => {
    it('includes left elements without match', async () => {
      const orders = $.stream.from.Order.created.keyBy('orderId')
      const payments = $.stream.from.Payment.completed.keyBy('orderId')

      const joined = orders
        .leftJoin(payments)
        .within('10m')
        .on((order: Order, payment: Payment | null) => ({
          orderId: order.orderId,
          paid: payment !== null,
          paymentMethod: payment?.method ?? null,
        }))

      const results: Array<{ orderId: string; paid: boolean; paymentMethod: string | null }> = []
      joined.subscribe((result) => results.push(result))

      // Order without payment
      await $.stream.emit('Order', 'created', createOrder({ orderId: 'ord-1', timestamp: ts(0) }))

      // Order with payment
      await $.stream.emit('Order', 'created', createOrder({ orderId: 'ord-2', timestamp: ts(0) }))
      await $.stream.emit('Payment', 'completed', createPayment({ orderId: 'ord-2', timestamp: ts(60 * 1000) }))

      vi.advanceTimersByTime(15 * 60 * 1000)
      await joined.flush()

      const unpaid = results.find((r) => r.orderId === 'ord-1')
      const paid = results.find((r) => r.orderId === 'ord-2')

      expect(unpaid?.paid).toBe(false)
      expect(unpaid?.paymentMethod).toBeNull()
      expect(paid?.paid).toBe(true)
    })
  })

  describe('.coGroup() - Co-grouped Streams', () => {
    it('groups all matches together', async () => {
      const orders = $.stream.from.Order.created.keyBy('customerId')
      const pageViews = $.stream.from.track.PageView.keyBy('userId')

      const coGrouped = orders
        .coGroup(pageViews)
        .within('1h')
        .apply((orderGroup: Order[], pageViewGroup: PageView[]) => ({
          orderCount: orderGroup.length,
          pageViewCount: pageViewGroup.length,
        }))

      const results: Array<{ orderCount: number; pageViewCount: number }> = []
      coGrouped.subscribe((result) => results.push(result))

      // Same customer/user
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', timestamp: ts(0) }))
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', timestamp: ts(60 * 1000) }))
      await $.stream.emit('track', 'PageView', { userId: 'c1', path: '/home', timestamp: ts(30 * 1000) })
      await $.stream.emit('track', 'PageView', { userId: 'c1', path: '/checkout', timestamp: ts(90 * 1000) })

      vi.advanceTimersByTime(2 * 60 * 60 * 1000)
      await coGrouped.flush()

      expect(results[0].orderCount).toBe(2)
      expect(results[0].pageViewCount).toBe(2)
    })
  })
})

// ============================================================================
// Sink Tests
// ============================================================================

describe('$.stream - Sinks', () => {
  let $: StreamContext

  beforeEach(() => {
    vi.useFakeTimers()
    $ = createStreamContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('.to.track.X - Track Events Sink', () => {
    it('sends stream output to track', async () => {
      const stream = $.stream.from.Order.created
        .map((order: Order) => ({
          orderId: order.orderId,
          amount: order.total,
        }))
        .to.track.ProcessedOrder

      expect(stream.sink.type).toBe('track')
      expect(stream.sink.event).toBe('ProcessedOrder')
    })

    it('tracks events from stream', async () => {
      const trackedEvents: Array<{ orderId: string; amount: number }> = []
      $._hooks.onTrack('ProcessedOrder', (event) => trackedEvents.push(event))

      const stream = $.stream.from.Order.created
        .map((order: Order) => ({
          orderId: order.orderId,
          amount: order.total,
        }))
        .to.track.ProcessedOrder

      await $.stream.emit('Order', 'created', createOrder({ orderId: 'ord-1', total: 100 }))
      await stream.flush()

      expect(trackedEvents).toHaveLength(1)
      expect(trackedEvents[0]).toEqual({ orderId: 'ord-1', amount: 100 })
    })
  })

  describe('.to.measure.X - Measure Sink', () => {
    it('sends stream output to measure', async () => {
      const stream = $.stream.from.Order.created.keyBy('region').window.tumbling('1h').aggregate({
        revenue: $.sum('total'),
      }).to.measure.hourlyRevenue

      expect(stream.sink.type).toBe('measure')
      expect(stream.sink.metric).toBe('hourlyRevenue')
    })

    it('records measurements from aggregated stream', async () => {
      const measurements: Array<{ value: number; labels: Record<string, string> }> = []
      $._hooks.onMeasure('hourlyRevenue', (value, labels) => measurements.push({ value, labels }))

      const stream = $.stream.from.Order.created.keyBy('region').window.tumbling('1h').aggregate({
        revenue: $.sum('total'),
      }).to.measure.hourlyRevenue

      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 100 }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 200 }))

      vi.advanceTimersByTime(60 * 60 * 1000)
      await stream.flush()

      expect(measurements).toHaveLength(1)
      expect(measurements[0].value).toBe(300)
      expect(measurements[0].labels.region).toBe('us-east')
    })
  })

  describe('.to.view.X - View Sink', () => {
    it('sends stream output to materialized view', async () => {
      const stream = $.stream.from.Order.created.keyBy('customerId').window.tumbling('1d').aggregate({
        totalSpent: $.sum('total'),
        orderCount: $.count(),
      }).to.view.customerSummary

      expect(stream.sink.type).toBe('view')
      expect(stream.sink.view).toBe('customerSummary')
    })

    it('updates view from stream', async () => {
      const stream = $.stream.from.Order.created.keyBy('customerId').window.tumbling('1d').aggregate({
        totalSpent: $.sum('total'),
        orderCount: $.count(),
      }).to.view.customerSummary

      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', total: 100 }))
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', total: 200 }))

      vi.advanceTimersByTime(24 * 60 * 60 * 1000)
      await stream.flush()

      const viewData = await $.view.customerSummary.get('c1')
      expect(viewData.totalSpent).toBe(300)
      expect(viewData.orderCount).toBe(2)
    })
  })

  describe('.to.Entity(id).action - Entity Action Sink', () => {
    it('triggers entity action from stream', async () => {
      const notifications: Array<{ customerId: string; message: string }> = []
      $._hooks.onEntityAction('Customer', 'notify', (id, payload) => {
        notifications.push({ customerId: id, message: payload.message })
      })

      const stream = $.stream.from.Order.created
        .filter((order: Order) => order.total > 1000)
        .forEach(async (order: Order) => {
          await $.Customer(order.customerId).notify({ message: 'High value order received!' })
        })

      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', total: 1500 }))
      await stream.flush()

      expect(notifications).toHaveLength(1)
      expect(notifications[0].customerId).toBe('c1')
    })
  })

  describe('Multiple sinks', () => {
    it('supports multiple sinks from same stream', async () => {
      const tracked: any[] = []
      const measured: any[] = []

      $._hooks.onTrack('OrderProcessed', (e) => tracked.push(e))
      $._hooks.onMeasure('processedOrderValue', (v) => measured.push(v))

      const baseStream = $.stream.from.Order.created.map((order: Order) => ({
        orderId: order.orderId,
        value: order.total,
      }))

      // Fork to multiple sinks
      baseStream.to.track.OrderProcessed
      baseStream.map((o) => o.value).to.measure.processedOrderValue

      await $.stream.emit('Order', 'created', createOrder({ orderId: 'ord-1', total: 100 }))
      await baseStream.flush()

      expect(tracked).toHaveLength(1)
      expect(measured).toHaveLength(1)
    })
  })
})

// ============================================================================
// Stream Lifecycle Tests
// ============================================================================

describe('$.stream - Lifecycle', () => {
  let $: StreamContext

  beforeEach(() => {
    $ = createStreamContext()
  })

  describe('.subscribe() - Stream Subscription', () => {
    it('subscribes to stream elements', async () => {
      const stream = $.stream.from.Order.created
      const received: Order[] = []

      stream.subscribe((order) => received.push(order))

      await $.stream.emit('Order', 'created', createOrder())
      await stream.flush()

      expect(received).toHaveLength(1)
    })

    it('subscribe returns unsubscribe function', async () => {
      const stream = $.stream.from.Order.created
      const received: Order[] = []

      const unsubscribe = stream.subscribe((order) => received.push(order))

      await $.stream.emit('Order', 'created', createOrder())
      await stream.flush()

      unsubscribe()

      await $.stream.emit('Order', 'created', createOrder())
      await stream.flush()

      expect(received).toHaveLength(1) // Only first one received
    })

    it('multiple subscribers receive all elements', async () => {
      const stream = $.stream.from.Order.created
      const received1: Order[] = []
      const received2: Order[] = []

      stream.subscribe((order) => received1.push(order))
      stream.subscribe((order) => received2.push(order))

      await $.stream.emit('Order', 'created', createOrder())
      await stream.flush()

      expect(received1).toHaveLength(1)
      expect(received2).toHaveLength(1)
    })
  })

  describe('.forEach() - Side Effects', () => {
    it('executes side effect for each element', async () => {
      const sideEffects: string[] = []

      const stream = $.stream.from.Order.created.forEach((order) => {
        sideEffects.push(`Processed ${order.orderId}`)
      })

      await $.stream.emit('Order', 'created', createOrder({ orderId: 'ord-1' }))
      await $.stream.emit('Order', 'created', createOrder({ orderId: 'ord-2' }))
      await stream.flush()

      expect(sideEffects).toHaveLength(2)
      expect(sideEffects).toContain('Processed ord-1')
      expect(sideEffects).toContain('Processed ord-2')
    })

    it('forEach with async function', async () => {
      const sideEffects: string[] = []

      const stream = $.stream.from.Order.created.forEach(async (order) => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        sideEffects.push(`Async ${order.orderId}`)
      })

      await $.stream.emit('Order', 'created', createOrder({ orderId: 'ord-1' }))
      await stream.flush()

      expect(sideEffects).toHaveLength(1)
    })
  })

  describe('.start() and .stop() - Stream Control', () => {
    it('stream starts processing after start()', async () => {
      const stream = $.stream.from.Order.created
      const received: Order[] = []
      stream.subscribe((order) => received.push(order))

      // Stream should not be started yet
      expect(stream.isRunning()).toBe(false)

      await stream.start()

      expect(stream.isRunning()).toBe(true)
    })

    it('stream stops processing after stop()', async () => {
      const stream = $.stream.from.Order.created
      const received: Order[] = []
      stream.subscribe((order) => received.push(order))

      await stream.start()
      await $.stream.emit('Order', 'created', createOrder())
      await stream.flush()

      expect(received).toHaveLength(1)

      await stream.stop()

      await $.stream.emit('Order', 'created', createOrder())
      await stream.flush()

      expect(received).toHaveLength(1) // No new elements
    })

    it('stream can be restarted', async () => {
      const stream = $.stream.from.Order.created
      const received: Order[] = []
      stream.subscribe((order) => received.push(order))

      await stream.start()
      await stream.stop()
      await stream.start()

      await $.stream.emit('Order', 'created', createOrder())
      await stream.flush()

      expect(received).toHaveLength(1)
    })
  })

  describe('.name() - Named Streams', () => {
    it('assigns a name to the stream', () => {
      const stream = $.stream.from.Order.created.name('order-processor')

      expect(stream.getName()).toBe('order-processor')
    })

    it('named streams can be retrieved', () => {
      $.stream.from.Order.created.name('my-stream')

      const retrieved = $.stream.get('my-stream')

      expect(retrieved).toBeDefined()
    })
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('$.stream - Error Handling', () => {
  let $: StreamContext

  beforeEach(() => {
    $ = createStreamContext()
  })

  describe('.onError() - Error Handler', () => {
    it('catches errors in transformations', async () => {
      const errors: Error[] = []

      const stream = $.stream.from.Order.created
        .map((order: Order) => {
          if (order.total < 0) throw new Error('Invalid order total')
          return order
        })
        .onError((error) => errors.push(error))

      await $.stream.emit('Order', 'created', createOrder({ total: -100 }))
      await stream.flush()

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe('Invalid order total')
    })

    it('continues processing after error', async () => {
      const errors: Error[] = []
      const processed: Order[] = []

      const stream = $.stream.from.Order.created
        .map((order: Order) => {
          if (order.total < 0) throw new Error('Invalid')
          return order
        })
        .onError((error) => errors.push(error))

      stream.subscribe((order) => processed.push(order))

      await $.stream.emit('Order', 'created', createOrder({ total: -100 }))
      await $.stream.emit('Order', 'created', createOrder({ total: 100 }))
      await stream.flush()

      expect(errors).toHaveLength(1)
      expect(processed).toHaveLength(1)
    })
  })

  describe('.deadLetter() - Dead Letter Queue', () => {
    it('sends failed elements to dead letter sink', async () => {
      const deadLetters: Array<{ element: Order; error: Error }> = []

      const stream = $.stream.from.Order.created
        .map((order: Order) => {
          if (order.total < 0) throw new Error('Invalid')
          return order
        })
        .deadLetter((element, error) => {
          deadLetters.push({ element, error })
        })

      await $.stream.emit('Order', 'created', createOrder({ orderId: 'bad-order', total: -100 }))
      await stream.flush()

      expect(deadLetters).toHaveLength(1)
      expect(deadLetters[0].element.orderId).toBe('bad-order')
    })
  })

  describe('.retry() - Retry Policy', () => {
    it('retries failed operations', async () => {
      let attempts = 0

      const stream = $.stream.from.Order.created
        .map((order: Order) => {
          attempts++
          if (attempts < 3) throw new Error('Transient failure')
          return order
        })
        .retry(3)

      const processed: Order[] = []
      stream.subscribe((order) => processed.push(order))

      await $.stream.emit('Order', 'created', createOrder())
      await stream.flush()

      expect(attempts).toBe(3)
      expect(processed).toHaveLength(1)
    })

    it('sends to dead letter after max retries', async () => {
      const deadLetters: any[] = []

      const stream = $.stream.from.Order.created
        .map((order: Order) => {
          throw new Error('Permanent failure')
        })
        .retry(2)
        .deadLetter((element) => deadLetters.push(element))

      await $.stream.emit('Order', 'created', createOrder())
      await stream.flush()

      expect(deadLetters).toHaveLength(1)
    })
  })
})

// ============================================================================
// Backpressure Tests
// ============================================================================

describe('$.stream - Backpressure', () => {
  let $: StreamContext

  beforeEach(() => {
    $ = createStreamContext()
  })

  describe('.buffer() - Buffering', () => {
    it('buffers elements up to capacity', async () => {
      const stream = $.stream.from.Order.created.buffer(10)

      expect(stream.bufferCapacity).toBe(10)
    })

    it('drops oldest when buffer full (dropOldest strategy)', async () => {
      const stream = $.stream.from.Order.created.buffer(2, { strategy: 'dropOldest' })

      const received: Order[] = []
      stream.subscribe((order) => received.push(order))

      // Emit more than buffer capacity
      for (let i = 0; i < 5; i++) {
        await $.stream.emit('Order', 'created', createOrder({ orderId: `ord-${i}` }))
      }
      await stream.flush()

      // Should only have last 2
      expect(received.length).toBeLessThanOrEqual(2)
    })

    it('drops newest when buffer full (dropNewest strategy)', async () => {
      const stream = $.stream.from.Order.created.buffer(2, { strategy: 'dropNewest' })

      // Implementation should drop new elements when buffer is full
      expect(stream.bufferStrategy).toBe('dropNewest')
    })
  })

  describe('.throttle() - Rate Limiting', () => {
    it('throttles element rate', async () => {
      vi.useFakeTimers()

      const stream = $.stream.from.Order.created.throttle('100ms')

      const received: Order[] = []
      stream.subscribe((order) => received.push(order))

      // Emit rapidly
      for (let i = 0; i < 10; i++) {
        await $.stream.emit('Order', 'created', createOrder({ orderId: `ord-${i}` }))
      }

      // Only first should be received immediately
      expect(received.length).toBe(1)

      vi.advanceTimersByTime(100)
      await stream.flush()

      // More should be released
      expect(received.length).toBeGreaterThan(1)

      vi.useRealTimers()
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('$.stream - Integration Scenarios', () => {
  let $: StreamContext

  beforeEach(() => {
    vi.useFakeTimers()
    $ = createStreamContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Real-time revenue tracking', () => {
    it('tracks hourly revenue by region', async () => {
      const measurements: Array<{ region: string; revenue: number }> = []
      $._hooks.onMeasure('hourlyRevenue', (value, labels) => {
        measurements.push({ region: labels.region, revenue: value })
      })

      const stream = $.stream.from.Order.created.keyBy('region').window.tumbling('1h').aggregate({
        revenue: $.sum('total'),
      }).to.measure.hourlyRevenue

      // Emit orders
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 100 }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'us-east', total: 200 }))
      await $.stream.emit('Order', 'created', createOrder({ region: 'eu-west', total: 150 }))

      vi.advanceTimersByTime(60 * 60 * 1000)
      await stream.flush()

      expect(measurements).toHaveLength(2)
      expect(measurements.find((m) => m.region === 'us-east')?.revenue).toBe(300)
      expect(measurements.find((m) => m.region === 'eu-west')?.revenue).toBe(150)
    })
  })

  describe('Order-Payment correlation', () => {
    it('joins orders with payments to track fulfillment', async () => {
      const fulfilled: Array<{ orderId: string; total: number; paymentMethod: string }> = []

      const orders = $.stream.from.Order.created.keyBy('orderId')
      const payments = $.stream.from.Payment.completed.keyBy('orderId')

      const stream = orders
        .join(payments)
        .within('10m')
        .on((order: Order, payment: Payment) => ({
          orderId: order.orderId,
          total: order.total,
          paymentMethod: payment.method,
        }))

      stream.subscribe((result) => fulfilled.push(result))

      // Order placed
      await $.stream.emit('Order', 'created', createOrder({ orderId: 'ord-1', total: 100, timestamp: ts(0) }))

      // Payment received
      await $.stream.emit('Payment', 'completed', createPayment({ orderId: 'ord-1', method: 'card', timestamp: ts(5 * 60 * 1000) }))

      await stream.flush()

      expect(fulfilled).toHaveLength(1)
      expect(fulfilled[0]).toEqual({
        orderId: 'ord-1',
        total: 100,
        paymentMethod: 'card',
      })
    })
  })

  describe('Customer session analytics', () => {
    it('tracks customer sessions with activity', async () => {
      const sessions: Array<{ customerId: string; duration: number; orderCount: number }> = []

      const stream = $.stream.from.Order.created
        .keyBy('customerId')
        .window.session('30m')
        .aggregate({
          orderCount: $.count(),
          firstOrder: $.min('timestamp'),
          lastOrder: $.max('timestamp'),
        })
        .map((agg) => ({
          customerId: agg.key,
          duration: agg.lastOrder - agg.firstOrder,
          orderCount: agg.orderCount,
        }))

      stream.subscribe((session) => sessions.push(session))

      // Customer session
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', timestamp: ts(0) }))
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', timestamp: ts(5 * 60 * 1000) }))
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', timestamp: ts(10 * 60 * 1000) }))

      vi.advanceTimersByTime(60 * 60 * 1000)
      await stream.flush()

      expect(sessions).toHaveLength(1)
      expect(sessions[0].orderCount).toBe(3)
      expect(sessions[0].duration).toBe(10 * 60 * 1000)
    })
  })

  describe('High-value order alerting', () => {
    it('triggers alerts for high-value orders', async () => {
      const alerts: Array<{ customerId: string; amount: number }> = []
      $._hooks.onEntityAction('Customer', 'notify', (id, payload) => {
        alerts.push({ customerId: id, amount: payload.amount })
      })

      const stream = $.stream.from.Order.created
        .filter((order: Order) => order.total > 1000)
        .enrich(async (order: Order, ctx) => ({
          ...order,
          customer: await ctx.Customer(order.customerId).get(),
        }))
        .forEach(async (enrichedOrder) => {
          await $.Customer(enrichedOrder.customerId).notify({
            message: 'Thank you for your high-value order!',
            amount: enrichedOrder.total,
          })
        })

      // Regular order - no alert
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c1', total: 100 }))

      // High-value order - should alert
      await $.stream.emit('Order', 'created', createOrder({ customerId: 'c2', total: 1500 }))

      await stream.flush()

      expect(alerts).toHaveLength(1)
      expect(alerts[0].customerId).toBe('c2')
      expect(alerts[0].amount).toBe(1500)
    })
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('$.stream - Type Safety', () => {
  let $: StreamContext

  beforeEach(() => {
    $ = createStreamContext()
  })

  describe('Stream type inference', () => {
    it('preserves element type through filter', () => {
      const stream: Stream<Order> = $.stream.from.Order.created.filter((order: Order) => order.total > 100)

      // Type should still be Stream<Order>
      expect(stream).toBeDefined()
    })

    it('changes element type through map', () => {
      const stream: Stream<{ id: string; value: number }> = $.stream.from.Order.created.map((order: Order) => ({
        id: order.orderId,
        value: order.total,
      }))

      expect(stream).toBeDefined()
    })

    it('keyBy creates KeyedStream', () => {
      const stream: KeyedStream<Order, string> = $.stream.from.Order.created.keyBy('region')

      expect(stream.type).toBe('keyed-stream')
    })

    it('window creates WindowedStream', () => {
      const stream: WindowedStream<Order, string> = $.stream.from.Order.created.keyBy('region').window.tumbling('1h')

      expect(stream.type).toBe('windowed-stream')
    })
  })
})

// ============================================================================
// Module Exports Tests
// ============================================================================

describe('$.stream - Module Exports', () => {
  it('createStreamContext is exported', () => {
    expect(createStreamContext).toBeDefined()
    expect(typeof createStreamContext).toBe('function')
  })

  it('StreamContext includes stream namespace', () => {
    const $ = createStreamContext()

    expect($.stream).toBeDefined()
    expect($.stream.from).toBeDefined()
  })

  it('StreamContext includes aggregation helpers', () => {
    const $ = createStreamContext()

    expect($.count).toBeDefined()
    expect($.sum).toBeDefined()
    expect($.avg).toBeDefined()
    expect($.min).toBeDefined()
    expect($.max).toBeDefined()
  })

  it('StreamContext includes entity proxies', () => {
    const $ = createStreamContext()

    expect($.Customer).toBeDefined()
    expect($.Order).toBeDefined()
  })

  it('StreamContext includes view namespace', () => {
    const $ = createStreamContext()

    expect($.view).toBeDefined()
  })
})
