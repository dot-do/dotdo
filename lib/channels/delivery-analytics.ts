/**
 * Delivery Analytics and Tracking
 *
 * Provides comprehensive delivery tracking and analytics for notification channels:
 * - **Delivery Status Tracking**: Track sent, delivered, bounced, failed states
 * - **Open/Click Tracking**: Track email opens and link clicks with pixel/redirect URLs
 * - **Analytics Aggregation**: Per-channel metrics (delivery rate, latency, bounce rate)
 * - **Reporting Queries**: Time-series queries, channel comparison, recipient stats
 *
 * ## Architecture
 *
 * ```
 * Notification -> Send -> Delivery Event -> Track -> Aggregate -> Query
 *                   |         |              |           |          |
 *                   v         v              v           v          v
 *              [Provider] [Status]      [Events]   [Rollups]   [Reports]
 *                   |         |              |           |          |
 *              [Webhook]  [Update]       [Store]    [Compute]   [Export]
 * ```
 *
 * @example Basic usage
 * ```typescript
 * import { createDeliveryAnalytics } from 'dotdo/lib/channels'
 *
 * const analytics = createDeliveryAnalytics()
 *
 * // Track a sent notification
 * await analytics.trackDelivery({
 *   messageId: 'msg-123',
 *   channel: 'email',
 *   recipient: 'user@example.com',
 *   status: 'sent',
 * })
 *
 * // Handle webhook for delivery confirmation
 * await analytics.updateStatus('msg-123', 'delivered')
 *
 * // Generate tracking URL for clicks
 * const trackingUrl = analytics.generateClickUrl({
 *   messageId: 'msg-123',
 *   linkId: 'cta-button',
 *   destinationUrl: 'https://app.dotdo.dev/signup',
 * })
 *
 * // Query analytics
 * const report = await analytics.getChannelReport('email', {
 *   startTime: Date.now() - 7 * 24 * 60 * 60 * 1000,
 *   endTime: Date.now(),
 * })
 * ```
 *
 * @module lib/channels/delivery-analytics
 */

import type { DeliveryChannel } from './exactly-once-delivery'

// ============================================================================
// TYPES - Delivery Status
// ============================================================================

/**
 * Delivery status lifecycle states
 */
export type DeliveryStatus =
  | 'pending'      // Queued but not yet sent
  | 'sent'         // Sent to provider
  | 'delivered'    // Confirmed delivery (provider webhook)
  | 'opened'       // Recipient opened (tracking pixel)
  | 'clicked'      // Recipient clicked a link
  | 'bounced'      // Hard bounce (invalid address)
  | 'soft_bounced' // Soft bounce (temporary issue)
  | 'complained'   // Marked as spam
  | 'unsubscribed' // Recipient unsubscribed
  | 'failed'       // Permanent failure

/**
 * Bounce types for classification
 */
export type BounceType =
  | 'hard'         // Permanent: invalid address, domain not found
  | 'soft'         // Temporary: mailbox full, server down
  | 'block'        // Blocked by recipient server
  | 'unknown'      // Unclassified bounce

/**
 * Complaint types
 */
export type ComplaintType =
  | 'abuse'        // Marked as spam
  | 'fraud'        // Reported as fraud/phishing
  | 'virus'        // Flagged as malware
  | 'other'        // Other complaint

// ============================================================================
// TYPES - Delivery Events
// ============================================================================

/**
 * Base delivery event
 */
export interface DeliveryEvent {
  /** Unique message identifier */
  messageId: string
  /** Channel used for delivery */
  channel: DeliveryChannel
  /** Recipient identifier (email, phone, user ID, etc.) */
  recipient: string
  /** Current delivery status */
  status: DeliveryStatus
  /** Event timestamp */
  timestamp: number
  /** Template or notification type */
  templateId?: string
  /** Campaign or batch identifier */
  campaignId?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Sent event - notification dispatched to provider
 */
export interface SentEvent extends DeliveryEvent {
  status: 'sent'
  /** Provider-specific message ID */
  providerMessageId?: string
  /** Provider name (sendgrid, resend, twilio, etc.) */
  provider?: string
}

/**
 * Delivered event - confirmed by provider
 */
export interface DeliveredEvent extends DeliveryEvent {
  status: 'delivered'
  /** Time from sent to delivered */
  deliveryLatencyMs?: number
}

/**
 * Opened event - tracking pixel loaded
 */
export interface OpenedEvent extends DeliveryEvent {
  status: 'opened'
  /** Open count (for multiple opens) */
  openCount?: number
  /** User agent from open */
  userAgent?: string
  /** IP address from open */
  ipAddress?: string
  /** Device type detected */
  deviceType?: 'mobile' | 'tablet' | 'desktop' | 'unknown'
}

/**
 * Clicked event - link click tracked
 */
export interface ClickedEvent extends DeliveryEvent {
  status: 'clicked'
  /** Link identifier within the message */
  linkId: string
  /** Destination URL */
  destinationUrl: string
  /** User agent from click */
  userAgent?: string
  /** IP address from click */
  ipAddress?: string
}

/**
 * Bounced event - delivery failed
 */
export interface BouncedEvent extends DeliveryEvent {
  status: 'bounced' | 'soft_bounced'
  /** Type of bounce */
  bounceType: BounceType
  /** Bounce reason/diagnostic */
  bounceReason?: string
  /** SMTP error code */
  smtpCode?: string
}

/**
 * Complained event - spam report
 */
export interface ComplainedEvent extends DeliveryEvent {
  status: 'complained'
  /** Type of complaint */
  complaintType: ComplaintType
  /** Feedback loop ID */
  feedbackId?: string
}

/**
 * Failed event - permanent failure
 */
export interface FailedEvent extends DeliveryEvent {
  status: 'failed'
  /** Error message */
  error: string
  /** Error code */
  errorCode?: string
  /** Whether this is retryable */
  retryable: boolean
}

/**
 * Union of all event types
 */
export type AnyDeliveryEvent =
  | SentEvent
  | DeliveredEvent
  | OpenedEvent
  | ClickedEvent
  | BouncedEvent
  | ComplainedEvent
  | FailedEvent
  | DeliveryEvent

// ============================================================================
// TYPES - Tracking
// ============================================================================

/**
 * Click tracking URL parameters
 */
export interface ClickTrackingParams {
  /** Message identifier */
  messageId: string
  /** Link identifier */
  linkId: string
  /** Destination URL after tracking */
  destinationUrl: string
  /** Optional user identifier */
  userId?: string
}

/**
 * Open tracking pixel parameters
 */
export interface OpenTrackingParams {
  /** Message identifier */
  messageId: string
  /** Optional user identifier */
  userId?: string
}

/**
 * Tracking configuration
 */
export interface TrackingConfig {
  /** Base URL for tracking endpoints */
  baseUrl: string
  /** Path for click tracking (default: /t/c) */
  clickPath?: string
  /** Path for open tracking (default: /t/o) */
  openPath?: string
  /** Sign tracking URLs with HMAC */
  signUrls?: boolean
  /** Signing secret for HMAC */
  signingSecret?: string
}

// ============================================================================
// TYPES - Analytics Aggregation
// ============================================================================

/**
 * Time bucket for aggregation
 */
export type TimeBucket = 'minute' | 'hour' | 'day' | 'week' | 'month'

/**
 * Channel-level metrics
 */
export interface ChannelMetrics {
  /** Channel identifier */
  channel: DeliveryChannel
  /** Time period start */
  periodStart: number
  /** Time period end */
  periodEnd: number
  /** Total messages sent */
  sent: number
  /** Total messages delivered */
  delivered: number
  /** Total messages opened */
  opened: number
  /** Total link clicks */
  clicked: number
  /** Total bounces (hard + soft) */
  bounced: number
  /** Hard bounces only */
  hardBounced: number
  /** Soft bounces only */
  softBounced: number
  /** Spam complaints */
  complained: number
  /** Unsubscribes */
  unsubscribed: number
  /** Failed deliveries */
  failed: number
  /** Delivery rate (delivered / sent) */
  deliveryRate: number
  /** Open rate (opened / delivered) */
  openRate: number
  /** Click rate (clicked / delivered) */
  clickRate: number
  /** Click-through rate (clicked / opened) */
  clickThroughRate: number
  /** Bounce rate (bounced / sent) */
  bounceRate: number
  /** Complaint rate (complained / delivered) */
  complaintRate: number
  /** Average delivery latency in ms */
  avgDeliveryLatencyMs: number
  /** P95 delivery latency in ms */
  p95DeliveryLatencyMs: number
  /** P99 delivery latency in ms */
  p99DeliveryLatencyMs: number
}

/**
 * Recipient-level metrics
 */
export interface RecipientMetrics {
  /** Recipient identifier */
  recipient: string
  /** Total messages received */
  totalReceived: number
  /** Total messages opened */
  totalOpened: number
  /** Total link clicks */
  totalClicked: number
  /** Bounce count */
  bounceCount: number
  /** Complaint count */
  complaintCount: number
  /** Last message sent timestamp */
  lastSentAt?: number
  /** Last message opened timestamp */
  lastOpenedAt?: number
  /** Last click timestamp */
  lastClickedAt?: number
  /** Recipient engagement score (0-100) */
  engagementScore: number
  /** Whether recipient is suppressed */
  suppressed: boolean
  /** Suppression reason if suppressed */
  suppressionReason?: string
}

/**
 * Campaign/template metrics
 */
export interface CampaignMetrics {
  /** Campaign or template identifier */
  campaignId: string
  /** Channel used */
  channel: DeliveryChannel
  /** Metrics aggregation */
  metrics: Omit<ChannelMetrics, 'channel'>
  /** Unique recipients */
  uniqueRecipients: number
  /** Unique openers */
  uniqueOpeners: number
  /** Unique clickers */
  uniqueClickers: number
}

/**
 * Link-level click metrics
 */
export interface LinkMetrics {
  /** Link identifier */
  linkId: string
  /** Destination URL */
  destinationUrl: string
  /** Total clicks */
  totalClicks: number
  /** Unique clickers */
  uniqueClickers: number
  /** Click share (% of total clicks) */
  clickShare: number
}

// ============================================================================
// TYPES - Query Parameters
// ============================================================================

/**
 * Time range for queries
 */
export interface TimeRange {
  /** Start timestamp (inclusive) */
  startTime: number
  /** End timestamp (exclusive) */
  endTime: number
}

/**
 * Query parameters for channel reports
 */
export interface ChannelReportQuery extends TimeRange {
  /** Time bucket for aggregation */
  bucket?: TimeBucket
  /** Filter by template/notification type */
  templateId?: string
  /** Filter by campaign */
  campaignId?: string
}

/**
 * Query parameters for recipient reports
 */
export interface RecipientReportQuery extends TimeRange {
  /** Filter by channel */
  channel?: DeliveryChannel
  /** Limit number of results */
  limit?: number
  /** Sort by field */
  sortBy?: 'engagementScore' | 'lastSentAt' | 'totalReceived' | 'totalOpened'
  /** Sort direction */
  sortOrder?: 'asc' | 'desc'
}

/**
 * Suppression list query
 */
export interface SuppressionQuery {
  /** Filter by suppression reason */
  reason?: 'bounce' | 'complaint' | 'unsubscribe' | 'manual'
  /** Filter by channel */
  channel?: DeliveryChannel
  /** Limit number of results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

// ============================================================================
// TYPES - Reports
// ============================================================================

/**
 * Time-series data point
 */
export interface TimeSeriesPoint {
  /** Timestamp for this bucket */
  timestamp: number
  /** Metrics for this bucket */
  metrics: Partial<ChannelMetrics>
}

/**
 * Channel report with time-series data
 */
export interface ChannelReport {
  /** Channel identifier */
  channel: DeliveryChannel
  /** Overall metrics for the period */
  summary: ChannelMetrics
  /** Time-series breakdown */
  timeSeries: TimeSeriesPoint[]
  /** Top performing campaigns/templates */
  topCampaigns?: CampaignMetrics[]
  /** Top clicked links */
  topLinks?: LinkMetrics[]
}

/**
 * Multi-channel comparison report
 */
export interface ChannelComparisonReport {
  /** Time range for the report */
  timeRange: TimeRange
  /** Metrics by channel */
  byChannel: Map<DeliveryChannel, ChannelMetrics>
  /** Overall totals */
  totals: Omit<ChannelMetrics, 'channel'>
}

/**
 * Suppression list entry
 */
export interface SuppressionEntry {
  /** Recipient identifier */
  recipient: string
  /** Channel (if channel-specific suppression) */
  channel?: DeliveryChannel
  /** Suppression reason */
  reason: 'bounce' | 'complaint' | 'unsubscribe' | 'manual'
  /** When suppressed */
  suppressedAt: number
  /** Original event that caused suppression */
  sourceEvent?: DeliveryEvent
}

// ============================================================================
// TYPES - Configuration
// ============================================================================

/**
 * Delivery analytics options
 */
export interface DeliveryAnalyticsOptions {
  /** Tracking configuration */
  tracking?: TrackingConfig
  /** Auto-suppress on hard bounce */
  autoSuppressOnBounce?: boolean
  /** Auto-suppress on complaint */
  autoSuppressOnComplaint?: boolean
  /** Auto-suppress on unsubscribe */
  autoSuppressOnUnsubscribe?: boolean
  /** Engagement score decay rate (per day) */
  engagementDecayRate?: number
  /** Maximum events to store in memory */
  maxEventsInMemory?: number
  /** Event callback for external processing */
  onEvent?: (event: AnyDeliveryEvent) => void | Promise<void>
}

// ============================================================================
// UTILITIES
// ============================================================================

function generateTrackingId(): string {
  return `trk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`
}

function encodeTrackingData(data: Record<string, string>): string {
  const params = new URLSearchParams(data)
  return Buffer.from(params.toString()).toString('base64url')
}

function decodeTrackingData(encoded: string): Record<string, string> {
  const decoded = Buffer.from(encoded, 'base64url').toString()
  const params = new URLSearchParams(decoded)
  const result: Record<string, string> = {}
  params.forEach((value, key) => {
    result[key] = value
  })
  return result
}

function getBucketStart(timestamp: number, bucket: TimeBucket): number {
  const date = new Date(timestamp)
  switch (bucket) {
    case 'minute':
      date.setSeconds(0, 0)
      break
    case 'hour':
      date.setMinutes(0, 0, 0)
      break
    case 'day':
      date.setHours(0, 0, 0, 0)
      break
    case 'week': {
      const day = date.getDay()
      date.setDate(date.getDate() - day)
      date.setHours(0, 0, 0, 0)
      break
    }
    case 'month':
      date.setDate(1)
      date.setHours(0, 0, 0, 0)
      break
  }
  return date.getTime()
}

function getBucketDuration(bucket: TimeBucket): number {
  switch (bucket) {
    case 'minute':
      return 60 * 1000
    case 'hour':
      return 60 * 60 * 1000
    case 'day':
      return 24 * 60 * 60 * 1000
    case 'week':
      return 7 * 24 * 60 * 60 * 1000
    case 'month':
      return 30 * 24 * 60 * 60 * 1000 // Approximation
  }
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil((percentile / 100) * sorted.length) - 1
  return sorted[Math.max(0, index)]!
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Delivery Analytics - Comprehensive delivery tracking and analytics
 */
export class DeliveryAnalytics {
  private readonly options: Required<
    Pick<
      DeliveryAnalyticsOptions,
      | 'autoSuppressOnBounce'
      | 'autoSuppressOnComplaint'
      | 'autoSuppressOnUnsubscribe'
      | 'engagementDecayRate'
      | 'maxEventsInMemory'
    >
  > & Pick<DeliveryAnalyticsOptions, 'tracking' | 'onEvent'>

  // Event storage (in production, this would be backed by a database)
  private readonly events: Map<string, AnyDeliveryEvent[]> = new Map()
  private readonly eventsByRecipient: Map<string, string[]> = new Map()
  private readonly eventsByChannel: Map<DeliveryChannel, string[]> = new Map()
  private readonly eventsByCampaign: Map<string, string[]> = new Map()

  // Suppression list
  private readonly suppressions: Map<string, SuppressionEntry> = new Map()

  // Recipient metrics cache
  private readonly recipientMetricsCache: Map<string, RecipientMetrics> = new Map()

  // Delivery latencies for percentile calculations
  private readonly deliveryLatencies: Map<DeliveryChannel, number[]> = new Map()

  // Total event count for memory management
  private totalEventCount = 0

  constructor(options?: DeliveryAnalyticsOptions) {
    this.options = {
      autoSuppressOnBounce: options?.autoSuppressOnBounce ?? true,
      autoSuppressOnComplaint: options?.autoSuppressOnComplaint ?? true,
      autoSuppressOnUnsubscribe: options?.autoSuppressOnUnsubscribe ?? true,
      engagementDecayRate: options?.engagementDecayRate ?? 0.05,
      maxEventsInMemory: options?.maxEventsInMemory ?? 100000,
      tracking: options?.tracking,
      onEvent: options?.onEvent,
    }
  }

  // ==========================================================================
  // TRACKING API
  // ==========================================================================

  /**
   * Track a delivery event
   */
  async trackDelivery(event: AnyDeliveryEvent): Promise<void> {
    // Ensure timestamp
    const eventWithTimestamp: AnyDeliveryEvent = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    }

    // Store event
    this.storeEvent(eventWithTimestamp)

    // Update recipient metrics
    this.updateRecipientMetrics(eventWithTimestamp)

    // Handle auto-suppression
    await this.handleAutoSuppression(eventWithTimestamp)

    // Track delivery latency
    if (eventWithTimestamp.status === 'delivered') {
      this.trackLatency(eventWithTimestamp as DeliveredEvent)
    }

    // Notify callback
    if (this.options.onEvent) {
      await this.options.onEvent(eventWithTimestamp)
    }
  }

  /**
   * Update delivery status for an existing message
   */
  async updateStatus(
    messageId: string,
    status: DeliveryStatus,
    additionalData?: Partial<AnyDeliveryEvent>
  ): Promise<void> {
    const existingEvents = this.events.get(messageId)
    if (!existingEvents || existingEvents.length === 0) {
      throw new Error(`Message not found: ${messageId}`)
    }

    const lastEvent = existingEvents[existingEvents.length - 1]!
    const newEvent: AnyDeliveryEvent = {
      ...lastEvent,
      ...additionalData,
      status,
      timestamp: additionalData?.timestamp ?? Date.now(),
    }

    await this.trackDelivery(newEvent)
  }

  /**
   * Track multiple delivery events in batch
   */
  async trackBatch(events: AnyDeliveryEvent[]): Promise<void> {
    for (const event of events) {
      await this.trackDelivery(event)
    }
  }

  private storeEvent(event: AnyDeliveryEvent): void {
    // Memory management - remove oldest events if limit reached
    while (this.totalEventCount >= this.options.maxEventsInMemory) {
      this.evictOldestEvents(1000)
    }

    // Store by message ID
    let messageEvents = this.events.get(event.messageId)
    if (!messageEvents) {
      messageEvents = []
      this.events.set(event.messageId, messageEvents)
    }
    messageEvents.push(event)

    // Index by recipient
    let recipientMessages = this.eventsByRecipient.get(event.recipient)
    if (!recipientMessages) {
      recipientMessages = []
      this.eventsByRecipient.set(event.recipient, recipientMessages)
    }
    if (!recipientMessages.includes(event.messageId)) {
      recipientMessages.push(event.messageId)
    }

    // Index by channel
    let channelMessages = this.eventsByChannel.get(event.channel)
    if (!channelMessages) {
      channelMessages = []
      this.eventsByChannel.set(event.channel, channelMessages)
    }
    if (!channelMessages.includes(event.messageId)) {
      channelMessages.push(event.messageId)
    }

    // Index by campaign
    if (event.campaignId) {
      let campaignMessages = this.eventsByCampaign.get(event.campaignId)
      if (!campaignMessages) {
        campaignMessages = []
        this.eventsByCampaign.set(event.campaignId, campaignMessages)
      }
      if (!campaignMessages.includes(event.messageId)) {
        campaignMessages.push(event.messageId)
      }
    }

    this.totalEventCount++
  }

  private evictOldestEvents(count: number): void {
    // Find oldest events
    const allEvents: Array<{ messageId: string; timestamp: number }> = []
    this.events.forEach((events, messageId) => {
      if (events.length > 0) {
        allEvents.push({ messageId, timestamp: events[0]!.timestamp })
      }
    })

    allEvents.sort((a, b) => a.timestamp - b.timestamp)

    // Remove oldest
    for (let i = 0; i < Math.min(count, allEvents.length); i++) {
      const messageId = allEvents[i]!.messageId
      const events = this.events.get(messageId)
      if (events) {
        this.totalEventCount -= events.length
        this.events.delete(messageId)
      }
    }
  }

  private updateRecipientMetrics(event: AnyDeliveryEvent): void {
    let metrics = this.recipientMetricsCache.get(event.recipient)
    if (!metrics) {
      metrics = {
        recipient: event.recipient,
        totalReceived: 0,
        totalOpened: 0,
        totalClicked: 0,
        bounceCount: 0,
        complaintCount: 0,
        engagementScore: 50, // Start neutral
        suppressed: false,
      }
      this.recipientMetricsCache.set(event.recipient, metrics)
    }

    switch (event.status) {
      case 'sent':
        metrics.totalReceived++
        metrics.lastSentAt = event.timestamp
        break
      case 'opened':
        metrics.totalOpened++
        metrics.lastOpenedAt = event.timestamp
        metrics.engagementScore = Math.min(100, metrics.engagementScore + 10)
        break
      case 'clicked':
        metrics.totalClicked++
        metrics.lastClickedAt = event.timestamp
        metrics.engagementScore = Math.min(100, metrics.engagementScore + 15)
        break
      case 'bounced':
        metrics.bounceCount++
        metrics.engagementScore = Math.max(0, metrics.engagementScore - 25)
        break
      case 'soft_bounced':
        metrics.bounceCount++
        metrics.engagementScore = Math.max(0, metrics.engagementScore - 10)
        break
      case 'complained':
        metrics.complaintCount++
        metrics.engagementScore = Math.max(0, metrics.engagementScore - 50)
        break
      case 'unsubscribed':
        metrics.engagementScore = Math.max(0, metrics.engagementScore - 30)
        break
    }
  }

  private async handleAutoSuppression(event: AnyDeliveryEvent): Promise<void> {
    let shouldSuppress = false
    let reason: SuppressionEntry['reason'] = 'manual'

    if (
      event.status === 'bounced' &&
      (event as BouncedEvent).bounceType === 'hard' &&
      this.options.autoSuppressOnBounce
    ) {
      shouldSuppress = true
      reason = 'bounce'
    } else if (event.status === 'complained' && this.options.autoSuppressOnComplaint) {
      shouldSuppress = true
      reason = 'complaint'
    } else if (event.status === 'unsubscribed' && this.options.autoSuppressOnUnsubscribe) {
      shouldSuppress = true
      reason = 'unsubscribe'
    }

    if (shouldSuppress) {
      this.suppress(event.recipient, reason, event.channel, event)
    }
  }

  private trackLatency(event: DeliveredEvent): void {
    if (!event.deliveryLatencyMs) return

    let latencies = this.deliveryLatencies.get(event.channel)
    if (!latencies) {
      latencies = []
      this.deliveryLatencies.set(event.channel, latencies)
    }
    latencies.push(event.deliveryLatencyMs)

    // Keep only recent latencies (last 10000)
    if (latencies.length > 10000) {
      latencies.shift()
    }
  }

  // ==========================================================================
  // URL GENERATION
  // ==========================================================================

  /**
   * Generate a click tracking URL
   */
  generateClickUrl(params: ClickTrackingParams): string {
    if (!this.options.tracking) {
      throw new Error('Tracking not configured')
    }

    const { baseUrl, clickPath = '/t/c' } = this.options.tracking
    const trackingId = generateTrackingId()

    const data: Record<string, string> = {
      tid: trackingId,
      mid: params.messageId,
      lid: params.linkId,
      url: params.destinationUrl,
    }

    if (params.userId) {
      data.uid = params.userId
    }

    const encoded = encodeTrackingData(data)
    return `${baseUrl}${clickPath}/${encoded}`
  }

  /**
   * Generate an open tracking pixel URL
   */
  generateOpenPixelUrl(params: OpenTrackingParams): string {
    if (!this.options.tracking) {
      throw new Error('Tracking not configured')
    }

    const { baseUrl, openPath = '/t/o' } = this.options.tracking
    const trackingId = generateTrackingId()

    const data: Record<string, string> = {
      tid: trackingId,
      mid: params.messageId,
    }

    if (params.userId) {
      data.uid = params.userId
    }

    const encoded = encodeTrackingData(data)
    return `${baseUrl}${openPath}/${encoded}.gif`
  }

  /**
   * Parse tracking data from URL path
   */
  parseTrackingUrl(encodedPath: string): Record<string, string> {
    // Remove file extension if present
    const path = encodedPath.replace(/\.\w+$/, '')
    return decodeTrackingData(path)
  }

  /**
   * Handle click tracking redirect
   */
  async handleClick(
    encodedPath: string,
    context?: { userAgent?: string; ipAddress?: string }
  ): Promise<{ destinationUrl: string; event: ClickedEvent }> {
    const data = this.parseTrackingUrl(encodedPath)

    if (!data.mid || !data.lid || !data.url) {
      throw new Error('Invalid click tracking data')
    }

    // Get existing event data
    const existingEvents = this.events.get(data.mid)
    const lastEvent = existingEvents?.[existingEvents.length - 1]

    const event: ClickedEvent = {
      messageId: data.mid,
      channel: lastEvent?.channel ?? 'email',
      recipient: data.uid ?? lastEvent?.recipient ?? 'unknown',
      status: 'clicked',
      timestamp: Date.now(),
      linkId: data.lid,
      destinationUrl: data.url,
      userAgent: context?.userAgent,
      ipAddress: context?.ipAddress,
      templateId: lastEvent?.templateId,
      campaignId: lastEvent?.campaignId,
    }

    await this.trackDelivery(event)

    return { destinationUrl: data.url, event }
  }

  /**
   * Handle open tracking pixel request
   */
  async handleOpen(
    encodedPath: string,
    context?: { userAgent?: string; ipAddress?: string }
  ): Promise<OpenedEvent> {
    const data = this.parseTrackingUrl(encodedPath)

    if (!data.mid) {
      throw new Error('Invalid open tracking data')
    }

    // Get existing event data
    const existingEvents = this.events.get(data.mid)
    const lastEvent = existingEvents?.[existingEvents.length - 1]

    // Count opens
    const previousOpens = existingEvents?.filter((e) => e.status === 'opened').length ?? 0

    // Detect device type from user agent
    let deviceType: OpenedEvent['deviceType'] = 'unknown'
    if (context?.userAgent) {
      if (/mobile/i.test(context.userAgent)) {
        deviceType = 'mobile'
      } else if (/tablet|ipad/i.test(context.userAgent)) {
        deviceType = 'tablet'
      } else if (/windows|mac|linux/i.test(context.userAgent)) {
        deviceType = 'desktop'
      }
    }

    const event: OpenedEvent = {
      messageId: data.mid,
      channel: lastEvent?.channel ?? 'email',
      recipient: data.uid ?? lastEvent?.recipient ?? 'unknown',
      status: 'opened',
      timestamp: Date.now(),
      openCount: previousOpens + 1,
      userAgent: context?.userAgent,
      ipAddress: context?.ipAddress,
      deviceType,
      templateId: lastEvent?.templateId,
      campaignId: lastEvent?.campaignId,
    }

    await this.trackDelivery(event)

    return event
  }

  // ==========================================================================
  // SUPPRESSION LIST
  // ==========================================================================

  /**
   * Add recipient to suppression list
   */
  suppress(
    recipient: string,
    reason: SuppressionEntry['reason'],
    channel?: DeliveryChannel,
    sourceEvent?: DeliveryEvent
  ): void {
    const key = channel ? `${recipient}:${channel}` : recipient

    this.suppressions.set(key, {
      recipient,
      channel,
      reason,
      suppressedAt: Date.now(),
      sourceEvent,
    })

    // Update recipient metrics
    const metrics = this.recipientMetricsCache.get(recipient)
    if (metrics) {
      metrics.suppressed = true
      metrics.suppressionReason = reason
    }
  }

  /**
   * Remove recipient from suppression list
   */
  unsuppress(recipient: string, channel?: DeliveryChannel): void {
    const key = channel ? `${recipient}:${channel}` : recipient
    this.suppressions.delete(key)

    // Update recipient metrics
    const metrics = this.recipientMetricsCache.get(recipient)
    if (metrics) {
      metrics.suppressed = false
      metrics.suppressionReason = undefined
    }
  }

  /**
   * Check if recipient is suppressed
   */
  isSuppressed(recipient: string, channel?: DeliveryChannel): boolean {
    // Check channel-specific suppression first
    if (channel && this.suppressions.has(`${recipient}:${channel}`)) {
      return true
    }
    // Check global suppression
    return this.suppressions.has(recipient)
  }

  /**
   * Get suppression list
   */
  getSuppressionList(query?: SuppressionQuery): SuppressionEntry[] {
    let entries = Array.from(this.suppressions.values())

    if (query?.reason) {
      entries = entries.filter((e) => e.reason === query.reason)
    }

    if (query?.channel) {
      entries = entries.filter((e) => !e.channel || e.channel === query.channel)
    }

    // Sort by suppression date (most recent first)
    entries.sort((a, b) => b.suppressedAt - a.suppressedAt)

    // Apply pagination
    const offset = query?.offset ?? 0
    const limit = query?.limit ?? 100
    return entries.slice(offset, offset + limit)
  }

  // ==========================================================================
  // ANALYTICS QUERIES
  // ==========================================================================

  /**
   * Get channel report with time-series data
   */
  async getChannelReport(
    channel: DeliveryChannel,
    query: ChannelReportQuery
  ): Promise<ChannelReport> {
    const bucket = query.bucket ?? 'day'
    const messageIds = this.eventsByChannel.get(channel) ?? []

    // Collect events in time range
    const eventsInRange: AnyDeliveryEvent[] = []
    for (const messageId of messageIds) {
      const events = this.events.get(messageId) ?? []
      for (const event of events) {
        if (event.timestamp >= query.startTime && event.timestamp < query.endTime) {
          // Apply template filter
          if (query.templateId && event.templateId !== query.templateId) continue
          // Apply campaign filter
          if (query.campaignId && event.campaignId !== query.campaignId) continue
          eventsInRange.push(event)
        }
      }
    }

    // Aggregate by time bucket
    const bucketedEvents = new Map<number, AnyDeliveryEvent[]>()
    for (const event of eventsInRange) {
      const bucketStart = getBucketStart(event.timestamp, bucket)
      let bucketEvents = bucketedEvents.get(bucketStart)
      if (!bucketEvents) {
        bucketEvents = []
        bucketedEvents.set(bucketStart, bucketEvents)
      }
      bucketEvents.push(event)
    }

    // Generate time series
    const timeSeries: TimeSeriesPoint[] = []
    const bucketDuration = getBucketDuration(bucket)
    let currentBucket = getBucketStart(query.startTime, bucket)

    while (currentBucket < query.endTime) {
      const events = bucketedEvents.get(currentBucket) ?? []
      timeSeries.push({
        timestamp: currentBucket,
        metrics: this.aggregateEvents(events, channel, currentBucket, currentBucket + bucketDuration),
      })
      currentBucket += bucketDuration
    }

    // Calculate summary
    const summary = this.aggregateEvents(eventsInRange, channel, query.startTime, query.endTime)

    return {
      channel,
      summary: summary as ChannelMetrics,
      timeSeries,
    }
  }

  /**
   * Get multi-channel comparison report
   */
  async getChannelComparisonReport(query: TimeRange): Promise<ChannelComparisonReport> {
    const byChannel = new Map<DeliveryChannel, ChannelMetrics>()
    const channels = Array.from(this.eventsByChannel.keys())

    for (const channel of channels) {
      const report = await this.getChannelReport(channel, {
        startTime: query.startTime,
        endTime: query.endTime,
      })
      byChannel.set(channel, report.summary)
    }

    // Calculate totals
    const totals = this.calculateTotals(Array.from(byChannel.values()))

    return {
      timeRange: query,
      byChannel,
      totals,
    }
  }

  /**
   * Get recipient metrics
   */
  getRecipientMetrics(recipient: string): RecipientMetrics | undefined {
    return this.recipientMetricsCache.get(recipient)
  }

  /**
   * Get top recipients by engagement
   */
  getTopRecipients(query: RecipientReportQuery): RecipientMetrics[] {
    let recipients = Array.from(this.recipientMetricsCache.values())

    // Apply channel filter (would need more complex filtering in production)
    if (query.channel) {
      const channelMessages = this.eventsByChannel.get(query.channel) ?? []
      const channelRecipients = new Set<string>()
      for (const messageId of channelMessages) {
        const events = this.events.get(messageId)
        if (events?.length) {
          channelRecipients.add(events[0]!.recipient)
        }
      }
      recipients = recipients.filter((r) => channelRecipients.has(r.recipient))
    }

    // Sort
    const sortBy = query.sortBy ?? 'engagementScore'
    const sortOrder = query.sortOrder ?? 'desc'
    recipients.sort((a, b) => {
      const aVal = a[sortBy] ?? 0
      const bVal = b[sortBy] ?? 0
      return sortOrder === 'desc' ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number)
    })

    // Limit
    return recipients.slice(0, query.limit ?? 100)
  }

  /**
   * Get message history for a recipient
   */
  getRecipientHistory(
    recipient: string,
    query?: TimeRange
  ): AnyDeliveryEvent[] {
    const messageIds = this.eventsByRecipient.get(recipient) ?? []
    const events: AnyDeliveryEvent[] = []

    for (const messageId of messageIds) {
      const messageEvents = this.events.get(messageId) ?? []
      for (const event of messageEvents) {
        if (!query || (event.timestamp >= query.startTime && event.timestamp < query.endTime)) {
          events.push(event)
        }
      }
    }

    return events.sort((a, b) => b.timestamp - a.timestamp)
  }

  /**
   * Get event history for a message
   */
  getMessageHistory(messageId: string): AnyDeliveryEvent[] {
    return this.events.get(messageId) ?? []
  }

  /**
   * Get current status for a message
   */
  getMessageStatus(messageId: string): DeliveryStatus | undefined {
    const events = this.events.get(messageId)
    return events?.[events.length - 1]?.status
  }

  private aggregateEvents(
    events: AnyDeliveryEvent[],
    channel: DeliveryChannel,
    periodStart: number,
    periodEnd: number
  ): Partial<ChannelMetrics> {
    const counts = {
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      hardBounced: 0,
      softBounced: 0,
      complained: 0,
      unsubscribed: 0,
      failed: 0,
    }

    const latencies: number[] = []

    for (const event of events) {
      switch (event.status) {
        case 'sent':
          counts.sent++
          break
        case 'delivered':
          counts.delivered++
          if ((event as DeliveredEvent).deliveryLatencyMs) {
            latencies.push((event as DeliveredEvent).deliveryLatencyMs!)
          }
          break
        case 'opened':
          counts.opened++
          break
        case 'clicked':
          counts.clicked++
          break
        case 'bounced':
          counts.bounced++
          counts.hardBounced++
          break
        case 'soft_bounced':
          counts.bounced++
          counts.softBounced++
          break
        case 'complained':
          counts.complained++
          break
        case 'unsubscribed':
          counts.unsubscribed++
          break
        case 'failed':
          counts.failed++
          break
      }
    }

    // Calculate rates
    const deliveryRate = counts.sent > 0 ? counts.delivered / counts.sent : 0
    const openRate = counts.delivered > 0 ? counts.opened / counts.delivered : 0
    const clickRate = counts.delivered > 0 ? counts.clicked / counts.delivered : 0
    const clickThroughRate = counts.opened > 0 ? counts.clicked / counts.opened : 0
    const bounceRate = counts.sent > 0 ? counts.bounced / counts.sent : 0
    const complaintRate = counts.delivered > 0 ? counts.complained / counts.delivered : 0

    // Calculate latency percentiles
    const avgDeliveryLatencyMs =
      latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0
    const p95DeliveryLatencyMs = calculatePercentile(latencies, 95)
    const p99DeliveryLatencyMs = calculatePercentile(latencies, 99)

    return {
      channel,
      periodStart,
      periodEnd,
      ...counts,
      deliveryRate,
      openRate,
      clickRate,
      clickThroughRate,
      bounceRate,
      complaintRate,
      avgDeliveryLatencyMs,
      p95DeliveryLatencyMs,
      p99DeliveryLatencyMs,
    }
  }

  private calculateTotals(
    channelMetrics: ChannelMetrics[]
  ): Omit<ChannelMetrics, 'channel'> {
    const totals = {
      periodStart: Math.min(...channelMetrics.map((m) => m.periodStart)),
      periodEnd: Math.max(...channelMetrics.map((m) => m.periodEnd)),
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      hardBounced: 0,
      softBounced: 0,
      complained: 0,
      unsubscribed: 0,
      failed: 0,
      deliveryRate: 0,
      openRate: 0,
      clickRate: 0,
      clickThroughRate: 0,
      bounceRate: 0,
      complaintRate: 0,
      avgDeliveryLatencyMs: 0,
      p95DeliveryLatencyMs: 0,
      p99DeliveryLatencyMs: 0,
    }

    for (const metrics of channelMetrics) {
      totals.sent += metrics.sent
      totals.delivered += metrics.delivered
      totals.opened += metrics.opened
      totals.clicked += metrics.clicked
      totals.bounced += metrics.bounced
      totals.hardBounced += metrics.hardBounced
      totals.softBounced += metrics.softBounced
      totals.complained += metrics.complained
      totals.unsubscribed += metrics.unsubscribed
      totals.failed += metrics.failed
    }

    // Recalculate rates
    totals.deliveryRate = totals.sent > 0 ? totals.delivered / totals.sent : 0
    totals.openRate = totals.delivered > 0 ? totals.opened / totals.delivered : 0
    totals.clickRate = totals.delivered > 0 ? totals.clicked / totals.delivered : 0
    totals.clickThroughRate = totals.opened > 0 ? totals.clicked / totals.opened : 0
    totals.bounceRate = totals.sent > 0 ? totals.bounced / totals.sent : 0
    totals.complaintRate = totals.delivered > 0 ? totals.complained / totals.delivered : 0

    // Average latencies
    const latencyChannels = channelMetrics.filter((m) => m.avgDeliveryLatencyMs > 0)
    if (latencyChannels.length > 0) {
      totals.avgDeliveryLatencyMs =
        latencyChannels.reduce((a, b) => a + b.avgDeliveryLatencyMs, 0) / latencyChannels.length
      totals.p95DeliveryLatencyMs = Math.max(...latencyChannels.map((m) => m.p95DeliveryLatencyMs))
      totals.p99DeliveryLatencyMs = Math.max(...latencyChannels.map((m) => m.p99DeliveryLatencyMs))
    }

    return totals
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Get overall analytics statistics
   */
  getStats(): {
    totalMessages: number
    totalRecipients: number
    totalSuppressions: number
    eventsByChannel: Record<string, number>
  } {
    return {
      totalMessages: this.events.size,
      totalRecipients: this.recipientMetricsCache.size,
      totalSuppressions: this.suppressions.size,
      eventsByChannel: Object.fromEntries(
        Array.from(this.eventsByChannel.entries()).map(([channel, ids]) => [channel, ids.length])
      ),
    }
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Clear all analytics data
   */
  clear(): void {
    this.events.clear()
    this.eventsByRecipient.clear()
    this.eventsByChannel.clear()
    this.eventsByCampaign.clear()
    this.suppressions.clear()
    this.recipientMetricsCache.clear()
    this.deliveryLatencies.clear()
    this.totalEventCount = 0
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new DeliveryAnalytics instance
 *
 * @param options - Configuration options
 * @returns A new DeliveryAnalytics instance
 *
 * @example
 * ```typescript
 * const analytics = createDeliveryAnalytics({
 *   tracking: {
 *     baseUrl: 'https://track.dotdo.dev',
 *   },
 *   autoSuppressOnBounce: true,
 *   onEvent: (event) => {
 *     console.log('Delivery event:', event)
 *   },
 * })
 *
 * // Track sent notification
 * await analytics.trackDelivery({
 *   messageId: 'msg-123',
 *   channel: 'email',
 *   recipient: 'user@example.com',
 *   status: 'sent',
 * })
 *
 * // Generate tracking URLs
 * const pixelUrl = analytics.generateOpenPixelUrl({ messageId: 'msg-123' })
 * const clickUrl = analytics.generateClickUrl({
 *   messageId: 'msg-123',
 *   linkId: 'cta',
 *   destinationUrl: 'https://app.dotdo.dev',
 * })
 *
 * // Query analytics
 * const report = await analytics.getChannelReport('email', {
 *   startTime: Date.now() - 7 * 24 * 60 * 60 * 1000,
 *   endTime: Date.now(),
 *   bucket: 'day',
 * })
 * ```
 */
export function createDeliveryAnalytics(
  options?: DeliveryAnalyticsOptions
): DeliveryAnalytics {
  return new DeliveryAnalytics(options)
}
