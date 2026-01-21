/**
 * WebSocket Mixin for Durable Objects
 *
 * Provides composable WebSocket functionality including:
 * - WebSocket connection handling and upgrades
 * - Message routing to handlers
 * - Broadcasting to multiple connections
 * - Connection state management
 * - Heartbeat/ping-pong support
 * - Connection lifecycle events
 * - **Hibernation support with reconnection protocol**
 *
 * ## Hibernation and Reconnection
 *
 * This mixin supports WebSocket hibernation with automatic reconnection:
 * - Sessions persist across hibernation periods
 * - Events are buffered for replay on reconnection
 * - Clients can resume sessions without losing data
 *
 * @example
 * ```typescript
 * // Basic WebSocket support
 * class MyDO extends WithWebSocket(BaseDO) {
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *
 *     this.ws.on('chat.message', async (ws, data) => {
 *       this.ws.broadcast(this.state, 'room:123', {
 *         type: 'chat.message',
 *         data
 *       })
 *     })
 *   }
 * }
 *
 * // With hibernation and reconnection support
 * class ChatDO extends WithHibernatingWebSocket(BaseDO, {
 *   reconnection: { maxEventBuffer: 1000 }
 * }) {
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *   }
 *
 *   emitChatMessage(message: string) {
 *     // Automatically includes sequence numbers for reconnection replay
 *     this.broadcastEvent('chat.message', { message })
 *   }
 * }
 * ```
 *
 * @module do/mixins/websocket
 */

import {
  WebSocketManager,
  type WebSocketMessage,
  type WebSocketHandler,
  type BroadcastResult,
  type ConnectionMetadata,
  type ConnectionHandler
} from '../websocket'
import {
  HibernationManager,
  type HibernationConfig,
  type HibernationAttachment,
  type ReconnectionConfig,
  type SessionState,
} from '../hibernation'
import type { Constructor } from './storage'
import { createLogger } from '@dotdo/utils'

const logger = createLogger('[WithWebSocket]')

// =============================================================================
// Types
// =============================================================================

/**
 * Interface for classes that have WebSocket capabilities
 */
export interface HasWebSocket {
  /** WebSocket manager instance */
  readonly ws: WebSocketManager
}

/**
 * Options for the WithWebSocket mixin
 */
export interface WithWebSocketOptions {
  /** Enable heartbeat monitoring */
  enableHeartbeat?: boolean
  /** Heartbeat interval in milliseconds (default: 30000) */
  heartbeatInterval?: number
  /** Connection timeout in milliseconds (default: 60000) */
  connectionTimeout?: number
}

/**
 * Options for the WithHibernatingWebSocket mixin
 */
export interface WithHibernatingWebSocketOptions {
  /** Hibernation configuration */
  hibernation?: Partial<HibernationConfig>
  /** Reconnection protocol configuration */
  reconnection?: Partial<ReconnectionConfig>
}

/**
 * Interface for classes that have hibernating WebSocket capabilities
 */
export interface HasHibernatingWebSocket {
  /** Hibernation manager instance */
  readonly hibernation: HibernationManager
}

/**
 * Base interface for DurableObjectState (minimal required interface)
 */
interface MinimalDOState {
  acceptWebSocket(ws: WebSocket, tags?: string[]): void
  getWebSockets(tag?: string): WebSocket[]
}

// =============================================================================
// Mixin Implementation
// =============================================================================

/**
 * WebSocket mixin that adds WebSocket connection management to a Durable Object.
 *
 * This mixin provides:
 * - `this.ws` - WebSocketManager for handling connections
 * - Automatic WebSocket upgrade handling
 * - Message routing to registered handlers
 * - Broadcasting to tagged connections
 * - Connection lifecycle management
 *
 * @template TBase - The base class constructor type
 * @param Base - The base class to extend
 * @param options - Optional configuration for WebSocket behavior
 * @returns A new class with WebSocket capabilities
 *
 * @example
 * ```typescript
 * // Basic usage
 * class ChatDO extends WithWebSocket(BaseDO) {
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *
 *     // Register message handlers
 *     this.ws.on('message', async (ws, data) => {
 *       console.log('Received:', data)
 *     })
 *
 *     // Handle connections
 *     this.ws.onConnect((ws, connectionId, metadata) => {
 *       console.log('Client connected:', connectionId)
 *     })
 *
 *     this.ws.onDisconnect((ws, connectionId, metadata) => {
 *       console.log('Client disconnected:', connectionId)
 *     })
 *   }
 *
 *   async handleWebSocketUpgrade(request: Request): Promise<Response> {
 *     const tags = ['room:general']
 *     return this.ws.handleWebSocketUpgrade(this.state, tags, true)
 *   }
 * }
 *
 * // Composing with other mixins
 * class FullFeatureDO extends WithWebSocket(WithStorage(BaseDO)) {
 *   // Has both WebSocket and storage capabilities
 * }
 * ```
 */
export function WithWebSocket<TBase extends Constructor>(
  Base: TBase,
  options: WithWebSocketOptions = {}
) {
  const {
    enableHeartbeat = false,
    heartbeatInterval = 30000,
    connectionTimeout = 60000
  } = options

  return class WebSocketMixin extends Base implements HasWebSocket {
    private _websocketManager: WebSocketManager
    private _heartbeatIntervalId: number | null = null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)
      this._websocketManager = new WebSocketManager()
    }

    /**
     * Access to the WebSocket manager
     *
     * @example
     * ```typescript
     * // Register message handlers
     * this.ws.on('chat.message', async (ws, data) => {
     *   // Handle message
     * })
     *
     * // Handle WebSocket upgrade
     * handleUpgrade(request: Request) {
     *   return this.ws.handleWebSocketUpgrade(this.state, ['room:123'], true)
     * }
     *
     * // Broadcast to connections
     * this.ws.broadcast(this.state, 'room:123', { type: 'update', data: ... })
     * ```
     */
    get ws(): WebSocketManager {
      return this._websocketManager
    }

    /**
     * Handle incoming WebSocket message.
     * Override in subclass for custom behavior, or let it route to handlers.
     *
     * @example
     * ```typescript
     * async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
     *   // Custom pre-processing
     *   console.log('Message received')
     *
     *   // Delegate to WebSocketManager for routing
     *   await this.ws.handleMessage(ws, message)
     * }
     * ```
     */
    async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
      await this._websocketManager.handleMessage(ws, message)
    }

    /**
     * Handle WebSocket close event.
     * Override in subclass for custom cleanup behavior.
     *
     * @example
     * ```typescript
     * async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
     *   // Custom cleanup
     *   console.log(`Connection closed: ${code} - ${reason}`)
     *
     *   // Let the manager clean up tracking
     *   this.ws.cleanupWebSocket(ws)
     * }
     * ```
     */
    async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
      this._websocketManager.cleanupWebSocket(ws)
    }

    /**
     * Handle WebSocket error event.
     * Override in subclass for custom error handling.
     */
    async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
      const errorMessage = error instanceof Error ? error.message : 'Unknown WebSocket error'
      logger.error('WebSocket error:', errorMessage, error)
      this._websocketManager.cleanupWebSocket(ws)
    }

    /**
     * Start heartbeat monitoring for all connections.
     * Call this in the constructor or after setup is complete.
     *
     * @param state - The DurableObjectState for accessing WebSockets
     *
     * @example
     * ```typescript
     * constructor(state: DurableObjectState, env: Env) {
     *   super(state, env)
     *
     *   // Start heartbeat monitoring
     *   this.startHeartbeat(state)
     * }
     * ```
     */
    protected startHeartbeat(state: MinimalDOState): void {
      if (enableHeartbeat && !this._heartbeatIntervalId) {
        this._heartbeatIntervalId = this._websocketManager.startHeartbeat(
          state as DurableObjectState,
          heartbeatInterval,
          connectionTimeout
        )
      }
    }

    /**
     * Stop heartbeat monitoring.
     * Call this when shutting down or if no longer needed.
     */
    protected stopHeartbeat(): void {
      if (this._heartbeatIntervalId !== null) {
        this._websocketManager.stopHeartbeat(this._heartbeatIntervalId)
        this._heartbeatIntervalId = null
      }
    }
  }
}

// =============================================================================
// Hibernating WebSocket Mixin
// =============================================================================

/**
 * Hibernating WebSocket mixin that adds WebSocket management with hibernation
 * and reconnection protocol support.
 *
 * This mixin provides:
 * - `this.hibernation` - HibernationManager for hibernation-aware WebSocket handling
 * - Automatic session creation and initialization
 * - Protocol message handling for reconnection
 * - Event broadcasting with sequence numbers for replay
 * - Session persistence across hibernation periods
 *
 * ## Reconnection Protocol
 *
 * The mixin implements a full reconnection protocol:
 *
 * 1. **On Connect**: Server sends `session.init` with sessionId and sequence
 * 2. **During Session**: Events include sequence numbers, buffered for replay
 * 3. **On Disconnect**: Session is preserved for potential reconnection
 * 4. **On Reconnect**: Client sends `session.resume` with last known sequence
 * 5. **On Resume**: Server replays missed events and resumes session
 *
 * @template TBase - The base class constructor type
 * @param Base - The base class to extend
 * @param options - Configuration for hibernation and reconnection
 * @returns A new class with hibernating WebSocket capabilities
 *
 * @example
 * ```typescript
 * class ChatDO extends WithHibernatingWebSocket(BaseDO, {
 *   reconnection: {
 *     maxEventBuffer: 1000,
 *     sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
 *   }
 * }) {
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *
 *     // Restore sessions on wake
 *     state.blockConcurrencyWhile(async () => {
 *       await this.hibernation.restoreFromHibernation()
 *     })
 *   }
 *
 *   // Custom route for WebSocket upgrade
 *   protected routes(app: Hono): void {
 *     app.get('/ws', (c) => {
 *       const clientId = c.req.query('clientId')
 *       return this.handleWebSocketUpgrade(clientId)
 *     })
 *   }
 *
 *   // Broadcast events with automatic sequence tracking
 *   sendChatMessage(message: string) {
 *     this.broadcastEvent('chat.message', { message })
 *   }
 * }
 * ```
 */
export function WithHibernatingWebSocket<TBase extends Constructor>(
  Base: TBase,
  options: WithHibernatingWebSocketOptions = {}
) {
  const { hibernation: hibernationConfig, reconnection: reconnectionConfig } = options

  return class HibernatingWebSocketMixin extends Base implements HasHibernatingWebSocket {
    private _hibernationManager!: HibernationManager
    private _hibernationState!: DurableObjectState
    private _hibernationInitialized = false

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)

      // Extract state from first argument (standard DO constructor signature)
      // DOs are constructed with (state, env) signature
      this._hibernationState = args[0] as DurableObjectState
    }

    /**
     * Initialize the hibernation manager lazily.
     * This is called automatically when accessing the hibernation property.
     */
    private initializeHibernation(): void {
      if (this._hibernationInitialized) return

      this._hibernationManager = new HibernationManager(
        this._hibernationState,
        hibernationConfig,
        reconnectionConfig
      )
      this._hibernationInitialized = true
    }

    /**
     * Access to the HibernationManager for hibernation-aware WebSocket handling.
     *
     * @example
     * ```typescript
     * // In constructor
     * state.blockConcurrencyWhile(async () => {
     *   await this.hibernation.restoreFromHibernation()
     * })
     *
     * // Handle upgrade
     * handleUpgrade(clientId?: string) {
     *   return this.hibernation.handleUpgrade({ clientId })
     * }
     *
     * // Broadcast with sequence tracking
     * this.hibernation.broadcastEvent('update', data)
     * ```
     */
    get hibernation(): HibernationManager {
      this.initializeHibernation()
      return this._hibernationManager
    }

    /**
     * Handle WebSocket upgrade with hibernation and reconnection support.
     *
     * Creates a new session and sends the session.init message to the client.
     *
     * @param clientId - Optional client identifier for session tracking
     * @param tags - Optional tags for connection filtering
     * @param metadata - Optional metadata to attach to the session
     * @returns Response with 101 status and WebSocket
     */
    protected handleWebSocketUpgrade(
      clientId?: string,
      tags?: string[],
      metadata?: Record<string, unknown>
    ): Response {
      this.initializeHibernation()

      // Create WebSocket pair
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]

      // Accept with hibernation support
      this._hibernationManager.acceptWebSocket(server, {
        ...(clientId !== undefined && { clientId }),
        ...(tags !== undefined && { tags }),
        ...(metadata !== undefined && { metadata }),
      })

      // Create session and send init message
      this._hibernationManager.handleNewConnection(server, clientId, metadata)

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    }

    /**
     * Handle incoming WebSocket message with reconnection protocol support.
     *
     * This method:
     * 1. Checks if the message is a protocol message (session.resume, heartbeat, etc.)
     * 2. If so, handles it automatically and returns
     * 3. If not, allows subclass to handle the message
     *
     * Override in subclass to add custom message handling:
     *
     * @example
     * ```typescript
     * async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
     *   // First, handle protocol messages
     *   const handled = await this.handleProtocolMessage(ws, message)
     *   if (handled) return
     *
     *   // Custom message handling
     *   const data = JSON.parse(message as string)
     *   if (data.type === 'chat') {
     *     this.broadcastEvent('chat.message', data.payload)
     *   }
     * }
     * ```
     */
    async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
      this.initializeHibernation()

      // Try to handle as protocol message
      const handled = await this._hibernationManager.handleProtocolMessage(ws, message)
      if (handled) return

      // Update session activity
      const session = this._hibernationManager.getSessionManager()?.getSession(ws)
      if (session) {
        this._hibernationManager.getSessionManager()?.touchSession(ws)
      }

      // Allow subclass to handle non-protocol messages
      // Subclasses should override this method and call super.webSocketMessage()
      // or use handleProtocolMessage() directly
    }

    /**
     * Handle protocol message (session.resume, heartbeat, etc.)
     *
     * Call this at the start of webSocketMessage to handle reconnection protocol.
     *
     * @param ws - The WebSocket connection
     * @param message - The incoming message
     * @returns true if handled as protocol message, false otherwise
     */
    protected async handleProtocolMessage(
      ws: WebSocket,
      message: string | ArrayBuffer
    ): Promise<boolean> {
      this.initializeHibernation()
      return this._hibernationManager.handleProtocolMessage(ws, message)
    }

    /**
     * Handle WebSocket close event with session preservation.
     *
     * The session is kept for potential reconnection within the timeout period.
     */
    async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
      this.initializeHibernation()
      this._hibernationManager.handleClose(ws)
    }

    /**
     * Handle WebSocket error event.
     */
    async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
      const errorMessage = error instanceof Error ? error.message : 'Unknown WebSocket error'
      logger.error('WebSocket error:', errorMessage, error)

      this.initializeHibernation()
      this._hibernationManager.handleClose(ws)
    }

    /**
     * Broadcast an event to all connections with sequence tracking.
     *
     * Events are automatically buffered for replay on client reconnection.
     *
     * @param eventType - The type of event
     * @param payload - The event payload
     * @param tag - Optional tag to filter recipients
     * @returns Number of messages sent and failed
     */
    protected broadcastEvent(
      eventType: string,
      payload: unknown,
      tag?: string
    ): { sent: number; failed: number } {
      this.initializeHibernation()
      return this._hibernationManager.broadcastEvent(eventType, payload, tag)
    }

    /**
     * Send an event to a specific WebSocket with sequence tracking.
     *
     * @param ws - The WebSocket to send to
     * @param eventType - The type of event
     * @param payload - The event payload
     * @returns true if sent, false on error
     */
    protected sendEvent(ws: WebSocket, eventType: string, payload: unknown): boolean {
      this.initializeHibernation()
      return this._hibernationManager.sendEvent(ws, eventType, payload)
    }

    /**
     * Restore sessions from hibernation.
     *
     * Call this in constructor via blockConcurrencyWhile:
     *
     * @example
     * ```typescript
     * constructor(state: DurableObjectState, env: Env) {
     *   super(state, env)
     *
     *   state.blockConcurrencyWhile(async () => {
     *     await this.restoreFromHibernation()
     *   })
     * }
     * ```
     */
    protected async restoreFromHibernation(): Promise<void> {
      this.initializeHibernation()
      await this._hibernationManager.restoreFromHibernation()
    }

    /**
     * Clean up expired sessions.
     *
     * Call this periodically (e.g., in alarm handler) to free memory.
     *
     * @returns Number of sessions cleaned up
     */
    protected async cleanupExpiredSessions(): Promise<number> {
      this.initializeHibernation()
      return this._hibernationManager.cleanupExpiredSessions()
    }

    /**
     * Get session statistics for monitoring.
     */
    protected getSessionStats(): {
      activeSessions: number
      totalBufferedEvents: number
      oldestSessionAge: number
    } | null {
      this.initializeHibernation()
      return this._hibernationManager.getSessionStats()
    }
  }
}

// =============================================================================
// Re-exports
// =============================================================================

export {
  WebSocketManager,
  type WebSocketMessage,
  type WebSocketHandler,
  type BroadcastResult,
  type ConnectionMetadata,
  type ConnectionHandler,
  // Hibernation types
  HibernationManager,
  type HibernationConfig,
  type HibernationAttachment,
  type ReconnectionConfig,
  type SessionState,
}
