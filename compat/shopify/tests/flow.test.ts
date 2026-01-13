/**
 * @dotdo/shopify - Flow Automation Tests
 *
 * TDD tests for Shopify Flow automation compatibility layer.
 * Tests triggers, conditions, actions, workflow templates, and execution.
 *
 * @module @dotdo/shopify/tests/flow
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  FlowEngine,
  FlowTemplates,
  ConditionEvaluator,
  ActionExecutor,
  type FlowCondition,
  type FlowAction,
  type FlowWorkflow,
  type ActionContext,
} from '../flow'

// =============================================================================
// Condition Evaluator Tests
// =============================================================================

describe('Flow Conditions', () => {
  let evaluator: ConditionEvaluator

  beforeEach(() => {
    evaluator = new ConditionEvaluator()
  })

  describe('equals operator', () => {
    it('should match equal strings (case-insensitive)', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'customer.email',
        operator: 'equals',
        value: 'test@example.com',
      }

      expect(evaluator.evaluate(condition, { customer: { email: 'test@example.com' } })).toBe(true)
      expect(evaluator.evaluate(condition, { customer: { email: 'TEST@EXAMPLE.COM' } })).toBe(true)
      expect(evaluator.evaluate(condition, { customer: { email: 'other@example.com' } })).toBe(false)
    })

    it('should match equal numbers', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'order.quantity',
        operator: 'equals',
        value: 5,
      }

      expect(evaluator.evaluate(condition, { order: { quantity: 5 } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { quantity: 10 } })).toBe(false)
    })

    it('should match money strings as numbers', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'order.total',
        operator: 'equals',
        value: '99.99',
      }

      expect(evaluator.evaluate(condition, { order: { total: '99.99' } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { total: 99.99 } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { total: '$99.99' } })).toBe(true)
    })

    it('should match boolean values', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'customer.verified',
        operator: 'equals',
        value: true,
      }

      expect(evaluator.evaluate(condition, { customer: { verified: true } })).toBe(true)
      expect(evaluator.evaluate(condition, { customer: { verified: false } })).toBe(false)
    })
  })

  describe('not_equals operator', () => {
    it('should match non-equal values', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'order.status',
        operator: 'not_equals',
        value: 'cancelled',
      }

      expect(evaluator.evaluate(condition, { order: { status: 'open' } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { status: 'cancelled' } })).toBe(false)
    })
  })

  describe('greater_than operator', () => {
    it('should compare numbers correctly', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'order.total_price',
        operator: 'greater_than',
        value: 100,
      }

      expect(evaluator.evaluate(condition, { order: { total_price: 150 } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { total_price: 100 } })).toBe(false)
      expect(evaluator.evaluate(condition, { order: { total_price: 50 } })).toBe(false)
    })

    it('should handle money strings', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'customer.total_spent',
        operator: 'greater_than',
        value: '1000.00',
      }

      expect(evaluator.evaluate(condition, { customer: { total_spent: '1500.00' } })).toBe(true)
      expect(evaluator.evaluate(condition, { customer: { total_spent: '$1,500.00' } })).toBe(true)
      expect(evaluator.evaluate(condition, { customer: { total_spent: '500.00' } })).toBe(false)
    })
  })

  describe('greater_than_or_equals operator', () => {
    it('should include equal values', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'quantity',
        operator: 'greater_than_or_equals',
        value: 10,
      }

      expect(evaluator.evaluate(condition, { quantity: 10 })).toBe(true)
      expect(evaluator.evaluate(condition, { quantity: 15 })).toBe(true)
      expect(evaluator.evaluate(condition, { quantity: 5 })).toBe(false)
    })
  })

  describe('less_than operator', () => {
    it('should compare numbers correctly', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'inventory_level.available',
        operator: 'less_than',
        value: 10,
      }

      expect(evaluator.evaluate(condition, { inventory_level: { available: 5 } })).toBe(true)
      expect(evaluator.evaluate(condition, { inventory_level: { available: 10 } })).toBe(false)
      expect(evaluator.evaluate(condition, { inventory_level: { available: 15 } })).toBe(false)
    })
  })

  describe('less_than_or_equals operator', () => {
    it('should include equal values', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'quantity',
        operator: 'less_than_or_equals',
        value: 10,
      }

      expect(evaluator.evaluate(condition, { quantity: 10 })).toBe(true)
      expect(evaluator.evaluate(condition, { quantity: 5 })).toBe(true)
      expect(evaluator.evaluate(condition, { quantity: 15 })).toBe(false)
    })
  })

  describe('contains operator', () => {
    it('should check string contains', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'order.note',
        operator: 'contains',
        value: 'gift',
      }

      expect(evaluator.evaluate(condition, { order: { note: 'This is a gift order' } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { note: 'GIFT wrap please' } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { note: 'Regular order' } })).toBe(false)
    })

    it('should check array contains', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'customer.tags',
        operator: 'contains',
        value: 'vip',
      }

      expect(evaluator.evaluate(condition, { customer: { tags: ['vip', 'loyal'] } })).toBe(true)
      expect(evaluator.evaluate(condition, { customer: { tags: ['VIP', 'loyal'] } })).toBe(true)
      expect(evaluator.evaluate(condition, { customer: { tags: ['regular'] } })).toBe(false)
    })
  })

  describe('not_contains operator', () => {
    it('should check string does not contain', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'order.tags',
        operator: 'not_contains',
        value: 'fraud',
      }

      expect(evaluator.evaluate(condition, { order: { tags: 'normal order' } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { tags: 'potential fraud' } })).toBe(false)
    })
  })

  describe('starts_with operator', () => {
    it('should check string prefix', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'product.sku',
        operator: 'starts_with',
        value: 'SKU-',
      }

      expect(evaluator.evaluate(condition, { product: { sku: 'SKU-12345' } })).toBe(true)
      expect(evaluator.evaluate(condition, { product: { sku: 'sku-12345' } })).toBe(true)
      expect(evaluator.evaluate(condition, { product: { sku: 'PROD-12345' } })).toBe(false)
    })
  })

  describe('ends_with operator', () => {
    it('should check string suffix', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'customer.email',
        operator: 'ends_with',
        value: '@company.com',
      }

      expect(evaluator.evaluate(condition, { customer: { email: 'user@company.com' } })).toBe(true)
      expect(evaluator.evaluate(condition, { customer: { email: 'user@COMPANY.COM' } })).toBe(true)
      expect(evaluator.evaluate(condition, { customer: { email: 'user@gmail.com' } })).toBe(false)
    })
  })

  describe('is_empty operator', () => {
    it('should check for empty values', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'order.note',
        operator: 'is_empty',
      }

      expect(evaluator.evaluate(condition, { order: { note: null } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { note: undefined } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { note: '' } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { note: '  ' } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { note: 'Some note' } })).toBe(false)
    })

    it('should check for empty arrays', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'customer.tags',
        operator: 'is_empty',
      }

      expect(evaluator.evaluate(condition, { customer: { tags: [] } })).toBe(true)
      expect(evaluator.evaluate(condition, { customer: { tags: ['vip'] } })).toBe(false)
    })
  })

  describe('is_not_empty operator', () => {
    it('should check for non-empty values', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'order.shipping_address',
        operator: 'is_not_empty',
      }

      expect(evaluator.evaluate(condition, { order: { shipping_address: { city: 'NYC' } } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { shipping_address: null } })).toBe(false)
    })
  })

  describe('in operator', () => {
    it('should check if value is in array', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'order.financial_status',
        operator: 'in',
        value: ['paid', 'authorized', 'partially_paid'],
      }

      expect(evaluator.evaluate(condition, { order: { financial_status: 'paid' } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { financial_status: 'authorized' } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { financial_status: 'pending' } })).toBe(false)
    })
  })

  describe('not_in operator', () => {
    it('should check if value is not in array', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'order.status',
        operator: 'not_in',
        value: ['cancelled', 'closed'],
      }

      expect(evaluator.evaluate(condition, { order: { status: 'open' } })).toBe(true)
      expect(evaluator.evaluate(condition, { order: { status: 'cancelled' } })).toBe(false)
    })
  })

  describe('matches_regex operator', () => {
    it('should match against regex pattern', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'customer.phone',
        operator: 'matches_regex',
        value: '^\\+1[0-9]{10}$',
      }

      expect(evaluator.evaluate(condition, { customer: { phone: '+11234567890' } })).toBe(true)
      expect(evaluator.evaluate(condition, { customer: { phone: '1234567890' } })).toBe(false)
    })

    it('should handle invalid regex gracefully', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'value',
        operator: 'matches_regex',
        value: '[invalid',
      }

      expect(evaluator.evaluate(condition, { value: 'test' })).toBe(false)
    })
  })

  describe('nested conditions', () => {
    it('should handle AND conditions', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'order.total_price',
        operator: 'greater_than',
        value: 100,
        and: [
          {
            id: 'cond-2',
            property: 'customer.orders_count',
            operator: 'equals',
            value: 1,
          },
        ],
      }

      // Both conditions must be true
      expect(
        evaluator.evaluate(condition, {
          order: { total_price: 150 },
          customer: { orders_count: 1 },
        })
      ).toBe(true)

      // Main condition true, AND condition false
      expect(
        evaluator.evaluate(condition, {
          order: { total_price: 150 },
          customer: { orders_count: 5 },
        })
      ).toBe(false)

      // Main condition false
      expect(
        evaluator.evaluate(condition, {
          order: { total_price: 50 },
          customer: { orders_count: 1 },
        })
      ).toBe(false)
    })

    it('should handle OR conditions', () => {
      const condition: FlowCondition = {
        id: 'cond-1',
        property: 'order.total_price',
        operator: 'greater_than',
        value: 1000,
        or: [
          {
            id: 'cond-2',
            property: 'customer.tags',
            operator: 'contains',
            value: 'vip',
          },
        ],
      }

      // Main condition true
      expect(
        evaluator.evaluate(condition, {
          order: { total_price: 1500 },
          customer: { tags: [] },
        })
      ).toBe(true)

      // OR condition true
      expect(
        evaluator.evaluate(condition, {
          order: { total_price: 50 },
          customer: { tags: ['vip'] },
        })
      ).toBe(true)

      // Both conditions false
      expect(
        evaluator.evaluate(condition, {
          order: { total_price: 50 },
          customer: { tags: ['regular'] },
        })
      ).toBe(false)
    })
  })

  describe('evaluateAll', () => {
    it('should return true for empty conditions', () => {
      expect(evaluator.evaluateAll([], {})).toBe(true)
    })

    it('should require all conditions to pass (AND logic)', () => {
      const conditions: FlowCondition[] = [
        {
          id: 'cond-1',
          property: 'order.total_price',
          operator: 'greater_than',
          value: 100,
        },
        {
          id: 'cond-2',
          property: 'customer.verified',
          operator: 'equals',
          value: true,
        },
      ]

      expect(
        evaluator.evaluateAll(conditions, {
          order: { total_price: 150 },
          customer: { verified: true },
        })
      ).toBe(true)

      expect(
        evaluator.evaluateAll(conditions, {
          order: { total_price: 150 },
          customer: { verified: false },
        })
      ).toBe(false)
    })
  })
})

// =============================================================================
// Action Executor Tests
// =============================================================================

describe('Flow Actions', () => {
  let executor: ActionExecutor

  beforeEach(() => {
    executor = new ActionExecutor()
  })

  describe('built-in actions', () => {
    const mockContext: ActionContext = {
      workflowId: 'wf-1',
      executionId: 'exec-1',
      triggerData: { order: { id: 1001, total_price: '99.99' } },
      previousResults: {},
      variables: {},
    }

    it('should execute add_order_tag action', async () => {
      const action: FlowAction = {
        id: 'action-1',
        type: 'add_order_tag',
        input: { order_id: 1001, tag: 'vip' },
      }

      const result = await executor.execute(action, mockContext)

      expect(result.status).toBe('success')
      expect(result.output).toMatchObject({
        success: true,
        tag: 'vip',
        orderId: 1001,
      })
    })

    it('should execute add_customer_tag action', async () => {
      const action: FlowAction = {
        id: 'action-1',
        type: 'add_customer_tag',
        input: { customer_id: 123, tag: 'new-customer' },
      }

      const result = await executor.execute(action, mockContext)

      expect(result.status).toBe('success')
      expect(result.output).toMatchObject({
        success: true,
        tag: 'new-customer',
        customerId: 123,
      })
    })

    it('should execute send_slack_message action', async () => {
      const action: FlowAction = {
        id: 'action-1',
        type: 'send_slack_message',
        input: { channel: '#orders', message: 'New order received!' },
      }

      const result = await executor.execute(action, mockContext)

      expect(result.status).toBe('success')
      expect(result.output).toMatchObject({
        success: true,
        channel: '#orders',
        message: 'New order received!',
      })
    })

    it('should execute send_webhook action', async () => {
      const action: FlowAction = {
        id: 'action-1',
        type: 'send_webhook',
        input: {
          url: 'https://api.example.com/webhook',
          payload: { event: 'order_created', order_id: 1001 },
        },
      }

      const result = await executor.execute(action, mockContext)

      expect(result.status).toBe('success')
      expect(result.output).toMatchObject({
        success: true,
        url: 'https://api.example.com/webhook',
      })
    })

    it('should execute set_variable action', async () => {
      const action: FlowAction = {
        id: 'action-1',
        type: 'set_variable',
        input: { name: 'discount', value: 10 },
      }

      const result = await executor.execute(action, mockContext)

      expect(result.status).toBe('success')
      expect(result.output).toMatchObject({ discount: 10 })
    })

    it('should execute wait action', async () => {
      const action: FlowAction = {
        id: 'action-1',
        type: 'wait',
        input: { duration: 100 },
      }

      const start = Date.now()
      const result = await executor.execute(action, mockContext)
      const duration = Date.now() - start

      expect(result.status).toBe('success')
      expect(duration).toBeGreaterThanOrEqual(90)
    })

    it('should execute inventory actions', async () => {
      const adjustAction: FlowAction = {
        id: 'action-1',
        type: 'adjust_inventory',
        input: { inventory_item_id: 456, location_id: 789, adjustment: -5 },
      }

      const result = await executor.execute(adjustAction, mockContext)

      expect(result.status).toBe('success')
      expect(result.output).toMatchObject({
        success: true,
        inventoryItemId: 456,
        adjustment: -5,
      })
    })
  })

  describe('action conditions', () => {
    const mockContext: ActionContext = {
      workflowId: 'wf-1',
      executionId: 'exec-1',
      triggerData: { order: { id: 1001, total_price: 50 } },
      previousResults: {},
      variables: {},
    }

    it('should skip action when conditions not met', async () => {
      const action: FlowAction = {
        id: 'action-1',
        type: 'add_order_tag',
        input: { order_id: 1001, tag: 'high-value' },
        conditions: [
          {
            id: 'cond-1',
            property: 'order.total_price',
            operator: 'greater_than',
            value: 100,
          },
        ],
      }

      const result = await executor.execute(action, mockContext)

      expect(result.status).toBe('skipped')
      expect(result.output?.reason).toBe('Conditions not met')
    })

    it('should execute action when conditions are met', async () => {
      const context: ActionContext = {
        ...mockContext,
        triggerData: { order: { id: 1001, total_price: 150 } },
      }

      const action: FlowAction = {
        id: 'action-1',
        type: 'add_order_tag',
        input: { order_id: 1001, tag: 'high-value' },
        conditions: [
          {
            id: 'cond-1',
            property: 'order.total_price',
            operator: 'greater_than',
            value: 100,
          },
        ],
      }

      const result = await executor.execute(action, context)

      expect(result.status).toBe('success')
    })
  })

  describe('template variable resolution', () => {
    it('should resolve template variables in input', async () => {
      const context: ActionContext = {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        triggerData: { order: { id: 1001, name: '#1001' } },
        previousResults: {},
        variables: {},
      }

      const action: FlowAction = {
        id: 'action-1',
        type: 'add_order_note',
        input: {
          order_id: '{{trigger.order.id}}',
          note: 'Processing order {{trigger.order.name}}',
        },
      }

      const result = await executor.execute(action, context)

      expect(result.status).toBe('success')
      expect(result.output).toMatchObject({
        orderId: 1001,
        note: 'Processing order #1001',
      })
    })
  })

  describe('custom action handlers', () => {
    it('should allow registering custom handlers', async () => {
      const customHandler = vi.fn().mockResolvedValue({ custom: true, processed: true })

      executor.registerHandler('custom', customHandler)

      const action: FlowAction = {
        id: 'action-1',
        type: 'custom',
        input: { data: 'test' },
      }

      const context: ActionContext = {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        triggerData: {},
        previousResults: {},
        variables: {},
      }

      const result = await executor.execute(action, context)

      expect(result.status).toBe('success')
      expect(customHandler).toHaveBeenCalledWith({ data: 'test' }, context)
    })

    it('should fail gracefully for unknown action types', async () => {
      const action: FlowAction = {
        id: 'action-1',
        type: 'unknown_action_type',
        input: {},
      }

      const context: ActionContext = {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        triggerData: {},
        previousResults: {},
        variables: {},
      }

      const result = await executor.execute(action, context)

      expect(result.status).toBe('failed')
      expect(result.error).toContain('No handler registered')
    })
  })
})

// =============================================================================
// Flow Engine Tests
// =============================================================================

describe('Flow Engine', () => {
  let engine: FlowEngine

  beforeEach(() => {
    engine = new FlowEngine()
  })

  describe('workflow creation', () => {
    it('should create a workflow with required fields', () => {
      const workflow = engine.createWorkflow({
        title: 'Test Workflow',
        trigger: { type: 'order_created', title: 'When order created' },
        actions: [
          { type: 'add_order_tag', input: { tag: 'new' } },
        ],
      })

      expect(workflow.id).toBeDefined()
      expect(workflow.title).toBe('Test Workflow')
      expect(workflow.enabled).toBe(true)
      expect(workflow.trigger.type).toBe('order_created')
      expect(workflow.actions).toHaveLength(1)
      expect(workflow.version).toBe(1)
    })

    it('should create workflow with conditions', () => {
      const workflow = engine.createWorkflow({
        title: 'Conditional Workflow',
        trigger: { type: 'order_paid', title: 'When order paid' },
        conditions: [
          { property: 'order.total_price', operator: 'greater_than', value: 100 },
        ],
        actions: [
          { type: 'add_order_tag', input: { tag: 'high-value' } },
        ],
      })

      expect(workflow.conditions).toHaveLength(1)
      expect(workflow.conditions![0].operator).toBe('greater_than')
    })

    it('should generate unique IDs for workflow and components', () => {
      const workflow1 = engine.createWorkflow({
        title: 'Workflow 1',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [{ type: 'add_order_tag', input: { tag: 'test' } }],
      })

      const workflow2 = engine.createWorkflow({
        title: 'Workflow 2',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [{ type: 'add_order_tag', input: { tag: 'test' } }],
      })

      expect(workflow1.id).not.toBe(workflow2.id)
      expect(workflow1.trigger.id).not.toBe(workflow2.trigger.id)
      expect(workflow1.actions[0].id).not.toBe(workflow2.actions[0].id)
    })
  })

  describe('workflow registration', () => {
    it('should register and retrieve workflows', () => {
      const workflow = engine.createWorkflow({
        title: 'Test Workflow',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [{ type: 'add_order_tag', input: { tag: 'test' } }],
      })

      engine.registerWorkflow(workflow)

      const retrieved = engine.getWorkflow(workflow.id)
      expect(retrieved).toBeDefined()
      expect(retrieved?.title).toBe('Test Workflow')
    })

    it('should list workflows with filters', () => {
      const workflow1 = engine.createWorkflow({
        title: 'Order Workflow',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [{ type: 'add_order_tag', input: { tag: 'test' } }],
      })

      const workflow2 = engine.createWorkflow({
        title: 'Customer Workflow',
        trigger: { type: 'customer_created', title: 'Trigger' },
        actions: [{ type: 'add_customer_tag', input: { tag: 'new' } }],
      })

      engine.registerWorkflow(workflow1)
      engine.registerWorkflow(workflow2)

      const allWorkflows = engine.listWorkflows()
      expect(allWorkflows).toHaveLength(2)

      const orderWorkflows = engine.listWorkflows({ triggerType: 'order_created' })
      expect(orderWorkflows).toHaveLength(1)
      expect(orderWorkflows[0].title).toBe('Order Workflow')
    })

    it('should unregister workflows', () => {
      const workflow = engine.createWorkflow({
        title: 'Test Workflow',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [{ type: 'add_order_tag', input: { tag: 'test' } }],
      })

      engine.registerWorkflow(workflow)
      expect(engine.getWorkflow(workflow.id)).toBeDefined()

      const result = engine.unregisterWorkflow(workflow.id)
      expect(result).toBe(true)
      expect(engine.getWorkflow(workflow.id)).toBeUndefined()
    })
  })

  describe('workflow updates', () => {
    it('should update workflow properties', () => {
      const workflow = engine.createWorkflow({
        title: 'Original Title',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [{ type: 'add_order_tag', input: { tag: 'test' } }],
      })

      engine.registerWorkflow(workflow)

      const updated = engine.updateWorkflow(workflow.id, {
        title: 'Updated Title',
        enabled: false,
      })

      expect(updated?.title).toBe('Updated Title')
      expect(updated?.enabled).toBe(false)
      expect(updated?.version).toBe(2)
    })
  })

  describe('workflow execution', () => {
    it('should execute a simple workflow', async () => {
      const workflow = engine.createWorkflow({
        title: 'Tag Order',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [
          { type: 'add_order_tag', input: { order_id: '{{order.id}}', tag: 'processed' } },
        ],
      })

      engine.registerWorkflow(workflow)

      const execution = await engine.execute(workflow.id, {
        order: { id: 1001, total_price: '99.99' },
      })

      expect(execution.status).toBe('completed')
      expect(execution.stepResults).toHaveLength(1)
      expect(execution.stepResults[0].status).toBe('success')
    })

    it('should skip workflow when conditions not met', async () => {
      const workflow = engine.createWorkflow({
        title: 'Conditional Workflow',
        trigger: { type: 'order_paid', title: 'Trigger' },
        conditions: [
          { property: 'order.total_price', operator: 'greater_than', value: 100 },
        ],
        actions: [
          { type: 'add_order_tag', input: { tag: 'high-value' } },
        ],
      })

      engine.registerWorkflow(workflow)

      const execution = await engine.execute(workflow.id, {
        order: { id: 1001, total_price: 50 },
      })

      expect(execution.status).toBe('completed')
      expect(execution.stepResults[0].status).toBe('skipped')
    })

    it('should execute multiple actions in sequence', async () => {
      const workflow = engine.createWorkflow({
        title: 'Multi-Action Workflow',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [
          { type: 'add_order_tag', input: { order_id: '{{order.id}}', tag: 'step1' } },
          { type: 'add_order_tag', input: { order_id: '{{order.id}}', tag: 'step2' } },
          { type: 'add_order_note', input: { order_id: '{{order.id}}', note: 'Processed by Flow' } },
        ],
      })

      engine.registerWorkflow(workflow)

      const execution = await engine.execute(workflow.id, {
        order: { id: 1001 },
      })

      expect(execution.status).toBe('completed')
      expect(execution.stepResults).toHaveLength(3)
      expect(execution.stepResults.every((r) => r.status === 'success')).toBe(true)
    })

    it('should handle action errors based on onError config', async () => {
      // Register a handler that fails
      engine.registerActionHandler('fail_action', async () => {
        throw new Error('Simulated failure')
      })

      // Test 'stop' behavior (default)
      const stopWorkflow = engine.createWorkflow({
        title: 'Stop on Error',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [
          { type: 'fail_action', input: {} },
          { type: 'add_order_tag', input: { tag: 'should-not-run' } },
        ],
      })

      engine.registerWorkflow(stopWorkflow)

      const stopExecution = await engine.execute(stopWorkflow.id, { order: { id: 1 } })

      expect(stopExecution.status).toBe('failed')
      expect(stopExecution.stepResults).toHaveLength(1)
      expect(stopExecution.error?.message).toContain('Simulated failure')

      // Test 'continue' behavior
      const continueWorkflow = engine.createWorkflow({
        title: 'Continue on Error',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [
          { type: 'fail_action', input: {}, onError: 'continue' },
          { type: 'add_order_tag', input: { tag: 'should-run' } },
        ],
      })

      engine.registerWorkflow(continueWorkflow)

      const continueExecution = await engine.execute(continueWorkflow.id, { order: { id: 1 } })

      expect(continueExecution.status).toBe('completed')
      expect(continueExecution.stepResults).toHaveLength(2)
      expect(continueExecution.stepResults[0].status).toBe('failed')
      expect(continueExecution.stepResults[1].status).toBe('success')
    })

    it('should track execution duration', async () => {
      const workflow = engine.createWorkflow({
        title: 'Timed Workflow',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [
          { type: 'wait', input: { duration: 50 } },
        ],
      })

      engine.registerWorkflow(workflow)

      const execution = await engine.execute(workflow.id, { order: { id: 1 } })

      expect(execution.durationMs).toBeGreaterThanOrEqual(40)
      expect(execution.startedAt).toBeDefined()
      expect(execution.completedAt).toBeDefined()
    })
  })

  describe('trigger handling', () => {
    it('should execute registered workflows on trigger', async () => {
      const workflow = engine.createWorkflow({
        title: 'Auto-Tag Orders',
        trigger: { type: 'order_created', title: 'When order created' },
        actions: [
          { type: 'add_order_tag', input: { tag: 'auto-tagged' } },
        ],
      })

      engine.registerWorkflow(workflow)

      const executions = await engine.onTrigger('order_created', {
        order: { id: 1001 },
      })

      expect(executions).toHaveLength(1)
      expect(executions[0].status).toBe('completed')
    })

    it('should execute multiple workflows for same trigger', async () => {
      const workflow1 = engine.createWorkflow({
        title: 'Workflow 1',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [{ type: 'add_order_tag', input: { tag: 'tag1' } }],
      })

      const workflow2 = engine.createWorkflow({
        title: 'Workflow 2',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [{ type: 'add_order_tag', input: { tag: 'tag2' } }],
      })

      engine.registerWorkflow(workflow1)
      engine.registerWorkflow(workflow2)

      const executions = await engine.onTrigger('order_created', {
        order: { id: 1001 },
      })

      expect(executions).toHaveLength(2)
    })

    it('should skip disabled workflows', async () => {
      const workflow = engine.createWorkflow({
        title: 'Disabled Workflow',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [{ type: 'add_order_tag', input: { tag: 'test' } }],
      })

      engine.registerWorkflow(workflow)
      engine.updateWorkflow(workflow.id, { enabled: false })

      const executions = await engine.onTrigger('order_created', {
        order: { id: 1001 },
      })

      expect(executions).toHaveLength(0)
    })

    it('should return empty array for unregistered triggers', async () => {
      const executions = await engine.onTrigger('unknown_trigger', {})
      expect(executions).toHaveLength(0)
    })
  })

  describe('execution history', () => {
    it('should store and retrieve executions', async () => {
      const workflow = engine.createWorkflow({
        title: 'Test Workflow',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [{ type: 'add_order_tag', input: { tag: 'test' } }],
      })

      engine.registerWorkflow(workflow)

      const execution = await engine.execute(workflow.id, { order: { id: 1 } })

      const retrieved = engine.getExecution(execution.id)
      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(execution.id)
    })

    it('should list executions for a workflow', async () => {
      const workflow = engine.createWorkflow({
        title: 'Test Workflow',
        trigger: { type: 'order_created', title: 'Trigger' },
        actions: [{ type: 'add_order_tag', input: { tag: 'test' } }],
      })

      engine.registerWorkflow(workflow)

      await engine.execute(workflow.id, { order: { id: 1 } })
      await engine.execute(workflow.id, { order: { id: 2 } })

      const executions = engine.listExecutions(workflow.id)
      expect(executions).toHaveLength(2)
    })
  })
})

// =============================================================================
// Workflow Templates Tests
// =============================================================================

describe('Flow Templates', () => {
  let engine: FlowEngine

  beforeEach(() => {
    engine = new FlowEngine()
  })

  describe('TAG_HIGH_VALUE_CUSTOMERS template', () => {
    it('should create workflow from template', () => {
      const workflow = engine.createFromTemplate(FlowTemplates.TAG_HIGH_VALUE_CUSTOMERS, {
        threshold: 500,
      })

      expect(workflow.title).toBe('Tag High-Value Customers')
      expect(workflow.trigger.type).toBe('order_paid')
      expect(workflow.conditions).toHaveLength(1)
      expect(workflow.actions).toHaveLength(1)
    })

    it('should resolve template variables', () => {
      const workflow = engine.createFromTemplate(FlowTemplates.TAG_HIGH_VALUE_CUSTOMERS, {
        threshold: 2000,
      })

      expect(workflow.conditions![0].value).toBe(2000)
    })

    it('should execute template workflow correctly', async () => {
      const workflow = engine.createFromTemplate(FlowTemplates.TAG_HIGH_VALUE_CUSTOMERS, {
        threshold: 1000,
      })

      engine.registerWorkflow(workflow)

      // Customer exceeds threshold
      const execution1 = await engine.execute(workflow.id, {
        customer: { id: 123, total_spent: '1500.00' },
      })

      expect(execution1.status).toBe('completed')
      expect(execution1.stepResults[0].status).toBe('success')

      // Customer below threshold
      const execution2 = await engine.execute(workflow.id, {
        customer: { id: 456, total_spent: '500.00' },
      })

      expect(execution2.status).toBe('completed')
      expect(execution2.stepResults[0].status).toBe('skipped')
    })
  })

  describe('LOW_STOCK_ALERT template', () => {
    it('should create workflow from template', () => {
      const workflow = engine.createFromTemplate(FlowTemplates.LOW_STOCK_ALERT, {
        threshold: 5,
        channel: '#inventory-alerts',
      })

      expect(workflow.title).toBe('Low Stock Alert')
      expect(workflow.trigger.type).toBe('inventory_level_updated')
      expect(workflow.conditions![0].value).toBe(5)
    })
  })

  describe('FLAG_HIGH_RISK_ORDERS template', () => {
    it('should create workflow from template', () => {
      const workflow = engine.createFromTemplate(FlowTemplates.FLAG_HIGH_RISK_ORDERS, {
        amount_threshold: 1000,
      })

      expect(workflow.title).toBe('Flag High-Risk Orders')
      expect(workflow.actions).toHaveLength(2)
      expect(workflow.actions[0].type).toBe('add_order_tag')
      expect(workflow.actions[1].type).toBe('add_order_note')
    })
  })

  describe('WEBHOOK_INTEGRATION template', () => {
    it('should create workflow with retry configuration', () => {
      const workflow = engine.createFromTemplate(FlowTemplates.WEBHOOK_INTEGRATION, {
        webhook_url: 'https://api.example.com/webhook',
      })

      expect(workflow.actions[0].onError).toBe('retry')
      expect(workflow.actions[0].maxRetries).toBe(3)
      expect(workflow.actions[0].retryDelay).toBe(5000)
    })
  })

  describe('template categories and tags', () => {
    it('should have proper categories', () => {
      expect(FlowTemplates.TAG_HIGH_VALUE_CUSTOMERS.category).toBe('customers')
      expect(FlowTemplates.LOW_STOCK_ALERT.category).toBe('inventory')
      expect(FlowTemplates.FLAG_HIGH_RISK_ORDERS.category).toBe('orders')
      expect(FlowTemplates.FULFILLMENT_NOTIFICATION.category).toBe('fulfillment')
      expect(FlowTemplates.WEBHOOK_INTEGRATION.category).toBe('integrations')
    })

    it('should have tags for filtering', () => {
      expect(FlowTemplates.TAG_HIGH_VALUE_CUSTOMERS.tags).toContain('customers')
      expect(FlowTemplates.TAG_HIGH_VALUE_CUSTOMERS.tags).toContain('loyalty')
      expect(FlowTemplates.LOW_STOCK_ALERT.tags).toContain('notifications')
      expect(FlowTemplates.WEBHOOK_INTEGRATION.tags).toContain('webhooks')
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Flow Integration', () => {
  let engine: FlowEngine

  beforeEach(() => {
    engine = new FlowEngine()
  })

  it('should handle complete order processing flow', async () => {
    // Create a multi-step order processing workflow
    const workflow = engine.createWorkflow({
      title: 'Order Processing',
      description: 'Process new orders with tagging and notifications',
      trigger: { type: 'order_created', title: 'When order created' },
      conditions: [
        { property: 'order.test', operator: 'equals', value: false },
      ],
      actions: [
        {
          type: 'add_order_tag',
          input: { order_id: '{{order.id}}', tag: 'processing' },
        },
        {
          type: 'send_slack_message',
          input: {
            channel: '#orders',
            message: 'New order {{order.name}} from {{customer.email}}',
          },
        },
        {
          type: 'add_order_tag',
          input: { order_id: '{{order.id}}', tag: 'high-value' },
          conditions: [
            { id: 'value-check', property: 'order.total_price', operator: 'greater_than', value: 100 },
          ],
        },
      ],
      tags: ['orders', 'automation'],
    })

    engine.registerWorkflow(workflow)

    // Test with high-value order
    const execution = await engine.execute(workflow.id, {
      order: { id: 1001, name: '#1001', total_price: 150, test: false },
      customer: { email: 'customer@example.com' },
    })

    expect(execution.status).toBe('completed')
    expect(execution.stepResults).toHaveLength(3)
    expect(execution.stepResults[0].status).toBe('success')
    expect(execution.stepResults[1].status).toBe('success')
    expect(execution.stepResults[2].status).toBe('success')

    // Test with low-value order (third action should be skipped)
    const execution2 = await engine.execute(workflow.id, {
      order: { id: 1002, name: '#1002', total_price: 50, test: false },
      customer: { email: 'customer2@example.com' },
    })

    expect(execution2.status).toBe('completed')
    expect(execution2.stepResults[2].status).toBe('skipped')
  })

  it('should handle customer lifecycle workflows', async () => {
    // New customer workflow
    const newCustomerWorkflow = engine.createWorkflow({
      title: 'New Customer Welcome',
      trigger: { type: 'customer_created', title: 'When customer created' },
      actions: [
        { type: 'add_customer_tag', input: { customer_id: '{{customer.id}}', tag: 'new' } },
        { type: 'send_customer_email', input: { customer_id: '{{customer.id}}', template: 'welcome' } },
      ],
    })

    // VIP upgrade workflow
    const vipWorkflow = engine.createWorkflow({
      title: 'VIP Upgrade',
      trigger: { type: 'order_paid', title: 'When order paid' },
      conditions: [
        { property: 'customer.total_spent', operator: 'greater_than', value: 1000 },
        { property: 'customer.tags', operator: 'not_contains', value: 'vip' },
      ],
      actions: [
        { type: 'add_customer_tag', input: { customer_id: '{{customer.id}}', tag: 'vip' } },
        { type: 'remove_customer_tag', input: { customer_id: '{{customer.id}}', tag: 'new' } },
        { type: 'send_customer_email', input: { customer_id: '{{customer.id}}', template: 'vip-welcome' } },
      ],
    })

    engine.registerWorkflow(newCustomerWorkflow)
    engine.registerWorkflow(vipWorkflow)

    // New customer trigger
    const newCustomerExecutions = await engine.onTrigger('customer_created', {
      customer: { id: 123, email: 'new@example.com', total_spent: '0.00' },
    })

    expect(newCustomerExecutions).toHaveLength(1)
    expect(newCustomerExecutions[0].status).toBe('completed')

    // Order paid trigger (VIP upgrade)
    const orderPaidExecutions = await engine.onTrigger('order_paid', {
      order: { id: 1001, total_price: '500.00' },
      customer: { id: 123, email: 'new@example.com', total_spent: '1500.00', tags: ['new'] },
    })

    expect(orderPaidExecutions).toHaveLength(1)
    expect(orderPaidExecutions[0].status).toBe('completed')
  })

  it('should handle inventory management workflows', async () => {
    const lowStockWorkflow = engine.createFromTemplate(FlowTemplates.LOW_STOCK_ALERT, {
      threshold: 10,
      channel: '#inventory',
    })

    engine.registerWorkflow(lowStockWorkflow)

    // Low stock trigger
    const lowStockExecutions = await engine.onTrigger('inventory_level_updated', {
      inventory_level: { available: 5 },
      product: { title: 'Widget Pro' },
    })

    expect(lowStockExecutions).toHaveLength(1)
    expect(lowStockExecutions[0].status).toBe('completed')

    // Normal stock (should skip due to conditions)
    const normalStockExecutions = await engine.onTrigger('inventory_level_updated', {
      inventory_level: { available: 50 },
      product: { title: 'Widget Pro' },
    })

    expect(normalStockExecutions).toHaveLength(1)
    expect(normalStockExecutions[0].stepResults[0].status).toBe('skipped')
  })
})
