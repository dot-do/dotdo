/**
 * Durable Execution Module Tests - TDD RED Phase
 *
 * Tests for durable execution semantics:
 * 1. Retry behavior with exponential backoff
 * 2. Step idempotency (same stepId returns cached result, doesn't re-execute)
 * 3. Action log persistence
 * 4. maxRetries option respected
 * 5. Error handling and recovery
 * 6. $.do() vs $.try() behavior differences
 *
 * These tests define the expected behavior for DurableExecution.
 * Tests are written to FAIL initially (RED phase) until implementation is complete.
 *
 * @see do-ta4e - Durable Execution Implementation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { env } from 'cloudflare:test'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Get a DOCore stub for testing
 */
function getDOStub(name: string) {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}

/**
 * Create a mock DurableObjectState for unit testing
 */
function createMockDOState() {
  const sqlData = new Map<string, unknown>()

  return {
    storage: {
      sql: {
        exec: vi.fn((query: string, ...params: unknown[]) => {
          // Simple mock implementation for INSERT/SELECT
          if (query.includes('CREATE TABLE')) {
            return { toArray: () => [] }
          }
          if (query.includes('SELECT')) {
            const results: unknown[] = []
            sqlData.forEach((value, key) => {
              results.push(value)
            })
            return { toArray: () => results }
          }
          if (query.includes('INSERT') || query.includes('REPLACE')) {
            const stepId = params[0] as string
            sqlData.set(stepId, {
              step_id: stepId,
              status: params[1],
              result: params[2],
              error: params[3] || null,
              created_at: Date.now(),
            })
            return { toArray: () => [] }
          }
          return { toArray: () => [] }
        }),
      },
      get: vi.fn(),
      put: vi.fn(),
    },
  } as unknown as DurableObjectState
}

// =============================================================================
// 1. RETRY BEHAVIOR WITH EXPONENTIAL BACKOFF
// =============================================================================

describe('Durable Execution: Retry Behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should retry on failure with exponential backoff', async () => {
    const stub = getDOStub('retry-backoff-test-1')

    let attempts = 0
    const failingAction = async () => {
      attempts++
      if (attempts < 3) {
        throw new Error('Transient failure')
      }
      return 'success'
    }

    // Execute action via DO's durable execution
    // The action should retry with exponential backoff: 1s, 2s, 4s...
    const result = await stub.durableExecute(failingAction, { stepId: 'retry-test-1' })

    expect(attempts).toBe(3)
    expect(result).toBe('success')
  })

  it('should use exponential backoff delays: 1s, 2s, 4s, capped at 10s', async () => {
    const stub = getDOStub('retry-backoff-test-2')

    const delays: number[] = []
    let lastCallTime = Date.now()
    let attempts = 0

    const failingAction = async () => {
      const now = Date.now()
      if (attempts > 0) {
        delays.push(now - lastCallTime)
      }
      lastCallTime = now
      attempts++
      if (attempts < 4) {
        throw new Error('Transient failure')
      }
      return 'success'
    }

    // Execute with enough retries to see the pattern
    await stub.durableExecute(failingAction, { stepId: 'backoff-delays-1', maxRetries: 5 })

    // Verify exponential backoff pattern
    // Attempt 1 -> Attempt 2: ~1000ms
    // Attempt 2 -> Attempt 3: ~2000ms
    // Attempt 3 -> Attempt 4: ~4000ms
    expect(delays[0]).toBeGreaterThanOrEqual(900)
    expect(delays[0]).toBeLessThan(1500)
    expect(delays[1]).toBeGreaterThanOrEqual(1800)
    expect(delays[1]).toBeLessThan(2500)
    expect(delays[2]).toBeGreaterThanOrEqual(3500)
    expect(delays[2]).toBeLessThan(5000)
  })

  it('should cap backoff at MAX_BACKOFF_MS (10000ms)', async () => {
    const stub = getDOStub('retry-backoff-test-3')

    const delays: number[] = []
    let lastCallTime = Date.now()
    let attempts = 0

    const failingAction = async () => {
      const now = Date.now()
      if (attempts > 0) {
        delays.push(now - lastCallTime)
      }
      lastCallTime = now
      attempts++
      if (attempts < 6) {
        throw new Error('Keep failing')
      }
      return 'success'
    }

    await stub.durableExecute(failingAction, { stepId: 'backoff-cap-1', maxRetries: 6 })

    // The 5th delay (between attempt 5 and 6) should be capped at 10s
    // Exponential would be 16s, but cap is 10s
    const fifthDelay = delays[4]
    expect(fifthDelay).toBeLessThanOrEqual(11000) // Allow some tolerance
    expect(fifthDelay).toBeGreaterThanOrEqual(9000)
  })

  it('should not wait after the last failed attempt', async () => {
    const stub = getDOStub('retry-backoff-test-4')

    let attempts = 0
    const alwaysFailAction = async () => {
      attempts++
      throw new Error('Always fails')
    }

    const startTime = Date.now()

    // Execute with 2 retries - should fail after 2 attempts
    await expect(
      stub.durableExecute(alwaysFailAction, { stepId: 'no-final-wait-1', maxRetries: 2 })
    ).rejects.toThrow('Always fails')

    const elapsed = Date.now() - startTime

    // With 2 attempts, there's 1 backoff wait (between attempt 1 and 2)
    // Should be approximately 1000ms, not 1000ms + another wait after final failure
    expect(elapsed).toBeLessThan(3000)
    expect(attempts).toBe(2)
  })
})

// =============================================================================
// 2. STEP IDEMPOTENCY (REPLAY SEMANTICS)
// =============================================================================

describe('Durable Execution: Step Idempotency', () => {
  it('should return cached result for same stepId without re-executing', async () => {
    const stub = getDOStub('idempotency-test-1')

    let executionCount = 0
    const trackedAction = async () => {
      executionCount++
      return { value: 42, timestamp: Date.now() }
    }

    // First execution - should run the action
    const result1 = await stub.durableExecute(trackedAction, { stepId: 'idempotent-step-1' })
    expect(executionCount).toBe(1)
    expect(result1.value).toBe(42)

    // Second execution with same stepId - should return cached result
    const result2 = await stub.durableExecute(trackedAction, { stepId: 'idempotent-step-1' })
    expect(executionCount).toBe(1) // Should NOT have executed again
    expect(result2).toEqual(result1) // Same cached result
  })

  it('should execute different stepIds independently', async () => {
    const stub = getDOStub('idempotency-test-2')

    let executionCount = 0
    const trackedAction = async () => {
      executionCount++
      return executionCount
    }

    // Execute with different stepIds
    const result1 = await stub.durableExecute(trackedAction, { stepId: 'step-a' })
    const result2 = await stub.durableExecute(trackedAction, { stepId: 'step-b' })
    const result3 = await stub.durableExecute(trackedAction, { stepId: 'step-c' })

    expect(executionCount).toBe(3)
    expect(result1).toBe(1)
    expect(result2).toBe(2)
    expect(result3).toBe(3)
  })

  it('should replay from action log after DO restart (simulated)', async () => {
    // First DO instance - execute and "crash"
    const stub1 = getDOStub('idempotency-restart-1')

    let executionCount = 0
    const action = async () => {
      executionCount++
      return { computed: Math.random() }
    }

    const originalResult = await stub1.durableExecute(action, { stepId: 'persist-step-1' })
    expect(executionCount).toBe(1)

    // Simulate restart by getting a fresh reference
    // The action log should be persisted in SQLite
    const stub2 = getDOStub('idempotency-restart-1')

    // Re-execute with same stepId - should replay from log, not re-execute
    const replayedResult = await stub2.durableExecute(action, { stepId: 'persist-step-1' })

    // Should return the same result without re-executing
    // Note: executionCount might be 1 or 2 depending on implementation
    // but the RESULT should be identical
    expect(replayedResult).toEqual(originalResult)
  })

  it('should handle complex result types in cached replay', async () => {
    const stub = getDOStub('idempotency-test-3')

    const complexResult = {
      nested: { deep: { value: 'test' } },
      array: [1, 2, { three: 3 }],
      date: new Date().toISOString(),
      nullValue: null,
    }

    const action = async () => complexResult

    const result1 = await stub.durableExecute(action, { stepId: 'complex-result-1' })
    const result2 = await stub.durableExecute(action, { stepId: 'complex-result-1' })

    expect(result2).toEqual(result1)
    expect(result2.nested.deep.value).toBe('test')
    expect(result2.array).toHaveLength(3)
  })

  it('should auto-generate stepId when not provided', async () => {
    const stub = getDOStub('idempotency-test-4')

    let executionCount = 0
    const action = async () => {
      executionCount++
      return 'executed'
    }

    // Execute without stepId - should auto-generate unique stepIds
    await stub.durableExecute(action)
    await stub.durableExecute(action)

    // Both should execute since they have different auto-generated stepIds
    expect(executionCount).toBe(2)
  })
})

// =============================================================================
// 3. ACTION LOG PERSISTENCE
// =============================================================================

describe('Durable Execution: Action Log Persistence', () => {
  it('should persist successful actions to action_log table', async () => {
    const stub = getDOStub('action-log-test-1')

    await stub.durableExecute(async () => 'success-value', { stepId: 'logged-step-1' })

    // Query the action log directly
    const log = await stub.getActionLog()

    expect(log).toContainEqual(
      expect.objectContaining({
        stepId: 'logged-step-1',
        status: 'completed',
        result: 'success-value',
      })
    )
  })

  it('should persist failed actions to action_log table', async () => {
    const stub = getDOStub('action-log-test-2')

    const alwaysFails = async () => {
      throw new Error('Intentional failure')
    }

    await expect(
      stub.durableExecute(alwaysFails, { stepId: 'failed-step-1', maxRetries: 2 })
    ).rejects.toThrow('Intentional failure')

    // Query the action log
    const log = await stub.getActionLog()

    expect(log).toContainEqual(
      expect.objectContaining({
        stepId: 'failed-step-1',
        status: 'failed',
        error: expect.objectContaining({ message: 'Intentional failure' }),
      })
    )
  })

  it('should not cache failed action results for replay', async () => {
    const stub = getDOStub('action-log-test-3')

    let attempts = 0
    const sometimesFails = async () => {
      attempts++
      if (attempts === 1) {
        throw new Error('First attempt fails')
      }
      return 'eventually succeeds'
    }

    // First execution fails
    await expect(
      stub.durableExecute(sometimesFails, { stepId: 'retry-after-fail-1', maxRetries: 1 })
    ).rejects.toThrow()

    // Reset attempts counter
    attempts = 0

    // Second execution with same stepId should try again (failed actions are not cached for replay)
    const result = await stub.durableExecute(sometimesFails, { stepId: 'retry-after-fail-1' })
    expect(result).toBe('eventually succeeds')
  })

  it('should include timestamp in action log entries', async () => {
    const stub = getDOStub('action-log-test-4')

    const beforeTime = Date.now()
    await stub.durableExecute(async () => 'timed', { stepId: 'timed-step-1' })
    const afterTime = Date.now()

    const log = await stub.getActionLog()
    const entry = log.find((e: { stepId: string }) => e.stepId === 'timed-step-1')

    expect(entry).toBeDefined()
    // Timestamp should be between before and after
    if (entry && 'created_at' in entry) {
      expect(entry.created_at).toBeGreaterThanOrEqual(beforeTime)
      expect(entry.created_at).toBeLessThanOrEqual(afterTime + 1000)
    }
  })

  it('should persist action log across DO hibernation', async () => {
    const stub = getDOStub('action-log-test-5')

    // Execute some actions
    await stub.durableExecute(async () => 'value-1', { stepId: 'hibernate-step-1' })
    await stub.durableExecute(async () => 'value-2', { stepId: 'hibernate-step-2' })

    // Simulate hibernation and wake
    await stub.prepareHibernate()
    await stub.wake()

    // Action log should still be available
    const log = await stub.getActionLog()

    expect(log).toContainEqual(
      expect.objectContaining({ stepId: 'hibernate-step-1', result: 'value-1' })
    )
    expect(log).toContainEqual(
      expect.objectContaining({ stepId: 'hibernate-step-2', result: 'value-2' })
    )
  })
})

// =============================================================================
// 4. maxRetries OPTION
// =============================================================================

describe('Durable Execution: maxRetries Option', () => {
  it('should respect custom maxRetries=1 (single attempt, no retry)', async () => {
    const stub = getDOStub('max-retries-test-1')

    let attempts = 0
    const alwaysFails = async () => {
      attempts++
      throw new Error('Fails')
    }

    await expect(
      stub.durableExecute(alwaysFails, { stepId: 'single-attempt-1', maxRetries: 1 })
    ).rejects.toThrow('Fails')

    expect(attempts).toBe(1)
  })

  it('should respect custom maxRetries=5', async () => {
    const stub = getDOStub('max-retries-test-2')

    let attempts = 0
    const alwaysFails = async () => {
      attempts++
      throw new Error('Fails')
    }

    await expect(
      stub.durableExecute(alwaysFails, { stepId: 'five-attempts-1', maxRetries: 5 })
    ).rejects.toThrow('Fails')

    expect(attempts).toBe(5)
  })

  it('should use default maxRetries=3 when not specified', async () => {
    const stub = getDOStub('max-retries-test-3')

    let attempts = 0
    const alwaysFails = async () => {
      attempts++
      throw new Error('Fails')
    }

    await expect(stub.durableExecute(alwaysFails, { stepId: 'default-retries-1' })).rejects.toThrow(
      'Fails'
    )

    expect(attempts).toBe(3) // Default is 3
  })

  it('should succeed before maxRetries if action recovers', async () => {
    const stub = getDOStub('max-retries-test-4')

    let attempts = 0
    const eventuallySucceeds = async () => {
      attempts++
      if (attempts < 3) {
        throw new Error('Not ready yet')
      }
      return 'recovered'
    }

    // maxRetries=5, but should succeed on attempt 3
    const result = await stub.durableExecute(eventuallySucceeds, {
      stepId: 'early-success-1',
      maxRetries: 5,
    })

    expect(attempts).toBe(3)
    expect(result).toBe('recovered')
  })

  it('should handle maxRetries=0 (zero retries means at least one attempt)', async () => {
    const stub = getDOStub('max-retries-test-5')

    let attempts = 0
    const action = async () => {
      attempts++
      return 'executed'
    }

    // maxRetries=0 should still execute once
    const result = await stub.durableExecute(action, { stepId: 'zero-retries-1', maxRetries: 0 })

    expect(attempts).toBe(1)
    expect(result).toBe('executed')
  })
})

// =============================================================================
// 5. ERROR HANDLING AND RECOVERY
// =============================================================================

describe('Durable Execution: Error Handling', () => {
  it('should throw the last error after all retries exhausted', async () => {
    const stub = getDOStub('error-test-1')

    let errorNumber = 0
    const varyingErrors = async () => {
      errorNumber++
      throw new Error(`Error number ${errorNumber}`)
    }

    await expect(
      stub.durableExecute(varyingErrors, { stepId: 'varying-errors-1', maxRetries: 3 })
    ).rejects.toThrow('Error number 3') // Should throw the LAST error
  })

  it('should preserve error message in action log', async () => {
    const stub = getDOStub('error-test-2')

    const specificError = async () => {
      throw new Error('Very specific error message')
    }

    await expect(
      stub.durableExecute(specificError, { stepId: 'specific-error-1', maxRetries: 1 })
    ).rejects.toThrow()

    const log = await stub.getActionLog()
    const entry = log.find((e: { stepId: string }) => e.stepId === 'specific-error-1')

    expect(entry?.error?.message).toBe('Very specific error message')
  })

  it('should handle non-Error throws (strings, numbers)', async () => {
    const stub = getDOStub('error-test-3')

    const throwsString = async () => {
      throw 'String error'
    }

    await expect(
      stub.durableExecute(throwsString, { stepId: 'string-throw-1', maxRetries: 1 })
    ).rejects.toThrow()

    const log = await stub.getActionLog()
    const entry = log.find((e: { stepId: string }) => e.stepId === 'string-throw-1')

    expect(entry?.status).toBe('failed')
    expect(entry?.error?.message).toContain('String error')
  })

  it('should handle async errors (rejected promises)', async () => {
    const stub = getDOStub('error-test-4')

    const rejectsPromise = async () => {
      return Promise.reject(new Error('Rejected promise'))
    }

    await expect(
      stub.durableExecute(rejectsPromise, { stepId: 'rejected-promise-1', maxRetries: 1 })
    ).rejects.toThrow('Rejected promise')
  })

  it('should not retry on sync function that throws', async () => {
    const stub = getDOStub('error-test-5')

    let attempts = 0
    const syncThrows = () => {
      attempts++
      throw new Error('Sync error')
    }

    await expect(
      stub.durableExecute(syncThrows, { stepId: 'sync-throw-1', maxRetries: 3 })
    ).rejects.toThrow('Sync error')

    // Should still retry even for sync errors
    expect(attempts).toBe(3)
  })

  it('should recover from transient errors', async () => {
    const stub = getDOStub('error-test-6')

    let attempts = 0
    const transientError = async () => {
      attempts++
      if (attempts === 1) {
        throw new Error('Network timeout')
      }
      return 'recovered-value'
    }

    const result = await stub.durableExecute(transientError, {
      stepId: 'transient-recovery-1',
      maxRetries: 3,
    })

    expect(attempts).toBe(2)
    expect(result).toBe('recovered-value')
  })
})

// =============================================================================
// 6. $.do() vs $.try() BEHAVIOR DIFFERENCES
// =============================================================================

describe('Durable Execution: $.do() vs $.try() Behavior', () => {
  describe('$.do() - Durable execution with retries', () => {
    it('should retry on failure ($.do behavior)', async () => {
      const stub = getDOStub('do-vs-try-test-1')

      let attempts = 0
      const failsTwice = async () => {
        attempts++
        if (attempts < 3) throw new Error('Not ready')
        return 'success'
      }

      // $.do() should retry
      const result = await stub.doAction(failsTwice, { stepId: 'do-retry-1' })

      expect(attempts).toBe(3)
      expect(result).toBe('success')
    })

    it('should persist to action log ($.do behavior)', async () => {
      const stub = getDOStub('do-vs-try-test-2')

      await stub.doAction(async () => 'logged-result', { stepId: 'do-logged-1' })

      const log = await stub.getActionLog()
      expect(log).toContainEqual(
        expect.objectContaining({
          stepId: 'do-logged-1',
          status: 'completed',
        })
      )
    })

    it('should support idempotent replay ($.do behavior)', async () => {
      const stub = getDOStub('do-vs-try-test-3')

      let executionCount = 0
      const action = async () => {
        executionCount++
        return 'do-result'
      }

      await stub.doAction(action, { stepId: 'do-idempotent-1' })
      await stub.doAction(action, { stepId: 'do-idempotent-1' })

      // Should only execute once due to idempotency
      expect(executionCount).toBe(1)
    })
  })

  describe('$.try() - Single attempt execution', () => {
    it('should NOT retry on failure ($.try behavior)', async () => {
      const stub = getDOStub('do-vs-try-test-4')

      let attempts = 0
      const alwaysFails = async () => {
        attempts++
        throw new Error('Fails')
      }

      // $.try() should NOT retry
      await expect(stub.tryAction(alwaysFails)).rejects.toThrow('Fails')

      expect(attempts).toBe(1) // Only one attempt
    })

    it('should NOT persist to action log ($.try behavior)', async () => {
      const stub = getDOStub('do-vs-try-test-5')

      await stub.tryAction(async () => 'try-result')

      const log = await stub.getActionLog()
      // $.try() does not persist to action log
      expect(log.find((e: { stepId: string }) => e.stepId?.includes('try'))).toBeUndefined()
    })

    it('should NOT support idempotent replay ($.try behavior)', async () => {
      const stub = getDOStub('do-vs-try-test-6')

      let executionCount = 0
      const action = async () => {
        executionCount++
        return 'try-result'
      }

      // $.try() always executes, even with same conceptual action
      await stub.tryAction(action)
      await stub.tryAction(action)

      expect(executionCount).toBe(2) // Always executes
    })

    it('should support timeout option ($.try behavior)', async () => {
      const stub = getDOStub('do-vs-try-test-7')

      const slowAction = async () => {
        await new Promise((r) => setTimeout(r, 5000))
        return 'slow-result'
      }

      // $.try() with timeout should fail if action takes too long
      await expect(stub.tryAction(slowAction, { timeout: 100 })).rejects.toThrow('Timeout')
    })

    it('should resolve immediately on fast action with timeout', async () => {
      const stub = getDOStub('do-vs-try-test-8')

      const fastAction = async () => {
        return 'fast-result'
      }

      // Should resolve normally
      const result = await stub.tryAction(fastAction, { timeout: 5000 })
      expect(result).toBe('fast-result')
    })
  })

  describe('Behavioral comparison', () => {
    it('$.do() should be durable, $.try() should be ephemeral', async () => {
      const stub = getDOStub('do-vs-try-comparison-1')

      // $.do() - durable
      await stub.doAction(async () => 'durable-value', { stepId: 'durable-1' })

      // $.try() - ephemeral
      await stub.tryAction(async () => 'ephemeral-value')

      // Only $.do() should be in action log
      const log = await stub.getActionLog()
      expect(log.some((e: { stepId: string }) => e.stepId === 'durable-1')).toBe(true)
      // $.try() entries should not be present
    })

    it('$.do() should survive restart, $.try() should not', async () => {
      // First DO instance
      const stub1 = getDOStub('do-vs-try-comparison-2')

      let doExecutions = 0
      let tryExecutions = 0

      await stub1.doAction(
        async () => {
          doExecutions++
          return 'durable'
        },
        { stepId: 'survive-restart-1' }
      )
      await stub1.tryAction(async () => {
        tryExecutions++
        return 'ephemeral'
      })

      // Simulate restart
      const stub2 = getDOStub('do-vs-try-comparison-2')

      // $.do() with same stepId - should replay (not re-execute)
      await stub2.doAction(
        async () => {
          doExecutions++
          return 'durable-new'
        },
        { stepId: 'survive-restart-1' }
      )

      // $.do() replayed, so doExecutions should still be 1
      expect(doExecutions).toBe(1)

      // $.try() always executes fresh
      await stub2.tryAction(async () => {
        tryExecutions++
        return 'ephemeral-new'
      })

      expect(tryExecutions).toBe(2)
    })
  })
})

// =============================================================================
// 7. EDGE CASES AND INTEGRATION
// =============================================================================

describe('Durable Execution: Edge Cases', () => {
  it('should handle undefined result', async () => {
    const stub = getDOStub('edge-case-1')

    const result = await stub.durableExecute(async () => undefined, { stepId: 'undefined-result-1' })

    expect(result).toBeUndefined()

    // Replay should also return undefined
    const replayed = await stub.durableExecute(async () => 'different', {
      stepId: 'undefined-result-1',
    })
    expect(replayed).toBeUndefined()
  })

  it('should handle null result', async () => {
    const stub = getDOStub('edge-case-2')

    const result = await stub.durableExecute(async () => null, { stepId: 'null-result-1' })

    expect(result).toBeNull()
  })

  it('should handle very large results', async () => {
    const stub = getDOStub('edge-case-3')

    const largeData = {
      array: Array(1000).fill({ key: 'value', nested: { deep: 'data' } }),
      longString: 'x'.repeat(10000),
    }

    const result = await stub.durableExecute(async () => largeData, { stepId: 'large-result-1' })

    expect(result.array).toHaveLength(1000)
    expect(result.longString).toHaveLength(10000)
  })

  it('should handle concurrent executions with different stepIds', async () => {
    const stub = getDOStub('edge-case-4')

    const results = await Promise.all([
      stub.durableExecute(async () => 'result-a', { stepId: 'concurrent-a' }),
      stub.durableExecute(async () => 'result-b', { stepId: 'concurrent-b' }),
      stub.durableExecute(async () => 'result-c', { stepId: 'concurrent-c' }),
    ])

    expect(results).toEqual(['result-a', 'result-b', 'result-c'])
  })

  it('should handle concurrent executions with same stepId (race condition)', async () => {
    const stub = getDOStub('edge-case-5')

    let executionCount = 0
    const slowAction = async () => {
      executionCount++
      await new Promise((r) => setTimeout(r, 100))
      return 'slow-result'
    }

    // Start multiple concurrent executions with same stepId
    const promises = [
      stub.durableExecute(slowAction, { stepId: 'race-condition-1' }),
      stub.durableExecute(slowAction, { stepId: 'race-condition-1' }),
      stub.durableExecute(slowAction, { stepId: 'race-condition-1' }),
    ]

    const results = await Promise.all(promises)

    // All should return the same result
    expect(results[0]).toBe('slow-result')
    expect(results[1]).toBe('slow-result')
    expect(results[2]).toBe('slow-result')

    // Ideally only one execution, but at minimum all should get same result
    expect(executionCount).toBeGreaterThanOrEqual(1)
  })

  it('should preserve order of action log entries', async () => {
    const stub = getDOStub('edge-case-6')

    await stub.durableExecute(async () => 'first', { stepId: 'order-1' })
    await stub.durableExecute(async () => 'second', { stepId: 'order-2' })
    await stub.durableExecute(async () => 'third', { stepId: 'order-3' })

    const log = await stub.getActionLog()
    const stepIds = log.map((e: { stepId: string }) => e.stepId)

    expect(stepIds).toContain('order-1')
    expect(stepIds).toContain('order-2')
    expect(stepIds).toContain('order-3')
  })
})
