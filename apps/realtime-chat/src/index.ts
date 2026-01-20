/**
 * Real-time Chat Example
 *
 * A WebSocket-based chat application demonstrating:
 * - WebSocket connections in Durable Objects
 * - Hibernatable WebSockets for efficiency
 * - Real-time message broadcasting
 * - Message history persistence
 * - Room-based chat isolation
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Re-export the Durable Object class
export { ChatRoomDO } from './ChatRoomDO'

// ============================================================================
// Types
// ============================================================================

interface Env {
  CHAT_ROOM_DO: DurableObjectNamespace
}

// ============================================================================
// Main App
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// Middleware
app.use('/*', cors())

// API discovery
app.get('/', (c) =>
  c.json({
    name: 'Real-time Chat',
    version: '1.0.0',
    description: 'WebSocket chat application using dotdo patterns',
    endpoints: {
      'GET /rooms': 'List available rooms',
      'GET /rooms/:room': 'Get room info',
      'GET /rooms/:room/messages': 'Get message history',
      'GET /rooms/:room/ws': 'WebSocket connection (upgrade)',
    },
    websocket: {
      connect: 'GET /rooms/:room/ws',
      messages: {
        join: '{"type":"join","username":"yourname"}',
        message: '{"type":"message","content":"hello"}',
        typing: '{"type":"typing"}',
        leave: 'Automatic on disconnect',
      },
      events: {
        joined: 'User joined the room',
        left: 'User left the room',
        message: 'New message in room',
        typing: 'User is typing',
        history: 'Message history on connect',
        error: 'Error message',
      },
    },
  })
)

// Get ChatRoomDO stub
function getRoomDO(c: { env: Env }, room: string) {
  const id = c.env.CHAT_ROOM_DO.idFromName(room)
  return c.env.CHAT_ROOM_DO.get(id)
}

// List available rooms (simple example)
app.get('/rooms', (c) =>
  c.json({
    rooms: ['general', 'random', 'tech', 'help'],
    note: 'Any room name can be used - these are just suggestions',
  })
)

// Get room info
app.get('/rooms/:room', async (c) => {
  const room = c.req.param('room')
  const stub = getRoomDO(c, room)

  const response = await stub.fetch(new Request('http://internal/info'))
  return response
})

// Get message history
app.get('/rooms/:room/messages', async (c) => {
  const room = c.req.param('room')
  const stub = getRoomDO(c, room)

  const limit = c.req.query('limit') || '50'
  const response = await stub.fetch(new Request(`http://internal/messages?limit=${limit}`))
  return response
})

// WebSocket upgrade
app.get('/rooms/:room/ws', async (c) => {
  const room = c.req.param('room')
  const stub = getRoomDO(c, room)

  // Check for WebSocket upgrade
  const upgradeHeader = c.req.header('Upgrade')
  if (upgradeHeader !== 'websocket') {
    return c.json({ error: 'Expected WebSocket upgrade' }, 426)
  }

  // Forward to DO for WebSocket handling
  return stub.fetch(c.req.raw)
})

export default app
