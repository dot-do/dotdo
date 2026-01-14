/**
 * @dotdo/slack - Slack API Compatibility Layer
 *
 * Drop-in replacement for @slack/web-api and @slack/bolt with edge compatibility.
 * Provides WebClient for API calls and App for bot framework.
 *
 * @example WebClient
 * ```typescript
 * import { WebClient } from '@dotdo/slack'
 *
 * const client = new WebClient('xoxb-token')
 *
 * // Post message
 * const result = await client.chat.postMessage({
 *   channel: 'C1234567890',
 *   text: 'Hello!',
 *   blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Hello!*' } }],
 * })
 *
 * // Update message
 * await client.chat.update({
 *   channel: 'C1234567890',
 *   ts: '1234567890.123456',
 *   text: 'Updated message',
 * })
 *
 * // Create channel
 * const channel = await client.conversations.create({
 *   name: 'new-channel',
 *   is_private: false,
 * })
 * ```
 *
 * @example App (Bot Framework)
 * ```typescript
 * import { App } from '@dotdo/slack'
 *
 * const app = new App({
 *   token: 'xoxb-token',
 *   signingSecret: 'signing-secret',
 * })
 *
 * app.message('hello', async ({ say }) => {
 *   await say('Hello back!')
 * })
 *
 * app.command('/hello', async ({ command, ack, respond }) => {
 *   await ack()
 *   await respond(`Hello, ${command.user_name}!`)
 * })
 * ```
 *
 * @module @dotdo/slack
 */

import type {
  Message,
  Channel,
  User,
  Block,
  SlackEvent,
  MessageEvent,
  BlockAction,
  BlockActionsPayload,
  ViewSubmissionPayload,
  ViewClosedPayload,
  ShortcutPayload,
  SlashCommand,
  CommandResponse,
  ChatPostMessageArguments,
  ChatPostEphemeralArguments,
  ChatUpdateArguments,
  ChatDeleteArguments,
  ChatScheduleMessageArguments,
  ChatPostMessageResponse,
  ChatPostEphemeralResponse,
  ChatUpdateResponse,
  ChatDeleteResponse,
  ChatScheduleMessageResponse,
  ConversationsCreateArguments,
  ConversationsListArguments,
  ConversationsInfoArguments,
  ConversationsJoinArguments,
  ConversationsLeaveArguments,
  ConversationsArchiveArguments,
  ConversationsUnarchiveArguments,
  ConversationsInviteArguments,
  ConversationsKickArguments,
  ConversationsMembersArguments,
  ConversationsHistoryArguments,
  ConversationsCreateResponse,
  ConversationsListResponse,
  ConversationsInfoResponse,
  ConversationsJoinResponse,
  ConversationsLeaveResponse,
  ConversationsArchiveResponse,
  ConversationsUnarchiveResponse,
  ConversationsInviteResponse,
  ConversationsKickResponse,
  ConversationsMembersResponse,
  ConversationsHistoryResponse,
  UsersInfoArguments,
  UsersListArguments,
  UsersLookupByEmailArguments,
  UsersInfoResponse,
  UsersListResponse,
  UsersLookupByEmailResponse,
  WebClientOptions,
  AppOptions,
  SlackEventMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  SlackShortcutMiddlewareArgs,
  SlackCommandMiddlewareArgs,
  Context,
  EventCallbackBody,
  Middleware,
  SayFn,
  RespondFn,
  AckFn,
  NextFn,
} from './types'

// =============================================================================
// In-Memory Storage (for testing and local development)
// =============================================================================

interface InMemoryState {
  channels: Map<string, Channel>
  messages: Map<string, Message[]>
  users: Map<string, User>
}

const state: InMemoryState = {
  channels: new Map(),
  messages: new Map(),
  users: new Map(),
}

/**
 * Clear all in-memory state (for testing)
 */
export function _clearAll(): void {
  state.channels.clear()
  state.messages.clear()
  state.users.clear()
}

/**
 * Get all channels (for testing)
 */
export function _getChannels(): Channel[] {
  return Array.from(state.channels.values())
}

/**
 * Get all messages (for testing)
 */
export function _getMessages(): Message[] {
  const allMessages: Message[] = []
  for (const messages of state.messages.values()) {
    allMessages.push(...messages)
  }
  return allMessages
}

// =============================================================================
// Slack Error
// =============================================================================

/**
 * Slack API Error
 */
export class SlackError extends Error {
  code: string
  data?: unknown

  constructor(code: string, message?: string, data?: unknown) {
    super(message ?? code)
    this.name = 'SlackError'
    this.code = code
    this.data = data
  }
}

// =============================================================================
// ID Generation
// =============================================================================

function generateId(prefix: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let id = prefix
  for (let i = 0; i < 10; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return id
}

function generateTs(): string {
  const now = Date.now()
  const seconds = Math.floor(now / 1000)
  const micros = (now % 1000) * 1000 + Math.floor(Math.random() * 1000)
  return `${seconds}.${micros.toString().padStart(6, '0')}`
}

// =============================================================================
// WebClient
// =============================================================================

/**
 * Slack WebClient - API-compatible with @slack/web-api
 */
export class WebClient {
  private token?: string
  private baseUrl: string
  private timeout: number
  private _fetch: typeof fetch

  readonly chat: ChatMethods
  readonly conversations: ConversationsMethods
  readonly users: UsersMethods

  constructor(token?: string, options: WebClientOptions = {}) {
    this.token = token
    this.baseUrl = options.slackApiUrl ?? options.baseUrl ?? 'https://slack.com'
    this.timeout = options.timeout ?? 30000
    this._fetch = options.fetch ?? globalThis.fetch?.bind(globalThis)

    this.chat = new ChatMethods(this)
    this.conversations = new ConversationsMethods(this)
    this.users = new UsersMethods(this)
  }

  /**
   * Make an API request
   * @internal
   */
  async _request<T>(
    method: string,
    args: Record<string, unknown> = {}
  ): Promise<T> {
    // If using custom fetch (mocked), use HTTP API
    if (this._fetch !== globalThis.fetch?.bind(globalThis)) {
      return this._httpRequest(method, args)
    }

    // Otherwise use in-memory implementation for local dev/testing
    return this._inMemoryRequest(method, args) as T
  }

  private async _httpRequest<T>(
    method: string,
    args: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}/api/${method}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await this._fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(args),
        signal: controller.signal,
      })

      const data = await response.json()

      if (!data.ok) {
        throw new SlackError(data.error, `Slack API error: ${data.error}`, data)
      }

      return data as T
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async _inMemoryRequest(
    method: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    switch (method) {
      case 'chat.postMessage':
        return this._handleChatPostMessage(args as ChatPostMessageArguments)
      case 'chat.postEphemeral':
        return this._handleChatPostEphemeral(args as ChatPostEphemeralArguments)
      case 'chat.update':
        return this._handleChatUpdate(args as ChatUpdateArguments)
      case 'chat.delete':
        return this._handleChatDelete(args as ChatDeleteArguments)
      case 'chat.scheduleMessage':
        return this._handleChatScheduleMessage(args as ChatScheduleMessageArguments)
      case 'conversations.create':
        return this._handleConversationsCreate(args as ConversationsCreateArguments)
      case 'conversations.list':
        return this._handleConversationsList(args as ConversationsListArguments)
      case 'conversations.info':
        return this._handleConversationsInfo(args as ConversationsInfoArguments)
      case 'conversations.join':
        return this._handleConversationsJoin(args as ConversationsJoinArguments)
      case 'conversations.leave':
        return this._handleConversationsLeave(args as ConversationsLeaveArguments)
      case 'conversations.archive':
        return this._handleConversationsArchive(args as ConversationsArchiveArguments)
      case 'conversations.unarchive':
        return this._handleConversationsUnarchive(args as ConversationsUnarchiveArguments)
      case 'conversations.invite':
        return this._handleConversationsInvite(args as ConversationsInviteArguments)
      case 'conversations.kick':
        return this._handleConversationsKick(args as ConversationsKickArguments)
      case 'conversations.members':
        return this._handleConversationsMembers(args as ConversationsMembersArguments)
      case 'conversations.history':
        return this._handleConversationsHistory(args as ConversationsHistoryArguments)
      case 'users.info':
        return this._handleUsersInfo(args as UsersInfoArguments)
      case 'users.list':
        return this._handleUsersList(args as UsersListArguments)
      case 'users.lookupByEmail':
        return this._handleUsersLookupByEmail(args as UsersLookupByEmailArguments)
      default:
        throw new SlackError('method_not_found', `Unknown method: ${method}`)
    }
  }

  // Chat handlers
  private _handleChatPostMessage(args: ChatPostMessageArguments): ChatPostMessageResponse {
    const ts = generateTs()
    const message: Message = {
      type: 'message',
      ts,
      user: 'U_BOT',
      text: args.text,
      channel: args.channel,
      blocks: args.blocks,
      attachments: args.attachments,
      thread_ts: args.thread_ts,
    }

    const channelMessages = state.messages.get(args.channel) ?? []
    channelMessages.push(message)
    state.messages.set(args.channel, channelMessages)

    return {
      ok: true,
      channel: args.channel,
      ts,
      message,
    }
  }

  private _handleChatPostEphemeral(args: ChatPostEphemeralArguments): ChatPostEphemeralResponse {
    return {
      ok: true,
      message_ts: generateTs(),
    }
  }

  private _handleChatUpdate(args: ChatUpdateArguments): ChatUpdateResponse {
    const channelMessages = state.messages.get(args.channel)
    if (!channelMessages) {
      throw new SlackError('message_not_found')
    }

    const messageIndex = channelMessages.findIndex((m) => m.ts === args.ts)
    if (messageIndex === -1) {
      throw new SlackError('message_not_found')
    }

    const updatedMessage: Message = {
      ...channelMessages[messageIndex],
      text: args.text,
      blocks: args.blocks,
      attachments: args.attachments,
      edited: {
        user: 'U_BOT',
        ts: generateTs(),
      },
    }

    channelMessages[messageIndex] = updatedMessage
    state.messages.set(args.channel, channelMessages)

    return {
      ok: true,
      channel: args.channel,
      ts: args.ts,
      text: args.text,
      message: updatedMessage,
    }
  }

  private _handleChatDelete(args: ChatDeleteArguments): ChatDeleteResponse {
    const channelMessages = state.messages.get(args.channel)
    if (!channelMessages) {
      throw new SlackError('channel_not_found')
    }

    const messageIndex = channelMessages.findIndex((m) => m.ts === args.ts)
    if (messageIndex === -1) {
      throw new SlackError('message_not_found')
    }

    channelMessages.splice(messageIndex, 1)
    state.messages.set(args.channel, channelMessages)

    return {
      ok: true,
      channel: args.channel,
      ts: args.ts,
    }
  }

  private _handleChatScheduleMessage(args: ChatScheduleMessageArguments): ChatScheduleMessageResponse {
    const message: Message = {
      type: 'message',
      ts: generateTs(),
      user: 'U_BOT',
      text: args.text,
      channel: args.channel,
      blocks: args.blocks,
      attachments: args.attachments,
    }

    return {
      ok: true,
      channel: args.channel,
      scheduled_message_id: generateId('Q'),
      post_at: args.post_at,
      message,
    }
  }

  // Conversations handlers
  private _handleConversationsCreate(args: ConversationsCreateArguments): ConversationsCreateResponse {
    // Validate channel name
    if (!/^[a-z0-9_-]+$/.test(args.name)) {
      throw new SlackError('invalid_name', 'Channel name can only contain lowercase letters, numbers, hyphens, and underscores')
    }

    // Check for duplicate name
    for (const channel of state.channels.values()) {
      if (channel.name === args.name) {
        throw new SlackError('name_taken', 'Channel name already exists')
      }
    }

    const channel: Channel = {
      id: generateId('C'),
      name: args.name,
      is_channel: !args.is_private,
      is_group: args.is_private ?? false,
      is_im: false,
      is_mpim: false,
      is_private: args.is_private ?? false,
      created: Math.floor(Date.now() / 1000),
      is_archived: false,
      is_general: false,
      is_shared: false,
      is_org_shared: false,
      is_member: true,
      is_pending_ext_shared: false,
      num_members: 1,
    }

    state.channels.set(channel.id, channel)
    state.messages.set(channel.id, [])

    return {
      ok: true,
      channel,
    }
  }

  private _handleConversationsList(args?: ConversationsListArguments): ConversationsListResponse {
    let channels = Array.from(state.channels.values())

    if (args?.exclude_archived) {
      channels = channels.filter((c) => !c.is_archived)
    }

    if (args?.types) {
      const types = args.types.split(',')
      channels = channels.filter((c) => {
        if (types.includes('public_channel') && c.is_channel && !c.is_private) return true
        if (types.includes('private_channel') && c.is_private) return true
        if (types.includes('mpim') && c.is_mpim) return true
        if (types.includes('im') && c.is_im) return true
        return false
      })
    }

    const limit = args?.limit ?? 100
    const sliced = channels.slice(0, limit)

    return {
      ok: true,
      channels: sliced,
      response_metadata: {
        next_cursor: channels.length > limit ? 'dXNlcjpVMDYxTkZUVDI=' : '',
      },
    }
  }

  private _handleConversationsInfo(args: ConversationsInfoArguments): ConversationsInfoResponse {
    const channel = state.channels.get(args.channel)
    if (!channel) {
      throw new SlackError('channel_not_found')
    }

    return {
      ok: true,
      channel,
    }
  }

  private _handleConversationsJoin(args: ConversationsJoinArguments): ConversationsJoinResponse {
    const channel = state.channels.get(args.channel)
    if (!channel) {
      throw new SlackError('channel_not_found')
    }

    if (channel.is_private && !channel.is_member) {
      throw new SlackError('channel_not_found', 'Cannot join private channel without invitation')
    }

    channel.is_member = true
    state.channels.set(channel.id, channel)

    return {
      ok: true,
      channel,
    }
  }

  private _handleConversationsLeave(args: ConversationsLeaveArguments): ConversationsLeaveResponse {
    const channel = state.channels.get(args.channel)
    if (!channel) {
      throw new SlackError('channel_not_found')
    }

    if (!channel.is_member) {
      throw new SlackError('not_in_channel')
    }

    channel.is_member = false
    state.channels.set(channel.id, channel)

    return {
      ok: true,
    }
  }

  private _handleConversationsArchive(args: ConversationsArchiveArguments): ConversationsArchiveResponse {
    const channel = state.channels.get(args.channel)
    if (!channel) {
      throw new SlackError('channel_not_found')
    }

    channel.is_archived = true
    state.channels.set(channel.id, channel)

    return {
      ok: true,
    }
  }

  private _handleConversationsUnarchive(args: ConversationsUnarchiveArguments): ConversationsUnarchiveResponse {
    const channel = state.channels.get(args.channel)
    if (!channel) {
      throw new SlackError('channel_not_found')
    }

    channel.is_archived = false
    state.channels.set(channel.id, channel)

    return {
      ok: true,
    }
  }

  private _handleConversationsInvite(args: ConversationsInviteArguments): ConversationsInviteResponse {
    const channel = state.channels.get(args.channel)
    if (!channel) {
      throw new SlackError('channel_not_found')
    }

    return {
      ok: true,
      channel,
    }
  }

  private _handleConversationsKick(args: ConversationsKickArguments): ConversationsKickResponse {
    const channel = state.channels.get(args.channel)
    if (!channel) {
      throw new SlackError('channel_not_found')
    }

    return {
      ok: true,
    }
  }

  private _handleConversationsMembers(args: ConversationsMembersArguments): ConversationsMembersResponse {
    const channel = state.channels.get(args.channel)
    if (!channel) {
      throw new SlackError('channel_not_found')
    }

    return {
      ok: true,
      members: ['U_BOT'],
      response_metadata: {
        next_cursor: '',
      },
    }
  }

  private _handleConversationsHistory(args: ConversationsHistoryArguments): ConversationsHistoryResponse {
    const channelMessages = state.messages.get(args.channel) ?? []

    return {
      ok: true,
      messages: channelMessages.slice(0, args.limit ?? 100),
      has_more: false,
    }
  }

  // Users handlers
  private _handleUsersInfo(args: UsersInfoArguments): UsersInfoResponse {
    const user = state.users.get(args.user)
    if (!user) {
      // Return a mock user for testing
      return {
        ok: true,
        user: {
          id: args.user,
          team_id: 'T1234567890',
          name: 'user',
          real_name: 'Test User',
          is_bot: false,
          is_admin: false,
          is_owner: false,
        },
      }
    }

    return {
      ok: true,
      user,
    }
  }

  private _handleUsersList(args?: UsersListArguments): UsersListResponse {
    return {
      ok: true,
      members: Array.from(state.users.values()),
      response_metadata: {
        next_cursor: '',
      },
    }
  }

  private _handleUsersLookupByEmail(args: UsersLookupByEmailArguments): UsersLookupByEmailResponse {
    for (const user of state.users.values()) {
      if (user.profile?.email === args.email) {
        return {
          ok: true,
          user,
        }
      }
    }

    throw new SlackError('users_not_found', `No user found with email: ${args.email}`)
  }
}

// =============================================================================
// Chat Methods
// =============================================================================

class ChatMethods {
  constructor(private client: WebClient) {}

  async postMessage(args: ChatPostMessageArguments): Promise<ChatPostMessageResponse> {
    return this.client._request('chat.postMessage', args)
  }

  async postEphemeral(args: ChatPostEphemeralArguments): Promise<ChatPostEphemeralResponse> {
    return this.client._request('chat.postEphemeral', args)
  }

  async update(args: ChatUpdateArguments): Promise<ChatUpdateResponse> {
    return this.client._request('chat.update', args)
  }

  async delete(args: ChatDeleteArguments): Promise<ChatDeleteResponse> {
    return this.client._request('chat.delete', args)
  }

  async scheduleMessage(args: ChatScheduleMessageArguments): Promise<ChatScheduleMessageResponse> {
    return this.client._request('chat.scheduleMessage', args)
  }
}

// =============================================================================
// Conversations Methods
// =============================================================================

class ConversationsMethods {
  constructor(private client: WebClient) {}

  async create(args: ConversationsCreateArguments): Promise<ConversationsCreateResponse> {
    return this.client._request('conversations.create', args)
  }

  async list(args?: ConversationsListArguments): Promise<ConversationsListResponse> {
    return this.client._request('conversations.list', args ?? {})
  }

  async info(args: ConversationsInfoArguments): Promise<ConversationsInfoResponse> {
    return this.client._request('conversations.info', args)
  }

  async join(args: ConversationsJoinArguments): Promise<ConversationsJoinResponse> {
    return this.client._request('conversations.join', args)
  }

  async leave(args: ConversationsLeaveArguments): Promise<ConversationsLeaveResponse> {
    return this.client._request('conversations.leave', args)
  }

  async archive(args: ConversationsArchiveArguments): Promise<ConversationsArchiveResponse> {
    return this.client._request('conversations.archive', args)
  }

  async unarchive(args: ConversationsUnarchiveArguments): Promise<ConversationsUnarchiveResponse> {
    return this.client._request('conversations.unarchive', args)
  }

  async invite(args: ConversationsInviteArguments): Promise<ConversationsInviteResponse> {
    return this.client._request('conversations.invite', args)
  }

  async kick(args: ConversationsKickArguments): Promise<ConversationsKickResponse> {
    return this.client._request('conversations.kick', args)
  }

  async members(args: ConversationsMembersArguments): Promise<ConversationsMembersResponse> {
    return this.client._request('conversations.members', args)
  }

  async history(args: ConversationsHistoryArguments): Promise<ConversationsHistoryResponse> {
    return this.client._request('conversations.history', args)
  }
}

// =============================================================================
// Users Methods
// =============================================================================

class UsersMethods {
  constructor(private client: WebClient) {}

  async info(args: UsersInfoArguments): Promise<UsersInfoResponse> {
    return this.client._request('users.info', args)
  }

  async list(args?: UsersListArguments): Promise<UsersListResponse> {
    return this.client._request('users.list', args ?? {})
  }

  async lookupByEmail(args: UsersLookupByEmailArguments): Promise<UsersLookupByEmailResponse> {
    return this.client._request('users.lookupByEmail', args)
  }
}

// =============================================================================
// App (Bot Framework)
// =============================================================================

type MessagePattern = string | RegExp
type EventType = string
type ActionPattern = string | RegExp
type ViewPattern = string | { callback_id: string; type?: 'view_submission' | 'view_closed' }
type ShortcutPattern = string | { callback_id: string; type?: 'shortcut' | 'message_action' }
type CommandPattern = string

interface MessageHandler {
  pattern: MessagePattern
  handler: Middleware<SlackEventMiddlewareArgs<MessageEvent>>
}

interface EventHandler {
  type: EventType
  handler: Middleware<SlackEventMiddlewareArgs>
}

interface ActionHandler {
  pattern: ActionPattern
  handler: Middleware<SlackActionMiddlewareArgs>
}

interface ViewHandler {
  pattern: ViewPattern
  handler: Middleware<SlackViewMiddlewareArgs>
}

interface ShortcutHandler {
  pattern: ShortcutPattern
  handler: Middleware<SlackShortcutMiddlewareArgs>
}

interface CommandHandler {
  command: CommandPattern
  handler: Middleware<SlackCommandMiddlewareArgs>
}

/**
 * Slack App - API-compatible with @slack/bolt
 */
export class App {
  private token?: string
  private signingSecret?: string
  private appToken?: string
  private _fetch: typeof fetch

  readonly client: WebClient

  private messageHandlers: MessageHandler[] = []
  private eventHandlers: EventHandler[] = []
  private actionHandlers: ActionHandler[] = []
  private viewHandlers: ViewHandler[] = []
  private viewClosedHandlers: ViewHandler[] = []
  private shortcutHandlers: ShortcutHandler[] = []
  private commandHandlers: CommandHandler[] = []
  private middleware: Middleware<any>[] = []
  private errorHandler?: (error: Error) => void

  constructor(options: AppOptions) {
    this.token = options.token
    this.signingSecret = options.signingSecret
    this.appToken = options.appToken
    this._fetch = options.fetch ?? globalThis.fetch?.bind(globalThis)

    this.client = new WebClient(this.token, {
      ...options.clientOptions,
      fetch: this._fetch,
    })
  }

  /**
   * Register global middleware
   */
  use(middleware: Middleware<any>): void {
    this.middleware.push(middleware)
  }

  /**
   * Register an error handler
   */
  error(handler: (error: Error) => void): void {
    this.errorHandler = handler
  }

  /**
   * Register a message handler
   */
  message(
    pattern: MessagePattern,
    handler: Middleware<SlackEventMiddlewareArgs<MessageEvent>>
  ): void {
    this.messageHandlers.push({ pattern, handler })
  }

  /**
   * Register an event handler
   */
  event(type: EventType, handler: Middleware<SlackEventMiddlewareArgs>): void {
    this.eventHandlers.push({ type, handler })
  }

  /**
   * Register an action handler
   */
  action(
    pattern: ActionPattern,
    handler: Middleware<SlackActionMiddlewareArgs>
  ): void {
    this.actionHandlers.push({ pattern, handler })
  }

  /**
   * Register a view handler
   */
  view(
    pattern: ViewPattern,
    handler: Middleware<SlackViewMiddlewareArgs>
  ): void {
    if (typeof pattern === 'object' && pattern.type === 'view_closed') {
      this.viewClosedHandlers.push({ pattern, handler })
    } else {
      this.viewHandlers.push({ pattern, handler })
    }
  }

  /**
   * Register a shortcut handler
   */
  shortcut(
    pattern: ShortcutPattern,
    handler: Middleware<SlackShortcutMiddlewareArgs>
  ): void {
    this.shortcutHandlers.push({ pattern, handler })
  }

  /**
   * Register a slash command handler
   */
  command(
    command: CommandPattern,
    handler: Middleware<SlackCommandMiddlewareArgs>
  ): void {
    this.commandHandlers.push({ command, handler })
  }

  /**
   * Handle an incoming event
   * @internal
   */
  async _handleEvent(body: EventCallbackBody): Promise<void> {
    const event = body.event

    // Create context
    const context: Context = {}

    // Create say function
    const say: SayFn = async (message) => {
      const channel = (event as any).channel
      if (!channel) {
        throw new Error('Cannot say without a channel')
      }

      if (typeof message === 'string') {
        return this.client.chat.postMessage({ channel, text: message })
      }
      return this.client.chat.postMessage({ ...message, channel })
    }

    // Create middleware args
    const args: SlackEventMiddlewareArgs = {
      payload: event,
      event,
      body,
      say,
      client: this.client,
      context,
      next: async () => {},
      ack: async () => {},
    }

    if (event.type === 'message') {
      args.message = event as MessageEvent
    }

    try {
      // Run global middleware
      let middlewareIndex = 0
      const runMiddleware = async (): Promise<boolean> => {
        if (middlewareIndex < this.middleware.length) {
          let nextCalled = false
          await this.middleware[middlewareIndex++]({
            ...args,
            next: async () => {
              nextCalled = true
              await runMiddleware()
            },
          })
          return nextCalled
        }
        return true
      }

      const shouldContinue = await runMiddleware()
      if (!shouldContinue && middlewareIndex > 0) {
        return // Middleware stopped processing
      }

      // Handle message events
      if (event.type === 'message') {
        const messageEvent = event as MessageEvent
        for (const { pattern, handler } of this.messageHandlers) {
          if (this.matchesPattern(messageEvent.text, pattern)) {
            await handler(args as SlackEventMiddlewareArgs<MessageEvent>)
          }
        }
      }

      // Handle other events
      for (const { type, handler } of this.eventHandlers) {
        if (event.type === type) {
          await handler(args)
        }
      }
    } catch (error) {
      if (this.errorHandler) {
        this.errorHandler(error as Error)
      } else {
        throw error
      }
    }
  }

  /**
   * Handle an incoming action
   * @internal
   */
  async _handleAction(
    body: BlockActionsPayload,
    ackFn?: () => void
  ): Promise<void> {
    const context: Context = {}

    const say: SayFn = async (message) => {
      const channel = body.channel?.id
      if (!channel) {
        throw new Error('Cannot say without a channel')
      }

      if (typeof message === 'string') {
        return this.client.chat.postMessage({ channel, text: message })
      }
      return this.client.chat.postMessage({ ...message, channel })
    }

    const ack: AckFn<void> = async () => {
      ackFn?.()
    }

    const respond: RespondFn = async (message) => {
      if (body.response_url) {
        const responseBody = typeof message === 'string' ? { text: message } : message
        await this._fetch(body.response_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(responseBody),
        })
      }
    }

    for (const action of body.actions) {
      const args: SlackActionMiddlewareArgs = {
        payload: action,
        action,
        body,
        respond,
        ack,
        say,
        client: this.client,
        context,
        next: async () => {},
      }

      for (const { pattern, handler } of this.actionHandlers) {
        if (this.matchesPattern(action.action_id, pattern)) {
          await handler(args)
        }
      }
    }
  }

  /**
   * Handle a view submission
   * @internal
   */
  async _handleViewSubmission(body: ViewSubmissionPayload): Promise<void> {
    const context: Context = {}

    const ack: AckFn<any> = async () => {}

    const args: SlackViewMiddlewareArgs = {
      payload: body.view,
      view: body.view,
      body,
      ack,
      client: this.client,
      context,
      next: async () => {},
    }

    for (const { pattern, handler } of this.viewHandlers) {
      const callbackId = typeof pattern === 'string' ? pattern : pattern.callback_id
      if (body.view.callback_id === callbackId) {
        await handler(args)
      }
    }
  }

  /**
   * Handle a view closed event
   * @internal
   */
  async _handleViewClosed(body: ViewClosedPayload): Promise<void> {
    const context: Context = {}

    const ack: AckFn<any> = async () => {}

    const args: SlackViewMiddlewareArgs = {
      payload: body.view,
      view: body.view,
      body,
      ack,
      client: this.client,
      context,
      next: async () => {},
    }

    for (const { pattern, handler } of this.viewClosedHandlers) {
      const callbackId = typeof pattern === 'object' ? pattern.callback_id : pattern
      if (body.view.callback_id === callbackId) {
        await handler(args)
      }
    }
  }

  /**
   * Handle a shortcut
   * @internal
   */
  async _handleShortcut(body: ShortcutPayload): Promise<void> {
    const context: Context = {}

    const ack: AckFn<void> = async () => {}

    const respond: RespondFn | undefined = 'response_url' in body
      ? async (message) => {
          const responseBody = typeof message === 'string' ? { text: message } : message
          await this._fetch(body.response_url!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(responseBody),
          })
        }
      : undefined

    const args: SlackShortcutMiddlewareArgs = {
      payload: body,
      shortcut: body,
      body,
      ack,
      respond,
      client: this.client,
      context,
      next: async () => {},
    }

    for (const { pattern, handler } of this.shortcutHandlers) {
      let matches = false

      if (typeof pattern === 'string') {
        matches = body.callback_id === pattern
      } else {
        matches = body.callback_id === pattern.callback_id
        if (pattern.type) {
          matches = matches && body.type === pattern.type
        }
      }

      if (matches) {
        await handler(args)
      }
    }
  }

  /**
   * Handle a slash command
   * @internal
   */
  async _handleCommand(
    body: SlashCommand,
    ackFn?: (response?: string | CommandResponse) => void
  ): Promise<void> {
    const context: Context = {}

    const say: SayFn = async (message) => {
      if (typeof message === 'string') {
        return this.client.chat.postMessage({ channel: body.channel_id, text: message })
      }
      return this.client.chat.postMessage({ ...message, channel: body.channel_id })
    }

    const ack: AckFn<string | CommandResponse | void> = async (response) => {
      ackFn?.(response)
    }

    const respond: RespondFn = async (message) => {
      const responseBody = typeof message === 'string' ? { text: message } : message
      await this._fetch(body.response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(responseBody),
      })
    }

    const args: SlackCommandMiddlewareArgs = {
      payload: body,
      command: body,
      body,
      ack,
      respond,
      say,
      client: this.client,
      context,
      next: async () => {},
    }

    for (const { command, handler } of this.commandHandlers) {
      if (body.command === command) {
        await handler(args)
      }
    }
  }

  /**
   * Check if text matches a pattern
   */
  private matchesPattern(text: string | undefined, pattern: string | RegExp): boolean {
    if (!text) return false

    if (typeof pattern === 'string') {
      return text.includes(pattern)
    }
    return pattern.test(text)
  }
}

// =============================================================================
// Request Signature Verification
// =============================================================================

/**
 * Generate a signature for testing
 */
export async function generateSignature(
  signingSecret: string,
  timestamp: string,
  body: string
): Promise<string> {
  const baseString = `v0:${timestamp}:${body}`

  const encoder = new TextEncoder()
  const keyData = encoder.encode(signingSecret)
  const messageData = encoder.encode(baseString)

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', key, messageData)
  const hexSignature = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `v0=${hexSignature}`
}

/**
 * Verify a Slack request signature
 */
export async function verifyRequestSignature(options: {
  signingSecret: string
  body: string
  headers: Record<string, string>
  maxAge?: number
}): Promise<boolean> {
  const { signingSecret, body, headers, maxAge = 300 } = options

  const timestamp = headers['x-slack-request-timestamp']
  const signature = headers['x-slack-signature']

  if (!timestamp || !signature) {
    return false
  }

  // Check timestamp is not too old
  const now = Math.floor(Date.now() / 1000)
  const requestTime = parseInt(timestamp, 10)
  if (Math.abs(now - requestTime) > maxAge) {
    return false
  }

  // Generate expected signature
  const expectedSignature = await generateSignature(signingSecret, timestamp, body)

  // Constant-time comparison
  if (signature.length !== expectedSignature.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i)
  }

  return result === 0
}

// =============================================================================
// Exports
// =============================================================================

export default WebClient
