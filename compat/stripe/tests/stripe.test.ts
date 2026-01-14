/**
 * @dotdo/stripe - Stripe Compatibility Layer Tests
 *
 * Tests for the Stripe API compatibility layer including:
 * - Customer operations (CRUD)
 * - Subscription management
 * - Payment intents
 * - Charges and refunds
 * - Webhook signature verification
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Stripe,
  StripeAPIError,
  Webhooks,
  type Customer,
  type Subscription,
  type PaymentIntent,
  type Charge,
  type Refund,
  type ListResponse,
  type WebhookEvent,
} from '../index'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url)
    const key = `${options?.method ?? 'GET'} ${urlObj.pathname}`

    const mockResponse = responses.get(key)
    if (!mockResponse) {
      return {
        ok: false,
        status: 404,
        headers: new Headers({ 'request-id': 'req_mock' }),
        json: async () => ({
          error: { type: 'invalid_request_error', message: `No mock for ${key}` },
        }),
      }
    }

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: new Headers({ 'request-id': 'req_mock' }),
      json: async () => mockResponse.body,
    }
  })
}

function mockCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'cus_test123',
    object: 'customer',
    balance: 0,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    metadata: {},
    email: 'test@example.com',
    name: 'Test Customer',
    ...overrides,
  }
}

function mockSubscription(overrides: Partial<Subscription> = {}): Subscription {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: 'sub_test123',
    object: 'subscription',
    billing_cycle_anchor: now,
    cancel_at_period_end: false,
    collection_method: 'charge_automatically',
    created: now,
    currency: 'usd',
    current_period_end: now + 30 * 24 * 60 * 60,
    current_period_start: now,
    customer: 'cus_test123',
    items: { object: 'list', data: [], has_more: false, url: '/v1/subscription_items' },
    livemode: false,
    metadata: {},
    start_date: now,
    status: 'active',
    ...overrides,
  }
}

function mockPaymentIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    id: 'pi_test123',
    object: 'payment_intent',
    amount: 2000,
    amount_capturable: 0,
    amount_received: 2000,
    capture_method: 'automatic',
    confirmation_method: 'automatic',
    created: Math.floor(Date.now() / 1000),
    currency: 'usd',
    livemode: false,
    metadata: {},
    payment_method_types: ['card'],
    status: 'succeeded',
    ...overrides,
  }
}

function mockCharge(overrides: Partial<Charge> = {}): Charge {
  return {
    id: 'ch_test123',
    object: 'charge',
    amount: 2000,
    amount_captured: 2000,
    amount_refunded: 0,
    billing_details: {},
    captured: true,
    created: Math.floor(Date.now() / 1000),
    currency: 'usd',
    disputed: false,
    livemode: false,
    metadata: {},
    paid: true,
    refunded: false,
    status: 'succeeded',
    ...overrides,
  }
}

function mockRefund(overrides: Partial<Refund> = {}): Refund {
  return {
    id: 're_test123',
    object: 'refund',
    amount: 1000,
    created: Math.floor(Date.now() / 1000),
    currency: 'usd',
    metadata: {},
    status: 'succeeded',
    ...overrides,
  }
}

// =============================================================================
// Stripe Client Tests
// =============================================================================

describe('@dotdo/stripe - Stripe Client', () => {
  describe('initialization', () => {
    it('should create a Stripe instance with API key', () => {
      const stripe = new Stripe('sk_test_xxx')
      expect(stripe).toBeDefined()
      expect(stripe.customers).toBeDefined()
      expect(stripe.subscriptions).toBeDefined()
      expect(stripe.paymentIntents).toBeDefined()
      expect(stripe.charges).toBeDefined()
      expect(stripe.refunds).toBeDefined()
    })

    it('should throw error without API key', () => {
      expect(() => new Stripe('')).toThrow('Stripe API key is required')
    })

    it('should accept configuration options', () => {
      const stripe = new Stripe('sk_test_xxx', {
        apiVersion: '2024-12-18.acacia',
        maxNetworkRetries: 3,
        timeout: 60000,
      })
      expect(stripe).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should throw StripeAPIError on API errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/customers/cus_nonexistent',
            {
              status: 404,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'No such customer: cus_nonexistent',
                  code: 'resource_missing',
                  param: 'id',
                },
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })

      await expect(stripe.customers.retrieve('cus_nonexistent')).rejects.toThrow(StripeAPIError)

      try {
        await stripe.customers.retrieve('cus_nonexistent')
      } catch (error) {
        expect(error).toBeInstanceOf(StripeAPIError)
        const stripeError = error as StripeAPIError
        expect(stripeError.type).toBe('invalid_request_error')
        expect(stripeError.code).toBe('resource_missing')
        expect(stripeError.statusCode).toBe(404)
      }
    })
  })
})

// =============================================================================
// Customers Resource Tests
// =============================================================================

describe('@dotdo/stripe - Customers', () => {
  describe('create', () => {
    it('should create a customer', async () => {
      const expectedCustomer = mockCustomer()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/customers', { status: 200, body: expectedCustomer }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const customer = await stripe.customers.create({
        email: 'test@example.com',
        name: 'Test Customer',
      })

      expect(customer.id).toBe('cus_test123')
      expect(customer.email).toBe('test@example.com')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/customers'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('should pass metadata to customer creation', async () => {
      const expectedCustomer = mockCustomer({ metadata: { plan: 'enterprise' } })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/customers', { status: 200, body: expectedCustomer }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const customer = await stripe.customers.create({
        email: 'test@example.com',
        metadata: { plan: 'enterprise' },
      })

      expect(customer.metadata.plan).toBe('enterprise')
    })
  })

  describe('retrieve', () => {
    it('should retrieve a customer by ID', async () => {
      const expectedCustomer = mockCustomer()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/customers/cus_test123', { status: 200, body: expectedCustomer }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const customer = await stripe.customers.retrieve('cus_test123')

      expect(customer.id).toBe('cus_test123')
      expect(customer.object).toBe('customer')
    })
  })

  describe('update', () => {
    it('should update a customer', async () => {
      const updatedCustomer = mockCustomer({ name: 'Updated Name' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/customers/cus_test123', { status: 200, body: updatedCustomer }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const customer = await stripe.customers.update('cus_test123', {
        name: 'Updated Name',
      })

      expect(customer.name).toBe('Updated Name')
    })
  })

  describe('del', () => {
    it('should delete a customer', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /v1/customers/cus_test123',
            {
              status: 200,
              body: { id: 'cus_test123', object: 'customer', deleted: true },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.customers.del('cus_test123')

      expect(result.deleted).toBe(true)
      expect(result.id).toBe('cus_test123')
    })
  })

  describe('list', () => {
    it('should list customers', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/customers',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockCustomer(), mockCustomer({ id: 'cus_test456' })],
                has_more: false,
                url: '/v1/customers',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.customers.list()

      expect(result.object).toBe('list')
      expect(result.data).toHaveLength(2)
    })

    it('should support pagination parameters', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/customers',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockCustomer()],
                has_more: true,
                url: '/v1/customers',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.customers.list({ limit: 1 })

      expect(result.has_more).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=1'),
        expect.anything()
      )
    })
  })
})

// =============================================================================
// Subscriptions Resource Tests
// =============================================================================

describe('@dotdo/stripe - Subscriptions', () => {
  describe('create', () => {
    it('should create a subscription', async () => {
      const expectedSubscription = mockSubscription()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/subscriptions', { status: 200, body: expectedSubscription }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const subscription = await stripe.subscriptions.create({
        customer: 'cus_test123',
        items: [{ price: 'price_test123' }],
      })

      expect(subscription.id).toBe('sub_test123')
      expect(subscription.customer).toBe('cus_test123')
      expect(subscription.status).toBe('active')
    })

    it('should create a subscription with trial period', async () => {
      const expectedSubscription = mockSubscription({ status: 'trialing' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/subscriptions', { status: 200, body: expectedSubscription }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const subscription = await stripe.subscriptions.create({
        customer: 'cus_test123',
        items: [{ price: 'price_test123' }],
        trial_period_days: 14,
      })

      expect(subscription.status).toBe('trialing')
    })
  })

  describe('retrieve', () => {
    it('should retrieve a subscription', async () => {
      const expectedSubscription = mockSubscription()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/subscriptions/sub_test123', { status: 200, body: expectedSubscription }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const subscription = await stripe.subscriptions.retrieve('sub_test123')

      expect(subscription.id).toBe('sub_test123')
      expect(subscription.object).toBe('subscription')
    })
  })

  describe('update', () => {
    it('should update a subscription', async () => {
      const updatedSubscription = mockSubscription({ cancel_at_period_end: true })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/subscriptions/sub_test123', { status: 200, body: updatedSubscription }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const subscription = await stripe.subscriptions.update('sub_test123', {
        cancel_at_period_end: true,
      })

      expect(subscription.cancel_at_period_end).toBe(true)
    })
  })

  describe('cancel', () => {
    it('should cancel a subscription', async () => {
      const canceledSubscription = mockSubscription({ status: 'canceled' })
      const mockFetch = createMockFetch(
        new Map([
          ['DELETE /v1/subscriptions/sub_test123', { status: 200, body: canceledSubscription }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const subscription = await stripe.subscriptions.cancel('sub_test123')

      expect(subscription.status).toBe('canceled')
    })

    it('should cancel a subscription with feedback', async () => {
      const canceledSubscription = mockSubscription({
        status: 'canceled',
        cancellation_details: { feedback: 'too_expensive', reason: 'cancellation_requested' },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['DELETE /v1/subscriptions/sub_test123', { status: 200, body: canceledSubscription }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const subscription = await stripe.subscriptions.cancel('sub_test123', {
        cancellation_details: { feedback: 'too_expensive' },
      })

      expect(subscription.cancellation_details?.feedback).toBe('too_expensive')
    })
  })

  describe('list', () => {
    it('should list subscriptions', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/subscriptions',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockSubscription()],
                has_more: false,
                url: '/v1/subscriptions',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.subscriptions.list()

      expect(result.data).toHaveLength(1)
    })

    it('should filter subscriptions by status', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/subscriptions',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockSubscription({ status: 'active' })],
                has_more: false,
                url: '/v1/subscriptions',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.subscriptions.list({ status: 'active' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=active'),
        expect.anything()
      )
    })
  })
})

// =============================================================================
// Payment Intents Resource Tests
// =============================================================================

describe('@dotdo/stripe - Payment Intents', () => {
  describe('create', () => {
    it('should create a payment intent', async () => {
      const expectedPI = mockPaymentIntent({ status: 'requires_payment_method' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/payment_intents', { status: 200, body: expectedPI }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 2000,
        currency: 'usd',
      })

      expect(paymentIntent.id).toBe('pi_test123')
      expect(paymentIntent.amount).toBe(2000)
      expect(paymentIntent.currency).toBe('usd')
    })

    it('should create a payment intent with automatic payment methods', async () => {
      const expectedPI = mockPaymentIntent({
        automatic_payment_methods: { enabled: true },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/payment_intents', { status: 200, body: expectedPI }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 2000,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
      })

      expect(paymentIntent.automatic_payment_methods?.enabled).toBe(true)
    })
  })

  describe('retrieve', () => {
    it('should retrieve a payment intent', async () => {
      const expectedPI = mockPaymentIntent()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/payment_intents/pi_test123', { status: 200, body: expectedPI }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const paymentIntent = await stripe.paymentIntents.retrieve('pi_test123')

      expect(paymentIntent.id).toBe('pi_test123')
    })
  })

  describe('confirm', () => {
    it('should confirm a payment intent', async () => {
      const confirmedPI = mockPaymentIntent({ status: 'succeeded' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/payment_intents/pi_test123/confirm', { status: 200, body: confirmedPI }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const paymentIntent = await stripe.paymentIntents.confirm('pi_test123', {
        payment_method: 'pm_card_visa',
      })

      expect(paymentIntent.status).toBe('succeeded')
    })
  })

  describe('capture', () => {
    it('should capture a payment intent', async () => {
      const capturedPI = mockPaymentIntent({ amount_capturable: 0, amount_received: 2000 })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/payment_intents/pi_test123/capture', { status: 200, body: capturedPI }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const paymentIntent = await stripe.paymentIntents.capture('pi_test123')

      expect(paymentIntent.amount_capturable).toBe(0)
      expect(paymentIntent.amount_received).toBe(2000)
    })

    it('should capture a partial amount', async () => {
      const capturedPI = mockPaymentIntent({ amount_received: 1500 })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/payment_intents/pi_test123/capture', { status: 200, body: capturedPI }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const paymentIntent = await stripe.paymentIntents.capture('pi_test123', {
        amount_to_capture: 1500,
      })

      expect(paymentIntent.amount_received).toBe(1500)
    })
  })

  describe('cancel', () => {
    it('should cancel a payment intent', async () => {
      const canceledPI = mockPaymentIntent({ status: 'canceled', cancellation_reason: 'requested_by_customer' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/payment_intents/pi_test123/cancel', { status: 200, body: canceledPI }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const paymentIntent = await stripe.paymentIntents.cancel('pi_test123', {
        cancellation_reason: 'requested_by_customer',
      })

      expect(paymentIntent.status).toBe('canceled')
      expect(paymentIntent.cancellation_reason).toBe('requested_by_customer')
    })
  })

  describe('list', () => {
    it('should list payment intents', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/payment_intents',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockPaymentIntent()],
                has_more: false,
                url: '/v1/payment_intents',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.paymentIntents.list()

      expect(result.data).toHaveLength(1)
    })
  })
})

// =============================================================================
// Charges Resource Tests
// =============================================================================

describe('@dotdo/stripe - Charges', () => {
  describe('create', () => {
    it('should create a charge (legacy)', async () => {
      const expectedCharge = mockCharge()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/charges', { status: 200, body: expectedCharge }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const charge = await stripe.charges.create({
        amount: 2000,
        currency: 'usd',
        source: 'tok_visa',
      })

      expect(charge.id).toBe('ch_test123')
      expect(charge.amount).toBe(2000)
    })
  })

  describe('retrieve', () => {
    it('should retrieve a charge', async () => {
      const expectedCharge = mockCharge()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/charges/ch_test123', { status: 200, body: expectedCharge }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const charge = await stripe.charges.retrieve('ch_test123')

      expect(charge.id).toBe('ch_test123')
    })
  })

  describe('capture', () => {
    it('should capture a charge', async () => {
      const capturedCharge = mockCharge({ captured: true })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/charges/ch_test123/capture', { status: 200, body: capturedCharge }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const charge = await stripe.charges.capture('ch_test123')

      expect(charge.captured).toBe(true)
    })
  })

  describe('list', () => {
    it('should list charges', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/charges',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockCharge()],
                has_more: false,
                url: '/v1/charges',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.charges.list()

      expect(result.data).toHaveLength(1)
    })
  })
})

// =============================================================================
// Refunds Resource Tests
// =============================================================================

describe('@dotdo/stripe - Refunds', () => {
  describe('create', () => {
    it('should create a refund', async () => {
      const expectedRefund = mockRefund()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/refunds', { status: 200, body: expectedRefund }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const refund = await stripe.refunds.create({
        payment_intent: 'pi_test123',
      })

      expect(refund.id).toBe('re_test123')
      expect(refund.amount).toBe(1000)
    })

    it('should create a partial refund', async () => {
      const expectedRefund = mockRefund({ amount: 500 })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/refunds', { status: 200, body: expectedRefund }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const refund = await stripe.refunds.create({
        payment_intent: 'pi_test123',
        amount: 500,
      })

      expect(refund.amount).toBe(500)
    })
  })

  describe('retrieve', () => {
    it('should retrieve a refund', async () => {
      const expectedRefund = mockRefund()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/refunds/re_test123', { status: 200, body: expectedRefund }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const refund = await stripe.refunds.retrieve('re_test123')

      expect(refund.id).toBe('re_test123')
    })
  })

  describe('cancel', () => {
    it('should cancel a refund', async () => {
      const canceledRefund = mockRefund({ status: 'canceled' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/refunds/re_test123/cancel', { status: 200, body: canceledRefund }],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const refund = await stripe.refunds.cancel('re_test123')

      expect(refund.status).toBe('canceled')
    })
  })

  describe('list', () => {
    it('should list refunds', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/refunds',
            {
              status: 200,
              body: {
                object: 'list',
                data: [mockRefund()],
                has_more: false,
                url: '/v1/refunds',
              },
            },
          ],
        ])
      )

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      const result = await stripe.refunds.list()

      expect(result.data).toHaveLength(1)
    })
  })
})

// =============================================================================
// Webhook Signature Verification Tests
// =============================================================================

describe('@dotdo/stripe - Webhooks', () => {
  const testSecret = 'whsec_test123'
  const testPayload = JSON.stringify({
    id: 'evt_test123',
    object: 'event',
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: mockPaymentIntent(),
    },
    livemode: false,
    pending_webhooks: 0,
  })

  describe('constructEvent', () => {
    it('should verify and parse a valid webhook event', async () => {
      const timestamp = Math.floor(Date.now() / 1000)
      const signature = await Webhooks.generateTestHeaderString({
        payload: testPayload,
        secret: testSecret,
        timestamp,
      })

      const event = await Webhooks.constructEvent(testPayload, signature, testSecret)

      expect(event.id).toBe('evt_test123')
      expect(event.type).toBe('payment_intent.succeeded')
      expect(event.object).toBe('event')
    })

    it('should reject invalid signature', async () => {
      // Use a current timestamp so we don't fail on timestamp check first
      const timestamp = Math.floor(Date.now() / 1000)
      const signature = `t=${timestamp},v1=invalid_signature`

      await expect(
        Webhooks.constructEvent(testPayload, signature, testSecret)
      ).rejects.toThrow('Webhook signature verification failed')
    })

    it('should reject expired timestamp', async () => {
      const timestamp = Math.floor(Date.now() / 1000) - 400 // 400 seconds ago
      const signature = await Webhooks.generateTestHeaderString({
        payload: testPayload,
        secret: testSecret,
        timestamp,
      })

      await expect(
        Webhooks.constructEvent(testPayload, signature, testSecret, 300) // 5 min tolerance
      ).rejects.toThrow('Webhook timestamp too old')
    })

    it('should reject missing timestamp', async () => {
      const signature = 'v1=somesignature'

      await expect(
        Webhooks.constructEvent(testPayload, signature, testSecret)
      ).rejects.toThrow('Unable to extract timestamp')
    })

    it('should reject missing signature', async () => {
      const signature = 't=1234567890'

      await expect(
        Webhooks.constructEvent(testPayload, signature, testSecret)
      ).rejects.toThrow('No valid signature found')
    })

    it('should accept ArrayBuffer payload', async () => {
      const encoder = new TextEncoder()
      const payloadBuffer = encoder.encode(testPayload).buffer

      const timestamp = Math.floor(Date.now() / 1000)
      const signature = await Webhooks.generateTestHeaderString({
        payload: testPayload,
        secret: testSecret,
        timestamp,
      })

      const event = await Webhooks.constructEvent(payloadBuffer, signature, testSecret)

      expect(event.id).toBe('evt_test123')
    })
  })

  describe('verifySignature', () => {
    it('should return true for valid signature', async () => {
      const timestamp = Math.floor(Date.now() / 1000)
      const signature = await Webhooks.generateTestHeaderString({
        payload: testPayload,
        secret: testSecret,
        timestamp,
      })

      const isValid = await Webhooks.verifySignature(testPayload, signature, testSecret)

      expect(isValid).toBe(true)
    })

    it('should return false for invalid signature', async () => {
      const signature = 't=1234567890,v1=invalid_signature'

      const isValid = await Webhooks.verifySignature(testPayload, signature, testSecret)

      expect(isValid).toBe(false)
    })
  })

  describe('generateTestHeaderString', () => {
    it('should generate a valid test signature', async () => {
      const timestamp = 1234567890
      const signature = await Webhooks.generateTestHeaderString({
        payload: testPayload,
        secret: testSecret,
        timestamp,
      })

      expect(signature).toMatch(/^t=1234567890,v1=[a-f0-9]{64}$/)
    })

    it('should use current timestamp if not provided', async () => {
      const before = Math.floor(Date.now() / 1000)
      const signature = await Webhooks.generateTestHeaderString({
        payload: testPayload,
        secret: testSecret,
      })
      const after = Math.floor(Date.now() / 1000)

      const timestampMatch = signature.match(/t=(\d+)/)
      expect(timestampMatch).toBeTruthy()
      const timestamp = parseInt(timestampMatch![1], 10)
      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
    })
  })
})

// =============================================================================
// Request Options Tests
// =============================================================================

describe('@dotdo/stripe - Request Options', () => {
  it('should pass idempotency key', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => mockCustomer(),
    })

    const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
    await stripe.customers.create({ email: 'test@example.com' }, { idempotencyKey: 'idem_123' })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'idem_123',
        }),
      })
    )
  })

  it('should pass Stripe-Account header for Connect', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => mockCustomer(),
    })

    const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
    await stripe.customers.create({ email: 'test@example.com' }, { stripeAccount: 'acct_connected' })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Stripe-Account': 'acct_connected',
        }),
      })
    )
  })

  it('should allow API version override per request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => mockCustomer(),
    })

    const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
    await stripe.customers.create({ email: 'test@example.com' }, { apiVersion: '2024-01-01' })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Stripe-Version': '2024-01-01',
        }),
      })
    )
  })
})

// =============================================================================
// Edge Cases and Error Scenarios
// =============================================================================

describe('@dotdo/stripe - Edge Cases', () => {
  describe('form encoding', () => {
    it('should properly encode nested objects', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockCustomer(),
      })

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      await stripe.customers.create({
        email: 'test@example.com',
        address: {
          city: 'San Francisco',
          country: 'US',
          line1: '123 Main St',
        },
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = options?.body as string

      expect(body).toContain('address%5Bcity%5D=San%20Francisco')
      expect(body).toContain('address%5Bcountry%5D=US')
      expect(body).toContain('address%5Bline1%5D=123%20Main%20St')
    })

    it('should properly encode arrays', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockSubscription(),
      })

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      await stripe.subscriptions.create({
        customer: 'cus_test123',
        items: [
          { price: 'price_1' },
          { price: 'price_2' },
        ],
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = options?.body as string

      expect(body).toContain('items%5B0%5D%5Bprice%5D=price_1')
      expect(body).toContain('items%5B1%5D%5Bprice%5D=price_2')
    })

    it('should handle metadata correctly', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockCustomer(),
      })

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      await stripe.customers.create({
        email: 'test@example.com',
        metadata: {
          order_id: '12345',
          campaign: 'summer_sale',
        },
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = options?.body as string

      expect(body).toContain('metadata%5Border_id%5D=12345')
      expect(body).toContain('metadata%5Bcampaign%5D=summer_sale')
    })
  })

  describe('special characters', () => {
    it('should handle special characters in values', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockCustomer(),
      })

      const stripe = new Stripe('sk_test_xxx', { fetch: mockFetch })
      await stripe.customers.create({
        email: 'test+tag@example.com',
        name: 'John & Jane Doe',
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = options?.body as string

      expect(body).toContain('email=test%2Btag%40example.com')
      expect(body).toContain('name=John%20%26%20Jane%20Doe')
    })
  })
})
