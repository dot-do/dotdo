/**
 * Invoice Generation Tests - TDD RED Phase
 *
 * Comprehensive tests for invoice generation and management:
 * - Generate invoice from subscription
 * - Invoice line items (subscription, one-time, usage-based)
 * - Tax calculation integration
 * - Discount/coupon application
 * - Invoice PDF generation
 * - Invoice numbering sequence
 * - Invoice status (draft, open, paid, void)
 * - Auto-pay vs manual pay
 * - Invoice events (created, paid, past_due)
 *
 * These tests define the expected behavior for the InvoiceGenerator primitive.
 * They should fail because implementation doesn't exist yet.
 *
 * @module db/primitives/payments/tests/invoices
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createInvoiceGenerator,
  type InvoiceGenerator,
  type Invoice,
  type InvoiceLineItem,
  type InvoiceStatus,
  type InvoiceEvent,
  type InvoiceEventType,
  type Subscription,
  type UsageRecord,
  type TaxCalculation,
  type Discount,
  type Coupon,
  type InvoicePDF,
  type InvoiceNumberingConfig,
  type PaymentIntent,
  type GenerateInvoiceFromSubscriptionOptions,
  type CreateInvoiceOptions,
  type AddLineItemOptions,
  type ApplyDiscountOptions,
  type FinalizeInvoiceOptions,
  type PayInvoiceOptions,
  type VoidInvoiceOptions,
  type GeneratePDFOptions,
} from '../invoices'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestInvoiceGenerator(): InvoiceGenerator {
  return createInvoiceGenerator()
}

function createMockSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: `sub_${Date.now()}`,
    customerId: 'cust_123',
    priceId: 'price_monthly_99',
    productId: 'prod_pro_plan',
    status: 'active',
    billingCycle: 'monthly',
    quantity: 1,
    unitAmount: 9900, // $99.00 in cents
    currency: 'USD',
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date('2026-02-01'),
    metadata: {},
    ...overrides,
  }
}

function createMockUsageRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: `usage_${Date.now()}`,
    subscriptionId: 'sub_123',
    meterId: 'meter_api_calls',
    quantity: 1000,
    unitAmount: 1, // $0.01 per unit in cents
    timestamp: new Date(),
    ...overrides,
  }
}

function createMockTaxCalculation(overrides: Partial<TaxCalculation> = {}): TaxCalculation {
  return {
    taxAmount: 792, // $7.92 (8% tax on $99)
    taxRate: 8,
    taxType: 'sales_tax',
    jurisdiction: {
      country: 'US',
      state: 'CA',
    },
    breakdown: [
      { name: 'State Sales Tax', rate: 6, amount: 594 },
      { name: 'County Tax', rate: 2, amount: 198 },
    ],
    ...overrides,
  }
}

function createMockCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: `coupon_${Date.now()}`,
    code: 'SAVE20',
    type: 'percentage',
    value: 20,
    currency: 'USD',
    maxRedemptions: 100,
    timesRedeemed: 10,
    validFrom: new Date('2026-01-01'),
    validTo: new Date('2026-12-31'),
    applicableProducts: [],
    minAmount: 0,
    ...overrides,
  }
}

// =============================================================================
// Generate Invoice from Subscription Tests
// =============================================================================

describe('InvoiceGenerator', () => {
  describe('generate invoice from subscription', () => {
    let generator: InvoiceGenerator

    beforeEach(() => {
      generator = createTestInvoiceGenerator()
    })

    it('should generate invoice from active subscription', async () => {
      const subscription = createMockSubscription()

      const invoice = await generator.generateFromSubscription(subscription)

      expect(invoice).toBeDefined()
      expect(invoice.id).toMatch(/^inv_/)
      expect(invoice.customerId).toBe(subscription.customerId)
      expect(invoice.subscriptionId).toBe(subscription.id)
      expect(invoice.status).toBe('draft')
      expect(invoice.currency).toBe('USD')
    })

    it('should calculate correct amounts from subscription', async () => {
      const subscription = createMockSubscription({
        quantity: 3,
        unitAmount: 9900,
      })

      const invoice = await generator.generateFromSubscription(subscription)

      expect(invoice.subtotal).toBe(29700) // 3 * $99.00
      expect(invoice.lineItems).toHaveLength(1)
      expect(invoice.lineItems[0].amount).toBe(29700)
    })

    it('should set billing period from subscription', async () => {
      const subscription = createMockSubscription({
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2026-02-01'),
      })

      const invoice = await generator.generateFromSubscription(subscription)

      expect(invoice.periodStart).toEqual(subscription.currentPeriodStart)
      expect(invoice.periodEnd).toEqual(subscription.currentPeriodEnd)
    })

    it('should handle subscription with trial period', async () => {
      const subscription = createMockSubscription({
        status: 'trialing',
        trialEnd: new Date('2026-01-15'),
      })

      const invoice = await generator.generateFromSubscription(subscription)

      // During trial, invoice should be $0
      expect(invoice.subtotal).toBe(0)
      expect(invoice.total).toBe(0)
      expect(invoice.metadata?.trialInvoice).toBe(true)
    })

    it('should include product details in line items', async () => {
      const subscription = createMockSubscription({
        productName: 'Pro Plan',
        productDescription: 'Full access to all features',
      })

      const invoice = await generator.generateFromSubscription(subscription)

      expect(invoice.lineItems[0].description).toContain('Pro Plan')
      expect(invoice.lineItems[0].productId).toBe(subscription.productId)
    })

    it('should generate invoice for yearly subscription', async () => {
      const subscription = createMockSubscription({
        billingCycle: 'yearly',
        unitAmount: 99900, // $999/year
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2027-01-01'),
      })

      const invoice = await generator.generateFromSubscription(subscription)

      expect(invoice.subtotal).toBe(99900)
      expect(invoice.periodStart).toEqual(subscription.currentPeriodStart)
      expect(invoice.periodEnd).toEqual(subscription.currentPeriodEnd)
    })

    it('should handle metered subscription with usage billing', async () => {
      const subscription = createMockSubscription({
        billingType: 'metered',
        meterId: 'meter_api_calls',
      })

      const usageRecords: UsageRecord[] = [
        createMockUsageRecord({ quantity: 5000, unitAmount: 1 }),
        createMockUsageRecord({ quantity: 3000, unitAmount: 1 }),
      ]

      const invoice = await generator.generateFromSubscription(subscription, {
        usageRecords,
      })

      expect(invoice.lineItems).toHaveLength(1)
      expect(invoice.lineItems[0].quantity).toBe(8000)
      expect(invoice.subtotal).toBe(8000) // $80.00 in cents
    })
  })

  // =============================================================================
  // Invoice Line Items Tests
  // =============================================================================

  describe('invoice line items', () => {
    let generator: InvoiceGenerator

    beforeEach(() => {
      generator = createTestInvoiceGenerator()
    })

    describe('subscription line items', () => {
      it('should create subscription line item with correct structure', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        const updatedInvoice = await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Pro Plan - Monthly',
          amount: 9900,
          quantity: 1,
          productId: 'prod_pro',
          priceId: 'price_monthly',
          periodStart: new Date('2026-01-01'),
          periodEnd: new Date('2026-02-01'),
        })

        expect(updatedInvoice.lineItems).toHaveLength(1)
        expect(updatedInvoice.lineItems[0]).toMatchObject({
          type: 'subscription',
          description: 'Pro Plan - Monthly',
          amount: 9900,
          quantity: 1,
        })
      })

      it('should calculate line item subtotal with quantity', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Seat license',
          amount: 1500, // $15/seat
          quantity: 10,
        })

        const updatedInvoice = await generator.getInvoice(invoice.id)
        expect(updatedInvoice!.subtotal).toBe(15000)
      })
    })

    describe('one-time line items', () => {
      it('should add one-time charge to invoice', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        const updatedInvoice = await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Setup Fee',
          amount: 5000,
          quantity: 1,
        })

        expect(updatedInvoice.lineItems[0].type).toBe('one_time')
        expect(updatedInvoice.lineItems[0].description).toBe('Setup Fee')
        expect(updatedInvoice.subtotal).toBe(5000)
      })

      it('should support multiple one-time items', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Premium Support Package',
          amount: 29900,
          quantity: 1,
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Custom Integration',
          amount: 49900,
          quantity: 1,
        })

        const updatedInvoice = await generator.getInvoice(invoice.id)
        expect(updatedInvoice!.lineItems).toHaveLength(2)
        expect(updatedInvoice!.subtotal).toBe(79800)
      })
    })

    describe('usage-based line items', () => {
      it('should create usage line item from usage records', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        const updatedInvoice = await generator.addLineItem(invoice.id, {
          type: 'usage',
          description: 'API Calls - January 2026',
          unitAmount: 1, // $0.01 per call
          quantity: 150000,
          meterId: 'meter_api_calls',
          usageRecordIds: ['usage_1', 'usage_2'],
        })

        expect(updatedInvoice.lineItems[0].type).toBe('usage')
        expect(updatedInvoice.lineItems[0].amount).toBe(150000) // $1500.00
        expect(updatedInvoice.lineItems[0].quantity).toBe(150000)
      })

      it('should aggregate usage from multiple records', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        const usageRecords: UsageRecord[] = [
          createMockUsageRecord({ quantity: 50000, unitAmount: 1 }),
          createMockUsageRecord({ quantity: 30000, unitAmount: 1 }),
          createMockUsageRecord({ quantity: 70000, unitAmount: 1 }),
        ]

        const updatedInvoice = await generator.addUsageLineItem(invoice.id, {
          meterId: 'meter_api_calls',
          description: 'API Calls',
          usageRecords,
        })

        expect(updatedInvoice.lineItems[0].quantity).toBe(150000)
        expect(updatedInvoice.lineItems[0].amount).toBe(150000)
      })

      it('should support tiered usage pricing', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        const tiers = [
          { upTo: 1000, unitAmount: 5 }, // $0.05 for first 1000
          { upTo: 10000, unitAmount: 3 }, // $0.03 for 1001-10000
          { upTo: null, unitAmount: 1 }, // $0.01 for 10001+
        ]

        const updatedInvoice = await generator.addTieredUsageLineItem(invoice.id, {
          meterId: 'meter_api_calls',
          description: 'API Calls (Tiered)',
          quantity: 15000,
          tiers,
        })

        // 1000 * $0.05 = $50
        // 9000 * $0.03 = $270
        // 5000 * $0.01 = $50
        // Total = $370 = 37000 cents
        expect(updatedInvoice.lineItems[0].amount).toBe(37000)
      })
    })

    describe('line item modifications', () => {
      it('should update line item quantity', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Seat license',
          amount: 1500,
          quantity: 5,
        })

        let currentInvoice = await generator.getInvoice(invoice.id)
        const lineItemId = currentInvoice!.lineItems[0].id

        await generator.updateLineItem(invoice.id, lineItemId, {
          quantity: 10,
        })

        currentInvoice = await generator.getInvoice(invoice.id)
        expect(currentInvoice!.lineItems[0].quantity).toBe(10)
        expect(currentInvoice!.subtotal).toBe(15000)
      })

      it('should remove line item from invoice', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Item A',
          amount: 1000,
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Item B',
          amount: 2000,
        })

        let currentInvoice = await generator.getInvoice(invoice.id)
        const lineItemId = currentInvoice!.lineItems[0].id

        await generator.removeLineItem(invoice.id, lineItemId)

        currentInvoice = await generator.getInvoice(invoice.id)
        expect(currentInvoice!.lineItems).toHaveLength(1)
        expect(currentInvoice!.subtotal).toBe(2000)
      })

      it('should not allow line item modifications on finalized invoice', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Item A',
          amount: 1000,
        })

        await generator.finalize(invoice.id)

        await expect(
          generator.addLineItem(invoice.id, {
            type: 'one_time',
            description: 'New Item',
            amount: 500,
          })
        ).rejects.toThrow('Cannot modify finalized invoice')
      })
    })
  })

  // =============================================================================
  // Tax Calculation Integration Tests
  // =============================================================================

  describe('tax calculation integration', () => {
    let generator: InvoiceGenerator

    beforeEach(() => {
      generator = createTestInvoiceGenerator()
    })

    it('should calculate tax for invoice', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
        taxCalculation: {
          enabled: true,
          jurisdiction: { country: 'US', state: 'CA' },
        },
      })

      await generator.addLineItem(invoice.id, {
        type: 'subscription',
        description: 'Pro Plan',
        amount: 9900,
      })

      const finalInvoice = await generator.finalize(invoice.id)

      expect(finalInvoice.tax).toBeDefined()
      expect(finalInvoice.tax!.amount).toBeGreaterThan(0)
      expect(finalInvoice.total).toBe(finalInvoice.subtotal + finalInvoice.tax!.amount)
    })

    it('should apply correct tax rate by jurisdiction', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
        taxCalculation: {
          enabled: true,
          jurisdiction: { country: 'US', state: 'CA', city: 'Los Angeles' },
        },
      })

      await generator.addLineItem(invoice.id, {
        type: 'subscription',
        description: 'Pro Plan',
        amount: 10000,
      })

      const finalInvoice = await generator.finalize(invoice.id)

      // California base rate + LA county + LA city
      expect(finalInvoice.tax!.rate).toBeGreaterThanOrEqual(9.5)
    })

    it('should provide tax breakdown', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
        taxCalculation: {
          enabled: true,
          jurisdiction: { country: 'US', state: 'CA' },
        },
      })

      await generator.addLineItem(invoice.id, {
        type: 'subscription',
        description: 'Pro Plan',
        amount: 10000,
      })

      const finalInvoice = await generator.finalize(invoice.id)

      expect(finalInvoice.tax!.breakdown).toBeDefined()
      expect(finalInvoice.tax!.breakdown!.length).toBeGreaterThan(0)
      expect(finalInvoice.tax!.breakdown![0]).toHaveProperty('name')
      expect(finalInvoice.tax!.breakdown![0]).toHaveProperty('rate')
      expect(finalInvoice.tax!.breakdown![0]).toHaveProperty('amount')
    })

    it('should handle tax-exempt customers', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
        taxCalculation: {
          enabled: true,
          jurisdiction: { country: 'US', state: 'CA' },
        },
        taxExempt: true,
        taxExemptReason: 'Nonprofit organization',
      })

      await generator.addLineItem(invoice.id, {
        type: 'subscription',
        description: 'Pro Plan',
        amount: 10000,
      })

      const finalInvoice = await generator.finalize(invoice.id)

      expect(finalInvoice.tax).toBeUndefined()
      expect(finalInvoice.total).toBe(10000)
      expect(finalInvoice.taxExempt).toBe(true)
    })

    it('should handle VAT for EU customers', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_456',
        currency: 'EUR',
        taxCalculation: {
          enabled: true,
          jurisdiction: { country: 'DE' },
          taxType: 'vat',
        },
      })

      await generator.addLineItem(invoice.id, {
        type: 'subscription',
        description: 'Pro Plan',
        amount: 10000,
      })

      const finalInvoice = await generator.finalize(invoice.id)

      expect(finalInvoice.tax!.type).toBe('vat')
      expect(finalInvoice.tax!.rate).toBe(19) // German VAT
    })

    it('should handle reverse charge for B2B EU cross-border', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_business',
        currency: 'EUR',
        taxCalculation: {
          enabled: true,
          jurisdiction: { country: 'FR' },
          taxType: 'vat',
          reverseCharge: true,
          vatNumber: 'FR12345678901',
        },
      })

      await generator.addLineItem(invoice.id, {
        type: 'subscription',
        description: 'Pro Plan',
        amount: 10000,
      })

      const finalInvoice = await generator.finalize(invoice.id)

      expect(finalInvoice.tax).toBeUndefined()
      expect(finalInvoice.reverseChargeApplied).toBe(true)
      expect(finalInvoice.vatNumber).toBe('FR12345678901')
    })

    it('should handle zero-rated items', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'GBP',
        taxCalculation: {
          enabled: true,
          jurisdiction: { country: 'GB' },
        },
      })

      await generator.addLineItem(invoice.id, {
        type: 'subscription',
        description: 'Children Books Subscription',
        amount: 5000,
        taxCategory: 'zero_rated',
      })

      const finalInvoice = await generator.finalize(invoice.id)

      expect(finalInvoice.tax!.amount).toBe(0)
      expect(finalInvoice.total).toBe(5000)
    })
  })

  // =============================================================================
  // Discount/Coupon Application Tests
  // =============================================================================

  describe('discount/coupon application', () => {
    let generator: InvoiceGenerator

    beforeEach(() => {
      generator = createTestInvoiceGenerator()
    })

    describe('percentage discounts', () => {
      it('should apply percentage discount to invoice', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Pro Plan',
          amount: 10000,
        })

        const updatedInvoice = await generator.applyDiscount(invoice.id, {
          type: 'percentage',
          value: 20,
          description: '20% Off',
        })

        expect(updatedInvoice.discount).toBeDefined()
        expect(updatedInvoice.discount!.amount).toBe(2000)
        expect(updatedInvoice.subtotal).toBe(10000)
        expect(updatedInvoice.total).toBe(8000)
      })

      it('should cap percentage discount at 100%', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Pro Plan',
          amount: 10000,
        })

        const updatedInvoice = await generator.applyDiscount(invoice.id, {
          type: 'percentage',
          value: 150, // 150% should cap at 100%
          description: 'Super Discount',
        })

        expect(updatedInvoice.discount!.amount).toBe(10000)
        expect(updatedInvoice.total).toBe(0)
      })
    })

    describe('fixed amount discounts', () => {
      it('should apply fixed amount discount to invoice', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Pro Plan',
          amount: 10000,
        })

        const updatedInvoice = await generator.applyDiscount(invoice.id, {
          type: 'fixed',
          value: 2500,
          description: '$25 Off',
        })

        expect(updatedInvoice.discount!.amount).toBe(2500)
        expect(updatedInvoice.total).toBe(7500)
      })

      it('should not allow negative totals', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Pro Plan',
          amount: 5000,
        })

        const updatedInvoice = await generator.applyDiscount(invoice.id, {
          type: 'fixed',
          value: 10000, // More than subtotal
          description: 'Big Discount',
        })

        expect(updatedInvoice.discount!.amount).toBe(5000) // Capped
        expect(updatedInvoice.total).toBe(0)
      })
    })

    describe('coupon redemption', () => {
      it('should apply coupon code to invoice', async () => {
        const coupon = createMockCoupon({
          code: 'SAVE20',
          type: 'percentage',
          value: 20,
        })

        generator.registerCoupon(coupon)

        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Pro Plan',
          amount: 10000,
        })

        const updatedInvoice = await generator.applyCoupon(invoice.id, 'SAVE20')

        expect(updatedInvoice.couponCode).toBe('SAVE20')
        expect(updatedInvoice.discount!.amount).toBe(2000)
      })

      it('should reject expired coupon', async () => {
        const coupon = createMockCoupon({
          code: 'EXPIRED',
          validTo: new Date('2025-12-31'), // Expired
        })

        generator.registerCoupon(coupon)

        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await expect(generator.applyCoupon(invoice.id, 'EXPIRED')).rejects.toThrow(
          'Coupon has expired'
        )
      })

      it('should reject coupon not yet valid', async () => {
        const coupon = createMockCoupon({
          code: 'FUTURE',
          validFrom: new Date('2027-01-01'), // Not yet valid
        })

        generator.registerCoupon(coupon)

        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await expect(generator.applyCoupon(invoice.id, 'FUTURE')).rejects.toThrow(
          'Coupon is not yet valid'
        )
      })

      it('should reject coupon at max redemptions', async () => {
        const coupon = createMockCoupon({
          code: 'MAXED',
          maxRedemptions: 100,
          timesRedeemed: 100,
        })

        generator.registerCoupon(coupon)

        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await expect(generator.applyCoupon(invoice.id, 'MAXED')).rejects.toThrow(
          'Coupon has reached maximum redemptions'
        )
      })

      it('should enforce minimum amount requirement', async () => {
        const coupon = createMockCoupon({
          code: 'BIG20',
          type: 'percentage',
          value: 20,
          minAmount: 10000,
        })

        generator.registerCoupon(coupon)

        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Starter Plan',
          amount: 5000,
        })

        await expect(generator.applyCoupon(invoice.id, 'BIG20')).rejects.toThrow(
          'Minimum amount not met'
        )
      })

      it('should apply product-specific coupon', async () => {
        const coupon = createMockCoupon({
          code: 'PROONLY',
          type: 'percentage',
          value: 25,
          applicableProducts: ['prod_pro'],
        })

        generator.registerCoupon(coupon)

        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Pro Plan',
          amount: 10000,
          productId: 'prod_pro',
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Starter Plan',
          amount: 5000,
          productId: 'prod_starter',
        })

        const updatedInvoice = await generator.applyCoupon(invoice.id, 'PROONLY')

        // Only 25% off the Pro Plan ($10000 * 0.25 = $2500)
        expect(updatedInvoice.discount!.amount).toBe(2500)
      })
    })

    describe('discount combinations', () => {
      it('should not allow multiple discounts by default', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Pro Plan',
          amount: 10000,
        })

        await generator.applyDiscount(invoice.id, {
          type: 'percentage',
          value: 10,
        })

        await expect(
          generator.applyDiscount(invoice.id, {
            type: 'percentage',
            value: 5,
          })
        ).rejects.toThrow('Discount already applied')
      })

      it('should allow stacking discounts when enabled', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
          allowDiscountStacking: true,
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Pro Plan',
          amount: 10000,
        })

        await generator.applyDiscount(invoice.id, {
          type: 'percentage',
          value: 10,
          description: 'Loyalty discount',
        })

        await generator.applyDiscount(invoice.id, {
          type: 'fixed',
          value: 500,
          description: 'Referral credit',
        })

        const updatedInvoice = await generator.getInvoice(invoice.id)
        // 10% of 10000 = 1000, then -500 = 1500 total discount
        expect(updatedInvoice!.discounts).toHaveLength(2)
        expect(updatedInvoice!.totalDiscount).toBe(1500)
        expect(updatedInvoice!.total).toBe(8500)
      })

      it('should remove discount from invoice', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Pro Plan',
          amount: 10000,
        })

        await generator.applyDiscount(invoice.id, {
          type: 'percentage',
          value: 20,
        })

        await generator.removeDiscount(invoice.id)

        const updatedInvoice = await generator.getInvoice(invoice.id)
        expect(updatedInvoice!.discount).toBeUndefined()
        expect(updatedInvoice!.total).toBe(10000)
      })
    })
  })

  // =============================================================================
  // Invoice PDF Generation Tests
  // =============================================================================

  describe('invoice PDF generation', () => {
    let generator: InvoiceGenerator

    beforeEach(() => {
      generator = createTestInvoiceGenerator()
    })

    it('should generate PDF for finalized invoice', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })

      await generator.addLineItem(invoice.id, {
        type: 'subscription',
        description: 'Pro Plan',
        amount: 9900,
      })

      await generator.finalize(invoice.id)

      const pdf = await generator.generatePDF(invoice.id)

      expect(pdf).toBeDefined()
      expect(pdf.buffer).toBeInstanceOf(Buffer)
      expect(pdf.contentType).toBe('application/pdf')
      expect(pdf.filename).toContain(invoice.id)
    })

    it('should not generate PDF for draft invoice', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })

      await expect(generator.generatePDF(invoice.id)).rejects.toThrow(
        'Cannot generate PDF for draft invoice'
      )
    })

    it('should include company details in PDF', async () => {
      generator.configure({
        company: {
          name: 'Acme Inc.',
          address: '123 Main St, San Francisco, CA 94102',
          taxId: 'US12-3456789',
          logo: 'https://example.com/logo.png',
        },
      })

      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })

      await generator.addLineItem(invoice.id, {
        type: 'subscription',
        description: 'Pro Plan',
        amount: 9900,
      })

      await generator.finalize(invoice.id)

      const pdf = await generator.generatePDF(invoice.id)

      expect(pdf.metadata.companyName).toBe('Acme Inc.')
      expect(pdf.metadata.companyAddress).toBe('123 Main St, San Francisco, CA 94102')
    })

    it('should include customer billing address in PDF', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
        billingAddress: {
          name: 'John Doe',
          line1: '456 Oak Ave',
          city: 'Los Angeles',
          state: 'CA',
          postalCode: '90001',
          country: 'US',
        },
      })

      await generator.addLineItem(invoice.id, {
        type: 'subscription',
        description: 'Pro Plan',
        amount: 9900,
      })

      await generator.finalize(invoice.id)

      const pdf = await generator.generatePDF(invoice.id)

      expect(pdf.metadata.billingAddress).toContain('John Doe')
      expect(pdf.metadata.billingAddress).toContain('Los Angeles')
    })

    it('should support custom PDF templates', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })

      await generator.addLineItem(invoice.id, {
        type: 'subscription',
        description: 'Pro Plan',
        amount: 9900,
      })

      await generator.finalize(invoice.id)

      const pdf = await generator.generatePDF(invoice.id, {
        template: 'minimal',
      })

      expect(pdf.metadata.template).toBe('minimal')
    })

    it('should include payment instructions in PDF', async () => {
      generator.configure({
        paymentInstructions: 'Please pay within 30 days via bank transfer or credit card.',
      })

      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })

      await generator.addLineItem(invoice.id, {
        type: 'subscription',
        description: 'Pro Plan',
        amount: 9900,
      })

      await generator.finalize(invoice.id)

      const pdf = await generator.generatePDF(invoice.id)

      expect(pdf.metadata.paymentInstructions).toBeDefined()
    })

    it('should generate PDF URL for hosted access', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })

      await generator.addLineItem(invoice.id, {
        type: 'subscription',
        description: 'Pro Plan',
        amount: 9900,
      })

      await generator.finalize(invoice.id)

      const pdfUrl = await generator.getPDFUrl(invoice.id, {
        expiresIn: 3600, // 1 hour
      })

      expect(pdfUrl).toMatch(/^https:\/\//)
      expect(pdfUrl).toContain(invoice.id)
    })

    it('should support multiple languages in PDF', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'EUR',
        locale: 'de-DE',
      })

      await generator.addLineItem(invoice.id, {
        type: 'subscription',
        description: 'Pro-Plan',
        amount: 9900,
      })

      await generator.finalize(invoice.id)

      const pdf = await generator.generatePDF(invoice.id)

      expect(pdf.metadata.locale).toBe('de-DE')
    })
  })

  // =============================================================================
  // Invoice Numbering Sequence Tests
  // =============================================================================

  describe('invoice numbering sequence', () => {
    let generator: InvoiceGenerator

    beforeEach(() => {
      generator = createTestInvoiceGenerator()
    })

    it('should assign sequential invoice numbers', async () => {
      const invoice1 = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })
      await generator.addLineItem(invoice1.id, { type: 'one_time', description: 'Item', amount: 100 })
      const finalized1 = await generator.finalize(invoice1.id)

      const invoice2 = await generator.createInvoice({
        customerId: 'cust_456',
        currency: 'USD',
      })
      await generator.addLineItem(invoice2.id, { type: 'one_time', description: 'Item', amount: 100 })
      const finalized2 = await generator.finalize(invoice2.id)

      expect(finalized1.invoiceNumber).toBeDefined()
      expect(finalized2.invoiceNumber).toBeDefined()

      // Parse numbers and verify sequence
      const num1 = parseInt(finalized1.invoiceNumber!.replace(/\D/g, ''))
      const num2 = parseInt(finalized2.invoiceNumber!.replace(/\D/g, ''))
      expect(num2).toBeGreaterThan(num1)
    })

    it('should use configured prefix format', async () => {
      generator.configure({
        invoiceNumbering: {
          prefix: 'INV',
          padding: 6,
        },
      })

      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })
      await generator.addLineItem(invoice.id, { type: 'one_time', description: 'Item', amount: 100 })
      const finalized = await generator.finalize(invoice.id)

      expect(finalized.invoiceNumber).toMatch(/^INV-\d{6}$/)
    })

    it('should support year-month prefix', async () => {
      generator.configure({
        invoiceNumbering: {
          format: 'year-month-sequence',
          separator: '-',
        },
      })

      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })
      await generator.addLineItem(invoice.id, { type: 'one_time', description: 'Item', amount: 100 })
      const finalized = await generator.finalize(invoice.id)

      // Format: 2026-01-0001
      expect(finalized.invoiceNumber).toMatch(/^\d{4}-\d{2}-\d+$/)
    })

    it('should reset sequence per year when configured', async () => {
      generator.configure({
        invoiceNumbering: {
          format: 'year-sequence',
          resetYearly: true,
        },
      })

      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })
      await generator.addLineItem(invoice.id, { type: 'one_time', description: 'Item', amount: 100 })
      const finalized = await generator.finalize(invoice.id)

      expect(finalized.invoiceNumber).toMatch(/^2026-\d+$/)
    })

    it('should support custom number format function', async () => {
      generator.configure({
        invoiceNumbering: {
          formatFunction: (sequence: number, date: Date) => {
            const year = date.getFullYear()
            return `ACME-${year}-${String(sequence).padStart(5, '0')}`
          },
        },
      })

      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })
      await generator.addLineItem(invoice.id, { type: 'one_time', description: 'Item', amount: 100 })
      const finalized = await generator.finalize(invoice.id)

      expect(finalized.invoiceNumber).toMatch(/^ACME-2026-\d{5}$/)
    })

    it('should not assign number to draft invoice', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })

      expect(invoice.invoiceNumber).toBeUndefined()
    })

    it('should preserve number across status changes', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })
      await generator.addLineItem(invoice.id, { type: 'one_time', description: 'Item', amount: 100 })
      const finalized = await generator.finalize(invoice.id)
      const originalNumber = finalized.invoiceNumber

      await generator.markPaid(invoice.id)

      const paid = await generator.getInvoice(invoice.id)
      expect(paid!.invoiceNumber).toBe(originalNumber)
    })
  })

  // =============================================================================
  // Invoice Status Tests
  // =============================================================================

  describe('invoice status management', () => {
    let generator: InvoiceGenerator

    beforeEach(() => {
      generator = createTestInvoiceGenerator()
    })

    describe('draft status', () => {
      it('should create invoice in draft status', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        expect(invoice.status).toBe('draft')
      })

      it('should allow modifications in draft status', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Item A',
          amount: 1000,
        })

        const updated = await generator.getInvoice(invoice.id)
        expect(updated!.lineItems).toHaveLength(1)
      })

      it('should delete draft invoice', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.deleteInvoice(invoice.id)

        const deleted = await generator.getInvoice(invoice.id)
        expect(deleted).toBeNull()
      })
    })

    describe('open status', () => {
      it('should transition from draft to open on finalize', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Item',
          amount: 1000,
        })

        const finalized = await generator.finalize(invoice.id)

        expect(finalized.status).toBe('open')
        expect(finalized.finalizedAt).toBeDefined()
      })

      it('should not finalize empty invoice', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await expect(generator.finalize(invoice.id)).rejects.toThrow(
          'Cannot finalize invoice with no line items'
        )
      })

      it('should set due date on finalize', async () => {
        generator.configure({ defaultDueDays: 30 })

        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Item',
          amount: 1000,
        })

        const finalized = await generator.finalize(invoice.id)

        expect(finalized.dueDate).toBeDefined()
        const daysDiff = Math.round(
          (finalized.dueDate!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        )
        expect(daysDiff).toBeCloseTo(30, 0)
      })

      it('should not allow deletion of open invoice', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Item',
          amount: 1000,
        })

        await generator.finalize(invoice.id)

        await expect(generator.deleteInvoice(invoice.id)).rejects.toThrow(
          'Cannot delete finalized invoice'
        )
      })
    })

    describe('paid status', () => {
      it('should mark invoice as paid', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Item',
          amount: 1000,
        })

        await generator.finalize(invoice.id)
        const paid = await generator.markPaid(invoice.id, {
          paymentId: 'pay_xyz',
          paidAt: new Date(),
        })

        expect(paid.status).toBe('paid')
        expect(paid.paidAt).toBeDefined()
        expect(paid.paymentId).toBe('pay_xyz')
      })

      it('should record partial payment', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Item',
          amount: 10000,
        })

        await generator.finalize(invoice.id)
        const updated = await generator.recordPayment(invoice.id, {
          amount: 5000,
          paymentId: 'pay_partial',
        })

        expect(updated.status).toBe('open')
        expect(updated.amountPaid).toBe(5000)
        expect(updated.amountDue).toBe(5000)
      })

      it('should auto-mark paid when fully paid', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Item',
          amount: 10000,
        })

        await generator.finalize(invoice.id)
        await generator.recordPayment(invoice.id, { amount: 5000, paymentId: 'pay_1' })
        const paid = await generator.recordPayment(invoice.id, { amount: 5000, paymentId: 'pay_2' })

        expect(paid.status).toBe('paid')
        expect(paid.amountPaid).toBe(10000)
        expect(paid.amountDue).toBe(0)
      })
    })

    describe('void status', () => {
      it('should void open invoice', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Item',
          amount: 1000,
        })

        await generator.finalize(invoice.id)
        const voided = await generator.voidInvoice(invoice.id, {
          reason: 'Customer requested cancellation',
        })

        expect(voided.status).toBe('void')
        expect(voided.voidedAt).toBeDefined()
        expect(voided.voidReason).toBe('Customer requested cancellation')
      })

      it('should not void paid invoice', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Item',
          amount: 1000,
        })

        await generator.finalize(invoice.id)
        await generator.markPaid(invoice.id, { paymentId: 'pay_123' })

        await expect(generator.voidInvoice(invoice.id)).rejects.toThrow('Cannot void paid invoice')
      })

      it('should create credit note when voiding partially paid invoice', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Item',
          amount: 10000,
        })

        await generator.finalize(invoice.id)
        await generator.recordPayment(invoice.id, { amount: 5000, paymentId: 'pay_1' })

        const voided = await generator.voidInvoice(invoice.id, {
          reason: 'Service cancelled',
          createCreditNote: true,
        })

        expect(voided.creditNoteId).toBeDefined()
      })
    })

    describe('uncollectible status', () => {
      it('should mark invoice as uncollectible', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Item',
          amount: 1000,
        })

        await generator.finalize(invoice.id)
        const uncollectible = await generator.markUncollectible(invoice.id, {
          reason: 'Customer bankruptcy',
        })

        expect(uncollectible.status).toBe('uncollectible')
        expect(uncollectible.uncollectibleReason).toBe('Customer bankruptcy')
      })
    })
  })

  // =============================================================================
  // Auto-Pay vs Manual Pay Tests
  // =============================================================================

  describe('auto-pay vs manual pay', () => {
    let generator: InvoiceGenerator

    beforeEach(() => {
      generator = createTestInvoiceGenerator()
    })

    describe('auto-pay invoices', () => {
      it('should create auto-pay invoice for subscription', async () => {
        const subscription = createMockSubscription({
          defaultPaymentMethodId: 'pm_card_visa',
        })

        const invoice = await generator.generateFromSubscription(subscription, {
          autoCharge: true,
        })

        expect(invoice.collectionMethod).toBe('charge_automatically')
        expect(invoice.paymentMethodId).toBe('pm_card_visa')
      })

      it('should attempt payment on finalize for auto-pay', async () => {
        const paymentAttemptFn = vi.fn().mockResolvedValue({
          success: true,
          paymentId: 'pay_auto_123',
        })

        generator.configure({
          onAutoPayAttempt: paymentAttemptFn,
        })

        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
          collectionMethod: 'charge_automatically',
          paymentMethodId: 'pm_card_visa',
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Pro Plan',
          amount: 9900,
        })

        const finalized = await generator.finalize(invoice.id)

        expect(paymentAttemptFn).toHaveBeenCalledWith({
          invoiceId: invoice.id,
          amount: 9900,
          paymentMethodId: 'pm_card_visa',
        })
        expect(finalized.status).toBe('paid')
      })

      it('should handle auto-pay failure', async () => {
        const paymentAttemptFn = vi.fn().mockResolvedValue({
          success: false,
          error: 'card_declined',
        })

        generator.configure({
          onAutoPayAttempt: paymentAttemptFn,
        })

        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
          collectionMethod: 'charge_automatically',
          paymentMethodId: 'pm_card_visa',
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Pro Plan',
          amount: 9900,
        })

        const finalized = await generator.finalize(invoice.id)

        expect(finalized.status).toBe('open')
        expect(finalized.paymentAttempts).toHaveLength(1)
        expect(finalized.paymentAttempts![0].status).toBe('failed')
        expect(finalized.paymentAttempts![0].error).toBe('card_declined')
      })

      it('should retry auto-pay with exponential backoff', async () => {
        generator.configure({
          autoPayRetry: {
            maxAttempts: 3,
            initialDelayHours: 24,
            backoffMultiplier: 2,
          },
        })

        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
          collectionMethod: 'charge_automatically',
          paymentMethodId: 'pm_card_visa',
        })

        await generator.addLineItem(invoice.id, {
          type: 'subscription',
          description: 'Pro Plan',
          amount: 9900,
        })

        await generator.finalize(invoice.id)

        const updated = await generator.getInvoice(invoice.id)
        expect(updated!.nextPaymentAttempt).toBeDefined()
      })
    })

    describe('manual pay invoices', () => {
      it('should create send invoice for manual payment', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
          collectionMethod: 'send_invoice',
        })

        expect(invoice.collectionMethod).toBe('send_invoice')
      })

      it('should send invoice email on finalize', async () => {
        const sendEmailFn = vi.fn().mockResolvedValue({ sent: true })

        generator.configure({
          onInvoiceSend: sendEmailFn,
        })

        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
          collectionMethod: 'send_invoice',
          customerEmail: 'customer@example.com',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Consulting',
          amount: 50000,
        })

        await generator.finalize(invoice.id)
        await generator.sendInvoice(invoice.id)

        expect(sendEmailFn).toHaveBeenCalledWith(
          expect.objectContaining({
            invoiceId: invoice.id,
            email: 'customer@example.com',
          })
        )
      })

      it('should include payment link in sent invoice', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
          collectionMethod: 'send_invoice',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Consulting',
          amount: 50000,
        })

        await generator.finalize(invoice.id)

        const sentInvoice = await generator.sendInvoice(invoice.id)

        expect(sentInvoice.hostedInvoiceUrl).toBeDefined()
        expect(sentInvoice.hostedInvoiceUrl).toMatch(/^https:\/\//)
      })

      it('should record manual payment by customer', async () => {
        const invoice = await generator.createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
          collectionMethod: 'send_invoice',
        })

        await generator.addLineItem(invoice.id, {
          type: 'one_time',
          description: 'Consulting',
          amount: 50000,
        })

        await generator.finalize(invoice.id)

        const paid = await generator.markPaid(invoice.id, {
          paymentMethod: 'bank_transfer',
          reference: 'WIRE-12345',
        })

        expect(paid.status).toBe('paid')
        expect(paid.paymentMethod).toBe('bank_transfer')
        expect(paid.paymentReference).toBe('WIRE-12345')
      })
    })
  })

  // =============================================================================
  // Invoice Events Tests
  // =============================================================================

  describe('invoice events', () => {
    let generator: InvoiceGenerator

    beforeEach(() => {
      generator = createTestInvoiceGenerator()
    })

    it('should emit invoice.created event', async () => {
      const events: InvoiceEvent[] = []
      generator.onEvent((event) => events.push(event))

      await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('invoice.created')
      expect(events[0].data.customerId).toBe('cust_123')
    })

    it('should emit invoice.finalized event', async () => {
      const events: InvoiceEvent[] = []
      generator.onEvent((event) => events.push(event))

      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })

      await generator.addLineItem(invoice.id, {
        type: 'one_time',
        description: 'Item',
        amount: 1000,
      })

      await generator.finalize(invoice.id)

      const finalizedEvent = events.find((e) => e.type === 'invoice.finalized')
      expect(finalizedEvent).toBeDefined()
      expect(finalizedEvent!.data.status).toBe('open')
    })

    it('should emit invoice.paid event', async () => {
      const events: InvoiceEvent[] = []
      generator.onEvent((event) => events.push(event))

      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })

      await generator.addLineItem(invoice.id, {
        type: 'one_time',
        description: 'Item',
        amount: 1000,
      })

      await generator.finalize(invoice.id)
      await generator.markPaid(invoice.id, { paymentId: 'pay_123' })

      const paidEvent = events.find((e) => e.type === 'invoice.paid')
      expect(paidEvent).toBeDefined()
      expect(paidEvent!.data.paymentId).toBe('pay_123')
    })

    it('should emit invoice.payment_failed event', async () => {
      const events: InvoiceEvent[] = []
      generator.onEvent((event) => events.push(event))

      generator.configure({
        onAutoPayAttempt: vi.fn().mockResolvedValue({
          success: false,
          error: 'insufficient_funds',
        }),
      })

      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
        collectionMethod: 'charge_automatically',
        paymentMethodId: 'pm_card',
      })

      await generator.addLineItem(invoice.id, {
        type: 'subscription',
        description: 'Plan',
        amount: 9900,
      })

      await generator.finalize(invoice.id)

      const failedEvent = events.find((e) => e.type === 'invoice.payment_failed')
      expect(failedEvent).toBeDefined()
      expect(failedEvent!.data.error).toBe('insufficient_funds')
    })

    it('should emit invoice.past_due event', async () => {
      const events: InvoiceEvent[] = []
      generator.onEvent((event) => events.push(event))

      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })

      await generator.addLineItem(invoice.id, {
        type: 'one_time',
        description: 'Item',
        amount: 1000,
      })

      await generator.finalize(invoice.id)

      // Simulate marking as past due (internal method)
      await generator.markPastDue(invoice.id)

      const pastDueEvent = events.find((e) => e.type === 'invoice.past_due')
      expect(pastDueEvent).toBeDefined()
    })

    it('should emit invoice.voided event', async () => {
      const events: InvoiceEvent[] = []
      generator.onEvent((event) => events.push(event))

      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })

      await generator.addLineItem(invoice.id, {
        type: 'one_time',
        description: 'Item',
        amount: 1000,
      })

      await generator.finalize(invoice.id)
      await generator.voidInvoice(invoice.id, { reason: 'Customer cancelled' })

      const voidedEvent = events.find((e) => e.type === 'invoice.voided')
      expect(voidedEvent).toBeDefined()
      expect(voidedEvent!.data.voidReason).toBe('Customer cancelled')
    })

    it('should emit invoice.sent event', async () => {
      const events: InvoiceEvent[] = []
      generator.onEvent((event) => events.push(event))

      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
        collectionMethod: 'send_invoice',
      })

      await generator.addLineItem(invoice.id, {
        type: 'one_time',
        description: 'Item',
        amount: 1000,
      })

      await generator.finalize(invoice.id)
      await generator.sendInvoice(invoice.id)

      const sentEvent = events.find((e) => e.type === 'invoice.sent')
      expect(sentEvent).toBeDefined()
    })

    it('should include event metadata', async () => {
      const events: InvoiceEvent[] = []
      generator.onEvent((event) => events.push(event))

      await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })

      expect(events[0].id).toBeDefined()
      expect(events[0].timestamp).toBeInstanceOf(Date)
      expect(events[0].apiVersion).toBeDefined()
    })

    it('should allow unsubscribing from events', async () => {
      const events: InvoiceEvent[] = []
      const unsubscribe = generator.onEvent((event) => events.push(event))

      await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })

      unsubscribe()

      await generator.createInvoice({
        customerId: 'cust_456',
        currency: 'USD',
      })

      expect(events).toHaveLength(1)
    })
  })

  // =============================================================================
  // Invoice Query/List Tests
  // =============================================================================

  describe('invoice queries', () => {
    let generator: InvoiceGenerator

    beforeEach(() => {
      generator = createTestInvoiceGenerator()
    })

    it('should list invoices by customer', async () => {
      await generator.createInvoice({ customerId: 'cust_123', currency: 'USD' })
      await generator.createInvoice({ customerId: 'cust_123', currency: 'USD' })
      await generator.createInvoice({ customerId: 'cust_456', currency: 'USD' })

      const invoices = await generator.listByCustomer('cust_123')

      expect(invoices).toHaveLength(2)
      expect(invoices.every((inv) => inv.customerId === 'cust_123')).toBe(true)
    })

    it('should filter invoices by status', async () => {
      const inv1 = await generator.createInvoice({ customerId: 'cust_123', currency: 'USD' })
      const inv2 = await generator.createInvoice({ customerId: 'cust_123', currency: 'USD' })

      await generator.addLineItem(inv1.id, { type: 'one_time', description: 'Item', amount: 100 })
      await generator.finalize(inv1.id)

      const openInvoices = await generator.listByCustomer('cust_123', { status: 'open' })
      const draftInvoices = await generator.listByCustomer('cust_123', { status: 'draft' })

      expect(openInvoices).toHaveLength(1)
      expect(draftInvoices).toHaveLength(1)
    })

    it('should filter invoices by date range', async () => {
      await generator.createInvoice({ customerId: 'cust_123', currency: 'USD' })

      const invoices = await generator.listByCustomer('cust_123', {
        createdAfter: new Date('2026-01-01'),
        createdBefore: new Date('2026-12-31'),
      })

      expect(invoices.length).toBeGreaterThanOrEqual(1)
    })

    it('should paginate invoice results', async () => {
      // Create 15 invoices
      for (let i = 0; i < 15; i++) {
        await generator.createInvoice({ customerId: 'cust_123', currency: 'USD' })
      }

      const page1 = await generator.listByCustomer('cust_123', { limit: 10 })
      const page2 = await generator.listByCustomer('cust_123', { limit: 10, startingAfter: page1[9].id })

      expect(page1).toHaveLength(10)
      expect(page2).toHaveLength(5)
    })

    it('should get invoice by number', async () => {
      const invoice = await generator.createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })

      await generator.addLineItem(invoice.id, {
        type: 'one_time',
        description: 'Item',
        amount: 1000,
      })

      const finalized = await generator.finalize(invoice.id)

      const found = await generator.getByInvoiceNumber(finalized.invoiceNumber!)

      expect(found).toBeDefined()
      expect(found!.id).toBe(invoice.id)
    })

    it('should list upcoming invoices for subscription', async () => {
      const subscription = createMockSubscription()

      const preview = await generator.previewUpcomingInvoice(subscription.id)

      expect(preview).toBeDefined()
      expect(preview.status).toBe('draft')
      expect(preview.lineItems.length).toBeGreaterThan(0)
    })
  })
})
