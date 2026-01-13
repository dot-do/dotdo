/**
 * Cart Engine with Session Handling Tests
 *
 * Tests for the cart engine providing:
 * - Guest and authenticated cart support
 * - Cart merge on login
 * - Automatic inventory reservation
 * - Cart expiration cleanup with inventory release
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createCartEngine,
  CartEngine,
  type Session,
  type CartEngineOptions,
} from '../cart-engine'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestEngine(options?: CartEngineOptions): CartEngine {
  return createCartEngine(options)
}

async function setupEngineWithStock(
  engine: CartEngine,
  variantId: string,
  quantity: number
): Promise<void> {
  await engine.setStock(variantId, quantity)
}

// =============================================================================
// Session Management Tests
// =============================================================================

describe('CartEngine', () => {
  describe('session management', () => {
    let engine: CartEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should create a guest session', async () => {
      const session = await engine.createGuestSession()

      expect(session.id).toBeDefined()
      expect(session.id).toMatch(/^sess_/)
      expect(session.isGuest).toBe(true)
      expect(session.customerId).toBeUndefined()
      expect(session.createdAt).toBeInstanceOf(Date)
      expect(session.lastActivityAt).toBeInstanceOf(Date)
    })

    it('should create a guest session with TTL', async () => {
      const sessionTTL = 30 * 60 * 1000 // 30 minutes
      const engineWithTTL = createTestEngine({ sessionTTL })

      const session = await engineWithTTL.createGuestSession()

      expect(session.expiresAt).toBeInstanceOf(Date)
      expect(session.expiresAt!.getTime()).toBeGreaterThan(Date.now())
    })

    it('should create an authenticated session', async () => {
      const session = await engine.getOrCreateAuthenticatedSession('cust_123')

      expect(session.id).toBeDefined()
      expect(session.isGuest).toBe(false)
      expect(session.customerId).toBe('cust_123')
    })

    it('should return same session for same customer', async () => {
      const session1 = await engine.getOrCreateAuthenticatedSession('cust_456')
      const session2 = await engine.getOrCreateAuthenticatedSession('cust_456')

      expect(session1.id).toBe(session2.id)
    })

    it('should get session by id', async () => {
      const created = await engine.createGuestSession()

      const retrieved = await engine.getSession(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should return null for non-existent session', async () => {
      const result = await engine.getSession('nonexistent')
      expect(result).toBeNull()
    })

    it('should return null for expired session', async () => {
      vi.useFakeTimers()
      const sessionTTL = 30 * 60 * 1000
      const engineWithTTL = createTestEngine({ sessionTTL })

      const session = await engineWithTTL.createGuestSession()

      vi.advanceTimersByTime(sessionTTL + 1000)

      const result = await engineWithTTL.getSession(session.id)
      expect(result).toBeNull()

      vi.useRealTimers()
    })

    it('should logout and invalidate session', async () => {
      const session = await engine.getOrCreateAuthenticatedSession('cust_logout')

      await engine.logout(session.id)

      const result = await engine.getSession(session.id)
      expect(result).toBeNull()
    })
  })

  // =============================================================================
  // Guest Cart Tests
  // =============================================================================

  describe('guest carts', () => {
    let engine: CartEngine

    beforeEach(async () => {
      engine = createTestEngine()
      await setupEngineWithStock(engine, 'var_1', 100)
      await setupEngineWithStock(engine, 'var_2', 50)
    })

    it('should create cart for guest session', async () => {
      const session = await engine.createGuestSession()

      const cart = await engine.getOrCreateCart(session.id)

      expect(cart).not.toBeNull()
      expect(cart.id).toBeDefined()
      expect(cart.items).toEqual([])
    })

    it('should return same cart for same session', async () => {
      const session = await engine.createGuestSession()

      const cart1 = await engine.getOrCreateCart(session.id)
      const cart2 = await engine.getOrCreateCart(session.id)

      expect(cart1.id).toBe(cart2.id)
    })

    it('should add items to guest cart', async () => {
      const session = await engine.createGuestSession()

      const item = await engine.addItem(session.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 2,
        price: 1000,
        name: 'Test Product',
      })

      expect(item.id).toBeDefined()
      expect(item.quantity).toBe(2)

      const cart = await engine.getCart(session.id)
      expect(cart?.items).toHaveLength(1)
      expect(cart?.subtotal).toBe(2000)
    })

    it('should return null for cart when no items added', async () => {
      const session = await engine.createGuestSession()

      const cart = await engine.getCart(session.id)

      expect(cart).toBeNull()
    })
  })

  // =============================================================================
  // Authenticated Cart Tests
  // =============================================================================

  describe('authenticated carts', () => {
    let engine: CartEngine

    beforeEach(async () => {
      engine = createTestEngine()
      await setupEngineWithStock(engine, 'var_1', 100)
    })

    it('should create cart for authenticated session', async () => {
      const session = await engine.getOrCreateAuthenticatedSession('cust_auth')

      const cart = await engine.getOrCreateCart(session.id)

      expect(cart).not.toBeNull()
      expect(cart.customerId).toBe('cust_auth')
    })

    it('should persist cart across sessions for same customer', async () => {
      // First session
      const session1 = await engine.getOrCreateAuthenticatedSession('cust_persist')
      await engine.addItem(session1.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 2,
        price: 1000,
      })
      const cart1 = await engine.getCart(session1.id)

      // Simulate logout and new login
      await engine.logout(session1.id)
      const session2 = await engine.getOrCreateAuthenticatedSession('cust_persist')

      const cart2 = await engine.getCart(session2.id)

      expect(cart2?.id).toBe(cart1?.id)
      expect(cart2?.items).toHaveLength(1)
    })
  })

  // =============================================================================
  // Cart Merge on Login Tests
  // =============================================================================

  describe('cart merge on login', () => {
    let engine: CartEngine

    beforeEach(async () => {
      engine = createTestEngine()
      await setupEngineWithStock(engine, 'var_1', 100)
      await setupEngineWithStock(engine, 'var_2', 100)
      await setupEngineWithStock(engine, 'var_3', 100)
    })

    it('should merge guest cart into customer cart on login', async () => {
      // Guest adds items
      const guestSession = await engine.createGuestSession()
      await engine.addItem(guestSession.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 1,
        price: 1000,
      })

      // Customer already has items
      const authSession = await engine.getOrCreateAuthenticatedSession('cust_merge')
      await engine.addItem(authSession.id, {
        productId: 'prod_2',
        variantId: 'var_2',
        quantity: 2,
        price: 2000,
      })

      // Login with guest session
      const result = await engine.login(guestSession.id, 'cust_merge')

      expect(result.merged).toBe(true)
      expect(result.cart?.items).toHaveLength(2)
      expect(result.cart?.subtotal).toBe(5000) // 1000 + (2 * 2000)
      expect(result.mergeDetails?.guestItemCount).toBe(1)
      expect(result.mergeDetails?.customerItemCount).toBe(2)
      expect(result.mergeDetails?.mergedItemCount).toBe(3)
    })

    it('should combine quantities for same item during merge', async () => {
      // Guest adds item
      const guestSession = await engine.createGuestSession()
      await engine.addItem(guestSession.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 2,
        price: 1000,
      })

      // Customer has same item
      const authSession = await engine.getOrCreateAuthenticatedSession('cust_combine')
      await engine.addItem(authSession.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 3,
        price: 1000,
      })

      // Login
      const result = await engine.login(guestSession.id, 'cust_combine')

      expect(result.cart?.items).toHaveLength(1)
      expect(result.cart?.items[0].quantity).toBe(5)
    })

    it('should delete guest session after merge', async () => {
      const guestSession = await engine.createGuestSession()
      await engine.addItem(guestSession.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 1,
        price: 1000,
      })

      await engine.login(guestSession.id, 'cust_delete_guest')

      const result = await engine.getSession(guestSession.id)
      expect(result).toBeNull()
    })

    it('should not merge when guest cart is empty', async () => {
      const guestSession = await engine.createGuestSession()
      // Guest session with no cart

      const result = await engine.login(guestSession.id, 'cust_empty_guest')

      expect(result.merged).toBe(false)
    })

    it('should create customer cart if none exists during login', async () => {
      const guestSession = await engine.createGuestSession()
      await engine.addItem(guestSession.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 1,
        price: 1000,
      })

      const result = await engine.login(guestSession.id, 'cust_new')

      expect(result.merged).toBe(true)
      expect(result.cart).not.toBeNull()
      expect(result.cart?.items).toHaveLength(1)
    })

    it('should trigger onCartMerged callback', async () => {
      const onCartMerged = vi.fn()
      const engineWithCallback = createTestEngine({ onCartMerged })
      await setupEngineWithStock(engineWithCallback, 'var_1', 100)

      const guestSession = await engineWithCallback.createGuestSession()
      await engineWithCallback.addItem(guestSession.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 1,
        price: 1000,
      })

      await engineWithCallback.login(guestSession.id, 'cust_callback')

      expect(onCartMerged).toHaveBeenCalled()
    })
  })

  // =============================================================================
  // Automatic Inventory Reservation Tests
  // =============================================================================

  describe('automatic inventory reservation', () => {
    let engine: CartEngine

    beforeEach(async () => {
      engine = createTestEngine()
      await setupEngineWithStock(engine, 'var_1', 10)
      await setupEngineWithStock(engine, 'var_2', 5)
    })

    it('should reserve inventory when adding item to cart', async () => {
      const session = await engine.createGuestSession()

      await engine.addItem(session.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 3,
        price: 1000,
      })

      const availableStock = await engine.getStock('var_1')
      expect(availableStock).toBe(7) // 10 - 3 reserved
    })

    it('should throw when insufficient inventory', async () => {
      const session = await engine.createGuestSession()

      await expect(
        engine.addItem(session.id, {
          productId: 'prod_1',
          variantId: 'var_1',
          quantity: 15, // More than available
          price: 1000,
        })
      ).rejects.toThrow('Insufficient inventory')
    })

    it('should release inventory when removing item from cart', async () => {
      const session = await engine.createGuestSession()

      const item = await engine.addItem(session.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 3,
        price: 1000,
      })

      await engine.removeItem(session.id, item.id)

      const availableStock = await engine.getStock('var_1')
      expect(availableStock).toBe(10) // Fully restored
    })

    it('should release inventory when clearing cart', async () => {
      const session = await engine.createGuestSession()

      await engine.addItem(session.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 3,
        price: 1000,
      })
      await engine.addItem(session.id, {
        productId: 'prod_2',
        variantId: 'var_2',
        quantity: 2,
        price: 500,
      })

      await engine.clearCart(session.id)

      expect(await engine.getStock('var_1')).toBe(10)
      expect(await engine.getStock('var_2')).toBe(5)
    })

    it('should get cart with reservation details', async () => {
      const session = await engine.createGuestSession()

      await engine.addItem(session.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 2,
        price: 1000,
      })

      const cartWithReservations = await engine.getCartWithReservations(session.id)

      expect(cartWithReservations).not.toBeNull()
      expect(cartWithReservations?.reservations).toHaveLength(1)
      expect(cartWithReservations?.reservations[0].variantId).toBe('var_1')
      expect(cartWithReservations?.reservations[0].quantity).toBe(2)
    })

    it('should reserve additional inventory when increasing quantity', async () => {
      const session = await engine.createGuestSession()

      const item = await engine.addItem(session.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 2,
        price: 1000,
      })

      expect(await engine.getStock('var_1')).toBe(8) // 10 - 2

      await engine.updateItemQuantity(session.id, item.id, 5)

      expect(await engine.getStock('var_1')).toBe(5) // 10 - 5
    })

    it('should throw when increasing quantity beyond available', async () => {
      const session = await engine.createGuestSession()

      const item = await engine.addItem(session.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 5,
        price: 1000,
      })

      await expect(
        engine.updateItemQuantity(session.id, item.id, 15)
      ).rejects.toThrow('Insufficient inventory')
    })

    it('should confirm reservations on checkout', async () => {
      const session = await engine.getOrCreateAuthenticatedSession('cust_checkout')

      await engine.addItem(session.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 3,
        price: 1000,
      })

      const inventoryManager = engine.getInventoryManager()
      const levelBefore = await inventoryManager.getInventoryLevel('var_1')
      expect(levelBefore.reserved).toBe(3)
      expect(levelBefore.onHand).toBe(10)

      await engine.checkout(session.id, 'order_123')

      const levelAfter = await inventoryManager.getInventoryLevel('var_1')
      expect(levelAfter.reserved).toBe(0)
      expect(levelAfter.onHand).toBe(7) // 10 - 3 confirmed
    })
  })

  // =============================================================================
  // Cart Expiration Cleanup Tests
  // =============================================================================

  describe('cart expiration cleanup', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('should cleanup expired sessions and release reservations', async () => {
      vi.useFakeTimers()
      const sessionTTL = 30 * 60 * 1000
      const engine = createTestEngine({ sessionTTL })
      await setupEngineWithStock(engine, 'var_1', 100)

      // Create guest session and add items
      const session = await engine.createGuestSession()
      await engine.addItem(session.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 10,
        price: 1000,
      })

      expect(await engine.getStock('var_1')).toBe(90)

      // Advance time past session expiry
      vi.advanceTimersByTime(sessionTTL + 1000)

      await engine.cleanup()

      // Session should be expired
      const expiredSession = await engine.getSession(session.id)
      expect(expiredSession).toBeNull()
    })

    it('should trigger onSessionExpired callback', async () => {
      vi.useFakeTimers()
      const sessionTTL = 30 * 60 * 1000
      const onSessionExpired = vi.fn()
      const engine = createTestEngine({ sessionTTL, onSessionExpired })
      await setupEngineWithStock(engine, 'var_1', 100)

      const session = await engine.createGuestSession()
      await engine.addItem(session.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 5,
        price: 1000,
      })

      vi.advanceTimersByTime(sessionTTL + 1000)

      await engine.cleanup()

      expect(onSessionExpired).toHaveBeenCalledWith(
        expect.objectContaining({ id: session.id })
      )
    })

    it('should cleanup expired reservations', async () => {
      vi.useFakeTimers()
      const reservationTTL = 15 * 60 * 1000
      const engine = createTestEngine({ reservationTTL })
      await setupEngineWithStock(engine, 'var_1', 100)

      const session = await engine.createGuestSession()
      await engine.addItem(session.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 10,
        price: 1000,
      })

      expect(await engine.getStock('var_1')).toBe(90)

      vi.advanceTimersByTime(reservationTTL + 1000)

      const result = await engine.cleanup()

      expect(result.expiredReservations).toBeGreaterThanOrEqual(1)
    })

    it('should return cleanup counts', async () => {
      vi.useFakeTimers()
      const sessionTTL = 30 * 60 * 1000
      const engine = createTestEngine({ sessionTTL })
      await setupEngineWithStock(engine, 'var_1', 100)

      await engine.createGuestSession()
      await engine.createGuestSession()

      vi.advanceTimersByTime(sessionTTL + 1000)

      const result = await engine.cleanup()

      expect(result.expiredSessions).toBe(2)
    })
  })

  // =============================================================================
  // Item Management Tests
  // =============================================================================

  describe('item management', () => {
    let engine: CartEngine
    let sessionId: string

    beforeEach(async () => {
      engine = createTestEngine()
      await setupEngineWithStock(engine, 'var_1', 100)
      await setupEngineWithStock(engine, 'var_2', 50)

      const session = await engine.createGuestSession()
      sessionId = session.id
    })

    it('should add multiple items to cart', async () => {
      await engine.addItem(sessionId, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 2,
        price: 1000,
      })
      await engine.addItem(sessionId, {
        productId: 'prod_2',
        variantId: 'var_2',
        quantity: 3,
        price: 500,
      })

      const cart = await engine.getCart(sessionId)

      expect(cart?.items).toHaveLength(2)
      expect(cart?.subtotal).toBe(3500)
    })

    it('should update item quantity', async () => {
      const item = await engine.addItem(sessionId, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 2,
        price: 1000,
      })

      await engine.updateItemQuantity(sessionId, item.id, 5)

      const cart = await engine.getCart(sessionId)
      expect(cart?.items[0].quantity).toBe(5)
    })

    it('should remove item when quantity set to 0', async () => {
      const item = await engine.addItem(sessionId, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 2,
        price: 1000,
      })

      await engine.updateItemQuantity(sessionId, item.id, 0)

      const cart = await engine.getCart(sessionId)
      expect(cart?.items).toHaveLength(0)
    })

    it('should throw for invalid session', async () => {
      await expect(
        engine.addItem('invalid_session', {
          productId: 'prod_1',
          variantId: 'var_1',
          quantity: 1,
          price: 1000,
        })
      ).rejects.toThrow('Invalid or expired session')
    })

    it('should throw when removing from non-existent cart', async () => {
      await expect(
        engine.removeItem(sessionId, 'item_123')
      ).rejects.toThrow('Cart not found')
    })
  })

  // =============================================================================
  // Checkout Tests
  // =============================================================================

  describe('checkout', () => {
    let engine: CartEngine

    beforeEach(async () => {
      engine = createTestEngine()
      await setupEngineWithStock(engine, 'var_1', 100)
    })

    it('should checkout cart and create snapshot', async () => {
      const session = await engine.getOrCreateAuthenticatedSession('cust_checkout')
      await engine.addItem(session.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 2,
        price: 1000,
      })

      const snapshot = await engine.checkout(session.id, 'order_abc')

      expect(snapshot.status).toBe('converted')
      expect(snapshot.orderId).toBe('order_abc')
      expect(snapshot.convertedAt).toBeInstanceOf(Date)
    })

    it('should clear session cart reference after checkout', async () => {
      const session = await engine.getOrCreateAuthenticatedSession('cust_clear')
      await engine.addItem(session.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 2,
        price: 1000,
      })

      await engine.checkout(session.id, 'order_xyz')

      // Cart should be null for this session now
      const cart = await engine.getCart(session.id)
      expect(cart?.status).toBe('converted')
    })

    it('should throw when checking out empty cart', async () => {
      const session = await engine.createGuestSession()

      await expect(engine.checkout(session.id, 'order_empty')).rejects.toThrow()
    })
  })

  // =============================================================================
  // Integration Tests
  // =============================================================================

  describe('integration', () => {
    it('should handle complete guest to authenticated flow', async () => {
      const engine = createTestEngine()
      await setupEngineWithStock(engine, 'var_1', 100)
      await setupEngineWithStock(engine, 'var_2', 50)

      // 1. Guest browses and adds to cart
      const guestSession = await engine.createGuestSession()
      await engine.addItem(guestSession.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 2,
        price: 1000,
      })

      // Verify inventory reserved
      expect(await engine.getStock('var_1')).toBe(98)

      // 2. Guest decides to login
      const loginResult = await engine.login(guestSession.id, 'cust_flow')

      expect(loginResult.session.customerId).toBe('cust_flow')
      expect(loginResult.cart?.items).toHaveLength(1)

      // 3. Authenticated user adds more items
      await engine.addItem(loginResult.session.id, {
        productId: 'prod_2',
        variantId: 'var_2',
        quantity: 3,
        price: 500,
      })

      expect(await engine.getStock('var_2')).toBe(47)

      // 4. User checks out
      const snapshot = await engine.checkout(loginResult.session.id, 'order_final')

      expect(snapshot.items).toHaveLength(2)
      expect(snapshot.subtotal).toBe(3500)

      // Verify inventory committed
      const inv1 = await engine.getInventoryManager().getInventoryLevel('var_1')
      const inv2 = await engine.getInventoryManager().getInventoryLevel('var_2')

      expect(inv1.onHand).toBe(98) // 100 - 2
      expect(inv2.onHand).toBe(47) // 50 - 3
    })

    it('should handle concurrent carts for same customer', async () => {
      const engine = createTestEngine()
      await setupEngineWithStock(engine, 'var_1', 100)

      // Customer has existing cart
      const session1 = await engine.getOrCreateAuthenticatedSession('cust_concurrent')
      await engine.addItem(session1.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 5,
        price: 1000,
      })

      // Customer logs in from different device (same customer)
      const session2 = await engine.getOrCreateAuthenticatedSession('cust_concurrent')

      // Should have same cart
      const cart1 = await engine.getCart(session1.id)
      const cart2 = await engine.getCart(session2.id)

      expect(cart1?.id).toBe(cart2?.id)
    })

    it('should maintain reservation through cart merge', async () => {
      const engine = createTestEngine()
      await setupEngineWithStock(engine, 'var_1', 100)

      // Guest reserves inventory
      const guestSession = await engine.createGuestSession()
      await engine.addItem(guestSession.id, {
        productId: 'prod_1',
        variantId: 'var_1',
        quantity: 10,
        price: 1000,
      })

      expect(await engine.getStock('var_1')).toBe(90)

      // Login and merge
      const result = await engine.login(guestSession.id, 'cust_reserve_merge')

      // Inventory should still be reserved
      expect(await engine.getStock('var_1')).toBe(90)

      // Cart should have the reservation
      const cartWithRes = await engine.getCartWithReservations(result.session.id)
      expect(cartWithRes?.reservations.length).toBeGreaterThan(0)
    })
  })
})
