/**
 * Inventory Management Tests - TDD RED Phase
 *
 * Tests for the inventory primitive providing:
 * - Stock tracking per variant
 * - Inventory reservations
 * - Low stock alerts
 * - Stock movements and audit trail
 * - Multi-location inventory
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createInventoryManager,
  type InventoryManager,
  type InventoryLevel,
  type Reservation,
  type StockMovement,
  type LowStockAlert,
  type InventoryLocation,
} from '../inventory'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestInventoryManager(): InventoryManager {
  return createInventoryManager()
}

// =============================================================================
// Stock Level Tests
// =============================================================================

describe('InventoryManager', () => {
  describe('stock levels', () => {
    let inventory: InventoryManager

    beforeEach(() => {
      inventory = createTestInventoryManager()
    })

    it('should set initial stock level', async () => {
      await inventory.setStock('var-1', 100)

      const level = await inventory.getStock('var-1')

      expect(level).toBe(100)
    })

    it('should return 0 for unknown variant', async () => {
      const level = await inventory.getStock('unknown-variant')

      expect(level).toBe(0)
    })

    it('should get detailed inventory level', async () => {
      await inventory.setStock('var-1', 100)

      const details = await inventory.getInventoryLevel('var-1')

      expect(details.variantId).toBe('var-1')
      expect(details.available).toBe(100)
      expect(details.reserved).toBe(0)
      expect(details.onHand).toBe(100)
    })

    it('should adjust stock up', async () => {
      await inventory.setStock('var-1', 100)

      await inventory.adjustStock('var-1', 50, 'Restock')

      const level = await inventory.getStock('var-1')
      expect(level).toBe(150)
    })

    it('should adjust stock down', async () => {
      await inventory.setStock('var-1', 100)

      await inventory.adjustStock('var-1', -30, 'Sold')

      const level = await inventory.getStock('var-1')
      expect(level).toBe(70)
    })

    it('should not allow negative stock', async () => {
      await inventory.setStock('var-1', 100)

      await expect(
        inventory.adjustStock('var-1', -150, 'Over-sold')
      ).rejects.toThrow('Insufficient stock')
    })

    it('should allow overselling when configured', async () => {
      inventory = createInventoryManager({ allowOverselling: true })
      await inventory.setStock('var-1', 100)

      await inventory.adjustStock('var-1', -150, 'Oversold')

      const level = await inventory.getStock('var-1')
      expect(level).toBe(-50)
    })

    it('should bulk update stock levels', async () => {
      await inventory.bulkSetStock([
        { variantId: 'var-1', quantity: 100 },
        { variantId: 'var-2', quantity: 200 },
        { variantId: 'var-3', quantity: 300 },
      ])

      expect(await inventory.getStock('var-1')).toBe(100)
      expect(await inventory.getStock('var-2')).toBe(200)
      expect(await inventory.getStock('var-3')).toBe(300)
    })

    it('should check availability', async () => {
      await inventory.setStock('var-1', 100)

      expect(await inventory.isAvailable('var-1', 50)).toBe(true)
      expect(await inventory.isAvailable('var-1', 100)).toBe(true)
      expect(await inventory.isAvailable('var-1', 101)).toBe(false)
    })

    it('should check availability for multiple items', async () => {
      await inventory.setStock('var-1', 100)
      await inventory.setStock('var-2', 50)

      const result = await inventory.checkAvailability([
        { variantId: 'var-1', quantity: 50 },
        { variantId: 'var-2', quantity: 30 },
      ])

      expect(result.available).toBe(true)
      expect(result.items).toHaveLength(2)
      expect(result.items.every((i) => i.available)).toBe(true)
    })

    it('should report unavailable items in bulk check', async () => {
      await inventory.setStock('var-1', 100)
      await inventory.setStock('var-2', 20)

      const result = await inventory.checkAvailability([
        { variantId: 'var-1', quantity: 50 },
        { variantId: 'var-2', quantity: 30 },
      ])

      expect(result.available).toBe(false)
      expect(result.items[1].available).toBe(false)
      expect(result.items[1].availableQuantity).toBe(20)
    })
  })

  // =============================================================================
  // Reservation Tests
  // =============================================================================

  describe('reservations', () => {
    let inventory: InventoryManager

    beforeEach(async () => {
      inventory = createTestInventoryManager()
      await inventory.setStock('var-1', 100)
      await inventory.setStock('var-2', 50)
    })

    it('should create a reservation', async () => {
      const reservation = await inventory.createReservation({
        variantId: 'var-1',
        quantity: 10,
        referenceId: 'cart-123',
        referenceType: 'cart',
      })

      expect(reservation.id).toBeDefined()
      expect(reservation.variantId).toBe('var-1')
      expect(reservation.quantity).toBe(10)
      expect(reservation.status).toBe('active')
      expect(reservation.expiresAt).toBeInstanceOf(Date)
    })

    it('should reduce available stock when reserved', async () => {
      await inventory.createReservation({
        variantId: 'var-1',
        quantity: 30,
        referenceId: 'cart-1',
        referenceType: 'cart',
      })

      const level = await inventory.getInventoryLevel('var-1')

      expect(level.onHand).toBe(100)
      expect(level.reserved).toBe(30)
      expect(level.available).toBe(70)
    })

    it('should reject reservation exceeding available stock', async () => {
      await inventory.createReservation({
        variantId: 'var-1',
        quantity: 80,
        referenceId: 'cart-1',
        referenceType: 'cart',
      })

      await expect(
        inventory.createReservation({
          variantId: 'var-1',
          quantity: 30,
          referenceId: 'cart-2',
          referenceType: 'cart',
        })
      ).rejects.toThrow('Insufficient available stock')
    })

    it('should confirm a reservation', async () => {
      const reservation = await inventory.createReservation({
        variantId: 'var-1',
        quantity: 10,
        referenceId: 'cart-1',
        referenceType: 'cart',
      })

      await inventory.confirmReservation(reservation.id, 'order-123')

      const level = await inventory.getInventoryLevel('var-1')
      expect(level.onHand).toBe(90) // Deducted
      expect(level.reserved).toBe(0) // Reservation cleared

      const confirmed = await inventory.getReservation(reservation.id)
      expect(confirmed?.status).toBe('confirmed')
    })

    it('should release a reservation', async () => {
      const reservation = await inventory.createReservation({
        variantId: 'var-1',
        quantity: 20,
        referenceId: 'cart-1',
        referenceType: 'cart',
      })

      await inventory.releaseReservation(reservation.id)

      const level = await inventory.getInventoryLevel('var-1')
      expect(level.available).toBe(100)
      expect(level.reserved).toBe(0)

      const released = await inventory.getReservation(reservation.id)
      expect(released?.status).toBe('released')
    })

    it('should auto-expire reservations', async () => {
      vi.useFakeTimers()

      const reservation = await inventory.createReservation({
        variantId: 'var-1',
        quantity: 20,
        referenceId: 'cart-1',
        referenceType: 'cart',
        ttl: 15 * 60 * 1000, // 15 minutes
      })

      // Advance time past TTL
      vi.advanceTimersByTime(16 * 60 * 1000)

      await inventory.cleanupExpiredReservations()

      const level = await inventory.getInventoryLevel('var-1')
      expect(level.available).toBe(100)

      const expired = await inventory.getReservation(reservation.id)
      expect(expired?.status).toBe('expired')

      vi.useRealTimers()
    })

    it('should extend reservation TTL', async () => {
      const reservation = await inventory.createReservation({
        variantId: 'var-1',
        quantity: 10,
        referenceId: 'cart-1',
        referenceType: 'cart',
      })

      const originalExpiry = reservation.expiresAt!.getTime()

      const extended = await inventory.extendReservation(
        reservation.id,
        30 * 60 * 1000 // 30 more minutes
      )

      expect(extended.expiresAt!.getTime()).toBeGreaterThan(originalExpiry)
    })

    it('should create bulk reservations', async () => {
      const reservations = await inventory.createBulkReservation({
        items: [
          { variantId: 'var-1', quantity: 10 },
          { variantId: 'var-2', quantity: 5 },
        ],
        referenceId: 'cart-bulk',
        referenceType: 'cart',
      })

      expect(reservations).toHaveLength(2)

      const level1 = await inventory.getInventoryLevel('var-1')
      const level2 = await inventory.getInventoryLevel('var-2')

      expect(level1.reserved).toBe(10)
      expect(level2.reserved).toBe(5)
    })

    it('should rollback partial bulk reservation on failure', async () => {
      await expect(
        inventory.createBulkReservation({
          items: [
            { variantId: 'var-1', quantity: 10 },
            { variantId: 'var-2', quantity: 100 }, // Exceeds available
          ],
          referenceId: 'cart-fail',
          referenceType: 'cart',
        })
      ).rejects.toThrow()

      // First reservation should be rolled back
      const level1 = await inventory.getInventoryLevel('var-1')
      expect(level1.reserved).toBe(0)
    })

    it('should get reservations by reference', async () => {
      await inventory.createReservation({
        variantId: 'var-1',
        quantity: 10,
        referenceId: 'cart-ref',
        referenceType: 'cart',
      })
      await inventory.createReservation({
        variantId: 'var-2',
        quantity: 5,
        referenceId: 'cart-ref',
        referenceType: 'cart',
      })

      const reservations = await inventory.getReservationsByReference(
        'cart-ref',
        'cart'
      )

      expect(reservations).toHaveLength(2)
    })
  })

  // =============================================================================
  // Stock Movement and Audit Trail Tests
  // =============================================================================

  describe('stock movements and audit trail', () => {
    let inventory: InventoryManager

    beforeEach(async () => {
      inventory = createTestInventoryManager()
      await inventory.setStock('var-1', 100)
    })

    it('should record stock movement on adjustment', async () => {
      await inventory.adjustStock('var-1', 50, 'Restock from supplier')

      const movements = await inventory.getStockMovements('var-1')

      // Should have initial set + adjustment
      expect(movements.length).toBeGreaterThanOrEqual(1)

      const lastMovement = movements[movements.length - 1]
      expect(lastMovement.quantity).toBe(50)
      expect(lastMovement.reason).toBe('Restock from supplier')
      expect(lastMovement.type).toBe('adjustment')
    })

    it('should record movement on reservation confirm', async () => {
      const reservation = await inventory.createReservation({
        variantId: 'var-1',
        quantity: 10,
        referenceId: 'cart-1',
        referenceType: 'cart',
      })

      await inventory.confirmReservation(reservation.id, 'order-123')

      const movements = await inventory.getStockMovements('var-1')
      const saleMovement = movements.find((m) => m.type === 'sale')

      expect(saleMovement).toBeDefined()
      expect(saleMovement?.quantity).toBe(-10)
      expect(saleMovement?.referenceId).toBe('order-123')
    })

    it('should record different movement types', async () => {
      await inventory.recordMovement('var-1', {
        type: 'return',
        quantity: 5,
        reason: 'Customer return',
        referenceId: 'return-123',
      })

      const movements = await inventory.getStockMovements('var-1')
      const returnMovement = movements.find((m) => m.type === 'return')

      expect(returnMovement).toBeDefined()
      expect(returnMovement?.quantity).toBe(5)
    })

    it('should filter movements by date range', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)

      await inventory.adjustStock('var-1', 10, 'Adjustment 1')
      await inventory.adjustStock('var-1', 20, 'Adjustment 2')

      const movements = await inventory.getStockMovements('var-1', {
        from: yesterday,
        to: tomorrow,
      })

      expect(movements.length).toBeGreaterThanOrEqual(2)
    })

    it('should filter movements by type', async () => {
      await inventory.adjustStock('var-1', 10, 'Adjustment')

      const movements = await inventory.getStockMovements('var-1', {
        type: 'adjustment',
      })

      expect(movements.every((m) => m.type === 'adjustment')).toBe(true)
    })

    it('should calculate stock at point in time', async () => {
      const startTime = new Date()
      await inventory.setStock('var-1', 100)

      await new Promise((r) => setTimeout(r, 10))
      await inventory.adjustStock('var-1', 50, 'Add')

      await new Promise((r) => setTimeout(r, 10))
      await inventory.adjustStock('var-1', -30, 'Sell')

      // Current stock is 120
      expect(await inventory.getStock('var-1')).toBe(120)

      // Stock at start was approximately 100
      const historicalStock = await inventory.getStockAsOf('var-1', startTime)
      expect(historicalStock).toBeLessThanOrEqual(100)
    })
  })

  // =============================================================================
  // Low Stock Alerts Tests
  // =============================================================================

  describe('low stock alerts', () => {
    let inventory: InventoryManager
    let alertCallback: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      alertCallback = vi.fn()
      inventory = createInventoryManager({
        onLowStock: alertCallback,
      })
      await inventory.setStock('var-1', 100)
    })

    it('should set low stock threshold', async () => {
      await inventory.setLowStockThreshold('var-1', 20)

      const level = await inventory.getInventoryLevel('var-1')
      expect(level.lowStockThreshold).toBe(20)
    })

    it('should trigger alert when stock drops below threshold', async () => {
      await inventory.setLowStockThreshold('var-1', 30)

      await inventory.adjustStock('var-1', -80, 'Big sale')

      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          variantId: 'var-1',
          currentStock: 20,
          threshold: 30,
        })
      )
    })

    it('should not re-trigger alert if already below threshold', async () => {
      await inventory.setLowStockThreshold('var-1', 50)

      await inventory.adjustStock('var-1', -60, 'First drop')
      await inventory.adjustStock('var-1', -10, 'Second drop')

      // Should only alert once
      expect(alertCallback).toHaveBeenCalledTimes(1)
    })

    it('should reset alert when restocked above threshold', async () => {
      await inventory.setLowStockThreshold('var-1', 50)

      await inventory.adjustStock('var-1', -60, 'Drop below')
      expect(alertCallback).toHaveBeenCalledTimes(1)

      await inventory.adjustStock('var-1', 30, 'Restock')
      await inventory.adjustStock('var-1', -25, 'Drop below again')

      // Should alert again
      expect(alertCallback).toHaveBeenCalledTimes(2)
    })

    it('should get list of low stock items', async () => {
      await inventory.setStock('var-2', 10)
      await inventory.setStock('var-3', 15)

      await inventory.setLowStockThreshold('var-1', 50)
      await inventory.setLowStockThreshold('var-2', 20)
      await inventory.setLowStockThreshold('var-3', 10) // 15 >= 10, not low stock

      await inventory.adjustStock('var-1', -60, 'Sell')

      const lowStockItems = await inventory.getLowStockItems()

      expect(lowStockItems).toHaveLength(2)
      expect(lowStockItems.map((i) => i.variantId)).toContain('var-1')
      expect(lowStockItems.map((i) => i.variantId)).toContain('var-2')
    })

    it('should get out of stock items', async () => {
      await inventory.setStock('var-2', 0)
      await inventory.adjustStock('var-1', -100, 'Sold out')

      const outOfStock = await inventory.getOutOfStockItems()

      expect(outOfStock).toHaveLength(2)
    })
  })

  // =============================================================================
  // Multi-Location Inventory Tests
  // =============================================================================

  describe('multi-location inventory', () => {
    let inventory: InventoryManager

    beforeEach(async () => {
      inventory = createInventoryManager({ multiLocation: true })

      // Create locations
      await inventory.createLocation({
        id: 'loc-warehouse',
        name: 'Main Warehouse',
        type: 'warehouse',
      })
      await inventory.createLocation({
        id: 'loc-store-1',
        name: 'Store 1',
        type: 'store',
      })
    })

    it('should set stock at specific location', async () => {
      await inventory.setStockAtLocation('var-1', 'loc-warehouse', 100)
      await inventory.setStockAtLocation('var-1', 'loc-store-1', 20)

      const warehouseStock = await inventory.getStockAtLocation('var-1', 'loc-warehouse')
      const storeStock = await inventory.getStockAtLocation('var-1', 'loc-store-1')

      expect(warehouseStock).toBe(100)
      expect(storeStock).toBe(20)
    })

    it('should aggregate stock across locations', async () => {
      await inventory.setStockAtLocation('var-1', 'loc-warehouse', 100)
      await inventory.setStockAtLocation('var-1', 'loc-store-1', 20)

      const totalStock = await inventory.getStock('var-1')

      expect(totalStock).toBe(120)
    })

    it('should get inventory by location', async () => {
      await inventory.setStockAtLocation('var-1', 'loc-warehouse', 100)
      await inventory.setStockAtLocation('var-2', 'loc-warehouse', 50)

      const levels = await inventory.getInventoryByLocation('loc-warehouse')

      expect(levels).toHaveLength(2)
      expect(levels.find((l) => l.variantId === 'var-1')?.available).toBe(100)
    })

    it('should reserve from specific location', async () => {
      await inventory.setStockAtLocation('var-1', 'loc-warehouse', 100)

      await inventory.createReservation({
        variantId: 'var-1',
        quantity: 30,
        referenceId: 'cart-1',
        referenceType: 'cart',
        locationId: 'loc-warehouse',
      })

      const level = await inventory.getInventoryLevelAtLocation('var-1', 'loc-warehouse')
      expect(level.reserved).toBe(30)
    })

    it('should transfer stock between locations', async () => {
      await inventory.setStockAtLocation('var-1', 'loc-warehouse', 100)
      await inventory.setStockAtLocation('var-1', 'loc-store-1', 10)

      await inventory.transferStock(
        'var-1',
        'loc-warehouse',
        'loc-store-1',
        20,
        'Restock store'
      )

      const warehouseStock = await inventory.getStockAtLocation('var-1', 'loc-warehouse')
      const storeStock = await inventory.getStockAtLocation('var-1', 'loc-store-1')

      expect(warehouseStock).toBe(80)
      expect(storeStock).toBe(30)
    })

    it('should record transfer as movement', async () => {
      await inventory.setStockAtLocation('var-1', 'loc-warehouse', 100)

      await inventory.transferStock(
        'var-1',
        'loc-warehouse',
        'loc-store-1',
        20,
        'Restock'
      )

      const movements = await inventory.getStockMovements('var-1', {
        type: 'transfer',
      })

      expect(movements.length).toBeGreaterThanOrEqual(1)
    })

    it('should get nearest location with stock', async () => {
      await inventory.setStockAtLocation('var-1', 'loc-warehouse', 100)
      await inventory.setStockAtLocation('var-1', 'loc-store-1', 0)

      await inventory.updateLocation('loc-warehouse', {
        coordinates: { lat: 40.7128, lng: -74.006 }, // NYC
      })
      await inventory.updateLocation('loc-store-1', {
        coordinates: { lat: 34.0522, lng: -118.2437 }, // LA
      })

      const nearest = await inventory.findNearestLocationWithStock(
        'var-1',
        10,
        { lat: 40.758, lng: -73.9855 } // Times Square
      )

      expect(nearest?.locationId).toBe('loc-warehouse')
    })
  })
})
