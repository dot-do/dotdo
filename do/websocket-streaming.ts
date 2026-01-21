/**
 * WebSocket Event Streaming
 *
 * Server-side support for WebSocket event subscriptions and streaming.
 * This module handles:
 * - Subscribe/unsubscribe messages from clients
 * - Tracking active subscriptions per WebSocket connection
 * - Pushing events to subscribed clients when events fire
 * - Integration with the $ context event system
 *
 * Protocol:
 * - Client sends: { type: 'subscribe', event: 'Customer.signup', subscriptionId: 'sub-123' }
 * - Server responds: { type: 'subscribed', subscriptionId: 'sub-123', event: 'Customer.signup' }
 * - When event fires, server sends: { type: 'event', event: 'Customer.signup', payload: {...}, $id: '...', $timestamp: ... }
 *
 * @module do/websocket-streaming
 */

import { createScopedLogger, LogLevel } from '@dotdo/utils'
import type { EventsStore, Event as DBEvent } from '@dotdo/db'
import type { WebSocketManager, ConnectionMetadata } from './websocket'

const logger = createScopedLogger({ level: LogLevel.INFO, prefix: '[WebSocketStreaming]' })

/**
 * Event subscription message from client to server
 */
export interface EventSubscriptionMessage {
  type: 'subscribe' | 'unsubscribe'
  /** Event pattern to subscribe to (e.g., 'Customer.signup', 'Order.*', '*.created') */
  event: string
  /** Unique subscription ID for tracking */
  subscriptionId: string
}

/**
 * Event push message from server to client
 */
export interface EventPushMessage {
  type: 'event'
  /** Event type (e.g., 'Customer.signup') */
  event: string
  /** Event payload */
  payload: unknown
  /** Unique event ID */
  $id: string
  /** Event timestamp */
  $timestamp: number
}

/**
 * Subscription acknowledgment from server to client
 */
export interface SubscriptionAckMessage {
  type: 'subscribed' | 'unsubscribed'
  /** Subscription ID being acknowledged */
  subscriptionId: string
  /** Event pattern that was subscribed/unsubscribed */
  event: string
  /** Error message if subscription failed */
  error?: { message: string; code?: string }
}

/**
 * Internal subscription tracking
 */
interface Subscription {
  subscriptionId: string
  event: string
  ws: WebSocket
  createdAt: number
}

/**
 * Type guard to check if a message is an event subscription message
 */
export function isEventSubscriptionMessage(msg: unknown): msg is EventSubscriptionMessage {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as Record<string, unknown>
  return (
    (m.type === 'subscribe' || m.type === 'unsubscribe') &&
    typeof m.event === 'string' &&
    typeof m.subscriptionId === 'string'
  )
}

/**
 * WebSocket Event Streaming Manager
 *
 * Manages event subscriptions for WebSocket clients and pushes events
 * to subscribed clients when events fire.
 *
 * @example
 * ```typescript
 * const streaming = new WebSocketEventStreaming(wsManager, events)
 *
 * // In webSocketMessage handler:
 * if (streaming.handleMessage(ws, message)) {
 *   // Message was handled as a subscription message
 *   return
 * }
 * // Otherwise, handle as regular message
 *
 * // To push an event to all subscribers:
 * streaming.pushEvent({
 *   $id: 'event-123',
 *   type: 'Customer.signup',
 *   payload: { email: 'user@example.com' },
 *   $timestamp: Date.now(),
 * })
 * ```
 */
export class WebSocketEventStreaming {
  /** All active subscriptions indexed by subscription ID */
  private subscriptions = new Map<string, Subscription>()

  /** WebSocket to subscriptions mapping for efficient cleanup */
  private connectionSubscriptions = new Map<WebSocket, Set<string>>()

  /** Event pattern to subscription IDs mapping for efficient event dispatch */
  private eventSubscriptions = new Map<string, Set<string>>()

  constructor(
    private readonly wsManager: WebSocketManager,
    private readonly events?: EventsStore
  ) {
    // Set up disconnect handler to clean up subscriptions
    this.wsManager.onDisconnect((ws) => {
      this.cleanupConnection(ws)
    })

    // Subscribe to events store to push events to WebSocket clients
    if (this.events) {
      this.events.subscribe((event) => {
        this.pushEvent(event)
      })
    }
  }

  /**
   * Handle an incoming WebSocket message, checking if it's a subscription message.
   *
   * @param ws - The WebSocket that sent the message
   * @param data - The message data (string or parsed object)
   * @returns true if the message was handled as a subscription message, false otherwise
   */
  handleMessage(ws: WebSocket, data: string | object): boolean {
    let msg: unknown = data

    // Parse if string
    if (typeof data === 'string') {
      try {
        msg = JSON.parse(data)
      } catch {
        return false
      }
    }

    // Check if it's a subscription message
    if (!isEventSubscriptionMessage(msg)) {
      return false
    }

    // Handle subscription/unsubscription
    if (msg.type === 'subscribe') {
      this.subscribe(ws, msg.event, msg.subscriptionId)
    } else {
      this.unsubscribe(msg.subscriptionId)
    }

    return true
  }

  /**
   * Subscribe a WebSocket client to an event pattern.
   *
   * @param ws - The WebSocket connection
   * @param event - Event pattern (e.g., 'Customer.signup', 'Order.*')
   * @param subscriptionId - Unique subscription ID
   */
  subscribe(ws: WebSocket, event: string, subscriptionId: string): void {
    // Validate event pattern
    if (!event || typeof event !== 'string') {
      this.sendAck(ws, 'subscribed', subscriptionId, event, {
        message: 'Invalid event pattern',
        code: 'INVALID_PATTERN',
      })
      return
    }

    // Check for duplicate subscription ID
    if (this.subscriptions.has(subscriptionId)) {
      this.sendAck(ws, 'subscribed', subscriptionId, event, {
        message: 'Subscription ID already exists',
        code: 'DUPLICATE_ID',
      })
      return
    }

    // Create subscription
    const subscription: Subscription = {
      subscriptionId,
      event,
      ws,
      createdAt: Date.now(),
    }

    // Store subscription
    this.subscriptions.set(subscriptionId, subscription)

    // Track by connection
    let connSubs = this.connectionSubscriptions.get(ws)
    if (!connSubs) {
      connSubs = new Set()
      this.connectionSubscriptions.set(ws, connSubs)
    }
    connSubs.add(subscriptionId)

    // Track by event pattern
    let eventSubs = this.eventSubscriptions.get(event)
    if (!eventSubs) {
      eventSubs = new Set()
      this.eventSubscriptions.set(event, eventSubs)
    }
    eventSubs.add(subscriptionId)

    logger.debug(`Subscription created: ${subscriptionId} for event "${event}"`)

    // Send acknowledgment
    this.sendAck(ws, 'subscribed', subscriptionId, event)
  }

  /**
   * Unsubscribe from an event pattern.
   *
   * @param subscriptionId - The subscription ID to remove
   */
  unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      // Subscription doesn't exist, nothing to do
      return
    }

    const { ws, event } = subscription

    // Remove from subscriptions map
    this.subscriptions.delete(subscriptionId)

    // Remove from connection tracking
    const connSubs = this.connectionSubscriptions.get(ws)
    if (connSubs) {
      connSubs.delete(subscriptionId)
      if (connSubs.size === 0) {
        this.connectionSubscriptions.delete(ws)
      }
    }

    // Remove from event tracking
    const eventSubs = this.eventSubscriptions.get(event)
    if (eventSubs) {
      eventSubs.delete(subscriptionId)
      if (eventSubs.size === 0) {
        this.eventSubscriptions.delete(event)
      }
    }

    logger.debug(`Subscription removed: ${subscriptionId}`)

    // Send acknowledgment
    this.sendAck(ws, 'unsubscribed', subscriptionId, event)
  }

  /**
   * Clean up all subscriptions for a disconnected WebSocket.
   *
   * @param ws - The WebSocket that disconnected
   */
  cleanupConnection(ws: WebSocket): void {
    const connSubs = this.connectionSubscriptions.get(ws)
    if (!connSubs) {
      return
    }

    // Remove all subscriptions for this connection
    for (const subscriptionId of connSubs) {
      const subscription = this.subscriptions.get(subscriptionId)
      if (subscription) {
        this.subscriptions.delete(subscriptionId)

        // Remove from event tracking
        const eventSubs = this.eventSubscriptions.get(subscription.event)
        if (eventSubs) {
          eventSubs.delete(subscriptionId)
          if (eventSubs.size === 0) {
            this.eventSubscriptions.delete(subscription.event)
          }
        }
      }
    }

    // Remove connection tracking
    this.connectionSubscriptions.delete(ws)

    logger.debug(`Cleaned up ${connSubs.size} subscriptions for disconnected WebSocket`)
  }

  /**
   * Push an event to all subscribed WebSocket clients.
   *
   * This method is called when an event is emitted in the $ context.
   * It finds all matching subscriptions and sends the event to those clients.
   *
   * @param event - The event to push
   */
  pushEvent(event: DBEvent): void {
    const eventType = event.type
    const matchingSubscriptions = this.findMatchingSubscriptions(eventType)

    if (matchingSubscriptions.length === 0) {
      return
    }

    const message: EventPushMessage = {
      type: 'event',
      event: eventType,
      payload: event.payload,
      $id: event.$id,
      $timestamp: event.$timestamp,
    }

    const messageStr = JSON.stringify(message)

    for (const subscription of matchingSubscriptions) {
      try {
        subscription.ws.send(messageStr)
      } catch (err) {
        logger.warn(`Failed to push event to subscription ${subscription.subscriptionId}:`, err)
      }
    }

    logger.debug(`Pushed event "${eventType}" to ${matchingSubscriptions.length} subscribers`)
  }

  /**
   * Find all subscriptions that match an event type.
   *
   * Supports:
   * - Exact match: 'Customer.signup' matches 'Customer.signup'
   * - Noun wildcard: 'Customer.*' matches 'Customer.signup', 'Customer.updated'
   * - Verb wildcard: '*.signup' matches 'Customer.signup', 'User.signup'
   * - Global wildcard: '*.*' matches all events
   *
   * @param eventType - The event type to match
   * @returns Array of matching subscriptions
   */
  private findMatchingSubscriptions(eventType: string): Subscription[] {
    const [noun, verb] = eventType.split('.')
    const matching: Subscription[] = []

    // Check exact match
    const exactSubs = this.eventSubscriptions.get(eventType)
    if (exactSubs) {
      for (const id of exactSubs) {
        const sub = this.subscriptions.get(id)
        if (sub) matching.push(sub)
      }
    }

    // Check noun wildcard (Customer.*)
    if (noun && verb) {
      const nounWildSubs = this.eventSubscriptions.get(`${noun}.*`)
      if (nounWildSubs) {
        for (const id of nounWildSubs) {
          const sub = this.subscriptions.get(id)
          if (sub) matching.push(sub)
        }
      }

      // Check verb wildcard (*.signup)
      const verbWildSubs = this.eventSubscriptions.get(`*.${verb}`)
      if (verbWildSubs) {
        for (const id of verbWildSubs) {
          const sub = this.subscriptions.get(id)
          if (sub) matching.push(sub)
        }
      }
    }

    // Check global wildcard (*.*)
    const globalSubs = this.eventSubscriptions.get('*.*')
    if (globalSubs) {
      for (const id of globalSubs) {
        const sub = this.subscriptions.get(id)
        if (sub) matching.push(sub)
      }
    }

    return matching
  }

  /**
   * Send a subscription acknowledgment to a WebSocket client.
   */
  private sendAck(
    ws: WebSocket,
    type: 'subscribed' | 'unsubscribed',
    subscriptionId: string,
    event: string,
    error?: { message: string; code?: string }
  ): void {
    const ack: SubscriptionAckMessage = {
      type,
      subscriptionId,
      event,
      ...(error && { error }),
    }

    try {
      ws.send(JSON.stringify(ack))
    } catch (err) {
      logger.warn(`Failed to send subscription ack:`, err)
    }
  }

  /**
   * Get all active subscriptions (for debugging/monitoring).
   */
  getSubscriptions(): Array<{ subscriptionId: string; event: string; createdAt: number }> {
    return Array.from(this.subscriptions.values()).map((sub) => ({
      subscriptionId: sub.subscriptionId,
      event: sub.event,
      createdAt: sub.createdAt,
    }))
  }

  /**
   * Get the number of active subscriptions.
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size
  }

  /**
   * Get the number of unique event patterns being subscribed to.
   */
  getEventPatternCount(): number {
    return this.eventSubscriptions.size
  }

  /**
   * Check if a specific event pattern has any subscribers.
   */
  hasSubscribers(eventPattern: string): boolean {
    const subs = this.eventSubscriptions.get(eventPattern)
    return subs !== undefined && subs.size > 0
  }
}

/**
 * Create a WebSocket event streaming manager.
 *
 * @param wsManager - The WebSocket manager instance
 * @param events - Optional events store to auto-subscribe for event pushing
 * @returns WebSocketEventStreaming instance
 */
export function createWebSocketEventStreaming(
  wsManager: WebSocketManager,
  events?: EventsStore
): WebSocketEventStreaming {
  return new WebSocketEventStreaming(wsManager, events)
}
