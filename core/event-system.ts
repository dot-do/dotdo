/**
 * Event System Module - Event registration, dispatch, and handlers
 *
 * This module contains:
 * - Event types and interfaces
 * - Event handler types
 * - OnProxy type for event handler registration
 * - EventSystem class for managing events
 * - ID generation utilities
 */

import type { WebSocketRpcHandler } from '../rpc/websocket-rpc'

// ============================================================================
// Types
// ============================================================================

/**
 * Event structure for workflow context events
 */
export interface Event {
  id: string
  type: string
  subject: string
  object: string
  data: unknown
  timestamp: Date
}

/**
 * Handler function for events
 */
export type EventHandler = (event: Event) => void | Promise<void>

// OnProxy type for event handler registration
export type OnProxy = {
  [noun: string]: {
    [verb: string]: (handler: EventHandler) => () => void
  }
}

// ============================================================================
// ID Generation Utilities
// ============================================================================

/**
 * Generate a unique event ID
 */
export function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Generate a unique thing ID
 */
export function generateThingId(): string {
  return `thing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// ============================================================================
// OnProxy Factory
// ============================================================================

/**
 * Create the on proxy structure for event handler registration
 * Usage: this.on.Noun.verb(handler) returns unsubscribe function
 *
 * @param eventHandlers Map to store registered handlers
 * @returns OnProxy object for handler registration
 */
export function createOnProxy(eventHandlers: Map<string, EventHandler[]>): OnProxy {
  // Create an actual object structure instead of a Proxy for RPC compatibility
  // This uses a Proxy internally but returns actual callable functions
  return new Proxy({} as OnProxy, {
    get(_target, noun: string) {
      if (typeof noun !== 'string') return undefined
      return new Proxy({} as Record<string, (handler: EventHandler) => () => void>, {
        get(_t, verb: string) {
          if (typeof verb !== 'string') return undefined
          return (handler: EventHandler): (() => void) => {
            const key = `${noun}.${verb}`
            const handlers = eventHandlers.get(key) ?? []
            handlers.push(handler)
            eventHandlers.set(key, handlers)

            // Return unsubscribe function
            return () => {
              const current = eventHandlers.get(key) ?? []
              const idx = current.indexOf(handler)
              if (idx >= 0) {
                current.splice(idx, 1)
                eventHandlers.set(key, current)
              }
            }
          }
        },
      })
    },
  })
}

// ============================================================================
// Event System Class
// ============================================================================

/**
 * EventSystem handles event registration, dispatch, and handler management
 * This is a helper class that DOCore uses to manage the event system
 */
export class EventSystem {
  private eventHandlers: Map<string, EventHandler[]> = new Map()

  /**
   * Fire-and-forget event emission
   * Dispatches event to all matching handlers and WebSocket subscribers
   * Returns immediately with event ID
   *
   * @param eventType The event type (e.g., "Customer.signup")
   * @param data Event payload data
   * @param rpcHandler Optional RPC handler for WebSocket broadcast
   * @param ctx Optional Durable Object context for WebSocket broadcast
   * @returns The generated event ID
   */
  send(
    eventType: string,
    data: unknown,
    rpcHandler?: WebSocketRpcHandler,
    ctx?: DurableObjectState
  ): string {
    const eventId = generateEventId()
    const [subject, object] = eventType.split('.')

    const event: Event = {
      id: eventId,
      type: eventType,
      subject,
      object,
      data,
      timestamp: new Date(),
    }

    // Fire-and-forget dispatch to local handlers (don't await, don't throw)
    Promise.resolve().then(async () => {
      const handlers = this.matchHandlers(eventType)
      for (const handler of handlers) {
        try {
          await handler(event)
        } catch (err) {
          // Log but don't throw - fire-and-forget semantics
          console.error(`Handler error for ${eventType}:`, err)
        }
      }
    })

    // Broadcast to WebSocket subscribers (Cap'n Web style)
    if (rpcHandler && ctx) {
      rpcHandler.broadcastEvent(ctx, eventType, event)
    }

    return eventId
  }

  /**
   * Match handlers for an event type including wildcards
   */
  private matchHandlers(eventType: string): EventHandler[] {
    const [noun, verb] = eventType.split('.')
    const matched: EventHandler[] = []

    // Exact match
    const exactHandlers = this.eventHandlers.get(eventType) ?? []
    matched.push(...exactHandlers)

    // Wildcard noun match: *.verb
    const wildcardNounHandlers = this.eventHandlers.get(`*.${verb}`) ?? []
    matched.push(...wildcardNounHandlers)

    // Wildcard verb match: Noun.*
    const wildcardVerbHandlers = this.eventHandlers.get(`${noun}.*`) ?? []
    matched.push(...wildcardVerbHandlers)

    // Global wildcard: *.*
    const globalWildcardHandlers = this.eventHandlers.get('*.*') ?? []
    matched.push(...globalWildcardHandlers)

    return matched
  }

  /**
   * Get the OnProxy for event handler registration
   * Usage: eventSystem.on.Noun.verb(handler)
   */
  get on(): OnProxy {
    return createOnProxy(this.eventHandlers)
  }

  /**
   * Direct method for handler registration
   * Usage: eventSystem.registerHandler('Customer.signup', handler)
   */
  registerHandler(eventType: string, handler: EventHandler): () => void {
    const handlers = this.eventHandlers.get(eventType) ?? []
    handlers.push(handler)
    this.eventHandlers.set(eventType, handlers)

    return () => {
      const current = this.eventHandlers.get(eventType) ?? []
      const idx = current.indexOf(handler)
      if (idx >= 0) {
        current.splice(idx, 1)
        this.eventHandlers.set(eventType, current)
      }
    }
  }

  /**
   * Get the count of handlers for an event type
   */
  getHandlerCount(eventType: string): number {
    return this.eventHandlers.get(eventType)?.length ?? 0
  }

  /**
   * Clear all event handlers (for eviction simulation)
   */
  clearHandlers(): void {
    this.eventHandlers.clear()
  }

  /**
   * Get the raw event handlers map (for internal use)
   */
  getEventHandlersMap(): Map<string, EventHandler[]> {
    return this.eventHandlers
  }
}

// ============================================================================
// Type Declarations for Cloudflare
// ============================================================================

declare global {
  interface DurableObjectState {
    getWebSockets(tag?: string): WebSocket[]
  }
}
