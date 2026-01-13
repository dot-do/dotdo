/**
 * Tests for Inngest Compat Layer WorkflowCore Integration
 *
 * Tests that the Inngest compat layer can use WorkflowCoreStorageStrategy
 * for unified primitives support (ExactlyOnce, History, Timers, Versioning).
 *
 * TDD approach: NO MOCKS - tests use real WorkflowCore primitives.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  WorkflowCoreStorageStrategy,
  createWorkflowCoreStorageStrategy,
} from '../../core/workflow-core-storage'

describe('Inngest + WorkflowCore Integration', () => {
  let strategy: WorkflowCoreStorageStrategy

  beforeEach(() => {
    strategy = createWorkflowCoreStorageStrategy({
      workflowId: 'inngest-workflow-1',
      enableHistory: true,
    })
  })

  afterEach(() => {
    strategy.dispose()
  })

  describe('Step Execution (step.run equivalent)', () => {
    it('should execute steps exactly once like Inngest step.run', async () => {
      let callCount = 0

      // Simulate step.run('fetch-user', async () => { ... })
      const result1 = await strategy.executeStep('fetch-user', async () => {
        callCount++
        return { userId: '123', name: 'Alice' }
      })

      // On replay, should return cached result
      const result2 = await strategy.executeStep('fetch-user', async () => {
        callCount++
        return { userId: '999', name: 'Should not run' }
      })

      expect(result1).toEqual({ userId: '123', name: 'Alice' })
      expect(result2).toEqual({ userId: '123', name: 'Alice' })
      expect(callCount).toBe(1)
    })

    it('should handle step failures like Inngest', async () => {
      // First attempt fails
      await expect(
        strategy.executeStep('failing-step', async () => {
          throw new Error('API temporarily unavailable')
        })
      ).rejects.toThrow('API temporarily unavailable')

      // In Inngest, this would be retried - our strategy caches the error
      await expect(
        strategy.executeStep('failing-step', async () => 'success')
      ).rejects.toThrow('API temporarily unavailable')
    })
  })

  describe('Sleep (step.sleep equivalent)', () => {
    it('should sleep and cache completion like Inngest step.sleep', async () => {
      const start = Date.now()

      // Simulate step.sleep('wait-before-email', '50ms')
      await strategy.sleep('wait-before-email', 50, '50ms')

      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)

      // On replay, should return immediately
      const replayStart = Date.now()
      await strategy.sleep('wait-before-email', 50, '50ms')
      const replayElapsed = Date.now() - replayStart

      expect(replayElapsed).toBeLessThan(20)
    })
  })

  describe('History Tracking', () => {
    it('should record workflow history like Inngest run history', async () => {
      await strategy.executeStep('step-1', async () => 'a')
      await strategy.sleep('wait', 10, '10ms')
      await strategy.executeStep('step-2', async () => 'b')

      const history = await strategy.getHistory()

      // Should have step events and timer events
      expect(history.length).toBeGreaterThanOrEqual(4)

      const stepCompleted = history.filter((e) => e.type === 'STEP_COMPLETED')
      const timerEvents = history.filter((e) =>
        ['TIMER_STARTED', 'TIMER_FIRED'].includes(e.type)
      )

      expect(stepCompleted).toHaveLength(2)
      expect(timerEvents).toHaveLength(2)
    })

    it('should support time-travel debugging', async () => {
      const t1 = Date.now()
      await strategy.executeStep('early-step', async () => 'first')

      await new Promise((r) => setTimeout(r, 15))
      const t2 = Date.now()

      await strategy.executeStep('late-step', async () => 'second')

      // Query history at t1 + 10ms should only show first step
      const historyAtT1 = await strategy.getHistoryAsOf(t1 + 10)
      expect(historyAtT1).toHaveLength(1)

      // Full history should show both
      const fullHistory = await strategy.getHistory()
      expect(fullHistory.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Checkpointing (for durability)', () => {
    it('should checkpoint and restore workflow state', async () => {
      // Execute some steps
      await strategy.executeStep('step-1', async () => 'result-1')
      await strategy.executeStep('step-2', async () => 'result-2')
      strategy.applyPatch('v1-schema')

      // Create checkpoint
      const checkpoint = await strategy.checkpoint()

      // Create new strategy (simulate restart)
      const newStrategy = createWorkflowCoreStorageStrategy({
        workflowId: 'inngest-workflow-1',
      })

      await newStrategy.restore(checkpoint)

      // Verify restored state
      expect(await newStrategy.isStepCompleted('step-1')).toBe(true)
      expect(await newStrategy.isStepCompleted('step-2')).toBe(true)
      expect(newStrategy.isPatchApplied('v1-schema')).toBe(true)

      // New steps should still work
      let step3Executed = false
      await newStrategy.executeStep('step-3', async () => {
        step3Executed = true
        return 'result-3'
      })

      expect(step3Executed).toBe(true)

      newStrategy.dispose()
    })
  })

  describe('Versioning (for schema evolution)', () => {
    it('should support workflow versioning like Inngest schema changes', () => {
      expect(strategy.getVersion()).toBe(0)

      // Apply patches for schema evolution
      strategy.applyPatch('add-user-metadata')
      expect(strategy.getVersion()).toBe(1)

      strategy.applyPatch('add-order-status')
      expect(strategy.getVersion()).toBe(2)

      // Patches should not re-apply
      const reapplied = strategy.applyPatch('add-user-metadata')
      expect(reapplied).toBe(false)
      expect(strategy.getVersion()).toBe(2)
    })
  })
})

describe('Inngest-style Workflow Patterns with WorkflowCore', () => {
  it('should support a complete order processing workflow', async () => {
    const strategy = createWorkflowCoreStorageStrategy({
      workflowId: 'order-processing-123',
      enableHistory: true,
    })

    // Step 1: Fetch order
    const order = await strategy.executeStep('fetch-order', async () => ({
      id: 'ord-123',
      userId: 'user-456',
      amount: 99.99,
    }))

    // Step 2: Validate payment
    const paymentValid = await strategy.executeStep('validate-payment', async () => ({
      valid: true,
      paymentId: 'pay-789',
    }))

    // Step 3: Wait for fulfillment window
    await strategy.sleep('fulfillment-delay', 10, '10ms')

    // Step 4: Process fulfillment
    const fulfillment = await strategy.executeStep('process-fulfillment', async () => ({
      status: 'shipped',
      trackingId: 'TRK-001',
    }))

    // Step 5: Send notification
    const notification = await strategy.executeStep('send-notification', async () => ({
      sent: true,
      channel: 'email',
    }))

    // Verify all steps completed
    expect(order.id).toBe('ord-123')
    expect(paymentValid.valid).toBe(true)
    expect(fulfillment.status).toBe('shipped')
    expect(notification.sent).toBe(true)

    // Verify history
    const history = await strategy.getHistory()
    const stepEvents = history.filter((e) => e.type === 'STEP_COMPLETED')
    expect(stepEvents).toHaveLength(4)

    strategy.dispose()
  })

  it('should support parallel step execution', async () => {
    const strategy = createWorkflowCoreStorageStrategy({
      workflowId: 'parallel-workflow',
    })

    // Execute steps in parallel (like step.parallel in Inngest)
    const [userResult, orderResult, inventoryResult] = await Promise.all([
      strategy.executeStep('fetch-user', async () => ({ name: 'Alice' })),
      strategy.executeStep('fetch-order', async () => ({ total: 100 })),
      strategy.executeStep('check-inventory', async () => ({ available: true })),
    ])

    expect(userResult.name).toBe('Alice')
    expect(orderResult.total).toBe(100)
    expect(inventoryResult.available).toBe(true)

    // All steps should be completed
    expect(await strategy.isStepCompleted('fetch-user')).toBe(true)
    expect(await strategy.isStepCompleted('fetch-order')).toBe(true)
    expect(await strategy.isStepCompleted('check-inventory')).toBe(true)

    strategy.dispose()
  })

  it('should support conditional step execution', async () => {
    const strategy = createWorkflowCoreStorageStrategy({
      workflowId: 'conditional-workflow',
    })

    const order = await strategy.executeStep('fetch-order', async () => ({
      requiresApproval: true,
      amount: 5000,
    }))

    let approvalResult = null
    if (order.requiresApproval) {
      approvalResult = await strategy.executeStep('get-approval', async () => ({
        approved: true,
        approvedBy: 'manager@company.com',
      }))
    }

    const processed = await strategy.executeStep('process-order', async () => ({
      processed: true,
      approvalUsed: approvalResult !== null,
    }))

    expect(approvalResult).not.toBeNull()
    expect(approvalResult?.approved).toBe(true)
    expect(processed.approvalUsed).toBe(true)

    strategy.dispose()
  })
})
