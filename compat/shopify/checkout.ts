/**
 * @dotdo/shopify - Checkout Resource
 *
 * Shopify Admin API compatible checkout operations including:
 * - Checkout creation and retrieval
 * - Line item management
 * - Discount code application
 * - Shipping rate calculation
 * - Payment processing
 * - Checkout completion
 *
 * @module @dotdo/shopify/checkout
 */

import type { RestClient } from './client'
import type { Address } from './types'

// =============================================================================
// Checkout Types
// =============================================================================

/**
 * Checkout object
 */
export interface Checkout {
  token: string
  cart_token: string | null
  email: string | null
  gateway: string | null
  buyer_accepts_marketing: boolean
  buyer_accepts_sms_marketing: boolean
  sms_marketing_phone: string | null
  created_at: string
  updated_at: string
  landing_site: string | null
  note: string | null
  note_attributes: { name: string; value: string }[]
  referring_site: string | null
  shipping_lines: ShippingLine[]
  shipping_address: Address | null
  billing_address: Address | null
  taxes_included: boolean
  total_weight: number
  currency: string
  completed_at: string | null
  closed_at: string | null
  user_id: number | null
  location_id: number | null
  source_identifier: string | null
  source_url: string | null
  device_id: number | null
  phone: string | null
  customer_locale: string | null
  line_items: CheckoutLineItem[]
  name: string
  source: string | null
  abandoned_checkout_url: string
  discount_codes: DiscountCode[]
  tax_lines: TaxLine[]
  source_name: string
  presentment_currency: string
  total_discounts: string
  total_line_items_price: string
  total_price: string
  total_tax: string
  subtotal_price: string
  total_duties: string | null
  web_url: string
  order_id: number | null
  shipping_line: ShippingLine | null
}

/**
 * Checkout line item
 */
export interface CheckoutLineItem {
  id: string
  key: string
  product_id: number
  variant_id: number
  sku: string | null
  vendor: string | null
  title: string
  variant_title: string | null
  image_url: string | null
  taxable: boolean
  requires_shipping: boolean
  gift_card: boolean
  price: string
  compare_at_price: string | null
  line_price: string
  properties: { name: string; value: string }[]
  quantity: number
  grams: number
  fulfillment_service: string
  applied_discounts: AppliedDiscount[]
  discount_allocations: DiscountAllocation[]
  tax_lines: TaxLine[]
}

/**
 * Shipping line
 */
export interface ShippingLine {
  id: number
  title: string
  price: string
  code: string | null
  source: string
  phone: string | null
  requested_fulfillment_service_id: string | null
  delivery_category: string | null
  carrier_identifier: string | null
  discounted_price: string
  tax_lines: TaxLine[]
}

/**
 * Shipping rate
 */
export interface ShippingRate {
  id: string
  title: string
  price: string
  delivery_range: [number, number] | null
  source: string
  handle: string
  phone_required: boolean
  carrier_identifier: string | null
  code: string | null
}

/**
 * Discount code
 */
export interface DiscountCode {
  code: string
  amount: string
  type: 'percentage' | 'fixed_amount' | 'shipping'
}

/**
 * Applied discount
 */
export interface AppliedDiscount {
  title: string
  description: string | null
  value: string
  value_type: 'percentage' | 'fixed_amount'
  amount: string
}

/**
 * Discount allocation
 */
export interface DiscountAllocation {
  amount: string
  discount_application_index: number
}

/**
 * Tax line
 */
export interface TaxLine {
  title: string
  price: string
  rate: number
  channel_liable: boolean
}

/**
 * Payment object
 */
export interface Payment {
  id: number
  unique_token: string
  payment_processing_error_message: string | null
  fraudulent: boolean
  transaction: PaymentTransaction | null
  credit_card: CreditCard | null
  checkout: Checkout
  next_action: NextAction | null
}

/**
 * Payment transaction
 */
export interface PaymentTransaction {
  amount: string
  amount_in: string | null
  amount_out: string | null
  amount_rounding: string | null
  authorization: string | null
  authorization_expires_at: string | null
  created_at: string
  currency: string
  error_code: string | null
  gateway: string
  id: number
  kind: 'authorization' | 'capture' | 'sale' | 'void' | 'refund'
  message: string | null
  status: 'pending' | 'failure' | 'success' | 'error'
  test: boolean
}

/**
 * Credit card info
 */
export interface CreditCard {
  first_name: string
  last_name: string
  first_digits: string
  last_digits: string
  brand: string
  expiry_month: number
  expiry_year: number
  customer_id: number | null
}

/**
 * Next action for payment
 */
export interface NextAction {
  redirect_url: string | null
}

// =============================================================================
// Runtime Type Objects (for validation/exports)
// =============================================================================

/**
 * Runtime type marker for Checkout
 * Used for validation and type exports
 */
export const Checkout = {
  _type: 'Checkout' as const,
  validate: (obj: unknown): obj is Checkout => {
    return typeof obj === 'object' && obj !== null && 'token' in obj
  },
}

/**
 * Runtime type marker for CheckoutLineItem
 */
export const CheckoutLineItem = {
  _type: 'CheckoutLineItem' as const,
  validate: (obj: unknown): obj is CheckoutLineItem => {
    return typeof obj === 'object' && obj !== null && 'variant_id' in obj
  },
}

/**
 * Runtime type marker for ShippingRate
 */
export const ShippingRate = {
  _type: 'ShippingRate' as const,
  validate: (obj: unknown): obj is ShippingRate => {
    return typeof obj === 'object' && obj !== null && 'handle' in obj
  },
}

/**
 * Runtime type marker for Payment
 */
export const Payment = {
  _type: 'Payment' as const,
  validate: (obj: unknown): obj is Payment => {
    return typeof obj === 'object' && obj !== null && 'unique_token' in obj
  },
}

// =============================================================================
// Input Types
// =============================================================================

/**
 * Input for creating a checkout
 */
export interface CheckoutInput {
  email?: string
  line_items?: CheckoutLineItemInput[]
  shipping_address?: Address
  billing_address?: Address
  note?: string
  note_attributes?: { name: string; value: string }[]
  buyer_accepts_marketing?: boolean
  buyer_accepts_sms_marketing?: boolean
  sms_marketing_phone?: string
  discount_code?: string
  presentment_currency?: string
}

/**
 * Input for checkout line item
 */
export interface CheckoutLineItemInput {
  variant_id: number
  quantity: number
  properties?: { name: string; value: string }[]
}

/**
 * Input for updating a checkout
 */
export interface CheckoutUpdateInput {
  email?: string
  shipping_address?: Address
  billing_address?: Address
  note?: string
  note_attributes?: { name: string; value: string }[]
  buyer_accepts_marketing?: boolean
}

/**
 * Input for adding line items
 */
export interface AddLineItemsInput {
  line_items: CheckoutLineItemInput[]
}

/**
 * Input for applying discount
 */
export interface ApplyDiscountInput {
  discount_code: string
}

/**
 * Input for selecting shipping rate
 */
export interface SelectShippingRateInput {
  shipping_rate: { handle: string }
}

/**
 * Input for creating a payment
 */
export interface PaymentInput {
  request_details?: {
    ip_address: string
    accept_language: string
    user_agent: string
  }
  amount: string
  session_id?: string
  unique_token: string
}

// =============================================================================
// Sub-Resources
// =============================================================================

/**
 * Shipping rates sub-resource
 */
export class ShippingRatesResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List shipping rates for a checkout
   */
  async list(token: string): Promise<ShippingRate[]> {
    const response = await this.client.get({
      path: `checkouts/${token}/shipping_rates`,
    })
    return (response.body as { shipping_rates: ShippingRate[] }).shipping_rates
  }
}

/**
 * Payments sub-resource
 */
export class PaymentsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * Create a payment for a checkout
   */
  async create(token: string, input: PaymentInput): Promise<Payment> {
    const response = await this.client.post({
      path: `checkouts/${token}/payments`,
      data: { payment: input },
    })
    return (response.body as { payment: Payment }).payment
  }

  /**
   * List payments for a checkout
   */
  async list(token: string): Promise<Payment[]> {
    const response = await this.client.get({
      path: `checkouts/${token}/payments`,
    })
    return (response.body as { payments: Payment[] }).payments
  }

  /**
   * Get a specific payment
   */
  async get(token: string, paymentId: number): Promise<Payment> {
    const response = await this.client.get({
      path: `checkouts/${token}/payments/${paymentId}`,
    })
    return (response.body as { payment: Payment }).payment
  }
}

// =============================================================================
// Checkouts Resource
// =============================================================================

/**
 * Checkouts resource for Shopify Admin API
 */
export class CheckoutsResource {
  private client: RestClient

  /** Shipping rates sub-resource */
  shippingRates: ShippingRatesResource

  /** Payments sub-resource */
  payments: PaymentsResource

  constructor(client: RestClient) {
    this.client = client
    this.shippingRates = new ShippingRatesResource(client)
    this.payments = new PaymentsResource(client)
  }

  /**
   * Create a checkout
   */
  async create(input: CheckoutInput): Promise<Checkout> {
    const response = await this.client.post({
      path: 'checkouts',
      data: { checkout: input },
    })
    return (response.body as { checkout: Checkout }).checkout
  }

  /**
   * Get a checkout
   */
  async get(token: string): Promise<Checkout> {
    const response = await this.client.get({
      path: `checkouts/${token}`,
    })
    return (response.body as { checkout: Checkout }).checkout
  }

  /**
   * Update a checkout
   */
  async update(token: string, input: CheckoutUpdateInput): Promise<Checkout> {
    const response = await this.client.put({
      path: `checkouts/${token}`,
      data: { checkout: input },
    })
    return (response.body as { checkout: Checkout }).checkout
  }

  /**
   * Complete a checkout
   */
  async complete(token: string): Promise<Checkout> {
    const response = await this.client.post({
      path: `checkouts/${token}/complete`,
      data: {},
    })
    return (response.body as { checkout: Checkout }).checkout
  }

  /**
   * Add line items to a checkout
   */
  async addLineItems(token: string, input: AddLineItemsInput): Promise<Checkout> {
    const response = await this.client.post({
      path: `checkouts/${token}`,
      data: { checkout: input },
    })
    return (response.body as { checkout: Checkout }).checkout
  }

  /**
   * Update line items in a checkout
   */
  async updateLineItems(
    token: string,
    lineItems: { id: string; quantity: number }[]
  ): Promise<Checkout> {
    const response = await this.client.put({
      path: `checkouts/${token}`,
      data: { checkout: { line_items: lineItems } },
    })
    return (response.body as { checkout: Checkout }).checkout
  }

  /**
   * Remove line items from a checkout
   */
  async removeLineItems(token: string, lineItemIds: string[]): Promise<Checkout> {
    const response = await this.client.put({
      path: `checkouts/${token}`,
      data: {
        checkout: {
          line_items: lineItemIds.map((id) => ({ id, quantity: 0 })),
        },
      },
    })
    return (response.body as { checkout: Checkout }).checkout
  }

  /**
   * Apply discount code to checkout
   */
  async applyDiscount(token: string, input: ApplyDiscountInput): Promise<Checkout> {
    const response = await this.client.put({
      path: `checkouts/${token}`,
      data: { checkout: { discount_code: input.discount_code } },
    })
    return (response.body as { checkout: Checkout }).checkout
  }

  /**
   * Remove discount code from checkout
   */
  async removeDiscount(token: string): Promise<Checkout> {
    const response = await this.client.put({
      path: `checkouts/${token}`,
      data: { checkout: { discount_code: '' } },
    })
    return (response.body as { checkout: Checkout }).checkout
  }

  /**
   * Select shipping rate for checkout
   */
  async selectShippingRate(token: string, input: SelectShippingRateInput): Promise<Checkout> {
    const response = await this.client.put({
      path: `checkouts/${token}`,
      data: { checkout: input },
    })
    return (response.body as { checkout: Checkout }).checkout
  }
}

// =============================================================================
// Local Checkout Store (DO Storage Implementation)
// =============================================================================

/**
 * Storage interface for checkout data
 */
export interface CheckoutStorage {
  get(token: string): Promise<StoredCheckout | null>
  set(token: string, checkout: StoredCheckout): Promise<void>
  delete(token: string): Promise<void>
  list(options?: { limit?: number; since_id?: string }): Promise<StoredCheckout[]>
}

/**
 * Storage interface for payments
 */
export interface PaymentStorage {
  get(checkoutToken: string, paymentId: number): Promise<StoredPayment | null>
  list(checkoutToken: string): Promise<StoredPayment[]>
  create(checkoutToken: string, payment: StoredPayment): Promise<void>
}

/**
 * Storage interface for discount codes
 */
export interface DiscountCodeStorage {
  validate(code: string): Promise<StoredDiscountCode | null>
}

/**
 * Storage interface for products/variants
 */
export interface ProductStorage {
  getVariant(variantId: number): Promise<StoredVariant | null>
}

/**
 * Stored checkout internal representation
 */
export interface StoredCheckout {
  id: number
  token: string
  cart_token: string | null
  email: string | null
  gateway: string | null
  buyer_accepts_marketing: boolean
  buyer_accepts_sms_marketing: boolean
  sms_marketing_phone: string | null
  created_at: string
  updated_at: string
  landing_site: string | null
  note: string | null
  note_attributes: { name: string; value: string }[]
  referring_site: string | null
  shipping_lines: ShippingLine[]
  shipping_address: Address | null
  billing_address: Address | null
  taxes_included: boolean
  total_weight: number
  currency: string
  completed_at: string | null
  closed_at: string | null
  user_id: number | null
  location_id: number | null
  source_identifier: string | null
  source_url: string | null
  device_id: number | null
  phone: string | null
  customer_locale: string | null
  line_items: StoredLineItem[]
  name: string
  source: string | null
  source_name: string
  presentment_currency: string
  discount_codes: DiscountCode[]
  tax_lines: TaxLine[]
  order_id: number | null
  selected_shipping_rate_handle: string | null
  payment_status: 'pending' | 'authorized' | 'paid' | null
}

/**
 * Stored line item
 */
export interface StoredLineItem {
  id: string
  key: string
  product_id: number
  variant_id: number
  sku: string | null
  vendor: string | null
  title: string
  variant_title: string | null
  image_url: string | null
  taxable: boolean
  requires_shipping: boolean
  gift_card: boolean
  price: string
  compare_at_price: string | null
  properties: { name: string; value: string }[]
  quantity: number
  grams: number
  fulfillment_service: string
  applied_discounts: AppliedDiscount[]
  discount_allocations: DiscountAllocation[]
  tax_lines: TaxLine[]
}

/**
 * Stored variant for product lookup
 */
export interface StoredVariant {
  id: number
  product_id: number
  title: string
  variant_title: string | null
  sku: string | null
  vendor: string | null
  price: string
  compare_at_price: string | null
  grams: number
  requires_shipping: boolean
  taxable: boolean
  image_url: string | null
  inventory_quantity: number
  fulfillment_service: string
}

/**
 * Stored discount code
 */
export interface StoredDiscountCode {
  code: string
  type: 'percentage' | 'fixed_amount' | 'shipping'
  value: string
  title: string
  description: string | null
  starts_at: string | null
  ends_at: string | null
  usage_limit: number | null
  usage_count: number
  minimum_order_amount: string | null
  applies_to_product_ids: number[] | null
  enabled: boolean
}

/**
 * Stored payment
 */
export interface StoredPayment {
  id: number
  unique_token: string
  checkout_token: string
  amount: string
  status: 'pending' | 'success' | 'failure'
  gateway: string
  error_message: string | null
  transaction_id: number | null
  authorization: string | null
  credit_card: CreditCard | null
  created_at: string
}

/**
 * Configuration for LocalCheckoutStore
 */
export interface LocalCheckoutStoreConfig {
  shopDomain: string
  currency?: string
  taxRate?: number
  taxesIncluded?: boolean
  checkoutStorage: CheckoutStorage
  paymentStorage: PaymentStorage
  discountCodeStorage?: DiscountCodeStorage
  productStorage?: ProductStorage
  shippingRateProvider?: ShippingRateProvider
  paymentProcessor?: PaymentProcessor
}

/**
 * Shipping rate provider interface
 */
export interface ShippingRateProvider {
  calculateRates(checkout: StoredCheckout): Promise<ShippingRate[]>
}

/**
 * Payment processor interface
 */
export interface PaymentProcessor {
  processPayment(
    checkout: StoredCheckout,
    input: PaymentInput
  ): Promise<{ success: boolean; transactionId?: number; authorization?: string; errorMessage?: string }>
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let token = ''
  for (let i = 0; i < 32; i++) {
    token += chars[Math.floor(Math.random() * chars.length)]
  }
  return token
}

function generateId(): number {
  return Math.floor(Math.random() * 9000000000) + 1000000000
}

function calculateLinePrice(price: string, quantity: number): string {
  return (parseFloat(price) * quantity).toFixed(2)
}

function calculateSubtotal(lineItems: StoredLineItem[]): string {
  return lineItems.reduce((sum, item) => {
    return sum + parseFloat(item.price) * item.quantity
  }, 0).toFixed(2)
}

function calculateTotalWeight(lineItems: StoredLineItem[]): number {
  return lineItems.reduce((sum, item) => sum + item.grams * item.quantity, 0)
}

function calculateTotalDiscounts(discountCodes: DiscountCode[]): string {
  return discountCodes.reduce((sum, dc) => sum + parseFloat(dc.amount), 0).toFixed(2)
}

function calculateTax(subtotal: string, discounts: string, taxRate: number): string {
  const taxableAmount = parseFloat(subtotal) - parseFloat(discounts)
  return (taxableAmount * taxRate).toFixed(2)
}

function calculateTotal(
  subtotal: string,
  discounts: string,
  tax: string,
  shippingPrice: string
): string {
  return (
    parseFloat(subtotal) -
    parseFloat(discounts) +
    parseFloat(tax) +
    parseFloat(shippingPrice)
  ).toFixed(2)
}

function storedToCheckout(stored: StoredCheckout, shopDomain: string): Checkout {
  const subtotal = calculateSubtotal(stored.line_items)
  const totalDiscounts = calculateTotalDiscounts(stored.discount_codes)
  const totalWeight = calculateTotalWeight(stored.line_items)

  // Find selected shipping line
  const shippingLine = stored.shipping_lines.find(
    (sl) => sl.code === stored.selected_shipping_rate_handle
  ) || stored.shipping_lines[0] || null

  const shippingPrice = shippingLine?.price || '0.00'
  const taxAmount = stored.tax_lines.reduce((sum, tl) => sum + parseFloat(tl.price), 0).toFixed(2)
  const totalPrice = calculateTotal(subtotal, totalDiscounts, taxAmount, shippingPrice)

  return {
    token: stored.token,
    cart_token: stored.cart_token,
    email: stored.email,
    gateway: stored.gateway,
    buyer_accepts_marketing: stored.buyer_accepts_marketing,
    buyer_accepts_sms_marketing: stored.buyer_accepts_sms_marketing,
    sms_marketing_phone: stored.sms_marketing_phone,
    created_at: stored.created_at,
    updated_at: stored.updated_at,
    landing_site: stored.landing_site,
    note: stored.note,
    note_attributes: stored.note_attributes,
    referring_site: stored.referring_site,
    shipping_lines: stored.shipping_lines,
    shipping_address: stored.shipping_address,
    billing_address: stored.billing_address,
    taxes_included: stored.taxes_included,
    total_weight: totalWeight,
    currency: stored.currency,
    completed_at: stored.completed_at,
    closed_at: stored.closed_at,
    user_id: stored.user_id,
    location_id: stored.location_id,
    source_identifier: stored.source_identifier,
    source_url: stored.source_url,
    device_id: stored.device_id,
    phone: stored.phone,
    customer_locale: stored.customer_locale,
    line_items: stored.line_items.map((li) => ({
      ...li,
      line_price: calculateLinePrice(li.price, li.quantity),
    })),
    name: stored.name,
    source: stored.source,
    abandoned_checkout_url: `https://${shopDomain}/checkouts/${stored.token}/recover`,
    discount_codes: stored.discount_codes,
    tax_lines: stored.tax_lines,
    source_name: stored.source_name,
    presentment_currency: stored.presentment_currency,
    total_discounts: totalDiscounts,
    total_line_items_price: subtotal,
    total_price: totalPrice,
    total_tax: taxAmount,
    subtotal_price: subtotal,
    total_duties: null,
    web_url: `https://${shopDomain}/checkouts/${stored.token}`,
    order_id: stored.order_id,
    shipping_line: shippingLine
      ? {
          id: shippingLine.id,
          title: shippingLine.title,
          price: shippingLine.price,
          code: shippingLine.code,
          source: shippingLine.source,
          phone: shippingLine.phone,
          requested_fulfillment_service_id: shippingLine.requested_fulfillment_service_id,
          delivery_category: shippingLine.delivery_category,
          carrier_identifier: shippingLine.carrier_identifier,
          discounted_price: shippingLine.discounted_price,
          tax_lines: shippingLine.tax_lines,
        }
      : null,
  }
}

function storedToPayment(
  stored: StoredPayment,
  checkout: StoredCheckout,
  shopDomain: string
): Payment {
  return {
    id: stored.id,
    unique_token: stored.unique_token,
    payment_processing_error_message: stored.error_message,
    fraudulent: false,
    transaction: stored.transaction_id
      ? {
          amount: stored.amount,
          amount_in: null,
          amount_out: null,
          amount_rounding: null,
          authorization: stored.authorization,
          authorization_expires_at: null,
          created_at: stored.created_at,
          currency: checkout.currency,
          error_code: stored.status === 'failure' ? 'card_declined' : null,
          gateway: stored.gateway,
          id: stored.transaction_id,
          kind: 'sale',
          message: stored.error_message,
          status: stored.status,
          test: false,
        }
      : null,
    credit_card: stored.credit_card,
    checkout: storedToCheckout(checkout, shopDomain),
    next_action: null,
  }
}

// =============================================================================
// LocalCheckoutStore Implementation
// =============================================================================

/**
 * Local checkout store with DO storage backing
 *
 * Implements the full Shopify checkout flow locally:
 * - Checkout creation and retrieval
 * - Line item management
 * - Discount code application
 * - Shipping rate calculation
 * - Payment processing
 * - Checkout completion
 *
 * @example
 * ```typescript
 * const store = new LocalCheckoutStore({
 *   shopDomain: 'myshop.myshopify.com',
 *   checkoutStorage: myCheckoutStorage,
 *   paymentStorage: myPaymentStorage,
 * })
 *
 * // Create checkout
 * const checkout = await store.create({
 *   line_items: [{ variant_id: 123, quantity: 2 }],
 *   email: 'customer@example.com',
 * })
 *
 * // Apply discount
 * const updated = await store.applyDiscount(checkout.token, 'SAVE20')
 *
 * // Complete checkout
 * const completed = await store.complete(checkout.token)
 * ```
 */
export class LocalCheckoutStore {
  private config: LocalCheckoutStoreConfig
  private defaultShippingRates: ShippingRate[] = [
    {
      id: 'shopify-Standard%20Shipping-5.99',
      title: 'Standard Shipping',
      price: '5.99',
      delivery_range: [3, 7],
      source: 'shopify',
      handle: 'shopify-Standard%20Shipping-5.99',
      phone_required: false,
      carrier_identifier: null,
      code: 'standard',
    },
    {
      id: 'shopify-Express%20Shipping-12.99',
      title: 'Express Shipping',
      price: '12.99',
      delivery_range: [1, 3],
      source: 'shopify',
      handle: 'shopify-Express%20Shipping-12.99',
      phone_required: false,
      carrier_identifier: null,
      code: 'express',
    },
  ]

  constructor(config: LocalCheckoutStoreConfig) {
    this.config = {
      currency: 'USD',
      taxRate: 0,
      taxesIncluded: false,
      ...config,
    }
  }

  /**
   * Create a new checkout
   */
  async create(input: CheckoutInput): Promise<Checkout> {
    const now = new Date().toISOString()
    const token = generateToken()
    const id = generateId()

    // Build line items from input
    const lineItems: StoredLineItem[] = []
    if (input.line_items) {
      for (const item of input.line_items) {
        const variant = this.config.productStorage
          ? await this.config.productStorage.getVariant(item.variant_id)
          : null

        lineItems.push({
          id: `li_${generateId()}`,
          key: `${item.variant_id}:${JSON.stringify(item.properties || [])}`,
          product_id: variant?.product_id || item.variant_id,
          variant_id: item.variant_id,
          sku: variant?.sku || null,
          vendor: variant?.vendor || null,
          title: variant?.title || `Product ${item.variant_id}`,
          variant_title: variant?.variant_title || null,
          image_url: variant?.image_url || null,
          taxable: variant?.taxable ?? true,
          requires_shipping: variant?.requires_shipping ?? true,
          gift_card: false,
          price: variant?.price || '0.00',
          compare_at_price: variant?.compare_at_price || null,
          properties: item.properties || [],
          quantity: item.quantity,
          grams: variant?.grams || 0,
          fulfillment_service: variant?.fulfillment_service || 'manual',
          applied_discounts: [],
          discount_allocations: [],
          tax_lines: [],
        })
      }
    }

    // Calculate initial tax
    const subtotal = calculateSubtotal(lineItems)
    const taxRate = this.config.taxRate || 0
    const taxAmount = (parseFloat(subtotal) * taxRate).toFixed(2)

    const checkout: StoredCheckout = {
      id,
      token,
      cart_token: null,
      email: input.email || null,
      gateway: null,
      buyer_accepts_marketing: input.buyer_accepts_marketing || false,
      buyer_accepts_sms_marketing: input.buyer_accepts_sms_marketing || false,
      sms_marketing_phone: input.sms_marketing_phone || null,
      created_at: now,
      updated_at: now,
      landing_site: null,
      note: input.note || null,
      note_attributes: input.note_attributes || [],
      referring_site: null,
      shipping_lines: [],
      shipping_address: input.shipping_address || null,
      billing_address: input.billing_address || null,
      taxes_included: this.config.taxesIncluded || false,
      total_weight: calculateTotalWeight(lineItems),
      currency: this.config.currency || 'USD',
      completed_at: null,
      closed_at: null,
      user_id: null,
      location_id: null,
      source_identifier: null,
      source_url: null,
      device_id: null,
      phone: null,
      customer_locale: null,
      line_items: lineItems,
      name: `#${id}`,
      source: 'web',
      source_name: 'web',
      presentment_currency: input.presentment_currency || this.config.currency || 'USD',
      discount_codes: [],
      tax_lines:
        taxRate > 0
          ? [{ title: 'Tax', price: taxAmount, rate: taxRate, channel_liable: false }]
          : [],
      order_id: null,
      selected_shipping_rate_handle: null,
      payment_status: null,
    }

    // Apply discount code if provided
    if (input.discount_code) {
      await this.applyDiscountToStored(checkout, input.discount_code)
    }

    await this.config.checkoutStorage.set(token, checkout)
    return storedToCheckout(checkout, this.config.shopDomain)
  }

  /**
   * Get a checkout by token
   */
  async get(token: string): Promise<Checkout | null> {
    const stored = await this.config.checkoutStorage.get(token)
    if (!stored) return null
    return storedToCheckout(stored, this.config.shopDomain)
  }

  /**
   * Update a checkout
   */
  async update(token: string, input: CheckoutUpdateInput): Promise<Checkout> {
    const stored = await this.config.checkoutStorage.get(token)
    if (!stored) {
      throw new Error(`Checkout ${token} not found`)
    }

    stored.updated_at = new Date().toISOString()

    if (input.email !== undefined) stored.email = input.email
    if (input.note !== undefined) stored.note = input.note
    if (input.note_attributes !== undefined) stored.note_attributes = input.note_attributes
    if (input.buyer_accepts_marketing !== undefined)
      stored.buyer_accepts_marketing = input.buyer_accepts_marketing
    if (input.shipping_address !== undefined) stored.shipping_address = input.shipping_address
    if (input.billing_address !== undefined) stored.billing_address = input.billing_address

    await this.config.checkoutStorage.set(token, stored)
    return storedToCheckout(stored, this.config.shopDomain)
  }

  /**
   * Add line items to checkout
   */
  async addLineItems(token: string, input: AddLineItemsInput): Promise<Checkout> {
    const stored = await this.config.checkoutStorage.get(token)
    if (!stored) {
      throw new Error(`Checkout ${token} not found`)
    }

    for (const item of input.line_items) {
      const existingIndex = stored.line_items.findIndex(
        (li) => li.variant_id === item.variant_id
      )

      if (existingIndex >= 0) {
        stored.line_items[existingIndex].quantity += item.quantity
      } else {
        const variant = this.config.productStorage
          ? await this.config.productStorage.getVariant(item.variant_id)
          : null

        stored.line_items.push({
          id: `li_${generateId()}`,
          key: `${item.variant_id}:${JSON.stringify(item.properties || [])}`,
          product_id: variant?.product_id || item.variant_id,
          variant_id: item.variant_id,
          sku: variant?.sku || null,
          vendor: variant?.vendor || null,
          title: variant?.title || `Product ${item.variant_id}`,
          variant_title: variant?.variant_title || null,
          image_url: variant?.image_url || null,
          taxable: variant?.taxable ?? true,
          requires_shipping: variant?.requires_shipping ?? true,
          gift_card: false,
          price: variant?.price || '0.00',
          compare_at_price: variant?.compare_at_price || null,
          properties: item.properties || [],
          quantity: item.quantity,
          grams: variant?.grams || 0,
          fulfillment_service: variant?.fulfillment_service || 'manual',
          applied_discounts: [],
          discount_allocations: [],
          tax_lines: [],
        })
      }
    }

    stored.updated_at = new Date().toISOString()
    this.recalculateTotals(stored)
    await this.config.checkoutStorage.set(token, stored)
    return storedToCheckout(stored, this.config.shopDomain)
  }

  /**
   * Update line items in checkout
   */
  async updateLineItems(
    token: string,
    lineItems: { id: string; quantity: number }[]
  ): Promise<Checkout> {
    const stored = await this.config.checkoutStorage.get(token)
    if (!stored) {
      throw new Error(`Checkout ${token} not found`)
    }

    for (const update of lineItems) {
      const existingIndex = stored.line_items.findIndex((li) => li.id === update.id)
      if (existingIndex >= 0) {
        if (update.quantity <= 0) {
          stored.line_items.splice(existingIndex, 1)
        } else {
          stored.line_items[existingIndex].quantity = update.quantity
        }
      }
    }

    stored.updated_at = new Date().toISOString()
    this.recalculateTotals(stored)
    await this.config.checkoutStorage.set(token, stored)
    return storedToCheckout(stored, this.config.shopDomain)
  }

  /**
   * Remove line items from checkout
   */
  async removeLineItems(token: string, lineItemIds: string[]): Promise<Checkout> {
    const stored = await this.config.checkoutStorage.get(token)
    if (!stored) {
      throw new Error(`Checkout ${token} not found`)
    }

    stored.line_items = stored.line_items.filter((li) => !lineItemIds.includes(li.id))
    stored.updated_at = new Date().toISOString()
    this.recalculateTotals(stored)
    await this.config.checkoutStorage.set(token, stored)
    return storedToCheckout(stored, this.config.shopDomain)
  }

  /**
   * Apply a discount code to checkout
   */
  async applyDiscount(token: string, input: ApplyDiscountInput): Promise<Checkout> {
    const stored = await this.config.checkoutStorage.get(token)
    if (!stored) {
      throw new Error(`Checkout ${token} not found`)
    }

    await this.applyDiscountToStored(stored, input.discount_code)
    stored.updated_at = new Date().toISOString()
    await this.config.checkoutStorage.set(token, stored)
    return storedToCheckout(stored, this.config.shopDomain)
  }

  /**
   * Remove discount code from checkout
   */
  async removeDiscount(token: string): Promise<Checkout> {
    const stored = await this.config.checkoutStorage.get(token)
    if (!stored) {
      throw new Error(`Checkout ${token} not found`)
    }

    stored.discount_codes = []
    stored.line_items = stored.line_items.map((li) => ({
      ...li,
      applied_discounts: [],
      discount_allocations: [],
    }))

    stored.updated_at = new Date().toISOString()
    this.recalculateTotals(stored)
    await this.config.checkoutStorage.set(token, stored)
    return storedToCheckout(stored, this.config.shopDomain)
  }

  /**
   * Get available shipping rates for checkout
   */
  async getShippingRates(token: string): Promise<ShippingRate[]> {
    const stored = await this.config.checkoutStorage.get(token)
    if (!stored) {
      throw new Error(`Checkout ${token} not found`)
    }

    // If no shipping address, return empty rates
    if (!stored.shipping_address) {
      return []
    }

    // Check if any items require shipping
    const requiresShipping = stored.line_items.some((li) => li.requires_shipping)
    if (!requiresShipping) {
      return []
    }

    // Use custom provider or default rates
    if (this.config.shippingRateProvider) {
      return this.config.shippingRateProvider.calculateRates(stored)
    }

    return this.defaultShippingRates
  }

  /**
   * Select a shipping rate for checkout
   */
  async selectShippingRate(token: string, input: SelectShippingRateInput): Promise<Checkout> {
    const stored = await this.config.checkoutStorage.get(token)
    if (!stored) {
      throw new Error(`Checkout ${token} not found`)
    }

    const rates = await this.getShippingRates(token)
    const selectedRate = rates.find((r) => r.handle === input.shipping_rate.handle)

    if (!selectedRate) {
      throw new Error('Selected shipping rate is not available')
    }

    stored.selected_shipping_rate_handle = selectedRate.handle
    stored.shipping_lines = [
      {
        id: generateId(),
        title: selectedRate.title,
        price: selectedRate.price,
        code: selectedRate.code,
        source: selectedRate.source,
        phone: null,
        requested_fulfillment_service_id: null,
        delivery_category: null,
        carrier_identifier: selectedRate.carrier_identifier,
        discounted_price: selectedRate.price,
        tax_lines: [],
      },
    ]

    stored.updated_at = new Date().toISOString()
    await this.config.checkoutStorage.set(token, stored)
    return storedToCheckout(stored, this.config.shopDomain)
  }

  /**
   * Create a payment for checkout
   */
  async createPayment(token: string, input: PaymentInput): Promise<Payment> {
    const stored = await this.config.checkoutStorage.get(token)
    if (!stored) {
      throw new Error(`Checkout ${token} not found`)
    }

    const paymentId = generateId()
    const now = new Date().toISOString()

    let status: 'pending' | 'success' | 'failure' = 'pending'
    let transactionId: number | null = null
    let authorization: string | null = null
    let errorMessage: string | null = null

    // Process payment if processor is configured
    if (this.config.paymentProcessor) {
      const result = await this.config.paymentProcessor.processPayment(stored, input)
      status = result.success ? 'success' : 'failure'
      transactionId = result.transactionId || generateId()
      authorization = result.authorization || null
      errorMessage = result.errorMessage || null
    } else {
      // Default: simulate successful payment
      status = 'success'
      transactionId = generateId()
      authorization = `auth_${generateId()}`
    }

    const payment: StoredPayment = {
      id: paymentId,
      unique_token: input.unique_token,
      checkout_token: token,
      amount: input.amount,
      status,
      gateway: 'shopify_payments',
      error_message: errorMessage,
      transaction_id: transactionId,
      authorization,
      credit_card: null,
      created_at: now,
    }

    await this.config.paymentStorage.create(token, payment)

    // Update checkout payment status
    if (status === 'success') {
      stored.payment_status = 'paid'
      stored.gateway = 'shopify_payments'
      stored.updated_at = now
      await this.config.checkoutStorage.set(token, stored)
    }

    return storedToPayment(payment, stored, this.config.shopDomain)
  }

  /**
   * Get a payment for checkout
   */
  async getPayment(token: string, paymentId: number): Promise<Payment | null> {
    const stored = await this.config.checkoutStorage.get(token)
    if (!stored) {
      throw new Error(`Checkout ${token} not found`)
    }

    const payment = await this.config.paymentStorage.get(token, paymentId)
    if (!payment) return null

    return storedToPayment(payment, stored, this.config.shopDomain)
  }

  /**
   * List payments for checkout
   */
  async listPayments(token: string): Promise<Payment[]> {
    const stored = await this.config.checkoutStorage.get(token)
    if (!stored) {
      throw new Error(`Checkout ${token} not found`)
    }

    const payments = await this.config.paymentStorage.list(token)
    return payments.map((p) => storedToPayment(p, stored, this.config.shopDomain))
  }

  /**
   * Complete the checkout
   */
  async complete(token: string): Promise<Checkout> {
    const stored = await this.config.checkoutStorage.get(token)
    if (!stored) {
      throw new Error(`Checkout ${token} not found`)
    }

    if (stored.payment_status !== 'paid') {
      throw new Error('Checkout requires payment before completion')
    }

    if (stored.completed_at) {
      throw new Error('Checkout already completed')
    }

    const now = new Date().toISOString()
    const orderId = generateId()

    stored.completed_at = now
    stored.updated_at = now
    stored.order_id = orderId

    await this.config.checkoutStorage.set(token, stored)
    return storedToCheckout(stored, this.config.shopDomain)
  }

  /**
   * Close/abandon the checkout
   */
  async close(token: string): Promise<Checkout> {
    const stored = await this.config.checkoutStorage.get(token)
    if (!stored) {
      throw new Error(`Checkout ${token} not found`)
    }

    stored.closed_at = new Date().toISOString()
    stored.updated_at = stored.closed_at

    await this.config.checkoutStorage.set(token, stored)
    return storedToCheckout(stored, this.config.shopDomain)
  }

  // =============================================================================
  // Private Helper Methods
  // =============================================================================

  private async applyDiscountToStored(checkout: StoredCheckout, code: string): Promise<void> {
    // Validate discount code if storage is configured
    let storedDiscount: StoredDiscountCode | null = null
    if (this.config.discountCodeStorage) {
      storedDiscount = await this.config.discountCodeStorage.validate(code)
      if (!storedDiscount) {
        throw new Error(`Discount code ${code} is not valid`)
      }

      // Check if expired
      if (storedDiscount.ends_at && new Date(storedDiscount.ends_at) < new Date()) {
        throw new Error(`Discount code ${code} has expired`)
      }

      // Check if not yet active
      if (storedDiscount.starts_at && new Date(storedDiscount.starts_at) > new Date()) {
        throw new Error(`Discount code ${code} is not yet active`)
      }

      // Check usage limit
      if (
        storedDiscount.usage_limit !== null &&
        storedDiscount.usage_count >= storedDiscount.usage_limit
      ) {
        throw new Error(`Discount code ${code} usage limit reached`)
      }
    }

    // Calculate discount amount
    const subtotal = parseFloat(calculateSubtotal(checkout.line_items))
    let discountAmount = 0
    let discountType: 'percentage' | 'fixed_amount' | 'shipping' = 'percentage'

    if (storedDiscount) {
      discountType = storedDiscount.type
      if (storedDiscount.type === 'percentage') {
        discountAmount = (subtotal * parseFloat(storedDiscount.value)) / 100
      } else if (storedDiscount.type === 'fixed_amount') {
        discountAmount = parseFloat(storedDiscount.value)
      } else if (storedDiscount.type === 'shipping') {
        // Shipping discount - apply to shipping cost
        discountAmount = checkout.shipping_lines.reduce(
          (sum, sl) => sum + parseFloat(sl.price),
          0
        )
      }
    }

    checkout.discount_codes = [
      {
        code,
        amount: discountAmount.toFixed(2),
        type: discountType,
      },
    ]

    this.recalculateTotals(checkout)
  }

  private recalculateTotals(checkout: StoredCheckout): void {
    const subtotal = calculateSubtotal(checkout.line_items)
    const totalDiscounts = calculateTotalDiscounts(checkout.discount_codes)
    const taxRate = this.config.taxRate || 0

    if (taxRate > 0) {
      const taxAmount = calculateTax(subtotal, totalDiscounts, taxRate)
      checkout.tax_lines = [{ title: 'Tax', price: taxAmount, rate: taxRate, channel_liable: false }]
    }
  }
}

// =============================================================================
// In-Memory Storage Implementations (for testing)
// =============================================================================

/**
 * In-memory checkout storage for testing
 */
export class InMemoryCheckoutStorage implements CheckoutStorage {
  private checkouts: Map<string, StoredCheckout> = new Map()

  async get(token: string): Promise<StoredCheckout | null> {
    return this.checkouts.get(token) || null
  }

  async set(token: string, checkout: StoredCheckout): Promise<void> {
    this.checkouts.set(token, checkout)
  }

  async delete(token: string): Promise<void> {
    this.checkouts.delete(token)
  }

  async list(options?: { limit?: number; since_id?: string }): Promise<StoredCheckout[]> {
    const all = Array.from(this.checkouts.values())
    const limit = options?.limit || 50
    return all.slice(0, limit)
  }
}

/**
 * In-memory payment storage for testing
 */
export class InMemoryPaymentStorage implements PaymentStorage {
  private payments: Map<string, StoredPayment[]> = new Map()

  async get(checkoutToken: string, paymentId: number): Promise<StoredPayment | null> {
    const checkoutPayments = this.payments.get(checkoutToken) || []
    return checkoutPayments.find((p) => p.id === paymentId) || null
  }

  async list(checkoutToken: string): Promise<StoredPayment[]> {
    return this.payments.get(checkoutToken) || []
  }

  async create(checkoutToken: string, payment: StoredPayment): Promise<void> {
    const existing = this.payments.get(checkoutToken) || []
    existing.push(payment)
    this.payments.set(checkoutToken, existing)
  }
}

/**
 * In-memory discount code storage for testing
 */
export class InMemoryDiscountCodeStorage implements DiscountCodeStorage {
  private codes: Map<string, StoredDiscountCode> = new Map()

  addCode(discount: StoredDiscountCode): void {
    this.codes.set(discount.code.toUpperCase(), discount)
  }

  async validate(code: string): Promise<StoredDiscountCode | null> {
    return this.codes.get(code.toUpperCase()) || null
  }
}

/**
 * In-memory product storage for testing
 */
export class InMemoryProductStorage implements ProductStorage {
  private variants: Map<number, StoredVariant> = new Map()

  addVariant(variant: StoredVariant): void {
    this.variants.set(variant.id, variant)
  }

  async getVariant(variantId: number): Promise<StoredVariant | null> {
    return this.variants.get(variantId) || null
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default CheckoutsResource
