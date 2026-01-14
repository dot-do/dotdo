/**
 * Order Lifecycle Integration Tests
 *
 * Comprehensive tests for order lifecycle management including:
 * - Order creation with various configurations
 * - Status transitions and state machine validation
 * - Payment integration (record payment, partial payments, failures)
 * - Fulfillment states (tracking, shipments, line item fulfillment)
 * - Refunds and returns
 * - Full lifecycle scenarios
 *
 * These tests verify the existing OrderManager implementation.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createOrderManager,
  createCartManager,
  type OrderManager,
  type CartManager,
  type Order,
  type OrderStatus,
  type CreateOrderInput,
} from '../index'

// =============================================================================
// Test Fixtures
// =============================================================================

const testAddress = {
  line1: '123 Main St',
  line2: 'Apt 4B',
  city: 'New York',
  state: 'NY',
  postalCode: '10001',
  country: 'US',
}

const testLineItems = [
  {
    productId: 'prod-001',
    variantId: 'var-001',
    name: 'Blue T-Shirt (Medium)',
    sku: 'TSHIRT-BLUE-M',
    quantity: 2,
    unitPrice: 2999,
    totalPrice: 5998,
  },
  {
    productId: 'prod-002',
    variantId: 'var-002',
    name: 'Black Jeans (32x32)',
    sku: 'JEANS-BLACK-32',
    quantity: 1,
    unitPrice: 5999,
    totalPrice: 5999,
  },
  {
    productId: 'prod-003',
    variantId: 'var-003',
    name: 'White Sneakers (Size 10)',
    sku: 'SNEAKERS-WHITE-10',
    quantity: 1,
    unitPrice: 8999,
    totalPrice: 8999,
  },
]

function createTestOrder(orderManager: OrderManager, overrides?: Partial<CreateOrderInput>) {
  return orderManager.createOrder({
    customerId: 'cust-test-123',
    lineItems: testLineItems,
    shippingAddress: testAddress,
    billingAddress: testAddress,
    ...overrides,
  })
}

// =============================================================================
// Order Creation Tests
// =============================================================================

describe('Order Lifecycle Integration', () => {
  describe('order creation', () => {
    let orderManager: OrderManager

    beforeEach(() => {
      orderManager = createOrderManager()
    })

    it('should create order with all required fields', async () => {
      const order = await createTestOrder(orderManager)

      expect(order.id).toBeDefined()
      expect(order.id).toMatch(/^order_/)
      expect(order.orderNumber).toBeDefined()
      expect(order.orderNumber).toMatch(/^ORD-/)
      expect(order.customerId).toBe('cust-test-123')
      expect(order.status).toBe('pending')
      expect(order.createdAt).toBeInstanceOf(Date)
      expect(order.updatedAt).toBeInstanceOf(Date)
    })

    it('should assign unique IDs to line items', async () => {
      const order = await createTestOrder(orderManager)

      expect(order.lineItems).toHaveLength(3)
      const lineItemIds = order.lineItems.map((item) => item.id)
      const uniqueIds = new Set(lineItemIds)
      expect(uniqueIds.size).toBe(3)
      lineItemIds.forEach((id) => expect(id).toMatch(/^line_/))
    })

    it('should calculate subtotal from line items', async () => {
      const order = await createTestOrder(orderManager)

      // 5998 + 5999 + 8999 = 20996
      expect(order.subtotal).toBe(20996)
    })

    it('should calculate total with shipping and tax', async () => {
      const order = await orderManager.createOrder({
        customerId: 'cust-123',
        lineItems: testLineItems,
        shippingCost: 999,
        taxAmount: 1680,
      })

      // Subtotal: 20996, Shipping: 999, Tax: 1680 = 23675
      expect(order.subtotal).toBe(20996)
      expect(order.shippingCost).toBe(999)
      expect(order.taxAmount).toBe(1680)
      expect(order.total).toBe(23675)
    })

    it('should calculate total with discount applied', async () => {
      const order = await orderManager.createOrder({
        customerId: 'cust-123',
        lineItems: testLineItems,
        shippingCost: 999,
        taxAmount: 1680,
        discountAmount: 2000,
        discountCode: 'SAVE20',
      })

      // 20996 + 999 + 1680 - 2000 = 21675
      expect(order.total).toBe(21675)
      expect(order.discountCode).toBe('SAVE20')
    })

    it('should set initial amount due to total', async () => {
      const order = await createTestOrder(orderManager)

      expect(order.amountDue).toBe(order.total)
    })

    it('should initialize fulfillment status as unfulfilled', async () => {
      const order = await createTestOrder(orderManager)

      expect(order.fulfillmentStatus).toBe('unfulfilled')
    })

    it('should initialize status history with pending', async () => {
      const order = await createTestOrder(orderManager)

      expect(order.statusHistory).toBeDefined()
      expect(order.statusHistory).toHaveLength(1)
      expect(order.statusHistory![0].status).toBe('pending')
      expect(order.statusHistory![0].timestamp).toBeInstanceOf(Date)
    })

    it('should initialize empty arrays for notes, refunds, etc.', async () => {
      const order = await createTestOrder(orderManager)

      expect(order.notes).toEqual([])
      expect(order.refunds).toEqual([])
      expect(order.paymentFailures).toEqual([])
      expect(order.shipments).toEqual([])
    })

    it('should store metadata when provided', async () => {
      const order = await orderManager.createOrder({
        customerId: 'cust-123',
        lineItems: testLineItems,
        metadata: {
          source: 'web',
          campaign: 'holiday-2024',
          referrer: 'google',
        },
      })

      expect(order.metadata).toEqual({
        source: 'web',
        campaign: 'holiday-2024',
        referrer: 'google',
      })
    })

    it('should create multiple orders for same customer', async () => {
      const order1 = await createTestOrder(orderManager)
      const order2 = await createTestOrder(orderManager)
      const order3 = await createTestOrder(orderManager)

      const customerOrders = await orderManager.getOrdersByCustomer('cust-test-123')

      expect(customerOrders).toHaveLength(3)
      expect(customerOrders.map((o) => o.id)).toContain(order1.id)
      expect(customerOrders.map((o) => o.id)).toContain(order2.id)
      expect(customerOrders.map((o) => o.id)).toContain(order3.id)
    })
  })

  // =============================================================================
  // Status Transition Tests
  // =============================================================================

  describe('status transitions', () => {
    let orderManager: OrderManager
    let orderId: string

    beforeEach(async () => {
      orderManager = createOrderManager()
      const order = await createTestOrder(orderManager)
      orderId = order.id
    })

    describe('valid transitions from pending', () => {
      it('should transition from pending to paid', async () => {
        const order = await orderManager.transitionTo(orderId, 'paid', {
          paymentId: 'pay-123',
          paymentMethod: 'card',
        })

        expect(order.status).toBe('paid')
        expect(order.paidAt).toBeInstanceOf(Date)
      })

      it('should transition from pending to partially_paid', async () => {
        const order = await orderManager.transitionTo(orderId, 'partially_paid')

        expect(order.status).toBe('partially_paid')
      })

      it('should transition from pending to cancelled', async () => {
        const order = await orderManager.transitionTo(orderId, 'cancelled', {
          reason: 'Customer requested cancellation',
        })

        expect(order.status).toBe('cancelled')
        expect(order.cancelledAt).toBeInstanceOf(Date)
        expect(order.cancellationReason).toBe('Customer requested cancellation')
      })
    })

    describe('valid transitions from paid', () => {
      beforeEach(async () => {
        await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })
      })

      it('should transition from paid to processing', async () => {
        const order = await orderManager.transitionTo(orderId, 'processing')

        expect(order.status).toBe('processing')
      })

      it('should transition from paid to cancelled', async () => {
        const order = await orderManager.transitionTo(orderId, 'cancelled', {
          reason: 'Fraud detected',
        })

        expect(order.status).toBe('cancelled')
      })

      it('should transition from paid to refunded', async () => {
        const order = await orderManager.transitionTo(orderId, 'refunded')

        expect(order.status).toBe('refunded')
        expect(order.refundedAt).toBeInstanceOf(Date)
      })
    })

    describe('valid transitions from processing', () => {
      beforeEach(async () => {
        await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })
        await orderManager.transitionTo(orderId, 'processing')
      })

      it('should transition from processing to shipped', async () => {
        const order = await orderManager.transitionTo(orderId, 'shipped', {
          trackingNumber: 'TRACK123456',
          carrier: 'UPS',
        })

        expect(order.status).toBe('shipped')
        expect(order.shippedAt).toBeInstanceOf(Date)
        expect(order.tracking?.trackingNumber).toBe('TRACK123456')
        expect(order.tracking?.carrier).toBe('UPS')
      })

      it('should transition from processing to cancelled', async () => {
        const order = await orderManager.transitionTo(orderId, 'cancelled', {
          reason: 'Out of stock',
        })

        expect(order.status).toBe('cancelled')
      })

      it('should transition from processing to refunded', async () => {
        const order = await orderManager.transitionTo(orderId, 'refunded')

        expect(order.status).toBe('refunded')
      })
    })

    describe('valid transitions from shipped', () => {
      beforeEach(async () => {
        await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })
        await orderManager.transitionTo(orderId, 'processing')
        await orderManager.transitionTo(orderId, 'shipped', { trackingNumber: 'TRACK123' })
      })

      it('should transition from shipped to delivered', async () => {
        const order = await orderManager.transitionTo(orderId, 'delivered')

        expect(order.status).toBe('delivered')
        expect(order.deliveredAt).toBeInstanceOf(Date)
      })

      it('should transition from shipped to refunded', async () => {
        const order = await orderManager.transitionTo(orderId, 'refunded')

        expect(order.status).toBe('refunded')
      })
    })

    describe('valid transitions from delivered', () => {
      beforeEach(async () => {
        await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })
        await orderManager.transitionTo(orderId, 'processing')
        await orderManager.transitionTo(orderId, 'shipped', { trackingNumber: 'TRACK123' })
        await orderManager.transitionTo(orderId, 'delivered')
      })

      it('should transition from delivered to refunded', async () => {
        const order = await orderManager.transitionTo(orderId, 'refunded')

        expect(order.status).toBe('refunded')
        expect(order.refundedAt).toBeInstanceOf(Date)
      })
    })

    describe('invalid transitions', () => {
      it('should reject pending to shipped', async () => {
        await expect(orderManager.transitionTo(orderId, 'shipped')).rejects.toThrow(
          'Invalid transition'
        )
      })

      it('should reject pending to delivered', async () => {
        await expect(orderManager.transitionTo(orderId, 'delivered')).rejects.toThrow(
          'Invalid transition'
        )
      })

      it('should reject pending to processing', async () => {
        await expect(orderManager.transitionTo(orderId, 'processing')).rejects.toThrow(
          'Invalid transition'
        )
      })

      it('should reject paid to shipped (must go through processing)', async () => {
        await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })

        await expect(orderManager.transitionTo(orderId, 'shipped')).rejects.toThrow(
          'Invalid transition'
        )
      })

      it('should reject paid to delivered', async () => {
        await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })

        await expect(orderManager.transitionTo(orderId, 'delivered')).rejects.toThrow(
          'Invalid transition'
        )
      })

      it('should reject processing to delivered (must go through shipped)', async () => {
        await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })
        await orderManager.transitionTo(orderId, 'processing')

        await expect(orderManager.transitionTo(orderId, 'delivered')).rejects.toThrow(
          'Invalid transition'
        )
      })
    })

    describe('terminal states', () => {
      it('should not allow transitions from cancelled', async () => {
        await orderManager.transitionTo(orderId, 'cancelled', { reason: 'Test' })

        await expect(orderManager.transitionTo(orderId, 'paid')).rejects.toThrow(
          'Cannot transition from cancelled'
        )
      })

      it('should not allow transitions from refunded', async () => {
        await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })
        await orderManager.transitionTo(orderId, 'refunded')

        await expect(orderManager.transitionTo(orderId, 'processing')).rejects.toThrow(
          'Cannot transition from refunded'
        )
      })
    })

    describe('status history tracking', () => {
      it('should maintain complete status history', async () => {
        await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })
        await orderManager.transitionTo(orderId, 'processing')
        await orderManager.transitionTo(orderId, 'shipped', { trackingNumber: 'TRACK123' })
        await orderManager.transitionTo(orderId, 'delivered')

        const order = await orderManager.getOrder(orderId)
        const history = order!.statusHistory!

        expect(history).toHaveLength(5)
        expect(history[0].status).toBe('pending')
        expect(history[1].status).toBe('paid')
        expect(history[2].status).toBe('processing')
        expect(history[3].status).toBe('shipped')
        expect(history[4].status).toBe('delivered')
      })

      it('should record transition metadata in history', async () => {
        await orderManager.transitionTo(orderId, 'paid', {
          paymentId: 'pay-999',
          paymentMethod: 'credit_card',
        })

        const order = await orderManager.getOrder(orderId)
        const paidEntry = order!.statusHistory!.find((h) => h.status === 'paid')

        expect(paidEntry?.metadata?.paymentId).toBe('pay-999')
      })

      it('should record timestamps in chronological order', async () => {
        await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })
        await orderManager.transitionTo(orderId, 'processing')

        const order = await orderManager.getOrder(orderId)
        const history = order!.statusHistory!

        for (let i = 1; i < history.length; i++) {
          expect(history[i].timestamp.getTime()).toBeGreaterThanOrEqual(
            history[i - 1].timestamp.getTime()
          )
        }
      })
    })

    describe('getValidTransitions', () => {
      it('should return valid transitions for pending order', async () => {
        const transitions = await orderManager.getValidTransitions(orderId)

        expect(transitions).toContain('paid')
        expect(transitions).toContain('partially_paid')
        expect(transitions).toContain('cancelled')
        expect(transitions).not.toContain('shipped')
        expect(transitions).not.toContain('delivered')
      })

      it('should return valid transitions for paid order', async () => {
        await orderManager.transitionTo(orderId, 'paid', { paymentId: 'pay-123' })

        const transitions = await orderManager.getValidTransitions(orderId)

        expect(transitions).toContain('processing')
        expect(transitions).toContain('cancelled')
        expect(transitions).toContain('refunded')
        expect(transitions).not.toContain('shipped')
      })

      it('should return empty array for terminal states', async () => {
        await orderManager.transitionTo(orderId, 'cancelled', { reason: 'Test' })

        const transitions = await orderManager.getValidTransitions(orderId)

        expect(transitions).toEqual([])
      })
    })
  })

  // =============================================================================
  // Payment Integration Tests
  // =============================================================================

  describe('payment integration', () => {
    let orderManager: OrderManager
    let orderId: string
    let orderTotal: number

    beforeEach(async () => {
      orderManager = createOrderManager()
      const order = await createTestOrder(orderManager)
      orderId = order.id
      orderTotal = order.total
    })

    describe('recording payments', () => {
      it('should record full payment and transition to paid', async () => {
        const order = await orderManager.recordPayment(orderId, {
          paymentId: 'pay-full-001',
          amount: orderTotal,
          method: 'credit_card',
          provider: 'stripe',
          status: 'succeeded',
        })

        expect(order.status).toBe('paid')
        expect(order.payment).toBeDefined()
        expect(order.payment?.paymentId).toBe('pay-full-001')
        expect(order.payment?.amount).toBe(orderTotal)
        expect(order.payment?.method).toBe('credit_card')
        expect(order.payment?.provider).toBe('stripe')
        expect(order.payment?.status).toBe('succeeded')
        expect(order.paidAt).toBeInstanceOf(Date)
      })

      it('should record partial payment and transition to partially_paid', async () => {
        const partialAmount = Math.floor(orderTotal / 2)

        const order = await orderManager.recordPayment(orderId, {
          paymentId: 'pay-partial-001',
          amount: partialAmount,
          method: 'credit_card',
          provider: 'stripe',
          status: 'succeeded',
        })

        expect(order.status).toBe('partially_paid')
        expect(order.payment?.amount).toBe(partialAmount)
        expect(order.amountDue).toBe(orderTotal - partialAmount)
      })

      it('should update amount due correctly', async () => {
        const paymentAmount = 5000

        const order = await orderManager.recordPayment(orderId, {
          paymentId: 'pay-001',
          amount: paymentAmount,
          method: 'card',
          provider: 'stripe',
          status: 'succeeded',
        })

        expect(order.amountDue).toBe(orderTotal - paymentAmount)
      })

      it('should handle zero amount due edge case', async () => {
        const order = await orderManager.recordPayment(orderId, {
          paymentId: 'pay-exact',
          amount: orderTotal,
          method: 'card',
          provider: 'stripe',
          status: 'succeeded',
        })

        expect(order.amountDue).toBe(0)
        expect(order.status).toBe('paid')
      })

      it('should store payment metadata', async () => {
        const order = await orderManager.recordPayment(orderId, {
          paymentId: 'pay-meta',
          amount: orderTotal,
          method: 'card',
          provider: 'stripe',
          status: 'succeeded',
          metadata: {
            last4: '4242',
            brand: 'visa',
            expiryMonth: 12,
            expiryYear: 2025,
          },
        })

        expect(order.payment?.metadata).toEqual({
          last4: '4242',
          brand: 'visa',
          expiryMonth: 12,
          expiryYear: 2025,
        })
      })
    })

    describe('payment failures', () => {
      it('should record payment failure', async () => {
        const order = await orderManager.recordPaymentFailure(orderId, {
          paymentId: 'pay-fail-001',
          reason: 'Card declined',
          code: 'card_declined',
        })

        expect(order.paymentFailures).toHaveLength(1)
        expect(order.paymentFailures![0].paymentId).toBe('pay-fail-001')
        expect(order.paymentFailures![0].reason).toBe('Card declined')
        expect(order.paymentFailures![0].code).toBe('card_declined')
        expect(order.paymentFailures![0].timestamp).toBeInstanceOf(Date)
      })

      it('should keep order in pending status after payment failure', async () => {
        const order = await orderManager.recordPaymentFailure(orderId, {
          paymentId: 'pay-fail-002',
          reason: 'Insufficient funds',
          code: 'insufficient_funds',
        })

        expect(order.status).toBe('pending')
      })

      it('should track multiple payment failures', async () => {
        await orderManager.recordPaymentFailure(orderId, {
          paymentId: 'pay-fail-1',
          reason: 'Card declined',
        })
        await orderManager.recordPaymentFailure(orderId, {
          paymentId: 'pay-fail-2',
          reason: 'Insufficient funds',
        })
        await orderManager.recordPaymentFailure(orderId, {
          paymentId: 'pay-fail-3',
          reason: 'Card expired',
        })

        const order = await orderManager.getOrder(orderId)

        expect(order!.paymentFailures).toHaveLength(3)
        expect(order!.paymentFailures![0].reason).toBe('Card declined')
        expect(order!.paymentFailures![1].reason).toBe('Insufficient funds')
        expect(order!.paymentFailures![2].reason).toBe('Card expired')
      })

      it('should allow successful payment after failures', async () => {
        await orderManager.recordPaymentFailure(orderId, {
          paymentId: 'pay-fail',
          reason: 'Card declined',
        })

        const order = await orderManager.recordPayment(orderId, {
          paymentId: 'pay-success',
          amount: orderTotal,
          method: 'card',
          provider: 'stripe',
          status: 'succeeded',
        })

        expect(order.status).toBe('paid')
        expect(order.paymentFailures).toHaveLength(1)
        expect(order.payment?.paymentId).toBe('pay-success')
      })
    })

    describe('refunds', () => {
      beforeEach(async () => {
        // Pay for the order first
        await orderManager.recordPayment(orderId, {
          paymentId: 'pay-for-refund',
          amount: orderTotal,
          method: 'card',
          provider: 'stripe',
          status: 'succeeded',
        })
      })

      it('should process partial refund', async () => {
        const refundAmount = 5000

        const refund = await orderManager.processRefund(orderId, {
          amount: refundAmount,
          reason: 'Item returned',
          refundId: 'ref-partial-001',
        })

        expect(refund.amount).toBe(refundAmount)
        expect(refund.reason).toBe('Item returned')
        expect(refund.refundId).toBe('ref-partial-001')
        expect(refund.timestamp).toBeInstanceOf(Date)

        const order = await orderManager.getOrder(orderId)
        expect(order!.totalRefunded).toBe(refundAmount)
        expect(order!.status).toBe('paid') // Still paid since partial
      })

      it('should process full refund and transition to refunded', async () => {
        const refund = await orderManager.processRefund(orderId, {
          amount: orderTotal,
          reason: 'Order cancelled',
          refundId: 'ref-full-001',
        })

        expect(refund.amount).toBe(orderTotal)

        const order = await orderManager.getOrder(orderId)
        expect(order!.status).toBe('refunded')
        expect(order!.refundedAt).toBeInstanceOf(Date)
        expect(order!.totalRefunded).toBe(orderTotal)
      })

      it('should track multiple refunds', async () => {
        await orderManager.processRefund(orderId, {
          amount: 3000,
          reason: 'Damaged item',
          refundId: 'ref-1',
        })
        await orderManager.processRefund(orderId, {
          amount: 2000,
          reason: 'Wrong size',
          refundId: 'ref-2',
        })

        const order = await orderManager.getOrder(orderId)

        expect(order!.refunds).toHaveLength(2)
        expect(order!.totalRefunded).toBe(5000)
      })

      it('should reject refund exceeding paid amount', async () => {
        await expect(
          orderManager.processRefund(orderId, {
            amount: orderTotal + 1000,
            reason: 'Too much',
            refundId: 'ref-excess',
          })
        ).rejects.toThrow('Refund amount exceeds paid amount')
      })

      it('should reject refund when cumulative exceeds paid', async () => {
        await orderManager.processRefund(orderId, {
          amount: orderTotal - 1000,
          reason: 'First refund',
          refundId: 'ref-1',
        })

        await expect(
          orderManager.processRefund(orderId, {
            amount: 2000,
            reason: 'Second refund',
            refundId: 'ref-2',
          })
        ).rejects.toThrow('Refund amount exceeds paid amount')
      })

      it('should store refund metadata', async () => {
        const refund = await orderManager.processRefund(orderId, {
          amount: 1000,
          reason: 'Adjustment',
          refundId: 'ref-meta',
          metadata: {
            type: 'goodwill',
            approvedBy: 'manager@example.com',
            ticketId: 'TICKET-123',
          },
        })

        expect(refund.metadata).toEqual({
          type: 'goodwill',
          approvedBy: 'manager@example.com',
          ticketId: 'TICKET-123',
        })
      })
    })
  })

  // =============================================================================
  // Fulfillment State Tests
  // =============================================================================

  describe('fulfillment states', () => {
    let orderManager: OrderManager
    let orderId: string
    let order: Order

    beforeEach(async () => {
      orderManager = createOrderManager()
      order = await createTestOrder(orderManager)
      orderId = order.id

      // Pay and start processing
      await orderManager.recordPayment(orderId, {
        paymentId: 'pay-123',
        amount: order.total,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })
      await orderManager.transitionTo(orderId, 'processing')
    })

    describe('tracking information', () => {
      it('should add tracking information', async () => {
        const updated = await orderManager.addTracking(orderId, {
          carrier: 'UPS',
          trackingNumber: 'UPS123456789',
          trackingUrl: 'https://ups.com/track/UPS123456789',
        })

        expect(updated.tracking).toBeDefined()
        expect(updated.tracking?.carrier).toBe('UPS')
        expect(updated.tracking?.trackingNumber).toBe('UPS123456789')
        expect(updated.tracking?.trackingUrl).toBe('https://ups.com/track/UPS123456789')
      })

      it('should add estimated delivery date', async () => {
        const estimatedDelivery = new Date('2025-01-20')

        const updated = await orderManager.addTracking(orderId, {
          carrier: 'FedEx',
          trackingNumber: 'FEDEX987654',
          estimatedDelivery,
        })

        expect(updated.tracking?.estimatedDelivery).toEqual(estimatedDelivery)
      })

      it('should update tracking info on status transition to shipped', async () => {
        const shipped = await orderManager.transitionTo(orderId, 'shipped', {
          trackingNumber: 'TRACK-TRANSITION',
          carrier: 'USPS',
        })

        expect(shipped.tracking?.trackingNumber).toBe('TRACK-TRANSITION')
        expect(shipped.tracking?.carrier).toBe('USPS')
      })
    })

    describe('shipments', () => {
      it('should add single shipment', async () => {
        const shipment = await orderManager.addShipment(orderId, {
          lineItems: [
            { lineItemId: order.lineItems[0].id, quantity: 2 },
            { lineItemId: order.lineItems[1].id, quantity: 1 },
          ],
          carrier: 'UPS',
          trackingNumber: 'SHIP-001',
        })

        expect(shipment.id).toBeDefined()
        expect(shipment.id).toMatch(/^ship_/)
        expect(shipment.lineItems).toHaveLength(2)
        expect(shipment.carrier).toBe('UPS')
        expect(shipment.trackingNumber).toBe('SHIP-001')
        expect(shipment.shippedAt).toBeInstanceOf(Date)
      })

      it('should track multiple shipments', async () => {
        await orderManager.addShipment(orderId, {
          lineItems: [{ lineItemId: order.lineItems[0].id, quantity: 2 }],
          carrier: 'UPS',
          trackingNumber: 'SHIP-A',
        })
        await orderManager.addShipment(orderId, {
          lineItems: [{ lineItemId: order.lineItems[1].id, quantity: 1 }],
          carrier: 'FedEx',
          trackingNumber: 'SHIP-B',
        })
        await orderManager.addShipment(orderId, {
          lineItems: [{ lineItemId: order.lineItems[2].id, quantity: 1 }],
          carrier: 'USPS',
          trackingNumber: 'SHIP-C',
        })

        const updated = await orderManager.getOrder(orderId)

        expect(updated!.shipments).toHaveLength(3)
        expect(updated!.shipments!.map((s) => s.carrier)).toEqual(['UPS', 'FedEx', 'USPS'])
      })

      it('should include tracking URL in shipment', async () => {
        const shipment = await orderManager.addShipment(orderId, {
          lineItems: [{ lineItemId: order.lineItems[0].id, quantity: 1 }],
          trackingUrl: 'https://track.example.com/ABC123',
        })

        expect(shipment.trackingUrl).toBe('https://track.example.com/ABC123')
      })
    })

    describe('line item fulfillment', () => {
      it('should fulfill line item quantity', async () => {
        const updated = await orderManager.fulfillLineItem(
          orderId,
          order.lineItems[0].id,
          { quantity: 2 }
        )

        const lineItem = updated.lineItems.find((i) => i.id === order.lineItems[0].id)
        expect(lineItem?.fulfilledQuantity).toBe(2)
      })

      it('should set partial fulfillment status', async () => {
        const updated = await orderManager.fulfillLineItem(
          orderId,
          order.lineItems[0].id,
          { quantity: 1 }
        )

        expect(updated.fulfillmentStatus).toBe('partial')
      })

      it('should track cumulative fulfillment', async () => {
        await orderManager.fulfillLineItem(orderId, order.lineItems[0].id, { quantity: 1 })
        const updated = await orderManager.fulfillLineItem(
          orderId,
          order.lineItems[0].id,
          { quantity: 1 }
        )

        const lineItem = updated.lineItems.find((i) => i.id === order.lineItems[0].id)
        expect(lineItem?.fulfilledQuantity).toBe(2)
      })

      it('should set fulfilled status when all items fulfilled', async () => {
        // Fulfill all line items
        for (const item of order.lineItems) {
          await orderManager.fulfillLineItem(orderId, item.id, { quantity: item.quantity })
        }

        const updated = await orderManager.getOrder(orderId)
        expect(updated!.fulfillmentStatus).toBe('fulfilled')
      })

      it('should track fulfillment per line item independently', async () => {
        await orderManager.fulfillLineItem(orderId, order.lineItems[0].id, { quantity: 2 })
        await orderManager.fulfillLineItem(orderId, order.lineItems[1].id, { quantity: 1 })

        const updated = await orderManager.getOrder(orderId)
        const item0 = updated!.lineItems.find((i) => i.id === order.lineItems[0].id)
        const item1 = updated!.lineItems.find((i) => i.id === order.lineItems[1].id)
        const item2 = updated!.lineItems.find((i) => i.id === order.lineItems[2].id)

        expect(item0?.fulfilledQuantity).toBe(2)
        expect(item1?.fulfilledQuantity).toBe(1)
        expect(item2?.fulfilledQuantity).toBe(0)
      })
    })
  })

  // =============================================================================
  // Order Notes and Metadata Tests
  // =============================================================================

  describe('order notes and metadata', () => {
    let orderManager: OrderManager
    let orderId: string

    beforeEach(async () => {
      orderManager = createOrderManager()
      const order = await createTestOrder(orderManager)
      orderId = order.id
    })

    describe('notes', () => {
      it('should add internal note', async () => {
        const updated = await orderManager.addNote(orderId, {
          content: 'Customer requested expedited shipping',
          type: 'internal',
          author: 'support@example.com',
        })

        expect(updated.notes).toHaveLength(1)
        expect(updated.notes![0].content).toBe('Customer requested expedited shipping')
        expect(updated.notes![0].type).toBe('internal')
        expect(updated.notes![0].author).toBe('support@example.com')
        expect(updated.notes![0].id).toBeDefined()
        expect(updated.notes![0].timestamp).toBeInstanceOf(Date)
      })

      it('should add customer-visible note', async () => {
        const updated = await orderManager.addNote(orderId, {
          content: 'Your order is being prepared with care!',
          type: 'customer',
        })

        expect(updated.notes![0].type).toBe('customer')
      })

      it('should maintain multiple notes in order', async () => {
        await orderManager.addNote(orderId, {
          content: 'Note 1',
          type: 'internal',
        })
        await orderManager.addNote(orderId, {
          content: 'Note 2',
          type: 'customer',
        })
        await orderManager.addNote(orderId, {
          content: 'Note 3',
          type: 'internal',
        })

        const order = await orderManager.getOrder(orderId)

        expect(order!.notes).toHaveLength(3)
        expect(order!.notes!.map((n) => n.content)).toEqual(['Note 1', 'Note 2', 'Note 3'])
      })
    })

    describe('metadata', () => {
      it('should update metadata', async () => {
        const updated = await orderManager.updateMetadata(orderId, {
          source: 'mobile_app',
          campaign: 'winter-2024',
        })

        expect(updated.metadata?.source).toBe('mobile_app')
        expect(updated.metadata?.campaign).toBe('winter-2024')
      })

      it('should merge metadata with existing', async () => {
        await orderManager.updateMetadata(orderId, {
          source: 'web',
          campaign: 'summer-sale',
        })
        const updated = await orderManager.updateMetadata(orderId, {
          referrer: 'google',
          utmSource: 'email',
        })

        expect(updated.metadata?.source).toBe('web')
        expect(updated.metadata?.campaign).toBe('summer-sale')
        expect(updated.metadata?.referrer).toBe('google')
        expect(updated.metadata?.utmSource).toBe('email')
      })

      it('should override existing metadata keys', async () => {
        await orderManager.updateMetadata(orderId, {
          source: 'web',
        })
        const updated = await orderManager.updateMetadata(orderId, {
          source: 'mobile',
        })

        expect(updated.metadata?.source).toBe('mobile')
      })
    })

    describe('shipping address updates', () => {
      it('should update shipping address before shipping', async () => {
        const newAddress = {
          line1: '456 New Street',
          city: 'Boston',
          state: 'MA',
          postalCode: '02101',
          country: 'US',
        }

        const updated = await orderManager.updateShippingAddress(orderId, newAddress)

        expect(updated.shippingAddress?.line1).toBe('456 New Street')
        expect(updated.shippingAddress?.city).toBe('Boston')
      })

      it('should reject address update after shipped', async () => {
        await orderManager.recordPayment(orderId, {
          paymentId: 'pay-123',
          amount: 20996,
          method: 'card',
          provider: 'stripe',
          status: 'succeeded',
        })
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

      it('should reject address update after delivered', async () => {
        await orderManager.recordPayment(orderId, {
          paymentId: 'pay-123',
          amount: 20996,
          method: 'card',
          provider: 'stripe',
          status: 'succeeded',
        })
        await orderManager.transitionTo(orderId, 'processing')
        await orderManager.transitionTo(orderId, 'shipped', { trackingNumber: 'TRACK' })
        await orderManager.transitionTo(orderId, 'delivered')

        await expect(
          orderManager.updateShippingAddress(orderId, {
            line1: 'Delivered Already',
            city: 'City',
            state: 'ST',
            postalCode: '12345',
            country: 'US',
          })
        ).rejects.toThrow('Cannot update address after shipping')
      })
    })
  })

  // =============================================================================
  // Order Query Tests
  // =============================================================================

  describe('order queries', () => {
    let orderManager: OrderManager
    let orders: Order[]

    beforeEach(async () => {
      orderManager = createOrderManager()
      orders = []

      // Create various orders in different states
      const order1 = await orderManager.createOrder({
        customerId: 'cust-1',
        lineItems: [
          { productId: 'p1', variantId: 'v1', name: 'Item', quantity: 1, unitPrice: 1000, totalPrice: 1000 },
        ],
      })
      orders.push(order1)

      const order2 = await orderManager.createOrder({
        customerId: 'cust-2',
        lineItems: [
          { productId: 'p2', variantId: 'v2', name: 'Item', quantity: 2, unitPrice: 2500, totalPrice: 5000 },
        ],
      })
      await orderManager.recordPayment(order2.id, {
        paymentId: 'pay-2',
        amount: 5000,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })
      orders.push(await orderManager.getOrder(order2.id) as Order)

      const order3 = await orderManager.createOrder({
        customerId: 'cust-1',
        lineItems: [
          { productId: 'p3', variantId: 'v3', name: 'Item', quantity: 1, unitPrice: 10000, totalPrice: 10000 },
        ],
      })
      await orderManager.recordPayment(order3.id, {
        paymentId: 'pay-3',
        amount: 10000,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })
      await orderManager.transitionTo(order3.id, 'processing')
      await orderManager.transitionTo(order3.id, 'shipped', { trackingNumber: 'TRACK' })
      orders.push(await orderManager.getOrder(order3.id) as Order)

      const order4 = await orderManager.createOrder({
        customerId: 'cust-3',
        lineItems: [
          { productId: 'p4', variantId: 'v4', name: 'Item', quantity: 1, unitPrice: 500, totalPrice: 500 },
        ],
      })
      await orderManager.transitionTo(order4.id, 'cancelled', { reason: 'Test' })
      orders.push(await orderManager.getOrder(order4.id) as Order)
    })

    it('should query by status', async () => {
      const pending = await orderManager.queryOrders({ status: 'pending' })
      const paid = await orderManager.queryOrders({ status: 'paid' })
      const shipped = await orderManager.queryOrders({ status: 'shipped' })
      const cancelled = await orderManager.queryOrders({ status: 'cancelled' })

      expect(pending).toHaveLength(1)
      expect(paid).toHaveLength(1)
      expect(shipped).toHaveLength(1)
      expect(cancelled).toHaveLength(1)
    })

    it('should query by customer', async () => {
      const cust1Orders = await orderManager.queryOrders({ customerId: 'cust-1' })
      const cust2Orders = await orderManager.queryOrders({ customerId: 'cust-2' })

      expect(cust1Orders).toHaveLength(2)
      expect(cust2Orders).toHaveLength(1)
    })

    it('should query by total range', async () => {
      const lowOrders = await orderManager.queryOrders({ totalMin: 0, totalMax: 1000 })
      const highOrders = await orderManager.queryOrders({ totalMin: 5000 })

      expect(lowOrders).toHaveLength(2) // 500 and 1000
      expect(highOrders).toHaveLength(2) // 5000 and 10000
    })

    it('should paginate results', async () => {
      const page1 = await orderManager.queryOrders({}, { limit: 2, offset: 0 })
      const page2 = await orderManager.queryOrders({}, { limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)

      const allIds = [...page1.map((o) => o.id), ...page2.map((o) => o.id)]
      const uniqueIds = new Set(allIds)
      expect(uniqueIds.size).toBe(4)
    })

    it('should sort by total ascending', async () => {
      const sorted = await orderManager.queryOrders({}, { sortBy: 'total', sortOrder: 'asc' })

      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].total).toBeGreaterThanOrEqual(sorted[i - 1].total)
      }
    })

    it('should sort by total descending', async () => {
      const sorted = await orderManager.queryOrders({}, { sortBy: 'total', sortOrder: 'desc' })

      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].total).toBeLessThanOrEqual(sorted[i - 1].total)
      }
    })

    it('should combine filters', async () => {
      const results = await orderManager.queryOrders({
        customerId: 'cust-1',
        totalMin: 5000,
      })

      expect(results).toHaveLength(1)
      expect(results[0].total).toBe(10000)
    })
  })

  // =============================================================================
  // Full Lifecycle Scenarios
  // =============================================================================

  describe('full lifecycle scenarios', () => {
    let orderManager: OrderManager
    let cartManager: CartManager

    beforeEach(() => {
      orderManager = createOrderManager()
      cartManager = createCartManager()
    })

    it('should complete happy path: pending -> paid -> processing -> shipped -> delivered', async () => {
      // Create order
      const order = await createTestOrder(orderManager)
      expect(order.status).toBe('pending')

      // Payment
      await orderManager.recordPayment(order.id, {
        paymentId: 'pay-happy',
        amount: order.total,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })

      let current = await orderManager.getOrder(order.id)
      expect(current!.status).toBe('paid')

      // Processing
      await orderManager.transitionTo(order.id, 'processing')
      current = await orderManager.getOrder(order.id)
      expect(current!.status).toBe('processing')

      // Add tracking and shipment
      await orderManager.addTracking(order.id, {
        carrier: 'UPS',
        trackingNumber: 'UPS123456',
        estimatedDelivery: new Date('2025-01-25'),
      })

      await orderManager.addShipment(order.id, {
        lineItems: order.lineItems.map((item) => ({
          lineItemId: item.id,
          quantity: item.quantity,
        })),
        carrier: 'UPS',
        trackingNumber: 'UPS123456',
      })

      // Fulfill all items
      for (const item of order.lineItems) {
        await orderManager.fulfillLineItem(order.id, item.id, { quantity: item.quantity })
      }

      // Ship
      await orderManager.transitionTo(order.id, 'shipped', {
        trackingNumber: 'UPS123456',
        carrier: 'UPS',
      })
      current = await orderManager.getOrder(order.id)
      expect(current!.status).toBe('shipped')
      expect(current!.fulfillmentStatus).toBe('fulfilled')

      // Deliver
      await orderManager.transitionTo(order.id, 'delivered')
      current = await orderManager.getOrder(order.id)
      expect(current!.status).toBe('delivered')
      expect(current!.deliveredAt).toBeInstanceOf(Date)

      // Verify complete history
      expect(current!.statusHistory!.map((h) => h.status)).toEqual([
        'pending',
        'paid',
        'processing',
        'shipped',
        'delivered',
      ])
    })

    it('should handle cancellation flow before payment', async () => {
      const order = await createTestOrder(orderManager)

      // Customer decides to cancel
      await orderManager.transitionTo(order.id, 'cancelled', {
        reason: 'Changed my mind',
      })

      const cancelled = await orderManager.getOrder(order.id)
      expect(cancelled!.status).toBe('cancelled')
      expect(cancelled!.cancellationReason).toBe('Changed my mind')
      expect(cancelled!.refunds).toHaveLength(0) // No refund needed
    })

    it('should handle cancellation with refund after payment', async () => {
      const order = await createTestOrder(orderManager)

      // Payment
      await orderManager.recordPayment(order.id, {
        paymentId: 'pay-to-refund',
        amount: order.total,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })

      // Process refund before cancellation
      await orderManager.processRefund(order.id, {
        amount: order.total,
        reason: 'Order cancelled by customer',
        refundId: 'ref-cancel',
      })

      const refunded = await orderManager.getOrder(order.id)
      expect(refunded!.status).toBe('refunded')
      expect(refunded!.totalRefunded).toBe(order.total)
    })

    it('should handle partial fulfillment scenario', async () => {
      const order = await createTestOrder(orderManager)

      await orderManager.recordPayment(order.id, {
        paymentId: 'pay-partial-fulfill',
        amount: order.total,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })
      await orderManager.transitionTo(order.id, 'processing')

      // Fulfill only first item
      await orderManager.fulfillLineItem(order.id, order.lineItems[0].id, {
        quantity: order.lineItems[0].quantity,
      })

      let current = await orderManager.getOrder(order.id)
      expect(current!.fulfillmentStatus).toBe('partial')

      // Fulfill second item
      await orderManager.fulfillLineItem(order.id, order.lineItems[1].id, {
        quantity: order.lineItems[1].quantity,
      })

      current = await orderManager.getOrder(order.id)
      expect(current!.fulfillmentStatus).toBe('partial') // Still partial, third not done

      // Fulfill third item
      await orderManager.fulfillLineItem(order.id, order.lineItems[2].id, {
        quantity: order.lineItems[2].quantity,
      })

      current = await orderManager.getOrder(order.id)
      expect(current!.fulfillmentStatus).toBe('fulfilled')
    })

    it('should handle payment failure and retry scenario', async () => {
      const order = await createTestOrder(orderManager)

      // First payment fails
      await orderManager.recordPaymentFailure(order.id, {
        paymentId: 'pay-fail-1',
        reason: 'Card declined',
        code: 'card_declined',
      })

      let current = await orderManager.getOrder(order.id)
      expect(current!.status).toBe('pending')
      expect(current!.paymentFailures).toHaveLength(1)

      // Second payment fails
      await orderManager.recordPaymentFailure(order.id, {
        paymentId: 'pay-fail-2',
        reason: 'Insufficient funds',
      })

      current = await orderManager.getOrder(order.id)
      expect(current!.paymentFailures).toHaveLength(2)

      // Third payment succeeds
      await orderManager.recordPayment(order.id, {
        paymentId: 'pay-success',
        amount: order.total,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })

      current = await orderManager.getOrder(order.id)
      expect(current!.status).toBe('paid')
      expect(current!.paymentFailures).toHaveLength(2) // Failures still recorded
    })

    it('should handle post-delivery refund scenario', async () => {
      const order = await createTestOrder(orderManager)

      // Complete the order
      await orderManager.recordPayment(order.id, {
        paymentId: 'pay-123',
        amount: order.total,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })
      await orderManager.transitionTo(order.id, 'processing')
      await orderManager.transitionTo(order.id, 'shipped', { trackingNumber: 'TRACK' })
      await orderManager.transitionTo(order.id, 'delivered')

      // Customer returns one item
      const itemToRefund = order.lineItems[0]
      await orderManager.processRefund(order.id, {
        amount: itemToRefund.totalPrice,
        reason: `Return: ${itemToRefund.name}`,
        refundId: 'ref-return',
        metadata: {
          returnedItem: itemToRefund.id,
          returnReason: 'Wrong size',
        },
      })

      const current = await orderManager.getOrder(order.id)
      expect(current!.totalRefunded).toBe(itemToRefund.totalPrice)
      expect(current!.status).toBe('delivered') // Still delivered, partial refund
    })

    it('should track all timestamps through lifecycle', async () => {
      const order = await createTestOrder(orderManager)

      await orderManager.recordPayment(order.id, {
        paymentId: 'pay-123',
        amount: order.total,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })
      await orderManager.transitionTo(order.id, 'processing')
      await orderManager.transitionTo(order.id, 'shipped', { trackingNumber: 'TRACK' })
      await orderManager.transitionTo(order.id, 'delivered')

      const final = await orderManager.getOrder(order.id)

      expect(final!.createdAt).toBeInstanceOf(Date)
      expect(final!.paidAt).toBeInstanceOf(Date)
      expect(final!.shippedAt).toBeInstanceOf(Date)
      expect(final!.deliveredAt).toBeInstanceOf(Date)

      // Timestamps should be in order
      expect(final!.paidAt!.getTime()).toBeGreaterThanOrEqual(final!.createdAt.getTime())
      expect(final!.shippedAt!.getTime()).toBeGreaterThanOrEqual(final!.paidAt!.getTime())
      expect(final!.deliveredAt!.getTime()).toBeGreaterThanOrEqual(final!.shippedAt!.getTime())
    })
  })

  // =============================================================================
  // Error Handling Tests
  // =============================================================================

  describe('error handling', () => {
    let orderManager: OrderManager

    beforeEach(() => {
      orderManager = createOrderManager()
    })

    it('should throw error for non-existent order on getOrder', async () => {
      const result = await orderManager.getOrder('non-existent-id')
      expect(result).toBeNull()
    })

    it('should throw error for non-existent order on transitionTo', async () => {
      await expect(orderManager.transitionTo('non-existent', 'paid')).rejects.toThrow(
        'Order not found'
      )
    })

    it('should throw error for non-existent order on recordPayment', async () => {
      await expect(
        orderManager.recordPayment('non-existent', {
          paymentId: 'pay',
          amount: 100,
          method: 'card',
          provider: 'stripe',
          status: 'succeeded',
        })
      ).rejects.toThrow('Order not found')
    })

    it('should throw error for non-existent order on processRefund', async () => {
      await expect(
        orderManager.processRefund('non-existent', {
          amount: 100,
          reason: 'Test',
          refundId: 'ref',
        })
      ).rejects.toThrow('Order not found')
    })

    it('should throw error for non-existent order on addTracking', async () => {
      await expect(
        orderManager.addTracking('non-existent', {
          carrier: 'UPS',
          trackingNumber: 'TRACK',
        })
      ).rejects.toThrow('Order not found')
    })

    it('should throw error for non-existent order on addNote', async () => {
      await expect(
        orderManager.addNote('non-existent', {
          content: 'Note',
          type: 'internal',
        })
      ).rejects.toThrow('Order not found')
    })

    it('should throw error for non-existent order on getValidTransitions', async () => {
      await expect(orderManager.getValidTransitions('non-existent')).rejects.toThrow(
        'Order not found'
      )
    })
  })
})
