/**
 * Tax Calculation Tests - TDD RED Phase
 *
 * Tests for tax calculation primitive providing:
 * - Tax rate lookup by jurisdiction (country, state, city, postal code)
 * - Product tax categories (standard, reduced, zero-rated, exempt)
 * - Tax exemptions (customer-level, product-level)
 * - Shipping tax calculation
 * - Tax-inclusive vs tax-exclusive pricing
 * - VAT (Value Added Tax) for EU/UK
 * - Sales tax for US jurisdictions
 * - GST/HST for Canada
 * - Compound tax rates
 *
 * @module db/primitives/commerce/tests/tax
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTaxEngine,
  type TaxEngine,
  type TaxRate,
  type TaxCategory,
  type TaxExemption,
  type TaxJurisdiction,
  type TaxContext,
  type TaxResult,
  type TaxLineItem,
} from '../tax'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestTaxEngine(): TaxEngine {
  return createTaxEngine()
}

// Sample jurisdictions for testing
const US_CALIFORNIA: TaxJurisdiction = {
  country: 'US',
  state: 'CA',
  county: 'Los Angeles',
  city: 'Los Angeles',
  postalCode: '90001',
}

const US_OREGON: TaxJurisdiction = {
  country: 'US',
  state: 'OR',
}

const UK_LONDON: TaxJurisdiction = {
  country: 'GB',
  city: 'London',
  postalCode: 'SW1A 1AA',
}

const DE_BERLIN: TaxJurisdiction = {
  country: 'DE',
  city: 'Berlin',
  postalCode: '10115',
}

const CA_ONTARIO: TaxJurisdiction = {
  country: 'CA',
  state: 'ON',
  city: 'Toronto',
}

const CA_ALBERTA: TaxJurisdiction = {
  country: 'CA',
  state: 'AB',
  city: 'Calgary',
}

// =============================================================================
// Tax Rate Lookup Tests
// =============================================================================

describe('TaxEngine', () => {
  describe('tax rate lookup by jurisdiction', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should lookup US state sales tax rate', async () => {
      // California has 7.25% base state sales tax
      const rate = await tax.getTaxRate({
        country: 'US',
        state: 'CA',
      })

      expect(rate).toBeDefined()
      expect(rate!.rate).toBe(7.25)
      expect(rate!.type).toBe('sales_tax')
    })

    it('should return combined rate for US city with district taxes', async () => {
      // Los Angeles has state (7.25%) + county (0.25%) + city (varies) + district taxes
      const rate = await tax.getTaxRate(US_CALIFORNIA)

      expect(rate).toBeDefined()
      expect(rate!.rate).toBeGreaterThan(7.25)
      expect(rate!.components).toBeDefined()
      expect(rate!.components!.state).toBe(7.25)
    })

    it('should return zero rate for US states without sales tax', async () => {
      // Oregon has no sales tax
      const rate = await tax.getTaxRate(US_OREGON)

      expect(rate).toBeDefined()
      expect(rate!.rate).toBe(0)
    })

    it('should lookup UK VAT rate', async () => {
      const rate = await tax.getTaxRate(UK_LONDON)

      expect(rate).toBeDefined()
      expect(rate!.rate).toBe(20) // UK standard VAT is 20%
      expect(rate!.type).toBe('vat')
    })

    it('should lookup German VAT rate', async () => {
      const rate = await tax.getTaxRate(DE_BERLIN)

      expect(rate).toBeDefined()
      expect(rate!.rate).toBe(19) // Germany standard VAT is 19%
      expect(rate!.type).toBe('vat')
    })

    it('should lookup Canadian GST/HST combined rate', async () => {
      // Ontario has 13% HST (5% federal GST + 8% provincial PST combined)
      const rate = await tax.getTaxRate(CA_ONTARIO)

      expect(rate).toBeDefined()
      expect(rate!.rate).toBe(13)
      expect(rate!.type).toBe('hst')
    })

    it('should lookup Canadian GST-only provinces', async () => {
      // Alberta has only 5% GST (no provincial sales tax)
      const rate = await tax.getTaxRate(CA_ALBERTA)

      expect(rate).toBeDefined()
      expect(rate!.rate).toBe(5)
      expect(rate!.type).toBe('gst')
    })

    it('should return null for unknown jurisdictions', async () => {
      const rate = await tax.getTaxRate({
        country: 'XX',
        state: 'YY',
      })

      expect(rate).toBeNull()
    })

    it('should support custom tax rate registration', async () => {
      await tax.registerTaxRate({
        jurisdiction: { country: 'XX', state: 'YY' },
        rate: 15,
        type: 'custom',
        name: 'Custom Tax',
      })

      const rate = await tax.getTaxRate({ country: 'XX', state: 'YY' })

      expect(rate).toBeDefined()
      expect(rate!.rate).toBe(15)
    })
  })

  // =============================================================================
  // Product Tax Categories Tests
  // =============================================================================

  describe('product tax categories', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should create tax categories', async () => {
      const category = await tax.createTaxCategory({
        code: 'FOOD_BASIC',
        name: 'Basic Food Items',
        description: 'Unprepared food items',
      })

      expect(category.id).toBeDefined()
      expect(category.code).toBe('FOOD_BASIC')
    })

    it('should apply reduced VAT rate for food in UK', async () => {
      await tax.createTaxCategory({
        code: 'FOOD_BASIC',
        name: 'Basic Food Items',
        rateOverrides: [
          { jurisdiction: { country: 'GB' }, rate: 0 }, // Zero-rated food
        ],
      })

      const result = await tax.calculateTax({
        items: [
          {
            productId: 'prod-1',
            price: 1000,
            quantity: 1,
            taxCategory: 'FOOD_BASIC',
          },
        ],
        shippingAddress: UK_LONDON,
      })

      expect(result.taxAmount).toBe(0) // Zero-rated
    })

    it('should apply reduced VAT rate for books in Germany', async () => {
      await tax.createTaxCategory({
        code: 'BOOKS',
        name: 'Books and Publications',
        rateOverrides: [
          { jurisdiction: { country: 'DE' }, rate: 7 }, // Reduced rate
        ],
      })

      const result = await tax.calculateTax({
        items: [
          {
            productId: 'book-1',
            price: 2000, // 20.00 EUR
            quantity: 1,
            taxCategory: 'BOOKS',
          },
        ],
        shippingAddress: DE_BERLIN,
      })

      // 7% of 2000 = 140
      expect(result.taxAmount).toBe(140)
    })

    it('should apply standard rate when no category override exists', async () => {
      const result = await tax.calculateTax({
        items: [
          {
            productId: 'electronics-1',
            price: 10000,
            quantity: 1,
            // No tax category - uses standard rate
          },
        ],
        shippingAddress: UK_LONDON,
      })

      // 20% of 10000 = 2000
      expect(result.taxAmount).toBe(2000)
    })

    it('should handle zero-rated products', async () => {
      await tax.createTaxCategory({
        code: 'ZERO_RATED',
        name: 'Zero Rated Items',
        rateOverrides: [
          { jurisdiction: { country: 'GB' }, rate: 0 },
          { jurisdiction: { country: 'US' }, rate: 0 },
        ],
      })

      const result = await tax.calculateTax({
        items: [
          {
            productId: 'export-1',
            price: 5000,
            quantity: 1,
            taxCategory: 'ZERO_RATED',
          },
        ],
        shippingAddress: UK_LONDON,
      })

      expect(result.taxAmount).toBe(0)
    })

    it('should list available tax categories', async () => {
      await tax.createTaxCategory({ code: 'STANDARD', name: 'Standard' })
      await tax.createTaxCategory({ code: 'REDUCED', name: 'Reduced' })
      await tax.createTaxCategory({ code: 'ZERO', name: 'Zero-rated' })

      const categories = await tax.listTaxCategories()

      expect(categories).toHaveLength(3)
      expect(categories.map((c) => c.code)).toContain('STANDARD')
    })
  })

  // =============================================================================
  // Tax Exemptions Tests
  // =============================================================================

  describe('tax exemptions', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should create customer tax exemption', async () => {
      const exemption = await tax.createExemption({
        type: 'customer',
        customerId: 'cust-123',
        reason: 'Non-profit organization',
        certificateNumber: 'EXEMPT-2024-001',
        jurisdictions: [{ country: 'US', state: 'CA' }],
        validFrom: new Date('2024-01-01'),
        validTo: new Date('2025-12-31'),
      })

      expect(exemption.id).toBeDefined()
      expect(exemption.type).toBe('customer')
    })

    it('should apply customer exemption when calculating tax', async () => {
      await tax.createExemption({
        type: 'customer',
        customerId: 'nonprofit-org',
        reason: 'Tax-exempt non-profit',
        jurisdictions: [{ country: 'US', state: 'CA' }],
      })

      const result = await tax.calculateTax({
        items: [
          { productId: 'prod-1', price: 10000, quantity: 1 },
        ],
        shippingAddress: US_CALIFORNIA,
        customerId: 'nonprofit-org',
      })

      expect(result.taxAmount).toBe(0)
      expect(result.exemptionApplied).toBe(true)
      expect(result.exemptionReason).toBe('Tax-exempt non-profit')
    })

    it('should not apply exemption for different jurisdiction', async () => {
      await tax.createExemption({
        type: 'customer',
        customerId: 'cust-123',
        jurisdictions: [{ country: 'US', state: 'CA' }], // Only CA
      })

      const result = await tax.calculateTax({
        items: [
          { productId: 'prod-1', price: 10000, quantity: 1 },
        ],
        shippingAddress: UK_LONDON, // UK, not CA
        customerId: 'cust-123',
      })

      expect(result.taxAmount).toBeGreaterThan(0)
      expect(result.exemptionApplied).toBe(false)
    })

    it('should handle expired exemptions', async () => {
      await tax.createExemption({
        type: 'customer',
        customerId: 'cust-123',
        validFrom: new Date('2020-01-01'),
        validTo: new Date('2021-12-31'), // Expired
      })

      const result = await tax.calculateTax({
        items: [
          { productId: 'prod-1', price: 10000, quantity: 1 },
        ],
        shippingAddress: US_CALIFORNIA,
        customerId: 'cust-123',
      })

      expect(result.taxAmount).toBeGreaterThan(0) // Exemption expired
    })

    it('should validate tax exemption certificate', async () => {
      const validation = await tax.validateExemption({
        customerId: 'cust-123',
        certificateNumber: 'INVALID-CERT',
        jurisdiction: US_CALIFORNIA,
      })

      expect(validation.valid).toBe(false)
      expect(validation.error).toBeDefined()
    })

    it('should create product-level exemption', async () => {
      await tax.createExemption({
        type: 'product',
        productIds: ['medicine-1', 'medicine-2'],
        reason: 'Prescription medication exempt from sales tax',
        jurisdictions: [{ country: 'US' }],
      })

      const result = await tax.calculateTax({
        items: [
          { productId: 'medicine-1', price: 5000, quantity: 1 },
          { productId: 'electronics-1', price: 10000, quantity: 1 },
        ],
        shippingAddress: US_CALIFORNIA,
      })

      // Only electronics should be taxed
      // Assuming ~9.5% CA rate: 10000 * 0.095 = 950
      expect(result.itemTaxes).toHaveLength(2)
      expect(result.itemTaxes![0].taxAmount).toBe(0) // medicine
      expect(result.itemTaxes![1].taxAmount).toBeGreaterThan(0) // electronics
    })

    it('should list exemptions for a customer', async () => {
      await tax.createExemption({
        type: 'customer',
        customerId: 'cust-123',
        jurisdictions: [{ country: 'US', state: 'CA' }],
      })
      await tax.createExemption({
        type: 'customer',
        customerId: 'cust-123',
        jurisdictions: [{ country: 'US', state: 'NY' }],
      })

      const exemptions = await tax.listExemptions({ customerId: 'cust-123' })

      expect(exemptions).toHaveLength(2)
    })
  })

  // =============================================================================
  // Shipping Tax Tests
  // =============================================================================

  describe('shipping tax', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should apply tax to shipping when required by jurisdiction', async () => {
      // Most US states tax shipping
      const result = await tax.calculateTax({
        items: [
          { productId: 'prod-1', price: 5000, quantity: 1 },
        ],
        shippingAddress: US_CALIFORNIA,
        shippingCost: 1000,
      })

      expect(result.shippingTax).toBeGreaterThan(0)
    })

    it('should not tax shipping in jurisdictions that exempt it', async () => {
      // Configure jurisdiction where shipping is not taxed
      await tax.setShippingTaxable({
        jurisdiction: { country: 'US', state: 'MA' },
        taxable: false,
      })

      const result = await tax.calculateTax({
        items: [
          { productId: 'prod-1', price: 5000, quantity: 1 },
        ],
        shippingAddress: { country: 'US', state: 'MA' },
        shippingCost: 1000,
      })

      expect(result.shippingTax).toBe(0)
    })

    it('should include shipping tax in total', async () => {
      const result = await tax.calculateTax({
        items: [
          { productId: 'prod-1', price: 10000, quantity: 1 },
        ],
        shippingAddress: US_CALIFORNIA,
        shippingCost: 1000,
      })

      const expectedShippingTax = result.shippingTax ?? 0
      expect(result.taxAmount).toBe(result.itemsTaxAmount + expectedShippingTax)
    })

    it('should apply VAT to shipping in EU', async () => {
      const result = await tax.calculateTax({
        items: [
          { productId: 'prod-1', price: 5000, quantity: 1 },
        ],
        shippingAddress: DE_BERLIN,
        shippingCost: 1000,
      })

      // Germany 19% VAT applies to shipping
      expect(result.shippingTax).toBe(190)
    })

    it('should handle free shipping with no tax', async () => {
      const result = await tax.calculateTax({
        items: [
          { productId: 'prod-1', price: 5000, quantity: 1 },
        ],
        shippingAddress: US_CALIFORNIA,
        shippingCost: 0,
      })

      expect(result.shippingTax).toBe(0)
    })
  })

  // =============================================================================
  // Tax-Inclusive vs Tax-Exclusive Pricing Tests
  // =============================================================================

  describe('tax-inclusive vs tax-exclusive pricing', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should calculate tax on top of price (tax-exclusive)', async () => {
      const result = await tax.calculateTax({
        items: [
          { productId: 'prod-1', price: 10000, quantity: 1 },
        ],
        shippingAddress: UK_LONDON,
        pricesIncludeTax: false,
      })

      // Price 10000 + 20% VAT = 2000 tax
      expect(result.subtotal).toBe(10000)
      expect(result.taxAmount).toBe(2000)
      expect(result.total).toBe(12000)
    })

    it('should extract tax from price (tax-inclusive)', async () => {
      const result = await tax.calculateTax({
        items: [
          { productId: 'prod-1', price: 12000, quantity: 1 },
        ],
        shippingAddress: UK_LONDON,
        pricesIncludeTax: true,
      })

      // Price 12000 includes 20% VAT
      // Net price = 12000 / 1.20 = 10000
      // Tax = 12000 - 10000 = 2000
      expect(result.subtotal).toBe(10000)
      expect(result.taxAmount).toBe(2000)
      expect(result.total).toBe(12000)
    })

    it('should show both gross and net prices in result', async () => {
      const result = await tax.calculateTax({
        items: [
          { productId: 'prod-1', price: 12000, quantity: 1 },
        ],
        shippingAddress: UK_LONDON,
        pricesIncludeTax: true,
      })

      expect(result.grossPrice).toBe(12000)
      expect(result.netPrice).toBe(10000)
    })

    it('should handle mixed tax-inclusive items', async () => {
      const result = await tax.calculateTax({
        items: [
          { productId: 'prod-1', price: 12000, quantity: 1, priceIncludesTax: true },
          { productId: 'prod-2', price: 5000, quantity: 1, priceIncludesTax: false },
        ],
        shippingAddress: UK_LONDON,
      })

      // Item 1: 12000 gross, 10000 net, 2000 tax
      // Item 2: 5000 net, 1000 tax, 6000 gross
      expect(result.taxAmount).toBe(3000)
      expect(result.total).toBe(18000)
    })

    it('should default to tax-exclusive for US', async () => {
      const result = await tax.calculateTax({
        items: [
          { productId: 'prod-1', price: 10000, quantity: 1 },
        ],
        shippingAddress: US_CALIFORNIA,
      })

      // US prices are typically tax-exclusive
      expect(result.subtotal).toBe(10000)
      expect(result.total).toBeGreaterThan(10000) // Tax added on top
    })

    it('should support setting default pricing mode per jurisdiction', async () => {
      await tax.setDefaultPricingMode({
        jurisdiction: { country: 'AU' },
        pricesIncludeTax: true, // Australia typically shows tax-inclusive prices
      })

      const result = await tax.calculateTax({
        items: [
          { productId: 'prod-1', price: 11000, quantity: 1 },
        ],
        shippingAddress: { country: 'AU' },
      })

      // Australian GST 10%, price already includes tax
      expect(result.total).toBe(11000)
      expect(result.taxAmount).toBe(1000)
    })
  })

  // =============================================================================
  // VAT (EU/UK) Specific Tests
  // =============================================================================

  describe('VAT calculations', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should apply correct VAT rates for EU countries', async () => {
      // France: 20%, Germany: 19%, Ireland: 23%
      const results = await Promise.all([
        tax.calculateTax({
          items: [{ productId: 'p1', price: 1000, quantity: 1 }],
          shippingAddress: { country: 'FR' },
        }),
        tax.calculateTax({
          items: [{ productId: 'p1', price: 1000, quantity: 1 }],
          shippingAddress: { country: 'DE' },
        }),
        tax.calculateTax({
          items: [{ productId: 'p1', price: 1000, quantity: 1 }],
          shippingAddress: { country: 'IE' },
        }),
      ])

      expect(results[0].taxAmount).toBe(200) // France 20%
      expect(results[1].taxAmount).toBe(190) // Germany 19%
      expect(results[2].taxAmount).toBe(230) // Ireland 23%
    })

    it('should apply reduced VAT rates for specific product types', async () => {
      await tax.createTaxCategory({
        code: 'CHILDRENS_CLOTHING',
        name: 'Children\'s Clothing',
        rateOverrides: [
          { jurisdiction: { country: 'GB' }, rate: 0 }, // Zero-rated in UK
          { jurisdiction: { country: 'IE' }, rate: 13.5 }, // Reduced in Ireland
        ],
      })

      const ukResult = await tax.calculateTax({
        items: [{
          productId: 'kids-shirt-1',
          price: 2000,
          quantity: 1,
          taxCategory: 'CHILDRENS_CLOTHING',
        }],
        shippingAddress: UK_LONDON,
      })

      expect(ukResult.taxAmount).toBe(0)
    })

    it('should handle EU reverse charge for B2B transactions', async () => {
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: DE_BERLIN,
        customerVatNumber: 'DE123456789',
        isBusinessCustomer: true,
      })

      // Reverse charge: no VAT charged, customer accounts for it
      expect(result.taxAmount).toBe(0)
      expect(result.reverseCharge).toBe(true)
      expect(result.reverseChargeNote).toContain('reverse charge')
    })

    it('should validate EU VAT numbers', async () => {
      const validation = await tax.validateVatNumber('DE123456789')

      expect(validation.valid).toBeDefined()
      expect(validation.countryCode).toBe('DE')
    })

    it('should handle cross-border EU sales to consumers', async () => {
      // When selling from Germany to France consumer, charge French VAT
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        sellerJurisdiction: DE_BERLIN,
        shippingAddress: { country: 'FR' },
        isBusinessCustomer: false,
      })

      // Destination principle: French VAT 20%
      expect(result.taxAmount).toBe(2000)
      expect(result.taxJurisdiction!.country).toBe('FR')
    })

    it('should apply seller country VAT for small sellers under threshold', async () => {
      // Small sellers under EU threshold can charge origin country VAT
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        sellerJurisdiction: DE_BERLIN,
        shippingAddress: { country: 'FR' },
        isSmallSeller: true, // Under OSS threshold
      })

      // Origin principle for small sellers: German VAT 19%
      expect(result.taxAmount).toBe(1900)
      expect(result.taxJurisdiction!.country).toBe('DE')
    })
  })

  // =============================================================================
  // US Sales Tax Specific Tests
  // =============================================================================

  describe('US sales tax calculations', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should calculate combined state, county, and city tax', async () => {
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: US_CALIFORNIA,
      })

      // LA has ~9.5% combined rate
      expect(result.taxBreakdown).toBeDefined()
      expect(result.taxBreakdown!.state).toBeGreaterThan(0)
      expect(result.taxBreakdown!.county).toBeDefined()
      expect(result.taxBreakdown!.city).toBeDefined()
    })

    it('should apply nexus rules correctly', async () => {
      // Only calculate tax for states where seller has nexus
      await tax.registerNexus({
        sellerId: 'seller-1',
        jurisdictions: [
          { country: 'US', state: 'CA' },
          { country: 'US', state: 'NY' },
        ],
      })

      const caResult = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: US_CALIFORNIA,
        sellerId: 'seller-1',
      })

      const txResult = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: { country: 'US', state: 'TX' },
        sellerId: 'seller-1',
      })

      expect(caResult.taxAmount).toBeGreaterThan(0) // Has nexus
      expect(txResult.taxAmount).toBe(0) // No nexus
    })

    it('should handle marketplace facilitator rules', async () => {
      // Marketplace is responsible for collecting tax
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: US_CALIFORNIA,
        isMarketplaceSale: true,
        marketplaceId: 'marketplace-1',
      })

      expect(result.collectedBy).toBe('marketplace')
      expect(result.taxAmount).toBeGreaterThan(0)
    })

    it('should identify tax holidays', async () => {
      // Some states have sales tax holidays
      const result = await tax.calculateTax({
        items: [{
          productId: 'backpack-1',
          price: 5000,
          quantity: 1,
          taxCategory: 'SCHOOL_SUPPLIES',
        }],
        shippingAddress: { country: 'US', state: 'TX' },
        transactionDate: new Date('2024-08-10'), // TX back-to-school holiday
      })

      expect(result.taxHolidayApplied).toBe(true)
      expect(result.taxAmount).toBe(0)
    })

    it('should exempt groceries in applicable states', async () => {
      await tax.createTaxCategory({
        code: 'GROCERIES',
        name: 'Grocery Items',
        rateOverrides: [
          { jurisdiction: { country: 'US', state: 'TX' }, rate: 0 }, // TX exempts groceries
          { jurisdiction: { country: 'US', state: 'CA' }, rate: 0 }, // CA exempts groceries
        ],
      })

      const result = await tax.calculateTax({
        items: [{
          productId: 'milk-1',
          price: 500,
          quantity: 1,
          taxCategory: 'GROCERIES',
        }],
        shippingAddress: { country: 'US', state: 'TX' },
      })

      expect(result.taxAmount).toBe(0)
    })

    it('should calculate use tax for out-of-state purchases', async () => {
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: US_CALIFORNIA,
        isUseTax: true, // Buyer self-reports use tax
      })

      expect(result.taxType).toBe('use_tax')
      expect(result.taxAmount).toBeGreaterThan(0)
    })
  })

  // =============================================================================
  // Canadian GST/HST/PST Tests
  // =============================================================================

  describe('Canadian tax calculations', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should apply HST in harmonized provinces', async () => {
      // Ontario: 13% HST
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: CA_ONTARIO,
      })

      expect(result.taxAmount).toBe(1300)
      expect(result.taxType).toBe('hst')
    })

    it('should apply GST + PST in non-harmonized provinces', async () => {
      // British Columbia: 5% GST + 7% PST = 12% combined
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: { country: 'CA', state: 'BC' },
      })

      expect(result.taxBreakdown!.gst).toBe(500)
      expect(result.taxBreakdown!.pst).toBe(700)
      expect(result.taxAmount).toBe(1200)
    })

    it('should apply only GST in GST-only provinces', async () => {
      // Alberta: 5% GST only
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: CA_ALBERTA,
      })

      expect(result.taxAmount).toBe(500)
      expect(result.taxType).toBe('gst')
    })

    it('should apply QST in Quebec', async () => {
      // Quebec: 5% GST + 9.975% QST
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: { country: 'CA', state: 'QC' },
      })

      expect(result.taxBreakdown!.gst).toBe(500)
      expect(result.taxBreakdown!.qst).toBe(998) // 9.975% rounded
      expect(result.taxAmount).toBe(1498)
    })

    it('should handle GST-exempt items', async () => {
      await tax.createTaxCategory({
        code: 'BASIC_GROCERIES_CA',
        name: 'Basic Groceries (Canada)',
        rateOverrides: [
          { jurisdiction: { country: 'CA' }, rate: 0, taxTypes: ['gst', 'hst'] },
        ],
      })

      const result = await tax.calculateTax({
        items: [{
          productId: 'bread-1',
          price: 500,
          quantity: 1,
          taxCategory: 'BASIC_GROCERIES_CA',
        }],
        shippingAddress: CA_ONTARIO,
      })

      expect(result.taxAmount).toBe(0)
    })

    it('should handle point-of-sale rebates in some provinces', async () => {
      // Some provinces offer PST rebates on certain items
      const result = await tax.calculateTax({
        items: [{
          productId: 'book-1',
          price: 2000,
          quantity: 1,
          taxCategory: 'BOOKS',
        }],
        shippingAddress: { country: 'CA', state: 'BC' },
      })

      // Books are PST-exempt in BC but GST applies
      expect(result.taxBreakdown!.gst).toBe(100)
      expect(result.taxBreakdown!.pst).toBe(0)
    })
  })

  // =============================================================================
  // Compound Tax Tests
  // =============================================================================

  describe('compound tax calculations', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should calculate compound tax (tax on tax)', async () => {
      // Some jurisdictions apply tax on the already-taxed amount
      await tax.registerTaxRate({
        jurisdiction: { country: 'CA', state: 'QC' },
        rate: 5,
        type: 'gst',
        compound: false,
      })
      await tax.registerTaxRate({
        jurisdiction: { country: 'CA', state: 'QC' },
        rate: 9.975,
        type: 'qst',
        compound: true, // QST is calculated on price + GST
      })

      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: { country: 'CA', state: 'QC' },
      })

      // GST: 10000 * 0.05 = 500
      // QST: (10000 + 500) * 0.09975 = 1047.375, rounded to 1047
      // Actually QST is on price only now, but this tests compound behavior
      expect(result.taxBreakdown!.gst).toBe(500)
    })

    it('should handle multiple non-compound taxes', async () => {
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: { country: 'CA', state: 'BC' },
      })

      // Both GST and PST calculated on base price, not compound
      // GST: 10000 * 0.05 = 500
      // PST: 10000 * 0.07 = 700
      expect(result.taxBreakdown!.gst).toBe(500)
      expect(result.taxBreakdown!.pst).toBe(700)
    })
  })

  // =============================================================================
  // Tax Reporting Tests
  // =============================================================================

  describe('tax reporting', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should record tax transaction for reporting', async () => {
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: UK_LONDON,
        orderId: 'order-123',
        transactionDate: new Date('2024-03-15'),
      })

      await tax.recordTaxTransaction({
        orderId: 'order-123',
        result,
      })

      const transactions = await tax.getTaxTransactions({
        startDate: new Date('2024-03-01'),
        endDate: new Date('2024-03-31'),
      })

      expect(transactions).toHaveLength(1)
      expect(transactions[0].orderId).toBe('order-123')
    })

    it('should generate tax summary by jurisdiction', async () => {
      // Record several transactions
      await tax.recordTaxTransaction({
        orderId: 'order-1',
        result: await tax.calculateTax({
          items: [{ productId: 'p1', price: 10000, quantity: 1 }],
          shippingAddress: UK_LONDON,
        }),
      })
      await tax.recordTaxTransaction({
        orderId: 'order-2',
        result: await tax.calculateTax({
          items: [{ productId: 'p2', price: 5000, quantity: 1 }],
          shippingAddress: DE_BERLIN,
        }),
      })

      const summary = await tax.getTaxSummary({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
        groupBy: 'jurisdiction',
      })

      expect(summary.byJurisdiction).toBeDefined()
      expect(summary.byJurisdiction!['GB']).toBeDefined()
      expect(summary.byJurisdiction!['DE']).toBeDefined()
    })

    it('should export tax data for filing', async () => {
      const exportData = await tax.exportTaxData({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-03-31'),
        format: 'csv',
        jurisdiction: { country: 'GB' },
      })

      expect(exportData.format).toBe('csv')
      expect(exportData.data).toBeDefined()
    })

    it('should handle refund tax adjustments', async () => {
      // Original transaction
      const original = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: UK_LONDON,
        orderId: 'order-123',
      })

      await tax.recordTaxTransaction({ orderId: 'order-123', result: original })

      // Refund
      const refund = await tax.calculateRefundTax({
        originalOrderId: 'order-123',
        refundAmount: 5000, // Partial refund
      })

      expect(refund.taxRefund).toBe(1000) // 20% of 5000
      expect(refund.netRefund).toBe(4000)
    })
  })

  // =============================================================================
  // Edge Cases and Error Handling Tests
  // =============================================================================

  describe('edge cases and error handling', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should handle zero-price items', async () => {
      const result = await tax.calculateTax({
        items: [{ productId: 'freebie-1', price: 0, quantity: 1 }],
        shippingAddress: UK_LONDON,
      })

      expect(result.taxAmount).toBe(0)
    })

    it('should handle very large quantities', async () => {
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 100, quantity: 1000000 }],
        shippingAddress: UK_LONDON,
      })

      // 100 * 1000000 * 0.20 = 20,000,000
      expect(result.taxAmount).toBe(20000000)
    })

    it('should round tax amounts correctly', async () => {
      // Test rounding to nearest cent
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 333, quantity: 1 }], // 333 * 0.20 = 66.6
        shippingAddress: UK_LONDON,
      })

      // Should round to 67
      expect(result.taxAmount).toBe(67)
    })

    it('should handle multiple items with different tax rates', async () => {
      await tax.createTaxCategory({
        code: 'REDUCED',
        rateOverrides: [{ jurisdiction: { country: 'GB' }, rate: 5 }],
      })

      const result = await tax.calculateTax({
        items: [
          { productId: 'standard-item', price: 1000, quantity: 1 },
          { productId: 'reduced-item', price: 1000, quantity: 1, taxCategory: 'REDUCED' },
        ],
        shippingAddress: UK_LONDON,
      })

      // Standard: 1000 * 0.20 = 200
      // Reduced: 1000 * 0.05 = 50
      expect(result.taxAmount).toBe(250)
    })

    it('should throw error for missing required fields', async () => {
      await expect(
        tax.calculateTax({
          items: [],
          shippingAddress: UK_LONDON,
        })
      ).rejects.toThrow()
    })

    it('should handle currency conversion for tax calculation', async () => {
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: UK_LONDON,
        currency: 'EUR',
        displayCurrency: 'GBP',
      })

      expect(result.currency).toBe('EUR')
      expect(result.displayCurrency).toBe('GBP')
    })

    it('should validate jurisdiction before calculation', async () => {
      const validation = await tax.validateJurisdiction({
        country: 'US',
        state: 'INVALID_STATE',
      })

      expect(validation.valid).toBe(false)
    })
  })

  // =============================================================================
  // Additional Tax Scenarios Tests
  // =============================================================================

  describe('Australian GST calculations', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should apply 10% GST for Australian sales', async () => {
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: { country: 'AU', state: 'NSW' },
      })

      expect(result.taxAmount).toBe(1000) // 10% GST
      expect(result.taxType).toBe('gst')
    })

    it('should apply GST to shipping in Australia', async () => {
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 5000, quantity: 1 }],
        shippingAddress: { country: 'AU' },
        shippingCost: 1000,
      })

      // Shipping also taxed at 10%
      expect(result.shippingTax).toBe(100)
    })

    it('should handle GST-free items in Australia', async () => {
      await tax.createTaxCategory({
        code: 'GST_FREE_AU',
        name: 'GST Free Items (Australia)',
        rateOverrides: [
          { jurisdiction: { country: 'AU' }, rate: 0 },
        ],
      })

      const result = await tax.calculateTax({
        items: [{
          productId: 'medical-supply-1',
          price: 5000,
          quantity: 1,
          taxCategory: 'GST_FREE_AU',
        }],
        shippingAddress: { country: 'AU' },
      })

      expect(result.taxAmount).toBe(0)
    })
  })

  describe('additional EU VAT scenarios', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should apply correct VAT rates for all EU countries', async () => {
      const euCountries = [
        { country: 'NL', expectedRate: 21 },
        { country: 'BE', expectedRate: 21 },
        { country: 'AT', expectedRate: 20 },
        { country: 'PL', expectedRate: 23 },
        { country: 'SE', expectedRate: 25 },
        { country: 'DK', expectedRate: 25 },
        { country: 'FI', expectedRate: 24 },
        { country: 'PT', expectedRate: 23 },
        { country: 'HU', expectedRate: 27 }, // Highest VAT in EU
        { country: 'LU', expectedRate: 17 }, // Lowest VAT in EU
      ]

      for (const { country, expectedRate } of euCountries) {
        const rate = await tax.getTaxRate({ country })
        expect(rate).toBeDefined()
        expect(rate!.rate).toBe(expectedRate)
        expect(rate!.type).toBe('vat')
      }
    })

    it('should apply Hungary highest VAT rate (27%)', async () => {
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: { country: 'HU' },
      })

      expect(result.taxAmount).toBe(2700)
    })

    it('should apply Luxembourg lowest VAT rate (17%)', async () => {
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: { country: 'LU' },
      })

      expect(result.taxAmount).toBe(1700)
    })

    it('should reject invalid VAT numbers', async () => {
      const validation = await tax.validateVatNumber('XX')

      expect(validation.valid).toBe(false)
    })

    it('should validate VAT numbers with proper format', async () => {
      const validations = await Promise.all([
        tax.validateVatNumber('GB123456789'),
        tax.validateVatNumber('FR12345678901'),
        tax.validateVatNumber('IT12345678901'),
      ])

      expect(validations[0].valid).toBe(true)
      expect(validations[0].countryCode).toBe('GB')
      expect(validations[1].valid).toBe(true)
      expect(validations[1].countryCode).toBe('FR')
      expect(validations[2].valid).toBe(true)
      expect(validations[2].countryCode).toBe('IT')
    })
  })

  describe('US district tax scenarios', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should support custom district tax rates', async () => {
      await tax.registerTaxRate({
        jurisdiction: { country: 'US', state: 'CA', county: 'Santa Clara', city: 'San Jose' },
        rate: 9.375,
        type: 'sales_tax',
        components: { state: 7.25, county: 0.25, city: 0.25, district: 1.625 },
      })

      const rate = await tax.getTaxRate({
        country: 'US',
        state: 'CA',
        county: 'Santa Clara',
        city: 'San Jose',
      })

      expect(rate!.rate).toBe(9.375)
      expect(rate!.components!.district).toBe(1.625)
    })

    it('should fall back to state rate when city rate not found', async () => {
      const rate = await tax.getTaxRate({
        country: 'US',
        state: 'CA',
        city: 'Unknown City',
      })

      expect(rate!.rate).toBe(7.25) // State rate fallback
    })

    it('should handle multiple US states without sales tax', async () => {
      const noSalesTaxStates = ['OR', 'MT', 'NH', 'DE', 'AK']

      for (const state of noSalesTaxStates) {
        const rate = await tax.getTaxRate({ country: 'US', state })
        expect(rate!.rate).toBe(0)
      }
    })
  })

  describe('exemption date boundary cases', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should apply exemption that starts today', async () => {
      const today = new Date()
      await tax.createExemption({
        type: 'customer',
        customerId: 'cust-today',
        validFrom: today,
        validTo: new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000), // 1 year later
        jurisdictions: [{ country: 'US' }],
      })

      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: { country: 'US', state: 'CA' },
        customerId: 'cust-today',
      })

      expect(result.exemptionApplied).toBe(true)
      expect(result.taxAmount).toBe(0)
    })

    it('should not apply exemption that starts tomorrow', async () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)

      await tax.createExemption({
        type: 'customer',
        customerId: 'cust-tomorrow',
        validFrom: tomorrow,
        jurisdictions: [{ country: 'US' }],
      })

      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: { country: 'US', state: 'CA' },
        customerId: 'cust-tomorrow',
      })

      expect(result.exemptionApplied).toBe(false)
      expect(result.taxAmount).toBeGreaterThan(0)
    })

    it('should apply exemption without date restrictions', async () => {
      await tax.createExemption({
        type: 'customer',
        customerId: 'cust-forever',
        reason: 'Permanent exemption',
        jurisdictions: [{ country: 'US' }],
        // No validFrom or validTo
      })

      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: { country: 'US', state: 'CA' },
        customerId: 'cust-forever',
      })

      expect(result.exemptionApplied).toBe(true)
      expect(result.exemptionReason).toBe('Permanent exemption')
    })
  })

  describe('multi-item tax calculations', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should calculate per-item tax breakdown', async () => {
      const result = await tax.calculateTax({
        items: [
          { productId: 'item-1', price: 5000, quantity: 2 },
          { productId: 'item-2', price: 3000, quantity: 1 },
          { productId: 'item-3', price: 2000, quantity: 3 },
        ],
        shippingAddress: UK_LONDON,
      })

      // Total: (5000*2) + 3000 + (2000*3) = 10000 + 3000 + 6000 = 19000
      // Tax: 19000 * 0.20 = 3800
      expect(result.subtotal).toBe(19000)
      expect(result.taxAmount).toBe(3800)
      expect(result.itemTaxes).toHaveLength(3)
      expect(result.itemTaxes![0].taxAmount).toBe(2000) // 10000 * 0.20
      expect(result.itemTaxes![1].taxAmount).toBe(600)  // 3000 * 0.20
      expect(result.itemTaxes![2].taxAmount).toBe(1200) // 6000 * 0.20
    })

    it('should handle mixed taxable and exempt items', async () => {
      await tax.createExemption({
        type: 'product',
        productIds: ['exempt-item'],
        jurisdictions: [{ country: 'GB' }],
      })

      const result = await tax.calculateTax({
        items: [
          { productId: 'taxable-item', price: 10000, quantity: 1 },
          { productId: 'exempt-item', price: 5000, quantity: 1 },
        ],
        shippingAddress: UK_LONDON,
      })

      // Only taxable item should be taxed
      expect(result.itemTaxes![0].taxAmount).toBe(2000) // Taxable: 20%
      expect(result.itemTaxes![1].taxAmount).toBe(0)    // Exempt
      expect(result.taxAmount).toBe(2000)
    })

    it('should handle large number of line items', async () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        productId: `item-${i}`,
        price: 100,
        quantity: 1,
      }))

      const result = await tax.calculateTax({
        items,
        shippingAddress: UK_LONDON,
      })

      // 100 items * 100 * 0.20 = 2000
      expect(result.subtotal).toBe(10000)
      expect(result.taxAmount).toBe(2000)
      expect(result.itemTaxes).toHaveLength(100)
    })
  })

  describe('Canadian province validation', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should validate Canadian provinces', async () => {
      const validProvinces = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']

      for (const province of validProvinces) {
        const validation = await tax.validateJurisdiction({
          country: 'CA',
          state: province,
        })
        expect(validation.valid).toBe(true)
      }
    })

    it('should reject invalid Canadian provinces', async () => {
      const validation = await tax.validateJurisdiction({
        country: 'CA',
        state: 'XX',
      })

      expect(validation.valid).toBe(false)
    })

    it('should handle all Canadian tax scenarios', async () => {
      const provinces = [
        { state: 'ON', expectedRate: 13, type: 'hst' },
        { state: 'NB', expectedRate: 15, type: 'hst' },
        { state: 'NS', expectedRate: 15, type: 'hst' },
        { state: 'NL', expectedRate: 15, type: 'hst' },
        { state: 'PE', expectedRate: 15, type: 'hst' },
        { state: 'BC', expectedRate: 12, type: 'gst' },
        { state: 'SK', expectedRate: 11, type: 'gst' },
        { state: 'MB', expectedRate: 12, type: 'gst' },
        { state: 'AB', expectedRate: 5, type: 'gst' },
        { state: 'NT', expectedRate: 5, type: 'gst' },
        { state: 'NU', expectedRate: 5, type: 'gst' },
        { state: 'YT', expectedRate: 5, type: 'gst' },
      ]

      for (const { state, expectedRate, type } of provinces) {
        const rate = await tax.getTaxRate({ country: 'CA', state })
        expect(rate!.rate).toBe(expectedRate)
        expect(rate!.type).toBe(type)
      }
    })
  })

  describe('tax reporting edge cases', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should export data in JSON format', async () => {
      // Record a transaction first
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: UK_LONDON,
        orderId: 'export-test-order',
      })

      await tax.recordTaxTransaction({ orderId: 'export-test-order', result })

      const exportData = await tax.exportTaxData({
        startDate: new Date('2020-01-01'),
        endDate: new Date('2030-12-31'),
        format: 'json',
      })

      expect(exportData.format).toBe('json')
      const parsed = JSON.parse(exportData.data)
      expect(Array.isArray(parsed)).toBe(true)
    })

    it('should filter export by jurisdiction', async () => {
      // Record transactions for different jurisdictions
      const ukResult = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 1 }],
        shippingAddress: UK_LONDON,
      })
      await tax.recordTaxTransaction({ orderId: 'uk-order', result: ukResult })

      const deResult = await tax.calculateTax({
        items: [{ productId: 'p2', price: 5000, quantity: 1 }],
        shippingAddress: DE_BERLIN,
      })
      await tax.recordTaxTransaction({ orderId: 'de-order', result: deResult })

      const ukExport = await tax.exportTaxData({
        startDate: new Date('2020-01-01'),
        endDate: new Date('2030-12-31'),
        format: 'json',
        jurisdiction: { country: 'GB' },
      })

      const parsed = JSON.parse(ukExport.data)
      expect(parsed.length).toBe(1)
      expect(parsed[0].orderId).toBe('uk-order')
    })

    it('should handle refund for non-existent order', async () => {
      await expect(
        tax.calculateRefundTax({
          originalOrderId: 'non-existent-order',
          refundAmount: 1000,
        })
      ).rejects.toThrow('Original transaction not found')
    })

    it('should calculate partial refund correctly', async () => {
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 20000, quantity: 1 }],
        shippingAddress: UK_LONDON,
      })

      await tax.recordTaxTransaction({ orderId: 'partial-refund-order', result })

      // Refund 25% of the order
      const refund = await tax.calculateRefundTax({
        originalOrderId: 'partial-refund-order',
        refundAmount: 5000,
      })

      // Original tax rate: 4000/20000 = 20%
      // Refund tax: 5000 * 0.20 = 1000
      expect(refund.taxRefund).toBe(1000)
      expect(refund.netRefund).toBe(4000)
    })
  })

  describe('input validation', () => {
    let tax: TaxEngine

    beforeEach(() => {
      tax = createTestTaxEngine()
    })

    it('should handle missing country gracefully', async () => {
      const validation = await tax.validateJurisdiction({
        state: 'CA',
      } as TaxJurisdiction)

      expect(validation.valid).toBe(false)
    })

    it('should handle empty string country', async () => {
      const rate = await tax.getTaxRate({
        country: '',
        state: 'CA',
      })

      expect(rate).toBeNull()
    })

    it('should handle case-insensitive country codes', async () => {
      const rates = await Promise.all([
        tax.getTaxRate({ country: 'gb' }),
        tax.getTaxRate({ country: 'GB' }),
        tax.getTaxRate({ country: 'Gb' }),
      ])

      expect(rates[0]!.rate).toBe(rates[1]!.rate)
      expect(rates[1]!.rate).toBe(rates[2]!.rate)
      expect(rates[0]!.rate).toBe(20)
    })

    it('should handle negative prices', async () => {
      const result = await tax.calculateTax({
        items: [{ productId: 'credit-1', price: -1000, quantity: 1 }],
        shippingAddress: UK_LONDON,
      })

      // Negative prices result in negative tax (credits/adjustments)
      expect(result.taxAmount).toBe(-200)
    })

    it('should handle zero quantity', async () => {
      const result = await tax.calculateTax({
        items: [{ productId: 'p1', price: 10000, quantity: 0 }],
        shippingAddress: UK_LONDON,
      })

      expect(result.subtotal).toBe(0)
      expect(result.taxAmount).toBe(0)
    })
  })
})
