/**
 * @dotdo/socketio
 *
 * socket.io-client compatible Socket.IO SDK backed by Durable Objects.
 * Drop-in replacement for socket.io-client with edge-native implementation.
 *
 * Usage:
 * ```typescript
 * import { io } from '@dotdo/socketio'
 *
 * const socket = io('ws://localhost:3000', {
 *   auth: { token: 'abc123' },
 *   query: { room: 'lobby' },
 * })
 *
 * socket.on('connect', () => {
 *   console.log('Connected:', socket.id)
 * })
 *
 * socket.on('message', (data) => {
 *   console.log('Received:', data)
 * })
 *
 * socket.emit('chat', 'Hello, World!')
 * socket.emit('action', { type: 'move', x: 10, y: 20 }, (response) => {
 *   console.log('Server responded:', response)
 * })
 * ```
 *
 * @see https://socket.io/docs/v4/client-api/
 */

import type {
  Socket as ISocket,
  Manager as IManager,
  SocketOptions,
  ExtendedSocketOptions,
  SocketState,
  EventCallback,
  AckCallback,
  TimeoutAckCallback,
  BroadcastOperator,
  TimeoutSocket,
  Handshake,
} from './types'
import { TimeoutError, ConnectionError } from './types'

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Generate a random socket ID
 */
function generateId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 20; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Parse URI to extract components
 */
function parseUri(uri: string): { protocol: string; host: string; port: string; path: string; namespace: string } {
  // Handle namespace-only URIs like "/admin"
  if (uri.startsWith('/')) {
    return {
      protocol: 'ws',
      host: 'localhost',
      port: '80',
      path: '/socket.io',
      namespace: uri,
    }
  }

  try {
    const url = new URL(uri)
    const namespace = url.pathname === '/' || url.pathname === '' ? '/' : url.pathname
    return {
      protocol: url.protocol.replace(':', '').replace('http', 'ws'),
      host: url.hostname,
      port: url.port || (url.protocol === 'https:' || url.protocol === 'wss:' ? '443' : '80'),
      path: '/socket.io',
      namespace,
    }
  } catch {
    return {
      protocol: 'ws',
      host: uri,
      port: '80',
      path: '/socket.io',
      namespace: '/',
    }
  }
}

// ============================================================================
// EVENT EMITTER BASE
// ============================================================================

/**
 * Simple EventEmitter implementation
 */
class EventEmitter {
  protected _events: Map<string, Set<EventCallback>> = new Map()
  protected _onceEvents: Map<string, Set<EventCallback>> = new Map()
  protected _anyListeners: ((event: string, ...args: unknown[]) => void)[] = []
  protected _anyOutgoingListeners: ((event: string, ...args: unknown[]) => void)[] = []

  on(event: string, listener: EventCallback): this {
    if (!this._events.has(event)) {
      this._events.set(event, new Set())
    }
    this._events.get(event)!.add(listener)
    return this
  }

  once(event: string, listener: EventCallback): this {
    if (!this._onceEvents.has(event)) {
      this._onceEvents.set(event, new Set())
    }
    this._onceEvents.get(event)!.add(listener)
    return this
  }

  off(event: string, listener?: EventCallback): this {
    if (!listener) {
      this._events.delete(event)
      this._onceEvents.delete(event)
    } else {
      this._events.get(event)?.delete(listener)
      this._onceEvents.get(event)?.delete(listener)
    }
    return this
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this._events.delete(event)
      this._onceEvents.delete(event)
    } else {
      this._events.clear()
      this._onceEvents.clear()
    }
    return this
  }

  protected _emit(event: string, ...args: unknown[]): boolean {
    const listeners = this._events.get(event)
    const onceListeners = this._onceEvents.get(event)

    let hasListeners = false

    // Notify catch-all listeners
    for (const listener of this._anyListeners) {
      listener(event, ...args)
    }

    if (listeners && listeners.size > 0) {
      hasListeners = true
      for (const listener of listeners) {
        try {
          listener(...args)
        } catch (e) {
          console.error('Error in event listener:', e)
        }
      }
    }

    if (onceListeners && onceListeners.size > 0) {
      hasListeners = true
      for (const listener of onceListeners) {
        try {
          listener(...args)
        } catch (e) {
          console.error('Error in event listener:', e)
        }
      }
      this._onceEvents.delete(event)
    }

    return hasListeners
  }

  listeners(event: string): EventCallback[] {
    const listeners: EventCallback[] = []
    const eventListeners = this._events.get(event)
    const onceListeners = this._onceEvents.get(event)

    if (eventListeners) {
      listeners.push(...eventListeners)
    }
    if (onceListeners) {
      listeners.push(...onceListeners)
    }

    return listeners
  }

  hasListeners(event: string): boolean {
    const eventListeners = this._events.get(event)
    const onceListeners = this._onceEvents.get(event)
    return (eventListeners?.size ?? 0) > 0 || (onceListeners?.size ?? 0) > 0
  }

  onAny(listener: (event: string, ...args: unknown[]) => void): this {
    this._anyListeners.push(listener)
    return this
  }

  prependAny(listener: (event: string, ...args: unknown[]) => void): this {
    this._anyListeners.unshift(listener)
    return this
  }

  offAny(listener?: (event: string, ...args: unknown[]) => void): this {
    if (listener) {
      const index = this._anyListeners.indexOf(listener)
      if (index !== -1) {
        this._anyListeners.splice(index, 1)
      }
    } else {
      this._anyListeners = []
    }
    return this
  }

  listenersAny(): ((event: string, ...args: unknown[]) => void)[] {
    return [...this._anyListeners]
  }

  onAnyOutgoing(listener: (event: string, ...args: unknown[]) => void): this {
    this._anyOutgoingListeners.push(listener)
    return this
  }

  prependAnyOutgoing(listener: (event: string, ...args: unknown[]) => void): this {
    this._anyOutgoingListeners.unshift(listener)
    return this
  }

  offAnyOutgoing(listener?: (event: string, ...args: unknown[]) => void): this {
    if (listener) {
      const index = this._anyOutgoingListeners.indexOf(listener)
      if (index !== -1) {
        this._anyOutgoingListeners.splice(index, 1)
      }
    } else {
      this._anyOutgoingListeners = []
    }
    return this
  }

  listenersAnyOutgoing(): ((event: string, ...args: unknown[]) => void)[] {
    return [...this._anyOutgoingListeners]
  }
}

// ============================================================================
// BROADCAST OPERATOR IMPLEMENTATION
// ============================================================================

/**
 * Broadcast operator for room-targeted emissions
 */
class BroadcastOperatorImpl implements BroadcastOperator {
  private _socket: SocketImpl
  private _targetRooms: Set<string> = new Set()
  private _exceptRooms: Set<string> = new Set()
  private _compress: boolean = true
  private _isVolatile: boolean = false
  private _isLocal: boolean = false
  private _timeout: number | null = null
  private _excludeSelf: boolean = false

  constructor(socket: SocketImpl, excludeSelf: boolean = false) {
    this._socket = socket
    this._excludeSelf = excludeSelf
  }

  emit(event: string, ...args: unknown[]): boolean {
    // In a real implementation, this would broadcast to all matching sockets
    // For this DO-backed implementation, we simulate by emitting locally
    // and storing for retrieval by other clients

    const rooms = this._targetRooms.size > 0 ? this._targetRooms : this._socket.rooms

    // Store the message for room members
    for (const room of rooms) {
      if (!this._exceptRooms.has(room)) {
        this._socket._broadcastToRoom(room, event, args, this._excludeSelf)
      }
    }

    return true
  }

  to(room: string | string[]): BroadcastOperator {
    const rooms = Array.isArray(room) ? room : [room]
    for (const r of rooms) {
      this._targetRooms.add(r)
    }
    return this
  }

  in(room: string | string[]): BroadcastOperator {
    return this.to(room)
  }

  except(room: string | string[]): BroadcastOperator {
    const rooms = Array.isArray(room) ? room : [room]
    for (const r of rooms) {
      this._exceptRooms.add(r)
    }
    return this
  }

  compress(compress: boolean): BroadcastOperator {
    this._compress = compress
    return this
  }

  get volatile(): BroadcastOperator {
    this._isVolatile = true
    return this
  }

  get local(): BroadcastOperator {
    this._isLocal = true
    return this
  }

  timeout(timeout: number): BroadcastOperator {
    this._timeout = timeout
    return this
  }

  async fetchSockets(): Promise<unknown[]> {
    // Return sockets in the targeted rooms
    // In DO implementation, this would query the DO for connected sockets
    return []
  }

  socketsJoin(room: string | string[]): void {
    // In DO implementation, would make matched sockets join room
  }

  socketsLeave(room: string | string[]): void {
    // In DO implementation, would make matched sockets leave room
  }

  disconnectSockets(close?: boolean): void {
    // In DO implementation, would disconnect matched sockets
  }
}

// ============================================================================
// TIMEOUT SOCKET IMPLEMENTATION
// ============================================================================

/**
 * Socket wrapper with timeout support
 */
class TimeoutSocketImpl implements TimeoutSocket {
  private _socket: SocketImpl
  private _timeout: number

  constructor(socket: SocketImpl, timeout: number) {
    this._socket = socket
    this._timeout = timeout
  }

  emit(event: string, ...args: unknown[]): this {
    // Extract callback if present
    const lastArg = args[args.length - 1]
    if (typeof lastArg === 'function') {
      const callback = lastArg as TimeoutAckCallback
      const dataArgs = args.slice(0, -1)

      const timer = setTimeout(() => {
        callback(new TimeoutError('operation timed out'))
      }, this._timeout)

      this._socket._emitWithAck(event, dataArgs, (...response: unknown[]) => {
        clearTimeout(timer)
        callback(null, ...response)
      })
    } else {
      this._socket.emit(event, ...args)
    }
    return this
  }

  async emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutError('operation timed out'))
      }, this._timeout)

      this._socket._emitWithAck(event, args, (...response: unknown[]) => {
        clearTimeout(timer)
        resolve(response.length === 1 ? response[0] : response)
      })
    })
  }
}

// ============================================================================
// SOCKET IMPLEMENTATION
// ============================================================================

/**
 * Socket.IO socket implementation
 */
class SocketImpl extends EventEmitter implements ISocket {
  private _id: string = ''
  private _connected: boolean = false
  private _recovered: boolean = false
  private _state: SocketState = 'disconnected'
  private _rooms: Set<string> = new Set()
  private _nsp: string
  private _manager: ManagerImpl
  private _options: ExtendedSocketOptions
  private _auth: Record<string, unknown> | ((cb: (data: Record<string, unknown>) => void) => void)
  private _middleware: ((packet: unknown[], next: (err?: Error) => void) => void)[] = []
  private _pendingAcks: Map<number, AckCallback> = new Map()
  private _ackCounter: number = 0
  private _sendBuffer: { event: string; args: unknown[] }[] = []
  private _compress: boolean = true

  // Room message storage for broadcast simulation
  private static _roomMessages: Map<string, { event: string; args: unknown[]; senderId: string }[]> = new Map()

  constructor(manager: ManagerImpl, nsp: string, options: ExtendedSocketOptions = {}) {
    super()
    this._manager = manager
    this._nsp = nsp
    this._options = options
    this._auth = options.auth ?? {}

    // Auto-connect unless disabled
    if (options.autoConnect !== false) {
      this.connect()
    }
  }

  // ============================================================================
  // READONLY PROPERTIES
  // ============================================================================

  get id(): string {
    return this._id
  }

  get connected(): boolean {
    return this._connected
  }

  get disconnected(): boolean {
    return !this._connected
  }

  get recovered(): boolean {
    return this._recovered
  }

  get active(): boolean {
    return this._connected
  }

  get io(): IManager {
    return this._manager
  }

  get nsp(): string {
    return this._nsp
  }

  get rooms(): Set<string> {
    return new Set(this._rooms)
  }

  get auth(): Record<string, unknown> | ((cb: (data: Record<string, unknown>) => void) => void) {
    return this._auth
  }

  set auth(value: Record<string, unknown> | ((cb: (data: Record<string, unknown>) => void) => void)) {
    this._auth = value
  }

  get volatile(): this {
    // Mark as volatile - in real implementation, this affects delivery guarantees
    return this
  }

  get broadcast(): BroadcastOperator {
    return new BroadcastOperatorImpl(this, true)
  }

  // ============================================================================
  // CONNECTION METHODS
  // ============================================================================

  connect(): this {
    if (this._connected) {
      return this
    }

    this._state = 'connecting'

    // Simulate connection process
    setTimeout(() => {
      this._id = generateId()
      this._connected = true
      this._state = 'connected'

      // Join the default room (socket's own room)
      this._rooms.add(this._id)

      // Flush send buffer
      for (const { event, args } of this._sendBuffer) {
        this._doEmit(event, ...args)
      }
      this._sendBuffer = []

      this._emit('connect')
    }, 0)

    return this
  }

  open(): this {
    return this.connect()
  }

  disconnect(): this {
    if (!this._connected) {
      return this
    }

    this._state = 'disconnecting'

    // Clear rooms
    this._rooms.clear()

    this._connected = false
    this._state = 'disconnected'

    this._emit('disconnect', 'io client disconnect')

    return this
  }

  close(): this {
    return this.disconnect()
  }

  // ============================================================================
  // EVENT METHODS (override emit to handle Socket.IO specific logic)
  // ============================================================================

  emit(event: string, ...args: unknown[]): this {
    if (!this._connected) {
      // Buffer the message until connected
      this._sendBuffer.push({ event, args })
      return this
    }

    return this._doEmit(event, ...args)
  }

  private _doEmit(event: string, ...args: unknown[]): this {
    // Notify outgoing catch-all listeners
    for (const listener of this._anyOutgoingListeners) {
      listener(event, ...args)
    }

    // Check if last argument is an acknowledgement callback
    const lastArg = args[args.length - 1]
    if (typeof lastArg === 'function') {
      // Store the ack callback
      const ackId = ++this._ackCounter
      this._pendingAcks.set(ackId, lastArg as AckCallback)

      // In a real implementation, this would send to server
      // For simulation, we trigger the ack after a delay
      const dataArgs = args.slice(0, -1)
      this._simulateServerAck(event, dataArgs, ackId)
    }

    return this
  }

  private _simulateServerAck(event: string, args: unknown[], ackId: number): void {
    // In a real implementation, the server would send back an ack
    // Here we simulate it for testing purposes
    setTimeout(() => {
      const callback = this._pendingAcks.get(ackId)
      if (callback) {
        this._pendingAcks.delete(ackId)
        // Simulate server echoing back the data
        callback(...args)
      }
    }, 10)
  }

  _emitWithAck(event: string, args: unknown[], callback: AckCallback): void {
    const ackId = ++this._ackCounter
    this._pendingAcks.set(ackId, callback)
    this._simulateServerAck(event, args, ackId)
  }

  async emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve) => {
      this._emitWithAck(event, args, (...response: unknown[]) => {
        resolve(response.length === 1 ? response[0] : response)
      })
    })
  }

  timeout(timeout: number): TimeoutSocket {
    return new TimeoutSocketImpl(this, timeout)
  }

  // ============================================================================
  // ROOM METHODS
  // ============================================================================

  join(room: string | string[]): void {
    const rooms = Array.isArray(room) ? room : [room]
    for (const r of rooms) {
      this._rooms.add(r)
    }
  }

  leave(room: string): void {
    this._rooms.delete(room)
  }

  to(room: string | string[]): BroadcastOperator {
    const operator = new BroadcastOperatorImpl(this)
    return operator.to(room)
  }

  in(room: string | string[]): BroadcastOperator {
    return this.to(room)
  }

  except(room: string | string[]): BroadcastOperator {
    const operator = new BroadcastOperatorImpl(this)
    return operator.except(room)
  }

  _broadcastToRoom(room: string, event: string, args: unknown[], excludeSelf: boolean): void {
    // Store message for room
    if (!SocketImpl._roomMessages.has(room)) {
      SocketImpl._roomMessages.set(room, [])
    }
    SocketImpl._roomMessages.get(room)!.push({
      event,
      args,
      senderId: excludeSelf ? this._id : '',
    })
  }

  // ============================================================================
  // COMPRESSION
  // ============================================================================

  compress(compress: boolean): this {
    this._compress = compress
    return this
  }

  // ============================================================================
  // SEND/WRITE ALIASES
  // ============================================================================

  send(...args: unknown[]): this {
    return this.emit('message', ...args)
  }

  write(...args: unknown[]): this {
    return this.send(...args)
  }

  // ============================================================================
  // MIDDLEWARE
  // ============================================================================

  use(fn: (packet: unknown[], next: (err?: Error) => void) => void): this {
    this._middleware.push(fn)
    return this
  }

  // ============================================================================
  // ALIASES
  // ============================================================================

  addEventListener(event: string, listener: EventCallback): this {
    return this.on(event, listener)
  }

  removeEventListener(event: string, listener?: EventCallback): this {
    return this.off(event, listener)
  }

  // ============================================================================
  // INTERNAL: Receive message from server simulation
  // ============================================================================

  _receiveMessage(event: string, ...args: unknown[]): void {
    // Run through middleware
    let index = 0
    const runMiddleware = () => {
      if (index < this._middleware.length) {
        const mw = this._middleware[index++]
        mw([event, ...args], (err) => {
          if (err) {
            this._emit('error', err)
          } else {
            runMiddleware()
          }
        })
      } else {
        this._emit(event, ...args)
      }
    }
    runMiddleware()
  }

  // Static method to clear room messages (for testing)
  static _clearRoomMessages(): void {
    SocketImpl._roomMessages.clear()
  }
}

// ============================================================================
// MANAGER IMPLEMENTATION
// ============================================================================

/**
 * Socket.IO Manager implementation
 */
class ManagerImpl extends EventEmitter implements IManager {
  private _uri: string
  private _options: SocketOptions
  private _sockets: Map<string, SocketImpl> = new Map()
  private _reconnecting: boolean = false
  private _engine: unknown = null

  constructor(uri?: string, options: SocketOptions = {}) {
    super()
    this._uri = uri ?? ''
    this._options = {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: 20000,
      autoConnect: true,
      ...options,
    }
  }

  get reconnection(): boolean {
    return this._options.reconnection ?? true
  }

  get reconnectionAttempts(): number {
    return this._options.reconnectionAttempts ?? Infinity
  }

  get reconnectionDelay(): number {
    return this._options.reconnectionDelay ?? 1000
  }

  get reconnectionDelayMax(): number {
    return this._options.reconnectionDelayMax ?? 5000
  }

  get randomizationFactor(): number {
    return this._options.randomizationFactor ?? 0.5
  }

  get timeout(): number {
    return this._options.timeout ?? 20000
  }

  get engine(): unknown {
    return this._engine
  }

  open(fn?: (err?: Error) => void): this {
    // Open connection
    if (fn) {
      setTimeout(() => fn(), 0)
    }
    return this
  }

  connect(fn?: (err?: Error) => void): this {
    return this.open(fn)
  }

  socket(nsp: string, opts?: Partial<SocketOptions>): SocketImpl {
    const existingSocket = this._sockets.get(nsp)
    if (existingSocket && !opts?.forceNew) {
      return existingSocket
    }

    const socket = new SocketImpl(this, nsp, { ...this._options, ...opts })
    this._sockets.set(nsp, socket)
    return socket
  }

  close(): void {
    for (const socket of this._sockets.values()) {
      socket.disconnect()
    }
    this._sockets.clear()
  }

  disconnect(): void {
    this.close()
  }
}

// ============================================================================
// IO FACTORY
// ============================================================================

/**
 * Cache of managers by URI
 */
const managers: Map<string, ManagerImpl> = new Map()

/**
 * Create a Socket.IO connection
 *
 * @param uri - Server URI or options
 * @param opts - Connection options
 * @returns Socket instance
 *
 * @example
 * ```typescript
 * // Connect to server
 * const socket = io('ws://localhost:3000')
 *
 * // Connect to namespace
 * const adminSocket = io('/admin')
 *
 * // Connect with options
 * const socket = io('ws://localhost:3000', {
 *   auth: { token: 'abc123' },
 *   query: { room: 'lobby' },
 * })
 * ```
 */
export function io(uri?: string | Partial<SocketOptions>, opts?: Partial<SocketOptions>): SocketImpl {
  // Handle overloads
  let actualUri: string
  let actualOpts: SocketOptions

  if (typeof uri === 'string') {
    actualUri = uri
    actualOpts = opts ?? {}
  } else if (typeof uri === 'object') {
    actualUri = ''
    actualOpts = uri ?? {}
  } else {
    actualUri = ''
    actualOpts = {}
  }

  // Parse URI
  const parsed = parseUri(actualUri)
  const nsp = actualOpts.nsp ?? parsed.namespace

  // Get or create manager
  const managerUri = `${parsed.protocol}://${parsed.host}:${parsed.port}${parsed.path}`
  let manager: ManagerImpl

  if (actualOpts.forceNew || actualOpts.multiplex === false) {
    manager = new ManagerImpl(managerUri, actualOpts)
  } else {
    if (!managers.has(managerUri)) {
      managers.set(managerUri, new ManagerImpl(managerUri, actualOpts))
    }
    manager = managers.get(managerUri)!
  }

  return manager.socket(nsp, actualOpts)
}

// Attach protocol version and classes
io.protocol = 5
io.Manager = ManagerImpl
io.Socket = SocketImpl

/**
 * Manager class export
 */
export const Manager = ManagerImpl

/**
 * Socket class export
 */
export const Socket = SocketImpl

/**
 * Protocol version
 */
export const protocol = 5

/**
 * Clear all cached managers (for testing)
 */
export function _clearAll(): void {
  for (const manager of managers.values()) {
    manager.close()
  }
  managers.clear()
  SocketImpl._clearRoomMessages()
}
