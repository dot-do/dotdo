/**
 * Channel Adapters
 *
 * Provides channel implementations for human-in-the-loop notifications
 * and interactive workflows.
 *
 * @module lib/channels
 */

// ============================================================================
// SHARED TYPES
// ============================================================================

export type {
  // Action types
  Action,
  StyledAction,
  // Notification types
  NotificationPayload,
  NotificationResult,
  // Human response
  HumanResponse,
  // Channel configuration (shared base types)
  ChannelType,
  BaseChannelConfig,
  SlackChannelConfig,
  EmailProvider,
  MDXUIChannelConfig,
  ChannelConfig,
  // Form types
  TextFormField,
  SelectFormField,
  BooleanFormField,
  FormFieldType,
  // Channel interfaces
  Channel,
  InteractiveChannel,
} from './types'

// Re-export channel-specific config as shared type aliases
export type { DiscordChannelConfig as SharedDiscordChannelConfig } from './types'
export type { EmailChannelConfig as SharedEmailChannelConfig } from './types'
export type { FormField as SharedFormField } from './types'

// ============================================================================
// BASE CLASS & UTILITIES
// ============================================================================

export {
  BaseChannel,
  InteractiveBaseChannel,
  generateMessageId,
  withTimeout,
  parseActionId,
  buildActionId,
} from './base'

// ============================================================================
// SLACK BLOCKKIT CHANNEL
// ============================================================================

export {
  SlackBlockKitChannel,
  buildApprovalBlocks,
  buildFormBlocks,
  type ApprovalBlocksOptions,
  type FormBlocksOptions,
  type SlackBlockKitConfig,
  type SlackBlock,
  type FormField as SlackFormField,
} from './slack-blockkit'

// ============================================================================
// DISCORD CHANNEL
// ============================================================================

export {
  DiscordChannel,
  buildEmbed,
  buildActionRow,
  type EmbedField,
  type EmbedOptions,
  type DiscordEmbed,
  type ActionButton,
  type ActionRowOptions,
  type DiscordButton,
  type DiscordActionRow,
  type DiscordChannelConfig,
  type SendPayload as DiscordSendPayload,
  type SendResult as DiscordSendResult,
  type DiscordReaction,
  type ReactionResponse,
} from './discord'

// ============================================================================
// EMAIL CHANNEL
// ============================================================================

export {
  EmailChannel,
  renderApprovalEmail,
  renderNotificationEmail,
  type ApprovalEmailOptions,
  type ApprovalEmailResult,
  type NotificationEmailOptions,
  type EmailChannelConfig,
  type EmailPayload,
  type EmailSendResult,
  type EmailWebhook,
  type WebhookResponse,
} from './email'

// ============================================================================
// MDXUI CHAT CHANNEL
// ============================================================================

export {
  MDXUIChatChannel,
  ChatConversation,
  type ChatAction,
  type ChatFormField,
  type ChatMessage,
  type ChatConversationOptions,
  type UserDOBinding,
  type MDXUIChatConfig,
  type SendPayload as MDXUISendPayload,
  type WaitForResponseParams,
  type UserResponse,
} from './mdxui-chat'

// ============================================================================
// CHANNEL REGISTRY
// ============================================================================

import { SlackBlockKitChannel, type SlackBlockKitConfig } from './slack-blockkit'
import { DiscordChannel, type DiscordChannelConfig } from './discord'
import { EmailChannel, type EmailChannelConfig } from './email'
import { MDXUIChatChannel, type MDXUIChatConfig } from './mdxui-chat'
import type { ChannelType } from './types'

/**
 * Channel constructor types for the registry
 */
export type ChannelConstructor =
  | typeof SlackBlockKitChannel
  | typeof DiscordChannel
  | typeof EmailChannel
  | typeof MDXUIChatChannel

/**
 * Channel instance types
 */
export type ChannelInstance =
  | SlackBlockKitChannel
  | DiscordChannel
  | EmailChannel
  | MDXUIChatChannel

/**
 * Configuration type for each channel type
 */
export type ChannelConfigFor<T extends ChannelType> =
  T extends 'slack' ? SlackBlockKitConfig :
  T extends 'discord' ? DiscordChannelConfig :
  T extends 'email' ? EmailChannelConfig :
  T extends 'mdxui' ? MDXUIChatConfig :
  never

/**
 * Simple Map-based channel registry
 *
 * Allows registration and lookup of channel implementations by type.
 */
class ChannelRegistry {
  private channels = new Map<ChannelType, ChannelConstructor>()

  constructor() {
    // Register built-in channels
    this.channels.set('slack', SlackBlockKitChannel)
    this.channels.set('discord', DiscordChannel)
    this.channels.set('email', EmailChannel)
    this.channels.set('mdxui', MDXUIChatChannel)
  }

  /**
   * Get a channel constructor by type
   */
  get(type: ChannelType): ChannelConstructor | undefined {
    return this.channels.get(type)
  }

  /**
   * Register a channel constructor
   */
  register(type: ChannelType, constructor: ChannelConstructor): void {
    this.channels.set(type, constructor)
  }

  /**
   * Check if a channel type is registered
   */
  has(type: ChannelType): boolean {
    return this.channels.has(type)
  }

  /**
   * Get all registered channel types
   */
  types(): ChannelType[] {
    return Array.from(this.channels.keys())
  }

  /**
   * Create a channel instance from configuration
   * Note: Type safety is limited here due to different config shapes
   */
  create(type: 'slack', config: SlackBlockKitConfig): SlackBlockKitChannel
  create(type: 'discord', config: DiscordChannelConfig): DiscordChannel
  create(type: 'email', config: EmailChannelConfig): EmailChannel
  create(type: 'mdxui', config: MDXUIChatConfig): MDXUIChatChannel
  create(type: ChannelType, config: unknown): ChannelInstance {
    const Constructor = this.channels.get(type)
    if (!Constructor) {
      throw new Error(`Unknown channel type: ${type}`)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new (Constructor as any)(config)
  }
}

/**
 * Global channel registry instance
 */
export const channelRegistry = new ChannelRegistry()

/**
 * Create a channel instance from type and configuration
 * Convenience function that uses the global registry
 */
export function createChannel(type: 'slack', config: SlackBlockKitConfig): SlackBlockKitChannel
export function createChannel(type: 'discord', config: DiscordChannelConfig): DiscordChannel
export function createChannel(type: 'email', config: EmailChannelConfig): EmailChannel
export function createChannel(type: 'mdxui', config: MDXUIChatConfig): MDXUIChatChannel
export function createChannel(type: ChannelType, config: unknown): ChannelInstance {
  return channelRegistry.create(type as 'slack', config as SlackBlockKitConfig)
}
