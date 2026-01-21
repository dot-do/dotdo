// Stripe Integration Stub
// Example integration for the dotdo integration registry (do-laux)
//
// TODO: Replace stub with real Stripe SDK integration
// Action items for real implementation:
// 1. Add 'stripe' npm package dependency
// 2. Initialize Stripe SDK in init() method with config.apiKey
// 3. Implement real API calls in all methods using Stripe SDK
// 4. Implement webhook signature verification using stripe.webhooks.constructEvent()
// 5. Add proper error mapping from Stripe errors to IntegrationError
// 6. Add request retries with exponential backoff for transient errors
// 7. Add request/response logging for debugging
// 8. Support idempotency keys for safe retries
// 9. Add rate limiting awareness (handle 429 responses)
// 10. Validate webhook events before processing

import type {
  Integration,
  IntegrationConfig,
  IntegrationStatus,
  IntegrationMetadata,
  IntegrationResult,
  IntegrationWebhookHandler,
  IntegrationEvent,
} from '../types'
import { successResult, errorResult } from '../registry'

/**
 * Stripe-specific configuration
 */
export interface StripeConfig extends IntegrationConfig {
  /** Stripe API key (sk_live_xxx or sk_test_xxx) */
  apiKey: string
  /** Stripe webhook signing secret (whsec_xxx) */
  webhookSecret?: string
  /** API version to use */
  apiVersion?: string
}

/**
 * Stripe customer data
 */
export interface StripeCustomer {
  id: string
  email: string
  name?: string | undefined
  metadata?: Record<string, string> | undefined
}

/**
 * Stripe payment intent data
 */
export interface StripePaymentIntent {
  id: string
  amount: number
  currency: string
  status: string
  customerId?: string | undefined
  metadata?: Record<string, string> | undefined
}

/**
 * Stripe subscription data
 */
export interface StripeSubscription {
  id: string
  customerId: string
  status: string
  priceId: string
  currentPeriodStart: Date
  currentPeriodEnd: Date
}

/**
 * Stripe integration methods
 */
export interface StripeMethods extends Record<string, (...args: any[]) => Promise<IntegrationResult>> {
  // Customer methods
  createCustomer: (data: {
    email: string
    name?: string
    metadata?: Record<string, string>
  }) => Promise<IntegrationResult<StripeCustomer>>

  getCustomer: (customerId: string) => Promise<IntegrationResult<StripeCustomer>>

  updateCustomer: (
    customerId: string,
    data: Partial<{ email: string; name: string; metadata: Record<string, string> }>
  ) => Promise<IntegrationResult<StripeCustomer>>

  // Payment methods
  createPaymentIntent: (data: {
    amount: number
    currency: string
    customerId?: string
    metadata?: Record<string, string>
  }) => Promise<IntegrationResult<StripePaymentIntent>>

  confirmPaymentIntent: (paymentIntentId: string) => Promise<IntegrationResult<StripePaymentIntent>>

  // Subscription methods
  createSubscription: (data: {
    customerId: string
    priceId: string
    metadata?: Record<string, string>
  }) => Promise<IntegrationResult<StripeSubscription>>

  cancelSubscription: (subscriptionId: string) => Promise<IntegrationResult<StripeSubscription>>
}

/**
 * Stripe Integration
 * Provides payment processing capabilities
 */
export class StripeIntegration implements Integration<StripeConfig, StripeMethods> {
  readonly name = 'stripe'
  readonly version = '1.0.0'
  readonly metadata: IntegrationMetadata = {
    displayName: 'Stripe',
    description: 'Payment processing and subscription management',
    category: 'payments',
    docsUrl: 'https://stripe.com/docs/api',
    websiteUrl: 'https://stripe.com',
    requiredConfig: ['apiKey'],
    optionalConfig: ['webhookSecret', 'apiVersion', 'environment'],
  }

  private _status: IntegrationStatus = 'uninitialized'
  private config: StripeConfig | null = null
  private webhookHandlers: IntegrationWebhookHandler[] = []
  // TODO: Add stripe SDK instance: private stripe: Stripe | null = null

  get status(): IntegrationStatus {
    return this._status
  }

  async init(config: StripeConfig): Promise<void> {
    this._status = 'initializing'

    try {
      // Validate required config
      if (!config.apiKey) {
        this._status = 'error'
        throw new Error('Stripe API key is required')
      }

      // Validate API key format
      if (!config.apiKey.startsWith('sk_')) {
        this._status = 'error'
        throw new Error('Invalid Stripe API key format (must start with sk_)')
      }

      this.config = config

      // TODO: Real implementation steps:
      // 1. Initialize the Stripe SDK:
      //    this.stripe = new Stripe(config.apiKey, {
      //      apiVersion: config.apiVersion ?? '2023-10-16',
      //      typescript: true,
      //    })
      // 2. Verify the API key by making a test request:
      //    await this.stripe.balance.retrieve()
      // 3. Store webhook secret for signature verification
      // 4. Add timeout configuration
      // 5. Add retry configuration

      this._status = 'ready'
    } catch (error) {
      this._status = 'error'
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to initialize Stripe integration: ${errorMessage}`)
    }
  }

  async shutdown(): Promise<void> {
    this.config = null
    this.webhookHandlers = []
    this._status = 'uninitialized'
  }

  async healthCheck(): Promise<boolean> {
    if (this._status !== 'ready' || !this.config) {
      return false
    }

    // TODO: Real implementation:
    // try {
    //   await this.stripe.balance.retrieve()
    //   return true
    // } catch (error) {
    //   console.error('Stripe health check failed:', error)
    //   return false
    // }

    // Stub always returns true when initialized
    return true
  }

  /**
   * Methods exposed by this integration
   */
  readonly methods: StripeMethods = {
    createCustomer: async (data) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Stripe integration is not initialized')
      }

      // TODO: Real implementation:
      // try {
      //   const customer = await this.stripe.customers.create({
      //     email: data.email,
      //     name: data.name,
      //     metadata: data.metadata,
      //   })
      //   return successResult(customer, response.requestId)
      // } catch (error) {
      //   return this.handleStripeError(error)
      // }

      // STUB: Returns mock data for testing
      const customer: StripeCustomer = {
        id: `cus_${generateId()}`,
        email: data.email,
        name: data.name,
        metadata: data.metadata,
      }

      return successResult(customer, `req_${generateId()}`)
    },

    getCustomer: async (customerId) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Stripe integration is not initialized')
      }

      // TODO: Real implementation:
      // try {
      //   const customer = await this.stripe.customers.retrieve(customerId)
      //   return successResult(customer, response.requestId)
      // } catch (error) {
      //   return this.handleStripeError(error)
      // }

      // STUB: Returns mock data for testing
      const customer: StripeCustomer = {
        id: customerId,
        email: 'customer@example.com',
        name: 'Test Customer',
      }

      return successResult(customer, `req_${generateId()}`)
    },

    updateCustomer: async (customerId, data) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Stripe integration is not initialized')
      }

      // TODO: Real implementation:
      // try {
      //   const customer = await this.stripe.customers.update(customerId, {
      //     email: data.email,
      //     name: data.name,
      //     metadata: data.metadata,
      //   })
      //   return successResult(customer, response.requestId)
      // } catch (error) {
      //   return this.handleStripeError(error)
      // }

      // STUB: Returns mock data for testing
      const customer: StripeCustomer = {
        id: customerId,
        email: data.email ?? 'customer@example.com',
        name: data.name,
        metadata: data.metadata,
      }

      return successResult(customer, `req_${generateId()}`)
    },

    createPaymentIntent: async (data) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Stripe integration is not initialized')
      }

      // TODO: Real implementation:
      // try {
      //   const paymentIntent = await this.stripe.paymentIntents.create({
      //     amount: data.amount,
      //     currency: data.currency,
      //     customer: data.customerId,
      //     metadata: data.metadata,
      //   })
      //   return successResult(paymentIntent, response.requestId)
      // } catch (error) {
      //   return this.handleStripeError(error)
      // }

      // STUB: Returns mock data for testing
      const paymentIntent: StripePaymentIntent = {
        id: `pi_${generateId()}`,
        amount: data.amount,
        currency: data.currency,
        status: 'requires_payment_method',
        customerId: data.customerId,
        metadata: data.metadata,
      }

      return successResult(paymentIntent, `req_${generateId()}`)
    },

    confirmPaymentIntent: async (paymentIntentId) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Stripe integration is not initialized')
      }

      // TODO: Real implementation:
      // try {
      //   const paymentIntent = await this.stripe.paymentIntents.confirm(paymentIntentId)
      //   return successResult(paymentIntent, response.requestId)
      // } catch (error) {
      //   return this.handleStripeError(error)
      // }

      // STUB: Returns mock data for testing
      const paymentIntent: StripePaymentIntent = {
        id: paymentIntentId,
        amount: 1000,
        currency: 'usd',
        status: 'succeeded',
      }

      return successResult(paymentIntent, `req_${generateId()}`)
    },

    createSubscription: async (data) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Stripe integration is not initialized')
      }

      // TODO: Real implementation:
      // try {
      //   const subscription = await this.stripe.subscriptions.create({
      //     customer: data.customerId,
      //     items: [{ price: data.priceId }],
      //     metadata: data.metadata,
      //   })
      //   return successResult({
      //     id: subscription.id,
      //     customerId: subscription.customer as string,
      //     status: subscription.status,
      //     priceId: data.priceId,
      //     currentPeriodStart: new Date(subscription.current_period_start * 1000),
      //     currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      //   }, response.requestId)
      // } catch (error) {
      //   return this.handleStripeError(error)
      // }

      // STUB: Returns mock data for testing
      const now = new Date()
      const subscription: StripeSubscription = {
        id: `sub_${generateId()}`,
        customerId: data.customerId,
        status: 'active',
        priceId: data.priceId,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      }

      return successResult(subscription, `req_${generateId()}`)
    },

    cancelSubscription: async (subscriptionId) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Stripe integration is not initialized')
      }

      // TODO: Real implementation:
      // try {
      //   const subscription = await this.stripe.subscriptions.cancel(subscriptionId)
      //   return successResult({
      //     id: subscription.id,
      //     customerId: subscription.customer as string,
      //     status: subscription.status,
      //     priceId: subscription.items.data[0]?.price.id ?? 'price_xxx',
      //     currentPeriodStart: new Date(subscription.current_period_start * 1000),
      //     currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      //   }, response.requestId)
      // } catch (error) {
      //   return this.handleStripeError(error)
      // }

      // STUB: Returns mock data for testing
      const subscription: StripeSubscription = {
        id: subscriptionId,
        customerId: 'cus_xxx',
        status: 'canceled',
        priceId: 'price_xxx',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
      }

      return successResult(subscription, `req_${generateId()}`)
    },
  }

  /**
   * Handle incoming webhooks from Stripe
   */
  async handleWebhook(request: Request): Promise<Response> {
    if (this._status !== 'ready' || !this.config) {
      return new Response(
        JSON.stringify({ error: 'Integration not initialized' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    }

    try {
      const body = await request.text()
      const signature = request.headers.get('stripe-signature')

      if (!signature && this.config.webhookSecret) {
        return new Response(
          JSON.stringify({ error: 'Missing stripe-signature header' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // TODO: Real implementation:
      // 1. Verify the webhook signature using stripe.webhooks.constructEvent():
      //    const event = stripe.webhooks.constructEvent(
      //      body,
      //      signature,
      //      this.config.webhookSecret
      //    )
      // 2. Validate event type and structure
      // 3. Call registered handlers with proper error handling
      // 4. Return appropriate status codes based on processing result

      // STUB: Parse event without signature verification
      const event = JSON.parse(body) as { type: string; data: { object: unknown } }

      // Create integration event
      const integrationEvent: IntegrationEvent = {
        integration: this.name,
        type: event.type,
        payload: event.data.object,
        timestamp: new Date(),
        webhookId: request.headers.get('stripe-webhook-id') ?? undefined,
      }

      // Call all registered handlers
      for (const handler of this.webhookHandlers) {
        try {
          await handler(integrationEvent)
        } catch (handlerError) {
          console.error('Webhook handler error:', handlerError)
          // Continue processing other handlers even if one fails
        }
      }

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Webhook processing error:', errorMessage)
      return new Response(
        JSON.stringify({
          error: 'Webhook processing failed',
          message: errorMessage,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
  }

  /**
   * Register a handler for Stripe webhook events
   */
  onEvent(handler: IntegrationWebhookHandler): void {
    this.webhookHandlers.push(handler)
  }
}

/**
 * Generate a random ID for stub responses
 * Uses crypto.randomUUID() for better randomness than Math.random()
 */
function generateId(): string {
  // Remove hyphens and take first 13 characters to match Stripe ID format
  return crypto.randomUUID().replace(/-/g, '').substring(0, 13)
}

/**
 * Factory function for creating Stripe integration
 */
export function createStripeIntegration(): StripeIntegration {
  return new StripeIntegration()
}

/**
 * Default export
 */
export default StripeIntegration
