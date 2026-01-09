/**
 * WorkflowTestHarness Tests
 *
 * RED TDD: These tests define the expected interface for WorkflowTestHarness.
 *
 * WorkflowTestHarness provides:
 * - Create harness from workflow definition
 * - Mock step handlers
 * - Control time for timeout testing
 * - Simulate events for waitForEvent
 * - Capture step executions for assertions
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// This import will FAIL - WorkflowTestHarness doesn't exist yet
import { WorkflowTestHarness, type WorkflowTestHarnessOptions } from '../../tests/harness/workflow-harness'

import {
  Workflow,
  type WorkflowBuilder,
  type WorkflowStepHandler,
  type StepContext,
} from '../WorkflowFactory'

// ============================================================================
// TEST WORKFLOWS
// ============================================================================

const validateOrder: WorkflowStepHandler = async (input: unknown, ctx: StepContext) => {
  const order = input as { items: unknown[]; total: number }
  if (!order.items || order.items.length === 0) {
    throw new Error('Order must have items')
  }
  return { validated: true, order }
}

const chargePayment: WorkflowStepHandler = async (input: unknown, ctx: StepContext) => {
  const { order } = input as { order: { total: number } }
  return { charged: true, amount: order.total, transactionId: 'txn_123' }
}

const fulfillOrder: WorkflowStepHandler = async (input: unknown, ctx: StepContext) => {
  return { fulfilled: true, trackingNumber: 'TRK_456' }
}

function createOrderWorkflow(): WorkflowBuilder {
  return Workflow({
    name: 'order-processing',
    description: 'Process customer orders',
  })
    .step('validate', validateOrder)
    .step('charge', chargePayment)
    .step('fulfill', fulfillOrder)
}

function createApprovalWorkflow(): WorkflowBuilder {
  return Workflow({
    name: 'approval-workflow',
  })
    .step('submit', async (input) => ({ submitted: true, ...input as object }))
    .step('awaitApproval', {
      type: 'waitForEvent',
      event: 'approval.received',
      timeout: 86400000, // 24 hours
    })
    .step('process', async (input) => ({ processed: true, approval: input }))
}

function createDelayedWorkflow(): WorkflowBuilder {
  return Workflow({
    name: 'delayed-workflow',
  })
    .step('start', async () => ({ started: true }))
    .step('wait', { type: 'sleep', duration: 5000 })
    .step('complete', async () => ({ completed: true }))
}

// ============================================================================
// TESTS
// ============================================================================

describe('WorkflowTestHarness', () => {
  // ==========================================================================
  // 1. HARNESS CREATION
  // ==========================================================================

  describe('Harness Creation', () => {
    it('creates a harness from workflow builder', () => {
      const workflow = createOrderWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      expect(harness).toBeDefined()
      expect(harness.workflowName).toBe('order-processing')
    })

    it('creates a harness with options', () => {
      const workflow = createOrderWorkflow()
      const options: WorkflowTestHarnessOptions = {
        initialTime: new Date('2024-01-01T00:00:00Z'),
      }

      const harness = new WorkflowTestHarness(workflow, options)

      expect(harness).toBeDefined()
      expect(harness.currentTime.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    })

    it('extracts step definitions from workflow', () => {
      const workflow = createOrderWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      expect(harness.stepNames).toEqual(['validate', 'charge', 'fulfill'])
    })

    it('creates harness with empty state', () => {
      const workflow = createOrderWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      expect(harness.getStepCalls('validate')).toHaveLength(0)
      expect(harness.getStepCalls('charge')).toHaveLength(0)
      expect(harness.getStepCalls('fulfill')).toHaveLength(0)
    })
  })

  // ==========================================================================
  // 2. STEP MOCKING
  // ==========================================================================

  describe('Step Mocking', () => {
    let workflow: WorkflowBuilder
    let harness: WorkflowTestHarness

    beforeEach(() => {
      workflow = createOrderWorkflow()
      harness = new WorkflowTestHarness(workflow)
    })

    it('mocks a step with a custom handler', async () => {
      harness.mockStep('charge', async () => ({ mocked: true, amount: 0 }))

      const result = await harness.run({ items: ['item1'], total: 100 })

      expect(result.stepResults.charge).toEqual({ mocked: true, amount: 0 })
    })

    it('allows mocking multiple steps', async () => {
      harness.mockStep('validate', async () => ({ validated: true, order: { total: 50 } }))
      harness.mockStep('charge', async () => ({ charged: true, amount: 50, transactionId: 'mock_txn' }))

      const result = await harness.run({ items: ['item1'], total: 100 })

      expect(result.stepResults.validate).toEqual({ validated: true, order: { total: 50 } })
      expect(result.stepResults.charge).toEqual({ charged: true, amount: 50, transactionId: 'mock_txn' })
    })

    it('mock handler receives step input and context', async () => {
      let receivedInput: unknown = null
      let receivedCtx: StepContext | null = null

      harness.mockStep('charge', async (input, ctx) => {
        receivedInput = input
        receivedCtx = ctx
        return { charged: true, amount: 0, transactionId: 'test' }
      })

      await harness.run({ items: ['item1'], total: 100 })

      expect(receivedInput).toBeDefined()
      expect((receivedInput as { validated: boolean }).validated).toBe(true)
      expect(receivedCtx).toBeDefined()
      expect(receivedCtx!.stepName).toBe('charge')
    })

    it('mocked step can throw errors', async () => {
      harness.mockStep('charge', async () => {
        throw new Error('Payment declined')
      })

      await expect(harness.run({ items: ['item1'], total: 100 })).rejects.toThrow('Payment declined')
    })

    it('unmocked steps use original handlers', async () => {
      // Only mock charge, validate and fulfill use original handlers
      harness.mockStep('charge', async () => ({ charged: true, amount: 0, transactionId: 'mock' }))

      const result = await harness.run({ items: ['item1'], total: 100 })

      // Validate ran with original handler
      expect(result.stepResults.validate.validated).toBe(true)
      // Charge ran with mocked handler
      expect(result.stepResults.charge.transactionId).toBe('mock')
      // Fulfill ran with original handler
      expect(result.stepResults.fulfill.fulfilled).toBe(true)
    })

    it('can clear all mocks', async () => {
      harness.mockStep('charge', async () => ({ charged: false }))

      harness.clearMocks()

      const result = await harness.run({ items: ['item1'], total: 100 })

      // Original handler should be used
      expect(result.stepResults.charge.charged).toBe(true)
      expect(result.stepResults.charge.transactionId).toBe('txn_123')
    })

    it('can clear a specific mock', async () => {
      harness.mockStep('validate', async () => ({ validated: false, order: {} }))
      harness.mockStep('charge', async () => ({ charged: false }))

      harness.clearMock('validate')

      const result = await harness.run({ items: ['item1'], total: 100 })

      // validate uses original handler
      expect(result.stepResults.validate.validated).toBe(true)
      // charge still uses mock
      expect(result.stepResults.charge.charged).toBe(false)
    })

    it('throws when mocking non-existent step', () => {
      expect(() => {
        harness.mockStep('nonexistent', async () => ({}))
      }).toThrow(/step.*nonexistent.*not found/i)
    })
  })

  // ==========================================================================
  // 3. STEP EXECUTION CAPTURE
  // ==========================================================================

  describe('Step Execution Capture', () => {
    let workflow: WorkflowBuilder
    let harness: WorkflowTestHarness

    beforeEach(() => {
      workflow = createOrderWorkflow()
      harness = new WorkflowTestHarness(workflow)
    })

    it('captures step calls', async () => {
      await harness.run({ items: ['item1'], total: 100 })

      expect(harness.getStepCalls('validate')).toHaveLength(1)
      expect(harness.getStepCalls('charge')).toHaveLength(1)
      expect(harness.getStepCalls('fulfill')).toHaveLength(1)
    })

    it('captures step input for each call', async () => {
      await harness.run({ items: ['item1'], total: 100 })

      const validateCalls = harness.getStepCalls('validate')
      expect(validateCalls[0].input).toEqual({ items: ['item1'], total: 100 })
    })

    it('captures step output for each call', async () => {
      await harness.run({ items: ['item1'], total: 100 })

      const chargeCalls = harness.getStepCalls('charge')
      expect(chargeCalls[0].output).toEqual({
        charged: true,
        amount: 100,
        transactionId: 'txn_123',
      })
    })

    it('captures step duration', async () => {
      await harness.run({ items: ['item1'], total: 100 })

      const validateCalls = harness.getStepCalls('validate')
      expect(validateCalls[0].duration).toBeGreaterThanOrEqual(0)
    })

    it('captures errors from failed steps', async () => {
      harness.mockStep('charge', async () => {
        throw new Error('Payment failed')
      })

      try {
        await harness.run({ items: ['item1'], total: 100 })
      } catch {
        // Expected error
      }

      const chargeCalls = harness.getStepCalls('charge')
      expect(chargeCalls[0].error).toBeDefined()
      expect(chargeCalls[0].error!.message).toBe('Payment failed')
    })

    it('clears captured calls on reset', async () => {
      await harness.run({ items: ['item1'], total: 100 })
      expect(harness.getStepCalls('validate')).toHaveLength(1)

      harness.reset()

      expect(harness.getStepCalls('validate')).toHaveLength(0)
    })

    it('tracks call order across steps', async () => {
      await harness.run({ items: ['item1'], total: 100 })

      const allCalls = harness.getAllStepCalls()

      expect(allCalls.map((c) => c.stepName)).toEqual(['validate', 'charge', 'fulfill'])
    })

    it('captures multiple workflow runs', async () => {
      await harness.run({ items: ['item1'], total: 100 })
      await harness.run({ items: ['item2'], total: 200 })

      expect(harness.getStepCalls('validate')).toHaveLength(2)
      expect(harness.getStepCalls('validate')[0].input).toEqual({ items: ['item1'], total: 100 })
      expect(harness.getStepCalls('validate')[1].input).toEqual({ items: ['item2'], total: 200 })
    })
  })

  // ==========================================================================
  // 4. TIME CONTROL
  // ==========================================================================

  describe('Time Control', () => {
    it('starts with configurable initial time', () => {
      const workflow = createDelayedWorkflow()
      const harness = new WorkflowTestHarness(workflow, {
        initialTime: new Date('2024-06-15T12:00:00Z'),
      })

      expect(harness.currentTime.toISOString()).toBe('2024-06-15T12:00:00.000Z')
    })

    it('advances time manually', () => {
      const workflow = createDelayedWorkflow()
      const harness = new WorkflowTestHarness(workflow, {
        initialTime: new Date('2024-06-15T12:00:00Z'),
      })

      harness.advanceTime(5000) // 5 seconds

      expect(harness.currentTime.toISOString()).toBe('2024-06-15T12:00:05.000Z')
    })

    it('advances time with string duration', () => {
      const workflow = createDelayedWorkflow()
      const harness = new WorkflowTestHarness(workflow, {
        initialTime: new Date('2024-06-15T12:00:00Z'),
      })

      harness.advanceTime('5 minutes')

      expect(harness.currentTime.toISOString()).toBe('2024-06-15T12:05:00.000Z')
    })

    it('sleep steps complete instantly in test mode', async () => {
      const workflow = createDelayedWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      const startTime = Date.now()
      await harness.run({})
      const duration = Date.now() - startTime

      // Should complete nearly instantly, not wait 5 seconds
      expect(duration).toBeLessThan(100)
    })

    it('tracks total simulated time elapsed', async () => {
      const workflow = createDelayedWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      await harness.run({})

      // Workflow has a 5 second sleep
      expect(harness.elapsedTime).toBe(5000)
    })

    it('supports timeout testing with controlled time', async () => {
      const workflow = createApprovalWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      // Start workflow - it will pause at waitForEvent
      const runPromise = harness.run({ requestId: '123' })

      // Advance time past the 24 hour timeout
      harness.advanceTime('25 hours')

      // Should timeout
      await expect(runPromise).rejects.toThrow(/timeout/i)
    })

    it('resets time on harness reset', () => {
      const workflow = createDelayedWorkflow()
      const harness = new WorkflowTestHarness(workflow, {
        initialTime: new Date('2024-06-15T12:00:00Z'),
      })

      harness.advanceTime('1 hour')
      harness.reset()

      expect(harness.currentTime.toISOString()).toBe('2024-06-15T12:00:00.000Z')
    })
  })

  // ==========================================================================
  // 5. EVENT SIMULATION
  // ==========================================================================

  describe('Event Simulation', () => {
    let workflow: WorkflowBuilder
    let harness: WorkflowTestHarness

    beforeEach(() => {
      workflow = createApprovalWorkflow()
      harness = new WorkflowTestHarness(workflow)
    })

    it('simulates event delivery to waitForEvent step', async () => {
      // Start workflow - it pauses at waitForEvent
      const runPromise = harness.run({ requestId: '123' })

      // Wait for workflow to reach the waitForEvent step
      await harness.waitForStep('awaitApproval')

      // Simulate event
      harness.simulateEvent('approval.received', { approved: true, by: 'manager' })

      const result = await runPromise

      expect(result.stepResults.process.processed).toBe(true)
    })

    it('event payload is passed to next step', async () => {
      const runPromise = harness.run({ requestId: '123' })

      await harness.waitForStep('awaitApproval')

      harness.simulateEvent('approval.received', { approved: true, approver: 'john' })

      const result = await runPromise

      expect(result.stepResults.process.approval).toEqual({ approved: true, approver: 'john' })
    })

    it('can queue events before workflow reaches waitForEvent', async () => {
      // Queue event before starting
      harness.queueEvent('approval.received', { approved: true })

      const result = await harness.run({ requestId: '123' })

      // Workflow should complete without waiting
      expect(result.stepResults.process.processed).toBe(true)
    })

    it('handles multiple waitForEvent steps', async () => {
      const multiWaitWorkflow = Workflow({ name: 'multi-wait' })
        .step('init', async () => ({ initialized: true }))
        .step('firstWait', { type: 'waitForEvent', event: 'first.event', timeout: 60000 })
        .step('secondWait', { type: 'waitForEvent', event: 'second.event', timeout: 60000 })
        .step('done', async () => ({ completed: true }))

      const h = new WorkflowTestHarness(multiWaitWorkflow)

      const runPromise = h.run({})

      await h.waitForStep('firstWait')
      h.simulateEvent('first.event', { data: 'first' })

      await h.waitForStep('secondWait')
      h.simulateEvent('second.event', { data: 'second' })

      const result = await runPromise
      expect(result.stepResults.done.completed).toBe(true)
    })

    it('tracks pending events', async () => {
      const runPromise = harness.run({ requestId: '123' })

      await harness.waitForStep('awaitApproval')

      expect(harness.pendingEvents).toContain('approval.received')

      harness.simulateEvent('approval.received', {})

      await runPromise

      expect(harness.pendingEvents).not.toContain('approval.received')
    })

    it('ignores events for non-matching event types', async () => {
      const runPromise = harness.run({ requestId: '123' })

      await harness.waitForStep('awaitApproval')

      // Send wrong event type
      harness.simulateEvent('wrong.event', { data: 'wrong' })

      // Workflow should still be waiting
      expect(harness.currentStep).toBe('awaitApproval')

      // Send correct event to complete
      harness.simulateEvent('approval.received', { approved: true })

      await runPromise
    })
  })

  // ==========================================================================
  // 6. WORKFLOW EXECUTION
  // ==========================================================================

  describe('Workflow Execution', () => {
    it('runs workflow and returns result', async () => {
      const workflow = createOrderWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      const result = await harness.run({ items: ['item1'], total: 100 })

      expect(result.status).toBe('completed')
      expect(result.output).toBeDefined()
    })

    it('returns step results for each step', async () => {
      const workflow = createOrderWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      const result = await harness.run({ items: ['item1'], total: 100 })

      expect(result.stepResults.validate).toBeDefined()
      expect(result.stepResults.charge).toBeDefined()
      expect(result.stepResults.fulfill).toBeDefined()
    })

    it('returns final output from last step', async () => {
      const workflow = createOrderWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      const result = await harness.run({ items: ['item1'], total: 100 })

      expect(result.output).toEqual({ fulfilled: true, trackingNumber: 'TRK_456' })
    })

    it('returns failed status when step throws', async () => {
      const workflow = createOrderWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      // Invalid input - no items
      await expect(harness.run({ items: [], total: 100 })).rejects.toThrow('Order must have items')
    })

    it('stops execution at first failed step', async () => {
      const workflow = createOrderWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      harness.mockStep('charge', async () => {
        throw new Error('Payment failed')
      })

      try {
        await harness.run({ items: ['item1'], total: 100 })
      } catch {
        // Expected
      }

      // fulfill step should not have been called
      expect(harness.getStepCalls('fulfill')).toHaveLength(0)
    })

    it('provides workflow instance ID', async () => {
      const workflow = createOrderWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      const result = await harness.run({ items: ['item1'], total: 100 })

      expect(result.instanceId).toBeDefined()
      expect(typeof result.instanceId).toBe('string')
    })

    it('tracks current step during execution', async () => {
      const workflow = createOrderWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      const stepsObserved: string[] = []

      harness.mockStep('validate', async (input, ctx) => {
        stepsObserved.push(harness.currentStep!)
        return validateOrder(input, ctx)
      })
      harness.mockStep('charge', async (input, ctx) => {
        stepsObserved.push(harness.currentStep!)
        return chargePayment(input, ctx)
      })
      harness.mockStep('fulfill', async (input, ctx) => {
        stepsObserved.push(harness.currentStep!)
        return fulfillOrder(input, ctx)
      })

      await harness.run({ items: ['item1'], total: 100 })

      expect(stepsObserved).toEqual(['validate', 'charge', 'fulfill'])
    })
  })

  // ==========================================================================
  // 7. ASSERTIONS & HELPERS
  // ==========================================================================

  describe('Assertions & Helpers', () => {
    let workflow: WorkflowBuilder
    let harness: WorkflowTestHarness

    beforeEach(() => {
      workflow = createOrderWorkflow()
      harness = new WorkflowTestHarness(workflow)
    })

    it('assertStepCalled checks if step was executed', async () => {
      await harness.run({ items: ['item1'], total: 100 })

      expect(() => harness.assertStepCalled('validate')).not.toThrow()
      expect(() => harness.assertStepCalled('nonexistent')).toThrow()
    })

    it('assertStepCalledWith checks step input', async () => {
      await harness.run({ items: ['item1'], total: 100 })

      expect(() =>
        harness.assertStepCalledWith('validate', { items: ['item1'], total: 100 })
      ).not.toThrow()

      expect(() =>
        harness.assertStepCalledWith('validate', { items: ['wrong'], total: 999 })
      ).toThrow()
    })

    it('assertStepOutput checks step output', async () => {
      await harness.run({ items: ['item1'], total: 100 })

      expect(() =>
        harness.assertStepOutput('fulfill', { fulfilled: true, trackingNumber: 'TRK_456' })
      ).not.toThrow()

      expect(() =>
        harness.assertStepOutput('fulfill', { fulfilled: false })
      ).toThrow()
    })

    it('assertStepNotCalled checks step was not executed', async () => {
      harness.mockStep('validate', async () => {
        throw new Error('Validation failed')
      })

      try {
        await harness.run({ items: ['item1'], total: 100 })
      } catch {
        // Expected
      }

      expect(() => harness.assertStepNotCalled('fulfill')).not.toThrow()
      expect(() => harness.assertStepNotCalled('validate')).toThrow()
    })

    it('assertNoErrors checks all steps completed without errors', async () => {
      await harness.run({ items: ['item1'], total: 100 })

      expect(() => harness.assertNoErrors()).not.toThrow()
    })

    it('assertNoErrors throws when step failed', async () => {
      harness.mockStep('charge', async () => {
        throw new Error('Payment failed')
      })

      try {
        await harness.run({ items: ['item1'], total: 100 })
      } catch {
        // Expected
      }

      expect(() => harness.assertNoErrors()).toThrow()
    })

    it('getStepInput returns input for a step', async () => {
      await harness.run({ items: ['item1'], total: 100 })

      const input = harness.getStepInput('validate')
      expect(input).toEqual({ items: ['item1'], total: 100 })
    })

    it('getStepOutput returns output for a step', async () => {
      await harness.run({ items: ['item1'], total: 100 })

      const output = harness.getStepOutput('fulfill')
      expect(output).toEqual({ fulfilled: true, trackingNumber: 'TRK_456' })
    })
  })

  // ==========================================================================
  // 8. STEP CONTEXT MOCKING
  // ==========================================================================

  describe('Step Context Mocking', () => {
    it('provides mock emit function', async () => {
      const workflow = createOrderWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      let emitCalled = false
      harness.mockStep('validate', async (input, ctx) => {
        await ctx.emit('validation.complete', { status: 'ok' })
        emitCalled = true
        return { validated: true, order: input }
      })

      await harness.run({ items: ['item1'], total: 100 })

      expect(emitCalled).toBe(true)
      expect(harness.getEmittedEvents()).toContainEqual({
        event: 'validation.complete',
        data: { status: 'ok' },
      })
    })

    it('provides mock log function', async () => {
      const workflow = createOrderWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      harness.mockStep('validate', async (input, ctx) => {
        ctx.log('Validating order', { items: (input as { items: unknown[] }).items.length })
        return { validated: true, order: input }
      })

      await harness.run({ items: ['item1'], total: 100 })

      expect(harness.getLogs()).toContainEqual({
        message: 'Validating order',
        data: { items: 1 },
      })
    })

    it('provides mock sleep function', async () => {
      const workflow = createOrderWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      let sleepCalled = false
      harness.mockStep('validate', async (input, ctx) => {
        await ctx.sleep(1000)
        sleepCalled = true
        return { validated: true, order: input }
      })

      const startTime = Date.now()
      await harness.run({ items: ['item1'], total: 100 })
      const duration = Date.now() - startTime

      expect(sleepCalled).toBe(true)
      // Sleep should be instant in test mode
      expect(duration).toBeLessThan(100)
    })

    it('provides workflowId and instanceId in context', async () => {
      const workflow = createOrderWorkflow()
      const harness = new WorkflowTestHarness(workflow)

      let workflowId: string | null = null
      let instanceId: string | null = null

      harness.mockStep('validate', async (input, ctx) => {
        workflowId = ctx.workflowId
        instanceId = ctx.instanceId
        return { validated: true, order: input }
      })

      await harness.run({ items: ['item1'], total: 100 })

      expect(workflowId).toBe('order-processing')
      expect(instanceId).toBeDefined()
    })
  })

  // ==========================================================================
  // 9. COMPLETE WORKFLOW EXAMPLE
  // ==========================================================================

  describe('Complete Workflow Example', () => {
    it('demonstrates full harness usage from spec', async () => {
      const myWorkflow = Workflow({
        name: 'order-processing',
      })
        .step('validate', async (input) => {
          const order = input as { orderId: string; amount: number }
          return { validated: true, orderId: order.orderId }
        })
        .step('charge', async (input) => {
          const { orderId } = input as { orderId: string }
          // In real code, this would call a payment service
          return { success: true, orderId, transactionId: 'real_txn' }
        })
        .step('fulfill', async (input) => {
          return { shipped: true }
        })

      const harness = new WorkflowTestHarness(myWorkflow)

      // Mock a step
      harness.mockStep('charge', async () => ({ success: true, transactionId: 'mock_txn' }))

      // Run workflow
      const result = await harness.run({ orderId: '123', amount: 99.99 })

      // Assert step was called
      expect(harness.getStepCalls('charge')).toHaveLength(1)

      // Assert mocked result was used
      expect(result.stepResults.charge.transactionId).toBe('mock_txn')
    })

    it('demonstrates time control from spec', async () => {
      const workflow = Workflow({ name: 'timed-workflow' })
        .step('start', async () => ({ started: true }))
        .step('wait', { type: 'sleep', duration: 300000 }) // 5 minutes
        .step('complete', async () => ({ completed: true }))

      const harness = new WorkflowTestHarness(workflow)

      const startTime = Date.now()
      await harness.run({})
      const realDuration = Date.now() - startTime

      // Real time should be minimal
      expect(realDuration).toBeLessThan(100)

      // But simulated time should be 5 minutes
      expect(harness.elapsedTime).toBe(300000)
    })

    it('demonstrates event simulation from spec', async () => {
      const workflow = Workflow({ name: 'event-workflow' })
        .step('request', async () => ({ requested: true }))
        .step('awaitApproval', {
          type: 'waitForEvent',
          event: 'approval',
          timeout: 86400000,
        })
        .step('process', async (input) => ({ approved: input }))

      const harness = new WorkflowTestHarness(workflow)

      // Queue the event before running
      harness.queueEvent('approval', { by: 'manager', approved: true })

      const result = await harness.run({})

      expect(result.stepResults.process.approved).toEqual({ by: 'manager', approved: true })
    })
  })
})
