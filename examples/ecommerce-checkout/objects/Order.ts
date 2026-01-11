/**
 * OrderDO - Order Management Durable Object
 *
 * Manages orders after successful checkout.
 * Each order gets its own instance (keyed by orderId).
 *
 * Responsibilities:
 * - Store order details
 * - Track order status and history
 * - Handle fulfillment events
 * - Process cancellations and refunds
 *
 * Order Lifecycle:
 * pending -> paid -> processing -> shipped -> delivered
 *                |-> cancelled -> refunded
 *
 * Events Emitted:
 * - Order.created - New order placed
 * - Order.shipped - Order shipped
 * - Order.delivered - Order delivered
 * - Order.cancelled - Order cancelled
 * - Order.refunded - Refund processed
 * - Fulfillment.started - Begin fulfillment
 * - Email.sendConfirmation - Order confirmation email
 * - Email.sendShipping - Shipping notification
 * - Review.requested - Post-delivery review request
 */

import { DO } from 'dotdo'
import type { CartItem, Address } from './Cart'
import type { CheckoutTotals, PaymentMethod } from './Checkout'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'

export interface OrderEvent {
  status: OrderStatus
  timestamp: Date
  details?: Record<string, unknown>
}

export interface OrderPayment {
  id: string
  amount: number
  method: PaymentMethod
  refundedAt?: Date
  refundAmount?: number
}

export interface Order {
  id: string
  sessionId: string
  customerId: string
  items: CartItem[]
  shippingAddress: Address
  billingAddress: Address
  totals: CheckoutTotals
  payment: OrderPayment
  status: OrderStatus
  timeline: OrderEvent[]
  trackingNumber?: string
  carrier?: string
  estimatedDelivery?: Date
  deliveredAt?: Date
  cancelledAt?: Date
  cancellationReason?: string
  createdAt: Date
  updatedAt: Date
}

export class OrderError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'OrderError'
  }
}

// ============================================================================
// ORDER DURABLE OBJECT
// ============================================================================

export class OrderDO extends DO {
  static readonly $type = 'OrderDO'

  /**
   * Register event handlers on startup.
   */
  async onStart() {
    // ========================================================================
    // ORDER CREATION
    // ========================================================================

    /**
     * Order.create - Create new order from checkout session.
     */
    this.$.on.Order.create(async (event) => {
      const {
        orderId,
        sessionId,
        customerId,
        items,
        shippingAddress,
        billingAddress,
        totals,
        payment,
      } = event.data as {
        orderId: string
        sessionId: string
        customerId: string
        items: CartItem[]
        shippingAddress: Address
        billingAddress: Address
        totals: CheckoutTotals
        payment: { id: string; amount: number; method: PaymentMethod }
      }

      // Only handle if this is our order
      if (orderId !== this.ns) return

      console.log(`[Order.create] Creating order ${orderId} for customer ${customerId}`)

      const order: Order = {
        id: orderId,
        sessionId,
        customerId,
        items,
        shippingAddress,
        billingAddress,
        totals,
        payment: {
          id: payment.id,
          amount: payment.amount,
          method: payment.method,
        },
        status: 'paid',
        timeline: [
          { status: 'pending', timestamp: new Date() },
          { status: 'paid', timestamp: new Date() },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      await this.ctx.storage.put('order', order)

      // Notify checkout session
      this.$.send('Order.created', {
        orderId,
        sessionId,
        customerId,
        total: totals.total,
      })

      // Start fulfillment process
      this.$.send('Fulfillment.started', {
        orderId,
        items,
        shippingAddress,
        shippingMethod: totals.shipping.method,
      })

      // Send confirmation email
      this.$.send('Email.sendConfirmation', {
        customerId,
        orderId,
        items,
        totals,
        shippingAddress,
      })
    })

    // ========================================================================
    // FULFILLMENT EVENTS
    // ========================================================================

    /**
     * Fulfillment.started - Begin order fulfillment.
     */
    this.$.on.Fulfillment.started(async (event) => {
      const { orderId } = event.data as { orderId: string }

      if (orderId !== this.ns) return

      console.log(`[Fulfillment.started] Processing order ${orderId}`)

      const order = await this.ctx.storage.get<Order>('order')
      if (!order) return

      order.status = 'processing'
      order.timeline.push({
        status: 'processing',
        timestamp: new Date(),
        details: { message: 'Order is being prepared for shipment' },
      })
      order.updatedAt = new Date()
      await this.ctx.storage.put('order', order)

      // Simulate shipping after a delay (in production: webhook from fulfillment service)
      // In production: use this.ctx.storage.setAlarm() or this.$.schedule()
      // For demo, we'll emit the shipped event immediately
      setTimeout(() => {
        const trackingNumber = `TRK${Date.now()}`
        this.$.send('Fulfillment.shipped', {
          orderId,
          trackingNumber,
          carrier: 'FastShip',
          estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
        })
      }, 1000) // 1 second delay for demo
    })

    /**
     * Fulfillment.shipped - Order has been shipped.
     */
    this.$.on.Fulfillment.shipped(async (event) => {
      const { orderId, trackingNumber, carrier, estimatedDelivery } = event.data as {
        orderId: string
        trackingNumber: string
        carrier: string
        estimatedDelivery: Date
      }

      if (orderId !== this.ns) return

      console.log(`[Fulfillment.shipped] Order ${orderId} shipped: ${trackingNumber}`)

      const order = await this.ctx.storage.get<Order>('order')
      if (!order) return

      order.status = 'shipped'
      order.trackingNumber = trackingNumber
      order.carrier = carrier
      order.estimatedDelivery = estimatedDelivery
      order.timeline.push({
        status: 'shipped',
        timestamp: new Date(),
        details: { trackingNumber, carrier, estimatedDelivery },
      })
      order.updatedAt = new Date()
      await this.ctx.storage.put('order', order)

      this.$.send('Order.shipped', {
        orderId,
        customerId: order.customerId,
        trackingNumber,
        carrier,
        estimatedDelivery,
      })

      // Send shipping notification
      this.$.send('Email.sendShipping', {
        customerId: order.customerId,
        orderId,
        trackingNumber,
        carrier,
        estimatedDelivery,
      })
    })

    /**
     * Fulfillment.delivered - Order has been delivered.
     */
    this.$.on.Fulfillment.delivered(async (event) => {
      const { orderId } = event.data as { orderId: string }

      if (orderId !== this.ns) return

      console.log(`[Fulfillment.delivered] Order ${orderId} delivered`)

      const order = await this.ctx.storage.get<Order>('order')
      if (!order) return

      order.status = 'delivered'
      order.deliveredAt = new Date()
      order.timeline.push({
        status: 'delivered',
        timestamp: new Date(),
      })
      order.updatedAt = new Date()
      await this.ctx.storage.put('order', order)

      this.$.send('Order.delivered', {
        orderId,
        customerId: order.customerId,
      })

      // Schedule review request for 3 days later
      // In production: use this.ctx.storage.setAlarm() for durable scheduling
      // this.ctx.storage.setAlarm(Date.now() + 3 * 24 * 60 * 60 * 1000)
      console.log(`[OrderDO] Review request scheduled for order ${orderId} in 3 days`)
    })

    // ========================================================================
    // CANCELLATION EVENTS
    // ========================================================================

    /**
     * Order.cancel - Handle order cancellation request.
     */
    this.$.on.Order.cancel(async (event) => {
      const { orderId, reason } = event.data as {
        orderId: string
        reason: string
      }

      if (orderId !== this.ns) return

      console.log(`[Order.cancel] Cancelling order ${orderId}: ${reason}`)

      const order = await this.ctx.storage.get<Order>('order')
      if (!order) {
        throw new OrderError(`Order not found: ${orderId}`, 'ORDER_NOT_FOUND')
      }

      // Cannot cancel shipped or delivered orders
      if (['shipped', 'delivered'].includes(order.status)) {
        throw new OrderError(
          'Cannot cancel order that has already shipped',
          'CANNOT_CANCEL',
          { currentStatus: order.status }
        )
      }

      order.status = 'cancelled'
      order.cancelledAt = new Date()
      order.cancellationReason = reason
      order.timeline.push({
        status: 'cancelled',
        timestamp: new Date(),
        details: { reason },
      })
      order.updatedAt = new Date()
      await this.ctx.storage.put('order', order)

      // Release inventory
      this.$.send('Inventory.release', {
        orderId,
        reason,
      })

      // Process refund
      if (order.payment) {
        this.$.send('Payment.refund', {
          orderId,
          paymentId: order.payment.id,
          amount: order.payment.amount,
          reason,
        })
      }

      this.$.send('Order.cancelled', {
        orderId,
        customerId: order.customerId,
        reason,
      })

      // Send cancellation email
      this.$.send('Email.sendCancellation', {
        customerId: order.customerId,
        orderId,
        reason,
      })
    })

    /**
     * Payment.refunded - Refund has been processed.
     */
    this.$.on.Payment.refunded(async (event) => {
      const { orderId, amount } = event.data as {
        orderId: string
        paymentId: string
        amount: number
      }

      if (orderId !== this.ns) return

      console.log(`[Payment.refunded] Refund processed for order ${orderId}: $${(amount / 100).toFixed(2)}`)

      const order = await this.ctx.storage.get<Order>('order')
      if (!order) return

      order.status = 'refunded'
      order.payment.refundedAt = new Date()
      order.payment.refundAmount = amount
      order.timeline.push({
        status: 'refunded',
        timestamp: new Date(),
        details: { amount },
      })
      order.updatedAt = new Date()
      await this.ctx.storage.put('order', order)

      this.$.send('Order.refunded', {
        orderId,
        customerId: order.customerId,
        amount,
      })
    })

    // ========================================================================
    // NOTIFICATION EVENTS
    // ========================================================================

    /**
     * Email handlers - In production, integrate with email service.
     */
    this.$.on.Email.sendConfirmation(async (event) => {
      const { customerId, orderId, totals } = event.data as {
        customerId: string
        orderId: string
        items: CartItem[]
        totals: CheckoutTotals
        shippingAddress: Address
      }

      if (orderId !== this.ns) return

      console.log(`[Email.sendConfirmation] Order ${orderId} confirmation to ${customerId}`)
      console.log(`  Total: $${totals.total.toFixed(2)}`)
      // In production: sendgrid.send({ template: 'order_confirmation', ... })
    })

    this.$.on.Email.sendShipping(async (event) => {
      const { orderId, trackingNumber, carrier } = event.data as {
        customerId: string
        orderId: string
        trackingNumber: string
        carrier: string
        estimatedDelivery: Date
      }

      if (orderId !== this.ns) return

      console.log(`[Email.sendShipping] Order ${orderId} tracking: ${trackingNumber} via ${carrier}`)
      // In production: sendgrid.send({ template: 'shipping_notification', ... })
    })

    this.$.on.Email.sendCancellation(async (event) => {
      const { orderId, reason } = event.data as {
        customerId: string
        orderId: string
        reason: string
      }

      if (orderId !== this.ns) return

      console.log(`[Email.sendCancellation] Order ${orderId} cancelled: ${reason}`)
      // In production: sendgrid.send({ template: 'order_cancellation', ... })
    })

    /**
     * Review.requested - Ask customer for review after delivery.
     */
    this.$.on.Review.requested(async (event) => {
      const { orderId, customerId } = event.data as {
        orderId: string
        customerId: string
        items: CartItem[]
      }

      if (orderId !== this.ns) return

      console.log(`[Review.requested] Requesting review for order ${orderId} from ${customerId}`)
      // In production: send review request email
    })

    console.log('[OrderDO] Event handlers registered')
  }

  // ==========================================================================
  // PUBLIC API METHODS
  // ==========================================================================

  /**
   * Get order details.
   */
  async getOrder(): Promise<Order | null> {
    return (await this.ctx.storage.get<Order>('order')) ?? null
  }

  /**
   * Get order status and timeline.
   */
  async getStatus(): Promise<{ status: OrderStatus; timeline: OrderEvent[] } | null> {
    const order = await this.getOrder()
    if (!order) return null
    return { status: order.status, timeline: order.timeline }
  }

  /**
   * Cancel order.
   */
  async cancel(reason: string): Promise<void> {
    const order = await this.getOrder()
    if (!order) {
      throw new OrderError(`Order not found: ${this.ns}`, 'ORDER_NOT_FOUND')
    }

    if (['shipped', 'delivered'].includes(order.status)) {
      throw new OrderError(
        'Cannot cancel order that has already shipped',
        'CANNOT_CANCEL',
        { currentStatus: order.status }
      )
    }

    this.$.send('Order.cancel', { orderId: this.ns, reason })
  }

  /**
   * Mark order as delivered (for testing/simulation).
   */
  async markDelivered(): Promise<void> {
    const order = await this.getOrder()
    if (!order) {
      throw new OrderError(`Order not found: ${this.ns}`, 'ORDER_NOT_FOUND')
    }

    if (order.status !== 'shipped') {
      throw new OrderError('Order must be shipped before delivery', 'INVALID_STATE')
    }

    this.$.send('Fulfillment.delivered', { orderId: this.ns })
  }

  /**
   * Get tracking information.
   */
  async getTracking(): Promise<{
    trackingNumber?: string
    carrier?: string
    estimatedDelivery?: Date
    deliveredAt?: Date
  } | null> {
    const order = await this.getOrder()
    if (!order) return null

    return {
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
      estimatedDelivery: order.estimatedDelivery,
      deliveredAt: order.deliveredAt,
    }
  }
}
