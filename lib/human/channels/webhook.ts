/**
 * Generic Webhook Human Channel
 *
 * Delivers human notifications via configurable webhooks for custom integrations.
 * Useful for connecting to internal systems, custom apps, or third-party services.
 *
 * @example
 * ```typescript
 * const webhook = new WebhookHumanChannel({
 *   url: 'https://internal.company.com/notifications',
 *   headers: { 'X-API-Key': 'secret' },
 * })
 *
 * await webhook.send({
 *   requestId: 'req-123',
 *   message: 'Please approve the budget increase',
 *   priority: 'high',
 * })
 * ```
 */

import type {
  HumanNotificationChannel,
  ChannelType,
  NotificationPayload,
  SendResult,
  HumanResponse,
} from './index'
import { generateMessageId } from '../../channels/base'

// =============================================================================
// Types
// =============================================================================

export interface WebhookChannelConfig {
  /** Webhook endpoint URL */
  url: string
  /** Custom headers to include in requests */
  headers?: Record<string, string>
  /** HTTP method (default: POST) */
  method?: 'POST' | 'PUT'
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Base URL for action links */
  baseUrl?: string
  /** Custom fetch function (for testing) */
  fetch?: typeof fetch
}

/**
 * Webhook payload format sent to the endpoint
 */
export interface WebhookPayload {
  /** Notification ID */
  notificationId: string
  /** Request ID for tracking */
  requestId: string
  /** Message content */
  message: string
  /** Subject (if provided) */
  subject?: string
  /** Priority level */
  priority: string
  /** Available actions */
  actions: Array<{ label: string; value: string; url: string }>
  /** Metadata */
  metadata?: Record<string, string>
  /** When the notification was sent */
  timestamp: string
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BASE_URL = 'https://app.dotdo.dev'
const DEFAULT_TIMEOUT = 30000

// =============================================================================
// Implementation
// =============================================================================

/**
 * Generic Webhook Human Channel implementation
 */
export class WebhookHumanChannel implements HumanNotificationChannel {
  readonly type: ChannelType = 'webhook'
  private config: WebhookChannelConfig
  private _fetch: typeof fetch

  constructor(config: WebhookChannelConfig) {
    if (!config.url) {
      throw new Error('Webhook URL is required')
    }
    this.config = config
    this._fetch = config.fetch ?? globalThis.fetch?.bind(globalThis)
  }

  /**
   * Send a notification via webhook
   */
  async send(payload: NotificationPayload): Promise<SendResult> {
    const timestamp = new Date().toISOString()
    const notificationId = generateMessageId()
    const baseUrl = payload.baseUrl || this.config.baseUrl || DEFAULT_BASE_URL

    // Build action URLs
    const actions = (payload.actions ?? this.defaultActions()).map(action => ({
      label: action.label,
      value: action.value,
      url: `${baseUrl}/approve/${payload.requestId}?action=${encodeURIComponent(action.value)}`,
    }))

    const webhookPayload: WebhookPayload = {
      notificationId,
      requestId: payload.requestId,
      message: payload.message,
      subject: payload.subject,
      priority: payload.priority || 'normal',
      actions,
      metadata: payload.metadata,
      timestamp,
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeout || DEFAULT_TIMEOUT
    )

    try {
      const response = await this._fetch(this.config.url, {
        method: this.config.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(webhookPayload),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const data = await response.json().catch(() => ({})) as { id?: string; messageId?: string }

      return {
        delivered: response.ok,
        messageId: data.id || data.messageId || notificationId,
        error: response.ok ? undefined : `HTTP ${response.status}`,
        timestamp,
      }
    } catch (error) {
      clearTimeout(timeoutId)

      const errorMessage = error instanceof Error
        ? error.name === 'AbortError'
          ? 'Request timed out'
          : error.message
        : String(error)

      return {
        delivered: false,
        error: errorMessage,
        timestamp,
      }
    }
  }

  /**
   * Default approve/reject actions
   */
  private defaultActions() {
    return [
      { label: 'Approve', value: 'approve' },
      { label: 'Reject', value: 'reject' },
    ]
  }

  /**
   * Handle webhook callback response
   *
   * When a user clicks an action link, the callback service should
   * post back the response. This method parses that callback.
   */
  handleCallback(callback: {
    requestId: string
    action: string
    userId?: string
    metadata?: Record<string, unknown>
  }): HumanResponse {
    return {
      action: callback.action,
      userId: callback.userId || 'webhook-user',
      requestId: callback.requestId,
      data: callback.metadata,
      timestamp: new Date(),
    }
  }
}
