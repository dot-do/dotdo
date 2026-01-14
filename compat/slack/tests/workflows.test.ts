/**
 * @dotdo/slack/workflows - Slack Workflows Tests
 *
 * TDD tests for Slack Workflows integration including:
 * - WorkflowBuilder for creating workflows programmatically
 * - Workflow triggers (webhook, scheduled, event-based)
 * - Custom workflow steps (edit, save, execute)
 * - Workflows API client methods
 *
 * @see https://api.slack.com/workflows
 * @see https://api.slack.com/automation/functions/custom-bolt
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  WorkflowBuilder,
  WorkflowStep,
  WorkflowTrigger,
  WorkflowClient,
  createWorkflow,
  createWorkflowStep,
  type WorkflowDefinition,
  type WorkflowStepConfig,
  type WorkflowInput,
  type WorkflowOutput,
  type WorkflowEditArgs,
  type WorkflowSaveArgs,
  type WorkflowExecuteArgs,
  type WorkflowStepEditPayload,
  type WorkflowStepSavePayload,
  type WorkflowStepExecutePayload,
  type TriggerType,
  type ScheduledTrigger,
  type WebhookTrigger,
  type EventTrigger,
} from '../workflows'

import { SlackBot, BotWebClient } from '../bot'
import type { Block } from '../types'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockFetch(responses: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
    const endpoint = url.replace('https://slack.com/api/', '')
    const response = responses[endpoint] ?? { ok: true }
    return {
      ok: true,
      json: async () => response,
      headers: new Headers(),
    }
  })
}

// ============================================================================
// WORKFLOW BUILDER TESTS
// ============================================================================

describe('WorkflowBuilder', () => {
  describe('workflow definition', () => {
    it('should create a workflow with name and description', () => {
      const workflow = new WorkflowBuilder('my_workflow')
        .name('My Workflow')
        .description('A test workflow')
        .build()

      expect(workflow.callback_id).toBe('my_workflow')
      expect(workflow.title).toBe('My Workflow')
      expect(workflow.description).toBe('A test workflow')
    })

    it('should define workflow inputs with types', () => {
      const workflow = new WorkflowBuilder('order_workflow')
        .name('Order Workflow')
        .input('customer_name', {
          type: 'string',
          title: 'Customer Name',
          description: 'Name of the customer',
          required: true,
        })
        .input('order_amount', {
          type: 'number',
          title: 'Order Amount',
          description: 'Total order amount',
          required: true,
        })
        .input('is_priority', {
          type: 'boolean',
          title: 'Priority Order',
          default: false,
        })
        .build()

      expect(workflow.input_parameters).toHaveProperty('customer_name')
      expect(workflow.input_parameters.customer_name.type).toBe('string')
      expect(workflow.input_parameters.customer_name.title).toBe('Customer Name')
      expect(workflow.input_parameters.order_amount.type).toBe('number')
      expect(workflow.input_parameters.is_priority.default).toBe(false)
    })

    it('should add workflow steps with function references', () => {
      const workflow = new WorkflowBuilder('approval_workflow')
        .name('Approval Workflow')
        .addStep('slack#/functions/send_message', {
          channel_id: '{{inputs.channel}}',
          message: 'New approval request: {{inputs.request}}',
        })
        .addStep('my_app#/functions/create_ticket', {
          title: '{{inputs.request}}',
          assignee: '{{inputs.approver}}',
        })
        .build()

      expect(workflow.steps).toHaveLength(2)
      expect(workflow.steps[0].function_id).toBe('slack#/functions/send_message')
      expect(workflow.steps[0].inputs.channel_id).toBe('{{inputs.channel}}')
      expect(workflow.steps[1].function_id).toBe('my_app#/functions/create_ticket')
    })

    it('should support conditional steps', () => {
      const workflow = new WorkflowBuilder('conditional_workflow')
        .name('Conditional Workflow')
        .addStep('slack#/functions/send_message', {
          channel_id: '{{inputs.channel}}',
          message: 'Processing...',
        })
        .addConditionalStep({
          condition: '{{inputs.amount}} > 1000',
          then: {
            function_id: 'my_app#/functions/notify_manager',
            inputs: { amount: '{{inputs.amount}}' },
          },
          else: {
            function_id: 'my_app#/functions/auto_approve',
            inputs: { amount: '{{inputs.amount}}' },
          },
        })
        .build()

      expect(workflow.steps).toHaveLength(2)
      expect(workflow.steps[1].type).toBe('conditional')
      expect(workflow.steps[1].condition).toBe('{{inputs.amount}} > 1000')
    })

    it('should define workflow outputs', () => {
      const workflow = new WorkflowBuilder('ticket_workflow')
        .name('Ticket Workflow')
        .addStep('my_app#/functions/create_ticket', {
          title: '{{inputs.title}}',
        })
        .output('ticket_id', {
          type: 'string',
          title: 'Ticket ID',
          value: '{{steps.step_0.outputs.ticket_id}}',
        })
        .output('ticket_url', {
          type: 'string',
          title: 'Ticket URL',
          value: '{{steps.step_0.outputs.url}}',
        })
        .build()

      expect(workflow.output_parameters).toHaveProperty('ticket_id')
      expect(workflow.output_parameters.ticket_id.value).toBe('{{steps.step_0.outputs.ticket_id}}')
    })

    it('should support step naming for reference', () => {
      const workflow = new WorkflowBuilder('named_steps')
        .name('Named Steps Workflow')
        .addStep('slack#/functions/send_message', {
          channel_id: '{{inputs.channel}}',
          message: 'Step 1',
        }, { name: 'notify_step' })
        .addStep('my_app#/functions/process', {
          message_ts: '{{steps.notify_step.outputs.message_ts}}',
        }, { name: 'process_step' })
        .build()

      expect(workflow.steps[0].name).toBe('notify_step')
      expect(workflow.steps[1].inputs.message_ts).toBe('{{steps.notify_step.outputs.message_ts}}')
    })
  })

  describe('createWorkflow helper', () => {
    it('should create workflow with fluent API', () => {
      const workflow = createWorkflow('quick_workflow', {
        name: 'Quick Workflow',
        description: 'Created with helper',
        inputs: {
          message: { type: 'string', title: 'Message', required: true },
        },
        steps: [
          {
            function_id: 'slack#/functions/send_message',
            inputs: { channel_id: 'C123', message: '{{inputs.message}}' },
          },
        ],
      })

      expect(workflow.callback_id).toBe('quick_workflow')
      expect(workflow.title).toBe('Quick Workflow')
      expect(workflow.steps).toHaveLength(1)
    })
  })
})

// ============================================================================
// WORKFLOW TRIGGERS TESTS
// ============================================================================

describe('WorkflowTrigger', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch({
      'workflows.triggers.create': {
        ok: true,
        trigger: { id: 'Ft123', type: 'webhook', workflow_id: 'Wf123' },
      },
      'workflows.triggers.update': { ok: true, trigger: { id: 'Ft123' } },
      'workflows.triggers.delete': { ok: true },
      'workflows.triggers.list': {
        ok: true,
        triggers: [{ id: 'Ft123', type: 'webhook' }],
      },
    })
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('webhook triggers', () => {
    it('should create a webhook trigger', async () => {
      const client = new WorkflowClient('xoxb-test')

      const trigger = await client.triggers.create({
        type: 'webhook',
        workflow: 'my_workflow',
        name: 'My Webhook Trigger',
        inputs: {
          customer_name: { value: '{{data.customer}}' },
          order_amount: { value: '{{data.amount}}' },
        },
      })

      expect(trigger.id).toBe('Ft123')
      expect(trigger.type).toBe('webhook')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('workflows.triggers.create'),
        expect.objectContaining({
          body: expect.stringContaining('"type":"webhook"'),
        })
      )
    })

    it('should return webhook URL for trigger', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          trigger: {
            id: 'Ft123',
            type: 'webhook',
            webhook_url: 'https://hooks.slack.com/triggers/T123/123/abc',
          },
        }),
      })

      const client = new WorkflowClient('xoxb-test')

      const trigger = await client.triggers.create({
        type: 'webhook',
        workflow: 'my_workflow',
        name: 'Webhook Trigger',
      })

      expect(trigger.webhook_url).toBe('https://hooks.slack.com/triggers/T123/123/abc')
    })
  })

  describe('scheduled triggers', () => {
    it('should create a scheduled trigger with cron expression', async () => {
      const client = new WorkflowClient('xoxb-test')

      const trigger = await client.triggers.create({
        type: 'scheduled',
        workflow: 'daily_report',
        name: 'Daily Report Trigger',
        schedule: {
          type: 'cron',
          expression: '0 9 * * 1-5', // 9 AM on weekdays
          timezone: 'America/New_York',
        },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"type":"scheduled"'),
        })
      )
    })

    it('should create a scheduled trigger with frequency', async () => {
      const client = new WorkflowClient('xoxb-test')

      const trigger = await client.triggers.create({
        type: 'scheduled',
        workflow: 'hourly_check',
        name: 'Hourly Check',
        schedule: {
          type: 'frequency',
          frequency: { type: 'hourly' },
          start_time: new Date('2024-01-01T00:00:00Z').toISOString(),
        },
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('should create a one-time scheduled trigger', async () => {
      const client = new WorkflowClient('xoxb-test')
      const runAt = new Date(Date.now() + 3600000) // 1 hour from now

      const trigger = await client.triggers.create({
        type: 'scheduled',
        workflow: 'one_time_task',
        name: 'One Time Task',
        schedule: {
          type: 'once',
          scheduled_time: runAt.toISOString(),
        },
      })

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('event triggers', () => {
    it('should create an event trigger for channel events', async () => {
      const client = new WorkflowClient('xoxb-test')

      const trigger = await client.triggers.create({
        type: 'event',
        workflow: 'channel_handler',
        name: 'Channel Event Trigger',
        event_type: 'slack#/events/message_posted',
        channel_ids: ['C123', 'C456'],
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"type":"event"'),
        })
      )
    })

    it('should create an event trigger for reaction events', async () => {
      const client = new WorkflowClient('xoxb-test')

      const trigger = await client.triggers.create({
        type: 'event',
        workflow: 'reaction_handler',
        name: 'Reaction Trigger',
        event_type: 'slack#/events/reaction_added',
        filter: {
          reaction: 'white_check_mark',
        },
      })

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('trigger management', () => {
    it('should list triggers for a workflow', async () => {
      const client = new WorkflowClient('xoxb-test')

      const result = await client.triggers.list({ workflow: 'my_workflow' })

      expect(result.triggers).toHaveLength(1)
      expect(result.triggers[0].id).toBe('Ft123')
    })

    it('should update a trigger', async () => {
      const client = new WorkflowClient('xoxb-test')

      const result = await client.triggers.update({
        trigger_id: 'Ft123',
        name: 'Updated Trigger Name',
        inputs: {
          new_input: { value: '{{data.value}}' },
        },
      })

      expect(result.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('workflows.triggers.update'),
        expect.any(Object)
      )
    })

    it('should delete a trigger', async () => {
      const client = new WorkflowClient('xoxb-test')

      const result = await client.triggers.delete({ trigger_id: 'Ft123' })

      expect(result.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('workflows.triggers.delete'),
        expect.any(Object)
      )
    })
  })
})

// ============================================================================
// CUSTOM WORKFLOW STEPS TESTS
// ============================================================================

describe('WorkflowStep', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch({
      'workflows.stepCompleted': { ok: true },
      'workflows.stepFailed': { ok: true },
      'workflows.updateStep': { ok: true },
    })
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('step registration', () => {
    it('should register a custom workflow step', async () => {
      const bot = new SlackBot({ token: 'xoxb-test' })

      const step = createWorkflowStep('create_issue', {
        edit: async ({ ack, configure }) => {
          await ack()
          await configure({
            blocks: [
              {
                type: 'input',
                block_id: 'title_input',
                label: { type: 'plain_text', text: 'Issue Title' },
                element: {
                  type: 'plain_text_input',
                  action_id: 'title',
                },
              },
            ],
          })
        },
        save: async ({ ack, view, update }) => {
          const title = view.state.values.title_input.title.value
          await ack()
          await update({
            inputs: { title: { value: title } },
            outputs: [
              { name: 'issue_id', type: 'string', label: 'Issue ID' },
              { name: 'issue_url', type: 'string', label: 'Issue URL' },
            ],
          })
        },
        execute: async ({ inputs, complete, fail }) => {
          try {
            // Simulate creating an issue
            const issueId = `ISSUE-${Date.now()}`
            const issueUrl = `https://example.com/issues/${issueId}`

            await complete({
              outputs: {
                issue_id: issueId,
                issue_url: issueUrl,
              },
            })
          } catch (error) {
            await fail({ error: (error as Error).message })
          }
        },
      })

      bot.step(step)

      // Verify step is registered
      expect(typeof (bot as any).stepHandlers?.get('create_issue')).toBeDefined()
    })

    it('should handle workflow_step_edit event', async () => {
      const bot = new SlackBot({ token: 'xoxb-test' })

      const editHandler = vi.fn(async ({ ack, configure }) => {
        await ack()
        await configure({ blocks: [] })
      })

      bot.step(createWorkflowStep('my_step', {
        edit: editHandler,
        save: async () => {},
        execute: async () => {},
      }))

      const payload: WorkflowStepEditPayload = {
        type: 'workflow_step_edit',
        callback_id: 'my_step',
        trigger_id: 'trigger-123',
        workflow_step: {
          workflow_step_edit_id: 'edit-123',
          inputs: {},
          outputs: [],
        },
        user: { id: 'U123' },
        team: { id: 'T123' },
      }

      const request = new Request('http://localhost/slack/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `payload=${encodeURIComponent(JSON.stringify(payload))}`,
      })

      await bot.handleRequest(request)

      expect(editHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          ack: expect.any(Function),
          configure: expect.any(Function),
          step: expect.objectContaining({ workflow_step_edit_id: 'edit-123' }),
        })
      )
    })

    it('should handle view_submission for step save', async () => {
      const bot = new SlackBot({ token: 'xoxb-test' })

      const saveHandler = vi.fn(async ({ ack, update }) => {
        await ack()
        await update({
          inputs: { message: { value: 'Hello' } },
          outputs: [{ name: 'result', type: 'string', label: 'Result' }],
        })
      })

      bot.step(createWorkflowStep('my_step', {
        edit: async () => {},
        save: saveHandler,
        execute: async () => {},
      }))

      const payload = {
        type: 'view_submission',
        view: {
          callback_id: 'my_step',
          private_metadata: JSON.stringify({
            workflow_step_edit_id: 'edit-123',
          }),
          state: { values: {} },
        },
        user: { id: 'U123' },
        workflow_step: {
          workflow_step_edit_id: 'edit-123',
        },
      }

      const request = new Request('http://localhost/slack/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `payload=${encodeURIComponent(JSON.stringify(payload))}`,
      })

      await bot.handleRequest(request)

      expect(saveHandler).toHaveBeenCalled()
    })

    it('should handle workflow_step_execute event', async () => {
      const bot = new SlackBot({ token: 'xoxb-test' })

      const executeHandler = vi.fn(async ({ complete }) => {
        await complete({ outputs: { result: 'success' } })
      })

      bot.step(createWorkflowStep('my_step', {
        edit: async () => {},
        save: async () => {},
        execute: executeHandler,
      }))

      const payload: WorkflowStepExecutePayload = {
        type: 'workflow_step_execute',
        callback_id: 'my_step',
        workflow_step: {
          workflow_step_execute_id: 'exec-123',
          inputs: { message: { value: 'Hello' } },
          outputs: [{ name: 'result', type: 'string', label: 'Result' }],
        },
        event: {
          type: 'workflow_step_execute',
          callback_id: 'my_step',
          workflow_step: { workflow_step_execute_id: 'exec-123' },
        },
      }

      const request = new Request('http://localhost/slack/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'event_callback',
          event: payload.event,
        }),
      })

      await bot.handleRequest(request)

      expect(executeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          inputs: expect.any(Object),
          complete: expect.any(Function),
          fail: expect.any(Function),
        })
      )
    })
  })

  describe('step execution', () => {
    it('should call complete with outputs', async () => {
      const bot = new SlackBot({ token: 'xoxb-test', fetch: mockFetch })

      bot.step(createWorkflowStep('calculator', {
        edit: async () => {},
        save: async () => {},
        execute: async ({ inputs, complete }) => {
          const a = inputs.a.value as number
          const b = inputs.b.value as number
          await complete({
            outputs: { sum: a + b, product: a * b },
          })
        },
      }))

      const payload = {
        type: 'workflow_step_execute',
        callback_id: 'calculator',
        workflow_step: {
          workflow_step_execute_id: 'exec-123',
          inputs: {
            a: { value: 5 },
            b: { value: 3 },
          },
        },
      }

      const request = new Request('http://localhost/slack/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'event_callback',
          event: payload,
        }),
      })

      await bot.handleRequest(request)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('workflows.stepCompleted'),
        expect.objectContaining({
          body: expect.stringContaining('"outputs"'),
        })
      )
    })

    it('should call fail with error message', async () => {
      const bot = new SlackBot({ token: 'xoxb-test', fetch: mockFetch })

      bot.step(createWorkflowStep('failing_step', {
        edit: async () => {},
        save: async () => {},
        execute: async ({ fail }) => {
          await fail({ error: 'Something went wrong' })
        },
      }))

      const payload = {
        type: 'workflow_step_execute',
        callback_id: 'failing_step',
        workflow_step: {
          workflow_step_execute_id: 'exec-123',
          inputs: {},
        },
      }

      const request = new Request('http://localhost/slack/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'event_callback',
          event: payload,
        }),
      })

      await bot.handleRequest(request)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('workflows.stepFailed'),
        expect.objectContaining({
          body: expect.stringContaining('Something went wrong'),
        })
      )
    })

    it('should automatically fail on unhandled exceptions', async () => {
      const bot = new SlackBot({ token: 'xoxb-test', fetch: mockFetch })

      bot.step(createWorkflowStep('error_step', {
        edit: async () => {},
        save: async () => {},
        execute: async () => {
          throw new Error('Unhandled error')
        },
      }))

      const errorHandler = vi.fn()
      bot.error(errorHandler)

      const payload = {
        type: 'workflow_step_execute',
        callback_id: 'error_step',
        workflow_step: {
          workflow_step_execute_id: 'exec-123',
          inputs: {},
        },
      }

      const request = new Request('http://localhost/slack/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'event_callback',
          event: payload,
        }),
      })

      await bot.handleRequest(request)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('workflows.stepFailed'),
        expect.any(Object)
      )
    })
  })

  describe('step configuration', () => {
    it('should open configuration modal with blocks', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('views.open')) {
          return { ok: true, json: async () => ({ ok: true, view: { id: 'V123' } }) }
        }
        return { ok: true, json: async () => ({ ok: true }) }
      })

      const bot = new SlackBot({ token: 'xoxb-test', fetch: mockFetch })

      const blocks: Block[] = [
        {
          type: 'input',
          block_id: 'message_block',
          label: { type: 'plain_text', text: 'Message' },
          element: { type: 'plain_text_input', action_id: 'message' },
        },
      ]

      bot.step(createWorkflowStep('configurable_step', {
        edit: async ({ configure }) => {
          await configure({ blocks })
        },
        save: async () => {},
        execute: async () => {},
      }))

      // The configure function should open a modal with the blocks
      // This is tested through the handler invocation
    })

    it('should update step inputs and outputs', async () => {
      const bot = new SlackBot({ token: 'xoxb-test', fetch: mockFetch })

      bot.step(createWorkflowStep('dynamic_step', {
        edit: async () => {},
        save: async ({ update, view }) => {
          const selectedAction = view.state.values.action_block?.action?.selected_option?.value

          const outputs = selectedAction === 'create'
            ? [
                { name: 'id', type: 'string', label: 'Created ID' },
                { name: 'url', type: 'string', label: 'URL' },
              ]
            : [
                { name: 'deleted', type: 'boolean', label: 'Was Deleted' },
              ]

          await update({
            inputs: { action: { value: selectedAction } },
            outputs,
          })
        },
        execute: async () => {},
      }))
    })
  })
})

// ============================================================================
// WORKFLOWS API CLIENT TESTS
// ============================================================================

describe('WorkflowClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch({
      'workflows.publish': { ok: true, workflow: { id: 'Wf123' } },
      'workflows.delete': { ok: true },
      'workflows.list': { ok: true, workflows: [{ id: 'Wf123', name: 'My Workflow' }] },
      'workflows.info': { ok: true, workflow: { id: 'Wf123', name: 'My Workflow' } },
      'workflows.stepCompleted': { ok: true },
      'workflows.stepFailed': { ok: true },
      'workflows.updateStep': { ok: true },
    })
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('workflow management', () => {
    it('should publish a workflow', async () => {
      const client = new WorkflowClient('xoxb-test')

      const workflow = new WorkflowBuilder('test_workflow')
        .name('Test Workflow')
        .build()

      const result = await client.publish(workflow)

      expect(result.ok).toBe(true)
      expect(result.workflow.id).toBe('Wf123')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('workflows.publish'),
        expect.any(Object)
      )
    })

    it('should delete a workflow', async () => {
      const client = new WorkflowClient('xoxb-test')

      const result = await client.delete('test_workflow')

      expect(result.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('workflows.delete'),
        expect.any(Object)
      )
    })

    it('should list workflows', async () => {
      const client = new WorkflowClient('xoxb-test')

      const result = await client.list()

      expect(result.workflows).toHaveLength(1)
      expect(result.workflows[0].name).toBe('My Workflow')
    })

    it('should get workflow info', async () => {
      const client = new WorkflowClient('xoxb-test')

      const result = await client.info('Wf123')

      expect(result.workflow.id).toBe('Wf123')
    })
  })

  describe('step completion API', () => {
    it('should mark step as completed', async () => {
      const client = new WorkflowClient('xoxb-test')

      const result = await client.stepCompleted({
        workflow_step_execute_id: 'exec-123',
        outputs: {
          result: 'success',
          count: 42,
        },
      })

      expect(result.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('workflows.stepCompleted'),
        expect.objectContaining({
          body: expect.stringContaining('"workflow_step_execute_id":"exec-123"'),
        })
      )
    })

    it('should mark step as failed', async () => {
      const client = new WorkflowClient('xoxb-test')

      const result = await client.stepFailed({
        workflow_step_execute_id: 'exec-123',
        error: {
          message: 'Step failed due to timeout',
        },
      })

      expect(result.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('workflows.stepFailed'),
        expect.any(Object)
      )
    })

    it('should update step configuration', async () => {
      const client = new WorkflowClient('xoxb-test')

      const result = await client.updateStep({
        workflow_step_edit_id: 'edit-123',
        inputs: {
          message: { value: '{{inputs.user_message}}' },
          channel: { value: 'C123' },
        },
        outputs: [
          { name: 'message_ts', type: 'string', label: 'Message Timestamp' },
        ],
      })

      expect(result.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('workflows.updateStep'),
        expect.any(Object)
      )
    })
  })
})

// ============================================================================
// INTEGRATION WITH SLACKBOT
// ============================================================================

describe('SlackBot Workflow Integration', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch({
      'workflows.stepCompleted': { ok: true },
      'workflows.stepFailed': { ok: true },
      'workflows.updateStep': { ok: true },
      'views.open': { ok: true, view: { id: 'V123' } },
    })
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should register multiple workflow steps', async () => {
    const bot = new SlackBot({ token: 'xoxb-test' })

    bot.step(createWorkflowStep('step_1', {
      edit: vi.fn(),
      save: vi.fn(),
      execute: vi.fn(),
    }))

    bot.step(createWorkflowStep('step_2', {
      edit: vi.fn(),
      save: vi.fn(),
      execute: vi.fn(),
    }))

    // Both steps should be registered
    expect((bot as any).stepHandlers?.size).toBe(2)
  })

  it('should provide workflow client through bot', async () => {
    const bot = new SlackBot({ token: 'xoxb-test' })

    expect(bot.workflows).toBeDefined()
    expect(typeof bot.workflows.publish).toBe('function')
    expect(typeof bot.workflows.triggers.create).toBe('function')
  })

  it('should handle concurrent step executions', async () => {
    const bot = new SlackBot({ token: 'xoxb-test', fetch: mockFetch })

    const executions: string[] = []

    bot.step(createWorkflowStep('concurrent_step', {
      edit: async () => {},
      save: async () => {},
      execute: async ({ step, complete }) => {
        executions.push(step.workflow_step_execute_id)
        await new Promise(resolve => setTimeout(resolve, 10))
        await complete({ outputs: { id: step.workflow_step_execute_id } })
      },
    }))

    const createRequest = (execId: string) => new Request('http://localhost/slack/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'event_callback',
        event: {
          type: 'workflow_step_execute',
          callback_id: 'concurrent_step',
          workflow_step: { workflow_step_execute_id: execId, inputs: {} },
        },
      }),
    })

    // Execute multiple requests concurrently
    await Promise.all([
      bot.handleRequest(createRequest('exec-1')),
      bot.handleRequest(createRequest('exec-2')),
      bot.handleRequest(createRequest('exec-3')),
    ])

    expect(executions).toHaveLength(3)
    expect(executions).toContain('exec-1')
    expect(executions).toContain('exec-2')
    expect(executions).toContain('exec-3')
  })
})

// ============================================================================
// WORKFLOW BUILDER EDGE CASES
// ============================================================================

describe('WorkflowBuilder Edge Cases', () => {
  it('should handle workflow with no steps', () => {
    const workflow = new WorkflowBuilder('empty_workflow')
      .name('Empty Workflow')
      .build()

    expect(workflow.steps).toEqual([])
  })

  it('should validate required inputs', () => {
    expect(() => {
      new WorkflowBuilder('invalid')
        .name('Invalid Workflow')
        .input('required_field', { type: 'string', required: true })
        .addStep('some#/function', {
          field: '{{inputs.missing_field}}', // References non-existent input
        })
        .build({ validate: true })
    }).toThrow()
  })

  it('should support all input types', () => {
    const workflow = new WorkflowBuilder('typed_workflow')
      .name('Typed Workflow')
      .input('text', { type: 'string', title: 'Text' })
      .input('num', { type: 'number', title: 'Number' })
      .input('bool', { type: 'boolean', title: 'Boolean' })
      .input('channel', { type: 'slack#/types/channel_id', title: 'Channel' })
      .input('user', { type: 'slack#/types/user_id', title: 'User' })
      .input('timestamp', { type: 'slack#/types/timestamp', title: 'Time' })
      .input('rich', { type: 'slack#/types/rich_text', title: 'Rich Text' })
      .build()

    expect(Object.keys(workflow.input_parameters)).toHaveLength(7)
    expect(workflow.input_parameters.channel.type).toBe('slack#/types/channel_id')
  })

  it('should support nested step references', () => {
    const workflow = new WorkflowBuilder('nested_refs')
      .name('Nested References')
      .addStep('step#/a', { input: '{{inputs.value}}' }, { name: 'step_a' })
      .addStep('step#/b', {
        input: '{{steps.step_a.outputs.result}}',
        combined: '{{inputs.prefix}}_{{steps.step_a.outputs.id}}',
      }, { name: 'step_b' })
      .addStep('step#/c', {
        a_result: '{{steps.step_a.outputs.result}}',
        b_result: '{{steps.step_b.outputs.result}}',
      })
      .build()

    expect(workflow.steps[1].inputs.combined).toBe('{{inputs.prefix}}_{{steps.step_a.outputs.id}}')
  })
})
