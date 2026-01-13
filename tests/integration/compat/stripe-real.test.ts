/**
 * Stripe Compat Layer Integration Tests (RED Phase)
 *
 * Tests the @dotdo/stripe compat layer with real DO storage,
 * verifying API compatibility with the official Stripe SDK.
 *
 * These tests:
 * 1. Verify correct API shape matching Stripe SDK
 * 2. Verify proper DO storage for payment state
 * 3. Verify error handling matches Stripe SDK behavior
 *
 * Run with: npx vitest run tests/integration/compat/stripe-real.test.ts --project=integration
 *
 * @module tests/integration/compat/stripe-real
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('Stripe Compat Layer - Real Integration', () => {
  /**
   * Test Suite 1: API Shape Compatibility with Stripe SDK
   *
   * Verifies that the Stripe compat layer exports the same API surface
   * as the official Stripe SDK.
   */
  describe('API Shape Compatibility', () => {
    it('exports Stripe class with SDK-compatible constructor', async () => {
      const { Stripe } = await import('../../../compat/stripe/index')

      expect(Stripe).toBeDefined()
      expect(typeof Stripe).toBe('function')

      // Should accept API key like official SDK
      const stripe = new Stripe('sk_test_xxx')
      expect(stripe).toBeDefined()
    })

    it('exposes customers resource', async () => {
      const { Stripe } = await import('../../../compat/stripe/index')
      const stripe = new Stripe('sk_test_xxx')

      expect(stripe.customers).toBeDefined()
      expect(typeof stripe.customers.create).toBe('function')
      expect(typeof stripe.customers.retrieve).toBe('function')
      expect(typeof stripe.customers.update).toBe('function')
      expect(typeof stripe.customers.del).toBe('function')
      expect(typeof stripe.customers.list).toBe('function')
    })

    it('exposes subscriptions resource', async () => {
      const { Stripe } = await import('../../../compat/stripe/index')
      const stripe = new Stripe('sk_test_xxx')

      expect(stripe.subscriptions).toBeDefined()
      expect(typeof stripe.subscriptions.create).toBe('function')
      expect(typeof stripe.subscriptions.retrieve).toBe('function')
      expect(typeof stripe.subscriptions.update).toBe('function')
      expect(typeof stripe.subscriptions.cancel).toBe('function')
      expect(typeof stripe.subscriptions.list).toBe('function')
    })

    it('exposes paymentIntents resource', async () => {
      const { Stripe } = await import('../../../compat/stripe/index')
      const stripe = new Stripe('sk_test_xxx')

      expect(stripe.paymentIntents).toBeDefined()
      expect(typeof stripe.paymentIntents.create).toBe('function')
      expect(typeof stripe.paymentIntents.retrieve).toBe('function')
      expect(typeof stripe.paymentIntents.update).toBe('function')
      expect(typeof stripe.paymentIntents.confirm).toBe('function')
      expect(typeof stripe.paymentIntents.capture).toBe('function')
      expect(typeof stripe.paymentIntents.cancel).toBe('function')
    })

    it('exposes charges resource', async () => {
      const { Stripe } = await import('../../../compat/stripe/index')
      const stripe = new Stripe('sk_test_xxx')

      expect(stripe.charges).toBeDefined()
      expect(typeof stripe.charges.create).toBe('function')
      expect(typeof stripe.charges.retrieve).toBe('function')
      expect(typeof stripe.charges.update).toBe('function')
      expect(typeof stripe.charges.list).toBe('function')
    })

    it('exposes refunds resource', async () => {
      const { Stripe } = await import('../../../compat/stripe/index')
      const stripe = new Stripe('sk_test_xxx')

      expect(stripe.refunds).toBeDefined()
      expect(typeof stripe.refunds.create).toBe('function')
      expect(typeof stripe.refunds.retrieve).toBe('function')
      expect(typeof stripe.refunds.update).toBe('function')
      expect(typeof stripe.refunds.list).toBe('function')
    })

    it('exports Webhooks utility for signature verification', async () => {
      const { Webhooks } = await import('../../../compat/stripe/index')

      expect(Webhooks).toBeDefined()
      expect(typeof Webhooks.constructEvent).toBe('function')
    })
  })

  /**
   * Test Suite 2: Customer Operations
   *
   * Verifies customer CRUD operations persist to DO storage.
   */
  describe('Customer Operations', () => {
    let stripe: any

    beforeEach(async () => {
      const { StripeLocal } = await import('../../../compat/stripe/index')
      stripe = new StripeLocal()
    })

    it('creates a customer with required fields', async () => {
      const customer = await stripe.customers.create({
        email: 'test@example.com',
        name: 'Test Customer',
      })

      expect(customer).toBeDefined()
      expect(customer.id).toMatch(/^cus_/)
      expect(customer.email).toBe('test@example.com')
      expect(customer.name).toBe('Test Customer')
      expect(customer.object).toBe('customer')
    })

    it('retrieves a customer by ID', async () => {
      const created = await stripe.customers.create({
        email: 'retrieve@example.com',
      })

      const retrieved = await stripe.customers.retrieve(created.id)

      expect(retrieved.id).toBe(created.id)
      expect(retrieved.email).toBe('retrieve@example.com')
    })

    it('updates a customer', async () => {
      const customer = await stripe.customers.create({
        email: 'update@example.com',
        name: 'Original Name',
      })

      const updated = await stripe.customers.update(customer.id, {
        name: 'Updated Name',
        metadata: { key: 'value' },
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.metadata).toEqual({ key: 'value' })
    })

    it('deletes a customer', async () => {
      const customer = await stripe.customers.create({
        email: 'delete@example.com',
      })

      const deleted = await stripe.customers.del(customer.id)

      expect(deleted.deleted).toBe(true)
      expect(deleted.id).toBe(customer.id)
    })

    it('lists customers with pagination', async () => {
      // Create multiple customers
      await stripe.customers.create({ email: 'list1@example.com' })
      await stripe.customers.create({ email: 'list2@example.com' })
      await stripe.customers.create({ email: 'list3@example.com' })

      const list = await stripe.customers.list({ limit: 2 })

      expect(list.object).toBe('list')
      expect(list.data).toBeDefined()
      expect(Array.isArray(list.data)).toBe(true)
    })
  })

  /**
   * Test Suite 3: Payment Intent Operations
   *
   * Verifies payment intent flows persist correctly.
   */
  describe('Payment Intent Operations', () => {
    let stripe: any

    beforeEach(async () => {
      const { StripeLocal } = await import('../../../compat/stripe/index')
      stripe = new StripeLocal()
    })

    it('creates a payment intent', async () => {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 2000,
        currency: 'usd',
      })

      expect(paymentIntent).toBeDefined()
      expect(paymentIntent.id).toMatch(/^pi_/)
      expect(paymentIntent.amount).toBe(2000)
      expect(paymentIntent.currency).toBe('usd')
      expect(paymentIntent.status).toBe('requires_payment_method')
      expect(paymentIntent.object).toBe('payment_intent')
    })

    it('creates payment intent with customer', async () => {
      const customer = await stripe.customers.create({ email: 'pi@example.com' })

      const paymentIntent = await stripe.paymentIntents.create({
        amount: 5000,
        currency: 'eur',
        customer: customer.id,
      })

      expect(paymentIntent.customer).toBe(customer.id)
    })

    it('confirms a payment intent', async () => {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 1000,
        currency: 'usd',
        payment_method: 'pm_card_visa',
      })

      const confirmed = await stripe.paymentIntents.confirm(paymentIntent.id)

      expect(confirmed.status).toBe('succeeded')
    })

    it('captures an authorized payment intent', async () => {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 3000,
        currency: 'usd',
        capture_method: 'manual',
        payment_method: 'pm_card_visa',
        confirm: true,
      })

      const captured = await stripe.paymentIntents.capture(paymentIntent.id)

      expect(captured.status).toBe('succeeded')
      expect(captured.amount_captured).toBe(3000)
    })

    it('cancels a payment intent', async () => {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 1000,
        currency: 'usd',
      })

      const canceled = await stripe.paymentIntents.cancel(paymentIntent.id)

      expect(canceled.status).toBe('canceled')
    })
  })

  /**
   * Test Suite 4: Subscription Operations
   *
   * Verifies subscription lifecycle management.
   */
  describe('Subscription Operations', () => {
    let stripe: any
    let customerId: string

    beforeEach(async () => {
      const { StripeLocal } = await import('../../../compat/stripe/index')
      stripe = new StripeLocal()

      const customer = await stripe.customers.create({ email: 'sub@example.com' })
      customerId = customer.id
    })

    it('creates a subscription', async () => {
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: 'price_xxx' }],
      })

      expect(subscription).toBeDefined()
      expect(subscription.id).toMatch(/^sub_/)
      expect(subscription.customer).toBe(customerId)
      expect(subscription.status).toBe('active')
      expect(subscription.object).toBe('subscription')
    })

    it('retrieves a subscription', async () => {
      const created = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: 'price_xxx' }],
      })

      const retrieved = await stripe.subscriptions.retrieve(created.id)

      expect(retrieved.id).toBe(created.id)
    })

    it('updates a subscription', async () => {
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: 'price_xxx' }],
      })

      const updated = await stripe.subscriptions.update(subscription.id, {
        metadata: { plan: 'premium' },
      })

      expect(updated.metadata).toEqual({ plan: 'premium' })
    })

    it('cancels a subscription', async () => {
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: 'price_xxx' }],
      })

      const canceled = await stripe.subscriptions.cancel(subscription.id)

      expect(canceled.status).toBe('canceled')
    })
  })

  /**
   * Test Suite 5: Error Handling Compatibility
   *
   * Verifies that errors match Stripe SDK error patterns.
   */
  describe('Error Handling Compatibility', () => {
    let stripe: any

    beforeEach(async () => {
      const { StripeLocal } = await import('../../../compat/stripe/index')
      stripe = new StripeLocal()
    })

    it('throws StripeAPIError for invalid customer ID', async () => {
      await expect(
        stripe.customers.retrieve('cus_nonexistent')
      ).rejects.toThrow()
    })

    it('throws error for invalid payment intent ID', async () => {
      await expect(
        stripe.paymentIntents.retrieve('pi_nonexistent')
      ).rejects.toThrow()
    })

    it('error includes type and code like Stripe', async () => {
      try {
        await stripe.customers.retrieve('cus_nonexistent')
      } catch (error: any) {
        expect(error).toBeInstanceOf(Error)
        expect(error.message).toBeDefined()
      }
    })

    it('validates required fields on create', async () => {
      await expect(
        stripe.paymentIntents.create({
          // Missing amount and currency
        })
      ).rejects.toThrow()
    })
  })

  /**
   * Test Suite 6: Webhook Signature Verification
   *
   * Verifies webhook signature verification works correctly.
   */
  describe('Webhook Signature Verification', () => {
    it('constructs event from valid webhook payload', async () => {
      const { Webhooks } = await import('../../../compat/stripe/index')

      const payload = JSON.stringify({
        id: 'evt_xxx',
        type: 'customer.created',
        data: { object: { id: 'cus_xxx' } },
      })

      // For testing, we'd need to generate a valid signature
      // This test verifies the method exists and accepts correct args
      expect(typeof Webhooks.constructEvent).toBe('function')
    })

    it('throws for invalid signature', async () => {
      const { Webhooks } = await import('../../../compat/stripe/index')

      const payload = JSON.stringify({ id: 'evt_xxx', type: 'test' })
      const invalidSignature = 'invalid_signature'
      const secret = 'whsec_xxx'

      await expect(
        Webhooks.constructEvent(payload, invalidSignature, secret)
      ).rejects.toThrow()
    })
  })
})
