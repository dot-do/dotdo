/**
 * @dotdo/hubspot/webhooks - Webhooks API Tests
 *
 * Comprehensive tests for the HubSpot Webhooks API compatibility layer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  HubSpotWebhooks,
  HubSpotWebhookError,
  type WebhookStorage,
  type WebhookSubscription,
  type WebhookEvent,
} from '../webhooks'

// =============================================================================
// Test Storage Implementation
// =============================================================================

class TestStorage implements WebhookStorage {
  private data: Map<string, unknown> = new Map()

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>()
    for (const [key, value] of this.data) {
      if (options?.prefix && !key.startsWith(options.prefix)) continue
      result.set(key, value)
    }
    return result
  }

  clear(): void {
    this.data.clear()
  }
}

// =============================================================================
// Subscription Tests
// =============================================================================

describe('@dotdo/hubspot/webhooks - Subscriptions', () => {
  let webhooks: HubSpotWebhooks
  let storage: TestStorage

  beforeEach(() => {
    storage = new TestStorage()
    webhooks = new HubSpotWebhooks(storage, {
      appId: 'app_123',
      clientSecret: 'test_secret',
      portalId: 12345,
    })
  })

  describe('subscribe', () => {
    it('should create a webhook subscription', async () => {
      const subscription = await webhooks.subscribe({
        eventType: 'contact.creation',
        webhookUrl: 'https://example.com/webhook',
      })

      expect(subscription.id).toBeDefined()
      expect(subscription.eventType).toBe('contact.creation')
      expect(subscription.webhookUrl).toBe('https://example.com/webhook')
      expect(subscription.active).toBe(true)
    })

    it('should create an inactive subscription', async () => {
      const subscription = await webhooks.subscribe({
        eventType: 'contact.deletion',
        webhookUrl: 'https://example.com/webhook',
        active: false,
      })

      expect(subscription.active).toBe(false)
    })

    it('should create subscription for property change with property name', async () => {
      const subscription = await webhooks.subscribe({
        eventType: 'contact.propertyChange',
        webhookUrl: 'https://example.com/webhook',
        propertyName: 'lifecyclestage',
      })

      expect(subscription.propertyName).toBe('lifecyclestage')
    })

    it('should throw error for invalid URL', async () => {
      await expect(
        webhooks.subscribe({
          eventType: 'contact.creation',
          webhookUrl: 'not-a-valid-url',
        })
      ).rejects.toThrow(HubSpotWebhookError)
    })

    it('should throw error for duplicate subscription', async () => {
      await webhooks.subscribe({
        eventType: 'contact.creation',
        webhookUrl: 'https://example.com/webhook',
      })

      await expect(
        webhooks.subscribe({
          eventType: 'contact.creation',
          webhookUrl: 'https://example.com/webhook',
        })
      ).rejects.toThrow(HubSpotWebhookError)
    })
  })

  describe('getSubscription', () => {
    it('should get an existing subscription', async () => {
      const created = await webhooks.subscribe({
        eventType: 'company.creation',
        webhookUrl: 'https://example.com/webhook',
      })

      const retrieved = await webhooks.getSubscription(created.id)
      expect(retrieved.id).toBe(created.id)
      expect(retrieved.eventType).toBe('company.creation')
    })

    it('should throw error for non-existent subscription', async () => {
      await expect(webhooks.getSubscription('non-existent')).rejects.toThrow(HubSpotWebhookError)
    })
  })

  describe('updateSubscription', () => {
    it('should update webhook URL', async () => {
      const subscription = await webhooks.subscribe({
        eventType: 'deal.creation',
        webhookUrl: 'https://example.com/webhook',
      })

      const updated = await webhooks.updateSubscription(subscription.id, {
        webhookUrl: 'https://example.com/new-webhook',
      })

      expect(updated.webhookUrl).toBe('https://example.com/new-webhook')
    })

    it('should update active status', async () => {
      const subscription = await webhooks.subscribe({
        eventType: 'deal.deletion',
        webhookUrl: 'https://example.com/webhook',
      })

      const updated = await webhooks.updateSubscription(subscription.id, {
        active: false,
      })

      expect(updated.active).toBe(false)
    })

    it('should throw error for invalid URL on update', async () => {
      const subscription = await webhooks.subscribe({
        eventType: 'ticket.creation',
        webhookUrl: 'https://example.com/webhook',
      })

      await expect(
        webhooks.updateSubscription(subscription.id, { webhookUrl: 'invalid' })
      ).rejects.toThrow(HubSpotWebhookError)
    })
  })

  describe('unsubscribe', () => {
    it('should delete a subscription', async () => {
      const subscription = await webhooks.subscribe({
        eventType: 'contact.merge',
        webhookUrl: 'https://example.com/webhook',
      })

      await webhooks.unsubscribe(subscription.id)

      await expect(webhooks.getSubscription(subscription.id)).rejects.toThrow(HubSpotWebhookError)
    })

    it('should throw error for non-existent subscription', async () => {
      await expect(webhooks.unsubscribe('non-existent')).rejects.toThrow(HubSpotWebhookError)
    })
  })

  describe('listSubscriptions', () => {
    it('should list all subscriptions', async () => {
      await webhooks.subscribe({ eventType: 'contact.creation', webhookUrl: 'https://example.com/1' })
      await webhooks.subscribe({ eventType: 'company.creation', webhookUrl: 'https://example.com/2' })
      await webhooks.subscribe({ eventType: 'deal.creation', webhookUrl: 'https://example.com/3' })

      const result = await webhooks.listSubscriptions()
      expect(result.results).toHaveLength(3)
    })

    it('should filter by event type', async () => {
      await webhooks.subscribe({ eventType: 'contact.creation', webhookUrl: 'https://example.com/1' })
      await webhooks.subscribe({ eventType: 'contact.deletion', webhookUrl: 'https://example.com/2' })
      await webhooks.subscribe({ eventType: 'company.creation', webhookUrl: 'https://example.com/3' })

      const result = await webhooks.listSubscriptions({ eventType: 'contact.creation' })
      expect(result.results).toHaveLength(1)
      expect(result.results[0].eventType).toBe('contact.creation')
    })

    it('should filter by active status', async () => {
      await webhooks.subscribe({ eventType: 'contact.creation', webhookUrl: 'https://example.com/1', active: true })
      await webhooks.subscribe({ eventType: 'company.creation', webhookUrl: 'https://example.com/2', active: false })

      const result = await webhooks.listSubscriptions({ active: true })
      expect(result.results).toHaveLength(1)
    })

    it('should paginate results', async () => {
      for (let i = 0; i < 5; i++) {
        await webhooks.subscribe({ eventType: 'contact.creation', webhookUrl: `https://example.com/webhook${i}` })
      }

      const page1 = await webhooks.listSubscriptions({ limit: 2 })
      expect(page1.results).toHaveLength(2)
      expect(page1.paging?.next?.after).toBeDefined()
    })
  })
})

// =============================================================================
// Event Triggering Tests
// =============================================================================

describe('@dotdo/hubspot/webhooks - Event Triggering', () => {
  let webhooks: HubSpotWebhooks
  let storage: TestStorage
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    storage = new TestStorage()
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    webhooks = new HubSpotWebhooks(
      storage,
      { appId: 'app_123', clientSecret: 'test_secret', portalId: 12345 },
      mockFetch
    )
  })

  describe('triggerEvent', () => {
    it('should trigger event for matching subscriptions', async () => {
      await webhooks.subscribe({
        eventType: 'contact.creation',
        webhookUrl: 'https://example.com/webhook',
      })

      const events = await webhooks.triggerEvent({
        eventType: 'contact.creation',
        objectType: 'contact',
        objectId: '123',
      })

      expect(events).toHaveLength(1)
      expect(events[0].eventType).toBe('contact.creation')
      expect(events[0].objectId).toBe('123')
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should trigger multiple webhooks for same event type', async () => {
      await webhooks.subscribe({ eventType: 'deal.creation', webhookUrl: 'https://example.com/webhook1' })
      await webhooks.subscribe({ eventType: 'deal.creation', webhookUrl: 'https://example.com/webhook2' })

      const events = await webhooks.triggerEvent({
        eventType: 'deal.creation',
        objectType: 'deal',
        objectId: '456',
      })

      expect(events).toHaveLength(2)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should not trigger inactive subscriptions', async () => {
      await webhooks.subscribe({
        eventType: 'company.creation',
        webhookUrl: 'https://example.com/webhook',
        active: false,
      })

      const events = await webhooks.triggerEvent({
        eventType: 'company.creation',
        objectType: 'company',
        objectId: '789',
      })

      expect(events).toHaveLength(0)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should filter property change events by property name', async () => {
      await webhooks.subscribe({
        eventType: 'contact.propertyChange',
        webhookUrl: 'https://example.com/webhook',
        propertyName: 'lifecyclestage',
      })

      // This should not trigger (different property)
      const events1 = await webhooks.triggerEvent({
        eventType: 'contact.propertyChange',
        objectType: 'contact',
        objectId: '123',
        propertyName: 'email',
        propertyValue: 'new@example.com',
      })
      expect(events1).toHaveLength(0)

      // This should trigger (matching property)
      const events2 = await webhooks.triggerEvent({
        eventType: 'contact.propertyChange',
        objectType: 'contact',
        objectId: '123',
        propertyName: 'lifecyclestage',
        propertyValue: 'customer',
      })
      expect(events2).toHaveLength(1)
    })

    it('should include event metadata', async () => {
      await webhooks.subscribe({
        eventType: 'ticket.creation',
        webhookUrl: 'https://example.com/webhook',
      })

      const events = await webhooks.triggerEvent({
        eventType: 'ticket.creation',
        objectType: 'ticket',
        objectId: '101',
        changeSource: 'API',
      })

      expect(events[0].portalId).toBe(12345)
      expect(events[0].changeSource).toBe('API')
      expect(events[0].occurredAt).toBeDefined()
    })
  })
})

// =============================================================================
// Webhook Delivery Tests
// =============================================================================

describe('@dotdo/hubspot/webhooks - Delivery', () => {
  let webhooks: HubSpotWebhooks
  let storage: TestStorage
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    storage = new TestStorage()
    mockFetch = vi.fn()
    webhooks = new HubSpotWebhooks(
      storage,
      { appId: 'app_123', clientSecret: 'test_secret', maxRetries: 3 },
      mockFetch
    )
  })

  describe('successful delivery', () => {
    it('should mark delivery as success when webhook returns 200', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 })

      await webhooks.subscribe({
        eventType: 'contact.creation',
        webhookUrl: 'https://example.com/webhook',
      })

      await webhooks.triggerEvent({
        eventType: 'contact.creation',
        objectType: 'contact',
        objectId: '123',
      })

      const deliveries = await webhooks.listDeliveries({ status: 'success' })
      expect(deliveries.results).toHaveLength(1)
    })
  })

  describe('failed delivery', () => {
    it('should mark delivery as failed when webhook returns error', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal Server Error' })

      await webhooks.subscribe({
        eventType: 'contact.creation',
        webhookUrl: 'https://example.com/webhook',
      })

      await webhooks.triggerEvent({
        eventType: 'contact.creation',
        objectType: 'contact',
        objectId: '123',
      })

      const deliveries = await webhooks.listDeliveries({ status: 'failed' })
      expect(deliveries.results.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      await webhooks.subscribe({
        eventType: 'company.creation',
        webhookUrl: 'https://example.com/webhook',
      })

      await webhooks.triggerEvent({
        eventType: 'company.creation',
        objectType: 'company',
        objectId: '456',
      })

      const deliveries = await webhooks.listDeliveries({ status: 'failed' })
      expect(deliveries.results).toHaveLength(1)
      expect(deliveries.results[0].error).toBe('Network error')
    })
  })

  describe('listDeliveries', () => {
    it('should list deliveries by subscription', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 })

      const sub1 = await webhooks.subscribe({ eventType: 'contact.creation', webhookUrl: 'https://example.com/1' })
      const sub2 = await webhooks.subscribe({ eventType: 'company.creation', webhookUrl: 'https://example.com/2' })

      await webhooks.triggerEvent({ eventType: 'contact.creation', objectType: 'contact', objectId: '1' })
      await webhooks.triggerEvent({ eventType: 'company.creation', objectType: 'company', objectId: '2' })

      const deliveries = await webhooks.listDeliveries({ subscriptionId: sub1.id })
      expect(deliveries.results).toHaveLength(1)
    })

    it('should list deliveries by event', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 })

      await webhooks.subscribe({ eventType: 'deal.creation', webhookUrl: 'https://example.com/webhook' })

      const events = await webhooks.triggerEvent({
        eventType: 'deal.creation',
        objectType: 'deal',
        objectId: '789',
      })

      const deliveries = await webhooks.listDeliveries({ eventId: events[0].eventId })
      expect(deliveries.results).toHaveLength(1)
    })
  })

  describe('getDeliveryStats', () => {
    it('should return delivery statistics', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200 })
        .mockResolvedValueOnce({ ok: true, status: 200 })
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Error' })

      await webhooks.subscribe({ eventType: 'contact.creation', webhookUrl: 'https://example.com/webhook' })

      await webhooks.triggerEvent({ eventType: 'contact.creation', objectType: 'contact', objectId: '1' })
      await webhooks.triggerEvent({ eventType: 'contact.creation', objectType: 'contact', objectId: '2' })
      await webhooks.triggerEvent({ eventType: 'contact.creation', objectType: 'contact', objectId: '3' })

      const stats = await webhooks.getDeliveryStats()
      expect(stats.total).toBe(3)
      expect(stats.success).toBe(2)
      expect(stats.failed).toBe(1)
      expect(stats.successRate).toBeCloseTo(66.67, 0)
    })
  })
})

// =============================================================================
// Event History Tests
// =============================================================================

describe('@dotdo/hubspot/webhooks - Event History', () => {
  let webhooks: HubSpotWebhooks
  let storage: TestStorage
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    storage = new TestStorage()
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    webhooks = new HubSpotWebhooks(storage, { appId: 'app_123', clientSecret: 'test_secret' }, mockFetch)
  })

  describe('getEvent', () => {
    it('should get an event by ID', async () => {
      await webhooks.subscribe({ eventType: 'contact.creation', webhookUrl: 'https://example.com/webhook' })
      const events = await webhooks.triggerEvent({ eventType: 'contact.creation', objectType: 'contact', objectId: '123' })

      const event = await webhooks.getEvent(events[0].eventId)
      expect(event.eventId).toBe(events[0].eventId)
      expect(event.objectId).toBe('123')
    })

    it('should throw error for non-existent event', async () => {
      await expect(webhooks.getEvent('non-existent')).rejects.toThrow(HubSpotWebhookError)
    })
  })

  describe('listEvents', () => {
    it('should list all events', async () => {
      await webhooks.subscribe({ eventType: 'contact.creation', webhookUrl: 'https://example.com/webhook' })
      await webhooks.triggerEvent({ eventType: 'contact.creation', objectType: 'contact', objectId: '1' })
      await webhooks.triggerEvent({ eventType: 'contact.creation', objectType: 'contact', objectId: '2' })

      const events = await webhooks.listEvents()
      expect(events.results).toHaveLength(2)
    })

    it('should filter events by event type', async () => {
      await webhooks.subscribe({ eventType: 'contact.creation', webhookUrl: 'https://example.com/1' })
      await webhooks.subscribe({ eventType: 'company.creation', webhookUrl: 'https://example.com/2' })

      await webhooks.triggerEvent({ eventType: 'contact.creation', objectType: 'contact', objectId: '1' })
      await webhooks.triggerEvent({ eventType: 'company.creation', objectType: 'company', objectId: '2' })

      const events = await webhooks.listEvents({ eventType: 'contact.creation' })
      expect(events.results).toHaveLength(1)
    })

    it('should filter events by object type', async () => {
      await webhooks.subscribe({ eventType: 'contact.creation', webhookUrl: 'https://example.com/1' })
      await webhooks.subscribe({ eventType: 'deal.creation', webhookUrl: 'https://example.com/2' })

      await webhooks.triggerEvent({ eventType: 'contact.creation', objectType: 'contact', objectId: '1' })
      await webhooks.triggerEvent({ eventType: 'deal.creation', objectType: 'deal', objectId: '2' })

      const events = await webhooks.listEvents({ objectType: 'deal' })
      expect(events.results).toHaveLength(1)
    })

    it('should filter events by object ID', async () => {
      await webhooks.subscribe({ eventType: 'contact.creation', webhookUrl: 'https://example.com/webhook' })

      await webhooks.triggerEvent({ eventType: 'contact.creation', objectType: 'contact', objectId: '123' })
      await webhooks.triggerEvent({ eventType: 'contact.creation', objectType: 'contact', objectId: '456' })

      const events = await webhooks.listEvents({ objectId: '123' })
      expect(events.results).toHaveLength(1)
    })
  })
})

// =============================================================================
// Signature Verification Tests
// =============================================================================

describe('@dotdo/hubspot/webhooks - Signature Verification', () => {
  let webhooks: HubSpotWebhooks
  let storage: TestStorage

  beforeEach(() => {
    storage = new TestStorage()
    webhooks = new HubSpotWebhooks(storage, { appId: 'app_123', clientSecret: 'test_secret' })
  })

  describe('createSignature', () => {
    it('should create a consistent signature', () => {
      const payload = [{ eventType: 'contact.creation', objectId: '123' }]
      const timestamp = '1234567890'

      const sig1 = webhooks.createSignature(payload, timestamp)
      const sig2 = webhooks.createSignature(payload, timestamp)

      expect(sig1).toBe(sig2)
    })

    it('should create different signatures for different payloads', () => {
      const timestamp = '1234567890'

      const sig1 = webhooks.createSignature([{ id: '1' }], timestamp)
      const sig2 = webhooks.createSignature([{ id: '2' }], timestamp)

      expect(sig1).not.toBe(sig2)
    })

    it('should create different signatures for different timestamps', () => {
      const payload = [{ id: '123' }]

      const sig1 = webhooks.createSignature(payload, '1234567890')
      const sig2 = webhooks.createSignature(payload, '0987654321')

      expect(sig1).not.toBe(sig2)
    })
  })

  describe('verifySignature', () => {
    it('should verify a valid signature', () => {
      const payload = JSON.stringify([{ eventType: 'contact.creation', objectId: '123' }])
      const timestamp = '1234567890'
      const signature = webhooks.createSignature(JSON.parse(payload), timestamp)

      const isValid = webhooks.verifySignature(payload, signature, timestamp)
      expect(isValid).toBe(true)
    })

    it('should reject an invalid signature', () => {
      const payload = JSON.stringify([{ eventType: 'contact.creation', objectId: '123' }])
      const timestamp = '1234567890'

      const isValid = webhooks.verifySignature(payload, 'invalid_signature', timestamp)
      expect(isValid).toBe(false)
    })
  })
})

// =============================================================================
// Settings Tests
// =============================================================================

describe('@dotdo/hubspot/webhooks - Settings', () => {
  let webhooks: HubSpotWebhooks
  let storage: TestStorage

  beforeEach(() => {
    storage = new TestStorage()
    webhooks = new HubSpotWebhooks(storage, { appId: 'app_123', clientSecret: 'test_secret' })
  })

  describe('getSettings', () => {
    it('should return default settings', async () => {
      const settings = await webhooks.getSettings()

      expect(settings.throttling).toBeDefined()
      expect(settings.throttling.maxConcurrentRequests).toBe(10)
      expect(settings.throttling.period).toBe(1000)
    })
  })

  describe('updateSettings', () => {
    it('should update throttling settings', async () => {
      const updated = await webhooks.updateSettings({
        throttling: {
          maxConcurrentRequests: 20,
          period: 2000,
        },
      })

      expect(updated.throttling.maxConcurrentRequests).toBe(20)
      expect(updated.throttling.period).toBe(2000)
    })

    it('should update target URL', async () => {
      const updated = await webhooks.updateSettings({
        targetUrl: 'https://api.example.com/webhooks',
      })

      expect(updated.targetUrl).toBe('https://api.example.com/webhooks')
    })
  })
})
