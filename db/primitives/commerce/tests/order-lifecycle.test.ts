/**
 * Order Lifecycle Integration Tests - TDD RED Phase
 *
 * Tests for complete order lifecycle including:
 * - Order creation from cart (cart → order conversion)
 * - Payment processing with multiple payments
 * - Fulfillment tracking with split shipments
 * - Partial and full refunds
 * - Cancellation with automatic refunds
 * - Edge cases and error handling
 *
 * These tests define expected behavior that does NOT yet exist.
 * They should FAIL until implementation is complete.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createOrderManager,
  type OrderManager,
  type Order,
} from '../orders'
import {
  createCartManager,
  type CartManager,
  type Cart,
} from '../cart'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestManagers() {
  return {
    orders: createOrderManager(),
    carts: createCartManager(),
  }
}

async function createPopulatedCart(cartManager: CartManager): Promise<Cart> {
  const cart = await cartManager.createCart({ customerId: 'cust-123' })

  await cartManager.addItem(cart.id, {
    productId: 'prod-1',
    variantId: 'var-1',
    quantity: 2,
    price: 2999,
    name: 'Blue T-Shirt',
  })

  await cartManager.addItem(cart.id, {
    productId: 'prod-2',
    variantId: 'var-2',
    quantity: 1,
    price: 5999,
    name: 'Black Jeans',
  })

  return (await cartManager.getCart(cart.id))!
}

// =============================================================================
// Cart to Order Conversion Tests
// =============================================================================

describe('Order Lifecycle', () => {
  describe('cart to order conversion', () => {
    let orders: OrderManager
    let carts: CartManager

    beforeEach(() => {
      const managers = createTestManagers()
      orders = managers.orders
      carts = managers.carts
    })

    it('should create order from cart with all items', async () => {
      const cart = await createPopulatedCart(carts)

      // This method doesn't exist yet - should fail
      const order = await (orders as any).createOrderFromCart(cart.id, carts, {
        shippingAddress: {
          line1: '123 Main St',
          city: 'New York',
          state: 'NY',
          postalCode: '10001',
          country: 'US',
        },
      })

      expect(order.id).toBeDefined()
      expect(order.lineItems).toHaveLength(2)
      expect(order.lineItems[0].productId).toBe('prod-1')
      expect(order.lineItems[0].quantity).toBe(2)
      expect(order.lineItems[1].productId).toBe('prod-2')
      expect(order.status).toBe('pending')
      expect(order.customerId).toBe('cust-123')
    })

    it('should mark cart as converted after order creation', async () => {
      const cart = await createPopulatedCart(carts)

      const order = await (orders as any).createOrderFromCart(cart.id, carts)
      const convertedCart = await carts.getCart(cart.id)

      expect(convertedCart?.status).toBe('converted')
      expect(convertedCart?.orderId).toBe(order.id)
    })

    it('should preserve cart subtotal in order', async () => {
      const cart = await createPopulatedCart(carts)

      const order = await (orders as any).createOrderFromCart(cart.id, carts)

      // 2 * 2999 + 1 * 5999 = 11997
      expect(order.subtotal).toBe(cart.subtotal)
      expect(order.subtotal).toBe(11997)
    })

    it('should apply shipping and tax during conversion', async () => {
      const cart = await createPopulatedCart(carts)

      const order = await (orders as any).createOrderFromCart(cart.id, carts, {
        shippingCost: 999,
        taxAmount: 1200,
      })

      expect(order.shippingCost).toBe(999)
      expect(order.taxAmount).toBe(1200)
      expect(order.total).toBe(11997 + 999 + 1200) // 14196
    })

    it('should fail to convert empty cart', async () => {
      const cart = await carts.createCart({ customerId: 'cust-123' })

      await expect(
        (orders as any).createOrderFromCart(cart.id, carts)
      ).rejects.toThrow('Cannot create order from empty cart')
    })

    it('should fail to convert already converted cart', async () => {
      const cart = await createPopulatedCart(carts)

      await (orders as any).createOrderFromCart(cart.id, carts)

      await expect(
        (orders as any).createOrderFromCart(cart.id, carts)
      ).rejects.toThrow('Cart already converted')
    })

    it('should link order back to cart for reference', async () => {
      const cart = await createPopulatedCart(carts)

      const order = await (orders as any).createOrderFromCart(cart.id, carts)

      expect(order.metadata?.sourceCartId).toBe(cart.id)
    })
  })

  // =============================================================================
  // Multi-Payment Processing Tests
  // =============================================================================

  describe('multi-payment processing', () => {
    let orders: OrderManager
    let orderId: string

    beforeEach(async () => {
      orders = createOrderManager()
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Expensive Item',
            quantity: 1,
            unitPrice: 50000,
            totalPrice: 50000,
          },
        ],
      })
      orderId = order.id
    })

    it('should support multiple partial payments', async () => {
      // First payment
      await (orders as any).addPayment(orderId, {
        paymentId: 'pay-1',
        amount: 20000,
        method: 'card',
        provider: 'stripe',
      })

      let order = await orders.getOrder(orderId)
      expect(order?.status).toBe('partially_paid')
      expect(order?.amountDue).toBe(30000)

      // Second payment
      await (orders as any).addPayment(orderId, {
        paymentId: 'pay-2',
        amount: 20000,
        method: 'card',
        provider: 'stripe',
      })

      order = await orders.getOrder(orderId)
      expect(order?.status).toBe('partially_paid')
      expect(order?.amountDue).toBe(10000)

      // Final payment
      await (orders as any).addPayment(orderId, {
        paymentId: 'pay-3',
        amount: 10000,
        method: 'card',
        provider: 'stripe',
      })

      order = await orders.getOrder(orderId)
      expect(order?.status).toBe('paid')
      expect(order?.amountDue).toBe(0)
    })

    it('should track all payments on order', async () => {
      await (orders as any).addPayment(orderId, {
        paymentId: 'pay-1',
        amount: 25000,
        method: 'card',
      })
      await (orders as any).addPayment(orderId, {
        paymentId: 'pay-2',
        amount: 25000,
        method: 'giftcard',
      })

      const order = await orders.getOrder(orderId)

      // Should have payments array, not single payment
      expect(order?.payments).toHaveLength(2)
      expect(order?.payments?.[0].paymentId).toBe('pay-1')
      expect(order?.payments?.[1].paymentId).toBe('pay-2')
      expect(order?.totalPaid).toBe(50000)
    })

    it('should handle overpayment gracefully', async () => {
      await (orders as any).addPayment(orderId, {
        paymentId: 'pay-1',
        amount: 55000, // $50 overpayment
        method: 'card',
      })

      const order = await orders.getOrder(orderId)
      expect(order?.status).toBe('paid')
      expect(order?.amountDue).toBe(0)
      expect(order?.overpayment).toBe(5000)
    })

    it('should support mixed payment methods', async () => {
      await (orders as any).addPayment(orderId, {
        paymentId: 'pay-gift',
        amount: 10000,
        method: 'giftcard',
        provider: 'internal',
      })
      await (orders as any).addPayment(orderId, {
        paymentId: 'pay-card',
        amount: 40000,
        method: 'card',
        provider: 'stripe',
      })

      const order = await orders.getOrder(orderId)
      const methods = order?.payments?.map((p: any) => p.method)

      expect(methods).toContain('giftcard')
      expect(methods).toContain('card')
    })

    it('should void pending payment authorization', async () => {
      await (orders as any).addPayment(orderId, {
        paymentId: 'pay-auth',
        amount: 50000,
        method: 'card',
        status: 'authorized',
      })

      await (orders as any).voidPayment(orderId, 'pay-auth')

      const order = await orders.getOrder(orderId)
      expect(order?.payments?.[0].status).toBe('voided')
      expect(order?.status).toBe('pending')
    })
  })

  // =============================================================================
  // Advanced Fulfillment Tests
  // =============================================================================

  describe('advanced fulfillment', () => {
    let orders: OrderManager
    let orderId: string

    beforeEach(async () => {
      orders = createOrderManager()
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Widget A',
            quantity: 5,
            unitPrice: 1000,
            totalPrice: 5000,
          },
          {
            productId: 'prod-2',
            variantId: 'var-2',
            name: 'Widget B',
            quantity: 3,
            unitPrice: 2000,
            totalPrice: 6000,
          },
        ],
      })
      orderId = order.id
      await orders.recordPayment(orderId, {
        paymentId: 'pay-1',
        amount: 11000,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })
    })

    it('should create fulfillment with selected line items', async () => {
      const order = await orders.getOrder(orderId)

      const fulfillment = await (orders as any).createFulfillment(orderId, {
        lineItems: [
          { lineItemId: order!.lineItems[0].id, quantity: 3 },
        ],
        carrier: 'UPS',
        trackingNumber: 'TRACK-001',
      })

      expect(fulfillment.id).toBeDefined()
      expect(fulfillment.lineItems).toHaveLength(1)
      expect(fulfillment.status).toBe('pending')
    })

    it('should update fulfillment status to shipped', async () => {
      const order = await orders.getOrder(orderId)

      const fulfillment = await (orders as any).createFulfillment(orderId, {
        lineItems: [
          { lineItemId: order!.lineItems[0].id, quantity: 5 },
        ],
      })

      const shipped = await (orders as any).shipFulfillment(orderId, fulfillment.id, {
        carrier: 'FedEx',
        trackingNumber: 'FEDEX123',
        shippedAt: new Date(),
      })

      expect(shipped.status).toBe('shipped')
      expect(shipped.carrier).toBe('FedEx')
    })

    it('should mark fulfillment as delivered', async () => {
      const order = await orders.getOrder(orderId)

      const fulfillment = await (orders as any).createFulfillment(orderId, {
        lineItems: [
          { lineItemId: order!.lineItems[0].id, quantity: 5 },
          { lineItemId: order!.lineItems[1].id, quantity: 3 },
        ],
      })

      await (orders as any).shipFulfillment(orderId, fulfillment.id, {
        carrier: 'UPS',
        trackingNumber: 'UPS123',
      })

      const delivered = await (orders as any).deliverFulfillment(orderId, fulfillment.id, {
        deliveredAt: new Date(),
        signature: 'John Doe',
      })

      expect(delivered.status).toBe('delivered')

      const updatedOrder = await orders.getOrder(orderId)
      expect(updatedOrder?.status).toBe('delivered')
      expect(updatedOrder?.fulfillmentStatus).toBe('fulfilled')
    })

    it('should handle split fulfillments correctly', async () => {
      const order = await orders.getOrder(orderId)

      // Ship partial quantity of first item
      await (orders as any).createFulfillment(orderId, {
        lineItems: [{ lineItemId: order!.lineItems[0].id, quantity: 2 }],
        carrier: 'UPS',
        trackingNumber: 'TRACK-A',
      })

      let updated = await orders.getOrder(orderId)
      expect(updated?.fulfillmentStatus).toBe('partial')

      // Ship remaining items
      await (orders as any).createFulfillment(orderId, {
        lineItems: [
          { lineItemId: order!.lineItems[0].id, quantity: 3 },
          { lineItemId: order!.lineItems[1].id, quantity: 3 },
        ],
        carrier: 'FedEx',
        trackingNumber: 'TRACK-B',
      })

      updated = await orders.getOrder(orderId)
      expect(updated?.fulfillments).toHaveLength(2)
      expect(updated?.fulfillmentStatus).toBe('fulfilled')
    })

    it('should reject over-fulfillment', async () => {
      const order = await orders.getOrder(orderId)

      await expect(
        (orders as any).createFulfillment(orderId, {
          lineItems: [{ lineItemId: order!.lineItems[0].id, quantity: 10 }], // Only 5 ordered
        })
      ).rejects.toThrow('Cannot fulfill more than ordered quantity')
    })

    it('should cancel unfulfilled fulfillment', async () => {
      const order = await orders.getOrder(orderId)

      const fulfillment = await (orders as any).createFulfillment(orderId, {
        lineItems: [{ lineItemId: order!.lineItems[0].id, quantity: 5 }],
      })

      await (orders as any).cancelFulfillment(orderId, fulfillment.id, {
        reason: 'Item out of stock',
      })

      const updated = await orders.getOrder(orderId)
      const cancelledFulfillment = updated?.fulfillments?.find((f: any) => f.id === fulfillment.id)

      expect(cancelledFulfillment?.status).toBe('cancelled')
      expect(updated?.fulfillmentStatus).toBe('unfulfilled')
    })
  })

  // =============================================================================
  // Refund Scenarios Tests
  // =============================================================================

  describe('refund scenarios', () => {
    let orders: OrderManager
    let orderId: string

    beforeEach(async () => {
      orders = createOrderManager()
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Item A',
            quantity: 2,
            unitPrice: 5000,
            totalPrice: 10000,
          },
          {
            productId: 'prod-2',
            variantId: 'var-2',
            name: 'Item B',
            quantity: 1,
            unitPrice: 3000,
            totalPrice: 3000,
          },
        ],
        shippingCost: 1000,
        taxAmount: 1040,
      })
      orderId = order.id
      // Total: 10000 + 3000 + 1000 + 1040 = 15040
      await orders.recordPayment(orderId, {
        paymentId: 'pay-1',
        amount: 15040,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })
    })

    it('should process line item refund', async () => {
      const order = await orders.getOrder(orderId)

      // Refund one of the Item A units
      const refund = await (orders as any).refundLineItem(orderId, {
        lineItemId: order!.lineItems[0].id,
        quantity: 1,
        reason: 'Customer return',
      })

      expect(refund.amount).toBe(5000) // Unit price
      expect(refund.lineItemId).toBe(order!.lineItems[0].id)

      const updated = await orders.getOrder(orderId)
      expect(updated?.totalRefunded).toBe(5000)
      expect(updated?.status).not.toBe('refunded') // Partial refund
    })

    it('should include proportional tax in line item refund', async () => {
      const order = await orders.getOrder(orderId)

      // Refund Item B (3000 + proportional tax)
      // Tax rate: 1040 / 13000 = 0.08
      // Item B tax: 3000 * 0.08 = 240
      const refund = await (orders as any).refundLineItem(orderId, {
        lineItemId: order!.lineItems[1].id,
        quantity: 1,
        includeTax: true,
        reason: 'Defective',
      })

      expect(refund.amount).toBe(3240) // 3000 + 240 tax
    })

    it('should refund shipping separately', async () => {
      const refund = await (orders as any).refundShipping(orderId, {
        amount: 1000,
        reason: 'Delayed delivery',
      })

      expect(refund.type).toBe('shipping')
      expect(refund.amount).toBe(1000)
    })

    it('should track refund reason and type', async () => {
      await orders.processRefund(orderId, {
        amount: 2000,
        reason: 'Goodwill adjustment',
        refundId: 'ref-1',
        metadata: { type: 'adjustment', approvedBy: 'manager@example.com' },
      })

      const order = await orders.getOrder(orderId)
      const refund = order?.refunds?.[0]

      expect(refund?.reason).toBe('Goodwill adjustment')
      expect(refund?.metadata?.type).toBe('adjustment')
    })

    it('should support multi-payment refund distribution', async () => {
      // Create order with multiple payments
      const multiPayOrder = await orders.createOrder({
        customerId: 'cust-multi',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Item',
            quantity: 1,
            unitPrice: 10000,
            totalPrice: 10000,
          },
        ],
      })

      await (orders as any).addPayment(multiPayOrder.id, {
        paymentId: 'gift-pay',
        amount: 3000,
        method: 'giftcard',
      })
      await (orders as any).addPayment(multiPayOrder.id, {
        paymentId: 'card-pay',
        amount: 7000,
        method: 'card',
      })

      // Refund should specify which payment to refund from
      const refund = await (orders as any).processRefundToPayment(multiPayOrder.id, {
        paymentId: 'card-pay',
        amount: 5000,
        reason: 'Partial return',
        refundId: 'ref-card',
      })

      expect(refund.sourcePaymentId).toBe('card-pay')
    })

    it('should prevent refund exceeding payment method balance', async () => {
      const multiPayOrder = await orders.createOrder({
        customerId: 'cust-multi',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Item',
            quantity: 1,
            unitPrice: 10000,
            totalPrice: 10000,
          },
        ],
      })

      await (orders as any).addPayment(multiPayOrder.id, {
        paymentId: 'gift-pay',
        amount: 3000,
        method: 'giftcard',
      })
      await (orders as any).addPayment(multiPayOrder.id, {
        paymentId: 'card-pay',
        amount: 7000,
        method: 'card',
      })

      // Try to refund more than was paid via giftcard
      await expect(
        (orders as any).processRefundToPayment(multiPayOrder.id, {
          paymentId: 'gift-pay',
          amount: 5000, // Only 3000 paid via giftcard
          reason: 'Invalid refund',
          refundId: 'ref-invalid',
        })
      ).rejects.toThrow('Refund exceeds payment amount')
    })
  })

  // =============================================================================
  // Cancellation Tests
  // =============================================================================

  describe('order cancellation', () => {
    let orders: OrderManager

    beforeEach(() => {
      orders = createOrderManager()
    })

    it('should cancel unpaid order without refund', async () => {
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Item',
            quantity: 1,
            unitPrice: 5000,
            totalPrice: 5000,
          },
        ],
      })

      const cancelled = await (orders as any).cancelOrder(order.id, {
        reason: 'Customer changed mind',
        cancelledBy: 'customer',
      })

      expect(cancelled.status).toBe('cancelled')
      expect(cancelled.cancellationReason).toBe('Customer changed mind')
      expect(cancelled.refunds).toHaveLength(0)
    })

    it('should auto-refund paid order on cancellation', async () => {
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Item',
            quantity: 1,
            unitPrice: 5000,
            totalPrice: 5000,
          },
        ],
      })

      await orders.recordPayment(order.id, {
        paymentId: 'pay-1',
        amount: 5000,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })

      const cancelled = await (orders as any).cancelOrder(order.id, {
        reason: 'Order cancelled',
        autoRefund: true,
      })

      expect(cancelled.status).toBe('cancelled')
      expect(cancelled.refunds).toHaveLength(1)
      expect(cancelled.totalRefunded).toBe(5000)
    })

    it('should cancel with partial refund option', async () => {
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Item',
            quantity: 1,
            unitPrice: 5000,
            totalPrice: 5000,
          },
        ],
        shippingCost: 1000,
      })

      await orders.recordPayment(order.id, {
        paymentId: 'pay-1',
        amount: 6000,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })

      // Cancel but don't refund shipping (restocking scenario)
      const cancelled = await (orders as any).cancelOrder(order.id, {
        reason: 'Customer cancelled',
        refundAmount: 5000, // Product only, not shipping
      })

      expect(cancelled.totalRefunded).toBe(5000)
    })

    it('should prevent cancellation of shipped order', async () => {
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Item',
            quantity: 1,
            unitPrice: 5000,
            totalPrice: 5000,
          },
        ],
      })

      await orders.recordPayment(order.id, {
        paymentId: 'pay-1',
        amount: 5000,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })
      await orders.transitionTo(order.id, 'processing')
      await orders.transitionTo(order.id, 'shipped', { trackingNumber: 'TRACK' })

      await expect(
        (orders as any).cancelOrder(order.id, { reason: 'Too late' })
      ).rejects.toThrow('Cannot cancel shipped order')
    })

    it('should support cancel with return required flag', async () => {
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Item',
            quantity: 1,
            unitPrice: 5000,
            totalPrice: 5000,
          },
        ],
      })

      await orders.recordPayment(order.id, {
        paymentId: 'pay-1',
        amount: 5000,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })
      await orders.transitionTo(order.id, 'processing')

      // Processing but not shipped - can cancel but may need return
      const cancelled = await (orders as any).cancelOrder(order.id, {
        reason: 'Customer request',
        returnRequired: true,
      })

      expect(cancelled.metadata?.returnRequired).toBe(true)
      expect(cancelled.status).toBe('cancelled')
    })

    it('should record cancellation audit trail', async () => {
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Item',
            quantity: 1,
            unitPrice: 5000,
            totalPrice: 5000,
          },
        ],
      })

      const cancelled = await (orders as any).cancelOrder(order.id, {
        reason: 'Fraud suspected',
        cancelledBy: 'admin@example.com',
        internalNotes: 'Flagged by fraud detection',
      })

      expect(cancelled.statusHistory?.slice(-1)[0].status).toBe('cancelled')
      expect(cancelled.statusHistory?.slice(-1)[0].metadata?.cancelledBy).toBe('admin@example.com')
    })
  })

  // =============================================================================
  // Edge Cases and Error Handling Tests
  // =============================================================================

  describe('edge cases and error handling', () => {
    let orders: OrderManager

    beforeEach(() => {
      orders = createOrderManager()
    })

    it('should handle concurrent payment attempts', async () => {
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Item',
            quantity: 1,
            unitPrice: 5000,
            totalPrice: 5000,
          },
        ],
      })

      // Simulate race condition - two payments try to complete
      const payment1 = (orders as any).addPayment(order.id, {
        paymentId: 'pay-1',
        amount: 5000,
        method: 'card',
        idempotencyKey: 'key-1',
      })
      const payment2 = (orders as any).addPayment(order.id, {
        paymentId: 'pay-2',
        amount: 5000,
        method: 'card',
        idempotencyKey: 'key-2',
      })

      // One should succeed, one should fail or be detected as duplicate
      const results = await Promise.allSettled([payment1, payment2])

      const succeeded = results.filter(r => r.status === 'fulfilled')
      expect(succeeded.length).toBeGreaterThanOrEqual(1)

      const finalOrder = await orders.getOrder(order.id)
      expect(finalOrder?.totalPaid).toBe(5000) // Should not double charge
    })

    it('should validate inventory before fulfillment', async () => {
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Limited Item',
            quantity: 10,
            unitPrice: 1000,
            totalPrice: 10000,
            sku: 'LIMITED-001',
          },
        ],
      })

      await orders.recordPayment(order.id, {
        paymentId: 'pay-1',
        amount: 10000,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })

      // Should check inventory integration (mock would fail)
      await expect(
        (orders as any).createFulfillment(order.id, {
          lineItems: [{ lineItemId: order.lineItems[0].id, quantity: 10 }],
          validateInventory: true,
        })
      ).rejects.toThrow() // Would fail if inventory insufficient
    })

    it('should handle payment timeout gracefully', async () => {
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Item',
            quantity: 1,
            unitPrice: 5000,
            totalPrice: 5000,
          },
        ],
      })

      // Record pending authorization
      await (orders as any).addPayment(order.id, {
        paymentId: 'pay-pending',
        amount: 5000,
        method: 'card',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000), // Already expired
      })

      // Cleanup should expire the payment
      await (orders as any).expireStalePayments(order.id)

      const updated = await orders.getOrder(order.id)
      expect(updated?.payments?.[0].status).toBe('expired')
      expect(updated?.status).toBe('pending')
    })

    it('should rollback on partial fulfillment failure', async () => {
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Item A',
            quantity: 5,
            unitPrice: 1000,
            totalPrice: 5000,
          },
          {
            productId: 'prod-2',
            variantId: 'var-2',
            name: 'Item B (failing)',
            quantity: 5,
            unitPrice: 1000,
            totalPrice: 5000,
          },
        ],
      })

      await orders.recordPayment(order.id, {
        paymentId: 'pay-1',
        amount: 10000,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })

      // Attempt to fulfill both items, but one fails
      await expect(
        (orders as any).createFulfillment(order.id, {
          lineItems: [
            { lineItemId: order.lineItems[0].id, quantity: 5 },
            { lineItemId: 'invalid-item', quantity: 5 }, // Invalid item
          ],
          atomic: true,
        })
      ).rejects.toThrow()

      // Fulfillment should be rolled back
      const updated = await orders.getOrder(order.id)
      expect(updated?.fulfillmentStatus).toBe('unfulfilled')
    })

    it('should enforce order modification cutoff', async () => {
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Item',
            quantity: 1,
            unitPrice: 5000,
            totalPrice: 5000,
          },
        ],
      })

      await orders.recordPayment(order.id, {
        paymentId: 'pay-1',
        amount: 5000,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })
      await orders.transitionTo(order.id, 'processing')

      // Once in processing, can't add/remove items
      await expect(
        (orders as any).addLineItem(order.id, {
          productId: 'prod-new',
          variantId: 'var-new',
          name: 'New Item',
          quantity: 1,
          unitPrice: 1000,
          totalPrice: 1000,
        })
      ).rejects.toThrow('Cannot modify order after processing')
    })

    it('should calculate correct refund for discounted items', async () => {
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Item',
            quantity: 2,
            unitPrice: 5000,
            totalPrice: 10000,
          },
        ],
        discountAmount: 2000, // 20% off
        discountCode: 'SAVE20',
      })

      await orders.recordPayment(order.id, {
        paymentId: 'pay-1',
        amount: 8000, // 10000 - 2000
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })

      // Refund one item - should refund proportional amount
      const refund = await (orders as any).refundLineItem(order.id, {
        lineItemId: order.lineItems[0].id,
        quantity: 1,
        proportionalDiscount: true,
        reason: 'Return',
      })

      // Each item effectively costs 4000 (5000 - 1000 discount each)
      expect(refund.amount).toBe(4000)
    })
  })

  // =============================================================================
  // Complete Lifecycle Integration Tests
  // =============================================================================

  describe('complete order lifecycle', () => {
    let orders: OrderManager
    let carts: CartManager

    beforeEach(() => {
      const managers = createTestManagers()
      orders = managers.orders
      carts = managers.carts
    })

    it('should complete happy path: cart -> order -> pay -> fulfill -> deliver', async () => {
      // 1. Create and populate cart
      const cart = await createPopulatedCart(carts)

      // 2. Convert cart to order
      const order = await (orders as any).createOrderFromCart(cart.id, carts, {
        shippingAddress: {
          line1: '123 Main St',
          city: 'New York',
          state: 'NY',
          postalCode: '10001',
          country: 'US',
        },
        shippingCost: 999,
        taxAmount: 1040,
      })
      expect(order.status).toBe('pending')

      // 3. Process payment
      await (orders as any).addPayment(order.id, {
        paymentId: 'pay-123',
        amount: order.total,
        method: 'card',
        provider: 'stripe',
      })

      let updated = await orders.getOrder(order.id)
      expect(updated?.status).toBe('paid')

      // 4. Create fulfillment
      const fulfillment = await (orders as any).createFulfillment(order.id, {
        lineItems: order.lineItems.map((item: any) => ({
          lineItemId: item.id,
          quantity: item.quantity,
        })),
      })

      // 5. Ship fulfillment
      await (orders as any).shipFulfillment(order.id, fulfillment.id, {
        carrier: 'UPS',
        trackingNumber: 'UPS123456789',
      })

      updated = await orders.getOrder(order.id)
      expect(updated?.status).toBe('shipped')

      // 6. Mark delivered
      await (orders as any).deliverFulfillment(order.id, fulfillment.id, {
        deliveredAt: new Date(),
      })

      updated = await orders.getOrder(order.id)
      expect(updated?.status).toBe('delivered')
      expect(updated?.fulfillmentStatus).toBe('fulfilled')

      // Verify cart is converted
      const convertedCart = await carts.getCart(cart.id)
      expect(convertedCart?.status).toBe('converted')
    })

    it('should handle return and refund flow', async () => {
      // Setup: completed order
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Returnable Item',
            quantity: 2,
            unitPrice: 5000,
            totalPrice: 10000,
          },
        ],
      })

      await orders.recordPayment(order.id, {
        paymentId: 'pay-1',
        amount: 10000,
        method: 'card',
        provider: 'stripe',
        status: 'succeeded',
      })
      await orders.transitionTo(order.id, 'processing')
      await orders.transitionTo(order.id, 'shipped', { trackingNumber: 'TRACK' })
      await orders.transitionTo(order.id, 'delivered')

      // Customer returns one item
      const returnRequest = await (orders as any).createReturn(order.id, {
        lineItems: [{ lineItemId: order.lineItems[0].id, quantity: 1 }],
        reason: 'Wrong size',
      })

      expect(returnRequest.id).toBeDefined()
      expect(returnRequest.status).toBe('pending')

      // Warehouse receives return
      await (orders as any).receiveReturn(order.id, returnRequest.id, {
        receivedAt: new Date(),
        condition: 'good',
      })

      // Process refund for returned item
      const refund = await (orders as any).refundReturn(order.id, returnRequest.id)

      expect(refund.amount).toBe(5000)

      const updated = await orders.getOrder(order.id)
      expect(updated?.totalRefunded).toBe(5000)
      expect(updated?.status).toBe('delivered') // Still delivered, not refunded (partial)
    })

    it('should handle order modification before payment', async () => {
      const order = await orders.createOrder({
        customerId: 'cust-123',
        lineItems: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            name: 'Original Item',
            quantity: 1,
            unitPrice: 5000,
            totalPrice: 5000,
          },
        ],
      })

      // Add another item before payment
      await (orders as any).addLineItem(order.id, {
        productId: 'prod-2',
        variantId: 'var-2',
        name: 'Added Item',
        quantity: 1,
        unitPrice: 3000,
        totalPrice: 3000,
      })

      // Update quantity
      await (orders as any).updateLineItemQuantity(order.id, order.lineItems[0].id, 2)

      // Remove the added item
      const updated = await orders.getOrder(order.id)
      await (orders as any).removeLineItem(order.id, updated!.lineItems[1].id)

      const final = await orders.getOrder(order.id)
      expect(final?.lineItems).toHaveLength(1)
      expect(final?.lineItems[0].quantity).toBe(2)
      expect(final?.subtotal).toBe(10000)
    })
  })
})
