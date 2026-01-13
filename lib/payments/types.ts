/**
 * Payment Types
 *
 * Type definitions for invoice generation, payment processing,
 * and billing operations.
 */

// ============================================================================
// Invoice Types
// ============================================================================

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'

export interface Invoice {
  id: string
  number?: string
  customerId: string
  subscriptionId?: string
  status: InvoiceStatus
  currency: string

  // Billing period
  periodStart?: Date
  periodEnd?: Date

  // Line items
  lineItems: InvoiceLineItem[]

  // Amounts (in cents)
  subtotal: number
  discountTotal: number
  tax: number
  total: number
  amountPaid: number
  amountRemaining: number

  // Tax details
  taxRate?: number
  taxJurisdiction?: string
  taxBreakdown?: TaxBreakdownItem[]
  taxNote?: string

  // Discounts
  discounts: Discount[]
  coupon?: Coupon

  // Payments
  payments: PaymentApplication[]

  // Customer details
  customerDetails?: CustomerDetails

  // Timestamps
  createdAt: Date
  openedAt?: Date
  paidAt?: Date
  voidedAt?: Date
  markedUncollectibleAt?: Date

  // Status history
  statusHistory: StatusHistoryEntry[]
}

export interface InvoiceLineItem {
  id: string
  description: string
  amount: number
  quantity: number
  unitPrice?: number
  metadata?: Record<string, unknown>
}

export interface StatusHistoryEntry {
  status: InvoiceStatus
  timestamp: Date
  reason?: string
}

export interface CustomerDetails {
  name: string
  email: string
  address?: string
}

// ============================================================================
// Discount Types
// ============================================================================

export interface Discount {
  type: 'percent' | 'fixed'
  value: number
  description: string
}

export interface Coupon {
  id: string
  code: string
  type: 'percent' | 'fixed'
  value: number
  maxRedemptions?: number
  timesRedeemed: number
  validUntil?: Date
}

// ============================================================================
// Tax Types
// ============================================================================

export interface TaxConfig {
  enabled: boolean
  rate?: number
  rates?: TaxRate[]
  inclusive: boolean
  jurisdiction: string
  reverseCharge?: boolean
}

export interface TaxRate {
  name: string
  rate: number
}

export interface TaxBreakdownItem {
  name: string
  amount: number
}

// ============================================================================
// Payment Types
// ============================================================================

export type PaymentMethod = 'card' | 'ach_debit' | 'bank_transfer' | 'cash' | 'check' | 'other'

export interface PaymentApplication {
  id: string
  amount: number
  method: PaymentMethod
  processedAt: Date
  metadata?: Record<string, unknown>
}

// ============================================================================
// Render Types
// ============================================================================

export type InvoiceRenderFormat = 'html' | 'pdf' | 'json'

export interface InvoiceRenderOptions {
  format: InvoiceRenderFormat
  locale?: string
  template?: string
  branding?: BrandingOptions
  paymentInstructions?: string
}

export interface BrandingOptions {
  companyName: string
  logo?: string
  primaryColor?: string
  address?: string
}
