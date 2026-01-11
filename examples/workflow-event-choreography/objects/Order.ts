/**
 * Order Durable Object - Saga Coordinator
 *
 * The Order DO is the entry point for order processing. It:
 * 1. Receives order placement requests
 * 2. Emits events to trigger downstream services (Payment, Inventory, Shipping)
 * 3. Tracks saga state and coordinates compensation on failures
 *
 * This is NOT an orchestrator - it emits events and lets other DOs react.
 * But it does track the overall saga state to handle failures gracefully.
 */

import { DO } from 'dotdo'
import type {
  OrderItem,
  OrderPlacedEvent,
  OrderCancelledEvent,
  Address,
  PaymentCompletedEvent,
  PaymentFailedEvent,
  InventoryReservedEvent,
  InventoryReservationFailedEvent,
  ShipmentDeliveredEvent,
  SagaStep,
  OrderSagaState,
} from '../events/types'

// ============================================================================
// TYPES
// ============================================================================

interface Order {
  id: string
  customerId: string
  items: OrderItem[]
  total: number
  shippingAddress: Address
  status: 'pending' | 'processing' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'failed'
  paymentId?: string
  reservationId?: string
  shipmentId?: string
  createdAt: string
  updatedAt: string
}

interface Env {
  PAYMENT: DurableObjectNamespace
  INVENTORY: DurableObjectNamespace
  SHIPPING: DurableObjectNamespace
}

// ============================================================================
// ORDER DURABLE OBJECT
// ============================================================================

export class OrderDO extends DO<Env> {
  static readonly $type = 'OrderDO'

  /**
   * Initialize event handlers on startup.
   * The Order DO listens for responses from downstream services.
   */
  async onStart() {
    // ========================================================================
    // PAYMENT RESPONSE HANDLERS
    // ========================================================================

    /**
     * Payment.completed - Payment was successful, proceed with fulfillment.
     */
    this.$.on.Payment.completed(async (event) => {
      const data = event.data as PaymentCompletedEvent
      const order = await this.get<Order>('order')

      if (!order || order.id !== data.orderId) return

      console.log(`[Order:${order.id}] Payment completed: ${data.paymentId}`)

      // Update saga state
      await this.updateSagaStep('payment', 'completed')

      // Update order
      await this.set('order', {
        ...order,
        status: 'paid',
        paymentId: data.paymentId,
        updatedAt: new Date().toISOString(),
      })

      // Check if we can start shipping
      await this.checkAndStartShipping()
    })

    /**
     * Payment.failed - Payment failed, trigger compensation.
     */
    this.$.on.Payment.failed(async (event) => {
      const data = event.data as PaymentFailedEvent
      const order = await this.get<Order>('order')

      if (!order || order.id !== data.orderId) return

      console.log(`[Order:${order.id}] Payment failed: ${data.error}`)

      // Update saga state and start compensation
      await this.updateSagaStep('payment', 'failed', data.error)
      await this.startCompensation('Payment failed: ' + data.error)
    })

    // ========================================================================
    // INVENTORY RESPONSE HANDLERS
    // ========================================================================

    /**
     * Inventory.reserved - Stock reserved, proceed with shipping.
     */
    this.$.on.Inventory.reserved(async (event) => {
      const data = event.data as InventoryReservedEvent
      const order = await this.get<Order>('order')

      if (!order || order.id !== data.orderId) return

      console.log(`[Order:${order.id}] Inventory reserved: ${data.reservationId}`)

      // Update saga state
      await this.updateSagaStep('inventory', 'completed')

      // Store reservation ID for potential compensation
      await this.set('order', {
        ...order,
        reservationId: data.reservationId,
        updatedAt: new Date().toISOString(),
      })

      // Check if we can start shipping
      await this.checkAndStartShipping()
    })

    /**
     * Inventory.reservationFailed - Stock not available, trigger compensation.
     */
    this.$.on.Inventory.reservationFailed(async (event) => {
      const data = event.data as InventoryReservationFailedEvent
      const order = await this.get<Order>('order')

      if (!order || order.id !== data.orderId) return

      const failedSkus = data.failedItems.map((i) => i.sku).join(', ')
      console.log(`[Order:${order.id}] Inventory reservation failed: ${failedSkus}`)

      // Update saga state and start compensation
      await this.updateSagaStep('inventory', 'failed', `Items unavailable: ${failedSkus}`)
      await this.startCompensation('Items out of stock: ' + failedSkus)
    })

    // ========================================================================
    // SHIPPING RESPONSE HANDLERS
    // ========================================================================

    /**
     * Shipment.delivered - Order complete!
     */
    this.$.on.Shipment.delivered(async (event) => {
      const data = event.data as ShipmentDeliveredEvent
      const order = await this.get<Order>('order')

      if (!order || order.id !== data.orderId) return

      console.log(`[Order:${order.id}] Delivered! Shipment: ${data.shipmentId}`)

      // Update saga state
      await this.updateSagaStep('shipping', 'completed')

      // Complete the saga
      const saga = await this.get<OrderSagaState>('saga')
      if (saga) {
        await this.set('saga', {
          ...saga,
          status: 'completed',
          completedAt: new Date().toISOString(),
        })
      }

      // Update order status
      await this.set('order', {
        ...order,
        status: 'delivered',
        updatedAt: new Date().toISOString(),
      })

      // Emit order completed event
      this.$.send('Order.completed', {
        orderId: order.id,
        customerId: order.customerId,
        completedAt: new Date().toISOString(),
      })

      // Notify customer
      this.$.send('Customer.notified', {
        customerId: order.customerId,
        orderId: order.id,
        type: 'delivered',
        message: 'Your order has been delivered!',
        sentAt: new Date().toISOString(),
      })
    })

    console.log('[OrderDO] Event handlers registered')
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  /**
   * Place a new order - kicks off the entire saga.
   */
  async placeOrder(
    customerId: string,
    items: OrderItem[],
    shippingAddress: Address
  ): Promise<Order> {
    const orderId = `ord_${crypto.randomUUID().slice(0, 8)}`
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const now = new Date().toISOString()

    const order: Order = {
      id: orderId,
      customerId,
      items,
      total,
      shippingAddress,
      status: 'processing',
      createdAt: now,
      updatedAt: now,
    }

    // Initialize saga state
    const saga: OrderSagaState = {
      orderId,
      status: 'in_progress',
      steps: {
        payment: { name: 'payment', status: 'pending' },
        inventory: { name: 'inventory', status: 'pending' },
        shipping: { name: 'shipping', status: 'pending' },
      },
      startedAt: now,
    }

    // Persist order and saga state
    await this.set('order', order)
    await this.set('saga', saga)

    console.log(`[Order:${orderId}] Order placed. Starting saga...`)

    // Emit Order.placed event - this triggers the choreography
    const placedEvent: OrderPlacedEvent = {
      orderId,
      customerId,
      items,
      total,
      shippingAddress,
      createdAt: now,
    }
    this.$.send('Order.placed', placedEvent)

    // Kick off parallel steps: payment and inventory
    // These are fire-and-forget - we'll receive responses via events

    // 1. Request payment
    this.$.send('Payment.requested', {
      orderId,
      customerId,
      amount: total,
      idempotencyKey: `${orderId}-payment`,
    })

    // 2. Reserve inventory
    this.$.send('Inventory.reserveRequested', {
      orderId,
      items: items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
      reservationExpiry: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
    })

    // 3. Notify customer immediately
    this.$.send('Customer.notified', {
      customerId,
      orderId,
      type: 'order_confirmed',
      message: `Order ${orderId} confirmed! We're processing your payment.`,
      data: { itemCount: items.length, total },
      sentAt: now,
    })

    return order
  }

  /**
   * Cancel an order - triggers compensation.
   */
  async cancelOrder(orderId: string, reason: string): Promise<void> {
    const order = await this.get<Order>('order')
    if (!order || order.id !== orderId) {
      throw new Error('Order not found')
    }

    if (order.status === 'cancelled' || order.status === 'failed') {
      throw new Error('Order already cancelled')
    }

    if (order.status === 'delivered') {
      throw new Error('Cannot cancel delivered order')
    }

    console.log(`[Order:${orderId}] Cancellation requested: ${reason}`)

    await this.startCompensation(reason)
  }

  /**
   * Get current order state.
   */
  async getOrder(): Promise<Order | null> {
    return this.get<Order>('order')
  }

  /**
   * Get saga state for debugging.
   */
  async getSagaState(): Promise<OrderSagaState | null> {
    return this.get<OrderSagaState>('saga')
  }

  // ==========================================================================
  // SAGA COORDINATION
  // ==========================================================================

  /**
   * Check if both payment and inventory are done, then start shipping.
   */
  private async checkAndStartShipping(): Promise<void> {
    const saga = await this.get<OrderSagaState>('saga')
    const order = await this.get<Order>('order')

    if (!saga || !order) return
    if (saga.status !== 'in_progress') return

    // Check if both payment and inventory are completed
    if (
      saga.steps.payment.status === 'completed' &&
      saga.steps.inventory.status === 'completed' &&
      saga.steps.shipping.status === 'pending'
    ) {
      console.log(`[Order:${order.id}] Payment + Inventory done. Starting shipping...`)

      // Update shipping step to in-progress
      await this.updateSagaStep('shipping', 'pending')

      // Request shipment creation
      this.$.send('Shipment.create', {
        orderId: order.id,
        customerId: order.customerId,
        address: order.shippingAddress,
        items: order.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
      })
    }
  }

  /**
   * Update a saga step status.
   */
  private async updateSagaStep(
    step: 'payment' | 'inventory' | 'shipping',
    status: SagaStep['status'],
    error?: string
  ): Promise<void> {
    const saga = await this.get<OrderSagaState>('saga')
    if (!saga) return

    saga.steps[step] = {
      ...saga.steps[step],
      status,
      completedAt: status === 'completed' ? new Date().toISOString() : undefined,
      error,
    }

    await this.set('saga', saga)
  }

  /**
   * Start compensation (rollback) for the saga.
   */
  private async startCompensation(reason: string): Promise<void> {
    const saga = await this.get<OrderSagaState>('saga')
    const order = await this.get<Order>('order')

    if (!saga || !order) return
    if (saga.status === 'compensating' || saga.status === 'failed') return

    console.log(`[Order:${order.id}] Starting compensation: ${reason}`)

    // Mark saga as compensating
    await this.set('saga', {
      ...saga,
      status: 'compensating',
    })

    // Emit Order.cancelled event
    const cancelledEvent: OrderCancelledEvent = {
      orderId: order.id,
      customerId: order.customerId,
      reason,
      cancelledAt: new Date().toISOString(),
    }
    this.$.send('Order.cancelled', cancelledEvent)

    // Compensate: Release inventory if reserved
    if (saga.steps.inventory.status === 'completed' && order.reservationId) {
      console.log(`[Order:${order.id}] Releasing inventory reservation...`)
      this.$.send('Inventory.release', {
        orderId: order.id,
        reservationId: order.reservationId,
        items: order.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
        reason: 'ORDER_CANCELLED',
        releasedAt: new Date().toISOString(),
      })
      await this.updateSagaStep('inventory', 'compensated')
    }

    // Compensate: Refund payment if completed
    if (saga.steps.payment.status === 'completed' && order.paymentId) {
      console.log(`[Order:${order.id}] Initiating refund...`)
      this.$.send('Payment.refund', {
        orderId: order.id,
        paymentId: order.paymentId,
        amount: order.total,
        reason,
      })
      await this.updateSagaStep('payment', 'compensated')
    }

    // Compensate: Cancel shipment if created
    if (saga.steps.shipping.status === 'completed' && order.shipmentId) {
      console.log(`[Order:${order.id}] Cancelling shipment...`)
      this.$.send('Shipment.cancel', {
        orderId: order.id,
        shipmentId: order.shipmentId,
        reason,
      })
      await this.updateSagaStep('shipping', 'compensated')
    }

    // Update order status
    await this.set('order', {
      ...order,
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
    })

    // Mark saga as failed
    await this.set('saga', {
      ...saga,
      status: 'failed',
      failedAt: new Date().toISOString(),
    })

    // Notify customer
    this.$.send('Customer.notified', {
      customerId: order.customerId,
      orderId: order.id,
      type: 'cancelled',
      message: `Order ${order.id} has been cancelled: ${reason}`,
      sentAt: new Date().toISOString(),
    })
  }
}
