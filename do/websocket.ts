/**
 * WebSocket Manager for Durable Objects
 *
 * Provides:
 * - WebSocket connection handling and upgrade
 * - Message routing to handlers
 * - Broadcast to multiple connections
 * - Connection state management with proper isolation
 * - Heartbeat/ping-pong support
 * - Connection lifecycle events (connect, disconnect)
 * - Reconnection handling with connection IDs
 */

import { createLogger } from '@dotdo/utils'

const logger = createLogger('[WebSocketManager]')

// ============================================================================
// Types
// ============================================================================

export interface WebSocketMessage {
  type: string
  data?: unknown
}

export type WebSocketHandler = (ws: WebSocket, data: unknown) => void | Promise<void>

/**
 * Connection lifecycle event handler
 */
export type ConnectionHandler = (ws: WebSocket, connectionId: string, metadata: ConnectionMetadata) => void | Promise<void>

/**
 * Metadata associated with each WebSocket connection
 */
export interface ConnectionMetadata {
  connectionId: string
  tags: string[]
  hibernatable: boolean
  connectedAt: number
  lastActivityAt: number
  reconnectCount: number
  clientId?: string | undefined // Optional client identifier for reconnection tracking
}

export interface BroadcastResult {
  sent: number
  failed: number
}

// ============================================================================
// WebSocket Manager Class
// ============================================================================

/**
 * WebSocketManager handles WebSocket connections, message routing, and broadcasts
 * with proper state isolation between connections
 */
export class WebSocketManager {
  // Per-connection metadata storage (replaces separate maps for better isolation)
  private connections = new Map<WebSocket, ConnectionMetadata>()

  // Message handlers by event type
  private handlers = new Map<string, Set<WebSocketHandler>>()

  // Connection lifecycle handlers
  private connectHandlers = new Set<ConnectionHandler>()
  private disconnectHandlers = new Set<ConnectionHandler>()

  // Track client IDs for reconnection detection
  private clientConnections = new Map<string, WebSocket>()

  // Counter for generating unique connection IDs
  private connectionCounter = 0

  // Legacy compatibility - tracks last connected WebSocket for RPC scenarios
  private lastConnectionId: string | null = null

  /**
   * Generate a unique connection ID
   */
  private generateConnectionId(): string {
    this.connectionCounter++
    return `conn_${Date.now().toString(36)}_${this.connectionCounter.toString(36)}`
  }

  /**
   * Handle WebSocket upgrade and connection setup
   * @param ctx The Durable Object state
   * @param tags Tags to attach to this WebSocket connection
   * @param hibernatable Whether this WebSocket supports hibernation
   * @param clientId Optional client ID for reconnection tracking
   * @returns Response with 101 status and WebSocket
   */
  handleWebSocketUpgrade(
    ctx: DurableObjectState,
    tags: string[],
    hibernatable: boolean,
    clientId?: string
  ): Response {
    const pair = new WebSocketPair()
    // WebSocketPair is a tuple-like object with [0] and [1] properties
    // These are guaranteed to exist by the WebSocketPair API
    const client = pair[0] as WebSocket
    const server = pair[1] as WebSocket

    // Handle reconnection - clean up old connection for same client
    // IMPORTANT: We capture reconnectCount BEFORE cleanup to preserve the count
    let reconnectCount = 0
    if (clientId) {
      const existingWs = this.clientConnections.get(clientId)
      if (existingWs) {
        const existingMetadata = this.connections.get(existingWs)
        if (existingMetadata) {
          reconnectCount = existingMetadata.reconnectCount + 1
        }
        // Remove from clientConnections FIRST to prevent race condition
        // where cleanup might re-delete the new connection's clientId entry
        this.clientConnections.delete(clientId)
        // Clean up old connection state (this won't touch clientConnections
        // since we already removed it above)
        this.cleanupWebSocket(existingWs)
        try {
          existingWs.close(1000, 'Reconnected from another connection')
        } catch {
          // Ignore close errors on stale connections
        }
      }
    }

    // Accept WebSocket with optional hibernation support
    if (hibernatable) {
      ctx.acceptWebSocket(server, ['hibernatable'])
    } else {
      ctx.acceptWebSocket(server)
    }

    // Create isolated connection metadata
    const connectionId = this.generateConnectionId()
    const now = Date.now()
    const metadata: ConnectionMetadata = {
      connectionId,
      tags: [...tags], // Clone to prevent external mutation
      hibernatable,
      connectedAt: now,
      lastActivityAt: now,
      reconnectCount,
      clientId,
    }

    // Store connection metadata BEFORE updating clientConnections
    // to ensure the connection is fully registered
    this.connections.set(server, metadata)
    this.lastConnectionId = connectionId

    // Track client connection for reconnection detection
    if (clientId) {
      this.clientConnections.set(clientId, server)
    }

    // Notify connect handlers asynchronously
    // Clone metadata to prevent handlers from mutating internal state
    this.notifyConnectHandlers(server, connectionId, { ...metadata })

    // Cloudflare Workers ResponseInit supports status 101 and webSocket property
    // See: @cloudflare/workers-types ResponseInit interface
    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  /**
   * Notify all registered connect handlers
   */
  private async notifyConnectHandlers(ws: WebSocket, connectionId: string, metadata: ConnectionMetadata): Promise<void> {
    for (const handler of this.connectHandlers) {
      try {
        await handler(ws, connectionId, metadata)
      } catch (err) {
        logger.error(' Connect handler error:', err)
      }
    }
  }

  /**
   * Notify all registered disconnect handlers
   */
  private async notifyDisconnectHandlers(ws: WebSocket, connectionId: string, metadata: ConnectionMetadata): Promise<void> {
    for (const handler of this.disconnectHandlers) {
      try {
        await handler(ws, connectionId, metadata)
      } catch (err) {
        logger.error(' Disconnect handler error:', err)
      }
    }
  }

  /**
   * Register a handler for connection events
   */
  onConnect(handler: ConnectionHandler): void {
    this.connectHandlers.add(handler)
  }

  /**
   * Remove a connection event handler
   */
  offConnect(handler: ConnectionHandler): void {
    this.connectHandlers.delete(handler)
  }

  /**
   * Register a handler for disconnection events
   */
  onDisconnect(handler: ConnectionHandler): void {
    this.disconnectHandlers.add(handler)
  }

  /**
   * Remove a disconnection event handler
   */
  offDisconnect(handler: ConnectionHandler): void {
    this.disconnectHandlers.delete(handler)
  }

  /**
   * Get connection metadata for a specific WebSocket
   */
  getConnectionMetadata(ws: WebSocket): ConnectionMetadata | undefined {
    return this.connections.get(ws)
  }

  /**
   * Get the tags attached to the last connected WebSocket
   * Note: WebSocket objects cannot be passed via RPC, so we use the last connected WebSocket's tags
   * @deprecated Use getConnectionMetadata(ws).tags instead for proper isolation
   */
  getWebSocketTags(ws?: WebSocket): string[] {
    if (ws) {
      const metadata = this.connections.get(ws)
      return metadata?.tags ?? []
    }
    // Legacy: find connection by last connection ID
    for (const [, metadata] of this.connections) {
      if (metadata.connectionId === this.lastConnectionId) {
        return metadata.tags
      }
    }
    return []
  }

  /**
   * Check if a WebSocket supports hibernation
   * @deprecated Use getConnectionMetadata(ws).hibernatable instead for proper isolation
   */
  isWebSocketHibernatable(ws?: WebSocket): boolean {
    if (ws) {
      const metadata = this.connections.get(ws)
      return metadata?.hibernatable ?? false
    }
    // Legacy: find connection by last connection ID
    for (const [, metadata] of this.connections) {
      if (metadata.connectionId === this.lastConnectionId) {
        return metadata.hibernatable
      }
    }
    return false
  }

  /**
   * Get tags for a specific WebSocket
   */
  getTagsForWebSocket(ws: WebSocket): string[] {
    const metadata = this.connections.get(ws)
    return metadata?.tags ?? []
  }

  /**
   * Get connection ID for a specific WebSocket
   */
  getConnectionId(ws: WebSocket): string | undefined {
    return this.connections.get(ws)?.connectionId
  }

  /**
   * Get WebSocket by client ID (for reconnection scenarios)
   */
  getWebSocketByClientId(clientId: string): WebSocket | undefined {
    return this.clientConnections.get(clientId)
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
        logger.warn(
          'Broadcast send failed:',
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
   * Notifies disconnect handlers and removes all connection state
   *
   * Note: This method is idempotent - calling it multiple times for the same
   * WebSocket is safe and will only trigger cleanup once.
   */
  cleanupWebSocket(ws: WebSocket): void {
    const metadata = this.connections.get(ws)

    if (metadata) {
      // Remove connection metadata FIRST to prevent re-entrant cleanup
      this.connections.delete(ws)

      // Clean up client ID tracking
      if (metadata.clientId) {
        const currentWs = this.clientConnections.get(metadata.clientId)
        // Only remove if this is still the current connection for this client
        if (currentWs === ws) {
          this.clientConnections.delete(metadata.clientId)
        }
      }

      // Notify disconnect handlers (fire-and-forget, but errors are logged)
      // We do this AFTER removing from connections to prevent race conditions
      // where a handler might try to access the now-invalid connection
      this.notifyDisconnectHandlers(ws, metadata.connectionId, { ...metadata })
    }
  }

  /**
   * Check if a WebSocket is hibernatable
   */
  isHibernatable(ws: WebSocket): boolean {
    const metadata = this.connections.get(ws)
    return metadata?.hibernatable ?? false
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
    const handlers = this.handlers.get(type)
    if (handlers) {
      handlers.add(handler)
    }
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
   * Updates connection activity timestamp
   */
  async handleMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    // Update last activity time
    const metadata = this.connections.get(ws)
    if (metadata) {
      metadata.lastActivityAt = Date.now()
    }

    // Handle binary messages
    if (message instanceof ArrayBuffer) {
      const binaryHandlers = this.handlers.get('binary') || new Set()
      const wildcardHandlers = this.handlers.get('*') || new Set()

      for (const handler of [...binaryHandlers, ...wildcardHandlers]) {
        try {
          await handler(ws, message)
        } catch (err) {
          logger.error(' Handler error:', err)
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
      // Update activity on pong
      return
    }

    // Route to handlers
    const typeHandlers = this.handlers.get(msg.type) || new Set()
    const wildcardHandlers = this.handlers.get('*') || new Set()

    for (const handler of [...typeHandlers, ...wildcardHandlers]) {
      try {
        await handler(ws, msg.data)
      } catch (err) {
        logger.error(' Handler error:', err)
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
      logger.warn(' Ping send failed:', err)
    }
  }

  /**
   * Get last activity time for a WebSocket (replaces lastPongTimes)
   */
  getLastPong(ws: WebSocket): number {
    const metadata = this.connections.get(ws)
    return metadata?.lastActivityAt || 0
  }

  /**
   * Set last activity time for a WebSocket (for testing)
   */
  setLastPong(ws: WebSocket, time: number): void {
    const metadata = this.connections.get(ws)
    if (metadata) {
      metadata.lastActivityAt = time
    }
  }

  /**
   * Check if a connection is stale (no activity in timeout ms)
   */
  isStale(ws: WebSocket, timeout: number): boolean {
    const metadata = this.connections.get(ws)
    if (!metadata) return true // Unknown connection is stale
    return Date.now() - metadata.lastActivityAt > timeout
  }

  /**
   * Close all stale connections
   */
  closeStaleConnections(timeout: number): void {
    const now = Date.now()
    for (const [ws, metadata] of this.connections.entries()) {
      if (now - metadata.lastActivityAt > timeout) {
        try {
          ws.close(1000, 'Connection timeout')
        } catch (err) {
          logger.warn(' Error closing stale connection:', err)
        }
        this.cleanupWebSocket(ws)
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
          this.cleanupWebSocket(ws)
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
      logger.warn(
        'Send failed:',
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
      logger.warn(' Error closing connection:', err)
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
        logger.warn(
          'Broadcast send failed:',
          'error:', err instanceof Error ? err.message : String(err),
          'readyState:', ws.readyState
        )
      }
    }

    return { sent, failed }
  }

  /**
   * Get all active connections with their metadata
   * Useful for debugging and monitoring
   */
  getAllConnections(): Array<{ ws: WebSocket; metadata: ConnectionMetadata }> {
    return Array.from(this.connections.entries()).map(
      (entry: [WebSocket, ConnectionMetadata]) => ({
        ws: entry[0],
        metadata: { ...entry[1] }, // Clone to prevent mutation
      })
    )
  }

  /**
   * Get connections filtered by tag
   */
  getConnectionsByTag(tag: string): Array<{ ws: WebSocket; metadata: ConnectionMetadata }> {
    return this.getAllConnections().filter(
      ({ metadata }) => metadata.tags.includes(tag)
    )
  }

  /**
   * Check if a connection is tracked by this manager
   */
  hasConnection(ws: WebSocket): boolean {
    return this.connections.has(ws)
  }

  /**
   * Update tags for an existing connection
   */
  updateConnectionTags(ws: WebSocket, tags: string[]): boolean {
    const metadata = this.connections.get(ws)
    if (!metadata) return false
    metadata.tags = [...tags]
    return true
  }

  /**
   * Add a tag to an existing connection
   */
  addConnectionTag(ws: WebSocket, tag: string): boolean {
    const metadata = this.connections.get(ws)
    if (!metadata) return false
    if (!metadata.tags.includes(tag)) {
      metadata.tags.push(tag)
    }
    return true
  }

  /**
   * Remove a tag from an existing connection
   */
  removeConnectionTag(ws: WebSocket, tag: string): boolean {
    const metadata = this.connections.get(ws)
    if (!metadata) return false
    const index = metadata.tags.indexOf(tag)
    if (index !== -1) {
      metadata.tags.splice(index, 1)
    }
    return true
  }

  /**
   * Set a client ID for an existing connection (for reconnection tracking)
   */
  setClientId(ws: WebSocket, clientId: string): boolean {
    const metadata = this.connections.get(ws)
    if (!metadata) return false

    // Clean up old client ID mapping
    if (metadata.clientId) {
      const oldWs = this.clientConnections.get(metadata.clientId)
      if (oldWs === ws) {
        this.clientConnections.delete(metadata.clientId)
      }
    }

    // Set new client ID
    metadata.clientId = clientId
    this.clientConnections.set(clientId, ws)
    return true
  }
}
