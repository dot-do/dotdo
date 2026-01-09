/**
 * payments.do - Platform Billing for .do
 *
 * ns: https://payments.do
 *
 * Handles all billing and payments for the .do platform:
 *   - Stripe Connect payments via linked accounts (from id.org.ai)
 *   - Platform fee collection (application_fee_amount)
 *   - Usage-based billing and metering
 *   - Subscription management
 *   - Invoice generation
 *
 * Flow:
 *   1. User links Stripe account at id.org.ai via OAuth
 *   2. User's apps can accept payments via payments.do
 *   3. payments.do processes charges using connected account
 *   4. .do platform takes fee via application_fee_amount
 *   5. User receives payout to their Stripe account
 */

import { DurableObject } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import { eq, and, desc, gte, sql } from 'drizzle-orm'
import Stripe from 'stripe'
import * as schema from './schema'

// ============================================================================
// TYPES
// ============================================================================

export interface PaymentsEnv {
  DB?: D1Database
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  PLATFORM_FEE_PERCENT: string // e.g., "2.9" for 2.9%
  IDENTITY_DO: DurableObjectNamespace // id.org.ai DO binding
}

export interface Charge {
  id: string
  amount: number // in cents
  currency: string
  status: 'pending' | 'succeeded' | 'failed' | 'refunded'
  customerId: string
  connectedAccountId: string
  platformFee: number
  stripeChargeId?: string
  metadata?: Record<string, string>
}

export interface Subscription {
  id: string
  customerId: string
  planId: string
  status: 'active' | 'past_due' | 'canceled' | 'trialing'
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
}

export interface UsageRecord {
  id: string
  subscriptionItemId: string
  quantity: number
  timestamp: Date
  action: 'increment' | 'set'
}

// ============================================================================
// PAYMENTS DO
// ============================================================================

export class PaymentsDO extends DurableObject<PaymentsEnv> {
  readonly ns = 'https://payments.do'
  protected db: DrizzleSqliteDODatabase<typeof schema>
  protected stripe: Stripe

  constructor(ctx: DurableObjectState, env: PaymentsEnv) {
    super(ctx, env)
    this.db = drizzle(ctx.storage, { schema })
    this.stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-12-18.acacia',
      httpClient: Stripe.createFetchHttpClient(),
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAYMENT PROCESSING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a payment intent using a connected account
   *
   * @param connectedAccountId - Stripe connected account ID (from id.org.ai linked accounts)
   * @param amount - Amount in cents
   * @param currency - ISO currency code
   * @param metadata - Optional metadata
   */
  async createPaymentIntent(data: {
    connectedAccountId: string
    amount: number
    currency: string
    customerId?: string
    description?: string
    metadata?: Record<string, string>
    applicationFeePercent?: number
  }): Promise<{
    id: string
    clientSecret: string
    amount: number
    currency: string
    platformFee: number
  }> {
    // Calculate platform fee
    const feePercent = data.applicationFeePercent ?? parseFloat(this.env.PLATFORM_FEE_PERCENT || '2.9')
    const platformFee = Math.round(data.amount * (feePercent / 100))

    // Create payment intent on connected account
    const paymentIntent = await this.stripe.paymentIntents.create(
      {
        amount: data.amount,
        currency: data.currency,
        description: data.description,
        metadata: data.metadata,
        application_fee_amount: platformFee,
      },
      {
        stripeAccount: data.connectedAccountId,
      },
    )

    // Record the charge
    const now = new Date()
    await this.db.insert(schema.charges).values({
      id: crypto.randomUUID(),
      stripePaymentIntentId: paymentIntent.id,
      connectedAccountId: data.connectedAccountId,
      customerId: data.customerId,
      amount: data.amount,
      currency: data.currency,
      platformFee,
      status: 'pending',
      metadata: data.metadata,
      createdAt: now,
      updatedAt: now,
    })

    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret!,
      amount: data.amount,
      currency: data.currency,
      platformFee,
    }
  }

  /**
   * Process a one-time charge (server-side)
   */
  async createCharge(data: {
    connectedAccountId: string
    customerId: string
    amount: number
    currency: string
    paymentMethodId: string
    description?: string
    metadata?: Record<string, string>
  }): Promise<Charge> {
    const feePercent = parseFloat(this.env.PLATFORM_FEE_PERCENT || '2.9')
    const platformFee = Math.round(data.amount * (feePercent / 100))

    // First, ensure customer exists on connected account
    // (customers are per-connected-account in Stripe Connect)

    // Create the charge
    const paymentIntent = await this.stripe.paymentIntents.create(
      {
        amount: data.amount,
        currency: data.currency,
        customer: data.customerId,
        payment_method: data.paymentMethodId,
        confirm: true,
        off_session: true,
        description: data.description,
        metadata: data.metadata,
        application_fee_amount: platformFee,
      },
      {
        stripeAccount: data.connectedAccountId,
      },
    )

    // Record the charge
    const id = crypto.randomUUID()
    const now = new Date()
    await this.db.insert(schema.charges).values({
      id,
      stripePaymentIntentId: paymentIntent.id,
      stripeChargeId: paymentIntent.latest_charge as string,
      connectedAccountId: data.connectedAccountId,
      customerId: data.customerId,
      amount: data.amount,
      currency: data.currency,
      platformFee,
      status: paymentIntent.status === 'succeeded' ? 'succeeded' : 'pending',
      metadata: data.metadata,
      createdAt: now,
      updatedAt: now,
    })

    return {
      id,
      amount: data.amount,
      currency: data.currency,
      status: paymentIntent.status === 'succeeded' ? 'succeeded' : 'pending',
      customerId: data.customerId,
      connectedAccountId: data.connectedAccountId,
      platformFee,
      stripeChargeId: paymentIntent.latest_charge as string,
      metadata: data.metadata,
    }
  }

  /**
   * Refund a charge
   */
  async refundCharge(
    chargeId: string,
    options?: { amount?: number; reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer' },
  ): Promise<{ refundId: string; amount: number }> {
    const charge = await this.db.query.charges.findFirst({
      where: eq(schema.charges.id, chargeId),
    })

    if (!charge || !charge.stripeChargeId) {
      throw new Error('Charge not found')
    }

    const refund = await this.stripe.refunds.create(
      {
        charge: charge.stripeChargeId,
        amount: options?.amount,
        reason: options?.reason,
        refund_application_fee: true,
      },
      {
        stripeAccount: charge.connectedAccountId,
      },
    )

    // Update charge status
    await this.db.update(schema.charges).set({ status: 'refunded', updatedAt: new Date() }).where(eq(schema.charges.id, chargeId))

    return {
      refundId: refund.id,
      amount: refund.amount,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a subscription on a connected account
   */
  async createSubscription(data: {
    connectedAccountId: string
    customerId: string
    priceId: string
    trialDays?: number
    metadata?: Record<string, string>
  }): Promise<Subscription> {
    const subscription = await this.stripe.subscriptions.create(
      {
        customer: data.customerId,
        items: [{ price: data.priceId }],
        trial_period_days: data.trialDays,
        metadata: data.metadata,
        application_fee_percent: parseFloat(this.env.PLATFORM_FEE_PERCENT || '2.9'),
      },
      {
        stripeAccount: data.connectedAccountId,
      },
    )

    // Record subscription
    const id = crypto.randomUUID()
    const now = new Date()
    await this.db.insert(schema.subscriptions).values({
      id,
      stripeSubscriptionId: subscription.id,
      connectedAccountId: data.connectedAccountId,
      customerId: data.customerId,
      priceId: data.priceId,
      status: subscription.status as any,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      metadata: data.metadata,
      createdAt: now,
      updatedAt: now,
    })

    return {
      id,
      customerId: data.customerId,
      planId: data.priceId,
      status: subscription.status as any,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    }
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(subscriptionId: string, options?: { cancelAtPeriodEnd?: boolean }): Promise<void> {
    const sub = await this.db.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.id, subscriptionId),
    })

    if (!sub) {
      throw new Error('Subscription not found')
    }

    if (options?.cancelAtPeriodEnd) {
      await this.stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true }, { stripeAccount: sub.connectedAccountId })
      await this.db.update(schema.subscriptions).set({ cancelAtPeriodEnd: true, updatedAt: new Date() }).where(eq(schema.subscriptions.id, subscriptionId))
    } else {
      await this.stripe.subscriptions.cancel(sub.stripeSubscriptionId, {
        stripeAccount: sub.connectedAccountId,
      })
      await this.db.update(schema.subscriptions).set({ status: 'canceled', updatedAt: new Date() }).where(eq(schema.subscriptions.id, subscriptionId))
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USAGE-BASED BILLING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Record usage for metered billing
   */
  async recordUsage(data: {
    connectedAccountId: string
    subscriptionItemId: string
    quantity: number
    timestamp?: Date
    action?: 'increment' | 'set'
  }): Promise<UsageRecord> {
    const timestamp = data.timestamp || new Date()
    const action = data.action || 'increment'

    // Report to Stripe
    await this.stripe.subscriptionItems.createUsageRecord(
      data.subscriptionItemId,
      {
        quantity: data.quantity,
        timestamp: Math.floor(timestamp.getTime() / 1000),
        action,
      },
      {
        stripeAccount: data.connectedAccountId,
      },
    )

    // Record locally
    const id = crypto.randomUUID()
    await this.db.insert(schema.usageRecords).values({
      id,
      subscriptionItemId: data.subscriptionItemId,
      connectedAccountId: data.connectedAccountId,
      quantity: data.quantity,
      action,
      timestamp,
      createdAt: new Date(),
    })

    return {
      id,
      subscriptionItemId: data.subscriptionItemId,
      quantity: data.quantity,
      timestamp,
      action,
    }
  }

  /**
   * Get usage summary for a subscription item
   */
  async getUsageSummary(subscriptionItemId: string, periodStart?: Date, periodEnd?: Date): Promise<{ quantity: number; records: UsageRecord[] }> {
    const conditions = [eq(schema.usageRecords.subscriptionItemId, subscriptionItemId)]

    if (periodStart) {
      conditions.push(gte(schema.usageRecords.timestamp, periodStart))
    }

    const records = await this.db.query.usageRecords.findMany({
      where: and(...conditions),
      orderBy: desc(schema.usageRecords.timestamp),
    })

    // Calculate total (handling both increment and set actions)
    let quantity = 0
    for (const record of records) {
      if (record.action === 'set') {
        quantity = record.quantity
      } else {
        quantity += record.quantity
      }
    }

    return {
      quantity,
      records: records.map((r) => ({
        id: r.id,
        subscriptionItemId: r.subscriptionItemId,
        quantity: r.quantity,
        timestamp: r.timestamp,
        action: r.action as 'increment' | 'set',
      })),
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOMER MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a customer on a connected account
   */
  async createCustomer(data: {
    connectedAccountId: string
    email: string
    name?: string
    metadata?: Record<string, string>
  }): Promise<{ id: string; stripeCustomerId: string }> {
    const customer = await this.stripe.customers.create(
      {
        email: data.email,
        name: data.name,
        metadata: data.metadata,
      },
      {
        stripeAccount: data.connectedAccountId,
      },
    )

    const id = crypto.randomUUID()
    const now = new Date()
    await this.db.insert(schema.customers).values({
      id,
      stripeCustomerId: customer.id,
      connectedAccountId: data.connectedAccountId,
      email: data.email,
      name: data.name,
      metadata: data.metadata,
      createdAt: now,
      updatedAt: now,
    })

    return {
      id,
      stripeCustomerId: customer.id,
    }
  }

  /**
   * Get or create customer by email
   */
  async getOrCreateCustomer(data: { connectedAccountId: string; email: string; name?: string }): Promise<{ id: string; stripeCustomerId: string }> {
    // Check if exists locally
    const existing = await this.db.query.customers.findFirst({
      where: and(eq(schema.customers.connectedAccountId, data.connectedAccountId), eq(schema.customers.email, data.email)),
    })

    if (existing) {
      return {
        id: existing.id,
        stripeCustomerId: existing.stripeCustomerId,
      }
    }

    return this.createCustomer(data)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PLATFORM REVENUE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get platform revenue for a period
   */
  async getPlatformRevenue(options?: { startDate?: Date; endDate?: Date; connectedAccountId?: string }): Promise<{
    totalRevenue: number
    totalFees: number
    chargeCount: number
    byAccount: { accountId: string; revenue: number; fees: number; count: number }[]
  }> {
    const conditions: any[] = [eq(schema.charges.status, 'succeeded')]

    if (options?.startDate) {
      conditions.push(gte(schema.charges.createdAt, options.startDate))
    }
    if (options?.connectedAccountId) {
      conditions.push(eq(schema.charges.connectedAccountId, options.connectedAccountId))
    }

    const charges = await this.db.query.charges.findMany({
      where: and(...conditions),
    })

    const byAccount = new Map<string, { revenue: number; fees: number; count: number }>()

    let totalRevenue = 0
    let totalFees = 0

    for (const charge of charges) {
      totalRevenue += charge.amount
      totalFees += charge.platformFee || 0

      const existing = byAccount.get(charge.connectedAccountId) || { revenue: 0, fees: 0, count: 0 }
      existing.revenue += charge.amount
      existing.fees += charge.platformFee || 0
      existing.count++
      byAccount.set(charge.connectedAccountId, existing)
    }

    return {
      totalRevenue,
      totalFees,
      chargeCount: charges.length,
      byAccount: Array.from(byAccount.entries()).map(([accountId, stats]) => ({
        accountId,
        ...stats,
      })),
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBHOOK HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle Stripe webhook events
   */
  async handleWebhook(request: Request): Promise<Response> {
    const signature = request.headers.get('stripe-signature')
    if (!signature) {
      return new Response('Missing signature', { status: 400 })
    }

    const body = await request.text()
    let event: Stripe.Event

    try {
      event = this.stripe.webhooks.constructEvent(body, signature, this.env.STRIPE_WEBHOOK_SECRET)
    } catch (err) {
      return new Response('Invalid signature', { status: 400 })
    }

    // Handle different event types
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent)
        break
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent)
        break
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
        break
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break
      case 'invoice.payment_succeeded':
        await this.handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice)
        break
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
        break
    }

    return new Response('OK', { status: 200 })
  }

  private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    await this.db
      .update(schema.charges)
      .set({
        status: 'succeeded',
        stripeChargeId: paymentIntent.latest_charge as string,
        updatedAt: new Date(),
      })
      .where(eq(schema.charges.stripePaymentIntentId, paymentIntent.id))
  }

  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    await this.db.update(schema.charges).set({ status: 'failed', updatedAt: new Date() }).where(eq(schema.charges.stripePaymentIntentId, paymentIntent.id))
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    await this.db
      .update(schema.subscriptions)
      .set({
        status: subscription.status as any,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        updatedAt: new Date(),
      })
      .where(eq(schema.subscriptions.stripeSubscriptionId, subscription.id))
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    await this.db
      .update(schema.subscriptions)
      .set({ status: 'canceled', updatedAt: new Date() })
      .where(eq(schema.subscriptions.stripeSubscriptionId, subscription.id))
  }

  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    // Record invoice
    if (invoice.subscription) {
      await this.db.insert(schema.invoices).values({
        id: crypto.randomUUID(),
        stripeInvoiceId: invoice.id,
        subscriptionId: invoice.subscription as string,
        connectedAccountId: (invoice.account as string) || '',
        customerId: invoice.customer as string,
        amount: invoice.amount_paid,
        currency: invoice.currency,
        status: 'paid',
        paidAt: invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : new Date(),
        createdAt: new Date(),
      })
    }
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    if (invoice.subscription) {
      // Mark subscription as past_due
      await this.db
        .update(schema.subscriptions)
        .set({ status: 'past_due', updatedAt: new Date() })
        .where(eq(schema.subscriptions.stripeSubscriptionId, invoice.subscription as string))
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        ns: this.ns,
      })
    }

    // Stripe webhook
    if (url.pathname === '/webhook' && request.method === 'POST') {
      return this.handleWebhook(request)
    }

    return new Response('Not Found', { status: 404 })
  }
}

export default PaymentsDO
