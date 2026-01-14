/**
 * Discord Channel Adapter
 *
 * Provides Discord notification delivery:
 * - Webhook-based message delivery
 * - Direct messages via bot
 * - Rich embed formatting
 * - Channel messages
 *
 * @example
 * ```typescript
 * import { createDiscordAdapter } from 'db/primitives/notifications/channels/discord'
 *
 * const discordAdapter = createDiscordAdapter({
 *   webhookUrl: process.env.DISCORD_WEBHOOK_URL,
 *   // Or for bot-based delivery:
 *   botToken: process.env.DISCORD_BOT_TOKEN
 * })
 *
 * router.registerChannel(discordAdapter)
 * ```
 *
 * @module db/primitives/notifications/channels/discord
 */

import type { ChannelAdapter, NotificationPayload, Recipient } from '../router'

// =============================================================================
// Types
// =============================================================================

export interface DiscordConfig {
  /** Webhook URL for channel messages */
  webhookUrl?: string
  /** Bot token for DMs and channel messages */
  botToken?: string
  /** Default channel ID for bot messages */
  defaultChannelId?: string
  /** Username to display for webhook messages */
  username?: string
  /** Avatar URL to display for webhook messages */
  avatarUrl?: string
  /** Custom send function (for testing) */
  customSend?: (payload: DiscordPayload) => Promise<{ messageId: string }>
}

export interface DiscordPayload {
  content: string
  embeds?: DiscordEmbed[]
  username?: string
  avatarUrl?: string
  channelId?: string
  userId?: string
}

export interface DiscordEmbed {
  title?: string
  description?: string
  url?: string
  color?: number
  timestamp?: string
  footer?: { text: string; icon_url?: string }
  author?: { name: string; url?: string; icon_url?: string }
  fields?: DiscordEmbedField[]
  thumbnail?: { url: string }
  image?: { url: string }
}

export interface DiscordEmbedField {
  name: string
  value: string
  inline?: boolean
}

// Priority to color mapping (Discord uses integer colors)
const PRIORITY_COLORS: Record<string, number> = {
  low: 0x808080, // Gray
  normal: 0x3498db, // Blue
  high: 0xff9900, // Orange
  critical: 0xff0000, // Red
}

// =============================================================================
// Discord Adapter Implementation
// =============================================================================

export function createDiscordAdapter(config: DiscordConfig): ChannelAdapter {
  return {
    type: 'webhook', // Discord uses webhook channel type since it's technically a webhook

    async send(notification: NotificationPayload, recipient: Recipient): Promise<{ messageId: string }> {
      const channelId = recipient.discordChannelId ?? config.defaultChannelId
      const webhookUrl = recipient.discordWebhookUrl ?? config.webhookUrl

      if (!webhookUrl && !config.botToken) {
        const error = new Error('Discord webhook URL or bot token is required')
        ;(error as any).retryable = false
        throw error
      }

      // Build message content
      let content = notification.body
      if (notification.subject) {
        content = `**${notification.subject}**\n${notification.body}`
      }

      // Build embed for richer formatting
      const embeds: DiscordEmbed[] = []

      if (notification.priority === 'high' || notification.priority === 'critical') {
        embeds.push({
          title: notification.subject ?? (notification.priority === 'critical' ? 'CRITICAL ALERT' : 'High Priority'),
          description: notification.body,
          color: PRIORITY_COLORS[notification.priority] ?? PRIORITY_COLORS.normal,
          timestamp: new Date().toISOString(),
          footer: {
            text: notification.category ?? 'Notification',
          },
        })
        // Clear content since we're using embed
        content = ''
      }

      const payload: DiscordPayload = {
        content,
        embeds: embeds.length > 0 ? embeds : undefined,
        username: config.username,
        avatarUrl: config.avatarUrl,
        channelId,
        userId: recipient.discordUserId,
      }

      // Use custom send if provided
      if (config.customSend) {
        return config.customSend(payload)
      }

      // Send via webhook or bot
      if (webhookUrl) {
        return sendViaWebhook(payload, webhookUrl)
      } else if (config.botToken) {
        return sendViaBot(payload, config)
      }

      throw new Error('No Discord delivery method available')
    },

    async validateRecipient(recipient: Recipient): Promise<boolean> {
      // Must have either a webhook URL, channel ID (with bot), or user ID (for DMs)
      return !!(
        recipient.discordWebhookUrl ??
        config.webhookUrl ??
        recipient.discordChannelId ??
        config.defaultChannelId ??
        recipient.discordUserId
      )
    },
  }
}

// =============================================================================
// Discord API Implementations
// =============================================================================

async function sendViaWebhook(payload: DiscordPayload, webhookUrl: string): Promise<{ messageId: string }> {
  const response = await fetch(webhookUrl + '?wait=true', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: payload.content || undefined,
      embeds: payload.embeds,
      username: payload.username,
      avatar_url: payload.avatarUrl,
    }),
  })

  if (!response.ok) {
    const error = new Error(`Discord webhook error: ${response.status}`)
    ;(error as any).retryable = response.status >= 500 || response.status === 429
    throw error
  }

  const data = (await response.json()) as { id: string }
  return { messageId: data.id }
}

async function sendViaBot(payload: DiscordPayload, config: DiscordConfig): Promise<{ messageId: string }> {
  let channelId = payload.channelId

  // If sending to a user, we need to create a DM channel first
  if (payload.userId && !channelId) {
    const dmChannel = await createDMChannel(payload.userId, config.botToken!)
    channelId = dmChannel.id
  }

  if (!channelId) {
    throw new Error('Discord channel ID is required for bot messages')
  }

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${config.botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: payload.content || undefined,
      embeds: payload.embeds,
    }),
  })

  if (!response.ok) {
    const error = new Error(`Discord API error: ${response.status}`)
    // Rate limits and server errors are retryable
    ;(error as any).retryable = response.status >= 500 || response.status === 429
    throw error
  }

  const data = (await response.json()) as { id: string }
  return { messageId: data.id }
}

async function createDMChannel(userId: string, botToken: string): Promise<{ id: string }> {
  const response = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient_id: userId,
    }),
  })

  if (!response.ok) {
    const error = new Error(`Discord DM channel creation failed: ${response.status}`)
    ;(error as any).retryable = response.status >= 500
    throw error
  }

  return (await response.json()) as { id: string }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a rich Discord embed message
 */
export function createDiscordEmbed(options: {
  title?: string
  description: string
  color?: number | string
  fields?: { name: string; value: string; inline?: boolean }[]
  footer?: string
  timestamp?: boolean
  author?: { name: string; url?: string; iconUrl?: string }
  thumbnail?: string
  image?: string
}): DiscordEmbed {
  let color: number | undefined
  if (typeof options.color === 'string') {
    // Convert hex color to integer
    color = parseInt(options.color.replace('#', ''), 16)
  } else {
    color = options.color
  }

  return {
    title: options.title,
    description: options.description,
    color,
    fields: options.fields,
    footer: options.footer ? { text: options.footer } : undefined,
    timestamp: options.timestamp ? new Date().toISOString() : undefined,
    author: options.author
      ? {
          name: options.author.name,
          url: options.author.url,
          icon_url: options.author.iconUrl,
        }
      : undefined,
    thumbnail: options.thumbnail ? { url: options.thumbnail } : undefined,
    image: options.image ? { url: options.image } : undefined,
  }
}

/**
 * Format text for Discord markdown
 */
export function formatDiscordMarkdown(text: string): string {
  // Discord uses similar markdown to standard, but with some differences
  // Convert common HTML to Discord markdown
  return text
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i>(.*?)<\/i>/gi, '*$1*')
    .replace(/<u>(.*?)<\/u>/gi, '__$1__')
    .replace(/<s>(.*?)<\/s>/gi, '~~$1~~')
    .replace(/<code>(.*?)<\/code>/gi, '`$1`')
    .replace(/<pre>(.*?)<\/pre>/gis, '```\n$1\n```')
    .replace(/<a href="(.*?)">(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?p>/gi, '\n')
}

// =============================================================================
// Exports
// =============================================================================

export type { ChannelAdapter }
