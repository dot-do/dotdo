/**
 * @dotdo/slack - Slack SDK Compatibility Layer
 *
 * Drop-in replacement for @slack/web-api with edge runtime support.
 *
 * @example
 * ```typescript
 * import { WebClient } from '@dotdo/slack'
 *
 * const client = new WebClient('xoxb-token')
 *
 * // Post a message
 * const result = await client.chat.postMessage({
 *   channel: 'C1234567890',
 *   text: 'Hello, World!',
 * })
 *
 * // Get channel history
 * const history = await client.conversations.history({
 *   channel: 'C1234567890',
 *   limit: 10,
 * })
 * ```
 *
 * @module @dotdo/slack
 */

// Re-export from client
export {
  WebClient,
  SlackError,
  type WebClientOptions,
  type RetryConfig,
  type SlackResponse,
  type ResponseMetadata,
  type SlackMessage,
  type SlackChannel,
  type SlackUser,
  type UserProfile,
  type Attachment,
  type MessageMetadata,
  type ChatPostMessageArguments,
  type ChatPostMessageResponse,
  type ChatUpdateArguments,
  type ChatUpdateResponse,
  type ChatDeleteArguments,
  type ChatDeleteResponse,
  type ConversationsListArguments,
  type ConversationsListResponse,
  type ConversationsHistoryArguments,
  type ConversationsHistoryResponse,
  type ConversationsInfoArguments,
  type ConversationsInfoResponse,
  type ConversationsJoinArguments,
  type ConversationsJoinResponse,
  type ConversationsLeaveArguments,
  type ConversationsLeaveResponse,
  type ConversationsCreateArguments as ClientCreateArgs,
  type ConversationsCreateResponse as ClientCreateResponse,
  type ConversationsArchiveArguments as ClientArchiveArgs,
  type ConversationsArchiveResponse as ClientArchiveResponse,
  type ConversationsUnarchiveArguments as ClientUnarchiveArgs,
  type ConversationsUnarchiveResponse as ClientUnarchiveResponse,
  type ConversationsInviteArguments as ClientInviteArgs,
  type ConversationsInviteResponse as ClientInviteResponse,
  type ConversationsKickArguments as ClientKickArgs,
  type ConversationsKickResponse as ClientKickResponse,
  type ConversationsMembersArguments as ClientMembersArgs,
  type ConversationsMembersResponse as ClientMembersResponse,
  type ConversationsRenameArguments as ClientRenameArgs,
  type ConversationsRenameResponse as ClientRenameResponse,
  type ConversationsSetTopicArguments as ClientSetTopicArgs,
  type ConversationsSetTopicResponse as ClientSetTopicResponse,
  type ConversationsSetPurposeArguments as ClientSetPurposeArgs,
  type ConversationsSetPurposeResponse as ClientSetPurposeResponse,
  type ConversationsOpenArguments as ClientOpenArgs,
  type ConversationsOpenResponse as ClientOpenResponse,
  type ConversationsCloseArguments as ClientCloseArgs,
  type ConversationsCloseResponse as ClientCloseResponse,
  type ConversationsRepliesArguments as ClientRepliesArgs,
  type ConversationsRepliesResponse as ClientRepliesResponse,
  type ConversationsMarkArguments as ClientMarkArgs,
  type ConversationsMarkResponse as ClientMarkResponse,
  type UsersListArguments,
  type UsersListResponse,
  type UsersInfoArguments,
  type UsersInfoResponse,
  type UsersLookupByEmailArguments,
  type UsersLookupByEmailResponse,
} from './client'

// Re-export from blocks
export * from './blocks'

// Re-export from messages
export {
  SlackMessages,
  createSlackMessages,
  MessageBuilder,
  message,
  SlackMessageError,
  // mrkdwn helpers
  bold,
  italic,
  strike,
  code,
  codeBlock,
  blockquote,
  link,
  mention,
  channel as mentionChannel,
  here,
  atChannel,
  everyone,
  date,
  emoji,
  numberedList,
  bulletList,
  escape,
  // types
  type MessageRef,
  type MessageMetadata as MessagesMetadata,
  type MessageContent,
  type PostMessageOptions,
  type EphemeralMessageOptions,
  type UpdateMessageOptions,
  type ScheduleMessageOptions,
  type PostMessageResponse,
  type EphemeralResponse,
  type UpdateResponse,
  type DeleteResponse,
  type ScheduleResponse,
  type SlackMessagesOptions,
} from './messages'

// Re-export types from types.ts for bolt compatibility
export type {
  Message,
  Channel,
  User,
  Block as BlockType,
  SectionBlock as SectionBlockType,
  DividerBlock as DividerBlockType,
  ImageBlock as ImageBlockType,
  ActionsBlock as ActionsBlockType,
  ContextBlock as ContextBlockType,
  InputBlock as InputBlockType,
  HeaderBlock as HeaderBlockType,
  TextObject as TextObjectType,
  ButtonElement as ButtonElementType,
  StaticSelectElement as StaticSelectElementType,
  Option as OptionType,
  SlackEvent,
  MessageEvent,
  AppMentionEvent,
  ReactionAddedEvent,
  ReactionRemovedEvent,
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
  SlackEventMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  SlackShortcutMiddlewareArgs,
  SlackCommandMiddlewareArgs,
  SayFn,
  RespondFn,
  AckFn,
  NextFn,
  Middleware,
  AppOptions,
} from './types'

// Re-export App and utilities from slack.ts for bolt compatibility
export {
  App,
  _clearAll,
  _getChannels,
  _getMessages,
  generateSignature,
  verifyRequestSignature,
} from './slack'

// Re-export channel management from channels.ts
export {
  ChannelManager,
  SlackChannelError,
  normalizeChannelName,
  isPublicChannel,
  isPrivateChannel,
  isDirectMessage,
  isMultiPartyDM,
  parseUserIds,
  formatUserIds,
  type ChannelManagerOptions,
  type SlackChannel as ChannelInfo,
  type ChannelTopic,
  type ChannelPurpose,
  type ConversationsCreateArguments,
  type ConversationsCreateResponse,
  type ConversationsArchiveArguments,
  type ConversationsArchiveResponse,
  type ConversationsUnarchiveArguments,
  type ConversationsUnarchiveResponse,
  type ConversationsInviteArguments,
  type ConversationsInviteResponse,
  type ConversationsKickArguments,
  type ConversationsKickResponse,
  type ConversationsSetTopicArguments,
  type ConversationsSetTopicResponse,
  type ConversationsSetPurposeArguments,
  type ConversationsSetPurposeResponse,
  type ConversationsMembersArguments,
  type ConversationsMembersResponse,
  type ConversationsRenameArguments,
  type ConversationsRenameResponse,
  type ConversationsMarkArguments,
  type ConversationsMarkResponse,
  type ConversationsOpenArguments,
  type ConversationsOpenResponse,
  type ConversationsCloseArguments,
  type ConversationsCloseResponse,
  type ConversationsRepliesArguments,
  type ConversationsRepliesResponse,
} from './channels'

// Default export
export { WebClient as default } from './client'
