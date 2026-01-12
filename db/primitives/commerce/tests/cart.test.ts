/**
 * Shopping Cart Tests - TDD RED Phase
 *
 * Tests for the shopping cart primitive providing:
 * - Cart creation and management
 * - Item addition/removal with quantity
 * - Cart TTL and expiration
 * - Item limits and validation
 * - Abandoned cart tracking
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createCartManager,
  type CartManager,
  type Cart,
  type CartItem,
  type CartOptions,
} from '../cart'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestCartManager(options?: CartOptions): CartManager {
  return createCartManager(options)
}

// =============================================================================
// Cart Management Tests
// =============================================================================

describe('CartManager', () => {
  describe('cart lifecycle', () => {
    let cartManager: CartManager

    beforeEach(() => {
      cartManager = createTestCartManager()
    })

    it('should create an empty cart', async () => {
      const cart = await cartManager.createCart()

      expect(cart.id).toBeDefined()
      expect(cart.items).toEqual([])
      expect(cart.subtotal).toBe(0)
      expect(cart.createdAt).toBeInstanceOf(Date)
      expect(cart.status).toBe('active')
    })

    it('should create a cart with customer id', async () => {
      const cart = await cartManager.createCart({ customerId: 'cust-123' })

      expect(cart.customerId).toBe('cust-123')
    })

    it('should get a cart by id', async () => {
      const created = await cartManager.createCart()

      const retrieved = await cartManager.getCart(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should return null for non-existent cart', async () => {
      const result = await cartManager.getCart('nonexistent-id')
      expect(result).toBeNull()
    })

    it('should get cart by customer id', async () => {
      await cartManager.createCart({ customerId: 'cust-456' })

      const cart = await cartManager.getCartByCustomer('cust-456')

      expect(cart).not.toBeNull()
      expect(cart?.customerId).toBe('cust-456')
    })

    it('should delete a cart', async () => {
      const cart = await cartManager.createCart()

      await cartManager.deleteCart(cart.id)

      const result = await cartManager.getCart(cart.id)
      expect(result).toBeNull()
    })

    it('should clear all items from cart', async () => {
      const cart = await cartManager.createCart()
      await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 2,
        price: 1000,
      })

      await cartManager.clearCart(cart.id)

      const cleared = await cartManager.getCart(cart.id)
      expect(cleared?.items).toHaveLength(0)
      expect(cleared?.subtotal).toBe(0)
    })

    it('should merge guest cart into customer cart', async () => {
      const guestCart = await cartManager.createCart()
      await cartManager.addItem(guestCart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })

      const customerCart = await cartManager.createCart({ customerId: 'cust-789' })
      await cartManager.addItem(customerCart.id, {
        productId: 'prod-2',
        variantId: 'var-2',
        quantity: 1,
        price: 2000,
      })

      const mergedCart = await cartManager.mergeCarts(guestCart.id, customerCart.id)

      expect(mergedCart.items).toHaveLength(2)
      expect(mergedCart.subtotal).toBe(3000)

      // Guest cart should be deleted
      const guestCartAfter = await cartManager.getCart(guestCart.id)
      expect(guestCartAfter).toBeNull()
    })

    it('should merge duplicate items by combining quantities', async () => {
      const guestCart = await cartManager.createCart()
      await cartManager.addItem(guestCart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 2,
        price: 1000,
      })

      const customerCart = await cartManager.createCart({ customerId: 'cust-merge' })
      await cartManager.addItem(customerCart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 3,
        price: 1000,
      })

      const mergedCart = await cartManager.mergeCarts(guestCart.id, customerCart.id)

      expect(mergedCart.items).toHaveLength(1)
      expect(mergedCart.items[0].quantity).toBe(5)
    })
  })

  // =============================================================================
  // Item Management Tests
  // =============================================================================

  describe('item management', () => {
    let cartManager: CartManager
    let cartId: string

    beforeEach(async () => {
      cartManager = createTestCartManager()
      const cart = await cartManager.createCart()
      cartId = cart.id
    })

    it('should add an item to cart', async () => {
      const item = await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 2999,
        name: 'Test Product',
      })

      expect(item.id).toBeDefined()
      expect(item.productId).toBe('prod-1')
      expect(item.quantity).toBe(1)
      expect(item.price).toBe(2999)

      const cart = await cartManager.getCart(cartId)
      expect(cart?.items).toHaveLength(1)
      expect(cart?.subtotal).toBe(2999)
    })

    it('should add multiple different items', async () => {
      await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })
      await cartManager.addItem(cartId, {
        productId: 'prod-2',
        variantId: 'var-2',
        quantity: 2,
        price: 2000,
      })

      const cart = await cartManager.getCart(cartId)

      expect(cart?.items).toHaveLength(2)
      expect(cart?.subtotal).toBe(5000) // 1000 + (2 * 2000)
    })

    it('should increase quantity when adding same item', async () => {
      await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })
      await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 2,
        price: 1000,
      })

      const cart = await cartManager.getCart(cartId)

      expect(cart?.items).toHaveLength(1)
      expect(cart?.items[0].quantity).toBe(3)
      expect(cart?.subtotal).toBe(3000)
    })

    it('should update item quantity', async () => {
      const item = await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })

      await cartManager.updateItemQuantity(cartId, item.id, 5)

      const cart = await cartManager.getCart(cartId)
      expect(cart?.items[0].quantity).toBe(5)
      expect(cart?.subtotal).toBe(5000)
    })

    it('should remove item when quantity set to 0', async () => {
      const item = await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 2,
        price: 1000,
      })

      await cartManager.updateItemQuantity(cartId, item.id, 0)

      const cart = await cartManager.getCart(cartId)
      expect(cart?.items).toHaveLength(0)
    })

    it('should remove an item from cart', async () => {
      const item1 = await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })
      const item2 = await cartManager.addItem(cartId, {
        productId: 'prod-2',
        variantId: 'var-2',
        quantity: 1,
        price: 2000,
      })

      await cartManager.removeItem(cartId, item1.id)

      const cart = await cartManager.getCart(cartId)
      expect(cart?.items).toHaveLength(1)
      expect(cart?.items[0].productId).toBe('prod-2')
      expect(cart?.subtotal).toBe(2000)
    })

    it('should throw when adding to non-existent cart', async () => {
      await expect(
        cartManager.addItem('nonexistent', {
          productId: 'prod-1',
          variantId: 'var-1',
          quantity: 1,
          price: 1000,
        })
      ).rejects.toThrow('Cart not found')
    })

    it('should throw for invalid quantity', async () => {
      await expect(
        cartManager.addItem(cartId, {
          productId: 'prod-1',
          variantId: 'var-1',
          quantity: -1,
          price: 1000,
        })
      ).rejects.toThrow('Invalid quantity')

      await expect(
        cartManager.addItem(cartId, {
          productId: 'prod-1',
          variantId: 'var-1',
          quantity: 0,
          price: 1000,
        })
      ).rejects.toThrow('Invalid quantity')
    })

    it('should store item metadata', async () => {
      const item = await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
        name: 'Custom Product',
        imageUrl: 'https://example.com/image.jpg',
        metadata: { giftMessage: 'Happy Birthday!' },
      })

      expect(item.name).toBe('Custom Product')
      expect(item.imageUrl).toBe('https://example.com/image.jpg')
      expect(item.metadata?.giftMessage).toBe('Happy Birthday!')
    })
  })

  // =============================================================================
  // Item Limits Tests
  // =============================================================================

  describe('item limits', () => {
    it('should enforce maximum items per cart', async () => {
      const cartManager = createTestCartManager({ maxItemsPerCart: 3 })
      const cart = await cartManager.createCart()

      await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })
      await cartManager.addItem(cart.id, {
        productId: 'prod-2',
        variantId: 'var-2',
        quantity: 1,
        price: 1000,
      })
      await cartManager.addItem(cart.id, {
        productId: 'prod-3',
        variantId: 'var-3',
        quantity: 1,
        price: 1000,
      })

      await expect(
        cartManager.addItem(cart.id, {
          productId: 'prod-4',
          variantId: 'var-4',
          quantity: 1,
          price: 1000,
        })
      ).rejects.toThrow('Maximum items limit reached')
    })

    it('should enforce maximum quantity per item', async () => {
      const cartManager = createTestCartManager({ maxQuantityPerItem: 5 })
      const cart = await cartManager.createCart()

      await expect(
        cartManager.addItem(cart.id, {
          productId: 'prod-1',
          variantId: 'var-1',
          quantity: 10,
          price: 1000,
        })
      ).rejects.toThrow('Maximum quantity exceeded')
    })

    it('should enforce maximum quantity when updating', async () => {
      const cartManager = createTestCartManager({ maxQuantityPerItem: 5 })
      const cart = await cartManager.createCart()

      const item = await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 3,
        price: 1000,
      })

      await expect(
        cartManager.updateItemQuantity(cart.id, item.id, 10)
      ).rejects.toThrow('Maximum quantity exceeded')
    })

    it('should enforce maximum cart total', async () => {
      const cartManager = createTestCartManager({ maxCartTotal: 10000 })
      const cart = await cartManager.createCart()

      await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 8000,
      })

      await expect(
        cartManager.addItem(cart.id, {
          productId: 'prod-2',
          variantId: 'var-2',
          quantity: 1,
          price: 5000,
        })
      ).rejects.toThrow('Cart total limit exceeded')
    })
  })

  // =============================================================================
  // Cart TTL and Expiration Tests
  // =============================================================================

  describe('cart TTL and expiration', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('should set expiration time on cart creation', async () => {
      const ttlMs = 30 * 60 * 1000 // 30 minutes
      const cartManager = createTestCartManager({ defaultTTL: ttlMs })

      const cart = await cartManager.createCart()

      expect(cart.expiresAt).toBeInstanceOf(Date)
      expect(cart.expiresAt!.getTime()).toBeGreaterThan(Date.now())
    })

    it('should return null for expired cart', async () => {
      vi.useFakeTimers()
      const ttlMs = 30 * 60 * 1000 // 30 minutes
      const cartManager = createTestCartManager({ defaultTTL: ttlMs })

      const cart = await cartManager.createCart()

      // Advance time past TTL
      vi.advanceTimersByTime(ttlMs + 1000)

      const result = await cartManager.getCart(cart.id)
      expect(result).toBeNull()
    })

    it('should extend cart TTL on activity', async () => {
      vi.useFakeTimers()
      const ttlMs = 30 * 60 * 1000 // 30 minutes
      const cartManager = createTestCartManager({
        defaultTTL: ttlMs,
        extendTTLOnActivity: true,
      })

      const cart = await cartManager.createCart()
      const originalExpiry = cart.expiresAt!.getTime()

      // Advance time by 15 minutes
      vi.advanceTimersByTime(15 * 60 * 1000)

      // Add an item (activity)
      await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })

      const updatedCart = await cartManager.getCart(cart.id)
      expect(updatedCart?.expiresAt!.getTime()).toBeGreaterThan(originalExpiry)
    })

    it('should manually extend cart TTL', async () => {
      const ttlMs = 30 * 60 * 1000 // 30 minutes
      const cartManager = createTestCartManager({ defaultTTL: ttlMs })

      const cart = await cartManager.createCart()
      const originalExpiry = cart.expiresAt!.getTime()

      const extended = await cartManager.extendCartTTL(cart.id, 60 * 60 * 1000) // 1 hour

      expect(extended.expiresAt!.getTime()).toBeGreaterThan(originalExpiry)
    })

    it('should cleanup expired carts', async () => {
      vi.useFakeTimers()
      const ttlMs = 30 * 60 * 1000
      const cartManager = createTestCartManager({ defaultTTL: ttlMs })

      await cartManager.createCart()
      await cartManager.createCart()
      await cartManager.createCart()

      // Advance time past TTL
      vi.advanceTimersByTime(ttlMs + 1000)

      const cleanupCount = await cartManager.cleanupExpiredCarts()

      expect(cleanupCount).toBe(3)
    })
  })

  // =============================================================================
  // Abandoned Cart Tracking Tests
  // =============================================================================

  describe('abandoned cart tracking', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('should mark cart as abandoned after inactivity', async () => {
      vi.useFakeTimers()
      const abandonedThreshold = 60 * 60 * 1000 // 1 hour
      const cartManager = createTestCartManager({ abandonedThreshold })

      const cart = await cartManager.createCart({ customerId: 'cust-abandoned' })
      await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })

      // Advance time past abandoned threshold
      vi.advanceTimersByTime(abandonedThreshold + 1000)

      const updatedCart = await cartManager.getCart(cart.id)
      expect(updatedCart?.status).toBe('abandoned')
    })

    it('should get list of abandoned carts', async () => {
      vi.useFakeTimers()
      const abandonedThreshold = 60 * 60 * 1000
      const cartManager = createTestCartManager({ abandonedThreshold })

      // Create carts with items
      const cart1 = await cartManager.createCart({ customerId: 'cust-1' })
      await cartManager.addItem(cart1.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })

      const cart2 = await cartManager.createCart({ customerId: 'cust-2' })
      await cartManager.addItem(cart2.id, {
        productId: 'prod-2',
        variantId: 'var-2',
        quantity: 2,
        price: 2000,
      })

      // Advance time
      vi.advanceTimersByTime(abandonedThreshold + 1000)

      const abandonedCarts = await cartManager.getAbandonedCarts()

      expect(abandonedCarts).toHaveLength(2)
    })

    it('should not mark empty carts as abandoned', async () => {
      vi.useFakeTimers()
      const abandonedThreshold = 60 * 60 * 1000
      const cartManager = createTestCartManager({ abandonedThreshold })

      const cart = await cartManager.createCart({ customerId: 'cust-empty' })

      // Advance time
      vi.advanceTimersByTime(abandonedThreshold + 1000)

      const abandonedCarts = await cartManager.getAbandonedCarts()
      expect(abandonedCarts.find((c) => c.id === cart.id)).toBeUndefined()
    })

    it('should track last activity time', async () => {
      const cartManager = createTestCartManager()
      const cart = await cartManager.createCart()

      const initialActivity = cart.lastActivityAt

      // Wait a bit then add item
      await new Promise((r) => setTimeout(r, 10))
      await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })

      const updatedCart = await cartManager.getCart(cart.id)
      expect(updatedCart?.lastActivityAt.getTime()).toBeGreaterThan(initialActivity.getTime())
    })

    it('should recover abandoned cart', async () => {
      vi.useFakeTimers()
      const abandonedThreshold = 60 * 60 * 1000
      const cartManager = createTestCartManager({ abandonedThreshold })

      const cart = await cartManager.createCart({ customerId: 'cust-recover' })
      await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })

      // Mark as abandoned
      vi.advanceTimersByTime(abandonedThreshold + 1000)
      let updatedCart = await cartManager.getCart(cart.id)
      expect(updatedCart?.status).toBe('abandoned')

      // Recover
      await cartManager.recoverCart(cart.id)

      updatedCart = await cartManager.getCart(cart.id)
      expect(updatedCart?.status).toBe('active')
    })

    it('should trigger abandoned cart callback', async () => {
      vi.useFakeTimers()
      const abandonedThreshold = 60 * 60 * 1000
      const onCartAbandoned = vi.fn()

      const cartManager = createTestCartManager({
        abandonedThreshold,
        onCartAbandoned,
      })

      const cart = await cartManager.createCart({ customerId: 'cust-callback' })
      await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })

      vi.advanceTimersByTime(abandonedThreshold + 1000)

      // Trigger check
      await cartManager.checkAbandonedCarts()

      expect(onCartAbandoned).toHaveBeenCalledWith(
        expect.objectContaining({ id: cart.id })
      )
    })
  })

  // =============================================================================
  // Cart Totals and Calculations Tests
  // =============================================================================

  describe('cart totals and calculations', () => {
    let cartManager: CartManager
    let cartId: string

    beforeEach(async () => {
      cartManager = createTestCartManager()
      const cart = await cartManager.createCart()
      cartId = cart.id
    })

    it('should calculate subtotal correctly', async () => {
      await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 2,
        price: 1000,
      })
      await cartManager.addItem(cartId, {
        productId: 'prod-2',
        variantId: 'var-2',
        quantity: 3,
        price: 500,
      })

      const cart = await cartManager.getCart(cartId)

      expect(cart?.subtotal).toBe(3500) // (2 * 1000) + (3 * 500)
    })

    it('should get item count', async () => {
      await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 2,
        price: 1000,
      })
      await cartManager.addItem(cartId, {
        productId: 'prod-2',
        variantId: 'var-2',
        quantity: 3,
        price: 500,
      })

      const cart = await cartManager.getCart(cartId)

      expect(cart?.itemCount).toBe(5) // 2 + 3
      expect(cart?.items).toHaveLength(2) // 2 line items
    })

    it('should recalculate totals after item removal', async () => {
      const item1 = await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 2,
        price: 1000,
      })
      await cartManager.addItem(cartId, {
        productId: 'prod-2',
        variantId: 'var-2',
        quantity: 1,
        price: 500,
      })

      await cartManager.removeItem(cartId, item1.id)

      const cart = await cartManager.getCart(cartId)
      expect(cart?.subtotal).toBe(500)
      expect(cart?.itemCount).toBe(1)
    })

    it('should update totals when quantity changes', async () => {
      const item = await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })

      await cartManager.updateItemQuantity(cartId, item.id, 5)

      const cart = await cartManager.getCart(cartId)
      expect(cart?.subtotal).toBe(5000)
    })
  })

  // =============================================================================
  // Cart Checkout Conversion Tests
  // =============================================================================

  describe('cart checkout conversion', () => {
    let cartManager: CartManager
    let cartId: string

    beforeEach(async () => {
      cartManager = createTestCartManager()
      const cart = await cartManager.createCart({ customerId: 'checkout-cust' })
      cartId = cart.id
      await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })
    })

    it('should mark cart as converted', async () => {
      await cartManager.markAsConverted(cartId, 'order-123')

      const cart = await cartManager.getCart(cartId)
      expect(cart?.status).toBe('converted')
      expect(cart?.orderId).toBe('order-123')
    })

    it('should not allow modifications to converted cart', async () => {
      await cartManager.markAsConverted(cartId, 'order-123')

      await expect(
        cartManager.addItem(cartId, {
          productId: 'prod-2',
          variantId: 'var-2',
          quantity: 1,
          price: 500,
        })
      ).rejects.toThrow('Cannot modify converted cart')
    })

    it('should get cart snapshot at conversion', async () => {
      const snapshot = await cartManager.markAsConverted(cartId, 'order-456')

      expect(snapshot.items).toHaveLength(1)
      expect(snapshot.subtotal).toBe(1000)
      expect(snapshot.convertedAt).toBeInstanceOf(Date)
    })
  })

  // =============================================================================
  // Notes and Custom Data Tests
  // =============================================================================

  describe('notes and custom data', () => {
    let cartManager: CartManager
    let cartId: string

    beforeEach(async () => {
      cartManager = createTestCartManager()
      const cart = await cartManager.createCart()
      cartId = cart.id
    })

    it('should add note to cart', async () => {
      await cartManager.setCartNote(cartId, 'Please gift wrap this order')

      const cart = await cartManager.getCart(cartId)
      expect(cart?.note).toBe('Please gift wrap this order')
    })

    it('should set custom attributes on cart', async () => {
      await cartManager.setCartAttributes(cartId, {
        referralCode: 'FRIEND10',
        preferredDeliveryDate: '2024-12-25',
      })

      const cart = await cartManager.getCart(cartId)
      expect(cart?.attributes?.referralCode).toBe('FRIEND10')
    })

    it('should update individual attribute', async () => {
      await cartManager.setCartAttributes(cartId, { key1: 'value1' })
      await cartManager.setCartAttribute(cartId, 'key2', 'value2')

      const cart = await cartManager.getCart(cartId)
      expect(cart?.attributes?.key1).toBe('value1')
      expect(cart?.attributes?.key2).toBe('value2')
    })
  })
})
