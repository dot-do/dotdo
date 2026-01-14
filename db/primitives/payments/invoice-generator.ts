/**
 * InvoiceGenerator - Invoice generation and management primitive
 *
 * Provides comprehensive invoice functionality:
 * - Generate invoices from subscriptions
 * - Manage line items (subscription, usage, one-time, discounts, tax)
 * - Invoice finalization and number sequencing
 * - Void and payment tracking
 * - Currency formatting
 * - PDF generation (template-based)
 *
 * @module db/primitives/payments/invoice-generator
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Line item types
 */
export type LineItemType = 'subscription' | 'usage' | 'one_time' | 'discount' | 'tax'

/**
 * Invoice status
 */
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'

/**
 * Billing cycle
 */
export type BillingCycle = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'

/**
 * Discount type
 */
export type DiscountType = 'percentage' | 'fixed'

/**
 * Subscription record for invoice generation
 */
export interface Subscription {
  id: string
  customerId: string
  planId: string
  planName: string
  amount: number
  currency: string
  billingCycle: BillingCycle
  currentPeriodStart: Date
  currentPeriodEnd: Date
  quantity: number
  metadata?: Record<string, unknown>
}

/**
 * Usage record for usage-based billing
 */
export interface UsageRecord {
  id: string
  subscriptionId: string
  metricId: string
  metricName: string
  quantity: number
  unitPrice: number
  total: number
  periodStart: Date
  periodEnd: Date
}

/**
 * Discount definition
 */
export interface Discount {
  code: string
  type: DiscountType
  value: number
}

/**
 * Tax line definition
 */
export interface TaxLine {
  name: string
  rate: number
  amount: number
  jurisdiction?: string
}

/**
 * Line item on an invoice
 */
export interface LineItem {
  id?: string
  type: LineItemType
  description: string
  amount: number
  quantity?: number
  metadata?: Record<string, unknown>
}

/**
 * Billing address
 */
export interface BillingAddress {
  name?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
}

/**
 * Invoice record
 */
export interface Invoice {
  id: string
  subscriptionId?: string
  customerId: string
  currency: string
  status: InvoiceStatus
  lineItems: (LineItem & { id: string })[]
  subtotal: number
  discount?: number
  tax?: number
  total: number
  invoiceNumber?: string
  periodStart?: Date
  periodEnd?: Date
  dueDate?: Date
  finalizedAt?: Date
  paidAt?: Date
  voidedAt?: Date
  voidReason?: string
  paymentId?: string
  paymentMethod?: string
  appliedCoupons?: string[]
  notes?: string
  memo?: string
  metadata?: Record<string, unknown>
  billingAddress?: BillingAddress
  createdAt: Date
  updatedAt: Date
}

/**
 * Invoice generation options
 */
export interface GenerateOptions {
  notes?: string
  memo?: string
  metadata?: Record<string, unknown>
  billingAddress?: BillingAddress
}

/**
 * Finalize options
 */
export interface FinalizeOptions {
  dueDate?: Date
}

/**
 * Void options
 */
export interface VoidOptions {
  reason?: string
}

/**
 * Mark paid options
 */
export interface MarkPaidOptions {
  paymentId?: string
  paymentMethod?: string
}

/**
 * List filter options
 */
export interface ListOptions {
  customerId?: string
  subscriptionId?: string
  status?: InvoiceStatus
}

/**
 * Coupon to apply
 */
export interface CouponInput {
  code: string
  type: DiscountType
  value: number
}

/**
 * PDF generation result
 */
export interface PDFResult {
  data: Uint8Array
  filename: string
  contentType: string
  template?: string
  metadata?: {
    invoiceNumber?: string
    customerId?: string
    companyName?: string
  }
}

/**
 * Branding options for PDF
 */
export interface BrandingOptions {
  companyName?: string
  logoUrl?: string
  primaryColor?: string
  address?: BillingAddress
}

/**
 * Invoice generator configuration
 */
export interface InvoiceGeneratorConfig {
  prefix?: string
  startingNumber?: number
  paymentTermsDays?: number
  pdfTemplate?: string
  branding?: BrandingOptions
}

/**
 * Invoice generator interface
 */
export interface InvoiceGenerator {
  // Core operations
  generate(
    subscriptionId: string,
    subscription: Subscription,
    options?: GenerateOptions
  ): Promise<Invoice>
  addLineItem(invoiceId: string, item: LineItem): Promise<Invoice>
  finalize(invoiceId: string, options?: FinalizeOptions): Promise<Invoice>
  void(invoiceId: string, options?: VoidOptions): Promise<Invoice>
  markPaid(invoiceId: string, options?: MarkPaidOptions): Promise<Invoice>

  // Retrieval
  get(id: string): Promise<Invoice | null>
  list(options?: ListOptions): Promise<Invoice[]>

  // Coupon application
  applyCoupon(invoiceId: string, coupon: CouponInput): Promise<Invoice>

  // Currency formatting
  formatCurrency(amount: number, currency: string): string

  // PDF generation
  generatePDF(invoiceId: string): Promise<PDFResult>
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

/**
 * Zero-decimal currencies that don't use fractional units
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
])

function formatCurrencyAmount(amount: number, currency: string): string {
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())
  const displayAmount = isZeroDecimal ? amount : amount / 100

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: isZeroDecimal ? 0 : 2,
      maximumFractionDigits: isZeroDecimal ? 0 : 2,
    }).format(displayAmount)
  } catch {
    // Fallback for unsupported currencies
    return `${currency} ${displayAmount.toFixed(isZeroDecimal ? 0 : 2)}`
  }
}

function calculateSubtotal(lineItems: LineItem[]): number {
  return lineItems
    .filter((item) => item.type !== 'tax')
    .reduce((sum, item) => sum + item.amount * (item.quantity ?? 1), 0)
}

function calculateTax(lineItems: LineItem[]): number {
  return lineItems
    .filter((item) => item.type === 'tax')
    .reduce((sum, item) => sum + item.amount * (item.quantity ?? 1), 0)
}

function calculateTotal(subtotal: number, tax: number): number {
  return subtotal + tax
}

// =============================================================================
// Implementation
// =============================================================================

class InvoiceGeneratorImpl implements InvoiceGenerator {
  private invoices: Map<string, Invoice> = new Map()
  private invoiceOrder: string[] = [] // Track insertion order
  private invoiceCounter: number
  private config: Required<InvoiceGeneratorConfig>

  constructor(config?: InvoiceGeneratorConfig) {
    this.config = {
      prefix: config?.prefix ?? 'INV',
      startingNumber: config?.startingNumber ?? 1,
      paymentTermsDays: config?.paymentTermsDays ?? 30,
      pdfTemplate: config?.pdfTemplate ?? 'default',
      branding: config?.branding ?? {},
    }
    this.invoiceCounter = this.config.startingNumber - 1
  }

  async generate(
    subscriptionId: string,
    subscription: Subscription,
    options?: GenerateOptions
  ): Promise<Invoice> {
    const now = new Date()

    // Create subscription line item
    const subscriptionLineItem: LineItem & { id: string } = {
      id: generateId('li'),
      type: 'subscription',
      description: `${subscription.planName} (${subscription.billingCycle})`,
      amount: subscription.amount,
      quantity: subscription.quantity,
      metadata: {
        planId: subscription.planId,
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
      },
    }

    const subtotal = subscriptionLineItem.amount * subscriptionLineItem.quantity!

    const invoice: Invoice = {
      id: generateId('inv'),
      subscriptionId,
      customerId: subscription.customerId,
      currency: subscription.currency,
      status: 'draft',
      lineItems: [subscriptionLineItem],
      subtotal,
      tax: 0,
      total: subtotal,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      appliedCoupons: [],
      notes: options?.notes,
      memo: options?.memo,
      metadata: options?.metadata,
      billingAddress: options?.billingAddress,
      createdAt: now,
      updatedAt: now,
    }

    this.invoices.set(invoice.id, invoice)
    this.invoiceOrder.push(invoice.id)
    return invoice
  }

  async addLineItem(invoiceId: string, item: LineItem): Promise<Invoice> {
    const invoice = this.invoices.get(invoiceId)
    if (!invoice) {
      throw new Error('Invoice not found')
    }

    if (invoice.status !== 'draft') {
      throw new Error('Cannot modify finalized invoice')
    }

    const lineItem: LineItem & { id: string } = {
      ...item,
      id: item.id ?? generateId('li'),
      quantity: item.quantity ?? 1,
    }

    invoice.lineItems.push(lineItem)
    invoice.subtotal = calculateSubtotal(invoice.lineItems)
    invoice.tax = calculateTax(invoice.lineItems)
    invoice.total = calculateTotal(invoice.subtotal, invoice.tax)
    invoice.updatedAt = new Date()

    return invoice
  }

  async finalize(invoiceId: string, options?: FinalizeOptions): Promise<Invoice> {
    const invoice = this.invoices.get(invoiceId)
    if (!invoice) {
      throw new Error('Invoice not found')
    }

    if (invoice.status !== 'draft') {
      throw new Error('Invoice already finalized')
    }

    const now = new Date()

    // Increment invoice number
    this.invoiceCounter++
    invoice.invoiceNumber = `${this.config.prefix}-${String(this.invoiceCounter).padStart(6, '0')}`

    // Set finalized timestamp
    invoice.finalizedAt = now

    // Calculate due date
    if (options?.dueDate) {
      invoice.dueDate = options.dueDate
    } else {
      const dueDate = new Date(now)
      dueDate.setDate(dueDate.getDate() + this.config.paymentTermsDays)
      invoice.dueDate = dueDate
    }

    // Recalculate totals
    invoice.subtotal = calculateSubtotal(invoice.lineItems)
    invoice.tax = calculateTax(invoice.lineItems)
    invoice.total = calculateTotal(invoice.subtotal, invoice.tax)

    // Update status
    invoice.status = 'open'
    invoice.updatedAt = now

    return invoice
  }

  async void(invoiceId: string, options?: VoidOptions): Promise<Invoice> {
    const invoice = this.invoices.get(invoiceId)
    if (!invoice) {
      throw new Error('Invoice not found')
    }

    if (invoice.status === 'paid') {
      throw new Error('Cannot void paid invoice')
    }

    if (invoice.status === 'void') {
      throw new Error('Invoice already void')
    }

    const now = new Date()
    invoice.status = 'void'
    invoice.voidedAt = now
    invoice.voidReason = options?.reason
    invoice.updatedAt = now

    return invoice
  }

  async markPaid(invoiceId: string, options?: MarkPaidOptions): Promise<Invoice> {
    const invoice = this.invoices.get(invoiceId)
    if (!invoice) {
      throw new Error('Invoice not found')
    }

    if (invoice.status === 'draft') {
      throw new Error('Cannot mark draft invoice as paid')
    }

    if (invoice.status === 'paid') {
      throw new Error('Invoice already paid')
    }

    if (invoice.status === 'void') {
      throw new Error('Cannot mark void invoice as paid')
    }

    const now = new Date()
    invoice.status = 'paid'
    invoice.paidAt = now
    invoice.paymentId = options?.paymentId
    invoice.paymentMethod = options?.paymentMethod
    invoice.updatedAt = now

    return invoice
  }

  async get(id: string): Promise<Invoice | null> {
    return this.invoices.get(id) ?? null
  }

  async list(options?: ListOptions): Promise<Invoice[]> {
    let invoices = Array.from(this.invoices.values())

    if (options?.customerId) {
      invoices = invoices.filter((inv) => inv.customerId === options.customerId)
    }

    if (options?.subscriptionId) {
      invoices = invoices.filter((inv) => inv.subscriptionId === options.subscriptionId)
    }

    if (options?.status) {
      invoices = invoices.filter((inv) => inv.status === options.status)
    }

    // Sort by creation date descending, using insertion order as tie-breaker
    invoices.sort((a, b) => {
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime()
      if (timeDiff !== 0) return timeDiff
      // For same timestamp, use insertion order (later = higher index = should come first)
      return this.invoiceOrder.indexOf(b.id) - this.invoiceOrder.indexOf(a.id)
    })

    return invoices
  }

  async applyCoupon(invoiceId: string, coupon: CouponInput): Promise<Invoice> {
    const invoice = this.invoices.get(invoiceId)
    if (!invoice) {
      throw new Error('Invoice not found')
    }

    if (invoice.status !== 'draft') {
      throw new Error('Cannot modify finalized invoice')
    }

    // Check if coupon already applied
    if (invoice.appliedCoupons?.includes(coupon.code)) {
      throw new Error('Coupon already applied')
    }

    // Calculate discount amount
    let discountAmount: number
    if (coupon.type === 'percentage') {
      discountAmount = Math.round(invoice.subtotal * (coupon.value / 100))
    } else {
      discountAmount = coupon.value
    }

    // Cap discount at subtotal to prevent negative totals
    const currentSubtotalBeforeDiscount = invoice.lineItems
      .filter((item) => item.type !== 'tax' && item.type !== 'discount')
      .reduce((sum, item) => sum + item.amount * (item.quantity ?? 1), 0)

    if (discountAmount > currentSubtotalBeforeDiscount) {
      discountAmount = currentSubtotalBeforeDiscount
    }

    // Add discount line item
    const discountLineItem: LineItem & { id: string } = {
      id: generateId('li'),
      type: 'discount',
      description:
        coupon.type === 'percentage'
          ? `Discount: ${coupon.code} (${coupon.value}%)`
          : `Discount: ${coupon.code}`,
      amount: -discountAmount,
      quantity: 1,
      metadata: { discountCode: coupon.code, discountType: coupon.type, discountValue: coupon.value },
    }

    invoice.lineItems.push(discountLineItem)
    invoice.appliedCoupons = [...(invoice.appliedCoupons ?? []), coupon.code]

    // Recalculate totals
    invoice.subtotal = calculateSubtotal(invoice.lineItems)
    invoice.tax = calculateTax(invoice.lineItems)
    invoice.total = calculateTotal(invoice.subtotal, invoice.tax)
    invoice.updatedAt = new Date()

    return invoice
  }

  formatCurrency(amount: number, currency: string): string {
    return formatCurrencyAmount(amount, currency)
  }

  async generatePDF(invoiceId: string): Promise<PDFResult> {
    const invoice = this.invoices.get(invoiceId)
    if (!invoice) {
      throw new Error('Invoice not found')
    }

    if (invoice.status === 'draft') {
      throw new Error('Cannot generate PDF for draft invoice')
    }

    // Generate a simple PDF representation
    // In a real implementation, this would use a PDF library like pdfkit or puppeteer
    const pdfContent = this.generatePDFContent(invoice)
    const encoder = new TextEncoder()

    return {
      data: encoder.encode(pdfContent),
      filename: `${invoice.invoiceNumber}.pdf`,
      contentType: 'application/pdf',
      template: this.config.pdfTemplate,
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
        companyName: this.config.branding?.companyName,
      },
    }
  }

  private generatePDFContent(invoice: Invoice): string {
    // This generates a simple text representation
    // In production, this would generate actual PDF binary data
    const lines = [
      `INVOICE`,
      `Invoice Number: ${invoice.invoiceNumber}`,
      `Date: ${invoice.finalizedAt?.toISOString().split('T')[0]}`,
      `Due Date: ${invoice.dueDate?.toISOString().split('T')[0]}`,
      ``,
      `Customer: ${invoice.customerId}`,
      ``,
      `Line Items:`,
    ]

    for (const item of invoice.lineItems) {
      const total = item.amount * (item.quantity ?? 1)
      lines.push(
        `  ${item.description}: ${this.formatCurrency(total, invoice.currency)}`
      )
    }

    lines.push(``)
    lines.push(`Subtotal: ${this.formatCurrency(invoice.subtotal, invoice.currency)}`)
    if (invoice.tax) {
      lines.push(`Tax: ${this.formatCurrency(invoice.tax, invoice.currency)}`)
    }
    lines.push(`Total: ${this.formatCurrency(invoice.total, invoice.currency)}`)

    if (invoice.notes) {
      lines.push(``)
      lines.push(`Notes: ${invoice.notes}`)
    }

    return lines.join('\n')
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an InvoiceGenerator instance
 */
export function createInvoiceGenerator(config?: InvoiceGeneratorConfig): InvoiceGenerator {
  return new InvoiceGeneratorImpl(config)
}
