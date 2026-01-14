/**
 * @dotdo/slack - Type Definitions
 *
 * TypeScript types for the Slack API compatibility layer.
 * These types mirror the @slack/web-api and @slack/bolt packages.
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Slack Message
 */
export interface Message {
  type: 'message'
  ts: string
  user?: string
  text?: string
  channel?: string
  thread_ts?: string
  blocks?: Block[]
  attachments?: Attachment[]
  bot_id?: string
  subtype?: string
  edited?: {
    user: string
    ts: string
  }
}

/**
 * Slack Channel
 */
export interface Channel {
  id: string
  name: string
  is_channel: boolean
  is_group: boolean
  is_im: boolean
  is_mpim: boolean
  is_private: boolean
  created: number
  is_archived: boolean
  is_general: boolean
  is_shared: boolean
  is_org_shared: boolean
  is_member: boolean
  is_pending_ext_shared: boolean
  num_members?: number
  topic?: {
    value: string
    creator: string
    last_set: number
  }
  purpose?: {
    value: string
    creator: string
    last_set: number
  }
  creator?: string
  name_normalized?: string
  previous_names?: string[]
}

/**
 * Slack User
 */
export interface User {
  id: string
  team_id: string
  name: string
  real_name?: string
  is_bot: boolean
  is_admin: boolean
  is_owner: boolean
  is_primary_owner?: boolean
  is_restricted?: boolean
  is_ultra_restricted?: boolean
  is_app_user?: boolean
  deleted?: boolean
  profile?: UserProfile
  tz?: string
  tz_label?: string
  tz_offset?: number
}

/**
 * User Profile
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
  phone?: string
  title?: string
}

// =============================================================================
// Block Kit Types
// =============================================================================

/**
 * Block element base
 */
export type Block =
  | SectionBlock
  | DividerBlock
  | ImageBlock
  | ActionsBlock
  | ContextBlock
  | InputBlock
  | HeaderBlock
  | RichTextBlock

export interface SectionBlock {
  type: 'section'
  block_id?: string
  text?: TextObject
  fields?: TextObject[]
  accessory?: BlockElement
}

export interface DividerBlock {
  type: 'divider'
  block_id?: string
}

export interface ImageBlock {
  type: 'image'
  block_id?: string
  image_url: string
  alt_text: string
  title?: TextObject
}

export interface ActionsBlock {
  type: 'actions'
  block_id?: string
  elements: BlockElement[]
}

export interface ContextBlock {
  type: 'context'
  block_id?: string
  elements: (TextObject | ImageElement)[]
}

export interface InputBlock {
  type: 'input'
  block_id?: string
  label: TextObject
  element: BlockElement
  hint?: TextObject
  optional?: boolean
  dispatch_action?: boolean
}

export interface HeaderBlock {
  type: 'header'
  block_id?: string
  text: TextObject
}

export interface RichTextBlock {
  type: 'rich_text'
  block_id?: string
  elements: RichTextElement[]
}

export type RichTextElement = RichTextSection | RichTextList | RichTextPreformatted | RichTextQuote

export interface RichTextSection {
  type: 'rich_text_section'
  elements: RichTextInlineElement[]
}

export interface RichTextList {
  type: 'rich_text_list'
  style: 'ordered' | 'bullet'
  elements: RichTextSection[]
}

export interface RichTextPreformatted {
  type: 'rich_text_preformatted'
  elements: RichTextInlineElement[]
}

export interface RichTextQuote {
  type: 'rich_text_quote'
  elements: RichTextInlineElement[]
}

export interface RichTextInlineElement {
  type: 'text' | 'user' | 'channel' | 'link' | 'emoji'
  text?: string
  user_id?: string
  channel_id?: string
  url?: string
  name?: string
  style?: {
    bold?: boolean
    italic?: boolean
    strike?: boolean
    code?: boolean
  }
}

export interface TextObject {
  type: 'plain_text' | 'mrkdwn'
  text: string
  emoji?: boolean
  verbatim?: boolean
}

export type BlockElement =
  | ButtonElement
  | StaticSelectElement
  | MultiStaticSelectElement
  | UsersSelectElement
  | ConversationsSelectElement
  | ChannelsSelectElement
  | ExternalSelectElement
  | OverflowElement
  | DatepickerElement
  | TimepickerElement
  | PlainTextInputElement
  | CheckboxesElement
  | RadioButtonsElement
  | ImageElement

export interface ButtonElement {
  type: 'button'
  text: TextObject
  action_id: string
  url?: string
  value?: string
  style?: 'primary' | 'danger'
  confirm?: ConfirmationDialog
  accessibility_label?: string
}

export interface StaticSelectElement {
  type: 'static_select'
  action_id: string
  placeholder?: TextObject
  options: Option[]
  option_groups?: OptionGroup[]
  initial_option?: Option
  confirm?: ConfirmationDialog
}

export interface MultiStaticSelectElement {
  type: 'multi_static_select'
  action_id: string
  placeholder?: TextObject
  options: Option[]
  option_groups?: OptionGroup[]
  initial_options?: Option[]
  max_selected_items?: number
  confirm?: ConfirmationDialog
}

export interface UsersSelectElement {
  type: 'users_select'
  action_id: string
  placeholder?: TextObject
  initial_user?: string
  confirm?: ConfirmationDialog
}

export interface ConversationsSelectElement {
  type: 'conversations_select'
  action_id: string
  placeholder?: TextObject
  initial_conversation?: string
  default_to_current_conversation?: boolean
  confirm?: ConfirmationDialog
  filter?: ConversationFilter
}

export interface ChannelsSelectElement {
  type: 'channels_select'
  action_id: string
  placeholder?: TextObject
  initial_channel?: string
  confirm?: ConfirmationDialog
}

export interface ExternalSelectElement {
  type: 'external_select'
  action_id: string
  placeholder?: TextObject
  initial_option?: Option
  min_query_length?: number
  confirm?: ConfirmationDialog
}

export interface OverflowElement {
  type: 'overflow'
  action_id: string
  options: Option[]
  confirm?: ConfirmationDialog
}

export interface DatepickerElement {
  type: 'datepicker'
  action_id: string
  placeholder?: TextObject
  initial_date?: string
  confirm?: ConfirmationDialog
}

export interface TimepickerElement {
  type: 'timepicker'
  action_id: string
  placeholder?: TextObject
  initial_time?: string
  confirm?: ConfirmationDialog
}

export interface PlainTextInputElement {
  type: 'plain_text_input'
  action_id: string
  placeholder?: TextObject
  initial_value?: string
  multiline?: boolean
  min_length?: number
  max_length?: number
  dispatch_action_config?: DispatchActionConfig
}

export interface CheckboxesElement {
  type: 'checkboxes'
  action_id: string
  options: Option[]
  initial_options?: Option[]
  confirm?: ConfirmationDialog
}

export interface RadioButtonsElement {
  type: 'radio_buttons'
  action_id: string
  options: Option[]
  initial_option?: Option
  confirm?: ConfirmationDialog
}

export interface ImageElement {
  type: 'image'
  image_url: string
  alt_text: string
}

export interface Option {
  text: TextObject
  value: string
  description?: TextObject
  url?: string
}

export interface OptionGroup {
  label: TextObject
  options: Option[]
}

export interface ConfirmationDialog {
  title: TextObject
  text: TextObject
  confirm: TextObject
  deny: TextObject
  style?: 'primary' | 'danger'
}

export interface ConversationFilter {
  include?: ('im' | 'mpim' | 'private' | 'public')[]
  exclude_external_shared_channels?: boolean
  exclude_bot_users?: boolean
}

export interface DispatchActionConfig {
  trigger_actions_on?: ('on_enter_pressed' | 'on_character_entered')[]
}

// =============================================================================
// Attachment Types
// =============================================================================

export interface Attachment {
  color?: string
  fallback?: string
  callback_id?: string
  id?: number
  author_id?: string
  author_name?: string
  author_link?: string
  author_icon?: string
  title?: string
  title_link?: string
  pretext?: string
  text?: string
  fields?: AttachmentField[]
  image_url?: string
  thumb_url?: string
  footer?: string
  footer_icon?: string
  ts?: string | number
  mrkdwn_in?: string[]
  actions?: AttachmentAction[]
  blocks?: Block[]
}

export interface AttachmentField {
  title: string
  value: string
  short?: boolean
}

export interface AttachmentAction {
  type: 'button' | 'select'
  text: string
  name: string
  value?: string
  style?: 'default' | 'primary' | 'danger'
  data_source?: 'static' | 'users' | 'channels' | 'conversations' | 'external'
  options?: { text: string; value: string }[]
  confirm?: {
    title: string
    text: string
    ok_text: string
    dismiss_text: string
  }
}

// =============================================================================
// API Arguments
// =============================================================================

// Chat
export interface ChatPostMessageArguments {
  channel: string
  text?: string
  blocks?: Block[]
  attachments?: Attachment[]
  thread_ts?: string
  reply_broadcast?: boolean
  mrkdwn?: boolean
  unfurl_links?: boolean
  unfurl_media?: boolean
  metadata?: MessageMetadata
  parse?: 'none' | 'full'
  link_names?: boolean
  as_user?: boolean
  icon_emoji?: string
  icon_url?: string
  username?: string
}

export interface ChatPostEphemeralArguments {
  channel: string
  user: string
  text?: string
  blocks?: Block[]
  attachments?: Attachment[]
  thread_ts?: string
  parse?: 'none' | 'full'
  link_names?: boolean
  as_user?: boolean
  icon_emoji?: string
  icon_url?: string
  username?: string
}

export interface ChatUpdateArguments {
  channel: string
  ts: string
  text?: string
  blocks?: Block[]
  attachments?: Attachment[]
  parse?: 'none' | 'full'
  link_names?: boolean
  as_user?: boolean
  metadata?: MessageMetadata
  reply_broadcast?: boolean
}

export interface ChatDeleteArguments {
  channel: string
  ts: string
  as_user?: boolean
}

export interface ChatScheduleMessageArguments {
  channel: string
  post_at: number
  text?: string
  blocks?: Block[]
  attachments?: Attachment[]
  thread_ts?: string
  reply_broadcast?: boolean
  parse?: 'none' | 'full'
  link_names?: boolean
  as_user?: boolean
  unfurl_links?: boolean
  unfurl_media?: boolean
  metadata?: MessageMetadata
}

export interface MessageMetadata {
  event_type: string
  event_payload: Record<string, unknown>
}

// Conversations
export interface ConversationsCreateArguments {
  name: string
  is_private?: boolean
  team_id?: string
}

export interface ConversationsListArguments {
  cursor?: string
  exclude_archived?: boolean
  limit?: number
  team_id?: string
  types?: string
}

export interface ConversationsInfoArguments {
  channel: string
  include_locale?: boolean
  include_num_members?: boolean
}

export interface ConversationsJoinArguments {
  channel: string
}

export interface ConversationsLeaveArguments {
  channel: string
}

export interface ConversationsArchiveArguments {
  channel: string
}

export interface ConversationsUnarchiveArguments {
  channel: string
}

export interface ConversationsInviteArguments {
  channel: string
  users: string
}

export interface ConversationsKickArguments {
  channel: string
  user: string
}

export interface ConversationsMembersArguments {
  channel: string
  cursor?: string
  limit?: number
}

export interface ConversationsHistoryArguments {
  channel: string
  cursor?: string
  inclusive?: boolean
  latest?: string
  limit?: number
  oldest?: string
}

// Users
export interface UsersInfoArguments {
  user: string
  include_locale?: boolean
}

export interface UsersListArguments {
  cursor?: string
  include_locale?: boolean
  limit?: number
  team_id?: string
}

export interface UsersLookupByEmailArguments {
  email: string
}

// =============================================================================
// API Responses
// =============================================================================

export interface SlackAPIResponse {
  ok: boolean
  error?: string
  warning?: string
  response_metadata?: ResponseMetadata
}

export interface ResponseMetadata {
  next_cursor?: string
  scopes?: string[]
  acceptedScopes?: string[]
  messages?: string[]
  warnings?: string[]
}

export interface ChatPostMessageResponse extends SlackAPIResponse {
  channel?: string
  ts?: string
  message?: Message
}

export interface ChatPostEphemeralResponse extends SlackAPIResponse {
  message_ts?: string
}

export interface ChatUpdateResponse extends SlackAPIResponse {
  channel?: string
  ts?: string
  text?: string
  message?: Message
}

export interface ChatDeleteResponse extends SlackAPIResponse {
  channel?: string
  ts?: string
}

export interface ChatScheduleMessageResponse extends SlackAPIResponse {
  channel?: string
  scheduled_message_id?: string
  post_at?: number
  message?: Message
}

export interface ConversationsCreateResponse extends SlackAPIResponse {
  channel?: Channel
}

export interface ConversationsListResponse extends SlackAPIResponse {
  channels?: Channel[]
  response_metadata?: ResponseMetadata
}

export interface ConversationsInfoResponse extends SlackAPIResponse {
  channel?: Channel
}

export interface ConversationsJoinResponse extends SlackAPIResponse {
  channel?: Channel
  warning?: string
  response_metadata?: ResponseMetadata
}

export interface ConversationsLeaveResponse extends SlackAPIResponse {
  not_in_channel?: boolean
}

export interface ConversationsArchiveResponse extends SlackAPIResponse {}

export interface ConversationsUnarchiveResponse extends SlackAPIResponse {}

export interface ConversationsInviteResponse extends SlackAPIResponse {
  channel?: Channel
}

export interface ConversationsKickResponse extends SlackAPIResponse {}

export interface ConversationsMembersResponse extends SlackAPIResponse {
  members?: string[]
  response_metadata?: ResponseMetadata
}

export interface ConversationsHistoryResponse extends SlackAPIResponse {
  messages?: Message[]
  has_more?: boolean
  pin_count?: number
  response_metadata?: ResponseMetadata
}

export interface UsersInfoResponse extends SlackAPIResponse {
  user?: User
}

export interface UsersListResponse extends SlackAPIResponse {
  members?: User[]
  cache_ts?: number
  response_metadata?: ResponseMetadata
}

export interface UsersLookupByEmailResponse extends SlackAPIResponse {
  user?: User
}

// =============================================================================
// Event Types
// =============================================================================

export interface SlackEvent {
  type: string
  event_ts?: string
  user?: string
  channel?: string
  ts?: string
}

export interface MessageEvent extends SlackEvent {
  type: 'message'
  text: string
  user: string
  channel: string
  ts: string
  thread_ts?: string
  subtype?: string
  blocks?: Block[]
  attachments?: Attachment[]
}

export interface AppMentionEvent extends SlackEvent {
  type: 'app_mention'
  text: string
  user: string
  channel: string
  ts: string
  thread_ts?: string
}

export interface ReactionAddedEvent extends SlackEvent {
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

export interface ReactionRemovedEvent extends SlackEvent {
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

export interface MemberJoinedChannelEvent extends SlackEvent {
  type: 'member_joined_channel'
  user: string
  channel: string
  channel_type: string
  team?: string
  inviter?: string
}

export interface MemberLeftChannelEvent extends SlackEvent {
  type: 'member_left_channel'
  user: string
  channel: string
  channel_type: string
  team?: string
}

export interface ChannelCreatedEvent extends SlackEvent {
  type: 'channel_created'
  channel: {
    id: string
    name: string
    created: number
    creator: string
  }
}

// =============================================================================
// Interaction Types
// =============================================================================

export interface BlockAction {
  type: string
  action_id: string
  block_id?: string
  value?: string
  selected_option?: Option
  selected_options?: Option[]
  selected_user?: string
  selected_users?: string[]
  selected_channel?: string
  selected_channels?: string[]
  selected_conversation?: string
  selected_conversations?: string[]
  selected_date?: string
  selected_time?: string
  action_ts?: string
}

export interface BlockActionsPayload {
  type: 'block_actions'
  user: { id: string; username?: string; name?: string; team_id?: string }
  channel?: { id: string; name?: string }
  team?: { id: string; domain?: string }
  message?: Message
  container?: {
    type: string
    message_ts?: string
    channel_id?: string
    is_ephemeral?: boolean
  }
  actions: BlockAction[]
  trigger_id: string
  response_url?: string
  api_app_id?: string
}

export interface ViewSubmissionPayload {
  type: 'view_submission'
  team?: { id: string; domain?: string }
  user: { id: string; username?: string; name?: string; team_id?: string }
  view: ViewOutput
  api_app_id?: string
  trigger_id?: string
  response_urls?: ResponseUrl[]
}

export interface ViewClosedPayload {
  type: 'view_closed'
  team?: { id: string; domain?: string }
  user: { id: string; username?: string; name?: string; team_id?: string }
  view: ViewOutput
  api_app_id?: string
  is_cleared: boolean
}

export interface ViewOutput {
  id?: string
  team_id?: string
  type?: 'modal' | 'home'
  callback_id?: string
  private_metadata?: string
  root_view_id?: string
  app_id?: string
  external_id?: string
  app_installed_team_id?: string
  bot_id?: string
  title?: TextObject
  close?: TextObject
  submit?: TextObject
  blocks?: Block[]
  state?: ViewState
  hash?: string
  clear_on_close?: boolean
  notify_on_close?: boolean
}

export interface ViewState {
  values: {
    [blockId: string]: {
      [actionId: string]: ViewStateValue
    }
  }
}

export interface ViewStateValue {
  type: string
  value?: string
  selected_option?: Option
  selected_options?: Option[]
  selected_user?: string
  selected_users?: string[]
  selected_channel?: string
  selected_channels?: string[]
  selected_conversation?: string
  selected_conversations?: string[]
  selected_date?: string
  selected_time?: string
}

export interface ResponseUrl {
  block_id: string
  action_id: string
  channel_id: string
  response_url: string
}

// =============================================================================
// Shortcut Types
// =============================================================================

export interface GlobalShortcutPayload {
  type: 'shortcut'
  callback_id: string
  trigger_id: string
  user: { id: string; username?: string; name?: string; team_id?: string }
  team?: { id: string; domain?: string }
  token?: string
  action_ts?: string
}

export interface MessageShortcutPayload {
  type: 'message_action'
  callback_id: string
  trigger_id: string
  user: { id: string; username?: string; name?: string; team_id?: string }
  team?: { id: string; domain?: string }
  channel: { id: string; name?: string }
  message: Message
  response_url?: string
  token?: string
  action_ts?: string
}

export type ShortcutPayload = GlobalShortcutPayload | MessageShortcutPayload

// =============================================================================
// Slash Command Types
// =============================================================================

export interface SlashCommand {
  command: string
  text: string
  response_url: string
  trigger_id: string
  user_id: string
  user_name: string
  team_id: string
  team_domain?: string
  channel_id: string
  channel_name: string
  enterprise_id?: string
  enterprise_name?: string
  api_app_id?: string
  is_enterprise_install?: string
}

export interface CommandResponse {
  text?: string
  blocks?: Block[]
  attachments?: Attachment[]
  response_type?: 'ephemeral' | 'in_channel'
  replace_original?: boolean
  delete_original?: boolean
  mrkdwn?: boolean
}

// =============================================================================
// Middleware Types
// =============================================================================

export interface SlackEventMiddlewareArgs<EventType = SlackEvent> {
  payload: EventType
  event: EventType
  message?: MessageEvent
  body: EventCallbackBody
  say: SayFn
  client: WebClientLike
  context: Context
  next: NextFn
  ack: AckFn<void>
}

export interface SlackActionMiddlewareArgs<ActionType = BlockAction> {
  payload: ActionType
  action: ActionType
  body: BlockActionsPayload
  respond: RespondFn
  ack: AckFn<void>
  say: SayFn
  client: WebClientLike
  context: Context
  next: NextFn
}

export interface SlackViewMiddlewareArgs {
  payload: ViewOutput
  view: ViewOutput
  body: ViewSubmissionPayload | ViewClosedPayload
  ack: AckFn<ViewAckResponse | void>
  client: WebClientLike
  context: Context
  next: NextFn
}

export interface SlackShortcutMiddlewareArgs {
  payload: ShortcutPayload
  shortcut: ShortcutPayload
  body: ShortcutPayload
  ack: AckFn<void>
  respond?: RespondFn
  client: WebClientLike
  context: Context
  next: NextFn
}

export interface SlackCommandMiddlewareArgs {
  payload: SlashCommand
  command: SlashCommand
  body: SlashCommand
  ack: AckFn<string | CommandResponse | void>
  respond: RespondFn
  say: SayFn
  client: WebClientLike
  context: Context
  next: NextFn
}

export interface EventCallbackBody {
  type: 'event_callback'
  token?: string
  team_id?: string
  api_app_id?: string
  event: SlackEvent
  event_id?: string
  event_time?: number
  authorizations?: Authorization[]
  is_ext_shared_channel?: boolean
  event_context?: string
}

export interface Authorization {
  enterprise_id?: string
  team_id: string
  user_id: string
  is_bot: boolean
  is_enterprise_install?: boolean
}

export interface Context {
  [key: string]: unknown
  botToken?: string
  botUserId?: string
  botId?: string
  teamId?: string
  enterpriseId?: string
  isEnterpriseInstall?: boolean
}

export interface ViewAckResponse {
  response_action?: 'errors' | 'update' | 'push' | 'clear'
  errors?: Record<string, string>
  view?: ViewOutput
}

// =============================================================================
// Function Types
// =============================================================================

export type SayFn = (
  message: string | ChatPostMessageArguments
) => Promise<ChatPostMessageResponse>

export type RespondFn = (
  message: string | CommandResponse
) => Promise<void>

export type AckFn<Response> = (response?: Response) => Promise<void>

export type NextFn = () => Promise<void>

export type Middleware<Args> = (args: Args) => Promise<void>

export interface WebClientLike {
  chat: {
    postMessage: (args: ChatPostMessageArguments) => Promise<ChatPostMessageResponse>
    postEphemeral: (args: ChatPostEphemeralArguments) => Promise<ChatPostEphemeralResponse>
    update: (args: ChatUpdateArguments) => Promise<ChatUpdateResponse>
    delete: (args: ChatDeleteArguments) => Promise<ChatDeleteResponse>
    scheduleMessage: (args: ChatScheduleMessageArguments) => Promise<ChatScheduleMessageResponse>
  }
  conversations: {
    create: (args: ConversationsCreateArguments) => Promise<ConversationsCreateResponse>
    list: (args?: ConversationsListArguments) => Promise<ConversationsListResponse>
    info: (args: ConversationsInfoArguments) => Promise<ConversationsInfoResponse>
    join: (args: ConversationsJoinArguments) => Promise<ConversationsJoinResponse>
    leave: (args: ConversationsLeaveArguments) => Promise<ConversationsLeaveResponse>
    archive: (args: ConversationsArchiveArguments) => Promise<ConversationsArchiveResponse>
    unarchive: (args: ConversationsUnarchiveArguments) => Promise<ConversationsUnarchiveResponse>
    invite: (args: ConversationsInviteArguments) => Promise<ConversationsInviteResponse>
    kick: (args: ConversationsKickArguments) => Promise<ConversationsKickResponse>
    members: (args: ConversationsMembersArguments) => Promise<ConversationsMembersResponse>
    history: (args: ConversationsHistoryArguments) => Promise<ConversationsHistoryResponse>
  }
  users: {
    info: (args: UsersInfoArguments) => Promise<UsersInfoResponse>
    list: (args?: UsersListArguments) => Promise<UsersListResponse>
    lookupByEmail: (args: UsersLookupByEmailArguments) => Promise<UsersLookupByEmailResponse>
  }
}

// =============================================================================
// Client Options
// =============================================================================

export interface WebClientOptions {
  token?: string
  timeout?: number
  retryConfig?: {
    retries?: number
    factor?: number
    minTimeout?: number
    maxTimeout?: number
  }
  fetch?: typeof fetch
  baseUrl?: string
  slackApiUrl?: string
  headers?: Record<string, string>
  rejectRateLimitedCalls?: boolean
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  logger?: Logger
}

export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export interface AppOptions {
  token?: string
  signingSecret?: string
  appToken?: string
  socketMode?: boolean
  clientId?: string
  clientSecret?: string
  stateSecret?: string
  redirectUri?: string
  installerOptions?: InstallerOptions
  authorize?: AuthorizeFn
  receiver?: Receiver
  convoStore?: ConversationStore
  ignoreSelf?: boolean
  clientOptions?: WebClientOptions
  deferInitialization?: boolean
  developerMode?: boolean
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  logger?: Logger
  fetch?: typeof fetch
}

export interface InstallerOptions {
  directInstall?: boolean
  stateStore?: StateStore
  installationStore?: InstallationStore
  userScopes?: string[]
  authVersion?: 'v1' | 'v2'
  metadata?: string
  callbackOptions?: CallbackOptions
}

export interface StateStore {
  generateStateParam: (installOptions: InstallURLOptions) => Promise<string>
  verifyStateParam: (now: Date, state: string) => Promise<InstallURLOptions>
}

export interface InstallationStore {
  storeInstallation: (installation: Installation) => Promise<void>
  fetchInstallation: (installQuery: InstallationQuery) => Promise<Installation>
  deleteInstallation?: (installQuery: InstallationQuery) => Promise<void>
}

export interface InstallURLOptions {
  scopes: string[]
  teamId?: string
  redirectUri?: string
  userScopes?: string[]
  metadata?: string
}

export interface Installation {
  team?: { id: string; name?: string }
  enterprise?: { id: string; name?: string }
  user: { token?: string; scopes?: string[]; id: string }
  bot?: { token: string; scopes: string[]; id: string; userId: string }
  incomingWebhook?: { channel?: string; channelId?: string; configurationUrl?: string; url: string }
  appId?: string
  tokenType?: 'bot' | 'user'
  isEnterpriseInstall?: boolean
}

export interface InstallationQuery {
  teamId?: string
  enterpriseId?: string
  userId?: string
  isEnterpriseInstall?: boolean
}

export interface CallbackOptions {
  success: (installation: Installation, options: InstallURLOptions, req: unknown, res: unknown) => void
  failure: (error: Error, options: InstallURLOptions, req: unknown, res: unknown) => void
}

export type AuthorizeFn = (
  source: AuthorizeSourceData
) => Promise<AuthorizeResult>

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

export interface Receiver {
  init: (app: unknown) => void
  start: (...args: unknown[]) => Promise<unknown>
  stop: (...args: unknown[]) => Promise<void>
}

export interface ConversationStore {
  set: (conversationId: string, value: unknown, expiresAt?: number) => Promise<void>
  get: (conversationId: string) => Promise<unknown>
}
