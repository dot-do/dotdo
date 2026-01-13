/**
 * Invoice Generation Module
 *
 * This module provides invoice generation, line item management,
 * discount/coupon application, tax calculation, payment application,
 * and invoice rendering.
 *
 * NOTE: This is a stub file for TDD RED phase. All functions throw
 * "not implemented" errors and should be implemented in the GREEN phase.
 */

import type {
  Invoice,
  InvoiceLineItem,
  InvoiceStatus,
  Discount,
  TaxConfig,
  PaymentApplication,
  InvoiceRenderOptions,
  Coupon,
} from './types'

// ============================================================================
// Subscription Type (for invoice generation)
// ============================================================================

export interface Subscription {
  id: string
  customerId: string
  planId: string
  planName: string
  amount: number
  currency: string
  interval: 'month' | 'year' | 'week' | 'day'
  currentPeriodStart: Date
  currentPeriodEnd: Date
  status: 'active' | 'canceled' | 'past_due' | 'trialing'
}

// Re-export Coupon type
export type { Coupon }

// ============================================================================
// Invoice Generator (for numbering)
// ============================================================================

export interface InvoiceGenerator {
  lastNumber: number
  prefix: string
  padding?: number
  separator?: string
  resetOnYearChange?: boolean
  lastYear?: number
}

// ============================================================================
// Invoice Creation
// ============================================================================

/**
 * Create a new invoice
 * @throws Not implemented
 */
export function createInvoice(_customerId: string): Invoice {
  throw new Error('Not implemented: createInvoice')
}

/**
 * Generate an invoice from a subscription
 * @throws Not implemented
 */
export function generateInvoiceFromSubscription(_subscription: Subscription): Invoice {
  throw new Error('Not implemented: generateInvoiceFromSubscription')
}

// ============================================================================
// Line Items
// ============================================================================

/**
 * Add a line item to an invoice
 * @throws Not implemented
 */
export function addLineItem(_invoice: Invoice, _lineItem: InvoiceLineItem): Invoice {
  throw new Error('Not implemented: addLineItem')
}

// ============================================================================
// Discounts and Coupons
// ============================================================================

/**
 * Apply a discount to an invoice
 * @throws Not implemented
 */
export function applyDiscount(_invoice: Invoice, _discount: Discount): Invoice {
  throw new Error('Not implemented: applyDiscount')
}

/**
 * Apply a coupon to an invoice
 * @throws Not implemented
 */
export function applyCoupon(_invoice: Invoice, _coupon: Coupon): Invoice {
  throw new Error('Not implemented: applyCoupon')
}

// ============================================================================
// Tax Calculation
// ============================================================================

/**
 * Calculate and apply tax to an invoice
 * @throws Not implemented
 */
export function calculateTax(_invoice: Invoice, _taxConfig: TaxConfig): Invoice {
  throw new Error('Not implemented: calculateTax')
}

// ============================================================================
// Invoice Numbering
// ============================================================================

/**
 * Get the next invoice number
 * @throws Not implemented
 */
export function getNextInvoiceNumber(_generator: InvoiceGenerator): string {
  throw new Error('Not implemented: getNextInvoiceNumber')
}

// ============================================================================
// Status Transitions
// ============================================================================

/**
 * Transition an invoice to a new status
 * @throws Not implemented
 */
export function transitionStatus(_invoice: Invoice, _newStatus: InvoiceStatus): Invoice {
  throw new Error('Not implemented: transitionStatus')
}

// ============================================================================
// Payment Application
// ============================================================================

/**
 * Apply a payment to an invoice
 * @throws Not implemented
 */
export function applyPayment(_invoice: Invoice, _payment: PaymentApplication): Invoice {
  throw new Error('Not implemented: applyPayment')
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render an invoice to HTML, PDF, or JSON
 * @throws Not implemented
 */
export async function renderInvoice(
  _invoice: Invoice,
  _options: InvoiceRenderOptions
): Promise<string | Uint8Array> {
  throw new Error('Not implemented: renderInvoice')
}
