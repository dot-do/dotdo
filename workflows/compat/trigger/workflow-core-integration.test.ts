/**
 * Tests for Trigger.dev Compat Layer WorkflowCore Integration
 *
 * Tests that the Trigger.dev compat layer can use WorkflowCoreStorageStrategy
 * for unified primitives support (ExactlyOnce, History, Timers, Versioning).
 *
 * TDD approach: NO MOCKS - tests use real WorkflowCore primitives.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  WorkflowCoreStorageStrategy,
  createWorkflowCoreStorageStrategy,
} from '../../core/workflow-core-storage'

describe('Trigger.dev + WorkflowCore Integration', () => {
  let strategy: WorkflowCoreStorageStrategy

  beforeEach(() => {
    strategy = createWorkflowCoreStorageStrategy({
      workflowId: 'trigger-task-1',
      enableHistory: true,
    })
  })

  afterEach(() => {
    strategy.dispose()
  })

  describe('Task Execution (ctx.run equivalent)', () => {
    it('should execute subtasks exactly once like Trigger ctx.run', async () => {
      let callCount = 0

      // Simulate ctx.run('fetch-data', async () => { ... })
      const result1 = await strategy.executeStep('fetch-data', async () => {
        callCount++
        return { records: [1, 2, 3] }
      })

      // On replay, should return cached result
      const result2 = await strategy.executeStep('fetch-data', async () => {
        callCount++
        return { records: [4, 5, 6] }
      })

      expect(result1).toEqual({ records: [1, 2, 3] })
      expect(result2).toEqual({ records: [1, 2, 3] })
      expect(callCount).toBe(1)
    })

    it('should handle task failures and cache errors', async () => {
      // First attempt fails
      await expect(
        strategy.executeStep('failing-task', async () => {
          throw new Error('Database connection failed')
        })
      ).rejects.toThrow('Database connection failed')

      // Cached error is returned on retry
      await expect(
        strategy.executeStep('failing-task', async () => 'success')
      ).rejects.toThrow('Database connection failed')
    })
  })

  describe('Wait (wait.for equivalent)', () => {
    it('should wait and cache completion like Trigger wait.for', async () => {
      const start = Date.now()

      // Simulate wait.for({ seconds: 0.05 })
      await strategy.sleep('wait-for-processing', 50, '50ms')

      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)

      // On replay, should return immediately
      const replayStart = Date.now()
      await strategy.sleep('wait-for-processing', 50, '50ms')
      const replayElapsed = Date.now() - replayStart

      expect(replayElapsed).toBeLessThan(20)
    })
  })

  describe('Run History Tracking', () => {
    it('should record task run history', async () => {
      await strategy.executeStep('task-1', async () => 'a')
      await strategy.sleep('wait', 10, '10ms')
      await strategy.executeStep('task-2', async () => 'b')

      const history = await strategy.getHistory()

      // Should have task events and timer events
      expect(history.length).toBeGreaterThanOrEqual(4)

      const taskCompleted = history.filter((e) => e.type === 'STEP_COMPLETED')
      expect(taskCompleted).toHaveLength(2)
    })

    it('should support run introspection', async () => {
      await strategy.executeStep('step-a', async () => ({ status: 'ok' }))
      await strategy.executeStep('step-b', async () => ({ count: 42 }))

      expect(await strategy.isStepCompleted('step-a')).toBe(true)
      expect(await strategy.isStepCompleted('step-b')).toBe(true)
      expect(await strategy.isStepCompleted('step-c')).toBe(false)

      const historyLength = await strategy.getHistoryLength()
      expect(historyLength).toBe(2)
    })
  })

  describe('Checkpoint and Resume', () => {
    it('should checkpoint and resume task runs', async () => {
      // Execute some tasks
      await strategy.executeStep('task-1', async () => 'result-1')
      await strategy.executeStep('task-2', async () => 'result-2')

      // Create checkpoint
      const checkpoint = await strategy.checkpoint()

      // Create new strategy (simulate worker restart)
      const resumedStrategy = createWorkflowCoreStorageStrategy({
        workflowId: 'trigger-task-1',
      })

      await resumedStrategy.restore(checkpoint)

      // Verify resumed state
      expect(await resumedStrategy.isStepCompleted('task-1')).toBe(true)
      expect(await resumedStrategy.isStepCompleted('task-2')).toBe(true)

      // New tasks should still work
      await resumedStrategy.executeStep('task-3', async () => 'result-3')
      expect(await resumedStrategy.isStepCompleted('task-3')).toBe(true)

      resumedStrategy.dispose()
    })
  })
})

describe('Trigger.dev-style Task Patterns with WorkflowCore', () => {
  it('should support a complete data processing task', async () => {
    const strategy = createWorkflowCoreStorageStrategy({
      workflowId: 'data-processing-task',
      enableHistory: true,
    })

    // Task 1: Fetch data
    const data = await strategy.executeStep('fetch-data', async () => ({
      items: ['a', 'b', 'c'],
      count: 3,
    }))

    // Task 2: Transform data
    const transformed = await strategy.executeStep('transform-data', async () => ({
      items: data.items.map((i) => i.toUpperCase()),
      processed: true,
    }))

    // Task 3: Wait for rate limit
    await strategy.sleep('rate-limit-delay', 10, '10ms')

    // Task 4: Store results
    const stored = await strategy.executeStep('store-results', async () => ({
      success: true,
      storedCount: transformed.items.length,
    }))

    expect(data.count).toBe(3)
    expect(transformed.items).toEqual(['A', 'B', 'C'])
    expect(stored.storedCount).toBe(3)

    strategy.dispose()
  })

  it('should support batch processing pattern', async () => {
    const strategy = createWorkflowCoreStorageStrategy({
      workflowId: 'batch-processing-task',
    })

    const items = [1, 2, 3, 4, 5]

    // Process each item as a separate task
    const results = await Promise.all(
      items.map((item) =>
        strategy.executeStep(`process-item-${item}`, async () => ({
          id: item,
          doubled: item * 2,
        }))
      )
    )

    expect(results).toHaveLength(5)
    expect(results[0]?.doubled).toBe(2)
    expect(results[4]?.doubled).toBe(10)

    // All items should be completed
    for (const item of items) {
      expect(await strategy.isStepCompleted(`process-item-${item}`)).toBe(true)
    }

    strategy.dispose()
  })

  it('should support retry with exponential backoff pattern', async () => {
    const strategy = createWorkflowCoreStorageStrategy({
      workflowId: 'retry-pattern-task',
    })

    let attempts = 0
    const maxRetries = 3

    // Simulate retry pattern
    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        const result = await strategy.executeStep(`attempt-${retry}`, async () => {
          attempts++
          if (retry < 2) {
            throw new Error(`Attempt ${retry} failed`)
          }
          return { success: true, attempt: retry }
        })

        // If we get here, task succeeded
        expect(result.success).toBe(true)
        expect(result.attempt).toBe(2)
        break
      } catch (error) {
        // Wait before retry (exponential backoff)
        const backoffMs = Math.pow(2, retry) * 5
        await strategy.sleep(`backoff-${retry}`, backoffMs, `${backoffMs}ms`)
      }
    }

    // Should have attempted 3 times
    expect(attempts).toBe(3)

    strategy.dispose()
  })

  it('should support scheduled task pattern', async () => {
    const strategy = createWorkflowCoreStorageStrategy({
      workflowId: 'scheduled-task',
      enableHistory: true,
    })

    // Simulate a scheduled task that runs periodically
    const intervals = [0, 10, 20]

    for (const interval of intervals) {
      if (interval > 0) {
        await strategy.sleep(`wait-${interval}`, interval, `${interval}ms`)
      }

      await strategy.executeStep(`scheduled-run-${interval}`, async () => ({
        ranAt: Date.now(),
        interval,
      }))
    }

    // All scheduled runs should be completed
    for (const interval of intervals) {
      expect(await strategy.isStepCompleted(`scheduled-run-${interval}`)).toBe(true)
    }

    // History should reflect all runs
    const history = await strategy.getHistory()
    const runs = history.filter((e) => e.type === 'STEP_COMPLETED')
    expect(runs).toHaveLength(3)

    strategy.dispose()
  })
})
