/**
 * @dotdo/shopify - Shopify API Type Definitions
 *
 * Type definitions for Shopify API compatibility layer.
 * Based on Shopify Admin API 2024-10
 *
 * @module @dotdo/shopify/types
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
 * Shopify API configuration options
 */
export interface ShopifyConfig {
  /** Shopify API key (client ID) */
  apiKey: string
  /** Shopify API secret key (client secret) */
  apiSecretKey: string
  /** OAuth scopes requested */
  scopes: string[]
  /** Shop hostname (e.g., 'myshop.myshopify.com') */
  hostName: string
  /** API version to use (default: LATEST_API_VERSION) */
  apiVersion?: string
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Maximum number of retries for failed requests */
  retries?: number
  /** Request timeout in milliseconds */
  timeout?: number
  /** Enable debug logging */
  debug?: boolean
}

/**
 * Internal resolved configuration
 */
export interface ResolvedConfig extends Required<Omit<ShopifyConfig, 'fetch'>> {
  fetch: typeof fetch
}

// =============================================================================
// Session Types
// =============================================================================

/**
 * Shopify session containing authentication information
 */
export interface Session {
  /** Unique session identifier */
  id: string
  /** Shop domain */
  shop: string
  /** State parameter used during OAuth */
  state: string
  /** Whether this is an online (user-specific) session */
  isOnline: boolean
  /** Access token for API requests */
  accessToken?: string
  /** Granted OAuth scopes */
  scope?: string
  /** Token expiration timestamp (for online tokens) */
  expires?: Date
  /** Online access information (for online tokens) */
  onlineAccessInfo?: OnlineAccessInfo
}

/**
 * Online access token information
 */
export interface OnlineAccessInfo {
  /** Token expiration in seconds */
  expiresIn: number
  /** Associated user scopes */
  associatedUserScope: string
  /** Associated user information */
  associatedUser: AssociatedUser
}

/**
 * User associated with an online access token
 */
export interface AssociatedUser {
  id: number
  first_name: string
  last_name: string
  email: string
  email_verified: boolean
  account_owner: boolean
  locale: string
  collaborator: boolean
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

// =============================================================================
// Webhook Types
// =============================================================================

/**
 * Webhook subscription
 */
export interface Webhook {
  id: number
  address: string
  topic: WebhookTopic
  format: 'json' | 'xml'
  created_at: string
  updated_at: string
  fields?: string[]
  metafield_namespaces?: string[]
  private_metafield_namespaces?: string[]
  api_version?: string
}

/**
 * Webhook subscription (alias for compatibility)
 */
export type WebhookSubscription = Webhook

/**
 * Common webhook topics
 */
export type WebhookTopic =
  // App topics
  | 'app/uninstalled'
  // Cart topics
  | 'carts/create'
  | 'carts/update'
  // Checkout topics
  | 'checkouts/create'
  | 'checkouts/delete'
  | 'checkouts/update'
  // Collection topics
  | 'collections/create'
  | 'collections/delete'
  | 'collections/update'
  // Customer topics
  | 'customers/create'
  | 'customers/delete'
  | 'customers/disable'
  | 'customers/enable'
  | 'customers/update'
  // Draft order topics
  | 'draft_orders/create'
  | 'draft_orders/delete'
  | 'draft_orders/update'
  // Fulfillment topics
  | 'fulfillments/create'
  | 'fulfillments/update'
  // Inventory topics
  | 'inventory_items/create'
  | 'inventory_items/delete'
  | 'inventory_items/update'
  | 'inventory_levels/connect'
  | 'inventory_levels/disconnect'
  | 'inventory_levels/update'
  // Location topics
  | 'locations/create'
  | 'locations/delete'
  | 'locations/update'
  // Order topics
  | 'orders/cancelled'
  | 'orders/create'
  | 'orders/delete'
  | 'orders/edited'
  | 'orders/fulfilled'
  | 'orders/paid'
  | 'orders/partially_fulfilled'
  | 'orders/updated'
  // Product topics
  | 'products/create'
  | 'products/delete'
  | 'products/update'
  // Refund topics
  | 'refunds/create'
  // Shop topics
  | 'shop/update'
  // Subscription topics
  | 'subscription_billing_attempts/challenged'
  | 'subscription_billing_attempts/failure'
  | 'subscription_billing_attempts/success'
  | 'subscription_contracts/create'
  | 'subscription_contracts/update'
  // Theme topics
  | 'themes/create'
  | 'themes/delete'
  | 'themes/publish'
  | 'themes/update'
  // Generic string for custom topics
  | string

// =============================================================================
// REST Client Types
// =============================================================================

/**
 * REST client response
 */
export interface RestResponse<T = unknown> {
  body: T
  headers: Headers
}

/**
 * REST request options
 */
export interface RestRequestOptions {
  /** API path (without /admin/api/{version}/) */
  path: string
  /** Query parameters */
  query?: Record<string, string | number | boolean | undefined>
  /** Request body data */
  data?: unknown
  /** Extra headers */
  extraHeaders?: Record<string, string>
  /** Number of retries */
  retries?: number
}

// =============================================================================
// GraphQL Client Types
// =============================================================================

/**
 * GraphQL response
 */
export interface GraphqlResponse<T = unknown> {
  body: {
    data: T | null
    errors?: GraphqlError[]
    extensions?: Record<string, unknown>
  }
  headers: Headers
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

/**
 * GraphQL query options
 */
export interface GraphqlQueryOptions {
  data: string | { query: string; variables?: Record<string, unknown> }
  extraHeaders?: Record<string, string>
}

// =============================================================================
// Auth Types
// =============================================================================

/**
 * Token exchange parameters
 */
export interface TokenExchangeParams {
  shop: string
  code: string
  isOnline?: boolean
}

/**
 * Token exchange response from Shopify
 */
export interface TokenExchangeResponse {
  access_token: string
  scope: string
  expires_in?: number
  associated_user_scope?: string
  associated_user?: AssociatedUser
}

/**
 * Authorization URL parameters
 */
export interface AuthorizationUrlParams {
  shop: string
  redirectUri: string
  state?: string
  isOnline?: boolean
}

/**
 * Authorization URL result
 */
export interface AuthorizationUrlResult {
  url: string
  state: string
}

// =============================================================================
// Webhook Validation Types
// =============================================================================

/**
 * Webhook validation parameters
 */
export interface WebhookValidateParams {
  rawBody: string | ArrayBuffer
  hmac: string
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Shopify API error
 */
export interface ShopifyError {
  message: string
  code?: string
  statusCode?: number
  requestId?: string
}

/**
 * Shopify API error response
 */
export interface ShopifyErrorResponse {
  errors: string | Record<string, string[]>
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Pagination parameters
 */
export interface PaginationParams {
  limit?: number
  since_id?: number
  page_info?: string
  fields?: string
}

/**
 * List response with pagination info
 */
export interface ListResponse<T> {
  data: T[]
  pageInfo?: {
    hasNextPage: boolean
    hasPreviousPage: boolean
    startCursor?: string
    endCursor?: string
  }
}

// =============================================================================
// Flow Types (Shopify Flow Automation)
// =============================================================================

/**
 * Flow trigger types - events that can start a workflow
 */
export type FlowTriggerType =
  | 'order_created'
  | 'order_paid'
  | 'order_fulfilled'
  | 'order_cancelled'
  | 'order_refunded'
  | 'customer_created'
  | 'customer_updated'
  | 'customer_deleted'
  | 'product_created'
  | 'product_updated'
  | 'product_deleted'
  | 'inventory_level_updated'
  | 'fulfillment_created'
  | 'refund_created'
  | 'checkout_created'
  | 'checkout_updated'
  | 'draft_order_created'
  | 'collection_created'
  | 'collection_updated'
  | 'scheduled'
  | 'manual'
  | string

/**
 * Flow trigger definition
 */
export interface FlowTrigger {
  id: string
  type: FlowTriggerType
  title: string
  description?: string
  /** Properties available from this trigger */
  outputSchema?: Record<string, FlowPropertyType>
  /** Schedule expression for scheduled triggers (cron format) */
  schedule?: string
  /** Custom trigger configuration */
  config?: Record<string, unknown>
}

/**
 * Flow property types for conditions and data mapping
 */
export type FlowPropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'money'
  | 'array'
  | 'object'

/**
 * Flow condition operators
 */
export type FlowConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'greater_than_or_equals'
  | 'less_than'
  | 'less_than_or_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_empty'
  | 'is_not_empty'
  | 'in'
  | 'not_in'
  | 'matches_regex'

/**
 * Flow condition - evaluates to true or false
 */
export interface FlowCondition {
  id: string
  /** Property path to evaluate (e.g., 'order.total_price', 'customer.tags') */
  property: string
  operator: FlowConditionOperator
  /** Value to compare against (not needed for is_empty/is_not_empty) */
  value?: unknown
  /** For nested conditions */
  and?: FlowCondition[]
  or?: FlowCondition[]
}

/**
 * Flow action types - operations that can be performed
 */
export type FlowActionType =
  // Order actions
  | 'add_order_tag'
  | 'remove_order_tag'
  | 'add_order_note'
  | 'capture_payment'
  | 'cancel_order'
  | 'create_fulfillment'
  | 'send_order_email'
  // Customer actions
  | 'add_customer_tag'
  | 'remove_customer_tag'
  | 'update_customer_metafield'
  | 'send_customer_email'
  // Product actions
  | 'add_product_tag'
  | 'remove_product_tag'
  | 'update_product_metafield'
  | 'hide_product'
  | 'publish_product'
  // Inventory actions
  | 'adjust_inventory'
  | 'set_inventory'
  // Notification actions
  | 'send_email'
  | 'send_slack_message'
  | 'send_webhook'
  | 'send_sms'
  // Data actions
  | 'set_variable'
  | 'transform_data'
  | 'lookup_metafield'
  // Control flow
  | 'wait'
  | 'loop'
  | 'branch'
  // Custom
  | 'custom'
  | string

/**
 * Flow action definition
 */
export interface FlowAction {
  id: string
  type: FlowActionType
  title?: string
  /** Input configuration for the action */
  input: Record<string, unknown>
  /** Conditions that must be met to execute this action */
  conditions?: FlowCondition[]
  /** Transform output data before passing to next action */
  outputMapping?: Record<string, string>
  /** Error handling configuration */
  onError?: 'continue' | 'stop' | 'retry'
  /** Maximum retry attempts if onError is 'retry' */
  maxRetries?: number
  /** Delay in milliseconds before retry */
  retryDelay?: number
}

/**
 * Flow workflow definition
 */
export interface FlowWorkflow {
  id: string
  title: string
  description?: string
  /** Whether the workflow is enabled */
  enabled: boolean
  /** Trigger that starts this workflow */
  trigger: FlowTrigger
  /** Conditions that must be met after trigger fires */
  conditions?: FlowCondition[]
  /** Actions to execute in sequence */
  actions: FlowAction[]
  /** Workflow metadata */
  createdAt: string
  updatedAt: string
  /** Version for optimistic locking */
  version: number
  /** Tags for organization */
  tags?: string[]
}

/**
 * Flow workflow template - pre-built workflow configurations
 */
export interface FlowWorkflowTemplate {
  id: string
  title: string
  description: string
  category: FlowTemplateCategory
  /** Template trigger configuration */
  trigger: Omit<FlowTrigger, 'id'>
  /** Template conditions */
  conditions?: Omit<FlowCondition, 'id'>[]
  /** Template actions */
  actions: Omit<FlowAction, 'id'>[]
  /** Variables that must be configured when using template */
  requiredVariables?: FlowTemplateVariable[]
  /** Estimated time to set up */
  setupTimeMinutes?: number
  /** Tags for filtering */
  tags?: string[]
}

/**
 * Flow template categories
 */
export type FlowTemplateCategory =
  | 'orders'
  | 'customers'
  | 'products'
  | 'inventory'
  | 'marketing'
  | 'fulfillment'
  | 'notifications'
  | 'integrations'
  | 'custom'

/**
 * Template variable definition
 */
export interface FlowTemplateVariable {
  name: string
  type: FlowPropertyType
  description: string
  required: boolean
  defaultValue?: unknown
}

/**
 * Flow execution status
 */
export type FlowExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting'

/**
 * Flow execution - represents a single workflow run
 */
export interface FlowExecution {
  id: string
  workflowId: string
  status: FlowExecutionStatus
  /** Trigger event that started the execution */
  triggerEvent: Record<string, unknown>
  /** Current step being executed */
  currentStep?: number
  /** Results from each executed action */
  stepResults: FlowStepResult[]
  /** Error information if failed */
  error?: FlowExecutionError
  /** Timestamps */
  startedAt: string
  completedAt?: string
  /** Duration in milliseconds */
  durationMs?: number
}

/**
 * Flow step result
 */
export interface FlowStepResult {
  actionId: string
  status: 'success' | 'failed' | 'skipped'
  output?: Record<string, unknown>
  error?: string
  startedAt: string
  completedAt: string
  durationMs: number
}

/**
 * Flow execution error
 */
export interface FlowExecutionError {
  message: string
  code?: string
  actionId?: string
  step?: number
  retryable: boolean
}
