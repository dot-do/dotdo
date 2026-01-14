/**
 * Channel Factory
 *
 * Factory function for creating human notification channels from configuration.
 * Provides a unified way to instantiate channel implementations.
 *
 * @example
 * ```typescript
 * import { createChannel, createChannels } from 'lib/human/channel-factory'
 *
 * // Create a single channel
 * const slack = createChannel({
 *   type: 'slack',
 *   webhookUrl: 'https://hooks.slack.com/services/...',
 * })
 *
 * // Create multiple channels
 * const channels = createChannels([
 *   { type: 'slack', webhookUrl: '...' },
 *   { type: 'email', provider: 'sendgrid', apiKey: '...', from: '...' },
 * ])
 * ```
 *
 * @module lib/human/channel-factory
 */

import type { HumanNotificationChannel, ChannelType } from './channels/index'
import { SlackHumanChannel, type SlackChannelConfig } from './channels/slack'
import { EmailHumanChannel, type EmailChannelConfig } from './channels/email'
import { SMSHumanChannel, type SMSChannelConfig } from './channels/sms'
import { DiscordHumanChannel, type DiscordChannelConfig } from './channels/discord'
import { WebhookHumanChannel, type WebhookChannelConfig } from './channels/webhook'

// =============================================================================
// Types
// =============================================================================

/**
 * Union of all channel configurations with type discriminant
 */
export type ChannelConfig =
  | ({ type: 'slack' } & SlackChannelConfig)
  | ({ type: 'email' } & EmailChannelConfig)
  | ({ type: 'sms' } & SMSChannelConfig)
  | ({ type: 'discord' } & DiscordChannelConfig)
  | ({ type: 'webhook' } & WebhookChannelConfig)

/**
 * Options for the channel factory
 */
export interface ChannelFactoryOptions {
  /** Base URL for action links (overrides channel-specific config) */
  baseUrl?: string
  /** Custom fetch function (for testing) */
  fetch?: typeof fetch
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a channel from configuration
 *
 * @param config - Channel configuration with type discriminant
 * @param options - Optional factory options
 * @returns Configured channel instance
 *
 * @example
 * ```typescript
 * const channel = createChannel({
 *   type: 'slack',
 *   webhookUrl: process.env.SLACK_WEBHOOK_URL,
 * })
 *
 * await channel.send({
 *   requestId: 'req-123',
 *   message: 'Please approve this request',
 * })
 * ```
 */
export function createChannel(
  config: ChannelConfig,
  options?: ChannelFactoryOptions
): HumanNotificationChannel {
  const fetchFn = options?.fetch

  switch (config.type) {
    case 'slack':
      return new SlackHumanChannel({
        ...config,
        fetch: fetchFn || config.fetch,
      })

    case 'email':
      return new EmailHumanChannel({
        ...config,
        baseUrl: options?.baseUrl || config.baseUrl,
        fetch: fetchFn || config.fetch,
      })

    case 'sms':
      return new SMSHumanChannel({
        ...config,
        baseUrl: options?.baseUrl || config.baseUrl,
        fetch: fetchFn || config.fetch,
      })

    case 'discord':
      return new DiscordHumanChannel({
        ...config,
        fetch: fetchFn || config.fetch,
      })

    case 'webhook':
      return new WebhookHumanChannel({
        ...config,
        baseUrl: options?.baseUrl || config.baseUrl,
        fetch: fetchFn || config.fetch,
      })

    default:
      throw new Error(`Unknown channel type: ${(config as { type: string }).type}`)
  }
}

/**
 * Create multiple channels from configuration array
 *
 * @param configs - Array of channel configurations
 * @param options - Optional factory options applied to all channels
 * @returns Map of channel type to channel instance
 *
 * @example
 * ```typescript
 * const channels = createChannels([
 *   { type: 'slack', webhookUrl: '...' },
 *   { type: 'email', provider: 'sendgrid', apiKey: '...', from: '...' },
 * ])
 *
 * await channels.get('slack')?.send({ requestId: 'req-123', message: '...' })
 * ```
 */
export function createChannels(
  configs: ChannelConfig[],
  options?: ChannelFactoryOptions
): Map<ChannelType, HumanNotificationChannel> {
  const channels = new Map<ChannelType, HumanNotificationChannel>()

  for (const config of configs) {
    const channel = createChannel(config, options)
    channels.set(config.type, channel)
  }

  return channels
}

/**
 * Create channels as a record (object) instead of Map
 *
 * @param configs - Array of channel configurations
 * @param options - Optional factory options
 * @returns Record of channel type to channel instance
 *
 * @example
 * ```typescript
 * const channels = createChannelRecord([
 *   { type: 'slack', webhookUrl: '...' },
 *   { type: 'email', provider: 'sendgrid', apiKey: '...', from: '...' },
 * ])
 *
 * await channels.slack?.send({ requestId: 'req-123', message: '...' })
 * ```
 */
export function createChannelRecord(
  configs: ChannelConfig[],
  options?: ChannelFactoryOptions
): Partial<Record<ChannelType, HumanNotificationChannel>> {
  const channels: Partial<Record<ChannelType, HumanNotificationChannel>> = {}

  for (const config of configs) {
    const channel = createChannel(config, options)
    channels[config.type] = channel
  }

  return channels
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a channel supports waiting for responses
 */
export function isInteractiveChannel(
  channel: HumanNotificationChannel
): channel is HumanNotificationChannel & { waitForResponse: NonNullable<HumanNotificationChannel['waitForResponse']> } {
  return typeof channel.waitForResponse === 'function'
}

/**
 * Check if a channel supports updating notifications
 */
export function supportsNotificationUpdate(
  channel: HumanNotificationChannel
): channel is HumanNotificationChannel & { updateNotification: NonNullable<HumanNotificationChannel['updateNotification']> } {
  return typeof channel.updateNotification === 'function'
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get channel type from string (with validation)
 */
export function parseChannelType(type: string): ChannelType {
  const validTypes: ChannelType[] = ['slack', 'email', 'sms', 'discord', 'webhook']

  if (validTypes.includes(type as ChannelType)) {
    return type as ChannelType
  }

  throw new Error(`Invalid channel type: ${type}. Valid types: ${validTypes.join(', ')}`)
}

/**
 * Check if a value is a valid channel configuration
 */
export function isValidChannelConfig(config: unknown): config is ChannelConfig {
  if (!config || typeof config !== 'object') return false

  const c = config as Record<string, unknown>
  if (typeof c.type !== 'string') return false

  try {
    parseChannelType(c.type)
    return true
  } catch {
    return false
  }
}
