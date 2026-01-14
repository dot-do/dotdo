/**
 * @dotdo/discord - Type Definitions
 *
 * Discord API types for compatibility layer
 *
 * @see https://discord.com/developers/docs
 */

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Gateway Intent Bits
 * @see https://discord.com/developers/docs/topics/gateway#gateway-intents
 */
export const GatewayIntentBits = {
  Guilds: 1 << 0,
  GuildMembers: 1 << 1,
  GuildModeration: 1 << 2,
  GuildEmojisAndStickers: 1 << 3,
  GuildIntegrations: 1 << 4,
  GuildWebhooks: 1 << 5,
  GuildInvites: 1 << 6,
  GuildVoiceStates: 1 << 7,
  GuildPresences: 1 << 8,
  GuildMessages: 1 << 9,
  GuildMessageReactions: 1 << 10,
  GuildMessageTyping: 1 << 11,
  DirectMessages: 1 << 12,
  DirectMessageReactions: 1 << 13,
  DirectMessageTyping: 1 << 14,
  MessageContent: 1 << 15,
  GuildScheduledEvents: 1 << 16,
  AutoModerationConfiguration: 1 << 20,
  AutoModerationExecution: 1 << 21,
} as const

export type GatewayIntentBits = (typeof GatewayIntentBits)[keyof typeof GatewayIntentBits]

/**
 * Channel Types
 * @see https://discord.com/developers/docs/resources/channel#channel-object-channel-types
 */
export const ChannelType = {
  GuildText: 0,
  DM: 1,
  GuildVoice: 2,
  GroupDM: 3,
  GuildCategory: 4,
  GuildAnnouncement: 5,
  AnnouncementThread: 10,
  PublicThread: 11,
  PrivateThread: 12,
  GuildStageVoice: 13,
  GuildDirectory: 14,
  GuildForum: 15,
  GuildMedia: 16,
} as const

export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType]

/**
 * Button Styles
 * @see https://discord.com/developers/docs/interactions/message-components#button-object-button-styles
 */
export const ButtonStyle = {
  Primary: 1,
  Secondary: 2,
  Success: 3,
  Danger: 4,
  Link: 5,
} as const

export type ButtonStyle = (typeof ButtonStyle)[keyof typeof ButtonStyle]

/**
 * Text Input Styles
 * @see https://discord.com/developers/docs/interactions/message-components#text-input-object-text-input-styles
 */
export const TextInputStyle = {
  Short: 1,
  Paragraph: 2,
} as const

export type TextInputStyle = (typeof TextInputStyle)[keyof typeof TextInputStyle]

/**
 * Component Types
 * @see https://discord.com/developers/docs/interactions/message-components#component-object-component-types
 */
export const ComponentType = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3,
  TextInput: 4,
  UserSelect: 5,
  RoleSelect: 6,
  MentionableSelect: 7,
  ChannelSelect: 8,
} as const

export type ComponentType = (typeof ComponentType)[keyof typeof ComponentType]

/**
 * Interaction Types
 * @see https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object-interaction-type
 */
export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  ApplicationCommandAutocomplete: 4,
  ModalSubmit: 5,
} as const

export type InteractionType = (typeof InteractionType)[keyof typeof InteractionType]

/**
 * Interaction Callback Types
 * @see https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-response-object-interaction-callback-type
 */
export const InteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  DeferredChannelMessageWithSource: 5,
  DeferredUpdateMessage: 6,
  UpdateMessage: 7,
  ApplicationCommandAutocompleteResult: 8,
  Modal: 9,
} as const

export type InteractionResponseType = (typeof InteractionResponseType)[keyof typeof InteractionResponseType]

/**
 * Application Command Option Types
 * @see https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-option-type
 */
export const ApplicationCommandOptionType = {
  SubCommand: 1,
  SubCommandGroup: 2,
  String: 3,
  Integer: 4,
  Boolean: 5,
  User: 6,
  Channel: 7,
  Role: 8,
  Mentionable: 9,
  Number: 10,
  Attachment: 11,
} as const

export type ApplicationCommandOptionType = (typeof ApplicationCommandOptionType)[keyof typeof ApplicationCommandOptionType]

/**
 * Permission Flag Bits
 * @see https://discord.com/developers/docs/topics/permissions#permissions-bitwise-permission-flags
 */
export const PermissionFlagsBits = {
  CreateInstantInvite: 1n << 0n,
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n,
  AddReactions: 1n << 6n,
  ViewAuditLog: 1n << 7n,
  PrioritySpeaker: 1n << 8n,
  Stream: 1n << 9n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  SendTTSMessages: 1n << 12n,
  ManageMessages: 1n << 13n,
  EmbedLinks: 1n << 14n,
  AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n,
  MentionEveryone: 1n << 17n,
  UseExternalEmojis: 1n << 18n,
  ViewGuildInsights: 1n << 19n,
  Connect: 1n << 20n,
  Speak: 1n << 21n,
  MuteMembers: 1n << 22n,
  DeafenMembers: 1n << 23n,
  MoveMembers: 1n << 24n,
  UseVAD: 1n << 25n,
  ChangeNickname: 1n << 26n,
  ManageNicknames: 1n << 27n,
  ManageRoles: 1n << 28n,
  ManageWebhooks: 1n << 29n,
  ManageGuildExpressions: 1n << 30n,
  UseApplicationCommands: 1n << 31n,
  RequestToSpeak: 1n << 32n,
  ManageEvents: 1n << 33n,
  ManageThreads: 1n << 34n,
  CreatePublicThreads: 1n << 35n,
  CreatePrivateThreads: 1n << 36n,
  UseExternalStickers: 1n << 37n,
  SendMessagesInThreads: 1n << 38n,
  UseEmbeddedActivities: 1n << 39n,
  ModerateMembers: 1n << 40n,
  ViewCreatorMonetizationAnalytics: 1n << 41n,
  UseSoundboard: 1n << 42n,
  UseExternalSounds: 1n << 45n,
  SendVoiceMessages: 1n << 46n,
} as const

export type PermissionFlagsBits = (typeof PermissionFlagsBits)[keyof typeof PermissionFlagsBits]

/**
 * Message Flags
 * @see https://discord.com/developers/docs/resources/channel#message-object-message-flags
 */
export const MessageFlags = {
  Crossposted: 1 << 0,
  IsCrosspost: 1 << 1,
  SuppressEmbeds: 1 << 2,
  SourceMessageDeleted: 1 << 3,
  Urgent: 1 << 4,
  HasThread: 1 << 5,
  Ephemeral: 1 << 6,
  Loading: 1 << 7,
  FailedToMentionSomeRolesInThread: 1 << 8,
  SuppressNotifications: 1 << 12,
  IsVoiceMessage: 1 << 13,
} as const

export type MessageFlags = (typeof MessageFlags)[keyof typeof MessageFlags]

// ============================================================================
// API TYPES
// ============================================================================

/**
 * User object
 */
export interface User {
  id: string
  username: string
  discriminator: string
  global_name?: string | null
  avatar: string | null
  bot?: boolean
  system?: boolean
  mfa_enabled?: boolean
  banner?: string | null
  accent_color?: number | null
  locale?: string
  verified?: boolean
  email?: string | null
  flags?: number
  premium_type?: number
  public_flags?: number
}

/**
 * Guild Member object
 */
export interface GuildMember {
  user: User
  nick?: string | null
  avatar?: string | null
  roles: string[]
  joined_at: string
  premium_since?: string | null
  deaf: boolean
  mute: boolean
  pending?: boolean
  permissions?: string
  communication_disabled_until?: string | null
}

/**
 * Role object
 */
export interface Role {
  id: string
  name: string
  color: number
  hoist: boolean
  icon?: string | null
  unicode_emoji?: string | null
  position: number
  permissions: string
  managed: boolean
  mentionable: boolean
  tags?: RoleTags
}

export interface RoleTags {
  bot_id?: string
  integration_id?: string
  premium_subscriber?: null
  subscription_listing_id?: string
  available_for_purchase?: null
  guild_connections?: null
}

/**
 * Channel object
 */
export interface Channel {
  id: string
  type: ChannelType
  guild_id?: string
  position?: number
  permission_overwrites?: PermissionOverwrite[]
  name?: string | null
  topic?: string | null
  nsfw?: boolean
  last_message_id?: string | null
  bitrate?: number
  user_limit?: number
  rate_limit_per_user?: number
  recipients?: User[]
  icon?: string | null
  owner_id?: string
  application_id?: string
  managed?: boolean
  parent_id?: string | null
  last_pin_timestamp?: string | null
  rtc_region?: string | null
  video_quality_mode?: number
  message_count?: number
  member_count?: number
  thread_metadata?: ThreadMetadata
  member?: ThreadMember
  default_auto_archive_duration?: number
  permissions?: string
  flags?: number
  total_message_sent?: number
}

export interface PermissionOverwrite {
  id: string
  type: 0 | 1 // 0 = role, 1 = member
  allow: string
  deny: string
}

export interface ThreadMetadata {
  archived: boolean
  auto_archive_duration: number
  archive_timestamp: string
  locked: boolean
  invitable?: boolean
  create_timestamp?: string | null
}

export interface ThreadMember {
  id?: string
  user_id?: string
  join_timestamp: string
  flags: number
  member?: GuildMember
}

/**
 * Guild object
 */
export interface Guild {
  id: string
  name: string
  icon: string | null
  icon_hash?: string | null
  splash: string | null
  discovery_splash: string | null
  owner?: boolean
  owner_id: string
  permissions?: string
  region?: string | null
  afk_channel_id: string | null
  afk_timeout: number
  widget_enabled?: boolean
  widget_channel_id?: string | null
  verification_level: number
  default_message_notifications: number
  explicit_content_filter: number
  roles: Role[]
  emojis: Emoji[]
  features: string[]
  mfa_level: number
  application_id: string | null
  system_channel_id: string | null
  system_channel_flags: number
  rules_channel_id: string | null
  max_presences?: number | null
  max_members?: number
  vanity_url_code: string | null
  description: string | null
  banner: string | null
  premium_tier: number
  premium_subscription_count?: number
  preferred_locale: string
  public_updates_channel_id: string | null
  max_video_channel_users?: number
  max_stage_video_channel_users?: number
  approximate_member_count?: number
  approximate_presence_count?: number
  welcome_screen?: WelcomeScreen
  nsfw_level: number
  stickers?: Sticker[]
  premium_progress_bar_enabled: boolean
  safety_alerts_channel_id: string | null
  member_count?: number
}

export interface Emoji {
  id: string | null
  name: string | null
  roles?: string[]
  user?: User
  require_colons?: boolean
  managed?: boolean
  animated?: boolean
  available?: boolean
}

export interface WelcomeScreen {
  description: string | null
  welcome_channels: WelcomeScreenChannel[]
}

export interface WelcomeScreenChannel {
  channel_id: string
  description: string
  emoji_id: string | null
  emoji_name: string | null
}

export interface Sticker {
  id: string
  pack_id?: string
  name: string
  description: string | null
  tags: string
  type: number
  format_type: number
  available?: boolean
  guild_id?: string
  user?: User
  sort_value?: number
}

/**
 * Message object
 */
export interface Message {
  id: string
  channel_id: string
  author: User
  content: string
  timestamp: string
  edited_timestamp: string | null
  tts: boolean
  mention_everyone: boolean
  mentions: User[]
  mention_roles: string[]
  mention_channels?: ChannelMention[]
  attachments: Attachment[]
  embeds: Embed[]
  reactions?: Reaction[]
  nonce?: string | number
  pinned: boolean
  webhook_id?: string
  type: number
  activity?: MessageActivity
  application?: Application
  application_id?: string
  message_reference?: MessageReference
  flags?: number
  referenced_message?: Message | null
  interaction?: MessageInteraction
  thread?: Channel
  components?: Component[]
  sticker_items?: StickerItem[]
  position?: number
}

export interface ChannelMention {
  id: string
  guild_id: string
  type: ChannelType
  name: string
}

export interface Attachment {
  id: string
  filename: string
  description?: string
  content_type?: string
  size: number
  url: string
  proxy_url: string
  height?: number | null
  width?: number | null
  ephemeral?: boolean
  duration_secs?: number
  waveform?: string
}

export interface Embed {
  title?: string
  type?: string
  description?: string
  url?: string
  timestamp?: string
  color?: number
  footer?: EmbedFooter
  image?: EmbedImage
  thumbnail?: EmbedThumbnail
  video?: EmbedVideo
  provider?: EmbedProvider
  author?: EmbedAuthor
  fields?: EmbedField[]
}

export interface EmbedFooter {
  text: string
  icon_url?: string
  proxy_icon_url?: string
}

export interface EmbedImage {
  url: string
  proxy_url?: string
  height?: number
  width?: number
}

export interface EmbedThumbnail {
  url: string
  proxy_url?: string
  height?: number
  width?: number
}

export interface EmbedVideo {
  url?: string
  proxy_url?: string
  height?: number
  width?: number
}

export interface EmbedProvider {
  name?: string
  url?: string
}

export interface EmbedAuthor {
  name: string
  url?: string
  icon_url?: string
  proxy_icon_url?: string
}

export interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface Reaction {
  count: number
  me: boolean
  emoji: PartialEmoji
}

export interface PartialEmoji {
  id: string | null
  name: string | null
  animated?: boolean
}

export interface MessageActivity {
  type: number
  party_id?: string
}

export interface Application {
  id: string
  name: string
  icon: string | null
  description: string
  rpc_origins?: string[]
  bot_public: boolean
  bot_require_code_grant: boolean
  terms_of_service_url?: string
  privacy_policy_url?: string
  owner?: User
  verify_key: string
  team: Team | null
  guild_id?: string
  primary_sku_id?: string
  slug?: string
  cover_image?: string
  flags?: number
  tags?: string[]
  install_params?: InstallParams
  custom_install_url?: string
}

export interface Team {
  icon: string | null
  id: string
  members: TeamMember[]
  name: string
  owner_user_id: string
}

export interface TeamMember {
  membership_state: number
  permissions: string[]
  team_id: string
  user: User
}

export interface InstallParams {
  scopes: string[]
  permissions: string
}

export interface MessageReference {
  message_id?: string
  channel_id?: string
  guild_id?: string
  fail_if_not_exists?: boolean
}

export interface MessageInteraction {
  id: string
  type: InteractionType
  name: string
  user: User
  member?: GuildMember
}

export interface StickerItem {
  id: string
  name: string
  format_type: number
}

/**
 * Component types
 */
export interface Component {
  type: ComponentType
  custom_id?: string
  disabled?: boolean
  style?: ButtonStyle
  label?: string
  emoji?: PartialEmoji
  url?: string
  options?: SelectOption[]
  placeholder?: string
  min_values?: number
  max_values?: number
  components?: Component[]
  value?: string
  min_length?: number
  max_length?: number
  required?: boolean
}

export interface SelectOption {
  label: string
  value: string
  description?: string
  emoji?: PartialEmoji
  default?: boolean
}

/**
 * Webhook object
 */
export interface Webhook {
  id: string
  type: number
  guild_id?: string | null
  channel_id: string | null
  user?: User
  name: string | null
  avatar: string | null
  token?: string
  application_id: string | null
  source_guild?: Guild
  source_channel?: Channel
  url?: string
}

/**
 * Interaction object
 */
export interface Interaction {
  id: string
  application_id: string
  type: InteractionType
  data?: InteractionData
  guild_id?: string
  channel?: Channel
  channel_id?: string
  member?: GuildMember
  user?: User
  token: string
  version: number
  message?: Message
  app_permissions?: string
  locale?: string
  guild_locale?: string
}

export interface InteractionData {
  id?: string
  name?: string
  type?: number
  resolved?: ResolvedData
  options?: ApplicationCommandInteractionDataOption[]
  guild_id?: string
  custom_id?: string
  component_type?: ComponentType
  values?: string[]
  target_id?: string
  components?: Component[]
}

export interface ResolvedData {
  users?: Record<string, User>
  members?: Record<string, GuildMember>
  roles?: Record<string, Role>
  channels?: Record<string, Channel>
  messages?: Record<string, Message>
  attachments?: Record<string, Attachment>
}

export interface ApplicationCommandInteractionDataOption {
  name: string
  type: ApplicationCommandOptionType
  value?: string | number | boolean
  options?: ApplicationCommandInteractionDataOption[]
  focused?: boolean
}

/**
 * Interaction subtypes for convenience
 */
export interface CommandInteraction extends Interaction {
  type: typeof InteractionType.ApplicationCommand
  data: InteractionData & { name: string }
}

export interface ButtonInteraction extends Interaction {
  type: typeof InteractionType.MessageComponent
  data: InteractionData & { custom_id: string; component_type: typeof ComponentType.Button }
}

export interface SelectMenuInteraction extends Interaction {
  type: typeof InteractionType.MessageComponent
  data: InteractionData & { custom_id: string; values: string[] }
}

export interface ModalSubmitInteraction extends Interaction {
  type: typeof InteractionType.ModalSubmit
  data: InteractionData & { custom_id: string; components: Component[] }
}

// ============================================================================
// CLIENT OPTIONS
// ============================================================================

/**
 * Client options for creating a Discord client
 */
export interface ClientOptions {
  /** Gateway intents to request */
  intents: GatewayIntentBits[] | number
  /** REST API options */
  rest?: RESTOptions
  /** Custom fetch implementation */
  fetch?: typeof fetch
}

/**
 * REST options
 */
export interface RESTOptions {
  /** API version (default: '10') */
  version?: string
  /** Base API URL */
  api?: string
  /** Request timeout in ms */
  timeout?: number
  /** Number of retries for rate-limited requests */
  retries?: number
}

/**
 * REST request options
 */
export interface RequestOptions {
  body?: unknown
  query?: Record<string, string | number | boolean>
  headers?: Record<string, string>
  reason?: string
}
