/**
 * Inngest Compat Layer Tests
 *
 * Comprehensive tests for Inngest API compatibility including:
 * - Basic client operations
 * - Step functions
 * - Error types
 * - Middleware
 * - Serve handler
 * - Throttling (rate limiting step execution)
 * - Cancellation (cancel running functions)
 * - Batch Events (process multiple events together)
 * - step.invoke (call other functions as steps)
 * - Concurrency (limit concurrent executions)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Inngest,
  NonRetriableError,
  RetryAfterError,
  StepError,
  serve,
  CancellationError,
  type InngestFunction,
} from './index'

describe('Inngest Compat Layer', () => {
  let inngest: Inngest

  beforeEach(() => {
    inngest = new Inngest({ id: 'test-app' })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Inngest Client', () => {
    it('should create client with id', () => {
      expect(inngest.id).toBe('test-app')
    })

    it('should send events', async () => {
      const result = await inngest.send({
        name: 'test/event',
        data: { hello: 'world' },
      })

      expect(result.ids).toBeDefined()
      expect(result.ids.length).toBe(1)
      expect(result.ids[0]).toMatch(/^evt_/)
    })

    it('should send multiple events', async () => {
      const result = await inngest.send([
        { name: 'test/event1', data: { a: 1 } },
        { name: 'test/event2', data: { b: 2 } },
        { name: 'test/event3', data: { c: 3 } },
      ])

      expect(result.ids.length).toBe(3)
    })
  })

  describe('createFunction', () => {
    it('should create a function with event trigger', () => {
      const fn = inngest.createFunction(
        { id: 'test-fn' },
        { event: 'test/event' },
        async () => 'result'
      )

      expect(fn.id).toBe('test-fn')
      expect(fn.eventName).toBe('test/event')
    })

    it('should create a function with string trigger', () => {
      const fn = inngest.createFunction({ id: 'test-fn' }, 'test/event', async () => 'result')

      expect(fn.eventName).toBe('test/event')
    })

    it('should create a function with cron trigger', () => {
      const fn = inngest.createFunction(
        { id: 'scheduled-fn' },
        { cron: '0 9 * * MON' },
        async () => 'scheduled result'
      )

      expect(fn.cronExpression).toBe('0 9 * * MON')
    })
  })

  describe('Step Functions', () => {
    it('should execute step.run', async () => {
      let stepExecuted = false

      const fn = inngest.createFunction(
        { id: 'step-test' },
        { event: 'test/step' },
        async ({ step }) => {
          const result = await step.run('my-step', () => {
            stepExecuted = true
            return 42
          })
          return result
        }
      )

      const result = await fn.invoke({
        name: 'test/step',
        data: {},
      })

      expect(stepExecuted).toBe(true)
      expect(result).toBe(42)
    })

    it('should memoize step results on replay', async () => {
      let callCount = 0

      const fn = inngest.createFunction(
        { id: 'memoize-test' },
        { event: 'test/memoize' },
        async ({ step }) => {
          await step.run('step-1', () => {
            callCount++
            return 1
          })
          await step.run('step-1', () => {
            callCount++
            return 2
          })
          return callCount
        }
      )

      const result = await fn.invoke({
        name: 'test/memoize',
        data: {},
      })

      // Second call should be memoized
      expect(callCount).toBe(1)
    })

    it('should execute step.sendEvent', async () => {
      let eventSent = false

      const fn = inngest.createFunction(
        { id: 'send-event-test' },
        { event: 'test/send' },
        async ({ step }) => {
          const result = await step.sendEvent('send-step', {
            name: 'downstream/event',
            data: { triggered: true },
          })
          eventSent = true
          return result
        }
      )

      await fn.invoke({
        name: 'test/send',
        data: {},
      })

      expect(eventSent).toBe(true)
    })

    it('should execute parallel steps', async () => {
      const fn = inngest.createFunction(
        { id: 'parallel-test' },
        { event: 'test/parallel' },
        async ({ step }) => {
          const results = await step.parallel('parallel-steps', [
            async () => 'a',
            async () => 'b',
            async () => 'c',
          ])
          return results
        }
      )

      const result = await fn.invoke({
        name: 'test/parallel',
        data: {},
      })

      expect(result).toEqual(['a', 'b', 'c'])
    })
  })

  describe('Error Types', () => {
    it('should create NonRetriableError', () => {
      const error = new NonRetriableError('Do not retry')
      expect(error.isNonRetriableError).toBe(true)
      expect(error.message).toBe('Do not retry')
      expect(error.name).toBe('NonRetriableError')
    })

    it('should create NonRetriableError with cause', () => {
      const cause = new Error('Original error')
      const error = new NonRetriableError('Wrapped error', { cause })
      expect(error.cause).toBe(cause)
    })

    it('should create RetryAfterError', () => {
      const error = new RetryAfterError('Retry later', '5m')
      expect(error.isRetryAfterError).toBe(true)
      expect(error.retryAfter).toBe('5m')
    })

    it('should create StepError', () => {
      const error = new StepError('Step failed', 'my-step')
      expect(error.isStepError).toBe(true)
      expect(error.stepId).toBe('my-step')
    })
  })

  describe('Middleware', () => {
    it('should apply middleware onSendEvent', async () => {
      const middleware = {
        name: 'test-middleware',
        onSendEvent: vi.fn((events) => events),
      }

      const client = new Inngest({
        id: 'middleware-test',
        middleware: [middleware],
      })

      await client.send({ name: 'test/event', data: {} })

      expect(middleware.onSendEvent).toHaveBeenCalled()
    })

    it('should apply middleware onFunctionRun', async () => {
      const beforeRun = vi.fn()
      const afterExecution = vi.fn()

      const middleware = {
        name: 'lifecycle-middleware',
        onFunctionRun: () => ({
          beforeExecution: beforeRun,
          afterExecution: afterExecution,
        }),
      }

      const client = new Inngest({
        id: 'lifecycle-test',
        middleware: [middleware],
      })

      const fn = client.createFunction({ id: 'fn-with-middleware' }, 'test/event', async () => 'done')

      await fn.invoke({ name: 'test/event', data: {} })

      expect(beforeRun).toHaveBeenCalled()
      expect(afterExecution).toHaveBeenCalled()
    })
  })

  describe('serve', () => {
    it('should create a fetch handler', async () => {
      const fn = inngest.createFunction({ id: 'serve-test' }, 'test/event', async () => 'result')

      const handler = serve(inngest, [fn])

      // Health check
      const healthResponse = await handler(new Request('http://localhost/api/inngest'))

      expect(healthResponse.status).toBe(200)
      const body = await healthResponse.json()
      expect(body.appId).toBe('test-app')
      expect(body.functions.length).toBe(1)
    })

    it('should handle event ingestion', async () => {
      const results: string[] = []

      const fn = inngest.createFunction(
        { id: 'ingest-test' },
        { event: 'test/ingest' },
        async () => {
          results.push('executed')
          return 'done'
        }
      )

      const handler = serve(inngest, [fn])

      const response = await handler(
        new Request('http://localhost/api/inngest', {
          method: 'POST',
          body: JSON.stringify({ name: 'test/ingest', data: {} }),
        })
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.ids).toBeDefined()
    })
  })

  // ============================================================================
  // THROTTLING TESTS (Rate limiting step execution)
  // ============================================================================

  describe('Inngest Throttling', () => {
    it('should throttle step execution to N per period', async () => {
      const executions: number[] = []
      let stepCount = 0

      const fn = inngest.createFunction(
        {
          id: 'throttle-test',
          throttle: {
            count: 2,
            period: '1s',
          },
        },
        { event: 'test/throttle' },
        async ({ step }) => {
          // This step should be throttled to 2 per second
          const result = await step.run('throttled-step', () => {
            stepCount++
            executions.push(Date.now())
            return stepCount
          })
          return result
        }
      )

      // Execute 3 times rapidly - third should be throttled
      const promises = [
        fn.invoke({ name: 'test/throttle', data: { id: 1 } }),
        fn.invoke({ name: 'test/throttle', data: { id: 2 } }),
        fn.invoke({ name: 'test/throttle', data: { id: 3 } }),
      ]

      // First two should execute, third should wait
      await vi.advanceTimersByTimeAsync(100)

      // Only 2 should have executed within the throttle window
      expect(stepCount).toBeLessThanOrEqual(2)
    })

    it('should queue steps when throttle exceeded', async () => {
      const executionOrder: number[] = []

      const fn = inngest.createFunction(
        {
          id: 'throttle-queue-test',
          throttle: {
            count: 1,
            period: '50ms',
          },
        },
        { event: 'test/throttle-queue' },
        async ({ step, event }) => {
          await step.run('queued-step', () => {
            executionOrder.push(event.data.order as number)
          })
        }
      )

      // Execute 3 times - should queue after first
      const p1 = fn.invoke({ name: 'test/throttle-queue', data: { order: 1 } })
      const p2 = fn.invoke({ name: 'test/throttle-queue', data: { order: 2 } })
      const p3 = fn.invoke({ name: 'test/throttle-queue', data: { order: 3 } })

      // Advance time incrementally to process queue
      // First runs immediately, second after 50ms, third after 100ms
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(50)
      }

      await Promise.all([p1, p2, p3])

      // All should execute in order
      expect(executionOrder).toEqual([1, 2, 3])
    })

    it('should resume throttled steps after period', async () => {
      let stepExecutions = 0

      const fn = inngest.createFunction(
        {
          id: 'throttle-resume-test',
          throttle: {
            count: 1,
            period: '1s',
          },
        },
        { event: 'test/throttle-resume' },
        async ({ step }) => {
          await step.run('resume-step', () => {
            stepExecutions++
          })
        }
      )

      // First execution
      await fn.invoke({ name: 'test/throttle-resume', data: {} })
      expect(stepExecutions).toBe(1)

      // Second should be throttled
      const p2 = fn.invoke({ name: 'test/throttle-resume', data: {} })

      // Wait for throttle period to expire
      await vi.advanceTimersByTimeAsync(1100)
      await p2

      expect(stepExecutions).toBe(2)
    })

    it('should throttle by key for per-user rate limiting', async () => {
      const userExecutions: Record<string, number> = {}

      const fn = inngest.createFunction(
        {
          id: 'throttle-key-test',
          throttle: {
            key: 'event.data.userId',
            count: 1,
            period: '1s',
          },
        },
        { event: 'test/throttle-key' },
        async ({ step, event }) => {
          const userId = event.data.userId as string
          await step.run('user-step', () => {
            userExecutions[userId] = (userExecutions[userId] || 0) + 1
          })
        }
      )

      // User A and User B should not interfere with each other
      await Promise.all([
        fn.invoke({ name: 'test/throttle-key', data: { userId: 'user-a' } }),
        fn.invoke({ name: 'test/throttle-key', data: { userId: 'user-b' } }),
      ])

      expect(userExecutions['user-a']).toBe(1)
      expect(userExecutions['user-b']).toBe(1)
    })
  })

  // ============================================================================
  // CANCELLATION TESTS (Cancel running functions)
  // ============================================================================

  describe('Inngest Cancellation', () => {
    it('should cancel running function by ID', async () => {
      let wasCompleted = false
      let wasCancelled = false

      const fn = inngest.createFunction(
        { id: 'cancel-by-id-test' },
        { event: 'test/cancel' },
        async ({ step, runId }) => {
          try {
            await step.sleep('long-sleep', '10s')
            wasCompleted = true
          } catch (error) {
            if (error instanceof CancellationError) {
              wasCancelled = true
            }
            throw error
          }
        }
      )

      // Start the function
      const runPromise = fn.invoke({ name: 'test/cancel', data: {} })

      // Let it start
      await vi.advanceTimersByTimeAsync(100)

      // Cancel the run
      const runs = await inngest.getRuns({ functionId: 'cancel-by-id-test' })
      expect(runs.length).toBeGreaterThan(0)

      await inngest.cancel(runs[0].runId)

      // Verify cancellation
      await expect(runPromise).rejects.toThrow(CancellationError)
      expect(wasCancelled).toBe(true)
      expect(wasCompleted).toBe(false)
    })

    it('should cancel functions matching event filter', async () => {
      const completedOrders: string[] = []
      const cancelledOrders: string[] = []

      const fn = inngest.createFunction(
        {
          id: 'cancel-by-event-test',
          cancelOn: [
            {
              event: 'order/cancelled',
              match: 'data.orderId',
            },
          ],
        },
        { event: 'order/created' },
        async ({ step, event }) => {
          try {
            await step.sleep('processing', '5s')
            await step.run('complete', () => {
              completedOrders.push(event.data.orderId as string)
            })
          } catch (error) {
            if (error instanceof CancellationError) {
              cancelledOrders.push(event.data.orderId as string)
            }
            throw error
          }
        }
      )

      // Start processing order-1 - attach handler to prevent unhandled rejection
      let p1Error: Error | undefined
      const p1 = fn.invoke({ name: 'order/created', data: { orderId: 'order-1' } }).catch((e) => {
        p1Error = e
      })

      // Start processing order-2
      const p2 = fn.invoke({ name: 'order/created', data: { orderId: 'order-2' } })

      // Let them start
      await vi.advanceTimersByTimeAsync(100)

      // Cancel order-1 via event
      await inngest.send({ name: 'order/cancelled', data: { orderId: 'order-1' } })

      // Let order-2 complete
      await vi.advanceTimersByTimeAsync(6000)

      await p1
      await p2

      expect(p1Error).toBeInstanceOf(CancellationError)
      expect(cancelledOrders).toContain('order-1')
      expect(completedOrders).toContain('order-2')
    })

    it('should cleanup cancelled function state', async () => {
      const fn = inngest.createFunction(
        { id: 'cancel-cleanup-test' },
        { event: 'test/cleanup' },
        async ({ step }) => {
          await step.run('step-1', () => 'result-1')
          await step.sleep('wait', '10s')
          await step.run('step-2', () => 'result-2')
        }
      )

      // Start the function - attach handler to prevent unhandled rejection
      let cancelled = false
      const runPromise = fn.invoke({ name: 'test/cleanup', data: {} }).catch((e) => {
        if (e instanceof CancellationError) cancelled = true
      })

      // Let step-1 complete
      await vi.advanceTimersByTimeAsync(100)

      // Get the run and cancel it
      const runs = await inngest.getRuns({ functionId: 'cancel-cleanup-test' })
      const runId = runs[0].runId

      await inngest.cancel(runId)

      // Wait for promise to settle
      await runPromise

      // Verify cancellation happened
      expect(cancelled).toBe(true)

      // Verify state was cleaned up
      const runState = await inngest.getRunState(runId)
      expect(runState).toBeNull()
    })

    it('should support cancellation with if expression', async () => {
      let wasCancelled = false

      const fn = inngest.createFunction(
        {
          id: 'cancel-if-test',
          cancelOn: [
            {
              event: 'user/banned',
              if: 'event.data.userId == async.data.userId',
            },
          ],
        },
        { event: 'user/action' },
        async ({ step }) => {
          try {
            await step.sleep('wait', '10s')
          } catch (error) {
            if (error instanceof CancellationError) {
              wasCancelled = true
            }
            throw error
          }
        }
      )

      // Start function for user-1
      const p1 = fn.invoke({ name: 'user/action', data: { userId: 'user-1' } })

      await vi.advanceTimersByTimeAsync(100)

      // Ban user-1
      await inngest.send({ name: 'user/banned', data: { userId: 'user-1' } })

      await expect(p1).rejects.toThrow(CancellationError)
      expect(wasCancelled).toBe(true)
    })
  })

  // ============================================================================
  // BATCH EVENTS TESTS (Process multiple events together)
  // ============================================================================

  describe('Inngest Batch Events', () => {
    it('should batch events with same key', async () => {
      let batchedEvents: unknown[] = []

      const fn = inngest.createFunction(
        {
          id: 'batch-key-test',
          batchEvents: {
            maxSize: 5,
            timeout: '1s',
            key: 'event.data.batchKey',
          },
        },
        { event: 'test/batch' },
        async ({ events }) => {
          batchedEvents = events.map((e) => e.data)
        }
      )

      // Send events with same batch key
      await inngest.send([
        { name: 'test/batch', data: { batchKey: 'group-1', value: 1 } },
        { name: 'test/batch', data: { batchKey: 'group-1', value: 2 } },
        { name: 'test/batch', data: { batchKey: 'group-1', value: 3 } },
      ])

      // Wait for batch timeout
      await vi.advanceTimersByTimeAsync(1100)

      // All events with same key should be batched together
      expect(batchedEvents.length).toBe(3)
      expect(batchedEvents).toContainEqual({ batchKey: 'group-1', value: 1 })
      expect(batchedEvents).toContainEqual({ batchKey: 'group-1', value: 2 })
      expect(batchedEvents).toContainEqual({ batchKey: 'group-1', value: 3 })
    })

    it('should trigger function with batched events array', async () => {
      let receivedEvents: unknown[] = []
      let eventCount = 0

      const fn = inngest.createFunction(
        {
          id: 'batch-array-test',
          batchEvents: {
            maxSize: 10,
            timeout: '500ms',
          },
        },
        { event: 'test/batch-array' },
        async ({ events, event }) => {
          receivedEvents = events
          eventCount = events.length
          // event should be the first event in the batch
          return { first: event.data, count: events.length }
        }
      )

      // Send multiple events
      await inngest.send([
        { name: 'test/batch-array', data: { id: 1 } },
        { name: 'test/batch-array', data: { id: 2 } },
        { name: 'test/batch-array', data: { id: 3 } },
        { name: 'test/batch-array', data: { id: 4 } },
      ])

      // Wait for batch timeout
      await vi.advanceTimersByTimeAsync(600)

      expect(eventCount).toBe(4)
      expect(receivedEvents.length).toBe(4)
    })

    it('should respect batch timeout', async () => {
      let batchCount = 0
      let lastBatchSize = 0

      const fn = inngest.createFunction(
        {
          id: 'batch-timeout-test',
          batchEvents: {
            maxSize: 100, // Large max size
            timeout: '200ms', // Short timeout
          },
        },
        { event: 'test/batch-timeout' },
        async ({ events }) => {
          batchCount++
          lastBatchSize = events.length
        }
      )

      // Send first event
      await inngest.send({ name: 'test/batch-timeout', data: { id: 1 } })

      // Wait less than timeout
      await vi.advanceTimersByTimeAsync(100)

      // Send second event
      await inngest.send({ name: 'test/batch-timeout', data: { id: 2 } })

      // Function should not have triggered yet
      expect(batchCount).toBe(0)

      // Wait for timeout
      await vi.advanceTimersByTimeAsync(200)

      // Now it should trigger with both events
      expect(batchCount).toBe(1)
      expect(lastBatchSize).toBe(2)
    })

    it('should trigger when maxSize is reached before timeout', async () => {
      let batchSize = 0

      const fn = inngest.createFunction(
        {
          id: 'batch-maxsize-test',
          batchEvents: {
            maxSize: 3,
            timeout: '10s', // Long timeout
          },
        },
        { event: 'test/batch-maxsize' },
        async ({ events }) => {
          batchSize = events.length
        }
      )

      // Send exactly maxSize events
      await inngest.send([
        { name: 'test/batch-maxsize', data: { id: 1 } },
        { name: 'test/batch-maxsize', data: { id: 2 } },
        { name: 'test/batch-maxsize', data: { id: 3 } },
      ])

      // Should trigger immediately without waiting for timeout
      await vi.advanceTimersByTimeAsync(100)

      expect(batchSize).toBe(3)
    })

    it('should separate batches by different keys', async () => {
      const batches: Record<string, number> = {}

      const fn = inngest.createFunction(
        {
          id: 'batch-separate-test',
          batchEvents: {
            maxSize: 10,
            timeout: '500ms',
            key: 'event.data.tenant',
          },
        },
        { event: 'test/batch-separate' },
        async ({ events }) => {
          const tenant = events[0].data.tenant as string
          batches[tenant] = events.length
        }
      )

      // Send events for different tenants
      await inngest.send([
        { name: 'test/batch-separate', data: { tenant: 'A', value: 1 } },
        { name: 'test/batch-separate', data: { tenant: 'B', value: 1 } },
        { name: 'test/batch-separate', data: { tenant: 'A', value: 2 } },
        { name: 'test/batch-separate', data: { tenant: 'B', value: 2 } },
        { name: 'test/batch-separate', data: { tenant: 'A', value: 3 } },
      ])

      await vi.advanceTimersByTimeAsync(600)

      // Each tenant should have their own batch
      expect(batches['A']).toBe(3)
      expect(batches['B']).toBe(2)
    })
  })

  // ============================================================================
  // STEP.INVOKE TESTS (Call other functions as steps)
  // ============================================================================

  describe('Inngest step.invoke', () => {
    it('should invoke another function as step', async () => {
      let helperWasCalled = false

      const helperFn = inngest.createFunction(
        { id: 'helper-fn' },
        { event: 'helper/trigger' },
        async ({ event }) => {
          helperWasCalled = true
          return { processed: event.data.input }
        }
      )

      const mainFn = inngest.createFunction(
        { id: 'main-fn' },
        { event: 'main/trigger' },
        async ({ step }) => {
          const result = await step.invoke('call-helper', {
            function: helperFn,
            data: { input: 'test-value' },
          })
          return result
        }
      )

      const result = await mainFn.invoke({
        name: 'main/trigger',
        data: {},
      })

      expect(helperWasCalled).toBe(true)
      expect(result).toEqual({ processed: 'test-value' })
    })

    it('should pass payload to invoked function', async () => {
      let receivedPayload: unknown = null

      const processorFn = inngest.createFunction(
        { id: 'processor-fn' },
        { event: 'process/data' },
        async ({ event }) => {
          receivedPayload = event.data
          return { success: true }
        }
      )

      const orchestratorFn = inngest.createFunction(
        { id: 'orchestrator-fn' },
        { event: 'orchestrate/start' },
        async ({ step }) => {
          await step.invoke('process-data', {
            function: processorFn,
            data: {
              items: [1, 2, 3],
              metadata: { source: 'test' },
            },
          })
        }
      )

      await orchestratorFn.invoke({
        name: 'orchestrate/start',
        data: {},
      })

      expect(receivedPayload).toEqual({
        items: [1, 2, 3],
        metadata: { source: 'test' },
      })
    })

    it('should return invoked function result', async () => {
      const calculatorFn = inngest.createFunction(
        { id: 'calculator-fn' },
        { event: 'calculate/sum' },
        async ({ event }) => {
          const numbers = event.data.numbers as number[]
          return { sum: numbers.reduce((a, b) => a + b, 0) }
        }
      )

      const mainFn = inngest.createFunction(
        { id: 'invoke-result-test' },
        { event: 'test/invoke-result' },
        async ({ step }) => {
          const result = await step.invoke<{ sum: number }>('calculate', {
            function: calculatorFn,
            data: { numbers: [1, 2, 3, 4, 5] },
          })
          return { total: result.sum }
        }
      )

      const result = await mainFn.invoke({
        name: 'test/invoke-result',
        data: {},
      })

      expect(result).toEqual({ total: 15 })
    })

    it('should handle timeout for invoked function', async () => {
      const slowFn = inngest.createFunction(
        { id: 'slow-fn' },
        { event: 'slow/operation' },
        async ({ step }) => {
          await step.sleep('long-wait', '1h')
          return { done: true }
        }
      )

      const callerFn = inngest.createFunction(
        { id: 'caller-fn' },
        { event: 'call/slow' },
        async ({ step }) => {
          const result = await step.invoke('call-slow', {
            function: slowFn,
            data: {},
            timeout: '1s',
          })
          return result
        }
      )

      // Attach handler to prevent unhandled rejection
      let timedOut = false
      const resultPromise = callerFn.invoke({
        name: 'call/slow',
        data: {},
      }).catch((e) => {
        timedOut = true
        return e
      })

      await vi.advanceTimersByTimeAsync(1100)

      await resultPromise
      expect(timedOut).toBe(true)
    })

    it('should memoize invoked function results', async () => {
      let invokeCount = 0

      const countingFn = inngest.createFunction(
        { id: 'counting-fn' },
        { event: 'count/invoke' },
        async () => {
          invokeCount++
          return { count: invokeCount }
        }
      )

      const mainFn = inngest.createFunction(
        { id: 'memoize-invoke-test' },
        { event: 'test/memoize-invoke' },
        async ({ step }) => {
          // Invoke same step ID twice - second should be memoized
          const result1 = await step.invoke('same-invoke', {
            function: countingFn,
            data: {},
          })
          const result2 = await step.invoke('same-invoke', {
            function: countingFn,
            data: {},
          })
          return { result1, result2 }
        }
      )

      const result = await mainFn.invoke({
        name: 'test/memoize-invoke',
        data: {},
      })

      // Should only invoke once due to memoization
      expect(invokeCount).toBe(1)
      expect(result.result1).toEqual(result.result2)
    })
  })

  // ============================================================================
  // CONCURRENCY TESTS (Limit concurrent executions)
  // ============================================================================

  describe('Inngest Concurrency', () => {
    it('should limit concurrent function executions', async () => {
      let currentConcurrency = 0
      let maxObservedConcurrency = 0

      const fn = inngest.createFunction(
        {
          id: 'concurrency-limit-test',
          concurrency: 2,
        },
        { event: 'test/concurrency' },
        async ({ step }) => {
          currentConcurrency++
          maxObservedConcurrency = Math.max(maxObservedConcurrency, currentConcurrency)

          await step.sleep('work', '100ms')

          currentConcurrency--
          return { done: true }
        }
      )

      // Start 5 concurrent executions
      const promises = [
        fn.invoke({ name: 'test/concurrency', data: { id: 1 } }),
        fn.invoke({ name: 'test/concurrency', data: { id: 2 } }),
        fn.invoke({ name: 'test/concurrency', data: { id: 3 } }),
        fn.invoke({ name: 'test/concurrency', data: { id: 4 } }),
        fn.invoke({ name: 'test/concurrency', data: { id: 5 } }),
      ]

      // Let them all complete
      await vi.advanceTimersByTimeAsync(1000)
      await Promise.all(promises)

      // Should never exceed concurrency limit of 2
      expect(maxObservedConcurrency).toBeLessThanOrEqual(2)
    })

    it('should support concurrency key for per-entity limits', async () => {
      const activeByUser: Record<string, number> = {}
      const maxByUser: Record<string, number> = {}

      const fn = inngest.createFunction(
        {
          id: 'concurrency-key-test',
          concurrency: {
            limit: 1,
            key: 'event.data.userId',
          },
        },
        { event: 'test/concurrency-key' },
        async ({ step, event }) => {
          const userId = event.data.userId as string

          activeByUser[userId] = (activeByUser[userId] || 0) + 1
          maxByUser[userId] = Math.max(maxByUser[userId] || 0, activeByUser[userId])

          await step.sleep('work', '100ms')

          activeByUser[userId]--
        }
      )

      // Start 2 for user-a and 2 for user-b
      const promises = [
        fn.invoke({ name: 'test/concurrency-key', data: { userId: 'user-a', id: 1 } }),
        fn.invoke({ name: 'test/concurrency-key', data: { userId: 'user-a', id: 2 } }),
        fn.invoke({ name: 'test/concurrency-key', data: { userId: 'user-b', id: 1 } }),
        fn.invoke({ name: 'test/concurrency-key', data: { userId: 'user-b', id: 2 } }),
      ]

      await vi.advanceTimersByTimeAsync(500)
      await Promise.all(promises)

      // Each user should have max 1 concurrent
      expect(maxByUser['user-a']).toBe(1)
      expect(maxByUser['user-b']).toBe(1)
    })

    it('should queue executions when concurrency limit reached', async () => {
      const executionOrder: number[] = []

      const fn = inngest.createFunction(
        {
          id: 'concurrency-queue-test',
          concurrency: 1,
        },
        { event: 'test/concurrency-queue' },
        async ({ step, event }) => {
          await step.run('record', () => {
            executionOrder.push(event.data.order as number)
          })
          await step.sleep('work', '50ms')
        }
      )

      // Start 3 executions
      const p1 = fn.invoke({ name: 'test/concurrency-queue', data: { order: 1 } })
      const p2 = fn.invoke({ name: 'test/concurrency-queue', data: { order: 2 } })
      const p3 = fn.invoke({ name: 'test/concurrency-queue', data: { order: 3 } })

      // Let them complete in order
      await vi.advanceTimersByTimeAsync(500)
      await Promise.all([p1, p2, p3])

      // Should execute in order due to queue
      expect(executionOrder).toEqual([1, 2, 3])
    })

    it('should support function-scoped concurrency', async () => {
      let globalConcurrency = 0
      let maxGlobalConcurrency = 0

      const fn = inngest.createFunction(
        {
          id: 'concurrency-fn-scope-test',
          concurrency: {
            limit: 3,
            scope: 'fn',
          },
        },
        { event: 'test/concurrency-fn-scope' },
        async ({ step }) => {
          globalConcurrency++
          maxGlobalConcurrency = Math.max(maxGlobalConcurrency, globalConcurrency)

          await step.sleep('work', '100ms')

          globalConcurrency--
        }
      )

      // Start 5 executions
      const promises = Array.from({ length: 5 }, (_, i) =>
        fn.invoke({ name: 'test/concurrency-fn-scope', data: { id: i } })
      )

      await vi.advanceTimersByTimeAsync(500)
      await Promise.all(promises)

      // Should limit to 3 across all invocations of this function
      expect(maxGlobalConcurrency).toBeLessThanOrEqual(3)
    })

    it('should support environment-scoped concurrency', async () => {
      let envConcurrency = 0
      let maxEnvConcurrency = 0

      const fn = inngest.createFunction(
        {
          id: 'concurrency-env-scope-test',
          concurrency: {
            limit: 2,
            scope: 'env',
          },
        },
        { event: 'test/concurrency-env-scope' },
        async ({ step }) => {
          envConcurrency++
          maxEnvConcurrency = Math.max(maxEnvConcurrency, envConcurrency)

          await step.sleep('work', '100ms')

          envConcurrency--
        }
      )

      // Start multiple executions
      const promises = Array.from({ length: 4 }, (_, i) =>
        fn.invoke({ name: 'test/concurrency-env-scope', data: { id: i } })
      )

      await vi.advanceTimersByTimeAsync(500)
      await Promise.all(promises)

      // Should limit across entire environment
      expect(maxEnvConcurrency).toBeLessThanOrEqual(2)
    })
  })
})
