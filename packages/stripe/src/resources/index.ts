/**
 * Stripe Resources - Local Implementation
 *
 * Export all local resource implementations for standalone usage.
 */

// Customers (TemporalStore)
export { LocalCustomersResource, type CustomersResourceOptions } from './customers'

// Products & Prices
export {
  LocalProductsResource,
  LocalPricesResource,
  type Product,
  type ProductCreateParams,
  type ProductUpdateParams,
  type ProductListParams,
  type PriceCreateParams,
  type PriceUpdateParams,
  type PriceListParams,
  type ProductsResourceOptions,
} from './products'

// Subscriptions (WindowManager)
export { LocalSubscriptionsResource, type SubscriptionsResourceOptions } from './subscriptions'

// Payments (ExactlyOnceContext)
export {
  LocalPaymentIntentsResource,
  LocalChargesResource,
  LocalRefundsResource,
  type PaymentsResourceOptions,
} from './payments'

// Webhooks
export {
  LocalWebhooksResource,
  Webhooks,
  type WebhookEndpoint,
  type WebhookDeliveryAttempt,
  type WebhooksResourceOptions,
} from './webhooks'
