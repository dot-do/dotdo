/**
 * @dotdo/paypal - PayPal API Types
 *
 * Type definitions for PayPal API compatibility layer.
 *
 * @module @dotdo/paypal/types
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Money amount with currency
 */
export interface Money {
  currency_code: string
  value: string
}

/**
 * Address object
 */
export interface Address {
  address_line_1?: string
  address_line_2?: string
  admin_area_1?: string
  admin_area_2?: string
  postal_code?: string
  country_code: string
}

/**
 * Link description
 */
export interface LinkDescription {
  href: string
  rel: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
}

/**
 * PayPal API error detail
 */
export interface PayPalErrorDetail {
  field?: string
  value?: string
  location?: string
  issue: string
  description?: string
}

/**
 * PayPal API error response
 */
export interface PayPalError {
  name: string
  message: string
  debug_id?: string
  details?: PayPalErrorDetail[]
  links?: LinkDescription[]
}

/**
 * Request options
 */
export interface RequestOptions {
  paypalRequestId?: string
  paypalPartnerAttributionId?: string
  paypalClientMetadataId?: string
  prefer?: 'return=minimal' | 'return=representation'
  accessToken?: string
  timeout?: number
}

// =============================================================================
// Order Types
// =============================================================================

/**
 * Order status
 */
export type OrderStatus = 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED'

/**
 * Order intent
 */
export type OrderIntent = 'CAPTURE' | 'AUTHORIZE'

/**
 * Item category
 */
export type ItemCategory = 'DIGITAL_GOODS' | 'PHYSICAL_GOODS' | 'DONATION'

/**
 * Shipping type
 */
export type ShippingType = 'SHIPPING' | 'PICKUP_IN_PERSON' | 'PICKUP_IN_STORE' | 'PICKUP_FROM_PERSON'

/**
 * Payee
 */
export interface Payee {
  email_address?: string
  merchant_id?: string
}

/**
 * Platform fee
 */
export interface PlatformFee {
  amount: Money
  payee?: Payee
}

/**
 * Payment instruction
 */
export interface PaymentInstruction {
  platform_fees?: PlatformFee[]
  disbursement_mode?: 'INSTANT' | 'DELAYED'
  payee_pricing_tier_id?: string
  payee_receivable_fx_rate_id?: string
}

/**
 * Item
 */
export interface Item {
  name: string
  quantity: string
  description?: string
  sku?: string
  url?: string
  category?: ItemCategory
  image_url?: string
  unit_amount: Money
  tax?: Money
  upc?: { type: 'UPC-A' | 'UPC-B' | 'UPC-C' | 'UPC-D' | 'UPC-E' | 'UPC-2' | 'UPC-5'; code: string }
}

/**
 * Amount breakdown
 */
export interface AmountBreakdown {
  item_total?: Money
  shipping?: Money
  handling?: Money
  tax_total?: Money
  insurance?: Money
  shipping_discount?: Money
  discount?: Money
}

/**
 * Amount with breakdown
 */
export interface AmountWithBreakdown {
  currency_code: string
  value: string
  breakdown?: AmountBreakdown
}

/**
 * Shipping detail
 */
export interface ShippingDetail {
  type?: ShippingType
  name?: { full_name?: string }
  address?: Address
  email_address?: string
  phone_number?: { country_code?: string; national_number?: string }
  options?: ShippingOption[]
}

/**
 * Shipping option
 */
export interface ShippingOption {
  id: string
  label: string
  type?: 'SHIPPING' | 'PICKUP'
  amount?: Money
  selected: boolean
}

/**
 * Supplementary data
 */
export interface SupplementaryData {
  card?: {
    level_2?: { invoice_id?: string; tax_total?: Money }
    level_3?: {
      ships_from_postal_code?: string
      line_items?: {
        name?: string
        quantity: string
        description?: string
        sku?: string
        url?: string
        image_url?: string
        upc?: { type: string; code: string }
        commodity_code?: string
        unit_of_measure?: string
        unit_amount: Money
        tax?: Money
        discount_amount?: Money
        total_amount?: Money
      }[]
      shipping_amount?: Money
      duty_amount?: Money
      discount_amount?: Money
      shipping_address?: Address
    }
  }
}

/**
 * Purchase unit
 */
export interface PurchaseUnit {
  reference_id?: string
  description?: string
  custom_id?: string
  invoice_id?: string
  soft_descriptor?: string
  amount: AmountWithBreakdown
  payee?: Payee
  payment_instruction?: PaymentInstruction
  items?: Item[]
  shipping?: ShippingDetail
  supplementary_data?: SupplementaryData
}

/**
 * Payer name
 */
export interface PayerName {
  given_name?: string
  surname?: string
}

/**
 * Payer phone
 */
export interface PayerPhone {
  phone_type?: 'FAX' | 'HOME' | 'MOBILE' | 'OTHER' | 'PAGER'
  phone_number: { national_number: string }
}

/**
 * Tax info
 */
export interface TaxInfo {
  tax_id: string
  tax_id_type: 'BR_CPF' | 'BR_CNPJ'
}

/**
 * Payer
 */
export interface Payer {
  email_address?: string
  payer_id?: string
  name?: PayerName
  phone?: PayerPhone
  birth_date?: string
  tax_info?: TaxInfo
  address?: Address
}

/**
 * Experience context
 */
export interface ExperienceContext {
  payment_method_preference?: 'UNRESTRICTED' | 'IMMEDIATE_PAYMENT_REQUIRED'
  payment_method_selected?: 'PAYPAL' | 'PAYPAL_CREDIT' | 'PAYPAL_WALLET'
  brand_name?: string
  locale?: string
  landing_page?: 'LOGIN' | 'BILLING' | 'NO_PREFERENCE' | 'GUEST_CHECKOUT'
  shipping_preference?: 'GET_FROM_FILE' | 'NO_SHIPPING' | 'SET_PROVIDED_ADDRESS'
  user_action?: 'CONTINUE' | 'PAY_NOW'
  return_url?: string
  cancel_url?: string
}

/**
 * Application context
 */
export interface ApplicationContext extends ExperienceContext {
  stored_payment_source?: {
    payment_initiator: 'CUSTOMER' | 'MERCHANT'
    payment_type: 'ONE_TIME' | 'RECURRING' | 'UNSCHEDULED'
    usage?: 'FIRST' | 'SUBSEQUENT' | 'DERIVED'
    previous_network_transaction_reference?: {
      id: string
      date?: string
      acquirer_reference_number?: string
      network?: 'VISA' | 'MASTERCARD' | 'AMEX' | 'DISCOVER' | 'CB_NATIONALE' | 'DINERS' | 'EFTPOS' | 'ELO' | 'JCB' | 'MAESTRO' | 'RUPAY' | 'SYNCHRONY' | 'SWITCH' | 'HIPER' | 'UNIONPAY'
    }
  }
}

/**
 * Card response
 */
export interface CardResponse {
  name?: string
  last_digits?: string
  brand?: 'VISA' | 'MASTERCARD' | 'AMEX' | 'DISCOVER' | 'DINERS' | 'EFTPOS' | 'ELO' | 'HIPER' | 'JCB' | 'MAESTRO' | 'RUPAY' | 'UNKNOWN' | 'CHINA_UNION_PAY'
  available_networks?: string[]
  type?: 'CREDIT' | 'DEBIT' | 'PREPAID' | 'UNKNOWN'
  authentication_result?: {
    liability_shift?: 'POSSIBLE' | 'NO' | 'UNKNOWN'
    three_d_secure?: {
      authentication_status?: 'Y' | 'N' | 'U' | 'A' | 'C' | 'R' | 'D' | 'I'
      enrollment_status?: 'Y' | 'N' | 'U' | 'B'
    }
  }
  attributes?: {
    vault?: {
      id?: string
      status?: 'VAULTED' | 'CREATED' | 'APPROVED'
      customer?: { id?: string; email_address?: string }
      links?: LinkDescription[]
    }
  }
  from_request?: { last_digits?: string; expiry?: string }
  expiry?: string
  bin_details?: { bin?: string; issuing_bank?: string; bin_country_code?: string; products?: string[] }
}

/**
 * Capture status detail
 */
export interface CaptureStatusDetail {
  reason?: 'BUYER_COMPLAINT' | 'CHARGEBACK' | 'ECHECK' | 'INTERNATIONAL_WITHDRAWAL' | 'OTHER' | 'PENDING_REVIEW' | 'RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION' | 'REFUNDED' | 'TRANSACTION_APPROVED_AWAITING_FUNDING' | 'UNILATERAL' | 'VERIFICATION_REQUIRED'
}

/**
 * Seller protection
 */
export interface SellerProtection {
  status?: 'ELIGIBLE' | 'PARTIALLY_ELIGIBLE' | 'NOT_ELIGIBLE'
  dispute_categories?: ('ITEM_NOT_RECEIVED' | 'UNAUTHORIZED_TRANSACTION')[]
}

/**
 * Seller receivable breakdown
 */
export interface SellerReceivableBreakdown {
  gross_amount: Money
  paypal_fee?: Money
  paypal_fee_in_receivable_currency?: Money
  net_amount?: Money
  receivable_amount?: Money
  exchange_rate?: { source_currency?: string; target_currency?: string; value?: string }
  platform_fees?: PlatformFee[]
}

/**
 * Processor response
 */
export interface ProcessorResponse {
  avs_code?: string
  cvv_code?: string
  response_code?: string
  payment_advice_code?: string
}

/**
 * Network transaction reference
 */
export interface NetworkTransactionReference {
  id: string
  date?: string
  network?: 'VISA' | 'MASTERCARD' | 'AMEX' | 'DISCOVER' | 'CB_NATIONALE' | 'DINERS' | 'EFTPOS' | 'ELO' | 'JCB' | 'MAESTRO' | 'RUPAY' | 'SYNCHRONY' | 'SWITCH' | 'HIPER' | 'UNIONPAY'
  acquirer_reference_number?: string
}

/**
 * Capture
 */
export interface Capture {
  id: string
  status?: 'COMPLETED' | 'DECLINED' | 'PARTIALLY_REFUNDED' | 'PENDING' | 'REFUNDED' | 'FAILED'
  status_details?: CaptureStatusDetail
  amount?: Money
  final_capture?: boolean
  seller_protection?: SellerProtection
  seller_receivable_breakdown?: SellerReceivableBreakdown
  disbursement_mode?: 'INSTANT' | 'DELAYED'
  invoice_id?: string
  custom_id?: string
  processor_response?: ProcessorResponse
  network_transaction_reference?: NetworkTransactionReference
  create_time?: string
  update_time?: string
  links?: LinkDescription[]
}

/**
 * Authorization status detail
 */
export interface AuthorizationStatusDetail {
  reason?: 'PENDING_REVIEW'
}

/**
 * Authorization
 */
export interface Authorization {
  id: string
  status?: 'CREATED' | 'CAPTURED' | 'DENIED' | 'EXPIRED' | 'PARTIALLY_CAPTURED' | 'VOIDED' | 'PENDING'
  status_details?: AuthorizationStatusDetail
  amount?: Money
  invoice_id?: string
  custom_id?: string
  seller_protection?: SellerProtection
  expiration_time?: string
  processor_response?: ProcessorResponse
  network_transaction_reference?: NetworkTransactionReference
  create_time?: string
  update_time?: string
  links?: LinkDescription[]
}

/**
 * Refund status detail
 */
export interface RefundStatusDetail {
  reason?: 'ECHECK'
}

/**
 * Refund
 */
export interface RefundDetail {
  id: string
  status?: 'CANCELLED' | 'FAILED' | 'PENDING' | 'COMPLETED'
  status_details?: RefundStatusDetail
  amount?: Money
  invoice_id?: string
  custom_id?: string
  acquirer_reference_number?: string
  note_to_payer?: string
  seller_payable_breakdown?: {
    gross_amount: Money
    paypal_fee?: Money
    paypal_fee_in_receivable_currency?: Money
    net_amount?: Money
    net_amount_in_receivable_currency?: Money
    platform_fees?: PlatformFee[]
    net_amount_breakdown?: { payable_amount?: Money; converted_amount?: Money; exchange_rate?: { source_currency?: string; target_currency?: string; value?: string } }[]
    total_refunded_amount?: Money
  }
  payer?: Payer
  create_time?: string
  update_time?: string
  links?: LinkDescription[]
}

/**
 * Payment source response
 */
export interface PaymentSourceResponse {
  card?: CardResponse
  paypal?: {
    email_address?: string
    account_id?: string
    account_status?: 'VERIFIED' | 'UNVERIFIED'
    name?: PayerName
    phone_type?: 'FAX' | 'HOME' | 'MOBILE' | 'OTHER' | 'PAGER'
    phone_number?: { national_number: string }
    birth_date?: string
    tax_info?: TaxInfo
    address?: Address
    attributes?: {
      vault?: { id?: string; status?: string; customer?: { id?: string }; links?: LinkDescription[] }
      cobranded_cards?: { labels?: string[]; payee?: Payee; amount?: Money }[]
    }
  }
  bancontact?: { name?: string; country_code?: string; bic?: string; iban_last_chars?: string; card_last_digits?: string }
  blik?: { name?: string; country_code?: string; email?: string; one_click?: { consumer_reference?: string } }
  eps?: { name?: string; country_code?: string; bic?: string }
  giropay?: { name?: string; country_code?: string; bic?: string }
  ideal?: { name?: string; country_code?: string; bic?: string; iban_last_chars?: string }
  mybank?: { name?: string; country_code?: string; bic?: string; iban_last_chars?: string }
  p24?: { name?: string; country_code?: string; method_id?: string; method_description?: string; email?: string }
  sofort?: { name?: string; country_code?: string; bic?: string; iban_last_chars?: string }
  trustly?: { name?: string; country_code?: string; bic?: string; iban_last_chars?: string }
  venmo?: { email_address?: string; account_id?: string; user_name?: string; name?: PayerName; phone_number?: { national_number: string }; address?: Address; attributes?: { vault?: { id?: string; status?: string; customer?: { id?: string }; links?: LinkDescription[] } } }
}

/**
 * Payment collection
 */
export interface PaymentCollection {
  authorizations?: Authorization[]
  captures?: Capture[]
  refunds?: RefundDetail[]
}

/**
 * Purchase unit response
 */
export interface PurchaseUnitResponse extends PurchaseUnit {
  payments?: PaymentCollection
}

/**
 * Order
 */
export interface Order {
  id?: string
  status?: OrderStatus
  payment_source?: PaymentSourceResponse
  intent?: OrderIntent
  processing_instruction?: 'ORDER_COMPLETE_ON_PAYMENT_APPROVAL' | 'NO_INSTRUCTION'
  payer?: Payer
  purchase_units?: PurchaseUnitResponse[]
  create_time?: string
  update_time?: string
  links?: LinkDescription[]
}

/**
 * Order create params
 */
export interface OrderCreateParams {
  intent: OrderIntent
  purchase_units: PurchaseUnit[]
  payer?: Payer
  payment_source?: {
    card?: {
      name?: string
      number?: string
      security_code?: string
      expiry?: string
      billing_address?: Address
      attributes?: { vault?: { store_in_vault?: 'ON_SUCCESS' }; verification?: { method?: 'SCA_ALWAYS' | 'SCA_WHEN_REQUIRED' | '3D_SECURE' } }
      stored_credential?: { payment_initiator: 'CUSTOMER' | 'MERCHANT'; payment_type: 'ONE_TIME' | 'RECURRING' | 'UNSCHEDULED'; usage?: 'FIRST' | 'SUBSEQUENT' | 'DERIVED'; previous_network_transaction_reference?: NetworkTransactionReference }
      vault_id?: string
      single_use_token?: string
      network_token?: { number: string; expiry: string; cryptogram?: string; eci_flag?: 'MASTERCARD_NON_3D_SECURE_TRANSACTION' | 'MASTERCARD_ATTEMPTED_AUTHENTICATION_TRANSACTION' | 'MASTERCARD_FULLY_AUTHENTICATED_TRANSACTION' | 'FULLY_AUTHENTICATED_TRANSACTION' | 'ATTEMPTED_AUTHENTICATION_TRANSACTION' | 'NON_3D_SECURE_TRANSACTION'; token_requestor_id?: string }
      experience_context?: ExperienceContext
    }
    paypal?: {
      vault_id?: string
      email_address?: string
      name?: PayerName
      phone?: PayerPhone
      birth_date?: string
      tax_info?: TaxInfo
      address?: Address
      attributes?: { vault?: { store_in_vault?: 'ON_SUCCESS'; usage_type?: 'MERCHANT' | 'PLATFORM'; customer_type?: 'CONSUMER' | 'BUSINESS'; permit_multiple_payment_tokens?: boolean } & Partial<{ customer: { id?: string; email_address?: string } }> }
      experience_context?: ExperienceContext
    }
    token?: { id: string; type: 'BILLING_AGREEMENT' }
    venmo?: { vault_id?: string; email_address?: string; experience_context?: ExperienceContext; attributes?: { vault?: { store_in_vault?: 'ON_SUCCESS'; usage_type?: 'MERCHANT' | 'PLATFORM'; customer_type?: 'CONSUMER' | 'BUSINESS'; permit_multiple_payment_tokens?: boolean } } }
  }
  application_context?: ApplicationContext
}

/**
 * Order update operation
 */
export interface OrderUpdateOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test'
  path: string
  value?: unknown
  from?: string
}

/**
 * Order capture params
 */
export interface OrderCaptureParams {
  payment_source?: OrderCreateParams['payment_source']
}

/**
 * Order authorize params
 */
export interface OrderAuthorizeParams {
  payment_source?: OrderCreateParams['payment_source']
}

/**
 * Order confirm params
 */
export interface OrderConfirmParams {
  payment_source: OrderCreateParams['payment_source']
  processing_instruction?: 'ORDER_COMPLETE_ON_PAYMENT_APPROVAL' | 'NO_INSTRUCTION'
  application_context?: ApplicationContext
}

// =============================================================================
// Payment Types (Captures/Authorizations)
// =============================================================================

/**
 * Capture payment params
 */
export interface CapturePaymentParams {
  amount?: Money
  invoice_id?: string
  final_capture?: boolean
  payment_instruction?: PaymentInstruction
  soft_descriptor?: string
  note_to_payer?: string
}

/**
 * Void authorization params
 */
export interface VoidAuthorizationParams {}

/**
 * Reauthorize params
 */
export interface ReauthorizeParams {
  amount?: Money
}

/**
 * Refund capture params
 */
export interface RefundCaptureParams {
  amount?: Money
  invoice_id?: string
  note_to_payer?: string
  payment_instruction?: PaymentInstruction
}

// =============================================================================
// Subscription Types
// =============================================================================

/**
 * Billing cycle tenure type
 */
export type BillingCycleTenureType = 'REGULAR' | 'TRIAL'

/**
 * Frequency interval unit
 */
export type FrequencyIntervalUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR'

/**
 * Pricing model
 */
export type PricingModel = 'VOLUME' | 'TIERED'

/**
 * Subscription status
 */
export type SubscriptionStatus = 'APPROVAL_PENDING' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED'

/**
 * Frequency
 */
export interface Frequency {
  interval_unit: FrequencyIntervalUnit
  interval_count: number
}

/**
 * Pricing tier
 */
export interface PricingTier {
  starting_quantity: string
  ending_quantity?: string
  amount: Money
}

/**
 * Pricing scheme
 */
export interface PricingScheme {
  version?: number
  pricing_model?: PricingModel
  tiers?: PricingTier[]
  fixed_price?: Money
  create_time?: string
  update_time?: string
}

/**
 * Billing cycle
 */
export interface BillingCycle {
  tenure_type: BillingCycleTenureType
  sequence: number
  total_cycles?: number
  pricing_scheme?: PricingScheme
  frequency: Frequency
}

/**
 * Payment preferences
 */
export interface PaymentPreferences {
  auto_bill_outstanding?: boolean
  setup_fee?: Money
  setup_fee_failure_action?: 'CONTINUE' | 'CANCEL'
  payment_failure_threshold?: number
}

/**
 * Taxes
 */
export interface Taxes {
  percentage: string
  inclusive?: boolean
}

/**
 * Plan
 */
export interface Plan {
  id?: string
  product_id?: string
  name?: string
  status?: 'CREATED' | 'INACTIVE' | 'ACTIVE'
  description?: string
  billing_cycles?: BillingCycle[]
  payment_preferences?: PaymentPreferences
  taxes?: Taxes
  quantity_supported?: boolean
  create_time?: string
  update_time?: string
  links?: LinkDescription[]
}

/**
 * Plan create params
 */
export interface PlanCreateParams {
  product_id: string
  name: string
  status?: 'CREATED' | 'INACTIVE' | 'ACTIVE'
  description?: string
  billing_cycles: BillingCycle[]
  payment_preferences?: PaymentPreferences
  taxes?: Taxes
  quantity_supported?: boolean
}

/**
 * Plan update params
 */
export interface PlanUpdateOperation {
  op: 'add' | 'remove' | 'replace'
  path: string
  value?: unknown
}

/**
 * Plan list params
 */
export interface PlanListParams {
  product_id?: string
  plan_ids?: string
  page_size?: number
  page?: number
  total_required?: boolean
}

/**
 * Plan list response
 */
export interface PlanListResponse {
  plans: Plan[]
  total_items?: number
  total_pages?: number
  links?: LinkDescription[]
}

/**
 * Subscriber
 */
export interface Subscriber {
  email_address?: string
  name?: PayerName
  phone?: PayerPhone
  shipping_address?: ShippingDetail
  payment_source?: {
    card?: { name?: string; number?: string; security_code?: string; expiry?: string; billing_address?: Address }
  }
}

/**
 * Subscription billing info
 */
export interface SubscriptionBillingInfo {
  outstanding_balance?: Money
  cycle_executions?: { tenure_type: BillingCycleTenureType; sequence: number; cycles_completed: number; cycles_remaining?: number; current_pricing_scheme_version?: number; total_cycles?: number }[]
  last_payment?: { amount: Money; time: string }
  next_billing_time?: string
  final_payment_time?: string
  failed_payments_count?: number
}

/**
 * Subscription
 */
export interface Subscription {
  id?: string
  plan_id?: string
  status?: SubscriptionStatus
  status_change_note?: string
  status_update_time?: string
  start_time?: string
  quantity?: string
  shipping_amount?: Money
  subscriber?: Subscriber
  billing_info?: SubscriptionBillingInfo
  auto_renewal?: boolean
  create_time?: string
  update_time?: string
  custom_id?: string
  plan_overridden?: boolean
  plan?: Plan
  links?: LinkDescription[]
}

/**
 * Subscription create params
 */
export interface SubscriptionCreateParams {
  plan_id: string
  start_time?: string
  quantity?: string
  shipping_amount?: Money
  subscriber?: Subscriber
  auto_renewal?: boolean
  application_context?: ApplicationContext
  custom_id?: string
  plan?: {
    billing_cycles?: BillingCycle[]
    payment_preferences?: PaymentPreferences
    taxes?: Taxes
  }
}

/**
 * Subscription update operation
 */
export type SubscriptionUpdateOperation = PlanUpdateOperation

/**
 * Subscription suspend params
 */
export interface SubscriptionSuspendParams {
  reason: string
}

/**
 * Subscription cancel params
 */
export interface SubscriptionCancelParams {
  reason: string
}

/**
 * Subscription activate params
 */
export interface SubscriptionActivateParams {
  reason?: string
}

/**
 * Subscription capture params
 */
export interface SubscriptionCaptureParams {
  note: string
  capture_type: 'OUTSTANDING_BALANCE'
  amount: Money
}

/**
 * Subscription revise params
 */
export interface SubscriptionReviseParams {
  plan_id?: string
  quantity?: string
  effective_time?: string
  shipping_amount?: Money
  shipping_address?: ShippingDetail
  application_context?: ApplicationContext
}

/**
 * Subscription transaction
 */
export interface SubscriptionTransaction {
  id: string
  status: 'COMPLETED' | 'DECLINED' | 'PARTIALLY_REFUNDED' | 'PENDING' | 'REFUNDED'
  payer_email?: string
  payer_name?: PayerName
  amount_with_breakdown: {
    gross_amount: Money
    fee_amount?: Money
    shipping_amount?: Money
    tax_amount?: Money
    net_amount?: Money
  }
  time: string
}

/**
 * Subscription transactions params
 */
export interface SubscriptionTransactionsParams {
  start_time: string
  end_time: string
}

// =============================================================================
// Payout Types
// =============================================================================

/**
 * Payout recipient type
 */
export type PayoutRecipientType = 'EMAIL' | 'PHONE' | 'PAYPAL_ID'

/**
 * Payout batch status
 */
export type PayoutBatchStatus = 'DENIED' | 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'CANCELED'

/**
 * Payout item status
 */
export type PayoutItemStatus = 'SUCCESS' | 'FAILED' | 'PENDING' | 'UNCLAIMED' | 'RETURNED' | 'ONHOLD' | 'BLOCKED' | 'REFUNDED' | 'REVERSED'

/**
 * Payout item
 */
export interface PayoutItem {
  recipient_type?: PayoutRecipientType
  amount: Money
  note?: string
  receiver: string
  sender_item_id?: string
  recipient_wallet?: 'PAYPAL' | 'VENMO'
  alternate_notification_method?: { phone?: { country_code: string; national_number: string } }
  notification_language?: string
  application_context?: { social_feed_privacy?: 'PUBLIC' | 'FRIENDS_ONLY' | 'PRIVATE' }
}

/**
 * Sender batch header
 */
export interface SenderBatchHeader {
  sender_batch_id?: string
  email_subject?: string
  email_message?: string
  recipient_type?: PayoutRecipientType
}

/**
 * Payout batch header
 */
export interface PayoutBatchHeader extends SenderBatchHeader {
  payout_batch_id?: string
  batch_status?: PayoutBatchStatus
  time_created?: string
  time_completed?: string
  time_closed?: string
  funding_source?: 'BALANCE'
  amount?: Money
  fees?: Money
}

/**
 * Payout item detail
 */
export interface PayoutItemDetail {
  payout_item_id: string
  transaction_id?: string
  activity_id?: string
  transaction_status?: PayoutItemStatus
  payout_item_fee?: Money
  payout_batch_id?: string
  sender_batch_id?: string
  payout_item: PayoutItem
  currency_conversion?: { from_amount?: Money; to_amount?: Money; exchange_rate?: string }
  time_processed?: string
  errors?: PayPalError
  links?: LinkDescription[]
}

/**
 * Payout batch
 */
export interface PayoutBatch {
  batch_header: PayoutBatchHeader
  items?: PayoutItemDetail[]
  links?: LinkDescription[]
}

/**
 * Payout create params
 */
export interface PayoutCreateParams {
  sender_batch_header: SenderBatchHeader
  items: PayoutItem[]
}

/**
 * Payout list params
 */
export interface PayoutListParams {
  page_size?: number
  page?: number
  total_required?: boolean
  fields?: string
}

// =============================================================================
// Webhook Types
// =============================================================================

/**
 * Webhook event type
 */
export type WebhookEventType =
  // Orders
  | 'CHECKOUT.ORDER.APPROVED'
  | 'CHECKOUT.ORDER.SAVED'
  | 'CHECKOUT.ORDER.VOIDED'
  | 'CHECKOUT.ORDER.COMPLETED'
  // Payments
  | 'PAYMENT.AUTHORIZATION.CREATED'
  | 'PAYMENT.AUTHORIZATION.VOIDED'
  | 'PAYMENT.CAPTURE.COMPLETED'
  | 'PAYMENT.CAPTURE.DENIED'
  | 'PAYMENT.CAPTURE.PENDING'
  | 'PAYMENT.CAPTURE.REFUNDED'
  | 'PAYMENT.CAPTURE.REVERSED'
  // Subscriptions
  | 'BILLING.SUBSCRIPTION.CREATED'
  | 'BILLING.SUBSCRIPTION.ACTIVATED'
  | 'BILLING.SUBSCRIPTION.UPDATED'
  | 'BILLING.SUBSCRIPTION.EXPIRED'
  | 'BILLING.SUBSCRIPTION.CANCELLED'
  | 'BILLING.SUBSCRIPTION.SUSPENDED'
  | 'BILLING.SUBSCRIPTION.PAYMENT.FAILED'
  // Payouts
  | 'PAYMENT.PAYOUTS-ITEM.BLOCKED'
  | 'PAYMENT.PAYOUTS-ITEM.CANCELED'
  | 'PAYMENT.PAYOUTS-ITEM.DENIED'
  | 'PAYMENT.PAYOUTS-ITEM.FAILED'
  | 'PAYMENT.PAYOUTS-ITEM.HELD'
  | 'PAYMENT.PAYOUTS-ITEM.REFUNDED'
  | 'PAYMENT.PAYOUTS-ITEM.RETURNED'
  | 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED'
  | 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED'
  | 'PAYMENT.PAYOUTSBATCH.DENIED'
  | 'PAYMENT.PAYOUTSBATCH.PROCESSING'
  | 'PAYMENT.PAYOUTSBATCH.SUCCESS'
  // Disputes
  | 'CUSTOMER.DISPUTE.CREATED'
  | 'CUSTOMER.DISPUTE.UPDATED'
  | 'CUSTOMER.DISPUTE.RESOLVED'
  | string

/**
 * Webhook event
 */
export interface WebhookEvent {
  id: string
  create_time: string
  resource_type: string
  event_type: WebhookEventType
  summary: string
  resource: Record<string, unknown>
  resource_version?: string
  event_version?: string
  links?: LinkDescription[]
}

/**
 * Webhook
 */
export interface Webhook {
  id?: string
  url: string
  event_types: { name: WebhookEventType; description?: string }[]
  links?: LinkDescription[]
}

/**
 * Webhook create params
 */
export interface WebhookCreateParams {
  url: string
  event_types: { name: WebhookEventType }[]
}

/**
 * Webhook update params
 */
export interface WebhookUpdateOperation {
  op: 'add' | 'remove' | 'replace'
  path: string
  value?: unknown
}

/**
 * Webhook verification response
 */
export interface WebhookVerificationResponse {
  verification_status: 'SUCCESS' | 'FAILURE'
}
