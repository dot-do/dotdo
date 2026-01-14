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

    it('should get all locations', async () => {
      const locations = await inventory.getAllLocations()

      expect(locations).toHaveLength(2)
      expect(locations.map((l) => l.id)).toContain('loc-warehouse')
      expect(locations.map((l) => l.id)).toContain('loc-store-1')
    })

    it('should delete location without stock', async () => {
      await inventory.createLocation({
        id: 'loc-temp',
        name: 'Temporary',
        type: 'warehouse',
      })

      await inventory.deleteLocation('loc-temp')

      const location = await inventory.getLocation('loc-temp')
      expect(location).toBeNull()
    })

    it('should not delete location with stock', async () => {
      await inventory.setStockAtLocation('var-1', 'loc-warehouse', 100)

      await expect(inventory.deleteLocation('loc-warehouse')).rejects.toThrow(
        'Cannot delete location with existing stock'
      )
    })
  })

  // =============================================================================
  // Multi-Warehouse Fulfillment Tests
  // =============================================================================

  describe('multi-warehouse fulfillment', () => {
    let inventory: InventoryManager

    beforeEach(async () => {
      inventory = createInventoryManager({ multiLocation: true })

      // Create warehouses with priorities
      await inventory.createLocation({
        id: 'wh-primary',
        name: 'Primary Warehouse',
        type: 'warehouse',
        priority: 1,
        coordinates: { lat: 40.7128, lng: -74.006 }, // NYC
      })
      await inventory.createLocation({
        id: 'wh-secondary',
        name: 'Secondary Warehouse',
        type: 'warehouse',
        priority: 2,
        coordinates: { lat: 34.0522, lng: -118.2437 }, // LA
      })
      await inventory.createLocation({
        id: 'wh-tertiary',
        name: 'Tertiary Warehouse',
        type: 'warehouse',
        priority: 3,
        coordinates: { lat: 41.8781, lng: -87.6298 }, // Chicago
      })

      // Set stock at each warehouse
      await inventory.setStockAtLocation('var-1', 'wh-primary', 50)
      await inventory.setStockAtLocation('var-1', 'wh-secondary', 100)
      await inventory.setStockAtLocation('var-1', 'wh-tertiary', 30)
    })

    describe('getAggregatedStock', () => {
      it('should return aggregated stock across all warehouses', async () => {
        const agg = await inventory.getAggregatedStock('var-1')

        expect(agg.variantId).toBe('var-1')
        expect(agg.totalOnHand).toBe(180)
        expect(agg.totalAvailable).toBe(180)
        expect(agg.totalReserved).toBe(0)
        expect(agg.byLocation).toHaveLength(3)
      })

      it('should sort locations by priority', async () => {
        const agg = await inventory.getAggregatedStock('var-1')

        expect(agg.byLocation[0].locationId).toBe('wh-primary')
        expect(agg.byLocation[1].locationId).toBe('wh-secondary')
        expect(agg.byLocation[2].locationId).toBe('wh-tertiary')
      })

      it('should account for reservations in aggregated stock', async () => {
        await inventory.createReservation({
          variantId: 'var-1',
          quantity: 20,
          referenceId: 'cart-1',
          referenceType: 'cart',
          locationId: 'wh-primary',
        })

        const agg = await inventory.getAggregatedStock('var-1')

        expect(agg.totalOnHand).toBe(180)
        expect(agg.totalReserved).toBe(20)
        expect(agg.totalAvailable).toBe(160)
        expect(agg.byLocation[0].reserved).toBe(20)
        expect(agg.byLocation[0].available).toBe(30)
      })

      it('should exclude inactive locations', async () => {
        await inventory.updateLocation('wh-tertiary', { isActive: false })

        const agg = await inventory.getAggregatedStock('var-1')

        expect(agg.byLocation).toHaveLength(2)
        expect(agg.totalOnHand).toBe(150)
      })
    })

    describe('planFulfillment', () => {
      it('should plan fulfillment using priority strategy', async () => {
        const plan = await inventory.planFulfillment('var-1', 60, {
          strategy: 'priority',
        })

        expect(plan.canFulfill).toBe(true)
        expect(plan.allocations).toHaveLength(2) // 50 from primary + 10 from secondary
        expect(plan.allocations[0].locationId).toBe('wh-primary')
        expect(plan.allocations[0].quantity).toBe(50)
        expect(plan.allocations[1].locationId).toBe('wh-secondary')
        expect(plan.allocations[1].quantity).toBe(10)
      })

      it('should plan fulfillment using nearest strategy', async () => {
        const plan = await inventory.planFulfillment('var-1', 30, {
          strategy: 'nearest',
          coordinates: { lat: 41.0, lng: -87.0 }, // Near Chicago
        })

        expect(plan.canFulfill).toBe(true)
        expect(plan.allocations[0].locationId).toBe('wh-tertiary')
      })

      it('should plan fulfillment using lowest-stock-first strategy', async () => {
        const plan = await inventory.planFulfillment('var-1', 60, {
          strategy: 'lowest-stock-first',
        })

        expect(plan.canFulfill).toBe(true)
        // Should start from wh-tertiary (30), then wh-primary (50)
        expect(plan.allocations[0].locationId).toBe('wh-tertiary')
        expect(plan.allocations[0].quantity).toBe(30)
        expect(plan.allocations[1].locationId).toBe('wh-primary')
        expect(plan.allocations[1].quantity).toBe(30)
      })

      it('should report shortfall when cannot fulfill', async () => {
        const plan = await inventory.planFulfillment('var-1', 200, {
          strategy: 'priority',
        })

        expect(plan.canFulfill).toBe(false)
        expect(plan.shortfall).toBe(20) // Need 200, have 180
      })

      it('should exclude specified locations', async () => {
        const plan = await inventory.planFulfillment('var-1', 50, {
          strategy: 'priority',
          excludeLocations: ['wh-primary'],
        })

        expect(plan.canFulfill).toBe(true)
        expect(plan.allocations[0].locationId).toBe('wh-secondary')
      })

      it('should exclude inactive locations', async () => {
        await inventory.updateLocation('wh-primary', { isActive: false })

        const plan = await inventory.planFulfillment('var-1', 50, {
          strategy: 'priority',
        })

        expect(plan.allocations[0].locationId).toBe('wh-secondary')
      })
    })

    describe('reserveWithFulfillmentPlan', () => {
      it('should create reservations from fulfillment plan', async () => {
        const plan = await inventory.planFulfillment('var-1', 60, {
          strategy: 'priority',
        })

        const reservations = await inventory.reserveWithFulfillmentPlan(
          plan,
          'order-123',
          'order'
        )

        expect(reservations).toHaveLength(2)

        const level1 = await inventory.getInventoryLevelAtLocation('var-1', 'wh-primary')
        const level2 = await inventory.getInventoryLevelAtLocation('var-1', 'wh-secondary')

        expect(level1.reserved).toBe(50)
        expect(level2.reserved).toBe(10)
      })

      it('should reject if plan cannot fulfill', async () => {
        const plan = await inventory.planFulfillment('var-1', 200, {
          strategy: 'priority',
        })

        await expect(
          inventory.reserveWithFulfillmentPlan(plan, 'order-123', 'order')
        ).rejects.toThrow('Cannot fulfill')
      })
    })

    describe('location-specific low stock thresholds', () => {
      it('should set and track low stock at specific location', async () => {
        await inventory.setLocationLowStockThreshold('var-1', 'wh-primary', 60)

        const lowStock = await inventory.getLowStockItemsAtLocation('wh-primary')

        expect(lowStock).toHaveLength(1)
        expect(lowStock[0].variantId).toBe('var-1')
        expect(lowStock[0].available).toBe(50)
        expect(lowStock[0].lowStockThreshold).toBe(60)
      })

      it('should not include items above threshold', async () => {
        await inventory.setLocationLowStockThreshold('var-1', 'wh-secondary', 50)

        const lowStock = await inventory.getLowStockItemsAtLocation('wh-secondary')

        expect(lowStock).toHaveLength(0) // 100 available >= 50 threshold
      })
    })
  })

  // =============================================================================
  // Transfer Request Workflow Tests
  // =============================================================================

  describe('transfer request workflow', () => {
    let inventory: InventoryManager

    beforeEach(async () => {
      inventory = createInventoryManager({ multiLocation: true })

      await inventory.createLocation({
        id: 'wh-source',
        name: 'Source Warehouse',
        type: 'warehouse',
      })
      await inventory.createLocation({
        id: 'wh-dest',
        name: 'Destination Warehouse',
        type: 'warehouse',
      })

      await inventory.setStockAtLocation('var-1', 'wh-source', 100)
    })

    describe('createTransferRequest', () => {
      it('should create a pending transfer request', async () => {
        const request = await inventory.createTransferRequest({
          variantId: 'var-1',
          fromLocationId: 'wh-source',
          toLocationId: 'wh-dest',
          quantity: 20,
          reason: 'Rebalance stock',
          requestedBy: 'user-1',
        })

        expect(request.id).toBeDefined()
        expect(request.status).toBe('pending')
        expect(request.variantId).toBe('var-1')
        expect(request.quantity).toBe(20)
        expect(request.requestedBy).toBe('user-1')
      })

      it('should reject if insufficient stock', async () => {
        await expect(
          inventory.createTransferRequest({
            variantId: 'var-1',
            fromLocationId: 'wh-source',
            toLocationId: 'wh-dest',
            quantity: 150,
          })
        ).rejects.toThrow('Insufficient stock')
      })
    })

    describe('approveTransferRequest', () => {
      it('should approve a pending transfer request', async () => {
        const request = await inventory.createTransferRequest({
          variantId: 'var-1',
          fromLocationId: 'wh-source',
          toLocationId: 'wh-dest',
          quantity: 20,
        })

        const approved = await inventory.approveTransferRequest(request.id, 'manager-1')

        expect(approved.status).toBe('approved')
        expect(approved.approvedBy).toBe('manager-1')
        expect(approved.approvedAt).toBeDefined()
      })

      it('should reject approval if not pending', async () => {
        const request = await inventory.createTransferRequest({
          variantId: 'var-1',
          fromLocationId: 'wh-source',
          toLocationId: 'wh-dest',
          quantity: 20,
        })

        await inventory.approveTransferRequest(request.id)

        await expect(inventory.approveTransferRequest(request.id)).rejects.toThrow(
          'not pending'
        )
      })
    })

    describe('startTransfer', () => {
      it('should start an approved transfer and deduct source stock', async () => {
        const request = await inventory.createTransferRequest({
          variantId: 'var-1',
          fromLocationId: 'wh-source',
          toLocationId: 'wh-dest',
          quantity: 20,
        })

        await inventory.approveTransferRequest(request.id)
        const started = await inventory.startTransfer(request.id)

        expect(started.status).toBe('in_transit')

        const sourceStock = await inventory.getStockAtLocation('var-1', 'wh-source')
        expect(sourceStock).toBe(80) // 100 - 20
      })

      it('should reject if not approved', async () => {
        const request = await inventory.createTransferRequest({
          variantId: 'var-1',
          fromLocationId: 'wh-source',
          toLocationId: 'wh-dest',
          quantity: 20,
        })

        await expect(inventory.startTransfer(request.id)).rejects.toThrow(
          'must be approved'
        )
      })
    })

    describe('completeTransfer', () => {
      it('should complete transfer and add to destination', async () => {
        const request = await inventory.createTransferRequest({
          variantId: 'var-1',
          fromLocationId: 'wh-source',
          toLocationId: 'wh-dest',
          quantity: 20,
        })

        await inventory.approveTransferRequest(request.id)
        await inventory.startTransfer(request.id)
        const completed = await inventory.completeTransfer(request.id)

        expect(completed.status).toBe('completed')
        expect(completed.completedAt).toBeDefined()

        const destStock = await inventory.getStockAtLocation('var-1', 'wh-dest')
        expect(destStock).toBe(20)
      })

      it('should record movements for transfer', async () => {
        const request = await inventory.createTransferRequest({
          variantId: 'var-1',
          fromLocationId: 'wh-source',
          toLocationId: 'wh-dest',
          quantity: 20,
        })

        await inventory.approveTransferRequest(request.id)
        await inventory.startTransfer(request.id)
        await inventory.completeTransfer(request.id)

        const movements = await inventory.getStockMovements('var-1', { type: 'transfer' })

        expect(movements.length).toBeGreaterThanOrEqual(2) // Outbound and inbound
      })
    })

    describe('cancelTransferRequest', () => {
      it('should cancel a pending transfer', async () => {
        const request = await inventory.createTransferRequest({
          variantId: 'var-1',
          fromLocationId: 'wh-source',
          toLocationId: 'wh-dest',
          quantity: 20,
        })

        const cancelled = await inventory.cancelTransferRequest(request.id, 'No longer needed')

        expect(cancelled.status).toBe('cancelled')
        expect(cancelled.cancellationReason).toBe('No longer needed')
      })

      it('should restore stock when cancelling in-transit transfer', async () => {
        const request = await inventory.createTransferRequest({
          variantId: 'var-1',
          fromLocationId: 'wh-source',
          toLocationId: 'wh-dest',
          quantity: 20,
        })

        await inventory.approveTransferRequest(request.id)
        await inventory.startTransfer(request.id)

        // Stock is now 80
        const stockBefore = await inventory.getStockAtLocation('var-1', 'wh-source')
        expect(stockBefore).toBe(80)

        await inventory.cancelTransferRequest(request.id, 'Lost in transit')

        // Stock should be restored
        const stockAfter = await inventory.getStockAtLocation('var-1', 'wh-source')
        expect(stockAfter).toBe(100)
      })

      it('should not cancel completed transfer', async () => {
        const request = await inventory.createTransferRequest({
          variantId: 'var-1',
          fromLocationId: 'wh-source',
          toLocationId: 'wh-dest',
          quantity: 20,
        })

        await inventory.approveTransferRequest(request.id)
        await inventory.startTransfer(request.id)
        await inventory.completeTransfer(request.id)

        await expect(inventory.cancelTransferRequest(request.id)).rejects.toThrow(
          'Cannot cancel completed'
        )
      })
    })

    describe('transfer request queries', () => {
      it('should get transfer requests by location', async () => {
        await inventory.createTransferRequest({
          variantId: 'var-1',
          fromLocationId: 'wh-source',
          toLocationId: 'wh-dest',
          quantity: 10,
        })
        await inventory.createTransferRequest({
          variantId: 'var-1',
          fromLocationId: 'wh-source',
          toLocationId: 'wh-dest',
          quantity: 20,
        })

        const fromSource = await inventory.getTransferRequestsByLocation('wh-source', 'from')
        const toDest = await inventory.getTransferRequestsByLocation('wh-dest', 'to')
        const bothSource = await inventory.getTransferRequestsByLocation('wh-source', 'both')

        expect(fromSource).toHaveLength(2)
        expect(toDest).toHaveLength(2)
        expect(bothSource).toHaveLength(2)
      })

      it('should get pending transfer requests', async () => {
        const r1 = await inventory.createTransferRequest({
          variantId: 'var-1',
          fromLocationId: 'wh-source',
          toLocationId: 'wh-dest',
          quantity: 10,
        })
        await inventory.createTransferRequest({
          variantId: 'var-1',
          fromLocationId: 'wh-source',
          toLocationId: 'wh-dest',
          quantity: 20,
        })

        await inventory.approveTransferRequest(r1.id)
        await inventory.startTransfer(r1.id)

        const pending = await inventory.getPendingTransferRequests()

        expect(pending).toHaveLength(1) // Only the second one is still pending
      })
    })
  })
})
