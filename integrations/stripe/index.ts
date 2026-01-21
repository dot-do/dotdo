/**
 * Stripe Integration - Test Stub Implementation
 *
 * This is a **stub implementation** for the dotdo integration registry.
 * It provides the full Stripe integration interface with mock data responses
 * for testing and development purposes.
 *
 * ## Purpose
 *
 * - Defines the contract for Stripe integration methods
 * - Enables testing of integration registry functionality
 * - Allows development without real Stripe API credentials
 * - Demonstrates the integration hooks pattern (do-07dn)
 *
 * ## For Real Stripe Integration
 *
 * For production use with real Stripe API calls, use:
 * - `@dotdo/compat/stripe` - API-compatible Stripe SDK
 * - `lib/tools/adapters/stripe` - Tool adapter for the provider registry
 *
 * ## Example Usage (Testing)
 *
 * ```typescript
 * import { createStripeIntegration } from '@dotdo/integrations/stripe'
 *
 * const stripe = createStripeIntegration()
 * await stripe.init({ apiKey: 'sk_test_xxx' })
 *
 * // Returns mock data - suitable for testing
 * const result = await stripe.methods.createCustomer({
 *   email: 'test@example.com',
 *   name: 'Test User'
 * })
 * // result.data.id = 'cus_<random>'
 * ```
 *
 * @module integrations/stripe
 * @see do-laux - Integration registry issue
 * @see do-07dn - Hooks pattern standardization
 * @see do-d5au - Stub documentation issue
 */

import type {
  Integration,
  IntegrationConfig,
  IntegrationStatus,
  IntegrationMetadata,
  IntegrationResult,
  IntegrationWebhookHandler,
  IntegrationEvent,
  IntegrationHooks,
  MethodCallContext,
} from '../types'
import { successResult, errorResult } from '../registry'
import { verifyStripeSignature } from '../webhook-verify'

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
 * Stripe Integration - Stub Implementation
 *
 * Provides payment processing capabilities via mock responses.
 * This is a test stub - all methods return simulated data.
 *
 * ## Hooks Pattern (do-07dn)
 *
 * Stripe supports the full hooks pattern:
 * - `onEvent()` for webhook event handling
 * - `handleWebhook()` for incoming webhook requests
 * - `setHooks()` for method call observability
 *
 * ## Stub Behavior
 *
 * All methods return mock data with realistic IDs:
 * - Customer IDs: `cus_<random>`
 * - Payment Intent IDs: `pi_<random>`
 * - Subscription IDs: `sub_<random>`
 * - Request IDs: `req_<random>`
 *
 * @example
 * ```typescript
 * const stripe = createStripeIntegration()
 *
 * // Set up observability hooks
 * stripe.setHooks({
 *   onMethodCall: {
 *     before: (ctx) => console.log(`Calling ${ctx.method}`),
 *     after: (ctx, result) => console.log(`${ctx.method} completed`)
 *   },
 *   onError: (error, ctx) => reportError(error, ctx)
 * })
 *
 * await stripe.init({ apiKey: 'sk_test_xxx' })
 * ```
 */
export class StripeIntegration implements Integration<StripeConfig, StripeMethods> {
  readonly name = 'stripe'
  readonly version = '1.0.0'
  readonly metadata: IntegrationMetadata = {
    displayName: 'Stripe',
    description: 'Payment processing and subscription management (stub implementation)',
    category: 'payments',
    docsUrl: 'https://stripe.com/docs/api',
    websiteUrl: 'https://stripe.com',
    requiredConfig: ['apiKey'],
    optionalConfig: ['webhookSecret', 'apiVersion', 'environment'],
  }

  private _status: IntegrationStatus = 'uninitialized'
  private config: StripeConfig | null = null
  private webhookHandlers: IntegrationWebhookHandler[] = []
  private hooks: IntegrationHooks = {}

  get status(): IntegrationStatus {
    return this._status
  }

  async init(config: StripeConfig): Promise<void> {
    this._status = 'initializing'

    try {
      // Validate required config
      if (!config.apiKey) {
        throw new Error('Stripe API key is required')
      }

      // Validate API key format
      if (!config.apiKey.startsWith('sk_')) {
        throw new Error('Invalid Stripe API key format')
      }

      this.config = config

      // In a real implementation, you would:
      // 1. Initialize the Stripe SDK
      // 2. Verify the API key by making a test request
      // 3. Set up webhook endpoint verification

      this._status = 'ready'
    } catch (error) {
      this._status = 'error'
      throw error
    }
  }

  async shutdown(): Promise<void> {
    this.config = null
    this.webhookHandlers = []
    this.hooks = {}
    this._status = 'uninitialized'
  }

  async healthCheck(): Promise<boolean> {
    if (this._status !== 'ready' || !this.config) {
      return false
    }

    // Stub: Always returns true when initialized
    // Real implementation would make a test API call to Stripe
    return true
  }

  // ============================================================================
  // OBSERVABILITY HOOKS (do-07dn)
  // ============================================================================

  /**
   * Configure observability hooks for method calls and errors.
   */
  setHooks(hooks: IntegrationHooks): void {
    this.hooks = hooks
  }

  /**
   * Helper to wrap method calls with hooks.
   * Call this at the start and end of method implementations for full observability.
   */
  private async invokeWithHooks<T>(
    method: string,
    args: unknown[],
    fn: () => Promise<IntegrationResult<T>>
  ): Promise<IntegrationResult<T>> {
    const context: MethodCallContext = {
      method,
      args,
      timestamp: new Date(),
    }

    // Call before hook
    if (this.hooks.onMethodCall?.before) {
      await this.hooks.onMethodCall.before(context)
    }

    let result: IntegrationResult<T>
    try {
      result = await fn()
    } catch (error) {
      result = errorResult('UNEXPECTED_ERROR', String(error), error)
    }

    // Call after hook
    if (this.hooks.onMethodCall?.after) {
      await this.hooks.onMethodCall.after(context, result as IntegrationResult)
    }

    // Call error hook on failure
    if (!result.success && this.hooks.onError) {
      await this.hooks.onError(result.error!, { integration: this.name, method, args })
    }

    return result
  }

  // ============================================================================
  // STUB METHODS
  // All methods return mock data for testing purposes.
  // For real Stripe API calls, use @dotdo/compat/stripe or lib/tools/adapters/stripe
  // ============================================================================

  /**
   * Methods exposed by this integration.
   *
   * **Note:** All methods return stub/mock data. They do not make real API calls.
   */
  readonly methods: StripeMethods = {
    createCustomer: async (data) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Stripe integration is not initialized')
      }

      // Stub implementation - returns mock data
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

      // Stub implementation - returns mock data
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

      // Stub implementation - returns mock data
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

      // Stub implementation - returns mock data
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

      // Stub implementation - returns mock data
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

      // Stub implementation - returns mock data
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

      // Stub implementation - returns mock data
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

  // ============================================================================
  // WEBHOOK HANDLING
  // Webhook signature verification is real; event handling calls registered handlers
  // ============================================================================

  /**
   * Handle incoming webhooks from Stripe.
   *
   * This method performs real signature verification using the configured
   * webhook secret, then dispatches events to registered handlers.
   */
  async handleWebhook(request: Request): Promise<Response> {
    if (this._status !== 'ready' || !this.config) {
      return new Response('Integration not initialized', { status: 503 })
    }

    try {
      const body = await request.text()
      const signature = request.headers.get('stripe-signature')

      // Verify webhook signature if secret is configured
      if (this.config.webhookSecret) {
        if (!signature) {
          return new Response(JSON.stringify({ error: 'Missing Stripe-Signature header' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const verification = await verifyStripeSignature(body, signature, this.config.webhookSecret)

        if (!verification.valid) {
          console.error('Stripe webhook signature verification failed:', verification.error)
          return new Response(
            JSON.stringify({ error: 'Signature verification failed', details: verification.error }),
            {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        }
      }

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
        await handler(integrationEvent)
      }

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      console.error('Stripe webhook error:', error)
      return new Response('Webhook error', { status: 400 })
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
 * Uses crypto.randomUUID() for cryptographically secure random generation
 */
function generateId(): string {
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
