import { describe, it, expect, beforeEach, vi } from 'vitest'
import type {
  Invoice,
  InvoiceLineItem,
  InvoiceStatus,
  Discount,
  TaxConfig,
  PaymentApplication,
  InvoiceRenderOptions,
} from '../types'
import {
  createInvoice,
  generateInvoiceFromSubscription,
  addLineItem,
  applyDiscount,
  applyCoupon,
  calculateTax,
  applyPayment,
  transitionStatus,
  renderInvoice,
  getNextInvoiceNumber,
  type InvoiceGenerator,
  type Subscription,
  type Coupon,
} from '../invoices'

// ============================================================================
// TEST FIXTURES
// ============================================================================

const defaultSubscription: Subscription = {
  id: 'sub-123',
  customerId: 'cust-456',
  planId: 'plan-pro',
  planName: 'Pro Plan',
  amount: 9900, // $99.00 in cents
  currency: 'usd',
  interval: 'month',
  currentPeriodStart: new Date('2025-01-01'),
  currentPeriodEnd: new Date('2025-01-31'),
  status: 'active',
}

const defaultTaxConfig: TaxConfig = {
  enabled: true,
  rate: 0.08, // 8%
  inclusive: false,
  jurisdiction: 'US-CA',
}

const defaultCoupon: Coupon = {
  id: 'coupon-123',
  code: 'SAVE20',
  type: 'percent',
  value: 20, // 20% off
  maxRedemptions: 100,
  timesRedeemed: 0,
  validUntil: new Date('2025-12-31'),
}

// ============================================================================
// INVOICE GENERATION FROM SUBSCRIPTION
// ============================================================================

describe('Invoice Generation from Subscription', () => {
  describe('generateInvoiceFromSubscription', () => {
    it('should create an invoice from a subscription', () => {
      const invoice = generateInvoiceFromSubscription(defaultSubscription)

      expect(invoice).toBeDefined()
      expect(invoice.subscriptionId).toBe('sub-123')
      expect(invoice.customerId).toBe('cust-456')
    })

    it('should set invoice period from subscription billing period', () => {
      const invoice = generateInvoiceFromSubscription(defaultSubscription)

      expect(invoice.periodStart).toEqual(new Date('2025-01-01'))
      expect(invoice.periodEnd).toEqual(new Date('2025-01-31'))
    })

    it('should create a line item for the subscription amount', () => {
      const invoice = generateInvoiceFromSubscription(defaultSubscription)

      expect(invoice.lineItems).toHaveLength(1)
      expect(invoice.lineItems[0].description).toBe('Pro Plan')
      expect(invoice.lineItems[0].amount).toBe(9900)
      expect(invoice.lineItems[0].quantity).toBe(1)
    })

    it('should set currency from subscription', () => {
      const invoice = generateInvoiceFromSubscription(defaultSubscription)

      expect(invoice.currency).toBe('usd')
    })

    it('should calculate subtotal correctly', () => {
      const invoice = generateInvoiceFromSubscription(defaultSubscription)

      expect(invoice.subtotal).toBe(9900)
    })

    it('should create invoice in draft status', () => {
      const invoice = generateInvoiceFromSubscription(defaultSubscription)

      expect(invoice.status).toBe('draft')
    })

    it('should handle annual subscription billing', () => {
      const annualSubscription: Subscription = {
        ...defaultSubscription,
        amount: 99900, // $999.00/year
        interval: 'year',
        currentPeriodStart: new Date('2025-01-01'),
        currentPeriodEnd: new Date('2025-12-31'),
      }

      const invoice = generateInvoiceFromSubscription(annualSubscription)

      expect(invoice.lineItems[0].amount).toBe(99900)
      expect(invoice.subtotal).toBe(99900)
    })
  })
})

// ============================================================================
// LINE ITEMS
// ============================================================================

describe('Invoice Line Items', () => {
  let invoice: Invoice

  beforeEach(() => {
    invoice = generateInvoiceFromSubscription(defaultSubscription)
  })

  describe('addLineItem', () => {
    it('should add a line item to the invoice', () => {
      const lineItem: InvoiceLineItem = {
        id: 'item-1',
        description: 'Additional API calls',
        amount: 1000,
        quantity: 1,
      }

      const updated = addLineItem(invoice, lineItem)

      expect(updated.lineItems).toHaveLength(2)
      expect(updated.lineItems[1]).toEqual(lineItem)
    })

    it('should update subtotal when adding line items', () => {
      const lineItem: InvoiceLineItem = {
        id: 'item-1',
        description: 'Additional API calls',
        amount: 1000,
        quantity: 1,
      }

      const updated = addLineItem(invoice, lineItem)

      expect(updated.subtotal).toBe(10900) // 9900 + 1000
    })

    it('should calculate line item total based on quantity', () => {
      const lineItem: InvoiceLineItem = {
        id: 'item-1',
        description: 'Extra seats',
        amount: 500,
        quantity: 5,
      }

      const updated = addLineItem(invoice, lineItem)

      expect(updated.subtotal).toBe(12400) // 9900 + (500 * 5)
    })

    it('should support unit price and quantity', () => {
      const lineItem: InvoiceLineItem = {
        id: 'item-1',
        description: 'Usage overage',
        unitPrice: 0.01, // $0.01 per unit
        quantity: 10000,
        amount: 10000, // $100 total
      }

      const updated = addLineItem(invoice, lineItem)

      expect(updated.lineItems[1].unitPrice).toBe(0.01)
      expect(updated.lineItems[1].quantity).toBe(10000)
    })

    it('should support metadata on line items', () => {
      const lineItem: InvoiceLineItem = {
        id: 'item-1',
        description: 'Pro-rated upgrade',
        amount: 2500,
        quantity: 1,
        metadata: {
          upgradeFrom: 'basic',
          upgradeTo: 'pro',
          daysRemaining: 15,
        },
      }

      const updated = addLineItem(invoice, lineItem)

      expect(updated.lineItems[1].metadata).toEqual({
        upgradeFrom: 'basic',
        upgradeTo: 'pro',
        daysRemaining: 15,
      })
    })

    it('should generate line item ID if not provided', () => {
      const lineItem: Omit<InvoiceLineItem, 'id'> = {
        description: 'Setup fee',
        amount: 5000,
        quantity: 1,
      }

      const updated = addLineItem(invoice, lineItem as InvoiceLineItem)

      expect(updated.lineItems[1].id).toBeDefined()
      expect(typeof updated.lineItems[1].id).toBe('string')
    })
  })
})

// ============================================================================
// DISCOUNTS AND COUPONS
// ============================================================================

describe('Discounts and Coupons', () => {
  let invoice: Invoice

  beforeEach(() => {
    invoice = generateInvoiceFromSubscription(defaultSubscription)
  })

  describe('applyDiscount', () => {
    it('should apply percentage discount', () => {
      const discount: Discount = {
        type: 'percent',
        value: 10, // 10% off
        description: 'Loyalty discount',
      }

      const updated = applyDiscount(invoice, discount)

      expect(updated.discounts).toHaveLength(1)
      expect(updated.discountTotal).toBe(990) // 10% of 9900
    })

    it('should apply fixed amount discount', () => {
      const discount: Discount = {
        type: 'fixed',
        value: 1500, // $15 off
        description: 'Credit applied',
      }

      const updated = applyDiscount(invoice, discount)

      expect(updated.discounts).toHaveLength(1)
      expect(updated.discountTotal).toBe(1500)
    })

    it('should stack multiple discounts', () => {
      const discount1: Discount = {
        type: 'fixed',
        value: 500,
        description: 'Referral credit',
      }
      const discount2: Discount = {
        type: 'fixed',
        value: 300,
        description: 'Support credit',
      }

      let updated = applyDiscount(invoice, discount1)
      updated = applyDiscount(updated, discount2)

      expect(updated.discounts).toHaveLength(2)
      expect(updated.discountTotal).toBe(800)
    })

    it('should not allow discount to exceed subtotal', () => {
      const discount: Discount = {
        type: 'fixed',
        value: 15000, // More than invoice total
        description: 'Huge credit',
      }

      const updated = applyDiscount(invoice, discount)

      expect(updated.discountTotal).toBe(9900) // Capped at subtotal
      expect(updated.total).toBe(0)
    })

    it('should apply discount before tax calculation', () => {
      const discount: Discount = {
        type: 'percent',
        value: 50,
        description: 'Half off',
      }

      let updated = applyDiscount(invoice, discount)
      updated = calculateTax(updated, defaultTaxConfig)

      // Subtotal: 9900, Discount: 4950, Taxable: 4950, Tax: 396
      expect(updated.tax).toBe(396)
      expect(updated.total).toBe(5346)
    })
  })

  describe('applyCoupon', () => {
    it('should apply coupon code', () => {
      const updated = applyCoupon(invoice, defaultCoupon)

      expect(updated.coupon).toEqual(defaultCoupon)
      expect(updated.discountTotal).toBe(1980) // 20% of 9900
    })

    it('should validate coupon is not expired', () => {
      const expiredCoupon: Coupon = {
        ...defaultCoupon,
        validUntil: new Date('2024-01-01'),
      }

      expect(() => applyCoupon(invoice, expiredCoupon)).toThrow('coupon_expired')
    })

    it('should validate coupon redemption limit', () => {
      const maxedCoupon: Coupon = {
        ...defaultCoupon,
        maxRedemptions: 100,
        timesRedeemed: 100,
      }

      expect(() => applyCoupon(invoice, maxedCoupon)).toThrow('coupon_max_redemptions')
    })

    it('should apply fixed amount coupon', () => {
      const fixedCoupon: Coupon = {
        ...defaultCoupon,
        type: 'fixed',
        value: 2500, // $25 off
      }

      const updated = applyCoupon(invoice, fixedCoupon)

      expect(updated.discountTotal).toBe(2500)
    })

    it('should only allow one coupon per invoice', () => {
      const updated = applyCoupon(invoice, defaultCoupon)

      const secondCoupon: Coupon = {
        ...defaultCoupon,
        id: 'coupon-456',
        code: 'SAVE10',
        value: 10,
      }

      expect(() => applyCoupon(updated, secondCoupon)).toThrow('coupon_already_applied')
    })

    it('should combine coupon with other discounts', () => {
      const discount: Discount = {
        type: 'fixed',
        value: 500,
        description: 'Credit',
      }

      let updated = applyDiscount(invoice, discount)
      updated = applyCoupon(updated, defaultCoupon)

      // Fixed discount: 500, Coupon: 20% of 9900 = 1980
      expect(updated.discountTotal).toBe(2480)
    })
  })
})

// ============================================================================
// TAX CALCULATION
// ============================================================================

describe('Tax Calculation', () => {
  let invoice: Invoice

  beforeEach(() => {
    invoice = generateInvoiceFromSubscription(defaultSubscription)
  })

  describe('calculateTax', () => {
    it('should calculate tax on subtotal', () => {
      const updated = calculateTax(invoice, defaultTaxConfig)

      expect(updated.tax).toBe(792) // 8% of 9900
      expect(updated.taxRate).toBe(0.08)
    })

    it('should add tax to total', () => {
      const updated = calculateTax(invoice, defaultTaxConfig)

      expect(updated.total).toBe(10692) // 9900 + 792
    })

    it('should calculate tax after discounts', () => {
      const discount: Discount = {
        type: 'fixed',
        value: 1000,
        description: 'Credit',
      }

      let updated = applyDiscount(invoice, discount)
      updated = calculateTax(updated, defaultTaxConfig)

      // Taxable: 8900, Tax: 712
      expect(updated.tax).toBe(712)
      expect(updated.total).toBe(9612) // 8900 + 712
    })

    it('should handle tax-inclusive pricing', () => {
      const inclusiveTax: TaxConfig = {
        ...defaultTaxConfig,
        inclusive: true,
      }

      const updated = calculateTax(invoice, inclusiveTax)

      // Tax is included in the 9900, so tax = 9900 - (9900 / 1.08)
      expect(updated.tax).toBe(733)
      expect(updated.total).toBe(9900)
    })

    it('should support multiple tax rates (combined)', () => {
      const multiTaxConfig: TaxConfig = {
        enabled: true,
        rates: [
          { name: 'State', rate: 0.06 },
          { name: 'County', rate: 0.02 },
        ],
        inclusive: false,
        jurisdiction: 'US-CA',
      }

      const updated = calculateTax(invoice, multiTaxConfig)

      // Total tax: 8% (6% + 2%)
      expect(updated.tax).toBe(792)
      expect(updated.taxBreakdown).toEqual([
        { name: 'State', amount: 594 },
        { name: 'County', amount: 198 },
      ])
    })

    it('should skip tax when disabled', () => {
      const noTaxConfig: TaxConfig = {
        enabled: false,
        rate: 0.08,
        inclusive: false,
        jurisdiction: 'US-CA',
      }

      const updated = calculateTax(invoice, noTaxConfig)

      expect(updated.tax).toBe(0)
      expect(updated.total).toBe(9900)
    })

    it('should handle zero tax rate', () => {
      const zeroTaxConfig: TaxConfig = {
        enabled: true,
        rate: 0,
        inclusive: false,
        jurisdiction: 'US-OR', // Oregon has no sales tax
      }

      const updated = calculateTax(invoice, zeroTaxConfig)

      expect(updated.tax).toBe(0)
      expect(updated.total).toBe(9900)
    })

    it('should store tax jurisdiction on invoice', () => {
      const updated = calculateTax(invoice, defaultTaxConfig)

      expect(updated.taxJurisdiction).toBe('US-CA')
    })

    it('should handle VAT reverse charge', () => {
      const vatConfig: TaxConfig = {
        enabled: true,
        rate: 0.19,
        inclusive: false,
        jurisdiction: 'EU-DE',
        reverseCharge: true,
      }

      const updated = calculateTax(invoice, vatConfig)

      expect(updated.tax).toBe(0)
      expect(updated.taxNote).toBe('VAT reverse charge')
    })
  })
})

// ============================================================================
// INVOICE NUMBERING
// ============================================================================

describe('Invoice Numbering', () => {
  describe('getNextInvoiceNumber', () => {
    it('should generate sequential invoice numbers', () => {
      const generator: InvoiceGenerator = {
        lastNumber: 1000,
        prefix: 'INV-',
      }

      const next = getNextInvoiceNumber(generator)

      expect(next).toBe('INV-1001')
    })

    it('should pad invoice numbers', () => {
      const generator: InvoiceGenerator = {
        lastNumber: 1,
        prefix: 'INV-',
        padding: 6,
      }

      const next = getNextInvoiceNumber(generator)

      expect(next).toBe('INV-000002')
    })

    it('should support date-based prefixes', () => {
      vi.setSystemTime(new Date('2025-03-15'))

      const generator: InvoiceGenerator = {
        lastNumber: 1,
        prefix: 'INV-{YYYY}-{MM}-',
      }

      const next = getNextInvoiceNumber(generator)

      expect(next).toBe('INV-2025-03-2')

      vi.useRealTimers()
    })

    it('should support custom separators', () => {
      const generator: InvoiceGenerator = {
        lastNumber: 99,
        prefix: 'ACME/',
        separator: '/',
      }

      const next = getNextInvoiceNumber(generator)

      expect(next).toBe('ACME/100')
    })

    it('should handle no prefix', () => {
      const generator: InvoiceGenerator = {
        lastNumber: 999,
        prefix: '',
      }

      const next = getNextInvoiceNumber(generator)

      expect(next).toBe('1000')
    })

    it('should reset sequence on year change', () => {
      vi.setSystemTime(new Date('2025-01-01'))

      const generator: InvoiceGenerator = {
        lastNumber: 500,
        prefix: 'INV-{YYYY}-',
        resetOnYearChange: true,
        lastYear: 2024,
      }

      const next = getNextInvoiceNumber(generator)

      expect(next).toBe('INV-2025-1')

      vi.useRealTimers()
    })
  })

  describe('Invoice Number Assignment', () => {
    it('should assign invoice number when finalizing draft', () => {
      const invoice = generateInvoiceFromSubscription(defaultSubscription)
      expect(invoice.number).toBeUndefined()

      const finalized = transitionStatus(invoice, 'open')

      expect(finalized.number).toBeDefined()
      expect(finalized.number).toMatch(/^INV-/)
    })

    it('should not change invoice number once assigned', () => {
      const invoice = generateInvoiceFromSubscription(defaultSubscription)
      const finalized = transitionStatus(invoice, 'open')
      const originalNumber = finalized.number

      const paid = transitionStatus(finalized, 'paid')

      expect(paid.number).toBe(originalNumber)
    })
  })
})

// ============================================================================
// STATUS TRANSITIONS
// ============================================================================

describe('Invoice Status Transitions', () => {
  let invoice: Invoice

  beforeEach(() => {
    invoice = generateInvoiceFromSubscription(defaultSubscription)
  })

  describe('transitionStatus', () => {
    it('should transition from draft to open', () => {
      const updated = transitionStatus(invoice, 'open')

      expect(updated.status).toBe('open')
      expect(updated.openedAt).toBeInstanceOf(Date)
    })

    it('should transition from open to paid', () => {
      const open = transitionStatus(invoice, 'open')
      const paid = transitionStatus(open, 'paid')

      expect(paid.status).toBe('paid')
      expect(paid.paidAt).toBeInstanceOf(Date)
    })

    it('should transition from draft to void', () => {
      const voided = transitionStatus(invoice, 'void')

      expect(voided.status).toBe('void')
      expect(voided.voidedAt).toBeInstanceOf(Date)
    })

    it('should transition from open to void', () => {
      const open = transitionStatus(invoice, 'open')
      const voided = transitionStatus(open, 'void')

      expect(voided.status).toBe('void')
    })

    it('should not allow transition from paid to void', () => {
      const open = transitionStatus(invoice, 'open')
      const paid = transitionStatus(open, 'paid')

      expect(() => transitionStatus(paid, 'void')).toThrow('invalid_transition')
    })

    it('should not allow transition from void to any status', () => {
      const voided = transitionStatus(invoice, 'void')

      expect(() => transitionStatus(voided, 'open')).toThrow('invalid_transition')
      expect(() => transitionStatus(voided, 'paid')).toThrow('invalid_transition')
    })

    it('should not allow skipping draft to paid', () => {
      expect(() => transitionStatus(invoice, 'paid')).toThrow('invalid_transition')
    })

    it('should allow transition from open to uncollectible', () => {
      const open = transitionStatus(invoice, 'open')
      const uncollectible = transitionStatus(open, 'uncollectible')

      expect(uncollectible.status).toBe('uncollectible')
      expect(uncollectible.markedUncollectibleAt).toBeInstanceOf(Date)
    })

    it('should track status history', () => {
      let updated = transitionStatus(invoice, 'open')
      updated = transitionStatus(updated, 'paid')

      expect(updated.statusHistory).toHaveLength(3)
      expect(updated.statusHistory[0].status).toBe('draft')
      expect(updated.statusHistory[1].status).toBe('open')
      expect(updated.statusHistory[2].status).toBe('paid')
    })
  })
})

// ============================================================================
// PAYMENT APPLICATION
// ============================================================================

describe('Payment Application', () => {
  let invoice: Invoice

  beforeEach(() => {
    invoice = generateInvoiceFromSubscription(defaultSubscription)
    invoice = calculateTax(invoice, defaultTaxConfig)
    invoice = transitionStatus(invoice, 'open')
  })

  describe('applyPayment', () => {
    it('should apply full payment to invoice', () => {
      const payment: PaymentApplication = {
        id: 'pay-123',
        amount: invoice.total,
        method: 'card',
        processedAt: new Date(),
      }

      const updated = applyPayment(invoice, payment)

      expect(updated.amountPaid).toBe(invoice.total)
      expect(updated.amountRemaining).toBe(0)
      expect(updated.status).toBe('paid')
    })

    it('should apply partial payment', () => {
      const payment: PaymentApplication = {
        id: 'pay-123',
        amount: 5000,
        method: 'card',
        processedAt: new Date(),
      }

      const updated = applyPayment(invoice, payment)

      expect(updated.amountPaid).toBe(5000)
      expect(updated.amountRemaining).toBe(invoice.total - 5000)
      expect(updated.status).toBe('open') // Still open until fully paid
    })

    it('should track multiple partial payments', () => {
      const payment1: PaymentApplication = {
        id: 'pay-1',
        amount: 3000,
        method: 'card',
        processedAt: new Date(),
      }
      const payment2: PaymentApplication = {
        id: 'pay-2',
        amount: 4000,
        method: 'bank_transfer',
        processedAt: new Date(),
      }

      let updated = applyPayment(invoice, payment1)
      updated = applyPayment(updated, payment2)

      expect(updated.payments).toHaveLength(2)
      expect(updated.amountPaid).toBe(7000)
      expect(updated.amountRemaining).toBe(invoice.total - 7000)
    })

    it('should auto-transition to paid when fully paid', () => {
      const payment: PaymentApplication = {
        id: 'pay-123',
        amount: invoice.total,
        method: 'card',
        processedAt: new Date(),
      }

      const updated = applyPayment(invoice, payment)

      expect(updated.status).toBe('paid')
      expect(updated.paidAt).toBeInstanceOf(Date)
    })

    it('should not allow overpayment', () => {
      const payment: PaymentApplication = {
        id: 'pay-123',
        amount: invoice.total + 1000,
        method: 'card',
        processedAt: new Date(),
      }

      expect(() => applyPayment(invoice, payment)).toThrow('overpayment')
    })

    it('should not allow payment on void invoice', () => {
      const voided = transitionStatus(
        generateInvoiceFromSubscription(defaultSubscription),
        'void'
      )

      const payment: PaymentApplication = {
        id: 'pay-123',
        amount: 1000,
        method: 'card',
        processedAt: new Date(),
      }

      expect(() => applyPayment(voided, payment)).toThrow('invoice_not_payable')
    })

    it('should not allow payment on draft invoice', () => {
      const draft = generateInvoiceFromSubscription(defaultSubscription)

      const payment: PaymentApplication = {
        id: 'pay-123',
        amount: 1000,
        method: 'card',
        processedAt: new Date(),
      }

      expect(() => applyPayment(draft, payment)).toThrow('invoice_not_payable')
    })

    it('should track payment method', () => {
      const payment: PaymentApplication = {
        id: 'pay-123',
        amount: invoice.total,
        method: 'ach_debit',
        processedAt: new Date(),
        metadata: {
          bankName: 'Chase',
          last4: '1234',
        },
      }

      const updated = applyPayment(invoice, payment)

      expect(updated.payments[0].method).toBe('ach_debit')
      expect(updated.payments[0].metadata).toEqual({
        bankName: 'Chase',
        last4: '1234',
      })
    })
  })
})

// ============================================================================
// INVOICE RENDERING
// ============================================================================

describe('Invoice Rendering', () => {
  let invoice: Invoice

  beforeEach(() => {
    invoice = generateInvoiceFromSubscription(defaultSubscription)
    invoice = calculateTax(invoice, defaultTaxConfig)
    invoice = transitionStatus(invoice, 'open')
  })

  describe('renderInvoice', () => {
    it('should render invoice as HTML', async () => {
      const options: InvoiceRenderOptions = {
        format: 'html',
      }

      const html = await renderInvoice(invoice, options)

      expect(html).toContain('<html')
      expect(html).toContain(invoice.number)
      expect(html).toContain('Pro Plan')
    })

    it('should render invoice as PDF', async () => {
      const options: InvoiceRenderOptions = {
        format: 'pdf',
      }

      const pdf = await renderInvoice(invoice, options)

      expect(pdf).toBeInstanceOf(Uint8Array)
      // PDF magic bytes
      expect(pdf[0]).toBe(0x25) // %
      expect(pdf[1]).toBe(0x50) // P
      expect(pdf[2]).toBe(0x44) // D
      expect(pdf[3]).toBe(0x46) // F
    })

    it('should include company branding in render', async () => {
      const options: InvoiceRenderOptions = {
        format: 'html',
        branding: {
          companyName: 'Acme Corp',
          logo: 'https://acme.com/logo.png',
          primaryColor: '#007bff',
          address: '123 Main St, San Francisco, CA 94105',
        },
      }

      const html = await renderInvoice(invoice, options)

      expect(html).toContain('Acme Corp')
      expect(html).toContain('https://acme.com/logo.png')
    })

    it('should include customer details in render', async () => {
      invoice.customerDetails = {
        name: 'John Doe',
        email: 'john@example.com',
        address: '456 Oak Ave, Portland, OR 97201',
      }

      const options: InvoiceRenderOptions = {
        format: 'html',
      }

      const html = await renderInvoice(invoice, options)

      expect(html).toContain('John Doe')
      expect(html).toContain('john@example.com')
    })

    it('should format currency correctly', async () => {
      const options: InvoiceRenderOptions = {
        format: 'html',
        locale: 'en-US',
      }

      const html = await renderInvoice(invoice, options)

      expect(html).toContain('$99.00')
    })

    it('should format currency for different locales', async () => {
      const euroInvoice: Invoice = {
        ...invoice,
        currency: 'eur',
        subtotal: 9900,
        total: 11781, // with 19% VAT
      }

      const options: InvoiceRenderOptions = {
        format: 'html',
        locale: 'de-DE',
      }

      const html = await renderInvoice(euroInvoice, options)

      // German format uses comma as decimal separator
      expect(html).toMatch(/99,00/)
    })

    it('should show discount breakdown', async () => {
      invoice.discounts = [
        { type: 'percent', value: 10, description: '10% loyalty discount' },
      ]
      invoice.discountTotal = 990

      const options: InvoiceRenderOptions = {
        format: 'html',
      }

      const html = await renderInvoice(invoice, options)

      expect(html).toContain('10% loyalty discount')
      expect(html).toContain('-$9.90')
    })

    it('should show tax breakdown', async () => {
      invoice.taxBreakdown = [
        { name: 'State Tax', amount: 594 },
        { name: 'County Tax', amount: 198 },
      ]

      const options: InvoiceRenderOptions = {
        format: 'html',
      }

      const html = await renderInvoice(invoice, options)

      expect(html).toContain('State Tax')
      expect(html).toContain('County Tax')
    })

    it('should show payment status', async () => {
      invoice.status = 'paid'
      invoice.paidAt = new Date('2025-01-15')

      const options: InvoiceRenderOptions = {
        format: 'html',
      }

      const html = await renderInvoice(invoice, options)

      expect(html).toContain('PAID')
    })

    it('should include payment instructions for unpaid invoices', async () => {
      const options: InvoiceRenderOptions = {
        format: 'html',
        paymentInstructions: 'Pay via bank transfer to Account #12345',
      }

      const html = await renderInvoice(invoice, options)

      expect(html).toContain('Pay via bank transfer to Account #12345')
    })

    it('should support custom templates', async () => {
      const options: InvoiceRenderOptions = {
        format: 'html',
        template: 'minimal',
      }

      const html = await renderInvoice(invoice, options)

      expect(html).toBeDefined()
      // Minimal template should have less content
    })

    it('should render invoice as JSON for API consumption', async () => {
      const options: InvoiceRenderOptions = {
        format: 'json',
      }

      const json = await renderInvoice(invoice, options)
      const parsed = JSON.parse(json as string)

      expect(parsed.number).toBe(invoice.number)
      expect(parsed.total).toBe(invoice.total)
      expect(parsed.status).toBe(invoice.status)
    })
  })
})

// ============================================================================
// TYPE-LEVEL TESTS
// ============================================================================

describe('Type-Level Checks', () => {
  it('should have correct InvoiceStatus union type', () => {
    const statuses: InvoiceStatus[] = ['draft', 'open', 'paid', 'void', 'uncollectible']
    expect(statuses).toHaveLength(5)
  })

  it('should require customerId on Invoice', () => {
    const invoice = generateInvoiceFromSubscription(defaultSubscription)
    expect(invoice.customerId).toBeDefined()
    expect(typeof invoice.customerId).toBe('string')
  })

  it('should have lineItems as array', () => {
    const invoice = generateInvoiceFromSubscription(defaultSubscription)
    expect(Array.isArray(invoice.lineItems)).toBe(true)
  })
})
