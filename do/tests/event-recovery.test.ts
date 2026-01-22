/**
 * Event Handler Error Recovery Tests - RED PHASE TDD
 *
 * These tests expose the lack of retry/recovery for event handler errors.
 *
 * Current Problem (do/context.ts:75-103):
 * - Event handler errors are only logged, no retry mechanism
 * - No dead letter queue for persistently failing handlers
 * - No distinction between retriable and non-retriable errors
 * - No exponential backoff for transient failures
 *
 * Expected Behavior:
 * 1. Transient errors should be retried with exponential backoff
 * 2. Persistently failing handlers should be moved to a dead letter queue (DLQ)
 * 3. Non-retriable errors (ValidationError, etc.) should not be retried
 * 4. Recovery status should be observable/queryable
 *
 * @module do/tests/event-recovery.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createContext, type WorkflowContext } from '../context'
import { invokeHandlers, type EventHandler } from '../on'
import { ValidationError, NetworkError, TimeoutError, isRetryableError } from '../../rpc/errors'

// Mock DurableObjectState for unit tests
const createMockState = () => ({
  id: { toString: () => `test-${Date.now()}` },
  storage: {
    get: vi.fn(),
    put: vi.fn(),
    list: vi.fn(() => Promise.resolve(new Map())),
    delete: vi.fn(),
  },
}) as unknown as DurableObjectState

describe('Event Handler Error Recovery', () => {
  let $: WorkflowContext
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    $ = createContext(createMockState(), {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('Retry with Exponential Backoff', () => {
    it('should retry failed event handlers with exponential backoff', async () => {
      // This test EXPOSES the current behavior: no retries happen
      let attempts = 0
      const timestamps: number[] = []

      $.on.Test.transientFailure(async () => {
        timestamps.push(Date.now())
        attempts++
        if (attempts < 3) {
          // Simulate transient network error
          throw new NetworkError('Connection reset')
        }
        return 'success'
      })

      $.send({ type: 'Test.transientFailure', payload: {} })

      // Wait for potential retries (with exponential backoff: 100ms + 200ms + margin)
      await new Promise(r => setTimeout(r, 500))

      // EXPECTED: 3 attempts (initial + 2 retries), handler should succeed
      // ACTUAL (current): Only 1 attempt, error is logged and handler fails
      expect(attempts).toBe(3) // This WILL FAIL - currently only 1 attempt

      // EXPECTED: Exponential backoff delays between attempts
      // - First retry after ~100ms
      // - Second retry after ~200ms
      if (timestamps.length >= 2) {
        const gap1 = timestamps[1] - timestamps[0]
        expect(gap1).toBeGreaterThanOrEqual(90) // ~100ms with tolerance
      }
      if (timestamps.length >= 3) {
        const gap2 = timestamps[2] - timestamps[1]
        expect(gap2).toBeGreaterThanOrEqual(180) // ~200ms with tolerance
      }
    })

    it('should eventually succeed after transient failures', async () => {
      let attempts = 0
      let finalResult: string | undefined

      $.on.Test.eventualSuccess(async () => {
        attempts++
        if (attempts < 3) {
          throw new TimeoutError('Request timed out')
        }
        finalResult = 'completed'
      })

      $.send({ type: 'Test.eventualSuccess', payload: {} })
      await new Promise(r => setTimeout(r, 500))

      // EXPECTED: Handler succeeds after retries
      // ACTUAL (current): Handler fails on first attempt, no retries
      expect(finalResult).toBe('completed') // This WILL FAIL
      expect(attempts).toBe(3)
    })

    it('should limit retry count to prevent infinite loops', async () => {
      let attempts = 0
      const maxRetries = 5 // Expected max retries

      // Configure durability to use 5 retries for this event type
      const eventsStore = $._events as any
      eventsStore.setDurabilityConfig?.({
        'Test.alwaysFails': { retries: maxRetries, backoff: 'exponential' }
      })

      $.on.Test.alwaysFails(async () => {
        attempts++
        throw new NetworkError('Persistent network failure')
      })

      $.send({ type: 'Test.alwaysFails', payload: {} })
      await new Promise(r => setTimeout(r, 5000))

      // EXPECTED: maxRetries + 1 (initial) attempts, then gives up
      expect(attempts).toBe(maxRetries + 1)
    })
  })

  describe('Dead Letter Queue (DLQ)', () => {
    it('should move to dead letter queue after max retries', async () => {
      let attempts = 0

      $.on.Test.persistentFailure(async () => {
        attempts++
        throw new NetworkError('Service unavailable')
      })

      $.send({ type: 'Test.persistentFailure', payload: { id: 'test-123' } })
      await new Promise(r => setTimeout(r, 2000))

      // EXPECTED: After max retries exhausted, event should be in DLQ
      // ACTUAL (current): No DLQ exists
      const dlq = ($._events as any).getDeadLetterQueue?.() || []
      expect(dlq.length).toBeGreaterThan(0) // This WILL FAIL - no DLQ

      // The DLQ entry should contain the original event and error info
      const dlqEntry = dlq[0]
      expect(dlqEntry).toMatchObject({
        event: {
          type: 'Test.persistentFailure',
          payload: { id: 'test-123' }
        },
        attempts: expect.any(Number),
        lastError: expect.any(String),
        timestamp: expect.any(Number)
      })
    })

    it('should allow querying DLQ events', async () => {
      // Register multiple failing handlers
      $.on.Order.process(async () => {
        throw new Error('Processing failed')
      })

      $.on.Payment.charge(async () => {
        throw new Error('Payment gateway down')
      })

      // Emit multiple failing events
      $.send({ type: 'Order.process', payload: { orderId: '1' } })
      $.send({ type: 'Order.process', payload: { orderId: '2' } })
      $.send({ type: 'Payment.charge', payload: { paymentId: '1' } })

      await new Promise(r => setTimeout(r, 2000))

      // EXPECTED: DLQ should be queryable by event type
      // ACTUAL (current): No DLQ exists
      const eventsStore = $._events as any

      const orderDLQ = eventsStore.queryDeadLetterQueue?.({ type: 'Order.process' }) || []
      expect(orderDLQ.length).toBe(2) // This WILL FAIL

      const paymentDLQ = eventsStore.queryDeadLetterQueue?.({ type: 'Payment.charge' }) || []
      expect(paymentDLQ.length).toBe(1) // This WILL FAIL
    })

    it('should allow replaying DLQ events', async () => {
      let processAttempts = 0
      let replaySucceeded = false

      // With default 3 retries:
      // - Initial send: 4 attempts (1 + 3 retries), goes to DLQ
      // - Replay: succeeds on attempt 5 (the replay invocation)
      // Handler should succeed after 4 failed attempts (simulating fix deployed)
      $.on.Task.execute(async () => {
        processAttempts++
        // First 4 attempts fail (initial send), then succeed on replay
        if (processAttempts < 5) {
          throw new NetworkError('Bug in handler')
        }
        replaySucceeded = true
      })

      $.send({ type: 'Task.execute', payload: { taskId: 'abc' } })
      await new Promise(r => setTimeout(r, 1500))

      // Event should be in DLQ after exhausting retries (4 attempts with default 3 retries)
      const eventsStore = $._events as any
      const dlqBefore = eventsStore.getDeadLetterQueue?.() || []
      expect(dlqBefore.length).toBeGreaterThan(0)

      // Replay events from DLQ - handler will now succeed
      await eventsStore.replayDeadLetterQueue?.({ type: 'Task.execute' })

      await new Promise(r => setTimeout(r, 1000))

      // After replay, handler should succeed (attempt 5+)
      expect(replaySucceeded).toBe(true)
      expect(processAttempts).toBeGreaterThanOrEqual(5)
    })
  })

  describe('Non-Retriable Error Handling', () => {
    it('should not retry non-retriable errors like ValidationError', async () => {
      let attempts = 0

      $.on.User.create(async () => {
        attempts++
        throw new ValidationError('Invalid email format', { field: 'email' })
      })

      $.send({ type: 'User.create', payload: { email: 'invalid' } })
      await new Promise(r => setTimeout(r, 500))

      // EXPECTED: Only 1 attempt - ValidationError is not retriable
      // ACTUAL (current): 1 attempt (but this is accidental, not by design)
      expect(attempts).toBe(1)

      // EXPECTED: ValidationError should be tracked differently (not in retry queue/DLQ)
      // but should be queryable as a validation failure
      const eventsStore = $._events as any
      const validationFailures = eventsStore.queryValidationFailures?.() || []

      // This tests that validation errors are tracked separately
      expect(validationFailures.length).toBe(1) // This WILL FAIL - no such tracking
      expect(validationFailures[0]).toMatchObject({
        type: 'User.create',
        error: expect.stringContaining('ValidationError')
      })
    })

    it('should distinguish between retriable and non-retriable errors', async () => {
      const retriableAttempts: number[] = []
      const nonRetriableAttempts: number[] = []

      $.on.Service.networkCall(async () => {
        retriableAttempts.push(Date.now())
        throw new NetworkError('Connection failed')
      })

      $.on.Data.validate(async () => {
        nonRetriableAttempts.push(Date.now())
        throw new ValidationError('Schema mismatch')
      })

      $.send({ type: 'Service.networkCall', payload: {} })
      $.send({ type: 'Data.validate', payload: {} })
      await new Promise(r => setTimeout(r, 1000))

      // EXPECTED: NetworkError triggers retries, ValidationError does not
      // ACTUAL (current): Neither triggers retries
      expect(retriableAttempts.length).toBeGreaterThan(1) // Should have retried
      expect(nonRetriableAttempts.length).toBe(1) // Should NOT have retried
    })

    it('should not retry errors with explicit non-retriable flag', async () => {
      let attempts = 0

      class NonRetriableError extends Error {
        readonly retriable = false
        constructor(message: string) {
          super(message)
          this.name = 'NonRetriableError'
        }
      }

      $.on.Custom.action(async () => {
        attempts++
        throw new NonRetriableError('Business rule violation')
      })

      $.send({ type: 'Custom.action', payload: {} })
      await new Promise(r => setTimeout(r, 500))

      // EXPECTED: Error with retriable=false should not be retried
      expect(attempts).toBe(1)
    })
  })

  describe('Recovery Status and Observability', () => {
    it('should track retry attempts for each event', async () => {
      let attempts = 0

      $.on.Job.run(async () => {
        attempts++
        if (attempts < 3) {
          throw new NetworkError('Retry me')
        }
      })

      const eventId = 'job-' + Date.now()
      $.send({ type: 'Job.run', payload: { id: eventId } })
      await new Promise(r => setTimeout(r, 500))

      // EXPECTED: Can query retry status for an event
      // ACTUAL (current): No retry tracking exists
      const eventsStore = $._events as any
      const status = eventsStore.getEventRetryStatus?.(eventId)

      expect(status).toMatchObject({
        attempts: 3,
        succeeded: true,
        lastAttempt: expect.any(Number)
      }) // This WILL FAIL - no status tracking
    })

    it('should emit recovery events when handler succeeds after retry', async () => {
      let attempts = 0
      const recoveryEvents: unknown[] = []

      // Listen for recovery events
      $.on.System.recovered(async (event) => {
        recoveryEvents.push(event)
      })

      $.on.Flaky.operation(async () => {
        attempts++
        if (attempts < 2) {
          throw new TimeoutError('Timed out')
        }
      })

      $.send({ type: 'Flaky.operation', payload: {} })
      await new Promise(r => setTimeout(r, 500))

      // EXPECTED: System.recovered event should be emitted
      // ACTUAL (current): No recovery events exist
      expect(recoveryEvents.length).toBe(1) // This WILL FAIL
      expect(recoveryEvents[0]).toMatchObject({
        originalEvent: { type: 'Flaky.operation' },
        attempts: 2
      })
    })

    it('should provide retry metrics per handler', async () => {
      // Register some handlers that fail sometimes
      let h1Attempts = 0
      let h2Attempts = 0

      $.on.Metric.handler1(async () => {
        h1Attempts++
        if (h1Attempts < 2) throw new NetworkError('Fail')
      })

      $.on.Metric.handler2(async () => {
        h2Attempts++
        if (h2Attempts < 3) throw new TimeoutError('Slow')
      })

      // Emit events multiple times
      for (let i = 0; i < 5; i++) {
        $.send({ type: 'Metric.handler1', payload: {} })
        $.send({ type: 'Metric.handler2', payload: {} })
      }
      await new Promise(r => setTimeout(r, 2000))

      // EXPECTED: Can query retry metrics per handler
      // ACTUAL (current): No metrics collection
      const eventsStore = $._events as any
      const metrics = eventsStore.getRetryMetrics?.()

      expect(metrics).toMatchObject({
        'Metric.handler1': {
          totalEvents: 5,
          totalRetries: expect.any(Number),
          successRate: expect.any(Number)
        },
        'Metric.handler2': {
          totalEvents: 5,
          totalRetries: expect.any(Number),
          successRate: expect.any(Number)
        }
      }) // This WILL FAIL - no metrics exist
    })
  })

  describe('Integration with $.do() durability levels', () => {
    it('should respect durability level when handling events', async () => {
      // Events emitted via $.send() are fire-and-forget
      // But internally handlers should use $.do() for durable execution

      let durableAttempts = 0

      $.on.Important.task(async () => {
        // Handler should internally wrap critical work in $.do()
        durableAttempts++
        if (durableAttempts < 3) {
          throw new NetworkError('Transient failure')
        }
      })

      $.send({ type: 'Important.task', payload: {} })
      await new Promise(r => setTimeout(r, 1000))

      // EXPECTED: Event handler execution uses $.do() internally for durability
      // ACTUAL (current): Handlers are called directly without durability
      expect(durableAttempts).toBe(3) // This WILL FAIL
    })

    it('should support configurable durability per event type', async () => {
      // Some events need high durability, others don't

      // EXPECTED: Can configure durability settings per event type
      const eventsStore = $._events as any

      // Use 5 retries with linear backoff to complete within test timeout
      // Linear backoff: 100ms per delay, 5 delays = 500ms total delay
      eventsStore.setDurabilityConfig?.({
        'Critical.event': { retries: 5, backoff: 'linear' },
        'Logging.event': { retries: 0 }, // Fire and forget
        '*': { retries: 3, backoff: 'exponential' } // Default
      })

      let criticalAttempts = 0
      let loggingAttempts = 0

      $.on.Critical.event(async () => {
        criticalAttempts++
        throw new NetworkError('Keep trying')
      })

      $.on.Logging.event(async () => {
        loggingAttempts++
        throw new NetworkError('Should not retry with retries: 0')
      })

      $.send({ type: 'Critical.event', payload: {} })
      $.send({ type: 'Logging.event', payload: {} })
      await new Promise(r => setTimeout(r, 1500))

      // Critical should retry 5 times (1 initial + 5 retries = 6 total)
      // Logging should not retry (retries: 0)
      expect(criticalAttempts).toBe(6)
      expect(loggingAttempts).toBe(1) // No retries
    })
  })
})

describe('invokeHandlers Error Recovery', () => {
  let handlers: Map<string, EventHandler[]>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    handlers = new Map()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('should retry individual handlers that throw retriable errors', async () => {
    let attempts = 0

    const handler: EventHandler = async () => {
      attempts++
      if (attempts < 3) {
        throw new NetworkError('Retry me')
      }
    }

    handlers.set('Test.event', [handler])

    await invokeHandlers('Test.event', { data: 'test' }, handlers)

    // EXPECTED: Handler should be retried until success
    // ACTUAL (current): Handler is called once, error is logged
    expect(attempts).toBe(3) // This WILL FAIL - currently only 1 attempt
  })

  it('should report retry results after completion', async () => {
    const h1: EventHandler = async () => {
      throw new NetworkError('Always fails')
    }

    const h2: EventHandler = async () => {
      // Succeeds
    }

    handlers.set('Test.event', [h1, h2])

    // EXPECTED: invokeHandlers returns a result object with retry info
    // ACTUAL (current): invokeHandlers returns void
    const result = await invokeHandlers('Test.event', {}, handlers)

    // Result should contain information about what happened
    expect(result).toMatchObject({
      succeeded: [expect.any(Object)],
      failed: [{
        handler: expect.any(Function),
        attempts: expect.any(Number),
        error: expect.any(Error)
      }]
    }) // This WILL FAIL - currently returns void
  })

  it('should support retry configuration per invocation', async () => {
    let attempts = 0

    const handler: EventHandler = async () => {
      attempts++
      throw new TimeoutError('Slow')
    }

    handlers.set('Test.event', [handler])

    // EXPECTED: Can pass retry options to invokeHandlers
    // ACTUAL (current): No options parameter exists
    await (invokeHandlers as any)('Test.event', {}, handlers, {
      maxRetries: 5,
      backoff: 'exponential',
      initialDelay: 50
    })

    // With 5 retries, should attempt 6 times total
    expect(attempts).toBe(6) // This WILL FAIL - no retry options supported
  })
})

describe('Error Classification', () => {
  it('should correctly identify retriable errors from rpc/errors', () => {
    // Verify our error types are correctly classified
    expect(isRetryableError(new NetworkError('Network fail'))).toBe(true)
    expect(isRetryableError(new TimeoutError('Timeout'))).toBe(true)
    expect(isRetryableError(new ValidationError('Invalid'))).toBe(false)
    expect(isRetryableError(new Error('Generic error'))).toBe(false)
  })

  it('should handle custom retriable errors', () => {
    // Custom errors with retriable property should be respected
    class RetriableCustomError extends Error {
      readonly retriable = true
    }

    class NonRetriableCustomError extends Error {
      readonly retriable = false
    }

    // EXPECTED: Custom errors with retriable property should be respected
    // This tests an extension point for the retry system
    // ACTUAL (current): Only RPCError-based errors are checked

    // Note: This test documents expected behavior for custom errors
    // The isRetryableError function should be extended to check for
    // a .retriable property on any error
  })
})
