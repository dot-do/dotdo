/**
 * FinanceAPI Integration Tests - TDD Red Phase
 *
 * Tests for FinanceAPI which wraps FinancialClient (StripeProvider).
 *
 * Since we can't hit real Stripe API in tests, we use mocks for the Stripe provider.
 * However, we test that FinanceAPI properly delegates to the provider.
 *
 * @module business/tests/finance.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FinancialClient, SaaSMetrics } from '@dotdo/finance'

// ============================================================================
// MOCK STRIPE PROVIDER
// ============================================================================

/**
 * Create a mock FinancialClient for testing FinanceAPI delegation
 */
function createMockFinancialClient(): FinancialClient {
  return {
    customers: {
      create: vi.fn().mockResolvedValue({
        id: 'cus_mock123',
        email: 'test@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      get: vi.fn().mockResolvedValue({
        id: 'cus_mock123',
        email: 'test@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: vi.fn().mockResolvedValue({
        id: 'cus_mock123',
        email: 'updated@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({
        data: [],
        hasMore: false,
      }),
    },
    subscriptions: {
      create: vi.fn().mockResolvedValue({
        id: 'sub_mock123',
        customerId: 'cus_mock123',
        status: 'active',
        priceId: 'price_mock',
        productId: 'prod_mock',
        quantity: 1,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      get: vi.fn().mockResolvedValue({
        id: 'sub_mock123',
        customerId: 'cus_mock123',
        status: 'active',
        priceId: 'price_mock',
        productId: 'prod_mock',
        quantity: 1,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: vi.fn().mockResolvedValue({
        id: 'sub_mock123',
        customerId: 'cus_mock123',
        status: 'active',
        priceId: 'price_mock',
        productId: 'prod_mock',
        quantity: 2,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      cancel: vi.fn().mockResolvedValue({
        id: 'sub_mock123',
        customerId: 'cus_mock123',
        status: 'canceled',
        priceId: 'price_mock',
        productId: 'prod_mock',
        quantity: 1,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      list: vi.fn().mockResolvedValue({
        data: [],
        hasMore: false,
      }),
    },
    invoices: {
      create: vi.fn().mockResolvedValue({
        id: 'inv_mock123',
        customerId: 'cus_mock123',
        status: 'draft',
        currency: 'usd',
        amountDue: 1000,
        amountPaid: 0,
        amountRemaining: 1000,
        subtotal: 1000,
        total: 1000,
        createdAt: new Date(),
      }),
      get: vi.fn().mockResolvedValue({
        id: 'inv_mock123',
        customerId: 'cus_mock123',
        status: 'paid',
        currency: 'usd',
        amountDue: 1000,
        amountPaid: 1000,
        amountRemaining: 0,
        subtotal: 1000,
        total: 1000,
        createdAt: new Date(),
      }),
      list: vi.fn().mockResolvedValue({
        data: [],
        hasMore: false,
      }),
      pay: vi.fn().mockResolvedValue({
        id: 'inv_mock123',
        customerId: 'cus_mock123',
        status: 'paid',
        currency: 'usd',
        amountDue: 1000,
        amountPaid: 1000,
        amountRemaining: 0,
        subtotal: 1000,
        total: 1000,
        createdAt: new Date(),
      }),
      finalize: vi.fn().mockResolvedValue({
        id: 'inv_mock123',
        customerId: 'cus_mock123',
        status: 'open',
        currency: 'usd',
        amountDue: 1000,
        amountPaid: 0,
        amountRemaining: 1000,
        subtotal: 1000,
        total: 1000,
        createdAt: new Date(),
      }),
      void: vi.fn().mockResolvedValue({
        id: 'inv_mock123',
        customerId: 'cus_mock123',
        status: 'void',
        currency: 'usd',
        amountDue: 0,
        amountPaid: 0,
        amountRemaining: 0,
        subtotal: 1000,
        total: 1000,
        createdAt: new Date(),
      }),
    },
    payments: {
      create: vi.fn().mockResolvedValue({
        id: 'pi_mock123',
        amount: 1000,
        currency: 'usd',
        status: 'succeeded',
        createdAt: new Date(),
      }),
      get: vi.fn().mockResolvedValue({
        id: 'pi_mock123',
        amount: 1000,
        currency: 'usd',
        status: 'succeeded',
        createdAt: new Date(),
      }),
      list: vi.fn().mockResolvedValue({
        data: [],
        hasMore: false,
      }),
      refund: vi.fn().mockResolvedValue({
        id: 'pi_mock123',
        amount: 1000,
        currency: 'usd',
        status: 'succeeded',
        createdAt: new Date(),
      }),
    },
    metrics: {
      getMRR: vi.fn().mockResolvedValue(10000),
      getARR: vi.fn().mockResolvedValue(120000),
      getSaaSMetrics: vi.fn().mockResolvedValue({
        mrr: 10000,
        arr: 120000,
        activeSubscriptions: 50,
        totalCustomers: 100,
        currency: 'usd',
        calculatedAt: new Date(),
      } as SaaSMetrics),
      getMRRBreakdown: vi.fn().mockRejectedValue(new Error('Not implemented')),
    },
    webhooks: {
      handleWebhook: vi.fn().mockResolvedValue({
        id: 'evt_mock123',
        type: 'customer.created',
        data: {},
        createdAt: new Date(),
        livemode: false,
      }),
      on: vi.fn(),
      off: vi.fn(),
    },
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * FinanceAPI config expected by Business class
 */
interface FinanceConfig {
  enabled?: boolean
  stripeApiKey?: string
  webhookSecret?: string
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('FinanceAPI (do-e71b.6)', () => {
  describe('FinanceAPI initialization', () => {
    it('should throw when accessing customers without Stripe configured', async () => {
      // Import the real FinanceAPI from business.ts
      const { FinanceAPI } = await import('../business')

      // Create without config
      const financeApi = new (FinanceAPI as any)(null, {})

      // Should throw because Stripe is not configured
      expect(() => financeApi.customers).toThrow(/Stripe.*not configured/i)
    })

    it('should initialize StripeProvider when stripeApiKey is provided', async () => {
      const { FinanceAPI } = await import('../business')

      // Create with Stripe config
      const config: FinanceConfig = {
        enabled: true,
        stripeApiKey: 'sk_test_mock_key_12345',
      }

      const financeApi = new (FinanceAPI as any)(null, config)

      // Should have a provider initialized - accessing customers should not throw
      expect(() => financeApi.customers).not.toThrow()
    })
  })

  describe('FinancialClient interface methods', () => {
    it('should have customers property with CRUD methods', async () => {
      const { FinanceAPI } = await import('../business')

      const config: FinanceConfig = {
        enabled: true,
        stripeApiKey: 'sk_test_mock_key_12345',
      }

      const financeApi = new (FinanceAPI as any)(null, config)
      const customers = financeApi.customers

      // Verify interface methods exist
      expect(typeof customers.create).toBe('function')
      expect(typeof customers.get).toBe('function')
      expect(typeof customers.update).toBe('function')
      expect(typeof customers.delete).toBe('function')
      expect(typeof customers.list).toBe('function')
    })

    it('should have subscriptions property with CRUD methods', async () => {
      const { FinanceAPI } = await import('../business')

      const config: FinanceConfig = {
        enabled: true,
        stripeApiKey: 'sk_test_mock_key_12345',
      }

      const financeApi = new (FinanceAPI as any)(null, config)
      const subscriptions = financeApi.subscriptions

      // Verify interface methods exist
      expect(typeof subscriptions.create).toBe('function')
      expect(typeof subscriptions.get).toBe('function')
      expect(typeof subscriptions.update).toBe('function')
      expect(typeof subscriptions.cancel).toBe('function')
      expect(typeof subscriptions.list).toBe('function')
    })

    it('should have invoices property with methods', async () => {
      const { FinanceAPI } = await import('../business')

      const config: FinanceConfig = {
        enabled: true,
        stripeApiKey: 'sk_test_mock_key_12345',
      }

      const financeApi = new (FinanceAPI as any)(null, config)
      const invoices = financeApi.invoices

      // Verify interface methods exist
      expect(typeof invoices.create).toBe('function')
      expect(typeof invoices.get).toBe('function')
      expect(typeof invoices.list).toBe('function')
      expect(typeof invoices.pay).toBe('function')
      expect(typeof invoices.finalize).toBe('function')
      expect(typeof invoices.void).toBe('function')
    })

    it('should have payments property with methods', async () => {
      const { FinanceAPI } = await import('../business')

      const config: FinanceConfig = {
        enabled: true,
        stripeApiKey: 'sk_test_mock_key_12345',
      }

      const financeApi = new (FinanceAPI as any)(null, config)
      const payments = financeApi.payments

      // Verify interface methods exist
      expect(typeof payments.create).toBe('function')
      expect(typeof payments.get).toBe('function')
      expect(typeof payments.list).toBe('function')
      expect(typeof payments.refund).toBe('function')
    })

    it('should have metrics property with methods', async () => {
      const { FinanceAPI } = await import('../business')

      const config: FinanceConfig = {
        enabled: true,
        stripeApiKey: 'sk_test_mock_key_12345',
      }

      const financeApi = new (FinanceAPI as any)(null, config)
      const metrics = financeApi.metrics

      // Verify interface methods exist
      expect(typeof metrics.getMRR).toBe('function')
      expect(typeof metrics.getARR).toBe('function')
      expect(typeof metrics.getSaaSMetrics).toBe('function')
    })
  })

  describe('FinanceAPI delegation to provider', () => {
    it('should delegate customers.create to provider', async () => {
      const { FinanceAPIWithProvider } = await import('../business')
      const mockClient = createMockFinancialClient()

      const financeApi = new (FinanceAPIWithProvider as any)(null, {}, mockClient)

      const result = await financeApi.customers.create({ email: 'test@example.com' })

      expect(mockClient.customers.create).toHaveBeenCalledWith({ email: 'test@example.com' })
      expect(result.id).toBe('cus_mock123')
    })

    it('should delegate subscriptions.create to provider', async () => {
      const { FinanceAPIWithProvider } = await import('../business')
      const mockClient = createMockFinancialClient()

      const financeApi = new (FinanceAPIWithProvider as any)(null, {}, mockClient)

      const input = { customerId: 'cus_mock123', priceId: 'price_mock' }
      const result = await financeApi.subscriptions.create(input)

      expect(mockClient.subscriptions.create).toHaveBeenCalledWith(input)
      expect(result.id).toBe('sub_mock123')
      expect(result.status).toBe('active')
    })

    it('should delegate metrics.getMRR to provider', async () => {
      const { FinanceAPIWithProvider } = await import('../business')
      const mockClient = createMockFinancialClient()

      const financeApi = new (FinanceAPIWithProvider as any)(null, {}, mockClient)

      const mrr = await financeApi.metrics.getMRR()

      expect(mockClient.metrics.getMRR).toHaveBeenCalled()
      expect(mrr).toBe(10000)
    })
  })

  describe('getSaaSMetrics()', () => {
    it('should return proper SaaSMetrics structure', async () => {
      const { FinanceAPIWithProvider } = await import('../business')
      const mockClient = createMockFinancialClient()

      const financeApi = new (FinanceAPIWithProvider as any)(null, {}, mockClient)

      const metrics = await financeApi.metrics.getSaaSMetrics()

      // Verify structure
      expect(metrics).toHaveProperty('mrr')
      expect(metrics).toHaveProperty('arr')
      expect(metrics).toHaveProperty('activeSubscriptions')
      expect(metrics).toHaveProperty('totalCustomers')
      expect(metrics).toHaveProperty('currency')
      expect(metrics).toHaveProperty('calculatedAt')

      // Verify values
      expect(metrics.mrr).toBe(10000)
      expect(metrics.arr).toBe(120000)
      expect(metrics.activeSubscriptions).toBe(50)
      expect(metrics.totalCustomers).toBe(100)
      expect(metrics.currency).toBe('usd')
      expect(metrics.calculatedAt).toBeInstanceOf(Date)
    })

    it('should throw when Stripe is not configured', async () => {
      const { FinanceAPI } = await import('../business')

      const financeApi = new (FinanceAPI as any)(null, {})

      // Should throw because Stripe is not configured
      expect(() => financeApi.metrics).toThrow(/Stripe.*not configured/i)
    })
  })

  describe('Error handling', () => {
    it('should propagate errors from provider', async () => {
      const { FinanceAPIWithProvider } = await import('../business')
      const mockClient = createMockFinancialClient()

      // Make the mock reject
      ;(mockClient.customers.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Customer not found')
      )

      const financeApi = new (FinanceAPIWithProvider as any)(null, {}, mockClient)

      await expect(financeApi.customers.get('nonexistent')).rejects.toThrow('Customer not found')
    })

    it('should handle webhook secret configuration', async () => {
      const { FinanceAPI } = await import('../business')

      const config: FinanceConfig = {
        enabled: true,
        stripeApiKey: 'sk_test_mock_key_12345',
        webhookSecret: 'whsec_mock_secret',
      }

      const financeApi = new (FinanceAPI as any)(null, config)

      // Should have webhooks property
      expect(financeApi.webhooks).toBeDefined()
      expect(typeof financeApi.webhooks.handleWebhook).toBe('function')
      expect(typeof financeApi.webhooks.on).toBe('function')
      expect(typeof financeApi.webhooks.off).toBe('function')
    })
  })
})
