/**
 * @dotdo/medusa - Type Definitions
 *
 * Medusa e-commerce platform API compatible types.
 * Based on Medusa JS SDK v2.0+
 *
 * @module @dotdo/medusa/types
 */

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Medusa client configuration options
 */
export interface MedusaConfig {
  /** Base URL of the Medusa server */
  baseUrl: string
  /** API key for admin authentication */
  apiKey?: string
  /** JWT token for customer authentication */
  jwt?: string
  /** Maximum number of network retries */
  maxRetries?: number
  /** Request timeout in milliseconds */
  timeout?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Publishable API key for storefront */
  publishableApiKey?: string
}

/**
 * Request options for API calls
 */
export interface RequestOptions {
  /** Override timeout for this request */
  timeout?: number
  /** Custom headers */
  headers?: Record<string, string>
}

// =============================================================================
// Common Types
// =============================================================================

/**
 * Standard list response with pagination
 */
export interface ListResponse<T> {
  data: T[]
  count: number
  offset: number
  limit: number
}

/**
 * Money amount representation
 */
export interface MoneyAmount {
  id: string
  currency_code: string
  amount: number
  min_quantity?: number | null
  max_quantity?: number | null
  created_at: string
  updated_at: string
}

/**
 * Image representation
 */
export interface Image {
  id: string
  url: string
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

/**
 * Address representation
 */
export interface Address {
  id: string
  customer_id?: string | null
  company?: string | null
  first_name?: string | null
  last_name?: string | null
  address_1?: string | null
  address_2?: string | null
  city?: string | null
  country_code?: string | null
  province?: string | null
  postal_code?: string | null
  phone?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

// =============================================================================
// Product Types
// =============================================================================

/**
 * Product status
 */
export type ProductStatus = 'draft' | 'proposed' | 'published' | 'rejected'

/**
 * Product representation
 */
export interface Product {
  id: string
  title: string
  subtitle?: string | null
  description?: string | null
  handle?: string | null
  is_giftcard: boolean
  status: ProductStatus
  thumbnail?: string | null
  weight?: number | null
  length?: number | null
  height?: number | null
  width?: number | null
  hs_code?: string | null
  origin_country?: string | null
  mid_code?: string | null
  material?: string | null
  collection_id?: string | null
  type_id?: string | null
  discountable: boolean
  external_id?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  variants?: ProductVariant[]
  options?: ProductOption[]
  images?: Image[]
  collection?: ProductCollection | null
  type?: ProductType | null
  tags?: ProductTag[]
  categories?: ProductCategory[]
}

/**
 * Product variant
 */
export interface ProductVariant {
  id: string
  product_id: string
  title: string
  sku?: string | null
  barcode?: string | null
  ean?: string | null
  upc?: string | null
  inventory_quantity: number
  allow_backorder: boolean
  manage_inventory: boolean
  hs_code?: string | null
  origin_country?: string | null
  mid_code?: string | null
  material?: string | null
  weight?: number | null
  length?: number | null
  height?: number | null
  width?: number | null
  variant_rank?: number | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  options?: ProductOptionValue[]
  prices?: MoneyAmount[]
  product?: Product
}

/**
 * Product option (e.g., Size, Color)
 */
export interface ProductOption {
  id: string
  product_id: string
  title: string
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  values?: ProductOptionValue[]
}

/**
 * Product option value
 */
export interface ProductOptionValue {
  id: string
  option_id: string
  variant_id: string
  value: string
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

/**
 * Product collection
 */
export interface ProductCollection {
  id: string
  title: string
  handle?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  products?: Product[]
}

/**
 * Product type
 */
export interface ProductType {
  id: string
  value: string
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

/**
 * Product tag
 */
export interface ProductTag {
  id: string
  value: string
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

/**
 * Product category
 */
export interface ProductCategory {
  id: string
  name: string
  description?: string | null
  handle?: string | null
  is_active: boolean
  is_internal: boolean
  rank: number
  parent_category_id?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  parent_category?: ProductCategory | null
  category_children?: ProductCategory[]
}

// =============================================================================
// Product Input Types
// =============================================================================

/**
 * Input for creating a product
 */
export interface CreateProductInput {
  title: string
  subtitle?: string
  description?: string
  handle?: string
  is_giftcard?: boolean
  status?: ProductStatus
  thumbnail?: string
  weight?: number
  length?: number
  height?: number
  width?: number
  hs_code?: string
  origin_country?: string
  mid_code?: string
  material?: string
  collection_id?: string
  type_id?: string
  discountable?: boolean
  external_id?: string
  metadata?: Record<string, unknown>
  variants?: CreateVariantInput[]
  options?: CreateOptionInput[]
  images?: string[]
  tags?: { id?: string; value: string }[]
  categories?: { id: string }[]
}

/**
 * Input for updating a product
 */
export interface UpdateProductInput {
  title?: string
  subtitle?: string | null
  description?: string | null
  handle?: string | null
  status?: ProductStatus
  thumbnail?: string | null
  weight?: number | null
  length?: number | null
  height?: number | null
  width?: number | null
  hs_code?: string | null
  origin_country?: string | null
  mid_code?: string | null
  material?: string | null
  collection_id?: string | null
  type_id?: string | null
  discountable?: boolean
  external_id?: string | null
  metadata?: Record<string, unknown> | null
  variants?: UpdateVariantInput[]
  options?: UpdateOptionInput[]
  images?: string[]
  tags?: { id?: string; value: string }[]
  categories?: { id: string }[]
}

/**
 * Input for creating a variant
 */
export interface CreateVariantInput {
  title: string
  sku?: string
  barcode?: string
  ean?: string
  upc?: string
  inventory_quantity?: number
  allow_backorder?: boolean
  manage_inventory?: boolean
  hs_code?: string
  origin_country?: string
  mid_code?: string
  material?: string
  weight?: number
  length?: number
  height?: number
  width?: number
  metadata?: Record<string, unknown>
  options?: { option_id: string; value: string }[]
  prices?: { currency_code: string; amount: number }[]
}

/**
 * Input for updating a variant
 */
export interface UpdateVariantInput {
  id?: string
  title?: string
  sku?: string | null
  barcode?: string | null
  ean?: string | null
  upc?: string | null
  inventory_quantity?: number
  allow_backorder?: boolean
  manage_inventory?: boolean
  hs_code?: string | null
  origin_country?: string | null
  mid_code?: string | null
  material?: string | null
  weight?: number | null
  length?: number | null
  height?: number | null
  width?: number | null
  metadata?: Record<string, unknown> | null
  options?: { option_id: string; value: string }[]
  prices?: { currency_code: string; amount: number }[]
}

/**
 * Input for creating an option
 */
export interface CreateOptionInput {
  title: string
  values?: string[]
}

/**
 * Input for updating an option
 */
export interface UpdateOptionInput {
  id?: string
  title?: string
  values?: string[]
}

// =============================================================================
// Customer Types
// =============================================================================

/**
 * Customer representation
 */
export interface Customer {
  id: string
  email: string
  first_name?: string | null
  last_name?: string | null
  billing_address_id?: string | null
  phone?: string | null
  has_account: boolean
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  billing_address?: Address | null
  shipping_addresses?: Address[]
  orders?: Order[]
}

/**
 * Input for creating a customer
 */
export interface CreateCustomerInput {
  email: string
  password?: string
  first_name?: string
  last_name?: string
  phone?: string
  metadata?: Record<string, unknown>
}

/**
 * Input for updating a customer
 */
export interface UpdateCustomerInput {
  email?: string
  password?: string
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
  billing_address_id?: string | null
  metadata?: Record<string, unknown> | null
}

// =============================================================================
// Order Types
// =============================================================================

/**
 * Order status
 */
export type OrderStatus = 'pending' | 'completed' | 'archived' | 'canceled' | 'requires_action'

/**
 * Fulfillment status
 */
export type FulfillmentStatus = 'not_fulfilled' | 'partially_fulfilled' | 'fulfilled' | 'partially_shipped' | 'shipped' | 'partially_returned' | 'returned' | 'canceled' | 'requires_action'

/**
 * Payment status
 */
export type PaymentStatus = 'not_paid' | 'awaiting' | 'captured' | 'partially_refunded' | 'refunded' | 'canceled' | 'requires_action'

/**
 * Order representation
 */
export interface Order {
  id: string
  status: OrderStatus
  fulfillment_status: FulfillmentStatus
  payment_status: PaymentStatus
  display_id: number
  cart_id?: string | null
  customer_id: string
  email: string
  billing_address_id?: string | null
  shipping_address_id?: string | null
  region_id: string
  currency_code: string
  tax_rate?: number | null
  canceled_at?: string | null
  metadata?: Record<string, unknown> | null
  no_notification?: boolean | null
  idempotency_key?: string | null
  external_id?: string | null
  created_at: string
  updated_at: string
  items?: LineItem[]
  payments?: Payment[]
  fulfillments?: Fulfillment[]
  returns?: Return[]
  refunds?: Refund[]
  shipping_methods?: ShippingMethod[]
  discounts?: Discount[]
  gift_cards?: GiftCard[]
  gift_card_transactions?: GiftCardTransaction[]
  customer?: Customer
  billing_address?: Address | null
  shipping_address?: Address | null
  region?: Region
  subtotal?: number
  discount_total?: number
  shipping_total?: number
  tax_total?: number
  refunded_total?: number
  total?: number
  paid_total?: number
  refundable_amount?: number
}

/**
 * Line item in an order
 */
export interface LineItem {
  id: string
  cart_id?: string | null
  order_id?: string | null
  swap_id?: string | null
  claim_order_id?: string | null
  title: string
  description?: string | null
  thumbnail?: string | null
  is_return: boolean
  is_giftcard: boolean
  should_merge: boolean
  allow_discounts: boolean
  has_shipping?: boolean | null
  unit_price: number
  variant_id?: string | null
  quantity: number
  fulfilled_quantity?: number | null
  returned_quantity?: number | null
  shipped_quantity?: number | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  variant?: ProductVariant | null
  adjustments?: LineItemAdjustment[]
  tax_lines?: LineItemTaxLine[]
  subtotal?: number
  discount_total?: number
  total?: number
  original_total?: number
  original_tax_total?: number
  tax_total?: number
  refundable?: number
}

/**
 * Line item adjustment
 */
export interface LineItemAdjustment {
  id: string
  item_id: string
  description: string
  discount_id?: string | null
  amount: number
  metadata?: Record<string, unknown> | null
}

/**
 * Line item tax line
 */
export interface LineItemTaxLine {
  id: string
  item_id: string
  rate: number
  name: string
  code?: string | null
  metadata?: Record<string, unknown> | null
}

// =============================================================================
// Cart Types
// =============================================================================

/**
 * Cart representation
 */
export interface Cart {
  id: string
  email?: string | null
  billing_address_id?: string | null
  shipping_address_id?: string | null
  region_id: string
  customer_id?: string | null
  payment_id?: string | null
  type: 'default' | 'swap' | 'draft_order' | 'payment_link' | 'claim'
  completed_at?: string | null
  payment_authorized_at?: string | null
  idempotency_key?: string | null
  context?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  sales_channel_id?: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  items?: LineItem[]
  region?: Region
  discounts?: Discount[]
  gift_cards?: GiftCard[]
  customer?: Customer | null
  payment_session?: PaymentSession | null
  payment_sessions?: PaymentSession[]
  payment?: Payment | null
  shipping_methods?: ShippingMethod[]
  billing_address?: Address | null
  shipping_address?: Address | null
  subtotal?: number
  discount_total?: number
  item_tax_total?: number
  shipping_total?: number
  shipping_tax_total?: number
  tax_total?: number
  refunded_total?: number
  total?: number
  refundable_amount?: number
  gift_card_total?: number
  gift_card_tax_total?: number
}

/**
 * Input for creating a cart
 */
export interface CreateCartInput {
  region_id?: string
  sales_channel_id?: string
  country_code?: string
  items?: { variant_id: string; quantity: number }[]
  context?: Record<string, unknown>
}

/**
 * Input for updating a cart
 */
export interface UpdateCartInput {
  region_id?: string
  country_code?: string
  email?: string | null
  billing_address?: Partial<Omit<Address, 'id' | 'created_at' | 'updated_at'>> | string | null
  shipping_address?: Partial<Omit<Address, 'id' | 'created_at' | 'updated_at'>> | string | null
  gift_cards?: { code: string }[]
  discounts?: { code: string }[]
  customer_id?: string | null
  context?: Record<string, unknown>
  metadata?: Record<string, unknown>
  sales_channel_id?: string
}

// =============================================================================
// Payment Types
// =============================================================================

/**
 * Payment representation
 */
export interface Payment {
  id: string
  swap_id?: string | null
  cart_id?: string | null
  order_id?: string | null
  amount: number
  currency_code: string
  amount_refunded: number
  provider_id: string
  data: Record<string, unknown>
  captured_at?: string | null
  canceled_at?: string | null
  idempotency_key?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

/**
 * Payment session
 */
export interface PaymentSession {
  id: string
  cart_id?: string | null
  provider_id: string
  is_selected?: boolean | null
  is_initiated: boolean
  status: 'authorized' | 'pending' | 'requires_more' | 'error' | 'canceled'
  data: Record<string, unknown>
  idempotency_key?: string | null
  amount?: number | null
  payment_authorized_at?: string | null
  created_at: string
  updated_at: string
}

// =============================================================================
// Shipping Types
// =============================================================================

/**
 * Shipping method
 */
export interface ShippingMethod {
  id: string
  shipping_option_id: string
  order_id?: string | null
  claim_order_id?: string | null
  cart_id?: string | null
  swap_id?: string | null
  return_id?: string | null
  price: number
  data: Record<string, unknown>
  includes_tax: boolean
  subtotal?: number
  total?: number
  tax_total?: number
  shipping_option?: ShippingOption
  tax_lines?: ShippingMethodTaxLine[]
}

/**
 * Shipping option
 */
export interface ShippingOption {
  id: string
  name: string
  region_id: string
  profile_id: string
  provider_id: string
  price_type: 'flat_rate' | 'calculated'
  amount?: number | null
  is_return: boolean
  admin_only: boolean
  data: Record<string, unknown>
  metadata?: Record<string, unknown> | null
  includes_tax: boolean
  created_at: string
  updated_at: string
  deleted_at?: string | null
  region?: Region
  requirements?: ShippingOptionRequirement[]
}

/**
 * Shipping option requirement
 */
export interface ShippingOptionRequirement {
  id: string
  shipping_option_id: string
  type: 'min_subtotal' | 'max_subtotal'
  amount: number
  deleted_at?: string | null
}

/**
 * Shipping method tax line
 */
export interface ShippingMethodTaxLine {
  id: string
  shipping_method_id: string
  rate: number
  name: string
  code?: string | null
  metadata?: Record<string, unknown> | null
}

// =============================================================================
// Region Types
// =============================================================================

/**
 * Region representation
 */
export interface Region {
  id: string
  name: string
  currency_code: string
  tax_rate: number
  tax_code?: string | null
  gift_cards_taxable: boolean
  automatic_taxes: boolean
  includes_tax: boolean
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  countries?: Country[]
  payment_providers?: PaymentProvider[]
  fulfillment_providers?: FulfillmentProvider[]
  tax_rates?: TaxRate[]
}

/**
 * Country
 */
export interface Country {
  id: number
  iso_2: string
  iso_3: string
  num_code: number
  name: string
  display_name: string
  region_id?: string | null
  region?: Region | null
}

/**
 * Payment provider
 */
export interface PaymentProvider {
  id: string
  is_installed: boolean
}

/**
 * Fulfillment provider
 */
export interface FulfillmentProvider {
  id: string
  is_installed: boolean
}

/**
 * Tax rate
 */
export interface TaxRate {
  id: string
  rate?: number | null
  code?: string | null
  name: string
  region_id: string
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

// =============================================================================
// Fulfillment Types
// =============================================================================

/**
 * Fulfillment representation
 */
export interface Fulfillment {
  id: string
  claim_order_id?: string | null
  swap_id?: string | null
  order_id?: string | null
  provider_id: string
  location_id?: string | null
  tracking_numbers: string[]
  data: Record<string, unknown>
  shipped_at?: string | null
  canceled_at?: string | null
  no_notification?: boolean | null
  idempotency_key?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  items?: FulfillmentItem[]
  tracking_links?: TrackingLink[]
}

/**
 * Fulfillment item
 */
export interface FulfillmentItem {
  fulfillment_id: string
  item_id: string
  quantity: number
  item?: LineItem
}

/**
 * Tracking link
 */
export interface TrackingLink {
  id: string
  url?: string | null
  tracking_number: string
  fulfillment_id: string
  idempotency_key?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

// =============================================================================
// Return & Refund Types
// =============================================================================

/**
 * Return status
 */
export type ReturnStatus = 'requested' | 'received' | 'requires_action' | 'canceled'

/**
 * Return representation
 */
export interface Return {
  id: string
  status: ReturnStatus
  swap_id?: string | null
  claim_order_id?: string | null
  order_id?: string | null
  shipping_data?: Record<string, unknown> | null
  refund_amount: number
  received_at?: string | null
  no_notification?: boolean | null
  idempotency_key?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  items?: ReturnItem[]
  shipping_method?: ShippingMethod | null
  order?: Order | null
}

/**
 * Return item
 */
export interface ReturnItem {
  return_id: string
  item_id: string
  quantity: number
  is_requested: boolean
  requested_quantity?: number | null
  received_quantity?: number | null
  reason_id?: string | null
  note?: string | null
  metadata?: Record<string, unknown> | null
  reason?: ReturnReason | null
  item?: LineItem
}

/**
 * Return reason
 */
export interface ReturnReason {
  id: string
  value: string
  label: string
  description?: string | null
  parent_return_reason_id?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  parent_return_reason?: ReturnReason | null
  return_reason_children?: ReturnReason[]
}

/**
 * Refund representation
 */
export interface Refund {
  id: string
  order_id?: string | null
  payment_id?: string | null
  amount: number
  note?: string | null
  reason: 'discount' | 'return' | 'swap' | 'claim' | 'other'
  idempotency_key?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

// =============================================================================
// Discount Types
// =============================================================================

/**
 * Discount representation
 */
export interface Discount {
  id: string
  code: string
  is_dynamic: boolean
  rule_id?: string | null
  is_disabled: boolean
  parent_discount_id?: string | null
  starts_at?: string | null
  ends_at?: string | null
  valid_duration?: string | null
  usage_limit?: number | null
  usage_count: number
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  rule?: DiscountRule | null
  regions?: Region[]
}

/**
 * Discount rule
 */
export interface DiscountRule {
  id: string
  type: 'fixed' | 'percentage' | 'free_shipping'
  description?: string | null
  value: number
  allocation: 'total' | 'item'
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  conditions?: DiscountCondition[]
}

/**
 * Discount condition
 */
export interface DiscountCondition {
  id: string
  type: 'products' | 'product_types' | 'product_collections' | 'product_tags' | 'customer_groups'
  operator: 'in' | 'not_in'
  discount_rule_id: string
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

// =============================================================================
// Gift Card Types
// =============================================================================

/**
 * Gift card representation
 */
export interface GiftCard {
  id: string
  code: string
  value: number
  balance: number
  region_id: string
  order_id?: string | null
  is_disabled: boolean
  ends_at?: string | null
  tax_rate?: number | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  order?: Order | null
  region?: Region
}

/**
 * Gift card transaction
 */
export interface GiftCardTransaction {
  id: string
  gift_card_id: string
  order_id: string
  amount: number
  is_taxable?: boolean | null
  tax_rate?: number | null
  created_at: string
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Medusa API error
 */
export interface MedusaError {
  type: string
  message: string
  code?: string
}

/**
 * Medusa error response
 */
export interface MedusaErrorResponse {
  type: string
  message: string
  code?: string
}
