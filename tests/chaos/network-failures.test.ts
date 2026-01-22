/**
 * Network Failure Chaos Tests
 *
 * Tests for system resilience under various network failure conditions:
 * - Network timeouts
 * - Connection refused scenarios
 * - Intermittent failures
 *
 * @see do-2tlpd - Add chaos/resilience testing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface NetworkError extends Error {
  code?: string
  cause?: Error
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `network-chaos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
 * Simulates a network timeout by racing against a timeout promise
 */
async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      const error: NetworkError = new Error(`Network timeout after ${timeoutMs}ms`)
      error.code = 'ETIMEDOUT'
      reject(error)
    }, timeoutMs)
  })

  return Promise.race([operation(), timeoutPromise])
}

/**
 * Simulates connection refused error
 */
function createConnectionRefusedError(): NetworkError {
  const error: NetworkError = new Error('Connection refused')
  error.code = 'ECONNREFUSED'
  return error
}

/**
 * Simulates intermittent network failures with configurable probability
 */
class IntermittentNetworkSimulator {
  private failureProbability: number
  private successCount = 0
  private failureCount = 0

  constructor(failureProbability: number) {
    this.failureProbability = failureProbability
  }

  shouldFail(): boolean {
    const fails = Math.random() < this.failureProbability
    if (fails) {
      this.failureCount++
    } else {
      this.successCount++
    }
    return fails
  }

  async wrap<T>(operation: () => Promise<T>): Promise<T> {
    if (this.shouldFail()) {
      const error: NetworkError = new Error('Intermittent network failure')
      error.code = 'ENETUNREACH'
      throw error
    }
    return operation()
  }

  getStats() {
    return {
      successCount: this.successCount,
      failureCount: this.failureCount,
      totalAttempts: this.successCount + this.failureCount,
      actualFailureRate: this.failureCount / (this.successCount + this.failureCount),
    }
  }

  reset() {
    this.successCount = 0
    this.failureCount = 0
  }
}

/**
 * Retry helper with exponential backoff
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries: number
    baseDelayMs: number
    maxDelayMs?: number
  }
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs = 5000 } = options
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error
      if (attempt < maxRetries - 1) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}

// ============================================================================
// Test Suite: Network Timeouts
// ============================================================================

describe('Network Failures: Timeouts', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should timeout when operation exceeds threshold', async () => {
    const stub = getDOStub()

    // Create a slow operation that will be timed out
    const slowOperation = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      return stub.fetch('https://do/')
    }

    await expect(withTimeout(slowOperation, 100)).rejects.toThrow(
      'Network timeout after 100ms'
    )
  })

  it('should succeed when operation completes within timeout', async () => {
    const stub = getDOStub()

    const fastOperation = async () => {
      return stub.fetch('https://do/')
    }

    const response = await withTimeout(fastOperation, 5000)
    expect(response.status).toBe(200)
  })

  it('should include correct error code on timeout', async () => {
    const slowOperation = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      return 'done'
    }

    try {
      await withTimeout(slowOperation, 50)
      expect.fail('Should have thrown')
    } catch (error) {
      const networkError = error as NetworkError
      expect(networkError.code).toBe('ETIMEDOUT')
    }
  })

  it('should handle multiple concurrent operations with timeouts', async () => {
    const stub = getDOStub()

    const operations = Array.from({ length: 5 }, (_, i) => {
      // Mix of fast and slow operations
      const isSlow = i % 2 === 0
      return withTimeout(
        async () => {
          if (isSlow) {
            await new Promise((resolve) => setTimeout(resolve, 5000))
          }
          return stub.fetch(`https://do/?id=${i}`)
        },
        isSlow ? 50 : 5000
      )
    })

    const results = await Promise.allSettled(operations)

    // Slow operations (indices 0, 2, 4) should timeout
    const rejected = results.filter((r) => r.status === 'rejected')
    const fulfilled = results.filter((r) => r.status === 'fulfilled')

    expect(rejected.length).toBe(3)
    expect(fulfilled.length).toBe(2)
  })
})

// ============================================================================
// Test Suite: Connection Refused
// ============================================================================

describe('Network Failures: Connection Refused', () => {
  it('should create proper connection refused error', () => {
    const error = createConnectionRefusedError()

    expect(error.message).toBe('Connection refused')
    expect(error.code).toBe('ECONNREFUSED')
  })

  it('should handle connection refused with retry logic', async () => {
    const stub = getDOStub()
    let attempts = 0
    const maxFailures = 2

    const unreliableOperation = async () => {
      attempts++
      if (attempts <= maxFailures) {
        throw createConnectionRefusedError()
      }
      return stub.fetch('https://do/')
    }

    const response = await retryWithBackoff(unreliableOperation, {
      maxRetries: 5,
      baseDelayMs: 10,
    })

    expect(response.status).toBe(200)
    expect(attempts).toBe(3) // 2 failures + 1 success
  })

  it('should fail after exhausting retries', async () => {
    const alwaysRefused = async () => {
      throw createConnectionRefusedError()
    }

    await expect(
      retryWithBackoff(alwaysRefused, {
        maxRetries: 3,
        baseDelayMs: 10,
      })
    ).rejects.toThrow('Connection refused')
  })

  it('should track connection refused errors correctly', async () => {
    const errors: NetworkError[] = []

    for (let i = 0; i < 5; i++) {
      try {
        throw createConnectionRefusedError()
      } catch (error) {
        errors.push(error as NetworkError)
      }
    }

    expect(errors).toHaveLength(5)
    expect(errors.every((e) => e.code === 'ECONNREFUSED')).toBe(true)
  })
})

// ============================================================================
// Test Suite: Intermittent Failures
// ============================================================================

describe('Network Failures: Intermittent', () => {
  let simulator: IntermittentNetworkSimulator

  beforeEach(() => {
    simulator = new IntermittentNetworkSimulator(0.3) // 30% failure rate
  })

  afterEach(() => {
    simulator.reset()
  })

  it('should fail probabilistically based on configured rate', async () => {
    const stub = getDOStub()
    let successes = 0
    let failures = 0

    for (let i = 0; i < 100; i++) {
      try {
        await simulator.wrap(async () => stub.fetch('https://do/'))
        successes++
      } catch {
        failures++
      }
    }

    // With 30% failure rate, expect roughly 30 failures (allow variance)
    expect(failures).toBeGreaterThan(15)
    expect(failures).toBeLessThan(50)
    expect(successes).toBeGreaterThan(50)
    expect(successes + failures).toBe(100)
  })

  it('should track failure statistics accurately', async () => {
    const stub = getDOStub()

    for (let i = 0; i < 50; i++) {
      try {
        await simulator.wrap(async () => stub.fetch('https://do/'))
      } catch {
        // Expected failures
      }
    }

    const stats = simulator.getStats()
    expect(stats.totalAttempts).toBe(50)
    expect(stats.successCount + stats.failureCount).toBe(50)
    expect(stats.actualFailureRate).toBeGreaterThan(0)
    expect(stats.actualFailureRate).toBeLessThan(1)
  })

  it('should include correct error code for network unreachable', async () => {
    const alwaysFails = new IntermittentNetworkSimulator(1.0) // 100% failure

    try {
      await alwaysFails.wrap(async () => 'test')
      expect.fail('Should have thrown')
    } catch (error) {
      const networkError = error as NetworkError
      expect(networkError.code).toBe('ENETUNREACH')
      expect(networkError.message).toBe('Intermittent network failure')
    }
  })

  it('should allow all requests when failure rate is 0', async () => {
    const reliableNetwork = new IntermittentNetworkSimulator(0.0)
    const stub = getDOStub()

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        reliableNetwork.wrap(async () => stub.fetch('https://do/'))
      )
    )

    expect(results).toHaveLength(20)
    results.forEach((response) => {
      expect(response.status).toBe(200)
    })

    const stats = reliableNetwork.getStats()
    expect(stats.failureCount).toBe(0)
    expect(stats.successCount).toBe(20)
  })

  it('should fail all requests when failure rate is 1', async () => {
    const unreliableNetwork = new IntermittentNetworkSimulator(1.0)

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        unreliableNetwork.wrap(async () => 'test')
      )
    )

    expect(results.every((r) => r.status === 'rejected')).toBe(true)

    const stats = unreliableNetwork.getStats()
    expect(stats.failureCount).toBe(10)
    expect(stats.successCount).toBe(0)
  })

  it('should handle intermittent failures with retry mechanism', async () => {
    const stub = getDOStub()
    const flakeyNetwork = new IntermittentNetworkSimulator(0.5) // 50% failure

    // With retries, even flakey networks should eventually succeed
    const response = await retryWithBackoff(
      () => flakeyNetwork.wrap(async () => stub.fetch('https://do/')),
      {
        maxRetries: 10,
        baseDelayMs: 5,
      }
    )

    expect(response.status).toBe(200)
  })

  it('should reset statistics correctly', async () => {
    const stub = getDOStub()

    // Generate some stats
    for (let i = 0; i < 20; i++) {
      try {
        await simulator.wrap(async () => stub.fetch('https://do/'))
      } catch {
        // Expected
      }
    }

    expect(simulator.getStats().totalAttempts).toBe(20)

    // Reset and verify
    simulator.reset()

    const stats = simulator.getStats()
    expect(stats.totalAttempts).toBe(0)
    expect(stats.successCount).toBe(0)
    expect(stats.failureCount).toBe(0)
  })
})

// ============================================================================
// Test Suite: Combined Network Failure Scenarios
// ============================================================================

describe('Network Failures: Combined Scenarios', () => {
  it('should handle timeout during intermittent failure recovery', async () => {
    const stub = getDOStub()
    const flakeyNetwork = new IntermittentNetworkSimulator(0.5)
    let attempts = 0

    const operation = async () => {
      attempts++
      return flakeyNetwork.wrap(async () => {
        // Simulate slow response on some attempts
        if (attempts % 2 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
        return stub.fetch('https://do/')
      })
    }

    // This may timeout or succeed depending on randomness
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => withTimeout(operation, 100))
    )

    // Should have a mix of results
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled.length + rejected.length).toBe(10)
    // With 50% failure rate and potential timeouts, expect some failures
    expect(rejected.length).toBeGreaterThan(0)
  })

  it('should maintain system stability under mixed failure conditions', async () => {
    const stub = getDOStub()
    const flakeyNetwork = new IntermittentNetworkSimulator(0.2)

    // Run multiple rounds of requests
    const rounds = 3
    const requestsPerRound = 20
    const roundStats: { successes: number; failures: number }[] = []

    for (let round = 0; round < rounds; round++) {
      let successes = 0
      let failures = 0

      for (let i = 0; i < requestsPerRound; i++) {
        try {
          await flakeyNetwork.wrap(async () => stub.fetch('https://do/'))
          successes++
        } catch {
          failures++
        }
      }

      roundStats.push({ successes, failures })
      flakeyNetwork.reset()
    }

    // Each round should have similar success rates (no degradation)
    const successRates = roundStats.map(
      (s) => s.successes / (s.successes + s.failures)
    )

    // All rounds should have reasonable success rates (> 60% with 20% failure config)
    successRates.forEach((rate) => {
      expect(rate).toBeGreaterThan(0.5)
    })
  })

  it('should properly categorize different network error types', async () => {
    const errorTypes: Record<string, number> = {
      ETIMEDOUT: 0,
      ECONNREFUSED: 0,
      ENETUNREACH: 0,
    }

    // Generate different types of errors
    const operations = [
      async () => {
        throw { message: 'timeout', code: 'ETIMEDOUT' } as NetworkError
      },
      async () => {
        throw createConnectionRefusedError()
      },
      async () => {
        const sim = new IntermittentNetworkSimulator(1.0)
        await sim.wrap(async () => 'test')
      },
    ]

    for (const op of operations) {
      try {
        await op()
      } catch (error) {
        const code = (error as NetworkError).code
        if (code && code in errorTypes) {
          errorTypes[code]++
        }
      }
    }

    expect(errorTypes.ETIMEDOUT).toBe(1)
    expect(errorTypes.ECONNREFUSED).toBe(1)
    expect(errorTypes.ENETUNREACH).toBe(1)
  })
})
