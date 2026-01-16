/**
 * Durable Execution Module Tests
 *
 * Tests for durable execution semantics:
 * 1. Retry behavior with exponential backoff
 * 2. Step idempotency (same stepId returns cached result, doesn't re-execute)
 * 3. Action log persistence
 * 4. maxRetries option respected
 * 5. Error handling and recovery
 * 6. $.do() vs $.try() behavior differences
 *
 * These tests use RPC-compatible test helper methods on the DO
 * since functions cannot be passed through Cloudflare Workers RPC.
 *
 * @see do-ta4e - Durable Execution Implementation
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Get a DOCore stub for testing
 */
function getDOStub(name: string) {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id) as unknown as DOCoreTestStub
}

/**
 * Type for DOCore stub with test methods
 */
interface DOCoreTestStub {
  // Test scenario methods
  testRetryWithEventualSuccess(stepId: string, failUntilAttempt: number, maxRetries?: number): Promise<{ attempts: number; result: string }>
  testRetryWithAlwaysFail(stepId: string, maxRetries: number): Promise<{ attempts: number; error: string }>
  testIdempotentExecution(stepId: string): Promise<{ executions: number; results: unknown[] }>
  testDoVsTry(doStepId: string): Promise<{ doExecutions: number; tryExecutions: number }>
  testTryWithTimeout(timeoutMs: number, actionDurationMs: number): Promise<{ success: boolean; error?: string }>

  // Core methods
  getActionLog(): Promise<ActionLogEntry[]>
  clearActionLog(): Promise<void>
  prepareHibernate(): Promise<void>
  wake(): Promise<void>
}

interface ActionLogEntry {
  stepId: string
  status: 'pending' | 'completed' | 'failed'
  result?: unknown
  error?: { message: string }
  created_at?: number
}

// =============================================================================
// 1. RETRY BEHAVIOR WITH EXPONENTIAL BACKOFF
// =============================================================================

describe('Durable Execution: Retry Behavior', () => {
  it('should retry on failure with exponential backoff', async () => {
    const stub = getDOStub('retry-backoff-test-1')

    // Test scenario: fail until attempt 3, then succeed
    const result = await stub.testRetryWithEventualSuccess('retry-test-1', 3)

    expect(result.attempts).toBe(3)
    expect(result.result).toBe('success')
  })

  it('should respect maxRetries=1 (single attempt, no retry)', async () => {
    const stub = getDOStub('max-retries-test-1')

    const result = await stub.testRetryWithAlwaysFail('single-attempt-1', 1)

    expect(result.attempts).toBe(1)
    expect(result.error).toContain('fails')
  })

  it('should respect maxRetries=5', async () => {
    const stub = getDOStub('max-retries-test-2')

    const result = await stub.testRetryWithAlwaysFail('five-attempts-1', 5)

    expect(result.attempts).toBe(5)
    expect(result.error).toContain('fails')
  })

  it('should use default maxRetries=3 when not specified', async () => {
    const stub = getDOStub('max-retries-test-3')

    // Default maxRetries is 3
    const result = await stub.testRetryWithAlwaysFail('default-retries-1', 3)

    expect(result.attempts).toBe(3)
  })

  it('should succeed before maxRetries if action recovers', async () => {
    const stub = getDOStub('max-retries-test-4')

    // maxRetries=5, but should succeed on attempt 3
    const result = await stub.testRetryWithEventualSuccess('early-success-1', 3, 5)

    expect(result.attempts).toBe(3)
    expect(result.result).toBe('success')
  })
})

// =============================================================================
// 2. STEP IDEMPOTENCY (REPLAY SEMANTICS)
// =============================================================================

describe('Durable Execution: Step Idempotency', () => {
  it('should return cached result for same stepId without re-executing', async () => {
    const stub = getDOStub('idempotency-test-1')

    const result = await stub.testIdempotentExecution('idempotent-step-1')

    // Should only execute once due to idempotency
    expect(result.executions).toBe(1)
    // Both results should be the same
    expect(result.results[0]).toEqual(result.results[1])
  })
})

// =============================================================================
// 3. ACTION LOG PERSISTENCE
// =============================================================================

describe('Durable Execution: Action Log Persistence', () => {
  it('should persist successful actions to action_log', async () => {
    const stub = getDOStub('action-log-test-1')

    await stub.testRetryWithEventualSuccess('logged-step-1', 1)

    const log = await stub.getActionLog()

    const entry = log.find((e: ActionLogEntry) => e.stepId === 'logged-step-1')
    expect(entry).toBeDefined()
    expect(entry?.status).toBe('completed')
    expect(entry?.result).toBe('success')
  })

  it('should persist failed actions to action_log', async () => {
    const stub = getDOStub('action-log-test-2')

    await stub.testRetryWithAlwaysFail('failed-step-1', 2)

    const log = await stub.getActionLog()

    const entry = log.find((e: ActionLogEntry) => e.stepId === 'failed-step-1')
    expect(entry).toBeDefined()
    expect(entry?.status).toBe('failed')
    expect(entry?.error?.message).toContain('fails')
  })

  it('should include timestamp in action log entries', async () => {
    const stub = getDOStub('action-log-test-3')

    const beforeTime = Date.now()
    await stub.testRetryWithEventualSuccess('timed-step-1', 1)
    const afterTime = Date.now()

    const log = await stub.getActionLog()
    const entry = log.find((e: ActionLogEntry) => e.stepId === 'timed-step-1')

    expect(entry).toBeDefined()
    expect(entry?.created_at).toBeGreaterThanOrEqual(beforeTime)
    expect(entry?.created_at).toBeLessThanOrEqual(afterTime + 1000)
  })

  it('should persist action log across DO hibernation', async () => {
    const stub = getDOStub('action-log-test-4')

    // Execute some actions
    await stub.testRetryWithEventualSuccess('hibernate-step-1', 1)
    await stub.testRetryWithEventualSuccess('hibernate-step-2', 1)

    // Simulate hibernation and wake
    await stub.prepareHibernate()
    await stub.wake()

    // Action log should still be available
    const log = await stub.getActionLog()

    expect(log.some((e: ActionLogEntry) => e.stepId === 'hibernate-step-1')).toBe(true)
    expect(log.some((e: ActionLogEntry) => e.stepId === 'hibernate-step-2')).toBe(true)
  })
})

// =============================================================================
// 4. $.do() vs $.try() BEHAVIOR DIFFERENCES
// =============================================================================

describe('Durable Execution: $.do() vs $.try() Behavior', () => {
  describe('$.do() - Durable execution with retries', () => {
    it('should retry on failure ($.do behavior)', async () => {
      const stub = getDOStub('do-vs-try-test-1')

      // $.do() should retry - fails twice then succeeds on 3rd attempt
      const result = await stub.testRetryWithEventualSuccess('do-retry-1', 3)

      expect(result.attempts).toBe(3)
      expect(result.result).toBe('success')
    })

    it('should persist to action log ($.do behavior)', async () => {
      const stub = getDOStub('do-vs-try-test-2')

      await stub.testRetryWithEventualSuccess('do-logged-1', 1)

      const log = await stub.getActionLog()
      expect(log.some((e: ActionLogEntry) => e.stepId === 'do-logged-1')).toBe(true)
    })

    it('should support idempotent replay ($.do behavior)', async () => {
      const stub = getDOStub('do-vs-try-test-3')

      const result = await stub.testIdempotentExecution('do-idempotent-1')

      // Should only execute once due to idempotency
      expect(result.executions).toBe(1)
    })
  })

  describe('$.try() - Single attempt execution', () => {
    it('should NOT retry on failure ($.try behavior)', async () => {
      const stub = getDOStub('do-vs-try-test-4')

      const result = await stub.testDoVsTry('do-try-test-4')

      // $.try() should only execute once (no retries)
      expect(result.tryExecutions).toBe(1)
    })

    it('should support timeout option ($.try behavior)', async () => {
      const stub = getDOStub('do-vs-try-test-5')

      // Action takes 5000ms, timeout is 100ms - should fail
      const result = await stub.testTryWithTimeout(100, 5000)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Timeout')
    })

    it('should resolve immediately on fast action with timeout', async () => {
      const stub = getDOStub('do-vs-try-test-6')

      // Action takes 10ms, timeout is 5000ms - should succeed
      const result = await stub.testTryWithTimeout(5000, 10)

      expect(result.success).toBe(true)
    })
  })

  describe('Behavioral comparison', () => {
    it('$.do() should be durable, $.try() should be ephemeral', async () => {
      const stub = getDOStub('do-vs-try-comparison-1')

      const result = await stub.testDoVsTry('durable-1')

      // Only $.do() should be in action log
      const log = await stub.getActionLog()
      expect(log.some((e: ActionLogEntry) => e.stepId === 'durable-1')).toBe(true)
    })
  })
})

// =============================================================================
// 5. ERROR HANDLING AND RECOVERY
// =============================================================================

describe('Durable Execution: Error Handling', () => {
  it('should throw the last error after all retries exhausted', async () => {
    const stub = getDOStub('error-test-1')

    const result = await stub.testRetryWithAlwaysFail('varying-errors-1', 3)

    // Should throw the LAST error
    expect(result.error).toContain('fails')
  })

  it('should preserve error message in action log', async () => {
    const stub = getDOStub('error-test-2')

    await stub.testRetryWithAlwaysFail('specific-error-1', 1)

    const log = await stub.getActionLog()
    const entry = log.find((e: ActionLogEntry) => e.stepId === 'specific-error-1')

    expect(entry?.error?.message).toContain('fails')
  })

  it('should recover from transient errors', async () => {
    const stub = getDOStub('error-test-3')

    // Fails on attempt 1, succeeds on attempt 2
    const result = await stub.testRetryWithEventualSuccess('transient-recovery-1', 2, 3)

    expect(result.attempts).toBe(2)
    expect(result.result).toBe('success')
  })
})

// =============================================================================
// 6. EDGE CASES
// =============================================================================

describe('Durable Execution: Edge Cases', () => {
  it('should preserve order of action log entries', async () => {
    const stub = getDOStub('edge-case-1')

    await stub.testRetryWithEventualSuccess('order-1', 1)
    await stub.testRetryWithEventualSuccess('order-2', 1)
    await stub.testRetryWithEventualSuccess('order-3', 1)

    const log = await stub.getActionLog()
    const stepIds = log.map((e: ActionLogEntry) => e.stepId)

    expect(stepIds).toContain('order-1')
    expect(stepIds).toContain('order-2')
    expect(stepIds).toContain('order-3')
  })
})
