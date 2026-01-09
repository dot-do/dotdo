/**
 * Inngest Compat Layer Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Inngest, NonRetriableError, RetryAfterError, StepError, serve } from './index'

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
})
