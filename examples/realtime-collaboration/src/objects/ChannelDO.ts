/**
 * ChannelDO - Real-time Messaging Durable Object
 *
 * Provides real-time messaging with:
 * - WebSocket message broadcasting
 * - Room/channel management
 * - Message history with pagination
 * - Typing indicators
 * - Message persistence
 * - WebSocket hibernation
 */

import { DurableObject } from 'cloudflare:workers'
import type {
  Message,
  ChannelMessage,
  ChannelSubscribeMessage,
  ChannelUnsubscribeMessage,
  ChannelMessageMessage,
  ChannelTypingMessage,
  ConnectMessage,
} from '../protocol/messages'
import { encodeMessage, decodeMessage } from '../protocol/encoder'
import { createErrorMessage, createChannelMessageMessage } from '../protocol/messages'
import { LIMITS } from '../protocol/constants'

// ============================================================================
// Types
// ============================================================================

interface Env {
  ENVIRONMENT?: string
}

interface ClientState {
  clientId: string
  userId?: string
  name?: string
  ws: WebSocket
  subscribedChannels: Set<string>
  lastActivity: number
}

interface ChannelState {
  id: string
  subscribers: Set<string> // clientIds
  typingUsers: Map<string, number> // clientId -> timestamp
  createdAt: number
}

// ============================================================================
// ChannelDO Class
// ============================================================================

export class ChannelDO extends DurableObject<Env> {
  private clients: Map<string, ClientState> = new Map()
  private channels: Map<string, ChannelState> = new Map()
  private messageCounter: number = 0

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Load message counter from storage
   */
  private async loadCounter(): Promise<void> {
    const counter = await this.ctx.storage.get<number>('messageCounter')
    if (counter !== undefined) {
      this.messageCounter = counter
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    await this.loadCounter()

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request)
    }

    // REST API
    const pathParts = url.pathname.split('/').filter(Boolean)
    const endpoint = pathParts[pathParts.length - 1]

    switch (endpoint) {
      case 'channels':
        return this.handleGetChannels()
      case 'history':
        return this.handleGetHistory(request, pathParts)
      case 'send':
        return this.handleSendMessage(request)
      case 'stats':
        return this.handleGetStats()
      default:
        return new Response('Not Found', { status: 404 })
    }
  }

  /**
   * Get all active channels
   */
  private handleGetChannels(): Response {
    const channels = Array.from(this.channels.entries()).map(([id, state]) => ({
      id,
      subscriberCount: state.subscribers.size,
      typingCount: state.typingUsers.size,
      createdAt: state.createdAt,
    }))

    return Response.json({ channels })
  }

  /**
   * Get message history for a channel
   */
  private async handleGetHistory(request: Request, pathParts: string[]): Promise<Response> {
    const url = new URL(request.url)
    const channelId = pathParts[pathParts.length - 2] || url.searchParams.get('channel') || 'general'
    const limit = parseInt(url.searchParams.get('limit') || '50', 10)
    const before = url.searchParams.get('before')

    // Load messages from storage
    const messages = await this.getMessageHistory(channelId, limit, before)

    return Response.json({
      channelId,
      messages,
      hasMore: messages.length === limit,
      oldestId: messages[messages.length - 1]?.id,
    })
  }

  /**
   * Send a message via HTTP
   */
  private async handleSendMessage(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const body = (await request.json()) as {
      channelId: string
      content: string
      senderId: string
      senderName?: string
      type?: 'text' | 'system' | 'action'
    }

    const message = await this.createAndBroadcastMessage(body.channelId, body.content, body.senderId, body.senderName, body.type)

    return Response.json({ message })
  }

  /**
   * Get channel stats
   */
  private handleGetStats(): Response {
    return Response.json({
      totalClients: this.clients.size,
      totalChannels: this.channels.size,
      messagesSent: this.messageCounter,
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

    this.ctx.acceptWebSocket(server)

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
      case 'channel:subscribe':
        await this.handleSubscribe(ws, msg as ChannelSubscribeMessage)
        break
      case 'channel:unsubscribe':
        await this.handleUnsubscribe(ws, msg as ChannelUnsubscribeMessage)
        break
      case 'channel:message':
        await this.handleChannelMessage(ws, msg as ChannelMessageMessage)
        break
      case 'channel:typing':
        await this.handleTyping(ws, msg as ChannelTypingMessage)
        break
      case 'ping':
        ws.send(encodeMessage({ type: 'pong', serverTime: Date.now() }))
        break
    }
  }

  /**
   * Handle client connection
   */
  private async handleConnect(ws: WebSocket, msg: ConnectMessage): Promise<void> {
    const clientId = msg.clientId

    const state: ClientState = {
      clientId,
      userId: msg.auth?.userId,
      ws,
      subscribedChannels: new Set(),
      lastActivity: Date.now(),
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

    // Auto-subscribe to default channel if specified
    if (msg.channelId) {
      await this.subscribeToChannel(clientId, msg.channelId)
      this.sendChannelHistory(ws, msg.channelId)
    }
  }

  /**
   * Handle channel subscription
   */
  private async handleSubscribe(ws: WebSocket, msg: ChannelSubscribeMessage): Promise<void> {
    const state = this.findClientByWs(ws)
    if (!state) return

    await this.subscribeToChannel(state.clientId, msg.channelId)

    // Send history
    await this.sendChannelHistory(ws, msg.channelId, msg.lastMessageId)
  }

  /**
   * Subscribe client to channel
   */
  private async subscribeToChannel(clientId: string, channelId: string): Promise<void> {
    const client = this.clients.get(clientId)
    if (!client) return

    // Add to client's subscriptions
    client.subscribedChannels.add(channelId)

    // Get or create channel
    let channel = this.channels.get(channelId)
    if (!channel) {
      channel = {
        id: channelId,
        subscribers: new Set(),
        typingUsers: new Map(),
        createdAt: Date.now(),
      }
      this.channels.set(channelId, channel)
    }

    channel.subscribers.add(clientId)
  }

  /**
   * Send channel history to client
   */
  private async sendChannelHistory(ws: WebSocket, channelId: string, afterId?: string): Promise<void> {
    const messages = await this.getMessageHistory(channelId, 50, afterId)

    ws.send(
      encodeMessage({
        type: 'channel:history',
        channelId,
        messages,
        hasMore: messages.length === 50,
        oldestId: messages[messages.length - 1]?.id,
      })
    )
  }

  /**
   * Handle channel unsubscription
   */
  private async handleUnsubscribe(ws: WebSocket, msg: ChannelUnsubscribeMessage): Promise<void> {
    const state = this.findClientByWs(ws)
    if (!state) return

    this.unsubscribeFromChannel(state.clientId, msg.channelId)
  }

  /**
   * Unsubscribe client from channel
   */
  private unsubscribeFromChannel(clientId: string, channelId: string): void {
    const client = this.clients.get(clientId)
    if (client) {
      client.subscribedChannels.delete(channelId)
    }

    const channel = this.channels.get(channelId)
    if (channel) {
      channel.subscribers.delete(clientId)
      channel.typingUsers.delete(clientId)

      // Remove empty channels
      if (channel.subscribers.size === 0) {
        this.channels.delete(channelId)
      }
    }
  }

  /**
   * Handle incoming message
   */
  private async handleChannelMessage(ws: WebSocket, msg: ChannelMessageMessage): Promise<void> {
    const state = this.findClientByWs(ws)
    if (!state) return

    // Verify client is subscribed
    if (!state.subscribedChannels.has(msg.message.channelId)) {
      ws.send(encodeMessage(createErrorMessage('NOT_SUBSCRIBED', 'Not subscribed to channel')))
      return
    }

    // Create and store message
    const message = await this.createAndBroadcastMessage(msg.message.channelId, msg.message.content, state.clientId, state.name, msg.message.type, msg.message.replyTo)

    // Clear typing indicator
    const channel = this.channels.get(msg.message.channelId)
    if (channel) {
      channel.typingUsers.delete(state.clientId)
    }
  }

  /**
   * Handle typing indicator
   */
  private async handleTyping(ws: WebSocket, msg: ChannelTypingMessage): Promise<void> {
    const state = this.findClientByWs(ws)
    if (!state) return

    const channel = this.channels.get(msg.channelId)
    if (!channel) return

    if (msg.isTyping) {
      channel.typingUsers.set(msg.clientId, Date.now())
    } else {
      channel.typingUsers.delete(msg.clientId)
    }

    // Broadcast to others in channel
    this.broadcastToChannel(msg.channelId, encodeMessage(msg), state.clientId)
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const state = this.findClientByWs(ws)
    if (state) {
      // Unsubscribe from all channels
      for (const channelId of state.subscribedChannels) {
        this.unsubscribeFromChannel(state.clientId, channelId)
      }
      this.clients.delete(state.clientId)
    }
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const state = this.findClientByWs(ws)
    if (state) {
      for (const channelId of state.subscribedChannels) {
        this.unsubscribeFromChannel(state.clientId, channelId)
      }
      this.clients.delete(state.clientId)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create and broadcast a message
   */
  private async createAndBroadcastMessage(
    channelId: string,
    content: string,
    senderId: string,
    senderName?: string,
    type: 'text' | 'system' | 'action' = 'text',
    replyTo?: string
  ): Promise<ChannelMessage> {
    this.messageCounter++
    await this.ctx.storage.put('messageCounter', this.messageCounter)

    const message: ChannelMessage = {
      id: `msg_${Date.now()}_${this.messageCounter}`,
      channelId,
      senderId,
      senderName,
      content,
      type,
      timestamp: Date.now(),
      replyTo,
    }

    // Store message
    await this.storeMessage(message)

    // Broadcast to subscribers
    const broadcastMsg = createChannelMessageMessage(message)
    this.broadcastToChannel(channelId, encodeMessage(broadcastMsg))

    return message
  }

  /**
   * Store message in history
   */
  private async storeMessage(message: ChannelMessage): Promise<void> {
    const key = `message:${message.channelId}:${message.id}`
    await this.ctx.storage.put(key, message)

    // Maintain message index for the channel
    const indexKey = `index:${message.channelId}`
    const index = (await this.ctx.storage.get<string[]>(indexKey)) || []
    index.push(message.id)

    // Trim to max history length
    if (index.length > LIMITS.MAX_HISTORY_LENGTH) {
      const toRemove = index.slice(0, index.length - LIMITS.MAX_HISTORY_LENGTH)
      for (const id of toRemove) {
        await this.ctx.storage.delete(`message:${message.channelId}:${id}`)
      }
      index.splice(0, index.length - LIMITS.MAX_HISTORY_LENGTH)
    }

    await this.ctx.storage.put(indexKey, index)
  }

  /**
   * Get message history for a channel
   */
  private async getMessageHistory(channelId: string, limit: number, beforeId?: string): Promise<ChannelMessage[]> {
    const indexKey = `index:${channelId}`
    const index = (await this.ctx.storage.get<string[]>(indexKey)) || []

    // Find starting point
    let startIdx = index.length - 1
    if (beforeId) {
      const beforeIdx = index.indexOf(beforeId)
      if (beforeIdx > 0) {
        startIdx = beforeIdx - 1
      }
    }

    // Get messages
    const messages: ChannelMessage[] = []
    for (let i = startIdx; i >= 0 && messages.length < limit; i--) {
      const id = index[i]
      const message = await this.ctx.storage.get<ChannelMessage>(`message:${channelId}:${id}`)
      if (message) {
        messages.push(message)
      }
    }

    return messages.reverse() // Return in chronological order
  }

  /**
   * Broadcast to all subscribers of a channel
   */
  private broadcastToChannel(channelId: string, message: string, excludeClientId?: string): void {
    const channel = this.channels.get(channelId)
    if (!channel) return

    for (const clientId of channel.subscribers) {
      if (clientId === excludeClientId) continue

      const client = this.clients.get(clientId)
      if (client) {
        try {
          client.ws.send(message)
        } catch {
          // Client disconnected
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Find client state by WebSocket
   */
  private findClientByWs(ws: WebSocket): ClientState | undefined {
    for (const state of this.clients.values()) {
      if (state.ws === ws) {
        return state
      }
    }
    return undefined
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RPC METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Send a message (RPC)
   */
  async sendMessage(channelId: string, content: string, senderId: string, senderName?: string): Promise<ChannelMessage> {
    return this.createAndBroadcastMessage(channelId, content, senderId, senderName)
  }

  /**
   * Get channel subscribers
   */
  getSubscribers(channelId: string): string[] {
    const channel = this.channels.get(channelId)
    return channel ? Array.from(channel.subscribers) : []
  }

  /**
   * Get subscriber count
   */
  getSubscriberCount(channelId: string): number {
    return this.channels.get(channelId)?.subscribers.size ?? 0
  }

  /**
   * Get all channel IDs
   */
  getChannelIds(): string[] {
    return Array.from(this.channels.keys())
  }

  /**
   * Get typing users for a channel
   */
  getTypingUsers(channelId: string): string[] {
    const channel = this.channels.get(channelId)
    if (!channel) return []

    const now = Date.now()
    const typing: string[] = []

    // Remove stale typing indicators (> 5 seconds old)
    for (const [clientId, timestamp] of channel.typingUsers) {
      if (now - timestamp < 5000) {
        typing.push(clientId)
      } else {
        channel.typingUsers.delete(clientId)
      }
    }

    return typing
  }

  /**
   * Create a system message
   */
  async sendSystemMessage(channelId: string, content: string): Promise<ChannelMessage> {
    return this.createAndBroadcastMessage(channelId, content, 'system', 'System', 'system')
  }

  /**
   * Delete a message
   */
  async deleteMessage(channelId: string, messageId: string): Promise<boolean> {
    const key = `message:${channelId}:${messageId}`
    const message = await this.ctx.storage.get<ChannelMessage>(key)

    if (!message) return false

    await this.ctx.storage.delete(key)

    // Remove from index
    const indexKey = `index:${channelId}`
    const index = (await this.ctx.storage.get<string[]>(indexKey)) || []
    const idx = index.indexOf(messageId)
    if (idx >= 0) {
      index.splice(idx, 1)
      await this.ctx.storage.put(indexKey, index)
    }

    return true
  }
}
