/**
 * StripeLocal Comprehensive Tests
 *
 * Tests for the local Stripe implementation demonstrating:
 * - Customers (TemporalStore - time-travel queries)
 * - Products/Prices (CRUD operations)
 * - Subscriptions (WindowManager - billing cycles)
 * - PaymentIntents (ExactlyOnceContext - idempotent operations)
 * - Webhooks (signature verification and event delivery)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { StripeLocal } from '../local'
import type { Customer, PaymentIntent, Subscription, WebhookEvent } from '../types'

describe('StripeLocal - Local Stripe Implementation', () => {
  let stripe: StripeLocal
  const webhookEvents: WebhookEvent[] = []

  beforeEach(() => {
    webhookEvents.length = 0
    stripe = new StripeLocal({
      webhooks: true,
      onWebhookEvent: (event) => {
        webhookEvents.push(event)
      },
    })
  })

  afterEach(() => {
    stripe.dispose()
  })

  // ===========================================================================
  // Initialization Tests
  // ===========================================================================

  describe('initialization', () => {
    it('should create a StripeLocal instance', () => {
      expect(stripe).toBeDefined()
      expect(stripe.customers).toBeDefined()
      expect(stripe.products).toBeDefined()
      expect(stripe.prices).toBeDefined()
      expect(stripe.subscriptions).toBeDefined()
      expect(stripe.paymentIntents).toBeDefined()
      expect(stripe.charges).toBeDefined()
      expect(stripe.refunds).toBeDefined()
      expect(stripe.webhookEndpoints).toBeDefined()
    })

    it('should have static webhooks utility', () => {
      expect(StripeLocal.webhooks).toBeDefined()
      expect(StripeLocal.webhooks.constructEvent).toBeDefined()
      expect(StripeLocal.webhooks.verifySignature).toBeDefined()
      expect(StripeLocal.webhooks.generateTestHeaderString).toBeDefined()
    })
  })

  // ===========================================================================
  // Customers Tests (TemporalStore - time-travel queries)
  // ===========================================================================

  describe('customers', () => {
    describe('CRUD operations', () => {
      it('should create a customer', async () => {
        const customer = await stripe.customers.create({
          email: 'test@example.com',
          name: 'Test User',
        })

        expect(customer.id).toMatch(/^cus_/)
        expect(customer.email).toBe('test@example.com')
        expect(customer.name).toBe('Test User')
        expect(customer.object).toBe('customer')
      })

      it('should retrieve a customer', async () => {
        const created = await stripe.customers.create({
          email: 'test@example.com',
        })

        const retrieved = await stripe.customers.retrieve(created.id)

        expect(retrieved.id).toBe(created.id)
        expect(retrieved.email).toBe('test@example.com')
      })

      it('should update a customer', async () => {
        const customer = await stripe.customers.create({
          email: 'test@example.com',
        })

        const updated = await stripe.customers.update(customer.id, {
          name: 'Updated Name',
          metadata: { plan: 'enterprise' },
        })

        expect(updated.name).toBe('Updated Name')
        expect(updated.metadata?.plan).toBe('enterprise')
      })

      it('should delete a customer', async () => {
        const customer = await stripe.customers.create({
          email: 'test@example.com',
        })

        const deleted = await stripe.customers.del(customer.id)

        expect(deleted.deleted).toBe(true)
        expect(deleted.id).toBe(customer.id)

        await expect(stripe.customers.retrieve(customer.id)).rejects.toThrow()
      })
    })

    describe('list and search', () => {
      it('should list customers', async () => {
        await stripe.customers.create({ email: 'user1@example.com' })
        await stripe.customers.create({ email: 'user2@example.com' })
        await stripe.customers.create({ email: 'user3@example.com' })

        const result = await stripe.customers.list({ limit: 10 })

        expect(result.data).toHaveLength(3)
        expect(result.object).toBe('list')
      })

      it('should filter by email', async () => {
        await stripe.customers.create({ email: 'user1@example.com' })
        await stripe.customers.create({ email: 'user2@example.com' })
        await stripe.customers.create({ email: 'specific@example.com' })

        const result = await stripe.customers.list({ email: 'specific@example.com' })

        expect(result.data).toHaveLength(1)
        expect(result.data[0].email).toBe('specific@example.com')
      })

      it('should search customers', async () => {
        await stripe.customers.create({ email: 'searchable@example.com', name: 'Searchable User' })
        await stripe.customers.create({ email: 'other@example.com', name: 'Other User' })

        const result = await stripe.customers.search({ query: 'email:"searchable@example.com"' })

        expect(result.data).toHaveLength(1)
        expect(result.data[0].email).toBe('searchable@example.com')
      })

      it('should support pagination', async () => {
        const customers = await Promise.all([
          stripe.customers.create({ email: 'user1@example.com' }),
          stripe.customers.create({ email: 'user2@example.com' }),
          stripe.customers.create({ email: 'user3@example.com' }),
        ])

        const page1 = await stripe.customers.list({ limit: 2 })
        expect(page1.data).toHaveLength(2)
        expect(page1.has_more).toBe(true)

        const page2 = await stripe.customers.list({
          limit: 2,
          starting_after: page1.data[1].id,
        })
        expect(page2.data).toHaveLength(1)
        expect(page2.has_more).toBe(false)
      })
    })

    describe('time-travel queries (TemporalStore)', () => {
      it('should retrieve customer state at a point in time', async () => {
        const customer = await stripe.customers.create({
          email: 'test@example.com',
          name: 'Original Name',
        })

        const timestampBefore = Date.now()

        // Wait a bit and update
        await new Promise((r) => setTimeout(r, 10))
        await stripe.customers.update(customer.id, { name: 'Updated Name' })

        // Query at the original timestamp
        const originalState = await stripe.customers.retrieveAsOf(customer.id, timestampBefore)

        expect(originalState?.name).toBe('Original Name')

        // Current state should be updated
        const currentState = await stripe.customers.retrieve(customer.id)
        expect(currentState.name).toBe('Updated Name')
      })
    })

    describe('webhook events', () => {
      it('should emit customer.created event', async () => {
        await stripe.customers.create({ email: 'test@example.com' })

        // Give async delivery a moment
        await new Promise((r) => setTimeout(r, 10))

        expect(webhookEvents.length).toBeGreaterThan(0)
        const createEvent = webhookEvents.find((e) => e.type === 'customer.created')
        expect(createEvent).toBeDefined()
      })
    })
  })

  // ===========================================================================
  // Products & Prices Tests
  // ===========================================================================

  describe('products', () => {
    it('should create a product', async () => {
      const product = await stripe.products.create({
        name: 'Test Product',
        description: 'A test product',
      })

      expect(product.id).toMatch(/^prod_/)
      expect(product.name).toBe('Test Product')
      expect(product.active).toBe(true)
    })

    it('should update a product', async () => {
      const product = await stripe.products.create({ name: 'Original Name' })

      const updated = await stripe.products.update(product.id, {
        name: 'Updated Name',
        description: 'New description',
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.description).toBe('New description')
    })

    it('should list products', async () => {
      await stripe.products.create({ name: 'Product 1' })
      await stripe.products.create({ name: 'Product 2' })

      const result = await stripe.products.list()

      expect(result.data.length).toBeGreaterThanOrEqual(2)
    })

    it('should delete a product', async () => {
      const product = await stripe.products.create({ name: 'To Delete' })

      const deleted = await stripe.products.del(product.id)

      expect(deleted.deleted).toBe(true)
    })
  })

  describe('prices', () => {
    it('should create a price with existing product', async () => {
      const product = await stripe.products.create({ name: 'Test Product' })

      const price = await stripe.prices.create({
        currency: 'usd',
        product: product.id,
        unit_amount: 1000,
        recurring: {
          interval: 'month',
        },
      })

      expect(price.id).toMatch(/^price_/)
      expect(price.unit_amount).toBe(1000)
      expect(price.currency).toBe('usd')
      expect(price.type).toBe('recurring')
      expect(price.recurring?.interval).toBe('month')
    })

    it('should create a price with inline product', async () => {
      const price = await stripe.prices.create({
        currency: 'usd',
        unit_amount: 2000,
        product_data: {
          name: 'Inline Product',
        },
      })

      expect(price.id).toMatch(/^price_/)
      expect(price.product).toMatch(/^prod_/)
    })

    it('should support lookup keys', async () => {
      const product = await stripe.products.create({ name: 'Test Product' })

      await stripe.prices.create({
        currency: 'usd',
        product: product.id,
        unit_amount: 1000,
        lookup_key: 'standard-monthly',
      })

      const found = await stripe.prices.retrieveByLookupKey('standard-monthly')

      expect(found).toBeDefined()
      expect(found?.lookup_key).toBe('standard-monthly')
    })
  })

  // ===========================================================================
  // Subscriptions Tests (WindowManager - billing cycles)
  // ===========================================================================

  describe('subscriptions', () => {
    let customer: Customer
    let priceId: string

    beforeEach(async () => {
      customer = await stripe.customers.create({ email: 'subscriber@example.com' })
      const product = await stripe.products.create({ name: 'Subscription Product' })
      const price = await stripe.prices.create({
        currency: 'usd',
        product: product.id,
        unit_amount: 1999,
        recurring: { interval: 'month' },
      })
      priceId = price.id
    })

    describe('lifecycle', () => {
      it('should create a subscription', async () => {
        const subscription = await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: priceId }],
        })

        expect(subscription.id).toMatch(/^sub_/)
        expect(subscription.status).toBe('active')
        expect(subscription.customer).toBe(customer.id)
        expect(subscription.items.data).toHaveLength(1)
      })

      it('should create a subscription with trial', async () => {
        const subscription = await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: priceId }],
          trial_period_days: 14,
        })

        expect(subscription.status).toBe('trialing')
        expect(subscription.trial_end).toBeDefined()
        expect(subscription.trial_end! > subscription.created).toBe(true)
      })

      it('should update a subscription', async () => {
        const subscription = await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: priceId }],
        })

        const updated = await stripe.subscriptions.update(subscription.id, {
          metadata: { plan_tier: 'premium' },
        })

        expect(updated.metadata?.plan_tier).toBe('premium')
      })

      it('should cancel a subscription', async () => {
        const subscription = await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: priceId }],
        })

        const canceled = await stripe.subscriptions.cancel(subscription.id)

        expect(canceled.status).toBe('canceled')
        expect(canceled.canceled_at).toBeDefined()
      })

      it('should cancel at period end', async () => {
        const subscription = await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: priceId }],
        })

        const updated = await stripe.subscriptions.update(subscription.id, {
          cancel_at_period_end: true,
        })

        expect(updated.cancel_at_period_end).toBe(true)
        expect(updated.status).toBe('active') // Still active until period end
      })
    })

    describe('list and search', () => {
      it('should list subscriptions', async () => {
        await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: priceId }],
        })

        const result = await stripe.subscriptions.list()

        expect(result.data.length).toBeGreaterThanOrEqual(1)
      })

      it('should filter by customer', async () => {
        await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: priceId }],
        })

        const result = await stripe.subscriptions.list({ customer: customer.id })

        expect(result.data.every((s) => s.customer === customer.id)).toBe(true)
      })

      it('should filter by status', async () => {
        await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: priceId }],
        })

        const result = await stripe.subscriptions.list({ status: 'active' })

        expect(result.data.every((s) => s.status === 'active')).toBe(true)
      })
    })

    describe('billing cycles (WindowManager)', () => {
      it('should track billing cycle anchor', async () => {
        const subscription = await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: priceId }],
        })

        expect(subscription.billing_cycle_anchor).toBeDefined()
        expect(subscription.current_period_start).toBeDefined()
        expect(subscription.current_period_end).toBeDefined()
        expect(subscription.current_period_end > subscription.current_period_start).toBe(true)
      })

      it('should emit events on billing advancement', async () => {
        webhookEvents.length = 0

        const subscription = await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: priceId }],
        })

        // Give events time to process
        await new Promise((r) => setTimeout(r, 10))

        const createEvent = webhookEvents.find((e) => e.type === 'customer.subscription.created')
        expect(createEvent).toBeDefined()
      })
    })
  })

  // ===========================================================================
  // PaymentIntents Tests (ExactlyOnceContext - idempotent operations)
  // ===========================================================================

  describe('paymentIntents', () => {
    describe('CRUD operations', () => {
      it('should create a payment intent', async () => {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: 2000,
          currency: 'usd',
        })

        expect(paymentIntent.id).toMatch(/^pi_/)
        expect(paymentIntent.amount).toBe(2000)
        expect(paymentIntent.currency).toBe('usd')
        expect(paymentIntent.status).toBe('requires_payment_method')
        expect(paymentIntent.client_secret).toMatch(/^pi_.*_secret_/)
      })

      it('should create with customer', async () => {
        const customer = await stripe.customers.create({ email: 'test@example.com' })

        const paymentIntent = await stripe.paymentIntents.create({
          amount: 2000,
          currency: 'usd',
          customer: customer.id,
        })

        expect(paymentIntent.customer).toBe(customer.id)
      })

      it('should update a payment intent', async () => {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: 2000,
          currency: 'usd',
        })

        const updated = await stripe.paymentIntents.update(paymentIntent.id, {
          amount: 3000,
          metadata: { order_id: '12345' },
        })

        expect(updated.amount).toBe(3000)
        expect(updated.metadata?.order_id).toBe('12345')
      })
    })

    describe('payment flow', () => {
      it('should confirm a payment intent', async () => {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: 2000,
          currency: 'usd',
          payment_method: 'pm_card_visa',
        })

        const confirmed = await stripe.paymentIntents.confirm(paymentIntent.id)

        expect(confirmed.status).toBe('succeeded')
        expect(confirmed.amount_received).toBe(2000)
      })

      it('should support manual capture', async () => {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: 2000,
          currency: 'usd',
          payment_method: 'pm_card_visa',
          capture_method: 'manual',
        })

        const confirmed = await stripe.paymentIntents.confirm(paymentIntent.id)
        expect(confirmed.status).toBe('requires_capture')
        expect(confirmed.amount_capturable).toBe(2000)

        const captured = await stripe.paymentIntents.capture(paymentIntent.id)
        expect(captured.status).toBe('succeeded')
        expect(captured.amount_received).toBe(2000)
      })

      it('should support partial capture', async () => {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: 2000,
          currency: 'usd',
          payment_method: 'pm_card_visa',
          capture_method: 'manual',
        })

        await stripe.paymentIntents.confirm(paymentIntent.id)
        const captured = await stripe.paymentIntents.capture(paymentIntent.id, {
          amount_to_capture: 1500,
        })

        expect(captured.amount_received).toBe(1500)
      })

      it('should cancel a payment intent', async () => {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: 2000,
          currency: 'usd',
        })

        const canceled = await stripe.paymentIntents.cancel(paymentIntent.id, {
          cancellation_reason: 'requested_by_customer',
        })

        expect(canceled.status).toBe('canceled')
        expect(canceled.cancellation_reason).toBe('requested_by_customer')
      })
    })

    describe('idempotency (ExactlyOnceContext)', () => {
      it('should support idempotent creation', async () => {
        const idempotencyKey = 'unique-key-' + Date.now()

        const first = await stripe.paymentIntents.create(
          { amount: 2000, currency: 'usd' },
          { idempotencyKey }
        )

        const second = await stripe.paymentIntents.create(
          { amount: 2000, currency: 'usd' },
          { idempotencyKey }
        )

        expect(first.id).toBe(second.id)
      })

      it('should support idempotent confirmation', async () => {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: 2000,
          currency: 'usd',
          payment_method: 'pm_card_visa',
        })

        const idempotencyKey = 'confirm-' + paymentIntent.id

        const first = await stripe.paymentIntents.confirm(
          paymentIntent.id,
          {},
          { idempotencyKey }
        )

        const second = await stripe.paymentIntents.confirm(
          paymentIntent.id,
          {},
          { idempotencyKey }
        )

        expect(first.status).toBe('succeeded')
        expect(second.status).toBe('succeeded')
        // Both calls return the same result due to idempotency
      })

      it('should support idempotent capture', async () => {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: 2000,
          currency: 'usd',
          payment_method: 'pm_card_visa',
          capture_method: 'manual',
        })

        await stripe.paymentIntents.confirm(paymentIntent.id)

        const idempotencyKey = 'capture-' + paymentIntent.id

        const first = await stripe.paymentIntents.capture(
          paymentIntent.id,
          {},
          { idempotencyKey }
        )

        const second = await stripe.paymentIntents.capture(
          paymentIntent.id,
          {},
          { idempotencyKey }
        )

        expect(first.status).toBe('succeeded')
        // Second call returns cached result
      })
    })

    describe('list and search', () => {
      it('should list payment intents', async () => {
        await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' })
        await stripe.paymentIntents.create({ amount: 2000, currency: 'usd' })

        const result = await stripe.paymentIntents.list()

        expect(result.data.length).toBeGreaterThanOrEqual(2)
      })

      it('should filter by customer', async () => {
        const customer = await stripe.customers.create({ email: 'test@example.com' })

        await stripe.paymentIntents.create({ amount: 1000, currency: 'usd', customer: customer.id })
        await stripe.paymentIntents.create({ amount: 2000, currency: 'usd' })

        const result = await stripe.paymentIntents.list({ customer: customer.id })

        expect(result.data.every((pi) => pi.customer === customer.id)).toBe(true)
      })

      it('should search payment intents', async () => {
        const customer = await stripe.customers.create({ email: 'test@example.com' })

        await stripe.paymentIntents.create({ amount: 1000, currency: 'usd', customer: customer.id })

        const result = await stripe.paymentIntents.search({
          query: `customer:"${customer.id}"`,
        })

        expect(result.data.every((pi) => pi.customer === customer.id)).toBe(true)
      })
    })
  })

  // ===========================================================================
  // Charges Tests (Legacy API)
  // ===========================================================================

  describe('charges', () => {
    it('should create a charge', async () => {
      const charge = await stripe.charges.create({
        amount: 2000,
        currency: 'usd',
        source: 'tok_visa',
      })

      expect(charge.id).toMatch(/^ch_/)
      expect(charge.amount).toBe(2000)
      expect(charge.paid).toBe(true)
      expect(charge.status).toBe('succeeded')
    })

    it('should capture an uncaptured charge', async () => {
      const charge = await stripe.charges.create({
        amount: 2000,
        currency: 'usd',
        source: 'tok_visa',
        capture: false,
      })

      expect(charge.captured).toBe(false)

      const captured = await stripe.charges.capture(charge.id)

      expect(captured.captured).toBe(true)
    })
  })

  // ===========================================================================
  // Refunds Tests
  // ===========================================================================

  describe('refunds', () => {
    it('should create a refund for a charge', async () => {
      const charge = await stripe.charges.create({
        amount: 2000,
        currency: 'usd',
        source: 'tok_visa',
      })

      const refund = await stripe.refunds.create({
        charge: charge.id,
      })

      expect(refund.id).toMatch(/^re_/)
      expect(refund.amount).toBe(2000)
      expect(refund.status).toBe('succeeded')
    })

    it('should create a partial refund', async () => {
      const charge = await stripe.charges.create({
        amount: 2000,
        currency: 'usd',
        source: 'tok_visa',
      })

      const refund = await stripe.refunds.create({
        charge: charge.id,
        amount: 1000,
      })

      expect(refund.amount).toBe(1000)
    })

    it('should create a refund for a payment intent', async () => {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 2000,
        currency: 'usd',
        payment_method: 'pm_card_visa',
        confirm: true,
      })

      const refund = await stripe.refunds.create({
        payment_intent: paymentIntent.id,
      })

      expect(refund.payment_intent).toBe(paymentIntent.id)
      expect(refund.amount).toBe(2000)
    })
  })

  // ===========================================================================
  // Webhook Tests
  // ===========================================================================

  describe('webhooks', () => {
    describe('endpoint management', () => {
      it('should create a webhook endpoint', async () => {
        const endpoint = await stripe.webhookEndpoints.create({
          url: 'https://example.com/webhook',
          enabled_events: ['payment_intent.succeeded', 'customer.created'],
        })

        expect(endpoint.id).toMatch(/^we_/)
        expect(endpoint.url).toBe('https://example.com/webhook')
        expect(endpoint.secret).toMatch(/^whsec_/)
        expect(endpoint.enabled_events).toContain('payment_intent.succeeded')
      })

      it('should update a webhook endpoint', async () => {
        const endpoint = await stripe.webhookEndpoints.create({
          url: 'https://example.com/webhook',
          enabled_events: ['*'],
        })

        const updated = await stripe.webhookEndpoints.update(endpoint.id, {
          url: 'https://new-url.com/webhook',
        })

        expect(updated.url).toBe('https://new-url.com/webhook')
      })

      it('should list webhook endpoints', async () => {
        await stripe.webhookEndpoints.create({
          url: 'https://example.com/webhook1',
          enabled_events: ['*'],
        })
        await stripe.webhookEndpoints.create({
          url: 'https://example.com/webhook2',
          enabled_events: ['*'],
        })

        const result = await stripe.webhookEndpoints.list()

        expect(result.data.length).toBeGreaterThanOrEqual(2)
      })
    })

    describe('signature verification', () => {
      it('should verify valid signatures', async () => {
        const secret = 'whsec_test_secret_123'
        const payload = JSON.stringify({ id: 'evt_123', type: 'test' })

        const header = await StripeLocal.webhooks.generateTestHeaderString({
          payload,
          secret,
        })

        const isValid = await StripeLocal.webhooks.verifySignature(payload, header, secret)

        expect(isValid).toBe(true)
      })

      it('should reject invalid signatures', async () => {
        const secret = 'whsec_test_secret_123'
        const payload = JSON.stringify({ id: 'evt_123', type: 'test' })

        const header = await StripeLocal.webhooks.generateTestHeaderString({
          payload,
          secret,
        })

        const isValid = await StripeLocal.webhooks.verifySignature(payload, header, 'wrong_secret')

        expect(isValid).toBe(false)
      })

      it('should construct event from valid payload', async () => {
        const secret = 'whsec_test_secret_123'
        const eventData = {
          id: 'evt_test',
          object: 'event',
          type: 'payment_intent.succeeded',
          api_version: '2024-12-18.acacia',
          created: Math.floor(Date.now() / 1000),
          livemode: false,
          pending_webhooks: 0,
          request: { id: 'req_test', idempotency_key: null },
          data: {
            object: { id: 'pi_test', amount: 2000 },
          },
        }
        const payload = JSON.stringify(eventData)

        const header = await StripeLocal.webhooks.generateTestHeaderString({
          payload,
          secret,
        })

        const event = await StripeLocal.webhooks.constructEvent(payload, header, secret)

        expect(event.id).toBe('evt_test')
        expect(event.type).toBe('payment_intent.succeeded')
      })

      it('should reject expired signatures', async () => {
        const secret = 'whsec_test_secret_123'
        const payload = JSON.stringify({ id: 'evt_123', type: 'test' })

        // Create a signature from 10 minutes ago
        const oldTimestamp = Math.floor(Date.now() / 1000) - 600
        const header = await StripeLocal.webhooks.generateTestHeaderString({
          payload,
          secret,
          timestamp: oldTimestamp,
        })

        // With default tolerance of 300 seconds, this should fail
        const isValid = await StripeLocal.webhooks.verifySignature(payload, header, secret, 300)

        expect(isValid).toBe(false)
      })
    })
  })

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe('integration', () => {
    it('should handle full subscription payment flow', async () => {
      // Create customer
      const customer = await stripe.customers.create({
        email: 'subscriber@example.com',
        name: 'Premium Subscriber',
      })

      // Create product and price
      const product = await stripe.products.create({
        name: 'Premium Plan',
        description: 'Full access to all features',
      })

      const price = await stripe.prices.create({
        currency: 'usd',
        product: product.id,
        unit_amount: 2999,
        recurring: { interval: 'month' },
      })

      // Create subscription
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: price.id }],
      })

      expect(subscription.status).toBe('active')
      expect(subscription.customer).toBe(customer.id)

      // Process a payment
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 2999,
        currency: 'usd',
        customer: customer.id,
        payment_method: 'pm_card_visa',
        confirm: true,
      })

      expect(paymentIntent.status).toBe('succeeded')
      expect(paymentIntent.customer).toBe(customer.id)

      // Give webhook events time to process
      await new Promise((r) => setTimeout(r, 10))

      // Verify webhook events were emitted
      const customerEvent = webhookEvents.find((e) => e.type === 'customer.created')
      const subscriptionEvent = webhookEvents.find((e) => e.type === 'customer.subscription.created')
      const paymentEvent = webhookEvents.find((e) => e.type === 'payment_intent.succeeded')

      expect(customerEvent).toBeDefined()
      expect(subscriptionEvent).toBeDefined()
      expect(paymentEvent).toBeDefined()
    })

    it('should handle refund flow', async () => {
      // Create and confirm payment
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 5000,
        currency: 'usd',
        payment_method: 'pm_card_visa',
        confirm: true,
      })

      expect(paymentIntent.status).toBe('succeeded')

      // Process refund
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntent.id,
        amount: 2500, // Partial refund
      })

      expect(refund.amount).toBe(2500)
      expect(refund.status).toBe('succeeded')
    })

    it('should handle idempotent operations correctly', async () => {
      const idempotencyKey = `order-${Date.now()}`

      // First attempt
      const first = await stripe.paymentIntents.create(
        {
          amount: 10000,
          currency: 'usd',
          payment_method: 'pm_card_visa',
          confirm: true,
        },
        { idempotencyKey }
      )

      // Simulate network retry with same idempotency key
      const second = await stripe.paymentIntents.create(
        {
          amount: 10000,
          currency: 'usd',
          payment_method: 'pm_card_visa',
          confirm: true,
        },
        { idempotencyKey }
      )

      // Should return the same payment intent
      expect(first.id).toBe(second.id)
      expect(first.amount).toBe(second.amount)
    })
  })
})
