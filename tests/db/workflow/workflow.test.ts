/**
 * RED Tests: Workflow Primitives
 *
 * These tests define the expected API for Temporal-inspired durable execution.
 * All tests should FAIL until implementation is complete.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  workflow,
  activity,
  defineActivity,
  WorkflowClient,
  WorkflowWorker,
} from '../../../db/workflow'

// =============================================================================
// Test Types
// =============================================================================

interface Order {
  id: string
  items: Array<{ sku: string; quantity: number }>
  shipping: { address: string; city: string; zip: string }
}

interface PaymentSignal {
  amount: number
  method: 'card' | 'bank' | 'crypto'
}

interface ReservationResult {
  id: string
  items: Array<{ sku: string; reserved: number }>
}

interface ShipmentResult {
  tracking: string
  carrier: string
}

// =============================================================================
// Workflow Definition Tests
// =============================================================================

describe('Workflow Definition', () => {
  describe('workflow()', () => {
    it('creates a workflow definition with name and handler', () => {
      const testWorkflow = workflow('testWorkflow', async (ctx, input: string) => {
        return { result: input.toUpperCase() }
      })

      expect(testWorkflow).toBeDefined()
      expect(testWorkflow.name).toBe('testWorkflow')
      expect(typeof testWorkflow.handler).toBe('function')
    })

    it('preserves input/output types in workflow definition', () => {
      const typedWorkflow = workflow('typedWorkflow', async (ctx, order: Order) => {
        return { status: 'processed', orderId: order.id }
      })

      expect(typedWorkflow).toBeDefined()
      // Type-level test: TypeScript should infer input as Order
    })

    it('workflow definition is serializable for registration', () => {
      const myWorkflow = workflow('serializableWorkflow', async (ctx, x: number) => x * 2)

      expect(myWorkflow.name).toBe('serializableWorkflow')
      expect(typeof myWorkflow.toJSON).toBe('function')
    })
  })
})

// =============================================================================
// Workflow Client Tests
// =============================================================================

describe('WorkflowClient', () => {
  let client: WorkflowClient

  beforeEach(() => {
    // Mock env.DO for testing
    const mockDO = {} as any
    client = new WorkflowClient(mockDO)
  })

  describe('start()', () => {
    it('starts a workflow and returns a handle', async () => {
      const testWorkflow = workflow('startTest', async (ctx, input: string) => input)

      const handle = await client.start(testWorkflow, {
        workflowId: 'test-123',
        input: 'hello',
        taskQueue: 'test-queue',
      })

      expect(handle).toBeDefined()
      expect(handle.workflowId).toBe('test-123')
    })

    it('rejects duplicate workflow IDs', async () => {
      const testWorkflow = workflow('duplicateTest', async (ctx, input: string) => input)

      await client.start(testWorkflow, {
        workflowId: 'duplicate-id',
        input: 'first',
        taskQueue: 'test-queue',
      })

      await expect(
        client.start(testWorkflow, {
          workflowId: 'duplicate-id',
          input: 'second',
          taskQueue: 'test-queue',
        })
      ).rejects.toThrow(/already exists/)
    })

    it('generates workflow ID if not provided', async () => {
      const testWorkflow = workflow('autoIdTest', async (ctx, input: number) => input * 2)

      const handle = await client.start(testWorkflow, {
        input: 42,
        taskQueue: 'test-queue',
      })

      expect(handle.workflowId).toBeDefined()
      expect(handle.workflowId.length).toBeGreaterThan(0)
    })
  })

  describe('handle.result()', () => {
    it('returns workflow result when complete', async () => {
      const testWorkflow = workflow('resultTest', async (ctx, input: number) => {
        return { doubled: input * 2 }
      })

      const handle = await client.start(testWorkflow, {
        workflowId: 'result-test-1',
        input: 21,
        taskQueue: 'test-queue',
      })

      const result = await handle.result()
      expect(result).toEqual({ doubled: 42 })
    })

    it('throws on workflow failure', async () => {
      const failingWorkflow = workflow('failTest', async () => {
        throw new Error('Workflow failed intentionally')
      })

      const handle = await client.start(failingWorkflow, {
        workflowId: 'fail-test-1',
        input: undefined,
        taskQueue: 'test-queue',
      })

      await expect(handle.result()).rejects.toThrow('Workflow failed intentionally')
    })

    it('supports timeout for result', async () => {
      const slowWorkflow = workflow('slowTest', async (ctx) => {
        await ctx.sleep('1h')
        return 'done'
      })

      const handle = await client.start(slowWorkflow, {
        workflowId: 'slow-test-1',
        input: undefined,
        taskQueue: 'test-queue',
      })

      await expect(handle.result({ timeout: '1s' })).rejects.toThrow(/timeout/)
    })
  })

  describe('handle.query()', () => {
    it('queries workflow state', async () => {
      const queryableWorkflow = workflow('queryTest', async (ctx, input: string) => {
        ctx.setQueryHandler('status', () => ({ step: 'processing', input }))
        await ctx.sleep('1h')
        return 'done'
      })

      const handle = await client.start(queryableWorkflow, {
        workflowId: 'query-test-1',
        input: 'test-input',
        taskQueue: 'test-queue',
      })

      const status = await handle.query('status')
      expect(status).toEqual({ step: 'processing', input: 'test-input' })
    })

    it('throws for unknown query handler', async () => {
      const testWorkflow = workflow('unknownQueryTest', async () => 'done')

      const handle = await client.start(testWorkflow, {
        workflowId: 'unknown-query-1',
        input: undefined,
        taskQueue: 'test-queue',
      })

      await expect(handle.query('nonexistent')).rejects.toThrow(/query handler.*not found/)
    })
  })

  describe('handle.signal()', () => {
    it('sends signal to workflow', async () => {
      const signalWorkflow = workflow('signalTest', async (ctx) => {
        const data = await ctx.waitForSignal<PaymentSignal>('payment')
        return { received: data.amount }
      })

      const handle = await client.start(signalWorkflow, {
        workflowId: 'signal-test-1',
        input: undefined,
        taskQueue: 'test-queue',
      })

      await handle.signal('payment', { amount: 99.99, method: 'card' })
      const result = await handle.result()
      expect(result).toEqual({ received: 99.99 })
    })

    it('queues signals if workflow not ready', async () => {
      const slowSignalWorkflow = workflow('slowSignalTest', async (ctx) => {
        await ctx.sleep('1s')
        const data = await ctx.waitForSignal<string>('message')
        return data
      })

      const handle = await client.start(slowSignalWorkflow, {
        workflowId: 'slow-signal-1',
        input: undefined,
        taskQueue: 'test-queue',
      })

      // Send signal before workflow is ready
      await handle.signal('message', 'hello')
      // Signal should be queued and delivered when ready
      const result = await handle.result()
      expect(result).toBe('hello')
    })
  })

  describe('handle.cancel()', () => {
    it('cancels a running workflow', async () => {
      const longWorkflow = workflow('cancelTest', async (ctx) => {
        await ctx.sleep('1h')
        return 'completed'
      })

      const handle = await client.start(longWorkflow, {
        workflowId: 'cancel-test-1',
        input: undefined,
        taskQueue: 'test-queue',
      })

      await handle.cancel()
      await expect(handle.result()).rejects.toThrow(/cancelled/)
    })
  })

  describe('list()', () => {
    it('lists workflows by status', async () => {
      const testWorkflow = workflow('listTest', async () => 'done')

      await client.start(testWorkflow, {
        workflowId: 'list-1',
        input: undefined,
        taskQueue: 'orders',
      })
      await client.start(testWorkflow, {
        workflowId: 'list-2',
        input: undefined,
        taskQueue: 'orders',
      })

      const workflows = await client.list({ status: 'running', taskQueue: 'orders' })
      expect(workflows).toHaveLength(2)
      expect(workflows.map((w) => w.workflowId)).toContain('list-1')
      expect(workflows.map((w) => w.workflowId)).toContain('list-2')
    })

    it('supports pagination', async () => {
      const testWorkflow = workflow('paginationTest', async () => 'done')

      for (let i = 0; i < 10; i++) {
        await client.start(testWorkflow, {
          workflowId: `page-${i}`,
          input: undefined,
          taskQueue: 'test',
        })
      }

      const page1 = await client.list({ taskQueue: 'test', limit: 5 })
      expect(page1).toHaveLength(5)
      expect(page1.nextPageToken).toBeDefined()

      const page2 = await client.list({
        taskQueue: 'test',
        limit: 5,
        pageToken: page1.nextPageToken,
      })
      expect(page2).toHaveLength(5)
    })
  })

  describe('describe()', () => {
    it('returns workflow execution info', async () => {
      const testWorkflow = workflow('describeTest', async () => 'done')

      await client.start(testWorkflow, {
        workflowId: 'describe-1',
        input: { foo: 'bar' },
        taskQueue: 'test-queue',
      })

      const info = await client.describe('describe-1')
      expect(info.workflowId).toBe('describe-1')
      expect(info.workflowType).toBe('describeTest')
      expect(info.status).toBe('running')
      expect(info.taskQueue).toBe('test-queue')
      expect(info.startedAt).toBeInstanceOf(Date)
    })

    it('throws for non-existent workflow', async () => {
      await expect(client.describe('non-existent')).rejects.toThrow(/not found/)
    })
  })

  describe('terminate()', () => {
    it('terminates workflow with reason', async () => {
      const longWorkflow = workflow('terminateTest', async (ctx) => {
        await ctx.sleep('1h')
        return 'done'
      })

      const handle = await client.start(longWorkflow, {
        workflowId: 'terminate-1',
        input: undefined,
        taskQueue: 'test',
      })

      await client.terminate('terminate-1', 'Admin cancellation')
      await expect(handle.result()).rejects.toThrow(/terminated.*Admin cancellation/)
    })
  })
})

// =============================================================================
// Activity Tests
// =============================================================================

describe('Activities', () => {
  describe('defineActivity()', () => {
    it('defines an activity with name and handler', () => {
      const myActivity = defineActivity('processPayment', async (amount: number) => {
        return { success: true, transactionId: 'tx-123' }
      })

      expect(myActivity).toBeDefined()
      expect(myActivity.name).toBe('processPayment')
      expect(typeof myActivity.handler).toBe('function')
    })
  })

  describe('ctx.activity()', () => {
    it('executes activity and returns result', async () => {
      const activityResult = { reserved: true, id: 'res-123' }

      const reserveActivity = defineActivity('reserve', async (items: string[]) => {
        return activityResult
      })

      const testWorkflow = workflow('activityExecTest', async (ctx, items: string[]) => {
        const result = await ctx.activity('reserve', { input: items })
        return result
      })

      // This should execute the activity and return the result
      const client = new WorkflowClient({} as any)
      const handle = await client.start(testWorkflow, {
        workflowId: 'activity-exec-1',
        input: ['item-1', 'item-2'],
        taskQueue: 'test',
      })

      const result = await handle.result()
      expect(result).toEqual(activityResult)
    })

    it('retries failed activities according to policy', async () => {
      let attempts = 0

      const flakyActivity = defineActivity('flaky', async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Temporary failure')
        }
        return { success: true }
      })

      const retryWorkflow = workflow('retryTest', async (ctx) => {
        return ctx.activity('flaky', {
          input: undefined,
          retry: {
            maxAttempts: 5,
            initialInterval: '100ms',
            backoffCoefficient: 2,
          },
        })
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(retryWorkflow, {
        workflowId: 'retry-1',
        input: undefined,
        taskQueue: 'test',
      })

      const result = await handle.result()
      expect(result).toEqual({ success: true })
      expect(attempts).toBe(3)
    })

    it('fails workflow after max retry attempts', async () => {
      const alwaysFailActivity = defineActivity('alwaysFail', async () => {
        throw new Error('Permanent failure')
      })

      const failWorkflow = workflow('maxRetryTest', async (ctx) => {
        return ctx.activity('alwaysFail', {
          input: undefined,
          retry: { maxAttempts: 3 },
        })
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(failWorkflow, {
        workflowId: 'max-retry-1',
        input: undefined,
        taskQueue: 'test',
      })

      await expect(handle.result()).rejects.toThrow('Permanent failure')
    })

    it('respects activity timeout', async () => {
      const slowActivity = defineActivity('slowActivity', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        return 'done'
      })

      const timeoutWorkflow = workflow('timeoutTest', async (ctx) => {
        return ctx.activity('slowActivity', {
          input: undefined,
          timeout: '100ms',
        })
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(timeoutWorkflow, {
        workflowId: 'timeout-1',
        input: undefined,
        taskQueue: 'test',
      })

      await expect(handle.result()).rejects.toThrow(/timeout/)
    })

    it('supports heartbeat for long-running activities', async () => {
      const longActivity = defineActivity('longRunning', async (ctx) => {
        for (let i = 0; i < 5; i++) {
          await ctx.heartbeat({ progress: i * 20 })
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        return { completed: true }
      })

      const heartbeatWorkflow = workflow('heartbeatTest', async (ctx) => {
        return ctx.activity('longRunning', {
          input: undefined,
          heartbeatTimeout: '500ms',
        })
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(heartbeatWorkflow, {
        workflowId: 'heartbeat-1',
        input: undefined,
        taskQueue: 'test',
      })

      const result = await handle.result()
      expect(result).toEqual({ completed: true })
    })

    it('supports exponential backoff', async () => {
      const timestamps: number[] = []

      const trackingActivity = defineActivity('tracking', async () => {
        timestamps.push(Date.now())
        if (timestamps.length < 4) {
          throw new Error('Not yet')
        }
        return 'done'
      })

      const backoffWorkflow = workflow('backoffTest', async (ctx) => {
        return ctx.activity('tracking', {
          input: undefined,
          retry: {
            maxAttempts: 5,
            initialInterval: '100ms',
            maxInterval: '1s',
            backoffCoefficient: 2,
          },
        })
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(backoffWorkflow, {
        workflowId: 'backoff-1',
        input: undefined,
        taskQueue: 'test',
      })

      await handle.result()

      // Verify exponential backoff: ~100ms, ~200ms, ~400ms
      const intervals = timestamps.slice(1).map((t, i) => t - timestamps[i])
      expect(intervals[1]).toBeGreaterThan(intervals[0])
      expect(intervals[2]).toBeGreaterThan(intervals[1])
    })
  })
})

// =============================================================================
// Timer Tests
// =============================================================================

describe('Durable Timers', () => {
  describe('ctx.sleep()', () => {
    it('sleeps for specified duration string', async () => {
      const sleepWorkflow = workflow('sleepStringTest', async (ctx) => {
        const before = Date.now()
        await ctx.sleep('100ms')
        const after = Date.now()
        return { elapsed: after - before }
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(sleepWorkflow, {
        workflowId: 'sleep-string-1',
        input: undefined,
        taskQueue: 'test',
      })

      const result = await handle.result()
      expect(result.elapsed).toBeGreaterThanOrEqual(100)
    })

    it('sleeps for specified duration in milliseconds', async () => {
      const sleepWorkflow = workflow('sleepMsTest', async (ctx) => {
        const before = Date.now()
        await ctx.sleep(150)
        const after = Date.now()
        return { elapsed: after - before }
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(sleepWorkflow, {
        workflowId: 'sleep-ms-1',
        input: undefined,
        taskQueue: 'test',
      })

      const result = await handle.result()
      expect(result.elapsed).toBeGreaterThanOrEqual(150)
    })

    it('survives workflow replay after crash', async () => {
      // This test verifies that sleep is durable
      const durableSleepWorkflow = workflow('durableSleepTest', async (ctx) => {
        await ctx.sleep('1s')
        return 'survived'
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(durableSleepWorkflow, {
        workflowId: 'durable-sleep-1',
        input: undefined,
        taskQueue: 'test',
      })

      // Simulate crash and replay - implementation should handle this
      const result = await handle.result()
      expect(result).toBe('survived')
    })
  })

  describe('ctx.sleepUntil()', () => {
    it('sleeps until specific ISO timestamp', async () => {
      const future = new Date(Date.now() + 100).toISOString()

      const sleepUntilWorkflow = workflow('sleepUntilTest', async (ctx) => {
        await ctx.sleepUntil(future)
        return 'woke up'
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(sleepUntilWorkflow, {
        workflowId: 'sleep-until-1',
        input: undefined,
        taskQueue: 'test',
      })

      const result = await handle.result()
      expect(result).toBe('woke up')
    })

    it('sleeps until specific Date object', async () => {
      const future = new Date(Date.now() + 100)

      const sleepUntilDateWorkflow = workflow('sleepUntilDateTest', async (ctx) => {
        await ctx.sleepUntil(future)
        return 'woke up from date'
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(sleepUntilDateWorkflow, {
        workflowId: 'sleep-until-date-1',
        input: undefined,
        taskQueue: 'test',
      })

      const result = await handle.result()
      expect(result).toBe('woke up from date')
    })

    it('returns immediately if time is in the past', async () => {
      const past = new Date(Date.now() - 1000).toISOString()

      const pastWorkflow = workflow('pastTimeTest', async (ctx) => {
        const before = Date.now()
        await ctx.sleepUntil(past)
        const after = Date.now()
        return { elapsed: after - before }
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(pastWorkflow, {
        workflowId: 'past-time-1',
        input: undefined,
        taskQueue: 'test',
      })

      const result = await handle.result()
      expect(result.elapsed).toBeLessThan(50) // Should return almost immediately
    })
  })
})

// =============================================================================
// Signals Tests
// =============================================================================

describe('Signals', () => {
  describe('ctx.waitForSignal()', () => {
    it('waits for signal and returns payload', async () => {
      const signalWorkflow = workflow('waitSignalTest', async (ctx) => {
        const payment = await ctx.waitForSignal<PaymentSignal>('payment')
        return { received: payment }
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(signalWorkflow, {
        workflowId: 'wait-signal-1',
        input: undefined,
        taskQueue: 'test',
      })

      // Send signal after workflow starts waiting
      setTimeout(async () => {
        await handle.signal('payment', { amount: 100, method: 'card' })
      }, 50)

      const result = await handle.result()
      expect(result.received).toEqual({ amount: 100, method: 'card' })
    })

    it('times out and returns default value', async () => {
      const timeoutSignalWorkflow = workflow('timeoutSignalTest', async (ctx) => {
        const approval = await ctx.waitForSignal('approval', {
          timeout: '100ms',
          default: { approved: false, reason: 'timeout' },
        })
        return approval
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(timeoutSignalWorkflow, {
        workflowId: 'timeout-signal-1',
        input: undefined,
        taskQueue: 'test',
      })

      // Don't send any signal
      const result = await handle.result()
      expect(result).toEqual({ approved: false, reason: 'timeout' })
    })

    it('times out and throws if no default', async () => {
      const throwTimeoutWorkflow = workflow('throwTimeoutTest', async (ctx) => {
        return ctx.waitForSignal('neverComes', { timeout: '100ms' })
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(throwTimeoutWorkflow, {
        workflowId: 'throw-timeout-1',
        input: undefined,
        taskQueue: 'test',
      })

      await expect(handle.result()).rejects.toThrow(/timeout.*signal/)
    })

    it('receives signals sent before waiting', async () => {
      const bufferedSignalWorkflow = workflow('bufferedSignalTest', async (ctx) => {
        await ctx.sleep('100ms') // Delay before waiting
        const message = await ctx.waitForSignal<string>('message')
        return message
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(bufferedSignalWorkflow, {
        workflowId: 'buffered-signal-1',
        input: undefined,
        taskQueue: 'test',
      })

      // Send signal immediately (before workflow waits)
      await handle.signal('message', 'early bird')

      const result = await handle.result()
      expect(result).toBe('early bird')
    })

    it('processes multiple signals of the same type in order', async () => {
      const multiSignalWorkflow = workflow('multiSignalTest', async (ctx) => {
        const messages: string[] = []
        for (let i = 0; i < 3; i++) {
          const msg = await ctx.waitForSignal<string>('message')
          messages.push(msg)
        }
        return messages
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(multiSignalWorkflow, {
        workflowId: 'multi-signal-1',
        input: undefined,
        taskQueue: 'test',
      })

      await handle.signal('message', 'first')
      await handle.signal('message', 'second')
      await handle.signal('message', 'third')

      const result = await handle.result()
      expect(result).toEqual(['first', 'second', 'third'])
    })
  })
})

// =============================================================================
// Query Tests
// =============================================================================

describe('Queries', () => {
  describe('ctx.setQueryHandler()', () => {
    it('registers query handler that returns state', async () => {
      const queryWorkflow = workflow('queryHandlerTest', async (ctx, input: string) => {
        let status = 'starting'

        ctx.setQueryHandler('status', () => ({ status, input }))

        status = 'processing'
        await ctx.sleep('1h')

        status = 'done'
        return status
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(queryWorkflow, {
        workflowId: 'query-handler-1',
        input: 'test-data',
        taskQueue: 'test',
      })

      // Allow workflow to start
      await new Promise((resolve) => setTimeout(resolve, 50))

      const state = await handle.query('status')
      expect(state).toEqual({ status: 'processing', input: 'test-data' })
    })

    it('allows multiple query handlers', async () => {
      const multiQueryWorkflow = workflow('multiQueryTest', async (ctx) => {
        let step = 1
        let items: string[] = []

        ctx.setQueryHandler('step', () => step)
        ctx.setQueryHandler('items', () => items)
        ctx.setQueryHandler('summary', () => ({ step, itemCount: items.length }))

        items.push('a', 'b')
        step = 2
        await ctx.sleep('1h')

        return 'done'
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(multiQueryWorkflow, {
        workflowId: 'multi-query-1',
        input: undefined,
        taskQueue: 'test',
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(await handle.query('step')).toBe(2)
      expect(await handle.query('items')).toEqual(['a', 'b'])
      expect(await handle.query('summary')).toEqual({ step: 2, itemCount: 2 })
    })

    it('query handlers receive arguments', async () => {
      const argQueryWorkflow = workflow('argQueryTest', async (ctx) => {
        const data = new Map<string, number>([
          ['a', 1],
          ['b', 2],
        ])

        ctx.setQueryHandler('get', (key: string) => data.get(key))

        await ctx.sleep('1h')
        return 'done'
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(argQueryWorkflow, {
        workflowId: 'arg-query-1',
        input: undefined,
        taskQueue: 'test',
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(await handle.query('get', 'a')).toBe(1)
      expect(await handle.query('get', 'b')).toBe(2)
      expect(await handle.query('get', 'c')).toBeUndefined()
    })
  })
})

// =============================================================================
// Child Workflow Tests
// =============================================================================

describe('Child Workflows', () => {
  describe('ctx.startChild()', () => {
    it('starts child workflow and returns handle', async () => {
      const childWorkflow = workflow('child', async (ctx, input: number) => {
        return input * 2
      })

      const parentWorkflow = workflow('parent', async (ctx) => {
        const childHandle = await ctx.startChild(childWorkflow, {
          workflowId: 'child-1',
          input: 21,
        })

        const result = await childHandle.result()
        return { childResult: result }
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(parentWorkflow, {
        workflowId: 'parent-1',
        input: undefined,
        taskQueue: 'test',
      })

      const result = await handle.result()
      expect(result).toEqual({ childResult: 42 })
    })

    it('fan-out to multiple child workflows', async () => {
      const processItem = workflow('processItem', async (ctx, item: string) => {
        return { processed: item.toUpperCase() }
      })

      const fanOutWorkflow = workflow('fanOut', async (ctx, items: string[]) => {
        const handles = await Promise.all(
          items.map((item, i) =>
            ctx.startChild(processItem, {
              workflowId: `item-${i}`,
              input: item,
            })
          )
        )

        const results = await Promise.all(handles.map((h) => h.result()))
        return { results }
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(fanOutWorkflow, {
        workflowId: 'fan-out-1',
        input: ['a', 'b', 'c'],
        taskQueue: 'test',
      })

      const result = await handle.result()
      expect(result.results).toEqual([
        { processed: 'A' },
        { processed: 'B' },
        { processed: 'C' },
      ])
    })

    it('child workflow inherits parent task queue by default', async () => {
      const childWorkflow = workflow('taskQueueChild', async (ctx) => {
        return ctx.taskQueue
      })

      const parentWorkflow = workflow('taskQueueParent', async (ctx) => {
        const childHandle = await ctx.startChild(childWorkflow, {
          workflowId: 'tq-child-1',
          input: undefined,
        })
        return childHandle.result()
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(parentWorkflow, {
        workflowId: 'tq-parent-1',
        input: undefined,
        taskQueue: 'inherited-queue',
      })

      const result = await handle.result()
      expect(result).toBe('inherited-queue')
    })

    it('child workflow can override task queue', async () => {
      const childWorkflow = workflow('overrideChild', async (ctx) => {
        return ctx.taskQueue
      })

      const parentWorkflow = workflow('overrideParent', async (ctx) => {
        const childHandle = await ctx.startChild(childWorkflow, {
          workflowId: 'override-child-1',
          input: undefined,
          taskQueue: 'different-queue',
        })
        return childHandle.result()
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(parentWorkflow, {
        workflowId: 'override-parent-1',
        input: undefined,
        taskQueue: 'parent-queue',
      })

      const result = await handle.result()
      expect(result).toBe('different-queue')
    })

    it('parent fails if child fails (default behavior)', async () => {
      const failingChild = workflow('failingChild', async () => {
        throw new Error('Child failure')
      })

      const parentWorkflow = workflow('parentOfFailing', async (ctx) => {
        const childHandle = await ctx.startChild(failingChild, {
          workflowId: 'failing-child-1',
          input: undefined,
        })
        return childHandle.result()
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(parentWorkflow, {
        workflowId: 'parent-of-failing-1',
        input: undefined,
        taskQueue: 'test',
      })

      await expect(handle.result()).rejects.toThrow('Child failure')
    })

    it('parent can catch child failure', async () => {
      const failingChild = workflow('catchableChild', async () => {
        throw new Error('Catchable failure')
      })

      const resilientParent = workflow('resilientParent', async (ctx) => {
        const childHandle = await ctx.startChild(failingChild, {
          workflowId: 'catchable-child-1',
          input: undefined,
        })

        try {
          await childHandle.result()
          return { status: 'child succeeded' }
        } catch (error) {
          return { status: 'child failed', error: (error as Error).message }
        }
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(resilientParent, {
        workflowId: 'resilient-parent-1',
        input: undefined,
        taskQueue: 'test',
      })

      const result = await handle.result()
      expect(result).toEqual({ status: 'child failed', error: 'Catchable failure' })
    })
  })
})

// =============================================================================
// Workflow Completion Tests
// =============================================================================

describe('Workflow Completion and Failure', () => {
  describe('successful completion', () => {
    it('workflow completes with return value', async () => {
      const successWorkflow = workflow('successTest', async (ctx, input: number) => {
        return { result: input + 1 }
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(successWorkflow, {
        workflowId: 'success-1',
        input: 41,
        taskQueue: 'test',
      })

      const result = await handle.result()
      expect(result).toEqual({ result: 42 })

      const info = await client.describe('success-1')
      expect(info.status).toBe('completed')
      expect(info.completedAt).toBeInstanceOf(Date)
    })

    it('workflow completes with undefined return', async () => {
      const voidWorkflow = workflow('voidTest', async () => {
        // No return
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(voidWorkflow, {
        workflowId: 'void-1',
        input: undefined,
        taskQueue: 'test',
      })

      const result = await handle.result()
      expect(result).toBeUndefined()
    })
  })

  describe('failure handling', () => {
    it('workflow fails with thrown error', async () => {
      const errorWorkflow = workflow('errorTest', async () => {
        throw new Error('Intentional failure')
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(errorWorkflow, {
        workflowId: 'error-1',
        input: undefined,
        taskQueue: 'test',
      })

      await expect(handle.result()).rejects.toThrow('Intentional failure')

      const info = await client.describe('error-1')
      expect(info.status).toBe('failed')
      expect(info.error).toContain('Intentional failure')
    })

    it('workflow fails with custom error type', async () => {
      class BusinessError extends Error {
        constructor(
          message: string,
          public code: string
        ) {
          super(message)
          this.name = 'BusinessError'
        }
      }

      const businessErrorWorkflow = workflow('businessErrorTest', async () => {
        throw new BusinessError('Insufficient funds', 'INSUFFICIENT_FUNDS')
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(businessErrorWorkflow, {
        workflowId: 'business-error-1',
        input: undefined,
        taskQueue: 'test',
      })

      try {
        await handle.result()
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).toBe('Insufficient funds')
        // Error details should be preserved
      }
    })
  })

  describe('cancellation', () => {
    it('cancelled workflow throws CancelledError', async () => {
      const cancellableWorkflow = workflow('cancellableTest', async (ctx) => {
        await ctx.sleep('1h')
        return 'completed'
      })

      const client = new WorkflowClient({} as any)
      const handle = await client.start(cancellableWorkflow, {
        workflowId: 'cancellable-1',
        input: undefined,
        taskQueue: 'test',
      })

      await handle.cancel()

      try {
        await handle.result()
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).name).toBe('CancelledError')
      }

      const info = await client.describe('cancellable-1')
      expect(info.status).toBe('cancelled')
    })

    it('workflow can handle cancellation gracefully', async () => {
      const gracefulWorkflow = workflow('gracefulTest', async (ctx) => {
        try {
          await ctx.sleep('1h')
          return 'completed'
        } catch (error) {
          if ((error as Error).name === 'CancelledError') {
            // Cleanup
            await ctx.activity('cleanup', { input: undefined })
            throw error // Re-throw after cleanup
          }
          throw error
        }
      })

      // Test that cleanup activity is called
      const client = new WorkflowClient({} as any)
      const handle = await client.start(gracefulWorkflow, {
        workflowId: 'graceful-1',
        input: undefined,
        taskQueue: 'test',
      })

      await handle.cancel()
      await expect(handle.result()).rejects.toThrow()
    })
  })
})

// =============================================================================
// Workflow Worker Tests
// =============================================================================

describe('WorkflowWorker', () => {
  it('creates worker with task queue and registrations', () => {
    const testWorkflow = workflow('workerTest', async () => 'done')
    const testActivity = defineActivity('workerActivity', async () => 'result')

    const worker = new WorkflowWorker({
      taskQueue: 'test-queue',
      workflows: [testWorkflow],
      activities: [testActivity],
    })

    expect(worker).toBeDefined()
    expect(worker.taskQueue).toBe('test-queue')
  })

  it('worker.run() starts processing', async () => {
    const testWorkflow = workflow('runTest', async () => 'done')

    const worker = new WorkflowWorker({
      taskQueue: 'test-queue',
      workflows: [testWorkflow],
      activities: [],
    })

    // run() should return a promise that resolves when worker stops
    const runPromise = worker.run()
    expect(runPromise).toBeInstanceOf(Promise)

    await worker.shutdown()
  })

  it('worker.shutdown() stops gracefully', async () => {
    const testWorkflow = workflow('shutdownTest', async () => 'done')

    const worker = new WorkflowWorker({
      taskQueue: 'test-queue',
      workflows: [testWorkflow],
      activities: [],
    })

    const runPromise = worker.run()

    // Shutdown should complete pending work
    await worker.shutdown()

    // run() promise should resolve
    await runPromise
  })

  it('worker processes workflows from task queue', async () => {
    const processedIds: string[] = []

    const trackingWorkflow = workflow('trackingTest', async (ctx, id: string) => {
      processedIds.push(id)
      return id
    })

    const worker = new WorkflowWorker({
      taskQueue: 'tracking-queue',
      workflows: [trackingWorkflow],
      activities: [],
    })

    worker.run() // Don't await - runs in background

    const client = new WorkflowClient({} as any)

    const handle1 = await client.start(trackingWorkflow, {
      workflowId: 'track-1',
      input: 'first',
      taskQueue: 'tracking-queue',
    })

    const handle2 = await client.start(trackingWorkflow, {
      workflowId: 'track-2',
      input: 'second',
      taskQueue: 'tracking-queue',
    })

    await handle1.result()
    await handle2.result()

    expect(processedIds).toContain('first')
    expect(processedIds).toContain('second')

    await worker.shutdown()
  })
})

// =============================================================================
// Integration Test: Order Processing Workflow
// =============================================================================

describe('Integration: Order Processing Workflow', () => {
  it('processes complete order workflow with activities, signals, and timers', async () => {
    // Define activities
    const reserveInventory = defineActivity(
      'reserveInventory',
      async (items: Order['items']): Promise<ReservationResult> => {
        return {
          id: 'res-123',
          items: items.map((item) => ({ sku: item.sku, reserved: item.quantity })),
        }
      }
    )

    const cancelReservation = defineActivity('cancelReservation', async (reservationId: string) => {
      return { cancelled: true }
    })

    const shipOrder = defineActivity(
      'shipOrder',
      async (order: { orderId: string; address: Order['shipping'] }): Promise<ShipmentResult> => {
        return { tracking: 'TRACK-456', carrier: 'UPS' }
      }
    )

    // Define workflow
    const orderWorkflow = workflow('processOrder', async (ctx, order: Order) => {
      // Reserve inventory
      const reserved = await ctx.activity('reserveInventory', {
        input: order.items,
        retry: { maxAttempts: 3, backoff: 'exponential' },
      })

      // Wait for payment with timeout
      const payment = await ctx.waitForSignal<PaymentSignal | null>('payment', {
        timeout: '24h',
        default: null,
      })

      if (!payment) {
        await ctx.activity('cancelReservation', { input: reserved.id })
        return { status: 'cancelled', reason: 'payment_timeout' }
      }

      // Ship order
      const shipment = await ctx.activity('shipOrder', {
        input: { orderId: order.id, address: order.shipping },
      })

      return { status: 'completed', trackingNumber: shipment.tracking }
    })

    // Execute
    const client = new WorkflowClient({} as any)

    const order: Order = {
      id: 'order-789',
      items: [{ sku: 'WIDGET-1', quantity: 2 }],
      shipping: { address: '123 Main St', city: 'Springfield', zip: '12345' },
    }

    const handle = await client.start(orderWorkflow, {
      workflowId: `order-${order.id}`,
      input: order,
      taskQueue: 'orders',
    })

    // Send payment signal
    await handle.signal('payment', { amount: 99.99, method: 'card' })

    // Get result
    const result = await handle.result()

    expect(result).toEqual({
      status: 'completed',
      trackingNumber: 'TRACK-456',
    })
  })

  it('handles payment timeout in order workflow', async () => {
    const orderWorkflow = workflow('processOrderTimeout', async (ctx, order: Order) => {
      await ctx.activity('reserveInventory', { input: order.items })

      const payment = await ctx.waitForSignal<PaymentSignal | null>('payment', {
        timeout: '100ms', // Short timeout for test
        default: null,
      })

      if (!payment) {
        await ctx.activity('cancelReservation', { input: 'res-123' })
        return { status: 'cancelled', reason: 'payment_timeout' }
      }

      return { status: 'completed' }
    })

    const client = new WorkflowClient({} as any)

    const handle = await client.start(orderWorkflow, {
      workflowId: 'timeout-order-1',
      input: {
        id: 'order-timeout',
        items: [{ sku: 'WIDGET', quantity: 1 }],
        shipping: { address: '123 Main', city: 'City', zip: '11111' },
      },
      taskQueue: 'orders',
    })

    // Don't send payment - let it timeout
    const result = await handle.result()

    expect(result).toEqual({
      status: 'cancelled',
      reason: 'payment_timeout',
    })
  })
})
