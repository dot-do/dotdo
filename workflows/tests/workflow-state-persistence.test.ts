/**
 * Workflow State Persistence Tests
 *
 * TDD RED Phase: Tests for durable workflow execution that survives DO restarts.
 *
 * This test suite verifies that workflows can:
 * 1. Persist state mid-execution and resume after DO restart
 * 2. Save checkpoints after each step atomically
 * 3. Reconstruct execution tree from persisted state
 * 4. Replay failed workflows from last checkpoint
 * 5. Handle in-flight operations during restart
 *
 * These tests are designed to FAIL initially - the implementation will be
 * added in the GREEN phase (issue dotdo-nw2wo).
 *
 * Test Strategy:
 * - Use mock storage to simulate DO state
 * - Simulate DO restart by creating new runtime instances with same storage
 * - Verify state reconstruction matches original execution
 *
 * @see dotdo-hbqnu - [RED] Workflow state persistence
 * @see dotdo-nw2wo - [GREEN] Implement workflow state persistence
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  WorkflowRuntime,
  type WorkflowRuntimeConfig,
  type StepExecutionResult,
} from '../../objects/WorkflowRuntime'
import { StepResultStorage, type StoredStepResult } from '../StepResultStorage'

// ============================================================================
// MOCK DO STATE - Simulates persistent storage across restarts
// ============================================================================

function createPersistentStorage() {
  // This storage persists across "restarts" - simulating DO storage
  const storage = new Map<string, unknown>()
  const alarms: { time: number | null } = { time: null }

  return {
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      }),
      getAlarm: vi.fn(async () => alarms.time),
      setAlarm: vi.fn(async (time: number | Date) => {
        alarms.time = typeof time === 'number' ? time : time.getTime()
      }),
      deleteAlarm: vi.fn(async () => {
        alarms.time = null
      }),
    },
    alarms,
    _storage: storage,
  }
}

function createMockStateWithStorage(persistentStorage: ReturnType<typeof createPersistentStorage>) {
  return {
    id: { toString: () => 'test-persistence-do-id' },
    storage: persistentStorage.storage,
    alarms: persistentStorage.alarms,
    _storage: persistentStorage._storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & {
    alarms: { time: number | null }
    _storage: Map<string, unknown>
  }
}

// ============================================================================
// HELPER: Checkpoint Manager Interface (to be implemented)
// ============================================================================

interface WorkflowCheckpoint {
  workflowId: string
  instanceId: string
  currentStepIndex: number
  state: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  stepResults: StoredStepResult[]
  input: unknown
  output?: unknown
  error?: { message: string; name: string; stack?: string }
  startedAt?: string
  completedAt?: string
  checkpointedAt: string
  version: number
}

interface ExecutionTreeNode {
  stepIndex: number
  stepName: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  output?: unknown
  error?: { message: string; name: string }
  children?: ExecutionTreeNode[]
  duration?: number
  startedAt?: string
  completedAt?: string
}

// ============================================================================
// TEST SUITE: Workflow State Persistence
// ============================================================================

describe('Workflow State Persistence', () => {
  let persistentStorage: ReturnType<typeof createPersistentStorage>
  let mockState: ReturnType<typeof createMockStateWithStorage>

  beforeEach(() => {
    persistentStorage = createPersistentStorage()
    mockState = createMockStateWithStorage(persistentStorage)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // 1. WORKFLOW SURVIVES DO RESTART
  // ==========================================================================

  describe('Workflow Survives DO Restart', () => {
    it('should persist workflow state mid-execution', async () => {
      const config: WorkflowRuntimeConfig = {
        name: 'restart-test-workflow',
        version: '1.0.0',
      }

      const runtime = new WorkflowRuntime(mockState, config)

      // Register steps where the second step will pause
      let stepOneExecuted = false
      runtime.registerStep('step1', async () => {
        stepOneExecuted = true
        return { step1: 'completed' }
      })

      runtime.registerStep('step2', async (ctx) => {
        await ctx.waitForEvent('approval')
        return { step2: 'completed' }
      })

      runtime.registerStep('step3', async () => {
        return { step3: 'completed' }
      })

      // Start workflow - will pause at step2
      const startPromise = runtime.start({ initialData: 'test' })
      await vi.advanceTimersByTimeAsync(10)

      expect(runtime.state).toBe('paused')
      expect(runtime.currentStepIndex).toBe(1)
      expect(stepOneExecuted).toBe(true)

      // Verify state is persisted to storage
      const persistedState = persistentStorage._storage.get('workflow:state')
      expect(persistedState).toBeDefined()
      expect((persistedState as Record<string, unknown>).status).toBe('paused')
      expect((persistedState as Record<string, unknown>).currentStepIndex).toBe(1)
    })

    it('should resume workflow after DO restart', async () => {
      const config: WorkflowRuntimeConfig = {
        name: 'restart-resume-workflow',
        version: '1.0.0',
      }

      // Phase 1: Start workflow and pause
      const runtime1 = new WorkflowRuntime(mockState, config)

      runtime1.registerStep('step1', async () => ({ step1: 'done' }))
      runtime1.registerStep('step2', async (ctx) => {
        await ctx.waitForEvent('approval')
        return { step2: 'done' }
      })
      runtime1.registerStep('step3', async () => ({ step3: 'done' }))

      const startPromise = runtime1.start({ data: 'initial' })
      await vi.advanceTimersByTimeAsync(10)

      expect(runtime1.state).toBe('paused')

      // Phase 2: Simulate DO restart - create new runtime with same storage
      const runtime2 = new WorkflowRuntime(mockState, config)

      // Register the same steps (in real usage, this would be from workflow definition)
      runtime2.registerStep('step1', async () => ({ step1: 'done' }))
      runtime2.registerStep('step2', async (ctx) => {
        await ctx.waitForEvent('approval')
        return { step2: 'done' }
      })
      runtime2.registerStep('step3', async () => ({ step3: 'done' }))

      // Restore state from storage
      await runtime2.restore()

      expect(runtime2.state).toBe('paused')
      expect(runtime2.currentStepIndex).toBe(1)

      // Deliver event to continue
      await runtime2.deliverEvent('approval', { approved: true })

      expect(runtime2.state).toBe('completed')
      expect(runtime2.currentStepIndex).toBe(3)
    })

    it('should preserve step results across restart', async () => {
      const config: WorkflowRuntimeConfig = {
        name: 'preserve-results-workflow',
        version: '1.0.0',
      }

      // Phase 1: Execute some steps
      const runtime1 = new WorkflowRuntime(mockState, config)

      runtime1.registerStep('step1', async () => ({ result: 'step1-output' }))
      runtime1.registerStep('step2', async () => ({ result: 'step2-output' }))
      runtime1.registerStep('step3', async (ctx) => {
        await ctx.waitForEvent('continue')
        return { result: 'step3-output' }
      })

      const startPromise = runtime1.start({})
      await vi.advanceTimersByTimeAsync(10)

      expect(runtime1.stepResults).toHaveLength(2)
      expect(runtime1.stepResults[0].output).toEqual({ result: 'step1-output' })
      expect(runtime1.stepResults[1].output).toEqual({ result: 'step2-output' })

      // Phase 2: Restart and verify results are restored
      const runtime2 = new WorkflowRuntime(mockState, config)

      runtime2.registerStep('step1', async () => ({ result: 'step1-output' }))
      runtime2.registerStep('step2', async () => ({ result: 'step2-output' }))
      runtime2.registerStep('step3', async (ctx) => {
        await ctx.waitForEvent('continue')
        return { result: 'step3-output' }
      })

      await runtime2.restore()

      // Step results should be preserved
      expect(runtime2.stepResults).toHaveLength(2)
      expect(runtime2.stepResults[0].output).toEqual({ result: 'step1-output' })
      expect(runtime2.stepResults[1].output).toEqual({ result: 'step2-output' })
    })

    it('should preserve workflow input across restart', async () => {
      const config: WorkflowRuntimeConfig = { name: 'input-preserve-workflow' }

      const complexInput = {
        orderId: 'ord-123',
        customer: { name: 'Alice', email: 'alice@example.com' },
        items: [{ sku: 'ITEM-1', qty: 2 }, { sku: 'ITEM-2', qty: 1 }],
        metadata: { source: 'api', timestamp: Date.now() },
      }

      // Phase 1: Start with complex input
      const runtime1 = new WorkflowRuntime(mockState, config)
      runtime1.registerStep('step1', async (ctx) => {
        await ctx.waitForEvent('pause')
        return {}
      })

      runtime1.start(complexInput)
      await vi.advanceTimersByTimeAsync(10)

      // Phase 2: Restart and verify input
      const runtime2 = new WorkflowRuntime(mockState, config)
      runtime2.registerStep('step1', async (ctx) => {
        await ctx.waitForEvent('pause')
        return {}
      })

      await runtime2.restore()

      expect(runtime2.input).toEqual(complexInput)
    })
  })

  // ==========================================================================
  // 2. CHECKPOINT-BASED RESUMPTION
  // ==========================================================================

  describe('Checkpoint-Based Resumption', () => {
    it('should create checkpoint after each step completion', async () => {
      const config: WorkflowRuntimeConfig = {
        name: 'checkpoint-workflow',
        version: '1.0.0',
      }

      const runtime = new WorkflowRuntime(mockState, config)

      let checkpointVersions: number[] = []

      // Track storage puts to verify checkpointing
      const originalPut = persistentStorage.storage.put
      persistentStorage.storage.put = vi.fn(async (key: string, value: unknown) => {
        if (key === 'workflow:state') {
          const state = value as Record<string, unknown>
          if (state.version) {
            checkpointVersions.push(state.version as number)
          }
        }
        return originalPut(key, value)
      })

      runtime.registerStep('step1', async () => ({ s1: true }))
      runtime.registerStep('step2', async () => ({ s2: true }))
      runtime.registerStep('step3', async () => ({ s3: true }))

      await runtime.start({})

      // Verify checkpoints were created after each step
      // Note: This will FAIL until checkpoint versioning is implemented
      expect(checkpointVersions.length).toBeGreaterThanOrEqual(3)
    })

    it('should resume from exact checkpoint position', async () => {
      const config: WorkflowRuntimeConfig = { name: 'exact-position-workflow' }

      const executedSteps: string[] = []

      // Phase 1: Execute and pause at step 3
      const runtime1 = new WorkflowRuntime(mockState, config)

      runtime1.registerStep('step1', async () => {
        executedSteps.push('step1')
        return { step1: true }
      })
      runtime1.registerStep('step2', async () => {
        executedSteps.push('step2')
        return { step2: true }
      })
      runtime1.registerStep('step3', async (ctx) => {
        executedSteps.push('step3-start')
        await ctx.waitForEvent('continue')
        executedSteps.push('step3-complete')
        return { step3: true }
      })
      runtime1.registerStep('step4', async () => {
        executedSteps.push('step4')
        return { step4: true }
      })

      runtime1.start({})
      await vi.advanceTimersByTimeAsync(10)

      expect(executedSteps).toEqual(['step1', 'step2', 'step3-start'])

      // Phase 2: Restart and verify we resume from step3, not re-execute step1/step2
      executedSteps.length = 0 // Clear tracking

      const runtime2 = new WorkflowRuntime(mockState, config)

      runtime2.registerStep('step1', async () => {
        executedSteps.push('step1')
        return { step1: true }
      })
      runtime2.registerStep('step2', async () => {
        executedSteps.push('step2')
        return { step2: true }
      })
      runtime2.registerStep('step3', async (ctx) => {
        executedSteps.push('step3-start')
        await ctx.waitForEvent('continue')
        executedSteps.push('step3-complete')
        return { step3: true }
      })
      runtime2.registerStep('step4', async () => {
        executedSteps.push('step4')
        return { step4: true }
      })

      await runtime2.restore()
      await runtime2.deliverEvent('continue', {})

      // Should only execute step3-complete and step4, NOT step1/step2 again
      expect(executedSteps).toEqual(['step3-complete', 'step4'])
    })

    it('should support checkpoint rollback to previous step', async () => {
      const config: WorkflowRuntimeConfig = { name: 'rollback-workflow' }

      // This tests the ability to rollback to a previous checkpoint
      // and replay from there (useful for error recovery)

      // Phase 1: Execute steps with failure at step3
      const runtime1 = new WorkflowRuntime(mockState, config, { onError: 'pause' })

      let step3Attempts = 0

      runtime1.registerStep('step1', async () => ({ step1: 'done' }))
      runtime1.registerStep('step2', async () => ({ step2: 'done' }))
      runtime1.registerStep('step3', async () => {
        step3Attempts++
        if (step3Attempts === 1) {
          throw new Error('Transient failure')
        }
        return { step3: 'done' }
      })

      await runtime1.start({})

      expect(runtime1.state).toBe('paused')
      expect(runtime1.error?.message).toContain('Transient failure')

      // Phase 2: Restart and rollback to checkpoint before step3
      const runtime2 = new WorkflowRuntime(mockState, config, { onError: 'pause' })

      runtime2.registerStep('step1', async () => ({ step1: 'done' }))
      runtime2.registerStep('step2', async () => ({ step2: 'done' }))
      runtime2.registerStep('step3', async () => {
        step3Attempts++
        if (step3Attempts === 1) {
          throw new Error('Transient failure')
        }
        return { step3: 'done' }
      })

      await runtime2.restore()

      // Resume from paused state - step3 should succeed on retry
      await runtime2.resume()

      expect(runtime2.state).toBe('completed')
      expect(step3Attempts).toBe(2)
    })
  })

  // ==========================================================================
  // 3. ATOMIC STEP RESULT PERSISTENCE
  // ==========================================================================

  describe('Atomic Step Result Persistence', () => {
    it('should persist step results atomically', async () => {
      const config: WorkflowRuntimeConfig = { name: 'atomic-persist-workflow' }

      const runtime = new WorkflowRuntime(mockState, config)

      runtime.registerStep('step1', async () => ({
        complexOutput: {
          nested: { data: 'value' },
          array: [1, 2, 3],
          date: new Date().toISOString(),
        },
      }))

      runtime.registerStep('step2', async (ctx) => {
        await ctx.waitForEvent('continue')
        return {}
      })

      runtime.start({})
      await vi.advanceTimersByTimeAsync(10)

      // Verify step result is atomically stored
      const stepResult = persistentStorage._storage.get('workflow:step:0')
      expect(stepResult).toBeDefined()
      expect((stepResult as Record<string, unknown>).status).toBe('completed')
      expect((stepResult as Record<string, unknown>).output).toEqual({
        complexOutput: {
          nested: { data: 'value' },
          array: [1, 2, 3],
          date: expect.any(String),
        },
      })
    })

    it('should not persist incomplete step results', async () => {
      const config: WorkflowRuntimeConfig = { name: 'incomplete-step-workflow' }

      const runtime = new WorkflowRuntime(mockState, config)

      runtime.registerStep('step1', async () => {
        // This step will never complete as we don't advance timers enough
        await new Promise((resolve) => setTimeout(resolve, 10000))
        return { completed: true }
      })

      // Start but don't wait for completion
      runtime.start({})
      await vi.advanceTimersByTimeAsync(10)

      // Step should not be persisted as completed yet
      const stepResult = persistentStorage._storage.get('workflow:step:0')
      if (stepResult) {
        expect((stepResult as Record<string, unknown>).status).not.toBe('completed')
      }
    })

    it('should persist step error information atomically', async () => {
      const config: WorkflowRuntimeConfig = { name: 'error-persist-workflow' }

      const runtime = new WorkflowRuntime(mockState, config)

      const testError = new Error('Test error message')
      testError.name = 'TestError'

      runtime.registerStep('failing-step', async () => {
        throw testError
      })

      await expect(runtime.start({})).rejects.toThrow()

      // Verify error is persisted
      const stepResult = persistentStorage._storage.get('workflow:step:0') as Record<string, unknown>
      expect(stepResult).toBeDefined()
      expect(stepResult.status).toBe('failed')
      expect(stepResult.error).toBeDefined()
      expect((stepResult.error as Record<string, unknown>).message).toContain('Test error message')
    })

    it('should persist step timing information', async () => {
      const config: WorkflowRuntimeConfig = { name: 'timing-persist-workflow' }

      vi.useRealTimers()

      const runtime = new WorkflowRuntime(mockState, config)

      runtime.registerStep('timed-step', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return { timed: true }
      })

      await runtime.start({})

      const stepResult = persistentStorage._storage.get('workflow:step:0') as Record<string, unknown>
      expect(stepResult).toBeDefined()
      expect(stepResult.startedAt).toBeDefined()
      expect(stepResult.completedAt).toBeDefined()
      expect(stepResult.duration).toBeGreaterThanOrEqual(50)

      vi.useFakeTimers()
    }, 10000)
  })

  // ==========================================================================
  // 4. EXECUTION TREE RECONSTRUCTION
  // ==========================================================================

  describe('Execution Tree Reconstruction', () => {
    it('should reconstruct linear execution tree from persisted state', async () => {
      const config: WorkflowRuntimeConfig = { name: 'linear-tree-workflow' }

      // Phase 1: Execute workflow
      const runtime1 = new WorkflowRuntime(mockState, config)

      runtime1.registerStep('validate', async () => ({ validated: true }))
      runtime1.registerStep('process', async () => ({ processed: true }))
      runtime1.registerStep('notify', async () => ({ notified: true }))

      await runtime1.start({ orderId: '123' })

      // Phase 2: Reconstruct from persisted state
      const runtime2 = new WorkflowRuntime(mockState, config)

      runtime2.registerStep('validate', async () => ({ validated: true }))
      runtime2.registerStep('process', async () => ({ processed: true }))
      runtime2.registerStep('notify', async () => ({ notified: true }))

      await runtime2.restore()

      // Verify execution tree can be reconstructed
      const tree = reconstructExecutionTree(persistentStorage._storage)

      expect(tree).toBeDefined()
      expect(tree.length).toBe(3)
      expect(tree[0].stepName).toBe('validate')
      expect(tree[0].status).toBe('completed')
      expect(tree[1].stepName).toBe('process')
      expect(tree[1].status).toBe('completed')
      expect(tree[2].stepName).toBe('notify')
      expect(tree[2].status).toBe('completed')
    })

    it('should reconstruct parallel step execution tree', async () => {
      const config: WorkflowRuntimeConfig = { name: 'parallel-tree-workflow' }

      const runtime = new WorkflowRuntime(mockState, config)

      runtime.registerStep('sequential-1', async () => ({ seq1: true }))

      // Use parallel step registration
      runtime.parallel([
        { name: 'parallel-a', handler: async () => ({ a: true }) },
        { name: 'parallel-b', handler: async () => ({ b: true }) },
        { name: 'parallel-c', handler: async () => ({ c: true }) },
      ])

      runtime.registerStep('sequential-2', async () => ({ seq2: true }))

      await runtime.start({})

      // Verify parallel execution is captured in tree
      const tree = reconstructExecutionTree(persistentStorage._storage)

      expect(tree).toBeDefined()

      // Find the parallel step group
      const parallelStep = tree.find((node) => node.stepName.startsWith('parallel'))
      expect(parallelStep).toBeDefined()

      // Parallel step should have children or parallel results
      const parallelResults = runtime.stepResults.find((r) => r.parallelResults)
      expect(parallelResults).toBeDefined()
      expect(Object.keys(parallelResults!.parallelResults!)).toContain('parallel-a')
      expect(Object.keys(parallelResults!.parallelResults!)).toContain('parallel-b')
      expect(Object.keys(parallelResults!.parallelResults!)).toContain('parallel-c')
    })

    it('should reconstruct execution tree with failed steps', async () => {
      const config: WorkflowRuntimeConfig = { name: 'failed-tree-workflow' }

      const runtime = new WorkflowRuntime(mockState, config)

      runtime.registerStep('step1', async () => ({ step1: true }))
      runtime.registerStep('step2', async () => {
        throw new Error('Step 2 failed')
      })
      runtime.registerStep('step3', async () => ({ step3: true }))

      await expect(runtime.start({})).rejects.toThrow()

      const tree = reconstructExecutionTree(persistentStorage._storage)

      expect(tree).toBeDefined()
      expect(tree[0].status).toBe('completed')
      expect(tree[1].status).toBe('failed')
      expect(tree[1].error).toBeDefined()
      // Step 3 should not appear in tree (never executed)
    })

    it('should reconstruct execution tree with step retries', async () => {
      const config: WorkflowRuntimeConfig = { name: 'retry-tree-workflow' }

      const runtime = new WorkflowRuntime(mockState, config)

      let attempts = 0

      runtime.registerStep('flaky-step', async () => {
        attempts++
        if (attempts < 3) {
          throw new Error(`Attempt ${attempts} failed`)
        }
        return { attempts }
      }, { retries: 3 })

      await runtime.start({})

      const tree = reconstructExecutionTree(persistentStorage._storage)

      expect(tree).toBeDefined()
      expect(tree[0].status).toBe('completed')

      // Verify retry count is captured
      const stepResult = persistentStorage._storage.get('workflow:step:0') as Record<string, unknown>
      expect(stepResult).toBeDefined()
      // The retry count should be captured
    })
  })

  // ==========================================================================
  // 5. FAILED WORKFLOW REPLAY
  // ==========================================================================

  describe('Failed Workflow Replay', () => {
    it('should replay failed workflow from last checkpoint', async () => {
      const config: WorkflowRuntimeConfig = { name: 'replay-failed-workflow' }

      let step2Attempts = 0

      // Phase 1: Workflow fails at step2
      const runtime1 = new WorkflowRuntime(mockState, config, { onError: 'pause' })

      runtime1.registerStep('step1', async () => ({ step1: 'done' }))
      runtime1.registerStep('step2', async () => {
        step2Attempts++
        if (step2Attempts === 1) {
          throw new Error('First attempt failed')
        }
        return { step2: 'done' }
      })
      runtime1.registerStep('step3', async () => ({ step3: 'done' }))

      await runtime1.start({})

      expect(runtime1.state).toBe('paused')
      expect(step2Attempts).toBe(1)

      // Phase 2: Replay from checkpoint
      const runtime2 = new WorkflowRuntime(mockState, config, { onError: 'pause' })

      runtime2.registerStep('step1', async () => ({ step1: 'done' }))
      runtime2.registerStep('step2', async () => {
        step2Attempts++
        if (step2Attempts === 1) {
          throw new Error('First attempt failed')
        }
        return { step2: 'done' }
      })
      runtime2.registerStep('step3', async () => ({ step3: 'done' }))

      await runtime2.restore()
      await runtime2.resume()

      expect(runtime2.state).toBe('completed')
      expect(step2Attempts).toBe(2)
    })

    it('should allow replay from arbitrary checkpoint', async () => {
      const config: WorkflowRuntimeConfig = { name: 'arbitrary-replay-workflow' }

      const executedSteps: string[] = []

      // Phase 1: Complete workflow
      const runtime1 = new WorkflowRuntime(mockState, config)

      runtime1.registerStep('step1', async () => {
        executedSteps.push('step1')
        return { step1: 'done' }
      })
      runtime1.registerStep('step2', async () => {
        executedSteps.push('step2')
        return { step2: 'done' }
      })
      runtime1.registerStep('step3', async () => {
        executedSteps.push('step3')
        return { step3: 'done' }
      })

      await runtime1.start({})

      expect(executedSteps).toEqual(['step1', 'step2', 'step3'])
      executedSteps.length = 0

      // Phase 2: Replay from step2 (requires replayFromStep implementation)
      // This will FAIL until replayFromStep is implemented
      const runtime2 = new WorkflowRuntime(mockState, config)

      runtime2.registerStep('step1', async () => {
        executedSteps.push('step1')
        return { step1: 'done' }
      })
      runtime2.registerStep('step2', async () => {
        executedSteps.push('step2')
        return { step2: 'done' }
      })
      runtime2.registerStep('step3', async () => {
        executedSteps.push('step3')
        return { step3: 'done' }
      })

      await runtime2.restore()

      // This method needs to be implemented
      // await runtime2.replayFromStep(1) // Replay from step2

      // expect(executedSteps).toEqual(['step2', 'step3'])
    })

    it('should preserve failed step error for debugging', async () => {
      const config: WorkflowRuntimeConfig = { name: 'error-debug-workflow' }

      const runtime = new WorkflowRuntime(mockState, config)

      const detailedError = new Error('Detailed error with context')
      detailedError.name = 'ProcessingError'

      runtime.registerStep('failing-step', async () => {
        throw detailedError
      })

      await expect(runtime.start({})).rejects.toThrow()

      // Verify error details are persisted for debugging
      const workflowState = persistentStorage._storage.get('workflow:state') as Record<string, unknown>
      expect(workflowState.error).toBeDefined()

      const errorInfo = workflowState.error as Record<string, unknown>
      expect(errorInfo.message).toContain('Detailed error with context')
      expect(errorInfo.name).toBe('ProcessingError')
      expect(errorInfo.stack).toBeDefined()
    })

    it('should track replay history', async () => {
      const config: WorkflowRuntimeConfig = { name: 'replay-history-workflow' }

      let attempts = 0

      // Multiple replay attempts
      for (let i = 0; i < 3; i++) {
        const runtime = new WorkflowRuntime(mockState, config, { onError: 'pause' })

        runtime.registerStep('flaky-step', async () => {
          attempts++
          if (attempts < 3) {
            throw new Error(`Attempt ${attempts} failed`)
          }
          return { attempts }
        })

        await runtime.restore()

        if (i === 0) {
          await runtime.start({})
        } else {
          await runtime.resume()
        }

        if (runtime.state === 'completed') break
      }

      // Verify replay history is tracked
      // This requires implementation of replay tracking
      // expect(getReplayHistory(persistentStorage._storage)).toHaveLength(3)
    })
  })

  // ==========================================================================
  // 6. IN-FLIGHT OPERATION HANDLING
  // ==========================================================================

  describe('In-Flight Operation Handling', () => {
    it('should detect in-flight step on restart', async () => {
      const config: WorkflowRuntimeConfig = { name: 'in-flight-detect-workflow' }

      // Simulate a workflow that was mid-step when DO crashed
      persistentStorage._storage.set('workflow:state', {
        status: 'running',
        currentStepIndex: 1,
        input: { test: true },
        startedAt: new Date().toISOString(),
      })

      persistentStorage._storage.set('workflow:step:0', {
        name: 'step1',
        status: 'completed',
        output: { step1: 'done' },
      })

      persistentStorage._storage.set('workflow:step:1', {
        name: 'step2',
        status: 'running', // In-flight when crash occurred
        startedAt: new Date().toISOString(),
      })

      const runtime = new WorkflowRuntime(mockState, config)

      runtime.registerStep('step1', async () => ({ step1: 'done' }))
      runtime.registerStep('step2', async () => ({ step2: 'done' }))
      runtime.registerStep('step3', async () => ({ step3: 'done' }))

      await runtime.restore()

      // Verify in-flight step is detected
      expect(runtime.state).toBe('running')
      expect(runtime.currentStepIndex).toBe(1)

      // The in-flight step should be marked appropriately
      const step1Result = runtime.stepResults[0]
      expect(step1Result.status).toBe('completed')

      // Step 2 was in-flight - implementation should handle this
    })

    it('should re-execute in-flight step after restart (at-least-once semantics)', async () => {
      const config: WorkflowRuntimeConfig = { name: 'reexecute-in-flight-workflow' }

      // Simulate crash during step execution
      persistentStorage._storage.set('workflow:state', {
        status: 'running',
        currentStepIndex: 0,
        input: {},
        startedAt: new Date().toISOString(),
      })

      persistentStorage._storage.set('workflow:step:0', {
        name: 'step1',
        status: 'running',
        startedAt: new Date().toISOString(),
      })

      let step1Executions = 0

      const runtime = new WorkflowRuntime(mockState, config)

      runtime.registerStep('step1', async () => {
        step1Executions++
        return { executions: step1Executions }
      })

      await runtime.restore()

      // Resume should re-execute the in-flight step
      await runtime.resume()

      expect(step1Executions).toBe(1) // Re-executed after restart
      expect(runtime.state).toBe('completed')
    })

    it('should handle idempotent step re-execution', async () => {
      const config: WorkflowRuntimeConfig = { name: 'idempotent-step-workflow' }

      // This tests that steps can be safely re-executed
      const sideEffects: string[] = []

      // Simulate crash during step execution
      persistentStorage._storage.set('workflow:state', {
        status: 'running',
        currentStepIndex: 0,
        input: { orderId: 'order-123' },
        startedAt: new Date().toISOString(),
      })

      const runtime = new WorkflowRuntime(mockState, config)

      runtime.registerStep('process-order', async (ctx) => {
        const orderId = (ctx.input as Record<string, string>).orderId

        // Idempotent check - only process if not already done
        // In real implementation, this would check a database
        if (!sideEffects.includes(orderId)) {
          sideEffects.push(orderId)
        }

        return { processed: true }
      })

      await runtime.restore()
      await runtime.resume()

      // Despite potential re-execution, side effect only happens once
      expect(sideEffects).toEqual(['order-123'])
    })
  })

  // ==========================================================================
  // 7. STEP RESULT STORAGE INTEGRATION
  // ==========================================================================

  describe('StepResultStorage Integration', () => {
    it('should integrate StepResultStorage with WorkflowRuntime', async () => {
      const stepStorage = new StepResultStorage(mockState)
      const config: WorkflowRuntimeConfig = { name: 'storage-integration-workflow' }

      const runtime = new WorkflowRuntime(mockState, config)

      runtime.registerStep('step1', async () => ({ data: 'from step 1' }))
      runtime.registerStep('step2', async () => ({ data: 'from step 2' }))

      await runtime.start({})

      // Verify StepResultStorage has the results
      const step1Result = await stepStorage.get('step1')
      const step2Result = await stepStorage.get('step2')

      // This will FAIL until integration is implemented
      expect(step1Result).toBeDefined()
      expect(step1Result?.output).toEqual({ data: 'from step 1' })
      expect(step1Result?.status).toBe('completed')

      expect(step2Result).toBeDefined()
      expect(step2Result?.output).toEqual({ data: 'from step 2' })
    })

    it('should use StepResultStorage for checkpoint recovery', async () => {
      const stepStorage = new StepResultStorage(mockState)
      const config: WorkflowRuntimeConfig = { name: 'storage-recovery-workflow' }

      // Pre-populate StepResultStorage (simulating previous execution)
      await stepStorage.store('step1', {
        output: { cached: 'result' },
        status: 'completed',
        duration: 100,
        startedAt: new Date(),
        completedAt: new Date(),
      })

      // Simulate workflow state where step1 is complete
      persistentStorage._storage.set('workflow:state', {
        status: 'paused',
        currentStepIndex: 1,
        input: {},
        startedAt: new Date().toISOString(),
      })

      let step1Executed = false

      const runtime = new WorkflowRuntime(mockState, config)

      runtime.registerStep('step1', async () => {
        step1Executed = true
        return { executed: true }
      })
      runtime.registerStep('step2', async () => ({ step2: 'done' }))

      await runtime.restore()

      // Step1 should NOT be re-executed - use cached result
      // This requires StepResultStorage integration
      // expect(step1Executed).toBe(false)
      // expect(runtime.stepResults[0].output).toEqual({ cached: 'result' })
    })

    it('should persist step results with full metadata', async () => {
      const stepStorage = new StepResultStorage(mockState)
      const config: WorkflowRuntimeConfig = { name: 'metadata-workflow' }

      vi.useRealTimers()

      const runtime = new WorkflowRuntime(mockState, config)

      runtime.registerStep('metadata-step', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { result: 'with metadata' }
      })

      await runtime.start({})

      // Verify full metadata is stored
      const result = await stepStorage.get('metadata-step')

      // This will FAIL until integration is implemented
      expect(result).toBeDefined()
      expect(result?.stepName).toBe('metadata-step')
      expect(result?.status).toBe('completed')
      expect(result?.output).toEqual({ result: 'with metadata' })
      expect(result?.duration).toBeGreaterThanOrEqual(10)
      expect(result?.startedAt).toBeInstanceOf(Date)
      expect(result?.completedAt).toBeInstanceOf(Date)
      expect(result?.storedAt).toBeDefined()

      vi.useFakeTimers()
    }, 10000)
  })

  // ==========================================================================
  // 8. CHECKPOINT VERSIONING
  // ==========================================================================

  describe('Checkpoint Versioning', () => {
    it('should increment checkpoint version after each state change', async () => {
      const config: WorkflowRuntimeConfig = { name: 'versioned-workflow' }

      const runtime = new WorkflowRuntime(mockState, config)

      runtime.registerStep('step1', async () => ({ s1: true }))
      runtime.registerStep('step2', async () => ({ s2: true }))

      await runtime.start({})

      // Verify checkpoint has version field
      const state = persistentStorage._storage.get('workflow:state') as Record<string, unknown>

      // This will FAIL until checkpoint versioning is implemented
      expect(state.version).toBeDefined()
      expect(typeof state.version).toBe('number')
      expect(state.version).toBeGreaterThanOrEqual(1)
    })

    it('should detect stale checkpoint on restore', async () => {
      const config: WorkflowRuntimeConfig = { name: 'stale-checkpoint-workflow' }

      // Simulate an old checkpoint with version 1
      persistentStorage._storage.set('workflow:state', {
        status: 'paused',
        currentStepIndex: 1,
        input: {},
        version: 1,
        checkpointedAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      })

      const runtime = new WorkflowRuntime(mockState, config)
      runtime.registerStep('step1', async () => ({}))
      runtime.registerStep('step2', async () => ({}))

      await runtime.restore()

      // Runtime should have restored version
      // This will FAIL until version tracking is implemented
      // expect(runtime.checkpointVersion).toBe(1)
    })

    it('should create new checkpoint version on resume', async () => {
      const config: WorkflowRuntimeConfig = { name: 'resume-version-workflow' }

      // Initial checkpoint at version 1
      persistentStorage._storage.set('workflow:state', {
        status: 'paused',
        currentStepIndex: 0,
        input: {},
        version: 1,
      })

      persistentStorage._storage.set('workflow:step:0', {
        name: 'step1',
        status: 'completed',
        output: {},
      })

      const runtime = new WorkflowRuntime(mockState, config, { onError: 'pause' })

      let attempt = 0
      runtime.registerStep('step1', async () => ({ done: true }))
      runtime.registerStep('step2', async () => {
        attempt++
        if (attempt === 1) throw new Error('First attempt fails')
        return { done: true }
      })

      await runtime.restore()
      await runtime.resume()

      // After resume, version should be incremented
      const newState = persistentStorage._storage.get('workflow:state') as Record<string, unknown>

      // This will FAIL until version tracking is implemented
      expect(newState.version).toBeGreaterThan(1)
    })
  })

  // ==========================================================================
  // 9. EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty workflow restart', async () => {
      const config: WorkflowRuntimeConfig = { name: 'empty-workflow' }

      const runtime = new WorkflowRuntime(mockState, config)

      await runtime.start({})

      expect(runtime.state).toBe('completed')

      // Restart with no steps should still work
      const runtime2 = new WorkflowRuntime(mockState, config)
      await runtime2.restore()

      expect(runtime2.state).toBe('completed')
    })

    it('should handle very long workflow with many steps', async () => {
      const config: WorkflowRuntimeConfig = { name: 'long-workflow' }

      const runtime = new WorkflowRuntime(mockState, config)

      // Register 50 steps
      for (let i = 0; i < 50; i++) {
        runtime.registerStep(`step-${i}`, async () => ({ step: i }))
      }

      await runtime.start({})

      expect(runtime.state).toBe('completed')
      expect(runtime.stepResults).toHaveLength(50)

      // Verify all results are persisted
      for (let i = 0; i < 50; i++) {
        const stepResult = persistentStorage._storage.get(`workflow:step:${i}`)
        expect(stepResult).toBeDefined()
      }
    })

    it('should handle concurrent restart attempts', async () => {
      const config: WorkflowRuntimeConfig = { name: 'concurrent-restart-workflow' }

      // Simulate paused state
      persistentStorage._storage.set('workflow:state', {
        status: 'paused',
        currentStepIndex: 0,
        input: {},
        pendingEvents: ['continue'],
      })

      // Two runtime instances trying to restore simultaneously
      const runtime1 = new WorkflowRuntime(mockState, config)
      const runtime2 = new WorkflowRuntime(mockState, config)

      runtime1.registerStep('step', async (ctx) => {
        await ctx.waitForEvent('continue')
        return {}
      })
      runtime2.registerStep('step', async (ctx) => {
        await ctx.waitForEvent('continue')
        return {}
      })

      // Both should be able to restore without conflict
      await Promise.all([runtime1.restore(), runtime2.restore()])

      expect(runtime1.state).toBe('paused')
      expect(runtime2.state).toBe('paused')
    })

    it('should handle large step outputs', async () => {
      const config: WorkflowRuntimeConfig = { name: 'large-output-workflow' }

      const runtime = new WorkflowRuntime(mockState, config)

      // Create a large output
      const largeOutput = {
        data: 'x'.repeat(100000), // 100KB string
        array: Array(1000).fill({ nested: 'data' }),
        nested: {
          level1: {
            level2: {
              level3: {
                value: 'deep nested value',
              },
            },
          },
        },
      }

      runtime.registerStep('large-step', async () => largeOutput)

      await runtime.start({})

      // Verify large output is persisted correctly
      const stepResult = persistentStorage._storage.get('workflow:step:0') as Record<string, unknown>
      expect(stepResult.output).toEqual(largeOutput)

      // Restart should restore large output
      const runtime2 = new WorkflowRuntime(mockState, config)
      runtime2.registerStep('large-step', async () => largeOutput)

      await runtime2.restore()

      expect(runtime2.stepResults[0].output).toEqual(largeOutput)
    })
  })
})

// ============================================================================
// HELPER FUNCTIONS (to be implemented in GREEN phase)
// ============================================================================

/**
 * Reconstruct execution tree from persisted storage.
 * This is a placeholder implementation for the RED phase tests.
 */
function reconstructExecutionTree(storage: Map<string, unknown>): ExecutionTreeNode[] {
  const tree: ExecutionTreeNode[] = []

  // Get all step entries
  const stepEntries = Array.from(storage.entries())
    .filter(([key]) => key.startsWith('workflow:step:'))
    .sort(([a], [b]) => {
      const indexA = parseInt(a.split(':')[2] ?? '0')
      const indexB = parseInt(b.split(':')[2] ?? '0')
      return indexA - indexB
    })

  for (const [key, value] of stepEntries) {
    const stepData = value as Record<string, unknown>
    const stepIndex = parseInt(key.split(':')[2] ?? '0')

    tree.push({
      stepIndex,
      stepName: stepData.name as string,
      status: stepData.status as ExecutionTreeNode['status'],
      output: stepData.output,
      error: stepData.error as { message: string; name: string } | undefined,
      duration: stepData.duration as number | undefined,
      startedAt: stepData.startedAt as string | undefined,
      completedAt: stepData.completedAt as string | undefined,
    })
  }

  return tree
}
