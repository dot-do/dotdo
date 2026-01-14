/**
 * PaymentProcessor Tests - TDD RED Phase
 *
 * Comprehensive tests for the unified payment and billing abstraction:
 * - Payments: charge, authorize, capture, refund, void
 * - Payment Methods: cards, bank accounts, wallets
 * - Subscriptions: create, update, cancel, pause/resume
 * - Invoices: generate, send, mark paid
 * - Providers: adapter pattern for Stripe, PayPal, etc.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createPaymentProcessor,
  type PaymentProcessor,
  type Payment,
  type PaymentMethod,
  type Subscription,
  type Invoice,
  type PaymentProvider,
  type ChargeOptions,
  type AuthorizeOptions,
  type RefundOptions,
  type CreateSubscriptionOptions,
  type CreateInvoiceOptions,
  type PaymentStatus,
  type SubscriptionStatus,
  type InvoiceStatus,
  type PaymentMethodType,
} from './index'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestProcessor(): PaymentProcessor {
  return createPaymentProcessor()
}

function createMockProvider(name: string = 'mock'): PaymentProvider {
  return {
    name,
    charge: vi.fn().mockResolvedValue({
      id: `ch_${Date.now()}`,
      status: 'succeeded' as PaymentStatus,
      providerChargeId: `provider_ch_${Date.now()}`,
    }),
    authorize: vi.fn().mockResolvedValue({
      id: `auth_${Date.now()}`,
      status: 'requires_capture' as PaymentStatus,
      providerChargeId: `provider_auth_${Date.now()}`,
    }),
    capture: vi.fn().mockResolvedValue({
      status: 'succeeded' as PaymentStatus,
    }),
    refund: vi.fn().mockResolvedValue({
      id: `re_${Date.now()}`,
      status: 'succeeded',
      providerRefundId: `provider_re_${Date.now()}`,
    }),
    void: vi.fn().mockResolvedValue({
      status: 'canceled',
    }),
    createPaymentMethod: vi.fn().mockResolvedValue({
      id: `pm_${Date.now()}`,
      providerPaymentMethodId: `provider_pm_${Date.now()}`,
    }),
    deletePaymentMethod: vi.fn().mockResolvedValue(true),
    createSubscription: vi.fn().mockResolvedValue({
      id: `sub_${Date.now()}`,
      status: 'active' as SubscriptionStatus,
      providerSubscriptionId: `provider_sub_${Date.now()}`,
    }),
    updateSubscription: vi.fn().mockResolvedValue({
      status: 'active' as SubscriptionStatus,
    }),
    cancelSubscription: vi.fn().mockResolvedValue({
      status: 'canceled' as SubscriptionStatus,
    }),
    pauseSubscription: vi.fn().mockResolvedValue({
      status: 'paused' as SubscriptionStatus,
    }),
    resumeSubscription: vi.fn().mockResolvedValue({
      status: 'active' as SubscriptionStatus,
    }),
    createInvoice: vi.fn().mockResolvedValue({
      id: `inv_${Date.now()}`,
      status: 'draft' as InvoiceStatus,
      providerInvoiceId: `provider_inv_${Date.now()}`,
    }),
    sendInvoice: vi.fn().mockResolvedValue({
      status: 'sent' as InvoiceStatus,
    }),
    markInvoicePaid: vi.fn().mockResolvedValue({
      status: 'paid' as InvoiceStatus,
    }),
  }
}

// =============================================================================
// Provider Registration Tests
// =============================================================================

describe('PaymentProcessor', () => {
  describe('provider registration', () => {
    let processor: PaymentProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should register a payment provider', () => {
      const provider = createMockProvider('stripe')
      processor.registerProvider('stripe', provider)

      expect(processor.getProvider('stripe')).toBe(provider)
    })

    it('should set default provider', () => {
      const stripeProvider = createMockProvider('stripe')
      const paypalProvider = createMockProvider('paypal')

      processor.registerProvider('stripe', stripeProvider)
      processor.registerProvider('paypal', paypalProvider)
      processor.setDefaultProvider('paypal')

      expect(processor.getDefaultProvider()).toBe(paypalProvider)
    })

    it('should use first registered provider as default', () => {
      const provider = createMockProvider('stripe')
      processor.registerProvider('stripe', provider)

      expect(processor.getDefaultProvider()).toBe(provider)
    })

    it('should throw when getting non-existent provider', () => {
      expect(() => processor.getProvider('nonexistent')).toThrow('Provider not found')
    })

    it('should list registered providers', () => {
      processor.registerProvider('stripe', createMockProvider('stripe'))
      processor.registerProvider('paypal', createMockProvider('paypal'))

      const providers = processor.listProviders()
      expect(providers).toContain('stripe')
      expect(providers).toContain('paypal')
    })

    it('should unregister a provider', () => {
      processor.registerProvider('stripe', createMockProvider('stripe'))
      processor.unregisterProvider('stripe')

      expect(() => processor.getProvider('stripe')).toThrow('Provider not found')
    })
  })

  // =============================================================================
  // One-Time Payment Tests
  // =============================================================================

  describe('charge (one-time payments)', () => {
    let processor: PaymentProcessor
    let mockProvider: PaymentProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should process a charge successfully', async () => {
      const payment = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        description: 'Order #12345',
      })

      expect(payment.id).toBeDefined()
      expect(payment.amount).toBe(9999)
      expect(payment.currency).toBe('USD')
      expect(payment.status).toBe('succeeded')
      expect(payment.customerId).toBe('cust_123')
      expect(payment.description).toBe('Order #12345')
      expect(mockProvider.charge).toHaveBeenCalled()
    })

    it('should process a charge with metadata', async () => {
      const payment = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        metadata: { orderId: '12345', sku: 'ABC-123' },
      })

      expect(payment.metadata).toEqual({ orderId: '12345', sku: 'ABC-123' })
    })

    it('should use specified provider for charge', async () => {
      const paypalProvider = createMockProvider('paypal')
      processor.registerProvider('paypal', paypalProvider)

      await processor.charge({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        provider: 'paypal',
      })

      expect(paypalProvider.charge).toHaveBeenCalled()
      expect(mockProvider.charge).not.toHaveBeenCalled()
    })

    it('should use idempotency key to prevent duplicate charges', async () => {
      const payment1 = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey: 'unique_key_123',
      })

      const payment2 = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        idempotencyKey: 'unique_key_123',
      })

      expect(payment1.id).toBe(payment2.id)
      expect(mockProvider.charge).toHaveBeenCalledTimes(1)
    })

    it('should validate amount is positive', async () => {
      await expect(
        processor.charge({
          amount: -100,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      ).rejects.toThrow('Amount must be positive')
    })

    it('should validate amount is not zero', async () => {
      await expect(
        processor.charge({
          amount: 0,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      ).rejects.toThrow('Amount must be positive')
    })

    it('should store payment record', async () => {
      const payment = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const retrieved = await processor.getPayment(payment.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(payment.id)
    })

    it('should track payment creation time', async () => {
      const payment = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(payment.createdAt).toBeInstanceOf(Date)
    })

    it('should get payments by customer', async () => {
      await processor.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_abc',
        paymentMethodId: 'pm_xxx',
      })
      await processor.charge({
        amount: 2000,
        currency: 'USD',
        customerId: 'cust_abc',
        paymentMethodId: 'pm_xxx',
      })
      await processor.charge({
        amount: 3000,
        currency: 'USD',
        customerId: 'cust_xyz',
        paymentMethodId: 'pm_xxx',
      })

      const payments = await processor.getPaymentsByCustomer('cust_abc')
      expect(payments).toHaveLength(2)
      expect(payments.every((p) => p.customerId === 'cust_abc')).toBe(true)
    })
  })

  // =============================================================================
  // Authorize and Capture Tests
  // =============================================================================

  describe('authorize and capture (two-step payments)', () => {
    let processor: PaymentProcessor
    let mockProvider: PaymentProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should authorize a payment', async () => {
      const auth = await processor.authorize({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(auth.id).toBeDefined()
      expect(auth.status).toBe('requires_capture')
      expect(auth.amount).toBe(9999)
      expect(mockProvider.authorize).toHaveBeenCalled()
    })

    it('should capture an authorized payment', async () => {
      const auth = await processor.authorize({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const captured = await processor.capture(auth.id)

      expect(captured.status).toBe('succeeded')
      expect(mockProvider.capture).toHaveBeenCalledWith(
        expect.objectContaining({ id: auth.id }),
        expect.objectContaining({ amount: 9999 })
      )
    })

    it('should capture partial amount', async () => {
      const auth = await processor.authorize({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const captured = await processor.capture(auth.id, { amount: 5000 })

      expect(captured.capturedAmount).toBe(5000)
      expect(mockProvider.capture).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ amount: 5000 })
      )
    })

    it('should not capture more than authorized', async () => {
      const auth = await processor.authorize({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await expect(processor.capture(auth.id, { amount: 10000 })).rejects.toThrow(
        'Cannot capture more than authorized amount'
      )
    })

    it('should not capture already captured payment', async () => {
      const auth = await processor.authorize({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.capture(auth.id)

      await expect(processor.capture(auth.id)).rejects.toThrow('Payment already captured')
    })

    it('should track authorization expiration', async () => {
      const auth = await processor.authorize({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
        expiresIn: 7 * 24 * 60 * 60 * 1000, // 7 days
      })

      expect(auth.expiresAt).toBeInstanceOf(Date)
      expect(auth.expiresAt!.getTime()).toBeGreaterThan(Date.now())
    })
  })

  // =============================================================================
  // Refund Tests
  // =============================================================================

  describe('refund', () => {
    let processor: PaymentProcessor
    let mockProvider: PaymentProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should refund a payment fully', async () => {
      const payment = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const refund = await processor.refund(payment.id)

      expect(refund.id).toBeDefined()
      expect(refund.amount).toBe(9999)
      expect(refund.paymentId).toBe(payment.id)
      expect(refund.status).toBe('succeeded')
    })

    it('should refund a payment partially', async () => {
      const payment = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const refund = await processor.refund(payment.id, { amount: 5000 })

      expect(refund.amount).toBe(5000)
    })

    it('should include refund reason', async () => {
      const payment = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const refund = await processor.refund(payment.id, {
        amount: 5000,
        reason: 'customer_request',
      })

      expect(refund.reason).toBe('customer_request')
    })

    it('should track multiple partial refunds', async () => {
      const payment = await processor.charge({
        amount: 10000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.refund(payment.id, { amount: 3000 })
      await processor.refund(payment.id, { amount: 2000 })

      const updatedPayment = await processor.getPayment(payment.id)
      expect(updatedPayment?.refundedAmount).toBe(5000)
      expect(updatedPayment?.refunds).toHaveLength(2)
    })

    it('should not refund more than original amount', async () => {
      const payment = await processor.charge({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await expect(processor.refund(payment.id, { amount: 10000 })).rejects.toThrow(
        'Refund amount exceeds available amount'
      )
    })

    it('should not refund already fully refunded payment', async () => {
      const payment = await processor.charge({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await processor.refund(payment.id)

      await expect(processor.refund(payment.id, { amount: 1000 })).rejects.toThrow(
        'Payment already fully refunded'
      )
    })

    it('should include refund metadata', async () => {
      const payment = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const refund = await processor.refund(payment.id, {
        metadata: { ticketId: 'SUPPORT-123' },
      })

      expect(refund.metadata).toEqual({ ticketId: 'SUPPORT-123' })
    })
  })

  // =============================================================================
  // Void Tests
  // =============================================================================

  describe('void', () => {
    let processor: PaymentProcessor
    let mockProvider: PaymentProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should void an authorized payment', async () => {
      const auth = await processor.authorize({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const voided = await processor.void(auth.id)

      expect(voided.status).toBe('canceled')
      expect(mockProvider.void).toHaveBeenCalled()
    })

    it('should not void a captured payment', async () => {
      const auth = await processor.authorize({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })
      await processor.capture(auth.id)

      await expect(processor.void(auth.id)).rejects.toThrow('Cannot void captured payment')
    })

    it('should not void an already voided payment', async () => {
      const auth = await processor.authorize({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })
      await processor.void(auth.id)

      await expect(processor.void(auth.id)).rejects.toThrow('Payment already canceled')
    })
  })

  // =============================================================================
  // Payment Method Tests
  // =============================================================================

  describe('payment methods', () => {
    let processor: PaymentProcessor
    let mockProvider: PaymentProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should create a card payment method', async () => {
      const paymentMethod = await processor.paymentMethods.create({
        customerId: 'cust_123',
        type: 'card',
        card: {
          token: 'tok_visa',
        },
      })

      expect(paymentMethod.id).toBeDefined()
      expect(paymentMethod.type).toBe('card')
      expect(paymentMethod.customerId).toBe('cust_123')
    })

    it('should create a bank account payment method', async () => {
      const paymentMethod = await processor.paymentMethods.create({
        customerId: 'cust_123',
        type: 'bank_account',
        bankAccount: {
          accountNumber: '000123456789',
          routingNumber: '110000000',
          accountHolderName: 'John Doe',
          accountHolderType: 'individual',
        },
      })

      expect(paymentMethod.type).toBe('bank_account')
    })

    it('should mask sensitive card data', async () => {
      const paymentMethod = await processor.paymentMethods.create({
        customerId: 'cust_123',
        type: 'card',
        card: {
          token: 'tok_visa',
        },
      })

      // Should only store last 4 digits
      expect(paymentMethod.card?.last4).toBeDefined()
      expect(paymentMethod.card?.last4).toHaveLength(4)
      expect(paymentMethod.card?.number).toBeUndefined()
    })

    it('should get payment method by id', async () => {
      const created = await processor.paymentMethods.create({
        customerId: 'cust_123',
        type: 'card',
        card: { token: 'tok_visa' },
      })

      const retrieved = await processor.paymentMethods.get(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should list payment methods for customer', async () => {
      await processor.paymentMethods.create({
        customerId: 'cust_456',
        type: 'card',
        card: { token: 'tok_visa' },
      })
      await processor.paymentMethods.create({
        customerId: 'cust_456',
        type: 'card',
        card: { token: 'tok_mastercard' },
      })

      const methods = await processor.paymentMethods.list('cust_456')

      expect(methods).toHaveLength(2)
    })

    it('should delete a payment method', async () => {
      const paymentMethod = await processor.paymentMethods.create({
        customerId: 'cust_123',
        type: 'card',
        card: { token: 'tok_visa' },
      })

      await processor.paymentMethods.delete(paymentMethod.id)

      const retrieved = await processor.paymentMethods.get(paymentMethod.id)
      expect(retrieved).toBeNull()
    })

    it('should set default payment method for customer', async () => {
      const pm1 = await processor.paymentMethods.create({
        customerId: 'cust_789',
        type: 'card',
        card: { token: 'tok_visa' },
      })
      const pm2 = await processor.paymentMethods.create({
        customerId: 'cust_789',
        type: 'card',
        card: { token: 'tok_mastercard' },
      })

      await processor.paymentMethods.setDefault('cust_789', pm2.id)

      const defaultMethod = await processor.paymentMethods.getDefault('cust_789')
      expect(defaultMethod?.id).toBe(pm2.id)
    })

    it('should support wallet payment methods', async () => {
      const paymentMethod = await processor.paymentMethods.create({
        customerId: 'cust_123',
        type: 'wallet',
        wallet: {
          type: 'apple_pay',
          token: 'apple_pay_token_xxx',
        },
      })

      expect(paymentMethod.type).toBe('wallet')
      expect(paymentMethod.wallet?.type).toBe('apple_pay')
    })
  })

  // =============================================================================
  // Subscription Tests
  // =============================================================================

  describe('subscriptions', () => {
    let processor: PaymentProcessor
    let mockProvider: PaymentProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should create a subscription', async () => {
      const subscription = await processor.subscriptions.create({
        customerId: 'cust_123',
        priceId: 'price_xxx',
        billingCycle: 'monthly',
      })

      expect(subscription.id).toBeDefined()
      expect(subscription.status).toBe('active')
      expect(subscription.customerId).toBe('cust_123')
      expect(subscription.priceId).toBe('price_xxx')
      expect(subscription.billingCycle).toBe('monthly')
    })

    it('should create subscription with trial period', async () => {
      const subscription = await processor.subscriptions.create({
        customerId: 'cust_123',
        priceId: 'price_xxx',
        billingCycle: 'monthly',
        trialDays: 14,
      })

      expect(subscription.status).toBe('trialing')
      expect(subscription.trialEnd).toBeInstanceOf(Date)
      expect(subscription.trialEnd!.getTime()).toBeGreaterThan(Date.now())
    })

    it('should get subscription by id', async () => {
      const created = await processor.subscriptions.create({
        customerId: 'cust_123',
        priceId: 'price_xxx',
        billingCycle: 'monthly',
      })

      const retrieved = await processor.subscriptions.get(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should update subscription price', async () => {
      const subscription = await processor.subscriptions.create({
        customerId: 'cust_123',
        priceId: 'price_basic',
        billingCycle: 'monthly',
      })

      const updated = await processor.subscriptions.update(subscription.id, {
        priceId: 'price_premium',
      })

      expect(updated.priceId).toBe('price_premium')
    })

    it('should update subscription billing cycle', async () => {
      const subscription = await processor.subscriptions.create({
        customerId: 'cust_123',
        priceId: 'price_xxx',
        billingCycle: 'monthly',
      })

      const updated = await processor.subscriptions.update(subscription.id, {
        billingCycle: 'yearly',
      })

      expect(updated.billingCycle).toBe('yearly')
    })

    it('should pause a subscription', async () => {
      const subscription = await processor.subscriptions.create({
        customerId: 'cust_123',
        priceId: 'price_xxx',
        billingCycle: 'monthly',
      })

      const paused = await processor.subscriptions.pause(subscription.id)

      expect(paused.status).toBe('paused')
      expect(paused.pausedAt).toBeInstanceOf(Date)
    })

    it('should resume a paused subscription', async () => {
      const subscription = await processor.subscriptions.create({
        customerId: 'cust_123',
        priceId: 'price_xxx',
        billingCycle: 'monthly',
      })
      await processor.subscriptions.pause(subscription.id)

      const resumed = await processor.subscriptions.resume(subscription.id)

      expect(resumed.status).toBe('active')
      expect(resumed.pausedAt).toBeNull()
    })

    it('should cancel subscription immediately', async () => {
      const subscription = await processor.subscriptions.create({
        customerId: 'cust_123',
        priceId: 'price_xxx',
        billingCycle: 'monthly',
      })

      const canceled = await processor.subscriptions.cancel(subscription.id, {
        atPeriodEnd: false,
      })

      expect(canceled.status).toBe('canceled')
      expect(canceled.canceledAt).toBeInstanceOf(Date)
    })

    it('should cancel subscription at period end', async () => {
      const subscription = await processor.subscriptions.create({
        customerId: 'cust_123',
        priceId: 'price_xxx',
        billingCycle: 'monthly',
      })

      const canceled = await processor.subscriptions.cancel(subscription.id, {
        atPeriodEnd: true,
      })

      expect(canceled.status).toBe('active') // Still active until period end
      expect(canceled.cancelAtPeriodEnd).toBe(true)
    })

    it('should list subscriptions for customer', async () => {
      await processor.subscriptions.create({
        customerId: 'cust_multi',
        priceId: 'price_a',
        billingCycle: 'monthly',
      })
      await processor.subscriptions.create({
        customerId: 'cust_multi',
        priceId: 'price_b',
        billingCycle: 'yearly',
      })

      const subscriptions = await processor.subscriptions.list('cust_multi')

      expect(subscriptions).toHaveLength(2)
    })

    it('should track subscription period dates', async () => {
      const subscription = await processor.subscriptions.create({
        customerId: 'cust_123',
        priceId: 'price_xxx',
        billingCycle: 'monthly',
      })

      expect(subscription.currentPeriodStart).toBeInstanceOf(Date)
      expect(subscription.currentPeriodEnd).toBeInstanceOf(Date)
      expect(subscription.currentPeriodEnd!.getTime()).toBeGreaterThan(
        subscription.currentPeriodStart!.getTime()
      )
    })

    it('should support different billing cycles', async () => {
      const weekly = await processor.subscriptions.create({
        customerId: 'cust_123',
        priceId: 'price_weekly',
        billingCycle: 'weekly',
      })
      const yearly = await processor.subscriptions.create({
        customerId: 'cust_123',
        priceId: 'price_yearly',
        billingCycle: 'yearly',
      })

      expect(weekly.billingCycle).toBe('weekly')
      expect(yearly.billingCycle).toBe('yearly')
    })

    it('should add subscription metadata', async () => {
      const subscription = await processor.subscriptions.create({
        customerId: 'cust_123',
        priceId: 'price_xxx',
        billingCycle: 'monthly',
        metadata: { source: 'website', campaign: 'summer_sale' },
      })

      expect(subscription.metadata).toEqual({ source: 'website', campaign: 'summer_sale' })
    })

    it('should set quantity for subscription', async () => {
      const subscription = await processor.subscriptions.create({
        customerId: 'cust_123',
        priceId: 'price_seat',
        billingCycle: 'monthly',
        quantity: 5,
      })

      expect(subscription.quantity).toBe(5)
    })
  })

  // =============================================================================
  // Invoice Tests
  // =============================================================================

  describe('invoices', () => {
    let processor: PaymentProcessor
    let mockProvider: PaymentProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should create an invoice', async () => {
      const invoice = await processor.invoices.create({
        customerId: 'cust_123',
        lineItems: [{ description: 'Consulting Services', amount: 50000 }],
      })

      expect(invoice.id).toBeDefined()
      expect(invoice.status).toBe('draft')
      expect(invoice.customerId).toBe('cust_123')
      expect(invoice.lineItems).toHaveLength(1)
    })

    it('should create invoice with multiple line items', async () => {
      const invoice = await processor.invoices.create({
        customerId: 'cust_123',
        lineItems: [
          { description: 'Consulting', amount: 50000 },
          { description: 'Development', amount: 100000 },
          { description: 'Support', amount: 25000, quantity: 2 },
        ],
      })

      expect(invoice.lineItems).toHaveLength(3)
      expect(invoice.subtotal).toBe(200000) // 50000 + 100000 + 25000*2
    })

    it('should calculate invoice total', async () => {
      const invoice = await processor.invoices.create({
        customerId: 'cust_123',
        lineItems: [
          { description: 'Item 1', amount: 10000 },
          { description: 'Item 2', amount: 20000 },
        ],
      })

      expect(invoice.subtotal).toBe(30000)
      expect(invoice.total).toBe(30000)
    })

    it('should apply discount to invoice', async () => {
      const invoice = await processor.invoices.create({
        customerId: 'cust_123',
        lineItems: [{ description: 'Service', amount: 10000 }],
        discount: { type: 'percentage', value: 10 },
      })

      expect(invoice.discount?.amount).toBe(1000)
      expect(invoice.total).toBe(9000)
    })

    it('should apply fixed discount', async () => {
      const invoice = await processor.invoices.create({
        customerId: 'cust_123',
        lineItems: [{ description: 'Service', amount: 10000 }],
        discount: { type: 'fixed', value: 2500 },
      })

      expect(invoice.discount?.amount).toBe(2500)
      expect(invoice.total).toBe(7500)
    })

    it('should set due date', async () => {
      const dueDate = new Date('2024-02-01')
      const invoice = await processor.invoices.create({
        customerId: 'cust_123',
        lineItems: [{ description: 'Service', amount: 10000 }],
        dueDate,
      })

      expect(invoice.dueDate).toEqual(dueDate)
    })

    it('should send an invoice', async () => {
      const invoice = await processor.invoices.create({
        customerId: 'cust_123',
        lineItems: [{ description: 'Service', amount: 10000 }],
      })

      const sent = await processor.invoices.send(invoice.id)

      expect(sent.status).toBe('sent')
      expect(sent.sentAt).toBeInstanceOf(Date)
    })

    it('should mark invoice as paid', async () => {
      const invoice = await processor.invoices.create({
        customerId: 'cust_123',
        lineItems: [{ description: 'Service', amount: 10000 }],
      })
      await processor.invoices.send(invoice.id)

      const paid = await processor.invoices.markPaid(invoice.id, {
        paymentId: 'pay_xxx',
      })

      expect(paid.status).toBe('paid')
      expect(paid.paidAt).toBeInstanceOf(Date)
      expect(paid.paymentId).toBe('pay_xxx')
    })

    it('should get invoice by id', async () => {
      const created = await processor.invoices.create({
        customerId: 'cust_123',
        lineItems: [{ description: 'Service', amount: 10000 }],
      })

      const retrieved = await processor.invoices.get(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should list invoices for customer', async () => {
      await processor.invoices.create({
        customerId: 'cust_invoices',
        lineItems: [{ description: 'Service A', amount: 10000 }],
      })
      await processor.invoices.create({
        customerId: 'cust_invoices',
        lineItems: [{ description: 'Service B', amount: 20000 }],
      })

      const invoices = await processor.invoices.list('cust_invoices')

      expect(invoices).toHaveLength(2)
    })

    it('should void a draft invoice', async () => {
      const invoice = await processor.invoices.create({
        customerId: 'cust_123',
        lineItems: [{ description: 'Service', amount: 10000 }],
      })

      const voided = await processor.invoices.void(invoice.id)

      expect(voided.status).toBe('void')
    })

    it('should finalize a draft invoice', async () => {
      const invoice = await processor.invoices.create({
        customerId: 'cust_123',
        lineItems: [{ description: 'Service', amount: 10000 }],
      })

      const finalized = await processor.invoices.finalize(invoice.id)

      expect(finalized.status).toBe('open')
      expect(finalized.invoiceNumber).toBeDefined()
    })

    it('should track invoice number', async () => {
      const invoice1 = await processor.invoices.create({
        customerId: 'cust_123',
        lineItems: [{ description: 'Service', amount: 10000 }],
      })
      await processor.invoices.finalize(invoice1.id)

      const invoice2 = await processor.invoices.create({
        customerId: 'cust_123',
        lineItems: [{ description: 'Service', amount: 10000 }],
      })
      await processor.invoices.finalize(invoice2.id)

      const i1 = await processor.invoices.get(invoice1.id)
      const i2 = await processor.invoices.get(invoice2.id)

      expect(i1?.invoiceNumber).not.toBe(i2?.invoiceNumber)
    })

    it('should add notes to invoice', async () => {
      const invoice = await processor.invoices.create({
        customerId: 'cust_123',
        lineItems: [{ description: 'Service', amount: 10000 }],
        notes: 'Thank you for your business!',
      })

      expect(invoice.notes).toBe('Thank you for your business!')
    })

    it('should track currency', async () => {
      const invoice = await processor.invoices.create({
        customerId: 'cust_123',
        currency: 'EUR',
        lineItems: [{ description: 'Service', amount: 10000 }],
      })

      expect(invoice.currency).toBe('EUR')
    })
  })

  // =============================================================================
  // Provider Adapter Pattern Tests
  // =============================================================================

  describe('provider adapter pattern', () => {
    let processor: PaymentProcessor

    beforeEach(() => {
      processor = createTestProcessor()
    })

    it('should handle provider charge failure', async () => {
      const failingProvider: PaymentProvider = {
        ...createMockProvider('failing'),
        charge: vi.fn().mockRejectedValue(new Error('Card declined')),
      }
      processor.registerProvider('failing', failingProvider)

      await expect(
        processor.charge({
          amount: 9999,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
          provider: 'failing',
        })
      ).rejects.toThrow('Card declined')
    })

    it('should map provider-specific errors', async () => {
      const stripeProvider: PaymentProvider = {
        ...createMockProvider('stripe'),
        charge: vi.fn().mockRejectedValue({
          type: 'card_error',
          code: 'card_declined',
          message: 'Your card was declined',
        }),
      }
      processor.registerProvider('stripe', stripeProvider)

      try {
        await processor.charge({
          amount: 9999,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
          provider: 'stripe',
        })
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.code).toBe('card_declined')
      }
    })

    it('should include provider in payment record', async () => {
      const provider = createMockProvider('stripe')
      processor.registerProvider('stripe', provider)

      const payment = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(payment.provider).toBe('stripe')
    })

    it('should store provider-specific IDs', async () => {
      const provider = createMockProvider('stripe')
      processor.registerProvider('stripe', provider)

      const payment = await processor.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(payment.providerChargeId).toBeDefined()
      expect(payment.providerChargeId).toContain('provider_ch_')
    })

    it('should support switching providers mid-operation', async () => {
      const stripeProvider = createMockProvider('stripe')
      const paypalProvider = createMockProvider('paypal')

      processor.registerProvider('stripe', stripeProvider)
      processor.registerProvider('paypal', paypalProvider)

      // Create subscription with Stripe
      const sub = await processor.subscriptions.create({
        customerId: 'cust_123',
        priceId: 'price_xxx',
        billingCycle: 'monthly',
        provider: 'stripe',
      })

      // Process invoice with PayPal
      const invoice = await processor.invoices.create({
        customerId: 'cust_123',
        lineItems: [{ description: 'Add-on', amount: 5000 }],
        provider: 'paypal',
      })

      expect(sub.provider).toBe('stripe')
      expect(invoice.provider).toBe('paypal')
    })
  })

  // =============================================================================
  // Webhook Handler Tests
  // =============================================================================

  describe('webhook handling', () => {
    let processor: PaymentProcessor
    let mockProvider: PaymentProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should register webhook handler', () => {
      const handler = vi.fn()
      processor.onWebhook('payment.succeeded', handler)

      expect(processor.getWebhookHandlers('payment.succeeded')).toContain(handler)
    })

    it('should process webhook event', async () => {
      const handler = vi.fn()
      processor.onWebhook('payment.succeeded', handler)

      await processor.processWebhook({
        type: 'payment.succeeded',
        data: { paymentId: 'pay_123', amount: 9999 },
        provider: 'stripe',
      })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentId: 'pay_123',
          amount: 9999,
        })
      )
    })

    it('should handle subscription webhook events', async () => {
      const handler = vi.fn()
      processor.onWebhook('subscription.canceled', handler)

      await processor.processWebhook({
        type: 'subscription.canceled',
        data: { subscriptionId: 'sub_123' },
        provider: 'stripe',
      })

      expect(handler).toHaveBeenCalled()
    })
  })

  // =============================================================================
  // Error Handling Tests
  // =============================================================================

  describe('error handling', () => {
    let processor: PaymentProcessor
    let mockProvider: PaymentProvider

    beforeEach(() => {
      processor = createTestProcessor()
      mockProvider = createMockProvider('stripe')
      processor.registerProvider('stripe', mockProvider)
    })

    it('should throw when no provider registered', async () => {
      const emptyProcessor = createTestProcessor()

      await expect(
        emptyProcessor.charge({
          amount: 9999,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      ).rejects.toThrow('No payment provider registered')
    })

    it('should throw when getting non-existent payment', async () => {
      const result = await processor.getPayment('nonexistent')
      expect(result).toBeNull()
    })

    it('should throw when refunding non-existent payment', async () => {
      await expect(processor.refund('nonexistent')).rejects.toThrow('Payment not found')
    })

    it('should throw when capturing non-existent payment', async () => {
      await expect(processor.capture('nonexistent')).rejects.toThrow('Payment not found')
    })
  })
})
