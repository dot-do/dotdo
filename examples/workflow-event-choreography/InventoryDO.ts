// Inventory Durable Object
// Handles: Stock management, reservations, releases
// Reacts to: Inventory.reserveRequested, Inventory.release, Shipment.dispatched

import { Hono } from 'hono'
import { DO, type DOEnv, createContext } from '@dotdo/do'
import type { InventoryItem, Reservation, ReservationItem } from './types'

// Initial stock levels
const INITIAL_STOCK: Record<string, { name: string; available: number }> = {
  'WIDGET-001': { name: 'Premium Widget', available: 100 },
  'GADGET-002': { name: 'Super Gadget', available: 50 },
  'THING-003': { name: 'Useful Thing', available: 25 },
  'RARE-ITEM': { name: 'Rare Collector Item', available: 2 },
  'OUT-OF-STOCK': { name: 'Unavailable Item', available: 0 },
}

export class InventoryDO extends DO {
  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env)
    this.$ = createContext(state, env)

    // Initialize stock on first request
    this.initializeStock()

    // React to reservation requests
    this.$.on.Inventory.reserveRequested(async (event) => {
      const { orderId, items } = (event as { type: string; payload: { orderId: string; items: ReservationItem[] } }).payload
      console.log(`[Inventory] Reserve request for order ${orderId}`)

      // Check availability
      for (const item of items) {
        const stock = await this.getStock(item.sku)
        if (!stock || stock.available < item.quantity) {
          console.log(`[Inventory] Insufficient stock for ${item.sku}`)
          this.$.send({
            type: 'Inventory.reservationFailed',
            payload: { orderId, reason: `Insufficient stock for ${item.sku}` },
          })
          return
        }
      }

      // Reserve items
      for (const item of items) {
        await this.reserveStock(item.sku, item.quantity)
      }

      // Create reservation record
      const reservation = await this.things.create({
        $type: 'Reservation',
        orderId,
        items,
        status: 'confirmed',
        createdAt: new Date().toISOString(),
      })

      console.log(`[Inventory] Reservation ${reservation.$id} created for order ${orderId}`)

      this.$.send({
        type: 'Inventory.reserved',
        payload: { orderId, reservationId: reservation.$id },
      })
    })

    // React to release requests (compensation)
    this.$.on.Inventory.release(async (event) => {
      const { orderId, reason } = (event as { type: string; payload: { orderId: string; reason: string } }).payload
      console.log(`[Inventory] Release request for order ${orderId}: ${reason}`)

      const reservations = await this.things.list({ type: 'Reservation' })
      const reservation = reservations.find((r) => (r as unknown as Reservation).orderId === orderId)

      if (!reservation) {
        console.log(`[Inventory] No reservation found for order ${orderId}`)
        return
      }

      const res = reservation as unknown as Reservation

      // Release reserved stock
      for (const item of res.items) {
        await this.releaseStock(item.sku, item.quantity)
      }

      await this.things.update(reservation.$id, { status: 'released' })

      console.log(`[Inventory] Released reservation for order ${orderId}`)

      this.$.send({
        type: 'Inventory.released',
        payload: { orderId, reservationId: reservation.$id },
      })
    })

    // React to shipment dispatched - deduct from available
    this.$.on.Shipment.dispatched(async (event) => {
      const { orderId } = (event as { type: string; payload: { orderId: string } }).payload
      console.log(`[Inventory] Deducting inventory for shipped order ${orderId}`)

      const reservations = await this.things.list({ type: 'Reservation' })
      const reservation = reservations.find((r) => (r as unknown as Reservation).orderId === orderId)

      if (!reservation) return

      const res = reservation as unknown as Reservation

      // Deduct from reserved (convert to sold)
      for (const item of res.items) {
        await this.deductStock(item.sku, item.quantity)
      }

      await this.things.update(reservation.$id, { status: 'deducted' })

      this.$.send({
        type: 'Inventory.deducted',
        payload: { orderId, reservationId: reservation.$id },
      })
    })
  }

  private async initializeStock(): Promise<void> {
    const existing = await this.things.list({ type: 'InventoryItem' })
    if (existing.length > 0) return

    for (const [sku, data] of Object.entries(INITIAL_STOCK)) {
      await this.things.create({
        $type: 'InventoryItem',
        sku,
        name: data.name,
        available: data.available,
        reserved: 0,
      })
    }
  }

  private async getStock(sku: string): Promise<InventoryItem | null> {
    const items = await this.things.list({ type: 'InventoryItem' })
    const item = items.find((i) => (i as unknown as InventoryItem).sku === sku)
    return item ? (item as unknown as InventoryItem) : null
  }

  private async reserveStock(sku: string, quantity: number): Promise<void> {
    const items = await this.things.list({ type: 'InventoryItem' })
    const item = items.find((i) => (i as unknown as InventoryItem).sku === sku)
    if (!item) return

    const inv = item as unknown as InventoryItem
    await this.things.update(item.$id, {
      available: inv.available - quantity,
      reserved: inv.reserved + quantity,
    })
  }

  private async releaseStock(sku: string, quantity: number): Promise<void> {
    const items = await this.things.list({ type: 'InventoryItem' })
    const item = items.find((i) => (i as unknown as InventoryItem).sku === sku)
    if (!item) return

    const inv = item as unknown as InventoryItem
    await this.things.update(item.$id, {
      available: inv.available + quantity,
      reserved: Math.max(0, inv.reserved - quantity),
    })
  }

  private async deductStock(sku: string, quantity: number): Promise<void> {
    const items = await this.things.list({ type: 'InventoryItem' })
    const item = items.find((i) => (i as unknown as InventoryItem).sku === sku)
    if (!item) return

    const inv = item as unknown as InventoryItem
    await this.things.update(item.$id, {
      reserved: Math.max(0, inv.reserved - quantity),
    })
  }

  protected routes(app: Hono): void {
    // Get all stock levels
    app.get('/inventory', async (c) => {
      const items = await this.things.list({ type: 'InventoryItem' })
      return c.json(items)
    })

    // Get stock for SKU
    app.get('/inventory/:sku', async (c) => {
      const stock = await this.getStock(c.req.param('sku'))
      if (!stock) {
        return c.json({ error: 'SKU not found' }, 404)
      }
      return c.json(stock)
    })

    // Add stock (admin)
    app.post('/inventory/:sku/add', async (c) => {
      const sku = c.req.param('sku')
      const { quantity } = await c.req.json<{ quantity: number }>()

      const items = await this.things.list({ type: 'InventoryItem' })
      const item = items.find((i) => (i as unknown as InventoryItem).sku === sku)

      if (!item) {
        return c.json({ error: 'SKU not found' }, 404)
      }

      const inv = item as unknown as InventoryItem
      const updated = await this.things.update(item.$id, {
        available: inv.available + quantity,
      })

      return c.json(updated)
    })
  }
}
