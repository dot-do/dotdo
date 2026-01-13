/**
 * Discord Human Channel
 *
 * Delivers human notifications via Discord webhooks with embeds and buttons.
 *
 * @example
 * ```typescript
 * const discord = new DiscordHumanChannel({
 *   webhookUrl: 'https://discord.com/api/webhooks/...',
 * })
 *
 * await discord.send({
 *   requestId: 'req-123',
 *   message: 'Please approve the deployment',
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

export interface DiscordChannelConfig {
  /** Discord webhook URL */
  webhookUrl: string
  /** Bot token for API access (optional, enables more features) */
  botToken?: string
  /** Default channel ID */
  defaultChannelId?: string
  /** Custom fetch function (for testing) */
  fetch?: typeof fetch
}

interface DiscordEmbed {
  title: string
  description: string
  color?: number
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  timestamp?: string
}

interface DiscordButton {
  type: 2
  label: string
  style: number
  custom_id?: string
  url?: string
}

interface DiscordActionRow {
  type: 1
  components: DiscordButton[]
}

// =============================================================================
// Constants
// =============================================================================

const BUTTON_STYLES: Record<string, number> = {
  primary: 1,
  secondary: 2,
  success: 3,
  danger: 4,
  link: 5,
}

const PRIORITY_COLORS: Record<string, number> = {
  urgent: 0xff0000,  // Red
  high: 0xffa500,    // Orange
  normal: 0x3498db,  // Blue
  low: 0x95a5a6,     // Gray
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Discord Human Channel implementation
 */
export class DiscordHumanChannel implements HumanNotificationChannel {
  readonly type: ChannelType = 'discord'
  private config: DiscordChannelConfig
  private _fetch: typeof fetch

  constructor(config: DiscordChannelConfig) {
    this.config = config
    this._fetch = config.fetch ?? globalThis.fetch?.bind(globalThis)
  }

  /**
   * Send a notification via Discord webhook
   */
  async send(payload: NotificationPayload): Promise<SendResult> {
    const timestamp = new Date().toISOString()

    try {
      const embed = this.buildEmbed(payload)
      const components = this.buildComponents(payload)

      const body: Record<string, unknown> = {
        content: this.buildMentionContent(payload),
        embeds: [embed],
        components,
      }

      const response = await this._fetch(this.config.webhookUrl + '?wait=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await response.json().catch(() => ({})) as { id?: string }

      return {
        delivered: response.ok,
        messageId: data.id || generateMessageId(),
        error: response.ok ? undefined : `HTTP ${response.status}`,
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
   * Build Discord embed for the notification
   */
  private buildEmbed(payload: NotificationPayload): DiscordEmbed {
    const embed: DiscordEmbed = {
      title: this.getTitle(payload),
      description: payload.message,
      color: PRIORITY_COLORS[payload.priority || 'normal'],
      timestamp: new Date().toISOString(),
    }

    // Add metadata as fields
    if (payload.metadata && Object.keys(payload.metadata).length > 0) {
      embed.fields = Object.entries(payload.metadata).map(([name, value]) => ({
        name,
        value,
        inline: true,
      }))
    }

    return embed
  }

  /**
   * Get title based on priority
   */
  private getTitle(payload: NotificationPayload): string {
    const prefix = payload.priority === 'urgent' ? ':rotating_light: ' :
                   payload.priority === 'high' ? ':warning: ' : ''
    return `${prefix}Approval Request`
  }

  /**
   * Build mention content for the message
   */
  private buildMentionContent(payload: NotificationPayload): string {
    const priorityText = payload.priority === 'urgent' ? '@everyone ' :
                         payload.priority === 'high' ? '@here ' : ''
    return priorityText + 'Action required:'
  }

  /**
   * Build button components
   */
  private buildComponents(payload: NotificationPayload): DiscordActionRow[] {
    const actions = payload.actions ?? this.defaultActions()

    const buttons: DiscordButton[] = actions.map(action => ({
      type: 2 as const,
      label: action.label,
      style: BUTTON_STYLES[action.style || 'secondary'] || 2,
      custom_id: `${action.value}_${payload.requestId}`,
    }))

    return [{ type: 1 as const, components: buttons }]
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
   * Handle Discord interaction (button click)
   */
  handleInteraction(interaction: {
    user: { id: string }
    data: { custom_id: string }
  }): HumanResponse {
    const customId = interaction.data.custom_id
    const [action, ...requestIdParts] = customId.split('_')
    const requestId = requestIdParts.join('_')

    return {
      action: action!,
      userId: interaction.user.id,
      requestId: requestId || undefined,
      timestamp: new Date(),
    }
  }

  /**
   * Handle Discord reaction (emoji-based response)
   */
  handleReaction(reaction: {
    emoji: { name: string }
    user_id: string
    message_id: string
  }): HumanResponse | null {
    const emojiMap: Record<string, string> = {
      '\u2705': 'approve',     // checkmark
      '\u274C': 'reject',      // cross
      '\uD83D\uDC4D': 'approve', // thumbs up
      '\uD83D\uDC4E': 'reject',  // thumbs down
    }

    const action = emojiMap[reaction.emoji.name]
    if (!action) return null

    return {
      action,
      userId: reaction.user_id,
      timestamp: new Date(),
    }
  }
}
