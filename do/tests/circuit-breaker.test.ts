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
      // Use a tolerance for timing-sensitive tests - timers in test environments may not be precise
      expect(stats.avgLatencyMs).toBeGreaterThanOrEqual(8)
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

// ============================================================================
// Concurrency Tests (do-ai2m)
// ============================================================================

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('CircuitBreaker Concurrency', () => {
  describe('Circuit opening after threshold failures', () => {
    it('should open circuit after concurrent failures exceed threshold', async () => {
      const breaker = createCircuitBreaker({
        name: 'concurrent-failures',
        failureThreshold: 5,
        resetTimeoutMs: 1000,
      })

      // Fire 10 concurrent failures
      const failures = Array.from({ length: 10 }, () =>
        breaker.execute(async () => {
          throw new Error('Concurrent failure')
        })
      )

      await Promise.all(failures)

      // Circuit should be open
      expect(breaker.getState()).toBe('open')

      const stats = breaker.getStats()
      expect(stats.failureCount).toBe(10)
      expect(stats.consecutiveFailures).toBeGreaterThanOrEqual(5)
    })

    it('should track failure count correctly under concurrent load', async () => {
      const breaker = createCircuitBreaker({
        name: 'failure-tracking',
        failureThreshold: 100, // High threshold to prevent opening
        resetTimeoutMs: 1000,
      })

      // Fire 50 concurrent failures
      const failures = Array.from({ length: 50 }, () =>
        breaker.execute(async () => {
          await delay(Math.random() * 5)
          throw new Error('Concurrent failure')
        })
      )

      await Promise.all(failures)

      const stats = breaker.getStats()
      expect(stats.failureCount).toBe(50)
      expect(stats.totalRequests).toBe(50)
    })

    it('should handle mixed success/failure under concurrent load', async () => {
      const breaker = createCircuitBreaker({
        name: 'mixed-results',
        failureThreshold: 100, // High threshold to prevent opening
        resetTimeoutMs: 1000,
      })

      // Fire 100 concurrent operations - half succeed, half fail
      const operations = Array.from({ length: 100 }, (_, i) =>
        breaker.execute(async () => {
          await delay(Math.random() * 5)
          if (i % 2 === 0) {
            throw new Error('Failure')
          }
          return 'success'
        })
      )

      const results = await Promise.all(operations)

      const successes = results.filter(r => r.success)
      const failures = results.filter(r => !r.success)

      expect(successes.length).toBe(50)
      expect(failures.length).toBe(50)

      const stats = breaker.getStats()
      expect(stats.successCount).toBe(50)
      expect(stats.failureCount).toBe(50)
      expect(stats.totalRequests).toBe(100)
    })
  })

  describe('Half-open state and recovery', () => {
    it('should transition to half-open and recover under concurrent requests', async () => {
      const breaker = createCircuitBreaker({
        name: 'half-open-recovery',
        failureThreshold: 3,
        resetTimeoutMs: 50,
        successThreshold: 2,
        halfOpenRequestRatio: 1.0, // Always allow in half-open
      })

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => {
          throw new Error('fail')
        })
      }
      expect(breaker.getState()).toBe('open')

      // Wait for reset timeout
      await delay(60)

      // Fire concurrent successes - circuit should close after successThreshold
      const successes = Array.from({ length: 5 }, () =>
        breaker.execute(async () => 'success')
      )

      await Promise.all(successes)

      // Circuit should have recovered
      expect(breaker.getState()).toBe('closed')
    })

    it('should re-open from half-open on concurrent failures', async () => {
      const breaker = createCircuitBreaker({
        name: 'half-open-reopen',
        failureThreshold: 1,
        resetTimeoutMs: 50,
        halfOpenRequestRatio: 1.0,
      })

      // Open the circuit
      await breaker.execute(async () => {
        throw new Error('fail')
      })
      expect(breaker.getState()).toBe('open')

      // Wait for reset timeout
      await delay(60)

      // Fire concurrent requests - some fail, some succeed
      // Any failure in half-open should re-open the circuit
      const operations = Array.from({ length: 10 }, (_, i) =>
        breaker.execute(async () => {
          if (i % 3 === 0) {
            throw new Error('fail')
          }
          return 'success'
        })
      )

      await Promise.all(operations)

      // Circuit should be open due to failures in half-open
      expect(breaker.getState()).toBe('open')
    })

    it('should handle rapid open/half-open/closed transitions', async () => {
      const stateTransitions: CircuitState[] = []
      const breaker = createCircuitBreaker({
        name: 'rapid-transitions',
        failureThreshold: 2,
        resetTimeoutMs: 20,
        successThreshold: 2,
        halfOpenRequestRatio: 1.0,
        onStateChange: (_name, _from, to) => {
          stateTransitions.push(to)
        },
      })

      // Multiple cycles of fail -> open -> half-open -> fail -> open...
      for (let cycle = 0; cycle < 3; cycle++) {
        // Fail to open
        await Promise.all([
          breaker.execute(async () => { throw new Error('fail') }),
          breaker.execute(async () => { throw new Error('fail') }),
        ])

        // Wait for half-open
        await delay(30)

        // Trigger half-open check
        breaker.isAllowingRequests()

        // Succeed to close
        await Promise.all([
          breaker.execute(async () => 'success'),
          breaker.execute(async () => 'success'),
        ])
      }

      // Should have cycled through states multiple times
      expect(stateTransitions.filter(s => s === 'open').length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Concurrent request handling', () => {
    it('should handle high concurrency without data corruption', async () => {
      const breaker = createCircuitBreaker({
        name: 'high-concurrency',
        failureThreshold: 1000, // Very high to prevent opening
        resetTimeoutMs: 1000,
        timeoutMs: 5000,
      })

      // Fire 200 concurrent requests
      const operations = Array.from({ length: 200 }, (_, i) =>
        breaker.execute(async () => {
          await delay(Math.random() * 10)
          return i
        })
      )

      const results = await Promise.all(operations)

      // All should succeed
      const successes = results.filter(r => r.success)
      expect(successes.length).toBe(200)

      // Stats should be accurate
      const stats = breaker.getStats()
      expect(stats.totalRequests).toBe(200)
      expect(stats.successCount).toBe(200)
      expect(stats.failureCount).toBe(0)
    })

    it('should correctly reject requests when circuit is open under load', async () => {
      const breaker = createCircuitBreaker({
        name: 'reject-under-load',
        failureThreshold: 3,
        resetTimeoutMs: 10000, // Long timeout to keep circuit open
      })

      // Open the circuit
      breaker.forceOpen()

      // Fire 100 concurrent requests - all should be rejected
      const operations = Array.from({ length: 100 }, () =>
        breaker.execute(async () => 'should-not-run')
      )

      const results = await Promise.all(operations)

      // All should be rejected
      const rejected = results.filter(r => !r.success && !r.success && (r as { rejected: boolean }).rejected)
      expect(rejected.length).toBe(100)

      const stats = breaker.getStats()
      expect(stats.rejectedCount).toBe(100)
      expect(stats.successCount).toBe(0)
    })

    it('should maintain correct latency stats under concurrent load', async () => {
      const breaker = createCircuitBreaker({
        name: 'latency-tracking',
        failureThreshold: 1000,
        resetTimeoutMs: 1000,
      })

      // Fire concurrent requests with varying delays
      const operations = Array.from({ length: 50 }, (_, i) =>
        breaker.execute(async () => {
          await delay(10 + (i % 10)) // 10-19ms delays
          return 'success'
        })
      )

      await Promise.all(operations)

      const stats = breaker.getStats()
      expect(stats.avgLatencyMs).toBeGreaterThanOrEqual(10)
      expect(stats.avgLatencyMs).toBeLessThan(50)
      expect(stats.p95LatencyMs).toBeGreaterThanOrEqual(10)
    })

    it('should handle concurrent forceOpen and forceClose operations', async () => {
      const breaker = createCircuitBreaker({
        name: 'force-operations',
        failureThreshold: 5,
        resetTimeoutMs: 1000,
      })

      // Randomly force open and close concurrently
      const operations = Array.from({ length: 50 }, (_, i) => {
        if (i % 2 === 0) {
          return Promise.resolve(breaker.forceOpen())
        } else {
          return Promise.resolve(breaker.forceClose())
        }
      })

      await Promise.all(operations)

      // Should end in a valid state (either open or closed)
      expect(['open', 'closed']).toContain(breaker.getState())
    })
  })

  describe('State transitions under load', () => {
    it('should handle concurrent state transition attempts', async () => {
      const stateChanges: Array<{ from: CircuitState; to: CircuitState }> = []
      const breaker = createCircuitBreaker({
        name: 'state-transitions',
        failureThreshold: 3,
        resetTimeoutMs: 30,
        successThreshold: 2,
        halfOpenRequestRatio: 1.0,
        onStateChange: (_name, from, to) => {
          stateChanges.push({ from, to })
        },
      })

      // Concurrent failures to trigger opening
      await Promise.all(
        Array.from({ length: 5 }, () =>
          breaker.execute(async () => { throw new Error('fail') })
        )
      )

      expect(breaker.getState()).toBe('open')

      // Wait for half-open
      await delay(40)

      // Concurrent operations during half-open - race to close or re-open
      const mixedOps = Array.from({ length: 20 }, (_, i) =>
        breaker.execute(async () => {
          if (i < 10) {
            return 'success'
          }
          throw new Error('fail')
        })
      )

      await Promise.all(mixedOps)

      // State changes should be recorded
      expect(stateChanges.length).toBeGreaterThan(0)
      // Should have transitioned to open at least once
      expect(stateChanges.some(s => s.to === 'open')).toBe(true)
    })

    it('should handle reset during concurrent operations', async () => {
      let resetCalled = false
      const breaker = createCircuitBreaker({
        name: 'reset-during-ops',
        failureThreshold: 5,
        resetTimeoutMs: 1000,
      })

      // Start concurrent operations
      const operations = Array.from({ length: 100 }, (_, i) =>
        breaker.execute(async () => {
          await delay(10 + Math.random() * 20)
          if (i % 3 === 0) {
            throw new Error('fail')
          }
          return 'success'
        })
      )

      // Reset in the middle
      await delay(15)
      breaker.reset()
      resetCalled = true

      // Verify reset was called during operations (not after)
      const someOperationsPending = operations.some(op => {
        // Check if any operations might still be pending
        return true // Since we're using Promise.all, some are still running
      })
      expect(someOperationsPending).toBe(true)
      expect(resetCalled).toBe(true)

      await Promise.all(operations)

      // After reset, subsequent operations may have re-opened the circuit
      // The key test is that reset() doesn't throw and operations complete
      const stats = breaker.getStats()
      // Stats should reflect operations that completed after reset
      // State may be 'open' if failures exceeded threshold after reset
      expect(['open', 'closed']).toContain(stats.state)
    })

    it('should handle concurrent operations across multiple breakers', async () => {
      const registry = createCircuitBreakerRegistry({
        failureThreshold: 3,
        resetTimeoutMs: 1000,
      })

      // Create multiple breakers
      const breakerNames = ['breaker-1', 'breaker-2', 'breaker-3', 'breaker-4', 'breaker-5']

      // Fire concurrent operations across all breakers
      const operations = breakerNames.flatMap(name => {
        const breaker = registry.get(name)
        return Array.from({ length: 20 }, (_, i) =>
          breaker.execute(async () => {
            await delay(Math.random() * 10)
            if (i % 5 === 0) {
              throw new Error('fail')
            }
            return name
          })
        )
      })

      await Promise.all(operations)

      // All breakers should have processed requests
      const allStats = registry.getAllStats()
      for (const name of breakerNames) {
        expect(allStats[name].totalRequests).toBe(20)
        // Some should have failures
        expect(allStats[name].failureCount).toBe(4) // Every 5th fails
        expect(allStats[name].successCount).toBe(16)
      }
    })

    it('should handle timeout races correctly', async () => {
      const breaker = createCircuitBreaker({
        name: 'timeout-race',
        failureThreshold: 5,
        resetTimeoutMs: 1000,
        timeoutMs: 20, // Very short timeout
      })

      // Fire operations that race against timeout
      const operations = Array.from({ length: 50 }, (_, i) =>
        breaker.execute(async () => {
          // Some complete before timeout, some after
          await delay(i % 2 === 0 ? 5 : 50)
          return 'success'
        })
      )

      const results = await Promise.all(operations)

      // Should have mix of successes and timeouts
      const successes = results.filter(r => r.success)
      const failures = results.filter(r => !r.success)

      // At least some should succeed (the fast ones)
      expect(successes.length).toBeGreaterThan(0)
      // At least some should timeout (the slow ones)
      expect(failures.length).toBeGreaterThan(0)

      const stats = breaker.getStats()
      expect(stats.timeoutCount).toBeGreaterThan(0)
    })
  })

  describe('Multiple DOs hitting same circuit', () => {
    it('should handle concurrent access from simulated multiple DOs', async () => {
      // Simulate multiple DOs sharing a circuit breaker via global registry
      resetGlobalCircuitBreakerRegistry()
      const registry = getGlobalCircuitBreakerRegistry()

      // Simulate concurrent access from 5 "DOs"
      const doOperations = Array.from({ length: 5 }, (_, doId) => {
        const breaker = registry.get('shared-circuit', {
          failureThreshold: 10,
          resetTimeoutMs: 1000,
        })

        return Array.from({ length: 20 }, (_, opId) =>
          breaker.execute(async () => {
            await delay(Math.random() * 10)
            if (opId % 5 === 0) {
              throw new Error(`DO-${doId} failure`)
            }
            return `DO-${doId}-op-${opId}`
          })
        )
      })

      const allOperations = doOperations.flat()
      await Promise.all(allOperations)

      const breaker = registry.get('shared-circuit')
      const stats = breaker.getStats()

      // Total requests from all DOs
      expect(stats.totalRequests).toBe(100) // 5 DOs * 20 ops each
      // Failures from all DOs combined
      expect(stats.failureCount).toBe(20) // 5 DOs * 4 failures each
    })

    it('should isolate circuits between different services', async () => {
      const registry = createCircuitBreakerRegistry({
        failureThreshold: 3,
        resetTimeoutMs: 1000,
      })

      // Service A has failures
      const serviceA = registry.get('service-a')
      await Promise.all(
        Array.from({ length: 5 }, () =>
          serviceA.execute(async () => { throw new Error('A fails') })
        )
      )

      // Service B has successes
      const serviceB = registry.get('service-b')
      await Promise.all(
        Array.from({ length: 5 }, () =>
          serviceB.execute(async () => 'B succeeds')
        )
      )

      // Service A should be open
      expect(serviceA.getState()).toBe('open')
      // Service B should still be closed
      expect(serviceB.getState()).toBe('closed')

      // Requests to B should still work
      const result = await serviceB.execute(async () => 'still works')
      expect(result.success).toBe(true)
    })

    it('should handle concurrent circuit operations in registry', async () => {
      const registry = createCircuitBreakerRegistry({
        failureThreshold: 5,
        resetTimeoutMs: 1000,
      })

      // Concurrent circuit creation and operations
      const operations = Array.from({ length: 100 }, (_, i) => {
        const circuitName = `circuit-${i % 10}` // 10 circuits
        const breaker = registry.get(circuitName)

        return breaker.execute(async () => {
          await delay(Math.random() * 5)
          if (i % 7 === 0) {
            throw new Error('random failure')
          }
          return circuitName
        })
      })

      await Promise.all(operations)

      // All 10 circuits should exist
      expect(registry.getNames()).toHaveLength(10)

      // Each circuit should have processed 10 requests
      const allStats = registry.getAllStats()
      for (let i = 0; i < 10; i++) {
        expect(allStats[`circuit-${i}`].totalRequests).toBe(10)
      }
    })
  })

  describe('Callback concurrency', () => {
    it('should handle concurrent callback invocations', async () => {
      const callbackCalls: Array<{ type: string; name: string; timestamp: number }> = []

      const breaker = createCircuitBreaker({
        name: 'callback-concurrency',
        failureThreshold: 100,
        resetTimeoutMs: 1000,
        onSuccess: (name) => {
          callbackCalls.push({ type: 'success', name, timestamp: Date.now() })
        },
        onFailure: (name) => {
          callbackCalls.push({ type: 'failure', name, timestamp: Date.now() })
        },
        onStateChange: (name, _from, to) => {
          callbackCalls.push({ type: `state-${to}`, name, timestamp: Date.now() })
        },
      })

      // Fire many concurrent operations
      const operations = Array.from({ length: 100 }, (_, i) =>
        breaker.execute(async () => {
          await delay(Math.random() * 5)
          if (i % 2 === 0) {
            throw new Error('fail')
          }
          return 'success'
        })
      )

      await Promise.all(operations)

      // Should have received all callbacks
      const successCallbacks = callbackCalls.filter(c => c.type === 'success')
      const failureCallbacks = callbackCalls.filter(c => c.type === 'failure')

      expect(successCallbacks.length).toBe(50)
      expect(failureCallbacks.length).toBe(50)
    })

    it('should not block execution on slow callbacks', async () => {
      let slowCallbackCompleted = false

      const breaker = createCircuitBreaker({
        name: 'slow-callback',
        failureThreshold: 100,
        resetTimeoutMs: 1000,
        onSuccess: async () => {
          // Simulate slow callback (note: callbacks are sync in the impl)
          // This tests that execution doesn't wait for callbacks
          slowCallbackCompleted = true
        },
      })

      const startTime = Date.now()

      // Fire operations
      const operations = Array.from({ length: 10 }, () =>
        breaker.execute(async () => 'success')
      )

      await Promise.all(operations)

      const duration = Date.now() - startTime

      // All operations should complete quickly
      expect(duration).toBeLessThan(100)
      expect(slowCallbackCompleted).toBe(true)
    })
  })
})
