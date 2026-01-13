/**
 * @dotdo/slack/bot - Slack Bot Framework
 *
 * Production-ready Slack bot framework with edge runtime support.
 * Follows Slack Bolt patterns with full type safety.
 *
 * @example Event Handling
 * ```typescript
 * import { SlackBot } from '@dotdo/slack/bot'
 *
 * const bot = new SlackBot({
 *   token: 'xoxb-token',
 *   signingSecret: 'signing-secret',
 * })
 *
 * // Handle messages
 * bot.message('hello', async ({ say }) => {
 *   await say('Hello back!')
 * })
 *
 * // Handle app mentions
 * bot.event('app_mention', async ({ event, say }) => {
 *   await say(`Hi <@${event.user}>!`)
 * })
 *
 * // Handle reactions
 * bot.event('reaction_added', async ({ event, client }) => {
 *   await client.chat.postMessage({
 *     channel: event.item.channel,
 *     text: `You reacted with :${event.reaction}:`,
 *   })
 * })
 * ```
 *
 * @example App Home
 * ```typescript
 * bot.event('app_home_opened', async ({ event, client }) => {
 *   await client.views.publish({
 *     user_id: event.user,
 *     view: {
 *       type: 'home',
 *       blocks: [
 *         { type: 'section', text: { type: 'mrkdwn', text: '*Welcome!*' } },
 *       ],
 *     },
 *   })
 * })
 * ```
 *
 * @example Socket Mode
 * ```typescript
 * const bot = new SlackBot({
 *   token: 'xoxb-token',
 *   appToken: 'xapp-token',
 *   socketMode: true,
 * })
 *
 * await bot.start()
 * ```
 *
 * @module @dotdo/slack/bot
 */

import type {
  BlockAction,
  BlockActionsPayload,
  ViewSubmissionPayload,
  ViewClosedPayload,
  ViewOutput,
  ViewState,
  ShortcutPayload,
  GlobalShortcutPayload,
  MessageShortcutPayload,
  SlashCommand,
  CommandResponse,
  RespondFn,
  AckFn,
  NextFn,
  Context,
  EventCallbackBody,
} from './types'

import type { Block } from './blocks'

import {
  WebClient,
  type ChatPostMessageArguments,
  type ChatPostMessageResponse,
} from './client'

import {
  WorkflowClient,
  WorkflowStep,
  type WorkflowEditArgs,
  type WorkflowSaveArgs,
  type WorkflowExecuteArgs,
  type WorkflowStepEditPayload,
  type WorkflowStepExecutePayload,
  type WorkflowStepOutput,
  type ConfigureFn,
  type UpdateFn,
  type CompleteFn,
  type FailFn,
} from './workflows'

// ============================================================================
// BOT TYPES
// ============================================================================

/**
 * Bot configuration options
 */
export interface SlackBotOptions {
  /** Bot token (xoxb-*) */
  token?: string
  /** Request signing secret for verification */
  signingSecret?: string
  /** App-level token for Socket Mode (xapp-*) */
  appToken?: string
  /** Enable Socket Mode for development */
  socketMode?: boolean
  /** OAuth client ID */
  clientId?: string
  /** OAuth client secret */
  clientSecret?: string
  /** OAuth state secret for security */
  stateSecret?: string
  /** OAuth redirect URI */
  redirectUri?: string
  /** Custom authorization function */
  authorize?: AuthorizeFn
  /** Ignore messages from the bot itself */
  ignoreSelf?: boolean
  /** Process events before ack (development mode) */
  processBeforeResponse?: boolean
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  /** Custom logger */
  logger?: Logger
}

/**
 * Logger interface
 */
export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/**
 * Authorization function type
 */
export type AuthorizeFn = (source: AuthorizeSourceData) => Promise<AuthorizeResult>

export interface AuthorizeSourceData {
  teamId?: string
  enterpriseId?: string
  userId?: string
  conversationId?: string
  isEnterpriseInstall?: boolean
}

export interface AuthorizeResult {
  botToken?: string
  botId?: string
  botUserId?: string
  userToken?: string
  teamId?: string
  enterpriseId?: string
}

/**
 * Bot user information
 */
export interface BotInfo {
  id: string
  userId: string
  name?: string
  teamId?: string
  enterpriseId?: string
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Base Slack event
 */
export interface SlackEvent {
  type: string
  event_ts?: string
  user?: string
  channel?: string
  ts?: string
}

/**
 * Message event
 */
export interface MessageEvent {
  type: 'message'
  text: string
  user: string
  channel: string
  ts: string
  thread_ts?: string
  subtype?: string
  blocks?: Block[]
  event_ts?: string
}

/**
 * App mention event
 */
export interface AppMentionEvent {
  type: 'app_mention'
  text: string
  user: string
  channel: string
  ts: string
  thread_ts?: string
  event_ts?: string
}

/**
 * Reaction added event
 */
export interface ReactionAddedEvent {
  type: 'reaction_added'
  user: string
  reaction: string
  item: {
    type: 'message' | 'file' | 'file_comment'
    channel?: string
    ts?: string
    file?: string
    file_comment?: string
  }
  item_user?: string
  event_ts: string
}

/**
 * Reaction removed event
 */
export interface ReactionRemovedEvent {
  type: 'reaction_removed'
  user: string
  reaction: string
  item: {
    type: 'message' | 'file' | 'file_comment'
    channel?: string
    ts?: string
    file?: string
    file_comment?: string
  }
  item_user?: string
  event_ts: string
}

/**
 * Member joined channel event
 */
export interface MemberJoinedChannelEvent {
  type: 'member_joined_channel'
  user: string
  channel: string
  channel_type: string
  team?: string
  inviter?: string
  event_ts?: string
}

/**
 * Member left channel event
 */
export interface MemberLeftChannelEvent {
  type: 'member_left_channel'
  user: string
  channel: string
  channel_type: string
  team?: string
  event_ts?: string
}

/**
 * Channel created event
 */
export interface ChannelCreatedEvent {
  type: 'channel_created'
  channel: {
    id: string
    name: string
    created: number
    creator: string
  }
  event_ts?: string
}

/**
 * App home opened event
 */
export interface AppHomeOpenedEvent {
  type: 'app_home_opened'
  user: string
  channel: string
  tab: 'home' | 'messages' | 'about'
  view?: ViewOutput
  event_ts: string
}

/**
 * Channel archive event
 */
export interface ChannelArchiveEvent {
  type: 'channel_archive'
  channel: string
  user?: string
  event_ts?: string
}

/**
 * Channel unarchive event
 */
export interface ChannelUnarchiveEvent {
  type: 'channel_unarchive'
  channel: string
  user?: string
  event_ts?: string
}

/**
 * Channel rename event
 */
export interface ChannelRenameEvent {
  type: 'channel_rename'
  channel: {
    id: string
    name: string
    created: number
  }
  event_ts?: string
}

/**
 * User profile
 */
export interface UserProfile {
  email?: string
  first_name?: string
  last_name?: string
  real_name?: string
  display_name?: string
  image_24?: string
  image_32?: string
  image_48?: string
  image_72?: string
  image_192?: string
  image_512?: string
  status_text?: string
  status_emoji?: string
}

/**
 * User object
 */
export interface User {
  id: string
  team_id: string
  name: string
  real_name?: string
  is_bot: boolean
  is_admin: boolean
  is_owner: boolean
  profile?: UserProfile
}

/**
 * User change event
 */
export interface UserChangeEvent {
  type: 'user_change'
  user: User
  event_ts?: string
}

/**
 * Team join event
 */
export interface TeamJoinEvent {
  type: 'team_join'
  user: User
  event_ts?: string
}

/**
 * File shared event
 */
export interface FileSharedEvent {
  type: 'file_shared'
  file_id: string
  user_id: string
  channel_id?: string
  event_ts: string
}

/**
 * Pin added event
 */
export interface PinAddedEvent {
  type: 'pin_added'
  user: string
  channel_id: string
  item: {
    type: 'message' | 'file' | 'file_comment'
    channel?: string
    ts?: string
    file?: string
    file_comment?: string
  }
  event_ts: string
}

/**
 * Pin removed event
 */
export interface PinRemovedEvent {
  type: 'pin_removed'
  user: string
  channel_id: string
  item: {
    type: 'message' | 'file' | 'file_comment'
    channel?: string
    ts?: string
    file?: string
    file_comment?: string
  }
  has_pins: boolean
  event_ts: string
}

/**
 * All supported event types
 */
export type BotEvent =
  | MessageEvent
  | AppMentionEvent
  | AppHomeOpenedEvent
  | ReactionAddedEvent
  | ReactionRemovedEvent
  | MemberJoinedChannelEvent
  | MemberLeftChannelEvent
  | ChannelCreatedEvent
  | ChannelArchiveEvent
  | ChannelUnarchiveEvent
  | ChannelRenameEvent
  | UserChangeEvent
  | TeamJoinEvent
  | FileSharedEvent
  | PinAddedEvent
  | PinRemovedEvent

/**
 * Event type string literals
 */
export type BotEventType = BotEvent['type']

// ============================================================================
// MIDDLEWARE ARGS
// ============================================================================

/**
 * Say function type (bot-local definition)
 */
export type SayFn = (
  message: string | Omit<ChatPostMessageArguments, 'channel'>
) => Promise<ChatPostMessageResponse>

/**
 * Base middleware arguments
 */
export interface BotMiddlewareArgs {
  client: WebClient
  context: BotContext
  next: NextFn
  logger: Logger
}

/**
 * Bot context with authorization info
 */
export interface BotContext extends Context {
  botToken?: string
  botUserId?: string
  botId?: string
  teamId?: string
  enterpriseId?: string
  isEnterpriseInstall?: boolean
  matches?: RegExpMatchArray
  retryNum?: number
  retryReason?: string
}

/**
 * Event middleware arguments
 */
export interface BotEventArgs<E = SlackEvent> extends BotMiddlewareArgs {
  payload: E
  event: E
  body: EventCallbackBody
  say: SayFn
  ack: AckFn<void>
}

/**
 * Message middleware arguments
 */
export interface BotMessageArgs extends BotMiddlewareArgs {
  payload: MessageEvent
  event: MessageEvent
  message: MessageEvent
  body: EventCallbackBody
  say: SayFn
  ack: AckFn<void>
}

/**
 * Action middleware arguments
 */
export interface BotActionArgs<A = BlockAction> extends BotMiddlewareArgs {
  payload: A
  action: A
  body: BlockActionsPayload
  respond: RespondFn
  ack: AckFn<void>
  say: SayFn
}

/**
 * View middleware arguments
 */
export interface BotViewArgs extends BotMiddlewareArgs {
  payload: ViewOutput
  view: ViewOutput
  body: ViewSubmissionPayload | ViewClosedPayload
  ack: AckFn<ViewAckResponse | void>
}

export interface ViewAckResponse {
  response_action?: 'errors' | 'update' | 'push' | 'clear'
  errors?: Record<string, string>
  view?: ViewOutput
}

/**
 * Shortcut middleware arguments
 */
export interface BotShortcutArgs extends BotMiddlewareArgs {
  payload: ShortcutPayload
  shortcut: ShortcutPayload
  body: ShortcutPayload
  ack: AckFn<void>
  respond?: RespondFn
}

/**
 * Command middleware arguments
 */
export interface BotCommandArgs extends BotMiddlewareArgs {
  payload: SlashCommand
  command: SlashCommand
  body: SlashCommand
  ack: AckFn<string | CommandResponse | void>
  respond: RespondFn
  say: SayFn
}

// ============================================================================
// HANDLER TYPES
// ============================================================================

type MessagePattern = string | RegExp
type EventFilter<E = unknown> = (event: E) => boolean
type ActionPattern = string | RegExp | { action_id?: string | RegExp; block_id?: string | RegExp }
type ViewPattern = string | RegExp | { callback_id: string | RegExp; type?: 'view_submission' | 'view_closed' }
type ShortcutPattern = string | RegExp | { callback_id: string | RegExp; type?: 'shortcut' | 'message_action' }
type CommandPattern = string | RegExp

interface MessageHandler {
  pattern: MessagePattern
  handler: (args: BotMessageArgs) => Promise<void>
}

interface EventHandler {
  type: string
  filter?: EventFilter<any>
  handler: (args: BotEventArgs<any>) => Promise<void>
}

interface ActionHandler {
  pattern: ActionPattern
  handler: (args: BotActionArgs) => Promise<void>
}

interface ViewHandler {
  pattern: ViewPattern
  handler: (args: BotViewArgs) => Promise<void>
}

interface ShortcutHandler {
  pattern: ShortcutPattern
  handler: (args: BotShortcutArgs) => Promise<void>
}

interface CommandHandler {
  pattern: CommandPattern
  handler: (args: BotCommandArgs) => Promise<void>
}

// ============================================================================
// EXTENDED WEBCLIENT WITH VIEWS
// ============================================================================

/**
 * Views API methods
 */
export interface ViewsMethods {
  open(args: ViewsOpenArguments): Promise<ViewsOpenResponse>
  push(args: ViewsPushArguments): Promise<ViewsPushResponse>
  update(args: ViewsUpdateArguments): Promise<ViewsUpdateResponse>
  publish(args: ViewsPublishArguments): Promise<ViewsPublishResponse>
}

export interface ViewsOpenArguments {
  trigger_id: string
  view: ModalView
}

export interface ViewsPushArguments {
  trigger_id: string
  view: ModalView
}

export interface ViewsUpdateArguments {
  view_id?: string
  external_id?: string
  hash?: string
  view: ModalView
}

export interface ViewsPublishArguments {
  user_id: string
  view: HomeView
  hash?: string
}

export interface ModalView {
  type: 'modal'
  title: { type: 'plain_text'; text: string; emoji?: boolean }
  blocks: Block[]
  close?: { type: 'plain_text'; text: string; emoji?: boolean }
  submit?: { type: 'plain_text'; text: string; emoji?: boolean }
  private_metadata?: string
  callback_id?: string
  clear_on_close?: boolean
  notify_on_close?: boolean
  external_id?: string
}

export interface HomeView {
  type: 'home'
  blocks: Block[]
  private_metadata?: string
  callback_id?: string
  external_id?: string
}

export interface ViewsOpenResponse {
  ok: boolean
  view?: ViewOutput
  error?: string
}

export interface ViewsPushResponse {
  ok: boolean
  view?: ViewOutput
  error?: string
}

export interface ViewsUpdateResponse {
  ok: boolean
  view?: ViewOutput
  error?: string
}

export interface ViewsPublishResponse {
  ok: boolean
  view?: ViewOutput
  error?: string
}

/**
 * Reactions API methods
 */
export interface ReactionsMethods {
  add(args: ReactionsAddArguments): Promise<ReactionsResponse>
  remove(args: ReactionsRemoveArguments): Promise<ReactionsResponse>
  get(args: ReactionsGetArguments): Promise<ReactionsGetResponse>
  list(args: ReactionsListArguments): Promise<ReactionsListResponse>
}

export interface ReactionsAddArguments {
  channel: string
  timestamp: string
  name: string
}

export interface ReactionsRemoveArguments {
  channel: string
  timestamp: string
  name: string
}

export interface ReactionsGetArguments {
  channel?: string
  timestamp?: string
  file?: string
  file_comment?: string
  full?: boolean
}

export interface ReactionsListArguments {
  user?: string
  count?: number
  page?: number
  full?: boolean
  cursor?: string
  limit?: number
  team_id?: string
}

export interface ReactionsResponse {
  ok: boolean
  error?: string
}

export interface ReactionsGetResponse extends ReactionsResponse {
  type?: string
  message?: {
    type: string
    text: string
    ts: string
    reactions?: ReactionItem[]
  }
}

export interface ReactionsListResponse extends ReactionsResponse {
  items?: Array<{
    type: string
    channel?: string
    message?: {
      type: string
      text: string
      ts: string
      reactions?: ReactionItem[]
    }
  }>
  response_metadata?: { next_cursor?: string }
}

export interface ReactionItem {
  name: string
  count: number
  users: string[]
}

/**
 * Auth API methods
 */
export interface AuthMethods {
  test(): Promise<AuthTestResponse>
  revoke(args?: AuthRevokeArguments): Promise<AuthRevokeResponse>
}

export interface AuthTestResponse {
  ok: boolean
  url?: string
  team?: string
  user?: string
  team_id?: string
  user_id?: string
  bot_id?: string
  is_enterprise_install?: boolean
  error?: string
}

export interface AuthRevokeArguments {
  test?: boolean
}

export interface AuthRevokeResponse {
  ok: boolean
  revoked?: boolean
  error?: string
}

/**
 * Extended WebClient for bot use
 * Inherits reactions from parent WebClient
 */
export class BotWebClient extends WebClient {
  readonly views: ViewsMethods
  readonly auth: AuthMethods

  constructor(token?: string, options?: { fetch?: typeof fetch }) {
    super(token, options)

    this.views = {
      open: (args) => this._apiCall('views.open', args),
      push: (args) => this._apiCall('views.push', args),
      update: (args) => this._apiCall('views.update', args),
      publish: (args) => this._apiCall('views.publish', args),
    }

    // reactions is inherited from parent WebClient class

    this.auth = {
      test: () => this._apiCall('auth.test', {}),
      revoke: (args) => this._apiCall('auth.revoke', args ?? {}),
    }
  }
}

// ============================================================================
// OAUTH HELPERS
// ============================================================================

/**
 * OAuth configuration
 */
export interface OAuthConfig {
  clientId: string
  clientSecret: string
  stateSecret?: string
  scopes: string[]
  userScopes?: string[]
  redirectUri?: string
  installPath?: string
  redirectUriPath?: string
  installationStore?: InstallationStore
  stateStore?: StateStore
}

/**
 * Installation store interface
 */
export interface InstallationStore {
  storeInstallation(installation: Installation): Promise<void>
  fetchInstallation(query: InstallationQuery): Promise<Installation | undefined>
  deleteInstallation?(query: InstallationQuery): Promise<void>
}

/**
 * State store interface
 */
export interface StateStore {
  generateStateParam(installOptions: InstallUrlOptions): Promise<string>
  verifyStateParam(now: Date, state: string): Promise<InstallUrlOptions>
}

/**
 * Installation data
 */
export interface Installation {
  team?: { id: string; name?: string }
  enterprise?: { id: string; name?: string }
  user: { token?: string; scopes?: string[]; id: string }
  bot?: { token: string; scopes: string[]; id: string; userId: string }
  incomingWebhook?: {
    channel?: string
    channelId?: string
    configurationUrl?: string
    url: string
  }
  appId?: string
  tokenType?: 'bot' | 'user'
  isEnterpriseInstall?: boolean
}

/**
 * Installation query
 */
export interface InstallationQuery {
  teamId?: string
  enterpriseId?: string
  userId?: string
  isEnterpriseInstall?: boolean
}

/**
 * Install URL options
 */
export interface InstallUrlOptions {
  scopes: string[]
  teamId?: string
  redirectUri?: string
  userScopes?: string[]
  metadata?: string
}

/**
 * OAuth flow helper
 */
export class OAuthFlow {
  private clientId: string
  private clientSecret: string
  private stateSecret: string
  private scopes: string[]
  private userScopes: string[]
  private redirectUri?: string
  private installationStore?: InstallationStore
  private stateStore?: StateStore
  private _fetch: typeof fetch

  constructor(config: OAuthConfig, fetchFn?: typeof fetch) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.stateSecret = config.stateSecret ?? this.generateSecret()
    this.scopes = config.scopes
    this.userScopes = config.userScopes ?? []
    this.redirectUri = config.redirectUri
    this.installationStore = config.installationStore
    this.stateStore = config.stateStore
    this._fetch = fetchFn ?? globalThis.fetch
  }

  /**
   * Generate install URL
   */
  async generateInstallUrl(options?: Partial<InstallUrlOptions>): Promise<string> {
    const state = await this.generateState(options)
    const scopes = options?.scopes ?? this.scopes
    const userScopes = options?.userScopes ?? this.userScopes

    const params = new URLSearchParams({
      client_id: this.clientId,
      scope: scopes.join(','),
      state,
    })

    if (userScopes.length > 0) {
      params.set('user_scope', userScopes.join(','))
    }

    if (options?.redirectUri ?? this.redirectUri) {
      params.set('redirect_uri', options?.redirectUri ?? this.redirectUri!)
    }

    if (options?.teamId) {
      params.set('team', options.teamId)
    }

    return `https://slack.com/oauth/v2/authorize?${params.toString()}`
  }

  /**
   * Handle OAuth callback
   */
  async handleCallback(code: string, state: string): Promise<Installation> {
    // Verify state
    await this.verifyState(state)

    // Exchange code for token
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
    })

    if (this.redirectUri) {
      params.set('redirect_uri', this.redirectUri)
    }

    const response = await this._fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })

    const data = await response.json() as OAuthAccessResponse

    if (!data.ok) {
      throw new OAuthError(data.error ?? 'unknown_error', 'OAuth exchange failed')
    }

    const installation: Installation = {
      team: data.team ? { id: data.team.id, name: data.team.name } : undefined,
      enterprise: data.enterprise ? { id: data.enterprise.id, name: data.enterprise.name } : undefined,
      user: {
        id: data.authed_user.id,
        token: data.authed_user.access_token,
        scopes: data.authed_user.scope?.split(','),
      },
      bot: data.access_token ? {
        token: data.access_token,
        scopes: data.scope?.split(',') ?? [],
        id: data.bot_user_id ?? '',
        userId: data.bot_user_id ?? '',
      } : undefined,
      incomingWebhook: data.incoming_webhook ? {
        url: data.incoming_webhook.url,
        channel: data.incoming_webhook.channel,
        channelId: data.incoming_webhook.channel_id,
        configurationUrl: data.incoming_webhook.configuration_url,
      } : undefined,
      appId: data.app_id,
      isEnterpriseInstall: data.is_enterprise_install,
    }

    // Store installation
    if (this.installationStore) {
      await this.installationStore.storeInstallation(installation)
    }

    return installation
  }

  private async generateState(options?: Partial<InstallUrlOptions>): Promise<string> {
    if (this.stateStore) {
      return this.stateStore.generateStateParam({
        scopes: options?.scopes ?? this.scopes,
        ...options,
      })
    }

    // Default: encode options with signature
    const payload = JSON.stringify({
      ...options,
      ts: Date.now(),
    })

    const signature = await this.sign(payload)
    return Buffer.from(`${payload}.${signature}`).toString('base64url')
  }

  private async verifyState(state: string): Promise<InstallUrlOptions> {
    if (this.stateStore) {
      return this.stateStore.verifyStateParam(new Date(), state)
    }

    // Default: decode and verify signature
    try {
      const decoded = Buffer.from(state, 'base64url').toString()
      const [payload, signature] = decoded.split('.')

      const expectedSignature = await this.sign(payload)
      if (signature !== expectedSignature) {
        throw new OAuthError('invalid_state', 'State signature mismatch')
      }

      const data = JSON.parse(payload)

      // Check timestamp (15 minutes expiry)
      if (Date.now() - data.ts > 15 * 60 * 1000) {
        throw new OAuthError('state_expired', 'OAuth state expired')
      }

      return data
    } catch (error) {
      if (error instanceof OAuthError) throw error
      throw new OAuthError('invalid_state', 'Failed to decode state')
    }
  }

  private async sign(data: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.stateSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
    return Buffer.from(signature).toString('base64url')
  }

  private generateSecret(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    return Buffer.from(bytes).toString('base64url')
  }
}

interface OAuthAccessResponse {
  ok: boolean
  error?: string
  access_token?: string
  token_type?: string
  scope?: string
  bot_user_id?: string
  app_id?: string
  team?: { id: string; name: string }
  enterprise?: { id: string; name: string }
  authed_user: {
    id: string
    scope?: string
    access_token?: string
    token_type?: string
  }
  incoming_webhook?: {
    channel: string
    channel_id: string
    configuration_url: string
    url: string
  }
  is_enterprise_install?: boolean
}

/**
 * OAuth error
 */
export class OAuthError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'OAuthError'
    this.code = code
  }
}

// ============================================================================
// SOCKET MODE
// ============================================================================

/**
 * Socket mode client for development
 */
export class SocketModeClient {
  private appToken: string
  private ws: WebSocket | null = null
  private _fetch: typeof fetch
  private messageHandler?: (event: SocketModeEvent) => Promise<void>
  private connected = false
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 1000
  private logger: Logger
  private pingInterval?: ReturnType<typeof setInterval>

  constructor(options: { appToken: string; fetch?: typeof fetch; logger?: Logger }) {
    this.appToken = options.appToken
    this._fetch = options.fetch ?? globalThis.fetch
    this.logger = options.logger ?? console
  }

  /**
   * Connect to Slack via WebSocket
   */
  async connect(): Promise<void> {
    if (this.connected) return

    // Get WebSocket URL
    const response = await this._fetch('https://slack.com/api/apps.connections.open', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.appToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    const data = await response.json() as { ok: boolean; url?: string; error?: string }

    if (!data.ok || !data.url) {
      throw new Error(`Failed to get WebSocket URL: ${data.error}`)
    }

    this.logger.info(`Connecting to Socket Mode: ${data.url}`)

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(data.url!)

      this.ws.onopen = () => {
        this.connected = true
        this.reconnectAttempts = 0
        this.logger.info('Socket Mode connected')

        // Start ping interval
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping' }))
          }
        }, 30000)

        resolve()
      }

      this.ws.onclose = (event) => {
        this.connected = false
        this.logger.warn(`Socket Mode disconnected: ${event.code} ${event.reason}`)

        if (this.pingInterval) {
          clearInterval(this.pingInterval)
        }

        // Attempt reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++
          const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
          this.logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)
          setTimeout(() => this.connect(), delay)
        }
      }

      this.ws.onerror = (error) => {
        this.logger.error('Socket Mode error:', error)
        reject(error)
      }

      this.ws.onmessage = async (message) => {
        try {
          const event = JSON.parse(message.data as string) as SocketModeEvent

          // Handle hello
          if (event.type === 'hello') {
            this.logger.debug('Received hello from Slack')
            return
          }

          // Handle disconnect
          if (event.type === 'disconnect') {
            this.logger.info('Received disconnect from Slack')
            this.ws?.close()
            return
          }

          // Acknowledge the event
          if (event.envelope_id) {
            this.ws?.send(JSON.stringify({
              envelope_id: event.envelope_id,
            }))
          }

          // Process the event
          if (this.messageHandler) {
            await this.messageHandler(event)
          }
        } catch (error) {
          this.logger.error('Error processing Socket Mode message:', error)
        }
      }
    })
  }

  /**
   * Disconnect from Slack
   */
  disconnect(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    this.connected = false
  }

  /**
   * Set message handler
   */
  onMessage(handler: (event: SocketModeEvent) => Promise<void>): void {
    this.messageHandler = handler
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected
  }
}

export interface SocketModeEvent {
  type: string
  envelope_id?: string
  payload?: EventCallbackBody | BlockActionsPayload | ViewSubmissionPayload | ViewClosedPayload | ShortcutPayload | SlashCommand
  accepts_response_payload?: boolean
  retry_attempt?: number
  retry_reason?: string
}

// ============================================================================
// SLACK BOT
// ============================================================================

/**
 * Main Slack Bot class
 */
export class SlackBot {
  private token?: string
  private signingSecret?: string
  private appToken?: string
  private socketMode: boolean
  private _fetch: typeof fetch
  private logger: Logger
  private authorize?: AuthorizeFn
  private ignoreSelf: boolean
  private processBeforeResponse: boolean

  readonly client: BotWebClient
  readonly workflows: WorkflowClient
  private socketModeClient?: SocketModeClient
  private oauthFlow?: OAuthFlow

  private messageHandlers: MessageHandler[] = []
  private eventHandlers: EventHandler[] = []
  private actionHandlers: ActionHandler[] = []
  private viewHandlers: ViewHandler[] = []
  private shortcutHandlers: ShortcutHandler[] = []
  private commandHandlers: CommandHandler[] = []
  private stepHandlers: Map<string, WorkflowStep> = new Map()
  private middleware: Array<(args: BotMiddlewareArgs & { body: unknown }) => Promise<void>> = []
  private errorHandler?: (error: Error, context?: BotContext) => Promise<void>

  private botInfo?: BotInfo

  constructor(options: SlackBotOptions) {
    this.token = options.token
    this.signingSecret = options.signingSecret
    this.appToken = options.appToken
    this.socketMode = options.socketMode ?? false
    this._fetch = options.fetch ?? globalThis.fetch
    this.authorize = options.authorize
    this.ignoreSelf = options.ignoreSelf ?? true
    this.processBeforeResponse = options.processBeforeResponse ?? false

    this.logger = options.logger ?? {
      debug: (...args) => options.logLevel === 'debug' && console.debug('[SlackBot]', ...args),
      info: (...args) => ['debug', 'info'].includes(options.logLevel ?? 'info') && console.info('[SlackBot]', ...args),
      warn: (...args) => ['debug', 'info', 'warn'].includes(options.logLevel ?? 'info') && console.warn('[SlackBot]', ...args),
      error: (...args) => console.error('[SlackBot]', ...args),
    }

    this.client = new BotWebClient(this.token, { fetch: this._fetch })
    this.workflows = new WorkflowClient(this.token ?? '', { fetch: this._fetch })

    // Setup OAuth if configured
    if (options.clientId && options.clientSecret) {
      this.oauthFlow = new OAuthFlow({
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        stateSecret: options.stateSecret,
        scopes: [], // Will be configured separately
        redirectUri: options.redirectUri,
      }, this._fetch)
    }

    // Setup Socket Mode if configured
    if (this.socketMode && this.appToken) {
      this.socketModeClient = new SocketModeClient({
        appToken: this.appToken,
        fetch: this._fetch,
        logger: this.logger,
      })
    }
  }

  // ============================================================================
  // REGISTRATION METHODS
  // ============================================================================

  /**
   * Register global middleware
   */
  use(middleware: (args: BotMiddlewareArgs & { body: unknown }) => Promise<void>): this {
    this.middleware.push(middleware)
    return this
  }

  /**
   * Register error handler
   */
  error(handler: (error: Error, context?: BotContext) => Promise<void>): this {
    this.errorHandler = handler
    return this
  }

  /**
   * Register message handler
   */
  message(pattern: MessagePattern, handler: (args: BotMessageArgs) => Promise<void>): this
  message(handler: (args: BotMessageArgs) => Promise<void>): this
  message(
    patternOrHandler: MessagePattern | ((args: BotMessageArgs) => Promise<void>),
    handler?: (args: BotMessageArgs) => Promise<void>
  ): this {
    if (typeof patternOrHandler === 'function') {
      this.messageHandlers.push({ pattern: /.*/, handler: patternOrHandler })
    } else {
      this.messageHandlers.push({ pattern: patternOrHandler, handler: handler! })
    }
    return this
  }

  /**
   * Register event handler
   */
  event<E extends BotEvent>(
    type: E['type'],
    handler: (args: BotEventArgs<E>) => Promise<void>
  ): this
  event<E extends BotEvent>(
    type: E['type'],
    filter: EventFilter<E>,
    handler: (args: BotEventArgs<E>) => Promise<void>
  ): this
  event<E extends BotEvent>(
    type: E['type'],
    filterOrHandler: EventFilter<E> | ((args: BotEventArgs<E>) => Promise<void>),
    handler?: (args: BotEventArgs<E>) => Promise<void>
  ): this {
    if (typeof filterOrHandler === 'function' && handler === undefined) {
      this.eventHandlers.push({
        type,
        handler: filterOrHandler as (args: BotEventArgs<E>) => Promise<void>,
      })
    } else {
      this.eventHandlers.push({
        type,
        filter: filterOrHandler as EventFilter<E>,
        handler: handler!,
      })
    }
    return this
  }

  /**
   * Register action handler
   */
  action(pattern: ActionPattern, handler: (args: BotActionArgs) => Promise<void>): this {
    this.actionHandlers.push({ pattern, handler })
    return this
  }

  /**
   * Register view handler
   */
  view(pattern: ViewPattern, handler: (args: BotViewArgs) => Promise<void>): this {
    this.viewHandlers.push({ pattern, handler })
    return this
  }

  /**
   * Register shortcut handler
   */
  shortcut(pattern: ShortcutPattern, handler: (args: BotShortcutArgs) => Promise<void>): this {
    this.shortcutHandlers.push({ pattern, handler })
    return this
  }

  /**
   * Register command handler
   */
  command(pattern: CommandPattern, handler: (args: BotCommandArgs) => Promise<void>): this {
    this.commandHandlers.push({ pattern, handler })
    return this
  }

  /**
   * Register a custom workflow step
   */
  step(workflowStep: WorkflowStep): this {
    this.stepHandlers.set(workflowStep.callbackId, workflowStep)
    return this
  }

  // ============================================================================
  // LIFECYCLE METHODS
  // ============================================================================

  /**
   * Start the bot (Socket Mode only)
   */
  async start(): Promise<void> {
    if (!this.socketMode) {
      throw new Error('start() is only available in Socket Mode. Use handleRequest() for HTTP mode.')
    }

    if (!this.socketModeClient) {
      throw new Error('Socket Mode client not configured. Provide appToken in options.')
    }

    // Fetch bot info
    await this.fetchBotInfo()

    // Setup message handler
    this.socketModeClient.onMessage(async (event) => {
      await this.handleSocketModeEvent(event)
    })

    // Connect
    await this.socketModeClient.connect()
  }

  /**
   * Stop the bot (Socket Mode only)
   */
  stop(): void {
    if (this.socketModeClient) {
      this.socketModeClient.disconnect()
    }
  }

  /**
   * Handle incoming HTTP request (HTTP mode)
   */
  async handleRequest(request: Request): Promise<Response> {
    const body = await request.text()

    // Verify signature
    if (this.signingSecret) {
      const timestamp = request.headers.get('x-slack-request-timestamp')
      const signature = request.headers.get('x-slack-signature')

      if (!timestamp || !signature) {
        return new Response('Missing signature headers', { status: 401 })
      }

      const isValid = await this.verifySignature(body, timestamp, signature)
      if (!isValid) {
        return new Response('Invalid signature', { status: 401 })
      }
    }

    // Parse body
    const contentType = request.headers.get('content-type') ?? ''
    let payload: unknown

    if (contentType.includes('application/json')) {
      payload = JSON.parse(body)
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(body)
      const payloadString = params.get('payload')
      if (payloadString) {
        payload = JSON.parse(payloadString)
      } else {
        // Slash command
        payload = Object.fromEntries(params)
      }
    } else {
      return new Response('Unsupported content type', { status: 400 })
    }

    // Handle URL verification
    if ((payload as any).type === 'url_verification') {
      return new Response(JSON.stringify({ challenge: (payload as any).challenge }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Process event
    try {
      const response = await this.processPayload(payload)
      return new Response(response ? JSON.stringify(response) : '', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      this.logger.error('Error processing request:', error)
      return new Response('Internal server error', { status: 500 })
    }
  }

  /**
   * Get bot info
   */
  getBotInfo(): BotInfo | undefined {
    return this.botInfo
  }

  /**
   * Get OAuth flow helper
   */
  getOAuthFlow(): OAuthFlow | undefined {
    return this.oauthFlow
  }

  // ============================================================================
  // INTERNAL METHODS
  // ============================================================================

  private async fetchBotInfo(): Promise<void> {
    if (!this.token) return

    try {
      const result = await this.client.auth.test()
      if (result.ok) {
        this.botInfo = {
          id: result.bot_id ?? '',
          userId: result.user_id ?? '',
          name: result.user,
          teamId: result.team_id,
        }
        this.logger.info(`Bot info: ${this.botInfo.name} (${this.botInfo.userId})`)
      }
    } catch (error) {
      this.logger.warn('Failed to fetch bot info:', error)
    }
  }

  private async handleSocketModeEvent(event: SocketModeEvent): Promise<void> {
    if (!event.payload) return

    const context: BotContext = {
      retryNum: event.retry_attempt,
      retryReason: event.retry_reason,
    }

    await this.processPayload(event.payload, context)
  }

  private async processPayload(payload: unknown, context: BotContext = {}): Promise<unknown> {
    const payloadType = (payload as any).type

    try {
      // Run authorization if needed
      if (this.authorize) {
        const authResult = await this.authorize({
          teamId: (payload as any).team_id ?? (payload as any).team?.id,
          enterpriseId: (payload as any).enterprise_id ?? (payload as any).enterprise?.id,
          userId: (payload as any).user_id ?? (payload as any).user?.id,
        })
        Object.assign(context, authResult)
      } else if (this.token) {
        context.botToken = this.token
      }

      // Process by type
      switch (payloadType) {
        case 'event_callback':
          await this.handleEventCallback(payload as EventCallbackBody, context)
          break
        case 'block_actions':
          return await this.handleBlockActions(payload as BlockActionsPayload, context)
        case 'view_submission':
          // Check if this is a workflow step save
          if (await this.handleWorkflowStepSave(payload as ViewSubmissionPayload, context)) {
            return
          }
          return await this.handleViewSubmission(payload as ViewSubmissionPayload, context)
        case 'view_closed':
          await this.handleViewClosed(payload as ViewClosedPayload, context)
          break
        case 'workflow_step_edit':
          await this.handleWorkflowStepEdit(payload as WorkflowStepEditPayload, context)
          break
        case 'shortcut':
        case 'message_action':
          await this.handleShortcut(payload as ShortcutPayload, context)
          break
        default:
          // Check if it's a slash command (has command property)
          if ((payload as any).command) {
            return await this.handleCommand(payload as SlashCommand, context)
          }
          this.logger.warn(`Unknown payload type: ${payloadType}`)
      }
    } catch (error) {
      if (this.errorHandler) {
        await this.errorHandler(error as Error, context)
      } else {
        throw error
      }
    }
  }

  private async handleEventCallback(body: EventCallbackBody, context: BotContext): Promise<void> {
    const event = body.event as SlackEvent

    // Ignore self messages if configured
    if (this.ignoreSelf && this.botInfo && event.user === this.botInfo.userId) {
      return
    }

    // Set context from authorizations
    if (body.authorizations && body.authorizations.length > 0) {
      const auth = body.authorizations[0]
      context.teamId = auth.team_id
      context.enterpriseId = auth.enterprise_id
      context.isEnterpriseInstall = auth.is_enterprise_install
    }

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

    const baseArgs = {
      body,
      say,
      ack: async () => {},
      client: this.client,
      context,
      next: async () => {},
      logger: this.logger,
    }

    // Run middleware
    await this.runMiddleware({ ...baseArgs, body })

    // Handle message events
    if (event.type === 'message' && !(event as any).subtype) {
      const messageEvent = event as unknown as MessageEvent
      const messageArgs: BotMessageArgs = {
        ...baseArgs,
        payload: messageEvent,
        event: messageEvent,
        message: messageEvent,
      }

      for (const { pattern, handler } of this.messageHandlers) {
        const matches = this.matchPattern(messageEvent.text, pattern)
        if (matches) {
          context.matches = matches instanceof Array ? matches : undefined
          await handler(messageArgs)
        }
      }
    }

    // Handle workflow step execute events
    if (event.type === 'workflow_step_execute') {
      await this.handleWorkflowStepExecute(event as unknown as WorkflowStepExecutePayload['event'], context)
      return
    }

    // Handle other events
    for (const { type, filter, handler } of this.eventHandlers) {
      if (event.type === type) {
        if (filter && !filter(event)) continue
        const eventArgs: BotEventArgs = {
          ...baseArgs,
          payload: event,
          event,
        }
        await handler(eventArgs)
      }
    }
  }

  private async handleBlockActions(body: BlockActionsPayload, context: BotContext): Promise<unknown> {
    let ackResponse: unknown

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

    const ack: AckFn<void> = async (response) => {
      ackResponse = response
    }

    for (const action of body.actions) {
      const args: BotActionArgs = {
        payload: action,
        action,
        body,
        respond,
        ack,
        say,
        client: this.client,
        context,
        next: async () => {},
        logger: this.logger,
      }

      // Run middleware
      await this.runMiddleware({ ...args, body })

      for (const { pattern, handler } of this.actionHandlers) {
        if (this.matchActionPattern(action, pattern)) {
          await handler(args)
        }
      }
    }

    return ackResponse
  }

  private async handleViewSubmission(body: ViewSubmissionPayload, context: BotContext): Promise<unknown> {
    let ackResponse: unknown

    const ack: AckFn<ViewAckResponse | void> = async (response) => {
      ackResponse = response
    }

    const args: BotViewArgs = {
      payload: body.view,
      view: body.view,
      body,
      ack,
      client: this.client,
      context,
      next: async () => {},
      logger: this.logger,
    }

    // Run middleware
    await this.runMiddleware({ ...args, body })

    for (const { pattern, handler } of this.viewHandlers) {
      if (this.matchViewPattern(body.view.callback_id, pattern, 'view_submission')) {
        await handler(args)
      }
    }

    return ackResponse
  }

  private async handleViewClosed(body: ViewClosedPayload, context: BotContext): Promise<void> {
    const ack: AckFn<void> = async () => {}

    const args: BotViewArgs = {
      payload: body.view,
      view: body.view,
      body,
      ack,
      client: this.client,
      context,
      next: async () => {},
      logger: this.logger,
    }

    // Run middleware
    await this.runMiddleware({ ...args, body })

    for (const { pattern, handler } of this.viewHandlers) {
      if (this.matchViewPattern(body.view.callback_id, pattern, 'view_closed')) {
        await handler(args)
      }
    }
  }

  private async handleShortcut(body: ShortcutPayload, context: BotContext): Promise<void> {
    const ack: AckFn<void> = async () => {}

    const respond: RespondFn | undefined = 'response_url' in body
      ? async (message) => {
          const responseBody = typeof message === 'string' ? { text: message } : message
          await this._fetch((body as MessageShortcutPayload).response_url!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(responseBody),
          })
        }
      : undefined

    const args: BotShortcutArgs = {
      payload: body,
      shortcut: body,
      body,
      ack,
      respond,
      client: this.client,
      context,
      next: async () => {},
      logger: this.logger,
    }

    // Run middleware
    await this.runMiddleware({ ...args, body })

    for (const { pattern, handler } of this.shortcutHandlers) {
      if (this.matchShortcutPattern(body, pattern)) {
        await handler(args)
      }
    }
  }

  private async handleCommand(body: SlashCommand, context: BotContext): Promise<unknown> {
    let ackResponse: unknown

    const say: SayFn = async (message) => {
      if (typeof message === 'string') {
        return this.client.chat.postMessage({ channel: body.channel_id, text: message })
      }
      return this.client.chat.postMessage({ ...message, channel: body.channel_id })
    }

    const respond: RespondFn = async (message) => {
      const responseBody = typeof message === 'string' ? { text: message } : message
      await this._fetch(body.response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(responseBody),
      })
    }

    const ack: AckFn<string | CommandResponse | void> = async (response) => {
      ackResponse = response
    }

    const args: BotCommandArgs = {
      payload: body,
      command: body,
      body,
      ack,
      respond,
      say,
      client: this.client,
      context,
      next: async () => {},
      logger: this.logger,
    }

    // Run middleware
    await this.runMiddleware({ ...args, body })

    for (const { pattern, handler } of this.commandHandlers) {
      if (this.matchCommandPattern(body.command, pattern)) {
        await handler(args)
      }
    }

    return ackResponse
  }

  // ============================================================================
  // WORKFLOW STEP HANDLERS
  // ============================================================================

  /**
   * Handle workflow_step_edit event (opening the step configuration modal)
   */
  private async handleWorkflowStepEdit(payload: WorkflowStepEditPayload, context: BotContext): Promise<void> {
    const stepHandler = this.stepHandlers.get(payload.callback_id)
    if (!stepHandler) {
      this.logger.warn(`No handler for workflow step: ${payload.callback_id}`)
      return
    }

    const ack = async () => {}

    const configure: ConfigureFn = async (config) => {
      // Open a modal with the configuration blocks
      await this.client.views.open({
        trigger_id: payload.trigger_id,
        view: {
          type: 'modal',
          callback_id: payload.callback_id,
          title: { type: 'plain_text', text: 'Configure step' },
          blocks: config.blocks,
          submit: { type: 'plain_text', text: 'Save' },
          close: { type: 'plain_text', text: 'Cancel' },
          private_metadata: JSON.stringify({
            workflow_step_edit_id: payload.workflow_step.workflow_step_edit_id,
          }),
        },
      })
    }

    const args: WorkflowEditArgs = {
      ack,
      configure,
      step: payload.workflow_step,
      payload,
      context,
    }

    await stepHandler.config.edit(args)
  }

  /**
   * Handle view_submission for workflow step save
   * Returns true if this was a workflow step save, false otherwise
   */
  private async handleWorkflowStepSave(body: ViewSubmissionPayload, context: BotContext): Promise<boolean> {
    const callbackId = body.view.callback_id
    if (!callbackId) return false

    const stepHandler = this.stepHandlers.get(callbackId)
    if (!stepHandler) return false

    // Check if this view has workflow step metadata
    let metadata: { workflow_step_edit_id?: string } = {}
    if (body.view.private_metadata) {
      try {
        metadata = JSON.parse(body.view.private_metadata)
      } catch {
        return false
      }
    }

    // Also check body for workflow_step
    const workflowStepEditId = metadata.workflow_step_edit_id ?? (body as any).workflow_step?.workflow_step_edit_id
    if (!workflowStepEditId) return false

    const ack = async () => {}

    const update: UpdateFn = async (config) => {
      await this.workflows.updateStep({
        workflow_step_edit_id: workflowStepEditId,
        inputs: config.inputs,
        outputs: config.outputs,
      })
    }

    const viewWithState = body.view as ViewOutput & { state: ViewState }

    const args: WorkflowSaveArgs = {
      ack,
      update,
      view: viewWithState,
      step: { workflow_step_edit_id: workflowStepEditId },
      payload: body,
      context,
    }

    await stepHandler.config.save(args)
    return true
  }

  /**
   * Handle workflow_step_execute event
   */
  private async handleWorkflowStepExecute(
    event: WorkflowStepExecutePayload['event'],
    context: BotContext
  ): Promise<void> {
    if (!event) return

    const callbackId = event.callback_id
    const stepHandler = this.stepHandlers.get(callbackId)
    if (!stepHandler) {
      this.logger.warn(`No handler for workflow step execute: ${callbackId}`)
      return
    }

    const workflowStep = event.workflow_step
    const executeId = workflowStep.workflow_step_execute_id

    const complete: CompleteFn = async (result) => {
      await this.workflows.stepCompleted({
        workflow_step_execute_id: executeId,
        outputs: result.outputs,
      })
    }

    const fail: FailFn = async (result) => {
      await this.workflows.stepFailed({
        workflow_step_execute_id: executeId,
        error: { message: result.error },
      })
    }

    const inputs = (workflowStep as any).inputs ?? {}

    const executePayload: WorkflowStepExecutePayload = {
      type: 'workflow_step_execute',
      callback_id: callbackId,
      workflow_step: {
        workflow_step_execute_id: executeId,
        inputs,
        outputs: (workflowStep as any).outputs,
      },
      event,
    }

    const args: WorkflowExecuteArgs = {
      inputs,
      step: executePayload.workflow_step,
      complete,
      fail,
      payload: executePayload,
      context,
    }

    try {
      await stepHandler.config.execute(args)
    } catch (error) {
      // Auto-fail on unhandled exception
      await this.workflows.stepFailed({
        workflow_step_execute_id: executeId,
        error: { message: (error as Error).message ?? 'Unknown error' },
      })
      if (this.errorHandler) {
        await this.errorHandler(error as Error, context)
      }
    }
  }

  private async runMiddleware(args: BotMiddlewareArgs & { body: unknown }): Promise<void> {
    let index = 0

    const next: NextFn = async () => {
      if (index < this.middleware.length) {
        await this.middleware[index++]({ ...args, next })
      }
    }

    await next()
  }

  private matchPattern(text: string | undefined, pattern: MessagePattern): boolean | RegExpMatchArray {
    if (!text) return false

    if (typeof pattern === 'string') {
      return text.includes(pattern)
    }

    const match = text.match(pattern)
    return match ?? false
  }

  private matchActionPattern(action: BlockAction, pattern: ActionPattern): boolean {
    if (typeof pattern === 'string') {
      return action.action_id === pattern
    }

    if (pattern instanceof RegExp) {
      return pattern.test(action.action_id)
    }

    // Object pattern
    let matches = true

    if (pattern.action_id) {
      if (typeof pattern.action_id === 'string') {
        matches = matches && action.action_id === pattern.action_id
      } else {
        matches = matches && pattern.action_id.test(action.action_id)
      }
    }

    if (pattern.block_id && action.block_id) {
      if (typeof pattern.block_id === 'string') {
        matches = matches && action.block_id === pattern.block_id
      } else {
        matches = matches && pattern.block_id.test(action.block_id)
      }
    }

    return matches
  }

  private matchViewPattern(
    callbackId: string | undefined,
    pattern: ViewPattern,
    eventType: 'view_submission' | 'view_closed'
  ): boolean {
    if (!callbackId) return false

    if (typeof pattern === 'string') {
      return callbackId === pattern
    }

    if (pattern instanceof RegExp) {
      return pattern.test(callbackId)
    }

    // Object pattern
    if (pattern.type && pattern.type !== eventType) {
      return false
    }

    if (typeof pattern.callback_id === 'string') {
      return callbackId === pattern.callback_id
    }

    return pattern.callback_id.test(callbackId)
  }

  private matchShortcutPattern(shortcut: ShortcutPayload, pattern: ShortcutPattern): boolean {
    if (typeof pattern === 'string') {
      return shortcut.callback_id === pattern
    }

    if (pattern instanceof RegExp) {
      return pattern.test(shortcut.callback_id)
    }

    // Object pattern
    if (pattern.type && pattern.type !== shortcut.type) {
      return false
    }

    if (typeof pattern.callback_id === 'string') {
      return shortcut.callback_id === pattern.callback_id
    }

    return pattern.callback_id.test(shortcut.callback_id)
  }

  private matchCommandPattern(command: string, pattern: CommandPattern): boolean {
    if (typeof pattern === 'string') {
      return command === pattern
    }

    return pattern.test(command)
  }

  private async verifySignature(body: string, timestamp: string, signature: string): Promise<boolean> {
    if (!this.signingSecret) return true

    // Check timestamp is not too old (5 minutes)
    const now = Math.floor(Date.now() / 1000)
    const requestTime = parseInt(timestamp, 10)
    if (Math.abs(now - requestTime) > 300) {
      return false
    }

    // Generate expected signature
    const baseString = `v0:${timestamp}:${body}`
    const encoder = new TextEncoder()

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.signingSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(baseString))
    const expectedSignature = `v0=${Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`

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
}

// ============================================================================
// EXPORTS
// ============================================================================

export default SlackBot
