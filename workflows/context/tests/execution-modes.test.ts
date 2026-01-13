/**
 * Tests for Workflow Context Execution Modes
 *
 * Tests the three durability levels for workflow execution:
 * - $.send (fire-and-forget) - Non-blocking, non-durable
 * - $.try (single attempt) - Blocking, non-durable
 * - $.do (durable with retries) - Blocking, durable with retry logic
 *
 * Also tests:
 * - Context isolation between workflow instances
 * - Error recovery and propagation
 * - Execution mode selection and behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createWorkflowRuntime,
  createTestRuntime,
  DurableWorkflowRuntime,
  InMemoryStepStorage,
  HandlerNotFoundError,
  WorkflowStepError,
  type StepStorage,
  type StepResult,
  type ExecutionMode,
} from '../../runtime'
import { Domain, registerDomain, clearDomainRegistry } from '../../domain'
import { createWorkflowProxy, type Pipeline } from '../../proxy'

describe('Workflow Context Execution Modes', () => {
  beforeEach(() => {
    clearDomainRegistry()
  })

  afterEach(() => {
    clearDomainRegistry()
  })

  // ==========================================================================
  // $.send - Fire-and-Forget Execution
  // ==========================================================================

  describe('$.send (fire-and-forget)', () => {
    it('returns immediately without waiting for handler completion', async () => {
      let handlerStarted = false
      let handlerCompleted = false

      const Order = Domain('Order', {
        process: async () => {
          handlerStarted = true
          await new Promise((resolve) => setTimeout(resolve, 50))
          handlerCompleted = true
          return { processed: true }
        },
      })
      registerDomain(Order)

      const runtime = createTestRuntime()
      const pipeline: Pipeline = {
        path: ['Order', 'process'],
        context: { orderId: '123' },
        contextHash: 'order-123',
        runtime,
      }

      // Fire-and-forget should return immediately
      const result = await runtime.executeStep('send-step-1', pipeline, [], 'send')

      // Result should be undefined (no waiting)
      expect(result).toBeUndefined()
      // Handler might not have started yet
      expect(handlerCompleted).toBe(false)

      // Wait for background execution
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(handlerStarted).toBe(true)
      expect(handlerCompleted).toBe(true)
    })

    it('does not persist step results', async () => {
      const Order = Domain('Order', {
        notify: async () => ({ sent: true }),
      })
      registerDomain(Order)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage })

      const pipeline: Pipeline = {
        path: ['Order', 'notify'],
        context: { orderId: '123' },
        contextHash: 'order-123-notify',
        runtime,
      }

      await runtime.executeStep('notify-step', pipeline, [], 'send')

      // Wait for potential background storage
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Storage should remain empty for fire-and-forget
      const stored = await storage.list()
      expect(stored).toHaveLength(0)
    })

    it('does not block on handler errors', async () => {
      const onStepError = vi.fn()
      const Order = Domain('Order', {
        fail: async () => {
          throw new Error('Handler failed')
        },
      })
      registerDomain(Order)

      const runtime = createWorkflowRuntime({ onStepError })
      const pipeline: Pipeline = {
        path: ['Order', 'fail'],
        context: {},
        contextHash: 'fail-ctx',
        runtime,
      }

      // Should not throw despite handler error
      const result = await runtime.executeStep('fail-step', pipeline, [], 'send')
      expect(result).toBeUndefined()

      // Wait for background error
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Error callback should be invoked
      expect(onStepError).toHaveBeenCalledWith('fail-step', expect.any(Error), 1)
    })

    it('does not retry on failure', async () => {
      let attempts = 0
      const Order = Domain('Order', {
        flaky: async () => {
          attempts++
          throw new Error('Always fails')
        },
      })
      registerDomain(Order)

      const runtime = createWorkflowRuntime({
        retryPolicy: { maxAttempts: 5 },
      })

      const pipeline: Pipeline = {
        path: ['Order', 'flaky'],
        context: {},
        contextHash: 'flaky-ctx',
        runtime,
      }

      await runtime.executeStep('flaky-step', pipeline, [], 'send')

      // Wait for background execution
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Fire-and-forget should not retry
      expect(attempts).toBe(1)
    })

    it('supports runtime.send() API for event emission', () => {
      const runtime = createTestRuntime()

      // Should not throw
      expect(() => {
        runtime.send('Order.placed', { orderId: '123', amount: 99.99 })
      }).not.toThrow()
    })

    it('allows multiple fire-and-forget calls concurrently', async () => {
      const executionOrder: string[] = []

      const Notification = Domain('Notification', {
        email: async () => {
          await new Promise((r) => setTimeout(r, 30))
          executionOrder.push('email')
          return { type: 'email' }
        },
        sms: async () => {
          await new Promise((r) => setTimeout(r, 10))
          executionOrder.push('sms')
          return { type: 'sms' }
        },
        push: async () => {
          await new Promise((r) => setTimeout(r, 20))
          executionOrder.push('push')
          return { type: 'push' }
        },
      })
      registerDomain(Notification)

      const runtime = createTestRuntime()

      // Fire all notifications concurrently
      const emailPipeline: Pipeline = {
        path: ['Notification', 'email'],
        context: {},
        contextHash: 'email',
        runtime,
      }
      const smsPipeline: Pipeline = {
        path: ['Notification', 'sms'],
        context: {},
        contextHash: 'sms',
        runtime,
      }
      const pushPipeline: Pipeline = {
        path: ['Notification', 'push'],
        context: {},
        contextHash: 'push',
        runtime,
      }

      // All should return immediately
      await Promise.all([
        runtime.executeStep('email', emailPipeline, [], 'send'),
        runtime.executeStep('sms', smsPipeline, [], 'send'),
        runtime.executeStep('push', pushPipeline, [], 'send'),
      ])

      // Wait for all to complete
      await new Promise((r) => setTimeout(r, 100))

      // All notifications should have executed
      expect(executionOrder).toHaveLength(3)
      expect(executionOrder).toContain('email')
      expect(executionOrder).toContain('sms')
      expect(executionOrder).toContain('push')
    })
  })

  // ==========================================================================
  // $.try - Single Attempt Execution
  // ==========================================================================

  describe('$.try (single attempt)', () => {
    it('executes handler and awaits result', async () => {
      const Order = Domain('Order', {
        validate: async (order: { id: string }) => ({
          valid: true,
          orderId: order.id,
        }),
      })
      registerDomain(Order)

      const runtime = createTestRuntime()
      const pipeline: Pipeline = {
        path: ['Order', 'validate'],
        context: { id: 'order-456' },
        contextHash: 'order-456',
        runtime,
      }

      const result = await runtime.executeStep<{ valid: boolean; orderId: string }>(
        'validate-step',
        pipeline,
        [],
        'try'
      )

      expect(result).toEqual({ valid: true, orderId: 'order-456' })
    })

    it('does not persist step results', async () => {
      const Order = Domain('Order', {
        check: async () => ({ status: 'ok' }),
      })
      registerDomain(Order)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage })

      const pipeline: Pipeline = {
        path: ['Order', 'check'],
        context: {},
        contextHash: 'check-ctx',
        runtime,
      }

      await runtime.executeStep('check-step', pipeline, [], 'try')

      // Try mode should not persist
      const stored = await storage.list()
      expect(stored).toHaveLength(0)
    })

    it('does not retry on failure', async () => {
      let attempts = 0
      const Order = Domain('Order', {
        flaky: async () => {
          attempts++
          throw new Error('Operation failed')
        },
      })
      registerDomain(Order)

      const runtime = createWorkflowRuntime({
        retryPolicy: { maxAttempts: 5, initialDelayMs: 10 },
      })

      const pipeline: Pipeline = {
        path: ['Order', 'flaky'],
        context: {},
        contextHash: 'flaky-try',
        runtime,
      }

      await expect(
        runtime.executeStep('flaky-try-step', pipeline, [], 'try')
      ).rejects.toThrow('Operation failed')

      // Single attempt only
      expect(attempts).toBe(1)
    })

    it('throws errors immediately to caller', async () => {
      const Order = Domain('Order', {
        crash: async () => {
          throw new Error('Handler crashed')
        },
      })
      registerDomain(Order)

      const runtime = createTestRuntime()
      const pipeline: Pipeline = {
        path: ['Order', 'crash'],
        context: {},
        contextHash: 'crash-ctx',
        runtime,
      }

      await expect(
        runtime.executeStep('crash-step', pipeline, [], 'try')
      ).rejects.toThrow('Handler crashed')
    })

    it('invokes onStepError callback on failure', async () => {
      const onStepError = vi.fn()
      const Order = Domain('Order', {
        fail: async () => {
          throw new Error('Planned failure')
        },
      })
      registerDomain(Order)

      const runtime = createWorkflowRuntime({ onStepError })
      const pipeline: Pipeline = {
        path: ['Order', 'fail'],
        context: {},
        contextHash: 'fail-try',
        runtime,
      }

      await expect(
        runtime.executeStep('fail-try-step', pipeline, [], 'try')
      ).rejects.toThrow()

      expect(onStepError).toHaveBeenCalledWith(
        'fail-try-step',
        expect.any(Error),
        1
      )
    })

    it('invokes onStepComplete callback on success', async () => {
      const onStepComplete = vi.fn()
      const Order = Domain('Order', {
        succeed: async () => ({ success: true }),
      })
      registerDomain(Order)

      const runtime = createWorkflowRuntime({ onStepComplete })
      const pipeline: Pipeline = {
        path: ['Order', 'succeed'],
        context: {},
        contextHash: 'succeed-try',
        runtime,
      }

      await runtime.executeStep('succeed-step', pipeline, [], 'try')

      expect(onStepComplete).toHaveBeenCalledWith('succeed-step', { success: true })
    })

    it('supports runtime.try() API for direct action invocation', async () => {
      const Payment = Domain('Payment', {
        charge: async (data: { amount: number }) => ({
          charged: true,
          amount: data.amount,
        }),
      })
      registerDomain(Payment)

      const runtime = createTestRuntime()
      const result = await runtime.try<{ charged: boolean; amount: number }>(
        'Payment.charge',
        { amount: 49.99 }
      )

      expect(result).toEqual({ charged: true, amount: 49.99 })
    })

    it('throws on invalid action format in runtime.try()', async () => {
      const runtime = createTestRuntime()

      await expect(runtime.try('InvalidFormat', {})).rejects.toThrow(
        'Invalid action format'
      )
    })
  })

  // ==========================================================================
  // $.do - Durable Execution with Retries
  // ==========================================================================

  describe('$.do (durable with retries)', () => {
    it('persists successful step results', async () => {
      const Order = Domain('Order', {
        fulfill: async () => ({ fulfilled: true, timestamp: Date.now() }),
      })
      registerDomain(Order)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage })

      const pipeline: Pipeline = {
        path: ['Order', 'fulfill'],
        context: { orderId: '789' },
        contextHash: 'order-789-fulfill',
        runtime,
      }

      await runtime.executeStep('fulfill-step', pipeline, [], 'do')

      const stored = await storage.get('fulfill-step')
      expect(stored).toBeDefined()
      expect(stored?.status).toBe('completed')
      expect(stored?.result).toMatchObject({ fulfilled: true })
    })

    it('replays from persisted results on re-execution', async () => {
      let executionCount = 0
      const Order = Domain('Order', {
        process: async () => {
          executionCount++
          return { processed: true, count: executionCount }
        },
      })
      registerDomain(Order)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage })

      const pipeline: Pipeline = {
        path: ['Order', 'process'],
        context: { orderId: 'replay-test' },
        contextHash: 'replay-ctx',
        runtime,
      }

      // First execution
      const result1 = await runtime.executeStep('replay-step', pipeline, [], 'do')
      expect(executionCount).toBe(1)
      expect(result1).toMatchObject({ processed: true, count: 1 })

      // Second execution should replay
      const result2 = await runtime.executeStep('replay-step', pipeline, [], 'do')
      expect(executionCount).toBe(1) // Not incremented
      expect(result2).toMatchObject({ processed: true, count: 1 })
    })

    it('retries on transient failures', async () => {
      let attempts = 0
      const Order = Domain('Order', {
        transient: async () => {
          attempts++
          if (attempts < 3) {
            throw new Error('Transient failure')
          }
          return { success: true, attempts }
        },
      })
      registerDomain(Order)

      const runtime = createWorkflowRuntime({
        retryPolicy: {
          maxAttempts: 5,
          initialDelayMs: 5,
          backoffMultiplier: 1,
          jitter: false,
        },
      })

      const pipeline: Pipeline = {
        path: ['Order', 'transient'],
        context: {},
        contextHash: 'transient-ctx',
        runtime,
      }

      const result = await runtime.executeStep<{ success: boolean; attempts: number }>(
        'transient-step',
        pipeline,
        [],
        'do'
      )

      expect(attempts).toBe(3)
      expect(result).toEqual({ success: true, attempts: 3 })
    })

    it('throws WorkflowStepError after all retries exhausted', async () => {
      const Order = Domain('Order', {
        permanent: async () => {
          throw new Error('Permanent failure')
        },
      })
      registerDomain(Order)

      const runtime = createWorkflowRuntime({
        retryPolicy: {
          maxAttempts: 3,
          initialDelayMs: 5,
          backoffMultiplier: 1,
          jitter: false,
        },
      })

      const pipeline: Pipeline = {
        path: ['Order', 'permanent'],
        context: {},
        contextHash: 'permanent-ctx',
        runtime,
      }

      try {
        await runtime.executeStep('permanent-step', pipeline, [], 'do')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowStepError)
        const stepError = error as WorkflowStepError
        expect(stepError.stepId).toBe('permanent-step')
        expect(stepError.attempts).toBe(3)
        expect(stepError.cause?.message).toBe('Permanent failure')
      }
    })

    it('persists failed status after retries exhausted', async () => {
      const Order = Domain('Order', {
        alwaysFail: async () => {
          throw new Error('Always fails')
        },
      })
      registerDomain(Order)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({
        storage,
        retryPolicy: {
          maxAttempts: 2,
          initialDelayMs: 5,
          jitter: false,
        },
      })

      const pipeline: Pipeline = {
        path: ['Order', 'alwaysFail'],
        context: {},
        contextHash: 'always-fail-ctx',
        runtime,
      }

      await expect(
        runtime.executeStep('always-fail-step', pipeline, [], 'do')
      ).rejects.toThrow()

      const stored = await storage.get('always-fail-step')
      expect(stored?.status).toBe('failed')
      expect(stored?.error).toBe('Always fails')
      expect(stored?.attempts).toBe(2)
    })

    it('uses exponential backoff for retries', async () => {
      const timestamps: number[] = []
      let attempts = 0

      const Order = Domain('Order', {
        backoff: async () => {
          timestamps.push(Date.now())
          attempts++
          if (attempts < 4) {
            throw new Error('Retry me')
          }
          return { success: true }
        },
      })
      registerDomain(Order)

      const runtime = createWorkflowRuntime({
        retryPolicy: {
          maxAttempts: 5,
          initialDelayMs: 20,
          maxDelayMs: 1000,
          backoffMultiplier: 2,
          jitter: false,
        },
      })

      const pipeline: Pipeline = {
        path: ['Order', 'backoff'],
        context: {},
        contextHash: 'backoff-ctx',
        runtime,
      }

      await runtime.executeStep('backoff-step', pipeline, [], 'do')

      expect(timestamps).toHaveLength(4)

      // Verify exponential delays (with some tolerance)
      const delay1 = timestamps[1]! - timestamps[0]!
      const delay2 = timestamps[2]! - timestamps[1]!
      const delay3 = timestamps[3]! - timestamps[2]!

      // Initial delay ~20ms, then ~40ms, then ~80ms
      expect(delay1).toBeGreaterThanOrEqual(15)
      expect(delay2).toBeGreaterThanOrEqual(30)
      expect(delay3).toBeGreaterThanOrEqual(60)
    })

    it('invokes onStepError for each retry attempt', async () => {
      const onStepError = vi.fn()
      let attempts = 0

      const Order = Domain('Order', {
        retry: async () => {
          attempts++
          if (attempts < 3) {
            throw new Error(`Attempt ${attempts} failed`)
          }
          return { success: true }
        },
      })
      registerDomain(Order)

      const runtime = createWorkflowRuntime({
        onStepError,
        retryPolicy: {
          maxAttempts: 5,
          initialDelayMs: 5,
          jitter: false,
        },
      })

      const pipeline: Pipeline = {
        path: ['Order', 'retry'],
        context: {},
        contextHash: 'retry-ctx',
        runtime,
      }

      await runtime.executeStep('retry-step', pipeline, [], 'do')

      // Called for each failed attempt
      expect(onStepError).toHaveBeenCalledTimes(2)
      expect(onStepError).toHaveBeenNthCalledWith(1, 'retry-step', expect.any(Error), 1)
      expect(onStepError).toHaveBeenNthCalledWith(2, 'retry-step', expect.any(Error), 2)
    })

    it('supports runtime.do() API for durable action invocation', async () => {
      let executionCount = 0
      const Payment = Domain('Payment', {
        process: async (data: { amount: number }) => {
          executionCount++
          return { processed: true, amount: data.amount }
        },
      })
      registerDomain(Payment)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage })

      // First call
      const result1 = await runtime.do<{ processed: boolean; amount: number }>(
        'Payment.process',
        { amount: 100 }
      )
      expect(result1).toEqual({ processed: true, amount: 100 })
      expect(executionCount).toBe(1)

      // Second call with same args should replay
      const result2 = await runtime.do<{ processed: boolean; amount: number }>(
        'Payment.process',
        { amount: 100 }
      )
      expect(result2).toEqual({ processed: true, amount: 100 })
      expect(executionCount).toBe(1)
    })
  })

  // ==========================================================================
  // Context Isolation
  // ==========================================================================

  describe('Context Isolation', () => {
    it('isolates step results by step ID', async () => {
      const Order = Domain('Order', {
        process: async (order: { id: string }) => ({
          processed: true,
          orderId: order.id,
        }),
      })
      registerDomain(Order)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage })

      // Execute two different steps
      const pipeline1: Pipeline = {
        path: ['Order', 'process'],
        context: { id: 'order-1' },
        contextHash: 'order-1',
        runtime,
      }
      const pipeline2: Pipeline = {
        path: ['Order', 'process'],
        context: { id: 'order-2' },
        contextHash: 'order-2',
        runtime,
      }

      await runtime.executeStep('step-order-1', pipeline1, [], 'do')
      await runtime.executeStep('step-order-2', pipeline2, [], 'do')

      // Both should be stored independently
      const stored1 = await storage.get('step-order-1')
      const stored2 = await storage.get('step-order-2')

      expect(stored1?.result).toMatchObject({ orderId: 'order-1' })
      expect(stored2?.result).toMatchObject({ orderId: 'order-2' })
    })

    it('isolates workflow instances with different context hashes', async () => {
      let executionCount = 0
      const Order = Domain('Order', {
        calculate: async (order: { total: number }) => {
          executionCount++
          return { tax: order.total * 0.1, count: executionCount }
        },
      })
      registerDomain(Order)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage })

      const pipeline1: Pipeline = {
        path: ['Order', 'calculate'],
        context: { total: 100 },
        contextHash: 'ctx-100',
        runtime,
      }
      const pipeline2: Pipeline = {
        path: ['Order', 'calculate'],
        context: { total: 200 },
        contextHash: 'ctx-200',
        runtime,
      }

      // Different step IDs ensure different executions
      const result1 = await runtime.executeStep<{ tax: number; count: number }>(
        'calc-100',
        pipeline1,
        [],
        'do'
      )
      const result2 = await runtime.executeStep<{ tax: number; count: number }>(
        'calc-200',
        pipeline2,
        [],
        'do'
      )

      expect(executionCount).toBe(2)
      expect(result1.tax).toBe(10)
      expect(result2.tax).toBe(20)
    })

    it('maintains isolation across multiple runtimes with shared storage', async () => {
      const Order = Domain('Order', {
        reserve: async (data: { sku: string }) => ({
          reserved: true,
          sku: data.sku,
        }),
      })
      registerDomain(Order)

      // Shared storage simulates persistent store
      const sharedStorage = new InMemoryStepStorage()

      const runtime1 = createWorkflowRuntime({ storage: sharedStorage })
      const runtime2 = createWorkflowRuntime({ storage: sharedStorage })

      const pipeline: Pipeline = {
        path: ['Order', 'reserve'],
        context: { sku: 'ABC-123' },
        contextHash: 'reserve-abc-123',
        runtime: runtime1,
      }

      // Execute on runtime1
      await runtime1.executeStep('reserve-step', pipeline, [], 'do')

      // Replay on runtime2 (simulates restart)
      let executionCount = 0
      const Order2 = Domain('Order', {
        reserve: async () => {
          executionCount++
          return { reserved: true, sku: 'should-not-run' }
        },
      })
      clearDomainRegistry()
      registerDomain(Order2)

      const pipeline2: Pipeline = {
        path: ['Order', 'reserve'],
        context: { sku: 'ABC-123' },
        contextHash: 'reserve-abc-123',
        runtime: runtime2,
      }

      const result = await runtime2.executeStep<{ reserved: boolean; sku: string }>(
        'reserve-step',
        pipeline2,
        [],
        'do'
      )

      // Should replay from storage, not re-execute
      expect(executionCount).toBe(0)
      expect(result).toMatchObject({ reserved: true, sku: 'ABC-123' })
    })

    it('does not leak state between try and do modes', async () => {
      let tryCount = 0
      let doCount = 0

      const Order = Domain('Order', {
        tryAction: async () => {
          tryCount++
          return { mode: 'try', count: tryCount }
        },
        doAction: async () => {
          doCount++
          return { mode: 'do', count: doCount }
        },
      })
      registerDomain(Order)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage })

      const tryPipeline: Pipeline = {
        path: ['Order', 'tryAction'],
        context: {},
        contextHash: 'try-ctx',
        runtime,
      }
      const doPipeline: Pipeline = {
        path: ['Order', 'doAction'],
        context: {},
        contextHash: 'do-ctx',
        runtime,
      }

      // Execute try mode multiple times
      await runtime.executeStep('try-step', tryPipeline, [], 'try')
      await runtime.executeStep('try-step', tryPipeline, [], 'try')

      // Execute do mode multiple times
      await runtime.executeStep('do-step', doPipeline, [], 'do')
      await runtime.executeStep('do-step', doPipeline, [], 'do')

      // Try should execute each time (no persistence)
      expect(tryCount).toBe(2)

      // Do should execute only once (replay)
      expect(doCount).toBe(1)

      // Only do mode persists
      const stored = await storage.list()
      expect(stored).toHaveLength(1)
      expect(stored[0]?.stepId).toBe('do-step')
    })
  })

  // ==========================================================================
  // Error Recovery
  // ==========================================================================

  describe('Error Recovery', () => {
    it('recovers from transient errors with retry', async () => {
      let networkFailures = 2
      const API = Domain('API', {
        call: async () => {
          if (networkFailures > 0) {
            networkFailures--
            throw new Error('Network timeout')
          }
          return { data: 'success' }
        },
      })
      registerDomain(API)

      const runtime = createWorkflowRuntime({
        retryPolicy: {
          maxAttempts: 5,
          initialDelayMs: 5,
          jitter: false,
        },
      })

      const pipeline: Pipeline = {
        path: ['API', 'call'],
        context: {},
        contextHash: 'api-call',
        runtime,
      }

      const result = await runtime.executeStep<{ data: string }>('api-step', pipeline, [], 'do')

      expect(result).toEqual({ data: 'success' })
      expect(networkFailures).toBe(0)
    })

    it('preserves error information in WorkflowStepError', async () => {
      const originalError = new Error('Database connection failed')
      originalError.name = 'DatabaseError'

      const DB = Domain('DB', {
        query: async () => {
          throw originalError
        },
      })
      registerDomain(DB)

      const runtime = createWorkflowRuntime({
        retryPolicy: {
          maxAttempts: 1,
          initialDelayMs: 0,
        },
      })

      const pipeline: Pipeline = {
        path: ['DB', 'query'],
        context: {},
        contextHash: 'db-query',
        runtime,
      }

      try {
        await runtime.executeStep('db-step', pipeline, [], 'do')
        expect.fail('Should have thrown')
      } catch (error) {
        const stepError = error as WorkflowStepError
        expect(stepError.cause?.message).toBe('Database connection failed')
        expect(stepError.message).toContain('db-step')
        expect(stepError.message).toContain('1 attempts')
      }
    })

    it('throws HandlerNotFoundError for unregistered domain', async () => {
      const runtime = createTestRuntime()

      const pipeline: Pipeline = {
        path: ['UnregisteredDomain', 'unknownMethod'],
        context: {},
        contextHash: 'unknown',
        runtime,
      }

      await expect(
        runtime.executeStep('unknown-step', pipeline, [], 'try')
      ).rejects.toThrow(HandlerNotFoundError)
    })

    it('throws HandlerNotFoundError for unregistered method', async () => {
      const Order = Domain('Order', {
        process: async () => ({ ok: true }),
      })
      registerDomain(Order)

      const runtime = createTestRuntime()

      const pipeline: Pipeline = {
        path: ['Order', 'nonExistentMethod'],
        context: {},
        contextHash: 'non-existent',
        runtime,
      }

      await expect(
        runtime.executeStep('bad-method-step', pipeline, [], 'try')
      ).rejects.toThrow(HandlerNotFoundError)
    })

    it('does not replay failed steps (allows retry from clean state)', async () => {
      let attempts = 0
      const Service = Domain('Service', {
        operation: async () => {
          attempts++
          if (attempts === 1) {
            throw new Error('First attempt fails')
          }
          return { success: true, attempt: attempts }
        },
      })
      registerDomain(Service)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({
        storage,
        retryPolicy: {
          maxAttempts: 1, // No auto-retry
          initialDelayMs: 0,
        },
      })

      const pipeline: Pipeline = {
        path: ['Service', 'operation'],
        context: {},
        contextHash: 'op-ctx',
        runtime,
      }

      // First execution fails
      await expect(
        runtime.executeStep('op-step', pipeline, [], 'do')
      ).rejects.toThrow()

      expect(attempts).toBe(1)

      // Failed status stored
      const stored = await storage.get('op-step')
      expect(stored?.status).toBe('failed')

      // Manual retry - since step is not 'completed', it should re-execute
      // Note: Current implementation doesn't replay failed steps
      // The step has failed status, but on next call to do mode,
      // it will see 'failed' status (not 'completed') and re-execute
      // This is actually the expected behavior for error recovery

      // Clear the failed result to simulate operator intervention
      await storage.delete('op-step')

      const result = await runtime.executeStep<{ success: boolean; attempt: number }>(
        'op-step',
        pipeline,
        [],
        'do'
      )

      expect(attempts).toBe(2)
      expect(result).toEqual({ success: true, attempt: 2 })
    })
  })

  // ==========================================================================
  // Execution Mode Selection
  // ==========================================================================

  describe('Execution Mode Selection', () => {
    it('defaults to do mode if not specified', async () => {
      const Order = Domain('Order', {
        default: async () => ({ mode: 'default' }),
      })
      registerDomain(Order)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage })

      const pipeline: Pipeline = {
        path: ['Order', 'default'],
        context: {},
        contextHash: 'default-ctx',
        runtime,
      }

      // executeStep with no mode parameter defaults to 'do'
      await runtime.executeStep('default-step', pipeline, [])

      // Verify persistence (only do mode persists)
      const stored = await storage.get('default-step')
      expect(stored).toBeDefined()
      expect(stored?.status).toBe('completed')
    })

    it('allows explicit mode selection per step', async () => {
      const Analytics = Domain('Analytics', {
        track: async (event: { type: string }) => ({
          tracked: true,
          type: event.type,
        }),
      })
      registerDomain(Analytics)

      const storage = new InMemoryStepStorage()
      const runtime = createWorkflowRuntime({ storage })

      // Send mode - fire and forget
      const sendPipeline: Pipeline = {
        path: ['Analytics', 'track'],
        context: { type: 'pageview' },
        contextHash: 'pageview',
        runtime,
      }

      // Try mode - single attempt
      const tryPipeline: Pipeline = {
        path: ['Analytics', 'track'],
        context: { type: 'conversion' },
        contextHash: 'conversion',
        runtime,
      }

      // Do mode - durable
      const doPipeline: Pipeline = {
        path: ['Analytics', 'track'],
        context: { type: 'purchase' },
        contextHash: 'purchase',
        runtime,
      }

      await runtime.executeStep('send-track', sendPipeline, [], 'send')
      await runtime.executeStep('try-track', tryPipeline, [], 'try')
      await runtime.executeStep('do-track', doPipeline, [], 'do')

      // Wait for send to complete
      await new Promise((r) => setTimeout(r, 50))

      // Only do mode persists
      const stored = await storage.list()
      expect(stored).toHaveLength(1)
      expect(stored[0]?.stepId).toBe('do-track')
    })

    it('respects mode-specific retry policies', async () => {
      let sendAttempts = 0
      let tryAttempts = 0
      let doAttempts = 0

      const Service = Domain('Service', {
        sendOp: async () => {
          sendAttempts++
          throw new Error('Send fails')
        },
        tryOp: async () => {
          tryAttempts++
          throw new Error('Try fails')
        },
        doOp: async () => {
          doAttempts++
          throw new Error('Do fails')
        },
      })
      registerDomain(Service)

      const runtime = createWorkflowRuntime({
        retryPolicy: {
          maxAttempts: 3,
          initialDelayMs: 5,
          jitter: false,
        },
      })

      const sendPipeline: Pipeline = {
        path: ['Service', 'sendOp'],
        context: {},
        contextHash: 'send',
        runtime,
      }
      const tryPipeline: Pipeline = {
        path: ['Service', 'tryOp'],
        context: {},
        contextHash: 'try',
        runtime,
      }
      const doPipeline: Pipeline = {
        path: ['Service', 'doOp'],
        context: {},
        contextHash: 'do',
        runtime,
      }

      // Send - no retry
      await runtime.executeStep('send', sendPipeline, [], 'send')
      await new Promise((r) => setTimeout(r, 50))

      // Try - no retry
      await expect(
        runtime.executeStep('try', tryPipeline, [], 'try')
      ).rejects.toThrow()

      // Do - retries according to policy
      await expect(
        runtime.executeStep('do', doPipeline, [], 'do')
      ).rejects.toThrow()

      expect(sendAttempts).toBe(1) // No retry
      expect(tryAttempts).toBe(1) // No retry
      expect(doAttempts).toBe(3) // Retried up to maxAttempts
    })
  })

  // ==========================================================================
  // Workflow Proxy Integration
  // ==========================================================================

  describe('Workflow Proxy Integration', () => {
    it('creates $ proxy with execution context', async () => {
      const Inventory = Domain('Inventory', {
        check: async (product: { sku: string }) => ({
          available: true,
          quantity: 100,
          sku: product.sku,
        }),
      })
      registerDomain(Inventory)

      const runtime = createTestRuntime()
      const $ = createWorkflowProxy(runtime)

      const result = await $.Inventory({ sku: 'WIDGET-001' }).check()

      expect(result).toEqual({
        available: true,
        quantity: 100,
        sku: 'WIDGET-001',
      })
    })

    it('supports fluent domain chaining', async () => {
      const CRM = Domain('CRM', {
        lookup: async (contact: { email: string }) => ({
          found: true,
          email: contact.email,
          name: 'John Doe',
        }),
      })
      registerDomain(CRM)

      const runtime = createTestRuntime()
      const $ = createWorkflowProxy(runtime)

      const contact = { email: 'john@example.com' }
      const result = await $.CRM(contact).lookup()

      expect(result).toMatchObject({
        found: true,
        email: 'john@example.com',
      })
    })

    it('generates deterministic step IDs from context hash', async () => {
      const onStepStart = vi.fn()
      const Service = Domain('Service', {
        action: async () => ({ done: true }),
      })
      registerDomain(Service)

      const runtime = createWorkflowRuntime({ onStepStart })
      const $ = createWorkflowProxy(runtime)

      // Execute with same context twice
      await $.Service({ id: 'test-123' }).action()
      await $.Service({ id: 'test-123' }).action()

      // Both should have the same step ID (deterministic)
      expect(onStepStart).toHaveBeenCalledTimes(2)
      const call1StepId = onStepStart.mock.calls[0]![0]
      const call2StepId = onStepStart.mock.calls[1]![0]
      expect(call1StepId).toBe(call2StepId)
    })
  })
})
