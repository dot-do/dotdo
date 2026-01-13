/**
 * payments.do - Payment Platform Service for dotdo
 *
 * Multi-provider payment processing with Stripe-compatible API.
 * Supports Stripe, Paddle, and LemonSqueezy with intelligent routing.
 *
 * Features:
 * - Stripe-compatible API surface
 * - Multi-provider routing (Stripe, Paddle, LemonSqueezy)
 * - Provider failover with circuit breaker
 * - Webhook handling with idempotency
 * - Durable Objects for state management
 * - Customer management with multi-provider sync
 * - Subscription lifecycle management
 * - Payment state machine
 *
 * @example Basic usage
 * ```typescript
 * import { Payments } from 'payments.do'
 *
 * const payments = new Payments({
 *   providers: [
 *     { provider: 'stripe', secretKey: 'sk_xxx', enabled: true, priority: 1 },
 *     { provider: 'paddle', apiKey: 'vendor_id', secretKey: 'auth_code', enabled: true, priority: 2 },
 *   ],
 *   defaultProvider: 'stripe',
 *   retryOnFail: true,
 * })
 *
 * // Create a customer
 * const customer = await payments.customers.create({
 *   email: 'customer@example.com',
 *   name: 'John Doe',
 * })
 *
 * // Create a payment intent
 * const paymentIntent = await payments.paymentIntents.create({
 *   amount: 2000,
 *   currency: 'usd',
 *   customer: customer.id,
 * })
 * ```
 *
 * @example Provider routing
 * ```typescript
 * const payments = new Payments({
 *   providers: [...],
 *   rules: [
 *     // Route EU currencies to Paddle for VAT handling
 *     { condition: { type: 'currency', currencies: ['eur', 'gbp'] }, provider: 'paddle' },
 *     // Route digital products to LemonSqueezy
 *     { condition: { type: 'product_type', types: ['digital'] }, provider: 'lemonsqueezy' },
 *   ],
 * })
 * ```
 *
 * @module payments.do
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Core types
  Metadata,
  Currency,
  Address,
  ListResponse,

  // Provider types
  PaymentProvider,
  ProviderConfig,
  RoutingRule,
  RoutingCondition,
  ProductType,
  ProviderResult,
  ProviderError,

  // Customer types
  Customer,
  CustomerCreateParams,
  CustomerUpdateParams,

  // Payment intent types
  PaymentIntent,
  PaymentIntentStatus,
  PaymentIntentCreateParams,
  PaymentIntentConfirmParams,
  PaymentIntentCaptureParams,
  PaymentIntentCancelParams,
  PaymentIntentCancellationReason,
  PaymentError,
  CaptureMethod,

  // Subscription types
  Subscription,
  SubscriptionStatus,
  SubscriptionItem,
  SubscriptionCreateParams,
  SubscriptionUpdateParams,
  SubscriptionCancelParams,
  SubscriptionCancellationFeedback,
  CollectionMethod,
  ProrationBehavior,

  // Price types
  Price,
  PriceData,
  PriceType,
  BillingScheme,
  RecurringInterval,

  // Payment method types
  PaymentMethod,
  PaymentMethodType,

  // Refund types
  Refund,
  RefundStatus,
  RefundReason,
  RefundCreateParams,

  // Webhook types
  WebhookEvent,
  WebhookEventType,
  WebhookEventLog,

  // State machine types
  PaymentState,
  PaymentStateType,
  PaymentStateTransition,

  // API types
  APIError,
  APIErrorResponse,
  RequestOptions,
} from './types'

// =============================================================================
// Providers
// =============================================================================

export {
  StripeProvider,
  PaddleProvider,
  LemonSqueezyProvider,
  PaymentRouter,
  createProvider,
} from './providers'

export type {
  PaymentProviderAdapter,
  StripeProviderConfig,
  PaddleProviderConfig,
  LemonSqueezyProviderConfig,
  PaymentRouterConfig,
} from './providers'

// =============================================================================
// Webhooks
// =============================================================================

export {
  verifyStripeSignature,
  verifyPaddleSignature,
  verifyLemonSqueezySignature,
  parseStripeEvent,
  parsePaddleEvent,
  parseLemonSqueezyEvent,
  InMemoryWebhookStorage,
  SQLiteWebhookStorage,
  WebhookHandler,
  generateTestStripeSignature,
} from './webhooks'

export type { WebhookEventStorage, WebhookHandlerConfig } from './webhooks'

// =============================================================================
// Durable Objects
// =============================================================================

export { CustomerDO, PaymentStateDO, WebhookLogDO } from './durable-objects'

// =============================================================================
// Payments Client
// =============================================================================

import type {
  Customer,
  CustomerCreateParams,
  CustomerUpdateParams,
  PaymentIntent,
  PaymentIntentCreateParams,
  PaymentIntentConfirmParams,
  PaymentIntentCaptureParams,
  PaymentIntentCancelParams,
  Subscription,
  SubscriptionCreateParams,
  SubscriptionUpdateParams,
  SubscriptionCancelParams,
  Refund,
  RefundCreateParams,
  ProviderConfig,
  RoutingRule,
  PaymentProvider,
  ProviderResult,
  Currency,
  RequestOptions,
} from './types'
import { PaymentRouter } from './providers'

export interface PaymentsConfig {
  providers: ProviderConfig[]
  defaultProvider: PaymentProvider
  rules?: RoutingRule[]
  retryOnFail?: boolean
  maxRetries?: number
}

/**
 * Customers resource
 */
class CustomersResource {
  constructor(private router: PaymentRouter) {}

  async create(params: CustomerCreateParams, options?: RequestOptions): Promise<ProviderResult<Customer>> {
    return this.router.execute((provider) => provider.createCustomer(params))
  }

  async retrieve(id: string, options?: RequestOptions): Promise<ProviderResult<Customer>> {
    return this.router.execute((provider) => provider.getCustomer(id))
  }
}

/**
 * Payment Intents resource
 */
class PaymentIntentsResource {
  constructor(private router: PaymentRouter) {}

  async create(params: PaymentIntentCreateParams, options?: RequestOptions): Promise<ProviderResult<PaymentIntent>> {
    const selectedProvider = this.router.selectProvider({
      currency: params.currency,
      amount: params.amount,
    })

    return this.router.execute(
      (provider) => provider.createPaymentIntent(params),
      params.provider || selectedProvider
    )
  }

  async confirm(id: string, params?: PaymentIntentConfirmParams, options?: RequestOptions): Promise<ProviderResult<PaymentIntent>> {
    return this.router.execute((provider) => provider.confirmPaymentIntent(id, params))
  }

  async capture(id: string, params?: PaymentIntentCaptureParams, options?: RequestOptions): Promise<ProviderResult<PaymentIntent>> {
    return this.router.execute((provider) => provider.capturePaymentIntent(id, params))
  }

  async cancel(id: string, params?: PaymentIntentCancelParams, options?: RequestOptions): Promise<ProviderResult<PaymentIntent>> {
    return this.router.execute((provider) => provider.cancelPaymentIntent(id))
  }
}

/**
 * Subscriptions resource
 */
class SubscriptionsResource {
  constructor(private router: PaymentRouter) {}

  async create(params: SubscriptionCreateParams, options?: RequestOptions): Promise<ProviderResult<Subscription>> {
    return this.router.execute(
      (provider) => provider.createSubscription(params),
      params.provider
    )
  }

  async cancel(id: string, params?: SubscriptionCancelParams, options?: RequestOptions): Promise<ProviderResult<Subscription>> {
    return this.router.execute((provider) => provider.cancelSubscription(id))
  }
}

/**
 * Refunds resource
 */
class RefundsResource {
  constructor(private router: PaymentRouter) {}

  async create(params: RefundCreateParams, options?: RequestOptions): Promise<ProviderResult<Refund>> {
    return this.router.execute((provider) => provider.createRefund(params))
  }
}

/**
 * Main Payments client
 */
export class Payments {
  private router: PaymentRouter

  readonly customers: CustomersResource
  readonly paymentIntents: PaymentIntentsResource
  readonly subscriptions: SubscriptionsResource
  readonly refunds: RefundsResource

  constructor(config: PaymentsConfig) {
    this.router = new PaymentRouter({
      providers: config.providers,
      defaultProvider: config.defaultProvider,
      rules: config.rules,
      retryOnFail: config.retryOnFail,
      maxRetries: config.maxRetries,
    })

    this.customers = new CustomersResource(this.router)
    this.paymentIntents = new PaymentIntentsResource(this.router)
    this.subscriptions = new SubscriptionsResource(this.router)
    this.refunds = new RefundsResource(this.router)
  }

  /**
   * Get the underlying router for advanced operations
   */
  getRouter(): PaymentRouter {
    return this.router
  }

  /**
   * Get circuit breaker stats
   */
  getProviderStats() {
    return this.router.getCircuitBreakerStats()
  }

  /**
   * List available providers
   */
  listProviders(): PaymentProvider[] {
    return this.router.listProviders()
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default Payments
