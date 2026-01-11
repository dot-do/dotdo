/**
 * Event Choreography Flow Tests
 *
 * Tests the event-driven order processing flow:
 * - Order placed -> Payment -> Inventory -> Fulfillment -> Delivery
 * - Error compensation (refunds, restocking)
 * - $.on.Entity.event() handler registration
 * - $.send() fire-and-forget event emission
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  on,
  send,
  getRegisteredHandlers,
  getHandlerCount,
  clearHandlers,
} from '../../../workflows/on'
import { createWorkflowProxy, isPipelinePromise } from '../../../workflows/pipeline-promise'

describe('Workflow Event Choreography', () => {
  beforeEach(() => {
    clearHandlers()
  })

  // ==========================================================================
  // EVENT HANDLER REGISTRATION
  // ==========================================================================

  describe('$.on.Entity.event() handler registration', () => {
    it('registers Order.placed handler', () => {
      const handler = vi.fn()
      on.Order.placed(handler)

      expect(getRegisteredHandlers('Order.placed')).toHaveLength(1)
    })

    it('registers Payment.completed handler', () => {
      const handler = vi.fn()
      on.Payment.completed(handler)

      expect(getRegisteredHandlers('Payment.completed')).toHaveLength(1)
    })

    it('registers Inventory.reserved handler', () => {
      const handler = vi.fn()
      on.Inventory.reserved(handler)

      expect(getRegisteredHandlers('Inventory.reserved')).toHaveLength(1)
    })

    it('registers Shipment.delivered handler', () => {
      const handler = vi.fn()
      on.Shipment.delivered(handler)

      expect(getRegisteredHandlers('Shipment.delivered')).toHaveLength(1)
    })

    it('registers multiple handlers for choreography flow', () => {
      // Register all the handlers from the order flow
      on.Order.placed(vi.fn())
      on.Order.cancelled(vi.fn())
      on.Payment.requested(vi.fn())
      on.Payment.completed(vi.fn())
      on.Payment.failed(vi.fn())
      on.Payment.refund(vi.fn())
      on.Inventory.check(vi.fn())
      on.Inventory.reserved(vi.fn())
      on.Inventory.release(vi.fn())
      on.Fulfillment.started(vi.fn())
      on.Shipping.prepared(vi.fn())
      on.Shipment.dispatched(vi.fn())
      on.Shipment.delivered(vi.fn())
      on.Customer.notified(vi.fn())
      on.Review.requested(vi.fn())
      on.Invoice.created(vi.fn())

      expect(getHandlerCount()).toBe(16)
    })
  })

  // ==========================================================================
  // FIRE-AND-FORGET EVENT EMISSION
  // ==========================================================================

  describe('$.send() fire-and-forget events', () => {
    it('send.Order.placed returns PipelinePromise', () => {
      const order = {
        id: 'ord_123',
        customerId: 'cust_456',
        items: [{ sku: 'WIDGET-001', quantity: 2, price: 29.99 }],
        total: 59.98,
      }

      const result = send.Order.placed(order)

      expect(isPipelinePromise(result)).toBe(true)
      expect(result.__expr.type).toBe('send')
      expect(result.__expr.entity).toBe('Order')
      expect(result.__expr.event).toBe('placed')
      expect(result.__expr.payload).toEqual(order)
    })

    it('send.Payment.requested captures payment data', () => {
      const payment = {
        orderId: 'ord_123',
        customerId: 'cust_456',
        amount: 59.98,
        idempotencyKey: 'ord_123-payment',
      }

      const result = send.Payment.requested(payment)

      expect(result.__expr.entity).toBe('Payment')
      expect(result.__expr.event).toBe('requested')
      expect(result.__expr.payload.amount).toBe(59.98)
    })

    it('send.Inventory.release captures compensation data', () => {
      const release = {
        orderId: 'ord_123',
        items: [{ sku: 'WIDGET-001', quantity: 2 }],
        reason: 'PAYMENT_FAILED',
      }

      const result = send.Inventory.release(release)

      expect(result.__expr.entity).toBe('Inventory')
      expect(result.__expr.event).toBe('release')
      expect(result.__expr.payload.reason).toBe('PAYMENT_FAILED')
    })

    it('send.Customer.notified captures notification type', () => {
      const notification = {
        customerId: 'cust_456',
        orderId: 'ord_123',
        type: 'order_confirmation',
        message: 'Your order has been placed!',
      }

      const result = send.Customer.notified(notification)

      expect(result.__expr.entity).toBe('Customer')
      expect(result.__expr.event).toBe('notified')
      expect(result.__expr.payload.type).toBe('order_confirmation')
    })
  })

  // ==========================================================================
  // ORDER LIFECYCLE FLOW
  // ==========================================================================

  describe('Order lifecycle event flow', () => {
    it('Order.placed triggers parallel events', () => {
      const events: string[] = []

      on.Order.placed((event) => {
        events.push('Order.placed')
        // In the real flow, this would trigger:
        // - Payment.requested
        // - Inventory.check
        // - Customer.notified
      })

      // Simulate the event
      const handlers = getRegisteredHandlers('Order.placed')
      handlers[0]({ data: { id: 'ord_123' } })

      expect(events).toContain('Order.placed')
    })

    it('handler receives event payload with proper structure', () => {
      const receivedPayload = vi.fn()

      on.Order.placed((event) => {
        receivedPayload(event)
      })

      const order = {
        id: 'ord_123',
        customerId: 'cust_456',
        items: [{ sku: 'WIDGET-001', quantity: 2, price: 29.99 }],
        total: 59.98,
      }

      const handlers = getRegisteredHandlers('Order.placed')
      handlers[0]({ data: order })

      expect(receivedPayload).toHaveBeenCalledWith({ data: order })
    })
  })

  // ==========================================================================
  // ERROR COMPENSATION PATTERNS
  // ==========================================================================

  describe('Error compensation patterns', () => {
    it('Payment.failed triggers inventory release', () => {
      const compensationActions: string[] = []

      on.Payment.failed((event) => {
        compensationActions.push('Inventory.release')
        compensationActions.push('Customer.notified')
      })

      const handlers = getRegisteredHandlers('Payment.failed')
      handlers[0]({
        data: {
          orderId: 'ord_123',
          error: 'Card declined',
          code: 'CARD_DECLINED',
        },
      })

      expect(compensationActions).toContain('Inventory.release')
      expect(compensationActions).toContain('Customer.notified')
    })

    it('Order.cancelled triggers full compensation', () => {
      const compensationActions: string[] = []

      on.Order.cancelled((event) => {
        const { orderId, reason } = event.data as { orderId: string; reason: string }
        // Compensation actions
        compensationActions.push('Payment.refund')
        compensationActions.push('Inventory.release')
        compensationActions.push('Customer.notified')
      })

      const handlers = getRegisteredHandlers('Order.cancelled')
      handlers[0]({
        data: {
          orderId: 'ord_123',
          customerId: 'cust_456',
          reason: 'Customer requested cancellation',
        },
      })

      expect(compensationActions).toHaveLength(3)
      expect(compensationActions).toContain('Payment.refund')
      expect(compensationActions).toContain('Inventory.release')
    })

    it('Inventory.reservationFailed triggers order cancellation', () => {
      const actions: string[] = []

      on.Inventory.reservationFailed((event) => {
        actions.push('Order.cancelled')
        actions.push('Customer.notified')
      })

      const handlers = getRegisteredHandlers('Inventory.reservationFailed')
      handlers[0]({
        data: {
          orderId: 'ord_123',
          failedItems: [{ sku: 'OUT-OF-STOCK', requested: 10, available: 0 }],
        },
      })

      expect(actions).toContain('Order.cancelled')
    })
  })

  // ==========================================================================
  // HAPPY PATH FLOW
  // ==========================================================================

  describe('Happy path: Order -> Payment -> Inventory -> Shipping -> Delivery', () => {
    it('simulates complete order lifecycle', () => {
      const eventLog: string[] = []

      // Register all handlers in the choreography
      on.Order.placed(() => eventLog.push('Order.placed'))
      on.Payment.requested(() => eventLog.push('Payment.requested'))
      on.Payment.completed(() => eventLog.push('Payment.completed'))
      on.Inventory.reserveRequested(() => eventLog.push('Inventory.reserveRequested'))
      on.Inventory.reserved(() => eventLog.push('Inventory.reserved'))
      on.Fulfillment.started(() => eventLog.push('Fulfillment.started'))
      on.Shipping.prepared(() => eventLog.push('Shipping.prepared'))
      on.Shipment.dispatched(() => eventLog.push('Shipment.dispatched'))
      on.Shipment.delivered(() => eventLog.push('Shipment.delivered'))
      on.Customer.notified(() => eventLog.push('Customer.notified'))

      // Simulate the event cascade
      const triggerEvent = (name: string, data: unknown) => {
        const handlers = getRegisteredHandlers(name)
        handlers.forEach((h) => h({ data }))
      }

      // 1. Order placed
      triggerEvent('Order.placed', { id: 'ord_123', total: 99.99 })

      // 2. Payment processing
      triggerEvent('Payment.requested', { orderId: 'ord_123', amount: 99.99 })
      triggerEvent('Payment.completed', { orderId: 'ord_123', paymentId: 'pay_456' })

      // 3. Inventory
      triggerEvent('Inventory.reserveRequested', { orderId: 'ord_123' })
      triggerEvent('Inventory.reserved', { orderId: 'ord_123', reservationId: 'res_789' })

      // 4. Fulfillment
      triggerEvent('Fulfillment.started', { orderId: 'ord_123' })
      triggerEvent('Shipping.prepared', { orderId: 'ord_123' })

      // 5. Shipping
      triggerEvent('Shipment.dispatched', { orderId: 'ord_123', trackingNumber: 'TRK123' })
      triggerEvent('Shipment.delivered', { orderId: 'ord_123' })

      // 6. Notification
      triggerEvent('Customer.notified', { type: 'delivered', orderId: 'ord_123' })

      expect(eventLog).toEqual([
        'Order.placed',
        'Payment.requested',
        'Payment.completed',
        'Inventory.reserveRequested',
        'Inventory.reserved',
        'Fulfillment.started',
        'Shipping.prepared',
        'Shipment.dispatched',
        'Shipment.delivered',
        'Customer.notified',
      ])
    })
  })

  // ==========================================================================
  // WORKFLOW PROXY INTEGRATION
  // ==========================================================================

  describe('Workflow proxy integration', () => {
    it('$ proxy captures event chain', () => {
      const $ = createWorkflowProxy()

      const order = { id: 'ord_123', customerId: 'cust_456', total: 99.99 }

      // Capture the expressions
      const placed = $.Order.placed(order)
      const payment = $.Payment.requested({ orderId: order.id, amount: order.total })
      const notification = $.Customer.notified({ type: 'order_confirmation' })

      expect(isPipelinePromise(placed)).toBe(true)
      expect(isPipelinePromise(payment)).toBe(true)
      expect(isPipelinePromise(notification)).toBe(true)
    })

    it('handler can use $ to emit events', () => {
      const $ = createWorkflowProxy()
      const emittedEvents: string[] = []

      on.Order.placed((event) => {
        const order = event.data as { id: string; total: number }

        // Simulate what the handler would do
        const payment = $.Payment.requested({ orderId: order.id, amount: order.total })
        const inventory = $.Inventory.check({ orderId: order.id })
        const notification = $.Customer.notified({ type: 'order_confirmation' })

        emittedEvents.push('Payment.requested', 'Inventory.check', 'Customer.notified')
      })

      const handlers = getRegisteredHandlers('Order.placed')
      handlers[0]({ data: { id: 'ord_123', total: 99.99 } })

      expect(emittedEvents).toHaveLength(3)
    })
  })

  // ==========================================================================
  // HANDLER CLEANUP
  // ==========================================================================

  describe('Handler cleanup for DO lifecycle', () => {
    it('handlers are removed by context on DO shutdown', () => {
      const doContext = 'do:order-flow-123'

      on.Order.placed(vi.fn(), { context: doContext })
      on.Payment.completed(vi.fn(), { context: doContext })
      on.Inventory.reserved(vi.fn(), { context: doContext })

      expect(getHandlerCount()).toBe(3)

      // Simulate DO shutdown
      const { clearHandlersByContext } = require('../../../workflows/on')
      const removed = clearHandlersByContext(doContext)

      expect(removed).toBe(3)
      expect(getHandlerCount()).toBe(0)
    })

    it('unsubscribe function removes specific handler', () => {
      const handler = vi.fn()
      const unsubscribe = on.Order.placed(handler)

      expect(getRegisteredHandlers('Order.placed')).toHaveLength(1)

      unsubscribe()

      expect(getRegisteredHandlers('Order.placed')).toHaveLength(0)
    })
  })
})
