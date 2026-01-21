// SaaS Billing Cycle Durable Object
// Demonstrates: Subscription management, usage metering, invoice generation, dunning
// Key patterns: $.every scheduling, automatic retry logic, usage aggregation

import { Hono } from 'hono'
import { DO, type DOEnv, createContext } from '@dotdo/do'
import type {
  Subscription,
  SubscriptionStatus,
  Plan,
  Usage,
  UsageMetrics,
  UsageSummary,
  Invoice,
  InvoiceStatus,
  InvoiceLineItem,
  Payment,
  PaymentStatus,
  PaymentMethod,
  Customer,
} from './types'
import { DUNNING_SCHEDULE } from './types'

// Plan definitions
const PLANS: Record<string, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    interval: 'month',
    limits: { apiCalls: 1000, storage: 1, seats: 1 },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 4900, // $49/month
    interval: 'month',
    limits: { apiCalls: 50000, storage: 10, seats: 5 },
    metered: { apiCalls: 50, storage: 100 }, // $0.50/1k calls, $1/GB
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 29900, // $299/month
    interval: 'month',
    limits: { apiCalls: Infinity, storage: 100, seats: Infinity },
  },
}

const TAX_RATE = 0.08 // 8%

export class BillingDO extends DO {
  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env)
    this.$ = createContext(state, env)

    // ========================================================================
    // Event Handlers
    // ========================================================================

    this.$.on.Subscription.created(async (event) => {
      const { subscriptionId, customerId, planId } = (event as { type: string; payload: { subscriptionId: string; customerId: string; planId: string } }).payload
      console.log(`[Event] Subscription created: ${subscriptionId} for ${customerId} on ${planId}`)
    })

    this.$.on.Subscription.renewed(async (event) => {
      const { subscriptionId } = (event as { type: string; payload: { subscriptionId: string } }).payload
      console.log(`[Event] Subscription renewed: ${subscriptionId}`)
    })

    this.$.on.Invoice.created(async (event) => {
      const { invoiceId, total } = (event as { type: string; payload: { invoiceId: string; total: number } }).payload
      console.log(`[Event] Invoice created: ${invoiceId}, total: $${(total / 100).toFixed(2)}`)
    })

    this.$.on.Payment.succeeded(async (event) => {
      const { paymentId, invoiceId } = (event as { type: string; payload: { paymentId: string; invoiceId: string } }).payload
      console.log(`[Event] Payment succeeded: ${paymentId} for invoice ${invoiceId}`)
    })

    this.$.on.Payment.failed(async (event) => {
      const { paymentId, attempts, nextRetryAt } = (event as { type: string; payload: { paymentId: string; attempts: number; nextRetryAt?: string } }).payload
      console.log(`[Event] Payment failed: ${paymentId}, attempt ${attempts}${nextRetryAt ? `, next retry: ${nextRetryAt}` : ''}`)
    })

    this.$.on.Subscription.suspended(async (event) => {
      const { subscriptionId } = (event as { type: string; payload: { subscriptionId: string } }).payload
      console.log(`[Event] Subscription suspended: ${subscriptionId}`)
      // In production: notify customer, revoke access
    })

    // Wildcard handler for audit
    this.$.on['*']['*'](async (event) => {
      const e = event as { type: string; payload: unknown }
      console.log(`[Audit] ${e.type}`, e.payload)
    })

    // ========================================================================
    // Scheduled Tasks
    // ========================================================================

    // Daily at midnight - check for billing events
    this.$.every.day.atmidnight(async () => {
      console.log('[Scheduled] Running daily billing check...')
      await this.processBillingCycle()
    })

    // Hourly - check for payment retries
    this.$.every.hour(async () => {
      console.log('[Scheduled] Checking for payment retries...')
      await this.processPaymentRetries()
    })
  }

  private async processBillingCycle(): Promise<void> {
    const now = new Date()
    const subscriptions = await this.things.list({ type: 'Subscription' })

    for (const sub of subscriptions) {
      const s = sub as unknown as Subscription

      // Check for trial endings
      if (s.status === 'trialing' && s.trialEndsAt && new Date(s.trialEndsAt) <= now) {
        await this.endTrial(sub.$id)
      }

      // Check for period renewals
      if (s.status === 'active' && new Date(s.currentPeriodEnd) <= now) {
        await this.renewSubscription(sub.$id)
      }
    }
  }

  private async endTrial(subscriptionId: string): Promise<void> {
    const sub = await this.things.get(subscriptionId)
    if (!sub) return

    const s = sub as unknown as Subscription
    const plan = PLANS[s.planId]

    if (plan.price === 0) {
      // Free plan, just activate
      await this.things.update(subscriptionId, {
        status: 'active',
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: this.addMonth(new Date()).toISOString(),
      })
    } else {
      // Paid plan, generate invoice
      await this.generateInvoice(subscriptionId)
    }

    this.$.send({
      type: 'Subscription.trialEnded',
      payload: { subscriptionId },
    })
  }

  private async renewSubscription(subscriptionId: string): Promise<void> {
    const sub = await this.things.get(subscriptionId)
    if (!sub) return

    const s = sub as unknown as Subscription

    // Check if cancelled at period end
    if (s.cancelAtPeriodEnd) {
      await this.things.update(subscriptionId, { status: 'ended' })
      this.$.send({
        type: 'Subscription.ended',
        payload: { subscriptionId },
      })
      return
    }

    // Generate invoice for next period
    await this.generateInvoice(subscriptionId)
  }

  private async generateInvoice(subscriptionId: string): Promise<void> {
    const sub = await this.things.get(subscriptionId)
    if (!sub) return

    const s = sub as unknown as Subscription
    const plan = PLANS[s.planId]

    // Get usage for the period
    const usageSummary = await this.getUsageSummary(subscriptionId, s.planId)

    // Build line items
    const lineItems: InvoiceLineItem[] = [
      {
        description: `${plan.name} plan (monthly)`,
        amount: plan.price,
        type: 'subscription',
      },
    ]

    // Add overage charges
    if (usageSummary.overageCharges.total > 0) {
      for (const [metric, charge] of Object.entries(usageSummary.overageCharges)) {
        if (metric === 'total' || charge === 0) continue
        const overage = usageSummary.usage[metric]?.overage ?? 0
        lineItems.push({
          description: `${metric} overage (${overage.toLocaleString()} ${metric === 'apiCalls' ? 'calls' : 'GB'})`,
          amount: charge,
          type: 'usage',
          quantity: overage,
        })
      }
    }

    const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0)
    const tax = Math.round(subtotal * TAX_RATE)
    const total = subtotal + tax

    const now = new Date()
    const dueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // Due in 7 days

    const invoice = await this.things.create({
      $type: 'Invoice',
      subscriptionId,
      customerId: s.customerId,
      status: 'open' as InvoiceStatus,
      lineItems,
      subtotal,
      tax,
      total,
      periodStart: s.currentPeriodStart,
      periodEnd: s.currentPeriodEnd,
      dueDate: dueDate.toISOString(),
    })

    this.$.send({
      type: 'Invoice.created',
      payload: { invoiceId: invoice.$id, subscriptionId, total },
    })

    // Attempt payment immediately
    await this.processPayment(invoice.$id)
  }

  private async getUsageSummary(subscriptionId: string, planId: string): Promise<UsageSummary> {
    const plan = PLANS[planId]
    const usages = await this.things.list({ type: 'Usage' })
    const usage = usages.find((u) => (u as unknown as Usage).subscriptionId === subscriptionId)

    const metrics = usage ? (usage as unknown as Usage).metrics : { apiCalls: 0, storage: 0, seats: 0 }

    const result: UsageSummary = {
      usage: {},
      overageCharges: { total: 0 },
    }

    for (const [metric, used] of Object.entries(metrics)) {
      const limit = plan.limits[metric as keyof typeof plan.limits] ?? Infinity
      const overage = Math.max(0, used - limit)

      result.usage[metric] = { used, limit, overage }

      // Calculate overage charges
      if (overage > 0 && plan.metered) {
        const rate = plan.metered[metric as keyof typeof plan.metered] ?? 0
        let charge = 0
        if (metric === 'apiCalls') {
          charge = Math.ceil(overage / 1000) * rate // Per 1000 calls
        } else if (metric === 'storage') {
          charge = overage * rate // Per GB
        }
        result.overageCharges[metric] = charge
        result.overageCharges.total += charge
      }
    }

    return result
  }

  private async processPayment(invoiceId: string): Promise<boolean> {
    const invoice = await this.things.get(invoiceId)
    if (!invoice || invoice.$type !== 'Invoice') return false

    const inv = invoice as unknown as Invoice
    if (inv.status !== 'open') return false

    // Get customer's default payment method
    const paymentMethods = await this.things.list({ type: 'PaymentMethod' })
    const defaultMethod = paymentMethods.find(
      (pm) => (pm as unknown as PaymentMethod).customerId === inv.customerId &&
              (pm as unknown as PaymentMethod).isDefault
    )

    // Create payment record
    const payment = await this.things.create({
      $type: 'Payment',
      invoiceId,
      customerId: inv.customerId,
      amount: inv.total,
      status: 'processing' as PaymentStatus,
      paymentMethodId: defaultMethod?.$id,
      attempts: 1,
      lastAttemptAt: new Date().toISOString(),
    })

    // Simulate payment processing (90% success rate)
    const success = Math.random() < 0.9

    if (success) {
      await this.things.update(payment.$id, {
        status: 'succeeded',
        transactionId: `txn_${Date.now()}`,
      })

      await this.things.update(invoiceId, {
        status: 'paid',
        paidAt: new Date().toISOString(),
        paymentId: payment.$id,
      })

      // Update subscription
      const sub = await this.things.get(inv.subscriptionId)
      if (sub) {
        const s = sub as unknown as Subscription
        const newPeriodStart = new Date()
        const newPeriodEnd = this.addMonth(newPeriodStart)

        await this.things.update(inv.subscriptionId, {
          status: 'active',
          currentPeriodStart: newPeriodStart.toISOString(),
          currentPeriodEnd: newPeriodEnd.toISOString(),
        })

        this.$.send({
          type: 'Subscription.renewed',
          payload: { subscriptionId: inv.subscriptionId },
        })
      }

      this.$.send({
        type: 'Payment.succeeded',
        payload: { paymentId: payment.$id, invoiceId },
      })

      return true
    } else {
      // Payment failed
      const attemptIndex = 0
      const nextRetryDays = DUNNING_SCHEDULE[attemptIndex]
      const nextRetryAt = nextRetryDays
        ? new Date(Date.now() + nextRetryDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined

      await this.things.update(payment.$id, {
        status: 'failed',
        errorMessage: 'Payment declined',
        nextRetryAt,
      })

      // Update subscription to past_due
      await this.things.update(inv.subscriptionId, { status: 'past_due' })

      this.$.send({
        type: 'Payment.failed',
        payload: { paymentId: payment.$id, invoiceId, attempts: 1, nextRetryAt },
      })

      return false
    }
  }

  private async processPaymentRetries(): Promise<void> {
    const now = new Date()
    const payments = await this.things.list({ type: 'Payment' })

    for (const payment of payments) {
      const p = payment as unknown as Payment
      if (p.status !== 'failed' || !p.nextRetryAt) continue

      if (new Date(p.nextRetryAt) <= now) {
        const newAttempts = p.attempts + 1

        // Check if we've exhausted retries
        if (newAttempts > DUNNING_SCHEDULE.length + 1) {
          // Mark invoice as uncollectible
          await this.things.update(p.invoiceId, { status: 'uncollectible' })

          // Suspend subscription
          const invoice = await this.things.get(p.invoiceId)
          if (invoice) {
            const inv = invoice as unknown as Invoice
            await this.things.update(inv.subscriptionId, { status: 'suspended' })

            this.$.send({
              type: 'Subscription.suspended',
              payload: { subscriptionId: inv.subscriptionId },
            })
          }
          continue
        }

        // Retry payment
        await this.things.update(payment.$id, {
          status: 'processing',
          attempts: newAttempts,
          lastAttemptAt: now.toISOString(),
        })

        // Simulate retry (90% success)
        const success = Math.random() < 0.9

        if (success) {
          await this.things.update(payment.$id, {
            status: 'succeeded',
            transactionId: `txn_${Date.now()}`,
            nextRetryAt: undefined,
          })

          await this.things.update(p.invoiceId, {
            status: 'paid',
            paidAt: now.toISOString(),
            paymentId: payment.$id,
          })

          // Reactivate subscription
          const invoice = await this.things.get(p.invoiceId)
          if (invoice) {
            const inv = invoice as unknown as Invoice
            await this.things.update(inv.subscriptionId, { status: 'active' })
          }

          this.$.send({
            type: 'Payment.succeeded',
            payload: { paymentId: payment.$id, invoiceId: p.invoiceId },
          })
        } else {
          const nextRetryDays = DUNNING_SCHEDULE[newAttempts - 1]
          const nextRetryAt = nextRetryDays
            ? new Date(now.getTime() + nextRetryDays * 24 * 60 * 60 * 1000).toISOString()
            : undefined

          await this.things.update(payment.$id, {
            status: 'failed',
            nextRetryAt,
          })

          this.$.send({
            type: 'Payment.failed',
            payload: { paymentId: payment.$id, invoiceId: p.invoiceId, attempts: newAttempts, nextRetryAt },
          })
        }
      }
    }
  }

  private addMonth(date: Date): Date {
    const result = new Date(date)
    result.setMonth(result.getMonth() + 1)
    return result
  }

  protected routes(app: Hono): void {
    // ========================================================================
    // Plans
    // ========================================================================

    app.get('/plans', (c) => {
      return c.json(Object.values(PLANS))
    })

    // ========================================================================
    // Subscriptions
    // ========================================================================

    app.post('/subscriptions', async (c) => {
      const { customerId, planId, trialDays } = await c.req.json<{
        customerId: string
        planId: string
        trialDays?: number
      }>()

      const plan = PLANS[planId]
      if (!plan) {
        return c.json({ error: 'Plan not found' }, 404)
      }

      const now = new Date()
      const trialEndsAt = trialDays
        ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined

      const subscription = await this.things.create({
        $type: 'Subscription',
        customerId,
        planId,
        status: (trialDays ? 'trialing' : (plan.price === 0 ? 'active' : 'active')) as SubscriptionStatus,
        trialEndsAt,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: this.addMonth(now).toISOString(),
        cancelAtPeriodEnd: false,
      })

      // Create usage tracking
      await this.things.create({
        $type: 'Usage',
        subscriptionId: subscription.$id,
        periodStart: now.toISOString(),
        periodEnd: this.addMonth(now).toISOString(),
        metrics: { apiCalls: 0, storage: 0, seats: 1 },
      })

      this.$.send({
        type: 'Subscription.created',
        payload: { subscriptionId: subscription.$id, customerId, planId },
      })

      // If paid plan without trial, generate invoice immediately
      if (!trialDays && plan.price > 0) {
        await this.generateInvoice(subscription.$id)
      }

      return c.json(subscription, 201)
    })

    app.get('/subscriptions/:customerId', async (c) => {
      const customerId = c.req.param('customerId')
      const subscriptions = await this.things.list({ type: 'Subscription' })
      const subscription = subscriptions.find(
        (s) => (s as unknown as Subscription).customerId === customerId &&
               !['ended', 'cancelled'].includes((s as unknown as Subscription).status)
      )

      if (!subscription) {
        return c.json({ error: 'Subscription not found' }, 404)
      }
      return c.json(subscription)
    })

    app.put('/subscriptions/:customerId/plan', async (c) => {
      const customerId = c.req.param('customerId')
      const { planId, immediate = true } = await c.req.json<{
        planId: string
        immediate?: boolean
      }>()

      const plan = PLANS[planId]
      if (!plan) {
        return c.json({ error: 'Plan not found' }, 404)
      }

      const subscriptions = await this.things.list({ type: 'Subscription' })
      const subscription = subscriptions.find(
        (s) => (s as unknown as Subscription).customerId === customerId &&
               (s as unknown as Subscription).status === 'active'
      )

      if (!subscription) {
        return c.json({ error: 'Active subscription not found' }, 404)
      }

      const updated = await this.things.update(subscription.$id, { planId })

      this.$.send({
        type: 'Subscription.planChanged',
        payload: { subscriptionId: subscription.$id, newPlanId: planId, immediate },
      })

      return c.json(updated)
    })

    app.delete('/subscriptions/:customerId', async (c) => {
      const customerId = c.req.param('customerId')
      const { atPeriodEnd = true, reason } = await c.req.json<{
        atPeriodEnd?: boolean
        reason?: string
      }>().catch(() => ({}))

      const subscriptions = await this.things.list({ type: 'Subscription' })
      const subscription = subscriptions.find(
        (s) => (s as unknown as Subscription).customerId === customerId &&
               !['ended', 'cancelled'].includes((s as unknown as Subscription).status)
      )

      if (!subscription) {
        return c.json({ error: 'Subscription not found' }, 404)
      }

      const updated = await this.things.update(subscription.$id, {
        cancelAtPeriodEnd: atPeriodEnd,
        cancelledAt: new Date().toISOString(),
        cancelReason: reason,
        status: atPeriodEnd ? (subscription as unknown as Subscription).status : 'cancelled',
      })

      this.$.send({
        type: 'Subscription.cancelled',
        payload: { subscriptionId: subscription.$id, atPeriodEnd, reason },
      })

      return c.json(updated)
    })

    app.post('/subscriptions/:customerId/reactivate', async (c) => {
      const customerId = c.req.param('customerId')

      const subscriptions = await this.things.list({ type: 'Subscription' })
      const subscription = subscriptions.find(
        (s) => (s as unknown as Subscription).customerId === customerId &&
               ['cancelled', 'suspended'].includes((s as unknown as Subscription).status)
      )

      if (!subscription) {
        return c.json({ error: 'Cancelled/suspended subscription not found' }, 404)
      }

      const updated = await this.things.update(subscription.$id, {
        status: 'active',
        cancelAtPeriodEnd: false,
        cancelledAt: undefined,
        cancelReason: undefined,
      })

      this.$.send({
        type: 'Subscription.reactivated',
        payload: { subscriptionId: subscription.$id },
      })

      return c.json(updated)
    })

    // ========================================================================
    // Usage
    // ========================================================================

    app.post('/usage', async (c) => {
      const { subscriptionId, metric, quantity } = await c.req.json<{
        subscriptionId: string
        metric: keyof UsageMetrics
        quantity: number
      }>()

      const usages = await this.things.list({ type: 'Usage' })
      const usage = usages.find((u) => (u as unknown as Usage).subscriptionId === subscriptionId)

      if (!usage) {
        return c.json({ error: 'Usage tracking not found' }, 404)
      }

      const u = usage as unknown as Usage
      const newMetrics = { ...u.metrics }
      newMetrics[metric] = (newMetrics[metric] ?? 0) + quantity

      const updated = await this.things.update(usage.$id, { metrics: newMetrics })

      return c.json(updated)
    })

    app.get('/subscriptions/:customerId/usage', async (c) => {
      const customerId = c.req.param('customerId')

      const subscriptions = await this.things.list({ type: 'Subscription' })
      const subscription = subscriptions.find(
        (s) => (s as unknown as Subscription).customerId === customerId
      )

      if (!subscription) {
        return c.json({ error: 'Subscription not found' }, 404)
      }

      const s = subscription as unknown as Subscription
      return c.json(await this.getUsageSummary(subscription.$id, s.planId))
    })

    // ========================================================================
    // Payment Methods
    // ========================================================================

    app.post('/customers/:customerId/payment-methods', async (c) => {
      const customerId = c.req.param('customerId')
      const { type, token, makeDefault } = await c.req.json<{
        type: 'card' | 'bank'
        token: string
        makeDefault?: boolean
      }>()

      // Simulate tokenization
      const last4 = token.slice(-4)

      // If making default, unset existing default
      if (makeDefault) {
        const methods = await this.things.list({ type: 'PaymentMethod' })
        for (const m of methods) {
          const pm = m as unknown as PaymentMethod
          if (pm.customerId === customerId && pm.isDefault) {
            await this.things.update(m.$id, { isDefault: false })
          }
        }
      }

      const method = await this.things.create({
        $type: 'PaymentMethod',
        customerId,
        type,
        last4,
        brand: type === 'card' ? 'visa' : undefined,
        expiryMonth: type === 'card' ? 12 : undefined,
        expiryYear: type === 'card' ? 2028 : undefined,
        isDefault: makeDefault ?? false,
      })

      return c.json(method, 201)
    })

    app.get('/customers/:customerId/payment-methods', async (c) => {
      const customerId = c.req.param('customerId')
      const methods = await this.things.list({ type: 'PaymentMethod' })
      const customerMethods = methods.filter(
        (m) => (m as unknown as PaymentMethod).customerId === customerId
      )
      return c.json(customerMethods)
    })

    // ========================================================================
    // Invoices
    // ========================================================================

    app.get('/invoices/:id', async (c) => {
      const invoice = await this.things.get(c.req.param('id'))
      if (!invoice || invoice.$type !== 'Invoice') {
        return c.json({ error: 'Invoice not found' }, 404)
      }
      return c.json(invoice)
    })

    app.post('/invoices/:id/pay', async (c) => {
      const invoiceId = c.req.param('id')
      const success = await this.processPayment(invoiceId)
      const invoice = await this.things.get(invoiceId)
      return c.json({ success, invoice })
    })

    // ========================================================================
    // Payments
    // ========================================================================

    app.get('/customers/:customerId/payments', async (c) => {
      const customerId = c.req.param('customerId')
      const payments = await this.things.list({ type: 'Payment' })
      const customerPayments = payments.filter(
        (p) => (p as unknown as Payment).customerId === customerId
      )
      return c.json(customerPayments)
    })
  }
}

// Export for worker binding
export { BillingDO as DO }
