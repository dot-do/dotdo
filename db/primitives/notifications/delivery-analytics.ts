/**
 * Delivery Analytics - Comprehensive notification delivery tracking
 *
 * Provides delivery analytics with:
 * - **Open/click tracking**: Track email opens and link clicks with pixel/redirect tracking
 * - **Delivery status webhooks**: Process webhook callbacks from providers (SendGrid, Mailgun, etc.)
 * - **Bounce/complaint handling**: Track hard/soft bounces and spam complaints
 * - **Per-channel metrics**: Delivery rate, latency, throughput per channel
 * - **Analytics dashboard export**: Export metrics for dashboards in various formats
 *
 * @example
 * ```typescript
 * import { createDeliveryAnalytics } from 'db/primitives/notifications'
 *
 * const analytics = createDeliveryAnalytics({
 *   storage: ctx.storage,
 *   webhookSecret: 'whsec_...',
 * })
 *
 * // Track delivery event
 * analytics.trackDelivery({
 *   notificationId: 'notif_123',
 *   channel: 'email',
 *   event: 'delivered',
 *   timestamp: new Date(),
 * })
 *
 * // Process webhook from email provider
 * await analytics.processWebhook({
 *   provider: 'sendgrid',
 *   payload: webhookPayload,
 *   signature: req.headers['x-twilio-email-event-webhook-signature'],
 * })
 *
 * // Get channel metrics
 * const metrics = await analytics.getChannelMetrics('email', { period: '24h' })
 *
 * // Export for dashboard
 * const export = await analytics.exportMetrics({ format: 'json', period: '7d' })
 * ```
 *
 * @module db/primitives/notifications
 */

import { type ChannelType } from './router'

// =============================================================================
// Types - Tracking Events
// =============================================================================

/**
 * Delivery event types
 */
export type DeliveryEventType =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'complained'
  | 'unsubscribed'
  | 'failed'
  | 'deferred'

/**
 * Bounce classification
 */
export type BounceType = 'hard' | 'soft'

/**
 * Bounce category for more granular classification
 */
export type BounceCategory =
  | 'invalid_recipient'
  | 'mailbox_full'
  | 'blocked'
  | 'content_rejected'
  | 'technical_failure'
  | 'policy_rejection'
  | 'unknown'

/**
 * Complaint type classification
 */
export type ComplaintType = 'spam' | 'abuse' | 'virus' | 'other'

/**
 * Base delivery event
 */
export interface DeliveryEvent {
  /** Unique event ID */
  id: string
  /** Associated notification ID */
  notificationId: string
  /** Delivery channel */
  channel: ChannelType
  /** Event type */
  event: DeliveryEventType
  /** When the event occurred */
  timestamp: Date
  /** Provider message ID */
  messageId?: string
  /** Recipient email/phone */
  recipient?: string
  /** User ID */
  userId?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Open tracking event
 */
export interface OpenEvent extends DeliveryEvent {
  event: 'opened'
  /** User agent string */
  userAgent?: string
  /** IP address */
  ipAddress?: string
  /** Whether this is the first open */
  firstOpen?: boolean
  /** Device type inferred from UA */
  deviceType?: 'desktop' | 'mobile' | 'tablet' | 'unknown'
}

/**
 * Click tracking event
 */
export interface ClickEvent extends DeliveryEvent {
  event: 'clicked'
  /** Clicked URL */
  url: string
  /** Link tag/label */
  linkTag?: string
  /** User agent string */
  userAgent?: string
  /** IP address */
  ipAddress?: string
}

/**
 * Bounce event
 */
export interface BounceEvent extends DeliveryEvent {
  event: 'bounced'
  /** Hard or soft bounce */
  bounceType: BounceType
  /** Bounce category */
  bounceCategory: BounceCategory
  /** Bounce reason/message */
  bounceReason?: string
  /** SMTP error code */
  smtpCode?: string
  /** SMTP enhanced status code */
  enhancedStatusCode?: string
}

/**
 * Complaint (spam report) event
 */
export interface ComplaintEvent extends DeliveryEvent {
  event: 'complained'
  /** Type of complaint */
  complaintType: ComplaintType
  /** Feedback loop source (e.g., 'aol', 'hotmail') */
  feedbackLoop?: string
}

// =============================================================================
// Types - Tracking URLs
// =============================================================================

/**
 * Tracking URL configuration
 */
export interface TrackingConfig {
  /** Base URL for tracking */
  baseUrl: string
  /** Secret for signing tracking URLs */
  signingSecret: string
  /** Open tracking pixel enabled */
  openTrackingEnabled?: boolean
  /** Click tracking enabled */
  clickTrackingEnabled?: boolean
  /** Custom tracking domain */
  trackingDomain?: string
}

/**
 * Generated tracking URLs for a notification
 */
export interface TrackingUrls {
  /** Open tracking pixel URL */
  openTrackingPixel?: string
  /** Map of original URLs to tracked URLs */
  trackedLinks: Map<string, string>
}

// =============================================================================
// Types - Webhook Processing
// =============================================================================

/**
 * Supported webhook providers
 */
export type WebhookProvider =
  | 'sendgrid'
  | 'mailgun'
  | 'ses'
  | 'postmark'
  | 'sparkpost'
  | 'mailchimp'
  | 'twilio'
  | 'generic'

/**
 * Webhook request for processing
 */
export interface WebhookRequest {
  /** Provider sending the webhook */
  provider: WebhookProvider
  /** Raw webhook payload */
  payload: unknown
  /** Webhook signature for verification */
  signature?: string
  /** Request headers */
  headers?: Record<string, string>
  /** Request timestamp */
  timestamp?: Date
}

/**
 * Result of webhook processing
 */
export interface WebhookResult {
  /** Whether webhook was processed successfully */
  success: boolean
  /** Number of events processed */
  eventsProcessed: number
  /** Events that were extracted */
  events: DeliveryEvent[]
  /** Any errors encountered */
  errors?: string[]
}

/**
 * Webhook handler function
 */
export type WebhookHandler = (event: DeliveryEvent) => void | Promise<void>

// =============================================================================
// Types - Metrics
// =============================================================================

/**
 * Time period for metrics aggregation
 */
export type MetricsPeriod = '1h' | '6h' | '12h' | '24h' | '7d' | '30d' | 'custom'

/**
 * Metrics query options
 */
export interface MetricsQueryOptions {
  /** Time period */
  period: MetricsPeriod
  /** Custom start date (for 'custom' period) */
  startDate?: Date
  /** Custom end date (for 'custom' period) */
  endDate?: Date
  /** Group by time bucket (e.g., 'hour', 'day') */
  groupBy?: 'hour' | 'day' | 'week'
  /** Filter by channel */
  channel?: ChannelType
  /** Filter by user */
  userId?: string
}

/**
 * Per-channel delivery metrics
 */
export interface ChannelMetrics {
  /** Channel type */
  channel: ChannelType
  /** Time period */
  period: MetricsPeriod
  /** Total notifications sent */
  sent: number
  /** Total delivered */
  delivered: number
  /** Total opened */
  opened: number
  /** Total clicked */
  clicked: number
  /** Total bounced */
  bounced: number
  /** Hard bounces */
  hardBounces: number
  /** Soft bounces */
  softBounces: number
  /** Total complaints */
  complained: number
  /** Total failed */
  failed: number
  /** Delivery rate (delivered / sent) */
  deliveryRate: number
  /** Open rate (opened / delivered) */
  openRate: number
  /** Click rate (clicked / delivered) */
  clickRate: number
  /** Bounce rate (bounced / sent) */
  bounceRate: number
  /** Complaint rate (complained / delivered) */
  complaintRate: number
  /** Average delivery latency in ms */
  avgLatencyMs: number
  /** P50 delivery latency in ms */
  p50LatencyMs: number
  /** P95 delivery latency in ms */
  p95LatencyMs: number
  /** P99 delivery latency in ms */
  p99LatencyMs: number
  /** Throughput (messages per minute) */
  throughput: number
}

/**
 * Time-series metrics data point
 */
export interface MetricsDataPoint {
  /** Timestamp */
  timestamp: Date
  /** Metric value */
  value: number
}

/**
 * Time-series metrics
 */
export interface TimeSeriesMetrics {
  /** Metric name */
  metric: string
  /** Channel */
  channel: ChannelType
  /** Data points */
  dataPoints: MetricsDataPoint[]
}

/**
 * Aggregate metrics across all channels
 */
export interface AggregateMetrics {
  /** Time period */
  period: MetricsPeriod
  /** Total sent across all channels */
  totalSent: number
  /** Total delivered */
  totalDelivered: number
  /** Total opened */
  totalOpened: number
  /** Total clicked */
  totalClicked: number
  /** Total bounced */
  totalBounced: number
  /** Total complaints */
  totalComplaints: number
  /** Overall delivery rate */
  overallDeliveryRate: number
  /** Overall open rate */
  overallOpenRate: number
  /** Overall click rate */
  overallClickRate: number
  /** Per-channel breakdown */
  byChannel: Map<ChannelType, ChannelMetrics>
}

// =============================================================================
// Types - Export
// =============================================================================

/**
 * Export format
 */
export type ExportFormat = 'json' | 'csv' | 'ndjson'

/**
 * Export options
 */
export interface ExportOptions {
  /** Output format */
  format: ExportFormat
  /** Time period */
  period: MetricsPeriod
  /** Custom start date */
  startDate?: Date
  /** Custom end date */
  endDate?: Date
  /** Include raw events */
  includeEvents?: boolean
  /** Filter by channel */
  channels?: ChannelType[]
  /** Metrics to include */
  metrics?: string[]
}

/**
 * Export result
 */
export interface ExportResult {
  /** Exported data */
  data: string
  /** Content type */
  contentType: string
  /** Number of records */
  recordCount: number
  /** Export timestamp */
  exportedAt: Date
}

// =============================================================================
// Types - Suppression List
// =============================================================================

/**
 * Suppression list entry
 */
export interface SuppressionEntry {
  /** Email or phone number */
  address: string
  /** Channel type */
  channel: ChannelType
  /** Reason for suppression */
  reason: 'hard_bounce' | 'complaint' | 'unsubscribe' | 'manual'
  /** When added */
  addedAt: Date
  /** Source notification ID */
  sourceNotificationId?: string
  /** Additional notes */
  notes?: string
}

// =============================================================================
// Types - Analytics Options
// =============================================================================

/**
 * Storage interface for analytics
 */
export interface AnalyticsStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list<T>(prefix: string): Promise<Map<string, T>>
}

/**
 * Delivery analytics configuration
 */
export interface DeliveryAnalyticsOptions {
  /** Storage implementation */
  storage: AnalyticsStorage
  /** Webhook secret for verification */
  webhookSecret?: string
  /** Tracking configuration */
  tracking?: TrackingConfig
  /** Auto-suppress hard bounces */
  autoSuppressHardBounces?: boolean
  /** Auto-suppress complaints */
  autoSuppressComplaints?: boolean
  /** Retention period for events in days */
  eventRetentionDays?: number
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Delivery Analytics implementation
 */
export class DeliveryAnalytics {
  private readonly storage: AnalyticsStorage
  private readonly webhookSecret?: string
  private readonly tracking?: TrackingConfig
  private readonly autoSuppressHardBounces: boolean
  private readonly autoSuppressComplaints: boolean
  private readonly eventRetentionDays: number

  private readonly eventHandlers = new Map<DeliveryEventType, Set<WebhookHandler>>()

  // In-memory caches for metrics (in production, these would be in storage)
  private readonly deliveryLatencies = new Map<ChannelType, number[]>()
  private readonly eventCounts = new Map<string, number>()

  constructor(options: DeliveryAnalyticsOptions) {
    this.storage = options.storage
    this.webhookSecret = options.webhookSecret
    this.tracking = options.tracking
    this.autoSuppressHardBounces = options.autoSuppressHardBounces ?? true
    this.autoSuppressComplaints = options.autoSuppressComplaints ?? true
    this.eventRetentionDays = options.eventRetentionDays ?? 90
  }

  // ===========================================================================
  // Event Tracking
  // ===========================================================================

  /**
   * Track a delivery event
   */
  async trackDelivery(event: Omit<DeliveryEvent, 'id'>): Promise<DeliveryEvent> {
    const eventWithId: DeliveryEvent = {
      ...event,
      id: this.generateEventId(),
    }

    // Store event
    await this.storage.put(`event:${eventWithId.id}`, eventWithId)

    // Update notification event index
    const notificationEventsKey = `notif-events:${event.notificationId}`
    const existingEvents = (await this.storage.get<string[]>(notificationEventsKey)) ?? []
    existingEvents.push(eventWithId.id)
    await this.storage.put(notificationEventsKey, existingEvents)

    // Update metrics counters
    this.updateEventCount(event.channel, event.event)

    // Track latency for delivery events
    if (event.event === 'delivered' && event.metadata?.sentAt) {
      const latency = event.timestamp.getTime() - new Date(event.metadata.sentAt as string).getTime()
      this.recordLatency(event.channel, latency)
    }

    // Auto-suppression
    if (event.event === 'bounced' && this.autoSuppressHardBounces) {
      const bounceEvent = event as unknown as BounceEvent
      if (bounceEvent.bounceType === 'hard' && event.recipient) {
        await this.addToSuppressionList({
          address: event.recipient,
          channel: event.channel,
          reason: 'hard_bounce',
          addedAt: event.timestamp,
          sourceNotificationId: event.notificationId,
        })
      }
    }

    if (event.event === 'complained' && this.autoSuppressComplaints && event.recipient) {
      await this.addToSuppressionList({
        address: event.recipient,
        channel: event.channel,
        reason: 'complaint',
        addedAt: event.timestamp,
        sourceNotificationId: event.notificationId,
      })
    }

    // Emit to handlers
    await this.emitEvent(event.event, eventWithId)

    return eventWithId
  }

  /**
   * Track an open event
   */
  async trackOpen(params: {
    notificationId: string
    channel: ChannelType
    messageId?: string
    recipient?: string
    userId?: string
    userAgent?: string
    ipAddress?: string
  }): Promise<OpenEvent> {
    // Check if this is the first open
    const existingEvents = await this.getNotificationEvents(params.notificationId)
    const firstOpen = !existingEvents.some((e) => e.event === 'opened')

    const event: Omit<OpenEvent, 'id'> = {
      notificationId: params.notificationId,
      channel: params.channel,
      event: 'opened',
      timestamp: new Date(),
      messageId: params.messageId,
      recipient: params.recipient,
      userId: params.userId,
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
      firstOpen,
      deviceType: this.inferDeviceType(params.userAgent),
    }

    return (await this.trackDelivery(event)) as OpenEvent
  }

  /**
   * Track a click event
   */
  async trackClick(params: {
    notificationId: string
    channel: ChannelType
    url: string
    linkTag?: string
    messageId?: string
    recipient?: string
    userId?: string
    userAgent?: string
    ipAddress?: string
  }): Promise<ClickEvent> {
    const event: Omit<ClickEvent, 'id'> = {
      notificationId: params.notificationId,
      channel: params.channel,
      event: 'clicked',
      timestamp: new Date(),
      url: params.url,
      linkTag: params.linkTag,
      messageId: params.messageId,
      recipient: params.recipient,
      userId: params.userId,
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
    }

    return (await this.trackDelivery(event)) as ClickEvent
  }

  /**
   * Track a bounce event
   */
  async trackBounce(params: {
    notificationId: string
    channel: ChannelType
    bounceType: BounceType
    bounceCategory: BounceCategory
    bounceReason?: string
    smtpCode?: string
    enhancedStatusCode?: string
    messageId?: string
    recipient?: string
    userId?: string
  }): Promise<BounceEvent> {
    const event: Omit<BounceEvent, 'id'> = {
      notificationId: params.notificationId,
      channel: params.channel,
      event: 'bounced',
      timestamp: new Date(),
      bounceType: params.bounceType,
      bounceCategory: params.bounceCategory,
      bounceReason: params.bounceReason,
      smtpCode: params.smtpCode,
      enhancedStatusCode: params.enhancedStatusCode,
      messageId: params.messageId,
      recipient: params.recipient,
      userId: params.userId,
    }

    return (await this.trackDelivery(event)) as BounceEvent
  }

  /**
   * Track a complaint event
   */
  async trackComplaint(params: {
    notificationId: string
    channel: ChannelType
    complaintType: ComplaintType
    feedbackLoop?: string
    messageId?: string
    recipient?: string
    userId?: string
  }): Promise<ComplaintEvent> {
    const event: Omit<ComplaintEvent, 'id'> = {
      notificationId: params.notificationId,
      channel: params.channel,
      event: 'complained',
      timestamp: new Date(),
      complaintType: params.complaintType,
      feedbackLoop: params.feedbackLoop,
      messageId: params.messageId,
      recipient: params.recipient,
      userId: params.userId,
    }

    return (await this.trackDelivery(event)) as ComplaintEvent
  }

  // ===========================================================================
  // Tracking URLs
  // ===========================================================================

  /**
   * Generate tracking URLs for a notification
   */
  generateTrackingUrls(params: {
    notificationId: string
    channel: ChannelType
    links: string[]
    userId?: string
  }): TrackingUrls {
    const { notificationId, channel, links, userId } = params
    const trackedLinks = new Map<string, string>()

    if (!this.tracking) {
      return { trackedLinks }
    }

    const baseUrl = this.tracking.trackingDomain ?? this.tracking.baseUrl

    // Generate open tracking pixel
    let openTrackingPixel: string | undefined
    if (this.tracking.openTrackingEnabled && channel === 'email') {
      const openToken = this.generateTrackingToken(notificationId, 'open', userId)
      openTrackingPixel = `${baseUrl}/t/open/${openToken}.gif`
    }

    // Generate click tracking URLs
    if (this.tracking.clickTrackingEnabled) {
      for (const link of links) {
        const clickToken = this.generateTrackingToken(notificationId, 'click', userId, link)
        const trackedUrl = `${baseUrl}/t/click/${clickToken}?url=${encodeURIComponent(link)}`
        trackedLinks.set(link, trackedUrl)
      }
    }

    return { openTrackingPixel, trackedLinks }
  }

  /**
   * Decode a tracking token
   */
  decodeTrackingToken(token: string): {
    notificationId: string
    type: 'open' | 'click'
    userId?: string
    url?: string
  } | null {
    try {
      // In production, use proper signed tokens
      const decoded = Buffer.from(token, 'base64url').toString('utf-8')
      const parts = decoded.split(':')

      // Validate the token structure
      const notificationId = parts[0] ?? ''
      const type = parts[1] as 'open' | 'click' | undefined

      // Must have at least notification ID and valid type
      if (!notificationId || (type !== 'open' && type !== 'click')) {
        return null
      }

      return {
        notificationId,
        type,
        userId: parts[2] || undefined,
        url: parts[3] ? decodeURIComponent(parts[3]) : undefined,
      }
    } catch {
      return null
    }
  }

  // ===========================================================================
  // Webhook Processing
  // ===========================================================================

  /**
   * Process a webhook from an email/notification provider
   */
  async processWebhook(request: WebhookRequest): Promise<WebhookResult> {
    const events: DeliveryEvent[] = []
    const errors: string[] = []

    // Verify webhook signature if secret is configured
    if (this.webhookSecret && request.signature) {
      if (!this.verifyWebhookSignature(request)) {
        return {
          success: false,
          eventsProcessed: 0,
          events: [],
          errors: ['Invalid webhook signature'],
        }
      }
    }

    // Parse events based on provider
    try {
      const parsedEvents = this.parseWebhookPayload(request)

      for (const eventData of parsedEvents) {
        try {
          const event = await this.trackDelivery(eventData)
          events.push(event)
        } catch (err) {
          errors.push(`Failed to process event: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } catch (err) {
      errors.push(`Failed to parse webhook: ${err instanceof Error ? err.message : String(err)}`)
    }

    return {
      success: errors.length === 0,
      eventsProcessed: events.length,
      events,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Parse webhook payload based on provider
   */
  private parseWebhookPayload(request: WebhookRequest): Array<Omit<DeliveryEvent, 'id'>> {
    const { provider, payload } = request
    const events: Array<Omit<DeliveryEvent, 'id'>> = []

    switch (provider) {
      case 'sendgrid':
        events.push(...this.parseSendGridWebhook(payload))
        break
      case 'mailgun':
        events.push(...this.parseMailgunWebhook(payload))
        break
      case 'ses':
        events.push(...this.parseSESWebhook(payload))
        break
      case 'postmark':
        events.push(...this.parsePostmarkWebhook(payload))
        break
      case 'twilio':
        events.push(...this.parseTwilioWebhook(payload))
        break
      case 'generic':
      default:
        events.push(...this.parseGenericWebhook(payload))
        break
    }

    return events
  }

  /**
   * Parse SendGrid webhook events
   */
  private parseSendGridWebhook(payload: unknown): Array<Omit<DeliveryEvent, 'id'>> {
    const events: Array<Omit<DeliveryEvent, 'id'>> = []

    if (!Array.isArray(payload)) return events

    for (const item of payload) {
      const eventType = this.mapSendGridEventType(item.event)
      if (!eventType) continue

      const baseEvent: Omit<DeliveryEvent, 'id'> = {
        notificationId: item['x-notification-id'] ?? item.sg_message_id ?? '',
        channel: 'email',
        event: eventType,
        timestamp: new Date(item.timestamp * 1000),
        messageId: item.sg_message_id,
        recipient: item.email,
        metadata: {
          category: item.category,
          ip: item.ip,
          useragent: item.useragent,
        },
      }

      // Add bounce-specific data
      if (eventType === 'bounced') {
        ;(baseEvent as Omit<BounceEvent, 'id'>).bounceType = item.type === 'bounce' ? 'hard' : 'soft'
        ;(baseEvent as Omit<BounceEvent, 'id'>).bounceCategory = this.mapSendGridBounceCategory(item.reason)
        ;(baseEvent as Omit<BounceEvent, 'id'>).bounceReason = item.reason
      }

      // Add click-specific data
      if (eventType === 'clicked') {
        ;(baseEvent as Omit<ClickEvent, 'id'>).url = item.url
      }

      events.push(baseEvent)
    }

    return events
  }

  /**
   * Parse Mailgun webhook events
   */
  private parseMailgunWebhook(payload: unknown): Array<Omit<DeliveryEvent, 'id'>> {
    const events: Array<Omit<DeliveryEvent, 'id'>> = []
    const data = payload as Record<string, unknown>

    const eventData = data['event-data'] as Record<string, unknown> | undefined
    if (!eventData) return events

    const eventType = this.mapMailgunEventType(eventData.event as string)
    if (!eventType) return events

    const message = eventData.message as Record<string, unknown> | undefined

    const baseEvent: Omit<DeliveryEvent, 'id'> = {
      notificationId: message?.headers?.['x-notification-id'] ?? (eventData.id as string) ?? '',
      channel: 'email',
      event: eventType,
      timestamp: new Date((eventData.timestamp as number) * 1000),
      messageId: message?.headers?.['message-id'] as string | undefined,
      recipient: eventData.recipient as string | undefined,
      metadata: {
        ip: eventData['client-info'] ?? eventData.ip,
        userAgent: (eventData['client-info'] as Record<string, unknown>)?.['user-agent'],
      },
    }

    events.push(baseEvent)
    return events
  }

  /**
   * Parse AWS SES webhook events (via SNS)
   */
  private parseSESWebhook(payload: unknown): Array<Omit<DeliveryEvent, 'id'>> {
    const events: Array<Omit<DeliveryEvent, 'id'>> = []
    const data = payload as Record<string, unknown>

    // Handle SNS notification wrapper
    let sesEvent: Record<string, unknown>
    if (data.Type === 'Notification' && data.Message) {
      sesEvent = JSON.parse(data.Message as string)
    } else {
      sesEvent = data
    }

    const eventType = this.mapSESEventType(sesEvent.eventType as string ?? sesEvent.notificationType as string)
    if (!eventType) return events

    const mail = sesEvent.mail as Record<string, unknown> | undefined

    const baseEvent: Omit<DeliveryEvent, 'id'> = {
      notificationId: mail?.headers?.find((h: {name: string}) => h.name === 'X-Notification-Id')?.value ??
                      (mail?.messageId as string) ?? '',
      channel: 'email',
      event: eventType,
      timestamp: new Date(sesEvent.timestamp as string ?? Date.now()),
      messageId: mail?.messageId as string | undefined,
      recipient: (sesEvent.bounce as Record<string, unknown>)?.bouncedRecipients?.[0]?.emailAddress ??
                 (sesEvent.complaint as Record<string, unknown>)?.complainedRecipients?.[0]?.emailAddress ??
                 (sesEvent.delivery as Record<string, unknown>)?.recipients?.[0],
    }

    // Add bounce-specific data
    if (eventType === 'bounced') {
      const bounce = sesEvent.bounce as Record<string, unknown>
      ;(baseEvent as Omit<BounceEvent, 'id'>).bounceType = bounce?.bounceType === 'Permanent' ? 'hard' : 'soft'
      ;(baseEvent as Omit<BounceEvent, 'id'>).bounceCategory = this.mapSESBounceCategory(
        bounce?.bounceSubType as string
      )
    }

    events.push(baseEvent)
    return events
  }

  /**
   * Parse Postmark webhook events
   */
  private parsePostmarkWebhook(payload: unknown): Array<Omit<DeliveryEvent, 'id'>> {
    const events: Array<Omit<DeliveryEvent, 'id'>> = []
    const data = payload as Record<string, unknown>

    const eventType = this.mapPostmarkEventType(data.RecordType as string)
    if (!eventType) return events

    const baseEvent: Omit<DeliveryEvent, 'id'> = {
      notificationId: data['X-Notification-Id'] as string ?? data.MessageID as string ?? '',
      channel: 'email',
      event: eventType,
      timestamp: new Date(data.DeliveredAt as string ?? data.BouncedAt as string ?? Date.now()),
      messageId: data.MessageID as string,
      recipient: data.Recipient as string ?? data.Email as string,
    }

    // Add bounce-specific data
    if (eventType === 'bounced') {
      ;(baseEvent as Omit<BounceEvent, 'id'>).bounceType = data.Type === 'HardBounce' ? 'hard' : 'soft'
      ;(baseEvent as Omit<BounceEvent, 'id'>).bounceCategory = this.mapPostmarkBounceCategory(data.Type as string)
      ;(baseEvent as Omit<BounceEvent, 'id'>).bounceReason = data.Description as string
    }

    events.push(baseEvent)
    return events
  }

  /**
   * Parse Twilio (SMS) webhook events
   */
  private parseTwilioWebhook(payload: unknown): Array<Omit<DeliveryEvent, 'id'>> {
    const events: Array<Omit<DeliveryEvent, 'id'>> = []
    const data = payload as Record<string, unknown>

    const eventType = this.mapTwilioEventType(data.MessageStatus as string ?? data.SmsStatus as string)
    if (!eventType) return events

    const baseEvent: Omit<DeliveryEvent, 'id'> = {
      notificationId: data['X-Notification-Id'] as string ?? data.MessageSid as string ?? '',
      channel: 'sms',
      event: eventType,
      timestamp: new Date(),
      messageId: data.MessageSid as string,
      recipient: data.To as string,
      metadata: {
        errorCode: data.ErrorCode,
        errorMessage: data.ErrorMessage,
      },
    }

    events.push(baseEvent)
    return events
  }

  /**
   * Parse generic webhook events
   */
  private parseGenericWebhook(payload: unknown): Array<Omit<DeliveryEvent, 'id'>> {
    const events: Array<Omit<DeliveryEvent, 'id'>> = []
    const data = payload as Record<string, unknown>

    // Try to extract common fields
    const eventType = data.event as DeliveryEventType ?? data.type as DeliveryEventType
    if (!eventType) return events

    const baseEvent: Omit<DeliveryEvent, 'id'> = {
      notificationId: data.notificationId as string ?? data.notification_id as string ?? '',
      channel: data.channel as ChannelType ?? 'email',
      event: eventType,
      timestamp: new Date(data.timestamp as string ?? Date.now()),
      messageId: data.messageId as string ?? data.message_id as string,
      recipient: data.recipient as string ?? data.email as string ?? data.phone as string,
      metadata: data.metadata as Record<string, unknown>,
    }

    events.push(baseEvent)
    return events
  }

  // ===========================================================================
  // Event Type Mapping Helpers
  // ===========================================================================

  private mapSendGridEventType(event: string): DeliveryEventType | null {
    const mapping: Record<string, DeliveryEventType> = {
      processed: 'queued',
      delivered: 'delivered',
      open: 'opened',
      click: 'clicked',
      bounce: 'bounced',
      dropped: 'failed',
      spamreport: 'complained',
      unsubscribe: 'unsubscribed',
      deferred: 'deferred',
    }
    return mapping[event] ?? null
  }

  private mapMailgunEventType(event: string): DeliveryEventType | null {
    const mapping: Record<string, DeliveryEventType> = {
      accepted: 'queued',
      delivered: 'delivered',
      opened: 'opened',
      clicked: 'clicked',
      failed: 'bounced',
      complained: 'complained',
      unsubscribed: 'unsubscribed',
    }
    return mapping[event] ?? null
  }

  private mapSESEventType(eventType: string): DeliveryEventType | null {
    const mapping: Record<string, DeliveryEventType> = {
      Send: 'sent',
      Delivery: 'delivered',
      Open: 'opened',
      Click: 'clicked',
      Bounce: 'bounced',
      Complaint: 'complained',
      Reject: 'failed',
    }
    return mapping[eventType] ?? null
  }

  private mapPostmarkEventType(recordType: string): DeliveryEventType | null {
    const mapping: Record<string, DeliveryEventType> = {
      Delivery: 'delivered',
      Open: 'opened',
      Click: 'clicked',
      Bounce: 'bounced',
      HardBounce: 'bounced',
      SoftBounce: 'bounced',
      SpamComplaint: 'complained',
    }
    return mapping[recordType] ?? null
  }

  private mapTwilioEventType(status: string): DeliveryEventType | null {
    const mapping: Record<string, DeliveryEventType> = {
      queued: 'queued',
      sent: 'sent',
      delivered: 'delivered',
      failed: 'failed',
      undelivered: 'bounced',
    }
    return mapping[status] ?? null
  }

  private mapSendGridBounceCategory(reason: string): BounceCategory {
    if (reason?.includes('invalid') || reason?.includes('unknown')) return 'invalid_recipient'
    if (reason?.includes('full') || reason?.includes('quota')) return 'mailbox_full'
    if (reason?.includes('block') || reason?.includes('reject')) return 'blocked'
    if (reason?.includes('content') || reason?.includes('spam')) return 'content_rejected'
    return 'unknown'
  }

  private mapSESBounceCategory(subType: string): BounceCategory {
    const mapping: Record<string, BounceCategory> = {
      General: 'unknown',
      NoEmail: 'invalid_recipient',
      Suppressed: 'blocked',
      MailboxFull: 'mailbox_full',
      MessageToolarge: 'content_rejected',
      ContentRejected: 'content_rejected',
      AttachmentRejected: 'content_rejected',
    }
    return mapping[subType] ?? 'unknown'
  }

  private mapPostmarkBounceCategory(type: string): BounceCategory {
    const mapping: Record<string, BounceCategory> = {
      HardBounce: 'invalid_recipient',
      SoftBounce: 'mailbox_full',
      Blocked: 'blocked',
      SpamNotification: 'content_rejected',
      BadEmailAddress: 'invalid_recipient',
      VirusNotification: 'content_rejected',
    }
    return mapping[type] ?? 'unknown'
  }

  // ===========================================================================
  // Metrics
  // ===========================================================================

  /**
   * Get metrics for a specific channel
   */
  async getChannelMetrics(channel: ChannelType, options: MetricsQueryOptions): Promise<ChannelMetrics> {
    const { startDate, endDate } = this.getPeriodDates(options)

    // Count events for the period
    const eventPrefix = `event:`
    const allEvents = await this.storage.list<DeliveryEvent>(eventPrefix)

    let sent = 0
    let delivered = 0
    let opened = 0
    let clicked = 0
    let bounced = 0
    let hardBounces = 0
    let softBounces = 0
    let complained = 0
    let failed = 0

    for (const [, event] of allEvents) {
      if (event.channel !== channel) continue
      if (event.timestamp < startDate || event.timestamp > endDate) continue

      switch (event.event) {
        case 'sent':
        case 'queued':
          sent++
          break
        case 'delivered':
          delivered++
          break
        case 'opened':
          opened++
          break
        case 'clicked':
          clicked++
          break
        case 'bounced':
          bounced++
          if ((event as BounceEvent).bounceType === 'hard') hardBounces++
          else softBounces++
          break
        case 'complained':
          complained++
          break
        case 'failed':
          failed++
          break
      }
    }

    // Calculate rates
    const deliveryRate = sent > 0 ? delivered / sent : 0
    const openRate = delivered > 0 ? opened / delivered : 0
    const clickRate = delivered > 0 ? clicked / delivered : 0
    const bounceRate = sent > 0 ? bounced / sent : 0
    const complaintRate = delivered > 0 ? complained / delivered : 0

    // Calculate latencies
    const latencies = this.deliveryLatencies.get(channel) ?? []
    const sortedLatencies = [...latencies].sort((a, b) => a - b)

    const avgLatencyMs = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0
    const p50LatencyMs = this.percentile(sortedLatencies, 50)
    const p95LatencyMs = this.percentile(sortedLatencies, 95)
    const p99LatencyMs = this.percentile(sortedLatencies, 99)

    // Calculate throughput (messages per minute over the period)
    const periodMs = endDate.getTime() - startDate.getTime()
    const periodMinutes = periodMs / (60 * 1000)
    const throughput = periodMinutes > 0 ? sent / periodMinutes : 0

    return {
      channel,
      period: options.period,
      sent,
      delivered,
      opened,
      clicked,
      bounced,
      hardBounces,
      softBounces,
      complained,
      failed,
      deliveryRate,
      openRate,
      clickRate,
      bounceRate,
      complaintRate,
      avgLatencyMs,
      p50LatencyMs,
      p95LatencyMs,
      p99LatencyMs,
      throughput,
    }
  }

  /**
   * Get aggregate metrics across all channels
   */
  async getAggregateMetrics(options: MetricsQueryOptions): Promise<AggregateMetrics> {
    const channels: ChannelType[] = ['email', 'sms', 'push', 'in-app', 'slack', 'webhook']
    const byChannel = new Map<ChannelType, ChannelMetrics>()

    let totalSent = 0
    let totalDelivered = 0
    let totalOpened = 0
    let totalClicked = 0
    let totalBounced = 0
    let totalComplaints = 0

    for (const channel of channels) {
      const metrics = await this.getChannelMetrics(channel, options)
      byChannel.set(channel, metrics)

      totalSent += metrics.sent
      totalDelivered += metrics.delivered
      totalOpened += metrics.opened
      totalClicked += metrics.clicked
      totalBounced += metrics.bounced
      totalComplaints += metrics.complained
    }

    return {
      period: options.period,
      totalSent,
      totalDelivered,
      totalOpened,
      totalClicked,
      totalBounced,
      totalComplaints,
      overallDeliveryRate: totalSent > 0 ? totalDelivered / totalSent : 0,
      overallOpenRate: totalDelivered > 0 ? totalOpened / totalDelivered : 0,
      overallClickRate: totalDelivered > 0 ? totalClicked / totalDelivered : 0,
      byChannel,
    }
  }

  /**
   * Get time-series metrics
   */
  async getTimeSeriesMetrics(
    metric: 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced',
    channel: ChannelType,
    options: MetricsQueryOptions
  ): Promise<TimeSeriesMetrics> {
    const { startDate, endDate } = this.getPeriodDates(options)
    const groupBy = options.groupBy ?? 'hour'

    const eventPrefix = `event:`
    const allEvents = await this.storage.list<DeliveryEvent>(eventPrefix)

    // Bucket events by time
    const buckets = new Map<number, number>()

    for (const [, event] of allEvents) {
      if (event.channel !== channel) continue
      if (event.timestamp < startDate || event.timestamp > endDate) continue
      if (!this.eventMatchesMetric(event, metric)) continue

      const bucketKey = this.getBucketKey(event.timestamp, groupBy)
      buckets.set(bucketKey, (buckets.get(bucketKey) ?? 0) + 1)
    }

    // Convert to data points
    const dataPoints: MetricsDataPoint[] = []
    for (const [timestamp, value] of buckets) {
      dataPoints.push({ timestamp: new Date(timestamp), value })
    }

    // Sort by timestamp
    dataPoints.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

    return { metric, channel, dataPoints }
  }

  // ===========================================================================
  // Export
  // ===========================================================================

  /**
   * Export metrics and events for dashboards
   */
  async exportMetrics(options: ExportOptions): Promise<ExportResult> {
    const { startDate, endDate } = this.getPeriodDates({
      period: options.period,
      startDate: options.startDate,
      endDate: options.endDate,
    })

    const channels = options.channels ?? ['email', 'sms', 'push', 'in-app', 'slack', 'webhook']
    const exportData: Record<string, unknown>[] = []

    // Export metrics for each channel
    for (const channel of channels) {
      const metrics = await this.getChannelMetrics(channel, {
        period: options.period,
        startDate,
        endDate,
      })
      exportData.push({ type: 'metrics', ...metrics })
    }

    // Include raw events if requested
    if (options.includeEvents) {
      const eventPrefix = `event:`
      const allEvents = await this.storage.list<DeliveryEvent>(eventPrefix)

      for (const [, event] of allEvents) {
        if (!channels.includes(event.channel)) continue
        if (event.timestamp < startDate || event.timestamp > endDate) continue
        exportData.push({ type: 'event', ...event })
      }
    }

    // Format output
    let data: string
    let contentType: string

    switch (options.format) {
      case 'csv':
        data = this.formatAsCSV(exportData)
        contentType = 'text/csv'
        break
      case 'ndjson':
        data = exportData.map((row) => JSON.stringify(row)).join('\n')
        contentType = 'application/x-ndjson'
        break
      case 'json':
      default:
        data = JSON.stringify(exportData, null, 2)
        contentType = 'application/json'
        break
    }

    return {
      data,
      contentType,
      recordCount: exportData.length,
      exportedAt: new Date(),
    }
  }

  // ===========================================================================
  // Suppression List
  // ===========================================================================

  /**
   * Add an address to the suppression list
   */
  async addToSuppressionList(entry: SuppressionEntry): Promise<void> {
    const key = `suppression:${entry.channel}:${entry.address.toLowerCase()}`
    await this.storage.put(key, entry)
  }

  /**
   * Remove an address from the suppression list
   */
  async removeFromSuppressionList(channel: ChannelType, address: string): Promise<boolean> {
    const key = `suppression:${channel}:${address.toLowerCase()}`
    return this.storage.delete(key)
  }

  /**
   * Check if an address is suppressed
   */
  async isAddressSuppressed(channel: ChannelType, address: string): Promise<boolean> {
    const key = `suppression:${channel}:${address.toLowerCase()}`
    const entry = await this.storage.get<SuppressionEntry>(key)
    return entry !== undefined
  }

  /**
   * Get all suppressed addresses for a channel
   */
  async getSuppressionList(channel?: ChannelType): Promise<SuppressionEntry[]> {
    const prefix = channel ? `suppression:${channel}:` : 'suppression:'
    const entries = await this.storage.list<SuppressionEntry>(prefix)
    return Array.from(entries.values())
  }

  // ===========================================================================
  // Event Handlers
  // ===========================================================================

  /**
   * Register an event handler
   */
  on(event: DeliveryEventType, handler: WebhookHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
  }

  /**
   * Remove an event handler
   */
  off(event: DeliveryEventType, handler: WebhookHandler): void {
    this.eventHandlers.get(event)?.delete(handler)
  }

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  /**
   * Get events for a notification
   */
  async getNotificationEvents(notificationId: string): Promise<DeliveryEvent[]> {
    const eventIdsKey = `notif-events:${notificationId}`
    const eventIds = (await this.storage.get<string[]>(eventIdsKey)) ?? []

    const events: DeliveryEvent[] = []
    for (const eventId of eventIds) {
      const event = await this.storage.get<DeliveryEvent>(`event:${eventId}`)
      if (event) events.push(event)
    }

    return events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }

  /**
   * Get recent events for a user
   */
  async getUserEvents(userId: string, limit = 100): Promise<DeliveryEvent[]> {
    const eventPrefix = `event:`
    const allEvents = await this.storage.list<DeliveryEvent>(eventPrefix)

    const userEvents: DeliveryEvent[] = []
    for (const [, event] of allEvents) {
      if (event.userId === userId) {
        userEvents.push(event)
      }
    }

    // Sort by timestamp descending and limit
    return userEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit)
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private generateEventId(): string {
    return `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`
  }

  private generateTrackingToken(
    notificationId: string,
    type: 'open' | 'click',
    userId?: string,
    url?: string
  ): string {
    const data = [notificationId, type, userId ?? '', url ? encodeURIComponent(url) : ''].join(':')
    return Buffer.from(data).toString('base64url')
  }

  private verifyWebhookSignature(request: WebhookRequest): boolean {
    // In production, implement proper HMAC signature verification
    // This is a placeholder
    return true
  }

  private inferDeviceType(userAgent?: string): 'desktop' | 'mobile' | 'tablet' | 'unknown' {
    if (!userAgent) return 'unknown'

    const ua = userAgent.toLowerCase()
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) return 'mobile'
    if (ua.includes('ipad') || ua.includes('tablet')) return 'tablet'
    if (ua.includes('windows') || ua.includes('macintosh') || ua.includes('linux')) return 'desktop'
    return 'unknown'
  }

  private updateEventCount(channel: ChannelType, event: DeliveryEventType): void {
    const key = `${channel}:${event}`
    this.eventCounts.set(key, (this.eventCounts.get(key) ?? 0) + 1)
  }

  private recordLatency(channel: ChannelType, latencyMs: number): void {
    if (!this.deliveryLatencies.has(channel)) {
      this.deliveryLatencies.set(channel, [])
    }
    this.deliveryLatencies.get(channel)!.push(latencyMs)

    // Keep only last 10000 latency samples per channel
    const latencies = this.deliveryLatencies.get(channel)!
    if (latencies.length > 10000) {
      latencies.shift()
    }
  }

  private percentile(sortedArr: number[], p: number): number {
    if (sortedArr.length === 0) return 0
    const index = Math.ceil((p / 100) * sortedArr.length) - 1
    return sortedArr[Math.max(0, index)] ?? 0
  }

  private getPeriodDates(options: MetricsQueryOptions | { period: MetricsPeriod; startDate?: Date; endDate?: Date }): {
    startDate: Date
    endDate: Date
  } {
    const endDate = options.endDate ?? new Date()
    let startDate: Date

    if (options.period === 'custom' && options.startDate) {
      startDate = options.startDate
    } else {
      const periodMs: Record<MetricsPeriod, number> = {
        '1h': 60 * 60 * 1000,
        '6h': 6 * 60 * 60 * 1000,
        '12h': 12 * 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
        custom: 24 * 60 * 60 * 1000, // Default to 24h for custom without start
      }
      startDate = new Date(endDate.getTime() - periodMs[options.period])
    }

    return { startDate, endDate }
  }

  private eventMatchesMetric(event: DeliveryEvent, metric: string): boolean {
    const metricToEvent: Record<string, DeliveryEventType[]> = {
      sent: ['sent', 'queued'],
      delivered: ['delivered'],
      opened: ['opened'],
      clicked: ['clicked'],
      bounced: ['bounced'],
    }
    return metricToEvent[metric]?.includes(event.event) ?? false
  }

  private getBucketKey(timestamp: Date, groupBy: 'hour' | 'day' | 'week'): number {
    const date = new Date(timestamp)

    switch (groupBy) {
      case 'hour':
        date.setMinutes(0, 0, 0)
        break
      case 'day':
        date.setHours(0, 0, 0, 0)
        break
      case 'week':
        const dayOfWeek = date.getDay()
        date.setDate(date.getDate() - dayOfWeek)
        date.setHours(0, 0, 0, 0)
        break
    }

    return date.getTime()
  }

  private formatAsCSV(data: Record<string, unknown>[]): string {
    if (data.length === 0) return ''

    // Get all unique keys
    const keys = new Set<string>()
    for (const row of data) {
      Object.keys(row).forEach((k) => keys.add(k))
    }
    const headers = Array.from(keys)

    // Build CSV
    const lines = [headers.join(',')]
    for (const row of data) {
      const values = headers.map((h) => {
        const val = row[h]
        if (val === null || val === undefined) return ''
        if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`
        if (val instanceof Date) return val.toISOString()
        if (typeof val === 'object') return `"${JSON.stringify(val).replace(/"/g, '""')}"`
        return String(val)
      })
      lines.push(values.join(','))
    }

    return lines.join('\n')
  }

  private async emitEvent(eventType: DeliveryEventType, event: DeliveryEvent): Promise<void> {
    const handlers = this.eventHandlers.get(eventType)
    if (!handlers) return

    for (const handler of handlers) {
      try {
        await handler(event)
      } catch {
        // Ignore handler errors
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new DeliveryAnalytics instance
 */
export function createDeliveryAnalytics(options: DeliveryAnalyticsOptions): DeliveryAnalytics {
  return new DeliveryAnalytics(options)
}
