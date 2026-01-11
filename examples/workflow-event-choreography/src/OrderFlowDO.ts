/**
 * OrderFlowDO - Event-Driven Order Processing
 *
 * Demonstrates event choreography: services react to events they care about,
 * emitting their own events for others to consume. No central orchestrator.
 *
 * Flow:
 *   Order.placed
 *     ├─> Payment.requested
 *     ├─> Inventory.check
 *     └─> Customer.notified (order confirmation)
 *
 *   Payment.completed
 *     ├─> Invoice.created
 *     └─> Fulfillment.started
 *
 *   Payment.failed
 *     ├─> Inventory.release (compensation)
 *     └─> Customer.notified (payment failed)
 *
 *   Inventory.reserved
 *     └─> Shipping.prepared
 *
 *   Shipment.dispatched
 *     └─> Customer.notified (shipping update)
 *
 *   Shipment.delivered
 *     └─> Review.requested (3 days later)
 *
 *   Order.cancelled
 *     ├─> Payment.refund (if paid)
 *     ├─> Inventory.release
 *     └─> Customer.notified
 */

import { DO } from 'dotdo'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface OrderItem {
  sku: string
  name: string
  quantity: number
  price: number
}

interface Order {
  id: string
  customerId: string
  items: OrderItem[]
  total: number
  status: 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled'
  paymentId?: string
  shipmentId?: string
  createdAt: Date
}

interface PaymentData {
  id: string
  orderId: string
  amount: number
  method: 'card' | 'bank' | 'wallet'
  status: 'pending' | 'completed' | 'failed' | 'refunded'
}

interface InventoryData {
  orderId: string
  items: Array<{ sku: string; quantity: number }>
  reservationId?: string
}

interface ShipmentData {
  id: string
  orderId: string
  trackingNumber: string
  carrier: string
  status: 'preparing' | 'dispatched' | 'in_transit' | 'delivered'
  estimatedDelivery?: Date
}

interface NotificationData {
  customerId: string
  type: 'order_confirmation' | 'payment_failed' | 'payment_received' | 'shipping_update' | 'delivered' | 'review_request' | 'order_cancelled'
  orderId: string
  data?: Record<string, unknown>
}

// ============================================================================
// ORDER FLOW DURABLE OBJECT
// ============================================================================

export class OrderFlowDO extends DO {
  static readonly $type = 'OrderFlowDO'

  /**
   * Register all event handlers on startup.
   * Each handler is a loosely-coupled "service" that reacts to domain events.
   */
  async onStart() {
    // ========================================================================
    // ORDER EVENTS
    // ========================================================================

    /**
     * Order.placed - The starting point of the order lifecycle.
     * Triggers parallel actions: payment processing, inventory check, notification.
     */
    this.$.on.Order.placed(async (event) => {
      const order = event.data as Order
      console.log(`[Order.placed] Order ${order.id} received for customer ${order.customerId}`)

      // Fire parallel events - no await, no coupling
      // Each service will pick up the events it cares about

      // 1. Request payment processing
      this.$.send('Payment.requested', {
        orderId: order.id,
        customerId: order.customerId,
        amount: order.total,
        method: 'card', // Default method
      })

      // 2. Check and reserve inventory
      this.$.send('Inventory.check', {
        orderId: order.id,
        items: order.items.map(item => ({
          sku: item.sku,
          quantity: item.quantity,
        })),
      })

      // 3. Notify customer immediately
      this.$.send('Customer.notified', {
        customerId: order.customerId,
        type: 'order_confirmation',
        orderId: order.id,
        data: {
          itemCount: order.items.length,
          total: order.total,
        },
      } satisfies NotificationData)

      // Store order in local state for tracking
      await this.set('order', order)
    })

    /**
     * Order.cancelled - Handle cancellation with proper compensation.
     * Must undo any work already done (refunds, restocking).
     */
    this.$.on.Order.cancelled(async (event) => {
      const { orderId, reason } = event.data as { orderId: string; reason: string }
      const order = await this.get<Order>('order')

      if (!order) {
        console.error(`[Order.cancelled] Order ${orderId} not found`)
        return
      }

      console.log(`[Order.cancelled] Order ${orderId} cancelled: ${reason}`)

      // Compensation: Refund if payment was completed
      if (order.paymentId) {
        this.$.send('Payment.refund', {
          orderId: order.id,
          paymentId: order.paymentId,
          amount: order.total,
          reason,
        })
      }

      // Compensation: Release reserved inventory
      this.$.send('Inventory.release', {
        orderId: order.id,
        items: order.items.map(item => ({
          sku: item.sku,
          quantity: item.quantity,
        })),
      })

      // Notify customer
      this.$.send('Customer.notified', {
        customerId: order.customerId,
        type: 'order_cancelled',
        orderId: order.id,
        data: { reason },
      } satisfies NotificationData)

      // Update order status
      await this.set('order', { ...order, status: 'cancelled' })
    })

    // ========================================================================
    // PAYMENT EVENTS
    // ========================================================================

    /**
     * Payment.requested - Process payment request.
     * In production, this would call a payment gateway.
     */
    this.$.on.Payment.requested(async (event) => {
      const { orderId, customerId, amount, method } = event.data as {
        orderId: string
        customerId: string
        amount: number
        method: string
      }
      console.log(`[Payment.requested] Processing $${amount} payment for order ${orderId}`)

      // Simulate payment processing (in production: call Stripe, etc.)
      const paymentSucceeds = Math.random() > 0.1 // 90% success rate

      const paymentId = `pay_${crypto.randomUUID().slice(0, 8)}`

      if (paymentSucceeds) {
        this.$.send('Payment.completed', {
          id: paymentId,
          orderId,
          amount,
          method,
          status: 'completed',
        } satisfies PaymentData)
      } else {
        this.$.send('Payment.failed', {
          id: paymentId,
          orderId,
          amount,
          method,
          status: 'failed',
          error: 'Card declined',
        })
      }
    })

    /**
     * Payment.completed - Payment successful, proceed with fulfillment.
     */
    this.$.on.Payment.completed(async (event) => {
      const payment = event.data as PaymentData
      console.log(`[Payment.completed] Payment ${payment.id} completed for order ${payment.orderId}`)

      // Update order with payment info
      const order = await this.get<Order>('order')
      if (order) {
        await this.set('order', { ...order, paymentId: payment.id, status: 'paid' })
      }

      // Trigger downstream services
      this.$.send('Invoice.created', {
        paymentId: payment.id,
        orderId: payment.orderId,
        amount: payment.amount,
        createdAt: new Date(),
      })

      this.$.send('Fulfillment.started', {
        orderId: payment.orderId,
        paymentId: payment.id,
      })

      // Notify customer
      const customerId = order?.customerId
      if (customerId) {
        this.$.send('Customer.notified', {
          customerId,
          type: 'payment_received',
          orderId: payment.orderId,
          data: { amount: payment.amount },
        } satisfies NotificationData)
      }
    })

    /**
     * Payment.failed - Handle payment failure with compensation.
     */
    this.$.on.Payment.failed(async (event) => {
      const { orderId, error } = event.data as { orderId: string; error: string }
      console.log(`[Payment.failed] Payment failed for order ${orderId}: ${error}`)

      const order = await this.get<Order>('order')

      // Compensation: Release any reserved inventory
      this.$.send('Inventory.release', {
        orderId,
        items: order?.items.map(item => ({
          sku: item.sku,
          quantity: item.quantity,
        })) ?? [],
      })

      // Notify customer about failure
      if (order?.customerId) {
        this.$.send('Customer.notified', {
          customerId: order.customerId,
          type: 'payment_failed',
          orderId,
          data: { error, retryUrl: `/orders/${orderId}/retry-payment` },
        } satisfies NotificationData)
      }
    })

    /**
     * Payment.refund - Process refund for cancelled/returned orders.
     */
    this.$.on.Payment.refund(async (event) => {
      const { orderId, paymentId, amount, reason } = event.data as {
        orderId: string
        paymentId: string
        amount: number
        reason: string
      }
      console.log(`[Payment.refund] Refunding $${amount} for order ${orderId}: ${reason}`)

      // In production: call payment gateway to process refund
      // Stripe: stripe.refunds.create({ payment_intent: paymentId })

      this.$.send('Refund.completed', {
        orderId,
        paymentId,
        amount,
        refundedAt: new Date(),
      })
    })

    // ========================================================================
    // INVENTORY EVENTS
    // ========================================================================

    /**
     * Inventory.check - Check and reserve inventory for order items.
     */
    this.$.on.Inventory.check(async (event) => {
      const { orderId, items } = event.data as InventoryData
      console.log(`[Inventory.check] Checking inventory for order ${orderId}`)

      // In production: query inventory database
      // For demo: assume all items are in stock
      const allInStock = true
      const reservationId = `res_${crypto.randomUUID().slice(0, 8)}`

      if (allInStock) {
        this.$.send('Inventory.reserved', {
          orderId,
          items,
          reservationId,
        } satisfies InventoryData)
      } else {
        this.$.send('Inventory.insufficient', {
          orderId,
          items,
          missingItems: [], // Would list out-of-stock items
        })
      }
    })

    /**
     * Inventory.reserved - Inventory successfully reserved.
     */
    this.$.on.Inventory.reserved(async (event) => {
      const { orderId, reservationId } = event.data as InventoryData
      console.log(`[Inventory.reserved] Inventory reserved for order ${orderId}: ${reservationId}`)

      // Trigger shipping preparation
      this.$.send('Shipping.prepared', {
        orderId,
        reservationId,
      })
    })

    /**
     * Inventory.release - Release reserved inventory (cancellation/failure).
     */
    this.$.on.Inventory.release(async (event) => {
      const { orderId, items } = event.data as InventoryData
      console.log(`[Inventory.release] Releasing inventory for order ${orderId}`)

      // In production: update inventory database to release reservation
      // items.forEach(item => inventoryService.release(item.sku, item.quantity))
    })

    /**
     * Inventory.insufficient - Handle out-of-stock scenario.
     */
    this.$.on.Inventory.insufficient(async (event) => {
      const { orderId, missingItems } = event.data as { orderId: string; missingItems: string[] }
      console.log(`[Inventory.insufficient] Items out of stock for order ${orderId}`)

      const order = await this.get<Order>('order')

      // Notify customer about stock issues
      if (order?.customerId) {
        this.$.send('Customer.notified', {
          customerId: order.customerId,
          type: 'order_cancelled',
          orderId,
          data: {
            reason: 'Items out of stock',
            missingItems,
          },
        } satisfies NotificationData)
      }

      // Cancel the order
      this.$.send('Order.cancelled', {
        orderId,
        reason: 'Items out of stock',
      })
    })

    // ========================================================================
    // FULFILLMENT & SHIPPING EVENTS
    // ========================================================================

    /**
     * Fulfillment.started - Begin order fulfillment process.
     */
    this.$.on.Fulfillment.started(async (event) => {
      const { orderId } = event.data as { orderId: string }
      console.log(`[Fulfillment.started] Starting fulfillment for order ${orderId}`)

      // In production: notify warehouse, create pick list, etc.
    })

    /**
     * Shipping.prepared - Order is packed and ready for shipping.
     */
    this.$.on.Shipping.prepared(async (event) => {
      const { orderId } = event.data as { orderId: string }
      console.log(`[Shipping.prepared] Order ${orderId} ready for shipping`)

      // Create shipment with carrier
      const shipmentId = `ship_${crypto.randomUUID().slice(0, 8)}`
      const trackingNumber = `TRK${Date.now()}`

      this.$.send('Shipment.dispatched', {
        id: shipmentId,
        orderId,
        trackingNumber,
        carrier: 'FastShip',
        status: 'dispatched',
        estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
      } satisfies ShipmentData)
    })

    /**
     * Shipment.dispatched - Order has been shipped.
     */
    this.$.on.Shipment.dispatched(async (event) => {
      const shipment = event.data as ShipmentData
      console.log(`[Shipment.dispatched] Order ${shipment.orderId} shipped: ${shipment.trackingNumber}`)

      // Update order status
      const order = await this.get<Order>('order')
      if (order) {
        await this.set('order', { ...order, shipmentId: shipment.id, status: 'shipped' })

        // Notify customer with tracking info
        this.$.send('Customer.notified', {
          customerId: order.customerId,
          type: 'shipping_update',
          orderId: order.id,
          data: {
            trackingNumber: shipment.trackingNumber,
            carrier: shipment.carrier,
            estimatedDelivery: shipment.estimatedDelivery,
          },
        } satisfies NotificationData)
      }
    })

    /**
     * Shipment.delivered - Order has been delivered.
     */
    this.$.on.Shipment.delivered(async (event) => {
      const shipment = event.data as ShipmentData
      console.log(`[Shipment.delivered] Order ${shipment.orderId} delivered`)

      // Update order status
      const order = await this.get<Order>('order')
      if (order) {
        await this.set('order', { ...order, status: 'delivered' })

        // Notify customer
        this.$.send('Customer.notified', {
          customerId: order.customerId,
          type: 'delivered',
          orderId: order.id,
        } satisfies NotificationData)

        // Schedule review request for 3 days later
        this.$.every('3 days').once(() => {
          this.$.send('Review.requested', {
            orderId: order.id,
            customerId: order.customerId,
          })
        })
      }
    })

    // ========================================================================
    // CUSTOMER NOTIFICATION EVENTS
    // ========================================================================

    /**
     * Customer.notified - Central notification handler.
     * In production, this would integrate with email/SMS/push services.
     */
    this.$.on.Customer.notified(async (event) => {
      const notification = event.data as NotificationData
      console.log(`[Customer.notified] Sending ${notification.type} to customer ${notification.customerId}`)

      // In production: dispatch to appropriate channel
      // - Email: sendgrid.send({ to: customer.email, template: notification.type })
      // - SMS: twilio.messages.create({ to: customer.phone, body: ... })
      // - Push: firebase.messaging.send({ token: customer.pushToken, ... })

      // Track notification for debugging/analytics
      const notifications = (await this.get<NotificationData[]>('notifications')) ?? []
      notifications.push({ ...notification, sentAt: new Date() } as NotificationData & { sentAt: Date })
      await this.set('notifications', notifications)
    })

    // ========================================================================
    // REVIEW & FEEDBACK EVENTS
    // ========================================================================

    /**
     * Review.requested - Ask customer for a review after delivery.
     */
    this.$.on.Review.requested(async (event) => {
      const { orderId, customerId } = event.data as { orderId: string; customerId: string }
      console.log(`[Review.requested] Requesting review for order ${orderId}`)

      // In production: send review request email/notification
      this.$.send('Customer.notified', {
        customerId,
        type: 'review_request',
        orderId,
        data: {
          reviewUrl: `/orders/${orderId}/review`,
        },
      } satisfies NotificationData)
    })

    // ========================================================================
    // INVOICE EVENTS
    // ========================================================================

    /**
     * Invoice.created - Generate invoice after successful payment.
     */
    this.$.on.Invoice.created(async (event) => {
      const { orderId, paymentId, amount } = event.data as {
        orderId: string
        paymentId: string
        amount: number
      }
      console.log(`[Invoice.created] Invoice generated for order ${orderId}: $${amount}`)

      // In production: generate PDF, store in S3, email to customer
    })

    console.log('[OrderFlowDO] Event handlers registered')
  }

  // ==========================================================================
  // PUBLIC API METHODS
  // ==========================================================================

  /**
   * Place a new order - entry point for the order flow.
   */
  async placeOrder(customerId: string, items: OrderItem[]): Promise<Order> {
    const order: Order = {
      id: `ord_${crypto.randomUUID().slice(0, 8)}`,
      customerId,
      items,
      total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      status: 'pending',
      createdAt: new Date(),
    }

    // Emit the event that kicks off the entire flow
    this.$.send('Order.placed', order)

    return order
  }

  /**
   * Cancel an existing order.
   */
  async cancelOrder(orderId: string, reason: string): Promise<void> {
    this.$.send('Order.cancelled', { orderId, reason })
  }

  /**
   * Simulate delivery (for testing).
   */
  async simulateDelivery(orderId: string): Promise<void> {
    const order = await this.get<Order>('order')
    if (order?.shipmentId) {
      this.$.send('Shipment.delivered', {
        id: order.shipmentId,
        orderId,
        trackingNumber: 'TRK-SIMULATED',
        carrier: 'FastShip',
        status: 'delivered',
      } satisfies ShipmentData)
    }
  }

  /**
   * Get event history for debugging.
   */
  async getEventHistory(): Promise<NotificationData[]> {
    return (await this.get<NotificationData[]>('notifications')) ?? []
  }

  /**
   * Replay events from a point in time (for debugging/recovery).
   */
  async replayEvents(fromTimestamp: Date): Promise<void> {
    console.log(`[OrderFlowDO] Replaying events from ${fromTimestamp.toISOString()}`)
    // In production: query event store and re-emit events
    // This enables event sourcing patterns for debugging and recovery
  }
}
