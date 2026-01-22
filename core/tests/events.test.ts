/**
 * Tests for events.ts
 *
 * Tests for the replayEvents function for event sourcing.
 */

import { describe, it, expect } from 'vitest'
import { replayEvents, type Event, type EventHandler } from '../src/index'

describe('replayEvents', () => {
  // Sample event type for testing
  interface OrderState {
    orderId: string
    status: string
    total: number
    paidAt?: Date
    shippedAt?: Date
    items: string[]
  }

  // Sample events
  const createOrderCreatedEvent = (orderId: string, total: number, items: string[]): Event => ({
    id: 'event-1',
    type: 'Order.created',
    subject: `https://app.do/Order/${orderId}`,
    data: { orderId, total, items },
    actor: 'user-123',
    source: 'api',
    timestamp: new Date('2024-01-01T10:00:00Z'),
  })

  const createOrderPaidEvent = (orderId: string): Event => ({
    id: 'event-2',
    type: 'Order.paid',
    subject: `https://app.do/Order/${orderId}`,
    data: { orderId },
    actor: 'payment-service',
    source: 'webhook',
    timestamp: new Date('2024-01-01T10:30:00Z'),
  })

  const createOrderShippedEvent = (orderId: string, trackingNumber: string): Event => ({
    id: 'event-3',
    type: 'Order.shipped',
    subject: `https://app.do/Order/${orderId}`,
    data: { orderId, trackingNumber },
    actor: 'shipping-service',
    source: 'webhook',
    timestamp: new Date('2024-01-01T14:00:00Z'),
  })

  // Handlers for order events
  const orderHandlers: Record<string, EventHandler<OrderState>> = {
    'Order.created': (state, event) => ({
      orderId: event.data.orderId as string,
      status: 'pending',
      total: event.data.total as number,
      items: event.data.items as string[],
    }),
    'Order.paid': (state, event) => ({
      ...state!,
      status: 'paid',
      paidAt: event.timestamp,
    }),
    'Order.shipped': (state, event) => ({
      ...state!,
      status: 'shipped',
      shippedAt: event.timestamp,
    }),
  }

  it('should return null for empty events array', () => {
    const result = replayEvents([], orderHandlers)
    expect(result).toBeNull()
  })

  it('should return initial state when no handlers match', () => {
    const events: Event[] = [{
      id: 'event-1',
      type: 'Unknown.event',
      subject: 'test',
      data: {},
      actor: 'test',
      source: 'test',
      timestamp: new Date(),
    }]

    const result = replayEvents(events, orderHandlers)
    expect(result).toBeNull()
  })

  it('should return initial state when no handlers match but initial state provided', () => {
    const events: Event[] = [{
      id: 'event-1',
      type: 'Unknown.event',
      subject: 'test',
      data: {},
      actor: 'test',
      source: 'test',
      timestamp: new Date(),
    }]

    const initialState: OrderState = {
      orderId: 'init',
      status: 'initial',
      total: 0,
      items: [],
    }

    const result = replayEvents(events, orderHandlers, initialState)
    expect(result).toEqual(initialState)
  })

  it('should replay single event', () => {
    const events = [createOrderCreatedEvent('order-1', 99.99, ['item-a', 'item-b'])]

    const result = replayEvents(events, orderHandlers)

    expect(result).not.toBeNull()
    expect(result?.orderId).toBe('order-1')
    expect(result?.status).toBe('pending')
    expect(result?.total).toBe(99.99)
    expect(result?.items).toEqual(['item-a', 'item-b'])
  })

  it('should replay multiple events in order', () => {
    const events = [
      createOrderCreatedEvent('order-2', 150.00, ['item-x']),
      createOrderPaidEvent('order-2'),
    ]

    const result = replayEvents(events, orderHandlers)

    expect(result?.orderId).toBe('order-2')
    expect(result?.status).toBe('paid')
    expect(result?.paidAt).toEqual(new Date('2024-01-01T10:30:00Z'))
  })

  it('should replay full order lifecycle', () => {
    const events = [
      createOrderCreatedEvent('order-3', 200.00, ['item-1', 'item-2', 'item-3']),
      createOrderPaidEvent('order-3'),
      createOrderShippedEvent('order-3', 'TRACK123'),
    ]

    const result = replayEvents(events, orderHandlers)

    expect(result?.orderId).toBe('order-3')
    expect(result?.status).toBe('shipped')
    expect(result?.total).toBe(200.00)
    expect(result?.items).toHaveLength(3)
    expect(result?.paidAt).toBeDefined()
    expect(result?.shippedAt).toBeDefined()
  })

  it('should skip events without matching handlers', () => {
    const events: Event[] = [
      createOrderCreatedEvent('order-4', 50.00, ['item']),
      {
        id: 'event-unknown',
        type: 'Order.reviewed',
        subject: 'https://app.do/Order/order-4',
        data: { rating: 5 },
        actor: 'customer',
        source: 'api',
        timestamp: new Date('2024-01-02T12:00:00Z'),
      },
      createOrderPaidEvent('order-4'),
    ]

    const result = replayEvents(events, orderHandlers)

    // Order.reviewed should be skipped, but Order.created and Order.paid should apply
    expect(result?.status).toBe('paid')
    expect(result?.orderId).toBe('order-4')
  })

  it('should use initial state as starting point', () => {
    interface CounterState {
      count: number
    }

    const counterHandlers: Record<string, EventHandler<CounterState>> = {
      'Counter.incremented': (state, event) => ({
        count: (state?.count ?? 0) + (event.data.amount as number),
      }),
      'Counter.decremented': (state, event) => ({
        count: (state?.count ?? 0) - (event.data.amount as number),
      }),
    }

    const events: Event[] = [
      {
        id: 'e1',
        type: 'Counter.incremented',
        subject: 'counter',
        data: { amount: 5 },
        actor: 'test',
        source: 'test',
        timestamp: new Date(),
      },
      {
        id: 'e2',
        type: 'Counter.decremented',
        subject: 'counter',
        data: { amount: 2 },
        actor: 'test',
        source: 'test',
        timestamp: new Date(),
      },
    ]

    // Without initial state
    const resultA = replayEvents(events, counterHandlers)
    expect(resultA?.count).toBe(3) // 0 + 5 - 2 = 3

    // With initial state
    const resultB = replayEvents(events, counterHandlers, { count: 10 })
    expect(resultB?.count).toBe(13) // 10 + 5 - 2 = 13
  })

  it('should process events in array order', () => {
    interface NameState {
      names: string[]
    }

    const nameHandlers: Record<string, EventHandler<NameState>> = {
      'Name.added': (state, event) => ({
        names: [...(state?.names ?? []), event.data.name as string],
      }),
    }

    const events: Event[] = [
      { id: 'e1', type: 'Name.added', subject: 'list', data: { name: 'Alice' }, actor: 'test', source: 'test', timestamp: new Date() },
      { id: 'e2', type: 'Name.added', subject: 'list', data: { name: 'Bob' }, actor: 'test', source: 'test', timestamp: new Date() },
      { id: 'e3', type: 'Name.added', subject: 'list', data: { name: 'Charlie' }, actor: 'test', source: 'test', timestamp: new Date() },
    ]

    const result = replayEvents(events, nameHandlers)

    // Names should be in the order events were processed
    expect(result?.names).toEqual(['Alice', 'Bob', 'Charlie'])
  })
})
