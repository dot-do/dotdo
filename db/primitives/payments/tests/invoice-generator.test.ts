/**
 * InvoiceGenerator tests
 *
 * GREEN phase: Tests for invoice generation and management.
 *
 * Features:
 * - Generate invoices from subscriptions
 * - Add line items (subscription, usage, one-time, discounts, tax)
 * - Finalize draft invoices
 * - Void invoices
 * - Mark invoices as paid
 * - Invoice number sequencing
 * - Due date calculation
 * - Currency formatting
 * - PDF generation (template-based)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createInvoiceGenerator,
  type InvoiceGenerator,
  type Invoice,
  type LineItem,
  type LineItemType,
  type InvoiceStatus,
  type Subscription,
  type UsageRecord,
  type Discount,
  type TaxLine,
} from '../invoice-generator'

// ============================================================================
// TEST DATA AND HELPERS
// ============================================================================

function createTestSubscription(overrides?: Partial<Subscription>): Subscription {
  return {
    id: 'sub_123',
    customerId: 'cust_456',
    planId: 'plan_pro',
    planName: 'Pro Plan',
    amount: 9900, // $99.00 in cents
    currency: 'USD',
    billingCycle: 'monthly',
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date('2026-01-31'),
    quantity: 1,
    ...overrides,
  }
}

function createTestUsageRecord(overrides?: Partial<UsageRecord>): UsageRecord {
  return {
    id: 'usage_789',
    subscriptionId: 'sub_123',
    metricId: 'api_calls',
    metricName: 'API Calls',
    quantity: 10000,
    unitPrice: 1, // $0.01 per call in cents
    total: 10000, // $100.00
    periodStart: new Date('2026-01-01'),
    periodEnd: new Date('2026-01-31'),
    ...overrides,
  }
}

// ============================================================================
// INVOICE GENERATION FROM SUBSCRIPTION
// ============================================================================

describe('InvoiceGenerator', () => {
  let generator: InvoiceGenerator

  beforeEach(() => {
    generator = createInvoiceGenerator()
  })

  describe('generate from subscription', () => {
    it('should generate an invoice from a subscription', async () => {
      const subscription = createTestSubscription()

      const invoice = await generator.generate(subscription.id, subscription)

      expect(invoice).toBeDefined()
      expect(invoice.id).toBeDefined()
      expect(invoice.subscriptionId).toBe(subscription.id)
      expect(invoice.customerId).toBe(subscription.customerId)
      expect(invoice.currency).toBe('USD')
      expect(invoice.status).toBe('draft')
    })

    it('should create subscription line item automatically', async () => {
      const subscription = createTestSubscription()

      const invoice = await generator.generate(subscription.id, subscription)

      expect(invoice.lineItems.length).toBe(1)
      expect(invoice.lineItems[0].type).toBe('subscription')
      expect(invoice.lineItems[0].description).toContain('Pro Plan')
      expect(invoice.lineItems[0].amount).toBe(9900)
      expect(invoice.lineItems[0].quantity).toBe(1)
    })

    it('should handle subscription quantity', async () => {
      const subscription = createTestSubscription({ quantity: 5 })

      const invoice = await generator.generate(subscription.id, subscription)

      expect(invoice.lineItems[0].quantity).toBe(5)
      expect(invoice.subtotal).toBe(9900 * 5)
    })

    it('should set billing period on invoice', async () => {
      const subscription = createTestSubscription()

      const invoice = await generator.generate(subscription.id, subscription)

      expect(invoice.periodStart).toEqual(subscription.currentPeriodStart)
      expect(invoice.periodEnd).toEqual(subscription.currentPeriodEnd)
    })

    it('should generate draft status by default', async () => {
      const subscription = createTestSubscription()

      const invoice = await generator.generate(subscription.id, subscription)

      expect(invoice.status).toBe('draft')
    })
  })

  // ============================================================================
  // LINE ITEM MANAGEMENT
  // ============================================================================

  describe('line item management', () => {
    it('should add a subscription line item', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const item: LineItem = {
        type: 'subscription',
        description: 'Additional seat',
        amount: 2000,
        quantity: 1,
      }

      const updated = await generator.addLineItem(invoice.id, item)

      expect(updated.lineItems.length).toBe(2)
      expect(updated.lineItems[1].description).toBe('Additional seat')
      expect(updated.subtotal).toBe(9900 + 2000)
    })

    it('should add a usage-based line item', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const usage = createTestUsageRecord()
      const item: LineItem = {
        type: 'usage',
        description: `${usage.metricName} (${usage.quantity} units)`,
        amount: usage.unitPrice,
        quantity: usage.quantity,
        metadata: { usageRecordId: usage.id },
      }

      const updated = await generator.addLineItem(invoice.id, item)

      expect(updated.lineItems.length).toBe(2)
      expect(updated.lineItems[1].type).toBe('usage')
      expect(updated.lineItems[1].amount * updated.lineItems[1].quantity!).toBe(10000)
    })

    it('should add a one-time charge', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const item: LineItem = {
        type: 'one_time',
        description: 'Setup fee',
        amount: 5000,
        quantity: 1,
      }

      const updated = await generator.addLineItem(invoice.id, item)

      expect(updated.lineItems[1].type).toBe('one_time')
      expect(updated.subtotal).toBe(9900 + 5000)
    })

    it('should add a discount line item (negative amount)', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const discount: Discount = {
        code: 'SAVE20',
        type: 'percentage',
        value: 20,
      }
      const discountAmount = Math.round(invoice.subtotal * 0.2)

      const item: LineItem = {
        type: 'discount',
        description: `Discount: ${discount.code} (${discount.value}%)`,
        amount: -discountAmount,
        quantity: 1,
        metadata: { discountCode: discount.code },
      }

      const updated = await generator.addLineItem(invoice.id, item)

      expect(updated.lineItems[1].type).toBe('discount')
      expect(updated.lineItems[1].amount).toBeLessThan(0)
      expect(updated.subtotal).toBe(9900 - discountAmount)
    })

    it('should add fixed amount discount', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const item: LineItem = {
        type: 'discount',
        description: 'Loyalty discount',
        amount: -1000, // $10 off
        quantity: 1,
      }

      const updated = await generator.addLineItem(invoice.id, item)

      expect(updated.subtotal).toBe(9900 - 1000)
    })

    it('should add tax line item', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const taxLine: TaxLine = {
        name: 'CA Sales Tax',
        rate: 8.25,
        amount: Math.round(invoice.subtotal * 0.0825),
        jurisdiction: 'CA',
      }

      const item: LineItem = {
        type: 'tax',
        description: `${taxLine.name} (${taxLine.rate}%)`,
        amount: taxLine.amount,
        quantity: 1,
        metadata: { taxRate: taxLine.rate, jurisdiction: taxLine.jurisdiction },
      }

      const updated = await generator.addLineItem(invoice.id, item)

      expect(updated.lineItems[1].type).toBe('tax')
      expect(updated.tax).toBe(taxLine.amount)
    })

    it('should generate unique line item IDs', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      await generator.addLineItem(invoice.id, {
        type: 'one_time',
        description: 'Item 1',
        amount: 100,
        quantity: 1,
      })

      const updated = await generator.addLineItem(invoice.id, {
        type: 'one_time',
        description: 'Item 2',
        amount: 200,
        quantity: 1,
      })

      const ids = updated.lineItems.map((li) => li.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('should throw error when adding to non-existent invoice', async () => {
      const item: LineItem = {
        type: 'one_time',
        description: 'Test',
        amount: 100,
        quantity: 1,
      }

      await expect(generator.addLineItem('nonexistent', item)).rejects.toThrow(
        'Invoice not found'
      )
    })

    it('should throw error when adding to finalized invoice', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)
      await generator.finalize(invoice.id)

      const item: LineItem = {
        type: 'one_time',
        description: 'Test',
        amount: 100,
        quantity: 1,
      }

      await expect(generator.addLineItem(invoice.id, item)).rejects.toThrow(
        'Cannot modify finalized invoice'
      )
    })
  })

  // ============================================================================
  // INVOICE FINALIZATION
  // ============================================================================

  describe('invoice finalization', () => {
    it('should finalize a draft invoice', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const finalized = await generator.finalize(invoice.id)

      expect(finalized.status).toBe('open')
    })

    it('should assign invoice number on finalization', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const finalized = await generator.finalize(invoice.id)

      expect(finalized.invoiceNumber).toBeDefined()
      expect(finalized.invoiceNumber).toMatch(/^INV-\d+$/)
    })

    it('should generate sequential invoice numbers', async () => {
      const subscription = createTestSubscription()

      const invoice1 = await generator.generate('sub_1', subscription)
      const finalized1 = await generator.finalize(invoice1.id)

      const invoice2 = await generator.generate('sub_2', subscription)
      const finalized2 = await generator.finalize(invoice2.id)

      const num1 = parseInt(finalized1.invoiceNumber!.replace('INV-', ''))
      const num2 = parseInt(finalized2.invoiceNumber!.replace('INV-', ''))

      expect(num2).toBe(num1 + 1)
    })

    it('should calculate due date on finalization', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const finalized = await generator.finalize(invoice.id)

      expect(finalized.dueDate).toBeDefined()
      expect(finalized.dueDate!.getTime()).toBeGreaterThan(Date.now())
    })

    it('should use custom due date if provided', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const customDueDate = new Date('2026-02-15')
      const finalized = await generator.finalize(invoice.id, { dueDate: customDueDate })

      expect(finalized.dueDate).toEqual(customDueDate)
    })

    it('should set finalized timestamp', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const before = Date.now()
      const finalized = await generator.finalize(invoice.id)
      const after = Date.now()

      expect(finalized.finalizedAt).toBeDefined()
      expect(finalized.finalizedAt!.getTime()).toBeGreaterThanOrEqual(before)
      expect(finalized.finalizedAt!.getTime()).toBeLessThanOrEqual(after)
    })

    it('should calculate total with all line items', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      // Add usage
      await generator.addLineItem(invoice.id, {
        type: 'usage',
        description: 'API calls',
        amount: 1,
        quantity: 5000,
      })

      // Add discount
      await generator.addLineItem(invoice.id, {
        type: 'discount',
        description: 'Promo',
        amount: -1000,
        quantity: 1,
      })

      // Add tax (on subtotal before discount for this test)
      const subtotalBeforeTax = 9900 + 5000 - 1000
      const taxAmount = Math.round(subtotalBeforeTax * 0.1)
      await generator.addLineItem(invoice.id, {
        type: 'tax',
        description: 'Tax 10%',
        amount: taxAmount,
        quantity: 1,
      })

      const finalized = await generator.finalize(invoice.id)

      expect(finalized.subtotal).toBe(9900 + 5000 - 1000)
      expect(finalized.tax).toBe(taxAmount)
      expect(finalized.total).toBe(subtotalBeforeTax + taxAmount)
    })

    it('should throw error when finalizing already finalized invoice', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)
      await generator.finalize(invoice.id)

      await expect(generator.finalize(invoice.id)).rejects.toThrow(
        'Invoice already finalized'
      )
    })

    it('should throw error when finalizing non-existent invoice', async () => {
      await expect(generator.finalize('nonexistent')).rejects.toThrow('Invoice not found')
    })
  })

  // ============================================================================
  // VOID INVOICE
  // ============================================================================

  describe('void invoice', () => {
    it('should void a draft invoice', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const voided = await generator.void(invoice.id)

      expect(voided.status).toBe('void')
    })

    it('should void an open invoice', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)
      await generator.finalize(invoice.id)

      const voided = await generator.void(invoice.id)

      expect(voided.status).toBe('void')
    })

    it('should set voided timestamp', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const before = Date.now()
      const voided = await generator.void(invoice.id)
      const after = Date.now()

      expect(voided.voidedAt).toBeDefined()
      expect(voided.voidedAt!.getTime()).toBeGreaterThanOrEqual(before)
      expect(voided.voidedAt!.getTime()).toBeLessThanOrEqual(after)
    })

    it('should accept void reason', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const voided = await generator.void(invoice.id, { reason: 'Customer requested cancellation' })

      expect(voided.voidReason).toBe('Customer requested cancellation')
    })

    it('should throw error when voiding paid invoice', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)
      await generator.finalize(invoice.id)
      await generator.markPaid(invoice.id)

      await expect(generator.void(invoice.id)).rejects.toThrow('Cannot void paid invoice')
    })

    it('should throw error when voiding already voided invoice', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)
      await generator.void(invoice.id)

      await expect(generator.void(invoice.id)).rejects.toThrow('Invoice already void')
    })

    it('should throw error when voiding non-existent invoice', async () => {
      await expect(generator.void('nonexistent')).rejects.toThrow('Invoice not found')
    })
  })

  // ============================================================================
  // MARK PAID
  // ============================================================================

  describe('mark paid', () => {
    it('should mark an open invoice as paid', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)
      await generator.finalize(invoice.id)

      const paid = await generator.markPaid(invoice.id)

      expect(paid.status).toBe('paid')
    })

    it('should set paid timestamp', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)
      await generator.finalize(invoice.id)

      const before = Date.now()
      const paid = await generator.markPaid(invoice.id)
      const after = Date.now()

      expect(paid.paidAt).toBeDefined()
      expect(paid.paidAt!.getTime()).toBeGreaterThanOrEqual(before)
      expect(paid.paidAt!.getTime()).toBeLessThanOrEqual(after)
    })

    it('should accept payment reference', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)
      await generator.finalize(invoice.id)

      const paid = await generator.markPaid(invoice.id, { paymentId: 'pay_abc123' })

      expect(paid.paymentId).toBe('pay_abc123')
    })

    it('should accept payment method', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)
      await generator.finalize(invoice.id)

      const paid = await generator.markPaid(invoice.id, { paymentMethod: 'card' })

      expect(paid.paymentMethod).toBe('card')
    })

    it('should throw error when marking draft invoice as paid', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      await expect(generator.markPaid(invoice.id)).rejects.toThrow(
        'Cannot mark draft invoice as paid'
      )
    })

    it('should throw error when marking already paid invoice', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)
      await generator.finalize(invoice.id)
      await generator.markPaid(invoice.id)

      await expect(generator.markPaid(invoice.id)).rejects.toThrow('Invoice already paid')
    })

    it('should throw error when marking void invoice as paid', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)
      await generator.void(invoice.id)

      await expect(generator.markPaid(invoice.id)).rejects.toThrow(
        'Cannot mark void invoice as paid'
      )
    })

    it('should throw error when marking non-existent invoice as paid', async () => {
      await expect(generator.markPaid('nonexistent')).rejects.toThrow('Invoice not found')
    })
  })

  // ============================================================================
  // INVOICE NUMBER SEQUENCING
  // ============================================================================

  describe('invoice number sequencing', () => {
    it('should use custom prefix for invoice numbers', async () => {
      const customGenerator = createInvoiceGenerator({ prefix: 'ACME' })
      const subscription = createTestSubscription()

      const invoice = await customGenerator.generate(subscription.id, subscription)
      const finalized = await customGenerator.finalize(invoice.id)

      expect(finalized.invoiceNumber).toMatch(/^ACME-\d+$/)
    })

    it('should pad invoice numbers with zeros', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const finalized = await generator.finalize(invoice.id)

      // Should be at least 6 digits
      const numPart = finalized.invoiceNumber!.replace('INV-', '')
      expect(numPart.length).toBeGreaterThanOrEqual(6)
    })

    it('should support custom starting number', async () => {
      const customGenerator = createInvoiceGenerator({ startingNumber: 1000 })
      const subscription = createTestSubscription()

      const invoice = await customGenerator.generate(subscription.id, subscription)
      const finalized = await customGenerator.finalize(invoice.id)

      const num = parseInt(finalized.invoiceNumber!.replace('INV-', ''))
      expect(num).toBe(1000)
    })
  })

  // ============================================================================
  // DUE DATE CALCULATION
  // ============================================================================

  describe('due date calculation', () => {
    it('should default to 30 days from finalization', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const finalized = await generator.finalize(invoice.id)

      const expectedDue = new Date(finalized.finalizedAt!)
      expectedDue.setDate(expectedDue.getDate() + 30)

      // Allow 1 second tolerance for test execution time
      expect(Math.abs(finalized.dueDate!.getTime() - expectedDue.getTime())).toBeLessThan(1000)
    })

    it('should support custom payment terms', async () => {
      const customGenerator = createInvoiceGenerator({ paymentTermsDays: 15 })
      const subscription = createTestSubscription()

      const invoice = await customGenerator.generate(subscription.id, subscription)
      const finalized = await customGenerator.finalize(invoice.id)

      const expectedDue = new Date(finalized.finalizedAt!)
      expectedDue.setDate(expectedDue.getDate() + 15)

      expect(Math.abs(finalized.dueDate!.getTime() - expectedDue.getTime())).toBeLessThan(1000)
    })

    it('should support net terms (NET 30, NET 60, etc)', async () => {
      const net60Generator = createInvoiceGenerator({ paymentTermsDays: 60 })
      const subscription = createTestSubscription()

      const invoice = await net60Generator.generate(subscription.id, subscription)
      const finalized = await net60Generator.finalize(invoice.id)

      const expectedDue = new Date(finalized.finalizedAt!)
      expectedDue.setDate(expectedDue.getDate() + 60)

      expect(Math.abs(finalized.dueDate!.getTime() - expectedDue.getTime())).toBeLessThan(1000)
    })

    it('should support due on receipt (0 days)', async () => {
      const dueOnReceiptGenerator = createInvoiceGenerator({ paymentTermsDays: 0 })
      const subscription = createTestSubscription()

      const invoice = await dueOnReceiptGenerator.generate(subscription.id, subscription)
      const finalized = await dueOnReceiptGenerator.finalize(invoice.id)

      expect(Math.abs(finalized.dueDate!.getTime() - finalized.finalizedAt!.getTime())).toBeLessThan(
        1000
      )
    })
  })

  // ============================================================================
  // CURRENCY FORMATTING
  // ============================================================================

  describe('currency formatting', () => {
    it('should store amounts in smallest currency unit (cents)', async () => {
      const subscription = createTestSubscription({ amount: 9900 }) // $99.00

      const invoice = await generator.generate(subscription.id, subscription)

      expect(invoice.lineItems[0].amount).toBe(9900)
      expect(invoice.subtotal).toBe(9900)
    })

    it('should format currency for display', async () => {
      const subscription = createTestSubscription({ amount: 9999, currency: 'USD' })
      const invoice = await generator.generate(subscription.id, subscription)

      const formatted = generator.formatCurrency(invoice.subtotal, invoice.currency)

      expect(formatted).toBe('$99.99')
    })

    it('should format EUR currency', async () => {
      const subscription = createTestSubscription({ amount: 9900, currency: 'EUR' })
      const invoice = await generator.generate(subscription.id, subscription)

      const formatted = generator.formatCurrency(invoice.subtotal, invoice.currency)

      expect(formatted).toMatch(/99[,.]00/)
      expect(formatted).toContain('\u20AC') // Euro symbol
    })

    it('should format GBP currency', async () => {
      const subscription = createTestSubscription({ amount: 9900, currency: 'GBP' })
      const invoice = await generator.generate(subscription.id, subscription)

      const formatted = generator.formatCurrency(invoice.subtotal, invoice.currency)

      expect(formatted).toContain('\u00A3') // Pound symbol
    })

    it('should handle zero-decimal currencies (JPY)', async () => {
      const subscription = createTestSubscription({ amount: 9900, currency: 'JPY' })
      const invoice = await generator.generate(subscription.id, subscription)

      const formatted = generator.formatCurrency(invoice.subtotal, invoice.currency)

      expect(formatted).toContain('\u00A5') // Yen symbol
      expect(formatted).toMatch(/9,?900/)
    })
  })

  // ============================================================================
  // PDF GENERATION
  // ============================================================================

  describe('PDF generation', () => {
    it('should generate PDF for finalized invoice', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)
      await generator.finalize(invoice.id)

      const pdf = await generator.generatePDF(invoice.id)

      expect(pdf).toBeDefined()
      expect(pdf.data).toBeInstanceOf(Uint8Array)
      expect(pdf.filename).toMatch(/INV-\d+\.pdf$/)
      expect(pdf.contentType).toBe('application/pdf')
    })

    it('should include invoice details in PDF', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)
      const finalized = await generator.finalize(invoice.id)

      const pdf = await generator.generatePDF(invoice.id)

      // PDF metadata should include invoice number
      expect(pdf.metadata?.invoiceNumber).toBe(finalized.invoiceNumber)
      expect(pdf.metadata?.customerId).toBe(subscription.customerId)
    })

    it('should support custom template', async () => {
      const customGenerator = createInvoiceGenerator({
        pdfTemplate: 'minimal',
      })
      const subscription = createTestSubscription()
      const invoice = await customGenerator.generate(subscription.id, subscription)
      await customGenerator.finalize(invoice.id)

      const pdf = await customGenerator.generatePDF(invoice.id)

      expect(pdf.template).toBe('minimal')
    })

    it('should include company branding', async () => {
      const brandedGenerator = createInvoiceGenerator({
        branding: {
          companyName: 'Acme Corp',
          logoUrl: 'https://example.com/logo.png',
          primaryColor: '#FF5500',
        },
      })
      const subscription = createTestSubscription()
      const invoice = await brandedGenerator.generate(subscription.id, subscription)
      await brandedGenerator.finalize(invoice.id)

      const pdf = await brandedGenerator.generatePDF(invoice.id)

      expect(pdf.metadata?.companyName).toBe('Acme Corp')
    })

    it('should throw error for draft invoice PDF', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      await expect(generator.generatePDF(invoice.id)).rejects.toThrow(
        'Cannot generate PDF for draft invoice'
      )
    })

    it('should throw error for non-existent invoice PDF', async () => {
      await expect(generator.generatePDF('nonexistent')).rejects.toThrow('Invoice not found')
    })
  })

  // ============================================================================
  // INVOICE RETRIEVAL
  // ============================================================================

  describe('invoice retrieval', () => {
    it('should get invoice by ID', async () => {
      const subscription = createTestSubscription()
      const created = await generator.generate(subscription.id, subscription)

      const retrieved = await generator.get(created.id)

      expect(retrieved).toBeDefined()
      expect(retrieved!.id).toBe(created.id)
    })

    it('should return null for non-existent invoice', async () => {
      const retrieved = await generator.get('nonexistent')

      expect(retrieved).toBeNull()
    })

    it('should list invoices by customer', async () => {
      const subscription = createTestSubscription()
      await generator.generate('sub_1', subscription)
      await generator.generate('sub_2', subscription)

      const invoices = await generator.list({ customerId: subscription.customerId })

      expect(invoices.length).toBe(2)
    })

    it('should list invoices by status', async () => {
      const subscription = createTestSubscription()
      const draft = await generator.generate('sub_1', subscription)
      const toFinalize = await generator.generate('sub_2', subscription)
      await generator.finalize(toFinalize.id)

      const draftInvoices = await generator.list({ status: 'draft' })
      const openInvoices = await generator.list({ status: 'open' })

      expect(draftInvoices.length).toBe(1)
      expect(openInvoices.length).toBe(1)
    })

    it('should list invoices by subscription', async () => {
      const subscription = createTestSubscription()
      await generator.generate('sub_1', subscription)
      await generator.generate('sub_1', subscription)
      await generator.generate('sub_2', subscription)

      const invoices = await generator.list({ subscriptionId: 'sub_1' })

      expect(invoices.length).toBe(2)
    })

    it('should sort invoices by creation date descending', async () => {
      const subscription = createTestSubscription()
      const first = await generator.generate('sub_1', subscription)
      const second = await generator.generate('sub_2', subscription)

      const invoices = await generator.list({ customerId: subscription.customerId })

      expect(invoices[0].id).toBe(second.id)
      expect(invoices[1].id).toBe(first.id)
    })
  })

  // ============================================================================
  // COUPON AND DISCOUNT APPLICATION
  // ============================================================================

  describe('coupon and discount application', () => {
    it('should apply percentage coupon', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const updated = await generator.applyCoupon(invoice.id, {
        code: 'SAVE20',
        type: 'percentage',
        value: 20,
      })

      const discountLine = updated.lineItems.find((li) => li.type === 'discount')
      expect(discountLine).toBeDefined()
      expect(discountLine!.amount).toBe(-Math.round(9900 * 0.2))
    })

    it('should apply fixed amount coupon', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const updated = await generator.applyCoupon(invoice.id, {
        code: 'FLAT10',
        type: 'fixed',
        value: 1000,
      })

      const discountLine = updated.lineItems.find((li) => li.type === 'discount')
      expect(discountLine).toBeDefined()
      expect(discountLine!.amount).toBe(-1000)
    })

    it('should not allow discount greater than subtotal', async () => {
      const subscription = createTestSubscription({ amount: 500 })
      const invoice = await generator.generate(subscription.id, subscription)

      const updated = await generator.applyCoupon(invoice.id, {
        code: 'FLAT10',
        type: 'fixed',
        value: 1000,
      })

      expect(updated.subtotal).toBeGreaterThanOrEqual(0)
    })

    it('should track applied coupon code', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const updated = await generator.applyCoupon(invoice.id, {
        code: 'SAVE20',
        type: 'percentage',
        value: 20,
      })

      expect(updated.appliedCoupons).toContain('SAVE20')
    })

    it('should not allow duplicate coupon application', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      await generator.applyCoupon(invoice.id, {
        code: 'SAVE20',
        type: 'percentage',
        value: 20,
      })

      await expect(
        generator.applyCoupon(invoice.id, {
          code: 'SAVE20',
          type: 'percentage',
          value: 20,
        })
      ).rejects.toThrow('Coupon already applied')
    })
  })

  // ============================================================================
  // TAX LINE HANDLING
  // ============================================================================

  describe('tax line handling', () => {
    it('should add multiple tax lines for compound taxes', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      await generator.addLineItem(invoice.id, {
        type: 'tax',
        description: 'State Tax (6%)',
        amount: Math.round(9900 * 0.06),
        quantity: 1,
        metadata: { jurisdiction: 'CA', taxType: 'state' },
      })

      const updated = await generator.addLineItem(invoice.id, {
        type: 'tax',
        description: 'City Tax (1%)',
        amount: Math.round(9900 * 0.01),
        quantity: 1,
        metadata: { jurisdiction: 'SF', taxType: 'city' },
      })

      const taxLines = updated.lineItems.filter((li) => li.type === 'tax')
      expect(taxLines.length).toBe(2)
      expect(updated.tax).toBe(Math.round(9900 * 0.06) + Math.round(9900 * 0.01))
    })

    it('should calculate total with taxes correctly', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription)

      const taxAmount = Math.round(9900 * 0.1)
      await generator.addLineItem(invoice.id, {
        type: 'tax',
        description: 'Tax 10%',
        amount: taxAmount,
        quantity: 1,
      })

      const finalized = await generator.finalize(invoice.id)

      expect(finalized.subtotal).toBe(9900)
      expect(finalized.tax).toBe(taxAmount)
      expect(finalized.total).toBe(9900 + taxAmount)
    })
  })

  // ============================================================================
  // METADATA AND NOTES
  // ============================================================================

  describe('metadata and notes', () => {
    it('should support custom metadata on invoice', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription, {
        metadata: { projectId: 'proj_123', departmentId: 'eng' },
      })

      expect(invoice.metadata?.projectId).toBe('proj_123')
      expect(invoice.metadata?.departmentId).toBe('eng')
    })

    it('should support notes on invoice', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription, {
        notes: 'Thank you for your business!',
      })

      expect(invoice.notes).toBe('Thank you for your business!')
    })

    it('should support memo field', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription, {
        memo: 'PO #12345',
      })

      expect(invoice.memo).toBe('PO #12345')
    })
  })

  // ============================================================================
  // BILLING ADDRESS
  // ============================================================================

  describe('billing address', () => {
    it('should include billing address when provided', async () => {
      const subscription = createTestSubscription()
      const invoice = await generator.generate(subscription.id, subscription, {
        billingAddress: {
          name: 'John Doe',
          line1: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          postalCode: '94102',
          country: 'US',
        },
      })

      expect(invoice.billingAddress).toBeDefined()
      expect(invoice.billingAddress?.city).toBe('San Francisco')
    })
  })
})
