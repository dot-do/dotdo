/**
 * TypedEventEmitter - Type-safe event system for dotdo
 */

import type { EventMap, EventHandler, EventOptions, EventSubscription, StoredHandler, WildcardHandler } from './types'

export * from './types'

let subscriptionCounter = 0

interface StoredWildcardHandler<Events extends EventMap> {
  id: string
  handler: WildcardHandler<Events>
}

/**
 * Type-safe event emitter
 */
export class EventEmitter<Events extends EventMap = EventMap> {
  private handlers = new Map<keyof Events, StoredHandler<unknown>[]>()
  private wildcardHandlers: StoredWildcardHandler<Events>[] = []
  private maxListeners = 0 // 0 means unlimited

  /**
   * Set maximum listeners per event (0 for unlimited)
   */
  setMaxListeners(n: number): void {
    this.maxListeners = n
  }

  /**
   * Get maximum listeners limit
   */
  getMaxListeners(): number {
    return this.maxListeners
  }

  /**
   * Subscribe to an event
   */
  on<K extends keyof Events>(
    event: K,
    handler: EventHandler<Events[K]>,
    options: EventOptions = {}
  ): EventSubscription {
    const id = `sub_${++subscriptionCounter}`
    const storedHandler: StoredHandler<Events[K]> = {
      id,
      handler,
      options,
    }

    const handlers = this.handlers.get(event) ?? []
    handlers.push(storedHandler as StoredHandler<unknown>)
    this.handlers.set(event, handlers)

    // Check maxListeners
    if (this.maxListeners > 0 && handlers.length > this.maxListeners) {
      console.warn(
        `MaxListenersExceeded: Event "${String(event)}" has ${handlers.length} listeners ` +
          `(max: ${this.maxListeners}). This may indicate a memory leak.`
      )
    }

    return {
      id,
      unsubscribe: () => this.off(event, handler),
    }
  }

  /**
   * Unsubscribe a handler from an event
   */
  off<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void {
    const handlers = this.handlers.get(event)
    if (!handlers) return

    const index = handlers.findIndex((h) => h.handler === handler)
    if (index !== -1) {
      handlers.splice(index, 1)
    }
  }

  /**
   * Subscribe to an event, firing handler only once
   */
  once<K extends keyof Events>(
    event: K,
    handler: EventHandler<Events[K]>
  ): EventSubscription {
    return this.on(event, handler, { once: true })
  }

  /**
   * Emit an event to all handlers
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    // Call wildcard handlers first
    for (const stored of this.wildcardHandlers) {
      stored.handler(event, payload)
    }

    const handlers = this.handlers.get(event)
    if (!handlers) return

    // Sort by priority (higher first), maintain insertion order for same priority
    const sortedHandlers = [...handlers].sort((a, b) => {
      const priorityA = a.options.priority ?? 0
      const priorityB = b.options.priority ?? 0
      return priorityB - priorityA
    })

    // Collect handlers to remove after calling (for once handlers)
    const toRemove: EventHandler<unknown>[] = []

    for (const stored of sortedHandlers) {
      // Check filter option
      if (stored.options.filter && !stored.options.filter(payload)) {
        continue
      }
      ;(stored.handler as EventHandler<Events[K]>)(payload)
      if (stored.options.once) {
        toRemove.push(stored.handler)
      }
    }

    // Remove once handlers
    for (const handler of toRemove) {
      this.off(event, handler as EventHandler<Events[K]>)
    }
  }

  /**
   * Emit an event and wait for all async handlers to complete
   */
  async emitAsync<K extends keyof Events>(event: K, payload: Events[K]): Promise<void> {
    const handlers = this.handlers.get(event)
    if (!handlers) return

    // Sort by priority (higher first), maintain insertion order for same priority
    const sortedHandlers = [...handlers].sort((a, b) => {
      const priorityA = a.options.priority ?? 0
      const priorityB = b.options.priority ?? 0
      return priorityB - priorityA
    })

    // Collect handlers to remove after calling (for once handlers)
    const toRemove: EventHandler<unknown>[] = []
    const promises: Promise<void>[] = []

    for (const stored of sortedHandlers) {
      const result = (stored.handler as EventHandler<Events[K]>)(payload)
      if (result instanceof Promise) {
        promises.push(result)
      }
      if (stored.options.once) {
        toRemove.push(stored.handler)
      }
    }

    // Wait for all async handlers
    await Promise.all(promises)

    // Remove once handlers
    for (const handler of toRemove) {
      this.off(event, handler as EventHandler<Events[K]>)
    }
  }

  /**
   * Remove all listeners for an event, or all listeners if no event specified
   */
  removeAllListeners<K extends keyof Events>(event?: K): void {
    if (event !== undefined) {
      this.handlers.delete(event)
    } else {
      this.handlers.clear()
    }
  }

  /**
   * Emit an event safely - continues even if handlers throw
   * @param onError - Optional callback for errors
   */
  emitSafe<K extends keyof Events>(
    event: K,
    payload: Events[K],
    onError?: (error: Error) => void
  ): void {
    // Call wildcard handlers first
    for (const stored of this.wildcardHandlers) {
      try {
        stored.handler(event, payload)
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)))
      }
    }

    const handlers = this.handlers.get(event)
    if (!handlers) return

    // Sort by priority (higher first), maintain insertion order for same priority
    const sortedHandlers = [...handlers].sort((a, b) => {
      const priorityA = a.options.priority ?? 0
      const priorityB = b.options.priority ?? 0
      return priorityB - priorityA
    })

    // Collect handlers to remove after calling (for once handlers)
    const toRemove: EventHandler<unknown>[] = []

    for (const stored of sortedHandlers) {
      // Check filter option
      if (stored.options.filter && !stored.options.filter(payload)) {
        continue
      }
      try {
        ;(stored.handler as EventHandler<Events[K]>)(payload)
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)))
      }
      if (stored.options.once) {
        toRemove.push(stored.handler)
      }
    }

    // Remove once handlers
    for (const handler of toRemove) {
      this.off(event, handler as EventHandler<Events[K]>)
    }
  }

  /**
   * Get the number of listeners for an event
   */
  listenerCount<K extends keyof Events>(event: K): number {
    const handlers = this.handlers.get(event)
    return handlers?.length ?? 0
  }

  /**
   * Subscribe to all events
   */
  onAny(handler: WildcardHandler<Events>): EventSubscription {
    const id = `sub_${++subscriptionCounter}`
    this.wildcardHandlers.push({ id, handler })

    return {
      id,
      unsubscribe: () => this.offAny(handler),
    }
  }

  /**
   * Unsubscribe from all events
   */
  offAny(handler: WildcardHandler<Events>): void {
    const index = this.wildcardHandlers.findIndex((h) => h.handler === handler)
    if (index !== -1) {
      this.wildcardHandlers.splice(index, 1)
    }
  }
}

/**
 * Internal buffered event storage
 */
interface BufferedEvent<Events extends EventMap, K extends keyof Events = keyof Events> {
  event: K
  payload: Events[K]
}

/**
 * Event emitter that can buffer events while paused
 */
export class BufferedEmitter<Events extends EventMap = EventMap> extends EventEmitter<Events> {
  private _isPaused = false
  private buffer: BufferedEvent<Events>[] = []

  /**
   * Pause event emission - events will be buffered
   */
  pause(): void {
    this._isPaused = true
  }

  /**
   * Resume event emission - flush buffered events
   */
  resume(): void {
    this._isPaused = false
    this.flush()
  }

  /**
   * Clear buffered events without emitting
   */
  clear(): void {
    this.buffer = []
  }

  /**
   * Get the number of buffered events
   */
  get bufferSize(): number {
    return this.buffer.length
  }

  /**
   * Check if emitter is paused
   */
  get isPaused(): boolean {
    return this._isPaused
  }

  /**
   * Override emit to buffer when paused
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    if (this._isPaused) {
      this.buffer.push({ event, payload } as BufferedEvent<Events>)
      return
    }
    super.emit(event, payload)
  }

  /**
   * Flush all buffered events
   */
  private flush(): void {
    const eventsToEmit = this.buffer
    this.buffer = []
    for (const { event, payload } of eventsToEmit) {
      super.emit(event, payload)
    }
  }
}

/**
 * Global filter function type
 */
export type GlobalFilter<Events extends EventMap> = <K extends keyof Events>(
  event: K,
  payload: Events[K]
) => boolean

/**
 * Event emitter with global event filtering
 */
export class FilteredEmitter<Events extends EventMap = EventMap> extends EventEmitter<Events> {
  private globalFilter: GlobalFilter<Events> | null = null

  constructor(filter?: GlobalFilter<Events>) {
    super()
    if (filter) {
      this.globalFilter = filter
    }
  }

  /**
   * Set a global filter for all events
   */
  setFilter(filter: GlobalFilter<Events>): void {
    this.globalFilter = filter
  }

  /**
   * Clear the global filter
   */
  clearFilter(): void {
    this.globalFilter = null
  }

  /**
   * Override emit to apply global filter
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    if (this.globalFilter && !this.globalFilter(event, payload)) {
      return
    }
    super.emit(event, payload)
  }
}

/**
 * Global event bus singleton
 */
export class EventBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static instance: EventEmitter<any> | null = null

  /**
   * Get the singleton instance
   */
  static getInstance<Events extends EventMap = EventMap>(): EventEmitter<Events> {
    if (!EventBus.instance) {
      EventBus.instance = new EventEmitter<Events>()
    }
    return EventBus.instance as EventEmitter<Events>
  }

  /**
   * Reset the singleton instance (for testing)
   */
  static reset(): void {
    EventBus.instance = null
  }
}

/**
 * Create a new isolated event bus
 */
export function createEventBus<Events extends EventMap = EventMap>(): EventEmitter<Events> {
  return new EventEmitter<Events>()
}

/**
 * Options for EventHistory
 */
export interface EventHistoryOptions {
  /** Maximum number of events to keep in history */
  maxHistory?: number
}

/**
 * Internal history record
 */
interface HistoryRecord<Events extends EventMap, K extends keyof Events = keyof Events> {
  event: K
  payload: Events[K]
  timestamp: number
}

/**
 * Event emitter that records emitted events
 */
export class EventHistory<Events extends EventMap = EventMap> extends EventEmitter<Events> {
  private history: HistoryRecord<Events>[] = []
  private maxHistory: number | undefined

  constructor(options: EventHistoryOptions = {}) {
    super()
    this.maxHistory = options.maxHistory
  }

  /**
   * Override emit to record event in history
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.history.push({
      event,
      payload,
      timestamp: Date.now(),
    } as HistoryRecord<Events>)

    // Trim history if maxHistory is set
    if (this.maxHistory !== undefined && this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory)
    }

    super.emit(event, payload)
  }

  /**
   * Get all recorded events (returns a copy)
   */
  getHistory(): Array<{ event: keyof Events; payload: Events[keyof Events]; timestamp: number }> {
    return [...this.history]
  }

  /**
   * Get events for a specific event type
   */
  getHistoryForEvent<K extends keyof Events>(event: K): Array<{ event: K; payload: Events[K]; timestamp: number }> {
    return this.history.filter((record) => record.event === event) as Array<{
      event: K
      payload: Events[K]
      timestamp: number
    }>
  }

  /**
   * Clear all recorded events
   */
  clearHistory(): void {
    this.history = []
  }
}
