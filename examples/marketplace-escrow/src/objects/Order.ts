/**
 * OrderDO - Order Tracking Durable Object
 *
 * Manages order state and tracking information for escrow transactions.
 * Each escrow can have an associated order for detailed tracking.
 *
 * Responsibilities:
 * - Track shipment status
 * - Store delivery confirmation
 * - Manage order metadata
 * - Link to escrow for fund release
 *
 * Events Emitted:
 * - Order.created - Order created from escrow
 * - Order.shipped - Item shipped with tracking
 * - Order.inTransit - Item in transit (carrier update)
 * - Order.outForDelivery - Item out for delivery
 * - Order.delivered - Item delivered
 * - Order.deliveryFailed - Delivery attempt failed
 */

import { DO } from 'dotdo'
import type { TrackingInfo, TimelineEvent } from '../types'

// ============================================================================
// TYPES
// ============================================================================

export type OrderStatus =
  | 'pending' // Awaiting shipment
  | 'shipped' // Shipped, awaiting carrier pickup
  | 'in_transit' // In transit to destination
  | 'out_for_delivery' // Out for delivery
  | 'delivered' // Successfully delivered
  | 'delivery_failed' // Delivery attempt failed
  | 'returned' // Returned to sender

export interface Order {
  id: string
  escrowId: string
  buyer: string
  seller: string
  itemDescription: string
  shippingAddress?: ShippingAddress
  tracking?: TrackingInfo
  status: OrderStatus
  deliveredAt?: string
  signedBy?: string
  proofOfDelivery?: string
  timeline: TimelineEvent[]
  createdAt: string
  updatedAt: string
}

export interface ShippingAddress {
  name: string
  street: string
  city: string
  state: string
  zip: string
  country: string
  phone?: string
}

export interface CreateOrderRequest {
  escrowId: string
  buyer: string
  seller: string
  itemDescription: string
  shippingAddress?: ShippingAddress
}

export interface ShipOrderRequest {
  carrier: string
  trackingNumber: string
  estimatedDelivery?: string
  shippingAddress?: ShippingAddress
}

export interface DeliveryConfirmation {
  deliveredAt: string
  signedBy?: string
  proofOfDelivery?: string
}

// ============================================================================
// ERROR CLASS
// ============================================================================

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
    // CARRIER UPDATE HANDLERS (webhook simulation)
    // ========================================================================

    /**
     * Handle carrier tracking updates
     */
    this.$.on.Carrier.update(async (event) => {
      const { orderId, status, location, timestamp } = event.data as {
        orderId: string
        status: string
        location?: string
        timestamp: string
      }

      if (orderId !== this.ns) return

      const order = await this.getOrder()
      if (!order) return

      // Map carrier status to order status
      const statusMap: Record<string, OrderStatus> = {
        picked_up: 'shipped',
        in_transit: 'in_transit',
        out_for_delivery: 'out_for_delivery',
        delivered: 'delivered',
        delivery_failed: 'delivery_failed',
        returned: 'returned',
      }

      const newStatus = statusMap[status]
      if (newStatus && newStatus !== order.status) {
        await this.updateStatus(newStatus, { location, carrierTimestamp: timestamp })
      }
    })

    /**
     * Handle delivery confirmation from carrier
     */
    this.$.on.Carrier.delivered(async (event) => {
      const { orderId, signedBy, proofOfDelivery, timestamp } = event.data as {
        orderId: string
        signedBy?: string
        proofOfDelivery?: string
        timestamp: string
      }

      if (orderId !== this.ns) return

      await this.confirmDelivery({
        deliveredAt: timestamp,
        signedBy,
        proofOfDelivery,
      })
    })

    console.log('[OrderDO] Event handlers registered')
  }

  // ==========================================================================
  // ORDER LIFECYCLE METHODS
  // ==========================================================================

  /**
   * Create a new order from escrow.
   */
  async createOrder(request: CreateOrderRequest): Promise<Order> {
    const existing = await this.getOrder()
    if (existing) {
      throw new OrderError('Order already exists', 'ALREADY_EXISTS')
    }

    const id = this.ns
    const now = new Date().toISOString()

    const order: Order = {
      id,
      escrowId: request.escrowId,
      buyer: request.buyer,
      seller: request.seller,
      itemDescription: request.itemDescription,
      shippingAddress: request.shippingAddress,
      status: 'pending',
      timeline: [
        {
          event: 'Order.created',
          timestamp: now,
          details: { escrowId: request.escrowId },
        },
      ],
      createdAt: now,
      updatedAt: now,
    }

    await this.ctx.storage.put('order', order)

    this.$.send('Order.created', {
      orderId: id,
      escrowId: request.escrowId,
      buyer: request.buyer,
      seller: request.seller,
    })

    return order
  }

  /**
   * Ship order with tracking information.
   */
  async shipOrder(request: ShipOrderRequest): Promise<Order> {
    const order = await this.getOrderOrThrow()

    if (order.status !== 'pending') {
      throw new OrderError('Order already shipped', 'ALREADY_SHIPPED')
    }

    const now = new Date().toISOString()

    order.status = 'shipped'
    order.tracking = {
      carrier: request.carrier,
      trackingNumber: request.trackingNumber,
      estimatedDelivery: request.estimatedDelivery,
    }
    if (request.shippingAddress) {
      order.shippingAddress = request.shippingAddress
    }
    order.updatedAt = now

    order.timeline.push({
      event: 'Order.shipped',
      timestamp: now,
      actor: order.seller,
      details: {
        carrier: request.carrier,
        trackingNumber: request.trackingNumber,
        estimatedDelivery: request.estimatedDelivery,
      },
    })

    await this.ctx.storage.put('order', order)

    this.$.send('Order.shipped', {
      orderId: order.id,
      escrowId: order.escrowId,
      buyer: order.buyer,
      seller: order.seller,
      tracking: order.tracking,
    })

    // Notify escrow that delivery has started
    this.$.send('Escrow.deliveryStarted', {
      escrowId: order.escrowId,
      orderId: order.id,
      tracking: order.tracking,
    })

    return order
  }

  /**
   * Update order status.
   */
  async updateStatus(status: OrderStatus, details?: Record<string, unknown>): Promise<Order> {
    const order = await this.getOrderOrThrow()
    const now = new Date().toISOString()

    const previousStatus = order.status
    order.status = status
    order.updatedAt = now

    const eventName = `Order.${status.replace('_', '')}`
    order.timeline.push({
      event: eventName,
      timestamp: now,
      details: { ...details, previousStatus },
    })

    await this.ctx.storage.put('order', order)

    this.$.send(eventName, {
      orderId: order.id,
      escrowId: order.escrowId,
      status,
      previousStatus,
      details,
    })

    return order
  }

  /**
   * Confirm delivery with proof.
   */
  async confirmDelivery(confirmation: DeliveryConfirmation): Promise<Order> {
    const order = await this.getOrderOrThrow()
    const now = new Date().toISOString()

    order.status = 'delivered'
    order.deliveredAt = confirmation.deliveredAt
    order.signedBy = confirmation.signedBy
    order.proofOfDelivery = confirmation.proofOfDelivery
    order.updatedAt = now

    order.timeline.push({
      event: 'Order.delivered',
      timestamp: now,
      details: {
        deliveredAt: confirmation.deliveredAt,
        signedBy: confirmation.signedBy,
        hasProofOfDelivery: !!confirmation.proofOfDelivery,
      },
    })

    await this.ctx.storage.put('order', order)

    this.$.send('Order.delivered', {
      orderId: order.id,
      escrowId: order.escrowId,
      buyer: order.buyer,
      seller: order.seller,
      deliveredAt: confirmation.deliveredAt,
      signedBy: confirmation.signedBy,
    })

    // Notify escrow that delivery is confirmed
    this.$.send('Escrow.deliveryConfirmed', {
      escrowId: order.escrowId,
      orderId: order.id,
      deliveredAt: confirmation.deliveredAt,
      signedBy: confirmation.signedBy,
    })

    return order
  }

  /**
   * Mark delivery as failed.
   */
  async markDeliveryFailed(reason: string): Promise<Order> {
    const order = await this.getOrderOrThrow()
    const now = new Date().toISOString()

    order.status = 'delivery_failed'
    order.updatedAt = now

    order.timeline.push({
      event: 'Order.deliveryFailed',
      timestamp: now,
      details: { reason },
    })

    await this.ctx.storage.put('order', order)

    this.$.send('Order.deliveryFailed', {
      orderId: order.id,
      escrowId: order.escrowId,
      buyer: order.buyer,
      seller: order.seller,
      reason,
    })

    return order
  }

  /**
   * Mark order as returned.
   */
  async markReturned(reason: string): Promise<Order> {
    const order = await this.getOrderOrThrow()
    const now = new Date().toISOString()

    order.status = 'returned'
    order.updatedAt = now

    order.timeline.push({
      event: 'Order.returned',
      timestamp: now,
      details: { reason },
    })

    await this.ctx.storage.put('order', order)

    this.$.send('Order.returned', {
      orderId: order.id,
      escrowId: order.escrowId,
      buyer: order.buyer,
      seller: order.seller,
      reason,
    })

    return order
  }

  // ==========================================================================
  // QUERY METHODS
  // ==========================================================================

  /**
   * Get order details.
   */
  async getOrder(): Promise<Order | null> {
    return (await this.ctx.storage.get<Order>('order')) ?? null
  }

  /**
   * Get order or throw if not found.
   */
  private async getOrderOrThrow(): Promise<Order> {
    const order = await this.getOrder()
    if (!order) {
      throw new OrderError('Order not found', 'NOT_FOUND')
    }
    return order
  }

  /**
   * Get tracking information.
   */
  async getTracking(): Promise<{
    tracking: TrackingInfo | null
    status: OrderStatus
    estimatedDelivery?: string
    deliveredAt?: string
  } | null> {
    const order = await this.getOrder()
    if (!order) return null

    return {
      tracking: order.tracking ?? null,
      status: order.status,
      estimatedDelivery: order.tracking?.estimatedDelivery,
      deliveredAt: order.deliveredAt,
    }
  }

  /**
   * Get order timeline.
   */
  async getTimeline(): Promise<TimelineEvent[]> {
    const order = await this.getOrder()
    return order?.timeline ?? []
  }

  /**
   * Check if order is delivered.
   */
  async isDelivered(): Promise<boolean> {
    const order = await this.getOrder()
    return order?.status === 'delivered'
  }
}
