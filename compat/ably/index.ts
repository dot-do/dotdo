/**
 * @dotdo/ably - Ably SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for ably backed by Durable Objects.
 * This implementation matches the Ably JavaScript API.
 *
 * @example
 * ```typescript
 * import * as Ably from '@dotdo/ably'
 *
 * // Create a Realtime client
 * const client = new Ably.Realtime({ key: 'your-api-key' })
 *
 * // Or with authentication options
 * const authClient = new Ably.Realtime({
 *   key: 'your-api-key',
 *   clientId: 'user-123',
 *   echoMessages: false,
 * })
 *
 * // Connection state management
 * client.connection.on('connected', () => {
 *   console.log('Connected to Ably')
 *   console.log('Connection ID:', client.connection.id)
 * })
 *
 * client.connection.on('disconnected', () => {
 *   console.log('Disconnected from Ably')
 * })
 *
 * client.connection.on((stateChange) => {
 *   console.log(`State changed: ${stateChange.previous} -> ${stateChange.current}`)
 *   if (stateChange.reason) {
 *     console.log('Reason:', stateChange.reason)
 *   }
 * })
 *
 * // Get a channel
 * const channel = client.channels.get('my-channel')
 *
 * // Subscribe to messages
 * channel.subscribe('greeting', (message) => {
 *   console.log('Received:', message.data)
 *   console.log('From:', message.clientId)
 *   console.log('ID:', message.id)
 *   console.log('Timestamp:', message.timestamp)
 * })
 *
 * // Subscribe to all events on channel
 * channel.subscribe((message) => {
 *   console.log(`Event: ${message.name}`, message.data)
 * })
 *
 * // Publish messages
 * await channel.publish('greeting', { text: 'Hello, World!' })
 *
 * // Publish with extras
 * await channel.publish({
 *   name: 'greeting',
 *   data: { text: 'Hello!' },
 *   extras: { headers: { 'x-custom': 'value' } },
 * })
 *
 * // Presence - enter the channel
 * await channel.presence.enter({ status: 'online', nickname: 'Alice' })
 *
 * // Presence - update data
 * await channel.presence.update({ status: 'away', nickname: 'Alice' })
 *
 * // Presence - leave the channel
 * await channel.presence.leave()
 *
 * // Presence - get current members
 * const members = await channel.presence.get()
 * members.forEach(member => {
 *   console.log(`${member.clientId}: ${member.data.status}`)
 * })
 *
 * // Presence - subscribe to enter/leave events
 * channel.presence.subscribe('enter', (member) => {
 *   console.log(`${member.clientId} entered`)
 * })
 *
 * channel.presence.subscribe('leave', (member) => {
 *   console.log(`${member.clientId} left`)
 * })
 *
 * channel.presence.subscribe((member) => {
 *   console.log(`Presence action: ${member.action} by ${member.clientId}`)
 * })
 *
 * // History - get past messages
 * const history = await channel.history({ limit: 100 })
 * history.items.forEach(msg => {
 *   console.log(`[${msg.timestamp}] ${msg.name}: ${msg.data}`)
 * })
 *
 * // Paginate through history
 * if (history.hasNext()) {
 *   const nextPage = await history.next()
 * }
 *
 * // Presence history
 * const presenceHistory = await channel.presence.history({ limit: 50 })
 *
 * // Channel state
 * channel.on('attached', () => {
 *   console.log('Channel attached')
 * })
 *
 * channel.on('detached', () => {
 *   console.log('Channel detached')
 * })
 *
 * // Detach from channel
 * await channel.detach()
 *
 * // Unsubscribe
 * channel.unsubscribe('greeting')
 * channel.presence.unsubscribe('enter')
 *
 * // Close connection
 * await client.close()
 * ```
 *
 * @see https://ably.com/docs/api/realtime-sdk
 */

// Export main client
export { Realtime, _clearAll, _getChannels, _getConnections } from '../../streaming/compat/ably/ably'
export { default } from '../../streaming/compat/ably/ably'

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
} from '../../streaming/compat/ably/types'

// Export error classes and utilities
export {
  AblyError,
  ConnectionError,
  ChannelError,
  isConnected,
  isAttached,
} from '../../streaming/compat/ably/types'
