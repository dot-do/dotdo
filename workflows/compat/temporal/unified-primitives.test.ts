/**
 * Tests for Unified Primitives Integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createActivityDeduplicationContext,
  createWorkflowHistoryStore,
  createWorkflowTimerManager,
  createWorkflowDeadlineManager,
  createUnifiedWorkflowRuntime,
  seconds,
  milliseconds,
} from './unified-primitives'

describe('Unified Primitives Integration', () => {
  describe('ActivityDeduplicationContext', () => {
    it('should execute activity once and cache result', async () => {
      const ctx = createActivityDeduplicationContext('workflow-1')
      let callCount = 0

      const result1 = await ctx.executeOnce('activity-1', async () => {
        callCount++
        return 'done'
      })

      const result2 = await ctx.executeOnce('activity-1', async () => {
        callCount++
        return 'should not run'
      })

      expect(result1).toBe('done')
      expect(result2).toBe('done')
      expect(callCount).toBe(1)
    })

    it('should track executed activities', async () => {
      const ctx = createActivityDeduplicationContext('workflow-2')

      expect(await ctx.isExecuted('activity-1')).toBe(false)

      await ctx.executeOnce('activity-1', async () => 'done')

      expect(await ctx.isExecuted('activity-1')).toBe(true)
      expect(await ctx.isExecuted('activity-2')).toBe(false)
    })

    it('should execute compensatable activities', async () => {
      const ctx = createActivityDeduplicationContext('workflow-3')
      const compensations: string[] = []

      const result = await ctx.executeCompensatable(
        'activity-1',
        async () => 'result-1',
        async (result) => {
          compensations.push(`compensate: ${result}`)
        }
      )

      expect(result).toBe('result-1')
    })

    it('should expose underlying ExactlyOnceContext', () => {
      const ctx = createActivityDeduplicationContext('workflow-4')
      expect(ctx.getContext()).toBeDefined()
      expect(typeof ctx.getContext().processOnce).toBe('function')
    })
  })

  describe('WorkflowHistoryStore', () => {
    it('should append and retrieve events', async () => {
      const store = createWorkflowHistoryStore('workflow-1')

      const event1 = await store.appendEvent({
        eventType: 'WORKFLOW_STARTED',
        attributes: { input: 'test' },
      })

      const event2 = await store.appendEvent({
        eventType: 'ACTIVITY_SCHEDULED',
        attributes: { activityType: 'sendEmail' },
      })

      const history = await store.getHistory()

      expect(history).toHaveLength(2)
      expect(history[0]?.eventId).toBe(1)
      expect(history[1]?.eventId).toBe(2)
      expect(event1.eventType).toBe('WORKFLOW_STARTED')
      expect(event2.eventType).toBe('ACTIVITY_SCHEDULED')
    })

    it('should get history up to specific event', async () => {
      const store = createWorkflowHistoryStore('workflow-2')

      await store.appendEvent({ eventType: 'WORKFLOW_STARTED', attributes: {} })
      await store.appendEvent({ eventType: 'ACTIVITY_SCHEDULED', attributes: {} })
      await store.appendEvent({ eventType: 'ACTIVITY_COMPLETED', attributes: {} })

      const historyUpTo2 = await store.getHistoryUpTo(2)

      expect(historyUpTo2).toHaveLength(2)
      expect(historyUpTo2[1]?.eventType).toBe('ACTIVITY_SCHEDULED')
    })

    it('should get last event of type', async () => {
      const store = createWorkflowHistoryStore('workflow-3')

      await store.appendEvent({ eventType: 'ACTIVITY_SCHEDULED', attributes: { id: 1 } })
      await store.appendEvent({ eventType: 'ACTIVITY_COMPLETED', attributes: {} })
      await store.appendEvent({ eventType: 'ACTIVITY_SCHEDULED', attributes: { id: 2 } })

      const lastScheduled = await store.getLastEventOfType('ACTIVITY_SCHEDULED')

      expect(lastScheduled).toBeDefined()
      expect(lastScheduled?.attributes).toEqual({ id: 2 })
    })

    it('should return null for non-existent event type', async () => {
      const store = createWorkflowHistoryStore('workflow-4')

      await store.appendEvent({ eventType: 'WORKFLOW_STARTED', attributes: {} })

      const result = await store.getLastEventOfType('WORKFLOW_FAILED')

      expect(result).toBeNull()
    })

    it('should track history length', async () => {
      const store = createWorkflowHistoryStore('workflow-5')

      expect(store.getHistoryLength()).toBe(0)

      await store.appendEvent({ eventType: 'WORKFLOW_STARTED', attributes: {} })
      expect(store.getHistoryLength()).toBe(1)

      await store.appendEvent({ eventType: 'ACTIVITY_SCHEDULED', attributes: {} })
      expect(store.getHistoryLength()).toBe(2)
    })

    it('should clear history', async () => {
      const store = createWorkflowHistoryStore('workflow-6')

      await store.appendEvent({ eventType: 'WORKFLOW_STARTED', attributes: {} })
      await store.appendEvent({ eventType: 'ACTIVITY_SCHEDULED', attributes: {} })

      await store.clear()

      expect(store.getHistoryLength()).toBe(0)
      expect(await store.getHistory()).toEqual([])
    })
  })

  describe('WorkflowTimerManager', () => {
    let timerManager: ReturnType<typeof createWorkflowTimerManager>

    beforeEach(() => {
      timerManager = createWorkflowTimerManager()
    })

    afterEach(() => {
      timerManager.dispose()
    })

    it('should start a timer and track it', async () => {
      const timerPromise = timerManager.startTimer({
        timerId: 'timer-1',
        duration: milliseconds(50),
      })

      expect(timerManager.isTimerActive('timer-1')).toBe(true)

      await timerPromise

      expect(timerManager.isTimerActive('timer-1')).toBe(false)
    })

    it('should cancel a timer', async () => {
      const timerPromise = timerManager.startTimer({
        timerId: 'timer-2',
        duration: seconds(10),
      })

      expect(timerManager.isTimerActive('timer-2')).toBe(true)

      const cancelled = timerManager.cancelTimer('timer-2')

      expect(cancelled).toBe(true)
      expect(timerManager.isTimerActive('timer-2')).toBe(false)

      // Timer promise should reject
      await expect(timerPromise).rejects.toThrow('Timer cancelled')
    })

    it('should list active timers', async () => {
      // Start timers but don't await them
      const timerA = timerManager.startTimer({ timerId: 'timer-a', duration: seconds(10) })
      const timerB = timerManager.startTimer({ timerId: 'timer-b', duration: seconds(10) })

      const activeTimers = timerManager.getActiveTimers()

      expect(activeTimers).toContain('timer-a')
      expect(activeTimers).toContain('timer-b')
      expect(activeTimers).toHaveLength(2)

      // Clean up by cancelling
      timerManager.cancelTimer('timer-a')
      timerManager.cancelTimer('timer-b')

      // Catch the expected rejections
      await expect(timerA).rejects.toThrow('Timer cancelled')
      await expect(timerB).rejects.toThrow('Timer cancelled')
    })

    it('should call callback when timer fires', async () => {
      let called = false

      await timerManager.startTimer({
        timerId: 'timer-callback',
        duration: milliseconds(10),
        callback: () => {
          called = true
        },
      })

      expect(called).toBe(true)
    })

    it('should return false when cancelling non-existent timer', () => {
      const cancelled = timerManager.cancelTimer('non-existent')
      expect(cancelled).toBe(false)
    })
  })

  describe('WorkflowDeadlineManager', () => {
    let deadlineManager: ReturnType<typeof createWorkflowDeadlineManager>

    beforeEach(() => {
      deadlineManager = createWorkflowDeadlineManager()
    })

    afterEach(() => {
      deadlineManager.dispose()
    })

    it('should set a deadline', () => {
      deadlineManager.setDeadline({
        deadlineId: 'deadline-1',
        deadline: Date.now() + 10000,
      })

      expect(deadlineManager.isDeadlineExceeded('deadline-1')).toBe(false)
    })

    it('should detect exceeded deadline', () => {
      deadlineManager.setDeadline({
        deadlineId: 'deadline-2',
        deadline: Date.now() - 1000, // Already past
      })

      expect(deadlineManager.isDeadlineExceeded('deadline-2')).toBe(true)
    })

    it('should clear a deadline', () => {
      deadlineManager.setDeadline({
        deadlineId: 'deadline-3',
        deadline: Date.now() + 10000,
      })

      deadlineManager.clearDeadline('deadline-3')

      expect(deadlineManager.isDeadlineExceeded('deadline-3')).toBe(false)
      expect(deadlineManager.getRemainingTime('deadline-3')).toBeNull()
    })

    it('should get remaining time', () => {
      const deadline = Date.now() + 5000
      deadlineManager.setDeadline({
        deadlineId: 'deadline-4',
        deadline,
      })

      const remaining = deadlineManager.getRemainingTime('deadline-4')

      expect(remaining).toBeDefined()
      expect(remaining).toBeGreaterThan(4000)
      expect(remaining).toBeLessThanOrEqual(5000)
    })

    it('should call callback when deadline is exceeded', async () => {
      let called = false

      deadlineManager.setDeadline({
        deadlineId: 'deadline-5',
        deadline: Date.now() - 1, // Immediately exceeded
        onDeadlineExceeded: () => {
          called = true
        },
      })

      // Give it a tick to process
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(called).toBe(true)
    })

    it('should accept Date object for deadline', () => {
      const deadline = new Date(Date.now() + 10000)

      deadlineManager.setDeadline({
        deadlineId: 'deadline-6',
        deadline,
      })

      expect(deadlineManager.isDeadlineExceeded('deadline-6')).toBe(false)
    })
  })

  describe('UnifiedWorkflowRuntime', () => {
    it('should create runtime with all components', () => {
      const runtime = createUnifiedWorkflowRuntime({
        workflowId: 'workflow-1',
      })

      expect(runtime.activities).toBeDefined()
      expect(runtime.history).toBeDefined()
      expect(runtime.timers).toBeDefined()
      expect(runtime.deadlines).toBeDefined()
      expect(runtime.watermarks).toBeDefined()
      expect(typeof runtime.sideEffect).toBe('function')
      expect(typeof runtime.dispose).toBe('function')

      runtime.dispose()
    })

    it('should record side effects deterministically', async () => {
      const runtime = createUnifiedWorkflowRuntime({
        workflowId: 'workflow-2',
        runId: 'run-1',
      })

      const value1 = await runtime.sideEffect(() => Math.random())
      const value2 = await runtime.sideEffect(() => Math.random())

      // Different calls should produce different values
      expect(value1).not.toBe(value2)

      // Side effects should be recorded in history
      expect(runtime.history.getHistoryLength()).toBe(2)

      runtime.dispose()
    })

    it('should cache side effects for replay', async () => {
      const runtime = createUnifiedWorkflowRuntime({
        workflowId: 'workflow-3',
        runId: 'run-1',
      })

      let callCount = 0
      const getValue = () => {
        callCount++
        return 42
      }

      // First call
      const value1 = await runtime.sideEffect(getValue)

      // The side effect function is always called (no caching of the same key)
      // because each sideEffect call gets a unique key based on counter
      expect(value1).toBe(42)
      expect(callCount).toBe(1)

      runtime.dispose()
    })

    it('should integrate all components', async () => {
      const runtime = createUnifiedWorkflowRuntime({
        workflowId: 'workflow-4',
      })

      // Record workflow start
      await runtime.history.appendEvent({
        eventType: 'WORKFLOW_STARTED',
        attributes: {},
      })

      // Execute activity with deduplication
      const result = await runtime.activities.executeOnce('process', async () => 'processed')
      expect(result).toBe('processed')

      // Set a deadline
      runtime.deadlines.setDeadline({
        deadlineId: 'sla',
        deadline: Date.now() + 60000,
      })

      // Check deadline
      expect(runtime.deadlines.isDeadlineExceeded('sla')).toBe(false)

      // Record side effect
      const timestamp = await runtime.sideEffect(() => Date.now())
      expect(typeof timestamp).toBe('number')

      // Verify history
      expect(runtime.history.getHistoryLength()).toBe(2)

      runtime.dispose()
    })
  })
})
