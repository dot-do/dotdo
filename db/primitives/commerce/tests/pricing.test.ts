/**
 * Pricing Engine Tests - TDD RED Phase
 *
 * Tests for the pricing primitive providing:
 * - Dynamic pricing rules
 * - Discount codes and promotions
 * - Bulk/volume discounts
 * - Time-based pricing
 * - Customer segment pricing
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createPricingEngine,
  type PricingEngine,
  type PriceRule,
  type Discount,
  type DiscountCode,
  type PricingContext,
  type PricingResult,
  type BulkDiscount,
  type CustomerSegment,
} from '../pricing'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestPricingEngine(): PricingEngine {
  return createPricingEngine()
}

// =============================================================================
// Basic Pricing Tests
// =============================================================================

describe('PricingEngine', () => {
  describe('basic pricing', () => {
    let pricing: PricingEngine

    beforeEach(() => {
      pricing = createTestPricingEngine()
    })

    it('should return base price when no rules apply', async () => {
      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 2999,
        quantity: 1,
      })

      expect(result.finalPrice).toBe(2999)
      expect(result.appliedRules).toHaveLength(0)
    })

    it('should calculate total for quantity', async () => {
      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 2999,
        quantity: 3,
      })

      expect(result.unitPrice).toBe(2999)
      expect(result.totalPrice).toBe(8997)
    })

    it('should calculate cart total', async () => {
      const result = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 1000, quantity: 2 },
          { productId: 'prod-2', variantId: 'var-2', basePrice: 500, quantity: 3 },
        ],
      })

      expect(result.subtotal).toBe(3500) // (1000*2) + (500*3)
    })
  })

  // =============================================================================
  // Price Rules Tests
  // =============================================================================

  describe('price rules', () => {
    let pricing: PricingEngine

    beforeEach(() => {
      pricing = createTestPricingEngine()
    })

    it('should create a percentage discount rule', async () => {
      const rule = await pricing.createRule({
        name: '10% Off Everything',
        type: 'percentage',
        value: 10,
        priority: 1,
      })

      expect(rule.id).toBeDefined()
      expect(rule.type).toBe('percentage')
      expect(rule.value).toBe(10)
    })

    it('should apply percentage discount', async () => {
      await pricing.createRule({
        name: '10% Off',
        type: 'percentage',
        value: 10,
        priority: 1,
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 10000, // $100
        quantity: 1,
      })

      expect(result.finalPrice).toBe(9000) // $90
      expect(result.discount).toBe(1000)
    })

    it('should apply fixed amount discount', async () => {
      await pricing.createRule({
        name: '$5 Off',
        type: 'fixed',
        value: 500,
        priority: 1,
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 2999,
        quantity: 1,
      })

      expect(result.finalPrice).toBe(2499)
    })

    it('should apply rule to specific products', async () => {
      await pricing.createRule({
        name: 'T-Shirt Discount',
        type: 'percentage',
        value: 20,
        conditions: {
          productIds: ['prod-shirt'],
        },
      })

      const shirtResult = await pricing.calculatePrice({
        productId: 'prod-shirt',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      const pantsResult = await pricing.calculatePrice({
        productId: 'prod-pants',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      expect(shirtResult.finalPrice).toBe(800)
      expect(pantsResult.finalPrice).toBe(1000)
    })

    it('should apply rule to category', async () => {
      await pricing.createRule({
        name: 'Category Sale',
        type: 'percentage',
        value: 15,
        conditions: {
          categoryIds: ['cat-clothing'],
        },
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
        categoryIds: ['cat-clothing'],
      })

      expect(result.finalPrice).toBe(850)
    })

    it('should respect rule priority', async () => {
      await pricing.createRule({
        name: 'Low Priority',
        type: 'percentage',
        value: 10,
        priority: 10,
      })
      await pricing.createRule({
        name: 'High Priority',
        type: 'percentage',
        value: 20,
        priority: 1,
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      // High priority (20%) should apply first
      expect(result.appliedRules[0].name).toBe('High Priority')
    })

    it('should stop at first match when configured', async () => {
      await pricing.createRule({
        name: 'First Rule',
        type: 'percentage',
        value: 10,
        priority: 1,
        stopOnMatch: true,
      })
      await pricing.createRule({
        name: 'Second Rule',
        type: 'percentage',
        value: 20,
        priority: 2,
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      expect(result.appliedRules).toHaveLength(1)
      expect(result.finalPrice).toBe(900) // Only 10% applied
    })

    it('should stack discounts when allowed', async () => {
      await pricing.createRule({
        name: 'Rule 1',
        type: 'percentage',
        value: 10,
        priority: 1,
        stackable: true,
      })
      await pricing.createRule({
        name: 'Rule 2',
        type: 'percentage',
        value: 5,
        priority: 2,
        stackable: true,
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      // 1000 - 10% = 900, then 900 - 5% = 855
      expect(result.finalPrice).toBe(855)
      expect(result.appliedRules).toHaveLength(2)
    })

    it('should enable/disable rules', async () => {
      const rule = await pricing.createRule({
        name: 'Toggleable Rule',
        type: 'percentage',
        value: 50,
        enabled: true,
      })

      await pricing.disableRule(rule.id)

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      expect(result.finalPrice).toBe(1000) // No discount

      await pricing.enableRule(rule.id)

      const result2 = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      expect(result2.finalPrice).toBe(500) // 50% off
    })

    it('should delete a rule', async () => {
      const rule = await pricing.createRule({
        name: 'To Delete',
        type: 'percentage',
        value: 10,
      })

      await pricing.deleteRule(rule.id)

      const rules = await pricing.listRules()
      expect(rules.find((r) => r.id === rule.id)).toBeUndefined()
    })
  })

  // =============================================================================
  // Discount Codes Tests
  // =============================================================================

  describe('discount codes', () => {
    let pricing: PricingEngine

    beforeEach(() => {
      pricing = createTestPricingEngine()
    })

    it('should create a discount code', async () => {
      const code = await pricing.createDiscountCode({
        code: 'SAVE10',
        type: 'percentage',
        value: 10,
      })

      expect(code.id).toBeDefined()
      expect(code.code).toBe('SAVE10')
    })

    it('should validate and apply discount code', async () => {
      await pricing.createDiscountCode({
        code: 'SAVE20',
        type: 'percentage',
        value: 20,
      })

      const result = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 1000, quantity: 1 },
        ],
        discountCode: 'SAVE20',
      })

      expect(result.discount).toBe(200)
      expect(result.total).toBe(800)
      expect(result.appliedCode?.code).toBe('SAVE20')
    })

    it('should reject invalid discount code', async () => {
      const result = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 1000, quantity: 1 },
        ],
        discountCode: 'INVALID',
      })

      expect(result.codeError).toBe('Invalid discount code')
    })

    it('should enforce minimum purchase amount', async () => {
      await pricing.createDiscountCode({
        code: 'MIN50',
        type: 'percentage',
        value: 10,
        minimumPurchase: 5000, // $50 minimum
      })

      const lowResult = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 3000, quantity: 1 },
        ],
        discountCode: 'MIN50',
      })

      expect(lowResult.codeError).toBe('Minimum purchase of $50.00 required')

      const highResult = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 6000, quantity: 1 },
        ],
        discountCode: 'MIN50',
      })

      expect(highResult.discount).toBe(600)
    })

    it('should enforce usage limits', async () => {
      await pricing.createDiscountCode({
        code: 'ONCE',
        type: 'fixed',
        value: 500,
        usageLimit: 1,
      })

      // First use
      await pricing.redeemCode('ONCE', 'order-1')

      // Second use should fail
      const result = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 1000, quantity: 1 },
        ],
        discountCode: 'ONCE',
      })

      expect(result.codeError).toBe('Discount code usage limit reached')
    })

    it('should enforce per-customer usage limits', async () => {
      await pricing.createDiscountCode({
        code: 'ONCE_PER_CUST',
        type: 'percentage',
        value: 10,
        usageLimitPerCustomer: 1,
      })

      await pricing.redeemCode('ONCE_PER_CUST', 'order-1', 'cust-123')

      // Same customer tries again
      const result = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 1000, quantity: 1 },
        ],
        discountCode: 'ONCE_PER_CUST',
        customerId: 'cust-123',
      })

      expect(result.codeError).toBe('You have already used this discount code')

      // Different customer should work
      const result2 = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 1000, quantity: 1 },
        ],
        discountCode: 'ONCE_PER_CUST',
        customerId: 'cust-456',
      })

      expect(result2.discount).toBe(100)
    })

    it('should enforce date restrictions', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-15'))

      await pricing.createDiscountCode({
        code: 'SUMMER',
        type: 'percentage',
        value: 15,
        startsAt: new Date('2024-06-01'),
        expiresAt: new Date('2024-08-31'),
      })

      // During valid period
      let result = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 1000, quantity: 1 },
        ],
        discountCode: 'SUMMER',
      })
      expect(result.discount).toBe(150)

      // After expiration
      vi.setSystemTime(new Date('2024-09-15'))
      result = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 1000, quantity: 1 },
        ],
        discountCode: 'SUMMER',
      })
      expect(result.codeError).toBe('Discount code has expired')

      vi.useRealTimers()
    })

    it('should apply code to specific products only', async () => {
      await pricing.createDiscountCode({
        code: 'SHIRTS20',
        type: 'percentage',
        value: 20,
        applicableProductIds: ['prod-shirt'],
      })

      const result = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-shirt', variantId: 'var-1', basePrice: 1000, quantity: 1 },
          { productId: 'prod-pants', variantId: 'var-2', basePrice: 1000, quantity: 1 },
        ],
        discountCode: 'SHIRTS20',
      })

      // Only shirt gets discount
      expect(result.discount).toBe(200)
      expect(result.total).toBe(1800)
    })

    it('should track code usage', async () => {
      const code = await pricing.createDiscountCode({
        code: 'TRACK',
        type: 'percentage',
        value: 10,
      })

      await pricing.redeemCode('TRACK', 'order-1')
      await pricing.redeemCode('TRACK', 'order-2')

      const updated = await pricing.getDiscountCode('TRACK')
      expect(updated?.usageCount).toBe(2)
    })
  })

  // =============================================================================
  // Bulk/Volume Discounts Tests
  // =============================================================================

  describe('bulk/volume discounts', () => {
    let pricing: PricingEngine

    beforeEach(() => {
      pricing = createTestPricingEngine()
    })

    it('should create bulk discount tiers', async () => {
      const bulk = await pricing.createBulkDiscount({
        productId: 'prod-1',
        tiers: [
          { minQuantity: 5, discount: 5 },   // 5% off for 5-9
          { minQuantity: 10, discount: 10 }, // 10% off for 10-24
          { minQuantity: 25, discount: 15 }, // 15% off for 25+
        ],
      })

      expect(bulk.id).toBeDefined()
      expect(bulk.tiers).toHaveLength(3)
    })

    it('should apply bulk discount based on quantity', async () => {
      await pricing.createBulkDiscount({
        productId: 'prod-1',
        tiers: [
          { minQuantity: 5, discount: 10 },
          { minQuantity: 10, discount: 20 },
        ],
      })

      // 3 items - no bulk discount
      const result1 = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 3,
      })
      expect(result1.unitPrice).toBe(1000)

      // 7 items - 10% bulk discount
      const result2 = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 7,
      })
      expect(result2.unitPrice).toBe(900)

      // 15 items - 20% bulk discount
      const result3 = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 15,
      })
      expect(result3.unitPrice).toBe(800)
    })

    it('should support fixed amount tier discounts', async () => {
      await pricing.createBulkDiscount({
        productId: 'prod-1',
        type: 'fixed',
        tiers: [
          { minQuantity: 5, discount: 100 },  // $1 off per item
          { minQuantity: 10, discount: 200 }, // $2 off per item
        ],
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 10,
      })

      expect(result.unitPrice).toBe(800)
    })

    it('should apply buy X get Y free', async () => {
      await pricing.createBulkDiscount({
        productId: 'prod-1',
        type: 'buyXgetY',
        buyQuantity: 2,
        getQuantity: 1, // Buy 2 get 1 free
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 6, // 4 paid, 2 free
      })

      expect(result.totalPrice).toBe(4000)
      expect(result.freeItems).toBe(2)
    })

    it('should apply cart-wide bulk discounts', async () => {
      await pricing.createRule({
        name: 'Cart Total Discount',
        type: 'percentage',
        value: 10,
        conditions: {
          minCartTotal: 10000, // $100 minimum
        },
      })

      const lowResult = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 5000, quantity: 1 },
        ],
      })
      expect(lowResult.discount).toBe(0)

      const highResult = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 5000, quantity: 3 },
        ],
      })
      expect(highResult.discount).toBe(1500)
    })
  })

  // =============================================================================
  // Time-Based Pricing Tests
  // =============================================================================

  describe('time-based pricing', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('should apply scheduled price rule', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-12-20'))

      const pricing = createTestPricingEngine()

      await pricing.createRule({
        name: 'Holiday Sale',
        type: 'percentage',
        value: 25,
        schedule: {
          startsAt: new Date('2024-12-15'),
          endsAt: new Date('2024-12-31'),
        },
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      expect(result.finalPrice).toBe(750)
    })

    it('should not apply rule outside schedule', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-11-01'))

      const pricing = createTestPricingEngine()

      await pricing.createRule({
        name: 'Holiday Sale',
        type: 'percentage',
        value: 25,
        schedule: {
          startsAt: new Date('2024-12-15'),
          endsAt: new Date('2024-12-31'),
        },
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      expect(result.finalPrice).toBe(1000)
    })

    it('should apply day-of-week pricing', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-12-16T12:00:00')) // Monday at noon

      const pricing = createTestPricingEngine()

      await pricing.createRule({
        name: 'Monday Madness',
        type: 'percentage',
        value: 15,
        schedule: {
          daysOfWeek: [1], // Monday
        },
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      expect(result.finalPrice).toBe(850)

      // Tuesday - no discount
      vi.setSystemTime(new Date('2024-12-17T12:00:00'))
      const result2 = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      expect(result2.finalPrice).toBe(1000)
    })

    it('should apply happy hour pricing', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-12-16T17:00:00'))

      const pricing = createTestPricingEngine()

      await pricing.createRule({
        name: 'Happy Hour',
        type: 'percentage',
        value: 20,
        schedule: {
          timeOfDay: {
            startHour: 16, // 4 PM
            endHour: 18,   // 6 PM
          },
        },
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      expect(result.finalPrice).toBe(800)
    })

    it('should apply flash sale pricing', async () => {
      vi.useFakeTimers()
      const now = new Date()
      vi.setSystemTime(now)

      const pricing = createTestPricingEngine()

      await pricing.createRule({
        name: 'Flash Sale',
        type: 'percentage',
        value: 50,
        schedule: {
          startsAt: new Date(now.getTime() - 60000), // Started 1 min ago
          endsAt: new Date(now.getTime() + 60000),   // Ends in 1 min
        },
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      expect(result.finalPrice).toBe(500)

      // After flash sale
      vi.advanceTimersByTime(120000)

      const result2 = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      expect(result2.finalPrice).toBe(1000)
    })
  })

  // =============================================================================
  // Customer Segment Pricing Tests
  // =============================================================================

  describe('customer segment pricing', () => {
    let pricing: PricingEngine

    beforeEach(() => {
      pricing = createTestPricingEngine()
    })

    it('should create customer segment', async () => {
      const segment = await pricing.createCustomerSegment({
        name: 'VIP',
        conditions: {
          minLifetimeValue: 100000, // $1000+
        },
      })

      expect(segment.id).toBeDefined()
      expect(segment.name).toBe('VIP')
    })

    it('should apply segment-specific pricing', async () => {
      await pricing.createCustomerSegment({
        id: 'seg-vip',
        name: 'VIP',
      })

      await pricing.createRule({
        name: 'VIP Discount',
        type: 'percentage',
        value: 15,
        conditions: {
          customerSegments: ['seg-vip'],
        },
      })

      const vipResult = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
        customerSegments: ['seg-vip'],
      })

      const regularResult = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      expect(vipResult.finalPrice).toBe(850)
      expect(regularResult.finalPrice).toBe(1000)
    })

    it('should apply first-time customer discount', async () => {
      await pricing.createRule({
        name: 'New Customer',
        type: 'percentage',
        value: 10,
        conditions: {
          isFirstOrder: true,
        },
      })

      const newResult = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 1000, quantity: 1 },
        ],
        customerId: 'cust-new',
        isFirstOrder: true,
      })

      const returningResult = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 1000, quantity: 1 },
        ],
        customerId: 'cust-returning',
        isFirstOrder: false,
      })

      expect(newResult.discount).toBe(100)
      expect(returningResult.discount).toBe(0)
    })

    it('should apply employee discount', async () => {
      await pricing.createRule({
        name: 'Employee Discount',
        type: 'percentage',
        value: 30,
        conditions: {
          customerTags: ['employee'],
        },
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
        customerTags: ['employee'],
      })

      expect(result.finalPrice).toBe(700)
    })

    it('should apply wholesale pricing', async () => {
      await pricing.createRule({
        name: 'Wholesale',
        type: 'percentage',
        value: 40,
        conditions: {
          customerTags: ['wholesale'],
        },
      })

      const result = await pricing.calculateCartTotal({
        items: [
          { productId: 'prod-1', variantId: 'var-1', basePrice: 1000, quantity: 100 },
        ],
        customerTags: ['wholesale'],
      })

      expect(result.discount).toBe(40000)
    })
  })

  // =============================================================================
  // Currency and Rounding Tests
  // =============================================================================

  describe('currency and rounding', () => {
    let pricing: PricingEngine

    beforeEach(() => {
      pricing = createTestPricingEngine()
    })

    it('should round to nearest cent', async () => {
      await pricing.createRule({
        name: '33% Off',
        type: 'percentage',
        value: 33,
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000, // $10.00
        quantity: 1,
      })

      // 33% of 1000 = 330, so final = 670
      expect(result.finalPrice).toBe(670)
    })

    it('should support different currencies', async () => {
      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
        currency: 'EUR',
      })

      expect(result.currency).toBe('EUR')
    })

    it('should not go below zero', async () => {
      await pricing.createRule({
        name: 'Huge Discount',
        type: 'fixed',
        value: 5000, // More than price
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      expect(result.finalPrice).toBe(0)
    })

    it('should format price for display', async () => {
      const formatted = pricing.formatPrice(2999, 'USD')
      expect(formatted).toBe('$29.99')

      const formattedEur = pricing.formatPrice(2999, 'EUR')
      expect(formattedEur).toContain('29')
    })
  })

  // =============================================================================
  // Price History and Comparison Tests
  // =============================================================================

  describe('price history and comparison', () => {
    let pricing: PricingEngine

    beforeEach(() => {
      pricing = createTestPricingEngine()
    })

    it('should record price history', async () => {
      await pricing.recordPrice('var-1', 1000)
      await pricing.recordPrice('var-1', 1200)
      await pricing.recordPrice('var-1', 900)

      const history = await pricing.getPriceHistory('var-1')

      expect(history).toHaveLength(3)
      expect(history[2].price).toBe(900)
    })

    it('should show original vs sale price', async () => {
      await pricing.recordPrice('var-1', 1000)

      await pricing.createRule({
        name: 'Sale',
        type: 'percentage',
        value: 20,
      })

      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 1000,
        quantity: 1,
      })

      expect(result.originalPrice).toBe(1000)
      expect(result.finalPrice).toBe(800)
      expect(result.savingsAmount).toBe(200)
      expect(result.savingsPercent).toBe(20)
    })

    it('should show compare at price', async () => {
      const result = await pricing.calculatePrice({
        productId: 'prod-1',
        variantId: 'var-1',
        basePrice: 800,
        compareAtPrice: 1000,
        quantity: 1,
      })

      expect(result.compareAtPrice).toBe(1000)
      expect(result.finalPrice).toBe(800)
    })
  })
})
