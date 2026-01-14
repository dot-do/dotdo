/**
 * @dotdo/ably types
 *
 * Ably SDK compatible type definitions
 * for the Ably Realtime SDK backed by Durable Objects
 *
 * @see https://ably.com/docs/api/realtime-sdk
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
  | 'disconnected'
  | 'suspended'
  | 'closing'
  | 'closed'
  | 'failed'

/**
 * Connection state change event
 */
export interface ConnectionStateChange {
  /** Previous state */
  previous: ConnectionState
  /** Current state */
  current: ConnectionState
  /** Reason for the state change */
  reason?: ErrorInfo
  /** Whether the state was retried */
  retryIn?: number
}

/**
 * Connection interface
 */
export interface Connection {
  /** Current connection state */
  state: ConnectionState
  /** Connection ID (unique identifier) */
  id: string | null
  /** Connection key for recovery */
  key: string | null
  /** Recovery key for connection recovery */
  recoveryKey: string | null
  /** Error reason if in failed state */
  errorReason: ErrorInfo | null
  /** Bind to connection events */
  on(event: string | ConnectionState | ConnectionState[], listener: (stateChange: ConnectionStateChange) => void): void
  /** Bind to connection events once */
  once(event: string | ConnectionState | ConnectionState[], listener: (stateChange: ConnectionStateChange) => void): void
  /** Unbind from connection events */
  off(event?: string | ConnectionState | ConnectionState[], listener?: (stateChange: ConnectionStateChange) => void): void
  /** Connect to Ably */
  connect(): void
  /** Close the connection */
  close(): void
  /** Ping the connection */
  ping(): Promise<number>
}

// ============================================================================
// CHANNEL TYPES
// ============================================================================

/**
 * Channel state values
 */
export type ChannelState =
  | 'initialized'
  | 'attaching'
  | 'attached'
  | 'detaching'
  | 'detached'
  | 'suspended'
  | 'failed'

/**
 * Channel state change event
 */
export interface ChannelStateChange {
  /** Previous state */
  previous: ChannelState
  /** Current state */
  current: ChannelState
  /** Reason for the state change */
  reason?: ErrorInfo
  /** Whether channel was resumed */
  resumed?: boolean
}

/**
 * Channel mode options
 */
export type ChannelMode = 'presence' | 'publish' | 'subscribe' | 'presence_subscribe'

/**
 * Channel options
 */
export interface ChannelOptions {
  /** Channel modes */
  modes?: ChannelMode[]
  /** Channel parameters */
  params?: Record<string, string>
  /** Cipher options for encryption */
  cipher?: CipherParams | CipherParamOptions
}

/**
 * Cipher parameters
 */
export interface CipherParams {
  /** Algorithm name */
  algorithm: string
  /** Key length */
  keyLength: number
  /** Mode */
  mode: string
  /** Key */
  key: ArrayBuffer | string
}

/**
 * Cipher parameter options
 */
export interface CipherParamOptions {
  /** Key */
  key: ArrayBuffer | string
  /** Algorithm (defaults to AES) */
  algorithm?: string
}

/**
 * Message interface
 */
export interface Message {
  /** Message ID */
  id?: string
  /** Message name/event */
  name?: string
  /** Message data */
  data?: unknown
  /** Client ID of the sender */
  clientId?: string
  /** Connection ID of the sender */
  connectionId?: string
  /** Message encoding */
  encoding?: string
  /** Message extras */
  extras?: MessageExtras
  /** Timestamp */
  timestamp?: number
}

/**
 * Message extras
 */
export interface MessageExtras {
  /** Headers */
  headers?: Record<string, string>
  /** Push notification config */
  push?: Record<string, unknown>
}

/**
 * History request parameters
 */
export interface RealtimeHistoryParams {
  /** Start time */
  start?: number
  /** End time */
  end?: number
  /** Limit */
  limit?: number
  /** Direction */
  direction?: 'forwards' | 'backwards'
  /** Untilattach */
  untilAttach?: boolean
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  /** Items */
  items: T[]
  /** Whether there are more items */
  hasNext(): boolean
  /** Whether this is the last page */
  isLast(): boolean
  /** Get next page */
  next(): Promise<PaginatedResult<T>>
  /** Get first page */
  first(): Promise<PaginatedResult<T>>
  /** Get current page */
  current(): Promise<PaginatedResult<T>>
}

/**
 * Channel interface
 */
export interface RealtimeChannel {
  /** Channel name */
  name: string
  /** Channel state */
  state: ChannelState
  /** Error reason if in failed state */
  errorReason: ErrorInfo | null
  /** Channel modes */
  modes: ChannelMode[]
  /** Channel parameters */
  params: Record<string, string>
  /** Channel properties */
  properties: ChannelProperties
  /** Presence object */
  presence: RealtimePresence
  /** Attach to the channel */
  attach(): Promise<void>
  /** Detach from the channel */
  detach(): Promise<void>
  /** Subscribe to messages */
  subscribe(listener: MessageListener): Promise<void>
  subscribe(event: string, listener: MessageListener): Promise<void>
  subscribe(events: string[], listener: MessageListener): Promise<void>
  /** Unsubscribe from messages */
  unsubscribe(listener?: MessageListener): void
  unsubscribe(event: string, listener?: MessageListener): void
  unsubscribe(events: string[], listener?: MessageListener): void
  /** Publish a message */
  publish(name: string, data?: unknown): Promise<void>
  publish(message: Message): Promise<void>
  publish(messages: Message[]): Promise<void>
  /** Get message history */
  history(params?: RealtimeHistoryParams): Promise<PaginatedResult<Message>>
  /** Bind to channel state events */
  on(event: string | ChannelState | ChannelState[], listener: (stateChange: ChannelStateChange) => void): void
  /** Bind to channel state events once */
  once(event: string | ChannelState | ChannelState[], listener: (stateChange: ChannelStateChange) => void): void
  /** Unbind from channel state events */
  off(event?: string | ChannelState | ChannelState[], listener?: (stateChange: ChannelStateChange) => void): void
  /** Set channel options */
  setOptions(options: ChannelOptions): Promise<void>
}

/**
 * Channel properties
 */
export interface ChannelProperties {
  /** Attach serial */
  attachSerial?: string
  /** Channel serial */
  channelSerial?: string
}

/**
 * Message listener function
 */
export type MessageListener = (message: Message) => void

/**
 * Channels collection interface
 */
export interface Channels {
  /** Get a channel */
  get(name: string, options?: ChannelOptions): RealtimeChannel
  /** Check if channel exists */
  exists(name: string): boolean
  /** Release a channel */
  release(name: string): void
  /** Iterate over channels */
  iterate(): IterableIterator<RealtimeChannel>
}

// ============================================================================
// PRESENCE TYPES
// ============================================================================

/**
 * Presence action values
 */
export type PresenceAction =
  | 'absent'
  | 'present'
  | 'enter'
  | 'leave'
  | 'update'

/**
 * Presence message interface
 */
export interface PresenceMessage {
  /** Message ID */
  id?: string
  /** Action type */
  action: PresenceAction
  /** Client ID */
  clientId: string
  /** Connection ID */
  connectionId?: string
  /** Presence data */
  data?: unknown
  /** Encoding */
  encoding?: string
  /** Timestamp */
  timestamp?: number
}

/**
 * Presence listener function
 */
export type PresenceListener = (member: PresenceMessage) => void

/**
 * Presence history parameters
 */
export interface RealtimePresenceParams {
  /** Wait for sync */
  waitForSync?: boolean
  /** Client ID filter */
  clientId?: string
  /** Connection ID filter */
  connectionId?: string
  /** Limit */
  limit?: number
}

/**
 * Realtime presence interface
 */
export interface RealtimePresence {
  /** Whether presence is synced */
  syncComplete: boolean
  /** Enter presence */
  enter(data?: unknown): Promise<void>
  /** Update presence data */
  update(data?: unknown): Promise<void>
  /** Leave presence */
  leave(data?: unknown): Promise<void>
  /** Get presence members */
  get(params?: RealtimePresenceParams): Promise<PresenceMessage[]>
  /** Subscribe to presence events */
  subscribe(listener: PresenceListener): Promise<void>
  subscribe(action: PresenceAction, listener: PresenceListener): Promise<void>
  subscribe(actions: PresenceAction[], listener: PresenceListener): Promise<void>
  /** Unsubscribe from presence events */
  unsubscribe(listener?: PresenceListener): void
  unsubscribe(action: PresenceAction, listener?: PresenceListener): void
  unsubscribe(actions: PresenceAction[], listener?: PresenceListener): void
  /** Get presence history */
  history(params?: RealtimeHistoryParams): Promise<PaginatedResult<PresenceMessage>>
}

// ============================================================================
// CLIENT OPTIONS
// ============================================================================

/**
 * Client options
 */
export interface ClientOptions {
  /** API key */
  key?: string
  /** Token for authentication */
  token?: string
  /** Token details */
  tokenDetails?: TokenDetails
  /** Auth URL */
  authUrl?: string
  /** Auth method */
  authMethod?: 'GET' | 'POST'
  /** Auth headers */
  authHeaders?: Record<string, string>
  /** Auth params */
  authParams?: Record<string, string>
  /** Auth callback */
  authCallback?: AuthCallback
  /** Client ID */
  clientId?: string
  /** Log level */
  logLevel?: LogLevel
  /** Log handler */
  logHandler?: LogHandler
  /** TLS */
  tls?: boolean
  /** Environment */
  environment?: string
  /** Rest host */
  restHost?: string
  /** Realtime host */
  realtimeHost?: string
  /** Port */
  port?: number
  /** TLS port */
  tlsPort?: number
  /** Fallback hosts */
  fallbackHosts?: string[]
  /** HTTP open timeout */
  httpOpenTimeout?: number
  /** HTTP request timeout */
  httpRequestTimeout?: number
  /** HTTP max retry count */
  httpMaxRetryCount?: number
  /** Realtime request timeout */
  realtimeRequestTimeout?: number
  /** Auto connect */
  autoConnect?: boolean
  /** Use binary protocol */
  useBinaryProtocol?: boolean
  /** Queue messages */
  queueMessages?: boolean
  /** Echo messages */
  echoMessages?: boolean
  /** Recover */
  recover?: string | RecoverCallback
  /** Transports */
  transports?: string[]
  /** Transport params */
  transportParams?: Record<string, string>
  /** Default token params */
  defaultTokenParams?: TokenParams
}

/**
 * Token details
 */
export interface TokenDetails {
  /** Token string */
  token: string
  /** Expiry time */
  expires?: number
  /** Issued time */
  issued?: number
  /** Capability */
  capability?: string
  /** Client ID */
  clientId?: string
}

/**
 * Token params
 */
export interface TokenParams {
  /** Time to live */
  ttl?: number
  /** Capability */
  capability?: string
  /** Client ID */
  clientId?: string
  /** Timestamp */
  timestamp?: number
  /** Nonce */
  nonce?: string
}

/**
 * Auth callback
 */
export type AuthCallback = (
  tokenParams: TokenParams,
  callback: (error: ErrorInfo | null, tokenRequestOrDetails: TokenRequest | TokenDetails | string | null) => void
) => void

/**
 * Token request
 */
export interface TokenRequest {
  /** Key name */
  keyName: string
  /** Client ID */
  clientId?: string
  /** Nonce */
  nonce: string
  /** Timestamp */
  timestamp: number
  /** Capability */
  capability?: string
  /** TTL */
  ttl?: number
  /** MAC */
  mac: string
}

/**
 * Recover callback
 */
export type RecoverCallback = (
  lastConnectionDetails: {
    recoveryKey: string
    disconnectedAt: number
    location: string
    clientId: string | null
  },
  callback: (shouldRecover: boolean) => void
) => void

/**
 * Log level
 */
export type LogLevel = 0 | 1 | 2 | 3 | 4

/**
 * Log handler
 */
export type LogHandler = (level: LogLevel, message: string) => void

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Error info interface
 */
export interface ErrorInfo {
  /** Error code */
  code: number
  /** Status code */
  statusCode?: number
  /** Error message */
  message: string
  /** Cause */
  cause?: Error | ErrorInfo
  /** HREF for more info */
  href?: string
}

/**
 * Ably error class
 */
export class AblyError extends Error {
  code: number
  statusCode?: number
  cause?: Error | ErrorInfo

  constructor(message: string, code = 40000, statusCode?: number, cause?: Error | ErrorInfo) {
    super(message)
    this.name = 'AblyError'
    this.code = code
    this.statusCode = statusCode
    this.cause = cause
  }

  toJSON(): ErrorInfo {
    return {
      code: this.code,
      statusCode: this.statusCode,
      message: this.message,
      cause: this.cause,
    }
  }
}

/**
 * Connection error
 */
export class ConnectionError extends AblyError {
  constructor(message: string, code = 80000, statusCode?: number) {
    super(message, code, statusCode)
    this.name = 'ConnectionError'
  }
}

/**
 * Channel error
 */
export class ChannelError extends AblyError {
  constructor(message: string, code = 90000, statusCode?: number) {
    super(message, code, statusCode)
    this.name = 'ChannelError'
  }
}

// ============================================================================
// REALTIME CLIENT INTERFACE
// ============================================================================

/**
 * Realtime client interface (Ably SDK compatible)
 */
export interface Realtime {
  /** Client options */
  options: ClientOptions
  /** Connection object */
  connection: Connection
  /** Channels collection */
  channels: Channels
  /** Client ID */
  clientId: string | null
  /** Auth object */
  auth: Auth
  /** Close the client */
  close(): Promise<void>
  /** Connect */
  connect(): void
  /** Get time from Ably servers */
  time(): Promise<number>
  /** Get stats */
  stats(params?: StatsParams): Promise<PaginatedResult<Stats>>
  /** Request */
  request(method: string, path: string, version: number, params?: Record<string, string>, body?: unknown, headers?: Record<string, string>): Promise<HttpPaginatedResponse>
}

/**
 * Auth interface
 */
export interface Auth {
  /** Client ID */
  clientId: string | null
  /** Authorize */
  authorize(tokenParams?: TokenParams, authOptions?: AuthOptions): Promise<TokenDetails>
  /** Create token request */
  createTokenRequest(tokenParams?: TokenParams, authOptions?: AuthOptions): Promise<TokenRequest>
  /** Request token */
  requestToken(tokenParams?: TokenParams, authOptions?: AuthOptions): Promise<TokenDetails>
}

/**
 * Auth options
 */
export interface AuthOptions {
  /** Key */
  key?: string
  /** Token */
  token?: string
  /** Token details */
  tokenDetails?: TokenDetails
  /** Auth URL */
  authUrl?: string
  /** Auth method */
  authMethod?: 'GET' | 'POST'
  /** Auth headers */
  authHeaders?: Record<string, string>
  /** Auth params */
  authParams?: Record<string, string>
  /** Auth callback */
  authCallback?: AuthCallback
  /** Query time */
  queryTime?: boolean
  /** Force */
  force?: boolean
}

/**
 * Stats parameters
 */
export interface StatsParams {
  /** Start time */
  start?: number
  /** End time */
  end?: number
  /** Limit */
  limit?: number
  /** Direction */
  direction?: 'forwards' | 'backwards'
  /** Unit */
  unit?: 'minute' | 'hour' | 'day' | 'month'
}

/**
 * Stats object
 */
export interface Stats {
  /** Interval ID */
  intervalId: string
  /** All messages */
  all: MessageTypes
  /** Inbound messages */
  inbound: MessageTraffic
  /** Outbound messages */
  outbound: MessageTraffic
  /** Persisted messages */
  persisted: MessageTypes
  /** Connections */
  connections: ConnectionTypes
  /** Channels */
  channels: ResourceCount
  /** API requests */
  apiRequests: RequestCount
  /** Token requests */
  tokenRequests: RequestCount
}

/**
 * Message types
 */
export interface MessageTypes {
  /** All */
  all: MessageCount
  /** Messages */
  messages: MessageCount
  /** Presence */
  presence: MessageCount
}

/**
 * Message traffic
 */
export interface MessageTraffic {
  /** All */
  all: MessageTypes
  /** Realtime */
  realtime: MessageTypes
  /** REST */
  rest: MessageTypes
  /** Webhook */
  webhook: MessageTypes
  /** Push */
  push: MessageTypes
}

/**
 * Message count
 */
export interface MessageCount {
  /** Count */
  count: number
  /** Data */
  data: number
}

/**
 * Connection types
 */
export interface ConnectionTypes {
  /** All */
  all: ResourceCount
  /** Plain */
  plain: ResourceCount
  /** TLS */
  tls: ResourceCount
}

/**
 * Resource count
 */
export interface ResourceCount {
  /** Peak */
  peak: number
  /** Min */
  min: number
  /** Mean */
  mean: number
  /** Opened */
  opened: number
  /** Refused */
  refused?: number
}

/**
 * Request count
 */
export interface RequestCount {
  /** Succeeded */
  succeeded: number
  /** Failed */
  failed: number
  /** Refused */
  refused: number
}

/**
 * HTTP paginated response
 */
export interface HttpPaginatedResponse {
  /** Items */
  items: unknown[]
  /** Status code */
  statusCode: number
  /** Success */
  success: boolean
  /** Error code */
  errorCode?: number
  /** Error message */
  errorMessage?: string
  /** Headers */
  headers: Record<string, string>
  /** Has next */
  hasNext(): boolean
  /** Is last */
  isLast(): boolean
  /** Next */
  next(): Promise<HttpPaginatedResponse>
  /** First */
  first(): Promise<HttpPaginatedResponse>
  /** Current */
  current(): Promise<HttpPaginatedResponse>
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Event handler function
 */
export type EventHandler<T = unknown> = (data: T) => void

/**
 * State change handler
 */
export type StateChangeHandler<T extends ConnectionStateChange | ChannelStateChange> = (stateChange: T) => void

/**
 * Check if channel is attached
 */
export function isAttached(channel: RealtimeChannel): boolean {
  return channel.state === 'attached'
}

/**
 * Check if connection is connected
 */
export function isConnected(connection: Connection): boolean {
  return connection.state === 'connected'
}
