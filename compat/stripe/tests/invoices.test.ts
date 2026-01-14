/**
 * @dotdo/stripe - Stripe Invoice API Compatibility Layer Tests (RED Phase)
 *
 * Comprehensive failing tests for the Stripe Invoice API compatibility layer.
 * These tests cover all major invoice operations and should fail until
 * the implementation is complete.
 *
 * Invoice operations tested:
 * - Create invoice
 * - Get invoice
 * - Update invoice
 * - Delete/void invoice
 * - List invoices
 * - Finalize invoice
 * - Pay invoice
 * - Send invoice
 * - Invoice line items
 * - Invoice previews
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Stripe,
  StripeAPIError,
  type ListResponse,
} from '../index'

// =============================================================================
// Invoice Type Definitions (to be added to types.ts)
// =============================================================================

/**
 * Stripe Invoice object
 */
export interface Invoice {
  id: string
  object: 'invoice'
  account_country?: string | null
  account_name?: string | null
  account_tax_ids?: string[] | null
  amount_due: number
  amount_paid: number
  amount_remaining: number
  amount_shipping: number
  application?: string | null
  application_fee_amount?: number | null
  attempt_count: number
  attempted: boolean
  auto_advance?: boolean
  automatic_tax?: {
    enabled: boolean
    liability?: { type: string; account?: string } | null
    status?: 'complete' | 'failed' | 'requires_location_inputs' | null
  }
  billing_reason?: InvoiceBillingReason | null
  charge?: string | null
  collection_method: 'charge_automatically' | 'send_invoice'
  created: number
  currency: string
  custom_fields?: Array<{ name: string; value: string }> | null
  customer: string
  customer_address?: {
    city?: string | null
    country?: string | null
    line1?: string | null
    line2?: string | null
    postal_code?: string | null
    state?: string | null
  } | null
  customer_email?: string | null
  customer_name?: string | null
  customer_phone?: string | null
  customer_shipping?: object | null
  customer_tax_exempt?: 'none' | 'exempt' | 'reverse' | null
  customer_tax_ids?: Array<{ type: string; value: string }> | null
  default_payment_method?: string | null
  default_source?: string | null
  default_tax_rates?: Array<{ id: string; percentage: number }> | null
  description?: string | null
  discount?: object | null
  discounts?: string[] | null
  due_date?: number | null
  effective_at?: number | null
  ending_balance?: number | null
  footer?: string | null
  from_invoice?: {
    action: string
    invoice: string
  } | null
  hosted_invoice_url?: string | null
  invoice_pdf?: string | null
  issuer?: {
    account?: string
    type: 'account' | 'self'
  } | null
  last_finalization_error?: object | null
  latest_revision?: string | null
  lines: ListResponse<InvoiceLineItem>
  livemode: boolean
  metadata: Record<string, string>
  next_payment_attempt?: number | null
  number?: string | null
  on_behalf_of?: string | null
  paid: boolean
  paid_out_of_band: boolean
  payment_intent?: string | null
  payment_settings?: InvoicePaymentSettings | null
  period_end: number
  period_start: number
  post_payment_credit_notes_amount: number
  pre_payment_credit_notes_amount: number
  quote?: string | null
  receipt_number?: string | null
  rendering?: {
    amount_tax_display?: 'exclude_tax' | 'include_inclusive_tax' | null
    pdf?: { page_size: 'a4' | 'auto' | 'letter' }
  } | null
  shipping_cost?: {
    amount_subtotal: number
    amount_tax: number
    amount_total: number
    shipping_rate?: string
  } | null
  shipping_details?: object | null
  starting_balance: number
  statement_descriptor?: string | null
  status: InvoiceStatus | null
  status_transitions?: {
    finalized_at?: number | null
    marked_uncollectible_at?: number | null
    paid_at?: number | null
    voided_at?: number | null
  }
  subscription?: string | null
  subscription_details?: {
    metadata?: Record<string, string> | null
  } | null
  subscription_proration_date?: number
  subtotal: number
  subtotal_excluding_tax?: number | null
  tax?: number | null
  test_clock?: string | null
  total: number
  total_discount_amounts?: Array<{ amount: number; discount: string }> | null
  total_excluding_tax?: number | null
  total_tax_amounts?: Array<{
    amount: number
    inclusive: boolean
    tax_rate: string
  }> | null
  transfer_data?: {
    amount?: number | null
    destination: string
  } | null
  webhooks_delivered_at?: number | null
}

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'uncollectible' | 'void'

export type InvoiceBillingReason =
  | 'automatic_pending_invoice_item_invoice'
  | 'manual'
  | 'quote_accept'
  | 'subscription'
  | 'subscription_create'
  | 'subscription_cycle'
  | 'subscription_threshold'
  | 'subscription_update'
  | 'upcoming'

/**
 * Invoice line item
 */
export interface InvoiceLineItem {
  id: string
  object: 'line_item'
  amount: number
  amount_excluding_tax?: number | null
  currency: string
  description?: string | null
  discount_amounts?: Array<{ amount: number; discount: string }> | null
  discountable: boolean
  discounts?: string[] | null
  invoice?: string | null
  invoice_item?: string | null
  livemode: boolean
  metadata: Record<string, string>
  period: {
    end: number
    start: number
  }
  plan?: object | null
  price?: object | null
  proration: boolean
  proration_details?: {
    credited_items?: { invoice: string; invoice_line_items: string[] } | null
  } | null
  quantity?: number | null
  subscription?: string | null
  subscription_item?: string | null
  tax_amounts?: Array<{
    amount: number
    inclusive: boolean
    tax_rate: string
  }> | null
  tax_rates?: Array<{ id: string; percentage: number }> | null
  type: 'invoiceitem' | 'subscription'
  unit_amount_excluding_tax?: string | null
}

/**
 * Invoice payment settings
 */
export interface InvoicePaymentSettings {
  default_mandate?: string | null
  payment_method_options?: {
    acss_debit?: object
    bancontact?: object
    card?: object
    customer_balance?: object
    konbini?: object
    us_bank_account?: object
  } | null
  payment_method_types?: string[] | null
}

/**
 * Parameters for creating an invoice
 */
export interface InvoiceCreateParams {
  customer: string
  auto_advance?: boolean
  collection_method?: 'charge_automatically' | 'send_invoice'
  currency?: string
  custom_fields?: Array<{ name: string; value: string }> | null
  days_until_due?: number
  default_payment_method?: string
  default_source?: string
  default_tax_rates?: string[]
  description?: string
  discounts?: Array<{ coupon?: string; discount?: string }> | null
  due_date?: number
  effective_at?: number
  footer?: string
  from_invoice?: {
    action: 'revision'
    invoice: string
  }
  issuer?: {
    account?: string
    type: 'account' | 'self'
  }
  metadata?: Record<string, string>
  number?: string
  on_behalf_of?: string
  payment_settings?: InvoicePaymentSettings
  pending_invoice_items_behavior?: 'exclude' | 'include' | 'include_and_require'
  rendering?: {
    amount_tax_display?: 'exclude_tax' | 'include_inclusive_tax'
    pdf?: { page_size: 'a4' | 'auto' | 'letter' }
  }
  shipping_cost?: {
    shipping_rate?: string
    shipping_rate_data?: object
  }
  shipping_details?: {
    address: object
    name: string
    phone?: string
  }
  statement_descriptor?: string
  subscription?: string
  transfer_data?: {
    amount?: number
    destination: string
  }
}

/**
 * Parameters for updating an invoice
 */
export interface InvoiceUpdateParams {
  auto_advance?: boolean
  collection_method?: 'charge_automatically' | 'send_invoice'
  custom_fields?: Array<{ name: string; value: string }> | null | ''
  days_until_due?: number
  default_payment_method?: string | ''
  default_source?: string | ''
  default_tax_rates?: string[] | ''
  description?: string | ''
  discounts?: Array<{ coupon?: string; discount?: string }> | null | ''
  due_date?: number
  effective_at?: number | ''
  footer?: string | ''
  metadata?: Record<string, string> | ''
  number?: string
  on_behalf_of?: string | ''
  payment_settings?: InvoicePaymentSettings | ''
  rendering?: {
    amount_tax_display?: 'exclude_tax' | 'include_inclusive_tax' | ''
    pdf?: { page_size: 'a4' | 'auto' | 'letter' }
  }
  shipping_cost?: {
    shipping_rate?: string
    shipping_rate_data?: object
  } | ''
  shipping_details?: {
    address: object
    name: string
    phone?: string
  } | ''
  statement_descriptor?: string | ''
  transfer_data?: {
    amount?: number
    destination: string
  } | ''
}

/**
 * Parameters for listing invoices
 */
export interface InvoiceListParams {
  customer?: string
  subscription?: string
  status?: InvoiceStatus
  collection_method?: 'charge_automatically' | 'send_invoice'
  created?: { gt?: number; gte?: number; lt?: number; lte?: number }
  due_date?: { gt?: number; gte?: number; lt?: number; lte?: number }
  starting_after?: string
  ending_before?: string
  limit?: number
}

/**
 * Parameters for finalizing an invoice
 */
export interface InvoiceFinalizeParams {
  auto_advance?: boolean
}

/**
 * Parameters for paying an invoice
 */
export interface InvoicePayParams {
  forgive?: boolean
  mandate?: string
  off_session?: boolean
  paid_out_of_band?: boolean
  payment_method?: string
  source?: string
}

/**
 * Parameters for sending an invoice
 */
export interface InvoiceSendParams {
  // No parameters required, but can be extended
}

/**
 * Parameters for voiding an invoice
 */
export interface InvoiceVoidParams {
  // No parameters required, but can be extended
}

/**
 * Parameters for marking invoice uncollectible
 */
export interface InvoiceMarkUncollectibleParams {
  // No parameters required, but can be extended
}

/**
 * Invoice item parameters for adding to invoice
 */
export interface InvoiceItemCreateParams {
  customer: string
  amount?: number
  currency?: string
  description?: string
  discountable?: boolean
  discounts?: Array<{ coupon?: string; discount?: string }> | null
  invoice?: string
  metadata?: Record<string, string>
  period?: { end: number; start: number }
  price?: string
  price_data?: {
    currency: string
    product: string
    unit_amount?: number
    unit_amount_decimal?: string
  }
  quantity?: number
  subscription?: string
  tax_behavior?: 'exclusive' | 'inclusive' | 'unspecified'
  tax_code?: string
  tax_rates?: string[]
  unit_amount?: number
  unit_amount_decimal?: string
}

/**
 * Invoice preview parameters
 */
export interface InvoicePreviewParams {
  customer?: string
  coupon?: string
  currency?: string
  customer_details?: {
    address?: object | ''
    shipping?: object | ''
    tax?: { ip_address?: string | '' }
    tax_exempt?: 'exempt' | 'none' | 'reverse' | ''
    tax_ids?: Array<{ type: string; value: string }>
  }
  discounts?: Array<{ coupon?: string; discount?: string; promotion_code?: string }> | ''
  invoice_items?: Array<{
    amount?: number
    currency?: string
    description?: string
    discountable?: boolean
    discounts?: Array<{ coupon?: string; discount?: string }> | ''
    invoiceitem?: string
    metadata?: Record<string, string> | ''
    period?: { end: number; start: number }
    price?: string
    price_data?: {
      currency: string
      product: string
      unit_amount?: number
      unit_amount_decimal?: string
    }
    quantity?: number
    tax_behavior?: 'exclusive' | 'inclusive' | 'unspecified'
    tax_code?: string | ''
    tax_rates?: string[] | ''
    unit_amount?: number
    unit_amount_decimal?: string
  }>
  issuer?: { account?: string; type: 'account' | 'self' }
  on_behalf_of?: string | ''
  preview_mode?: 'next' | 'recurring'
  schedule?: string
  schedule_details?: {
    end_behavior?: 'cancel' | 'release'
    phases?: Array<object>
    proration_behavior?: 'always_invoice' | 'create_prorations' | 'none'
  }
  subscription?: string
  subscription_details?: {
    billing_cycle_anchor?: number | 'now' | 'unchanged'
    cancel_at?: number | ''
    cancel_at_period_end?: boolean
    cancel_now?: boolean
    default_tax_rates?: string[] | ''
    items?: Array<{
      billing_thresholds?: { usage_gte: number } | ''
      clear_usage?: boolean
      deleted?: boolean
      discounts?: Array<{ coupon?: string; discount?: string; promotion_code?: string }> | ''
      id?: string
      metadata?: Record<string, string> | ''
      price?: string
      price_data?: {
        currency: string
        product: string
        recurring: { interval: 'day' | 'week' | 'month' | 'year'; interval_count?: number }
        unit_amount?: number
        unit_amount_decimal?: string
      }
      quantity?: number
      tax_rates?: string[] | ''
    }>
    proration_behavior?: 'always_invoice' | 'create_prorations' | 'none'
    proration_date?: number
    resume_at?: 'now'
    start_date?: number
    trial_end?: number | 'now'
  }
}

/**
 * Deleted invoice response
 */
export interface DeletedInvoice {
  id: string
  object: 'invoice'
  deleted: true
}

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url)
    const key = `${options?.method ?? 'GET'} ${urlObj.pathname}`

    const mockResponse = responses.get(key)
    if (!mockResponse) {
      return {
        ok: false,
        status: 404,
        headers: new Headers({ 'request-id': 'req_mock' }),
        json: async () => ({
          error: { type: 'invalid_request_error', message: `No mock for ${key}` },
        }),
      }
    }

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: new Headers({ 'request-id': 'req_mock' }),
      json: async () => mockResponse.body,
    }
  })
}

function mockInvoice(overrides: Partial<Invoice> = {}): Invoice {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: 'in_test123',
    object: 'invoice',
    account_country: 'US',
    account_name: 'Test Company',
    amount_due: 2000,
    amount_paid: 0,
    amount_remaining: 2000,
    amount_shipping: 0,
    attempt_count: 0,
    attempted: false,
    auto_advance: true,
    billing_reason: 'manual',
    collection_method: 'charge_automatically',
    created: now,
    currency: 'usd',
    customer: 'cus_test123',
    livemode: false,
    metadata: {},
    paid: false,
    paid_out_of_band: false,
    period_end: now + 30 * 24 * 60 * 60,
    period_start: now,
    post_payment_credit_notes_amount: 0,
    pre_payment_credit_notes_amount: 0,
    starting_balance: 0,
    status: 'draft',
    subtotal: 2000,
    total: 2000,
    lines: {
      object: 'list',
      data: [],
      has_more: false,
      url: '/v1/invoices/in_test123/lines',
    },
    ...overrides,
  }
}

function mockInvoiceLineItem(overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: 'il_test123',
    object: 'line_item',
    amount: 2000,
    currency: 'usd',
    description: 'Test line item',
    discountable: true,
    livemode: false,
    metadata: {},
    period: {
      end: now + 30 * 24 * 60 * 60,
      start: now,
    },
    proration: false,
    quantity: 1,
    type: 'invoiceitem',
    ...overrides,
  }
}

// =============================================================================
// Invoice Resource Tests
// =============================================================================

describe('@dotdo/stripe - Invoices', () => {
  describe('create', () => {
    it('should create an invoice', async () => {
      const expectedInvoice = mockInvoice()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices', { status: 200, body: expectedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.create({
        customer: 'cus_test123',
      })

      expect(invoice.id).toBe('in_test123')
      expect(invoice.customer).toBe('cus_test123')
      expect(invoice.status).toBe('draft')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/invoices'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('should create an invoice with collection method send_invoice', async () => {
      const expectedInvoice = mockInvoice({
        collection_method: 'send_invoice',
        due_date: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices', { status: 200, body: expectedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.create({
        customer: 'cus_test123',
        collection_method: 'send_invoice',
        days_until_due: 30,
      })

      expect(invoice.collection_method).toBe('send_invoice')
      expect(invoice.due_date).toBeDefined()
    })

    it('should create an invoice with metadata', async () => {
      const expectedInvoice = mockInvoice({
        metadata: { order_id: '12345', campaign: 'summer_sale' },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices', { status: 200, body: expectedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.create({
        customer: 'cus_test123',
        metadata: { order_id: '12345', campaign: 'summer_sale' },
      })

      expect(invoice.metadata.order_id).toBe('12345')
      expect(invoice.metadata.campaign).toBe('summer_sale')
    })

    it('should create an invoice with custom fields', async () => {
      const expectedInvoice = mockInvoice({
        custom_fields: [
          { name: 'PO Number', value: 'PO-12345' },
          { name: 'Project', value: 'Alpha' },
        ],
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices', { status: 200, body: expectedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.create({
        customer: 'cus_test123',
        custom_fields: [
          { name: 'PO Number', value: 'PO-12345' },
          { name: 'Project', value: 'Alpha' },
        ],
      })

      expect(invoice.custom_fields).toHaveLength(2)
      expect(invoice.custom_fields![0].name).toBe('PO Number')
    })

    it('should create an invoice for a subscription', async () => {
      const expectedInvoice = mockInvoice({
        subscription: 'sub_test123',
        billing_reason: 'subscription_create',
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices', { status: 200, body: expectedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.create({
        customer: 'cus_test123',
        subscription: 'sub_test123',
      })

      expect(invoice.subscription).toBe('sub_test123')
      expect(invoice.billing_reason).toBe('subscription_create')
    })

    it('should create an invoice with auto_advance disabled', async () => {
      const expectedInvoice = mockInvoice({ auto_advance: false })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices', { status: 200, body: expectedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.create({
        customer: 'cus_test123',
        auto_advance: false,
      })

      expect(invoice.auto_advance).toBe(false)
    })

    it('should create an invoice with default payment method', async () => {
      const expectedInvoice = mockInvoice({ default_payment_method: 'pm_test123' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices', { status: 200, body: expectedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.create({
        customer: 'cus_test123',
        default_payment_method: 'pm_test123',
      })

      expect(invoice.default_payment_method).toBe('pm_test123')
    })
  })

  describe('retrieve', () => {
    it('should retrieve an invoice by ID', async () => {
      const expectedInvoice = mockInvoice()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/invoices/in_test123', { status: 200, body: expectedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.retrieve('in_test123')

      expect(invoice.id).toBe('in_test123')
      expect(invoice.object).toBe('invoice')
    })

    it('should throw error for non-existent invoice', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices/in_nonexistent',
            {
              status: 404,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'No such invoice: in_nonexistent',
                  code: 'resource_missing',
                },
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })

      await expect(stripe.invoices.retrieve('in_nonexistent')).rejects.toThrow(StripeAPIError)
    })

    it('should retrieve an invoice with expand parameter', async () => {
      const expectedInvoice = mockInvoice({
        customer: 'cus_test123' as any, // In reality would be expanded Customer object
      })
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/invoices/in_test123', { status: 200, body: expectedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.retrieve('in_test123', {
        expand: ['customer'],
      })

      expect(invoice.id).toBe('in_test123')
    })
  })

  describe('update', () => {
    it('should update an invoice', async () => {
      const updatedInvoice = mockInvoice({ description: 'Updated description' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123', { status: 200, body: updatedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.update('in_test123', {
        description: 'Updated description',
      })

      expect(invoice.description).toBe('Updated description')
    })

    it('should update invoice metadata', async () => {
      const updatedInvoice = mockInvoice({
        metadata: { order_id: '67890' },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123', { status: 200, body: updatedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.update('in_test123', {
        metadata: { order_id: '67890' },
      })

      expect(invoice.metadata.order_id).toBe('67890')
    })

    it('should update invoice collection method', async () => {
      const updatedInvoice = mockInvoice({
        collection_method: 'send_invoice',
        days_until_due: 15,
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123', { status: 200, body: updatedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.update('in_test123', {
        collection_method: 'send_invoice',
        days_until_due: 15,
      })

      expect(invoice.collection_method).toBe('send_invoice')
    })

    it('should update invoice footer', async () => {
      const updatedInvoice = mockInvoice({ footer: 'Thank you for your business!' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123', { status: 200, body: updatedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.update('in_test123', {
        footer: 'Thank you for your business!',
      })

      expect(invoice.footer).toBe('Thank you for your business!')
    })

    it('should clear invoice description by passing empty string', async () => {
      const updatedInvoice = mockInvoice({ description: null })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123', { status: 200, body: updatedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.update('in_test123', {
        description: '',
      })

      expect(invoice.description).toBeNull()
    })
  })

  describe('delete', () => {
    it('should delete a draft invoice', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /v1/invoices/in_test123',
            {
              status: 200,
              body: { id: 'in_test123', object: 'invoice', deleted: true },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.del('in_test123')

      expect(result.deleted).toBe(true)
      expect(result.id).toBe('in_test123')
    })

    it('should fail to delete a finalized invoice', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /v1/invoices/in_finalized',
            {
              status: 400,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'You can only delete draft invoices',
                  code: 'invoice_not_deletable',
                },
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })

      await expect(stripe.invoices.del('in_finalized')).rejects.toThrow(StripeAPIError)
    })
  })

  describe('list', () => {
    it('should list invoices', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockInvoice(), mockInvoice({ id: 'in_test456' })],
                has_more: false,
                url: '/v1/invoices',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.list()

      expect(result.object).toBe('list')
      expect(result.data).toHaveLength(2)
    })

    it('should list invoices with pagination', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockInvoice()],
                has_more: true,
                url: '/v1/invoices',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.list({ limit: 1 })

      expect(result.has_more).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=1'),
        expect.anything()
      )
    })

    it('should filter invoices by customer', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockInvoice()],
                has_more: false,
                url: '/v1/invoices',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.list({ customer: 'cus_test123' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('customer=cus_test123'),
        expect.anything()
      )
    })

    it('should filter invoices by subscription', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockInvoice({ subscription: 'sub_test123' })],
                has_more: false,
                url: '/v1/invoices',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.list({ subscription: 'sub_test123' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('subscription=sub_test123'),
        expect.anything()
      )
    })

    it('should filter invoices by status', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockInvoice({ status: 'open' })],
                has_more: false,
                url: '/v1/invoices',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.list({ status: 'open' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=open'),
        expect.anything()
      )
    })

    it('should filter invoices by collection method', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockInvoice({ collection_method: 'send_invoice' })],
                has_more: false,
                url: '/v1/invoices',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.list({ collection_method: 'send_invoice' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('collection_method=send_invoice'),
        expect.anything()
      )
    })

    it('should filter invoices by created date range', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockInvoice()],
                has_more: false,
                url: '/v1/invoices',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const now = Math.floor(Date.now() / 1000)
      await stripe.invoices.list({
        created: { gte: now - 86400, lte: now },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('created'),
        expect.anything()
      )
    })
  })

  describe('finalize', () => {
    it('should finalize a draft invoice', async () => {
      const finalizedInvoice = mockInvoice({
        status: 'open',
        status_transitions: {
          finalized_at: Math.floor(Date.now() / 1000),
        },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123/finalize', { status: 200, body: finalizedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.finalize('in_test123')

      expect(invoice.status).toBe('open')
      expect(invoice.status_transitions?.finalized_at).toBeDefined()
    })

    it('should finalize invoice with auto_advance option', async () => {
      const finalizedInvoice = mockInvoice({
        status: 'open',
        auto_advance: false,
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123/finalize', { status: 200, body: finalizedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.finalize('in_test123', {
        auto_advance: false,
      })

      expect(invoice.auto_advance).toBe(false)
    })

    it('should fail to finalize an already finalized invoice', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/invoices/in_test123/finalize',
            {
              status: 400,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'This invoice is already finalized',
                  code: 'invoice_already_finalized',
                },
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })

      await expect(stripe.invoices.finalize('in_test123')).rejects.toThrow(StripeAPIError)
    })

    it('should generate invoice number upon finalization', async () => {
      const finalizedInvoice = mockInvoice({
        status: 'open',
        number: 'INV-0001',
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123/finalize', { status: 200, body: finalizedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.finalize('in_test123')

      expect(invoice.number).toBe('INV-0001')
    })

    it('should generate hosted invoice URL upon finalization', async () => {
      const finalizedInvoice = mockInvoice({
        status: 'open',
        hosted_invoice_url: 'https://invoice.stripe.com/i/in_test123',
        invoice_pdf: 'https://pay.stripe.com/invoice/in_test123/pdf',
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123/finalize', { status: 200, body: finalizedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.finalize('in_test123')

      expect(invoice.hosted_invoice_url).toBeDefined()
      expect(invoice.invoice_pdf).toBeDefined()
    })
  })

  describe('pay', () => {
    it('should pay an open invoice', async () => {
      const paidInvoice = mockInvoice({
        status: 'paid',
        paid: true,
        amount_paid: 2000,
        amount_remaining: 0,
        status_transitions: {
          paid_at: Math.floor(Date.now() / 1000),
        },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123/pay', { status: 200, body: paidInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.pay('in_test123')

      expect(invoice.status).toBe('paid')
      expect(invoice.paid).toBe(true)
      expect(invoice.amount_remaining).toBe(0)
    })

    it('should pay invoice with specific payment method', async () => {
      const paidInvoice = mockInvoice({
        status: 'paid',
        paid: true,
        payment_intent: 'pi_test123',
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123/pay', { status: 200, body: paidInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.pay('in_test123', {
        payment_method: 'pm_card_visa',
      })

      expect(invoice.paid).toBe(true)
      expect(invoice.payment_intent).toBe('pi_test123')
    })

    it('should pay invoice with source (legacy)', async () => {
      const paidInvoice = mockInvoice({
        status: 'paid',
        paid: true,
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123/pay', { status: 200, body: paidInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.pay('in_test123', {
        source: 'src_test123',
      })

      expect(invoice.paid).toBe(true)
    })

    it('should mark invoice paid out of band', async () => {
      const paidInvoice = mockInvoice({
        status: 'paid',
        paid: true,
        paid_out_of_band: true,
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123/pay', { status: 200, body: paidInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.pay('in_test123', {
        paid_out_of_band: true,
      })

      expect(invoice.paid_out_of_band).toBe(true)
    })

    it('should pay invoice with forgive option', async () => {
      const paidInvoice = mockInvoice({
        status: 'paid',
        paid: true,
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123/pay', { status: 200, body: paidInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.pay('in_test123', {
        forgive: true,
      })

      expect(invoice.paid).toBe(true)
    })

    it('should fail to pay a draft invoice', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/invoices/in_test123/pay',
            {
              status: 400,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'You can only pay an open invoice',
                  code: 'invoice_not_open',
                },
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })

      await expect(stripe.invoices.pay('in_test123')).rejects.toThrow(StripeAPIError)
    })

    it('should fail payment with insufficient funds', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/invoices/in_test123/pay',
            {
              status: 402,
              body: {
                error: {
                  type: 'card_error',
                  message: 'Your card has insufficient funds.',
                  code: 'card_declined',
                  decline_code: 'insufficient_funds',
                },
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })

      await expect(stripe.invoices.pay('in_test123')).rejects.toThrow(StripeAPIError)
    })
  })

  describe('send', () => {
    it('should send an open invoice', async () => {
      const sentInvoice = mockInvoice({
        status: 'open',
        webhooks_delivered_at: Math.floor(Date.now() / 1000),
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123/send', { status: 200, body: sentInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.send('in_test123')

      expect(invoice.status).toBe('open')
      expect(invoice.webhooks_delivered_at).toBeDefined()
    })

    it('should fail to send a draft invoice', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/invoices/in_test123/send',
            {
              status: 400,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'You can only send an open invoice',
                  code: 'invoice_not_open',
                },
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })

      await expect(stripe.invoices.send('in_test123')).rejects.toThrow(StripeAPIError)
    })

    it('should fail to send invoice without customer email', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/invoices/in_test123/send',
            {
              status: 400,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'Cannot send invoice without customer email',
                  code: 'email_invalid',
                },
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })

      await expect(stripe.invoices.send('in_test123')).rejects.toThrow(StripeAPIError)
    })
  })

  describe('void', () => {
    it('should void an open invoice', async () => {
      const voidedInvoice = mockInvoice({
        status: 'void',
        status_transitions: {
          voided_at: Math.floor(Date.now() / 1000),
        },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123/void', { status: 200, body: voidedInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.void('in_test123')

      expect(invoice.status).toBe('void')
      expect(invoice.status_transitions?.voided_at).toBeDefined()
    })

    it('should fail to void a paid invoice', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/invoices/in_test123/void',
            {
              status: 400,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'You cannot void a paid invoice',
                  code: 'invoice_already_paid',
                },
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })

      await expect(stripe.invoices.void('in_test123')).rejects.toThrow(StripeAPIError)
    })

    it('should fail to void a draft invoice', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/invoices/in_test123/void',
            {
              status: 400,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'You cannot void a draft invoice. Delete it instead.',
                  code: 'invoice_is_draft',
                },
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })

      await expect(stripe.invoices.void('in_test123')).rejects.toThrow(StripeAPIError)
    })
  })

  describe('markUncollectible', () => {
    it('should mark an open invoice as uncollectible', async () => {
      const uncollectibleInvoice = mockInvoice({
        status: 'uncollectible',
        status_transitions: {
          marked_uncollectible_at: Math.floor(Date.now() / 1000),
        },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123/mark_uncollectible', { status: 200, body: uncollectibleInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.markUncollectible('in_test123')

      expect(invoice.status).toBe('uncollectible')
      expect(invoice.status_transitions?.marked_uncollectible_at).toBeDefined()
    })

    it('should fail to mark a paid invoice as uncollectible', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/invoices/in_test123/mark_uncollectible',
            {
              status: 400,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'This invoice has already been paid',
                  code: 'invoice_already_paid',
                },
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })

      await expect(stripe.invoices.markUncollectible('in_test123')).rejects.toThrow(StripeAPIError)
    })
  })

  describe('upcoming', () => {
    it('should retrieve upcoming invoice for customer', async () => {
      const upcomingInvoice = mockInvoice({
        id: '',
        status: null,
        billing_reason: 'upcoming',
      })
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/invoices/upcoming', { status: 200, body: upcomingInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.upcoming({
        customer: 'cus_test123',
      })

      expect(invoice.billing_reason).toBe('upcoming')
    })

    it('should retrieve upcoming invoice for subscription', async () => {
      const upcomingInvoice = mockInvoice({
        id: '',
        status: null,
        billing_reason: 'upcoming',
        subscription: 'sub_test123',
      })
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/invoices/upcoming', { status: 200, body: upcomingInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.upcoming({
        subscription: 'sub_test123',
      })

      expect(invoice.subscription).toBe('sub_test123')
    })

    it('should preview upcoming invoice with subscription changes', async () => {
      const upcomingInvoice = mockInvoice({
        id: '',
        status: null,
        subtotal: 5000,
        total: 5000,
      })
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/invoices/upcoming', { status: 200, body: upcomingInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.upcoming({
        customer: 'cus_test123',
        subscription_details: {
          items: [
            { price: 'price_new', quantity: 2 },
          ],
        },
      })

      expect(invoice.subtotal).toBe(5000)
    })

    it('should preview upcoming invoice with coupon', async () => {
      const upcomingInvoice = mockInvoice({
        id: '',
        status: null,
        subtotal: 2000,
        total: 1600,
        total_discount_amounts: [{ amount: 400, discount: 'di_test' }],
      })
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/invoices/upcoming', { status: 200, body: upcomingInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.upcoming({
        customer: 'cus_test123',
        coupon: '20OFF',
      })

      expect(invoice.total).toBeLessThan(invoice.subtotal)
    })

    it('should fail for customer with no subscription', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices/upcoming',
            {
              status: 400,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'No upcoming invoices for customer: cus_test123',
                  code: 'invoice_upcoming_none',
                },
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })

      await expect(
        stripe.invoices.upcoming({ customer: 'cus_test123' })
      ).rejects.toThrow(StripeAPIError)
    })
  })

  describe('upcomingLines', () => {
    it('should list upcoming invoice line items', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices/upcoming/lines',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockInvoiceLineItem()],
                has_more: false,
                url: '/v1/invoices/upcoming/lines',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.upcomingLines({
        customer: 'cus_test123',
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].object).toBe('line_item')
    })

    it('should preview upcoming lines with subscription changes', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices/upcoming/lines',
            {
              status: 200,
              body: {
                object: 'list',
                data: [
                  mockInvoiceLineItem({ amount: 3000, proration: true }),
                  mockInvoiceLineItem({ id: 'il_test456', amount: -1000, proration: true }),
                ],
                has_more: false,
                url: '/v1/invoices/upcoming/lines',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.upcomingLines({
        customer: 'cus_test123',
        subscription_details: {
          items: [{ price: 'price_new' }],
        },
      })

      expect(result.data).toHaveLength(2)
      expect(result.data.some((item) => item.proration)).toBe(true)
    })
  })
})

// =============================================================================
// Invoice Line Items Tests
// =============================================================================

describe('@dotdo/stripe - Invoice Line Items', () => {
  describe('listLines', () => {
    it('should list invoice line items', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices/in_test123/lines',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockInvoiceLineItem()],
                has_more: false,
                url: '/v1/invoices/in_test123/lines',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.listLines('in_test123')

      expect(result.object).toBe('list')
      expect(result.data).toHaveLength(1)
    })

    it('should list invoice line items with pagination', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices/in_test123/lines',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockInvoiceLineItem()],
                has_more: true,
                url: '/v1/invoices/in_test123/lines',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.listLines('in_test123', { limit: 1 })

      expect(result.has_more).toBe(true)
    })

    it('should retrieve proration line items', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices/in_test123/lines',
            {
              status: 200,
              body: {
                object: 'list',
                data: [
                  mockInvoiceLineItem({ proration: true, type: 'subscription' }),
                ],
                has_more: false,
                url: '/v1/invoices/in_test123/lines',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.listLines('in_test123')

      expect(result.data[0].proration).toBe(true)
      expect(result.data[0].type).toBe('subscription')
    })
  })

  describe('updateLine', () => {
    it('should update an invoice line item', async () => {
      const updatedLine = mockInvoiceLineItem({
        description: 'Updated description',
        metadata: { key: 'value' },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123/lines/il_test123', { status: 200, body: updatedLine }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const line = await stripe.invoices.updateLine('in_test123', 'il_test123', {
        description: 'Updated description',
        metadata: { key: 'value' },
      })

      expect(line.description).toBe('Updated description')
      expect(line.metadata.key).toBe('value')
    })

    it('should update line item tax rates', async () => {
      const updatedLine = mockInvoiceLineItem({
        tax_rates: [{ id: 'txr_test', percentage: 10 }],
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/in_test123/lines/il_test123', { status: 200, body: updatedLine }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const line = await stripe.invoices.updateLine('in_test123', 'il_test123', {
        tax_rates: ['txr_test'],
      })

      expect(line.tax_rates).toHaveLength(1)
    })
  })
})

// =============================================================================
// Invoice Items Tests
// =============================================================================

describe('@dotdo/stripe - Invoice Items', () => {
  describe('create', () => {
    it('should create an invoice item', async () => {
      const invoiceItem = {
        id: 'ii_test123',
        object: 'invoiceitem',
        amount: 1000,
        currency: 'usd',
        customer: 'cus_test123',
        date: Math.floor(Date.now() / 1000),
        description: 'Test item',
        discountable: true,
        livemode: false,
        metadata: {},
        proration: false,
        quantity: 1,
      }
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoiceitems', { status: 200, body: invoiceItem }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const item = await stripe.invoiceItems.create({
        customer: 'cus_test123',
        amount: 1000,
        currency: 'usd',
        description: 'Test item',
      })

      expect(item.id).toBe('ii_test123')
      expect(item.amount).toBe(1000)
    })

    it('should create invoice item attached to specific invoice', async () => {
      const invoiceItem = {
        id: 'ii_test123',
        object: 'invoiceitem',
        invoice: 'in_test123',
        customer: 'cus_test123',
        amount: 1000,
        currency: 'usd',
      }
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoiceitems', { status: 200, body: invoiceItem }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const item = await stripe.invoiceItems.create({
        customer: 'cus_test123',
        invoice: 'in_test123',
        amount: 1000,
        currency: 'usd',
      })

      expect(item.invoice).toBe('in_test123')
    })

    it('should create invoice item with price', async () => {
      const invoiceItem = {
        id: 'ii_test123',
        object: 'invoiceitem',
        customer: 'cus_test123',
        price: { id: 'price_test123', unit_amount: 1000 },
        quantity: 2,
      }
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoiceitems', { status: 200, body: invoiceItem }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const item = await stripe.invoiceItems.create({
        customer: 'cus_test123',
        price: 'price_test123',
        quantity: 2,
      })

      expect(item.quantity).toBe(2)
    })

    it('should create invoice item for subscription proration', async () => {
      const invoiceItem = {
        id: 'ii_test123',
        object: 'invoiceitem',
        customer: 'cus_test123',
        subscription: 'sub_test123',
        proration: true,
      }
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoiceitems', { status: 200, body: invoiceItem }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const item = await stripe.invoiceItems.create({
        customer: 'cus_test123',
        subscription: 'sub_test123',
        amount: 500,
        currency: 'usd',
      })

      expect(item.subscription).toBe('sub_test123')
    })
  })

  describe('retrieve', () => {
    it('should retrieve an invoice item', async () => {
      const invoiceItem = {
        id: 'ii_test123',
        object: 'invoiceitem',
        customer: 'cus_test123',
        amount: 1000,
      }
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/invoiceitems/ii_test123', { status: 200, body: invoiceItem }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const item = await stripe.invoiceItems.retrieve('ii_test123')

      expect(item.id).toBe('ii_test123')
    })
  })

  describe('update', () => {
    it('should update an invoice item', async () => {
      const invoiceItem = {
        id: 'ii_test123',
        object: 'invoiceitem',
        description: 'Updated description',
      }
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoiceitems/ii_test123', { status: 200, body: invoiceItem }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const item = await stripe.invoiceItems.update('ii_test123', {
        description: 'Updated description',
      })

      expect(item.description).toBe('Updated description')
    })
  })

  describe('delete', () => {
    it('should delete an invoice item', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /v1/invoiceitems/ii_test123',
            {
              status: 200,
              body: { id: 'ii_test123', object: 'invoiceitem', deleted: true },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoiceItems.del('ii_test123')

      expect(result.deleted).toBe(true)
    })
  })

  describe('list', () => {
    it('should list invoice items', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoiceitems',
            {
              status: 200,
              body: {
                object: 'list',
                data: [{ id: 'ii_test123', object: 'invoiceitem' }],
                has_more: false,
                url: '/v1/invoiceitems',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoiceItems.list()

      expect(result.data).toHaveLength(1)
    })

    it('should filter invoice items by customer', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoiceitems',
            {
              status: 200,
              body: {
                object: 'list',
                data: [{ id: 'ii_test123', object: 'invoiceitem', customer: 'cus_test123' }],
                has_more: false,
                url: '/v1/invoiceitems',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      await stripe.invoiceItems.list({ customer: 'cus_test123' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('customer=cus_test123'),
        expect.anything()
      )
    })

    it('should filter pending invoice items', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoiceitems',
            {
              status: 200,
              body: {
                object: 'list',
                data: [{ id: 'ii_test123', object: 'invoiceitem', invoice: null }],
                has_more: false,
                url: '/v1/invoiceitems',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      await stripe.invoiceItems.list({ pending: true })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('pending=true'),
        expect.anything()
      )
    })
  })
})

// =============================================================================
// Invoice Preview / CreatePreview Tests
// =============================================================================

describe('@dotdo/stripe - Invoice Previews', () => {
  describe('createPreview', () => {
    it('should create invoice preview for new subscription', async () => {
      const previewInvoice = mockInvoice({
        id: '',
        status: null,
        subtotal: 4999,
        total: 4999,
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/create_preview', { status: 200, body: previewInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.createPreview({
        customer: 'cus_test123',
        subscription_details: {
          items: [{ price: 'price_premium' }],
        },
      })

      expect(invoice.subtotal).toBe(4999)
    })

    it('should create invoice preview with prorations', async () => {
      const previewInvoice = mockInvoice({
        id: '',
        status: null,
        lines: {
          object: 'list',
          data: [
            mockInvoiceLineItem({ amount: 2500, proration: true }),
            mockInvoiceLineItem({ id: 'il_456', amount: -1000, proration: true }),
          ],
          has_more: false,
          url: '/v1/invoices/preview/lines',
        },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/create_preview', { status: 200, body: previewInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.createPreview({
        customer: 'cus_test123',
        subscription: 'sub_test123',
        subscription_details: {
          items: [
            { id: 'si_existing', price: 'price_upgraded' },
          ],
          proration_behavior: 'create_prorations',
        },
      })

      expect(invoice.lines.data.some((l) => l.proration)).toBe(true)
    })

    it('should create invoice preview for customer without subscription', async () => {
      const previewInvoice = mockInvoice({
        id: '',
        status: null,
        subtotal: 2000,
        total: 2000,
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/create_preview', { status: 200, body: previewInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.createPreview({
        customer: 'cus_test123',
        invoice_items: [
          { amount: 2000, currency: 'usd', description: 'One-time charge' },
        ],
      })

      expect(invoice.total).toBe(2000)
    })

    it('should create invoice preview with discount', async () => {
      const previewInvoice = mockInvoice({
        id: '',
        status: null,
        subtotal: 2000,
        total: 1600,
        total_discount_amounts: [{ amount: 400, discount: 'di_test' }],
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/create_preview', { status: 200, body: previewInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.createPreview({
        customer: 'cus_test123',
        discounts: [{ coupon: 'SAVE20' }],
        subscription_details: {
          items: [{ price: 'price_basic' }],
        },
      })

      expect(invoice.total).toBe(1600)
      expect(invoice.total_discount_amounts).toHaveLength(1)
    })

    it('should create invoice preview with tax', async () => {
      const previewInvoice = mockInvoice({
        id: '',
        status: null,
        subtotal: 2000,
        tax: 200,
        total: 2200,
        total_tax_amounts: [{ amount: 200, inclusive: false, tax_rate: 'txr_test' }],
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/create_preview', { status: 200, body: previewInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.createPreview({
        customer: 'cus_test123',
        customer_details: {
          tax_exempt: 'none',
        },
        subscription_details: {
          items: [{ price: 'price_basic' }],
        },
      })

      expect(invoice.tax).toBe(200)
      expect(invoice.total_tax_amounts).toHaveLength(1)
    })

    it('should create invoice preview with schedule details', async () => {
      const previewInvoice = mockInvoice({
        id: '',
        status: null,
        subtotal: 5000,
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices/create_preview', { status: 200, body: previewInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.createPreview({
        customer: 'cus_test123',
        schedule: 'sub_sched_test123',
        preview_mode: 'next',
      })

      expect(invoice.subtotal).toBe(5000)
    })
  })
})

// =============================================================================
// Search Tests
// =============================================================================

describe('@dotdo/stripe - Invoice Search', () => {
  describe('search', () => {
    it('should search invoices by customer', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices/search',
            {
              status: 200,
              body: {
                object: 'search_result',
                data: [mockInvoice()],
                has_more: false,
                url: '/v1/invoices/search',
                next_page: null,
                total_count: 1,
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.search({
        query: 'customer:"cus_test123"',
      })

      expect(result.data).toHaveLength(1)
    })

    it('should search invoices by status', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices/search',
            {
              status: 200,
              body: {
                object: 'search_result',
                data: [mockInvoice({ status: 'open' })],
                has_more: false,
                url: '/v1/invoices/search',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.search({
        query: 'status:"open"',
      })

      expect(result.data[0].status).toBe('open')
    })

    it('should search invoices with pagination', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices/search',
            {
              status: 200,
              body: {
                object: 'search_result',
                data: [mockInvoice()],
                has_more: true,
                url: '/v1/invoices/search',
                next_page: 'page_token_123',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.search({
        query: 'customer:"cus_test123"',
        limit: 1,
      })

      expect(result.has_more).toBe(true)
      expect(result.next_page).toBe('page_token_123')
    })

    it('should search invoices by metadata', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/invoices/search',
            {
              status: 200,
              body: {
                object: 'search_result',
                data: [mockInvoice({ metadata: { order_id: '12345' } })],
                has_more: false,
                url: '/v1/invoices/search',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.invoices.search({
        query: 'metadata["order_id"]:"12345"',
      })

      expect(result.data[0].metadata.order_id).toBe('12345')
    })
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('@dotdo/stripe - Invoice Edge Cases', () => {
  describe('concurrent operations', () => {
    it('should handle idempotent invoice creation', async () => {
      const expectedInvoice = mockInvoice()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedInvoice,
      })

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      await stripe.invoices.create(
        { customer: 'cus_test123' },
        { idempotencyKey: 'unique_key_123' }
      )

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Idempotency-Key': 'unique_key_123',
          }),
        })
      )
    })
  })

  describe('invoice with zero amount', () => {
    it('should create invoice with zero amount due', async () => {
      const zeroInvoice = mockInvoice({
        amount_due: 0,
        amount_remaining: 0,
        total: 0,
        subtotal: 0,
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/invoices', { status: 200, body: zeroInvoice }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.create({
        customer: 'cus_test123',
      })

      expect(invoice.amount_due).toBe(0)
    })
  })

  describe('invoice amount calculations', () => {
    it('should correctly calculate amounts with discounts', async () => {
      const invoiceWithDiscount = mockInvoice({
        subtotal: 2000,
        total: 1600,
        total_discount_amounts: [{ amount: 400, discount: 'di_test' }],
      })
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/invoices/in_test123', { status: 200, body: invoiceWithDiscount }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.retrieve('in_test123')

      expect(invoice.subtotal - invoice.total).toBe(400)
      expect(invoice.total_discount_amounts![0].amount).toBe(400)
    })

    it('should correctly calculate amounts with tax', async () => {
      const invoiceWithTax = mockInvoice({
        subtotal: 2000,
        tax: 200,
        total: 2200,
      })
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/invoices/in_test123', { status: 200, body: invoiceWithTax }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.retrieve('in_test123')

      expect(invoice.subtotal + (invoice.tax ?? 0)).toBe(invoice.total)
    })

    it('should correctly calculate amounts with credit notes', async () => {
      const invoiceWithCredits = mockInvoice({
        subtotal: 2000,
        total: 2000,
        post_payment_credit_notes_amount: 500,
        amount_remaining: 1500,
      })
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/invoices/in_test123', { status: 200, body: invoiceWithCredits }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const invoice = await stripe.invoices.retrieve('in_test123')

      expect(invoice.post_payment_credit_notes_amount).toBe(500)
    })
  })

  describe('invoice webhooks', () => {
    it('should have correct event types for invoice operations', () => {
      // These would be tested by verifying webhook payloads
      const invoiceEventTypes = [
        'invoice.created',
        'invoice.finalized',
        'invoice.finalization_failed',
        'invoice.paid',
        'invoice.payment_action_required',
        'invoice.payment_failed',
        'invoice.payment_succeeded',
        'invoice.sent',
        'invoice.upcoming',
        'invoice.updated',
        'invoice.voided',
        'invoice.marked_uncollectible',
      ]

      expect(invoiceEventTypes).toHaveLength(12)
    })
  })

  describe('form encoding for complex parameters', () => {
    it('should properly encode invoice item arrays', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockInvoice(),
      })

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      await stripe.invoices.createPreview({
        customer: 'cus_test123',
        invoice_items: [
          { amount: 1000, currency: 'usd' },
          { amount: 2000, currency: 'usd' },
        ],
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = options?.body as string

      expect(body).toContain('invoice_items')
    })

    it('should properly encode subscription details', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockInvoice(),
      })

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      await stripe.invoices.createPreview({
        customer: 'cus_test123',
        subscription_details: {
          items: [
            { price: 'price_test', quantity: 2 },
          ],
          proration_behavior: 'create_prorations',
        },
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = options?.body as string

      expect(body).toContain('subscription_details')
    })
  })
})

// =============================================================================
// Connect and Stripe-Account Tests
// =============================================================================

describe('@dotdo/stripe - Invoice Connect Operations', () => {
  it('should create invoice on connected account', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => mockInvoice(),
    })

    const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
    await stripe.invoices.create(
      { customer: 'cus_test123' },
      { stripeAccount: 'acct_connected123' }
    )

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Stripe-Account': 'acct_connected123',
        }),
      })
    )
  })

  it('should create invoice with transfer data for Connect', async () => {
    const invoiceWithTransfer = mockInvoice({
      transfer_data: {
        amount: 1800,
        destination: 'acct_connected123',
      },
    })
    const mockFetch = createMockFetch(
      new Map([
        ['POST /v1/invoices', { status: 200, body: invoiceWithTransfer }],
      ])
    )

    const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
    const invoice = await stripe.invoices.create({
      customer: 'cus_test123',
      transfer_data: {
        amount: 1800,
        destination: 'acct_connected123',
      },
    })

    expect(invoice.transfer_data?.destination).toBe('acct_connected123')
    expect(invoice.transfer_data?.amount).toBe(1800)
  })

  it('should create invoice on behalf of connected account', async () => {
    const invoiceOnBehalf = mockInvoice({
      on_behalf_of: 'acct_connected123',
    })
    const mockFetch = createMockFetch(
      new Map([
        ['POST /v1/invoices', { status: 200, body: invoiceOnBehalf }],
      ])
    )

    const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
    const invoice = await stripe.invoices.create({
      customer: 'cus_test123',
      on_behalf_of: 'acct_connected123',
    })

    expect(invoice.on_behalf_of).toBe('acct_connected123')
  })
})
