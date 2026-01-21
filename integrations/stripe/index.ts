/**
 * @module @dotdo/integrations/stripe
 *
 * Stripe Integration Stub for dotdo integration registry
 *
 * ## Purpose
 *
 * This module provides a **stub/mock implementation** of Stripe operations for:
 * - Development and testing without requiring real Stripe API credentials
 * - Demonstrating the dotdo integration registry pattern
 * - Unit testing business logic that depends on Stripe
 *
 * ## For Production Use
 *
 * For a **fully implemented** Stripe provider with real SDK integration, use:
 *
 * ```typescript
 * import { StripeProvider } from '@dotdo/business/finance/providers/stripe-provider'
 *
 * const stripe = new StripeProvider({
 *   apiKey: process.env.STRIPE_SECRET_KEY!,
 *   webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
 * })
 * ```
 *
 * The `@dotdo/business/finance` package provides:
 * - Full Stripe SDK integration with proper error handling
 * - SaaS metrics (MRR, ARR, churn calculations)
 * - Invoice and subscription lifecycle management
 * - Proper Stripe event type mapping for webhooks
 *
 * ## Stub Behavior
 *
 * All methods in this stub:
 * - Return mock data with properly formatted IDs (cus_, pi_, sub_ prefixes)
 * - Validate initialization state before operations
 * - Support webhook signature verification (real HMAC-SHA256)
 * - Track registered webhook handlers
 *
 * ## Implemented Features
 *
 * - Webhook signature verification using HMAC-SHA256 (via verifyStripeSignature)
 * - Stub methods for all core Stripe operations (customers, payments, subscriptions)
 * - Full webhook event handling with registered handlers
 * - Lifecycle management (init, shutdown, healthCheck)
 *
 * @example
 * ```typescript
 * import { createStripeIntegration } from '@dotdo/integrations/stripe'
 *
 * // Create and initialize the stub
 * const stripe = createStripeIntegration()
 * await stripe.init({
 *   apiKey: 'sk_test_xxx', // Format validated but not used for real API calls
 *   webhookSecret: 'whsec_xxx'
 * })
 *
 * // Use stub methods for testing
 * const result = await stripe.methods.createCustomer({
 *   email: 'test@example.com',
 *   name: 'Test User'
 * })
 *
 * if (result.success) {
 *   console.log(result.data.id) // 'cus_<random>'
 * }
 * ```
 *
 * @see {@link ../../business/finance/providers/stripe-provider.ts} for production implementation
 */

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
import { verifyStripeSignature } from '../webhook-verify'

/**
 * Stripe-specific configuration
 *
 * @property apiKey - Stripe API key (sk_live_xxx or sk_test_xxx).
 *   In this stub, format is validated but no real API calls are made.
 * @property webhookSecret - Stripe webhook signing secret (whsec_xxx).
 *   Used for real HMAC-SHA256 signature verification.
 * @property apiVersion - API version (unused in stub, included for interface compatibility)
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
 * Stripe Integration Stub
 *
 * A mock implementation of Stripe integration for testing and development.
 * All API methods return simulated responses without making real Stripe API calls.
 *
 * ## Stub vs Production
 *
 * This is a **stub implementation** intended for:
 * - Unit testing without Stripe credentials
 * - Development and prototyping
 * - CI/CD pipelines
 *
 * For **production use**, see `@dotdo/business/finance/providers/stripe-provider`
 * which provides full Stripe SDK integration.
 *
 * ## What Works
 *
 * - API key format validation (sk_test_* or sk_live_*)
 * - Webhook signature verification (real HMAC-SHA256)
 * - Event handler registration and invocation
 * - Proper ID formatting (cus_, pi_, sub_ prefixes)
 *
 * ## What's Stubbed
 *
 * - All CRUD operations return mock data
 * - No actual Stripe API calls are made
 * - Health checks always pass when initialized
 *
 * @example
 * ```typescript
 * const stripe = createStripeIntegration()
 * await stripe.init({ apiKey: 'sk_test_xxx' })
 *
 * // Returns mock customer, no real API call
 * const result = await stripe.methods.createCustomer({
 *   email: 'test@example.com'
 * })
 * ```
 */
export class StripeIntegration implements Integration<StripeConfig, StripeMethods> {
  readonly name = 'stripe'
  readonly version = '1.0.0'
  readonly metadata: IntegrationMetadata = {
    displayName: 'Stripe',
    description: 'Payment processing and subscription management (STUB - use @dotdo/business/finance for production)',
    category: 'payments',
    docsUrl: 'https://stripe.com/docs/api',
    websiteUrl: 'https://stripe.com',
    requiredConfig: ['apiKey'],
    optionalConfig: ['webhookSecret', 'apiVersion', 'environment'],
  }

  private _status: IntegrationStatus = 'uninitialized'
  private config: StripeConfig | null = null
  private webhookHandlers: IntegrationWebhookHandler[] = []

  get status(): IntegrationStatus {
    return this._status
  }

  /**
   * Initialize the Stripe integration stub
   *
   * Validates configuration format without making real API calls.
   * For production initialization with real API validation, use
   * `@dotdo/business/finance/providers/stripe-provider`.
   *
   * @param config - Stripe configuration with API key
   * @throws Error if API key is missing or has invalid format
   *
   * @example
   * ```typescript
   * await stripe.init({
   *   apiKey: 'sk_test_xxx',
   *   webhookSecret: 'whsec_xxx' // Optional, enables signature verification
   * })
   * ```
   */
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

      // STUB: No real Stripe SDK initialization
      // For production implementation, see:
      // - business/finance/providers/stripe-provider.ts

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

  /**
   * Check integration health
   *
   * STUB: Always returns true when initialized.
   * Production implementation would call `stripe.balance.retrieve()`.
   *
   * @returns true if initialized, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    if (this._status !== 'ready' || !this.config) {
      return false
    }

    // STUB: Always returns true when initialized
    // Production would call: await this.stripe.balance.retrieve()
    return true
  }

  /**
   * Stub methods for Stripe operations
   *
   * All methods return mock data without making real API calls.
   * For production implementation, use `@dotdo/business/finance/providers/stripe-provider`.
   *
   * @see {@link ../../business/finance/providers/stripe-provider.ts}
   */
  readonly methods: StripeMethods = {
    /**
     * Create a customer (STUB)
     *
     * Returns a mock customer with a generated cus_* ID.
     * Production: `stripe.customers.create()`
     */
    createCustomer: async (data) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Stripe integration is not initialized')
      }

      // STUB: Returns mock data for testing
      const customer: StripeCustomer = {
        id: `cus_${generateId()}`,
        email: data.email,
        name: data.name,
        metadata: data.metadata,
      }

      return successResult(customer, `req_${generateId()}`)
    },

    /**
     * Retrieve a customer by ID (STUB)
     *
     * Returns a mock customer with the provided ID.
     * Production: `stripe.customers.retrieve(customerId)`
     */
    getCustomer: async (customerId) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Stripe integration is not initialized')
      }

      // STUB: Returns mock data for testing
      const customer: StripeCustomer = {
        id: customerId,
        email: 'customer@example.com',
        name: 'Test Customer',
      }

      return successResult(customer, `req_${generateId()}`)
    },

    /**
     * Update a customer (STUB)
     *
     * Returns a mock customer with updated fields.
     * Production: `stripe.customers.update(customerId, data)`
     */
    updateCustomer: async (customerId, data) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Stripe integration is not initialized')
      }

      // STUB: Returns mock data for testing
      const customer: StripeCustomer = {
        id: customerId,
        email: data.email ?? 'customer@example.com',
        name: data.name,
        metadata: data.metadata,
      }

      return successResult(customer, `req_${generateId()}`)
    },

    /**
     * Create a payment intent (STUB)
     *
     * Returns a mock payment intent with 'requires_payment_method' status.
     * Production: `stripe.paymentIntents.create(data)`
     */
    createPaymentIntent: async (data) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Stripe integration is not initialized')
      }

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

    /**
     * Confirm a payment intent (STUB)
     *
     * Returns a mock payment intent with 'succeeded' status.
     * Production: `stripe.paymentIntents.confirm(paymentIntentId)`
     */
    confirmPaymentIntent: async (paymentIntentId) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Stripe integration is not initialized')
      }

      // STUB: Returns mock data for testing
      const paymentIntent: StripePaymentIntent = {
        id: paymentIntentId,
        amount: 1000,
        currency: 'usd',
        status: 'succeeded',
      }

      return successResult(paymentIntent, `req_${generateId()}`)
    },

    /**
     * Create a subscription (STUB)
     *
     * Returns a mock subscription with 'active' status and 30-day period.
     * Production: `stripe.subscriptions.create(data)`
     */
    createSubscription: async (data) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Stripe integration is not initialized')
      }

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

    /**
     * Cancel a subscription (STUB)
     *
     * Returns a mock subscription with 'canceled' status.
     * Production: `stripe.subscriptions.cancel(subscriptionId)`
     */
    cancelSubscription: async (subscriptionId) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'Stripe integration is not initialized')
      }

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
   *
   * This is a **real implementation** - webhook signature verification
   * uses actual HMAC-SHA256 cryptography via `verifyStripeSignature()`.
   *
   * Features:
   * - Validates stripe-signature header when webhookSecret is configured
   * - Parses and dispatches events to registered handlers
   * - Returns appropriate HTTP status codes
   *
   * @param request - Incoming webhook request
   * @returns Response with appropriate status code
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

      // Check for missing signature when secret is configured
      if (!signature && this.config.webhookSecret) {
        return new Response(
          JSON.stringify({ error: 'Missing stripe-signature header' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // Verify signature if webhook secret is configured
      if (this.config.webhookSecret && signature) {
        const verification = await verifyStripeSignature(
          body,
          signature,
          this.config.webhookSecret
        )

        if (!verification.valid) {
          return new Response(
            JSON.stringify({ error: 'Signature verification failed' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          )
        }
      }

      // Parse the event payload
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
 *
 * Uses crypto.randomUUID() for better randomness than Math.random().
 * IDs are formatted to match Stripe's ID format (13 alphanumeric characters).
 *
 * @returns 13-character random ID string
 */
function generateId(): string {
  // Remove hyphens and take first 13 characters to match Stripe ID format
  return crypto.randomUUID().replace(/-/g, '').substring(0, 13)
}

/**
 * Factory function for creating a Stripe integration stub
 *
 * Creates a new StripeIntegration instance for testing and development.
 *
 * ## For Production
 *
 * Use `@dotdo/business/finance/providers/stripe-provider` instead:
 *
 * ```typescript
 * import { StripeProvider } from '@dotdo/business/finance/providers/stripe-provider'
 *
 * const stripe = new StripeProvider({
 *   apiKey: process.env.STRIPE_SECRET_KEY!,
 *   webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
 * })
 * ```
 *
 * @returns New StripeIntegration stub instance
 *
 * @example
 * ```typescript
 * const stripe = createStripeIntegration()
 * await stripe.init({ apiKey: 'sk_test_xxx' })
 *
 * // All methods return mock data
 * const result = await stripe.methods.createCustomer({
 *   email: 'test@example.com'
 * })
 * ```
 */
export function createStripeIntegration(): StripeIntegration {
  return new StripeIntegration()
}

/**
 * Default export - StripeIntegration stub class
 *
 * @see {@link createStripeIntegration} for factory function
 * @see {@link ../../business/finance/providers/stripe-provider.ts} for production implementation
 */
export default StripeIntegration
