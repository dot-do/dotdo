/**
 * WorkflowRuntime Graph State Integration Tests
 *
 * Tests for WorkflowRuntime using graph-based state management via GraphRuntimeState.
 * This enables workflow state to be stored as Things and Relationships in a graph,
 * providing rich querying and history preservation capabilities.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import {
  WorkflowRuntime,
  type WorkflowRuntimeConfig,
  type WorkflowRuntimeOptions,
} from '../WorkflowRuntime'

import {
  InMemoryGraphStorage,
  type WorkflowRunThing,
  type WorkflowStepThing,
} from '../../workflows/core/graph-runtime-state'

// ============================================================================
// MOCK DO STATE
// ============================================================================

function createMockStorage() {
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

function createMockState() {
  const { storage, alarms, _storage } = createMockStorage()
  return {
    id: { toString: () => 'test-workflow-runtime-graph-do-id' },
    storage,
    alarms,
    _storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { alarms: { time: number | null }; _storage: Map<string, unknown> }
}

// ============================================================================
// TESTS
// ============================================================================

describe('WorkflowRuntime with Graph State', () => {
  let mockState: ReturnType<typeof createMockState>
  let graphStorage: InMemoryGraphStorage
  let runtime: WorkflowRuntime

  const config: WorkflowRuntimeConfig = {
    name: 'test-workflow',
    version: '1.0.0',
    description: 'Test workflow for graph state',
  }

  beforeEach(() => {
    mockState = createMockState()
    graphStorage = new InMemoryGraphStorage()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // GRAPH STATE INITIALIZATION
  // ==========================================================================

  describe('Graph State Initialization', () => {
    it('creates GraphRuntimeState when useGraphState is true', () => {
      runtime = new WorkflowRuntime(mockState, config, {
        useGraphState: true,
        graphStorage,
      })

      expect(runtime.isGraphStateEnabled).toBe(true)
      expect(runtime.graphState).not.toBeNull()
    })

    it('does not create GraphRuntimeState when useGraphState is false', () => {
      runtime = new WorkflowRuntime(mockState, config, {
        useGraphState: false,
      })

      expect(runtime.isGraphStateEnabled).toBe(false)
      expect(runtime.graphState).toBeNull()
    })

    it('does not create GraphRuntimeState by default', () => {
      runtime = new WorkflowRuntime(mockState, config)

      expect(runtime.isGraphStateEnabled).toBe(false)
      expect(runtime.graphState).toBeNull()
    })

    it('initializes GraphRuntimeState on workflow initialization', async () => {
      runtime = new WorkflowRuntime(mockState, config, {
        useGraphState: true,
        graphStorage,
      })

      await runtime.initialize()

      // Verify workflow Thing was created
      const workflowRun = await runtime.graphState!.getWorkflowRun()
      expect(workflowRun).not.toBeNull()
      expect(workflowRun!.$type).toBe('WorkflowRun')
      expect(workflowRun!.data.name).toBe('test-workflow')
      expect(workflowRun!.data.version).toBe('1.0.0')
      expect(workflowRun!.data.status).toBe('pending')
    })
  })

  // ==========================================================================
  // STEP TRACKING IN GRAPH STATE
  // ==========================================================================

  describe('Step Tracking in Graph State', () => {
    beforeEach(async () => {
      runtime = new WorkflowRuntime(mockState, config, {
        useGraphState: true,
        graphStorage,
      })
    })

    it('creates step Things during workflow execution', async () => {
      runtime.step('validate', async () => ({ valid: true }))
      runtime.step('process', async () => ({ processed: true }))

      await runtime.start({ input: 'test' })

      // Verify steps were created in graph
      const steps = await runtime.graphState!.getSteps()
      expect(steps).toHaveLength(2)
      expect(steps[0]!.data.name).toBe('validate')
      expect(steps[1]!.data.name).toBe('process')
    })

    it('tracks step completion status in graph', async () => {
      runtime.step('validate', async () => ({ valid: true }))
      runtime.step('process', async () => ({ processed: true }))

      await runtime.start({ input: 'test' })

      const steps = await runtime.graphState!.getSteps()
      expect(steps[0]!.data.status).toBe('completed')
      expect(steps[1]!.data.status).toBe('completed')
    })

    it('tracks step output in graph', async () => {
      runtime.step('validate', async () => ({ valid: true, message: 'OK' }))

      await runtime.start({ input: 'test' })

      const steps = await runtime.graphState!.getSteps()
      expect(steps[0]!.data.output).toEqual({ valid: true, message: 'OK' })
    })

    it('tracks step failure in graph', async () => {
      runtime.step('validate', async () => {
        throw new Error('Validation failed')
      })

      await runtime.start({ input: 'test' }).catch(() => {})

      const steps = await runtime.graphState!.getSteps()
      expect(steps[0]!.data.status).toBe('failed')
      // Error message is wrapped by WorkflowStepError
      expect(steps[0]!.data.error?.message).toContain('Validation failed')
    })
  })

  // ==========================================================================
  // WORKFLOW STATE SYNC
  // ==========================================================================

  describe('Workflow State Synchronization', () => {
    beforeEach(async () => {
      runtime = new WorkflowRuntime(mockState, config, {
        useGraphState: true,
        graphStorage,
      })
    })

    it('syncs running state to graph', async () => {
      let checkedRunningState = false
      runtime.step('long-step', async () => {
        // Check state during execution - after step started, graph should show step was created
        const steps = await runtime.graphState!.getSteps()
        if (steps.length > 0) {
          expect(steps[0]!.data.status).toBe('running')
          checkedRunningState = true
        }
        return { done: true }
      })

      await runtime.start({ input: 'test' })
      expect(checkedRunningState).toBe(true)
    })

    it('syncs completed state to graph', async () => {
      runtime.step('final', async () => ({ result: 'done' }))

      await runtime.start({ input: 'test' })

      const workflowRun = await runtime.graphState!.getWorkflowRun()
      expect(workflowRun!.data.status).toBe('completed')
    })

    it('syncs failed state to graph', async () => {
      runtime.step('failing', async () => {
        throw new Error('Workflow failed')
      })

      await runtime.start({ input: 'test' }).catch(() => {})

      const workflowRun = await runtime.graphState!.getWorkflowRun()
      expect(workflowRun!.data.status).toBe('failed')
      // Error message contains the original error
      expect(workflowRun!.data.error?.message).toContain('Workflow failed')
    })
  })

  // ==========================================================================
  // GRAPH QUERY METHODS
  // ==========================================================================

  describe('Graph Query Methods', () => {
    beforeEach(async () => {
      runtime = new WorkflowRuntime(mockState, config, {
        useGraphState: true,
        graphStorage,
      })
    })

    it('getExecutionHistory returns workflow and steps', async () => {
      runtime.step('step1', async () => ({ a: 1 }))
      runtime.step('step2', async () => ({ b: 2 }))

      await runtime.start({ input: 'test' })

      const history = await runtime.getExecutionHistory()
      expect(history).not.toBeNull()
      expect(history!.workflow).not.toBeNull()
      expect(history!.steps).toHaveLength(2)
      expect(history!.relationships.length).toBeGreaterThan(0)
    })

    it('getStepChain returns ordered steps', async () => {
      runtime.step('first', async () => ({ order: 1 }))
      runtime.step('second', async () => ({ order: 2 }))
      runtime.step('third', async () => ({ order: 3 }))

      await runtime.start({ input: 'test' })

      const chain = await runtime.getStepChain()
      expect(chain).not.toBeNull()
      expect(chain!).toHaveLength(3)
      expect(chain![0]!.data.index).toBe(0)
      expect(chain![1]!.data.index).toBe(1)
      expect(chain![2]!.data.index).toBe(2)
    })

    it('getGraphCompletedStepsCount returns correct count', async () => {
      runtime.step('step1', async () => ({ a: 1 }))
      runtime.step('step2', async () => ({ b: 2 }))

      await runtime.start({ input: 'test' })

      const count = await runtime.getGraphCompletedStepsCount()
      expect(count).toBe(2)
    })

    it('getGraphFailedStepsCount returns correct count', async () => {
      runtime.step('step1', async () => ({ a: 1 }))
      runtime.step('step2', async () => {
        throw new Error('Failed')
      })

      await runtime.start({ input: 'test' }).catch(() => {})

      const count = await runtime.getGraphFailedStepsCount()
      expect(count).toBe(1)
    })

    it('exportGraphState exports workflow and steps', async () => {
      runtime.step('step1', async () => ({ exported: true }))

      await runtime.start({ input: 'test' })

      const exported = await runtime.exportGraphState()
      expect(exported).not.toBeNull()
      expect(exported!.workflow).not.toBeNull()
      expect(exported!.steps).toHaveLength(1)
    })

    it('returns null for graph methods when graph state is disabled', async () => {
      const nonGraphRuntime = new WorkflowRuntime(mockState, config, {
        useGraphState: false,
      })
      nonGraphRuntime.step('step1', async () => ({ a: 1 }))

      await nonGraphRuntime.start({ input: 'test' })

      expect(await nonGraphRuntime.getExecutionHistory()).toBeNull()
      expect(await nonGraphRuntime.getStepChain()).toBeNull()
      expect(await nonGraphRuntime.getGraphCompletedStepsCount()).toBeNull()
      expect(await nonGraphRuntime.getGraphFailedStepsCount()).toBeNull()
      expect(await nonGraphRuntime.exportGraphState()).toBeNull()
    })
  })

  // ==========================================================================
  // BACKWARDS COMPATIBILITY
  // ==========================================================================

  describe('Backwards Compatibility', () => {
    it('continues to use flat storage for state', async () => {
      runtime = new WorkflowRuntime(mockState, config, {
        useGraphState: true,
        graphStorage,
      })

      runtime.step('step1', async () => ({ a: 1 }))
      await runtime.start({ input: 'test' })

      // Flat storage should still be updated for workflow state
      expect(mockState.storage.put).toHaveBeenCalledWith('workflow:state', expect.any(Object))
    })

    it('existing properties work the same with graph state enabled', async () => {
      runtime = new WorkflowRuntime(mockState, config, {
        useGraphState: true,
        graphStorage,
      })

      runtime.step('step1', async () => ({ result: 'test' }))
      await runtime.start({ input: 'test' })

      expect(runtime.state).toBe('completed')
      expect(runtime.output).toEqual({ result: 'test' })
      expect(runtime.name).toBe('test-workflow')
      expect(runtime.version).toBe('1.0.0')
    })

    it('getMetrics still works with graph state enabled', async () => {
      runtime = new WorkflowRuntime(mockState, config, {
        useGraphState: true,
        graphStorage,
      })

      runtime.step('step1', async () => ({ a: 1 }))
      runtime.step('step2', async () => ({ b: 2 }))
      await runtime.start({ input: 'test' })

      const metrics = runtime.getMetrics()
      expect(metrics.totalSteps).toBe(2)
      expect(metrics.completedSteps).toBe(2)
      expect(metrics.failedSteps).toBe(0)
    })
  })
})
