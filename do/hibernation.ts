/**
 * WebSocket Hibernation Support for Durable Objects
 *
 * Provides hibernation-aware WebSocket connection management for significant
 * cost reduction on idle connections. Cloudflare's WebSocket Hibernation API
 * allows DOs to be evicted from memory while maintaining WebSocket connections.
 *
 * ## Cost Savings
 *
 * Without hibernation:
 * - DO stays "awake" as long as WebSocket is connected
 * - Billed for wall-clock duration even when idle
 *
 * With hibernation:
 * - DO can "sleep" when no messages are being processed
 * - Only billed for actual message processing time
 * - 95%+ cost reduction for idle connections
 *
 * ## How Hibernation Works
 *
 * 1. Use ctx.acceptWebSocket() instead of server.accept()
 * 2. Store connection state in serializeAttachment()
 * 3. Cloudflare maintains WebSocket while DO is evicted
 * 4. On message, DO wakes up and state is restored from deserializeAttachment()
 *
 * ## State Preservation
 *
 * WebSocket attachments are serialized to JSON, so:
 * - Use primitive types and arrays (not Set/Map)
 * - Keep attachments < 2048 bytes
 * - Restore in-memory state in webSocketMessage handler
 *
 * ## Reconnection Protocol
 *
 * This module integrates with the reconnection protocol for session resumption:
 * 1. On connect, server sends session.init with sessionId and sequence
 * 2. Client tracks lastSeq from received messages
 * 3. On disconnect, client reconnects with session.resume message
 * 4. Server validates session and replays missed events
 * 5. If session expired, server starts fresh with session.expired
 *
 * @module @dotdo/do/hibernation
 * @see https://developers.cloudflare.com/durable-objects/api/websockets/
 * @see {@link SessionManager} for reconnection session management
 */

import { createLogger } from '@dotdo/utils'
import {
  SessionManager,
  type SessionState,
  type BufferedEvent,
  type ReconnectionConfig,
  type SessionResumeMessage,
  type SessionInitMessage,
  type SessionResumedMessage,
  type SessionExpiredMessage,
  type EventMessage,
  parseProtocolMessage,
  isProtocolMessage,
  RECONNECTION_PROTOCOL_VERSION,
} from './websocket-reconnection'

const logger = createLogger('[Hibernation]')

// ============================================================================
// Types
// ============================================================================

/**
 * Attachment data stored with hibernating WebSocket connection.
 *
 * IMPORTANT: Must use JSON-serializable types only.
 * Set<T> and Map<K,V> serialize incorrectly - use arrays instead.
 *
 * Keep total size under 2048 bytes.
 */
export interface HibernationAttachment {
  /** Unique connection identifier */
  connectionId: string

  /** Client identifier for reconnection tracking */
  clientId?: string | undefined

  /** Connection timestamp */
  connectedAt: number

  /** Last activity timestamp */
  lastActivityAt: number

  /** Tags associated with this connection (use array, not Set) */
  tags: string[]

  /** Protocol version for compatibility */
  protocolVersion?: number | undefined

  /** Application-specific metadata (keep small) */
  metadata?: Record<string, unknown> | undefined
}

/**
 * State that can be persisted to DO storage for hibernation recovery.
 * This is for data that needs to survive DO eviction between messages.
 */
export interface HibernationState {
  /** Buffer of pending items if applicable */
  pendingItems?: unknown[]

  /** Last processed sequence numbers by source */
  lastSequences?: Record<string, number>

  /** Statistics counters */
  stats?: {
    messagesReceived: number
    messagesSent: number
    lastFlushTime?: number
    hibernationCount: number
  }

  /** Custom application state */
  custom?: Record<string, unknown>
}

/**
 * Configuration for hibernation behavior
 */
export interface HibernationConfig {
  /** Whether to enable auto-response for ping/pong (handled without waking DO) */
  enableAutoResponse?: boolean

  /** Ping message pattern for auto-response */
  pingMessage?: string

  /** Pong response for auto-response */
  pongResponse?: string

  /** Whether to persist state to storage on each message */
  persistStateOnMessage?: boolean

  /** Key used for storing hibernation state */
  stateStorageKey?: string

  /** Maximum attachment size in bytes (default: 2048) */
  maxAttachmentSize?: number
}

/**
 * Default hibernation configuration
 */
export const DEFAULT_HIBERNATION_CONFIG: Required<HibernationConfig> = {
  enableAutoResponse: true,
  pingMessage: 'ping',
  pongResponse: 'pong',
  persistStateOnMessage: false,
  stateStorageKey: 'hibernation_state',
  maxAttachmentSize: 2048,
}

// Re-export reconnection protocol types for convenience
export {
  SessionManager,
  type SessionState,
  type BufferedEvent,
  type ReconnectionConfig,
  type SessionResumeMessage,
  type SessionInitMessage,
  type SessionResumedMessage,
  type SessionExpiredMessage,
  type EventMessage,
  parseProtocolMessage,
  isProtocolMessage,
  RECONNECTION_PROTOCOL_VERSION,
} from './websocket-reconnection'

// Also re-export client-side helpers
export {
  type ClientReconnectionState,
  type BackoffConfig,
  createClientState,
  handleSessionInit,
  handleSessionResumed,
  handleSessionExpired,
  handleEvent,
  handleDisconnect,
  createResumeMessage,
  shouldAttemptResume,
  getNextRetryDelay,
  calculateBackoffDelay,
  shouldRetry,
  DEFAULT_BACKOFF_CONFIG,
} from './websocket-reconnection'

// ============================================================================
// Hibernation Manager
// ============================================================================

/**
 * Manages WebSocket connections with hibernation support.
 *
 * This class provides methods for:
 * - Accepting WebSocket connections with hibernation
 * - Serializing/deserializing attachment data
 * - Persisting state to DO storage
 * - Restoring connections after hibernation wake-up
 * - **Reconnection Protocol**: Session resumption after disconnect
 *
 * ## Reconnection Protocol Integration
 *
 * The HibernationManager now includes built-in reconnection protocol support:
 *
 * ```typescript
 * class MyDO extends DO {
 *   private hibernationManager: HibernationManager
 *
 *   constructor(state: DurableObjectState, env: DOEnv) {
 *     super(state, env)
 *     this.hibernationManager = new HibernationManager(state, {
 *       reconnection: {
 *         maxEventBuffer: 1000,
 *         sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
 *       }
 *     })
 *
 *     // Restore connections and sessions on wake
 *     state.blockConcurrencyWhile(async () => {
 *       await this.hibernationManager.restoreFromHibernation()
 *     })
 *   }
 *
 *   async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
 *     // Handle reconnection protocol messages automatically
 *     const handled = await this.hibernationManager.handleProtocolMessage(ws, message)
 *     if (handled) return
 *
 *     // Process regular messages...
 *   }
 *
 *   // Emit events with automatic sequence tracking
 *   emitEvent(type: string, payload: unknown) {
 *     this.hibernationManager.broadcastEvent(type, payload)
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * class MyDO extends DO {
 *   private hibernationManager: HibernationManager
 *
 *   constructor(state: DurableObjectState, env: DOEnv) {
 *     super(state, env)
 *     this.hibernationManager = new HibernationManager(state)
 *
 *     // Restore connections on wake
 *     state.blockConcurrencyWhile(async () => {
 *       await this.hibernationManager.restoreFromHibernation()
 *     })
 *   }
 *
 *   async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
 *     const attachment = this.hibernationManager.getAttachment(ws)
 *     // Process message...
 *     this.hibernationManager.updateActivity(ws)
 *   }
 * }
 * ```
 */
export class HibernationManager {
  private ctx: DurableObjectState
  private config: Required<HibernationConfig>
  private connectionCounter = 0
  private state: HibernationState = {}
  private sessionManager: SessionManager | null = null
  private reconnectionConfig?: Partial<ReconnectionConfig> | undefined

  constructor(
    ctx: DurableObjectState,
    config: Partial<HibernationConfig> = {},
    reconnectionConfig?: Partial<ReconnectionConfig>
  ) {
    this.ctx = ctx
    this.config = { ...DEFAULT_HIBERNATION_CONFIG, ...config }
    this.reconnectionConfig = reconnectionConfig

    // Initialize session manager for reconnection support
    if (reconnectionConfig !== undefined || config) {
      this.sessionManager = new SessionManager(ctx, reconnectionConfig)
    }

    // Setup auto-response for ping/pong if enabled
    if (this.config.enableAutoResponse) {
      this.setupAutoResponse()
    }
  }

  /**
   * Get the session manager for advanced session management.
   * Returns null if reconnection support is not enabled.
   */
  getSessionManager(): SessionManager | null {
    return this.sessionManager
  }

  /**
   * Enable reconnection support if not already enabled.
   *
   * @param config - Optional reconnection configuration
   */
  enableReconnection(config?: Partial<ReconnectionConfig>): void {
    if (!this.sessionManager) {
      this.reconnectionConfig = config
      this.sessionManager = new SessionManager(this.ctx, config)
    }
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Accept a WebSocket connection with hibernation support.
   *
   * Uses ctx.acceptWebSocket() which enables the DO to be evicted
   * while the connection stays open.
   *
   * @param serverSocket - The server-side WebSocket from WebSocketPair
   * @param options - Connection options
   * @returns The hibernation attachment for this connection
   */
  acceptWebSocket(
    serverSocket: WebSocket,
    options: {
      clientId?: string
      tags?: string[]
      protocolVersion?: number
      metadata?: Record<string, unknown>
    } = {}
  ): HibernationAttachment {
    const now = Date.now()
    const connectionId = this.generateConnectionId()

    const attachment: HibernationAttachment = {
      connectionId,
      clientId: options.clientId,
      connectedAt: now,
      lastActivityAt: now,
      tags: options.tags ?? [],
      protocolVersion: options.protocolVersion,
      metadata: options.metadata,
    }

    // Validate attachment size
    const attachmentJson = JSON.stringify(attachment)
    if (attachmentJson.length > this.config.maxAttachmentSize) {
      logger.warn('Attachment exceeds max size, truncating metadata', {
        size: attachmentJson.length,
        max: this.config.maxAttachmentSize,
      })
      attachment.metadata = undefined
    }

    // Accept with hibernation support
    // Tags are passed to ctx.acceptWebSocket for filtering with getWebSockets(tag)
    const allTags = ['hibernatable', ...attachment.tags]
    if (options.clientId) {
      allTags.push(`client:${options.clientId}`)
    }
    this.ctx.acceptWebSocket(serverSocket, allTags)

    // Store attachment for hibernation persistence
    serverSocket.serializeAttachment(attachment)

    return attachment
  }

  /**
   * Create a WebSocket upgrade response with hibernation support.
   *
   * @param options - Connection options
   * @returns Response with 101 status and WebSocket
   */
  handleUpgrade(options: {
    clientId?: string
    tags?: string[]
    protocolVersion?: number
    metadata?: Record<string, unknown>
  } = {}): Response {
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    this.acceptWebSocket(server, options)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  /**
   * Get attachment data from a WebSocket.
   *
   * Handles backwards compatibility with old attachment formats.
   *
   * @param ws - The WebSocket to get attachment from
   * @returns The attachment data or a default if not available
   */
  getAttachment(ws: WebSocket): HibernationAttachment {
    try {
      const raw = ws.deserializeAttachment() as unknown

      if (raw && typeof raw === 'object') {
        const attachment = raw as Partial<HibernationAttachment>

        // Handle backwards compatibility
        // Note: Old code may have stored tags as Set, which serializes incorrectly
        let tags: string[]
        if (Array.isArray(attachment.tags)) {
          tags = attachment.tags
        } else if (attachment.tags && typeof attachment.tags === 'object') {
          // Handle legacy Set serialization (will appear as object after JSON parse)
          const tagsAsAny = attachment.tags as unknown
          if (tagsAsAny instanceof Set) {
            tags = Array.from(tagsAsAny as Set<string>)
          } else {
            tags = []
          }
        } else {
          tags = []
        }

        return {
          connectionId: attachment.connectionId ?? this.generateConnectionId(),
          clientId: attachment.clientId,
          connectedAt: attachment.connectedAt ?? Date.now(),
          lastActivityAt: attachment.lastActivityAt ?? Date.now(),
          tags,
          protocolVersion: attachment.protocolVersion,
          metadata: attachment.metadata,
        }
      }
    } catch {
      // Attachment deserialization can fail - return default
    }

    return {
      connectionId: this.generateConnectionId(),
      connectedAt: Date.now(),
      lastActivityAt: Date.now(),
      tags: [],
    }
  }

  /**
   * Update the attachment for a WebSocket.
   *
   * @param ws - The WebSocket to update
   * @param updates - Partial attachment updates
   */
  updateAttachment(
    ws: WebSocket,
    updates: Partial<HibernationAttachment>
  ): void {
    const current = this.getAttachment(ws)
    const updated = { ...current, ...updates }
    ws.serializeAttachment(updated)
  }

  /**
   * Update last activity time for a WebSocket.
   *
   * @param ws - The WebSocket to update
   */
  updateActivity(ws: WebSocket): void {
    const attachment = this.getAttachment(ws)
    attachment.lastActivityAt = Date.now()
    ws.serializeAttachment(attachment)
  }

  // ===========================================================================
  // Hibernation Recovery
  // ===========================================================================

  /**
   * Restore state after hibernation wake-up.
   *
   * Call this in constructor via blockConcurrencyWhile to ensure
   * state is restored before processing any requests.
   *
   * @returns Array of restored connection attachments
   */
  async restoreFromHibernation(): Promise<HibernationAttachment[]> {
    const attachments: HibernationAttachment[] = []

    // Restore WebSocket connections from ctx.getWebSockets()
    const websockets = this.ctx.getWebSockets()
    for (const ws of websockets) {
      const attachment = this.getAttachment(ws)
      attachments.push(attachment)
    }

    // Restore persisted state if configured
    if (this.config.persistStateOnMessage) {
      const savedState = await this.ctx.storage.get<HibernationState>(
        this.config.stateStorageKey
      )
      if (savedState) {
        this.state = savedState
        if (this.state.stats) {
          this.state.stats.hibernationCount = (this.state.stats.hibernationCount ?? 0) + 1
        }
      }
    }

    logger.debug('Restored from hibernation', {
      connections: attachments.length,
      hasState: !!this.state.stats,
    })

    return attachments
  }

  /**
   * Save state to storage for hibernation persistence.
   *
   * Call this before operations that might cause the DO to be evicted.
   */
  async saveState(): Promise<void> {
    await this.ctx.storage.put(this.config.stateStorageKey, this.state)
  }

  /**
   * Get the current hibernation state.
   */
  getState(): HibernationState {
    return this.state
  }

  /**
   * Update hibernation state.
   *
   * @param updates - Partial state updates
   * @param persist - Whether to persist to storage immediately
   */
  async updateState(
    updates: Partial<HibernationState>,
    persist = false
  ): Promise<void> {
    this.state = { ...this.state, ...updates }
    if (persist) {
      await this.saveState()
    }
  }

  // ===========================================================================
  // Connection Utilities
  // ===========================================================================

  /**
   * Get all active WebSocket connections.
   *
   * @param tag - Optional tag to filter connections
   * @returns Array of WebSockets with their attachments
   */
  getConnections(tag?: string): Array<{ ws: WebSocket; attachment: HibernationAttachment }> {
    const websockets = tag ? this.ctx.getWebSockets(tag) : this.ctx.getWebSockets()
    return websockets.map(ws => ({
      ws,
      attachment: this.getAttachment(ws),
    }))
  }

  /**
   * Get connection count.
   *
   * @param tag - Optional tag to filter connections
   * @returns Number of active connections
   */
  getConnectionCount(tag?: string): number {
    return tag
      ? this.ctx.getWebSockets(tag).length
      : this.ctx.getWebSockets().length
  }

  /**
   * Get WebSocket by client ID.
   *
   * @param clientId - The client ID to find
   * @returns The WebSocket or undefined
   */
  getWebSocketByClientId(clientId: string): WebSocket | undefined {
    const websockets = this.ctx.getWebSockets(`client:${clientId}`)
    return websockets[0]
  }

  /**
   * Broadcast a message to all connections or those with a specific tag.
   *
   * @param message - Message to send (will be JSON-stringified)
   * @param tag - Optional tag to filter recipients
   * @returns Number of messages sent and failed
   */
  broadcast(message: unknown, tag?: string): { sent: number; failed: number } {
    const websockets = tag ? this.ctx.getWebSockets(tag) : this.ctx.getWebSockets()
    let sent = 0
    let failed = 0

    const payload = JSON.stringify(message)
    for (const ws of websockets) {
      try {
        ws.send(payload)
        sent++
      } catch (error) {
        failed++
        logger.warn('Broadcast failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return { sent, failed }
  }

  /**
   * Send a message to a specific WebSocket.
   *
   * @param ws - The WebSocket to send to
   * @param message - Message to send (will be JSON-stringified)
   * @returns true if sent, false on error
   */
  send(ws: WebSocket, message: unknown): boolean {
    try {
      ws.send(JSON.stringify(message))
      return true
    } catch (error) {
      logger.warn('Send failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  /**
   * Close a WebSocket connection.
   *
   * @param ws - The WebSocket to close
   * @param code - Close code (default: 1000)
   * @param reason - Close reason
   */
  closeConnection(ws: WebSocket, code = 1000, reason?: string): void {
    try {
      ws.close(code, reason)
    } catch (error) {
      logger.warn('Close failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // ===========================================================================
  // Reconnection Protocol
  // ===========================================================================

  /**
   * Handle a new WebSocket connection with reconnection protocol support.
   *
   * This method creates a session for the connection and sends the initial
   * session.init message with session ID and sequence number.
   *
   * @param ws - The WebSocket connection
   * @param clientId - Optional client identifier for session tracking
   * @param metadata - Optional session metadata
   * @returns The created session state
   */
  handleNewConnection(
    ws: WebSocket,
    clientId?: string,
    metadata?: Record<string, unknown>
  ): SessionState | null {
    if (!this.sessionManager) {
      this.enableReconnection()
    }

    const session = this.sessionManager!.createSession(ws, clientId, metadata)
    const initMessage = this.sessionManager!.createInitMessage(session)

    // Send session.init message
    this.send(ws, initMessage)

    return session
  }

  /**
   * Handle an incoming WebSocket message with reconnection protocol support.
   *
   * This method checks if the message is a protocol message (session.resume,
   * heartbeat.ping, etc.) and handles it automatically. Returns true if the
   * message was a protocol message and was handled, false otherwise.
   *
   * @param ws - The WebSocket connection
   * @param message - The incoming message
   * @returns true if handled as protocol message, false if regular message
   */
  async handleProtocolMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<boolean> {
    if (!this.sessionManager) {
      return false
    }

    const parsed = parseProtocolMessage(message)
    if (!parsed || !isProtocolMessage(parsed)) {
      return false
    }

    // Handle different protocol message types
    switch (parsed.type) {
      case 'session.resume': {
        await this.handleSessionResume(ws, parsed as SessionResumeMessage)
        return true
      }

      case 'heartbeat.ping': {
        this.send(ws, {
          type: 'heartbeat.pong',
          timestamp: Date.now(),
          serverTime: Date.now(),
        })
        return true
      }

      case 'heartbeat.pong': {
        // Client responding to our ping - update activity
        const session = this.sessionManager.getSession(ws)
        if (session) {
          this.sessionManager.touchSession(ws)
        }
        return true
      }

      default:
        // Unknown protocol message - don't handle
        return false
    }
  }

  /**
   * Handle a session.resume message from a reconnecting client.
   *
   * @param ws - The new WebSocket connection
   * @param message - The session.resume message
   */
  private async handleSessionResume(
    ws: WebSocket,
    message: SessionResumeMessage
  ): Promise<void> {
    if (!this.sessionManager) {
      return
    }

    const result = await this.sessionManager.resumeSession(ws, message)

    if (result.success) {
      // Send session.resumed confirmation
      const resumedMessage = this.sessionManager.createResumedMessage(
        result.session,
        result.missedEvents.length
      )
      this.send(ws, resumedMessage)

      // Replay missed events
      for (const event of result.missedEvents) {
        const eventMessage: EventMessage = {
          type: 'event',
          seq: event.seq,
          eventType: event.eventType,
          payload: event.payload,
          timestamp: event.timestamp,
        }
        this.send(ws, eventMessage)
      }
    } else {
      // Send session.expired with new session info
      const expiredMessage = this.sessionManager.createExpiredMessage(
        result.newSession,
        result.reason
      )
      this.send(ws, expiredMessage)
    }
  }

  /**
   * Handle WebSocket close with reconnection support.
   *
   * Preserves the session state for potential reconnection.
   *
   * @param ws - The WebSocket that closed
   */
  handleClose(ws: WebSocket): void {
    if (this.sessionManager) {
      this.sessionManager.handleDisconnect(ws)
    }
  }

  /**
   * Broadcast an event with sequence tracking for reconnection replay.
   *
   * This method wraps the event in the protocol format with a sequence number
   * and buffers it for potential replay on client reconnection.
   *
   * @param eventType - The type of event
   * @param payload - The event payload
   * @param tag - Optional tag to filter recipients
   * @returns Number of messages sent and failed
   */
  broadcastEvent(
    eventType: string,
    payload: unknown,
    tag?: string
  ): { sent: number; failed: number } {
    const websockets = tag ? this.ctx.getWebSockets(tag) : this.ctx.getWebSockets()
    let sent = 0
    let failed = 0

    for (const ws of websockets) {
      try {
        if (this.sessionManager) {
          const session = this.sessionManager.getSession(ws)
          if (session) {
            const eventMessage = this.sessionManager.createEventMessage(
              session,
              eventType,
              payload
            )
            ws.send(JSON.stringify(eventMessage))
            sent++
            continue
          }
        }

        // Fallback to regular broadcast if no session
        ws.send(JSON.stringify({ type: eventType, data: payload }))
        sent++
      } catch (error) {
        failed++
        logger.warn('Broadcast event failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return { sent, failed }
  }

  /**
   * Send an event to a specific WebSocket with sequence tracking.
   *
   * @param ws - The WebSocket to send to
   * @param eventType - The type of event
   * @param payload - The event payload
   * @returns true if sent, false on error
   */
  sendEvent(ws: WebSocket, eventType: string, payload: unknown): boolean {
    try {
      if (this.sessionManager) {
        const session = this.sessionManager.getSession(ws)
        if (session) {
          const eventMessage = this.sessionManager.createEventMessage(
            session,
            eventType,
            payload
          )
          ws.send(JSON.stringify(eventMessage))
          return true
        }
      }

      // Fallback to regular send if no session
      ws.send(JSON.stringify({ type: eventType, data: payload }))
      return true
    } catch (error) {
      logger.warn('Send event failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  /**
   * Get session statistics for monitoring.
   */
  getSessionStats(): {
    activeSessions: number
    totalBufferedEvents: number
    oldestSessionAge: number
  } | null {
    if (!this.sessionManager) {
      return null
    }
    return this.sessionManager.getStats()
  }

  /**
   * Clean up expired sessions.
   * Call this periodically (e.g., in alarm handler) to free memory.
   *
   * @returns Number of sessions cleaned up
   */
  async cleanupExpiredSessions(): Promise<number> {
    if (!this.sessionManager) {
      return 0
    }
    return this.sessionManager.cleanupExpiredSessions()
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Generate a unique connection ID.
   */
  private generateConnectionId(): string {
    this.connectionCounter++
    return `conn_${Date.now().toString(36)}_${this.connectionCounter.toString(36)}`
  }

  /**
   * Setup auto-response for ping/pong.
   *
   * This allows Cloudflare to respond to ping messages without waking the DO.
   */
  private setupAutoResponse(): void {
    try {
      this.ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair(
          this.config.pingMessage,
          this.config.pongResponse
        )
      )
    } catch (error) {
      // setWebSocketAutoResponse may not be available in all environments
      logger.debug('Auto-response not available', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Estimate the cost savings from hibernation.
 *
 * Based on Cloudflare's pricing model:
 * - Without hibernation: Billed for full wall-clock duration
 * - With hibernation: Only billed when processing messages
 *
 * @param params - Parameters for cost calculation
 * @returns Estimated monthly costs and savings
 */
export function estimateHibernationSavings(params: {
  /** Average connections per hour */
  connectionsPerHour: number
  /** Average messages per connection per hour */
  messagesPerConnectionPerHour: number
  /** Average message processing time in ms */
  avgMessageProcessingMs: number
  /** Hours per day the service is active */
  activeHoursPerDay: number
}): {
  withoutHibernation: number
  withHibernation: number
  savingsPercent: number
  monthlySavings: number
} {
  const {
    connectionsPerHour,
    messagesPerConnectionPerHour,
    avgMessageProcessingMs,
    activeHoursPerDay,
  } = params

  // Cloudflare DO pricing (as of Jan 2026)
  const PRICE_PER_GB_SECOND = 0.0000125 // $12.50 per million GB-s
  const MEMORY_GB = 0.125 // 128 MB

  // Without hibernation: full wall-clock time
  const hoursPerMonth = activeHoursPerDay * 30
  const secondsWithoutHibernation = hoursPerMonth * 3600
  const gbSecondsWithout = secondsWithoutHibernation * MEMORY_GB
  const costWithout = gbSecondsWithout * PRICE_PER_GB_SECOND

  // With hibernation: only message processing time
  const messagesPerDay = connectionsPerHour * activeHoursPerDay * messagesPerConnectionPerHour
  const messagesPerMonth = messagesPerDay * 30
  const secondsWithHibernation = (messagesPerMonth * avgMessageProcessingMs) / 1000
  const gbSecondsWith = secondsWithHibernation * MEMORY_GB
  const costWith = gbSecondsWith * PRICE_PER_GB_SECOND

  const savingsPercent = costWithout > 0
    ? Math.round((1 - costWith / costWithout) * 100)
    : 0

  return {
    withoutHibernation: Math.round(costWithout * 100) / 100,
    withHibernation: Math.round(costWith * 100) / 100,
    savingsPercent,
    monthlySavings: Math.round((costWithout - costWith) * 100) / 100,
  }
}

/**
 * Check if an error is related to hibernation wake-up.
 *
 * @param error - The error to check
 * @returns true if the error is hibernation-related
 */
export function isHibernationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()
  return (
    message.includes('hibernation') ||
    message.includes('websocket not open') ||
    message.includes('connection closed')
  )
}

/**
 * Create a hibernation-safe JSON payload.
 *
 * Ensures the payload is JSON-serializable and within size limits.
 *
 * @param data - Data to serialize
 * @param maxSize - Maximum size in bytes (default: 2048)
 * @returns Serialized JSON string or undefined if too large
 */
export function createHibernationPayload(
  data: unknown,
  maxSize = 2048
): string | undefined {
  try {
    const json = JSON.stringify(data)
    if (json.length <= maxSize) {
      return json
    }
    logger.warn('Payload exceeds max size', {
      size: json.length,
      maxSize,
    })
    return undefined
  } catch (error) {
    logger.warn('Failed to serialize payload', {
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}
