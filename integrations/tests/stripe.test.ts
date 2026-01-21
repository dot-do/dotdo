// Stripe Integration Tests
// TDD tests for Stripe payment integration (do-wmao)

import { describe, it, expect, beforeEach } from 'vitest'
import {
  StripeIntegration,
  createStripeIntegration,
  type StripeConfig,
  type StripeCustomer,
  type StripePaymentIntent,
  type StripeSubscription,
} from '../stripe'

describe('StripeIntegration', () => {
  let stripe: StripeIntegration

  beforeEach(() => {
    stripe = createStripeIntegration()
  })

  describe('metadata', () => {
    it('should have correct name and version', () => {
      expect(stripe.name).toBe('stripe')
      expect(stripe.version).toBe('1.0.0')
    })

    it('should have correct metadata', () => {
      expect(stripe.metadata.displayName).toBe('Stripe')
      expect(stripe.metadata.category).toBe('payments')
      expect(stripe.metadata.requiredConfig).toContain('apiKey')
      expect(stripe.metadata.docsUrl).toBe('https://stripe.com/docs/api')
    })

    it('should start uninitialized', () => {
      expect(stripe.status).toBe('uninitialized')
    })
  })

  describe('init', () => {
    it('should initialize with valid config', async () => {
      const config: StripeConfig = {
        apiKey: 'sk_test_1234567890abcdef',
        webhookSecret: 'whsec_1234567890abcdef',
      }

      await stripe.init(config)
      expect(stripe.status).toBe('ready')
    })

    it('should reject missing apiKey', async () => {
      const config = {} as StripeConfig

      await expect(stripe.init(config)).rejects.toThrow('Stripe API key is required')
    })

    it('should reject invalid apiKey format', async () => {
      const config: StripeConfig = {
        apiKey: 'invalid_key_format',
      }

      await expect(stripe.init(config)).rejects.toThrow('Invalid Stripe API key format')
    })

    it('should accept test API keys', async () => {
      const config: StripeConfig = {
        apiKey: 'sk_test_abc123',
      }

      await stripe.init(config)
      expect(stripe.status).toBe('ready')
    })

    it('should accept live API keys', async () => {
      const config: StripeConfig = {
        apiKey: 'sk_live_abc123',
      }

      await stripe.init(config)
      expect(stripe.status).toBe('ready')
    })

    it('should set status to error on init failure', async () => {
      const config = { apiKey: 'invalid' } as StripeConfig

      try {
        await stripe.init(config)
      } catch {
        // Expected
      }

      expect(stripe.status).toBe('error')
    })
  })

  describe('shutdown', () => {
    it('should reset to uninitialized state', async () => {
      const config: StripeConfig = {
        apiKey: 'sk_test_abc123',
      }

      await stripe.init(config)
      expect(stripe.status).toBe('ready')

      await stripe.shutdown()
      expect(stripe.status).toBe('uninitialized')
    })
  })

  describe('healthCheck', () => {
    it('should return false when not initialized', async () => {
      const result = await stripe.healthCheck()
      expect(result).toBe(false)
    })

    it('should return true when initialized', async () => {
      const config: StripeConfig = {
        apiKey: 'sk_test_abc123',
      }

      await stripe.init(config)
      const result = await stripe.healthCheck()
      expect(result).toBe(true)
    })
  })

  describe('methods.createCustomer', () => {
    beforeEach(async () => {
      const config: StripeConfig = {
        apiKey: 'sk_test_abc123',
      }
      await stripe.init(config)
    })

    it('should create a customer successfully', async () => {
      const result = await stripe.methods.createCustomer({
        email: 'test@example.com',
        name: 'Test User',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toMatch(/^cus_/)
        expect(result.data.email).toBe('test@example.com')
        expect(result.data.name).toBe('Test User')
      }
    })

    it('should create a customer with metadata', async () => {
      const result = await stripe.methods.createCustomer({
        email: 'test@example.com',
        metadata: { tier: 'premium' },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.metadata).toEqual({ tier: 'premium' })
      }
    })

    it('should include requestId in result', async () => {
      const result = await stripe.methods.createCustomer({
        email: 'test@example.com',
      })

      expect(result.success).toBe(true)
      expect(result.requestId).toMatch(/^req_/)
    })

    it('should fail when not initialized', async () => {
      const uninitStripe = createStripeIntegration()
      const result = await uninitStripe.methods.createCustomer({
        email: 'test@example.com',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
      }
    })
  })

  describe('methods.getCustomer', () => {
    beforeEach(async () => {
      const config: StripeConfig = {
        apiKey: 'sk_test_abc123',
      }
      await stripe.init(config)
    })

    it('should retrieve a customer by ID', async () => {
      const result = await stripe.methods.getCustomer('cus_123abc')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('cus_123abc')
        expect(result.data.email).toBeDefined()
      }
    })
  })

  describe('methods.updateCustomer', () => {
    beforeEach(async () => {
      const config: StripeConfig = {
        apiKey: 'sk_test_abc123',
      }
      await stripe.init(config)
    })

    it('should update customer email', async () => {
      const result = await stripe.methods.updateCustomer('cus_123abc', {
        email: 'updated@example.com',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('cus_123abc')
        expect(result.data.email).toBe('updated@example.com')
      }
    })

    it('should update customer name', async () => {
      const result = await stripe.methods.updateCustomer('cus_123abc', {
        name: 'Updated Name',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Updated Name')
      }
    })
  })

  describe('methods.createPaymentIntent', () => {
    beforeEach(async () => {
      const config: StripeConfig = {
        apiKey: 'sk_test_abc123',
      }
      await stripe.init(config)
    })

    it('should create a payment intent', async () => {
      const result = await stripe.methods.createPaymentIntent({
        amount: 1000,
        currency: 'usd',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toMatch(/^pi_/)
        expect(result.data.amount).toBe(1000)
        expect(result.data.currency).toBe('usd')
        expect(result.data.status).toBe('requires_payment_method')
      }
    })

    it('should create payment intent with customer', async () => {
      const result = await stripe.methods.createPaymentIntent({
        amount: 2500,
        currency: 'usd',
        customerId: 'cus_123abc',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.customerId).toBe('cus_123abc')
      }
    })

    it('should create payment intent with metadata', async () => {
      const result = await stripe.methods.createPaymentIntent({
        amount: 1000,
        currency: 'usd',
        metadata: { orderId: 'order_123' },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.metadata).toEqual({ orderId: 'order_123' })
      }
    })
  })

  describe('methods.confirmPaymentIntent', () => {
    beforeEach(async () => {
      const config: StripeConfig = {
        apiKey: 'sk_test_abc123',
      }
      await stripe.init(config)
    })

    it('should confirm a payment intent', async () => {
      const result = await stripe.methods.confirmPaymentIntent('pi_123abc')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('pi_123abc')
        expect(result.data.status).toBe('succeeded')
      }
    })
  })

  describe('methods.createSubscription', () => {
    beforeEach(async () => {
      const config: StripeConfig = {
        apiKey: 'sk_test_abc123',
      }
      await stripe.init(config)
    })

    it('should create a subscription', async () => {
      const result = await stripe.methods.createSubscription({
        customerId: 'cus_123abc',
        priceId: 'price_monthly',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toMatch(/^sub_/)
        expect(result.data.customerId).toBe('cus_123abc')
        expect(result.data.priceId).toBe('price_monthly')
        expect(result.data.status).toBe('active')
      }
    })

    it('should set period start and end dates', async () => {
      const result = await stripe.methods.createSubscription({
        customerId: 'cus_123abc',
        priceId: 'price_monthly',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.currentPeriodStart).toBeInstanceOf(Date)
        expect(result.data.currentPeriodEnd).toBeInstanceOf(Date)
        expect(result.data.currentPeriodEnd.getTime()).toBeGreaterThan(
          result.data.currentPeriodStart.getTime()
        )
      }
    })
  })

  describe('methods.cancelSubscription', () => {
    beforeEach(async () => {
      const config: StripeConfig = {
        apiKey: 'sk_test_abc123',
      }
      await stripe.init(config)
    })

    it('should cancel a subscription', async () => {
      const result = await stripe.methods.cancelSubscription('sub_123abc')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('sub_123abc')
        expect(result.data.status).toBe('canceled')
      }
    })
  })

  describe('webhook handling', () => {
    beforeEach(async () => {
      const config: StripeConfig = {
        apiKey: 'sk_test_abc123',
        webhookSecret: 'whsec_test_secret',
      }
      await stripe.init(config)
    })

    it('should handle incoming webhook', async () => {
      const event = {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_123abc',
            amount: 1000,
          },
        },
      }

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Note: In real tests, we would need a valid signature
        },
        body: JSON.stringify(event),
      })

      // When no webhook secret verification is required
      const stripeNoSecret = createStripeIntegration()
      await stripeNoSecret.init({ apiKey: 'sk_test_abc123' })
      const response = await stripeNoSecret.handleWebhook!(request)
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.received).toBe(true)
    })

    it('should return 503 when not initialized', async () => {
      const uninitStripe = createStripeIntegration()
      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        body: '{}',
      })

      const response = await uninitStripe.handleWebhook!(request)
      expect(response.status).toBe(503)
    })

    it('should return 400 for missing signature when secret is configured', async () => {
      const event = {
        type: 'payment_intent.succeeded',
        data: { object: {} },
      }

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      })

      const response = await stripe.handleWebhook!(request)
      expect(response.status).toBe(400)

      const body = await response.json()
      expect(body.error).toContain('Missing')
    })
  })

  describe('event handlers', () => {
    it('should register and call event handlers', async () => {
      const config: StripeConfig = {
        apiKey: 'sk_test_abc123',
      }
      await stripe.init(config)

      const events: unknown[] = []
      stripe.onEvent!((event) => {
        events.push(event)
      })

      // Simulate webhook with no signature verification
      const webhookEvent = {
        type: 'customer.created',
        data: {
          object: {
            id: 'cus_123abc',
            email: 'test@example.com',
          },
        },
      }

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookEvent),
      })

      await stripe.handleWebhook!(request)
      expect(events.length).toBe(1)
      expect((events[0] as any).type).toBe('customer.created')
      expect((events[0] as any).integration).toBe('stripe')
    })
  })
})

describe('createStripeIntegration', () => {
  it('should create a new StripeIntegration instance', () => {
    const stripe = createStripeIntegration()
    expect(stripe).toBeInstanceOf(StripeIntegration)
    expect(stripe.name).toBe('stripe')
  })
})
