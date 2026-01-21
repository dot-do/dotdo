/**
 * Chat Room Durable Object
 *
 * Demonstrates:
 * - WebSocket connection handling
 * - Hibernatable WebSockets for cost efficiency
 * - Real-time message broadcasting
 * - Message persistence in SQLite
 * - User presence tracking
 */

import { Hono } from 'hono'

// ============================================================================
// Types
// ============================================================================

interface Message {
  id: string
  username: string
  content: string
  timestamp: number
}

interface MessageRow {
  id: string
  username: string
  content: string
  timestamp: number
}

interface WebSocketMessage {
  type: string
  username?: string
  content?: string
}

interface UserSession {
  username: string
  joinedAt: number
}

// ============================================================================
// Durable Object
// ============================================================================

export class ChatRoomDO implements DurableObject {
  private state: DurableObjectState
  private app: Hono
  private sql: SqlStorage
  private initialized = false

  // Track user sessions (WebSocket -> UserSession)
  private sessions = new Map<WebSocket, UserSession>()

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state
    this.sql = state.storage.sql
    this.app = new Hono()
    this.setupRoutes()
  }

  // Initialize the database schema
  private async initialize(): Promise<void> {
    if (this.initialized) return

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `)

    // Index for efficient ordering
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp
      ON messages(timestamp DESC)
    `)

    this.initialized = true
  }

  // Generate a unique ID
  private generateId(): string {
    return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  }

  // Broadcast message to all connected WebSockets
  private broadcast(message: object, exclude?: WebSocket): void {
    const data = JSON.stringify(message)

    for (const ws of this.state.getWebSockets()) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data)
        } catch (err) {
          console.error('Failed to send to WebSocket:', err)
        }
      }
    }
  }

  // Get all online users
  private getOnlineUsers(): string[] {
    return Array.from(this.sessions.values()).map((s) => s.username)
  }

  // Setup Hono routes
  private setupRoutes(): void {
    // Room info
    this.app.get('/info', async (c) => {
      await this.initialize()

      const countCursor = this.sql.exec<{ count: number }>('SELECT COUNT(*) as count FROM messages')
      const countRows = [...countCursor]
      const messageCount = countRows[0]?.count ?? 0

      return c.json({
        id: this.state.id.toString(),
        onlineUsers: this.getOnlineUsers(),
        userCount: this.sessions.size,
        messageCount,
      })
    })

    // Get message history
    this.app.get('/messages', async (c) => {
      await this.initialize()

      const limit = parseInt(c.req.query('limit') || '50')
      const cursor = this.sql.exec<MessageRow>(
        'SELECT id, username, content, timestamp FROM messages ORDER BY timestamp DESC LIMIT ?',
        limit
      )
      const rows = [...cursor]

      // Return in chronological order
      const messages = rows.reverse().map((row) => ({
        id: row.id,
        username: row.username,
        content: row.content,
        timestamp: row.timestamp,
      }))

      return c.json({
        messages,
        count: messages.length,
      })
    })

    // WebSocket upgrade
    this.app.get('/rooms/:room/ws', async (c) => {
      await this.initialize()

      // Create WebSocket pair
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]

      // Accept the WebSocket with hibernation support
      this.state.acceptWebSocket(server)

      // Send initial history
      const cursor = this.sql.exec<MessageRow>(
        'SELECT id, username, content, timestamp FROM messages ORDER BY timestamp DESC LIMIT 50'
      )
      const rows = [...cursor]
      const history = rows.reverse().map((row) => ({
        id: row.id,
        username: row.username,
        content: row.content,
        timestamp: row.timestamp,
      }))

      server.send(
        JSON.stringify({
          type: 'history',
          messages: history,
          onlineUsers: this.getOnlineUsers(),
        })
      )

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    })
  }

  // Handle incoming WebSocket messages
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    await this.initialize()

    if (typeof message !== 'string') {
      ws.send(JSON.stringify({ type: 'error', error: 'Binary messages not supported' }))
      return
    }

    let data: WebSocketMessage
    try {
      data = JSON.parse(message)
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }))
      return
    }

    switch (data.type) {
      case 'join': {
        if (!data.username?.trim()) {
          ws.send(JSON.stringify({ type: 'error', error: 'Username required' }))
          return
        }

        const username = data.username.trim()

        // Check for duplicate username
        for (const session of this.sessions.values()) {
          if (session.username.toLowerCase() === username.toLowerCase()) {
            ws.send(JSON.stringify({ type: 'error', error: 'Username already taken' }))
            return
          }
        }

        // Store session
        this.sessions.set(ws, {
          username,
          joinedAt: Date.now(),
        })

        // Notify all users
        this.broadcast({
          type: 'joined',
          username,
          onlineUsers: this.getOnlineUsers(),
        })

        ws.send(
          JSON.stringify({
            type: 'joined',
            username,
            message: `Welcome to the chat, ${username}!`,
          })
        )
        break
      }

      case 'message': {
        const session = this.sessions.get(ws)
        if (!session) {
          ws.send(JSON.stringify({ type: 'error', error: 'Please join first' }))
          return
        }

        if (!data.content?.trim()) {
          ws.send(JSON.stringify({ type: 'error', error: 'Message content required' }))
          return
        }

        const content = data.content.trim()
        const id = this.generateId()
        const timestamp = Date.now()

        // Store message
        this.sql.exec(
          'INSERT INTO messages (id, username, content, timestamp) VALUES (?, ?, ?, ?)',
          id,
          session.username,
          content,
          timestamp
        )

        // Broadcast to all
        this.broadcast({
          type: 'message',
          id,
          username: session.username,
          content,
          timestamp,
        })
        break
      }

      case 'typing': {
        const session = this.sessions.get(ws)
        if (!session) return

        // Broadcast typing indicator to others
        this.broadcast(
          {
            type: 'typing',
            username: session.username,
          },
          ws
        )
        break
      }

      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong' }))
        break
      }

      default:
        ws.send(JSON.stringify({ type: 'error', error: `Unknown message type: ${data.type}` }))
    }
  }

  // Handle WebSocket close
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    const session = this.sessions.get(ws)
    if (session) {
      this.sessions.delete(ws)

      // Notify others
      this.broadcast({
        type: 'left',
        username: session.username,
        onlineUsers: this.getOnlineUsers(),
      })
    }
  }

  // Handle WebSocket error
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error)
    const session = this.sessions.get(ws)
    if (session) {
      this.sessions.delete(ws)
    }
  }

  async fetch(request: Request): Promise<Response> {
    // Handle WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader === 'websocket') {
      await this.initialize()

      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]

      // Accept with hibernation
      this.state.acceptWebSocket(server)

      // Send history
      const cursor = this.sql.exec<MessageRow>(
        'SELECT id, username, content, timestamp FROM messages ORDER BY timestamp DESC LIMIT 50'
      )
      const rows = [...cursor]
      const history = rows.reverse()

      server.send(
        JSON.stringify({
          type: 'history',
          messages: history,
          onlineUsers: this.getOnlineUsers(),
        })
      )

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    }

    return this.app.fetch(request)
  }
}
