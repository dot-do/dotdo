/**
 * Invoice Generator - TDD RED Phase Stub
 *
 * This is a stub file with type definitions. Implementation to be completed.
 * Tests should fail because the implementation doesn't exist yet.
 *
 * @module db/primitives/payments/invoices
 */

// =============================================================================
// Types
// =============================================================================

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'

export type InvoiceEventType =
  | 'invoice.created'
  | 'invoice.finalized'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'invoice.past_due'
  | 'invoice.voided'
  | 'invoice.sent'
  | 'invoice.updated'

export type LineItemType = 'subscription' | 'one_time' | 'usage'

export type CollectionMethod = 'charge_automatically' | 'send_invoice'

export type DiscountType = 'percentage' | 'fixed'

// =============================================================================
// Interfaces
// =============================================================================

export interface TaxBreakdownItem {
  name: string
  rate: number
  amount: number
}

export interface TaxCalculation {
  taxAmount: number
  taxRate: number
  taxType: string
  jurisdiction: {
    country: string
    state?: string
    city?: string
  }
  breakdown?: TaxBreakdownItem[]
}

export interface InvoiceLineItem {
  id: string
  type: LineItemType
  description: string
  amount: number
  quantity: number
  unitAmount?: number
  productId?: string
  priceId?: string
  meterId?: string
  periodStart?: Date
  periodEnd?: Date
  taxCategory?: string
  usageRecordIds?: string[]
}

export interface InvoiceDiscount {
  type: DiscountType
  value: number
  amount: number
  description?: string
  couponId?: string
}

export interface InvoiceTax {
  amount: number
  rate: number
  type?: string
  breakdown?: TaxBreakdownItem[]
}

export interface PaymentAttempt {
  id: string
  amount: number
  status: 'pending' | 'succeeded' | 'failed'
  error?: string
  paymentMethodId?: string
  timestamp: Date
}

export interface BillingAddress {
  name?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
}

export interface Invoice {
  id: string
  customerId: string
  subscriptionId?: string
  currency: string
  status: InvoiceStatus
  collectionMethod: CollectionMethod
  lineItems: InvoiceLineItem[]
  subtotal: number
  discount?: InvoiceDiscount
  discounts?: InvoiceDiscount[]
  totalDiscount?: number
  tax?: InvoiceTax
  total: number
  amountPaid: number
  amountDue: number
  invoiceNumber?: string
  periodStart?: Date
  periodEnd?: Date
  dueDate?: Date
  finalizedAt?: Date
  paidAt?: Date
  voidedAt?: Date
  sentAt?: Date
  paymentId?: string
  paymentMethodId?: string
  paymentMethod?: string
  paymentReference?: string
  paymentAttempts?: PaymentAttempt[]
  nextPaymentAttempt?: Date
  hostedInvoiceUrl?: string
  taxExempt?: boolean
  taxExemptReason?: string
  reverseChargeApplied?: boolean
  vatNumber?: string
  voidReason?: string
  uncollectibleReason?: string
  creditNoteId?: string
  couponCode?: string
  billingAddress?: BillingAddress
  customerEmail?: string
  locale?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface Subscription {
  id: string
  customerId: string
  priceId: string
  productId: string
  productName?: string
  productDescription?: string
  status: string
  billingCycle: string
  billingType?: string
  quantity: number
  unitAmount: number
  currency: string
  currentPeriodStart: Date
  currentPeriodEnd: Date
  trialEnd?: Date
  meterId?: string
  defaultPaymentMethodId?: string
  metadata?: Record<string, unknown>
}

export interface UsageRecord {
  id: string
  subscriptionId: string
  meterId: string
  quantity: number
  unitAmount: number
  timestamp: Date
}

export interface Coupon {
  id: string
  code: string
  type: DiscountType
  value: number
  currency: string
  maxRedemptions?: number
  timesRedeemed: number
  validFrom?: Date
  validTo?: Date
  applicableProducts?: string[]
  minAmount?: number
}

export interface Discount {
  type: DiscountType
  value: number
  description?: string
}

export interface InvoicePDF {
  buffer: Buffer
  contentType: string
  filename: string
  metadata: {
    companyName?: string
    companyAddress?: string
    billingAddress?: string
    template?: string
    paymentInstructions?: string
    locale?: string
  }
}

export interface InvoiceNumberingConfig {
  prefix?: string
  padding?: number
  format?: 'year-month-sequence' | 'year-sequence' | 'sequence'
  separator?: string
  resetYearly?: boolean
  formatFunction?: (sequence: number, date: Date) => string
}

export interface PaymentIntent {
  success: boolean
  paymentId?: string
  error?: string
}

export interface InvoiceEvent {
  id: string
  type: InvoiceEventType
  data: Record<string, unknown>
  timestamp: Date
  apiVersion: string
}

// =============================================================================
// Option Interfaces
// =============================================================================

export interface GenerateInvoiceFromSubscriptionOptions {
  usageRecords?: UsageRecord[]
  autoCharge?: boolean
}

export interface CreateInvoiceOptions {
  customerId: string
  currency: string
  collectionMethod?: CollectionMethod
  paymentMethodId?: string
  customerEmail?: string
  billingAddress?: BillingAddress
  locale?: string
  taxCalculation?: {
    enabled: boolean
    jurisdiction: { country: string; state?: string; city?: string }
    taxType?: string
    reverseCharge?: boolean
    vatNumber?: string
  }
  taxExempt?: boolean
  taxExemptReason?: string
  allowDiscountStacking?: boolean
  metadata?: Record<string, unknown>
}

export interface AddLineItemOptions {
  type: LineItemType
  description: string
  amount?: number
  unitAmount?: number
  quantity?: number
  productId?: string
  priceId?: string
  meterId?: string
  periodStart?: Date
  periodEnd?: Date
  taxCategory?: string
  usageRecordIds?: string[]
}

export interface AddUsageLineItemOptions {
  meterId: string
  description: string
  usageRecords: UsageRecord[]
}

export interface TieredUsageLineItemOptions {
  meterId: string
  description: string
  quantity: number
  tiers: Array<{ upTo: number | null; unitAmount: number }>
}

export interface UpdateLineItemOptions {
  quantity?: number
  amount?: number
  description?: string
}

export interface ApplyDiscountOptions {
  type: DiscountType
  value: number
  description?: string
}

export interface FinalizeInvoiceOptions {
  autoAdvance?: boolean
}

export interface PayInvoiceOptions {
  paymentId?: string
  paidAt?: Date
  paymentMethod?: string
  reference?: string
}

export interface RecordPaymentOptions {
  amount: number
  paymentId?: string
  paymentMethod?: string
  reference?: string
}

export interface VoidInvoiceOptions {
  reason?: string
  createCreditNote?: boolean
}

export interface MarkUncollectibleOptions {
  reason?: string
}

export interface GeneratePDFOptions {
  template?: string
}

export interface GetPDFUrlOptions {
  expiresIn?: number
}

export interface ListInvoicesOptions {
  status?: InvoiceStatus
  createdAfter?: Date
  createdBefore?: Date
  limit?: number
  startingAfter?: string
}

export interface CompanyConfig {
  name?: string
  address?: string
  taxId?: string
  logo?: string
}

export interface AutoPayRetryConfig {
  maxAttempts: number
  initialDelayHours: number
  backoffMultiplier: number
}

export interface InvoiceGeneratorConfig {
  company?: CompanyConfig
  paymentInstructions?: string
  invoiceNumbering?: InvoiceNumberingConfig
  defaultDueDays?: number
  autoPayRetry?: AutoPayRetryConfig
  onAutoPayAttempt?: (params: {
    invoiceId: string
    amount: number
    paymentMethodId: string
  }) => Promise<PaymentIntent>
  onInvoiceSend?: (params: { invoiceId: string; email: string }) => Promise<{ sent: boolean }>
}

// =============================================================================
// Event Handler Type
// =============================================================================

export type InvoiceEventHandler = (event: InvoiceEvent) => void

// =============================================================================
// Invoice Generator Interface
// =============================================================================

export interface InvoiceGenerator {
  // Configuration
  configure(config: InvoiceGeneratorConfig): void
  registerCoupon(coupon: Coupon): void

  // Invoice CRUD
  createInvoice(options: CreateInvoiceOptions): Promise<Invoice>
  getInvoice(id: string): Promise<Invoice | null>
  deleteInvoice(id: string): Promise<void>

  // Generate from subscription
  generateFromSubscription(
    subscription: Subscription,
    options?: GenerateInvoiceFromSubscriptionOptions
  ): Promise<Invoice>

  // Line items
  addLineItem(invoiceId: string, options: AddLineItemOptions): Promise<Invoice>
  addUsageLineItem(invoiceId: string, options: AddUsageLineItemOptions): Promise<Invoice>
  addTieredUsageLineItem(invoiceId: string, options: TieredUsageLineItemOptions): Promise<Invoice>
  updateLineItem(invoiceId: string, lineItemId: string, options: UpdateLineItemOptions): Promise<Invoice>
  removeLineItem(invoiceId: string, lineItemId: string): Promise<Invoice>

  // Discounts
  applyDiscount(invoiceId: string, options: ApplyDiscountOptions): Promise<Invoice>
  applyCoupon(invoiceId: string, couponCode: string): Promise<Invoice>
  removeDiscount(invoiceId: string): Promise<Invoice>

  // Status transitions
  finalize(invoiceId: string, options?: FinalizeInvoiceOptions): Promise<Invoice>
  markPaid(invoiceId: string, options?: PayInvoiceOptions): Promise<Invoice>
  recordPayment(invoiceId: string, options: RecordPaymentOptions): Promise<Invoice>
  voidInvoice(invoiceId: string, options?: VoidInvoiceOptions): Promise<Invoice>
  markUncollectible(invoiceId: string, options?: MarkUncollectibleOptions): Promise<Invoice>
  markPastDue(invoiceId: string): Promise<Invoice>
  sendInvoice(invoiceId: string): Promise<Invoice>

  // PDF
  generatePDF(invoiceId: string, options?: GeneratePDFOptions): Promise<InvoicePDF>
  getPDFUrl(invoiceId: string, options?: GetPDFUrlOptions): Promise<string>

  // Queries
  listByCustomer(customerId: string, options?: ListInvoicesOptions): Promise<Invoice[]>
  getByInvoiceNumber(invoiceNumber: string): Promise<Invoice | null>
  previewUpcomingInvoice(subscriptionId: string): Promise<Invoice>

  // Events
  onEvent(handler: InvoiceEventHandler): () => void
}

// =============================================================================
// Factory Function - NOT IMPLEMENTED (RED phase)
// =============================================================================

/**
 * Create a new InvoiceGenerator instance
 *
 * NOTE: This is a stub. Implementation does not exist yet.
 * Tests will fail because this throws an error.
 */
export function createInvoiceGenerator(): InvoiceGenerator {
  throw new Error('InvoiceGenerator not implemented - RED phase stub')
}
