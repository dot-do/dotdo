/**
 * @dotdo/shopify - Type Definitions
 *
 * Type definitions for Shopify API compatibility layer.
 * Based on Shopify Admin API 2024-10
 */

// =============================================================================
// API Version
// =============================================================================

/**
 * Latest supported Shopify API version
 */
export const LATEST_API_VERSION = '2024-10'

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Local Shopify configuration
 */
export interface ShopifyLocalConfig {
  /** Shop domain (e.g., 'myshop.myshopify.com') */
  shop: string
  /** Access token for API requests */
  accessToken?: string
  /** API version (default: LATEST_API_VERSION) */
  apiVersion?: string
}

// =============================================================================
// Product Types
// =============================================================================

/**
 * Shopify Product
 */
export interface Product {
  id: number
  title: string
  body_html: string | null
  vendor: string
  product_type: string
  handle: string
  status: 'active' | 'archived' | 'draft'
  published_scope: 'global' | 'web'
  tags: string
  template_suffix: string | null
  created_at: string
  updated_at: string
  published_at: string | null
  variants: ProductVariant[]
  options: ProductOption[]
  images: ProductImage[]
  image: ProductImage | null
  admin_graphql_api_id?: string
}

/**
 * Product variant
 */
export interface ProductVariant {
  id: number
  product_id: number
  title: string
  price: string
  compare_at_price: string | null
  sku: string | null
  barcode: string | null
  grams: number
  weight: number
  weight_unit: 'g' | 'kg' | 'lb' | 'oz'
  inventory_item_id: number
  inventory_quantity: number
  inventory_management: 'shopify' | 'fulfillment_service' | null
  inventory_policy: 'deny' | 'continue'
  fulfillment_service: string
  requires_shipping: boolean
  taxable: boolean
  position: number
  option1: string | null
  option2: string | null
  option3: string | null
  created_at: string
  updated_at: string
  image_id?: number | null
  admin_graphql_api_id?: string
}

/**
 * Product option
 */
export interface ProductOption {
  id: number
  product_id: number
  name: string
  position: number
  values: string[]
}

/**
 * Product image
 */
export interface ProductImage {
  id: number
  product_id: number
  position: number
  created_at: string
  updated_at: string
  alt: string | null
  width: number
  height: number
  src: string
  variant_ids: number[]
  admin_graphql_api_id?: string
}

/**
 * Input for creating a product
 */
export interface ProductInput {
  title: string
  body_html?: string
  vendor?: string
  product_type?: string
  handle?: string
  status?: 'active' | 'archived' | 'draft'
  tags?: string | string[]
  template_suffix?: string | null
  published?: boolean
  options?: { name: string }[]
  variants?: VariantInput[]
  images?: ImageInput[]
}

/**
 * Input for updating a product
 */
export interface ProductUpdateInput {
  title?: string
  body_html?: string
  vendor?: string
  product_type?: string
  handle?: string
  status?: 'active' | 'archived' | 'draft'
  tags?: string | string[]
  template_suffix?: string | null
  published?: boolean
  variants?: VariantInput[]
  images?: ImageInput[]
}

/**
 * Input for creating/updating a variant
 */
export interface VariantInput {
  id?: number
  title?: string
  price?: string
  compare_at_price?: string | null
  sku?: string | null
  barcode?: string | null
  grams?: number
  weight?: number
  weight_unit?: 'g' | 'kg' | 'lb' | 'oz'
  inventory_management?: 'shopify' | 'fulfillment_service' | null
  inventory_policy?: 'deny' | 'continue'
  fulfillment_service?: string
  requires_shipping?: boolean
  taxable?: boolean
  option1?: string | null
  option2?: string | null
  option3?: string | null
  image_id?: number | null
  inventory_quantity?: number
}

/**
 * Input for creating/updating an image
 */
export interface ImageInput {
  id?: number
  src?: string
  attachment?: string
  alt?: string
  position?: number
  variant_ids?: number[]
  filename?: string
}

// =============================================================================
// Order Types
// =============================================================================

/**
 * Shopify Order
 */
export interface Order {
  id: number
  name: string
  email: string | null
  phone: string | null
  created_at: string
  updated_at: string
  processed_at: string | null
  closed_at: string | null
  cancelled_at: string | null
  cancel_reason: 'customer' | 'fraud' | 'inventory' | 'declined' | 'other' | null
  financial_status: FinancialStatus
  fulfillment_status: FulfillmentStatus | null
  currency: string
  total_price: string
  subtotal_price: string
  total_tax: string
  total_discounts: string
  total_line_items_price: string
  total_weight: number
  taxes_included: boolean
  confirmed: boolean
  test: boolean
  order_number: number
  token: string
  gateway: string | null
  line_items: LineItem[]
  shipping_lines: ShippingLine[]
  billing_address: Address | null
  shipping_address: Address | null
  customer: Customer | null
  fulfillments: Fulfillment[]
  refunds: Refund[]
  tags: string
  note: string | null
  note_attributes: NoteAttribute[]
  discount_codes: DiscountCode[]
  discount_applications: DiscountApplication[]
  admin_graphql_api_id?: string
}

export type FinancialStatus =
  | 'pending'
  | 'authorized'
  | 'partially_paid'
  | 'paid'
  | 'partially_refunded'
  | 'refunded'
  | 'voided'

export type FulfillmentStatus = 'fulfilled' | 'partial' | 'restocked'

/**
 * Order line item
 */
export interface LineItem {
  id: number
  product_id: number | null
  variant_id: number | null
  title: string
  variant_title: string | null
  sku: string | null
  quantity: number
  price: string
  grams: number
  fulfillment_status: string | null
  fulfillable_quantity: number
  fulfillment_service: string
  requires_shipping: boolean
  taxable: boolean
  gift_card: boolean
  total_discount: string
  discount_allocations: DiscountAllocation[]
  tax_lines: TaxLine[]
  properties: LineItemProperty[]
  admin_graphql_api_id?: string
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
  carrier_identifier: string | null
  requested_fulfillment_service_id: string | null
  tax_lines: TaxLine[]
  discount_allocations: DiscountAllocation[]
}

/**
 * Tax line
 */
export interface TaxLine {
  title: string
  price: string
  rate: number
  channel_liable?: boolean
}

/**
 * Discount allocation
 */
export interface DiscountAllocation {
  amount: string
  discount_application_index: number
}

/**
 * Line item property
 */
export interface LineItemProperty {
  name: string
  value: string
}

/**
 * Note attribute
 */
export interface NoteAttribute {
  name: string
  value: string
}

/**
 * Discount code
 */
export interface DiscountCode {
  code: string
  amount: string
  type: 'fixed_amount' | 'percentage' | 'shipping'
}

/**
 * Discount application
 */
export interface DiscountApplication {
  type: 'discount_code' | 'manual' | 'script' | 'automatic'
  title: string
  description: string | null
  value: string
  value_type: 'fixed_amount' | 'percentage'
  allocation_method: 'across' | 'each' | 'one'
  target_selection: 'all' | 'entitled' | 'explicit'
  target_type: 'line_item' | 'shipping_line'
}

/**
 * Input for creating an order
 */
export interface OrderInput {
  line_items?: OrderLineItemInput[]
  customer?: { id?: number; email?: string }
  billing_address?: Address
  shipping_address?: Address
  financial_status?: FinancialStatus
  fulfillment_status?: FulfillmentStatus | null
  currency?: string
  email?: string
  phone?: string
  note?: string
  tags?: string
  test?: boolean
  send_receipt?: boolean
  send_fulfillment_receipt?: boolean
  shipping_lines?: ShippingLineInput[]
  discount_codes?: { code: string; amount?: string; type?: string }[]
  taxes_included?: boolean
  tax_lines?: { title: string; price: string; rate?: number }[]
}

/**
 * Input for order line item
 */
export interface OrderLineItemInput {
  variant_id?: number
  product_id?: number
  title?: string
  quantity: number
  price?: string
  sku?: string
  grams?: number
  requires_shipping?: boolean
  taxable?: boolean
  gift_card?: boolean
  fulfillment_service?: string
  tax_lines?: { title: string; price: string; rate?: number }[]
  properties?: { name: string; value: string }[]
}

/**
 * Input for shipping line
 */
export interface ShippingLineInput {
  title?: string
  price?: string
  code?: string
  source?: string
  carrier_identifier?: string
  tax_lines?: { title: string; price: string; rate?: number }[]
}

/**
 * Input for updating an order
 */
export interface OrderUpdateInput {
  email?: string
  phone?: string
  note?: string
  tags?: string
  shipping_address?: Address
  billing_address?: Address
  buyer_accepts_marketing?: boolean
}

/**
 * Input for cancelling an order
 */
export interface OrderCancelInput {
  reason?: 'customer' | 'fraud' | 'inventory' | 'declined' | 'other'
  email?: boolean
  restock?: boolean
}

// =============================================================================
// Fulfillment Types
// =============================================================================

/**
 * Shopify Fulfillment
 */
export interface Fulfillment {
  id: number
  order_id: number
  status: 'pending' | 'open' | 'success' | 'cancelled' | 'error' | 'failure'
  tracking_company: string | null
  tracking_number: string | null
  tracking_numbers: string[]
  tracking_url: string | null
  tracking_urls: string[]
  line_items: LineItem[]
  created_at: string
  updated_at: string
  receipt?: Record<string, unknown>
  location_id?: number
  shipment_status?: string | null
  admin_graphql_api_id?: string
}

/**
 * Input for creating a fulfillment
 */
export interface FulfillmentInput {
  location_id?: number
  tracking_number?: string
  tracking_numbers?: string[]
  tracking_url?: string
  tracking_urls?: string[]
  tracking_company?: string
  line_items?: { id: number; quantity?: number }[]
  notify_customer?: boolean
  shipment_status?: string
}

/**
 * Input for updating fulfillment tracking
 */
export interface FulfillmentTrackingInput {
  tracking_number?: string
  tracking_numbers?: string[]
  tracking_url?: string
  tracking_urls?: string[]
  tracking_company?: string
  notify_customer?: boolean
}

// =============================================================================
// Refund Types
// =============================================================================

/**
 * Shopify Refund
 */
export interface Refund {
  id: number
  order_id: number
  created_at: string
  note: string | null
  user_id: number | null
  processed_at: string | null
  restock: boolean
  refund_line_items: RefundLineItem[]
  transactions: Transaction[]
  order_adjustments: OrderAdjustment[]
  admin_graphql_api_id?: string
}

/**
 * Refund line item
 */
export interface RefundLineItem {
  id: number
  line_item_id: number
  line_item: LineItem
  quantity: number
  restock_type: 'no_restock' | 'cancel' | 'return' | 'legacy_restock'
  location_id: number | null
  subtotal: number
  subtotal_set: MoneyBag
  total_tax: number
  total_tax_set: MoneyBag
}

/**
 * Order adjustment
 */
export interface OrderAdjustment {
  id: number
  order_id: number
  refund_id: number
  amount: string
  tax_amount: string
  kind: 'shipping_refund' | 'refund_discrepancy'
  reason: string
}

/**
 * Transaction
 */
export interface Transaction {
  id: number
  order_id: number
  kind: 'authorization' | 'capture' | 'sale' | 'void' | 'refund'
  amount: string
  status: 'pending' | 'failure' | 'success' | 'error'
  gateway: string
  created_at: string
  test: boolean
  authorization?: string
  currency?: string
  error_code?: string
  message?: string
  parent_id?: number
  processed_at?: string
  receipt?: Record<string, unknown>
  source_name?: string
  admin_graphql_api_id?: string
}

/**
 * Money bag (multi-currency support)
 */
export interface MoneyBag {
  shop_money: Money
  presentment_money: Money
}

/**
 * Money amount
 */
export interface Money {
  amount: string
  currency_code: string
}

/**
 * Input for creating a refund
 */
export interface RefundInput {
  refund_line_items?: RefundLineItemInput[]
  shipping?: { full_refund?: boolean; amount?: string }
  note?: string
  notify?: boolean
  currency?: string
}

/**
 * Input for refund line item
 */
export interface RefundLineItemInput {
  line_item_id: number
  quantity: number
  restock_type?: 'no_restock' | 'cancel' | 'return' | 'legacy_restock'
  location_id?: number
}

/**
 * Input for calculating a refund
 */
export interface RefundCalculateInput {
  refund_line_items?: RefundLineItemInput[]
  shipping?: { full_refund?: boolean; amount?: string }
}

// =============================================================================
// Customer Types
// =============================================================================

/**
 * Shopify Customer
 */
export interface Customer {
  id: number
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  verified_email: boolean
  accepts_marketing: boolean
  accepts_marketing_updated_at: string | null
  marketing_opt_in_level: 'single_opt_in' | 'confirmed_opt_in' | 'unknown' | null
  state: 'disabled' | 'invited' | 'enabled' | 'declined'
  tags: string
  currency: string
  tax_exempt: boolean
  tax_exemptions: string[]
  created_at: string
  updated_at: string
  orders_count: number
  total_spent: string
  last_order_id: number | null
  last_order_name: string | null
  note: string | null
  addresses: CustomerAddress[]
  default_address: CustomerAddress | null
  admin_graphql_api_id?: string
}

/**
 * Customer address
 */
export interface CustomerAddress {
  id: number
  customer_id: number
  first_name: string | null
  last_name: string | null
  company: string | null
  address1: string | null
  address2: string | null
  city: string | null
  province: string | null
  country: string | null
  zip: string | null
  phone: string | null
  name: string
  province_code: string | null
  country_code: string | null
  country_name: string | null
  default: boolean
}

/**
 * Generic address
 */
export interface Address {
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  address1?: string | null
  address2?: string | null
  city?: string | null
  province?: string | null
  province_code?: string | null
  country?: string | null
  country_code?: string | null
  zip?: string | null
  phone?: string | null
  name?: string
  latitude?: number
  longitude?: number
}

/**
 * Input for creating a customer
 */
export interface CustomerInput {
  email?: string
  first_name?: string
  last_name?: string
  phone?: string
  verified_email?: boolean
  accepts_marketing?: boolean
  note?: string
  tags?: string
  tax_exempt?: boolean
  tax_exemptions?: string[]
  addresses?: AddressInput[]
  send_email_invite?: boolean
  send_email_welcome?: boolean
  password?: string
  password_confirmation?: string
}

/**
 * Input for updating a customer
 */
export interface CustomerUpdateInput {
  email?: string
  first_name?: string
  last_name?: string
  phone?: string
  verified_email?: boolean
  accepts_marketing?: boolean
  note?: string
  tags?: string
  tax_exempt?: boolean
  tax_exemptions?: string[]
  addresses?: AddressInput[]
  state?: 'enabled' | 'disabled'
}

/**
 * Input for creating/updating an address
 */
export interface AddressInput {
  id?: number
  first_name?: string
  last_name?: string
  company?: string
  address1?: string
  address2?: string
  city?: string
  province?: string
  province_code?: string
  country?: string
  country_code?: string
  zip?: string
  phone?: string
  default?: boolean
}

// =============================================================================
// Inventory Types
// =============================================================================

/**
 * Shopify Location
 */
export interface Location {
  id: number
  name: string
  address1: string | null
  address2: string | null
  city: string | null
  province: string | null
  country: string
  zip: string | null
  phone: string | null
  country_code: string
  country_name: string
  province_code: string | null
  legacy: boolean
  active: boolean
  admin_graphql_api_id: string
  localized_country_name: string
  localized_province_name: string | null
  created_at: string
  updated_at: string
}

/**
 * Inventory level
 */
export interface InventoryLevel {
  inventory_item_id: number
  location_id: number
  available: number | null
  updated_at: string
  admin_graphql_api_id: string
}

/**
 * Inventory item
 */
export interface InventoryItem {
  id: number
  sku: string | null
  created_at: string
  updated_at: string
  requires_shipping: boolean
  cost: string | null
  country_code_of_origin: string | null
  province_code_of_origin: string | null
  harmonized_system_code: string | null
  tracked: boolean
  country_harmonized_system_codes: CountryHarmonizedSystemCode[]
  admin_graphql_api_id: string
}

/**
 * Country harmonized system code
 */
export interface CountryHarmonizedSystemCode {
  harmonized_system_code: string
  country_code: string
}

/**
 * Input for adjusting inventory level
 */
export interface InventoryAdjustInput {
  inventory_item_id: number
  location_id: number
  available_adjustment: number
}

/**
 * Input for setting inventory level
 */
export interface InventorySetInput {
  inventory_item_id: number
  location_id: number
  available: number
}

// =============================================================================
// GraphQL Types
// =============================================================================

/**
 * GraphQL query options
 */
export interface GraphqlQueryOptions {
  query: string
  variables?: Record<string, unknown>
}

/**
 * GraphQL response
 */
export interface GraphqlResponse<T = Record<string, unknown>> {
  data: T
  errors?: GraphqlError[]
  extensions?: Record<string, unknown>
}

/**
 * GraphQL error
 */
export interface GraphqlError {
  message: string
  locations?: Array<{ line: number; column: number }>
  path?: string[]
  extensions?: Record<string, unknown>
}

// =============================================================================
// Webhook Types
// =============================================================================

/**
 * Webhook validation params
 */
export interface WebhookValidateParams {
  rawBody: string | ArrayBuffer
  hmac: string
  secret: string
}

// =============================================================================
// List Response Types
// =============================================================================

/**
 * List response for products
 */
export interface ProductListResponse {
  products: Product[]
}

/**
 * List response for orders
 */
export interface OrderListResponse {
  orders: Order[]
}

/**
 * List response for customers
 */
export interface CustomerListResponse {
  customers: Customer[]
}

/**
 * List response for addresses
 */
export interface AddressListResponse {
  addresses: CustomerAddress[]
}

/**
 * List response for locations
 */
export interface LocationListResponse {
  locations: Location[]
}

/**
 * Count response
 */
export interface CountResponse {
  count: number
}
