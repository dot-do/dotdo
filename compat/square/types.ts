/**
 * @dotdo/square - Square API Types
 *
 * Type definitions for Square API compatibility layer.
 *
 * @module @dotdo/square/types
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Money amount with currency
 */
export interface Money {
  amount?: number
  currency: string
}

/**
 * Address object
 */
export interface Address {
  address_line_1?: string
  address_line_2?: string
  locality?: string
  administrative_district_level_1?: string
  postal_code?: string
  country?: string
  first_name?: string
  last_name?: string
}

/**
 * List response wrapper
 */
export interface ListResponse<T> {
  objects?: T[]
  cursor?: string
  errors?: SquareError[]
}

/**
 * Batch response wrapper
 */
export interface BatchResponse<T> {
  objects?: T[]
  id_mappings?: { client_object_id: string; object_id: string }[]
  errors?: SquareError[]
}

/**
 * Square API error
 */
export interface SquareError {
  category: 'API_ERROR' | 'AUTHENTICATION_ERROR' | 'INVALID_REQUEST_ERROR' | 'RATE_LIMIT_ERROR' | 'PAYMENT_METHOD_ERROR' | 'REFUND_ERROR'
  code: string
  detail?: string
  field?: string
}

/**
 * Error response
 */
export interface SquareErrorResponse {
  errors: SquareError[]
}

/**
 * Request options
 */
export interface RequestOptions {
  idempotencyKey?: string
  accessToken?: string
  timeout?: number
}

// =============================================================================
// Location Types
// =============================================================================

/**
 * Location status
 */
export type LocationStatus = 'ACTIVE' | 'INACTIVE'

/**
 * Location type
 */
export type LocationType = 'PHYSICAL' | 'MOBILE'

/**
 * Location capabilities
 */
export type LocationCapability = 'CREDIT_CARD_PROCESSING' | 'AUTOMATIC_TRANSFERS' | 'UNLINKED_REFUNDS'

/**
 * Location business hours
 */
export interface BusinessHours {
  periods?: BusinessHoursPeriod[]
}

/**
 * Business hours period
 */
export interface BusinessHoursPeriod {
  day_of_week: 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT'
  start_local_time?: string
  end_local_time?: string
}

/**
 * Location object
 */
export interface Location {
  id?: string
  name?: string
  address?: Address
  timezone?: string
  capabilities?: LocationCapability[]
  status?: LocationStatus
  created_at?: string
  merchant_id?: string
  country?: string
  language_code?: string
  currency?: string
  phone_number?: string
  business_name?: string
  type?: LocationType
  website_url?: string
  business_hours?: BusinessHours
  business_email?: string
  description?: string
  twitter_username?: string
  instagram_username?: string
  facebook_url?: string
  logo_url?: string
  pos_background_url?: string
  mcc?: string
  full_format_logo_url?: string
  tax_ids?: TaxIds
}

/**
 * Tax IDs
 */
export interface TaxIds {
  eu_vat?: string
  fr_siret?: string
  fr_naf?: string
  es_nif?: string
}

// =============================================================================
// Customer Types
// =============================================================================

/**
 * Customer creation source
 */
export type CustomerCreationSource = 'OTHER' | 'APPOINTMENTS' | 'COUPON' | 'DELETION_RECOVERY' | 'DIRECTORY' | 'EGIFTING' | 'EMAIL_COLLECTION' | 'FEEDBACK' | 'IMPORT' | 'INVOICES' | 'LOYALTY' | 'MARKETING' | 'MERGE' | 'ONLINE_STORE' | 'INSTANT_PROFILE' | 'TERMINAL' | 'THIRD_PARTY' | 'THIRD_PARTY_IMPORT' | 'UNMERGE_RECOVERY'

/**
 * Customer preferences
 */
export interface CustomerPreferences {
  email_unsubscribed?: boolean
}

/**
 * Customer tax ID
 */
export interface CustomerTaxIds {
  eu_vat?: string
}

/**
 * Customer object
 */
export interface Customer {
  id?: string
  created_at?: string
  updated_at?: string
  given_name?: string
  family_name?: string
  nickname?: string
  company_name?: string
  email_address?: string
  address?: Address
  phone_number?: string
  birthday?: string
  reference_id?: string
  note?: string
  preferences?: CustomerPreferences
  creation_source?: CustomerCreationSource
  group_ids?: string[]
  segment_ids?: string[]
  version?: number
  tax_ids?: CustomerTaxIds
}

/**
 * Customer create params
 */
export interface CustomerCreateParams {
  idempotency_key?: string
  given_name?: string
  family_name?: string
  company_name?: string
  nickname?: string
  email_address?: string
  address?: Address
  phone_number?: string
  reference_id?: string
  note?: string
  birthday?: string
  tax_ids?: CustomerTaxIds
}

/**
 * Customer update params
 */
export interface CustomerUpdateParams {
  given_name?: string
  family_name?: string
  company_name?: string
  nickname?: string
  email_address?: string
  address?: Address
  phone_number?: string
  reference_id?: string
  note?: string
  birthday?: string
  version?: number
  tax_ids?: CustomerTaxIds
}

/**
 * Customer list params
 */
export interface CustomerListParams {
  cursor?: string
  limit?: number
  sort_field?: 'DEFAULT' | 'CREATED_AT'
  sort_order?: 'ASC' | 'DESC'
  count?: boolean
}

/**
 * Customer search query
 */
export interface CustomerQuery {
  filter?: CustomerFilter
  sort?: CustomerSort
}

/**
 * Customer filter
 */
export interface CustomerFilter {
  creation_source?: { values: CustomerCreationSource[] }
  created_at?: { start_at?: string; end_at?: string }
  updated_at?: { start_at?: string; end_at?: string }
  email_address?: { exact?: string; fuzzy?: string }
  phone_number?: { exact?: string; fuzzy?: string }
  reference_id?: { exact?: string; fuzzy?: string }
  group_ids?: { all?: string[]; any?: string[]; none?: string[] }
  custom_attribute?: { key: string; filter: { text?: { exact?: string } } }
}

/**
 * Customer sort
 */
export interface CustomerSort {
  field?: 'DEFAULT' | 'CREATED_AT'
  order?: 'ASC' | 'DESC'
}

// =============================================================================
// Payment Types
// =============================================================================

/**
 * Payment status
 */
export type PaymentStatus = 'APPROVED' | 'PENDING' | 'COMPLETED' | 'CANCELED' | 'FAILED'

/**
 * Payment source type
 */
export type PaymentSourceType = 'CARD' | 'BANK_ACCOUNT' | 'WALLET' | 'BUY_NOW_PAY_LATER' | 'SQUARE_ACCOUNT' | 'CASH' | 'EXTERNAL'

/**
 * Card brand
 */
export type CardBrand = 'OTHER_BRAND' | 'VISA' | 'MASTERCARD' | 'AMERICAN_EXPRESS' | 'DISCOVER' | 'DISCOVER_DINERS' | 'JCB' | 'CHINA_UNIONPAY' | 'SQUARE_GIFT_CARD' | 'SQUARE_CAPITAL_CARD' | 'INTERAC' | 'EFTPOS' | 'FELICA'

/**
 * Card details
 */
export interface CardPaymentDetails {
  status?: 'AUTHORIZED' | 'CAPTURED' | 'VOIDED' | 'FAILED'
  card?: Card
  entry_method?: 'KEYED' | 'SWIPED' | 'EMV' | 'ON_FILE' | 'CONTACTLESS'
  cvv_status?: 'CVV_ACCEPTED' | 'CVV_REJECTED' | 'CVV_NOT_CHECKED'
  avs_status?: 'AVS_ACCEPTED' | 'AVS_REJECTED' | 'AVS_NOT_CHECKED'
  auth_result_code?: string
  application_identifier?: string
  application_name?: string
  application_cryptogram?: string
  verification_method?: 'PIN' | 'SIGNATURE' | 'PIN_AND_SIGNATURE' | 'ON_DEVICE' | 'NONE'
  verification_results?: 'SUCCESS' | 'FAILURE'
  statement_description?: string
  device_details?: DeviceDetails
  refund_requires_card_presence?: boolean
  errors?: SquareError[]
}

/**
 * Card object
 */
export interface Card {
  id?: string
  card_brand?: CardBrand
  last_4?: string
  exp_month?: number
  exp_year?: number
  cardholder_name?: string
  billing_address?: Address
  fingerprint?: string
  customer_id?: string
  merchant_id?: string
  reference_id?: string
  enabled?: boolean
  card_type?: 'UNKNOWN_CARD_TYPE' | 'CREDIT' | 'DEBIT'
  prepaid_type?: 'UNKNOWN_PREPAID_TYPE' | 'NOT_PREPAID' | 'PREPAID'
  bin?: string
  version?: number
  card_co_brand?: 'UNKNOWN' | 'AFTERPAY' | 'CLEARPAY'
}

/**
 * Device details
 */
export interface DeviceDetails {
  device_id?: string
  device_installation_id?: string
  device_name?: string
}

/**
 * External payment details
 */
export interface ExternalPaymentDetails {
  type: 'CHECK' | 'BANK_TRANSFER' | 'OTHER_GIFT_CARD' | 'CRYPTO' | 'SQUARE_CASH' | 'SOCIAL' | 'EXTERNAL' | 'EMONEY' | 'CARD' | 'STORED_BALANCE' | 'FOOD_VOUCHER' | 'OTHER'
  source: string
  source_id?: string
  source_fee_money?: Money
}

/**
 * Processing fee
 */
export interface ProcessingFee {
  effective_at?: string
  type?: 'INITIAL' | 'ADJUSTMENT'
  amount_money?: Money
}

/**
 * Risk evaluation
 */
export interface RiskEvaluation {
  created_at?: string
  risk_level?: 'PENDING' | 'NORMAL' | 'MODERATE' | 'HIGH'
}

/**
 * Payment object
 */
export interface Payment {
  id?: string
  created_at?: string
  updated_at?: string
  amount_money?: Money
  tip_money?: Money
  total_money?: Money
  app_fee_money?: Money
  approved_money?: Money
  processing_fee?: ProcessingFee[]
  refunded_money?: Money
  status?: PaymentStatus
  delay_duration?: string
  delay_action?: 'CANCEL' | 'COMPLETE'
  delayed_until?: string
  source_type?: PaymentSourceType
  card_details?: CardPaymentDetails
  cash_details?: { buyer_supplied_money: Money; change_back_money?: Money }
  external_details?: ExternalPaymentDetails
  location_id?: string
  order_id?: string
  reference_id?: string
  customer_id?: string
  employee_id?: string
  team_member_id?: string
  refund_ids?: string[]
  risk_evaluation?: RiskEvaluation
  buyer_email_address?: string
  billing_address?: Address
  shipping_address?: Address
  note?: string
  statement_description_identifier?: string
  capabilities?: ('EDIT_AMOUNT_UP' | 'EDIT_AMOUNT_DOWN' | 'EDIT_TIP_AMOUNT_UP' | 'EDIT_TIP_AMOUNT_DOWN')[]
  receipt_number?: string
  receipt_url?: string
  device_details?: DeviceDetails
  application_details?: { square_product?: string; application_id?: string }
  version_token?: string
}

/**
 * Payment create params
 */
export interface PaymentCreateParams {
  source_id: string
  idempotency_key: string
  amount_money: Money
  tip_money?: Money
  app_fee_money?: Money
  delay_duration?: string
  delay_action?: 'CANCEL' | 'COMPLETE'
  autocomplete?: boolean
  order_id?: string
  customer_id?: string
  location_id?: string
  team_member_id?: string
  reference_id?: string
  verification_token?: string
  accept_partial_authorization?: boolean
  buyer_email_address?: string
  billing_address?: Address
  shipping_address?: Address
  note?: string
  statement_description_identifier?: string
  cash_details?: { buyer_supplied_money: Money; change_back_money?: Money }
  external_details?: ExternalPaymentDetails
}

/**
 * Payment update params
 */
export interface PaymentUpdateParams {
  payment?: {
    amount_money?: Money
    tip_money?: Money
    version_token?: string
  }
  idempotency_key: string
}

/**
 * Payment complete params
 */
export interface PaymentCompleteParams {
  version_token?: string
}

/**
 * Payment cancel params
 */
export interface PaymentCancelParams {}

/**
 * Payment list params
 */
export interface PaymentListParams {
  begin_time?: string
  end_time?: string
  sort_order?: 'ASC' | 'DESC'
  cursor?: string
  location_id?: string
  total?: number
  last_4?: string
  card_brand?: CardBrand
  limit?: number
}

// =============================================================================
// Refund Types
// =============================================================================

/**
 * Refund status
 */
export type RefundStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'FAILED'

/**
 * Refund destination type
 */
export type RefundDestinationType = 'CARD' | 'OTHER_BALANCE' | 'BANK_ACCOUNT' | 'WALLET' | 'BUY_NOW_PAY_LATER' | 'CASH' | 'EXTERNAL'

/**
 * Refund destination details
 */
export interface RefundDestinationDetails {
  card_details?: { card?: Card; entry_method?: string }
}

/**
 * Refund object
 */
export interface Refund {
  id: string
  status?: RefundStatus
  location_id?: string
  unlinked?: boolean
  destination_type?: RefundDestinationType
  destination_details?: RefundDestinationDetails
  amount_money: Money
  app_fee_money?: Money
  processing_fee?: ProcessingFee[]
  payment_id?: string
  order_id?: string
  reason?: string
  created_at?: string
  updated_at?: string
  team_member_id?: string
}

/**
 * Refund payment params
 */
export interface RefundPaymentParams {
  idempotency_key: string
  amount_money: Money
  payment_id?: string
  destination_id?: string
  unlinked?: boolean
  location_id?: string
  customer_id?: string
  reason?: string
  team_member_id?: string
}

/**
 * Refund list params
 */
export interface RefundListParams {
  begin_time?: string
  end_time?: string
  sort_order?: 'ASC' | 'DESC'
  cursor?: string
  location_id?: string
  status?: RefundStatus
  source_type?: PaymentSourceType
  limit?: number
}

// =============================================================================
// Catalog Types
// =============================================================================

/**
 * Catalog object type
 */
export type CatalogObjectType = 'ITEM' | 'ITEM_VARIATION' | 'MODIFIER' | 'MODIFIER_LIST' | 'CATEGORY' | 'DISCOUNT' | 'TAX' | 'SERVICE' | 'IMAGE' | 'PRICING_RULE' | 'PRODUCT_SET' | 'TIME_PERIOD' | 'MEASUREMENT_UNIT' | 'SUBSCRIPTION_PLAN' | 'ITEM_OPTION' | 'ITEM_OPTION_VAL' | 'CUSTOM_ATTRIBUTE_DEFINITION' | 'QUICK_AMOUNTS_SETTINGS' | 'SUBSCRIPTION_PLAN_VARIATION' | 'AVAILABILITY_PERIOD'

/**
 * Catalog item product type
 */
export type CatalogItemProductType = 'REGULAR' | 'GIFT_CARD' | 'APPOINTMENTS_SERVICE' | 'FOOD_AND_BEV' | 'EVENT' | 'DIGITAL' | 'DONATION' | 'LEGACY_SQUARE_ONLINE_SERVICE' | 'LEGACY_SQUARE_ONLINE_MEMBERSHIP'

/**
 * Catalog pricing type
 */
export type CatalogPricingType = 'FIXED_PRICING' | 'VARIABLE_PRICING'

/**
 * Catalog item option value for item variation
 */
export interface CatalogItemOptionValueForItemVariation {
  item_option_id?: string
  item_option_value_id?: string
}

/**
 * Catalog item variation
 */
export interface CatalogItemVariation {
  item_id?: string
  name?: string
  sku?: string
  upc?: string
  ordinal?: number
  pricing_type?: CatalogPricingType
  price_money?: Money
  location_overrides?: { location_id: string; price_money?: Money; pricing_type?: CatalogPricingType; track_inventory?: boolean; inventory_alert_type?: 'NONE' | 'LOW_QUANTITY'; inventory_alert_threshold?: number; sold_out?: boolean; sold_out_valid_until?: string }[]
  track_inventory?: boolean
  inventory_alert_type?: 'NONE' | 'LOW_QUANTITY'
  inventory_alert_threshold?: number
  user_data?: string
  service_duration?: number
  available_for_booking?: boolean
  item_option_values?: CatalogItemOptionValueForItemVariation[]
  measurement_unit_id?: string
  sellable?: boolean
  stockable?: boolean
  image_ids?: string[]
  team_member_ids?: string[]
  stockable_conversion?: { stockable_item_variation_id: string; stockable_quantity: string; nonstockable_quantity: string }
}

/**
 * Catalog item modifier list info
 */
export interface CatalogItemModifierListInfo {
  modifier_list_id: string
  modifier_overrides?: { modifier_id: string; on_by_default?: boolean }[]
  min_selected_modifiers?: number
  max_selected_modifiers?: number
  enabled?: boolean
  ordinal?: number
}

/**
 * Catalog item
 */
export interface CatalogItem {
  name?: string
  description?: string
  abbreviation?: string
  label_color?: string
  is_taxable?: boolean
  available_online?: boolean
  available_for_pickup?: boolean
  available_electronically?: boolean
  category_id?: string
  tax_ids?: string[]
  modifier_list_info?: CatalogItemModifierListInfo[]
  variations?: CatalogObject[]
  product_type?: CatalogItemProductType
  skip_modifier_screen?: boolean
  item_options?: { item_option_id: string }[]
  image_ids?: string[]
  sort_name?: string
  categories?: { id?: string; ordinal?: number }[]
  description_html?: string
  description_plaintext?: string
  channels?: string[]
  is_archived?: boolean
  ecom_seo_data?: { page_title?: string; page_description?: string; permalink?: string }
  food_and_bev_details?: { calorie_count?: number; dietary_preferences?: { type?: 'STANDARD'; standard_name?: string }[]; ingredients?: { type?: 'STANDARD'; standard_name?: string }[] }
  reporting_category?: { id?: string; ordinal?: number }
}

/**
 * Catalog category
 */
export interface CatalogCategory {
  name?: string
  image_ids?: string[]
  category_type?: 'REGULAR_CATEGORY' | 'MENU_CATEGORY' | 'KITCHEN_CATEGORY'
  parent_category?: { id?: string; ordinal?: number }
  is_top_level?: boolean
  channels?: string[]
  availability_period_ids?: string[]
  online_visibility?: boolean
  root_category?: string
  ecom_seo_data?: { page_title?: string; page_description?: string; permalink?: string }
  path_to_root?: { category_id?: string; category_name?: string }[]
}

/**
 * Catalog modifier
 */
export interface CatalogModifier {
  name?: string
  price_money?: Money
  ordinal?: number
  modifier_list_id?: string
  location_overrides?: { location_id: string; price_money?: Money }[]
  image_id?: string
}

/**
 * Catalog modifier list
 */
export interface CatalogModifierList {
  name?: string
  ordinal?: number
  selection_type?: 'SINGLE' | 'MULTIPLE'
  modifiers?: CatalogObject[]
  image_ids?: string[]
  modifier_type?: 'LIST' | 'TEXT'
  max_length?: number
  text_required?: boolean
  internal_name?: string
}

/**
 * Catalog discount
 */
export interface CatalogDiscount {
  name?: string
  discount_type?: 'FIXED_PERCENTAGE' | 'FIXED_AMOUNT' | 'VARIABLE_PERCENTAGE' | 'VARIABLE_AMOUNT'
  percentage?: string
  amount_money?: Money
  pin_required?: boolean
  label_color?: string
  modify_tax_basis?: 'MODIFY_TAX_BASIS' | 'DO_NOT_MODIFY_TAX_BASIS'
  maximum_amount_money?: Money
}

/**
 * Catalog tax
 */
export interface CatalogTax {
  name?: string
  calculation_phase?: 'TAX_SUBTOTAL_PHASE' | 'TAX_TOTAL_PHASE'
  inclusion_type?: 'ADDITIVE' | 'INCLUSIVE'
  percentage?: string
  applies_to_custom_amounts?: boolean
  enabled?: boolean
  applies_to_product_set_id?: string
}

/**
 * Catalog image
 */
export interface CatalogImage {
  name?: string
  url?: string
  caption?: string
  photo_studio_order_id?: string
}

/**
 * Catalog object
 */
export interface CatalogObject {
  type: CatalogObjectType
  id: string
  updated_at?: string
  version?: number
  is_deleted?: boolean
  custom_attribute_values?: Record<string, { name?: string; string_value?: string; key?: string; type?: string; number_value?: string; boolean_value?: boolean; selection_uid_values?: string[] }>
  catalog_v1_ids?: { catalog_v1_id?: string; location_id?: string }[]
  present_at_all_locations?: boolean
  present_at_location_ids?: string[]
  absent_at_location_ids?: string[]
  item_data?: CatalogItem
  category_data?: CatalogCategory
  item_variation_data?: CatalogItemVariation
  tax_data?: CatalogTax
  discount_data?: CatalogDiscount
  modifier_list_data?: CatalogModifierList
  modifier_data?: CatalogModifier
  image_data?: CatalogImage
}

/**
 * Catalog batch upsert params
 */
export interface CatalogBatchUpsertParams {
  idempotency_key: string
  batches: { objects: CatalogObject[] }[]
}

/**
 * Catalog batch retrieve params
 */
export interface CatalogBatchRetrieveParams {
  object_ids: string[]
  include_related_objects?: boolean
  catalog_version?: number
  include_deleted_objects?: boolean
  include_category_path_to_root?: boolean
}

/**
 * Catalog batch delete params
 */
export interface CatalogBatchDeleteParams {
  object_ids: string[]
}

/**
 * Catalog list params
 */
export interface CatalogListParams {
  cursor?: string
  types?: CatalogObjectType[]
  catalog_version?: number
}

/**
 * Catalog search query
 */
export interface CatalogQuery {
  sorted_attribute_query?: { attribute_name: string; initial_attribute_value?: string; sort_order?: 'ASC' | 'DESC' }
  exact_query?: { attribute_name: string; attribute_value: string }
  set_query?: { attribute_name: string; attribute_values: string[] }
  prefix_query?: { attribute_name: string; attribute_prefix: string }
  range_query?: { attribute_name: string; attribute_min_value?: number; attribute_max_value?: number }
  text_query?: { keywords: string[] }
  items_for_tax_query?: { tax_ids: string[] }
  items_for_modifier_list_query?: { modifier_list_ids: string[] }
  items_for_item_options_query?: { item_option_ids?: string[] }
  item_variations_for_item_option_values_query?: { item_option_value_ids?: string[] }
}

/**
 * Catalog search params
 */
export interface CatalogSearchParams {
  cursor?: string
  object_types?: CatalogObjectType[]
  include_deleted_objects?: boolean
  include_related_objects?: boolean
  begin_time?: string
  query?: CatalogQuery
  limit?: number
  include_category_path_to_root?: boolean
}

// =============================================================================
// Order Types
// =============================================================================

/**
 * Order state
 */
export type OrderState = 'OPEN' | 'COMPLETED' | 'CANCELED' | 'DRAFT'

/**
 * Order line item discount scope
 */
export type OrderLineItemDiscountScope = 'OTHER_DISCOUNT_SCOPE' | 'LINE_ITEM' | 'ORDER'

/**
 * Order line item discount type
 */
export type OrderLineItemDiscountType = 'UNKNOWN_DISCOUNT' | 'FIXED_PERCENTAGE' | 'FIXED_AMOUNT' | 'VARIABLE_PERCENTAGE' | 'VARIABLE_AMOUNT'

/**
 * Order line item tax scope
 */
export type OrderLineItemTaxScope = 'OTHER_TAX_SCOPE' | 'LINE_ITEM' | 'ORDER'

/**
 * Order line item tax type
 */
export type OrderLineItemTaxType = 'UNKNOWN_TAX' | 'ADDITIVE' | 'INCLUSIVE'

/**
 * Order line item
 */
export interface OrderLineItem {
  uid?: string
  name?: string
  quantity: string
  quantity_unit?: { measurement_unit?: { custom_unit?: { name: string; abbreviation: string }; area_unit?: string; length_unit?: string; volume_unit?: string; weight_unit?: string; generic_unit?: string; time_unit?: string; type?: string }; precision?: number; catalog_object_id?: string; catalog_version?: number }
  note?: string
  catalog_object_id?: string
  catalog_version?: number
  variation_name?: string
  item_type?: 'ITEM' | 'CUSTOM_AMOUNT' | 'GIFT_CARD'
  metadata?: Record<string, string>
  modifiers?: OrderLineItemModifier[]
  applied_taxes?: OrderLineItemAppliedTax[]
  applied_discounts?: OrderLineItemAppliedDiscount[]
  applied_service_charges?: { uid?: string; service_charge_uid?: string; applied_money?: Money }[]
  base_price_money?: Money
  variation_total_price_money?: Money
  gross_sales_money?: Money
  total_tax_money?: Money
  total_discount_money?: Money
  total_money?: Money
  pricing_blocklists?: { blocked_discounts?: { uid?: string; discount_uid?: string; discount_catalog_object_id?: string }[]; blocked_taxes?: { uid?: string; tax_uid?: string; tax_catalog_object_id?: string }[] }
  total_service_charge_money?: Money
}

/**
 * Order line item modifier
 */
export interface OrderLineItemModifier {
  uid?: string
  catalog_object_id?: string
  catalog_version?: number
  name?: string
  quantity?: string
  base_price_money?: Money
  total_price_money?: Money
  metadata?: Record<string, string>
}

/**
 * Order line item applied tax
 */
export interface OrderLineItemAppliedTax {
  uid?: string
  tax_uid: string
  applied_money?: Money
}

/**
 * Order line item applied discount
 */
export interface OrderLineItemAppliedDiscount {
  uid?: string
  discount_uid: string
  applied_money?: Money
}

/**
 * Order tax
 */
export interface OrderLineItemTax {
  uid?: string
  catalog_object_id?: string
  catalog_version?: number
  name?: string
  type?: OrderLineItemTaxType
  percentage?: string
  metadata?: Record<string, string>
  applied_money?: Money
  scope?: OrderLineItemTaxScope
  auto_applied?: boolean
}

/**
 * Order discount
 */
export interface OrderLineItemDiscount {
  uid?: string
  catalog_object_id?: string
  catalog_version?: number
  name?: string
  type?: OrderLineItemDiscountType
  percentage?: string
  amount_money?: Money
  applied_money?: Money
  metadata?: Record<string, string>
  scope?: OrderLineItemDiscountScope
  reward_ids?: string[]
  pricing_rule_id?: string
}

/**
 * Order service charge
 */
export interface OrderServiceCharge {
  uid?: string
  name?: string
  catalog_object_id?: string
  catalog_version?: number
  percentage?: string
  amount_money?: Money
  applied_money?: Money
  total_money?: Money
  total_tax_money?: Money
  calculation_phase?: 'SUBTOTAL_PHASE' | 'TOTAL_PHASE' | 'APPORTIONED_PERCENTAGE_PHASE' | 'APPORTIONED_AMOUNT_PHASE'
  taxable?: boolean
  applied_taxes?: OrderLineItemAppliedTax[]
  metadata?: Record<string, string>
  type?: 'AUTO_GRATUITY' | 'CUSTOM'
  treatment_type?: 'LINE_ITEM_TREATMENT' | 'APPORTIONED_TREATMENT'
  scope?: 'OTHER_SERVICE_CHARGE_SCOPE' | 'LINE_ITEM' | 'ORDER'
}

/**
 * Order fulfillment
 */
export interface OrderFulfillment {
  uid?: string
  type?: 'PICKUP' | 'SHIPMENT' | 'DELIVERY'
  state?: 'PROPOSED' | 'RESERVED' | 'PREPARED' | 'COMPLETED' | 'CANCELED' | 'FAILED'
  line_item_application?: 'ALL' | 'ENTRY_LIST'
  entries?: { uid?: string; line_item_uid?: string; quantity?: string; metadata?: Record<string, string> }[]
  metadata?: Record<string, string>
  pickup_details?: { recipient?: { customer_id?: string; display_name?: string; email_address?: string; phone_number?: string; address?: Address }; expires_at?: string; auto_complete_duration?: string; schedule_type?: 'SCHEDULED' | 'ASAP'; pickup_at?: string; pickup_window_duration?: string; prep_time_duration?: string; note?: string; placed_at?: string; accepted_at?: string; rejected_at?: string; ready_at?: string; expired_at?: string; picked_up_at?: string; canceled_at?: string; cancel_reason?: string; is_curbside_pickup?: boolean; curbside_pickup_details?: { curbside_details?: string; buyer_arrived_at?: string } }
  shipment_details?: { recipient?: { customer_id?: string; display_name?: string; email_address?: string; phone_number?: string; address?: Address }; carrier?: string; shipping_note?: string; shipping_type?: string; tracking_number?: string; tracking_url?: string; placed_at?: string; in_progress_at?: string; packaged_at?: string; expected_shipped_at?: string; shipped_at?: string; canceled_at?: string; cancel_reason?: string; failed_at?: string; failure_reason?: string }
  delivery_details?: { recipient?: { customer_id?: string; display_name?: string; email_address?: string; phone_number?: string; address?: Address }; schedule_type?: 'SCHEDULED' | 'ASAP'; placed_at?: string; deliver_at?: string; prep_time_duration?: string; delivery_window_duration?: string; note?: string; completed_at?: string; in_progress_at?: string; rejected_at?: string; ready_at?: string; delivered_at?: string; canceled_at?: string; cancel_reason?: string; courier_pickup_at?: string; courier_pickup_window_duration?: string; is_no_contact_delivery?: boolean; dropoff_notes?: string; courier_provider_name?: string; courier_support_phone_number?: string; square_delivery_id?: string; external_delivery_id?: string; managed_delivery?: boolean }
}

/**
 * Order source
 */
export interface OrderSource {
  name?: string
}

/**
 * Order money amounts
 */
export interface OrderMoneyAmounts {
  total_money?: Money
  tax_money?: Money
  discount_money?: Money
  tip_money?: Money
  service_charge_money?: Money
}

/**
 * Order object
 */
export interface Order {
  id?: string
  location_id: string
  reference_id?: string
  source?: OrderSource
  customer_id?: string
  line_items?: OrderLineItem[]
  taxes?: OrderLineItemTax[]
  discounts?: OrderLineItemDiscount[]
  service_charges?: OrderServiceCharge[]
  fulfillments?: OrderFulfillment[]
  returns?: OrderReturn[]
  return_amounts?: OrderMoneyAmounts
  net_amounts?: OrderMoneyAmounts
  net_amount_due_money?: Money
  rounding_adjustment?: { uid?: string; name?: string; amount_money?: Money }
  tenders?: OrderTender[]
  refunds?: OrderRefund[]
  metadata?: Record<string, string>
  created_at?: string
  updated_at?: string
  closed_at?: string
  state?: OrderState
  version?: number
  total_money?: Money
  total_tax_money?: Money
  total_discount_money?: Money
  total_tip_money?: Money
  total_service_charge_money?: Money
  ticket_name?: string
  pricing_options?: { auto_apply_discounts?: boolean; auto_apply_taxes?: boolean }
  rewards?: { id: string; reward_tier_id: string }[]
}

/**
 * Order return
 */
export interface OrderReturn {
  uid?: string
  source_order_id?: string
  return_line_items?: OrderReturnLineItem[]
  return_service_charges?: { uid?: string; source_service_charge_uid?: string; name?: string; catalog_object_id?: string; percentage?: string; amount_money?: Money; applied_money?: Money; total_money?: Money; total_tax_money?: Money; calculation_phase?: string; taxable?: boolean; applied_taxes?: OrderLineItemAppliedTax[]; treatment_type?: string; scope?: string }[]
  return_taxes?: { uid?: string; source_tax_uid?: string; catalog_object_id?: string; name?: string; type?: string; percentage?: string; applied_money?: Money; scope?: string }[]
  return_discounts?: { uid?: string; source_discount_uid?: string; catalog_object_id?: string; name?: string; type?: string; percentage?: string; amount_money?: Money; applied_money?: Money; scope?: string }[]
  rounding_adjustment?: { uid?: string; name?: string; amount_money?: Money }
  return_amounts?: OrderMoneyAmounts
}

/**
 * Order return line item
 */
export interface OrderReturnLineItem {
  uid?: string
  source_line_item_uid?: string
  name?: string
  quantity: string
  quantity_unit?: OrderLineItem['quantity_unit']
  note?: string
  catalog_object_id?: string
  catalog_version?: number
  variation_name?: string
  item_type?: 'ITEM' | 'CUSTOM_AMOUNT' | 'GIFT_CARD'
  return_modifiers?: { uid?: string; source_modifier_uid?: string; catalog_object_id?: string; name?: string; base_price_money?: Money; total_price_money?: Money; quantity?: string }[]
  applied_taxes?: OrderLineItemAppliedTax[]
  applied_discounts?: OrderLineItemAppliedDiscount[]
  base_price_money?: Money
  variation_total_price_money?: Money
  gross_return_money?: Money
  total_tax_money?: Money
  total_discount_money?: Money
  total_money?: Money
  applied_service_charges?: { uid?: string; service_charge_uid?: string; applied_money?: Money }[]
  total_service_charge_money?: Money
}

/**
 * Order tender
 */
export interface OrderTender {
  id?: string
  location_id?: string
  transaction_id?: string
  created_at?: string
  note?: string
  amount_money?: Money
  tip_money?: Money
  processing_fee_money?: Money
  customer_id?: string
  type?: 'CARD' | 'CASH' | 'THIRD_PARTY_CARD' | 'SQUARE_GIFT_CARD' | 'NO_SALE' | 'BANK_ACCOUNT' | 'WALLET' | 'BUY_NOW_PAY_LATER' | 'SQUARE_ACCOUNT' | 'OTHER'
  card_details?: { status?: 'AUTHORIZED' | 'CAPTURED' | 'VOIDED' | 'FAILED'; card?: Card; entry_method?: 'SWIPED' | 'KEYED' | 'EMV' | 'ON_FILE' | 'CONTACTLESS' }
  cash_details?: { buyer_tendered_money?: Money; change_back_money?: Money }
  payment_id?: string
}

/**
 * Order refund
 */
export interface OrderRefund {
  id?: string
  location_id?: string
  transaction_id?: string
  tender_id?: string
  created_at?: string
  reason?: string
  amount_money?: Money
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'FAILED'
  processing_fee_money?: Money
}

/**
 * Order create params
 */
export interface OrderCreateParams {
  order: Omit<Order, 'id' | 'created_at' | 'updated_at' | 'version'>
  idempotency_key?: string
}

/**
 * Order update params
 */
export interface OrderUpdateParams {
  order?: Partial<Order>
  fields_to_clear?: string[]
  idempotency_key?: string
}

/**
 * Order pay params
 */
export interface OrderPayParams {
  idempotency_key: string
  order_version?: number
  payment_ids?: string[]
}

/**
 * Order search params
 */
export interface OrderSearchParams {
  location_ids?: string[]
  cursor?: string
  query?: {
    filter?: {
      state_filter?: { states: OrderState[] }
      date_time_filter?: { created_at?: { start_at?: string; end_at?: string }; updated_at?: { start_at?: string; end_at?: string }; closed_at?: { start_at?: string; end_at?: string } }
      fulfillment_filter?: { fulfillment_types?: ('PICKUP' | 'SHIPMENT' | 'DELIVERY')[]; fulfillment_states?: string[] }
      source_filter?: { source_names?: string[] }
      customer_filter?: { customer_ids?: string[] }
    }
    sort?: { sort_field?: 'CREATED_AT' | 'UPDATED_AT' | 'CLOSED_AT'; sort_order?: 'ASC' | 'DESC' }
  }
  limit?: number
  return_entries?: boolean
}

// =============================================================================
// Inventory Types
// =============================================================================

/**
 * Inventory state
 */
export type InventoryState = 'CUSTOM' | 'IN_STOCK' | 'SOLD' | 'RETURNED_BY_CUSTOMER' | 'RESERVED_FOR_SALE' | 'SOLD_ONLINE' | 'ORDERED_FROM_VENDOR' | 'RECEIVED_FROM_VENDOR' | 'IN_TRANSIT_TO' | 'NONE' | 'WASTE' | 'UNLINKED_RETURN' | 'COMPOSED' | 'DECOMPOSED' | 'SUPPORTED_BY_NEWER_VERSION'

/**
 * Inventory adjustment
 */
export interface InventoryAdjustment {
  id?: string
  reference_id?: string
  from_state?: InventoryState
  to_state?: InventoryState
  location_id?: string
  catalog_object_id?: string
  catalog_object_type?: string
  quantity?: string
  total_price_money?: Money
  occurred_at?: string
  created_at?: string
  source?: { product?: string; application_id?: string; name?: string }
  employee_id?: string
  team_member_id?: string
  transaction_id?: string
  refund_id?: string
  purchase_order_id?: string
  goods_receipt_id?: string
  adjustment_group?: { id?: string; root_adjustment_id?: string }
}

/**
 * Inventory count
 */
export interface InventoryCount {
  catalog_object_id?: string
  catalog_object_type?: string
  state?: InventoryState
  location_id?: string
  quantity?: string
  calculated_at?: string
  is_estimated?: boolean
}

/**
 * Inventory physical count
 */
export interface InventoryPhysicalCount {
  id?: string
  reference_id?: string
  catalog_object_id?: string
  catalog_object_type?: string
  state?: InventoryState
  location_id?: string
  quantity?: string
  source?: { product?: string; application_id?: string; name?: string }
  employee_id?: string
  team_member_id?: string
  occurred_at?: string
  created_at?: string
}

/**
 * Inventory transfer
 */
export interface InventoryTransfer {
  id?: string
  reference_id?: string
  state?: InventoryState
  from_location_id?: string
  to_location_id?: string
  catalog_object_id?: string
  catalog_object_type?: string
  quantity?: string
  occurred_at?: string
  created_at?: string
  source?: { product?: string; application_id?: string; name?: string }
  employee_id?: string
  team_member_id?: string
}

/**
 * Inventory change
 */
export interface InventoryChange {
  type?: 'PHYSICAL_COUNT' | 'ADJUSTMENT' | 'TRANSFER'
  physical_count?: InventoryPhysicalCount
  adjustment?: InventoryAdjustment
  transfer?: InventoryTransfer
  measurement_unit?: { measurement_unit?: { custom_unit?: { name: string; abbreviation: string }; area_unit?: string; length_unit?: string; volume_unit?: string; weight_unit?: string; generic_unit?: string; time_unit?: string; type?: string }; precision?: number }
  measurement_unit_id?: string
}

/**
 * Inventory batch change params
 */
export interface InventoryBatchChangeParams {
  idempotency_key: string
  changes?: InventoryChange[]
  ignore_unchanged_counts?: boolean
}

/**
 * Inventory batch retrieve counts params
 */
export interface InventoryBatchRetrieveCountsParams {
  catalog_object_ids?: string[]
  location_ids?: string[]
  updated_after?: string
  cursor?: string
  states?: InventoryState[]
  limit?: number
}

/**
 * Inventory retrieve params
 */
export interface InventoryRetrieveParams {
  location_ids?: string[]
  cursor?: string
  limit?: number
}
