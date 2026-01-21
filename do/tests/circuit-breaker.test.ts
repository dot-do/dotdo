/**
 * Tests for Circuit Breaker Pattern
 *
 * @module @dotdo/do/tests/circuit-breaker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  createCircuitBreaker,
  createCircuitBreakerRegistry,
  getGlobalCircuitBreakerRegistry,
  resetGlobalCircuitBreakerRegistry,
  type CircuitState,
} from '../circuit-breaker'

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker

  beforeEach(() => {
    breaker = createCircuitBreaker({
      name: 'test-circuit',
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      successThreshold: 2,
      timeoutMs: 100,
    })
  })

  describe('initialization', () => {
    it('should start in closed state', () => {
      expect(breaker.getState()).toBe('closed')
    })

    it('should have correct name', () => {
      expect(breaker.getName()).toBe('test-circuit')
    })

    it('should initialize with zero stats', () => {
      const stats = breaker.getStats()
      expect(stats.totalRequests).toBe(0)
      expect(stats.successCount).toBe(0)
      expect(stats.failureCount).toBe(0)
      expect(stats.rejectedCount).toBe(0)
    })
  })

  describe('closed state behavior', () => {
    it('should execute operations successfully', async () => {
      const result = await breaker.execute(async () => 'success')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBe('success')
        expect(result.latencyMs).toBeGreaterThanOrEqual(0)
      }
    })

    it('should record success metrics', async () => {
      await breaker.execute(async () => 'success')

      const stats = breaker.getStats()
      expect(stats.totalRequests).toBe(1)
      expect(stats.successCount).toBe(1)
      expect(stats.consecutiveSuccesses).toBe(1)
    })

    it('should record failure metrics', async () => {
      await breaker.execute(async () => {
        throw new Error('Test failure')
      })

      const stats = breaker.getStats()
      expect(stats.totalRequests).toBe(1)
      expect(stats.failureCount).toBe(1)
      expect(stats.consecutiveFailures).toBe(1)
    })

    it('should allow requests when allowing requests check is called', () => {
      expect(breaker.isAllowingRequests()).toBe(true)
    })
  })

  describe('state transitions', () => {
    it('should transition to open after failure threshold', async () => {
      // Fail 3 times (threshold)
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => {
          throw new Error('Test failure')
        })
      }

      expect(breaker.getState()).toBe('open')
    })

    it('should reject requests when open', async () => {
      // Open the circuit
      breaker.forceOpen()

      const result = await breaker.execute(async () => 'success')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.rejected).toBe(true)
        expect(result.error.message).toBe('Circuit open')
      }

      const stats = breaker.getStats()
      expect(stats.rejectedCount).toBe(1)
    })

    it('should transition to half-open after reset timeout', async () => {
      // Open the circuit
      breaker.forceOpen()
      expect(breaker.getState()).toBe('open')

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 1100))

      // The next call should trigger half-open state
      breaker.isAllowingRequests()
      expect(breaker.getState()).toBe('half_open')
    })

    it('should close circuit after success threshold in half-open', async () => {
      // Create a breaker with high half-open ratio for testing
      const testBreaker = createCircuitBreaker({
        name: 'test-half-open',
        failureThreshold: 1,
        resetTimeoutMs: 50,
        successThreshold: 2,
        halfOpenRequestRatio: 1.0, // Always allow in half-open
      })

      // Open the circuit
      await testBreaker.execute(async () => {
        throw new Error('fail')
      })
      expect(testBreaker.getState()).toBe('open')

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 60))

      // Execute successes in half-open
      await testBreaker.execute(async () => 'success')
      await testBreaker.execute(async () => 'success')

      expect(testBreaker.getState()).toBe('closed')
    })

    it('should re-open circuit on failure in half-open', async () => {
      // Create a breaker with high half-open ratio for testing
      const testBreaker = createCircuitBreaker({
        name: 'test-reopen',
        failureThreshold: 1,
        resetTimeoutMs: 50,
        halfOpenRequestRatio: 1.0, // Always allow in half-open
      })

      // Open the circuit
      await testBreaker.execute(async () => {
        throw new Error('fail')
      })
      expect(testBreaker.getState()).toBe('open')

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 60))

      // Fail in half-open
      await testBreaker.execute(async () => {
        throw new Error('fail again')
      })

      expect(testBreaker.getState()).toBe('open')
    })
  })

  describe('timeout handling', () => {
    it('should timeout slow operations', async () => {
      const result = await breaker.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200)) // Longer than 100ms timeout
        return 'slow'
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toBe('Circuit breaker timeout')
      }

      const stats = breaker.getStats()
      expect(stats.timeoutCount).toBe(1)
    })
  })

  describe('fallback handling', () => {
    it('should use fallback when circuit is open', async () => {
      breaker.forceOpen()

      const result = await breaker.execute(
        async () => 'original',
        () => 'fallback'
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.fallbackUsed).toBe(true)
      }
    })

    it('should use fallback on operation failure', async () => {
      const result = await breaker.execute(
        async () => {
          throw new Error('fail')
        },
        () => 'fallback'
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.fallbackUsed).toBe(true)
      }
    })

    it('should handle async fallback', async () => {
      breaker.forceOpen()

      const result = await breaker.execute(
        async () => 'original',
        async () => 'async-fallback'
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.fallbackUsed).toBe(true)
      }
    })
  })

  describe('forced state changes', () => {
    it('should force open', () => {
      breaker.forceOpen()
      expect(breaker.getState()).toBe('open')
    })

    it('should force close', () => {
      breaker.forceOpen()
      breaker.forceClose()
      expect(breaker.getState()).toBe('closed')
    })

    it('should reset all stats', async () => {
      // Accumulate some stats
      await breaker.execute(async () => 'success')
      await breaker.execute(async () => {
        throw new Error('fail')
      })

      breaker.reset()

      const stats = breaker.getStats()
      expect(stats.totalRequests).toBe(0)
      expect(stats.successCount).toBe(0)
      expect(stats.failureCount).toBe(0)
      expect(breaker.getState()).toBe('closed')
    })
  })

  describe('callbacks', () => {
    it('should call onStateChange callback', async () => {
      const onStateChange = vi.fn()
      const callbackBreaker = createCircuitBreaker({
        name: 'callback-test',
        failureThreshold: 1,
        onStateChange,
      })

      await callbackBreaker.execute(async () => {
        throw new Error('fail')
      })

      expect(onStateChange).toHaveBeenCalledWith('callback-test', 'closed', 'open')
    })

    it('should call onFailure callback', async () => {
      const onFailure = vi.fn()
      const callbackBreaker = createCircuitBreaker({
        name: 'failure-test',
        onFailure,
      })

      await callbackBreaker.execute(async () => {
        throw new Error('test error')
      })

      expect(onFailure).toHaveBeenCalled()
      expect(onFailure.mock.calls[0][0]).toBe('failure-test')
      expect(onFailure.mock.calls[0][1].message).toBe('test error')
    })

    it('should call onSuccess callback', async () => {
      const onSuccess = vi.fn()
      const callbackBreaker = createCircuitBreaker({
        name: 'success-test',
        onSuccess,
      })

      await callbackBreaker.execute(async () => 'success')

      expect(onSuccess).toHaveBeenCalled()
      expect(onSuccess.mock.calls[0][0]).toBe('success-test')
    })
  })

  describe('latency statistics', () => {
    it('should track average latency', async () => {
      // Execute multiple operations
      for (let i = 0; i < 5; i++) {
        await breaker.execute(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return 'success'
        })
      }

      const stats = breaker.getStats()
      expect(stats.avgLatencyMs).toBeGreaterThanOrEqual(10)
    })
  })
})

describe('CircuitBreakerRegistry', () => {
  let registry: CircuitBreakerRegistry

  beforeEach(() => {
    registry = createCircuitBreakerRegistry({
      failureThreshold: 5,
      resetTimeoutMs: 30000,
    })
  })

  describe('circuit management', () => {
    it('should create circuits on demand', () => {
      const circuit = registry.get('test')
      expect(circuit).toBeInstanceOf(CircuitBreaker)
      expect(circuit.getName()).toBe('test')
    })

    it('should return same circuit for same name', () => {
      const circuit1 = registry.get('test')
      const circuit2 = registry.get('test')
      expect(circuit1).toBe(circuit2)
    })

    it('should check if circuit exists', () => {
      expect(registry.has('test')).toBe(false)
      registry.get('test')
      expect(registry.has('test')).toBe(true)
    })

    it('should remove circuits', () => {
      registry.get('test')
      expect(registry.has('test')).toBe(true)

      registry.remove('test')
      expect(registry.has('test')).toBe(false)
    })

    it('should list all circuit names', () => {
      registry.get('circuit-a')
      registry.get('circuit-b')
      registry.get('circuit-c')

      const names = registry.getNames()
      expect(names).toContain('circuit-a')
      expect(names).toContain('circuit-b')
      expect(names).toContain('circuit-c')
    })
  })

  describe('bulk operations', () => {
    it('should get all stats', async () => {
      const circuitA = registry.get('a')
      const circuitB = registry.get('b')

      await circuitA.execute(async () => 'success')
      await circuitB.execute(async () => {
        throw new Error('fail')
      })

      const allStats = registry.getAllStats()
      expect(allStats['a'].successCount).toBe(1)
      expect(allStats['b'].failureCount).toBe(1)
    })

    it('should filter by state', async () => {
      const closedCircuit = registry.get('closed')
      const openCircuit = registry.get('open')
      openCircuit.forceOpen()

      const openCircuits = registry.getByState('open')
      const closedCircuits = registry.getByState('closed')

      expect(openCircuits).toContain(openCircuit)
      expect(closedCircuits).toContain(closedCircuit)
    })

    it('should reset all circuits', async () => {
      const circuit1 = registry.get('1')
      const circuit2 = registry.get('2')

      circuit1.forceOpen()
      circuit2.forceOpen()

      registry.resetAll()

      expect(circuit1.getState()).toBe('closed')
      expect(circuit2.getState()).toBe('closed')
    })

    it('should clear all circuits', () => {
      registry.get('a')
      registry.get('b')

      registry.clear()

      expect(registry.getNames()).toHaveLength(0)
    })
  })
})

describe('Global Registry', () => {
  beforeEach(() => {
    resetGlobalCircuitBreakerRegistry()
  })

  it('should provide global singleton', () => {
    const registry1 = getGlobalCircuitBreakerRegistry()
    const registry2 = getGlobalCircuitBreakerRegistry()
    expect(registry1).toBe(registry2)
  })

  it('should reset global registry', () => {
    const registry1 = getGlobalCircuitBreakerRegistry()
    registry1.get('test')

    resetGlobalCircuitBreakerRegistry()

    const registry2 = getGlobalCircuitBreakerRegistry()
    expect(registry2).not.toBe(registry1)
    expect(registry2.has('test')).toBe(false)
  })
})
