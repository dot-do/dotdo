/**
 * WebSocket Manager for Durable Objects
 *
 * Provides:
 * - WebSocket connection handling and upgrade
 * - Message routing to handlers
 * - Broadcast to multiple connections
 * - Connection state management
 * - Heartbeat/ping-pong support
 */

// ============================================================================
// Types
// ============================================================================

export interface WebSocketMessage {
  type: string
  data?: unknown
}

export type WebSocketHandler = (ws: WebSocket, data: unknown) => void | Promise<void>

export interface BroadcastResult {
  sent: number
  failed: number
}

// ============================================================================
// WebSocket Manager Class
// ============================================================================

/**
 * WebSocketManager handles WebSocket connections, message routing, and broadcasts
 */
export class WebSocketManager {
  private websocketTags = new Map<WebSocket, string[]>()
  private hibernatableWebSockets = new Set<WebSocket>()
  private lastWebSocketTags: string[] = []
  private lastWebSocketHibernatable = false
  private handlers = new Map<string, Set<WebSocketHandler>>()
  private lastPongTimes = new Map<WebSocket, number>()

  /**
   * Handle WebSocket upgrade and connection setup
   * @param ctx The Durable Object state
   * @param tags Tags to attach to this WebSocket connection
   * @param hibernatable Whether this WebSocket supports hibernation
   * @returns Response with 101 status and WebSocket
   */
  handleWebSocketUpgrade(
    ctx: DurableObjectState,
    tags: string[],
    hibernatable: boolean
  ): Response {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // Accept WebSocket with optional hibernation support
    if (hibernatable) {
      ctx.acceptWebSocket(server, ['hibernatable'])
      this.hibernatableWebSockets.add(server)
    } else {
      ctx.acceptWebSocket(server)
    }

    // Track WebSocket metadata
    this.websocketTags.set(server, tags)
    this.lastWebSocketTags = tags
    this.lastWebSocketHibernatable = hibernatable

    // Initialize pong time
    this.lastPongTimes.set(server, Date.now())

    // In Cloudflare Workers, Response supports status 101 and webSocket property
    // Note: In test environment, we mock Response to support these
    try {
      return new Response(null, {
        status: 101,
        webSocket: client,
      } as any)
    } catch {
      // Fallback for test environments that don't support WebSocket responses
      const response = { status: 101, webSocket: client } as any
      return response
    }
  }

  /**
   * Get the tags attached to the last connected WebSocket
   * Note: WebSocket objects cannot be passed via RPC, so we use the last connected WebSocket's tags
   */
  getWebSocketTags(_ws?: WebSocket): string[] {
    return this.lastWebSocketTags
  }

  /**
   * Check if the last connected WebSocket supports hibernation
   */
  isWebSocketHibernatable(_ws?: WebSocket): boolean {
    return this.lastWebSocketHibernatable
  }

  /**
   * Get tags for a specific WebSocket
   */
  getTagsForWebSocket(ws: WebSocket): string[] {
    return this.websocketTags.get(ws) ?? []
  }

  /**
   * Broadcast a message to all WebSockets with the specified tag
   * @param ctx The Durable Object state
   * @param tag The tag to filter WebSocket recipients
   * @param message The message to broadcast (will be JSON-stringified)
   * @returns Number of WebSockets the message was sent to
   */
  broadcast(ctx: DurableObjectState, tag: string, message: unknown): BroadcastResult {
    let sent = 0
    let failed = 0
    const sockets = ctx.getWebSockets(tag)

    for (const ws of sockets) {
      try {
        ws.send(JSON.stringify(message))
        sent++
      } catch (err) {
        failed++
        console.warn(
          '[WebSocketManager] Broadcast send failed:',
          'error:', err instanceof Error ? err.message : String(err),
          'tag:', tag,
          'readyState:', ws.readyState
        )
      }
    }

    return { sent, failed }
  }

  /**
   * Clean up WebSocket tracking when connection closes or errors
   */
  cleanupWebSocket(ws: WebSocket): void {
    this.websocketTags.delete(ws)
    this.hibernatableWebSockets.delete(ws)
    this.lastPongTimes.delete(ws)
  }

  /**
   * Check if a WebSocket is hibernatable
   */
  isHibernatable(ws: WebSocket): boolean {
    return this.hibernatableWebSockets.has(ws)
  }

  /**
   * Register a message handler for a specific event type
   * @param type Event type (e.g., 'chat.message') or '*' for all events
   * @param handler Handler function
   */
  on(type: string, handler: WebSocketHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler)
  }

  /**
   * Remove a message handler
   */
  off(type: string, handler: WebSocketHandler): void {
    this.handlers.get(type)?.delete(handler)
  }

  /**
   * Handle incoming WebSocket message
   * Routes to appropriate handlers based on message type
   */
  async handleMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    // Handle binary messages
    if (message instanceof ArrayBuffer) {
      const binaryHandlers = this.handlers.get('binary') || new Set()
      const wildcardHandlers = this.handlers.get('*') || new Set()

      for (const handler of [...binaryHandlers, ...wildcardHandlers]) {
        try {
          await handler(ws, message)
        } catch (err) {
          console.error('[WebSocketManager] Handler error:', err)
        }
      }
      return
    }

    // Parse JSON message
    let msg: WebSocketMessage
    try {
      msg = JSON.parse(message)
    } catch (err) {
      // Send error back to client
      try {
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Invalid JSON message',
        }))
      } catch {
        // Ignore send errors
      }
      return
    }

    // Handle pong messages (for heartbeat)
    if (msg.type === 'pong') {
      this.lastPongTimes.set(ws, Date.now())
      return
    }

    // Route to handlers
    const typeHandlers = this.handlers.get(msg.type) || new Set()
    const wildcardHandlers = this.handlers.get('*') || new Set()

    for (const handler of [...typeHandlers, ...wildcardHandlers]) {
      try {
        await handler(ws, msg.data)
      } catch (err) {
        console.error('[WebSocketManager] Handler error:', err)
      }
    }
  }

  /**
   * Send a ping message to keep connection alive
   */
  sendPing(ws: WebSocket): void {
    try {
      ws.send(JSON.stringify({ type: 'ping' }))
    } catch (err) {
      console.warn('[WebSocketManager] Ping send failed:', err)
    }
  }

  /**
   * Get last pong time for a WebSocket
   */
  getLastPong(ws: WebSocket): number {
    return this.lastPongTimes.get(ws) || 0
  }

  /**
   * Set last pong time for a WebSocket (for testing)
   */
  setLastPong(ws: WebSocket, time: number): void {
    this.lastPongTimes.set(ws, time)
  }

  /**
   * Check if a connection is stale (hasn't responded to ping in timeout ms)
   */
  isStale(ws: WebSocket, timeout: number): boolean {
    const lastPong = this.lastPongTimes.get(ws) || 0
    return Date.now() - lastPong > timeout
  }

  /**
   * Close all stale connections
   */
  closeStaleConnections(timeout: number): void {
    for (const [ws, lastPong] of this.lastPongTimes.entries()) {
      if (Date.now() - lastPong > timeout) {
        try {
          ws.close(1000, 'Connection timeout')
        } catch (err) {
          console.warn('[WebSocketManager] Error closing stale connection:', err)
        }
      }
    }
  }

  /**
   * Start heartbeat interval for all connections
   * @param ctx Durable Object state
   * @param interval Interval in milliseconds
   * @param timeout Timeout in milliseconds to consider connection stale
   */
  startHeartbeat(ctx: DurableObjectState, interval: number, timeout: number): number {
    return setInterval(() => {
      const sockets = ctx.getWebSockets()
      for (const ws of sockets) {
        if (this.isStale(ws, timeout)) {
          try {
            ws.close(1000, 'Connection timeout')
          } catch {
            // Ignore errors
          }
        } else {
          this.sendPing(ws)
        }
      }
    }, interval) as unknown as number
  }

  /**
   * Stop heartbeat interval
   */
  stopHeartbeat(intervalId: number): void {
    clearInterval(intervalId)
  }

  /**
   * Get the number of active connections
   * @param ctx The Durable Object state
   * @param tag Optional tag to filter connections
   * @returns Number of active connections
   */
  getConnectionCount(ctx: DurableObjectState, tag?: string): number {
    const sockets = tag ? ctx.getWebSockets(tag) : ctx.getWebSockets()
    return sockets.length
  }

  /**
   * Send a message to a specific WebSocket
   * @param ws The WebSocket to send to
   * @param message The message to send (will be JSON-stringified)
   * @returns true if sent successfully, false otherwise
   */
  send(ws: WebSocket, message: unknown): boolean {
    try {
      ws.send(JSON.stringify(message))
      return true
    } catch (err) {
      console.warn(
        '[WebSocketManager] Send failed:',
        'error:', err instanceof Error ? err.message : String(err),
        'readyState:', ws.readyState
      )
      return false
    }
  }

  /**
   * Close a specific WebSocket connection
   * @param ws The WebSocket to close
   * @param code The close code (default: 1000)
   * @param reason The close reason
   */
  closeConnection(ws: WebSocket, code: number = 1000, reason?: string): void {
    try {
      ws.close(code, reason)
    } catch (err) {
      console.warn('[WebSocketManager] Error closing connection:', err)
    }
    this.cleanupWebSocket(ws)
  }

  /**
   * Broadcast a message to all connected WebSockets regardless of tag
   * @param ctx The Durable Object state
   * @param message The message to broadcast (will be JSON-stringified)
   * @returns Number of WebSockets the message was sent to
   */
  broadcastAll(ctx: DurableObjectState, message: unknown): BroadcastResult {
    let sent = 0
    let failed = 0
    const sockets = ctx.getWebSockets()

    for (const ws of sockets) {
      try {
        ws.send(JSON.stringify(message))
        sent++
      } catch (err) {
        failed++
        console.warn(
          '[WebSocketManager] Broadcast send failed:',
          'error:', err instanceof Error ? err.message : String(err),
          'readyState:', ws.readyState
        )
      }
    }

    return { sent, failed }
  }
}
