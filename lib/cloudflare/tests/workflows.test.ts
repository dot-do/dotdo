/**
 * Cloudflare Workflows Integration Tests
 *
 * TDD RED Phase: These tests define the expected behavior of the Cloudflare Workflows
 * integration before implementation.
 *
 * Features tested:
 * 1. Workflow Definition - Define workflows as Cloudflare Workflow classes
 * 2. Step Execution - Durable step.do() with automatic retries
 * 3. Event Handling - waitForEvent() for external signals
 * 4. Instance Management - Create, pause, resume, terminate workflows
 * 5. Step Result Storage - R2 for large payloads
 * 6. Saga Pattern - Compensation for failed workflows
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createWorkflowDefinition,
  WorkflowBuilder,
  DotdoWorkflowEntrypoint,
  StepContext,
  WorkflowInstanceManager,
  WorkflowStepStorage,
  SagaBuilder,
  CompensationContext,
  type WorkflowParams,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowInstanceStatus,
  type SagaStep,
} from '../workflows'

// ============================================================================
// MOCK TYPES (matching Cloudflare Workflows API)
// ============================================================================

interface MockWorkflowStep {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>
  do<T>(name: string, options: { retries?: { limit: number; backoff?: string; delay?: string } }, callback: () => Promise<T>): Promise<T>
  sleep(name: string, duration: string): Promise<void>
  sleepUntil(name: string, timestamp: Date | number): Promise<void>
  waitForEvent<T>(name: string, options?: { timeout?: string; type?: string }): Promise<T>
}

interface MockEnv {
  R2?: {
    put(key: string, value: string | ArrayBuffer): Promise<void>
    get(key: string): Promise<{ text(): Promise<string> } | null>
    delete(key: string): Promise<void>
  }
  DO?: DurableObjectNamespace
  WORKFLOW?: {
    create(options?: { id?: string; params?: unknown }): Promise<{ id: string }>
    get(id: string): Promise<{
      id: string
      status(): Promise<{ status: WorkflowInstanceStatus }>
      pause(): Promise<void>
      resume(): Promise<void>
      terminate(): Promise<void>
      sendEvent(event: { type: string; payload: unknown }): Promise<void>
    }>
  }
}

// ============================================================================
// 1. WORKFLOW DEFINITION TESTS
// ============================================================================

describe('Cloudflare Workflows Integration', () => {
  describe('Workflow Definition', () => {
    it('should create a workflow definition with builder pattern', () => {
      const workflow = createWorkflowDefinition<{ orderId: string }>()
        .name('OrderProcessingWorkflow')
        .description('Process customer orders')
        .step('validateOrder', async (ctx, step) => {
          return step.do('validate', async () => {
            return { valid: true }
          })
        })
        .step('chargePayment', async (ctx, step) => {
          return step.do('charge', async () => {
            return { charged: true, amount: 100 }
          })
        })
        .build()

      expect(workflow.name).toBe('OrderProcessingWorkflow')
      expect(workflow.description).toBe('Process customer orders')
      expect(workflow.steps).toHaveLength(2)
      expect(workflow.steps[0].name).toBe('validateOrder')
      expect(workflow.steps[1].name).toBe('chargePayment')
    })

    it('should support typed workflow parameters', () => {
      interface OrderParams {
        orderId: string
        customerId: string
        items: Array<{ productId: string; quantity: number }>
      }

      const workflow = createWorkflowDefinition<OrderParams>()
        .name('TypedOrderWorkflow')
        .step('processItems', async (ctx, step) => {
          // ctx.params should be typed as OrderParams
          const { orderId, items } = ctx.params
          return step.do('process', async () => {
            return { processed: items.length }
          })
        })
        .build()

      expect(workflow.name).toBe('TypedOrderWorkflow')
    })

    it('should support conditional steps', () => {
      const workflow = createWorkflowDefinition<{ needsReview: boolean }>()
        .name('ConditionalWorkflow')
        .step('initialStep', async (ctx, step) => {
          return step.do('init', async () => ({ initialized: true }))
        })
        .stepIf(
          (ctx) => ctx.params.needsReview,
          'reviewStep',
          async (ctx, step) => {
            return step.do('review', async () => ({ reviewed: true }))
          }
        )
        .build()

      expect(workflow.steps).toHaveLength(2)
      expect(workflow.steps[1].condition).toBeDefined()
    })
  })

  // ============================================================================
  // 2. STEP EXECUTION TESTS
  // ============================================================================

  describe('Step Execution', () => {
    let mockStep: MockWorkflowStep

    beforeEach(() => {
      mockStep = {
        do: vi.fn().mockImplementation(async (_name, callbackOrOptions, maybeCallback) => {
          const callback = typeof callbackOrOptions === 'function' ? callbackOrOptions : maybeCallback
          return callback()
        }),
        sleep: vi.fn().mockResolvedValue(undefined),
        sleepUntil: vi.fn().mockResolvedValue(undefined),
        waitForEvent: vi.fn().mockResolvedValue({ type: 'test', payload: {} }),
      }
    })

    it('should execute step.do() with automatic retries', async () => {
      const stepContext = new StepContext(mockStep as unknown as WorkflowStep)

      const result = await stepContext.do(
        'fetchData',
        { retries: { limit: 3, backoff: 'exponential', delay: '1s' } },
        async () => {
          return { data: 'fetched' }
        }
      )

      expect(result).toEqual({ data: 'fetched' })
      expect(mockStep.do).toHaveBeenCalledWith(
        'fetchData',
        { retries: { limit: 3, backoff: 'exponential', delay: '1s' } },
        expect.any(Function)
      )
    })

    it('should execute step.do() without options', async () => {
      const stepContext = new StepContext(mockStep as unknown as WorkflowStep)

      const result = await stepContext.do('simpleStep', async () => {
        return { success: true }
      })

      expect(result).toEqual({ success: true })
    })

    it('should support step.sleep() for delays', async () => {
      const stepContext = new StepContext(mockStep as unknown as WorkflowStep)

      await stepContext.sleep('waitForProcessing', '5m')

      expect(mockStep.sleep).toHaveBeenCalledWith('waitForProcessing', '5m')
    })

    it('should support step.sleepUntil() for scheduled wake', async () => {
      const stepContext = new StepContext(mockStep as unknown as WorkflowStep)
      const wakeTime = new Date('2025-01-15T10:00:00Z')

      await stepContext.sleepUntil('scheduledWake', wakeTime)

      expect(mockStep.sleepUntil).toHaveBeenCalledWith('scheduledWake', wakeTime)
    })
  })

  // ============================================================================
  // 3. EVENT HANDLING TESTS
  // ============================================================================

  describe('Event Handling', () => {
    let mockStep: MockWorkflowStep

    beforeEach(() => {
      mockStep = {
        do: vi.fn().mockImplementation(async (_name, callback) => callback()),
        sleep: vi.fn().mockResolvedValue(undefined),
        sleepUntil: vi.fn().mockResolvedValue(undefined),
        waitForEvent: vi.fn().mockResolvedValue({ approved: true, approver: 'manager@example.com.ai' }),
      }
    })

    it('should wait for external events with waitForEvent()', async () => {
      const stepContext = new StepContext(mockStep as unknown as WorkflowStep)

      const event = await stepContext.waitForEvent<{ approved: boolean; approver: string }>(
        'awaitApproval',
        { timeout: '7d', type: 'approval' }
      )

      expect(event).toEqual({ approved: true, approver: 'manager@example.com.ai' })
      expect(mockStep.waitForEvent).toHaveBeenCalledWith('awaitApproval', { timeout: '7d', type: 'approval' })
    })

    it('should support event filtering by type', async () => {
      const stepContext = new StepContext(mockStep as unknown as WorkflowStep)

      await stepContext.waitForEvent('awaitPayment', { type: 'payment.completed' })

      expect(mockStep.waitForEvent).toHaveBeenCalledWith('awaitPayment', { type: 'payment.completed' })
    })

    it('should handle event timeout', async () => {
      mockStep.waitForEvent = vi.fn().mockRejectedValue(new Error('Event timeout'))
      const stepContext = new StepContext(mockStep as unknown as WorkflowStep)

      await expect(
        stepContext.waitForEvent('awaitTimeout', { timeout: '1s' })
      ).rejects.toThrow('Event timeout')
    })
  })

  // ============================================================================
  // 4. INSTANCE MANAGEMENT TESTS
  // ============================================================================

  describe('Instance Management', () => {
    let mockEnv: MockEnv
    let instanceManager: WorkflowInstanceManager

    beforeEach(() => {
      mockEnv = {
        WORKFLOW: {
          create: vi.fn().mockResolvedValue({ id: 'wf-instance-123' }),
          get: vi.fn().mockResolvedValue({
            id: 'wf-instance-123',
            status: vi.fn().mockResolvedValue({ status: 'running' }),
            pause: vi.fn().mockResolvedValue(undefined),
            resume: vi.fn().mockResolvedValue(undefined),
            terminate: vi.fn().mockResolvedValue(undefined),
            sendEvent: vi.fn().mockResolvedValue(undefined),
          }),
        },
      }
      instanceManager = new WorkflowInstanceManager(mockEnv as unknown as MockEnv)
    })

    it('should create a new workflow instance', async () => {
      const instance = await instanceManager.create({
        params: { orderId: 'order-456' },
      })

      expect(instance.id).toBe('wf-instance-123')
      expect(mockEnv.WORKFLOW?.create).toHaveBeenCalledWith({
        params: { orderId: 'order-456' },
      })
    })

    it('should create instance with custom ID', async () => {
      await instanceManager.create({
        id: 'custom-wf-id',
        params: { orderId: 'order-456' },
      })

      expect(mockEnv.WORKFLOW?.create).toHaveBeenCalledWith({
        id: 'custom-wf-id',
        params: { orderId: 'order-456' },
      })
    })

    it('should get workflow instance status', async () => {
      const status = await instanceManager.getStatus('wf-instance-123')

      expect(status).toBe('running')
      expect(mockEnv.WORKFLOW?.get).toHaveBeenCalledWith('wf-instance-123')
    })

    it('should pause a running workflow', async () => {
      await instanceManager.pause('wf-instance-123')

      const instance = await mockEnv.WORKFLOW?.get('wf-instance-123')
      expect(instance?.pause).toHaveBeenCalled()
    })

    it('should resume a paused workflow', async () => {
      await instanceManager.resume('wf-instance-123')

      const instance = await mockEnv.WORKFLOW?.get('wf-instance-123')
      expect(instance?.resume).toHaveBeenCalled()
    })

    it('should terminate a workflow', async () => {
      await instanceManager.terminate('wf-instance-123')

      const instance = await mockEnv.WORKFLOW?.get('wf-instance-123')
      expect(instance?.terminate).toHaveBeenCalled()
    })

    it('should send events to a workflow', async () => {
      await instanceManager.sendEvent('wf-instance-123', {
        type: 'approval',
        payload: { approved: true },
      })

      const instance = await mockEnv.WORKFLOW?.get('wf-instance-123')
      expect(instance?.sendEvent).toHaveBeenCalledWith({
        type: 'approval',
        payload: { approved: true },
      })
    })
  })

  // ============================================================================
  // 5. STEP RESULT STORAGE TESTS (R2 for large payloads)
  // ============================================================================

  describe('Step Result Storage', () => {
    let mockR2: MockEnv['R2']
    let storage: WorkflowStepStorage

    beforeEach(() => {
      mockR2 = {
        put: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue({
          text: vi.fn().mockResolvedValue(JSON.stringify({ data: 'stored' })),
        }),
        delete: vi.fn().mockResolvedValue(undefined),
      }
      storage = new WorkflowStepStorage(mockR2 as unknown as MockEnv['R2'])
    })

    it('should store small results in-memory', async () => {
      const result = { small: 'data' }

      await storage.store('wf-123', 'step-1', result)

      // Small results should not hit R2
      expect(mockR2?.put).not.toHaveBeenCalled()
    })

    it('should store large results in R2', async () => {
      const largeResult = { data: 'x'.repeat(100 * 1024) } // 100KB

      await storage.store('wf-123', 'step-1', largeResult, { threshold: 50 * 1024 })

      expect(mockR2?.put).toHaveBeenCalledWith(
        'workflows/wf-123/steps/step-1/result.json',
        expect.any(String)
      )
    })

    it('should retrieve results from appropriate storage', async () => {
      // Store small result
      await storage.store('wf-123', 'step-1', { small: true })

      // Retrieve should get from in-memory
      const result = await storage.retrieve('wf-123', 'step-1')

      expect(result).toEqual({ small: true })
    })

    it('should retrieve large results from R2', async () => {
      // Configure storage to have this result in R2
      storage.setR2Reference('wf-123', 'step-2')

      const result = await storage.retrieve('wf-123', 'step-2')

      expect(mockR2?.get).toHaveBeenCalledWith('workflows/wf-123/steps/step-2/result.json')
      expect(result).toEqual({ data: 'stored' })
    })

    it('should cleanup workflow results', async () => {
      await storage.cleanup('wf-123')

      expect(mockR2?.delete).toHaveBeenCalled()
    })

    it('should support TTL for stored results', async () => {
      await storage.store('wf-123', 'step-1', { data: true }, { ttl: '7d' })

      // Verify TTL metadata is stored
      const metadata = storage.getMetadata('wf-123', 'step-1')
      expect(metadata?.ttl).toBe('7d')
    })
  })

  // ============================================================================
  // 6. SAGA PATTERN TESTS
  // ============================================================================

  describe('Saga Pattern', () => {
    it('should define saga with compensation steps', () => {
      const saga = new SagaBuilder<{ orderId: string }>()
        .step('reserveInventory')
        .action(async (ctx) => {
          return { reserved: true, inventoryId: 'inv-123' }
        })
        .compensate(async (ctx, result) => {
          // Release the reserved inventory
          console.log(`Releasing inventory ${result.inventoryId}`)
        })
        .step('chargePayment')
        .action(async (ctx) => {
          return { charged: true, transactionId: 'tx-456' }
        })
        .compensate(async (ctx, result) => {
          // Refund the payment
          console.log(`Refunding transaction ${result.transactionId}`)
        })
        .step('shipOrder')
        .action(async (ctx) => {
          return { shipped: true, trackingId: 'track-789' }
        })
        .compensate(async (ctx, result) => {
          // Cancel shipment
          console.log(`Cancelling shipment ${result.trackingId}`)
        })
        .build()

      expect(saga.steps).toHaveLength(3)
      expect(saga.steps[0].name).toBe('reserveInventory')
      expect(saga.steps[0].hasCompensation).toBe(true)
    })

    it('should execute compensations in reverse order on failure', async () => {
      const compensationOrder: string[] = []

      const saga = new SagaBuilder<{ orderId: string }>()
        .step('step1')
        .action(async () => ({ step: 1 }))
        .compensate(async () => { compensationOrder.push('comp1') })
        .step('step2')
        .action(async () => ({ step: 2 }))
        .compensate(async () => { compensationOrder.push('comp2') })
        .step('step3')
        .action(async () => {
          throw new Error('Step 3 failed')
        })
        .compensate(async () => { compensationOrder.push('comp3') })
        .build()

      const executor = saga.createExecutor()

      await expect(executor.run({ orderId: 'order-123' })).rejects.toThrow('Step 3 failed')

      // Compensations should run in reverse order (step2, step1 - not step3 since it failed)
      expect(compensationOrder).toEqual(['comp2', 'comp1'])
    })

    it('should provide compensation context with step results', async () => {
      let compensationCtx: CompensationContext | null = null

      const saga = new SagaBuilder<{ orderId: string }>()
        .step('createOrder')
        .action(async () => ({ orderId: 'order-123', amount: 100 }))
        .compensate(async (ctx, _result, compCtx) => {
          compensationCtx = compCtx
        })
        .step('failingStep')
        .action(async () => {
          throw new Error('Intentional failure')
        })
        .compensate(async () => {})
        .build()

      const executor = saga.createExecutor()
      await executor.run({ orderId: 'test' }).catch(() => {})

      expect(compensationCtx).toBeDefined()
      expect(compensationCtx?.failedStep).toBe('failingStep')
      expect(compensationCtx?.error).toBeInstanceOf(Error)
    })

    it('should support partial saga execution with savepoints', async () => {
      const saga = new SagaBuilder<{ orderId: string }>()
        .step('step1')
        .action(async () => ({ done: 1 }))
        .savepoint()
        .step('step2')
        .action(async () => ({ done: 2 }))
        .step('step3')
        .action(async () => ({ done: 3 }))
        .savepoint()
        .build()

      expect(saga.savepoints).toEqual([0, 2]) // After step1 and step3
    })

    it('should handle nested sagas', async () => {
      const innerSaga = new SagaBuilder<{ itemId: string }>()
        .step('processItem')
        .action(async (ctx) => ({ processed: ctx.params.itemId }))
        .compensate(async () => { /* undo */ })
        .build()

      const outerSaga = new SagaBuilder<{ orderId: string; items: string[] }>()
        .step('validateOrder')
        .action(async () => ({ valid: true }))
        .compensate(async () => {})
        .stepForEach(
          (ctx) => ctx.params.items,
          'processItems',
          async (ctx, item) => {
            const executor = innerSaga.createExecutor()
            return executor.run({ itemId: item })
          }
        )
        .compensate(async () => { /* undo all items */ })
        .build()

      expect(outerSaga.steps).toHaveLength(2)
      expect(outerSaga.steps[1].isForEach).toBe(true)
    })
  })

  // ============================================================================
  // 7. WORKFLOW ENTRYPOINT INTEGRATION TESTS
  // ============================================================================

  describe('DotdoWorkflowEntrypoint', () => {
    it('should bridge to existing DO workflow', async () => {
      // This tests the bridge between dotdo's Workflow DO and Cloudflare Workflows
      interface OrderParams {
        orderId: string
        customerId: string
      }

      class OrderWorkflow extends DotdoWorkflowEntrypoint<MockEnv, OrderParams> {
        async run(event: WorkflowEvent<OrderParams>, step: WorkflowStep): Promise<{ completed: boolean }> {
          // Validate order
          const validation = await step.do('validateOrder', async () => {
            return { valid: true }
          })

          // Process payment
          const payment = await step.do(
            'processPayment',
            { retries: { limit: 3, delay: '1s', backoff: 'exponential' } },
            async () => {
              return { charged: true, transactionId: 'tx-123' }
            }
          )

          // Wait for shipping confirmation
          const shipping = await step.waitForEvent<{ shipped: boolean }>('awaitShipping', {
            timeout: '24h',
            type: 'shipping.confirmed',
          })

          return { completed: true }
        }
      }

      // Verify the class structure
      expect(OrderWorkflow.prototype.run).toBeDefined()
    })

    it('should support $ proxy for cross-DO calls within workflow', async () => {
      class IntegrationWorkflow extends DotdoWorkflowEntrypoint<MockEnv, { customerId: string }> {
        async run(event: WorkflowEvent<{ customerId: string }>, step: WorkflowStep) {
          // Use $ proxy to call other DOs (bridged through step.do)
          const customer = await step.do('fetchCustomer', async () => {
            // In real implementation, this would use the $ proxy
            return { id: event.payload.customerId, name: 'John Doe' }
          })

          // Send notification via another DO
          await step.do('sendNotification', async () => {
            // $.Notifications(customer.id).send({ ... })
            return { sent: true }
          })

          return { processed: true }
        }
      }

      expect(IntegrationWorkflow.prototype.run).toBeDefined()
    })
  })

  // ============================================================================
  // 8. WORKFLOW BINDING CONFIGURATION TESTS
  // ============================================================================

  describe('Workflow Binding Configuration', () => {
    it('should generate wrangler.toml workflow binding config', () => {
      const workflow = createWorkflowDefinition<{ orderId: string }>()
        .name('OrderWorkflow')
        .binding('ORDER_WORKFLOW')
        .className('OrderWorkflowEntrypoint')
        .build()

      const wranglerConfig = workflow.toWranglerConfig()

      expect(wranglerConfig).toContain('[[workflows]]')
      expect(wranglerConfig).toContain('name = "OrderWorkflow"')
      expect(wranglerConfig).toContain('binding = "ORDER_WORKFLOW"')
      expect(wranglerConfig).toContain('class_name = "OrderWorkflowEntrypoint"')
    })
  })
})
