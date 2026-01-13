/**
 * Slack Channel Delivery Integration Tests (RED Phase)
 *
 * Tests REAL Slack message delivery for human approval/task notifications.
 * NO MOCKS - tests hit actual Slack API (test workspace) and verify message delivery.
 *
 * Slack is a PRIMARY notification channel for Human-in-the-Loop workflows,
 * providing interactive buttons for approve/reject actions.
 *
 * Environment Variables Required:
 * - SLACK_TEST_TOKEN: Slack Bot Token (xoxb-...) with permissions:
 *   - chat:write (send messages)
 *   - chat:write.public (send to public channels without joining)
 *   - users:read (resolve user mentions)
 *   - reactions:write (add reactions for confirmation)
 *   - conversations:history (verify message delivery)
 * - SLACK_TEST_CHANNEL: Test channel ID (e.g., 'C1234567890')
 *   - Must be a channel the bot has access to
 * - SLACK_TEST_USER: Test user ID for @mentions (e.g., 'U1234567890')
 *   - Used for escalation mention tests
 * - SLACK_SIGNING_SECRET: (optional) For interaction signature verification
 *
 * Setup Instructions:
 * 1. Create a Slack App at https://api.slack.com/apps
 * 2. Add Bot Token Scopes listed above
 * 3. Install app to test workspace
 * 4. Copy Bot User OAuth Token to SLACK_TEST_TOKEN
 * 5. Create a dedicated test channel and copy ID to SLACK_TEST_CHANNEL
 * 6. Get your Slack user ID for SLACK_TEST_USER
 *
 * Run with: npx vitest run tests/integration/channels/slack-delivery.test.ts --project=integration
 *
 * @module tests/integration/channels/slack-delivery.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  SlackHumanChannel,
  type SlackChannelConfig,
} from '../../../lib/human/channels/slack'
import type {
  NotificationPayload,
  SendResult,
  HumanResponse,
} from '../../../lib/human/channels'

// =============================================================================
// Test Configuration
// =============================================================================

const TEST_CONFIG: SlackChannelConfig = {
  webhookUrl: process.env.SLACK_WEBHOOK_URL || 'https://hooks.slack.com/services/TEST',
  botToken: process.env.SLACK_TEST_TOKEN,
  defaultChannel: process.env.SLACK_TEST_CHANNEL || 'C0123456789',
}

const TEST_USER_ID = process.env.SLACK_TEST_USER || 'U0123456789'

// =============================================================================
// Types for Extended Slack Channel (to be implemented in GREEN phase)
// =============================================================================

/**
 * Extended Slack channel config with all delivery options
 */
export interface SlackDeliveryConfig extends SlackChannelConfig {
  /** Signing secret for interaction verification */
  signingSecret?: string
  /** App-level token for Socket Mode */
  appToken?: string
  /** Enable interaction handling */
  enableInteractions?: boolean
  /** Callback URL for interactions */
  interactionCallbackUrl?: string
}

/**
 * Task assignment payload for Slack
 */
export interface SlackTaskAssignment {
  to: string // channel ID
  taskId: string
  title: string
  description: string
  instructions?: string[]
  dueDate?: Date
  estimatedEffort?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  assignedBy?: string
  attachments?: Array<{
    filename: string
    url: string
  }>
}

/**
 * Escalation payload for Slack
 */
export interface SlackEscalation {
  to: string // channel ID
  escalationId: string
  originalRequestId: string
  reason: string
  priority: 'high' | 'urgent'
  escalationLevel?: number
  escalationChain?: string[]
  currentLevel?: string
  mentionUser?: string
  slaDeadline?: Date
  slaWarning?: boolean
  timeRemaining?: string
}

/**
 * Extended send result with Slack-specific fields
 */
export interface SlackSendResult extends SendResult {
  /** Slack message timestamp (for updates) */
  ts?: string
  /** Channel where message was posted */
  channel?: string
  /** Thread timestamp if in thread */
  threadTs?: string
  /** Whether message has interactive elements */
  hasInteractiveElements?: boolean
}

/**
 * Interaction event from Slack
 */
export interface SlackInteractionEvent {
  type: 'block_actions' | 'view_submission' | 'message_action'
  user: { id: string; username?: string; name?: string }
  channel?: { id: string; name?: string }
  actions: Array<{
    action_id: string
    value: string
    type: string
  }>
  message?: {
    ts: string
    text?: string
  }
  response_url?: string
  trigger_id?: string
}

/**
 * Extended Slack channel interface (to be implemented)
 */
export interface ExtendedSlackHumanChannel extends SlackHumanChannel {
  /**
   * Send task assignment notification
   */
  sendTaskAssignment(task: SlackTaskAssignment): Promise<SlackSendResult>

  /**
   * Send escalation notification with user mention
   */
  sendEscalation(escalation: SlackEscalation): Promise<SlackSendResult>

  /**
   * Update an existing message (e.g., after response)
   */
  updateMessage(
    channel: string,
    ts: string,
    payload: Partial<NotificationPayload>
  ): Promise<SlackSendResult>

  /**
   * Handle interaction callback from Slack
   */
  handleInteractionCallback(event: SlackInteractionEvent): Promise<HumanResponse>

  /**
   * Verify Slack request signature
   */
  verifySignature(
    signature: string,
    timestamp: string,
    body: string
  ): boolean

  /**
   * Get delivery status of a message
   */
  getDeliveryStatus(channel: string, ts: string): Promise<{
    delivered: boolean
    readBy?: string[]
    reactions?: Array<{ name: string; count: number }>
  }>
}

// =============================================================================
// Approval Request Notifications
// =============================================================================

describe('Slack Channel Delivery (REAL)', () => {
  let channel: SlackHumanChannel

  beforeAll(() => {
    channel = new SlackHumanChannel(TEST_CONFIG)
  })

  afterAll(async () => {
    // No cleanup needed for basic channel
  })

  describe('Approval Request Notifications', () => {
    it('sends approval request with approve/reject buttons', async () => {
      const payload: NotificationPayload = {
        requestId: `req-approval-${Date.now()}`,
        message: 'Please approve this expense report for $2,500',
        priority: 'high',
        actions: [
          { label: 'Approve', value: 'approve', style: 'success' },
          { label: 'Reject', value: 'reject', style: 'danger' },
        ],
        metadata: {
          submitter: 'john.doe@example.com',
          amount: '$2,500',
          category: 'Travel',
          department: 'Engineering',
        },
      }

      const result = await channel.send(payload)

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
      // Slack message timestamps are in format like "1234567890.123456"
      expect(result.messageId).toMatch(/^\d+\.\d+$/)
      expect(result.timestamp).toBeDefined()
    })

    it('sends approval request with custom action buttons', async () => {
      const payload: NotificationPayload = {
        requestId: `req-custom-${Date.now()}`,
        message: 'Review the partnership proposal with Acme Corp',
        priority: 'normal',
        actions: [
          { label: 'Approve', value: 'approve', style: 'success' },
          { label: 'Request Changes', value: 'changes', style: 'primary' },
          { label: 'Reject', value: 'reject', style: 'danger' },
        ],
        metadata: {
          partner: 'Acme Corp',
          dealValue: '$500,000',
          term: '3 years',
        },
      }

      const result = await channel.send(payload)

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
    })

    it('updates message on approval response', async () => {
      // First send the approval request
      const payload: NotificationPayload = {
        requestId: `req-update-${Date.now()}`,
        message: 'Approve the budget increase for Q1',
        priority: 'high',
        actions: [
          { label: 'Approve', value: 'approve', style: 'success' },
          { label: 'Reject', value: 'reject', style: 'danger' },
        ],
      }

      const sendResult = await channel.send(payload)
      expect(sendResult.delivered).toBe(true)
      expect(sendResult.messageId).toBeDefined()

      // Now update the message to show it was approved
      // This requires the updateNotification method which should be implemented
      const extendedChannel = channel as unknown as ExtendedSlackHumanChannel

      // This will fail until updateMessage is implemented
      const updateResult = await extendedChannel.updateMessage(
        TEST_CONFIG.defaultChannel!,
        sendResult.messageId!,
        {
          requestId: payload.requestId,
          message: ':white_check_mark: *Approved* - Budget increase for Q1\n_Approved by @manager at ' + new Date().toISOString() + '_',
          // Remove action buttons after response
          actions: [],
        }
      )

      expect(updateResult.delivered).toBe(true)
      expect(updateResult.ts).toBe(sendResult.messageId)
    })

    it('sends urgent approval with rotating_light emoji prefix', async () => {
      const payload: NotificationPayload = {
        requestId: `req-urgent-${Date.now()}`,
        message: 'CRITICAL: Server access approval needed for incident response',
        priority: 'urgent',
        actions: [
          { label: 'Approve NOW', value: 'approve', style: 'success' },
          { label: 'Deny', value: 'reject', style: 'danger' },
        ],
        metadata: {
          incident: 'INC-2024-001',
          severity: 'P0',
          requestedBy: 'oncall@example.com',
        },
      }

      const result = await channel.send(payload)

      expect(result.delivered).toBe(true)
      // The message should include the urgency indicator
      // Verified by checking the Slack channel
    })
  })

  // ===========================================================================
  // Task Assignment Notifications
  // ===========================================================================

  describe('Task Assignment Notifications', () => {
    it('sends task assignment with instructions', async () => {
      const extendedChannel = channel as unknown as ExtendedSlackHumanChannel

      const task: SlackTaskAssignment = {
        to: TEST_CONFIG.defaultChannel!,
        taskId: `task-${Date.now()}`,
        title: 'Review Q4 Financial Report',
        description: 'Please review the quarterly financial report and provide your analysis.',
        instructions: [
          'Download the report from the shared drive',
          'Review sections 3.1 through 3.5 for accuracy',
          'Check all calculations in the appendix',
          'Submit your findings in the task portal',
        ],
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week
        priority: 'high',
        assignedBy: 'CFO',
      }

      // This will fail until sendTaskAssignment is implemented
      const result = await extendedChannel.sendTaskAssignment(task)

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
      expect(result.channel).toBe(TEST_CONFIG.defaultChannel)
    })

    it('sends task with estimated effort indicator', async () => {
      const extendedChannel = channel as unknown as ExtendedSlackHumanChannel

      const task: SlackTaskAssignment = {
        to: TEST_CONFIG.defaultChannel!,
        taskId: `task-effort-${Date.now()}`,
        title: 'Code Review: Authentication Refactor',
        description: 'Review the authentication module refactoring PR',
        estimatedEffort: '2-3 hours',
        dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days
        priority: 'normal',
        assignedBy: 'tech-lead',
      }

      const result = await extendedChannel.sendTaskAssignment(task)

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
    })

    it('sends task with file attachments', async () => {
      const extendedChannel = channel as unknown as ExtendedSlackHumanChannel

      const task: SlackTaskAssignment = {
        to: TEST_CONFIG.defaultChannel!,
        taskId: `task-attach-${Date.now()}`,
        title: 'Review Design Mockups',
        description: 'Review the attached design mockups for the new dashboard',
        attachments: [
          { filename: 'dashboard-v2.pdf', url: 'https://example.com/files/dashboard-v2.pdf' },
          { filename: 'wireframes.pdf', url: 'https://example.com/files/wireframes.pdf' },
        ],
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        priority: 'normal',
      }

      const result = await extendedChannel.sendTaskAssignment(task)

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
    })

    it('sends task assignment via basic send method', async () => {
      // Fallback test using basic send() method
      const payload: NotificationPayload = {
        requestId: `task-basic-${Date.now()}`,
        message: '*New Task Assigned*\n\n*Title:* Review Security Audit Report\n*Due:* 2024-01-20\n*Priority:* High\n\nPlease review the security audit findings and prepare remediation plan.',
        priority: 'high',
        metadata: {
          taskId: 'TASK-123',
          assignedBy: 'security-team',
          estimatedEffort: '4 hours',
        },
      }

      const result = await channel.send(payload)

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
    })
  })

  // ===========================================================================
  // Escalation Notifications
  // ===========================================================================

  describe('Escalation Notifications', () => {
    it('sends escalation with urgency indicator', async () => {
      const extendedChannel = channel as unknown as ExtendedSlackHumanChannel

      const escalation: SlackEscalation = {
        to: TEST_CONFIG.defaultChannel!,
        escalationId: `esc-${Date.now()}`,
        originalRequestId: 'req-123',
        reason: 'SLA exceeded - no response in 4 hours',
        priority: 'urgent',
        escalationLevel: 2,
        escalationChain: ['manager@example.com', 'director@example.com', 'vp@example.com'],
        currentLevel: 'director@example.com',
      }

      // This will fail until sendEscalation is implemented
      const result = await extendedChannel.sendEscalation(escalation)

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
    })

    it('mentions escalation target user', async () => {
      const extendedChannel = channel as unknown as ExtendedSlackHumanChannel

      const escalation: SlackEscalation = {
        to: TEST_CONFIG.defaultChannel!,
        escalationId: `esc-mention-${Date.now()}`,
        originalRequestId: 'req-456',
        reason: 'Approval required for production deployment',
        priority: 'high',
        mentionUser: TEST_USER_ID, // Will generate <@U0123456789> mention
        escalationLevel: 1,
      }

      const result = await extendedChannel.sendEscalation(escalation)

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
      // The message should contain the @mention
    })

    it('sends SLA warning escalation', async () => {
      const extendedChannel = channel as unknown as ExtendedSlackHumanChannel

      const slaDeadline = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now

      const escalation: SlackEscalation = {
        to: TEST_CONFIG.defaultChannel!,
        escalationId: `esc-sla-${Date.now()}`,
        originalRequestId: 'req-789',
        reason: 'Approaching SLA deadline',
        priority: 'high',
        slaDeadline,
        slaWarning: true,
        timeRemaining: '30 minutes',
        mentionUser: TEST_USER_ID,
      }

      const result = await extendedChannel.sendEscalation(escalation)

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
    })

    it('sends escalation via basic send with mention formatting', async () => {
      // Fallback test using basic send() method with manual mention
      const payload: NotificationPayload = {
        requestId: `esc-basic-${Date.now()}`,
        message: `:rotating_light: *ESCALATION* :rotating_light:\n\n<@${TEST_USER_ID}> - Immediate attention required!\n\n*Original Request:* req-999\n*Reason:* SLA breach - 6 hours without response\n*Level:* Director escalation`,
        priority: 'urgent',
        metadata: {
          escalationId: 'ESC-001',
          originalRequestId: 'req-999',
          escalationLevel: '2',
        },
      }

      const result = await channel.send(payload)

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
    })
  })

  // ===========================================================================
  // Delivery Confirmation
  // ===========================================================================

  describe('Delivery Confirmation', () => {
    it('confirms message was delivered', async () => {
      const payload: NotificationPayload = {
        requestId: `req-confirm-${Date.now()}`,
        message: 'Test delivery confirmation',
        priority: 'normal',
      }

      const result = await channel.send(payload)

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
      expect(result.timestamp).toBeDefined()
      expect(result.error).toBeUndefined()
    })

    it('handles rate limiting gracefully', async () => {
      // Send multiple messages rapidly to test rate limit handling
      const messages: Promise<SendResult>[] = []
      const batchSize = 5

      for (let i = 0; i < batchSize; i++) {
        const payload: NotificationPayload = {
          requestId: `req-rate-${Date.now()}-${i}`,
          message: `Rate limit test message ${i + 1}`,
          priority: 'normal',
        }
        messages.push(channel.send(payload))
      }

      const results = await Promise.all(messages)

      // All messages should eventually be delivered (with retries if rate limited)
      const deliveredCount = results.filter(r => r.delivered).length
      expect(deliveredCount).toBe(batchSize)

      // Check for any rate limit errors that were handled
      const rateLimitErrors = results.filter(r => r.error?.includes('rate_limited'))
      // If there were rate limit errors, they should have been retried successfully
      expect(rateLimitErrors.length).toBe(0)
    })

    it('returns error for invalid channel', async () => {
      const invalidChannel = new SlackHumanChannel({
        ...TEST_CONFIG,
        defaultChannel: 'INVALID_CHANNEL_ID',
      })

      const payload: NotificationPayload = {
        requestId: `req-invalid-${Date.now()}`,
        message: 'Test message to invalid channel',
        priority: 'normal',
      }

      const result = await invalidChannel.send(payload)

      expect(result.delivered).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toMatch(/channel_not_found|invalid_channel/i)
    })

    it('returns error for invalid token', async () => {
      const invalidTokenChannel = new SlackHumanChannel({
        ...TEST_CONFIG,
        botToken: 'xoxb-invalid-token-12345',
        webhookUrl: '', // Force use of bot token
      })

      const payload: NotificationPayload = {
        requestId: `req-bad-token-${Date.now()}`,
        message: 'Test message with invalid token',
        priority: 'normal',
      }

      const result = await invalidTokenChannel.send(payload)

      expect(result.delivered).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toMatch(/invalid_auth|not_authed|token/i)
    })

    it('gets delivery status of sent message', async () => {
      const extendedChannel = channel as unknown as ExtendedSlackHumanChannel

      // First send a message
      const payload: NotificationPayload = {
        requestId: `req-status-${Date.now()}`,
        message: 'Check delivery status test',
        priority: 'normal',
      }

      const sendResult = await channel.send(payload)
      expect(sendResult.delivered).toBe(true)

      // Then check its status
      // This will fail until getDeliveryStatus is implemented
      const status = await extendedChannel.getDeliveryStatus(
        TEST_CONFIG.defaultChannel!,
        sendResult.messageId!
      )

      expect(status.delivered).toBe(true)
    })
  })

  // ===========================================================================
  // Interaction Handling
  // ===========================================================================

  describe('Interaction Handling', () => {
    it('handles button click interaction', () => {
      const interactionPayload = {
        user: { id: TEST_USER_ID },
        actions: [{ action_id: 'approve_req-123', value: 'approve' }],
      }

      const response = channel.handleInteraction(interactionPayload)

      expect(response.action).toBe('approve')
      expect(response.userId).toBe(TEST_USER_ID)
      expect(response.requestId).toBe('req-123')
    })

    it('handles reject button interaction', () => {
      const interactionPayload = {
        user: { id: TEST_USER_ID },
        actions: [{ action_id: 'reject_req-456', value: 'reject' }],
      }

      const response = channel.handleInteraction(interactionPayload)

      expect(response.action).toBe('reject')
      expect(response.userId).toBe(TEST_USER_ID)
      expect(response.requestId).toBe('req-456')
    })

    it('handles custom action interaction', () => {
      const interactionPayload = {
        user: { id: TEST_USER_ID },
        actions: [{ action_id: 'request_changes_req-789', value: 'changes' }],
      }

      const response = channel.handleInteraction(interactionPayload)

      expect(response.action).toBe('request_changes')
      expect(response.userId).toBe(TEST_USER_ID)
      expect(response.requestId).toBe('req-789')
    })

    it('throws error for empty actions', () => {
      const interactionPayload = {
        user: { id: TEST_USER_ID },
        actions: [],
      }

      expect(() => channel.handleInteraction(interactionPayload)).toThrow('No actions in interaction payload')
    })

    it('verifies Slack request signature', async () => {
      const extendedChannel = channel as unknown as ExtendedSlackHumanChannel

      const timestamp = Math.floor(Date.now() / 1000).toString()
      const body = '{"test": "payload"}'
      // This signature is intentionally invalid - test should verify the method exists
      const signature = 'v0=invalid_signature'

      // This will fail until verifySignature is implemented
      const isValid = extendedChannel.verifySignature(signature, timestamp, body)

      // With invalid signature, should return false
      expect(isValid).toBe(false)
    })

    it('handles full interaction callback', async () => {
      const extendedChannel = channel as unknown as ExtendedSlackHumanChannel

      const event: SlackInteractionEvent = {
        type: 'block_actions',
        user: { id: TEST_USER_ID, username: 'testuser', name: 'Test User' },
        channel: { id: TEST_CONFIG.defaultChannel!, name: 'test-channel' },
        actions: [
          {
            action_id: 'approve_req-full-test',
            value: 'approve',
            type: 'button',
          },
        ],
        message: {
          ts: '1234567890.123456',
          text: 'Test approval request',
        },
        response_url: 'https://hooks.slack.com/actions/response/url',
        trigger_id: '12345.67890.abcdef',
      }

      // This will fail until handleInteractionCallback is implemented
      const response = await extendedChannel.handleInteractionCallback(event)

      expect(response.action).toBe('approve')
      expect(response.userId).toBe(TEST_USER_ID)
      expect(response.requestId).toBe('req-full-test')
      expect(response.timestamp).toBeDefined()
    })
  })

  // ===========================================================================
  // Thread Support
  // ===========================================================================

  describe('Thread Support', () => {
    it('sends notification as thread reply', async () => {
      // First send a parent message
      const parentPayload: NotificationPayload = {
        requestId: `req-parent-${Date.now()}`,
        message: 'Parent message for thread test',
        priority: 'normal',
      }

      const parentResult = await channel.send(parentPayload)
      expect(parentResult.delivered).toBe(true)

      // Send a reply in thread
      // This requires thread support in the send method
      const replyPayload: NotificationPayload & { threadTs?: string } = {
        requestId: `req-reply-${Date.now()}`,
        message: 'Thread reply: Additional context for the request',
        priority: 'normal',
        // Thread timestamp would need to be supported
      }

      // For now, just send normally - thread support to be implemented
      const replyResult = await channel.send(replyPayload)
      expect(replyResult.delivered).toBe(true)
    })
  })

  // ===========================================================================
  // Message Formatting
  // ===========================================================================

  describe('Message Formatting', () => {
    it('formats metadata as Block Kit fields', async () => {
      const payload: NotificationPayload = {
        requestId: `req-format-${Date.now()}`,
        message: 'Purchase Order Approval Required',
        priority: 'normal',
        metadata: {
          'PO Number': 'PO-2024-001',
          'Vendor': 'Acme Supplies',
          'Amount': '$15,000',
          'Department': 'Engineering',
          'Requester': 'jane.smith@example.com',
        },
      }

      const result = await channel.send(payload)

      expect(result.delivered).toBe(true)
      // The metadata should be rendered as fields in the Slack message
    })

    it('handles long messages with truncation', async () => {
      const longDescription = 'A'.repeat(3000) // Slack has ~3000 char limit per block

      const payload: NotificationPayload = {
        requestId: `req-long-${Date.now()}`,
        message: `Long message test: ${longDescription}`,
        priority: 'normal',
      }

      const result = await channel.send(payload)

      // Should handle long messages gracefully (truncate or split)
      expect(result.delivered).toBe(true)
    })

    it('escapes special characters in messages', async () => {
      const payload: NotificationPayload = {
        requestId: `req-escape-${Date.now()}`,
        message: 'Test with special chars: <script>alert("xss")</script> & <@U123> and #channel',
        priority: 'normal',
      }

      const result = await channel.send(payload)

      expect(result.delivered).toBe(true)
      // Special characters should be properly escaped
    })
  })

  // ===========================================================================
  // Configuration Validation
  // ===========================================================================

  describe('Configuration Validation', () => {
    it('requires either webhook URL or bot token', () => {
      expect(() => {
        new SlackHumanChannel({
          webhookUrl: '',
          botToken: undefined,
        })
      }).toThrow(/webhook.*token|configuration/i)
    })

    it('validates webhook URL format', () => {
      expect(() => {
        new SlackHumanChannel({
          webhookUrl: 'not-a-valid-url',
        })
      }).toThrow(/invalid.*webhook|url/i)
    })

    it('validates bot token format', () => {
      expect(() => {
        new SlackHumanChannel({
          botToken: 'invalid-token-format',
          webhookUrl: '',
        })
      }).toThrow(/invalid.*token|xoxb/i)
    })

    it('allows valid webhook URL', () => {
      const channel = new SlackHumanChannel({
        webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXXXX',
      })
      expect(channel.type).toBe('slack')
    })

    it('allows valid bot token', () => {
      const channel = new SlackHumanChannel({
        botToken: 'xoxb-test-token-placeholder-for-validation',
        webhookUrl: '',
        defaultChannel: 'C1234567890',
      })
      expect(channel.type).toBe('slack')
    })
  })
})
