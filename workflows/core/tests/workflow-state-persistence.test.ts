/**
 * Workflow State Persistence Tests
 *
 * Tests for durable workflow state management including:
 * - Lifecycle operations
 * - Step checkpointing
 * - Recovery from failures
 * - State versioning
 *
 * Uses mock DurableObjectStorage following existing patterns in the codebase.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  WorkflowStatePersistence,
  createWorkflowStatePersistence,
  type WorkflowCheckpoint,
  type RecoveryResult,
} from '../workflow-state-persistence'

// ============================================================================
// MOCK DO STATE
// ============================================================================

function createMockStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T>(key: string): Promise<T | undefined> => storage.get(key) as T | undefined),
    put: vi.fn(async (key: string, value: unknown) => {
      storage.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      storage.delete(key)
    }),
    list: vi.fn(async <T>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      for (const [key, value] of storage) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    }),
    _storage: storage, // Expose for test inspection
  }
}

function createMockState() {
  const mockStorage = createMockStorage()
  return {
    id: { toString: () => 'test-do-id' },
    storage: mockStorage,
    _storage: mockStorage._storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { _storage: Map<string, unknown> }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('WorkflowStatePersistence', () => {
  let state: WorkflowStatePersistence
  let doState: ReturnType<typeof createMockState>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T12:00:00.000Z'))

    doState = createMockState()
    state = createWorkflowStatePersistence(doState, {
      workflowId: 'test-workflow-001',
      workflowName: 'TestWorkflow',
      input: { userId: 'user-123', action: 'process' },
    })
  })

  afterEach(() => {
    state?.dispose()
    vi.useRealTimers()
  })

  // ==========================================================================
  // LIFECYCLE OPERATIONS
  // ==========================================================================

  describe('Lifecycle Operations', () => {
    it('initializes with pending status', async () => {
      await state.initialize()

      expect(state.getStatus()).toBe('pending')
      expect(state.getCurrentStepIndex()).toBe(0)
      expect(state.getEpoch()).toBe(1)
    })

    it('transitions from pending to running on start', async () => {
      await state.initialize()
      await state.start()

      expect(state.getStatus()).toBe('running')
    })

    it('throws when starting from non-pending status', async () => {
      await state.initialize()
      await state.start()

      await expect(state.start()).rejects.toThrow('Cannot start workflow in running status')
    })

    it('pauses running workflow', async () => {
      await state.initialize()
      await state.start()
      await state.pause(['event:approval-required'])

      expect(state.getStatus()).toBe('paused')
      expect(state.getPendingEvents()).toEqual(['event:approval-required'])
    })

    it('resumes paused workflow', async () => {
      await state.initialize()
      await state.start()
      await state.pause()
      await state.resume()

      expect(state.getStatus()).toBe('running')
      expect(state.getPendingEvents()).toEqual([])
    })

    it('increments epoch on resume', async () => {
      await state.initialize()
      await state.start()

      const initialEpoch = state.getEpoch()
      await state.pause()
      await state.resume()

      expect(state.getEpoch()).toBe(initialEpoch + 1)
    })

    it('completes workflow with output', async () => {
      await state.initialize()
      await state.start()
      await state.complete({ success: true, orderId: 'ORD-123' })

      expect(state.getStatus()).toBe('completed')
      expect(state.getOutput()).toEqual({ success: true, orderId: 'ORD-123' })
    })

    it('fails workflow with error', async () => {
      await state.initialize()
      await state.start()
      const error = new Error('Payment processing failed')
      await state.fail(error)

      expect(state.getStatus()).toBe('failed')
      expect(state.getError()?.message).toBe('Payment processing failed')
      expect(state.getError()?.name).toBe('Error')
    })

    it('cancels workflow', async () => {
      await state.initialize()
      await state.start()
      await state.cancel()

      expect(state.getStatus()).toBe('cancelled')
    })

    it('throws when completing non-running workflow', async () => {
      await state.initialize()

      await expect(state.complete({ done: true })).rejects.toThrow(
        'Cannot complete workflow in pending status'
      )
    })

    it('throws when cancelling completed workflow', async () => {
      await state.initialize()
      await state.start()
      await state.complete({ done: true })

      await expect(state.cancel()).rejects.toThrow('Cannot cancel workflow in completed status')
    })
  })

  // ==========================================================================
  // STEP OPERATIONS
  // ==========================================================================

  describe('Step Operations', () => {
    beforeEach(async () => {
      await state.initialize()
      await state.start()
    })

    it('records step start', async () => {
      await state.recordStepStart('validateOrder', 0)

      const result = await state.getStepResult('validateOrder')
      expect(result).toBeDefined()
      expect(result?.status).toBe('running')
      expect(result?.stepIndex).toBe(0)
      expect(result?.startedAt).toBeDefined()
    })

    it('records step completion', async () => {
      await state.recordStepStart('validateOrder', 0)
      await state.recordStepComplete('validateOrder', { valid: true, amount: 99.99 }, 150)

      const result = await state.getStepResult('validateOrder')
      expect(result?.status).toBe('completed')
      expect(result?.duration).toBe(150)
      expect(result?.completedAt).toBeDefined()

      const output = await state.getStepOutput<{ valid: boolean }>('validateOrder')
      expect(output).toEqual({ valid: true, amount: 99.99 })
    })

    it('records step failure', async () => {
      await state.recordStepStart('chargePayment', 1)
      const error = new Error('Insufficient funds')
      await state.recordStepFailed('chargePayment', error, 2, 500)

      const result = await state.getStepResult('chargePayment')
      expect(result?.status).toBe('failed')
      expect(result?.error?.message).toBe('Insufficient funds')
      expect(result?.retryCount).toBe(2)
      expect(result?.duration).toBe(500)
    })

    it('records skipped step', async () => {
      await state.recordStepSkipped('optionalStep', 2)

      const result = await state.getStepResult('optionalStep')
      expect(result?.status).toBe('skipped')
      expect(result?.stepIndex).toBe(2)
    })

    it('tracks current step index', async () => {
      expect(state.getCurrentStepIndex()).toBe(0)

      await state.recordStepStart('step1', 0)
      await state.recordStepComplete('step1', 'done')

      expect(state.getCurrentStepIndex()).toBe(1)

      await state.recordStepStart('step2', 1)
      await state.recordStepComplete('step2', 'done')

      expect(state.getCurrentStepIndex()).toBe(2)
    })

    it('checks if step is completed', async () => {
      await state.recordStepStart('myStep', 0)
      expect(await state.isStepCompleted('myStep')).toBe(false)

      await state.recordStepComplete('myStep', { result: 'ok' })
      expect(await state.isStepCompleted('myStep')).toBe(true)
    })

    it('returns undefined for unknown step output', async () => {
      const output = await state.getStepOutput('nonexistent')
      expect(output).toBeUndefined()
    })

    it('throws when completing unknown step', async () => {
      await expect(state.recordStepComplete('unknownStep', {})).rejects.toThrow(
        'Step unknownStep not found'
      )
    })

    it('returns all step results', async () => {
      await state.recordStepStart('step1', 0)
      await state.recordStepComplete('step1', 'result1')
      await state.recordStepStart('step2', 1)
      await state.recordStepComplete('step2', 'result2')

      const allResults = state.getAllStepResults()
      expect(allResults).toHaveLength(2)
      expect(allResults.map((r) => r.stepName).sort()).toEqual(['step1', 'step2'])
    })
  })

  // ==========================================================================
  // CHECKPOINTING
  // ==========================================================================

  describe('Checkpointing', () => {
    it('creates checkpoint with current state', async () => {
      await state.initialize()
      await state.start()
      await state.recordStepStart('step1', 0)
      await state.recordStepComplete('step1', { data: 'value' })

      const checkpointId = await state.checkpoint()

      expect(checkpointId).toContain('test-workflow-001')
      expect(state.hasPendingChanges()).toBe(false)
    })

    it('stores checkpoint in history', async () => {
      await state.initialize()
      await state.start()
      await state.checkpoint()
      await state.checkpoint()
      await state.checkpoint()

      const history = await state.getCheckpointHistory()
      expect(history.length).toBeGreaterThanOrEqual(3)
    })

    it('retrieves specific checkpoint', async () => {
      await state.initialize()
      await state.start()
      const checkpointId = await state.checkpoint()

      const checkpoint = await state.getCheckpoint(checkpointId)

      expect(checkpoint).not.toBeNull()
      expect(checkpoint?.workflowId).toBe('test-workflow-001')
      expect(checkpoint?.status).toBe('running')
    })

    it('prunes old checkpoints beyond max history', async () => {
      const smallHistoryDoState = createMockState()
      const smallHistoryState = createWorkflowStatePersistence(smallHistoryDoState, {
        workflowId: 'prune-test',
        workflowName: 'PruneTest',
        maxCheckpointHistory: 3,
      })

      await smallHistoryState.initialize()
      await smallHistoryState.start()

      // Create more checkpoints than max
      for (let i = 0; i < 5; i++) {
        await smallHistoryState.recordStepStart(`step${i}`, i)
        await smallHistoryState.recordStepComplete(`step${i}`, i)
        await smallHistoryState.checkpoint()
      }

      const history = await smallHistoryState.getCheckpointHistory()
      expect(history.length).toBeLessThanOrEqual(3)

      smallHistoryState.dispose()
    })
  })

  // ==========================================================================
  // RECOVERY
  // ==========================================================================

  describe('Recovery', () => {
    it('recovers from latest checkpoint', async () => {
      // Execute workflow partially
      await state.initialize()
      await state.start()
      await state.recordStepStart('step1', 0)
      await state.recordStepComplete('step1', { result: 'one' })
      await state.recordStepStart('step2', 1)
      await state.recordStepComplete('step2', { result: 'two' })
      await state.checkpoint()

      // Simulate DO restart - create new state instance with same workflowId
      const recoveredState = createWorkflowStatePersistence(doState, {
        workflowId: 'test-workflow-001',
        workflowName: 'TestWorkflow',
      })

      const recovery = await recoveredState.recover()

      expect(recovery.recovered).toBe(true)
      expect(recovery.resumeFromStep).toBe(2)
      expect(recoveredState.getStatus()).toBe('running')
      expect(await recoveredState.isStepCompleted('step1')).toBe(true)
      expect(await recoveredState.isStepCompleted('step2')).toBe(true)

      recoveredState.dispose()
    })

    it('returns not recovered when no checkpoint exists', async () => {
      const freshDoState = createMockState()
      const freshState = createWorkflowStatePersistence(freshDoState, {
        workflowId: 'nonexistent-workflow',
        workflowName: 'TestWorkflow',
      })

      const recovery = await freshState.recover()

      expect(recovery.recovered).toBe(false)
      expect(recovery.checkpoint).toBeNull()
      expect(recovery.pendingSteps).toEqual([])
      expect(recovery.resumeFromStep).toBe(0)

      freshState.dispose()
    })

    it('identifies pending steps during recovery', async () => {
      await state.initialize()
      await state.start()
      await state.recordStepStart('step1', 0)
      await state.recordStepComplete('step1', 'done')
      await state.recordStepStart('step2', 1) // Started but not completed
      await state.checkpoint()

      const recoveredState = createWorkflowStatePersistence(doState, {
        workflowId: 'test-workflow-001',
        workflowName: 'TestWorkflow',
      })

      const recovery = await recoveredState.recover()

      expect(recovery.pendingSteps).toContain('step2')

      recoveredState.dispose()
    })

    it('recovers from specific checkpoint by ID', async () => {
      await state.initialize()
      await state.start()

      await state.recordStepStart('step1', 0)
      await state.recordStepComplete('step1', 'result1')
      const checkpoint1Id = await state.checkpoint()

      await state.recordStepStart('step2', 1)
      await state.recordStepComplete('step2', 'result2')
      await state.checkpoint()

      // Create new state and recover from first checkpoint
      const recoveredState = createWorkflowStatePersistence(doState, {
        workflowId: 'test-workflow-001',
        workflowName: 'TestWorkflow',
      })

      const recovery = await recoveredState.recoverFromCheckpoint(checkpoint1Id)

      expect(recovery.recovered).toBe(true)
      expect(recovery.resumeFromStep).toBe(1) // Only step1 was completed in checkpoint1
      expect(await recoveredState.isStepCompleted('step1')).toBe(true)
      expect(await recoveredState.isStepCompleted('step2')).toBe(false)

      recoveredState.dispose()
    })

    it('throws when recovering from nonexistent checkpoint', async () => {
      await expect(state.recoverFromCheckpoint('nonexistent-checkpoint')).rejects.toThrow(
        'Checkpoint nonexistent-checkpoint not found'
      )
    })
  })

  // ==========================================================================
  // STATE VERSIONING
  // ==========================================================================

  describe('State Versioning', () => {
    it('applies patches', () => {
      expect(state.applyPatch('patch-001')).toBe(true)
      expect(state.isPatchApplied('patch-001')).toBe(true)
    })

    it('prevents duplicate patch application', () => {
      state.applyPatch('patch-001')
      expect(state.applyPatch('patch-001')).toBe(false)
    })

    it('tracks all applied patches', () => {
      state.applyPatch('patch-001')
      state.applyPatch('patch-002')
      state.applyPatch('patch-003')

      expect(state.getAppliedPatches().sort()).toEqual(['patch-001', 'patch-002', 'patch-003'])
    })

    it('persists patches in checkpoint', async () => {
      await state.initialize()
      await state.start()
      state.applyPatch('patch-v1-add-field')
      state.applyPatch('patch-v2-rename-column')
      const checkpointId = await state.checkpoint()

      const checkpoint = await state.getCheckpoint(checkpointId)
      expect(checkpoint?.appliedPatches).toContain('patch-v1-add-field')
      expect(checkpoint?.appliedPatches).toContain('patch-v2-rename-column')
    })

    it('restores patches on recovery', async () => {
      await state.initialize()
      await state.start()
      state.applyPatch('important-migration')
      await state.checkpoint()

      const recoveredState = createWorkflowStatePersistence(doState, {
        workflowId: 'test-workflow-001',
        workflowName: 'TestWorkflow',
      })

      await recoveredState.recover()

      expect(recoveredState.isPatchApplied('important-migration')).toBe(true)

      recoveredState.dispose()
    })

    it('throws on incompatible version recovery', async () => {
      // Create checkpoint with current version
      await state.initialize()
      await state.checkpoint()

      // Manually modify checkpoint to have future version
      const latestKey = 'workflow-state:test-workflow-001:latest'
      const checkpoint = doState._storage.get(latestKey) as WorkflowCheckpoint | undefined
      if (checkpoint) {
        checkpoint.version = 999
        doState._storage.set(latestKey, checkpoint)
      }

      // Try to recover - should fail due to version mismatch
      const newState = createWorkflowStatePersistence(doState, {
        workflowId: 'test-workflow-001',
        workflowName: 'TestWorkflow',
        schemaVersion: 1,
      })

      await expect(newState.recover()).rejects.toThrow(
        'Checkpoint version 999 is newer than supported version 1'
      )

      newState.dispose()
    })
  })

  // ==========================================================================
  // INPUT/OUTPUT
  // ==========================================================================

  describe('Input/Output', () => {
    it('stores and retrieves input', () => {
      const input = { orderId: 'ORD-123', items: [1, 2, 3] }
      const freshDoState = createMockState()
      const stateWithInput = createWorkflowStatePersistence(freshDoState, {
        workflowId: 'input-test',
        workflowName: 'InputTest',
        input,
      })

      expect(stateWithInput.getInput()).toEqual(input)

      stateWithInput.dispose()
    })

    it('allows setting input before start', async () => {
      await state.initialize()
      state.setInput({ newInput: 'value' })

      expect(state.getInput()).toEqual({ newInput: 'value' })
    })

    it('prevents setting input after start', async () => {
      await state.initialize()
      await state.start()

      expect(() => state.setInput({ invalid: true })).toThrow(
        'Cannot set input after workflow has started'
      )
    })
  })

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  describe('Cleanup', () => {
    it('clears all workflow state', async () => {
      await state.initialize()
      await state.start()
      await state.recordStepStart('step1', 0)
      await state.recordStepComplete('step1', 'done')
      await state.checkpoint()

      await state.clear()

      expect(state.getStatus()).toBe('pending')
      expect(state.getCurrentStepIndex()).toBe(0)
      expect(state.getAllStepResults()).toHaveLength(0)

      // Verify storage is cleared
      const history = await state.getCheckpointHistory()
      expect(history).toHaveLength(0)
    })

    it('disposes of auto-checkpoint timer', async () => {
      const autoCheckpointDoState = createMockState()
      const autoCheckpointState = createWorkflowStatePersistence(autoCheckpointDoState, {
        workflowId: 'auto-checkpoint-test',
        workflowName: 'AutoCheckpointTest',
        autoCheckpointInterval: 100, // 100ms
      })

      await autoCheckpointState.initialize()
      await autoCheckpointState.start()

      // Let it run briefly
      vi.advanceTimersByTime(50)

      // Dispose should clear the timer without errors
      autoCheckpointState.dispose()
    })
  })

  // ==========================================================================
  // ERROR SERIALIZATION
  // ==========================================================================

  describe('Error Serialization', () => {
    beforeEach(async () => {
      await state.initialize()
      await state.start()
    })

    it('serializes error with stack trace', async () => {
      const error = new Error('Something went wrong')
      await state.fail(error)

      expect(state.getError()?.message).toBe('Something went wrong')
      expect(state.getError()?.name).toBe('Error')
      expect(state.getError()?.stack).toBeDefined()
    })

    it('serializes nested error cause', async () => {
      const cause = new Error('Root cause')
      const error = new Error('Outer error', { cause })
      await state.fail(error)

      expect(state.getError()?.cause?.message).toBe('Root cause')
    })

    it('preserves error in step failures', async () => {
      await state.recordStepStart('failingStep', 0)
      const error = new TypeError('Invalid input type')
      await state.recordStepFailed('failingStep', error)

      const result = await state.getStepResult('failingStep')
      expect(result?.error?.message).toBe('Invalid input type')
      expect(result?.error?.name).toBe('TypeError')
    })
  })

  // ==========================================================================
  // METADATA
  // ==========================================================================

  describe('Metadata', () => {
    it('stores custom metadata in checkpoint', async () => {
      const metadataDoState = createMockState()
      const metadataState = createWorkflowStatePersistence(metadataDoState, {
        workflowId: 'metadata-test',
        workflowName: 'MetadataTest',
        metadata: {
          tenant: 'acme-corp',
          region: 'us-east-1',
          priority: 'high',
        },
      })

      await metadataState.initialize()
      const checkpointId = await metadataState.checkpoint()

      const checkpoint = await metadataState.getCheckpoint(checkpointId)
      expect(checkpoint?.metadata).toEqual({
        tenant: 'acme-corp',
        region: 'us-east-1',
        priority: 'high',
      })

      metadataState.dispose()
    })
  })

  // ==========================================================================
  // INTEGRATION WITH STEP STORAGE
  // ==========================================================================

  describe('StepResultStorage Integration', () => {
    beforeEach(async () => {
      await state.initialize()
      await state.start()
    })

    it('provides access to underlying StepResultStorage', () => {
      const stepStorage = state.getStepStorage()
      expect(stepStorage).toBeDefined()
    })

    it('persists steps to StepResultStorage', async () => {
      await state.recordStepStart('myStep', 0)
      await state.recordStepComplete('myStep', { key: 'value' })

      const stepStorage = state.getStepStorage()
      const storedResult = await stepStorage.get('myStep')

      expect(storedResult).toBeDefined()
      expect(storedResult?.status).toBe('completed')
    })
  })

  // ==========================================================================
  // DURABLE EXECUTION SCENARIOS
  // ==========================================================================

  describe('Durable Execution Scenarios', () => {
    it('survives DO restart mid-workflow', async () => {
      // Start workflow and complete first step
      await state.initialize()
      await state.start()
      await state.recordStepStart('step1', 0)
      await state.recordStepComplete('step1', { value: 'first' })
      await state.checkpoint()

      // Simulate DO restart
      const restoredState = createWorkflowStatePersistence(doState, {
        workflowId: 'test-workflow-001',
        workflowName: 'TestWorkflow',
      })

      const recovery = await restoredState.recover()
      expect(recovery.recovered).toBe(true)
      expect(recovery.resumeFromStep).toBe(1)

      // Continue workflow from where we left off
      await restoredState.recordStepStart('step2', 1)
      await restoredState.recordStepComplete('step2', { value: 'second' })
      await restoredState.complete({ total: 2 })

      expect(restoredState.getStatus()).toBe('completed')
      expect(restoredState.getOutput()).toEqual({ total: 2 })

      restoredState.dispose()
    })

    it('replays completed steps instead of re-executing', async () => {
      await state.initialize()
      await state.start()

      // Complete steps
      await state.recordStepStart('idempotentStep', 0)
      await state.recordStepComplete('idempotentStep', { computedValue: 42 })
      await state.checkpoint()

      // Simulate restart
      const restoredState = createWorkflowStatePersistence(doState, {
        workflowId: 'test-workflow-001',
        workflowName: 'TestWorkflow',
      })

      await restoredState.recover()

      // Step should already be completed - can get cached output
      expect(await restoredState.isStepCompleted('idempotentStep')).toBe(true)
      const cachedOutput = await restoredState.getStepOutput('idempotentStep')
      expect(cachedOutput).toEqual({ computedValue: 42 })

      restoredState.dispose()
    })

    it('handles failure at arbitrary checkpoint', async () => {
      await state.initialize()
      await state.start()

      // Complete some steps
      await state.recordStepStart('step1', 0)
      await state.recordStepComplete('step1', 'ok')
      await state.recordStepStart('step2', 1)
      await state.recordStepComplete('step2', 'ok')

      // Step 3 fails
      await state.recordStepStart('step3', 2)
      const error = new Error('External service unavailable')
      await state.recordStepFailed('step3', error, 3)
      await state.checkpoint()

      // Restart and check state
      const restoredState = createWorkflowStatePersistence(doState, {
        workflowId: 'test-workflow-001',
        workflowName: 'TestWorkflow',
      })

      const recovery = await restoredState.recover()
      expect(recovery.recovered).toBe(true)

      const step3Result = await restoredState.getStepResult('step3')
      expect(step3Result?.status).toBe('failed')
      expect(step3Result?.retryCount).toBe(3)
      expect(step3Result?.error?.message).toBe('External service unavailable')

      restoredState.dispose()
    })

    it('maintains exactly-once semantics across epochs', async () => {
      await state.initialize()
      await state.start()

      const initialEpoch = state.getEpoch()

      // Pause for event
      await state.pause(['event:approval'])
      await state.checkpoint()

      // Resume (increments epoch)
      await state.resume()
      expect(state.getEpoch()).toBe(initialEpoch + 1)

      // Pause again
      await state.pause(['event:confirmation'])
      await state.checkpoint()

      // Resume again
      await state.resume()
      expect(state.getEpoch()).toBe(initialEpoch + 2)

      // Epoch persists across restart
      const restoredState = createWorkflowStatePersistence(doState, {
        workflowId: 'test-workflow-001',
        workflowName: 'TestWorkflow',
      })

      await restoredState.recover()
      expect(restoredState.getEpoch()).toBe(initialEpoch + 2)

      restoredState.dispose()
    })
  })
})
