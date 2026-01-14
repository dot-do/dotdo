/**
 * @dotdo/socketio - Socket.IO SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for socket.io-client backed by Durable Objects.
 * This implementation matches the Socket.IO client JavaScript API.
 *
 * @example
 * ```typescript
 * import { io } from '@dotdo/socketio'
 *
 * // Basic connection
 * const socket = io('ws://localhost:3000')
 *
 * // Connection with options
 * const socket = io('ws://localhost:3000', {
 *   auth: { token: 'abc123' },
 *   query: { room: 'lobby' },
 *   reconnection: true,
 *   reconnectionAttempts: 5,
 *   reconnectionDelay: 1000,
 *   timeout: 20000,
 * })
 *
 * // Connection events
 * socket.on('connect', () => {
 *   console.log('Connected!')
 *   console.log('Socket ID:', socket.id)
 * })
 *
 * socket.on('disconnect', (reason) => {
 *   console.log('Disconnected:', reason)
 * })
 *
 * socket.on('connect_error', (error) => {
 *   console.error('Connection error:', error)
 * })
 *
 * // Listen for events
 * socket.on('message', (data) => {
 *   console.log('Received message:', data)
 * })
 *
 * socket.on('chat', (sender, message, timestamp) => {
 *   console.log(`[${timestamp}] ${sender}: ${message}`)
 * })
 *
 * // Emit events
 * socket.emit('message', 'Hello, World!')
 *
 * // Emit with multiple arguments
 * socket.emit('chat', 'Alice', 'Hi everyone!', Date.now())
 *
 * // Emit with acknowledgement
 * socket.emit('save', { key: 'value' }, (response) => {
 *   console.log('Server acknowledged:', response)
 * })
 *
 * // Emit with timeout
 * socket.timeout(5000).emit('action', { type: 'move' }, (err, response) => {
 *   if (err) {
 *     console.error('Request timed out')
 *   } else {
 *     console.log('Response:', response)
 *   }
 * })
 *
 * // Volatile emit (best effort, no retry)
 * socket.volatile.emit('position', { x: 100, y: 200 })
 *
 * // Connect to namespace
 * const adminSocket = io('/admin')
 * adminSocket.on('admin-message', (data) => {
 *   console.log('Admin message:', data)
 * })
 *
 * // Manual connect/disconnect
 * socket.connect()
 * socket.disconnect()
 *
 * // Once listener (auto-removed after first event)
 * socket.once('welcome', (data) => {
 *   console.log('Welcome message:', data)
 * })
 *
 * // Remove specific listener
 * const handler = (data) => console.log(data)
 * socket.on('event', handler)
 * socket.off('event', handler)
 *
 * // Remove all listeners for an event
 * socket.off('event')
 *
 * // Remove all listeners
 * socket.removeAllListeners()
 *
 * // Get listener count
 * const count = socket.listeners('message').length
 *
 * // Check if connected
 * if (socket.connected) {
 *   console.log('Socket is connected')
 * }
 *
 * // Room operations (for server-side simulation in tests)
 * socket.join('room1')
 * socket.to('room1').emit('message', 'Hello room!')
 * socket.leave('room1')
 *
 * // Broadcast to all except sender
 * socket.broadcast.emit('announcement', 'New user joined')
 *
 * // Binary data
 * const buffer = new ArrayBuffer(8)
 * socket.emit('binary', buffer)
 *
 * // Compression
 * socket.compress(true).emit('large-data', largeObject)
 *
 * // Using Manager for multiple sockets
 * import { Manager } from '@dotdo/socketio'
 *
 * const manager = new Manager('ws://localhost:3000', {
 *   reconnection: true,
 * })
 *
 * const mainSocket = manager.socket('/')
 * const chatSocket = manager.socket('/chat')
 * ```
 *
 * @see https://socket.io/docs/v4/client-api/
 */

// Export main factory and classes
export { io, Manager, Socket, protocol, _clearAll } from '../../streaming/compat/socketio/socketio'

// Export all errors
export { SocketIOError, ConnectionError, TimeoutError, ParseError } from '../../streaming/compat/socketio/types'

// Export all types
export type {
  // Socket interface
  Socket as ISocket,
  TimeoutSocket,
  BroadcastOperator,
  RemoteSocket,
  Handshake,

  // Manager interface
  Manager as IManager,

  // Options
  SocketOptions,
  ExtendedSocketOptions,
  ManagerOptions,

  // State
  SocketState,

  // Events
  EventCallback,
  AckCallback,
  TimeoutAckCallback,
  ReservedEvents,
  DisconnectReason,
  DisconnectDescription,

  // Factory
  IoFactory,
} from '../../streaming/compat/socketio/types'

// Default export for convenience
export { io as default } from '../../streaming/compat/socketio/socketio'
