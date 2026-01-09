/**
 * Tests for TestWorkflowRuntime
 *
 * Tests the test-friendly workflow runtime including:
 * - beforeStep/afterStep hooks
 * - Mock service injection
 * - Time control for testing
 * - State inspection
 * - Failure simulation
 * - Assertions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createTestWorkflowRuntime,
  InMemoryStepStorage,
  type TestWorkflowRuntime,
  type StepExecution,
  type BeforeStepHook,
  type AfterStepHook,
  type OnStepErrorHook,
} from '../runtime'
import { Domain, registerDomain, clearDomainRegistry } from '../../workflows/domain'
import { type Pipeline } from '../../workflows/proxy'

describe('TestWorkflowRuntime', () => {
  let runtime: TestWorkflowRuntime

  beforeEach(() => {
    clearDomainRegistry()
    runtime = createTestWorkflowRuntime()
  })

  afterEach(() => {
    clearDomainRegistry()
  })

  // ==========================================================================
  // Factory Function Tests
  // ==========================================================================

  describe('createTestWorkflowRuntime', () => {
    it('creates a runtime with default options', () => {
      const rt = createTestWorkflowRuntime()
      expect(rt).toBeDefined()
      expect(rt.getTime()).toBeGreaterThan(0)
    })

    it('creates a runtime with custom start time', () => {
      const startTime = 1000000
      const rt = createTestWorkflowRuntime({ startTime })
      expect(rt.getTime()).toBe(startTime)
    })

    it('creates a runtime with custom storage', () => {
      const storage = new InMemoryStepStorage()
      const rt = createTestWorkflowRuntime({ storage })
      expect(rt.getStorage()).toBe(storage)
    })

    it('creates a runtime with auto-advance time disabled', async () => {
      const startTime = 1000
      const rt = createTestWorkflowRuntime({ startTime, autoAdvanceTime: false })

      // Register a handler for testing
      const Test = Domain('Test', {
        handler: async () => ({ result: 'ok' }),
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'handler'],
        context: {},
        contextHash: 'test',
        runtime: rt,
      }

      // Execute step
      await rt.executeStep('step-1', pipeline, [], 'do')

      // Time should not advance when autoAdvanceTime is false
      expect(rt.getTime()).toBe(startTime)
    })
  })

  // ==========================================================================
  // Step Execution Tests
  // ==========================================================================

  describe('executeStep', () => {
    it('executes handler and returns result', async () => {
      const Inventory = Domain('Inventory', {
        check: async (product: { sku: string }) => ({
          available: true,
          sku: product.sku,
        }),
      })
      registerDomain(Inventory)

      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'test-hash',
        runtime,
      }

      const result = await runtime.executeStep('step-1', pipeline, [], 'do')

      expect(result).toEqual({
        available: true,
        sku: 'ABC-123',
      })
    })

    it('tracks step execution in history', async () => {
      const Test = Domain('Test', {
        action: async () => ({ done: true }),
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: { id: '123' },
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline, [], 'do')

      const steps = runtime.getExecutedSteps()
      expect(steps).toHaveLength(1)
      expect(steps[0].stepId).toBe('step-1')
      expect(steps[0].result).toEqual({ done: true })
    })
  })

  // ==========================================================================
  // beforeStep / afterStep Hooks
  // ==========================================================================

  describe('beforeStep hook', () => {
    it('calls hook before step execution', async () => {
      const Test = Domain('Test', {
        action: async () => ({ done: true }),
      })
      registerDomain(Test)

      const hookCalls: string[] = []
      runtime.beforeStep((stepId) => {
        hookCalls.push(`before:${stepId}`)
      })

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('test-step', pipeline, [], 'do')

      expect(hookCalls).toContain('before:test-step')
    })

    it('allows multiple beforeStep hooks', async () => {
      const Test = Domain('Test', {
        action: async () => ({ done: true }),
      })
      registerDomain(Test)

      const hookCalls: string[] = []

      runtime.beforeStep(() => hookCalls.push('hook-1'))
      runtime.beforeStep(() => hookCalls.push('hook-2'))

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline, [], 'do')

      expect(hookCalls).toEqual(['hook-1', 'hook-2'])
    })

    it('returns unsubscribe function', async () => {
      const Test = Domain('Test', {
        action: async () => ({ done: true }),
      })
      registerDomain(Test)

      const hookCalls: number[] = []
      const unsubscribe = runtime.beforeStep(() => hookCalls.push(1))

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline, [], 'do')
      unsubscribe()
      await runtime.executeStep('step-2', pipeline, [], 'do')

      expect(hookCalls).toEqual([1]) // Only called once
    })
  })

  describe('afterStep hook', () => {
    it('calls hook after step execution with result', async () => {
      const Test = Domain('Test', {
        action: async () => ({ done: true }),
      })
      registerDomain(Test)

      let capturedResult: unknown
      let capturedExecution: StepExecution | undefined

      runtime.afterStep((stepId, result, execution) => {
        capturedResult = result
        capturedExecution = execution
      })

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('test-step', pipeline, [], 'do')

      expect(capturedResult).toEqual({ done: true })
      expect(capturedExecution?.stepId).toBe('test-step')
      expect(capturedExecution?.result).toEqual({ done: true })
    })

    it('returns unsubscribe function', async () => {
      const Test = Domain('Test', {
        action: async () => ({ done: true }),
      })
      registerDomain(Test)

      const hookCalls: number[] = []
      const unsubscribe = runtime.afterStep(() => hookCalls.push(1))

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline, [], 'do')
      unsubscribe()
      await runtime.executeStep('step-2', pipeline, [], 'do')

      expect(hookCalls).toEqual([1])
    })
  })

  describe('onStepError hook', () => {
    it('calls hook when step fails', async () => {
      const Test = Domain('Test', {
        failingAction: async () => {
          throw new Error('Step failed!')
        },
      })
      registerDomain(Test)

      let capturedError: Error | undefined
      let capturedStepId: string | undefined

      runtime.onStepError((stepId, error) => {
        capturedStepId = stepId
        capturedError = error
      })

      const pipeline: Pipeline = {
        path: ['Test', 'failingAction'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await expect(runtime.executeStep('failing-step', pipeline, [], 'do')).rejects.toThrow('Step failed!')

      expect(capturedStepId).toBe('failing-step')
      expect(capturedError?.message).toBe('Step failed!')
    })

    it('returns unsubscribe function', async () => {
      const Test = Domain('Test', {
        failingAction: async () => {
          throw new Error('Step failed!')
        },
      })
      registerDomain(Test)

      const hookCalls: number[] = []
      const unsubscribe = runtime.onStepError(() => hookCalls.push(1))

      const pipeline: Pipeline = {
        path: ['Test', 'failingAction'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await expect(runtime.executeStep('step-1', pipeline, [], 'do')).rejects.toThrow()
      unsubscribe()
      await expect(runtime.executeStep('step-2', pipeline, [], 'do')).rejects.toThrow()

      expect(hookCalls).toEqual([1])
    })
  })

  // ==========================================================================
  // Mock Domain Injection
  // ==========================================================================

  describe('mockDomain', () => {
    it('allows mocking domain handlers', async () => {
      runtime.mockDomain('Inventory', {
        check: async () => ({ available: true, quantity: 100 }),
      })

      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'hash-1',
        runtime,
      }

      const result = await runtime.executeStep('step-1', pipeline, [], 'do')

      expect(result).toEqual({ available: true, quantity: 100 })
    })

    it('mock takes precedence over registered domain', async () => {
      const Inventory = Domain('Inventory', {
        check: async () => ({ available: false, quantity: 0 }),
      })
      registerDomain(Inventory)

      runtime.mockDomain('Inventory', {
        check: async () => ({ available: true, quantity: 999 }),
      })

      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: { sku: 'ABC-123' },
        contextHash: 'hash-1',
        runtime,
      }

      const result = await runtime.executeStep('step-1', pipeline, [], 'do')

      // Mock should be used, not registered domain
      expect(result).toEqual({ available: true, quantity: 999 })
    })

    it('throws error when mock method does not exist', async () => {
      runtime.mockDomain('Inventory', {
        check: async () => ({ available: true }),
      })

      const pipeline: Pipeline = {
        path: ['Inventory', 'unknownMethod'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await expect(runtime.executeStep('step-1', pipeline, [], 'do')).rejects.toThrow(
        'Mocked domain "Inventory" does not have handler "unknownMethod"'
      )
    })
  })

  describe('clearMock', () => {
    it('removes a specific mock', async () => {
      runtime.mockDomain('Inventory', {
        check: async () => ({ available: true }),
      })

      const Inventory = Domain('Inventory', {
        check: async () => ({ available: false }),
      })
      registerDomain(Inventory)

      runtime.clearMock('Inventory')

      const pipeline: Pipeline = {
        path: ['Inventory', 'check'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      const result = await runtime.executeStep('step-1', pipeline, [], 'do')

      // Should use registered domain now
      expect(result).toEqual({ available: false })
    })
  })

  describe('clearAllMocks', () => {
    it('removes all mocks', async () => {
      runtime.mockDomain('Domain1', { method: async () => 'mock1' })
      runtime.mockDomain('Domain2', { method: async () => 'mock2' })

      expect(runtime.getMockedDomains().size).toBe(2)

      runtime.clearAllMocks()

      expect(runtime.getMockedDomains().size).toBe(0)
    })
  })

  // ==========================================================================
  // Time Control
  // ==========================================================================

  describe('advanceTime', () => {
    it('advances current time by specified milliseconds', () => {
      const startTime = 1000
      const rt = createTestWorkflowRuntime({ startTime })

      rt.advanceTime(500)

      expect(rt.getTime()).toBe(1500)
    })

    it('throws error for negative time', () => {
      expect(() => runtime.advanceTime(-100)).toThrow('Cannot advance time by negative amount')
    })
  })

  describe('setTime', () => {
    it('sets current time to specific value', () => {
      runtime.setTime(999999)
      expect(runtime.getTime()).toBe(999999)
    })
  })

  describe('getTime', () => {
    it('returns current simulated time', () => {
      const startTime = 12345
      const rt = createTestWorkflowRuntime({ startTime })

      expect(rt.getTime()).toBe(startTime)
    })
  })

  // ==========================================================================
  // State Inspection
  // ==========================================================================

  describe('getExecutedSteps', () => {
    it('returns all executed steps', async () => {
      const Test = Domain('Test', {
        action1: async () => 'result1',
        action2: async () => 'result2',
      })
      registerDomain(Test)

      const pipeline1: Pipeline = {
        path: ['Test', 'action1'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }
      const pipeline2: Pipeline = {
        path: ['Test', 'action2'],
        context: {},
        contextHash: 'hash-2',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline1, [], 'do')
      await runtime.executeStep('step-2', pipeline2, [], 'do')

      const steps = runtime.getExecutedSteps()
      expect(steps).toHaveLength(2)
      expect(steps[0].stepId).toBe('step-1')
      expect(steps[1].stepId).toBe('step-2')
    })

    it('returns a copy, not the original array', async () => {
      const Test = Domain('Test', {
        action: async () => 'result',
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline, [], 'do')

      const steps1 = runtime.getExecutedSteps()
      const steps2 = runtime.getExecutedSteps()

      expect(steps1).not.toBe(steps2)
      expect(steps1).toEqual(steps2)
    })
  })

  describe('getStepById', () => {
    it('returns specific step by ID', async () => {
      const Test = Domain('Test', {
        action: async () => ({ found: true }),
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('specific-step', pipeline, [], 'do')

      const step = runtime.getStepById('specific-step')
      expect(step).toBeDefined()
      expect(step?.stepId).toBe('specific-step')
      expect(step?.result).toEqual({ found: true })
    })

    it('returns undefined for non-existent step', () => {
      const step = runtime.getStepById('non-existent')
      expect(step).toBeUndefined()
    })
  })

  describe('getStepsByDomain', () => {
    it('returns steps filtered by domain', async () => {
      const Domain1 = Domain('Domain1', {
        method: async () => 'd1',
      })
      const Domain2 = Domain('Domain2', {
        method: async () => 'd2',
      })
      registerDomain(Domain1)
      registerDomain(Domain2)

      const pipeline1: Pipeline = {
        path: ['Domain1', 'method'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }
      const pipeline2: Pipeline = {
        path: ['Domain2', 'method'],
        context: {},
        contextHash: 'hash-2',
        runtime,
      }
      const pipeline3: Pipeline = {
        path: ['Domain1', 'method'],
        context: {},
        contextHash: 'hash-3',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline1, [], 'do')
      await runtime.executeStep('step-2', pipeline2, [], 'do')
      await runtime.executeStep('step-3', pipeline3, [], 'do')

      const domain1Steps = runtime.getStepsByDomain('Domain1')
      expect(domain1Steps).toHaveLength(2)

      const domain2Steps = runtime.getStepsByDomain('Domain2')
      expect(domain2Steps).toHaveLength(1)
    })
  })

  describe('getState', () => {
    it('returns comprehensive state snapshot', async () => {
      const startTime = 5000
      const rt = createTestWorkflowRuntime({ startTime })

      const Test = Domain('Test', {
        action: async () => 'ok',
      })
      registerDomain(Test)

      rt.mockDomain('MockedDomain', {
        method: async () => 'mocked',
      })

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime: rt,
      }

      await rt.executeStep('step-1', pipeline, [], 'do')

      const state = await rt.getState()

      expect(state.executedSteps).toHaveLength(1)
      expect(state.mockedDomains.size).toBe(1)
      expect(state.currentTime).toBeGreaterThanOrEqual(startTime)
      expect(state.totalExecutions).toBe(1)
      expect(state.successfulExecutions).toBe(1)
      expect(state.failedExecutions).toBe(0)
    })
  })

  // ==========================================================================
  // Failure Simulation
  // ==========================================================================

  describe('simulateStepFailure', () => {
    it('causes step to fail with specified error', async () => {
      const Test = Domain('Test', {
        action: async () => 'success',
      })
      registerDomain(Test)

      runtime.simulateStepFailure('step-1', new Error('Simulated failure'))

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await expect(runtime.executeStep('step-1', pipeline, [], 'do')).rejects.toThrow('Simulated failure')
    })

    it('respects failCount parameter', async () => {
      const Test = Domain('Test', {
        action: async () => 'success',
      })
      registerDomain(Test)

      // Fail only first 2 times
      runtime.simulateStepFailure('test', new Error('Simulated'), 2)

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      // First two calls should fail
      await expect(runtime.executeStep('test-step', pipeline, [], 'try')).rejects.toThrow('Simulated')
      await expect(runtime.executeStep('test-step', pipeline, [], 'try')).rejects.toThrow('Simulated')

      // Third call should succeed
      const result = await runtime.executeStep('test-step', pipeline, [], 'try')
      expect(result).toBe('success')
    })
  })

  describe('clearSimulatedFailure', () => {
    it('removes specific simulated failure', async () => {
      const Test = Domain('Test', {
        action: async () => 'success',
      })
      registerDomain(Test)

      runtime.simulateStepFailure('step', new Error('Will be cleared'))
      runtime.clearSimulatedFailure('step')

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      const result = await runtime.executeStep('step-1', pipeline, [], 'do')
      expect(result).toBe('success')
    })
  })

  describe('clearAllSimulatedFailures', () => {
    it('removes all simulated failures', async () => {
      const Test = Domain('Test', {
        action: async () => 'success',
      })
      registerDomain(Test)

      runtime.simulateStepFailure('step-1', new Error('Error 1'))
      runtime.simulateStepFailure('step-2', new Error('Error 2'))
      runtime.clearAllSimulatedFailures()

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      const result = await runtime.executeStep('step-1', pipeline, [], 'do')
      expect(result).toBe('success')
    })
  })

  // ==========================================================================
  // Assertions
  // ==========================================================================

  describe('assertStepExecuted', () => {
    it('passes when step was executed', async () => {
      const Test = Domain('Test', {
        action: async () => 'ok',
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('my-step', pipeline, [], 'do')

      expect(() => runtime.assertStepExecuted('my-step')).not.toThrow()
    })

    it('throws when step was not executed', () => {
      expect(() => runtime.assertStepExecuted('non-existent')).toThrow(
        'Expected step "non-existent" to be executed'
      )
    })
  })

  describe('assertStepNotExecuted', () => {
    it('passes when step was not executed', () => {
      expect(() => runtime.assertStepNotExecuted('non-existent')).not.toThrow()
    })

    it('throws when step was executed', async () => {
      const Test = Domain('Test', {
        action: async () => 'ok',
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('executed-step', pipeline, [], 'do')

      expect(() => runtime.assertStepNotExecuted('executed-step')).toThrow(
        'Expected step "executed-step" not to be executed'
      )
    })
  })

  describe('assertStepResult', () => {
    it('passes when result matches', async () => {
      const Test = Domain('Test', {
        action: async () => ({ status: 'success', count: 42 }),
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('result-step', pipeline, [], 'do')

      expect(() => runtime.assertStepResult('result-step', { status: 'success', count: 42 })).not.toThrow()
    })

    it('throws when result does not match', async () => {
      const Test = Domain('Test', {
        action: async () => ({ actual: 'value' }),
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('result-step', pipeline, [], 'do')

      expect(() => runtime.assertStepResult('result-step', { expected: 'different' })).toThrow(
        'result mismatch'
      )
    })

    it('throws when step was not executed', () => {
      expect(() => runtime.assertStepResult('non-existent', {})).toThrow('was not executed')
    })
  })

  describe('assertStepFailed', () => {
    it('passes when step failed', async () => {
      const Test = Domain('Test', {
        failing: async () => {
          throw new Error('Expected failure')
        },
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'failing'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await expect(runtime.executeStep('failing-step', pipeline, [], 'do')).rejects.toThrow()

      expect(() => runtime.assertStepFailed('failing-step')).not.toThrow()
    })

    it('passes when error message matches string', async () => {
      const Test = Domain('Test', {
        failing: async () => {
          throw new Error('Connection timeout')
        },
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'failing'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await expect(runtime.executeStep('failing-step', pipeline, [], 'do')).rejects.toThrow()

      expect(() => runtime.assertStepFailed('failing-step', 'timeout')).not.toThrow()
    })

    it('passes when error message matches regex', async () => {
      const Test = Domain('Test', {
        failing: async () => {
          throw new Error('Error code: E12345')
        },
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'failing'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await expect(runtime.executeStep('failing-step', pipeline, [], 'do')).rejects.toThrow()

      expect(() => runtime.assertStepFailed('failing-step', /E\d+/)).not.toThrow()
    })

    it('throws when step succeeded', async () => {
      const Test = Domain('Test', {
        action: async () => 'ok',
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('success-step', pipeline, [], 'do')

      expect(() => runtime.assertStepFailed('success-step')).toThrow('to fail')
    })
  })

  describe('assertHandlerCalled', () => {
    it('passes when handler was called', async () => {
      const Test = Domain('Test', {
        action: async () => 'ok',
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline, [], 'do')

      expect(() => runtime.assertHandlerCalled('Test', 'action')).not.toThrow()
    })

    it('passes when handler was called specific number of times', async () => {
      const Test = Domain('Test', {
        action: async () => 'ok',
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline, [], 'try')
      await runtime.executeStep('step-2', pipeline, [], 'try')
      await runtime.executeStep('step-3', pipeline, [], 'try')

      expect(() => runtime.assertHandlerCalled('Test', 'action', 3)).not.toThrow()
    })

    it('throws when handler was not called', () => {
      expect(() => runtime.assertHandlerCalled('Test', 'action')).toThrow('was not called')
    })

    it('throws when call count does not match', async () => {
      const Test = Domain('Test', {
        action: async () => 'ok',
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline, [], 'try')

      expect(() => runtime.assertHandlerCalled('Test', 'action', 5)).toThrow('1 times, expected 5')
    })
  })

  // ==========================================================================
  // Storage Access
  // ==========================================================================

  describe('getStorage', () => {
    it('returns the storage instance', () => {
      const storage = new InMemoryStepStorage()
      const rt = createTestWorkflowRuntime({ storage })

      expect(rt.getStorage()).toBe(storage)
    })
  })

  // ==========================================================================
  // Reset
  // ==========================================================================

  describe('reset', () => {
    it('clears executed steps', async () => {
      const Test = Domain('Test', {
        action: async () => 'ok',
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline, [], 'do')
      expect(runtime.getExecutedSteps()).toHaveLength(1)

      runtime.reset()
      expect(runtime.getExecutedSteps()).toHaveLength(0)
    })

    it('clears hooks', async () => {
      let hookCalled = false
      runtime.beforeStep(() => {
        hookCalled = true
      })

      runtime.reset()

      const Test = Domain('Test', {
        action: async () => 'ok',
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime,
      }

      await runtime.executeStep('step-1', pipeline, [], 'do')
      expect(hookCalled).toBe(false)
    })

    it('optionally clears mocks', () => {
      runtime.mockDomain('Test', { method: async () => 'mocked' })
      expect(runtime.getMockedDomains().size).toBe(1)

      runtime.reset({ clearMocks: true })
      expect(runtime.getMockedDomains().size).toBe(0)
    })

    it('optionally resets time', () => {
      const startTime = 1000
      const rt = createTestWorkflowRuntime({ startTime })
      rt.advanceTime(500)
      expect(rt.getTime()).toBe(1500)

      rt.reset({ resetTime: true })
      // Time should be reset to a new Date.now()
      expect(rt.getTime()).toBeGreaterThan(startTime)
    })

    it('optionally clears storage', async () => {
      const storage = new InMemoryStepStorage()
      const rt = createTestWorkflowRuntime({ storage })

      const Test = Domain('Test', {
        action: async () => 'ok',
      })
      registerDomain(Test)

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime: rt,
      }

      await rt.executeStep('step-1', pipeline, [], 'do')

      const beforeClear = await storage.list()
      expect(beforeClear.length).toBeGreaterThan(0)

      rt.reset({ clearStorage: true })

      const afterClear = await storage.list()
      expect(afterClear.length).toBe(0)
    })
  })

  // ==========================================================================
  // Durable Mode Replay
  // ==========================================================================

  describe('durable mode replay', () => {
    it('replays from storage on second execution', async () => {
      let callCount = 0
      const Test = Domain('Test', {
        action: async () => {
          callCount++
          return { callCount }
        },
      })
      registerDomain(Test)

      const storage = new InMemoryStepStorage()
      const rt = createTestWorkflowRuntime({ storage })

      const pipeline: Pipeline = {
        path: ['Test', 'action'],
        context: {},
        contextHash: 'hash-1',
        runtime: rt,
      }

      // First execution
      const result1 = await rt.executeStep('replay-step', pipeline, [], 'do')
      expect(result1).toEqual({ callCount: 1 })
      expect(callCount).toBe(1)

      // Second execution should replay
      const result2 = await rt.executeStep('replay-step', pipeline, [], 'do')
      expect(result2).toEqual({ callCount: 1 }) // Same result
      expect(callCount).toBe(1) // Handler not called again
    })
  })
})
