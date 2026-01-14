/**
 * @dotdo/square - Square API Compatibility Layer for Cloudflare Workers
 *
 * Drop-in replacement for Square SDK with edge compatibility.
 *
 * @example
 * ```typescript
 * import { Square } from '@dotdo/square'
 *
 * const square = new Square(env.SQUARE_ACCESS_TOKEN, { environment: 'sandbox' })
 *
 * // Create a payment
 * const { payment } = await square.payments.create({
 *   source_id: 'cnon:card-nonce-ok',
 *   idempotency_key: crypto.randomUUID(),
 *   amount_money: { amount: 1000, currency: 'USD' },
 * })
 *
 * // Create a customer
 * const { customer } = await square.customers.create({
 *   given_name: 'John',
 *   family_name: 'Doe',
 *   email_address: 'john@example.com',
 * })
 *
 * // Manage catalog
 * const { objects } = await square.catalog.list({ types: ['ITEM'] })
 *
 * // Verify webhook signature
 * const event = await Square.webhooks.constructEvent(
 *   request.body,
 *   request.headers.get('x-square-hmacsha256-signature'),
 *   env.SQUARE_WEBHOOK_KEY,
 *   'https://example.com/webhook'
 * )
 * ```
 *
 * @module @dotdo/square
 */

// =============================================================================
// Main Client
// =============================================================================

export {
  Square,
  SquareAPIError,
  Webhooks,
  // Resources
  LocationsResource,
  CustomersResource,
  PaymentsResource,
  RefundsResource,
  CatalogResource,
  OrdersResource,
  InventoryResource,
  // Config type
  type SquareConfig,
} from './square'

// =============================================================================
// Types
// =============================================================================

export type {
  // Common types
  Money,
  Address,
  ListResponse,
  BatchResponse,
  SquareError,
  SquareErrorResponse,
  RequestOptions,

  // Location types
  Location,
  LocationStatus,
  LocationType,
  LocationCapability,
  BusinessHours,
  BusinessHoursPeriod,
  TaxIds,

  // Customer types
  Customer,
  CustomerCreateParams,
  CustomerUpdateParams,
  CustomerListParams,
  CustomerQuery,
  CustomerFilter,
  CustomerSort,
  CustomerCreationSource,
  CustomerPreferences,
  CustomerTaxIds,

  // Payment types
  Payment,
  PaymentCreateParams,
  PaymentUpdateParams,
  PaymentCompleteParams,
  PaymentCancelParams,
  PaymentListParams,
  PaymentStatus,
  PaymentSourceType,
  CardBrand,
  CardPaymentDetails,
  Card,
  DeviceDetails,
  ExternalPaymentDetails,
  ProcessingFee,
  RiskEvaluation,

  // Refund types
  Refund,
  RefundPaymentParams,
  RefundListParams,
  RefundStatus,
  RefundDestinationType,
  RefundDestinationDetails,

  // Catalog types
  CatalogObject,
  CatalogObjectType,
  CatalogItem,
  CatalogItemProductType,
  CatalogItemVariation,
  CatalogItemModifierListInfo,
  CatalogCategory,
  CatalogModifier,
  CatalogModifierList,
  CatalogDiscount,
  CatalogTax,
  CatalogImage,
  CatalogPricingType,
  CatalogBatchUpsertParams,
  CatalogBatchRetrieveParams,
  CatalogBatchDeleteParams,
  CatalogListParams,
  CatalogSearchParams,
  CatalogQuery,
  CatalogItemOptionValueForItemVariation,

  // Order types
  Order,
  OrderState,
  OrderLineItem,
  OrderLineItemModifier,
  OrderLineItemAppliedTax,
  OrderLineItemAppliedDiscount,
  OrderLineItemTax,
  OrderLineItemDiscount,
  OrderLineItemDiscountScope,
  OrderLineItemDiscountType,
  OrderLineItemTaxScope,
  OrderLineItemTaxType,
  OrderServiceCharge,
  OrderFulfillment,
  OrderSource,
  OrderMoneyAmounts,
  OrderReturn,
  OrderReturnLineItem,
  OrderTender,
  OrderRefund,
  OrderCreateParams,
  OrderUpdateParams,
  OrderPayParams,
  OrderSearchParams,

  // Inventory types
  InventoryChange,
  InventoryCount,
  InventoryAdjustment,
  InventoryPhysicalCount,
  InventoryTransfer,
  InventoryState,
  InventoryBatchChangeParams,
  InventoryBatchRetrieveCountsParams,
  InventoryRetrieveParams,
} from './types'

// =============================================================================
// Default Export
// =============================================================================

export { default } from './square'
