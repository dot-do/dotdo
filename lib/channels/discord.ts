/**
 * Discord Webhook Channel Adapter
 */

export interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface EmbedOptions {
  title: string
  description: string
  color?: number
  fields?: EmbedField[]
  timestamp?: boolean
}

export interface DiscordEmbed {
  title: string
  description: string
  color?: number
  fields?: EmbedField[]
  timestamp?: string
}

export function buildEmbed(options: EmbedOptions): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: options.title,
    description: options.description,
  }

  if (options.color !== undefined) {
    embed.color = options.color
  }

  if (options.fields) {
    embed.fields = options.fields
  }

  if (options.timestamp) {
    embed.timestamp = new Date().toISOString()
  }

  return embed
}

export interface ActionButton {
  label: string
  value: string
  style: 'primary' | 'secondary' | 'success' | 'danger' | 'link'
}

export interface ActionRowOptions {
  actions: ActionButton[]
  requestId: string
}

export interface DiscordButton {
  type: 2
  label: string
  style: number
  custom_id?: string
  url?: string
}

export interface DiscordActionRow {
  type: 1
  components: DiscordButton[]
}

const BUTTON_STYLES: Record<string, number> = {
  primary: 1,
  secondary: 2,
  success: 3,
  danger: 4,
  link: 5,
}

export function buildActionRow(options: ActionRowOptions): DiscordActionRow {
  const components: DiscordButton[] = options.actions.map(action => {
    const button: DiscordButton = {
      type: 2,
      label: action.label,
      style: BUTTON_STYLES[action.style] || 2,
    }

    if (action.style === 'link') {
      button.url = action.value
    } else {
      button.custom_id = `${action.value}_${options.requestId}`
    }

    return button
  })

  return {
    type: 1,
    components,
  }
}

export interface DiscordChannelConfig {
  webhookUrl: string
  botToken?: string
}

export interface SendPayload {
  message: string
  mentions?: string[]
  embeds?: DiscordEmbed[]
  components?: DiscordActionRow[]
}

export interface SendResult {
  delivered: boolean
  messageId: string
}

export interface DiscordReaction {
  emoji: { name: string }
  user_id: string
  message_id: string
}

export interface ReactionResponse {
  action: string
  userId: string
}

const EMOJI_ACTION_MAP: Record<string, string> = {
  '\u2705': 'approve', // check mark
  '\u274C': 'reject',  // cross mark
  '\uD83D\uDC4D': 'approve', // thumbs up
  '\uD83D\uDC4E': 'reject',  // thumbs down
}

export class DiscordChannel {
  private config: DiscordChannelConfig

  constructor(config: DiscordChannelConfig) {
    this.config = config
  }

  async send(payload: SendPayload): Promise<SendResult> {
    let content = payload.message

    if (payload.mentions && payload.mentions.length > 0) {
      content = `${payload.mentions.join(' ')} ${content}`
    }

    const body: Record<string, unknown> = {
      content,
    }

    if (payload.embeds) {
      body.embeds = payload.embeds
    }

    if (payload.components) {
      body.components = payload.components
    }

    const response = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await response.json() as { id: string }

    return {
      delivered: true,
      messageId: data.id,
    }
  }

  async handleReaction(reaction: DiscordReaction): Promise<ReactionResponse> {
    const action = EMOJI_ACTION_MAP[reaction.emoji.name] || 'unknown'

    return {
      action,
      userId: reaction.user_id,
    }
  }
}
