/**
 * @dotdo/pusher types
 *
 * pusher-js compatible type definitions
 * for the Pusher SDK backed by Durable Objects
 *
 * @see https://pusher.com/docs/channels/using_channels/client-api-overview/
 */

// ============================================================================
// CONNECTION TYPES
// ============================================================================

/**
 * Connection state values
 */
export type ConnectionState =
  | 'initialized'
  | 'connecting'
  | 'connected'
  | 'unavailable'
  | 'failed'
  | 'disconnected'

/**
 * State change event data
 */
export interface StateChange {
  /** Previous connection state */
  previous: ConnectionState
  /** Current connection state */
  current: ConnectionState
}

/**
 * Connection interface
 */
export interface Connection {
  /** Current connection state */
  state: ConnectionState
  /** Socket ID (unique identifier for this connection) */
  socket_id: string | null
  /** Bind to connection events */
  bind(event: string, callback: (data?: unknown) => void): Connection
  /** Unbind from connection events */
  unbind(event?: string, callback?: (data?: unknown) => void): Connection
  /** Bind to an event once */
  bind_global(callback: (event: string, data?: unknown) => void): Connection
  /** Unbind global handler */
  unbind_global(callback?: (event: string, data?: unknown) => void): Connection
}

// ============================================================================
// CHANNEL TYPES
// ============================================================================

/**
 * Channel state values
 */
export type ChannelState =
  | 'initialized'
  | 'subscribing'
  | 'subscribed'
  | 'subscription_error'
  | 'unsubscribed'

/**
 * Base channel interface
 */
export interface Channel {
  /** Channel name */
  name: string
  /** Whether channel is subscribed */
  subscribed: boolean
  /** Bind to channel events */
  bind(event: string, callback: (data?: unknown) => void): Channel
  /** Unbind from channel events */
  unbind(event?: string, callback?: (data?: unknown) => void): Channel
  /** Bind to an event once */
  bind_global(callback: (event: string, data?: unknown) => void): Channel
  /** Unbind global handler */
  unbind_global(callback?: (event: string, data?: unknown) => void): Channel
  /** Trigger client event (for private/presence channels) */
  trigger(event: string, data: unknown): boolean
  /** Unsubscribe from channel */
  unsubscribe(): void
}

/**
 * Private channel interface
 */
export interface PrivateChannel extends Channel {
  /** Trigger client event */
  trigger(event: string, data: unknown): boolean
}

/**
 * Presence channel member info
 */
export interface PresenceMember {
  /** User ID */
  id: string
  /** User info */
  info?: Record<string, unknown>
}

/**
 * Presence channel members collection
 */
export interface Members {
  /** Current user */
  me: PresenceMember | null
  /** Count of members */
  count: number
  /** Iterate over members */
  each(callback: (member: PresenceMember) => void): void
  /** Get member by ID */
  get(userId: string): PresenceMember | null
  /** Get all members as array */
  toArray(): PresenceMember[]
}

/**
 * Presence channel interface
 */
export interface PresenceChannel extends PrivateChannel {
  /** Members collection */
  members: Members
}

// ============================================================================
// AUTH TYPES
// ============================================================================

/**
 * Auth endpoint function signature
 */
export type AuthorizerCallback = (
  error: Error | null,
  authData: AuthData | null
) => void

/**
 * Authorizer function signature
 */
export type Authorizer = (
  channel: { name: string },
  options: { socketId: string }
) => {
  authorize: (socketId: string, callback: AuthorizerCallback) => void
}

/**
 * Auth data returned from auth endpoint
 */
export interface AuthData {
  /** Auth signature */
  auth: string
  /** Channel data (for presence channels) */
  channel_data?: string
  /** Shared secret (optional) */
  shared_secret?: string
}

/**
 * Auth transport type
 */
export type AuthTransport = 'ajax' | 'jsonp'

/**
 * Auth options
 */
export interface AuthOptions {
  /** Auth endpoint URL */
  endpoint?: string
  /** Auth transport mechanism */
  transport?: AuthTransport
  /** Custom headers for auth request */
  headers?: Record<string, string>
  /** Custom params for auth request */
  params?: Record<string, string>
  /** Custom headers function */
  headersProvider?: () => Record<string, string>
  /** Custom params function */
  paramsProvider?: () => Record<string, string>
  /** Custom authorizer */
  customHandler?: Authorizer | null
}

/**
 * User authentication options
 */
export interface UserAuthenticationOptions {
  /** User auth endpoint URL */
  endpoint?: string
  /** Auth transport mechanism */
  transport?: AuthTransport
  /** Custom headers for auth request */
  headers?: Record<string, string>
  /** Custom params for auth request */
  params?: Record<string, string>
  /** Custom headers function */
  headersProvider?: () => Record<string, string>
  /** Custom params function */
  paramsProvider?: () => Record<string, string>
  /** Custom authorizer */
  customHandler?: ((params: { socketId: string }) => Promise<AuthData>) | null
}

/**
 * Channel authorization options
 */
export interface ChannelAuthorizationOptions extends AuthOptions {
  /** Custom authorizer factory */
  customHandler?: Authorizer | null
}

// ============================================================================
// PUSHER OPTIONS
// ============================================================================

/**
 * Pusher client options
 */
export interface PusherOptions {
  /** Cluster name (e.g., 'us2', 'eu', 'ap1') */
  cluster?: string
  /** Force TLS connection */
  forceTLS?: boolean
  /** Use encrypted connection (deprecated, use forceTLS) */
  encrypted?: boolean
  /** Auth options for private/presence channels */
  auth?: AuthOptions
  /** Channel authorization options */
  channelAuthorization?: ChannelAuthorizationOptions
  /** User authentication options */
  userAuthentication?: UserAuthenticationOptions
  /** Auth endpoint URL (shorthand for auth.endpoint) */
  authEndpoint?: string
  /** Auth transport (shorthand for auth.transport) */
  authTransport?: AuthTransport
  /** Custom authorizer (deprecated) */
  authorizer?: Authorizer
  /** Activity timeout in ms */
  activityTimeout?: number
  /** Pong timeout in ms */
  pongTimeout?: number
  /** Unavailable timeout in ms */
  unavailableTimeout?: number
  /** Disable stats */
  disableStats?: boolean
  /** Enable stats (deprecated) */
  enabledTransports?: string[]
  /** Disabled transports */
  disabledTransports?: string[]
  /** WebSocket host */
  wsHost?: string
  /** WebSocket port */
  wsPort?: number
  /** WebSocket path */
  wsPath?: string
  /** HTTP host */
  httpHost?: string
  /** HTTP port */
  httpPort?: number
  /** HTTPS port */
  httpsPort?: number
  /** Ignore null origin */
  ignoreNullOrigin?: boolean
  /** Enable logging */
  enableLogging?: boolean
  /** Log to console */
  logToConsole?: boolean
}

/**
 * Extended options for DO-backed implementation
 */
export interface ExtendedPusherOptions extends PusherOptions {
  /** DO namespace binding */
  doNamespace?: DurableObjectNamespace
  /** Shard configuration */
  shard?: {
    /** Sharding algorithm */
    algorithm?: 'consistent' | 'range' | 'hash'
    /** Number of shards */
    count?: number
  }
  /** Use Cloudflare Durable Objects pub/sub */
  useDOPubSub?: boolean
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Pusher event types for connection
 */
export interface ConnectionEvents {
  'state_change': (state: StateChange) => void
  'connected': (data?: { socket_id: string }) => void
  'connecting': () => void
  'disconnected': () => void
  'unavailable': () => void
  'failed': () => void
  'error': (error: PusherError) => void
  'message': (data: unknown) => void
}

/**
 * Pusher event types for channels
 */
export interface ChannelEvents {
  'pusher:subscription_succeeded': (data?: unknown) => void
  'pusher:subscription_error': (error: { type: string; error: string; status?: number }) => void
  'pusher:subscription_count': (data: { subscription_count: number }) => void
  'pusher:cache_miss': () => void
  [key: string]: (data?: unknown) => void
}

/**
 * Presence channel event types
 */
export interface PresenceChannelEvents extends ChannelEvents {
  'pusher:subscription_succeeded': (members: Members) => void
  'pusher:member_added': (member: PresenceMember) => void
  'pusher:member_removed': (member: PresenceMember) => void
}

// ============================================================================
// PUSHER CLIENT INTERFACE
// ============================================================================

/**
 * Pusher client interface (pusher-js compatible)
 */
export interface Pusher {
  /** Connection object */
  connection: Connection
  /** App key */
  key: string
  /** Client configuration */
  config: PusherOptions
  /** All subscribed channels */
  allChannels(): Channel[]
  /** Get a channel by name */
  channel(name: string): Channel | null
  /** Subscribe to a channel */
  subscribe(channelName: string): Channel
  /** Unsubscribe from a channel */
  unsubscribe(channelName: string): void
  /** Unsubscribe from all channels */
  unsubscribeAll(): void
  /** Bind to events on all channels */
  bind(event: string, callback: (data?: unknown) => void): Pusher
  /** Unbind from events on all channels */
  unbind(event?: string, callback?: (data?: unknown) => void): Pusher
  /** Bind to events globally */
  bind_global(callback: (event: string, data?: unknown) => void): Pusher
  /** Unbind global handler */
  unbind_global(callback?: (event: string, data?: unknown) => void): Pusher
  /** Connect to Pusher */
  connect(): void
  /** Disconnect from Pusher */
  disconnect(): void
  /** Send event (for server-side usage) */
  send_event(name: string, data: unknown, channel?: string): boolean
  /** Sign in user (for user authentication) */
  signin(): void
  /** Get user data */
  user: UserData
}

/**
 * User data interface
 */
export interface UserData {
  /** User ID */
  id?: string
  /** User info */
  info?: Record<string, unknown>
  /** Bind to user events */
  bind(event: string, callback: (data?: unknown) => void): void
  /** Unbind from user events */
  unbind(event?: string, callback?: (data?: unknown) => void): void
  /** User watchlist */
  watchlist: {
    /** Bind to watchlist events */
    bind(event: string, callback: (data?: unknown) => void): void
    /** Unbind from watchlist events */
    unbind(event?: string, callback?: (data?: unknown) => void): void
  }
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Pusher error
 */
export class PusherError extends Error {
  type: string
  data?: unknown

  constructor(message: string, type = 'PusherError', data?: unknown) {
    super(message)
    this.name = 'PusherError'
    this.type = type
    this.data = data
  }
}

/**
 * Connection error
 */
export class ConnectionError extends PusherError {
  constructor(message: string, data?: unknown) {
    super(message, 'ConnectionError', data)
    this.name = 'ConnectionError'
  }
}

/**
 * Auth error
 */
export class AuthError extends PusherError {
  status?: number

  constructor(message: string, status?: number, data?: unknown) {
    super(message, 'AuthError', data)
    this.name = 'AuthError'
    this.status = status
  }
}

/**
 * Subscription error
 */
export class SubscriptionError extends PusherError {
  status?: number

  constructor(message: string, status?: number, data?: unknown) {
    super(message, 'SubscriptionError', data)
    this.name = 'SubscriptionError'
    this.status = status
  }
}

// ============================================================================
// FACTORY TYPES
// ============================================================================

/**
 * Create Pusher client
 */
export type CreatePusher = {
  new (key: string, options?: PusherOptions): Pusher
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Event handler function
 */
export type EventHandler = (data?: unknown) => void

/**
 * Global event handler function
 */
export type GlobalEventHandler = (event: string, data?: unknown) => void

/**
 * Channel type discriminator
 * Note: Presence channels are also considered private channels
 */
export function isPrivateChannel(channel: Channel): channel is PrivateChannel {
  return channel.name.startsWith('private-') || channel.name.startsWith('presence-')
}

/**
 * Presence channel type discriminator
 */
export function isPresenceChannel(channel: Channel): channel is PresenceChannel {
  return channel.name.startsWith('presence-')
}
