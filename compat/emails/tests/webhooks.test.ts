import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  InMemoryWebhookStorage,
  WebhookDispatcher,
  parseSendGridWebhook,
  parseResendWebhook,
} from '../webhooks'
import type { WebhookSubscription, WebhookEvent, WebhookEventType } from '../types'

describe('Email Webhooks', () => {
  describe('InMemoryWebhookStorage', () => {
    let storage: InMemoryWebhookStorage

    beforeEach(() => {
      storage = new InMemoryWebhookStorage()
    })

    it('should store and retrieve subscriptions', async () => {
      const subscription: WebhookSubscription = {
        id: 'sub-1',
        url: 'https://example.com/webhook',
        events: ['delivered', 'bounced'],
        enabled: true,
        created_at: new Date(),
      }

      await storage.setSubscription(subscription)
      const retrieved = await storage.getSubscription('sub-1')

      expect(retrieved).toEqual(subscription)
    })

    it('should return null for non-existent subscriptions', async () => {
      const result = await storage.getSubscription('non-existent')
      expect(result).toBeNull()
    })

    it('should delete subscriptions', async () => {
      const subscription: WebhookSubscription = {
        id: 'sub-1',
        url: 'https://example.com/webhook',
        events: ['delivered'],
        enabled: true,
        created_at: new Date(),
      }

      await storage.setSubscription(subscription)
      await storage.deleteSubscription('sub-1')
      const result = await storage.getSubscription('sub-1')

      expect(result).toBeNull()
    })

    it('should filter subscriptions by event type', async () => {
      const sub1: WebhookSubscription = {
        id: 'sub-1',
        url: 'https://example.com/webhook1',
        events: ['delivered', 'bounced'],
        enabled: true,
        created_at: new Date(),
      }

      const sub2: WebhookSubscription = {
        id: 'sub-2',
        url: 'https://example.com/webhook2',
        events: ['opened', 'clicked'],
        enabled: true,
        created_at: new Date(),
      }

      const sub3: WebhookSubscription = {
        id: 'sub-3',
        url: 'https://example.com/webhook3',
        events: ['delivered'],
        enabled: false, // Disabled
        created_at: new Date(),
      }

      await storage.setSubscription(sub1)
      await storage.setSubscription(sub2)
      await storage.setSubscription(sub3)

      const deliveredSubs = await storage.getSubscriptionsByEvent('delivered')
      expect(deliveredSubs).toHaveLength(1) // sub3 is disabled
      expect(deliveredSubs[0].id).toBe('sub-1')

      const openedSubs = await storage.getSubscriptionsByEvent('opened')
      expect(openedSubs).toHaveLength(1)
      expect(openedSubs[0].id).toBe('sub-2')
    })

    it('should list all subscriptions', async () => {
      const sub1: WebhookSubscription = {
        id: 'sub-1',
        url: 'https://example.com/webhook1',
        events: ['delivered'],
        enabled: true,
        created_at: new Date(),
      }

      const sub2: WebhookSubscription = {
        id: 'sub-2',
        url: 'https://example.com/webhook2',
        events: ['opened'],
        enabled: true,
        created_at: new Date(),
      }

      await storage.setSubscription(sub1)
      await storage.setSubscription(sub2)

      const subs = await storage.listSubscriptions()
      expect(subs).toHaveLength(2)
    })

    it('should clear all subscriptions', async () => {
      const subscription: WebhookSubscription = {
        id: 'sub-1',
        url: 'https://example.com/webhook',
        events: ['delivered'],
        enabled: true,
        created_at: new Date(),
      }

      await storage.setSubscription(subscription)
      storage.clear()
      const subs = await storage.listSubscriptions()

      expect(subs).toHaveLength(0)
    })
  })

  describe('WebhookDispatcher', () => {
    let storage: InMemoryWebhookStorage
    let dispatcher: WebhookDispatcher
    let originalFetch: typeof globalThis.fetch

    beforeEach(() => {
      storage = new InMemoryWebhookStorage()
      dispatcher = new WebhookDispatcher({
        storage,
        maxRetries: 3,
        retryDelay: 10,
        timeout: 1000,
      })
      originalFetch = globalThis.fetch
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('should dispatch event to subscribed webhooks', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })

      await storage.setSubscription({
        id: 'sub-1',
        url: 'https://example.com/webhook',
        events: ['delivered'],
        enabled: true,
        created_at: new Date(),
      })

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'delivered',
        email_id: 'msg-123',
        recipient: 'user@example.com',
        timestamp: new Date(),
      }

      const results = await dispatcher.dispatch(event)

      expect(results).toHaveLength(1)
      expect(results[0].success).toBe(true)
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Webhook-Event': 'delivered',
            'X-Webhook-ID': 'event-1',
          }),
        })
      )
    })

    it('should include signature when secret is configured', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })

      await storage.setSubscription({
        id: 'sub-1',
        url: 'https://example.com/webhook',
        events: ['delivered'],
        secret: 'my-secret',
        enabled: true,
        created_at: new Date(),
      })

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'delivered',
        email_id: 'msg-123',
        recipient: 'user@example.com',
        timestamp: new Date(),
      }

      await dispatcher.dispatch(event)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Webhook-Signature': expect.any(String),
          }),
        })
      )
    })

    it('should retry on failure', async () => {
      let callCount = 0
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount < 3) {
          return Promise.resolve({ ok: false, status: 500 })
        }
        return Promise.resolve({ ok: true, status: 200 })
      })

      await storage.setSubscription({
        id: 'sub-1',
        url: 'https://example.com/webhook',
        events: ['delivered'],
        enabled: true,
        created_at: new Date(),
      })

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'delivered',
        email_id: 'msg-123',
        recipient: 'user@example.com',
        timestamp: new Date(),
      }

      const results = await dispatcher.dispatch(event)

      expect(results[0].success).toBe(true)
      expect(results[0].attempts).toBe(3)
    })

    it('should fail after max retries', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })

      await storage.setSubscription({
        id: 'sub-1',
        url: 'https://example.com/webhook',
        events: ['delivered'],
        enabled: true,
        created_at: new Date(),
      })

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'delivered',
        email_id: 'msg-123',
        recipient: 'user@example.com',
        timestamp: new Date(),
      }

      const results = await dispatcher.dispatch(event)

      expect(results[0].success).toBe(false)
      expect(results[0].attempts).toBe(3)
    })

    it('should not dispatch to unsubscribed events', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })

      await storage.setSubscription({
        id: 'sub-1',
        url: 'https://example.com/webhook',
        events: ['opened', 'clicked'],
        enabled: true,
        created_at: new Date(),
      })

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'delivered',
        email_id: 'msg-123',
        recipient: 'user@example.com',
        timestamp: new Date(),
      }

      const results = await dispatcher.dispatch(event)

      expect(results).toHaveLength(0)
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    it('should dispatch to multiple subscriptions', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })

      await storage.setSubscription({
        id: 'sub-1',
        url: 'https://example.com/webhook1',
        events: ['delivered'],
        enabled: true,
        created_at: new Date(),
      })

      await storage.setSubscription({
        id: 'sub-2',
        url: 'https://example.com/webhook2',
        events: ['delivered', 'bounced'],
        enabled: true,
        created_at: new Date(),
      })

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'delivered',
        email_id: 'msg-123',
        recipient: 'user@example.com',
        timestamp: new Date(),
      }

      const results = await dispatcher.dispatch(event)

      expect(results).toHaveLength(2)
      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('parseSendGridWebhook', () => {
    it('should parse delivered events', () => {
      const body = [
        {
          event: 'delivered',
          email: 'user@example.com',
          timestamp: 1640000000,
          sg_message_id: 'msg-123',
        },
      ]

      const events = parseSendGridWebhook(body)

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('delivered')
      expect(events[0].recipient).toBe('user@example.com')
      expect(events[0].email_id).toBe('msg-123')
    })

    it('should parse bounce events', () => {
      const body = [
        {
          event: 'bounce',
          email: 'user@example.com',
          timestamp: 1640000000,
          sg_message_id: 'msg-123',
          type: 'bounce',
          bounce_type: 'hard',
          reason: 'Mailbox does not exist',
        },
      ]

      const events = parseSendGridWebhook(body)

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('bounced')
      expect(events[0].bounce_type).toBe('hard')
      expect(events[0].bounce_reason).toBe('Mailbox does not exist')
    })

    it('should parse click events', () => {
      const body = [
        {
          event: 'click',
          email: 'user@example.com',
          timestamp: 1640000000,
          sg_message_id: 'msg-123',
          url: 'https://example.com/clicked-link',
        },
      ]

      const events = parseSendGridWebhook(body)

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('clicked')
      expect(events[0].url).toBe('https://example.com/clicked-link')
    })

    it('should parse open events', () => {
      const body = [
        {
          event: 'open',
          email: 'user@example.com',
          timestamp: 1640000000,
          sg_message_id: 'msg-123',
          ip: '192.168.1.1',
          useragent: 'Mozilla/5.0',
        },
      ]

      const events = parseSendGridWebhook(body)

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('opened')
      expect(events[0].metadata?.ip).toBe('192.168.1.1')
    })

    it('should handle multiple events', () => {
      const body = [
        { event: 'delivered', email: 'user1@example.com', timestamp: 1640000000, sg_message_id: 'msg-1' },
        { event: 'open', email: 'user2@example.com', timestamp: 1640000001, sg_message_id: 'msg-2' },
        { event: 'click', email: 'user3@example.com', timestamp: 1640000002, sg_message_id: 'msg-3' },
      ]

      const events = parseSendGridWebhook(body)

      expect(events).toHaveLength(3)
      expect(events.map((e) => e.type)).toEqual(['delivered', 'opened', 'clicked'])
    })

    it('should skip unknown events', () => {
      const body = [
        { event: 'unknown_event', email: 'user@example.com', timestamp: 1640000000 },
        { event: 'delivered', email: 'user@example.com', timestamp: 1640000000, sg_message_id: 'msg-1' },
      ]

      const events = parseSendGridWebhook(body)

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('delivered')
    })

    it('should handle non-array input', () => {
      const events = parseSendGridWebhook({} as unknown[])
      expect(events).toHaveLength(0)
    })
  })

  describe('parseResendWebhook', () => {
    it('should parse email.delivered event', () => {
      const body = {
        type: 'email.delivered',
        created_at: '2024-01-01T00:00:00Z',
        data: {
          email_id: 'msg-123',
          to: ['user@example.com'],
        },
      }

      const event = parseResendWebhook(body)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('delivered')
      expect(event?.email_id).toBe('msg-123')
      expect(event?.recipient).toBe('user@example.com')
    })

    it('should parse email.bounced event', () => {
      const body = {
        type: 'email.bounced',
        created_at: '2024-01-01T00:00:00Z',
        data: {
          email_id: 'msg-123',
          to: ['user@example.com'],
          reason: 'Mailbox not found',
        },
      }

      const event = parseResendWebhook(body)

      expect(event?.type).toBe('bounced')
      expect(event?.bounce_reason).toBe('Mailbox not found')
    })

    it('should parse email.opened event', () => {
      const body = {
        type: 'email.opened',
        created_at: '2024-01-01T00:00:00Z',
        data: {
          email_id: 'msg-123',
          to: ['user@example.com'],
        },
      }

      const event = parseResendWebhook(body)

      expect(event?.type).toBe('opened')
    })

    it('should parse email.clicked event', () => {
      const body = {
        type: 'email.clicked',
        created_at: '2024-01-01T00:00:00Z',
        data: {
          email_id: 'msg-123',
          to: ['user@example.com'],
          url: 'https://example.com/clicked',
        },
      }

      const event = parseResendWebhook(body)

      expect(event?.type).toBe('clicked')
      expect(event?.url).toBe('https://example.com/clicked')
    })

    it('should return null for unknown events', () => {
      const body = {
        type: 'unknown.event',
        created_at: '2024-01-01T00:00:00Z',
        data: {},
      }

      const event = parseResendWebhook(body)
      expect(event).toBeNull()
    })
  })
})
