/**
 * Event emitter utilities for primitives
 *
 * Provides a type-safe event emitter with subscription management.
 *
 * @module @dotdo/primitives-core/events
 */

/**
 * Base type for event maps
 */
export interface EventMap {
  [event: string]: unknown
}

/**
 * Event handler function type
 */
export type EventHandler<T> = (payload: T) => void | Promise<void>

/**
 * Event subscription returned when subscribing to events
 */
export interface EventSubscription {
  /** Unique subscription ID */
  id: string
  /** Unsubscribe from the event */
  unsubscribe: () => void
}

/**
 * Internal handler entry with metadata
 */
interface HandlerEntry<T> {
  id: string
  handler: EventHandler<T>
  once: boolean
}

/**
 * Type-safe event emitter
 */
export class EventEmitter<T extends EventMap> {
  private handlers = new Map<keyof T, HandlerEntry<T[keyof T]>[]>()
  private idCounter = 0

  /**
   * Subscribe to an event
   *
   * @param event - Event name to subscribe to
   * @param handler - Handler function to call when event is emitted
   * @returns Subscription with id and unsubscribe function
   */
  on<K extends keyof T>(event: K, handler: EventHandler<T[K]>): EventSubscription {
    return this.addHandler(event, handler, false)
  }

  /**
   * Subscribe to an event for a single emission
   *
   * @param event - Event name to subscribe to
   * @param handler - Handler function to call once
   * @returns Subscription with id and unsubscribe function
   */
  once<K extends keyof T>(event: K, handler: EventHandler<T[K]>): EventSubscription {
    return this.addHandler(event, handler, true)
  }

  /**
   * Unsubscribe a handler from an event
   *
   * @param event - Event name
   * @param handler - Handler function to remove
   */
  off<K extends keyof T>(event: K, handler: EventHandler<T[K]>): void {
    const handlers = this.handlers.get(event)
    if (!handlers) return

    const index = handlers.findIndex(h => h.handler === handler)
    if (index !== -1) {
      handlers.splice(index, 1)
    }
  }

  /**
   * Emit an event synchronously
   *
   * @param event - Event name
   * @param payload - Event payload
   */
  emit<K extends keyof T>(event: K, payload: T[K]): void {
    const handlers = this.handlers.get(event)
    if (!handlers || handlers.length === 0) return

    // Create a copy to allow modifications during iteration
    const toCall = [...handlers]

    for (const entry of toCall) {
      if (entry.once) {
        this.removeById(event, entry.id)
      }
      entry.handler(payload)
    }
  }

  /**
   * Emit an event and wait for all handlers to complete
   *
   * @param event - Event name
   * @param payload - Event payload
   */
  async emitAsync<K extends keyof T>(event: K, payload: T[K]): Promise<void> {
    const handlers = this.handlers.get(event)
    if (!handlers || handlers.length === 0) return

    // Create a copy to allow modifications during iteration
    const toCall = [...handlers]

    const promises: Promise<void>[] = []

    for (const entry of toCall) {
      if (entry.once) {
        this.removeById(event, entry.id)
      }
      const result = entry.handler(payload)
      if (result instanceof Promise) {
        promises.push(result)
      }
    }

    await Promise.all(promises)
  }

  /**
   * Remove all listeners for an event, or all events
   *
   * @param event - Optional event name; if omitted, removes all listeners
   */
  removeAllListeners<K extends keyof T>(event?: K): void {
    if (event !== undefined) {
      this.handlers.delete(event)
    } else {
      this.handlers.clear()
    }
  }

  /**
   * Get the number of listeners for an event
   *
   * @param event - Event name
   * @returns Number of registered handlers
   */
  listenerCount<K extends keyof T>(event: K): number {
    return this.handlers.get(event)?.length ?? 0
  }

  private addHandler<K extends keyof T>(
    event: K,
    handler: EventHandler<T[K]>,
    once: boolean
  ): EventSubscription {
    const id = `${++this.idCounter}`

    let handlers = this.handlers.get(event)
    if (!handlers) {
      handlers = []
      this.handlers.set(event, handlers)
    }

    const entry: HandlerEntry<T[K]> = { id, handler, once }
    handlers.push(entry as HandlerEntry<T[keyof T]>)

    return {
      id,
      unsubscribe: () => this.removeById(event, id),
    }
  }

  private removeById<K extends keyof T>(event: K, id: string): void {
    const handlers = this.handlers.get(event)
    if (!handlers) return

    const index = handlers.findIndex(h => h.id === id)
    if (index !== -1) {
      handlers.splice(index, 1)
    }
  }
}

/**
 * Create a new type-safe event emitter
 *
 * @returns New EventEmitter instance
 *
 * @example
 * ```typescript
 * interface MyEvents extends EventMap {
 *   message: { text: string }
 *   count: number
 * }
 *
 * const emitter = createEventEmitter<MyEvents>()
 *
 * emitter.on('message', (payload) => {
 *   console.log(payload.text)
 * })
 *
 * emitter.emit('message', { text: 'Hello!' })
 * ```
 */
export function createEventEmitter<T extends EventMap>(): EventEmitter<T> {
  return new EventEmitter<T>()
}
