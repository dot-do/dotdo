/**
 * @dotdo/slack/messages - Slack Message API
 *
 * Production-ready Slack message operations with full Block Kit support,
 * thread replies, ephemeral messages, and mrkdwn formatting.
 *
 * @example
 * ```typescript
 * import { SlackMessages } from '@dotdo/slack/messages'
 *
 * const messages = new SlackMessages('xoxb-token')
 *
 * // Simple message
 * await messages.post('#general', 'Hello, World!')
 *
 * // Rich message with Block Kit
 * await messages.post('#general', {
 *   text: 'Fallback text',
 *   blocks: [
 *     section({ text: mrkdwn('*Hello* from Block Kit!') }),
 *     divider(),
 *     actions({
 *       elements: [
 *         button({ text: plainText('Click me'), action_id: 'click' }),
 *       ],
 *     }),
 *   ],
 * })
 *
 * // Thread reply
 * const original = await messages.post('#general', 'Start a thread')
 * await messages.reply(original, 'This is a thread reply!')
 *
 * // Ephemeral message (visible to one user)
 * await messages.ephemeral('#general', 'U1234567890', 'Only you can see this')
 *
 * // Update message
 * await messages.update(original, 'Updated content')
 *
 * // Delete message
 * await messages.delete(original)
 * ```
 *
 * @module @dotdo/slack/messages
 */

import type { Block, Attachment } from './blocks'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Message reference for updates and replies
 */
export interface MessageRef {
  channel: string
  ts: string
}

/**
 * Message metadata for tracking
 */
export interface MessageMetadata {
  event_type: string
  event_payload: Record<string, unknown>
}

/**
 * Message content options
 */
export interface MessageContent {
  /** Fallback text (required for accessibility) */
  text?: string
  /** Block Kit blocks */
  blocks?: Block[]
  /** Legacy attachments */
  attachments?: Attachment[]
  /** Message metadata */
  metadata?: MessageMetadata
}

/**
 * Options for posting messages
 */
export interface PostMessageOptions extends MessageContent {
  /** Thread timestamp for replies */
  thread_ts?: string
  /** Also post reply to channel */
  reply_broadcast?: boolean
  /** Unfurl links (default: true) */
  unfurl_links?: boolean
  /** Unfurl media (default: true) */
  unfurl_media?: boolean
  /** Enable mrkdwn formatting (default: true) */
  mrkdwn?: boolean
  /** Parse mode */
  parse?: 'full' | 'none'
  /** Link channel names and usernames */
  link_names?: boolean
  /** Custom username for bot */
  username?: string
  /** Custom icon emoji */
  icon_emoji?: string
  /** Custom icon URL */
  icon_url?: string
}

/**
 * Options for ephemeral messages
 */
export interface EphemeralMessageOptions extends MessageContent {
  /** Thread timestamp */
  thread_ts?: string
  /** Parse mode */
  parse?: 'full' | 'none'
  /** Link names */
  link_names?: boolean
  /** Custom username */
  username?: string
  /** Custom icon emoji */
  icon_emoji?: string
  /** Custom icon URL */
  icon_url?: string
}

/**
 * Options for updating messages
 */
export interface UpdateMessageOptions extends MessageContent {
  /** Parse mode */
  parse?: 'full' | 'none'
  /** Link names */
  link_names?: boolean
  /** Broadcast reply to channel */
  reply_broadcast?: boolean
}

/**
 * Options for scheduled messages
 */
export interface ScheduleMessageOptions extends PostMessageOptions {
  /** Post at timestamp (Unix epoch) */
  post_at: number
}

/**
 * Response from posting a message
 */
export interface PostMessageResponse {
  ok: boolean
  channel: string
  ts: string
  message?: {
    type: string
    subtype?: string
    text?: string
    ts: string
    user?: string
    bot_id?: string
    blocks?: Block[]
    attachments?: Attachment[]
  }
  error?: string
}

/**
 * Response from ephemeral message
 */
export interface EphemeralResponse {
  ok: boolean
  message_ts: string
  error?: string
}

/**
 * Response from updating a message
 */
export interface UpdateResponse {
  ok: boolean
  channel: string
  ts: string
  text?: string
  message?: {
    type: string
    text?: string
    ts: string
    blocks?: Block[]
    attachments?: Attachment[]
  }
  error?: string
}

/**
 * Response from deleting a message
 */
export interface DeleteResponse {
  ok: boolean
  channel: string
  ts: string
  error?: string
}

/**
 * Response from scheduling a message
 */
export interface ScheduleResponse {
  ok: boolean
  channel: string
  scheduled_message_id: string
  post_at: number
  error?: string
}

/**
 * Client configuration options
 */
export interface SlackMessagesOptions {
  /** Base URL for Slack API */
  baseUrl?: string
  /** Request timeout in ms */
  timeout?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Retry configuration */
  retry?: {
    /** Number of retries */
    attempts?: number
    /** Base delay in ms */
    delay?: number
    /** Maximum delay in ms */
    maxDelay?: number
  }
}

// ============================================================================
// ERROR CLASS
// ============================================================================

/**
 * Slack API Error
 */
export class SlackMessageError extends Error {
  /** Error code from Slack API */
  readonly code: string
  /** HTTP status code if applicable */
  readonly status?: number
  /** Additional error data */
  readonly data?: Record<string, unknown>

  constructor(code: string, message?: string, data?: Record<string, unknown>) {
    super(message ?? `Slack API Error: ${code}`)
    this.name = 'SlackMessageError'
    this.code = code
    this.data = data
  }
}

// ============================================================================
// MRKDWN FORMATTING HELPERS
// ============================================================================

/**
 * Format text as bold
 */
export function bold(text: string): string {
  return `*${text}*`
}

/**
 * Format text as italic
 */
export function italic(text: string): string {
  return `_${text}_`
}

/**
 * Format text as strikethrough
 */
export function strike(text: string): string {
  return `~${text}~`
}

/**
 * Format text as inline code
 */
export function code(text: string): string {
  return `\`${text}\``
}

/**
 * Format text as code block
 */
export function codeBlock(text: string, language?: string): string {
  if (language) {
    return `\`\`\`${language}\n${text}\n\`\`\``
  }
  return `\`\`\`\n${text}\n\`\`\``
}

/**
 * Format text as blockquote
 */
export function blockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

/**
 * Create a link
 */
export function link(url: string, text?: string): string {
  if (text) {
    return `<${url}|${text}>`
  }
  return `<${url}>`
}

/**
 * Mention a user
 */
export function mention(userId: string): string {
  return `<@${userId}>`
}

/**
 * Mention a channel
 */
export function channel(channelId: string): string {
  return `<#${channelId}>`
}

/**
 * Mention @here
 */
export function here(): string {
  return '<!here>'
}

/**
 * Mention @channel
 */
export function atChannel(): string {
  return '<!channel>'
}

/**
 * Mention @everyone
 */
export function everyone(): string {
  return '<!everyone>'
}

/**
 * Format a date
 */
export function date(
  timestamp: number | Date,
  format: string = '{date_short}',
  fallback?: string
): string {
  const ts = timestamp instanceof Date ? Math.floor(timestamp.getTime() / 1000) : timestamp
  const fb = fallback ?? new Date(ts * 1000).toISOString()
  return `<!date^${ts}^${format}|${fb}>`
}

/**
 * Create an emoji
 */
export function emoji(name: string): string {
  return `:${name}:`
}

/**
 * Create a numbered list
 */
export function numberedList(items: string[]): string {
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n')
}

/**
 * Create a bulleted list
 */
export function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n')
}

/**
 * Escape special mrkdwn characters
 */
export function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ============================================================================
// MESSAGE BUILDER
// ============================================================================

/**
 * Fluent builder for constructing messages
 */
export class MessageBuilder {
  private _text?: string
  private _blocks: Block[] = []
  private _attachments: Attachment[] = []
  private _metadata?: MessageMetadata
  private _threadTs?: string
  private _replyBroadcast?: boolean
  private _unfurlLinks?: boolean
  private _unfurlMedia?: boolean
  private _mrkdwn?: boolean
  private _username?: string
  private _iconEmoji?: string
  private _iconUrl?: string

  /**
   * Set fallback text
   */
  text(text: string): this {
    this._text = text
    return this
  }

  /**
   * Add a block
   */
  block(block: Block): this {
    this._blocks.push(block)
    return this
  }

  /**
   * Add multiple blocks
   */
  blocks(blocks: Block[]): this {
    this._blocks.push(...blocks)
    return this
  }

  /**
   * Add an attachment
   */
  attachment(attachment: Attachment): this {
    this._attachments.push(attachment)
    return this
  }

  /**
   * Add multiple attachments
   */
  attachments(attachments: Attachment[]): this {
    this._attachments.push(...attachments)
    return this
  }

  /**
   * Set metadata
   */
  metadata(eventType: string, payload: Record<string, unknown>): this {
    this._metadata = { event_type: eventType, event_payload: payload }
    return this
  }

  /**
   * Set thread timestamp for reply
   */
  inThread(threadTs: string): this {
    this._threadTs = threadTs
    return this
  }

  /**
   * Broadcast reply to channel
   */
  broadcast(): this {
    this._replyBroadcast = true
    return this
  }

  /**
   * Disable link unfurling
   */
  noUnfurlLinks(): this {
    this._unfurlLinks = false
    return this
  }

  /**
   * Disable media unfurling
   */
  noUnfurlMedia(): this {
    this._unfurlMedia = false
    return this
  }

  /**
   * Disable mrkdwn formatting
   */
  noMrkdwn(): this {
    this._mrkdwn = false
    return this
  }

  /**
   * Set custom username
   */
  as(username: string): this {
    this._username = username
    return this
  }

  /**
   * Set custom icon emoji
   */
  withEmoji(emoji: string): this {
    this._iconEmoji = emoji.startsWith(':') ? emoji : `:${emoji}:`
    return this
  }

  /**
   * Set custom icon URL
   */
  withIcon(url: string): this {
    this._iconUrl = url
    return this
  }

  /**
   * Build the message options
   */
  build(): PostMessageOptions {
    const options: PostMessageOptions = {}

    if (this._text !== undefined) options.text = this._text
    if (this._blocks.length > 0) options.blocks = this._blocks
    if (this._attachments.length > 0) options.attachments = this._attachments
    if (this._metadata) options.metadata = this._metadata
    if (this._threadTs) options.thread_ts = this._threadTs
    if (this._replyBroadcast) options.reply_broadcast = this._replyBroadcast
    if (this._unfurlLinks !== undefined) options.unfurl_links = this._unfurlLinks
    if (this._unfurlMedia !== undefined) options.unfurl_media = this._unfurlMedia
    if (this._mrkdwn !== undefined) options.mrkdwn = this._mrkdwn
    if (this._username) options.username = this._username
    if (this._iconEmoji) options.icon_emoji = this._iconEmoji
    if (this._iconUrl) options.icon_url = this._iconUrl

    return options
  }
}

/**
 * Create a new message builder
 */
export function message(): MessageBuilder {
  return new MessageBuilder()
}

// ============================================================================
// SLACK MESSAGES CLIENT
// ============================================================================

/**
 * Slack Messages client for posting, updating, and deleting messages
 */
export class SlackMessages {
  private readonly token: string
  private readonly baseUrl: string
  private readonly timeout: number
  private readonly _fetch: typeof fetch
  private readonly retry: { attempts: number; delay: number; maxDelay: number }

  constructor(token: string, options: SlackMessagesOptions = {}) {
    this.token = token
    this.baseUrl = options.baseUrl ?? 'https://slack.com/api'
    this.timeout = options.timeout ?? 30000
    this._fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.retry = {
      attempts: options.retry?.attempts ?? 3,
      delay: options.retry?.delay ?? 1000,
      maxDelay: options.retry?.maxDelay ?? 30000,
    }
  }

  // ==========================================================================
  // CORE METHODS
  // ==========================================================================

  /**
   * Post a message to a channel
   *
   * @param channel - Channel ID or name (e.g., 'C1234567890' or '#general')
   * @param content - Message text or options
   * @returns Message reference for updates/replies
   *
   * @example
   * ```typescript
   * // Simple text
   * await messages.post('#general', 'Hello!')
   *
   * // With blocks
   * await messages.post('#general', {
   *   text: 'Fallback',
   *   blocks: [section({ text: mrkdwn('*Hello!*') })]
   * })
   *
   * // Using builder
   * await messages.post('#general', message()
   *   .text('Hello!')
   *   .as('MyBot')
   *   .withEmoji(':robot_face:')
   *   .build()
   * )
   * ```
   */
  async post(
    channel: string,
    content: string | PostMessageOptions
  ): Promise<MessageRef & PostMessageResponse> {
    const args = typeof content === 'string' ? { text: content } : content

    const response = await this._request<PostMessageResponse>('chat.postMessage', {
      channel: this._normalizeChannel(channel),
      ...args,
    })

    return {
      ...response,
      channel: response.channel,
      ts: response.ts,
    }
  }

  /**
   * Post an ephemeral message (visible only to one user)
   *
   * @param channel - Channel ID or name
   * @param user - User ID to show message to
   * @param content - Message text or options
   *
   * @example
   * ```typescript
   * await messages.ephemeral('#general', 'U1234567890', 'Only you can see this!')
   * ```
   */
  async ephemeral(
    channel: string,
    user: string,
    content: string | EphemeralMessageOptions
  ): Promise<EphemeralResponse> {
    const args = typeof content === 'string' ? { text: content } : content

    return this._request<EphemeralResponse>('chat.postEphemeral', {
      channel: this._normalizeChannel(channel),
      user,
      ...args,
    })
  }

  /**
   * Reply to a message in a thread
   *
   * @param ref - Original message reference
   * @param content - Reply text or options
   * @param broadcast - Also post to channel
   *
   * @example
   * ```typescript
   * const original = await messages.post('#general', 'Starting a thread')
   * await messages.reply(original, 'Thread reply!')
   * await messages.reply(original, 'Broadcast reply!', true)
   * ```
   */
  async reply(
    ref: MessageRef,
    content: string | PostMessageOptions,
    broadcast = false
  ): Promise<MessageRef & PostMessageResponse> {
    const args = typeof content === 'string' ? { text: content } : content

    return this.post(ref.channel, {
      ...args,
      thread_ts: ref.ts,
      reply_broadcast: broadcast || args.reply_broadcast,
    })
  }

  /**
   * Update an existing message
   *
   * @param ref - Message reference
   * @param content - New content
   *
   * @example
   * ```typescript
   * const msg = await messages.post('#general', 'Original')
   * await messages.update(msg, 'Updated!')
   * ```
   */
  async update(
    ref: MessageRef,
    content: string | UpdateMessageOptions
  ): Promise<UpdateResponse> {
    const args = typeof content === 'string' ? { text: content } : content

    return this._request<UpdateResponse>('chat.update', {
      channel: ref.channel,
      ts: ref.ts,
      ...args,
    })
  }

  /**
   * Delete a message
   *
   * @param ref - Message reference
   *
   * @example
   * ```typescript
   * const msg = await messages.post('#general', 'Temporary message')
   * await messages.delete(msg)
   * ```
   */
  async delete(ref: MessageRef): Promise<DeleteResponse> {
    return this._request<DeleteResponse>('chat.delete', {
      channel: ref.channel,
      ts: ref.ts,
    })
  }

  /**
   * Schedule a message for later
   *
   * @param channel - Channel ID or name
   * @param postAt - Unix timestamp or Date
   * @param content - Message content
   *
   * @example
   * ```typescript
   * // Schedule for 1 hour from now
   * const postAt = Math.floor(Date.now() / 1000) + 3600
   * await messages.schedule('#general', postAt, 'Scheduled message!')
   *
   * // Using Date
   * await messages.schedule('#general', new Date('2024-01-01T09:00:00'), 'Happy New Year!')
   * ```
   */
  async schedule(
    channel: string,
    postAt: number | Date,
    content: string | Omit<ScheduleMessageOptions, 'post_at'>
  ): Promise<ScheduleResponse> {
    const timestamp = postAt instanceof Date ? Math.floor(postAt.getTime() / 1000) : postAt
    const args = typeof content === 'string' ? { text: content } : content

    return this._request<ScheduleResponse>('chat.scheduleMessage', {
      channel: this._normalizeChannel(channel),
      post_at: timestamp,
      ...args,
    })
  }

  /**
   * Delete a scheduled message
   *
   * @param channel - Channel ID
   * @param scheduledMessageId - Scheduled message ID from schedule response
   */
  async deleteScheduled(channel: string, scheduledMessageId: string): Promise<{ ok: boolean }> {
    return this._request<{ ok: boolean }>('chat.deleteScheduledMessage', {
      channel: this._normalizeChannel(channel),
      scheduled_message_id: scheduledMessageId,
    })
  }

  /**
   * Get permalink for a message
   *
   * @param ref - Message reference
   */
  async getPermalink(ref: MessageRef): Promise<{ ok: boolean; permalink: string }> {
    return this._request<{ ok: boolean; permalink: string }>('chat.getPermalink', {
      channel: ref.channel,
      message_ts: ref.ts,
    })
  }

  /**
   * Share a message to another channel
   *
   * @param ref - Message reference
   * @param targetChannel - Channel to share to
   */
  async share(ref: MessageRef, targetChannel: string): Promise<PostMessageResponse> {
    // Get the permalink first
    const { permalink } = await this.getPermalink(ref)

    // Post to target channel with the permalink
    return this.post(targetChannel, {
      text: permalink,
      unfurl_links: true,
      unfurl_media: true,
    })
  }

  // ==========================================================================
  // CONVENIENCE METHODS
  // ==========================================================================

  /**
   * Post a success message with green color
   */
  async success(channel: string, title: string, message?: string): Promise<MessageRef> {
    return this.post(channel, {
      attachments: [
        {
          color: '#36a64f',
          title,
          text: message,
        },
      ],
    })
  }

  /**
   * Post a warning message with yellow color
   */
  async warning(channel: string, title: string, message?: string): Promise<MessageRef> {
    return this.post(channel, {
      attachments: [
        {
          color: '#ffcc00',
          title,
          text: message,
        },
      ],
    })
  }

  /**
   * Post an error message with red color
   */
  async error(channel: string, title: string, message?: string): Promise<MessageRef> {
    return this.post(channel, {
      attachments: [
        {
          color: '#dc3545',
          title,
          text: message,
        },
      ],
    })
  }

  /**
   * Post an info message with blue color
   */
  async info(channel: string, title: string, message?: string): Promise<MessageRef> {
    return this.post(channel, {
      attachments: [
        {
          color: '#0d6efd',
          title,
          text: message,
        },
      ],
    })
  }

  // ==========================================================================
  // INTERNAL METHODS
  // ==========================================================================

  /**
   * Normalize channel name (handle #channel format)
   */
  private _normalizeChannel(channel: string): string {
    // If it starts with #, keep it as is - Slack will resolve it
    // Otherwise assume it's a channel ID
    return channel
  }

  /**
   * Make an API request with retry logic
   */
  private async _request<T extends { ok: boolean; error?: string }>(
    method: string,
    args: Record<string, unknown>
  ): Promise<T> {
    let lastError: Error | undefined
    let delay = this.retry.delay

    for (let attempt = 0; attempt < this.retry.attempts; attempt++) {
      try {
        return await this._doRequest<T>(method, args)
      } catch (error) {
        lastError = error as Error

        // Check if error is retryable
        if (error instanceof SlackMessageError) {
          // Don't retry client errors (4xx equivalent)
          if (
            [
              'channel_not_found',
              'not_in_channel',
              'msg_too_long',
              'no_text',
              'invalid_arguments',
              'missing_scope',
              'token_revoked',
              'invalid_auth',
              'account_inactive',
            ].includes(error.code)
          ) {
            throw error
          }

          // Handle rate limiting
          if (error.code === 'rate_limited') {
            const retryAfter = (error.data?.retry_after as number) ?? delay / 1000
            delay = Math.min(retryAfter * 1000, this.retry.maxDelay)
          }
        }

        // Wait before retry
        if (attempt < this.retry.attempts - 1) {
          await this._sleep(delay)
          delay = Math.min(delay * 2, this.retry.maxDelay)
        }
      }
    }

    throw lastError ?? new Error('Request failed')
  }

  /**
   * Execute a single request
   */
  private async _doRequest<T extends { ok: boolean; error?: string }>(
    method: string,
    args: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}/${method}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await this._fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(args),
        signal: controller.signal,
      })

      const data = (await response.json()) as T

      if (!data.ok) {
        throw new SlackMessageError(
          data.error ?? 'unknown_error',
          `Slack API error: ${data.error}`,
          data as unknown as Record<string, unknown>
        )
      }

      return data
    } catch (error) {
      if (error instanceof SlackMessageError) {
        throw error
      }

      if ((error as Error).name === 'AbortError') {
        throw new SlackMessageError('timeout', `Request timed out after ${this.timeout}ms`)
      }

      throw new SlackMessageError(
        'request_failed',
        `Request failed: ${(error as Error).message}`
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Sleep helper
   */
  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a SlackMessages client
 *
 * @example
 * ```typescript
 * const messages = createSlackMessages('xoxb-token')
 * await messages.post('#general', 'Hello!')
 * ```
 */
export function createSlackMessages(
  token: string,
  options?: SlackMessagesOptions
): SlackMessages {
  return new SlackMessages(token, options)
}

// ============================================================================
// RE-EXPORTS FOR CONVENIENCE
// ============================================================================

export {
  // Block builders
  section,
  divider,
  header,
  context,
  actions,
  image,
  input,
  // Text helpers
  plainText,
  mrkdwn,
  // Element builders
  button,
  staticSelect,
  multiStaticSelect,
  overflow,
  datePicker,
  timePicker,
  textInput,
  checkboxes,
  radioButtons,
  usersSelect,
  conversationsSelect,
  channelsSelect,
  imageElement,
  option,
  // Builder class
  Blocks,
} from './blocks'
