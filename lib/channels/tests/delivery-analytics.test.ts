/**
 * Tests for DeliveryAnalytics
 *
 * Tests comprehensive delivery tracking and analytics:
 * - Delivery status tracking lifecycle
 * - Open/click tracking URL generation and handling
 * - Analytics aggregation and time-series queries
 * - Suppression list management
 * - Recipient engagement metrics
 * - Channel comparison reports
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  DeliveryAnalytics,
  createDeliveryAnalytics,
  type DeliveryEvent,
  type SentEvent,
  type DeliveredEvent,
  type OpenedEvent,
  type ClickedEvent,
  type BouncedEvent,
  type ComplainedEvent,
} from '../delivery-analytics'

describe('DeliveryAnalytics', () => {
  let analytics: DeliveryAnalytics

  beforeEach(() => {
    analytics = createDeliveryAnalytics({
      tracking: {
        baseUrl: 'https://track.dotdo.dev',
      },
    })
  })

  describe('constructor', () => {
    it('should create analytics with default options', () => {
      const defaultAnalytics = createDeliveryAnalytics()
      expect(defaultAnalytics).toBeInstanceOf(DeliveryAnalytics)
    })

    it('should create analytics with custom options', () => {
      const customAnalytics = createDeliveryAnalytics({
        autoSuppressOnBounce: false,
        autoSuppressOnComplaint: false,
        maxEventsInMemory: 5000,
      })
      expect(customAnalytics).toBeInstanceOf(DeliveryAnalytics)
    })
  })

  describe('trackDelivery', () => {
    it('should track a sent event', async () => {
      const event: SentEvent = {
        messageId: 'msg-001',
        channel: 'email',
        recipient: 'user@example.com',
        status: 'sent',
        timestamp: Date.now(),
        providerMessageId: 'provider-123',
        provider: 'sendgrid',
      }

      await analytics.trackDelivery(event)

      const history = analytics.getMessageHistory('msg-001')
      expect(history).toHaveLength(1)
      expect(history[0]!.status).toBe('sent')
    })

    it('should track a delivered event', async () => {
      const sentEvent: SentEvent = {
        messageId: 'msg-002',
        channel: 'email',
        recipient: 'user@example.com',
        status: 'sent',
        timestamp: Date.now() - 1000,
      }

      const deliveredEvent: DeliveredEvent = {
        messageId: 'msg-002',
        channel: 'email',
        recipient: 'user@example.com',
        status: 'delivered',
        timestamp: Date.now(),
        deliveryLatencyMs: 1000,
      }

      await analytics.trackDelivery(sentEvent)
      await analytics.trackDelivery(deliveredEvent)

      const status = analytics.getMessageStatus('msg-002')
      expect(status).toBe('delivered')
    })

    it('should track an opened event', async () => {
      const openedEvent: OpenedEvent = {
        messageId: 'msg-003',
        channel: 'email',
        recipient: 'user@example.com',
        status: 'opened',
        timestamp: Date.now(),
        openCount: 1,
        userAgent: 'Mozilla/5.0',
        deviceType: 'desktop',
      }

      await analytics.trackDelivery(openedEvent)

      const history = analytics.getMessageHistory('msg-003')
      expect(history[0]!.status).toBe('opened')
      expect((history[0] as OpenedEvent).deviceType).toBe('desktop')
    })

    it('should track a clicked event', async () => {
      const clickedEvent: ClickedEvent = {
        messageId: 'msg-004',
        channel: 'email',
        recipient: 'user@example.com',
        status: 'clicked',
        timestamp: Date.now(),
        linkId: 'cta-button',
        destinationUrl: 'https://app.dotdo.dev',
      }

      await analytics.trackDelivery(clickedEvent)

      const history = analytics.getMessageHistory('msg-004')
      expect(history[0]!.status).toBe('clicked')
      expect((history[0] as ClickedEvent).linkId).toBe('cta-button')
    })

    it('should add timestamp if not provided', async () => {
      const event: DeliveryEvent = {
        messageId: 'msg-005',
        channel: 'sms',
        recipient: '+1234567890',
        status: 'sent',
        timestamp: 0, // Will be overwritten
      }

      // Track without timestamp
      delete (event as Partial<DeliveryEvent>).timestamp
      await analytics.trackDelivery(event as DeliveryEvent)

      const history = analytics.getMessageHistory('msg-005')
      expect(history[0]!.timestamp).toBeGreaterThan(0)
    })

    it('should call onEvent callback', async () => {
      const events: DeliveryEvent[] = []
      const callbackAnalytics = createDeliveryAnalytics({
        onEvent: (event) => {
          events.push(event)
        },
      })

      await callbackAnalytics.trackDelivery({
        messageId: 'msg-006',
        channel: 'email',
        recipient: 'user@example.com',
        status: 'sent',
        timestamp: Date.now(),
      })

      expect(events).toHaveLength(1)
      expect(events[0]!.messageId).toBe('msg-006')
    })
  })

  describe('updateStatus', () => {
    it('should update existing message status', async () => {
      await analytics.trackDelivery({
        messageId: 'msg-010',
        channel: 'email',
        recipient: 'user@example.com',
        status: 'sent',
        timestamp: Date.now(),
      })

      await analytics.updateStatus('msg-010', 'delivered', {
        deliveryLatencyMs: 500,
      } as Partial<DeliveredEvent>)

      const status = analytics.getMessageStatus('msg-010')
      expect(status).toBe('delivered')
    })

    it('should throw for unknown message', async () => {
      await expect(
        analytics.updateStatus('unknown-msg', 'delivered')
      ).rejects.toThrow('Message not found')
    })
  })

  describe('trackBatch', () => {
    it('should track multiple events in batch', async () => {
      const events: SentEvent[] = [
        {
          messageId: 'batch-001',
          channel: 'email',
          recipient: 'user1@example.com',
          status: 'sent',
          timestamp: Date.now(),
        },
        {
          messageId: 'batch-002',
          channel: 'email',
          recipient: 'user2@example.com',
          status: 'sent',
          timestamp: Date.now(),
        },
        {
          messageId: 'batch-003',
          channel: 'email',
          recipient: 'user3@example.com',
          status: 'sent',
          timestamp: Date.now(),
        },
      ]

      await analytics.trackBatch(events)

      expect(analytics.getMessageHistory('batch-001')).toHaveLength(1)
      expect(analytics.getMessageHistory('batch-002')).toHaveLength(1)
      expect(analytics.getMessageHistory('batch-003')).toHaveLength(1)
    })
  })

  describe('URL generation', () => {
    it('should generate click tracking URL', () => {
      const url = analytics.generateClickUrl({
        messageId: 'msg-020',
        linkId: 'cta',
        destinationUrl: 'https://app.dotdo.dev/signup',
      })

      expect(url).toMatch(/^https:\/\/track\.dotdo\.dev\/t\/c\//)
    })

    it('should generate click URL with user ID', () => {
      const url = analytics.generateClickUrl({
        messageId: 'msg-021',
        linkId: 'cta',
        destinationUrl: 'https://app.dotdo.dev',
        userId: 'user-123',
      })

      expect(url).toContain('/t/c/')
    })

    it('should generate open tracking pixel URL', () => {
      const url = analytics.generateOpenPixelUrl({
        messageId: 'msg-022',
      })

      expect(url).toMatch(/^https:\/\/track\.dotdo\.dev\/t\/o\/.*\.gif$/)
    })

    it('should throw without tracking config', () => {
      const noTrackingAnalytics = createDeliveryAnalytics()

      expect(() =>
        noTrackingAnalytics.generateClickUrl({
          messageId: 'msg-023',
          linkId: 'cta',
          destinationUrl: 'https://example.com',
        })
      ).toThrow('Tracking not configured')
    })
  })

  describe('URL parsing and handling', () => {
    it('should handle click and return destination URL', async () => {
      // First track the message
      await analytics.trackDelivery({
        messageId: 'msg-030',
        channel: 'email',
        recipient: 'user@example.com',
        status: 'sent',
        timestamp: Date.now(),
      })

      // Generate and handle click
      const clickUrl = analytics.generateClickUrl({
        messageId: 'msg-030',
        linkId: 'signup-btn',
        destinationUrl: 'https://app.dotdo.dev/signup',
      })

      // Extract the encoded path
      const encodedPath = clickUrl.split('/t/c/')[1]!
      const result = await analytics.handleClick(encodedPath, {
        userAgent: 'Mozilla/5.0',
        ipAddress: '192.168.1.1',
      })

      expect(result.destinationUrl).toBe('https://app.dotdo.dev/signup')
      expect(result.event.status).toBe('clicked')
      expect(result.event.linkId).toBe('signup-btn')
    })

    it('should handle open pixel request', async () => {
      // First track the message
      await analytics.trackDelivery({
        messageId: 'msg-031',
        channel: 'email',
        recipient: 'user@example.com',
        status: 'sent',
        timestamp: Date.now(),
      })

      // Generate and handle open
      const pixelUrl = analytics.generateOpenPixelUrl({
        messageId: 'msg-031',
      })

      // Extract the encoded path (remove .gif extension)
      const encodedPath = pixelUrl.split('/t/o/')[1]!.replace('.gif', '')
      const event = await analytics.handleOpen(encodedPath, {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)',
      })

      expect(event.status).toBe('opened')
      expect(event.deviceType).toBe('mobile')
    })

    it('should throw on invalid click data', async () => {
      const invalidEncoded = Buffer.from('invalid').toString('base64url')
      await expect(
        analytics.handleClick(invalidEncoded)
      ).rejects.toThrow('Invalid click tracking data')
    })
  })

  describe('suppression list', () => {
    it('should auto-suppress on hard bounce', async () => {
      const bounceEvent: BouncedEvent = {
        messageId: 'msg-040',
        channel: 'email',
        recipient: 'invalid@example.com',
        status: 'bounced',
        timestamp: Date.now(),
        bounceType: 'hard',
        bounceReason: 'User unknown',
      }

      await analytics.trackDelivery(bounceEvent)

      expect(analytics.isSuppressed('invalid@example.com')).toBe(true)
    })

    it('should auto-suppress on complaint', async () => {
      const complaintEvent: ComplainedEvent = {
        messageId: 'msg-041',
        channel: 'email',
        recipient: 'angry@example.com',
        status: 'complained',
        timestamp: Date.now(),
        complaintType: 'abuse',
      }

      await analytics.trackDelivery(complaintEvent)

      expect(analytics.isSuppressed('angry@example.com')).toBe(true)
    })

    it('should not auto-suppress on soft bounce', async () => {
      const softBounceEvent: BouncedEvent = {
        messageId: 'msg-042',
        channel: 'email',
        recipient: 'temp@example.com',
        status: 'soft_bounced',
        timestamp: Date.now(),
        bounceType: 'soft',
        bounceReason: 'Mailbox full',
      }

      await analytics.trackDelivery(softBounceEvent)

      expect(analytics.isSuppressed('temp@example.com')).toBe(false)
    })

    it('should allow manual suppression', () => {
      analytics.suppress('manual@example.com', 'manual')
      expect(analytics.isSuppressed('manual@example.com')).toBe(true)
    })

    it('should support channel-specific suppression', () => {
      analytics.suppress('user@example.com', 'unsubscribe', 'email')

      expect(analytics.isSuppressed('user@example.com', 'email')).toBe(true)
      expect(analytics.isSuppressed('user@example.com', 'sms')).toBe(false)
    })

    it('should allow unsuppression', () => {
      analytics.suppress('removed@example.com', 'manual')
      expect(analytics.isSuppressed('removed@example.com')).toBe(true)

      analytics.unsuppress('removed@example.com')
      expect(analytics.isSuppressed('removed@example.com')).toBe(false)
    })

    it('should get suppression list with filters', () => {
      analytics.suppress('bounce1@example.com', 'bounce')
      analytics.suppress('bounce2@example.com', 'bounce')
      analytics.suppress('complaint@example.com', 'complaint')

      const bounces = analytics.getSuppressionList({ reason: 'bounce' })
      expect(bounces).toHaveLength(2)

      const complaints = analytics.getSuppressionList({ reason: 'complaint' })
      expect(complaints).toHaveLength(1)
    })
  })

  describe('recipient metrics', () => {
    it('should track recipient metrics', async () => {
      const recipient = 'metrics@example.com'

      // Send
      await analytics.trackDelivery({
        messageId: 'metric-001',
        channel: 'email',
        recipient,
        status: 'sent',
        timestamp: Date.now(),
      })

      // Open
      await analytics.trackDelivery({
        messageId: 'metric-001',
        channel: 'email',
        recipient,
        status: 'opened',
        timestamp: Date.now(),
      })

      // Click
      await analytics.trackDelivery({
        messageId: 'metric-001',
        channel: 'email',
        recipient,
        status: 'clicked',
        timestamp: Date.now(),
        linkId: 'cta',
        destinationUrl: 'https://example.com',
      } as ClickedEvent)

      const metrics = analytics.getRecipientMetrics(recipient)
      expect(metrics).toBeDefined()
      expect(metrics!.totalReceived).toBe(1)
      expect(metrics!.totalOpened).toBe(1)
      expect(metrics!.totalClicked).toBe(1)
      expect(metrics!.engagementScore).toBeGreaterThan(50) // Started at 50, increased with opens/clicks
    })

    it('should decrease engagement score on bounce', async () => {
      const recipient = 'bouncer@example.com'

      // First send a normal message to establish baseline
      await analytics.trackDelivery({
        messageId: 'bounce-metric-001',
        channel: 'email',
        recipient,
        status: 'sent',
        timestamp: Date.now(),
      })

      const initialMetrics = analytics.getRecipientMetrics(recipient)
      const initialScore = initialMetrics!.engagementScore

      // Then bounce
      await analytics.trackDelivery({
        messageId: 'bounce-metric-002',
        channel: 'email',
        recipient,
        status: 'bounced',
        timestamp: Date.now(),
        bounceType: 'hard',
      } as BouncedEvent)

      const finalMetrics = analytics.getRecipientMetrics(recipient)
      expect(finalMetrics!.engagementScore).toBeLessThan(initialScore)
    })

    it('should get top recipients by engagement', async () => {
      // Create several recipients with different engagement
      const recipients = ['high@example.com', 'medium@example.com', 'low@example.com']

      // High engagement - send, open, click
      for (let i = 0; i < 3; i++) {
        await analytics.trackDelivery({
          messageId: `high-${i}`,
          channel: 'email',
          recipient: recipients[0]!,
          status: 'opened',
          timestamp: Date.now(),
        })
      }

      // Medium engagement - just sends
      for (let i = 0; i < 3; i++) {
        await analytics.trackDelivery({
          messageId: `medium-${i}`,
          channel: 'email',
          recipient: recipients[1]!,
          status: 'sent',
          timestamp: Date.now(),
        })
      }

      // Low engagement - bounces
      await analytics.trackDelivery({
        messageId: 'low-1',
        channel: 'email',
        recipient: recipients[2]!,
        status: 'bounced',
        timestamp: Date.now(),
        bounceType: 'hard',
      } as BouncedEvent)

      const topRecipients = analytics.getTopRecipients({
        startTime: 0,
        endTime: Date.now() + 1000,
        limit: 10,
        sortBy: 'engagementScore',
        sortOrder: 'desc',
      })

      expect(topRecipients[0]!.recipient).toBe('high@example.com')
    })
  })

  describe('analytics queries', () => {
    beforeEach(async () => {
      // Seed with test data
      const now = Date.now()
      const day = 24 * 60 * 60 * 1000

      // Day 1: 10 sent, 8 delivered, 4 opened, 2 clicked
      for (let i = 0; i < 10; i++) {
        await analytics.trackDelivery({
          messageId: `day1-${i}`,
          channel: 'email',
          recipient: `user${i}@example.com`,
          status: 'sent',
          timestamp: now - day,
          campaignId: 'campaign-001',
        })
      }

      for (let i = 0; i < 8; i++) {
        await analytics.trackDelivery({
          messageId: `day1-${i}`,
          channel: 'email',
          recipient: `user${i}@example.com`,
          status: 'delivered',
          timestamp: now - day + 1000,
          deliveryLatencyMs: 100 + i * 50,
        } as DeliveredEvent)
      }

      for (let i = 0; i < 4; i++) {
        await analytics.trackDelivery({
          messageId: `day1-${i}`,
          channel: 'email',
          recipient: `user${i}@example.com`,
          status: 'opened',
          timestamp: now - day + 60000,
        })
      }

      for (let i = 0; i < 2; i++) {
        await analytics.trackDelivery({
          messageId: `day1-${i}`,
          channel: 'email',
          recipient: `user${i}@example.com`,
          status: 'clicked',
          timestamp: now - day + 120000,
          linkId: 'cta',
          destinationUrl: 'https://example.com',
        } as ClickedEvent)
      }

      // Day 2: SMS messages
      for (let i = 0; i < 5; i++) {
        await analytics.trackDelivery({
          messageId: `day2-sms-${i}`,
          channel: 'sms',
          recipient: `+123456789${i}`,
          status: 'sent',
          timestamp: now,
        })
      }

      for (let i = 0; i < 5; i++) {
        await analytics.trackDelivery({
          messageId: `day2-sms-${i}`,
          channel: 'sms',
          recipient: `+123456789${i}`,
          status: 'delivered',
          timestamp: now + 500,
          deliveryLatencyMs: 50,
        } as DeliveredEvent)
      }
    })

    it('should get channel report', async () => {
      const now = Date.now()
      const report = await analytics.getChannelReport('email', {
        startTime: now - 2 * 24 * 60 * 60 * 1000,
        endTime: now + 1000,
        bucket: 'day',
      })

      expect(report.channel).toBe('email')
      expect(report.summary.sent).toBe(10)
      expect(report.summary.delivered).toBe(8)
      expect(report.summary.opened).toBe(4)
      expect(report.summary.clicked).toBe(2)
      expect(report.summary.deliveryRate).toBe(0.8)
      expect(report.summary.openRate).toBe(0.5) // 4 opened / 8 delivered
      expect(report.summary.clickRate).toBe(0.25) // 2 clicked / 8 delivered
      expect(report.timeSeries.length).toBeGreaterThan(0)
    })

    it('should get channel report with campaign filter', async () => {
      const now = Date.now()
      const report = await analytics.getChannelReport('email', {
        startTime: now - 2 * 24 * 60 * 60 * 1000,
        endTime: now + 1000,
        campaignId: 'campaign-001',
      })

      expect(report.summary.sent).toBe(10)
    })

    it('should get channel comparison report', async () => {
      const now = Date.now()
      const report = await analytics.getChannelComparisonReport({
        startTime: now - 2 * 24 * 60 * 60 * 1000,
        endTime: now + 1000,
      })

      expect(report.byChannel.size).toBe(2)
      expect(report.byChannel.get('email')!.sent).toBe(10)
      expect(report.byChannel.get('sms')!.sent).toBe(5)
      expect(report.totals.sent).toBe(15)
    })

    it('should calculate latency percentiles', async () => {
      const now = Date.now()
      const report = await analytics.getChannelReport('email', {
        startTime: now - 2 * 24 * 60 * 60 * 1000,
        endTime: now + 1000,
      })

      expect(report.summary.avgDeliveryLatencyMs).toBeGreaterThan(0)
      expect(report.summary.p95DeliveryLatencyMs).toBeGreaterThan(0)
      expect(report.summary.p99DeliveryLatencyMs).toBeGreaterThan(0)
    })
  })

  describe('message history', () => {
    it('should get full message history', async () => {
      const messageId = 'history-001'

      await analytics.trackDelivery({
        messageId,
        channel: 'email',
        recipient: 'user@example.com',
        status: 'sent',
        timestamp: Date.now(),
      })

      await analytics.trackDelivery({
        messageId,
        channel: 'email',
        recipient: 'user@example.com',
        status: 'delivered',
        timestamp: Date.now() + 1000,
      })

      await analytics.trackDelivery({
        messageId,
        channel: 'email',
        recipient: 'user@example.com',
        status: 'opened',
        timestamp: Date.now() + 60000,
      })

      const history = analytics.getMessageHistory(messageId)
      expect(history).toHaveLength(3)
      expect(history[0]!.status).toBe('sent')
      expect(history[1]!.status).toBe('delivered')
      expect(history[2]!.status).toBe('opened')
    })

    it('should get recipient history', async () => {
      const recipient = 'history@example.com'

      await analytics.trackDelivery({
        messageId: 'r-hist-001',
        channel: 'email',
        recipient,
        status: 'sent',
        timestamp: Date.now(),
      })

      await analytics.trackDelivery({
        messageId: 'r-hist-002',
        channel: 'email',
        recipient,
        status: 'sent',
        timestamp: Date.now() + 1000,
      })

      const history = analytics.getRecipientHistory(recipient)
      expect(history.length).toBeGreaterThanOrEqual(2)
    })

    it('should return empty for unknown message', () => {
      const history = analytics.getMessageHistory('unknown-message')
      expect(history).toHaveLength(0)
    })
  })

  describe('stats', () => {
    it('should return analytics stats', async () => {
      await analytics.trackDelivery({
        messageId: 'stats-001',
        channel: 'email',
        recipient: 'user@example.com',
        status: 'sent',
        timestamp: Date.now(),
      })

      const stats = analytics.getStats()
      expect(stats.totalMessages).toBe(1)
      expect(stats.totalRecipients).toBe(1)
      expect(stats.eventsByChannel.email).toBe(1)
    })
  })

  describe('memory management', () => {
    it('should evict oldest events when limit reached', async () => {
      const limitedAnalytics = createDeliveryAnalytics({
        maxEventsInMemory: 10,
      })

      // Add 15 messages
      for (let i = 0; i < 15; i++) {
        await limitedAnalytics.trackDelivery({
          messageId: `evict-${i}`,
          channel: 'email',
          recipient: 'user@example.com',
          status: 'sent',
          timestamp: Date.now() + i,
        })
      }

      const stats = limitedAnalytics.getStats()
      expect(stats.totalMessages).toBeLessThanOrEqual(10)
    })
  })

  describe('clear', () => {
    it('should clear all analytics data', async () => {
      await analytics.trackDelivery({
        messageId: 'clear-001',
        channel: 'email',
        recipient: 'user@example.com',
        status: 'sent',
        timestamp: Date.now(),
      })

      analytics.suppress('user@example.com', 'manual')

      analytics.clear()

      expect(analytics.getStats().totalMessages).toBe(0)
      expect(analytics.getStats().totalRecipients).toBe(0)
      expect(analytics.getStats().totalSuppressions).toBe(0)
      expect(analytics.isSuppressed('user@example.com')).toBe(false)
    })
  })

  describe('disable auto-suppression', () => {
    it('should not auto-suppress when disabled', async () => {
      const noAutoSuppressAnalytics = createDeliveryAnalytics({
        autoSuppressOnBounce: false,
        autoSuppressOnComplaint: false,
        autoSuppressOnUnsubscribe: false,
      })

      await noAutoSuppressAnalytics.trackDelivery({
        messageId: 'no-suppress-001',
        channel: 'email',
        recipient: 'bounce@example.com',
        status: 'bounced',
        timestamp: Date.now(),
        bounceType: 'hard',
      } as BouncedEvent)

      expect(noAutoSuppressAnalytics.isSuppressed('bounce@example.com')).toBe(false)
    })
  })
})
