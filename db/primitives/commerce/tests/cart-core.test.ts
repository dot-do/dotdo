/**
 * Shopping Cart Core Tests
 *
 * Comprehensive tests for shopping cart functionality:
 * - Add/remove items
 * - Quantity updates
 * - Cart totals calculation
 * - Discounts and coupons integration
 * - Cart persistence and state
 * - Edge cases and error handling
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createCartManager,
  type CartManager,
  type Cart,
  type CartItem,
} from '../cart'
import { createCartEngine, type CartEngine } from '../cart-engine'
import { createPricingEngine, type PricingEngine } from '../pricing'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestCart() {
  return createCartManager()
}

function createTestEngine() {
  return createCartEngine()
}

async function setupCartWithItems(cartManager: CartManager, cartId: string) {
  await cartManager.addItem(cartId, {
    productId: 'prod-1',
    variantId: 'var-1',
    quantity: 2,
    price: 1000,
    name: 'Test Product 1',
  })
  await cartManager.addItem(cartId, {
    productId: 'prod-2',
    variantId: 'var-2',
    quantity: 1,
    price: 2500,
    name: 'Test Product 2',
  })
  return cartManager.getCart(cartId)
}

// =============================================================================
// Add/Remove Items Tests
// =============================================================================

describe('Cart Add/Remove Items', () => {
  let cartManager: CartManager
  let cartId: string

  beforeEach(async () => {
    cartManager = createTestCart()
    const cart = await cartManager.createCart()
    cartId = cart.id
  })

  describe('adding items', () => {
    it('should add a single item to empty cart', async () => {
      const item = await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1500,
      })

      expect(item).toMatchObject({
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1500,
      })

      const cart = await cartManager.getCart(cartId)
      expect(cart?.items).toHaveLength(1)
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
      await cartManager.addItem(cartId, {
        productId: 'prod-3',
        variantId: 'var-3',
        quantity: 1,
        price: 500,
      })

      const cart = await cartManager.getCart(cartId)
      expect(cart?.items).toHaveLength(3)
      expect(cart?.itemCount).toBe(4) // 1 + 2 + 1
    })

    it('should combine quantities when adding same product+variant', async () => {
      await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 2,
        price: 1000,
      })
      await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 3,
        price: 1000,
      })

      const cart = await cartManager.getCart(cartId)
      expect(cart?.items).toHaveLength(1)
      expect(cart?.items[0].quantity).toBe(5)
    })

    it('should treat same product with different variants as separate items', async () => {
      await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-small',
        quantity: 1,
        price: 1000,
      })
      await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-large',
        quantity: 1,
        price: 1200,
      })

      const cart = await cartManager.getCart(cartId)
      expect(cart?.items).toHaveLength(2)
    })

    it('should preserve item metadata when adding', async () => {
      const item = await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
        name: 'Custom Widget',
        imageUrl: 'https://example.com/widget.jpg',
        metadata: {
          color: 'blue',
          size: 'medium',
          giftWrap: true,
        },
      })

      expect(item.name).toBe('Custom Widget')
      expect(item.imageUrl).toBe('https://example.com/widget.jpg')
      expect(item.metadata).toEqual({
        color: 'blue',
        size: 'medium',
        giftWrap: true,
      })
    })

    it('should reject adding item with zero quantity', async () => {
      await expect(
        cartManager.addItem(cartId, {
          productId: 'prod-1',
          variantId: 'var-1',
          quantity: 0,
          price: 1000,
        })
      ).rejects.toThrow('Invalid quantity')
    })

    it('should reject adding item with negative quantity', async () => {
      await expect(
        cartManager.addItem(cartId, {
          productId: 'prod-1',
          variantId: 'var-1',
          quantity: -5,
          price: 1000,
        })
      ).rejects.toThrow('Invalid quantity')
    })

    it('should generate unique item IDs', async () => {
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

      expect(item1.id).toBeDefined()
      expect(item2.id).toBeDefined()
      expect(item1.id).not.toBe(item2.id)
    })
  })

  describe('removing items', () => {
    it('should remove a specific item by ID', async () => {
      const item1 = await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })
      await cartManager.addItem(cartId, {
        productId: 'prod-2',
        variantId: 'var-2',
        quantity: 1,
        price: 2000,
      })

      await cartManager.removeItem(cartId, item1.id)

      const cart = await cartManager.getCart(cartId)
      expect(cart?.items).toHaveLength(1)
      expect(cart?.items[0].productId).toBe('prod-2')
    })

    it('should handle removing non-existent item gracefully', async () => {
      await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })

      // Removing non-existent item should not throw
      await cartManager.removeItem(cartId, 'non-existent-id')

      const cart = await cartManager.getCart(cartId)
      expect(cart?.items).toHaveLength(1)
    })

    it('should remove item when quantity set to zero', async () => {
      const item = await cartManager.addItem(cartId, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 5,
        price: 1000,
      })

      await cartManager.updateItemQuantity(cartId, item.id, 0)

      const cart = await cartManager.getCart(cartId)
      expect(cart?.items).toHaveLength(0)
    })

    it('should update totals after removing item', async () => {
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
        price: 3000,
      })

      // Total: 2*1000 + 1*3000 = 5000
      let cart = await cartManager.getCart(cartId)
      expect(cart?.subtotal).toBe(5000)

      await cartManager.removeItem(cartId, item1.id)

      cart = await cartManager.getCart(cartId)
      expect(cart?.subtotal).toBe(3000)
      expect(cart?.itemCount).toBe(1)
    })

    it('should clear all items from cart', async () => {
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
        price: 2000,
      })

      await cartManager.clearCart(cartId)

      const cart = await cartManager.getCart(cartId)
      expect(cart?.items).toHaveLength(0)
      expect(cart?.subtotal).toBe(0)
      expect(cart?.itemCount).toBe(0)
    })
  })
})

// =============================================================================
// Quantity Updates Tests
// =============================================================================

describe('Cart Quantity Updates', () => {
  let cartManager: CartManager
  let cartId: string

  beforeEach(async () => {
    cartManager = createTestCart()
    const cart = await cartManager.createCart()
    cartId = cart.id
  })

  it('should increase item quantity', async () => {
    const item = await cartManager.addItem(cartId, {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 2,
      price: 1000,
    })

    await cartManager.updateItemQuantity(cartId, item.id, 5)

    const cart = await cartManager.getCart(cartId)
    expect(cart?.items[0].quantity).toBe(5)
    expect(cart?.subtotal).toBe(5000)
  })

  it('should decrease item quantity', async () => {
    const item = await cartManager.addItem(cartId, {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 10,
      price: 1000,
    })

    await cartManager.updateItemQuantity(cartId, item.id, 3)

    const cart = await cartManager.getCart(cartId)
    expect(cart?.items[0].quantity).toBe(3)
    expect(cart?.subtotal).toBe(3000)
  })

  it('should reject negative quantity update', async () => {
    const item = await cartManager.addItem(cartId, {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 5,
      price: 1000,
    })

    await expect(
      cartManager.updateItemQuantity(cartId, item.id, -2)
    ).rejects.toThrow('Invalid quantity')
  })

  it('should throw when updating non-existent item', async () => {
    await cartManager.addItem(cartId, {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 1,
      price: 1000,
    })

    await expect(
      cartManager.updateItemQuantity(cartId, 'non-existent-id', 5)
    ).rejects.toThrow('Item not found')
  })

  it('should update last activity time on quantity change', async () => {
    const item = await cartManager.addItem(cartId, {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 1,
      price: 1000,
    })

    const cartBefore = await cartManager.getCart(cartId)
    const activityBefore = cartBefore?.lastActivityAt

    // Small delay to ensure time difference
    await new Promise((r) => setTimeout(r, 10))

    await cartManager.updateItemQuantity(cartId, item.id, 5)

    const cartAfter = await cartManager.getCart(cartId)
    expect(cartAfter?.lastActivityAt.getTime()).toBeGreaterThan(
      activityBefore!.getTime()
    )
  })

  describe('quantity limits', () => {
    it('should enforce maximum quantity per item', async () => {
      const cartManagerWithLimits = createCartManager({
        maxQuantityPerItem: 10,
      })
      const cart = await cartManagerWithLimits.createCart()
      const item = await cartManagerWithLimits.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 5,
        price: 1000,
      })

      await expect(
        cartManagerWithLimits.updateItemQuantity(cart.id, item.id, 15)
      ).rejects.toThrow('Maximum quantity exceeded')

      // Original quantity should be preserved
      const updatedCart = await cartManagerWithLimits.getCart(cart.id)
      expect(updatedCart?.items[0].quantity).toBe(5)
    })

    it('should enforce quantity limit when combining items', async () => {
      const cartManagerWithLimits = createCartManager({
        maxQuantityPerItem: 10,
      })
      const cart = await cartManagerWithLimits.createCart()

      await cartManagerWithLimits.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 8,
        price: 1000,
      })

      // Adding more of the same should fail if it exceeds limit
      await expect(
        cartManagerWithLimits.addItem(cart.id, {
          productId: 'prod-1',
          variantId: 'var-1',
          quantity: 5,
          price: 1000,
        })
      ).rejects.toThrow('Maximum quantity exceeded')
    })
  })
})

// =============================================================================
// Cart Totals Tests
// =============================================================================

describe('Cart Totals', () => {
  let cartManager: CartManager
  let cartId: string

  beforeEach(async () => {
    cartManager = createTestCart()
    const cart = await cartManager.createCart()
    cartId = cart.id
  })

  it('should calculate subtotal correctly', async () => {
    await cartManager.addItem(cartId, {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 3,
      price: 1000, // 3 * 1000 = 3000
    })
    await cartManager.addItem(cartId, {
      productId: 'prod-2',
      variantId: 'var-2',
      quantity: 2,
      price: 2500, // 2 * 2500 = 5000
    })

    const cart = await cartManager.getCart(cartId)
    expect(cart?.subtotal).toBe(8000)
  })

  it('should calculate item count as total quantity', async () => {
    await cartManager.addItem(cartId, {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 3,
      price: 1000,
    })
    await cartManager.addItem(cartId, {
      productId: 'prod-2',
      variantId: 'var-2',
      quantity: 2,
      price: 2500,
    })

    const cart = await cartManager.getCart(cartId)
    expect(cart?.itemCount).toBe(5) // 3 + 2
    expect(cart?.items).toHaveLength(2) // 2 line items
  })

  it('should handle large quantities without overflow', async () => {
    await cartManager.addItem(cartId, {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 1000,
      price: 99999,
    })

    const cart = await cartManager.getCart(cartId)
    expect(cart?.subtotal).toBe(99999000)
  })

  it('should recalculate totals after every modification', async () => {
    // Add first item
    const item1 = await cartManager.addItem(cartId, {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 2,
      price: 1000,
    })

    let cart = await cartManager.getCart(cartId)
    expect(cart?.subtotal).toBe(2000)

    // Add second item
    await cartManager.addItem(cartId, {
      productId: 'prod-2',
      variantId: 'var-2',
      quantity: 1,
      price: 3000,
    })

    cart = await cartManager.getCart(cartId)
    expect(cart?.subtotal).toBe(5000)

    // Update quantity
    await cartManager.updateItemQuantity(cartId, item1.id, 5)

    cart = await cartManager.getCart(cartId)
    expect(cart?.subtotal).toBe(8000) // 5*1000 + 1*3000

    // Remove item
    await cartManager.removeItem(cartId, item1.id)

    cart = await cartManager.getCart(cartId)
    expect(cart?.subtotal).toBe(3000)
  })

  it('should have zero subtotal for empty cart', async () => {
    const cart = await cartManager.getCart(cartId)
    expect(cart?.subtotal).toBe(0)
    expect(cart?.itemCount).toBe(0)
  })

  it('should enforce maximum cart total', async () => {
    const cartManagerWithLimit = createCartManager({
      maxCartTotal: 10000,
    })
    const cart = await cartManagerWithLimit.createCart()

    await cartManagerWithLimit.addItem(cart.id, {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 1,
      price: 8000,
    })

    await expect(
      cartManagerWithLimit.addItem(cart.id, {
        productId: 'prod-2',
        variantId: 'var-2',
        quantity: 1,
        price: 5000,
      })
    ).rejects.toThrow('Cart total limit exceeded')

    // Cart should remain unchanged
    const updatedCart = await cartManagerWithLimit.getCart(cart.id)
    expect(updatedCart?.subtotal).toBe(8000)
  })
})

// =============================================================================
// Discounts and Coupons Tests
// =============================================================================

describe('Cart with Discounts and Coupons', () => {
  let pricingEngine: PricingEngine

  beforeEach(() => {
    pricingEngine = createPricingEngine()
  })

  describe('discount codes', () => {
    it('should apply percentage discount code to cart total', async () => {
      await pricingEngine.createDiscountCode({
        code: 'SAVE20',
        type: 'percentage',
        value: 20,
      })

      const result = await pricingEngine.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 5000, quantity: 2 },
        ],
        discountCode: 'SAVE20',
      })

      expect(result.subtotal).toBe(10000)
      expect(result.discount).toBe(2000) // 20% of 10000
      expect(result.total).toBe(8000)
      expect(result.appliedCode?.code).toBe('SAVE20')
    })

    it('should apply fixed amount discount code', async () => {
      await pricingEngine.createDiscountCode({
        code: 'FLAT500',
        type: 'fixed',
        value: 500,
      })

      const result = await pricingEngine.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 3000, quantity: 1 },
        ],
        discountCode: 'FLAT500',
      })

      expect(result.discount).toBe(500)
      expect(result.total).toBe(2500)
    })

    it('should enforce minimum purchase requirement', async () => {
      await pricingEngine.createDiscountCode({
        code: 'MIN100',
        type: 'percentage',
        value: 10,
        minimumPurchase: 10000,
      })

      const result = await pricingEngine.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 5000, quantity: 1 },
        ],
        discountCode: 'MIN100',
      })

      expect(result.codeError).toContain('Minimum purchase')
      expect(result.appliedCode).toBeUndefined()
    })

    it('should reject expired discount code', async () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)

      await pricingEngine.createDiscountCode({
        code: 'EXPIRED',
        type: 'percentage',
        value: 15,
        expiresAt: yesterday,
      })

      const result = await pricingEngine.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 5000, quantity: 1 },
        ],
        discountCode: 'EXPIRED',
      })

      expect(result.codeError).toBe('Discount code has expired')
    })

    it('should reject code that is not yet active', async () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)

      await pricingEngine.createDiscountCode({
        code: 'FUTURE',
        type: 'percentage',
        value: 10,
        startsAt: tomorrow,
      })

      const result = await pricingEngine.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 5000, quantity: 1 },
        ],
        discountCode: 'FUTURE',
      })

      expect(result.codeError).toBe('Discount code is not yet active')
    })

    it('should enforce usage limit', async () => {
      const code = await pricingEngine.createDiscountCode({
        code: 'LIMITED',
        type: 'percentage',
        value: 10,
        usageLimit: 2,
      })

      // Use the code twice
      await pricingEngine.redeemCode('LIMITED', 'order-1')
      await pricingEngine.redeemCode('LIMITED', 'order-2')

      const result = await pricingEngine.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 5000, quantity: 1 },
        ],
        discountCode: 'LIMITED',
      })

      expect(result.codeError).toBe('Discount code usage limit reached')
    })

    it('should enforce per-customer usage limit', async () => {
      await pricingEngine.createDiscountCode({
        code: 'ONCE',
        type: 'percentage',
        value: 20,
        usageLimitPerCustomer: 1,
      })

      // Customer uses the code once
      await pricingEngine.redeemCode('ONCE', 'order-1', 'customer-123')

      const result = await pricingEngine.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 5000, quantity: 1 },
        ],
        discountCode: 'ONCE',
        customerId: 'customer-123',
      })

      expect(result.codeError).toBe('You have already used this discount code')
    })

    it('should be case insensitive for discount codes', async () => {
      await pricingEngine.createDiscountCode({
        code: 'SUMMER',
        type: 'percentage',
        value: 15,
      })

      const result = await pricingEngine.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 10000, quantity: 1 },
        ],
        discountCode: 'summer', // lowercase
      })

      expect(result.appliedCode?.code).toBe('SUMMER')
      expect(result.discount).toBe(1500)
    })
  })

  describe('price rules', () => {
    it('should apply automatic percentage discount for specific products', async () => {
      await pricingEngine.createRule({
        name: 'Product Sale',
        type: 'percentage',
        value: 10,
        conditions: {
          productIds: ['prod-sale'],
        },
      })

      const result = await pricingEngine.calculatePrice({
        productId: 'prod-sale',
        variantId: 'var-1',
        basePrice: 5000,
        quantity: 1,
      })

      expect(result.discount).toBe(500)
      expect(result.finalPrice).toBe(4500)
    })

    it('should apply cart-level discount based on minimum total', async () => {
      await pricingEngine.createRule({
        name: 'Spend $100 Save 15%',
        type: 'percentage',
        value: 15,
        conditions: {
          minCartTotal: 10000,
        },
      })

      const result = await pricingEngine.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 6000, quantity: 2 },
        ],
      })

      expect(result.subtotal).toBe(12000)
      expect(result.discount).toBe(1800) // 15% of 12000
      expect(result.total).toBe(10200)
    })

    it('should apply first order discount', async () => {
      await pricingEngine.createRule({
        name: 'First Order 10% Off',
        type: 'percentage',
        value: 10,
        conditions: {
          isFirstOrder: true,
        },
      })

      const firstOrderResult = await pricingEngine.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 5000, quantity: 1 },
        ],
        isFirstOrder: true,
      })

      expect(firstOrderResult.discount).toBe(500)

      const repeatOrderResult = await pricingEngine.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 5000, quantity: 1 },
        ],
        isFirstOrder: false,
      })

      expect(repeatOrderResult.discount).toBe(0)
    })

    it('should stack multiple applicable rules', async () => {
      await pricingEngine.createRule({
        name: 'Category Discount',
        type: 'percentage',
        value: 10,
        conditions: {
          categoryIds: ['electronics'],
        },
        stackable: true,
      })

      await pricingEngine.createRule({
        name: 'VIP Discount',
        type: 'percentage',
        value: 5,
        conditions: {
          customerSegments: ['vip'],
        },
        stackable: true,
      })

      const result = await pricingEngine.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 10000,
        quantity: 1,
        categoryIds: ['electronics'],
        customerSegments: ['vip'],
      })

      // First discount: 10000 * 10% = 1000, price = 9000
      // Second discount: 9000 * 5% = 450, price = 8550
      expect(result.appliedRules).toHaveLength(2)
    })
  })

  describe('bulk discounts', () => {
    it('should apply tiered volume discount', async () => {
      await pricingEngine.createBulkDiscount({
        productId: 'prod-bulk',
        tiers: [
          { minQuantity: 5, discount: 5 },
          { minQuantity: 10, discount: 10 },
          { minQuantity: 20, discount: 15 },
        ],
      })

      // 5 items should get 5% off
      let result = await pricingEngine.calculatePrice({
        productId: 'prod-bulk',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 5,
      })
      expect(result.finalPrice).toBe(950)

      // 15 items should get 10% off
      result = await pricingEngine.calculatePrice({
        productId: 'prod-bulk',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 15,
      })
      expect(result.finalPrice).toBe(900)

      // 25 items should get 15% off
      result = await pricingEngine.calculatePrice({
        productId: 'prod-bulk',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 25,
      })
      expect(result.finalPrice).toBe(850)
    })

    it('should apply buy X get Y free discount', async () => {
      await pricingEngine.createBulkDiscount({
        productId: 'prod-bogo',
        type: 'buyXgetY',
        buyQuantity: 2,
        getQuantity: 1,
      })

      const result = await pricingEngine.calculatePrice({
        productId: 'prod-bogo',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 6, // Buy 4, get 2 free
      })

      expect(result.freeItems).toBe(2)
      expect(result.totalPrice).toBe(4000) // Only pay for 4
    })
  })
})

// =============================================================================
// Cart Persistence Tests
// =============================================================================

describe('Cart Persistence', () => {
  let cartManager: CartManager

  beforeEach(() => {
    cartManager = createTestCart()
  })

  describe('cart lifecycle', () => {
    it('should persist cart across multiple operations', async () => {
      const cart = await cartManager.createCart({ customerId: 'cust-123' })

      // Add items
      await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 2,
        price: 1000,
      })

      // Retrieve cart
      let retrieved = await cartManager.getCart(cart.id)
      expect(retrieved?.items).toHaveLength(1)

      // Update quantity
      await cartManager.updateItemQuantity(cart.id, retrieved!.items[0].id, 5)

      // Retrieve again
      retrieved = await cartManager.getCart(cart.id)
      expect(retrieved?.items[0].quantity).toBe(5)
      expect(retrieved?.subtotal).toBe(5000)
    })

    it('should retrieve cart by customer ID', async () => {
      await cartManager.createCart({ customerId: 'customer-abc' })
      await cartManager.createCart({ customerId: 'customer-xyz' })

      const cart = await cartManager.getCartByCustomer('customer-abc')
      expect(cart?.customerId).toBe('customer-abc')
    })

    it('should return null for non-existent cart', async () => {
      const cart = await cartManager.getCart('non-existent-id')
      expect(cart).toBeNull()
    })

    it('should delete cart completely', async () => {
      const cart = await cartManager.createCart()
      await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })

      await cartManager.deleteCart(cart.id)

      const deleted = await cartManager.getCart(cart.id)
      expect(deleted).toBeNull()
    })
  })

  describe('cart notes and attributes', () => {
    it('should persist cart note', async () => {
      const cart = await cartManager.createCart()

      await cartManager.setCartNote(cart.id, 'Please deliver to back door')

      const retrieved = await cartManager.getCart(cart.id)
      expect(retrieved?.note).toBe('Please deliver to back door')
    })

    it('should persist custom attributes', async () => {
      const cart = await cartManager.createCart()

      await cartManager.setCartAttributes(cart.id, {
        referralSource: 'email_campaign',
        preferredShipping: 'express',
        giftOrder: true,
      })

      const retrieved = await cartManager.getCart(cart.id)
      expect(retrieved?.attributes).toEqual({
        referralSource: 'email_campaign',
        preferredShipping: 'express',
        giftOrder: true,
      })
    })

    it('should update individual attributes without losing others', async () => {
      const cart = await cartManager.createCart()

      await cartManager.setCartAttributes(cart.id, {
        key1: 'value1',
        key2: 'value2',
      })

      await cartManager.setCartAttribute(cart.id, 'key3', 'value3')

      const retrieved = await cartManager.getCart(cart.id)
      expect(retrieved?.attributes).toEqual({
        key1: 'value1',
        key2: 'value2',
        key3: 'value3',
      })
    })
  })

  describe('cart conversion', () => {
    it('should mark cart as converted with order ID', async () => {
      const cart = await cartManager.createCart()
      await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })

      const snapshot = await cartManager.markAsConverted(cart.id, 'order-12345')

      expect(snapshot.status).toBe('converted')
      expect(snapshot.orderId).toBe('order-12345')
      expect(snapshot.convertedAt).toBeInstanceOf(Date)
    })

    it('should not allow modifications to converted cart', async () => {
      const cart = await cartManager.createCart()
      await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })

      await cartManager.markAsConverted(cart.id, 'order-123')

      await expect(
        cartManager.addItem(cart.id, {
          productId: 'prod-2',
          variantId: 'var-2',
          quantity: 1,
          price: 2000,
        })
      ).rejects.toThrow('Cannot modify converted cart')
    })

    it('should preserve cart data in snapshot', async () => {
      const cart = await cartManager.createCart({ customerId: 'cust-order' })
      await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 3,
        price: 2000,
      })
      await cartManager.setCartNote(cart.id, 'Test note')

      const snapshot = await cartManager.markAsConverted(cart.id, 'order-456')

      expect(snapshot.items).toHaveLength(1)
      expect(snapshot.subtotal).toBe(6000)
      expect(snapshot.customerId).toBe('cust-order')
      expect(snapshot.note).toBe('Test note')
    })
  })

  describe('cart merge', () => {
    it('should merge guest cart into customer cart', async () => {
      const guestCart = await cartManager.createCart()
      await cartManager.addItem(guestCart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 2,
        price: 1000,
      })

      const customerCart = await cartManager.createCart({ customerId: 'cust-merge' })
      await cartManager.addItem(customerCart.id, {
        productId: 'prod-2',
        variantId: 'var-2',
        quantity: 1,
        price: 3000,
      })

      const merged = await cartManager.mergeCarts(guestCart.id, customerCart.id)

      expect(merged.items).toHaveLength(2)
      expect(merged.subtotal).toBe(5000) // 2*1000 + 1*3000

      // Guest cart should be deleted
      const deletedGuest = await cartManager.getCart(guestCart.id)
      expect(deletedGuest).toBeNull()
    })

    it('should combine quantities when merging same items', async () => {
      const guestCart = await cartManager.createCart()
      await cartManager.addItem(guestCart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 3,
        price: 1000,
      })

      const customerCart = await cartManager.createCart({ customerId: 'cust-combine' })
      await cartManager.addItem(customerCart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 2,
        price: 1000,
      })

      const merged = await cartManager.mergeCarts(guestCart.id, customerCart.id)

      expect(merged.items).toHaveLength(1)
      expect(merged.items[0].quantity).toBe(5)
      expect(merged.subtotal).toBe(5000)
    })
  })
})

// =============================================================================
// Edge Cases Tests
// =============================================================================

describe('Cart Edge Cases', () => {
  let cartManager: CartManager

  beforeEach(() => {
    cartManager = createTestCart()
  })

  describe('error handling', () => {
    it('should throw when operating on non-existent cart', async () => {
      await expect(
        cartManager.addItem('fake-cart-id', {
          productId: 'prod-1',
          variantId: 'var-1',
          quantity: 1,
          price: 1000,
        })
      ).rejects.toThrow('Cart not found')

      await expect(cartManager.clearCart('fake-cart-id')).rejects.toThrow(
        'Cart not found'
      )
    })

    it('should handle items with zero price', async () => {
      const cart = await cartManager.createCart()
      const item = await cartManager.addItem(cart.id, {
        productId: 'free-item',
        variantId: 'var-1',
        quantity: 5,
        price: 0,
      })

      const retrieved = await cartManager.getCart(cart.id)
      expect(retrieved?.subtotal).toBe(0)
      expect(retrieved?.itemCount).toBe(5)
    })

    it('should handle very small prices (cents)', async () => {
      const cart = await cartManager.createCart()
      await cartManager.addItem(cart.id, {
        productId: 'cheap-item',
        variantId: 'var-1',
        quantity: 3,
        price: 1, // 1 cent
      })

      const retrieved = await cartManager.getCart(cart.id)
      expect(retrieved?.subtotal).toBe(3)
    })
  })

  describe('sequential operations', () => {
    it('should handle many sequential additions', async () => {
      const cart = await cartManager.createCart()

      // Add 10 different items sequentially
      for (let i = 0; i < 10; i++) {
        await cartManager.addItem(cart.id, {
          productId: `prod-${i}`,
          variantId: `var-${i}`,
          quantity: 1,
          price: 100 * (i + 1),
        })
      }

      const retrieved = await cartManager.getCart(cart.id)
      expect(retrieved?.items).toHaveLength(10)
      // Sum: 100 + 200 + ... + 1000 = 5500
      expect(retrieved?.subtotal).toBe(5500)
    })

    it('should maintain consistency through multiple operations', async () => {
      const cart = await cartManager.createCart()

      // Add items
      const item1 = await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 2,
        price: 1000,
      })

      // Update quantity
      await cartManager.updateItemQuantity(cart.id, item1.id, 5)

      // Add another item
      await cartManager.addItem(cart.id, {
        productId: 'prod-2',
        variantId: 'var-2',
        quantity: 3,
        price: 500,
      })

      // Remove first item
      await cartManager.removeItem(cart.id, item1.id)

      // Add same product back
      await cartManager.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })

      const retrieved = await cartManager.getCart(cart.id)
      expect(retrieved?.items).toHaveLength(2)
      expect(retrieved?.subtotal).toBe(2500) // 3*500 + 1*1000
    })
  })

  describe('special characters in data', () => {
    it('should handle special characters in item names', async () => {
      const cart = await cartManager.createCart()
      const item = await cartManager.addItem(cart.id, {
        productId: 'prod-special',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
        name: 'Product with "quotes" & <special> chars!',
      })

      expect(item.name).toBe('Product with "quotes" & <special> chars!')
    })

    it('should handle unicode in metadata', async () => {
      const cart = await cartManager.createCart()
      const item = await cartManager.addItem(cart.id, {
        productId: 'prod-unicode',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
        metadata: {
          message: 'Hello! ',
          language: 'Japanese',
        },
      })

      expect(item.metadata?.message).toBe('Hello! ')
    })
  })

  describe('item limits', () => {
    it('should enforce maximum items per cart', async () => {
      const limitedCart = createCartManager({ maxItemsPerCart: 3 })
      const cart = await limitedCart.createCart()

      await limitedCart.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })
      await limitedCart.addItem(cart.id, {
        productId: 'prod-2',
        variantId: 'var-2',
        quantity: 1,
        price: 1000,
      })
      await limitedCart.addItem(cart.id, {
        productId: 'prod-3',
        variantId: 'var-3',
        quantity: 1,
        price: 1000,
      })

      await expect(
        limitedCart.addItem(cart.id, {
          productId: 'prod-4',
          variantId: 'var-4',
          quantity: 1,
          price: 1000,
        })
      ).rejects.toThrow('Maximum items limit reached')
    })

    it('should allow updating existing item when at limit', async () => {
      const limitedCart = createCartManager({ maxItemsPerCart: 2 })
      const cart = await limitedCart.createCart()

      const item = await limitedCart.addItem(cart.id, {
        productId: 'prod-1',
        variantId: 'var-1',
        quantity: 1,
        price: 1000,
      })
      await limitedCart.addItem(cart.id, {
        productId: 'prod-2',
        variantId: 'var-2',
        quantity: 1,
        price: 1000,
      })

      // Should be able to update existing item
      await limitedCart.updateItemQuantity(cart.id, item.id, 5)

      const retrieved = await limitedCart.getCart(cart.id)
      expect(retrieved?.items[0].quantity).toBe(5)
    })
  })
})

// =============================================================================
// Cart Expiration and TTL Tests
// =============================================================================

describe('Cart Expiration', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should set expiration on cart creation', async () => {
    const ttl = 30 * 60 * 1000 // 30 minutes
    const cartManager = createCartManager({ defaultTTL: ttl })

    const cart = await cartManager.createCart()

    expect(cart.expiresAt).toBeInstanceOf(Date)
    expect(cart.expiresAt!.getTime()).toBeGreaterThan(Date.now())
  })

  it('should return null for expired cart', async () => {
    vi.useFakeTimers()
    const ttl = 30 * 60 * 1000
    const cartManager = createCartManager({ defaultTTL: ttl })

    const cart = await cartManager.createCart()

    vi.advanceTimersByTime(ttl + 1000)

    const retrieved = await cartManager.getCart(cart.id)
    expect(retrieved).toBeNull()
  })

  it('should extend TTL on activity when configured', async () => {
    vi.useFakeTimers()
    const ttl = 30 * 60 * 1000
    const cartManager = createCartManager({
      defaultTTL: ttl,
      extendTTLOnActivity: true,
    })

    const cart = await cartManager.createCart()
    const originalExpiry = cart.expiresAt!.getTime()

    vi.advanceTimersByTime(15 * 60 * 1000) // 15 minutes

    await cartManager.addItem(cart.id, {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 1,
      price: 1000,
    })

    const updated = await cartManager.getCart(cart.id)
    expect(updated?.expiresAt!.getTime()).toBeGreaterThan(originalExpiry)
  })

  it('should manually extend cart TTL', async () => {
    const ttl = 30 * 60 * 1000
    const cartManager = createCartManager({ defaultTTL: ttl })

    const cart = await cartManager.createCart()
    const originalExpiry = cart.expiresAt!.getTime()

    const extended = await cartManager.extendCartTTL(cart.id, 60 * 60 * 1000) // Add 1 hour

    expect(extended.expiresAt!.getTime()).toBeGreaterThan(originalExpiry)
  })

  it('should cleanup expired carts', async () => {
    vi.useFakeTimers()
    const ttl = 30 * 60 * 1000
    const cartManager = createCartManager({ defaultTTL: ttl })

    await cartManager.createCart()
    await cartManager.createCart()
    await cartManager.createCart()

    vi.advanceTimersByTime(ttl + 1000)

    const cleanedCount = await cartManager.cleanupExpiredCarts()
    expect(cleanedCount).toBe(3)
  })
})

// =============================================================================
// Abandoned Cart Tests
// =============================================================================

describe('Abandoned Cart Tracking', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should mark cart as abandoned after inactivity threshold', async () => {
    vi.useFakeTimers()
    const threshold = 60 * 60 * 1000 // 1 hour
    const cartManager = createCartManager({ abandonedThreshold: threshold })

    const cart = await cartManager.createCart()
    await cartManager.addItem(cart.id, {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 1,
      price: 1000,
    })

    vi.advanceTimersByTime(threshold + 1000)

    const retrieved = await cartManager.getCart(cart.id)
    expect(retrieved?.status).toBe('abandoned')
  })

  it('should not mark empty carts as abandoned', async () => {
    vi.useFakeTimers()
    const threshold = 60 * 60 * 1000
    const cartManager = createCartManager({ abandonedThreshold: threshold })

    const cart = await cartManager.createCart()

    vi.advanceTimersByTime(threshold + 1000)

    const abandoned = await cartManager.getAbandonedCarts()
    expect(abandoned.find((c) => c.id === cart.id)).toBeUndefined()
  })

  it('should recover abandoned cart', async () => {
    vi.useFakeTimers()
    const threshold = 60 * 60 * 1000
    const cartManager = createCartManager({ abandonedThreshold: threshold })

    const cart = await cartManager.createCart()
    await cartManager.addItem(cart.id, {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 1,
      price: 1000,
    })

    vi.advanceTimersByTime(threshold + 1000)

    let retrieved = await cartManager.getCart(cart.id)
    expect(retrieved?.status).toBe('abandoned')

    await cartManager.recoverCart(cart.id)

    retrieved = await cartManager.getCart(cart.id)
    expect(retrieved?.status).toBe('active')
  })

  it('should trigger callback when cart becomes abandoned', async () => {
    vi.useFakeTimers()
    const threshold = 60 * 60 * 1000
    const onAbandoned = vi.fn()
    const cartManager = createCartManager({
      abandonedThreshold: threshold,
      onCartAbandoned: onAbandoned,
    })

    const cart = await cartManager.createCart()
    await cartManager.addItem(cart.id, {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 1,
      price: 1000,
    })

    vi.advanceTimersByTime(threshold + 1000)

    await cartManager.checkAbandonedCarts()

    expect(onAbandoned).toHaveBeenCalledWith(
      expect.objectContaining({ id: cart.id })
    )
  })
})
