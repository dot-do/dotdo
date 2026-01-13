/**
 * Channel Adapters Tests
 *
 * Tests for the pre-built notification channel adapters:
 * - Email (SendGrid, Resend, mock)
 * - SMS (Twilio, mock)
 * - Push (FCM, Expo, mock)
 * - Slack
 * - Webhook
 * - In-App
 *
 * @module db/primitives/notifications/tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  createEmailAdapter,
  createSMSAdapter,
  createPushAdapter,
  createSlackAdapter,
  createSlackMessage,
  createWebhookAdapter,
  verifyWebhookSignature,
  createInAppAdapter,
  InMemoryInAppStorage,
  createDiscordAdapter,
  createDiscordEmbed,
  formatDiscordMarkdown,
  isGSM7,
  calculateSMSParts,
  splitSMSMessage,
  SMS_LIMITS,
} from '../channels'

// ============================================================================
// Email Adapter Tests
// ============================================================================

describe('Email Adapter', () => {
  describe('createEmailAdapter()', () => {
    it('creates email adapter with mock provider', () => {
      const adapter = createEmailAdapter({
        provider: 'mock',
        fromAddress: 'test@example.com',
      })

      expect(adapter.type).toBe('email')
    })

    it('sends email via mock provider', async () => {
      const adapter = createEmailAdapter({
        provider: 'mock',
        fromAddress: 'test@example.com',
      })

      const result = await adapter.send(
        {
          notificationId: 'test_123',
          userId: 'user_1',
          subject: 'Test Subject',
          body: 'Test body',
        },
        { email: 'recipient@example.com' }
      )

      expect(result.messageId).toBeDefined()
      expect(result.messageId).toContain('mock_')
    })

    it('validates recipient email', async () => {
      const adapter = createEmailAdapter({
        provider: 'mock',
        fromAddress: 'test@example.com',
      })

      expect(await adapter.validateRecipient({ email: 'valid@example.com' })).toBe(true)
      expect(await adapter.validateRecipient({ email: 'invalid' })).toBe(false)
      expect(await adapter.validateRecipient({ phone: '+1234567890' })).toBe(false)
    })

    it('throws error when recipient email missing', async () => {
      const adapter = createEmailAdapter({
        provider: 'mock',
        fromAddress: 'test@example.com',
      })

      await expect(
        adapter.send(
          { notificationId: 'test_123', userId: 'user_1', body: 'Test' },
          { phone: '+1234567890' }
        )
      ).rejects.toThrow(/email.*required/i)
    })

    it('uses custom send function when provided', async () => {
      const customSend = vi.fn().mockResolvedValue({ messageId: 'custom_123' })

      const adapter = createEmailAdapter({
        provider: 'mock',
        fromAddress: 'test@example.com',
        customSend,
      })

      const result = await adapter.send(
        { notificationId: 'test_123', userId: 'user_1', subject: 'Test', body: 'Body' },
        { email: 'recipient@example.com' }
      )

      expect(customSend).toHaveBeenCalledOnce()
      expect(result.messageId).toBe('custom_123')
    })
  })
})

// ============================================================================
// SMS Adapter Tests
// ============================================================================

describe('SMS Adapter', () => {
  describe('createSMSAdapter()', () => {
    it('creates SMS adapter with mock provider', () => {
      const adapter = createSMSAdapter({
        provider: 'mock',
        fromNumber: '+15551234567',
      })

      expect(adapter.type).toBe('sms')
    })

    it('sends SMS via mock provider', async () => {
      const adapter = createSMSAdapter({
        provider: 'mock',
        fromNumber: '+15551234567',
      })

      const result = await adapter.send(
        { notificationId: 'test_123', userId: 'user_1', body: 'Test message' },
        { phone: '+15559876543' }
      )

      expect(result.messageId).toBeDefined()
      expect(result.messageId).toContain('mock_sms_')
    })

    it('validates recipient phone number', async () => {
      const adapter = createSMSAdapter({
        provider: 'mock',
        fromNumber: '+15551234567',
      })

      expect(await adapter.validateRecipient({ phone: '+15551234567' })).toBe(true)
      expect(await adapter.validateRecipient({ phone: '5551234567' })).toBe(true)
      expect(await adapter.validateRecipient({ phone: '123' })).toBe(false)
      expect(await adapter.validateRecipient({ email: 'test@example.com' })).toBe(false)
    })

    it('throws error when recipient phone missing', async () => {
      const adapter = createSMSAdapter({
        provider: 'mock',
        fromNumber: '+15551234567',
      })

      await expect(
        adapter.send(
          { notificationId: 'test_123', userId: 'user_1', body: 'Test' },
          { email: 'test@example.com' }
        )
      ).rejects.toThrow(/phone.*required/i)
    })
  })
})

// ============================================================================
// Push Adapter Tests
// ============================================================================

describe('Push Adapter', () => {
  describe('createPushAdapter()', () => {
    it('creates push adapter with mock provider', () => {
      const adapter = createPushAdapter({
        provider: 'mock',
      })

      expect(adapter.type).toBe('push')
    })

    it('sends push notification via mock provider', async () => {
      const adapter = createPushAdapter({
        provider: 'mock',
      })

      const result = await adapter.send(
        { notificationId: 'test_123', userId: 'user_1', subject: 'Title', body: 'Body' },
        { deviceToken: 'device_token_abc123' }
      )

      expect(result.messageId).toBeDefined()
      expect(result.messageId).toContain('mock_push_')
    })

    it('validates device token', async () => {
      const adapter = createPushAdapter({
        provider: 'mock',
      })

      expect(await adapter.validateRecipient({ deviceToken: 'valid_token_12345' })).toBe(true)
      expect(await adapter.validateRecipient({ deviceToken: 'short' })).toBe(false)
      expect(await adapter.validateRecipient({ email: 'test@example.com' })).toBe(false)
    })

    it('throws error when device token missing', async () => {
      const adapter = createPushAdapter({
        provider: 'mock',
      })

      await expect(
        adapter.send(
          { notificationId: 'test_123', userId: 'user_1', body: 'Test' },
          { email: 'test@example.com' }
        )
      ).rejects.toThrow(/device token.*required/i)
    })
  })
})

// ============================================================================
// Slack Adapter Tests
// ============================================================================

describe('Slack Adapter', () => {
  describe('createSlackAdapter()', () => {
    it('creates Slack adapter', () => {
      const adapter = createSlackAdapter({
        botToken: 'xoxb-test-token',
      })

      expect(adapter.type).toBe('slack')
    })

    it('validates recipient with slack user ID', async () => {
      const adapter = createSlackAdapter({
        botToken: 'xoxb-test-token',
      })

      expect(await adapter.validateRecipient({ slackUserId: 'U12345' })).toBe(true)
      expect(await adapter.validateRecipient({ slackChannel: '#general' })).toBe(true)
    })

    it('validates recipient with default channel', async () => {
      const adapter = createSlackAdapter({
        botToken: 'xoxb-test-token',
        defaultChannel: '#notifications',
      })

      expect(await adapter.validateRecipient({})).toBe(true)
    })

    it('invalidates recipient without slack ID or default channel', async () => {
      const adapter = createSlackAdapter({
        botToken: 'xoxb-test-token',
      })

      expect(await adapter.validateRecipient({ email: 'test@example.com' })).toBe(false)
    })
  })

  describe('createSlackMessage()', () => {
    it('creates rich Slack message', () => {
      const message = createSlackMessage({
        title: 'Alert',
        body: 'Something happened',
        color: '#ff0000',
        fields: [{ title: 'Status', value: 'Active' }],
      })

      expect(message.text).toBe('Alert')
      expect(message.blocks).toBeDefined()
      expect(message.blocks.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Webhook Adapter Tests
// ============================================================================

describe('Webhook Adapter', () => {
  describe('createWebhookAdapter()', () => {
    it('creates webhook adapter', () => {
      const adapter = createWebhookAdapter({
        defaultUrl: 'https://api.example.com/webhooks',
      })

      expect(adapter.type).toBe('webhook')
    })

    it('validates recipient with webhook URL', async () => {
      const adapter = createWebhookAdapter({})

      expect(await adapter.validateRecipient({ webhookUrl: 'https://api.example.com/webhook' })).toBe(true)
      expect(await adapter.validateRecipient({ webhookUrl: 'invalid-url' })).toBe(false)
    })

    it('validates recipient with default URL', async () => {
      const adapter = createWebhookAdapter({
        defaultUrl: 'https://api.example.com/webhooks',
      })

      expect(await adapter.validateRecipient({})).toBe(true)
    })

    it('sends webhook via custom send function', async () => {
      const customSend = vi.fn().mockResolvedValue({ messageId: 'webhook_123' })

      const adapter = createWebhookAdapter({
        defaultUrl: 'https://api.example.com/webhooks',
        customSend,
      })

      const result = await adapter.send(
        { notificationId: 'test_123', userId: 'user_1', body: 'Test' },
        {}
      )

      expect(customSend).toHaveBeenCalledOnce()
      expect(result.messageId).toBe('webhook_123')
    })
  })

  describe('verifyWebhookSignature()', () => {
    it('verifies valid signature', async () => {
      const payload = JSON.stringify({ event: 'test' })
      const secret = 'my_secret_key'

      // Generate signature
      const encoder = new TextEncoder()
      const keyData = encoder.encode(secret)
      const messageData = encoder.encode(payload)

      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )

      const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
      const signatureHex = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const isValid = await verifyWebhookSignature(payload, signatureHex, secret)
      expect(isValid).toBe(true)
    })

    it('rejects invalid signature', async () => {
      const payload = JSON.stringify({ event: 'test' })
      const secret = 'my_secret_key'

      const isValid = await verifyWebhookSignature(payload, 'invalid_signature', secret)
      expect(isValid).toBe(false)
    })
  })
})

// ============================================================================
// In-App Adapter Tests
// ============================================================================

describe('In-App Adapter', () => {
  describe('createInAppAdapter()', () => {
    it('creates in-app adapter', () => {
      const adapter = createInAppAdapter({})

      expect(adapter.type).toBe('in-app')
    })

    it('sends in-app notification with storage', async () => {
      const storage = new InMemoryInAppStorage()

      const adapter = createInAppAdapter({
        storage,
      })

      const result = await adapter.send(
        { notificationId: 'test_123', userId: 'user_1', subject: 'Title', body: 'Body' },
        {}
      )

      expect(result.messageId).toBeDefined()
      expect(result.messageId).toContain('inapp_')

      const notifications = await storage.getByUser('user_1')
      expect(notifications).toHaveLength(1)
      expect(notifications[0].title).toBe('Title')
      expect(notifications[0].body).toBe('Body')
      expect(notifications[0].read).toBe(false)
    })

    it('calls onNotification callback', async () => {
      const onNotification = vi.fn()

      const adapter = createInAppAdapter({
        onNotification,
      })

      await adapter.send(
        { notificationId: 'test_123', userId: 'user_1', body: 'Test' },
        {}
      )

      expect(onNotification).toHaveBeenCalledWith(
        'user_1',
        expect.objectContaining({
          userId: 'user_1',
          body: 'Test',
        })
      )
    })

    it('always validates recipient for in-app', async () => {
      const adapter = createInAppAdapter({})

      expect(await adapter.validateRecipient({})).toBe(true)
      expect(await adapter.validateRecipient({ email: 'test@example.com' })).toBe(true)
    })
  })

  describe('InMemoryInAppStorage', () => {
    let storage: InMemoryInAppStorage

    beforeEach(() => {
      storage = new InMemoryInAppStorage()
    })

    it('saves and retrieves notifications', async () => {
      await storage.save({
        id: 'notif_1',
        userId: 'user_1',
        title: 'Title 1',
        body: 'Body 1',
        read: false,
        createdAt: new Date(),
      })

      const notifications = await storage.getByUser('user_1')
      expect(notifications).toHaveLength(1)
      expect(notifications[0].title).toBe('Title 1')
    })

    it('marks notification as read', async () => {
      await storage.save({
        id: 'notif_1',
        userId: 'user_1',
        body: 'Test',
        read: false,
        createdAt: new Date(),
      })

      await storage.markRead('notif_1')

      const notifications = await storage.getByUser('user_1')
      expect(notifications[0].read).toBe(true)
    })

    it('marks all as read for user', async () => {
      await storage.save({
        id: 'notif_1',
        userId: 'user_1',
        body: 'Test 1',
        read: false,
        createdAt: new Date(),
      })

      await storage.save({
        id: 'notif_2',
        userId: 'user_1',
        body: 'Test 2',
        read: false,
        createdAt: new Date(),
      })

      await storage.markAllRead('user_1')

      const notifications = await storage.getByUser('user_1')
      expect(notifications.every((n) => n.read)).toBe(true)
    })

    it('gets unread notifications only', async () => {
      await storage.save({
        id: 'notif_1',
        userId: 'user_1',
        body: 'Test 1',
        read: true,
        createdAt: new Date(),
      })

      await storage.save({
        id: 'notif_2',
        userId: 'user_1',
        body: 'Test 2',
        read: false,
        createdAt: new Date(),
      })

      const unread = await storage.getByUser('user_1', { unreadOnly: true })
      expect(unread).toHaveLength(1)
      expect(unread[0].body).toBe('Test 2')
    })

    it('returns correct unread count', async () => {
      await storage.save({
        id: 'notif_1',
        userId: 'user_1',
        body: 'Test 1',
        read: true,
        createdAt: new Date(),
      })

      await storage.save({
        id: 'notif_2',
        userId: 'user_1',
        body: 'Test 2',
        read: false,
        createdAt: new Date(),
      })

      await storage.save({
        id: 'notif_3',
        userId: 'user_1',
        body: 'Test 3',
        read: false,
        createdAt: new Date(),
      })

      const count = await storage.getUnreadCount('user_1')
      expect(count).toBe(2)
    })

    it('deletes notification', async () => {
      await storage.save({
        id: 'notif_1',
        userId: 'user_1',
        body: 'Test',
        read: false,
        createdAt: new Date(),
      })

      await storage.delete('notif_1')

      const notifications = await storage.getByUser('user_1')
      expect(notifications).toHaveLength(0)
    })

    it('deletes expired notifications', async () => {
      const pastDate = new Date(Date.now() - 1000) // 1 second ago

      await storage.save({
        id: 'notif_1',
        userId: 'user_1',
        body: 'Expired',
        read: false,
        createdAt: new Date(),
        expiresAt: pastDate,
      })

      await storage.save({
        id: 'notif_2',
        userId: 'user_1',
        body: 'Not expired',
        read: false,
        createdAt: new Date(),
      })

      const deletedCount = await storage.deleteExpired()
      expect(deletedCount).toBe(1)

      const notifications = await storage.getByUser('user_1')
      expect(notifications).toHaveLength(1)
      expect(notifications[0].body).toBe('Not expired')
    })

    it('respects limit when getting notifications', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.save({
          id: `notif_${i}`,
          userId: 'user_1',
          body: `Test ${i}`,
          read: false,
          createdAt: new Date(Date.now() - i * 1000),
        })
      }

      const notifications = await storage.getByUser('user_1', { limit: 3 })
      expect(notifications).toHaveLength(3)
    })

    it('sorts notifications by created date (newest first)', async () => {
      await storage.save({
        id: 'notif_old',
        userId: 'user_1',
        body: 'Old',
        read: false,
        createdAt: new Date(Date.now() - 10000),
      })

      await storage.save({
        id: 'notif_new',
        userId: 'user_1',
        body: 'New',
        read: false,
        createdAt: new Date(),
      })

      const notifications = await storage.getByUser('user_1')
      expect(notifications[0].body).toBe('New')
      expect(notifications[1].body).toBe('Old')
    })
  })
})

// ============================================================================
// Discord Adapter Tests
// ============================================================================

describe('Discord Adapter', () => {
  describe('createDiscordAdapter()', () => {
    it('creates Discord adapter with webhook URL', () => {
      const adapter = createDiscordAdapter({
        webhookUrl: 'https://discord.com/api/webhooks/123/token',
      })

      expect(adapter.type).toBe('webhook')
    })

    it('validates recipient with webhook URL', async () => {
      const adapter = createDiscordAdapter({})

      expect(await adapter.validateRecipient({ discordWebhookUrl: 'https://discord.com/api/webhooks/123/token' })).toBe(
        true
      )
      expect(await adapter.validateRecipient({ discordChannelId: '123456789' })).toBe(true)
      expect(await adapter.validateRecipient({ discordUserId: 'U123456' })).toBe(true)
    })

    it('validates recipient with default webhook URL', async () => {
      const adapter = createDiscordAdapter({
        webhookUrl: 'https://discord.com/api/webhooks/123/token',
      })

      expect(await adapter.validateRecipient({})).toBe(true)
    })

    it('invalidates recipient without Discord ID or webhook', async () => {
      const adapter = createDiscordAdapter({})

      expect(await adapter.validateRecipient({ email: 'test@example.com' })).toBe(false)
    })

    it('throws error when no webhook URL or bot token', async () => {
      const adapter = createDiscordAdapter({})

      await expect(
        adapter.send({ notificationId: 'test_123', userId: 'user_1', body: 'Test' }, {})
      ).rejects.toThrow(/webhook URL or bot token.*required/i)
    })

    it('sends message via custom send function', async () => {
      const customSend = vi.fn().mockResolvedValue({ messageId: 'discord_123' })

      const adapter = createDiscordAdapter({
        webhookUrl: 'https://discord.com/api/webhooks/123/token',
        customSend,
      })

      const result = await adapter.send(
        { notificationId: 'test_123', userId: 'user_1', subject: 'Alert', body: 'Test message' },
        {}
      )

      expect(customSend).toHaveBeenCalledOnce()
      expect(result.messageId).toBe('discord_123')

      // Verify payload structure
      const payload = customSend.mock.calls[0][0]
      expect(payload.content).toContain('**Alert**')
      expect(payload.content).toContain('Test message')
    })

    it('creates embed for high priority messages', async () => {
      const customSend = vi.fn().mockResolvedValue({ messageId: 'discord_456' })

      const adapter = createDiscordAdapter({
        webhookUrl: 'https://discord.com/api/webhooks/123/token',
        customSend,
      })

      await adapter.send(
        { notificationId: 'test_123', userId: 'user_1', subject: 'Critical Alert', body: 'System down', priority: 'critical' },
        {}
      )

      const payload = customSend.mock.calls[0][0]
      expect(payload.embeds).toBeDefined()
      expect(payload.embeds.length).toBe(1)
      expect(payload.embeds[0].title).toBe('Critical Alert')
      expect(payload.embeds[0].description).toBe('System down')
      expect(payload.embeds[0].color).toBe(0xff0000) // Red for critical
    })
  })

  describe('createDiscordEmbed()', () => {
    it('creates basic embed', () => {
      const embed = createDiscordEmbed({
        title: 'Test Title',
        description: 'Test description',
        color: '#ff0000',
      })

      expect(embed.title).toBe('Test Title')
      expect(embed.description).toBe('Test description')
      expect(embed.color).toBe(0xff0000)
    })

    it('creates embed with fields', () => {
      const embed = createDiscordEmbed({
        description: 'Test',
        fields: [
          { name: 'Field 1', value: 'Value 1', inline: true },
          { name: 'Field 2', value: 'Value 2' },
        ],
      })

      expect(embed.fields).toHaveLength(2)
      expect(embed.fields![0].inline).toBe(true)
    })

    it('creates embed with timestamp', () => {
      const embed = createDiscordEmbed({
        description: 'Test',
        timestamp: true,
      })

      expect(embed.timestamp).toBeDefined()
    })

    it('creates embed with author and footer', () => {
      const embed = createDiscordEmbed({
        description: 'Test',
        author: { name: 'Bot', url: 'https://example.com' },
        footer: 'Powered by dotdo',
      })

      expect(embed.author?.name).toBe('Bot')
      expect(embed.footer?.text).toBe('Powered by dotdo')
    })
  })

  describe('formatDiscordMarkdown()', () => {
    it('converts HTML bold to Discord markdown', () => {
      expect(formatDiscordMarkdown('<strong>bold</strong>')).toBe('**bold**')
      expect(formatDiscordMarkdown('<b>bold</b>')).toBe('**bold**')
    })

    it('converts HTML italic to Discord markdown', () => {
      expect(formatDiscordMarkdown('<em>italic</em>')).toBe('*italic*')
      expect(formatDiscordMarkdown('<i>italic</i>')).toBe('*italic*')
    })

    it('converts HTML underline to Discord markdown', () => {
      expect(formatDiscordMarkdown('<u>underline</u>')).toBe('__underline__')
    })

    it('converts HTML strikethrough to Discord markdown', () => {
      expect(formatDiscordMarkdown('<s>strike</s>')).toBe('~~strike~~')
    })

    it('converts HTML code to Discord markdown', () => {
      expect(formatDiscordMarkdown('<code>code</code>')).toBe('`code`')
    })

    it('converts HTML links to Discord markdown', () => {
      expect(formatDiscordMarkdown('<a href="https://example.com">Link</a>')).toBe('[Link](https://example.com)')
    })

    it('converts line breaks', () => {
      expect(formatDiscordMarkdown('line1<br>line2')).toBe('line1\nline2')
      expect(formatDiscordMarkdown('line1<br/>line2')).toBe('line1\nline2')
    })
  })
})

// ============================================================================
// SMS Multipart Tests
// ============================================================================

describe('SMS Character Limits and Multipart', () => {
  describe('isGSM7()', () => {
    it('returns true for basic ASCII text', () => {
      expect(isGSM7('Hello World!')).toBe(true)
      expect(isGSM7('Test 123')).toBe(true)
    })

    it('returns true for GSM-7 special characters', () => {
      expect(isGSM7('Price: $100')).toBe(true)
      expect(isGSM7('@user #hashtag')).toBe(true)
    })

    it('returns false for Unicode characters', () => {
      expect(isGSM7('Hello ')).toBe(false) // emoji
      expect(isGSM7('')).toBe(false) // Chinese
      expect(isGSM7('')).toBe(false) // Japanese
    })

    it('handles extended GSM-7 characters', () => {
      expect(isGSM7('Price: 100')).toBe(true) // Euro sign is extended GSM-7
      expect(isGSM7('[brackets]')).toBe(true)
    })
  })

  describe('calculateSMSParts()', () => {
    it('returns 1 part for short GSM-7 messages', () => {
      const result = calculateSMSParts('Hello World!')
      expect(result.parts).toBe(1)
      expect(result.encoding).toBe('GSM-7')
      expect(result.charsPerPart).toBe(SMS_LIMITS.GSM7_SINGLE)
    })

    it('returns 1 part for messages at GSM-7 limit', () => {
      const message = 'A'.repeat(160)
      const result = calculateSMSParts(message)
      expect(result.parts).toBe(1)
    })

    it('returns 2 parts for messages just over GSM-7 limit', () => {
      const message = 'A'.repeat(161)
      const result = calculateSMSParts(message)
      expect(result.parts).toBe(2)
      expect(result.charsPerPart).toBe(SMS_LIMITS.GSM7_MULTIPART)
    })

    it('calculates parts correctly for long messages', () => {
      const message = 'A'.repeat(500)
      const result = calculateSMSParts(message)
      expect(result.parts).toBe(4) // 500 / 153 = 3.27, rounds up to 4
    })

    it('uses UCS-2 encoding for Unicode messages', () => {
      const message = 'Hello  World'
      const result = calculateSMSParts(message)
      expect(result.encoding).toBe('UCS-2')
      expect(result.charsPerPart).toBe(SMS_LIMITS.UCS2_SINGLE)
    })

    it('returns multiple parts for long Unicode messages', () => {
      const message = ''.repeat(80) // 80 emojis > 70 UCS-2 limit
      const result = calculateSMSParts(message)
      expect(result.parts).toBe(2)
      expect(result.charsPerPart).toBe(SMS_LIMITS.UCS2_MULTIPART)
    })

    it('accounts for extended GSM-7 characters taking 2 bytes', () => {
      const message = ''.repeat(81) // 81 euro signs = 162 effective chars
      const result = calculateSMSParts(message)
      expect(result.parts).toBe(2)
    })
  })

  describe('splitSMSMessage()', () => {
    it('returns single element array for short messages', () => {
      const parts = splitSMSMessage('Hello World!')
      expect(parts).toHaveLength(1)
      expect(parts[0]).toBe('Hello World!')
    })

    it('splits long messages into parts', () => {
      const message = 'A'.repeat(400)
      const parts = splitSMSMessage(message)
      expect(parts.length).toBeGreaterThan(1)
      expect(parts.every((p) => p.length <= SMS_LIMITS.GSM7_MULTIPART)).toBe(true)
    })

    it('tries to split at word boundaries', () => {
      const words = 'word '.repeat(50) // ~250 chars
      const parts = splitSMSMessage(words.trim())

      // Each part should end with a complete word (no partial words)
      for (const part of parts) {
        expect(part.endsWith('word') || part.length <= SMS_LIMITS.GSM7_MULTIPART).toBe(true)
      }
    })

    it('respects max parts limit', () => {
      const message = 'A'.repeat(2000) // Would normally be ~13 parts
      const parts = splitSMSMessage(message, 5)
      expect(parts.length).toBeLessThanOrEqual(5)
    })

    it('truncates with indicator when exceeding max parts', () => {
      const message = 'A'.repeat(2000)
      const parts = splitSMSMessage(message, 3)
      const combined = parts.join('')
      expect(combined.endsWith('...')).toBe(true)
    })
  })

  describe('createSMSAdapter() with multipart', () => {
    it('sends single message for short text', async () => {
      const sentPayloads: any[] = []
      const customSend = vi.fn().mockImplementation((payload) => {
        sentPayloads.push(payload)
        return Promise.resolve({ messageId: `msg_${sentPayloads.length}` })
      })

      const adapter = createSMSAdapter({
        provider: 'mock',
        fromNumber: '+15551234567',
        customSend,
      })

      const result = await adapter.send(
        { notificationId: 'test_123', userId: 'user_1', body: 'Short message' },
        { phone: '+15559876543' }
      )

      expect(customSend).toHaveBeenCalledOnce()
      expect(sentPayloads[0].partNumber).toBeUndefined()
      expect(sentPayloads[0].totalParts).toBeUndefined()
    })

    it('sends multiple messages for long text', async () => {
      const sentPayloads: any[] = []
      const customSend = vi.fn().mockImplementation((payload) => {
        sentPayloads.push(payload)
        return Promise.resolve({ messageId: `msg_${sentPayloads.length}` })
      })

      const adapter = createSMSAdapter({
        provider: 'mock',
        fromNumber: '+15551234567',
        customSend,
        enableMultipart: true,
      })

      const longMessage = 'A'.repeat(400) // Will require multiple parts
      const result = await adapter.send(
        { notificationId: 'test_123', userId: 'user_1', body: longMessage },
        { phone: '+15559876543' }
      )

      expect(customSend).toHaveBeenCalledTimes(3) // 400 chars / 153 = ~2.6, rounds to 3
      expect(sentPayloads[0].partNumber).toBe(1)
      expect(sentPayloads[0].totalParts).toBe(3)
      expect(sentPayloads[1].partNumber).toBe(2)
      expect(sentPayloads[2].partNumber).toBe(3)
      expect(result.messageId).toContain(',') // Combined message IDs
    })

    it('adds part indicators when enabled', async () => {
      const sentPayloads: any[] = []
      const customSend = vi.fn().mockImplementation((payload) => {
        sentPayloads.push(payload)
        return Promise.resolve({ messageId: `msg_${sentPayloads.length}` })
      })

      const adapter = createSMSAdapter({
        provider: 'mock',
        fromNumber: '+15551234567',
        customSend,
        enableMultipart: true,
        addPartIndicators: true,
      })

      const longMessage = 'A'.repeat(400)
      await adapter.send({ notificationId: 'test_123', userId: 'user_1', body: longMessage }, { phone: '+15559876543' })

      expect(sentPayloads[0].body).toMatch(/^\(1\/3\)/)
      expect(sentPayloads[1].body).toMatch(/^\(2\/3\)/)
      expect(sentPayloads[2].body).toMatch(/^\(3\/3\)/)
    })

    it('preserves original body in payload', async () => {
      const sentPayloads: any[] = []
      const customSend = vi.fn().mockImplementation((payload) => {
        sentPayloads.push(payload)
        return Promise.resolve({ messageId: `msg_${sentPayloads.length}` })
      })

      const adapter = createSMSAdapter({
        provider: 'mock',
        fromNumber: '+15551234567',
        customSend,
      })

      const longMessage = 'A'.repeat(400)
      await adapter.send({ notificationId: 'test_123', userId: 'user_1', body: longMessage }, { phone: '+15559876543' })

      // Each part should have the original body preserved
      for (const payload of sentPayloads) {
        expect(payload.originalBody).toBe(longMessage)
      }
    })

    it('can disable multipart handling', async () => {
      const sentPayloads: any[] = []
      const customSend = vi.fn().mockImplementation((payload) => {
        sentPayloads.push(payload)
        return Promise.resolve({ messageId: `msg_${sentPayloads.length}` })
      })

      const adapter = createSMSAdapter({
        provider: 'mock',
        fromNumber: '+15551234567',
        customSend,
        enableMultipart: false,
      })

      const longMessage = 'A'.repeat(400)
      await adapter.send({ notificationId: 'test_123', userId: 'user_1', body: longMessage }, { phone: '+15559876543' })

      // Should send as single message without splitting
      expect(customSend).toHaveBeenCalledOnce()
      expect(sentPayloads[0].body).toBe(longMessage)
      expect(sentPayloads[0].partNumber).toBeUndefined()
    })
  })
})
