/**
 * @dotdo/pusher - Pusher SDK compat
 *
 * Drop-in replacement for pusher-js backed by Durable Objects.
 *
 * @example
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
 *
 * // Private channels
 * const privateChannel = pusher.subscribe('private-channel')
 * privateChannel.trigger('client-event', { message: 'Hello' })
 *
 * // Presence channels
 * const presenceChannel = pusher.subscribe('presence-room')
 * presenceChannel.bind('pusher:subscription_succeeded', (members) => {
 *   console.log('Members:', members.count)
 * })
 * presenceChannel.bind('pusher:member_added', (member) => {
 *   console.log('Member joined:', member.id)
 * })
 * ```
 *
 * @see https://pusher.com/docs/channels/using_channels/client-api-overview/
 */

// Export main client
export { Pusher, createPusher, _clearAll, _getChannels, _getConnections } from './pusher'
export { default } from './pusher'

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

// Export error classes
export {
  PusherError,
  ConnectionError,
  AuthError,
  SubscriptionError,
  isPrivateChannel,
  isPresenceChannel,
} from './types'
