/**
 * Order Lifecycle Tests - TDD RED Phase
 *
 * Tests for the order primitive providing:
 * - Order creation from cart
 * - Order state machine (pending -> paid -> shipped -> delivered)
 * - Order line items and totals
 * - Payment and refund tracking
 * - Shipping and fulfillment
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createOrderManager,
  type OrderManager,
  type Order,
  type OrderStatus,
  type OrderLineItem,
  type PaymentInfo,
  type ShippingInfo,
  type OrderTransition,
} from '../orders'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestOrderManager(): OrderManager {
  return createOrderManager()
}

const sampleLineItems: Omit<OrderLineItem, 'id'>[] = [
  {
    productId: 'prod-1',
    variantId: 'var-1',
    name: 'Blue T-Shirt',
    quantity: 2,
    unitPrice: 2999,
    totalPrice: 5998,
    sku: 'TSHIRT-BLUE-M',
  },
  {
    productId: 'prod-2',
    variantId: 'var-2',
    name: 'Black Jeans',
    quantity: 1,
    unitPrice: 5999,
    totalPrice: 5999,
    sku: 'JEANS-BLACK-32',
  },
]

// =============================================================================
// Order Creation Tests
// =============================================================================

describe('OrderManager', () => {
  describe('order creation', () => {
    let orderManager: OrderManager

    beforeEach(() => {
      orderManager = createTestOrderManager()
    })

    it('should create an order', async () => {
      const order = await orderManager.createOrder({
        customerId: 'cust-123',
        lineItems: sampleLineItems,
        shippingAddress: {
          line1: '123 Main St',
          city: 'New York',
          state: 'NY',
          postalCode: '10001',
          country: 'US',
        },
      })

      expect(order.id).toBeDefined()
      expect(order.orderNumber).toBeDefined()
      expect(order.status).toBe('pending')
      expect(order.customerId).toBe('cust-123')
      expect(order.lineItems).toHaveLength(2)
      expect(order.createdAt).toBeInstanceOf(Date)
    })

    it('should generate unique order numbers', async () => {
      const order1 = await orderManager.createOrder({
        customerId: 'cust-1',
        lineItems: sampleLineItems,
      })
      const order2 = await orderManager.createOrder({
        customerId: 'cust-2',
        lineItems: sampleLineItems,
      })

      expect(order1.orderNumber).not.toBe(order2.orderNumber)
    })

    it('should calculate order totals', async () => {
      const order = await orderManager.createOrder({
        customerId: 'cust-123',
        lineItems: sampleLineItems,
      })

      expect(order.subtotal).toBe(11997) // 5998 + 5999
      expect(order.total).toBe(11997) // No tax or shipping yet
    })

    it('should apply shipping cost', async () => {
      const order = await orderManager.createOrder({
        customerId: 'cust-123',
        lineItems: sampleLineItems,
        shippingCost: 999,
      })

      expect(order.shippingCost).toBe(999)
      expect(order.total).toBe(12996) // 11997 + 999
    })

    it('should apply tax', async () => {
      const order = await orderManager.createOrder({
        customerId: 'cust-123',
        lineItems: sampleLineItems,
        taxAmount: 1000,
      })

      expect(order.taxAmount).toBe(1000)
      expect(order.total).toBe(12997) // 11997 + 1000
    })

    it('should apply discount', async () => {
      const order = await orderManager.createOrder({
        customerId: 'cust-123',
        lineItems: sampleLineItems,
        discountAmount: 500,
        discountCode: 'SAVE5',
      })

      expect(order.discountAmount).toBe(500)
      expect(order.discountCode).toBe('SAVE5')
      expect(order.total).toBe(11497) // 11997 - 500
    })

    it('should get order by id', async () => {
      const created = await orderManager.createOrder({
        customerId: 'cust-123',
        lineItems: sampleLineItems,
      })

      const retrieved = await orderManager.getOrder(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should get order by order number', async () => {
      const created = await orderManager.createOrder({
        customerId: 'cust-123',
        lineItems: sampleLineItems,
      })

      const retrieved = await orderManager.getOrderByNumber(created.orderNumber)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.orderNumber).toBe(created.orderNumber)
    })

    it('should list orders by customer', async () => {
      await orderManager.createOrder({
        customerId: 'cust-multi',
        lineItems: sampleLineItems,
      })
      await orderManager.createOrder({
        customerId: 'cust-multi',
        lineItems: sampleLineItems,
      })
      await orderManager.createOrder({
        customerId: 'cust-other',
        lineItems: sampleLineItems,
      })

      const orders = await orderManager.getOrdersByCustomer('cust-multi')

      expect(orders).toHaveLength(2)
    })

    it('should store billing and shipping addresses', async () => {
      const order = await orderManager.createOrder({
        customerId: 'cust-123',
        lineItems: sampleLineItems,
        shippingAddress: {
          line1: '123 Ship St',
          city: 'Ship City',
          state: 'SC',
          postalCode: '12345',
          country: 'US',
        },
        billingAddress: {
          line1: '456 Bill St',
          city: 'Bill City',
          state: 'BC',
          postalCode: '67890',
          country: 'US',
        },
      })

      expect(order.shippingAddress?.city).toBe('Ship City')
      expect(order.billingAddress?.city).toBe('Bill City')
    })
  })

  // =============================================================================
  // Order State Machine Tests
  // =============================================================================

  describe('order state machine', () => {
    let orderManager: OrderManager
    let orderId: string

    beforeEach(async () => {
      orderManager = createTestOrderManager()
      const order = await orderManager.createOrder({
        customerId: 'cust-123',
        lineItems: sampleLineItems,
      })
      orderId = order.id
    })

    it('should start in pending status', async () => {
      const order = await orderManager.getOrder(orderId)
      expect(order?.status).toBe('pending')
    })

    it('should transition pending -> paid', async () => {
      const order = await orderManager.transitionTo(orderId, 'paid', {
        paymentId: 'pay-123',
        paymentMethod: 'card',
      })

      expect(order.status).toBe('paid')
      expect(order.paidAt).toBeInstanceOf(Date)
    })

    it('should transition paid -> processing', async () => {
      await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })
      const order = await orderManager.transitionTo(orderId, 'processing')

      expect(order.status).toBe('processing')
    })

    it('should transition processing -> shipped', async () => {
      await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })
      await orderManager.transitionTo(orderId, 'processing')
      const order = await orderManager.transitionTo(orderId, 'shipped', {
        trackingNumber: 'TRACK123',
        carrier: 'UPS',
      })

      expect(order.status).toBe('shipped')
      expect(order.shippedAt).toBeInstanceOf(Date)
    })

    it('should transition shipped -> delivered', async () => {
      await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })
      await orderManager.transitionTo(orderId, 'processing')
      await orderManager.transitionTo(orderId, 'shipped', { trackingNumber: 'TRACK123' })
      const order = await orderManager.transitionTo(orderId, 'delivered')

      expect(order.status).toBe('delivered')
      expect(order.deliveredAt).toBeInstanceOf(Date)
    })

    it('should allow pending -> cancelled', async () => {
      const order = await orderManager.transitionTo(orderId, 'cancelled', {
        reason: 'Customer requested cancellation',
      })

      expect(order.status).toBe('cancelled')
      expect(order.cancelledAt).toBeInstanceOf(Date)
      expect(order.cancellationReason).toBe('Customer requested cancellation')
    })

    it('should allow paid -> refunded', async () => {
      await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })
      const order = await orderManager.transitionTo(orderId, 'refunded', {
        refundId: 'refund-123',
        refundAmount: 11997,
      })

      expect(order.status).toBe('refunded')
      expect(order.refundedAt).toBeInstanceOf(Date)
    })

    it('should reject invalid transitions', async () => {
      // Cannot go directly from pending to shipped
      await expect(
        orderManager.transitionTo(orderId, 'shipped')
      ).rejects.toThrow('Invalid transition')
    })

    it('should reject transition from terminal states', async () => {
      await orderManager.transitionTo(orderId, 'cancelled')

      await expect(
        orderManager.transitionTo(orderId, 'paid')
      ).rejects.toThrow('Cannot transition from cancelled')
    })

    it('should track status history', async () => {
      await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })
      await orderManager.transitionTo(orderId, 'processing')
      await orderManager.transitionTo(orderId, 'shipped', { trackingNumber: 'TRACK123' })

      const order = await orderManager.getOrder(orderId)
      const history = order?.statusHistory

      expect(history).toHaveLength(4) // pending -> paid -> processing -> shipped
      expect(history?.[0].status).toBe('pending')
      expect(history?.[1].status).toBe('paid')
      expect(history?.[2].status).toBe('processing')
      expect(history?.[3].status).toBe('shipped')
    })

    it('should record transition timestamps', async () => {
      await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })

      const order = await orderManager.getOrder(orderId)
      const lastTransition = order?.statusHistory?.slice(-1)[0]

      expect(lastTransition?.timestamp).toBeInstanceOf(Date)
      expect(lastTransition?.metadata?.paymentId).toBe('pay-123')
    })

    it('should get valid next transitions', async () => {
      const transitions = await orderManager.getValidTransitions(orderId)

      expect(transitions).toContain('paid')
      expect(transitions).toContain('cancelled')
      expect(transitions).not.toContain('shipped')
    })
  })

  // =============================================================================
  // Payment Tests
  // =============================================================================

  describe('payment handling', () => {
    let orderManager: OrderManager
    let orderId: string

    beforeEach(async () => {
      orderManager = createTestOrderManager()
      const order = await orderManager.createOrder({
        customerId: 'cust-123',
        lineItems: sampleLineItems,
      })
      orderId = order.id
    })

    it('should record payment information', async () => {
      await orderManager.recordPayment(orderId, {
        paymentId: 'pay-123',
        amount: 11997,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })

      const order = await orderManager.getOrder(orderId)

      expect(order?.payment).toBeDefined()
      expect(order?.payment?.paymentId).toBe('pay-123')
      expect(order?.payment?.amount).toBe(11997)
      expect(order?.status).toBe('paid')
    })

    it('should handle partial payment', async () => {
      await orderManager.recordPayment(orderId, {
        paymentId: 'pay-partial',
        amount: 5000,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })

      const order = await orderManager.getOrder(orderId)

      expect(order?.payment?.amount).toBe(5000)
      expect(order?.status).toBe('partially_paid')
      expect(order?.amountDue).toBe(6997) // 11997 - 5000
    })

    it('should record payment failure', async () => {
      await orderManager.recordPaymentFailure(orderId, {
        paymentId: 'pay-failed',
        reason: 'Card declined',
        code: 'card_declined',
      })

      const order = await orderManager.getOrder(orderId)

      expect(order?.paymentFailures).toHaveLength(1)
      expect(order?.paymentFailures?.[0].reason).toBe('Card declined')
      expect(order?.status).toBe('pending') // Still pending after failure
    })

    it('should process refund', async () => {
      await orderManager.recordPayment(orderId, {
        paymentId: 'pay-123',
        amount: 11997,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })

      const refund = await orderManager.processRefund(orderId, {
        amount: 5000,
        reason: 'Item returned',
        refundId: 'refund-123',
      })

      expect(refund.amount).toBe(5000)

      const order = await orderManager.getOrder(orderId)
      expect(order?.refunds).toHaveLength(1)
      expect(order?.totalRefunded).toBe(5000)
    })

    it('should handle full refund', async () => {
      await orderManager.recordPayment(orderId, {
        paymentId: 'pay-123',
        amount: 11997,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })

      await orderManager.processRefund(orderId, {
        amount: 11997,
        reason: 'Order cancelled',
        refundId: 'refund-full',
      })

      const order = await orderManager.getOrder(orderId)
      expect(order?.status).toBe('refunded')
    })

    it('should reject refund exceeding paid amount', async () => {
      await orderManager.recordPayment(orderId, {
        paymentId: 'pay-123',
        amount: 5000,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })

      await expect(
        orderManager.processRefund(orderId, {
          amount: 6000,
          reason: 'Too much',
          refundId: 'refund-excess',
        })
      ).rejects.toThrow('Refund amount exceeds paid amount')
    })
  })

  // =============================================================================
  // Shipping and Fulfillment Tests
  // =============================================================================

  describe('shipping and fulfillment', () => {
    let orderManager: OrderManager
    let orderId: string

    beforeEach(async () => {
      orderManager = createTestOrderManager()
      const order = await orderManager.createOrder({
        customerId: 'cust-123',
        lineItems: sampleLineItems,
      })
      orderId = order.id
      await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })
      await orderManager.transitionTo(orderId, 'processing')
    })

    it('should add tracking information', async () => {
      await orderManager.addTracking(orderId, {
        carrier: 'UPS',
        trackingNumber: 'TRACK123456',
        trackingUrl: 'https://ups.com/track/TRACK123456',
      })

      const order = await orderManager.getOrder(orderId)

      expect(order?.tracking).toBeDefined()
      expect(order?.tracking?.carrier).toBe('UPS')
      expect(order?.tracking?.trackingNumber).toBe('TRACK123456')
    })

    it('should support multiple shipments', async () => {
      await orderManager.addShipment(orderId, {
        lineItems: [{ lineItemId: 'item-1', quantity: 1 }],
        carrier: 'UPS',
        trackingNumber: 'TRACK1',
      })
      await orderManager.addShipment(orderId, {
        lineItems: [{ lineItemId: 'item-2', quantity: 1 }],
        carrier: 'FedEx',
        trackingNumber: 'TRACK2',
      })

      const order = await orderManager.getOrder(orderId)

      expect(order?.shipments).toHaveLength(2)
    })

    it('should track fulfillment status per line item', async () => {
      const order = await orderManager.createOrder({
        customerId: 'cust-fulfillment',
        lineItems: sampleLineItems,
      })
      await orderManager.transitionTo(order.id, 'paid', { paymentId: 'pay-123' })
      await orderManager.transitionTo(order.id, 'processing')

      // Fulfill first item
      await orderManager.fulfillLineItem(order.id, order.lineItems[0].id, {
        quantity: 2,
        shipmentId: 'ship-1',
      })

      const updated = await orderManager.getOrder(order.id)
      expect(updated?.lineItems[0].fulfilledQuantity).toBe(2)
      expect(updated?.lineItems[1].fulfilledQuantity).toBe(0)
      expect(updated?.fulfillmentStatus).toBe('partial')
    })

    it('should mark order fully fulfilled', async () => {
      const order = await orderManager.createOrder({
        customerId: 'cust-full-fulfill',
        lineItems: sampleLineItems,
      })
      await orderManager.transitionTo(order.id, 'paid', { paymentId: 'pay-123' })
      await orderManager.transitionTo(order.id, 'processing')

      // Fulfill all items
      for (const item of order.lineItems) {
        await orderManager.fulfillLineItem(order.id, item.id, {
          quantity: item.quantity,
          shipmentId: 'ship-1',
        })
      }

      const updated = await orderManager.getOrder(order.id)
      expect(updated?.fulfillmentStatus).toBe('fulfilled')
    })

    it('should estimate delivery date', async () => {
      await orderManager.addTracking(orderId, {
        carrier: 'UPS',
        trackingNumber: 'TRACK123',
        estimatedDelivery: new Date('2024-12-25'),
      })

      const order = await orderManager.getOrder(orderId)
      expect(order?.tracking?.estimatedDelivery).toBeInstanceOf(Date)
    })
  })

  // =============================================================================
  // Order Notes and Updates Tests
  // =============================================================================

  describe('order notes and updates', () => {
    let orderManager: OrderManager
    let orderId: string

    beforeEach(async () => {
      orderManager = createTestOrderManager()
      const order = await orderManager.createOrder({
        customerId: 'cust-123',
        lineItems: sampleLineItems,
      })
      orderId = order.id
    })

    it('should add internal note', async () => {
      await orderManager.addNote(orderId, {
        content: 'Customer called about delivery',
        type: 'internal',
        author: 'support@example.com',
      })

      const order = await orderManager.getOrder(orderId)

      expect(order?.notes).toHaveLength(1)
      expect(order?.notes?.[0].content).toBe('Customer called about delivery')
      expect(order?.notes?.[0].type).toBe('internal')
    })

    it('should add customer-visible note', async () => {
      await orderManager.addNote(orderId, {
        content: 'Your order is being prepared!',
        type: 'customer',
      })

      const order = await orderManager.getOrder(orderId)
      const customerNotes = order?.notes?.filter((n) => n.type === 'customer')

      expect(customerNotes).toHaveLength(1)
    })

    it('should update order metadata', async () => {
      await orderManager.updateMetadata(orderId, {
        source: 'web',
        campaign: 'holiday-sale',
        referrer: 'google',
      })

      const order = await orderManager.getOrder(orderId)

      expect(order?.metadata?.source).toBe('web')
      expect(order?.metadata?.campaign).toBe('holiday-sale')
    })

    it('should update shipping address before shipment', async () => {
      await orderManager.updateShippingAddress(orderId, {
        line1: '456 New Address',
        city: 'New City',
        state: 'NC',
        postalCode: '54321',
        country: 'US',
      })

      const order = await orderManager.getOrder(orderId)
      expect(order?.shippingAddress?.city).toBe('New City')
    })

    it('should reject address update after shipping', async () => {
      await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })
      await orderManager.transitionTo(orderId, 'processing')
      await orderManager.transitionTo(orderId, 'shipped', { trackingNumber: 'TRACK' })

      await expect(
        orderManager.updateShippingAddress(orderId, {
          line1: 'Too Late',
          city: 'City',
          state: 'ST',
          postalCode: '12345',
          country: 'US',
        })
      ).rejects.toThrow('Cannot update address after shipping')
    })
  })

  // =============================================================================
  // Order Search and Query Tests
  // =============================================================================

  describe('order search and query', () => {
    let orderManager: OrderManager

    beforeEach(async () => {
      orderManager = createTestOrderManager()

      // Create test orders
      const order1 = await orderManager.createOrder({
        customerId: 'cust-1',
        lineItems: sampleLineItems,
      })
      await orderManager.transitionTo(order1.id, 'paid', { paymentId: 'pay-1' })

      const order2 = await orderManager.createOrder({
        customerId: 'cust-2',
        lineItems: sampleLineItems,
      })
      await orderManager.transitionTo(order2.id, 'paid', { paymentId: 'pay-2' })
      await orderManager.transitionTo(order2.id, 'processing')
      await orderManager.transitionTo(order2.id, 'shipped', { trackingNumber: 'TRACK' })

      await orderManager.createOrder({
        customerId: 'cust-3',
        lineItems: sampleLineItems,
      })
    })

    it('should filter orders by status', async () => {
      const paidOrders = await orderManager.queryOrders({ status: 'paid' })
      expect(paidOrders).toHaveLength(1)

      const pendingOrders = await orderManager.queryOrders({ status: 'pending' })
      expect(pendingOrders).toHaveLength(1)
    })

    it('should filter orders by date range', async () => {
      const today = new Date()
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)

      const orders = await orderManager.queryOrders({
        createdAfter: yesterday,
        createdBefore: tomorrow,
      })

      expect(orders.length).toBe(3)
    })

    it('should filter orders by total amount', async () => {
      const orders = await orderManager.queryOrders({
        totalMin: 10000,
        totalMax: 15000,
      })

      expect(orders.length).toBe(3) // All have same total
    })

    it('should paginate results', async () => {
      const page1 = await orderManager.queryOrders({}, { limit: 2, offset: 0 })
      const page2 = await orderManager.queryOrders({}, { limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(1)
    })

    it('should sort results', async () => {
      const ascending = await orderManager.queryOrders(
        {},
        { sortBy: 'createdAt', sortOrder: 'asc' }
      )
      const descending = await orderManager.queryOrders(
        {},
        { sortBy: 'createdAt', sortOrder: 'desc' }
      )

      expect(ascending[0].createdAt.getTime()).toBeLessThanOrEqual(
        ascending[ascending.length - 1].createdAt.getTime()
      )
      expect(descending[0].createdAt.getTime()).toBeGreaterThanOrEqual(
        descending[descending.length - 1].createdAt.getTime()
      )
    })

    it('should search by order number', async () => {
      const orders = await orderManager.queryOrders({})
      const targetNumber = orders[0].orderNumber

      const found = await orderManager.queryOrders({
        orderNumber: targetNumber,
      })

      expect(found).toHaveLength(1)
      expect(found[0].orderNumber).toBe(targetNumber)
    })
  })
})
