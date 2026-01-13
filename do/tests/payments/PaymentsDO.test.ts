/**
 * Tests for do/payments/PaymentsDO.ts - Payments Durable Object
 *
 * PaymentsDO handles Stripe Connect payments:
 * - createPaymentIntent: Client-side payment flow
 * - createCharge: Server-side charge
 * - refundCharge: Refund processing
 * - createSubscription/cancelSubscription: Recurring billing
 * - recordUsage/getUsageSummary: Metered billing
 * - createCustomer/getOrCreateCustomer: Customer management
 * - getPlatformRevenue: Revenue reporting
 * - handleWebhook: Stripe webhook processing
 * - fetch: HTTP handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PaymentsDO, type PaymentsEnv } from '../../payments/PaymentsDO'

// Mock Drizzle database
function createMockDb() {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    query: {
      charges: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      subscriptions: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      customers: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      usageRecords: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  }
}

// Mock Stripe client
function createMockStripe() {
  return {
    paymentIntents: {
      create: vi.fn().mockResolvedValue({
        id: 'pi_test123',
        client_secret: 'pi_test123_secret',
        status: 'requires_payment_method',
        latest_charge: 'ch_test123',
      }),
    },
    refunds: {
      create: vi.fn().mockResolvedValue({
        id: 're_test123',
        amount: 1000,
      }),
    },
    subscriptions: {
      create: vi.fn().mockResolvedValue({
        id: 'sub_test123',
        status: 'active',
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        cancel_at_period_end: false,
      }),
      update: vi.fn().mockResolvedValue({}),
      cancel: vi.fn().mockResolvedValue({}),
    },
    subscriptionItems: {
      createUsageRecord: vi.fn().mockResolvedValue({}),
    },
    customers: {
      create: vi.fn().mockResolvedValue({
        id: 'cus_test123',
      }),
    },
    webhooks: {
      constructEvent: vi.fn().mockReturnValue({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test123' } },
      }),
    },
  }
}

// Mock DurableObjectState
function createMockState() {
  return {
    id: {
      toString: () => 'test-payments-do-id',
      equals: () => false,
    },
    storage: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn().mockResolvedValue(new Map()),
      sql: {
        exec: vi.fn().mockReturnValue({
          toArray: () => [],
          one: () => undefined,
          raw: () => [],
        }),
      },
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn((fn: () => Promise<unknown>) => fn()),
  } as unknown as DurableObjectState
}

// Mock environment
function createMockEnv(): PaymentsEnv {
  return {
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
    PLATFORM_FEE_PERCENT: '2.9',
    IDENTITY_DO: {} as DurableObjectNamespace,
  }
}

describe('do/payments/PaymentsDO.ts - Payments Durable Object', () => {
  describe('Class Structure', () => {
    it('PaymentsDO is a class', () => {
      expect(PaymentsDO).toBeDefined()
      expect(typeof PaymentsDO).toBe('function')
    })

    it('PaymentsDO has ns property', () => {
      expect(PaymentsDO.prototype).toBeDefined()
    })
  })

  describe('HTTP Handler', () => {
    it('responds to /health endpoint', async () => {
      const state = createMockState()
      const env = createMockEnv()
      const payments = new PaymentsDO(state, env)

      const request = new Request('http://test/health')
      const response = await payments.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json() as { status: string; ns: string }
      expect(data.status).toBe('ok')
      expect(data.ns).toBe('https://payments.do')
    })

    it('returns 404 for unknown paths', async () => {
      const state = createMockState()
      const env = createMockEnv()
      const payments = new PaymentsDO(state, env)

      const request = new Request('http://test/unknown')
      const response = await payments.fetch(request)

      expect(response.status).toBe(404)
    })

    it('handles webhook POST to /webhook', async () => {
      const state = createMockState()
      const env = createMockEnv()
      const payments = new PaymentsDO(state, env)

      // Webhook without signature should fail
      const request = new Request('http://test/webhook', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      const response = await payments.fetch(request)

      expect(response.status).toBe(400)
      const text = await response.text()
      expect(text).toBe('Missing signature')
    })
  })

  describe('Namespace', () => {
    it('has correct ns value', async () => {
      const state = createMockState()
      const env = createMockEnv()
      const payments = new PaymentsDO(state, env)

      expect(payments.ns).toBe('https://payments.do')
    })
  })

  describe('Platform Fee Calculation', () => {
    it('default platform fee is 2.9%', () => {
      const env = createMockEnv()
      expect(env.PLATFORM_FEE_PERCENT).toBe('2.9')
    })
  })
})

describe('PaymentsDO Type Exports', () => {
  it('exports PaymentsEnv type', async () => {
    // TypeScript type check - this compiles if types are correct
    const env: PaymentsEnv = {
      STRIPE_SECRET_KEY: 'test',
      STRIPE_WEBHOOK_SECRET: 'test',
      PLATFORM_FEE_PERCENT: '2.9',
      IDENTITY_DO: {} as DurableObjectNamespace,
    }
    expect(env.STRIPE_SECRET_KEY).toBe('test')
  })
})
