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
 * // Basic connection
 * const socket = io('ws://localhost:3000')
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
 *
 * // With authentication
 * const socket = io('ws://localhost:3000', {
 *   auth: { token: 'abc123' },
 *   query: { room: 'lobby' },
 * })
 *
 * // Connect to namespace
 * const adminSocket = io('/admin')
 *
 * // Acknowledgements
 * socket.emit('action', { type: 'move' }, (response) => {
 *   console.log('Server responded:', response)
 * })
 *
 * // Timeout
 * socket.timeout(5000).emit('action', data, (err, response) => {
 *   if (err) {
 *     console.error('Timeout!')
 *   } else {
 *     console.log('Response:', response)
 *   }
 * })
 *
 * // Rooms (server-side simulation)
 * socket.join('room1')
 * socket.to('room1').emit('message', 'Hello room!')
 * socket.leave('room1')
 * ```
 *
 * @see https://socket.io/docs/v4/client-api/
 */

// Export main factory and classes
export { io, Manager, Socket, protocol, _clearAll } from './socketio'

// Export all errors
export { SocketIOError, ConnectionError, TimeoutError, ParseError } from './types'

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
} from './types'
