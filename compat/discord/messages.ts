/**
 * @dotdo/discord - Messages
 *
 * Message sending and manipulation helpers for Discord
 *
 * @example
 * ```typescript
 * import { MessagePayload, MessageFlags } from '@dotdo/discord/messages'
 *
 * // Create a message payload
 * const payload = new MessagePayload()
 *   .setContent('Hello, World!')
 *   .setEmbeds([embed])
 *   .setComponents([row])
 *   .setFlags(MessageFlags.Ephemeral)
 *
 * // Send via REST
 * await rest.post(Routes.channelMessages(channelId), {
 *   body: payload.toJSON()
 * })
 * ```
 */

import type { Embed, Component } from './types'
import { MessageFlags } from './types'

// Re-export MessageFlags for convenience
export { MessageFlags }

// ============================================================================
// TYPES
// ============================================================================

/**
 * Message create/edit payload options
 */
export interface MessagePayloadOptions {
  content?: string
  embeds?: Embed[]
  components?: Component[]
  flags?: number
  tts?: boolean
  allowed_mentions?: AllowedMentions
  message_reference?: MessageReference
  sticker_ids?: string[]
  attachments?: AttachmentPayload[]
}

/**
 * Allowed mentions configuration
 */
export interface AllowedMentions {
  parse?: ('roles' | 'users' | 'everyone')[]
  roles?: string[]
  users?: string[]
  replied_user?: boolean
}

/**
 * Message reference for replies
 */
export interface MessageReference {
  message_id?: string
  channel_id?: string
  guild_id?: string
  fail_if_not_exists?: boolean
}

/**
 * Attachment payload for message creation
 */
export interface AttachmentPayload {
  id: string | number
  filename?: string
  description?: string
}

/**
 * Message edit options
 */
export interface MessageEditOptions {
  content?: string | null
  embeds?: Embed[] | null
  components?: Component[] | null
  flags?: number | null
  allowed_mentions?: AllowedMentions | null
  attachments?: AttachmentPayload[] | null
}

// ============================================================================
// MESSAGE PAYLOAD BUILDER
// ============================================================================

/**
 * Builder for message payloads
 *
 * @example
 * ```typescript
 * const payload = new MessagePayload()
 *   .setContent('Hello!')
 *   .setEmbeds([new EmbedBuilder().setTitle('Title').toJSON()])
 *   .setTTS(false)
 *   .setAllowedMentions({ parse: ['users'] })
 *
 * await rest.post(Routes.channelMessages(channelId), {
 *   body: payload.toJSON()
 * })
 * ```
 */
export class MessagePayload {
  private data: MessagePayloadOptions = {}

  /**
   * Set the message content
   */
  setContent(content: string): this {
    this.data.content = content
    return this
  }

  /**
   * Set the message embeds
   */
  setEmbeds(embeds: Embed[]): this {
    this.data.embeds = embeds
    return this
  }

  /**
   * Add embeds to the message
   */
  addEmbeds(...embeds: Embed[]): this {
    if (!this.data.embeds) {
      this.data.embeds = []
    }
    this.data.embeds.push(...embeds)
    return this
  }

  /**
   * Set the message components
   */
  setComponents(components: Component[]): this {
    this.data.components = components
    return this
  }

  /**
   * Add components to the message
   */
  addComponents(...components: Component[]): this {
    if (!this.data.components) {
      this.data.components = []
    }
    this.data.components.push(...components)
    return this
  }

  /**
   * Set message flags
   */
  setFlags(flags: number): this {
    this.data.flags = flags
    return this
  }

  /**
   * Set whether the message is TTS
   */
  setTTS(tts: boolean): this {
    this.data.tts = tts
    return this
  }

  /**
   * Set allowed mentions
   */
  setAllowedMentions(allowedMentions: AllowedMentions): this {
    this.data.allowed_mentions = allowedMentions
    return this
  }

  /**
   * Set message reference (for replies)
   */
  setReference(reference: MessageReference): this {
    this.data.message_reference = reference
    return this
  }

  /**
   * Reply to a specific message
   */
  replyTo(messageId: string, failIfNotExists = true): this {
    this.data.message_reference = {
      message_id: messageId,
      fail_if_not_exists: failIfNotExists,
    }
    return this
  }

  /**
   * Set sticker IDs
   */
  setStickerIds(stickerIds: string[]): this {
    this.data.sticker_ids = stickerIds
    return this
  }

  /**
   * Set attachments
   */
  setAttachments(attachments: AttachmentPayload[]): this {
    this.data.attachments = attachments
    return this
  }

  /**
   * Make the message ephemeral (only visible to the user)
   */
  setEphemeral(ephemeral = true): this {
    if (ephemeral) {
      this.data.flags = (this.data.flags ?? 0) | MessageFlags.Ephemeral
    } else {
      this.data.flags = (this.data.flags ?? 0) & ~MessageFlags.Ephemeral
    }
    return this
  }

  /**
   * Suppress embeds in the message
   */
  setSuppressEmbeds(suppress = true): this {
    if (suppress) {
      this.data.flags = (this.data.flags ?? 0) | MessageFlags.SuppressEmbeds
    } else {
      this.data.flags = (this.data.flags ?? 0) & ~MessageFlags.SuppressEmbeds
    }
    return this
  }

  /**
   * Convert to JSON for API request
   */
  toJSON(): MessagePayloadOptions {
    return { ...this.data }
  }
}

// ============================================================================
// MESSAGE EDIT PAYLOAD BUILDER
// ============================================================================

/**
 * Builder for message edit payloads
 *
 * @example
 * ```typescript
 * const editPayload = new MessageEditPayload()
 *   .setContent('Updated content')
 *   .clearEmbeds()
 *
 * await rest.patch(Routes.channelMessage(channelId, messageId), {
 *   body: editPayload.toJSON()
 * })
 * ```
 */
export class MessageEditPayload {
  private data: MessageEditOptions = {}

  /**
   * Set the message content (null to remove)
   */
  setContent(content: string | null): this {
    this.data.content = content
    return this
  }

  /**
   * Clear the message content
   */
  clearContent(): this {
    this.data.content = null
    return this
  }

  /**
   * Set the message embeds (null to remove all)
   */
  setEmbeds(embeds: Embed[] | null): this {
    this.data.embeds = embeds
    return this
  }

  /**
   * Clear all embeds
   */
  clearEmbeds(): this {
    this.data.embeds = null
    return this
  }

  /**
   * Set the message components (null to remove all)
   */
  setComponents(components: Component[] | null): this {
    this.data.components = components
    return this
  }

  /**
   * Clear all components
   */
  clearComponents(): this {
    this.data.components = null
    return this
  }

  /**
   * Set message flags
   */
  setFlags(flags: number | null): this {
    this.data.flags = flags
    return this
  }

  /**
   * Set allowed mentions
   */
  setAllowedMentions(allowedMentions: AllowedMentions | null): this {
    this.data.allowed_mentions = allowedMentions
    return this
  }

  /**
   * Set attachments (null to remove all)
   */
  setAttachments(attachments: AttachmentPayload[] | null): this {
    this.data.attachments = attachments
    return this
  }

  /**
   * Convert to JSON for API request
   */
  toJSON(): MessageEditOptions {
    return { ...this.data }
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a simple text message payload
 */
export function createTextMessage(content: string): MessagePayloadOptions {
  return { content }
}

/**
 * Create a message payload with embeds
 */
export function createEmbedMessage(embeds: Embed[], content?: string): MessagePayloadOptions {
  return {
    content,
    embeds,
  }
}

/**
 * Create a reply message payload
 */
export function createReply(
  messageId: string,
  content: string,
  options?: Partial<MessagePayloadOptions>
): MessagePayloadOptions {
  return {
    content,
    message_reference: {
      message_id: messageId,
    },
    ...options,
  }
}

/**
 * Create an ephemeral message payload (only visible to the user)
 */
export function createEphemeralMessage(
  content: string,
  options?: Partial<MessagePayloadOptions>
): MessagePayloadOptions {
  return {
    content,
    flags: MessageFlags.Ephemeral,
    ...options,
  }
}
