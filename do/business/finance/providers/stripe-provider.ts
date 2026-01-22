/**
 * @dotdo/finance - Stripe provider implementation
 */

import Stripe from 'stripe'
import type {
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput,
  Subscription,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  Invoice,
  CreateInvoiceInput,
  Payment,
  CreatePaymentInput,
  SaaSMetrics,
  MRRBreakdown,
  ListOptions,
  PaginatedList,
  WebhookEvent,
  WebhookEventType,
  WebhookHandler,
  StripeConfig,
  SubscriptionStatus,
} from '../types'
import type { FinancialClient } from '../client'

/**
 * Helper to filter out undefined values from an object
 */
function filterUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {}
  for (const key in obj) {
    if (obj[key] !== undefined) {
      result[key] = obj[key]
    }
  }
  return result
}

/**
 * Stripe implementation of FinancialClient
 */
export class StripeProvider implements FinancialClient {
  private stripe: Stripe
  private webhookSecret: string | undefined
  private webhookHandlers: Map<WebhookEventType, Set<WebhookHandler>> = new Map()

  constructor(config: StripeConfig) {
    this.stripe = new Stripe(config.apiKey)
    this.webhookSecret = config.webhookSecret
  }

  // Customer operations
  customers = {
    create: async (input: CreateCustomerInput): Promise<Customer> => {
      const params = filterUndefined({
        email: input.email,
        name: input.name,
        metadata: input.metadata,
      }) as Stripe.CustomerCreateParams
      const customer = await this.stripe.customers.create(params)
      return this.mapStripeCustomer(customer)
    },

    get: async (id: string): Promise<Customer | null> => {
      try {
        const customer = await this.stripe.customers.retrieve(id)
        if (customer.deleted) return null
        return this.mapStripeCustomer(customer as Stripe.Customer)
      } catch (err) {
        if ((err as Stripe.errors.StripeError).code === 'resource_missing') return null
        throw err
      }
    },

    update: async (id: string, input: UpdateCustomerInput): Promise<Customer> => {
      const params = filterUndefined({
        email: input.email,
        name: input.name,
        metadata: input.metadata,
      }) as Stripe.CustomerUpdateParams
      const customer = await this.stripe.customers.update(id, params)
      return this.mapStripeCustomer(customer)
    },

    delete: async (id: string): Promise<void> => {
      await this.stripe.customers.del(id)
    },

    list: async (options?: ListOptions): Promise<PaginatedList<Customer>> => {
      const params = filterUndefined({
        limit: options?.limit,
        starting_after: options?.startingAfter,
        ending_before: options?.endingBefore,
      }) as Stripe.CustomerListParams
      const result = await this.stripe.customers.list(params)
      return {
        data: result.data.map((c) => this.mapStripeCustomer(c)),
        hasMore: result.has_more,
      }
    },
  }

  // Subscription operations
  subscriptions = {
    create: async (input: CreateSubscriptionInput): Promise<Subscription> => {
      const item: Stripe.SubscriptionCreateParams.Item = { price: input.priceId }
      if (input.quantity !== undefined) {
        item.quantity = input.quantity
      }
      const params = filterUndefined({
        customer: input.customerId,
        items: [item],
        trial_period_days: input.trialPeriodDays,
        metadata: input.metadata,
      }) as Stripe.SubscriptionCreateParams
      const subscription = await this.stripe.subscriptions.create(params)
      return this.mapStripeSubscription(subscription)
    },

    get: async (id: string): Promise<Subscription | null> => {
      try {
        const subscription = await this.stripe.subscriptions.retrieve(id)
        return this.mapStripeSubscription(subscription)
      } catch (err) {
        if ((err as Stripe.errors.StripeError).code === 'resource_missing') return null
        throw err
      }
    },

    update: async (id: string, input: UpdateSubscriptionInput): Promise<Subscription> => {
      const updateParams: Stripe.SubscriptionUpdateParams = {}

      if (input.cancelAtPeriodEnd !== undefined) {
        updateParams.cancel_at_period_end = input.cancelAtPeriodEnd
      }
      if (input.metadata !== undefined) {
        updateParams.metadata = input.metadata
      }

      if (input.priceId !== undefined || input.quantity !== undefined) {
        const current = await this.stripe.subscriptions.retrieve(id)
        const firstItem = current.items.data[0]
        if (firstItem) {
          const itemUpdate: Stripe.SubscriptionUpdateParams.Item = {
            id: firstItem.id,
          }
          if (input.priceId !== undefined) {
            itemUpdate.price = input.priceId
          }
          if (input.quantity !== undefined) {
            itemUpdate.quantity = input.quantity
          }
          updateParams.items = [itemUpdate]
        }
      }
      const subscription = await this.stripe.subscriptions.update(id, updateParams)
      return this.mapStripeSubscription(subscription)
    },

    cancel: async (id: string, cancelAtPeriodEnd = true): Promise<Subscription> => {
      let subscription: Stripe.Subscription
      if (cancelAtPeriodEnd) {
        subscription = await this.stripe.subscriptions.update(id, {
          cancel_at_period_end: true,
        })
      } else {
        subscription = await this.stripe.subscriptions.cancel(id)
      }
      return this.mapStripeSubscription(subscription)
    },

    list: async (options?: ListOptions & { customerId?: string }): Promise<PaginatedList<Subscription>> => {
      const params = filterUndefined({
        customer: options?.customerId,
        limit: options?.limit,
        starting_after: options?.startingAfter,
        ending_before: options?.endingBefore,
      }) as Stripe.SubscriptionListParams
      const result = await this.stripe.subscriptions.list(params)
      return {
        data: result.data.map((s) => this.mapStripeSubscription(s)),
        hasMore: result.has_more,
      }
    },
  }

  // Invoice operations
  invoices = {
    create: async (input: CreateInvoiceInput): Promise<Invoice> => {
      const params = filterUndefined({
        customer: input.customerId,
        auto_advance: input.autoAdvance,
        collection_method: input.collectionMethod,
        days_until_due: input.daysUntilDue,
        metadata: input.metadata,
      }) as Stripe.InvoiceCreateParams
      const invoice = await this.stripe.invoices.create(params)
      return this.mapStripeInvoice(invoice)
    },

    get: async (id: string): Promise<Invoice | null> => {
      try {
        const invoice = await this.stripe.invoices.retrieve(id)
        return this.mapStripeInvoice(invoice)
      } catch (err) {
        if ((err as Stripe.errors.StripeError).code === 'resource_missing') return null
        throw err
      }
    },

    list: async (options?: ListOptions & { customerId?: string; subscriptionId?: string }): Promise<PaginatedList<Invoice>> => {
      const params = filterUndefined({
        customer: options?.customerId,
        subscription: options?.subscriptionId,
        limit: options?.limit,
        starting_after: options?.startingAfter,
        ending_before: options?.endingBefore,
      }) as Stripe.InvoiceListParams
      const result = await this.stripe.invoices.list(params)
      return {
        data: result.data.map((i) => this.mapStripeInvoice(i)),
        hasMore: result.has_more,
      }
    },

    pay: async (id: string): Promise<Invoice> => {
      const invoice = await this.stripe.invoices.pay(id)
      return this.mapStripeInvoice(invoice)
    },

    finalize: async (id: string): Promise<Invoice> => {
      const invoice = await this.stripe.invoices.finalizeInvoice(id)
      return this.mapStripeInvoice(invoice)
    },

    void: async (id: string): Promise<Invoice> => {
      const invoice = await this.stripe.invoices.voidInvoice(id)
      return this.mapStripeInvoice(invoice)
    },
  }

  // Payment operations
  payments = {
    create: async (input: CreatePaymentInput): Promise<Payment> => {
      const params = filterUndefined({
        amount: input.amount,
        currency: input.currency,
        customer: input.customerId,
        payment_method: input.paymentMethod,
        confirm: input.confirm,
        metadata: input.metadata,
      }) as Stripe.PaymentIntentCreateParams
      const paymentIntent = await this.stripe.paymentIntents.create(params)
      return this.mapStripePaymentIntent(paymentIntent)
    },

    get: async (id: string): Promise<Payment | null> => {
      try {
        const paymentIntent = await this.stripe.paymentIntents.retrieve(id)
        return this.mapStripePaymentIntent(paymentIntent)
      } catch (err) {
        if ((err as Stripe.errors.StripeError).code === 'resource_missing') return null
        throw err
      }
    },

    list: async (options?: ListOptions & { customerId?: string }): Promise<PaginatedList<Payment>> => {
      const params = filterUndefined({
        customer: options?.customerId,
        limit: options?.limit,
        starting_after: options?.startingAfter,
        ending_before: options?.endingBefore,
      }) as Stripe.PaymentIntentListParams
      const result = await this.stripe.paymentIntents.list(params)
      return {
        data: result.data.map((p) => this.mapStripePaymentIntent(p)),
        hasMore: result.has_more,
      }
    },

    refund: async (id: string, amount?: number): Promise<Payment> => {
      const params = filterUndefined({
        payment_intent: id,
        amount,
      }) as Stripe.RefundCreateParams
      await this.stripe.refunds.create(params)
      const paymentIntent = await this.stripe.paymentIntents.retrieve(id)
      return this.mapStripePaymentIntent(paymentIntent)
    },
  }

  // SaaS metrics
  metrics = {
    getMRR: async (): Promise<number> => {
      // Calculate MRR from active subscriptions
      let mrr = 0
      let hasMore = true
      let startingAfter: string | undefined

      while (hasMore) {
        const params: Stripe.SubscriptionListParams = {
          status: 'active',
          limit: 100,
        }
        if (startingAfter) {
          params.starting_after = startingAfter
        }
        const result = await this.stripe.subscriptions.list(params)

        for (const sub of result.data) {
          const firstItem = sub.items.data[0]
          if (firstItem?.price) {
            const price = firstItem.price
            const quantity = firstItem.quantity ?? 1
            const unitAmount = price.unit_amount ?? 0

            // Normalize to monthly
            if (price.recurring?.interval === 'month') {
              mrr += unitAmount * quantity
            } else if (price.recurring?.interval === 'year') {
              mrr += Math.round((unitAmount * quantity) / 12)
            } else if (price.recurring?.interval === 'week') {
              mrr += Math.round((unitAmount * quantity * 52) / 12)
            } else if (price.recurring?.interval === 'day') {
              mrr += Math.round((unitAmount * quantity * 365) / 12)
            }
          }
        }

        hasMore = result.has_more
        const lastItem = result.data[result.data.length - 1]
        startingAfter = lastItem?.id
      }

      return mrr
    },

    getARR: async (): Promise<number> => {
      const mrr = await this.metrics.getMRR()
      return mrr * 12
    },

    getSaaSMetrics: async (): Promise<SaaSMetrics> => {
      const mrr = await this.metrics.getMRR()

      // Count active subscriptions
      const subsResult = await this.stripe.subscriptions.list({
        status: 'active',
        limit: 1,
      })

      // Count total customers
      const customersResult = await this.stripe.customers.list({
        limit: 1,
      })

      return {
        mrr,
        arr: mrr * 12,
        activeSubscriptions: subsResult.data.length > 0 ? (await this.countActiveSubscriptions()) : 0,
        totalCustomers: customersResult.data.length > 0 ? (await this.countCustomers()) : 0,
        currency: 'usd',
        calculatedAt: new Date(),
      }
    },

    getMRRBreakdown: async (_periodStart: Date, _periodEnd: Date): Promise<MRRBreakdown> => {
      // This would require tracking historical subscription data
      // For now, return a stub
      throw new Error('getMRRBreakdown not implemented - requires historical data tracking')
    },
  }

  // Webhook handling
  webhooks = {
    handleWebhook: async (payload: string, signature: string): Promise<WebhookEvent> => {
      if (!this.webhookSecret) {
        throw new Error('Webhook secret not configured')
      }

      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.webhookSecret
      )

      const webhookEvent = this.mapStripeEvent(event)

      // Call registered handlers
      const eventType = webhookEvent.type as WebhookEventType
      const handlers = this.webhookHandlers.get(eventType)
      if (handlers) {
        for (const handler of handlers) {
          await handler(webhookEvent)
        }
      }

      return webhookEvent
    },

    on: (eventType: WebhookEventType, handler: WebhookHandler): void => {
      if (!this.webhookHandlers.has(eventType)) {
        this.webhookHandlers.set(eventType, new Set())
      }
      this.webhookHandlers.get(eventType)!.add(handler)
    },

    off: (eventType: WebhookEventType, handler: WebhookHandler): void => {
      const handlers = this.webhookHandlers.get(eventType)
      if (handlers) {
        handlers.delete(handler)
      }
    },
  }

  // Helper methods for counting (avoiding Stripe's expensive count API)
  private async countActiveSubscriptions(): Promise<number> {
    let count = 0
    let hasMore = true
    let startingAfter: string | undefined

    while (hasMore) {
      const params: Stripe.SubscriptionListParams = {
        status: 'active',
        limit: 100,
      }
      if (startingAfter) {
        params.starting_after = startingAfter
      }
      const result = await this.stripe.subscriptions.list(params)
      count += result.data.length
      hasMore = result.has_more
      const lastItem = result.data[result.data.length - 1]
      startingAfter = lastItem?.id
    }

    return count
  }

  private async countCustomers(): Promise<number> {
    let count = 0
    let hasMore = true
    let startingAfter: string | undefined

    while (hasMore) {
      const params: Stripe.CustomerListParams = {
        limit: 100,
      }
      if (startingAfter) {
        params.starting_after = startingAfter
      }
      const result = await this.stripe.customers.list(params)
      count += result.data.length
      hasMore = result.has_more
      const lastItem = result.data[result.data.length - 1]
      startingAfter = lastItem?.id
    }

    return count
  }

  // Mapping functions
  private mapStripeCustomer(customer: Stripe.Customer): Customer {
    const result: Customer = {
      id: customer.id,
      email: customer.email ?? '',
      createdAt: new Date(customer.created * 1000),
      updatedAt: new Date(customer.created * 1000), // Stripe doesn't track updated_at
    }
    if (customer.name != null) {
      result.name = customer.name
    }
    if (customer.metadata && Object.keys(customer.metadata).length > 0) {
      result.metadata = customer.metadata as Record<string, string>
    }
    return result
  }

  private mapStripeSubscription(subscription: Stripe.Subscription): Subscription {
    const firstItem = subscription.items.data[0]
    const result: Subscription = {
      id: subscription.id,
      customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
      status: subscription.status as SubscriptionStatus,
      priceId: firstItem?.price.id ?? '',
      productId: typeof firstItem?.price.product === 'string' ? firstItem.price.product : firstItem?.price.product?.id ?? '',
      quantity: firstItem?.quantity ?? 1,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      createdAt: new Date(subscription.created * 1000),
      updatedAt: new Date(subscription.created * 1000),
    }
    if (subscription.canceled_at != null) {
      result.canceledAt = new Date(subscription.canceled_at * 1000)
    }
    if (subscription.ended_at != null) {
      result.endedAt = new Date(subscription.ended_at * 1000)
    }
    if (subscription.trial_start != null) {
      result.trialStart = new Date(subscription.trial_start * 1000)
    }
    if (subscription.trial_end != null) {
      result.trialEnd = new Date(subscription.trial_end * 1000)
    }
    if (subscription.metadata && Object.keys(subscription.metadata).length > 0) {
      result.metadata = subscription.metadata as Record<string, string>
    }
    return result
  }

  private mapStripeInvoice(invoice: Stripe.Invoice): Invoice {
    const result: Invoice = {
      id: invoice.id ?? '',
      customerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? '',
      status: (invoice.status ?? 'draft') as Invoice['status'],
      currency: invoice.currency,
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      amountRemaining: invoice.amount_remaining,
      subtotal: invoice.subtotal,
      total: invoice.total,
      createdAt: new Date(invoice.created * 1000),
    }
    const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
    if (subscriptionId != null) {
      result.subscriptionId = subscriptionId
    }
    if (invoice.tax != null) {
      result.tax = invoice.tax
    }
    if (invoice.hosted_invoice_url != null) {
      result.hostedInvoiceUrl = invoice.hosted_invoice_url
    }
    if (invoice.invoice_pdf != null) {
      result.invoicePdf = invoice.invoice_pdf
    }
    if (invoice.due_date != null) {
      result.dueDate = new Date(invoice.due_date * 1000)
    }
    if (invoice.status_transitions?.paid_at != null) {
      result.paidAt = new Date(invoice.status_transitions.paid_at * 1000)
    }
    if (invoice.period_start != null) {
      result.periodStart = new Date(invoice.period_start * 1000)
    }
    if (invoice.period_end != null) {
      result.periodEnd = new Date(invoice.period_end * 1000)
    }
    if (invoice.metadata && Object.keys(invoice.metadata).length > 0) {
      result.metadata = invoice.metadata as Record<string, string>
    }
    return result
  }

  private mapStripePaymentIntent(paymentIntent: Stripe.PaymentIntent): Payment {
    const result: Payment = {
      id: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: this.mapPaymentIntentStatus(paymentIntent.status),
      createdAt: new Date(paymentIntent.created * 1000),
    }
    const customerId = typeof paymentIntent.customer === 'string' ? paymentIntent.customer : paymentIntent.customer?.id
    if (customerId != null) {
      result.customerId = customerId
    }
    const invoiceId = typeof paymentIntent.invoice === 'string' ? paymentIntent.invoice : paymentIntent.invoice?.id
    if (invoiceId != null) {
      result.invoiceId = invoiceId
    }
    const paymentMethod = typeof paymentIntent.payment_method === 'string' ? paymentIntent.payment_method : paymentIntent.payment_method?.id
    if (paymentMethod != null) {
      result.paymentMethod = paymentMethod
    }
    if (paymentIntent.latest_charge && typeof paymentIntent.latest_charge !== 'string' && paymentIntent.latest_charge.receipt_url != null) {
      result.receiptUrl = paymentIntent.latest_charge.receipt_url
    }
    if (paymentIntent.last_payment_error?.message != null) {
      result.failureMessage = paymentIntent.last_payment_error.message
    }
    if (paymentIntent.metadata && Object.keys(paymentIntent.metadata).length > 0) {
      result.metadata = paymentIntent.metadata as Record<string, string>
    }
    return result
  }

  private mapPaymentIntentStatus(status: Stripe.PaymentIntent.Status): Payment['status'] {
    switch (status) {
      case 'succeeded':
        return 'succeeded'
      case 'processing':
        return 'pending'
      case 'canceled':
        return 'canceled'
      case 'requires_action':
        return 'requires_action'
      case 'requires_payment_method':
        return 'requires_payment_method'
      default:
        return 'pending'
    }
  }

  private mapStripeEvent(event: Stripe.Event): WebhookEvent {
    return {
      id: event.id,
      type: this.mapStripeEventType(event.type),
      data: event.data.object,
      createdAt: new Date(event.created * 1000),
      livemode: event.livemode,
    }
  }

  private mapStripeEventType(type: string): WebhookEventType {
    // Map Stripe event types to our webhook event types
    const mapping: Record<string, WebhookEventType> = {
      'customer.created': 'customer.created',
      'customer.updated': 'customer.updated',
      'customer.deleted': 'customer.deleted',
      'customer.subscription.created': 'subscription.created',
      'customer.subscription.updated': 'subscription.updated',
      'customer.subscription.deleted': 'subscription.deleted',
      'customer.subscription.trial_will_end': 'subscription.trial_will_end',
      'invoice.created': 'invoice.created',
      'invoice.paid': 'invoice.paid',
      'invoice.payment_failed': 'invoice.payment_failed',
      'invoice.finalized': 'invoice.finalized',
      'payment_intent.succeeded': 'payment.succeeded',
      'payment_intent.payment_failed': 'payment.failed',
      'charge.refunded': 'payment.refunded',
    }
    return mapping[type] ?? ('customer.updated' as WebhookEventType)
  }
}
