/**
 * RetryExecutor Tests
 *
 * TDD test suite for error handling and retry policies in sync operations.
 *
 * The RetryExecutor provides configurable retry policies with different
 * backoff strategies, error classification, and failed record tracking
 * for manual review.
 *
 * Test Coverage:
 * - [x] Retry policy applies exponential backoff correctly
 * - [x] Retry stops after maxAttempts reached
 * - [x] Non-retryable errors fail immediately
 * - [x] Partial failures don't stop entire sync
 * - [x] Failed records are tracked for manual review
 * - [x] Retry respects rate limits
 *
 * @module db/primitives/sync/tests/retry-executor.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  RetryExecutor,
  SyncErrorTracker,
  createRetryExecutor,
  createSyncErrorTracker,
  type RetryPolicy,
  type RetryError,
  type RetryResult,
  type FailedRecord,
} from '../retry-executor'

// =============================================================================
// TEST HELPERS
// =============================================================================

function createDefaultPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    maxAttempts: 3,
    backoff: 'exponential',
    initialDelayMs: 100,
    maxDelayMs: 5000,
    retryableErrors: ['RATE_LIMIT', 'TIMEOUT', 'NETWORK_ERROR'],
    ...overrides,
  }
}

// Helper to create a mock operation that fails N times then succeeds
function createFlakeyOperation<T>(
  failCount: number,
  successValue: T,
  errorCode: string = 'NETWORK_ERROR'
): () => Promise<T> {
  let attempts = 0
  return async () => {
    attempts++
    if (attempts <= failCount) {
      const error = new Error(`Operation failed (attempt ${attempts})`)
      ;(error as any).code = errorCode
      throw error
    }
    return successValue
  }
}

// Helper to create a mock operation that always fails
function createFailingOperation(errorCode: string, message: string = 'Always fails'): () => Promise<never> {
  return async () => {
    const error = new Error(message)
    ;(error as any).code = errorCode
    throw error
  }
}

// Helper to track delay calls
function createDelayTracker(): { delays: number[]; delay: (ms: number) => Promise<void> } {
  const delays: number[] = []
  return {
    delays,
    delay: async (ms: number) => {
      delays.push(ms)
      // Don't actually delay in tests
    },
  }
}

// =============================================================================
// RETRY POLICY TESTS
// =============================================================================

describe('RetryExecutor', () => {
  let executor: RetryExecutor
  let policy: RetryPolicy

  beforeEach(() => {
    policy = createDefaultPolicy()
    executor = new RetryExecutor(policy)
  })

  describe('backoff strategies', () => {
    it('applies exponential backoff correctly', async () => {
      const tracker = createDelayTracker()
      const policy = createDefaultPolicy({
        backoff: 'exponential',
        initialDelayMs: 100,
        maxDelayMs: 10000,
        maxAttempts: 4,
      })
      executor = new RetryExecutor(policy, { delayFn: tracker.delay })

      const operation = createFlakeyOperation(3, 'success')
      await executor.execute(operation)

      // Exponential: 100, 200, 400 (doubles each time)
      expect(tracker.delays).toHaveLength(3)
      expect(tracker.delays[0]).toBe(100)
      expect(tracker.delays[1]).toBe(200)
      expect(tracker.delays[2]).toBe(400)
    })

    it('applies linear backoff correctly', async () => {
      const tracker = createDelayTracker()
      const policy = createDefaultPolicy({
        backoff: 'linear',
        initialDelayMs: 100,
        maxDelayMs: 10000,
        maxAttempts: 4,
      })
      executor = new RetryExecutor(policy, { delayFn: tracker.delay })

      const operation = createFlakeyOperation(3, 'success')
      await executor.execute(operation)

      // Linear: 100, 200, 300 (adds initialDelayMs each time)
      expect(tracker.delays).toHaveLength(3)
      expect(tracker.delays[0]).toBe(100)
      expect(tracker.delays[1]).toBe(200)
      expect(tracker.delays[2]).toBe(300)
    })

    it('applies constant backoff correctly', async () => {
      const tracker = createDelayTracker()
      const policy = createDefaultPolicy({
        backoff: 'constant',
        initialDelayMs: 100,
        maxDelayMs: 10000,
        maxAttempts: 4,
      })
      executor = new RetryExecutor(policy, { delayFn: tracker.delay })

      const operation = createFlakeyOperation(3, 'success')
      await executor.execute(operation)

      // Constant: 100, 100, 100 (same delay each time)
      expect(tracker.delays).toHaveLength(3)
      expect(tracker.delays[0]).toBe(100)
      expect(tracker.delays[1]).toBe(100)
      expect(tracker.delays[2]).toBe(100)
    })

    it('caps delay at maxDelayMs', async () => {
      const tracker = createDelayTracker()
      const policy = createDefaultPolicy({
        backoff: 'exponential',
        initialDelayMs: 1000,
        maxDelayMs: 2500, // Cap before 3rd doubling would occur
        maxAttempts: 5,
      })
      executor = new RetryExecutor(policy, { delayFn: tracker.delay })

      const operation = createFlakeyOperation(4, 'success')
      await executor.execute(operation)

      // Exponential would be: 1000, 2000, 4000, 8000
      // But capped at 2500: 1000, 2000, 2500, 2500
      expect(tracker.delays).toHaveLength(4)
      expect(tracker.delays[0]).toBe(1000)
      expect(tracker.delays[1]).toBe(2000)
      expect(tracker.delays[2]).toBe(2500) // Capped
      expect(tracker.delays[3]).toBe(2500) // Capped
    })
  })

  describe('maxAttempts', () => {
    it('retries up to maxAttempts times', async () => {
      const policy = createDefaultPolicy({ maxAttempts: 3 })
      executor = new RetryExecutor(policy, { delayFn: async () => {} })

      let attemptCount = 0
      const operation = async () => {
        attemptCount++
        const error = new Error('Always fails')
        ;(error as any).code = 'NETWORK_ERROR'
        throw error
      }

      const result = await executor.execute(operation)

      expect(result.success).toBe(false)
      expect(attemptCount).toBe(3) // Exactly maxAttempts
      expect(result.attempts).toBe(3)
    })

    it('stops after maxAttempts reached and returns error', async () => {
      const policy = createDefaultPolicy({ maxAttempts: 2 })
      executor = new RetryExecutor(policy, { delayFn: async () => {} })

      const operation = createFailingOperation('NETWORK_ERROR', 'Persistent failure')
      const result = await executor.execute(operation)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('NETWORK_ERROR')
      expect(result.error?.message).toBe('Persistent failure')
      expect(result.error?.attempts).toBe(2)
      expect(result.error?.retryable).toBe(true)
    })

    it('succeeds on first attempt when operation succeeds', async () => {
      const tracker = createDelayTracker()
      executor = new RetryExecutor(policy, { delayFn: tracker.delay })

      const operation = async () => 'success'
      const result = await executor.execute(operation)

      expect(result.success).toBe(true)
      expect(result.value).toBe('success')
      expect(result.attempts).toBe(1)
      expect(tracker.delays).toHaveLength(0) // No delays needed
    })

    it('succeeds after retries when operation eventually succeeds', async () => {
      const tracker = createDelayTracker()
      const policy = createDefaultPolicy({ maxAttempts: 5 })
      executor = new RetryExecutor(policy, { delayFn: tracker.delay })

      const operation = createFlakeyOperation(2, 'eventual success')
      const result = await executor.execute(operation)

      expect(result.success).toBe(true)
      expect(result.value).toBe('eventual success')
      expect(result.attempts).toBe(3) // 2 failures + 1 success
      expect(tracker.delays).toHaveLength(2) // 2 delays for 2 retries
    })
  })

  describe('non-retryable errors', () => {
    it('fails immediately for non-retryable errors', async () => {
      const tracker = createDelayTracker()
      const policy = createDefaultPolicy({
        maxAttempts: 5,
        retryableErrors: ['NETWORK_ERROR', 'TIMEOUT'],
      })
      executor = new RetryExecutor(policy, { delayFn: tracker.delay })

      const operation = createFailingOperation('VALIDATION_ERROR', 'Invalid data')
      const result = await executor.execute(operation)

      expect(result.success).toBe(false)
      expect(result.attempts).toBe(1) // Only one attempt
      expect(result.error?.code).toBe('VALIDATION_ERROR')
      expect(result.error?.retryable).toBe(false)
      expect(tracker.delays).toHaveLength(0) // No delays
    })

    it('classifies errors correctly based on retryableErrors list', async () => {
      const policy = createDefaultPolicy({
        retryableErrors: ['RATE_LIMIT', 'NETWORK_ERROR'],
      })
      executor = new RetryExecutor(policy, { delayFn: async () => {} })

      // Test retryable error
      const retryableResult = await executor.execute(
        createFailingOperation('RATE_LIMIT', 'Too many requests')
      )
      expect(retryableResult.error?.retryable).toBe(true)

      // Test non-retryable error
      const nonRetryableResult = await executor.execute(
        createFailingOperation('AUTH_ERROR', 'Unauthorized')
      )
      expect(nonRetryableResult.error?.retryable).toBe(false)
    })

    it('treats unknown error codes as non-retryable by default', async () => {
      const tracker = createDelayTracker()
      executor = new RetryExecutor(policy, { delayFn: tracker.delay })

      const operation = async () => {
        const error = new Error('Mystery error')
        // No error code set
        throw error
      }

      const result = await executor.execute(operation)

      expect(result.success).toBe(false)
      expect(result.attempts).toBe(1)
      expect(result.error?.retryable).toBe(false)
      expect(tracker.delays).toHaveLength(0)
    })
  })

  describe('rate limit handling', () => {
    it('respects rate limit headers in retry delay', async () => {
      const tracker = createDelayTracker()
      const policy = createDefaultPolicy({
        backoff: 'exponential',
        initialDelayMs: 100,
        maxAttempts: 3,
      })
      executor = new RetryExecutor(policy, { delayFn: tracker.delay })

      let attempts = 0
      const operation = async () => {
        attempts++
        if (attempts <= 1) {
          const error = new Error('Rate limited')
          ;(error as any).code = 'RATE_LIMIT'
          ;(error as any).retryAfterMs = 5000 // Server says wait 5 seconds
          throw error
        }
        return 'success'
      }

      await executor.execute(operation)

      // Should use the retryAfterMs from the error, not the backoff calculation
      expect(tracker.delays[0]).toBe(5000)
    })

    it('uses calculated backoff when no retryAfter specified', async () => {
      const tracker = createDelayTracker()
      const policy = createDefaultPolicy({
        backoff: 'exponential',
        initialDelayMs: 100,
        maxAttempts: 3,
      })
      executor = new RetryExecutor(policy, { delayFn: tracker.delay })

      const operation = createFlakeyOperation(1, 'success', 'RATE_LIMIT')
      await executor.execute(operation)

      // Should use normal backoff
      expect(tracker.delays[0]).toBe(100)
    })

    it('caps retryAfter at maxDelayMs', async () => {
      const tracker = createDelayTracker()
      const policy = createDefaultPolicy({
        maxDelayMs: 2000,
        maxAttempts: 3,
      })
      executor = new RetryExecutor(policy, { delayFn: tracker.delay })

      let attempts = 0
      const operation = async () => {
        attempts++
        if (attempts <= 1) {
          const error = new Error('Rate limited')
          ;(error as any).code = 'RATE_LIMIT'
          ;(error as any).retryAfterMs = 60000 // Server says wait 60 seconds
          throw error
        }
        return 'success'
      }

      await executor.execute(operation)

      // Should be capped at maxDelayMs
      expect(tracker.delays[0]).toBe(2000)
    })
  })

  describe('record context', () => {
    it('includes record key in error when provided', async () => {
      executor = new RetryExecutor(policy, { delayFn: async () => {} })

      const operation = createFailingOperation('VALIDATION_ERROR', 'Bad data')
      const result = await executor.execute(operation, { recordKey: 'user-123' })

      expect(result.error?.recordKey).toBe('user-123')
    })
  })
})

// =============================================================================
// SYNC ERROR TRACKER TESTS
// =============================================================================

describe('SyncErrorTracker', () => {
  let tracker: SyncErrorTracker

  beforeEach(() => {
    tracker = new SyncErrorTracker()
  })

  describe('tracking failed records', () => {
    it('tracks failed records for manual review', () => {
      tracker.trackFailure({
        recordKey: 'user-1',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid email format',
          recordKey: 'user-1',
          retryable: false,
          attempts: 1,
        },
        data: { name: 'Alice', email: 'invalid' },
        timestamp: new Date('2026-01-13T10:00:00Z'),
      })

      tracker.trackFailure({
        recordKey: 'user-2',
        error: {
          code: 'NETWORK_ERROR',
          message: 'Connection timeout',
          recordKey: 'user-2',
          retryable: true,
          attempts: 3,
        },
        data: { name: 'Bob', email: 'bob@example.com' },
        timestamp: new Date('2026-01-13T10:01:00Z'),
      })

      const failures = tracker.getFailedRecords()

      expect(failures).toHaveLength(2)
      expect(failures[0].recordKey).toBe('user-1')
      expect(failures[1].recordKey).toBe('user-2')
    })

    it('provides summary of failures by error code', () => {
      tracker.trackFailure({
        recordKey: 'user-1',
        error: { code: 'VALIDATION_ERROR', message: 'Bad data', retryable: false, attempts: 1 },
        timestamp: new Date(),
      })
      tracker.trackFailure({
        recordKey: 'user-2',
        error: { code: 'VALIDATION_ERROR', message: 'Bad data', retryable: false, attempts: 1 },
        timestamp: new Date(),
      })
      tracker.trackFailure({
        recordKey: 'user-3',
        error: { code: 'NETWORK_ERROR', message: 'Timeout', retryable: true, attempts: 3 },
        timestamp: new Date(),
      })

      const summary = tracker.getSummary()

      expect(summary.total).toBe(3)
      expect(summary.byErrorCode['VALIDATION_ERROR']).toBe(2)
      expect(summary.byErrorCode['NETWORK_ERROR']).toBe(1)
      expect(summary.retryable).toBe(1)
      expect(summary.nonRetryable).toBe(2)
    })

    it('filters failures by retryable status', () => {
      tracker.trackFailure({
        recordKey: 'user-1',
        error: { code: 'VALIDATION_ERROR', message: 'Bad data', retryable: false, attempts: 1 },
        timestamp: new Date(),
      })
      tracker.trackFailure({
        recordKey: 'user-2',
        error: { code: 'NETWORK_ERROR', message: 'Timeout', retryable: true, attempts: 3 },
        timestamp: new Date(),
      })

      const retryable = tracker.getFailedRecords({ retryable: true })
      const nonRetryable = tracker.getFailedRecords({ retryable: false })

      expect(retryable).toHaveLength(1)
      expect(retryable[0].recordKey).toBe('user-2')
      expect(nonRetryable).toHaveLength(1)
      expect(nonRetryable[0].recordKey).toBe('user-1')
    })

    it('filters failures by error code', () => {
      tracker.trackFailure({
        recordKey: 'user-1',
        error: { code: 'VALIDATION_ERROR', message: 'Bad', retryable: false, attempts: 1 },
        timestamp: new Date(),
      })
      tracker.trackFailure({
        recordKey: 'user-2',
        error: { code: 'NETWORK_ERROR', message: 'Timeout', retryable: true, attempts: 3 },
        timestamp: new Date(),
      })

      const validationErrors = tracker.getFailedRecords({ errorCode: 'VALIDATION_ERROR' })

      expect(validationErrors).toHaveLength(1)
      expect(validationErrors[0].recordKey).toBe('user-1')
    })

    it('clears tracked failures', () => {
      tracker.trackFailure({
        recordKey: 'user-1',
        error: { code: 'ERROR', message: 'Failed', retryable: false, attempts: 1 },
        timestamp: new Date(),
      })

      expect(tracker.getFailedRecords()).toHaveLength(1)

      tracker.clear()

      expect(tracker.getFailedRecords()).toHaveLength(0)
    })

    it('removes specific failed record', () => {
      tracker.trackFailure({
        recordKey: 'user-1',
        error: { code: 'ERROR', message: 'Failed', retryable: false, attempts: 1 },
        timestamp: new Date(),
      })
      tracker.trackFailure({
        recordKey: 'user-2',
        error: { code: 'ERROR', message: 'Failed', retryable: false, attempts: 1 },
        timestamp: new Date(),
      })

      tracker.removeFailure('user-1')

      const failures = tracker.getFailedRecords()
      expect(failures).toHaveLength(1)
      expect(failures[0].recordKey).toBe('user-2')
    })
  })

  describe('partial failure handling', () => {
    it('allows sync to continue after individual record failures', async () => {
      const policy = createDefaultPolicy({ maxAttempts: 1 })
      const executor = new RetryExecutor(policy, { delayFn: async () => {} })

      const records = [
        { key: 'user-1', data: { name: 'Alice' } },
        { key: 'user-2', data: { name: 'Bob' } },
        { key: 'user-3', data: { name: 'Charlie' } },
      ]

      const successes: string[] = []

      // Process records, some will fail
      for (const record of records) {
        const operation = async () => {
          if (record.key === 'user-2') {
            const error = new Error('Validation failed')
            ;(error as any).code = 'VALIDATION_ERROR'
            throw error
          }
          return record.data
        }

        const result = await executor.execute(operation, { recordKey: record.key })

        if (result.success) {
          successes.push(record.key)
        } else {
          tracker.trackFailure({
            recordKey: record.key,
            error: result.error!,
            data: record.data,
            timestamp: new Date(),
          })
        }
      }

      // Sync continued despite user-2 failure
      expect(successes).toEqual(['user-1', 'user-3'])
      expect(tracker.getFailedRecords()).toHaveLength(1)
      expect(tracker.getFailedRecords()[0].recordKey).toBe('user-2')
    })

    it('reports both successes and failures in sync result', async () => {
      const policy = createDefaultPolicy({ maxAttempts: 1 })
      const executor = new RetryExecutor(policy, { delayFn: async () => {} })

      const records = [
        { key: 'user-1', shouldFail: false },
        { key: 'user-2', shouldFail: true },
        { key: 'user-3', shouldFail: false },
        { key: 'user-4', shouldFail: true },
        { key: 'user-5', shouldFail: false },
      ]

      let successCount = 0
      let failureCount = 0

      for (const record of records) {
        const operation = async () => {
          if (record.shouldFail) {
            const error = new Error('Failed')
            ;(error as any).code = 'ERROR'
            throw error
          }
          return 'ok'
        }

        const result = await executor.execute(operation, { recordKey: record.key })

        if (result.success) {
          successCount++
        } else {
          failureCount++
          tracker.trackFailure({
            recordKey: record.key,
            error: result.error!,
            timestamp: new Date(),
          })
        }
      }

      expect(successCount).toBe(3)
      expect(failureCount).toBe(2)

      const summary = tracker.getSummary()
      expect(summary.total).toBe(2)
    })
  })

  describe('retry queue management', () => {
    it('returns retryable failures for reprocessing', () => {
      tracker.trackFailure({
        recordKey: 'user-1',
        error: { code: 'NETWORK_ERROR', message: 'Timeout', retryable: true, attempts: 2 },
        data: { name: 'Alice' },
        timestamp: new Date(),
      })
      tracker.trackFailure({
        recordKey: 'user-2',
        error: { code: 'VALIDATION_ERROR', message: 'Bad', retryable: false, attempts: 1 },
        data: { name: 'Bob' },
        timestamp: new Date(),
      })

      const toRetry = tracker.getRetryQueue()

      expect(toRetry).toHaveLength(1)
      expect(toRetry[0].recordKey).toBe('user-1')
      expect(toRetry[0].data).toEqual({ name: 'Alice' })
    })

    it('exports failures for external review', () => {
      const timestamp = new Date('2026-01-13T10:00:00Z')
      tracker.trackFailure({
        recordKey: 'user-1',
        error: { code: 'ERROR', message: 'Failed', retryable: false, attempts: 1 },
        data: { name: 'Alice' },
        timestamp,
      })

      const exported = tracker.export()

      expect(exported).toEqual([
        {
          recordKey: 'user-1',
          error: { code: 'ERROR', message: 'Failed', retryable: false, attempts: 1 },
          data: { name: 'Alice' },
          timestamp: timestamp.toISOString(),
        },
      ])
    })
  })
})

// =============================================================================
// BATCH EXECUTOR TESTS
// =============================================================================

describe('Batch retry execution', () => {
  it('processes batch with partial failures', async () => {
    const policy = createDefaultPolicy({ maxAttempts: 2 })
    const executor = new RetryExecutor(policy, { delayFn: async () => {} })
    const tracker = new SyncErrorTracker()

    const batch = [
      { key: 'item-1', value: 100 },
      { key: 'item-2', value: 200 },
      { key: 'item-3', value: 300 },
    ]

    const results = await executor.executeBatch(
      batch,
      async (item) => {
        if (item.value === 200) {
          const error = new Error('Bad value')
          ;(error as any).code = 'VALIDATION_ERROR'
          throw error
        }
        return { processed: item.value * 2 }
      },
      (item) => item.key,
      tracker
    )

    expect(results.successful).toHaveLength(2)
    expect(results.failed).toHaveLength(1)
    expect(results.failed[0].key).toBe('item-2')

    expect(tracker.getFailedRecords()).toHaveLength(1)
  })

  it('continues batch after transient failures that eventually succeed', async () => {
    const policy = createDefaultPolicy({ maxAttempts: 3 })
    const executor = new RetryExecutor(policy, { delayFn: async () => {} })
    const tracker = new SyncErrorTracker()

    const attemptCounts = new Map<string, number>()

    const batch = [
      { key: 'item-1' },
      { key: 'item-2' }, // Will fail twice then succeed
      { key: 'item-3' },
    ]

    const results = await executor.executeBatch(
      batch,
      async (item) => {
        const count = (attemptCounts.get(item.key) || 0) + 1
        attemptCounts.set(item.key, count)

        if (item.key === 'item-2' && count <= 2) {
          const error = new Error('Transient failure')
          ;(error as any).code = 'NETWORK_ERROR'
          throw error
        }
        return { key: item.key, done: true }
      },
      (item) => item.key,
      tracker
    )

    expect(results.successful).toHaveLength(3)
    expect(results.failed).toHaveLength(0)
    expect(attemptCounts.get('item-2')).toBe(3) // 2 failures + 1 success
  })
})

// =============================================================================
// FACTORY FUNCTION TESTS
// =============================================================================

describe('Factory functions', () => {
  it('createRetryExecutor creates executor with default options', () => {
    const executor = createRetryExecutor({
      maxAttempts: 5,
      backoff: 'linear',
      initialDelayMs: 500,
      maxDelayMs: 10000,
      retryableErrors: ['ERROR'],
    })

    expect(executor).toBeInstanceOf(RetryExecutor)
  })

  it('createSyncErrorTracker creates new tracker', () => {
    const tracker = createSyncErrorTracker()

    expect(tracker).toBeInstanceOf(SyncErrorTracker)
    expect(tracker.getFailedRecords()).toHaveLength(0)
  })
})
