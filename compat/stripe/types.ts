/**
 * @dotdo/stripe - Stripe API Type Definitions
 *
 * Type definitions for Stripe API compatibility layer.
 * Based on Stripe API v2024-12-18.acacia
 *
 * @module @dotdo/stripe/types
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Metadata can contain up to 50 keys with string values
 */
export type Metadata = Record<string, string>

/**
 * Address object used across Stripe APIs
 */
export interface Address {
  city?: string | null
  country?: string | null
  line1?: string | null
  line2?: string | null
  postal_code?: string | null
  state?: string | null
}

/**
 * Shipping details
 */
export interface Shipping {
  address?: Address
  carrier?: string | null
  name?: string | null
  phone?: string | null
  tracking_number?: string | null
}

/**
 * List response wrapper for paginated resources
 */
export interface ListResponse<T> {
  object: 'list'
  data: T[]
  has_more: boolean
  url: string
}

/**
 * Common list parameters for paginated endpoints
 */
export interface ListParams {
  /** A cursor for pagination */
  starting_after?: string
  /** A cursor for pagination (going backwards) */
  ending_before?: string
  /** Maximum number of items to return (1-100) */
  limit?: number
}

/**
 * Deleted object response
 */
export interface DeletedObject {
  id: string
  object: string
  deleted: true
}

// =============================================================================
// Customer Types
// =============================================================================

/**
 * Stripe Customer object
 */
export interface Customer {
  id: string
  object: 'customer'
  address?: Address | null
  balance: number
  created: number
  currency?: string | null
  default_source?: string | null
  delinquent?: boolean | null
  description?: string | null
  discount?: Discount | null
  email?: string | null
  invoice_prefix?: string | null
  invoice_settings?: CustomerInvoiceSettings
  livemode: boolean
  metadata: Metadata
  name?: string | null
  phone?: string | null
  preferred_locales?: string[]
  shipping?: Shipping | null
  tax_exempt?: 'none' | 'exempt' | 'reverse' | null
  test_clock?: string | null
}

/**
 * Customer invoice settings
 */
export interface CustomerInvoiceSettings {
  custom_fields?: Array<{ name: string; value: string }> | null
  default_payment_method?: string | null
  footer?: string | null
  rendering_options?: {
    amount_tax_display?: 'exclude_tax' | 'include_inclusive_tax' | null
  } | null
}

/**
 * Parameters for creating a customer
 */
export interface CustomerCreateParams {
  address?: Address
  balance?: number
  description?: string
  email?: string
  metadata?: Metadata
  name?: string
  payment_method?: string
  phone?: string
  preferred_locales?: string[]
  shipping?: Shipping
  source?: string
  tax_exempt?: 'none' | 'exempt' | 'reverse'
}

/**
 * Parameters for updating a customer
 */
export interface CustomerUpdateParams {
  address?: Address | ''
  balance?: number
  description?: string | ''
  email?: string | ''
  metadata?: Metadata | ''
  name?: string | ''
  phone?: string | ''
  preferred_locales?: string[]
  shipping?: Shipping | ''
  source?: string
  tax_exempt?: 'none' | 'exempt' | 'reverse' | ''
  default_source?: string
  invoice_settings?: CustomerInvoiceSettings
}

/**
 * Parameters for listing customers
 */
export interface CustomerListParams extends ListParams {
  email?: string
  created?: RangeQueryParam
}

/**
 * Deleted customer response
 */
export interface DeletedCustomer extends DeletedObject {
  object: 'customer'
}

// =============================================================================
// Subscription Types
// =============================================================================

/**
 * Stripe Subscription object
 */
export interface Subscription {
  id: string
  object: 'subscription'
  application?: string | null
  application_fee_percent?: number | null
  automatic_tax?: {
    enabled: boolean
    liability?: { type: string; account?: string } | null
  }
  billing_cycle_anchor: number
  billing_thresholds?: {
    amount_gte?: number | null
    reset_billing_cycle_anchor?: boolean | null
  } | null
  cancel_at?: number | null
  cancel_at_period_end: boolean
  canceled_at?: number | null
  cancellation_details?: {
    comment?: string | null
    feedback?: string | null
    reason?: string | null
  } | null
  collection_method: 'charge_automatically' | 'send_invoice'
  created: number
  currency: string
  current_period_end: number
  current_period_start: number
  customer: string
  days_until_due?: number | null
  default_payment_method?: string | null
  default_source?: string | null
  description?: string | null
  discount?: Discount | null
  ended_at?: number | null
  items: ListResponse<SubscriptionItem>
  latest_invoice?: string | null
  livemode: boolean
  metadata: Metadata
  next_pending_invoice_item_invoice?: number | null
  on_behalf_of?: string | null
  pause_collection?: {
    behavior: 'keep_as_draft' | 'mark_uncollectible' | 'void'
    resumes_at?: number | null
  } | null
  payment_settings?: SubscriptionPaymentSettings | null
  pending_invoice_item_interval?: {
    interval: 'day' | 'week' | 'month' | 'year'
    interval_count: number
  } | null
  pending_setup_intent?: string | null
  pending_update?: {
    billing_cycle_anchor?: number | null
    expires_at: number
    subscription_items?: SubscriptionItem[]
    trial_end?: number | null
    trial_from_plan?: boolean | null
  } | null
  schedule?: string | null
  start_date: number
  status: SubscriptionStatus
  test_clock?: string | null
  transfer_data?: {
    amount_percent?: number | null
    destination: string
  } | null
  trial_end?: number | null
  trial_settings?: {
    end_behavior: { missing_payment_method: 'cancel' | 'create_invoice' | 'pause' }
  } | null
  trial_start?: number | null
}

export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'paused'
  | 'trialing'
  | 'unpaid'

/**
 * Subscription item
 */
export interface SubscriptionItem {
  id: string
  object: 'subscription_item'
  billing_thresholds?: { usage_gte: number } | null
  created: number
  metadata: Metadata
  price: Price
  quantity?: number
  subscription: string
  tax_rates?: TaxRate[] | null
}

/**
 * Subscription payment settings
 */
export interface SubscriptionPaymentSettings {
  payment_method_options?: {
    acss_debit?: object
    bancontact?: object
    card?: object
    customer_balance?: object
    konbini?: object
    us_bank_account?: object
  } | null
  payment_method_types?: string[] | null
  save_default_payment_method?: 'off' | 'on_subscription' | null
}

/**
 * Parameters for creating a subscription
 */
export interface SubscriptionCreateParams {
  customer: string
  items: Array<{
    price?: string
    price_data?: PriceData
    quantity?: number
    metadata?: Metadata
    tax_rates?: string[]
  }>
  cancel_at_period_end?: boolean
  collection_method?: 'charge_automatically' | 'send_invoice'
  currency?: string
  default_payment_method?: string
  default_source?: string
  description?: string
  metadata?: Metadata
  off_session?: boolean
  payment_behavior?: 'allow_incomplete' | 'default_incomplete' | 'error_if_incomplete' | 'pending_if_incomplete'
  payment_settings?: SubscriptionPaymentSettings
  proration_behavior?: 'always_invoice' | 'create_prorations' | 'none'
  trial_end?: number | 'now'
  trial_period_days?: number
  trial_settings?: {
    end_behavior: { missing_payment_method: 'cancel' | 'create_invoice' | 'pause' }
  }
}

/**
 * Parameters for updating a subscription
 */
export interface SubscriptionUpdateParams {
  cancel_at_period_end?: boolean
  collection_method?: 'charge_automatically' | 'send_invoice'
  default_payment_method?: string
  default_source?: string
  description?: string | ''
  items?: Array<{
    id?: string
    price?: string
    price_data?: PriceData
    quantity?: number
    clear_usage?: boolean
    deleted?: boolean
    metadata?: Metadata
    tax_rates?: string[]
  }>
  metadata?: Metadata | ''
  off_session?: boolean
  pause_collection?: { behavior: 'keep_as_draft' | 'mark_uncollectible' | 'void'; resumes_at?: number } | ''
  payment_behavior?: 'allow_incomplete' | 'default_incomplete' | 'error_if_incomplete' | 'pending_if_incomplete'
  payment_settings?: SubscriptionPaymentSettings
  proration_behavior?: 'always_invoice' | 'create_prorations' | 'none'
  proration_date?: number
  trial_end?: number | 'now'
  trial_settings?: {
    end_behavior: { missing_payment_method: 'cancel' | 'create_invoice' | 'pause' }
  }
}

/**
 * Parameters for listing subscriptions
 */
export interface SubscriptionListParams extends ListParams {
  customer?: string
  price?: string
  status?: SubscriptionStatus | 'all' | 'ended'
  created?: RangeQueryParam
  current_period_end?: RangeQueryParam
  current_period_start?: RangeQueryParam
}

/**
 * Parameters for canceling a subscription
 */
export interface SubscriptionCancelParams {
  cancellation_details?: {
    comment?: string
    feedback?: 'customer_service' | 'low_quality' | 'missing_features' | 'other' | 'switched_service' | 'too_complex' | 'too_expensive' | 'unused'
  }
  invoice_now?: boolean
  prorate?: boolean
}

// =============================================================================
// Payment Intent Types
// =============================================================================

/**
 * Stripe PaymentIntent object
 */
export interface PaymentIntent {
  id: string
  object: 'payment_intent'
  amount: number
  amount_capturable: number
  amount_details?: {
    tip?: { amount: number }
  }
  amount_received: number
  application?: string | null
  application_fee_amount?: number | null
  automatic_payment_methods?: {
    allow_redirects?: 'always' | 'never'
    enabled: boolean
  } | null
  canceled_at?: number | null
  cancellation_reason?: PaymentIntentCancellationReason | null
  capture_method: 'automatic' | 'automatic_async' | 'manual'
  client_secret?: string | null
  confirmation_method: 'automatic' | 'manual'
  created: number
  currency: string
  customer?: string | null
  description?: string | null
  invoice?: string | null
  last_payment_error?: PaymentError | null
  latest_charge?: string | null
  livemode: boolean
  metadata: Metadata
  next_action?: PaymentIntentNextAction | null
  on_behalf_of?: string | null
  payment_method?: string | null
  payment_method_configuration_details?: {
    id: string
    parent?: string | null
  } | null
  payment_method_options?: Record<string, unknown> | null
  payment_method_types: string[]
  processing?: {
    card?: {
      customer_notification?: {
        approval_requested?: boolean | null
        completes_at?: number | null
      }
    }
  } | null
  receipt_email?: string | null
  review?: string | null
  setup_future_usage?: 'off_session' | 'on_session' | null
  shipping?: Shipping | null
  statement_descriptor?: string | null
  statement_descriptor_suffix?: string | null
  status: PaymentIntentStatus
  transfer_data?: {
    amount?: number
    destination: string
  } | null
  transfer_group?: string | null
}

export type PaymentIntentStatus =
  | 'canceled'
  | 'processing'
  | 'requires_action'
  | 'requires_capture'
  | 'requires_confirmation'
  | 'requires_payment_method'
  | 'succeeded'

export type PaymentIntentCancellationReason =
  | 'abandoned'
  | 'automatic'
  | 'duplicate'
  | 'failed_invoice'
  | 'fraudulent'
  | 'requested_by_customer'
  | 'void_invoice'

/**
 * Payment intent next action
 */
export interface PaymentIntentNextAction {
  redirect_to_url?: {
    return_url?: string | null
    url?: string | null
  }
  type: string
  use_stripe_sdk?: Record<string, unknown>
}

/**
 * Payment error
 */
export interface PaymentError {
  charge?: string
  code?: string
  decline_code?: string
  doc_url?: string
  message?: string
  param?: string
  payment_intent?: PaymentIntent
  payment_method?: PaymentMethod
  payment_method_type?: string
  request_log_url?: string
  setup_intent?: SetupIntent
  source?: object
  type: 'api_error' | 'card_error' | 'idempotency_error' | 'invalid_request_error'
}

/**
 * Parameters for creating a payment intent
 */
export interface PaymentIntentCreateParams {
  amount: number
  currency: string
  automatic_payment_methods?: {
    allow_redirects?: 'always' | 'never'
    enabled: boolean
  }
  capture_method?: 'automatic' | 'automatic_async' | 'manual'
  confirm?: boolean
  confirmation_method?: 'automatic' | 'manual'
  customer?: string
  description?: string
  metadata?: Metadata
  off_session?: boolean | 'one_off' | 'recurring'
  payment_method?: string
  payment_method_options?: Record<string, unknown>
  payment_method_types?: string[]
  receipt_email?: string
  return_url?: string
  setup_future_usage?: 'off_session' | 'on_session'
  shipping?: Shipping
  statement_descriptor?: string
  statement_descriptor_suffix?: string
  transfer_data?: { amount?: number; destination: string }
  transfer_group?: string
}

/**
 * Parameters for updating a payment intent
 */
export interface PaymentIntentUpdateParams {
  amount?: number
  currency?: string
  customer?: string
  description?: string | ''
  metadata?: Metadata | ''
  payment_method?: string
  payment_method_options?: Record<string, unknown>
  payment_method_types?: string[]
  receipt_email?: string | ''
  setup_future_usage?: 'off_session' | 'on_session' | ''
  shipping?: Shipping | ''
  statement_descriptor?: string
  statement_descriptor_suffix?: string
  transfer_data?: { amount?: number }
  transfer_group?: string
}

/**
 * Parameters for confirming a payment intent
 */
export interface PaymentIntentConfirmParams {
  capture_method?: 'automatic' | 'automatic_async' | 'manual'
  error_on_requires_action?: boolean
  mandate?: string
  mandate_data?: {
    customer_acceptance: {
      accepted_at?: number
      offline?: object
      online?: { ip_address: string; user_agent: string }
      type: 'offline' | 'online'
    }
  }
  off_session?: boolean | 'one_off' | 'recurring'
  payment_method?: string
  payment_method_data?: PaymentMethodData
  payment_method_options?: Record<string, unknown>
  receipt_email?: string
  return_url?: string
  setup_future_usage?: 'off_session' | 'on_session' | ''
  shipping?: Shipping
}

/**
 * Parameters for capturing a payment intent
 */
export interface PaymentIntentCaptureParams {
  amount_to_capture?: number
  application_fee_amount?: number
  final_capture?: boolean
  metadata?: Metadata
  statement_descriptor?: string
  statement_descriptor_suffix?: string
  transfer_data?: { amount?: number }
}

/**
 * Parameters for canceling a payment intent
 */
export interface PaymentIntentCancelParams {
  cancellation_reason?: 'abandoned' | 'duplicate' | 'fraudulent' | 'requested_by_customer'
}

/**
 * Parameters for listing payment intents
 */
export interface PaymentIntentListParams extends ListParams {
  customer?: string
  created?: RangeQueryParam
}

// =============================================================================
// Charge Types
// =============================================================================

/**
 * Stripe Charge object
 */
export interface Charge {
  id: string
  object: 'charge'
  amount: number
  amount_captured: number
  amount_refunded: number
  application?: string | null
  application_fee?: string | null
  application_fee_amount?: number | null
  balance_transaction?: string | null
  billing_details: BillingDetails
  calculated_statement_descriptor?: string | null
  captured: boolean
  created: number
  currency: string
  customer?: string | null
  description?: string | null
  disputed: boolean
  failure_balance_transaction?: string | null
  failure_code?: string | null
  failure_message?: string | null
  fraud_details?: {
    stripe_report?: string
    user_report?: string
  } | null
  invoice?: string | null
  livemode: boolean
  metadata: Metadata
  on_behalf_of?: string | null
  outcome?: ChargeOutcome | null
  paid: boolean
  payment_intent?: string | null
  payment_method?: string | null
  payment_method_details?: PaymentMethodDetails | null
  receipt_email?: string | null
  receipt_number?: string | null
  receipt_url?: string | null
  refunded: boolean
  refunds?: ListResponse<Refund>
  review?: string | null
  shipping?: Shipping | null
  source?: object | null
  source_transfer?: string | null
  statement_descriptor?: string | null
  statement_descriptor_suffix?: string | null
  status: 'failed' | 'pending' | 'succeeded'
  transfer?: string | null
  transfer_data?: {
    amount?: number | null
    destination: string
  } | null
  transfer_group?: string | null
}

/**
 * Charge outcome details
 */
export interface ChargeOutcome {
  network_status?: string | null
  reason?: string | null
  risk_level?: string
  risk_score?: number
  rule?: string | { action: string; id: string; predicate: string }
  seller_message?: string | null
  type: string
}

/**
 * Billing details for a charge
 */
export interface BillingDetails {
  address?: Address | null
  email?: string | null
  name?: string | null
  phone?: string | null
}

/**
 * Payment method details on a charge
 */
export interface PaymentMethodDetails {
  card?: {
    brand?: string | null
    checks?: {
      address_line1_check?: string | null
      address_postal_code_check?: string | null
      cvc_check?: string | null
    } | null
    country?: string | null
    exp_month?: number
    exp_year?: number
    fingerprint?: string | null
    funding?: string | null
    installments?: object | null
    last4?: string | null
    network?: string | null
    three_d_secure?: object | null
    wallet?: object | null
  }
  type: string
  [key: string]: unknown
}

/**
 * Parameters for creating a charge (legacy - use PaymentIntents)
 */
export interface ChargeCreateParams {
  amount: number
  currency: string
  customer?: string
  description?: string
  metadata?: Metadata
  receipt_email?: string
  shipping?: Shipping
  source?: string
  statement_descriptor?: string
  statement_descriptor_suffix?: string
  capture?: boolean
  on_behalf_of?: string
  transfer_data?: { amount?: number; destination: string }
  transfer_group?: string
}

/**
 * Parameters for updating a charge
 */
export interface ChargeUpdateParams {
  customer?: string
  description?: string
  metadata?: Metadata | ''
  receipt_email?: string
  shipping?: Shipping
  fraud_details?: { user_report: 'fraudulent' | 'safe' }
  transfer_group?: string
}

/**
 * Parameters for capturing a charge
 */
export interface ChargeCaptureParams {
  amount?: number
  application_fee_amount?: number
  receipt_email?: string
  statement_descriptor?: string
  statement_descriptor_suffix?: string
  transfer_data?: { amount?: number }
  transfer_group?: string
}

/**
 * Parameters for listing charges
 */
export interface ChargeListParams extends ListParams {
  customer?: string
  created?: RangeQueryParam
  payment_intent?: string
  transfer_group?: string
}

// =============================================================================
// Refund Types
// =============================================================================

/**
 * Stripe Refund object
 */
export interface Refund {
  id: string
  object: 'refund'
  amount: number
  balance_transaction?: string | null
  charge?: string | null
  created: number
  currency: string
  description?: string | null
  failure_balance_transaction?: string | null
  failure_reason?: string | null
  instructions_email?: string | null
  metadata: Metadata
  next_action?: {
    display_details?: {
      email_sent: { email_sent_at: number; email_sent_to: string }
      expires_at: number
    }
    type: string
  } | null
  payment_intent?: string | null
  reason?: RefundReason | null
  receipt_number?: string | null
  source_transfer_reversal?: string | null
  status?: 'canceled' | 'failed' | 'pending' | 'requires_action' | 'succeeded' | null
  transfer_reversal?: string | null
}

export type RefundReason = 'duplicate' | 'fraudulent' | 'requested_by_customer'

/**
 * Parameters for creating a refund
 */
export interface RefundCreateParams {
  charge?: string
  payment_intent?: string
  amount?: number
  currency?: string
  instructions_email?: string
  metadata?: Metadata
  origin?: 'customer_balance'
  reason?: RefundReason
  refund_application_fee?: boolean
  reverse_transfer?: boolean
}

/**
 * Parameters for updating a refund
 */
export interface RefundUpdateParams {
  metadata?: Metadata | ''
}

/**
 * Parameters for listing refunds
 */
export interface RefundListParams extends ListParams {
  charge?: string
  payment_intent?: string
  created?: RangeQueryParam
}

// =============================================================================
// Payment Method Types
// =============================================================================

/**
 * Stripe PaymentMethod object
 */
export interface PaymentMethod {
  id: string
  object: 'payment_method'
  billing_details: BillingDetails
  card?: {
    brand: string
    checks?: {
      address_line1_check?: string | null
      address_postal_code_check?: string | null
      cvc_check?: string | null
    } | null
    country?: string | null
    exp_month: number
    exp_year: number
    fingerprint?: string | null
    funding: string
    generated_from?: object | null
    last4: string
    networks?: {
      available: string[]
      preferred?: string | null
    } | null
    three_d_secure_usage?: { supported: boolean } | null
    wallet?: object | null
  }
  created: number
  customer?: string | null
  livemode: boolean
  metadata: Metadata
  type: string
  [key: string]: unknown
}

/**
 * Payment method data for creating inline
 */
export interface PaymentMethodData {
  type: string
  billing_details?: BillingDetails
  metadata?: Metadata
  card?: {
    cvc?: string
    exp_month?: number
    exp_year?: number
    number?: string
    token?: string
  }
  [key: string]: unknown
}

// =============================================================================
// Setup Intent Types
// =============================================================================

/**
 * Stripe SetupIntent object (for saving payment methods)
 */
export interface SetupIntent {
  id: string
  object: 'setup_intent'
  application?: string | null
  automatic_payment_methods?: { allow_redirects?: 'always' | 'never'; enabled: boolean } | null
  cancellation_reason?: 'abandoned' | 'duplicate' | 'requested_by_customer' | null
  client_secret?: string | null
  created: number
  customer?: string | null
  description?: string | null
  flow_directions?: Array<'inbound' | 'outbound'> | null
  last_setup_error?: PaymentError | null
  latest_attempt?: string | null
  livemode: boolean
  mandate?: string | null
  metadata: Metadata
  next_action?: object | null
  on_behalf_of?: string | null
  payment_method?: string | null
  payment_method_configuration_details?: { id: string; parent?: string | null } | null
  payment_method_options?: Record<string, unknown> | null
  payment_method_types: string[]
  single_use_mandate?: string | null
  status: 'canceled' | 'processing' | 'requires_action' | 'requires_confirmation' | 'requires_payment_method' | 'succeeded'
  usage: string
}

// =============================================================================
// Price Types
// =============================================================================

/**
 * Stripe Price object
 */
export interface Price {
  id: string
  object: 'price'
  active: boolean
  billing_scheme: 'per_unit' | 'tiered'
  created: number
  currency: string
  currency_options?: Record<string, object> | null
  custom_unit_amount?: { maximum?: number | null; minimum?: number | null; preset?: number | null } | null
  livemode: boolean
  lookup_key?: string | null
  metadata: Metadata
  nickname?: string | null
  product: string
  recurring?: {
    aggregate_usage?: 'last_during_period' | 'last_ever' | 'max' | 'sum' | null
    interval: 'day' | 'week' | 'month' | 'year'
    interval_count: number
    usage_type: 'licensed' | 'metered'
  } | null
  tax_behavior?: 'exclusive' | 'inclusive' | 'unspecified' | null
  tiers?: Array<{
    flat_amount?: number | null
    flat_amount_decimal?: string | null
    unit_amount?: number | null
    unit_amount_decimal?: string | null
    up_to?: number | null
  }> | null
  tiers_mode?: 'graduated' | 'volume' | null
  transform_quantity?: { divide_by: number; round: 'down' | 'up' } | null
  type: 'one_time' | 'recurring'
  unit_amount?: number | null
  unit_amount_decimal?: string | null
}

/**
 * Price data for inline creation
 */
export interface PriceData {
  currency: string
  product?: string
  product_data?: {
    name: string
    active?: boolean
    metadata?: Metadata
    statement_descriptor?: string
    tax_code?: string
    unit_label?: string
  }
  recurring?: {
    interval: 'day' | 'week' | 'month' | 'year'
    interval_count?: number
  }
  tax_behavior?: 'exclusive' | 'inclusive' | 'unspecified'
  unit_amount?: number
  unit_amount_decimal?: string
}

// =============================================================================
// Tax Rate Types
// =============================================================================

/**
 * Stripe TaxRate object
 */
export interface TaxRate {
  id: string
  object: 'tax_rate'
  active: boolean
  country?: string | null
  created: number
  description?: string | null
  display_name: string
  effective_percentage?: number | null
  inclusive: boolean
  jurisdiction?: string | null
  jurisdiction_level?: 'city' | 'country' | 'county' | 'district' | 'multiple' | 'state' | null
  livemode: boolean
  metadata: Metadata
  percentage: number
  state?: string | null
  tax_type?: 'amusement_tax' | 'communications_tax' | 'gst' | 'hst' | 'igst' | 'jct' | 'lease_tax' | 'pst' | 'qst' | 'rst' | 'sales_tax' | 'vat' | null
}

// =============================================================================
// Discount Types
// =============================================================================

/**
 * Stripe Discount object
 */
export interface Discount {
  id: string
  object: 'discount'
  checkout_session?: string | null
  coupon: Coupon
  customer?: string | null
  end?: number | null
  invoice?: string | null
  invoice_item?: string | null
  promotion_code?: string | null
  start: number
  subscription?: string | null
  subscription_item?: string | null
}

/**
 * Stripe Coupon object
 */
export interface Coupon {
  id: string
  object: 'coupon'
  amount_off?: number | null
  applies_to?: { products: string[] } | null
  created: number
  currency?: string | null
  currency_options?: Record<string, { amount_off: number }> | null
  duration: 'forever' | 'once' | 'repeating'
  duration_in_months?: number | null
  livemode: boolean
  max_redemptions?: number | null
  metadata: Metadata
  name?: string | null
  percent_off?: number | null
  redeem_by?: number | null
  times_redeemed: number
  valid: boolean
}

// =============================================================================
// Webhook Types
// =============================================================================

/**
 * Stripe webhook event
 */
export interface WebhookEvent {
  id: string
  object: 'event'
  account?: string
  api_version?: string | null
  created: number
  data: {
    object: unknown
    previous_attributes?: Record<string, unknown>
  }
  livemode: boolean
  pending_webhooks: number
  request?: {
    id?: string | null
    idempotency_key?: string | null
  } | null
  type: WebhookEventType
}

/**
 * Common webhook event types
 */
export type WebhookEventType =
  // Customer events
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deleted'
  // Subscription events
  | 'customer.subscription.created'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'customer.subscription.paused'
  | 'customer.subscription.resumed'
  | 'customer.subscription.pending_update_applied'
  | 'customer.subscription.pending_update_expired'
  | 'customer.subscription.trial_will_end'
  // Payment Intent events
  | 'payment_intent.created'
  | 'payment_intent.succeeded'
  | 'payment_intent.canceled'
  | 'payment_intent.payment_failed'
  | 'payment_intent.processing'
  | 'payment_intent.requires_action'
  | 'payment_intent.amount_capturable_updated'
  // Charge events
  | 'charge.captured'
  | 'charge.expired'
  | 'charge.failed'
  | 'charge.pending'
  | 'charge.refunded'
  | 'charge.succeeded'
  | 'charge.updated'
  | 'charge.dispute.created'
  | 'charge.dispute.closed'
  | 'charge.dispute.funds_reinstated'
  | 'charge.dispute.funds_withdrawn'
  | 'charge.dispute.updated'
  | 'charge.refund.updated'
  // Invoice events
  | 'invoice.created'
  | 'invoice.finalized'
  | 'invoice.finalization_failed'
  | 'invoice.paid'
  | 'invoice.payment_action_required'
  | 'invoice.payment_failed'
  | 'invoice.payment_succeeded'
  | 'invoice.sent'
  | 'invoice.upcoming'
  | 'invoice.updated'
  | 'invoice.voided'
  | 'invoice.marked_uncollectible'
  // Checkout events
  | 'checkout.session.async_payment_failed'
  | 'checkout.session.async_payment_succeeded'
  | 'checkout.session.completed'
  | 'checkout.session.expired'
  // Generic string for other event types
  | string

// =============================================================================
// Error Types
// =============================================================================

/**
 * Stripe API error response
 */
export interface StripeError {
  type: 'api_error' | 'card_error' | 'idempotency_error' | 'invalid_request_error' | 'authentication_error' | 'rate_limit_error'
  message: string
  code?: string
  decline_code?: string
  doc_url?: string
  param?: string
  payment_intent?: PaymentIntent
  payment_method?: PaymentMethod
  charge?: string
  request_log_url?: string
}

/**
 * Stripe error response wrapper
 */
export interface StripeErrorResponse {
  error: StripeError
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Range query parameters for filtering by date/number
 */
export interface RangeQueryParam {
  gt?: number
  gte?: number
  lt?: number
  lte?: number
}

/**
 * Expand parameter for including related objects
 */
export type Expand = string[]

/**
 * Request options that can be passed to any API call
 */
export interface RequestOptions {
  /** API key to use for this request */
  apiKey?: string
  /** Idempotency key for safely retrying requests */
  idempotencyKey?: string
  /** Stripe account ID for Connect requests */
  stripeAccount?: string
  /** API version override */
  apiVersion?: string
  /** Maximum network retries */
  maxNetworkRetries?: number
  /** Request timeout in ms */
  timeout?: number
}
