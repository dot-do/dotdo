/**
 * InvoiceDO - Invoice Generation and Management
 *
 * Handles invoice creation, line items, and status tracking.
 * Each invoice gets its own instance (keyed by invoiceId).
 *
 * Responsibilities:
 * - Generate invoices from subscription data
 * - Add line items (subscription, usage, proration)
 * - Calculate totals with tax
 * - Track invoice status
 * - Coordinate with Payment DO
 *
 * Invoice Status:
 * draft -> open -> paid
 *              |-> void
 *              |-> uncollectible
 *
 * Events Emitted:
 * - Invoice.created - New invoice generated
 * - Invoice.finalized - Invoice ready for payment
 * - Invoice.paid - Payment successful
 * - Invoice.voided - Invoice cancelled
 * - Invoice.uncollectible - All payment attempts failed
 * - Payment.process - Request payment processing
 * - Customer.notify - Send invoice notification
 */

import { DO } from 'dotdo'
import type { Plan } from './Subscription'
import type { UsageSummary } from './Usage'
import { PLANS } from './Subscription'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'
export type LineItemType = 'subscription' | 'usage' | 'proration' | 'credit' | 'tax'

export interface InvoiceLineItem {
  id: string
  description: string
  quantity: number
  unitPrice: number // In cents
  amount: number // In cents
  type: LineItemType
  metadata?: Record<string, unknown>
}

export interface Invoice {
  id: string
  subscriptionId: string
  customerId: string
  status: InvoiceStatus
  currency: string
  lineItems: InvoiceLineItem[]
  subtotal: number // In cents
  tax: number
  taxRate: number
  total: number
  periodStart: Date
  periodEnd: Date
  dueDate: Date
  paidAt?: Date
  voidedAt?: Date
  attemptCount: number
  lastAttemptAt?: Date
  createdAt: Date
  updatedAt: Date
}

export interface InvoiceGenerateRequest {
  subscriptionId: string
  customerId: string
  planId: string
  periodStart: Date
  periodEnd: Date
  taxRate?: number
  usageSummary?: UsageSummary
}

export class InvoiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'InvoiceError'
  }
}

// ============================================================================
// INVOICE DURABLE OBJECT
// ============================================================================

export class InvoiceDO extends DO {
  static readonly $type = 'InvoiceDO'

  /**
   * Register event handlers on startup.
   */
  async onStart() {
    // ========================================================================
    // INVOICE GENERATION HANDLERS
    // ========================================================================

    /**
     * Invoice.generate - Generate invoice for billing period
     */
    this.$.on.Invoice.generate(async (event) => {
      const { subscriptionId, customerId, planId, periodStart, periodEnd } = event.data as InvoiceGenerateRequest

      // Only handle if this is our invoice (keyed by generated ID)
      // For simplicity, we'll create the invoice directly
      const invoiceId = `inv_${crypto.randomUUID().slice(0, 8)}`

      console.log(`[Invoice] Generating invoice ${invoiceId} for ${subscriptionId}`)

      // Request usage data
      this.$.send('Invoice.requestUsage', {
        invoiceId,
        subscriptionId,
        period: this.formatPeriod(periodStart),
        planId,
      })

      // Store pending invoice data
      await this.ctx.storage.put('pending', {
        invoiceId,
        subscriptionId,
        customerId,
        planId,
        periodStart,
        periodEnd,
      })
    })

    /**
     * Usage.summary - Received usage data, finalize invoice
     */
    this.$.on.Usage.summary(async (event) => {
      const { subscriptionId, summary } = event.data as {
        subscriptionId: string
        period: string
        summary: UsageSummary
      }

      const pending = await this.ctx.storage.get<{
        invoiceId: string
        subscriptionId: string
        customerId: string
        planId: string
        periodStart: Date
        periodEnd: Date
      }>('pending')

      if (!pending || pending.subscriptionId !== subscriptionId) return

      // Create the invoice with usage
      const invoice = await this.createInvoice({
        ...pending,
        usageSummary: summary,
      })

      await this.ctx.storage.delete('pending')

      // Emit created event and request payment
      this.$.send('Invoice.created', {
        invoiceId: invoice.id,
        subscriptionId: invoice.subscriptionId,
        customerId: invoice.customerId,
        total: invoice.total,
        dueDate: invoice.dueDate,
      })

      // Immediately process payment
      this.$.send('Payment.process', {
        invoiceId: invoice.id,
        subscriptionId: invoice.subscriptionId,
        customerId: invoice.customerId,
        amount: invoice.total,
        currency: invoice.currency,
      })

      this.$.send('Customer.notify', {
        customerId: invoice.customerId,
        type: 'invoice_created',
        data: {
          invoiceId: invoice.id,
          total: invoice.total / 100, // Convert to dollars for display
          currency: invoice.currency,
          dueDate: invoice.dueDate,
        },
      })
    })

    /**
     * Invoice.generateProration - Generate proration invoice for plan upgrade
     */
    this.$.on.Invoice.generateProration(async (event) => {
      const { subscriptionId, customerId, amount, description } = event.data as {
        subscriptionId: string
        customerId: string
        amount: number
        description: string
      }

      console.log(`[Invoice] Generating proration invoice for ${subscriptionId}: $${(amount / 100).toFixed(2)}`)

      const invoice = await this.createProrationInvoice(subscriptionId, customerId, amount, description)

      this.$.send('Invoice.created', {
        invoiceId: invoice.id,
        subscriptionId: invoice.subscriptionId,
        customerId: invoice.customerId,
        total: invoice.total,
        type: 'proration',
      })

      // Immediately process payment
      this.$.send('Payment.process', {
        invoiceId: invoice.id,
        subscriptionId: invoice.subscriptionId,
        customerId: invoice.customerId,
        amount: invoice.total,
        currency: invoice.currency,
      })
    })

    // ========================================================================
    // PAYMENT RESPONSE HANDLERS
    // ========================================================================

    /**
     * Payment.succeeded - Mark invoice as paid
     */
    this.$.on.Payment.succeeded(async (event) => {
      const { invoiceId, paymentId } = event.data as {
        invoiceId: string
        subscriptionId: string
        paymentId: string
      }

      const invoice = await this.getInvoice()
      if (!invoice || invoice.id !== invoiceId) return

      console.log(`[Invoice] Payment succeeded for ${invoiceId}`)

      invoice.status = 'paid'
      invoice.paidAt = new Date()
      invoice.updatedAt = new Date()
      await this.saveInvoice(invoice)

      this.$.send('Invoice.paid', {
        invoiceId,
        subscriptionId: invoice.subscriptionId,
        customerId: invoice.customerId,
        amount: invoice.total,
        paymentId,
      })

      this.$.send('Customer.notify', {
        customerId: invoice.customerId,
        type: 'payment_succeeded',
        data: {
          invoiceId,
          amount: invoice.total / 100,
          currency: invoice.currency,
        },
      })
    })

    /**
     * Payment.failed - Update attempt count
     */
    this.$.on.Payment.failed(async (event) => {
      const { invoiceId, attemptCount, exhausted, reason } = event.data as {
        invoiceId: string
        subscriptionId: string
        attemptCount: number
        exhausted: boolean
        reason: string
      }

      const invoice = await this.getInvoice()
      if (!invoice || invoice.id !== invoiceId) return

      console.log(`[Invoice] Payment failed for ${invoiceId} (attempt ${attemptCount})`)

      invoice.attemptCount = attemptCount
      invoice.lastAttemptAt = new Date()
      invoice.updatedAt = new Date()

      if (exhausted) {
        invoice.status = 'uncollectible'

        this.$.send('Invoice.uncollectible', {
          invoiceId,
          subscriptionId: invoice.subscriptionId,
          customerId: invoice.customerId,
          amount: invoice.total,
          attemptCount,
        })
      }

      await this.saveInvoice(invoice)
    })

    console.log('[InvoiceDO] Event handlers registered')
  }

  // ==========================================================================
  // PUBLIC API METHODS
  // ==========================================================================

  /**
   * Get invoice details.
   */
  async getInvoice(): Promise<Invoice | null> {
    return (await this.ctx.storage.get<Invoice>('invoice')) ?? null
  }

  /**
   * Create invoice manually.
   */
  async createInvoice(request: InvoiceGenerateRequest): Promise<Invoice> {
    const plan = PLANS[request.planId]
    if (!plan) {
      throw new InvoiceError(`Invalid plan: ${request.planId}`, 'INVALID_PLAN')
    }

    const lineItems: InvoiceLineItem[] = []

    // Add subscription line item
    if (plan.price > 0) {
      lineItems.push({
        id: `li_${crypto.randomUUID().slice(0, 8)}`,
        description: `${plan.name} plan (${plan.interval}ly)`,
        quantity: 1,
        unitPrice: plan.price,
        amount: plan.price,
        type: 'subscription',
      })
    }

    // Add usage overage line items
    if (request.usageSummary) {
      const { overageCharges } = request.usageSummary

      if (overageCharges.api_calls > 0) {
        const { usage } = request.usageSummary
        lineItems.push({
          id: `li_${crypto.randomUUID().slice(0, 8)}`,
          description: `API calls overage (${usage.api_calls.overage.toLocaleString()} calls)`,
          quantity: Math.ceil(usage.api_calls.overage / 1000),
          unitPrice: plan.metered?.apiCalls ?? 0,
          amount: overageCharges.api_calls,
          type: 'usage',
          metadata: { metric: 'api_calls', overage: usage.api_calls.overage },
        })
      }

      if (overageCharges.storage > 0) {
        const { usage } = request.usageSummary
        lineItems.push({
          id: `li_${crypto.randomUUID().slice(0, 8)}`,
          description: `Storage overage (${usage.storage.overage} GB)`,
          quantity: usage.storage.overage,
          unitPrice: plan.metered?.storage ?? 0,
          amount: overageCharges.storage,
          type: 'usage',
          metadata: { metric: 'storage', overage: usage.storage.overage },
        })
      }
    }

    // Calculate totals
    const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0)
    const taxRate = request.taxRate ?? 0
    const tax = Math.round(subtotal * taxRate)
    const total = subtotal + tax

    // Add tax line item if applicable
    if (tax > 0) {
      lineItems.push({
        id: `li_${crypto.randomUUID().slice(0, 8)}`,
        description: `Tax (${(taxRate * 100).toFixed(1)}%)`,
        quantity: 1,
        unitPrice: tax,
        amount: tax,
        type: 'tax',
      })
    }

    const now = new Date()
    const invoice: Invoice = {
      id: `inv_${crypto.randomUUID().slice(0, 8)}`,
      subscriptionId: request.subscriptionId,
      customerId: request.customerId,
      status: 'open',
      currency: plan.currency,
      lineItems,
      subtotal,
      tax,
      taxRate,
      total,
      periodStart: new Date(request.periodStart),
      periodEnd: new Date(request.periodEnd),
      dueDate: new Date(request.periodEnd), // Due at period end
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    }

    await this.saveInvoice(invoice)

    return invoice
  }

  /**
   * Create proration invoice for plan upgrade.
   */
  async createProrationInvoice(
    subscriptionId: string,
    customerId: string,
    amount: number,
    description: string
  ): Promise<Invoice> {
    const now = new Date()

    const lineItems: InvoiceLineItem[] = [
      {
        id: `li_${crypto.randomUUID().slice(0, 8)}`,
        description,
        quantity: 1,
        unitPrice: amount,
        amount,
        type: 'proration',
      },
    ]

    const invoice: Invoice = {
      id: `inv_${crypto.randomUUID().slice(0, 8)}`,
      subscriptionId,
      customerId,
      status: 'open',
      currency: 'USD',
      lineItems,
      subtotal: amount,
      tax: 0,
      taxRate: 0,
      total: amount,
      periodStart: now,
      periodEnd: now,
      dueDate: now, // Due immediately
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    }

    await this.saveInvoice(invoice)

    return invoice
  }

  /**
   * Add credit to invoice.
   */
  async addCredit(amount: number, description: string): Promise<void> {
    const invoice = await this.getInvoice()
    if (!invoice) {
      throw new InvoiceError('No invoice found', 'NO_INVOICE')
    }

    if (invoice.status !== 'draft' && invoice.status !== 'open') {
      throw new InvoiceError(`Cannot modify ${invoice.status} invoice`, 'INVALID_STATE')
    }

    invoice.lineItems.push({
      id: `li_${crypto.randomUUID().slice(0, 8)}`,
      description,
      quantity: 1,
      unitPrice: -amount,
      amount: -amount,
      type: 'credit',
    })

    // Recalculate totals
    invoice.subtotal = invoice.lineItems
      .filter((li) => li.type !== 'tax')
      .reduce((sum, item) => sum + item.amount, 0)
    invoice.tax = Math.round(invoice.subtotal * invoice.taxRate)
    invoice.total = Math.max(0, invoice.subtotal + invoice.tax)
    invoice.updatedAt = new Date()

    await this.saveInvoice(invoice)
  }

  /**
   * Void invoice.
   */
  async void(reason?: string): Promise<void> {
    const invoice = await this.getInvoice()
    if (!invoice) {
      throw new InvoiceError('No invoice found', 'NO_INVOICE')
    }

    if (invoice.status === 'paid') {
      throw new InvoiceError('Cannot void paid invoice', 'INVALID_STATE')
    }

    invoice.status = 'void'
    invoice.voidedAt = new Date()
    invoice.updatedAt = new Date()
    await this.saveInvoice(invoice)

    this.$.send('Invoice.voided', {
      invoiceId: invoice.id,
      subscriptionId: invoice.subscriptionId,
      customerId: invoice.customerId,
      reason,
    })
  }

  /**
   * Get invoice PDF URL (placeholder).
   */
  async getPdfUrl(): Promise<string> {
    const invoice = await this.getInvoice()
    if (!invoice) {
      throw new InvoiceError('No invoice found', 'NO_INVOICE')
    }

    // In production: generate PDF and return signed URL
    return `https://billing.example.com/invoices/${invoice.id}.pdf`
  }

  // ==========================================================================
  // INTERNAL METHODS
  // ==========================================================================

  /**
   * Save invoice to storage.
   */
  private async saveInvoice(invoice: Invoice): Promise<void> {
    await this.ctx.storage.put('invoice', invoice)
  }

  /**
   * Format period from date.
   */
  private formatPeriod(date: Date): string {
    const d = new Date(date)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
}
