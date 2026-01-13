/**
 * Human Notification Channel Interface
 *
 * Clean abstraction for delivering notifications to humans across multiple channels.
 * Used by Human DO and HumanFunctionExecutor for consistent channel delivery.
 *
 * @example
 * ```typescript
 * import { HumanNotificationChannel, createChannel } from 'lib/human/channels'
 *
 * const slack = createChannel({ type: 'slack', webhookUrl: '...' })
 * await slack.send({
 *   requestId: 'req-123',
 *   message: 'Please approve this request',
 *   priority: 'high',
 * })
 * ```
 *
 * @module lib/human/channels
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Channel type identifiers
 */
export type ChannelType = 'slack' | 'email' | 'sms' | 'discord' | 'webhook'

/**
 * Notification priority levels
 */
export type Priority = 'low' | 'normal' | 'high' | 'urgent'

/**
 * Action button for interactive notifications
 */
export interface NotificationAction {
  /** Button label */
  label: string
  /** Action value (e.g., 'approve', 'reject') */
  value: string
  /** Button style */
  style?: 'primary' | 'secondary' | 'success' | 'danger'
}

/**
 * Notification payload sent through channels
 */
export interface NotificationPayload {
  /** Unique request identifier for tracking */
  requestId: string
  /** Message content */
  message: string
  /** Optional subject (used by email) */
  subject?: string
  /** Priority level */
  priority?: Priority
  /** Interactive action buttons */
  actions?: NotificationAction[]
  /** Additional metadata */
  metadata?: Record<string, string>
  /** Base URL for action links */
  baseUrl?: string
}

/**
 * Result of sending a notification
 */
export interface SendResult {
  /** Whether delivery was successful */
  delivered: boolean
  /** Provider message ID */
  messageId?: string
  /** Error message if delivery failed */
  error?: string
  /** Timestamp of delivery */
  timestamp: string
}

/**
 * Human response from a channel interaction
 */
export interface HumanResponse {
  /** Action taken (e.g., 'approve', 'reject') */
  action: string
  /** User identifier */
  userId: string
  /** Request ID this response is for */
  requestId?: string
  /** Additional response data */
  data?: Record<string, unknown>
  /** When the response was received */
  timestamp?: Date
}

/**
 * Human Notification Channel Interface
 *
 * Defines the contract for all channel implementations.
 * Each channel must implement send() and optionally waitForResponse().
 */
export interface HumanNotificationChannel {
  /** Channel type identifier */
  readonly type: ChannelType

  /**
   * Send a notification through this channel
   */
  send(payload: NotificationPayload): Promise<SendResult>

  /**
   * Wait for a human response (interactive channels only)
   */
  waitForResponse?(params: { timeout: number }): Promise<HumanResponse>

  /**
   * Update a previously sent notification (if supported)
   */
  updateNotification?(messageId: string, update: Partial<NotificationPayload>): Promise<void>
}

// =============================================================================
// Re-exports
// =============================================================================

export { SlackHumanChannel } from './slack'
export type { SlackChannelConfig } from './slack'

export { EmailHumanChannel } from './email'
export type { EmailChannelConfig } from './email'

export { SMSHumanChannel } from './sms'
export type { SMSChannelConfig } from './sms'

export { DiscordHumanChannel } from './discord'
export type { DiscordChannelConfig } from './discord'

export { WebhookHumanChannel } from './webhook'
export type { WebhookChannelConfig } from './webhook'

export { createChannel } from '../channel-factory'
export type { ChannelConfig } from '../channel-factory'
