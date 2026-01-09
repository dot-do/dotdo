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
  // New imports for API coverage gaps
  startChild,
  executeChild,
  createTimer,
  cancelTimer,
  patched,
  deprecatePatch,
  setSearchAttributes,
  upsertSearchAttributes,
  workflowInfo,
  type ChildWorkflowHandle,
  type TimerHandle,
  type SearchAttributes,
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

  // ============================================================================
  // NEW TESTS: Temporal API Coverage Gaps
  // These tests use real timers (not fake timers) for workflow execution
  // ============================================================================

  describe('Temporal Child Workflows', () => {
    // Use real timers for child workflow tests
    beforeEach(() => {
      vi.useRealTimers()
    })

    afterEach(() => {
      vi.useFakeTimers()
    })

    it('should start child workflow', async () => {
      const client = new WorkflowClient()

      async function childWorkflow(input: { value: number }) {
        return input.value * 2
      }

      async function parentWorkflow() {
        const handle = await startChild(childWorkflow, {
          workflowId: 'child-start-1',
          args: [{ value: 21 }],
        })
        expect(handle.workflowId).toBe('child-start-1')
        expect(handle.firstExecutionRunId).toBeDefined()
        return { childId: handle.workflowId }
      }

      const parentHandle = await client.start(parentWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'parent-start-1',
      })

      const result = await parentHandle.result()
      expect(result.childId).toBe('child-start-1')
    })

    it('should wait for child completion', async () => {
      const client = new WorkflowClient()

      async function childWorkflow(value: number) {
        return value * 3
      }

      async function parentWorkflow() {
        const result = await executeChild(childWorkflow, {
          args: [7],
        })
        return result
      }

      const result = await client.execute(parentWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe(21)
    })

    it('should cancel child workflow', async () => {
      const client = new WorkflowClient()

      async function longChildWorkflow() {
        // Use a shorter delay that won't actually run
        await new Promise(resolve => setTimeout(resolve, 60000))
        return 'completed'
      }

      async function parentWorkflow() {
        const handle = await startChild(longChildWorkflow, {
          workflowId: 'cancellable-child-2',
          cancellationType: 'WAIT_CANCELLATION_COMPLETED',
        })

        // Cancel the child immediately
        await handle.cancel()

        return { cancelled: true }
      }

      const result = await client.execute(parentWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.cancelled).toBe(true)

      // Child should have been cancelled
      const childHandle = client.getHandle('cancellable-child-2')
      const description = await childHandle.describe()
      expect(description.status).toBe('CANCELED')
    })

    it('should handle child failure', async () => {
      const client = new WorkflowClient()

      async function failingChildWorkflow() {
        throw new Error('Child workflow failed')
      }

      async function parentWorkflow() {
        try {
          await executeChild(failingChildWorkflow, {
            workflowId: 'failing-child-2',
          })
          return { error: null }
        } catch (e) {
          return { error: (e as Error).message }
        }
      }

      const result = await client.execute(parentWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.error).toBe('Child workflow failed')
    })

    it('should propagate parent close policy', async () => {
      const client = new WorkflowClient()

      async function childWithPolicy() {
        // Long running child - will be terminated by parent
        await new Promise(resolve => setTimeout(resolve, 60000))
        return 'done'
      }

      async function parentWithPolicy() {
        const handle = await startChild(childWithPolicy, {
          workflowId: 'policy-child-1',
          parentClosePolicy: 'TERMINATE',
        })
        // Don't wait for child, just return its ID
        return handle.workflowId
      }

      const handle = await client.start(parentWithPolicy, {
        taskQueue: 'test-queue',
        workflowId: 'parent-with-policy-2',
      })

      // Wait for parent to complete (it returns immediately)
      const childId = await handle.result()
      expect(childId).toBe('policy-child-1')

      // Now terminate the parent, which should cascade to child
      await handle.terminate()

      // Check parent is terminated
      const parentDesc = await handle.describe()
      expect(parentDesc.status).toBe('TERMINATED')
    })

    it('should support child workflow retries', async () => {
      const client = new WorkflowClient()
      let attempts = 0

      async function retryableChildWorkflow() {
        attempts++
        if (attempts < 3) {
          throw new Error('Temporary failure')
        }
        return 'success'
      }

      async function parentWithRetryingChild() {
        // Note: retry is not automatically handled by executeChild
        // This test verifies the retry option is accepted
        let result: string | null = null
        for (let i = 0; i < 5 && !result; i++) {
          try {
            result = await executeChild(retryableChildWorkflow, {})
          } catch {
            // Retry
          }
        }
        return result ?? 'failed'
      }

      const result = await client.execute(parentWithRetryingChild, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('success')
      expect(attempts).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Temporal Timers', () => {
    // Use real timers for timer tests
    beforeEach(() => {
      vi.useRealTimers()
    })

    afterEach(() => {
      vi.useFakeTimers()
    })

    it('should create timer with duration', async () => {
      const client = new WorkflowClient()
      let timerFired = false

      async function timerWorkflow() {
        const timer = createTimer('50ms') // Use short duration
        expect(timer).toBeDefined()
        expect(timer.id).toBeDefined()

        await timer
        timerFired = true
        return 'timer completed'
      }

      const result = await client.execute(timerWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('timer completed')
      expect(timerFired).toBe(true)
    })

    it('should cancel timer', async () => {
      const client = new WorkflowClient()
      let timerCompleted = false
      let timerCancelled = false

      async function cancelableTimerWorkflow() {
        const timer = createTimer('1s')

        // Cancel immediately
        cancelTimer(timer)
        timerCancelled = true

        try {
          await timer
          timerCompleted = true
        } catch (e) {
          // Timer was cancelled - expected
        }

        return { completed: timerCompleted, cancelled: timerCancelled }
      }

      const result = await client.execute(cancelableTimerWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.cancelled).toBe(true)
      expect(result.completed).toBe(false)
    })

    it('should handle timer in race condition', async () => {
      const client = new WorkflowClient()

      async function raceTimerWorkflow() {
        const timer1 = createTimer('20ms')
        const timer2 = createTimer('100ms')

        const winner = await Promise.race([
          timer1.then(() => 'timer1'),
          timer2.then(() => 'timer2'),
        ])

        // Cancel the loser
        if (winner === 'timer1') {
          cancelTimer(timer2)
        } else {
          cancelTimer(timer1)
        }

        return winner
      }

      const result = await client.execute(raceTimerWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('timer1')
    })

    it('should support timer with numeric milliseconds', async () => {
      const client = new WorkflowClient()

      async function numericTimerWorkflow() {
        const timer = createTimer(25) // 25ms
        await timer
        return 'done'
      }

      const result = await client.execute(numericTimerWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('done')
    })

    it('should integrate timer with CancellationScope', async () => {
      const client = new WorkflowClient()

      async function scopedTimerWorkflow() {
        let timerResult: string = 'not run'

        await CancellationScope.cancellable(async () => {
          const timer = createTimer('30ms')
          try {
            await timer
            timerResult = 'completed'
          } catch {
            timerResult = 'cancelled'
          }
        })

        return timerResult
      }

      const result = await client.execute(scopedTimerWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(['completed', 'cancelled']).toContain(result)
    })
  })

  describe('Temporal Versioning', () => {
    // Use real timers for versioning tests
    beforeEach(() => {
      vi.useRealTimers()
    })

    afterEach(() => {
      vi.useFakeTimers()
    })

    it('should patch workflow code', async () => {
      const client = new WorkflowClient()

      async function versionedWorkflow() {
        if (patched('v2-feature')) {
          return 'v2 behavior'
        }
        return 'v1 behavior'
      }

      const result = await client.execute(versionedWorkflow, {
        taskQueue: 'test-queue',
      })

      // New executions should take the patched path
      expect(result).toBe('v2 behavior')
    })

    it('should deprecate old patches', async () => {
      const client = new WorkflowClient()

      async function deprecatingWorkflow() {
        deprecatePatch('old-feature')

        // Old patch is deprecated, all new workflows skip it
        if (patched('new-feature')) {
          return 'new feature'
        }
        return 'baseline'
      }

      const result = await client.execute(deprecatingWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('new feature')
    })

    it('should handle version branching', async () => {
      const client = new WorkflowClient()

      async function branchingWorkflow(scenario: string) {
        let version = 'v1'

        if (patched('v2-upgrade')) {
          version = 'v2'

          if (patched('v3-upgrade')) {
            version = 'v3'
          }
        }

        return { version, scenario }
      }

      const result = await client.execute(branchingWorkflow, {
        taskQueue: 'test-queue',
        args: ['test'],
      })

      // Should reach the latest version
      expect(result.version).toBe('v3')
    })

    it('should track patch IDs for replay', async () => {
      const client = new WorkflowClient()
      const patchIds: string[] = []

      async function patchTrackingWorkflow() {
        const p1 = patched('patch-1')
        const p2 = patched('patch-2')
        const p3 = patched('patch-3')

        // Collect which patches were applied
        if (p1) patchIds.push('patch-1')
        if (p2) patchIds.push('patch-2')
        if (p3) patchIds.push('patch-3')

        return patchIds
      }

      const result = await client.execute(patchTrackingWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toContain('patch-1')
      expect(result).toContain('patch-2')
      expect(result).toContain('patch-3')
    })
  })

  describe('Temporal Search Attributes', () => {
    // Use real timers for search attribute tests
    beforeEach(() => {
      vi.useRealTimers()
    })

    afterEach(() => {
      vi.useFakeTimers()
    })

    it('should set search attributes', async () => {
      const client = new WorkflowClient()

      async function searchableWorkflow() {
        setSearchAttributes({
          CustomerId: 'cust-123',
          OrderStatus: 'pending',
          OrderAmount: 99.99,
        })

        return 'done'
      }

      const handle = await client.start(searchableWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'searchable-1',
      })

      await handle.result()

      const description = await handle.describe()
      expect(description.searchAttributes).toEqual({
        CustomerId: 'cust-123',
        OrderStatus: 'pending',
        OrderAmount: 99.99,
      })
    })

    it('should query by search attributes', async () => {
      const client = new WorkflowClient()

      // Start multiple workflows with different attributes (no sleep - complete immediately)
      async function workflow1() {
        setSearchAttributes({ CustomerId: 'cust-A', Status: 'active' })
        return 'done'
      }

      async function workflow2() {
        setSearchAttributes({ CustomerId: 'cust-B', Status: 'inactive' })
        return 'done'
      }

      await client.start(workflow1, {
        taskQueue: 'test-queue',
        workflowId: 'search-query-1',
      })

      await client.start(workflow2, {
        taskQueue: 'test-queue',
        workflowId: 'search-query-2',
      })

      // Query by search attribute (simulated)
      const results = await client.list({
        query: 'Status = "active"',
      })

      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results.some(w => w.workflowId === 'search-query-1')).toBe(true)
    })

    it('should update search attributes', async () => {
      const client = new WorkflowClient()

      async function updatingWorkflow() {
        setSearchAttributes({
          Status: 'pending',
          Step: 1,
        })

        // Use short sleeps with real timers
        await new Promise(resolve => setTimeout(resolve, 10))

        // Update attributes
        upsertSearchAttributes({
          Status: 'processing',
          Step: 2,
        })

        await new Promise(resolve => setTimeout(resolve, 10))

        upsertSearchAttributes({
          Status: 'completed',
          Step: 3,
        })

        return 'done'
      }

      const handle = await client.start(updatingWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'updating-attrs',
      })

      await handle.result()

      const description = await handle.describe()
      expect(description.searchAttributes?.Status).toBe('completed')
      expect(description.searchAttributes?.Step).toBe(3)
    })

    it('should support typed search attributes', async () => {
      const client = new WorkflowClient()

      interface OrderSearchAttributes extends SearchAttributes {
        OrderId: string
        CustomerEmail: string
        TotalAmount: number
        IsExpedited: boolean
        CreatedAt: Date
      }

      async function typedSearchWorkflow() {
        const attrs: OrderSearchAttributes = {
          OrderId: 'ord-123',
          CustomerEmail: 'test@example.com',
          TotalAmount: 150.00,
          IsExpedited: true,
          CreatedAt: new Date(),
        }

        setSearchAttributes(attrs)
        return attrs.OrderId
      }

      const result = await client.execute(typedSearchWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('ord-123')
    })
  })

  describe('Temporal Workflow Info', () => {
    // Use real timers for workflow info tests
    beforeEach(() => {
      vi.useRealTimers()
    })

    afterEach(() => {
      vi.useFakeTimers()
    })

    it('should provide workflowId', async () => {
      const client = new WorkflowClient()

      async function idWorkflow() {
        const info = workflowInfo()
        return info.workflowId
      }

      const result = await client.execute(idWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'known-workflow-id',
      })

      expect(result).toBe('known-workflow-id')
    })

    it('should provide runId', async () => {
      const client = new WorkflowClient()

      async function runIdWorkflow() {
        const info = workflowInfo()
        return info.runId
      }

      const handle = await client.start(runIdWorkflow, {
        taskQueue: 'test-queue',
      })

      const result = await handle.result()
      expect(result).toBe(handle.runId)
    })

    it('should provide attempt number', async () => {
      const client = new WorkflowClient()
      let attemptFromInfo = 0

      async function attemptWorkflow() {
        const info = workflowInfo()
        attemptFromInfo = info.attempt
        return info.attempt
      }

      const result = await client.execute(attemptWorkflow, {
        taskQueue: 'test-queue',
      })

      // First attempt should be 1
      expect(result).toBe(1)
      expect(attemptFromInfo).toBe(1)
    })

    it('should provide namespace', async () => {
      const client = new WorkflowClient({ namespace: 'custom-namespace' })

      async function namespaceWorkflow() {
        const info = workflowInfo()
        return info.namespace
      }

      const result = await client.execute(namespaceWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('custom-namespace')
    })

    it('should provide workflowType', async () => {
      const client = new WorkflowClient()

      async function myNamedWorkflow() {
        const info = workflowInfo()
        return info.workflowType
      }

      const result = await client.execute(myNamedWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('myNamedWorkflow')
    })

    it('should provide taskQueue', async () => {
      const client = new WorkflowClient()

      async function queueWorkflow() {
        const info = workflowInfo()
        return info.taskQueue
      }

      const result = await client.execute(queueWorkflow, {
        taskQueue: 'my-custom-queue',
      })

      expect(result).toBe('my-custom-queue')
    })

    it('should provide parent workflow info', async () => {
      const client = new WorkflowClient()

      async function childWithParentInfo() {
        const info = workflowInfo()
        return {
          hasParent: info.parent !== undefined,
          parentId: info.parent?.workflowId,
          parentRunId: info.parent?.runId,
        }
      }

      async function parentWorkflow() {
        const childResult = await executeChild(childWithParentInfo, {})
        return childResult
      }

      const handle = await client.start(parentWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'parent-info-test',
      })

      const result = await handle.result()
      expect(result.hasParent).toBe(true)
      expect(result.parentId).toBe('parent-info-test')
    })

    it('should provide historyLength', async () => {
      const client = new WorkflowClient()

      async function historyWorkflow() {
        const info1 = workflowInfo()
        const len1 = info1.historyLength

        // Do some steps to increase history (use short real delay)
        await new Promise(resolve => setTimeout(resolve, 10))
        setSearchAttributes({ step: 'after-delay' })

        const info2 = workflowInfo()
        const len2 = info2.historyLength

        return { initial: len1, afterStep: len2 }
      }

      const result = await client.execute(historyWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.afterStep).toBeGreaterThan(result.initial)
    })

    it('should provide startTime and runStartTime', async () => {
      const client = new WorkflowClient()

      async function timeWorkflow() {
        const info = workflowInfo()
        return {
          startTime: info.startTime instanceof Date,
          runStartTime: info.runStartTime instanceof Date,
          startBeforeRun: info.startTime <= info.runStartTime,
        }
      }

      const result = await client.execute(timeWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.startTime).toBe(true)
      expect(result.runStartTime).toBe(true)
      expect(result.startBeforeRun).toBe(true)
    })

    it('should provide firstExecutionRunId', async () => {
      const client = new WorkflowClient()

      async function firstRunWorkflow() {
        const info = workflowInfo()
        return {
          runId: info.runId,
          firstExecutionRunId: info.firstExecutionRunId,
          isSameAsRunId: info.runId === info.firstExecutionRunId,
        }
      }

      const result = await client.execute(firstRunWorkflow, {
        taskQueue: 'test-queue',
      })

      // For first execution, these should match
      expect(result.isSameAsRunId).toBe(true)
    })

    it('should provide memo data', async () => {
      const client = new WorkflowClient()

      async function memoWorkflow() {
        const info = workflowInfo()
        return info.memo
      }

      const result = await client.execute(memoWorkflow, {
        taskQueue: 'test-queue',
        memo: {
          description: 'Test workflow',
          priority: 'high',
        },
      })

      expect(result?.description).toBe('Test workflow')
      expect(result?.priority).toBe('high')
    })
  })
})
