/**
 * @dotdo/stripe - Stripe API Compatibility Layer for Cloudflare Workers
 *
 * Drop-in replacement for Stripe SDK with edge compatibility.
 *
 * @example
 * ```typescript
 * import { Stripe } from '@dotdo/stripe'
 *
 * const stripe = new Stripe(env.STRIPE_SECRET_KEY)
 *
 * // Create a customer
 * const customer = await stripe.customers.create({
 *   email: 'customer@example.com',
 *   name: 'John Doe',
 * })
 *
 * // Create a subscription
 * const subscription = await stripe.subscriptions.create({
 *   customer: customer.id,
 *   items: [{ price: 'price_xxx' }],
 * })
 *
 * // Create a payment intent
 * const paymentIntent = await stripe.paymentIntents.create({
 *   amount: 2000,
 *   currency: 'usd',
 *   customer: customer.id,
 * })
 *
 * // Verify webhook signature
 * const event = await Stripe.webhooks.constructEvent(
 *   request.body,
 *   request.headers.get('stripe-signature'),
 *   env.STRIPE_WEBHOOK_SECRET
 * )
 * ```
 *
 * @module @dotdo/stripe
 */

// =============================================================================
// Main Client
// =============================================================================

export {
  Stripe,
  StripeAPIError,
  Webhooks,
  // Resources
  CustomersResource,
  SubscriptionsResource,
  PaymentIntentsResource,
  ChargesResource,
  RefundsResource,
  PaymentMethodsResource,
  // Config type
  type StripeConfig,
} from './stripe'

// =============================================================================
// Types
// =============================================================================

export type {
  // Core types
  Metadata,
  Address,
  Shipping,
  ListResponse,
  ListParams,
  DeletedObject,

  // Customer types
  Customer,
  CustomerCreateParams,
  CustomerUpdateParams,
  CustomerListParams,
  CustomerInvoiceSettings,
  DeletedCustomer,

  // Subscription types
  Subscription,
  SubscriptionStatus,
  SubscriptionItem,
  SubscriptionPaymentSettings,
  SubscriptionCreateParams,
  SubscriptionUpdateParams,
  SubscriptionListParams,
  SubscriptionCancelParams,

  // Payment Intent types
  PaymentIntent,
  PaymentIntentStatus,
  PaymentIntentCancellationReason,
  PaymentIntentNextAction,
  PaymentIntentCreateParams,
  PaymentIntentUpdateParams,
  PaymentIntentConfirmParams,
  PaymentIntentCaptureParams,
  PaymentIntentCancelParams,
  PaymentIntentListParams,

  // Charge types
  Charge,
  ChargeOutcome,
  BillingDetails,
  PaymentMethodDetails,
  ChargeCreateParams,
  ChargeUpdateParams,
  ChargeCaptureParams,
  ChargeListParams,

  // Refund types
  Refund,
  RefundReason,
  RefundCreateParams,
  RefundUpdateParams,
  RefundListParams,

  // Payment Method types
  PaymentMethod,
  PaymentMethodData,

  // Setup Intent types
  SetupIntent,

  // Price types
  Price,
  PriceData,

  // Tax types
  TaxRate,

  // Discount types
  Discount,
  Coupon,

  // Webhook types
  WebhookEvent,
  WebhookEventType,

  // Error types
  StripeError,
  StripeErrorResponse,
  PaymentError,

  // Utility types
  RangeQueryParam,
  Expand,
  RequestOptions,
} from './types'

// =============================================================================
// Local Implementation (for testing and edge deployment)
// =============================================================================

export {
  StripeLocal,
  type StripeLocalConfig,
} from './local'

// =============================================================================
// Default Export
// =============================================================================

export { default } from './stripe'
