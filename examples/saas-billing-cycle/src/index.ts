/**
 * SaaS Billing Cycle Example
 *
 * Complete subscription management system demonstrating:
 * - Subscription lifecycle (trial -> active -> cancelled)
 * - Usage-based billing with metering
 * - Invoice generation with line items
 * - Payment processing with dunning (retry logic)
 * - Scheduled billing with $.every
 *
 * Each customer has their own set of DOs:
 * - SubscriptionDO: Manages subscription state and plan changes
 * - UsageDO: Tracks metered usage per billing period
 * - PaymentDO: Processes payments and handles retries
 * - InvoiceDO: Generates and manages invoices
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Re-export DO classes for Wrangler
export { SubscriptionDO, PLANS } from './objects/Subscription'
export { UsageDO } from './objects/Usage'
export { InvoiceDO } from './objects/Invoice'
export { PaymentDO } from './objects/Payment'

import type { Plan, Subscription } from './objects/Subscription'
import type { UsageMetric } from './objects/Usage'

// ============================================================================
// TYPES
// ============================================================================

interface Env {
  SUBSCRIPTION: DurableObjectNamespace
  USAGE: DurableObjectNamespace
  INVOICE: DurableObjectNamespace
  PAYMENT: DurableObjectNamespace
}

interface CreateSubscriptionRequest {
  customerId: string
  planId: string
  trialDays?: number
}

interface ChangePlanRequest {
  planId: string
  immediate?: boolean
}

interface CancelRequest {
  atPeriodEnd?: boolean
  reason?: string
}

interface RecordUsageRequest {
  subscriptionId: string
  metric: UsageMetric
  quantity: number
}

interface AddPaymentMethodRequest {
  type: 'card' | 'bank' | 'wallet'
  token: string
  makeDefault?: boolean
}

// ============================================================================
// HTTP ROUTES
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// Enable CORS for browser testing
app.use('*', cors())

/**
 * GET / - API documentation
 */
app.get('/', (c) => {
  return c.json({
    name: 'SaaS Billing Cycle API',
    version: '1.0.0',
    tagline: 'Billing that runs itself.',
    description: 'Complete subscription lifecycle: plans, billing, dunning, usage tracking',
    architecture: {
      SubscriptionDO: 'Per-customer subscription state, plan changes, lifecycle',
      UsageDO: 'Per-subscription metered usage tracking',
      InvoiceDO: 'Invoice generation and management',
      PaymentDO: 'Payment processing with dunning (retry logic)',
    },
    endpoints: {
      plans: {
        'GET /plans': 'List available plans',
      },
      subscriptions: {
        'POST /subscriptions': 'Create a subscription',
        'GET /subscriptions/:customerId': 'Get subscription details',
        'PUT /subscriptions/:customerId/plan': 'Change plan (upgrade/downgrade)',
        'DELETE /subscriptions/:customerId': 'Cancel subscription',
        'POST /subscriptions/:customerId/reactivate': 'Reactivate cancelled subscription',
      },
      usage: {
        'POST /usage': 'Record metered usage',
        'GET /subscriptions/:customerId/usage': 'Get current period usage',
        'GET /subscriptions/:customerId/usage/history': 'Get usage history',
      },
      payments: {
        'POST /customers/:customerId/payment-methods': 'Add payment method',
        'GET /customers/:customerId/payment-methods': 'List payment methods',
        'DELETE /customers/:customerId/payment-methods/:id': 'Remove payment method',
        'GET /customers/:customerId/payments': 'Get payment history',
      },
      invoices: {
        'GET /invoices/:id': 'Get invoice details',
        'POST /invoices/:id/pay': 'Retry payment',
      },
    },
    example: {
      createSubscription: {
        method: 'POST',
        path: '/subscriptions',
        body: { customerId: 'cust_123', planId: 'pro', trialDays: 14 },
      },
      recordUsage: {
        method: 'POST',
        path: '/usage',
        body: { subscriptionId: 'sub_abc', metric: 'api_calls', quantity: 1500 },
      },
    },
  })
})

// ============================================================================
// PLAN ROUTES
// ============================================================================

/**
 * GET /plans - List available plans
 */
app.get('/plans', async (c) => {
  // Get plans from any subscription DO (they're static)
  const id = c.env.SUBSCRIPTION.idFromName('plans')
  const stub = c.env.SUBSCRIPTION.get(id)

  const response = await stub.fetch(
    new Request('http://internal/rpc/getPlans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const plans = (await response.json()) as Plan[]

  return c.json({
    plans,
    note: 'Prices in cents. Free plan has no billing. Pro and Enterprise have usage-based overage charges.',
  })
})

// ============================================================================
// SUBSCRIPTION ROUTES
// ============================================================================

/**
 * POST /subscriptions - Create a subscription
 */
app.post('/subscriptions', async (c) => {
  const body = await c.req.json<CreateSubscriptionRequest>()

  if (!body.customerId || !body.planId) {
    return c.json({ error: 'customerId and planId are required' }, 400)
  }

  // Route to customer's SubscriptionDO
  const id = c.env.SUBSCRIPTION.idFromName(body.customerId)
  const stub = c.env.SUBSCRIPTION.get(id)

  try {
    const response = await stub.fetch(
      new Request('http://internal/rpc/create', {
        method: 'POST',
        body: JSON.stringify([body.customerId, body.planId, { trialDays: body.trialDays }]),
        headers: { 'Content-Type': 'application/json' },
      })
    )

    if (!response.ok) {
      const error = await response.json()
      return c.json({ error }, 400)
    }

    const subscription = (await response.json()) as Subscription

    // Also set up UsageDO with plan ID
    const usageId = c.env.USAGE.idFromName(subscription.id)
    const usageStub = c.env.USAGE.get(usageId)
    await usageStub.fetch(
      new Request('http://internal/rpc/setPlanId', {
        method: 'POST',
        body: JSON.stringify([body.planId]),
        headers: { 'Content-Type': 'application/json' },
      })
    )

    return c.json(
      {
        success: true,
        message: subscription.status === 'trialing' ? 'Trial started' : 'Subscription created',
        subscription,
        events: [
          'Subscription.created',
          subscription.status === 'active' ? 'Invoice.generate' : null,
          'Customer.notify',
        ].filter(Boolean),
      },
      201
    )
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

/**
 * GET /subscriptions/:customerId - Get subscription details
 */
app.get('/subscriptions/:customerId', async (c) => {
  const customerId = c.req.param('customerId')

  const id = c.env.SUBSCRIPTION.idFromName(customerId)
  const stub = c.env.SUBSCRIPTION.get(id)

  const response = await stub.fetch(
    new Request('http://internal/rpc/getSubscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const subscription = await response.json()

  if (!subscription) {
    return c.json({ error: 'Subscription not found' }, 404)
  }

  return c.json({ subscription })
})

/**
 * PUT /subscriptions/:customerId/plan - Change plan
 */
app.put('/subscriptions/:customerId/plan', async (c) => {
  const customerId = c.req.param('customerId')
  const body = await c.req.json<ChangePlanRequest>()

  if (!body.planId) {
    return c.json({ error: 'planId is required' }, 400)
  }

  const id = c.env.SUBSCRIPTION.idFromName(customerId)
  const stub = c.env.SUBSCRIPTION.get(id)

  try {
    const response = await stub.fetch(
      new Request('http://internal/rpc/changePlan', {
        method: 'POST',
        body: JSON.stringify([body.planId, { immediate: body.immediate }]),
        headers: { 'Content-Type': 'application/json' },
      })
    )

    if (!response.ok) {
      const error = await response.json()
      return c.json({ error }, 400)
    }

    const result = (await response.json()) as { prorationAmount?: number; effectiveDate: Date }

    return c.json({
      success: true,
      message: 'Plan change initiated',
      prorationAmount: result.prorationAmount,
      effectiveDate: result.effectiveDate,
    })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

/**
 * DELETE /subscriptions/:customerId - Cancel subscription
 */
app.delete('/subscriptions/:customerId', async (c) => {
  const customerId = c.req.param('customerId')
  const body = await c.req.json<CancelRequest>().catch((): CancelRequest => ({}))

  const id = c.env.SUBSCRIPTION.idFromName(customerId)
  const stub = c.env.SUBSCRIPTION.get(id)

  const atPeriodEnd = body.atPeriodEnd ?? true

  try {
    const response = await stub.fetch(
      new Request('http://internal/rpc/cancel', {
        method: 'POST',
        body: JSON.stringify([{ atPeriodEnd, reason: body.reason }]),
        headers: { 'Content-Type': 'application/json' },
      })
    )

    if (!response.ok) {
      const error = await response.json()
      return c.json({ error }, 400)
    }

    return c.json({
      success: true,
      message: atPeriodEnd ? 'Subscription will cancel at period end' : 'Subscription cancelled immediately',
      atPeriodEnd,
    })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

/**
 * POST /subscriptions/:customerId/reactivate - Reactivate subscription
 */
app.post('/subscriptions/:customerId/reactivate', async (c) => {
  const customerId = c.req.param('customerId')

  const id = c.env.SUBSCRIPTION.idFromName(customerId)
  const stub = c.env.SUBSCRIPTION.get(id)

  try {
    const response = await stub.fetch(
      new Request('http://internal/rpc/reactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )

    if (!response.ok) {
      const error = await response.json()
      return c.json({ error }, 400)
    }

    return c.json({
      success: true,
      message: 'Subscription reactivated',
    })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

// ============================================================================
// USAGE ROUTES
// ============================================================================

/**
 * POST /usage - Record metered usage
 */
app.post('/usage', async (c) => {
  const body = await c.req.json<RecordUsageRequest>()

  if (!body.subscriptionId || !body.metric || body.quantity === undefined) {
    return c.json({ error: 'subscriptionId, metric, and quantity are required' }, 400)
  }

  // Route to subscription's UsageDO
  const id = c.env.USAGE.idFromName(body.subscriptionId)
  const stub = c.env.USAGE.get(id)

  try {
    const response = await stub.fetch(
      new Request('http://internal/rpc/record', {
        method: 'POST',
        body: JSON.stringify([body.metric, body.quantity]),
        headers: { 'Content-Type': 'application/json' },
      })
    )

    if (!response.ok) {
      const error = await response.json()
      return c.json({ error }, 400)
    }

    const record = await response.json()

    return c.json({
      success: true,
      message: 'Usage recorded',
      record,
      note: 'Usage charges will be calculated at end of billing period',
    })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

/**
 * GET /subscriptions/:customerId/usage - Get current period usage
 */
app.get('/subscriptions/:customerId/usage', async (c) => {
  const customerId = c.req.param('customerId')

  // First get subscription to find subscription ID
  const subId = c.env.SUBSCRIPTION.idFromName(customerId)
  const subStub = c.env.SUBSCRIPTION.get(subId)

  const subResponse = await subStub.fetch(
    new Request('http://internal/rpc/getSubscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const subscription = (await subResponse.json()) as Subscription | null

  if (!subscription) {
    return c.json({ error: 'Subscription not found' }, 404)
  }

  // Get usage from UsageDO
  const usageId = c.env.USAGE.idFromName(subscription.id)
  const usageStub = c.env.USAGE.get(usageId)

  const usageResponse = await usageStub.fetch(
    new Request('http://internal/rpc/getSummary', {
      method: 'POST',
      body: JSON.stringify([subscription.planId]),
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const usage = await usageResponse.json()

  return c.json({ usage })
})

/**
 * GET /subscriptions/:customerId/usage/history - Get usage history
 */
app.get('/subscriptions/:customerId/usage/history', async (c) => {
  const customerId = c.req.param('customerId')
  const months = parseInt(c.req.query('months') ?? '6', 10)

  // First get subscription
  const subId = c.env.SUBSCRIPTION.idFromName(customerId)
  const subStub = c.env.SUBSCRIPTION.get(subId)

  const subResponse = await subStub.fetch(
    new Request('http://internal/rpc/getSubscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const subscription = (await subResponse.json()) as Subscription | null

  if (!subscription) {
    return c.json({ error: 'Subscription not found' }, 404)
  }

  // Get history from UsageDO
  const usageId = c.env.USAGE.idFromName(subscription.id)
  const usageStub = c.env.USAGE.get(usageId)

  const historyResponse = await usageStub.fetch(
    new Request('http://internal/rpc/getHistory', {
      method: 'POST',
      body: JSON.stringify([months]),
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const history = await historyResponse.json()

  return c.json({ history })
})

// ============================================================================
// PAYMENT ROUTES
// ============================================================================

/**
 * POST /customers/:customerId/payment-methods - Add payment method
 */
app.post('/customers/:customerId/payment-methods', async (c) => {
  const customerId = c.req.param('customerId')
  const body = await c.req.json<AddPaymentMethodRequest>()

  if (!body.type || !body.token) {
    return c.json({ error: 'type and token are required' }, 400)
  }

  const id = c.env.PAYMENT.idFromName(customerId)
  const stub = c.env.PAYMENT.get(id)

  try {
    const response = await stub.fetch(
      new Request('http://internal/rpc/addPaymentMethod', {
        method: 'POST',
        body: JSON.stringify([body.type, body.token, body.makeDefault]),
        headers: { 'Content-Type': 'application/json' },
      })
    )

    if (!response.ok) {
      const error = await response.json()
      return c.json({ error }, 400)
    }

    const paymentMethod = await response.json()

    return c.json({
      success: true,
      message: 'Payment method added',
      paymentMethod,
    })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

/**
 * GET /customers/:customerId/payment-methods - List payment methods
 */
app.get('/customers/:customerId/payment-methods', async (c) => {
  const customerId = c.req.param('customerId')

  const id = c.env.PAYMENT.idFromName(customerId)
  const stub = c.env.PAYMENT.get(id)

  const response = await stub.fetch(
    new Request('http://internal/rpc/getPaymentMethods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const paymentMethods = await response.json()

  return c.json({ paymentMethods })
})

/**
 * DELETE /customers/:customerId/payment-methods/:id - Remove payment method
 */
app.delete('/customers/:customerId/payment-methods/:id', async (c) => {
  const customerId = c.req.param('customerId')
  const paymentMethodId = c.req.param('id')

  const id = c.env.PAYMENT.idFromName(customerId)
  const stub = c.env.PAYMENT.get(id)

  try {
    const response = await stub.fetch(
      new Request('http://internal/rpc/removePaymentMethod', {
        method: 'POST',
        body: JSON.stringify([paymentMethodId]),
        headers: { 'Content-Type': 'application/json' },
      })
    )

    if (!response.ok) {
      const error = await response.json()
      return c.json({ error }, 400)
    }

    return c.json({
      success: true,
      message: 'Payment method removed',
    })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

/**
 * GET /customers/:customerId/payments - Get payment history
 */
app.get('/customers/:customerId/payments', async (c) => {
  const customerId = c.req.param('customerId')
  const limit = parseInt(c.req.query('limit') ?? '20', 10)

  const id = c.env.PAYMENT.idFromName(customerId)
  const stub = c.env.PAYMENT.get(id)

  const response = await stub.fetch(
    new Request('http://internal/rpc/getHistory', {
      method: 'POST',
      body: JSON.stringify([limit]),
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const payments = await response.json()

  return c.json({ payments })
})

// ============================================================================
// INVOICE ROUTES
// ============================================================================

/**
 * GET /invoices/:id - Get invoice details
 */
app.get('/invoices/:id', async (c) => {
  const invoiceId = c.req.param('id')

  const id = c.env.INVOICE.idFromName(invoiceId)
  const stub = c.env.INVOICE.get(id)

  const response = await stub.fetch(
    new Request('http://internal/rpc/getInvoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const invoice = await response.json()

  if (!invoice) {
    return c.json({ error: 'Invoice not found' }, 404)
  }

  return c.json({
    invoice,
    formatted: {
      subtotal: `$${((invoice as { subtotal: number }).subtotal / 100).toFixed(2)}`,
      tax: `$${((invoice as { tax: number }).tax / 100).toFixed(2)}`,
      total: `$${((invoice as { total: number }).total / 100).toFixed(2)}`,
    },
  })
})

/**
 * POST /invoices/:id/pay - Retry payment
 */
app.post('/invoices/:id/pay', async (c) => {
  const invoiceId = c.req.param('id')

  const id = c.env.INVOICE.idFromName(invoiceId)
  const stub = c.env.INVOICE.get(id)

  const invoiceResponse = await stub.fetch(
    new Request('http://internal/rpc/getInvoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  )

  const invoice = (await invoiceResponse.json()) as {
    id: string
    customerId: string
    subscriptionId: string
    total: number
    currency: string
    status: string
  } | null

  if (!invoice) {
    return c.json({ error: 'Invoice not found' }, 404)
  }

  if (invoice.status === 'paid') {
    return c.json({ error: 'Invoice already paid' }, 400)
  }

  if (invoice.status === 'void') {
    return c.json({ error: 'Invoice has been voided' }, 400)
  }

  // Trigger payment through PaymentDO
  const paymentId = c.env.PAYMENT.idFromName(invoice.customerId)
  const paymentStub = c.env.PAYMENT.get(paymentId)

  await paymentStub.fetch(
    new Request('http://internal/rpc/processPayment', {
      method: 'POST',
      body: JSON.stringify([
        {
          invoiceId: invoice.id,
          subscriptionId: invoice.subscriptionId,
          customerId: invoice.customerId,
          amount: invoice.total,
          currency: invoice.currency,
        },
      ]),
      headers: { 'Content-Type': 'application/json' },
    })
  )

  return c.json({
    success: true,
    message: 'Payment retry initiated',
    invoiceId,
    amount: `$${(invoice.total / 100).toFixed(2)}`,
  })
})

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * GET /health - Health check
 */
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

export default app
