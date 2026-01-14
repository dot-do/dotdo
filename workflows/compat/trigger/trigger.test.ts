/**
 * Trigger.dev Compat Layer Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { task, wait, retry, queue, abort, AbortTaskRunError } from './index'

describe('Trigger.dev Compat Layer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('task', () => {
    it('should create a task with id', () => {
      const myTask = task({
        id: 'my-task',
        run: async () => 'result',
      })

      expect(myTask.id).toBe('my-task')
    })

    it('should create a task with version', () => {
      const myTask = task({
        id: 'versioned-task',
        version: '1.0.0',
        run: async () => 'result',
      })

      expect(myTask.version).toBe('1.0.0')
    })
  })

  describe('trigger', () => {
    it('should trigger a task and return run ID', async () => {
      const myTask = task({
        id: 'trigger-test',
        run: async (payload: { value: number }) => payload.value * 2,
      })

      const result = await myTask.trigger({ value: 21 })

      expect(result.id).toBeDefined()
      expect(result.id).toMatch(/^run_/)
      expect(result.handle).toBeDefined()
    })

    it('should execute the task run function', async () => {
      let executed = false

      const myTask = task({
        id: 'execute-test',
        run: async () => {
          executed = true
          return 'done'
        },
      })

      await myTask.trigger({})

      // Allow execution
      await vi.advanceTimersByTimeAsync(100)

      expect(executed).toBe(true)
    })
  })

  describe('triggerAndWait', () => {
    it('should trigger and wait for result', async () => {
      const myTask = task({
        id: 'wait-test',
        run: async (payload: { x: number }) => payload.x * 2,
      })

      const result = await myTask.triggerAndWait({ x: 5 })

      expect(result.ok).toBe(true)
      expect(result.status).toBe('COMPLETED')
      expect(result.output).toBe(10)
    })

    it('should return error on failure', async () => {
      const myTask = task({
        id: 'fail-test',
        run: async () => {
          throw new Error('Task failed')
        },
      })

      const result = await myTask.triggerAndWait({})

      expect(result.ok).toBe(false)
      expect(result.status).toBe('FAILED')
      expect(result.error?.message).toBe('Task failed')
    })
  })

  describe('batchTrigger', () => {
    it('should trigger multiple items', async () => {
      const myTask = task({
        id: 'batch-test',
        run: async (payload: { id: number }) => payload.id,
      })

      const result = await myTask.batchTrigger([{ id: 1 }, { id: 2 }, { id: 3 }])

      expect(result.runs.length).toBe(3)
      expect(result.runs[0].id).toBeDefined()
      expect(result.runs[1].id).toBeDefined()
      expect(result.runs[2].id).toBeDefined()
    })
  })

  describe('batchTriggerAndWait', () => {
    it('should trigger and wait for all results', async () => {
      const myTask = task({
        id: 'batch-wait-test',
        run: async (payload: { n: number }) => payload.n * 2,
      })

      const result = await myTask.batchTriggerAndWait([{ n: 1 }, { n: 2 }, { n: 3 }])

      expect(result.runs.length).toBe(3)
      expect(result.runs.every((r) => r.ok)).toBe(true)
      expect(result.runs.map((r) => r.output)).toEqual([2, 4, 6])
    })
  })

  describe('task context', () => {
    it('should provide ctx.run for subtasks', async () => {
      let subtaskResult: number | undefined

      const myTask = task({
        id: 'ctx-run-test',
        run: async (payload: { x: number }, { ctx }) => {
          subtaskResult = await ctx.run('subtask', () => payload.x + 10)
          return subtaskResult
        },
      })

      const result = await myTask.triggerAndWait({ x: 5 })

      expect(subtaskResult).toBe(15)
      expect(result.output).toBe(15)
    })

    it('should memoize ctx.run results', async () => {
      let callCount = 0

      const myTask = task({
        id: 'memoize-test',
        run: async (_, { ctx }) => {
          await ctx.run('same-step', () => {
            callCount++
            return 1
          })
          await ctx.run('same-step', () => {
            callCount++
            return 2
          })
          return callCount
        },
      })

      await myTask.triggerAndWait({})

      expect(callCount).toBe(1)
    })
  })

  describe('lifecycle hooks', () => {
    it('should call onStart hook', async () => {
      const onStart = vi.fn()

      const myTask = task({
        id: 'onstart-test',
        onStart,
        run: async () => 'result',
      })

      await myTask.triggerAndWait({})

      expect(onStart).toHaveBeenCalled()
    })

    it('should call onSuccess hook', async () => {
      const onSuccess = vi.fn()

      const myTask = task({
        id: 'onsuccess-test',
        onSuccess,
        run: async () => 'result',
      })

      await myTask.triggerAndWait({})

      expect(onSuccess).toHaveBeenCalledWith({}, 'result', expect.anything())
    })

    it('should call onFailure hook on error', async () => {
      const onFailure = vi.fn()

      const myTask = task({
        id: 'onfailure-test',
        onFailure,
        run: async () => {
          throw new Error('Failed')
        },
      })

      await myTask.triggerAndWait({})

      expect(onFailure).toHaveBeenCalled()
    })
  })

  describe('middleware', () => {
    it('should apply middleware hooks', async () => {
      const beforeRun = vi.fn()
      const afterRun = vi.fn()

      const myTask = task({
        id: 'middleware-test',
        middleware: [
          {
            name: 'test-mw',
            beforeRun,
            afterRun,
          },
        ],
        run: async () => 'result',
      })

      await myTask.triggerAndWait({})

      expect(beforeRun).toHaveBeenCalled()
      expect(afterRun).toHaveBeenCalled()
    })

    it('should transform payload with onEnqueue', async () => {
      const myTask = task({
        id: 'enqueue-mw-test',
        middleware: [
          {
            name: 'transform-mw',
            onEnqueue: (payload: unknown) => ({
              ...(payload as Record<string, unknown>),
              extra: 'added',
            }),
          },
        ],
        run: async (payload: { original: string; extra?: string }) => payload.extra,
      })

      const result = await myTask.triggerAndWait({ original: 'value' })

      expect(result.output).toBe('added')
    })
  })

  describe('wait utilities', () => {
    it('should wait for duration (seconds)', async () => {
      const start = Date.now()

      const waitPromise = wait.for({ seconds: 5 })
      await vi.advanceTimersByTimeAsync(5000)
      await waitPromise

      // Timer was advanced by 5 seconds
      expect(true).toBe(true)
    })

    it('should wait for duration (minutes)', async () => {
      const waitPromise = wait.for({ minutes: 2 })
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
      await waitPromise

      expect(true).toBe(true)
    })

    it('should wait until date', async () => {
      const futureDate = new Date(Date.now() + 10000)

      const waitPromise = wait.until(futureDate)
      await vi.advanceTimersByTimeAsync(10000)
      await waitPromise

      expect(true).toBe(true)
    })
  })

  describe('retry utilities', () => {
    it('should create default retry config', () => {
      const config = retry.preset('default')

      expect(config.maxAttempts).toBe(3)
      expect(config.factor).toBe(2)
    })

    it('should create aggressive retry config', () => {
      const config = retry.preset('aggressive')

      expect(config.maxAttempts).toBe(10)
    })

    it('should create exponential backoff config', () => {
      const config = retry.exponential(5, { minTimeout: 500, maxTimeout: 10000 })

      expect(config.maxAttempts).toBe(5)
      expect(config.minTimeoutInMs).toBe(500)
      expect(config.maxTimeoutInMs).toBe(10000)
    })

    it('should create linear backoff config', () => {
      const config = retry.linear(3, 1000)

      expect(config.maxAttempts).toBe(3)
      expect(config.factor).toBe(1)
    })
  })

  describe('queue utilities', () => {
    it('should create queue config', () => {
      const config = queue.create('my-queue', { concurrency: 5 })

      expect(config.name).toBe('my-queue')
      expect(config.concurrencyLimit).toBe(5)
    })

    it('should create queue with rate limit', () => {
      const config = queue.create('rate-limited', {
        rateLimit: { limit: 100, period: '1m' },
      })

      expect(config.rateLimit?.limit).toBe(100)
    })
  })

  describe('abort', () => {
    it('should throw AbortTaskRunError', () => {
      expect(() => abort('Task aborted')).toThrow(AbortTaskRunError)
    })

    it('should have correct error properties', () => {
      try {
        abort('Custom abort message')
      } catch (error) {
        expect((error as AbortTaskRunError).isAbortTaskRunError).toBe(true)
        expect((error as AbortTaskRunError).message).toBe('Custom abort message')
      }
    })
  })
})
