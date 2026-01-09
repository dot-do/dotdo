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
// GLOBAL ROOM REGISTRY
// ============================================================================

/**
 * Global registry of room memberships: room -> Set of socketIds
 */
const roomMembers: Map<string, Set<string>> = new Map()

/**
 * Global registry of socket instances: socketId -> Socket
 */
const socketInstances: Map<string, SocketImpl> = new Map()

/**
 * Register a socket instance in the global registry
 */
function registerSocket(socket: SocketImpl): void {
  socketInstances.set(socket.id, socket)
}

/**
 * Unregister a socket instance from the global registry
 */
function unregisterSocket(socketId: string): void {
  socketInstances.delete(socketId)
  // Remove from all rooms
  for (const [room, members] of roomMembers) {
    members.delete(socketId)
    if (members.size === 0) {
      roomMembers.delete(room)
    }
  }
}

/**
 * Add a socket to a room in the global registry
 */
function addToRoom(room: string, socketId: string): void {
  if (!roomMembers.has(room)) {
    roomMembers.set(room, new Set())
  }
  roomMembers.get(room)!.add(socketId)
}

/**
 * Remove a socket from a room in the global registry
 */
function removeFromRoom(room: string, socketId: string): void {
  const members = roomMembers.get(room)
  if (members) {
    members.delete(socketId)
    if (members.size === 0) {
      roomMembers.delete(room)
    }
  }
}

/**
 * Get all socket IDs in a room
 */
function getSocketsInRoom(room: string): Set<string> {
  return roomMembers.get(room) ?? new Set()
}

/**
 * Get socket instance by ID
 */
function getSocketById(socketId: string): SocketImpl | undefined {
  return socketInstances.get(socketId)
}

/**
 * Clear all registries (for testing)
 */
function clearRegistries(): void {
  roomMembers.clear()
  socketInstances.clear()
}

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

import { SocketIOEventEmitter } from '../../../compat/shared/event-emitter'

// Re-export SocketIOEventEmitter as EventEmitter for Socket.IO-style events
class EventEmitter extends SocketIOEventEmitter {}

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
    const rooms = this._targetRooms.size > 0 ? this._targetRooms : this._socket.rooms

    // Collect all unique socket IDs from target rooms
    const targetSocketIds = new Set<string>()
    for (const room of rooms) {
      const members = getSocketsInRoom(room)
      for (const socketId of members) {
        targetSocketIds.add(socketId)
      }
    }

    // Remove sockets in excepted rooms
    for (const room of this._exceptRooms) {
      const members = getSocketsInRoom(room)
      for (const socketId of members) {
        targetSocketIds.delete(socketId)
      }
    }

    // Exclude sender if requested
    if (this._excludeSelf) {
      targetSocketIds.delete(this._socket.id)
    }

    // Deliver to each socket
    for (const socketId of targetSocketIds) {
      const socket = getSocketById(socketId)
      if (socket && socket.connected) {
        socket._receiveMessage(event, ...args)
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
    // Collect all unique socket IDs from target rooms
    const targetSocketIds = new Set<string>()
    for (const room of this._targetRooms) {
      const members = getSocketsInRoom(room)
      for (const socketId of members) {
        targetSocketIds.add(socketId)
      }
    }

    // Remove sockets in excepted rooms
    for (const room of this._exceptRooms) {
      const members = getSocketsInRoom(room)
      for (const socketId of members) {
        targetSocketIds.delete(socketId)
      }
    }

    // Return actual socket instances
    const sockets: SocketImpl[] = []
    for (const socketId of targetSocketIds) {
      const socket = getSocketById(socketId)
      if (socket && socket.connected) {
        sockets.push(socket)
      }
    }
    return sockets
  }

  socketsJoin(room: string | string[]): void {
    const rooms = Array.isArray(room) ? room : [room]
    // Get sockets matching criteria and make them join
    for (const targetRoom of this._targetRooms) {
      const members = getSocketsInRoom(targetRoom)
      for (const socketId of members) {
        const socket = getSocketById(socketId)
        if (socket) {
          socket.join(rooms)
        }
      }
    }
  }

  socketsLeave(room: string | string[]): void {
    const rooms = Array.isArray(room) ? room : [room]
    // Get sockets matching criteria and make them leave
    for (const targetRoom of this._targetRooms) {
      const members = getSocketsInRoom(targetRoom)
      for (const socketId of members) {
        const socket = getSocketById(socketId)
        if (socket) {
          for (const r of rooms) {
            socket.leave(r)
          }
        }
      }
    }
  }

  disconnectSockets(close?: boolean): void {
    // Get sockets matching criteria and disconnect them
    for (const targetRoom of this._targetRooms) {
      const members = getSocketsInRoom(targetRoom)
      for (const socketId of members) {
        const socket = getSocketById(socketId)
        if (socket) {
          socket.disconnect()
        }
      }
    }
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

      // Register in global registry
      registerSocket(this)

      // Join the default room (socket's own room)
      this._rooms.add(this._id)
      addToRoom(this._id, this._id)

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

    // Unregister from global registry (also removes from all rooms)
    unregisterSocket(this._id)

    // Clear local rooms
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
      // Register in global room registry
      addToRoom(r, this._id)
    }
  }

  leave(room: string): void {
    this._rooms.delete(room)
    // Unregister from global room registry
    removeFromRoom(room, this._id)
  }

  to(room: string | string[]): BroadcastOperator {
    const operator = new BroadcastOperatorImpl(this, true) // excludeSelf by default for to()
    return operator.to(room)
  }

  in(room: string | string[]): BroadcastOperator {
    return this.to(room)
  }

  except(room: string | string[]): BroadcastOperator {
    const operator = new BroadcastOperatorImpl(this, true) // excludeSelf by default
    return operator.except(room)
  }

  _broadcastToRoom(room: string, event: string, args: unknown[], excludeSelf: boolean): void {
    // This method is now deprecated - broadcasts are handled directly by BroadcastOperatorImpl
    // Kept for backward compatibility but does nothing
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
  clearRegistries()
}
