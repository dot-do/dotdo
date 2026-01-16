/**
 * WebSocket Manager Module - WebSocket handling, broadcast, and connection management
 *
 * This module contains:
 * - WebSocket status constants
 * - WebSocket upgrade handling
 * - Connection tracking with tags
 * - Hibernatable WebSocket support
 * - Broadcast functionality
 */

import type { Context, Env } from 'hono'

// ============================================================================
// WebSocket Status Constants
// ============================================================================

export const WEBSOCKET_STATUS = {
  NORMAL_CLOSURE: 1000,
  GOING_AWAY: 1001,
} as const

// ============================================================================
// Types
// ============================================================================

export interface WebSocketManagerState {
  websocketTags: Map<WebSocket, string[]>
  hibernatableWebSockets: Set<WebSocket>
  lastWebSocketTags: string[]
  lastWebSocketHibernatable: boolean
}

// ============================================================================
// WebSocket Manager Class
// ============================================================================

/**
 * WebSocketManager handles WebSocket connections, upgrades, and broadcasts
 * This is a helper class that DOCore uses to manage WebSocket state
 */
export class WebSocketManager {
  private websocketTags = new Map<WebSocket, string[]>()
  private hibernatableWebSockets = new Set<WebSocket>()
  private lastWebSocketTags: string[] = []
  private lastWebSocketHibernatable = false

  /**
   * Check if a request is a valid WebSocket upgrade request
   */
  isWebSocketUpgradeRequest<E extends Env>(c: Context<E>): boolean {
    return c.req.header('Upgrade') === 'websocket'
  }

  /**
   * Handle WebSocket upgrade and connection setup
   * @param ctx The Durable Object context
   * @param tags Tags to attach to this WebSocket connection
   * @param hibernatable Whether this WebSocket supports hibernation
   * @returns Response with 101 status and WebSocket
   */
  handleWebSocketUpgrade(
    ctx: DurableObjectState,
    tags: string[],
    hibernatable: boolean
  ): Response {
    const [client, server] = Object.values(new WebSocketPair())

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

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
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
   * @param ctx The Durable Object context
   * @param tag The tag to filter WebSocket recipients
   * @param message The message to broadcast (will be JSON-stringified)
   * @returns Number of WebSockets the message was sent to
   */
  broadcast(ctx: DurableObjectState, tag: string, message: unknown): { sent: number; failed: number } {
    let sent = 0
    let failed = 0
    const sockets = ctx.getWebSockets(tag)

    for (const ws of sockets) {
      try {
        ws.send(JSON.stringify(message))
        sent++
      } catch (err) {
        failed++
        // Log failed send attempts for debugging - socket may be closed
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
  }

  /**
   * Check if a WebSocket is hibernatable
   */
  isHibernatable(ws: WebSocket): boolean {
    return this.hibernatableWebSockets.has(ws)
  }
}

