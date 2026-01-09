/**
 * Temporal Compat Layer Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  defineSignal,
  defineQuery,
  defineUpdate,
  setHandler,
  proxyActivities,
  sleep,
  condition,
  WorkflowClient,
  CancellationScope,
  ContinueAsNew,
  continueAsNew,
  uuid4,
  random,
  configure,
} from './index'

describe('Temporal Compat Layer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Signal Definitions', () => {
    it('should create signal definition', () => {
      const approval = defineSignal<[boolean]>('approval')

      expect(approval.name).toBe('approval')
      expect(approval.type).toBe('signal')
    })

    it('should create signal with no args', () => {
      const shutdown = defineSignal('shutdown')

      expect(shutdown.name).toBe('shutdown')
    })
  })

  describe('Query Definitions', () => {
    it('should create query definition', () => {
      const getStatus = defineQuery<string>('getStatus')

      expect(getStatus.name).toBe('getStatus')
      expect(getStatus.type).toBe('query')
    })

    it('should create query with args', () => {
      const getValue = defineQuery<number, [string]>('getValue')

      expect(getValue.name).toBe('getValue')
    })
  })

  describe('Update Definitions', () => {
    it('should create update definition', () => {
      const updateConfig = defineUpdate<void, [{ key: string; value: string }]>('updateConfig')

      expect(updateConfig.name).toBe('updateConfig')
      expect(updateConfig.type).toBe('update')
    })
  })

  describe('WorkflowClient', () => {
    it('should create client', () => {
      const client = new WorkflowClient()
      expect(client).toBeDefined()
    })

    it('should create client with namespace', () => {
      const client = new WorkflowClient({ namespace: 'my-namespace' })
      expect(client).toBeDefined()
    })
  })

  describe('proxyActivities', () => {
    it('should create activity proxy', () => {
      const activities = proxyActivities<{
        sendEmail: (to: string, body: string) => Promise<void>
        chargeCard: (token: string, amount: number) => Promise<boolean>
      }>({
        startToCloseTimeout: '10s',
      })

      expect(activities.sendEmail).toBeDefined()
      expect(activities.chargeCard).toBeDefined()
      expect(typeof activities.sendEmail).toBe('function')
    })

    it('should create proxy with retry policy', () => {
      const activities = proxyActivities<{
        riskyOperation: () => Promise<void>
      }>({
        startToCloseTimeout: '30s',
        retry: {
          maximumAttempts: 5,
          initialInterval: '1s',
          backoffCoefficient: 2,
        },
      })

      expect(activities.riskyOperation).toBeDefined()
    })
  })

  describe('CancellationScope', () => {
    it('should run function in scope', async () => {
      let executed = false

      await CancellationScope.run(async () => {
        executed = true
        return 'result'
      })

      expect(executed).toBe(true)
    })

    it('should run non-cancellable scope', async () => {
      const result = await CancellationScope.nonCancellable(async () => {
        return 'non-cancellable result'
      })

      expect(result).toBe('non-cancellable result')
    })

    it('should track cancellation state', () => {
      const scope = new CancellationScope()

      expect(scope.isCancelled).toBe(false)

      scope.cancel()

      expect(scope.isCancelled).toBe(true)
    })
  })

  describe('ContinueAsNew', () => {
    it('should throw ContinueAsNew error', () => {
      expect(() => continueAsNew('arg1', 'arg2')).toThrow(ContinueAsNew)
    })

    it('should include args in error', () => {
      try {
        continueAsNew('arg1', 42, { nested: true })
      } catch (error) {
        expect((error as ContinueAsNew).args).toEqual(['arg1', 42, { nested: true }])
      }
    })
  })

  describe('Deterministic Utilities', () => {
    it('should generate uuid4', () => {
      const id = uuid4()

      expect(id).toBeDefined()
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })

    it('should generate random number', () => {
      const num = random()

      expect(num).toBeGreaterThanOrEqual(0)
      expect(num).toBeLessThan(1)
    })
  })

  describe('Activity Options', () => {
    it('should accept all timeout options', () => {
      const activities = proxyActivities<{ test: () => Promise<void> }>({
        startToCloseTimeout: '10s',
        scheduleToCloseTimeout: '30s',
        scheduleToStartTimeout: '5s',
        heartbeatTimeout: '2s',
      })

      expect(activities.test).toBeDefined()
    })

    it('should accept task queue', () => {
      const activities = proxyActivities<{ test: () => Promise<void> }>({
        startToCloseTimeout: '10s',
        taskQueue: 'custom-queue',
      })

      expect(activities.test).toBeDefined()
    })
  })

  describe('Retry Policy', () => {
    it('should accept full retry policy', () => {
      const activities = proxyActivities<{ test: () => Promise<void> }>({
        startToCloseTimeout: '10s',
        retry: {
          initialInterval: '1s',
          backoffCoefficient: 2,
          maximumInterval: '30s',
          maximumAttempts: 5,
          nonRetryableErrorTypes: ['ValidationError'],
        },
      })

      expect(activities.test).toBeDefined()
    })
  })

  describe('Workflow Execution', () => {
    it('should start workflow via client', async () => {
      const client = new WorkflowClient()

      async function testWorkflow() {
        return 'workflow result'
      }

      const handle = await client.start(testWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'test-workflow-1',
      })

      expect(handle.workflowId).toBe('test-workflow-1')
    })

    it('should execute workflow and get result', async () => {
      const client = new WorkflowClient()

      async function computeWorkflow(x: number) {
        return x * 2
      }

      const result = await client.execute(computeWorkflow, {
        taskQueue: 'test-queue',
        args: [21],
      })

      expect(result).toBe(42)
    })

    it('should get handle for existing workflow', async () => {
      const client = new WorkflowClient()

      async function persistentWorkflow() {
        return 'done'
      }

      await client.start(persistentWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'persistent-1',
      })

      const handle = client.getHandle('persistent-1')

      expect(handle.workflowId).toBe('persistent-1')
    })
  })

  describe('Workflow Handle', () => {
    it('should get workflow result', async () => {
      const client = new WorkflowClient()

      async function resultWorkflow() {
        return { status: 'completed', value: 100 }
      }

      const handle = await client.start(resultWorkflow, {
        taskQueue: 'test-queue',
      })

      const result = await handle.result()

      expect(result).toEqual({ status: 'completed', value: 100 })
    })

    it('should describe workflow', async () => {
      const client = new WorkflowClient()

      async function describeWorkflow() {
        return 'done'
      }

      const handle = await client.start(describeWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'describe-test',
      })

      // Wait for completion
      await handle.result()

      const description = await handle.describe()

      expect(description.workflowId).toBe('describe-test')
      expect(description.status).toBe('COMPLETED')
    })

    it('should cancel workflow', async () => {
      const client = new WorkflowClient()

      async function longWorkflow() {
        await new Promise((resolve) => setTimeout(resolve, 60000))
        return 'done'
      }

      const handle = await client.start(longWorkflow, {
        taskQueue: 'test-queue',
      })

      await handle.cancel()

      const description = await handle.describe()
      expect(description.status).toBe('CANCELED')
    })

    it('should terminate workflow', async () => {
      const client = new WorkflowClient()

      async function terminableWorkflow() {
        await new Promise((resolve) => setTimeout(resolve, 60000))
        return 'done'
      }

      const handle = await client.start(terminableWorkflow, {
        taskQueue: 'test-queue',
      })

      await handle.terminate('Manual termination')

      const description = await handle.describe()
      expect(description.status).toBe('TERMINATED')
    })
  })

  describe('Type Definitions', () => {
    it('should export all required types', () => {
      // Type-level test - these should compile without errors
      const _signalDef: ReturnType<typeof defineSignal> = defineSignal('test')
      const _queryDef: ReturnType<typeof defineQuery> = defineQuery('test')
      const _updateDef: ReturnType<typeof defineUpdate> = defineUpdate('test')

      expect(true).toBe(true)
    })
  })
})
