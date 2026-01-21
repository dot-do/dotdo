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

describe('StripeIntegration webhook signature verification', () => {
  let stripe: StripeIntegration

  // Helper function to compute HMAC-SHA256 signature for test webhooks
  async function computeStripeSignature(
    payload: string,
    secret: string,
    timestamp: number
  ): Promise<string> {
    const signedPayload = `${timestamp}.${payload}`
    const encoder = new TextEncoder()
    const keyData = encoder.encode(secret)
    const messageData = encoder.encode(signedPayload)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  beforeEach(async () => {
    stripe = createStripeIntegration()
    await stripe.init({
      apiKey: 'sk_test_abc123',
      webhookSecret: 'whsec_test_secret',
    })
  })

  it('should accept valid webhook signature', async () => {
    const payload = JSON.stringify({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_123', amount: 1000 } },
    })

    // Use a timestamp within tolerance (now)
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = await computeStripeSignature(payload, 'whsec_test_secret', timestamp)

    const request = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': `t=${timestamp},v1=${signature}`,
      },
      body: payload,
    })

    const response = await stripe.handleWebhook!(request)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.received).toBe(true)
  })

  it('should reject expired webhook signature (timestamp too old)', async () => {
    const payload = JSON.stringify({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_123' } },
    })

    // Use a timestamp that's 10 minutes old (beyond 5-minute tolerance)
    const timestamp = Math.floor(Date.now() / 1000) - 600
    const signature = await computeStripeSignature(payload, 'whsec_test_secret', timestamp)

    const request = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': `t=${timestamp},v1=${signature}`,
      },
      body: payload,
    })

    const response = await stripe.handleWebhook!(request)
    expect(response.status).toBe(401)
  })

  it('should reject webhook with wrong secret', async () => {
    const payload = JSON.stringify({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_123' } },
    })

    const timestamp = Math.floor(Date.now() / 1000)
    // Sign with wrong secret
    const signature = await computeStripeSignature(payload, 'wrong_secret', timestamp)

    const request = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': `t=${timestamp},v1=${signature}`,
      },
      body: payload,
    })

    const response = await stripe.handleWebhook!(request)
    expect(response.status).toBe(401)
  })

  it('should reject webhook with malformed signature header', async () => {
    const payload = JSON.stringify({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_123' } },
    })

    const request = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Missing timestamp in signature
        'stripe-signature': 'v1=somesignature',
      },
      body: payload,
    })

    const response = await stripe.handleWebhook!(request)
    expect(response.status).toBe(401)
  })

  it('should skip verification when no webhook secret is configured', async () => {
    // Create a new instance without webhook secret
    const stripeNoSecret = createStripeIntegration()
    await stripeNoSecret.init({ apiKey: 'sk_test_abc123' })

    const payload = JSON.stringify({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_123' } },
    })

    const request = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Invalid signature, but no secret configured so it should be ignored
        'stripe-signature': 't=1234567890,v1=invalidsignature',
      },
      body: payload,
    })

    const response = await stripeNoSecret.handleWebhook!(request)
    expect(response.status).toBe(200)
  })

  it('should call event handlers with verified webhook', async () => {
    const events: unknown[] = []
    stripe.onEvent!((event) => events.push(event))

    const payload = JSON.stringify({
      type: 'customer.created',
      data: { object: { id: 'cus_123', email: 'test@example.com' } },
    })

    const timestamp = Math.floor(Date.now() / 1000)
    const signature = await computeStripeSignature(payload, 'whsec_test_secret', timestamp)

    const request = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': `t=${timestamp},v1=${signature}`,
      },
      body: payload,
    })

    const response = await stripe.handleWebhook!(request)
    expect(response.status).toBe(200)

    expect(events).toHaveLength(1)
    expect((events[0] as any).type).toBe('customer.created')
    expect((events[0] as any).payload.id).toBe('cus_123')
  })
})

describe('StripeIntegration error handling', () => {
  let stripe: StripeIntegration

  beforeEach(() => {
    stripe = createStripeIntegration()
  })

  describe('all methods fail when not initialized', () => {
    it('getCustomer should fail when not initialized', async () => {
      const result = await stripe.methods.getCustomer('cus_123')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
        expect(result.error.message).toContain('not initialized')
      }
    })

    it('updateCustomer should fail when not initialized', async () => {
      const result = await stripe.methods.updateCustomer('cus_123', { email: 'new@example.com' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
      }
    })

    it('createPaymentIntent should fail when not initialized', async () => {
      const result = await stripe.methods.createPaymentIntent({ amount: 1000, currency: 'usd' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
      }
    })

    it('confirmPaymentIntent should fail when not initialized', async () => {
      const result = await stripe.methods.confirmPaymentIntent('pi_123')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
      }
    })

    it('createSubscription should fail when not initialized', async () => {
      const result = await stripe.methods.createSubscription({
        customerId: 'cus_123',
        priceId: 'price_123',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
      }
    })

    it('cancelSubscription should fail when not initialized', async () => {
      const result = await stripe.methods.cancelSubscription('sub_123')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
      }
    })
  })

  describe('webhook error cases', () => {
    it('should return 400 for invalid JSON in webhook body', async () => {
      await stripe.init({ apiKey: 'sk_test_abc123' })

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json {{{',
      })

      const response = await stripe.handleWebhook!(request)
      expect(response.status).toBe(400)
    })

    it('should return 401 for invalid signature when secret is configured', async () => {
      await stripe.init({
        apiKey: 'sk_test_abc123',
        webhookSecret: 'whsec_test_secret',
      })

      const event = {
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_123' } },
      }

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=1614556800,v1=invalidsignature',
        },
        body: JSON.stringify(event),
      })

      const response = await stripe.handleWebhook!(request)
      expect(response.status).toBe(401)

      const body = await response.json()
      expect(body.error).toBe('Signature verification failed')
    })
  })

  describe('lifecycle edge cases', () => {
    it('should handle multiple init calls', async () => {
      await stripe.init({ apiKey: 'sk_test_first' })
      expect(stripe.status).toBe('ready')

      // Re-initializing should work
      await stripe.init({ apiKey: 'sk_test_second' })
      expect(stripe.status).toBe('ready')
    })

    it('should handle shutdown when not initialized', async () => {
      // Should not throw
      await stripe.shutdown()
      expect(stripe.status).toBe('uninitialized')
    })

    it('should clear webhook handlers on shutdown', async () => {
      await stripe.init({ apiKey: 'sk_test_abc123' })

      const events: unknown[] = []
      stripe.onEvent!((event) => events.push(event))

      await stripe.shutdown()

      // After reinitializing, old handlers should not be called
      await stripe.init({ apiKey: 'sk_test_abc123' })

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'test', data: { object: {} } }),
      })

      await stripe.handleWebhook!(request)
      expect(events.length).toBe(0)
    })
  })

  describe('metadata validation', () => {
    it('should have optional config fields defined', () => {
      expect(stripe.metadata.optionalConfig).toContain('webhookSecret')
      expect(stripe.metadata.optionalConfig).toContain('apiVersion')
      expect(stripe.metadata.optionalConfig).toContain('environment')
    })

    it('should have website URL defined', () => {
      expect(stripe.metadata.websiteUrl).toBe('https://stripe.com')
    })
  })
})
