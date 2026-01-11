/**
 * Shipping Durable Object - Shipment Management Service
 *
 * The Shipping DO handles shipment lifecycle:
 * - Creating shipments when orders are ready
 * - Tracking shipment status through dispatch/transit/delivery
 * - Handling shipment cancellations
 * - Scheduling delivery notifications
 *
 * In production, this would integrate with carriers (FedEx, UPS, USPS, etc.)
 */

import { DO } from 'dotdo'
import type {
  Address,
  ShipmentCreatedEvent,
  ShipmentDispatchedEvent,
  ShipmentInTransitEvent,
  ShipmentDeliveredEvent,
  ShipmentCancelledEvent,
} from '../events/types'

// ============================================================================
// TYPES
// ============================================================================

interface Shipment {
  id: string
  orderId: string
  customerId: string
  carrier: string
  trackingNumber: string
  address: Address
  items: Array<{ sku: string; quantity: number }>
  status: 'created' | 'dispatched' | 'in_transit' | 'delivered' | 'cancelled'
  estimatedDelivery?: string
  actualDelivery?: string
  createdAt: string
  dispatchedAt?: string
  deliveredAt?: string
  cancelledAt?: string
  cancelReason?: string
  trackingHistory: Array<{
    status: string
    location: string
    timestamp: string
  }>
}

interface ShippingState {
  shipments: Record<string, Shipment> // keyed by orderId
}

// ============================================================================
// SHIPPING DURABLE OBJECT
// ============================================================================

export class ShippingDO extends DO {
  static readonly $type = 'ShippingDO'

  /**
   * Initialize event handlers.
   */
  async onStart() {
    // ========================================================================
    // SHIPMENT CREATION HANDLER
    // ========================================================================

    /**
     * Shipment.create - Create a new shipment for an order.
     */
    this.$.on.Shipment.create(async (event) => {
      const request = event.data as {
        orderId: string
        customerId: string
        address: Address
        items: Array<{ sku: string; quantity: number }>
      }

      console.log(`[Shipping] Creating shipment for order ${request.orderId}`)

      const state = await this.getState()

      // Check for existing shipment (idempotency)
      const existing = state.shipments[request.orderId]
      if (existing && existing.status !== 'cancelled') {
        console.log(`[Shipping] Shipment already exists for order ${request.orderId}`)

        // Re-emit the appropriate event based on current status
        this.emitStatusEvent(existing)
        return
      }

      // Select carrier (simulated)
      const carrier = this.selectCarrier(request.address)

      // Generate tracking number
      const trackingNumber = this.generateTrackingNumber(carrier)

      const now = new Date().toISOString()
      const shipmentId = `ship_${crypto.randomUUID().slice(0, 8)}`

      const shipment: Shipment = {
        id: shipmentId,
        orderId: request.orderId,
        customerId: request.customerId,
        carrier,
        trackingNumber,
        address: request.address,
        items: request.items,
        status: 'created',
        createdAt: now,
        trackingHistory: [
          {
            status: 'Label created',
            location: 'Origin facility',
            timestamp: now,
          },
        ],
      }

      state.shipments[request.orderId] = shipment
      await this.set('state', state)

      console.log(`[Shipping] Shipment ${shipmentId} created with tracking ${trackingNumber}`)

      this.$.send('Shipment.created', {
        orderId: request.orderId,
        shipmentId,
        carrier,
        trackingNumber,
        address: request.address,
        items: request.items,
        createdAt: now,
      } as ShipmentCreatedEvent)

      // Auto-dispatch after a short delay (simulating warehouse processing)
      this.$.every('5 seconds').once(async () => {
        await this.dispatchShipment(request.orderId)
      })
    })

    // ========================================================================
    // SHIPMENT CANCELLATION HANDLER
    // ========================================================================

    /**
     * Shipment.cancel - Cancel a shipment.
     */
    this.$.on.Shipment.cancel(async (event) => {
      const request = event.data as {
        orderId: string
        shipmentId: string
        reason: string
      }

      console.log(`[Shipping] Cancel request for order ${request.orderId}: ${request.reason}`)

      const state = await this.getState()
      const shipment = state.shipments[request.orderId]

      if (!shipment) {
        console.log(`[Shipping] No shipment found for order ${request.orderId}`)
        return
      }

      if (shipment.status === 'delivered') {
        console.log(`[Shipping] Cannot cancel delivered shipment for order ${request.orderId}`)
        return
      }

      if (shipment.status === 'cancelled') {
        console.log(`[Shipping] Shipment already cancelled for order ${request.orderId}`)
        return
      }

      const now = new Date().toISOString()

      shipment.status = 'cancelled'
      shipment.cancelledAt = now
      shipment.cancelReason = request.reason
      shipment.trackingHistory.push({
        status: 'Shipment cancelled',
        location: 'N/A',
        timestamp: now,
      })

      await this.set('state', state)

      console.log(`[Shipping] Shipment cancelled for order ${request.orderId}`)

      this.$.send('Shipment.cancelled', {
        orderId: request.orderId,
        shipmentId: shipment.id,
        reason: request.reason,
        cancelledAt: now,
      } as ShipmentCancelledEvent)
    })

    console.log('[ShippingDO] Event handlers registered')
  }

  // ==========================================================================
  // SHIPMENT LIFECYCLE
  // ==========================================================================

  /**
   * Dispatch a shipment (called automatically after creation).
   */
  private async dispatchShipment(orderId: string): Promise<void> {
    const state = await this.getState()
    const shipment = state.shipments[orderId]

    if (!shipment || shipment.status !== 'created') return

    const now = new Date().toISOString()

    // Calculate estimated delivery (3-5 days)
    const deliveryDays = 3 + Math.floor(Math.random() * 3)
    const estimatedDelivery = new Date(Date.now() + deliveryDays * 24 * 60 * 60 * 1000).toISOString()

    shipment.status = 'dispatched'
    shipment.dispatchedAt = now
    shipment.estimatedDelivery = estimatedDelivery
    shipment.trackingHistory.push({
      status: 'Picked up by carrier',
      location: 'Origin facility',
      timestamp: now,
    })

    await this.set('state', state)

    console.log(`[Shipping] Shipment dispatched for order ${orderId}`)

    this.$.send('Shipment.dispatched', {
      orderId,
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      carrier: shipment.carrier,
      estimatedDelivery,
      dispatchedAt: now,
    } as ShipmentDispatchedEvent)

    // Notify customer
    this.$.send('Customer.notified', {
      customerId: shipment.customerId,
      orderId,
      type: 'shipped',
      message: `Your order has shipped! Track with ${shipment.carrier}: ${shipment.trackingNumber}`,
      data: {
        carrier: shipment.carrier,
        trackingNumber: shipment.trackingNumber,
        estimatedDelivery,
        trackingUrl: this.getTrackingUrl(shipment.carrier, shipment.trackingNumber),
      },
      sentAt: now,
    })

    // Schedule transit update (simulated)
    this.$.every('10 seconds').once(async () => {
      await this.updateToInTransit(orderId)
    })
  }

  /**
   * Update shipment to in-transit status.
   */
  private async updateToInTransit(orderId: string): Promise<void> {
    const state = await this.getState()
    const shipment = state.shipments[orderId]

    if (!shipment || shipment.status !== 'dispatched') return

    const now = new Date().toISOString()
    const locations = [
      'Regional sorting facility',
      'Distribution center',
      'Local delivery hub',
    ]
    const location = locations[Math.floor(Math.random() * locations.length)]

    shipment.status = 'in_transit'
    shipment.trackingHistory.push({
      status: 'In transit',
      location,
      timestamp: now,
    })

    await this.set('state', state)

    console.log(`[Shipping] Shipment in transit for order ${orderId}`)

    this.$.send('Shipment.inTransit', {
      orderId,
      shipmentId: shipment.id,
      location,
      timestamp: now,
    } as ShipmentInTransitEvent)

    // Schedule delivery (simulated)
    this.$.every('15 seconds').once(async () => {
      await this.markDelivered(orderId)
    })
  }

  /**
   * Mark shipment as delivered.
   */
  private async markDelivered(orderId: string): Promise<void> {
    const state = await this.getState()
    const shipment = state.shipments[orderId]

    if (!shipment || shipment.status === 'delivered' || shipment.status === 'cancelled') return

    const now = new Date().toISOString()

    shipment.status = 'delivered'
    shipment.deliveredAt = now
    shipment.actualDelivery = now
    shipment.trackingHistory.push({
      status: 'Delivered',
      location: `${shipment.address.city}, ${shipment.address.state}`,
      timestamp: now,
    })

    await this.set('state', state)

    console.log(`[Shipping] Shipment delivered for order ${orderId}`)

    this.$.send('Shipment.delivered', {
      orderId,
      shipmentId: shipment.id,
      deliveredAt: now,
    } as ShipmentDeliveredEvent)
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  /**
   * Select carrier based on address (simulated).
   */
  private selectCarrier(address: Address): string {
    // In production, this would consider factors like:
    // - Shipping zone
    // - Package dimensions
    // - Delivery speed requirements
    // - Cost optimization

    const carriers = ['FastShip', 'QuickPost', 'ExpressLine', 'SpeedyDeliver']
    return carriers[Math.floor(Math.random() * carriers.length)]
  }

  /**
   * Generate tracking number for carrier.
   */
  private generateTrackingNumber(carrier: string): string {
    const prefix = carrier.slice(0, 2).toUpperCase()
    const timestamp = Date.now().toString(36).toUpperCase()
    const random = crypto.randomUUID().slice(0, 8).toUpperCase()
    return `${prefix}${timestamp}${random}`
  }

  /**
   * Get carrier tracking URL.
   */
  private getTrackingUrl(carrier: string, trackingNumber: string): string {
    // In production, this would return real carrier URLs
    return `https://track.example.com/${carrier.toLowerCase()}/${trackingNumber}`
  }

  /**
   * Emit appropriate status event for a shipment.
   */
  private emitStatusEvent(shipment: Shipment): void {
    switch (shipment.status) {
      case 'created':
        this.$.send('Shipment.created', {
          orderId: shipment.orderId,
          shipmentId: shipment.id,
          carrier: shipment.carrier,
          trackingNumber: shipment.trackingNumber,
          address: shipment.address,
          items: shipment.items,
          createdAt: shipment.createdAt,
        } as ShipmentCreatedEvent)
        break
      case 'dispatched':
        this.$.send('Shipment.dispatched', {
          orderId: shipment.orderId,
          shipmentId: shipment.id,
          trackingNumber: shipment.trackingNumber,
          carrier: shipment.carrier,
          estimatedDelivery: shipment.estimatedDelivery!,
          dispatchedAt: shipment.dispatchedAt!,
        } as ShipmentDispatchedEvent)
        break
      case 'delivered':
        this.$.send('Shipment.delivered', {
          orderId: shipment.orderId,
          shipmentId: shipment.id,
          deliveredAt: shipment.deliveredAt!,
        } as ShipmentDeliveredEvent)
        break
    }
  }

  // ==========================================================================
  // STATE MANAGEMENT
  // ==========================================================================

  /**
   * Get shipping state.
   */
  private async getState(): Promise<ShippingState> {
    const state = await this.get<ShippingState>('state')
    return state ?? { shipments: {} }
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  /**
   * Get shipment for an order.
   */
  async getShipment(orderId: string): Promise<Shipment | null> {
    const state = await this.getState()
    return state.shipments[orderId] ?? null
  }

  /**
   * Get all shipments.
   */
  async getAllShipments(): Promise<Shipment[]> {
    const state = await this.getState()
    return Object.values(state.shipments)
  }

  /**
   * Get shipment by tracking number.
   */
  async getShipmentByTracking(trackingNumber: string): Promise<Shipment | null> {
    const state = await this.getState()
    return (
      Object.values(state.shipments).find((s) => s.trackingNumber === trackingNumber) ?? null
    )
  }

  /**
   * Manually trigger delivery (for testing).
   */
  async simulateDelivery(orderId: string): Promise<void> {
    await this.markDelivered(orderId)
  }
}
