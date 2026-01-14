/**
 * Invoice Generation Tests - TDD RED Phase
 *
 * Comprehensive failing tests for invoice generation covering:
 * - Invoice generation from subscription
 * - Line items (description, quantity, amount)
 * - Tax calculation (rate, jurisdiction)
 * - Discounts and credits
 * - Invoice status (draft, open, paid, void)
 * - Payment recording
 * - Invoice numbering/sequencing
 * - PDF rendering
 *
 * These tests define the expected behavior for the Invoice primitive.
 * They should FAIL because the Invoice class doesn't exist yet.
 *
 * @module db/primitives/payments/tests/invoice
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// =============================================================================
// Types that should be exported from the Invoice module (don't exist yet)
// =============================================================================

// These imports will fail because the module doesn't exist yet
import {
  Invoice,
  createInvoice,
  type InvoiceConfig,
  type InvoiceLineItem,
  type InvoiceStatus,
  type InvoiceTax,
  type InvoiceDiscount,
  type InvoicePayment,
  type InvoicePDFOptions,
  type InvoicePDFResult,
  type TaxJurisdiction,
  type TaxRate,
  type CreditApplication,
  type InvoiceSubscription,
  type InvoiceNumberSequence,
} from '../invoice'

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestSubscription(overrides: Partial<InvoiceSubscription> = {}): InvoiceSubscription {
  return {
    id: `sub_${Date.now()}`,
    customerId: 'cust_test123',
    planId: 'plan_pro',
    planName: 'Pro Plan',
    pricePerUnit: 9900, // $99.00 in cents
    quantity: 1,
    currency: 'USD',
    billingCycle: 'monthly',
    currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
    status: 'active',
    ...overrides,
  }
}

function createTestLineItem(overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  return {
    id: `li_${Date.now()}`,
    type: 'one_time',
    description: 'Test item',
    unitAmount: 1000,
    quantity: 1,
    currency: 'USD',
    ...overrides,
  }
}

function createTestTaxJurisdiction(overrides: Partial<TaxJurisdiction> = {}): TaxJurisdiction {
  return {
    country: 'US',
    state: 'CA',
    city: 'San Francisco',
    postalCode: '94102',
    ...overrides,
  }
}

// =============================================================================
// Invoice Generation from Subscription Tests
// =============================================================================

describe('Invoice', () => {
  describe('generation from subscription', () => {
    it('should generate an invoice from a subscription', async () => {
      const subscription = createTestSubscription()

      const invoice = await createInvoice({
        subscription,
        customerId: subscription.customerId,
        currency: subscription.currency,
      })

      expect(invoice).toBeDefined()
      expect(invoice.id).toMatch(/^inv_/)
      expect(invoice.subscriptionId).toBe(subscription.id)
      expect(invoice.customerId).toBe(subscription.customerId)
      expect(invoice.status).toBe('draft')
    })

    it('should create subscription line item automatically', async () => {
      const subscription = createTestSubscription({
        planName: 'Enterprise Plan',
        pricePerUnit: 29900,
        quantity: 5,
      })

      const invoice = await createInvoice({ subscription })

      expect(invoice.lineItems).toHaveLength(1)
      expect(invoice.lineItems[0].type).toBe('subscription')
      expect(invoice.lineItems[0].description).toContain('Enterprise Plan')
      expect(invoice.lineItems[0].unitAmount).toBe(29900)
      expect(invoice.lineItems[0].quantity).toBe(5)
    })

    it('should calculate subtotal correctly for subscription with quantity', async () => {
      const subscription = createTestSubscription({
        pricePerUnit: 1000, // $10.00
        quantity: 10,
      })

      const invoice = await createInvoice({ subscription })

      expect(invoice.subtotal).toBe(10000) // $100.00
    })

    it('should set billing period from subscription', async () => {
      const periodStart = new Date('2026-01-15T00:00:00Z')
      const periodEnd = new Date('2026-02-15T00:00:00Z')
      const subscription = createTestSubscription({
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      })

      const invoice = await createInvoice({ subscription })

      expect(invoice.periodStart).toEqual(periodStart)
      expect(invoice.periodEnd).toEqual(periodEnd)
    })

    it('should support yearly billing cycle', async () => {
      const subscription = createTestSubscription({
        billingCycle: 'yearly',
        pricePerUnit: 99900, // $999/year
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2027-01-01'),
      })

      const invoice = await createInvoice({ subscription })

      expect(invoice.billingCycle).toBe('yearly')
      expect(invoice.subtotal).toBe(99900)
    })

    it('should handle trial subscription with zero amount', async () => {
      const subscription = createTestSubscription({
        status: 'trialing',
        trialEnd: new Date('2026-01-15'),
      })

      const invoice = await createInvoice({ subscription, isTrial: true })

      expect(invoice.subtotal).toBe(0)
      expect(invoice.total).toBe(0)
      expect(invoice.metadata?.isTrial).toBe(true)
    })

    it('should include subscription metadata in line item', async () => {
      const subscription = createTestSubscription({
        metadata: { featureFlags: ['advanced-analytics', 'api-access'] },
      })

      const invoice = await createInvoice({ subscription })

      expect(invoice.lineItems[0].metadata?.subscriptionId).toBe(subscription.id)
      expect(invoice.lineItems[0].metadata?.planId).toBe(subscription.planId)
    })
  })

  // =============================================================================
  // Line Items Tests
  // =============================================================================

  describe('line items', () => {
    let invoice: Invoice

    beforeEach(async () => {
      invoice = await createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })
    })

    describe('adding line items', () => {
      it('should add a line item with description, quantity, and amount', async () => {
        const lineItem = createTestLineItem({
          description: 'Professional Services',
          unitAmount: 15000,
          quantity: 8,
        })

        const updated = await invoice.addLineItem(lineItem)

        expect(updated.lineItems).toHaveLength(1)
        expect(updated.lineItems[0].description).toBe('Professional Services')
        expect(updated.lineItems[0].unitAmount).toBe(15000)
        expect(updated.lineItems[0].quantity).toBe(8)
      })

      it('should calculate line item total as unitAmount * quantity', async () => {
        await invoice.addLineItem({
          type: 'one_time',
          description: 'Consulting',
          unitAmount: 20000, // $200/hour
          quantity: 5, // 5 hours
        })

        const lineItem = invoice.lineItems[0]
        expect(lineItem.total).toBe(100000) // $1000.00
      })

      it('should support subscription line items', async () => {
        const updated = await invoice.addLineItem({
          type: 'subscription',
          description: 'Pro Plan - Monthly',
          unitAmount: 9900,
          quantity: 1,
          periodStart: new Date('2026-01-01'),
          periodEnd: new Date('2026-02-01'),
        })

        expect(updated.lineItems[0].type).toBe('subscription')
        expect(updated.lineItems[0].periodStart).toBeDefined()
        expect(updated.lineItems[0].periodEnd).toBeDefined()
      })

      it('should support usage-based line items', async () => {
        const updated = await invoice.addLineItem({
          type: 'usage',
          description: 'API Calls - January 2026',
          unitAmount: 1, // $0.01 per call
          quantity: 250000,
          meterId: 'meter_api_calls',
        })

        expect(updated.lineItems[0].type).toBe('usage')
        expect(updated.lineItems[0].meterId).toBe('meter_api_calls')
        expect(updated.lineItems[0].total).toBe(250000) // $2500.00
      })

      it('should support one-time line items', async () => {
        const updated = await invoice.addLineItem({
          type: 'one_time',
          description: 'Setup Fee',
          unitAmount: 50000,
          quantity: 1,
        })

        expect(updated.lineItems[0].type).toBe('one_time')
        expect(updated.subtotal).toBe(50000)
      })

      it('should generate unique line item IDs', async () => {
        await invoice.addLineItem(createTestLineItem({ description: 'Item 1' }))
        await invoice.addLineItem(createTestLineItem({ description: 'Item 2' }))
        await invoice.addLineItem(createTestLineItem({ description: 'Item 3' }))

        const ids = invoice.lineItems.map(li => li.id)
        const uniqueIds = new Set(ids)
        expect(uniqueIds.size).toBe(3)
      })

      it('should update subtotal when adding line items', async () => {
        expect(invoice.subtotal).toBe(0)

        await invoice.addLineItem({ type: 'one_time', description: 'A', unitAmount: 1000, quantity: 1 })
        expect(invoice.subtotal).toBe(1000)

        await invoice.addLineItem({ type: 'one_time', description: 'B', unitAmount: 2000, quantity: 2 })
        expect(invoice.subtotal).toBe(5000)
      })
    })

    describe('modifying line items', () => {
      it('should update line item quantity', async () => {
        await invoice.addLineItem({
          type: 'subscription',
          description: 'Seat License',
          unitAmount: 1500,
          quantity: 5,
        })

        const lineItemId = invoice.lineItems[0].id
        await invoice.updateLineItem(lineItemId, { quantity: 10 })

        expect(invoice.lineItems[0].quantity).toBe(10)
        expect(invoice.subtotal).toBe(15000)
      })

      it('should update line item description', async () => {
        await invoice.addLineItem({
          type: 'one_time',
          description: 'Original Description',
          unitAmount: 1000,
          quantity: 1,
        })

        const lineItemId = invoice.lineItems[0].id
        await invoice.updateLineItem(lineItemId, { description: 'Updated Description' })

        expect(invoice.lineItems[0].description).toBe('Updated Description')
      })

      it('should update line item amount', async () => {
        await invoice.addLineItem({
          type: 'one_time',
          description: 'Item',
          unitAmount: 1000,
          quantity: 1,
        })

        const lineItemId = invoice.lineItems[0].id
        await invoice.updateLineItem(lineItemId, { unitAmount: 2000 })

        expect(invoice.lineItems[0].unitAmount).toBe(2000)
        expect(invoice.subtotal).toBe(2000)
      })

      it('should remove line item from invoice', async () => {
        await invoice.addLineItem({ type: 'one_time', description: 'A', unitAmount: 1000, quantity: 1 })
        await invoice.addLineItem({ type: 'one_time', description: 'B', unitAmount: 2000, quantity: 1 })

        const lineItemId = invoice.lineItems[0].id
        await invoice.removeLineItem(lineItemId)

        expect(invoice.lineItems).toHaveLength(1)
        expect(invoice.lineItems[0].description).toBe('B')
        expect(invoice.subtotal).toBe(2000)
      })

      it('should throw error when modifying finalized invoice', async () => {
        await invoice.addLineItem({ type: 'one_time', description: 'Item', unitAmount: 1000, quantity: 1 })
        await invoice.finalize()

        await expect(
          invoice.addLineItem({ type: 'one_time', description: 'New', unitAmount: 500, quantity: 1 })
        ).rejects.toThrow('Cannot modify finalized invoice')
      })

      it('should throw error when updating non-existent line item', async () => {
        await expect(
          invoice.updateLineItem('li_nonexistent', { quantity: 5 })
        ).rejects.toThrow('Line item not found')
      })
    })

    describe('line item metadata', () => {
      it('should store custom metadata on line items', async () => {
        await invoice.addLineItem({
          type: 'one_time',
          description: 'Custom Work',
          unitAmount: 5000,
          quantity: 1,
          metadata: {
            projectId: 'proj_abc',
            ticketId: 'TICKET-123',
            approvedBy: 'manager@example.com',
          },
        })

        expect(invoice.lineItems[0].metadata?.projectId).toBe('proj_abc')
        expect(invoice.lineItems[0].metadata?.ticketId).toBe('TICKET-123')
      })
    })
  })

  // =============================================================================
  // Tax Calculation Tests
  // =============================================================================

  describe('tax calculation', () => {
    let invoice: Invoice

    beforeEach(async () => {
      invoice = await createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })
      await invoice.addLineItem({
        type: 'subscription',
        description: 'Pro Plan',
        unitAmount: 10000,
        quantity: 1,
      })
    })

    describe('tax rate application', () => {
      it('should apply tax rate to invoice subtotal', async () => {
        await invoice.setTaxRate({
          rate: 8.25, // 8.25%
          name: 'Sales Tax',
        })

        expect(invoice.tax).toBeDefined()
        expect(invoice.tax?.rate).toBe(8.25)
        expect(invoice.tax?.amount).toBe(825) // $8.25 on $100
        expect(invoice.total).toBe(10825)
      })

      it('should calculate tax with decimal precision', async () => {
        await invoice.addLineItem({
          type: 'one_time',
          description: 'Additional',
          unitAmount: 3333, // $33.33
          quantity: 1,
        })

        await invoice.setTaxRate({ rate: 7.5, name: 'Tax' })

        // Subtotal: $133.33, Tax: $10.00 (rounded)
        expect(invoice.subtotal).toBe(13333)
        expect(invoice.tax?.amount).toBe(1000) // Rounded to nearest cent
      })

      it('should handle zero tax rate', async () => {
        await invoice.setTaxRate({ rate: 0, name: 'No Tax' })

        expect(invoice.tax?.rate).toBe(0)
        expect(invoice.tax?.amount).toBe(0)
        expect(invoice.total).toBe(10000)
      })
    })

    describe('tax jurisdiction', () => {
      it('should apply tax based on jurisdiction', async () => {
        await invoice.setTaxJurisdiction({
          country: 'US',
          state: 'CA',
          city: 'Los Angeles',
        })

        await invoice.calculateTax()

        expect(invoice.tax).toBeDefined()
        expect(invoice.tax?.jurisdiction).toEqual({
          country: 'US',
          state: 'CA',
          city: 'Los Angeles',
        })
      })

      it('should provide tax breakdown by jurisdiction level', async () => {
        await invoice.setTaxJurisdiction({
          country: 'US',
          state: 'CA',
          city: 'Los Angeles',
          county: 'Los Angeles County',
        })

        await invoice.calculateTax()

        expect(invoice.tax?.breakdown).toBeDefined()
        expect(invoice.tax?.breakdown).toContainEqual(
          expect.objectContaining({ level: 'state', rate: expect.any(Number) })
        )
        expect(invoice.tax?.breakdown).toContainEqual(
          expect.objectContaining({ level: 'county', rate: expect.any(Number) })
        )
      })

      it('should handle VAT for EU jurisdictions', async () => {
        const euInvoice = await createInvoice({
          customerId: 'cust_eu',
          currency: 'EUR',
        })
        await euInvoice.addLineItem({
          type: 'subscription',
          description: 'Plan',
          unitAmount: 10000,
          quantity: 1,
        })

        await euInvoice.setTaxJurisdiction({ country: 'DE' })
        await euInvoice.calculateTax()

        expect(euInvoice.tax?.type).toBe('vat')
        expect(euInvoice.tax?.rate).toBe(19) // German VAT
      })

      it('should handle VAT reverse charge for B2B EU cross-border', async () => {
        const euInvoice = await createInvoice({
          customerId: 'cust_eu_business',
          currency: 'EUR',
          vatNumber: 'DE123456789',
        })
        await euInvoice.addLineItem({
          type: 'subscription',
          description: 'Plan',
          unitAmount: 10000,
          quantity: 1,
        })

        await euInvoice.setTaxJurisdiction({ country: 'FR' })
        await euInvoice.calculateTax()

        expect(euInvoice.tax?.reverseCharge).toBe(true)
        expect(euInvoice.tax?.amount).toBe(0)
      })

      it('should handle GST for Australian jurisdictions', async () => {
        const auInvoice = await createInvoice({
          customerId: 'cust_au',
          currency: 'AUD',
        })
        await auInvoice.addLineItem({
          type: 'subscription',
          description: 'Plan',
          unitAmount: 10000,
          quantity: 1,
        })

        await auInvoice.setTaxJurisdiction({ country: 'AU' })
        await auInvoice.calculateTax()

        expect(auInvoice.tax?.type).toBe('gst')
        expect(auInvoice.tax?.rate).toBe(10) // Australian GST
      })
    })

    describe('tax exemptions', () => {
      it('should handle tax-exempt customers', async () => {
        const exemptInvoice = await createInvoice({
          customerId: 'cust_nonprofit',
          currency: 'USD',
          taxExempt: true,
          taxExemptReason: 'Nonprofit organization - 501(c)(3)',
        })
        await exemptInvoice.addLineItem({
          type: 'subscription',
          description: 'Plan',
          unitAmount: 10000,
          quantity: 1,
        })

        await exemptInvoice.calculateTax()

        expect(exemptInvoice.tax?.amount).toBe(0)
        expect(exemptInvoice.taxExempt).toBe(true)
        expect(exemptInvoice.taxExemptReason).toBe('Nonprofit organization - 501(c)(3)')
      })

      it('should handle zero-rated items', async () => {
        await invoice.addLineItem({
          type: 'one_time',
          description: 'Export Service',
          unitAmount: 5000,
          quantity: 1,
          taxCategory: 'zero_rated',
        })

        await invoice.setTaxRate({ rate: 20, name: 'VAT' })

        // Only the first item should be taxed
        expect(invoice.tax?.amount).toBe(2000) // 20% of $100
      })

      it('should handle exempt items within taxable invoice', async () => {
        await invoice.addLineItem({
          type: 'one_time',
          description: 'Educational Material',
          unitAmount: 5000,
          quantity: 1,
          taxCategory: 'exempt',
        })

        await invoice.setTaxRate({ rate: 10, name: 'Tax' })

        // Only $100 is taxable, not $150
        expect(invoice.tax?.amount).toBe(1000)
      })
    })

    describe('tax recalculation', () => {
      it('should recalculate tax when line items change', async () => {
        await invoice.setTaxRate({ rate: 10, name: 'Tax' })
        expect(invoice.tax?.amount).toBe(1000) // $10 on $100

        await invoice.addLineItem({
          type: 'one_time',
          description: 'Additional',
          unitAmount: 5000,
          quantity: 1,
        })

        expect(invoice.tax?.amount).toBe(1500) // $15 on $150
      })

      it('should recalculate tax when discount is applied', async () => {
        await invoice.setTaxRate({ rate: 10, name: 'Tax' })
        expect(invoice.tax?.amount).toBe(1000)

        await invoice.applyDiscount({
          type: 'percentage',
          value: 20,
          code: 'SAVE20',
        })

        // After 20% discount: $80 subtotal, $8 tax
        expect(invoice.tax?.amount).toBe(800)
      })
    })
  })

  // =============================================================================
  // Discounts and Credits Tests
  // =============================================================================

  describe('discounts and credits', () => {
    let invoice: Invoice

    beforeEach(async () => {
      invoice = await createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })
      await invoice.addLineItem({
        type: 'subscription',
        description: 'Pro Plan',
        unitAmount: 10000,
        quantity: 1,
      })
    })

    describe('percentage discounts', () => {
      it('should apply percentage discount to subtotal', async () => {
        await invoice.applyDiscount({
          type: 'percentage',
          value: 25,
          code: 'SAVE25',
          description: '25% off',
        })

        expect(invoice.discount).toBeDefined()
        expect(invoice.discount?.type).toBe('percentage')
        expect(invoice.discount?.value).toBe(25)
        expect(invoice.discount?.amount).toBe(2500) // $25 off $100
        expect(invoice.total).toBe(7500)
      })

      it('should cap percentage discount at 100%', async () => {
        await invoice.applyDiscount({
          type: 'percentage',
          value: 150, // Invalid - should cap
          code: 'HUGE',
        })

        expect(invoice.discount?.amount).toBe(10000) // Max subtotal
        expect(invoice.total).toBe(0)
      })

      it('should apply percentage discount before tax', async () => {
        await invoice.setTaxRate({ rate: 10, name: 'Tax' })
        await invoice.applyDiscount({
          type: 'percentage',
          value: 20,
          code: 'SAVE20',
        })

        // Subtotal: $100, Discount: $20, After discount: $80, Tax: $8
        expect(invoice.discount?.amount).toBe(2000)
        expect(invoice.tax?.amount).toBe(800)
        expect(invoice.total).toBe(8800)
      })
    })

    describe('fixed amount discounts', () => {
      it('should apply fixed amount discount', async () => {
        await invoice.applyDiscount({
          type: 'fixed',
          value: 2500,
          code: 'FLAT25',
          description: '$25 off',
        })

        expect(invoice.discount?.type).toBe('fixed')
        expect(invoice.discount?.amount).toBe(2500)
        expect(invoice.total).toBe(7500)
      })

      it('should cap fixed discount at subtotal', async () => {
        await invoice.applyDiscount({
          type: 'fixed',
          value: 15000, // More than subtotal
          code: 'BIGOFF',
        })

        expect(invoice.discount?.amount).toBe(10000) // Capped at subtotal
        expect(invoice.total).toBe(0)
      })

      it('should handle currency-specific fixed discounts', async () => {
        const eurInvoice = await createInvoice({
          customerId: 'cust_eu',
          currency: 'EUR',
        })
        await eurInvoice.addLineItem({
          type: 'subscription',
          description: 'Plan',
          unitAmount: 10000,
          quantity: 1,
        })

        await eurInvoice.applyDiscount({
          type: 'fixed',
          value: 1000, // 10 EUR
          code: 'EUR10',
          currency: 'EUR',
        })

        expect(eurInvoice.discount?.amount).toBe(1000)
        expect(eurInvoice.discount?.currency).toBe('EUR')
      })
    })

    describe('coupon codes', () => {
      it('should track applied coupon code', async () => {
        await invoice.applyDiscount({
          type: 'percentage',
          value: 10,
          code: 'WELCOME10',
        })

        expect(invoice.appliedCoupons).toContain('WELCOME10')
      })

      it('should reject duplicate coupon application', async () => {
        await invoice.applyDiscount({
          type: 'percentage',
          value: 10,
          code: 'PROMO',
        })

        await expect(
          invoice.applyDiscount({
            type: 'percentage',
            value: 10,
            code: 'PROMO',
          })
        ).rejects.toThrow('Coupon already applied')
      })

      it('should not allow discount on finalized invoice', async () => {
        await invoice.finalize()

        await expect(
          invoice.applyDiscount({
            type: 'percentage',
            value: 10,
            code: 'LATE',
          })
        ).rejects.toThrow('Cannot modify finalized invoice')
      })
    })

    describe('credits', () => {
      it('should apply credit balance to invoice', async () => {
        await invoice.applyCredit({
          amount: 3000,
          source: 'account_balance',
          description: 'Account credit',
        })

        expect(invoice.credits).toHaveLength(1)
        expect(invoice.credits[0].amount).toBe(3000)
        expect(invoice.amountDue).toBe(7000)
      })

      it('should apply multiple credits', async () => {
        await invoice.applyCredit({ amount: 2000, source: 'refund', description: 'Refund credit' })
        await invoice.applyCredit({ amount: 1000, source: 'promotional', description: 'Promo credit' })

        expect(invoice.credits).toHaveLength(2)
        expect(invoice.totalCredits).toBe(3000)
        expect(invoice.amountDue).toBe(7000)
      })

      it('should cap credits at invoice total', async () => {
        await invoice.applyCredit({
          amount: 15000, // More than invoice total
          source: 'account_balance',
        })

        expect(invoice.credits[0].appliedAmount).toBe(10000)
        expect(invoice.amountDue).toBe(0)
      })

      it('should apply credit after discount and tax', async () => {
        await invoice.setTaxRate({ rate: 10, name: 'Tax' })
        await invoice.applyDiscount({
          type: 'percentage',
          value: 20,
          code: 'SAVE20',
        })
        // Subtotal: $100, Discount: $20, After discount: $80, Tax: $8, Total: $88

        await invoice.applyCredit({ amount: 2000, source: 'balance' })

        expect(invoice.total).toBe(8800) // Before credits
        expect(invoice.totalCredits).toBe(2000)
        expect(invoice.amountDue).toBe(6800)
      })

      it('should track credit application source', async () => {
        await invoice.applyCredit({
          amount: 1000,
          source: 'promotion',
          sourceId: 'promo_abc123',
          description: 'New customer promotion',
        })

        expect(invoice.credits[0].source).toBe('promotion')
        expect(invoice.credits[0].sourceId).toBe('promo_abc123')
      })
    })

    describe('removing discounts', () => {
      it('should remove discount from invoice', async () => {
        await invoice.applyDiscount({
          type: 'percentage',
          value: 20,
          code: 'SAVE20',
        })
        expect(invoice.discount).toBeDefined()

        await invoice.removeDiscount()

        expect(invoice.discount).toBeUndefined()
        expect(invoice.total).toBe(10000)
      })

      it('should recalculate totals after discount removal', async () => {
        await invoice.setTaxRate({ rate: 10, name: 'Tax' })
        await invoice.applyDiscount({
          type: 'percentage',
          value: 20,
          code: 'SAVE20',
        })
        // Total: $88

        await invoice.removeDiscount()

        expect(invoice.subtotal).toBe(10000)
        expect(invoice.tax?.amount).toBe(1000)
        expect(invoice.total).toBe(11000)
      })
    })
  })

  // =============================================================================
  // Invoice Status Tests
  // =============================================================================

  describe('invoice status', () => {
    let invoice: Invoice

    beforeEach(async () => {
      invoice = await createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })
      await invoice.addLineItem({
        type: 'subscription',
        description: 'Pro Plan',
        unitAmount: 10000,
        quantity: 1,
      })
    })

    describe('draft status', () => {
      it('should create invoice in draft status', async () => {
        expect(invoice.status).toBe('draft')
      })

      it('should allow modifications in draft status', async () => {
        await invoice.addLineItem({
          type: 'one_time',
          description: 'Additional',
          unitAmount: 500,
          quantity: 1,
        })

        expect(invoice.lineItems).toHaveLength(2)
      })

      it('should allow deletion of draft invoice', async () => {
        await invoice.delete()

        expect(invoice.status).toBe('deleted')
      })
    })

    describe('open status', () => {
      it('should transition from draft to open on finalize', async () => {
        await invoice.finalize()

        expect(invoice.status).toBe('open')
        expect(invoice.finalizedAt).toBeDefined()
      })

      it('should not allow modifications after finalization', async () => {
        await invoice.finalize()

        await expect(
          invoice.addLineItem({
            type: 'one_time',
            description: 'Late Item',
            unitAmount: 100,
            quantity: 1,
          })
        ).rejects.toThrow('Cannot modify finalized invoice')
      })

      it('should require at least one line item to finalize', async () => {
        const emptyInvoice = await createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })

        await expect(emptyInvoice.finalize()).rejects.toThrow(
          'Cannot finalize invoice with no line items'
        )
      })

      it('should set due date on finalization', async () => {
        await invoice.finalize()

        expect(invoice.dueDate).toBeDefined()
        expect(invoice.dueDate!.getTime()).toBeGreaterThan(Date.now())
      })

      it('should not allow deletion of open invoice', async () => {
        await invoice.finalize()

        await expect(invoice.delete()).rejects.toThrow('Cannot delete finalized invoice')
      })
    })

    describe('paid status', () => {
      beforeEach(async () => {
        await invoice.finalize()
      })

      it('should transition from open to paid when fully paid', async () => {
        await invoice.recordPayment({
          amount: 10000,
          method: 'card',
          paymentId: 'pay_123',
        })

        expect(invoice.status).toBe('paid')
        expect(invoice.paidAt).toBeDefined()
      })

      it('should remain open with partial payment', async () => {
        await invoice.recordPayment({
          amount: 5000,
          method: 'card',
          paymentId: 'pay_partial',
        })

        expect(invoice.status).toBe('open')
        expect(invoice.amountPaid).toBe(5000)
        expect(invoice.amountDue).toBe(5000)
      })

      it('should track payment metadata', async () => {
        await invoice.recordPayment({
          amount: 10000,
          method: 'card',
          paymentId: 'pay_xyz',
          metadata: { processorFee: 290 },
        })

        expect(invoice.paymentId).toBe('pay_xyz')
        expect(invoice.paymentMethod).toBe('card')
      })

      it('should not allow voiding paid invoice', async () => {
        await invoice.recordPayment({
          amount: 10000,
          method: 'card',
          paymentId: 'pay_123',
        })

        await expect(invoice.void()).rejects.toThrow('Cannot void paid invoice')
      })
    })

    describe('void status', () => {
      it('should void draft invoice', async () => {
        await invoice.void()

        expect(invoice.status).toBe('void')
        expect(invoice.voidedAt).toBeDefined()
      })

      it('should void open invoice', async () => {
        await invoice.finalize()
        await invoice.void()

        expect(invoice.status).toBe('void')
      })

      it('should record void reason', async () => {
        await invoice.void({ reason: 'Customer requested cancellation' })

        expect(invoice.voidReason).toBe('Customer requested cancellation')
      })

      it('should not allow voiding already void invoice', async () => {
        await invoice.void()

        await expect(invoice.void()).rejects.toThrow('Invoice already void')
      })

      it('should void partially paid invoice with refund option', async () => {
        await invoice.finalize()
        await invoice.recordPayment({
          amount: 5000,
          method: 'card',
          paymentId: 'pay_partial',
        })

        await invoice.void({ reason: 'Service cancelled', createRefund: true })

        expect(invoice.status).toBe('void')
        expect(invoice.refundId).toBeDefined()
      })
    })

    describe('uncollectible status', () => {
      it('should mark invoice as uncollectible', async () => {
        await invoice.finalize()
        await invoice.markUncollectible({ reason: 'Customer bankruptcy' })

        expect(invoice.status).toBe('uncollectible')
        expect(invoice.uncollectibleReason).toBe('Customer bankruptcy')
      })

      it('should not mark draft invoice as uncollectible', async () => {
        await expect(
          invoice.markUncollectible({ reason: 'Test' })
        ).rejects.toThrow('Cannot mark draft invoice as uncollectible')
      })
    })
  })

  // =============================================================================
  // Payment Recording Tests
  // =============================================================================

  describe('payment recording', () => {
    let invoice: Invoice

    beforeEach(async () => {
      invoice = await createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })
      await invoice.addLineItem({
        type: 'subscription',
        description: 'Pro Plan',
        unitAmount: 10000,
        quantity: 1,
      })
      await invoice.finalize()
    })

    describe('recording payments', () => {
      it('should record full payment', async () => {
        const payment = await invoice.recordPayment({
          amount: 10000,
          method: 'card',
          paymentId: 'pay_full123',
        })

        expect(payment.amount).toBe(10000)
        expect(invoice.amountPaid).toBe(10000)
        expect(invoice.amountDue).toBe(0)
        expect(invoice.status).toBe('paid')
      })

      it('should record partial payment', async () => {
        await invoice.recordPayment({
          amount: 3000,
          method: 'bank_transfer',
          paymentId: 'pay_part1',
        })

        expect(invoice.amountPaid).toBe(3000)
        expect(invoice.amountDue).toBe(7000)
        expect(invoice.status).toBe('open')
      })

      it('should record multiple partial payments', async () => {
        await invoice.recordPayment({ amount: 3000, method: 'card', paymentId: 'pay_1' })
        await invoice.recordPayment({ amount: 4000, method: 'card', paymentId: 'pay_2' })
        await invoice.recordPayment({ amount: 3000, method: 'card', paymentId: 'pay_3' })

        expect(invoice.payments).toHaveLength(3)
        expect(invoice.amountPaid).toBe(10000)
        expect(invoice.status).toBe('paid')
      })

      it('should not allow overpayment', async () => {
        await expect(
          invoice.recordPayment({
            amount: 15000,
            method: 'card',
            paymentId: 'pay_over',
          })
        ).rejects.toThrow('Payment amount exceeds amount due')
      })

      it('should track payment timestamp', async () => {
        const before = Date.now()
        await invoice.recordPayment({
          amount: 10000,
          method: 'card',
          paymentId: 'pay_123',
        })
        const after = Date.now()

        expect(invoice.paidAt).toBeDefined()
        expect(invoice.paidAt!.getTime()).toBeGreaterThanOrEqual(before)
        expect(invoice.paidAt!.getTime()).toBeLessThanOrEqual(after)
      })
    })

    describe('payment methods', () => {
      it('should record card payment', async () => {
        await invoice.recordPayment({
          amount: 10000,
          method: 'card',
          paymentId: 'pay_card',
          cardLast4: '4242',
          cardBrand: 'visa',
        })

        expect(invoice.paymentMethod).toBe('card')
        expect(invoice.payments[0].cardLast4).toBe('4242')
        expect(invoice.payments[0].cardBrand).toBe('visa')
      })

      it('should record bank transfer payment', async () => {
        await invoice.recordPayment({
          amount: 10000,
          method: 'bank_transfer',
          paymentId: 'pay_bank',
          reference: 'WIRE-12345',
        })

        expect(invoice.paymentMethod).toBe('bank_transfer')
        expect(invoice.payments[0].reference).toBe('WIRE-12345')
      })

      it('should record ACH payment', async () => {
        await invoice.recordPayment({
          amount: 10000,
          method: 'ach',
          paymentId: 'pay_ach',
          bankName: 'Chase',
          accountLast4: '1234',
        })

        expect(invoice.paymentMethod).toBe('ach')
        expect(invoice.payments[0].bankName).toBe('Chase')
      })

      it('should record check payment', async () => {
        await invoice.recordPayment({
          amount: 10000,
          method: 'check',
          paymentId: 'pay_check',
          checkNumber: '1001',
        })

        expect(invoice.paymentMethod).toBe('check')
        expect(invoice.payments[0].checkNumber).toBe('1001')
      })

      it('should record other payment method', async () => {
        await invoice.recordPayment({
          amount: 10000,
          method: 'other',
          paymentId: 'pay_other',
          description: 'Bitcoin',
          reference: 'tx_abc123...',
        })

        expect(invoice.paymentMethod).toBe('other')
      })
    })

    describe('payment on draft invoice', () => {
      it('should not allow payment on draft invoice', async () => {
        const draftInvoice = await createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
        })
        await draftInvoice.addLineItem({
          type: 'subscription',
          description: 'Plan',
          unitAmount: 10000,
          quantity: 1,
        })

        await expect(
          draftInvoice.recordPayment({
            amount: 10000,
            method: 'card',
            paymentId: 'pay_123',
          })
        ).rejects.toThrow('Cannot record payment on draft invoice')
      })
    })

    describe('payment refunds', () => {
      it('should record payment refund', async () => {
        await invoice.recordPayment({
          amount: 10000,
          method: 'card',
          paymentId: 'pay_123',
        })

        await invoice.recordRefund({
          amount: 5000,
          paymentId: 'pay_123',
          refundId: 'ref_456',
          reason: 'Partial service not delivered',
        })

        expect(invoice.refunds).toHaveLength(1)
        expect(invoice.amountRefunded).toBe(5000)
      })

      it('should update invoice status after full refund', async () => {
        await invoice.recordPayment({
          amount: 10000,
          method: 'card',
          paymentId: 'pay_123',
        })

        await invoice.recordRefund({
          amount: 10000,
          paymentId: 'pay_123',
          refundId: 'ref_full',
          reason: 'Complete refund requested',
        })

        expect(invoice.status).toBe('void')
      })
    })
  })

  // =============================================================================
  // Invoice Numbering/Sequencing Tests
  // =============================================================================

  describe('invoice numbering/sequencing', () => {
    describe('sequential numbering', () => {
      it('should assign sequential invoice numbers', async () => {
        const invoice1 = await createInvoice({ customerId: 'cust_1', currency: 'USD' })
        await invoice1.addLineItem({ type: 'one_time', description: 'Item', unitAmount: 100, quantity: 1 })
        await invoice1.finalize()

        const invoice2 = await createInvoice({ customerId: 'cust_2', currency: 'USD' })
        await invoice2.addLineItem({ type: 'one_time', description: 'Item', unitAmount: 100, quantity: 1 })
        await invoice2.finalize()

        const num1 = parseInt(invoice1.invoiceNumber!.replace(/\D/g, ''))
        const num2 = parseInt(invoice2.invoiceNumber!.replace(/\D/g, ''))

        expect(num2).toBe(num1 + 1)
      })

      it('should not assign number to draft invoice', async () => {
        const invoice = await createInvoice({ customerId: 'cust_1', currency: 'USD' })

        expect(invoice.invoiceNumber).toBeUndefined()
      })

      it('should preserve number after status changes', async () => {
        const invoice = await createInvoice({ customerId: 'cust_1', currency: 'USD' })
        await invoice.addLineItem({ type: 'one_time', description: 'Item', unitAmount: 100, quantity: 1 })
        await invoice.finalize()
        const originalNumber = invoice.invoiceNumber

        await invoice.recordPayment({ amount: 100, method: 'card', paymentId: 'pay_1' })

        expect(invoice.invoiceNumber).toBe(originalNumber)
      })
    })

    describe('number format configuration', () => {
      it('should use configured prefix', async () => {
        const invoice = await createInvoice({
          customerId: 'cust_1',
          currency: 'USD',
          numberingConfig: { prefix: 'ACME' },
        })
        await invoice.addLineItem({ type: 'one_time', description: 'Item', unitAmount: 100, quantity: 1 })
        await invoice.finalize()

        expect(invoice.invoiceNumber).toMatch(/^ACME-\d+$/)
      })

      it('should use configured zero padding', async () => {
        const invoice = await createInvoice({
          customerId: 'cust_1',
          currency: 'USD',
          numberingConfig: { prefix: 'INV', padding: 8 },
        })
        await invoice.addLineItem({ type: 'one_time', description: 'Item', unitAmount: 100, quantity: 1 })
        await invoice.finalize()

        expect(invoice.invoiceNumber).toMatch(/^INV-\d{8}$/)
      })

      it('should support year-month-sequence format', async () => {
        const invoice = await createInvoice({
          customerId: 'cust_1',
          currency: 'USD',
          numberingConfig: { format: 'year-month-sequence' },
        })
        await invoice.addLineItem({ type: 'one_time', description: 'Item', unitAmount: 100, quantity: 1 })
        await invoice.finalize()

        // Format: 2026-01-0001
        expect(invoice.invoiceNumber).toMatch(/^\d{4}-\d{2}-\d+$/)
      })

      it('should support custom format function', async () => {
        const invoice = await createInvoice({
          customerId: 'cust_1',
          currency: 'USD',
          numberingConfig: {
            formatFunction: (seq: number, date: Date) =>
              `CORP-${date.getFullYear()}-${String(seq).padStart(6, '0')}`,
          },
        })
        await invoice.addLineItem({ type: 'one_time', description: 'Item', unitAmount: 100, quantity: 1 })
        await invoice.finalize()

        expect(invoice.invoiceNumber).toMatch(/^CORP-2026-\d{6}$/)
      })

      it('should support configured starting number', async () => {
        const invoice = await createInvoice({
          customerId: 'cust_1',
          currency: 'USD',
          numberingConfig: { prefix: 'INV', startingNumber: 10000 },
        })
        await invoice.addLineItem({ type: 'one_time', description: 'Item', unitAmount: 100, quantity: 1 })
        await invoice.finalize()

        const num = parseInt(invoice.invoiceNumber!.replace(/\D/g, ''))
        expect(num).toBeGreaterThanOrEqual(10000)
      })
    })

    describe('yearly sequence reset', () => {
      it('should reset sequence at year boundary when configured', async () => {
        // This would require mocking dates, but the concept should be tested
        const invoice = await createInvoice({
          customerId: 'cust_1',
          currency: 'USD',
          numberingConfig: {
            format: 'year-sequence',
            resetYearly: true,
          },
        })
        await invoice.addLineItem({ type: 'one_time', description: 'Item', unitAmount: 100, quantity: 1 })
        await invoice.finalize()

        expect(invoice.invoiceNumber).toMatch(/^2026-\d+$/)
      })
    })

    describe('lookup by invoice number', () => {
      it('should find invoice by number', async () => {
        const invoice = await createInvoice({ customerId: 'cust_1', currency: 'USD' })
        await invoice.addLineItem({ type: 'one_time', description: 'Item', unitAmount: 100, quantity: 1 })
        await invoice.finalize()

        const found = await Invoice.findByNumber(invoice.invoiceNumber!)

        expect(found).toBeDefined()
        expect(found!.id).toBe(invoice.id)
      })

      it('should return null for non-existent invoice number', async () => {
        const found = await Invoice.findByNumber('INV-99999999')

        expect(found).toBeNull()
      })
    })
  })

  // =============================================================================
  // PDF Rendering Tests
  // =============================================================================

  describe('PDF rendering', () => {
    let invoice: Invoice

    beforeEach(async () => {
      invoice = await createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
        billingAddress: {
          name: 'John Doe',
          line1: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          postalCode: '94102',
          country: 'US',
        },
      })
      await invoice.addLineItem({
        type: 'subscription',
        description: 'Pro Plan - Monthly',
        unitAmount: 9900,
        quantity: 1,
      })
      await invoice.finalize()
    })

    describe('generating PDF', () => {
      it('should generate PDF for finalized invoice', async () => {
        const pdf = await invoice.generatePDF()

        expect(pdf).toBeDefined()
        expect(pdf.data).toBeInstanceOf(Uint8Array)
        expect(pdf.contentType).toBe('application/pdf')
      })

      it('should include invoice number in filename', async () => {
        const pdf = await invoice.generatePDF()

        expect(pdf.filename).toContain(invoice.invoiceNumber)
        expect(pdf.filename).toMatch(/\.pdf$/)
      })

      it('should not generate PDF for draft invoice', async () => {
        const draftInvoice = await createInvoice({ customerId: 'cust_123', currency: 'USD' })
        await draftInvoice.addLineItem({
          type: 'one_time',
          description: 'Item',
          unitAmount: 1000,
          quantity: 1,
        })

        await expect(draftInvoice.generatePDF()).rejects.toThrow(
          'Cannot generate PDF for draft invoice'
        )
      })
    })

    describe('PDF content', () => {
      it('should include invoice metadata in PDF', async () => {
        const pdf = await invoice.generatePDF()

        expect(pdf.metadata?.invoiceNumber).toBe(invoice.invoiceNumber)
        expect(pdf.metadata?.customerId).toBe(invoice.customerId)
        expect(pdf.metadata?.invoiceDate).toBeDefined()
      })

      it('should include line items in PDF', async () => {
        const pdf = await invoice.generatePDF()

        expect(pdf.metadata?.lineItemCount).toBe(1)
        expect(pdf.metadata?.subtotal).toBe(9900)
      })

      it('should include billing address in PDF', async () => {
        const pdf = await invoice.generatePDF()

        expect(pdf.metadata?.billingAddress).toContain('John Doe')
        expect(pdf.metadata?.billingAddress).toContain('San Francisco')
      })

      it('should include tax details when applicable', async () => {
        await invoice.setTaxRate({ rate: 8.25, name: 'CA Sales Tax' })
        const pdf = await invoice.generatePDF()

        expect(pdf.metadata?.taxAmount).toBeDefined()
        expect(pdf.metadata?.taxRate).toBe(8.25)
      })

      it('should include discount details when applicable', async () => {
        const invoiceWithDiscount = await createInvoice({ customerId: 'cust_123', currency: 'USD' })
        await invoiceWithDiscount.addLineItem({
          type: 'subscription',
          description: 'Plan',
          unitAmount: 10000,
          quantity: 1,
        })
        await invoiceWithDiscount.applyDiscount({
          type: 'percentage',
          value: 20,
          code: 'SAVE20',
        })
        await invoiceWithDiscount.finalize()

        const pdf = await invoiceWithDiscount.generatePDF()

        expect(pdf.metadata?.discountAmount).toBe(2000)
        expect(pdf.metadata?.couponCode).toBe('SAVE20')
      })
    })

    describe('PDF templates', () => {
      it('should support default template', async () => {
        const pdf = await invoice.generatePDF()

        expect(pdf.template).toBe('default')
      })

      it('should support minimal template', async () => {
        const pdf = await invoice.generatePDF({ template: 'minimal' })

        expect(pdf.template).toBe('minimal')
      })

      it('should support detailed template', async () => {
        const pdf = await invoice.generatePDF({ template: 'detailed' })

        expect(pdf.template).toBe('detailed')
      })
    })

    describe('PDF branding', () => {
      it('should include company name in PDF', async () => {
        const brandedInvoice = await createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
          companyInfo: {
            name: 'Acme Corporation',
            address: '456 Business Ave',
            taxId: 'US12-3456789',
          },
        })
        await brandedInvoice.addLineItem({
          type: 'one_time',
          description: 'Item',
          unitAmount: 1000,
          quantity: 1,
        })
        await brandedInvoice.finalize()

        const pdf = await brandedInvoice.generatePDF()

        expect(pdf.metadata?.companyName).toBe('Acme Corporation')
      })

      it('should include company logo when provided', async () => {
        const brandedInvoice = await createInvoice({
          customerId: 'cust_123',
          currency: 'USD',
          companyInfo: {
            name: 'Acme Corp',
            logoUrl: 'https://example.com/logo.png',
          },
        })
        await brandedInvoice.addLineItem({
          type: 'one_time',
          description: 'Item',
          unitAmount: 1000,
          quantity: 1,
        })
        await brandedInvoice.finalize()

        const pdf = await brandedInvoice.generatePDF()

        expect(pdf.metadata?.hasLogo).toBe(true)
      })
    })

    describe('PDF URL generation', () => {
      it('should generate hosted PDF URL', async () => {
        const url = await invoice.getPDFUrl()

        expect(url).toMatch(/^https:\/\//)
        expect(url).toContain(invoice.id)
      })

      it('should support expiring PDF URLs', async () => {
        const url = await invoice.getPDFUrl({ expiresIn: 3600 }) // 1 hour

        expect(url).toMatch(/^https:\/\//)
        expect(url).toContain('expires=')
      })
    })

    describe('PDF localization', () => {
      it('should support locale for PDF formatting', async () => {
        const deInvoice = await createInvoice({
          customerId: 'cust_de',
          currency: 'EUR',
          locale: 'de-DE',
        })
        await deInvoice.addLineItem({
          type: 'subscription',
          description: 'Pro-Plan',
          unitAmount: 9900,
          quantity: 1,
        })
        await deInvoice.finalize()

        const pdf = await deInvoice.generatePDF()

        expect(pdf.metadata?.locale).toBe('de-DE')
      })

      it('should format currency according to locale', async () => {
        const jpInvoice = await createInvoice({
          customerId: 'cust_jp',
          currency: 'JPY',
          locale: 'ja-JP',
        })
        await jpInvoice.addLineItem({
          type: 'subscription',
          description: 'Pro Plan',
          unitAmount: 9900, // 9900 JPY
          quantity: 1,
        })
        await jpInvoice.finalize()

        const pdf = await jpInvoice.generatePDF()

        expect(pdf.metadata?.formattedTotal).toContain('\u00A5') // Yen symbol
      })
    })
  })

  // =============================================================================
  // Payment Status Tracking Tests
  // =============================================================================

  describe('payment status tracking', () => {
    let invoice: Invoice

    beforeEach(async () => {
      invoice = await createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
      })
      await invoice.addLineItem({
        type: 'subscription',
        description: 'Pro Plan',
        unitAmount: 10000,
        quantity: 1,
      })
      await invoice.finalize()
    })

    describe('payment attempt tracking', () => {
      it('should track successful payment attempt', async () => {
        await invoice.recordPaymentAttempt({
          status: 'succeeded',
          amount: 10000,
          method: 'card',
          paymentId: 'pay_123',
        })

        expect(invoice.paymentAttempts).toHaveLength(1)
        expect(invoice.paymentAttempts[0].status).toBe('succeeded')
      })

      it('should track failed payment attempt', async () => {
        await invoice.recordPaymentAttempt({
          status: 'failed',
          amount: 10000,
          method: 'card',
          error: 'card_declined',
          errorMessage: 'Your card was declined',
        })

        expect(invoice.paymentAttempts).toHaveLength(1)
        expect(invoice.paymentAttempts[0].status).toBe('failed')
        expect(invoice.paymentAttempts[0].error).toBe('card_declined')
      })

      it('should track multiple payment attempts', async () => {
        await invoice.recordPaymentAttempt({
          status: 'failed',
          amount: 10000,
          method: 'card',
          error: 'card_declined',
        })
        await invoice.recordPaymentAttempt({
          status: 'failed',
          amount: 10000,
          method: 'card',
          error: 'insufficient_funds',
        })
        await invoice.recordPaymentAttempt({
          status: 'succeeded',
          amount: 10000,
          method: 'card',
          paymentId: 'pay_final',
        })

        expect(invoice.paymentAttempts).toHaveLength(3)
        expect(invoice.status).toBe('paid')
      })
    })

    describe('past due tracking', () => {
      it('should mark invoice as past due after due date', async () => {
        // Simulate past due date
        await invoice.markPastDue()

        expect(invoice.pastDue).toBe(true)
      })

      it('should calculate days past due', async () => {
        await invoice.markPastDue()

        expect(invoice.daysPastDue).toBeGreaterThanOrEqual(0)
      })
    })

    describe('next payment attempt scheduling', () => {
      it('should schedule next payment attempt after failure', async () => {
        await invoice.recordPaymentAttempt({
          status: 'failed',
          amount: 10000,
          method: 'card',
          error: 'card_declined',
        })

        expect(invoice.nextPaymentAttempt).toBeDefined()
        expect(invoice.nextPaymentAttempt!.getTime()).toBeGreaterThan(Date.now())
      })

      it('should use exponential backoff for retry scheduling', async () => {
        await invoice.recordPaymentAttempt({
          status: 'failed',
          amount: 10000,
          method: 'card',
          error: 'card_declined',
        })
        const firstRetry = invoice.nextPaymentAttempt

        await invoice.recordPaymentAttempt({
          status: 'failed',
          amount: 10000,
          method: 'card',
          error: 'card_declined',
        })
        const secondRetry = invoice.nextPaymentAttempt

        // Second retry should be scheduled later than first
        expect(secondRetry!.getTime()).toBeGreaterThan(firstRetry!.getTime())
      })
    })
  })

  // =============================================================================
  // Invoice Querying Tests
  // =============================================================================

  describe('invoice querying', () => {
    beforeEach(async () => {
      // Create multiple test invoices
      for (let i = 0; i < 5; i++) {
        const inv = await createInvoice({
          customerId: i < 3 ? 'cust_a' : 'cust_b',
          currency: 'USD',
        })
        await inv.addLineItem({ type: 'one_time', description: `Item ${i}`, unitAmount: 1000 * (i + 1), quantity: 1 })
        if (i < 2) await inv.finalize()
        if (i === 0) await inv.recordPayment({ amount: 1000, method: 'card', paymentId: 'pay_0' })
      }
    })

    it('should list invoices by customer', async () => {
      const invoices = await Invoice.listByCustomer('cust_a')

      expect(invoices).toHaveLength(3)
      expect(invoices.every(inv => inv.customerId === 'cust_a')).toBe(true)
    })

    it('should filter invoices by status', async () => {
      const paidInvoices = await Invoice.listByCustomer('cust_a', { status: 'paid' })
      const draftInvoices = await Invoice.listByCustomer('cust_a', { status: 'draft' })

      expect(paidInvoices).toHaveLength(1)
      expect(draftInvoices).toHaveLength(1)
    })

    it('should paginate invoice results', async () => {
      // Create more invoices
      for (let i = 0; i < 15; i++) {
        const inv = await createInvoice({ customerId: 'cust_paginate', currency: 'USD' })
        await inv.addLineItem({ type: 'one_time', description: `Item ${i}`, unitAmount: 100, quantity: 1 })
      }

      const page1 = await Invoice.listByCustomer('cust_paginate', { limit: 10 })
      const page2 = await Invoice.listByCustomer('cust_paginate', { limit: 10, startingAfter: page1[9].id })

      expect(page1).toHaveLength(10)
      expect(page2).toHaveLength(5)
    })

    it('should filter invoices by date range', async () => {
      const invoices = await Invoice.listByCustomer('cust_a', {
        createdAfter: new Date('2026-01-01'),
        createdBefore: new Date('2026-12-31'),
      })

      expect(invoices.length).toBeGreaterThanOrEqual(1)
    })

    it('should sort invoices by creation date descending', async () => {
      const invoices = await Invoice.listByCustomer('cust_a')

      for (let i = 0; i < invoices.length - 1; i++) {
        expect(invoices[i].createdAt.getTime()).toBeGreaterThanOrEqual(invoices[i + 1].createdAt.getTime())
      }
    })
  })

  // =============================================================================
  // Invoice Events Tests
  // =============================================================================

  describe('invoice events', () => {
    let invoice: Invoice
    let eventLog: Array<{ type: string; data: unknown }>

    beforeEach(async () => {
      eventLog = []
      invoice = await createInvoice({
        customerId: 'cust_123',
        currency: 'USD',
        onEvent: (event) => eventLog.push(event),
      })
      await invoice.addLineItem({
        type: 'subscription',
        description: 'Pro Plan',
        unitAmount: 10000,
        quantity: 1,
      })
    })

    it('should emit invoice.created event', async () => {
      expect(eventLog.some(e => e.type === 'invoice.created')).toBe(true)
    })

    it('should emit invoice.finalized event', async () => {
      await invoice.finalize()

      expect(eventLog.some(e => e.type === 'invoice.finalized')).toBe(true)
    })

    it('should emit invoice.paid event', async () => {
      await invoice.finalize()
      await invoice.recordPayment({ amount: 10000, method: 'card', paymentId: 'pay_123' })

      expect(eventLog.some(e => e.type === 'invoice.paid')).toBe(true)
    })

    it('should emit invoice.payment_failed event', async () => {
      await invoice.finalize()
      await invoice.recordPaymentAttempt({
        status: 'failed',
        amount: 10000,
        method: 'card',
        error: 'card_declined',
      })

      expect(eventLog.some(e => e.type === 'invoice.payment_failed')).toBe(true)
    })

    it('should emit invoice.voided event', async () => {
      await invoice.void()

      expect(eventLog.some(e => e.type === 'invoice.voided')).toBe(true)
    })

    it('should include event metadata', async () => {
      const createdEvent = eventLog.find(e => e.type === 'invoice.created')

      expect(createdEvent).toBeDefined()
      expect(createdEvent!.data).toHaveProperty('invoiceId')
      expect(createdEvent!.data).toHaveProperty('customerId')
      expect(createdEvent!.data).toHaveProperty('timestamp')
    })
  })
})
