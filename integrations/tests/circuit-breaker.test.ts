/**
 * Tests for Circuit Breaker Integration
 *
 * @module @dotdo/integrations/tests/circuit-breaker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CircuitBreakerIntegration,
  IntegrationCircuitBreakerRegistry,
  createCircuitBreakerIntegration,
  createIntegrationCircuitBreakerRegistry,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from '../circuit-breaker'
import type { Integration, IntegrationConfig, IntegrationResult } from '../types'
import { successResult, errorResult } from '../registry'

// Mock integration for testing
interface MockConfig extends IntegrationConfig {
  apiKey: string
}

interface MockMethods {
  doSomething: (input: string) => Promise<IntegrationResult<string>>
  doSomethingElse: (value: number) => Promise<IntegrationResult<number>>
}

function createMockIntegration(options: {
  shouldFail?: boolean
  failCount?: number
  delay?: number
} = {}): Integration<MockConfig, MockMethods> {
  let callCount = 0
  const { shouldFail = false, failCount = Infinity, delay = 0 } = options

  return {
    name: 'mock-integration',
    version: '1.0.0',
    metadata: {
      displayName: 'Mock Integration',
      description: 'A mock integration for testing',
      category: 'other',
      requiredConfig: ['apiKey'],
    },
    status: 'ready',
    init: async () => {},
    shutdown: async () => {},
    healthCheck: async () => true,
    methods: {
      doSomething: async (input: string) => {
        callCount++
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
        if (shouldFail && callCount <= failCount) {
          throw new Error('Mock failure')
        }
        return successResult(`processed: ${input}`)
      },
      doSomethingElse: async (value: number) => {
        callCount++
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
        if (shouldFail && callCount <= failCount) {
          throw new Error('Mock failure')
        }
        return successResult(value * 2)
      },
    },
  }
}

describe('CircuitBreakerIntegration', () => {
  describe('initialization', () => {
    it('should wrap an integration with circuit breaker', () => {
      const mockIntegration = createMockIntegration()
      const wrapped = createCircuitBreakerIntegration(mockIntegration)

      expect(wrapped.name).toBe('mock-integration')
      expect(wrapped.version).toBe('1.0.0')
      expect(wrapped.status).toBe('ready')
      expect(wrapped.getCircuitState()).toBe('closed')
    })

    it('should use default configuration', () => {
      const mockIntegration = createMockIntegration()
      const wrapped = createCircuitBreakerIntegration(mockIntegration)

      const stats = wrapped.getCircuitStats()
      expect(stats.state).toBe('closed')
      expect(stats.totalRequests).toBe(0)
    })

    it('should accept custom configuration', () => {
      const mockIntegration = createMockIntegration()
      const onStateChange = vi.fn()
      const wrapped = createCircuitBreakerIntegration(mockIntegration, {
        failureThreshold: 3,
        resetTimeoutMs: 5000,
        onStateChange,
      })

      expect(wrapped.getCircuitState()).toBe('closed')
    })
  })

  describe('method execution', () => {
    it('should execute methods successfully', async () => {
      const mockIntegration = createMockIntegration()
      const wrapped = createCircuitBreakerIntegration(mockIntegration)

      const result = await wrapped.methods.doSomething('test')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe('processed: test')
      }
    })

    it('should track successful calls', async () => {
      const mockIntegration = createMockIntegration()
      const wrapped = createCircuitBreakerIntegration(mockIntegration)

      await wrapped.methods.doSomething('test')
      await wrapped.methods.doSomethingElse(5)

      const stats = wrapped.getCircuitStats()
      expect(stats.successCount).toBe(2)
      expect(stats.totalRequests).toBe(2)
    })

    it('should track failed calls', async () => {
      const mockIntegration = createMockIntegration({ shouldFail: true })
      const wrapped = createCircuitBreakerIntegration(mockIntegration, {
        failureThreshold: 10, // High threshold to prevent circuit from opening
      })

      const result = await wrapped.methods.doSomething('test')

      expect(result.success).toBe(false)

      const stats = wrapped.getCircuitStats()
      expect(stats.failureCount).toBe(1)
      expect(stats.consecutiveFailures).toBe(1)
    })
  })

  describe('circuit state transitions', () => {
    it('should open circuit after failure threshold', async () => {
      const mockIntegration = createMockIntegration({ shouldFail: true })
      const wrapped = createCircuitBreakerIntegration(mockIntegration, {
        failureThreshold: 3,
      })

      // Fail 3 times
      for (let i = 0; i < 3; i++) {
        await wrapped.methods.doSomething('test')
      }

      expect(wrapped.getCircuitState()).toBe('open')
    })

    it('should return circuit open error when open', async () => {
      const mockIntegration = createMockIntegration({ shouldFail: true })
      const wrapped = createCircuitBreakerIntegration(mockIntegration, {
        failureThreshold: 1,
      })

      // Open the circuit
      await wrapped.methods.doSomething('test')
      expect(wrapped.getCircuitState()).toBe('open')

      // Next call should be rejected
      const result = await wrapped.methods.doSomething('test')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('CIRCUIT_OPEN')
        expect(result.error.retryable).toBe(true)
      }

      const stats = wrapped.getCircuitStats()
      expect(stats.rejectedCount).toBe(1)
    })

    it('should transition to half-open after reset timeout', async () => {
      const mockIntegration = createMockIntegration({ shouldFail: true, failCount: 1 })
      const wrapped = createCircuitBreakerIntegration(mockIntegration, {
        failureThreshold: 1,
        resetTimeoutMs: 50, // Short timeout for testing
        halfOpenRequestRatio: 1.0, // Always allow in half-open for deterministic test
      })

      // Open the circuit
      await wrapped.methods.doSomething('test')
      expect(wrapped.getCircuitState()).toBe('open')

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 60))

      // Check state - should transition on next request check
      expect(wrapped.isCircuitAllowingRequests()).toBe(true)
      expect(wrapped.getCircuitState()).toBe('half_open')
    })

    it('should close circuit on successful recovery in half-open', async () => {
      const mockIntegration = createMockIntegration({ shouldFail: true, failCount: 1 })
      const wrapped = createCircuitBreakerIntegration(mockIntegration, {
        failureThreshold: 1,
        resetTimeoutMs: 50,
        successThreshold: 2,
        halfOpenRequestRatio: 1.0, // Always allow in half-open
      })

      // Open the circuit
      await wrapped.methods.doSomething('test')
      expect(wrapped.getCircuitState()).toBe('open')

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 60))

      // Successful calls in half-open
      await wrapped.methods.doSomething('test')
      await wrapped.methods.doSomething('test')

      expect(wrapped.getCircuitState()).toBe('closed')
    })
  })

  describe('manual circuit control', () => {
    it('should force open circuit', () => {
      const mockIntegration = createMockIntegration()
      const wrapped = createCircuitBreakerIntegration(mockIntegration)

      wrapped.forceCircuitOpen()

      expect(wrapped.getCircuitState()).toBe('open')
    })

    it('should force close circuit', async () => {
      const mockIntegration = createMockIntegration({ shouldFail: true })
      const wrapped = createCircuitBreakerIntegration(mockIntegration, {
        failureThreshold: 1,
      })

      // Open the circuit
      await wrapped.methods.doSomething('test')
      expect(wrapped.getCircuitState()).toBe('open')

      wrapped.forceCircuitClose()

      expect(wrapped.getCircuitState()).toBe('closed')
    })

    it('should reset circuit stats', async () => {
      const mockIntegration = createMockIntegration()
      const wrapped = createCircuitBreakerIntegration(mockIntegration)

      await wrapped.methods.doSomething('test')
      await wrapped.methods.doSomething('test')

      wrapped.resetCircuit()

      const stats = wrapped.getCircuitStats()
      expect(stats.totalRequests).toBe(0)
      expect(stats.successCount).toBe(0)
    })
  })

  describe('health check integration', () => {
    it('should return false when circuit is open', () => {
      const mockIntegration = createMockIntegration()
      const wrapped = createCircuitBreakerIntegration(mockIntegration)

      wrapped.forceCircuitOpen()

      expect(wrapped.isCircuitAllowingRequests()).toBe(false)
    })

    it('should return true when circuit is closed', () => {
      const mockIntegration = createMockIntegration()
      const wrapped = createCircuitBreakerIntegration(mockIntegration)

      expect(wrapped.isCircuitAllowingRequests()).toBe(true)
    })
  })

  describe('callbacks', () => {
    it('should call onStateChange when circuit opens', async () => {
      const onStateChange = vi.fn()
      const mockIntegration = createMockIntegration({ shouldFail: true })
      const wrapped = createCircuitBreakerIntegration(mockIntegration, {
        failureThreshold: 1,
        onStateChange,
      })

      await wrapped.methods.doSomething('test')

      expect(onStateChange).toHaveBeenCalledWith('mock-integration', 'closed', 'open')
    })

    it('should call onFailure on method failure', async () => {
      const onFailure = vi.fn()
      const mockIntegration = createMockIntegration({ shouldFail: true })
      const wrapped = createCircuitBreakerIntegration(mockIntegration, {
        failureThreshold: 10,
        onFailure,
      })

      await wrapped.methods.doSomething('test')

      expect(onFailure).toHaveBeenCalled()
      expect(onFailure.mock.calls[0][0]).toBe('mock-integration')
    })

    it('should call onSuccess on method success', async () => {
      const onSuccess = vi.fn()
      const mockIntegration = createMockIntegration()
      const wrapped = createCircuitBreakerIntegration(mockIntegration, {
        onSuccess,
      })

      await wrapped.methods.doSomething('test')

      expect(onSuccess).toHaveBeenCalled()
      expect(onSuccess.mock.calls[0][0]).toBe('mock-integration')
    })
  })

  describe('unwrapping', () => {
    it('should return unwrapped integration', () => {
      const mockIntegration = createMockIntegration()
      const wrapped = createCircuitBreakerIntegration(mockIntegration)

      const unwrapped = wrapped.getUnwrappedIntegration()

      expect(unwrapped).toBe(mockIntegration)
    })
  })
})

describe('IntegrationCircuitBreakerRegistry', () => {
  let registry: IntegrationCircuitBreakerRegistry

  beforeEach(() => {
    registry = createIntegrationCircuitBreakerRegistry({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    })
  })

  describe('wrapping integrations', () => {
    it('should wrap an integration', () => {
      const mockIntegration = createMockIntegration()
      const wrapped = registry.wrap(mockIntegration)

      expect(wrapped).toBeInstanceOf(CircuitBreakerIntegration)
      expect(registry.has('mock-integration')).toBe(true)
    })

    it('should get wrapped integration by name', () => {
      const mockIntegration = createMockIntegration()
      registry.wrap(mockIntegration)

      const retrieved = registry.get('mock-integration')

      expect(retrieved).toBeDefined()
      expect(retrieved?.name).toBe('mock-integration')
    })

    it('should return undefined for non-existent integration', () => {
      const retrieved = registry.get('non-existent')
      expect(retrieved).toBeUndefined()
    })

    it('should remove wrapped integration', () => {
      const mockIntegration = createMockIntegration()
      registry.wrap(mockIntegration)

      const removed = registry.remove('mock-integration')

      expect(removed).toBe(true)
      expect(registry.has('mock-integration')).toBe(false)
    })
  })

  describe('listing integrations', () => {
    it('should list all wrapped integration names', () => {
      registry.wrap(createMockIntegration())
      registry.wrap({ ...createMockIntegration(), name: 'another-integration' })

      const names = registry.getNames()

      expect(names).toContain('mock-integration')
      expect(names).toContain('another-integration')
    })
  })

  describe('circuit state queries', () => {
    it('should get integrations by circuit state', async () => {
      const healthy = createMockIntegration()
      const unhealthy = createMockIntegration({ shouldFail: true })
      unhealthy.name = 'unhealthy-integration'

      const wrappedHealthy = registry.wrap(healthy)
      const wrappedUnhealthy = registry.wrap(unhealthy, { failureThreshold: 1 })

      // Open circuit on unhealthy integration
      await wrappedUnhealthy.methods.doSomething('test')

      const openCircuits = registry.getByCircuitState('open')
      const closedCircuits = registry.getByCircuitState('closed')

      expect(openCircuits).toHaveLength(1)
      expect(openCircuits[0].name).toBe('unhealthy-integration')
      expect(closedCircuits).toHaveLength(1)
      expect(closedCircuits[0].name).toBe('mock-integration')
    })

    it('should get healthy integrations', () => {
      registry.wrap(createMockIntegration())

      const healthy = registry.getHealthyIntegrations()

      expect(healthy).toHaveLength(1)
    })

    it('should get unhealthy integrations', async () => {
      const mockIntegration = createMockIntegration({ shouldFail: true })
      const wrapped = registry.wrap(mockIntegration, { failureThreshold: 1 })

      await wrapped.methods.doSomething('test')

      const unhealthy = registry.getUnhealthyIntegrations()

      expect(unhealthy).toHaveLength(1)
    })
  })

  describe('bulk operations', () => {
    it('should get all circuit stats', async () => {
      const int1 = createMockIntegration()
      const int2 = { ...createMockIntegration(), name: 'int2' }

      const wrapped1 = registry.wrap(int1)
      const wrapped2 = registry.wrap(int2)

      await wrapped1.methods.doSomething('test')
      await wrapped2.methods.doSomething('test')
      await wrapped2.methods.doSomething('test')

      const allStats = registry.getAllCircuitStats()

      expect(allStats['mock-integration'].successCount).toBe(1)
      expect(allStats['int2'].successCount).toBe(2)
    })

    it('should reset all circuits', async () => {
      const int1 = createMockIntegration({ shouldFail: true })
      const int2 = { ...createMockIntegration({ shouldFail: true }), name: 'int2' }

      const wrapped1 = registry.wrap(int1, { failureThreshold: 1 })
      const wrapped2 = registry.wrap(int2, { failureThreshold: 1 })

      await wrapped1.methods.doSomething('test')
      await wrapped2.methods.doSomething('test')

      expect(wrapped1.getCircuitState()).toBe('open')
      expect(wrapped2.getCircuitState()).toBe('open')

      registry.resetAll()

      expect(wrapped1.getCircuitState()).toBe('closed')
      expect(wrapped2.getCircuitState()).toBe('closed')
    })

    it('should clear all wrapped integrations', () => {
      registry.wrap(createMockIntegration())
      registry.wrap({ ...createMockIntegration(), name: 'int2' })

      registry.clear()

      expect(registry.getNames()).toHaveLength(0)
    })
  })

  describe('health summary', () => {
    it('should return correct health summary', async () => {
      const healthy = createMockIntegration()
      const unhealthy = { ...createMockIntegration({ shouldFail: true }), name: 'unhealthy' }

      registry.wrap(healthy)
      const wrappedUnhealthy = registry.wrap(unhealthy, { failureThreshold: 1 })

      await wrappedUnhealthy.methods.doSomething('test')

      const summary = registry.getHealthSummary()

      expect(summary.total).toBe(2)
      expect(summary.healthy).toBe(1)
      expect(summary.unhealthy).toBe(1)
      expect(summary.recovering).toBe(0)
    })
  })
})

describe('Default Configuration', () => {
  it('should have reasonable defaults', () => {
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold).toBe(5)
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs).toBe(30000)
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.successThreshold).toBe(3)
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.timeoutMs).toBe(10000)
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.halfOpenRequestRatio).toBe(0.1)
  })
})
