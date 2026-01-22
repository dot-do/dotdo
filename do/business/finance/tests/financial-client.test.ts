/**
 * FinancialClient Tests - TDD for @dotdo/finance
 *
 * Tests the FinancialClient interface contract using a mock implementation.
 * The StripeProvider implementation wraps the real Stripe API, so we test
 * the interface layer separately from integration tests.
 *
 * @module business/finance/tests/financial-client.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type {
  FinancialClient,
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
} from '../types'

// ============================================================================
// MOCK FINANCIAL CLIENT IMPLEMENTATION
// ============================================================================

/**
 * In-memory mock implementation of FinancialClient for testing.
 * This allows us to test the interface contract without Stripe API.
 */
class MockFinancialClient implements FinancialClient {
  private customersStore = new Map<string, Customer>()
  private subscriptionsStore = new Map<string, Subscription>()
  private invoicesStore = new Map<string, Invoice>()
  private paymentsStore = new Map<string, Payment>()
  private webhookHandlers = new Map<WebhookEventType, Set<WebhookHandler>>()
  private idCounter = 0

  private generateId(prefix: string): string {
    return `${prefix}_${++this.idCounter}`
  }

  customers = {
    create: async (input: CreateCustomerInput): Promise<Customer> => {
      const now = new Date()
      const customer: Customer = {
        id: this.generateId('cus'),
        email: input.email,
        name: input.name,
        metadata: input.metadata,
        createdAt: now,
        updatedAt: now,
      }
      this.customersStore.set(customer.id, customer)
      return customer
    },

    get: async (id: string): Promise<Customer | null> => {
      return this.customersStore.get(id) ?? null
    },

    update: async (id: string, input: UpdateCustomerInput): Promise<Customer> => {
      const customer = this.customersStore.get(id)
      if (!customer) {
        throw new Error(`Customer not found: ${id}`)
      }
      const updated: Customer = {
        ...customer,
        email: input.email ?? customer.email,
        name: input.name ?? customer.name,
        metadata: input.metadata ?? customer.metadata,
        updatedAt: new Date(),
      }
      this.customersStore.set(id, updated)
      return updated
    },

    delete: async (id: string): Promise<void> => {
      this.customersStore.delete(id)
    },

    list: async (options?: ListOptions): Promise<PaginatedList<Customer>> => {
      const allCustomers = Array.from(this.customersStore.values())
      const limit = options?.limit ?? 10
      const data = allCustomers.slice(0, limit)
      return {
        data,
        hasMore: allCustomers.length > limit,
      }
    },
  }

  subscriptions = {
    create: async (input: CreateSubscriptionInput): Promise<Subscription> => {
      const now = new Date()
      const periodEnd = new Date(now)
      periodEnd.setMonth(periodEnd.getMonth() + 1)

      const subscription: Subscription = {
        id: this.generateId('sub'),
        customerId: input.customerId,
        status: 'active',
        priceId: input.priceId,
        productId: 'prod_mock',
        quantity: input.quantity ?? 1,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        metadata: input.metadata,
        createdAt: now,
        updatedAt: now,
      }

      if (input.trialPeriodDays) {
        subscription.status = 'trialing'
        subscription.trialStart = now
        subscription.trialEnd = new Date(now.getTime() + input.trialPeriodDays * 24 * 60 * 60 * 1000)
      }

      this.subscriptionsStore.set(subscription.id, subscription)
      return subscription
    },

    get: async (id: string): Promise<Subscription | null> => {
      return this.subscriptionsStore.get(id) ?? null
    },

    update: async (id: string, input: UpdateSubscriptionInput): Promise<Subscription> => {
      const subscription = this.subscriptionsStore.get(id)
      if (!subscription) {
        throw new Error(`Subscription not found: ${id}`)
      }
      const updated: Subscription = {
        ...subscription,
        priceId: input.priceId ?? subscription.priceId,
        quantity: input.quantity ?? subscription.quantity,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? subscription.cancelAtPeriodEnd,
        metadata: input.metadata ?? subscription.metadata,
        updatedAt: new Date(),
      }
      this.subscriptionsStore.set(id, updated)
      return updated
    },

    cancel: async (id: string, cancelAtPeriodEnd = true): Promise<Subscription> => {
      const subscription = this.subscriptionsStore.get(id)
      if (!subscription) {
        throw new Error(`Subscription not found: ${id}`)
      }
      const updated: Subscription = {
        ...subscription,
        cancelAtPeriodEnd,
        canceledAt: new Date(),
        status: cancelAtPeriodEnd ? subscription.status : 'canceled',
        endedAt: cancelAtPeriodEnd ? undefined : new Date(),
        updatedAt: new Date(),
      }
      this.subscriptionsStore.set(id, updated)
      return updated
    },

    list: async (options?: ListOptions & { customerId?: string }): Promise<PaginatedList<Subscription>> => {
      let subs = Array.from(this.subscriptionsStore.values())
      if (options?.customerId) {
        subs = subs.filter(s => s.customerId === options.customerId)
      }
      const limit = options?.limit ?? 10
      const data = subs.slice(0, limit)
      return {
        data,
        hasMore: subs.length > limit,
      }
    },
  }

  invoices = {
    create: async (input: CreateInvoiceInput): Promise<Invoice> => {
      const now = new Date()
      const invoice: Invoice = {
        id: this.generateId('inv'),
        customerId: input.customerId,
        status: 'draft',
        currency: 'usd',
        amountDue: 0,
        amountPaid: 0,
        amountRemaining: 0,
        subtotal: 0,
        total: 0,
        metadata: input.metadata,
        createdAt: now,
      }
      if (input.daysUntilDue) {
        invoice.dueDate = new Date(now.getTime() + input.daysUntilDue * 24 * 60 * 60 * 1000)
      }
      this.invoicesStore.set(invoice.id, invoice)
      return invoice
    },

    get: async (id: string): Promise<Invoice | null> => {
      return this.invoicesStore.get(id) ?? null
    },

    list: async (options?: ListOptions & { customerId?: string; subscriptionId?: string }): Promise<PaginatedList<Invoice>> => {
      let invoices = Array.from(this.invoicesStore.values())
      if (options?.customerId) {
        invoices = invoices.filter(i => i.customerId === options.customerId)
      }
      if (options?.subscriptionId) {
        invoices = invoices.filter(i => i.subscriptionId === options.subscriptionId)
      }
      const limit = options?.limit ?? 10
      const data = invoices.slice(0, limit)
      return {
        data,
        hasMore: invoices.length > limit,
      }
    },

    pay: async (id: string): Promise<Invoice> => {
      const invoice = this.invoicesStore.get(id)
      if (!invoice) {
        throw new Error(`Invoice not found: ${id}`)
      }
      const updated: Invoice = {
        ...invoice,
        status: 'paid',
        amountPaid: invoice.amountDue,
        amountRemaining: 0,
        paidAt: new Date(),
      }
      this.invoicesStore.set(id, updated)
      return updated
    },

    finalize: async (id: string): Promise<Invoice> => {
      const invoice = this.invoicesStore.get(id)
      if (!invoice) {
        throw new Error(`Invoice not found: ${id}`)
      }
      const updated: Invoice = {
        ...invoice,
        status: 'open',
      }
      this.invoicesStore.set(id, updated)
      return updated
    },

    void: async (id: string): Promise<Invoice> => {
      const invoice = this.invoicesStore.get(id)
      if (!invoice) {
        throw new Error(`Invoice not found: ${id}`)
      }
      const updated: Invoice = {
        ...invoice,
        status: 'void',
      }
      this.invoicesStore.set(id, updated)
      return updated
    },
  }

  payments = {
    create: async (input: CreatePaymentInput): Promise<Payment> => {
      const payment: Payment = {
        id: this.generateId('pi'),
        amount: input.amount,
        currency: input.currency,
        customerId: input.customerId,
        paymentMethod: input.paymentMethod,
        status: input.confirm ? 'succeeded' : 'requires_payment_method',
        metadata: input.metadata,
        createdAt: new Date(),
      }
      this.paymentsStore.set(payment.id, payment)
      return payment
    },

    get: async (id: string): Promise<Payment | null> => {
      return this.paymentsStore.get(id) ?? null
    },

    list: async (options?: ListOptions & { customerId?: string }): Promise<PaginatedList<Payment>> => {
      let payments = Array.from(this.paymentsStore.values())
      if (options?.customerId) {
        payments = payments.filter(p => p.customerId === options.customerId)
      }
      const limit = options?.limit ?? 10
      const data = payments.slice(0, limit)
      return {
        data,
        hasMore: payments.length > limit,
      }
    },

    refund: async (id: string, _amount?: number): Promise<Payment> => {
      const payment = this.paymentsStore.get(id)
      if (!payment) {
        throw new Error(`Payment not found: ${id}`)
      }
      const updated: Payment = {
        ...payment,
        status: 'canceled',
      }
      this.paymentsStore.set(id, updated)
      return updated
    },
  }

  metrics = {
    getMRR: async (): Promise<number> => {
      let mrr = 0
      for (const sub of this.subscriptionsStore.values()) {
        if (sub.status === 'active' || sub.status === 'trialing') {
          // Assume $10/month per subscription for mock
          mrr += 1000 * sub.quantity
        }
      }
      return mrr
    },

    getARR: async (): Promise<number> => {
      const mrr = await this.metrics.getMRR()
      return mrr * 12
    },

    getSaaSMetrics: async (): Promise<SaaSMetrics> => {
      const mrr = await this.metrics.getMRR()
      const activeCount = Array.from(this.subscriptionsStore.values()).filter(
        s => s.status === 'active' || s.status === 'trialing'
      ).length
      return {
        mrr,
        arr: mrr * 12,
        activeSubscriptions: activeCount,
        totalCustomers: this.customersStore.size,
        currency: 'usd',
        calculatedAt: new Date(),
      }
    },

    getMRRBreakdown: async (_periodStart: Date, _periodEnd: Date): Promise<MRRBreakdown> => {
      throw new Error('getMRRBreakdown not implemented - requires historical data tracking')
    },
  }

  webhooks = {
    handleWebhook: async (_payload: string, _signature: string): Promise<WebhookEvent> => {
      // Mock webhook handling - just return a mock event
      return {
        id: this.generateId('evt'),
        type: 'customer.created',
        data: {},
        createdAt: new Date(),
        livemode: false,
      }
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

  // Test helper to emit webhook events
  async emitWebhookEvent(event: WebhookEvent): Promise<void> {
    const handlers = this.webhookHandlers.get(event.type)
    if (handlers) {
      for (const handler of handlers) {
        await handler(event)
      }
    }
  }

  // Test helper to check webhook handler count
  getWebhookHandlerCount(eventType: WebhookEventType): number {
    return this.webhookHandlers.get(eventType)?.size ?? 0
  }
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('FinancialClient (do-e71b.6)', () => {
  let client: MockFinancialClient

  beforeEach(() => {
    client = new MockFinancialClient()
  })

  // --------------------------------------------------------------------------
  // Customers API
  // --------------------------------------------------------------------------

  describe('customers', () => {
    it('should create a customer with required fields', async () => {
      const customer = await client.customers.create({
        email: 'alice@example.com',
      })

      expect(customer.id).toMatch(/^cus_/)
      expect(customer.email).toBe('alice@example.com')
      expect(customer.createdAt).toBeInstanceOf(Date)
      expect(customer.updatedAt).toBeInstanceOf(Date)
    })

    it('should create a customer with optional fields', async () => {
      const customer = await client.customers.create({
        email: 'bob@example.com',
        name: 'Bob Smith',
        metadata: { plan: 'premium' },
      })

      expect(customer.email).toBe('bob@example.com')
      expect(customer.name).toBe('Bob Smith')
      expect(customer.metadata).toEqual({ plan: 'premium' })
    })

    it('should get a customer by id', async () => {
      const created = await client.customers.create({
        email: 'charlie@example.com',
      })

      const fetched = await client.customers.get(created.id)

      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(created.id)
      expect(fetched!.email).toBe('charlie@example.com')
    })

    it('should return null for non-existent customer', async () => {
      const result = await client.customers.get('cus_nonexistent')

      expect(result).toBeNull()
    })

    it('should update a customer', async () => {
      const created = await client.customers.create({
        email: 'dave@example.com',
        name: 'Dave',
      })

      const updated = await client.customers.update(created.id, {
        name: 'David',
        metadata: { tier: 'gold' },
      })

      expect(updated.id).toBe(created.id)
      expect(updated.email).toBe('dave@example.com')
      expect(updated.name).toBe('David')
      expect(updated.metadata).toEqual({ tier: 'gold' })
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime())
    })

    it('should throw error when updating non-existent customer', async () => {
      await expect(
        client.customers.update('cus_nonexistent', { name: 'Test' })
      ).rejects.toThrow('Customer not found')
    })

    it('should delete a customer', async () => {
      const created = await client.customers.create({
        email: 'eve@example.com',
      })

      await client.customers.delete(created.id)

      const result = await client.customers.get(created.id)
      expect(result).toBeNull()
    })

    it('should list customers with pagination', async () => {
      // Create multiple customers
      await client.customers.create({ email: 'user1@example.com' })
      await client.customers.create({ email: 'user2@example.com' })
      await client.customers.create({ email: 'user3@example.com' })

      const result = await client.customers.list({ limit: 2 })

      expect(result.data.length).toBe(2)
      expect(result.hasMore).toBe(true)
    })

    it('should list all customers when no limit', async () => {
      await client.customers.create({ email: 'user1@example.com' })
      await client.customers.create({ email: 'user2@example.com' })

      const result = await client.customers.list()

      expect(result.data.length).toBe(2)
      expect(result.hasMore).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // Subscriptions API
  // --------------------------------------------------------------------------

  describe('subscriptions', () => {
    let customerId: string

    beforeEach(async () => {
      const customer = await client.customers.create({ email: 'sub-test@example.com' })
      customerId = customer.id
    })

    it('should create a subscription with required fields', async () => {
      const subscription = await client.subscriptions.create({
        customerId,
        priceId: 'price_monthly',
      })

      expect(subscription.id).toMatch(/^sub_/)
      expect(subscription.customerId).toBe(customerId)
      expect(subscription.priceId).toBe('price_monthly')
      expect(subscription.status).toBe('active')
      expect(subscription.quantity).toBe(1)
      expect(subscription.cancelAtPeriodEnd).toBe(false)
      expect(subscription.currentPeriodStart).toBeInstanceOf(Date)
      expect(subscription.currentPeriodEnd).toBeInstanceOf(Date)
    })

    it('should create a subscription with quantity', async () => {
      const subscription = await client.subscriptions.create({
        customerId,
        priceId: 'price_seat',
        quantity: 5,
      })

      expect(subscription.quantity).toBe(5)
    })

    it('should create a subscription with trial period', async () => {
      const subscription = await client.subscriptions.create({
        customerId,
        priceId: 'price_monthly',
        trialPeriodDays: 14,
      })

      expect(subscription.status).toBe('trialing')
      expect(subscription.trialStart).toBeInstanceOf(Date)
      expect(subscription.trialEnd).toBeInstanceOf(Date)
    })

    it('should create a subscription with metadata', async () => {
      const subscription = await client.subscriptions.create({
        customerId,
        priceId: 'price_monthly',
        metadata: { source: 'api' },
      })

      expect(subscription.metadata).toEqual({ source: 'api' })
    })

    it('should get a subscription by id', async () => {
      const created = await client.subscriptions.create({
        customerId,
        priceId: 'price_monthly',
      })

      const fetched = await client.subscriptions.get(created.id)

      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(created.id)
    })

    it('should return null for non-existent subscription', async () => {
      const result = await client.subscriptions.get('sub_nonexistent')

      expect(result).toBeNull()
    })

    it('should update subscription quantity', async () => {
      const created = await client.subscriptions.create({
        customerId,
        priceId: 'price_seat',
        quantity: 5,
      })

      const updated = await client.subscriptions.update(created.id, {
        quantity: 10,
      })

      expect(updated.quantity).toBe(10)
    })

    it('should update subscription price', async () => {
      const created = await client.subscriptions.create({
        customerId,
        priceId: 'price_basic',
      })

      const updated = await client.subscriptions.update(created.id, {
        priceId: 'price_premium',
      })

      expect(updated.priceId).toBe('price_premium')
    })

    it('should cancel subscription at period end', async () => {
      const created = await client.subscriptions.create({
        customerId,
        priceId: 'price_monthly',
      })

      const canceled = await client.subscriptions.cancel(created.id, true)

      expect(canceled.cancelAtPeriodEnd).toBe(true)
      expect(canceled.canceledAt).toBeInstanceOf(Date)
      expect(canceled.status).toBe('active') // Still active until period end
    })

    it('should cancel subscription immediately', async () => {
      const created = await client.subscriptions.create({
        customerId,
        priceId: 'price_monthly',
      })

      const canceled = await client.subscriptions.cancel(created.id, false)

      expect(canceled.status).toBe('canceled')
      expect(canceled.endedAt).toBeInstanceOf(Date)
    })

    it('should list subscriptions for a customer', async () => {
      await client.subscriptions.create({ customerId, priceId: 'price_a' })
      await client.subscriptions.create({ customerId, priceId: 'price_b' })

      // Create another customer with a subscription
      const otherCustomer = await client.customers.create({ email: 'other@example.com' })
      await client.subscriptions.create({ customerId: otherCustomer.id, priceId: 'price_c' })

      const result = await client.subscriptions.list({ customerId })

      expect(result.data.length).toBe(2)
      expect(result.data.every(s => s.customerId === customerId)).toBe(true)
    })

    it('should throw error when updating non-existent subscription', async () => {
      await expect(
        client.subscriptions.update('sub_nonexistent', { quantity: 10 })
      ).rejects.toThrow('Subscription not found')
    })
  })

  // --------------------------------------------------------------------------
  // Invoices API
  // --------------------------------------------------------------------------

  describe('invoices', () => {
    let customerId: string

    beforeEach(async () => {
      const customer = await client.customers.create({ email: 'invoice-test@example.com' })
      customerId = customer.id
    })

    it('should create an invoice', async () => {
      const invoice = await client.invoices.create({
        customerId,
      })

      expect(invoice.id).toMatch(/^inv_/)
      expect(invoice.customerId).toBe(customerId)
      expect(invoice.status).toBe('draft')
      expect(invoice.currency).toBe('usd')
    })

    it('should create an invoice with due date', async () => {
      const invoice = await client.invoices.create({
        customerId,
        daysUntilDue: 30,
      })

      expect(invoice.dueDate).toBeInstanceOf(Date)
    })

    it('should get an invoice by id', async () => {
      const created = await client.invoices.create({ customerId })

      const fetched = await client.invoices.get(created.id)

      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(created.id)
    })

    it('should return null for non-existent invoice', async () => {
      const result = await client.invoices.get('inv_nonexistent')

      expect(result).toBeNull()
    })

    it('should finalize an invoice', async () => {
      const created = await client.invoices.create({ customerId })

      const finalized = await client.invoices.finalize(created.id)

      expect(finalized.status).toBe('open')
    })

    it('should pay an invoice', async () => {
      const created = await client.invoices.create({ customerId })
      await client.invoices.finalize(created.id)

      const paid = await client.invoices.pay(created.id)

      expect(paid.status).toBe('paid')
      expect(paid.paidAt).toBeInstanceOf(Date)
    })

    it('should void an invoice', async () => {
      const created = await client.invoices.create({ customerId })

      const voided = await client.invoices.void(created.id)

      expect(voided.status).toBe('void')
    })

    it('should list invoices for a customer', async () => {
      await client.invoices.create({ customerId })
      await client.invoices.create({ customerId })

      const result = await client.invoices.list({ customerId })

      expect(result.data.length).toBe(2)
    })

    it('should throw error when paying non-existent invoice', async () => {
      await expect(client.invoices.pay('inv_nonexistent')).rejects.toThrow('Invoice not found')
    })
  })

  // --------------------------------------------------------------------------
  // Payments API
  // --------------------------------------------------------------------------

  describe('payments', () => {
    let customerId: string

    beforeEach(async () => {
      const customer = await client.customers.create({ email: 'payment-test@example.com' })
      customerId = customer.id
    })

    it('should create a payment', async () => {
      const payment = await client.payments.create({
        amount: 1000,
        currency: 'usd',
        customerId,
      })

      expect(payment.id).toMatch(/^pi_/)
      expect(payment.amount).toBe(1000)
      expect(payment.currency).toBe('usd')
      expect(payment.customerId).toBe(customerId)
      expect(payment.status).toBe('requires_payment_method')
    })

    it('should create and confirm a payment', async () => {
      const payment = await client.payments.create({
        amount: 2000,
        currency: 'usd',
        customerId,
        confirm: true,
      })

      expect(payment.status).toBe('succeeded')
    })

    it('should get a payment by id', async () => {
      const created = await client.payments.create({
        amount: 1500,
        currency: 'usd',
      })

      const fetched = await client.payments.get(created.id)

      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(created.id)
    })

    it('should return null for non-existent payment', async () => {
      const result = await client.payments.get('pi_nonexistent')

      expect(result).toBeNull()
    })

    it('should refund a payment', async () => {
      const created = await client.payments.create({
        amount: 1000,
        currency: 'usd',
        confirm: true,
      })

      const refunded = await client.payments.refund(created.id)

      expect(refunded.status).toBe('canceled')
    })

    it('should list payments for a customer', async () => {
      await client.payments.create({ amount: 100, currency: 'usd', customerId })
      await client.payments.create({ amount: 200, currency: 'usd', customerId })

      const result = await client.payments.list({ customerId })

      expect(result.data.length).toBe(2)
    })

    it('should throw error when refunding non-existent payment', async () => {
      await expect(client.payments.refund('pi_nonexistent')).rejects.toThrow('Payment not found')
    })
  })

  // --------------------------------------------------------------------------
  // Metrics API
  // --------------------------------------------------------------------------

  describe('metrics', () => {
    it('should calculate MRR from active subscriptions', async () => {
      const customer = await client.customers.create({ email: 'mrr@example.com' })

      await client.subscriptions.create({
        customerId: customer.id,
        priceId: 'price_monthly',
        quantity: 2,
      })

      const mrr = await client.metrics.getMRR()

      // Mock assumes $10/month per quantity unit = 2000 cents
      expect(mrr).toBe(2000)
    })

    it('should calculate ARR from MRR', async () => {
      const customer = await client.customers.create({ email: 'arr@example.com' })

      await client.subscriptions.create({
        customerId: customer.id,
        priceId: 'price_monthly',
        quantity: 1,
      })

      const arr = await client.metrics.getARR()

      // MRR = 1000, ARR = 12000
      expect(arr).toBe(12000)
    })

    it('should get SaaS metrics', async () => {
      const customer1 = await client.customers.create({ email: 'saas1@example.com' })
      const customer2 = await client.customers.create({ email: 'saas2@example.com' })

      await client.subscriptions.create({
        customerId: customer1.id,
        priceId: 'price_monthly',
      })
      await client.subscriptions.create({
        customerId: customer2.id,
        priceId: 'price_monthly',
        trialPeriodDays: 7,
      })

      const metrics = await client.metrics.getSaaSMetrics()

      expect(metrics.mrr).toBe(2000) // Both count (active + trialing)
      expect(metrics.arr).toBe(24000)
      expect(metrics.activeSubscriptions).toBe(2)
      expect(metrics.totalCustomers).toBe(2)
      expect(metrics.currency).toBe('usd')
      expect(metrics.calculatedAt).toBeInstanceOf(Date)
    })

    it('should throw error for getMRRBreakdown', async () => {
      const start = new Date()
      const end = new Date()

      await expect(client.metrics.getMRRBreakdown(start, end)).rejects.toThrow(
        'getMRRBreakdown not implemented'
      )
    })
  })

  // --------------------------------------------------------------------------
  // Webhooks API
  // --------------------------------------------------------------------------

  describe('webhooks', () => {
    it('should register webhook handler', async () => {
      const handler: WebhookHandler = vi.fn()

      client.webhooks.on('customer.created', handler)

      expect(client.getWebhookHandlerCount('customer.created')).toBe(1)
    })

    it('should unregister webhook handler', async () => {
      const handler: WebhookHandler = vi.fn()

      client.webhooks.on('customer.created', handler)
      client.webhooks.off('customer.created', handler)

      expect(client.getWebhookHandlerCount('customer.created')).toBe(0)
    })

    it('should call handlers when webhook event is emitted', async () => {
      const handler: WebhookHandler = vi.fn()
      client.webhooks.on('customer.created', handler)

      const event: WebhookEvent = {
        id: 'evt_test',
        type: 'customer.created',
        data: { id: 'cus_123' },
        createdAt: new Date(),
        livemode: false,
      }

      await client.emitWebhookEvent(event)

      expect(handler).toHaveBeenCalledWith(event)
    })

    it('should handle multiple handlers for same event type', async () => {
      const handler1: WebhookHandler = vi.fn()
      const handler2: WebhookHandler = vi.fn()

      client.webhooks.on('subscription.created', handler1)
      client.webhooks.on('subscription.created', handler2)

      const event: WebhookEvent = {
        id: 'evt_test',
        type: 'subscription.created',
        data: {},
        createdAt: new Date(),
        livemode: false,
      }

      await client.emitWebhookEvent(event)

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
    })

    it('should return webhook event from handleWebhook', async () => {
      const event = await client.webhooks.handleWebhook('{}', 'sig_test')

      expect(event.id).toMatch(/^evt_/)
      expect(event.type).toBe('customer.created')
      expect(event.livemode).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // Interface Compliance
  // --------------------------------------------------------------------------

  describe('interface compliance', () => {
    it('should have all required customer operations', () => {
      const clientAsInterface: FinancialClient = client

      expect(typeof clientAsInterface.customers.create).toBe('function')
      expect(typeof clientAsInterface.customers.get).toBe('function')
      expect(typeof clientAsInterface.customers.update).toBe('function')
      expect(typeof clientAsInterface.customers.delete).toBe('function')
      expect(typeof clientAsInterface.customers.list).toBe('function')
    })

    it('should have all required subscription operations', () => {
      const clientAsInterface: FinancialClient = client

      expect(typeof clientAsInterface.subscriptions.create).toBe('function')
      expect(typeof clientAsInterface.subscriptions.get).toBe('function')
      expect(typeof clientAsInterface.subscriptions.update).toBe('function')
      expect(typeof clientAsInterface.subscriptions.cancel).toBe('function')
      expect(typeof clientAsInterface.subscriptions.list).toBe('function')
    })

    it('should have all required invoice operations', () => {
      const clientAsInterface: FinancialClient = client

      expect(typeof clientAsInterface.invoices.create).toBe('function')
      expect(typeof clientAsInterface.invoices.get).toBe('function')
      expect(typeof clientAsInterface.invoices.list).toBe('function')
      expect(typeof clientAsInterface.invoices.pay).toBe('function')
      expect(typeof clientAsInterface.invoices.finalize).toBe('function')
      expect(typeof clientAsInterface.invoices.void).toBe('function')
    })

    it('should have all required payment operations', () => {
      const clientAsInterface: FinancialClient = client

      expect(typeof clientAsInterface.payments.create).toBe('function')
      expect(typeof clientAsInterface.payments.get).toBe('function')
      expect(typeof clientAsInterface.payments.list).toBe('function')
      expect(typeof clientAsInterface.payments.refund).toBe('function')
    })

    it('should have all required metrics operations', () => {
      const clientAsInterface: FinancialClient = client

      expect(typeof clientAsInterface.metrics.getMRR).toBe('function')
      expect(typeof clientAsInterface.metrics.getARR).toBe('function')
      expect(typeof clientAsInterface.metrics.getSaaSMetrics).toBe('function')
      expect(typeof clientAsInterface.metrics.getMRRBreakdown).toBe('function')
    })

    it('should have all required webhook operations', () => {
      const clientAsInterface: FinancialClient = client

      expect(typeof clientAsInterface.webhooks.handleWebhook).toBe('function')
      expect(typeof clientAsInterface.webhooks.on).toBe('function')
      expect(typeof clientAsInterface.webhooks.off).toBe('function')
    })
  })
})
