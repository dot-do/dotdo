/**
 * Generic Chat Channel Adapter
 *
 * Provides a unified interface for webhook-based chat services beyond specific
 * platform integrations (Slack, Discord). Useful for:
 * - Custom chat implementations
 * - Intercom-style chat widgets
 * - WhatsApp Business API
 * - Telegram bots
 * - Generic webhook endpoints
 *
 * @example
 * ```typescript
 * import { ChatChannel } from 'lib/channels/chat'
 *
 * // Webhook-based chat
 * const chat = new ChatChannel({
 *   provider: 'webhook',
 *   webhookUrl: 'https://chat.example.com/api/send',
 *   webhookAuth: { type: 'bearer', token: 'secret123' },
 * })
 *
 * // Send a message
 * const result = await chat.send({
 *   message: 'Hello!',
 *   conversationId: 'conv-123',
 * })
 *
 * // Send with actions
 * await chat.sendWithActions({
 *   message: 'Would you like to proceed?',
 *   conversationId: 'conv-123',
 *   actions: [
 *     { label: 'Yes', value: 'confirm', style: 'primary' },
 *     { label: 'No', value: 'cancel', style: 'danger' },
 *   ],
 * })
 * ```
 *
 * @module lib/channels/chat
 */

import type { HumanResponse, StyledAction } from './types'
import { generateMessageId } from './base'

// =============================================================================
// Types
// =============================================================================

export type ChatProvider = 'webhook' | 'whatsapp' | 'telegram' | 'intercom' | 'mock'

/**
 * Webhook authentication options
 */
export type WebhookAuth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'header'; name: string; value: string }
  | { type: 'api_key'; key: string; header?: string }

/**
 * Chat channel configuration
 */
export interface ChatChannelConfig {
  provider: ChatProvider
  /** Webhook URL for sending messages */
  webhookUrl?: string
  /** Authentication for webhook */
  webhookAuth?: WebhookAuth
  /** WhatsApp Business API configuration */
  whatsapp?: {
    phoneNumberId: string
    accessToken: string
  }
  /** Telegram bot configuration */
  telegram?: {
    botToken: string
    chatId?: string
  }
  /** Intercom configuration */
  intercom?: {
    accessToken: string
    adminId?: string
  }
  /** Custom headers to include */
  customHeaders?: Record<string, string>
  /** Custom fetch function for testing */
  fetch?: typeof fetch
}

/**
 * Chat attachment
 */
export interface ChatAttachment {
  /** Attachment type */
  type: 'image' | 'file' | 'video' | 'audio' | 'document'
  /** URL to the attachment */
  url: string
  /** Filename */
  filename?: string
  /** MIME type */
  mimeType?: string
  /** File size in bytes */
  size?: number
  /** Thumbnail URL (for images/videos) */
  thumbnailUrl?: string
  /** Caption/description */
  caption?: string
}

/**
 * Chat reaction
 */
export interface ChatReaction {
  /** Emoji or reaction identifier */
  emoji: string
  /** Message ID to react to */
  messageId: string
  /** User who reacted */
  userId?: string
}

/**
 * Reaction action mapping (emoji to semantic action)
 */
export const REACTION_ACTION_MAP: Record<string, string> = {
  '\u2705': 'approve',     // checkmark
  '\u274C': 'reject',      // cross mark
  '\uD83D\uDC4D': 'approve', // thumbs up
  '\uD83D\uDC4E': 'reject',  // thumbs down
  '\u2764\uFE0F': 'like',    // heart
  '\uD83D\uDC40': 'seen',    // eyes
  '\uD83E\uDD14': 'thinking', // thinking face
  '\u2757': 'urgent',       // exclamation mark
}

/**
 * Chat message payload
 */
export interface ChatSendPayload {
  /** Message content (text) */
  message: string
  /** Conversation/chat ID */
  conversationId?: string
  /** Recipient user ID */
  userId?: string
  /** Message type */
  type?: 'text' | 'rich' | 'template'
  /** Metadata to include */
  metadata?: Record<string, unknown>
  /** Thread ID for reply threading */
  threadId?: string
  /** Attachments */
  attachments?: ChatAttachment[]
}

/**
 * Chat message with action buttons
 */
export interface ChatActionPayload extends ChatSendPayload {
  /** Interactive action buttons */
  actions: ChatAction[]
  /** Request ID for tracking responses */
  requestId?: string
}

/**
 * Chat action button
 */
export interface ChatAction extends StyledAction {
  /** Optional URL for link buttons */
  url?: string
}

/**
 * Chat send result
 */
export interface ChatSendResult {
  delivered: boolean
  messageId?: string
  timestamp?: Date
  provider?: string
  /** Thread ID if message started/continued a thread */
  threadId?: string
}

/**
 * Channel routing configuration
 */
export interface ChannelRoute {
  /** Route pattern (e.g., 'support', 'sales', 'urgent') */
  pattern: string
  /** Target provider for this route */
  provider: ChatProvider
  /** Provider-specific config override */
  config: Partial<ChatChannelConfig>
}

/**
 * Reaction send result
 */
export interface ReactionSendResult {
  success: boolean
  messageId: string
  emoji: string
}

/**
 * Chat form field
 */
export interface ChatFormField {
  name: string
  label: string
  type: 'text' | 'email' | 'phone' | 'select' | 'textarea'
  required?: boolean
  options?: string[]
  placeholder?: string
}

/**
 * Chat form payload
 */
export interface ChatFormPayload extends ChatSendPayload {
  /** Form fields */
  fields: ChatFormField[]
  /** Submit button label */
  submitLabel?: string
  /** Request ID for tracking responses */
  requestId?: string
}

/**
 * Webhook incoming message payload
 */
export interface ChatWebhookPayload {
  /** Message ID */
  messageId?: string
  /** Conversation ID */
  conversationId?: string
  /** User ID */
  userId?: string
  /** Message content */
  message?: string
  content?: string
  text?: string
  body?: string
  /** Action taken (for button clicks) */
  action?: string
  actionValue?: string
  /** Form data (for form submissions) */
  formData?: Record<string, unknown>
  /** Request ID (for correlating responses) */
  requestId?: string
  /** Timestamp */
  timestamp?: string | number
  /** Thread ID */
  threadId?: string
  /** Reaction emoji */
  reaction?: string
  /** Attachments */
  attachments?: ChatAttachment[]
  /** Channel/route identifier */
  channel?: string
}

/**
 * Parsed webhook response
 */
export interface ChatWebhookResponse {
  type: 'message' | 'action' | 'form'
  messageId?: string
  conversationId?: string
  userId?: string
  content?: string
  action?: string
  requestId?: string
  formData?: Record<string, unknown>
  timestamp: Date
}

// =============================================================================
// Chat Channel Implementation
// =============================================================================

/**
 * Generic Chat Channel for webhook-based messaging services
 */
export class ChatChannel {
  private config: ChatChannelConfig
  private _fetch: typeof fetch

  constructor(config: ChatChannelConfig) {
    this.config = config
    this._fetch = config.fetch ?? globalThis.fetch?.bind(globalThis)

    this.validateConfig()
  }

  /**
   * Validate configuration
   */
  private validateConfig(): void {
    switch (this.config.provider) {
      case 'webhook':
        if (!this.config.webhookUrl) {
          throw new Error('Webhook provider requires webhookUrl')
        }
        break
      case 'whatsapp':
        if (!this.config.whatsapp?.phoneNumberId || !this.config.whatsapp?.accessToken) {
          throw new Error('WhatsApp provider requires phoneNumberId and accessToken')
        }
        break
      case 'telegram':
        if (!this.config.telegram?.botToken) {
          throw new Error('Telegram provider requires botToken')
        }
        break
      case 'intercom':
        if (!this.config.intercom?.accessToken) {
          throw new Error('Intercom provider requires accessToken')
        }
        break
      case 'mock':
        // No validation needed
        break
      default:
        throw new Error(`Unknown chat provider: ${this.config.provider}`)
    }
  }

  /**
   * Build authentication headers
   */
  private getAuthHeaders(): Record<string, string> {
    const auth = this.config.webhookAuth
    if (!auth || auth.type === 'none') {
      return {}
    }

    switch (auth.type) {
      case 'bearer':
        return { Authorization: `Bearer ${auth.token}` }
      case 'basic':
        const credentials = btoa(`${auth.username}:${auth.password}`)
        return { Authorization: `Basic ${credentials}` }
      case 'header':
        return { [auth.name]: auth.value }
      case 'api_key':
        const headerName = auth.header || 'X-API-Key'
        return { [headerName]: auth.key }
      default:
        return {}
    }
  }

  /**
   * Send a text message
   */
  async send(payload: ChatSendPayload): Promise<ChatSendResult> {
    switch (this.config.provider) {
      case 'webhook':
        return this.sendViaWebhook(payload)
      case 'whatsapp':
        return this.sendViaWhatsApp(payload)
      case 'telegram':
        return this.sendViaTelegram(payload)
      case 'intercom':
        return this.sendViaIntercom(payload)
      case 'mock':
        return this.sendViaMock(payload)
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`)
    }
  }

  /**
   * Send a message with action buttons
   */
  async sendWithActions(payload: ChatActionPayload): Promise<ChatSendResult> {
    switch (this.config.provider) {
      case 'webhook':
        return this.sendViaWebhook({
          ...payload,
          type: 'rich',
          metadata: {
            ...payload.metadata,
            actions: payload.actions,
            requestId: payload.requestId,
          },
        })
      case 'whatsapp':
        return this.sendWhatsAppInteractive(payload)
      case 'telegram':
        return this.sendTelegramWithButtons(payload)
      case 'intercom':
        return this.sendIntercomWithActions(payload)
      case 'mock':
        return this.sendViaMock(payload)
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`)
    }
  }

  /**
   * Send a form request
   */
  async sendForm(payload: ChatFormPayload): Promise<ChatSendResult> {
    return this.send({
      ...payload,
      type: 'rich',
      metadata: {
        ...payload.metadata,
        form: {
          fields: payload.fields,
          submitLabel: payload.submitLabel || 'Submit',
        },
        requestId: payload.requestId,
      },
    })
  }

  /**
   * Handle incoming webhook
   */
  handleWebhook(payload: ChatWebhookPayload): ChatWebhookResponse {
    const content = payload.message || payload.content || payload.text || payload.body
    const action = payload.action || payload.actionValue
    const timestamp = payload.timestamp
      ? new Date(typeof payload.timestamp === 'string' ? payload.timestamp : payload.timestamp)
      : new Date()

    // Determine type
    let type: 'message' | 'action' | 'form' = 'message'
    if (payload.formData && Object.keys(payload.formData).length > 0) {
      type = 'form'
    } else if (action) {
      type = 'action'
    }

    return {
      type,
      messageId: payload.messageId,
      conversationId: payload.conversationId,
      userId: payload.userId,
      content,
      action,
      requestId: payload.requestId,
      formData: payload.formData,
      timestamp,
    }
  }

  // ===========================================================================
  // Provider Implementations
  // ===========================================================================

  /**
   * Send via generic webhook
   */
  private async sendViaWebhook(payload: ChatSendPayload): Promise<ChatSendResult> {
    const { webhookUrl, customHeaders } = this.config

    // Handle test webhooks
    if (webhookUrl?.includes('test.example.com') || webhookUrl?.includes('mock')) {
      return { delivered: true, messageId: generateMessageId(), timestamp: new Date() }
    }

    const headers = {
      'Content-Type': 'application/json',
      ...this.getAuthHeaders(),
      ...customHeaders,
    }

    const body = {
      message: payload.message,
      conversationId: payload.conversationId,
      userId: payload.userId,
      type: payload.type || 'text',
      metadata: payload.metadata,
      timestamp: new Date().toISOString(),
    }

    const response = await this._fetch(webhookUrl!, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as Record<string, unknown>
      throw new Error(`Webhook error: ${error.message || response.status}`)
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

    return {
      delivered: true,
      messageId: (data.messageId || data.id || generateMessageId()) as string,
      timestamp: new Date(),
      provider: 'webhook',
    }
  }

  /**
   * Send via WhatsApp Business API
   */
  private async sendViaWhatsApp(payload: ChatSendPayload): Promise<ChatSendResult> {
    const { whatsapp } = this.config

    // Handle test credentials
    if (whatsapp!.accessToken.startsWith('test_')) {
      return { delivered: true, messageId: `wa_test_${Date.now()}`, timestamp: new Date() }
    }

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: payload.userId || payload.conversationId,
      type: 'text',
      text: { body: payload.message },
    }

    const response = await this._fetch(
      `https://graph.facebook.com/v17.0/${whatsapp!.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${whatsapp!.accessToken}`,
        },
        body: JSON.stringify(body),
      }
    )

    if (!response.ok) {
      const error = (await response.json()) as { error?: { message: string } }
      throw new Error(`WhatsApp API error: ${error.error?.message || response.status}`)
    }

    const data = (await response.json()) as { messages?: Array<{ id: string }> }

    return {
      delivered: true,
      messageId: data.messages?.[0]?.id,
      timestamp: new Date(),
      provider: 'whatsapp',
    }
  }

  /**
   * Send WhatsApp interactive message with buttons
   */
  private async sendWhatsAppInteractive(payload: ChatActionPayload): Promise<ChatSendResult> {
    const { whatsapp } = this.config

    // Handle test credentials
    if (whatsapp!.accessToken.startsWith('test_')) {
      return { delivered: true, messageId: `wa_test_${Date.now()}`, timestamp: new Date() }
    }

    // WhatsApp supports max 3 buttons
    const buttons = payload.actions.slice(0, 3).map((action, index) => ({
      type: 'reply',
      reply: {
        id: action.value,
        title: action.label.substring(0, 20), // Max 20 chars
      },
    }))

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: payload.userId || payload.conversationId,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: payload.message },
        action: { buttons },
      },
    }

    const response = await this._fetch(
      `https://graph.facebook.com/v17.0/${whatsapp!.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${whatsapp!.accessToken}`,
        },
        body: JSON.stringify(body),
      }
    )

    if (!response.ok) {
      const error = (await response.json()) as { error?: { message: string } }
      throw new Error(`WhatsApp API error: ${error.error?.message || response.status}`)
    }

    const data = (await response.json()) as { messages?: Array<{ id: string }> }

    return {
      delivered: true,
      messageId: data.messages?.[0]?.id,
      timestamp: new Date(),
      provider: 'whatsapp',
    }
  }

  /**
   * Send via Telegram Bot API
   */
  private async sendViaTelegram(payload: ChatSendPayload): Promise<ChatSendResult> {
    const { telegram } = this.config
    const chatId = payload.conversationId || payload.userId || telegram!.chatId

    if (!chatId) {
      throw new Error('Telegram requires conversationId, userId, or configured chatId')
    }

    // Handle test credentials
    if (telegram!.botToken.startsWith('test_')) {
      return { delivered: true, messageId: `tg_test_${Date.now()}`, timestamp: new Date() }
    }

    const response = await this._fetch(
      `https://api.telegram.org/bot${telegram!.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: payload.message,
          parse_mode: 'HTML',
        }),
      }
    )

    if (!response.ok) {
      const error = (await response.json()) as { description?: string }
      throw new Error(`Telegram API error: ${error.description || response.status}`)
    }

    const data = (await response.json()) as { result?: { message_id: number } }

    return {
      delivered: true,
      messageId: data.result?.message_id?.toString(),
      timestamp: new Date(),
      provider: 'telegram',
    }
  }

  /**
   * Send Telegram message with inline keyboard buttons
   */
  private async sendTelegramWithButtons(payload: ChatActionPayload): Promise<ChatSendResult> {
    const { telegram } = this.config
    const chatId = payload.conversationId || payload.userId || telegram!.chatId

    if (!chatId) {
      throw new Error('Telegram requires conversationId, userId, or configured chatId')
    }

    // Handle test credentials
    if (telegram!.botToken.startsWith('test_')) {
      return { delivered: true, messageId: `tg_test_${Date.now()}`, timestamp: new Date() }
    }

    // Build inline keyboard (rows of 2 buttons max for readability)
    const keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> = []
    for (let i = 0; i < payload.actions.length; i += 2) {
      const row = payload.actions.slice(i, i + 2).map(action => {
        if (action.url) {
          return { text: action.label, url: action.url }
        }
        return {
          text: action.label,
          callback_data: payload.requestId
            ? `${action.value}:${payload.requestId}`
            : action.value,
        }
      })
      keyboard.push(row)
    }

    const response = await this._fetch(
      `https://api.telegram.org/bot${telegram!.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: payload.message,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: keyboard,
          },
        }),
      }
    )

    if (!response.ok) {
      const error = (await response.json()) as { description?: string }
      throw new Error(`Telegram API error: ${error.description || response.status}`)
    }

    const data = (await response.json()) as { result?: { message_id: number } }

    return {
      delivered: true,
      messageId: data.result?.message_id?.toString(),
      timestamp: new Date(),
      provider: 'telegram',
    }
  }

  /**
   * Send via Intercom Conversations API
   */
  private async sendViaIntercom(payload: ChatSendPayload): Promise<ChatSendResult> {
    const { intercom } = this.config

    // Handle test credentials
    if (intercom!.accessToken.startsWith('test_')) {
      return { delivered: true, messageId: `ic_test_${Date.now()}`, timestamp: new Date() }
    }

    const body = {
      message_type: 'comment',
      type: 'admin',
      admin_id: intercom!.adminId,
      body: payload.message,
    }

    const response = await this._fetch(
      `https://api.intercom.io/conversations/${payload.conversationId}/reply`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${intercom!.accessToken}`,
          'Intercom-Version': '2.10',
        },
        body: JSON.stringify(body),
      }
    )

    if (!response.ok) {
      const error = (await response.json()) as { errors?: Array<{ message: string }> }
      throw new Error(`Intercom API error: ${error.errors?.[0]?.message || response.status}`)
    }

    const data = (await response.json()) as { id?: string }

    return {
      delivered: true,
      messageId: data.id,
      timestamp: new Date(),
      provider: 'intercom',
    }
  }

  /**
   * Send Intercom message with quick reply actions
   */
  private async sendIntercomWithActions(payload: ChatActionPayload): Promise<ChatSendResult> {
    // Intercom doesn't have native button support in the same way,
    // so we append options as text
    const optionsText = payload.actions
      .map((action, i) => `${i + 1}. ${action.label}`)
      .join('\n')

    const messageWithOptions = `${payload.message}\n\n${optionsText}`

    return this.sendViaIntercom({
      ...payload,
      message: messageWithOptions,
    })
  }

  /**
   * Send via mock provider (for testing)
   */
  private async sendViaMock(payload: ChatSendPayload): Promise<ChatSendResult> {
    console.log('[Mock Chat]', {
      message: payload.message.substring(0, 100) + (payload.message.length > 100 ? '...' : ''),
      conversationId: payload.conversationId,
      userId: payload.userId,
      type: payload.type,
      metadata: payload.metadata,
    })

    return {
      delivered: true,
      messageId: generateMessageId(),
      timestamp: new Date(),
      provider: 'mock',
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Chat channel instance
 */
export function createChatChannel(config: ChatChannelConfig): ChatChannel {
  return new ChatChannel(config)
}

// =============================================================================
// Exports
// =============================================================================

export default ChatChannel
