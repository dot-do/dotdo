/**
 * Tests for WorkflowCoreStorageStrategy
 *
 * Tests the unified storage strategy that bridges WorkflowCore with
 * workflow compat layers (Temporal, Inngest, Trigger.dev).
 *
 * TDD approach: NO MOCKS - tests use real WorkflowCore with real primitives.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  WorkflowCoreStorageStrategy,
  createWorkflowCoreStorageStrategy,
  type WorkflowCoreStorageOptions,
} from './workflow-core-storage'

describe('WorkflowCoreStorageStrategy', () => {
  let strategy: WorkflowCoreStorageStrategy

  beforeEach(() => {
    strategy = createWorkflowCoreStorageStrategy({
      workflowId: 'test-workflow-1',
    })
  })

  afterEach(() => {
    strategy.dispose()
  })

  describe('Step Execution (ExactlyOnceContext)', () => {
    it('should execute a step exactly once', async () => {
      let callCount = 0

      const result1 = await strategy.executeStep('step-1', async () => {
        callCount++
        return 'result-1'
      })

      const result2 = await strategy.executeStep('step-1', async () => {
        callCount++
        return 'should-not-run'
      })

      expect(result1).toBe('result-1')
      expect(result2).toBe('result-1')
      expect(callCount).toBe(1)
    })

    it('should track completed steps', async () => {
      expect(await strategy.isStepCompleted('step-1')).toBe(false)

      await strategy.executeStep('step-1', async () => 'done')

      expect(await strategy.isStepCompleted('step-1')).toBe(true)
      expect(await strategy.isStepCompleted('step-2')).toBe(false)
    })

    it('should execute different steps independently', async () => {
      const result1 = await strategy.executeStep('step-a', async () => 'a')
      const result2 = await strategy.executeStep('step-b', async () => 'b')

      expect(result1).toBe('a')
      expect(result2).toBe('b')
    })

    it('should handle concurrent step executions', async () => {
      let callCount = 0

      const [result1, result2] = await Promise.all([
        strategy.executeStep('concurrent-step', async () => {
          callCount++
          await new Promise((r) => setTimeout(r, 10))
          return 'first'
        }),
        strategy.executeStep('concurrent-step', async () => {
          callCount++
          return 'second'
        }),
      ])

      expect(result1).toBe('first')
      expect(result2).toBe('first')
      expect(callCount).toBe(1)
    })

    it('should propagate errors from step execution', async () => {
      await expect(
        strategy.executeStep('failing-step', async () => {
          throw new Error('Step failed')
        })
      ).rejects.toThrow('Step failed')

      // Error is cached for deterministic replay, so step is "completed" with error
      // This matches the behavior of caching errors for consistent retry behavior
      expect(await strategy.isStepCompleted('failing-step')).toBe(true)

      // Subsequent calls should return the cached error
      await expect(
        strategy.executeStep('failing-step', async () => 'should not run')
      ).rejects.toThrow('Step failed')
    })

    it('should cache errors for consistent behavior', async () => {
      let attempts = 0

      // First attempt fails
      await expect(
        strategy.executeStep('error-step', async () => {
          attempts++
          throw new Error('Intentional error')
        })
      ).rejects.toThrow('Intentional error')

      // Second attempt should get cached error (not re-execute)
      await expect(
        strategy.executeStep('error-step', async () => {
          attempts++
          return 'success'
        })
      ).rejects.toThrow('Intentional error')

      expect(attempts).toBe(1)
    })
  })

  describe('Step Result Cache', () => {
    it('should get step result after execution', async () => {
      await strategy.executeStep('result-step', async () => ({ data: 'test' }))

      const result = await strategy.getStepResult<{ data: string }>('result-step')
      expect(result).toEqual({ data: 'test' })
    })

    it('should return undefined for non-existent step', async () => {
      const result = await strategy.getStepResult('non-existent')
      expect(result).toBeUndefined()
    })

    it('should set step result manually', async () => {
      await strategy.setStepResult('manual-step', 'manual-value')

      const result = await strategy.getStepResult<string>('manual-step')
      expect(result).toBe('manual-value')
      expect(await strategy.isStepCompleted('manual-step')).toBe(true)
    })

    it('should handle error results', async () => {
      await strategy.setStepResult('error-step', new Error('Stored error'))

      await expect(strategy.getStepResult('error-step')).rejects.toThrow('Stored error')
    })
  })

  describe('Sleep (WindowManager)', () => {
    it('should sleep for specified duration', async () => {
      const start = Date.now()

      await strategy.sleep('sleep-1', 50, '50ms')

      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)
    })

    it('should return immediately on replay', async () => {
      // First sleep
      await strategy.sleep('sleep-replay', 50, '50ms')

      // Second call should return immediately (cached)
      const start = Date.now()
      await strategy.sleep('sleep-replay', 50, '50ms')
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(20)
    })

    it('should mark sleep as completed', async () => {
      expect(await strategy.isStepCompleted('sleep-complete')).toBe(false)

      await strategy.sleep('sleep-complete', 10, '10ms')

      expect(await strategy.isStepCompleted('sleep-complete')).toBe(true)
    })
  })

  describe('History Tracking', () => {
    it('should record step execution events', async () => {
      await strategy.executeStep('history-step', async () => 'done')

      const history = await strategy.getHistory()
      expect(history.length).toBeGreaterThan(0)

      const completedEvent = history.find((e) => e.type === 'STEP_COMPLETED')
      expect(completedEvent).toBeDefined()
      expect(completedEvent?.stepId).toBe('history-step')
    })

    it('should record timer events', async () => {
      await strategy.sleep('history-sleep', 10, '10ms')

      const history = await strategy.getHistory()
      const timerStarted = history.find((e) => e.type === 'TIMER_STARTED')
      const timerFired = history.find((e) => e.type === 'TIMER_FIRED')

      expect(timerStarted).toBeDefined()
      expect(timerFired).toBeDefined()
    })

    it('should track history length', async () => {
      expect(await strategy.getHistoryLength()).toBe(0)

      await strategy.executeStep('step-1', async () => 'a')
      expect(await strategy.getHistoryLength()).toBe(1)

      await strategy.executeStep('step-2', async () => 'b')
      expect(await strategy.getHistoryLength()).toBe(2)
    })

    it('should support time-travel queries', async () => {
      const t1 = Date.now()
      await strategy.executeStep('step-t1', async () => 'a')

      await new Promise((r) => setTimeout(r, 10))
      const t2 = Date.now()

      await strategy.executeStep('step-t2', async () => 'b')

      // Query at t1+5 should only show first step
      const historyAtT1 = await strategy.getHistoryAsOf(t1 + 5)
      expect(historyAtT1).toHaveLength(1)
    })

    it('should disable history when configured', async () => {
      const noHistoryStrategy = createWorkflowCoreStorageStrategy({
        workflowId: 'no-history-workflow',
        enableHistory: false,
      })

      await noHistoryStrategy.executeStep('step-1', async () => 'done')

      const history = await noHistoryStrategy.getHistory()
      expect(history).toHaveLength(0)

      noHistoryStrategy.dispose()
    })
  })

  describe('Versioning (SchemaEvolution)', () => {
    it('should start at version 0', () => {
      expect(strategy.getVersion()).toBe(0)
    })

    it('should apply patches and increment version', () => {
      const applied = strategy.applyPatch('v1-migration')
      expect(applied).toBe(true)
      expect(strategy.getVersion()).toBe(1)
    })

    it('should track applied patches', () => {
      expect(strategy.isPatchApplied('v1-migration')).toBe(false)

      strategy.applyPatch('v1-migration')

      expect(strategy.isPatchApplied('v1-migration')).toBe(true)
      expect(strategy.isPatchApplied('v2-migration')).toBe(false)
    })

    it('should not re-apply the same patch', () => {
      const applied1 = strategy.applyPatch('v1-migration')
      const applied2 = strategy.applyPatch('v1-migration')

      expect(applied1).toBe(true)
      expect(applied2).toBe(false)
      expect(strategy.getVersion()).toBe(1)
    })
  })

  describe('Checkpointing', () => {
    it('should create checkpoint with current state', async () => {
      await strategy.executeStep('step-1', async () => 'result-1')
      strategy.applyPatch('v1-migration')

      const checkpoint = await strategy.checkpoint()

      expect(checkpoint.workflowId).toBe('test-workflow-1')
      expect(checkpoint.completedSteps).toContain('step-1')
      expect(checkpoint.appliedPatches).toContain('v1-migration')
      expect(checkpoint.version).toBe(1)
    })

    it('should restore from checkpoint', async () => {
      // Setup state
      await strategy.executeStep('step-1', async () => 'result-1')
      strategy.applyPatch('v1-migration')

      const checkpoint = await strategy.checkpoint()

      // Create new strategy and restore
      const newStrategy = createWorkflowCoreStorageStrategy({
        workflowId: 'test-workflow-1',
      })

      await newStrategy.restore(checkpoint)

      expect(await newStrategy.isStepCompleted('step-1')).toBe(true)
      expect(newStrategy.isPatchApplied('v1-migration')).toBe(true)
      expect(newStrategy.getVersion()).toBe(1)

      newStrategy.dispose()
    })

    it('should checkpoint empty state', async () => {
      const checkpoint = await strategy.checkpoint()

      expect(checkpoint.completedSteps).toEqual([])
      expect(checkpoint.appliedPatches).toEqual([])
      expect(checkpoint.version).toBe(0)
    })
  })

  describe('Timer Management', () => {
    it('should create timer via WorkflowCore', async () => {
      const handle = strategy.createTimer(50)

      expect(handle).toBeDefined()
      expect(typeof handle.timerId).toBe('string')
      expect(typeof handle.cancel).toBe('function')

      await handle.promise
    })

    it('should cancel timer', async () => {
      const handle = strategy.createTimer(10000)

      const cancelled = handle.cancel()
      expect(cancelled).toBe(true)

      await expect(handle.promise).rejects.toThrow()
    })
  })

  describe('Factory Function', () => {
    it('should create strategy via factory', () => {
      const created = createWorkflowCoreStorageStrategy({
        workflowId: 'factory-test',
      })

      expect(created).toBeInstanceOf(WorkflowCoreStorageStrategy)
      created.dispose()
    })

    it('should require workflowId', () => {
      // @ts-expect-error - Testing missing required option
      expect(() => createWorkflowCoreStorageStrategy({})).toThrow('workflowId is required')
    })

    it('should accept optional configuration', () => {
      const created = createWorkflowCoreStorageStrategy({
        workflowId: 'config-test',
        runId: 'run-123',
        enableHistory: true,
        stepIdTtl: 60000,
        historyRetention: { maxVersions: 100, maxAge: '7d' },
      })

      expect(created).toBeDefined()
      created.dispose()
    })
  })

  describe('WorkflowCore Access', () => {
    it('should expose underlying WorkflowCore', () => {
      const core = strategy.getCore()

      expect(core).toBeDefined()
      expect(typeof core.executeStep).toBe('function')
      expect(typeof core.sleep).toBe('function')
    })
  })

  describe('Cleanup', () => {
    it('should clear local cache', async () => {
      await strategy.executeStep('step-1', async () => 'value')
      expect(await strategy.isStepCompleted('step-1')).toBe(true)

      strategy.clear()

      // Cache is cleared but WorkflowCore still tracks completion
      const cacheResult = await strategy.getStepResult('step-1')
      expect(cacheResult).toBeUndefined()
    })
  })
})

describe('WorkflowCoreStorageStrategy Integration', () => {
  it('should execute a complete workflow pattern', async () => {
    const strategy = createWorkflowCoreStorageStrategy({
      workflowId: 'integration-test',
      enableHistory: true,
    })

    // Execute steps with deduplication
    const step1Result = await strategy.executeStep('fetch-data', async () => ({
      data: 'fetched',
    }))

    // Apply version patch
    strategy.applyPatch('v2-format')

    // Sleep briefly
    await strategy.sleep('wait', 10, '10ms')

    // Execute another step
    const step2Result = await strategy.executeStep('process-data', async () => ({
      processed: true,
    }))

    // Verify state
    expect(step1Result).toEqual({ data: 'fetched' })
    expect(step2Result).toEqual({ processed: true })
    expect(strategy.getVersion()).toBe(1)
    expect(await strategy.isStepCompleted('fetch-data')).toBe(true)
    expect(await strategy.isStepCompleted('process-data')).toBe(true)

    // Verify history
    const history = await strategy.getHistory()
    expect(history.length).toBeGreaterThanOrEqual(4) // 2 steps + 2 timer events

    strategy.dispose()
  })

  it('should support checkpoint and replay workflow', async () => {
    // First execution
    const strategy1 = createWorkflowCoreStorageStrategy({
      workflowId: 'checkpoint-workflow',
    })

    await strategy1.executeStep('step-1', async () => 'a')
    await strategy1.executeStep('step-2', async () => 'b')
    strategy1.applyPatch('migration-1')

    const checkpoint = await strategy1.checkpoint()
    strategy1.dispose()

    // Simulate restart - create new strategy and restore
    const strategy2 = createWorkflowCoreStorageStrategy({
      workflowId: 'checkpoint-workflow',
    })

    await strategy2.restore(checkpoint)

    // Verify restored state
    expect(await strategy2.isStepCompleted('step-1')).toBe(true)
    expect(await strategy2.isStepCompleted('step-2')).toBe(true)
    expect(strategy2.isPatchApplied('migration-1')).toBe(true)

    // Continue execution - step-3 should run
    let step3Executed = false
    await strategy2.executeStep('step-3', async () => {
      step3Executed = true
      return 'c'
    })

    expect(step3Executed).toBe(true)

    strategy2.dispose()
  })
})
