/**
 * ObservabilityBroadcaster - WebSocket-based Durable Object for real-time observability
 *
 * Handles real-time observability event streaming with hibernation support:
 * - WebSocket upgrade endpoint for clients to connect
 * - Hibernation API (ctx.acceptWebSocket) for efficient connection management
 * - POST /broadcast endpoint for receiving events to broadcast
 * - Per-connection filter support (level, script, type, requestId, doName)
 * - Filter-based routing to only send relevant events to each client
 */

import { DurableObject } from 'cloudflare:workers'
import { ObservabilityEvent, ObsFilter, matchesFilter } from '../../types/observability'

/**
 * WebSocket attachment storing connection-specific filter
 */
interface WebSocketAttachment {
  filter: ObsFilter
}

/**
 * Message format for WebSocket communication
 */
interface WebSocketMessage {
  type: 'events' | 'filter'
  data?: ObservabilityEvent[]
  filter?: ObsFilter
}

export class ObservabilityBroadcaster extends DurableObject {
  /**
   * Handle incoming HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Check for WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader?.toLowerCase() === 'websocket') {
      return this.handleWebSocketUpgrade(request, url)
    }

    // Handle POST /broadcast
    if (request.method === 'POST' && url.pathname === '/broadcast') {
      return this.handleBroadcast(request)
    }

    // Unknown endpoint
    return new Response('Not Found', { status: 404 })
  }

  /**
   * Handle WebSocket upgrade request with hibernation API
   */
  private handleWebSocketUpgrade(request: Request, url: URL): Response {
    // Parse filter from query params
    const filter: ObsFilter = {}
    const level = url.searchParams.get('level')
    const script = url.searchParams.get('script')
    const type = url.searchParams.get('type')
    const requestId = url.searchParams.get('requestId')
    const doName = url.searchParams.get('doName')

    if (level) filter.level = level as ObsFilter['level']
    if (script) filter.script = script
    if (type) filter.type = type as ObsFilter['type']
    if (requestId) filter.requestId = requestId
    if (doName) filter.doName = doName

    // Create WebSocket pair
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // Build tags for the WebSocket (used for efficient lookups)
    const tags: string[] = ['obs']
    if (level) tags.push(`level:${level}`)
    if (script) tags.push(`script:${script}`)
    if (type) tags.push(`type:${type}`)
    if (requestId) tags.push(`requestId:${requestId}`)
    if (doName) tags.push(`doName:${doName}`)

    // Accept WebSocket with hibernation API
    this.ctx.acceptWebSocket(server!, tags)

    // Store filter in WebSocket attachment
    const attachment: WebSocketAttachment = { filter }
    ;(server as unknown as { attachment?: WebSocketAttachment }).attachment = attachment

    // Return 101 Switching Protocols with the client WebSocket
    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  /**
   * Handle POST /broadcast - receive and distribute events
   */
  private async handleBroadcast(request: Request): Promise<Response> {
    try {
      const events = (await request.json()) as ObservabilityEvent[]
      this.broadcast(events)
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  /**
   * Broadcast events to all connected WebSocket clients
   * Each client receives only events matching their filter
   */
  private broadcast(events: ObservabilityEvent[]): void {
    // Get all connected WebSockets
    const webSockets = this.ctx.getWebSockets()

    for (const ws of webSockets) {
      // Get filter from attachment
      const attachment = (ws as unknown as { attachment?: WebSocketAttachment }).attachment
      const filter = attachment?.filter ?? {}

      // Filter events for this connection
      const matchingEvents = events.filter((event) => matchesFilter(event, filter))

      // Only send if there are matching events
      if (matchingEvents.length > 0) {
        const message: WebSocketMessage = {
          type: 'events',
          data: matchingEvents,
        }
        ws.send(JSON.stringify(message))
      }
    }
  }

  /**
   * Handle incoming WebSocket messages (hibernation handler)
   * Supports filter update messages
   */
  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    try {
      const parsed = JSON.parse(message) as WebSocketMessage

      // Handle filter update
      if (parsed.type === 'filter' && parsed.filter) {
        const attachment = (ws as unknown as { attachment?: WebSocketAttachment }).attachment
        if (attachment) {
          attachment.filter = parsed.filter
        }
      }
      // Unknown message types are silently ignored
    } catch {
      // Invalid JSON is silently ignored
    }
  }

  /**
   * Handle WebSocket close (hibernation handler)
   * Cloudflare automatically removes closed WebSockets from getWebSockets()
   */
  async webSocketClose(
    _ws: WebSocket,
    _code?: number,
    _reason?: string,
    _wasClean?: boolean
  ): Promise<void> {
    // No additional cleanup needed - Cloudflare handles this automatically
  }
}

export default ObservabilityBroadcaster
