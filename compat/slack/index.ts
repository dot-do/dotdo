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
  type UsersListArguments,
  type UsersListResponse,
  type UsersInfoArguments,
  type UsersInfoResponse,
  type UsersLookupByEmailArguments,
  type UsersLookupByEmailResponse,
} from './client'

// Re-export from blocks
export * from './blocks'

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

// Default export
export { WebClient as default } from './client'
