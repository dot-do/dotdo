/**
 * Multi-Provider Failover Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ProviderFailover,
  createProviderFailover,
  createProvider,
  isDefaultRetryableError,
  type ProviderAdapter,
  type ProviderSendResult,
} from '../provider-failover'

// =============================================================================
// Test Types
// =============================================================================

interface TestPayload {
  message: string
  to: string
}

interface TestResult {
  messageId: string
  status: 'sent' | 'queued'
}

// =============================================================================
// Test Helpers
// =============================================================================

function createMockProvider(
  id: string,
  priority: number,
  options: {
    shouldFail?: boolean
    failCount?: number
    delay?: number
    healthCheckResult?: boolean
  } = {}
): ProviderAdapter<TestPayload, TestResult> {
  let callCount = 0
  const { shouldFail = false, failCount = Infinity, delay = 0, healthCheckResult = true } = options

  return {
    id,
    name: `Provider ${id}`,
    priority,
    weight: 1,
    send: vi.fn(async (_payload: TestPayload): Promise<TestResult> => {
      callCount++
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
      if (shouldFail && callCount <= failCount) {
        throw new Error(`Provider ${id} failed`)
      }
      return { messageId: `msg-${id}-${callCount}`, status: 'sent' }
    }),
    healthCheck: vi.fn(async () => healthCheckResult),
    isRetryableError: (error: Error) => error.message.includes('failed'),
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// =============================================================================
// Tests
// =============================================================================

describe('ProviderFailover', () => {
  describe('basic functionality', () => {
    it('should send through the primary provider', async () => {
      const provider1 = createMockProvider('provider1', 1)
      const provider2 = createMockProvider('provider2', 2)

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2],
      })

      const result = await failover.send({ message: 'Hello', to: '+15551234567' })

      expect(result.success).toBe(true)
      expect(result.providerId).toBe('provider1')
      expect(result.attemptsCount).toBe(1)
      expect(provider1.send).toHaveBeenCalledOnce()
      expect(provider2.send).not.toHaveBeenCalled()

      failover.destroy()
    })

    it('should respect provider priority', async () => {
      // Create providers with reversed order in array but different priorities
      const provider1 = createMockProvider('provider1', 3) // Lower priority
      const provider2 = createMockProvider('provider2', 1) // Highest priority
      const provider3 = createMockProvider('provider3', 2) // Middle priority

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2, provider3],
      })

      const result = await failover.send({ message: 'Hello', to: '+15551234567' })

      expect(result.success).toBe(true)
      expect(result.providerId).toBe('provider2') // Should use highest priority
      expect(provider2.send).toHaveBeenCalledOnce()
      expect(provider1.send).not.toHaveBeenCalled()
      expect(provider3.send).not.toHaveBeenCalled()

      failover.destroy()
    })
  })

  describe('failover behavior', () => {
    it('should failover to next provider on error', async () => {
      const provider1 = createMockProvider('provider1', 1, { shouldFail: true })
      const provider2 = createMockProvider('provider2', 2)

      const onFailover = vi.fn()

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2],
        onFailover,
      })

      const result = await failover.send({ message: 'Hello', to: '+15551234567' })

      expect(result.success).toBe(true)
      expect(result.providerId).toBe('provider2')
      expect(result.attemptsCount).toBe(2)
      expect(result.attemptedProviders).toEqual(['provider1', 'provider2'])
      expect(provider1.send).toHaveBeenCalledOnce()
      expect(provider2.send).toHaveBeenCalledOnce()
      expect(onFailover).toHaveBeenCalledWith('provider1', 'provider2')

      failover.destroy()
    })

    it('should try all providers before failing', async () => {
      const provider1 = createMockProvider('provider1', 1, { shouldFail: true })
      const provider2 = createMockProvider('provider2', 2, { shouldFail: true })
      const provider3 = createMockProvider('provider3', 3, { shouldFail: true })

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2, provider3],
      })

      const result = await failover.send({ message: 'Hello', to: '+15551234567' })

      expect(result.success).toBe(false)
      expect(result.attemptsCount).toBe(3)
      expect(result.attemptedProviders).toEqual(['provider1', 'provider2', 'provider3'])
      expect(result.error?.message).toBe('Provider provider3 failed')

      failover.destroy()
    })

    it('should respect maxAttempts configuration', async () => {
      const provider1 = createMockProvider('provider1', 1, { shouldFail: true })
      const provider2 = createMockProvider('provider2', 2, { shouldFail: true })
      const provider3 = createMockProvider('provider3', 3)

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2, provider3],
        maxAttempts: 2, // Only try first 2 providers
      })

      const result = await failover.send({ message: 'Hello', to: '+15551234567' })

      expect(result.success).toBe(false)
      expect(result.attemptsCount).toBe(2)
      expect(provider3.send).not.toHaveBeenCalled()

      failover.destroy()
    })

    it('should not failover when retryOnFail is false', async () => {
      const provider1 = createMockProvider('provider1', 1, { shouldFail: true })
      const provider2 = createMockProvider('provider2', 2)

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2],
        retryOnFail: false,
      })

      const result = await failover.send({ message: 'Hello', to: '+15551234567' })

      expect(result.success).toBe(false)
      expect(result.attemptsCount).toBe(1)
      expect(provider2.send).not.toHaveBeenCalled()

      failover.destroy()
    })
  })

  describe('circuit breaker', () => {
    it('should open circuit after threshold failures', async () => {
      const provider1 = createMockProvider('provider1', 1, { shouldFail: true })
      const provider2 = createMockProvider('provider2', 2)

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2],
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeout: 100,
        },
      })

      // First 3 calls should try provider1 (which fails) then failover to provider2
      for (let i = 0; i < 3; i++) {
        const result = await failover.send({ message: 'Hello', to: '+15551234567' })
        expect(result.success).toBe(true)
        expect(result.providerId).toBe('provider2')
      }

      // After 3 failures, provider1's circuit should be open
      const health = failover.getProviderHealth('provider1')
      expect(health?.circuitState).toBe('open')

      // Next call should skip provider1 entirely
      const result = await failover.send({ message: 'Hello', to: '+15551234567' })
      expect(result.providerId).toBe('provider2')
      expect(result.attemptsCount).toBe(1) // Only tried provider2

      failover.destroy()
    })

    it('should transition to half-open after reset timeout', async () => {
      vi.useFakeTimers()

      const provider1 = createMockProvider('provider1', 1, { shouldFail: true, failCount: 3 })
      const provider2 = createMockProvider('provider2', 2)

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2],
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeout: 100,
        },
      })

      // Trigger circuit open
      for (let i = 0; i < 3; i++) {
        await failover.send({ message: 'Hello', to: '+15551234567' })
      }

      let health = failover.getProviderHealth('provider1')
      expect(health?.circuitState).toBe('open')

      // Wait for reset timeout
      vi.advanceTimersByTime(150)

      health = failover.getProviderHealth('provider1')
      expect(health?.circuitState).toBe('half-open')

      vi.useRealTimers()
      failover.destroy()
    })
  })

  describe('health tracking', () => {
    it('should track provider health metrics', async () => {
      const provider1 = createMockProvider('provider1', 1)

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1],
      })

      // Send some successful messages
      for (let i = 0; i < 5; i++) {
        await failover.send({ message: 'Hello', to: '+15551234567' })
      }

      const health = failover.getProviderHealth('provider1')
      expect(health).not.toBeNull()
      expect(health?.totalRequests).toBe(5)
      expect(health?.failedRequests).toBe(0)
      expect(health?.successRate).toBe(1)
      expect(health?.status).toBe('healthy')

      failover.destroy()
    })

    it('should mark provider as degraded with low success rate', async () => {
      let failureIndex = 0
      const provider1: ProviderAdapter<TestPayload, TestResult> = {
        id: 'provider1',
        name: 'Provider 1',
        priority: 1,
        send: vi.fn(async () => {
          failureIndex++
          // Fail 15% of requests (should trigger degraded at 90% threshold)
          if (failureIndex % 6 === 0) {
            throw new Error('Temporary failure')
          }
          return { messageId: `msg-${failureIndex}`, status: 'sent' }
        }),
        isRetryableError: () => false,
      }

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1],
        retryOnFail: false,
      })

      // Send enough requests to establish a pattern
      for (let i = 0; i < 12; i++) {
        try {
          await failover.send({ message: 'Hello', to: '+15551234567' })
        } catch {
          // Expected failures
        }
      }

      const health = failover.getProviderHealth('provider1')
      expect(health?.successRate).toBeLessThan(0.9)
      expect(health?.status).toBe('degraded')

      failover.destroy()
    })

    it('should return overall stats', async () => {
      const provider1 = createMockProvider('provider1', 1)
      const provider2 = createMockProvider('provider2', 2)

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2],
      })

      for (let i = 0; i < 3; i++) {
        await failover.send({ message: 'Hello', to: '+15551234567' })
      }

      const stats = failover.getHealthStats()
      expect(stats.totalSends).toBe(3)
      expect(stats.successfulSends).toBe(3)
      expect(stats.failedSends).toBe(0)
      expect(stats.providers).toHaveLength(2)

      failover.destroy()
    })
  })

  describe('health checks', () => {
    it('should run periodic health checks', async () => {
      vi.useFakeTimers()

      const provider1 = createMockProvider('provider1', 1, { healthCheckResult: true })

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1],
        healthCheck: {
          interval: 100,
          timeout: 50,
        },
      })

      // Wait for initial health check + one interval
      await vi.advanceTimersByTimeAsync(150)

      expect(provider1.healthCheck).toHaveBeenCalled()

      const health = failover.getProviderHealth('provider1')
      expect(health?.healthCheckPassing).toBe(true)

      vi.useRealTimers()
      failover.destroy()
    })

    it('should mark provider unhealthy on failed health checks', async () => {
      vi.useFakeTimers()

      const provider1 = createMockProvider('provider1', 1, { healthCheckResult: false })

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1],
        healthCheck: {
          interval: 50,
          unhealthyThreshold: 3,
        },
      })

      // Wait for multiple health check intervals
      await vi.advanceTimersByTimeAsync(200)

      const health = failover.getProviderHealth('provider1')
      expect(health?.healthCheckPassing).toBe(false)

      vi.useRealTimers()
      failover.destroy()
    })
  })

  describe('sendVia', () => {
    it('should send through specific provider', async () => {
      const provider1 = createMockProvider('provider1', 1)
      const provider2 = createMockProvider('provider2', 2)

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2],
      })

      const result = await failover.sendVia('provider2', { message: 'Hello', to: '+15551234567' })

      expect(result.success).toBe(true)
      expect(result.providerId).toBe('provider2')
      expect(provider1.send).not.toHaveBeenCalled()
      expect(provider2.send).toHaveBeenCalledOnce()

      failover.destroy()
    })

    it('should fail if provider not found', async () => {
      const provider1 = createMockProvider('provider1', 1)

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1],
      })

      const result = await failover.sendVia('nonexistent', { message: 'Hello', to: '+15551234567' })

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('not found')

      failover.destroy()
    })

    it('should fail if provider is unavailable', async () => {
      const provider1 = createMockProvider('provider1', 1, { shouldFail: true })

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1],
        circuitBreaker: {
          failureThreshold: 1,
          resetTimeout: 10000,
        },
      })

      // Trigger circuit open
      await failover.send({ message: 'Hello', to: '+15551234567' })

      // Now try to send via that provider
      const result = await failover.sendVia('provider1', { message: 'Hello', to: '+15551234567' })

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('unavailable')

      failover.destroy()
    })
  })

  describe('dynamic provider management', () => {
    it('should add provider dynamically', async () => {
      const provider1 = createMockProvider('provider1', 2)

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1],
      })

      expect(failover.listProviders()).toEqual(['provider1'])

      // Add higher priority provider
      const provider2 = createMockProvider('provider2', 1)
      failover.addProvider(provider2)

      expect(failover.listProviders()).toContain('provider2')
      expect(failover.getPreferredProvider()?.id).toBe('provider2')

      failover.destroy()
    })

    it('should remove provider dynamically', async () => {
      const provider1 = createMockProvider('provider1', 1)
      const provider2 = createMockProvider('provider2', 2)

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2],
      })

      expect(failover.listProviders()).toHaveLength(2)

      const removed = failover.removeProvider('provider1')

      expect(removed).toBe(true)
      expect(failover.listProviders()).toEqual(['provider2'])

      failover.destroy()
    })

    it('should update provider priority', async () => {
      const provider1 = createMockProvider('provider1', 2)
      const provider2 = createMockProvider('provider2', 1)

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2],
      })

      expect(failover.getPreferredProvider()?.id).toBe('provider2')

      // Change priorities
      failover.setProviderPriority('provider1', 0) // Now highest priority

      expect(failover.getPreferredProvider()?.id).toBe('provider1')

      failover.destroy()
    })

    it('should manually set provider status', async () => {
      const provider1 = createMockProvider('provider1', 1)
      const provider2 = createMockProvider('provider2', 2)

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2],
      })

      expect(failover.getPreferredProvider()?.id).toBe('provider1')

      // Manually mark provider1 as unavailable
      failover.setProviderStatus('provider1', false)

      // Provider2 should now be preferred
      expect(failover.getPreferredProvider()?.id).toBe('provider2')

      failover.destroy()
    })
  })

  describe('callbacks', () => {
    it('should call onProviderFail callback', async () => {
      const provider1 = createMockProvider('provider1', 1, { shouldFail: true })
      const provider2 = createMockProvider('provider2', 2)

      const onProviderFail = vi.fn()

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2],
        onProviderFail,
      })

      await failover.send({ message: 'Hello', to: '+15551234567' })

      expect(onProviderFail).toHaveBeenCalledWith(
        'provider1',
        expect.any(Error)
      )

      failover.destroy()
    })

    it('should call onProviderRecover callback', async () => {
      vi.useFakeTimers()

      const provider1 = createMockProvider('provider1', 1, {
        shouldFail: true,
        failCount: 5,
        healthCheckResult: true,
      })
      const provider2 = createMockProvider('provider2', 2)

      const onProviderRecover = vi.fn()

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2],
        healthCheck: {
          interval: 50,
          unhealthyThreshold: 1,
        },
        onProviderRecover,
      })

      // Trigger failures to mark provider1 as unhealthy
      for (let i = 0; i < 5; i++) {
        await failover.send({ message: 'Hello', to: '+15551234567' })
      }

      const healthBefore = failover.getProviderHealth('provider1')
      expect(healthBefore?.status).toBe('unhealthy')

      // Wait for health checks (provider1 returns true for health check)
      await vi.advanceTimersByTimeAsync(200)

      expect(onProviderRecover).toHaveBeenCalledWith('provider1')

      vi.useRealTimers()
      failover.destroy()
    })
  })

  describe('timeout handling', () => {
    it('should timeout slow providers', async () => {
      const slowProvider = createMockProvider('slow', 1, { delay: 500 })
      const fastProvider = createMockProvider('fast', 2, { delay: 10 })

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [slowProvider, fastProvider],
        sendTimeout: 100, // 100ms timeout
      })

      const result = await failover.send({ message: 'Hello', to: '+15551234567' })

      expect(result.success).toBe(true)
      expect(result.providerId).toBe('fast') // Should have failed over to fast provider

      failover.destroy()
    })
  })

  describe('reset', () => {
    it('should reset all state', async () => {
      const provider1 = createMockProvider('provider1', 1, { shouldFail: true })
      const provider2 = createMockProvider('provider2', 2)

      const failover = createProviderFailover<TestPayload, TestResult>({
        providers: [provider1, provider2],
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeout: 10000,
        },
      })

      // Trigger some failures
      for (let i = 0; i < 3; i++) {
        await failover.send({ message: 'Hello', to: '+15551234567' })
      }

      let stats = failover.getHealthStats()
      expect(stats.totalSends).toBe(3)
      expect(stats.failoversTriggered).toBeGreaterThan(0)

      // Reset
      failover.reset()

      stats = failover.getHealthStats()
      expect(stats.totalSends).toBe(0)
      expect(stats.failoversTriggered).toBe(0)

      // Circuit should be closed again
      const health = failover.getProviderHealth('provider1')
      expect(health?.circuitState).toBe('closed')

      failover.destroy()
    })
  })
})

describe('createProvider helper', () => {
  it('should create a valid provider adapter', () => {
    const provider = createProvider<TestPayload, TestResult>({
      id: 'test',
      name: 'Test Provider',
      priority: 1,
      send: async (payload) => ({ messageId: 'test', status: 'sent' }),
    })

    expect(provider.id).toBe('test')
    expect(provider.name).toBe('Test Provider')
    expect(provider.priority).toBe(1)
    expect(provider.weight).toBe(1)
    expect(typeof provider.send).toBe('function')
  })
})

describe('isDefaultRetryableError', () => {
  it('should identify timeout errors as retryable', () => {
    expect(isDefaultRetryableError(new Error('Request timeout'))).toBe(true)
    expect(isDefaultRetryableError(new Error('Operation timed out'))).toBe(true)
  })

  it('should identify network errors as retryable', () => {
    expect(isDefaultRetryableError(new Error('Network error'))).toBe(true)
    expect(isDefaultRetryableError(new Error('ECONNREFUSED'))).toBe(true)
  })

  it('should identify server errors as retryable', () => {
    expect(isDefaultRetryableError(new Error('Server returned 500'))).toBe(true)
    expect(isDefaultRetryableError(new Error('502 Bad Gateway'))).toBe(true)
    expect(isDefaultRetryableError(new Error('503 Service Unavailable'))).toBe(true)
    expect(isDefaultRetryableError(new Error('504 Gateway Timeout'))).toBe(true)
  })

  it('should identify rate limit errors as retryable', () => {
    expect(isDefaultRetryableError(new Error('429 Too Many Requests'))).toBe(true)
    expect(isDefaultRetryableError(new Error('Rate limit exceeded'))).toBe(true)
  })

  it('should not identify client errors as retryable', () => {
    expect(isDefaultRetryableError(new Error('400 Bad Request'))).toBe(false)
    expect(isDefaultRetryableError(new Error('Invalid API key'))).toBe(false)
    expect(isDefaultRetryableError(new Error('Permission denied'))).toBe(false)
  })
})
