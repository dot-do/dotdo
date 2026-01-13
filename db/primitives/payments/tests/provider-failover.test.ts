/**
 * Provider Failover Tests
 *
 * Tests for multi-provider failover support:
 * - Circuit breaker pattern
 * - Health checks
 * - Automatic failover on failures
 * - Provider priority ordering
 * - Sliding window metrics
 *
 * @module db/primitives/payments/tests/provider-failover.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createChargeProviderFailover,
  type ChargeProviderFailover,
  type ProviderRegistration,
  type ChargeProvider,
  type ProviderChargeResult,
  type ChargeCreateOptions,
  type ChargeAuthorizeOptions,
  type ChargeCaptureOptions,
  type ChargeRefundOptions,
  type ProviderRefundResult,
  type Provider3DSecureResult,
  type Provider3DSecureConfirmResult,
} from '../provider-failover'

// =============================================================================
// Mock Provider Factory
// =============================================================================

function createMockProvider(
  name: string,
  options?: {
    chargeResult?: Partial<ProviderChargeResult>
    shouldFail?: boolean
    failCount?: number
    delayMs?: number
    healthCheckResult?: boolean
  }
): ChargeProvider & { callCount: number; resetCallCount: () => void } {
  let currentFailCount = 0
  let callCount = 0

  return {
    name,
    get callCount() {
      return callCount
    },
    resetCallCount() {
      callCount = 0
      currentFailCount = 0
    },

    async charge(_options: ChargeCreateOptions): Promise<ProviderChargeResult> {
      callCount++
      if (options?.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      }

      if (options?.shouldFail) {
        throw new Error(`${name} provider error`)
      }

      if (options?.failCount && currentFailCount < options.failCount) {
        currentFailCount++
        throw new Error(`${name} provider temporary error`)
      }

      return {
        providerChargeId: `${name}_ch_123`,
        status: 'succeeded',
        ...options?.chargeResult,
      }
    },

    async authorize(_options: ChargeAuthorizeOptions): Promise<ProviderChargeResult> {
      callCount++
      if (options?.shouldFail) {
        throw new Error(`${name} provider error`)
      }
      return {
        providerChargeId: `${name}_ch_auth_123`,
        status: 'requires_capture',
      }
    },

    async capture(_chargeId: string, _opts?: ChargeCaptureOptions): Promise<{ status: string }> {
      callCount++
      if (options?.shouldFail) {
        throw new Error(`${name} provider error`)
      }
      return { status: 'succeeded' }
    },

    async refund(_chargeId: string, _opts?: ChargeRefundOptions): Promise<ProviderRefundResult> {
      callCount++
      if (options?.shouldFail) {
        throw new Error(`${name} provider error`)
      }
      return {
        providerRefundId: `${name}_re_123`,
        status: 'succeeded',
      }
    },

    async void(_chargeId: string): Promise<{ status: string }> {
      callCount++
      if (options?.shouldFail) {
        throw new Error(`${name} provider error`)
      }
      return { status: 'canceled' }
    },

    async create3DSecureSession(_options: {
      chargeId: string
      amount: number
      currency: string
      returnUrl: string
    }): Promise<Provider3DSecureResult> {
      callCount++
      if (options?.shouldFail) {
        throw new Error(`${name} provider error`)
      }
      return {
        clientSecret: 'secret_123',
        redirectUrl: 'https://3ds.example.com',
        status: 'requires_action',
      }
    },

    async confirm3DSecure(_transactionId: string): Promise<Provider3DSecureConfirmResult> {
      callCount++
      if (options?.shouldFail) {
        throw new Error(`${name} provider error`)
      }
      return {
        status: 'succeeded',
        chargeStatus: 'succeeded',
      }
    },
  }
}

// =============================================================================
// Basic Functionality Tests
// =============================================================================

describe('ChargeProviderFailover', () => {
  let failover: ChargeProviderFailover

  afterEach(() => {
    failover?.destroy()
  })

  describe('basic operations', () => {
    it('should route to first available provider', async () => {
      const stripe = createMockProvider('stripe')
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        healthCheck: { enabled: false },
      })

      const result = await failover.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(result.success).toBe(true)
      expect(result.providerUsed).toBe('stripe')
      expect(stripe.callCount).toBe(1)
      expect(square.callCount).toBe(0)
    })

    it('should return provider result on success', async () => {
      const stripe = createMockProvider('stripe', {
        chargeResult: { providerChargeId: 'ch_stripe_abc' },
      })

      failover = createChargeProviderFailover({
        providers: [{ name: 'stripe', provider: stripe, priority: 1 }],
        healthCheck: { enabled: false },
      })

      const result = await failover.charge({
        amount: 5000,
        currency: 'EUR',
        customerId: 'cust_456',
        paymentMethodId: 'pm_yyy',
      })

      expect(result.success).toBe(true)
      expect(result.result?.providerChargeId).toBe('ch_stripe_abc')
      expect(result.attemptsCount).toBe(1)
      expect(result.failoverOccurred).toBe(false)
    })

    it('should list providers in priority order', () => {
      const stripe = createMockProvider('stripe')
      const square = createMockProvider('square')
      const paypal = createMockProvider('paypal')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'square', provider: square, priority: 2 },
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'paypal', provider: paypal, priority: 3 },
        ],
        healthCheck: { enabled: false },
      })

      const providers = failover.listProviders()
      expect(providers).toEqual(['stripe', 'square', 'paypal'])
    })
  })

  // =============================================================================
  // Failover Tests
  // =============================================================================

  describe('failover', () => {
    it('should failover to next provider on error', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        healthCheck: { enabled: false },
      })

      const result = await failover.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(result.success).toBe(true)
      expect(result.providerUsed).toBe('square')
      expect(result.failoverOccurred).toBe(true)
      expect(result.attemptsCount).toBe(2)
      expect(result.attemptedProviders).toEqual(['stripe', 'square'])
    })

    it('should try all providers before failing', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square', { shouldFail: true })
      const paypal = createMockProvider('paypal', { shouldFail: true })

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
          { name: 'paypal', provider: paypal, priority: 3 },
        ],
        healthCheck: { enabled: false },
      })

      const result = await failover.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(result.success).toBe(false)
      expect(result.attemptsCount).toBe(3)
      expect(result.attemptedProviders).toEqual(['stripe', 'square', 'paypal'])
      expect(result.error?.message).toContain('paypal provider error')
    })

    it('should respect maxAttempts config', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square', { shouldFail: true })
      const paypal = createMockProvider('paypal')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
          { name: 'paypal', provider: paypal, priority: 3 },
        ],
        maxAttempts: 2, // Only try 2 providers
        healthCheck: { enabled: false },
      })

      const result = await failover.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(result.success).toBe(false)
      expect(result.attemptsCount).toBe(2)
      expect(result.attemptedProviders).toEqual(['stripe', 'square'])
      expect(paypal.callCount).toBe(0)
    })

    it('should call onProviderSwitch callback on failover', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square')
      const onProviderSwitch = vi.fn()

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        onProviderSwitch,
        healthCheck: { enabled: false },
      })

      await failover.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(onProviderSwitch).toHaveBeenCalledWith('stripe', 'square', expect.any(String))
    })

    it('should call onProviderFail callback when provider fails', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square')
      const onProviderFail = vi.fn()

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        onProviderFail,
        healthCheck: { enabled: false },
      })

      await failover.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(onProviderFail).toHaveBeenCalledWith('stripe', expect.any(Error))
    })

    it('should call onAllProvidersFailed when all providers fail', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square', { shouldFail: true })
      const onAllProvidersFailed = vi.fn()

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        onAllProvidersFailed,
        healthCheck: { enabled: false },
      })

      await failover.charge({
        amount: 9999,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(onAllProvidersFailed).toHaveBeenCalledWith(expect.any(Map))
    })
  })

  // =============================================================================
  // Circuit Breaker Tests
  // =============================================================================

  describe('circuit breaker', () => {
    it('should open circuit after threshold failures', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeout: 30000,
        },
        healthCheck: { enabled: false },
      })

      // Trigger 3 failures to open circuit
      for (let i = 0; i < 3; i++) {
        await failover.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      }

      // Reset square call count
      square.resetCallCount()

      // Next call should skip stripe (circuit open) and go directly to square
      const result = await failover.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(result.success).toBe(true)
      expect(result.providerUsed).toBe('square')
      expect(result.attemptsCount).toBe(1) // Only square was tried
      expect(result.failoverOccurred).toBe(false) // No failover because stripe was skipped
    })

    it('should transition to half-open after reset timeout', async () => {
      vi.useFakeTimers()

      // Provider that fails first 3 times, then succeeds
      let callIndex = 0
      const stripeProvider: ChargeProvider = {
        name: 'stripe',
        async charge() {
          callIndex++
          if (callIndex <= 3) {
            throw new Error('stripe provider error')
          }
          return { providerChargeId: 'ch_stripe_123', status: 'succeeded' }
        },
        async authorize() { return { providerChargeId: 'ch_auth', status: 'requires_capture' } },
        async capture() { return { status: 'succeeded' } },
        async refund() { return { providerRefundId: 're_123', status: 'succeeded' } },
        async void() { return { status: 'canceled' } },
        async create3DSecureSession() { return { clientSecret: 's', redirectUrl: 'u', status: 'requires_action' } },
        async confirm3DSecure() { return { status: 'succeeded', chargeStatus: 'succeeded' } },
      }

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripeProvider, priority: 1 },
        ],
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeout: 30000,
        },
        maxAttempts: 1, // Only try one provider to isolate circuit breaker behavior
        healthCheck: { enabled: false },
      })

      // Trigger failures to open circuit
      for (let i = 0; i < 3; i++) {
        await failover.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      }

      // Verify circuit is open
      let metrics = failover.getProviderHealth('stripe')
      expect(metrics?.circuitState).toBe('open')

      // Advance past reset timeout
      vi.advanceTimersByTime(31000)

      // Circuit should now be half-open - verify via getProviderHealth
      metrics = failover.getProviderHealth('stripe')
      expect(metrics?.circuitState).toBe('half-open')

      // Next call should try stripe again (half-open) and succeed
      const result = await failover.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(result.success).toBe(true)
      expect(result.providerUsed).toBe('stripe')
      expect(callIndex).toBe(4) // Called 4 times total

      vi.useRealTimers()
    })

    it('should close circuit after success in half-open', async () => {
      vi.useFakeTimers()

      const stripe = createMockProvider('stripe', { failCount: 3 })

      failover = createChargeProviderFailover({
        providers: [{ name: 'stripe', provider: stripe, priority: 1 }],
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeout: 30000,
          successThreshold: 1,
        },
        healthCheck: { enabled: false },
      })

      // Trigger failures to open circuit
      for (let i = 0; i < 3; i++) {
        await failover.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        }).catch(() => {})
      }

      // Advance past reset timeout
      vi.advanceTimersByTime(31000)

      // Successful call closes circuit
      const result = await failover.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(result.success).toBe(true)

      // Check circuit is closed
      const metrics = failover.getProviderHealth('stripe')
      expect(metrics?.circuitState).toBe('closed')

      vi.useRealTimers()
    })

    it('should report circuit state in health metrics', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
        ],
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeout: 30000,
        },
        maxAttempts: 1, // Only try one provider to isolate circuit breaker behavior
        healthCheck: { enabled: false },
      })

      // Trigger failures
      for (let i = 0; i < 2; i++) {
        await failover.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      }

      const metrics = failover.getProviderHealth('stripe')
      expect(metrics?.circuitState).toBe('open')
    })
  })

  // =============================================================================
  // Health Metrics Tests
  // =============================================================================

  describe('health metrics', () => {
    it('should track success rate', async () => {
      // Create a provider that fails first 2 times then succeeds
      let callCount = 0
      const stripeProvider: ChargeProvider = {
        name: 'stripe',
        async charge() {
          callCount++
          if (callCount <= 2) {
            throw new Error('stripe provider error')
          }
          return { providerChargeId: 'ch_stripe_123', status: 'succeeded' }
        },
        async authorize() { return { providerChargeId: 'ch_auth', status: 'requires_capture' } },
        async capture() { return { status: 'succeeded' } },
        async refund() { return { providerRefundId: 're_123', status: 'succeeded' } },
        async void() { return { status: 'canceled' } },
        async create3DSecureSession() { return { clientSecret: 's', redirectUrl: 'u', status: 'requires_action' } },
        async confirm3DSecure() { return { status: 'succeeded', chargeStatus: 'succeeded' } },
      }

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripeProvider, priority: 1 },
        ],
        circuitBreaker: {
          failureThreshold: 10, // High threshold to avoid circuit opening
          resetTimeout: 30000,
        },
        maxAttempts: 1, // Only try one provider
        healthCheck: { enabled: false },
      })

      // 4 calls: 2 failures + 2 successes = 50% success rate
      for (let i = 0; i < 4; i++) {
        await failover.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      }

      const metrics = failover.getProviderHealth('stripe')
      expect(metrics?.totalRequests).toBe(4)
      expect(metrics?.failedRequests).toBe(2)
      expect(metrics?.successRate).toBe(0.5)
    })

    it('should track consecutive failures', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
        ],
        circuitBreaker: {
          failureThreshold: 10, // High threshold
          resetTimeout: 30000,
        },
        maxAttempts: 1, // Only try one provider
        healthCheck: { enabled: false },
      })

      // 3 consecutive failures
      for (let i = 0; i < 3; i++) {
        await failover.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      }

      const metrics = failover.getProviderHealth('stripe')
      expect(metrics?.consecutiveFailures).toBe(3)
    })

    it('should determine health status based on metrics', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        circuitBreaker: {
          failureThreshold: 10,
          resetTimeout: 30000,
        },
        healthCheck: { enabled: false },
      })

      // 5 consecutive failures should mark as unhealthy
      for (let i = 0; i < 5; i++) {
        await failover.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      }

      const metrics = failover.getProviderHealth('stripe')
      expect(metrics?.status).toBe('unhealthy')
    })

    it('should return overall stats', async () => {
      const stripe = createMockProvider('stripe', { failCount: 1 })
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        healthCheck: { enabled: false },
      })

      // 1 failure (triggers failover), then 2 successes
      await failover.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await failover.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      await failover.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      const stats = failover.getStats()
      expect(stats.totalOperations).toBe(3)
      expect(stats.successfulOperations).toBe(3)
      expect(stats.failedOperations).toBe(0)
      expect(stats.failoversTriggered).toBe(1)
      expect(stats.providers).toHaveLength(2)
    })
  })

  // =============================================================================
  // Health Check Tests
  // =============================================================================

  describe('health checks', () => {
    it('should run health checks at configured interval', async () => {
      vi.useFakeTimers()

      const healthCheck = vi.fn().mockResolvedValue(true)
      const stripe = createMockProvider('stripe')

      failover = createChargeProviderFailover({
        providers: [{ name: 'stripe', provider: stripe, priority: 1, healthCheck }],
        healthCheck: {
          enabled: true,
          interval: 5000,
        },
      })

      // Initial health check runs immediately
      await vi.advanceTimersByTimeAsync(0)
      expect(healthCheck).toHaveBeenCalledTimes(1)

      // Advance to next interval
      await vi.advanceTimersByTimeAsync(5000)
      expect(healthCheck).toHaveBeenCalledTimes(2)

      // Advance again
      await vi.advanceTimersByTimeAsync(5000)
      expect(healthCheck).toHaveBeenCalledTimes(3)

      vi.useRealTimers()
    })

    it('should call onProviderRecover when provider recovers', async () => {
      vi.useFakeTimers()

      let healthCheckResult = false
      const healthCheck = vi.fn().mockImplementation(() => Promise.resolve(healthCheckResult))
      const onProviderRecover = vi.fn()

      const stripe = createMockProvider('stripe', { shouldFail: true })

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1, healthCheck },
        ],
        circuitBreaker: {
          failureThreshold: 10, // High threshold
          resetTimeout: 30000,
        },
        maxAttempts: 1,
        healthCheck: {
          enabled: true,
          interval: 5000,
          unhealthyThreshold: 1, // Mark unhealthy after 1 failed health check
        },
        onProviderRecover,
      })

      // Initial health check (failing)
      await vi.advanceTimersByTimeAsync(0)

      // Trigger 5 consecutive failures to make it unhealthy
      for (let i = 0; i < 5; i++) {
        await failover.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      }

      // Verify it's unhealthy
      let metrics = failover.getProviderHealth('stripe')
      expect(metrics?.status).toBe('unhealthy')

      // Now health check passes - provider should recover
      healthCheckResult = true
      await vi.advanceTimersByTimeAsync(5000)

      expect(onProviderRecover).toHaveBeenCalledWith('stripe')

      vi.useRealTimers()
    })

    it('should mark provider unhealthy after consecutive health check failures', async () => {
      vi.useFakeTimers()

      const healthCheck = vi.fn().mockRejectedValue(new Error('Health check failed'))
      const stripe = createMockProvider('stripe')

      failover = createChargeProviderFailover({
        providers: [{ name: 'stripe', provider: stripe, priority: 1, healthCheck }],
        healthCheck: {
          enabled: true,
          interval: 1000,
          unhealthyThreshold: 3,
        },
      })

      // Run 3 failed health checks
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(1000)
      }

      const metrics = failover.getProviderHealth('stripe')
      expect(metrics?.healthCheckPassing).toBe(false)

      vi.useRealTimers()
    })
  })

  // =============================================================================
  // Provider Management Tests
  // =============================================================================

  describe('provider management', () => {
    it('should add provider dynamically', async () => {
      const stripe = createMockProvider('stripe')

      failover = createChargeProviderFailover({
        providers: [{ name: 'stripe', provider: stripe, priority: 1 }],
        healthCheck: { enabled: false },
      })

      expect(failover.listProviders()).toEqual(['stripe'])

      const square = createMockProvider('square')
      failover.addProvider({ name: 'square', provider: square, priority: 2 })

      expect(failover.listProviders()).toEqual(['stripe', 'square'])
    })

    it('should throw when adding duplicate provider', () => {
      const stripe = createMockProvider('stripe')

      failover = createChargeProviderFailover({
        providers: [{ name: 'stripe', provider: stripe, priority: 1 }],
        healthCheck: { enabled: false },
      })

      expect(() =>
        failover.addProvider({ name: 'stripe', provider: stripe, priority: 2 })
      ).toThrow('Provider already exists: stripe')
    })

    it('should remove provider dynamically', () => {
      const stripe = createMockProvider('stripe')
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        healthCheck: { enabled: false },
      })

      const removed = failover.removeProvider('stripe')

      expect(removed).toBe(true)
      expect(failover.listProviders()).toEqual(['square'])
    })

    it('should return false when removing non-existent provider', () => {
      const stripe = createMockProvider('stripe')

      failover = createChargeProviderFailover({
        providers: [{ name: 'stripe', provider: stripe, priority: 1 }],
        healthCheck: { enabled: false },
      })

      const removed = failover.removeProvider('paypal')
      expect(removed).toBe(false)
    })

    it('should manually set provider status', async () => {
      const stripe = createMockProvider('stripe')
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        healthCheck: { enabled: false },
      })

      // Force stripe unavailable
      failover.setProviderStatus('stripe', false)

      // Should use square
      const result = await failover.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(result.providerUsed).toBe('square')
    })

    it('should reset all provider states', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeout: 30000,
        },
        healthCheck: { enabled: false },
      })

      // Open circuit
      for (let i = 0; i < 2; i++) {
        await failover.charge({
          amount: 1000,
          currency: 'USD',
          customerId: 'cust_123',
          paymentMethodId: 'pm_xxx',
        })
      }

      // Reset all
      failover.reset()

      const stats = failover.getStats()
      expect(stats.totalOperations).toBe(0)
      expect(stats.failoversTriggered).toBe(0)

      const metrics = failover.getProviderHealth('stripe')
      expect(metrics?.circuitState).toBe('closed')
    })

    it('should get preferred provider', () => {
      const stripe = createMockProvider('stripe')
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        healthCheck: { enabled: false },
      })

      const preferred = failover.getPreferredProvider()
      expect(preferred?.name).toBe('stripe')
    })
  })

  // =============================================================================
  // Operation Timeout Tests
  // =============================================================================

  describe('operation timeout', () => {
    it('should timeout slow operations and failover', async () => {
      const stripe = createMockProvider('stripe', { delayMs: 100 })
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        operationTimeout: 50, // 50ms timeout
        healthCheck: { enabled: false },
      })

      const result = await failover.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(result.success).toBe(true)
      expect(result.providerUsed).toBe('square')
      expect(result.failoverOccurred).toBe(true)
    })
  })

  // =============================================================================
  // Retryable Error Tests
  // =============================================================================

  describe('retryable errors', () => {
    it('should not failover for non-retryable errors', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          {
            name: 'stripe',
            provider: stripe,
            priority: 1,
            isRetryableError: () => false, // All errors are non-retryable
          },
          { name: 'square', provider: square, priority: 2 },
        ],
        healthCheck: { enabled: false },
      })

      const result = await failover.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(result.success).toBe(false)
      expect(result.attemptsCount).toBe(1)
      expect(square.callCount).toBe(0) // Square was not tried
    })

    it('should use custom retryable error classifier', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          {
            name: 'stripe',
            provider: stripe,
            priority: 1,
            isRetryableError: (error) => error.message.includes('temporary'),
          },
          { name: 'square', provider: square, priority: 2 },
        ],
        healthCheck: { enabled: false },
      })

      const result = await failover.charge({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      // Error message is "stripe provider error" which doesn't include "temporary"
      expect(result.success).toBe(false)
      expect(result.attemptsCount).toBe(1)
    })
  })

  // =============================================================================
  // Other Operations Tests
  // =============================================================================

  describe('other operations', () => {
    it('should support authorize operation with failover', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        healthCheck: { enabled: false },
      })

      const result = await failover.authorize({
        amount: 1000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethodId: 'pm_xxx',
      })

      expect(result.success).toBe(true)
      expect(result.providerUsed).toBe('square')
    })

    it('should support refund operation with failover', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        healthCheck: { enabled: false },
      })

      const result = await failover.refund('ch_123')

      expect(result.success).toBe(true)
      expect(result.providerUsed).toBe('square')
    })

    it('should support void operation with failover', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        healthCheck: { enabled: false },
      })

      const result = await failover.void('ch_123')

      expect(result.success).toBe(true)
      expect(result.providerUsed).toBe('square')
    })

    it('should support capture operation with failover', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        healthCheck: { enabled: false },
      })

      const result = await failover.capture('ch_123')

      expect(result.success).toBe(true)
      expect(result.providerUsed).toBe('square')
    })

    it('should support 3D Secure operations with failover', async () => {
      const stripe = createMockProvider('stripe', { shouldFail: true })
      const square = createMockProvider('square')

      failover = createChargeProviderFailover({
        providers: [
          { name: 'stripe', provider: stripe, priority: 1 },
          { name: 'square', provider: square, priority: 2 },
        ],
        healthCheck: { enabled: false },
      })

      const sessionResult = await failover.create3DSecureSession({
        chargeId: 'ch_123',
        amount: 1000,
        currency: 'USD',
        returnUrl: 'https://example.com/return',
      })

      expect(sessionResult.success).toBe(true)
      expect(sessionResult.providerUsed).toBe('square')

      const confirmResult = await failover.confirm3DSecure('txn_123')

      expect(confirmResult.success).toBe(true)
    })
  })
})
