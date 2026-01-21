// Order Durable Object - Saga Coordinator
// Demonstrates: Event choreography, saga pattern, compensation logic
// Key patterns: $.send for fire-and-forget events, $.on handlers for reactions

import { Hono } from 'hono'
import { DO, type DOEnv, createContext } from '@dotdo/do'
import type {
  Order,
  OrderItem,
  OrderStatus,
  ShippingAddress,
  SagaState,
  SagaStep,
} from './types'

export class OrderDO extends DO {
  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env)
    this.$ = createContext(state, env)

    // ========================================================================
    // React to events from other DOs (choreography pattern)
    // ========================================================================

    // Payment completed - update saga, check if ready for shipping
    this.$.on.Payment.completed(async (event) => {
      const { orderId, paymentId, transactionId } = (event as { type: string; payload: { orderId: string; paymentId: string; transactionId: string } }).payload
      console.log(`[Order] Payment completed for ${orderId}, txn: ${transactionId}`)

      const order = await this.getOrderByOrderId(orderId)
      if (!order) return

      await this.things.update(order.$id, {
        paymentId,
        saga: this.updateSagaStep(order.saga, 'payment', 'completed'),
      })

      await this.checkAndStartShipping(order.$id)
    })

    // Payment failed - start compensation
    this.$.on.Payment.failed(async (event) => {
      const { orderId, reason } = (event as { type: string; payload: { orderId: string; reason: string } }).payload
      console.log(`[Order] Payment failed for ${orderId}: ${reason}`)

      const order = await this.getOrderByOrderId(orderId)
      if (!order) return

      await this.startCompensation(order.$id, `Payment failed: ${reason}`)
    })

    // Inventory reserved - update saga, check if ready for shipping
    this.$.on.Inventory.reserved(async (event) => {
      const { orderId, reservationId } = (event as { type: string; payload: { orderId: string; reservationId: string } }).payload
      console.log(`[Order] Inventory reserved for ${orderId}, reservation: ${reservationId}`)

      const order = await this.getOrderByOrderId(orderId)
      if (!order) return

      await this.things.update(order.$id, {
        reservationId,
        saga: this.updateSagaStep(order.saga, 'inventory', 'completed'),
      })

      await this.checkAndStartShipping(order.$id)
    })

    // Inventory reservation failed - start compensation
    this.$.on.Inventory.reservationFailed(async (event) => {
      const { orderId, reason } = (event as { type: string; payload: { orderId: string; reason: string } }).payload
      console.log(`[Order] Inventory reservation failed for ${orderId}: ${reason}`)

      const order = await this.getOrderByOrderId(orderId)
      if (!order) return

      await this.startCompensation(order.$id, `Inventory failed: ${reason}`)
    })

    // Shipment created - update order
    this.$.on.Shipment.created(async (event) => {
      const { orderId, shipmentId, trackingNumber } = (event as { type: string; payload: { orderId: string; shipmentId: string; trackingNumber: string } }).payload
      console.log(`[Order] Shipment created for ${orderId}, tracking: ${trackingNumber}`)

      const order = await this.getOrderByOrderId(orderId)
      if (!order) return

      await this.things.update(order.$id, {
        shipmentId,
        status: 'shipping_created',
        saga: this.updateSagaStep(order.saga, 'shipping', 'in_progress'),
      })
    })

    // Shipment dispatched - update order
    this.$.on.Shipment.dispatched(async (event) => {
      const { orderId } = (event as { type: string; payload: { orderId: string } }).payload
      console.log(`[Order] Shipment dispatched for ${orderId}`)

      const order = await this.getOrderByOrderId(orderId)
      if (!order) return

      await this.things.update(order.$id, {
        status: 'shipping_dispatched',
      })
    })

    // Shipment delivered - complete order
    this.$.on.Shipment.delivered(async (event) => {
      const { orderId } = (event as { type: string; payload: { orderId: string } }).payload
      console.log(`[Order] Shipment delivered for ${orderId}`)

      const order = await this.getOrderByOrderId(orderId)
      if (!order) return

      await this.things.update(order.$id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        saga: this.updateSagaStep(order.saga, 'shipping', 'completed'),
      })

      this.$.send({
        type: 'Order.completed',
        payload: { orderId },
      })
    })

    // Wildcard for audit logging
    this.$.on['*']['*'](async (event) => {
      const e = event as { type: string; payload: unknown }
      console.log(`[Audit] ${e.type}`, e.payload)
    })
  }

  private async getOrderByOrderId(orderId: string): Promise<(Order & { $id: string; saga: SagaState }) | null> {
    const orders = await this.things.list({ type: 'Order' })
    const order = orders.find((o) => o.$id === orderId || (o as unknown as Order).customerId === orderId)
    return order ? (order as unknown as Order & { $id: string; saga: SagaState }) : null
  }

  private updateSagaStep(saga: SagaState, step: keyof SagaState['steps'], status: SagaStep['status']): SagaState {
    return {
      ...saga,
      steps: {
        ...saga.steps,
        [step]: {
          ...saga.steps[step],
          status,
          completedAt: status === 'completed' ? new Date().toISOString() : saga.steps[step].completedAt,
        },
      },
    }
  }

  private async checkAndStartShipping(orderThingId: string): Promise<void> {
    const order = await this.things.get(orderThingId)
    if (!order) return

    const o = order as unknown as Order
    const saga = o.saga

    // Both payment and inventory must be completed
    if (saga.steps.payment.status === 'completed' && saga.steps.inventory.status === 'completed') {
      console.log(`[Order] Payment + Inventory done for ${orderThingId}. Starting shipping...`)

      await this.things.update(orderThingId, {
        saga: this.updateSagaStep(saga, 'shipping', 'in_progress'),
      })

      // Fire event to create shipment (choreography - no direct call)
      this.$.send({
        type: 'Shipment.create',
        payload: {
          orderId: orderThingId,
          address: o.shippingAddress,
          items: o.items,
        },
      })
    }
  }

  private async startCompensation(orderThingId: string, reason: string): Promise<void> {
    const order = await this.things.get(orderThingId)
    if (!order) return

    const o = order as unknown as Order
    console.log(`[Order] Starting compensation for ${orderThingId}: ${reason}`)

    await this.things.update(orderThingId, {
      status: 'compensating',
      saga: { ...o.saga, compensationReason: reason },
    })

    // Release inventory if reserved
    if (o.saga.steps.inventory.status === 'completed' && o.reservationId) {
      this.$.send({
        type: 'Inventory.release',
        payload: { orderId: orderThingId, reason: 'ORDER_CANCELLED' },
      })
    }

    // Refund payment if completed
    if (o.saga.steps.payment.status === 'completed' && o.paymentId) {
      this.$.send({
        type: 'Payment.refund',
        payload: { orderId: orderThingId, paymentId: o.paymentId, amount: o.total, reason },
      })
    }

    // Cancel shipment if created
    if (o.saga.steps.shipping.status !== 'pending' && o.shipmentId) {
      this.$.send({
        type: 'Shipment.cancel',
        payload: { orderId: orderThingId, shipmentId: o.shipmentId },
      })
    }

    await this.things.update(orderThingId, {
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
    })

    this.$.send({
      type: 'Order.cancelled',
      payload: { orderId: orderThingId, reason },
    })

    // Notify customer
    this.$.send({
      type: 'Customer.notified',
      payload: { orderId: orderThingId, type: 'cancelled', reason },
    })
  }

  protected routes(app: Hono): void {
    // Create order and kick off saga
    app.post('/orders', async (c) => {
      const data = await c.req.json<{
        customerId: string
        items: OrderItem[]
        shippingAddress: ShippingAddress
      }>()

      const total = data.items.reduce((sum, item) => sum + item.price * item.quantity, 0)

      const saga: SagaState = {
        steps: {
          payment: { name: 'payment', status: 'pending' },
          inventory: { name: 'inventory', status: 'pending' },
          shipping: { name: 'shipping', status: 'pending' },
        },
      }

      const order = await this.things.create({
        $type: 'Order',
        customerId: data.customerId,
        items: data.items,
        total,
        status: 'pending' as OrderStatus,
        shippingAddress: data.shippingAddress,
        saga,
        createdAt: new Date().toISOString(),
      })

      console.log(`[Order] Order placed: ${order.$id}. Starting saga...`)

      // Fire events to start saga (choreography - parallel execution)
      this.$.send({
        type: 'Order.placed',
        payload: {
          orderId: order.$id,
          customerId: data.customerId,
          items: data.items,
          total,
          shippingAddress: data.shippingAddress,
        },
      })

      this.$.send({
        type: 'Payment.requested',
        payload: {
          orderId: order.$id,
          amount: total,
          idempotencyKey: `pay_${order.$id}`,
        },
      })

      this.$.send({
        type: 'Inventory.reserveRequested',
        payload: {
          orderId: order.$id,
          items: data.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
        },
      })

      // Update saga status
      await this.things.update(order.$id, {
        status: 'payment_requested',
        saga: {
          ...saga,
          steps: {
            ...saga.steps,
            payment: { ...saga.steps.payment, status: 'in_progress', startedAt: new Date().toISOString() },
            inventory: { ...saga.steps.inventory, status: 'in_progress', startedAt: new Date().toISOString() },
          },
        },
      })

      return c.json(await this.things.get(order.$id), 201)
    })

    // Get order
    app.get('/orders/:id', async (c) => {
      const order = await this.things.get(c.req.param('id'))
      if (!order || order.$type !== 'Order') {
        return c.json({ error: 'Order not found' }, 404)
      }
      return c.json(order)
    })

    // Get saga state
    app.get('/orders/:id/saga', async (c) => {
      const order = await this.things.get(c.req.param('id'))
      if (!order || order.$type !== 'Order') {
        return c.json({ error: 'Order not found' }, 404)
      }
      return c.json((order as unknown as Order).saga)
    })

    // Cancel order
    app.delete('/orders/:id', async (c) => {
      const orderId = c.req.param('id')
      const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({}))

      const order = await this.things.get(orderId)
      if (!order || order.$type !== 'Order') {
        return c.json({ error: 'Order not found' }, 404)
      }

      await this.startCompensation(orderId, reason ?? 'Customer requested cancellation')

      return c.json({ success: true, message: 'Order cancellation initiated' })
    })
  }
}
