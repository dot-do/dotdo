/**
 * Slack Human Channel
 *
 * Delivers human notifications via Slack webhook or API.
 * Supports BlockKit for rich interactive messages with buttons.
 *
 * @example
 * ```typescript
 * const slack = new SlackHumanChannel({
 *   webhookUrl: 'https://hooks.slack.com/services/...',
 * })
 *
 * await slack.send({
 *   requestId: 'req-123',
 *   message: 'Please approve the partnership agreement',
 *   priority: 'high',
 *   actions: [
 *     { label: 'Approve', value: 'approve', style: 'success' },
 *     { label: 'Reject', value: 'reject', style: 'danger' },
 *   ],
 * })
 * ```
 */

import type {
  HumanNotificationChannel,
  ChannelType,
  NotificationPayload,
  SendResult,
  HumanResponse,
  NotificationAction,
} from './index'
import { generateMessageId } from '../../channels/base'

// =============================================================================
// Types
// =============================================================================

export interface SlackChannelConfig {
  /** Slack webhook URL for posting messages */
  webhookUrl: string
  /** Bot token for API access (optional, enables more features) */
  botToken?: string
  /** Default channel to post to */
  defaultChannel?: string
  /** Custom fetch function (for testing) */
  fetch?: typeof fetch
}

interface SlackBlock {
  type: string
  text?: { type: string; text: string }
  elements?: SlackButtonElement[]
}

interface SlackButtonElement {
  type: 'button'
  text: { type: string; text: string }
  action_id: string
  value: string
  style?: 'primary' | 'danger'
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Slack Human Channel implementation
 */
export class SlackHumanChannel implements HumanNotificationChannel {
  readonly type: ChannelType = 'slack'
  private config: SlackChannelConfig
  private _fetch: typeof fetch

  constructor(config: SlackChannelConfig) {
    this.config = config
    this._fetch = config.fetch ?? globalThis.fetch?.bind(globalThis)
  }

  /**
   * Send a notification via Slack
   */
  async send(payload: NotificationPayload): Promise<SendResult> {
    const timestamp = new Date().toISOString()

    try {
      const blocks = this.buildBlocks(payload)
      const message = this.formatMessage(payload)

      const body = {
        text: message,
        channel: this.config.defaultChannel,
        blocks,
      }

      const url = this.config.botToken
        ? 'https://slack.com/api/chat.postMessage'
        : this.config.webhookUrl

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (this.config.botToken) {
        headers['Authorization'] = `Bearer ${this.config.botToken}`
      }

      const response = await this._fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      const data = await response.json() as { ok?: boolean; ts?: string; error?: string }

      // Slack API returns ok: true on success, webhooks return 200
      const delivered = data.ok ?? response.ok

      return {
        delivered,
        messageId: data.ts || generateMessageId(),
        error: data.error,
        timestamp,
      }
    } catch (error) {
      return {
        delivered: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp,
      }
    }
  }

  /**
   * Build Slack BlockKit blocks for the notification
   */
  private buildBlocks(payload: NotificationPayload): SlackBlock[] {
    const blocks: SlackBlock[] = []

    // Add priority indicator for urgent messages
    const priorityPrefix = payload.priority === 'urgent' ? ':rotating_light: ' :
                           payload.priority === 'high' ? ':warning: ' : ''

    // Section block with message
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${priorityPrefix}${payload.message}`,
      },
    })

    // Add metadata fields if present
    if (payload.metadata && Object.keys(payload.metadata).length > 0) {
      const metadataText = Object.entries(payload.metadata)
        .map(([key, value]) => `*${key}:* ${value}`)
        .join('\n')

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: metadataText,
        },
      })
    }

    // Actions block with buttons
    const actions = payload.actions ?? this.defaultActions()
    const buttonElements: SlackButtonElement[] = actions.map(action => ({
      type: 'button' as const,
      text: { type: 'plain_text', text: action.label },
      action_id: `${action.value}_${payload.requestId}`,
      value: action.value,
      style: this.mapActionStyle(action.style),
    }))

    blocks.push({
      type: 'actions',
      elements: buttonElements,
    })

    return blocks
  }

  /**
   * Format plain text message with priority indicator
   */
  private formatMessage(payload: NotificationPayload): string {
    const priorityPrefix = payload.priority === 'urgent' ? '[URGENT] ' :
                           payload.priority === 'high' ? '[HIGH] ' : ''
    return `${priorityPrefix}${payload.message}`
  }

  /**
   * Default approve/reject actions
   */
  private defaultActions(): NotificationAction[] {
    return [
      { label: 'Approve', value: 'approve', style: 'success' },
      { label: 'Reject', value: 'reject', style: 'danger' },
    ]
  }

  /**
   * Map generic action style to Slack button style
   */
  private mapActionStyle(style?: NotificationAction['style']): 'primary' | 'danger' | undefined {
    switch (style) {
      case 'success':
      case 'primary':
        return 'primary'
      case 'danger':
        return 'danger'
      default:
        return undefined
    }
  }

  /**
   * Handle Slack interaction payload (button clicks)
   */
  handleInteraction(interactionPayload: {
    user: { id: string }
    actions: Array<{ action_id: string; value: string }>
  }): HumanResponse {
    const { user, actions } = interactionPayload

    if (!actions || actions.length === 0) {
      throw new Error('No actions in interaction payload')
    }

    const actionId = actions[0]!.action_id
    const [action, ...requestIdParts] = actionId.split('_')
    const requestId = requestIdParts.join('_')

    return {
      action: action!,
      userId: user.id,
      requestId: requestId || undefined,
      timestamp: new Date(),
    }
  }
}
