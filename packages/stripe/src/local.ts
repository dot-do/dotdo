/**
 * StripeLocal - Complete Local Stripe Implementation
 *
 * Drop-in replacement for Stripe SDK that runs entirely locally.
 * Uses dotdo primitives:
 * - TemporalStore for customer state with time-travel queries
 * - ExactlyOnceContext for idempotent payment operations
 * - WindowManager for subscription billing cycles
 *
 * Perfect for:
 * - Testing without network calls
 * - Edge deployment (Cloudflare Workers)
 * - Development environments
 *
 * @example
 * ```typescript
 * import { StripeLocal } from '@dotdo/stripe/local'
 *
 * // Create local Stripe instance
 * const stripe = new StripeLocal()
 *
 * // Use exactly like real Stripe SDK
 * const customer = await stripe.customers.create({
 *   email: 'test@example.com',
 * })
 *
 * const paymentIntent = await stripe.paymentIntents.create({
 *   amount: 2000,
 *   currency: 'usd',
 *   customer: customer.id,
 * })
 *
 * // Confirm with idempotency
 * const confirmed = await stripe.paymentIntents.confirm(paymentIntent.id, {}, {
 *   idempotencyKey: 'unique-key-123'
 * })
 * ```
 */

import { LocalCustomersResource } from './resources/customers'
import { LocalProductsResource, LocalPricesResource, type Product } from './resources/products'
import { LocalSubscriptionsResource } from './resources/subscriptions'
import {
  LocalPaymentIntentsResource,
  LocalChargesResource,
  LocalRefundsResource,
} from './resources/payments'
import { LocalWebhooksResource, Webhooks } from './resources/webhooks'
import type {
  Customer,
  CustomerCreateParams,
  CustomerUpdateParams,
  CustomerListParams,
  DeletedCustomer,
  Subscription,
  SubscriptionCreateParams,
  SubscriptionUpdateParams,
  SubscriptionListParams,
  SubscriptionCancelParams,
  PaymentIntent,
  PaymentIntentCreateParams,
  PaymentIntentUpdateParams,
  PaymentIntentConfirmParams,
  PaymentIntentCaptureParams,
  PaymentIntentCancelParams,
  PaymentIntentListParams,
  Charge,
  ChargeCreateParams,
  ChargeUpdateParams,
  ChargeCaptureParams,
  ChargeListParams,
  Refund,
  RefundCreateParams,
  RefundUpdateParams,
  RefundListParams,
  Price,
  ListResponse,
  WebhookEvent,
  WebhookEventType,
  Metadata,
} from './types'
import type {
  ProductCreateParams,
  ProductUpdateParams,
  ProductListParams,
  PriceCreateParams,
  PriceUpdateParams,
  PriceListParams,
} from './resources/products'

export interface StripeLocalConfig {
  /** Enable webhook event generation */
  webhooks?: boolean
  /** Callback for webhook events */
  onWebhookEvent?: (event: WebhookEvent) => void | Promise<void>
}

export interface RequestOptions {
  idempotencyKey?: string
  stripeAccount?: string
}

/**
 * StripeLocal - Local Stripe implementation
 *
 * Provides the same API as the Stripe SDK but runs entirely in-memory.
 * Perfect for testing and edge deployment.
 */
export class StripeLocal {
  private config: StripeLocalConfig
  private webhooksResource: LocalWebhooksResource
  private customersResource: LocalCustomersResource
  private productsResource: LocalProductsResource
  private pricesResource: LocalPricesResource
  private subscriptionsResource: LocalSubscriptionsResource
  private paymentIntentsResource: LocalPaymentIntentsResource
  private chargesResource: LocalChargesResource
  private refundsResource: LocalRefundsResource

  // Public resource accessors
  readonly customers: CustomersAPI
  readonly products: ProductsAPI
  readonly prices: PricesAPI
  readonly subscriptions: SubscriptionsAPI
  readonly paymentIntents: PaymentIntentsAPI
  readonly charges: ChargesAPI
  readonly refunds: RefundsAPI
  readonly webhookEndpoints: WebhookEndpointsAPI

  // Static webhooks utility
  static readonly webhooks = Webhooks

  constructor(config?: StripeLocalConfig) {
    this.config = config ?? {}

    // Initialize webhooks resource
    this.webhooksResource = new LocalWebhooksResource({
      onDeliver: async (endpoint, event) => {
        // Deliver to configured callback
        if (this.config.onWebhookEvent) {
          await this.config.onWebhookEvent(event)
        }
        return { status: 200, body: '{"received": true}' }
      },
    })

    // Event handler that creates webhook events
    const onEvent = this.config.webhooks !== false
      ? (type: string, data: unknown) => {
          const event = this.webhooksResource.createEvent(type as WebhookEventType, data)
          // Direct delivery to callback if no endpoints configured
          if (this.config.onWebhookEvent) {
            Promise.resolve(this.config.onWebhookEvent(event)).catch(() => {})
          }
          // Also deliver to registered endpoints
          this.webhooksResource.deliverEvents().catch(() => {})
        }
      : undefined

    // Initialize all resources with event handlers
    this.customersResource = new LocalCustomersResource({ onEvent })
    this.productsResource = new LocalProductsResource({ onEvent })
    this.pricesResource = new LocalPricesResource(this.productsResource, { onEvent })
    this.subscriptionsResource = new LocalSubscriptionsResource({
      pricesResource: this.pricesResource,
      onEvent,
    })
    this.paymentIntentsResource = new LocalPaymentIntentsResource({ onEvent })
    this.chargesResource = new LocalChargesResource(this.paymentIntentsResource, { onEvent })
    this.refundsResource = new LocalRefundsResource(
      this.chargesResource,
      this.paymentIntentsResource,
      { onEvent }
    )

    // Create public API wrappers
    this.customers = new CustomersAPI(this.customersResource)
    this.products = new ProductsAPI(this.productsResource)
    this.prices = new PricesAPI(this.pricesResource)
    this.subscriptions = new SubscriptionsAPI(this.subscriptionsResource)
    this.paymentIntents = new PaymentIntentsAPI(this.paymentIntentsResource)
    this.charges = new ChargesAPI(this.chargesResource)
    this.refunds = new RefundsAPI(this.refundsResource)
    this.webhookEndpoints = new WebhookEndpointsAPI(this.webhooksResource)
  }

  /**
   * Access to raw webhook events
   */
  get events(): EventsAPI {
    return new EventsAPI(this.webhooksResource)
  }

  /**
   * Clear all state (for testing)
   */
  async clear(): Promise<void> {
    await this.paymentIntentsResource.clear()
    await this.webhooksResource.clear()
    // Note: Other resources don't have clear() but could be added
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.subscriptionsResource.dispose()
  }
}

// =============================================================================
// API Wrappers
// =============================================================================

class CustomersAPI {
  constructor(private resource: LocalCustomersResource) {}

  create(params: CustomerCreateParams, options?: RequestOptions): Promise<Customer> {
    return this.resource.create(params)
  }

  retrieve(id: string, options?: RequestOptions): Promise<Customer> {
    return this.resource.retrieve(id)
  }

  update(id: string, params: CustomerUpdateParams, options?: RequestOptions): Promise<Customer> {
    return this.resource.update(id, params)
  }

  del(id: string, options?: RequestOptions): Promise<DeletedCustomer> {
    return this.resource.del(id)
  }

  list(params?: CustomerListParams, options?: RequestOptions): Promise<ListResponse<Customer>> {
    return this.resource.list(params)
  }

  search(
    params: { query: string; limit?: number; page?: string },
    options?: RequestOptions
  ): Promise<{ data: Customer[]; has_more: boolean; next_page?: string }> {
    return this.resource.search(params)
  }

  /**
   * Time-travel query (StripeLocal extension)
   */
  retrieveAsOf(id: string, timestamp: number): Promise<Customer | null> {
    return this.resource.retrieveAsOf(id, timestamp)
  }
}

class ProductsAPI {
  constructor(private resource: LocalProductsResource) {}

  create(params: ProductCreateParams, options?: RequestOptions): Promise<Product> {
    return this.resource.create(params)
  }

  retrieve(id: string, options?: RequestOptions): Promise<Product> {
    return this.resource.retrieve(id)
  }

  update(id: string, params: ProductUpdateParams, options?: RequestOptions): Promise<Product> {
    return this.resource.update(id, params)
  }

  del(id: string, options?: RequestOptions): Promise<{ id: string; object: 'product'; deleted: true }> {
    return this.resource.del(id)
  }

  list(params?: ProductListParams, options?: RequestOptions): Promise<ListResponse<Product>> {
    return this.resource.list(params)
  }
}

class PricesAPI {
  constructor(private resource: LocalPricesResource) {}

  create(params: PriceCreateParams, options?: RequestOptions): Promise<Price> {
    return this.resource.create(params)
  }

  retrieve(id: string, options?: RequestOptions): Promise<Price> {
    return this.resource.retrieve(id)
  }

  update(id: string, params: PriceUpdateParams, options?: RequestOptions): Promise<Price> {
    return this.resource.update(id, params)
  }

  list(params?: PriceListParams, options?: RequestOptions): Promise<ListResponse<Price>> {
    return this.resource.list(params)
  }

  /**
   * Retrieve by lookup key (StripeLocal extension)
   */
  retrieveByLookupKey(lookupKey: string): Promise<Price | null> {
    return this.resource.retrieveByLookupKey(lookupKey)
  }
}

class SubscriptionsAPI {
  constructor(private resource: LocalSubscriptionsResource) {}

  create(params: SubscriptionCreateParams, options?: RequestOptions): Promise<Subscription> {
    return this.resource.create(params)
  }

  retrieve(id: string, options?: RequestOptions): Promise<Subscription> {
    return this.resource.retrieve(id)
  }

  update(id: string, params: SubscriptionUpdateParams, options?: RequestOptions): Promise<Subscription> {
    return this.resource.update(id, params)
  }

  cancel(id: string, params?: SubscriptionCancelParams, options?: RequestOptions): Promise<Subscription> {
    return this.resource.cancel(id, params)
  }

  resume(
    id: string,
    params?: { billing_cycle_anchor?: 'now' | 'unchanged'; proration_behavior?: 'always_invoice' | 'create_prorations' | 'none' },
    options?: RequestOptions
  ): Promise<Subscription> {
    return this.resource.resume(id, params)
  }

  list(params?: SubscriptionListParams, options?: RequestOptions): Promise<ListResponse<Subscription>> {
    return this.resource.list(params)
  }

  search(
    params: { query: string; limit?: number; page?: string },
    options?: RequestOptions
  ): Promise<{ data: Subscription[]; has_more: boolean; next_page?: string }> {
    return this.resource.search(params)
  }

  /**
   * Advance billing for testing (StripeLocal extension)
   */
  advanceBilling(toTimestamp: number): void {
    this.resource.advanceBilling(toTimestamp)
  }
}

class PaymentIntentsAPI {
  constructor(private resource: LocalPaymentIntentsResource) {}

  create(params: PaymentIntentCreateParams, options?: RequestOptions): Promise<PaymentIntent> {
    return this.resource.create(params, { idempotencyKey: options?.idempotencyKey })
  }

  retrieve(id: string, options?: RequestOptions): Promise<PaymentIntent> {
    return this.resource.retrieve(id)
  }

  update(id: string, params: PaymentIntentUpdateParams, options?: RequestOptions): Promise<PaymentIntent> {
    return this.resource.update(id, params)
  }

  confirm(id: string, params?: PaymentIntentConfirmParams, options?: RequestOptions): Promise<PaymentIntent> {
    return this.resource.confirm(id, params, { idempotencyKey: options?.idempotencyKey })
  }

  capture(id: string, params?: PaymentIntentCaptureParams, options?: RequestOptions): Promise<PaymentIntent> {
    return this.resource.capture(id, params, { idempotencyKey: options?.idempotencyKey })
  }

  cancel(id: string, params?: PaymentIntentCancelParams, options?: RequestOptions): Promise<PaymentIntent> {
    return this.resource.cancel(id, params, { idempotencyKey: options?.idempotencyKey })
  }

  list(params?: PaymentIntentListParams, options?: RequestOptions): Promise<ListResponse<PaymentIntent>> {
    return this.resource.list(params)
  }

  search(
    params: { query: string; limit?: number; page?: string },
    options?: RequestOptions
  ): Promise<{ data: PaymentIntent[]; has_more: boolean; next_page?: string }> {
    return this.resource.search(params)
  }

  incrementAuthorization(
    id: string,
    params: { amount: number; description?: string; metadata?: Metadata },
    options?: RequestOptions
  ): Promise<PaymentIntent> {
    return this.resource.incrementAuthorization(id, params)
  }
}

class ChargesAPI {
  constructor(private resource: LocalChargesResource) {}

  /**
   * @deprecated Use PaymentIntents instead
   */
  create(params: ChargeCreateParams, options?: RequestOptions): Promise<Charge> {
    return this.resource.create(params)
  }

  retrieve(id: string, options?: RequestOptions): Promise<Charge> {
    return this.resource.retrieve(id)
  }

  update(id: string, params: ChargeUpdateParams, options?: RequestOptions): Promise<Charge> {
    return this.resource.update(id, params)
  }

  capture(id: string, params?: ChargeCaptureParams, options?: RequestOptions): Promise<Charge> {
    return this.resource.capture(id, params)
  }

  list(params?: ChargeListParams, options?: RequestOptions): Promise<ListResponse<Charge>> {
    return this.resource.list(params)
  }
}

class RefundsAPI {
  constructor(private resource: LocalRefundsResource) {}

  create(params: RefundCreateParams, options?: RequestOptions): Promise<Refund> {
    return this.resource.create(params)
  }

  retrieve(id: string, options?: RequestOptions): Promise<Refund> {
    return this.resource.retrieve(id)
  }

  update(id: string, params: RefundUpdateParams, options?: RequestOptions): Promise<Refund> {
    return this.resource.update(id, params)
  }

  cancel(id: string, options?: RequestOptions): Promise<Refund> {
    return this.resource.cancel(id)
  }

  list(params?: RefundListParams, options?: RequestOptions): Promise<ListResponse<Refund>> {
    return this.resource.list(params)
  }
}

class WebhookEndpointsAPI {
  constructor(private resource: LocalWebhooksResource) {}

  create(
    params: { url: string; enabled_events: string[]; metadata?: Record<string, string> },
    options?: RequestOptions
  ) {
    return this.resource.createEndpoint(params)
  }

  retrieve(id: string, options?: RequestOptions) {
    return this.resource.retrieveEndpoint(id)
  }

  update(
    id: string,
    params: { url?: string; enabled_events?: string[]; disabled?: boolean; metadata?: Record<string, string> },
    options?: RequestOptions
  ) {
    return this.resource.updateEndpoint(id, params)
  }

  del(id: string, options?: RequestOptions) {
    return this.resource.deleteEndpoint(id)
  }

  list(params?: { limit?: number; starting_after?: string }, options?: RequestOptions) {
    return this.resource.listEndpoints(params)
  }
}

class EventsAPI {
  constructor(private resource: LocalWebhooksResource) {}

  retrieve(id: string, options?: RequestOptions): Promise<WebhookEvent> {
    return this.resource.retrieveEvent(id)
  }

  list(
    params?: {
      type?: string
      types?: string[]
      created?: { gt?: number; gte?: number; lt?: number; lte?: number }
      delivery_success?: boolean
      limit?: number
      starting_after?: string
    },
    options?: RequestOptions
  ): Promise<{ object: 'list'; data: WebhookEvent[]; has_more: boolean }> {
    return this.resource.listEvents(params)
  }
}

// =============================================================================
// Exports
// =============================================================================

export default StripeLocal

// Re-export types
export type {
  Customer,
  CustomerCreateParams,
  CustomerUpdateParams,
  CustomerListParams,
  DeletedCustomer,
  Subscription,
  SubscriptionCreateParams,
  SubscriptionUpdateParams,
  SubscriptionListParams,
  SubscriptionCancelParams,
  PaymentIntent,
  PaymentIntentCreateParams,
  PaymentIntentUpdateParams,
  PaymentIntentConfirmParams,
  PaymentIntentCaptureParams,
  PaymentIntentCancelParams,
  PaymentIntentListParams,
  Charge,
  ChargeCreateParams,
  ChargeUpdateParams,
  ChargeCaptureParams,
  ChargeListParams,
  Refund,
  RefundCreateParams,
  RefundUpdateParams,
  RefundListParams,
  Price,
  ListResponse,
  WebhookEvent,
  WebhookEventType,
  Metadata,
  Product,
  ProductCreateParams,
  ProductUpdateParams,
  ProductListParams,
  PriceCreateParams,
  PriceUpdateParams,
  PriceListParams,
}
