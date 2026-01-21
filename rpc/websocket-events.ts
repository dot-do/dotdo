/**
 * WebSocket Event Server - Server-side support for event subscriptions
 *
 * Handles WebSocket connections from clients and broadcasts events to subscribed clients.
 * Integrates with the $.on event system to enable remote event subscriptions.
 *
 * Protocol:
 * - Client sends: { type: 'subscribe', event: 'Customer.signup', subscriptionId: 'xxx' }
 * - Server sends: { type: 'subscribed', subscriptionId: 'xxx', event: 'Customer.signup' }
 * - Server broadcasts: { type: 'event', event: 'Customer.signup', payload: {...}, $id: 'xxx', $timestamp: 123 }
 *
 * @module rpc/websocket-events
 * @see do-9zknf
 */

import { generateCorrelationId } from './headers'
import type {
  EventSubscriptionMessage,
  EventPushMessage,
  SubscriptionAckMessage,
} from './transport/websocket'

/**
 * Client subscription tracking
 */
interface ClientSubscription {
  /** The event pattern this subscription matches */
  eventPattern: string
  /** Unique subscription ID */
  subscriptionId: string
}

/**
 * WebSocket client with subscription tracking
 */
interface TrackedWebSocket {
  /** The actual WebSocket connection */
  ws: WebSocket
  /** Active subscriptions for this client */
  subscriptions: Map<string, ClientSubscription>
  /** Client ID for logging */
  clientId: string
}

/**
 * Options for the WebSocket event server
 */
export interface WebSocketEventServerOptions {
  /** Called when a client subscribes to an event pattern */
  onSubscribe?: (clientId: string, eventPattern: string) => void | Promise<void>
  /** Called when a client unsubscribes from an event pattern */
  onUnsubscribe?: (clientId: string, eventPattern: string) => void | Promise<void>
  /** Called when a client connects */
  onClientConnect?: (clientId: string) => void | Promise<void>
  /** Called when a client disconnects */
  onClientDisconnect?: (clientId: string) => void | Promise<void>
}

/**
 * WebSocket Event Server - manages client subscriptions and broadcasts events
 *
 * This class provides server-side support for the WebSocket event streaming protocol.
 * It tracks client subscriptions and provides methods to broadcast events to
 * subscribed clients.
 *
 * @example
 * ```typescript
 * // Create the event server
 * const eventServer = new WebSocketEventServer({
 *   onClientConnect: (clientId) => console.log(`Client connected: ${clientId}`),
 * })
 *
 * // Handle WebSocket connections in your DO
 * webSocketMessage(ws: WebSocket, message: string) {
 *   eventServer.handleMessage(ws, message)
 * }
 *
 * // Broadcast events when they occur
 * $.on.Customer.signup(async (event) => {
 *   eventServer.broadcast('Customer.signup', event.payload)
 * })
 * ```
 */
export class WebSocketEventServer {
  private clients = new Map<WebSocket, TrackedWebSocket>()
  private options: WebSocketEventServerOptions

  constructor(options: WebSocketEventServerOptions = {}) {
    this.options = options
  }

  /**
   * Register a new WebSocket client
   *
   * Call this when a new WebSocket connection is established.
   *
   * @param ws - The WebSocket connection
   * @returns The client ID assigned to this connection
   */
  registerClient(ws: WebSocket): string {
    const clientId = generateCorrelationId()
    this.clients.set(ws, {
      ws,
      subscriptions: new Map(),
      clientId,
    })

    // Notify callback
    if (this.options.onClientConnect) {
      Promise.resolve(this.options.onClientConnect(clientId)).catch(() => {
        // Ignore callback errors
      })
    }

    return clientId
  }

  /**
   * Unregister a WebSocket client
   *
   * Call this when a WebSocket connection is closed.
   *
   * @param ws - The WebSocket connection
   */
  unregisterClient(ws: WebSocket): void {
    const client = this.clients.get(ws)
    if (!client) {
      return
    }

    // Notify unsubscribe for each subscription
    if (this.options.onUnsubscribe) {
      for (const sub of client.subscriptions.values()) {
        Promise.resolve(this.options.onUnsubscribe(client.clientId, sub.eventPattern)).catch(() => {
          // Ignore callback errors
        })
      }
    }

    // Notify disconnect callback
    if (this.options.onClientDisconnect) {
      Promise.resolve(this.options.onClientDisconnect(client.clientId)).catch(() => {
        // Ignore callback errors
      })
    }

    this.clients.delete(ws)
  }

  /**
   * Handle an incoming WebSocket message
   *
   * Parses subscription/unsubscription requests and processes them.
   * Returns true if the message was handled, false if it should be processed
   * as a regular RPC message.
   *
   * @param ws - The WebSocket connection
   * @param message - The raw message string
   * @returns True if the message was handled as a subscription message
   */
  handleMessage(ws: WebSocket, message: string): boolean {
    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch {
      return false
    }

    // Check if this is a subscription message
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('type' in parsed) ||
      (parsed.type !== 'subscribe' && parsed.type !== 'unsubscribe')
    ) {
      return false
    }

    const subMessage = parsed as EventSubscriptionMessage

    if (subMessage.type === 'subscribe') {
      this.handleSubscribe(ws, subMessage)
    } else {
      this.handleUnsubscribe(ws, subMessage)
    }

    return true
  }

  /**
   * Handle a subscription request
   */
  private handleSubscribe(ws: WebSocket, message: EventSubscriptionMessage): void {
    let client = this.clients.get(ws)
    if (!client) {
      // Auto-register client if not already registered
      const clientId = this.registerClient(ws)
      client = this.clients.get(ws)!
    }

    // Add subscription
    client.subscriptions.set(message.subscriptionId, {
      eventPattern: message.event,
      subscriptionId: message.subscriptionId,
    })

    // Send acknowledgment
    const ack: SubscriptionAckMessage = {
      type: 'subscribed',
      subscriptionId: message.subscriptionId,
      event: message.event,
    }
    this.sendToClient(ws, ack)

    // Notify callback
    if (this.options.onSubscribe) {
      Promise.resolve(this.options.onSubscribe(client.clientId, message.event)).catch(() => {
        // Ignore callback errors
      })
    }
  }

  /**
   * Handle an unsubscription request
   */
  private handleUnsubscribe(ws: WebSocket, message: EventSubscriptionMessage): void {
    const client = this.clients.get(ws)
    if (!client) {
      return
    }

    const subscription = client.subscriptions.get(message.subscriptionId)
    if (!subscription) {
      // Send ack anyway for idempotency
      const ack: SubscriptionAckMessage = {
        type: 'unsubscribed',
        subscriptionId: message.subscriptionId,
        event: message.event,
      }
      this.sendToClient(ws, ack)
      return
    }

    // Remove subscription
    client.subscriptions.delete(message.subscriptionId)

    // Send acknowledgment
    const ack: SubscriptionAckMessage = {
      type: 'unsubscribed',
      subscriptionId: message.subscriptionId,
      event: subscription.eventPattern,
    }
    this.sendToClient(ws, ack)

    // Notify callback
    if (this.options.onUnsubscribe) {
      Promise.resolve(this.options.onUnsubscribe(client.clientId, subscription.eventPattern)).catch(() => {
        // Ignore callback errors
      })
    }
  }

  /**
   * Broadcast an event to all subscribed clients
   *
   * Sends the event to all clients that have a matching subscription pattern.
   * Supports exact matches and wildcards (* for noun or verb).
   *
   * @param eventType - The event type (e.g., 'Customer.signup')
   * @param payload - The event payload
   * @param eventId - Optional event ID (generated if not provided)
   * @returns The number of clients the event was sent to
   *
   * @example
   * ```typescript
   * // Broadcast to all clients subscribed to 'Customer.signup', 'Customer.*', '*.signup', or '*.*'
   * const count = eventServer.broadcast('Customer.signup', { email: 'user@example.com' })
   * console.log(`Event sent to ${count} clients`)
   * ```
   */
  broadcast(eventType: string, payload: unknown, eventId?: string): number {
    const message: EventPushMessage = {
      type: 'event',
      event: eventType,
      payload,
      $id: eventId ?? generateCorrelationId(),
      $timestamp: Date.now(),
    }

    let sentCount = 0
    const [noun, verb] = eventType.split('.')

    for (const client of this.clients.values()) {
      let shouldSend = false

      // Check if any subscription matches
      for (const sub of client.subscriptions.values()) {
        if (this.matchesPattern(eventType, noun, verb, sub.eventPattern)) {
          shouldSend = true
          break
        }
      }

      if (shouldSend) {
        this.sendToClient(client.ws, message)
        sentCount++
      }
    }

    return sentCount
  }

  /**
   * Check if an event type matches a subscription pattern
   */
  private matchesPattern(
    eventType: string,
    noun: string | undefined,
    verb: string | undefined,
    pattern: string
  ): boolean {
    // Exact match
    if (pattern === eventType) {
      return true
    }

    // Global wildcard
    if (pattern === '*.*') {
      return true
    }

    if (noun && verb) {
      // Noun wildcard (e.g., 'Customer.*' matches 'Customer.signup')
      if (pattern === `${noun}.*`) {
        return true
      }

      // Verb wildcard (e.g., '*.signup' matches 'Customer.signup')
      if (pattern === `*.${verb}`) {
        return true
      }
    }

    return false
  }

  /**
   * Send a message to a specific client
   */
  private sendToClient(ws: WebSocket, message: unknown): void {
    try {
      // Check if WebSocket is open (readyState 1 = OPEN)
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(message))
      }
    } catch {
      // Ignore send errors - client may have disconnected
    }
  }

  /**
   * Get the number of connected clients
   */
  getClientCount(): number {
    return this.clients.size
  }

  /**
   * Get all active subscriptions across all clients
   *
   * @returns Array of unique event patterns that have at least one subscriber
   */
  getActiveSubscriptions(): string[] {
    const patterns = new Set<string>()
    for (const client of this.clients.values()) {
      for (const sub of client.subscriptions.values()) {
        patterns.add(sub.eventPattern)
      }
    }
    return Array.from(patterns)
  }

  /**
   * Get subscription count for a specific event pattern
   *
   * @param eventPattern - The event pattern to check
   * @returns Number of subscriptions to this exact pattern
   */
  getSubscriptionCount(eventPattern: string): number {
    let count = 0
    for (const client of this.clients.values()) {
      for (const sub of client.subscriptions.values()) {
        if (sub.eventPattern === eventPattern) {
          count++
        }
      }
    }
    return count
  }

  /**
   * Check if there are any subscribers for an event type
   *
   * Takes into account wildcard subscriptions.
   *
   * @param eventType - The event type to check
   * @returns True if at least one client would receive this event
   */
  hasSubscribers(eventType: string): boolean {
    const [noun, verb] = eventType.split('.')

    for (const client of this.clients.values()) {
      for (const sub of client.subscriptions.values()) {
        if (this.matchesPattern(eventType, noun, verb, sub.eventPattern)) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Clear all clients and subscriptions
   *
   * Use this when shutting down the server.
   */
  clear(): void {
    this.clients.clear()
  }
}

/**
 * Create a WebSocket event server (convenience function)
 */
export function createWebSocketEventServer(
  options?: WebSocketEventServerOptions
): WebSocketEventServer {
  return new WebSocketEventServer(options)
}
