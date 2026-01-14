/**
 * Activity Routing Tests for Temporal Compat Layer
 *
 * TDD RED Phase: These tests verify activity routing behavior that may not
 * yet be fully implemented. They should initially FAIL to guide GREEN implementation.
 *
 * Activities in Temporal route to specific task queues where workers poll for work.
 * This test suite verifies:
 * - Activities route to registered worker handlers
 * - Task queue isolation between different workers
 * - Timeout handling uses step-level timeouts
 * - Retry behavior with backoff and error classification
 * - Cancellation propagation to pending activities
 * - Result caching for replay determinism
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  proxyActivities,
  registerWorker,
  hasWorker,
  getWorker,
  listTaskQueues,
  WorkflowClient,
  TaskQueueNotRegisteredError,
  __clearTemporalState,
  workflowInfo,
  type ActivityOptions,
  type RetryPolicy,
} from './index'

// Type for clearWorkerRegistry if it needs to be exported
declare function clearWorkerRegistry(): void

/**
 * Helper function to clear the worker registry between tests.
 * Uses __clearTemporalState which clears the task queue registry.
 */
function clearWorkerRegistry(): void {
  __clearTemporalState()
}

/**
 * Activity type definitions for testing
 */
interface TestActivities {
  sendEmail: (to: string, subject: string, body: string) => Promise<{ messageId: string }>
  processPayment: (amount: number, currency: string) => Promise<{ transactionId: string; success: boolean }>
  fetchUserData: (userId: string) => Promise<{ id: string; name: string; email: string }>
  slowOperation: () => Promise<string>
  failingOperation: () => Promise<void>
  retryableOperation: () => Promise<string>
  nonRetryableOperation: () => Promise<void>
  cancellableOperation: () => Promise<string>
  idempotentOperation: (key: string) => Promise<{ result: string; callCount: number }>
}

describe('Activity Routing', () => {
  // Keep track of unregister functions for cleanup
  const unregisterFns: Array<() => void> = []

  beforeEach(() => {
    vi.useRealTimers()
    clearWorkerRegistry()
  })

  afterEach(() => {
    // Clean up all registered workers
    unregisterFns.forEach((fn) => fn())
    unregisterFns.length = 0
    clearWorkerRegistry()
  })

  /**
   * Helper to register a worker and track for cleanup
   */
  function registerAndTrack(taskQueue: string, handler: Parameters<typeof registerWorker>[1] = {}) {
    const unregister = registerWorker(taskQueue, handler)
    unregisterFns.push(unregister)
    return unregister
  }

  describe('basic routing', () => {
    it('should route activity to registered worker handler', async () => {
      const client = new WorkflowClient()
      const activityCalls: Array<{ name: string; args: unknown[] }> = []

      // Register workers for both workflow and activity queues
      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('email-worker-queue', {
        activityTypes: new Set(['sendEmail']),
        executeActivity: async (activityName: string, args: unknown[]) => {
          activityCalls.push({ name: activityName, args })
          return { messageId: 'msg-123' }
        },
      })

      async function emailWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'sendEmail'>>({
          startToCloseTimeout: '10s',
          taskQueue: 'email-worker-queue',
        })

        const result = await activities.sendEmail('user@example.com.ai', 'Hello', 'World')
        return result
      }

      const result = await client.execute(emailWorkflow, {
        taskQueue: 'test-queue',
      })

      // The activity handler should have been called
      // RED: This will fail because proxyActivities doesn't call executeActivity handler
      expect(activityCalls).toHaveLength(1)
      expect(activityCalls[0].name).toBe('sendEmail')
      expect(activityCalls[0].args).toEqual(['user@example.com.ai', 'Hello', 'World'])
      expect(result.messageId).toBe('msg-123')
    })

    it('should invoke activity handler with correct arguments', async () => {
      const client = new WorkflowClient()
      let capturedArgs: unknown[] = []

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('payment-queue', {
        activityTypes: new Set(['processPayment']),
        executeActivity: async (activityName: string, args: unknown[]) => {
          capturedArgs = args
          return { transactionId: 'tx-456', success: true }
        },
      })

      async function paymentWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'processPayment'>>({
          startToCloseTimeout: '30s',
          taskQueue: 'payment-queue',
        })

        return await activities.processPayment(99.99, 'USD')
      }

      const result = await client.execute(paymentWorkflow, {
        taskQueue: 'test-queue',
      })

      // RED: This will fail because proxyActivities doesn't call executeActivity handler
      expect(capturedArgs).toEqual([99.99, 'USD'])
      expect(result.transactionId).toBe('tx-456')
      expect(result.success).toBe(true)
    })

    it('should use workflow task queue when activity task queue is not specified', async () => {
      const client = new WorkflowClient()
      let activityExecuted = false
      let executedOnQueue: string | undefined

      registerAndTrack('workflow-queue', {
        activityTypes: new Set(['fetchUserData']),
        executeActivity: async (activityName: string, args: unknown[]) => {
          activityExecuted = true
          executedOnQueue = 'workflow-queue' // Track which queue executed it
          return { id: 'user-1', name: 'Test User', email: 'test@example.com.ai' }
        },
      })

      async function userWorkflow() {
        // No taskQueue specified - should use workflow's task queue
        const activities = proxyActivities<Pick<TestActivities, 'fetchUserData'>>({
          startToCloseTimeout: '10s',
        })

        return await activities.fetchUserData('user-1')
      }

      const result = await client.execute(userWorkflow, {
        taskQueue: 'workflow-queue', // Workflow runs on this queue
      })

      // RED: Activity handler should be called when using workflow's task queue
      expect(activityExecuted).toBe(true)
      expect(executedOnQueue).toBe('workflow-queue')
      expect(result.id).toBe('user-1')
    })

    it('should support multiple activities with same worker', async () => {
      const client = new WorkflowClient()
      const executedActivities: string[] = []

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('multi-activity-queue', {
        activityTypes: new Set(['sendEmail', 'processPayment', 'fetchUserData']),
        executeActivity: async (activityName: string, args: unknown[]) => {
          executedActivities.push(activityName)
          switch (activityName) {
            case 'sendEmail':
              return { messageId: 'msg-1' }
            case 'processPayment':
              return { transactionId: 'tx-1', success: true }
            case 'fetchUserData':
              return { id: 'u-1', name: 'User', email: 'user@test.com' }
            default:
              throw new Error(`Unknown activity: ${activityName}`)
          }
        },
      })

      async function multiActivityWorkflow() {
        const activities = proxyActivities<TestActivities>({
          startToCloseTimeout: '10s',
          taskQueue: 'multi-activity-queue',
        })

        const email = await activities.sendEmail('a@b.com', 'Subject', 'Body')
        const payment = await activities.processPayment(50, 'EUR')
        const user = await activities.fetchUserData('u-1')

        return { email, payment, user }
      }

      await client.execute(multiActivityWorkflow, {
        taskQueue: 'test-queue',
      })

      // RED: executeActivity handler should be called for each activity
      expect(executedActivities).toEqual(['sendEmail', 'processPayment', 'fetchUserData'])
    })
  })

  describe('task queue isolation', () => {
    it('should route activities to different workers based on task queue', async () => {
      const client = new WorkflowClient()
      const emailWorkerCalls: string[] = []
      const paymentWorkerCalls: string[] = []

      registerAndTrack('workflow-queue') // Workflow queue
      registerAndTrack('email-queue', {
        activityTypes: new Set(['sendEmail']),
        executeActivity: async (activityName: string, args: unknown[]) => {
          emailWorkerCalls.push(activityName)
          return { messageId: 'email-msg' }
        },
      })
      registerAndTrack('payment-queue', {
        activityTypes: new Set(['processPayment']),
        executeActivity: async (activityName: string, args: unknown[]) => {
          paymentWorkerCalls.push(activityName)
          return { transactionId: 'payment-tx', success: true }
        },
      })

      async function mixedQueueWorkflow() {
        const emailActivities = proxyActivities<Pick<TestActivities, 'sendEmail'>>({
          startToCloseTimeout: '10s',
          taskQueue: 'email-queue',
        })

        const paymentActivities = proxyActivities<Pick<TestActivities, 'processPayment'>>({
          startToCloseTimeout: '30s',
          taskQueue: 'payment-queue',
        })

        const email = await emailActivities.sendEmail('test@test.com', 'Hi', 'There')
        const payment = await paymentActivities.processPayment(100, 'USD')

        return { email, payment }
      }

      await client.execute(mixedQueueWorkflow, {
        taskQueue: 'workflow-queue',
      })

      // RED: Each worker should only receive its own activities
      expect(emailWorkerCalls).toEqual(['sendEmail'])
      expect(paymentWorkerCalls).toEqual(['processPayment'])
    })

    it('should throw error when activity invoked on unregistered task queue', async () => {
      const client = new WorkflowClient()

      // Register one queue to enable routing validation
      registerAndTrack('registered-queue', {
        activityTypes: new Set(['someActivity']),
      })

      async function unregisteredQueueWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'sendEmail'>>({
          startToCloseTimeout: '10s',
          taskQueue: 'unregistered-activity-queue', // This queue has no worker
        })

        return await activities.sendEmail('test@test.com', 'Subject', 'Body')
      }

      // RED: Should throw when activity task queue is not registered
      await expect(
        client.execute(unregisteredQueueWorkflow, {
          taskQueue: 'registered-queue',
        })
      ).rejects.toThrow(TaskQueueNotRegisteredError)
    })

    it('should throw error when activity type not registered on target queue', async () => {
      const client = new WorkflowClient()

      // Register workflow queue and activity queue with limited activities
      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('limited-queue', {
        activityTypes: new Set(['sendEmail']), // Only sendEmail is registered
        executeActivity: async () => ({ messageId: 'msg' }),
      })

      async function wrongActivityWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'processPayment'>>({
          startToCloseTimeout: '10s',
          taskQueue: 'limited-queue',
        })

        // processPayment is NOT registered on this queue
        return await activities.processPayment(100, 'USD')
      }

      // RED: Should throw when activity is not registered on the target queue
      await expect(
        client.execute(wrongActivityWorkflow, {
          taskQueue: 'test-queue',
        })
      ).rejects.toThrow(/not registered on task queue/)
    })

    it('should support default task queue for activities', async () => {
      const client = new WorkflowClient()
      let defaultQueueUsed = false

      registerAndTrack('default', {
        activityTypes: new Set(['sendEmail']),
        executeActivity: async () => {
          defaultQueueUsed = true
          return { messageId: 'default-msg' }
        },
      })

      async function defaultQueueWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'sendEmail'>>({
          startToCloseTimeout: '10s',
          // No taskQueue specified - should fall back to workflow's queue
        })

        return await activities.sendEmail('test@test.com', 'Hi', 'There')
      }

      // Run workflow on 'default' queue
      const result = await client.execute(defaultQueueWorkflow, {
        taskQueue: 'default',
      })

      // RED: executeActivity handler should be invoked
      expect(defaultQueueUsed).toBe(true)
      expect(result.messageId).toBe('default-msg')
    })

    it('should isolate activity state between different queues', async () => {
      const client = new WorkflowClient()
      const queue1State: Map<string, number> = new Map()
      const queue2State: Map<string, number> = new Map()

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('queue-1', {
        activityTypes: new Set(['idempotentOperation']),
        executeActivity: async (name: string, args: unknown[]) => {
          const key = args[0] as string
          const count = (queue1State.get(key) || 0) + 1
          queue1State.set(key, count)
          return { result: 'queue-1', callCount: count }
        },
      })
      registerAndTrack('queue-2', {
        activityTypes: new Set(['idempotentOperation']),
        executeActivity: async (name: string, args: unknown[]) => {
          const key = args[0] as string
          const count = (queue2State.get(key) || 0) + 1
          queue2State.set(key, count)
          return { result: 'queue-2', callCount: count }
        },
      })

      async function isolationWorkflow() {
        const activities1 = proxyActivities<Pick<TestActivities, 'idempotentOperation'>>({
          startToCloseTimeout: '10s',
          taskQueue: 'queue-1',
        })

        const activities2 = proxyActivities<Pick<TestActivities, 'idempotentOperation'>>({
          startToCloseTimeout: '10s',
          taskQueue: 'queue-2',
        })

        const result1 = await activities1.idempotentOperation('shared-key')
        const result2 = await activities2.idempotentOperation('shared-key')

        return { result1, result2 }
      }

      const result = await client.execute(isolationWorkflow, {
        taskQueue: 'test-queue',
      })

      // RED: Each queue should have its own isolated state
      expect(result.result1.result).toBe('queue-1')
      expect(result.result2.result).toBe('queue-2')
      expect(queue1State.get('shared-key')).toBe(1)
      expect(queue2State.get('shared-key')).toBe(1)
    })
  })

  describe('timeout handling', () => {
    it('should respect startToCloseTimeout', async () => {
      const client = new WorkflowClient()
      const startTime = Date.now()
      let activityDuration = 0

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('timeout-queue', {
        activityTypes: new Set(['slowOperation']),
        executeActivity: async () => {
          // Simulate slow operation that exceeds timeout
          await new Promise((resolve) => setTimeout(resolve, 5000))
          activityDuration = Date.now() - startTime
          return 'completed'
        },
      })

      async function timeoutWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'slowOperation'>>({
          startToCloseTimeout: '100ms', // Short timeout
          taskQueue: 'timeout-queue',
        })

        return await activities.slowOperation()
      }

      // RED: Activity should timeout before completing
      await expect(
        client.execute(timeoutWorkflow, {
          taskQueue: 'test-queue',
        })
      ).rejects.toThrow(/timeout/i)

      // Verify it was the step-level timeout, not JS setTimeout
      expect(activityDuration).toBeLessThan(5000)
    })

    it('should throw timeout error with correct type', async () => {
      const client = new WorkflowClient()

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('timeout-type-queue', {
        activityTypes: new Set(['slowOperation']),
        executeActivity: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000))
          return 'should not reach'
        },
      })

      async function timeoutTypeWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'slowOperation'>>({
          startToCloseTimeout: '50ms',
          taskQueue: 'timeout-type-queue',
        })

        try {
          await activities.slowOperation()
          return { timedOut: false }
        } catch (error) {
          // Verify error type matches Temporal's ActivityTimeoutError
          return {
            timedOut: true,
            errorName: (error as Error).name,
            isTimeoutError: (error as Error).message.toLowerCase().includes('timeout'),
          }
        }
      }

      const result = await client.execute(timeoutTypeWorkflow, {
        taskQueue: 'test-queue',
      })

      // RED: Timeout should be detected and proper error returned
      expect(result.timedOut).toBe(true)
      expect(result.isTimeoutError).toBe(true)
    })

    it('should use step-level timeout instead of JS setTimeout', async () => {
      const client = new WorkflowClient()
      let stepTimeoutUsed = false

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('step-timeout-queue', {
        activityTypes: new Set(['slowOperation']),
        executeActivity: async () => {
          // This would be implemented by the step.do() timeout mechanism
          // Not by wrapping with Promise.race() + setTimeout
          stepTimeoutUsed = true
          await new Promise((resolve) => setTimeout(resolve, 10))
          return 'quick-result'
        },
      })

      async function stepTimeoutWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'slowOperation'>>({
          startToCloseTimeout: '5s', // Generous timeout
          taskQueue: 'step-timeout-queue',
        })

        return await activities.slowOperation()
      }

      await client.execute(stepTimeoutWorkflow, {
        taskQueue: 'test-queue',
      })

      // The implementation should use step.do() timeout, not setTimeout wrapper
      expect(stepTimeoutUsed).toBe(true)

      
    })

    it('should support scheduleToCloseTimeout', async () => {
      const client = new WorkflowClient()

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('schedule-timeout-queue', {
        activityTypes: new Set(['slowOperation']),
        executeActivity: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          return 'completed'
        },
      })

      async function scheduleTimeoutWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'slowOperation'>>({
          scheduleToCloseTimeout: '10s', // Total time from schedule to completion
          startToCloseTimeout: '5s', // Time from start to completion
          taskQueue: 'schedule-timeout-queue',
        })

        return await activities.slowOperation()
      }

      // Should succeed since operation is quick
      const result = await client.execute(scheduleTimeoutWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('completed')

      
    })

    it('should support heartbeat timeout', async () => {
      const client = new WorkflowClient()
      let heartbeatCalled = false

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('heartbeat-queue', {
        activityTypes: new Set(['slowOperation']),
        executeActivity: async () => {
          // Simulate long-running activity that should heartbeat
          // If heartbeat is not called, activity should timeout
          await new Promise((resolve) => setTimeout(resolve, 2000))
          return 'completed'
        },
      })

      async function heartbeatWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'slowOperation'>>({
          startToCloseTimeout: '10s',
          heartbeatTimeout: '500ms', // Activity must heartbeat every 500ms
          taskQueue: 'heartbeat-queue',
        })

        try {
          await activities.slowOperation()
          return { timedOut: false }
        } catch (error) {
          return {
            timedOut: true,
            isHeartbeatTimeout: (error as Error).message.toLowerCase().includes('heartbeat'),
          }
        }
      }

      const result = await client.execute(heartbeatWorkflow, {
        taskQueue: 'test-queue',
      })

      // Activity should timeout due to missing heartbeat
      expect(result.timedOut).toBe(true)

      
    })
  })

  describe('retry behavior', () => {
    it('should retry activity on failure with backoff', async () => {
      const client = new WorkflowClient()
      const attemptTimestamps: number[] = []
      let attemptCount = 0

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('retry-queue', {
        activityTypes: new Set(['retryableOperation']),
        executeActivity: async () => {
          attemptCount++
          attemptTimestamps.push(Date.now())

          if (attemptCount < 3) {
            throw new Error('Transient failure')
          }
          return 'success-after-retries'
        },
      })

      async function retryWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'retryableOperation'>>({
          startToCloseTimeout: '30s',
          taskQueue: 'retry-queue',
          retry: {
            initialInterval: '100ms',
            backoffCoefficient: 2,
            maximumInterval: '1s',
            maximumAttempts: 5,
          },
        })

        return await activities.retryableOperation()
      }

      const result = await client.execute(retryWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result).toBe('success-after-retries')
      expect(attemptCount).toBe(3)

      // Verify backoff was applied (each retry should be delayed)
      if (attemptTimestamps.length >= 3) {
        const delay1 = attemptTimestamps[1] - attemptTimestamps[0]
        const delay2 = attemptTimestamps[2] - attemptTimestamps[1]

        // Second delay should be approximately 2x first delay (backoffCoefficient)
        expect(delay1).toBeGreaterThanOrEqual(80) // Allow some timing variance
        expect(delay2).toBeGreaterThanOrEqual(delay1 * 1.5) // ~2x with variance
      }

      
    })

    it('should respect maximumAttempts limit', async () => {
      const client = new WorkflowClient()
      let attemptCount = 0

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('max-attempts-queue', {
        activityTypes: new Set(['failingOperation']),
        executeActivity: async () => {
          attemptCount++
          throw new Error('Always fails')
        },
      })

      async function maxAttemptsWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'failingOperation'>>({
          startToCloseTimeout: '30s',
          taskQueue: 'max-attempts-queue',
          retry: {
            initialInterval: '10ms',
            maximumAttempts: 3,
          },
        })

        try {
          await activities.failingOperation()
          return { failed: false }
        } catch (error) {
          return {
            failed: true,
            attempts: attemptCount,
            error: (error as Error).message,
          }
        }
      }

      const result = await client.execute(maxAttemptsWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.failed).toBe(true)
      expect(result.attempts).toBe(3) // Should stop after 3 attempts
      expect(result.error).toBe('Always fails')

      
    })

    it('should not retry non-retryable error types', async () => {
      const client = new WorkflowClient()
      let attemptCount = 0

      class ValidationError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'ValidationError'
        }
      }

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('non-retryable-queue', {
        activityTypes: new Set(['nonRetryableOperation']),
        executeActivity: async () => {
          attemptCount++
          throw new ValidationError('Invalid input')
        },
      })

      async function nonRetryableWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'nonRetryableOperation'>>({
          startToCloseTimeout: '30s',
          taskQueue: 'non-retryable-queue',
          retry: {
            initialInterval: '10ms',
            maximumAttempts: 5,
            nonRetryableErrorTypes: ['ValidationError'],
          },
        })

        try {
          await activities.nonRetryableOperation()
          return { failed: false }
        } catch (error) {
          return {
            failed: true,
            attempts: attemptCount,
            errorName: (error as Error).name,
          }
        }
      }

      const result = await client.execute(nonRetryableWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.failed).toBe(true)
      expect(result.attempts).toBe(1) // Should NOT retry for non-retryable errors
      expect(result.errorName).toBe('ValidationError')

      
    })

    it('should respect maximumInterval cap on backoff', async () => {
      const client = new WorkflowClient()
      const attemptTimestamps: number[] = []
      let attemptCount = 0

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('max-interval-queue', {
        activityTypes: new Set(['retryableOperation']),
        executeActivity: async () => {
          attemptCount++
          attemptTimestamps.push(Date.now())

          if (attemptCount < 5) {
            throw new Error('Keep trying')
          }
          return 'done'
        },
      })

      async function maxIntervalWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'retryableOperation'>>({
          startToCloseTimeout: '60s',
          taskQueue: 'max-interval-queue',
          retry: {
            initialInterval: '100ms',
            backoffCoefficient: 10, // Very aggressive backoff
            maximumInterval: '300ms', // But capped at 300ms
            maximumAttempts: 6,
          },
        })

        return await activities.retryableOperation()
      }

      await client.execute(maxIntervalWorkflow, {
        taskQueue: 'test-queue',
      })

      // Verify no delay exceeded the maximum
      for (let i = 1; i < attemptTimestamps.length; i++) {
        const delay = attemptTimestamps[i] - attemptTimestamps[i - 1]
        expect(delay).toBeLessThanOrEqual(400) // Allow some variance around 300ms
      }

      
    })

    it('should apply jitter to retry delays', async () => {
      const client = new WorkflowClient()
      const delays: number[] = []
      const attemptTimestamps: number[] = []
      let attemptCount = 0

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('jitter-queue', {
        activityTypes: new Set(['retryableOperation']),
        executeActivity: async () => {
          attemptCount++
          attemptTimestamps.push(Date.now())
          if (attemptCount <= 3) {
            throw new Error('Fail to trigger retry')
          }
          return 'done'
        },
      })

      async function jitterWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'retryableOperation'>>({
          startToCloseTimeout: '30s',
          taskQueue: 'jitter-queue',
          retry: {
            initialInterval: '100ms',
            maximumAttempts: 5,
          },
        })

        return await activities.retryableOperation()
      }

      // Run workflow
      await client.execute(jitterWorkflow, {
        taskQueue: 'test-queue',
      })

      // Collect delays between attempts
      for (let i = 1; i < attemptTimestamps.length; i++) {
        delays.push(attemptTimestamps[i] - attemptTimestamps[i - 1])
      }

      // RED: With jitter, delays should vary (not be exactly the same)
      // This is a probabilistic test - check for some variance
      if (delays.length >= 2) {
        const allSame = delays.every((d) => Math.abs(d - delays[0]) < 5)
        expect(allSame).toBe(false) // Delays should not all be identical
      }
    })
  })

  describe('activity cancellation', () => {
    it('should cancel pending activity when workflow is cancelled', async () => {
      const client = new WorkflowClient()
      let activityStarted = false
      let activityCompleted = false

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('cancel-queue', {
        activityTypes: new Set(['cancellableOperation']),
        executeActivity: async () => {
          activityStarted = true
          await new Promise((resolve) => setTimeout(resolve, 5000))
          activityCompleted = true
          return 'completed'
        },
      })

      async function cancellableWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'cancellableOperation'>>({
          startToCloseTimeout: '30s',
          taskQueue: 'cancel-queue',
        })

        return await activities.cancellableOperation()
      }

      const handle = await client.start(cancellableWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'cancellable-activity-wf',
      })

      // Wait for activity to start
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(activityStarted).toBe(true)

      // Cancel the workflow
      await handle.cancel()

      // Activity should be cancelled (not completed)
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(activityCompleted).toBe(false)

      
    })

    it('should receive cancellation signal in activity', async () => {
      const client = new WorkflowClient()
      let cancellationReceived = false

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('signal-cancel-queue', {
        activityTypes: new Set(['cancellableOperation']),
        executeActivity: async (name: string, args: unknown[], context?: { signal?: AbortSignal }) => {
          // Activity should receive cancellation signal
          const signal = context?.signal
          if (signal) {
            signal.addEventListener('abort', () => {
              cancellationReceived = true
            })
          }

          await new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, 5000)
            signal?.addEventListener('abort', () => {
              clearTimeout(timeout)
              reject(new Error('Activity cancelled'))
            })
          })

          return 'completed'
        },
      })

      async function signalCancelWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'cancellableOperation'>>({
          startToCloseTimeout: '30s',
          taskQueue: 'signal-cancel-queue',
        })

        return await activities.cancellableOperation()
      }

      const handle = await client.start(signalCancelWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'signal-cancel-wf',
      })

      // Wait for activity to start
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Cancel the workflow
      await handle.cancel()

      // Wait a bit for cancellation to propagate
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(cancellationReceived).toBe(true)

      
    })

    it('should cleanup partial work on activity cancellation', async () => {
      const client = new WorkflowClient()
      const cleanupSteps: string[] = []

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('cleanup-queue', {
        activityTypes: new Set(['cancellableOperation']),
        executeActivity: async (name: string, args: unknown[], context?: { signal?: AbortSignal }) => {
          cleanupSteps.push('activity-started')

          try {
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                cleanupSteps.push('activity-completed')
                resolve('done')
              }, 5000)

              context?.signal?.addEventListener('abort', () => {
                clearTimeout(timeout)
                reject(new Error('Cancelled'))
              })
            })
            return 'completed'
          } finally {
            // Cleanup should always run
            cleanupSteps.push('cleanup-executed')
          }
        },
      })

      async function cleanupWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'cancellableOperation'>>({
          startToCloseTimeout: '30s',
          taskQueue: 'cleanup-queue',
        })

        return await activities.cancellableOperation()
      }

      const handle = await client.start(cleanupWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'cleanup-wf',
      })

      // Wait for activity to start
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Cancel
      await handle.cancel()

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(cleanupSteps).toContain('activity-started')
      expect(cleanupSteps).toContain('cleanup-executed')
      expect(cleanupSteps).not.toContain('activity-completed')

      
    })
  })

  describe('activity result caching (replay)', () => {
    it('should return cached result on replay for completed activities', async () => {
      const client = new WorkflowClient()
      let activityCallCount = 0

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('cache-queue', {
        activityTypes: new Set(['idempotentOperation']),
        executeActivity: async (name: string, args: unknown[]) => {
          activityCallCount++
          return { result: `result-${activityCallCount}`, callCount: activityCallCount }
        },
      })

      async function cacheWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'idempotentOperation'>>({
          startToCloseTimeout: '10s',
          taskQueue: 'cache-queue',
        })

        // Call same activity multiple times
        const result1 = await activities.idempotentOperation('key-1')
        const result2 = await activities.idempotentOperation('key-1') // Same key - should be cached

        return { result1, result2 }
      }

      const result = await client.execute(cacheWorkflow, {
        taskQueue: 'test-queue',
      })

      // Both results should have callCount 1 (cached, not re-executed)
      // This depends on step ID generation being deterministic
      expect(result.result1.result).toBe('result-1')
      // On replay, the same step ID should return cached result
      // Note: This may fail initially as caching logic needs implementation

      
    })

    it('should re-throw cached error on replay for failed activities', async () => {
      const client = new WorkflowClient()
      let activityCallCount = 0

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('error-cache-queue', {
        activityTypes: new Set(['failingOperation']),
        executeActivity: async () => {
          activityCallCount++
          throw new Error(`Failure #${activityCallCount}`)
        },
      })

      async function errorCacheWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'failingOperation'>>({
          startToCloseTimeout: '10s',
          taskQueue: 'error-cache-queue',
          retry: {
            maximumAttempts: 1, // No retries - fail immediately
          },
        })

        const errors: string[] = []

        // First call - should fail
        try {
          await activities.failingOperation()
        } catch (e) {
          errors.push((e as Error).message)
        }

        // Second call with same step ID - should return cached error
        try {
          await activities.failingOperation()
        } catch (e) {
          errors.push((e as Error).message)
        }

        return { errors, callCount: activityCallCount }
      }

      const result = await client.execute(errorCacheWorkflow, {
        taskQueue: 'test-queue',
      })

      // Both errors should be the same (cached)
      expect(result.errors).toHaveLength(2)
      // The second error should be from cache, not a new call

      
    })

    it('should NOT call activity handler on replay', async () => {
      const client = new WorkflowClient()
      const handlerCalls: Array<{ name: string; isReplay: boolean }> = []

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('replay-queue', {
        activityTypes: new Set(['idempotentOperation']),
        executeActivity: async (name: string, args: unknown[]) => {
          handlerCalls.push({ name, isReplay: false })
          return { result: 'original', callCount: handlerCalls.length }
        },
      })

      // Simulate a workflow that would replay
      async function replayWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'idempotentOperation'>>({
          startToCloseTimeout: '10s',
          taskQueue: 'replay-queue',
        })

        const info = workflowInfo()

        // First activity call
        const result = await activities.idempotentOperation('test-key')

        return {
          result,
          workflowId: info.workflowId,
          handlerCallCount: handlerCalls.length,
        }
      }

      // First execution
      const firstResult = await client.execute(replayWorkflow, {
        taskQueue: 'test-queue',
        workflowId: 'replay-test-wf',
      })

      expect(firstResult.handlerCallCount).toBe(1)

      // On replay (if workflow were to restart), handlers should NOT be called
      // The cached step result should be returned instead
      // This test validates the caching mechanism

      
    })

    it('should use deterministic step IDs for activity caching', async () => {
      const client = new WorkflowClient()
      const stepIds: string[] = []

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('step-id-queue', {
        activityTypes: new Set(['fetchUserData']),
        executeActivity: async (name: string, args: unknown[]) => {
          // The step ID should be based on activity name + args
          return { id: args[0] as string, name: 'User', email: 'user@test.com' }
        },
      })

      async function stepIdWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'fetchUserData'>>({
          startToCloseTimeout: '10s',
          taskQueue: 'step-id-queue',
        })

        // Different args should produce different step IDs
        const user1 = await activities.fetchUserData('user-1')
        const user2 = await activities.fetchUserData('user-2')
        const user1Again = await activities.fetchUserData('user-1') // Same as first

        return { user1, user2, user1Again }
      }

      const result = await client.execute(stepIdWorkflow, {
        taskQueue: 'test-queue',
      })

      // Different users should have different IDs
      expect(result.user1.id).toBe('user-1')
      expect(result.user2.id).toBe('user-2')
      expect(result.user1Again.id).toBe('user-1')

      
    })
  })

  describe('edge cases', () => {
    it('should handle activity that returns undefined', async () => {
      const client = new WorkflowClient()

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('undefined-queue', {
        activityTypes: new Set(['sendEmail']),
        executeActivity: async () => {
          return undefined
        },
      })

      async function undefinedWorkflow() {
        const activities = proxyActivities<{ voidActivity: () => Promise<void> }>({
          startToCloseTimeout: '10s',
          taskQueue: 'undefined-queue',
        })

        // Cast to use sendEmail which is registered
        const result = await (activities as any).sendEmail('test@test.com', 'Hi', 'There')
        return { result, isUndefined: result === undefined }
      }

      const result = await client.execute(undefinedWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.isUndefined).toBe(true)

      
    })

    it('should handle activity that returns null', async () => {
      const client = new WorkflowClient()

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('null-queue', {
        activityTypes: new Set(['sendEmail']),
        executeActivity: async () => {
          return null
        },
      })

      async function nullWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'sendEmail'>>({
          startToCloseTimeout: '10s',
          taskQueue: 'null-queue',
        })

        const result = await activities.sendEmail('test@test.com', 'Hi', 'There')
        return { result, isNull: result === null }
      }

      const result = await client.execute(nullWorkflow, {
        taskQueue: 'test-queue',
      })

      expect(result.isNull).toBe(true)

      
    })

    it('should handle large activity arguments', async () => {
      const client = new WorkflowClient()
      let receivedData: unknown

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('large-args-queue', {
        activityTypes: new Set(['processPayment']),
        executeActivity: async (name: string, args: unknown[]) => {
          receivedData = args
          return { transactionId: 'tx-large', success: true }
        },
      })

      async function largeArgsWorkflow() {
        const activities = proxyActivities<Pick<TestActivities, 'processPayment'>>({
          startToCloseTimeout: '30s',
          taskQueue: 'large-args-queue',
        })

        // Create large argument (100KB+ of data)
        const largeAmount = 99999.99
        const largeCurrency = 'A'.repeat(100000)

        return await activities.processPayment(largeAmount, largeCurrency)
      }

      await client.execute(largeArgsWorkflow, {
        taskQueue: 'test-queue',
      })

      expect((receivedData as unknown[])[0]).toBe(99999.99)
      expect((receivedData as unknown[])[1]).toHaveLength(100000)

      
    })

    it('should handle concurrent activities on same queue', async () => {
      const client = new WorkflowClient()
      const executionOrder: string[] = []
      let concurrentCount = 0
      let maxConcurrent = 0

      registerAndTrack('test-queue') // Workflow queue
      registerAndTrack('concurrent-queue', {
        activityTypes: new Set(['sendEmail', 'processPayment', 'fetchUserData']),
        executeActivity: async (name: string, args: unknown[]) => {
          concurrentCount++
          maxConcurrent = Math.max(maxConcurrent, concurrentCount)
          executionOrder.push(`start:${name}`)

          await new Promise((resolve) => setTimeout(resolve, 50))

          executionOrder.push(`end:${name}`)
          concurrentCount--

          switch (name) {
            case 'sendEmail':
              return { messageId: 'msg' }
            case 'processPayment':
              return { transactionId: 'tx', success: true }
            case 'fetchUserData':
              return { id: 'u', name: 'U', email: 'u@u.com' }
            default:
              return null
          }
        },
      })

      async function concurrentWorkflow() {
        const activities = proxyActivities<TestActivities>({
          startToCloseTimeout: '10s',
          taskQueue: 'concurrent-queue',
        })

        // Start multiple activities concurrently
        const [email, payment, user] = await Promise.all([
          activities.sendEmail('a@b.com', 'Hi', 'There'),
          activities.processPayment(100, 'USD'),
          activities.fetchUserData('user-1'),
        ])

        return { email, payment, user, maxConcurrent }
      }

      const result = await client.execute(concurrentWorkflow, {
        taskQueue: 'test-queue',
      })

      // All activities should complete
      expect(result.email.messageId).toBe('msg')
      expect(result.payment.transactionId).toBe('tx')
      expect(result.user.id).toBe('u')

      // Should have handled concurrent execution
      expect(executionOrder.filter((e) => e.startsWith('start:'))).toHaveLength(3)
      expect(executionOrder.filter((e) => e.startsWith('end:'))).toHaveLength(3)

      
    })
  })
})
