/**
 * Workflow() Factory Tests
 *
 * RED TDD: These tests define the expected interface for the Workflow() factory.
 *
 * Workflow() is a factory that creates workflow definitions with:
 * - Configuration (name, description)
 * - Steps (.step()) for execution logic
 * - Triggers (.trigger()) for webhooks, cron, events
 * - Event handlers (.on())
 *
 * The factory validates definitions and produces workflow entrypoints.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// This import will FAIL - WorkflowFactory doesn't exist yet
import {
  Workflow,
  type WorkflowDefinition,
  type WorkflowStepHandler,
  type WorkflowTriggerConfig,
  type WorkflowEventHandler,
  type WorkflowEntrypoint,
  WorkflowValidationError,
} from '../WorkflowFactory'

// ============================================================================
// TYPE DEFINITIONS (for test clarity)
// ============================================================================

interface StepContext {
  workflowId: string
  instanceId: string
  stepName: string
  input: unknown
  emit: (event: string, data: unknown) => Promise<void>
  log: (message: string, data?: unknown) => void
  sleep: (ms: number) => Promise<void>
  waitForEvent: <T>(eventType: string, options?: { timeout?: number }) => Promise<T>
}

interface TriggerContext {
  workflowId: string
  type: 'webhook' | 'cron' | 'event'
  payload: unknown
}

// ============================================================================
// MOCK DATA
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

// ============================================================================
// TESTS
// ============================================================================

describe('Workflow Factory', () => {
  // ==========================================================================
  // 1. FACTORY CREATION TESTS
  // ==========================================================================

  describe('Factory Creation', () => {
    describe('Basic workflow creation', () => {
      it('creates a workflow with name', () => {
        const workflow = Workflow({
          name: 'order-processing',
        })

        expect(workflow).toBeDefined()
        expect(workflow.name).toBe('order-processing')
      })

      it('creates a workflow with name and description', () => {
        const workflow = Workflow({
          name: 'order-processing',
          description: 'Process customer orders',
        })

        expect(workflow.name).toBe('order-processing')
        expect(workflow.description).toBe('Process customer orders')
      })

      it('creates a workflow with optional metadata', () => {
        const workflow = Workflow({
          name: 'order-processing',
          description: 'Process customer orders',
          version: '1.0.0',
          tags: ['orders', 'e-commerce'],
        })

        expect(workflow.version).toBe('1.0.0')
        expect(workflow.tags).toEqual(['orders', 'e-commerce'])
      })

      it('returns a chainable workflow builder', () => {
        const workflow = Workflow({
          name: 'test-workflow',
        })

        expect(typeof workflow.step).toBe('function')
        expect(typeof workflow.trigger).toBe('function')
        expect(typeof workflow.on).toBe('function')
      })
    })

    describe('Validation', () => {
      it('throws WorkflowValidationError when name is missing', () => {
        expect(() => {
          Workflow({} as WorkflowDefinition)
        }).toThrow(WorkflowValidationError)
      })

      it('throws WorkflowValidationError when name is empty', () => {
        expect(() => {
          Workflow({ name: '' })
        }).toThrow(WorkflowValidationError)
      })

      it('throws WorkflowValidationError when name contains invalid characters', () => {
        expect(() => {
          Workflow({ name: 'invalid name with spaces' })
        }).toThrow(WorkflowValidationError)

        expect(() => {
          Workflow({ name: 'invalid/name' })
        }).toThrow(WorkflowValidationError)
      })

      it('allows valid name patterns', () => {
        const validNames = [
          'order-processing',
          'orderProcessing',
          'order_processing',
          'order123',
          'OrderProcessing',
        ]

        for (const name of validNames) {
          expect(() => Workflow({ name })).not.toThrow()
        }
      })

      it('provides descriptive error messages', () => {
        try {
          Workflow({ name: '' })
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(WorkflowValidationError)
          expect((error as WorkflowValidationError).message).toMatch(/name/i)
        }
      })
    })
  })

  // ==========================================================================
  // 2. STEP DEFINITION TESTS
  // ==========================================================================

  describe('Step Definition', () => {
    describe('Adding steps', () => {
      it('adds a step with name and handler', () => {
        const workflow = Workflow({
          name: 'order-processing',
        }).step('validate', validateOrder)

        expect(workflow.steps).toHaveLength(1)
        expect(workflow.steps[0].name).toBe('validate')
        expect(workflow.steps[0].handler).toBe(validateOrder)
      })

      it('supports chaining multiple steps', () => {
        const workflow = Workflow({
          name: 'order-processing',
        })
          .step('validate', validateOrder)
          .step('charge', chargePayment)
          .step('fulfill', fulfillOrder)

        expect(workflow.steps).toHaveLength(3)
        expect(workflow.steps[0].name).toBe('validate')
        expect(workflow.steps[1].name).toBe('charge')
        expect(workflow.steps[2].name).toBe('fulfill')
      })

      it('supports step options', () => {
        const workflow = Workflow({
          name: 'order-processing',
        }).step('validate', validateOrder, {
          timeout: 30000,
          retries: 3,
          retryDelay: 1000,
        })

        expect(workflow.steps[0].timeout).toBe(30000)
        expect(workflow.steps[0].retries).toBe(3)
        expect(workflow.steps[0].retryDelay).toBe(1000)
      })

      it('preserves step order', () => {
        const workflow = Workflow({
          name: 'order-processing',
        })
          .step('first', async () => 'first')
          .step('second', async () => 'second')
          .step('third', async () => 'third')

        expect(workflow.steps.map((s) => s.name)).toEqual(['first', 'second', 'third'])
      })
    })

    describe('Step validation', () => {
      it('throws when step name is empty', () => {
        expect(() => {
          Workflow({ name: 'test' }).step('', async () => {})
        }).toThrow(WorkflowValidationError)
      })

      it('throws when step name contains invalid characters', () => {
        expect(() => {
          Workflow({ name: 'test' }).step('invalid step', async () => {})
        }).toThrow(WorkflowValidationError)
      })

      it('throws when handler is not a function', () => {
        expect(() => {
          Workflow({ name: 'test' }).step('validate', 'not a function' as unknown as WorkflowStepHandler)
        }).toThrow(WorkflowValidationError)
      })

      it('throws when step name is duplicated', () => {
        expect(() => {
          Workflow({ name: 'test' })
            .step('validate', validateOrder)
            .step('validate', chargePayment)
        }).toThrow(WorkflowValidationError)
      })

      it('throws when timeout is negative', () => {
        expect(() => {
          Workflow({ name: 'test' }).step('validate', validateOrder, { timeout: -1000 })
        }).toThrow(WorkflowValidationError)
      })

      it('throws when retries is negative', () => {
        expect(() => {
          Workflow({ name: 'test' }).step('validate', validateOrder, { retries: -1 })
        }).toThrow(WorkflowValidationError)
      })
    })

    describe('Step types', () => {
      it('supports do steps (default)', () => {
        const workflow = Workflow({ name: 'test' }).step('process', async () => 'done')

        expect(workflow.steps[0].type).toBe('do')
      })

      it('supports sleep steps', () => {
        const workflow = Workflow({ name: 'test' }).step('wait', {
          type: 'sleep',
          duration: 5000,
        })

        expect(workflow.steps[0].type).toBe('sleep')
        expect(workflow.steps[0].duration).toBe(5000)
      })

      it('supports waitForEvent steps', () => {
        const workflow = Workflow({ name: 'test' }).step('awaitApproval', {
          type: 'waitForEvent',
          event: 'approval.received',
          timeout: 86400000,
        })

        expect(workflow.steps[0].type).toBe('waitForEvent')
        expect(workflow.steps[0].event).toBe('approval.received')
        expect(workflow.steps[0].timeout).toBe(86400000)
      })
    })
  })

  // ==========================================================================
  // 3. TRIGGER CONFIGURATION TESTS
  // ==========================================================================

  describe('Trigger Configuration', () => {
    describe('Webhook triggers', () => {
      it('adds a webhook trigger', () => {
        const workflow = Workflow({ name: 'order-processing' })
          .step('process', async () => 'done')
          .trigger('webhook', { path: '/orders/new' })

        expect(workflow.triggers).toHaveLength(1)
        expect(workflow.triggers[0].type).toBe('webhook')
        expect(workflow.triggers[0].config.path).toBe('/orders/new')
      })

      it('supports webhook with method filter', () => {
        const workflow = Workflow({ name: 'order-processing' })
          .step('process', async () => 'done')
          .trigger('webhook', {
            path: '/orders/new',
            method: 'POST',
          })

        expect(workflow.triggers[0].config.method).toBe('POST')
      })

      it('supports webhook with custom headers', () => {
        const workflow = Workflow({ name: 'order-processing' })
          .step('process', async () => 'done')
          .trigger('webhook', {
            path: '/orders/new',
            headers: {
              'X-API-Key': 'required',
            },
          })

        expect(workflow.triggers[0].config.headers).toEqual({ 'X-API-Key': 'required' })
      })

      it('supports webhook with input transform', () => {
        const transform = (req: Request) => ({ body: req.body })

        const workflow = Workflow({ name: 'order-processing' })
          .step('process', async () => 'done')
          .trigger('webhook', {
            path: '/orders/new',
            transform,
          })

        expect(workflow.triggers[0].config.transform).toBe(transform)
      })
    })

    describe('Cron triggers', () => {
      it('adds a cron trigger', () => {
        const workflow = Workflow({ name: 'daily-report' })
          .step('generate', async () => 'report')
          .trigger('cron', { schedule: '0 0 * * *' })

        expect(workflow.triggers).toHaveLength(1)
        expect(workflow.triggers[0].type).toBe('cron')
        expect(workflow.triggers[0].config.schedule).toBe('0 0 * * *')
      })

      it('supports named schedules', () => {
        const workflow = Workflow({ name: 'daily-report' })
          .step('generate', async () => 'report')
          .trigger('cron', {
            schedule: '0 0 * * *',
            name: 'midnight-run',
          })

        expect(workflow.triggers[0].config.name).toBe('midnight-run')
      })

      it('supports timezone', () => {
        const workflow = Workflow({ name: 'daily-report' })
          .step('generate', async () => 'report')
          .trigger('cron', {
            schedule: '0 9 * * *',
            timezone: 'America/New_York',
          })

        expect(workflow.triggers[0].config.timezone).toBe('America/New_York')
      })
    })

    describe('Event triggers', () => {
      it('adds an event trigger', () => {
        const workflow = Workflow({ name: 'order-handler' })
          .step('process', async () => 'done')
          .trigger('event', { event: 'order.created' })

        expect(workflow.triggers).toHaveLength(1)
        expect(workflow.triggers[0].type).toBe('event')
        expect(workflow.triggers[0].config.event).toBe('order.created')
      })

      it('supports event filter', () => {
        const workflow = Workflow({ name: 'order-handler' })
          .step('process', async () => 'done')
          .trigger('event', {
            event: 'order.created',
            filter: (payload: { amount: number }) => payload.amount > 100,
          })

        expect(workflow.triggers[0].config.filter).toBeDefined()
      })

      it('supports multiple event types', () => {
        const workflow = Workflow({ name: 'order-handler' })
          .step('process', async () => 'done')
          .trigger('event', {
            events: ['order.created', 'order.updated'],
          })

        expect(workflow.triggers[0].config.events).toEqual(['order.created', 'order.updated'])
      })
    })

    describe('Multiple triggers', () => {
      it('supports multiple triggers', () => {
        const workflow = Workflow({ name: 'multi-trigger' })
          .step('process', async () => 'done')
          .trigger('webhook', { path: '/trigger' })
          .trigger('cron', { schedule: '0 * * * *' })
          .trigger('event', { event: 'manual.trigger' })

        expect(workflow.triggers).toHaveLength(3)
      })
    })

    describe('Trigger validation', () => {
      it('throws when webhook path is missing', () => {
        expect(() => {
          Workflow({ name: 'test' })
            .step('process', async () => 'done')
            .trigger('webhook', {} as WorkflowTriggerConfig)
        }).toThrow(WorkflowValidationError)
      })

      it('throws when cron schedule is invalid', () => {
        expect(() => {
          Workflow({ name: 'test' })
            .step('process', async () => 'done')
            .trigger('cron', { schedule: 'invalid cron' })
        }).toThrow(WorkflowValidationError)
      })

      it('throws when event name is missing', () => {
        expect(() => {
          Workflow({ name: 'test' })
            .step('process', async () => 'done')
            .trigger('event', {} as WorkflowTriggerConfig)
        }).toThrow(WorkflowValidationError)
      })
    })
  })

  // ==========================================================================
  // 4. EVENT HANDLER TESTS
  // ==========================================================================

  describe('Event Handlers', () => {
    describe('Adding event handlers', () => {
      it('adds an event handler with .on()', () => {
        const handler = vi.fn()
        const workflow = Workflow({ name: 'test' })
          .step('process', async () => 'done')
          .on('workflow.started', handler)

        expect(workflow.eventHandlers).toHaveLength(1)
        expect(workflow.eventHandlers[0].event).toBe('workflow.started')
        expect(workflow.eventHandlers[0].handler).toBe(handler)
      })

      it('supports multiple event handlers', () => {
        const startHandler = vi.fn()
        const completeHandler = vi.fn()
        const errorHandler = vi.fn()

        const workflow = Workflow({ name: 'test' })
          .step('process', async () => 'done')
          .on('workflow.started', startHandler)
          .on('workflow.completed', completeHandler)
          .on('workflow.failed', errorHandler)

        expect(workflow.eventHandlers).toHaveLength(3)
      })

      it('supports step-specific events', () => {
        const handler = vi.fn()
        const workflow = Workflow({ name: 'test' })
          .step('validate', validateOrder)
          .on('step.validate.completed', handler)

        expect(workflow.eventHandlers[0].event).toBe('step.validate.completed')
      })

      it('supports wildcard event patterns', () => {
        const handler = vi.fn()
        const workflow = Workflow({ name: 'test' })
          .step('process', async () => 'done')
          .on('step.*.failed', handler)

        expect(workflow.eventHandlers[0].event).toBe('step.*.failed')
      })
    })

    describe('Built-in event types', () => {
      it('recognizes workflow lifecycle events', () => {
        const workflow = Workflow({ name: 'test' })
          .step('process', async () => 'done')
          .on('workflow.started', vi.fn())
          .on('workflow.completed', vi.fn())
          .on('workflow.failed', vi.fn())
          .on('workflow.paused', vi.fn())
          .on('workflow.resumed', vi.fn())

        expect(workflow.eventHandlers).toHaveLength(5)
      })

      it('recognizes step lifecycle events', () => {
        const workflow = Workflow({ name: 'test' })
          .step('process', async () => 'done')
          .on('step.started', vi.fn())
          .on('step.completed', vi.fn())
          .on('step.failed', vi.fn())
          .on('step.retrying', vi.fn())

        expect(workflow.eventHandlers).toHaveLength(4)
      })
    })

    describe('Event handler validation', () => {
      it('throws when event name is empty', () => {
        expect(() => {
          Workflow({ name: 'test' }).on('', vi.fn())
        }).toThrow(WorkflowValidationError)
      })

      it('throws when handler is not a function', () => {
        expect(() => {
          Workflow({ name: 'test' }).on('workflow.started', 'not a function' as unknown as WorkflowEventHandler)
        }).toThrow(WorkflowValidationError)
      })
    })
  })

  // ==========================================================================
  // 5. WORKFLOW ENTRYPOINT TESTS
  // ==========================================================================

  describe('Workflow Entrypoint', () => {
    describe('Creating entrypoint', () => {
      it('creates a workflow entrypoint class', () => {
        const MyWorkflow = Workflow({
          name: 'order-processing',
          description: 'Process customer orders',
        })
          .step('validate', validateOrder)
          .step('charge', chargePayment)
          .step('fulfill', fulfillOrder)
          .trigger('webhook', { path: '/orders/new' })
          .create()

        expect(MyWorkflow).toBeDefined()
        expect(typeof MyWorkflow).toBe('function')
      })

      it('entrypoint has static workflow configuration', () => {
        const MyWorkflow = Workflow({
          name: 'order-processing',
        })
          .step('validate', validateOrder)
          .create()

        expect(MyWorkflow.workflowName).toBe('order-processing')
        expect(MyWorkflow.steps).toBeDefined()
        expect(MyWorkflow.triggers).toBeDefined()
      })

      it('entrypoint can be instantiated', () => {
        const MyWorkflow = Workflow({
          name: 'order-processing',
        })
          .step('validate', validateOrder)
          .create()

        const instance = new MyWorkflow()
        expect(instance).toBeDefined()
      })
    })

    describe('Entrypoint interface', () => {
      it('entrypoint implements run method', () => {
        const MyWorkflow = Workflow({
          name: 'test',
        })
          .step('process', async () => 'done')
          .create()

        const instance = new MyWorkflow()
        expect(typeof instance.run).toBe('function')
      })

      it('entrypoint has step methods', () => {
        const MyWorkflow = Workflow({
          name: 'test',
        })
          .step('process', async () => 'done')
          .create()

        const instance = new MyWorkflow()
        expect(typeof instance.step).toBeDefined()
      })

      it('entrypoint run method accepts event', async () => {
        const handler = vi.fn().mockResolvedValue('done')

        const MyWorkflow = Workflow({
          name: 'test',
        })
          .step('process', handler)
          .create()

        // Create mock event
        const mockEvent = {
          payload: { orderId: '123' },
          timestamp: new Date(),
        }

        const instance = new MyWorkflow()
        await instance.run(mockEvent, {} as StepContext)

        expect(handler).toHaveBeenCalled()
      })
    })

    describe('Validation on create', () => {
      it('throws when no steps are defined', () => {
        expect(() => {
          Workflow({ name: 'empty-workflow' }).create()
        }).toThrow(WorkflowValidationError)
      })

      it('throws validation errors for invalid configuration', () => {
        expect(() => {
          Workflow({ name: '' }).step('test', async () => {}).create()
        }).toThrow(WorkflowValidationError)
      })
    })
  })

  // ==========================================================================
  // 6. COMPLETE WORKFLOW EXAMPLE TESTS
  // ==========================================================================

  describe('Complete Workflow Examples', () => {
    it('creates the order processing workflow from the spec', () => {
      const myWorkflow = Workflow({
        name: 'order-processing',
        description: 'Process customer orders',
      })
        .step('validate', validateOrder)
        .step('charge', chargePayment)
        .step('fulfill', fulfillOrder)
        .trigger('webhook', { path: '/orders/new' })

      expect(myWorkflow.name).toBe('order-processing')
      expect(myWorkflow.description).toBe('Process customer orders')
      expect(myWorkflow.steps).toHaveLength(3)
      expect(myWorkflow.triggers).toHaveLength(1)
      expect(myWorkflow.triggers[0].type).toBe('webhook')
      expect(myWorkflow.triggers[0].config.path).toBe('/orders/new')
    })

    it('creates a workflow with mixed step types', () => {
      const workflow = Workflow({
        name: 'approval-workflow',
      })
        .step('submit', async (input) => ({ submitted: true, ...input as object }))
        .step('wait', { type: 'sleep', duration: 1000 })
        .step('awaitApproval', {
          type: 'waitForEvent',
          event: 'approval.received',
          timeout: 86400000,
        })
        .step('process', async () => ({ processed: true }))
        .trigger('event', { event: 'request.submitted' })

      expect(workflow.steps).toHaveLength(4)
      expect(workflow.steps[0].type).toBe('do')
      expect(workflow.steps[1].type).toBe('sleep')
      expect(workflow.steps[2].type).toBe('waitForEvent')
      expect(workflow.steps[3].type).toBe('do')
    })

    it('creates a scheduled workflow with error handling', () => {
      const workflow = Workflow({
        name: 'daily-report',
        description: 'Generate daily reports',
      })
        .step('fetchData', async () => ({ data: [] }), { retries: 3 })
        .step('generateReport', async () => ({ report: 'done' }))
        .step('sendEmail', async () => ({ sent: true }))
        .trigger('cron', { schedule: '0 0 * * *', timezone: 'UTC' })
        .on('workflow.failed', async (event) => {
          console.error('Report generation failed:', event)
        })
        .on('workflow.completed', async (event) => {
          console.log('Report completed:', event)
        })

      expect(workflow.steps).toHaveLength(3)
      expect(workflow.steps[0].retries).toBe(3)
      expect(workflow.triggers[0].type).toBe('cron')
      expect(workflow.eventHandlers).toHaveLength(2)
    })

    it('creates an event-driven workflow', () => {
      const workflow = Workflow({
        name: 'order-notification',
      })
        .step('notify', async (input) => {
          const order = input as { orderId: string }
          return { notified: true, orderId: order.orderId }
        })
        .trigger('event', {
          events: ['order.created', 'order.updated', 'order.shipped'],
        })

      expect(workflow.triggers[0].config.events).toHaveLength(3)
    })
  })

  // ==========================================================================
  // 7. SERIALIZATION & INTROSPECTION TESTS
  // ==========================================================================

  describe('Serialization & Introspection', () => {
    it('can serialize workflow definition to JSON', () => {
      const workflow = Workflow({
        name: 'test-workflow',
        description: 'Test description',
      })
        .step('step1', async () => {})
        .step('step2', async () => {})
        .trigger('webhook', { path: '/test' })

      const json = workflow.toJSON()

      expect(json).toEqual({
        name: 'test-workflow',
        description: 'Test description',
        steps: [
          { name: 'step1', type: 'do' },
          { name: 'step2', type: 'do' },
        ],
        triggers: [
          { type: 'webhook', config: { path: '/test' } },
        ],
        eventHandlers: [],
      })
    })

    it('does not serialize handler functions', () => {
      const workflow = Workflow({
        name: 'test',
      })
        .step('process', async () => 'sensitive logic')

      const json = workflow.toJSON()

      expect(json.steps[0]).not.toHaveProperty('handler')
    })

    it('can describe workflow structure', () => {
      const workflow = Workflow({
        name: 'complex-workflow',
      })
        .step('validate', validateOrder)
        .step('charge', chargePayment)
        .step('fulfill', fulfillOrder)
        .trigger('webhook', { path: '/start' })
        .trigger('cron', { schedule: '0 * * * *' })

      const description = workflow.describe()

      expect(description).toEqual({
        name: 'complex-workflow',
        stepCount: 3,
        stepNames: ['validate', 'charge', 'fulfill'],
        triggerTypes: ['webhook', 'cron'],
        hasEventHandlers: false,
      })
    })

    it('can get workflow metadata', () => {
      const workflow = Workflow({
        name: 'test-workflow',
        version: '1.0.0',
        tags: ['test'],
      })
        .step('process', async () => {})

      const meta = workflow.getMetadata()

      expect(meta).toEqual({
        name: 'test-workflow',
        version: '1.0.0',
        tags: ['test'],
        stepCount: 1,
        triggerCount: 0,
        eventHandlerCount: 0,
      })
    })
  })
})
