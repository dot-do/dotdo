/**
 * @dotdo/slack - WebClient
 *
 * HTTP-based Slack WebClient with retry logic and rate limiting support
 *
 * @example
 * ```typescript
 * import { WebClient } from '@dotdo/slack'
 *
 * const client = new WebClient('xoxb-token', {
 *   retryConfig: { retries: 3 },
 * })
 *
 * const result = await client.chat.postMessage({
 *   channel: 'C1234567890',
 *   text: 'Hello, World!',
 * })
 * ```
 */

import type { Block } from './blocks'

// ============================================================================
// TYPES
// ============================================================================

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

/**
 * WebClient configuration options
 */
export interface WebClientOptions {
  /** Base URL for Slack API */
  slackApiUrl?: string
  /** Request timeout in ms */
  timeout?: number
  /** Retry configuration */
  retryConfig?: RetryConfig
  /** Custom headers */
  headers?: Record<string, string>
  /** Custom fetch implementation */
  fetch?: typeof fetch
}

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
 * Response metadata
 */
export interface ResponseMetadata {
  next_cursor?: string
  messages?: string[]
  warnings?: string[]
}

// ============================================================================
// MESSAGE TYPES
// ============================================================================

export interface SlackMessage {
  type: string
  subtype?: string
  text?: string
  ts: string
  user?: string
  bot_id?: string
  channel?: string
  thread_ts?: string
  blocks?: Block[]
  attachments?: Attachment[]
  edited?: { user: string; ts: string }
}

export interface Attachment {
  color?: string
  fallback?: string
  title?: string
  title_link?: string
  text?: string
  fields?: { title: string; value: string; short?: boolean }[]
  image_url?: string
  thumb_url?: string
  footer?: string
  ts?: number | string
}

export interface MessageMetadata {
  event_type: string
  event_payload: Record<string, unknown>
}

// ============================================================================
// CHANNEL TYPES
// ============================================================================

export interface SlackChannel {
  id: string
  name?: string
  is_channel?: boolean
  is_group?: boolean
  is_im?: boolean
  is_mpim?: boolean
  is_private?: boolean
  is_archived?: boolean
  is_member?: boolean
  num_members?: number
  topic?: { value: string; creator?: string; last_set?: number }
  purpose?: { value: string; creator?: string; last_set?: number }
}

// ============================================================================
// USER TYPES
// ============================================================================

export interface SlackUser {
  id: string
  team_id?: string
  name: string
  real_name?: string
  is_admin?: boolean
  is_owner?: boolean
  is_bot?: boolean
  deleted?: boolean
  locale?: string
  profile?: UserProfile
}

export interface UserProfile {
  email?: string
  display_name?: string
  real_name?: string
  image_24?: string
  image_32?: string
  image_48?: string
  image_72?: string
  image_192?: string
  image_512?: string
}

// ============================================================================
// CHAT API TYPES
// ============================================================================

export interface ChatPostMessageArguments {
  channel: string
  text?: string
  blocks?: Block[]
  attachments?: Attachment[]
  thread_ts?: string
  reply_broadcast?: boolean
  unfurl_links?: boolean
  unfurl_media?: boolean
  mrkdwn?: boolean
  as_user?: boolean
  username?: string
  icon_emoji?: string
  icon_url?: string
  link_names?: boolean
  parse?: 'full' | 'none'
  metadata?: MessageMetadata
}

export interface ChatPostMessageResponse extends SlackResponse {
  channel?: string
  ts?: string
  message?: SlackMessage
}

export interface ChatUpdateArguments {
  channel: string
  ts: string
  text?: string
  blocks?: Block[]
  attachments?: Attachment[]
  as_user?: boolean
  link_names?: boolean
  parse?: 'full' | 'none'
  metadata?: MessageMetadata
  reply_broadcast?: boolean
}

export interface ChatUpdateResponse extends SlackResponse {
  channel?: string
  ts?: string
  text?: string
  message?: SlackMessage
}

export interface ChatDeleteArguments {
  channel: string
  ts: string
  as_user?: boolean
}

export interface ChatDeleteResponse extends SlackResponse {
  channel?: string
  ts?: string
}

// ============================================================================
// CONVERSATIONS API TYPES
// ============================================================================

export interface ConversationsListArguments {
  cursor?: string
  exclude_archived?: boolean
  limit?: number
  team_id?: string
  types?: string
}

export interface ConversationsListResponse extends SlackResponse {
  channels?: SlackChannel[]
}

export interface ConversationsHistoryArguments {
  channel: string
  cursor?: string
  inclusive?: boolean
  latest?: string
  limit?: number
  oldest?: string
  include_all_metadata?: boolean
}

export interface ConversationsHistoryResponse extends SlackResponse {
  messages?: SlackMessage[]
  has_more?: boolean
  pin_count?: number
}

export interface ConversationsInfoArguments {
  channel: string
  include_locale?: boolean
  include_num_members?: boolean
}

export interface ConversationsInfoResponse extends SlackResponse {
  channel?: SlackChannel
}

export interface ConversationsJoinArguments {
  channel: string
}

export interface ConversationsJoinResponse extends SlackResponse {
  channel?: SlackChannel
}

export interface ConversationsLeaveArguments {
  channel: string
}

export interface ConversationsLeaveResponse extends SlackResponse {
  not_in_channel?: boolean
}

export interface ConversationsCreateArguments {
  name: string
  is_private?: boolean
  team_id?: string
}

export interface ConversationsCreateResponse extends SlackResponse {
  channel?: SlackChannel
}

export interface ConversationsArchiveArguments {
  channel: string
}

export interface ConversationsArchiveResponse extends SlackResponse {}

export interface ConversationsUnarchiveArguments {
  channel: string
}

export interface ConversationsUnarchiveResponse extends SlackResponse {}

export interface ConversationsInviteArguments {
  channel: string
  users: string
  force?: boolean
}

export interface ConversationsInviteResponse extends SlackResponse {
  channel?: SlackChannel
}

export interface ConversationsKickArguments {
  channel: string
  user: string
}

export interface ConversationsKickResponse extends SlackResponse {}

export interface ConversationsMembersArguments {
  channel: string
  cursor?: string
  limit?: number
}

export interface ConversationsMembersResponse extends SlackResponse {
  members?: string[]
}

export interface ConversationsRenameArguments {
  channel: string
  name: string
}

export interface ConversationsRenameResponse extends SlackResponse {
  channel?: SlackChannel
}

export interface ConversationsSetTopicArguments {
  channel: string
  topic: string
}

export interface ConversationsSetTopicResponse extends SlackResponse {
  channel?: SlackChannel
  topic?: string
}

export interface ConversationsSetPurposeArguments {
  channel: string
  purpose: string
}

export interface ConversationsSetPurposeResponse extends SlackResponse {
  channel?: SlackChannel
  purpose?: string
}

export interface ConversationsOpenArguments {
  channel?: string
  users?: string
  prevent_creation?: boolean
  return_im?: boolean
}

export interface ConversationsOpenResponse extends SlackResponse {
  channel?: SlackChannel & { is_open?: boolean }
  no_op?: boolean
  already_open?: boolean
}

export interface ConversationsCloseArguments {
  channel: string
}

export interface ConversationsCloseResponse extends SlackResponse {
  no_op?: boolean
  already_closed?: boolean
}

export interface ConversationsRepliesArguments {
  channel: string
  ts: string
  cursor?: string
  inclusive?: boolean
  latest?: string
  limit?: number
  oldest?: string
  include_all_metadata?: boolean
}

export interface ConversationsRepliesResponse extends SlackResponse {
  messages?: SlackMessage[]
  has_more?: boolean
}

export interface ConversationsMarkArguments {
  channel: string
  ts: string
}

export interface ConversationsMarkResponse extends SlackResponse {}

// ============================================================================
// USERS API TYPES
// ============================================================================

export interface UsersListArguments {
  cursor?: string
  include_locale?: boolean
  limit?: number
  team_id?: string
}

export interface UsersListResponse extends SlackResponse {
  members?: SlackUser[]
  cache_ts?: number
}

export interface UsersInfoArguments {
  user: string
  include_locale?: boolean
}

export interface UsersInfoResponse extends SlackResponse {
  user?: SlackUser
}

export interface UsersLookupByEmailArguments {
  email: string
}

export interface UsersLookupByEmailResponse extends SlackResponse {
  user?: SlackUser
}

// ============================================================================
// CHAT EPHEMERAL & SCHEDULED TYPES
// ============================================================================

export interface ChatPostEphemeralArguments {
  channel: string
  user: string
  text?: string
  blocks?: Block[]
  attachments?: Attachment[]
  thread_ts?: string
  as_user?: boolean
  username?: string
  icon_emoji?: string
  icon_url?: string
  link_names?: boolean
  parse?: 'full' | 'none'
}

export interface ChatPostEphemeralResponse extends SlackResponse {
  message_ts?: string
}

export interface ChatScheduleMessageArguments {
  channel: string
  post_at: number | string
  text?: string
  blocks?: Block[]
  attachments?: Attachment[]
  thread_ts?: string
  reply_broadcast?: boolean
  unfurl_links?: boolean
  unfurl_media?: boolean
  as_user?: boolean
  metadata?: MessageMetadata
}

export interface ChatScheduleMessageResponse extends SlackResponse {
  channel?: string
  scheduled_message_id?: string
  post_at?: number
  message?: {
    text?: string
    username?: string
    bot_id?: string
    type?: string
  }
}

export interface ChatDeleteScheduledMessageArguments {
  channel: string
  scheduled_message_id: string
  as_user?: boolean
}

export interface ChatDeleteScheduledMessageResponse extends SlackResponse {}

// ============================================================================
// REACTIONS API TYPES
// ============================================================================

export interface ReactionsAddArguments {
  channel: string
  name: string
  timestamp: string
}

export interface ReactionsAddResponse extends SlackResponse {}

export interface ReactionsRemoveArguments {
  channel: string
  name: string
  timestamp: string
}

export interface ReactionsRemoveResponse extends SlackResponse {}

export interface ReactionsGetArguments {
  channel: string
  timestamp: string
  full?: boolean
}

export interface Reaction {
  name: string
  count: number
  users: string[]
}

export interface ReactionsGetResponse extends SlackResponse {
  message?: SlackMessage & {
    reactions?: Reaction[]
  }
  type?: string
  channel?: string
}

export interface ReactionsListArguments {
  user?: string
  count?: number
  cursor?: string
  full?: boolean
  limit?: number
  page?: number
  team_id?: string
}

export interface ReactedItem {
  type: string
  channel?: string
  message?: SlackMessage & {
    reactions?: Reaction[]
  }
  file?: unknown
  comment?: unknown
}

export interface ReactionsListResponse extends SlackResponse {
  items?: ReactedItem[]
  paging?: {
    count: number
    page: number
    pages: number
    total: number
  }
}

// ============================================================================
// ERROR CLASS
// ============================================================================

/**
 * Slack API Error
 */
export class SlackError extends Error {
  /** Error code from Slack API */
  code: string
  /** Additional error data */
  data?: Record<string, unknown>
  /** Flag to identify SlackError instances */
  readonly isSlackError = true

  constructor(code: string, data?: Record<string, unknown>) {
    super(`Slack API Error: ${code}`)
    this.name = 'SlackError'
    this.code = code
    this.data = data
  }
}

// ============================================================================
// WEBCLIENT
// ============================================================================

/**
 * Slack WebClient - HTTP-based API client
 */
export class WebClient {
  private _token?: string
  private baseUrl: string
  private timeout: number
  private retryConfig: Required<RetryConfig>
  private customHeaders: Record<string, string>
  private _customFetch?: typeof fetch

  readonly chat: ChatMethods
  readonly conversations: ConversationsMethods
  readonly users: UsersMethods
  readonly reactions: ReactionsMethods

  constructor(token?: string, options: WebClientOptions = {}) {
    this._token = token
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

    this.chat = new ChatMethods(this)
    this.conversations = new ConversationsMethods(this)
    this.users = new UsersMethods(this)
    this.reactions = new ReactionsMethods(this)
  }

  /**
   * Get the fetch function to use (allows lazy binding for testing)
   */
  private get _fetch(): typeof fetch {
    return this._customFetch ?? globalThis.fetch
  }

  /** Get current token */
  get token(): string | undefined {
    return this._token
  }

  /** Set token */
  set token(value: string | undefined) {
    this._token = value
  }

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
        if (error instanceof SlackError && error.code === 'rate_limited') {
          attempts++
          if (attempts < maxAttempts) {
            // Get retry-after from error data or use default
            const retryAfter = (error.data?.retryAfter as number) ?? 1
            const delay = Math.min(
              retryAfter * 1000,
              this.retryConfig.maxTimeout
            )
            await this._sleep(delay)
            continue
          }
        }

        // For other errors, apply exponential backoff
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

    if (this._token) {
      headers['Authorization'] = `Bearer ${this._token}`
    }

    let body: string | undefined

    if (httpMethod === 'GET') {
      // For GET requests, add args as query parameters
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(args)) {
        if (value !== undefined && value !== null) {
          params.append(key, String(value))
        }
      }
      const queryString = params.toString()
      if (queryString) {
        url += `?${queryString}`
      }
    } else {
      // For POST requests, send as JSON body
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

      const data = await response.json() as T

      if (!data.ok) {
        // Check for rate limit
        if (data.error === 'rate_limited') {
          const retryAfter = response.headers.get('Retry-After')
          throw new SlackError('rate_limited', {
            retryAfter: retryAfter ? parseInt(retryAfter, 10) : 1,
          })
        }
        throw new SlackError(data.error ?? 'unknown_error', data as Record<string, unknown>)
      }

      return data
    } catch (error) {
      if (error instanceof SlackError) {
        throw error
      }

      if ((error as Error).name === 'AbortError') {
        throw new Error(`Request timed out after ${this.timeout}ms`)
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
    // Network errors are retryable
    if (error.message.includes('network') || error.message.includes('fetch')) {
      return true
    }

    // Timeout errors are retryable
    if (error.message.includes('timed out')) {
      return true
    }

    return false
  }

  /**
   * Sleep helper
   */
  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// ============================================================================
// CHAT METHODS
// ============================================================================

class ChatMethods {
  constructor(private client: WebClient) {}

  async postMessage(args: ChatPostMessageArguments): Promise<ChatPostMessageResponse> {
    return this.client._apiCall('chat.postMessage', args)
  }

  async postEphemeral(args: ChatPostEphemeralArguments): Promise<ChatPostEphemeralResponse> {
    return this.client._apiCall('chat.postEphemeral', args)
  }

  async update(args: ChatUpdateArguments): Promise<ChatUpdateResponse> {
    return this.client._apiCall('chat.update', args)
  }

  async delete(args: ChatDeleteArguments): Promise<ChatDeleteResponse> {
    return this.client._apiCall('chat.delete', args)
  }

  async scheduleMessage(args: ChatScheduleMessageArguments): Promise<ChatScheduleMessageResponse> {
    return this.client._apiCall('chat.scheduleMessage', args)
  }

  async deleteScheduledMessage(args: ChatDeleteScheduledMessageArguments): Promise<ChatDeleteScheduledMessageResponse> {
    return this.client._apiCall('chat.deleteScheduledMessage', args)
  }
}

// ============================================================================
// CONVERSATIONS METHODS
// ============================================================================

class ConversationsMethods {
  constructor(private client: WebClient) {}

  async list(args: ConversationsListArguments = {}): Promise<ConversationsListResponse> {
    return this.client._apiCall('conversations.list', args, 'GET')
  }

  async history(args: ConversationsHistoryArguments): Promise<ConversationsHistoryResponse> {
    return this.client._apiCall('conversations.history', args, 'GET')
  }

  async info(args: ConversationsInfoArguments): Promise<ConversationsInfoResponse> {
    return this.client._apiCall('conversations.info', args, 'GET')
  }

  async join(args: ConversationsJoinArguments): Promise<ConversationsJoinResponse> {
    return this.client._apiCall('conversations.join', args)
  }

  async leave(args: ConversationsLeaveArguments): Promise<ConversationsLeaveResponse> {
    return this.client._apiCall('conversations.leave', args)
  }

  async create(args: ConversationsCreateArguments): Promise<ConversationsCreateResponse> {
    return this.client._apiCall('conversations.create', args)
  }

  async archive(args: ConversationsArchiveArguments): Promise<ConversationsArchiveResponse> {
    return this.client._apiCall('conversations.archive', args)
  }

  async unarchive(args: ConversationsUnarchiveArguments): Promise<ConversationsUnarchiveResponse> {
    return this.client._apiCall('conversations.unarchive', args)
  }

  async invite(args: ConversationsInviteArguments): Promise<ConversationsInviteResponse> {
    return this.client._apiCall('conversations.invite', args)
  }

  async kick(args: ConversationsKickArguments): Promise<ConversationsKickResponse> {
    return this.client._apiCall('conversations.kick', args)
  }

  async members(args: ConversationsMembersArguments): Promise<ConversationsMembersResponse> {
    return this.client._apiCall('conversations.members', args, 'GET')
  }

  async rename(args: ConversationsRenameArguments): Promise<ConversationsRenameResponse> {
    return this.client._apiCall('conversations.rename', args)
  }

  async setTopic(args: ConversationsSetTopicArguments): Promise<ConversationsSetTopicResponse> {
    return this.client._apiCall('conversations.setTopic', args)
  }

  async setPurpose(args: ConversationsSetPurposeArguments): Promise<ConversationsSetPurposeResponse> {
    return this.client._apiCall('conversations.setPurpose', args)
  }

  async open(args: ConversationsOpenArguments): Promise<ConversationsOpenResponse> {
    return this.client._apiCall('conversations.open', args)
  }

  async close(args: ConversationsCloseArguments): Promise<ConversationsCloseResponse> {
    return this.client._apiCall('conversations.close', args)
  }

  async replies(args: ConversationsRepliesArguments): Promise<ConversationsRepliesResponse> {
    return this.client._apiCall('conversations.replies', args, 'GET')
  }

  async mark(args: ConversationsMarkArguments): Promise<ConversationsMarkResponse> {
    return this.client._apiCall('conversations.mark', args)
  }
}

// ============================================================================
// USERS METHODS
// ============================================================================

class UsersMethods {
  constructor(private client: WebClient) {}

  async list(args: UsersListArguments): Promise<UsersListResponse> {
    return this.client._apiCall('users.list', args, 'GET')
  }

  async info(args: UsersInfoArguments): Promise<UsersInfoResponse> {
    return this.client._apiCall('users.info', args, 'GET')
  }

  async lookupByEmail(args: UsersLookupByEmailArguments): Promise<UsersLookupByEmailResponse> {
    return this.client._apiCall('users.lookupByEmail', args, 'GET')
  }
}

// ============================================================================
// REACTIONS METHODS
// ============================================================================

class ReactionsMethods {
  constructor(private client: WebClient) {}

  async add(args: ReactionsAddArguments): Promise<ReactionsAddResponse> {
    // Strip colons from emoji name if present (e.g., :rocket: -> rocket)
    const normalizedArgs = {
      ...args,
      name: args.name.replace(/^:|:$/g, ''),
    }
    return this.client._apiCall('reactions.add', normalizedArgs)
  }

  async remove(args: ReactionsRemoveArguments): Promise<ReactionsRemoveResponse> {
    return this.client._apiCall('reactions.remove', args)
  }

  async get(args: ReactionsGetArguments): Promise<ReactionsGetResponse> {
    return this.client._apiCall('reactions.get', args, 'GET')
  }

  async list(args: ReactionsListArguments = {}): Promise<ReactionsListResponse> {
    return this.client._apiCall('reactions.list', args, 'GET')
  }
}
