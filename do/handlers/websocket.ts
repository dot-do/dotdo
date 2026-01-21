/**
 * WebSocket Handler
 *
 * Handles all WebSocket-related operations for a DO:
 * - Connection management
 * - Message routing
 * - Broadcasting
 * - Error handling
 *
 * @module do/handlers/websocket
 */

import { WebSocketManager } from '../websocket'
import { createLogger } from '../../utils/logger'
import type { DOHandler } from './registry'

const logger = createLogger('[WebSocketHandler]')

/**
 * Options for creating a WebSocketHandler
 */
export interface WebSocketHandlerOptions {
  /** Enable debug logging */
  debug?: boolean
}

/**
 * Handler for all WebSocket operations in a DO.
 *
 * Delegates to WebSocketManager for actual WebSocket handling.
 *
 * @example
 * ```typescript
 * const handler = new WebSocketHandler()
 *
 * // Handle message
 * await handler.handleMessage(ws, message)
 *
 * // Broadcast to all connections
 * handler.broadcast(state, 'room:123', { type: 'update', data: ... })
 * ```
 */
export class WebSocketHandler implements DOHandler {
  readonly name = 'websocket'
  private websocketManager: WebSocketManager
  private debug: boolean

  constructor(options: WebSocketHandlerOptions = {}) {
    this.websocketManager = new WebSocketManager()
    this.debug = options.debug ?? false
  }

  /**
   * Get the WebSocketManager instance.
   */
  getManager(): WebSocketManager {
    return this.websocketManager
  }

  /**
   * Handle incoming WebSocket message.
   * Routes to registered handlers.
   */
  async handleMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (this.debug) {
      logger.debug('Handling WebSocket message')
    }
    await this.websocketManager.handleMessage(ws, message)
  }

  /**
   * Handle WebSocket close event.
   * Cleans up WebSocket tracking.
   */
  handleClose(ws: WebSocket): void {
    if (this.debug) {
      logger.debug('Handling WebSocket close')
    }
    this.websocketManager.cleanupWebSocket(ws)
  }

  /**
   * Handle WebSocket error event.
   */
  handleError(ws: WebSocket, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : 'Unknown WebSocket error'
    logger.error('WebSocket error:', errorMessage, error)
    this.websocketManager.cleanupWebSocket(ws)
  }
}
