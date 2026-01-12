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
