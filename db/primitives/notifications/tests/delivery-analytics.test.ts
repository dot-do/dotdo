/**
 * DeliveryAnalytics Tests
 *
 * Comprehensive tests for delivery analytics and tracking:
 * - Open/click tracking with pixel and redirect URLs
 * - Delivery status webhooks from email providers
 * - Bounce/complaint handling
 * - Per-channel metrics (delivery rate, latency)
 * - Analytics dashboard data export
 *
 * @module db/primitives/notifications/tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  createDeliveryAnalytics,
  DeliveryAnalytics,
  type DeliveryEvent,
  type OpenEvent,
  type ClickEvent,
  type BounceEvent,
  type ComplaintEvent,
  type AnalyticsStorage,
  type WebhookRequest,
  type ChannelMetrics,
  type AggregateMetrics,
  type SuppressionEntry,
  createNotificationRouter,
  type ChannelType,
} from '../index'

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockStorage(): AnalyticsStorage {
  const data = new Map<string, unknown>()

  return {
    async get<T>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined
    },
    async put<T>(key: string, value: T): Promise<void> {
      data.set(key, value)
    },
    async delete(key: string): Promise<boolean> {
      return data.delete(key)
    },
    async list<T>(prefix: string): Promise<Map<string, T>> {
      const result = new Map<string, T>()
      for (const [key, value] of data.entries()) {
        if (key.startsWith(prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    },
  }
}

// =============================================================================
// Factory Tests
// =============================================================================

describe('DeliveryAnalytics Factory', () => {
  it('creates a DeliveryAnalytics instance', () => {
    const storage = createMockStorage()
    const analytics = createDeliveryAnalytics({ storage })

    expect(analytics).toBeDefined()
    expect(analytics).toBeInstanceOf(DeliveryAnalytics)
  })

  it('accepts configuration options', () => {
    const storage = createMockStorage()
    const analytics = createDeliveryAnalytics({
      storage,
      webhookSecret: 'test_secret',
      autoSuppressHardBounces: true,
      autoSuppressComplaints: true,
      eventRetentionDays: 30,
    })

    expect(analytics).toBeDefined()
  })

  it('accepts tracking configuration', () => {
    const storage = createMockStorage()
    const analytics = createDeliveryAnalytics({
      storage,
      tracking: {
        baseUrl: 'https://track.example.com',
        signingSecret: 'secret123',
        openTrackingEnabled: true,
        clickTrackingEnabled: true,
        trackingDomain: 'https://t.example.com',
      },
    })

    expect(analytics).toBeDefined()
  })
})

// =============================================================================
// Event Tracking Tests
// =============================================================================

describe('Event Tracking', () => {
  let analytics: DeliveryAnalytics
  let storage: AnalyticsStorage

  beforeEach(() => {
    storage = createMockStorage()
    analytics = createDeliveryAnalytics({ storage })
  })

  describe('trackDelivery()', () => {
    it('tracks a sent event', async () => {
      const event = await analytics.trackDelivery({
        notificationId: 'notif_123',
        channel: 'email',
        event: 'sent',
        timestamp: new Date(),
        messageId: 'msg_abc',
        recipient: 'user@example.com',
        userId: 'user_1',
      })

      expect(event).toBeDefined()
      expect(event.id).toBeDefined()
      expect(event.event).toBe('sent')
      expect(event.channel).toBe('email')
    })

    it('tracks a delivered event', async () => {
      const event = await analytics.trackDelivery({
        notificationId: 'notif_123',
        channel: 'email',
        event: 'delivered',
        timestamp: new Date(),
        messageId: 'msg_abc',
        recipient: 'user@example.com',
      })

      expect(event.event).toBe('delivered')
    })

    it('tracks a failed event', async () => {
      const event = await analytics.trackDelivery({
        notificationId: 'notif_123',
        channel: 'sms',
        event: 'failed',
        timestamp: new Date(),
        metadata: { error: 'Invalid phone number' },
      })

      expect(event.event).toBe('failed')
      expect(event.metadata?.error).toBe('Invalid phone number')
    })

    it('stores events in storage', async () => {
      await analytics.trackDelivery({
        notificationId: 'notif_123',
        channel: 'email',
        event: 'sent',
        timestamp: new Date(),
      })

      const events = await analytics.getNotificationEvents('notif_123')
      expect(events).toHaveLength(1)
      expect(events[0].event).toBe('sent')
    })

    it('associates multiple events with same notification', async () => {
      await analytics.trackDelivery({
        notificationId: 'notif_123',
        channel: 'email',
        event: 'sent',
        timestamp: new Date('2024-01-15T10:00:00Z'),
      })

      await analytics.trackDelivery({
        notificationId: 'notif_123',
        channel: 'email',
        event: 'delivered',
        timestamp: new Date('2024-01-15T10:01:00Z'),
      })

      await analytics.trackDelivery({
        notificationId: 'notif_123',
        channel: 'email',
        event: 'opened',
        timestamp: new Date('2024-01-15T12:00:00Z'),
      })

      const events = await analytics.getNotificationEvents('notif_123')
      expect(events).toHaveLength(3)
      expect(events.map((e) => e.event)).toEqual(['sent', 'delivered', 'opened'])
    })
  })

  describe('trackOpen()', () => {
    it('tracks an open event', async () => {
      const event = await analytics.trackOpen({
        notificationId: 'notif_123',
        channel: 'email',
        messageId: 'msg_abc',
        recipient: 'user@example.com',
        userId: 'user_1',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        ipAddress: '192.168.1.1',
      })

      expect(event).toBeDefined()
      expect(event.event).toBe('opened')
      expect(event.userAgent).toContain('Mozilla')
      expect(event.ipAddress).toBe('192.168.1.1')
    })

    it('marks first open correctly', async () => {
      const firstOpen = await analytics.trackOpen({
        notificationId: 'notif_123',
        channel: 'email',
      })

      const secondOpen = await analytics.trackOpen({
        notificationId: 'notif_123',
        channel: 'email',
      })

      expect(firstOpen.firstOpen).toBe(true)
      expect(secondOpen.firstOpen).toBe(false)
    })

    it('infers device type from user agent', async () => {
      const mobileOpen = await analytics.trackOpen({
        notificationId: 'notif_mobile',
        channel: 'email',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
      })

      const desktopOpen = await analytics.trackOpen({
        notificationId: 'notif_desktop',
        channel: 'email',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      })

      expect(mobileOpen.deviceType).toBe('mobile')
      expect(desktopOpen.deviceType).toBe('desktop')
    })
  })

  describe('trackClick()', () => {
    it('tracks a click event', async () => {
      const event = await analytics.trackClick({
        notificationId: 'notif_123',
        channel: 'email',
        url: 'https://example.com/product/123',
        linkTag: 'cta-button',
        messageId: 'msg_abc',
        recipient: 'user@example.com',
        userAgent: 'Mozilla/5.0',
        ipAddress: '192.168.1.1',
      })

      expect(event).toBeDefined()
      expect(event.event).toBe('clicked')
      expect(event.url).toBe('https://example.com/product/123')
      expect(event.linkTag).toBe('cta-button')
    })

    it('tracks multiple clicks on different links', async () => {
      await analytics.trackClick({
        notificationId: 'notif_123',
        channel: 'email',
        url: 'https://example.com/link1',
      })

      await analytics.trackClick({
        notificationId: 'notif_123',
        channel: 'email',
        url: 'https://example.com/link2',
      })

      const events = await analytics.getNotificationEvents('notif_123')
      const clickEvents = events.filter((e) => e.event === 'clicked') as ClickEvent[]

      expect(clickEvents).toHaveLength(2)
      expect(clickEvents.map((e) => e.url)).toContain('https://example.com/link1')
      expect(clickEvents.map((e) => e.url)).toContain('https://example.com/link2')
    })
  })

  describe('trackBounce()', () => {
    it('tracks a hard bounce', async () => {
      const event = await analytics.trackBounce({
        notificationId: 'notif_123',
        channel: 'email',
        bounceType: 'hard',
        bounceCategory: 'invalid_recipient',
        bounceReason: 'User unknown',
        smtpCode: '550',
        enhancedStatusCode: '5.1.1',
        recipient: 'invalid@example.com',
      })

      expect(event).toBeDefined()
      expect(event.event).toBe('bounced')
      expect(event.bounceType).toBe('hard')
      expect(event.bounceCategory).toBe('invalid_recipient')
      expect(event.smtpCode).toBe('550')
    })

    it('tracks a soft bounce', async () => {
      const event = await analytics.trackBounce({
        notificationId: 'notif_123',
        channel: 'email',
        bounceType: 'soft',
        bounceCategory: 'mailbox_full',
        bounceReason: 'Mailbox is full',
        recipient: 'user@example.com',
      })

      expect(event.bounceType).toBe('soft')
      expect(event.bounceCategory).toBe('mailbox_full')
    })
  })

  describe('trackComplaint()', () => {
    it('tracks a spam complaint', async () => {
      const event = await analytics.trackComplaint({
        notificationId: 'notif_123',
        channel: 'email',
        complaintType: 'spam',
        feedbackLoop: 'hotmail',
        recipient: 'user@hotmail.com',
      })

      expect(event).toBeDefined()
      expect(event.event).toBe('complained')
      expect(event.complaintType).toBe('spam')
      expect(event.feedbackLoop).toBe('hotmail')
    })
  })
})

// =============================================================================
// Tracking URL Generation Tests
// =============================================================================

describe('Tracking URL Generation', () => {
  let analytics: DeliveryAnalytics

  beforeEach(() => {
    const storage = createMockStorage()
    analytics = createDeliveryAnalytics({
      storage,
      tracking: {
        baseUrl: 'https://track.example.com',
        signingSecret: 'secret123',
        openTrackingEnabled: true,
        clickTrackingEnabled: true,
      },
    })
  })

  describe('generateTrackingUrls()', () => {
    it('generates open tracking pixel URL', () => {
      const urls = analytics.generateTrackingUrls({
        notificationId: 'notif_123',
        channel: 'email',
        links: [],
        userId: 'user_1',
      })

      expect(urls.openTrackingPixel).toBeDefined()
      expect(urls.openTrackingPixel).toContain('https://track.example.com/t/open/')
      expect(urls.openTrackingPixel).toContain('.gif')
    })

    it('generates click tracking URLs', () => {
      const urls = analytics.generateTrackingUrls({
        notificationId: 'notif_123',
        channel: 'email',
        links: ['https://example.com/product/1', 'https://example.com/product/2'],
        userId: 'user_1',
      })

      expect(urls.trackedLinks.size).toBe(2)
      expect(urls.trackedLinks.get('https://example.com/product/1')).toContain('/t/click/')
      expect(urls.trackedLinks.get('https://example.com/product/2')).toContain('/t/click/')
    })

    it('does not generate open tracking for non-email channels', () => {
      const urls = analytics.generateTrackingUrls({
        notificationId: 'notif_123',
        channel: 'sms',
        links: ['https://example.com/link'],
      })

      expect(urls.openTrackingPixel).toBeUndefined()
    })
  })

  describe('decodeTrackingToken()', () => {
    it('decodes a valid tracking token', () => {
      const urls = analytics.generateTrackingUrls({
        notificationId: 'notif_123',
        channel: 'email',
        links: ['https://example.com/link'],
        userId: 'user_1',
      })

      const trackedUrl = urls.trackedLinks.get('https://example.com/link')!
      const tokenMatch = trackedUrl.match(/\/click\/([^?]+)/)
      const token = tokenMatch?.[1]

      const decoded = analytics.decodeTrackingToken(token!)

      expect(decoded).toBeDefined()
      expect(decoded?.notificationId).toBe('notif_123')
      expect(decoded?.type).toBe('click')
    })

    it('returns null for invalid token', () => {
      const decoded = analytics.decodeTrackingToken('invalid_token')
      expect(decoded).toBeNull()
    })
  })
})

// =============================================================================
// Webhook Processing Tests
// =============================================================================

describe('Webhook Processing', () => {
  let analytics: DeliveryAnalytics
  let storage: AnalyticsStorage

  beforeEach(() => {
    storage = createMockStorage()
    analytics = createDeliveryAnalytics({ storage })
  })

  describe('processWebhook() - SendGrid', () => {
    it('processes SendGrid delivery event', async () => {
      const webhook: WebhookRequest = {
        provider: 'sendgrid',
        payload: [
          {
            event: 'delivered',
            email: 'user@example.com',
            timestamp: Math.floor(Date.now() / 1000),
            sg_message_id: 'msg_123',
            'x-notification-id': 'notif_123',
          },
        ],
      }

      const result = await analytics.processWebhook(webhook)

      expect(result.success).toBe(true)
      expect(result.eventsProcessed).toBe(1)
      expect(result.events[0].event).toBe('delivered')
    })

    it('processes SendGrid bounce event', async () => {
      const webhook: WebhookRequest = {
        provider: 'sendgrid',
        payload: [
          {
            event: 'bounce',
            type: 'bounce',
            email: 'invalid@example.com',
            timestamp: Math.floor(Date.now() / 1000),
            reason: 'User unknown',
            sg_message_id: 'msg_123',
          },
        ],
      }

      const result = await analytics.processWebhook(webhook)

      expect(result.success).toBe(true)
      expect(result.events[0].event).toBe('bounced')
    })

    it('processes SendGrid open event', async () => {
      const webhook: WebhookRequest = {
        provider: 'sendgrid',
        payload: [
          {
            event: 'open',
            email: 'user@example.com',
            timestamp: Math.floor(Date.now() / 1000),
            ip: '192.168.1.1',
            useragent: 'Mozilla/5.0',
            sg_message_id: 'msg_123',
          },
        ],
      }

      const result = await analytics.processWebhook(webhook)

      expect(result.success).toBe(true)
      expect(result.events[0].event).toBe('opened')
    })

    it('processes SendGrid click event', async () => {
      const webhook: WebhookRequest = {
        provider: 'sendgrid',
        payload: [
          {
            event: 'click',
            email: 'user@example.com',
            timestamp: Math.floor(Date.now() / 1000),
            url: 'https://example.com/link',
            sg_message_id: 'msg_123',
          },
        ],
      }

      const result = await analytics.processWebhook(webhook)

      expect(result.success).toBe(true)
      expect(result.events[0].event).toBe('clicked')
    })

    it('processes multiple SendGrid events', async () => {
      const webhook: WebhookRequest = {
        provider: 'sendgrid',
        payload: [
          {
            event: 'processed',
            email: 'user@example.com',
            timestamp: Math.floor(Date.now() / 1000),
            sg_message_id: 'msg_123',
          },
          {
            event: 'delivered',
            email: 'user@example.com',
            timestamp: Math.floor(Date.now() / 1000) + 5,
            sg_message_id: 'msg_123',
          },
        ],
      }

      const result = await analytics.processWebhook(webhook)

      expect(result.success).toBe(true)
      expect(result.eventsProcessed).toBe(2)
    })
  })

  describe('processWebhook() - Mailgun', () => {
    it('processes Mailgun delivery event', async () => {
      const webhook: WebhookRequest = {
        provider: 'mailgun',
        payload: {
          'event-data': {
            event: 'delivered',
            timestamp: Date.now() / 1000,
            recipient: 'user@example.com',
            id: 'event_123',
            message: {
              headers: {
                'message-id': 'msg_123',
              },
            },
          },
        },
      }

      const result = await analytics.processWebhook(webhook)

      expect(result.success).toBe(true)
      expect(result.events[0].event).toBe('delivered')
    })
  })

  describe('processWebhook() - Postmark', () => {
    it('processes Postmark delivery event', async () => {
      const webhook: WebhookRequest = {
        provider: 'postmark',
        payload: {
          RecordType: 'Delivery',
          MessageID: 'msg_123',
          Recipient: 'user@example.com',
          DeliveredAt: new Date().toISOString(),
        },
      }

      const result = await analytics.processWebhook(webhook)

      expect(result.success).toBe(true)
      expect(result.events[0].event).toBe('delivered')
    })

    it('processes Postmark bounce event', async () => {
      const webhook: WebhookRequest = {
        provider: 'postmark',
        payload: {
          RecordType: 'HardBounce',
          MessageID: 'msg_123',
          Email: 'invalid@example.com',
          BouncedAt: new Date().toISOString(),
          Type: 'HardBounce',
          Description: 'The email account that you tried to reach does not exist',
        },
      }

      const result = await analytics.processWebhook(webhook)

      expect(result.success).toBe(true)
      expect(result.events[0].event).toBe('bounced')
    })
  })

  describe('processWebhook() - Twilio (SMS)', () => {
    it('processes Twilio delivery status', async () => {
      const webhook: WebhookRequest = {
        provider: 'twilio',
        payload: {
          MessageStatus: 'delivered',
          MessageSid: 'SM123',
          To: '+1234567890',
        },
      }

      const result = await analytics.processWebhook(webhook)

      expect(result.success).toBe(true)
      expect(result.events[0].event).toBe('delivered')
      expect(result.events[0].channel).toBe('sms')
    })

    it('processes Twilio failed status', async () => {
      const webhook: WebhookRequest = {
        provider: 'twilio',
        payload: {
          MessageStatus: 'failed',
          MessageSid: 'SM123',
          To: '+1234567890',
          ErrorCode: '30007',
          ErrorMessage: 'Carrier violation',
        },
      }

      const result = await analytics.processWebhook(webhook)

      expect(result.success).toBe(true)
      expect(result.events[0].event).toBe('failed')
    })
  })

  describe('processWebhook() - Generic', () => {
    it('processes generic webhook format', async () => {
      const webhook: WebhookRequest = {
        provider: 'generic',
        payload: {
          event: 'delivered',
          notificationId: 'notif_123',
          channel: 'email',
          timestamp: new Date().toISOString(),
          recipient: 'user@example.com',
        },
      }

      const result = await analytics.processWebhook(webhook)

      expect(result.success).toBe(true)
      expect(result.events[0].event).toBe('delivered')
    })
  })
})

// =============================================================================
// Metrics Tests
// =============================================================================

describe('Metrics', () => {
  let analytics: DeliveryAnalytics
  let storage: AnalyticsStorage

  beforeEach(async () => {
    storage = createMockStorage()
    analytics = createDeliveryAnalytics({ storage })

    // Set up test data
    const now = Date.now()
    const baseTimestamp = now - 12 * 60 * 60 * 1000 // 12 hours ago

    // Track various events
    for (let i = 0; i < 100; i++) {
      await analytics.trackDelivery({
        notificationId: `notif_${i}`,
        channel: 'email',
        event: 'sent',
        timestamp: new Date(baseTimestamp + i * 60000),
        userId: `user_${i % 10}`,
        recipient: `user${i}@example.com`,
      })
    }

    // 90 delivered
    for (let i = 0; i < 90; i++) {
      await analytics.trackDelivery({
        notificationId: `notif_${i}`,
        channel: 'email',
        event: 'delivered',
        timestamp: new Date(baseTimestamp + i * 60000 + 5000),
        metadata: { sentAt: new Date(baseTimestamp + i * 60000).toISOString() },
      })
    }

    // 40 opened
    for (let i = 0; i < 40; i++) {
      await analytics.trackOpen({
        notificationId: `notif_${i}`,
        channel: 'email',
      })
    }

    // 15 clicked
    for (let i = 0; i < 15; i++) {
      await analytics.trackClick({
        notificationId: `notif_${i}`,
        channel: 'email',
        url: 'https://example.com/link',
      })
    }

    // 5 bounced
    for (let i = 90; i < 95; i++) {
      await analytics.trackBounce({
        notificationId: `notif_${i}`,
        channel: 'email',
        bounceType: 'hard',
        bounceCategory: 'invalid_recipient',
      })
    }

    // 2 complaints
    for (let i = 0; i < 2; i++) {
      await analytics.trackComplaint({
        notificationId: `notif_${i}`,
        channel: 'email',
        complaintType: 'spam',
      })
    }
  })

  describe('getChannelMetrics()', () => {
    it('returns metrics for a channel', async () => {
      const metrics = await analytics.getChannelMetrics('email', { period: '24h' })

      expect(metrics.channel).toBe('email')
      expect(metrics.sent).toBe(100)
      expect(metrics.delivered).toBe(90)
      expect(metrics.opened).toBe(40)
      expect(metrics.clicked).toBe(15)
      expect(metrics.bounced).toBe(5)
      expect(metrics.complained).toBe(2)
    })

    it('calculates delivery rate', async () => {
      const metrics = await analytics.getChannelMetrics('email', { period: '24h' })

      expect(metrics.deliveryRate).toBeCloseTo(0.9, 2) // 90 / 100
    })

    it('calculates open rate', async () => {
      const metrics = await analytics.getChannelMetrics('email', { period: '24h' })

      expect(metrics.openRate).toBeCloseTo(0.444, 2) // 40 / 90
    })

    it('calculates click rate', async () => {
      const metrics = await analytics.getChannelMetrics('email', { period: '24h' })

      expect(metrics.clickRate).toBeCloseTo(0.167, 2) // 15 / 90
    })

    it('calculates bounce rate', async () => {
      const metrics = await analytics.getChannelMetrics('email', { period: '24h' })

      expect(metrics.bounceRate).toBeCloseTo(0.05, 2) // 5 / 100
    })

    it('calculates complaint rate', async () => {
      const metrics = await analytics.getChannelMetrics('email', { period: '24h' })

      expect(metrics.complaintRate).toBeCloseTo(0.022, 2) // 2 / 90
    })

    it('returns zero rates for empty channel', async () => {
      const metrics = await analytics.getChannelMetrics('push', { period: '24h' })

      expect(metrics.deliveryRate).toBe(0)
      expect(metrics.openRate).toBe(0)
      expect(metrics.clickRate).toBe(0)
    })
  })

  describe('getAggregateMetrics()', () => {
    it('returns aggregate metrics across all channels', async () => {
      const metrics = await analytics.getAggregateMetrics({ period: '24h' })

      expect(metrics.totalSent).toBe(100)
      expect(metrics.totalDelivered).toBe(90)
      expect(metrics.totalOpened).toBe(40)
      expect(metrics.totalClicked).toBe(15)
      expect(metrics.totalBounced).toBe(5)
      expect(metrics.totalComplaints).toBe(2)
    })

    it('includes per-channel breakdown', async () => {
      const metrics = await analytics.getAggregateMetrics({ period: '24h' })

      expect(metrics.byChannel.has('email')).toBe(true)
      expect(metrics.byChannel.get('email')?.sent).toBe(100)
    })
  })

  describe('getTimeSeriesMetrics()', () => {
    it('returns time-series data for a metric', async () => {
      const metrics = await analytics.getTimeSeriesMetrics('sent', 'email', {
        period: '24h',
        groupBy: 'hour',
      })

      expect(metrics.metric).toBe('sent')
      expect(metrics.channel).toBe('email')
      expect(metrics.dataPoints.length).toBeGreaterThan(0)
    })

    it('groups data by specified interval', async () => {
      const hourlyMetrics = await analytics.getTimeSeriesMetrics('sent', 'email', {
        period: '24h',
        groupBy: 'hour',
      })

      const dailyMetrics = await analytics.getTimeSeriesMetrics('sent', 'email', {
        period: '7d',
        groupBy: 'day',
      })

      // Hourly should have more data points than daily
      expect(hourlyMetrics.dataPoints.length).toBeGreaterThanOrEqual(dailyMetrics.dataPoints.length)
    })
  })
})

// =============================================================================
// Export Tests
// =============================================================================

describe('Export', () => {
  let analytics: DeliveryAnalytics
  let storage: AnalyticsStorage

  beforeEach(async () => {
    storage = createMockStorage()
    analytics = createDeliveryAnalytics({ storage })

    // Add some test data
    for (let i = 0; i < 10; i++) {
      await analytics.trackDelivery({
        notificationId: `notif_${i}`,
        channel: 'email',
        event: 'sent',
        timestamp: new Date(),
      })
    }
  })

  describe('exportMetrics()', () => {
    it('exports metrics as JSON', async () => {
      const result = await analytics.exportMetrics({
        format: 'json',
        period: '24h',
      })

      expect(result.contentType).toBe('application/json')
      expect(result.recordCount).toBeGreaterThan(0)
      expect(result.exportedAt).toBeDefined()

      const parsed = JSON.parse(result.data)
      expect(Array.isArray(parsed)).toBe(true)
    })

    it('exports metrics as CSV', async () => {
      const result = await analytics.exportMetrics({
        format: 'csv',
        period: '24h',
      })

      expect(result.contentType).toBe('text/csv')
      expect(result.data).toContain(',') // Has CSV structure
    })

    it('exports metrics as NDJSON', async () => {
      const result = await analytics.exportMetrics({
        format: 'ndjson',
        period: '24h',
      })

      expect(result.contentType).toBe('application/x-ndjson')
      const lines = result.data.split('\n').filter((l) => l.length > 0)
      lines.forEach((line) => {
        expect(() => JSON.parse(line)).not.toThrow()
      })
    })

    it('includes raw events when requested', async () => {
      const result = await analytics.exportMetrics({
        format: 'json',
        period: '24h',
        includeEvents: true,
      })

      const parsed = JSON.parse(result.data)
      const events = parsed.filter((item: Record<string, unknown>) => item.type === 'event')
      expect(events.length).toBeGreaterThan(0)
    })

    it('filters by channel', async () => {
      // Add SMS events
      await analytics.trackDelivery({
        notificationId: 'sms_1',
        channel: 'sms',
        event: 'sent',
        timestamp: new Date(),
      })

      const result = await analytics.exportMetrics({
        format: 'json',
        period: '24h',
        channels: ['email'],
        includeEvents: true,
      })

      const parsed = JSON.parse(result.data)
      const events = parsed.filter((item: Record<string, unknown>) => item.type === 'event')
      events.forEach((event: Record<string, unknown>) => {
        expect(event.channel).toBe('email')
      })
    })
  })
})

// =============================================================================
// Suppression List Tests
// =============================================================================

describe('Suppression List', () => {
  let analytics: DeliveryAnalytics
  let storage: AnalyticsStorage

  beforeEach(() => {
    storage = createMockStorage()
    analytics = createDeliveryAnalytics({
      storage,
      autoSuppressHardBounces: true,
      autoSuppressComplaints: true,
    })
  })

  describe('Auto-suppression', () => {
    it('auto-suppresses hard bounce addresses', async () => {
      await analytics.trackBounce({
        notificationId: 'notif_123',
        channel: 'email',
        bounceType: 'hard',
        bounceCategory: 'invalid_recipient',
        recipient: 'invalid@example.com',
      })

      const isSuppressed = await analytics.isAddressSuppressed('email', 'invalid@example.com')
      expect(isSuppressed).toBe(true)
    })

    it('does not suppress soft bounce addresses', async () => {
      await analytics.trackBounce({
        notificationId: 'notif_123',
        channel: 'email',
        bounceType: 'soft',
        bounceCategory: 'mailbox_full',
        recipient: 'full@example.com',
      })

      const isSuppressed = await analytics.isAddressSuppressed('email', 'full@example.com')
      expect(isSuppressed).toBe(false)
    })

    it('auto-suppresses complaint addresses', async () => {
      await analytics.trackComplaint({
        notificationId: 'notif_123',
        channel: 'email',
        complaintType: 'spam',
        recipient: 'spammer@example.com',
      })

      const isSuppressed = await analytics.isAddressSuppressed('email', 'spammer@example.com')
      expect(isSuppressed).toBe(true)
    })
  })

  describe('addToSuppressionList()', () => {
    it('adds address to suppression list', async () => {
      await analytics.addToSuppressionList({
        address: 'manual@example.com',
        channel: 'email',
        reason: 'manual',
        addedAt: new Date(),
        notes: 'Customer requested removal',
      })

      const isSuppressed = await analytics.isAddressSuppressed('email', 'manual@example.com')
      expect(isSuppressed).toBe(true)
    })

    it('is case-insensitive', async () => {
      await analytics.addToSuppressionList({
        address: 'TEST@Example.COM',
        channel: 'email',
        reason: 'manual',
        addedAt: new Date(),
      })

      const isSuppressed = await analytics.isAddressSuppressed('email', 'test@example.com')
      expect(isSuppressed).toBe(true)
    })
  })

  describe('removeFromSuppressionList()', () => {
    it('removes address from suppression list', async () => {
      await analytics.addToSuppressionList({
        address: 'user@example.com',
        channel: 'email',
        reason: 'manual',
        addedAt: new Date(),
      })

      const removed = await analytics.removeFromSuppressionList('email', 'user@example.com')
      expect(removed).toBe(true)

      const isSuppressed = await analytics.isAddressSuppressed('email', 'user@example.com')
      expect(isSuppressed).toBe(false)
    })

    it('returns false for non-existent address', async () => {
      const removed = await analytics.removeFromSuppressionList('email', 'nonexistent@example.com')
      expect(removed).toBe(false)
    })
  })

  describe('getSuppressionList()', () => {
    it('returns all suppressed addresses', async () => {
      await analytics.addToSuppressionList({
        address: 'user1@example.com',
        channel: 'email',
        reason: 'hard_bounce',
        addedAt: new Date(),
      })

      await analytics.addToSuppressionList({
        address: 'user2@example.com',
        channel: 'email',
        reason: 'complaint',
        addedAt: new Date(),
      })

      const list = await analytics.getSuppressionList()
      expect(list).toHaveLength(2)
    })

    it('filters by channel', async () => {
      await analytics.addToSuppressionList({
        address: 'email@example.com',
        channel: 'email',
        reason: 'hard_bounce',
        addedAt: new Date(),
      })

      await analytics.addToSuppressionList({
        address: '+1234567890',
        channel: 'sms',
        reason: 'complaint',
        addedAt: new Date(),
      })

      const emailList = await analytics.getSuppressionList('email')
      expect(emailList).toHaveLength(1)
      expect(emailList[0].channel).toBe('email')
    })
  })
})

// =============================================================================
// Event Handler Tests
// =============================================================================

describe('Event Handlers', () => {
  let analytics: DeliveryAnalytics
  let storage: AnalyticsStorage

  beforeEach(() => {
    storage = createMockStorage()
    analytics = createDeliveryAnalytics({ storage })
  })

  describe('on() and off()', () => {
    it('registers and triggers event handler', async () => {
      const handler = vi.fn()
      analytics.on('delivered', handler)

      await analytics.trackDelivery({
        notificationId: 'notif_123',
        channel: 'email',
        event: 'delivered',
        timestamp: new Date(),
      })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ event: 'delivered' }))
    })

    it('removes event handler with off()', async () => {
      const handler = vi.fn()
      analytics.on('delivered', handler)
      analytics.off('delivered', handler)

      await analytics.trackDelivery({
        notificationId: 'notif_123',
        channel: 'email',
        event: 'delivered',
        timestamp: new Date(),
      })

      expect(handler).not.toHaveBeenCalled()
    })

    it('supports multiple handlers for same event', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      analytics.on('opened', handler1)
      analytics.on('opened', handler2)

      await analytics.trackOpen({
        notificationId: 'notif_123',
        channel: 'email',
      })

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
    })
  })
})

// =============================================================================
// Query Methods Tests
// =============================================================================

describe('Query Methods', () => {
  let analytics: DeliveryAnalytics
  let storage: AnalyticsStorage

  beforeEach(async () => {
    storage = createMockStorage()
    analytics = createDeliveryAnalytics({ storage })

    // Track events for a notification
    await analytics.trackDelivery({
      notificationId: 'notif_123',
      channel: 'email',
      event: 'sent',
      timestamp: new Date('2024-01-15T10:00:00Z'),
      userId: 'user_1',
    })

    await analytics.trackDelivery({
      notificationId: 'notif_123',
      channel: 'email',
      event: 'delivered',
      timestamp: new Date('2024-01-15T10:01:00Z'),
      userId: 'user_1',
    })

    await analytics.trackOpen({
      notificationId: 'notif_123',
      channel: 'email',
      userId: 'user_1',
    })

    // Track events for another user
    await analytics.trackDelivery({
      notificationId: 'notif_456',
      channel: 'email',
      event: 'sent',
      timestamp: new Date('2024-01-15T11:00:00Z'),
      userId: 'user_2',
    })
  })

  describe('getNotificationEvents()', () => {
    it('returns events for a notification in order', async () => {
      const events = await analytics.getNotificationEvents('notif_123')

      expect(events).toHaveLength(3)
      expect(events[0].event).toBe('sent')
      expect(events[1].event).toBe('delivered')
      expect(events[2].event).toBe('opened')
    })

    it('returns empty array for unknown notification', async () => {
      const events = await analytics.getNotificationEvents('unknown')
      expect(events).toHaveLength(0)
    })
  })

  describe('getUserEvents()', () => {
    it('returns events for a user', async () => {
      const events = await analytics.getUserEvents('user_1')

      expect(events.length).toBe(3)
      events.forEach((e) => {
        expect(e.userId).toBe('user_1')
      })
    })

    it('limits results', async () => {
      const events = await analytics.getUserEvents('user_1', 2)
      expect(events).toHaveLength(2)
    })

    it('returns events in reverse chronological order', async () => {
      const events = await analytics.getUserEvents('user_1')

      for (let i = 0; i < events.length - 1; i++) {
        expect(events[i].timestamp.getTime()).toBeGreaterThanOrEqual(events[i + 1].timestamp.getTime())
      }
    })
  })
})

// =============================================================================
// Integration with NotificationRouter Tests
// =============================================================================

describe('Integration with NotificationRouter', () => {
  it('tracks delivery events when attached to router', async () => {
    const storage = createMockStorage()
    const analytics = createDeliveryAnalytics({ storage })

    const router = createNotificationRouter({
      analytics,
    })

    const sendFn = vi.fn().mockResolvedValue({ messageId: 'msg_123' })
    router.registerChannel({
      type: 'email',
      send: sendFn,
      validateRecipient: vi.fn().mockResolvedValue(true),
    })

    const result = await router.send({
      userId: 'user_1',
      channels: ['email'],
      content: { subject: 'Test', body: 'Test body' },
      recipient: { email: 'user@example.com' },
    })

    expect(result.status).toBe('sent')

    // Wait for async analytics tracking to complete
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Check that analytics tracked the event
    const events = await analytics.getNotificationEvents(result.notificationId)
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].event).toBe('sent')
  })

  it('can attach analytics to existing router', async () => {
    const storage = createMockStorage()
    const analytics = createDeliveryAnalytics({ storage })

    const router = createNotificationRouter()

    // Attach analytics after creation
    router.attachAnalytics(analytics)

    expect(router.getAnalytics()).toBe(analytics)

    const sendFn = vi.fn().mockResolvedValue({ messageId: 'msg_123' })
    router.registerChannel({
      type: 'email',
      send: sendFn,
      validateRecipient: vi.fn().mockResolvedValue(true),
    })

    const result = await router.send({
      userId: 'user_1',
      channels: ['email'],
      content: { subject: 'Test', body: 'Test body' },
      recipient: { email: 'user@example.com' },
    })

    // Wait for async analytics tracking to complete
    await new Promise((resolve) => setTimeout(resolve, 50))

    const events = await analytics.getNotificationEvents(result.notificationId)
    expect(events.length).toBeGreaterThan(0)
  })

  it('tracks failed deliveries', async () => {
    const storage = createMockStorage()
    const analytics = createDeliveryAnalytics({ storage })

    const router = createNotificationRouter({
      analytics,
    })

    const sendFn = vi.fn().mockRejectedValue(new Error('Delivery failed'))
    router.registerChannel({
      type: 'email',
      send: sendFn,
      validateRecipient: vi.fn().mockResolvedValue(true),
    })

    const result = await router.send({
      userId: 'user_1',
      channels: ['email'],
      content: { subject: 'Test', body: 'Test body' },
      recipient: { email: 'user@example.com' },
      retryPolicy: { maxAttempts: 1 },
    })

    expect(result.status).toBe('failed')

    // Wait for async analytics tracking to complete
    await new Promise((resolve) => setTimeout(resolve, 50))

    const events = await analytics.getNotificationEvents(result.notificationId)
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].event).toBe('failed')
  })
})
