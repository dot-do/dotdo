/**
 * Inventory Durable Object - Stock Management Service
 *
 * The Inventory DO handles all inventory-related events:
 * - Checking stock availability
 * - Reserving inventory for orders
 * - Releasing inventory on cancellation/failure
 * - Deducting stock on shipment
 *
 * Demonstrates compensation patterns: if payment fails after inventory
 * is reserved, the inventory is automatically released.
 */

import { DO } from 'dotdo'
import type {
  InventoryReserveRequestedEvent,
  InventoryReservedEvent,
  InventoryReservationFailedEvent,
  InventoryReleasedEvent,
  InventoryDeductedEvent,
} from '../events/types'

// ============================================================================
// TYPES
// ============================================================================

interface StockItem {
  sku: string
  name: string
  available: number
  reserved: number
  lowStockThreshold: number
}

interface Reservation {
  id: string
  orderId: string
  items: Array<{ sku: string; quantity: number }>
  expiresAt: string
  createdAt: string
  status: 'active' | 'fulfilled' | 'released' | 'expired'
}

interface InventoryIndex {
  stock: Record<string, StockItem>
  reservations: Record<string, Reservation> // keyed by orderId
}

// ============================================================================
// INVENTORY DURABLE OBJECT
// ============================================================================

export class InventoryDO extends DO {
  static readonly $type = 'InventoryDO'

  /**
   * Initialize event handlers on startup.
   */
  async onStart() {
    // Initialize demo stock if not exists
    await this.initializeDemoStock()

    // ========================================================================
    // RESERVATION REQUEST HANDLER
    // ========================================================================

    /**
     * Inventory.reserveRequested - Check and reserve inventory for an order.
     *
     * This is triggered when an order is placed. We check if all items
     * are available and create a reservation that holds the stock.
     */
    this.$.on.Inventory.reserveRequested(async (event) => {
      const request = event.data as InventoryReserveRequestedEvent

      console.log(`[Inventory] Reserve requested for order ${request.orderId}`)

      const index = await this.getIndex()
      const failedItems: Array<{ sku: string; requested: number; available: number }> = []

      // Check availability for all items
      for (const item of request.items) {
        const stock = index.stock[item.sku]
        const effectiveAvailable = stock ? stock.available - stock.reserved : 0

        if (!stock || effectiveAvailable < item.quantity) {
          failedItems.push({
            sku: item.sku,
            requested: item.quantity,
            available: effectiveAvailable,
          })
        }
      }

      // If any items are unavailable, emit failure event
      if (failedItems.length > 0) {
        console.log(`[Inventory] Reservation failed for order ${request.orderId}: insufficient stock`)

        this.$.send('Inventory.reservationFailed', {
          orderId: request.orderId,
          failedItems,
          failedAt: new Date().toISOString(),
        } as InventoryReservationFailedEvent)

        return
      }

      // Create reservation
      const reservationId = `res_${crypto.randomUUID().slice(0, 8)}`
      const now = new Date().toISOString()

      const reservation: Reservation = {
        id: reservationId,
        orderId: request.orderId,
        items: request.items,
        expiresAt: request.reservationExpiry,
        createdAt: now,
        status: 'active',
      }

      // Reserve the stock
      for (const item of request.items) {
        const stock = index.stock[item.sku]
        if (stock) {
          stock.reserved += item.quantity
        }
      }

      // Save reservation
      index.reservations[request.orderId] = reservation
      await this.saveIndex(index)

      console.log(`[Inventory] Reservation ${reservationId} created for order ${request.orderId}`)

      // Emit success event
      this.$.send('Inventory.reserved', {
        orderId: request.orderId,
        reservationId,
        items: request.items,
        reservedAt: now,
      } as InventoryReservedEvent)

      // Check for low stock alerts
      await this.checkLowStock(request.items.map((i) => i.sku))
    })

    // ========================================================================
    // RELEASE HANDLER (Compensation)
    // ========================================================================

    /**
     * Inventory.release - Release reserved inventory.
     *
     * This is triggered when:
     * - Payment fails after inventory was reserved
     * - Order is cancelled
     * - Reservation expires
     *
     * This is a compensation action that undoes the reservation.
     */
    this.$.on.Inventory.release(async (event) => {
      const request = event.data as {
        orderId: string
        reservationId?: string
        items: Array<{ sku: string; quantity: number }>
        reason: 'ORDER_CANCELLED' | 'PAYMENT_FAILED' | 'EXPIRED' | 'MANUAL'
        releasedAt: string
      }

      console.log(`[Inventory] Releasing stock for order ${request.orderId}: ${request.reason}`)

      const index = await this.getIndex()
      const reservation = index.reservations[request.orderId]

      if (!reservation) {
        console.log(`[Inventory] No reservation found for order ${request.orderId}`)
        return
      }

      if (reservation.status !== 'active') {
        console.log(`[Inventory] Reservation already ${reservation.status} for order ${request.orderId}`)
        return
      }

      // Release the reserved stock
      for (const item of reservation.items) {
        const stock = index.stock[item.sku]
        if (stock) {
          stock.reserved = Math.max(0, stock.reserved - item.quantity)
        }
      }

      // Update reservation status
      reservation.status = 'released'
      await this.saveIndex(index)

      console.log(`[Inventory] Stock released for order ${request.orderId}`)

      // Emit release confirmation
      this.$.send('Inventory.released', {
        orderId: request.orderId,
        reservationId: reservation.id,
        items: reservation.items,
        reason: request.reason,
        releasedAt: new Date().toISOString(),
      } as InventoryReleasedEvent)
    })

    // ========================================================================
    // DEDUCTION HANDLER (Fulfillment)
    // ========================================================================

    /**
     * Shipment.created - Deduct inventory when shipment is created.
     *
     * This converts a reservation into actual stock deduction.
     * After this, the stock is permanently reduced.
     */
    this.$.on.Shipment.created(async (event) => {
      const { orderId, items } = event.data as {
        orderId: string
        items: Array<{ sku: string; quantity: number }>
      }

      console.log(`[Inventory] Deducting stock for shipped order ${orderId}`)

      const index = await this.getIndex()
      const reservation = index.reservations[orderId]

      if (!reservation || reservation.status !== 'active') {
        console.log(`[Inventory] No active reservation for order ${orderId}`)
        return
      }

      // Deduct from both available and reserved
      for (const item of items) {
        const stock = index.stock[item.sku]
        if (stock) {
          stock.available -= item.quantity
          stock.reserved -= item.quantity
        }
      }

      // Mark reservation as fulfilled
      reservation.status = 'fulfilled'
      await this.saveIndex(index)

      console.log(`[Inventory] Stock deducted for order ${orderId}`)

      // Emit deduction event
      this.$.send('Inventory.deducted', {
        orderId,
        items,
        deductedAt: new Date().toISOString(),
      } as InventoryDeductedEvent)
    })

    console.log('[InventoryDO] Event handlers registered')
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  /**
   * Initialize demo stock for testing.
   */
  private async initializeDemoStock(): Promise<void> {
    const index = await this.getIndex()

    if (Object.keys(index.stock).length === 0) {
      index.stock = {
        'WIDGET-001': {
          sku: 'WIDGET-001',
          name: 'Premium Widget',
          available: 100,
          reserved: 0,
          lowStockThreshold: 10,
        },
        'GADGET-002': {
          sku: 'GADGET-002',
          name: 'Super Gadget',
          available: 50,
          reserved: 0,
          lowStockThreshold: 5,
        },
        'GIZMO-003': {
          sku: 'GIZMO-003',
          name: 'Ultra Gizmo',
          available: 25,
          reserved: 0,
          lowStockThreshold: 3,
        },
      }
      await this.saveIndex(index)
      console.log('[InventoryDO] Demo stock initialized')
    }
  }

  /**
   * Check for low stock and emit alerts.
   */
  private async checkLowStock(skus: string[]): Promise<void> {
    const index = await this.getIndex()

    for (const sku of skus) {
      const stock = index.stock[sku]
      if (stock) {
        const effectiveAvailable = stock.available - stock.reserved
        if (effectiveAvailable <= stock.lowStockThreshold) {
          console.log(`[Inventory] Low stock alert: ${sku} has ${effectiveAvailable} available`)

          // Emit low stock event for monitoring/alerting
          this.$.send('Inventory.lowStock', {
            sku,
            available: effectiveAvailable,
            threshold: stock.lowStockThreshold,
            alertedAt: new Date().toISOString(),
          })
        }
      }
    }
  }

  /**
   * Get the inventory index.
   */
  private async getIndex(): Promise<InventoryIndex> {
    const index = await this.get<InventoryIndex>('index')
    return index ?? { stock: {}, reservations: {} }
  }

  /**
   * Save the inventory index.
   */
  private async saveIndex(index: InventoryIndex): Promise<void> {
    await this.set('index', index)
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  /**
   * Get current stock levels for an SKU.
   */
  async getStock(sku: string): Promise<StockItem | null> {
    const index = await this.getIndex()
    return index.stock[sku] ?? null
  }

  /**
   * Get all stock levels.
   */
  async getAllStock(): Promise<StockItem[]> {
    const index = await this.getIndex()
    return Object.values(index.stock)
  }

  /**
   * Get reservation for an order.
   */
  async getReservation(orderId: string): Promise<Reservation | null> {
    const index = await this.getIndex()
    return index.reservations[orderId] ?? null
  }

  /**
   * Add stock (for restocking).
   */
  async addStock(sku: string, quantity: number): Promise<void> {
    const index = await this.getIndex()
    if (index.stock[sku]) {
      index.stock[sku].available += quantity
      await this.saveIndex(index)
      console.log(`[Inventory] Added ${quantity} units to ${sku}`)
    }
  }
}
