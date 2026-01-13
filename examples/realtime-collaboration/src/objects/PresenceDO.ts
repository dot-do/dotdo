/**
 * PresenceDO - User Presence Durable Object
 *
 * Manages real-time user presence with:
 * - Online/offline status tracking
 * - Cursor position synchronization
 * - User avatars and names
 * - "Typing" indicators
 * - Heartbeat management
 * - WebSocket hibernation
 */

import { DurableObject } from 'cloudflare:workers'
import type {
  Message,
  PresenceUser,
  PresenceJoinMessage,
  PresenceLeaveMessage,
  PresenceUpdateMessage,
  CursorPosition,
  CursorUpdateMessage,
  ConnectMessage,
} from '../protocol/messages'
import { encodeMessage, decodeMessage } from '../protocol/encoder'
import { createErrorMessage } from '../protocol/messages'
import { TIMEOUTS } from '../protocol/constants'

// ============================================================================
// Types
// ============================================================================

interface Env {
  ENVIRONMENT?: string
}

interface PresenceState {
  user: PresenceUser
  cursor?: CursorPosition
  lastPing: number
  ws: WebSocket
  typingChannels: Set<string>
}

interface RoomConfig {
  maxUsers?: number
  allowGuests?: boolean
  persistPresence?: boolean
}

// ============================================================================
// PresenceDO Class
// ============================================================================

export class PresenceDO extends DurableObject<Env> {
  private roomId: string = ''
  private clients: Map<string, PresenceState> = new Map() // clientId -> state
  private config: RoomConfig = {}
  private cleanupAlarm: boolean = false

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Extract room ID from path
    const pathParts = url.pathname.split('/').filter(Boolean)
    if (pathParts.length > 0) {
      this.roomId = pathParts[0]
    }

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request)
    }

    // REST API
    const endpoint = url.pathname.split('/').pop()
    switch (endpoint) {
      case 'users':
        return this.handleGetUsers()
      case 'count':
        return this.handleGetCount()
      case 'status':
        return this.handleGetStatus()
      default:
        return new Response('Not Found', { status: 404 })
    }
  }

  /**
   * Get all online users
   */
  private handleGetUsers(): Response {
    const users: PresenceUser[] = []
    for (const state of this.clients.values()) {
      users.push(state.user)
    }
    return Response.json({
      roomId: this.roomId,
      users,
      count: users.length,
    })
  }

  /**
   * Get user count
   */
  private handleGetCount(): Response {
    return Response.json({
      roomId: this.roomId,
      count: this.clients.size,
    })
  }

  /**
   * Get room status
   */
  private handleGetStatus(): Response {
    const typingUsers: string[] = []
    for (const state of this.clients.values()) {
      if (state.typingChannels.size > 0) {
        typingUsers.push(state.user.clientId)
      }
    }

    return Response.json({
      roomId: this.roomId,
      online: this.clients.size,
      typingUsers,
      config: this.config,
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBSOCKET HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Upgrade to WebSocket
   */
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]

    // Accept with hibernation
    this.ctx.acceptWebSocket(server)

    // Schedule cleanup alarm if not already set
    if (!this.cleanupAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + TIMEOUTS.HEARTBEAT_TIMEOUT)
      this.cleanupAlarm = true
    }

    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * Handle WebSocket message
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = typeof message === 'string' ? message : new TextDecoder().decode(message)
      const msg = decodeMessage(data)

      await this.handleMessage(ws, msg)
    } catch (error) {
      const errorMsg = createErrorMessage('PARSE_ERROR', error instanceof Error ? error.message : 'Unknown error')
      ws.send(encodeMessage(errorMsg))
    }
  }

  /**
   * Route message to handler
   */
  private async handleMessage(ws: WebSocket, msg: Message): Promise<void> {
    switch (msg.type) {
      case 'connect':
        await this.handleConnect(ws, msg as ConnectMessage)
        break
      case 'presence:join':
        await this.handlePresenceJoin(ws, msg as PresenceJoinMessage)
        break
      case 'presence:leave':
        await this.handlePresenceLeave(msg as PresenceLeaveMessage)
        break
      case 'presence:update':
        await this.handlePresenceUpdate(ws, msg as PresenceUpdateMessage)
        break
      case 'cursor:update':
        await this.handleCursorUpdate(ws, msg as CursorUpdateMessage)
        break
      case 'channel:typing':
        await this.handleTyping(ws, msg)
        break
      case 'ping':
        await this.handlePing(ws)
        break
    }
  }

  /**
   * Handle initial connection
   */
  private async handleConnect(ws: WebSocket, msg: ConnectMessage): Promise<void> {
    const clientId = msg.clientId

    // Create presence state
    const user: PresenceUser = {
      clientId,
      userId: msg.auth?.userId,
      status: 'online',
      lastSeen: Date.now(),
    }

    const state: PresenceState = {
      user,
      lastPing: Date.now(),
      ws,
      typingChannels: new Set(),
    }

    this.clients.set(clientId, state)

    // Send connected message
    ws.send(
      encodeMessage({
        type: 'connected',
        clientId,
        sessionId: crypto.randomUUID(),
        serverTime: Date.now(),
      })
    )

    // Send current presence state
    this.sendPresenceSync(ws)

    // Broadcast join to others
    this.broadcastExcept(
      clientId,
      encodeMessage({
        type: 'presence:join',
        user,
        roomId: this.roomId,
      })
    )
  }

  /**
   * Handle presence join (when client has full user info)
   */
  private async handlePresenceJoin(ws: WebSocket, msg: PresenceJoinMessage): Promise<void> {
    const clientId = msg.user.clientId
    let state = this.clients.get(clientId)

    if (state) {
      // Update existing state
      state.user = { ...state.user, ...msg.user }
      state.ws = ws
    } else {
      // Create new state
      state = {
        user: msg.user,
        lastPing: Date.now(),
        ws,
        typingChannels: new Set(),
      }
      this.clients.set(clientId, state)
    }

    // Send sync
    this.sendPresenceSync(ws)

    // Broadcast to others
    this.broadcastExcept(clientId, encodeMessage(msg))
  }

  /**
   * Handle presence leave
   */
  private async handlePresenceLeave(msg: PresenceLeaveMessage): Promise<void> {
    this.clients.delete(msg.clientId)

    // Broadcast to others
    this.broadcastAll(encodeMessage(msg))
  }

  /**
   * Handle presence update
   */
  private async handlePresenceUpdate(ws: WebSocket, msg: PresenceUpdateMessage): Promise<void> {
    const state = this.clients.get(msg.clientId)
    if (!state) return

    // Update user info
    state.user = { ...state.user, ...msg.updates }
    state.lastPing = Date.now()

    // Broadcast to others
    this.broadcastExcept(msg.clientId, encodeMessage(msg))
  }

  /**
   * Handle cursor update
   */
  private async handleCursorUpdate(ws: WebSocket, msg: CursorUpdateMessage): Promise<void> {
    const clientId = msg.cursor.clientId

    const state = this.clients.get(clientId)
    if (state) {
      state.cursor = msg.cursor
      state.lastPing = Date.now()
    }

    // Broadcast to others
    this.broadcastExcept(clientId, encodeMessage(msg))
  }

  /**
   * Handle typing indicator
   */
  private async handleTyping(ws: WebSocket, msg: any): Promise<void> {
    const state = this.findStateByWs(ws)
    if (!state) return

    if (msg.isTyping) {
      state.typingChannels.add(msg.channelId)
    } else {
      state.typingChannels.delete(msg.channelId)
    }

    // Broadcast to others
    this.broadcastExcept(state.user.clientId, encodeMessage(msg))
  }

  /**
   * Handle ping (heartbeat)
   */
  private async handlePing(ws: WebSocket): Promise<void> {
    const state = this.findStateByWs(ws)
    if (state) {
      state.lastPing = Date.now()
      state.user.lastSeen = Date.now()
    }

    ws.send(encodeMessage({ type: 'pong', serverTime: Date.now() }))
  }

  /**
   * Send full presence sync to a client
   */
  private sendPresenceSync(ws: WebSocket): void {
    const users: PresenceUser[] = []
    for (const state of this.clients.values()) {
      users.push(state.user)
    }

    ws.send(
      encodeMessage({
        type: 'presence:sync',
        roomId: this.roomId,
        users,
      })
    )

    // Also send cursor positions
    const cursors: CursorPosition[] = []
    for (const state of this.clients.values()) {
      if (state.cursor) {
        cursors.push(state.cursor)
      }
    }

    if (cursors.length > 0) {
      ws.send(
        encodeMessage({
          type: 'cursor:sync',
          documentId: this.roomId,
          cursors,
        })
      )
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const state = this.findStateByWs(ws)
    if (state) {
      this.clients.delete(state.user.clientId)

      // Broadcast leave
      this.broadcastAll(
        encodeMessage({
          type: 'presence:leave',
          clientId: state.user.clientId,
          roomId: this.roomId,
        })
      )
    }
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const state = this.findStateByWs(ws)
    if (state) {
      this.clients.delete(state.user.clientId)

      this.broadcastAll(
        encodeMessage({
          type: 'presence:leave',
          clientId: state.user.clientId,
          roomId: this.roomId,
        })
      )
    }
  }

  /**
   * Handle alarm (cleanup stale connections)
   */
  async alarm(): Promise<void> {
    const now = Date.now()
    const staleThreshold = now - TIMEOUTS.HEARTBEAT_TIMEOUT

    // Find and remove stale clients
    const staleClients: string[] = []
    for (const [clientId, state] of this.clients) {
      if (state.lastPing < staleThreshold) {
        staleClients.push(clientId)
      }
    }

    for (const clientId of staleClients) {
      const state = this.clients.get(clientId)
      this.clients.delete(clientId)

      // Broadcast leave
      this.broadcastAll(
        encodeMessage({
          type: 'presence:leave',
          clientId,
          roomId: this.roomId,
        })
      )

      // Close WebSocket
      try {
        state?.ws.close(1000, 'Heartbeat timeout')
      } catch {
        // Already closed
      }
    }

    // Schedule next cleanup if there are still clients
    if (this.clients.size > 0) {
      await this.ctx.storage.setAlarm(Date.now() + TIMEOUTS.HEARTBEAT_TIMEOUT)
    } else {
      this.cleanupAlarm = false
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Find client state by WebSocket reference
   */
  private findStateByWs(ws: WebSocket): PresenceState | undefined {
    for (const state of this.clients.values()) {
      if (state.ws === ws) {
        return state
      }
    }
    return undefined
  }

  /**
   * Broadcast to all clients
   */
  private broadcastAll(message: string): void {
    for (const state of this.clients.values()) {
      try {
        state.ws.send(message)
      } catch {
        // Client disconnected
      }
    }
  }

  /**
   * Broadcast to all except one client
   */
  private broadcastExcept(excludeClientId: string, message: string): void {
    for (const [clientId, state] of this.clients) {
      if (clientId !== excludeClientId) {
        try {
          state.ws.send(message)
        } catch {
          // Client disconnected
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RPC METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all online users
   */
  getUsers(): PresenceUser[] {
    return Array.from(this.clients.values()).map((s) => s.user)
  }

  /**
   * Get user count
   */
  getUserCount(): number {
    return this.clients.size
  }

  /**
   * Check if a user is online
   */
  isUserOnline(clientId: string): boolean {
    return this.clients.has(clientId)
  }

  /**
   * Get a specific user
   */
  getUser(clientId: string): PresenceUser | undefined {
    return this.clients.get(clientId)?.user
  }

  /**
   * Get users who are typing
   */
  getTypingUsers(channelId?: string): string[] {
    const typing: string[] = []
    for (const state of this.clients.values()) {
      if (channelId) {
        if (state.typingChannels.has(channelId)) {
          typing.push(state.user.clientId)
        }
      } else if (state.typingChannels.size > 0) {
        typing.push(state.user.clientId)
      }
    }
    return typing
  }

  /**
   * Get all cursor positions
   */
  getCursors(): CursorPosition[] {
    const cursors: CursorPosition[] = []
    for (const state of this.clients.values()) {
      if (state.cursor) {
        cursors.push(state.cursor)
      }
    }
    return cursors
  }

  /**
   * Update room config
   */
  setConfig(config: RoomConfig): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Kick a user
   */
  kickUser(clientId: string, reason?: string): boolean {
    const state = this.clients.get(clientId)
    if (!state) return false

    this.clients.delete(clientId)

    // Notify kicked user
    try {
      state.ws.send(
        encodeMessage({
          type: 'error',
          code: 'KICKED',
          message: reason ?? 'You have been removed from the room',
        })
      )
      state.ws.close(1000, reason ?? 'Kicked')
    } catch {
      // Already closed
    }

    // Broadcast leave
    this.broadcastAll(
      encodeMessage({
        type: 'presence:leave',
        clientId,
        roomId: this.roomId,
      })
    )

    return true
  }
}
