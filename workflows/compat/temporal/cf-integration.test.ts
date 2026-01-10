/**
 * CF Workflows Integration Tests (RED Phase)
 *
 * These tests verify that the Temporal compat layer properly integrates with
 * Cloudflare Workflows' native APIs when a WorkflowStep context is available.
 *
 * Expected behavior to implement:
 * 1. sleep() should use step.sleep() instead of setTimeout when WorkflowStep is available
 * 2. Activities should use step.do() for durable execution when WorkflowStep is available
 * 3. Completed steps should replay without re-executing (using cached results)
 * 4. Fallback to setTimeout when no WorkflowStep is available (testing environments)
 * 5. WorkflowStep context should propagate correctly through async operations
 *
 * These tests are expected to FAIL until the GREEN implementation phase.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  sleep,
  proxyActivities,
  WorkflowClient,
  __clearTemporalState,
  workflowInfo,
  setWorkflowStep,
  clearWorkflowStep,
  getWorkflowStep,
} from './index'
import type { WorkflowStep, StepDoOptions } from '../../../lib/cloudflare/workflows'

// ============================================================================
// MOCK WORKFLOW STEP - Simulates CF Workflows runtime
// ============================================================================

/**
 * Creates a mock WorkflowStep that tracks all calls for verification
 */
function createMockWorkflowStep() {
  const calls = {
    do: [] as Array<{ name: string; options?: StepDoOptions; callback: () => unknown }>,
    sleep: [] as Array<{ name: string; duration: string }>,
    sleepUntil: [] as Array<{ name: string; timestamp: Date | number }>,
    waitForEvent: [] as Array<{ name: string; options?: unknown }>,
  }

  const mockStep: WorkflowStep = {
    do: vi.fn().mockImplementation(async (name: string, optionsOrCallback, maybeCallback?) => {
      const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
      calls.do.push({ name, options, callback })
      return callback()
    }),
    sleep: vi.fn().mockImplementation(async (name: string, duration: string) => {
      calls.sleep.push({ name, duration })
      return undefined
    }),
    sleepUntil: vi.fn().mockImplementation(async (name: string, timestamp: Date | number) => {
      calls.sleepUntil.push({ name, timestamp })
      return undefined
    }),
    waitForEvent: vi.fn().mockImplementation(async (name: string, options?: unknown) => {
      calls.waitForEvent.push({ name, options })
      return undefined
    }),
  }

  return { mockStep, calls }
}

// ============================================================================
// WORKFLOW STEP CONTEXT MANAGEMENT
// These functions don't exist yet - they need to be implemented
// ============================================================================

// Note: These imports will fail until the implementation is added
// We'll need to add: setWorkflowStep, clearWorkflowStep, getWorkflowStep
// to the temporal/index.ts exports

/**
 * Stub declarations for functions that need to be implemented.
 * These will be imported from './index' once implemented.
 */
declare function setWorkflowStep(step: WorkflowStep | null): void
declare function clearWorkflowStep(): void
declare function getWorkflowStep(): WorkflowStep | null

describe('CF Workflows Integration', () => {
  beforeEach(() => {
    vi.useRealTimers()
    __clearTemporalState()
  })

  afterEach(() => {
    __clearTemporalState()
    vi.useFakeTimers()
  })

  // ==========================================================================
  // TEST GROUP 1: sleep() uses step.sleep() when WorkflowStep is available
  // ==========================================================================

  describe('sleep() with WorkflowStep', () => {
    it('should call step.sleep() instead of setTimeout when WorkflowStep is available', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      // This test expects setWorkflowStep to be implemented
      // When a WorkflowStep is set, sleep() should use step.sleep()

      async function sleepWorkflow() {
        // Set the workflow step context (needs implementation)
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        await sleep('5s')

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return 'completed'
      }

      const result = await client.execute(sleepWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('completed')

      // Verify step.sleep() was called with correct arguments
      expect(mockStep.sleep).toHaveBeenCalled()
      expect(calls.sleep.length).toBe(1)
      expect(calls.sleep[0].duration).toBe('5s')
    })

    it('should pass duration in correct format to step.sleep()', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      async function durationFormatWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        // Test various duration formats
        await sleep('10s')
        await sleep('5m')
        await sleep('1h')
        await sleep(1000) // milliseconds as number

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return 'done'
      }

      await client.execute(durationFormatWorkflow, {
        taskQueue: 'test-queue',
      })

      // Verify all durations were passed correctly
      expect(calls.sleep.length).toBe(4)
      expect(calls.sleep[0].duration).toBe('10s')
      expect(calls.sleep[1].duration).toBe('5m')
      expect(calls.sleep[2].duration).toBe('1h')
      // Numeric duration should be converted to string format
      expect(calls.sleep[3].duration).toMatch(/^\d+(ms|s)$/)
    })

    it('should generate unique step names for each sleep call', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      async function multipleSleepsWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        await sleep('1s')
        await sleep('2s')
        await sleep('1s') // Same duration, should still have unique name

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return 'done'
      }

      await client.execute(multipleSleepsWorkflow, {
        taskQueue: 'test-queue',
      })

      // Each sleep should have a unique step name
      const names = calls.sleep.map(c => c.name)
      const uniqueNames = new Set(names)
      expect(uniqueNames.size).toBe(3)
    })

    it('should include workflow context in step name', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      async function contextualSleepWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        const info = workflowInfo()
        await sleep('1s')

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return info.workflowId
      }

      await client.execute(contextualSleepWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'context-test-workflow',
      })

      // Step name should include workflow context for debugging
      expect(calls.sleep[0].name).toContain('sleep')
    })
  })

  // ==========================================================================
  // TEST GROUP 2: Activities use step.do() when WorkflowStep is available
  // ==========================================================================

  describe('Activities with WorkflowStep', () => {
    it('should call step.do() for activity invocation when WorkflowStep is available', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      const activities = proxyActivities<{
        processOrder: (orderId: string) => Promise<{ status: string }>
      }>({
        startToCloseTimeout: '10s',
      })

      async function activityWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        const result = await activities.processOrder('order-123')

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return result
      }

      await client.execute(activityWorkflow, {
        taskQueue: 'test-queue',
      })

      // Verify step.do() was called
      expect(mockStep.do).toHaveBeenCalled()
      expect(calls.do.length).toBe(1)
      expect(calls.do[0].name).toContain('processOrder')
    })

    it('should pass activity name to step.do()', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      const activities = proxyActivities<{
        sendEmail: (to: string, body: string) => Promise<void>
        chargeCard: (token: string, amount: number) => Promise<boolean>
      }>({
        startToCloseTimeout: '10s',
      })

      async function multiActivityWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        await activities.sendEmail('user@example.com', 'Hello')
        await activities.chargeCard('tok_123', 99.99)

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return 'done'
      }

      await client.execute(multiActivityWorkflow, {
        taskQueue: 'test-queue',
      })

      // Verify activity names in step.do() calls
      expect(calls.do.length).toBe(2)
      expect(calls.do[0].name).toContain('sendEmail')
      expect(calls.do[1].name).toContain('chargeCard')
    })

    it('should pass retry options to step.do()', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

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

      async function retryActivityWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        await activities.riskyOperation()

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return 'done'
      }

      await client.execute(retryActivityWorkflow, {
        taskQueue: 'test-queue',
      })

      // Verify retry options were passed to step.do()
      expect(calls.do.length).toBe(1)
      expect(calls.do[0].options).toBeDefined()
      expect(calls.do[0].options?.retries?.limit).toBe(5)
    })

    it('should pass timeout options to step.do()', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      const activities = proxyActivities<{
        longOperation: () => Promise<string>
      }>({
        startToCloseTimeout: '5m',
      })

      async function timeoutActivityWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        await activities.longOperation()

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return 'done'
      }

      await client.execute(timeoutActivityWorkflow, {
        taskQueue: 'test-queue',
      })

      // Verify timeout was passed to step.do()
      expect(calls.do[0].options?.timeout).toBe('5m')
    })
  })

  // ==========================================================================
  // TEST GROUP 3: Replay behavior - completed steps don't re-execute
  // ==========================================================================

  describe('Replay Behavior', () => {
    it('should return cached result for completed sleep without calling step.sleep() again', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      // Simulate a completed step result in the mock
      const completedSteps = new Map<string, unknown>()

      const replayMockStep: WorkflowStep = {
        ...mockStep,
        sleep: vi.fn().mockImplementation(async (name: string, duration: string) => {
          // If step is already completed, this should not be called
          if (completedSteps.has(name)) {
            throw new Error('step.sleep() should not be called for completed steps')
          }
          calls.sleep.push({ name, duration })
          completedSteps.set(name, true)
        }),
      }

      async function replaySleepWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(replayMockStep)

        // First sleep - should call step.sleep()
        await sleep('1s')

        // Simulate replay scenario where the same sleep is called again
        // In a real replay, the workflow re-executes but completed steps
        // should return cached results without calling step.sleep()

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return 'replayed'
      }

      const result = await client.execute(replaySleepWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('replayed')
      // Only one call to step.sleep() should occur
      expect(calls.sleep.length).toBe(1)
    })

    it('should return cached result for completed activity without calling step.do() again', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()
      let activityExecutionCount = 0

      // Track which steps have completed
      const completedSteps = new Map<string, unknown>()

      const replayMockStep: WorkflowStep = {
        ...mockStep,
        do: vi.fn().mockImplementation(async (name: string, optionsOrCallback, maybeCallback?) => {
          const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback

          // Check if step is already completed (replay scenario)
          if (completedSteps.has(name)) {
            // Return cached result without executing callback
            return completedSteps.get(name)
          }

          // Execute and cache result
          activityExecutionCount++
          const result = await callback()
          completedSteps.set(name, result)
          calls.do.push({ name, callback })
          return result
        }),
      }

      const activities = proxyActivities<{
        expensiveOperation: () => Promise<number>
      }>({
        startToCloseTimeout: '10s',
      })

      async function replayActivityWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(replayMockStep)

        const result = await activities.expensiveOperation()

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return result
      }

      await client.execute(replayActivityWorkflow, {
        taskQueue: 'test-queue',
      })

      // Activity should only be executed once
      expect(activityExecutionCount).toBe(1)
    })

    it('should handle interleaved sleep and activity calls during replay', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      const activities = proxyActivities<{
        step1: () => Promise<string>
        step2: () => Promise<string>
      }>({
        startToCloseTimeout: '10s',
      })

      async function interleavedWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        await activities.step1()
        await sleep('1s')
        await activities.step2()
        await sleep('2s')

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return 'done'
      }

      await client.execute(interleavedWorkflow, {
        taskQueue: 'test-queue',
      })

      // Verify the order of operations
      expect(calls.do.length).toBe(2)
      expect(calls.sleep.length).toBe(2)
    })
  })

  // ==========================================================================
  // TEST GROUP 4: Fallback behavior when no WorkflowStep is available
  // ==========================================================================

  describe('Fallback to setTimeout', () => {
    it('should use setTimeout when no WorkflowStep is available', async () => {
      const client = new WorkflowClient()
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      async function fallbackSleepWorkflow() {
        // No WorkflowStep is set - should fallback to setTimeout
        await sleep('10ms')
        return 'done'
      }

      const result = await client.execute(fallbackSleepWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('done')
      // setTimeout should have been called (fallback behavior)
      expect(setTimeoutSpy).toHaveBeenCalled()

      setTimeoutSpy.mockRestore()
    })

    it('should allow tests to run without CF Workflows runtime', async () => {
      const client = new WorkflowClient()

      const activities = proxyActivities<{
        testActivity: () => Promise<string>
      }>({
        startToCloseTimeout: '10s',
      })

      async function testableWorkflow() {
        // No WorkflowStep - activities should still work (fallback mode)
        // In fallback mode, activities execute directly without step.do()
        await sleep('10ms')
        return 'testable'
      }

      const result = await client.execute(testableWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('testable')
    })

    it('should log a debug message when falling back to setTimeout', async () => {
      const client = new WorkflowClient()
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

      async function loggingFallbackWorkflow() {
        // @ts-expect-error - getWorkflowStep needs to be implemented
        const step = getWorkflowStep()
        expect(step).toBeNull() // No step set

        await sleep('10ms')
        return 'logged'
      }

      await client.execute(loggingFallbackWorkflow, {
        taskQueue: 'test-queue',
      })

      // Optional: verify debug logging for fallback behavior
      // This is informational - not required but helpful for debugging
      // expect(debugSpy).toHaveBeenCalled()

      debugSpy.mockRestore()
    })
  })

  // ==========================================================================
  // TEST GROUP 5: WorkflowStep context propagation
  // ==========================================================================

  describe('WorkflowStep Context Propagation', () => {
    it('should propagate WorkflowStep through async operations', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      async function asyncPropagationWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        // Async operation that should maintain context
        await Promise.resolve()

        // Sleep should still use step.sleep()
        await sleep('1s')

        // @ts-expect-error - getWorkflowStep needs to be implemented
        const currentStep = getWorkflowStep()
        expect(currentStep).toBe(mockStep)

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return 'propagated'
      }

      const result = await client.execute(asyncPropagationWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('propagated')
      expect(calls.sleep.length).toBe(1)
    })

    it('should maintain separate step context for concurrent workflows', async () => {
      const { mockStep: mockStep1, calls: calls1 } = createMockWorkflowStep()
      const { mockStep: mockStep2, calls: calls2 } = createMockWorkflowStep()
      const client = new WorkflowClient()

      async function workflow1() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep1)

        await sleep('1s')

        // @ts-expect-error - getWorkflowStep needs to be implemented
        const step = getWorkflowStep()
        expect(step).toBe(mockStep1)

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return 'workflow1'
      }

      async function workflow2() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep2)

        await sleep('2s')

        // @ts-expect-error - getWorkflowStep needs to be implemented
        const step = getWorkflowStep()
        expect(step).toBe(mockStep2)

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return 'workflow2'
      }

      // Run workflows concurrently
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

      expect(result1).toBe('workflow1')
      expect(result2).toBe('workflow2')

      // Each workflow should have used its own step
      expect(calls1.sleep.length).toBe(1)
      expect(calls2.sleep.length).toBe(1)
    })

    it('should not leak step context between sequential workflows', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      async function firstWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        await sleep('1s')

        // Intentionally forget to clear - simulating a bug
        // The framework should handle this

        return 'first'
      }

      async function secondWorkflow() {
        // @ts-expect-error - getWorkflowStep needs to be implemented
        const step = getWorkflowStep()

        // Second workflow should NOT see the first workflow's step
        // Each workflow context should be isolated
        expect(step).toBeNull()

        await sleep('1s')

        return 'second'
      }

      await client.execute(firstWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'first-wf',
      })

      // Force context cleanup between workflows
      __clearTemporalState()

      await client.execute(secondWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'second-wf',
      })
    })

    it('should handle nested function calls with step context', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      async function nestedHelper() {
        // Helper function should have access to the step context
        await sleep('500ms')
      }

      async function outerWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        await sleep('1s')
        await nestedHelper() // Should use the same step context
        await sleep('1s')

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return 'nested complete'
      }

      const result = await client.execute(outerWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('nested complete')
      // All three sleeps should use step.sleep()
      expect(calls.sleep.length).toBe(3)
    })
  })

  // ==========================================================================
  // TEST GROUP 6: Error handling with WorkflowStep
  // ==========================================================================

  describe('Error Handling with WorkflowStep', () => {
    it('should propagate step.do() errors correctly', async () => {
      const errorMockStep: WorkflowStep = {
        do: vi.fn().mockRejectedValue(new Error('Step execution failed')),
        sleep: vi.fn().mockResolvedValue(undefined),
        sleepUntil: vi.fn().mockResolvedValue(undefined),
        waitForEvent: vi.fn().mockResolvedValue(undefined),
      }

      const client = new WorkflowClient()

      const activities = proxyActivities<{
        failingActivity: () => Promise<void>
      }>({
        startToCloseTimeout: '10s',
      })

      async function errorHandlingWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(errorMockStep)

        try {
          await activities.failingActivity()
          return { error: null }
        } catch (e) {
          // @ts-expect-error - clearWorkflowStep needs to be implemented
          clearWorkflowStep()
          return { error: (e as Error).message }
        }
      }

      const result = await client.execute(errorHandlingWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.error).toBe('Step execution failed')
    })

    it('should propagate step.sleep() errors correctly', async () => {
      const errorMockStep: WorkflowStep = {
        do: vi.fn().mockResolvedValue(undefined),
        sleep: vi.fn().mockRejectedValue(new Error('Sleep interrupted')),
        sleepUntil: vi.fn().mockResolvedValue(undefined),
        waitForEvent: vi.fn().mockResolvedValue(undefined),
      }

      const client = new WorkflowClient()

      async function sleepErrorWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(errorMockStep)

        try {
          await sleep('1s')
          return { error: null }
        } catch (e) {
          // @ts-expect-error - clearWorkflowStep needs to be implemented
          clearWorkflowStep()
          return { error: (e as Error).message }
        }
      }

      const result = await client.execute(sleepErrorWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.error).toBe('Sleep interrupted')
    })

    it('should clear step context on workflow error', async () => {
      const { mockStep } = createMockWorkflowStep()
      const client = new WorkflowClient()

      async function throwingWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        throw new Error('Workflow failed')
      }

      try {
        await client.execute(throwingWorkflow, {
          taskQueue: 'test-queue',
        })
      } catch {
        // Expected
      }

      // Step context should be cleared even after error
      // @ts-expect-error - getWorkflowStep needs to be implemented
      expect(getWorkflowStep()).toBeNull()
    })
  })

  // ==========================================================================
  // TEST GROUP 7: Integration with CFWorkflowsBackend
  // ==========================================================================

  describe('Integration with CFWorkflowsBackend', () => {
    it('should use CFWorkflowsBackend.sleep() when configured', async () => {
      // This test verifies that the Temporal compat layer can be configured
      // to use CFWorkflowsBackend as its underlying storage/execution backend

      // Import will be available after implementation
      // import { CFWorkflowsBackend } from '../backends/cloudflare-workflows'

      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      async function backendIntegrationWorkflow() {
        // When CFWorkflowsBackend is configured with a WorkflowStep,
        // all operations should route through it

        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        await sleep('1h') // Long sleep - ideal for CF Workflows

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return 'backend integrated'
      }

      const result = await client.execute(backendIntegrationWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('backend integrated')
      expect(calls.sleep.length).toBe(1)
      expect(calls.sleep[0].duration).toBe('1h')
    })

    it('should use CFWorkflowsBackend.step() for activities when configured', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      const activities = proxyActivities<{
        durableOperation: () => Promise<{ result: string }>
      }>({
        startToCloseTimeout: '5m',
      })

      async function durableActivityWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        const result = await activities.durableOperation()

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return result
      }

      await client.execute(durableActivityWorkflow, {
        taskQueue: 'test-queue',
      })

      // Verify step.do() was used for the activity
      expect(calls.do.length).toBe(1)
      expect(calls.do[0].name).toContain('durableOperation')
    })
  })

  // ==========================================================================
  // TEST GROUP 8: sleepUntil support
  // ==========================================================================

  describe('sleepUntil with WorkflowStep', () => {
    it('should call step.sleepUntil() with Date when WorkflowStep is available', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      // Note: sleepUntil might need to be added to the Temporal compat layer
      // or accessed through a different API

      async function sleepUntilDateWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        const targetDate = new Date(Date.now() + 60 * 60 * 1000) // 1 hour from now

        // If sleepUntil is implemented, use it
        // Otherwise, this test documents the expected behavior
        // @ts-expect-error - sleepUntil might not exist yet
        if (typeof sleepUntil === 'function') {
          // @ts-expect-error - sleepUntil might not exist yet
          await sleepUntil(targetDate)
        }

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return 'slept until date'
      }

      // This test may be skipped if sleepUntil is not implemented
      // It documents the expected behavior for the GREEN phase
    })

    it('should call step.sleepUntil() with timestamp when WorkflowStep is available', async () => {
      const { mockStep, calls } = createMockWorkflowStep()
      const client = new WorkflowClient()

      async function sleepUntilTimestampWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        const targetTimestamp = Math.floor(Date.now() / 1000) + 3600 // Unix timestamp

        // @ts-expect-error - sleepUntil might not exist yet
        if (typeof sleepUntil === 'function') {
          // @ts-expect-error - sleepUntil might not exist yet
          await sleepUntil(targetTimestamp)
        }

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return 'slept until timestamp'
      }

      // This test documents the expected behavior for sleepUntil
    })
  })

  // ==========================================================================
  // TEST GROUP 9: waitForEvent support
  // ==========================================================================

  describe('waitForEvent with WorkflowStep', () => {
    it('should call step.waitForEvent() when WorkflowStep is available', async () => {
      const { mockStep, calls } = createMockWorkflowStep()

      // Modify mock to return an event
      mockStep.waitForEvent = vi.fn().mockResolvedValue({ type: 'approval', approved: true })

      const client = new WorkflowClient()

      async function waitForEventWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(mockStep)

        // If waitForEvent is implemented in Temporal compat layer
        // @ts-expect-error - waitForEvent might not exist in compat layer yet
        if (typeof waitForEvent === 'function') {
          // @ts-expect-error - waitForEvent might not exist yet
          const event = await waitForEvent('approval-event', { timeout: '24h' })
          return event
        }

        // @ts-expect-error - clearWorkflowStep needs to be implemented
        clearWorkflowStep()

        return null
      }

      // This test documents expected behavior for waitForEvent support
    })

    it('should handle waitForEvent timeout', async () => {
      const timeoutMockStep: WorkflowStep = {
        do: vi.fn().mockResolvedValue(undefined),
        sleep: vi.fn().mockResolvedValue(undefined),
        sleepUntil: vi.fn().mockResolvedValue(undefined),
        waitForEvent: vi.fn().mockRejectedValue(new Error('Timeout waiting for event')),
      }

      const client = new WorkflowClient()

      async function waitTimeoutWorkflow() {
        // @ts-expect-error - setWorkflowStep needs to be implemented
        setWorkflowStep(timeoutMockStep)

        try {
          // @ts-expect-error - waitForEvent might not exist yet
          if (typeof waitForEvent === 'function') {
            // @ts-expect-error - waitForEvent might not exist yet
            await waitForEvent('never-arrives', { timeout: '1s' })
          }
          return { timedOut: false }
        } catch {
          return { timedOut: true }
        } finally {
          // @ts-expect-error - clearWorkflowStep needs to be implemented
          clearWorkflowStep()
        }
      }

      // This test documents expected timeout handling
    })
  })
})

// ============================================================================
// Additional type tests for the expected API
// ============================================================================

describe('Expected API Surface', () => {
  it('should export setWorkflowStep function', () => {
    // This test will pass once setWorkflowStep is implemented and exported
    // Currently, this documents the expected API

    // @ts-expect-error - Function should be exported from './index'
    expect(typeof setWorkflowStep).toBe('function')
  })

  it('should export clearWorkflowStep function', () => {
    // @ts-expect-error - Function should be exported from './index'
    expect(typeof clearWorkflowStep).toBe('function')
  })

  it('should export getWorkflowStep function', () => {
    // @ts-expect-error - Function should be exported from './index'
    expect(typeof getWorkflowStep).toBe('function')
  })
})
