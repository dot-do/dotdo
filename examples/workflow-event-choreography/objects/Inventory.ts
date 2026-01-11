/**
 * Inventory Durable Object - Stock Management Service
 *
 * The Inventory DO handles stock reservations and releases:
 * - Reserve inventory when orders are placed
 * - Release inventory on cancellation or payment failure
 * - Deduct inventory when shipped
 * - Automatic expiration of stale reservations
 *
 * Uses a reservation model: stock is reserved but not deducted until shipment.
 * This allows for graceful handling of payment failures and cancellations.
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

interface StockLevel {
  sku: string
  available: number // Available for new orders
  reserved: number // Reserved but not shipped
  shipped: number // Already shipped
  updatedAt: string
}

interface Reservation {
  id: string
  orderId: string
  items: Array<{ sku: string; quantity: number }>
  status: 'active' | 'released' | 'deducted'
  expiresAt: string
  createdAt: string
  releasedAt?: string
  deductedAt?: string
}

interface InventoryState {
  stock: Record<string, StockLevel>
  reservations: Record<string, Reservation> // keyed by orderId
}

// ============================================================================
// INVENTORY DURABLE OBJECT
// ============================================================================

export class InventoryDO extends DO {
  static readonly $type = 'InventoryDO'

  /**
   * Initialize event handlers and seed demo data.
   */
  async onStart() {
    // Seed demo inventory if empty
    await this.seedDemoInventory()

    // Schedule reservation expiration check
    this.$.every.hour(async () => {
      await this.cleanupExpiredReservations()
    })

    // ========================================================================
    // RESERVATION REQUEST HANDLER
    // ========================================================================

    /**
     * Inventory.reserveRequested - Try to reserve stock for an order.
     */
    this.$.on.Inventory.reserveRequested(async (event) => {
      const request = event.data as InventoryReserveRequestedEvent

      console.log(`[Inventory] Reserve request for order ${request.orderId}`)

      const state = await this.getState()

      // Check if reservation already exists (idempotency)
      const existingReservation = state.reservations[request.orderId]
      if (existingReservation && existingReservation.status === 'active') {
        console.log(`[Inventory] Reservation already exists for order ${request.orderId}`)

        // Re-emit the existing result
        this.$.send('Inventory.reserved', {
          orderId: request.orderId,
          reservationId: existingReservation.id,
          items: existingReservation.items,
          reservedAt: existingReservation.createdAt,
        } as InventoryReservedEvent)
        return
      }

      // Check availability for all items
      const failedItems: Array<{ sku: string; requested: number; available: number }> = []

      for (const item of request.items) {
        const stock = state.stock[item.sku]
        const available = stock?.available ?? 0

        if (available < item.quantity) {
          failedItems.push({
            sku: item.sku,
            requested: item.quantity,
            available,
          })
        }
      }

      if (failedItems.length > 0) {
        console.log(`[Inventory] Reservation failed for order ${request.orderId}: items unavailable`)

        this.$.send('Inventory.reservationFailed', {
          orderId: request.orderId,
          failedItems,
          failedAt: new Date().toISOString(),
        } as InventoryReservationFailedEvent)
        return
      }

      // All items available - create reservation
      const reservationId = `res_${crypto.randomUUID().slice(0, 8)}`
      const now = new Date().toISOString()

      // Deduct from available, add to reserved
      for (const item of request.items) {
        const stock = state.stock[item.sku]
        stock.available -= item.quantity
        stock.reserved += item.quantity
        stock.updatedAt = now
      }

      // Create reservation record
      const reservation: Reservation = {
        id: reservationId,
        orderId: request.orderId,
        items: request.items,
        status: 'active',
        expiresAt: request.reservationExpiry,
        createdAt: now,
      }

      state.reservations[request.orderId] = reservation

      await this.set('state', state)

      console.log(`[Inventory] Reservation ${reservationId} created for order ${request.orderId}`)

      this.$.send('Inventory.reserved', {
        orderId: request.orderId,
        reservationId,
        items: request.items,
        reservedAt: now,
      } as InventoryReservedEvent)
    })

    // ========================================================================
    // RELEASE HANDLER
    // ========================================================================

    /**
     * Inventory.release - Release reserved stock back to available.
     */
    this.$.on.Inventory.release(async (event) => {
      const request = event.data as InventoryReleasedEvent

      console.log(`[Inventory] Release request for order ${request.orderId}: ${request.reason}`)

      const state = await this.getState()
      const reservation = state.reservations[request.orderId]

      if (!reservation || reservation.status !== 'active') {
        console.log(`[Inventory] No active reservation for order ${request.orderId}`)
        return
      }

      const now = new Date().toISOString()

      // Release: move from reserved back to available
      for (const item of reservation.items) {
        const stock = state.stock[item.sku]
        if (stock) {
          stock.reserved -= item.quantity
          stock.available += item.quantity
          stock.updatedAt = now
        }
      }

      // Update reservation status
      reservation.status = 'released'
      reservation.releasedAt = now

      await this.set('state', state)

      console.log(`[Inventory] Reservation released for order ${request.orderId}`)

      this.$.send('Inventory.released', {
        orderId: request.orderId,
        reservationId: reservation.id,
        items: reservation.items,
        reason: request.reason,
        releasedAt: now,
      } as InventoryReleasedEvent)
    })

    // ========================================================================
    // DEDUCT HANDLER (when shipped)
    // ========================================================================

    /**
     * Shipment.dispatched - Deduct reserved inventory permanently.
     */
    this.$.on.Shipment.dispatched(async (event) => {
      const shipment = event.data as { orderId: string }

      console.log(`[Inventory] Deducting inventory for shipped order ${shipment.orderId}`)

      const state = await this.getState()
      const reservation = state.reservations[shipment.orderId]

      if (!reservation || reservation.status !== 'active') {
        console.log(`[Inventory] No active reservation for order ${shipment.orderId}`)
        return
      }

      const now = new Date().toISOString()

      // Deduct: move from reserved to shipped (permanent)
      for (const item of reservation.items) {
        const stock = state.stock[item.sku]
        if (stock) {
          stock.reserved -= item.quantity
          stock.shipped += item.quantity
          stock.updatedAt = now
        }
      }

      // Update reservation status
      reservation.status = 'deducted'
      reservation.deductedAt = now

      await this.set('state', state)

      console.log(`[Inventory] Inventory deducted for order ${shipment.orderId}`)

      this.$.send('Inventory.deducted', {
        orderId: shipment.orderId,
        items: reservation.items,
        deductedAt: now,
      } as InventoryDeductedEvent)
    })

    console.log('[InventoryDO] Event handlers registered')
  }

  // ==========================================================================
  // RESERVATION MANAGEMENT
  // ==========================================================================

  /**
   * Clean up expired reservations.
   * Returns items to available stock.
   */
  private async cleanupExpiredReservations(): Promise<void> {
    const state = await this.getState()
    const now = new Date()
    let expiredCount = 0

    for (const [orderId, reservation] of Object.entries(state.reservations)) {
      if (reservation.status !== 'active') continue

      const expiresAt = new Date(reservation.expiresAt)
      if (expiresAt <= now) {
        console.log(`[Inventory] Reservation expired for order ${orderId}`)

        // Release items back to available
        for (const item of reservation.items) {
          const stock = state.stock[item.sku]
          if (stock) {
            stock.reserved -= item.quantity
            stock.available += item.quantity
            stock.updatedAt = now.toISOString()
          }
        }

        reservation.status = 'released'
        reservation.releasedAt = now.toISOString()
        expiredCount++

        // Emit release event
        this.$.send('Inventory.released', {
          orderId,
          reservationId: reservation.id,
          items: reservation.items,
          reason: 'EXPIRED',
          releasedAt: now.toISOString(),
        } as InventoryReleasedEvent)
      }
    }

    if (expiredCount > 0) {
      await this.set('state', state)
      console.log(`[Inventory] Cleaned up ${expiredCount} expired reservations`)
    }
  }

  // ==========================================================================
  // STATE MANAGEMENT
  // ==========================================================================

  /**
   * Get inventory state.
   */
  private async getState(): Promise<InventoryState> {
    const state = await this.get<InventoryState>('state')
    return state ?? { stock: {}, reservations: {} }
  }

  /**
   * Seed demo inventory with sample products.
   */
  private async seedDemoInventory(): Promise<void> {
    const state = await this.getState()

    if (Object.keys(state.stock).length > 0) return

    const now = new Date().toISOString()

    state.stock = {
      'WIDGET-001': {
        sku: 'WIDGET-001',
        available: 100,
        reserved: 0,
        shipped: 0,
        updatedAt: now,
      },
      'GADGET-002': {
        sku: 'GADGET-002',
        available: 50,
        reserved: 0,
        shipped: 0,
        updatedAt: now,
      },
      'THING-003': {
        sku: 'THING-003',
        available: 25,
        reserved: 0,
        shipped: 0,
        updatedAt: now,
      },
      'RARE-ITEM': {
        sku: 'RARE-ITEM',
        available: 2, // Low stock for testing
        reserved: 0,
        shipped: 0,
        updatedAt: now,
      },
      'OUT-OF-STOCK': {
        sku: 'OUT-OF-STOCK',
        available: 0, // For testing failures
        reserved: 0,
        shipped: 0,
        updatedAt: now,
      },
    }

    await this.set('state', state)
    console.log('[Inventory] Demo inventory seeded')
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  /**
   * Get current stock levels.
   */
  async getStockLevels(): Promise<Record<string, StockLevel>> {
    const state = await this.getState()
    return state.stock
  }

  /**
   * Get stock for a specific SKU.
   */
  async getStock(sku: string): Promise<StockLevel | null> {
    const state = await this.getState()
    return state.stock[sku] ?? null
  }

  /**
   * Get reservation for an order.
   */
  async getReservation(orderId: string): Promise<Reservation | null> {
    const state = await this.getState()
    return state.reservations[orderId] ?? null
  }

  /**
   * Get all active reservations.
   */
  async getActiveReservations(): Promise<Reservation[]> {
    const state = await this.getState()
    return Object.values(state.reservations).filter((r) => r.status === 'active')
  }

  /**
   * Manually add stock (for admin/testing).
   */
  async addStock(sku: string, quantity: number): Promise<StockLevel> {
    const state = await this.getState()
    const now = new Date().toISOString()

    if (!state.stock[sku]) {
      state.stock[sku] = {
        sku,
        available: 0,
        reserved: 0,
        shipped: 0,
        updatedAt: now,
      }
    }

    state.stock[sku].available += quantity
    state.stock[sku].updatedAt = now

    await this.set('state', state)
    return state.stock[sku]
  }
}
