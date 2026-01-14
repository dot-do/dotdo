/**
 * Slack Channel Adapter
 *
 * Provides Slack notification delivery:
 * - Direct messages to users
 * - Channel messages
 * - Rich message formatting with blocks
 * - Interactive messages
 *
 * @example
 * ```typescript
 * import { createSlackAdapter } from 'db/primitives/notifications/channels/slack'
 *
 * const slackAdapter = createSlackAdapter({
 *   botToken: process.env.SLACK_BOT_TOKEN,
 *   defaultChannel: '#notifications'
 * })
 *
 * router.registerChannel(slackAdapter)
 * ```
 *
 * @module db/primitives/notifications/channels/slack
 */

import type { ChannelAdapter, NotificationPayload, Recipient } from '../router'

// =============================================================================
// Types
// =============================================================================

export interface SlackConfig {
  botToken: string
  defaultChannel?: string
  // Custom send function (for testing or custom providers)
  customSend?: (payload: SlackPayload) => Promise<{ messageId: string }>
}

export interface SlackPayload {
  channel: string
  text: string
  blocks?: SlackBlock[]
  attachments?: SlackAttachment[]
  threadTs?: string
  unfurlLinks?: boolean
  unfurlMedia?: boolean
  metadata?: Record<string, unknown>
}

export interface SlackBlock {
  type: 'section' | 'divider' | 'header' | 'context' | 'actions' | 'image'
  text?: SlackText
  accessory?: SlackAccessory
  elements?: SlackElement[]
  block_id?: string
}

export interface SlackText {
  type: 'plain_text' | 'mrkdwn'
  text: string
  emoji?: boolean
}

export interface SlackAccessory {
  type: string
  [key: string]: unknown
}

export interface SlackElement {
  type: string
  [key: string]: unknown
}

export interface SlackAttachment {
  color?: string
  pretext?: string
  title?: string
  title_link?: string
  text?: string
  fields?: { title: string; value: string; short?: boolean }[]
  footer?: string
  footer_icon?: string
  ts?: number
}

// =============================================================================
// Slack Adapter Implementation
// =============================================================================

export function createSlackAdapter(config: SlackConfig): ChannelAdapter {
  return {
    type: 'slack',

    async send(notification: NotificationPayload, recipient: Recipient): Promise<{ messageId: string }> {
      const channel = recipient.slackUserId ?? recipient.slackChannel ?? config.defaultChannel

      if (!channel) {
        const error = new Error('Slack channel or user ID is required')
        ;(error as any).retryable = false
        throw error
      }

      // Build message text
      let text = notification.body
      if (notification.subject) {
        text = `*${notification.subject}*\n${notification.body}`
      }

      const payload: SlackPayload = {
        channel: channel as string,
        text,
        metadata: notification.metadata,
      }

      // Add priority indicator for high/critical
      if (notification.priority === 'high' || notification.priority === 'critical') {
        payload.blocks = [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: notification.priority === 'critical' ? ':rotating_light: *CRITICAL*' : ':warning: *HIGH PRIORITY*',
            },
          },
          { type: 'divider' },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text,
            },
          },
        ]
      }

      // Use custom send if provided
      if (config.customSend) {
        return config.customSend(payload)
      }

      return sendViaSlackAPI(payload, config)
    },

    async validateRecipient(recipient: Recipient): Promise<boolean> {
      // Must have either a user ID, channel, or default channel configured
      return !!(recipient.slackUserId ?? recipient.slackChannel ?? config.defaultChannel)
    },
  }
}

// =============================================================================
// Slack API Implementation
// =============================================================================

async function sendViaSlackAPI(payload: SlackPayload, config: SlackConfig): Promise<{ messageId: string }> {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: payload.channel,
      text: payload.text,
      blocks: payload.blocks,
      attachments: payload.attachments,
      thread_ts: payload.threadTs,
      unfurl_links: payload.unfurlLinks,
      unfurl_media: payload.unfurlMedia,
    }),
  })

  if (!response.ok) {
    const error = new Error(`Slack API HTTP error: ${response.status}`)
    ;(error as any).retryable = response.status >= 500 || response.status === 429
    throw error
  }

  const data = (await response.json()) as { ok: boolean; error?: string; ts?: string }

  if (!data.ok) {
    const error = new Error(`Slack API error: ${data.error}`)
    // Some errors are not retryable
    ;(error as any).retryable = ![
      'channel_not_found',
      'user_not_found',
      'not_in_channel',
      'is_archived',
      'invalid_auth',
      'token_revoked',
    ].includes(data.error ?? '')
    throw error
  }

  return { messageId: data.ts ?? `slack_${Date.now()}` }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a rich Slack message with blocks
 */
export function createSlackMessage(options: {
  title?: string
  body: string
  color?: string
  fields?: { title: string; value: string; short?: boolean }[]
  actions?: { text: string; url: string }[]
  footer?: string
}): { text: string; blocks: SlackBlock[]; attachments?: SlackAttachment[] } {
  const blocks: SlackBlock[] = []

  if (options.title) {
    blocks.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: options.title,
        emoji: true,
      },
    })
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: options.body,
    },
  })

  if (options.fields?.length) {
    blocks.push({ type: 'divider' })
    for (const field of options.fields) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${field.title}*\n${field.value}`,
        },
      })
    }
  }

  if (options.actions?.length) {
    blocks.push({ type: 'divider' })
    blocks.push({
      type: 'actions',
      elements: options.actions.map((action) => ({
        type: 'button',
        text: {
          type: 'plain_text',
          text: action.text,
        },
        url: action.url,
      })),
    })
  }

  if (options.footer) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: options.footer,
        },
      ],
    })
  }

  return {
    text: options.title ?? options.body.substring(0, 100),
    blocks,
    attachments: options.color
      ? [
          {
            color: options.color,
            blocks: [],
          } as any,
        ]
      : undefined,
  }
}

// =============================================================================
// Exports
// =============================================================================

export type { ChannelAdapter }
