/**
 * payments.do - Payment Platform Service Types
 *
 * Type definitions for multi-provider payment processing.
 * Stripe-compatible API with support for Paddle and LemonSqueezy.
 *
 * @module payments.do/types
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Metadata can contain up to 50 keys with string values
 */
export type Metadata = Record<string, string>

/**
 * Currency codes (ISO 4217)
 */
export type Currency = 'usd' | 'eur' | 'gbp' | 'jpy' | 'aud' | 'cad' | 'chf' | string

/**
 * Address object
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
 * List response wrapper for paginated resources
 */
export interface ListResponse<T> {
  object: 'list'
  data: T[]
  has_more: boolean
  url: string
}

// =============================================================================
// Provider Types
// =============================================================================

/**
 * Supported payment providers
 */
export type PaymentProvider = 'stripe' | 'paddle' | 'lemonsqueezy'

/**
 * Provider configuration
 */
export interface ProviderConfig {
  provider: PaymentProvider
  apiKey?: string
  secretKey?: string
  webhookSecret?: string
  sandbox?: boolean
  enabled?: boolean
  priority?: number // Lower = higher priority
  region?: string // For regional routing (e.g., 'eu' for Paddle)
}

/**
 * Provider routing rules
 */
export interface RoutingRule {
  condition: RoutingCondition
  provider: PaymentProvider
}

export type RoutingCondition =
  | { type: 'currency'; currencies: Currency[] }
  | { type: 'country'; countries: string[] }
  | { type: 'amount'; min?: number; max?: number }
  | { type: 'product_type'; types: ProductType[] }
  | { type: 'always' }

export type ProductType = 'physical' | 'digital' | 'subscription' | 'service'

// =============================================================================
// Customer Types
// =============================================================================

/**
 * Customer object
 */
export interface Customer {
  id: string
  object: 'customer'
  email?: string | null
  name?: string | null
  phone?: string | null
  address?: Address | null
  metadata: Metadata
  created: number
  updated: number
  provider_ids: Partial<Record<PaymentProvider, string>>
  default_payment_method?: string | null
  balance: number
  currency?: Currency | null
  delinquent: boolean
  livemode: boolean
}

export interface CustomerCreateParams {
  email?: string
  name?: string
  phone?: string
  address?: Address
  metadata?: Metadata
  payment_method?: string
}

export interface CustomerUpdateParams {
  email?: string | ''
  name?: string | ''
  phone?: string | ''
  address?: Address | ''
  metadata?: Metadata | ''
  default_payment_method?: string
}

// =============================================================================
// Payment Intent Types
// =============================================================================

export type PaymentIntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'processing'
  | 'requires_capture'
  | 'canceled'
  | 'succeeded'

export type CaptureMethod = 'automatic' | 'manual'

/**
 * Payment Intent object
 */
export interface PaymentIntent {
  id: string
  object: 'payment_intent'
  amount: number
  amount_capturable: number
  amount_received: number
  currency: Currency
  status: PaymentIntentStatus
  customer?: string | null
  description?: string | null
  metadata: Metadata
  payment_method?: string | null
  payment_method_types: string[]
  capture_method: CaptureMethod
  client_secret: string
  created: number
  livemode: boolean
  canceled_at?: number | null
  cancellation_reason?: PaymentIntentCancellationReason | null
  last_payment_error?: PaymentError | null
  provider: PaymentProvider
  provider_id?: string | null
  receipt_email?: string | null
  statement_descriptor?: string | null
}

export type PaymentIntentCancellationReason =
  | 'abandoned'
  | 'automatic'
  | 'duplicate'
  | 'failed_invoice'
  | 'fraudulent'
  | 'requested_by_customer'

export interface PaymentError {
  type: 'api_error' | 'card_error' | 'invalid_request_error'
  code?: string
  decline_code?: string
  message?: string
  param?: string
}

export interface PaymentIntentCreateParams {
  amount: number
  currency: Currency
  customer?: string
  description?: string
  metadata?: Metadata
  payment_method?: string
  payment_method_types?: string[]
  capture_method?: CaptureMethod
  receipt_email?: string
  statement_descriptor?: string
  confirm?: boolean
  provider?: PaymentProvider // Force specific provider
  return_url?: string
}

export interface PaymentIntentConfirmParams {
  payment_method?: string
  return_url?: string
}

export interface PaymentIntentCaptureParams {
  amount_to_capture?: number
}

export interface PaymentIntentCancelParams {
  cancellation_reason?: PaymentIntentCancellationReason
}

// =============================================================================
// Subscription Types
// =============================================================================

export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'paused'
  | 'trialing'
  | 'unpaid'

export type CollectionMethod = 'charge_automatically' | 'send_invoice'

export type ProrationBehavior = 'always_invoice' | 'create_prorations' | 'none'

/**
 * Subscription object
 */
export interface Subscription {
  id: string
  object: 'subscription'
  customer: string
  status: SubscriptionStatus
  items: SubscriptionItem[]
  current_period_start: number
  current_period_end: number
  cancel_at_period_end: boolean
  canceled_at?: number | null
  ended_at?: number | null
  trial_start?: number | null
  trial_end?: number | null
  metadata: Metadata
  default_payment_method?: string | null
  collection_method: CollectionMethod
  created: number
  livemode: boolean
  provider: PaymentProvider
  provider_id?: string | null
}

export interface SubscriptionItem {
  id: string
  object: 'subscription_item'
  price: Price
  quantity: number
  created: number
  metadata: Metadata
}

export interface SubscriptionCreateParams {
  customer: string
  items: Array<{
    price?: string
    price_data?: PriceData
    quantity?: number
  }>
  default_payment_method?: string
  collection_method?: CollectionMethod
  trial_period_days?: number
  trial_end?: number | 'now'
  cancel_at_period_end?: boolean
  proration_behavior?: ProrationBehavior
  metadata?: Metadata
  provider?: PaymentProvider
}

export interface SubscriptionUpdateParams {
  items?: Array<{
    id?: string
    price?: string
    quantity?: number
    deleted?: boolean
  }>
  default_payment_method?: string
  cancel_at_period_end?: boolean
  proration_behavior?: ProrationBehavior
  trial_end?: number | 'now'
  metadata?: Metadata | ''
}

export interface SubscriptionCancelParams {
  invoice_now?: boolean
  prorate?: boolean
  cancellation_details?: {
    comment?: string
    feedback?: SubscriptionCancellationFeedback
  }
}

export type SubscriptionCancellationFeedback =
  | 'customer_service'
  | 'low_quality'
  | 'missing_features'
  | 'other'
  | 'switched_service'
  | 'too_complex'
  | 'too_expensive'
  | 'unused'

// =============================================================================
// Price Types
// =============================================================================

export type PriceType = 'one_time' | 'recurring'

export type BillingScheme = 'per_unit' | 'tiered'

export type RecurringInterval = 'day' | 'week' | 'month' | 'year'

export interface Price {
  id: string
  object: 'price'
  active: boolean
  currency: Currency
  unit_amount: number | null
  unit_amount_decimal?: string | null
  type: PriceType
  billing_scheme: BillingScheme
  recurring?: {
    interval: RecurringInterval
    interval_count: number
  } | null
  product: string
  metadata: Metadata
  created: number
  livemode: boolean
}

export interface PriceData {
  currency: Currency
  product?: string
  product_data?: {
    name: string
    metadata?: Metadata
  }
  unit_amount?: number
  recurring?: {
    interval: RecurringInterval
    interval_count?: number
  }
}

// =============================================================================
// Payment Method Types
// =============================================================================

export type PaymentMethodType = 'card' | 'bank_account' | 'paypal' | string

export interface PaymentMethod {
  id: string
  object: 'payment_method'
  type: PaymentMethodType
  customer?: string | null
  billing_details: {
    address?: Address | null
    email?: string | null
    name?: string | null
    phone?: string | null
  }
  card?: {
    brand: string
    last4: string
    exp_month: number
    exp_year: number
    funding: 'credit' | 'debit' | 'prepaid' | 'unknown'
  }
  created: number
  livemode: boolean
  metadata: Metadata
}

// =============================================================================
// Refund Types
// =============================================================================

export type RefundStatus = 'pending' | 'succeeded' | 'failed' | 'canceled'

export type RefundReason = 'duplicate' | 'fraudulent' | 'requested_by_customer'

export interface Refund {
  id: string
  object: 'refund'
  amount: number
  currency: Currency
  payment_intent: string
  status: RefundStatus
  reason?: RefundReason | null
  created: number
  metadata: Metadata
}

export interface RefundCreateParams {
  payment_intent: string
  amount?: number
  reason?: RefundReason
  metadata?: Metadata
}

// =============================================================================
// Webhook Types
// =============================================================================

export type WebhookEventType =
  // Customer events
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deleted'
  // Payment events
  | 'payment_intent.created'
  | 'payment_intent.succeeded'
  | 'payment_intent.canceled'
  | 'payment_intent.payment_failed'
  | 'payment_intent.requires_action'
  // Subscription events
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'subscription.paused'
  | 'subscription.resumed'
  | 'subscription.trial_will_end'
  // Refund events
  | 'refund.created'
  | 'refund.succeeded'
  | 'refund.failed'
  // Invoice events
  | 'invoice.created'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  // Charge events
  | 'charge.succeeded'
  | 'charge.failed'
  | 'charge.refunded'
  | 'charge.disputed'
  | string

export interface WebhookEvent {
  id: string
  object: 'event'
  type: WebhookEventType
  data: {
    object: unknown
    previous_attributes?: Record<string, unknown>
  }
  created: number
  livemode: boolean
  provider: PaymentProvider
  request?: {
    id?: string | null
    idempotency_key?: string | null
  } | null
}

/**
 * Webhook event log entry for idempotency
 */
export interface WebhookEventLog {
  id: string
  event_id: string
  event_type: WebhookEventType
  provider: PaymentProvider
  payload_hash: string
  processed_at: number
  status: 'processing' | 'succeeded' | 'failed'
  error?: string
  retries: number
}

// =============================================================================
// Payment State Machine Types
// =============================================================================

export type PaymentStateType =
  | 'created'
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'partially_refunded'
  | 'refunded'
  | 'failed'
  | 'canceled'
  | 'disputed'

export interface PaymentState {
  id: string
  payment_intent_id: string
  customer_id?: string
  state: PaymentStateType
  amount: number
  amount_captured: number
  amount_refunded: number
  currency: Currency
  provider: PaymentProvider
  provider_id?: string
  created_at: number
  updated_at: number
  history: PaymentStateTransition[]
  metadata: Metadata
}

export interface PaymentStateTransition {
  from: PaymentStateType
  to: PaymentStateType
  timestamp: number
  reason?: string
  event_id?: string
}

// =============================================================================
// Provider Result Types
// =============================================================================

export interface ProviderResult<T> {
  success: boolean
  data?: T
  error?: ProviderError
  provider: PaymentProvider
}

export interface ProviderError {
  type: 'api_error' | 'card_error' | 'rate_limit_error' | 'network_error' | 'validation_error'
  code?: string
  message: string
  decline_code?: string
  param?: string
  retryable: boolean
}

// =============================================================================
// API Error Types
// =============================================================================

export interface APIError {
  type: 'api_error' | 'card_error' | 'invalid_request_error' | 'authentication_error' | 'rate_limit_error'
  message: string
  code?: string
  param?: string
  doc_url?: string
}

export interface APIErrorResponse {
  error: APIError
}

// =============================================================================
// Request Options
// =============================================================================

export interface RequestOptions {
  idempotencyKey?: string
  apiKey?: string
  timeout?: number
  maxRetries?: number
}
