/**
 * RealtimeDO - Pusher-Compatible Realtime Durable Object
 *
 * WebSocket channels backed by Durable Objects with:
 * - Public, private, and presence channels
 * - Client events on private/presence channels
 * - Presence member tracking (who's online)
 * - Hibernatable WebSocket connections
 * - Pusher protocol compatibility
 *
 * @example
 * ```typescript
 * import { Pusher } from '@dotdo/pusher'
 *
 * const pusher = new Pusher('your-key', {
 *   wsHost: 'your-worker.workers.dev'
 * })
 *
 * // Subscribe to channels
 * const channel = pusher.subscribe('notifications')
 * channel.bind('new-message', (data) => console.log(data))
 *
 * // Presence channels
 * const room = pusher.subscribe('presence-lobby')
 * room.bind('pusher:subscription_succeeded', (members) => {
 *   console.log('Online:', members.count)
 * })
 * ```
 */

import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// TYPES
// ============================================================================

interface Env {
  ENVIRONMENT?: string
  PUSHER_APP_ID?: string
  PUSHER_KEY?: string
  PUSHER_SECRET?: string
}

interface PresenceMember {
  id: string
  info: Record<string, unknown>
}

interface ChannelSubscription {
  name: string
  subscribers: Set<WebSocket>
  presenceMembers: Map<WebSocket, PresenceMember>
}

interface PusherMessage {
  event: string
  channel?: string
  data?: unknown
}

interface AuthRequest {
  socket_id: string
  channel_name: string
  user_id?: string
  user_info?: Record<string, unknown>
}

// ============================================================================
// REALTIME DURABLE OBJECT
// ============================================================================

export class RealtimeDO extends DurableObject<Env> {
  private channels: Map<string, ChannelSubscription> = new Map()
  private socketToId: Map<WebSocket, string> = new Map()

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBSOCKET HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle incoming HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request)
    }

    // REST API endpoints
    switch (url.pathname) {
      case '/api/broadcast':
        return this.handleBroadcast(request)
      case '/api/auth':
        return this.handleAuth(request)
      default:
        if (url.pathname.startsWith('/api/presence/')) {
          const channel = url.pathname.replace('/api/presence/', '')
          return this.handleGetPresence(channel)
        }
        return new Response('Not Found', { status: 404 })
    }
  }

  /**
   * Upgrade HTTP connection to WebSocket
   */
  private async handleWebSocketUpgrade(_request: Request): Promise<Response> {
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]

    // Generate socket ID
    const socketId = this.generateSocketId()
    this.socketToId.set(server, socketId)

    // Accept the WebSocket with hibernation
    this.ctx.acceptWebSocket(server)

    // Send connection established event
    server.send(JSON.stringify({
      event: 'pusher:connection_established',
      data: JSON.stringify({
        socket_id: socketId,
        activity_timeout: 120
      })
    }))

    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * Handle WebSocket message (hibernation-compatible)
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = typeof message === 'string' ? message : new TextDecoder().decode(message)
      const msg = JSON.parse(data) as PusherMessage

      switch (msg.event) {
        case 'pusher:subscribe':
          await this.handleSubscribe(ws, msg)
          break
        case 'pusher:unsubscribe':
          await this.handleUnsubscribe(ws, msg)
          break
        case 'pusher:ping':
          ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }))
          break
        default:
          // Client events (must start with 'client-')
          if (msg.event.startsWith('client-') && msg.channel) {
            await this.handleClientEvent(ws, msg)
          }
          break
      }
    } catch (error) {
      ws.send(JSON.stringify({
        event: 'pusher:error',
        data: { message: error instanceof Error ? error.message : 'Unknown error', code: 4000 }
      }))
    }
  }

  /**
   * Handle WebSocket close (hibernation-compatible)
   */
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    await this.cleanupConnection(ws)
  }

  /**
   * Handle WebSocket error (hibernation-compatible)
   */
  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.cleanupConnection(ws)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHANNEL OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle channel subscription
   */
  private async handleSubscribe(ws: WebSocket, msg: PusherMessage): Promise<void> {
    const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data
    const channelName = data?.channel || msg.channel

    if (!channelName) {
      throw new Error('Channel name required')
    }

    // Get or create channel
    let channel = this.channels.get(channelName)
    if (!channel) {
      channel = {
        name: channelName,
        subscribers: new Set(),
        presenceMembers: new Map()
      }
      this.channels.set(channelName, channel)
    }

    // Add subscriber
    channel.subscribers.add(ws)

    // Handle presence channels
    if (channelName.startsWith('presence-')) {
      await this.handlePresenceSubscribe(ws, channel, data)
    } else {
      // Send subscription succeeded
      ws.send(JSON.stringify({
        event: 'pusher:subscription_succeeded',
        channel: channelName,
        data: '{}'
      }))
    }
  }

  /**
   * Handle presence channel subscription
   */
  private async handlePresenceSubscribe(
    ws: WebSocket,
    channel: ChannelSubscription,
    data: Record<string, unknown>
  ): Promise<void> {
    const socketId = this.socketToId.get(ws) || 'unknown'

    // Create presence member
    const member: PresenceMember = {
      id: (data.user_id as string) || socketId,
      info: (data.user_info as Record<string, unknown>) || {}
    }

    // Add to presence members
    channel.presenceMembers.set(ws, member)

    // Build members hash for subscription_succeeded
    const members: Record<string, Record<string, unknown>> = {}
    for (const [, m] of channel.presenceMembers) {
      members[m.id] = m.info
    }

    // Send subscription succeeded with members
    ws.send(JSON.stringify({
      event: 'pusher:subscription_succeeded',
      channel: channel.name,
      data: JSON.stringify({
        presence: {
          count: channel.presenceMembers.size,
          ids: Array.from(channel.presenceMembers.values()).map(m => m.id),
          hash: members
        }
      })
    }))

    // Notify existing subscribers of new member
    this.broadcastToChannel(channel.name, 'pusher:member_added', member, ws)
  }

  /**
   * Handle channel unsubscription
   */
  private async handleUnsubscribe(ws: WebSocket, msg: PusherMessage): Promise<void> {
    const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data
    const channelName = data?.channel || msg.channel

    if (!channelName) return

    const channel = this.channels.get(channelName)
    if (!channel) return

    // Remove subscriber
    channel.subscribers.delete(ws)

    // Handle presence channel
    if (channelName.startsWith('presence-')) {
      const member = channel.presenceMembers.get(ws)
      if (member) {
        channel.presenceMembers.delete(ws)
        // Notify remaining subscribers
        this.broadcastToChannel(channelName, 'pusher:member_removed', member, ws)
      }
    }

    // Cleanup empty channels
    if (channel.subscribers.size === 0) {
      this.channels.delete(channelName)
    }
  }

  /**
   * Handle client events (peer-to-peer)
   */
  private async handleClientEvent(ws: WebSocket, msg: PusherMessage): Promise<void> {
    const channelName = msg.channel!

    // Client events only allowed on private/presence channels
    if (!channelName.startsWith('private-') && !channelName.startsWith('presence-')) {
      throw new Error('Client events only allowed on private/presence channels')
    }

    const channel = this.channels.get(channelName)
    if (!channel) {
      throw new Error('Not subscribed to channel')
    }

    // Verify sender is subscribed
    if (!channel.subscribers.has(ws)) {
      throw new Error('Not subscribed to channel')
    }

    // Broadcast to other subscribers (exclude sender)
    this.broadcastToChannel(channelName, msg.event, msg.data, ws)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BROADCASTING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Broadcast event to all channel subscribers
   */
  private broadcastToChannel(
    channelName: string,
    event: string,
    data: unknown,
    exclude?: WebSocket
  ): void {
    const channel = this.channels.get(channelName)
    if (!channel) return

    const message = JSON.stringify({
      event,
      channel: channelName,
      data: typeof data === 'string' ? data : JSON.stringify(data)
    })

    for (const subscriber of channel.subscribers) {
      if (subscriber !== exclude) {
        try {
          subscriber.send(message)
        } catch {
          // Connection closed, will be cleaned up
        }
      }
    }
  }

  /**
   * Broadcast to channel via HTTP API
   */
  async broadcast(channel: string, event: string, data: unknown): Promise<{ ok: boolean }> {
    this.broadcastToChannel(channel, event, data)
    return { ok: true }
  }

  /**
   * Get presence members for a channel
   */
  getPresence(channelName: string): { members: PresenceMember[]; count: number } {
    const channel = this.channels.get(channelName)
    if (!channel) {
      return { members: [], count: 0 }
    }

    const members = Array.from(channel.presenceMembers.values())
    return { members, count: members.length }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REST API HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle broadcast API request
   */
  private async handleBroadcast(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const body = await request.json() as { channel: string; event: string; data: unknown }
    const { channel, event, data } = body

    if (!channel || !event) {
      return Response.json({ error: 'Missing channel or event' }, { status: 400 })
    }

    const result = await this.broadcast(channel, event, data)
    return Response.json(result)
  }

  /**
   * Handle channel auth request
   */
  private async handleAuth(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const body = await request.json() as AuthRequest
    const { socket_id, channel_name, user_id, user_info } = body

    if (!socket_id || !channel_name) {
      return Response.json({ error: 'Missing socket_id or channel_name' }, { status: 400 })
    }

    // Simple auth - in production, verify user session
    const secret = this.env.PUSHER_SECRET || 'demo-secret'
    const signature = await this.generateSignature(`${socket_id}:${channel_name}`, secret)

    const response: Record<string, unknown> = {
      auth: `${this.env.PUSHER_KEY || 'demo-key'}:${signature}`
    }

    // For presence channels, include user data
    if (channel_name.startsWith('presence-')) {
      response.channel_data = JSON.stringify({
        user_id: user_id || socket_id,
        user_info: user_info || {}
      })
    }

    return Response.json(response)
  }

  /**
   * Handle presence API request
   */
  private handleGetPresence(channelName: string): Response {
    const presence = this.getPresence(channelName)
    return Response.json(presence)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate a unique socket ID
   */
  private generateSocketId(): string {
    const random1 = Math.floor(Math.random() * 1000000000)
    const random2 = Math.floor(Math.random() * 1000000000)
    return `${random1}.${random2}`
  }

  /**
   * Generate HMAC signature for auth
   */
  private async generateSignature(data: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Cleanup disconnected connection
   */
  private async cleanupConnection(ws: WebSocket): Promise<void> {
    // Remove from all channels
    for (const [channelName, channel] of this.channels) {
      if (channel.subscribers.has(ws)) {
        channel.subscribers.delete(ws)

        // Handle presence cleanup
        if (channelName.startsWith('presence-')) {
          const member = channel.presenceMembers.get(ws)
          if (member) {
            channel.presenceMembers.delete(ws)
            this.broadcastToChannel(channelName, 'pusher:member_removed', member)
          }
        }

        // Remove empty channels
        if (channel.subscribers.size === 0) {
          this.channels.delete(channelName)
        }
      }
    }

    // Remove socket mapping
    this.socketToId.delete(ws)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RPC METHODS (for DO-to-DO calls)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get channel info (for admin/debugging)
   */
  getChannelInfo(): { channels: string[]; totalConnections: number } {
    return {
      channels: Array.from(this.channels.keys()),
      totalConnections: this.socketToId.size
    }
  }

  /**
   * Get channel subscriber count
   */
  getSubscriberCount(channel: string): number {
    return this.channels.get(channel)?.subscribers.size ?? 0
  }
}

export default RealtimeDO
