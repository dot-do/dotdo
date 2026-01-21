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
 *
 * @example
 * ```typescript
 * class MyDO extends WithWebSocket(BaseDO) {
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *
 *     // Register message handlers
 *     this.ws.on('chat.message', async (ws, data) => {
 *       // Broadcast to all clients with 'room:123' tag
 *       this.ws.broadcast(this.state, 'room:123', {
 *         type: 'chat.message',
 *         data
 *       })
 *     })
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
import type { Constructor } from './storage'
import { createScopedLogger, LogLevel } from '@dotdo/utils'
import { DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_CONNECTION_TIMEOUT_MS } from '@dotdo/utils'

const logger = createScopedLogger({ level: LogLevel.INFO, prefix: '[WithWebSocket]' })

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
  /** Heartbeat interval in milliseconds (default: DEFAULT_HEARTBEAT_INTERVAL_MS = 30000) */
  heartbeatInterval?: number
  /** Connection timeout in milliseconds (default: DEFAULT_CONNECTION_TIMEOUT_MS = 60000) */
  connectionTimeout?: number
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
): TBase & Constructor<HasWebSocket> {
  const {
    enableHeartbeat = false,
    heartbeatInterval = DEFAULT_HEARTBEAT_INTERVAL_MS,
    connectionTimeout = DEFAULT_CONNECTION_TIMEOUT_MS
  } = options

  return class WebSocketMixin extends Base implements HasWebSocket {
    private _websocketManager: WebSocketManager
    private _heartbeatIntervalId: number | null = null

    // Mixin constructors must use `any[]` to accept arbitrary base class constructor args (TS2545)
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
  } as TBase & Constructor<HasWebSocket>
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
  type ConnectionHandler
}
