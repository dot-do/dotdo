/**
 * HumanNotificationChannel - Unified multi-channel notification system
 *
 * Provides a unified interface for sending human-in-the-loop notifications
 * across multiple channels (Slack, Discord, Email, SMS) with support for:
 * - Approval requests with interactive buttons/links
 * - Task assignments
 * - Escalation notifications
 * - Response tracking
 * - SLA monitoring
 *
 * @example
 * ```typescript
 * import { HumanNotificationChannel, createNotificationChannel } from 'lib/humans/notification-channel'
 *
 * // Create a multi-channel notifier
 * const notifier = new HumanNotificationChannel({
 *   channels: [
 *     { type: 'slack', webhookUrl: 'https://hooks.slack.com/...' },
 *     { type: 'email', provider: 'sendgrid', apiKey: '...', from: 'noreply@dotdo.dev' },
 *     { type: 'sms', provider: 'twilio', fromNumber: '+15551234567', ... },
 *   ],
 *   baseUrl: 'https://app.dotdo.dev',
 *   routing: {
 *     urgent: ['sms', 'slack'],
 *     high: ['slack', 'email'],
 *     normal: ['email'],
 *     low: ['email'],
 *   },
 * })
 *
 * // Send an approval request
 * const result = await notifier.sendApproval({
 *   requestId: 'req-123',
 *   message: 'Please approve the partnership agreement',
 *   recipient: { email: 'ceo@company.com', phone: '+15559876543', slackId: 'U123' },
 *   priority: 'high',
 *   sla: 3600000, // 1 hour
 * })
 * ```
 *
 * @module lib/humans/notification-channel
 */

import { SlackBlockKitChannel, buildApprovalBlocks, type SlackBlockKitConfig } from '../channels/slack-blockkit'
import { DiscordChannel, buildEmbed, buildActionRow, type DiscordChannelConfig } from '../channels/discord'
import { EmailChannel, renderApprovalEmail, type EmailChannelConfig } from '../channels/email'
import { SMSChannel, type SMSChannelConfig } from '../channels/sms'
import type { HumanResponse as BaseHumanResponse } from '../channels/types'
import { generateMessageId } from '../channels/base'

// =============================================================================
// Types
// =============================================================================

/**
 * Notification priority levels
 */
export type NotificationPriority = 'urgent' | 'high' | 'normal' | 'low'

/**
 * Notification type
 */
export type NotificationType = 'approval' | 'task' | 'question' | 'review' | 'escalation' | 'reminder'

/**
 * Channel type identifiers
 */
export type HumanChannelType = 'slack' | 'discord' | 'email' | 'sms' | 'webhook'

/**
 * Recipient information for multi-channel delivery
 */
export interface NotificationRecipient {
  /** Recipient identifier (human ID or email) */
  id?: string
  /** Email address for email channel */
  email?: string
  /** Phone number for SMS channel (E.164 format) */
  phone?: string
  /** Slack user ID for mentions */
  slackId?: string
  /** Slack channel ID for posting */
  slackChannel?: string
  /** Discord user ID for mentions */
  discordId?: string
  /** Discord channel ID for posting */
  discordChannel?: string
  /** Webhook URL for custom integrations */
  webhookUrl?: string
  /** User's display name */
  name?: string
}

/**
 * Channel-specific configuration union
 */
export type ChannelConfigUnion =
  | ({ type: 'slack' } & SlackBlockKitConfig)
  | ({ type: 'discord' } & DiscordChannelConfig)
  | ({ type: 'email' } & EmailChannelConfig)
  | ({ type: 'sms' } & SMSChannelConfig)
  | { type: 'webhook'; url: string; headers?: Record<string, string> }

/**
 * Channel routing rules based on priority
 */
export interface ChannelRouting {
  urgent?: HumanChannelType[]
  high?: HumanChannelType[]
  normal?: HumanChannelType[]
  low?: HumanChannelType[]
}

/**
 * User channel preferences
 */
export interface UserChannelPreferences {
  /** Preferred channel order */
  preferred?: HumanChannelType[]
  /** Channels to use for urgent notifications */
  urgentChannels?: HumanChannelType[]
  /** Time-based routing (e.g., SMS only during business hours) */
  schedule?: {
    businessHours?: HumanChannelType[]
    afterHours?: HumanChannelType[]
  }
  /** Disabled channels */
  disabled?: HumanChannelType[]
}

/**
 * Human notification payload
 */
export interface HumanNotification {
  /** Unique notification ID */
  notificationId?: string
  /** Request ID for approval tracking */
  requestId: string
  /** Notification type */
  type: NotificationType
  /** Message content */
  message: string
  /** Optional subject line (for email) */
  subject?: string
  /** Recipient information */
  recipient: NotificationRecipient
  /** Priority level */
  priority?: NotificationPriority
  /** Custom actions (default: approve/reject) */
  actions?: Array<{
    label: string
    value: string
    style?: 'primary' | 'secondary' | 'success' | 'danger'
  }>
  /** Additional metadata to include */
  metadata?: Record<string, string>
  /** SLA in milliseconds */
  sla?: number
  /** Base URL for action links */
  baseUrl?: string
  /** Optional context data */
  context?: Record<string, unknown>
}

/**
 * Delivery result for a single channel
 */
export interface ChannelDeliveryResult {
  channel: HumanChannelType
  delivered: boolean
  messageId?: string
  error?: string
  timestamp: string
}

/**
 * Combined delivery result for multi-channel send
 */
export interface DeliveryResult {
  notificationId: string
  requestId: string
  success: boolean
  channels: ChannelDeliveryResult[]
  failedChannels: HumanChannelType[]
  successfulChannels: HumanChannelType[]
}

/**
 * Human response from any channel
 */
export interface HumanResponse extends BaseHumanResponse {
  /** Channel the response came from */
  channel?: HumanChannelType
  /** Response timestamp */
  respondedAt?: string
  /** Request ID */
  requestId?: string
}

/**
 * Update notification payload (for message updates)
 */
export interface NotificationUpdate {
  /** New message content */
  message?: string
  /** Update status indicator */
  status?: 'responded' | 'expired' | 'cancelled'
  /** Response result */
  result?: {
    action: string
    respondedBy?: string
    respondedAt?: string
  }
}

/**
 * HumanNotificationChannel configuration
 */
export interface HumanNotificationChannelConfig {
  /** Configured channels */
  channels: ChannelConfigUnion[]
  /** Base URL for action links */
  baseUrl?: string
  /** Channel routing rules */
  routing?: ChannelRouting
  /** Default priority */
  defaultPriority?: NotificationPriority
  /** Retry configuration */
  retry?: {
    maxAttempts?: number
    delayMs?: number
  }
  /** Custom fetch function (for testing) */
  fetch?: typeof fetch
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BASE_URL = 'https://app.dotdo.dev'

const DEFAULT_ROUTING: ChannelRouting = {
  urgent: ['sms', 'slack', 'discord', 'email'],
  high: ['slack', 'discord', 'email'],
  normal: ['email', 'slack'],
  low: ['email'],
}

// =============================================================================
// Channel Wrapper Classes
// =============================================================================

/**
 * Base interface for human notification channel adapters
 */
interface HumanChannelAdapter {
  readonly type: HumanChannelType
  send(notification: HumanNotification): Promise<ChannelDeliveryResult>
  updateNotification?(messageId: string, update: NotificationUpdate): Promise<void>
}

/**
 * Slack adapter for human notifications
 */
class SlackHumanChannelAdapter implements HumanChannelAdapter {
  readonly type: HumanChannelType = 'slack'
  private channel: SlackBlockKitChannel

  constructor(config: SlackBlockKitConfig) {
    this.channel = new SlackBlockKitChannel(config)
  }

  async send(notification: HumanNotification): Promise<ChannelDeliveryResult> {
    const timestamp = new Date().toISOString()

    try {
      const blocks = buildApprovalBlocks({
        message: notification.message,
        requestId: notification.requestId,
        actions: notification.actions?.map((a) => ({
          label: a.label,
          value: a.value,
          style: a.style === 'danger' ? 'danger' : a.style === 'primary' || a.style === 'success' ? 'primary' : undefined,
        })),
      })

      // Build message content with mentions if needed
      let messageText = notification.message
      if (notification.recipient.slackId) {
        messageText = `<@${notification.recipient.slackId}> ${messageText}`
      }

      const result = await this.channel.send({
        message: messageText,
        channel: notification.recipient.slackChannel,
        blocks,
      })

      return {
        channel: 'slack',
        delivered: result.delivered,
        messageId: result.ts,
        timestamp,
      }
    } catch (error) {
      return {
        channel: 'slack',
        delivered: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp,
      }
    }
  }
}

/**
 * Discord adapter for human notifications
 */
class DiscordHumanChannelAdapter implements HumanChannelAdapter {
  readonly type: HumanChannelType = 'discord'
  private channel: DiscordChannel

  constructor(config: DiscordChannelConfig) {
    this.channel = new DiscordChannel(config)
  }

  async send(notification: HumanNotification): Promise<ChannelDeliveryResult> {
    const timestamp = new Date().toISOString()

    try {
      // Build embed for notification
      const embed = buildEmbed({
        title: this.getNotificationTitle(notification.type),
        description: notification.message,
        color: this.getPriorityColor(notification.priority),
        fields: notification.metadata
          ? Object.entries(notification.metadata).map(([name, value]) => ({ name, value, inline: true }))
          : undefined,
        timestamp: true,
      })

      // Build action row with buttons
      const components = notification.actions
        ? [
            buildActionRow({
              requestId: notification.requestId,
              actions: notification.actions.map((a) => ({
                label: a.label,
                value: a.value,
                style: a.style || 'secondary',
              })),
            }),
          ]
        : [
            buildActionRow({
              requestId: notification.requestId,
              actions: [
                { label: 'Approve', value: 'approve', style: 'success' },
                { label: 'Reject', value: 'reject', style: 'danger' },
              ],
            }),
          ]

      // Build mentions
      const mentions = notification.recipient.discordId ? [`<@${notification.recipient.discordId}>`] : undefined

      const result = await this.channel.send({
        message: notification.subject || this.getNotificationTitle(notification.type),
        mentions,
        embeds: [embed],
        components,
      })

      return {
        channel: 'discord',
        delivered: result.delivered,
        messageId: result.messageId,
        timestamp,
      }
    } catch (error) {
      return {
        channel: 'discord',
        delivered: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp,
      }
    }
  }

  private getNotificationTitle(type: NotificationType): string {
    const titles: Record<NotificationType, string> = {
      approval: 'Approval Request',
      task: 'Task Assignment',
      question: 'Question',
      review: 'Review Request',
      escalation: 'Escalation',
      reminder: 'Reminder',
    }
    return titles[type] || 'Notification'
  }

  private getPriorityColor(priority?: NotificationPriority): number {
    const colors: Record<NotificationPriority, number> = {
      urgent: 0xff0000, // Red
      high: 0xffa500, // Orange
      normal: 0x3498db, // Blue
      low: 0x95a5a6, // Gray
    }
    return colors[priority || 'normal']
  }
}

/**
 * Email adapter for human notifications
 */
class EmailHumanChannelAdapter implements HumanChannelAdapter {
  readonly type: HumanChannelType = 'email'
  private channel: EmailChannel
  private baseUrl: string

  constructor(config: EmailChannelConfig, baseUrl: string = DEFAULT_BASE_URL) {
    this.channel = new EmailChannel(config)
    this.baseUrl = baseUrl
  }

  async send(notification: HumanNotification): Promise<ChannelDeliveryResult> {
    const timestamp = new Date().toISOString()

    if (!notification.recipient.email) {
      return {
        channel: 'email',
        delivered: false,
        error: 'No email address provided',
        timestamp,
      }
    }

    try {
      // Render approval email HTML
      const emailResult = renderApprovalEmail({
        message: notification.message,
        requestId: notification.requestId,
        baseUrl: notification.baseUrl || this.baseUrl,
        metadata: notification.metadata,
        returnBoth: true,
      })

      const html = typeof emailResult === 'string' ? emailResult : emailResult.html

      const result = await this.channel.send({
        message: notification.message,
        to: notification.recipient.email,
        subject: notification.subject || this.getSubjectLine(notification),
        html,
      })

      return {
        channel: 'email',
        delivered: result.delivered,
        messageId: result.messageId,
        timestamp,
      }
    } catch (error) {
      return {
        channel: 'email',
        delivered: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp,
      }
    }
  }

  private getSubjectLine(notification: HumanNotification): string {
    const prefixes: Record<NotificationType, string> = {
      approval: '[Action Required]',
      task: '[Task]',
      question: '[Question]',
      review: '[Review Required]',
      escalation: '[URGENT]',
      reminder: '[Reminder]',
    }
    const prefix = prefixes[notification.type] || ''
    const priorityMarker = notification.priority === 'urgent' ? '!!!' : notification.priority === 'high' ? '!!' : ''
    return `${prefix}${priorityMarker} ${notification.message.substring(0, 50)}${notification.message.length > 50 ? '...' : ''}`
  }
}

/**
 * SMS adapter for human notifications
 */
class SMSHumanChannelAdapter implements HumanChannelAdapter {
  readonly type: HumanChannelType = 'sms'
  private channel: SMSChannel
  private baseUrl: string

  constructor(config: SMSChannelConfig, baseUrl: string = DEFAULT_BASE_URL) {
    this.channel = new SMSChannel(config)
    this.baseUrl = baseUrl
  }

  async send(notification: HumanNotification): Promise<ChannelDeliveryResult> {
    const timestamp = new Date().toISOString()

    if (!notification.recipient.phone) {
      return {
        channel: 'sms',
        delivered: false,
        error: 'No phone number provided',
        timestamp,
      }
    }

    try {
      const result = await this.channel.sendApproval({
        message: notification.message,
        to: notification.recipient.phone,
        requestId: notification.requestId,
        baseUrl: notification.baseUrl || this.baseUrl,
        actions: notification.actions,
      })

      return {
        channel: 'sms',
        delivered: result.delivered,
        messageId: result.messageId,
        timestamp,
      }
    } catch (error) {
      return {
        channel: 'sms',
        delivered: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp,
      }
    }
  }
}

/**
 * Webhook adapter for human notifications (custom integrations)
 */
class WebhookHumanChannelAdapter implements HumanChannelAdapter {
  readonly type: HumanChannelType = 'webhook'
  private url: string
  private headers: Record<string, string>
  private _fetch: typeof fetch

  constructor(config: { url: string; headers?: Record<string, string>; fetch?: typeof fetch }) {
    this.url = config.url
    this.headers = config.headers || {}
    this._fetch = config.fetch ?? globalThis.fetch?.bind(globalThis)
  }

  async send(notification: HumanNotification): Promise<ChannelDeliveryResult> {
    const timestamp = new Date().toISOString()

    const webhookUrl = notification.recipient.webhookUrl || this.url

    if (!webhookUrl) {
      return {
        channel: 'webhook',
        delivered: false,
        error: 'No webhook URL provided',
        timestamp,
      }
    }

    try {
      const response = await this._fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify({
          notificationId: notification.notificationId,
          requestId: notification.requestId,
          type: notification.type,
          message: notification.message,
          subject: notification.subject,
          recipient: notification.recipient,
          priority: notification.priority,
          actions: notification.actions,
          metadata: notification.metadata,
          sla: notification.sla,
          timestamp,
        }),
      })

      const data = (await response.json().catch(() => ({}))) as { id?: string }

      return {
        channel: 'webhook',
        delivered: response.ok,
        messageId: data.id || generateMessageId(),
        timestamp,
      }
    } catch (error) {
      return {
        channel: 'webhook',
        delivered: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp,
      }
    }
  }
}

// =============================================================================
// Main HumanNotificationChannel Class
// =============================================================================

/**
 * HumanNotificationChannel - Unified multi-channel notification system
 *
 * Provides a unified interface for sending human-in-the-loop notifications
 * across multiple channels with priority-based routing and delivery tracking.
 */
export class HumanNotificationChannel {
  private adapters: Map<HumanChannelType, HumanChannelAdapter> = new Map()
  private routing: ChannelRouting
  private baseUrl: string
  private defaultPriority: NotificationPriority
  private retryConfig: { maxAttempts: number; delayMs: number }

  constructor(config: HumanNotificationChannelConfig) {
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL
    this.routing = config.routing || DEFAULT_ROUTING
    this.defaultPriority = config.defaultPriority || 'normal'
    this.retryConfig = {
      maxAttempts: config.retry?.maxAttempts || 3,
      delayMs: config.retry?.delayMs || 1000,
    }

    // Initialize channel adapters
    for (const channelConfig of config.channels) {
      this.registerChannel(channelConfig, config.fetch)
    }
  }

  /**
   * Register a channel adapter
   */
  private registerChannel(config: ChannelConfigUnion, customFetch?: typeof fetch): void {
    switch (config.type) {
      case 'slack':
        this.adapters.set('slack', new SlackHumanChannelAdapter(config))
        break
      case 'discord':
        this.adapters.set('discord', new DiscordHumanChannelAdapter(config))
        break
      case 'email':
        this.adapters.set('email', new EmailHumanChannelAdapter(config, this.baseUrl))
        break
      case 'sms': {
        const smsConfig = customFetch ? { ...config, fetch: customFetch } : config
        this.adapters.set('sms', new SMSHumanChannelAdapter(smsConfig, this.baseUrl))
        break
      }
      case 'webhook':
        this.adapters.set('webhook', new WebhookHumanChannelAdapter({ ...config, fetch: customFetch }))
        break
    }
  }

  /**
   * Get available channel types
   */
  get availableChannels(): HumanChannelType[] {
    return Array.from(this.adapters.keys())
  }

  /**
   * Send a notification through configured channels based on routing rules
   */
  async send(notification: HumanNotification): Promise<DeliveryResult> {
    const notificationId = notification.notificationId || generateMessageId()
    const priority = notification.priority || this.defaultPriority

    // Determine which channels to use based on priority and recipient
    const targetChannels = this.resolveChannels(notification.recipient, priority)

    const results: ChannelDeliveryResult[] = []
    const successfulChannels: HumanChannelType[] = []
    const failedChannels: HumanChannelType[] = []

    // Send to all target channels
    for (const channelType of targetChannels) {
      const adapter = this.adapters.get(channelType)
      if (!adapter) continue

      // Add notification ID to the notification
      const enrichedNotification = { ...notification, notificationId }

      const result = await this.sendWithRetry(adapter, enrichedNotification)
      results.push(result)

      if (result.delivered) {
        successfulChannels.push(channelType)
      } else {
        failedChannels.push(channelType)
      }
    }

    return {
      notificationId,
      requestId: notification.requestId,
      success: successfulChannels.length > 0,
      channels: results,
      successfulChannels,
      failedChannels,
    }
  }

  /**
   * Send an approval request notification
   */
  async sendApproval(
    options: Omit<HumanNotification, 'type'> & { type?: NotificationType }
  ): Promise<DeliveryResult> {
    return this.send({
      ...options,
      type: options.type || 'approval',
      actions: options.actions || [
        { label: 'Approve', value: 'approve', style: 'success' },
        { label: 'Reject', value: 'reject', style: 'danger' },
      ],
    })
  }

  /**
   * Send a task assignment notification
   */
  async sendTask(
    options: Omit<HumanNotification, 'type' | 'actions'>
  ): Promise<DeliveryResult> {
    return this.send({
      ...options,
      type: 'task',
      actions: [
        { label: 'Accept', value: 'accept', style: 'success' },
        { label: 'Decline', value: 'decline', style: 'danger' },
      ],
    })
  }

  /**
   * Send an escalation notification
   */
  async sendEscalation(
    options: Omit<HumanNotification, 'type' | 'priority'>
  ): Promise<DeliveryResult> {
    return this.send({
      ...options,
      type: 'escalation',
      priority: 'urgent',
      actions: options.actions || [
        { label: 'Acknowledge', value: 'acknowledge', style: 'primary' },
        { label: 'Escalate Further', value: 'escalate', style: 'danger' },
      ],
    })
  }

  /**
   * Send to a specific channel only
   */
  async sendToChannel(
    channelType: HumanChannelType,
    notification: HumanNotification
  ): Promise<ChannelDeliveryResult> {
    const adapter = this.adapters.get(channelType)
    if (!adapter) {
      return {
        channel: channelType,
        delivered: false,
        error: `Channel not configured: ${channelType}`,
        timestamp: new Date().toISOString(),
      }
    }

    return this.sendWithRetry(adapter, notification)
  }

  /**
   * Resolve which channels to use based on recipient and priority
   */
  private resolveChannels(
    recipient: NotificationRecipient,
    priority: NotificationPriority,
    preferences?: UserChannelPreferences
  ): HumanChannelType[] {
    // Get routing rules for priority
    const priorityChannels = this.routing[priority] || this.routing.normal || ['email']

    // Filter based on available recipient contact info
    const availableChannels = priorityChannels.filter((channelType) => {
      switch (channelType) {
        case 'slack':
          return recipient.slackId || recipient.slackChannel
        case 'discord':
          return recipient.discordId || recipient.discordChannel
        case 'email':
          return recipient.email
        case 'sms':
          return recipient.phone
        case 'webhook':
          return recipient.webhookUrl || this.adapters.has('webhook')
        default:
          return false
      }
    })

    // Apply user preferences if provided
    if (preferences) {
      // Remove disabled channels
      const enabledChannels = preferences.disabled
        ? availableChannels.filter((c) => !preferences.disabled!.includes(c))
        : availableChannels

      // Apply preferred order if specified
      if (preferences.preferred && preferences.preferred.length > 0) {
        return preferences.preferred.filter((c) => enabledChannels.includes(c))
      }

      return enabledChannels
    }

    // Filter to only configured adapters
    return availableChannels.filter((c) => this.adapters.has(c))
  }

  /**
   * Send with retry logic
   */
  private async sendWithRetry(
    adapter: HumanChannelAdapter,
    notification: HumanNotification
  ): Promise<ChannelDeliveryResult> {
    let lastResult: ChannelDeliveryResult | undefined
    let attempt = 0

    while (attempt < this.retryConfig.maxAttempts) {
      attempt++
      lastResult = await adapter.send(notification)

      if (lastResult.delivered) {
        return lastResult
      }

      // Wait before retry (unless last attempt)
      if (attempt < this.retryConfig.maxAttempts) {
        await this.delay(this.retryConfig.delayMs * attempt)
      }
    }

    return lastResult!
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a HumanNotificationChannel instance
 */
export function createNotificationChannel(
  config: HumanNotificationChannelConfig
): HumanNotificationChannel {
  return new HumanNotificationChannel(config)
}

/**
 * Create a single-channel notifier
 */
export function createSingleChannelNotifier(
  channelConfig: ChannelConfigUnion,
  baseUrl?: string
): HumanNotificationChannel {
  return new HumanNotificationChannel({
    channels: [channelConfig],
    baseUrl,
  })
}

/**
 * Create a Slack-only notifier
 */
export function createSlackNotifier(
  config: SlackBlockKitConfig,
  baseUrl?: string
): HumanNotificationChannel {
  return createSingleChannelNotifier({ type: 'slack', ...config }, baseUrl)
}

/**
 * Create a Discord-only notifier
 */
export function createDiscordNotifier(
  config: DiscordChannelConfig,
  baseUrl?: string
): HumanNotificationChannel {
  return createSingleChannelNotifier({ type: 'discord', ...config }, baseUrl)
}

/**
 * Create an Email-only notifier
 */
export function createEmailNotifier(
  config: EmailChannelConfig,
  baseUrl?: string
): HumanNotificationChannel {
  return createSingleChannelNotifier({ type: 'email', ...config }, baseUrl)
}

/**
 * Create an SMS-only notifier
 */
export function createSMSNotifier(
  config: SMSChannelConfig,
  baseUrl?: string
): HumanNotificationChannel {
  return createSingleChannelNotifier({ type: 'sms', ...config }, baseUrl)
}

// =============================================================================
// Exports
// =============================================================================

export default HumanNotificationChannel
