/**
 * @dotdo/socketio types
 *
 * socket.io-client compatible type definitions
 * for the Socket.IO SDK backed by Durable Objects
 *
 * @see https://socket.io/docs/v4/client-api/
 */

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Event callback function
 */
export type EventCallback = (...args: unknown[]) => void

/**
 * Acknowledgement callback
 */
export type AckCallback = (...args: unknown[]) => void

/**
 * Error-first acknowledgement callback (for timeout)
 */
export type TimeoutAckCallback = (err: Error | null, ...args: unknown[]) => void

/**
 * Reserved events that are used by Socket.IO internally
 */
export interface ReservedEvents {
  connect: () => void
  connect_error: (error: Error) => void
  disconnect: (reason: DisconnectReason, description?: DisconnectDescription) => void
}

/**
 * Disconnect reasons
 */
export type DisconnectReason =
  | 'io server disconnect'
  | 'io client disconnect'
  | 'ping timeout'
  | 'transport close'
  | 'transport error'
  | 'parse error'

/**
 * Disconnect description
 */
export interface DisconnectDescription {
  description?: string
  context?: unknown
}

// ============================================================================
// SOCKET OPTIONS
// ============================================================================

/**
 * Socket.IO connection options
 */
export interface SocketOptions {
  /** Authentication data sent on connection */
  auth?: Record<string, unknown> | ((cb: (data: Record<string, unknown>) => void) => void)
  /** Query parameters for the connection */
  query?: Record<string, string>
  /** Transport types to use */
  transports?: ('websocket' | 'polling')[]
  /** Namespace to connect to */
  nsp?: string
  /** Force new connection even if one exists */
  forceNew?: boolean
  /** Whether to reconnect automatically */
  reconnection?: boolean
  /** Number of reconnection attempts */
  reconnectionAttempts?: number
  /** Time to wait between reconnection attempts (ms) */
  reconnectionDelay?: number
  /** Maximum reconnection delay (ms) */
  reconnectionDelayMax?: number
  /** Randomization factor for reconnection delay */
  randomizationFactor?: number
  /** Connection timeout (ms) */
  timeout?: number
  /** Auto-connect on creation */
  autoConnect?: boolean
  /** Parser to use */
  parser?: unknown
  /** Path for the socket.io endpoint */
  path?: string
  /** Whether to multiplex connections */
  multiplex?: boolean
  /** Upgrade from polling to websocket */
  upgrade?: boolean
  /** Remember upgrade */
  rememberUpgrade?: boolean
  /** Extra headers */
  extraHeaders?: Record<string, string>
  /** With credentials for CORS */
  withCredentials?: boolean
  /** Force base64 encoding */
  forceBase64?: boolean
  /** Timestamps for cache busting */
  timestampRequests?: boolean
  /** Timestamp parameter name */
  timestampParam?: string
  /** Close delay for cleanup */
  closeOnBeforeunload?: boolean
  /** Protocol version */
  protocols?: string | string[]
}

/**
 * Extended options for DO-backed implementation
 */
export interface ExtendedSocketOptions extends SocketOptions {
  /** DO namespace binding */
  doNamespace?: DurableObjectNamespace
  /** Custom event handlers for DO integration */
  doEventHandlers?: {
    /** Handle incoming message from DO */
    onMessage?: (data: unknown) => void
    /** Handle connection state change */
    onStateChange?: (state: SocketState) => void
  }
}

// ============================================================================
// SOCKET STATE
// ============================================================================

/**
 * Socket connection state
 */
export type SocketState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting'

// ============================================================================
// MANAGER OPTIONS
// ============================================================================

/**
 * Manager options for socket.io connection manager
 */
export interface ManagerOptions extends SocketOptions {
  /** Enable reconnection */
  reconnection?: boolean
  /** Max reconnection attempts */
  reconnectionAttempts?: number
  /** Reconnection delay in ms */
  reconnectionDelay?: number
  /** Max reconnection delay in ms */
  reconnectionDelayMax?: number
  /** Randomization factor */
  randomizationFactor?: number
  /** Connection timeout in ms */
  timeout?: number
  /** Auto-connect on creation */
  autoConnect?: boolean
  /** Parser to use */
  parser?: unknown
}

// ============================================================================
// BROADCAST OPERATOR
// ============================================================================

/**
 * Broadcast operator for targeting specific rooms
 */
export interface BroadcastOperator<T = unknown> {
  /** Emit an event to the selected targets */
  emit(event: string, ...args: unknown[]): boolean
  /** Target specific rooms */
  to(room: string | string[]): BroadcastOperator<T>
  /** Alias for to() */
  in(room: string | string[]): BroadcastOperator<T>
  /** Exclude specific rooms */
  except(room: string | string[]): BroadcastOperator<T>
  /** Compress the data */
  compress(compress: boolean): BroadcastOperator<T>
  /** Mark as volatile (no guaranteed delivery) */
  volatile: BroadcastOperator<T>
  /** Mark as local (only this node) */
  local: BroadcastOperator<T>
  /** Set timeout for acknowledgement */
  timeout(timeout: number): BroadcastOperator<T>
  /** Get sockets matching criteria */
  fetchSockets(): Promise<RemoteSocket<T>[]>
  /** Make sockets join a room */
  socketsJoin(room: string | string[]): void
  /** Make sockets leave a room */
  socketsLeave(room: string | string[]): void
  /** Disconnect sockets */
  disconnectSockets(close?: boolean): void
}

/**
 * Remote socket representation (for server-side)
 */
export interface RemoteSocket<T = unknown> {
  /** Socket ID */
  id: string
  /** Handshake data */
  handshake: Handshake
  /** Rooms the socket is in */
  rooms: Set<string>
  /** Socket data */
  data: T
  /** Emit to this socket */
  emit(event: string, ...args: unknown[]): boolean
  /** Join a room */
  join(room: string | string[]): void
  /** Leave a room */
  leave(room: string): void
  /** Disconnect the socket */
  disconnect(close?: boolean): void
}

/**
 * Handshake data
 */
export interface Handshake {
  /** Request headers */
  headers: Record<string, string>
  /** Timestamp of connection */
  time: string
  /** IP address */
  address: string
  /** XDomain flag */
  xdomain: boolean
  /** Secure connection flag */
  secure: boolean
  /** Issued timestamp */
  issued: number
  /** URL */
  url: string
  /** Query parameters */
  query: Record<string, string>
  /** Auth data */
  auth: Record<string, unknown>
}

// ============================================================================
// SOCKET INTERFACE
// ============================================================================

/**
 * Socket.IO socket interface
 */
export interface Socket<
  ListenEvents extends Record<string, EventCallback> = Record<string, EventCallback>,
  EmitEvents extends Record<string, EventCallback> = Record<string, EventCallback>,
> {
  /** Socket ID */
  readonly id: string

  /** Connection state */
  readonly connected: boolean

  /** Disconnected state */
  readonly disconnected: boolean

  /** Whether socket is recovering from disconnection */
  readonly recovered: boolean

  /** Active state - alias for connected */
  readonly active: boolean

  /** Volatile flag for unreliable delivery */
  readonly volatile: this

  /** IO manager */
  readonly io: Manager

  /** Namespace */
  readonly nsp: string

  /** Authentication data */
  auth: Record<string, unknown> | ((cb: (data: Record<string, unknown>) => void) => void)

  // ============================================================================
  // EVENT METHODS
  // ============================================================================

  /**
   * Register an event listener
   */
  on<E extends keyof ListenEvents>(event: E, listener: ListenEvents[E]): this
  on(event: string, listener: EventCallback): this

  /**
   * Register a one-time event listener
   */
  once<E extends keyof ListenEvents>(event: E, listener: ListenEvents[E]): this
  once(event: string, listener: EventCallback): this

  /**
   * Remove an event listener
   */
  off<E extends keyof ListenEvents>(event: E, listener?: ListenEvents[E]): this
  off(event: string, listener?: EventCallback): this

  /**
   * Remove all listeners for an event
   */
  removeAllListeners<E extends keyof ListenEvents>(event?: E): this
  removeAllListeners(event?: string): this

  /**
   * Get all listeners for an event
   */
  listeners<E extends keyof ListenEvents>(event: E): ListenEvents[E][]
  listeners(event: string): EventCallback[]

  /**
   * Check if there are listeners for an event
   */
  hasListeners<E extends keyof ListenEvents>(event: E): boolean
  hasListeners(event: string): boolean

  /**
   * Alias for on()
   */
  addEventListener<E extends keyof ListenEvents>(event: E, listener: ListenEvents[E]): this
  addEventListener(event: string, listener: EventCallback): this

  /**
   * Alias for off()
   */
  removeEventListener<E extends keyof ListenEvents>(event: E, listener?: ListenEvents[E]): this
  removeEventListener(event: string, listener?: EventCallback): this

  // ============================================================================
  // EMIT METHODS
  // ============================================================================

  /**
   * Emit an event
   */
  emit<E extends keyof EmitEvents>(event: E, ...args: Parameters<EmitEvents[E]>): this
  emit(event: string, ...args: unknown[]): this

  /**
   * Emit with acknowledgement
   */
  emitWithAck<E extends keyof EmitEvents>(event: E, ...args: unknown[]): Promise<unknown>
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown>

  /**
   * Set timeout for next emit
   */
  timeout(timeout: number): TimeoutSocket<ListenEvents, EmitEvents>

  // ============================================================================
  // CONNECTION METHODS
  // ============================================================================

  /**
   * Connect to the server
   */
  connect(): this

  /**
   * Alias for connect()
   */
  open(): this

  /**
   * Disconnect from the server
   */
  disconnect(): this

  /**
   * Alias for disconnect()
   */
  close(): this

  // ============================================================================
  // ROOM METHODS (Server-side simulation)
  // ============================================================================

  /**
   * Join a room
   */
  join(room: string | string[]): void

  /**
   * Leave a room
   */
  leave(room: string): void

  /**
   * Get rooms the socket is in
   */
  readonly rooms: Set<string>

  /**
   * Target specific rooms for next emit
   */
  to(room: string | string[]): BroadcastOperator

  /**
   * Alias for to()
   */
  in(room: string | string[]): BroadcastOperator

  /**
   * Exclude specific rooms from next emit
   */
  except(room: string | string[]): BroadcastOperator

  /**
   * Broadcast to all clients in namespace (except self)
   */
  readonly broadcast: BroadcastOperator

  // ============================================================================
  // COMPRESSION
  // ============================================================================

  /**
   * Set compression for next message
   */
  compress(compress: boolean): this

  // ============================================================================
  // SEND ALIAS
  // ============================================================================

  /**
   * Send a message (alias for emit('message', ...))
   */
  send(...args: unknown[]): this

  /**
   * Write to socket (alias for send)
   */
  write(...args: unknown[]): this

  // ============================================================================
  // LIFECYCLE HOOKS
  // ============================================================================

  /**
   * Register middleware for incoming events
   */
  use(fn: (packet: unknown[], next: (err?: Error) => void) => void): this

  /**
   * Called when connection is ready
   */
  onAny(listener: (event: string, ...args: unknown[]) => void): this

  /**
   * Called before any emit
   */
  prependAny(listener: (event: string, ...args: unknown[]) => void): this

  /**
   * Remove catch-all listener
   */
  offAny(listener?: (event: string, ...args: unknown[]) => void): this

  /**
   * Get all catch-all listeners
   */
  listenersAny(): ((event: string, ...args: unknown[]) => void)[]

  /**
   * Called on any outgoing event
   */
  onAnyOutgoing(listener: (event: string, ...args: unknown[]) => void): this

  /**
   * Prepend outgoing catch-all listener
   */
  prependAnyOutgoing(listener: (event: string, ...args: unknown[]) => void): this

  /**
   * Remove outgoing catch-all listener
   */
  offAnyOutgoing(listener?: (event: string, ...args: unknown[]) => void): this

  /**
   * Get all outgoing catch-all listeners
   */
  listenersAnyOutgoing(): ((event: string, ...args: unknown[]) => void)[]
}

/**
 * Socket with timeout support
 */
export interface TimeoutSocket<
  ListenEvents extends Record<string, EventCallback> = Record<string, EventCallback>,
  EmitEvents extends Record<string, EventCallback> = Record<string, EventCallback>,
> {
  /**
   * Emit with timeout and error-first callback
   */
  emit<E extends keyof EmitEvents>(
    event: E,
    ...args: [...unknown[], TimeoutAckCallback]
  ): this
  emit(event: string, ...args: [...unknown[], TimeoutAckCallback]): this

  /**
   * Emit with promise-based timeout
   */
  emitWithAck<E extends keyof EmitEvents>(event: E, ...args: unknown[]): Promise<unknown>
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown>
}

// ============================================================================
// MANAGER INTERFACE
// ============================================================================

/**
 * Socket.IO Manager (connection manager)
 */
export interface Manager {
  /** Reconnection enabled */
  readonly reconnection: boolean

  /** Reconnection attempts */
  readonly reconnectionAttempts: number

  /** Reconnection delay */
  readonly reconnectionDelay: number

  /** Max reconnection delay */
  readonly reconnectionDelayMax: number

  /** Randomization factor */
  readonly randomizationFactor: number

  /** Connection timeout */
  readonly timeout: number

  /** Engine.IO socket */
  readonly engine: unknown

  /**
   * Open a new connection
   */
  open(fn?: (err?: Error) => void): this
  connect(fn?: (err?: Error) => void): this

  /**
   * Get socket for namespace
   */
  socket(nsp: string, opts?: Partial<SocketOptions>): Socket

  /**
   * Register event listener
   */
  on(event: string, listener: EventCallback): this

  /**
   * Remove event listener
   */
  off(event: string, listener?: EventCallback): this

  /**
   * Close all connections
   */
  close(): void
  disconnect(): void
}

// ============================================================================
// FACTORY TYPES
// ============================================================================

/**
 * IO factory function type
 */
export interface IoFactory {
  /**
   * Create a socket connection
   */
  (uri?: string, opts?: Partial<SocketOptions>): Socket
  (opts?: Partial<SocketOptions>): Socket

  /**
   * Protocol version
   */
  readonly protocol: number

  /**
   * Manager class
   */
  readonly Manager: new (uri?: string, opts?: Partial<ManagerOptions>) => Manager

  /**
   * Socket class
   */
  readonly Socket: new (io: Manager, nsp: string, opts?: Partial<SocketOptions>) => Socket
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Socket.IO error
 */
export class SocketIOError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SocketIOError'
  }
}

/**
 * Connection error
 */
export class ConnectionError extends SocketIOError {
  readonly type: string = 'TransportError'
  readonly description?: string

  constructor(message: string, description?: string) {
    super(message)
    this.name = 'ConnectionError'
    this.description = description
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends SocketIOError {
  constructor(message: string = 'operation timed out') {
    super(message)
    this.name = 'TimeoutError'
  }
}

/**
 * Parse error
 */
export class ParseError extends SocketIOError {
  constructor(message: string) {
    super(message)
    this.name = 'ParseError'
  }
}
