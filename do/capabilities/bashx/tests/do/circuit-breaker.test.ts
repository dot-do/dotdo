/**
 * Circuit Breaker Tests - RED Phase (TDD)
 *
 * Tests for circuit breaker pattern to protect tier failover.
 * These tests are written BEFORE implementation and should all fail.
 *
 * Circuit Breaker Pattern:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failures exceeded threshold, requests fail fast
 * - HALF-OPEN: After cooldown, allow one test request
 *
 * @module tests/do/circuit-breaker
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerEvent,
  createCircuitBreaker,
} from '../../src/do/circuit-breaker.js'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock service that can be configured to succeed or fail
 */
function createMockService() {
  const service = {
    call: vi.fn<[], Promise<string>>(),
    succeedNext: () => {
      service.call.mockResolvedValueOnce('success')
    },
    failNext: (error: Error = new Error('Service failed')) => {
      service.call.mockRejectedValueOnce(error)
    },
    succeedAlways: () => {
      service.call.mockResolvedValue('success')
    },
    failAlways: (error: Error = new Error('Service failed')) => {
      service.call.mockRejectedValue(error)
    },
  }
  return service
}

/**
 * Create default circuit breaker config for tests
 */
function createTestConfig(overrides: Partial<CircuitBreakerConfig> = {}): CircuitBreakerConfig {
  return {
    failureThreshold: 3,
    cooldownPeriodMs: 1000,
    halfOpenSuccessThreshold: 1,
    name: 'test-circuit',
    ...overrides,
  }
}

/**
 * Advance time for testing timeouts/cooldowns
 */
function advanceTime(ms: number) {
  vi.advanceTimersByTime(ms)
}

// ============================================================================
// CIRCUIT BREAKER STATE TESTS
// ============================================================================

describe('CircuitBreaker - State Management', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Initial State', () => {
    it('starts in CLOSED state', () => {
      const breaker = createCircuitBreaker(createTestConfig())
      expect(breaker.getState()).toBe(CircuitState.CLOSED)
    })

    it('has zero failure count initially', () => {
      const breaker = createCircuitBreaker(createTestConfig())
      expect(breaker.getFailureCount()).toBe(0)
    })

    it('has zero success count initially', () => {
      const breaker = createCircuitBreaker(createTestConfig())
      expect(breaker.getSuccessCount()).toBe(0)
    })

    it('is not tripped initially', () => {
      const breaker = createCircuitBreaker(createTestConfig())
      expect(breaker.isTripped()).toBe(false)
    })
  })

  describe('CLOSED State Behavior', () => {
    it('allows requests to pass through in CLOSED state', async () => {
      const service = createMockService()
      service.succeedNext()

      const breaker = createCircuitBreaker(createTestConfig())
      const result = await breaker.execute(() => service.call())

      expect(result).toBe('success')
      expect(service.call).toHaveBeenCalledOnce()
    })

    it('increments failure count on failure in CLOSED state', async () => {
      const service = createMockService()
      service.failNext()

      const breaker = createCircuitBreaker(createTestConfig())

      await expect(breaker.execute(() => service.call())).rejects.toThrow('Service failed')
      expect(breaker.getFailureCount()).toBe(1)
    })

    it('resets failure count on success in CLOSED state', async () => {
      const service = createMockService()

      const breaker = createCircuitBreaker(createTestConfig())

      // Cause some failures
      service.failNext()
      await expect(breaker.execute(() => service.call())).rejects.toThrow()
      expect(breaker.getFailureCount()).toBe(1)

      // Now succeed
      service.succeedNext()
      await breaker.execute(() => service.call())

      expect(breaker.getFailureCount()).toBe(0)
    })

    it('stays CLOSED when failures are below threshold', async () => {
      const service = createMockService()
      const breaker = createCircuitBreaker(createTestConfig({ failureThreshold: 3 }))

      // Two failures, threshold is 3
      service.failNext()
      await expect(breaker.execute(() => service.call())).rejects.toThrow()
      service.failNext()
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      expect(breaker.getState()).toBe(CircuitState.CLOSED)
      expect(breaker.getFailureCount()).toBe(2)
    })
  })

  describe('Transition to OPEN State', () => {
    it('transitions to OPEN when failure threshold is reached', async () => {
      const service = createMockService()
      service.failAlways()

      const breaker = createCircuitBreaker(createTestConfig({ failureThreshold: 3 }))

      // Trigger 3 failures
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(() => service.call())).rejects.toThrow()
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN)
      expect(breaker.isTripped()).toBe(true)
    })

    it('records the time when circuit was opened', async () => {
      const service = createMockService()
      service.failAlways()

      const breaker = createCircuitBreaker(createTestConfig({ failureThreshold: 1 }))

      const beforeOpen = Date.now()
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      const openedAt = breaker.getOpenedAt()
      expect(openedAt).toBeDefined()
      expect(openedAt).toBeGreaterThanOrEqual(beforeOpen)
    })
  })

  describe('OPEN State Behavior', () => {
    it('fails fast without calling service in OPEN state', async () => {
      const service = createMockService()
      service.failAlways()

      const breaker = createCircuitBreaker(createTestConfig({ failureThreshold: 1 }))

      // Trip the circuit
      await expect(breaker.execute(() => service.call())).rejects.toThrow()
      expect(breaker.getState()).toBe(CircuitState.OPEN)

      // Clear mock call count
      service.call.mockClear()

      // Should fail fast without calling service
      await expect(breaker.execute(() => service.call())).rejects.toThrow('Circuit breaker is OPEN')
      expect(service.call).not.toHaveBeenCalled()
    })

    it('throws CircuitOpenError when circuit is open', async () => {
      const service = createMockService()
      service.failAlways()

      const breaker = createCircuitBreaker(createTestConfig({ failureThreshold: 1 }))

      // Trip the circuit
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      // Should throw specific error type
      await expect(breaker.execute(() => service.call())).rejects.toMatchObject({
        name: 'CircuitOpenError',
        circuit: 'test-circuit',
      })
    })

    it('stays OPEN during cooldown period', async () => {
      const service = createMockService()
      service.failAlways()

      const breaker = createCircuitBreaker(createTestConfig({
        failureThreshold: 1,
        cooldownPeriodMs: 1000,
      }))

      // Trip the circuit
      await expect(breaker.execute(() => service.call())).rejects.toThrow()
      expect(breaker.getState()).toBe(CircuitState.OPEN)

      // Advance time but stay within cooldown
      advanceTime(500)

      expect(breaker.getState()).toBe(CircuitState.OPEN)
    })
  })

  describe('Transition to HALF-OPEN State', () => {
    it('transitions to HALF-OPEN after cooldown period expires', async () => {
      const service = createMockService()
      service.failAlways()

      const breaker = createCircuitBreaker(createTestConfig({
        failureThreshold: 1,
        cooldownPeriodMs: 1000,
      }))

      // Trip the circuit
      await expect(breaker.execute(() => service.call())).rejects.toThrow()
      expect(breaker.getState()).toBe(CircuitState.OPEN)

      // Advance past cooldown
      advanceTime(1001)

      // The state check should trigger transition
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN)
    })

    it('allows exactly one test request in HALF-OPEN state', async () => {
      const service = createMockService()
      service.failNext()

      const breaker = createCircuitBreaker(createTestConfig({
        failureThreshold: 1,
        cooldownPeriodMs: 1000,
      }))

      // Trip the circuit
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      // Advance past cooldown
      advanceTime(1001)

      // Configure service for the test
      service.succeedNext()
      service.call.mockClear()

      // First request should go through
      const result = await breaker.execute(() => service.call())
      expect(result).toBe('success')
      expect(service.call).toHaveBeenCalledOnce()
    })
  })

  describe('HALF-OPEN State Behavior', () => {
    it('transitions to CLOSED on success in HALF-OPEN state', async () => {
      const service = createMockService()
      service.failNext()

      const breaker = createCircuitBreaker(createTestConfig({
        failureThreshold: 1,
        cooldownPeriodMs: 1000,
        halfOpenSuccessThreshold: 1,
      }))

      // Trip the circuit
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      // Advance past cooldown
      advanceTime(1001)

      // Succeed in half-open
      service.succeedNext()
      await breaker.execute(() => service.call())

      expect(breaker.getState()).toBe(CircuitState.CLOSED)
      expect(breaker.isTripped()).toBe(false)
    })

    it('transitions back to OPEN on failure in HALF-OPEN state', async () => {
      const service = createMockService()
      service.failAlways()

      const breaker = createCircuitBreaker(createTestConfig({
        failureThreshold: 1,
        cooldownPeriodMs: 1000,
      }))

      // Trip the circuit
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      // Advance past cooldown
      advanceTime(1001)
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN)

      // Fail in half-open
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      expect(breaker.getState()).toBe(CircuitState.OPEN)
    })

    it('resets failure count on transition to CLOSED', async () => {
      const service = createMockService()
      service.failNext()

      const breaker = createCircuitBreaker(createTestConfig({
        failureThreshold: 1,
        cooldownPeriodMs: 1000,
      }))

      // Trip the circuit
      await expect(breaker.execute(() => service.call())).rejects.toThrow()
      expect(breaker.getFailureCount()).toBe(1)

      // Advance past cooldown and succeed
      advanceTime(1001)
      service.succeedNext()
      await breaker.execute(() => service.call())

      expect(breaker.getFailureCount()).toBe(0)
    })

    it('requires multiple successes when halfOpenSuccessThreshold > 1', async () => {
      const service = createMockService()
      service.failNext()

      const breaker = createCircuitBreaker(createTestConfig({
        failureThreshold: 1,
        cooldownPeriodMs: 1000,
        halfOpenSuccessThreshold: 3,
      }))

      // Trip the circuit
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      // Advance past cooldown
      advanceTime(1001)
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN)

      // First two successes - should stay in HALF-OPEN
      service.succeedNext()
      await breaker.execute(() => service.call())
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN)

      service.succeedNext()
      await breaker.execute(() => service.call())
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN)

      // Third success - should transition to CLOSED
      service.succeedNext()
      await breaker.execute(() => service.call())
      expect(breaker.getState()).toBe(CircuitState.CLOSED)
    })
  })
})

// ============================================================================
// CIRCUIT BREAKER CONFIGURATION TESTS
// ============================================================================

describe('CircuitBreaker - Configuration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Failure Threshold', () => {
    it('uses default failure threshold of 5 when not specified', () => {
      const breaker = createCircuitBreaker({ name: 'default-test' })
      expect(breaker.getConfig().failureThreshold).toBe(5)
    })

    it('respects custom failure threshold', async () => {
      const service = createMockService()
      service.failAlways()

      const breaker = createCircuitBreaker(createTestConfig({ failureThreshold: 10 }))

      // 9 failures should not trip
      for (let i = 0; i < 9; i++) {
        await expect(breaker.execute(() => service.call())).rejects.toThrow()
      }
      expect(breaker.getState()).toBe(CircuitState.CLOSED)

      // 10th failure should trip
      await expect(breaker.execute(() => service.call())).rejects.toThrow()
      expect(breaker.getState()).toBe(CircuitState.OPEN)
    })

    it('validates that failure threshold must be positive', () => {
      expect(() => createCircuitBreaker(createTestConfig({ failureThreshold: 0 }))).toThrow()
      expect(() => createCircuitBreaker(createTestConfig({ failureThreshold: -1 }))).toThrow()
    })
  })

  describe('Cooldown Period', () => {
    it('uses default cooldown period of 30 seconds when not specified', () => {
      const breaker = createCircuitBreaker({ name: 'default-test' })
      expect(breaker.getConfig().cooldownPeriodMs).toBe(30000)
    })

    it('respects custom cooldown period', async () => {
      const service = createMockService()
      service.failNext()

      const breaker = createCircuitBreaker(createTestConfig({
        failureThreshold: 1,
        cooldownPeriodMs: 5000,
      }))

      // Trip the circuit
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      // After 4.9 seconds, still OPEN
      advanceTime(4900)
      expect(breaker.getState()).toBe(CircuitState.OPEN)

      // After 5 seconds, HALF-OPEN
      advanceTime(101)
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN)
    })

    it('validates that cooldown period must be positive', () => {
      expect(() => createCircuitBreaker(createTestConfig({ cooldownPeriodMs: 0 }))).toThrow()
      expect(() => createCircuitBreaker(createTestConfig({ cooldownPeriodMs: -1 }))).toThrow()
    })
  })

  describe('Half-Open Success Threshold', () => {
    it('uses default half-open success threshold of 1 when not specified', () => {
      const breaker = createCircuitBreaker({ name: 'default-test' })
      expect(breaker.getConfig().halfOpenSuccessThreshold).toBe(1)
    })

    it('validates that half-open success threshold must be positive', () => {
      expect(() => createCircuitBreaker(createTestConfig({ halfOpenSuccessThreshold: 0 }))).toThrow()
      expect(() => createCircuitBreaker(createTestConfig({ halfOpenSuccessThreshold: -1 }))).toThrow()
    })
  })

  describe('Circuit Name', () => {
    it('requires a name for identification', () => {
      expect(() => createCircuitBreaker({} as CircuitBreakerConfig)).toThrow()
    })

    it('includes name in error messages', async () => {
      const service = createMockService()
      service.failNext()

      const breaker = createCircuitBreaker(createTestConfig({
        name: 'rpc-tier-2',
        failureThreshold: 1,
      }))

      // Trip the circuit
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      // Error should include circuit name
      await expect(breaker.execute(() => service.call())).rejects.toThrow(/rpc-tier-2/)
    })
  })
})

// ============================================================================
// CIRCUIT BREAKER EVENTS/METRICS TESTS
// ============================================================================

describe('CircuitBreaker - Events and Metrics', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Event Emission', () => {
    it('emits STATE_CHANGE event on CLOSED -> OPEN transition', async () => {
      const service = createMockService()
      service.failAlways()

      const breaker = createCircuitBreaker(createTestConfig({ failureThreshold: 1 }))
      const eventHandler = vi.fn()
      breaker.on('stateChange', eventHandler)

      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      expect(eventHandler).toHaveBeenCalledWith({
        type: 'stateChange',
        circuit: 'test-circuit',
        from: CircuitState.CLOSED,
        to: CircuitState.OPEN,
        timestamp: expect.any(Number),
      })
    })

    it('emits STATE_CHANGE event on OPEN -> HALF_OPEN transition', async () => {
      const service = createMockService()
      service.failNext()

      const breaker = createCircuitBreaker(createTestConfig({
        failureThreshold: 1,
        cooldownPeriodMs: 1000,
      }))
      const eventHandler = vi.fn()
      breaker.on('stateChange', eventHandler)

      // Trip the circuit
      await expect(breaker.execute(() => service.call())).rejects.toThrow()
      eventHandler.mockClear()

      // Advance past cooldown and trigger state check
      advanceTime(1001)
      breaker.getState() // This triggers the transition

      expect(eventHandler).toHaveBeenCalledWith({
        type: 'stateChange',
        circuit: 'test-circuit',
        from: CircuitState.OPEN,
        to: CircuitState.HALF_OPEN,
        timestamp: expect.any(Number),
      })
    })

    it('emits STATE_CHANGE event on HALF_OPEN -> CLOSED transition', async () => {
      const service = createMockService()
      service.failNext()

      const breaker = createCircuitBreaker(createTestConfig({
        failureThreshold: 1,
        cooldownPeriodMs: 1000,
      }))
      const eventHandler = vi.fn()
      breaker.on('stateChange', eventHandler)

      // Trip the circuit and recover
      await expect(breaker.execute(() => service.call())).rejects.toThrow()
      advanceTime(1001)
      eventHandler.mockClear()

      service.succeedNext()
      await breaker.execute(() => service.call())

      expect(eventHandler).toHaveBeenCalledWith({
        type: 'stateChange',
        circuit: 'test-circuit',
        from: CircuitState.HALF_OPEN,
        to: CircuitState.CLOSED,
        timestamp: expect.any(Number),
      })
    })

    it('emits FAILURE event on each failure', async () => {
      const service = createMockService()
      const testError = new Error('Test failure')
      service.failNext(testError)

      const breaker = createCircuitBreaker(createTestConfig({ failureThreshold: 5 }))
      const eventHandler = vi.fn()
      breaker.on('failure', eventHandler)

      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      expect(eventHandler).toHaveBeenCalledWith({
        type: 'failure',
        circuit: 'test-circuit',
        error: testError,
        failureCount: 1,
        timestamp: expect.any(Number),
      })
    })

    it('emits SUCCESS event on each success', async () => {
      const service = createMockService()
      service.succeedNext()

      const breaker = createCircuitBreaker(createTestConfig())
      const eventHandler = vi.fn()
      breaker.on('success', eventHandler)

      await breaker.execute(() => service.call())

      expect(eventHandler).toHaveBeenCalledWith({
        type: 'success',
        circuit: 'test-circuit',
        successCount: 1,
        timestamp: expect.any(Number),
      })
    })

    it('emits REJECTED event when circuit is open', async () => {
      const service = createMockService()
      service.failAlways()

      const breaker = createCircuitBreaker(createTestConfig({ failureThreshold: 1 }))
      const eventHandler = vi.fn()
      breaker.on('rejected', eventHandler)

      // Trip the circuit
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      // Now rejected
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      expect(eventHandler).toHaveBeenCalledWith({
        type: 'rejected',
        circuit: 'test-circuit',
        state: CircuitState.OPEN,
        timestamp: expect.any(Number),
      })
    })

    it('supports multiple event listeners', async () => {
      const service = createMockService()
      service.succeedNext()

      const breaker = createCircuitBreaker(createTestConfig())
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      breaker.on('success', handler1)
      breaker.on('success', handler2)

      await breaker.execute(() => service.call())

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('supports removing event listeners', async () => {
      const service = createMockService()
      service.succeedNext()
      service.succeedNext()

      const breaker = createCircuitBreaker(createTestConfig())
      const handler = vi.fn()
      breaker.on('success', handler)

      await breaker.execute(() => service.call())
      expect(handler).toHaveBeenCalledTimes(1)

      breaker.off('success', handler)
      await breaker.execute(() => service.call())
      expect(handler).toHaveBeenCalledTimes(1) // Not called again
    })
  })

  describe('Metrics', () => {
    it('tracks total request count', async () => {
      const service = createMockService()
      service.succeedAlways()

      const breaker = createCircuitBreaker(createTestConfig())

      await breaker.execute(() => service.call())
      await breaker.execute(() => service.call())
      await breaker.execute(() => service.call())

      const metrics = breaker.getMetrics()
      expect(metrics.totalRequests).toBe(3)
    })

    it('tracks successful request count', async () => {
      const service = createMockService()

      const breaker = createCircuitBreaker(createTestConfig())

      service.succeedNext()
      await breaker.execute(() => service.call())

      service.succeedNext()
      await breaker.execute(() => service.call())

      service.failNext()
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      const metrics = breaker.getMetrics()
      expect(metrics.successfulRequests).toBe(2)
    })

    it('tracks failed request count', async () => {
      const service = createMockService()

      const breaker = createCircuitBreaker(createTestConfig())

      service.succeedNext()
      await breaker.execute(() => service.call())

      service.failNext()
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      service.failNext()
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      const metrics = breaker.getMetrics()
      expect(metrics.failedRequests).toBe(2)
    })

    it('tracks rejected request count (circuit open)', async () => {
      const service = createMockService()
      service.failAlways()

      const breaker = createCircuitBreaker(createTestConfig({ failureThreshold: 1 }))

      // Trip the circuit
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      // These should be rejected
      await expect(breaker.execute(() => service.call())).rejects.toThrow()
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      const metrics = breaker.getMetrics()
      expect(metrics.rejectedRequests).toBe(2)
    })

    it('calculates failure rate', async () => {
      const service = createMockService()

      const breaker = createCircuitBreaker(createTestConfig())

      // 6 successes, 4 failures = 40% failure rate
      for (let i = 0; i < 6; i++) {
        service.succeedNext()
        await breaker.execute(() => service.call())
      }
      for (let i = 0; i < 4; i++) {
        service.failNext()
        await expect(breaker.execute(() => service.call())).rejects.toThrow()
      }

      const metrics = breaker.getMetrics()
      expect(metrics.failureRate).toBeCloseTo(0.4, 2)
    })

    it('tracks time spent in each state', async () => {
      const service = createMockService()
      service.failAlways()

      const breaker = createCircuitBreaker(createTestConfig({
        failureThreshold: 1,
        cooldownPeriodMs: 1000,
      }))

      // Start in CLOSED
      advanceTime(500)

      // Trip to OPEN
      await expect(breaker.execute(() => service.call())).rejects.toThrow()

      // Stay in OPEN
      advanceTime(1500)

      // Check metrics
      const metrics = breaker.getMetrics()
      expect(metrics.timeInClosed).toBeGreaterThanOrEqual(500)
      expect(metrics.timeInOpen).toBeGreaterThanOrEqual(1000)
    })

    it('can reset metrics', async () => {
      const service = createMockService()
      service.succeedNext()

      const breaker = createCircuitBreaker(createTestConfig())

      await breaker.execute(() => service.call())
      expect(breaker.getMetrics().totalRequests).toBe(1)

      breaker.resetMetrics()

      expect(breaker.getMetrics().totalRequests).toBe(0)
      expect(breaker.getMetrics().successfulRequests).toBe(0)
      expect(breaker.getMetrics().failedRequests).toBe(0)
    })
  })
})

// ============================================================================
// CIRCUIT BREAKER MANUAL CONTROL TESTS
// ============================================================================

describe('CircuitBreaker - Manual Control', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows manual trip of circuit', async () => {
    const service = createMockService()
    service.succeedAlways()

    const breaker = createCircuitBreaker(createTestConfig())

    // Circuit is CLOSED
    expect(breaker.getState()).toBe(CircuitState.CLOSED)

    // Manually trip
    breaker.trip()

    expect(breaker.getState()).toBe(CircuitState.OPEN)
    expect(breaker.isTripped()).toBe(true)

    // Requests should be rejected
    await expect(breaker.execute(() => service.call())).rejects.toThrow('Circuit breaker is OPEN')
  })

  it('allows manual reset of circuit', async () => {
    const service = createMockService()
    service.failAlways()

    const breaker = createCircuitBreaker(createTestConfig({ failureThreshold: 1 }))

    // Trip the circuit
    await expect(breaker.execute(() => service.call())).rejects.toThrow()
    expect(breaker.getState()).toBe(CircuitState.OPEN)

    // Manually reset
    breaker.reset()

    expect(breaker.getState()).toBe(CircuitState.CLOSED)
    expect(breaker.isTripped()).toBe(false)
    expect(breaker.getFailureCount()).toBe(0)
  })

  it('allows forcing circuit to half-open', async () => {
    const service = createMockService()
    service.failNext()

    const breaker = createCircuitBreaker(createTestConfig({
      failureThreshold: 1,
      cooldownPeriodMs: 60000, // Long cooldown
    }))

    // Trip the circuit
    await expect(breaker.execute(() => service.call())).rejects.toThrow()
    expect(breaker.getState()).toBe(CircuitState.OPEN)

    // Force to half-open without waiting for cooldown
    breaker.forceHalfOpen()

    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN)
  })
})

// ============================================================================
// CIRCUIT BREAKER SLIDING WINDOW TESTS
// ============================================================================

describe('CircuitBreaker - Sliding Window', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('supports time-based sliding window for failure counting', async () => {
    const service = createMockService()

    const breaker = createCircuitBreaker(createTestConfig({
      failureThreshold: 3,
      windowType: 'time',
      windowSizeMs: 5000, // 5 second window
    }))

    // Fail twice
    service.failNext()
    await expect(breaker.execute(() => service.call())).rejects.toThrow()
    service.failNext()
    await expect(breaker.execute(() => service.call())).rejects.toThrow()

    expect(breaker.getFailureCount()).toBe(2)

    // Advance time so first failure falls out of window
    advanceTime(6000)

    // Failure count should have decreased
    service.failNext()
    await expect(breaker.execute(() => service.call())).rejects.toThrow()

    // Should still be CLOSED because only recent failures count
    expect(breaker.getState()).toBe(CircuitState.CLOSED)
    expect(breaker.getFailureCount()).toBe(2) // Only the recent two failures
  })

  it('supports count-based sliding window for failure counting', async () => {
    const service = createMockService()

    const breaker = createCircuitBreaker(createTestConfig({
      failureThreshold: 3,
      windowType: 'count',
      windowSize: 5, // Last 5 requests
    }))

    // Mix of successes and failures
    service.failNext()
    await expect(breaker.execute(() => service.call())).rejects.toThrow()
    service.succeedNext()
    await breaker.execute(() => service.call())
    service.failNext()
    await expect(breaker.execute(() => service.call())).rejects.toThrow()
    service.succeedNext()
    await breaker.execute(() => service.call())
    service.failNext()
    await expect(breaker.execute(() => service.call())).rejects.toThrow()

    expect(breaker.getState()).toBe(CircuitState.OPEN) // 3 failures in last 5

    // Reset and try again with different pattern
    breaker.reset()

    // 4 successes, 1 failure in window
    service.succeedNext()
    await breaker.execute(() => service.call())
    service.succeedNext()
    await breaker.execute(() => service.call())
    service.succeedNext()
    await breaker.execute(() => service.call())
    service.succeedNext()
    await breaker.execute(() => service.call())
    service.failNext()
    await expect(breaker.execute(() => service.call())).rejects.toThrow()

    expect(breaker.getState()).toBe(CircuitState.CLOSED) // Only 1 failure in window
  })
})

// ============================================================================
// CIRCUIT BREAKER TIERED EXECUTOR INTEGRATION TESTS
// ============================================================================

describe('CircuitBreaker - TieredExecutor Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('can be used to wrap tier execution', async () => {
    const rpcService = createMockService()
    rpcService.failAlways()

    const breaker = createCircuitBreaker(createTestConfig({
      name: 'tier-2-rpc',
      failureThreshold: 2,
      cooldownPeriodMs: 5000,
    }))

    // Simulate RPC tier failures
    await expect(breaker.execute(() => rpcService.call())).rejects.toThrow()
    await expect(breaker.execute(() => rpcService.call())).rejects.toThrow()

    // Circuit is now open
    expect(breaker.getState()).toBe(CircuitState.OPEN)

    // Further calls fail fast
    await expect(breaker.execute(() => rpcService.call())).rejects.toThrow('Circuit breaker is OPEN')

    // After cooldown, allow test request
    advanceTime(5001)
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN)
  })

  it('provides isAvailable() check for tier routing', async () => {
    const service = createMockService()
    service.failAlways()

    const breaker = createCircuitBreaker(createTestConfig({ failureThreshold: 1 }))

    // Initially available
    expect(breaker.isAvailable()).toBe(true)

    // Trip the circuit
    await expect(breaker.execute(() => service.call())).rejects.toThrow()

    // No longer available
    expect(breaker.isAvailable()).toBe(false)
  })

  it('provides getRemainingCooldown() for status reporting', async () => {
    const service = createMockService()
    service.failNext()

    const breaker = createCircuitBreaker(createTestConfig({
      failureThreshold: 1,
      cooldownPeriodMs: 10000,
    }))

    // Initially no cooldown
    expect(breaker.getRemainingCooldown()).toBe(0)

    // Trip the circuit
    await expect(breaker.execute(() => service.call())).rejects.toThrow()

    // Should report remaining cooldown
    expect(breaker.getRemainingCooldown()).toBeCloseTo(10000, -2)

    advanceTime(3000)
    expect(breaker.getRemainingCooldown()).toBeCloseTo(7000, -2)
  })
})

// ============================================================================
// CIRCUIT BREAKER ERROR HANDLING TESTS
// ============================================================================

describe('CircuitBreaker - Error Handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Error Classification', () => {
    it('can be configured to ignore certain errors', async () => {
      const service = createMockService()

      const breaker = createCircuitBreaker(createTestConfig({
        failureThreshold: 1,
        isFailure: (error) => {
          // Don't count 404s as failures
          if (error instanceof Error && error.message.includes('404')) {
            return false
          }
          return true
        },
      }))

      // 404 should not count
      service.failNext(new Error('HTTP 404 Not Found'))
      await expect(breaker.execute(() => service.call())).rejects.toThrow()
      expect(breaker.getState()).toBe(CircuitState.CLOSED)

      // 500 should count
      service.failNext(new Error('HTTP 500 Server Error'))
      await expect(breaker.execute(() => service.call())).rejects.toThrow()
      expect(breaker.getState()).toBe(CircuitState.OPEN)
    })

    it('counts all errors by default', async () => {
      const service = createMockService()

      const breaker = createCircuitBreaker(createTestConfig({ failureThreshold: 1 }))

      service.failNext(new Error('Any error'))
      await expect(breaker.execute(() => service.call())).rejects.toThrow()
      expect(breaker.getState()).toBe(CircuitState.OPEN)
    })
  })

  describe('Timeout Handling', () => {
    it('counts timeout as failure', async () => {
      const breaker = createCircuitBreaker(createTestConfig({
        failureThreshold: 1,
        timeout: 100,
      }))

      const slowService = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200))
        return 'success'
      }

      // Should timeout and count as failure
      const promise = breaker.execute(slowService)
      advanceTime(150)
      await expect(promise).rejects.toThrow(/timeout/i)

      expect(breaker.getState()).toBe(CircuitState.OPEN)
    })

    it('does not timeout successful fast requests', async () => {
      const breaker = createCircuitBreaker(createTestConfig({
        timeout: 1000,
      }))

      const fastService = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return 'success'
      }

      const promise = breaker.execute(fastService)
      advanceTime(15)
      const result = await promise

      expect(result).toBe('success')
    })
  })
})

// ============================================================================
// CIRCUIT BREAKER SERIALIZATION TESTS
// ============================================================================

describe('CircuitBreaker - Serialization', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('can export state for persistence', async () => {
    const service = createMockService()
    service.failAlways()

    const breaker = createCircuitBreaker(createTestConfig({
      failureThreshold: 2,
      cooldownPeriodMs: 5000,
    }))

    // Generate some state
    await expect(breaker.execute(() => service.call())).rejects.toThrow()
    await expect(breaker.execute(() => service.call())).rejects.toThrow()

    const exported = breaker.export()

    expect(exported).toEqual({
      name: 'test-circuit',
      state: CircuitState.OPEN,
      failureCount: 2,
      successCount: 0,
      openedAt: expect.any(Number),
      metrics: expect.any(Object),
    })
  })

  it('can import state from persistence', async () => {
    const importedState = {
      name: 'test-circuit',
      state: CircuitState.OPEN,
      failureCount: 3,
      successCount: 0,
      openedAt: Date.now() - 2000, // Opened 2 seconds ago
      metrics: {
        totalRequests: 5,
        successfulRequests: 2,
        failedRequests: 3,
        rejectedRequests: 0,
      },
    }

    const breaker = createCircuitBreaker(createTestConfig({
      cooldownPeriodMs: 5000,
    }), importedState)

    expect(breaker.getState()).toBe(CircuitState.OPEN)
    expect(breaker.getFailureCount()).toBe(3)
    expect(breaker.getRemainingCooldown()).toBeCloseTo(3000, -2)
  })

  it('validates imported state', () => {
    const invalidState = {
      name: 'wrong-name', // Name mismatch
      state: CircuitState.OPEN,
      failureCount: 3,
      successCount: 0,
      openedAt: Date.now(),
      metrics: {},
    }

    expect(() =>
      createCircuitBreaker(createTestConfig({ name: 'test-circuit' }), invalidState)
    ).toThrow(/name mismatch/)
  })
})
