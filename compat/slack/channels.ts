/**
 * @dotdo/slack - Channel Management
 *
 * Comprehensive Slack Conversations API implementation for channel management.
 * Follows Slack Web API patterns with full edge runtime support.
 *
 * @example
 * ```typescript
 * import { ChannelManager } from '@dotdo/slack/channels'
 *
 * const channels = new ChannelManager('xoxb-token')
 *
 * // Create a channel
 * const channel = await channels.create({ name: 'my-channel' })
 *
 * // Manage members
 * await channels.invite({ channel: channel.id, users: 'U123,U456' })
 * await channels.kick({ channel: channel.id, user: 'U789' })
 *
 * // Update channel metadata
 * await channels.setTopic({ channel: channel.id, topic: 'Channel topic' })
 * await channels.setPurpose({ channel: channel.id, purpose: 'Channel purpose' })
 *
 * // Archive/unarchive
 * await channels.archive({ channel: channel.id })
 * await channels.unarchive({ channel: channel.id })
 * ```
 *
 * @module @dotdo/slack/channels
 */

import type { Block } from './blocks'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Base Slack API response
 */
export interface SlackResponse {
  ok: boolean
  error?: string
  warning?: string
  response_metadata?: ResponseMetadata
}

/**
 * Response metadata for pagination
 */
export interface ResponseMetadata {
  next_cursor?: string
  messages?: string[]
  warnings?: string[]
}

/**
 * Slack channel object
 */
export interface SlackChannel {
  id: string
  name: string
  is_channel: boolean
  is_group: boolean
  is_im: boolean
  is_mpim: boolean
  is_private: boolean
  is_archived: boolean
  is_general: boolean
  is_shared: boolean
  is_org_shared: boolean
  is_ext_shared: boolean
  is_pending_ext_shared: boolean
  is_member: boolean
  created: number
  creator: string
  unlinked: number
  name_normalized: string
  num_members?: number
  topic: ChannelTopic
  purpose: ChannelPurpose
  previous_names?: string[]
  locale?: string
  parent_conversation?: string | null
  shared_team_ids?: string[]
  pending_shared?: string[]
  pending_connected_team_ids?: string[]
  context_team_id?: string
  updated?: number
  last_read?: string
}

/**
 * Channel topic
 */
export interface ChannelTopic {
  value: string
  creator: string
  last_set: number
}

/**
 * Channel purpose
 */
export interface ChannelPurpose {
  value: string
  creator: string
  last_set: number
}

/**
 * Slack message
 */
export interface SlackMessage {
  type: string
  subtype?: string
  text?: string
  ts: string
  user?: string
  bot_id?: string
  app_id?: string
  channel?: string
  thread_ts?: string
  reply_count?: number
  reply_users_count?: number
  latest_reply?: string
  reply_users?: string[]
  blocks?: Block[]
  attachments?: MessageAttachment[]
  files?: MessageFile[]
  edited?: { user: string; ts: string }
  reactions?: MessageReaction[]
  pinned_to?: string[]
  is_starred?: boolean
}

/**
 * Message attachment
 */
export interface MessageAttachment {
  id?: number
  color?: string
  fallback?: string
  title?: string
  title_link?: string
  pretext?: string
  text?: string
  fields?: { title: string; value: string; short?: boolean }[]
  image_url?: string
  thumb_url?: string
  footer?: string
  footer_icon?: string
  ts?: number | string
  mrkdwn_in?: string[]
  author_name?: string
  author_link?: string
  author_icon?: string
}

/**
 * Message file
 */
export interface MessageFile {
  id: string
  name?: string
  title?: string
  mimetype?: string
  filetype?: string
  size?: number
  url_private?: string
  permalink?: string
}

/**
 * Message reaction
 */
export interface MessageReaction {
  name: string
  count: number
  users: string[]
}

// ============================================================================
// ARGUMENTS
// ============================================================================

/**
 * conversations.create arguments
 */
export interface ConversationsCreateArguments {
  /** Channel name (lowercase, no spaces, max 80 chars) */
  name: string
  /** Create a private channel */
  is_private?: boolean
  /** Team ID for org-wide apps */
  team_id?: string
}

/**
 * conversations.archive arguments
 */
export interface ConversationsArchiveArguments {
  /** Channel ID */
  channel: string
}

/**
 * conversations.unarchive arguments
 */
export interface ConversationsUnarchiveArguments {
  /** Channel ID */
  channel: string
}

/**
 * conversations.invite arguments
 */
export interface ConversationsInviteArguments {
  /** Channel ID */
  channel: string
  /** Comma-separated list of user IDs */
  users: string
  /** Force invite (admin only) */
  force?: boolean
}

/**
 * conversations.kick arguments
 */
export interface ConversationsKickArguments {
  /** Channel ID */
  channel: string
  /** User ID to remove */
  user: string
}

/**
 * conversations.setTopic arguments
 */
export interface ConversationsSetTopicArguments {
  /** Channel ID */
  channel: string
  /** New topic (max 250 chars) */
  topic: string
}

/**
 * conversations.setPurpose arguments
 */
export interface ConversationsSetPurposeArguments {
  /** Channel ID */
  channel: string
  /** New purpose (max 250 chars) */
  purpose: string
}

/**
 * conversations.list arguments
 */
export interface ConversationsListArguments {
  /** Pagination cursor */
  cursor?: string
  /** Exclude archived channels */
  exclude_archived?: boolean
  /** Results per page (default 100, max 1000) */
  limit?: number
  /** Team ID for org-wide apps */
  team_id?: string
  /** Channel types: public_channel, private_channel, mpim, im */
  types?: string
}

/**
 * conversations.info arguments
 */
export interface ConversationsInfoArguments {
  /** Channel ID */
  channel: string
  /** Include locale info */
  include_locale?: boolean
  /** Include member count */
  include_num_members?: boolean
}

/**
 * conversations.history arguments
 */
export interface ConversationsHistoryArguments {
  /** Channel ID */
  channel: string
  /** Pagination cursor */
  cursor?: string
  /** Include messages with ts equal to latest/oldest */
  inclusive?: boolean
  /** End of time range (default: now) */
  latest?: string
  /** Results per page (default 100, max 1000) */
  limit?: number
  /** Start of time range */
  oldest?: string
  /** Include all message metadata */
  include_all_metadata?: boolean
}

/**
 * conversations.replies arguments
 */
export interface ConversationsRepliesArguments {
  /** Channel ID */
  channel: string
  /** Timestamp of parent message */
  ts: string
  /** Pagination cursor */
  cursor?: string
  /** Include messages with ts equal to latest/oldest */
  inclusive?: boolean
  /** End of time range */
  latest?: string
  /** Results per page (default 100, max 1000) */
  limit?: number
  /** Start of time range */
  oldest?: string
  /** Include all message metadata */
  include_all_metadata?: boolean
}

/**
 * conversations.members arguments
 */
export interface ConversationsMembersArguments {
  /** Channel ID */
  channel: string
  /** Pagination cursor */
  cursor?: string
  /** Results per page (default 100, max 1000) */
  limit?: number
}

/**
 * conversations.join arguments
 */
export interface ConversationsJoinArguments {
  /** Channel ID */
  channel: string
}

/**
 * conversations.leave arguments
 */
export interface ConversationsLeaveArguments {
  /** Channel ID */
  channel: string
}

/**
 * conversations.rename arguments
 */
export interface ConversationsRenameArguments {
  /** Channel ID */
  channel: string
  /** New channel name */
  name: string
}

/**
 * conversations.mark arguments
 */
export interface ConversationsMarkArguments {
  /** Channel ID */
  channel: string
  /** Timestamp to mark as read */
  ts: string
}

/**
 * conversations.open arguments
 */
export interface ConversationsOpenArguments {
  /** Channel ID for existing DM/group */
  channel?: string
  /** Comma-separated user IDs to open DM/MPIM with */
  users?: string
  /** Prevent creating new conversation */
  prevent_creation?: boolean
  /** Return existing conversation even if archived */
  return_im?: boolean
}

/**
 * conversations.close arguments
 */
export interface ConversationsCloseArguments {
  /** Channel ID (DM or MPIM) */
  channel: string
}

// ============================================================================
// RESPONSES
// ============================================================================

/**
 * conversations.create response
 */
export interface ConversationsCreateResponse extends SlackResponse {
  channel?: SlackChannel
}

/**
 * conversations.archive response
 */
export interface ConversationsArchiveResponse extends SlackResponse {}

/**
 * conversations.unarchive response
 */
export interface ConversationsUnarchiveResponse extends SlackResponse {}

/**
 * conversations.invite response
 */
export interface ConversationsInviteResponse extends SlackResponse {
  channel?: SlackChannel
}

/**
 * conversations.kick response
 */
export interface ConversationsKickResponse extends SlackResponse {}

/**
 * conversations.setTopic response
 */
export interface ConversationsSetTopicResponse extends SlackResponse {
  channel?: SlackChannel
  topic?: string
}

/**
 * conversations.setPurpose response
 */
export interface ConversationsSetPurposeResponse extends SlackResponse {
  channel?: SlackChannel
  purpose?: string
}

/**
 * conversations.list response
 */
export interface ConversationsListResponse extends SlackResponse {
  channels?: SlackChannel[]
}

/**
 * conversations.info response
 */
export interface ConversationsInfoResponse extends SlackResponse {
  channel?: SlackChannel
}

/**
 * conversations.history response
 */
export interface ConversationsHistoryResponse extends SlackResponse {
  messages?: SlackMessage[]
  has_more?: boolean
  pin_count?: number
  channel_actions_ts?: string
  channel_actions_count?: number
}

/**
 * conversations.replies response
 */
export interface ConversationsRepliesResponse extends SlackResponse {
  messages?: SlackMessage[]
  has_more?: boolean
}

/**
 * conversations.members response
 */
export interface ConversationsMembersResponse extends SlackResponse {
  members?: string[]
}

/**
 * conversations.join response
 */
export interface ConversationsJoinResponse extends SlackResponse {
  channel?: SlackChannel
  warning?: string
}

/**
 * conversations.leave response
 */
export interface ConversationsLeaveResponse extends SlackResponse {
  not_in_channel?: boolean
}

/**
 * conversations.rename response
 */
export interface ConversationsRenameResponse extends SlackResponse {
  channel?: SlackChannel
}

/**
 * conversations.mark response
 */
export interface ConversationsMarkResponse extends SlackResponse {}

/**
 * conversations.open response
 */
export interface ConversationsOpenResponse extends SlackResponse {
  channel?: SlackChannel & { is_open?: boolean }
  no_op?: boolean
  already_open?: boolean
}

/**
 * conversations.close response
 */
export interface ConversationsCloseResponse extends SlackResponse {
  no_op?: boolean
  already_closed?: boolean
}

// ============================================================================
// ERROR CLASS
// ============================================================================

/**
 * Slack API Error
 */
export class SlackChannelError extends Error {
  /** Error code from Slack API */
  readonly code: string
  /** Additional error data */
  readonly data?: Record<string, unknown>

  constructor(code: string, message?: string, data?: Record<string, unknown>) {
    super(message ?? `Slack API Error: ${code}`)
    this.name = 'SlackChannelError'
    this.code = code
    this.data = data
  }
}

// ============================================================================
// CHANNEL MANAGER OPTIONS
// ============================================================================

/**
 * ChannelManager configuration options
 */
export interface ChannelManagerOptions {
  /** Base URL for Slack API */
  slackApiUrl?: string
  /** Request timeout in ms */
  timeout?: number
  /** Custom headers */
  headers?: Record<string, string>
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Retry configuration */
  retryConfig?: RetryConfig
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Number of retries before giving up */
  retries?: number
  /** Initial retry delay in ms */
  minTimeout?: number
  /** Maximum retry delay in ms */
  maxTimeout?: number
  /** Multiplier for exponential backoff */
  factor?: number
}

// ============================================================================
// CHANNEL MANAGER
// ============================================================================

/**
 * Slack Channel Manager - Comprehensive channel management API
 *
 * @example
 * ```typescript
 * const channels = new ChannelManager('xoxb-token')
 *
 * // Create and configure a channel
 * const { channel } = await channels.create({ name: 'project-alpha' })
 * await channels.setTopic({ channel: channel.id, topic: 'Project Alpha discussion' })
 * await channels.setPurpose({ channel: channel.id, purpose: 'Coordinate Alpha development' })
 *
 * // Invite team members
 * await channels.invite({ channel: channel.id, users: 'U123,U456,U789' })
 *
 * // Get channel history
 * const { messages } = await channels.history({ channel: channel.id, limit: 50 })
 * ```
 */
export class ChannelManager {
  private token?: string
  private baseUrl: string
  private timeout: number
  private customHeaders: Record<string, string>
  private _customFetch?: typeof fetch
  private retryConfig: Required<RetryConfig>

  constructor(token?: string, options: ChannelManagerOptions = {}) {
    this.token = token
    this.baseUrl = options.slackApiUrl ?? 'https://slack.com/api'
    this.timeout = options.timeout ?? 30000
    this.customHeaders = options.headers ?? {}
    this._customFetch = options.fetch

    this.retryConfig = {
      retries: options.retryConfig?.retries ?? 0,
      minTimeout: options.retryConfig?.minTimeout ?? 1000,
      maxTimeout: options.retryConfig?.maxTimeout ?? 30000,
      factor: options.retryConfig?.factor ?? 2,
    }
  }

  /**
   * Get the fetch function to use
   */
  private get _fetch(): typeof fetch {
    return this._customFetch ?? globalThis.fetch
  }

  // ==========================================================================
  // CHANNEL LIFECYCLE
  // ==========================================================================

  /**
   * Create a new channel
   *
   * @example
   * ```typescript
   * const { channel } = await channels.create({
   *   name: 'project-alpha',
   *   is_private: false,
   * })
   * console.log(`Created channel: ${channel.id}`)
   * ```
   */
  async create(args: ConversationsCreateArguments): Promise<ConversationsCreateResponse> {
    // Validate channel name
    if (!args.name || args.name.length === 0) {
      throw new SlackChannelError('invalid_name', 'Channel name is required')
    }
    if (args.name.length > 80) {
      throw new SlackChannelError('invalid_name', 'Channel name must be 80 characters or less')
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(args.name)) {
      throw new SlackChannelError(
        'invalid_name',
        'Channel name must start with a letter or number and can only contain lowercase letters, numbers, hyphens, and underscores'
      )
    }

    return this._apiCall<ConversationsCreateResponse>('conversations.create', args)
  }

  /**
   * Archive a channel
   *
   * @example
   * ```typescript
   * await channels.archive({ channel: 'C1234567890' })
   * ```
   */
  async archive(args: ConversationsArchiveArguments): Promise<ConversationsArchiveResponse> {
    return this._apiCall<ConversationsArchiveResponse>('conversations.archive', args)
  }

  /**
   * Unarchive a channel
   *
   * @example
   * ```typescript
   * await channels.unarchive({ channel: 'C1234567890' })
   * ```
   */
  async unarchive(args: ConversationsUnarchiveArguments): Promise<ConversationsUnarchiveResponse> {
    return this._apiCall<ConversationsUnarchiveResponse>('conversations.unarchive', args)
  }

  /**
   * Rename a channel
   *
   * @example
   * ```typescript
   * const { channel } = await channels.rename({
   *   channel: 'C1234567890',
   *   name: 'project-beta',
   * })
   * ```
   */
  async rename(args: ConversationsRenameArguments): Promise<ConversationsRenameResponse> {
    // Validate new name
    if (!args.name || args.name.length === 0) {
      throw new SlackChannelError('invalid_name', 'Channel name is required')
    }
    if (args.name.length > 80) {
      throw new SlackChannelError('invalid_name', 'Channel name must be 80 characters or less')
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(args.name)) {
      throw new SlackChannelError(
        'invalid_name',
        'Channel name must start with a letter or number and can only contain lowercase letters, numbers, hyphens, and underscores'
      )
    }

    return this._apiCall<ConversationsRenameResponse>('conversations.rename', args)
  }

  // ==========================================================================
  // MEMBER MANAGEMENT
  // ==========================================================================

  /**
   * Invite users to a channel
   *
   * @example
   * ```typescript
   * // Invite multiple users
   * await channels.invite({
   *   channel: 'C1234567890',
   *   users: 'U123,U456,U789',
   * })
   *
   * // Invite single user
   * await channels.invite({
   *   channel: 'C1234567890',
   *   users: 'U123',
   * })
   * ```
   */
  async invite(args: ConversationsInviteArguments): Promise<ConversationsInviteResponse> {
    if (!args.users || args.users.length === 0) {
      throw new SlackChannelError('invalid_users', 'At least one user ID is required')
    }

    return this._apiCall<ConversationsInviteResponse>('conversations.invite', args)
  }

  /**
   * Remove a user from a channel
   *
   * @example
   * ```typescript
   * await channels.kick({
   *   channel: 'C1234567890',
   *   user: 'U123',
   * })
   * ```
   */
  async kick(args: ConversationsKickArguments): Promise<ConversationsKickResponse> {
    if (!args.user || args.user.length === 0) {
      throw new SlackChannelError('invalid_user', 'User ID is required')
    }

    return this._apiCall<ConversationsKickResponse>('conversations.kick', args)
  }

  /**
   * List members of a channel
   *
   * @example
   * ```typescript
   * const { members } = await channels.members({
   *   channel: 'C1234567890',
   *   limit: 100,
   * })
   *
   * // Paginate through all members
   * let cursor: string | undefined
   * const allMembers: string[] = []
   * do {
   *   const response = await channels.members({
   *     channel: 'C1234567890',
   *     cursor,
   *   })
   *   allMembers.push(...(response.members ?? []))
   *   cursor = response.response_metadata?.next_cursor
   * } while (cursor)
   * ```
   */
  async members(args: ConversationsMembersArguments): Promise<ConversationsMembersResponse> {
    return this._apiCall<ConversationsMembersResponse>('conversations.members', args, 'GET')
  }

  /**
   * Join a channel
   *
   * @example
   * ```typescript
   * const { channel } = await channels.join({ channel: 'C1234567890' })
   * ```
   */
  async join(args: ConversationsJoinArguments): Promise<ConversationsJoinResponse> {
    return this._apiCall<ConversationsJoinResponse>('conversations.join', args)
  }

  /**
   * Leave a channel
   *
   * @example
   * ```typescript
   * await channels.leave({ channel: 'C1234567890' })
   * ```
   */
  async leave(args: ConversationsLeaveArguments): Promise<ConversationsLeaveResponse> {
    return this._apiCall<ConversationsLeaveResponse>('conversations.leave', args)
  }

  // ==========================================================================
  // CHANNEL METADATA
  // ==========================================================================

  /**
   * Set channel topic
   *
   * @example
   * ```typescript
   * const { topic } = await channels.setTopic({
   *   channel: 'C1234567890',
   *   topic: 'Project Alpha - Q1 Sprint',
   * })
   * ```
   */
  async setTopic(args: ConversationsSetTopicArguments): Promise<ConversationsSetTopicResponse> {
    if (args.topic && args.topic.length > 250) {
      throw new SlackChannelError('too_long', 'Topic must be 250 characters or less')
    }

    return this._apiCall<ConversationsSetTopicResponse>('conversations.setTopic', args)
  }

  /**
   * Set channel purpose
   *
   * @example
   * ```typescript
   * const { purpose } = await channels.setPurpose({
   *   channel: 'C1234567890',
   *   purpose: 'Coordinate Project Alpha development and discussions',
   * })
   * ```
   */
  async setPurpose(args: ConversationsSetPurposeArguments): Promise<ConversationsSetPurposeResponse> {
    if (args.purpose && args.purpose.length > 250) {
      throw new SlackChannelError('too_long', 'Purpose must be 250 characters or less')
    }

    return this._apiCall<ConversationsSetPurposeResponse>('conversations.setPurpose', args)
  }

  // ==========================================================================
  // CHANNEL LISTING & INFO
  // ==========================================================================

  /**
   * List channels
   *
   * @example
   * ```typescript
   * // List public channels
   * const { channels } = await channels.list({
   *   types: 'public_channel',
   *   exclude_archived: true,
   *   limit: 100,
   * })
   *
   * // List all channel types
   * const { channels: all } = await channels.list({
   *   types: 'public_channel,private_channel,mpim,im',
   * })
   *
   * // Paginate through all channels
   * let cursor: string | undefined
   * const allChannels: SlackChannel[] = []
   * do {
   *   const response = await channels.list({ cursor })
   *   allChannels.push(...(response.channels ?? []))
   *   cursor = response.response_metadata?.next_cursor
   * } while (cursor)
   * ```
   */
  async list(args: ConversationsListArguments = {}): Promise<ConversationsListResponse> {
    return this._apiCall<ConversationsListResponse>('conversations.list', args, 'GET')
  }

  /**
   * Get channel info
   *
   * @example
   * ```typescript
   * const { channel } = await channels.info({
   *   channel: 'C1234567890',
   *   include_num_members: true,
   *   include_locale: true,
   * })
   * console.log(`Channel ${channel.name} has ${channel.num_members} members`)
   * ```
   */
  async info(args: ConversationsInfoArguments): Promise<ConversationsInfoResponse> {
    return this._apiCall<ConversationsInfoResponse>('conversations.info', args, 'GET')
  }

  // ==========================================================================
  // MESSAGE HISTORY
  // ==========================================================================

  /**
   * Get channel message history
   *
   * @example
   * ```typescript
   * // Get recent messages
   * const { messages } = await channels.history({
   *   channel: 'C1234567890',
   *   limit: 100,
   * })
   *
   * // Get messages from time range
   * const { messages: rangeMessages } = await channels.history({
   *   channel: 'C1234567890',
   *   oldest: '1609459200.000000', // Unix timestamp
   *   latest: '1609545600.000000',
   *   inclusive: true,
   * })
   *
   * // Paginate through all messages
   * let cursor: string | undefined
   * const allMessages: SlackMessage[] = []
   * do {
   *   const response = await channels.history({
   *     channel: 'C1234567890',
   *     cursor,
   *   })
   *   allMessages.push(...(response.messages ?? []))
   *   cursor = response.response_metadata?.next_cursor
   * } while (cursor && response.has_more)
   * ```
   */
  async history(args: ConversationsHistoryArguments): Promise<ConversationsHistoryResponse> {
    return this._apiCall<ConversationsHistoryResponse>('conversations.history', args, 'GET')
  }

  /**
   * Get thread replies
   *
   * @example
   * ```typescript
   * const { messages } = await channels.replies({
   *   channel: 'C1234567890',
   *   ts: '1234567890.123456', // Parent message timestamp
   * })
   * ```
   */
  async replies(args: ConversationsRepliesArguments): Promise<ConversationsRepliesResponse> {
    return this._apiCall<ConversationsRepliesResponse>('conversations.replies', args, 'GET')
  }

  /**
   * Mark a channel as read
   *
   * @example
   * ```typescript
   * await channels.mark({
   *   channel: 'C1234567890',
   *   ts: '1234567890.123456',
   * })
   * ```
   */
  async mark(args: ConversationsMarkArguments): Promise<ConversationsMarkResponse> {
    return this._apiCall<ConversationsMarkResponse>('conversations.mark', args)
  }

  // ==========================================================================
  // DIRECT MESSAGES & GROUPS
  // ==========================================================================

  /**
   * Open a direct message or group conversation
   *
   * @example
   * ```typescript
   * // Open DM with single user
   * const { channel } = await channels.open({
   *   users: 'U123',
   * })
   *
   * // Open MPIM with multiple users
   * const { channel: mpim } = await channels.open({
   *   users: 'U123,U456,U789',
   * })
   *
   * // Get existing conversation
   * const { channel: existing } = await channels.open({
   *   channel: 'D1234567890',
   * })
   * ```
   */
  async open(args: ConversationsOpenArguments): Promise<ConversationsOpenResponse> {
    if (!args.channel && !args.users) {
      throw new SlackChannelError('invalid_arguments', 'Either channel or users must be provided')
    }

    return this._apiCall<ConversationsOpenResponse>('conversations.open', args)
  }

  /**
   * Close a direct message or group conversation
   *
   * @example
   * ```typescript
   * await channels.close({ channel: 'D1234567890' })
   * ```
   */
  async close(args: ConversationsCloseArguments): Promise<ConversationsCloseResponse> {
    return this._apiCall<ConversationsCloseResponse>('conversations.close', args)
  }

  // ==========================================================================
  // INTERNAL API
  // ==========================================================================

  /**
   * Make an API request with retries and rate limit handling
   * @internal
   */
  async _apiCall<T extends SlackResponse>(
    method: string,
    args: object = {},
    httpMethod: 'GET' | 'POST' = 'POST'
  ): Promise<T> {
    let lastError: Error | undefined
    let attempts = 0
    const maxAttempts = this.retryConfig.retries + 1

    while (attempts < maxAttempts) {
      try {
        return await this._request<T>(method, args, httpMethod)
      } catch (error) {
        lastError = error as Error

        // Check if it's a rate limit error
        if (error instanceof SlackChannelError && error.code === 'ratelimited') {
          attempts++
          if (attempts < maxAttempts) {
            const retryAfter = (error.data?.retryAfter as number) ?? 1
            const delay = Math.min(retryAfter * 1000, this.retryConfig.maxTimeout)
            await this._sleep(delay)
            continue
          }
        }

        // For other errors, apply exponential backoff for retryable errors
        if (this.retryConfig.retries > 0 && this._isRetryable(error as Error)) {
          attempts++
          if (attempts < maxAttempts) {
            const delay = Math.min(
              this.retryConfig.minTimeout * Math.pow(this.retryConfig.factor, attempts - 1),
              this.retryConfig.maxTimeout
            )
            await this._sleep(delay)
            continue
          }
        }

        throw error
      }
    }

    throw lastError ?? new Error('Unknown error')
  }

  /**
   * Make a single API request
   */
  private async _request<T extends SlackResponse>(
    method: string,
    args: object,
    httpMethod: 'GET' | 'POST'
  ): Promise<T> {
    let url = `${this.baseUrl}/${method}`

    const headers: Record<string, string> = {
      ...this.customHeaders,
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    let body: string | undefined

    if (httpMethod === 'GET') {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(args)) {
        if (value !== undefined && value !== null) {
          params.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
        }
      }
      const queryString = params.toString()
      if (queryString) {
        url += `?${queryString}`
      }
    } else {
      headers['Content-Type'] = 'application/json; charset=utf-8'
      body = JSON.stringify(args)
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await this._fetch(url, {
        method: httpMethod,
        headers,
        body,
        signal: controller.signal,
      })

      const data = (await response.json()) as T

      if (!data.ok) {
        // Check for rate limit
        if (data.error === 'ratelimited') {
          const retryAfter = response.headers.get('Retry-After')
          throw new SlackChannelError('ratelimited', 'Rate limited by Slack API', {
            retryAfter: retryAfter ? parseInt(retryAfter, 10) : 1,
          })
        }
        throw new SlackChannelError(data.error ?? 'unknown_error', `Slack API error: ${data.error}`, data as Record<string, unknown>)
      }

      return data
    } catch (error) {
      if (error instanceof SlackChannelError) {
        throw error
      }

      if ((error as Error).name === 'AbortError') {
        throw new SlackChannelError('timeout', `Request timed out after ${this.timeout}ms`)
      }

      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Check if an error is retryable
   */
  private _isRetryable(error: Error): boolean {
    if (error.message.includes('network') || error.message.includes('fetch')) {
      return true
    }
    if (error.message.includes('timed out') || error.message.includes('timeout')) {
      return true
    }
    if (error instanceof SlackChannelError && error.code === 'internal_error') {
      return true
    }
    return false
  }

  /**
   * Sleep helper
   */
  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse a channel name to ensure it's valid
 */
export function normalizeChannelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 80)
}

/**
 * Check if a channel ID is a public channel
 */
export function isPublicChannel(channelId: string): boolean {
  return channelId.startsWith('C')
}

/**
 * Check if a channel ID is a private channel
 */
export function isPrivateChannel(channelId: string): boolean {
  return channelId.startsWith('G')
}

/**
 * Check if a channel ID is a direct message
 */
export function isDirectMessage(channelId: string): boolean {
  return channelId.startsWith('D')
}

/**
 * Check if a channel ID is a multi-party direct message
 */
export function isMultiPartyDM(channelId: string): boolean {
  return channelId.startsWith('G') && channelId.length > 9
}

/**
 * Parse comma-separated user IDs
 */
export function parseUserIds(users: string): string[] {
  return users
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
}

/**
 * Format user IDs as comma-separated string
 */
export function formatUserIds(users: string[]): string {
  return users.join(',')
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default ChannelManager
