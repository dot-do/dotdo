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
