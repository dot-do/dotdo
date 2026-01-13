/**
 * @dotdo/lib/tools/adapters/stripe.ts - Stripe Provider Adapter
 *
 * Exposes Stripe compat SDK as Tool Things.
 *
 * @example
 * ```typescript
 * import { stripeAdapter } from 'lib/tools/adapters/stripe'
 * import { globalRegistry } from 'lib/tools'
 *
 * globalRegistry.register(stripeAdapter)
 *
 * await globalRegistry.execute(
 *   'stripe',
 *   'create_customer',
 *   { email: 'customer@example.com', name: 'John Doe' },
 *   { apiKey: 'sk_xxx' }
 * )
 * ```
 */

import {
  createProviderAdapter,
  type ProviderToolAdapter,
  type RuntimeCredentials,
  type ToolContext,
  ProviderError,
} from '../provider-adapter'

// =============================================================================
// Types
// =============================================================================

interface CreateCustomerParams {
  email?: string
  name?: string
  description?: string
  phone?: string
  address?: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    postal_code?: string
    country?: string
  }
  metadata?: Record<string, string>
}

interface CreatePaymentIntentParams {
  amount: number
  currency: string
  customer?: string
  description?: string
  payment_method?: string
  confirm?: boolean
  metadata?: Record<string, string>
}

interface CreateSubscriptionParams {
  customer: string
  items: Array<{ price: string; quantity?: number }>
  payment_behavior?: 'default_incomplete' | 'allow_incomplete' | 'error_if_incomplete'
  trial_period_days?: number
  metadata?: Record<string, string>
}

// =============================================================================
// Handlers
// =============================================================================

async function createCustomer(
  params: CreateCustomerParams,
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  if (!credentials.apiKey) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'Stripe API key is required',
      provider: 'stripe',
      toolId: 'create_customer',
    })
  }

  const { Stripe } = await import('../../../compat/stripe')

  const client = new Stripe(credentials.apiKey)

  try {
    return await client.customers.create(params)
  } catch (error) {
    throw new ProviderError({
      code: 'CREATE_CUSTOMER_FAILED',
      message: error instanceof Error ? error.message : 'Failed to create customer',
      provider: 'stripe',
      toolId: 'create_customer',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function createPaymentIntent(
  params: CreatePaymentIntentParams,
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  if (!credentials.apiKey) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'Stripe API key is required',
      provider: 'stripe',
      toolId: 'create_payment_intent',
    })
  }

  const { Stripe } = await import('../../../compat/stripe')

  const client = new Stripe(credentials.apiKey)

  try {
    return await client.paymentIntents.create(params)
  } catch (error) {
    throw new ProviderError({
      code: 'CREATE_PAYMENT_INTENT_FAILED',
      message: error instanceof Error ? error.message : 'Failed to create payment intent',
      provider: 'stripe',
      toolId: 'create_payment_intent',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function createSubscription(
  params: CreateSubscriptionParams,
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  if (!credentials.apiKey) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'Stripe API key is required',
      provider: 'stripe',
      toolId: 'create_subscription',
    })
  }

  const { Stripe } = await import('../../../compat/stripe')

  const client = new Stripe(credentials.apiKey)

  try {
    return await client.subscriptions.create(params)
  } catch (error) {
    throw new ProviderError({
      code: 'CREATE_SUBSCRIPTION_FAILED',
      message: error instanceof Error ? error.message : 'Failed to create subscription',
      provider: 'stripe',
      toolId: 'create_subscription',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function listCustomers(
  params: { limit?: number; starting_after?: string; email?: string },
  credentials: RuntimeCredentials,
  _context?: ToolContext
): Promise<unknown> {
  if (!credentials.apiKey) {
    throw new ProviderError({
      code: 'MISSING_CREDENTIALS',
      message: 'Stripe API key is required',
      provider: 'stripe',
      toolId: 'list_customers',
    })
  }

  const { Stripe } = await import('../../../compat/stripe')

  const client = new Stripe(credentials.apiKey)

  try {
    return await client.customers.list(params)
  } catch (error) {
    throw new ProviderError({
      code: 'LIST_CUSTOMERS_FAILED',
      message: error instanceof Error ? error.message : 'Failed to list customers',
      provider: 'stripe',
      toolId: 'list_customers',
      cause: error instanceof Error ? error : undefined,
    })
  }
}

// =============================================================================
// Adapter Definition
// =============================================================================

/**
 * Stripe provider adapter
 */
export const stripeAdapter: ProviderToolAdapter = createProviderAdapter({
  name: 'stripe',
  displayName: 'Stripe',
  description: 'Payment processing platform for internet businesses',
  category: 'commerce',
  credential: {
    type: 'api_key',
    headerName: 'Authorization',
    headerPrefix: 'Bearer',
    envVar: 'STRIPE_SECRET_KEY',
    required: true,
  },
  baseUrl: 'https://api.stripe.com',
  timeout: 80000,
  maxRetries: 2,
  iconUrl: 'https://stripe.com/favicon.ico',
  docsUrl: 'https://stripe.com/docs/api',
  version: '1.0.0',
  tools: [
    {
      id: 'create_customer',
      name: 'Create Customer',
      description: 'Create a new Stripe customer. Use customers to track recurring purchases and payment methods.',
      parameters: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            description: 'Customer email address',
          },
          name: {
            type: 'string',
            description: 'Customer full name',
          },
          description: {
            type: 'string',
            description: 'Internal description of the customer',
          },
          phone: {
            type: 'string',
            description: 'Customer phone number',
          },
          address: {
            type: 'object',
            description: 'Customer billing address',
            properties: {
              line1: { type: 'string' },
              line2: { type: 'string' },
              city: { type: 'string' },
              state: { type: 'string' },
              postal_code: { type: 'string' },
              country: { type: 'string' },
            },
          },
          metadata: {
            type: 'object',
            description: 'Custom key-value metadata',
          },
        },
      },
      handler: createCustomer,
      tags: ['customer', 'billing'],
      rateLimitTier: 'high',
      examples: [
        {
          name: 'Basic Customer',
          description: 'Create a customer with email and name',
          input: {
            email: 'customer@example.com',
            name: 'John Doe',
          },
        },
      ],
    },
    {
      id: 'list_customers',
      name: 'List Customers',
      description: 'List all customers with pagination',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Number of customers to return (max 100)',
            default: 10,
          },
          starting_after: {
            type: 'string',
            description: 'Cursor for pagination (customer ID)',
          },
          email: {
            type: 'string',
            description: 'Filter by email address',
          },
        },
      },
      handler: listCustomers,
      tags: ['customer', 'list'],
      rateLimitTier: 'high',
    },
    {
      id: 'create_payment_intent',
      name: 'Create Payment Intent',
      description: 'Create a PaymentIntent to collect a one-time payment from a customer.',
      parameters: {
        type: 'object',
        properties: {
          amount: {
            type: 'integer',
            description: 'Amount in cents (e.g., 2000 = $20.00)',
          },
          currency: {
            type: 'string',
            description: 'Three-letter ISO currency code (e.g., usd, eur)',
          },
          customer: {
            type: 'string',
            description: 'Customer ID to associate with the payment',
          },
          description: {
            type: 'string',
            description: 'Description of the payment',
          },
          payment_method: {
            type: 'string',
            description: 'Payment method ID to use',
          },
          confirm: {
            type: 'boolean',
            description: 'Immediately confirm the payment',
          },
          metadata: {
            type: 'object',
            description: 'Custom key-value metadata',
          },
        },
        required: ['amount', 'currency'],
      },
      handler: createPaymentIntent,
      tags: ['payment', 'charge'],
      rateLimitTier: 'high',
      requiresConfirmation: true,
      examples: [
        {
          name: 'Simple Payment',
          description: 'Create a $20 payment intent',
          input: {
            amount: 2000,
            currency: 'usd',
            description: 'Order #12345',
          },
        },
      ],
    },
    {
      id: 'create_subscription',
      name: 'Create Subscription',
      description: 'Create a subscription for a customer to a recurring price.',
      parameters: {
        type: 'object',
        properties: {
          customer: {
            type: 'string',
            description: 'Customer ID',
          },
          items: {
            type: 'array',
            description: 'Subscription items (prices)',
            items: {
              type: 'object',
            },
          },
          payment_behavior: {
            type: 'string',
            description: 'Payment behavior for initial invoice',
            enum: ['default_incomplete', 'allow_incomplete', 'error_if_incomplete'],
          },
          trial_period_days: {
            type: 'integer',
            description: 'Number of trial days',
          },
          metadata: {
            type: 'object',
            description: 'Custom key-value metadata',
          },
        },
        required: ['customer', 'items'],
      },
      handler: createSubscription,
      tags: ['subscription', 'recurring', 'billing'],
      rateLimitTier: 'high',
      requiresConfirmation: true,
      examples: [
        {
          name: 'Basic Subscription',
          description: 'Subscribe a customer to a price',
          input: {
            customer: 'cus_xxx',
            items: [{ price: 'price_xxx' }],
          },
        },
        {
          name: 'Trial Subscription',
          description: 'Subscribe with a 14-day trial',
          input: {
            customer: 'cus_xxx',
            items: [{ price: 'price_xxx' }],
            trial_period_days: 14,
          },
        },
      ],
    },
  ],
})

export default stripeAdapter
