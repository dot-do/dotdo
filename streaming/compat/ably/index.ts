/**
 * @dotdo/ably - Ably SDK compat
 *
 * Drop-in replacement for ably backed by Durable Objects.
 *
 * @example
 * ```typescript
 * import * as Ably from '@dotdo/ably'
 *
 * const client = new Ably.Realtime({ key: 'your-api-key' })
 *
 * // Subscribe to channel
 * const channel = client.channels.get('my-channel')
 * channel.subscribe('greeting', (message) => {
 *   console.log(message.data)
 * })
 *
 * // Publish
 * await channel.publish('greeting', { text: 'Hello!' })
 *
 * // Presence
 * await channel.presence.enter({ status: 'online' })
 * const members = await channel.presence.get()
 * channel.presence.subscribe('enter', (member) => {
 *   console.log(member.clientId, 'entered')
 * })
 *
 * // History
 * const history = await channel.history({ limit: 10 })
 *
 * // Connection state
 * client.connection.on('connected', () => console.log('Connected'))
 *
 * await client.close()
 * ```
 *
 * @see https://ably.com/docs/api/realtime-sdk
 */

// Export main client
export { Realtime, _clearAll, _getChannels, _getConnections } from './ably'
export { default } from './ably'

// Export types
export type {
  Realtime as RealtimeClient,
  ClientOptions,
  Connection,
  ConnectionState,
  ConnectionStateChange,
  Channels,
  RealtimeChannel,
  ChannelState,
  ChannelStateChange,
  ChannelOptions,
  ChannelMode,
  ChannelProperties,
  RealtimePresence,
  Message,
  MessageListener,
  MessageExtras,
  PresenceMessage,
  PresenceAction,
  PresenceListener,
  RealtimeHistoryParams,
  RealtimePresenceParams,
  PaginatedResult,
  Auth,
  AuthOptions,
  AuthCallback,
  TokenDetails,
  TokenParams,
  TokenRequest,
  ErrorInfo,
  Stats,
  StatsParams,
  HttpPaginatedResponse,
  CipherParams,
  CipherParamOptions,
  LogLevel,
  LogHandler,
  RecoverCallback,
  EventHandler,
  StateChangeHandler,
} from './types'

// Export error classes and utilities
export {
  AblyError,
  ConnectionError,
  ChannelError,
  isConnected,
  isAttached,
} from './types'
