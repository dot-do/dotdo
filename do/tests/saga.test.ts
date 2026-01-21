/**
 * Saga Pattern Tests - Cross-DO Transaction Coordination
 *
 * Tests for the Saga coordinator that manages distributed transactions across
 * multiple Durable Objects using compensating transactions for rollback.
 *
 * The Saga pattern:
 * 1. Executes a series of steps across different DOs
 * 2. Each step has an associated compensating action (rollback)
 * 3. If any step fails, all previous steps are compensated in reverse order
 *
 * Tests cover:
 * 1. Saga step execution and compensation
 * 2. Multi-step workflows across DOs
 * 3. Error handling and rollback
 * 4. Partial failure scenarios
 * 5. Saga state persistence
 *
 * @module do/tests/saga.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  Saga,
  SagaStep,
  SagaState,
  SagaResult,
  SagaError,
  createSaga,
  executeSaga,
  compensateSaga,
} from '../workflow/saga'

// ============================================================================
// TYPE DEFINITIONS FOR TESTS
// ============================================================================

interface OrderContext {
  orderId: string
  customerId: string
  items: string[]
  total: number
  inventoryReserved?: boolean
  paymentCharged?: boolean
  orderCreated?: boolean
}

interface SagaExecutionLog {
  step: string
  action: 'execute' | 'compensate'
  timestamp: number
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockStep<T>(
  name: string,
  execute: (ctx: T) => Promise<T>,
  compensate: (ctx: T) => Promise<void>
): SagaStep<T> {
  return {
    name,
    execute,
    compensate,
  }
}

function generateTestId(): string {
  return `saga-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// TESTS: SAGA CREATION AND CONFIGURATION
// ============================================================================

describe('Saga Creation and Configuration', () => {
  it('should create a saga with steps', () => {
    const saga = createSaga<OrderContext>({
      name: 'create-order',
      steps: [
        {
          name: 'reserve-inventory',
          execute: async (ctx) => ({ ...ctx, inventoryReserved: true }),
          compensate: async () => {},
        },
        {
          name: 'charge-payment',
          execute: async (ctx) => ({ ...ctx, paymentCharged: true }),
          compensate: async () => {},
        },
      ],
    })

    expect(saga.name).toBe('create-order')
    expect(saga.steps).toHaveLength(2)
    expect(saga.steps[0].name).toBe('reserve-inventory')
    expect(saga.steps[1].name).toBe('charge-payment')
  })

  it('should require at least one step', () => {
    expect(() =>
      createSaga<OrderContext>({
        name: 'empty-saga',
        steps: [],
      })
    ).toThrow('Saga must have at least one step')
  })

  it('should enforce unique step names', () => {
    expect(() =>
      createSaga<OrderContext>({
        name: 'duplicate-steps',
        steps: [
          {
            name: 'reserve',
            execute: async (ctx) => ctx,
            compensate: async () => {},
          },
          {
            name: 'reserve', // Duplicate
            execute: async (ctx) => ctx,
            compensate: async () => {},
          },
        ],
      })
    ).toThrow('Duplicate step name: reserve')
  })

  it('should support optional timeout per step', () => {
    const saga = createSaga<OrderContext>({
      name: 'timeout-saga',
      steps: [
        {
          name: 'slow-step',
          execute: async (ctx) => ctx,
          compensate: async () => {},
          timeout: 5000,
        },
      ],
    })

    expect(saga.steps[0].timeout).toBe(5000)
  })

  it('should support optional retry config per step', () => {
    const saga = createSaga<OrderContext>({
      name: 'retry-saga',
      steps: [
        {
          name: 'flaky-step',
          execute: async (ctx) => ctx,
          compensate: async () => {},
          retries: 3,
          retryDelay: 100,
        },
      ],
    })

    expect(saga.steps[0].retries).toBe(3)
    expect(saga.steps[0].retryDelay).toBe(100)
  })
})

// ============================================================================
// TESTS: SUCCESSFUL SAGA EXECUTION
// ============================================================================

describe('Successful Saga Execution', () => {
  it('should execute all steps in order', async () => {
    const executionOrder: string[] = []

    const saga = createSaga<OrderContext>({
      name: 'ordered-execution',
      steps: [
        {
          name: 'step-1',
          execute: async (ctx) => {
            executionOrder.push('step-1')
            return { ...ctx, inventoryReserved: true }
          },
          compensate: async () => {},
        },
        {
          name: 'step-2',
          execute: async (ctx) => {
            executionOrder.push('step-2')
            return { ...ctx, paymentCharged: true }
          },
          compensate: async () => {},
        },
        {
          name: 'step-3',
          execute: async (ctx) => {
            executionOrder.push('step-3')
            return { ...ctx, orderCreated: true }
          },
          compensate: async () => {},
        },
      ],
    })

    const initialContext: OrderContext = {
      orderId: generateTestId(),
      customerId: 'cust-123',
      items: ['item-1'],
      total: 100,
    }

    const result = await executeSaga(saga, initialContext)

    expect(result.status).toBe('completed')
    expect(executionOrder).toEqual(['step-1', 'step-2', 'step-3'])
    expect(result.context.inventoryReserved).toBe(true)
    expect(result.context.paymentCharged).toBe(true)
    expect(result.context.orderCreated).toBe(true)
  })

  it('should pass context between steps', async () => {
    const saga = createSaga<OrderContext>({
      name: 'context-passing',
      steps: [
        {
          name: 'add-inventory-flag',
          execute: async (ctx) => ({ ...ctx, inventoryReserved: true }),
          compensate: async () => {},
        },
        {
          name: 'verify-inventory-flag',
          execute: async (ctx) => {
            if (!ctx.inventoryReserved) {
              throw new Error('Inventory should be reserved by previous step')
            }
            return { ...ctx, paymentCharged: true }
          },
          compensate: async () => {},
        },
      ],
    })

    const result = await executeSaga(saga, {
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: [],
      total: 0,
    })

    expect(result.status).toBe('completed')
    expect(result.context.inventoryReserved).toBe(true)
    expect(result.context.paymentCharged).toBe(true)
  })

  it('should return completed steps in result', async () => {
    const saga = createSaga<OrderContext>({
      name: 'track-completed',
      steps: [
        {
          name: 'step-a',
          execute: async (ctx) => ctx,
          compensate: async () => {},
        },
        {
          name: 'step-b',
          execute: async (ctx) => ctx,
          compensate: async () => {},
        },
      ],
    })

    const result = await executeSaga(saga, {
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: [],
      total: 0,
    })

    expect(result.completedSteps).toEqual(['step-a', 'step-b'])
    expect(result.failedStep).toBeUndefined()
  })

  it('should track execution timing', async () => {
    const saga = createSaga<OrderContext>({
      name: 'timing-saga',
      steps: [
        {
          name: 'timed-step',
          execute: async (ctx) => {
            await new Promise((r) => setTimeout(r, 20))
            return ctx
          },
          compensate: async () => {},
        },
      ],
    })

    const startTime = Date.now()
    const result = await executeSaga(saga, {
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: [],
      total: 0,
    })
    const endTime = Date.now()

    expect(result.startedAt).toBeGreaterThanOrEqual(startTime)
    expect(result.completedAt).toBeDefined()
    expect(result.completedAt!).toBeLessThanOrEqual(endTime)
    // Use relaxed timing check to avoid flaky tests in fast environments
    expect(result.duration).toBeGreaterThanOrEqual(5)
  })
})

// ============================================================================
// TESTS: COMPENSATION ON FAILURE
// ============================================================================

describe('Compensation on Failure', () => {
  it('should compensate completed steps on failure', async () => {
    const compensationOrder: string[] = []

    const saga = createSaga<OrderContext>({
      name: 'compensation-test',
      steps: [
        {
          name: 'step-1',
          execute: async (ctx) => ({ ...ctx, inventoryReserved: true }),
          compensate: async () => {
            compensationOrder.push('compensate-1')
          },
        },
        {
          name: 'step-2',
          execute: async (ctx) => ({ ...ctx, paymentCharged: true }),
          compensate: async () => {
            compensationOrder.push('compensate-2')
          },
        },
        {
          name: 'step-3',
          execute: async () => {
            throw new Error('Step 3 failed')
          },
          compensate: async () => {
            compensationOrder.push('compensate-3') // Should NOT be called
          },
        },
      ],
    })

    const result = await executeSaga(saga, {
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: [],
      total: 0,
    })

    expect(result.status).toBe('compensated')
    expect(result.failedStep).toBe('step-3')
    // Compensation should happen in reverse order
    expect(compensationOrder).toEqual(['compensate-2', 'compensate-1'])
    // Step 3 compensation should NOT be called since it failed before completing
  })

  it('should pass context to compensation functions', async () => {
    let compensationContext: OrderContext | undefined

    const saga = createSaga<OrderContext>({
      name: 'context-in-compensation',
      steps: [
        {
          name: 'set-context',
          execute: async (ctx) => ({
            ...ctx,
            inventoryReserved: true,
            paymentCharged: true,
          }),
          compensate: async (ctx) => {
            compensationContext = ctx
          },
        },
        {
          name: 'fail',
          execute: async () => {
            throw new Error('Intentional failure')
          },
          compensate: async () => {},
        },
      ],
    })

    await executeSaga(saga, {
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: ['item-1'],
      total: 100,
    })

    expect(compensationContext).toBeDefined()
    expect(compensationContext!.inventoryReserved).toBe(true)
    expect(compensationContext!.paymentCharged).toBe(true)
  })

  it('should continue compensation even if one compensation fails', async () => {
    const compensationOrder: string[] = []

    const saga = createSaga<OrderContext>({
      name: 'compensation-failure',
      steps: [
        {
          name: 'step-1',
          execute: async (ctx) => ctx,
          compensate: async () => {
            compensationOrder.push('compensate-1')
          },
        },
        {
          name: 'step-2',
          execute: async (ctx) => ctx,
          compensate: async () => {
            compensationOrder.push('compensate-2')
            throw new Error('Compensation failed')
          },
        },
        {
          name: 'step-3',
          execute: async () => {
            throw new Error('Step 3 failed')
          },
          compensate: async () => {},
        },
      ],
    })

    const result = await executeSaga(saga, {
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: [],
      total: 0,
    })

    // Both compensations should be attempted
    expect(compensationOrder).toEqual(['compensate-2', 'compensate-1'])
    expect(result.status).toBe('compensation_failed')
    expect(result.compensationErrors).toHaveLength(1)
  })

  it('should record all compensation errors', async () => {
    const saga = createSaga<OrderContext>({
      name: 'multiple-compensation-errors',
      steps: [
        {
          name: 'step-1',
          execute: async (ctx) => ctx,
          compensate: async () => {
            throw new Error('Compensation 1 failed')
          },
        },
        {
          name: 'step-2',
          execute: async (ctx) => ctx,
          compensate: async () => {
            throw new Error('Compensation 2 failed')
          },
        },
        {
          name: 'step-3',
          execute: async () => {
            throw new Error('Step failed')
          },
          compensate: async () => {},
        },
      ],
    })

    const result = await executeSaga(saga, {
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: [],
      total: 0,
    })

    expect(result.compensationErrors).toHaveLength(2)
    expect(result.compensationErrors![0].step).toBe('step-2')
    expect(result.compensationErrors![1].step).toBe('step-1')
  })
})

// ============================================================================
// TESTS: MULTI-STEP WORKFLOWS
// ============================================================================

describe('Multi-Step Workflows', () => {
  it('should handle e-commerce order saga', async () => {
    // Simulated services
    const inventory = new Map<string, number>([
      ['item-1', 10],
      ['item-2', 5],
    ])
    let customerBalance = 500
    const orders: OrderContext[] = []

    const saga = createSaga<OrderContext>({
      name: 'e-commerce-order',
      steps: [
        {
          name: 'reserve-inventory',
          execute: async (ctx) => {
            for (const item of ctx.items) {
              const stock = inventory.get(item) || 0
              if (stock < 1) {
                throw new Error(`Insufficient stock for ${item}`)
              }
              inventory.set(item, stock - 1)
            }
            return { ...ctx, inventoryReserved: true }
          },
          compensate: async (ctx) => {
            for (const item of ctx.items) {
              const stock = inventory.get(item) || 0
              inventory.set(item, stock + 1)
            }
          },
        },
        {
          name: 'charge-payment',
          execute: async (ctx) => {
            if (customerBalance < ctx.total) {
              throw new Error('Insufficient funds')
            }
            customerBalance -= ctx.total
            return { ...ctx, paymentCharged: true }
          },
          compensate: async (ctx) => {
            customerBalance += ctx.total
          },
        },
        {
          name: 'create-order',
          execute: async (ctx) => {
            orders.push(ctx)
            return { ...ctx, orderCreated: true }
          },
          compensate: async (ctx) => {
            const index = orders.findIndex((o) => o.orderId === ctx.orderId)
            if (index >= 0) {
              orders.splice(index, 1)
            }
          },
        },
      ],
    })

    // Successful order
    const result = await executeSaga(saga, {
      orderId: 'order-1',
      customerId: 'cust-1',
      items: ['item-1', 'item-2'],
      total: 100,
    })

    expect(result.status).toBe('completed')
    expect(inventory.get('item-1')).toBe(9)
    expect(inventory.get('item-2')).toBe(4)
    expect(customerBalance).toBe(400)
    expect(orders).toHaveLength(1)
  })

  it('should rollback e-commerce order on payment failure', async () => {
    const inventory = new Map<string, number>([['item-1', 10]])
    let customerBalance = 50 // Not enough for $100 order
    const orders: OrderContext[] = []

    const saga = createSaga<OrderContext>({
      name: 'e-commerce-order-fail',
      steps: [
        {
          name: 'reserve-inventory',
          execute: async (ctx) => {
            const stock = inventory.get('item-1') || 0
            inventory.set('item-1', stock - 1)
            return { ...ctx, inventoryReserved: true }
          },
          compensate: async () => {
            const stock = inventory.get('item-1') || 0
            inventory.set('item-1', stock + 1)
          },
        },
        {
          name: 'charge-payment',
          execute: async (ctx) => {
            if (customerBalance < ctx.total) {
              throw new Error('Insufficient funds')
            }
            customerBalance -= ctx.total
            return { ...ctx, paymentCharged: true }
          },
          compensate: async (ctx) => {
            customerBalance += ctx.total
          },
        },
        {
          name: 'create-order',
          execute: async (ctx) => {
            orders.push(ctx)
            return { ...ctx, orderCreated: true }
          },
          compensate: async (ctx) => {
            const index = orders.findIndex((o) => o.orderId === ctx.orderId)
            if (index >= 0) {
              orders.splice(index, 1)
            }
          },
        },
      ],
    })

    const result = await executeSaga(saga, {
      orderId: 'order-1',
      customerId: 'cust-1',
      items: ['item-1'],
      total: 100,
    })

    expect(result.status).toBe('compensated')
    expect(result.failedStep).toBe('charge-payment')
    // Inventory should be restored
    expect(inventory.get('item-1')).toBe(10)
    // Balance unchanged (charge never happened)
    expect(customerBalance).toBe(50)
    // No order created
    expect(orders).toHaveLength(0)
  })
})

// ============================================================================
// TESTS: SAGA STATE AND PERSISTENCE
// ============================================================================

describe('Saga State and Persistence', () => {
  it('should export saga state for persistence', async () => {
    const saga = createSaga<OrderContext>({
      name: 'persist-test',
      steps: [
        {
          name: 'step-1',
          execute: async (ctx) => ({ ...ctx, inventoryReserved: true }),
          compensate: async () => {},
        },
        {
          name: 'step-2',
          execute: async (ctx) => ctx,
          compensate: async () => {},
        },
      ],
    })

    const result = await executeSaga(saga, {
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: [],
      total: 0,
    })

    const state = result.toState()

    expect(state.sagaName).toBe('persist-test')
    expect(state.status).toBe('completed')
    expect(state.completedSteps).toEqual(['step-1', 'step-2'])
    expect(state.context).toEqual({
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: [],
      total: 0,
      inventoryReserved: true,
    })
  })

  it('should allow manual compensation from state', async () => {
    const compensated: string[] = []

    const saga = createSaga<OrderContext>({
      name: 'manual-compensate',
      steps: [
        {
          name: 'step-1',
          execute: async (ctx) => ctx,
          compensate: async () => {
            compensated.push('step-1')
          },
        },
        {
          name: 'step-2',
          execute: async (ctx) => ctx,
          compensate: async () => {
            compensated.push('step-2')
          },
        },
      ],
    })

    // Simulate completed saga
    const state: SagaState<OrderContext> = {
      sagaName: 'manual-compensate',
      status: 'completed',
      completedSteps: ['step-1', 'step-2'],
      context: {
        orderId: 'ord-1',
        customerId: 'cust-1',
        items: [],
        total: 0,
      },
      startedAt: Date.now(),
      completedAt: Date.now(),
    }

    await compensateSaga(saga, state)

    expect(compensated).toEqual(['step-2', 'step-1'])
  })
})

// ============================================================================
// TESTS: ERROR HANDLING
// ============================================================================

describe('Error Handling', () => {
  it('should wrap step errors in SagaError', async () => {
    const saga = createSaga<OrderContext>({
      name: 'error-wrap',
      steps: [
        {
          name: 'failing-step',
          execute: async () => {
            throw new Error('Original error')
          },
          compensate: async () => {},
        },
      ],
    })

    const result = await executeSaga(saga, {
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: [],
      total: 0,
    })

    expect(result.error).toBeInstanceOf(SagaError)
    expect(result.error!.message).toContain('Original error')
    expect(result.error!.step).toBe('failing-step')
    expect(result.error!.saga).toBe('error-wrap')
  })

  it('should handle timeout for steps', async () => {
    const saga = createSaga<OrderContext>({
      name: 'timeout-saga',
      steps: [
        {
          name: 'slow-step',
          execute: async (ctx) => {
            await new Promise((r) => setTimeout(r, 200))
            return ctx
          },
          compensate: async () => {},
          timeout: 50,
        },
      ],
    })

    const result = await executeSaga(saga, {
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: [],
      total: 0,
    })

    expect(result.status).toBe('compensated')
    expect(result.error!.message).toContain('timeout')
  })

  it('should retry failed steps when configured', async () => {
    let attempts = 0

    const saga = createSaga<OrderContext>({
      name: 'retry-saga',
      steps: [
        {
          name: 'flaky-step',
          execute: async (ctx) => {
            attempts++
            if (attempts < 3) {
              throw new Error('Transient error')
            }
            return ctx
          },
          compensate: async () => {},
          retries: 3,
          retryDelay: 10,
        },
      ],
    })

    const result = await executeSaga(saga, {
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: [],
      total: 0,
    })

    expect(result.status).toBe('completed')
    expect(attempts).toBe(3)
  })

  it('should fail after max retries', async () => {
    let attempts = 0

    const saga = createSaga<OrderContext>({
      name: 'max-retry-saga',
      steps: [
        {
          name: 'always-fails',
          execute: async () => {
            attempts++
            throw new Error('Always fails')
          },
          compensate: async () => {},
          retries: 2,
          retryDelay: 10,
        },
      ],
    })

    const result = await executeSaga(saga, {
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: [],
      total: 0,
    })

    expect(result.status).toBe('compensated')
    expect(attempts).toBe(3) // Initial + 2 retries
  })
})

// ============================================================================
// TESTS: SAGA METADATA AND OBSERVABILITY
// ============================================================================

describe('Saga Metadata and Observability', () => {
  it('should include saga ID for tracing', async () => {
    const saga = createSaga<OrderContext>({
      name: 'traceable-saga',
      steps: [
        {
          name: 'step-1',
          execute: async (ctx) => ctx,
          compensate: async () => {},
        },
      ],
    })

    const result = await executeSaga(saga, {
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: [],
      total: 0,
    })

    expect(result.sagaId).toBeDefined()
    expect(typeof result.sagaId).toBe('string')
    expect(result.sagaId.length).toBeGreaterThan(0)
  })

  it('should call onStepComplete callback', async () => {
    const completedSteps: { name: string; duration: number }[] = []

    const saga = createSaga<OrderContext>({
      name: 'callback-saga',
      steps: [
        {
          name: 'step-1',
          execute: async (ctx) => {
            await new Promise((r) => setTimeout(r, 20))
            return ctx
          },
          compensate: async () => {},
        },
        {
          name: 'step-2',
          execute: async (ctx) => ctx,
          compensate: async () => {},
        },
      ],
      onStepComplete: (step, duration) => {
        completedSteps.push({ name: step, duration })
      },
    })

    await executeSaga(saga, {
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: [],
      total: 0,
    })

    expect(completedSteps).toHaveLength(2)
    expect(completedSteps[0].name).toBe('step-1')
    // Use relaxed timing check to avoid flaky tests in fast environments
    expect(completedSteps[0].duration).toBeGreaterThanOrEqual(5)
    expect(completedSteps[1].name).toBe('step-2')
  })

  it('should call onCompensate callback', async () => {
    const compensatedSteps: string[] = []

    const saga = createSaga<OrderContext>({
      name: 'compensate-callback-saga',
      steps: [
        {
          name: 'step-1',
          execute: async (ctx) => ctx,
          compensate: async () => {},
        },
        {
          name: 'step-2',
          execute: async () => {
            throw new Error('Fail')
          },
          compensate: async () => {},
        },
      ],
      onCompensate: (step) => {
        compensatedSteps.push(step)
      },
    })

    await executeSaga(saga, {
      orderId: 'ord-1',
      customerId: 'cust-1',
      items: [],
      total: 0,
    })

    expect(compensatedSteps).toEqual(['step-1'])
  })
})

// ============================================================================
// TESTS: CROSS-DO SAGA SCENARIOS
// ============================================================================

describe('Cross-DO Saga Scenarios', () => {
  it('should simulate cross-DO transaction with mock stubs', async () => {
    // Mock DO stub responses
    const inventoryDO = {
      reserve: vi.fn().mockResolvedValue({ success: true }),
      release: vi.fn().mockResolvedValue({ success: true }),
    }

    const paymentDO = {
      charge: vi.fn().mockResolvedValue({ success: true, transactionId: 'txn-1' }),
      refund: vi.fn().mockResolvedValue({ success: true }),
    }

    const orderDO = {
      create: vi.fn().mockResolvedValue({ success: true, orderId: 'ord-1' }),
      cancel: vi.fn().mockResolvedValue({ success: true }),
    }

    const saga = createSaga<OrderContext>({
      name: 'cross-do-order',
      steps: [
        {
          name: 'reserve-inventory',
          execute: async (ctx) => {
            await inventoryDO.reserve({ items: ctx.items })
            return { ...ctx, inventoryReserved: true }
          },
          compensate: async (ctx) => {
            await inventoryDO.release({ items: ctx.items })
          },
        },
        {
          name: 'charge-payment',
          execute: async (ctx) => {
            await paymentDO.charge({
              customerId: ctx.customerId,
              amount: ctx.total,
            })
            return { ...ctx, paymentCharged: true }
          },
          compensate: async (ctx) => {
            await paymentDO.refund({ customerId: ctx.customerId, amount: ctx.total })
          },
        },
        {
          name: 'create-order',
          execute: async (ctx) => {
            await orderDO.create(ctx)
            return { ...ctx, orderCreated: true }
          },
          compensate: async (ctx) => {
            await orderDO.cancel({ orderId: ctx.orderId })
          },
        },
      ],
    })

    const result = await executeSaga(saga, {
      orderId: 'ord-123',
      customerId: 'cust-456',
      items: ['item-1', 'item-2'],
      total: 250,
    })

    expect(result.status).toBe('completed')
    expect(inventoryDO.reserve).toHaveBeenCalledWith({ items: ['item-1', 'item-2'] })
    expect(paymentDO.charge).toHaveBeenCalledWith({
      customerId: 'cust-456',
      amount: 250,
    })
    expect(orderDO.create).toHaveBeenCalled()
  })

  it('should compensate cross-DO transaction on failure', async () => {
    const inventoryDO = {
      reserve: vi.fn().mockResolvedValue({ success: true }),
      release: vi.fn().mockResolvedValue({ success: true }),
    }

    const paymentDO = {
      charge: vi.fn().mockRejectedValue(new Error('Payment declined')),
      refund: vi.fn().mockResolvedValue({ success: true }),
    }

    const saga = createSaga<OrderContext>({
      name: 'cross-do-fail',
      steps: [
        {
          name: 'reserve-inventory',
          execute: async (ctx) => {
            await inventoryDO.reserve({ items: ctx.items })
            return { ...ctx, inventoryReserved: true }
          },
          compensate: async (ctx) => {
            await inventoryDO.release({ items: ctx.items })
          },
        },
        {
          name: 'charge-payment',
          execute: async (ctx) => {
            await paymentDO.charge({
              customerId: ctx.customerId,
              amount: ctx.total,
            })
            return { ...ctx, paymentCharged: true }
          },
          compensate: async (ctx) => {
            await paymentDO.refund({ customerId: ctx.customerId, amount: ctx.total })
          },
        },
      ],
    })

    const result = await executeSaga(saga, {
      orderId: 'ord-123',
      customerId: 'cust-456',
      items: ['item-1'],
      total: 100,
    })

    expect(result.status).toBe('compensated')
    expect(result.failedStep).toBe('charge-payment')
    expect(inventoryDO.release).toHaveBeenCalled()
    // Refund should NOT be called since charge failed
    expect(paymentDO.refund).not.toHaveBeenCalled()
  })
})
