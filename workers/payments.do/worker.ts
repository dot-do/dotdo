/**
 * payments.do - Worker Entry Point
 *
 * Cloudflare Worker for the payments.do platform service.
 * Provides HTTP API for payment operations with DO backing.
 */

/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type {
  PaymentProvider,
  PaymentIntent,
  PaymentIntentCreateParams,
  PaymentIntentConfirmParams,
  Customer,
  CustomerCreateParams,
  CustomerUpdateParams,
  Subscription,
  SubscriptionCreateParams,
  SubscriptionCancelParams,
  RefundCreateParams,
  WebhookEvent,
} from './types'
import { PaymentRouter, StripeProvider } from './providers'
import { WebhookHandler, SQLiteWebhookStorage, InMemoryWebhookStorage } from './webhooks'

// =============================================================================
// Environment Types
// =============================================================================

interface Env {
  // Secrets
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  PADDLE_VENDOR_ID?: string
  PADDLE_AUTH_CODE?: string
  PADDLE_WEBHOOK_SECRET?: string
  LEMONSQUEEZY_API_KEY?: string
  LEMONSQUEEZY_STORE_ID?: string
  LEMONSQUEEZY_WEBHOOK_SECRET?: string

  // Durable Objects
  CUSTOMERS: DurableObjectNamespace
  PAYMENT_STATES: DurableObjectNamespace
  WEBHOOK_LOGS: DurableObjectNamespace

  // Optional: KV for caching
  PAYMENTS_KV?: KVNamespace
}

// =============================================================================
// App Setup
// =============================================================================

const app = new Hono<{ Bindings: Env }>()

// Middleware
app.use('*', cors())
app.use('*', logger())

// Error handler
app.onError((err, c) => {
  console.error('Error:', err)
  return c.json(
    {
      error: {
        type: 'api_error',
        message: err.message || 'Internal server error',
      },
    },
    500
  )
})

// =============================================================================
// Helper Functions
// =============================================================================

function getPaymentRouter(env: Env): PaymentRouter {
  const providers: Array<{
    provider: PaymentProvider
    apiKey?: string
    secretKey?: string
    webhookSecret?: string
    enabled: boolean
    priority: number
  }> = []

  if (env.STRIPE_SECRET_KEY) {
    providers.push({
      provider: 'stripe',
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      enabled: true,
      priority: 1,
    })
  }

  if (env.PADDLE_VENDOR_ID && env.PADDLE_AUTH_CODE) {
    providers.push({
      provider: 'paddle',
      apiKey: env.PADDLE_VENDOR_ID,
      secretKey: env.PADDLE_AUTH_CODE,
      webhookSecret: env.PADDLE_WEBHOOK_SECRET,
      enabled: true,
      priority: 2,
    })
  }

  if (env.LEMONSQUEEZY_API_KEY && env.LEMONSQUEEZY_STORE_ID) {
    providers.push({
      provider: 'lemonsqueezy',
      apiKey: env.LEMONSQUEEZY_API_KEY,
      secretKey: env.LEMONSQUEEZY_STORE_ID,
      webhookSecret: env.LEMONSQUEEZY_WEBHOOK_SECRET,
      enabled: true,
      priority: 3,
    })
  }

  return new PaymentRouter({
    providers,
    defaultProvider: 'stripe',
    retryOnFail: true,
    rules: [
      // Route EU currencies to Paddle for VAT handling
      {
        condition: { type: 'currency', currencies: ['eur', 'gbp', 'sek', 'dkk', 'nok', 'pln', 'chf'] },
        provider: 'paddle',
      },
    ],
  })
}

function getCustomersDO(env: Env, namespace: string): DurableObjectStub {
  const id = env.CUSTOMERS.idFromName(namespace)
  return env.CUSTOMERS.get(id)
}

function getPaymentStatesDO(env: Env, namespace: string): DurableObjectStub {
  const id = env.PAYMENT_STATES.idFromName(namespace)
  return env.PAYMENT_STATES.get(id)
}

function getWebhookLogsDO(env: Env, namespace: string): DurableObjectStub {
  const id = env.WEBHOOK_LOGS.idFromName(namespace)
  return env.WEBHOOK_LOGS.get(id)
}

// =============================================================================
// Health Check
// =============================================================================

app.get('/', (c) => {
  return c.json({
    service: 'payments.do',
    status: 'healthy',
    version: '1.0.0',
    docs: 'https://docs.payments.do',
  })
})

app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

// =============================================================================
// Customer Endpoints
// =============================================================================

app.post('/v1/customers', async (c) => {
  const params = await c.req.json<CustomerCreateParams>()
  const namespace = c.req.header('X-Namespace') || 'default'

  // Use DO for persistence
  const customersDO = getCustomersDO(c.env, namespace)
  const response = await customersDO.fetch(
    new Request('http://internal/customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
  )

  const customer = await response.json()

  // Optionally sync to payment providers
  const router = getPaymentRouter(c.env)
  if (router.listProviders().length > 0) {
    // Fire-and-forget provider sync
    router.execute((provider) => provider.createCustomer(params))
      .then((result) => {
        if (result.success && result.data) {
          // Update DO with provider ID
          customersDO.fetch(
            new Request(`http://internal/sync-provider?id=${(customer as Customer).id}&provider=${result.provider}&provider_id=${result.data.provider_ids[result.provider]}`)
          )
        }
      })
      .catch(console.error)
  }

  return c.json(customer, response.status as any)
})

app.get('/v1/customers/:id', async (c) => {
  const id = c.req.param('id')
  const namespace = c.req.header('X-Namespace') || 'default'

  const customersDO = getCustomersDO(c.env, namespace)
  const response = await customersDO.fetch(
    new Request(`http://internal/customer?id=${id}`)
  )

  if (response.status === 404) {
    return c.json({ error: { message: 'Customer not found' } }, 404)
  }

  return c.json(await response.json())
})

app.post('/v1/customers/:id', async (c) => {
  const id = c.req.param('id')
  const params = await c.req.json<CustomerUpdateParams>()
  const namespace = c.req.header('X-Namespace') || 'default'

  const customersDO = getCustomersDO(c.env, namespace)
  const response = await customersDO.fetch(
    new Request(`http://internal/customer?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
  )

  if (response.status === 404) {
    return c.json({ error: { message: 'Customer not found' } }, 404)
  }

  return c.json(await response.json())
})

app.delete('/v1/customers/:id', async (c) => {
  const id = c.req.param('id')
  const namespace = c.req.header('X-Namespace') || 'default'

  const customersDO = getCustomersDO(c.env, namespace)
  const response = await customersDO.fetch(
    new Request(`http://internal/customer?id=${id}`, {
      method: 'DELETE',
    })
  )

  if (response.status === 404) {
    return c.json({ error: { message: 'Customer not found' } }, 404)
  }

  return c.json(await response.json())
})

app.get('/v1/customers', async (c) => {
  const namespace = c.req.header('X-Namespace') || 'default'
  const limit = c.req.query('limit') || '20'
  const offset = c.req.query('starting_after') ? '0' : '0' // Simplified pagination

  const customersDO = getCustomersDO(c.env, namespace)
  const response = await customersDO.fetch(
    new Request(`http://internal/customers?limit=${limit}&offset=${offset}`)
  )

  return c.json(await response.json())
})

// =============================================================================
// Payment Intent Endpoints
// =============================================================================

app.post('/v1/payment_intents', async (c) => {
  const params = await c.req.json<PaymentIntentCreateParams>()
  const namespace = c.req.header('X-Namespace') || 'default'

  const router = getPaymentRouter(c.env)
  const selectedProvider = router.selectProvider({
    currency: params.currency,
    amount: params.amount,
  })

  const result = await router.execute(
    (provider) => provider.createPaymentIntent(params),
    params.provider || selectedProvider
  )

  if (!result.success) {
    return c.json({ error: result.error }, 400)
  }

  // Store state in DO
  const paymentStatesDO = getPaymentStatesDO(c.env, namespace)
  await paymentStatesDO.fetch(
    new Request('http://internal/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payment_intent_id: result.data!.id,
        customer_id: params.customer,
        amount: params.amount,
        currency: params.currency,
        provider: result.provider,
        provider_id: result.data!.provider_id,
        metadata: params.metadata,
      }),
    })
  )

  return c.json(result.data, 201)
})

app.get('/v1/payment_intents/:id', async (c) => {
  const id = c.req.param('id')
  const namespace = c.req.header('X-Namespace') || 'default'

  const paymentStatesDO = getPaymentStatesDO(c.env, namespace)
  const response = await paymentStatesDO.fetch(
    new Request(`http://internal/state?payment_intent_id=${id}`)
  )

  if (response.status === 404) {
    return c.json({ error: { message: 'Payment intent not found' } }, 404)
  }

  return c.json(await response.json())
})

app.post('/v1/payment_intents/:id/confirm', async (c) => {
  const id = c.req.param('id')
  const params = await c.req.json<PaymentIntentConfirmParams>()

  const router = getPaymentRouter(c.env)
  const result = await router.execute((provider) => provider.confirmPaymentIntent(id, params))

  if (!result.success) {
    return c.json({ error: result.error }, 400)
  }

  return c.json(result.data)
})

app.post('/v1/payment_intents/:id/capture', async (c) => {
  const id = c.req.param('id')
  const params = await c.req.json<{ amount_to_capture?: number }>()
  const namespace = c.req.header('X-Namespace') || 'default'

  const router = getPaymentRouter(c.env)
  const result = await router.execute((provider) => provider.capturePaymentIntent(id, params))

  if (!result.success) {
    return c.json({ error: result.error }, 400)
  }

  // Update state
  const paymentStatesDO = getPaymentStatesDO(c.env, namespace)
  await paymentStatesDO.fetch(
    new Request('http://internal/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, amount: params.amount_to_capture }),
    })
  )

  return c.json(result.data)
})

app.post('/v1/payment_intents/:id/cancel', async (c) => {
  const id = c.req.param('id')
  const namespace = c.req.header('X-Namespace') || 'default'

  const router = getPaymentRouter(c.env)
  const result = await router.execute((provider) => provider.cancelPaymentIntent(id))

  if (!result.success) {
    return c.json({ error: result.error }, 400)
  }

  // Update state
  const paymentStatesDO = getPaymentStatesDO(c.env, namespace)
  await paymentStatesDO.fetch(
    new Request('http://internal/transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, to: 'canceled' }),
    })
  )

  return c.json(result.data)
})

// =============================================================================
// Subscription Endpoints
// =============================================================================

app.post('/v1/subscriptions', async (c) => {
  const params = await c.req.json<SubscriptionCreateParams>()

  const router = getPaymentRouter(c.env)
  const result = await router.execute(
    (provider) => provider.createSubscription(params),
    params.provider
  )

  if (!result.success) {
    return c.json({ error: result.error }, 400)
  }

  return c.json(result.data, 201)
})

app.delete('/v1/subscriptions/:id', async (c) => {
  const id = c.req.param('id')

  const router = getPaymentRouter(c.env)
  const result = await router.execute((provider) => provider.cancelSubscription(id))

  if (!result.success) {
    return c.json({ error: result.error }, 400)
  }

  return c.json(result.data)
})

// =============================================================================
// Refund Endpoints
// =============================================================================

app.post('/v1/refunds', async (c) => {
  const params = await c.req.json<RefundCreateParams>()
  const namespace = c.req.header('X-Namespace') || 'default'

  const router = getPaymentRouter(c.env)
  const result = await router.execute((provider) => provider.createRefund(params))

  if (!result.success) {
    return c.json({ error: result.error }, 400)
  }

  // Update payment state
  const paymentStatesDO = getPaymentStatesDO(c.env, namespace)
  await paymentStatesDO.fetch(
    new Request('http://internal/refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: params.payment_intent,
        amount: params.amount || result.data!.amount,
      }),
    })
  )

  return c.json(result.data, 201)
})

// =============================================================================
// Webhook Endpoints
// =============================================================================

app.post('/webhooks/stripe', async (c) => {
  const namespace = c.req.header('X-Namespace') || 'default'
  const signature = c.req.header('stripe-signature')
  const payload = await c.req.text()

  if (!signature || !c.env.STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: { message: 'Missing signature or webhook secret' } }, 400)
  }

  const webhookLogsDO = getWebhookLogsDO(c.env, namespace)
  const handler = new WebhookHandler({
    storage: new InMemoryWebhookStorage(), // Would use DO-backed storage in production
    onEvent: async (event) => {
      // Handle the event
      console.log('Processing webhook event:', event.type, event.id)

      // Update payment state based on event
      if (event.type.startsWith('payment_intent.')) {
        const paymentStatesDO = getPaymentStatesDO(c.env, namespace)
        const pi = event.data.object as PaymentIntent

        let newState: string | undefined
        if (event.type === 'payment_intent.succeeded') newState = 'captured'
        else if (event.type === 'payment_intent.canceled') newState = 'canceled'
        else if (event.type === 'payment_intent.payment_failed') newState = 'failed'

        if (newState) {
          await paymentStatesDO.fetch(
            new Request('http://internal/transition', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: pi.id,
                to: newState,
                event_id: event.id,
              }),
            })
          )
        }
      }
    },
  })

  const result = await handler.handle('stripe', payload, signature, c.env.STRIPE_WEBHOOK_SECRET)

  if (!result.success) {
    return c.json({ error: { message: result.error } }, 400)
  }

  return c.json({ received: true })
})

app.post('/webhooks/paddle', async (c) => {
  const namespace = c.req.header('X-Namespace') || 'default'
  const signature = c.req.header('paddle-signature') || ''
  const payload = await c.req.text()

  if (!c.env.PADDLE_WEBHOOK_SECRET) {
    return c.json({ error: { message: 'Missing webhook secret' } }, 400)
  }

  const handler = new WebhookHandler({
    storage: new InMemoryWebhookStorage(),
    onEvent: async (event) => {
      console.log('Processing Paddle webhook event:', event.type, event.id)
    },
  })

  const result = await handler.handle('paddle', payload, signature, c.env.PADDLE_WEBHOOK_SECRET)

  if (!result.success) {
    return c.json({ error: { message: result.error } }, 400)
  }

  return c.json({ received: true })
})

app.post('/webhooks/lemonsqueezy', async (c) => {
  const namespace = c.req.header('X-Namespace') || 'default'
  const signature = c.req.header('x-signature') || ''
  const payload = await c.req.text()

  if (!c.env.LEMONSQUEEZY_WEBHOOK_SECRET) {
    return c.json({ error: { message: 'Missing webhook secret' } }, 400)
  }

  const handler = new WebhookHandler({
    storage: new InMemoryWebhookStorage(),
    onEvent: async (event) => {
      console.log('Processing LemonSqueezy webhook event:', event.type, event.id)
    },
  })

  const result = await handler.handle('lemonsqueezy', payload, signature, c.env.LEMONSQUEEZY_WEBHOOK_SECRET)

  if (!result.success) {
    return c.json({ error: { message: result.error } }, 400)
  }

  return c.json({ received: true })
})

// =============================================================================
// Admin/Debug Endpoints
// =============================================================================

app.get('/admin/providers', async (c) => {
  const router = getPaymentRouter(c.env)
  return c.json({
    providers: router.listProviders(),
    stats: router.getCircuitBreakerStats(),
  })
})

app.get('/admin/webhook-stats', async (c) => {
  const namespace = c.req.header('X-Namespace') || 'default'
  const webhookLogsDO = getWebhookLogsDO(c.env, namespace)

  const response = await webhookLogsDO.fetch(
    new Request('http://internal/stats')
  )

  return c.json(await response.json())
})

// =============================================================================
// Export
// =============================================================================

// Re-export Durable Objects for wrangler.toml
export { CustomerDO, PaymentStateDO, WebhookLogDO } from './durable-objects'

export default app
