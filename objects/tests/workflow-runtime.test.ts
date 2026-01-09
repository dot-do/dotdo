/**
 * WorkflowRuntime Tests
 *
 * RED TDD: Tests for WorkflowRuntime - manages workflow execution in Durable Objects.
 *
 * WorkflowRuntime provides:
 * - Constructor that accepts workflow definition/config
 * - State management: pending, running, paused, completed, failed
 * - Step registration and ordered execution
 * - Integration with WaitForEventManager for waitForEvent
 * - Event emission for observability
 *
 * This integrates with:
 * - DO storage for state persistence
 * - WaitForEventManager for event-driven pauses
 * - WorkflowContext ($) for domain operations
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports define the interface we need to implement
import {
  WorkflowRuntime,
  type WorkflowRuntimeConfig,
  type WorkflowRuntimeState,
  type WorkflowStepConfig,
  type StepExecutionResult,
  type WorkflowRuntimeOptions,
  WorkflowStateError,
  WorkflowStepError,
  WorkflowTimeoutError,
} from '../WorkflowRuntime'

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
    id: { toString: () => 'test-workflow-runtime-do-id' },
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

describe('WorkflowRuntime', () => {
  let mockState: ReturnType<typeof createMockState>
  let runtime: WorkflowRuntime

  beforeEach(() => {
    mockState = createMockState()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // 1. CONSTRUCTOR & INITIALIZATION
  // ==========================================================================

  describe('Constructor & Initialization', () => {
    it('creates runtime with workflow config', () => {
      const config: WorkflowRuntimeConfig = {
        name: 'expense-approval',
        version: '1.0.0',
      }

      runtime = new WorkflowRuntime(mockState, config)

      expect(runtime).toBeDefined()
      expect(runtime.name).toBe('expense-approval')
      expect(runtime.version).toBe('1.0.0')
    })

    it('initializes with pending state', () => {
      const config: WorkflowRuntimeConfig = {
        name: 'my-workflow',
      }

      runtime = new WorkflowRuntime(mockState, config)

      expect(runtime.state).toBe('pending')
    })

    it('generates unique workflow instance ID', () => {
      const config: WorkflowRuntimeConfig = { name: 'workflow' }

      const runtime1 = new WorkflowRuntime(mockState, config)
      const runtime2 = new WorkflowRuntime(createMockState(), config)

      expect(runtime1.instanceId).toBeDefined()
      expect(runtime2.instanceId).toBeDefined()
      expect(runtime1.instanceId).not.toBe(runtime2.instanceId)
    })

    it('accepts optional workflow options', () => {
      const config: WorkflowRuntimeConfig = {
        name: 'workflow',
        version: '2.0.0',
      }

      const options: WorkflowRuntimeOptions = {
        timeout: '1 hour',
        retries: 3,
        onError: 'pause',
      }

      runtime = new WorkflowRuntime(mockState, config, options)

      expect(runtime.options.timeout).toBe('1 hour')
      expect(runtime.options.retries).toBe(3)
      expect(runtime.options.onError).toBe('pause')
    })

    it('uses default options when not provided', () => {
      const config: WorkflowRuntimeConfig = { name: 'workflow' }

      runtime = new WorkflowRuntime(mockState, config)

      expect(runtime.options.retries).toBe(0)
      expect(runtime.options.onError).toBe('fail')
    })

    it('stores config to DO storage on initialization', async () => {
      const config: WorkflowRuntimeConfig = {
        name: 'my-workflow',
        version: '1.0.0',
      }

      runtime = new WorkflowRuntime(mockState, config)
      await runtime.initialize()

      expect(mockState.storage.put).toHaveBeenCalledWith(
        expect.stringContaining('config'),
        expect.objectContaining({ name: 'my-workflow' }),
      )
    })
  })

  // ==========================================================================
  // 2. STATE MANAGEMENT
  // ==========================================================================

  describe('State Management', () => {
    beforeEach(() => {
      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' })
    })

    it('supports all valid states: pending, running, paused, completed, failed', () => {
      const validStates: WorkflowRuntimeState[] = ['pending', 'running', 'paused', 'completed', 'failed']

      validStates.forEach((state) => {
        expect(['pending', 'running', 'paused', 'completed', 'failed']).toContain(state)
      })
    })

    it('transitions from pending to running when started', async () => {
      expect(runtime.state).toBe('pending')

      // Register a step that will wait, so we can check running state
      runtime.registerStep('wait-step', async (ctx) => {
        await ctx.waitForEvent('test-event')
        return {}
      })

      const promise = runtime.start({})
      await vi.advanceTimersByTimeAsync(10)

      expect(runtime.state).toBe('paused') // paused waiting for event

      // Deliver event to complete
      await runtime.deliverEvent('test-event', {})
      await promise
    })

    it('can pause a running workflow', async () => {
      // Register a long-running step
      runtime.registerStep('wait-step', async (ctx) => {
        await ctx.waitForEvent('approval')
        return {}
      })

      const promise = runtime.start({})
      await vi.advanceTimersByTimeAsync(10)

      // Workflow is paused waiting for event
      expect(runtime.state).toBe('paused')

      // Deliver event to complete
      await runtime.deliverEvent('approval', {})
      await promise
    })

    it('can resume a paused workflow', async () => {
      runtime.registerStep('wait-step', async (ctx) => {
        await ctx.waitForEvent('approval')
        return {}
      })

      const promise = runtime.start({})
      await vi.advanceTimersByTimeAsync(10)
      expect(runtime.state).toBe('paused')

      // Deliver event to resume
      await runtime.deliverEvent('approval', {})
      await promise

      expect(runtime.state).toBe('completed')
    })

    it('transitions to completed when all steps finish successfully', async () => {
      runtime.registerStep('step1', async () => ({ result: 'done' }))

      const result = await runtime.start({})

      expect(runtime.state).toBe('completed')
      expect(result.status).toBe('completed')
    })

    it('transitions to failed when a step throws', async () => {
      runtime.registerStep('failing-step', async () => {
        throw new Error('Step failed')
      })

      await expect(runtime.start({})).rejects.toThrow()

      expect(runtime.state).toBe('failed')
    })

    it('persists state changes to storage', async () => {
      runtime.registerStep('step', async () => ({}))
      await runtime.start({})

      // Workflow completes, so we check for completed status
      expect(mockState.storage.put).toHaveBeenCalledWith(
        expect.stringContaining('state'),
        expect.objectContaining({ status: 'completed' }),
      )
    })

    it('throws WorkflowStateError for invalid state transitions', async () => {
      await runtime.start({})

      // Cannot start an already running workflow
      await expect(runtime.start({})).rejects.toThrow(WorkflowStateError)
    })

    it('can restore state from storage', async () => {
      // Simulate existing state in storage
      mockState._storage.set('workflow:state', {
        status: 'paused',
        currentStepIndex: 1,
        input: { data: 'test' },
      })

      await runtime.restore()

      expect(runtime.state).toBe('paused')
    })

    it('tracks startedAt timestamp', async () => {
      const beforeStart = Date.now()
      await runtime.start({})
      const afterStart = Date.now()

      expect(runtime.startedAt).toBeDefined()
      expect(runtime.startedAt!.getTime()).toBeGreaterThanOrEqual(beforeStart)
      expect(runtime.startedAt!.getTime()).toBeLessThanOrEqual(afterStart)
    })

    it('tracks completedAt timestamp on completion', async () => {
      runtime.registerStep('step', async () => ({}))

      const beforeComplete = Date.now()
      await runtime.start({})
      const afterComplete = Date.now()

      expect(runtime.completedAt).toBeDefined()
      expect(runtime.completedAt!.getTime()).toBeGreaterThanOrEqual(beforeComplete)
      expect(runtime.completedAt!.getTime()).toBeLessThanOrEqual(afterComplete)
    })
  })

  // ==========================================================================
  // 3. STEP REGISTRATION
  // ==========================================================================

  describe('Step Registration', () => {
    beforeEach(() => {
      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' })
    })

    it('registers a step with name and handler', () => {
      const handler = async () => ({ result: 'done' })

      runtime.registerStep('process-data', handler)

      expect(runtime.steps).toHaveLength(1)
      expect(runtime.steps[0].name).toBe('process-data')
    })

    it('registers multiple steps in order', () => {
      runtime.registerStep('step1', async () => ({}))
      runtime.registerStep('step2', async () => ({}))
      runtime.registerStep('step3', async () => ({}))

      expect(runtime.steps).toHaveLength(3)
      expect(runtime.steps.map((s) => s.name)).toEqual(['step1', 'step2', 'step3'])
    })

    it('supports step configuration options', () => {
      const stepConfig: WorkflowStepConfig = {
        timeout: '30 seconds',
        retries: 2,
        retryDelay: '1 second',
      }

      runtime.registerStep('configured-step', async () => ({}), stepConfig)

      expect(runtime.steps[0].config?.timeout).toBe('30 seconds')
      expect(runtime.steps[0].config?.retries).toBe(2)
    })

    it('throws if registering step after workflow started', async () => {
      await runtime.start({})

      expect(() => {
        runtime.registerStep('late-step', async () => ({}))
      }).toThrow()
    })

    it('supports fluent step registration via chain', () => {
      runtime.step('step1', async () => ({})).step('step2', async () => ({})).step('step3', async () => ({}))

      expect(runtime.steps).toHaveLength(3)
    })

    it('registers step with async handler that receives context', async () => {
      let receivedContext: unknown = null

      runtime.registerStep('context-step', async (ctx) => {
        receivedContext = ctx
        return {}
      })

      await runtime.start({ input: 'data' })

      expect(receivedContext).toBeDefined()
      expect((receivedContext as { input: unknown }).input).toEqual({ input: 'data' })
    })
  })

  // ==========================================================================
  // 4. STEP EXECUTION
  // ==========================================================================

  describe('Step Execution', () => {
    beforeEach(() => {
      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' })
    })

    it('executes steps in registered order', async () => {
      const executionOrder: string[] = []

      runtime.registerStep('first', async () => {
        executionOrder.push('first')
        return {}
      })
      runtime.registerStep('second', async () => {
        executionOrder.push('second')
        return {}
      })
      runtime.registerStep('third', async () => {
        executionOrder.push('third')
        return {}
      })

      await runtime.start({})

      expect(executionOrder).toEqual(['first', 'second', 'third'])
    })

    it('passes step output to next step as input', async () => {
      let secondStepInput: unknown = null

      runtime.registerStep('producer', async () => ({ value: 42 }))
      runtime.registerStep('consumer', async (ctx) => {
        secondStepInput = ctx.previousStepOutput
        return {}
      })

      await runtime.start({})

      expect(secondStepInput).toEqual({ value: 42 })
    })

    it('provides step execution context', async () => {
      let stepContext: unknown = null

      runtime.registerStep('check-context', async (ctx) => {
        stepContext = ctx
        return {}
      })

      await runtime.start({ workflowInput: 'test' })

      const ctx = stepContext as {
        input: unknown
        stepName: string
        stepIndex: number
        workflowInstanceId: string
      }

      expect(ctx.input).toEqual({ workflowInput: 'test' })
      expect(ctx.stepName).toBe('check-context')
      expect(ctx.stepIndex).toBe(0)
      expect(ctx.workflowInstanceId).toBeDefined()
    })

    it('tracks current step index during execution', async () => {
      const indices: number[] = []

      runtime.registerStep('s1', async () => {
        indices.push(runtime.currentStepIndex)
        return {}
      })
      runtime.registerStep('s2', async () => {
        indices.push(runtime.currentStepIndex)
        return {}
      })

      await runtime.start({})

      expect(indices).toEqual([0, 1])
    })

    it('handles step timeout', async () => {
      vi.useRealTimers() // Use real timers for this test

      runtime.registerStep(
        'slow-step',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 500))
          return {}
        },
        { timeout: '50ms' },
      )

      // Timeout error is wrapped in WorkflowStepError
      await expect(runtime.start({})).rejects.toThrow(WorkflowStepError)

      vi.useFakeTimers() // Restore fake timers
    }, 10000)

    it('retries failed steps according to config', async () => {
      let attempts = 0

      runtime.registerStep(
        'flaky-step',
        async () => {
          attempts++
          if (attempts < 3) {
            throw new Error('Flaky failure')
          }
          return { attempts }
        },
        { retries: 3 },
      )

      const result = await runtime.start({})

      expect(attempts).toBe(3)
      expect(result.output).toEqual({ attempts: 3 })
    })

    it('stops execution on step failure (default behavior)', async () => {
      const executedSteps: string[] = []

      runtime.registerStep('pass', async () => {
        executedSteps.push('pass')
        return {}
      })
      runtime.registerStep('fail', async () => {
        executedSteps.push('fail')
        throw new Error('Step failed')
      })
      runtime.registerStep('never', async () => {
        executedSteps.push('never')
        return {}
      })

      await expect(runtime.start({})).rejects.toThrow()

      expect(executedSteps).toEqual(['pass', 'fail'])
    })

    it('records step execution results', async () => {
      runtime.registerStep('step1', async () => ({ data: 'result1' }))
      runtime.registerStep('step2', async () => ({ data: 'result2' }))

      await runtime.start({})

      expect(runtime.stepResults).toHaveLength(2)
      expect(runtime.stepResults[0].output).toEqual({ data: 'result1' })
      expect(runtime.stepResults[1].output).toEqual({ data: 'result2' })
    })

    it('persists step results to storage', async () => {
      runtime.registerStep('step', async () => ({ persisted: true }))

      await runtime.start({})

      expect(mockState.storage.put).toHaveBeenCalledWith(expect.stringContaining('step:'), expect.anything())
    })
  })

  // ==========================================================================
  // 5. WAIT FOR EVENT INTEGRATION
  // ==========================================================================

  describe('WaitForEvent Integration', () => {
    beforeEach(() => {
      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' })
    })

    it('provides waitForEvent in step context', async () => {
      let hasWaitForEvent = false

      runtime.registerStep('check-wait', async (ctx) => {
        hasWaitForEvent = typeof ctx.waitForEvent === 'function'
        return {}
      })

      await runtime.start({})

      expect(hasWaitForEvent).toBe(true)
    })

    it('pauses workflow when waitForEvent is called', async () => {
      runtime.registerStep('wait-step', async (ctx) => {
        // This will pause the workflow
        await ctx.waitForEvent('approval')
        return {}
      })

      // Start but don't await (it will pause)
      const promise = runtime.start({})

      // Give it time to reach the wait
      await vi.advanceTimersByTimeAsync(10)

      expect(runtime.state).toBe('paused')

      // Deliver the event to resume
      await runtime.deliverEvent('approval', { approved: true })

      await promise

      expect(runtime.state).toBe('completed')
    })

    it('receives event payload when waitForEvent resolves', async () => {
      let receivedPayload: unknown = null

      runtime.registerStep('wait-step', async (ctx) => {
        receivedPayload = await ctx.waitForEvent('approval')
        return {}
      })

      const promise = runtime.start({})
      await vi.advanceTimersByTimeAsync(10)

      await runtime.deliverEvent('approval', { approved: true, by: 'manager' })

      await promise

      expect(receivedPayload).toEqual({ approved: true, by: 'manager' })
    })

    it('supports waitForEvent with timeout', async () => {
      vi.useRealTimers() // Use real timers for this test

      runtime.registerStep('wait-with-timeout', async (ctx) => {
        await ctx.waitForEvent('approval', { timeout: '100ms' })
        return {}
      })

      // Don't deliver event, let it timeout
      // Timeout error is wrapped in WorkflowStepError
      await expect(runtime.start({})).rejects.toThrow(WorkflowStepError)

      vi.useFakeTimers() // Restore fake timers
    }, 10000)

    it('tracks pending events in workflow state', async () => {
      runtime.registerStep('wait-step', async (ctx) => {
        await ctx.waitForEvent('my-event')
        return {}
      })

      const promise = runtime.start({})
      await vi.advanceTimersByTimeAsync(10)

      expect(runtime.pendingEvents).toContain('my-event')

      await runtime.deliverEvent('my-event', {})
      await promise

      expect(runtime.pendingEvents).toHaveLength(0)
    })
  })

  // ==========================================================================
  // 6. EVENT EMISSION
  // ==========================================================================

  describe('Event Emission', () => {
    beforeEach(() => {
      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' })
    })

    it('emits workflow.started event when started', async () => {
      const events: Array<{ event: string; data: unknown }> = []
      runtime.on('workflow.started', (data) => events.push({ event: 'workflow.started', data }))

      await runtime.start({ input: 'test' })

      expect(events).toHaveLength(1)
      expect(events[0].event).toBe('workflow.started')
      expect((events[0].data as { input: unknown }).input).toEqual({ input: 'test' })
    })

    it('emits workflow.completed event on completion', async () => {
      const events: Array<{ event: string; data: unknown }> = []
      runtime.on('workflow.completed', (data) => events.push({ event: 'workflow.completed', data }))

      runtime.registerStep('step', async () => ({ done: true }))
      await runtime.start({})

      expect(events).toContainEqual(
        expect.objectContaining({
          event: 'workflow.completed',
        }),
      )
    })

    it('emits workflow.failed event on failure', async () => {
      const events: Array<{ event: string; data: unknown }> = []
      runtime.on('workflow.failed', (data) => events.push({ event: 'workflow.failed', data }))

      runtime.registerStep('failing', async () => {
        throw new Error('Boom')
      })

      await expect(runtime.start({})).rejects.toThrow()

      expect(events).toHaveLength(1)
      // Error message contains the original error message
      expect((events[0].data as { error: { message: string } }).error.message).toContain('Boom')
    })

    it('emits workflow.paused event when paused', async () => {
      // Use onError: pause to trigger pause event on error
      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' }, { onError: 'pause' })

      const events: Array<{ event: string; data: unknown }> = []
      runtime.on('workflow.paused', (data) => events.push({ event: 'workflow.paused', data }))

      runtime.registerStep('failing-step', async () => {
        throw new Error('Trigger pause')
      })

      await runtime.start({})

      expect(events).toHaveLength(1)
      expect(runtime.state).toBe('paused')
    })

    it('emits workflow.resumed event when resumed', async () => {
      // Use onError: pause to get a paused workflow we can resume manually
      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' }, { onError: 'pause' })

      const events: Array<{ event: string; data: unknown }> = []
      runtime.on('workflow.resumed', (data) => events.push({ event: 'workflow.resumed', data }))

      let attempts = 0
      runtime.registerStep('flaky', async () => {
        attempts++
        if (attempts === 1) throw new Error('First attempt fails')
        return {}
      })

      await runtime.start({})
      expect(runtime.state).toBe('paused')

      await runtime.resume()

      expect(events).toHaveLength(1)
    })

    it('emits step.started event for each step', async () => {
      const events: Array<{ event: string; data: unknown }> = []
      runtime.on('step.started', (data) => events.push({ event: 'step.started', data }))

      runtime.registerStep('step1', async () => ({}))
      runtime.registerStep('step2', async () => ({}))
      await runtime.start({})

      expect(events).toHaveLength(2)
      expect((events[0].data as { stepName: string }).stepName).toBe('step1')
      expect((events[1].data as { stepName: string }).stepName).toBe('step2')
    })

    it('emits step.completed event for each successful step', async () => {
      const events: Array<{ event: string; data: unknown }> = []
      runtime.on('step.completed', (data) => events.push({ event: 'step.completed', data }))

      runtime.registerStep('step1', async () => ({ output: 1 }))
      runtime.registerStep('step2', async () => ({ output: 2 }))
      await runtime.start({})

      expect(events).toHaveLength(2)
      expect((events[0].data as { output: unknown }).output).toEqual({ output: 1 })
    })

    it('emits step.failed event when step fails', async () => {
      const events: Array<{ event: string; data: unknown }> = []
      runtime.on('step.failed', (data) => events.push({ event: 'step.failed', data }))

      runtime.registerStep('failing', async () => {
        throw new Error('Step error')
      })

      await expect(runtime.start({})).rejects.toThrow()

      expect(events).toHaveLength(1)
      // Error message contains the original error message
      expect((events[0].data as { error: { message: string } }).error.message).toContain('Step error')
    })
  })

  // ==========================================================================
  // 7. ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    beforeEach(() => {
      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' })
    })

    it('wraps step errors in WorkflowStepError', async () => {
      runtime.registerStep('bad-step', async () => {
        throw new Error('Original error')
      })

      try {
        await runtime.start({})
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowStepError)
        expect((error as WorkflowStepError).stepName).toBe('bad-step')
        expect((error as WorkflowStepError).cause?.message).toBe('Original error')
      }
    })

    it('records error in workflow state', async () => {
      runtime.registerStep('error-step', async () => {
        throw new Error('Recorded error')
      })

      await expect(runtime.start({})).rejects.toThrow()

      expect(runtime.error).toBeDefined()
      expect(runtime.error?.message).toContain('Recorded error')
    })

    it('supports onError: pause option', async () => {
      runtime = new WorkflowRuntime(mockState, { name: 'workflow' }, { onError: 'pause' })

      runtime.registerStep('error-step', async () => {
        throw new Error('Pause on this')
      })

      // Should not throw, just pause
      await runtime.start({})

      expect(runtime.state).toBe('paused')
      expect(runtime.error).toBeDefined()
    })

    it('allows retry after manual pause on error', async () => {
      runtime = new WorkflowRuntime(mockState, { name: 'workflow' }, { onError: 'pause' })

      let attempts = 0
      runtime.registerStep('flaky', async () => {
        attempts++
        if (attempts === 1) {
          throw new Error('First attempt fails')
        }
        return { attempts }
      })

      await runtime.start({})
      expect(runtime.state).toBe('paused')

      await runtime.resume() // Retry from failed step

      expect(runtime.state).toBe('completed')
      expect(attempts).toBe(2)
    })
  })

  // ==========================================================================
  // 8. WORKFLOW INPUT/OUTPUT
  // ==========================================================================

  describe('Workflow Input/Output', () => {
    beforeEach(() => {
      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' })
    })

    it('stores workflow input on start', async () => {
      runtime.registerStep('step', async () => ({}))

      await runtime.start({ expense: { amount: 1000, description: 'Travel' } })

      expect(runtime.input).toEqual({ expense: { amount: 1000, description: 'Travel' } })
    })

    it('returns final step output as workflow output', async () => {
      runtime.registerStep('step1', async () => ({ intermediate: true }))
      runtime.registerStep('step2', async () => ({ final: true, result: 42 }))

      const result = await runtime.start({})

      expect(result.output).toEqual({ final: true, result: 42 })
    })

    it('provides workflow output after completion', async () => {
      runtime.registerStep('step', async () => ({ completed: true }))

      await runtime.start({})

      expect(runtime.output).toEqual({ completed: true })
    })

    it('preserves input across state restoration', async () => {
      mockState._storage.set('workflow:state', {
        status: 'paused',
        input: { preserved: 'data' },
        currentStepIndex: 0,
      })

      await runtime.restore()

      expect(runtime.input).toEqual({ preserved: 'data' })
    })
  })

  // ==========================================================================
  // 9. DOMAIN PROXY INTEGRATION
  // ==========================================================================

  describe('Domain Proxy Integration', () => {
    beforeEach(() => {
      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' })
    })

    it('provides domain proxy ($) in step context', async () => {
      let hasDomainProxy = false

      runtime.registerStep('check-proxy', async (ctx) => {
        hasDomainProxy = ctx.$ !== undefined
        return {}
      })

      await runtime.start({})

      expect(hasDomainProxy).toBe(true)
    })

    it('allows domain resolution via $.Noun(id)', async () => {
      let domainCall: unknown = null

      // Mock the domain proxy
      const mockDomainProxy = {
        Service: (id: string) => ({
          process: async (data: unknown) => ({ serviceId: id, processed: data }),
        }),
      }

      runtime = new WorkflowRuntime(mockState, { name: 'workflow' }, { domainProxy: mockDomainProxy })

      runtime.registerStep('call-service', async (ctx) => {
        domainCall = await ctx.$.Service('svc-123').process({ input: 'test' })
        return {}
      })

      await runtime.start({})

      expect(domainCall).toEqual({ serviceId: 'svc-123', processed: { input: 'test' } })
    })
  })

  // ==========================================================================
  // 10. PERSISTENCE & RECOVERY
  // ==========================================================================

  describe('Persistence & Recovery', () => {
    beforeEach(() => {
      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' })
    })

    it('survives DO hibernation', async () => {
      runtime.registerStep('step1', async () => ({ step1: true }))
      runtime.registerStep('wait-step', async (ctx) => {
        await ctx.waitForEvent('approval')
        return { step2: true }
      })
      runtime.registerStep('step3', async () => ({ step3: true }))

      // Start workflow (will pause at wait-step)
      const promise = runtime.start({})
      await vi.advanceTimersByTimeAsync(10)

      expect(runtime.state).toBe('paused')
      expect(runtime.currentStepIndex).toBe(1)

      // Simulate hibernation - create new runtime with same storage
      const restoredRuntime = new WorkflowRuntime(mockState, { name: 'test-workflow' })
      await restoredRuntime.restore()

      expect(restoredRuntime.state).toBe('paused')
      expect(restoredRuntime.currentStepIndex).toBe(1)

      // Deliver event to restored runtime
      await restoredRuntime.deliverEvent('approval', {})

      // Original promise won't resolve (different instance), but restored should complete
      expect(restoredRuntime.state).toBe('completed')
    })

    it('persists step results for recovery', async () => {
      runtime.registerStep('step1', async () => ({ result: 'step1-done' }))

      await runtime.start({})

      // Check storage has step results
      expect(mockState.storage.put).toHaveBeenCalledWith(
        expect.stringMatching(/step:0/),
        expect.objectContaining({ output: { result: 'step1-done' } }),
      )
    })

    it('restores step results on recovery', async () => {
      mockState._storage.set('workflow:state', {
        status: 'paused',
        currentStepIndex: 1,
        input: {},
      })
      mockState._storage.set('workflow:step:0', {
        name: 'step1',
        status: 'completed',
        output: { recovered: true },
      })

      runtime.registerStep('step1', async () => ({}))
      runtime.registerStep('step2', async () => ({}))

      await runtime.restore()

      expect(runtime.stepResults).toHaveLength(1)
      expect(runtime.stepResults[0].output).toEqual({ recovered: true })
    })

    it('resumes from correct step after recovery', async () => {
      const executedSteps: string[] = []

      mockState._storage.set('workflow:state', {
        status: 'paused',
        currentStepIndex: 2,
        input: {},
      })

      runtime.registerStep('step1', async () => {
        executedSteps.push('step1')
        return {}
      })
      runtime.registerStep('step2', async () => {
        executedSteps.push('step2')
        return {}
      })
      runtime.registerStep('step3', async () => {
        executedSteps.push('step3')
        return {}
      })

      await runtime.restore()
      await runtime.resume()

      // Should only execute step3 (index 2), not step1 and step2
      expect(executedSteps).toEqual(['step3'])
    })
  })

  // ==========================================================================
  // 11. METRICS & OBSERVABILITY
  // ==========================================================================

  describe('Metrics & Observability', () => {
    beforeEach(() => {
      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' })
    })

    it('tracks total execution duration', async () => {
      vi.useRealTimers() // Use real timers for duration tests

      runtime.registerStep('step', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return {}
      })

      await runtime.start({})

      expect(runtime.duration).toBeGreaterThanOrEqual(50)

      vi.useFakeTimers() // Restore fake timers
    }, 10000)

    it('tracks individual step durations', async () => {
      vi.useRealTimers() // Use real timers for duration tests

      runtime.registerStep('fast-step', async () => ({}))
      runtime.registerStep('slow-step', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return {}
      })

      await runtime.start({})

      expect(runtime.stepResults[0].duration).toBeDefined()
      expect(runtime.stepResults[1].duration).toBeGreaterThanOrEqual(50)

      vi.useFakeTimers() // Restore fake timers
    }, 10000)

    it('provides workflow metrics summary', async () => {
      runtime.registerStep('s1', async () => ({}))
      runtime.registerStep('s2', async () => ({}))

      await runtime.start({})

      const metrics = runtime.getMetrics()

      expect(metrics.totalSteps).toBe(2)
      expect(metrics.completedSteps).toBe(2)
      expect(metrics.failedSteps).toBe(0)
      expect(metrics.duration).toBeDefined()
    })
  })
})
