/**
 * DOCoreEvents - Event system module extracted from DOCore
 *
 * This module provides:
 * - Event emission (send) with fire-and-forget semantics
 * - Event subscription via OnProxy pattern (this.on.Noun.verb())
 * - Wildcard matching (*.created, Customer.*, *.*)
 * - Handler registration and unsubscription
 * - WebSocket event broadcasting
 *
 * The module is designed to be used as a delegate from DOCore, maintaining
 * backward compatibility while enabling clean separation of concerns.
 */

import { RpcTarget } from 'cloudflare:workers'
import type { WebSocketRpcHandler } from '../../rpc/websocket-rpc'
import type { IEvents, Event, EventHandler, OnProxy, Unsubscribe } from '../types/modules'

// Re-export types from modules.ts for backward compatibility
export type { Event, EventHandler, OnProxy, Unsubscribe } from '../types/modules'

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
// DOCoreEvents Class
// ============================================================================

/**
 * DOCoreEvents - RpcTarget-compatible event system module
 *
 * This class encapsulates all event-related functionality:
 * - Event emission via send()
 * - Handler registration via on proxy and subscribe()
 * - Handler removal via unsubscribe()
 * - Wildcard matching for event types
 * - WebSocket broadcast integration
 *
 * Implements: IEvents interface for type-safe delegation from DOCore
 *
 * @example
 * ```typescript
 * const events = new DOCoreEvents()
 *
 * // Register handler via OnProxy pattern
 * const unsub = events.on.Customer.signup((event) => console.log(event))
 *
 * // Register handler via subscribe method
 * events.subscribe('Order.created', (event) => console.log(event))
 *
 * // Emit event
 * const eventId = events.send('Customer.signup', { email: 'user@example.com' })
 *
 * // Unsubscribe
 * unsub()
 * events.unsubscribe('Order.created', handler)
 * ```
 */
export class DOCoreEvents extends RpcTarget implements IEvents {
  private eventHandlers: Map<string, EventHandler[]> = new Map()

  // Optional references for WebSocket broadcasting
  private rpcHandler?: WebSocketRpcHandler
  private ctx?: DurableObjectState

  constructor(rpcHandler?: WebSocketRpcHandler, ctx?: DurableObjectState) {
    super()
    this.rpcHandler = rpcHandler
    this.ctx = ctx
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  /**
   * Set the RPC handler and context for WebSocket broadcasting
   * Call this if the DOCoreEvents was created without these parameters
   */
  setWebSocketContext(rpcHandler: WebSocketRpcHandler, ctx: DurableObjectState): void {
    this.rpcHandler = rpcHandler
    this.ctx = ctx
  }

  // =========================================================================
  // Event Emission
  // =========================================================================

  /**
   * Fire-and-forget event emission
   * Dispatches event to all matching handlers and WebSocket subscribers
   * Returns immediately with event ID
   *
   * @param eventType The event type (e.g., "Customer.signup")
   * @param data Event payload data
   * @returns The generated event ID
   */
  send(eventType: string, data: unknown): string {
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
    if (this.rpcHandler && this.ctx) {
      this.rpcHandler.broadcastEvent(this.ctx, eventType, event)
    }

    return eventId
  }

  // =========================================================================
  // Handler Matching (Wildcard Support)
  // =========================================================================

  /**
   * Match handlers for an event type including wildcards
   *
   * Matching order:
   * 1. Exact match (Customer.signup)
   * 2. Wildcard noun (*.signup)
   * 3. Wildcard verb (Customer.*)
   * 4. Global wildcard (*.*)
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

  // =========================================================================
  // Handler Registration (OnProxy pattern)
  // =========================================================================

  /**
   * Event handler registration via callable proxy object
   * Usage: this.on.Noun.verb(handler) returns unsubscribe function
   *
   * For RPC compatibility, this returns an object with callable methods
   * for each Noun.verb combination
   *
   * @example
   * ```typescript
   * // Register handlers
   * events.on.Customer.signup(handler)
   * events.on['*'].created(handler)  // Wildcard noun
   * events.on.Customer['*'](handler) // Wildcard verb
   * events.on['*']['*'](handler)     // Global wildcard
   * ```
   */
  get on(): OnProxy {
    return createOnProxy(this.eventHandlers)
  }

  // =========================================================================
  // Handler Registration (Direct methods)
  // =========================================================================

  /**
   * Subscribe to an event type with a handler
   * Alternative to the OnProxy pattern for direct subscription
   *
   * @param eventType The event type to subscribe to (e.g., "Customer.signup", "*.created")
   * @param handler The handler function to call when the event occurs
   * @returns Unsubscribe function
   */
  subscribe(eventType: string, handler: EventHandler): () => void {
    const handlers = this.eventHandlers.get(eventType) ?? []
    handlers.push(handler)
    this.eventHandlers.set(eventType, handlers)

    return () => {
      this.unsubscribe(eventType, handler)
    }
  }

  /**
   * Unsubscribe a handler from an event type
   *
   * @param eventType The event type to unsubscribe from
   * @param handler The handler function to remove
   * @returns true if the handler was found and removed, false otherwise
   */
  unsubscribe(eventType: string, handler: EventHandler): boolean {
    const current = this.eventHandlers.get(eventType) ?? []
    const idx = current.indexOf(handler)
    if (idx >= 0) {
      current.splice(idx, 1)
      this.eventHandlers.set(eventType, current)
      return true
    }
    return false
  }

  // =========================================================================
  // Subscription Management
  // =========================================================================

  /**
   * Get all current subscriptions
   * Returns a map of event types to handler counts
   *
   * @returns Object mapping event types to number of handlers
   */
  getSubscriptions(): Record<string, number> {
    const subscriptions: Record<string, number> = {}
    for (const [eventType, handlers] of this.eventHandlers) {
      if (handlers.length > 0) {
        subscriptions[eventType] = handlers.length
      }
    }
    return subscriptions
  }

  /**
   * Get the count of handlers for a specific event type
   *
   * @param eventType The event type to check
   * @returns Number of registered handlers
   */
  getHandlerCount(eventType: string): number {
    return this.eventHandlers.get(eventType)?.length ?? 0
  }

  /**
   * Check if there are any handlers registered for an event type
   *
   * @param eventType The event type to check (supports wildcards)
   * @returns true if any handlers would match this event type
   */
  hasHandlers(eventType: string): boolean {
    return this.matchHandlers(eventType).length > 0
  }

  // =========================================================================
  // Cleanup and State Management
  // =========================================================================

  /**
   * Clear all event handlers
   * Use this for eviction simulation or cleanup
   */
  clearHandlers(): void {
    this.eventHandlers.clear()
  }

  /**
   * Get the raw event handlers map (for internal use and testing)
   *
   * @returns The internal Map of event handlers
   */
  getEventHandlersMap(): Map<string, EventHandler[]> {
    return this.eventHandlers
  }

  /**
   * Get total number of registered event types
   *
   * @returns Number of unique event types with handlers
   */
  getEventTypeCount(): number {
    let count = 0
    for (const handlers of this.eventHandlers.values()) {
      if (handlers.length > 0) count++
    }
    return count
  }

  /**
   * Get total number of registered handlers across all event types
   *
   * @returns Total handler count
   */
  getTotalHandlerCount(): number {
    let count = 0
    for (const handlers of this.eventHandlers.values()) {
      count += handlers.length
    }
    return count
  }

  // =========================================================================
  // IEvents Interface Methods
  // =========================================================================

  /**
   * Get the OnProxy object for ergonomic handler registration
   * Implements IEvents.getOnProxy() method
   *
   * @returns OnProxy object for chained handler registration
   */
  getOnProxy(): OnProxy {
    return this.on
  }

  /**
   * Get all handlers for a specific event pattern
   * Implements IEvents.getHandlers() method
   *
   * @param pattern Event pattern to query
   * @returns Array of handlers matching the pattern
   */
  getHandlers(pattern: string): EventHandler[] {
    return this.eventHandlers.get(pattern) ?? []
  }

  /**
   * Clear all event handlers
   * Implements IEvents.clearAllHandlers() method
   */
  clearAllHandlers(): void {
    this.clearHandlers()
  }
}
