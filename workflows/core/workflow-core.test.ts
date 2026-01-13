/**
 * Tests for WorkflowCore abstraction
 *
 * WorkflowCore composes ExactlyOnceContext, TemporalStore, SchemaEvolution,
 * and WindowManager into a unified workflow execution foundation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  WorkflowCore,
  createWorkflowCore,
  type WorkflowCoreOptions,
  type WorkflowEvent,
  type TimerHandle,
  type CheckpointState,
} from './workflow-core'
import { milliseconds, seconds } from '../../db/primitives/window-manager'

describe('WorkflowCore', () => {
  let core: WorkflowCore

  beforeEach(() => {
    core = createWorkflowCore({ workflowId: 'test-workflow-1' })
  })

  afterEach(() => {
    core.dispose()
  })

  describe('Step Execution (ExactlyOnceContext)', () => {
    it('should execute a step exactly once', async () => {
      let callCount = 0

      const result1 = await core.executeStep('step-1', async () => {
        callCount++
        return 'result-1'
      })

      const result2 = await core.executeStep('step-1', async () => {
        callCount++
        return 'should-not-run'
      })

      expect(result1).toBe('result-1')
      expect(result2).toBe('result-1')
      expect(callCount).toBe(1)
    })

    it('should track completed steps', async () => {
      expect(await core.isStepCompleted('step-1')).toBe(false)

      await core.executeStep('step-1', async () => 'done')

      expect(await core.isStepCompleted('step-1')).toBe(true)
      expect(await core.isStepCompleted('step-2')).toBe(false)
    })

    it('should handle concurrent step executions', async () => {
      let callCount = 0

      const [result1, result2] = await Promise.all([
        core.executeStep('concurrent-step', async () => {
          callCount++
          await new Promise((r) => setTimeout(r, 10))
          return 'first'
        }),
        core.executeStep('concurrent-step', async () => {
          callCount++
          return 'second'
        }),
      ])

      expect(result1).toBe('first')
      expect(result2).toBe('first')
      expect(callCount).toBe(1)
    })

    it('should execute different steps independently', async () => {
      const result1 = await core.executeStep('step-a', async () => 'a')
      const result2 = await core.executeStep('step-b', async () => 'b')

      expect(result1).toBe('a')
      expect(result2).toBe('b')
    })

    it('should propagate errors from step execution', async () => {
      await expect(
        core.executeStep('failing-step', async () => {
          throw new Error('Step failed')
        })
      ).rejects.toThrow('Step failed')

      // Step should not be marked as completed on failure
      expect(await core.isStepCompleted('failing-step')).toBe(false)
    })
  })

  describe('History (TemporalStore)', () => {
    it('should record workflow events', async () => {
      await core.recordEvent({
        type: 'STEP_STARTED',
        stepId: 'step-1',
        timestamp: Date.now(),
      })

      await core.recordEvent({
        type: 'STEP_COMPLETED',
        stepId: 'step-1',
        result: 'done',
        timestamp: Date.now(),
      })

      const history = await core.getHistory()

      expect(history).toHaveLength(2)
      expect(history[0]?.type).toBe('STEP_STARTED')
      expect(history[1]?.type).toBe('STEP_COMPLETED')
    })

    it('should query history as of a specific timestamp', async () => {
      const t1 = Date.now()
      await core.recordEvent({
        type: 'STEP_STARTED',
        stepId: 'step-1',
        timestamp: t1,
      })

      await new Promise((r) => setTimeout(r, 10))
      const t2 = Date.now()

      await core.recordEvent({
        type: 'STEP_COMPLETED',
        stepId: 'step-1',
        timestamp: t2,
      })

      const historyAtT1 = await core.getHistoryAsOf(t1 + 5)

      expect(historyAtT1).toHaveLength(1)
      expect(historyAtT1[0]?.type).toBe('STEP_STARTED')
    })

    it('should maintain event ordering', async () => {
      for (let i = 0; i < 5; i++) {
        await core.recordEvent({
          type: 'STEP_STARTED',
          stepId: `step-${i}`,
          timestamp: Date.now() + i,
        })
      }

      const history = await core.getHistory()

      expect(history).toHaveLength(5)
      for (let i = 0; i < 5; i++) {
        expect(history[i]?.stepId).toBe(`step-${i}`)
      }
    })

    it('should return empty history when no events recorded', async () => {
      const history = await core.getHistory()
      expect(history).toEqual([])
    })
  })

  describe('Versioning (SchemaEvolution)', () => {
    it('should start at version 0', () => {
      expect(core.getVersion()).toBe(0)
    })

    it('should apply patches and increment version', () => {
      const applied = core.applyPatch('patch-1')
      expect(applied).toBe(true)
      expect(core.getVersion()).toBe(1)
    })

    it('should track applied patches', () => {
      expect(core.isPatchApplied('patch-1')).toBe(false)

      core.applyPatch('patch-1')

      expect(core.isPatchApplied('patch-1')).toBe(true)
      expect(core.isPatchApplied('patch-2')).toBe(false)
    })

    it('should not re-apply the same patch', () => {
      const applied1 = core.applyPatch('patch-1')
      const applied2 = core.applyPatch('patch-1')

      expect(applied1).toBe(true)
      expect(applied2).toBe(false)
      expect(core.getVersion()).toBe(1)
    })

    it('should apply multiple patches', () => {
      core.applyPatch('patch-1')
      core.applyPatch('patch-2')
      core.applyPatch('patch-3')

      expect(core.getVersion()).toBe(3)
      expect(core.isPatchApplied('patch-1')).toBe(true)
      expect(core.isPatchApplied('patch-2')).toBe(true)
      expect(core.isPatchApplied('patch-3')).toBe(true)
    })
  })

  describe('Timers (WindowManager)', () => {
    it('should create a timer', async () => {
      const handle = core.createTimer(milliseconds(50))

      expect(handle).toBeDefined()
      expect(typeof handle.timerId).toBe('string')
      expect(typeof handle.cancel).toBe('function')
      expect(typeof handle.promise).toBe('object')

      await handle.promise
    })

    it('should resolve timer after duration', async () => {
      const start = Date.now()
      const handle = core.createTimer(milliseconds(50))

      await handle.promise

      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)
    })

    it('should cancel a timer', async () => {
      const handle = core.createTimer(seconds(10))

      const cancelled = handle.cancel()
      expect(cancelled).toBe(true)

      await expect(handle.promise).rejects.toThrow()
    })

    it('should implement sleep as a timer', async () => {
      const start = Date.now()

      await core.sleep(milliseconds(50))

      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)
    })

    it('should support string duration format', async () => {
      const start = Date.now()

      await core.sleep('50ms')

      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)
    })

    it('should support numeric duration (milliseconds)', async () => {
      const start = Date.now()

      await core.sleep(50)

      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)
    })
  })

  describe('Checkpointing', () => {
    it('should create a checkpoint', async () => {
      await core.executeStep('step-1', async () => 'result-1')
      await core.recordEvent({
        type: 'STEP_COMPLETED',
        stepId: 'step-1',
        timestamp: Date.now(),
      })
      core.applyPatch('patch-1')

      const checkpoint = await core.checkpoint()

      expect(checkpoint).toBeDefined()
      expect(checkpoint.workflowId).toBe('test-workflow-1')
      expect(checkpoint.version).toBe(1)
      expect(checkpoint.completedSteps).toContain('step-1')
      expect(checkpoint.appliedPatches).toContain('patch-1')
    })

    it('should restore from checkpoint', async () => {
      // Set up some state
      await core.executeStep('step-1', async () => 'result-1')
      core.applyPatch('patch-1')
      await core.recordEvent({
        type: 'STEP_COMPLETED',
        stepId: 'step-1',
        timestamp: Date.now(),
      })

      // Create checkpoint
      const checkpoint = await core.checkpoint()

      // Create new core and restore
      const newCore = createWorkflowCore({ workflowId: 'test-workflow-1' })

      await newCore.restore(checkpoint)

      expect(await newCore.isStepCompleted('step-1')).toBe(true)
      expect(newCore.isPatchApplied('patch-1')).toBe(true)
      expect(newCore.getVersion()).toBe(1)

      newCore.dispose()
    })

    it('should checkpoint empty state', async () => {
      const checkpoint = await core.checkpoint()

      expect(checkpoint.completedSteps).toEqual([])
      expect(checkpoint.appliedPatches).toEqual([])
      expect(checkpoint.version).toBe(0)
    })

    it('should restore empty checkpoint', async () => {
      const checkpoint: CheckpointState = {
        workflowId: 'test-workflow-1',
        version: 0,
        completedSteps: [],
        appliedPatches: [],
        events: [],
        epoch: 0,
      }

      await core.restore(checkpoint)

      expect(core.getVersion()).toBe(0)
      expect(await core.getHistory()).toEqual([])
    })
  })

  describe('Integration', () => {
    it('should execute a complete workflow pattern', async () => {
      // Record workflow start
      await core.recordEvent({
        type: 'WORKFLOW_STARTED',
        timestamp: Date.now(),
      })

      // Execute steps with deduplication
      const step1Result = await core.executeStep('fetch-data', async () => {
        return { data: 'fetched' }
      })

      await core.recordEvent({
        type: 'STEP_COMPLETED',
        stepId: 'fetch-data',
        result: step1Result,
        timestamp: Date.now(),
      })

      // Apply a version patch
      if (!core.isPatchApplied('v2-format')) {
        core.applyPatch('v2-format')
      }

      // Wait briefly
      await core.sleep(10)

      // Execute another step
      const step2Result = await core.executeStep('process-data', async () => {
        return { processed: true }
      })

      await core.recordEvent({
        type: 'STEP_COMPLETED',
        stepId: 'process-data',
        result: step2Result,
        timestamp: Date.now(),
      })

      // Verify final state
      const history = await core.getHistory()
      expect(history).toHaveLength(3)
      expect(core.getVersion()).toBe(1)
      expect(await core.isStepCompleted('fetch-data')).toBe(true)
      expect(await core.isStepCompleted('process-data')).toBe(true)
    })

    it('should support checkpoint and replay', async () => {
      // Execute some workflow steps
      await core.executeStep('step-1', async () => 'a')
      await core.executeStep('step-2', async () => 'b')
      core.applyPatch('migration-1')

      // Checkpoint
      const checkpoint = await core.checkpoint()

      // Create new core (simulate restart)
      const replayCore = createWorkflowCore({ workflowId: 'test-workflow-1' })
      await replayCore.restore(checkpoint)

      // Verify replayed state
      expect(await replayCore.isStepCompleted('step-1')).toBe(true)
      expect(await replayCore.isStepCompleted('step-2')).toBe(true)
      expect(replayCore.isPatchApplied('migration-1')).toBe(true)

      // Continue execution - step-3 should execute
      let step3Executed = false
      await replayCore.executeStep('step-3', async () => {
        step3Executed = true
        return 'c'
      })

      expect(step3Executed).toBe(true)
      expect(await replayCore.isStepCompleted('step-3')).toBe(true)

      replayCore.dispose()
    })
  })

  describe('Options', () => {
    it('should accept custom workflow ID', () => {
      const customCore = createWorkflowCore({ workflowId: 'custom-id' })
      expect(customCore).toBeDefined()
      customCore.dispose()
    })

    it('should accept run ID', () => {
      const customCore = createWorkflowCore({
        workflowId: 'workflow-1',
        runId: 'run-123',
      })
      expect(customCore).toBeDefined()
      customCore.dispose()
    })

    it('should accept metrics collector', () => {
      const metrics = {
        incrementCounter: () => {},
        recordLatency: () => {},
        recordGauge: () => {},
      }

      const customCore = createWorkflowCore({
        workflowId: 'workflow-1',
        metrics,
      })
      expect(customCore).toBeDefined()
      customCore.dispose()
    })
  })

  describe('Error Handling', () => {
    it('should not mark step as completed on error', async () => {
      try {
        await core.executeStep('error-step', async () => {
          throw new Error('Intentional error')
        })
      } catch {
        // Expected
      }

      expect(await core.isStepCompleted('error-step')).toBe(false)
    })

    it('should allow retrying failed steps', async () => {
      let attempt = 0

      try {
        await core.executeStep('retry-step', async () => {
          attempt++
          if (attempt === 1) {
            throw new Error('First attempt failed')
          }
          return 'success'
        })
      } catch {
        // First attempt fails
      }

      // Retry should work because step wasn't marked complete
      const result = await core.executeStep('retry-step', async () => {
        attempt++
        return 'success on retry'
      })

      expect(result).toBe('success on retry')
      expect(attempt).toBe(2)
    })
  })
})

describe('WorkflowCore Time Travel Features', () => {
  let core: WorkflowCore

  beforeEach(() => {
    core = createWorkflowCore({ workflowId: 'time-travel-test' })
  })

  afterEach(() => {
    core.dispose()
  })

  describe('History Time Travel', () => {
    it('should support time-travel queries on history', async () => {
      const t1 = Date.now()
      const t2 = t1 + 1000
      const t3 = t2 + 1000

      await core.recordEvent({ type: 'START', timestamp: t1 })
      await core.recordEvent({ type: 'MIDDLE', timestamp: t2 })
      await core.recordEvent({ type: 'END', timestamp: t3 })

      // Query at t2 should only include events up to t2
      const historyAtT2 = await core.getHistoryAsOf(t2)
      expect(historyAtT2).toHaveLength(2)
      expect(historyAtT2[0]?.type).toBe('START')
      expect(historyAtT2[1]?.type).toBe('MIDDLE')

      // Query at t1 should only include the first event
      const historyAtT1 = await core.getHistoryAsOf(t1)
      expect(historyAtT1).toHaveLength(1)
    })

    it('should track history length', async () => {
      expect(await core.getHistoryLength()).toBe(0)

      await core.recordEvent({ type: 'EVENT_1', timestamp: Date.now() })
      expect(await core.getHistoryLength()).toBe(1)

      await core.recordEvent({ type: 'EVENT_2', timestamp: Date.now() + 1 })
      expect(await core.getHistoryLength()).toBe(2)
    })
  })

  describe('History Snapshots', () => {
    it('should create and restore history snapshots', async () => {
      const t1 = Date.now()
      await core.recordEvent({ type: 'EVENT_1', timestamp: t1 })
      await core.recordEvent({ type: 'EVENT_2', timestamp: t1 + 100 })

      // Create snapshot
      const snapshotId = await core.snapshotHistory()
      expect(snapshotId).toBeDefined()

      // Add more events
      await core.recordEvent({ type: 'EVENT_3', timestamp: t1 + 200 })
      await core.recordEvent({ type: 'EVENT_4', timestamp: t1 + 300 })
      expect(await core.getHistoryLength()).toBe(4)

      // Restore snapshot
      await core.restoreHistorySnapshot(snapshotId)
      expect(await core.getHistoryLength()).toBe(2)

      const history = await core.getHistory()
      expect(history[0]?.type).toBe('EVENT_1')
      expect(history[1]?.type).toBe('EVENT_2')
    })

    it('should support snapshot for Continue-As-New pattern', async () => {
      const baseTime = Date.now()

      // Simulate long-running workflow
      for (let i = 0; i < 50; i++) {
        await core.recordEvent({
          type: 'STEP_COMPLETED',
          timestamp: baseTime + i * 100,
          stepId: `step-${i}`,
        })
      }

      // Snapshot before compaction
      const snapshotId = await core.snapshotHistory()

      // Prune for Continue-As-New
      const stats = await core.pruneHistory({ maxVersions: 5 })
      expect(stats.versionsRemoved).toBe(45)
      expect(await core.getHistoryLength()).toBe(5)

      // Can restore full history from snapshot
      await core.restoreHistorySnapshot(snapshotId)
      expect(await core.getHistoryLength()).toBe(50)
    })
  })

  describe('Retention Policies', () => {
    it('should prune history based on maxVersions', async () => {
      const baseTime = Date.now()
      for (let i = 0; i < 20; i++) {
        await core.recordEvent({
          type: 'EVENT',
          timestamp: baseTime + i,
          index: i,
        })
      }

      const stats = await core.pruneHistory({ maxVersions: 5 })
      expect(stats.versionsRemoved).toBe(15)
      expect(await core.getHistoryLength()).toBe(5)

      const history = await core.getHistory()
      expect(history[0]?.index).toBe(15) // Last 5 events
    })

    it('should accept history retention in options', async () => {
      const customCore = createWorkflowCore({
        workflowId: 'retention-test',
        historyRetention: { maxVersions: 10, maxAge: '24h' },
      })

      // Record events
      const baseTime = Date.now()
      for (let i = 0; i < 15; i++) {
        await customCore.recordEvent({
          type: 'EVENT',
          timestamp: baseTime + i,
        })
      }

      // Prune without specifying policy (uses default)
      const stats = await customCore.pruneHistory()
      expect(stats.versionsRemoved).toBe(5)

      customCore.dispose()
    })
  })
})

describe('WorkflowCore Factory', () => {
  it('should create a WorkflowCore instance', () => {
    const core = createWorkflowCore({ workflowId: 'factory-test' })
    expect(core).toBeInstanceOf(WorkflowCore)
    core.dispose()
  })

  it('should require workflowId', () => {
    // @ts-expect-error - Testing missing required option
    expect(() => createWorkflowCore({})).toThrow()
  })
})
