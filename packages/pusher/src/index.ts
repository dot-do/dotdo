/**
 * @dotdo/pusher - Pusher SDK Compat Layer
 *
 * Drop-in replacement for pusher-js backed by in-memory pub/sub
 * for local development and edge-native performance.
 *
 * Features:
 * - API-compatible with `pusher-js` npm package
 * - Public, private, and presence channels
 * - Client events on private/presence channels
 * - Presence member tracking
 * - Connection state management
 * - Event binding with bind/unbind/bind_global
 *
 * @example Basic Usage
 * ```typescript
 * import Pusher from '@dotdo/pusher'
 *
 * const pusher = new Pusher('app-key', {
 *   cluster: 'mt1',
 *   forceTLS: true,
 * })
 *
 * // Subscribe to channels
 * const channel = pusher.subscribe('my-channel')
 * channel.bind('my-event', (data) => {
 *   console.log('Received:', data)
 * })
 * ```
 *
 * @example Private Channels with Client Events
 * ```typescript
 * import Pusher from '@dotdo/pusher'
 *
 * const pusher = new Pusher('app-key')
 * const privateChannel = pusher.subscribe('private-chat')
 *
 * // Listen for events
 * privateChannel.bind('client-message', (data) => {
 *   console.log('Message:', data.text)
 * })
 *
 * // Send client events (must start with 'client-')
 * privateChannel.trigger('client-message', { text: 'Hello!' })
 * ```
 *
 * @example Presence Channels with Member Tracking
 * ```typescript
 * import Pusher from '@dotdo/pusher'
 * import type { PresenceChannel, Members, PresenceMember } from '@dotdo/pusher'
 *
 * const pusher = new Pusher('app-key')
 * const presenceChannel = pusher.subscribe('presence-room') as PresenceChannel
 *
 * presenceChannel.bind('pusher:subscription_succeeded', (members: Members) => {
 *   console.log('Members online:', members.count)
 *   members.each((member) => {
 *     console.log('- ', member.id)
 *   })
 * })
 *
 * presenceChannel.bind('pusher:member_added', (member: PresenceMember) => {
 *   console.log('Member joined:', member.id)
 * })
 *
 * presenceChannel.bind('pusher:member_removed', (member: PresenceMember) => {
 *   console.log('Member left:', member.id)
 * })
 * ```
 *
 * @example Connection Management
 * ```typescript
 * import Pusher from '@dotdo/pusher'
 *
 * const pusher = new Pusher('app-key', { disableStats: true })
 *
 * pusher.connection.bind('state_change', ({ previous, current }) => {
 *   console.log(`Connection: ${previous} -> ${current}`)
 * })
 *
 * pusher.connection.bind('connected', () => {
 *   console.log('Socket ID:', pusher.connection.socket_id)
 * })
 *
 * pusher.connect()
 * ```
 *
 * @see https://pusher.com/docs/channels/using_channels/client-api-overview/
 */

// Export main client
export { Pusher, createPusher, _clearAll, _getChannels, _getConnections } from './client'
export { default } from './client'

// Export types
export type {
  Pusher as PusherClient,
  PusherOptions,
  ExtendedPusherOptions,
  Connection,
  ConnectionState,
  StateChange,
  Channel,
  ChannelState,
  PrivateChannel,
  PresenceChannel,
  PresenceMember,
  Members,
  AuthData,
  AuthOptions,
  AuthTransport,
  Authorizer,
  AuthorizerCallback,
  ChannelAuthorizationOptions,
  UserAuthenticationOptions,
  UserData,
  ConnectionEvents,
  ChannelEvents,
  PresenceChannelEvents,
  EventHandler,
  GlobalEventHandler,
  CreatePusher,
} from './types'

// Export error classes and utilities
export { PusherError, ConnectionError, AuthError, SubscriptionError, isPrivateChannel, isPresenceChannel } from './types'
