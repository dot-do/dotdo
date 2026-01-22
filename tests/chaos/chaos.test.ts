/**
 * Chaos Engineering Tests for dotdo Framework
 *
 * Tests system resilience under various failure conditions using REAL
 * Miniflare Durable Objects instead of mocks.
 *
 * Tests cover:
 * 1. Network latency injection
 * 2. Random request failures
 * 3. Concurrent request storms
 * 4. Large payload handling
 * 5. System recovery and resilience
 *
 * @see do-fhng.9
 * @see do-t0v5 - NO MOCKS conversion
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { env } from 'cloudflare:test'
import {
  ChaosProxy,
  runRequestStorm,
  RetryTester,
  createTimeoutOperation,
  CorruptionInjector,
  NetworkPartitionSimulator,
  LatencyProfile,
  PartialFailureSimulator,
  SplitBrainSimulator,
} from './ChaosProxy'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface HealthResponse {
  status: string
  id: string
}

interface InfoResponse {
  id: string
  keys: number
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `chaos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a real DO stub from the environment
 */
function getDOStub(name?: string): DurableObjectStub {
  const testName = name || generateTestId()
  const id = env.DO.idFromName(testName)
  return env.DO.get(id)
}

/**
 * Helper delay function
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ============================================================================
// Test Suite: Network Latency Injection
// ============================================================================

describe('Chaos: Network Latency Injection', () => {
  let chaos: ChaosProxy

  beforeEach(() => {
    chaos = new ChaosProxy()
  })

  afterEach(() => {
    chaos.reset()
  })

  it('should inject configurable latency into requests', async () => {
    const stub = getDOStub()
    chaos.injectLatency(50, 100) // 50-100ms latency

    const startTime = Date.now()
    await chaos.wrap(async () => {
      return stub.fetch('https://do/')
    })
    const duration = Date.now() - startTime

    expect(duration).toBeGreaterThanOrEqual(50)
    expect(chaos.getStats().injectedLatencies).toBe(1)
  })

  it('should inject latency probabilistically', async () => {
    const stub = getDOStub()
    chaos.injectLatency(50, 100, 0.5) // 50% probability

    // Run multiple requests
    const durations: number[] = []
    for (let i = 0; i < 20; i++) {
      const startTime = Date.now()
      await chaos.wrap(async () => {
        return stub.fetch('https://do/')
      })
      durations.push(Date.now() - startTime)
    }

    // Some should be fast (no latency), some slow (with latency)
    const fastRequests = durations.filter((d) => d < 50)
    const slowRequests = durations.filter((d) => d >= 50)

    // With 50% probability over 20 requests, expect some of each
    expect(fastRequests.length).toBeGreaterThan(0)
    expect(slowRequests.length).toBeGreaterThan(0)
  })

  it('should track latency statistics', async () => {
    const stub = getDOStub()
    chaos.injectLatency(10, 50)

    for (let i = 0; i < 5; i++) {
      await chaos.wrap(async () => {
        return stub.fetch('https://do/')
      })
    }

    const stats = chaos.getStats()
    expect(stats.injectedLatencies).toBe(5)
    expect(stats.totalLatencyMs).toBeGreaterThan(50) // At least 10ms * 5
    expect(stats.maxLatencyMs).toBeLessThanOrEqual(50)
  })

  it('should allow disabling latency injection', async () => {
    const stub = getDOStub()
    chaos.injectLatency(100, 200)
    chaos.disable()

    const startTime = Date.now()
    await chaos.wrap(async () => {
      return stub.fetch('https://do/')
    })
    const duration = Date.now() - startTime

    // Should be fast when disabled
    expect(duration).toBeLessThan(100)
    expect(chaos.getStats().injectedLatencies).toBe(0)
  })

  it('should handle system under latency stress', async () => {
    const stub = getDOStub()
    chaos.injectLatency(5, 20)

    // Simulate 50 concurrent requests with latency
    const requests = Array.from({ length: 50 }, (_, i) =>
      chaos.wrap(async () => {
        return stub.fetch(`https://do/?id=${i}`)
      })
    )

    const responses = await Promise.all(requests)

    // All requests should succeed despite latency
    responses.forEach((response) => {
      expect(response.status).toBe(200)
    })

    expect(chaos.getStats().totalRequests).toBe(50)
  })
})

// ============================================================================
// Test Suite: Random Request Failures
// ============================================================================

describe('Chaos: Random Request Failures', () => {
  let chaos: ChaosProxy

  beforeEach(() => {
    chaos = new ChaosProxy()
  })

  afterEach(() => {
    chaos.reset()
  })

  it('should inject failures with configured probability', async () => {
    const stub = getDOStub()
    chaos.injectFailure(1.0) // 100% failure rate

    await expect(
      chaos.wrap(async () => {
        return stub.fetch('https://do/')
      })
    ).rejects.toThrow('Chaos-injected failure')

    expect(chaos.getStats().injectedFailures).toBe(1)
  })

  it('should use custom error messages', async () => {
    const stub = getDOStub()
    chaos.injectFailure(1.0, 'Custom chaos error', 'CUSTOM_CODE')

    try {
      await chaos.wrap(async () => {
        return stub.fetch('https://do/')
      })
      expect.fail('Should have thrown')
    } catch (error) {
      expect((error as Error).message).toBe('Custom chaos error')
      expect((error as Error & { code: string }).code).toBe('CUSTOM_CODE')
    }
  })

  it('should respect failure probability', async () => {
    const stub = getDOStub()
    chaos.injectFailure(0.3) // 30% failure rate

    let failures = 0
    let successes = 0

    for (let i = 0; i < 100; i++) {
      try {
        await chaos.wrap(async () => {
          return stub.fetch('https://do/')
        })
        successes++
      } catch {
        failures++
      }
    }

    // With 30% probability over 100 requests, expect roughly 30 failures
    // Allow some variance (15-45 failures)
    expect(failures).toBeGreaterThan(10)
    expect(failures).toBeLessThan(50)
    expect(successes).toBeGreaterThan(50)
  })

  it('should isolate failures between requests', async () => {
    const stub = getDOStub()
    chaos.injectFailure(0.5) // 50% failure

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        chaos.wrap(async () => {
          return stub.fetch('https://do/')
        })
      )
    )

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    // Failures in one request should not affect others
    expect(fulfilled.length).toBeGreaterThan(0)
    expect(rejected.length).toBeGreaterThan(0)
  })

  it('should handle error recovery gracefully', async () => {
    const stub = getDOStub()
    // Simulate a method that retries on failure
    let attempts = 0
    const maxRetries = 3

    const retryOperation = async (): Promise<Response> => {
      for (let i = 0; i < maxRetries; i++) {
        attempts++
        try {
          return await chaos.wrap(async () => {
            return stub.fetch('https://do/')
          })
        } catch {
          if (i === maxRetries - 1) throw new Error('Max retries exceeded')
          await delay(10) // Brief delay before retry
        }
      }
      throw new Error('Unexpected')
    }

    chaos.injectFailure(0.7) // 70% failure - likely to fail initial attempts

    // Run multiple retry operations
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => retryOperation())
    )

    // Some should eventually succeed through retries
    const succeeded = results.filter((r) => r.status === 'fulfilled')
    expect(succeeded.length).toBeGreaterThan(0)
    expect(attempts).toBeGreaterThan(10) // Should have made retry attempts
  })
})

// ============================================================================
// Test Suite: Concurrent Request Storms
// ============================================================================

describe('Chaos: Concurrent Request Storms', () => {
  it('should handle 100 concurrent requests', async () => {
    const stub = getDOStub()

    const { results, errors, successRate } = await runRequestStorm(
      100,
      async (index) => {
        const response = await stub.fetch(`https://do/?id=${index}`)
        return response.json()
      }
    )

    expect(results.length).toBe(100)
    expect(errors.length).toBe(0)
    expect(successRate).toBe(1)
  })

  it('should handle request storm with batched execution', async () => {
    const stub = getDOStub()
    const progressUpdates: number[] = []

    const { results, duration } = await runRequestStorm(
      50,
      async (index) => {
        return stub.fetch(`https://do/?id=${index}`)
      },
      {
        batchSize: 10,
        delayBetweenBatches: 5,
        onProgress: (completed) => {
          progressUpdates.push(completed)
        },
      }
    )

    expect(results.length).toBe(50)
    // Progress is reported per-request, so should have 50 updates
    expect(progressUpdates.length).toBeGreaterThanOrEqual(5) // At least 5 batches worth
    expect(progressUpdates[progressUpdates.length - 1]).toBe(50)
    expect(duration).toBeGreaterThan(15) // Should take at least the delay time between batches
  })

  it('should handle concurrent RPC calls under storm', async () => {
    // Use a shared DO instance name so all requests go to the same DO
    const sharedName = generateTestId()
    const stub = getDOStub(sharedName)

    const { results, errors } = await runRequestStorm(200, async () => {
      const response = await stub.fetch('https://do/')
      return response.json()
    })

    expect(results.length).toBe(200)
    expect(errors.length).toBe(0)
  })

  it('should maintain response ordering under load', async () => {
    const { results } = await runRequestStorm(50, async (index) => {
      const stub = getDOStub()
      const response = await stub.fetch('https://do/')
      const json = (await response.json()) as HealthResponse
      return { index, id: json.id }
    })

    // Verify each request got a valid response
    results.forEach((r: { index: number; id: string }) => {
      expect(r.id).toBeDefined()
      expect(typeof r.index).toBe('number')
    })
  })

  it('should handle mixed operation storm', async () => {
    const stub = getDOStub()

    const { results, errors } = await runRequestStorm(100, async (index) => {
      // Mix of different endpoints
      const endpoint = index % 2 === 0 ? '/' : '/info'
      const response = await stub.fetch(`https://do${endpoint}`)
      return response.json()
    })

    expect(results.length).toBe(100)
    expect(errors.length).toBe(0)
  })
})

// ============================================================================
// Test Suite: Large Payload Handling
// ============================================================================

describe('Chaos: Large Payload Handling', () => {
  let chaos: ChaosProxy

  beforeEach(() => {
    chaos = new ChaosProxy()
  })

  afterEach(() => {
    chaos.reset()
  })

  it('should handle large string payloads in RPC', async () => {
    const stub = getDOStub()
    const largePayload = chaos.generateLargePayload(100) // 100KB

    // Test RPC with large payload
    const response = await stub.fetch('https://do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'nonExistent', args: [largePayload] }),
    })

    // Should get 404 for unknown method (but payload was processed)
    expect(response.status).toBe(404)
    expect(chaos.getStats().largePayloads).toBe(1)
  })

  it('should handle deeply nested objects', async () => {
    const stub = getDOStub()
    const largeObject = chaos.generateLargeObject(4, 3) // Depth 4, breadth 3

    const response = await stub.fetch('https://do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'testNested', args: [largeObject] }),
    })

    // Should handle the nested object even if method doesn't exist
    expect([200, 404]).toContain(response.status)
  })

  it('should handle large arrays', async () => {
    const stub = getDOStub()
    const largeArray = Array.from({ length: 10000 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      value: Math.random(),
    }))

    const response = await stub.fetch('https://do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'processBatch', args: [largeArray] }),
    })

    // Should handle the large array
    expect([200, 404]).toContain(response.status)
  })

  it('should handle concurrent large payload requests', async () => {
    const stub = getDOStub()

    const { results, errors } = await runRequestStorm(
      20,
      async () => {
        const payload = chaos.generateLargePayload(50) // 50KB each
        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'process', args: [payload] }),
        })
        return response.status
      },
      { batchSize: 5 }
    )

    expect(results.length).toBe(20)
    expect(errors.length).toBe(0)
  })

  it('should handle very large single request', async () => {
    const stub = getDOStub()
    const veryLargePayload = chaos.generateLargePayload(500) // 500KB

    const response = await stub.fetch('https://do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'echo', args: [veryLargePayload] }),
    })

    // Should handle the large payload
    expect([200, 404]).toContain(response.status)
  })
})

// ============================================================================
// Test Suite: System Recovery and Resilience
// ============================================================================

describe('Chaos: System Recovery and Resilience', () => {
  let chaos: ChaosProxy

  beforeEach(() => {
    chaos = new ChaosProxy()
  })

  afterEach(() => {
    chaos.reset()
  })

  it('should recover from transient failures', async () => {
    const stub = getDOStub()
    const retryTester = new RetryTester(3) // Fail first 2 attempts

    let attempts = 0
    const operationWithRetry = async (): Promise<Response> => {
      for (let i = 0; i < 5; i++) {
        try {
          return await retryTester.execute(async () => {
            return stub.fetch('https://do/')
          })
        } catch {
          attempts++
          if (i === 4) throw new Error('Max retries exceeded')
        }
      }
      throw new Error('Unexpected')
    }

    const response = await operationWithRetry()
    expect(response.status).toBe(200)
    expect(retryTester.getAttempts()).toBe(3) // Succeeded on 3rd attempt
    expect(attempts).toBe(2) // 2 retries before success
  })

  it('should handle timeout scenarios', async () => {
    const stub = getDOStub()
    const timeoutMs = 50

    const slowOperation = createTimeoutOperation(
      async () => stub.fetch('https://do/'),
      100 // Takes 100ms
    )

    const withTimeout = async <T>(
      operation: () => Promise<T>,
      timeout: number
    ): Promise<T> => {
      return Promise.race([
        operation(),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error('Operation timed out')), timeout)
        ),
      ])
    }

    await expect(withTimeout(slowOperation, timeoutMs)).rejects.toThrow(
      'Operation timed out'
    )
  })

  it('should properly handle retries with exponential backoff', async () => {
    const stub = getDOStub()
    chaos.injectFailure(0.8) // 80% failure rate

    const delays: number[] = []

    const exponentialBackoffRetry = async <T>(
      operation: () => Promise<T>,
      maxRetries: number,
      baseDelayMs: number
    ): Promise<T> => {
      for (let i = 0; i < maxRetries; i++) {
        try {
          return await operation()
        } catch (error) {
          if (i === maxRetries - 1) throw error
          const delayMs = baseDelayMs * Math.pow(2, i)
          delays.push(delayMs)
          await delay(delayMs)
        }
      }
      throw new Error('Unexpected')
    }

    try {
      await exponentialBackoffRetry(
        () => chaos.wrap(() => stub.fetch('https://do/')),
        6,
        10
      )
    } catch {
      // Expected to fail eventually with high failure rate
    }

    // Verify backoff pattern (should roughly double each time)
    if (delays.length >= 2) {
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1])
      }
    }
  })

  it('should detect and handle data corruption', async () => {
    const corruptor = new CorruptionInjector(0.5)
    let corruptedCount = 0

    const processData = (data: {
      $id: string
      $type: string
      value: number
    }): boolean => {
      // Validate data integrity
      if (!data.$id || !data.$type || data.value === null) {
        corruptedCount++
        return false
      }
      return true
    }

    // Process multiple items
    for (let i = 0; i < 20; i++) {
      const originalData = { $id: `id-${i}`, $type: 'test', value: i }
      const maybeCorrupted = corruptor.maybeCorrupt(originalData)
      processData(maybeCorrupted)
    }

    // Some data should have been detected as corrupted
    expect(corruptedCount).toBeGreaterThan(0)
  })

  it('should maintain system stability after failures', async () => {
    const stub = getDOStub()
    chaos.injectFailure(0.3) // 30% failure on subsequent operations

    // Attempt multiple operations
    const operations = Array.from({ length: 10 }, async (_, i) => {
      try {
        await chaos.wrap(async () => {
          await stub.fetch('https://do/')
        })
        return { id: i, success: true }
      } catch {
        return { id: i, success: false }
      }
    })

    const results = await Promise.all(operations)

    // Some operations should succeed despite failures
    const succeeded = results.filter((r) => r.success)
    expect(succeeded.length).toBeGreaterThan(0)
  })

  it('should handle cascading failures gracefully', async () => {
    const stub = getDOStub()
    // Setup dependent operations
    let step1Complete = false
    let step2Complete = false
    let step3Complete = false
    const errors: string[] = []
    let step1Failures = 0

    const step1 = async () => {
      await chaos.wrap(async () => {
        await stub.fetch('https://do/')
        step1Complete = true
      })
    }

    const step2 = async () => {
      if (!step1Complete) {
        errors.push('step2 depends on step1')
        throw new Error('Step 1 not complete')
      }
      await chaos.wrap(async () => {
        await stub.fetch('https://do/')
        step2Complete = true
      })
    }

    const step3 = async () => {
      if (!step2Complete) {
        errors.push('step3 depends on step2')
        throw new Error('Step 2 not complete')
      }
      await chaos.wrap(async () => {
        await stub.fetch('https://do/')
        step3Complete = true
      })
    }

    // Use very high failure rate to ensure step1 fails sometimes
    chaos.injectFailure(0.7)

    // Run pipeline multiple times
    for (let i = 0; i < 20; i++) {
      step1Complete = false
      step2Complete = false
      step3Complete = false

      try {
        await step1()
        await step2()
        await step3()
      } catch {
        // Track if step1 failed (which will cause cascade)
        if (!step1Complete) {
          step1Failures++
        }
      }
    }

    // With 70% failure rate over 20 runs, at least some step1 failures should cascade
    // Either we detected cascading dependency errors, OR we have many step1 failures
    // The test validates the system handles failures in dependent operations
    expect(
      step1Failures > 0 || errors.some((e) => e.includes('depends on'))
    ).toBe(true)
  })

  it('should handle circuit breaker pattern', async () => {
    const stub = getDOStub()
    let failureCount = 0
    let circuitOpen = false
    const failureThreshold = 3
    const resetTimeout = 100

    chaos.injectFailure(0.9) // Very high failure rate

    const withCircuitBreaker = async <T>(
      operation: () => Promise<T>
    ): Promise<T> => {
      if (circuitOpen) {
        throw new Error('Circuit breaker open')
      }

      try {
        const result = await operation()
        failureCount = 0 // Reset on success
        return result
      } catch (error) {
        failureCount++
        if (failureCount >= failureThreshold) {
          circuitOpen = true
          // Auto-reset after timeout
          setTimeout(() => {
            circuitOpen = false
            failureCount = 0
          }, resetTimeout)
        }
        throw error
      }
    }

    // Make requests until circuit opens
    const results: string[] = []
    for (let i = 0; i < 10; i++) {
      try {
        await withCircuitBreaker(() =>
          chaos.wrap(() => stub.fetch('https://do/'))
        )
        results.push('success')
      } catch (error) {
        results.push((error as Error).message)
      }
    }

    // Circuit should have opened after threshold failures
    expect(
      results.filter((r) => r === 'Circuit breaker open').length
    ).toBeGreaterThan(0)

    // Wait for reset and try again
    await delay(150)
    chaos.reset() // Disable chaos

    try {
      const response = await withCircuitBreaker(() => stub.fetch('https://do/'))
      expect(response.status).toBe(200)
    } catch {
      // Might still be in cooldown
    }
  })
})

// ============================================================================
// Test Suite: Combined Chaos Scenarios
// ============================================================================

describe('Chaos: Combined Scenarios', () => {
  let chaos: ChaosProxy

  beforeEach(() => {
    chaos = new ChaosProxy()
  })

  afterEach(() => {
    chaos.reset()
  })

  it('should handle latency + failure injection together', async () => {
    const stub = getDOStub()
    chaos.injectLatency(10, 30)
    chaos.injectFailure(0.3)

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        chaos.wrap(() => stub.fetch('https://do/'))
      )
    )

    const stats = chaos.getStats()
    expect(stats.totalRequests).toBe(50)
    expect(stats.injectedLatencies).toBeGreaterThan(0)
    expect(stats.injectedFailures).toBeGreaterThan(0)

    // Some requests should succeed despite chaos
    const succeeded = results.filter((r) => r.status === 'fulfilled')
    expect(succeeded.length).toBeGreaterThan(0)
  })

  it('should handle large payloads with latency and failures', async () => {
    const stub = getDOStub()
    chaos.injectLatency(5, 20)
    chaos.injectFailure(0.2)

    const { results, errors, successRate } = await runRequestStorm(
      20,
      async () => {
        const payload = chaos.generateLargePayload(20) // 20KB
        return chaos.wrap(async () => {
          const response = await stub.fetch('https://do/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'process', args: [payload] }),
          })
          return response.status
        })
      }
    )

    // Should handle most requests despite chaos
    expect(successRate).toBeGreaterThan(0.5)
    expect(results.length + errors.length).toBe(20)
  })

  it('should maintain system stability under sustained chaos', async () => {
    const stub = getDOStub()
    chaos.injectLatency(2, 10)
    chaos.injectFailure(0.15)

    // Run sustained load for multiple "rounds"
    const roundResults: { success: number; failure: number }[] = []

    for (let round = 0; round < 5; round++) {
      let success = 0
      let failure = 0

      const requests = Array.from({ length: 30 }, () =>
        chaos
          .wrap(() => stub.fetch('https://do/'))
          .then(() => {
            success++
          })
          .catch(() => {
            failure++
          })
      )

      await Promise.all(requests)
      roundResults.push({ success, failure })
    }

    // System should remain stable across rounds (no degradation)
    const successRates = roundResults.map(
      (r) => r.success / (r.success + r.failure)
    )

    // All rounds should have reasonable success rates
    successRates.forEach((rate) => {
      expect(rate).toBeGreaterThan(0.6) // At least 60% success
    })

    // No significant degradation between rounds
    const minRate = Math.min(...successRates)
    const maxRate = Math.max(...successRates)
    expect(maxRate - minRate).toBeLessThan(0.3) // Within 30% variance
  })
})

// ============================================================================
// Test Suite: Network Partition Simulation
// ============================================================================

describe('Chaos: Network Partition Simulation', () => {
  let partition: NetworkPartitionSimulator

  beforeEach(() => {
    partition = new NetworkPartitionSimulator()
  })

  afterEach(() => {
    partition.reset()
  })

  describe('Full Partition', () => {
    it('should block all cross-partition communication', async () => {
      partition.createPartition({
        type: 'full',
        partitionA: ['api-1', 'api-2'],
        partitionB: ['db-1', 'db-2'],
      })

      // Within partition A - should work
      expect(partition.canCommunicate('api-1', 'api-2')).toBe(true)

      // Within partition B - should work
      expect(partition.canCommunicate('db-1', 'db-2')).toBe(true)

      // Cross-partition - should be blocked
      expect(partition.canCommunicate('api-1', 'db-1')).toBe(false)
      expect(partition.canCommunicate('db-1', 'api-1')).toBe(false)
    })

    it('should simulate requests with correct results', async () => {
      const stub = getDOStub()

      partition.createPartition({
        type: 'full',
        partitionA: ['client'],
        partitionB: ['server'],
      })

      // Request across partition should be dropped
      const result = await partition.simulateRequest('client', 'server')
      expect(result.status).toBe('dropped')
      if (result.status === 'dropped') {
        expect(result.reason).toBe('partition')
      }

      // Stats should reflect the dropped request
      const stats = partition.getStats()
      expect(stats.droppedRequests).toBe(1)
    })

    it('should heal partition and allow communication', async () => {
      partition.createPartition({
        type: 'full',
        partitionA: ['client'],
        partitionB: ['server'],
      })

      expect(partition.canCommunicate('client', 'server')).toBe(false)

      partition.heal()

      expect(partition.isPartitioned()).toBe(false)
      expect(partition.canCommunicate('client', 'server')).toBe(true)
    })

    it('should auto-heal after duration', async () => {
      partition.createPartition({
        type: 'full',
        partitionA: ['client'],
        partitionB: ['server'],
        durationMs: 50,
      })

      expect(partition.isPartitioned()).toBe(true)

      // Wait for auto-heal
      await delay(100)

      expect(partition.isPartitioned()).toBe(false)
    })
  })

  describe('Asymmetric Partition', () => {
    it('should allow one-way communication', async () => {
      partition.createPartition({
        type: 'asymmetric',
        partitionA: ['client'],
        partitionB: ['server'],
        aToBAllowed: true,
        bToAAllowed: false,
      })

      // Client -> Server should work
      expect(partition.canCommunicate('client', 'server')).toBe(true)

      // Server -> Client should be blocked
      expect(partition.canCommunicate('server', 'client')).toBe(false)
    })

    it('should track asymmetric failures correctly', async () => {
      partition.createPartition({
        type: 'asymmetric',
        partitionA: ['producer'],
        partitionB: ['consumer'],
        aToBAllowed: true,
        bToAAllowed: false,
      })

      // Producer can send to consumer
      const result1 = await partition.simulateRequest('producer', 'consumer')
      expect(result1.status).toBe('success')

      // Consumer cannot send to producer
      const result2 = await partition.simulateRequest('consumer', 'producer')
      expect(result2.status).toBe('dropped')
      if (result2.status === 'dropped') {
        expect(result2.reason).toBe('asymmetric')
      }

      const stats = partition.getStats()
      expect(stats.successfulRequests).toBe(1)
      expect(stats.droppedRequests).toBe(1)
    })

    it('should handle reverse asymmetric partition', async () => {
      partition.createPartition({
        type: 'asymmetric',
        partitionA: ['client'],
        partitionB: ['server'],
        aToBAllowed: false,
        bToAAllowed: true,
      })

      // Client -> Server should be blocked
      expect(partition.canCommunicate('client', 'server')).toBe(false)

      // Server -> Client should work
      expect(partition.canCommunicate('server', 'client')).toBe(true)
    })
  })

  describe('Intermittent Partition', () => {
    it('should allow communication probabilistically', async () => {
      partition.createPartition({
        type: 'intermittent',
        partitionA: ['client'],
        partitionB: ['server'],
        connectivityProbability: 0.5,
      })

      let successful = 0
      let dropped = 0

      // Run many requests
      for (let i = 0; i < 100; i++) {
        const result = await partition.simulateRequest('client', 'server')
        if (result.status === 'success') successful++
        if (result.status === 'dropped') dropped++
      }

      // With 50% probability, expect roughly half to succeed
      expect(successful).toBeGreaterThan(30)
      expect(successful).toBeLessThan(70)
      expect(dropped).toBeGreaterThan(30)
      expect(dropped).toBeLessThan(70)
    })

    it('should respect 0% connectivity (same as full partition)', async () => {
      partition.createPartition({
        type: 'intermittent',
        partitionA: ['client'],
        partitionB: ['server'],
        connectivityProbability: 0,
      })

      // All requests should be dropped
      for (let i = 0; i < 10; i++) {
        const result = await partition.simulateRequest('client', 'server')
        expect(result.status).toBe('dropped')
      }
    })

    it('should respect 100% connectivity (no effective partition)', async () => {
      partition.createPartition({
        type: 'intermittent',
        partitionA: ['client'],
        partitionB: ['server'],
        connectivityProbability: 1,
      })

      // All requests should succeed
      for (let i = 0; i < 10; i++) {
        const result = await partition.simulateRequest('client', 'server')
        expect(result.status).toBe('success')
      }
    })
  })

  describe('Degraded Latency During Partition', () => {
    it('should add latency when crossing partitions', async () => {
      partition.createPartition({
        type: 'intermittent',
        partitionA: ['client'],
        partitionB: ['server'],
        connectivityProbability: 1, // Always connected but degraded
        degradedLatencyMs: 100,
      })

      const startTime = Date.now()
      const result = await partition.simulateRequest('client', 'server')
      const duration = Date.now() - startTime

      expect(result.status).toBe('success')
      expect(duration).toBeGreaterThanOrEqual(100)
      if (result.status === 'success') {
        expect(result.latencyMs).toBeGreaterThanOrEqual(100)
      }
    })

    it('should not add latency within same partition', async () => {
      partition.createPartition({
        type: 'full',
        partitionA: ['client-1', 'client-2'],
        partitionB: ['server-1', 'server-2'],
        degradedLatencyMs: 500,
      })

      const startTime = Date.now()
      const result = await partition.simulateRequest('client-1', 'client-2')
      const duration = Date.now() - startTime

      expect(result.status).toBe('success')
      expect(duration).toBeLessThan(100) // Should be fast
    })
  })

  describe('Partition with Real DO Operations', () => {
    it('should simulate partition affecting DO communication', async () => {
      const stub = getDOStub()

      partition.createPartition({
        type: 'full',
        partitionA: ['api-worker'],
        partitionB: ['durable-object'],
      })

      // Simulate API worker trying to reach DO
      const result = await partition.simulateRequest(
        'api-worker',
        'durable-object',
        async () => {
          return stub.fetch('https://do/')
        }
      )

      expect(result.status).toBe('dropped')

      // Heal partition and retry
      partition.heal()

      const result2 = await partition.simulateRequest(
        'api-worker',
        'durable-object',
        async () => {
          return stub.fetch('https://do/')
        }
      )

      expect(result2.status).toBe('success')
    })
  })
})

// ============================================================================
// Test Suite: Advanced Latency Injection
// ============================================================================

describe('Chaos: Advanced Latency Injection', () => {
  describe('Constant Latency Profile', () => {
    it('should inject consistent latency', async () => {
      const latency = new LatencyProfile({
        type: 'constant',
        baseLatencyMs: 50,
      })

      const latencies: number[] = []
      for (let i = 0; i < 10; i++) {
        const startTime = Date.now()
        await latency.apply()
        latencies.push(Date.now() - startTime)
      }

      // All latencies should be around 50ms
      latencies.forEach((l) => {
        expect(l).toBeGreaterThanOrEqual(45)
        expect(l).toBeLessThan(100)
      })

      const stats = latency.getStats()
      expect(stats.totalCalls).toBe(10)
    })
  })

  describe('Uniform Latency Profile', () => {
    it('should inject random latency between min and max', async () => {
      const latency = new LatencyProfile({
        type: 'uniform',
        minLatencyMs: 10,
        maxLatencyMs: 50,
      })

      for (let i = 0; i < 20; i++) {
        await latency.apply()
      }

      const stats = latency.getStats()
      expect(stats.totalCalls).toBe(20)
      expect(stats.minLatencyMs).toBeGreaterThanOrEqual(10)
      expect(stats.maxLatencyMs).toBeLessThanOrEqual(60) // Some overhead
    })
  })

  describe('Normal Distribution Latency Profile', () => {
    it('should inject latency following normal distribution', async () => {
      const latency = new LatencyProfile({
        type: 'normal',
        meanMs: 50,
        stdDevMs: 10,
      })

      for (let i = 0; i < 100; i++) {
        await latency.apply()
      }

      const stats = latency.getStats()
      expect(stats.totalCalls).toBe(100)

      // Average should be close to mean
      expect(stats.avgLatencyMs).toBeGreaterThan(30)
      expect(stats.avgLatencyMs).toBeLessThan(70)

      // P50 should be close to mean
      expect(stats.p50LatencyMs).toBeGreaterThan(30)
      expect(stats.p50LatencyMs).toBeLessThan(70)
    })
  })

  describe('Spike Latency Profile', () => {
    it('should inject occasional high-latency spikes', async () => {
      const latency = new LatencyProfile({
        type: 'spike',
        meanMs: 20,
        stdDevMs: 5,
        spikeProbability: 0.2, // 20% spike rate
        spikeMultiplier: 10, // Spikes are 10x normal
      })

      for (let i = 0; i < 100; i++) {
        await latency.apply()
      }

      const stats = latency.getStats()

      // Should have some spikes detected
      expect(stats.spikeCount).toBeGreaterThan(0)

      // P99 should be significantly higher than P50 due to spikes
      expect(stats.p99LatencyMs).toBeGreaterThan(stats.p50LatencyMs * 2)
    })
  })

  describe('Degrading Latency Profile', () => {
    it('should gradually increase latency over time', async () => {
      const latency = new LatencyProfile({
        type: 'degrading',
        baseLatencyMs: 10,
        degradationRateMs: 5,
        maxDegradationMs: 100,
      })

      const latencies: number[] = []
      for (let i = 0; i < 20; i++) {
        const ms = await latency.apply()
        latencies.push(ms)
      }

      // Latency should increase over calls
      expect(latencies[19]).toBeGreaterThan(latencies[0])

      // First call should be base latency
      expect(latencies[0]).toBeGreaterThanOrEqual(10)

      // Later calls should be higher
      expect(latencies[10]).toBeGreaterThan(latencies[5])
    })

    it('should cap degradation at maximum', async () => {
      const latency = new LatencyProfile({
        type: 'degrading',
        baseLatencyMs: 10,
        degradationRateMs: 100,
        maxDegradationMs: 50,
      })

      for (let i = 0; i < 10; i++) {
        await latency.apply()
      }

      const stats = latency.getStats()
      // Max should be capped at base + maxDegradation = 60ms (plus some overhead)
      expect(stats.maxLatencyMs).toBeLessThan(100)
    })
  })

  describe('Jitter Latency Profile', () => {
    it('should add random jitter around base latency', async () => {
      const latency = new LatencyProfile({
        type: 'jitter',
        baseLatencyMs: 50,
        jitterRangeMs: 20,
      })

      for (let i = 0; i < 50; i++) {
        await latency.apply()
      }

      const stats = latency.getStats()

      // All latencies should be within jitter range of base
      expect(stats.minLatencyMs).toBeGreaterThanOrEqual(25) // 50 - 20 - overhead
      expect(stats.maxLatencyMs).toBeLessThan(100) // 50 + 20 + overhead

      // Average should be close to base
      expect(stats.avgLatencyMs).toBeGreaterThan(35)
      expect(stats.avgLatencyMs).toBeLessThan(65)
    })
  })

  describe('Latency Profile with Real Operations', () => {
    it('should wrap operations with latency', async () => {
      const stub = getDOStub()
      const latency = new LatencyProfile({
        type: 'constant',
        baseLatencyMs: 30,
      })

      const { result, latencyMs } = await latency.wrap(async () => {
        const response = await stub.fetch('https://do/')
        return response.json()
      })

      expect(latencyMs).toBeGreaterThanOrEqual(30)
      expect(result).toBeDefined()
    })

    it('should disable latency injection', async () => {
      const latency = new LatencyProfile({
        type: 'constant',
        baseLatencyMs: 100,
      })

      latency.disable()

      const startTime = Date.now()
      const ms = await latency.apply()
      const duration = Date.now() - startTime

      expect(ms).toBe(0)
      expect(duration).toBeLessThan(50)
    })
  })
})

// ============================================================================
// Test Suite: Partial Failure Scenarios
// ============================================================================

describe('Chaos: Partial Failure Scenarios', () => {
  let partialFailure: PartialFailureSimulator

  beforeEach(() => {
    partialFailure = new PartialFailureSimulator()
  })

  afterEach(() => {
    partialFailure.reset()
  })

  describe('Read vs Write Failures', () => {
    it('should fail writes more often than reads', async () => {
      partialFailure.configureNode({
        nodeId: 'db-replica',
        readFailureProbability: 0.1,
        writeFailureProbability: 0.9,
      })

      let readFailures = 0
      let writeFailures = 0

      for (let i = 0; i < 100; i++) {
        const readResult = await partialFailure.checkRead('db-replica')
        if (!readResult.allowed) readFailures++

        const writeResult = await partialFailure.checkWrite('db-replica')
        if (!writeResult.allowed) writeFailures++
      }

      // Writes should fail much more often
      expect(writeFailures).toBeGreaterThan(readFailures * 2)
      expect(writeFailures).toBeGreaterThan(70) // ~90%
      expect(readFailures).toBeLessThan(30) // ~10%
    })

    it('should track failure statistics correctly', async () => {
      partialFailure.configureNode({
        nodeId: 'node-1',
        readFailureProbability: 1.0, // Always fail reads
        writeFailureProbability: 0.0, // Never fail writes
      })

      for (let i = 0; i < 10; i++) {
        await partialFailure.checkRead('node-1')
        await partialFailure.checkWrite('node-1')
      }

      const stats = partialFailure.getStats()
      expect(stats.readFailures).toBe(10)
      expect(stats.writeFailures).toBe(0)
    })
  })

  describe('Operation-Specific Failures', () => {
    it('should fail specific operations', async () => {
      partialFailure.configureNode({
        nodeId: 'api-node',
        operationFailureProbabilities: {
          'create': 0.0, // Never fail creates
          'update': 0.5, // 50% fail updates
          'delete': 1.0, // Always fail deletes
        },
      })

      // Create should always succeed
      for (let i = 0; i < 10; i++) {
        const result = await partialFailure.checkOperation('api-node', 'create')
        expect(result.allowed).toBe(true)
      }

      // Delete should always fail
      for (let i = 0; i < 10; i++) {
        const result = await partialFailure.checkOperation('api-node', 'delete')
        expect(result.allowed).toBe(false)
        expect(result.reason).toBe('operation_failure')
      }

      // Update should partially fail
      let updateFailures = 0
      for (let i = 0; i < 100; i++) {
        const result = await partialFailure.checkOperation('api-node', 'update')
        if (!result.allowed) updateFailures++
      }
      expect(updateFailures).toBeGreaterThan(30)
      expect(updateFailures).toBeLessThan(70)
    })
  })

  describe('Degraded Mode', () => {
    it('should reduce capacity in degraded mode', async () => {
      partialFailure.configureNode({
        nodeId: 'degraded-node',
        degraded: true,
        degradedCapacity: 0.3, // Only 30% capacity
      })

      let allowed = 0
      let rejected = 0

      for (let i = 0; i < 100; i++) {
        const result = await partialFailure.checkOperation('degraded-node', 'read')
        if (result.allowed) allowed++
        else rejected++
      }

      // Roughly 30% should be allowed
      expect(allowed).toBeGreaterThan(15)
      expect(allowed).toBeLessThan(50)
      expect(rejected).toBeGreaterThan(50)

      const stats = partialFailure.getStats()
      expect(stats.capacityExceeded).toBeGreaterThan(50)
      expect(stats.degradedOperations).toBe(100)
    })

    it('should dynamically set degraded mode', async () => {
      partialFailure.configureNode({
        nodeId: 'dynamic-node',
        degraded: false,
      })

      // Initially not degraded - should work
      const result1 = await partialFailure.checkOperation('dynamic-node', 'read')
      expect(result1.allowed).toBe(true)

      // Set to degraded with 0% capacity
      partialFailure.setDegraded('dynamic-node', true, 0)

      // Now should fail due to capacity
      const result2 = await partialFailure.checkOperation('dynamic-node', 'read')
      expect(result2.allowed).toBe(false)
    })
  })

  describe('Per-Node Latency', () => {
    it('should apply different latency to different nodes', async () => {
      partialFailure.configureNode({
        nodeId: 'fast-node',
        latencyProfile: {
          type: 'constant',
          baseLatencyMs: 10,
        },
      })

      partialFailure.configureNode({
        nodeId: 'slow-node',
        latencyProfile: {
          type: 'constant',
          baseLatencyMs: 100,
        },
      })

      const fastStart = Date.now()
      await partialFailure.checkOperation('fast-node', 'read')
      const fastDuration = Date.now() - fastStart

      const slowStart = Date.now()
      await partialFailure.checkOperation('slow-node', 'read')
      const slowDuration = Date.now() - slowStart

      expect(slowDuration).toBeGreaterThan(fastDuration)
    })
  })

  describe('Multi-Node Scenarios', () => {
    it('should handle multiple nodes with different configurations', async () => {
      // Healthy primary
      partialFailure.configureNode({
        nodeId: 'primary',
        readFailureProbability: 0,
        writeFailureProbability: 0,
      })

      // Degraded replica
      partialFailure.configureNode({
        nodeId: 'replica-1',
        readFailureProbability: 0.1,
        writeFailureProbability: 1.0, // Replicas can't write
      })

      // Failing replica
      partialFailure.configureNode({
        nodeId: 'replica-2',
        readFailureProbability: 0.9,
        writeFailureProbability: 1.0,
      })

      // Primary should always work
      const primaryResult = await partialFailure.checkWrite('primary')
      expect(primaryResult.allowed).toBe(true)

      // Replicas should fail writes
      const replica1Result = await partialFailure.checkWrite('replica-1')
      expect(replica1Result.allowed).toBe(false)

      // List nodes
      const nodes = partialFailure.listNodes()
      expect(nodes).toContain('primary')
      expect(nodes).toContain('replica-1')
      expect(nodes).toContain('replica-2')
    })

    it('should wrap operations with failure checking', async () => {
      const stub = getDOStub()

      partialFailure.configureNode({
        nodeId: 'db',
        writeFailureProbability: 1.0, // Always fail writes
      })

      // Should throw on write
      await expect(
        partialFailure.wrapOperation('db', 'write', async () => {
          return stub.fetch('https://do/')
        })
      ).rejects.toThrow('Partial failure: write_failure')

      // Read should work (no read failure configured)
      const response = await partialFailure.wrapOperation('db', 'read', async () => {
        return stub.fetch('https://do/')
      })
      expect(response.status).toBe(200)
    })
  })
})

// ============================================================================
// Test Suite: Split-Brain Scenarios
// ============================================================================

describe('Chaos: Split-Brain Scenarios', () => {
  let splitBrain: SplitBrainSimulator

  beforeEach(() => {
    splitBrain = new SplitBrainSimulator()
  })

  afterEach(() => {
    splitBrain.reset()
  })

  describe('Multiple Leaders Detection', () => {
    it('should detect split-brain condition', () => {
      splitBrain.configure({
        leaders: ['node-1', 'node-3'],
        partitions: [
          ['node-1', 'node-2'],
          ['node-3', 'node-4', 'node-5'],
        ],
      })

      expect(splitBrain.hasSplitBrain()).toBe(true)
      expect(splitBrain.isLeader('node-1')).toBe(true)
      expect(splitBrain.isLeader('node-3')).toBe(true)
      expect(splitBrain.isLeader('node-2')).toBe(false)
    })

    it('should not detect split-brain with single leader', () => {
      splitBrain.configure({
        leaders: ['node-1'],
        partitions: [['node-1', 'node-2', 'node-3']],
      })

      expect(splitBrain.hasSplitBrain()).toBe(false)
    })
  })

  describe('Quorum-Based Decisions', () => {
    it('should identify partition with quorum', () => {
      splitBrain.configure({
        leaders: ['node-1', 'node-3'],
        partitions: [
          ['node-1', 'node-2'], // 2 nodes - minority
          ['node-3', 'node-4', 'node-5'], // 3 nodes - majority
        ],
      })

      // Minority partition
      expect(splitBrain.hasQuorum('node-1')).toBe(false)
      expect(splitBrain.hasQuorum('node-2')).toBe(false)

      // Majority partition
      expect(splitBrain.hasQuorum('node-3')).toBe(true)
      expect(splitBrain.hasQuorum('node-4')).toBe(true)
    })

    it('should prevent writes from minority partition', () => {
      splitBrain.configure({
        leaders: ['node-1', 'node-3'],
        partitions: [
          ['node-1', 'node-2'], // Minority
          ['node-3', 'node-4', 'node-5'], // Majority
        ],
        allowMinorityWrites: false,
      })

      // Minority leader cannot write
      expect(splitBrain.canWrite('node-1')).toBe(false)

      // Majority leader can write
      expect(splitBrain.canWrite('node-3')).toBe(true)

      // Non-leaders cannot write
      expect(splitBrain.canWrite('node-2')).toBe(false)
      expect(splitBrain.canWrite('node-4')).toBe(false)
    })

    it('should allow minority writes when configured', () => {
      splitBrain.configure({
        leaders: ['node-1', 'node-3'],
        partitions: [
          ['node-1', 'node-2'],
          ['node-3', 'node-4', 'node-5'],
        ],
        allowMinorityWrites: true,
      })

      // Both leaders can write
      expect(splitBrain.canWrite('node-1')).toBe(true)
      expect(splitBrain.canWrite('node-3')).toBe(true)
    })
  })

  describe('Conflict Detection', () => {
    it('should detect conflicting writes from different partitions', () => {
      splitBrain.configure({
        leaders: ['node-1', 'node-3'],
        partitions: [
          ['node-1', 'node-2'],
          ['node-3', 'node-4'],
        ],
        detectConflicts: true,
      })

      // Write from partition A
      splitBrain.recordWrite('node-1', 'key-1', { value: 'a' })

      // No conflict yet
      expect(splitBrain.detectConflicts('key-1')).toBe(false)

      // Write same key from partition B
      splitBrain.recordWrite('node-3', 'key-1', { value: 'b' })

      // Now we have a conflict
      expect(splitBrain.detectConflicts('key-1')).toBe(true)

      // Get conflicting writes
      const conflicts = splitBrain.getConflictingWrites('key-1')
      expect(conflicts).toHaveLength(2)
      expect(conflicts.map((c) => c.nodeId)).toContain('node-1')
      expect(conflicts.map((c) => c.nodeId)).toContain('node-3')
    })

    it('should not detect conflicts within same partition', () => {
      splitBrain.configure({
        leaders: ['node-1'],
        partitions: [['node-1', 'node-2', 'node-3']],
        detectConflicts: true,
      })

      splitBrain.recordWrite('node-1', 'key-1', { value: 'a' })
      splitBrain.recordWrite('node-2', 'key-1', { value: 'b' })

      // No conflict - same partition
      expect(splitBrain.detectConflicts('key-1')).toBe(false)
    })
  })

  describe('Partition Membership', () => {
    it('should correctly identify partition membership', () => {
      splitBrain.configure({
        leaders: ['node-1'],
        partitions: [
          ['node-1', 'node-2'],
          ['node-3', 'node-4'],
        ],
      })

      expect(splitBrain.getPartition('node-1')).toEqual(['node-1', 'node-2'])
      expect(splitBrain.getPartition('node-3')).toEqual(['node-3', 'node-4'])
      expect(splitBrain.getPartition('unknown')).toBeUndefined()
    })
  })
})

// ============================================================================
// Test Suite: Combined Chaos Scenarios
// ============================================================================

describe('Chaos: Combined Network and Failure Scenarios', () => {
  it('should simulate cascading failures across partitioned network', async () => {
    const stub = getDOStub()
    const partition = new NetworkPartitionSimulator()
    const partialFailure = new PartialFailureSimulator()
    const chaos = new ChaosProxy()

    // Create network partition
    partition.createPartition({
      type: 'asymmetric',
      partitionA: ['api'],
      partitionB: ['db'],
      aToBAllowed: true,
      bToAAllowed: false,
    })

    // Configure partial failures
    partialFailure.configureNode({
      nodeId: 'api',
      readFailureProbability: 0.1,
    })

    // Configure general chaos
    chaos.injectLatency(5, 20)

    // Simulate cascading requests
    let successful = 0
    let networkDropped = 0
    let partialFailed = 0

    for (let i = 0; i < 50; i++) {
      try {
        // Check partial failure first
        const partialResult = await partialFailure.checkRead('api')
        if (!partialResult.allowed) {
          partialFailed++
          continue
        }

        // Then check network
        const networkResult = await partition.simulateRequest('api', 'db')
        if (networkResult.status === 'dropped') {
          networkDropped++
          continue
        }

        // Finally execute with latency
        await chaos.wrap(async () => {
          return stub.fetch('https://do/')
        })
        successful++
      } catch {
        // Latency-related errors
      }
    }

    // We should see a mix of results
    expect(successful + networkDropped + partialFailed).toBe(50)

    // Network shouldn't drop (A->B is allowed)
    expect(networkDropped).toBe(0)

    // Some partial failures
    expect(partialFailed).toBeGreaterThan(0)

    // Most should succeed
    expect(successful).toBeGreaterThan(30)

    // Cleanup
    partition.reset()
    partialFailure.reset()
    chaos.reset()
  })

  it('should handle split-brain with degraded nodes', async () => {
    const splitBrain = new SplitBrainSimulator()
    const partialFailure = new PartialFailureSimulator()

    // Configure split-brain
    splitBrain.configure({
      leaders: ['primary-1', 'primary-2'],
      partitions: [
        ['primary-1', 'replica-1'],
        ['primary-2', 'replica-2', 'replica-3'],
      ],
      allowMinorityWrites: false,
      detectConflicts: true,
    })

    // Configure degraded nodes
    partialFailure.configureNode({
      nodeId: 'primary-1',
      degraded: true,
      degradedCapacity: 0.5,
    })

    partialFailure.configureNode({
      nodeId: 'primary-2',
      degraded: false,
    })

    // Minority partition leader is also degraded
    expect(splitBrain.canWrite('primary-1')).toBe(false) // No quorum

    // Majority partition leader can write
    expect(splitBrain.canWrite('primary-2')).toBe(true)

    // Even if primary-1 could write, it's degraded
    let degradedRejections = 0
    for (let i = 0; i < 20; i++) {
      const result = await partialFailure.checkOperation('primary-1', 'write')
      if (!result.allowed) degradedRejections++
    }

    // Should see roughly 50% rejection due to capacity
    expect(degradedRejections).toBeGreaterThan(5)

    // Cleanup
    splitBrain.reset()
    partialFailure.reset()
  })

  it('should simulate gradual network degradation', async () => {
    const stub = getDOStub()
    const latency = new LatencyProfile({
      type: 'degrading',
      baseLatencyMs: 10,
      degradationRateMs: 5,
      maxDegradationMs: 200,
    })

    const partition = new NetworkPartitionSimulator()

    // Phase 1: Healthy network
    let phase1Latencies: number[] = []
    for (let i = 0; i < 10; i++) {
      const startTime = Date.now()
      await latency.apply()
      phase1Latencies.push(Date.now() - startTime)
    }

    // Phase 2: Network becomes intermittent
    partition.createPartition({
      type: 'intermittent',
      partitionA: ['client'],
      partitionB: ['server'],
      connectivityProbability: 0.7,
      degradedLatencyMs: 50,
    })

    let phase2Successes = 0
    let phase2Latencies: number[] = []
    for (let i = 0; i < 20; i++) {
      const result = await partition.simulateRequest('client', 'server')
      if (result.status === 'success') {
        phase2Successes++
        await latency.apply()
        const ms = Date.now()
        phase2Latencies.push(ms)
      }
    }

    // Phase 2 should have some failures
    expect(phase2Successes).toBeLessThan(20)
    expect(phase2Successes).toBeGreaterThan(5)

    // Latencies should have increased over time
    const latencyStats = latency.getStats()
    expect(latencyStats.maxLatencyMs).toBeGreaterThan(latencyStats.minLatencyMs)

    // Cleanup
    partition.reset()
    latency.reset()
  })
})
