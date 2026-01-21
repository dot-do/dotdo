// Shipping Durable Object
// Handles: Shipment creation, dispatch simulation, delivery tracking
// Reacts to: Shipment.create, Shipment.cancel

import { Hono } from 'hono'
import { DO, type DOEnv, createContext } from '@dotdo/do'
import type { Shipment, ShipmentStatus, ShippingAddress, OrderItem } from './types'

export class ShippingDO extends DO {
  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env)
    this.$ = createContext(state, env)

    // React to shipment create requests
    this.$.on.Shipment.create(async (event) => {
      const { orderId, address, items } = (event as { type: string; payload: { orderId: string; address: ShippingAddress; items: OrderItem[] } }).payload
      console.log(`[Shipping] Creating shipment for order ${orderId}`)

      // Generate tracking number
      const trackingNumber = `FS${Date.now().toString(36).toUpperCase()}`
      const carrier = 'FastShip'

      const shipment = await this.things.create({
        $type: 'Shipment',
        orderId,
        trackingNumber,
        carrier,
        status: 'created' as ShipmentStatus,
        address,
        estimatedDelivery: this.getEstimatedDelivery(),
        createdAt: new Date().toISOString(),
      })

      console.log(`[Shipping] Shipment ${shipment.$id} created with tracking ${trackingNumber}`)

      this.$.send({
        type: 'Shipment.created',
        payload: { orderId, shipmentId: shipment.$id, trackingNumber },
      })

      // Simulate auto-dispatch after a short delay (in production, this would be a warehouse process)
      // Using setTimeout for demo; in production, use $.at for durable scheduling
      setTimeout(async () => {
        await this.dispatchShipment(shipment.$id)
      }, 2000)
    })

    // React to cancellation requests
    this.$.on.Shipment.cancel(async (event) => {
      const { orderId, shipmentId } = (event as { type: string; payload: { orderId: string; shipmentId: string } }).payload
      console.log(`[Shipping] Cancelling shipment ${shipmentId} for order ${orderId}`)

      const shipment = await this.things.get(shipmentId)
      if (!shipment || shipment.$type !== 'Shipment') return

      const s = shipment as unknown as Shipment
      if (s.status === 'dispatched' || s.status === 'delivered') {
        console.log(`[Shipping] Cannot cancel shipment ${shipmentId} - already dispatched`)
        return
      }

      await this.things.update(shipmentId, { status: 'cancelled' })

      this.$.send({
        type: 'Shipment.cancelled',
        payload: { orderId, shipmentId },
      })
    })
  }

  private getEstimatedDelivery(): string {
    const date = new Date()
    date.setDate(date.getDate() + 3 + Math.floor(Math.random() * 4)) // 3-7 days
    return date.toISOString()
  }

  private async dispatchShipment(shipmentId: string): Promise<void> {
    const shipment = await this.things.get(shipmentId)
    if (!shipment || shipment.$type !== 'Shipment') return

    const s = shipment as unknown as Shipment
    if (s.status !== 'created') return

    await this.things.update(shipmentId, { status: 'dispatched' })

    console.log(`[Shipping] Shipment ${shipmentId} dispatched for order ${s.orderId}`)

    this.$.send({
      type: 'Shipment.dispatched',
      payload: { orderId: s.orderId, shipmentId },
    })
  }

  async simulateDelivery(orderId: string): Promise<void> {
    const shipments = await this.things.list({ type: 'Shipment' })
    const shipment = shipments.find((s) => (s as unknown as Shipment).orderId === orderId)

    if (!shipment) {
      console.log(`[Shipping] No shipment found for order ${orderId}`)
      return
    }

    await this.things.update(shipment.$id, {
      status: 'delivered',
      actualDelivery: new Date().toISOString(),
    })

    console.log(`[Shipping] Shipment ${shipment.$id} delivered for order ${orderId}`)

    this.$.send({
      type: 'Shipment.delivered',
      payload: { orderId, shipmentId: shipment.$id },
    })
  }

  protected routes(app: Hono): void {
    // Get shipment for order
    app.get('/shipping/:orderId', async (c) => {
      const orderId = c.req.param('orderId')
      const shipments = await this.things.list({ type: 'Shipment' })
      const shipment = shipments.find((s) => (s as unknown as Shipment).orderId === orderId)

      if (!shipment) {
        return c.json({ error: 'Shipment not found' }, 404)
      }
      return c.json(shipment)
    })

    // Track by tracking number
    app.get('/shipping/track/:trackingNumber', async (c) => {
      const trackingNumber = c.req.param('trackingNumber')
      const shipments = await this.things.list({ type: 'Shipment' })
      const shipment = shipments.find((s) => (s as unknown as Shipment).trackingNumber === trackingNumber)

      if (!shipment) {
        return c.json({ error: 'Tracking number not found' }, 404)
      }
      return c.json(shipment)
    })

    // Simulate delivery (testing)
    app.post('/shipping/:orderId/deliver', async (c) => {
      const orderId = c.req.param('orderId')
      await this.simulateDelivery(orderId)
      return c.json({ success: true, message: 'Delivery simulated' })
    })
  }
}
