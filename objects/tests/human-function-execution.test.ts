/**
 * HumanFunction Execution Tests
 *
 * RED TDD: These tests should FAIL because HumanFunctionExecutor doesn't exist yet.
 *
 * HumanFunction is a function type that queues tasks for human input.
 * It supports multiple channels (slack, email, in-app), structured forms,
 * timeout handling, escalation, and approval workflows.
 *
 * This file tests the execution engine for human-in-the-loop functions:
 * 1. Task queuing for human review/input
 * 2. Channel configuration (slack, email, in-app)
 * 3. Form definitions for structured input
 * 4. Timeout and escalation handling
 * 5. Approval workflows
 * 6. Notification delivery
 * 7. Response validation
 * 8. Error handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will FAIL - implementation doesn't exist yet
import {
  HumanFunctionExecutor,
  type HumanContext,
  type HumanResult,
  type TaskDefinition,
  type ChannelConfig,
  type FormDefinition,
  type FormFieldDefinition,
  type NotificationPayload,
  type HumanResponse,
  type ApprovalWorkflow,
  type EscalationConfig,
  type ExecutionOptions,
  HumanTimeoutError,
  HumanChannelError,
  HumanValidationError,
  HumanEscalationError,
  HumanApprovalRejectedError,
  HumanCancelledError,
  HumanNotificationFailedError,
} from '../HumanFunctionExecutor'

// ============================================================================
// TYPE DEFINITIONS (for test clarity)
// ============================================================================

/**
 * Expected human context passed to callbacks
 */
interface ExpectedHumanContext {
  // Identity
  taskId: string
  invocationId: string

  // Task info
  task: TaskDefinition
  channel: ChannelConfig

  // State management
  state: {
    get: <T>(key: string) => Promise<T | null>
    set: <T>(key: string, value: T) => Promise<void>
    delete: (key: string) => Promise<boolean>
  }

  // Logging
  log: {
    debug: (message: string, data?: unknown) => void
    info: (message: string, data?: unknown) => void
    warn: (message: string, data?: unknown) => void
    error: (message: string, data?: unknown) => void
  }

  // Events
  emit: (event: string, data: unknown) => Promise<void>

  // Cancellation
  signal: AbortSignal
}

/**
 * Expected human result
 */
interface ExpectedHumanResult {
  success: boolean
  response?: HumanResponse
  error?: {
    message: string
    name: string
    stack?: string
  }
  taskId: string
  duration: number
  respondedBy?: string
  respondedAt?: Date
  channel: string
  escalated?: boolean
  escalationLevel?: number
  metrics: {
    notificationsSent?: number
    retries?: number
    waitTime?: number
  }
}

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-human-do-id' },
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      delete: async (key: string) => storage.delete(key),
      list: async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      },
    },
    waitUntil: () => {},
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
  } as unknown as DurableObjectState
}

function createMockEnv() {
  return {
    SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/test',
    SENDGRID_API_KEY: 'test-sendgrid-key',
    APP_URL: 'https://app.example.com',
  }
}

function createMockChannels() {
  return {
    slack: {
      name: 'slack',
      type: 'slack' as const,
      send: vi.fn().mockResolvedValue({ messageId: 'slack-msg-123', delivered: true }),
      waitForResponse: vi.fn().mockResolvedValue({
        action: 'approve',
        userId: 'U123456',
        timestamp: new Date(),
        data: {},
      }),
      updateMessage: vi.fn().mockResolvedValue({ success: true }),
    },
    email: {
      name: 'email',
      type: 'email' as const,
      send: vi.fn().mockResolvedValue({ messageId: 'email-msg-456', delivered: true }),
      waitForResponse: vi.fn().mockResolvedValue({
        action: 'approve',
        userId: 'user@example.com',
        timestamp: new Date(),
        data: {},
      }),
    },
    'in-app': {
      name: 'in-app',
      type: 'in-app' as const,
      send: vi.fn().mockResolvedValue({ notificationId: 'notif-789', delivered: true }),
      waitForResponse: vi.fn().mockResolvedValue({
        action: 'approve',
        userId: 'user-123',
        timestamp: new Date(),
        data: {},
      }),
    },
  }
}

function createMockNotificationService() {
  return {
    send: vi.fn().mockResolvedValue({ messageId: 'msg-123', delivered: true }),
    waitForResponse: vi.fn().mockResolvedValue({
      action: 'approve',
      userId: 'user-123',
      timestamp: new Date(),
      data: {},
    }),
    getDeliveryStatus: vi.fn().mockResolvedValue({ status: 'delivered' }),
    cancelPending: vi.fn().mockResolvedValue({ cancelled: true }),
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('HumanFunction Execution', () => {
  let executor: InstanceType<typeof HumanFunctionExecutor>
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>
  let mockChannels: ReturnType<typeof createMockChannels>
  let mockNotificationService: ReturnType<typeof createMockNotificationService>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    mockChannels = createMockChannels()
    mockNotificationService = createMockNotificationService()
    executor = new HumanFunctionExecutor({
      state: mockState,
      env: mockEnv,
      channels: mockChannels,
      notificationService: mockNotificationService,
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. BASIC EXECUTION TESTS (queue task -> wait -> receive response)
  // ==========================================================================

  describe('Basic Execution', () => {
    describe('Task queuing', () => {
      it('queues a task and returns task ID', async () => {
        const result = await executor.execute({
          prompt: 'Please review this document',
          channel: 'slack',
          timeout: 60000,
        })

        expect(result.taskId).toBeDefined()
        expect(typeof result.taskId).toBe('string')
      })

      it('waits for human response', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'U123456',
          timestamp: new Date(),
          data: { comment: 'Looks good!' },
        })

        const result = await executor.execute({
          prompt: 'Please approve this request',
          channel: 'slack',
          timeout: 60000,
          actions: ['approve', 'reject'],
        })

        expect(result.success).toBe(true)
        expect(result.response?.action).toBe('approve')
        expect(result.respondedBy).toBe('U123456')
      })

      it('passes prompt to notification channel', async () => {
        await executor.execute({
          prompt: 'Approve expense report for $500',
          channel: 'slack',
          timeout: 60000,
        })

        expect(mockChannels.slack.send).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Approve expense report'),
          })
        )
      })

      it('generates unique task ID for each execution', async () => {
        const taskIds: string[] = []

        for (let i = 0; i < 3; i++) {
          const result = await executor.execute({
            prompt: `Task ${i}`,
            channel: 'slack',
            timeout: 60000,
          })
          taskIds.push(result.taskId)
        }

        expect(new Set(taskIds).size).toBe(3)
      })

      it('tracks response time in result', async () => {
        mockChannels.slack.waitForResponse.mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return {
            action: 'approve',
            userId: 'U123456',
            timestamp: new Date(),
            data: {},
          }
        })

        const result = await executor.execute({
          prompt: 'Quick approval',
          channel: 'slack',
          timeout: 60000,
        })

        expect(result.duration).toBeGreaterThanOrEqual(50)
        expect(result.metrics.waitTime).toBeGreaterThanOrEqual(50)
      })

      it('records who responded and when', async () => {
        const responseTime = new Date()
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'U789',
          timestamp: responseTime,
          data: {},
        })

        const result = await executor.execute({
          prompt: 'Review request',
          channel: 'slack',
          timeout: 60000,
        })

        expect(result.respondedBy).toBe('U789')
        expect(result.respondedAt).toEqual(responseTime)
      })
    })

    describe('Prompt interpolation', () => {
      it('interpolates variables in prompt', async () => {
        await executor.execute({
          prompt: 'Approve {{action}} for {{user}} costing ${{amount}}',
          channel: 'slack',
          timeout: 60000,
          input: {
            action: 'purchase',
            user: 'Alice',
            amount: 500,
          },
        })

        expect(mockChannels.slack.send).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Approve purchase for Alice costing $500'),
          })
        )
      })

      it('supports function-based prompt', async () => {
        await executor.execute({
          prompt: (input: { name: string; amount: number }) =>
            `Hello ${input.name}, please approve $${input.amount}`,
          channel: 'slack',
          timeout: 60000,
          input: { name: 'Bob', amount: 100 },
        })

        expect(mockChannels.slack.send).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Hello Bob, please approve $100',
          })
        )
      })

      it('handles missing variables gracefully', async () => {
        await executor.execute({
          prompt: 'Hello {{name}}, your balance is {{balance}}',
          channel: 'slack',
          timeout: 60000,
          input: { name: 'Charlie' },
        })

        expect(mockChannels.slack.send).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Hello Charlie'),
          })
        )
      })
    })

    describe('Action buttons', () => {
      it('sends action buttons with notification', async () => {
        await executor.execute({
          prompt: 'Approve this request?',
          channel: 'slack',
          timeout: 60000,
          actions: ['approve', 'reject', 'defer'],
        })

        expect(mockChannels.slack.send).toHaveBeenCalledWith(
          expect.objectContaining({
            actions: expect.arrayContaining([
              expect.objectContaining({ text: 'approve', value: 'approve' }),
              expect.objectContaining({ text: 'reject', value: 'reject' }),
              expect.objectContaining({ text: 'defer', value: 'defer' }),
            ]),
          })
        )
      })

      it('supports custom action labels', async () => {
        await executor.execute({
          prompt: 'Review PR',
          channel: 'slack',
          timeout: 60000,
          actions: [
            { value: 'approve', label: 'Approve & Merge', style: 'primary' },
            { value: 'reject', label: 'Request Changes', style: 'danger' },
          ],
        })

        expect(mockChannels.slack.send).toHaveBeenCalledWith(
          expect.objectContaining({
            actions: expect.arrayContaining([
              expect.objectContaining({ text: 'Approve & Merge', value: 'approve', style: 'primary' }),
              expect.objectContaining({ text: 'Request Changes', value: 'reject', style: 'danger' }),
            ]),
          })
        )
      })

      it('returns selected action in response', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'defer',
          userId: 'U123',
          timestamp: new Date(),
          data: {},
        })

        const result = await executor.execute({
          prompt: 'Approve?',
          channel: 'slack',
          timeout: 60000,
          actions: ['approve', 'reject', 'defer'],
        })

        expect(result.response?.action).toBe('defer')
      })
    })
  })

  // ==========================================================================
  // 2. CHANNEL TESTS (slack, email, in-app)
  // ==========================================================================

  describe('Channel Configuration', () => {
    describe('Slack channel', () => {
      it('sends notification via Slack', async () => {
        await executor.execute({
          prompt: 'Slack notification',
          channel: 'slack',
          timeout: 60000,
        })

        expect(mockChannels.slack.send).toHaveBeenCalled()
        expect(mockChannels.email.send).not.toHaveBeenCalled()
      })

      it('includes Slack-specific formatting', async () => {
        await executor.execute({
          prompt: 'Important *bold* message',
          channel: 'slack',
          timeout: 60000,
          channelOptions: {
            slackChannel: '#approvals',
            mentionUsers: ['U123', 'U456'],
          },
        })

        expect(mockChannels.slack.send).toHaveBeenCalledWith(
          expect.objectContaining({
            channel: '#approvals',
            mentions: ['U123', 'U456'],
          })
        )
      })

      it('updates Slack message after response', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'U123',
          timestamp: new Date(),
          data: {},
        })

        await executor.execute({
          prompt: 'Request',
          channel: 'slack',
          timeout: 60000,
          updateOnResponse: true,
        })

        expect(mockChannels.slack.updateMessage).toHaveBeenCalledWith(
          expect.any(String), // messageId
          expect.objectContaining({
            text: expect.stringContaining('approved'),
          })
        )
      })
    })

    describe('Email channel', () => {
      it('sends notification via Email', async () => {
        await executor.execute({
          prompt: 'Email notification',
          channel: 'email',
          timeout: 60000,
          channelOptions: {
            to: 'approver@example.com',
            subject: 'Action Required: Approval Request',
          },
        })

        expect(mockChannels.email.send).toHaveBeenCalledWith(
          expect.objectContaining({
            to: 'approver@example.com',
            subject: 'Action Required: Approval Request',
          })
        )
      })

      it('supports HTML email content', async () => {
        await executor.execute({
          prompt: '<h1>Request</h1><p>Please approve</p>',
          channel: 'email',
          timeout: 60000,
          channelOptions: {
            to: 'user@example.com',
            contentType: 'html',
          },
        })

        expect(mockChannels.email.send).toHaveBeenCalledWith(
          expect.objectContaining({
            contentType: 'html',
          })
        )
      })

      it('includes action links in email', async () => {
        await executor.execute({
          prompt: 'Approve request',
          channel: 'email',
          timeout: 60000,
          actions: ['approve', 'reject'],
          channelOptions: {
            to: 'user@example.com',
            actionLinkBaseUrl: 'https://app.example.com/actions',
          },
        })

        expect(mockChannels.email.send).toHaveBeenCalledWith(
          expect.objectContaining({
            actions: expect.arrayContaining([
              expect.objectContaining({
                url: expect.stringContaining('https://app.example.com/actions'),
              }),
            ]),
          })
        )
      })
    })

    describe('In-app channel', () => {
      it('sends in-app notification', async () => {
        await executor.execute({
          prompt: 'In-app notification',
          channel: 'in-app',
          timeout: 60000,
          channelOptions: {
            userId: 'user-123',
            priority: 'high',
          },
        })

        expect(mockChannels['in-app'].send).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'user-123',
            priority: 'high',
          })
        )
      })

      it('supports push notification option', async () => {
        await executor.execute({
          prompt: 'Urgent request',
          channel: 'in-app',
          timeout: 60000,
          channelOptions: {
            userId: 'user-123',
            pushNotification: true,
          },
        })

        expect(mockChannels['in-app'].send).toHaveBeenCalledWith(
          expect.objectContaining({
            pushNotification: true,
          })
        )
      })
    })

    describe('Multi-channel support', () => {
      it('sends to multiple channels simultaneously', async () => {
        await executor.execute({
          prompt: 'Multi-channel request',
          channel: ['slack', 'email'],
          timeout: 60000,
          channelOptions: {
            email: { to: 'user@example.com' },
            slack: { channel: '#approvals' },
          },
        })

        expect(mockChannels.slack.send).toHaveBeenCalled()
        expect(mockChannels.email.send).toHaveBeenCalled()
      })

      it('returns response from first channel to respond', async () => {
        mockChannels.slack.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({
            action: 'approve',
            userId: 'slack-user',
            timestamp: new Date(),
            data: {},
          }), 100))
        )

        mockChannels.email.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'email-user',
          timestamp: new Date(),
          data: {},
        })

        const result = await executor.execute({
          prompt: 'Request',
          channel: ['slack', 'email'],
          timeout: 60000,
        })

        expect(result.response?.userId).toBe('email-user')
        expect(result.channel).toBe('email')
      })

      it('cancels pending notifications after response', async () => {
        mockChannels.email.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'email-user',
          timestamp: new Date(),
          data: {},
        })

        await executor.execute({
          prompt: 'Request',
          channel: ['slack', 'email'],
          timeout: 60000,
        })

        // After email responds, slack notification should be cancelled/updated
        expect(mockNotificationService.cancelPending).toHaveBeenCalled()
      })
    })

    describe('Custom channel', () => {
      it('supports custom channel implementation', async () => {
        const customChannel = {
          name: 'sms',
          type: 'custom' as const,
          send: vi.fn().mockResolvedValue({ messageId: 'sms-123', delivered: true }),
          waitForResponse: vi.fn().mockResolvedValue({
            action: 'approve',
            userId: '+1234567890',
            timestamp: new Date(),
            data: {},
          }),
        }

        const executorWithCustom = new HumanFunctionExecutor({
          state: mockState,
          env: mockEnv,
          channels: { ...mockChannels, sms: customChannel },
          notificationService: mockNotificationService,
        })

        const result = await executorWithCustom.execute({
          prompt: 'SMS approval',
          channel: 'sms',
          timeout: 60000,
        })

        expect(customChannel.send).toHaveBeenCalled()
        expect(result.success).toBe(true)
      })

      it('throws on unknown channel', async () => {
        await expect(
          executor.execute({
            prompt: 'Test',
            channel: 'unknown-channel',
            timeout: 60000,
          })
        ).rejects.toThrow(HumanChannelError)
      })
    })
  })

  // ==========================================================================
  // 3. FORM TESTS (field validation, required fields, types)
  // ==========================================================================

  describe('Form Definitions', () => {
    describe('Basic form fields', () => {
      it('sends form definition with notification', async () => {
        await executor.execute({
          prompt: 'Please fill out this form',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              { name: 'name', type: 'text', label: 'Your Name', required: true },
              { name: 'amount', type: 'number', label: 'Amount', required: true },
            ],
          },
        })

        expect(mockChannels.slack.send).toHaveBeenCalledWith(
          expect.objectContaining({
            form: expect.objectContaining({
              fields: expect.arrayContaining([
                expect.objectContaining({ name: 'name', type: 'text' }),
                expect.objectContaining({ name: 'amount', type: 'number' }),
              ]),
            }),
          })
        )
      })

      it('returns form data in response', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            name: 'Alice',
            amount: 500,
          },
        })

        const result = await executor.execute({
          prompt: 'Fill form',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              { name: 'name', type: 'text', label: 'Name' },
              { name: 'amount', type: 'number', label: 'Amount' },
            ],
          },
        })

        expect(result.response?.data).toEqual({
          name: 'Alice',
          amount: 500,
        })
      })

      it('supports all field types', async () => {
        const form: FormDefinition = {
          fields: [
            { name: 'text_field', type: 'text', label: 'Text' },
            { name: 'number_field', type: 'number', label: 'Number' },
            { name: 'boolean_field', type: 'boolean', label: 'Boolean' },
            { name: 'select_field', type: 'select', label: 'Select', options: ['a', 'b', 'c'] },
            { name: 'multiselect_field', type: 'multiselect', label: 'Multi', options: ['x', 'y', 'z'] },
          ],
        }

        await executor.execute({
          prompt: 'Form with all types',
          channel: 'slack',
          timeout: 60000,
          form,
        })

        expect(mockChannels.slack.send).toHaveBeenCalledWith(
          expect.objectContaining({
            form: expect.objectContaining({
              fields: expect.arrayContaining([
                expect.objectContaining({ type: 'text' }),
                expect.objectContaining({ type: 'number' }),
                expect.objectContaining({ type: 'boolean' }),
                expect.objectContaining({ type: 'select', options: ['a', 'b', 'c'] }),
                expect.objectContaining({ type: 'multiselect', options: ['x', 'y', 'z'] }),
              ]),
            }),
          })
        )
      })
    })

    describe('Required field validation', () => {
      it('validates required fields are present', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            name: 'Alice',
            // amount is missing
          },
        })

        const result = await executor.execute({
          prompt: 'Form',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              { name: 'name', type: 'text', label: 'Name', required: true },
              { name: 'amount', type: 'number', label: 'Amount', required: true },
            ],
          },
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(HumanValidationError)
        expect(result.error?.message).toMatch(/required.*amount/i)
      })

      it('accepts optional fields as missing', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            name: 'Alice',
            // comment is optional and missing
          },
        })

        const result = await executor.execute({
          prompt: 'Form',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              { name: 'name', type: 'text', label: 'Name', required: true },
              { name: 'comment', type: 'text', label: 'Comment', required: false },
            ],
          },
        })

        expect(result.success).toBe(true)
      })

      it('validates required fields cannot be empty strings', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            name: '',
          },
        })

        const result = await executor.execute({
          prompt: 'Form',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              { name: 'name', type: 'text', label: 'Name', required: true },
            ],
          },
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(HumanValidationError)
      })
    })

    describe('Type validation', () => {
      it('validates number fields contain numbers', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            amount: 'not a number',
          },
        })

        const result = await executor.execute({
          prompt: 'Form',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              { name: 'amount', type: 'number', label: 'Amount' },
            ],
          },
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/number|type/i)
      })

      it('validates boolean fields contain booleans', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            agree: 'yes', // Should be boolean true/false
          },
        })

        const result = await executor.execute({
          prompt: 'Form',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              { name: 'agree', type: 'boolean', label: 'Agree' },
            ],
          },
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/boolean|type/i)
      })

      it('validates select field values are in options', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            priority: 'invalid',
          },
        })

        const result = await executor.execute({
          prompt: 'Form',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              { name: 'priority', type: 'select', label: 'Priority', options: ['low', 'medium', 'high'] },
            ],
          },
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/invalid.*option|not.*options/i)
      })

      it('validates multiselect field values are all in options', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            tags: ['valid', 'invalid'],
          },
        })

        const result = await executor.execute({
          prompt: 'Form',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              { name: 'tags', type: 'multiselect', label: 'Tags', options: ['valid', 'also-valid'] },
            ],
          },
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/invalid.*option/i)
      })

      it('validates multiselect is an array', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            tags: 'single-value',
          },
        })

        const result = await executor.execute({
          prompt: 'Form',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              { name: 'tags', type: 'multiselect', label: 'Tags', options: ['a', 'b'] },
            ],
          },
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/array/i)
      })
    })

    describe('Custom validation', () => {
      it('runs custom validation function', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            email: 'invalid-email',
          },
        })

        const result = await executor.execute({
          prompt: 'Form',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              {
                name: 'email',
                type: 'text',
                label: 'Email',
                validation: (value) => {
                  if (typeof value !== 'string' || !value.includes('@')) {
                    return 'Must be a valid email'
                  }
                  return true
                },
              },
            ],
          },
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/valid.*email/i)
      })

      it('passes validation when custom validator returns true', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            code: 'ABC123',
          },
        })

        const result = await executor.execute({
          prompt: 'Form',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              {
                name: 'code',
                type: 'text',
                label: 'Code',
                validation: (value) => typeof value === 'string' && value.length === 6,
              },
            ],
          },
        })

        expect(result.success).toBe(true)
      })

      it('supports async custom validation', async () => {
        const asyncValidator = vi.fn().mockResolvedValue(true)

        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            username: 'alice',
          },
        })

        const result = await executor.execute({
          prompt: 'Form',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              {
                name: 'username',
                type: 'text',
                label: 'Username',
                validation: asyncValidator,
              },
            ],
          },
        })

        expect(asyncValidator).toHaveBeenCalledWith('alice')
        expect(result.success).toBe(true)
      })
    })

    describe('Form with defaults', () => {
      it('supports default values in form', async () => {
        await executor.execute({
          prompt: 'Form with defaults',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              { name: 'priority', type: 'select', label: 'Priority', options: ['low', 'medium', 'high'], default: 'medium' },
              { name: 'urgent', type: 'boolean', label: 'Urgent', default: false },
            ],
          },
        })

        expect(mockChannels.slack.send).toHaveBeenCalledWith(
          expect.objectContaining({
            form: expect.objectContaining({
              fields: expect.arrayContaining([
                expect.objectContaining({ name: 'priority', default: 'medium' }),
                expect.objectContaining({ name: 'urgent', default: false }),
              ]),
            }),
          })
        )
      })

      it('uses default values when field not submitted', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            // priority not submitted, should use default
          },
        })

        const result = await executor.execute({
          prompt: 'Form',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              { name: 'priority', type: 'select', label: 'Priority', options: ['low', 'medium', 'high'], default: 'medium' },
            ],
          },
          applyDefaults: true,
        })

        expect(result.response?.data?.priority).toBe('medium')
      })
    })
  })

  // ==========================================================================
  // 4. TIMEOUT TESTS (configurable timeout, escalation)
  // ==========================================================================

  describe('Timeout Handling', () => {
    describe('Basic timeout', () => {
      it('times out after configured duration', async () => {
        mockChannels.slack.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000))
        )

        const result = await executor.execute({
          prompt: 'Urgent request',
          channel: 'slack',
          timeout: 100, // 100ms timeout
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(HumanTimeoutError)
        expect(result.error?.message).toMatch(/timeout/i)
      })

      it('completes before timeout when responded in time', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'U123',
          timestamp: new Date(),
          data: {},
        })

        const result = await executor.execute({
          prompt: 'Request',
          channel: 'slack',
          timeout: 60000,
        })

        expect(result.success).toBe(true)
      })

      it('reports timeout duration in error', async () => {
        mockChannels.slack.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000))
        )

        const result = await executor.execute({
          prompt: 'Request',
          channel: 'slack',
          timeout: 50,
        })

        expect(result.error?.message).toContain('50')
      })

      it('timeout can be set very short', async () => {
        mockChannels.slack.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 1000))
        )

        const result = await executor.execute({
          prompt: 'Request',
          channel: 'slack',
          timeout: 10, // 10ms
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(HumanTimeoutError)
      })
    })

    describe('Default action on timeout', () => {
      it('returns default action when timeout occurs', async () => {
        mockChannels.slack.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000))
        )

        const result = await executor.execute({
          prompt: 'Request',
          channel: 'slack',
          timeout: 50,
          defaultOnTimeout: {
            action: 'reject',
            reason: 'No response within timeout',
          },
        })

        expect(result.success).toBe(true)
        expect(result.response?.action).toBe('reject')
        expect(result.response?.data?.reason).toBe('No response within timeout')
        expect(result.response?.isDefault).toBe(true)
      })

      it('does not use default action when responded', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'U123',
          timestamp: new Date(),
          data: {},
        })

        const result = await executor.execute({
          prompt: 'Request',
          channel: 'slack',
          timeout: 60000,
          defaultOnTimeout: {
            action: 'reject',
            reason: 'Timeout',
          },
        })

        expect(result.response?.action).toBe('approve')
        expect(result.response?.isDefault).toBeUndefined()
      })
    })

    describe('Escalation on timeout', () => {
      it('escalates to different channel on timeout', async () => {
        mockChannels.slack.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000))
        )

        mockChannels.email.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'manager@example.com',
          timestamp: new Date(),
          data: {},
        })

        const result = await executor.execute({
          prompt: 'Approval request',
          channel: 'slack',
          timeout: 50,
          escalation: {
            timeout: 50,
            to: 'email',
            channelOptions: {
              to: 'manager@example.com',
              subject: 'Escalated: Approval Request',
            },
          },
        })

        expect(result.success).toBe(true)
        expect(result.escalated).toBe(true)
        expect(result.channel).toBe('email')
        expect(mockChannels.email.send).toHaveBeenCalled()
      })

      it('escalates to different user on same channel', async () => {
        let callCount = 0
        mockChannels.slack.waitForResponse.mockImplementation(async () => {
          callCount++
          if (callCount === 1) {
            // First call times out
            await new Promise((resolve) => setTimeout(resolve, 5000))
            throw new Error('Timeout')
          }
          // Second call (escalation) succeeds
          return {
            action: 'approve',
            userId: 'manager-U456',
            timestamp: new Date(),
            data: {},
          }
        })

        const result = await executor.execute({
          prompt: 'Request',
          channel: 'slack',
          timeout: 50,
          escalation: {
            timeout: 50,
            to: 'slack',
            channelOptions: {
              mentionUsers: ['manager-U456'],
              channel: '#managers',
            },
          },
        })

        expect(result.escalated).toBe(true)
        expect(mockChannels.slack.send).toHaveBeenCalledTimes(2)
      })

      it('supports multiple escalation levels', async () => {
        mockChannels.slack.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000))
        )
        mockChannels.email.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000))
        )
        mockChannels['in-app'].waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'ceo',
          timestamp: new Date(),
          data: {},
        })

        const result = await executor.execute({
          prompt: 'Critical request',
          channel: 'slack',
          timeout: 30,
          escalation: {
            timeout: 30,
            to: 'email',
            next: {
              timeout: 30,
              to: 'in-app',
              channelOptions: { userId: 'ceo', priority: 'critical' },
            },
          },
        })

        expect(result.escalated).toBe(true)
        expect(result.escalationLevel).toBe(2)
        expect(result.channel).toBe('in-app')
      })

      it('fails after all escalations timeout', async () => {
        mockChannels.slack.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000))
        )
        mockChannels.email.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000))
        )

        const result = await executor.execute({
          prompt: 'Request',
          channel: 'slack',
          timeout: 30,
          escalation: {
            timeout: 30,
            to: 'email',
          },
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(HumanTimeoutError)
        expect(result.escalated).toBe(true)
      })

      it('emits escalation event', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new HumanFunctionExecutor({
          state: mockState,
          env: mockEnv,
          channels: mockChannels,
          notificationService: mockNotificationService,
          onEvent,
        })

        mockChannels.slack.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000))
        )

        mockChannels.email.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'escalated@example.com',
          timestamp: new Date(),
          data: {},
        })

        await executorWithEvents.execute({
          prompt: 'Request',
          channel: 'slack',
          timeout: 30,
          escalation: {
            timeout: 30,
            to: 'email',
          },
        })

        expect(onEvent).toHaveBeenCalledWith(
          'human.escalated',
          expect.objectContaining({
            fromChannel: 'slack',
            toChannel: 'email',
            level: 1,
          })
        )
      })
    })

    describe('Reminder before timeout', () => {
      it('sends reminder notification before timeout', async () => {
        vi.useFakeTimers()

        mockChannels.slack.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 60000))
        )

        const executePromise = executor.execute({
          prompt: 'Request',
          channel: 'slack',
          timeout: 60000,
          reminder: {
            before: 30000, // 30 seconds before timeout
            message: 'Reminder: Please respond to the request',
          },
        })

        // Advance to reminder time
        await vi.advanceTimersByTimeAsync(30000)

        expect(mockChannels.slack.send).toHaveBeenCalledTimes(2) // Initial + reminder

        vi.useRealTimers()
      })
    })
  })

  // ==========================================================================
  // 5. APPROVAL TESTS (approve/reject workflows)
  // ==========================================================================

  describe('Approval Workflows', () => {
    describe('Simple approval', () => {
      it('handles approve action', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'U123',
          timestamp: new Date(),
          data: {},
        })

        const result = await executor.execute({
          prompt: 'Approve expense?',
          channel: 'slack',
          timeout: 60000,
          actions: ['approve', 'reject'],
        })

        expect(result.success).toBe(true)
        expect(result.response?.action).toBe('approve')
      })

      it('handles reject action', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'reject',
          userId: 'U123',
          timestamp: new Date(),
          data: { reason: 'Budget exceeded' },
        })

        const result = await executor.execute({
          prompt: 'Approve expense?',
          channel: 'slack',
          timeout: 60000,
          actions: ['approve', 'reject'],
        })

        expect(result.success).toBe(true)
        expect(result.response?.action).toBe('reject')
        expect(result.response?.data?.reason).toBe('Budget exceeded')
      })

      it('throws on invalid action', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'invalid-action',
          userId: 'U123',
          timestamp: new Date(),
          data: {},
        })

        const result = await executor.execute({
          prompt: 'Approve?',
          channel: 'slack',
          timeout: 60000,
          actions: ['approve', 'reject'],
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/invalid.*action/i)
      })
    })

    describe('Multi-level approval', () => {
      it('requires approval from multiple users', async () => {
        mockChannels.slack.waitForResponse
          .mockResolvedValueOnce({
            action: 'approve',
            userId: 'manager-U123',
            timestamp: new Date(),
            data: {},
          })
          .mockResolvedValueOnce({
            action: 'approve',
            userId: 'director-U456',
            timestamp: new Date(),
            data: {},
          })

        const result = await executor.execute({
          prompt: 'Approve large expense',
          channel: 'slack',
          timeout: 60000,
          actions: ['approve', 'reject'],
          approval: {
            type: 'sequential',
            levels: [
              { name: 'Manager', users: ['manager-U123'] },
              { name: 'Director', users: ['director-U456'] },
            ],
          },
        })

        expect(result.success).toBe(true)
        expect(mockChannels.slack.send).toHaveBeenCalledTimes(2)
        expect(result.response?.approvals).toHaveLength(2)
      })

      it('fails if any level rejects', async () => {
        mockChannels.slack.waitForResponse
          .mockResolvedValueOnce({
            action: 'approve',
            userId: 'manager-U123',
            timestamp: new Date(),
            data: {},
          })
          .mockResolvedValueOnce({
            action: 'reject',
            userId: 'director-U456',
            timestamp: new Date(),
            data: { reason: 'Too expensive' },
          })

        const result = await executor.execute({
          prompt: 'Approve expense',
          channel: 'slack',
          timeout: 60000,
          approval: {
            type: 'sequential',
            levels: [
              { name: 'Manager', users: ['manager-U123'] },
              { name: 'Director', users: ['director-U456'] },
            ],
          },
        })

        expect(result.success).toBe(true)
        expect(result.response?.action).toBe('reject')
        expect(result.response?.rejectedBy).toBe('director-U456')
        expect(result.response?.rejectionLevel).toBe('Director')
      })

      it('stops at first rejection in sequential approval', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'reject',
          userId: 'manager-U123',
          timestamp: new Date(),
          data: { reason: 'Not needed' },
        })

        const result = await executor.execute({
          prompt: 'Approve',
          channel: 'slack',
          timeout: 60000,
          approval: {
            type: 'sequential',
            levels: [
              { name: 'Manager', users: ['manager-U123'] },
              { name: 'Director', users: ['director-U456'] },
              { name: 'VP', users: ['vp-U789'] },
            ],
          },
        })

        // Should only send to manager, not escalate after rejection
        expect(mockChannels.slack.send).toHaveBeenCalledTimes(1)
        expect(result.response?.action).toBe('reject')
      })
    })

    describe('Parallel approval', () => {
      it('requires approval from multiple users in parallel', async () => {
        mockChannels.slack.waitForResponse
          .mockResolvedValueOnce({
            action: 'approve',
            userId: 'user-A',
            timestamp: new Date(),
            data: {},
          })
          .mockResolvedValueOnce({
            action: 'approve',
            userId: 'user-B',
            timestamp: new Date(),
            data: {},
          })

        const result = await executor.execute({
          prompt: 'Team approval needed',
          channel: 'slack',
          timeout: 60000,
          approval: {
            type: 'parallel',
            users: ['user-A', 'user-B'],
            requiredApprovals: 2,
          },
        })

        expect(result.success).toBe(true)
        expect(result.response?.action).toBe('approve')
        expect(result.response?.approvals).toHaveLength(2)
      })

      it('succeeds with quorum approval', async () => {
        mockChannels.slack.waitForResponse
          .mockResolvedValueOnce({
            action: 'approve',
            userId: 'user-A',
            timestamp: new Date(),
            data: {},
          })
          .mockResolvedValueOnce({
            action: 'approve',
            userId: 'user-B',
            timestamp: new Date(),
            data: {},
          })

        const result = await executor.execute({
          prompt: 'Need 2 of 3 approvals',
          channel: 'slack',
          timeout: 60000,
          approval: {
            type: 'parallel',
            users: ['user-A', 'user-B', 'user-C'],
            requiredApprovals: 2, // Only need 2 of 3
          },
        })

        expect(result.success).toBe(true)
        expect(result.response?.action).toBe('approve')
      })

      it('fails if not enough approvals', async () => {
        mockChannels.slack.waitForResponse
          .mockResolvedValueOnce({
            action: 'approve',
            userId: 'user-A',
            timestamp: new Date(),
            data: {},
          })
          .mockResolvedValueOnce({
            action: 'reject',
            userId: 'user-B',
            timestamp: new Date(),
            data: {},
          })
          .mockResolvedValueOnce({
            action: 'reject',
            userId: 'user-C',
            timestamp: new Date(),
            data: {},
          })

        const result = await executor.execute({
          prompt: 'Need approval',
          channel: 'slack',
          timeout: 60000,
          approval: {
            type: 'parallel',
            users: ['user-A', 'user-B', 'user-C'],
            requiredApprovals: 2,
          },
        })

        expect(result.response?.action).toBe('reject')
        expect(result.response?.approvalCount).toBe(1)
        expect(result.response?.rejectionCount).toBe(2)
      })

      it('fails fast when rejection makes approval impossible', async () => {
        // With 3 users needing 2 approvals, after 2 rejections we can fail fast
        mockChannels.slack.waitForResponse
          .mockResolvedValueOnce({
            action: 'reject',
            userId: 'user-A',
            timestamp: new Date(),
            data: {},
          })
          .mockResolvedValueOnce({
            action: 'reject',
            userId: 'user-B',
            timestamp: new Date(),
            data: {},
          })

        const result = await executor.execute({
          prompt: 'Need approval',
          channel: 'slack',
          timeout: 60000,
          approval: {
            type: 'parallel',
            users: ['user-A', 'user-B', 'user-C'],
            requiredApprovals: 2,
            failFast: true,
          },
        })

        expect(result.response?.action).toBe('reject')
        // Should not wait for user-C
        expect(mockChannels.slack.waitForResponse).toHaveBeenCalledTimes(2)
      })
    })

    describe('Approval with conditions', () => {
      it('routes to different approvers based on amount', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'manager',
          timestamp: new Date(),
          data: {},
        })

        await executor.execute({
          prompt: 'Approve expense of $500',
          channel: 'slack',
          timeout: 60000,
          input: { amount: 500 },
          approval: {
            type: 'conditional',
            conditions: [
              { when: (input: { amount: number }) => input.amount < 1000, users: ['manager'] },
              { when: (input: { amount: number }) => input.amount >= 1000, users: ['director'] },
            ],
          },
        })

        expect(mockChannels.slack.send).toHaveBeenCalledWith(
          expect.objectContaining({
            mentions: expect.arrayContaining(['manager']),
          })
        )
      })

      it('requires higher approval for larger amounts', async () => {
        mockChannels.slack.waitForResponse
          .mockResolvedValueOnce({
            action: 'approve',
            userId: 'manager',
            timestamp: new Date(),
            data: {},
          })
          .mockResolvedValueOnce({
            action: 'approve',
            userId: 'director',
            timestamp: new Date(),
            data: {},
          })

        const result = await executor.execute({
          prompt: 'Approve expense of $5000',
          channel: 'slack',
          timeout: 60000,
          input: { amount: 5000 },
          approval: {
            type: 'conditional',
            conditions: [
              { when: (input: { amount: number }) => input.amount >= 5000, users: ['manager', 'director'], sequential: true },
              { when: (input: { amount: number }) => input.amount < 5000, users: ['manager'] },
            ],
          },
        })

        expect(result.response?.approvals).toHaveLength(2)
      })
    })

    describe('Approval audit', () => {
      it('logs approval decisions', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'U123',
          timestamp: new Date(),
          data: { comment: 'Approved after review' },
        })

        const result = await executor.execute({
          prompt: 'Approve request',
          channel: 'slack',
          timeout: 60000,
          actions: ['approve', 'reject'],
        })

        // Should store audit log in state
        const auditLog = await mockState.storage.get(`audit:${result.taskId}`)
        expect(auditLog).toBeDefined()
        expect(auditLog).toMatchObject({
          taskId: result.taskId,
          action: 'approve',
          userId: 'U123',
          comment: 'Approved after review',
        })
      })

      it('emits approval event for audit', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new HumanFunctionExecutor({
          state: mockState,
          env: mockEnv,
          channels: mockChannels,
          notificationService: mockNotificationService,
          onEvent,
        })

        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'U123',
          timestamp: new Date(),
          data: {},
        })

        await executorWithEvents.execute({
          prompt: 'Approve',
          channel: 'slack',
          timeout: 60000,
        })

        expect(onEvent).toHaveBeenCalledWith(
          'human.decision',
          expect.objectContaining({
            action: 'approve',
            userId: 'U123',
          })
        )
      })
    })
  })

  // ==========================================================================
  // 6. NOTIFICATION TESTS (send notification, retry delivery)
  // ==========================================================================

  describe('Notification Delivery', () => {
    describe('Successful delivery', () => {
      it('sends notification and confirms delivery', async () => {
        await executor.execute({
          prompt: 'Test notification',
          channel: 'slack',
          timeout: 60000,
        })

        expect(mockChannels.slack.send).toHaveBeenCalled()
        // Note: toHaveReturnedWith doesn't work with async mocks, check the mock was called instead
        const sendResult = await mockChannels.slack.send.mock.results[0].value
        expect(sendResult).toMatchObject({ delivered: true })
      })

      it('stores message ID for tracking', async () => {
        mockChannels.slack.send.mockResolvedValueOnce({
          messageId: 'msg-12345',
          delivered: true,
        })

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
        })

        const stored = await mockState.storage.get(`notification:${result.taskId}`)
        expect(stored).toMatchObject({
          messageId: 'msg-12345',
          channel: 'slack',
        })
      })

      it('reports notification count in metrics', async () => {
        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
        })

        expect(result.metrics.notificationsSent).toBe(1)
      })
    })

    describe('Delivery retry', () => {
      it('retries on delivery failure', async () => {
        mockChannels.slack.send
          .mockRejectedValueOnce(new Error('Network error'))
          .mockRejectedValueOnce(new Error('Network error'))
          .mockResolvedValueOnce({ messageId: 'msg-123', delivered: true })

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
          delivery: {
            maxRetries: 3,
            retryDelay: 10,
          },
        })

        expect(mockChannels.slack.send).toHaveBeenCalledTimes(3)
        expect(result.metrics.retries).toBe(2)
      })

      it('fails after max retries exceeded', async () => {
        mockChannels.slack.send.mockRejectedValue(new Error('Persistent failure'))

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
          delivery: {
            maxRetries: 2,
            retryDelay: 10,
          },
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(HumanNotificationFailedError)
        expect(mockChannels.slack.send).toHaveBeenCalledTimes(2)
      })

      it('uses exponential backoff for retries', async () => {
        const callTimes: number[] = []
        mockChannels.slack.send.mockImplementation(async () => {
          callTimes.push(Date.now())
          if (callTimes.length < 3) {
            throw new Error('Retry')
          }
          return { messageId: 'msg-123', delivered: true }
        })

        await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
          delivery: {
            maxRetries: 3,
            retryDelay: 20,
            backoff: 'exponential',
          },
        })

        const delay1 = callTimes[1] - callTimes[0]
        const delay2 = callTimes[2] - callTimes[1]

        expect(delay2).toBeGreaterThan(delay1)
      })
    })

    describe('Fallback channel', () => {
      it('tries fallback channel on primary failure', async () => {
        mockChannels.slack.send.mockRejectedValue(new Error('Slack down'))
        mockChannels.email.send.mockResolvedValueOnce({ messageId: 'email-123', delivered: true })
        mockChannels.email.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'user@example.com',
          timestamp: new Date(),
          data: {},
        })

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
          fallbackChannel: 'email',
          channelOptions: {
            email: { to: 'user@example.com' },
          },
        })

        expect(result.success).toBe(true)
        expect(result.channel).toBe('email')
      })

      it('reports which channel was used', async () => {
        mockChannels.slack.send.mockRejectedValue(new Error('Slack down'))
        mockChannels.email.send.mockResolvedValueOnce({ messageId: 'email-123', delivered: true })
        mockChannels.email.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'user@example.com',
          timestamp: new Date(),
          data: {},
        })

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
          fallbackChannel: 'email',
        })

        expect(result.channel).toBe('email')
        expect(result.metrics.primaryChannelFailed).toBe(true)
      })
    })

    describe('Delivery confirmation', () => {
      it('checks delivery status', async () => {
        mockChannels.slack.send.mockResolvedValueOnce({
          messageId: 'msg-123',
          delivered: false, // Pending
        })

        mockNotificationService.getDeliveryStatus.mockResolvedValueOnce({
          status: 'delivered',
        })

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
          confirmDelivery: true,
        })

        expect(mockNotificationService.getDeliveryStatus).toHaveBeenCalledWith('msg-123')
      })

      it('fails if delivery not confirmed', async () => {
        mockChannels.slack.send.mockResolvedValueOnce({
          messageId: 'msg-123',
          delivered: false,
        })

        mockNotificationService.getDeliveryStatus.mockResolvedValue({
          status: 'failed',
          error: 'User not found',
        })

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
          confirmDelivery: true,
          delivery: { maxRetries: 1 },
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(HumanNotificationFailedError)
      })
    })
  })

  // ==========================================================================
  // 7. RESPONSE TESTS (validate response against schema)
  // ==========================================================================

  describe('Response Validation', () => {
    describe('Schema validation', () => {
      it('validates response against JSON schema', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            approved: true,
            amount: 500,
            notes: 'Looks good',
          },
        })

        const result = await executor.execute({
          prompt: 'Review',
          channel: 'slack',
          timeout: 60000,
          responseSchema: {
            type: 'object',
            properties: {
              approved: { type: 'boolean' },
              amount: { type: 'number' },
              notes: { type: 'string' },
            },
            required: ['approved', 'amount'],
          },
        })

        expect(result.success).toBe(true)
      })

      it('fails when response does not match schema', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            approved: 'yes', // Should be boolean
            amount: 500,
          },
        })

        const result = await executor.execute({
          prompt: 'Review',
          channel: 'slack',
          timeout: 60000,
          responseSchema: {
            type: 'object',
            properties: {
              approved: { type: 'boolean' },
              amount: { type: 'number' },
            },
            required: ['approved', 'amount'],
          },
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(HumanValidationError)
      })

      it('validates required fields in schema', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            approved: true,
            // amount is missing
          },
        })

        const result = await executor.execute({
          prompt: 'Review',
          channel: 'slack',
          timeout: 60000,
          responseSchema: {
            type: 'object',
            properties: {
              approved: { type: 'boolean' },
              amount: { type: 'number' },
            },
            required: ['approved', 'amount'],
          },
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/required|amount/i)
      })
    })

    describe('Action validation', () => {
      it('validates action is one of allowed actions', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'maybe',
          userId: 'U123',
          timestamp: new Date(),
          data: {},
        })

        const result = await executor.execute({
          prompt: 'Approve?',
          channel: 'slack',
          timeout: 60000,
          actions: ['approve', 'reject'],
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/invalid.*action/i)
      })

      it('allows any action when actions not specified', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'custom-action',
          userId: 'U123',
          timestamp: new Date(),
          data: {},
        })

        const result = await executor.execute({
          prompt: 'Respond',
          channel: 'slack',
          timeout: 60000,
          // No actions specified
        })

        expect(result.success).toBe(true)
        expect(result.response?.action).toBe('custom-action')
      })
    })

    describe('Custom response validation', () => {
      it('runs custom validation function on response', async () => {
        const customValidator = vi.fn().mockReturnValue(true)

        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: { amount: 500 },
        })

        await executor.execute({
          prompt: 'Submit amount',
          channel: 'slack',
          timeout: 60000,
          validateResponse: customValidator,
        })

        expect(customValidator).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'submit',
            data: { amount: 500 },
          })
        )
      })

      it('fails when custom validator returns false', async () => {
        const customValidator = vi.fn().mockReturnValue('Amount must be positive')

        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: { amount: -100 },
        })

        const result = await executor.execute({
          prompt: 'Submit',
          channel: 'slack',
          timeout: 60000,
          validateResponse: customValidator,
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/positive/i)
      })

      it('supports async custom validator', async () => {
        const asyncValidator = vi.fn().mockResolvedValue(true)

        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {},
        })

        const result = await executor.execute({
          prompt: 'Submit',
          channel: 'slack',
          timeout: 60000,
          validateResponse: asyncValidator,
        })

        expect(asyncValidator).toHaveBeenCalled()
        expect(result.success).toBe(true)
      })
    })

    describe('Response transformation', () => {
      it('transforms response before returning', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: { amount: '500' },
        })

        const result = await executor.execute({
          prompt: 'Submit',
          channel: 'slack',
          timeout: 60000,
          transformResponse: (response) => ({
            ...response,
            data: {
              ...response.data,
              amount: parseInt(response.data.amount as string, 10),
            },
          }),
        })

        expect(result.response?.data?.amount).toBe(500)
        expect(typeof result.response?.data?.amount).toBe('number')
      })
    })
  })

  // ==========================================================================
  // 8. ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    describe('Channel errors', () => {
      it('handles channel send error', async () => {
        mockChannels.slack.send.mockRejectedValue(new Error('Channel unavailable'))

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(HumanChannelError)
      })

      it('handles channel response error', async () => {
        mockChannels.slack.send.mockResolvedValueOnce({ messageId: 'msg-123', delivered: true })
        mockChannels.slack.waitForResponse.mockRejectedValue(new Error('Connection lost'))

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(HumanChannelError)
      })
    })

    describe('Validation errors', () => {
      it('reports validation error with field details', async () => {
        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {
            name: '',
            email: 'invalid',
          },
        })

        const result = await executor.execute({
          prompt: 'Form',
          channel: 'slack',
          timeout: 60000,
          form: {
            fields: [
              { name: 'name', type: 'text', label: 'Name', required: true },
              {
                name: 'email',
                type: 'text',
                label: 'Email',
                validation: (v) => (typeof v === 'string' && v.includes('@')) || 'Invalid email',
              },
            ],
          },
        })

        expect(result.success).toBe(false)
        const error = result.error as HumanValidationError
        expect(error.fields).toContain('name')
        expect(error.fields).toContain('email')
      })
    })

    describe('Cancellation', () => {
      it('can cancel pending human task', async () => {
        const controller = new AbortController()

        mockChannels.slack.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000))
        )

        setTimeout(() => controller.abort(), 50)

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
          signal: controller.signal,
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(HumanCancelledError)
      })

      it('cleans up notification on cancel', async () => {
        const controller = new AbortController()

        mockChannels.slack.send.mockResolvedValueOnce({ messageId: 'msg-123', delivered: true })
        mockChannels.slack.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000))
        )

        setTimeout(() => controller.abort(), 50)

        await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
          signal: controller.signal,
        })

        expect(mockNotificationService.cancelPending).toHaveBeenCalled()
      })

      it('early return when signal already aborted', async () => {
        const controller = new AbortController()
        controller.abort()

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
          signal: controller.signal,
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(HumanCancelledError)
        expect(mockChannels.slack.send).not.toHaveBeenCalled()
      })
    })

    describe('Error events', () => {
      it('emits error event on failure', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new HumanFunctionExecutor({
          state: mockState,
          env: mockEnv,
          channels: mockChannels,
          notificationService: mockNotificationService,
          onEvent,
        })

        mockChannels.slack.send.mockRejectedValue(new Error('Failed'))

        await executorWithEvents.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
        })

        expect(onEvent).toHaveBeenCalledWith(
          'human.error',
          expect.objectContaining({
            error: expect.stringContaining('Failed'),
          })
        )
      })

      it('emits timeout event', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new HumanFunctionExecutor({
          state: mockState,
          env: mockEnv,
          channels: mockChannels,
          notificationService: mockNotificationService,
          onEvent,
        })

        mockChannels.slack.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000))
        )

        await executorWithEvents.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 50,
        })

        expect(onEvent).toHaveBeenCalledWith(
          'human.timeout',
          expect.objectContaining({
            timeout: 50,
          })
        )
      })
    })

    describe('State persistence on error', () => {
      it('persists task state even on error', async () => {
        mockChannels.slack.send.mockRejectedValue(new Error('Failed'))

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
        })

        const stored = await mockState.storage.get(`task:${result.taskId}`)
        expect(stored).toBeDefined()
        expect(stored).toMatchObject({
          status: 'failed',
          error: expect.stringContaining('Failed'),
        })
      })

      it('persists partial progress before timeout', async () => {
        mockChannels.slack.send.mockResolvedValueOnce({ messageId: 'msg-123', delivered: true })
        mockChannels.slack.waitForResponse.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000))
        )

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 50,
        })

        const stored = await mockState.storage.get(`task:${result.taskId}`)
        expect(stored).toMatchObject({
          status: 'timeout',
          notificationSent: true,
          messageId: 'msg-123',
        })
      })
    })
  })

  // ==========================================================================
  // 9. EXECUTION TRACE AND EVENTS
  // ==========================================================================

  describe('Execution Trace', () => {
    describe('Event emission', () => {
      it('emits human.started event', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new HumanFunctionExecutor({
          state: mockState,
          env: mockEnv,
          channels: mockChannels,
          notificationService: mockNotificationService,
          onEvent,
        })

        await executorWithEvents.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
        })

        expect(onEvent).toHaveBeenCalledWith(
          'human.started',
          expect.objectContaining({
            taskId: expect.any(String),
            channel: 'slack',
          })
        )
      })

      it('emits human.notification.sent event', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new HumanFunctionExecutor({
          state: mockState,
          env: mockEnv,
          channels: mockChannels,
          notificationService: mockNotificationService,
          onEvent,
        })

        await executorWithEvents.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
        })

        expect(onEvent).toHaveBeenCalledWith(
          'human.notification.sent',
          expect.objectContaining({
            channel: 'slack',
            messageId: expect.any(String),
          })
        )
      })

      it('emits human.response.received event', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new HumanFunctionExecutor({
          state: mockState,
          env: mockEnv,
          channels: mockChannels,
          notificationService: mockNotificationService,
          onEvent,
        })

        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'U123',
          timestamp: new Date(),
          data: {},
        })

        await executorWithEvents.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
        })

        expect(onEvent).toHaveBeenCalledWith(
          'human.response.received',
          expect.objectContaining({
            action: 'approve',
            userId: 'U123',
          })
        )
      })

      it('emits human.completed event', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new HumanFunctionExecutor({
          state: mockState,
          env: mockEnv,
          channels: mockChannels,
          notificationService: mockNotificationService,
          onEvent,
        })

        await executorWithEvents.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
        })

        expect(onEvent).toHaveBeenCalledWith(
          'human.completed',
          expect.objectContaining({
            success: true,
            duration: expect.any(Number),
          })
        )
      })
    })

    describe('Metrics tracking', () => {
      it('tracks wait time', async () => {
        mockChannels.slack.waitForResponse.mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          return {
            action: 'approve',
            userId: 'U123',
            timestamp: new Date(),
            data: {},
          }
        })

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
        })

        expect(result.metrics.waitTime).toBeGreaterThanOrEqual(100)
      })

      it('tracks notification attempts', async () => {
        mockChannels.slack.send
          .mockRejectedValueOnce(new Error('Retry'))
          .mockResolvedValueOnce({ messageId: 'msg-123', delivered: true })

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
          delivery: { maxRetries: 2, retryDelay: 10 },
        })

        expect(result.metrics.notificationsSent).toBe(1)
        expect(result.metrics.retries).toBe(1)
      })
    })
  })

  // ==========================================================================
  // 10. CONTEXT AND CALLBACKS
  // ==========================================================================

  describe('Context and Callbacks', () => {
    describe('onSend callback', () => {
      it('calls onSend before sending notification', async () => {
        const callOrder: string[] = []
        const onSend = vi.fn(() => {
          callOrder.push('onSend')
        })
        mockChannels.slack.send.mockImplementation(async (payload) => {
          callOrder.push('send')
          return { messageId: 'slack-msg-123', delivered: true }
        })

        await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
          onSend,
        })

        expect(onSend).toHaveBeenCalledWith(
          expect.objectContaining({
            channel: 'slack',
            message: expect.stringContaining('Test'),
          })
        )
        // Note: toHaveBeenCalledBefore is not available in vitest, use call order tracking
        expect(callOrder).toEqual(['onSend', 'send'])
      })

      it('can modify notification in onSend', async () => {
        const onSend = vi.fn((payload: NotificationPayload) => ({
          ...payload,
          message: `[MODIFIED] ${payload.message}`,
        }))

        await executor.execute({
          prompt: 'Original',
          channel: 'slack',
          timeout: 60000,
          onSend,
        })

        expect(mockChannels.slack.send).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('[MODIFIED]'),
          })
        )
      })
    })

    describe('onResponse callback', () => {
      it('calls onResponse when human responds', async () => {
        const onResponse = vi.fn()

        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'approve',
          userId: 'U123',
          timestamp: new Date(),
          data: { note: 'Approved' },
        })

        await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
          onResponse,
        })

        expect(onResponse).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'approve',
            userId: 'U123',
            data: { note: 'Approved' },
          })
        )
      })

      it('can transform response in onResponse', async () => {
        const onResponse = vi.fn((response: HumanResponse) => ({
          ...response,
          data: {
            ...response.data,
            processed: true,
          },
        }))

        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: { value: 100 },
        })

        const result = await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
          onResponse,
        })

        expect(result.response?.data?.processed).toBe(true)
      })
    })

    describe('Context access', () => {
      it('provides context to custom validators', async () => {
        let capturedContext: HumanContext | undefined

        mockChannels.slack.waitForResponse.mockResolvedValueOnce({
          action: 'submit',
          userId: 'U123',
          timestamp: new Date(),
          data: {},
        })

        await executor.execute({
          prompt: 'Test',
          channel: 'slack',
          timeout: 60000,
          validateResponse: (response, context) => {
            capturedContext = context
            return true
          },
        })

        expect(capturedContext).toBeDefined()
        expect(capturedContext?.taskId).toBeDefined()
        expect(capturedContext?.state).toBeDefined()
        expect(capturedContext?.log).toBeDefined()
      })
    })
  })
})
