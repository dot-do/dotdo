/**
 * Tests for Saga / Compensation Pattern Implementation
 */

import { describe, it, expect } from 'vitest'
import {
  Saga,
  SagaBuilder,
  runSaga,
  parallel,
  withRetry,
  withTimeout,
  createDistributedSagaCoordinator,
  SagaTimeoutError,
  SagaCompensationError,
  type SagaStep,
} from './saga'

describe('Saga / Compensation Patterns', () => {
  describe('SagaBuilder', () => {
    it('should build a saga with steps', () => {
      const saga = new SagaBuilder()
        .addStep({
          name: 'step1',
          execute: async () => 'result1',
        })
        .addStep({
          name: 'step2',
          execute: async (input) => `${input}-result2`,
        })
        .build()

      expect(saga).toBeInstanceOf(Saga)
    })
  })

  describe('Saga Execution', () => {
    it('should execute all steps in order', async () => {
      const executionOrder: string[] = []

      const saga = new SagaBuilder<void, string>()
        .addStep({
          name: 'step1',
          execute: async () => {
            executionOrder.push('step1')
            return 'result1'
          },
        })
        .addStep({
          name: 'step2',
          execute: async (input: string) => {
            executionOrder.push('step2')
            return `${input}-result2`
          },
        })
        .addStep({
          name: 'step3',
          execute: async (input: string) => {
            executionOrder.push('step3')
            return `${input}-result3`
          },
        })
        .build()

      const result = await saga.execute()

      expect(result.success).toBe(true)
      expect(result.result).toBe('result1-result2-result3')
      expect(executionOrder).toEqual(['step1', 'step2', 'step3'])
      expect(result.steps).toHaveLength(3)
      expect(result.compensated).toBe(false)
    })

    it('should pass input between steps', async () => {
      const saga = new SagaBuilder<number, string>()
        .addStep({
          name: 'double',
          execute: async (input: number) => input * 2,
        })
        .addStep({
          name: 'stringify',
          execute: async (input: number) => String(input),
        })
        .build()

      const result = await saga.execute(5)

      expect(result.success).toBe(true)
      expect(result.result).toBe('10')
    })

    it('should compensate on failure', async () => {
      const compensations: string[] = []

      const saga = new SagaBuilder()
        .addStep({
          name: 'step1',
          execute: async () => 'result1',
          compensate: async () => {
            compensations.push('compensate1')
          },
        })
        .addStep({
          name: 'step2',
          execute: async () => 'result2',
          compensate: async () => {
            compensations.push('compensate2')
          },
        })
        .addStep({
          name: 'step3',
          execute: async () => {
            throw new Error('Step 3 failed')
          },
        })
        .build()

      const result = await saga.execute()

      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Step 3 failed')
      expect(result.compensated).toBe(true)
      // Compensations run in reverse order
      expect(compensations).toEqual(['compensate2', 'compensate1'])
    })

    it('should not compensate steps that did not complete', async () => {
      const compensations: string[] = []

      const saga = new SagaBuilder()
        .addStep({
          name: 'step1',
          execute: async () => 'result1',
          compensate: async () => {
            compensations.push('compensate1')
          },
        })
        .addStep({
          name: 'step2',
          execute: async () => {
            throw new Error('Step 2 failed')
          },
          compensate: async () => {
            compensations.push('compensate2')
          },
        })
        .build()

      const result = await saga.execute()

      expect(result.success).toBe(false)
      // Only step1 should be compensated (step2 failed before completing)
      expect(compensations).toEqual(['compensate1'])
    })

    it('should track step results', async () => {
      const saga = new SagaBuilder()
        .addStep({
          name: 'step1',
          execute: async () => 'result1',
        })
        .addStep({
          name: 'step2',
          execute: async () => 'result2',
        })
        .build()

      const result = await saga.execute()

      expect(result.steps).toHaveLength(2)
      expect(result.steps[0]?.stepName).toBe('step1')
      expect(result.steps[0]?.success).toBe(true)
      expect(result.steps[0]?.result).toBe('result1')
      expect(result.steps[1]?.stepName).toBe('step2')
      expect(result.steps[1]?.success).toBe(true)
      expect(result.steps[1]?.result).toBe('result2')
    })

    it('should continue compensation on error by default', async () => {
      const compensations: string[] = []

      const saga = new SagaBuilder()
        .addStep({
          name: 'step1',
          execute: async () => 'result1',
          compensate: async () => {
            compensations.push('compensate1')
          },
        })
        .addStep({
          name: 'step2',
          execute: async () => 'result2',
          compensate: async () => {
            throw new Error('Compensation failed')
          },
        })
        .addStep({
          name: 'step3',
          execute: async () => {
            throw new Error('Step 3 failed')
          },
        })
        .build()

      const result = await saga.execute()

      expect(result.success).toBe(false)
      // Should still try to compensate step1 after step2 compensation fails
      expect(compensations).toEqual(['compensate1'])
      expect(result.compensationErrors).toHaveLength(1)
    })

    it('should stop compensation on error when configured', async () => {
      const compensations: string[] = []

      const saga = new SagaBuilder()
        .addStep({
          name: 'step1',
          execute: async () => 'result1',
          compensate: async () => {
            compensations.push('compensate1')
          },
        })
        .addStep({
          name: 'step2',
          execute: async () => 'result2',
          compensate: async () => {
            throw new Error('Compensation failed')
          },
        })
        .addStep({
          name: 'step3',
          execute: async () => {
            throw new Error('Step 3 failed')
          },
        })
        .build()

      const result = await saga.execute(undefined, {
        continueCompensationOnError: false,
      })

      expect(result.success).toBe(false)
      // Should stop after step2 compensation fails
      expect(compensations).toEqual([])
      expect(result.compensationErrors).toHaveLength(1)
    })
  })

  describe('Saga Retry', () => {
    it('should retry failed steps', async () => {
      let attempts = 0

      const saga = new SagaBuilder()
        .addStep({
          name: 'retryable',
          execute: async () => {
            attempts++
            if (attempts < 3) {
              throw new Error('Transient error')
            }
            return 'success'
          },
          retry: {
            maxAttempts: 3,
            initialInterval: 10,
          },
        })
        .build()

      const result = await saga.execute()

      expect(result.success).toBe(true)
      expect(result.result).toBe('success')
      expect(attempts).toBe(3)
    })

    it('should fail after max retries', async () => {
      let attempts = 0

      const saga = new SagaBuilder()
        .addStep({
          name: 'alwaysFails',
          execute: async () => {
            attempts++
            throw new Error('Persistent error')
          },
          retry: {
            maxAttempts: 3,
            initialInterval: 10,
          },
        })
        .build()

      const result = await saga.execute()

      expect(result.success).toBe(false)
      expect(attempts).toBe(3)
    })
  })

  describe('Saga Timeout', () => {
    it('should timeout slow steps', async () => {
      const saga = new SagaBuilder()
        .addStep({
          name: 'slow',
          execute: async () => {
            await new Promise(resolve => setTimeout(resolve, 1000))
            return 'done'
          },
          timeout: 50,
        })
        .build()

      const result = await saga.execute()

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('timed out')
    })
  })

  describe('runSaga convenience function', () => {
    it('should execute saga from steps array', async () => {
      const steps: SagaStep[] = [
        {
          name: 'step1',
          execute: async () => 'result1',
        },
        {
          name: 'step2',
          execute: async (input: string) => `${input}-result2`,
        },
      ]

      const result = await runSaga(steps, undefined)

      expect(result.success).toBe(true)
      expect(result.result).toBe('result1-result2')
    })
  })

  describe('Parallel Steps', () => {
    it('should execute steps in parallel', async () => {
      const startTime = Date.now()

      const saga = new SagaBuilder()
        .addStep(parallel({
          name: 'parallelSteps',
          steps: [
            {
              name: 'slow1',
              execute: async () => {
                await new Promise(resolve => setTimeout(resolve, 50))
                return 'result1'
              },
            },
            {
              name: 'slow2',
              execute: async () => {
                await new Promise(resolve => setTimeout(resolve, 50))
                return 'result2'
              },
            },
          ],
        }))
        .build()

      const result = await saga.execute()

      const duration = Date.now() - startTime

      expect(result.success).toBe(true)
      expect(result.result).toEqual(['result1', 'result2'])
      // Should take ~50ms (parallel) not ~100ms (sequential)
      expect(duration).toBeLessThan(100)
    })

    it('should compensate parallel steps in reverse order', async () => {
      const compensations: string[] = []

      const saga = new SagaBuilder()
        .addStep(parallel({
          name: 'parallelSteps',
          steps: [
            {
              name: 'step1',
              execute: async () => 'result1',
              compensate: async () => {
                compensations.push('compensate1')
              },
            },
            {
              name: 'step2',
              execute: async () => 'result2',
              compensate: async () => {
                compensations.push('compensate2')
              },
            },
          ],
        }))
        .addStep({
          name: 'failStep',
          execute: async () => {
            throw new Error('Failed')
          },
        })
        .build()

      const result = await saga.execute()

      expect(result.success).toBe(false)
      expect(compensations).toContain('compensate1')
      expect(compensations).toContain('compensate2')
    })
  })

  describe('withRetry helper', () => {
    it('should add retry options to step', () => {
      const step = withRetry(
        {
          name: 'step1',
          execute: async () => 'result',
        },
        { maxAttempts: 5 }
      )

      expect(step.retry?.maxAttempts).toBe(5)
    })
  })

  describe('withTimeout helper', () => {
    it('should add timeout to step', () => {
      const step = withTimeout(
        {
          name: 'step1',
          execute: async () => 'result',
        },
        5000
      )

      expect(step.timeout).toBe(5000)
    })
  })

  describe('Distributed Saga Coordinator', () => {
    it('should start and track saga', async () => {
      const coordinator = createDistributedSagaCoordinator()

      const saga = new SagaBuilder()
        .addStep({
          name: 'step1',
          execute: async () => 'result',
        })
        .build()

      const handle = await coordinator.start(saga, undefined)

      expect(handle.sagaId).toBeDefined()

      const result = await handle.result()

      expect(result.success).toBe(true)
    })

    it('should get saga state', async () => {
      const coordinator = createDistributedSagaCoordinator()

      const saga = new SagaBuilder()
        .addStep({
          name: 'step1',
          execute: async () => {
            await new Promise(resolve => setTimeout(resolve, 50))
            return 'result'
          },
        })
        .build()

      const handle = await coordinator.start(saga, undefined, {
        sagaId: 'test-saga-1',
      })

      // Check state while running
      const runningState = await coordinator.getState('test-saga-1')
      expect(runningState?.status).toBe('RUNNING')

      // Wait for completion
      await handle.result()

      // Check state after completion
      const completedState = await coordinator.getState('test-saga-1')
      expect(completedState?.status).toBe('COMPLETED')
    })

    it('should list active sagas', async () => {
      const coordinator = createDistributedSagaCoordinator()

      const saga = new SagaBuilder()
        .addStep({
          name: 'step1',
          execute: async () => {
            await new Promise(resolve => setTimeout(resolve, 100))
            return 'result'
          },
        })
        .build()

      await coordinator.start(saga, undefined, { sagaId: 'saga-1' })
      await coordinator.start(saga, undefined, { sagaId: 'saga-2' })

      const active = await coordinator.listActive()

      expect(active.length).toBe(2)
      expect(active.map(s => s.sagaId)).toContain('saga-1')
      expect(active.map(s => s.sagaId)).toContain('saga-2')
    })

    it('should abort saga', async () => {
      const coordinator = createDistributedSagaCoordinator()

      const saga = new SagaBuilder()
        .addStep({
          name: 'step1',
          execute: async () => {
            await new Promise(resolve => setTimeout(resolve, 1000))
            return 'result'
          },
        })
        .build()

      const handle = await coordinator.start(saga, undefined, {
        sagaId: 'abort-test',
      })

      // Abort immediately
      await handle.abort('User cancelled')

      const state = await handle.getState()
      expect(state.status).toBe('FAILED')
      expect(state.error).toBe('User cancelled')

      // Catch the expected rejection from the result promise
      await expect(handle.result()).rejects.toThrow('User cancelled')
    })

    it('should return null for non-existent saga', async () => {
      const coordinator = createDistributedSagaCoordinator()

      const state = await coordinator.getState('non-existent')

      expect(state).toBeNull()
    })
  })

  describe('Error Classes', () => {
    it('should create SagaTimeoutError', () => {
      const error = new SagaTimeoutError('Step timed out')

      expect(error.name).toBe('SagaTimeoutError')
      expect(error.message).toBe('Step timed out')
    })

    it('should create SagaCompensationError', () => {
      const original = new Error('Original error')
      const compErrors = [new Error('Comp error 1'), new Error('Comp error 2')]

      const error = new SagaCompensationError('Compensation failed', original, compErrors)

      expect(error.name).toBe('SagaCompensationError')
      expect(error.originalError).toBe(original)
      expect(error.compensationErrors).toEqual(compErrors)
    })
  })

  describe('Real-world Scenarios', () => {
    it('should handle order processing saga', async () => {
      const events: string[] = []

      interface Order {
        id: string
        amount: number
      }

      interface Reservation {
        id: string
        items: string[]
      }

      interface Payment {
        id: string
        amount: number
      }

      const saga = new SagaBuilder<Order, string>()
        .addStep<Order, Reservation>({
          name: 'reserveInventory',
          execute: async (order) => {
            events.push(`Reserve inventory for order ${order.id}`)
            return { id: 'res-1', items: ['item-1', 'item-2'] }
          },
          compensate: async (reservation) => {
            events.push(`Release inventory reservation ${reservation.id}`)
          },
        })
        .addStep<Reservation, Payment>({
          name: 'processPayment',
          execute: async (reservation) => {
            events.push(`Process payment for reservation ${reservation.id}`)
            return { id: 'pay-1', amount: 100 }
          },
          compensate: async (payment) => {
            events.push(`Refund payment ${payment.id}`)
          },
        })
        .addStep<Payment, string>({
          name: 'shipOrder',
          execute: async (payment) => {
            events.push(`Ship order with payment ${payment.id}`)
            return 'shipped'
          },
          compensate: async () => {
            events.push('Cancel shipment')
          },
        })
        .build()

      const result = await saga.execute({ id: 'order-1', amount: 100 })

      expect(result.success).toBe(true)
      expect(result.result).toBe('shipped')
      expect(events).toEqual([
        'Reserve inventory for order order-1',
        'Process payment for reservation res-1',
        'Ship order with payment pay-1',
      ])
    })

    it('should handle order processing saga with failure', async () => {
      const events: string[] = []

      interface Order {
        id: string
        amount: number
      }

      interface Reservation {
        id: string
        items: string[]
      }

      const saga = new SagaBuilder<Order, string>()
        .addStep<Order, Reservation>({
          name: 'reserveInventory',
          execute: async (order) => {
            events.push(`Reserve inventory for order ${order.id}`)
            return { id: 'res-1', items: ['item-1', 'item-2'] }
          },
          compensate: async (reservation) => {
            events.push(`Release inventory reservation ${reservation.id}`)
          },
        })
        .addStep<Reservation, never>({
          name: 'processPayment',
          execute: async () => {
            events.push('Attempt payment')
            throw new Error('Payment declined')
          },
          compensate: async () => {
            events.push('Refund payment')
          },
        })
        .build()

      const result = await saga.execute({ id: 'order-1', amount: 100 })

      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Payment declined')
      expect(result.compensated).toBe(true)
      expect(events).toEqual([
        'Reserve inventory for order order-1',
        'Attempt payment',
        'Release inventory reservation res-1',
      ])
    })
  })
})
