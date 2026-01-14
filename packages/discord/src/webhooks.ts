/**
 * @dotdo/discord - Webhooks
 *
 * Discord webhook execution and management
 *
 * @example
 * ```typescript
 * import { WebhookClient, WebhookPayload } from '@dotdo/discord/webhooks'
 *
 * // Create a webhook client
 * const webhook = new WebhookClient({
 *   id: 'webhook-id',
 *   token: 'webhook-token'
 * })
 *
 * // Send a message
 * await webhook.send({
 *   content: 'Hello from webhook!',
 *   embeds: [embed.toJSON()],
 *   username: 'Custom Bot Name',
 *   avatar_url: 'https://example.com/avatar.png'
 * })
 *
 * // Edit a message
 * await webhook.editMessage('message-id', { content: 'Updated!' })
 *
 * // Delete a message
 * await webhook.deleteMessage('message-id')
 * ```
 *
 * @module @dotdo/discord/webhooks
 */

import type { Embed, Component, Message, Webhook } from './types'
import { REST, Routes } from './rest'

// Re-export Routes for convenience
export { Routes }

// ============================================================================
// TYPES
// ============================================================================

/**
 * Webhook client options
 */
export interface WebhookClientOptions {
  /** Webhook ID */
  id: string
  /** Webhook token */
  token: string
  /** Optional REST options */
  rest?: {
    version?: string
    api?: string
    timeout?: number
  }
}

/**
 * Webhook message payload
 */
export interface WebhookPayload {
  content?: string
  username?: string
  avatar_url?: string
  tts?: boolean
  embeds?: Embed[]
  components?: Component[]
  allowed_mentions?: {
    parse?: ('roles' | 'users' | 'everyone')[]
    roles?: string[]
    users?: string[]
    replied_user?: boolean
  }
  flags?: number
  thread_name?: string
  thread_id?: string
}

/**
 * Webhook message edit payload
 */
export interface WebhookEditPayload {
  content?: string | null
  embeds?: Embed[] | null
  components?: Component[] | null
  allowed_mentions?: WebhookPayload['allowed_mentions'] | null
}

// ============================================================================
// WEBHOOK CLIENT
// ============================================================================

/**
 * Client for sending messages via Discord webhooks
 *
 * @example
 * ```typescript
 * const webhook = new WebhookClient({
 *   id: '1234567890',
 *   token: 'webhook-token'
 * })
 *
 * // Simple message
 * await webhook.send({ content: 'Hello!' })
 *
 * // Rich message
 * await webhook.send({
 *   content: 'Check this out!',
 *   embeds: [embed.toJSON()],
 *   components: [row.toJSON()],
 *   username: 'Notification Bot',
 *   avatar_url: 'https://example.com/bot.png'
 * })
 * ```
 */
export class WebhookClient {
  private id: string
  private token: string
  private rest: REST

  constructor(options: WebhookClientOptions) {
    this.id = options.id
    this.token = options.token
    this.rest = new REST(options.rest)
    // Don't set token on REST - webhook routes use the token in the URL
  }

  /**
   * Get the webhook URL
   */
  get url(): string {
    return `https://discord.com/api/webhooks/${this.id}/${this.token}`
  }

  /**
   * Send a message via the webhook
   *
   * @param payload The message payload
   * @param options Additional options
   * @returns The sent message if wait is true, otherwise void
   */
  async send(
    payload: WebhookPayload | string,
    options?: { wait?: boolean; threadId?: string }
  ): Promise<Message | void> {
    const body = typeof payload === 'string' ? { content: payload } : payload

    let route = Routes.webhookWithToken(this.id, this.token)

    const query: Record<string, string> = {}
    if (options?.wait) {
      query.wait = 'true'
    }
    if (options?.threadId) {
      query.thread_id = options.threadId
    }

    const result = await this.rest.post<Message | void>(route, {
      body,
      query,
    })

    return options?.wait ? (result as Message) : undefined
  }

  /**
   * Send a message and wait for the result
   */
  async sendAndWait(payload: WebhookPayload | string, threadId?: string): Promise<Message> {
    return (await this.send(payload, { wait: true, threadId })) as Message
  }

  /**
   * Edit a message sent by this webhook
   */
  async editMessage(messageId: string, payload: WebhookEditPayload | string): Promise<Message> {
    const body = typeof payload === 'string' ? { content: payload } : payload
    return this.rest.patch<Message>(Routes.webhookMessage(this.id, this.token, messageId), {
      body,
    })
  }

  /**
   * Delete a message sent by this webhook
   */
  async deleteMessage(messageId: string): Promise<void> {
    await this.rest.delete(Routes.webhookMessage(this.id, this.token, messageId))
  }

  /**
   * Get the webhook info
   */
  async fetchWebhook(): Promise<Webhook> {
    return this.rest.get<Webhook>(Routes.webhookWithToken(this.id, this.token))
  }

  /**
   * Modify the webhook (name, avatar, etc.)
   */
  async edit(data: { name?: string; avatar?: string | null }): Promise<Webhook> {
    return this.rest.patch<Webhook>(Routes.webhookWithToken(this.id, this.token), {
      body: data,
    })
  }

  /**
   * Delete the webhook
   */
  async delete(): Promise<void> {
    await this.rest.delete(Routes.webhookWithToken(this.id, this.token))
  }
}

// ============================================================================
// WEBHOOK PAYLOAD BUILDER
// ============================================================================

/**
 * Builder for webhook message payloads
 *
 * @example
 * ```typescript
 * const payload = new WebhookPayloadBuilder()
 *   .setContent('Alert!')
 *   .setUsername('Alert Bot')
 *   .setAvatarURL('https://example.com/alert.png')
 *   .addEmbeds(embed.toJSON())
 *   .toJSON()
 *
 * await webhook.send(payload)
 * ```
 */
export class WebhookPayloadBuilder {
  private data: WebhookPayload = {}

  /**
   * Set the message content
   */
  setContent(content: string): this {
    this.data.content = content
    return this
  }

  /**
   * Set the webhook username override
   */
  setUsername(username: string): this {
    this.data.username = username
    return this
  }

  /**
   * Set the webhook avatar URL override
   */
  setAvatarURL(avatarUrl: string): this {
    this.data.avatar_url = avatarUrl
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
   * Set allowed mentions
   */
  setAllowedMentions(allowedMentions: WebhookPayload['allowed_mentions']): this {
    this.data.allowed_mentions = allowedMentions
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
   * Suppress embeds in the message
   */
  setSuppressEmbeds(suppress = true): this {
    if (suppress) {
      this.data.flags = (this.data.flags ?? 0) | (1 << 2)
    } else {
      this.data.flags = (this.data.flags ?? 0) & ~(1 << 2)
    }
    return this
  }

  /**
   * Set thread name (for forum channels)
   */
  setThreadName(threadName: string): this {
    this.data.thread_name = threadName
    return this
  }

  /**
   * Convert to JSON for API request
   */
  toJSON(): WebhookPayload {
    return { ...this.data }
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse a webhook URL into its components
 *
 * @example
 * ```typescript
 * const { id, token } = parseWebhookUrl('https://discord.com/api/webhooks/123/abc')
 * const webhook = new WebhookClient({ id, token })
 * ```
 */
export function parseWebhookUrl(url: string): { id: string; token: string } {
  const match = url.match(/\/webhooks\/(\d+)\/([^/?]+)/)
  if (!match || !match[1] || !match[2]) {
    throw new Error('Invalid webhook URL')
  }
  return { id: match[1], token: match[2] }
}

/**
 * Create a WebhookClient from a webhook URL
 *
 * @example
 * ```typescript
 * const webhook = createWebhookFromUrl(
 *   'https://discord.com/api/webhooks/123456789/webhook-token'
 * )
 * await webhook.send({ content: 'Hello!' })
 * ```
 */
export function createWebhookFromUrl(
  url: string,
  options?: Omit<WebhookClientOptions, 'id' | 'token'>
): WebhookClient {
  const { id, token } = parseWebhookUrl(url)
  return new WebhookClient({ id, token, ...options })
}

/**
 * Send a simple message via webhook URL
 *
 * @example
 * ```typescript
 * await sendWebhookMessage(
 *   'https://discord.com/api/webhooks/123/token',
 *   'Hello, World!'
 * )
 * ```
 */
export async function sendWebhookMessage(
  url: string,
  content: string | WebhookPayload
): Promise<void> {
  const webhook = createWebhookFromUrl(url)
  await webhook.send(content)
}

/**
 * Send an embed via webhook URL
 */
export async function sendWebhookEmbed(
  url: string,
  embeds: Embed[],
  options?: Partial<WebhookPayload>
): Promise<void> {
  const webhook = createWebhookFromUrl(url)
  await webhook.send({
    embeds,
    ...options,
  })
}

// ============================================================================
// WEBHOOK MANAGER (for bot-managed webhooks)
// ============================================================================

/**
 * Manager for creating and managing webhooks via bot token
 *
 * @example
 * ```typescript
 * const manager = new WebhookManager('bot-token')
 *
 * // Create a webhook
 * const webhook = await manager.create('channel-id', { name: 'Notifications' })
 *
 * // Get channel webhooks
 * const webhooks = await manager.getChannelWebhooks('channel-id')
 *
 * // Delete a webhook
 * await manager.delete('webhook-id')
 * ```
 */
export class WebhookManager {
  private rest: REST

  constructor(botToken: string, options?: { version?: string }) {
    this.rest = new REST(options).setToken(botToken)
  }

  /**
   * Create a webhook in a channel
   */
  async create(
    channelId: string,
    data: { name: string; avatar?: string; reason?: string }
  ): Promise<Webhook> {
    const { reason, ...body } = data
    return this.rest.post<Webhook>(Routes.channelWebhooks(channelId), {
      body,
      reason,
    })
  }

  /**
   * Get webhooks in a channel
   */
  async getChannelWebhooks(channelId: string): Promise<Webhook[]> {
    return this.rest.get<Webhook[]>(Routes.channelWebhooks(channelId))
  }

  /**
   * Get a specific webhook by ID (requires bot token)
   */
  async get(webhookId: string): Promise<Webhook> {
    return this.rest.get<Webhook>(Routes.webhook(webhookId))
  }

  /**
   * Modify a webhook by ID (requires bot token)
   */
  async modify(
    webhookId: string,
    data: { name?: string; avatar?: string | null; channel_id?: string; reason?: string }
  ): Promise<Webhook> {
    const { reason, ...body } = data
    return this.rest.patch<Webhook>(Routes.webhook(webhookId), {
      body,
      reason,
    })
  }

  /**
   * Delete a webhook by ID (requires bot token)
   */
  async delete(webhookId: string, reason?: string): Promise<void> {
    await this.rest.delete(Routes.webhook(webhookId), { reason })
  }
}
