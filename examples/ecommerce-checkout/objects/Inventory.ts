/**
 * InventoryDO - Inventory Management Durable Object
 *
 * Manages product inventory levels and reservations.
 * Single instance manages all inventory (keyed by 'inventory').
 *
 * Responsibilities:
 * - Track stock levels per SKU
 * - Reserve inventory for orders
 * - Release reservations on cancellation
 * - Prevent overselling
 *
 * Events Emitted:
 * - Inventory.reserved - When inventory is successfully reserved
 * - Inventory.released - When reservation is released
 * - Inventory.insufficient - When stock is insufficient
 * - Inventory.lowStock - When stock falls below threshold
 *
 * Saga Pattern:
 * - Reserve: Temporarily hold inventory during checkout
 * - Commit: Permanently deduct after successful payment
 * - Compensate: Release if checkout fails
 */

import { DO } from 'dotdo'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface StockLevel {
  sku: string
  name: string
  available: number
  reserved: number
  lowStockThreshold: number
  updatedAt: Date
}

export interface Reservation {
  id: string
  orderId: string
  items: Array<{ sku: string; quantity: number }>
  status: 'pending' | 'committed' | 'released'
  createdAt: Date
  expiresAt: Date
}

export class InventoryError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'InventoryError'
  }
}

// ============================================================================
// INVENTORY DURABLE OBJECT
// ============================================================================

export class InventoryDO extends DO {
  static readonly $type = 'InventoryDO'

  /**
   * Register event handlers on startup.
   */
  async onStart() {
    // ========================================================================
    // RESERVATION EVENTS
    // ========================================================================

    /**
     * Handle reservation request from checkout.
     */
    this.$.on.Inventory.reserve(async (event) => {
      const { orderId, items, sessionId } = event.data as {
        orderId: string
        items: Array<{ sku: string; quantity: number }>
        sessionId?: string
      }
      console.log(`[Inventory.reserve] Reserving for order ${orderId}`)

      try {
        const reservation = await this.reserve(orderId, items)

        // Notify checkout session that reservation succeeded
        this.$.send('Inventory.reserved', {
          orderId,
          reservationId: reservation.id,
          items: reservation.items,
          sessionId,
        })
      } catch (error) {
        if (error instanceof InventoryError) {
          this.$.send('Inventory.insufficient', {
            orderId,
            code: error.code,
            message: error.message,
            details: error.details,
            sessionId,
          })
        }
      }
    })

    /**
     * Handle reservation release (order cancelled/failed).
     */
    this.$.on.Inventory.release(async (event) => {
      const { orderId, reason } = event.data as {
        orderId: string
        reason?: string
      }
      console.log(`[Inventory.release] Releasing reservation for order ${orderId}: ${reason}`)

      await this.releaseReservation(orderId)

      this.$.send('Inventory.released', {
        orderId,
        reason,
      })
    })

    /**
     * Handle reservation commit (order paid).
     */
    this.$.on.Inventory.commit(async (event) => {
      const { orderId } = event.data as { orderId: string }
      console.log(`[Inventory.commit] Committing reservation for order ${orderId}`)

      await this.commitReservation(orderId)

      this.$.send('Inventory.committed', {
        orderId,
      })
    })

    /**
     * Handle low stock alerts.
     */
    this.$.on.Inventory.lowStock(async (event) => {
      const { sku, name, available, threshold } = event.data as {
        sku: string
        name: string
        available: number
        threshold: number
      }
      console.log(`[Inventory.lowStock] ${name} (${sku}): ${available} remaining (threshold: ${threshold})`)

      // In production: notify purchasing team, trigger reorder
    })

    // ========================================================================
    // SCHEDULED CLEANUP
    // ========================================================================

    // Clean up expired reservations every 5 minutes
    // In production: this.$.every('5 minutes')(() => this.cleanupExpiredReservations())

    console.log('[InventoryDO] Event handlers registered')
  }

  // ==========================================================================
  // STOCK MANAGEMENT
  // ==========================================================================

  /**
   * Set stock level for a product.
   */
  async setStock(sku: string, name: string, quantity: number, lowStockThreshold = 10): Promise<StockLevel> {
    const stock: StockLevel = {
      sku,
      name,
      available: quantity,
      reserved: 0,
      lowStockThreshold,
      updatedAt: new Date(),
    }

    await this.ctx.storage.put(`stock:${sku}`, stock)

    // Track all SKUs
    const skus = (await this.ctx.storage.get<string[]>('skus')) ?? []
    if (!skus.includes(sku)) {
      skus.push(sku)
      await this.ctx.storage.put('skus', skus)
    }

    return stock
  }

  /**
   * Get stock level for a product.
   */
  async getStock(sku: string): Promise<StockLevel | null> {
    return (await this.ctx.storage.get<StockLevel>(`stock:${sku}`)) ?? null
  }

  /**
   * Get all stock levels.
   */
  async getAllStock(): Promise<StockLevel[]> {
    const skus = (await this.ctx.storage.get<string[]>('skus')) ?? []
    const stocks: StockLevel[] = []

    for (const sku of skus) {
      const stock = await this.getStock(sku)
      if (stock) stocks.push(stock)
    }

    return stocks
  }

  /**
   * Adjust stock level (add or remove).
   */
  async adjustStock(sku: string, adjustment: number): Promise<StockLevel> {
    const stock = await this.getStock(sku)
    if (!stock) {
      throw new InventoryError(`Product not found: ${sku}`, 'PRODUCT_NOT_FOUND')
    }

    stock.available += adjustment
    if (stock.available < 0) {
      throw new InventoryError(`Insufficient stock for ${sku}`, 'INSUFFICIENT_STOCK', {
        sku,
        available: stock.available - adjustment,
        requested: Math.abs(adjustment),
      })
    }

    stock.updatedAt = new Date()
    await this.ctx.storage.put(`stock:${sku}`, stock)

    // Check low stock threshold
    if (stock.available <= stock.lowStockThreshold) {
      this.$.send('Inventory.lowStock', {
        sku: stock.sku,
        name: stock.name,
        available: stock.available,
        threshold: stock.lowStockThreshold,
      })
    }

    return stock
  }

  // ==========================================================================
  // RESERVATION MANAGEMENT (SAGA PATTERN)
  // ==========================================================================

  /**
   * Check if items are available (without reserving).
   */
  async checkAvailability(items: Array<{ sku: string; quantity: number }>): Promise<{
    available: boolean
    unavailable: Array<{ sku: string; requested: number; available: number }>
  }> {
    const unavailable: Array<{ sku: string; requested: number; available: number }> = []

    for (const item of items) {
      const stock = await this.getStock(item.sku)
      const availableQty = stock ? stock.available - stock.reserved : 0

      if (!stock || availableQty < item.quantity) {
        unavailable.push({
          sku: item.sku,
          requested: item.quantity,
          available: availableQty,
        })
      }
    }

    return {
      available: unavailable.length === 0,
      unavailable,
    }
  }

  /**
   * Reserve inventory for an order.
   * This is the "try" phase of the saga.
   */
  async reserve(orderId: string, items: Array<{ sku: string; quantity: number }>): Promise<Reservation> {
    // Check availability first
    const { available, unavailable } = await this.checkAvailability(items)

    if (!available) {
      throw new InventoryError(
        'Insufficient inventory for one or more items',
        'INSUFFICIENT_STOCK',
        { unavailable }
      )
    }

    // Create reservation
    const reservation: Reservation = {
      id: `res_${crypto.randomUUID().slice(0, 8)}`,
      orderId,
      items,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minute hold
    }

    // Update stock reservations
    for (const item of items) {
      const stock = await this.getStock(item.sku)
      if (stock) {
        stock.reserved += item.quantity
        stock.updatedAt = new Date()
        await this.ctx.storage.put(`stock:${item.sku}`, stock)
      }
    }

    // Store reservation
    await this.ctx.storage.put(`reservation:${orderId}`, reservation)

    // Track active reservations
    const reservationIds = (await this.ctx.storage.get<string[]>('reservationIds')) ?? []
    reservationIds.push(orderId)
    await this.ctx.storage.put('reservationIds', reservationIds)

    return reservation
  }

  /**
   * Commit a reservation (order paid).
   * This is the "confirm" phase of the saga.
   */
  async commitReservation(orderId: string): Promise<void> {
    const reservation = await this.ctx.storage.get<Reservation>(`reservation:${orderId}`)
    if (!reservation) {
      throw new InventoryError(`Reservation not found: ${orderId}`, 'RESERVATION_NOT_FOUND')
    }

    if (reservation.status !== 'pending') {
      throw new InventoryError(`Reservation already ${reservation.status}`, 'INVALID_STATE')
    }

    // Move reserved quantity to sold (deduct from available)
    for (const item of reservation.items) {
      const stock = await this.getStock(item.sku)
      if (stock) {
        stock.available -= item.quantity
        stock.reserved -= item.quantity
        stock.updatedAt = new Date()
        await this.ctx.storage.put(`stock:${item.sku}`, stock)

        // Check low stock after sale
        if (stock.available <= stock.lowStockThreshold) {
          this.$.send('Inventory.lowStock', {
            sku: stock.sku,
            name: stock.name,
            available: stock.available,
            threshold: stock.lowStockThreshold,
          })
        }
      }
    }

    // Update reservation status
    reservation.status = 'committed'
    await this.ctx.storage.put(`reservation:${orderId}`, reservation)
  }

  /**
   * Release a reservation (order cancelled/failed).
   * This is the "compensate" phase of the saga.
   */
  async releaseReservation(orderId: string): Promise<void> {
    const reservation = await this.ctx.storage.get<Reservation>(`reservation:${orderId}`)
    if (!reservation) {
      // No reservation to release - idempotent
      return
    }

    if (reservation.status !== 'pending') {
      // Already committed or released - idempotent
      return
    }

    // Release reserved quantity
    for (const item of reservation.items) {
      const stock = await this.getStock(item.sku)
      if (stock) {
        stock.reserved -= item.quantity
        stock.updatedAt = new Date()
        await this.ctx.storage.put(`stock:${item.sku}`, stock)
      }
    }

    // Update reservation status
    reservation.status = 'released'
    await this.ctx.storage.put(`reservation:${orderId}`, reservation)

    // Remove from active reservations
    const reservationIds = (await this.ctx.storage.get<string[]>('reservationIds')) ?? []
    const updatedIds = reservationIds.filter((id) => id !== orderId)
    await this.ctx.storage.put('reservationIds', updatedIds)
  }

  /**
   * Clean up expired reservations.
   * Should be called periodically.
   */
  async cleanupExpiredReservations(): Promise<number> {
    const reservationIds = (await this.ctx.storage.get<string[]>('reservationIds')) ?? []
    const now = new Date()
    let releasedCount = 0

    for (const orderId of reservationIds) {
      const reservation = await this.ctx.storage.get<Reservation>(`reservation:${orderId}`)
      if (reservation && reservation.status === 'pending' && new Date(reservation.expiresAt) < now) {
        await this.releaseReservation(orderId)
        releasedCount++
        console.log(`[InventoryDO] Released expired reservation: ${reservation.id}`)
      }
    }

    return releasedCount
  }

  /**
   * Get reservation by order ID.
   */
  async getReservation(orderId: string): Promise<Reservation | null> {
    return (await this.ctx.storage.get<Reservation>(`reservation:${orderId}`)) ?? null
  }
}
