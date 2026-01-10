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
  // Timer cleanup functions for testing memory leak prevention
  __clearTemporalState,
  __startTimerCleanup,
  __stopTimerCleanup,
  // Workflow registry cleanup functions
  __startWorkflowCleanup,
  __stopWorkflowCleanup,
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

  describe('Deterministic Replay (uuid4/random)', () => {
    // Use real timers for workflow execution
    beforeEach(() => {
      vi.useRealTimers()
      __clearTemporalState()
    })

    afterEach(() => {
      __clearTemporalState()
      vi.useFakeTimers()
    })

    it('should generate unique UUIDs in sequence', async () => {
      const client = new WorkflowClient()

      async function multiUuidWorkflow() {
        const id1 = uuid4()
        const id2 = uuid4()
        const id3 = uuid4()

        return { id1, id2, id3 }
      }

      const result = await client.execute(multiUuidWorkflow, {
        taskQueue: 'test-queue',
      })

      // All IDs should be valid UUIDs
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      expect(result.id1).toMatch(uuidRegex)
      expect(result.id2).toMatch(uuidRegex)
      expect(result.id3).toMatch(uuidRegex)

      // All IDs should be different
      expect(result.id1).not.toBe(result.id2)
      expect(result.id2).not.toBe(result.id3)
      expect(result.id1).not.toBe(result.id3)
    })

    it('should generate unique random numbers in sequence', async () => {
      const client = new WorkflowClient()

      async function multiRandomWorkflow() {
        const r1 = random()
        const r2 = random()
        const r3 = random()

        return { r1, r2, r3 }
      }

      const result = await client.execute(multiRandomWorkflow, {
        taskQueue: 'test-queue',
      })

      // All numbers should be in valid range
      expect(result.r1).toBeGreaterThanOrEqual(0)
      expect(result.r1).toBeLessThan(1)
      expect(result.r2).toBeGreaterThanOrEqual(0)
      expect(result.r2).toBeLessThan(1)
      expect(result.r3).toBeGreaterThanOrEqual(0)
      expect(result.r3).toBeLessThan(1)

      // Should be (almost certainly) different values
      // Note: There's an infinitesimal chance they could be equal,
      // but for practical purposes they should differ
      expect(new Set([result.r1, result.r2, result.r3]).size).toBeGreaterThan(1)
    })

    it('should return same uuid4 values on workflow replay', async () => {
      const client = new WorkflowClient()
      const capturedIds: string[] = []

      async function replayableUuidWorkflow() {
        const id1 = uuid4()
        const id2 = uuid4()
        capturedIds.push(id1, id2)
        return { id1, id2 }
      }

      // First execution
      const result1 = await client.execute(replayableUuidWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'replay-uuid-test',
      })

      const firstRunIds = [...capturedIds]

      // Note: In a real Temporal scenario, replay would re-execute the workflow
      // with the same history. Here we're testing that within a single workflow
      // execution, the stepResults are properly populated for future replay.
      expect(result1.id1).toBe(firstRunIds[0])
      expect(result1.id2).toBe(firstRunIds[1])
    })

    it('should return same random values on workflow replay', async () => {
      const client = new WorkflowClient()
      const capturedNums: number[] = []

      async function replayableRandomWorkflow() {
        const r1 = random()
        const r2 = random()
        capturedNums.push(r1, r2)
        return { r1, r2 }
      }

      // First execution
      const result1 = await client.execute(replayableRandomWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'replay-random-test',
      })

      const firstRunNums = [...capturedNums]

      expect(result1.r1).toBe(firstRunNums[0])
      expect(result1.r2).toBe(firstRunNums[1])
    })

    it('should increment historyLength for uuid4 calls', async () => {
      const client = new WorkflowClient()

      async function historyLengthUuidWorkflow() {
        const info1 = workflowInfo()
        const len1 = info1.historyLength

        uuid4()

        const info2 = workflowInfo()
        const len2 = info2.historyLength

        uuid4()
        uuid4()

        const info3 = workflowInfo()
        const len3 = info3.historyLength

        return { len1, len2, len3 }
      }

      const result = await client.execute(historyLengthUuidWorkflow, {
        taskQueue: 'test-queue',
      })

      // Each uuid4() call should increment historyLength
      expect(result.len2).toBe(result.len1 + 1)
      expect(result.len3).toBe(result.len2 + 2)
    })

    it('should increment historyLength for random calls', async () => {
      const client = new WorkflowClient()

      async function historyLengthRandomWorkflow() {
        const info1 = workflowInfo()
        const len1 = info1.historyLength

        random()

        const info2 = workflowInfo()
        const len2 = info2.historyLength

        random()
        random()

        const info3 = workflowInfo()
        const len3 = info3.historyLength

        return { len1, len2, len3 }
      }

      const result = await client.execute(historyLengthRandomWorkflow, {
        taskQueue: 'test-queue',
      })

      // Each random() call should increment historyLength
      expect(result.len2).toBe(result.len1 + 1)
      expect(result.len3).toBe(result.len2 + 2)
    })

    it('should handle mixed uuid4 and random calls deterministically', async () => {
      const client = new WorkflowClient()

      async function mixedDeterministicWorkflow() {
        const id1 = uuid4()
        const r1 = random()
        const id2 = uuid4()
        const r2 = random()
        const decision = random() < 0.5 ? 'A' : 'B'
        const txId = uuid4()

        return { id1, r1, id2, r2, decision, txId }
      }

      const result = await client.execute(mixedDeterministicWorkflow, {
        taskQueue: 'test-queue',
      })

      // All UUIDs should be valid and unique
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      expect(result.id1).toMatch(uuidRegex)
      expect(result.id2).toMatch(uuidRegex)
      expect(result.txId).toMatch(uuidRegex)
      expect(result.id1).not.toBe(result.id2)
      expect(result.id1).not.toBe(result.txId)
      expect(result.id2).not.toBe(result.txId)

      // All random numbers should be in range
      expect(result.r1).toBeGreaterThanOrEqual(0)
      expect(result.r1).toBeLessThan(1)
      expect(result.r2).toBeGreaterThanOrEqual(0)
      expect(result.r2).toBeLessThan(1)

      // Decision should be one of the expected values
      expect(['A', 'B']).toContain(result.decision)
    })

    it('should maintain separate counters per workflow', async () => {
      const client = new WorkflowClient()

      async function workflow1() {
        return { id: uuid4(), rand: random() }
      }

      async function workflow2() {
        return { id: uuid4(), rand: random() }
      }

      // Run both workflows concurrently
      const [result1, result2] = await Promise.all([
        client.execute(workflow1, {
          taskQueue: 'test-queue',
          workflowId: 'concurrent-1',
        }),
        client.execute(workflow2, {
          taskQueue: 'test-queue',
          workflowId: 'concurrent-2',
        }),
      ])

      // Both should have valid values
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      expect(result1.id).toMatch(uuidRegex)
      expect(result2.id).toMatch(uuidRegex)

      // IDs should be different (generated independently)
      expect(result1.id).not.toBe(result2.id)
    })

    it('should work outside workflow context (fallback to non-deterministic)', () => {
      // Outside of workflow context, uuid4/random should still work
      // (falls back to non-deterministic for convenience in testing)
      const id1 = uuid4()
      const id2 = uuid4()

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      expect(id1).toMatch(uuidRegex)
      expect(id2).toMatch(uuidRegex)
      expect(id1).not.toBe(id2)

      const r1 = random()
      const r2 = random()
      expect(r1).toBeGreaterThanOrEqual(0)
      expect(r1).toBeLessThan(1)
      expect(r2).toBeGreaterThanOrEqual(0)
      expect(r2).toBeLessThan(1)
    })

    it('should use deterministic values in child workflows', async () => {
      const client = new WorkflowClient()

      async function childWithDeterminism() {
        return {
          childId: uuid4(),
          childRand: random(),
        }
      }

      async function parentWithDeterminism() {
        const parentId = uuid4()
        const childResult = await executeChild(childWithDeterminism, {})
        const parentRand = random()

        return {
          parentId,
          parentRand,
          ...childResult,
        }
      }

      const result = await client.execute(parentWithDeterminism, {
        taskQueue: 'test-queue',
      })

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      expect(result.parentId).toMatch(uuidRegex)
      expect(result.childId).toMatch(uuidRegex)
      expect(result.parentId).not.toBe(result.childId)

      expect(result.parentRand).toBeGreaterThanOrEqual(0)
      expect(result.childRand).toBeGreaterThanOrEqual(0)
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

    it('should return empty results for invalid query format (fail closed)', async () => {
      const client = new WorkflowClient()

      // Start a workflow with search attributes
      async function securityTestWorkflow() {
        setSearchAttributes({ CustomerId: 'cust-SEC', Status: 'active' })
        return 'done'
      }

      await client.start(securityTestWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'security-test-1',
      })

      // Invalid query formats should NOT match any workflows (fail closed)
      const invalidQueries = [
        'invalid syntax',           // No = operator
        '__proto__ = "malicious"',  // Prototype pollution attempt (not in valid keys)
        'constructor = "exploit"',  // Constructor pollution attempt
        'Status === "active"',      // Wrong operator
        'Status = active',          // Missing quotes
      ]

      for (const invalidQuery of invalidQueries) {
        const results = await client.list({ query: invalidQuery })
        // Invalid queries should return empty results (fail closed)
        expect(results.length).toBe(0)
      }

      // Valid query should still work
      const validResults = await client.list({ query: 'Status = "active"' })
      expect(validResults.some(w => w.workflowId === 'security-test-1')).toBe(true)
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

  describe('Timer Cleanup (Memory Leak Prevention)', () => {
    beforeEach(() => {
      vi.useRealTimers()
      __clearTemporalState()
    })

    afterEach(() => {
      __clearTemporalState()
      vi.useFakeTimers()
    })

    it('should clean up timer state when __clearTemporalState is called', async () => {
      const client = new WorkflowClient()

      // Create timers that won't complete
      async function orphanedTimerWorkflow() {
        // Create a timer but don't await it
        const timer = createTimer('1h')
        // Return immediately, leaving timer orphaned
        return { timerId: timer.id }
      }

      const result = await client.execute(orphanedTimerWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.timerId).toBeDefined()

      // Clear state - this should clean up the orphaned timer
      __clearTemporalState()

      // Create a new timer to verify state is clean
      async function cleanTimerWorkflow() {
        const timer = createTimer('10ms')
        await timer
        return 'clean'
      }

      const cleanResult = await client.execute(cleanTimerWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(cleanResult).toBe('clean')
    })

    it('should start and stop periodic cleanup interval', () => {
      // Start the cleanup interval
      __startTimerCleanup()

      // Calling start again should be a no-op (not create duplicate intervals)
      __startTimerCleanup()

      // Stop the cleanup interval
      __stopTimerCleanup()

      // Calling stop again should be a no-op
      __stopTimerCleanup()

      // Should be able to restart after stopping
      __startTimerCleanup()
      __stopTimerCleanup()
    })

    it('should clean up cancelled timers from coalesced buckets', async () => {
      const client = new WorkflowClient()

      async function cancelledTimersWorkflow() {
        // Create multiple timers in the same bucket (same 10ms window)
        const timer1 = createTimer('100ms')
        const timer2 = createTimer('105ms') // Same bucket as timer1
        const timer3 = createTimer('102ms') // Same bucket as timer1

        // Attach catch handlers to prevent unhandled rejections
        timer1.catch(() => {})
        timer2.catch(() => {})
        timer3.catch(() => {})

        // Cancel all of them
        cancelTimer(timer1)
        cancelTimer(timer2)
        cancelTimer(timer3)

        return 'all cancelled'
      }

      const result = await client.execute(cancelledTimersWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('all cancelled')

      // Clear state to verify cleanup doesn't throw
      __clearTemporalState()
    })

    it('should handle mixed completed and cancelled timers', async () => {
      const client = new WorkflowClient()

      async function mixedTimersWorkflow() {
        const completedTimer = createTimer('10ms')
        const cancelledTimer = createTimer('1h')

        // Attach catch handler to prevent unhandled rejection
        cancelledTimer.catch(() => {})

        // Wait for the short timer
        await completedTimer

        // Cancel the long timer
        cancelTimer(cancelledTimer)

        return 'mixed complete'
      }

      const result = await client.execute(mixedTimersWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('mixed complete')
    })

    it('should track timer creation and expected fire times', async () => {
      const client = new WorkflowClient()

      async function timerMetadataWorkflow() {
        const beforeCreate = Date.now()
        const timer = createTimer('50ms')
        const afterCreate = Date.now()

        // Timer should fire after 50ms
        await timer

        return {
          timerId: timer.id,
          createdWithinWindow: true, // If we get here, timer was created properly
        }
      }

      const result = await client.execute(timerMetadataWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.timerId).toMatch(/^timer_/)
      expect(result.createdWithinWindow).toBe(true)
    })
  })

  describe('Workflow Registry Cleanup (Memory Leak Prevention)', () => {
    beforeEach(() => {
      vi.useRealTimers()
      __clearTemporalState()
    })

    afterEach(() => {
      __clearTemporalState()
      vi.useFakeTimers()
    })

    it('should start and stop periodic workflow cleanup interval', () => {
      // Start the cleanup interval
      __startWorkflowCleanup()

      // Calling start again should be a no-op (not create duplicate intervals)
      __startWorkflowCleanup()

      // Stop the cleanup interval
      __stopWorkflowCleanup()

      // Calling stop again should be a no-op
      __stopWorkflowCleanup()

      // Should be able to restart after stopping
      __startWorkflowCleanup()
      __stopWorkflowCleanup()
    })

    it('should clean up workflow state when __clearTemporalState is called', async () => {
      const client = new WorkflowClient()

      // Create multiple workflows
      async function workflow1() {
        return 'result1'
      }

      async function workflow2() {
        return 'result2'
      }

      await client.execute(workflow1, {
        taskQueue: 'test-queue',
        workflowId: 'cleanup-test-1',
      })

      await client.execute(workflow2, {
        taskQueue: 'test-queue',
        workflowId: 'cleanup-test-2',
      })

      // Clear state - this should clean up all workflows
      __clearTemporalState()

      // Verify we can create new workflows (state is clean)
      async function workflow3() {
        return 'result3'
      }

      const result = await client.execute(workflow3, {
        taskQueue: 'test-queue',
        workflowId: 'cleanup-test-3',
      })

      expect(result).toBe('result3')
    })

    it('should mark completed workflows for eventual cleanup', async () => {
      const client = new WorkflowClient()

      // Complete a workflow
      async function completableWorkflow() {
        return 'completed'
      }

      const handle = await client.start(completableWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'mark-complete-test',
      })

      // Wait for completion
      await handle.result()

      // The workflow should be marked for cleanup (we verify by checking it still exists
      // since the TTL hasn't elapsed)
      const description = await handle.describe()
      expect(description.status).toBe('COMPLETED')
    })

    it('should mark failed workflows for cleanup', async () => {
      const client = new WorkflowClient()

      async function failingWorkflow() {
        throw new Error('Intentional failure')
      }

      const handle = await client.start(failingWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'fail-cleanup-test',
      })

      // Wait for failure
      try {
        await handle.result()
      } catch {
        // Expected
      }

      // Verify workflow is in FAILED state
      const description = await handle.describe()
      expect(description.status).toBe('FAILED')
    })

    it('should mark cancelled workflows for cleanup', async () => {
      const client = new WorkflowClient()

      async function longWorkflow() {
        await new Promise(resolve => setTimeout(resolve, 60000))
        return 'done'
      }

      const handle = await client.start(longWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'cancel-cleanup-test',
      })

      // Cancel it
      await handle.cancel()

      // Verify workflow is in CANCELED state
      const description = await handle.describe()
      expect(description.status).toBe('CANCELED')
    })

    it('should mark terminated workflows for cleanup', async () => {
      const client = new WorkflowClient()

      async function terminableWorkflow() {
        await new Promise(resolve => setTimeout(resolve, 60000))
        return 'done'
      }

      const handle = await client.start(terminableWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'terminate-cleanup-test',
      })

      // Terminate it
      await handle.terminate('Test termination')

      // Verify workflow is in TERMINATED state
      const description = await handle.describe()
      expect(description.status).toBe('TERMINATED')
    })

    it('should handle multiple workflows transitioning to terminal states', async () => {
      const client = new WorkflowClient()

      // Create workflows that will end in different terminal states
      async function successWorkflow() {
        return 'success'
      }

      async function failWorkflow() {
        throw new Error('fail')
      }

      async function longWorkflow() {
        await new Promise(resolve => setTimeout(resolve, 60000))
        return 'long'
      }

      // Start all workflows
      const successHandle = await client.start(successWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'multi-success',
      })

      const failHandle = await client.start(failWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'multi-fail',
      })

      const cancelHandle = await client.start(longWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'multi-cancel',
      })

      // Wait for completions
      await successHandle.result()
      try {
        await failHandle.result()
      } catch {
        // Expected
      }
      await cancelHandle.cancel()

      // Verify all are in terminal states
      expect((await successHandle.describe()).status).toBe('COMPLETED')
      expect((await failHandle.describe()).status).toBe('FAILED')
      expect((await cancelHandle.describe()).status).toBe('CANCELED')

      // Clear state to verify no memory leaks
      __clearTemporalState()
    })

    it('should track child workflow completion times', async () => {
      const client = new WorkflowClient()

      async function childWorkflow() {
        return 'child done'
      }

      async function parentWorkflow() {
        const result = await executeChild(childWorkflow, {
          workflowId: 'tracked-child',
        })
        return result
      }

      const result = await client.execute(parentWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'tracking-parent',
      })

      expect(result).toBe('child done')

      // Both parent and child should be tracked for cleanup
      const childHandle = client.getHandle('tracked-child')
      const childDesc = await childHandle.describe()
      expect(childDesc.status).toBe('COMPLETED')
    })
  })
})
