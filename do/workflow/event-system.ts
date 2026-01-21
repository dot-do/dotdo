/**
 * EventSystem - Standalone event handling module
 *
 * A self-contained class that manages event handlers without direct DO dependencies.
 * This enables clean composition: DO uses EventSystem via composition, and
 * WorkflowContext ($) delegates to EventSystem for handler management.
 *
 * Features:
 * - Handler registration via $.on.Noun.verb pattern (via OnProxy)
 * - Wildcard support: $.on.*.created(), $.on.Customer.*(), $.on.*.*()
 * - Event emission with automatic handler matching
 * - Retry with exponential backoff for transient failures
 * - Event type introspection
 *
 * @module do/workflow/event-system
 */

import {
  createOnProxy,
  matchHandlers,
  invokeHandlers,
  getEventTypes,
  getHandlerCount,
  clearHandlers,
  clearAllHandlers,
  type EventHandler,
  type OnProxy,
  type RetryOptions,
  type InvokeHandlersResult,
} from './events'

/**
 * Event payload structure for emitting events
 */
export interface EventPayload {
  /** Event type in format "Noun.verb" */
  type: string
  /** Optional event data */
  data?: unknown
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Listener for event emissions (before handlers are invoked)
 */
export type EventEmitListener = (event: EventPayload) => void

/**
 * Options for EventSystem configuration
 */
export interface EventSystemOptions {
  /** Default retry options for handler invocation */
  defaultRetryOptions?: RetryOptions
}

/**
 * EventSystem - Standalone event handling module
 *
 * Encapsulates all event handler registration, matching, and invocation
 * logic in a single, reusable class with no DO dependencies.
 *
 * @example
 * ```ts
 * const eventSystem = new EventSystem()
 *
 * // Register handlers using the OnProxy
 * eventSystem.on.Customer.signup(async (event) => {
 *   console.log('Customer signed up:', event)
 * })
 *
 * eventSystem.on.Order.placed(async (event) => {
 *   console.log('Order placed:', event)
 * })
 *
 * // Wildcards
 * eventSystem.on['*'].created(async (event) => {
 *   console.log('Something was created:', event)
 * })
 *
 * // Emit events
 * await eventSystem.emit({ type: 'Customer.signup', data: { email: 'user@example.com' } })
 *
 * // Check registered events
 * console.log(eventSystem.getEventTypes()) // ['Customer.signup', 'Order.placed', '*.created']
 * ```
 */
export class EventSystem {
  /** Internal handler registry */
  private handlers: Map<string, EventHandler[]>

  /** The OnProxy for handler registration */
  public readonly on: OnProxy

  /** Default retry options */
  private defaultRetryOptions: RetryOptions

  /** Listeners for event emissions */
  private emitListeners: EventEmitListener[] = []

  /**
   * Create a new EventSystem instance
   *
   * @param options - Optional configuration
   */
  constructor(options: EventSystemOptions = {}) {
    this.handlers = new Map()
    this.on = createOnProxy(this.handlers)
    this.defaultRetryOptions = options.defaultRetryOptions ?? {
      maxRetries: 5,
      backoff: 'exponential',
      initialDelay: 100,
    }
  }

  /**
   * Emit an event and invoke all matching handlers
   *
   * @param event - Event to emit
   * @param retryOptions - Optional retry options (overrides defaults)
   * @returns Promise with handler invocation results
   *
   * @example
   * ```ts
   * const result = await eventSystem.emit({
   *   type: 'Order.placed',
   *   data: { orderId: '123', total: 99.99 }
   * })
   *
   * console.log(`${result.succeeded.length} handlers succeeded`)
   * console.log(`${result.failed.length} handlers failed`)
   * ```
   */
  async emit(
    event: EventPayload,
    retryOptions?: RetryOptions
  ): Promise<InvokeHandlersResult> {
    // Notify emit listeners
    for (const listener of this.emitListeners) {
      try {
        listener(event)
      } catch {
        // Listeners should not prevent event processing
      }
    }

    // Invoke handlers with retry logic
    return invokeHandlers(
      event.type,
      event,
      this.handlers,
      retryOptions ?? this.defaultRetryOptions
    )
  }

  /**
   * Register a listener that is called when any event is emitted
   * (before handlers are invoked)
   *
   * @param listener - Function to call on event emission
   * @returns Unsubscribe function
   */
  onEmit(listener: EventEmitListener): () => void {
    this.emitListeners.push(listener)
    return () => {
      const index = this.emitListeners.indexOf(listener)
      if (index >= 0) {
        this.emitListeners.splice(index, 1)
      }
    }
  }

  /**
   * Find all handlers that match a given event type
   *
   * Matches handlers in order of specificity:
   * 1. Exact match (Customer.signup)
   * 2. Noun wildcard (Customer.*)
   * 3. Verb wildcard (*.signup)
   * 4. Global wildcard (*.*)
   *
   * @param eventType - Event type in format "Noun.verb"
   * @returns Array of matching handlers
   */
  getMatchingHandlers(eventType: string): EventHandler[] {
    return matchHandlers(eventType, this.handlers)
  }

  /**
   * Get all registered event types
   *
   * @returns Array of event type strings
   */
  getEventTypes(): string[] {
    return getEventTypes(this.handlers)
  }

  /**
   * Get handler count for a specific event type
   *
   * @param eventType - Event type in format "Noun.verb"
   * @returns Number of handlers registered for this event type
   */
  getHandlerCount(eventType: string): number {
    return getHandlerCount(eventType, this.handlers)
  }

  /**
   * Get total handler count across all event types
   *
   * @returns Total number of registered handlers
   */
  getTotalHandlerCount(): number {
    let total = 0
    for (const handlers of this.handlers.values()) {
      total += handlers.length
    }
    return total
  }

  /**
   * Check if any handlers are registered for an event type
   *
   * @param eventType - Event type in format "Noun.verb"
   * @returns True if handlers are registered
   */
  hasHandlers(eventType: string): boolean {
    return this.getHandlerCount(eventType) > 0
  }

  /**
   * Check if any handlers would match an event type (including wildcards)
   *
   * @param eventType - Event type in format "Noun.verb"
   * @returns True if matching handlers exist
   */
  hasMatchingHandlers(eventType: string): boolean {
    return this.getMatchingHandlers(eventType).length > 0
  }

  /**
   * Clear all handlers for a specific event type
   *
   * @param eventType - Event type in format "Noun.verb"
   */
  clearHandlers(eventType: string): void {
    clearHandlers(eventType, this.handlers)
  }

  /**
   * Clear all registered handlers
   */
  clearAllHandlers(): void {
    clearAllHandlers(this.handlers)
  }

  /**
   * Get the internal handlers map (for advanced use cases)
   *
   * @returns The handlers Map
   */
  getHandlersMap(): Map<string, EventHandler[]> {
    return this.handlers
  }

  /**
   * Set default retry options
   *
   * @param options - Retry options to use by default
   */
  setDefaultRetryOptions(options: RetryOptions): void {
    this.defaultRetryOptions = options
  }

  /**
   * Get default retry options
   *
   * @returns Current default retry options
   */
  getDefaultRetryOptions(): RetryOptions {
    return { ...this.defaultRetryOptions }
  }
}

/**
 * Create a new EventSystem instance
 *
 * Factory function for creating EventSystem instances.
 *
 * @param options - Optional configuration
 * @returns New EventSystem instance
 */
export function createEventSystem(options?: EventSystemOptions): EventSystem {
  return new EventSystem(options)
}
