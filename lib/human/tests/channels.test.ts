/**
 * Human Channel Tests
 *
 * Tests for the lib/human/channels module which provides:
 * - Channel interface definitions
 * - Individual channel implementations (Slack, Email, SMS, Discord, Webhook)
 * - Channel factory for creating channels from config
 * - Channel registry for managing multiple channels
 *
 * @module lib/human/tests/channels.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Import from channels index
import {
  type HumanNotificationChannel,
  type ChannelType,
  type NotificationPayload,
  type SendResult,
  type HumanResponse,
  type NotificationAction,
  type Priority,
  SlackHumanChannel,
  EmailHumanChannel,
  SMSHumanChannel,
  DiscordHumanChannel,
  WebhookHumanChannel,
} from '../channels/index'

// Import from channel factory
import {
  createChannel,
  createChannels,
  createChannelRecord,
  isInteractiveChannel,
  supportsNotificationUpdate,
  parseChannelType,
  isValidChannelConfig,
  type ChannelConfig,
} from '../channel-factory'

// Import from channels.ts utilities
import {
  ChannelRegistry,
  buildNotificationPayload,
  sendWithRetry,
  interpolatePrompt,
  generateTaskId,
  HumanChannelError,
  HumanNotificationFailedError,
  DEFAULT_DELIVERY_CONFIG,
  type NotificationBuildOptions,
  type DeliveryConfig,
} from '../channels'

// =============================================================================
// Mock Helpers
// =============================================================================

function createMockFetch(response: { ok: boolean; status: number; json: unknown; headers?: Record<string, string> }): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    json: () => Promise.resolve(response.json),
    headers: {
      get: (name: string) => response.headers?.[name] ?? null,
    },
  }) as unknown as typeof fetch
}

function createBasicPayload(overrides?: Partial<NotificationPayload>): NotificationPayload {
  return {
    requestId: 'req-123',
    message: 'Test notification message',
    priority: 'normal',
    ...overrides,
  }
}

// =============================================================================
// Channel Interface Tests
// =============================================================================

describe('Channel Interface', () => {
  describe('NotificationPayload', () => {
    it('should support basic payload properties', () => {
      const payload: NotificationPayload = {
        requestId: 'req-123',
        message: 'Please approve this request',
        priority: 'high',
      }

      expect(payload.requestId).toBe('req-123')
      expect(payload.message).toBe('Please approve this request')
      expect(payload.priority).toBe('high')
    })

    it('should support optional actions', () => {
      const payload: NotificationPayload = {
        requestId: 'req-123',
        message: 'Approve?',
        actions: [
          { label: 'Approve', value: 'approve', style: 'success' },
          { label: 'Reject', value: 'reject', style: 'danger' },
        ],
      }

      expect(payload.actions).toHaveLength(2)
      expect(payload.actions![0]!.label).toBe('Approve')
    })

    it('should support metadata', () => {
      const payload: NotificationPayload = {
        requestId: 'req-123',
        message: 'Test',
        metadata: { orderId: 'ORD-456', amount: '150.00' },
      }

      expect(payload.metadata?.orderId).toBe('ORD-456')
    })
  })

  describe('SendResult', () => {
    it('should represent successful delivery', () => {
      const result: SendResult = {
        delivered: true,
        messageId: 'msg-123',
        timestamp: new Date().toISOString(),
      }

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBe('msg-123')
    })

    it('should represent failed delivery', () => {
      const result: SendResult = {
        delivered: false,
        error: 'Connection timeout',
        timestamp: new Date().toISOString(),
      }

      expect(result.delivered).toBe(false)
      expect(result.error).toBe('Connection timeout')
    })
  })

  describe('Priority levels', () => {
    it('should support all priority levels', () => {
      const priorities: Priority[] = ['low', 'normal', 'high', 'urgent']

      priorities.forEach((priority) => {
        const payload: NotificationPayload = {
          requestId: 'req-123',
          message: 'Test',
          priority,
        }
        expect(payload.priority).toBe(priority)
      })
    })
  })
})

// =============================================================================
// Slack Channel Tests
// =============================================================================

describe('SlackHumanChannel', () => {
  describe('constructor', () => {
    it('should create channel with webhook URL', () => {
      const channel = new SlackHumanChannel({
        webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
      })

      expect(channel.type).toBe('slack')
    })

    it('should accept optional bot token', () => {
      const channel = new SlackHumanChannel({
        webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
        botToken: 'xoxb-123-456-abc',
        defaultChannel: '#general',
      })

      expect(channel.type).toBe('slack')
    })
  })

  describe('send', () => {
    it('should send notification via webhook', async () => {
      const mockFetch = createMockFetch({
        ok: true,
        status: 200,
        json: { ok: true, ts: '1234567890.123456' },
      })

      const channel = new SlackHumanChannel({
        webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
        fetch: mockFetch,
      })

      const result = await channel.send(createBasicPayload())

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBe('1234567890.123456')
      expect(mockFetch).toHaveBeenCalledOnce()
    })

    it('should include priority indicator for urgent messages', async () => {
      const mockFetch = createMockFetch({
        ok: true,
        status: 200,
        json: { ok: true },
      })

      const channel = new SlackHumanChannel({
        webhookUrl: 'https://hooks.slack.com/test',
        fetch: mockFetch,
      })

      await channel.send(createBasicPayload({ priority: 'urgent' }))

      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body.blocks[0].text.text).toContain(':rotating_light:')
    })

    it('should handle webhook failure gracefully', async () => {
      const mockFetch = createMockFetch({
        ok: false,
        status: 500,
        json: { ok: false, error: 'server_error' },
      })

      const channel = new SlackHumanChannel({
        webhookUrl: 'https://hooks.slack.com/test',
        fetch: mockFetch,
      })

      const result = await channel.send(createBasicPayload())

      expect(result.delivered).toBe(false)
      expect(result.error).toBe('server_error')
    })
  })

  describe('handleInteraction', () => {
    it('should parse button click interaction', () => {
      const channel = new SlackHumanChannel({
        webhookUrl: 'https://hooks.slack.com/test',
      })

      const response = channel.handleInteraction({
        user: { id: 'U123456' },
        actions: [{ action_id: 'approve_req-123', value: 'approve' }],
      })

      expect(response.action).toBe('approve')
      expect(response.userId).toBe('U123456')
      expect(response.requestId).toBe('req-123')
    })
  })
})

// =============================================================================
// Email Channel Tests
// =============================================================================

describe('EmailHumanChannel', () => {
  describe('constructor', () => {
    it('should create channel with SendGrid config', () => {
      const channel = new EmailHumanChannel({
        provider: 'sendgrid',
        apiKey: 'SG.xxx',
        from: 'noreply@example.com',
      })

      expect(channel.type).toBe('email')
    })

    it('should create channel with Resend config', () => {
      const channel = new EmailHumanChannel({
        provider: 'resend',
        apiKey: 're_xxx',
        from: 'noreply@example.com',
      })

      expect(channel.type).toBe('email')
    })
  })

  describe('send', () => {
    it('should send via SendGrid with test key', async () => {
      const channel = new EmailHumanChannel({
        provider: 'sendgrid',
        apiKey: 'SG.test_key',
        from: 'noreply@example.com',
      })

      const result = await channel.send({
        ...createBasicPayload(),
        to: 'user@example.com',
      } as any)

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
    })

    it('should send via Resend with test key', async () => {
      const channel = new EmailHumanChannel({
        provider: 'resend',
        apiKey: 're_test_key',
        from: 'noreply@example.com',
      })

      const result = await channel.send({
        ...createBasicPayload(),
        to: 'user@example.com',
      } as any)

      expect(result.delivered).toBe(true)
    })

    it('should fail without recipient', async () => {
      const channel = new EmailHumanChannel({
        provider: 'sendgrid',
        apiKey: 'SG.xxx',
        from: 'noreply@example.com',
      })

      const result = await channel.send(createBasicPayload())

      expect(result.delivered).toBe(false)
      expect(result.error).toContain('No recipient')
    })

    it('should use default recipient if configured', async () => {
      const channel = new EmailHumanChannel({
        provider: 'sendgrid',
        apiKey: 'SG.test',
        from: 'noreply@example.com',
        defaultTo: 'default@example.com',
      })

      const result = await channel.send(createBasicPayload())

      expect(result.delivered).toBe(true)
    })
  })

  describe('handleWebhook', () => {
    it('should parse email webhook click', () => {
      const channel = new EmailHumanChannel({
        provider: 'sendgrid',
        apiKey: 'SG.xxx',
        from: 'noreply@example.com',
      })

      const parsed = channel.handleWebhook({
        url: 'https://app.example.com/approve/req-123?action=approve',
        email: 'user@example.com',
      })

      expect(parsed.action).toBe('approve')
      expect(parsed.requestId).toBe('req-123')
      expect(parsed.userId).toBe('user@example.com')
    })
  })
})

// =============================================================================
// SMS Channel Tests
// =============================================================================

describe('SMSHumanChannel', () => {
  describe('constructor', () => {
    it('should create Twilio channel', () => {
      const channel = new SMSHumanChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC_test',
        authToken: 'test_token',
      })

      expect(channel.type).toBe('sms')
    })

    it('should validate E.164 phone number format', () => {
      expect(() => {
        new SMSHumanChannel({
          provider: 'twilio',
          fromNumber: '555-123-4567', // Invalid format
          accountSid: 'AC_test',
          authToken: 'test_token',
        })
      }).toThrow('E.164')
    })

    it('should require provider-specific credentials', () => {
      expect(() => {
        new SMSHumanChannel({
          provider: 'twilio',
          fromNumber: '+15551234567',
          // Missing accountSid and authToken
        })
      }).toThrow()
    })
  })

  describe('send', () => {
    it('should send via mock provider', async () => {
      const channel = new SMSHumanChannel({
        provider: 'mock',
        fromNumber: '+15551234567',
      })

      const result = await channel.send({
        ...createBasicPayload(),
        to: '+15559876543',
      } as any)

      expect(result.delivered).toBe(true)
    })

    it('should fail with invalid phone number', async () => {
      const channel = new SMSHumanChannel({
        provider: 'mock',
        fromNumber: '+15551234567',
      })

      const result = await channel.send({
        ...createBasicPayload(),
        to: 'invalid',
      } as any)

      expect(result.delivered).toBe(false)
      expect(result.error).toContain('Invalid')
    })
  })

  describe('handleWebhook', () => {
    it('should parse approval response', () => {
      const channel = new SMSHumanChannel({
        provider: 'mock',
        fromNumber: '+15551234567',
      })

      const response = channel.handleWebhook({
        From: '+15559876543',
        Body: 'yes',
      })

      expect(response?.action).toBe('approve')
      expect(response?.userId).toBe('+15559876543')
    })

    it('should parse rejection response', () => {
      const channel = new SMSHumanChannel({
        provider: 'mock',
        fromNumber: '+15551234567',
      })

      const response = channel.handleWebhook({
        from: '+15559876543',
        body: 'no',
      })

      expect(response?.action).toBe('reject')
    })

    it('should return null for unrecognized response', () => {
      const channel = new SMSHumanChannel({
        provider: 'mock',
        fromNumber: '+15551234567',
      })

      const response = channel.handleWebhook({
        from: '+15559876543',
        body: 'maybe',
      })

      expect(response).toBeNull()
    })
  })
})

// =============================================================================
// Discord Channel Tests
// =============================================================================

describe('DiscordHumanChannel', () => {
  describe('constructor', () => {
    it('should create channel with webhook URL', () => {
      const channel = new DiscordHumanChannel({
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      })

      expect(channel.type).toBe('discord')
    })
  })

  describe('send', () => {
    it('should send notification with embeds', async () => {
      const mockFetch = createMockFetch({
        ok: true,
        status: 200,
        json: { id: 'msg-123' },
      })

      const channel = new DiscordHumanChannel({
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
        fetch: mockFetch,
      })

      const result = await channel.send(createBasicPayload())

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBe('msg-123')
    })

    it('should include priority-based color', async () => {
      const mockFetch = createMockFetch({
        ok: true,
        status: 200,
        json: { id: 'msg-123' },
      })

      const channel = new DiscordHumanChannel({
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
        fetch: mockFetch,
      })

      await channel.send(createBasicPayload({ priority: 'urgent' }))

      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body.embeds[0].color).toBe(0xff0000) // Red for urgent
    })
  })

  describe('handleInteraction', () => {
    it('should parse button click', () => {
      const channel = new DiscordHumanChannel({
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      })

      const response = channel.handleInteraction({
        user: { id: '123456789' },
        data: { custom_id: 'approve_req-123' },
      })

      expect(response.action).toBe('approve')
      expect(response.requestId).toBe('req-123')
    })
  })

  describe('handleReaction', () => {
    it('should parse checkmark as approve', () => {
      const channel = new DiscordHumanChannel({
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      })

      const response = channel.handleReaction({
        emoji: { name: '\u2705' },
        user_id: '123456789',
        message_id: 'msg-123',
      })

      expect(response?.action).toBe('approve')
    })

    it('should return null for unknown emoji', () => {
      const channel = new DiscordHumanChannel({
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      })

      const response = channel.handleReaction({
        emoji: { name: '\uD83D\uDE00' }, // Grinning face
        user_id: '123456789',
        message_id: 'msg-123',
      })

      expect(response).toBeNull()
    })
  })
})

// =============================================================================
// Webhook Channel Tests
// =============================================================================

describe('WebhookHumanChannel', () => {
  describe('constructor', () => {
    it('should create channel with URL', () => {
      const channel = new WebhookHumanChannel({
        url: 'https://internal.example.com/notifications',
      })

      expect(channel.type).toBe('webhook')
    })

    it('should require URL', () => {
      expect(() => {
        new WebhookHumanChannel({
          url: '',
        })
      }).toThrow('URL is required')
    })
  })

  describe('send', () => {
    it('should send notification to webhook', async () => {
      const mockFetch = createMockFetch({
        ok: true,
        status: 200,
        json: { id: 'notif-123' },
      })

      const channel = new WebhookHumanChannel({
        url: 'https://internal.example.com/notifications',
        fetch: mockFetch,
      })

      const result = await channel.send(createBasicPayload())

      expect(result.delivered).toBe(true)
      expect(mockFetch).toHaveBeenCalledOnce()
    })

    it('should include custom headers', async () => {
      const mockFetch = createMockFetch({
        ok: true,
        status: 200,
        json: {},
      })

      const channel = new WebhookHumanChannel({
        url: 'https://internal.example.com/notifications',
        headers: { 'X-API-Key': 'secret' },
        fetch: mockFetch,
      })

      await channel.send(createBasicPayload())

      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(callArgs[1].headers['X-API-Key']).toBe('secret')
    })
  })

  describe('handleCallback', () => {
    it('should parse callback response', () => {
      const channel = new WebhookHumanChannel({
        url: 'https://internal.example.com/notifications',
      })

      const response = channel.handleCallback({
        requestId: 'req-123',
        action: 'approve',
        userId: 'user-456',
        metadata: { notes: 'LGTM' },
      })

      expect(response.action).toBe('approve')
      expect(response.requestId).toBe('req-123')
      expect(response.userId).toBe('user-456')
      expect(response.data?.notes).toBe('LGTM')
    })
  })
})

// =============================================================================
// Channel Factory Tests
// =============================================================================

describe('Channel Factory', () => {
  describe('createChannel', () => {
    it('should create Slack channel', () => {
      const channel = createChannel({
        type: 'slack',
        webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
      })

      expect(channel.type).toBe('slack')
    })

    it('should create Email channel', () => {
      const channel = createChannel({
        type: 'email',
        provider: 'sendgrid',
        apiKey: 'SG.xxx',
        from: 'noreply@example.com',
      })

      expect(channel.type).toBe('email')
    })

    it('should create SMS channel', () => {
      const channel = createChannel({
        type: 'sms',
        provider: 'mock',
        fromNumber: '+15551234567',
      })

      expect(channel.type).toBe('sms')
    })

    it('should create Discord channel', () => {
      const channel = createChannel({
        type: 'discord',
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      })

      expect(channel.type).toBe('discord')
    })

    it('should create Webhook channel', () => {
      const channel = createChannel({
        type: 'webhook',
        url: 'https://example.com/webhook',
      })

      expect(channel.type).toBe('webhook')
    })

    it('should throw for unknown channel type', () => {
      expect(() => {
        createChannel({ type: 'unknown' } as any)
      }).toThrow('Unknown channel type')
    })
  })

  describe('createChannels', () => {
    it('should create multiple channels as Map', () => {
      const channels = createChannels([
        { type: 'slack', webhookUrl: 'https://hooks.slack.com/test' },
        { type: 'discord', webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
      ])

      expect(channels.size).toBe(2)
      expect(channels.get('slack')?.type).toBe('slack')
      expect(channels.get('discord')?.type).toBe('discord')
    })
  })

  describe('createChannelRecord', () => {
    it('should create channels as object', () => {
      const channels = createChannelRecord([
        { type: 'slack', webhookUrl: 'https://hooks.slack.com/test' },
        { type: 'webhook', url: 'https://example.com/webhook' },
      ])

      expect(channels.slack?.type).toBe('slack')
      expect(channels.webhook?.type).toBe('webhook')
    })
  })

  describe('parseChannelType', () => {
    it('should parse valid channel types', () => {
      expect(parseChannelType('slack')).toBe('slack')
      expect(parseChannelType('email')).toBe('email')
      expect(parseChannelType('sms')).toBe('sms')
      expect(parseChannelType('discord')).toBe('discord')
      expect(parseChannelType('webhook')).toBe('webhook')
    })

    it('should throw for invalid channel type', () => {
      expect(() => parseChannelType('invalid')).toThrow('Invalid channel type')
    })
  })

  describe('isValidChannelConfig', () => {
    it('should validate channel config', () => {
      expect(isValidChannelConfig({ type: 'slack', webhookUrl: '...' })).toBe(true)
      expect(isValidChannelConfig({ type: 'invalid' })).toBe(false)
      expect(isValidChannelConfig(null)).toBe(false)
      expect(isValidChannelConfig('string')).toBe(false)
    })
  })
})

// =============================================================================
// Channel Registry Tests
// =============================================================================

describe('ChannelRegistry', () => {
  let registry: ChannelRegistry

  beforeEach(() => {
    registry = new ChannelRegistry()
  })

  describe('register', () => {
    it('should register a channel', () => {
      const config = {
        name: 'slack',
        type: 'slack' as const,
        send: vi.fn(),
        waitForResponse: vi.fn(),
      }

      registry.register('slack', config)

      expect(registry.has('slack')).toBe(true)
    })
  })

  describe('get', () => {
    it('should retrieve registered channel', () => {
      const config = {
        name: 'slack',
        type: 'slack' as const,
        send: vi.fn(),
        waitForResponse: vi.fn(),
      }

      registry.register('slack', config)

      expect(registry.get('slack')).toBe(config)
    })

    it('should return undefined for unregistered channel', () => {
      expect(registry.get('unknown')).toBeUndefined()
    })
  })

  describe('names', () => {
    it('should return all registered channel names', () => {
      registry.register('slack', { name: 'slack', type: 'slack' as const, send: vi.fn(), waitForResponse: vi.fn() })
      registry.register('email', { name: 'email', type: 'email' as const, send: vi.fn(), waitForResponse: vi.fn() })

      const names = registry.names()

      expect(names).toContain('slack')
      expect(names).toContain('email')
    })
  })

  describe('validateChannels', () => {
    it('should validate existing channels', () => {
      registry.register('slack', { name: 'slack', type: 'slack' as const, send: vi.fn(), waitForResponse: vi.fn() })

      expect(() => registry.validateChannels('slack')).not.toThrow()
      expect(() => registry.validateChannels(['slack'])).not.toThrow()
    })

    it('should throw for unknown channels', () => {
      expect(() => registry.validateChannels('unknown')).toThrow(HumanChannelError)
    })
  })
})

// =============================================================================
// Utility Functions Tests
// =============================================================================

describe('Channel Utilities', () => {
  describe('buildNotificationPayload', () => {
    it('should build basic payload', () => {
      const payload = buildNotificationPayload({
        message: 'Test message',
        channelName: 'slack',
        requestId: 'req-123',
      })

      expect(payload.message).toBe('Test message')
      expect(payload.channel).toBe('slack')
      expect(payload.requestId).toBe('req-123')
    })

    it('should convert string actions to NotificationAction', () => {
      const payload = buildNotificationPayload({
        message: 'Test',
        channelName: 'slack',
        actions: ['approve', 'reject'],
      })

      expect(payload.actions).toHaveLength(2)
      expect(payload.actions![0]).toEqual({ text: 'approve', value: 'approve' })
    })

    it('should handle object actions', () => {
      const payload = buildNotificationPayload({
        message: 'Test',
        channelName: 'slack',
        actions: [
          { value: 'approve', label: 'Yes, approve', style: 'primary' },
        ],
      })

      expect(payload.actions![0]).toEqual({ text: 'Yes, approve', value: 'approve', style: 'primary' })
    })

    it('should apply slack-specific options', () => {
      const payload = buildNotificationPayload({
        message: 'Test',
        channelName: 'slack',
        channelOptions: {
          slackChannel: '#approvals',
          mentionUsers: ['@user1'],
        },
      })

      expect(payload.channel).toBe('#approvals')
      expect(payload.mentions).toEqual(['@user1'])
    })

    it('should apply email-specific options', () => {
      const payload = buildNotificationPayload({
        message: 'Test',
        channelName: 'email',
        channelOptions: {
          to: 'user@example.com',
          subject: 'Approval needed',
          contentType: 'html',
        },
      })

      expect(payload.to).toBe('user@example.com')
      expect(payload.subject).toBe('Approval needed')
      expect(payload.contentType).toBe('html')
    })
  })

  describe('sendWithRetry', () => {
    it('should send successfully on first attempt', async () => {
      const channel = {
        name: 'test',
        type: 'slack' as const,
        send: vi.fn().mockResolvedValue({ messageId: 'msg-123' }),
        waitForResponse: vi.fn(),
      }

      const result = await sendWithRetry(channel, { message: 'Test', requestId: 'req-123' })

      expect(result.messageId).toBe('msg-123')
      expect(result.retries).toBe(0)
      expect(channel.send).toHaveBeenCalledOnce()
    })

    it('should retry on failure', async () => {
      const channel = {
        name: 'test',
        type: 'slack' as const,
        send: vi.fn()
          .mockRejectedValueOnce(new Error('Network error'))
          .mockResolvedValueOnce({ messageId: 'msg-123' }),
        waitForResponse: vi.fn(),
      }

      const result = await sendWithRetry(channel, { message: 'Test', requestId: 'req-123' }, { maxRetries: 3 })

      expect(result.messageId).toBe('msg-123')
      expect(result.retries).toBe(1)
    })

    it('should throw after max retries', async () => {
      const channel = {
        name: 'test',
        type: 'slack' as const,
        send: vi.fn().mockRejectedValue(new Error('Network error')),
        waitForResponse: vi.fn(),
      }

      await expect(
        sendWithRetry(channel, { message: 'Test', requestId: 'req-123' }, { maxRetries: 2, retryDelay: 1 })
      ).rejects.toThrow(HumanNotificationFailedError)

      expect(channel.send).toHaveBeenCalledTimes(2)
    })
  })

  describe('interpolatePrompt', () => {
    it('should replace template variables', () => {
      const result = interpolatePrompt(
        'Approve refund of ${{amount}} for order {{orderId}}?',
        { amount: 150, orderId: 'ORD-123' }
      )

      expect(result).toBe('Approve refund of $150 for order ORD-123?')
    })

    it('should preserve missing variables', () => {
      const result = interpolatePrompt('Hello {{name}}, your balance is {{balance}}', { name: 'Alice' })

      expect(result).toBe('Hello Alice, your balance is {{balance}}')
    })

    it('should handle empty input', () => {
      const result = interpolatePrompt('No variables here', {})

      expect(result).toBe('No variables here')
    })
  })

  describe('generateTaskId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateTaskId()
      const id2 = generateTaskId()

      expect(id1).not.toBe(id2)
      expect(id1).toMatch(/^task-\d+-[a-z0-9]+$/)
    })
  })

  describe('DEFAULT_DELIVERY_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_DELIVERY_CONFIG.maxRetries).toBe(1)
      expect(DEFAULT_DELIVERY_CONFIG.retryDelay).toBe(1000)
      expect(DEFAULT_DELIVERY_CONFIG.backoff).toBe('fixed')
    })
  })
})

// =============================================================================
// Error Classes Tests
// =============================================================================

describe('Error Classes', () => {
  describe('HumanChannelError', () => {
    it('should have correct name', () => {
      const error = new HumanChannelError('Channel not found')
      expect(error.name).toBe('HumanChannelError')
      expect(error.message).toBe('Channel not found')
    })
  })

  describe('HumanNotificationFailedError', () => {
    it('should have correct name', () => {
      const error = new HumanNotificationFailedError('Delivery failed')
      expect(error.name).toBe('HumanNotificationFailedError')
      expect(error.message).toBe('Delivery failed')
    })
  })
})
